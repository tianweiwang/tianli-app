import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Script, createContext } from 'node:vm';
import { webcrypto } from 'node:crypto';
import { seed, reduce } from './engine.mjs';
import { assertPrivacyCommand } from './privacy.mjs';
import { captureClosedRights } from './privacy-closed-rights.mjs';

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
    document, window, sessionStorage, localStorage, errors,
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

function close(ledger) {
  const person = { role: 'user', userId: 'u1' };
  let next = reduce(ledger, person, 'privacy.request', { version: 0, requestId: 'app-unit-request', reason: '合成运行单元关闭申请', acknowledged: true });
  const request = next.privacyClosures.at(-1);
  return reduce(next, { role: 'group', job: 'support' }, 'privacy.close', { id: request.id, version: request.version, requestId: 'app-unit-close', reason: '原关闭事务运行单元依据', custodian: '运行单元客服', acknowledged: true });
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
function goodsProposal(kind) {
  let ledger = seed(); let sequence = 0;
  const person = { role: 'user', userId: 'u1' }, support = { role: 'group', job: 'support' }, warehouse = { role: 'group', job: 'warehouse' };
  const run = (type, payload, actor = person) => { ledger = reduce(ledger, actor, type, { requestId: 'app-unit-goods-' + (++sequence), ...payload }); };
  run('cart.set', { skuId: 'oil', qty: 2 }); run('goods.submit', { addressId: 'AD1', expectedSourceId: '' });
  const id = ledger.goods.at(-1).id;
  const order = () => ledger.goods.find(x => x.id === id);
  run('goods.pay', { id, outcome: 'success' }); run('goods.ship', { id, version: order().version, carrier: '合成原物流', tracking: 'APP-UNIT-ORIGINAL' }, warehouse);
  if (kind === 'partial') {
    run('goods.case', { id, version: order().version, kind: 'return', skuId: 'oil', qty: 2, amountCents: 40000, shippingCents: 0, reason: '合成原售后' });
    const current = () => order().cases.at(-1);
    run('goods.case-review', { id, caseId: current().id, version: current().version, decision: 'approve', reason: '合成原批准' }, support);
    run('goods.return', { id, caseId: current().id, version: current().version, carrier: '合成寄回', tracking: 'APP-UNIT-RETURN' });
    run('goods.inspect-partial', { id, caseId: current().id, version: current().version, qty: 1, evidence: '原命令合成实收1件' }, warehouse);
    run('goods.partial-propose', { id, caseId: current().id, version: current().version, resolution: 'refund', qty: 1, amountCents: 20000, shippingCents: 0, reason: '合成原部分实收方案' }, support);
  } else {
    run('goods.incident-open', { id, version: order().version, stage: 'delivery', kind: 'delay', reason: '合成原运输延迟' }, support);
    const current = () => order().incidents.at(-1);
    run('goods.incident-propose', { id, incidentId: current().id, version: current().version, resolution: 'continue', reason: '合成原继续履约方案' }, support);
  }
  return { ledger, id, command: kind === 'partial' ? 'goods.partial-confirm' : 'goods.incident-confirm' };
}
function historicalClose(ledger) {
  // Explicit isolated historical closure input, not a successful privacy.close.
  // The original unresolved sources above were created by original commands.
  assert.throws(() => close(ledger), /尚有未结事项/, 'normal close must keep its unresolved-item policy');
  const next = structuredClone(ledger), id = 'PC-APP-UNIT-HISTORICAL', at = next.now;
  const rights = captureClosedRights(next, 'u1', at);
  next.privacyClosures = [{ id, userId: 'u1', status: 'use_closed', version: 1, createdAt: at - 1, closedAt: at, rights, retention: [], historicalFixture: true }];
  next.privacyProfiles = [{ userId: 'u1', status: 'use_closed', version: 1, history: [{ action: '账号使用关闭，历史材料待清理', closureId: id }] }];
  next.users.find(x => x.id === 'u1').status = 'closed';
  return next;
}
function field(h, attributes) {
  const node = h.document.createElement('input');
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  h.document.querySelector('main').append(node); return node;
}
function managementForm(h, command, payload) {
  const form = h.document.createElement('form');
  form.setAttribute('data-management-form', 'app-runtime-original'); form.setAttribute('data-command', command);
  form.setAttribute('data-payload', JSON.stringify(payload)); form.setAttribute('data-live-version', String(payload.version ?? 0));
  form.innerHTML = '<textarea name="description">合成原权益未提交说明</textarea><p class="management-draft-note"></p>';
  h.document.querySelector('main').append(form); return { form, input: form.elements.namedItem('description') };
}
const draftSets = h => h.sessionStorage.writes.filter(x => x.method === 'set' && (x.key === DRAFT || x.key === RESULT || x.key.startsWith(KEY + '-management:')));
function originalForm(h, command) {
  const form = h.document.querySelector('form[data-command="' + command + '"]');
  assert.ok(form, 'real customer render must provide ' + command); return form;
}

test('未关闭正常事件仍保存预约字段和支付选择，替身没有统一禁写', async () => {
  const h = await runtime(), input = field(h, { 'data-booking-field': 'contactName', name: 'contactName' });
  input.value = '正常原预约草稿'; h.resetWrites(); await h.dispatch('input', input);
  assert.equal(JSON.parse(h.sessionStorage.getItem(DRAFT)).contactName, input.value);
  const payment = h.document.querySelector('[data-booking-result]'); payment.value = 'processing';
  await h.dispatch('change', payment); assert.equal(h.sessionStorage.getItem(RESULT), 'processing');
});

test('实际初始render：关闭本人不渲染支付工具，新预约query不写草稿且原权益入口保留', async () => {
  const active = await runtime(); assert.ok(active.document.querySelector('[data-booking-result]'));
  const h = await runtime(close(seed()), '#/user/booking?store=xingfu&service=relax&tech=lin');
  assert.equal(h.document.querySelector('.demo-settings'), null); assert.equal(h.document.querySelector('[data-booking-result]'), null);
  assert.equal(h.sessionStorage.getItem(DRAFT), null);
  assert.deepEqual(draftSets(h), []);
  assert.ok(h.document.querySelector('a[href="#/user/rights"]'));
});

test('权威账本关闭但storage回调未执行：旧支付change不写结果或预约草稿', async () => {
  const initial = seed(), h = await runtime(initial), old = h.document.querySelector('[data-booking-result]');
  old.value = 'processing'; const closed = close(initial); h.authoritative(closed); h.resetWrites();
  await h.dispatch('change', old);
  assert.equal(h.sessionStorage.getItem(RESULT), 'success'); assert.deepEqual(draftSets(h), []);
  assert.equal(h.document.querySelector('[data-booking-result]'), null);
  assert.equal(h.localStorage.getItem(KEY), JSON.stringify(closed));
});

for (const event of ['input', 'change']) test('权威来源先关闭：旧预约' + event + '不新增/修改草稿', async () => {
  const initial = seed(), h = await runtime(initial), input = field(h, { 'data-booking-field': 'contactName', name: 'contactName' });
  input.value = '关后旧页面输入'; const closed = close(initial); h.authoritative(closed); h.resetWrites();
  await h.dispatch(event, input);
  assert.deepEqual(draftSets(h), []); assert.equal(h.sessionStorage.getItem(DRAFT), null);
  assert.equal(h.localStorage.getItem(KEY), JSON.stringify(closed));
});

for (const event of ['input', 'change']) test('关闭本人非法原管理表单' + event + '不保存草稿', async () => {
  const initial = seed(), h = await runtime(initial), { input } = managementForm(h, 'privacy.consent', { version: 0, agreed: true });
  h.authoritative(close(initial)); h.resetWrites(); await h.dispatch(event, input);
  assert.deepEqual(draftSets(h), []);
});

test('关闭本人有效原反馈Binding仍保存草稿，后续真实render保留未提交内容', async () => {
  const { ledger, id } = completedBooking(), closed = close(ledger), payload = { bookingId: id, claim: 'feedback', requests: [], amountCents: 0, version: 0 };
  assert.doesNotThrow(() => assertPrivacyCommand(closed, { role: 'user', userId: 'u1' }, 'care.case-create', payload));
  const h = await runtime(closed), { input } = managementForm(h, 'care.case-create', payload);
  h.resetWrites(); input.value = '关闭后原反馈草稿'; await h.dispatch('input', input);
  const writes = draftSets(h); assert.equal(writes.length, 1); assert.ok(writes[0].key.startsWith(KEY + '-management:'));
  const saved = JSON.parse(h.sessionStorage.getItem(writes[0].key));
  assert.equal(saved.values[0].value, input.value); assert.deepEqual(JSON.parse(saved.payload), payload);
  await h.render(); assert.equal(h.sessionStorage.getItem(writes[0].key), writes[0].value);
  assert.equal(h.localStorage.getItem(KEY), JSON.stringify(closed));
});

for (const kind of ['booking input', 'booking change', 'payment change', 'management input', 'management change']) test('viewError：' + kind + '不写业务草稿/支付选择', async () => {
  const h = await runtime();
  let target;
  if (kind.startsWith('booking')) target = field(h, { 'data-booking-field': 'contactName', name: 'contactName' });
  else if (kind.startsWith('payment')) target = h.document.querySelector('[data-booking-result]');
  else target = managementForm(h, 'privacy.consent', { version: 0, agreed: true }).input;
  target.value = '读源失败后的旧输入'; h.sessionStorage.removeItem(DRAFT);
  h.localStorage.setItem(KEY, '{unparseable-authoritative-ledger'); h.resetWrites();
  await h.dispatch(kind.endsWith('input') ? 'input' : 'change', target);
  assert.deepEqual(draftSets(h), []); assert.equal(h.sessionStorage.getItem(DRAFT), null);
  assert.equal(h.sessionStorage.getItem(RESULT), 'success'); assert.equal(h.localStorage.getItem(KEY), '{unparseable-authoritative-ledger');
});

test('真实customer原退款表单默认0/空原因可以保存，实际render恢复原字段', async () => {
  const { ledger, id } = completedBooking(), closed = close(ledger), h = await runtime(closed, '#/user/booking/' + id);
  const form = originalForm(h, 'booking.refund-request'), amount = form.querySelector('[name^="refundAmount:"]'), reason = form.elements.namedItem('reason');
  assert.equal(amount.value, '0'); assert.equal(reason.value, '');
  h.resetWrites(); await h.dispatch('input', reason);
  const writes = draftSets(h); assert.equal(writes.length, 1);
  const original = JSON.parse(writes[0].value);
  assert.ok(original.values.some(x => x.name === amount.name && x.value === '0')); assert.ok(original.values.some(x => x.name === 'reason' && x.value === ''));
  reason.value = '原退款未提交说明'; await h.dispatch('input', reason); await h.render();
  const restored = originalForm(h, 'booking.refund-request');
  assert.equal(restored.elements.namedItem('reason').value, '原退款未提交说明'); assert.equal(restored.querySelector('[name^="refundAmount:"]').value, '0');
  assert.match(restored.querySelector('.management-draft-note').textContent, /已恢复/);
  assert.equal(h.localStorage.getItem(KEY), JSON.stringify(closed));
});

test('真实原退款字段的paymentId串号时不能保存管理草稿', async () => {
  const { ledger, id } = completedBooking(), closed = close(ledger), h = await runtime(closed, '#/user/booking/' + id);
  const form = originalForm(h, 'booking.refund-request'), amount = form.querySelector('[name^="refundAmount:"]');
  amount.setAttribute('name', 'refundAmount:OTHER-ORIGINAL-PAYMENT'); amount.value = '0';
  h.resetWrites(); await h.dispatch('input', amount); assert.deepEqual(draftSets(h), []);
  assert.equal(h.localStorage.getItem(KEY), JSON.stringify(closed));
});

test('草稿可保留零退款，实际原submit仍拒绝无有效分笔申请', async () => {
  const { ledger, id } = completedBooking(), closed = close(ledger), h = await runtime(closed, '#/user/booking/' + id);
  const form = originalForm(h, 'booking.refund-request'); form.elements.namedItem('reason').value = '原提交缺少正额分笔';
  assert.equal(form.reportValidity(), true); h.resetWrites(); await h.dispatch('submit', form);
  assert.match(h.document.getElementById('toast').textContent, /分笔支付来源|退款明细|退款金额/);
  assert.equal(h.localStorage.getItem(KEY), JSON.stringify(closed)); assert.deepEqual(h.localStorage.writes, []);
  assert.ok(draftSets(h).some(x => x.key.startsWith(KEY + '-management:')));
});

for (const kind of ['partial', 'incident']) {
  test('真实goods ' + kind + '原方案未选decision可存并恢复，非法选择拒存', async () => {
    const { ledger, id, command } = goodsProposal(kind), closed = historicalClose(ledger), h = await runtime(closed, '#/user/goods/' + id);
    const form = originalForm(h, command), decision = form.elements.namedItem('decision'), reason = form.elements.namedItem('reason');
    assert.equal(decision.value, ''); assert.equal(reason.value, ''); h.resetWrites(); await h.dispatch('change', decision);
    const writes = draftSets(h); assert.equal(writes.length, 1); const key = writes[0].key;
    assert.ok(JSON.parse(writes[0].value).values.some(x => x.name === 'decision' && x.value === ''));
    await h.render(); const restored = originalForm(h, command), restoredDecision = restored.elements.namedItem('decision');
    assert.equal(restoredDecision.value, ''); assert.match(restored.querySelector('.management-draft-note').textContent, /已恢复/);
    const saved = h.sessionStorage.getItem(key), illegal = h.document.createElement('option'); illegal.setAttribute('value', 'not-an-original-decision'); illegal.textContent = '合成非法选择'; restoredDecision.append(illegal); restoredDecision.value = 'not-an-original-decision';
    h.resetWrites(); await h.dispatch('change', restoredDecision); assert.deepEqual(draftSets(h), []); assert.equal(h.sessionStorage.getItem(key), saved);
    // FormData values are strings. Also exercise typed fixed-payload tampering
    // through the actual event path without the select masking that payload.
    const fixed = JSON.parse(restored.dataset.payload); restoredDecision.removeAttribute('name');
    for (const invalid of [0, false]) {
      restored.dataset.payload = JSON.stringify({ ...fixed, decision: invalid }); h.resetWrites();
      await h.dispatch('input', restored.elements.namedItem('reason'));
      assert.deepEqual(draftSets(h), [], 'typed ' + invalid + ' is not an unfinished choice'); assert.equal(h.sessionStorage.getItem(key), saved);
    }
    assert.equal(h.localStorage.getItem(KEY), JSON.stringify(closed));
  });
  test('真实goods ' + kind + '实际submit继续拒绝缺失决定，不借草稿scope执行', async () => {
    const { ledger, id, command } = goodsProposal(kind), closed = historicalClose(ledger), h = await runtime(closed, '#/user/goods/' + id);
    const form = originalForm(h, command), decision = form.elements.namedItem('decision');
    // Malformed client removes required only; real dispatcher/reduce must defend.
    decision.required = false; form.elements.namedItem('reason').value = '合成原提交未选择决定';
    assert.equal(decision.value, ''); assert.equal(form.reportValidity(), true); h.resetWrites(); await h.dispatch('submit', form);
    assert.match(h.document.getElementById('toast').textContent, /原权益选择无效|确认意见|决定/);
    assert.equal(h.localStorage.getItem(KEY), JSON.stringify(closed)); assert.deepEqual(h.localStorage.writes, []);
  });
}

// Actual file module storage calls use a standard IndexedDB API stand-in here;
// no source authorization, qualification command, or app handler is replaced.
const appEvidenceFiles=new Map();
function installAppEvidenceStorage() {
  const previous=globalThis.indexedDB;
  globalThis.indexedDB={open(){const request={};queueMicrotask(()=>{
    request.result={createObjectStore(){},transaction(){const tx={objectStore(){return{
      put(blob,key){appEvidenceFiles.set(key,blob);queueMicrotask(()=>tx.oncomplete?.());},
      get(key){const result={};queueMicrotask(()=>{result.result=appEvidenceFiles.get(key);result.onsuccess?.();});return result;}
    };}};return tx;}};request.onupgradeneeded?.();request.onsuccess?.();
  });return request;}};
  return()=>{globalThis.indexedDB=previous;};
}
async function evidenceSettled(form) {
  for(let i=0;i<100&&Number(form.dataset.invoicePending)>0;i++)await new Promise(setImmediate);
  assert.equal(Number(form.dataset.invoicePending||0),0,'original file selection must settle');
}
function fillActualAssessment(form) {
  for(const [name,value] of Object.entries({kind:'mature',batch:'隔离app原材料链',assessor:'技术样本核验员',occurredAt:'2026-10-02T08:30',result:'pass',proof:'APP-QA-ORIGINAL',reason:'隔离技术样本，非真实人员资格认定'}))form.elements.namedItem(name).value=value;
  form.querySelector('[name="serviceIds"]').checked=true;
}
test('实际app资格选择→草稿恢复→JSON转array→真实文件核验→原考核提交',async()=>{
  const restore=installAppEvidenceStorage();
  try{
    const ledger=seed(),h=await runtime(ledger,'#/store/qualifications/lin',{initialActor:{role:'store',storeId:'xingfu'},locks:{request:(_key,fn)=>fn()}});
    let form=originalForm(h,'qualification.assess'),input=form.querySelector('[data-qualification-upload]');
    input.files=[new File(['%PDF-1.4\n% actual app original evidence\n%%EOF\n'],'原考核技术样本.pdf',{type:'application/pdf'})];
    h.resetWrites();await h.dispatch('change',input);await evidenceSettled(form);
    const refs=JSON.parse(form.elements.namedItem('evidenceRefs').value);assert.equal(refs.length,1);assert.match(refs[0].ref,/^invoice-file:[a-f0-9]{64}$/);
    assert.match(form.querySelector('[data-qualification-selected-files]').textContent,/原考核技术样本.pdf/);
    assert.equal((JSON.parse(h.localStorage.getItem(KEY)).techQualifications||[]).length,0,'selecting evidence must not create a qualification row');
    await h.render();form=originalForm(h,'qualification.assess');assert.deepEqual(JSON.parse(form.elements.namedItem('evidenceRefs').value),refs);fillActualAssessment(form);
    const submit=h.dispatch('submit',form);await new Promise(setImmediate);
    const confirmation=h.document.querySelector('[data-confirm-choice="accept"]');assert.ok(confirmation,'actual app must show original review confirmation');
    await h.dispatch('click',confirmation);await submit;await new Promise(setImmediate);
    const current=JSON.parse(h.localStorage.getItem(KEY)),profile=current.techQualifications.find(x=>x.techId==='lin');
    assert.ok(profile);assert.deepEqual(profile.assessments[0].evidenceRefs,refs);assert.deepEqual(current.bookings,ledger.bookings);assert.deepEqual(current.goods,ledger.goods);
    assert.ok(h.document.querySelector('[data-invoice-domain="qualification"]'));assert.deepEqual(h.errors,[]);
  }finally{restore();}
});
test('实际app选择失败保留旧附件；清除只放弃本次草稿，不删除文件或原事实',async()=>{
  const restore=installAppEvidenceStorage();
  try{
    const ledger=seed(),h=await runtime(ledger,'#/store/qualifications/lin',{initialActor:{role:'store',storeId:'xingfu'},locks:{request:(_key,fn)=>fn()}}),form=originalForm(h,'qualification.assess'),input=form.querySelector('[data-qualification-upload]'),baseline=h.localStorage.getItem(KEY);
    input.files=[new File(['%PDF-1.4\n% retained original\n%%EOF\n'],'保留原样本.pdf',{type:'application/pdf'})];
    await h.dispatch('change',input);await evidenceSettled(form);const original=form.elements.namedItem('evidenceRefs').value,ref=JSON.parse(original)[0].ref;
    input.files=[new File(['broken'],'坏文件.pdf',{type:'application/pdf'})];await h.dispatch('change',input);await evidenceSettled(form);
    assert.equal(form.elements.namedItem('evidenceRefs').value,original);assert.match(form.querySelector('[data-qualification-upload-status]').textContent,/文件内容/);
    await h.dispatch('click',form.querySelector('[data-qualification-clear]'));assert.equal(form.elements.namedItem('evidenceRefs').value,'[]');assert.ok(appEvidenceFiles.has(ref));
    assert.deepEqual(JSON.parse(h.localStorage.getItem(KEY)).techQualifications,JSON.parse(baseline).techQualifications);assert.deepEqual(h.errors,[]);
  }finally{restore();}
});
test('实际app选文件期间原资格版本变化不回写草稿；最终提交拒绝缺失原文件',async()=>{
  const restore=installAppEvidenceStorage();
  try{
    const ledger=seed(),h=await runtime(ledger,'#/store/qualifications/lin',{initialActor:{role:'store',storeId:'xingfu'},locks:{request:(_key,fn)=>fn()}}),form=originalForm(h,'qualification.assess'),input=form.querySelector('[data-qualification-upload]');
    const chosen=new File(['%PDF-1.4\n% delayed original\n%%EOF\n'],'异步技术样本.pdf',{type:'application/pdf'}),arrayBuffer=chosen.arrayBuffer.bind(chosen);
    chosen.arrayBuffer=async()=>{const changed=structuredClone(ledger);changed.techs.find(x=>x.id==='lin').version++;h.authoritative(changed);return arrayBuffer();};
    input.files=[chosen];h.resetWrites();await h.dispatch('change',input);await evidenceSettled(form);
    assert.equal(form.elements.namedItem('evidenceRefs').value,'[]');assert.match(form.querySelector('[data-qualification-upload-status]').textContent,/变化|失效/);assert.deepEqual(draftSets(h),[]);
    const clean=await runtime(ledger,'#/store/qualifications/lin',{initialActor:{role:'store',storeId:'xingfu'},locks:{request:(_key,fn)=>fn()}}),actual=originalForm(clean,'qualification.assess'),baseline=clean.localStorage.getItem(KEY);fillActualAssessment(actual);
    actual.elements.namedItem('evidenceRefs').value=JSON.stringify([{ref:'invoice-file:'+'e'.repeat(64),name:'缺失技术样本.pdf',type:'application/pdf',size:30}]);
    const submit=clean.dispatch('submit',actual);await new Promise(setImmediate);await clean.dispatch('click',clean.document.querySelector('[data-confirm-choice="accept"]'));await submit;await new Promise(setImmediate);
    assert.match(clean.document.getElementById('toast').textContent,/附件缺失|未在本页完整核验/);assert.deepEqual(JSON.parse(clean.localStorage.getItem(KEY)).techQualifications,JSON.parse(baseline).techQualifications);
  }finally{restore();}
});
