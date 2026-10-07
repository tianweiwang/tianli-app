// Local demo attachments: bytes are stored separately from the JSON business ledger.
import { canReadInvoice } from './service-invoices.mjs';
import { authorizedCommerceInvoiceFile } from './commerce-invoices.mjs';
import { authorizedServiceExtraFile } from './service-finance-extras.mjs';
import { authorizedServicePromotionFile } from './service-promotion.mjs';
import { authorizedServiceFinanceCompositionFile } from './service-finance-composition-review.mjs';
import { resolveAccountActor, canAccountView } from './staff-accounts.mjs';
import { privacyUseClosed } from './privacy.mjs';
import { closedRightsBinding } from './privacy-closed-rights.mjs';
import { createInvoicePdfPreview } from './invoice-pdf.mjs';
import { careEvidenceFile } from './service-care.mjs';
import { qualificationEvidenceFile } from './tech-qualification.mjs';
import { createTechHistoricalRightsAdapters } from './tech-historical-rights.mjs';
const TYPES = ['application/pdf', 'image/png', 'image/jpeg'];
export const INVOICE_FILE_LIMIT = 5 * 1024 * 1024;
let database;
const activeUrls = new Set();
const previewCleanups = new Set();
export function invoiceFileName(name) {
  return String(name || '凭证').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 150);
}
export async function validateInvoiceFile(file) {
  if (!file || !TYPES.includes(file.type) || !Number.isSafeInteger(file.size) || file.size <= 0 || file.size > INVOICE_FILE_LIMIT) throw new Error('请选择 5 MiB 以内的 PDF、PNG 或 JPEG 文件。');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const png = [137,80,78,71,13,10,26,10].every((v,i) => bytes[i] === v);
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 && bytes.at(-2) === 255 && bytes.at(-1) === 217;
  const pdf = new TextDecoder().decode(bytes.slice(0, 5)) === '%PDF-' && new TextDecoder().decode(bytes.slice(-1024)).includes('%%EOF');
  if (!(file.type === 'application/pdf' ? pdf : file.type === 'image/png' ? png : jpeg)) throw new Error('文件内容与所选格式不符，请重新选择完整的票据文件。');
  if (file.type.startsWith('image/')) {
    try {
      if (typeof createImageBitmap !== 'function') throw new Error('无法解析图片');
      const bitmap = await createImageBitmap(file);
      const valid = bitmap.width > 0 && bitmap.height > 0; bitmap.close();
      if (!valid) throw new Error('图片为空');
    } catch { throw new Error('图片凭证无法解码，请重新选择可正常打开的完整图片。'); }
  }
  return bytes;
}
function open() {
  return database ||= new Promise((resolve, reject) => {
    const request = indexedDB.open('tianli-integrated-invoice-files-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('files');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { database = undefined; reject(new Error('附件存储无法打开，请检查浏览器存储权限。')); };
  });
}
export async function saveInvoiceFile(file) {
  const bytes = await validateInvoiceFile(file);
  const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('');
  const ref = 'invoice-file:' + digest, db = await open();
  await new Promise((resolve, reject) => {
    const tx = db.transaction('files', 'readwrite');
    tx.objectStore('files').put(new Blob([bytes], { type: file.type }), ref);
    tx.oncomplete = resolve;
    tx.onerror = tx.onabort = () => reject(new Error('附件保存失败，请释放浏览器存储空间后重试。'));
  });
  return { ref, name: invoiceFileName(file.name), type: file.type, size: file.size };
}
export async function readInvoiceFile(file) {
  if (!file || !/^invoice-file:[a-f0-9]{64}$/.test(file.ref)) throw new Error('附件引用无效。');
  const db = await open();
  const blob = await new Promise((resolve, reject) => {
    const request = db.transaction('files').objectStore('files').get(file.ref);
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(new Error('附件读取失败，请重试。'));
  });
  if (!blob) throw new Error('本机附件缺失，请联系开票门店补传凭证。');
  if (blob.size !== file.size || blob.type !== file.type) throw new Error('附件资料与文件不一致，请重新上传。');
  return blob;
}
export function authorizedInvoiceFile(s, actor, id, slot, ref, domain = 'service') {
  if(domain==='service-finance-composition') return authorizedServiceFinanceCompositionFile(s,actor,id,slot,ref);
  if(domain==='tech-history-promotion') {
    const result=createTechHistoricalRightsAdapters().authorizeFile(s,actor,ref,{id,slot});
    if(!result.allowed||!result.file||result.id!==id||result.slot!==slot)throw new Error('当前本人或原来源槽无权查看历史附件。');
    return result.file;
  }
  if(domain==='qualification') {
    const file=qualificationEvidenceFile(s,actor,id,slot);
    if(file.ref!==ref)throw new Error('原资格凭证引用已变化，请从原资格记录重新进入。');
    return file;
  }
  if(domain==='care') {
    const file=careEvidenceFile(s,actor,id,slot,{assertUserScope:(current,a,kind,sourceId)=>{if(privacyUseClosed(current,a.userId))closedRightsBinding(current,a,kind,sourceId);}});
    if(file.ref!==ref)throw new Error('原投诉图片引用已变化，请从原案件重新进入。');
    return file;
  }
  const userActor=actor?.role==='user'?resolveAccountActor(s,actor):null;
  if(userActor?.role==='user'&&privacyUseClosed(s,userActor.userId)&&['service','commerce'].includes(domain)) {
    const kind=domain==='service'?'service-invoice':'goods-invoice';
    closedRightsBinding(s,userActor,kind,id);
  }
  if (domain === 'commerce') return authorizedCommerceInvoiceFile(s, actor, id, slot, ref);
  if (domain === 'service-extra') return authorizedServiceExtraFile(s,actor,id,slot,ref);
  if(domain==='service-promotion') {
    actor=resolveAccountActor(s,actor);
    if(!canAccountView(actor,'service-promotion'))throw new Error('当前岗位无权查看服务推广附件。');
    return authorizedServicePromotionFile(s,actor,id,slot,ref);
  }
  if(domain==='service-finance') {
    actor=resolveAccountActor(s,actor);
    if(actor.role!=='group'||!['finance','all'].includes(actor.job)||!canAccountView(actor,'service-finance'))throw new Error('当前岗位无权查看原服务回款附件。');
    const debt=(s.serviceFinanceRecoveries||[]).find(x=>x.id===id),entry=debt&&(s.serviceFinanceEntries||[]).find(x=>x.id===debt.entryId),booking=entry&&(s.bookings||[]).find(x=>x.id===entry.bookingId),payment=[booking?.payment,...(booking?.extensions||[])].find(x=>x?.id===entry?.paymentId),snapshot=payment===booking?.payment?booking?.servicePromotionSnapshot:payment?.servicePromotionSnapshot;
    if(!debt||!entry||!booking||!payment||!snapshot?.promoter||debt.bookingId!==booking.id||debt.paymentId!==payment.id||debt.storeId!==booking.storeId||entry.storeId!==booking.storeId)throw new Error('原服务回款附件来源缺失或串号。');
    const match=/^recovery:([A-Za-z0-9_-]+):(\d+)$/.exec(String(slot)),record=match&&debt.records?.find(x=>x.id===match[1]),file=record?.evidenceRefs?.[Number(match?.[2])];
    if(!file||file.ref!==ref)throw new Error('原服务回款附件已变化或无权读取此槽。');
    return structuredClone(file);
  }
  if (domain !== 'service') throw new Error('票据附件所属业务无效，请从原发票详情重新进入。');
  actor = resolveAccountActor(s, actor);
  if (!canAccountView(actor, 'invoices')) throw new Error('当前岗位无权查看服务发票附件。');
  const inv = s.serviceInvoices?.find(i => i.id === id);
  if (!inv || actor.role === 'manager' || !canReadInvoice(actor, inv, s)) throw new Error('当前身份无权查看此附件。');
  const file = ['issued', 'red'].includes(slot) ? inv[slot]?.file : null;
  if (!file || file.ref !== ref) throw new Error('附件已更新，请刷新后查看最新凭证。');
  return file;
}
export function clearInvoiceFileUrls() {
  for (const cleanup of previewCleanups) cleanup();
  previewCleanups.clear();
  for (const url of activeUrls) URL.revokeObjectURL(url);
  activeUrls.clear();
}
// The preview stays inside the permission-checked detail page. Its URL is
// separate from the download URL so closing it does not invalidate downloads.
export function bindInvoicePreview(node, file, blob, isAuthorized, pdfOptions = {}) {
  const view = node.querySelector('button[data-invoice-action="view"]');
  const close = node.querySelector('button[data-invoice-action="close-preview"]');
  const region = node.querySelector('[data-invoice-preview]');
  const content = node.querySelector('[data-invoice-preview-content]');
  const status = node.querySelector('[data-invoice-preview-status]');
  if (!view || !close || !region || !content || !status) return () => {};
  let previewUrl, pdfPreview, session = 0;
  const hide = () => {
    session++; pdfPreview?.destroy(); pdfPreview = undefined;
    content.replaceChildren(); region.hidden = true;
    view.setAttribute('aria-expanded', 'false'); status.textContent = '';
    if (previewUrl) { URL.revokeObjectURL(previewUrl); activeUrls.delete(previewUrl); previewUrl = undefined; }
  };
  const allowed = () => { try { return node.isConnected && isAuthorized() === true; } catch { return false; } };
  const show = event => {
    event.preventDefault();
    if (!allowed()) {
      hide(); view.disabled = true;
      const fileStatus = node.querySelector('[data-invoice-file-status]');
      if (fileStatus) fileStatus.textContent = '凭证或查看权限已更新，请刷新后再查看。';
      return;
    }
    hide();
    const currentSession = session;
    region.hidden = false; view.setAttribute('aria-expanded', 'true');
    if (file.type === 'application/pdf') {
      pdfPreview = createInvoicePdfPreview(content, {
        file, blob, isAuthorized: () => session === currentSession && allowed(),
        onStatus: message => { if (session === currentSession && allowed()) status.textContent = message; },
        onDenied: () => {
          if (session !== currentSession) return;
          hide(); view.disabled = true;
          const fileStatus = node.querySelector('[data-invoice-file-status]');
          if (fileStatus) fileStatus.textContent = '凭证或查看权限已更新，请刷新后再查看。';
        },
      }, pdfOptions);
      return;
    }
    const url = URL.createObjectURL(blob); previewUrl = url; activeUrls.add(url);
    const media = node.ownerDocument.createElement('img');
    const current = () => previewUrl === url && allowed();
    const unavailable = () => {
      if (previewUrl !== url) return;
      if (!allowed()) { hide(); view.disabled = true; return; }
      content.replaceChildren();
      URL.revokeObjectURL(url); activeUrls.delete(url); previewUrl = undefined;
      status.textContent = '当前浏览器无法显示此凭证，请使用下载入口后查看。';
    };
    media.addEventListener('error', unavailable);
    media.alt = file.name; media.src = url;
    status.textContent = '正在读取图片预览…';
    media.addEventListener('load', () => {
      if (current()) status.textContent = '图片预览已加载。';
      else if (previewUrl === url) { hide(); view.disabled = true; }
    });
    content.append(media);
  };
  const dismiss = event => { event.preventDefault(); hide(); };
  view.disabled = false;
  view.addEventListener('click', show); close.addEventListener('click', dismiss);
  const cleanup = () => {
    hide(); view.disabled = true;
    view.removeEventListener('click', show); close.removeEventListener('click', dismiss);
    previewCleanups.delete(cleanup);
  };
  previewCleanups.add(cleanup);
  return cleanup;
}
export function hydrateInvoiceFiles(s, actor, root = document, isCurrent = () => true, currentContext = () => ({state:s,actor})) {
  return Promise.all([...root.querySelectorAll('[data-invoice-file]')].map(async node => {
    const id = node.dataset.invoiceId, slot = node.dataset.invoiceSlot, ref = node.dataset.invoiceFile;
    const domain = node.dataset.invoiceDomain ?? 'service';
    const authorize = () => {
      if ((node.dataset.invoiceDomain ?? 'service') !== domain) throw new Error('票据附件所属业务已更新，请刷新后查看。');
      const context=currentContext();
      if(!context?.state||!context.actor)throw new Error('当前附件查看上下文已失效。');
      return authorizedInvoiceFile(context.state, context.actor, id, slot, ref, domain);
    };
    try {
      if (!isCurrent() || !node.isConnected) return;
      const file = structuredClone(authorize()), blob = await readInvoiceFile(file);
      const authorizeOriginalFile=()=>{
        if(JSON.stringify(authorize())!==JSON.stringify(file))throw new Error('附件资料已更新，请刷新后再查看。');
      };
      if (!node.isConnected || !isCurrent()) return;
      authorizeOriginalFile();
      const url = URL.createObjectURL(blob); activeUrls.add(url);
      const links = node.matches('a') ? [node] : [...node.querySelectorAll('a[data-invoice-action="download"]')];
      for (const link of links) {
        if (!isCurrent() || !node.isConnected) { URL.revokeObjectURL(url); activeUrls.delete(url); for (const previous of links) previous.removeAttribute('href'); return; }
        link.href = url;
        link.download = invoiceFileName(file.name);
        link.removeAttribute('aria-disabled');
        link.addEventListener('click', event => { try { if (isCurrent()) { authorizeOriginalFile(); return; } } catch {} event.preventDefault(); link.removeAttribute('href'); URL.revokeObjectURL(url); activeUrls.delete(url); }, {capture:true});
      }
      bindInvoicePreview(node, file, blob, () => {
        if (!isCurrent() || !node.isConnected) return false;
        authorizeOriginalFile();
        return true;
      });
      const status = node.querySelector('[data-invoice-file-status]'); if (status) status.textContent = '附件已就绪';
    } catch (error) {
      if (!node.isConnected) return;
      try { if (!isCurrent()) return; } catch { return; }
      const status = node.querySelector('[data-invoice-file-status]');
      if (status) status.textContent = error.message;
      else { const note = document.createElement('p'); note.className = 'small warning'; note.textContent = error.message; node.append(note); }
    }
  }));
}
