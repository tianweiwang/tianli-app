import test from 'node:test';
import assert from 'node:assert/strict';
import { upgradeCommerceInvoices, commerceInvoiceCommand, syncCommerceInvoices, goodsInvoiceSummary, feeInvoiceSummary, commerceInvoiceRule, canReadCommerceInvoice, authorizedCommerceInvoiceFile, commerceInvoiceViewData } from './commerce-invoices.mjs';
const DAY = 86400000, at = x => Date.parse(x + '+08:00');
const user = { role: 'user', userId: 'u1' }, finance = { role: 'group', job: 'finance' }, store = { role: 'store', job: 'store-finance', storeId: 's1' };
const title = { kind: 'company', title: '本地测试受票企业', taxId: '91320100000000000X', email: 'invoice@example.com' };
const file = { ref: 'invoice-file:' + 'a'.repeat(64), name: 'technical-only.pdf', type: 'application/pdf', size: 734 };
function state() {
  return { schema: 5, seq: 1, now: at('2026-10-03T12:00:00'), users: [{ id: 'u1' }, { id: 'u2' }], stores: [{ id: 's1', name: '测试店1' }, { id: 's2' }], bookings: [], serviceInvoices: [{ id: 'SI-preserved' }], serviceFinanceEntries: [], serviceFinanceRecoveries: [], goods: [{ id: 'G1', userId: 'u1', version: 9, status: 'received', paidAt: at('2026-09-28T10:00:00'), receivedAt: at('2026-09-30T12:00:00'), payment: { id: 'P1', status: 'success' }, paidCents: 21000, shippingCents: 1200, lines: [{ skuId: 'a', paidCents: 10000, refundedCents: 0 }, { skuId: 'b', paidCents: 9800, refundedCents: 0 }], refunds: [], cases: [] }], skus: [{ id: 'a', stock: 8 }], bills: [{ id: 'bill-kept', amountCents: 700 }], recoveries: [{ id: 'debt-kept' }] };
}
function harness(initial = state()) {
  let s = initial, n = 0;
  const ctx = s => ({ fail: x => { throw new Error(x); }, id: x => x + ++s.seq, log: (row, text) => (row.events ??= []).push({ text, at: s.now }) });
  const run = (op, p = {}, actor = finance) => {
    const next = structuredClone(s), value = commerceInvoiceCommand(next, actor, 'commerce-invoice.' + op, { requestId: 'request-' + ++n, ...p }, ctx(next));
    syncCommerceInvoices(next, ctx(next)); s = next; return value;
  };
  const publish = (category = 'goods', extra = {}) => run('rule-publish', { category, version: Math.max(0, ...(s.commerceInvoiceRules || []).filter(x => x.category === category).map(x => x.version)), issuerName: '明确输入的Demo集团主体', issuerTaxId: '91320100000000000Y', invoiceItem: category === 'goods' ? 'Demo商品销售' : 'Demo平台服务费', effectiveAt: s.now, sourceFromAt: at('2026-01-01T00:00:00'), reason: '技术验收显式输入，正式税务主体与政策尚未确认', applicationStage: 'paid', shipping: 'include', windowDays: 90, cycle: 'monthly', timezoneMinutes: 480, returnPolicy: 'original-income-fifo', ...extra });
  return { get s() { return s; }, get o() { return s.goods[0]; }, get inv() { return s.commerceInvoices?.at(-1); }, run, publish, apply(extra = {}, actor = user) { return run('apply-goods', { orderId: 'G1', ...title, ...extra }, actor); }, applyFee(month = '2026-09', extra = {}, actor = store) { return run('apply-fee', { storeId: 's1', month, ...title, ...extra }, actor); }, issue(extra = {}, actor = finance) { return run('issue', { id: this.inv.id, version: this.inv.version, ticketNumber: 'BLUE-1', file, ...extra }, actor); }, sync() { syncCommerceInvoices(s, ctx(s)); } };
}
function refund(f, amount = 4000, shipping = 500, status = 'success') {
  f.o.cases.push({ id: 'C1', status: status === 'success' ? 'done' : 'refunding', amountCents: amount, shippingCents: shipping, allocations: [{ skuId: 'a', amountCents: amount }] });
  f.o.refunds.push({ id: 'R1', caseId: 'C1', amountCents: amount + shipping, status });
  if (status === 'success') f.o.lines[0].refundedCents = amount;
}
function feeState() {
  const s = state(); s.now = at('2026-11-02T12:00:00');
  s.bookings = [{ id: 'BK1', storeId: 's1', userId: 'u1', status: 'done', payment: { id: 'BP1', status: 'success', amountCents: 29800, refundedCents: 0 }, extensions: [{ id: 'BX1', status: 'success', amountCents: 14900, refundedCents: 0 }], refunds: [] }];
  s.serviceFinanceEntries = [
    { id: 'SF1', storeId: 's1', bookingId: 'BK1', paymentId: 'BP1', split: { id: 'SPLIT1', kind: 'split', status: 'success', amountCents: 2980, completedAt: at('2026-09-29T10:00:00'), requestNo: 'GROUP-ONLY-1' }, splitHistory: [], finish: { id: 'FIN1', status: 'success', amountCents: 0 }, returns: [] },
    { id: 'SF2', storeId: 's1', bookingId: 'BK1', paymentId: 'BX1', split: { id: 'SPLIT2', kind: 'split', status: 'success', amountCents: 1490, completedAt: at('2026-09-30T12:00:00') }, splitHistory: [], returns: [] }
  ];
  return s;
}
function offline(f, type = 'unshared-release', amount = 1000, id = 'OFF1') {
  f.s.serviceFinanceRecoveries.push({ id, entryId: 'SF1', bookingId: 'BK1', paymentId: 'BP1', storeId: 's1', type, payer: type === 'unshared-release' ? 'store:s1' : 'group', payee: type === 'unshared-release' ? 'group' : 'store:s1', amountCents: amount + 300, receivedCents: amount, records: [{ id: 'RC-' + id, amountCents: amount, at: at('2026-10-01T12:00:00'), reference: 'BANK-' + id }] });
}
function feeReturn(f, amount = 500, date = '2026-10-02T12:00:00') { f.s.serviceFinanceEntries[0].returns.push({ id: 'RET1', kind: 'return', status: 'success', amountCents: amount, completedAt: at(date), requestNo: 'RETURN-1' }); }

