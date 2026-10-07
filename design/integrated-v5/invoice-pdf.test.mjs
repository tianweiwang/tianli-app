import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createInvoicePdfPreview } from './invoice-pdf.mjs';

const pending = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
class Element extends EventTarget {
  constructor(tag, doc) { super(); this.tagName = tag.toUpperCase(); this.ownerDocument = doc; this.children = []; this.attrs = new Map(); this.style = {}; this.isConnected = true; this.disabled = false; this.clientWidth = 638; this.textContent = ''; }
  append(...elements) { this.children.push(...elements); }
  replaceChildren(...elements) { this.children = elements; }
  setAttribute(name, value) { this.attrs.set(name, String(value)); }
  getAttribute(name) { return this.attrs.get(name) ?? null; }
  getContext() { return { canvas: this }; }
  click() { if (!this.disabled) this.dispatchEvent(new Event('click', { cancelable: true })); }
}
function fixture(options = {}) {
  const doc = { defaultView: { devicePixelRatio: 2 }, createElement: tag => new Element(tag, doc) };
  const host = new Element('div', doc), statuses = [], calls = { loads: [], pages: [], renders: [], cancel: 0, destroy: 0, denied: 0, resizeDisconnected: 0 };
  if (options.resize) doc.defaultView.ResizeObserver = class { constructor(handler) { calls.resize = handler; } observe() {} disconnect() { calls.resizeDisconnected++; } };
  let authorized = true;
  const page = number => ({
    getViewport: ({ scale }) => ({ width: (options.width || 595) * scale, height: (options.height || 842) * scale }),
    render: args => { calls.renders.push({ number, ...args }); return { promise: options.renderGate?.promise || Promise.resolve(), cancel: () => calls.cancel++ }; },
    getTextContent: () => options.textGate?.promise || Promise.resolve({ items: [{ str: 'Original PDF content', hasEOL: true }, { str: '<script>untrusted</script>' }] }),
  });
  const pdf = { numPages: options.pages || 2, getPage: number => { calls.pages.push(number); return options.pageGate?.promise || Promise.resolve(page(number)); } };
  const lib = { getDocument: args => { calls.loads.push(args); return { promise: options.documentGate?.promise || Promise.resolve(pdf), destroy: () => calls.destroy++ }; } };
  const reader = createInvoicePdfPreview(host, {
    file: { name: 'technical.pdf', type: 'application/pdf' }, blob: new Blob(['%PDF-technical'], { type: 'application/pdf' }),
    isAuthorized: () => authorized && !options.authThrows,
    onStatus: message => statuses.push(message), onDenied: () => calls.denied++,
  }, { loadPdf: () => options.libraryGate?.promise || Promise.resolve(lib) });
  const toolbar = host.children[0], viewport = host.children[1], details = host.children[2];
  return { host, reader, calls, statuses, toolbar, viewport, details, previous: toolbar.children[0], counter: toolbar.children[1], next: toolbar.children[2], zoom: toolbar.children[3].children[1], lib, pdf, page, revoke: () => { authorized = false; } };
}

