import test from 'node:test';
import assert from 'node:assert/strict';
import { seed, reduce, availableStock, goodsSummary, visible } from './engine.mjs';
const u = { role: 'user', userId: 'u1' }, other = { role: 'user', userId: 'u2' }, g = { role: 'group' }, store = { role: 'store', storeId: 'xingfu' };
function fixture() { let s = seed(); return { get s() { return s; }, run(type, p = {}, actor = u) { s = reduce(s, actor, type, p); return s; }, create(source = true, qty = 1) { if (source) this.run('promotion.enter', { storeId: 'xingfu' }); this.run('cart.set', { skuId: 'oil', qty }); this.run('cart.set', { skuId: 'care', qty: 1 }); this.run('goods.submit', { addressId: 'AD1', requestId: 'r' + s.seq }); return s.goods.at(-1).id; }, pay(id) { this.run('goods.pay', { id, outcome: 'success' }); }, ship(id) { this.run('goods.ship', { id, carrier: '演示物流', tracking: 'DEMO001' }, g); }, receive(id) { this.run('goods.receive', { id }); }, settle(id) { this.run('clock.advance', { minutes: 10080 }); this.run('bill.create', { storeId: 'xingfu' }, g); const bill = s.bills.at(-1).id; this.run('bill.confirm', { id: bill, version: s.bills.find(b => b.id === bill).version }, store); this.run('bill.pay', { id: bill, outcome: 'processing' }, g); this.run('bill.query', { id: bill, outcome: 'success' }, g); return bill; }, refund(id, amountCents = 10000, kind = 'return', disposition = 'sellable') { this.run('goods.case', { id, kind, skuId: 'oil', qty: 1, amountCents, reason: '测试售后' }); const caseId = s.goods.find(o => o.id === id).cases.at(-1).id; this.run('goods.case-review', { id, caseId, decision: 'approve', reason: '同意' }, g); if (kind === 'return') { this.run('goods.return', { id, caseId, carrier: '演示物流', tracking: 'RETURN001' }); this.run('goods.inspect', { id, caseId, disposition }, g); } return caseId; } }; }
function order(f, id) { return f.s.goods.find(o => o.id === id); }
test('310元完整交易、40元佣金、身份切换不改锁定来源', () => {
  const f = fixture(), id = f.create(); assert.equal(order(f, id).paidCents, 31000); assert.equal(availableStock(f.s, 'oil'), 11);
  f.run('promotion.enter', { storeId: 'silver' }); assert.equal(order(f, id).source.storeId, 'xingfu');
  f.pay(id); f.ship(id); f.receive(id); assert.equal(goodsSummary(f.s, order(f, id)).commissionCents, 4000);
  assert.throws(() => f.run('bill.create', { storeId: 'xingfu' }, g), /没有/);
  const bill = f.settle(id); assert.equal(order(f, id).commissionPaidCents, 4000); assert.equal(f.s.bills[0].status, 'paid');
  f.run('bill.query', { id: bill, outcome: 'success' }, g); assert.equal(order(f, id).commissionPaidCents, 4000);
});
test('用户隔离覆盖购物车、地址、订单读写、后台发货权限', () => {
  const f = fixture(), id = f.create(); assert.deepEqual(visible(f.s, other).goods, []);
  assert.throws(() => f.run('goods.pay', { id, outcome: 'success' }, other), /无权/);
  assert.throws(() => f.run('address.save', { id: 'AD1' }, other), /不属于/);
  assert.throws(() => f.run('goods.ship', { id }, store), /无权/);
  f.run('cart.set', { skuId: 'care', qty: 2 }, other); assert.equal(f.s.carts.u2[0].qty, 2); assert.deepEqual(f.s.carts.u1, []);
});
test('库存竞争、超量和重复提交不重复占用；取消只释放一次', () => {
  const f = fixture(); assert.throws(() => f.run('cart.set', { skuId: 'oil', qty: 13 }), /库存/);
  const id = f.create(true, 12), o = order(f, id); assert.equal(availableStock(f.s, 'oil'), 0);
  assert.throws(() => f.run('cart.set', { skuId: 'oil', qty: 1 }, other), /库存/);
  f.run('goods.submit', { addressId: 'AD1', requestId: o.requestId }); assert.equal(f.s.goods.length, 1);
  f.run('goods.close', { id }); f.run('goods.close', { id }); assert.equal(availableStock(f.s, 'oil'), 12);
});
test('地址快照独立；不配送、非本人地址不能下单', () => {
  const f = fixture(), id = f.create(); const original = order(f, id).address.detail;
  f.run('address.save', { id: 'AD1', name: '王女士', phone: '13800008000', province: '浙江省', city: '杭州', detail: '新地址' });
  assert.equal(order(f, id).address.detail, original); f.run('cart.set', { skuId: 'oil', qty: 1 });
  assert.throws(() => f.run('goods.submit', { requestId: 'bad', addressId: 'AD1' }), /配送/);
  assert.throws(() => f.run('goods.submit', { requestId: 'bad', addressId: 'AD2' }), /本人/);
});
test('自然与过期来源均为零佣金，确认后来源改变会提示', () => {
  const f = fixture(), id = f.create(false); f.pay(id); assert.equal(goodsSummary(f.s, order(f, id)).commissionCents, 0);
  f.run('promotion.enter', { storeId: 'xingfu' }); f.run('clock.advance', { minutes: 1441 }); f.run('cart.set', { skuId: 'oil', qty: 1 });
  assert.throws(() => f.run('goods.submit', { addressId: 'AD1', requestId: 'exp', expectedSourceId: 'STORE-xingfu' }), /过期/);
  f.run('goods.submit', { addressId: 'AD1', requestId: 'exp', expectedSourceId: '' }); assert.equal(f.s.goods.at(-1).source, null);
});
test('支付失败可重试；处理中不能重付或释放；晚到成功须退款', () => {
  const f = fixture(), id = f.create(); f.run('goods.pay', { id, outcome: 'failed' }); f.run('goods.pay', { id, outcome: 'processing' });
  assert.throws(() => f.run('goods.pay', { id, outcome: 'success' }), /未知/); assert.throws(() => f.run('goods.close', { id }), /未知/);
  f.run('clock.advance', { minutes: 20 }); assert.equal(availableStock(f.s, 'oil'), 11);
  f.run('goods.payment-query', { id, outcome: 'success' }); assert.equal(order(f, id).status, 'cancelled'); assert.equal(availableStock(f.s, 'oil'), 12);
  const c = order(f, id).cases[0]; f.run('goods.refund', { id, caseId: c.id, outcome: 'success' }, g); assert.equal(goodsSummary(f.s, order(f, id)).netCents, 0);
});
test('未付超时关闭，无法对已关闭订单重新付款', () => {
  const f = fixture(), id = f.create(); f.run('clock.advance', { minutes: 15 }); assert.equal(order(f, id).status, 'closed'); assert.equal(availableStock(f.s, 'oil'), 12);
  assert.throws(() => f.pay(id), /关闭/);
});
test('未发货全取消：阻断仓储、释放库存，资金结果独立', () => {
  const f = fixture(), id = f.create(); f.pay(id); const c = f.refund(id, 0, 'cancel');
  assert.throws(() => f.ship(id), /不能发货/); assert.equal(availableStock(f.s, 'oil'), 12); assert.equal(goodsSummary(f.s, order(f, id)).refundedCents, 0);
  f.run('goods.refund', { id, caseId: c, outcome: 'failed' }, g); const tx = order(f, id).refunds[0].id;
  f.run('goods.refund', { id, caseId: c, outcome: 'processing' }, g); assert.equal(order(f, id).refunds[0].id, tx);
  assert.throws(() => f.run('goods.refund', { id, caseId: c, outcome: 'success' }, g), /查询/);
  f.run('goods.refund-query', { id, caseId: c, outcome: 'success' }, g); f.run('goods.refund-query', { id, caseId: c, outcome: 'success' }, g);
  assert.equal(goodsSummary(f.s, order(f, id)).netCents, 0); assert.equal(order(f, id).refunds.length, 1);
});
test('商品退款未发起不能提前查询；拒绝后状态不变，原笔发起与查询正常', () => {
  const f = fixture(), id = f.create(); f.pay(id); f.ship(id);
  const caseId = f.refund(id, 10000, 'refund'), before = structuredClone(f.s);
  for (const outcome of ['success', 'failed', 'processing']) {
    assert.throws(() => f.run('goods.refund-query', { id, caseId, outcome }, g), /没有等待查询/);
    assert.deepEqual(f.s, before);
  }
  assert.equal(order(f, id).refunds.length, 0);
  assert.equal(order(f, id).cases[0].status, 'refund_ready');
  f.run('goods.refund', { id, caseId, outcome: 'processing' }, g);
  const refundId = order(f, id).refunds[0].id;
  f.run('goods.refund-query', { id, caseId, outcome: 'success' }, g);
  assert.equal(order(f, id).refunds[0].id, refundId);
  assert.equal(order(f, id).refunds[0].attempts, 1);
  assert.equal(order(f, id).cases[0].status, 'done');
  assert.equal(goodsSummary(f.s, order(f, id)).refundedCents, 10000);
  f.run('goods.refund-query', { id, caseId, outcome: 'success' }, g);
  assert.equal(order(f, id).refunds.length, 1);
  assert.equal(goodsSummary(f.s, order(f, id)).refundedCents, 10000);
});

