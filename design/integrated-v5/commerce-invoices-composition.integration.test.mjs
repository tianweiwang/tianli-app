import test from 'node:test';
import assert from 'node:assert/strict';
import { captureBookingFinance, captureExtensionFinance, serviceFinanceCommand, serviceFinanceSummary, syncServiceFinance, upgradeServiceFinance } from './service-finance.mjs';
import { captureTechServicePromoter, captureServicePromotion, captureExtensionPromotion, servicePromotionCommand, syncServicePromotion, upgradeServicePromotion } from './service-promotion.mjs';
import { serviceFinanceComposition, serviceFinanceCashSource } from './service-finance-composition.mjs';
import { applyServiceRecoverySplit } from './service-finance-bridges.mjs';
import { upgradeServiceFinanceExtras, serviceFinanceExtrasCommand, serviceExtraSourceToken } from './service-finance-extras.mjs';
import { upgradeCommerceInvoices, commerceInvoiceCommand, syncCommerceInvoices, feeInvoiceSummary, authorizedCommerceInvoiceFile } from './commerce-invoices.mjs';

const DAY = 86400000, at = value => Date.parse(`${value}+08:00`);
const finance = { role: 'group', job: 'finance' }, store = { role: 'store', job: 'store-finance', storeId: 'a' };
const file = { ref: `invoice-file:${'a'.repeat(64)}`, name: '实际逐笔现金技术凭据.pdf', type: 'application/pdf', size: 123 };
const title = { kind: 'company', title: '明确技术受票主体', taxId: '91320100000000000X', email: 'technical@example.com' };
function fixture(returnPolicy = 'cash-month', startedAt = at('2026-09-01T08:00:00')) {
  const s = { schema: 5, seq: 0, now: startedAt, bookingRules: { maxDays: 7 },
    users: [{ id: 'buyer', serviceBinding: { status: 'unbound', origin: 'demo-initial', recordedAt: startedAt, version: 0 } }],
    stores: [{ id: 'a', active: true }, { id: 'b', active: true }], services: [{ id: 'svc' }], techs: [{ id: 'tech', storeId: 'a' }], bookings: [], safety: [], logs: [], serviceInvoices: [{ id: 'original-service-ticket' }] };
  let sequence = 0;
  const ctx = { id: prefix => prefix + ++s.seq, fail: message => { throw new Error(message); }, log: () => {}, validateEvidenceRefs: rows => JSON.stringify(rows) === JSON.stringify([file]), serviceFinanceSummary };
  upgradeServiceFinance(s); upgradeServicePromotion(s); upgradeCommerceInvoices(s);
  serviceFinanceCommand(s, finance, 'finance.rule-publish', { requestId: 'H-rule', scope: 'global', version: 0, groupBps: 1000, storeBps: 500, effectiveAt: s.now, reason: '显式技术H规则，正式政策另验' }, ctx);
  const promoter = captureTechServicePromoter(s, 'tech', { eligible: true, techId: 'tech', storeId: 'a', reference: '正式上岗技术来源', verifiedAt: s.now }, ctx);
  servicePromotionCommand(s, finance, 'service-promotion.rule-publish', { requestId: 'C-rule', version: 0, promoterType: 'tech', firstBps: 2000, repeatBps: 1000, storeCostBps: 5000, concurrency: 'completed-created-id', lateFullRefund: 'reassign', csRounding: 'floor', effectiveAt: s.now, basis: '显式技术首单与Cs规则，非正式财税政策' }, ctx);
  servicePromotionCommand(s, { role: 'user', userId: 'buyer' }, 'service-promotion.enter', { requestId: 'bind', version: 0, promoterId: promoter.id }, ctx);
  commerceInvoiceCommand(s, finance, 'commerce-invoice.rule-publish', { requestId: 'fee-rule', category: 'fee', version: 0, issuerName: '明确输入的技术集团', issuerTaxId: '91320100000000000Y', invoiceItem: 'Demo平台服务费', effectiveAt: s.now, sourceFromAt: at('2026-01-01T00:00:00'), reason: '本地技术选择，不确认正式财税政策', cycle: 'monthly', timezoneMinutes: 480, returnPolicy }, ctx);
  const sync = () => { syncServicePromotion(s, ctx, { phase: 'booking' }); syncServiceFinance(s, ctx); syncServicePromotion(s, ctx); };
  const book = (id = 'B1') => {
    const b = { id, userId: 'buyer', storeId: 'a', serviceId: 'svc', status: 'confirmed', createdAt: s.now, completedAt: null, payment: { id: `P-${id}`, amountCents: 20000, refundedCents: 0, status: 'success', paidAt: s.now }, extensions: [], refunds: [], disputes: [] };
    captureBookingFinance(s, b, ctx); captureServicePromotion(s, b, ctx); s.bookings.push(b); sync(); return b;
  };
  const entry = (b, paymentId = b.payment.id) => s.serviceFinanceEntries.find(e => e.bookingId === b.id && e.paymentId === paymentId);
  const run = (b, type, p = {}, paymentId = b.payment.id) => serviceFinanceCommand(s, finance, `finance.${type}`, { requestId: `finance-${++sequence}`, id: entry(b, paymentId).id, version: entry(b, paymentId).version, outcome: 'success', ...p }, ctx);
  const ready = b => { b.status = 'done'; b.completedAt = s.now; sync(); s.now += 2 * DAY + 1; sync(); };
  const refund = (b, amountCents) => { b.payment.refundedCents += amountCents; b.refunds.push({ id: `RF-${++sequence}`, status: 'success', executions: [{ paymentId: b.payment.id, status: 'success', amountCents, completedAt: s.now }] }); sync(); };
  const invoice = (type, p = {}, actor = finance) => commerceInvoiceCommand(s, actor, `commerce-invoice.${type}`, { requestId: `invoice-${++sequence}`, ...p }, ctx);
  const apply = (month = '2026-09') => invoice('apply-fee', { storeId: 'a', month, ...title }, store);
  const issue = row => invoice('issue', { id: row.id, version: row.version, ticketNumber: `BLUE-${++sequence}`, file });
  const receive = (debt, amountCents, occurredAt = s.now, extra = {}) => serviceFinanceCommand(s, finance, 'finance.recovery-receive', { requestId: `bank-${++sequence}`, id: debt.id, version: debt.version, amountCents, reference: `ACTUAL-BANK-${sequence}`, occurredAt, reason: '实际原债本次现金已核', evidenceRefs: [file], ...extra }, ctx);
  return { s, ctx, sync, book, entry, run, ready, refund, invoice, apply, issue, receive, summary: month => feeInvoiceSummary(s, 'a', month), close: () => { s.now = at('2026-11-02T12:00:00'); sync(); } };
}
function prepared(policy) { const f = fixture(policy), b = f.book(); f.ready(b); return { ...f, b, e: f.entry(b) }; }
function historyRow(f, key, hCents, csCents, extra = {}) {
  return { schema: 1, ...serviceFinanceCashSource(f.s, f.e.id, key), status: 'known', id: `CONF-${key}`, requestId: `CONFIRM-${key}`, version: 1, hCents, csCents, retainedCsCents: null, allocations: [], method: 'verified-history', allocationPolicySnapshot: null,
    recordedAt: f.s.now, by: finance, evidenceRefs: [file], reason: '逐笔实际核定技术输入，不采用默认分配', ...extra };
}
function twoReceipts(policy) {
  const f = fixture(policy), first = f.book('FIRST'); f.ready(first); const b = f.book('SECOND'); f.ready(b); f.run(b, 'split-start');
  const e = f.entry(b), s1 = structuredClone(e.split); f.s.now = at('2026-10-02T12:00:00'); f.refund(first, 20000); f.run(b, 'split-start');
  return { ...f, first, b, e, s1, s2: e.split };
}

