import test from 'node:test';
import assert from 'node:assert/strict';
import { seed, reduce, upgradeFinanceState } from './engine.mjs';
import { serviceFinanceView } from './service-finance.mjs';
import { techIncomeView } from './tech-income.mjs';

const user = { role: 'user', userId: 'u1' }, tech = { role: 'tech', techId: 'lin' };
const finance = { role: 'group', job: 'finance' }, support = { role: 'group', job: 'support' };
const store = { role: 'store', storeId: 'xingfu' }, DAY = 86400000;
function harness() {
  let s = seed(), request = 0;
  const run = (actor, type, p = {}) => { s = reduce(s, actor, type, { requestId: `integrated-${++request}`, ...p }); return s; };
  return {
    get s() { return s; }, get b() { return s.bookings.at(-1); }, run,
    advance(minutes) { run(finance, 'clock.advance', { minutes }); },
    create(extra = {}) { run(user, 'booking.create', { storeId: 'xingfu', serviceId: 'relax', regionId: 'home', techId: 'lin', startAt: s.now + 4 * 3600000, mode: 'specified', genderPreference: 'any', contactName: '演示顾客', phone: '13800000001', healthConsent: true, identityVerified: true, adultConfirmed: true, ...extra }); },
    done() { this.create(); run(user, 'booking.pay', { id: this.b.id, outcome: 'success' }); run(tech, 'booking.accept', { id: this.b.id }); this.advance(240); run(tech, 'booking.start', { id: this.b.id }); this.advance(60); run(tech, 'booking.finish', { id: this.b.id, mode: 'normal' }); }
  };
}

test('K05 空规则不改变原预约完成流程，完成后资金与提成均待核，未伪造应得', () => {
  const h = harness(); h.done();
  assert.equal(h.b.status, 'done'); assert.equal(h.b.finishMode, 'normal');
  assert.equal(h.s.techIncomeEntries.length, 1); assert.equal(h.s.techIncomeEntries[0].amountCents, null);
  assert.equal(h.s.techIncomePayouts.length, 0); assert.equal(h.s.bills.length, 0);
  const count = h.s.techIncomeEntries.length; h.advance(60); assert.equal(h.s.techIncomeEntries.length, count);
});

test('K05 特批受理限客服且超过48小时、30天内；受理不执行退款，最终财务逐笔执行', () => {
  const h = harness(); h.done();
  const p = { id: h.b.id, requests: [{ paymentId: h.b.payment.id, amountCents: 9800 }], reason: '用户电话反馈，核实记录 DEMO-CASE-1', requestId: 'special-one' };
  for (const actor of [user, tech, store, finance]) assert.throws(() => h.run(actor, 'booking.special-aftersale', p));
  assert.throws(() => h.run(support, 'booking.special-aftersale', p), /48小时/);
  h.advance(2880); assert.throws(() => h.run(support, 'booking.special-aftersale', p), /48小时/);
  h.advance(1); h.run(support, 'booking.special-aftersale', p);
  const id = h.b.refunds[0].id;
  assert.equal(h.b.refunds[0].status, 'escalated'); assert.equal(h.b.payment.refundedCents, 0);
  h.run(support, 'booking.special-aftersale', p); assert.equal(h.b.refunds.length, 1);
  assert.throws(() => h.run(support, 'booking.special-aftersale', { ...p, reason: '替换旧内容' }), /同一/);
  assert.throws(() => h.run(support, 'booking.special-aftersale', { ...p, requestId: 'second' }), /未结/);
  assert.throws(() => h.run(finance, 'booking.refund-review', { id: h.b.id, refundId: id, decision: 'approve', amountCents: 9800, reason: '越权' }), /岗位/);
  h.run(support, 'booking.refund-review', { id: h.b.id, refundId: id, decision: 'approve', amountCents: 9800, reason: '核实符合原诉求' });
  assert.throws(() => h.run(support, 'booking.refund-pay', { id: h.b.id, refundId: id, outcome: 'success' }), /岗位/);
  h.run(finance, 'booking.refund-pay', { id: h.b.id, refundId: id, outcome: 'processing' });
  assert.equal(h.b.payment.refundedCents, 0);
  h.run(finance, 'booking.refund-query', { id: h.b.id, refundId: id, outcome: 'success' });
  assert.equal(h.b.payment.refundedCents, 9800); assert.equal(h.b.status, 'done');
  h.advance(28 * 1440); assert.ok(h.s.now > h.b.completedAt + 30 * DAY);
  assert.throws(() => h.run(support, 'booking.special-aftersale', { ...p, requestId: 'late' }), /30天/);
});

test('K05 特批受理拒绝不存在支付、超退、重复支付与未结原争议', () => {
  const h = harness(); h.done(); h.advance(2881);
  const base = { id: h.b.id, reason: '电话原诉求', requestId: 'invalid' };
  for (const requests of [[], [{ paymentId: 'unknown', amountCents: 1 }], [{ paymentId: h.b.payment.id, amountCents: 29801 }], [{ paymentId: h.b.payment.id, amountCents: 1 }, { paymentId: h.b.payment.id, amountCents: 1 }]]) assert.throws(() => h.run(support, 'booking.special-aftersale', { ...base, requests }));
  assert.equal(h.b.refunds.length, 0);
  h.b.disputes.push({ id: 'OPEN-SERVICE', kind: 'service', status: 'open', reason: '原争议待核实' });
  assert.throws(() => h.run(support, 'booking.special-aftersale', { ...base, requests: [{ paymentId: h.b.payment.id, amountCents: 1 }] }), /未结.*争议/);
});

