import test from 'node:test';
import assert from 'node:assert/strict';
import { seed, reduce, goodsSummary, upgradeGoods } from './engine.mjs';

const user = { role: 'user', userId: 'u1' };
const store = { role: 'store', storeId: 'xingfu' };
const finance = { role: 'group', job: 'finance' };
const warehouse = { role: 'group', job: 'warehouse' };
const support = { role: 'group', job: 'support' };
function fixture(initial = seed()) {
  let s = initial, n = 0;
  return {
    get s() { return s; },
    run(type, p = {}, actor = user) { s = reduce(s, actor, type, p); return s; },
    order(id) { return s.goods.find(o => o.id === id); },
    create() {
      this.run('promotion.enter', { storeId: 'xingfu' });
      this.run('cart.set', { skuId: 'oil', qty: 1 });
      this.run('goods.submit', { addressId: 'AD1', requestId: 'order-' + (++n) });
      const id = s.goods.at(-1).id;
      this.run('goods.pay', { id, outcome: 'success' });
      this.run('goods.ship', { id, carrier: '演示物流', tracking: 'OUT-' + id }, warehouse);
      this.run('goods.receive', { id });
      return id;
    },
    request(id, kind = 'refund', amountCents = 1000) {
      this.run('goods.case', { id, kind, skuId: 'oil', qty: 1, amountCents, reason: '复审回归申请', requestId: 'case-' + (++n) });
      return this.order(id).cases.at(-1).id;
    },
    approve(id, caseId) { this.run('goods.case-review', { id, caseId, decision: 'approve', reason: '客服受理' }, support); },
    refund(id, caseId) { this.run('goods.refund', { id, caseId, outcome: 'success' }, finance); },
    bill() {
      this.run('clock.advance', { minutes: 10080 });
      this.run('bill.create', { storeId: 'xingfu' }, finance);
      return s.bills.at(-1).id;
    },
    confirm(id) { this.run('bill.confirm', { id, version: s.bills.find(b => b.id === id).version }, store); },
    pay(id) { this.run('bill.pay', { id, outcome: 'processing' }, finance); this.run('bill.query', { id, outcome: 'success' }, finance); },
    disputedReturn() {
      const id = this.create(), caseId = this.request(id, 'return', 20000);
      this.approve(id, caseId);
      this.run('goods.return', { id, caseId, carrier: '演示物流', tracking: 'RETURN' });
      this.run('goods.inspect', { id, caseId, disposition: 'disputed', reason: '仓储初检发现外观不符' }, warehouse);
      this.run('goods.appeal', { id, caseId, reason: '提供寄出前照片，请客服核查' });
      return { id, caseId };
    },
    recovery() {
      const id = this.create(), billId = this.bill(); this.confirm(billId); this.pay(billId);
      const caseId = this.request(id, 'refund', 20000); this.approve(id, caseId); this.refund(id, caseId);
      return s.recoveries.at(-1).id;
    }
  };
}

test('R05 另一订单的售后申请及驳回不解除账单差异，核查后才可确认', () => {
  const f = fixture(), a = f.create(), b = f.create(), billId = f.bill();
  f.run('bill.dispute', { id: billId, version: 1, reason: `${a} 佣金比例有差异` }, store);
  const caseId = f.request(b);
  f.run('goods.case-review', { id: b, caseId, decision: 'reject', reason: '本次售后驳回' }, support);
  const bill = f.s.bills[0];
  assert.equal(bill.status, 'disputed'); assert.equal(bill.reason, `${a} 佣金比例有差异`);
  assert.equal(bill.dispute.status, 'open'); assert.equal(bill.version, 2);
  assert.match(bill.adjustmentReason, /售后变化/);
  assert.throws(() => f.confirm(billId), /差异尚未完成/);
  assert.throws(() => f.run('bill.pay', { id: billId, outcome: 'processing' }, finance), /差异尚未完成/);
  f.run('bill.resolve', { id: billId, reason: '核对原订单快照，比例及金额正确' }, finance);
  assert.equal(f.s.bills[0].dispute.reason, `${a} 佣金比例有差异`);
  assert.equal(f.s.bills[0].dispute.status, 'resolved');
  f.confirm(billId); f.pay(billId);
  assert.equal(f.s.bills[0].amountCents, 4000);
  assert.equal(f.order(a).commissionPaidCents + f.order(b).commissionPaidCents, 4000);
});