test('原split命令保存逐笔已核组成，集团月票只开H并保留正常现金/Cs/原源', () => {
  const f = prepared(); f.run(f.b, 'split-start');
  assert.equal(f.e.split.cashCompositionRequest.status, 'known'); assert.equal(f.e.split.cashComposition.hCents, 1000); assert.equal(f.e.split.amountCents, 3000);
  f.close(); const before = structuredClone(f.s), summary = f.summary('2026-09');
  assert.equal(summary.blocked, false); assert.equal(summary.netCents, 1000); assert.equal(summary.paidCents, 1000); assert.deepEqual(summary.compositionPendingSources, []);
  const row = summary.sourceSnapshot[0]; assert.equal(row.normalCents, 3000); assert.equal(row.csCents, 2000); assert.equal(row.at, f.e.split.completedAt); assert.equal(row.cashSource.requestNo, f.e.split.requestNo); assert.deepEqual(row.cashAllocations, []);
  row.cashSource.storeId = 'changed-copy'; assert.deepEqual(f.s, before);
  const originalCash = structuredClone(f.s.serviceFinanceEntries); const ticket = f.apply(); f.issue(ticket); assert.equal(ticket.amount, 1000); assert.deepEqual(f.s.serviceFinanceEntries, originalCash);
});

test('原主款与加钟分别消费各笔H，实际A/全额支付均不合并计费', () => {
  const f = prepared(), extension = { id: 'EXT1', status: 'success', amountCents: 10000, refundedCents: 0, paidAt: f.s.now };
  captureExtensionFinance(f.s, f.b, extension, f.ctx); captureExtensionPromotion(f.s, f.b, extension); f.b.extensions.push(extension); f.sync(); f.s.now += 2 * DAY + 1; f.sync();
  f.run(f.b, 'split-start'); f.run(f.b, 'split-start', {}, extension.id); f.close(); const summary = f.summary('2026-09');
  assert.equal(summary.blocked, false); assert.equal(summary.netCents, 1500); assert.deepEqual(summary.sourceSnapshot.map(row => [row.paymentId, row.hCents, row.csCents]), [['P-B1', 1000, 2000], ['EXT1', 500, 1000]]);
});

