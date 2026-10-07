import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Script, createContext } from 'node:vm';
import { webcrypto } from 'node:crypto';
import { seed, reduce, createLifecycleContext } from './engine.mjs';
import { lifecycleImpact, lifecycleCaseImpact } from './organization-lifecycle-projection.mjs';
import { lifecycleCompletionView } from './organization-lifecycle.mjs';
import { lifecycleHandoverCommands } from './organization-lifecycle-authority.mjs';
import { fulfilmentBindingToken } from './fulfilment.mjs';
import { servicePromotionBalanceToken } from './service-promotion.mjs';
import { prepareServicePromotionEvidence } from './service-promotion-file-validation.mjs';
import { authorizedInvoiceFile, validateInvoiceFile } from './invoice-files.mjs';
import { createTechHistoricalRightsAdapters } from './tech-historical-rights.mjs';
import { createHash } from 'node:crypto';

// Runtime unit only: execute the actual app body and its registered handlers.
// The DOM/Storage subset below has no layout, browser navigation, or file download.
// Imports are rebound to their original exports; privacy/business logic is not copied.
const KEY = 'tianli-integrated-v5';
const DRAFT = KEY + '-booking-draft:u1';
const RESULT = KEY + '-booking-result';
const appUrl = new URL('./app.mjs', import.meta.url);
const appSource = await readFile(appUrl, 'utf8');
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