test('C07 升级仅新增三个空容器，不更改schema或原业务', () => {
  const s = state(), before = structuredClone(s); upgradeCommerceInvoices(s); syncCommerceInvoices(s); upgradeCommerceInvoices(s);
  assert.deepEqual(s, { ...before, commerceInvoiceRules: [], commerceInvoices: [], commerceInvoiceRequests: [] });
});
test('C07 所有投影纯读，无配置不解锁，不借seed名称成为税务主体', () => {
  const s = state(), before = structuredClone(s);
  assert.equal(goodsInvoiceSummary(s, 'G1').blocked, true);
  assert.match(feeInvoiceSummary(s, 's1', '2026-09').blockedReason, /尚未发布/);
  assert.deepEqual(commerceInvoiceViewData(s, finance), { rules: [], invoices: [] }); assert.deepEqual(s, before);
  assert.throws(() => harness().apply(), /尚未发布/);
});
test('C07 规则需完整显式依据、主体、口径，禁止倒签与缺版本', () => {
  for (const extra of [{ issuerName: '' }, { issuerTaxId: '集团' }, { reason: '' }, { shipping: '' }, { applicationStage: '' }, { windowDays: '' }, { effectiveAt: 0 }, { version: '' }]) assert.throws(() => harness().publish('goods', extra));
  for (const extra of [{ timezoneMinutes: '' }, { cycle: '' }, { returnPolicy: '' }, { returnPolicy: 'assume-confirmed' }]) assert.throws(() => harness(feeState()).publish('fee', extra));
  const f = harness(), rule = f.publish(); assert.equal(rule.mode, 'demo'); assert.equal(rule.productionApproved, false); assert.equal(rule.actor.job, 'finance'); assert.match(rule.reason, /尚未确认/);
});
test('C07 未来配置不提前生效；同类别版本递增，申请保留原快照', () => {
  const f = harness(); f.publish('goods', { effectiveAt: f.s.now + 1000 }); assert.equal(commerceInvoiceRule(f.s, 'goods'), null);
  f.s.now += 1000; const inv = f.apply(), snapshot = structuredClone(inv.ruleSnapshot);
  f.publish('goods', { shipping: 'exclude', issuerName: '第二个Demo主体', issuerTaxId: '91320100000000000Z' });
  assert.equal(commerceInvoiceRule(f.s, 'goods').version, 2); assert.deepEqual(f.inv.ruleSnapshot, snapshot); assert.equal(f.inv.amount, 21000);
});
test('C07 商品已成功实付逐SKU和运费；仅成功分摊退款计入，守恒', () => {
  const f = harness(); f.publish(); refund(f); const x = goodsInvoiceSummary(f.s, f.o);
  assert.equal(x.paidCents, 21000); assert.equal(x.refundedCents, 4500); assert.equal(x.netCents, 16500); assert.equal(x.blocked, false);
  assert.equal(x.sourceSnapshot.reduce((n, r) => n + r.invoiceNetCents, 0), 16500); assert.equal(x.refundSnapshot[0].refundId, 'R1');
  f.apply(); assert.equal(f.inv.amount, 16500); assert.equal(f.inv.issuerSnapshot.name, '明确输入的Demo集团主体');
});

test('C07 商品来源保留原支付时间，退款以原案件成功时间而非提交时间显示', () => {
  const f = harness(); f.publish(); refund(f);
  const completedAt = f.s.now - 60000;
  f.o.cases[0].completedAt = completedAt; f.o.refunds[0].at = f.s.now - 3600000;
  const original = structuredClone(f.o), summary = goodsInvoiceSummary(f.s, f.o);
  assert.deepEqual(summary.sourceSnapshot.map(x => x.at), [f.o.paidAt, f.o.paidAt, f.o.paidAt]);
  assert.equal(summary.refundSnapshot[0].at, completedAt);
  f.apply(); assert.equal(f.inv.refundSnapshot[0].at, completedAt);
  assert.deepEqual(f.o, original);
});

test('C07 缺失或异常的退款成功时间保留未知，不用提交、更新时间或当前时间补造', () => {
  for (const completedAt of [undefined, null, -1, '2026-10-03', Date.parse('2026-10-04T12:00:00+08:00')]) {
    const f = harness(); f.publish(); refund(f);
    Object.assign(f.o.cases[0], { completedAt, updatedAt: f.s.now }); f.o.refunds[0].at = f.s.now - 3600000;
    const summary = goodsInvoiceSummary(f.s, f.o);
    assert.equal(summary.refundSnapshot[0].at, null); assert.equal(summary.netCents, 16500); assert.equal(summary.blocked, false);
  }
});

