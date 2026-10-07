import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveObjectURL } from 'node:buffer';
import { bindInvoicePreview, clearInvoiceFileUrls } from './invoice-files.mjs';

// These DOM stand-ins exercise event lifetime and actual Node Blob URL
// revocation; browser rendering is verified separately in the real detail page.
class Element extends EventTarget {
  constructor(tag = 'div') { super(); this.tagName = tag.toUpperCase(); this.children = []; this.attrs = new Map(); this.style = {}; this.hidden = false; this.disabled = false; this.isConnected = true; this.textContent = ''; }
  setAttribute(name, value) { this.attrs.set(name, String(value)); }
  getAttribute(name) { return this.attrs.get(name) ?? null; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = [...nodes]; }
  click() { if (!this.disabled) this.dispatchEvent(new Event('click', { cancelable: true })); }
}
const fixture = (type = 'image/png', auth = () => true) => {
  const node = new Element(), view = new Element('button'), close = new Element('button');
  const region = new Element('section'), content = new Element(), status = new Element('p'), fileStatus = new Element('span');
  const download = new Element('a'); download.href = 'existing-download-url';
  region.hidden = true; view.disabled = true;
  const controls = new Map([
    ['button[data-invoice-action="view"]', view], ['button[data-invoice-action="close-preview"]', close],
    ['[data-invoice-preview]', region], ['[data-invoice-preview-content]', content],
    ['[data-invoice-preview-status]', status], ['[data-invoice-file-status]', fileStatus],
  ]);
  node.querySelector = selector => controls.get(selector) ?? null;
  const ownerDocument = { createElement: tag => { const element = new Element(tag); element.ownerDocument = ownerDocument; return element; } };
  for (const element of [node, view, close, region, content, status, fileStatus]) element.ownerDocument = ownerDocument;
  const file = { name: '<技术样本>.png', type }, blob = new Blob(['technical-demo'], { type });
  const cleanup = bindInvoicePreview(node, file, blob, auth, { loadPdf: () => new Promise(() => {}) });
  return { node, view, close, region, content, status, fileStatus, download, cleanup };
};

test('image preview opens only on explicit click, stays inline and retains independent download link', t => {
  t.after(clearInvoiceFileUrls);
  const f = fixture();
  assert.equal(f.content.children.length, 0); assert.equal(f.region.hidden, true);
  f.view.click();
  const media = f.content.children[0], url = media.src;
  assert.equal(media.tagName, 'IMG'); assert.equal(media.alt, '<技术样本>.png');
  assert.ok(resolveObjectURL(url)); assert.equal(f.region.hidden, false);
  assert.equal(f.view.getAttribute('aria-expanded'), 'true');
  assert.equal(f.view.getAttribute('href'), null); assert.equal(f.view.getAttribute('target'), null);
  assert.equal(f.download.href, 'existing-download-url');
  media.dispatchEvent(new Event('load')); assert.match(f.status.textContent, /已加载/);
  f.close.click();
  assert.equal(resolveObjectURL(url), undefined); assert.equal(f.content.children.length, 0);
  assert.equal(f.region.hidden, true); assert.equal(f.view.getAttribute('aria-expanded'), 'false');
  assert.equal(f.download.href, 'existing-download-url');
});

test('reopening revokes old URL and a late event cannot overwrite the new preview state', t => {
  t.after(clearInvoiceFileUrls);
  const f = fixture(); f.view.click(); const old = f.content.children[0];
  f.view.click(); const current = f.content.children[0];
  assert.notEqual(current.src, old.src); assert.equal(resolveObjectURL(old.src), undefined);
  old.dispatchEvent(new Event('load')); assert.match(f.status.textContent, /正在读取/);
  old.dispatchEvent(new Event('error')); assert.equal(f.content.children[0], current);
  current.dispatchEvent(new Event('load')); assert.match(f.status.textContent, /已加载/);
});

