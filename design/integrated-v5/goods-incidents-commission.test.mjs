import test from 'node:test';
import assert from 'node:assert/strict';
import { seed, reduce, goodsSummary } from './engine.mjs';

const user = { role: 'user', userId: 'u1' }, finance = { role: 'group', job: 'finance' }, support = { role: 'group', job: 'support' }, warehouse = { role: 'group', job: 'warehouse' }, store = { role: 'store', job: 'store-finance', storeId: 'xingfu' };
function fixture() {
  let s = seed(), seq = 0;
  const f = {
    get s() { return s; }, get bill() { return s.bills.at(-1); }, get plan() { return s.goodsOffsetPlans.at(-1); },
    order(id) { return s.goods.find(o => o.id === id); },
    incident(id) { return f.order(id).incidents.at(-1); },
    run(type, payload = {}, actor = user) { let result; s = reduce(s, actor, type, { requestId: `incidents-commission-${++seq}`, ...payload }, x => result = x); return result; },
    create() {
      f.run('promotion.enter', { storeId: 'xingfu' }); f.run('cart.set', { skuId: 'oil', qty: 1 }); f.run('goods.submit', { addressId: 'AD1' });
      const id = s.goods.at(-1).id;
      f.run('goods.pay', { id, outcome: 'success' }); f.run('goods.ship', { id, carrier: '隔离回归物流', tracking: `LOCAL-${seq}` }, warehouse); f.run('goods.receive', { id });
      f.run('clock.advance', { minutes: f.order(id).waitDays * 1440 + 1 }, finance); return id;
    },
    open(id) { return f.run('goods.incident-open', { id, version: f.order(id).version, stage: 'delivery', kind: 'damaged', reason: '运输破损待核查' }, support); },
    propose(id, incidentId = f.incident(id).id, resolution = 'continue', caseId) { const i = f.order(id).incidents.find(x => x.id === incidentId); return f.run('goods.incident-propose', { id, incidentId, version: i.version, resolution, caseId, reason: '双方核对原商品处理方案' }, support); },
    confirm(id, incidentId = f.incident(id).id, decision = 'accept') { const i = f.order(id).incidents.find(x => x.id === incidentId); return f.run('goods.incident-confirm', { id, incidentId, version: i.version, decision, reason: decision === 'accept' ? '核对原货和处理方案后同意' : '方案尚未解决，请继续核实' }); },
    resolve(id, incidentId = f.incident(id).id) { f.propose(id, incidentId); f.confirm(id, incidentId); },
    createBill() { f.run('bill.create', { storeId: 'xingfu' }, finance); return f.bill.id; },
    confirmBill(id = f.bill.id) { f.run('bill.confirm', { id, version: s.bills.find(b => b.id === id).version }, store); },
    submitPay(id = f.bill.id) { f.run('bill.pay', { id, outcome: 'processing' }, finance); },
    pay(id = f.bill.id) { f.confirmBill(id); f.submitPay(id); f.run('bill.query', { id, outcome: 'success' }, finance); },
    refund(id) {
      f.run('goods.case', { id, kind: 'refund', skuId: 'oil', qty: 1, amountCents: 10000, reason: '核实原部分退款' }); const caseId = f.order(id).cases.at(-1).id;
      f.run('goods.case-review', { id, caseId, decision: 'approve', reason: '核实通过' }, support); f.run('goods.refund', { id, caseId, outcome: 'success' }, finance);
    },
    debt() { const old = f.create(); f.createBill(); f.pay(); f.refund(old); const next = f.create(); f.createBill(); return next; },
    offset() { return f.run('bill.offset-propose', { id: f.bill.id, version: f.bill.version, recoveryId: s.recoveries[0].id, amountCents: 1000, reason: '同店后续商品佣金偿还原债' }, finance); }
  };
  return f;
}
function moneyFacts(f, id) {
  const o = f.order(id), v = goodsSummary(f.s, o);
  return structuredClone({ paidCents: o.paidCents, payment: o.payment, lines: o.lines, refunds: o.refunds, commissionPaidCents: o.commissionPaidCents, netCents: v.netCents, commissionCents: v.commissionCents, stocks: f.s.skus.map(k => [k.id, k.stock]), moves: f.s.stockMoves });
}