test('K05 新规则→原预约→分账原笔查询→完结→线下发放→特批退款→回退与提成差额', () => {
  const h = harness();
  h.run(finance, 'finance.rule-publish', { scope: 'global', groupBps: 1500, storeBps: 500, effectiveAt: h.s.now, version: 0, reason: '验收用输入，非正式值' });
  h.run(finance, 'tech-income.rule-publish', { storeId: 'xingfu', serviceId: 'all', rateBps: 4000, refundPolicy: 'proportional', rounding: 'floor', effectiveAt: h.s.now, version: 0, reason: '验收用输入' });
  h.done(); h.advance(2880);
  const command = (type, p = {}) => { const entry = h.s.serviceFinanceEntries[0]; h.run(finance, type, { id: entry.id, version: entry.version, outcome: 'success', ...p }); };
  command('finance.split-start', { outcome: 'processing' });
  const originalNo = h.s.serviceFinanceEntries[0].split.requestNo;
  assert.equal(techIncomeView(h.s, store).summary.payableCents, 0);
  assert.throws(() => command('finance.split-start'), /未知|查询/);
  command('finance.split-query'); assert.equal(h.s.serviceFinanceEntries[0].split.requestNo, originalNo);
  assert.equal(techIncomeView(h.s, store).summary.payableCents, 0);
  command('finance.finish-start');
  let income = h.s.techIncomeEntries[0]; assert.equal(income.payableCents, 11920);
  h.run(store, 'tech-income.payout', { techId: 'lin', month: income.month, lines: [{ entryId: income.id, version: income.version }], paidAt: h.s.now, proof: 'LOCAL-DEMO-TRANSFER-1', reason: '模拟线下实际发放记录' });
  const originalPayout = structuredClone(h.s.techIncomePayouts[0]); h.advance(1);
  h.run(support, 'booking.special-aftersale', { id: h.b.id, requests: [{ paymentId: h.b.payment.id, amountCents: 9800 }], reason: '核实原用户特批诉求' });
  const refundId = h.b.refunds.at(-1).id;
  h.run(support, 'booking.refund-review', { id: h.b.id, refundId, decision: 'approve', amountCents: 9800, reason: '同意原用户诉求' });
  h.run(finance, 'booking.refund-pay', { id: h.b.id, refundId, outcome: 'success' });
  assert.equal(h.b.payment.refundedCents, 9800);
  let view = serviceFinanceView(h.s, finance).entries[0];
  assert.equal(view.targetGroupCents, 3000); assert.equal(view.pendingReturnCents, 1470);
  assert.equal(h.s.techIncomeEntries[0].amountCents, 8000);
  assert.equal(h.s.techIncomeDifferences[0].remainingCents, 3920);
  command('finance.return-start', { outcome: 'processing' });
  const returnId = h.s.serviceFinanceEntries[0].returns[0].id;
  command('finance.return-query', { returnId });
  view = serviceFinanceView(h.s, finance).entries[0];
  assert.equal(view.returnedCents, 1470); assert.equal(view.storeCashCents, 17000); assert.equal(view.canPayTech, true);
  const diff = h.s.techIncomeDifferences[0];
  h.run(store, 'tech-income.difference-record', { id: diff.id, version: diff.version, kind: 'recover', amountCents: 3920, occurredAt: h.s.now, proof: 'LOCAL-DEMO-RECOVERY-1', reason: '已协商并在线下实际收回的演示记录' });
  assert.deepEqual(h.s.techIncomePayouts[0], originalPayout);
  assert.equal(h.s.techIncomeDifferences[0].remainingCents, 0);
  assert.equal(h.s.techIncomeEntries[0].netPaidCents, 8000);
  assert.equal(h.s.goods.length, 0); assert.equal(h.s.bills.length, 0); assert.equal(h.s.recoveries.length, 0);
});

test('K05 旧存档加载即可见缺依据账本，不改原预约/支付或伪造归属，重复加载稳定', () => {
  const h = harness(); h.done(); const old = structuredClone(h.s);
  for (const u of old.users) { delete u.serviceBinding; delete u.serviceBindingHistory; }
  const b = old.bookings[0]; delete b.serviceFinanceSnapshot; delete b.techIncomeSnapshot; delete b.techIncomeSnapshots;
  for (const k of Object.keys(old).filter(k => k.startsWith('serviceFinance') || k.startsWith('techIncome'))) delete old[k];
  const source = structuredClone(old.bookings), users = structuredClone(old.users);
  upgradeFinanceState(old);
  assert.equal(old.serviceFinanceEntries.length, 1); assert.equal(old.techIncomeEntries.length, 1);
  assert.equal(serviceFinanceView(old, finance).entries[0].targetGroupCents, null);
  assert.equal(techIncomeView(old, store).entries[0].status, 'pending');
  assert.deepEqual(old.bookings, source); assert.deepEqual(old.users, users);
  const once = structuredClone(old); upgradeFinanceState(old); assert.deepEqual(old, once);
});