test('R05 未結差异期间退款重算金额与版本，原因保留且旧确认版本失效', () => {
  const f = fixture(), a = f.create(), b = f.create(), billId = f.bill();
  f.run('bill.dispute', { id: billId, version: 1, reason: `${a} 的独立差异` }, store);
  const caseId = f.request(b, 'refund', 10000); f.approve(b, caseId); f.refund(b, caseId);
  assert.equal(f.s.bills[0].amountCents, 3000); assert.equal(f.s.bills[0].version, 3);
  assert.equal(f.s.bills[0].status, 'disputed'); assert.equal(f.s.bills[0].reason, `${a} 的独立差异`);
  f.run('bill.resolve', { id: billId, reason: '核查原差异，另笔退款已重算' }, finance);
  assert.throws(() => f.run('bill.confirm', { id: billId, version: 3 }, store), /已更新/);
  f.confirm(billId); f.pay(billId);
  assert.equal(f.s.bills[0].amountCents, 3000);
});

test('R05 旧存档被覆盖的差异按事件恢复，已核查历史不会重新打开', () => {
  const f = fixture(), id = f.create(), billId = f.bill();
  f.run('bill.dispute', { id: billId, version: 1, reason: '历史未结差异' }, store);
  const legacy = structuredClone(f.s), b = legacy.bills[0];
  delete b.dispute; b.status = 'adjusted'; b.reason = '关联订单售后变化，请重新核对'; b.version++;
  b.events.push({ at: legacy.now, text: b.reason, actor: 'user' });
  const migrated = upgradeGoods(legacy);
  assert.equal(migrated.bills[0].status, 'disputed'); assert.equal(migrated.bills[0].reason, '历史未结差异');
  assert.equal(migrated.bills[0].dispute.recoveredFromLegacy, true);
  assert.equal(goodsSummary(migrated, migrated.goods.find(o => o.id === id)).commissionStatus, '账单有差异');
  const resumed = fixture(migrated);
  resumed.run('bill.resolve', { id: billId, reason: '本次已经核查完成' }, finance);
  const legacyResolved = structuredClone(resumed.s); delete legacyResolved.bills[0].dispute;
  upgradeGoods(legacyResolved);
  assert.equal(legacyResolved.bills[0].status, 'review'); assert.equal(legacyResolved.bills[0].dispute, undefined);
});

test('R05 旧存档的付款中差异恢复不丢付款事实，允许原笔查询但不得重付', () => {
  const f = fixture(); f.create(); const billId = f.bill();
  f.run('bill.dispute', { id: billId, version: 1, reason: '被旧逻辑覆盖后误付款' }, store);
  const legacy = structuredClone(f.s), b = legacy.bills[0];
  delete b.dispute; b.status = 'processing'; b.attempts = 1;
  b.events.push({ at: legacy.now, text: '关联订单售后变化，请重新核对', actor: 'user' });
  const resumed = fixture(upgradeGoods(legacy));
  assert.equal(resumed.s.bills[0].status, 'processing');
  assert.throws(() => resumed.run('bill.pay', { id: billId, outcome: 'processing' }, finance), /差异尚未完成/);
  resumed.run('bill.query', { id: billId, outcome: 'success' }, finance);
  assert.equal(resumed.s.bills[0].status, 'paid'); assert.equal(resumed.s.bills[0].dispute.status, 'open');
  assert.equal(resumed.s.goods[0].commissionPaidCents, 2000);
  resumed.run('bill.resolve', { id: billId, reason: '核查差异并记录资金已经支付' }, finance);
  assert.equal(resumed.s.bills[0].status, 'paid'); assert.equal(resumed.s.bills[0].dispute.status, 'resolved');
  resumed.run('bill.query', { id: billId, outcome: 'success' }, finance);
  assert.equal(resumed.s.goods[0].commissionPaidCents, 2000);
});

