import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveObjectURL } from 'node:buffer';
import { authorizedInvoiceFile, hydrateInvoiceFiles, clearInvoiceFileUrls, invoiceFileName } from './invoice-files.mjs';
import { captureClosedRights } from './privacy-closed-rights.mjs';

// Unit-only IndexedDB and DOM event stand-ins. These exercise real asynchronous
// authorization and Blob URL lifetimes; they do not claim browser rendering or
// a file-system download.
const originalIndexedDB = globalThis.indexedDB;
const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6V5sAAAAASUVORK5CYII=', 'base64');
const blob = new Blob([bytes], { type: 'image/png' });
const file = { ref: 'invoice-file:' + 'a'.repeat(64), name: '商品/发票.png', type: blob.type, size: blob.size };
const serviceFile = { ...file, ref: 'invoice-file:' + 'b'.repeat(64), name: '原服务票.png' };
const files = new Map([[file.ref, blob], [serviceFile.ref, blob]]);
let reads = [], onRead = null;
globalThis.indexedDB = {
  open() {
    const request = {};
    queueMicrotask(() => {
      request.result = {
        transaction() {
          return { objectStore() { return { get(ref) {
            const read = {}; reads.push(ref);
            queueMicrotask(() => { read.result = files.get(ref); onRead?.(ref); read.onsuccess?.(); });
            return read;
          } }; } };
        }
      };
      request.onsuccess?.();
    });
    return request;
  }
};
test.after(() => { clearInvoiceFileUrls(); if (originalIndexedDB === undefined) delete globalThis.indexedDB; else globalThis.indexedDB = originalIndexedDB; });
test.beforeEach(() => { clearInvoiceFileUrls(); reads = []; onRead = null; files.set(file.ref, blob); files.set(serviceFile.ref, blob); });
test.afterEach(clearInvoiceFileUrls);

