const e = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function careEvidenceCount(row) {
  return (row.evidenceRefs || []).length + (row.statements || []).reduce((n,x)=>n+(x.evidenceRefs || []).length,0);
}
export function careEvidenceUploadFields(available = 6) {
  if (available <= 0) return '<p class="notice wide" role="status">本案件已保存6张图片，可以继续补充文字说明。</p>';
  return `<div class="field wide" data-care-upload-region><label class="field"><span>图片证据（可选，本次最多${e(available)}张）</span><input type="file" data-care-upload data-care-available="${e(available)}" multiple accept="image/png,image/jpeg"></label><input type="hidden" name="evidenceRefs" value="[]"><p class="small muted" data-care-upload-status role="status">PNG / JPEG，每张最大5 MiB。案件与全部补充合计最多6张。</p><ul class="timeline" data-care-selected-files></ul><div class="actions"><button type="button" class="secondary" data-care-clear disabled>清除本次选择</button></div></div>`;
}
export function careEvidenceAttachments(caseId, prefix, files = []) {
  return files.map((file,index)=>`<div class="panel" data-invoice-domain="care" data-invoice-file="${e(file.ref)}" data-invoice-id="${e(caseId)}" data-invoice-slot="${e(prefix+':'+index)}"><p class="order-number">${e(file.name)} · ${e((file.size/1024).toFixed(1))} KiB</p><div class="actions"><button type="button" class="secondary" data-invoice-action="view" aria-expanded="false" disabled>查看图片证据</button><a class="secondary" data-invoice-action="download" aria-disabled="true">下载图片证据</a></div><span class="small muted" data-invoice-file-status role="status">正在读取原图片文件…</span><section class="invoice-inline-preview" data-invoice-preview role="region" aria-label="图片证据预览" hidden><div class="invoice-preview-heading"><h3>图片证据预览</h3><button type="button" class="secondary" data-invoice-action="close-preview">关闭预览</button></div><p class="small muted" data-invoice-preview-status role="status"></p><div data-invoice-preview-content></div></section></div>`).join('');
}