test('部分退货后净实付210、佣金30；库存仅可售验收入库', () => {
  const f = fixture(), id = f.create(); f.pay(id); f.ship(id); f.receive(id); const c = f.refund(id);
  assert.equal(f.s.skus.find(k => k.id === 'oil').stock, 12);
  f.run('goods.refund', { id, caseId: c, outcome: 'success' }, g); assert.equal(order(f, id).status, 'received');
  const summary = goodsSummary(f.s, order(f, id)); assert.equal(summary.netCents, 21000); assert.equal(summary.commissionCents, 3000);
  assert.throws(() => f.run('goods.inspect', { id, caseId: c, disposition: 'sellable' }, g), /已经验收/);
  assert.throws(() => f.run('goods.case', { id, kind: 'return', skuId: 'oil', qty: 1, amountCents: 100, reason: '再退' }), /件数/);
});
test('不可售退货与仅退款不增加可售库存', () => {
  for (const kind of ['return', 'refund']) { const f = fixture(), id = f.create(); f.pay(id); f.ship(id); const c = f.refund(id, 10000, kind, 'damaged'); f.run('goods.refund', { id, caseId: c, outcome: 'success' }, g); assert.equal(f.s.skus.find(k => k.id === 'oil').stock, 11); }
});
test('并行退款占额防超退；驳回释放，可补充申诉', () => {
  const f = fixture(), id = f.create(); f.pay(id); f.ship(id);
  f.run('goods.case', { id, kind: 'refund', skuId: 'oil', qty: 1, amountCents: 15000, reason: '申请' }); const c = order(f, id).cases[0].id;
  assert.throws(() => f.run('goods.case', { id, kind: 'refund', skuId: 'oil', qty: 1, amountCents: 10000, reason: '重复' }), /尚可退/);
  f.run('goods.case-review', { id, caseId: c, decision: 'reject', reason: '需要补充' }, g); f.run('goods.appeal', { id, caseId: c, reason: '补充证据' }); assert.equal(order(f, id).cases[0].status, 'requested');
});
test('账单已核对但未付款遇退款：冻结、调30元、门店重核', () => {
  const f = fixture(), id = f.create(); f.pay(id); f.ship(id); f.receive(id); f.run('clock.advance', { minutes: 10080 }); f.run('bill.create', { storeId: 'xingfu' }, g); const bill = f.s.bills[0].id; f.run('bill.confirm', { id: bill, version: f.s.bills.find(b => b.id === bill).version }, store);
  const c = f.refund(id); assert.equal(f.s.bills[0].status, 'adjusted'); assert.throws(() => f.run('bill.pay', { id: bill, outcome: 'processing' }, g), /核对/);
  f.run('goods.refund', { id, caseId: c, outcome: 'success' }, g); assert.equal(f.s.bills[0].amountCents, 3000);
  f.run('bill.confirm', { id: bill, version: f.s.bills.find(b => b.id === bill).version }, store); f.run('bill.pay', { id: bill, outcome: 'processing' }, g); f.run('bill.query', { id: bill, outcome: 'success' }, g); assert.equal(order(f, id).commissionPaidCents, 3000);
});
test('已付40佣金退100商品→追回10，分次回款守恒且不重复', () => {
  const f = fixture(), id = f.create(); f.pay(id); f.ship(id); f.receive(id); f.settle(id);
  const c = f.refund(id); f.run('goods.refund', { id, caseId: c, outcome: 'success' }, g); const recovery = f.s.recoveries[0].id; assert.equal(f.s.recoveries[0].amountCents, 1000);
  f.run('recovery.receive', { id: recovery, requestId: 'receipt-1', amountCents: 400, proof: 'R1' }, g); f.run('recovery.receive', { id: recovery, requestId: 'receipt-1', amountCents: 400, proof: 'R1' }, g); assert.equal(f.s.recoveries[0].recoveredCents, 400);
  f.run('recovery.receive', { id: recovery, requestId: 'receipt-2', amountCents: 600, proof: 'R2' }, g); assert.equal(f.s.recoveries[0].status, 'closed'); assert.equal(goodsSummary(f.s, order(f, id)).debtCents, 0);
});
test('付款结果未知期间退款：先核实付款，再记真实债务', () => {
  const f = fixture(), id = f.create(); f.pay(id); f.ship(id); f.receive(id); f.run('clock.advance', { minutes: 10080 }); f.run('bill.create', { storeId: 'xingfu' }, g); const bill = f.s.bills[0].id; f.run('bill.confirm', { id: bill, version: f.s.bills.find(b => b.id === bill).version }, store); f.run('bill.pay', { id: bill, outcome: 'processing' }, g);
  const c = f.refund(id); f.run('goods.refund', { id, caseId: c, outcome: 'success' }, g); assert.equal(f.s.recoveries.length, 0);
  f.run('bill.query', { id: bill, outcome: 'success' }, g); assert.equal(f.s.recoveries[0].amountCents, 1000);
});
test('付款失败使用原交易；错误门店不能确认账单', () => {
  const f = fixture(), id = f.create(); f.pay(id); f.ship(id); f.receive(id); f.run('clock.advance', { minutes: 10080 }); f.run('bill.create', { storeId: 'xingfu' }, g); const bill = f.s.bills[0];
  assert.throws(() => f.run('bill.confirm', { id: bill.id }, { role: 'store', storeId: 'silver' }), /无权/);
  f.run('bill.confirm', { id: bill.id, version: bill.version }, store); f.run('bill.pay', { id: bill.id, outcome: 'processing' }, g); f.run('bill.query', { id: bill.id, outcome: 'failed' }, g); f.run('bill.pay', { id: bill.id, outcome: 'processing' }, g); f.run('bill.query', { id: bill.id, outcome: 'success' }, g);
  assert.equal(f.s.bills[0].paymentId, bill.paymentId); assert.equal(f.s.bills[0].attempts, 2); assert.equal(order(f, id).commissionPaidCents, 4000);
});
test('事务失败不修改输入状态；内部维护命令不能外部执行', () => {
  const s = seed(), before = structuredClone(s); assert.throws(() => reduce(s, u, 'goods.submit', { requestId: 'xx' })); assert.deepEqual(s, before); assert.throws(() => reduce(s, u, 'booking.tick'), /只能/);
});
test('已驳回退货申诉须重验件数，不能一件商品入库两次', () => {
  const f = fixture(), id = f.create(); f.pay(id); f.ship(id);
  f.run('goods.case', { id, kind: 'return', skuId: 'oil', qty: 1, amountCents: 10000, reason: '首次' }); const first = order(f, id).cases[0].id;
  f.run('goods.case-review', { id, caseId: first, decision: 'reject', reason: '补件' }, g);
  const second = f.refund(id, 10000); f.run('goods.refund', { id, caseId: second, outcome: 'success' }, g);
  assert.throws(() => f.run('goods.appeal', { id, caseId: first, reason: '恢复' }), /件数/);
  assert.equal(order(f, id).lines[0].returnedQty, 1); assert.equal(f.s.skus[0].stock, 12);
});
test('申诉恢复前重新校验运费占额，不能跨商品退两次运费', () => {
  const f = fixture(), id = f.create(); f.pay(id); f.ship(id);
  f.run('goods.case', { id, kind: 'refund', skuId: 'oil', qty: 1, amountCents: 100, shippingCents: 1000, reason: '首次' }); const first = order(f, id).cases[0].id;
  f.run('goods.case-review', { id, caseId: first, decision: 'reject', reason: '补件' }, g);
  f.run('goods.case', { id, kind: 'refund', skuId: 'care', qty: 1, amountCents: 100, shippingCents: 1000, reason: '另一个商品' }); const second = order(f, id).cases[1].id;
  f.run('goods.case-review', { id, caseId: second, decision: 'approve', reason: '同意' }, g); f.run('goods.refund', { id, caseId: second, outcome: 'success' }, g);
  assert.throws(() => f.run('goods.appeal', { id, caseId: first, reason: '恢复' }), /运费/);
});
test('全退已付佣金回款后显示已追回结清', () => {
  const f = fixture(), id = f.create(); f.pay(id); f.ship(id); f.receive(id); f.settle(id);
  const c = f.refund(id, 20000, 'refund'); f.run('goods.refund', { id, caseId: c, outcome: 'success' }, g);
  f.run('goods.case', { id, kind: 'refund', skuId: 'care', qty: 1, amountCents: 10000, reason: '全退' }); const second = order(f, id).cases.at(-1).id;
  f.run('goods.case-review', { id, caseId: second, decision: 'approve', reason: '同意' }, g); f.run('goods.refund', { id, caseId: second, outcome: 'success' }, g);
  assert.equal(goodsSummary(f.s, order(f, id)).commissionStatus, '已付待追回');
  f.run('recovery.receive', { id: f.s.recoveries[0].id, requestId: 'receipt-all', amountCents: 4000, proof: 'ALL' }, g); assert.equal(goodsSummary(f.s, order(f, id)).commissionStatus, '已追回结清');
});
test('验收驳回→申诉复核→原货返还→本人收到，无凭空入库或退款', () => {
  const f = fixture(), id = f.create(); f.pay(id); f.ship(id); f.receive(id);
  f.run('goods.case', { id, kind: 'return', skuId: 'oil', qty: 1, amountCents: 20000, reason: '退货' }); const c = order(f, id).cases.at(-1).id;
  f.run('goods.case-review', { id, caseId: c, decision: 'approve', reason: '待检' }, g); f.run('goods.return', { id, caseId: c, carrier: 'DEMO', tracking: 'RET' });
  f.run('goods.inspect', { id, caseId: c, disposition: 'disputed', reason: '件物与申请不符，待复核' }, g); assert.equal(order(f, id).cases[0].custody, '集团仓储');
  f.run('goods.appeal', { id, caseId: c, reason: '申请复核' }); f.run('goods.inspection-resolve', { id, caseId: c, decision: 'reject', reason: '复核维持拒退，原货返还' }, g);
  f.run('goods.return-back', { id, caseId: c, carrier: 'DEMO', tracking: 'BACK', feePayer: 'group', reason: '协商集团承担返还运费' }, g);
  assert.equal(goodsSummary(f.s, order(f, id)).commissionStatus, '阻断中');
  assert.throws(() => f.run('goods.return-back-receive', { id, caseId: c }, other), /无权/);
  f.run('goods.return-back-receive', { id, caseId: c }); assert.equal(order(f, id).cases[0].status, 'closed'); assert.equal(order(f, id).refunds.length, 0); assert.equal(f.s.skus[0].stock, 11);
});
test('部分商品退100再单独退10元运费，净收200且佣金仍30', () => {
  const f = fixture(), id = f.create(); f.pay(id); f.ship(id); f.receive(id); const first = f.refund(id); f.run('goods.refund', { id, caseId: first, outcome: 'success' }, g);
  f.run('goods.case', { id, kind: 'refund', amountCents: 0, shippingCents: 1000, reason: '协商退运费' }); const c = order(f, id).cases.at(-1).id;
  f.run('goods.case-review', { id, caseId: c, decision: 'approve', reason: '同意运费方案' }, g); f.run('goods.refund', { id, caseId: c, outcome: 'success' }, g);
  assert.equal(goodsSummary(f.s, order(f, id)).netCents, 20000); assert.equal(goodsSummary(f.s, order(f, id)).commissionCents, 3000);
  assert.throws(() => f.run('goods.case', { id, kind: 'refund', amountCents: 0, shippingCents: 1, reason: '重复运费' }), /运费/);
});