test('C07 补日期与旧商品票资金签名兼容，不改旧快照或误触发红冲', () => {
  const f = harness(); f.publish(); refund(f); f.o.cases[0].completedAt = f.s.now - 60000; f.apply(); f.issue();
  for (const row of [...f.inv.sourceSnapshot, ...f.inv.refundSnapshot]) delete row.at;
  // Persisted signature from the previous release, whose source rows had no at.
  const sorted = x => Array.isArray(x) ? x.map(sorted) : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).sort().map(k => [k, sorted(x[k])])) : x;
  f.inv.basisSignature = JSON.stringify(sorted({ netCents: f.inv.amount, sources: f.inv.sourceSnapshot, refunds: f.inv.refundSnapshot, allocations: f.inv.allocationSnapshot }));
  const original = structuredClone(f.s); f.sync();
  assert.deepEqual(f.s, original); assert.equal(f.inv.status, 'issued');
});
test('C07 运费排除显式标记不计本票，与用户实付净额分开', () => {
  const f = harness(); f.publish('goods', { shipping: 'exclude' }); refund(f); const x = goodsInvoiceSummary(f.s, f.o);
  assert.equal(x.netPaidCents, 16500); assert.equal(x.netCents, 15800); assert.equal(x.sourceSnapshot.at(-1).invoiceNetCents, 0); assert.equal(x.sourceSnapshot.at(-1).includedInInvoice, false);
});
test('C07 处理中、失败及未结售后不充当退款成功，也不提前开票', () => {
  for (const status of ['processing', 'failed']) { const f = harness(); f.publish(); refund(f, 4000, 500, status); const x = goodsInvoiceSummary(f.s, f.o); assert.equal(x.refundedCents, 0); assert.equal(x.netCents, 21000); assert.equal(x.blocked, true); assert.throws(() => f.apply(), /未结/); }
  const f = harness(); f.publish(); f.o.payment.status = 'processing'; assert.throws(() => f.apply(), /成功/);
});
test('C07 缺分摊、重复成功原笔、超额或失配的金额阻断', () => {
  for (const mutate of [f => { f.o.paidCents++; }, f => { f.o.paidAt = null; }, f => { f.o.lines[0].refundedCents = 10; }, f => { refund(f); f.o.cases[0].allocations = []; }, f => { refund(f); f.o.refunds.push({ ...f.o.refunds[0], id: 'R2' }); }, f => { refund(f); f.o.refunds[0].amountCents++; }]) { const f = harness(); f.publish(); mutate(f); assert.equal(goodsInvoiceSummary(f.s, f.o).blocked, true); assert.throws(() => f.apply()); }
});
test('C07 收货阶段与窗口不照搬服务90天；维护红冲链不受新申请窗口限制', () => {
  const f = harness(); f.publish('goods', { applicationStage: 'received', windowDays: 2 }); assert.throws(() => f.apply(), /期限/);
  const g = harness(); g.publish('goods', { applicationStage: 'received' }); g.o.receivedAt = null; assert.throws(() => g.apply(), /阶段/);
  const h = harness(); h.publish('goods', { windowDays: 7 }); h.apply(); h.issue(); h.s.now += 200 * DAY; refund(h); h.sync();
  h.run('red', { id: h.inv.id, version: h.inv.version, ticketNumber: 'RED-1', file });
  h.run('reapply', { id: h.inv.id, version: h.inv.version, ...title }, user); assert.equal(h.inv.amount, 16500);
});
test('C07 实际票号和文件齐全；开票、补传保留历史和原金额', () => {
  const f = harness(); f.publish(); f.apply(); for (const extra of [{ ticketNumber: '' }, { file: null }, { file: { ...file, ref: 'invented.pdf' } }, { file: { ...file, size: 0 } }]) assert.throws(() => f.issue(extra));
  f.issue(); const old = structuredClone(f.inv.issued.file), amount = f.inv.amount;
  f.run('replace-file', { id: f.inv.id, version: f.inv.version, slot: 'issued', reason: '补传完整技术凭证', file: { ...file, ref: 'invoice-file:' + 'b'.repeat(64) } });
  assert.equal(f.inv.status, 'issued'); assert.equal(f.inv.amount, amount); assert.deepEqual(f.inv.history.at(-1).previousFile, old);
});
test('C07 驳回必填原因，本人修改重提；已开票不能驳回', () => {
  const f = harness(); f.publish(); f.apply(); assert.throws(() => f.run('reject', { id: f.inv.id, version: f.inv.version, reason: '' }));
  f.run('reject', { id: f.inv.id, version: f.inv.version, reason: '请核对抬头' }); assert.equal(f.inv.status, 'rejected');
  f.run('resubmit', { id: f.inv.id, version: f.inv.version, ...title, title: '已更正抬头' }, user); assert.equal(f.inv.title, '已更正抬头'); assert.equal(f.inv.status, 'pending');
  f.issue(); assert.throws(() => f.run('reject', { id: f.inv.id, version: f.inv.version, reason: '不能如此' }), /待开票/);
});
test('C07 成功退款触发红冲，原票金额/依据不覆盖，净额重开关联', () => {
  const f = harness(); f.publish(); f.apply(); f.issue(); const originalId = f.inv.id, snapshot = structuredClone(f.inv.sourceSnapshot); refund(f); f.sync(); f.sync();
  assert.equal(f.inv.status, 'red_pending'); assert.equal(f.inv.amount, 21000); assert.deepEqual(f.inv.sourceSnapshot, snapshot);
  const v = f.inv.version; assert.throws(() => f.run('reapply', { id: originalId, version: v, ...title }, user), /红冲/);
  f.run('red', { id: originalId, version: v, ticketNumber: 'RED-1', file }); f.run('reapply', { id: originalId, version: f.inv.version, ...title }, user);
  assert.equal(f.inv.amount, 16500); assert.equal(f.inv.replacesId, originalId); assert.equal(f.s.commerceInvoices[0].replacedById, f.inv.id);
  f.issue({ ticketNumber: 'BLUE-2' }); assert.equal(f.inv.status, 'issued');
});
test('C07 全退须红冲原票；零额不能重开或先申请', () => {
  const f = harness(); f.publish(); f.apply(); f.issue(); f.o.cases = [{ id: 'C1', status: 'done', amountCents: 19800, shippingCents: 1200, allocations: [{ skuId: 'a', amountCents: 10000 }, { skuId: 'b', amountCents: 9800 }] }]; f.o.refunds = [{ id: 'R1', caseId: 'C1', amountCents: 21000, status: 'success' }]; f.o.lines.forEach(x => x.refundedCents = x.paidCents); f.sync();
  f.run('red', { id: f.inv.id, version: f.inv.version, ticketNumber: 'RED-1', file }); assert.throws(() => f.run('reapply', { id: f.inv.id, version: f.inv.version, ...title }, user), /零/);
});
test('C07 幂等重放不重复开票；同标识异内容、旧版本与别人的申请拒绝', () => {
  const f = harness(); f.publish(); const payload = { orderId: 'G1', ...title, requestId: 'stable' }; const inv = f.run('apply-goods', payload, user);
  const before = structuredClone(f.s); f.run('apply-goods', payload, user); assert.deepEqual(f.s, before);
  assert.throws(() => f.run('apply-goods', { ...payload, title: '改变' }, user), /同一提交/);
  assert.throws(() => f.run('apply-goods', payload, { role: 'user', userId: 'u2' }), /本人/);
  assert.throws(() => f.issue({ version: inv.version - 1 }), /版本/);
});
test('C07 商品票与集团月票，同开票主体不能重复票号', () => {
  const f = harness(feeState()); f.publish('goods'); f.apply(); f.issue({ ticketNumber: 'SAME' }); f.publish('fee'); f.applyFee(); assert.throws(() => f.issue({ ticketNumber: 'SAME' }), /已经使用/);
});
test('C07 本模块所有操作保持原预约、服务票、库存和商品资金原样', () => {
  const f = harness(), protectedFields = ['goods', 'bookings', 'serviceInvoices', 'serviceFinanceEntries', 'serviceFinanceRecoveries', 'skus', 'bills', 'recoveries'], snapshots = protectedFields.map(k => structuredClone(f.s[k]));
  f.publish(); f.apply(); f.issue(); f.sync(); protectedFields.forEach((k, i) => assert.deepEqual(f.s[k], snapshots[i], k));
});
test('C07 集团月票按主单和加钟的集团成功收入，不拿全支付/门店净额/finish', () => {
  const f = harness(feeState()); f.publish('fee'); const x = feeInvoiceSummary(f.s, 's1', '2026-09');
  assert.equal(x.netCents, 4470); assert.equal(x.blocked, false); assert.equal(x.sourceSnapshot.length, 2); assert.deepEqual(x.sourceSnapshot.map(x => x.paymentId), ['BP1', 'BX1']);
  f.applyFee(); assert.equal(f.inv.amount, 4470); assert.equal(f.inv.storeId, 's1'); assert.equal(f.inv.kind, 'company');
});
test('C07 失败与待收追偿不计收入；未知渠道阻断；只计线下实际收款', () => {
  const f = harness(feeState()); f.publish('fee'); offline(f); f.s.serviceFinanceEntries[0].splitHistory.push({ id: 'FAILED', kind: 'split', status: 'failed', amountCents: 99999 });
  assert.equal(feeInvoiceSummary(f.s, 's1', '2026-10').netCents, 1000);
  f.s.serviceFinanceEntries[0].finish = { status: 'processing', amountCents: 0 }; assert.match(feeInvoiceSummary(f.s, 's1', '2026-10').blockedReason, /未知/);
});
test('C07 原月份方案把跨月实际退回归到原收入，保持来源分配', () => {
  const f = harness(feeState()); f.publish('fee'); offline(f); feeReturn(f);
  const sep = feeInvoiceSummary(f.s, 's1', '2026-09'), oct = feeInvoiceSummary(f.s, 's1', '2026-10');
  assert.equal(sep.netCents, 3970); assert.equal(oct.netCents, 1000); assert.equal(sep.allocationSnapshot[0].returnId, 'return:RET1'); assert.equal(sep.allocationSnapshot[0].incomeId, 'split:SPLIT1');
  assert.equal(sep.netCents + oct.netCents, 4970); assert.equal(sep.refundedCents, 500);
});
test('C07 发生月份方案不篡改原月份；跨月负净额保留待核定而不自动结转', () => {
  const f = harness(feeState()); f.publish('fee', { returnPolicy: 'cash-month' }); feeReturn(f);
  assert.equal(feeInvoiceSummary(f.s, 's1', '2026-09').netCents, 4470);
  const x = feeInvoiceSummary(f.s, 's1', '2026-10'); assert.equal(x.netCents, -500); assert.match(x.blockedReason, /负净额/); assert.throws(() => f.applyFee('2026-10'), /负净额/);
  offline(f); const oct = feeInvoiceSummary(f.s, 's1', '2026-10'); assert.equal(oct.netCents, 500); assert.equal(oct.blocked, false);
});
test('C07 集团两种线下退回方向正确，已退金额只扣一次', () => {
  const f = harness(feeState()); f.publish('fee'); offline(f, 'return-failed', 200, 'O1'); offline(f, 'offline-adjustment', 100, 'O2');
  const x = feeInvoiceSummary(f.s, 's1', '2026-09'); assert.equal(x.netCents, 4170); assert.equal(x.refundedCents, 300); assert.equal(x.allocationSnapshot.length, 2);
  f.s.serviceFinanceRecoveries[0].payer = 'store:s1'; assert.equal(feeInvoiceSummary(f.s, 's1', '2026-09').blocked, true);
});
test('C07 缺成功完成时间/重复来源/线下收款失配/退回超收阻断', () => {
  for (const mutate of [f => { f.s.serviceFinanceEntries[0].split.completedAt = null; }, f => { f.s.serviceFinanceEntries[0].splitHistory = [structuredClone(f.s.serviceFinanceEntries[0].split)]; }, f => { offline(f); f.s.serviceFinanceRecoveries[0].receivedCents++; }, f => { feeReturn(f, 9000); }]) { const f = harness(feeState()); f.publish('fee'); mutate(f); assert.equal(feeInvoiceSummary(f.s, 's1', '2026-09').blocked, true); assert.throws(() => f.applyFee()); }
});
test('C07 月末时区边界按显式时区；开放月份/历史起点/错误格式拒绝', () => {
  const f = harness(feeState()); f.publish('fee'); f.s.serviceFinanceEntries[1].split.completedAt = at('2026-10-01T00:00:00'); assert.equal(feeInvoiceSummary(f.s, 's1', '2026-09').netCents, 2980);
  assert.match(feeInvoiceSummary(f.s, 's1', '2026-11').blockedReason, /尚未结束/); assert.match(feeInvoiceSummary(f.s, 's1', '2026-13').blockedReason, /有效/);
  f.publish('fee', { sourceFromAt: at('2026-09-02T00:00:00') }); assert.match(feeInvoiceSummary(f.s, 's1', '2026-09').blockedReason, /起点/);
});
test('C07 月票成功退回后红冲原月份，原收入快照保留，重开可核对', () => {
  const f = harness(feeState()); f.publish('fee'); f.applyFee(); f.issue(); feeReturn(f); f.sync(); assert.equal(f.inv.status, 'red_pending'); assert.equal(f.inv.amount, 4470);
  f.run('red', { id: f.inv.id, version: f.inv.version, ticketNumber: 'RED-FEE', file }); f.run('reapply', { id: f.inv.id, version: f.inv.version, ...title }, store); assert.equal(f.inv.amount, 3970); assert.equal(f.inv.month, '2026-09');
});
test('C07 同一月份只能有一条当前申请，本店财务与企业抬头约束', () => {
  const f = harness(feeState()); f.publish('fee'); assert.throws(() => f.applyFee('2026-09', {}, { ...store, storeId: 's2' }), /本门店/); assert.throws(() => f.applyFee('2026-09', { kind: 'personal' }), /企业/);
  f.applyFee(); assert.throws(() => f.applyFee(), /已有/); assert.throws(() => f.issue({}, store), /集团财务/);
});
test('C07 岗位、资源及附件slot/ref实时校验，店长不读税务资料', () => {
  const f = harness(); f.publish(); f.apply(); f.issue();
  for (const actor of [{ role: 'group', job: 'operations' }, { role: 'group', job: 'support' }, { role: 'store', storeId: 's1' }, { role: 'manager', storeId: 's1' }, { role: 'user', userId: 'u2' }, { role: 'tech', techId: 't1' }]) {
    assert.equal(canReadCommerceInvoice(f.s, actor, f.inv), false); assert.throws(() => authorizedCommerceInvoiceFile(f.s, actor, f.inv.id, 'issued', file.ref), /无权/); assert.throws(() => f.run('replace-file', { id: f.inv.id, version: f.inv.version, slot: 'issued', reason: 'x', file }, actor), /集团财务/);
  }
  assert.deepEqual(authorizedCommerceInvoiceFile(f.s, user, f.inv.id, 'issued', file.ref), file); assert.throws(() => authorizedCommerceInvoiceFile(f.s, user, f.inv.id, 'red', file.ref), /更新/); assert.throws(() => authorizedCommerceInvoiceFile(f.s, user, f.inv.id, 'issued', 'stale'), /更新/);
});
test('C07 失效工作会话和伪造会话不能用旧页面或重放绕过', () => {
  const f = harness(); f.publish(); f.apply(); f.issue();
  const a = { ...finance, sessionId: 'SESSION', accountId: 'A', grantId: 'GRANT' };
  f.s.staffAccounts = [{ id: 'A', enabled: true, version: 1, grants: [{ id: 'GRANT', enabled: true, role: 'group', job: 'finance' }] }];
  f.s.staffSessions = [{ id: 'SESSION', accountId: 'A', grantId: 'GRANT', accountVersion: 1, revokedAt: f.s.now }];
  assert.equal(canReadCommerceInvoice(f.s, a, f.inv), false); assert.throws(() => authorizedCommerceInvoiceFile(f.s, a, f.inv.id, 'issued', file.ref), /无权/);
  assert.throws(() => f.issue({ requestId: 'replay' }, a), /失效/); assert.throws(() => f.issue({}, { ...finance, accountId: 'A' }), /会话缺失/);
});
test('C07 月票未知阻断只作用目标月及同来源，别的新订单不冻结历史月份', () => {
  for (const returnPolicy of ['cash-month', 'original-income-fifo']) {
    const f = harness(feeState()); f.publish('fee', { returnPolicy });
    f.s.bookings.push({ id: 'BK-NOV', storeId: 's1', payment: { id: 'BP-NOV', status: 'success' }, refunds: [{ status: 'requested', createdAt: at('2026-11-01T12:00:00') }] });
    f.s.serviceFinanceEntries.push({ id: 'SF-NOV', bookingId: 'BK-NOV', storeId: 's1', paymentId: 'BP-NOV', split: { id: 'ST-NOV', kind: 'split', status: 'processing', amountCents: 500, createdAt: at('2026-11-01T12:00:00') }, returns: [] });
    const x = feeInvoiceSummary(f.s, 's1', '2026-09'); assert.equal(x.netCents, 4470); assert.equal(x.blocked, false); f.applyFee();
  }
});
test('C07 原月份方案同源晚退待查询阻断，发生月方案不会冻结原收入月', () => {
  for (const returnPolicy of ['cash-month', 'original-income-fifo']) {
    const f = harness(feeState()); f.publish('fee', { returnPolicy }); f.s.serviceFinanceEntries[0].returns.push({ id: 'RET-LATE', kind: 'return', status: 'processing', amountCents: 500, createdAt: at('2026-10-02T12:00:00') });
    assert.equal(feeInvoiceSummary(f.s, 's1', '2026-09').blocked, returnPolicy === 'original-income-fifo');
  }
});
test('C07 不从undefined或空白原笔拼接伪造唯一来源', () => {
  for (const missing of [undefined, '', ' ', 123]) {
    const f = harness(feeState()); f.publish('fee'); f.s.serviceFinanceEntries[0].split.id = missing; assert.equal(feeInvoiceSummary(f.s, 's1', '2026-09').blocked, true);
    const g = harness(feeState()); g.publish('fee'); offline(g); g.s.serviceFinanceRecoveries[0].records[0].id = missing; assert.equal(feeInvoiceSummary(g.s, 's1', '2026-10').blocked, true);
  }
});
test('C07 有实收却缺记录或累计失配，不能借月份限定掩盖未知收入', () => {
  for (const records of [[], [{ id: 'RC-X', amountCents: 900, at: at('2026-11-01T12:00:00'), reference: 'BANK-X' }]]) {
    const f = harness(feeState()); f.publish('fee');
    f.s.bookings.push({ id: 'BK-X', storeId: 's1', payment: { id: 'BP-X', status: 'success' }, refunds: [] });
    f.s.serviceFinanceEntries.push({ id: 'SF-X', storeId: 's1', bookingId: 'BK-X', paymentId: 'BP-X', split: null, returns: [] });
    f.s.serviceFinanceRecoveries.push({ id: 'SR-X', entryId: 'SF-X', storeId: 's1', bookingId: 'BK-X', paymentId: 'BP-X', type: 'unshared-release', payer: 'store:s1', payee: 'group', receivedCents: 1000, records });
    const x = feeInvoiceSummary(f.s, 's1', '2026-09'); assert.equal(x.blocked, true); assert.equal(x.basisValid, false); assert.throws(() => f.applyFee());
  }
});
test('C07 原商品申请人与订单归属失配，不能由新归属人修改旧票', () => {
  const f = harness(); f.publish(); f.apply(); f.run('reject', { id: f.inv.id, version: f.inv.version, reason: '需更正' }); f.o.userId = 'u2';
  assert.equal(canReadCommerceInvoice(f.s, { role: 'user', userId: 'u2' }, f.inv), false);
  assert.throws(() => f.run('resubmit', { id: f.inv.id, version: f.inv.version, ...title }, { role: 'user', userId: 'u2' }), /归属/);
});