test('跨月原首单重算只收Cs补差，10月H0已核且9月H不重复', () => {
  for (const policy of ['cash-month', 'original-income-fifo']) {
    const f = twoReceipts(policy); assert.equal(f.s2.cashComposition.hCents, 0); assert.equal(f.s2.cashComposition.csCents, 1000); f.close();
    const sep = f.summary('2026-09'), oct = f.summary('2026-10'); assert.equal(sep.blocked, false); assert.equal(sep.netCents, 1000); assert.equal(oct.blocked, false); assert.equal(oct.netCents, 0); assert.equal(oct.compositionPendingSources.length, 0);
    assert.equal(oct.sourceSnapshot[0].normalCents, 1000); assert.equal(oct.sourceSnapshot[0].hCents, 0); assert.throws(() => f.apply('2026-10'), /零或负/);
    assert.equal(f.s1.cashComposition.hCents, f.e.splitHistory.find(row => row.id === f.s1.id).cashComposition.hCents);
  }
});

test('processing原query跨月成功确认原请求分配，月票按真实成功时间不套最新H', () => {
  const f = prepared(); f.s.now = at('2026-09-30T23:50:00'); f.sync(); f.run(f.b, 'split-start', { outcome: 'processing' }); const original = structuredClone(f.e.split.cashCompositionRequest);
  f.s.now = at('2026-10-01T00:10:00'); f.refund(f.b, 10000); f.run(f.b, 'split-query', { transactionId: f.e.split.id }); f.close();
  assert.equal(f.e.split.cashComposition.hCents, 1000); assert.equal(f.e.split.cashComposition.basis.capturedAt, original.basis.capturedAt); assert.equal(serviceFinanceSummary(f.s, f.b.id, f.b.payment.id).platformCents, 500);
  assert.equal(f.summary('2026-09').netCents, 0); const oct = f.summary('2026-10'); assert.equal(oct.blocked, false); assert.equal(oct.netCents, 1000); assert.equal(oct.sourceSnapshot[0].at, f.e.split.completedAt);
});

test('原成功全笔回退只退本源H/Cs，cash-month保留负净额且不改9月已开票', () => {
  const f = prepared(); f.run(f.b, 'split-start'); f.s.now = at('2026-10-02T12:00:00'); f.sync(); const ticket = f.apply(); f.issue(ticket); const saved = structuredClone(ticket);
  f.refund(f.b, 20000); f.run(f.b, 'return-start', { amountCents: 3000, splitId: f.e.split.id, splitRequestNo: f.e.split.requestNo }); f.close(); syncCommerceInvoices(f.s, f.ctx);
  const sep = f.summary('2026-09'), oct = f.summary('2026-10'); assert.equal(sep.netCents, 1000); assert.equal(sep.blocked, false); assert.equal(oct.netCents, -1000); assert.match(oct.blockedReason, /负净额/); assert.deepEqual(ticket, saved);
  assert.equal(oct.sourceSnapshot[0].normalCents, 3000); assert.equal(oct.sourceSnapshot[0].csCents, 2000); assert.equal(oct.sourceSnapshot[0].cashAllocations[0].incomeSourceId, `split:${f.e.split.id}`); assert.throws(() => f.apply('2026-10'), /负净额/);
});

