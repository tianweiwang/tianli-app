import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Script, createContext } from 'node:vm';
import { webcrypto, createHash } from 'node:crypto';
import { seed, reduce } from './engine.mjs';
import { createLifecycleContext } from './engine.mjs';
import { accountUiView, accountExitTarget } from './accounts-ui.mjs';
import { resolveAccountActor } from './staff-accounts.mjs';
import { lifecycleImpact } from './organization-lifecycle-projection.mjs';
import { lifecycleCompletionView } from './organization-lifecycle.mjs';
import { lifecycleHandoverCommands } from './organization-lifecycle-authority.mjs';

// Runtime unit only: execute the actual app body and its registered handlers.
// The DOM/Storage subset below has no layout, browser navigation, or file download.
// Imports are rebound to their original exports; privacy/business logic is not copied.
const KEY = 'tianli-integrated-v5';
const DRAFT = KEY + '-booking-draft:u1';
const RESULT = KEY + '-booking-result';
const appUrl = new URL('./app.mjs', import.meta.url);
const baseline=process.env.TIANLI_CLOSED_ENTRY_BASELINE==='1';
const before=baseline?JSON.parse(await readFile(new URL('./verification/pilot-batch10-lifecycle/closed-store-login-before.json',import.meta.url),'utf8').then(value=>value.replace(/^\uFEFF/,''))):null;
async function originalBackup(name){const record=before.files.find(x=>x.source.endsWith(name));const bytes=await readFile(record.backup);assert.equal(createHash('sha256').update(bytes).digest('hex').toUpperCase(),record.sha256);return bytes.toString('utf8');}
const appSource = baseline?await originalBackup('app.mjs'):await readFile(appUrl, 'utf8');
let originalAccounts;
if(baseline){const source=await originalBackup('accounts-ui.mjs');const linked=source.replace(/from (['"])(\.\/[^'"]+)\1/g,(_,quote,path)=>'from '+quote+new URL(path,appUrl).href+quote);originalAccounts=await import('data:text/javascript,'+encodeURIComponent(linked));}
const imported = {};
const importDeclarations = [...appSource.matchAll(/^import\s+\{([^}]+)\}\s+from\s+(['"])([^'"]+)\2;\s*$/gm)];
for (const declaration of importDeclarations) {
  const module = baseline&&declaration[3]==='./accounts-ui.mjs'?originalAccounts:await import(new URL(declaration[3], appUrl));
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

async function runtime(ledger = seed(), hash = '#/user/home', { initialActor, apiOverrides = {}, locks } = {}) {
  const document = new Document(), window = new Node('#window', document);
  window.scrollTo = () => {};
  const localStorage = new Storage({ [KEY]: JSON.stringify(ledger) });
  const sessionStorage = new Storage({ [RESULT]: 'success' });
  if(initialActor)sessionStorage.setItem(KEY+'-actor',JSON.stringify(initialActor));
  const location = { hash, origin: 'http://127.0.0.1:4204', pathname: '/' };
  const history = { state: null, replaceState(value, _title, url) { this.state = value; if (url?.includes('#')) location.hash = url.slice(url.indexOf('#')); } };
  const errors = [], timers = new Map(); let nextTimer = 0;
  const context = createContext({
    ...imported,
    // Original module default parameters use their own realm: pass this DOM explicitly.
    hydrateMedia: () => imported.hydrateMedia(document),
    ...apiOverrides,
    document, window, localStorage, sessionStorage, location, history,
    navigator: {locks}, crypto: webcrypto, URL, Blob, Event, FormData: FormDataSubset, TextEncoder, TextDecoder, structuredClone,
    setTimeout: callback => { timers.set(++nextTimer, callback); return nextTimer; }, clearTimeout: id => timers.delete(id),
    console: { error: error => errors.push(error), log() {}, warn: message => errors.push(message) },
  });
  await appScript.runInContext(context);
  assert.deepEqual(errors, [], 'initial render must execute without swallowed runtime errors');
  return {
    document, window, sessionStorage, localStorage, location, errors,
    authoritative(next) { localStorage.setItem(KEY, JSON.stringify(next)); },
    resetWrites() { localStorage.writes.length = 0; sessionStorage.writes.length = 0; },
    async dispatch(type, target) {
      assert.ok(target.isConnected, 'event starts on a connected old page node');
      const event = await document.emit(type, target);
      // App submit starts execute without awaiting it. Flush its original async
      // evidence/transaction microtasks before examining persisted state.
      await new Promise(setImmediate);
      return event;
    },
    async render() { return window.emit('hashchange', window); },
  };
}

function entryFixture() {
  let ledger = seed(), seq = 0;
  const run = (actor,type,p={}) => { let result; ledger=reduce(ledger,actor,type,{requestId:'closed-entry-'+ ++seq,reason:'合成运行单元原来源依据',...p},value=>result=value);return result; };
  run({role:'user',userId:'u1'},'clock.advance',{minutes:1});
  const admin=run({role:'group'},'account.enter',{accountId:'DEMO-ADMIN',grantId:'DEMO-ADMIN-GRANT'});
  const staff=(job,storeId)=>{
    let account=run(admin,'account.create',{name:'原岗位运行单元'+job});
    account=run(admin,'account.employment',{id:account.id,version:account.version,employmentStatus:'active',reference:'ACTUAL-EMPLOYMENT-'+account.id,verifiedAt:ledger.now});
    account=run(admin,'account.grant',{id:account.id,version:account.version,job,...(storeId?{storeId}:{})});
    const grant=account.grants.at(-1),actor=run({role:'group'},'account.enter',{accountId:account.id,grantId:grant.id});
    return {id:account.id,grantId:grant.id,actor,job,storeId};
  };
  const operator=staff('operations'),members=[staff('support'),staff('finance'),staff('store-finance','xingfu')],ordinary=staff('store-manager','xingfu'),other=staff('store-finance','silver');
  const raw={role:'store',storeId:'xingfu'};
  const close=()=>{
    const store=ledger.stores.find(s=>s.id==='xingfu'),impact=lifecycleImpact(ledger,{storeId:store.id},createLifecycleContext());
    const c=run(operator.actor,'lifecycle.store-close-start',{storeId:store.id,version:store.version,sourceToken:impact.sourceToken,reference:'ACTUAL-CASE-ENTRY'});
    for(const member of members){
      const account=ledger.staffAccounts.find(a=>a.id===member.id),h=run(admin,'account.handover',{caseId:c.id,caseVersion:c.version,accountId:member.id,accountVersion:account.version,grantId:member.grantId,storeId:'xingfu',allowedCommands:lifecycleHandoverCommands(member.job),reference:'ACTUAL-HANDOVER-'+member.id});
      run(member.actor,'account.handover-accept',{id:h.id,version:h.version,reference:'ACTUAL-SELF-ACCEPT-'+h.id});
    }
    const current=ledger.organizationLifecycleCases.find(x=>x.id===c.id),view=lifecycleCompletionView(ledger,c.id,createLifecycleContext());
    assert.equal(view.canComplete,true);
    run(operator.actor,'lifecycle.complete',{id:c.id,version:current.version,sourceToken:view.sourceToken});
    assert.equal(ledger.stores.find(s=>s.id==='xingfu').lifecycleStatus,'closed');
  };
  return {get ledger(){return ledger;},set ledger(value){ledger=structuredClone(value);},raw,admin,operator,members,ordinary,other,run,close};
}
const entryPayload = form => JSON.parse(form.dataset.payload);
const entries = h => h.document.querySelectorAll('form[data-command="account.enter"]');
const actorStored = h => JSON.parse(h.sessionStorage.getItem(KEY+'-actor'));
const ledgerStored = h => JSON.parse(h.localStorage.getItem(KEY));
function forgedEntry(h,p,type='account.enter'){
  const form=h.document.createElement('form');form.dataset.command=type;form.dataset.managementForm='account:source-negative';form.dataset.payload=JSON.stringify(p);h.document.querySelector('main').append(form);return form;
}

test('actual close invalidates the old session while the exact no-session store login exposes only its live retained grant',async()=>{
  const f=entryFixture();f.close();const before=structuredClone(f.ledger);
  assert.throws(()=>resolveAccountActor(f.ledger,f.members[2].actor),/失效/);
  assert.throws(()=>resolveAccountActor(f.ledger,f.raw),/已关闭/);
  const h=await runtime(f.ledger,'#/store/work-login',{initialActor:f.raw});
  assert.deepEqual(entries(h).map(entryPayload),[{accountId:f.members[2].id,grantId:f.members[2].grantId}]);
  assert.ok(h.document.querySelector('.surface.desktop-surface > main'),'isolated login reuses the original surface padding');
  assert.ok(!h.document.textContent.includes('工作会话已失效'));assert.deepEqual(f.ledger,before);
  assert.ok(!h.document.textContent.includes('ACTUAL-EMPLOYMENT'));assert.ok(!h.document.textContent.includes('ACTUAL-HANDOVER'));assert.ok(!h.document.textContent.includes('ACTUAL-CASE-ENTRY'));
  assert.deepEqual(actorStored(h).storeId,'xingfu');
});

test('the original public Demo enter requires no existing work permission and actual closed entry yields only the retained store actor',async()=>{
  const f=entryFixture();f.close();
  // Existing domain accepts a public group Demo entry; no working grant is fabricated.
  const original=f.run({role:'group'},'account.enter',{accountId:f.members[2].id,grantId:f.members[2].grantId});
  assert.equal(resolveAccountActor(f.ledger,original).lifecyclePurpose,'lifecycle-settlement');
  const h=await runtime(f.ledger,'#/store/work-login',{initialActor:f.raw}),entry=entries(h)[0];assert.ok(entry);
  await h.dispatch('submit',entry);
  const actor=actorStored(h),actual=resolveAccountActor(ledgerStored(h),actor);
  assert.equal(actual.storeId,'xingfu');assert.equal(actual.grantId,f.members[2].grantId);assert.equal(actual.lifecyclePurpose,'lifecycle-settlement');
  assert.equal(h.location.hash,'/store/dashboard');assert.ok(!h.document.textContent.includes('工作会话已失效'));
});

test('a revoked old session must explicitly leave before selecting a role; closed return reaches the same store entry without a loop',async()=>{
  const f=entryFixture();f.close();const old=resolveAccountActor;
  assert.throws(()=>old(f.ledger,f.members[2].actor),/失效/);
  const h=await runtime(f.ledger,'#/store/work-login',{initialActor:{...f.raw,...f.members[2].actor}});
  assert.equal(entries(h).length,0);assert.ok(h.document.textContent.includes('工作会话已失效'));
  const exit=h.document.querySelectorAll('[data-command="ui.account-exit"]')[0];assert.ok(exit);await h.dispatch('click',exit);
  assert.equal(actorStored(h).sessionId,undefined);assert.equal(actorStored(h).storeId,'xingfu');
  assert.equal(h.location.hash,'/store/work-login');assert.equal(entries(h).length,1);
});

test('closed business routes and work-login subroutes remain blocked while the safe home exit can actually render',async()=>{
  const f=entryFixture();f.close();
  for(const route of ['#/store/dashboard','#/store/invoices','#/store/work-login/extra']){
    const h=await runtime(f.ledger,route,{initialActor:f.raw});assert.equal(entries(h).length,0);assert.ok(h.document.textContent.includes('门店已关闭'));
  }
  const h=await runtime(f.ledger,'#/store/work-login',{initialActor:f.raw});h.location.hash='#/user/home';await h.render();
  assert.equal(actorStored(h).role,'user');assert.equal(actorStored(h).storeId,'xingfu');assert.ok(!h.document.textContent.includes('门店已关闭'));
});

test('the ordinary open-store entry and existing return target stay unchanged',async()=>{
  const f=entryFixture(),h=await runtime(f.ledger,'#/store/work-login',{initialActor:f.raw});
  assert.deepEqual(entries(h).map(entryPayload).map(p=>p.grantId).sort(),[f.members[2].grantId,f.ordinary.grantId].sort());
  assert.deepEqual(accountExitTarget(f.ledger,resolveAccountActor(f.ledger,f.members[2].actor)),{actor:{role:'store',storeId:'xingfu'},path:'/store/dashboard'});
  assert.match(accountUiView(f.ledger,f.raw,['work-login']),/门店后台岗位演示/);
});

test('closed entry rejects another store, ordinary or invented grants, and never replaces the actor for a non-enter command',async()=>{
  const f=entryFixture();f.close();
  for(const [type,payload] of [
    ['account.enter',{accountId:f.other.id,grantId:f.other.grantId}],
    ['account.enter',{accountId:f.ordinary.id,grantId:f.ordinary.grantId}],
    ['account.enter',{accountId:f.members[2].id,grantId:'INVENTED-GRANT'}],
    ['account.enter',{accountId:'INVENTED-ACCOUNT',grantId:f.members[2].grantId}],
    ['account.create',{name:'不得借登录管理账号',reason:'原越权负例'}]
  ]){
    const h=await runtime(f.ledger,'#/store/work-login',{initialActor:f.raw}),before=ledgerStored(h);
    await h.dispatch('submit',forgedEntry(h,payload,type));
    assert.deepEqual(ledgerStored(h),before);assert.equal(actorStored(h).role,'store');assert.equal(actorStored(h).sessionId,undefined);
  }
});

test('a rendered selection is rechecked after actual account revocation, and stale sessions cannot use a forged enter form',async()=>{
  const f=entryFixture();f.close();const h=await runtime(f.ledger,'#/store/work-login',{initialActor:f.raw}),entry=entries(h)[0];assert.ok(entry);
  const account=f.ledger.staffAccounts.find(a=>a.id===f.members[2].id);
  f.run(f.admin,'account.revoke',{id:account.id,version:account.version,grantId:f.members[2].grantId});h.authoritative(f.ledger);
  const before=ledgerStored(h);await h.dispatch('submit',entry);assert.deepEqual(ledgerStored(h),before);assert.equal(actorStored(h).sessionId,undefined);
  const old=await runtime(f.ledger,'#/store/work-login',{initialActor:{...f.raw,...f.members[2].actor}}),oldBefore=ledgerStored(old);
  await old.dispatch('submit',forgedEntry(old,{accountId:f.other.id,grantId:f.other.grantId}));assert.deepEqual(ledgerStored(old),oldBefore);assert.equal(actorStored(old).sessionId,f.members[2].actor.sessionId);
});

test('only the exact login path without stray account identifiers can use the closed entry projection',async()=>{
  const f=entryFixture();f.close();
  for(const route of ['#/store/dashboard','#/store/work-login/extra','#/store//work-login','#https://other-origin.invalid/store/work-login']){
    const h=await runtime(f.ledger,route,{initialActor:f.raw}),before=ledgerStored(h);
    await h.dispatch('submit',forgedEntry(h,{accountId:f.members[2].id,grantId:f.members[2].grantId}));assert.deepEqual(ledgerStored(h),before);assert.equal(actorStored(h).sessionId,undefined);
  }
  for(const raw of [{...f.raw,accountId:f.members[2].id},{...f.raw,grantId:f.members[2].grantId}]){
    const h=await runtime(f.ledger,'#/store/work-login',{initialActor:raw});assert.equal(entries(h).length,0);assert.ok(h.document.textContent.includes('工作会话缺失'));
  }
});

test('damaged or duplicate original source cannot downgrade into a public group or ordinary store login list',async()=>{
  const f=entryFixture();f.close();
  for(const mutate of [s=>s.stores.push(structuredClone(s.stores.find(x=>x.id==='xingfu'))),s=>s.staffAccounts.push(structuredClone(s.staffAccounts[0])),s=>{s.staffAccounts.find(x=>x.id===f.members[2].id).grants.push(structuredClone(s.staffAccounts.find(x=>x.id===f.members[2].id).grants[0]));},s=>{s.organizationAuthorityHandovers=null;}]){
    const bad=structuredClone(f.ledger);mutate(bad);const h=await runtime(bad,'#/store/work-login',{initialActor:f.raw});
    assert.equal(entries(h).length,0);assert.ok(!h.document.textContent.includes('集团后台岗位演示'));assert.equal(actorStored(h).role,'store');assert.equal(actorStored(h).sessionId,undefined);
  }
});

test('the actual retained session can exit to its original role entry or Demo home and return with the store preserved',async()=>{
  const f=entryFixture();f.close();
  for(const destination of ['dashboard','work-login','home']){
    const h=await runtime(f.ledger,'#/store/work-login',{initialActor:f.raw});await h.dispatch('submit',entries(h)[0]);const entered=actorStored(h);
    const button=h.document.querySelectorAll('[data-command="ui.account-exit"]').find(node=>JSON.parse(node.dataset.payload).destination===destination);assert.ok(button);
    await h.dispatch('click',button);assert.equal(actorStored(h).sessionId,undefined);assert.equal(actorStored(h).storeId,'xingfu');assert.throws(()=>resolveAccountActor(ledgerStored(h),entered),/失效/);
    assert.equal(h.location.hash,destination==='home'?'/user/home':'/store/work-login');assert.ok(!h.document.textContent.includes('工作会话已失效'));
    h.location.hash='#/store/work-login';await h.render();assert.equal(entries(h).length,1);assert.equal(actorStored(h).storeId,'xingfu');
  }
});

test('the async pre-submit boundary cannot create a session after the exact page context changes',async()=>{
  const f=entryFixture();f.close();let h;
  h=await runtime(f.ledger,'#/store/work-login',{initialActor:f.raw,apiOverrides:{prepareCareEvidence:async()=>{h.location.hash='#/store/invoices';return {evidenceRefs:[]};}}});
  const before=ledgerStored(h);await h.dispatch('submit',entries(h)[0]);
  assert.deepEqual(ledgerStored(h),before);assert.equal(actorStored(h).sessionId,undefined);assert.equal(actorStored(h).storeId,'xingfu');
});

test('free Demo can explicitly switch away from its actually closed store without changing any business ledger',async()=>{
  const f=entryFixture();f.close();
  for(const role of ['store','manager']){
    const h=await runtime(f.ledger,`#/${role}/dashboard`,{initialActor:{...f.raw,role}}),before=ledgerStored(h);
    const select=h.document.querySelector('select[data-identity="storeId"]');assert.ok(select,'closed free Demo must retain an explicit store selector');
    assert.equal(select.value,'','render must not silently choose another store');
    assert.equal(actorStored(h).storeId,'xingfu');
    assert.ok(!select.querySelectorAll('option').some(x=>x.value==='xingfu'));
    assert.ok(select.querySelectorAll('option').some(x=>x.value==='silver'));
    assert.ok(h.document.querySelector('[role="status"]'));assert.equal(entries(h).length,0);
    select.value='silver';await h.dispatch('change',select);
    assert.equal(actorStored(h).role,role);assert.equal(actorStored(h).storeId,'silver');assert.equal(actorStored(h).sessionId,undefined);
    assert.equal(h.location.hash,`/${role}/dashboard`);assert.ok(!h.document.textContent.includes('当前门店已关闭'));
    assert.deepEqual(ledgerStored(h),before);assert.equal(resolveAccountActor(ledgerStored(h),actorStored(h)).storeId,'silver');
  }
});

test('free Demo recovery excludes nonunique and closed candidates, retains manageable paused stores and escapes names',async()=>{
  const f=entryFixture();f.close();const s=structuredClone(f.ledger);
  s.stores.push(structuredClone(s.stores.find(x=>x.id==='silver')));
  const yuan=s.stores.find(x=>x.id==='yuan');assert.ok(yuan);yuan.active=false;yuan.name='<img src=x onerror=alert(1)>';
  s.stores.push({id:'legacy-closed',name:'旧关闭来源',closedAt:0},{id:'',name:'缺少编号'});
  const h=await runtime(s,'#/store/dashboard',{initialActor:f.raw}),select=h.document.querySelector('select[data-identity="storeId"]');assert.ok(select);
  assert.deepEqual(select.querySelectorAll('option').map(x=>x.value),['','yuan']);
  assert.ok(!select.querySelector('img'));assert.ok(select.textContent.includes('<img src=x onerror=alert(1)>'));
  const unavailable=structuredClone(f.ledger);for(const store of unavailable.stores.filter(x=>x.id!=='xingfu'))store.closedAt=0;
  const none=await runtime(unavailable,'#/store/dashboard',{initialActor:f.raw});
  assert.equal(none.document.querySelector('select[data-identity="storeId"]'),null);assert.match(none.document.textContent,/暂无可切换的其他门店/);
  assert.ok(none.document.querySelector('a[href="#/user/home"]'));assert.ok(none.document.querySelector('a[href="#/store/work-login"]'));
});

test('closed store recovery never offers identity switching for real, revoked or incomplete work identities',async()=>{
  const f=entryFixture();f.close();
  for(const raw of [f.members[2].actor,f.ordinary.actor,{...f.raw,accountId:f.members[2].id},{...f.raw,grantId:f.members[2].grantId}]){
    const h=await runtime(f.ledger,'#/store/dashboard',{initialActor:raw});
    assert.equal(h.document.querySelector('[data-identity]'),null);assert.match(h.document.textContent,/工作会话已失效/);
    assert.ok(h.document.querySelector('[data-command="ui.account-exit"]'));
  }
  const active=f.run({role:'group'},'account.enter',{accountId:f.members[2].id,grantId:f.members[2].grantId});
  const h=await runtime(f.ledger,'#/store/work-login',{initialActor:active});
  assert.equal(h.document.querySelector('select[data-identity="storeId"]'),null);assert.match(h.document.textContent,/当前工作身份/);
});



test('H.2 reliable KEY lock retains actual closed-store entry, explicit exit and a fresh second login',async()=>{
  const f=entryFixture();f.close();let active=false,calls=0;
  const locks={async request(key,fn){assert.equal(key,KEY);assert.equal(active,false,'closed transition never nests its original KEY lock');active=true;calls++;try{return await fn();}finally{active=false;}}};
  const h=await runtime(f.ledger,'#/store/work-login',{initialActor:f.raw,locks});
  await h.dispatch('submit',entries(h)[0]);const first=actorStored(h);assert.ok(first.sessionId,h.document.getElementById('toast').textContent);
  assert.equal(resolveAccountActor(ledgerStored(h),first).lifecyclePurpose,'lifecycle-settlement');
  const exit=h.document.querySelector('[data-command="ui.account-exit"]');assert.ok(exit);await h.dispatch('click',exit);
  assert.equal(actorStored(h).sessionId,undefined);assert.equal(h.location.hash,'/store/work-login');
  await h.dispatch('submit',entries(h)[0]);const second=actorStored(h);assert.ok(second.sessionId,h.document.getElementById('toast').textContent);assert.notEqual(second.sessionId,first.sessionId);
  assert.ok(calls>0);assert.equal(ledgerStored(h).privacyUploadProtocolSources,undefined);
});