test('C06 实际收货及等待期已满，未结物流异常仍阻止结佣，不改变原资金库存', () => {
  const f = fixture(), id = f.create(), before = moneyFacts(f, id); f.open(id);
  assert.equal(f.order(id).status, 'received'); assert.equal(f.incident(id).status, 'open');
  assert.equal(goodsSummary(f.s, f.order(id)).commissionReason, '物流或退货异常待处理'); assert.equal(goodsSummary(f.s, f.order(id)).commissionStatus, '阻断中');
  assert.throws(() => f.createBill(), /没有满足/); assert.deepEqual(moneyFacts(f, id), before);
});

test('C06 待用户确认与继续核查均阻断，即使关联退款案被驳回也不放行', () => {
  const f = fixture(), id = f.create(); f.open(id); f.propose(id);
  assert.equal(f.incident(id).status, 'awaiting_user'); assert.throws(() => f.createBill(), /没有满足/); f.confirm(id, undefined, 'reject');
  f.run('goods.case', { id, kind: 'refund', skuId: 'oil', qty: 1, amountCents: 1000, reason: '破损退款待核对' }); const caseId = f.order(id).cases.at(-1).id;
  f.propose(id, undefined, 'refund', caseId); f.confirm(id);
  f.run('goods.case-review', { id, caseId, decision: 'reject', reason: '原金额未核准，异常继续核查' }, support);
  assert.equal(f.order(id).cases.at(-1).status, 'rejected'); assert.equal(f.incident(id).status, 'waiting');
  assert.equal(goodsSummary(f.s, f.order(id)).commissionReason, '物流或退货异常待处理'); assert.throws(() => f.createBill(), /没有满足/);
});

test('C06 多个异常必须全部按原事实办结，再恢复结佣', () => {
  const f = fixture(), id = f.create(); const first = f.open(id).id, second = f.open(id).id;
  f.resolve(id, first); assert.equal(f.order(id).incidents[0].status, 'done'); assert.throws(() => f.createBill(), /没有满足/);
  f.resolve(id, second); assert.ok(f.order(id).incidents.every(i => i.status === 'done')); assert.equal(goodsSummary(f.s, f.order(id)).commissionReason, '');
  f.createBill(); assert.equal(f.bill.amountCents, 2000);
});

test('C06 异常已办结不覆盖仍未结的原售后阻断', () => {
  const f = fixture(), id = f.create(); f.open(id);
  f.run('goods.case', { id, kind: 'refund', skuId: 'oil', qty: 1, amountCents: 1000, reason: '另有原售后待审' }); f.resolve(id);
  assert.equal(f.incident(id).status, 'done'); assert.equal(goodsSummary(f.s, f.order(id)).commissionReason, '售后或退款处理中'); assert.throws(() => f.createBill(), /没有满足/);
});

test('C06 已生成账单后新增异常，原核对和未执行现金付款也拒绝', () => {
  const f = fixture(), id = f.create(); f.createBill(); const original = structuredClone(f.bill); f.open(id);
  assert.throws(() => f.confirmBill(), /阻断/); assert.equal(f.bill.amountCents, original.amountCents); f.resolve(id); f.confirmBill(); f.open(id);
  assert.throws(() => f.submitPay(), /售后|不可结算/); assert.equal(f.bill.attempts, 0); assert.equal(f.bill.paymentId, original.paymentId);
});

test('C06 账单拆分仅放行无异常明细，未结异常明细留在原账', () => {
  const f = fixture(), blocked = f.create(), clear = f.create(); f.createBill(); const parent = f.bill.id; f.open(blocked);
  assert.throws(() => f.run('bill.split', { id: parent, version: f.bill.version, orderIds: [blocked], reason: '异常不能拆成无争议款' }, finance), /售后|变化/);
  f.run('bill.split', { id: parent, version: f.bill.version, orderIds: [clear], reason: '只拆无异常明细' }, finance);
  assert.deepEqual(f.bill.items.map(x => x.orderId), [clear]); assert.deepEqual(f.s.bills.find(b => b.id === parent).items.map(x => x.orderId), [blocked]);
});