test('original-income-fifo保留实际原笔引用并完成原票红冲和剩余H重开', () => {
  const f = prepared('original-income-fifo'); f.run(f.b, 'split-start'); const other = f.book('OTHER'); f.ready(other); f.run(other, 'split-start');
  f.s.now = at('2026-10-02T12:00:00'); f.sync(); const ticket = f.apply(); f.issue(ticket); const original = structuredClone(ticket);
  f.refund(f.b, 20000); f.run(f.b, 'return-start', { amountCents: 3000, splitId: f.e.split.id, splitRequestNo: f.e.split.requestNo }); f.close(); syncCommerceInvoices(f.s, f.ctx);
  assert.equal(ticket.status, 'red_pending'); assert.equal(ticket.amount, 2000); assert.deepEqual(ticket.sourceSnapshot, original.sourceSnapshot); assert.deepEqual(ticket.issued, original.issued);
  const summary = f.summary('2026-09'); assert.equal(summary.netCents, 1000); assert.equal(summary.allocationSnapshot[0].cashAllocations[0].incomeSourceId, `split:${f.e.split.id}`); assert.equal(summary.allocationSnapshot[0].normalReturnCents, 3000);
  f.invoice('red', { id: ticket.id, version: ticket.version, ticketNumber: 'RED-ORIGINAL', file }); const next = f.invoice('reapply', { id: ticket.id, version: ticket.version, ...title }, store); f.issue(next);
  assert.equal(next.amount, 1000); assert.equal(next.replacesId, ticket.id); assert.equal(ticket.replacedById, next.id); assert.deepEqual(authorizedCommerceInvoiceFile(f.s, store, ticket.id, 'issued', file.ref), file);
});

test('多原笔纯Cs回退不消耗原H也不触发服务费红冲', () => {
  for (const policy of ['cash-month', 'original-income-fifo']) {
    const f = twoReceipts(policy); const ticket = f.apply(); f.issue(ticket); const original = structuredClone(ticket);
    f.refund(f.b, 20000); f.run(f.b, 'return-start', { amountCents: 1000, splitId: f.s2.id, splitRequestNo: f.s2.requestNo }); f.close(); syncCommerceInvoices(f.s, f.ctx);
    const returned = f.e.returns.at(-1); assert.equal(returned.cashComposition.hCents, 0); assert.equal(returned.cashComposition.csCents, 1000); assert.deepEqual(ticket, original);
    assert.equal(f.summary('2026-09').netCents, 1000); assert.equal(f.summary('2026-10').netCents, 0); assert.equal(serviceFinanceComposition(f.s, f.e.id).returnSources.find(row => row.incomeSourceId === `split:${f.s1.id}`).hRemainingCents, 1000);
  }
});

test('部分混合成功回退未定分配仍blocked，独立有据核定后仅退H份额', () => {
  const f = prepared('original-income-fifo'); f.run(f.b, 'split-start'); f.s.now = at('2026-10-02T12:00:00'); f.refund(f.b, 10000); f.run(f.b, 'return-start', { amountCents: 500, splitId: f.e.split.id, splitRequestNo: f.e.split.requestNo }); f.close();
  const returned = f.e.returns.at(-1); assert.equal(returned.cashComposition.status, 'needs-review'); assert.equal(f.summary('2026-09').blocked, true); assert.equal(f.summary('2026-09').compositionPendingSources[0].amountCents, 500);
  f.s.serviceFinanceCompositions = [historyRow(f, `return:${returned.id}`, 200, 300, { method: 'approved-allocation', allocationPolicySnapshot: { id: 'ACTUAL-PER-SOURCE-APPROVAL', version: 1, mode: 'per-source-approved', basis: '本笔实际凭据的H200/Cs300技术输入' }, allocations: [{ incomeSourceId: `split:${f.e.split.id}`, incomeRequestNo: f.e.split.requestNo, hCents: 200, csCents: 300 }] })];
  const summary = f.summary('2026-09'); assert.equal(summary.blocked, false); assert.equal(summary.netCents, 800); assert.equal(summary.refundedCents, 200); assert.equal(summary.allocationSnapshot[0].csReturnCents, 300);
});