function state() {
  return { now: 1791000000000, users: [{ id: 'u1' }, { id: 'u2' }], stores: [{ id: 's1' }, { id: 's2' }], goods: [{ id: 'G1', userId: 'u1' }],
    serviceInvoices: [{ id: 'I1', userId: 'u1', storeId: 's1', issued: { file: serviceFile } }],
    commerceInvoices: [{ id: 'I1', category: 'goods', orderId: 'G1', userId: 'u1', issued: { file } }, { id: 'F1', category: 'fee', storeId: 's1', issued: { file } }] };
}
const user = () => ({ role: 'user', userId: 'u1' });
class Element extends EventTarget {
  constructor(tag = 'div') { super(); this.tagName = tag.toUpperCase(); this.attrs = new Map(); this.children = []; this.dataset = {}; this.isConnected = true; this.hidden = false; this.disabled = false; this.textContent = ''; }
  setAttribute(k, v) { this.attrs.set(k, String(v)); }
  getAttribute(k) { return this.attrs.get(k) ?? null; }
  removeAttribute(k) { this.attrs.delete(k); }
  set href(v) { this.setAttribute('href', v); }
  get href() { return this.getAttribute('href') || ''; }
  set download(v) { this.setAttribute('download', v); }
  get download() { return this.getAttribute('download') || ''; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  matches(selector) { return selector === 'a' && this.tagName === 'A'; }
  click() { const e = new Event('click', { cancelable: true }); if (!this.disabled) this.dispatchEvent(e); return e; }
}
function fixture({ domain = 'commerce', id = 'I1', ref = file.ref, slot = 'issued', explicitDomain = true } = {}) {
  const node = new Element(), view = new Element('button'), close = new Element('button'), download = new Element('a');
  const region = new Element('section'), content = new Element(), status = new Element('p'), fileStatus = new Element('span');
  node.dataset = { invoiceId: id, invoiceFile: ref, invoiceSlot: slot };
  if (explicitDomain) node.dataset.invoiceDomain = domain;
  view.disabled = true; region.hidden = true;
  const selectors = new Map([
    ['button[data-invoice-action="view"]', view], ['button[data-invoice-action="close-preview"]', close],
    ['[data-invoice-preview]', region], ['[data-invoice-preview-content]', content],
    ['[data-invoice-preview-status]', status], ['[data-invoice-file-status]', fileStatus]
  ]);
  node.querySelector = s => selectors.get(s) || null;
  node.querySelectorAll = s => s === 'a[data-invoice-action="download"]' ? [download] : [];
  const doc = { createElement(tag) { const e = new Element(tag); e.ownerDocument = doc; return e; } };
  for (const e of [node, view, close, download, region, content, status, fileStatus]) e.ownerDocument = doc;
  const root = { querySelectorAll: () => [node] };
  return { node, view, close, download, region, content, status, fileStatus, root };
}

test('域API向后兼容：未传域与明确service读取原服务票', () => {
  const s = state(); assert.equal(authorizedInvoiceFile(s, user(), 'I1', 'issued', serviceFile.ref), serviceFile);
  assert.equal(authorizedInvoiceFile(s, user(), 'I1', 'issued', serviceFile.ref, 'service'), serviceFile);
});
test('commerce独立授权：同ID不能回落服务票，未知/空域拒绝', () => {
  const s = state(); assert.deepEqual(authorizedInvoiceFile(s, user(), 'I1', 'issued', file.ref, 'commerce'), file);
  assert.throws(() => authorizedInvoiceFile(s, user(), 'I1', 'issued', serviceFile.ref, 'commerce'), /更新/);
  s.commerceInvoices[0].userId = 'u2';
  assert.throws(() => authorizedInvoiceFile(s, user(), 'I1', 'issued', serviceFile.ref, 'commerce'), /无权/);
  for (const domain of ['', null, 'unknown', 'Commerce']) assert.throws(() => authorizedInvoiceFile(s, user(), 'I1', 'issued', serviceFile.ref, domain), /所属业务无效/);
});
test('商品本人、集团财务与月票本店财务各自读取；其他岗位和资源拒绝', () => {
  const s = state(), group = { role: 'group', job: 'finance' }, store = { role: 'store', job: 'store-finance', storeId: 's1' };
  assert.deepEqual(authorizedInvoiceFile(s, group, 'I1', 'issued', file.ref, 'commerce'), file);
  assert.deepEqual(authorizedInvoiceFile(s, store, 'F1', 'issued', file.ref, 'commerce'), file);
  for (const actor of [{ role: 'manager', storeId: 's1' }, { role: 'store', storeId: 's2' }, { role: 'group', job: 'support' }, { role: 'user', userId: 'u2' }]) assert.throws(() => authorizedInvoiceFile(s, actor, 'F1', 'issued', file.ref, 'commerce'), /无权/);
  assert.throws(() => authorizedInvoiceFile(s, store, 'I1', 'issued', file.ref, 'commerce'), /无权/);
  assert.throws(() => authorizedInvoiceFile(s, user(), 'I1', 'red', file.ref, 'commerce'), /更新/);
});
test('未声明域的原节点读取原服务票，下载文件名与原字节机制一致', async () => {
  const f = fixture({ explicitDomain: false, ref: serviceFile.ref }); await hydrateInvoiceFiles(state(), user(), f.root);
  assert.deepEqual(reads, [serviceFile.ref]); assert.equal(f.download.download, invoiceFileName(serviceFile.name));
  assert.deepEqual(new Uint8Array(await resolveObjectURL(f.download.href).arrayBuffer()), new Uint8Array(bytes));
  assert.equal(f.download.click().defaultPrevented, false); assert.equal(f.fileStatus.textContent, '附件已就绪');
});
test('commerce初读失败先于存储读取，不借同ID服务附件通过', async () => {
  const s = state(); s.commerceInvoices[0].userId = 'u2'; const f = fixture({ ref: serviceFile.ref });
  await hydrateInvoiceFiles(s, user(), f.root); assert.equal(reads.length, 0); assert.equal(f.download.href, ''); assert.equal(f.view.disabled, true); assert.match(f.fileStatus.textContent, /无权/);
  const unknown = fixture({ domain: '' }); await hydrateInvoiceFiles(s, user(), unknown.root); assert.equal(reads.length, 0); assert.match(unknown.fileStatus.textContent, /所属业务无效/);
});
test('commerce存储await后再次核对原域和当前凭证，变更不给URL', async () => {
  const s = state(), f = fixture(); onRead = () => { s.commerceInvoices[0].issued.file = { ...file, ref: serviceFile.ref }; };
  await hydrateInvoiceFiles(s, user(), f.root); assert.deepEqual(reads, [file.ref]); assert.equal(f.download.href, ''); assert.equal(f.view.disabled, true); assert.match(f.fileStatus.textContent, /更新/);
});
test('读取中commerce域被改为service或删除时拒绝，不重试另一个域', async () => {
  for (const next of ['service', undefined]) {
    const f = fixture(); onRead = () => { if (next === undefined) delete f.node.dataset.invoiceDomain; else f.node.dataset.invoiceDomain = next; };
    const before = reads.length; await hydrateInvoiceFiles(state(), user(), f.root);
    assert.equal(reads.length, before + 1); assert.equal(f.download.href, ''); assert.equal(f.view.disabled, true); assert.match(f.fileStatus.textContent, /所属业务已更新/);
  }
});
test('commerce下载点击重新校验当前原域权限，失权阻止并撤销URL', async () => {
  const s = state(), f = fixture(); await hydrateInvoiceFiles(s, user(), f.root); const url = f.download.href;
  assert.ok(resolveObjectURL(url)); assert.equal(f.download.download, '商品_发票.png');
  s.commerceInvoices[0].userId = 'u2'; assert.equal(f.download.click().defaultPrevented, true); assert.equal(f.download.href, ''); assert.equal(resolveObjectURL(url), undefined);
});
test('已绑定commerce节点改域也会阻止下载，不能绕到同ID服务权限', async () => {
  const f = fixture(); await hydrateInvoiceFiles(state(), user(), f.root); const url = f.download.href; f.node.dataset.invoiceDomain = 'service';
  assert.equal(f.download.click().defaultPrevented, true); assert.equal(f.download.href, ''); assert.equal(resolveObjectURL(url), undefined);
});
test('commerce预览及图片异步加载重新授权；失权清内容/URL', async () => {
  const s = state(), f = fixture(); await hydrateInvoiceFiles(s, user(), f.root); f.view.click(); const media = f.content.children[0], url = media.src;
  assert.ok(resolveObjectURL(url)); s.commerceInvoices[0].userId = 'u2'; media.dispatchEvent(new Event('load'));
  assert.equal(resolveObjectURL(url), undefined); assert.equal(f.content.children.length, 0); assert.equal(f.region.hidden, true); assert.equal(f.view.disabled, true); assert.doesNotMatch(f.status.textContent, /已加载/);
});
test('commerce预览点击前域删除拒绝且没有媒体节点', async () => {
  const f = fixture(); await hydrateInvoiceFiles(state(), user(), f.root); delete f.node.dataset.invoiceDomain; f.view.click();
  assert.equal(f.content.children.length, 0); assert.equal(f.region.hidden, true); assert.equal(f.view.disabled, true); assert.match(f.fileStatus.textContent, /权限已更新/);
});
test('commerce关闭仅清预览；切页/切身份清两种URL和旧预览事件', async () => {
  const f = fixture(); let current = true; await hydrateInvoiceFiles(state(), user(), f.root, () => current);
  const downloadUrl = f.download.href; f.view.click(); const first = f.content.children[0].src; f.close.click();
  assert.equal(resolveObjectURL(first), undefined); assert.ok(resolveObjectURL(downloadUrl)); assert.equal(f.download.href, downloadUrl);
  f.view.click(); const second = f.content.children[0].src; current = false; clearInvoiceFileUrls();
  assert.equal(resolveObjectURL(second), undefined); assert.equal(resolveObjectURL(downloadUrl), undefined); assert.equal(f.content.children.length, 0); assert.equal(f.region.hidden, true);
  f.view.disabled = false; f.view.click(); assert.equal(f.content.children.length, 0); assert.equal(f.download.click().defaultPrevented, true);
});
test('commerce失效工作会话不能复用原附件', () => {
  const s = state(); s.staffAccounts = [{ id: 'A1', version: 1, enabled: true, grants: [{ id: 'GR1', role: 'group', job: 'finance', enabled: true }] }]; s.staffSessions = [{ id: 'SE1', accountId: 'A1', grantId: 'GR1', accountVersion: 1, revokedAt: s.now }];
  const actor = { role: 'group', job: 'finance', accountId: 'A1', grantId: 'GR1', sessionId: 'SE1' };
  assert.throws(() => authorizedInvoiceFile(s, actor, 'I1', 'issued', file.ref, 'commerce'), /无权/);
});
test('读取中切页不会挂上旧页链接或启用预览', async () => {
  const f = fixture(); let current = true; onRead = () => { current = false; };
  await hydrateInvoiceFiles(state(), user(), f.root, () => current); assert.equal(f.download.href, ''); assert.equal(f.view.disabled, true); assert.equal(f.content.children.length, 0);
});

function withClosedRights(s=state()) {
  const at=s.now;
  Object.assign(s.goods[0],{createdAt:at-3600000,payment:{id:'GP1',status:'success',amountCents:100}});
  s.bookings=[{id:'B1',userId:'u1',storeId:'s1',createdAt:at-3600000,payment:{id:'BP1',status:'success',amountCents:100},extensions:[]}];
  Object.assign(s.serviceInvoices[0],{bookingId:'B1',createdAt:at-1800000});
  s.commerceInvoices[0].createdAt=at-1800000;
  const rights=captureClosedRights(s,'u1',at);
  s.users[0].status='closed';s.privacyProfiles=[{userId:'u1',status:'use_closed',history:[{action:'账号使用关闭，历史材料待清理',closureId:'PC1'}]}];
  s.privacyClosures=[{id:'PC1',userId:'u1',status:'use_closed',createdAt:at-1000,closedAt:at,rights}];
  return s;
}
test('关闭本人服务/商品票须原票Binding，关后首次新票及月票不借原附件权限',()=>{
  const s=withClosedRights();
  assert.equal(authorizedInvoiceFile(s,user(),'I1','issued',serviceFile.ref),serviceFile);
  assert.deepEqual(authorizedInvoiceFile(s,user(),'I1','issued',file.ref,'commerce'),file);
  s.now++;
  s.commerceInvoices.push({...s.commerceInvoices[0],id:'I-new',createdAt:s.now});
  assert.throws(()=>authorizedInvoiceFile(s,user(),'I-new','issued',file.ref,'commerce'),/首次原票申请时间/);
  assert.throws(()=>authorizedInvoiceFile(s,user(),'F1','issued',file.ref,'commerce'),/原交易|来源|本人/);
  assert.throws(()=>authorizedInvoiceFile(s,{role:'user',userId:'u2'},'I1','issued',file.ref,'commerce'),/无权/);
});
test('user关闭或仅回执关闭但profile缺失时原文件也保持拒绝，不恢复普通授权',()=>{
  for(const marker of ['user','receipt']){
    const s=state();if(marker==='user')s.users[0].status='closed';else s.privacyClosures=[{id:'old',userId:'u1',status:'use_closed'}];
    assert.throws(()=>authorizedInvoiceFile(s,user(),'I1','issued',file.ref,'commerce'),/关闭依据/);
    assert.throws(()=>authorizedInvoiceFile(s,user(),'I1','issued',serviceFile.ref),/关闭依据/);
  }
});
test('异步附件回读使用新账本而非捕获的旧state，关闭依据改变不给Blob入口',async()=>{
  const original=state(),f=fixture();let current={state:original,actor:user()};
  onRead=()=>{const next=structuredClone(original);next.users[0].status='closed';current={state:next,actor:user()};};
  await hydrateInvoiceFiles(original,user(),f.root,()=>true,()=>current);
  assert.equal(f.download.href,'');assert.equal(f.view.disabled,true);assert.equal(f.content.children.length,0);assert.match(f.fileStatus.textContent,/关闭依据/);
  assert.equal(original.users[0].status,undefined);
});
test('已就绪附件查看和下载每次读取最新本人上下文，失权清理原URL',async()=>{
  const original=withClosedRights(),f=fixture();let current={state:original,actor:user()};
  await hydrateInvoiceFiles(original,user(),f.root,()=>true,()=>current);
  const url=f.download.href;assert.ok(resolveObjectURL(url));
  current={state:structuredClone(original),actor:{role:'user',userId:'u2'}};
  f.view.click();assert.equal(f.region.hidden,true);assert.equal(f.content.children.length,0);
  assert.equal(f.download.click().defaultPrevented,true);assert.equal(f.download.href,'');assert.equal(resolveObjectURL(url),undefined);
});
test('异步读回同ref元数据被替换时拒绝旧文件，不能挂旧名称/大小入口',async()=>{
  const original=state(),f=fixture();let current={state:original,actor:user()};
  onRead=()=>{const next=structuredClone(original);next.commerceInvoices[0].issued.file.name='新资料.png';current={state:next,actor:user()};};
  await hydrateInvoiceFiles(original,user(),f.root,()=>true,()=>current);
  assert.equal(f.download.href,'');assert.equal(f.view.disabled,true);assert.match(f.fileStatus.textContent,/资料已更新/);
});

test('附件就绪后当前账本同ref元数据变化，查看与下载均拒绝原Blob',async()=>{
  const original=withClosedRights(),f=fixture();let current={state:original,actor:user()};
  await hydrateInvoiceFiles(original,user(),f.root,()=>true,()=>current);
  const url=f.download.href;assert.ok(resolveObjectURL(url));
  const next=structuredClone(original);next.commerceInvoices[0].issued.file.size++;
  current={state:next,actor:user()};f.view.click();
  assert.equal(f.region.hidden,true);assert.equal(f.content.children.length,0);assert.match(f.fileStatus.textContent,/权限已更新/);
  assert.equal(f.download.click().defaultPrevented,true);assert.equal(f.download.href,'');assert.equal(resolveObjectURL(url),undefined);
});

test('服务票原描述对象就绪后原地修改不会改掉读取基准，名称变化同样拒绝',async()=>{
  const original=withClosedRights();original.serviceInvoices[0].issued.file=structuredClone(serviceFile);
  const f=fixture({domain:'service',ref:serviceFile.ref});
  await hydrateInvoiceFiles(original,user(),f.root);
  const url=f.download.href;assert.ok(resolveObjectURL(url));
  original.serviceInvoices[0].issued.file.name='同源新名称.png';f.view.click();
  assert.equal(f.region.hidden,true);assert.equal(f.view.disabled,true);
  assert.equal(f.download.click().defaultPrevented,true);assert.equal(resolveObjectURL(url),undefined);
});