test('PDF bytes render locally before success, with safe extracted text and page controls', async t => {
  const f = fixture(); t.after(f.reader.destroy); await f.reader.ready;
  assert.equal(f.calls.loads.length, 1);
  const parameters = f.calls.loads[0];
  assert.ok(parameters.data instanceof Uint8Array); assert.equal(parameters.isEvalSupported, false); assert.equal(parameters.enableXfa, false);
  for (const name of ['cMapUrl', 'standardFontDataUrl', 'wasmUrl', 'iccUrl']) assert.match(parameters[name], /vendor\/pdfjs-5\.6\.205\//);
  assert.equal(f.viewport.children[0].tagName, 'CANVAS'); assert.equal(f.viewport.children[0].getAttribute('data-invoice-pdf-page'), '1');
  assert.match(f.statuses.at(-1), /PDF已显示.*1 \/ 2/); assert.equal(f.previous.disabled, true); assert.equal(f.next.disabled, false);
  assert.equal(f.details.hidden, false); assert.equal(f.details.children[1].textContent, 'Original PDF content\n<script>untrusted</script>');
});

test('render pending never reports PDF visible until actual render completion', async t => {
  const gate = pending(), f = fixture({ renderGate: gate }); t.after(f.reader.destroy);
  await tick(); assert.equal(f.viewport.children.length, 0); assert.equal(f.next.disabled, true);
  assert.equal(f.statuses.some(x => x.includes('已显示')), false);
  gate.resolve(); await f.reader.ready; assert.equal(f.viewport.children[0].tagName, 'CANVAS');
  assert.match(f.statuses.at(-1), /已显示/);
});

test('closing before library initialization cannot load bytes or create a stale document', async () => {
  const gate = pending(), f = fixture({ libraryGate: gate });
  f.reader.destroy(); gate.resolve(f.lib); await f.reader.ready;
  assert.equal(f.calls.loads.length, 0); assert.equal(f.host.children.length, 0); assert.equal(f.calls.denied, 0);
  assert.equal(f.statuses.some(x => x.includes('已显示')), false);
});

test('route cleanup during document loading destroys the task and ignores its late result', async () => {
  const gate = pending(), f = fixture({ documentGate: gate }); await tick();
  assert.equal(f.calls.loads.length, 1); f.reader.destroy(); gate.resolve(f.pdf); await f.reader.ready;
  assert.equal(f.calls.destroy, 1); assert.equal(f.calls.pages.length, 0); assert.equal(f.host.children.length, 0);
});

test('permission lost while reading a page clears the region before any pixels are attached', async () => {
  const gate = pending(), f = fixture({ pageGate: gate }); await tick();
  f.revoke(); gate.resolve(f.page(1)); await f.reader.ready;
  assert.equal(f.calls.denied, 1); assert.equal(f.calls.destroy, 1); assert.equal(f.host.children.length, 0); assert.equal(f.calls.renders.length, 0);
});

test('permission lost during rendering cancels and discards the pending canvas', async () => {
  const gate = pending(), f = fixture({ renderGate: gate }); await tick();
  f.revoke(); gate.resolve(); await f.reader.ready;
  assert.equal(f.host.children.length, 0); assert.equal(f.calls.denied, 1); assert.ok(f.calls.cancel >= 1);
  assert.equal(f.calls.renders[0].canvasContext.canvas.width, 0); assert.equal(f.calls.renders[0].canvasContext.canvas.height, 0);
  assert.equal(f.statuses.some(x => x.includes('已显示')), false);
});

test('close immediately zeros the pending render allocation before its promise settles', async () => {
  const gate = pending(), f = fixture({ renderGate: gate }); await tick();
  const canvas = f.calls.renders[0].canvasContext.canvas; assert.ok(canvas.width > 0);
  f.reader.destroy(); assert.equal(canvas.width, 0); assert.equal(canvas.height, 0); assert.equal(f.host.children.length, 0);
  gate.resolve(); await f.reader.ready; assert.equal(f.statuses.some(x => x.includes('已显示')), false);
});

test('permission lost during text extraction removes already rendered pixels and text', async () => {
  const gate = pending(), f = fixture({ textGate: gate }); await tick();
  const canvas = f.viewport.children[0]; assert.equal(canvas.tagName, 'CANVAS');
  f.revoke(); gate.resolve({ items: [{ str: 'private late text' }] }); await f.reader.ready;
  assert.equal(canvas.width, 0); assert.equal(f.host.children.length, 0); assert.equal(f.calls.denied, 1);
  assert.equal(f.details.children[1].textContent, '');
});

test('page boundaries, next/previous and explicit zoom create fresh rendered canvases', async t => {
  const f = fixture(); t.after(f.reader.destroy); await f.reader.ready;
  const first = f.viewport.children[0]; f.next.click(); await tick();
  assert.equal(first.width, 0); assert.equal(f.counter.textContent, '第 2 / 2 页'); assert.equal(f.next.disabled, true); assert.equal(f.previous.disabled, false);
  assert.equal(f.viewport.children[0].getAttribute('data-invoice-pdf-page'), '2');
  f.previous.click(); await tick(); assert.equal(f.counter.textContent, '第 1 / 2 页');
  f.zoom.value = '1.5'; f.zoom.dispatchEvent(new Event('change')); await tick();
  assert.equal(f.calls.renders.at(-1).viewport.width, 892.5); assert.equal(f.viewport.children[0].style.width, '892.5px');
});

test('rapid zoom changes ignore a stale page load instead of replacing the newest page', async t => {
  const options = {}, f = fixture(options); t.after(f.reader.destroy); await f.reader.ready;
  const old = pending(), latest = pending(); options.pageGate = old;
  f.zoom.value = '1.5'; f.zoom.dispatchEvent(new Event('change')); await tick();
  options.pageGate = latest; f.zoom.value = '2'; f.zoom.dispatchEvent(new Event('change')); await tick();
  latest.resolve(f.page(1)); await tick(); const canvas = f.viewport.children[0];
  assert.equal(canvas.style.width, '1190px'); old.resolve(f.page(1)); await tick();
  assert.equal(f.viewport.children[0], canvas); assert.equal(f.calls.renders.length, 2);
});

test('responsive fit rerenders to the viewport width and cleanup disconnects resize observation', async () => {
  const f = fixture({ resize: true }); await f.reader.ready;
  f.viewport.clientWidth = 296; f.calls.resize(); await tick();
  assert.equal(f.viewport.children[0].style.width, '296px');
  f.zoom.value = '1'; f.zoom.dispatchEvent(new Event('change')); await tick();
  const count = f.calls.renders.length; f.viewport.clientWidth = 900; f.calls.resize(); await tick();
  assert.equal(f.calls.renders.length, count);
  f.reader.destroy(); assert.equal(f.calls.resizeDisconnected, 1);
});

test('document loading/password errors leave truthful feedback with no rendered success', async () => {
  for (const name of ['InvalidPDFException', 'PasswordException']) {
    const gate = pending(), f = fixture({ documentGate: gate }); await tick();
    gate.reject(Object.assign(new Error('test input'), { name })); await f.reader.ready;
    assert.equal(f.viewport.children.length, 0); assert.equal(f.statuses.some(x => x.includes('已显示')), false);
    assert.match(f.statuses.at(-1), name === 'PasswordException' ? /需要密码/ : /暂时无法显示/);
    assert.equal(f.zoom.disabled, true); assert.equal(f.counter.textContent, '页数不可用'); f.reader.destroy();
  }
});

test('render error clears pending pixels and cleanup remains idempotent', async () => {
  const gate = pending(), f = fixture({ renderGate: gate }); await tick();
  gate.reject(new Error('canvas failure')); await f.reader.ready;
  assert.equal(f.viewport.children.length, 0); assert.match(f.statuses.at(-1), /暂时无法显示/);
  assert.equal(f.calls.renders[0].canvasContext.canvas.width, 0);
  f.reader.destroy(); f.reader.destroy(); assert.equal(f.calls.destroy, 1);
  f.next.disabled = false; f.next.click(); assert.equal(f.calls.pages.length, 1);
});

test('large pages respect per-page pixel and axis allocation bounds', async t => {
  const f = fixture({ width: 100000, height: 1000000 }); t.after(f.reader.destroy); await f.reader.ready;
  f.zoom.value = '2'; f.zoom.dispatchEvent(new Event('change')); await tick();
  const canvas = f.viewport.children[0]; assert.ok(canvas.width * canvas.height <= 16 * 1024 * 1024);
  assert.ok(canvas.width <= 8192 && canvas.height <= 8192);
});

test('shipped PDF renderer resources match pinned official provenance and contain licenses', () => {
  const base = new URL('./vendor/pdfjs-5.6.205/', import.meta.url);
  const provenance = JSON.parse(readFileSync(new URL('provenance.json', base), 'utf8'));
  assert.equal(provenance.package, 'pdfjs-dist'); assert.equal(provenance.version, '5.6.205'); assert.equal(provenance.build, 'legacy/build'); assert.equal(provenance.license, 'Apache-2.0');
  assert.equal(provenance.source, 'https://registry.npmjs.org/pdfjs-dist/-/pdfjs-dist-5.6.205.tgz');
  assert.match(readFileSync(new URL('LICENSE', base), 'utf8'), /Apache License/);
  for (const [path, expected] of Object.entries(provenance.files)) assert.equal(createHash('sha256').update(readFileSync(new URL(path, base))).digest('hex'), expected, path);
});
