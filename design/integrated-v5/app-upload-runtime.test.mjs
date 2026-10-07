import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Script, createContext } from 'node:vm';
import { webcrypto, createHash } from 'node:crypto';
import { createIndexedDBStandin } from './privacy-cleanup-test-fixture.mjs';
import { seed, reduce } from './engine.mjs';
import { assertPrivacyCommand } from './privacy.mjs';
import { captureClosedRights } from './privacy-closed-rights.mjs';
import { oldCash } from './service-finance-composition-test-fixture.mjs';
import { resolveAccountActor } from './staff-accounts.mjs';

// Runtime unit only: execute the actual app body and its registered handlers.
// The DOM/Storage subset below has no layout, browser navigation, or file download.
// Imports are rebound to their original exports; privacy/business logic is not copied.
const KEY = 'tianli-integrated-v5';
const DRAFT = KEY + '-booking-draft:u1';
const RESULT = KEY + '-booking-result';
const appUrl = new URL('./app.mjs', import.meta.url);
const appSource = await readFile(process.env.TIANLI_APP_UPLOAD_BASELINE || appUrl, 'utf8');
const imported = {};
const importDeclarations = [...appSource.matchAll(/^import\s+\{([^}]+)\}\s+from\s+(['"])([^'"]+)\2;\s*$/gm)];
for (const declaration of importDeclarations) {
  const module = await import(new URL(declaration[3], appUrl));
  for (const name of declaration[1].split(',').map(s => s.trim())) {
    const [exported, local = exported] = name.split(/\s+as\s+/);
    imported[local] = module[exported];
  }
}
let executable = appSource;
for (const declaration of [...importDeclarations].reverse()) {
  executable = executable.slice(0, declaration.index) + executable.slice(declaration.index + declaration[0].length);
}
const appScript = new Script('(async () => {\n' + executable + '\n})()', { filename: appUrl.pathname });

class Storage {
  get length(){return Object.keys(this).length;}
  key(index){return Object.keys(this)[index]??null;}
  constructor(entries = {}) {
    Object.defineProperty(this, 'writes', { value: [], writable: true });
    for (const [key, value] of Object.entries(entries)) this.setItem(key, value);
    this.writes.length = 0;
  }
  getItem(key) { return Object.hasOwn(this, key) ? this[key] : null; }
  setItem(key, value) {
    Object.defineProperty(this, key, { value: String(value), writable: true, configurable: true, enumerable: true });
    this.writes.push({ method: 'set', key, value: String(value) });
  }
  removeItem(key) { delete this[key]; this.writes.push({ method: 'remove', key }); }
}

const dataAttribute = name => 'data-' + name.replace(/[A-Z]/g, c => '-' + c.toLowerCase());
const decode = value => value.replace(/&quot;|&#39;|&lt;|&gt;|&amp;/g, v => ({ '&quot;': '"', '&#39;': "'", '&lt;': '<', '&gt;': '>', '&amp;': '&' })[v]);
function simpleMatch(node, selector) {
  if (node.tagName.startsWith('#')) return false;
  const head = selector.replace(/\[[^\]]*\]/g, '');
  const tag = /^[A-Za-z][\w-]*/.exec(head)?.[0];
  if (tag && node.tagName.toLowerCase() !== tag.toLowerCase()) return false;
  for (const [, id] of head.matchAll(/#([\w-]+)/g)) if (node.id !== id) return false;
  for (const [, name] of head.matchAll(/\.([\w-]+)/g)) if (!node.className.split(/\s+/).includes(name)) return false;
  for (const [, name, operator, quoted, plain] of selector.matchAll(/\[([^\s=\]^]+)(?:(\^?=)(?:"([^"]*)"|([^\]]*)))?\]/g)) {
    const actual = node.getAttribute(name), expected = quoted ?? plain;
    if (actual == null || operator === '=' && actual !== expected || operator === '^=' && !actual.startsWith(expected)) return false;
  }
  return true;
}
function matches(node, selector) {
  return selector.split(',').some(part => {
    const tokens = part.trim().replace(/>/g, ' > ').split(/\s+/);
    let current = node;
    if (!simpleMatch(current, tokens.pop())) return false;
    while (tokens.length) {
      const token = tokens.pop();
      if (token === '>') {
        current = current.parentNode;
        if (!current || !simpleMatch(current, tokens.pop())) return false;
      } else {
        do { current = current.parentNode; } while (current && !simpleMatch(current, token));
        if (!current) return false;
      }
    }
    return true;
  });
}

class Node {
  constructor(tag, document) {
    this.tagName = tag.toUpperCase(); this.ownerDocument = document; this.parentNode = null;
    this.children = []; this.attributes = new Map(); this.listeners = new Map(); this._text = '';
    this.dataset = new Proxy({}, {
      get: (_, name) => this.getAttribute(dataAttribute(String(name))) ?? undefined,
      set: (_, name, value) => { this.setAttribute(dataAttribute(String(name)), value); return true; },
    });
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  hasAttribute(name) { return this.attributes.has(name); }
  removeAttribute(name) { this.attributes.delete(name); }
  get id() { return this.getAttribute('id') || ''; }
  get className() { return this.getAttribute('class') || ''; }
  set className(value) { this.setAttribute('class', value); }
  get classList() { return { toggle: (name, enabled) => {
    const names = new Set(this.className.split(/\s+/).filter(Boolean));
    if (enabled ?? !names.has(name)) names.add(name); else names.delete(name);
    this.className = [...names].join(' ');
  } }; }
  get name() { return this.getAttribute('name') || ''; }
  get type() { return this.getAttribute('type') || (this.tagName === 'SELECT' ? 'select-one' : 'text'); }
  get value() {
    if (this._value !== undefined) return this._value;
    if (this.tagName === 'SELECT') return this.selectedOptions[0]?.getAttribute('value') || '';
    return this.getAttribute('value') || (this.tagName === 'TEXTAREA' ? this.textContent : '');
  }
  set value(value) { this._value = String(value); }
  get checked() { return this.hasAttribute('checked'); }
  set checked(value) { if (value) this.setAttribute('checked', ''); else this.removeAttribute('checked'); }
  get disabled() { return this.hasAttribute('disabled'); }
  set disabled(value) { if (value) this.setAttribute('disabled', ''); else this.removeAttribute('disabled'); }
  get required() { return this.hasAttribute('required'); }
  set required(value) { if (value) this.setAttribute('required', ''); else this.removeAttribute('required'); }
  get hidden() { return this.hasAttribute('hidden'); }
  set hidden(value) { if (value) this.setAttribute('hidden', ''); else this.removeAttribute('hidden'); }
  get selectedOptions() { const options = this.querySelectorAll('option'); const selected = options.filter(n => n.hasAttribute('selected')); return selected.length ? selected : options.slice(0, 1); }
  get elements() { return { namedItem: name => this.querySelector('[name="' + name + '"]') }; }
  reportValidity() {
    return this.querySelectorAll('[name]').every(field => {
      if (field.disabled) return true;
      if (field.required && (['checkbox', 'radio'].includes(field.type) ? !field.checked : field.value === '')) return false;
      if (field.type !== 'number' || field.value === '') return true;
      const value = Number(field.value);
      return Number.isFinite(value) && (!field.hasAttribute('min') || value >= Number(field.getAttribute('min'))) && (!field.hasAttribute('max') || value <= Number(field.getAttribute('max')));
    });
  }
  get isConnected() { let root = this; while (root.parentNode) root = root.parentNode; return root === this.ownerDocument; }
  append(...nodes) { for (const node of nodes) { node.remove(); node.parentNode = this; this.children.push(node); } }
  remove() { if (this.parentNode) this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1); this.parentNode = null; }
  replaceChildren(...nodes) { for (const child of [...this.children]) child.remove(); this._text = ''; this.append(...nodes); }
  get textContent() { return this._text + this.children.map(n => n.textContent).join(''); }
  set textContent(value) { this.replaceChildren(); this._text = String(value); }
  set innerHTML(value) { this.replaceChildren(); parseHtml(String(value), this); }
  insertAdjacentHTML(position, value) { if (position !== 'beforeend') throw new Error('DOM subset supports beforeend only'); parseHtml(String(value), this); }
  matches(selector) { return matches(this, selector); }
  closest(selector) { let node = this; while (node) { if (node.matches(selector)) return node; node = node.parentNode; } return null; }
  querySelectorAll(selector) {
    const found = [];
    for (const child of this.children) { if (child.matches(selector)) found.push(child); found.push(...child.querySelectorAll(selector)); }
    return found;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  addEventListener(type, listener) { const list = this.listeners.get(type) || []; list.push(listener); this.listeners.set(type, list); }
  removeEventListener(type, listener) { this.listeners.set(type, (this.listeners.get(type) || []).filter(x => x !== listener)); }
  async emit(type, target = this) {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'target', { value: target });
    // Preserve the actual target while bubbling to the document's app listeners.
    for (let node = target; node; node = node.parentNode) for (const listener of node.listeners.get(type) || []) await listener(event);
    return event;
  }
  focus() { this.ownerDocument.activeElement = this; }
}

function parseHtml(html, root) {
  const stack = [root];
  for (const token of html.matchAll(/<!--[\s\S]*?-->|<\/?[A-Za-z][^>]*>|[^<]+/g)) {
    const text = token[0];
    if (text.startsWith('<!--')) continue;
    if (text.startsWith('</')) { if (stack.length > 1) stack.pop(); continue; }
    if (text.startsWith('<')) {
      const tag = /^<([\w-]+)/.exec(text)[1], node = root.ownerDocument.createElement(tag);
      const attrs = text.slice(tag.length + 1).replace(/\/?\s*>$/, '');
      for (const [, name, double, single, plain] of attrs.matchAll(/([^\s=<>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>]+)))?/g)) node.setAttribute(name, decode(double ?? single ?? plain ?? ''));
      stack.at(-1).append(node);
      if (!['input', 'img', 'br', 'hr', 'meta', 'link', 'source'].includes(tag.toLowerCase()) && !text.endsWith('/>')) stack.push(node);
    } else {
      const node = root.ownerDocument.createElement('#text'); node._text = decode(text); stack.at(-1).append(node);
    }
  }
}
class Document extends Node {
  constructor() {
    super('#document'); this.ownerDocument = this; this.body = this.createElement('body'); this.append(this.body);
    this.body.innerHTML = '<div id="app"></div><div id="toast"></div>';
  }
  createElement(tag) { return new Node(tag, this); }
  getElementById(id) { return this.querySelector('#' + id); }
}

// Native Node FormData cannot consume a DOM form. This adapter provides the
// successful-controls iteration used by the unchanged app, without scope logic.
class FormDataSubset {
  constructor(form) {
    this.values = [];
    for (const field of form?.querySelectorAll('[name]') || []) {
      if (!['INPUT', 'SELECT', 'TEXTAREA'].includes(field.tagName) || !field.name || field.disabled || ['submit', 'button', 'reset'].includes(field.type)) continue;
      if (['checkbox', 'radio'].includes(field.type) && !field.checked) continue;
      if (field.type === 'file') { for (const file of field.files || []) this.values.push([field.name, file]); continue; }
      if (field.tagName === 'SELECT' && field.hasAttribute('multiple')) {
        for (const option of field.querySelectorAll('option').filter(x => x.hasAttribute('selected'))) this.values.push([field.name, option.getAttribute('value') ?? option.textContent]);
      } else this.values.push([field.name, field.value]);
    }
  }
  *entries() { yield* this.values; }
  [Symbol.iterator]() { return this.entries(); }
  getAll(name) { return this.values.filter(([key]) => key === name).map(([, value]) => value); }
}

async function runtime(ledger = seed(), hash = '#/user/home', { initialActor, apiOverrides = {}, locks = createLocks(), initialSession = {}, initialHistory=null, storageSetup } = {}) {
  const document = new Document(), window = new Node('#window', document);
  window.scrollTo = () => {};
  const localStorage = new Storage({ [KEY]: JSON.stringify(ledger) });
  storageSetup?.(localStorage);
  const sessionStorage = new Storage({ [RESULT]: 'success', ...initialSession });
  if(initialActor)sessionStorage.setItem(KEY+'-actor',JSON.stringify(initialActor));
  const location = { hash, origin: 'http://127.0.0.1:4204', pathname: '/' };
  const history = { state: initialHistory, replaceState(value, _title, url) { this.state = value; if (url?.includes('#')) location.hash = url.slice(url.indexOf('#')); } };
  const errors = [], timers = new Map(); let nextTimer = 0;
  const context = createContext({
    ...imported,
    // Original module default parameters use their own realm: pass this DOM explicitly.
    hydrateMedia: () => imported.hydrateMedia(document),
    ...apiOverrides,
    document, window, localStorage, sessionStorage, location, history,
    navigator: {locks}, crypto: webcrypto, URL, Blob, File, Image: class {async decode(){}}, Event, FormData: FormDataSubset, TextEncoder, TextDecoder, structuredClone,
    setTimeout: callback => { timers.set(++nextTimer, callback); return nextTimer; }, clearTimeout: id => timers.delete(id),
    console: { error: error => errors.push(error), log() {}, warn: message => errors.push(message) },
  });
  await appScript.runInContext(context);
  assert.deepEqual(errors, [], 'initial render must execute without swallowed runtime errors');
  async function settle(){for(let i=0;i<1500;i++){await new Promise(setImmediate);if(!locks?.busy&&!document.querySelectorAll('[data-management-form]').some(form=>Number(form.dataset.invoicePending||0)>0||Number(form.dataset.imagePending||0)>0)&&i>30)return;}throw Error('app operation did not settle');}
  return { settle,
    document, window, sessionStorage, localStorage, errors, location, history, locks,
    authoritative(next) { localStorage.setItem(KEY, JSON.stringify(next)); },
    resetWrites() { localStorage.writes.length = 0; sessionStorage.writes.length = 0; },
    async dispatch(type, target) {
      assert.ok(target.isConnected, 'event starts on a connected old page node');
      const event = await document.emit(type, target);
      // App submit starts execute without awaiting it. Flush its original async
      // evidence/transaction microtasks before examining persisted state.
      await settle();
      return event;
    },
    async render() { return window.emit('hashchange', window); },
  };
}

function completedBooking() {
  let ledger = seed(); let sequence = 0;
  const person = { role: 'user', userId: 'u1' }, tech = { role: 'tech', techId: 'lin' };
  const run = (type, payload, actor = person) => { ledger = reduce(ledger, actor, type, { requestId: 'app-unit-source-' + (++sequence), ...payload }); };
  const startAt = Math.ceil((ledger.now + 4 * 3600000) / 1800000) * 1800000;
  run('booking.create', { storeId: 'xingfu', serviceId: 'relax', regionId: 'home', techId: 'lin', startAt, mode: 'specified', genderPreference: 'any', contactName: '合成运行单元顾客', phone: '13800000001', healthConsent: true, identityVerified: true, adultConfirmed: true });
  const id = ledger.bookings.at(-1).id;
  run('booking.pay', { id, outcome: 'success' }); run('booking.accept', { id }, tech);
  run('clock.advance', { minutes: (startAt - ledger.now) / 60000 }, { role: 'group', job: 'all' }); run('booking.start', { id }, tech);
  run('clock.advance', { minutes: 60 }, { role: 'group', job: 'all' }); run('booking.finish', { id, mode: 'normal' }, tech);
  return { ledger, id };
}
function fillActualAssessment(form) {
  for(const [name,value] of Object.entries({kind:'mature',batch:'隔离app原材料链',assessor:'技术样本核验员',occurredAt:'2026-10-02T08:30',result:'pass',proof:'APP-QA-ORIGINAL',reason:'隔离技术样本，非真实人员资格认定'}))form.elements.namedItem(name).value=value;
  form.querySelector('[name="serviceIds"]').checked=true;
}

function createLocks(){
  let tail=Promise.resolve(),active=0,calls=0,current=0;
  return {get busy(){return active>0;},get calls(){return calls;},get current(){return current;},request(key,fn){assert.equal(key,KEY);const ticket=++calls;const result=tail.then(async()=>{assert.equal(active,0);active++;current=ticket;try{return await fn();}finally{active--;}});tail=result.catch(()=>{});return result;}};
}
const idb=createIndexedDBStandin(),oldIDB=globalThis.indexedDB,oldDecoder=globalThis.createImageBitmap;
globalThis.indexedDB=idb.indexedDB;
globalThis.createImageBitmap=async()=>({width:1,height:1,close(){}});
test.after(()=>{globalThis.indexedDB=oldIDB;globalThis.createImageBitmap=oldDecoder;});
test.beforeEach(()=>{idb.setHook(null);idb.events.length=0;for(const db of idb.databases.values())for(const store of db.stores.values())store.clear();});
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVxsAAAAASUVORK5CYII=','base64');
const image=()=>new File([PNG],'PRIVATE-13800001111.png',{type:'image/png'});
const pdf=(n='source')=>new File([`%PDF-1.4\n${n}\n%%EOF`],'PRIVATE-13800001111.pdf',{type:'application/pdf'});
const ledger=h=>JSON.parse(h.localStorage.getItem(KEY));
const rows=h=>ledger(h).privacyUploadReservations||[];
const toast=h=>h.document.getElementById('toast').textContent;
function originalForm(h,command){const form=h.document.querySelector(`form[data-command="${command}"]`);assert.ok(form,command+' actual rendered form');return form;}
async function choose(h,form,selector,files){const input=form.querySelector(selector);assert.ok(input,selector);input.files=files;await h.dispatch('change',input);await h.settle();}
async function submit(h,form){const pending=h.dispatch('submit',form);await new Promise(setImmediate);const confirm=h.document.querySelector('[data-confirm-choice="accept"]');if(confirm)await h.dispatch('click',confirm);await pending;await h.settle();}
function puts(){return idb.events.filter(event=>event.op==='put');}
function assertNoDelete(){assert.equal(idb.events.some(event=>event.op==='delete'),false);}
function assertSingleBusinessAttach(h,before,domain){
  let prior=before,changes=0,attachments=0;
  for(const write of h.localStorage.writes.filter(write=>write.key===KEY&&write.method==='set')){
    const next=JSON.parse(write.value),changed=JSON.stringify(next[domain])!==JSON.stringify(prior[domain]);
    const attached=(next.privacyUploadReservations||[]).some(row=>row.status==='attached'&&prior.privacyUploadReservations?.find(old=>old.id===row.id)?.status!=='attached');
    if(changed)changes++;if(attached)attachments++;assert.equal(changed,attached,'domain fact and attachment must change in the same actual KEY write');prior=next;
  }
  assert.equal(changes,1);assert.equal(attachments,1);
}

test('app资格实际选择 preput/readback → 原reduce同commit附着，无姓名正文侧记',async()=>{
  const h=await runtime(seed(),'#/store/qualifications/lin',{initialActor:{role:'store',storeId:'xingfu'}}),form=originalForm(h,'qualification.assess');
  idb.setHook(event=>{if(event.op==='put')assert.equal(rows(h).at(-1).status,'preparing');});
  await choose(h,form,'[data-qualification-upload]',[pdf()]);
  assert.equal(rows(h).length,1,toast(h));assert.equal(rows(h)[0].status,'saved');assert.equal(rows(h)[0].ioOutcome,'stored_verified');
  const draft=JSON.parse(Object.values(h.sessionStorage).find(value=>typeof value==='string'&&value.includes('"uploadSelections"')));
  assert.doesNotMatch(JSON.stringify(draft.uploadSelections),/PRIVATE|13800001111/);assert.equal(draft.uploadSelections[0].id,rows(h)[0].id);
  const before=ledger(h);fillActualAssessment(form);h.resetWrites();await submit(h,form);
  assert.equal(rows(h)[0].status,'attached',toast(h));assertSingleBusinessAttach(h,before,'techQualifications');
  assert.ok(ledger(h).techQualifications.find(x=>x.techId==='lin').assessments[0].evidenceRefs.length);assert.deepEqual(ledger(h).bookings,before.bookings);assertNoDelete();
});

test('app投诉真实多图与原预约来源提交附着',async()=>{
  const fixture=completedBooking(),h=await runtime(fixture.ledger,'#/user/care/new?bookingId='+fixture.id),form=originalForm(h,'care.case-create');
  await choose(h,form,'[data-care-upload]',[image()]);assert.equal(rows(h).at(-1)?.status,'saved',toast(h));
  for(const [name,value] of Object.entries({category:'quality',description:'隔离实际原投诉依据'})){const field=form.elements.namedItem(name);if(field)field.value=value;}
  await submit(h,form);assert.equal(rows(h).at(-1).status,'attached',toast(h));assert.equal(ledger(h).serviceCareCases.at(-1).bookingId,fixture.id);assertNoDelete();
});

test('app协议在选择前产生稳定原requestId，填正文后原提交复用且附着',async()=>{
  const h=await runtime(seed(),'#/group/service-promotion/agreements',{initialActor:{role:'group',job:'operations'}}),form=originalForm(h,'service-promotion.agreement-publish');
  assert.equal(JSON.parse(form.dataset.payload).requestId,undefined);
  await choose(h,form,'[data-invoice-upload]',[pdf('agreement')]);
  const requestId=JSON.parse(form.dataset.payload).requestId;assert.ok(requestId);assert.equal(rows(h).at(-1)?.source.id,'draft:'+requestId,toast(h));
  for(const [name,value] of Object.entries({title:'隔离协议',body:'实际原条款测试',effectiveAt:new Date(ledger(h).now+8*3600000).toISOString().slice(0,16),reference:'APP-LEGAL-TEST',occurredAt:'2026-10-02T08:30',reason:'原协议核验'})){const field=form.elements.namedItem(name);if(field)field.value=value;}
  await submit(h,form);assert.equal(rows(h).at(-1).status,'attached',toast(h));assert.equal(ledger(h).servicePromotionRequests.at(-1).requestId,requestId);assertNoDelete();
});

test('app商品主图和不连续gallery槽使用真实保存，每槽同SHA独立登记',async()=>{
  const h=await runtime(seed(),'#/group/catalog/new',{initialActor:{role:'group',job:'operations'}}),form=originalForm(h,'manage.product-save');
  for(const field of ['image','gallery0','gallery2'])await choose(h,form,`[data-image-upload="${field}"]`,[image()]);
  assert.equal(rows(h).length,3,toast(h));assert.equal(new Set(rows(h).map(row=>row.id)).size,3);assert.equal(new Set(rows(h).map(row=>row.ref)).size,1);
  for(const [name,value] of Object.entries({name:'隔离登记商品',categoryId:ledger(h).categories[0].id,summary:'实际原图片槽',description:'原详情测试',reason:'原图核验',skuName:'原规格',priceCents:'10',stock:'10',weightGrams:'100'})){const field=form.elements.namedItem(name);if(field)field.value=value;}
  await submit(h,form);assert.ok(rows(h).every(row=>row.status==='attached'),toast(h));
  const product=ledger(h).products.at(-1);assert.equal(product.gallery.length,2);assert.ok(rows(h).some(row=>row.attachedSources.some(slot=>slot.slot==='gallery:1')));assertNoDelete();
});

test('app多图中途失败保留已保存事实与旧选择；显式清空才解除',async()=>{
  const h=await runtime(seed(),'#/store/qualifications/lin',{initialActor:{role:'store',storeId:'xingfu'}}),form=originalForm(h,'qualification.assess');
  await choose(h,form,'[data-qualification-upload]',[pdf('old')]);const original=form.elements.namedItem('evidenceRefs').value;
  await choose(h,form,'[data-qualification-upload]',[pdf('new-first'),new File(['broken'],'bad.pdf',{type:'application/pdf'})]);
  assert.equal(form.elements.namedItem('evidenceRefs').value,original);assert.equal(rows(h).length,2);assert.ok(rows(h).every(row=>row.status==='saved'&&!row.cancelledAt));
  await h.dispatch('click',form.querySelector('[data-qualification-clear]'));assert.equal(form.elements.namedItem('evidenceRefs').value,'[]');assert.ok(rows(h).every(row=>row.status==='cancelled'||row.cancellationStatus==='pending_review'));assertNoDelete();
});

test('app同SHA重选独立登记，旧原选择解除仅记事件不删除',async()=>{
  const h=await runtime(seed(),'#/store/qualifications/lin',{initialActor:{role:'store',storeId:'xingfu'}}),form=originalForm(h,'qualification.assess');
  await choose(h,form,'[data-qualification-upload]',[pdf('same')]);await choose(h,form,'[data-qualification-upload]',[pdf('same')]);
  assert.equal(rows(h).length,2);assert.notEqual(rows(h)[0].id,rows(h)[1].id);assert.equal(rows(h)[0].ref,rows(h)[1].ref);assert.equal(rows(h)[0].cancellationSource.kind,'replace-selection');assert.equal(rows(h)[1].status,'saved');assertNoDelete();
});

test('app原来源版本和换页在实际put后变化均保留saved但拒绝回填',async()=>{
  for(const mode of ['source','route']){
    const h=await runtime(seed(),'#/store/qualifications/lin',{initialActor:{role:'store',storeId:'xingfu'}}),form=originalForm(h,'qualification.assess');let changed=false;
    idb.setHook(event=>{if(event.op!=='put'||changed)return;changed=true;if(mode==='route')h.location.hash='#/store/dashboard';else{const next=ledger(h);next.techs.find(row=>row.id==='lin').version++;h.authoritative(next);}});
    await choose(h,form,'[data-qualification-upload]',[pdf(mode)]);assert.equal(rows(h).at(-1).status,'saved');assert.equal(rows(h).at(-1).usable,false);assert.equal(form.elements.namedItem('evidenceRefs').value,'[]');assert.equal(rows(h).at(-1).cancelledAt,undefined);idb.setHook(null);
  }
});

test('app H.1无原标签证明草稿保留编号但不凭刷新恢复上传授权',async()=>{
  const h=await runtime(seed(),'#/store/qualifications/lin',{initialActor:{role:'store',storeId:'xingfu'}}),form=originalForm(h,'qualification.assess');
  await choose(h,form,'[data-qualification-upload]',[pdf()]);const raw=JSON.stringify(rows(h));
  const oldLedger=ledger(h);delete oldLedger.privacyUploadTabs;delete oldLedger.privacyUploadTabRevisions;
  const oldSession=Object.fromEntries(Object.entries(h.sessionStorage));delete oldSession['tianli-integrated-v5-privacy-tab-instance'];
  const refreshed=await runtime(oldLedger,'#/store/qualifications/lin',{initialActor:{role:'store',storeId:'xingfu'},initialSession:oldSession}),restored=originalForm(refreshed,'qualification.assess');fillActualAssessment(restored);await submit(refreshed,restored);
  assert.match(toast(refreshed),/旧草稿|重新选择|尚未/);assert.equal(JSON.stringify(rows(refreshed)),raw);
  await choose(refreshed,restored,'[data-qualification-upload]',[pdf('reselected')]);await submit(refreshed,restored);assert.equal(rows(refreshed).at(-1).status,'attached',toast(refreshed));assert.equal(rows(refreshed)[0].status,'saved');assertNoDelete();
});

test('app H.2可信草稿真新document恢复原附件，无再次put且真实提交附着',async()=>{
  const h=await runtime(seed(),'#/store/qualifications/lin',{initialActor:{role:'store',storeId:'xingfu'}}),form=originalForm(h,'qualification.assess');
  await choose(h,form,'[data-qualification-upload]',[pdf('refresh')]);const original=structuredClone(rows(h)[0]);
  const refreshed=await runtime(ledger(h),'#/store/qualifications/lin',{initialActor:{role:'store',storeId:'xingfu'},initialSession:Object.fromEntries(Object.entries(h.sessionStorage))}),restored=originalForm(refreshed,'qualification.assess');
  assert.equal(rows(refreshed).length,1);assert.deepEqual(rows(refreshed)[0].selection,original.selection);assert.notEqual(rows(refreshed)[0].activeClaim.selection.instanceId,original.selection.instanceId);
  fillActualAssessment(restored);await submit(refreshed,restored);assert.equal(rows(refreshed)[0].status,'attached',toast(refreshed));assert.equal(puts().length,1);assert.doesNotMatch(toast(refreshed),/待重试/);assertNoDelete();
});

test('app无可靠锁明确拒绝上传，普通无附件资格业务仍可执行',async()=>{
  const h=await runtime(seed(),'#/store/qualifications/lin',{initialActor:{role:'store',storeId:'xingfu'},locks:null}),form=originalForm(h,'qualification.assess');
  await choose(h,form,'[data-qualification-upload]',[pdf()]);assert.match(toast(h),/可靠.*锁/);assert.equal(puts().length,0);assert.equal(rows(h).length,0);
  fillActualAssessment(form);await submit(h,form);assert.ok(ledger(h).techQualifications.find(row=>row.techId==='lin'),toast(h));assertNoDelete();
});

test('app旧公共inline逐准确叶外化并附着，未知旧草稿原值保留',async()=>{
  const initial=seed();initial.products[0].image='data:image/png;base64,'+PNG.toString('base64');
  const key=KEY+'-management:unknown-old',old=JSON.stringify({unlocated:'data:image/png;base64,'+PNG.toString('base64')});
  const h=await runtime(initial,'#/user/home',{initialSession:{[key]:old}});
  assert.equal(rows(h).length,1);assert.equal(rows(h)[0].status,'attached');assert.equal(ledger(h).products[0].image,rows(h)[0].ref);assert.equal(h.sessionStorage.getItem(key),old);assert.ok(h.locks.calls>=1);assert.equal(puts().length,1);assertNoDelete();
});

function invoiceFixture(){
  const completed=completedBooking();let state=reduce(completed.ledger,{role:'user',userId:'u1'},'invoice.apply',{bookingId:completed.id,kind:'personal',title:'实际原抬头',email:'source@example.test',requestId:'app-upload-invoice-apply'}),seq=0;
  const run=(a,type,p)=>{let result;state=reduce(state,a,type,{requestId:'app-upload-staff-'+(++seq),...p},value=>result=value);return result;};
  const user={role:'user',userId:'u1'},admin=run(user,'account.enter',{accountId:'DEMO-ADMIN',grantId:'DEMO-ADMIN-GRANT'});
  let account=run(admin,'account.create',{name:'隔离本店财务',reason:'实际原上传权限测试'});
  account=run(admin,'account.grant',{id:account.id,version:account.version,job:'store-finance',storeId:'xingfu',reason:'实际原授权'});
  const actor=run(user,'account.enter',{accountId:account.id,grantId:account.grants[0].id});
  return{ledger:state,actor,id:state.serviceInvoices.at(-1).id};
}

test('app原工作岗位服务票据上传、原reduce开票，同提交附着不更改原资金',async()=>{
  const f=invoiceFixture(),h=await runtime(f.ledger,'#/store/invoices/'+f.id,{initialActor:f.actor}),form=originalForm(h,'invoice.issue');
  await choose(h,form,'[data-invoice-upload]',[pdf('blue')]);assert.equal(rows(h).at(-1).uploadedBy.sessionId,f.actor.sessionId);
  form.elements.namedItem('ticketNumber').value='APP-BLUE-001';const before=ledger(h);h.resetWrites();await submit(h,form);
  assert.equal(rows(h).at(-1).status,'attached',toast(h));assert.equal(ledger(h).serviceInvoices.at(-1).status,'issued');assertSingleBusinessAttach(h,before,'serviceInvoices');assert.deepEqual(ledger(h).bookings,before.bookings);assertNoDelete();
});

test('app选文件后实际工作会话撤销，保存事实归原作者但不可附着',async()=>{
  const f=invoiceFixture(),h=await runtime(f.ledger,'#/store/invoices/'+f.id,{initialActor:f.actor}),form=originalForm(h,'invoice.issue');let changed=false;
  idb.setHook(event=>{if(event.op!=='put'||changed)return;changed=true;const next=ledger(h);next.staffSessions.find(row=>row.id===f.actor.sessionId).revokedAt=next.now;h.authoritative(next);});
  await choose(h,form,'[data-invoice-upload]',[pdf('revoked')]);assert.equal(rows(h).at(-1).status,'saved');assert.equal(rows(h).at(-1).usable,false);assert.equal(rows(h).at(-1).uploadedBy.sessionId,f.actor.sessionId);assert.equal(form.elements.namedItem('fileRef').value,'');assertNoDelete();
});

test('app同字段选择代次在put后变化，原saved不能被较新选择回填或自动取消',async()=>{
  const h=await runtime(seed(),'#/store/qualifications/lin',{initialActor:{role:'store',storeId:'xingfu'}}),form=originalForm(h,'qualification.assess');
  idb.setHook(event=>{if(event.op==='put')form.dataset.qualificationGeneration='new-real-selection';});
  await choose(h,form,'[data-qualification-upload]',[pdf('generation')]);assert.equal(rows(h).at(-1).status,'saved');assert.equal(rows(h).at(-1).usable,false);assert.equal(form.elements.namedItem('evidenceRefs').value,'[]');assert.equal(rows(h).at(-1).cancelledAt,undefined);assertNoDelete();
});

test('app真实put失败保留failed登记，不制造业务槽或伪取消',async()=>{
  const h=await runtime(seed(),'#/store/qualifications/lin',{initialActor:{role:'store',storeId:'xingfu'}}),form=originalForm(h,'qualification.assess');
  idb.setHook(event=>{if(event.op==='put')throw Error('isolated byte store quota');});
  await choose(h,form,'[data-qualification-upload]',[pdf('failed')]);assert.equal(rows(h).at(-1).status,'failed');assert.equal(rows(h).at(-1).ioOutcome,'write_unverified');assert.equal(rows(h).at(-1).cancelledAt,undefined);assert.equal(form.elements.namedItem('evidenceRefs').value,'[]');assert.equal((ledger(h).techQualifications||[]).length,0);assertNoDelete();
});

test('app业务KEY提交失败保留saved及草稿，重试真实reduce只附着一次',async()=>{
  const h=await runtime(seed(),'#/store/qualifications/lin',{initialActor:{role:'store',storeId:'xingfu'}}),form=originalForm(h,'qualification.assess');
  await choose(h,form,'[data-qualification-upload]',[pdf('retry')]);fillActualAssessment(form);
  const original=h.localStorage.setItem.bind(h.localStorage);let refused=false;
  h.localStorage.setItem=(key,value)=>{if(key===KEY&&JSON.parse(value).privacyUploadReservations?.some(row=>row.status==='attached')&&!refused){refused=true;throw Error('isolated business commit quota');}return original(key,value);};
  await submit(h,form);assert.equal(rows(h).at(-1).status,'saved');assert.equal((ledger(h).techQualifications||[]).length,0);assert.match(toast(h),/quota/);
  await submit(h,form);assert.equal(rows(h).at(-1).status,'attached',toast(h));assert.equal(ledger(h).techQualifications.at(-1).assessments.length,1);assert.equal(puts().length,1);assertNoDelete();
});

test('app两个并发文件选择都经原KEY锁串行，不能借另一上传持锁绕行',async()=>{
  const h=await runtime(seed(),'#/group/catalog/new',{initialActor:{role:'group',job:'operations'}}),form=originalForm(h,'manage.product-save'),one=form.querySelector('[data-image-upload="image"]'),two=form.querySelector('[data-image-upload="gallery1"]');
  const putLocks=[];idb.setHook(event=>{if(event.op==='put'){assert.equal(h.locks.busy,true);putLocks.push(h.locks.current);}});
  one.files=[image()];two.files=[image()];const a=h.dispatch('change',one),b=h.dispatch('change',two);await Promise.all([a,b]);await h.settle();
  assert.equal(rows(h).length,2,toast(h));assert.equal(rows(h).filter(row=>row.status==='saved').length,2);assert.equal(new Set(putLocks).size,2);assert.equal(new Set(rows(h).map(row=>row.selection.generation)).size,2);assertNoDelete();
});

test('app明确放弃本页草稿记录原选择解除，保留实际文件',async()=>{
  const h=await runtime(seed(),'#/store/qualifications/lin',{initialActor:{role:'store',storeId:'xingfu'}}),form=originalForm(h,'qualification.assess');
  await choose(h,form,'[data-qualification-upload]',[pdf('abandon')]);const click=h.dispatch('click',form.querySelector('[data-command="ui.management-discard"]'));await new Promise(setImmediate);await h.dispatch('click',h.document.querySelector('[data-confirm-choice="accept"]'));await click;await h.settle();
  assert.equal(rows(h).at(-1).cancellationSource.kind,'abandon-draft');assert.ok(rows(h).at(-1).status==='cancelled'||rows(h).at(-1).cancellationStatus==='pending_review');assertNoDelete();
});

test('app同document重渲染凭原私有实例、侧记及真实scope恢复合法选择',async()=>{
  const h=await runtime(seed(),'#/store/qualifications/lin',{initialActor:{role:'store',storeId:'xingfu'}}),form=originalForm(h,'qualification.assess');
  await choose(h,form,'[data-qualification-upload]',[pdf('same-document')]);await h.render();const restored=originalForm(h,'qualification.assess');fillActualAssessment(restored);await submit(h,restored);assert.equal(rows(h).at(-1).status,'attached',toast(h));assert.equal(rows(h).length,1);assertNoDelete();
});

test('app替换坏PDF失败后原合法资格PDF仍可经真实提交附着',async()=>{
  const h=await runtime(seed(),'#/store/qualifications/lin',{initialActor:{role:'store',storeId:'xingfu'}}),form=originalForm(h,'qualification.assess');
  await choose(h,form,'[data-qualification-upload]',[pdf('retain-for-submit')]);const original=form.elements.namedItem('evidenceRefs').value;
  await choose(h,form,'[data-qualification-upload]',[new File(['broken'],'bad.pdf',{type:'application/pdf'})]);
  assert.equal(form.elements.namedItem('evidenceRefs').value,original);assert.equal(rows(h).length,1);assert.equal(rows(h)[0].status,'saved');assert.equal(rows(h)[0].usable,true);
  fillActualAssessment(form);await submit(h,form);
  assert.equal(rows(h)[0].status,'attached',toast(h));assert.equal(ledger(h).techQualifications.at(-1).assessments.length,1);assert.equal(puts().length,1);assertNoDelete();
});

test('app启动迁移首次严格读取短暂失败，保留存档并继续原普通入口',async()=>{
  const source=seed();let reads=0;
  const h=await runtime(source,'#/user/home',{storageSetup(storage){const original=storage.getItem.bind(storage);storage.getItem=key=>{if(key===KEY&&++reads===3)throw Error('isolated migration read unavailable');return original(key);};}});
  for(const [key,value] of Object.entries(source))assert.deepEqual(ledger(h)[key],value,key+' original fact unchanged');
  assert.equal(rows(h).length,0);assert.equal(puts().length,0);assert.ok(h.document.querySelector('[data-role]'));assertNoDelete();
});

async function compositionRuntime(){
  const source=await oldCash();let state=source.s,seq=0;
  const run=(a,type,p)=>{let result;state=reduce(state,a,type,{requestId:'C03-APP-'+ ++seq,...p},value=>result=value);return result;};
  const buyer={role:'user',userId:'u1'},admin=run(buyer,'account.enter',{accountId:'DEMO-ADMIN',grantId:'DEMO-ADMIN-GRANT'}),account=run(admin,'account.create',{name:'原组成财务运行核验',reason:'合成原权限'}),granted=run(admin,'account.grant',{id:account.id,version:account.version,job:'finance',reason:'原集团财务授权'}),entered=run(buyer,'account.enter',{accountId:account.id,grantId:granted.grants[0].id});
  const actor=resolveAccountActor(state,entered),h=await runtime(state,'#/group/service-finance/entry/'+source.entry.id,{initialActor:actor});return{h,actor};
}
function fillComposition(form){for(const [name,value] of Object.entries({hCents:'14.90',csCents:'29.80',basisReference:'C03-APP-FACT',basisDescription:'本笔原分类依据逐项核验',reason:'本地真实提交链验证'}))form.elements.namedItem(name).value=value;}
test('app C03 实际file选择转evidenceRefs，原SFC同commit附着且坏替换后仍提交原附件',async()=>{
  const {h}=await compositionRuntime(),form=originalForm(h,'finance.composition-confirm');
  await choose(h,form,'[data-invoice-upload]',[pdf('composition')]);const original=form.elements.namedItem('fileRef').value;assert.ok(original,toast(h));
  await choose(h,form,'[data-invoice-upload]',[new File(['broken'],'bad.pdf',{type:'application/pdf'})]);assert.equal(form.elements.namedItem('fileRef').value,original);
  fillComposition(form);const before=ledger(h);h.resetWrites();await submit(h,form);
  assert.equal(rows(h).at(-1).status,'attached',toast(h));assertSingleBusinessAttach(h,before,'serviceFinanceCompositions');
  const result=ledger(h).serviceFinanceCompositions.at(-1);assert.equal(result.evidenceRefs[0].ref,original);assert.deepEqual(ledger(h).bookings,before.bookings);assert.equal(puts().length,1);assertNoDelete();
});
test('app C03 实际原工作会话撤销后不得把原saved附件提交到组成',async()=>{
  const {h,actor}=await compositionRuntime(),form=originalForm(h,'finance.composition-confirm');await choose(h,form,'[data-invoice-upload]',[pdf('composition-revoked')]);
  const next=ledger(h);next.staffSessions.find(row=>row.id===actor.sessionId).revokedAt=next.now;h.authoritative(next);fillComposition(form);await submit(h,form);
  assert.equal(rows(h).at(-1).status,'saved');assert.equal((ledger(h).serviceFinanceCompositions||[]).length,0);assert.match(toast(h),/失效|同步/);assertNoDelete();
});

test('app 原明确Demo reset保留上传历史且使旧claim/ack失效，未知旧session原值保留',async()=>{
  const unknown=KEY+'-management:unknown-reset',h=await runtime(seed(),'#/store/qualifications/lin',{initialActor:{role:'store',storeId:'xingfu'},initialSession:{[unknown]:'UNKNOWN-ORIGINAL'}}),form=originalForm(h,'qualification.assess');
  await choose(h,form,'[data-qualification-upload]',[pdf('reset-retained')]);const reservation=structuredClone(rows(h)[0]);h.window.confirm=()=>true;
  await h.dispatch('click',h.document.querySelector('[data-command="ui.reset"]'));
  assert.equal(rows(h).length,1);assert.equal(rows(h)[0].id,reservation.id);assert.equal(rows(h)[0].usable,false);assert.equal(h.sessionStorage.getItem(unknown),'UNKNOWN-ORIGINAL');
  assert.ok(ledger(h).privacyUploadTabs.every(row=>row.status==='pending'&&row.ackRevision===null));assert.ok(ledger(h).privacyUploadResetSources.length);assert.equal(puts().length,1);assertNoDelete();
});
test('app 原session writer结果journal失败保留实际草稿，新document精准恢复而未知sibling不ack',async()=>{
  const h=await runtime(seed(),'#/group/catalog/product-oil',{initialActor:{role:'group',job:'operations'}}),form=originalForm(h,'manage.product-save');
  const field=form.elements.namedItem('description');field.value='本标签实际保留说明';let refused=false;
  const set=h.localStorage.setItem.bind(h.localStorage);h.localStorage.setItem=(key,value)=>{const next=JSON.parse(value);if(key===KEY&&!refused&&next.privacyUploadTabs?.some(row=>row.operation?.kind==='write'&&row.operation?.status==='readback_verified')&&Object.values(h.sessionStorage).some(value=>value.includes('本标签实际保留说明'))){refused=true;throw Error('isolated result journal quota');}return set(key,value);};
  await h.dispatch('input',field);assert.equal(refused,true);assert.match(toast(h),/草稿同步未完成/);assert.ok(Object.values(h.sessionStorage).some(value=>value.includes('本标签实际保留说明')));
  const session=Object.fromEntries(Object.entries(h.sessionStorage));session[KEY+'-unknown-sibling']='unchanged';
  const refreshed=await runtime(ledger(h),'#/group/catalog/product-oil',{initialActor:{role:'group',job:'operations'},initialSession:session});
  assert.equal(originalForm(refreshed,'manage.product-save').elements.namedItem('description').value,'本标签实际保留说明');assert.equal(refreshed.sessionStorage.getItem(KEY+'-unknown-sibling'),'unchanged');assert.ok(ledger(refreshed).privacyUploadTabs.every(row=>row.ackRevision===null));assertNoDelete();
});

test('app 业务已完成而实际清草稿失败，刷新只补后处理并保留原一次业务/附件',async()=>{
  const h=await runtime(seed(),'#/store/qualifications/lin',{initialActor:{role:'store',storeId:'xingfu'}}),form=originalForm(h,'qualification.assess');await choose(h,form,'[data-qualification-upload]',[pdf('completion')]);fillActualAssessment(form);
  const remove=h.sessionStorage.removeItem.bind(h.sessionStorage);Object.defineProperty(h.sessionStorage,'removeItem',{value:key=>{if(key.startsWith(KEY+'-management:')||key.startsWith(KEY+'-request:'))throw Error('isolated session remove quota');return remove(key);}});
  await submit(h,form);const committed=ledger(h);assert.equal(committed.techQualifications.at(-1).assessments.length,1);assert.equal(rows(h)[0].status,'attached');assert.match(toast(h),/业务已完成.*待重试/);assert.ok(committed.privacyUploadSessionCompletions.length);
  const session=Object.fromEntries(Object.entries(h.sessionStorage)),oldKeys=Object.keys(session).filter(key=>key.startsWith(KEY+'-management:')||key.startsWith(KEY+'-request:'));
  const refreshed=await runtime(committed,'#/store/qualifications/lin',{initialActor:{role:'store',storeId:'xingfu'},initialSession:session});
  assert.ok(oldKeys.every(key=>refreshed.sessionStorage.getItem(key)===null));assert.deepEqual(ledger(refreshed).techQualifications,committed.techQualifications);assert.deepEqual(ledger(refreshed).techQualificationRequests,committed.techQualificationRequests);assert.equal(puts().length,1);assertNoDelete();
});

test('app 原五步预约的实际控件writer连续保存，刷新恢复后同一请求创建并付款',async()=>{
  let h=await runtime(seed(),'#/user/booking/region');
  const choosePatch=async wanted=>{const button=h.document.querySelectorAll('[data-command="ui.booking"]').find(node=>Object.entries(wanted).every(([key,value])=>JSON.parse(node.dataset.payload).patch?.[key]===value));assert.ok(button,'original choice '+JSON.stringify(wanted));await h.dispatch('click',button);await h.render();};
  await choosePatch({regionId:'home'});await choosePatch({storeId:'xingfu'});await choosePatch({mode:'nearest'});await choosePatch({techId:'lin'});
  const slot=h.document.querySelectorAll('[data-command="ui.booking"]').find(node=>JSON.parse(node.dataset.payload).patch?.startAt);assert.ok(slot);await h.dispatch('click',slot);await h.render();
  const contact=h.document.querySelector('a[href="#/user/booking/contact"]');assert.ok(contact);h.location.hash=contact.getAttribute('href');await h.render();
  let form=originalForm(h,'ui.booking');for(const [name,value] of Object.entries({contactName:'合成预约联系人',phone:'13800000001'})){const field=form.elements.namedItem(name);field.value=value;await h.dispatch('input',field);}
  for(const [name,value] of Object.entries({recipientId:'visit',recipientKind:'self'})){form=originalForm(h,'ui.booking');const field=form.elements.namedItem(name);field.value=value;await h.dispatch('change',field);}
  form=originalForm(h,'ui.booking');form.elements.namedItem('recipientName').value='合成对象';await h.dispatch('input',form.elements.namedItem('recipientName'));form.elements.namedItem('recipientConfirmed').checked=true;await h.dispatch('change',form.elements.namedItem('recipientConfirmed'));
  const id=JSON.parse(h.sessionStorage.getItem(DRAFT)).requestId;
  h=await runtime(ledger(h),h.location.hash,{initialSession:Object.fromEntries(Object.entries(h.sessionStorage))});form=originalForm(h,'ui.booking');assert.equal(form.elements.namedItem('phone').value,'13800000001');await submit(h,form);await h.render();
  assert.equal(h.location.hash,'/user/booking/identity',toast(h));form=originalForm(h,'ui.booking');form.elements.namedItem('identityConsent').checked=true;await h.dispatch('change',form.elements.namedItem('identityConsent'));await submit(h,form);await h.render();
  form=originalForm(h,'ui.booking');for(const name of ['adultConfirmed','healthConsent']){form.elements.namedItem(name).checked=true;await h.dispatch('change',form.elements.namedItem(name));}await submit(h,form);await h.render();
  const pay=h.document.querySelector('[data-command="ui.booking-submit"]');assert.ok(pay,h.document.textContent);await h.dispatch('click',pay);
  assert.equal(ledger(h).bookings.length,1,toast(h));assert.equal(ledger(h).bookings[0].requestId,id);assert.equal(ledger(h).bookings[0].payment.status,'success');assert.equal(JSON.parse(h.sessionStorage.getItem(DRAFT)).submittedId,ledger(h).bookings[0].id);assertNoDelete();
});

test('app 原预约input的pending写失败保留实际输入和原草稿，明确反馈后可重试',async()=>{
  const h=await runtime(seed(),'#/user/booking/slots'),draft=JSON.parse(h.sessionStorage.getItem(DRAFT));
  const date=h.document.querySelector('[data-booking-field="date"]');assert.ok(date);const prior=h.sessionStorage.getItem(DRAFT);date.value=date.querySelectorAll('option')[1].getAttribute('value');
  const set=h.localStorage.setItem.bind(h.localStorage);let refused=false;h.localStorage.setItem=(key,value)=>{if(!refused&&JSON.parse(value).privacyUploadTabs?.some(row=>row.operation?.kind==='write'&&row.operation?.status==='preparing')){refused=true;throw Error('isolated pending quota');}return set(key,value);};
  await h.dispatch('change',date);assert.equal(refused,true);assert.equal(h.sessionStorage.getItem(DRAFT),prior);assert.match(toast(h),/预约草稿同步未完成/);assert.ok(date.isConnected);
  await h.dispatch('change',date);assert.notEqual(JSON.parse(h.sessionStorage.getItem(DRAFT)).date,draft.date);assert.equal((ledger(h).bookings||[]).length,0);
});

test('app 原资格考核后的申请和集团审核使用准确assessment/grant来源writer',async()=>{
  const h=await runtime(seed(),'#/store/qualifications/lin',{initialActor:{role:'store',storeId:'xingfu'}});let form=originalForm(h,'qualification.assess');fillActualAssessment(form);await submit(h,form);
  form=originalForm(h,'qualification.request');form.elements.namedItem('reason').value='原通过考核申请';await submit(h,form);assert.equal(ledger(h).techQualifications.at(-1).grants.length,1,toast(h));
  const group=await runtime(ledger(h),'#/group/qualifications/lin',{initialActor:{role:'group',job:'operations'}}),review=originalForm(group,'qualification.review');for(const [key,value] of Object.entries({decision:'reject',reviewer:'原审核样本',proof:'GRANT-ORIGINAL',reason:'原材料核对结论'}))review.elements.namedItem(key).value=value;
  await submit(group,review);assert.equal(ledger(group).techQualifications.at(-1).grants[0].status,'rejected',toast(group));assertNoDelete();
});
test('app 普通财务原任务进入及新document返回保留准确客户来源和原筛选',async()=>{
  const f=completedBooking(),actor={role:'group',job:'finance'},list='/group/tasks?category=service-finance-entry&status=waiting',h=await runtime(f.ledger,'#'+list,{initialActor:actor});
  const entry=ledger(h).serviceFinanceEntries.find(x=>x.bookingId===f.id),button=h.document.querySelectorAll('[data-command="ui.task-open"]').find(node=>JSON.parse(node.dataset.payload).taskKey==='service-finance:entry:'+entry.id);assert.ok(button,'original ordinary finance task');await h.dispatch('click',button);
  assert.equal(h.location.hash,'/group/service-finance/entry/'+entry.id,toast(h));const key=Object.keys(h.sessionStorage).find(k=>k.startsWith(KEY+'-task-return:'));assert.ok(key);const task=JSON.parse(h.sessionStorage.getItem(key));
  assert.equal(task.listHash,list);const manifest=ledger(h).privacyUploadTabs.flatMap(row=>row.manifest?.entries||[]).filter(x=>x.kind==='task-context');assert.ok(manifest.some(x=>x.subjects.some(p=>p.kind==='user'&&p.id==='u1')));assert.ok(manifest.some(x=>x.roots.some(p=>p.kind==='service-finance-entry'&&p.id===entry.id)));
  const refreshed=await runtime(ledger(h),h.location.hash,{initialActor:actor,initialSession:Object.fromEntries(Object.entries(h.sessionStorage)),initialHistory:structuredClone(h.history.state)}),back=refreshed.document.querySelector('[data-command="ui.task-return"]');assert.ok(back);await refreshed.dispatch('click',back);assert.equal(refreshed.location.hash,list,toast(refreshed));assertNoDelete();
});
for(const family of ['care','invoice','agreement','product'])test('app 新document恢复原'+family+'附件后实际提交，无再次put且原作者/选择不改',async()=>{
  const f=family==='care'?completedBooking():family==='invoice'?invoiceFixture():{ledger:seed()},actor=family==='care'?undefined:family==='invoice'?f.actor:{role:'group',job:'operations'};
  const path=family==='care'?'#/user/care/new?bookingId='+f.id:family==='invoice'?'#/store/invoices/'+f.id:family==='agreement'?'#/group/service-promotion/agreements':'#/group/catalog/new',command={care:'care.case-create',invoice:'invoice.issue',agreement:'service-promotion.agreement-publish',product:'manage.product-save'}[family];
  let h=await runtime(f.ledger,path,{initialActor:actor}),form=originalForm(h,command);await choose(h,form,family==='care'?'[data-care-upload]':family==='product'?'[data-image-upload="image"]':'[data-invoice-upload]',[family==='care'||family==='product'?image():pdf('resume-'+family)]);
  if(family==='product')await choose(h,form,'[data-image-upload="gallery2"]',[image()]);const saved=structuredClone(rows(h)),putCount=puts().length,requestId=JSON.parse(form.dataset.payload).requestId;
  h=await runtime(ledger(h),path,{initialActor:actor,initialSession:Object.fromEntries(Object.entries(h.sessionStorage))});form=originalForm(h,command);
  assert.equal(form._uploadRestoreError,undefined,JSON.stringify({family,error:form._uploadRestoreError,toast:toast(h),payload:form.dataset.payload}));
  if(family==='invoice'||family==='agreement'){assert.equal(form.elements.namedItem('fileType').value,'application/pdf',JSON.stringify({family,toast:toast(h),fields:['fileRef','fileName','fileType','fileSize'].map(k=>[k,form.elements.namedItem(k).value])}));assert.ok(Number(form.elements.namedItem('fileSize').value)>0);}
  const values=family==='care'?{category:'quality',description:'刷新后原投诉'}:family==='invoice'?{ticketNumber:'RESUMED-BLUE'}:family==='agreement'?{title:'刷新后原协议',body:'原条款仍在',effectiveAt:new Date(ledger(h).now+8*3600000).toISOString().slice(0,16),reference:'RESUMED-AGREEMENT',occurredAt:'2026-10-02T08:30',reason:'原协议恢复'}:{name:'刷新后原商品',categoryId:ledger(h).categories[0].id,summary:'原主图与非连续相册',description:'原详情',reason:'原图核验',skuName:'原规格',priceCents:'10',stock:'10',weightGrams:'100'};
  for(const [name,value] of Object.entries(values)){const field=form.elements.namedItem(name);if(field)field.value=value;}await submit(h,form);
  assert.equal(rows(h).length,saved.length);assert.ok(rows(h).every(row=>row.status==='attached'),toast(h));assert.equal(puts().length,putCount);for(const before of saved){const after=rows(h).find(row=>row.id===before.id);assert.deepEqual(after.selection,before.selection);assert.deepEqual(after.uploadedBy,before.uploadedBy);assert.ok(after.activeClaim);}
  if(family==='agreement')assert.equal(ledger(h).servicePromotionRequests.at(-1).requestId,requestId);if(family==='product')assert.equal(ledger(h).products.at(-1).gallery.length,1);assertNoDelete();
});