test('同原支付后来月未核/processing只阻断cash-month实际月，FIFO继续等待原链', () => {
  for (const outcome of ['success', 'processing']) for (const policy of ['cash-month', 'original-income-fifo']) {
    const f = prepared(policy); f.run(f.b, 'split-start'); f.s.now = at('2026-10-02T12:00:00'); f.refund(f.b, 10000); f.run(f.b, 'return-start', { amountCents: 500, splitId: f.e.split.id, splitRequestNo: f.e.split.requestNo, outcome }); f.close();
    const sep = f.summary('2026-09'), oct = f.summary('2026-10'); assert.equal(sep.netCents, 1000); assert.equal(sep.blocked, policy === 'original-income-fifo');
    if (policy === 'cash-month') assert.equal(oct.blocked, true);
  }
});

test('25日H先收后30日原店债跨月分次实收Cs，occurredAt与登记月分开', () => {
  const f = fixture(), b = f.book(), e = f.entry(b); f.s.now = e.paidAt + 25 * DAY; f.sync(); f.run(b, 'split-start');
  b.status = 'done'; b.completedAt = f.s.now; f.s.now = e.paidAt + 30 * DAY; f.sync(); const debt = f.s.serviceFinanceRecoveries.find(row => row.entryId === e.id && row.type === 'unshared-release');
  f.s.now = at('2026-10-03T12:00:00'); f.receive(debt, 500, at('2026-10-01T08:00:00')); f.receive(debt, 1500, at('2026-10-02T08:00:00')); f.close();
  const before = structuredClone(f.s), sep = f.summary('2026-09'), oct = f.summary('2026-10'); assert.equal(sep.netCents, 1000); assert.equal(sep.blocked, false); assert.equal(oct.netCents, 0); assert.equal(oct.blocked, false);
  assert.deepEqual(oct.sourceSnapshot.map(row => [row.at, row.normalCents, row.hCents, row.csCents]), [[at('2026-10-01T08:00:00'), 500, 0, 500], [at('2026-10-02T08:00:00'), 1500, 0, 1500]]); assert.deepEqual(f.s, before);
});

test('原店债足额实际混合回款按发生月开H，缺真实发生时间不能用登记时间补', () => {
  const f = prepared(); f.s.now = f.e.paidAt + 30 * DAY; f.sync(); const debt = f.s.serviceFinanceRecoveries.find(row => row.entryId === f.e.id && row.type === 'unshared-release');
  f.s.now = at('2026-11-01T12:00:00'); f.receive(debt, 3000, at('2026-10-02T12:00:00')); f.close(); const summary = f.summary('2026-10');
  assert.equal(summary.blocked, false); assert.equal(summary.netCents, 1000); assert.equal(summary.sourceSnapshot[0].at, at('2026-10-02T12:00:00')); assert.equal(summary.sourceSnapshot[0].recoveryId, debt.id);
  delete debt.records[0].occurredAt; const before = structuredClone(f.s); assert.equal(f.summary('2026-10').blocked, true); assert.equal(f.summary('2026-09').blocked, true); assert.deepEqual(f.s, before);
});

test('原渠道失败后的真实线下代退按原split组成退H，失败渠道不重复扣', () => {
  const f = prepared('original-income-fifo'); f.run(f.b, 'split-start'); f.s.now = at('2026-10-02T12:00:00'); f.refund(f.b, 20000); f.run(f.b, 'return-start', { amountCents: 3000, splitId: f.e.split.id, splitRequestNo: f.e.split.requestNo, outcome: 'failed' });
  const debt = f.s.serviceFinanceRecoveries.find(row => row.entryId === f.e.id && row.type === 'return-failed'); f.receive(debt, 3000, f.s.now, { splitId: f.e.split.id }); f.close();
  const summary = f.summary('2026-09'); assert.equal(summary.blocked, false); assert.equal(summary.refundedCents, 1000); assert.equal(summary.netCents, 0); assert.equal(summary.allocationSnapshot.length, 1); assert.equal(summary.allocationSnapshot[0].cashSource.kind, 'recovery');
  assert.equal(debt.records[0].cashComposition.csCents, 2000); assert.equal(summary.allocationSnapshot[0].cashAllocations[0].incomeSourceId, `split:${f.e.split.id}`);
});

