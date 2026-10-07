import test from 'node:test';
import assert from 'node:assert/strict';
import { commerceInvoiceView, goodsInvoicePanel } from './commerce-invoice-ui.mjs';
import { commerceInvoiceCommand } from './commerce-invoices.mjs';
const esc = x => String(x ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const ui = query => ({ esc, money: n => '¥' + (n / 100).toFixed(2), date: n => n == null ? '—' : new Date(n).toISOString(), link: (text, path, cls = '') => `<a class="${cls}" href="#${esc(path)}">${text}</a>`, tag: text => `<span class="tag">${esc(text)}</span>`, empty: (a, b = '') => `<div class="empty">${esc(a)} ${esc(b)}</div>`, field: (label, name, value = '', type = 'text', attrs = '') => `<label class="field"><span>${esc(label)}</span><input name="${esc(name)}" type="${esc(type)}" value="${esc(value)}" ${attrs}></label>`, select: (label, name, options, value = '') => `<label class="field"><span>${esc(label)}</span><select name="${esc(name)}">${options.map(o => `<option value="${esc(o.value)}"${o.value === value ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select></label>`, query: new URLSearchParams(query) });
const group = { role: 'group', job: 'finance' }, user = { role: 'user', userId: 'u1' }, store = { role: 'store', job: 'store-finance', storeId: 's1' }, title = { kind: 'company', title: '<script>受票</script>', taxId: '91320100000000000X', email: 'a@example.com' };
const file = { ref: 'invoice-file:' + 'a'.repeat(64), type: 'application/pdf', size: 734, name: '原件.pdf' };
function fixture() {
  const now = Date.parse('2026-10-03T12:00:00+08:00');
  const s = { schema: 5, seq: 1, now, users: [{ id: 'u1' }], stores: [{ id: 's1', name: '门店一' }, { id: 's2', name: '门店二' }], goods: [{ id: 'G1', userId: 'u1', status: 'received', paidAt: now - 5 * 86400000, receivedAt: now - 2 * 86400000, payment: { id: 'GP1', status: 'success' }, shippingCents: 1200, paidCents: 21000, lines: [{ skuId: '<SKU>', paidCents: 19800, refundedCents: 0 }], cases: [], refunds: [] }], bookings: [{ id: 'BK1', storeId: 's1', payment: { id: 'BP1', status: 'success' }, extensions: [], refunds: [] }], serviceFinanceEntries: [{ id: 'SF1', bookingId: 'BK1', storeId: 's1', paymentId: 'BP1', split: { id: 'TX1', kind: 'split', status: 'success', amountCents: 2980, completedAt: now - 5 * 86400000 }, returns: [] }], serviceFinanceRecoveries: [] };
  let n = 0;
  const ctx = { id: prefix => prefix + ++s.seq, fail: text => { throw new Error(text); } };
  const run = (op, p = {}, actor = group) => commerceInvoiceCommand(s, actor, `commerce-invoice.${op}`, { requestId: `r${++n}`, ...p }, ctx);
  const publish = (category = 'goods', extra = {}) => run('rule-publish', { category, version: 0, issuerName: '手填的测试集团主体', issuerTaxId: '91320100000000000Y', invoiceItem: 'Demo商品/服务费', effectiveAt: now, sourceFromAt: Date.parse('2026-01-01T00:00:00+08:00'), reason: '本地测试输入，正式主体和规则未确认', applicationStage: 'paid', shipping: 'exclude', windowDays: 7, cycle: 'monthly', timezoneMinutes: 480, returnPolicy: 'original-income-fifo', ...extra });
  return { s, run, publish, apply() { return run('apply-goods', { orderId: 'G1', ...title }, user); } };
}
test('C07 UI 非自身路由返回null；浏览各空页和配置不产生容器或票据', () => {
  const f = fixture(), before = structuredClone(f.s);
  assert.equal(commerceInvoiceView(f.s, ['bookings'], group, ui()), null);
  for (const route of ['commodity-invoices', 'fee-invoices', 'commerce-invoice-rules']) assert.ok(commerceInvoiceView(f.s, [route], group, ui()));
  goodsInvoicePanel(f.s, f.s.goods[0], user, ui()); assert.deepEqual(f.s, before);
});
test('C07 UI 未配置只反馈缺口，不给申请按钮或假主体/默认税号', () => {
  const f = fixture(), html = goodsInvoicePanel(f.s, f.s.goods[0], user, ui()); assert.match(html, /尚未配置/); assert.match(html, /口径待确认/); assert.doesNotMatch(html, /data-command="commerce-invoice.apply-goods"/);
  const config = commerceInvoiceView(f.s, ['commerce-invoice-rules'], group, ui()); assert.match(config, /正式政策仍需财务确认/); assert.match(config, /value="" selected>请明确选择/); assert.match(config, /name="issuerName" type="text" value=""/); assert.match(config, /name="timezoneMinutes" type="number" value=""/);
});
test('C07 UI 本人商品来源申请与税号/邮箱字段；他人及门店不给入口', () => {
  const f = fixture(); f.publish(); const html = goodsInvoicePanel(f.s, f.s.goods[0], user, ui());
  assert.match(html, /data-command="commerce-invoice.apply-goods"/); assert.match(html, /data-invoice-form/); assert.match(html, /name="kind"/); assert.match(html, /name="taxId"/); assert.match(html, /name="email"/);
  assert.equal(goodsInvoicePanel(f.s, f.s.goods[0], { ...user, userId: 'other' }, ui()), ''); assert.equal(goodsInvoicePanel(f.s, f.s.goods[0], store, ui()), '');
});
test('C07 UI 商品票列表示订单与状态，返回沿当前身份，不跳服务票', () => {
  const f = fixture(); f.publish(); const inv = f.apply();
  const html = commerceInvoiceView(f.s, ['commodity-invoices', inv.id], user, ui()); assert.match(html, /#\/user\/commodity-invoices/); assert.match(html, /#\/user\/goods\/G1/); assert.doesNotMatch(html, /#\/user\/invoices/);
  const list = commerceInvoiceView(f.s, ['commodity-invoices'], user, ui('status=pending&q=G1')); assert.match(list, /G1/); assert.match(list, /待开票/); assert.match(list, /#\/user\/goods/);
});
test('C07 UI 排除运费显示本票不计并以0净额列示；文本来源安全转义', () => {
  const f = fixture(); f.publish(); const inv = f.apply(), html = commerceInvoiceView(f.s, ['commodity-invoices', inv.id], user, ui());
  assert.match(html, /shipping（本票不计）/); assert.match(html, /¥0\.00/); assert.match(html, /&lt;SKU&gt;/); assert.match(html, /&lt;script&gt;受票&lt;\/script&gt;/); assert.doesNotMatch(html, /<script>/);
});

test('C07 UI 逐SKU与运费显示真实支付时间，成功退款表显示原完成时间', () => {
  const f = fixture(); f.publish(); const o = f.s.goods[0], completedAt = f.s.now - 60000;
  o.lines[0].refundedCents = 4000;
  o.cases.push({ id: 'C1', status: 'done', amountCents: 4000, shippingCents: 100, allocations: [{ skuId: '<SKU>', amountCents: 4000 }], completedAt });
  o.refunds.push({ id: 'R1', caseId: 'C1', status: 'success', amountCents: 4100, at: f.s.now - 3600000 });
  const inv = f.apply(), before = structuredClone(f.s), html = commerceInvoiceView(f.s, ['commodity-invoices', inv.id], user, ui());
  assert.match(html, /实际支付时间/); assert.equal(html.split(new Date(o.paidAt).toISOString()).length - 1, 2);
  assert.match(html, /实际退款成功时间/); assert.ok(html.includes(new Date(completedAt).toISOString()));
  assert.deepEqual(f.s, before);
});

test('C07 UI 旧票按原来源补显示日期，不加入后续退款或覆盖原票金额', () => {
  const f = fixture(); f.publish(); const o = f.s.goods[0], completedAt = f.s.now - 60000;
  o.lines[0].refundedCents = 4000;
  o.cases.push({ id: 'C1', status: 'done', amountCents: 4000, shippingCents: 100, allocations: [{ skuId: '<SKU>', amountCents: 4000 }], completedAt });
  o.refunds.push({ id: 'R1', caseId: 'C1', status: 'success', amountCents: 4100, at: f.s.now - 3600000 });
  const inv = f.apply(); f.run('issue', { id: inv.id, version: inv.version, ticketNumber: 'OLD', file });
  for (const row of [...inv.sourceSnapshot, ...inv.refundSnapshot]) delete row.at;
  o.lines[0].refundedCents += 5000;
  o.cases.push({ id: 'C2', status: 'done', amountCents: 5000, shippingCents: 0, allocations: [{ skuId: '<SKU>', amountCents: 5000 }], completedAt: f.s.now });
  o.refunds.push({ id: 'R2', caseId: 'C2', status: 'success', amountCents: 5000, at: f.s.now - 1000 });
  const before = structuredClone(f.s), html = commerceInvoiceView(f.s, ['commodity-invoices', inv.id], user, ui());
  assert.equal(html.split(new Date(o.paidAt).toISOString()).length - 1, 2);
  assert.ok(html.includes(new Date(completedAt).toISOString())); assert.match(html, /R1/); assert.doesNotMatch(html, /R2/);
  assert.equal(inv.amount, 15800); assert.equal(inv.sourceSnapshot[0].refundedCents, 4000); assert.deepEqual(f.s, before);
});

test('C07 UI 未记录成功时间显示未知，原笔提交时间不冒充退款成功时间', () => {
  const f = fixture(); f.publish(); const o = f.s.goods[0], submittedAt = f.s.now - 3600000;
  o.lines[0].refundedCents = 4000;
  o.cases.push({ id: 'C1', status: 'done', amountCents: 4000, shippingCents: 0, allocations: [{ skuId: '<SKU>', amountCents: 4000 }] });
  o.refunds.push({ id: 'R1', caseId: 'C1', status: 'success', amountCents: 4000, at: submittedAt });
  const inv = f.apply(), html = commerceInvoiceView(f.s, ['commodity-invoices', inv.id], user, ui());
  const refundTable = html.match(/<table><thead><tr><th>成功退款原笔[\s\S]*?<\/table>/)?.[0];
  assert.ok(refundTable); assert.match(refundTable, /<td>—<\/td>/);
  assert.ok(!refundTable.includes(new Date(submittedAt).toISOString())); assert.ok(!refundTable.includes(new Date(f.s.now).toISOString()));
});

test('C07 UI 附件查看下载关闭使用后台btn样式，保留权限禁用与动作标记', () => {
  const f = fixture(); f.publish(); const inv = f.apply(); f.run('issue', { id: inv.id, version: inv.version, ticketNumber: 'BLUE-STYLED', file });
  const html = commerceInvoiceView(f.s, ['commodity-invoices', inv.id], group, ui());
  assert.match(html, /<button type="button" class="btn secondary" data-invoice-action="view" aria-expanded="false" disabled>/);
  assert.match(html, /<a class="btn secondary" data-invoice-action="download">/);
  assert.match(html, /<button type="button" class="btn secondary" data-invoice-action="close-preview">/);
});
test('C07 UI 集团财务有真实上传/开具/驳回，用户只读；缺文件反馈不是按钮', () => {
  const f = fixture(); f.publish(); const inv = f.apply(); const html = commerceInvoiceView(f.s, ['commodity-invoices', inv.id], group, ui());
  assert.match(html, /data-command="commerce-invoice.issue"/); assert.match(html, /data-command="commerce-invoice.reject"/); assert.match(html, /data-invoice-upload/); assert.match(html, /data-live-version="1"/);
  const userHtml = commerceInvoiceView(f.s, ['commodity-invoices', inv.id], user, ui()); assert.doesNotMatch(userHtml, /data-command="commerce-invoice.issue"/);
  assert.match(html, /<span class="small muted" data-invoice-upload-status role="status">/); assert.doesNotMatch(html, /role="button"[^>]*>请选择本机实际文件/);
});
test('C07 UI 原/红票附件标commerce域和同页预览，按钮初始权限读取前禁用', () => {
  const f = fixture(); f.publish(); const inv = f.apply(); f.run('issue', { id: inv.id, version: inv.version, ticketNumber: 'BLUE', file });
  const html = commerceInvoiceView(f.s, ['commodity-invoices', inv.id], user, ui()); assert.match(html, /data-invoice-domain="commerce"/); assert.match(html, /data-invoice-slot="issued"/); assert.match(html, /data-invoice-preview role="region"/); assert.match(html, /aria-expanded="false" disabled/); assert.match(html, /data-invoice-action="download"/); assert.doesNotMatch(html, /target="_blank"/);
});
test('C07 UI 店长/集团非财务/他人无资料；失效会话有反馈', () => {
  const f = fixture(); f.publish(); const inv = f.apply();
  for (const actor of [{ role: 'manager', storeId: 's1' }, { role: 'group', job: 'operations' }, { role: 'user', userId: 'u2' }]) {
    const html = commerceInvoiceView(f.s, ['commodity-invoices', inv.id], actor, ui()); assert.match(html, /无权/); assert.doesNotMatch(html, /a@example.com/); assert.doesNotMatch(html, /91320100000000000X/);
  }
  assert.match(commerceInvoiceView(f.s, ['commodity-invoices'], { ...group, accountId: 'x', sessionId: 'missing' }, ui()), /身份已失效/);
});
test('C07 UI 月票本店来源净额及企业申请，集团核对不冒充申请人', () => {
  const f = fixture(); f.publish('fee');
  const html = commerceInvoiceView(f.s, ['fee-invoices'], store, ui('month=2026-09&storeId=s2')); assert.match(html, /SF1|split:TX1/); assert.match(html, /¥29\.80/); assert.match(html, /data-command="commerce-invoice.apply-fee"/); assert.match(html, /门店企业/); assert.doesNotMatch(html, /value="personal"/); assert.doesNotMatch(html, /value="s2"/);
  const groupHtml = commerceInvoiceView(f.s, ['fee-invoices'], group, ui('month=2026-09&storeId=s1')); assert.doesNotMatch(groupHtml, /data-command="commerce-invoice.apply-fee"/);
});
test('C07 UI 驳回重提、红冲、净额重开出口各由正确角色使用', () => {
  const f = fixture(); f.publish(); const inv = f.apply(); f.run('reject', { id: inv.id, version: inv.version, reason: '核对抬头' }); assert.match(commerceInvoiceView(f.s, ['commodity-invoices', inv.id], user, ui()), /data-command="commerce-invoice.resubmit"/);
  inv.status = 'red_pending'; inv.issued = { ticketNumber: 'BLUE', amountCents: 19800, file, at: f.s.now };
  assert.match(commerceInvoiceView(f.s, ['commodity-invoices', inv.id], group, ui()), /data-command="commerce-invoice.red"/);
  inv.status = 'red'; inv.red = { ticketNumber: 'RED', amountCents: 19800, file, at: f.s.now };
  assert.match(commerceInvoiceView(f.s, ['commodity-invoices', inv.id], user, ui()), /data-command="commerce-invoice.reapply"/); assert.match(commerceInvoiceView(f.s, ['commodity-invoices', inv.id], user, ui()), /data-invoice-slot="red"/);
});
test('C07 UI 已申请订单面板按该票规则快照，主体与金额同步', () => {
  const f = fixture(); f.publish(); f.apply();
  f.run('rule-publish', { category: 'goods', version: 1, issuerName: '新版集团主体', issuerTaxId: '91320100000000000Z', invoiceItem: '新版项目', reason: 'Demo新版，不追改旧申请', effectiveAt: f.s.now, sourceFromAt: Date.parse('2026-01-01T00:00:00+08:00'), applicationStage: 'paid', windowDays: 90, shipping: 'include' });
  const html = goodsInvoicePanel(f.s, f.s.goods[0], user, ui()); assert.match(html, /手填的测试集团主体/); assert.match(html, /¥198\.00/); assert.doesNotMatch(html, /¥210\.00/); assert.doesNotMatch(html, /新版集团主体/);
});
test('C07 UI 已申请月份核对按原方案与原主体，新规则不混进旧票', () => {
  const f = fixture(); f.publish('fee'); f.run('apply-fee', { storeId: 's1', month: '2026-09', ...title }, store);
  f.s.serviceFinanceEntries[0].returns.push({ id: 'RET1', kind: 'return', status: 'success', amountCents: 500, completedAt: f.s.now });
  f.run('rule-publish', { category: 'fee', version: 1, issuerName: '新版集团主体', issuerTaxId: '91320100000000000Z', invoiceItem: '新版服务费', reason: 'Demo发生月新方案', effectiveAt: f.s.now, sourceFromAt: Date.parse('2026-01-01T00:00:00+08:00'), cycle: 'monthly', timezoneMinutes: 480, returnPolicy: 'cash-month' });
  const html = commerceInvoiceView(f.s, ['fee-invoices'], store, ui('month=2026-09')); assert.match(html, /手填的测试集团主体/); assert.match(html, /¥24\.80/); assert.doesNotMatch(html, /新版集团主体/);
});