test('changed permission or attachment refuses a new preview and clears an already open preview', t => {
  t.after(clearInvoiceFileUrls);
  let permitted = true; const f = fixture('image/png', () => permitted);
  f.view.click(); const url = f.content.children[0].src;
  permitted = false; f.view.click();
  assert.equal(f.content.children.length, 0); assert.equal(f.region.hidden, true);
  assert.equal(resolveObjectURL(url), undefined); assert.equal(f.view.disabled, true);
  assert.match(f.fileStatus.textContent, /权限已更新/);
  f.view.click(); assert.equal(f.content.children.length, 0);
});

test('a revoked identity during asynchronous image load removes the bytes instead of reporting success', t => {
  t.after(clearInvoiceFileUrls);
  let permitted = true; const f = fixture('image/png', () => permitted);
  f.view.click(); const media = f.content.children[0], url = media.src;
  permitted = false; media.dispatchEvent(new Event('load'));
  assert.equal(f.region.hidden, true); assert.equal(f.content.children.length, 0);
  assert.equal(resolveObjectURL(url), undefined); assert.equal(f.view.disabled, true);
  assert.doesNotMatch(f.status.textContent, /已加载/);
});

test('route or identity cleanup removes embedded documents, URLs and stale button listeners', () => {
  const f = fixture(); f.view.click(); const url = f.content.children[0].src;
  clearInvoiceFileUrls();
  assert.equal(resolveObjectURL(url), undefined); assert.equal(f.region.hidden, true);
  assert.equal(f.content.children.length, 0); assert.equal(f.view.disabled, true);
  f.view.disabled = false; f.view.click(); assert.equal(f.content.children.length, 0);
  f.cleanup(); // repeated cleanup remains safe
});

test('image rendering failure releases its URL and leaves readable feedback with a close action', t => {
  t.after(clearInvoiceFileUrls);
  const f = fixture(); f.view.click(); const media = f.content.children[0], url = media.src;
  media.dispatchEvent(new Event('error'));
  assert.equal(resolveObjectURL(url), undefined); assert.equal(f.content.children.length, 0);
  assert.equal(f.region.hidden, false); assert.match(f.status.textContent, /无法显示.*下载/);
  f.close.click(); assert.equal(f.region.hidden, true);
});

test('PDF opens a local inline reader in loading state without object navigation or a false success claim', t => {
  t.after(clearInvoiceFileUrls);
  const f = fixture('application/pdf'); f.view.click();
  assert.equal(f.content.children[0].className, 'invoice-pdf-toolbar');
  assert.equal(f.content.children[1].className, 'invoice-pdf-viewport');
  assert.equal(f.content.children.some(x => ['OBJECT', 'IFRAME'].includes(x.tagName)), false);
  assert.match(f.status.textContent, /正在读取PDF/); assert.doesNotMatch(f.status.textContent, /已显示|成功/);
  f.close.click(); assert.equal(f.content.children.length, 0); assert.equal(f.region.hidden, true);
});

test('detached page controls and authorization errors fail closed without creating preview bytes', t => {
  t.after(clearInvoiceFileUrls);
  const detached = fixture(); detached.node.isConnected = false; detached.view.click();
  assert.equal(detached.content.children.length, 0); assert.equal(detached.view.disabled, true);
  const error = fixture('image/png', () => { throw new Error('expired'); }); error.view.click();
  assert.equal(error.content.children.length, 0); assert.equal(error.view.disabled, true);
});

test('closing one attachment keeps another open, while page cleanup clears both lifetimes', () => {
  const a = fixture(), b = fixture('application/pdf'); a.view.click(); b.view.click();
  const imageUrl = a.content.children[0].src;
  a.close.click(); assert.equal(resolveObjectURL(imageUrl), undefined);
  assert.equal(b.region.hidden, false);
  assert.equal(b.content.children.length, 3);
  clearInvoiceFileUrls(); assert.equal(b.content.children.length, 0); assert.equal(b.region.hidden, true);
});
