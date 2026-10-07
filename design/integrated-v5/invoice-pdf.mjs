// Local PDF pixels only: no PDF scripts, external viewer, or business writes.
const PDF_VERSION = '5.6.205';
const ASSETS = new URL(`./vendor/pdfjs-${PDF_VERSION}/`, import.meta.url);
const MAX_PIXELS = 16 * 1024 * 1024;
const MAX_SIDE = 8192;
let library;

export function loadInvoicePdfLibrary() {
  return library ||= import(new URL('pdf.min.mjs', ASSETS).href).then(pdf => {
    if (pdf.version !== PDF_VERSION) throw new Error('PDF renderer version mismatch');
    pdf.GlobalWorkerOptions.workerSrc = new URL('pdf.worker.min.mjs', ASSETS).href;
    return pdf;
  }).catch(error => { library = undefined; throw error; });
}

const quietly = value => { try { Promise.resolve(value?.()).catch(() => {}); } catch {} };
const button = (doc, text) => {
  const element = doc.createElement('button');
  element.type = 'button'; element.className = 'secondary'; element.textContent = text;
  return element;
};

// The caller owns the authorized detail region and removes it on route changes.
// A loader argument lets lifecycle tests control real asynchronous boundaries.
export function createInvoicePdfPreview(host, { file, blob, isAuthorized, onStatus, onDenied }, { loadPdf = loadInvoicePdfLibrary } = {}) {
  const doc = host.ownerDocument;
  const toolbar = doc.createElement('div'); toolbar.className = 'invoice-pdf-toolbar';
  const previous = button(doc, '上一页'), next = button(doc, '下一页');
  const counter = doc.createElement('span'); counter.className = 'small muted'; counter.setAttribute('role', 'status');
  const zoomLabel = doc.createElement('label'); zoomLabel.className = 'invoice-pdf-zoom';
  const zoomText = doc.createElement('span'); zoomText.textContent = '缩放';
  const zoom = doc.createElement('select'); zoom.setAttribute('aria-label', 'PDF缩放');
  for (const [value, label] of [['fit', '适应宽度'], ['0.5', '50%'], ['0.75', '75%'], ['1', '100%'], ['1.25', '125%'], ['1.5', '150%'], ['2', '200%']]) {
    const option = doc.createElement('option'); option.value = value; option.textContent = label; zoom.append(option);
  }
  zoom.value = 'fit'; zoomLabel.append(zoomText, zoom);
  toolbar.append(previous, counter, next, zoomLabel);
  const viewport = doc.createElement('div'); viewport.className = 'invoice-pdf-viewport';
  viewport.setAttribute('aria-label', 'PDF页面'); viewport.tabIndex = 0;
  const textDetails = doc.createElement('details'); textDetails.className = 'invoice-pdf-text';
  const textSummary = doc.createElement('summary'); textSummary.textContent = '本页文字';
  const pageText = doc.createElement('p'); pageText.setAttribute('data-invoice-pdf-text', '');
  textDetails.append(textSummary, pageText); textDetails.hidden = true;
  host.append(toolbar, viewport, textDetails);

  let disposed = false, loading, pdf, renderTask, currentCanvas, pendingCanvas, observer;
  let pageNumber = 1, pageCount = 0, generation = 0, busy = true, lastWidth;
  const listeners = [];
  const controls = () => {
    previous.disabled = disposed || busy || pageNumber <= 1;
    next.disabled = disposed || busy || pageNumber >= pageCount;
    zoom.disabled = disposed || !pdf;
    counter.textContent = pageCount ? `第 ${pageNumber} / ${pageCount} 页` : busy ? '正在读取页数…' : '页数不可用';
  };
  const clearCanvas = () => {
    for (const canvas of new Set([currentCanvas, pendingCanvas])) if (canvas) { canvas.width = 0; canvas.height = 0; }
    currentCanvas = undefined; pendingCanvas = undefined;
  };
  const destroy = () => {
    if (disposed) return;
    disposed = true; generation++;
    quietly(() => renderTask?.cancel());
    quietly(() => loading?.destroy());
    if (!loading) quietly(() => pdf?.destroy());
    observer?.disconnect();
    for (const [element, name, handler] of listeners) element.removeEventListener(name, handler);
    clearCanvas(); pageText.textContent = ''; host.replaceChildren();
    blob = undefined; pdf = undefined; loading = undefined;
  };
  const allowed = () => {
    if (disposed) return false;
    let valid = false;
    try { valid = host.isConnected && isAuthorized() === true; } catch {}
    if (!valid) { destroy(); onDenied(); }
    return valid;
  };
  const failure = error => {
    if (!allowed()) return;
    quietly(() => renderTask?.cancel()); clearCanvas(); viewport.replaceChildren();
    pageText.textContent = ''; textDetails.hidden = true;
    busy = false; controls();
    onStatus(error?.name === 'PasswordException' ? '此PDF需要密码，当前无法预览。请下载原件后查看，或联系门店补传可直接读取的凭证。' : '此PDF暂时无法显示。请关闭后重试，或下载原件后查看。');
  };
  const listen = (element, name, handler) => { element.addEventListener(name, handler); listeners.push([element, name, handler]); };
  const width = () => Math.max(1, Math.min(Number(viewport.clientWidth) || Number(host.clientWidth) || 640, 960));

  const render = async () => {
    if (!allowed() || !pdf) return;
    const current = ++generation, target = pageNumber;
    quietly(() => renderTask?.cancel());
    busy = true; controls();
    clearCanvas(); viewport.replaceChildren(); pageText.textContent = ''; textDetails.hidden = true;
    onStatus(`正在显示PDF第 ${target} 页…`);
    const live = () => current === generation && allowed();
    let canvas;
    try {
      const page = await pdf.getPage(target);
      if (!live()) return;
      const base = page.getViewport({ scale: 1 });
      if (![base.width, base.height].every(n => Number.isFinite(n) && n > 0)) throw new Error('Invalid PDF page dimensions');
      lastWidth = width();
      const scale = zoom.value === 'fit' ? lastWidth / base.width : Number(zoom.value);
      if (!Number.isFinite(scale) || scale <= 0 || scale > 16) throw new Error('Invalid PDF zoom');
      const view = page.getViewport({ scale });
      const deviceScale = Math.min(2, Math.max(1, Number(doc.defaultView?.devicePixelRatio) || 1));
      const pixels = Math.min(deviceScale, Math.sqrt(MAX_PIXELS / (view.width * view.height)), MAX_SIDE / Math.max(view.width, view.height));
      canvas = doc.createElement('canvas');
      pendingCanvas = canvas;
      canvas.width = Math.max(1, Math.floor(view.width * pixels)); canvas.height = Math.max(1, Math.floor(view.height * pixels));
      canvas.style.width = `${view.width}px`; canvas.style.height = `${view.height}px`;
      canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', `${file.name} · 第 ${target} 页`);
      canvas.setAttribute('data-invoice-pdf-page', String(target));
      const context = canvas.getContext('2d'); if (!context) throw new Error('Canvas unavailable');
      renderTask = page.render({ canvasContext: context, viewport: view, transform: [pixels, 0, 0, pixels, 0, 0], background: '#ffffff' });
      await renderTask.promise;
      if (!live()) { canvas.width = 0; canvas.height = 0; return; }
      currentCanvas = canvas; pendingCanvas = undefined; viewport.replaceChildren(canvas); viewport.scrollTop = 0; viewport.scrollLeft = 0;
      busy = false; controls(); onStatus(`PDF已显示 · 第 ${target} / ${pageCount} 页。`);
      // Text is derived from this page, never inserted as executable HTML.
      try {
        const text = await page.getTextContent();
        if (!live()) return;
        const value = text.items.filter(item => typeof item.str === 'string').map(item => item.str + (item.hasEOL ? '\n' : ' ')).join('').trim();
        pageText.textContent = value || '本页为图片或没有可提取文字，请查看上方页面。';
        textDetails.hidden = false;
      } catch { if (live()) { pageText.textContent = '本页文字无法提取，请查看上方页面。'; textDetails.hidden = false; } }
    } catch (error) {
      if (canvas && currentCanvas !== canvas) { canvas.width = 0; canvas.height = 0; }
      if (current === generation && error?.name !== 'RenderingCancelledException') failure(error);
    }
  };
  listen(previous, 'click', event => { event.preventDefault(); if (!busy && pageNumber > 1 && allowed()) { pageNumber--; void render(); } });
  listen(next, 'click', event => { event.preventDefault(); if (!busy && pageNumber < pageCount && allowed()) { pageNumber++; void render(); } });
  listen(zoom, 'change', () => { if (allowed() && pdf) void render(); });
  controls(); onStatus('正在读取PDF预览…');

  const ready = (async () => {
    try {
      const lib = await loadPdf(); if (!allowed()) return;
      const data = new Uint8Array(await blob.arrayBuffer()); if (!allowed()) return;
      loading = lib.getDocument({ data, cMapUrl: new URL('cmaps/', ASSETS).href, cMapPacked: true, standardFontDataUrl: new URL('standard_fonts/', ASSETS).href, wasmUrl: new URL('wasm/', ASSETS).href, iccUrl: new URL('iccs/', ASSETS).href, isEvalSupported: false, enableXfa: false, canvasMaxAreaInBytes: MAX_PIXELS * 4 });
      const document = await loading.promise; if (!allowed()) return;
      pdf = document; pageCount = pdf.numPages;
      if (!Number.isSafeInteger(pageCount) || pageCount < 1) throw new Error('PDF has no pages');
      await render();
      if (!allowed()) return;
      const Observer = doc.defaultView?.ResizeObserver;
      if (Observer) { observer = new Observer(() => { if (zoom.value === 'fit' && width() !== lastWidth && allowed()) void render(); }); observer.observe(host); }
    } catch (error) { failure(error); }
  })();
  return { destroy, ready };
}