test('R06 相同说明的不同回款登记分别入账，相同请求重试不重复', () => {
  const f = fixture(), id = f.recovery();
  const first = { id, requestId: 'receive-1', amountCents: 400, proof: '银行转账' };
  const second = { id, requestId: 'receive-2', amountCents: 600, proof: '银行转账' };
  f.run('recovery.receive', first, finance); f.run('recovery.receive', first, finance);
  f.run('recovery.receive', second, finance); f.run('recovery.receive', second, finance);
  assert.equal(f.s.recoveries[0].recoveredCents, 1000); assert.equal(f.s.recoveries[0].records.length, 2);
  assert.equal(goodsSummary(f.s, f.s.goods[0]).debtCents, 1000);
  f.run('recovery.receive', { id, requestId: 'receive-3', amountCents: 1000, proof: '银行转账' }, finance);
  f.run('recovery.receive', first, finance);
  assert.equal(f.s.recoveries[0].status, 'closed'); assert.equal(f.s.recoveries[0].records.length, 3);
  assert.equal(goodsSummary(f.s, f.s.goods[0]).debtCents, 0);
});

test('R06 相同请求标识改金额或说明必须明确拒绝，缺标识也不入账', () => {
  const f = fixture(), id = f.recovery();
  f.run('recovery.receive', { id, requestId: 'receive-1', amountCents: 400, proof: '银行转账' }, finance);
  const before = structuredClone(f.s);
  assert.throws(() => f.run('recovery.receive', { id, requestId: 'receive-1', amountCents: 600, proof: '银行转账' }, finance), /已用于不同内容/);
  assert.throws(() => f.run('recovery.receive', { id, requestId: 'receive-1', amountCents: 400, proof: '新凭证' }, finance), /已用于不同内容/);
  assert.throws(() => f.run('recovery.receive', { id, amountCents: 400, proof: '银行转账' }, finance), /回款登记标识/);
  assert.deepEqual(f.s, before);
});

test('R06 新登记保留旧版无请求标识的回款历史及余额', () => {
  const f = fixture(), id = f.recovery();
  f.run('recovery.receive', { id, requestId: 'old-1', amountCents: 400, proof: '银行转账' }, finance);
  const legacy = structuredClone(f.s), receipt = legacy.recoveries[0].records[0];
  delete receipt.requestId; delete receipt.requestSignature;
  const oldReceipt = structuredClone(receipt), resumed = fixture(legacy);
  resumed.run('recovery.receive', { id, requestId: 'new-1', amountCents: 600, proof: '银行转账' }, finance);
  assert.deepEqual(resumed.s.recoveries[0].records[0], oldReceipt);
  assert.equal(resumed.s.recoveries[0].recoveredCents, 1000); assert.equal(resumed.s.recoveries[0].records.length, 2);
  assert.throws(() => resumed.run('recovery.receive', { id, requestId: 'new-2', amountCents: 1001, proof: '银行转账' }, finance), /超过/);
});

test('R07 验收申诉只由客服裁决，仓储不能自行终审，客服不能操作入库', () => {
  const f = fixture(), { id, caseId } = f.disputedReturn(), before = structuredClone(f.s);
  assert.throws(() => f.run('goods.inspection-resolve', { id, caseId, decision: 'approve', reason: '越权' }, warehouse), /岗位无权/);
  assert.throws(() => f.run('goods.inspect', { id, caseId, disposition: 'sellable' }, support), /岗位无权/);
  assert.throws(() => f.run('goods.inspect', { id, caseId, disposition: 'reject', reason: '仓储自行终审' }, warehouse), /等待客服裁决/);
  assert.throws(() => f.run('goods.inspection-resolve', { id, caseId, decision: 'approve', reason: '' }, support), /裁决说明/);
  assert.deepEqual(f.s, before);
});