test('原C04 propose/confirm/pay/query自动冻结正常组成，月票H与垫付本金独立', () => {
  const f = prepared(); upgradeServiceFinanceExtras(f.s);
  const debt = { id: 'ORIGINAL-C04-DEBT', version: 1, storeId: 'a', payer: 'store:a', payee: 'group', amountCents: 1000, receivedCents: 0, createdAt: f.b.createdAt - 1, actualFundAt: f.b.createdAt - 1, records: [] };
  f.s.serviceExtraRecoveries = [debt]; let request = 0;
  const command = (type, p, actor = finance) => serviceFinanceExtrasCommand(f.s, actor, `service-extra.${type}`, { requestId: `C04-${++request}`, ...p }, { ...f.ctx, applyRecoverySplit: (state, payload, writer) => applyServiceRecoverySplit(state, payload, writer, f.ctx) });
  const plan = command('offset-propose', { entryId: f.e.id, recoveryId: debt.id, amountCents: 1000, version: 0, sourceToken: serviceExtraSourceToken(f.s, f.b.id, f.b.payment.id), reason: '原垫付后的同店后续款技术方案' });
  assert.equal(plan.cashCompositionRequest.hCents, 1000); assert.equal(plan.cashCompositionRequest.csCents, 2000);
  command('offset-confirm', { id: plan.id, version: plan.version, decision: 'accept', reason: '本店核对正常组成和追加本金' }, store);
  command('offset-pay', { id: plan.id, version: plan.version, outcome: 'processing' }); assert.equal(f.e.split.cashCompositionRequest.hCents, 1000); f.s.now += 1;
  command('offset-query', { id: plan.id, version: plan.version, outcome: 'success' }); assert.equal(f.e.split.cashComposition.hCents, 1000); f.close(); const before = structuredClone(f.s), summary = f.summary('2026-09');
  assert.equal(summary.blocked, false); assert.equal(summary.netCents, 1000); assert.equal(summary.sourceSnapshot[0].normalCents, 3000); assert.equal(summary.sourceSnapshot[0].csCents, 2000); assert.equal(summary.principalSources[0].amountCents, 1000); assert.equal(summary.principalSources[0].planId, plan.id); assert.deepEqual(f.s, before);
  f.e.split.channelTotalCents++; assert.equal(f.summary('2026-09').blocked, true);
});

test('原offline-adjustment真实退回精确引用已收店债record，只扣其已核H', () => {
  const f = prepared(); f.s.now = f.e.paidAt + 30 * DAY; f.sync(); const income = f.s.serviceFinanceRecoveries.find(row => row.entryId === f.e.id && row.type === 'unshared-release');
  f.s.now = at('2026-10-02T12:00:00'); f.receive(income, 3000); const record = income.records[0]; f.refund(f.b, 10000);
  const adjustment = f.s.serviceFinanceRecoveries.find(row => row.entryId === f.e.id && row.type === 'offline-adjustment'); f.s.now += 1;
  f.receive(adjustment, 1500, f.s.now, { incomeSourceId: `recovery:${income.id}:${record.id}`, incomeRequestNo: record.reference }); f.close();
  const summary = f.summary('2026-10'); assert.equal(summary.blocked, false); assert.equal(summary.netCents, 500); assert.equal(summary.refundedCents, 500); assert.equal(adjustment.records[0].cashComposition.csCents, 1000);
  const returned = summary.sourceSnapshot.find(row => row.kind === 'return'); assert.equal(returned.cashAllocations[0].incomeSourceId, `recovery:${income.id}:${record.id}`); assert.equal(returned.cashAllocations[0].incomeRequestNo, record.reference);
});

test('C04纯本金正常额0不制造H/未知组成，投影重复原引用不重复本金', () => {
  const f = prepared(); f.e.split = { id: 'PRINCIPAL-ONLY', requestNo: 'PRINCIPAL-NO', kind: 'split', amountCents: 0, channelTotalCents: 1000, recoveryCents: 1000, serviceExtraPlanId: 'PRINCIPAL-PLAN', status: 'success', createdAt: f.s.now, completedAt: f.s.now }; f.e.splitHistory.push(structuredClone(f.e.split)); f.close();
  const summary = f.summary('2026-09'); assert.equal(summary.blocked, false); assert.equal(summary.netCents, 0); assert.equal(summary.sourceSnapshot.length, 0); assert.equal(summary.compositionPendingSources.length, 0); assert.equal(summary.principalSources.length, 1); assert.throws(() => f.apply(), /零或负/);
});