test('C06 现金付款未知时新增异常仍能查询原笔成功，不重复入账', () => {
  const f = fixture(), id = f.create(); f.createBill(); f.confirmBill(); f.submitPay(); const original = { id: f.bill.id, paymentId: f.bill.paymentId, amountCents: f.bill.amountCents }; f.open(id);
  f.run('bill.query', { id: original.id, outcome: 'success' }, finance); f.run('bill.query', { id: original.id, outcome: 'success' }, finance);
  assert.equal(f.bill.status, 'paid'); assert.equal(f.bill.paymentId, original.paymentId); assert.equal(f.bill.amountCents, original.amountCents); assert.equal(f.order(id).commissionPaidCents, 2000); assert.equal(f.s.recoveries.length, 0);
});

test('C06 未知现金付款失败后异常阻止重试，办结后复用原笔', () => {
  const f = fixture(), id = f.create(); f.createBill(); f.confirmBill(); f.submitPay(); const original = f.bill.paymentId; f.open(id);
  f.run('bill.query', { id: f.bill.id, outcome: 'failed' }, finance); assert.equal(f.order(id).commissionPaidCents, 0); assert.equal(f.bill.status, 'failed');
  assert.throws(() => f.submitPay(), /售后|不可结算/); f.resolve(id); f.submitPay(); f.run('bill.query', { id: f.bill.id, outcome: 'success' }, finance);
  assert.equal(f.bill.paymentId, original); assert.equal(f.bill.attempts, 2); assert.equal(f.order(id).commissionPaidCents, 2000);
});

test('C06 已成功付佣的原款不因异常被清零、重付或补造追偿', () => {
  const f = fixture(), id = f.create(); f.createBill(); f.pay(); const before = moneyFacts(f, id), bill = structuredClone(f.bill); f.open(id);
  assert.deepEqual(moneyFacts(f, id), before); assert.equal(f.bill.status, 'paid'); assert.equal(f.bill.amountCents, bill.amountCents); assert.equal(f.bill.paymentId, bill.paymentId); assert.equal(f.s.recoveries.length, 0);
  assert.throws(() => f.createBill(), /没有满足/); f.resolve(id); assert.throws(() => f.createBill(), /没有满足/); assert.equal(f.order(id).commissionPaidCents, 2000);
});

test('C06 旧单没有异常容器时沿用原可结算判定，纯汇总不写数据', () => {
  const f = fixture(), id = f.create(); delete f.order(id).incidents; const before = structuredClone(f.s);
  assert.equal(goodsSummary(f.s, f.order(id)).commissionReason, ''); assert.deepEqual(f.s, before);
});

test('C06 未执行抵扣方案随异常失效，原债务和账单金额保留', () => {
  const f = fixture(), id = f.debt(); f.offset(); const original = { debt: f.s.recoveries[0].amountCents, gross: f.bill.amountCents, cash: f.plan.cashCents }; f.open(id);
  assert.equal(f.plan.status, 'invalidated'); assert.equal(f.bill.amountCents, original.gross); assert.equal(f.s.recoveries[0].amountCents, original.debt); assert.equal(f.s.recoveries[0].recoveredCents, 0); assert.equal(f.order(id).commissionPaidCents, 0);
});

test('C06 抵扣现金执行中异常不撤销未知原笔，成功后只记录真实现金和抵扣', () => {
  const f = fixture(), id = f.debt(); f.offset(); f.run('bill.offset-confirm', { id: f.bill.id, planId: f.plan.id, version: f.plan.version, decision: 'accept', reason: '核对原债与本账' }, store);
  f.run('bill.offset-pay', { id: f.bill.id, planId: f.plan.id, version: f.plan.version, outcome: 'processing' }, finance); const paymentId = f.plan.paymentId; f.open(id);
  assert.equal(f.plan.status, 'processing'); assert.equal(f.s.recoveries[0].recoveredCents, 0);
  f.run('bill.offset-query', { id: f.bill.id, planId: f.plan.id, version: f.plan.version, outcome: 'success' }, finance);
  assert.equal(f.plan.status, 'succeeded'); assert.equal(f.plan.paymentId, paymentId); assert.equal(f.bill.cashPaidCents, 1000); assert.equal(f.bill.offsetSettledCents, 1000); assert.equal(f.order(id).commissionPaidCents, 2000); assert.equal(f.s.recoveries[0].recoveredCents, 1000);
});