for (const disposition of ['sellable', 'damaged']) test(`R07 客服同意申诉后仓储${disposition}处置一次，再由财务退款`, () => {
  const f = fixture(), { id, caseId } = f.disputedReturn(), initialLedgerLength = f.s.inventoryLedger.length;
  f.run('goods.inspection-resolve', { id, caseId, decision: 'approve', reason: '核实运输证据，同意退货' }, support);
  const c = f.order(id).cases[0];
  assert.equal(c.status, 'awaiting_return_disposition'); assert.equal(c.inspectionDecision.job, 'support');
  assert.equal(c.reviewReason, '仓储初检发现外观不符'); assert.equal(c.inspectedAt, undefined);
  assert.equal(f.order(id).lines[0].returnedQty, 0); assert.equal(f.s.inventoryLedger.length, initialLedgerLength);
  assert.equal(f.s.skus[0].stock, 11);
  assert.throws(() => f.refund(id, caseId), /尚不能退款/);
  assert.throws(() => f.run('goods.inspect', { id, caseId, disposition: 'disputed', reason: '再次争议' }, warehouse), /客服已裁决/);
  assert.throws(() => f.run('goods.inspection-resolve', { id, caseId, decision: 'reject', reason: '重复裁决' }, support), /当前没有/);
  f.run('goods.inspect', { id, caseId, disposition, reason: '按客服裁决完成实物处置' }, warehouse);
  assert.equal(f.order(id).cases[0].status, 'refund_ready'); assert.equal(f.order(id).lines[0].returnedQty, 1);
  assert.equal(f.order(id).cases[0].dispositionReason, '按客服裁决完成实物处置');
  assert.match(f.order(id).events.at(-1).text, /按客服裁决完成实物处置/);
  assert.equal(f.s.skus[0].stock, disposition === 'sellable' ? 12 : 11);
  assert.equal(f.s.inventoryLedger.length, initialLedgerLength + 1);
  assert.throws(() => f.run('goods.inspect', { id, caseId, disposition }, warehouse), /已经验收/);
  f.refund(id, caseId); f.refund(id, caseId);
  assert.equal(f.order(id).refunds.length, 1); assert.equal(f.order(id).cases[0].status, 'done');
  assert.equal(goodsSummary(f.s, f.order(id)).netCents, 1000);
  assert.equal(f.s.inventoryLedger.length, initialLedgerLength + 1);
});

test('R07 客服维持拒退，仓储寄回、用户收货关闭，库存与退款均不增加', () => {
  const f = fixture(), { id, caseId } = f.disputedReturn(), ledgerLength = f.s.inventoryLedger.length;
  f.run('goods.inspection-resolve', { id, caseId, decision: 'reject', reason: '客服核对证据后维持拒退' }, support);
  assert.equal(f.order(id).cases[0].status, 'awaiting_return_to_customer');
  assert.throws(() => f.run('goods.inspect', { id, caseId, disposition: 'sellable' }, warehouse), /已经验收/);
  assert.throws(() => f.refund(id, caseId), /尚不能退款/);
  f.run('goods.return-back', { id, caseId, carrier: '演示物流', tracking: 'BACK', feePayer: 'group', reason: '集团承担返还运费' }, warehouse);
  f.run('goods.return-back-receive', { id, caseId });
  assert.equal(f.order(id).cases[0].status, 'closed'); assert.equal(f.order(id).cases[0].custody, '用户');
  assert.equal(f.order(id).lines[0].returnedQty, 0); assert.equal(f.order(id).refunds.length, 0);
  assert.equal(f.s.skus[0].stock, 11); assert.equal(f.s.inventoryLedger.length, ledgerLength);
  assert.equal(goodsSummary(f.s, f.order(id)).netCents, 21000);
});