test('旧成功/旧processing缺原请求不补核，旧目标快照不成为月票现金H', () => {
  for (const outcome of ['success', 'processing']) {
    const f = prepared(); f.run(f.b, 'split-start', { outcome }); delete f.e.split.cashComposition; delete f.e.split.cashCompositionRequest;
    if (outcome === 'processing') { f.s.now += 1; f.run(f.b, 'split-query', { transactionId: f.e.split.id }); }
    f.close(); const before = structuredClone(f.s), summary = f.summary('2026-09'); assert.equal(summary.blocked, true); assert.equal(summary.netCents, 0); assert.equal(summary.compositionPendingSources[0].amountCents, 3000); assert.deepEqual(f.s, before); assert.equal(f.e.split.cashComposition?.status, undefined);
  }
});

test('错原号/主款/加钟/店/实际时间及重复冲突逐笔组成均不通过月票守卫', () => {
  for (const mutate of [f => { f.e.split.requestNo = 'changed'; }, f => { f.e.split.cashComposition.source.paymentId = 'other-extension'; }, f => { f.e.split.cashComposition.source.storeId = 'b'; }, f => { f.e.split.cashComposition.actualAt++; }, f => { f.e.splitHistory.push({ ...structuredClone(f.e.split), amountCents: 3001 }); }, f => { f.e.split.completedAt = null; }]) {
    const f = prepared(); f.run(f.b, 'split-start'); mutate(f); f.close(); const before = structuredClone(f.s); assert.equal(f.summary('2026-09').blocked, true); assert.equal(f.summary('2026-09').netCents, 0); assert.throws(() => f.apply(), /核对|来源/); assert.deepEqual(f.s, before);
  }
});

test('无关10月旧推广缺组成不冻结9月另一已核收入，跨店不可读申请', () => {
  const f = prepared(); f.run(f.b, 'split-start'); f.s.now = at('2026-10-02T12:00:00'); const other = f.book('OTHER'); f.ready(other); f.run(other, 'split-start'); const entry = f.entry(other); delete entry.split.cashComposition; delete entry.split.cashCompositionRequest; f.close();
  assert.equal(f.summary('2026-09').blocked, false); assert.equal(f.summary('2026-09').netCents, 1000); assert.equal(f.summary('2026-10').blocked, true); const invoice = f.apply();
  assert.throws(() => authorizedCommerceInvoiceFile(f.s, { role: 'store', job: 'store-finance', storeId: 'b' }, invoice.id, 'issued', file.ref), /无权/);
});

test('原预约推广字段丢失仍识别原现金推广标记，已核H可读/旧缺组成不降回H-only', () => {
  for (const complete of [true, false]) {
    const f = prepared(); f.run(f.b, 'split-start'); f.close(); delete f.b.servicePromotionSnapshot; delete f.e.servicePromotionSnapshot; delete f.e.sourceSnapshot;
    if (!complete) { delete f.e.split.cashComposition; delete f.e.split.cashCompositionRequest; }
    const before = structuredClone(f.s), summary = f.summary('2026-09'); assert.equal(summary.blocked, !complete); assert.equal(summary.netCents, complete ? 1000 : 0); assert.deepEqual(f.s, before);
  }
});

test('cash-month已开票新增同月纯Cs实际追收保留对账行而不触发H红冲', () => {
  const f = fixture('cash-month', at('2026-08-31T08:00:00')), b = f.book(), e = f.entry(b); f.s.now = e.paidAt + 25 * DAY; f.sync(); f.run(b, 'split-start');
  b.status = 'done'; b.completedAt = f.s.now; f.s.now = e.paidAt + 30 * DAY; f.sync(); const debt = f.s.serviceFinanceRecoveries.find(row => row.entryId === e.id && row.type === 'unshared-release');
  const actualAt = f.s.now; f.s.now = at('2026-10-02T12:00:00'); f.sync(); const ticket = f.apply(); f.issue(ticket); const original = structuredClone(ticket); f.receive(debt, 2000, actualAt);
  syncCommerceInvoices(f.s, f.ctx); const summary = f.summary('2026-09'); assert.deepEqual(ticket, original); assert.equal(summary.netCents, 1000); assert.equal(summary.sourceSnapshot.length, 2); assert.equal(summary.sourceSnapshot[1].hCents, 0); assert.equal(summary.sourceSnapshot[1].csCents, 2000);
});