async function runtime(ledger = seed(), hash = '#/user/home', { initialActor, apiOverrides = {} } = {}) {
  const document = new Document(), window = new Node('#window', document);
  window.scrollTo = () => {};
  const localStorage = new Storage({ [KEY]: JSON.stringify(ledger) });
  const sessionStorage = new Storage({ [RESULT]: 'success' });
  if(initialActor)sessionStorage.setItem(KEY+'-actor',JSON.stringify(initialActor));
  let currentHash=hash;
  const location = {get hash(){return currentHash;},set hash(value){currentHash=value.startsWith('#')?value:'#'+value;},origin:'http://127.0.0.1:4204',pathname:'/'};
  const history = { state: null, replaceState(value, _title, url) { this.state = value; if (url?.includes('#')) location.hash = url.slice(url.indexOf('#')); } };
  const errors = [], timers = new Map(); let nextTimer = 0;
  const context = createContext({
    ...imported,
    // Original module default parameters use their own realm: pass this DOM explicitly.
    hydrateMedia: () => imported.hydrateMedia(document),
    ...apiOverrides,
    document, window, localStorage, sessionStorage, location, history,
    navigator: {}, crypto: webcrypto, URL, Blob, Event, FormData: FormDataSubset, TextEncoder, TextDecoder, structuredClone,
    setTimeout: callback => { timers.set(++nextTimer, callback); return nextTimer; }, clearTimeout: id => timers.delete(id),
    console: { error: error => errors.push(error), log() {}, warn: message => errors.push(message) },
  });
  await appScript.runInContext(context);
  assert.deepEqual(errors, [], 'initial render must execute without swallowed runtime errors');
  return {
    document, window, sessionStorage, localStorage, errors, location,
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

const MIN = 60000, DAY = 86400000;
const owner = {role:'user',userId:'u2',techId:'lin',storeId:'silver'};
const customer = {role:'user',userId:'u1'}, ops = {role:'group',job:'operations'}, support = {role:'group',job:'support'}, finance = {role:'group',job:'finance'};
const store = {role:'store',storeId:'xingfu'};
const proofBytes = new TextEncoder().encode('%PDF-1.4\nActual shared historical rights source\n%%EOF');
const proofBlob = new Blob([proofBytes], {type:'application/pdf'});
const proofFile = {ref:'invoice-file:'+createHash('sha256').update(proofBytes).digest('hex'),name:'共享原来源合成凭证.pdf',type:proofBlob.type,size:proofBlob.size};
const adapters = createTechHistoricalRightsAdapters();
const appLedger = a => JSON.parse(a.localStorage.getItem(KEY));
const appText = a => a.document.getElementById('app').textContent;
const toastText = a => a.document.getElementById('toast').textContent;
const appForm = (a, op) => a.document.querySelector(`form[data-command="service-promotion.${op}"]`);
const sourcePayload = form => JSON.parse(form.dataset.payload);
const nativeWithdrawal = s => s.servicePromotionWithdrawals.at(-1);
const historicalPath = (section,id='') => '#/user/tech-rights/promotion/'+section+(id?'/'+id:'');

// All positive business rows below are generated by original reduce commands.
// The single cached fixture is cloned per test, never changed in place.
async function createFixture() {
  let s=seed(),n=0;
  const proof = (reference='INTERNAL-PROOF-'+ ++n) => ({reference,occurredAt:s.now,file:proofFile,reason:'INTERNAL-EVIDENCE-BODY'});
  async function op(type,p={},actor=finance) {
    const row=['servicePromoters','servicePromotionInvites','servicePromotionWithdrawals','serviceFinanceEntries','serviceFinanceRecoveries'].flatMap(k=>s[k]||[]).find(r=>r.id===(p.id||p.promoterId));
    const payload={requestId:'history-shared-source-'+ ++n,version:row?.version||0,reason:'合成原来源办理',...p};
    const evidence=await prepareServicePromotionEvidence(s,actor,type,payload,{readFile:async descriptor=>{assert.deepEqual(descriptor,proofFile);return proofBlob;}});
    let result;s=reduce(s,actor,type,payload,r=>result=r,evidence);return result;
  }
  await validateInvoiceFile(proofBlob);
  await op('clock.advance',{minutes:1});
  await op('manage.tech-save',{storeId:'xingfu',name:'共享历史原技师',phone:'13800005572',gender:'female',lat:31.231,lng:121.475,serviceIds:['neck'],certificate:'INTERNAL-TECH-CERT',insurance:'INTERNAL-TECH-INSURANCE',validUntil:'2027-12-31'},store);
  const techId=s.techs.at(-1).id,t=()=>s.techs.find(t=>t.id===techId);
  const q=()=>s.techQualifications.find(q=>q.techId===techId&&q.storeId===t().storeId&&(!t().qualificationProfileId||q.id===t().qualificationProfileId));
  await op('manage.tech-review',{id:techId,version:t().version,decision:'approve'},ops);
  const qualify=(command,p,actor=store)=>op('qualification.'+command,{techId,version:q()?.version||0,...p},actor);
  await qualify('assess',{serviceIds:['neck'],batch:'共享原单人考核',assessor:'共享原考核员',proof:'ORIGINAL-ASSESSMENT',occurredAt:s.now,result:'pass',kind:'initial'});
  await qualify('request',{assessmentId:q().assessments.at(-1).id});
  await qualify('review',{grantId:q().grants.at(-1).id,decision:'approve',reviewer:'共享集团审核员',proof:'ORIGINAL-QUALIFICATION'},ops);
  const admin=await op('account.enter',{accountId:'DEMO-ADMIN',grantId:'DEMO-ADMIN-GRANT'},customer);
  await op('lifecycle.identity-link',{techId,userId:'u2',version:t().version,reference:'ACTUAL-PERSON-LINK',occurredAt:s.now},admin);
  const promoterId=s.servicePromoters.find(r=>r.personKind==='tech'&&r.personId===techId).id;
  await op('finance.rule-publish',{scope:'global',groupBps:1000,storeBps:500,effectiveAt:s.now,version:0,reason:'显式本地原H配置'});
  await op('tech-income.rule-publish',{storeId:'xingfu',serviceId:'all',rateBps:4000,refundPolicy:'proportional',rounding:'floor',effectiveAt:s.now,version:0,reason:'显式本地原店提成配置'});
  await op('service-promotion.rule-publish',{promoterType:'tech',firstBps:2000,repeatBps:1000,storeCostBps:5000,csRounding:'floor',concurrency:'completed-created-id',lateFullRefund:'reassign',effectiveAt:s.now,version:0,basis:'显式本地Demo，正式政策另验'});
  await op('service-promotion.identity-review',{id:promoterId,decision:'verified',...proof('INTERNAL-IDENTITY-REFERENCE')},support);
  await op('service-promotion.enter',{promoterId,version:s.users.find(u=>u.id==='u1').serviceBinding.version},customer);
  const startAt=Math.ceil((s.now+5*60*MIN)/(30*MIN))*30*MIN;
  await op('booking.create',{storeId:'xingfu',serviceId:'neck',regionId:'home',techId,mode:'specified',genderPreference:'any',startAt,contactName:'PRIVATE-CUSTOMER-CONTACT',phone:'13800008881',healthConsent:true,identityVerified:true,adultConfirmed:true},customer);
  const bookingId=s.bookings.at(-1).id,tech={role:'tech',techId};
  await op('booking.pay',{id:bookingId,outcome:'success'},customer);await op('booking.accept',{id:bookingId},tech);
  await op('clock.advance',{minutes:(startAt-s.now)/MIN});await op('booking.start',{id:bookingId},tech);
  await op('clock.advance',{minutes:45});await op('booking.finish',{id:bookingId,mode:'normal'},tech);
  const b=s.bookings.find(b=>b.id===bookingId),departure=s.fulfilmentDepartures.find(d=>d.bookingId===bookingId);
  await op('fulfilment.departure-confirm',{bookingId,bookingToken:fulfilmentBindingToken(b),departureId:departure.id,version:departure.version,safeLeft:true,occurredAt:s.now,positionMode:'manual',place:'实际合成安全离开处',evidence:'原本人实际离开确认'},tech);
  await op('clock.advance',{minutes:2881});
  let entry=s.serviceFinanceEntries.find(e=>e.bookingId===bookingId);
  await op('finance.split-start',{id:entry.id,version:entry.version,outcome:'success'});entry=s.serviceFinanceEntries.find(e=>e.bookingId===bookingId);
  await op('finance.finish-start',{id:entry.id,version:entry.version,outcome:'success'});
  const income=s.techIncomeEntries.find(e=>e.bookingId===bookingId);
  await op('tech-income.payout',{techId,month:income.month,lines:[{entryId:income.id,version:income.version}],paidAt:s.now,proof:'ORIGINAL-STORE-INCOME-PAYOUT',reason:'原店实际提成发放记录'},{role:'store',job:'store-finance',storeId:'xingfu'});
  const members=[];
  for(const [job,storeId] of [['support'],['finance'],['store-finance','xingfu']]) {
    let account=await op('account.create',{name:'共享实际承接'+job},admin);
    account=await op('account.employment',{id:account.id,version:account.version,employmentStatus:'active',reference:'SHARED-ACTUAL-EMP-'+job,verifiedAt:s.now},admin);
    account=await op('account.grant',{id:account.id,version:account.version,job,...(storeId?{storeId}:{})},admin);
    const grant=account.grants.at(-1),actor=await op('account.enter',{accountId:account.id,grantId:grant.id},customer);
    members.push({id:account.id,grantId:grant.id,job,storeId,actor});
  }
  await op('lifecycle.departure-start',{techId,version:t().version,sourceToken:lifecycleImpact(s,{techId},createLifecycleContext()).sourceToken,reference:'SHARED-ACTUAL-DEPARTURE'},ops);
  let c=s.organizationLifecycleCases.at(-1);
  const impact=lifecycleCaseImpact(s,c.id,createLifecycleContext()),stores=new Set([c.fromStoreId,...impact.bookings.map(b=>b.storeId),...Object.values(impact.settlement.groups).flat().map(r=>r.storeId)].filter(Boolean));
  for(const member of members)for(const storeId of member.storeId?[member.storeId]:stores) {
    const account=s.staffAccounts.find(a=>a.id===member.id);
    const handover=await op('account.handover',{caseId:c.id,caseVersion:c.version,accountId:account.id,accountVersion:account.version,grantId:member.grantId,storeId,allowedCommands:lifecycleHandoverCommands(member.job),reference:'SHARED-HANDOVER-'+member.job+'-'+storeId},admin);
    await op('account.handover-accept',{id:handover.id,version:handover.version,reference:'SHARED-SELF-ACCEPT-'+member.job+'-'+storeId},member.actor);
  }
  c=s.organizationLifecycleCases.at(-1);const view=lifecycleCompletionView(s,c.id,createLifecycleContext());
  assert.equal(view.canComplete,true,view.blockers.map(x=>x.reason).join('；'));
  await op('lifecycle.complete',{id:c.id,version:c.version,sourceToken:view.sourceToken},ops);
  assert.equal(t().lifecycleStatus,'left');assert.equal(s.serviceCommissions.find(c=>c.promoterId===promoterId).commissionCents,3960);
  // A second real user promoter belongs to this same ordinary user. Its native
  // invitation/agreement path must stay separate from the old tech identity.
  await op('service-promotion.agreement-publish',{promoterType:'store-promoter',title:'本人原普通推广协议',body:'NATIVE-USER-AGREEMENT',effectiveAt:s.now,...proof('NATIVE-USER-AGREEMENT-REF')},support);
  await op('service-promotion.invite',{userId:'u2',promoterType:'store-promoter',expiresAt:s.now+DAY},{role:'store',job:'store-manager',storeId:'xingfu'});
  const invite=s.servicePromotionInvites.at(-1);
  await op('service-promotion.invite-confirm',{id:invite.id,decision:'accept',agreementAccepted:true,agreementId:invite.agreementSnapshot.id},owner);
  const nativePromoterId=s.servicePromoters.at(-1).id;
  await op('service-promotion.identity-review',{id:nativePromoterId,decision:'verified',...proof('INTERNAL-NATIVE-IDENTITY')},support);
  return {ledger:JSON.parse(JSON.stringify(s)),techId,promoterId,nativePromoterId,bookingId,incomeId:income.id};
}
let fixturePromise;
async function fixture(){return structuredClone(await (fixturePromise ||= createFixture()));}
async function historicalApp(f,section='promoters',id=f.promoterId,actor=owner){return runtime(f.ledger,historicalPath(section,id),{initialActor:actor});}
async function navigate(a,hash){a.location.hash=hash;await a.render();assert.deepEqual(a.errors,[]);}
async function storageRefresh(a,s){a.authoritative(s);const event=new Event('storage');Object.defineProperty(event,'key',{value:KEY});for(const listener of a.window.listeners.get('storage')||[])await listener(event);assert.deepEqual(a.errors,[]);}
async function submit(a,op,fields={}) {
  const form=appForm(a,op);assert.ok(form,'原共享页面缺少'+op+'表单：'+appText(a));
  for(const [name,value] of Object.entries(fields)){const field=form.querySelector(`[name="${name}"]`);assert.ok(field,'原表单缺控件'+name);field.value=value;}
  await a.dispatch('submit',form);await a.render();return {form,payload:sourcePayload(form),ledger:appLedger(a)};
}
async function sourceOp(s,type,p,actor=finance){
  const evidence=await prepareServicePromotionEvidence(s,actor,type,p,{readFile:async descriptor=>{assert.deepEqual(descriptor,proofFile);return proofBlob;}});
  return reduce(s,actor,type,p,()=>{},evidence);
}

test('真实离职完成后本人入口沿原映射读取，带tech/store界面提示且不写账',async()=>{
  const f=await fixture(),a=await runtime(f.ledger,'#/user/me',{initialActor:owner});
  const link=a.document.querySelector('a[href="#/user/tech-rights"]');assert.ok(link);assert.match(link.textContent,/本人历史提成与佣金/);
  await navigate(a,link.getAttribute('href'));const text=appText(a);
  for(const source of [f.incomeId,f.bookingId,'ORIGINAL-STORE-INCOME-PAYOUT','79.20'])assert.ok(text.includes(source),source);
  assert.doesNotMatch(text,/PRIVATE-CUSTOMER-CONTACT|13800008881|INTERNAL-TECH-CERT|INTERNAL-TECH-INSURANCE|INTERNAL-IDENTITY-REFERENCE/);
  await navigate(a,historicalPath('promoters',f.promoterId));assert.ok(appForm(a,'withdraw-create'));assert.match(appText(a),/39.60/);
  const p=sourcePayload(appForm(a,'withdraw-create')),r=f.ledger.servicePromoters.find(r=>r.id===f.promoterId);
  assert.deepEqual(p,{promoterId:r.id,version:r.version,balanceToken:servicePromotionBalanceToken(f.ledger,r.id)});
  assert.doesNotMatch(appText(a),/INTERNAL-EVIDENCE-BODY|INTERNAL-IDENTITY-REFERENCE|NATIVE-USER-AGREEMENT/);
  assert.deepEqual(appLedger(a),f.ledger);assert.equal(a.localStorage.writes.length,0);
  assert.throws(()=>reduce(f.ledger,{role:'tech',techId:f.techId},'booking.schedule-save',{}),/离职|工作身份.*结束/);
});

test('可见原申请元金额控件经实际app预检和reduce创建，后续原页与幂等保持原额',async()=>{
  const f=await fixture(),a=await historicalApp(f),form=appForm(a,'withdraw-create');assert.equal(form.querySelector('[name="amountCents"]').dataset.unit,'yuan');
  const oldPayload=sourcePayload(form),sent=await submit(a,'withdraw-create',{amountCents:'10.00'}),w=nativeWithdrawal(sent.ledger);
  assert.ok(w,'真实app提现未进入原引擎：'+toastText(a));assert.equal(w.amountCents,1000);assert.equal(w.personKey,'tech:'+f.techId);assert.equal(w.promoterId,f.promoterId);
  assert.equal(w.history.at(-1).by.historicalUserId,'u2');assert.equal(a.location.hash,historicalPath('withdrawals'));
  assert.deepEqual(sent.ledger.techIncomeEntries,f.ledger.techIncomeEntries);assert.deepEqual(sent.ledger.techIncomePayouts,f.ledger.techIncomePayouts);
  assert.equal(adapters.promotionView(sent.ledger,owner,f.techId).balances[0].availableCents,2960);
  const request=sent.ledger.servicePromotionRequests.find(r=>r.result?.id===w.id);
  const replay=await sourceOp(sent.ledger,'service-promotion.withdraw-create',{...oldPayload,amountCents:1000,requestId:request.requestId},owner);
  assert.equal(replay.servicePromotionWithdrawals.length,1);assert.equal(adapters.promotionView(replay,owner,f.techId).balances[0].dailyCreated,1);
  await navigate(a,historicalPath('withdrawals',w.id));assert.match(appText(a),/10.00/);assert.ok(appForm(a,'withdraw-cancel'));assert.doesNotMatch(appText(a),/实际成功转账依据|INTERNAL-EVIDENCE-BODY/);
});

test('可见原撤销表单实际submit恢复旧余额且保留计次，不制造转账凭据',async()=>{
  const f=await fixture(),a=await historicalApp(f);await submit(a,'withdraw-create',{amountCents:'10.00'});const original=nativeWithdrawal(appLedger(a));assert.ok(original,toastText(a));
  await navigate(a,historicalPath('withdrawals',original.id));const form=appForm(a,'withdraw-cancel');assert.deepEqual(sourcePayload(form),{id:original.id,version:original.version});
  const sent=await submit(a,'withdraw-cancel',{reason:'本人撤回原未受理申请'}),w=nativeWithdrawal(sent.ledger),balance=adapters.promotionView(sent.ledger,owner,f.techId).balances[0];
  assert.equal(w.status,'cancelled');assert.equal(w.amountCents,1000);assert.equal(balance.availableCents,3960);assert.equal(balance.dailyCreated,1);assert.equal(w.execution,null);
  assert.match(appText(a),/渠道或申请明确撤销/);assert.equal(appForm(a,'withdraw-cancel'),null);
});

test('可见原确认空决策守约束，实际本人submit只推进查询、真实财务成功后原页到账',async()=>{
  const f=await fixture(),a=await historicalApp(f);await submit(a,'withdraw-create',{amountCents:'10.00'});let s=appLedger(a),w=nativeWithdrawal(s);assert.ok(w,toastText(a));
  s=await sourceOp(s,'service-promotion.withdraw-pay',{id:w.id,version:w.version,requestId:'history-actual-await',outcome:'awaiting_user',confirmExpiresAt:s.now+DAY,reason:'实际原渠道待本人确认'});w=nativeWithdrawal(s);
  const requestNo=w.execution.requestNo;await storageRefresh(a,s);await navigate(a,historicalPath('withdrawals',w.id));
  const form=appForm(a,'withdraw-confirm');assert.ok(form,appText(a));assert.deepEqual(sourcePayload(form),{id:w.id,version:w.version});assert.equal(form.querySelector('[name="decision"]').value,'');
  const before=appLedger(a);await a.dispatch('submit',form);assert.deepEqual(appLedger(a),before,'空决定必须保持原账');
  const sent=await submit(a,'withdraw-confirm',{decision:'accept',reason:'本人明确确认原笔收款'});s=sent.ledger;w=nativeWithdrawal(s);
  assert.equal(w.status,'processing');assert.equal(w.execution.requestNo,requestNo);assert.equal(w.execution.status,'awaiting_user');assert.equal(w.execution.completedAt,undefined);assert.match(appText(a),/结果尚未确定/);
  s=await sourceOp(s,'service-promotion.withdraw-query',{id:w.id,version:w.version,requestId:'history-actual-success',outcome:'success',reference:'INTERNAL-ACTUAL-TRANSFER',occurredAt:s.now,file:proofFile,reason:'INTERNAL-TRANSFER-RESULT'});
  await storageRefresh(a,s);w=nativeWithdrawal(appLedger(a));assert.equal(w.status,'paid');assert.equal(w.amountCents,1000);assert.equal(w.execution.requestNo,requestNo);
  assert.match(appText(a),/实际转账成功/);assert.match(appText(a),/10.00/);assert.doesNotMatch(appText(a),/INTERNAL-ACTUAL-TRANSFER|INTERNAL-TRANSFER-RESULT|data-invoice|INTERNAL-EVIDENCE-BODY/);
  const paid=appLedger(a),beforeFiles=structuredClone(paid);
  assert.deepEqual(w.execution.proof.evidenceRefs,[proofFile]);
  for(const slot of ['payment:0','result:1:0','payment:1','result:0:0'])assert.throws(()=>authorizedInvoiceFile(paid,owner,w.id,slot,proofFile.ref,'tech-history-promotion'),/无权|来源槽|附件/);
  assert.deepEqual(authorizedInvoiceFile(paid,finance,w.id,'payment:0',proofFile.ref,'service-promotion'),proofFile);
  assert.deepEqual(paid,beforeFiles);
});

test('旧可见余额载荷和旧原版本在共享提交后拒绝，不扩大旧账或重复创建',async()=>{
  const f=await fixture(),a=await historicalApp(f),oldForm=appForm(a,'withdraw-create'),oldPayload=sourcePayload(oldForm);
  await submit(a,'withdraw-create',{amountCents:'10.00'});let s=appLedger(a),w=nativeWithdrawal(s);assert.ok(w,toastText(a));const before=structuredClone(s);
  await assert.rejects(()=>sourceOp(s,'service-promotion.withdraw-create',{...oldPayload,amountCents:1000,requestId:'different-old-balance'},owner),/余额.*变化|已变化/);assert.deepEqual(s,before);
  await navigate(a,historicalPath('withdrawals',w.id));const staleCancel=appForm(a,'withdraw-cancel');staleCancel.querySelector('[name="reason"]').value='旧版本撤销';
  s=await sourceOp(s,'service-promotion.withdraw-pay',{id:w.id,version:w.version,requestId:'history-unknown-version',outcome:'processing',reason:'实际原渠道结果未知'});a.authoritative(s);
  await a.dispatch('submit',staleCancel);assert.match(toastText(a),/版本|变化|原申请.*刷新/);assert.deepEqual(appLedger(a),s);assert.equal(s.servicePromotionWithdrawals.length,1);
});

test('他人深链、显式跨tech和伪工作会话不能借本人页面或提交扩大来源',async()=>{
  const f=await fixture(),a=await historicalApp(f,'promoters',f.promoterId,customer);assert.equal(appForm(a,'withdraw-create'),null);assert.doesNotMatch(appText(a),/39.60/);
  const original={promoterId:f.promoterId,version:f.ledger.servicePromoters.find(r=>r.id===f.promoterId).version,balanceToken:servicePromotionBalanceToken(f.ledger,f.promoterId),amountCents:1000,requestId:'history-forged-owner'};
  for(const actor of [customer,{...owner,sessionId:'FORGED-SESSION'},{...owner,accountId:'FORGED-ACCOUNT'}])await assert.rejects(()=>sourceOp(f.ledger,'service-promotion.withdraw-create',original,actor),/本人|会话|岗位|用户|关联/);
  const forged=await historicalApp(f,'promoters',f.promoterId,{...owner,sessionId:'FORGED-SESSION'});assert.match(appText(forged),/工作会话已失效/);assert.equal(appForm(forged,'withdraw-create'),null);assert.doesNotMatch(appText(forged),/39.60/);
  await assert.rejects(()=>sourceOp(f.ledger,'service-promotion.withdraw-create',{...original,techId:'lin'},owner),/其他|来源|本人/);
  const valid=await historicalApp(f);const out=await submit(valid,'withdraw-create',{amountCents:'10.00'});assert.equal(nativeWithdrawal(out.ledger)?.personId,f.techId,toastText(valid));
  await navigate(valid,historicalPath('promoters',f.nativePromoterId));assert.equal(appForm(valid,'withdraw-create'),null);assert.doesNotMatch(appText(valid),/NATIVE-USER-AGREEMENT/);
});

test('实际关闭本人使用后共享历史深链/原命令/附件拒绝，原佣金金额继续保留',async()=>{
  const f=await fixture();let s=reduce(f.ledger,owner,'privacy.request',{version:0,requestId:'history-real-privacy-request',reason:'本人原关闭申请',acknowledged:true});const c=s.privacyClosures.at(-1);
  s=reduce(s,support,'privacy.close',{id:c.id,version:c.version,requestId:'history-real-privacy-close',reason:'本人普通使用实际关闭',custodian:'原客服',acknowledged:true});assert.equal(s.users.find(u=>u.id==='u2').status,'closed');
  const a=await historicalApp({...f,ledger:s});assert.equal(appForm(a,'withdraw-create'),null);assert.doesNotMatch(appText(a),/39.60/);
  assert.throws(()=>adapters.promotionView(s,owner,f.techId),/闭域来源/);
  await assert.rejects(()=>sourceOp(s,'service-promotion.withdraw-create',{promoterId:f.promoterId,version:s.servicePromoters.find(r=>r.id===f.promoterId).version,balanceToken:servicePromotionBalanceToken(s,f.promoterId),amountCents:1000,requestId:'closed-history-write'},owner),/关闭|闭域/);
  assert.throws(()=>authorizedInvoiceFile(s,owner,f.promoterId,'identity:0',proofFile.ref,'tech-history-promotion'),/关闭|闭域/);
  assert.deepEqual(s.serviceCommissions,f.ledger.serviceCommissions);assert.deepEqual(s.techIncomeEntries,f.ledger.techIncomeEntries);
});

test('真实内部附件与冒用槽/跨源引用拒绝，普通本人原协议附件仍沿原域读取',async()=>{
  const f=await fixture(),s=f.ledger,original=structuredClone(s);
  for(const [id,slot,ref] of [[f.promoterId,'identity:0',proofFile.ref],[f.promoterId,'agreement:0',proofFile.ref],[f.nativePromoterId,'agreement:0',proofFile.ref],[f.promoterId,'identity:1',proofFile.ref],[f.promoterId,'identity:0','invoice-file:'+'0'.repeat(64)]]){
    assert.throws(()=>authorizedInvoiceFile(s,owner,id,slot,ref,'tech-history-promotion'),/无权|来源槽|附件|引用|本人/);
  }
  for(const actor of [customer,{...owner,sessionId:'FORGED-SESSION'}])assert.throws(()=>authorizedInvoiceFile(s,actor,f.promoterId,'identity:0',proofFile.ref,'tech-history-promotion'),/本人|会话|无权/);
  const nativeAgreement=s.servicePromoters.find(r=>r.id===f.nativePromoterId).agreementSnapshot.id;
  assert.deepEqual(authorizedInvoiceFile(s,owner,nativeAgreement,'agreement:0',proofFile.ref,'service-promotion'),proofFile);
  assert.deepEqual(s,original);const a=await historicalApp(f);assert.equal(a.document.querySelector('[data-invoice-file]'),null);
});

test('同一普通用户原推广页面与真实原授权submit不受技师历史分支影响',async()=>{
  const f=await fixture(),a=await runtime(f.ledger,'#/user/service-promotion/promoters/'+f.nativePromoterId,{initialActor:owner});
  assert.match(appText(a),/本人原普通推广协议/);assert.doesNotMatch(appText(a),new RegExp(f.promoterId));assert.ok(appForm(a,'transfer-authorize'));
  const control=appForm(a,'transfer-authorize').querySelector('[name="enabled"]');assert.ok(control);const sent=await submit(a,'transfer-authorize',{enabled:'true',reason:'原普通本人明确授权'});
  const r=sent.ledger.servicePromoters.find(r=>r.id===f.nativePromoterId);assert.equal(r.personKind,'user');assert.equal(r.personId,'u2');assert.equal(r.transferAuthorization.exempt,true);
  assert.equal(sent.ledger.servicePromoters.find(r=>r.id===f.promoterId).status,'disabled');assert.equal(sent.ledger.servicePromotionWithdrawals.length,0);
  await navigate(a,'#/user/service-promotion/promoters');assert.ok(a.document.querySelector('a[href="#/user/service-promotion/promoters/'+f.nativePromoterId+'"]'));assert.equal(a.document.querySelector('a[href="'+historicalPath('promoters',f.promoterId)+'"]'),null);
});