const compositionReason = '平台服务费与推广成本组成待核对';
function markPromotion(f, paymentId = 'BP1') {
  const b = f.s.bookings[0], snapshot = {promoter:{id:'SP1',personKind:'user',personId:'u2',ownerType:'store',ownerStoreId:'s1'}};
  if (paymentId === b.payment.id) b.servicePromotionSnapshot = snapshot;
  else b.extensions.find(p => p.id === paymentId).servicePromotionSnapshot = snapshot;
}
test('C03 月票不把成功A或目标H快照作为逐笔实际服务费，未知组成排除于开票来源', () => {
  const f = harness(feeState()); f.publish('fee'); markPromotion(f);
  f.s.serviceFinanceEntries[0].split.amountCents = 4980;
  f.s.serviceFinanceEntries[0].split.basisSnapshot = {platformCents:2980,platformSplitCents:2980,commissionCents:4000,promotionStoreCents:2000};
  const before = structuredClone(f.s), x = feeInvoiceSummary(f.s,'s1','2026-09');
  assert.equal(x.blocked,true); assert.equal(x.basisValid,false); assert.equal(x.blockedReason,compositionReason);
  assert.equal(x.sourceSnapshot.length,0); assert.equal(x.netCents,0); assert.equal(x.paidCents,0);
  assert.deepEqual(x.compositionPendingSources.map(r => [r.id,r.amountCents]),[['split:SPLIT1',4980],['split:SPLIT2',1490]]);
  assert.throws(() => f.applyFee(),new RegExp(compositionReason)); assert.deepEqual(f.s,before);
  // Even Cs=0 in the target snapshot does not establish a historical cash split.
  Object.assign(f.s.serviceFinanceEntries[0].split.basisSnapshot,{platformCents:4980,platformSplitCents:4980,promotionStoreCents:0});
  assert.equal(feeInvoiceSummary(f.s,'s1','2026-09').blockedReason,compositionReason);
});
test('C03 仅加钟带个人推广时，主款H-only保留，加钟成功A不混开', () => {
  const f = harness(feeState()); f.publish('fee'); markPromotion(f,'BX1');
  const x = feeInvoiceSummary(f.s,'s1','2026-09');
  assert.equal(x.blockedReason,compositionReason); assert.equal(x.netCents,2980);
  assert.deepEqual(x.sourceSnapshot.map(r => r.paymentId),['BP1']);
  assert.deepEqual(x.compositionPendingSources.map(r => r.paymentId),['BX1']);
});
test('C03 当前和历史补分账逐笔保留待核对，normalCents不能冒充H', () => {
  const f = harness(feeState()); f.publish('fee'); markPromotion(f,'BX1');
  const e = f.s.serviceFinanceEntries[1];
  e.split = {id:'SPLIT3',kind:'split',status:'success',amountCents:1200,normalCents:1000,extraCents:200,completedAt:at('2026-09-30T16:00:00'),requestNo:'ORIGINAL-COMBO',basisSnapshot:{platformCents:500,platformSplitCents:500,promotionStoreCents:500}};
  e.splitHistory = [{id:'SPLIT2',kind:'split',status:'success',amountCents:1490,completedAt:at('2026-09-30T12:00:00'),requestNo:'ORIGINAL-INITIAL'}];
  const before = structuredClone(f.s), x = feeInvoiceSummary(f.s,'s1','2026-09');
  assert.equal(x.blockedReason,compositionReason); assert.equal(x.netCents,2980);
  assert.deepEqual(x.compositionPendingSources.map(r => [r.transactionId,r.amountCents,r.reference]),[['SPLIT2',1490,'ORIGINAL-INITIAL'],['SPLIT3',1200,'ORIGINAL-COMBO']]);
  assert.deepEqual(f.s,before);
});
test('C03 原推广成功回退不猜H/Cs分摊；两种月份方案都保留原成功事实', () => {
  for (const returnPolicy of ['cash-month','original-income-fifo']) {
    const f = harness(feeState()); f.publish('fee',{returnPolicy}); markPromotion(f); feeReturn(f);
    const before = structuredClone(f.s);
    for (const month of ['2026-09','2026-10']) {
      const x = feeInvoiceSummary(f.s,'s1',month);
      if (returnPolicy === 'original-income-fifo' && month === '2026-10') { assert.equal(x.blocked,false); assert.equal(x.netCents,0); continue; }
      assert.equal(x.blockedReason,compositionReason); assert.equal(x.netCents,0);
      assert.ok(x.compositionPendingSources.some(r => r.id === 'return:RET1' && r.kind === 'return' && r.at === at('2026-10-02T12:00:00')));
    }
    assert.deepEqual(f.s,before);
  }
});
for (const type of ['unshared-release','return-failed','offline-adjustment']) test(`C03 ${type}实际收退按occurredAt定位，不按登记时间开票或猜组成`, () => {
  const f = harness(feeState()); f.publish('fee',{returnPolicy:'cash-month'}); markPromotion(f);
  f.s.serviceFinanceEntries.forEach(e => {e.split=null;});
  offline(f,type,1000); const record = f.s.serviceFinanceRecoveries[0].records[0];
  record.at = at('2026-10-02T12:00:00'); record.recordedAt=record.at; record.occurredAt=at('2026-09-30T23:59:00');
  const before=structuredClone(f.s), sep=feeInvoiceSummary(f.s,'s1','2026-09'), oct=feeInvoiceSummary(f.s,'s1','2026-10');
  assert.equal(sep.blockedReason,compositionReason); assert.equal(sep.netCents,0); assert.equal(sep.compositionPendingSources[0].at,record.occurredAt);
  assert.equal(sep.compositionPendingSources[0].kind,type==='unshared-release'?'income':'return');
  assert.equal(oct.blocked,false); assert.equal(oct.netCents,0); assert.equal(oct.compositionPendingSources.length,0); assert.deepEqual(f.s,before);
});
test('C03 已注明推广的原entry或完结补差遗失快照仍待核对，不能降回H-only', () => {
  for (const mark of [f => {f.s.serviceFinanceEntries[0].sourceSnapshot={status:'promotion-pending',promoterId:'SP1'};},f => {f.s.serviceFinanceEntries[0].servicePromotionSnapshot={promoter:{id:'SP1'}};},f => {offline(f);f.s.serviceFinanceRecoveries[0].reasonCode='finished-adjustment';f.s.serviceFinanceRecoveries[0].records[0].occurredAt=at('2026-10-01T12:00:00');}]) {
    const f=harness(feeState()); f.publish('fee'); mark(f);
    const x=feeInvoiceSummary(f.s,'s1','2026-09'); assert.equal(x.blockedReason,compositionReason); assert.equal(x.netCents,1490); assert.equal(x.sourceSnapshot.some(r => r.entryId==='SF1'),false);
  }
});
test('C03 推广失败、未实际收款和zero/finish不会虚构现金或组成问题', () => {
  const f=harness(feeState()); f.publish('fee'); markPromotion(f);
  f.s.serviceFinanceEntries.forEach(e => {e.split={status:'zero',amountCents:0};e.splitHistory=[{id:'FAILED-'+e.id,kind:'split',status:'failed',amountCents:9999}];});
  offline(f); const r=f.s.serviceFinanceRecoveries[0];r.receivedCents=0;r.records=[];
  const x=feeInvoiceSummary(f.s,'s1','2026-09'); assert.equal(x.blocked,false); assert.equal(x.basisValid,true);assert.equal(x.netCents,0);assert.equal(x.compositionPendingSources.length,0);assert.throws(() => f.applyFee(),/净额/);
});
test('C03 可定位到不同月份的另笔推广实收不冻结原H-only历史月', () => {
  for (const returnPolicy of ['cash-month','original-income-fifo']) {
    const f=harness(feeState());f.publish('fee',{returnPolicy});
    f.s.bookings.push({id:'PROMO-OCT',storeId:'s1',payment:{id:'PROMO-PAY',status:'success'},servicePromotionSnapshot:{promoter:{id:'SP1'}},extensions:[],refunds:[]});
    f.s.serviceFinanceEntries.push({id:'PROMO-ENTRY',bookingId:'PROMO-OCT',storeId:'s1',paymentId:'PROMO-PAY',split:{id:'PROMO-SPLIT',kind:'split',status:'success',amountCents:4000,completedAt:at('2026-10-01T00:00:00')},splitHistory:[],returns:[]});
    const sep=feeInvoiceSummary(f.s,'s1','2026-09');assert.equal(sep.blocked,false);assert.equal(sep.netCents,4470);assert.equal(sep.compositionPendingSources.length,0);f.applyFee();assert.equal(f.inv.amount,4470);
    assert.equal(feeInvoiceSummary(f.s,'s1','2026-10').blockedReason,compositionReason);
  }
});
test('C03 原推广实收缺实际时间或记录不全不能借登记月和过滤掩盖未知组成', () => {
  for (const occurredAt of [undefined,null,'2026-09-30',-1,at('2026-11-03T00:00:00')]) {
    const f=harness(feeState());f.publish('fee',{returnPolicy:'cash-month'});markPromotion(f);f.s.serviceFinanceEntries.forEach(e => {e.split=null;});offline(f);f.s.serviceFinanceRecoveries[0].records[0].occurredAt=occurredAt;
    const before=structuredClone(f.s);
    for (const month of ['2026-09','2026-10']) {const x=feeInvoiceSummary(f.s,'s1',month);assert.equal(x.blockedReason,compositionReason);assert.equal(x.basisValid,false);assert.equal(x.netCents,0);assert.equal(x.sourceSnapshot.length,0);}
    assert.deepEqual(f.s,before);assert.throws(() => f.applyFee(),new RegExp(compositionReason));
  }
  const f=harness(feeState());f.publish('fee');markPromotion(f);f.s.serviceFinanceEntries.forEach(e => {e.split=null;});offline(f);f.s.serviceFinanceRecoveries[0].records=[];assert.equal(feeInvoiceSummary(f.s,'s1','2026-09').blocked,true);
});
test('C03 历史推广分账和回退缺实际完成时间或重复原ID仍不准开票', () => {
  for (const modify of [e => {e.split.completedAt=null;},e => {e.splitHistory=[{...e.split,completedAt:null}];e.split=null;},e => {e.splitHistory=[{...e.split}];},e => {e.returns=[{id:'RET-MISSING-TIME',kind:'return',status:'success',amountCents:500}];}]) {
    const f=harness(feeState());f.publish('fee');markPromotion(f);modify(f.s.serviceFinanceEntries[0]);assert.equal(feeInvoiceSummary(f.s,'s1','2026-09').basisValid,false);assert.throws(() => f.applyFee());
  }
});
test('C03 组成未核对保留原已开票金额号附件快照，不自动改写旧票或旧资金', () => {
  const f=harness(feeState());f.publish('fee');f.applyFee();f.issue();markPromotion(f);
  const before=structuredClone(f.s);f.sync();assert.deepEqual(f.s,before);assert.equal(f.inv.status,'issued');assert.equal(f.inv.issued.amountCents,4470);assert.equal(f.inv.issued.ticketNumber,'BLUE-1');
  assert.equal(feeInvoiceSummary(f.s,'s1','2026-09',f.inv.ruleSnapshot).blockedReason,compositionReason);
  assert.deepEqual(authorizedCommerceInvoiceFile(f.s,store,f.inv.id,'issued',file.ref),file);
});
test('C03 待开登记、驳回重提与红冲重开不能在推广组成未知时写出新票', () => {
  for (const stage of ['pending','rejected','red']) {
    const f=harness(feeState());f.publish('fee');f.applyFee();
    if(stage==='rejected')f.run('reject',{id:f.inv.id,version:f.inv.version,reason:'原资料需要核对'});
    if(stage==='red'){f.issue();feeReturn(f);f.sync();f.run('red',{id:f.inv.id,version:f.inv.version,ticketNumber:'RED-OLD',file});}
    markPromotion(f);const before=structuredClone(f.s);
    if(stage==='pending')assert.throws(() => f.issue(),new RegExp(compositionReason));
    else assert.throws(() => f.run(stage==='red'?'reapply':'resubmit',{id:f.inv.id,version:f.inv.version,...title},store),new RegExp(compositionReason));
    assert.deepEqual(f.s,before);
  }
});
test('C03 非推广历史线下H-only继续按原at，不倒套新增实际时间或改商品票', () => {
  const f=harness(feeState());f.publish('fee',{returnPolicy:'cash-month'});offline(f);f.s.serviceFinanceRecoveries[0].records[0].occurredAt=at('2026-09-30T23:59:00');
  const sep=feeInvoiceSummary(f.s,'s1','2026-09'),oct=feeInvoiceSummary(f.s,'s1','2026-10');assert.equal(sep.blocked,false);assert.equal(sep.netCents,4470);assert.equal(oct.netCents,1000);assert.equal(oct.blocked,false);assert.deepEqual(oct.compositionPendingSources,[]);
  f.publish('goods');const before=structuredClone(goodsInvoiceSummary(f.s,'G1'));markPromotion(f);assert.deepEqual(goodsInvoiceSummary(f.s,'G1'),before);
});
