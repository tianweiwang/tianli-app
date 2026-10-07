import test from 'node:test';
import assert from 'node:assert/strict';
import { seed, reduce, goodsSummary } from './engine.mjs';

const user = { role: 'user', userId: 'u1' }, group = { role: 'group' }, store = { role: 'store', storeId: 'xingfu' };
function fixture() {
  let state = seed(), requests = 0;
  return {
    get state() { return state; },
    run(type, payload = {}, actor = user) { state = reduce(state, actor, type, payload); return state; },
    order(id) { return state.goods.find(o => o.id === id); },
    rate(priceCents, commissionBps) {
      const sku = state.skus.find(x => x.id === 'oil');
      this.run('manage.sku-save', { ...sku, priceCents, commissionBps, requestId: 'sku-' + ++requests, reason: '核验佣金规则' }, group);
    },
    create({ paid = true, received = true } = {}) {
      this.run('promotion.enter', { storeId: 'xingfu', sourceId: 'poster-xingfu' });
      this.run('cart.set', { skuId: 'oil', qty: 1 });
      this.run('goods.submit', { addressId: 'AD1', requestId: 'order-' + ++requests });
      const id = state.goods.at(-1).id;
      if (paid) this.run('goods.pay', { id, outcome: 'success' });
      if (paid && received) {
        this.run('goods.ship', { id, carrier: '演示物流', tracking: 'DEMO-' + id }, group);
        this.run('goods.receive', { id });
      }
      return id;
    },
    refund(id, amountCents, requestId = 'refund-' + ++requests) {
      this.run('goods.case', { id, requestId, kind: 'refund', skuId: 'oil', qty: 1, amountCents, reason: '核验退款' });
      const caseId = this.order(id).cases.at(-1).id;
      this.run('goods.case-review', { id, caseId, decision: 'approve', reason: '核验通过' }, group);
      this.run('goods.refund', { id, caseId, outcome: 'success' }, group);
      return caseId;
    },
    bill() { this.run('clock.advance', { minutes: 10080 }); this.run('bill.create', { storeId: 'xingfu' }, group); return state.bills.at(-1); }
  };
}

test('零费率订单实付210元未退款，显示无需结算', () => {
  const f = fixture(); f.rate(20000, 0); const id = f.create();
  const summary = goodsSummary(f.state, f.order(id));
  assert.equal(summary.netCents, 21000); assert.equal(summary.refundedCents, 0);
  assert.equal(summary.commissionCents, 0); assert.equal(summary.commissionStatus, '无需结算');
  assert.match(summary.commissionReason, /零佣金/); assert.doesNotMatch(summary.commissionReason, /全退/);
  assert.throws(() => f.bill(), /没有.*可结佣金/);
});

test('小额商品与部分退款取整为零不误写全退', () => {
  const tiny = fixture(); tiny.rate(1, 1000); const tinyId = tiny.create();
  assert.equal(goodsSummary(tiny.state, tiny.order(tinyId)).commissionStatus, '无需结算');
  assert.match(goodsSummary(tiny.state, tiny.order(tinyId)).commissionReason, /取整/);
  const partial = fixture(); partial.rate(10, 1000); const id = partial.create();
  assert.equal(goodsSummary(partial.state, partial.order(id)).commissionCents, 1);
  partial.refund(id, 1);
  const summary = goodsSummary(partial.state, partial.order(id));
  assert.equal(summary.refundedCents, 1); assert.equal(summary.commissionStatus, '无需结算');
  assert.doesNotMatch(summary.commissionReason, /全退/);
});

test('真实商品全退仍作废佣金，未退运费不参与商品佣金', () => {
  const f = fixture(), id = f.create(); f.refund(id, 20000);
  const summary = goodsSummary(f.state, f.order(id));
  assert.equal(summary.netCents, 1000); assert.equal(summary.commissionStatus, '已作废');
  assert.equal(summary.commissionReason, '商品金额已全退');
});

test('推广名称、资格及规则在下单锁定，后续改名和停推不改历史来源', () => {
  const f = fixture(), id = f.create({ paid: false });
  const source = structuredClone(f.order(id).source), original = f.state.stores.find(x => x.id === 'xingfu');
  assert.equal(source.storeName, original.name); assert.equal(source.storeVersion, original.version);
  assert.equal(source.ruleVersion, f.state.settings.version); assert.equal(source.lockedAt, f.order(id).createdAt);
  assert.equal(source.qualification.promotionEnabled, true); assert.equal(source.qualification.reviewStatus, 'approved');
  f.run('manage.store-save', { ...original, name: '幸福里新店名', contact: original.contact || '演示负责人', phone: original.phone || '13800000000', qualification: original.qualification || '演示门店资质', merchantNo: original.merchantNo || '演示商户', requestId: 'rename-store', reason: '核验历史名称' }, group);
  const renamed = f.state.stores.find(x => x.id === 'xingfu');
  f.run('manage.store-status', { id: renamed.id, version: renamed.version, status: 'promotion-off', requestId: 'stop-promotion', reason: '停止新推广' }, group);
  f.run('goods.pay', { id, outcome: 'success' });
  assert.deepEqual(f.order(id).source, source);
  assert.equal(goodsSummary(f.state, f.order(id)).commissionCents, 2000);
});

test('无名称快照的旧订单不凭当前名补造历史快照', () => {
  const f = fixture(), id = f.create(); const old = structuredClone(f.state);
  old.goods[0].source = { storeId: 'xingfu', at: old.now, sourceId: 'legacy' };
  const next = reduce(old, user, 'clock.advance', { minutes: 1 });
  assert.equal(next.goods[0].source.storeName, undefined); assert.equal(next.goods[0].id, id);
  assert.equal(goodsSummary(next, next.goods[0]).commissionCents, 2000);
});

test('账单缺少版本与旧版确认、差异均被拒绝，按新版核对后才能支付', () => {
  const f = fixture(), id = f.create(), bill = f.bill();
  for (const command of ['bill.confirm', 'bill.dispute']) assert.throws(() => f.run(command, { id: bill.id, reason: '差异说明' }, store), /版本/);
  f.refund(id, 10000);
  const adjusted = f.state.bills[0];
  assert.ok(adjusted.version > bill.version); assert.equal(adjusted.amountCents, 1000);
  const before = structuredClone(f.state);
  for (const command of ['bill.confirm', 'bill.dispute']) assert.throws(() => f.run(command, { id: bill.id, version: bill.version, reason: '旧页面差异' }, store), /账单已更新/);
  assert.deepEqual(f.state, before);
  f.run('bill.confirm', { id: bill.id, version: String(adjusted.version) }, store);
  f.run('bill.pay', { id: bill.id, outcome: 'processing' }, group);
  f.run('bill.query', { id: bill.id, outcome: 'success' }, group);
  assert.equal(f.order(id).commissionPaidCents, 1000);
});

test('差异核查更新版本，门店必须确认核查后的账单', () => {
  const f = fixture(); f.create(); const bill = f.bill();
  f.run('bill.dispute', { id: bill.id, version: bill.version, reason: '申请核对明细' }, store);
  f.run('bill.resolve', { id: bill.id, reason: '核查完成，明细正确' }, group);
  assert.throws(() => f.run('bill.confirm', { id: bill.id, version: bill.version }, store), /已更新/);
  f.run('bill.confirm', { id: bill.id, version: f.state.bills[0].version }, store);
  assert.equal(f.state.bills[0].status, 'confirmed');
});

test('同一售后请求重试只占一次额度，结案后重试也不重新退款', () => {
  const f = fixture(), id = f.create();
  const payload = { id, requestId: 'case-once', kind: 'refund', skuId: 'oil', qty: 1, amountCents: 5000, reason: '同次申请' };
  f.run('goods.case', payload); const first = f.order(id).cases[0];
  f.run('goods.case', { ...payload, qty: '1', amountCents: '5000', shippingCents: '0' });
  assert.equal(f.order(id).cases.length, 1); assert.equal(f.order(id).cases[0].id, first.id);
  assert.equal(f.order(id).cases.reduce((n, c) => n + c.amountCents, 0), 5000);
  f.run('goods.case-review', { id, caseId: first.id, decision: 'approve', reason: '同意' }, group);
  f.run('goods.refund', { id, caseId: first.id, outcome: 'success' }, group);
  f.run('goods.case', payload);
  assert.equal(f.order(id).cases.length, 1); assert.equal(f.order(id).refunds.length, 1);
  assert.equal(goodsSummary(f.state, f.order(id)).refundedCents, 5000);
});

test('相同请求标识不能修改金额或跨订单复用，新标识允许新的真实诉求', () => {
  const f = fixture(), id = f.create();
  const payload = { id, requestId: 'intent-1', kind: 'refund', skuId: 'oil', qty: 1, amountCents: 5000, reason: '申请售后' };
  f.run('goods.case', payload);
  assert.throws(() => f.run('goods.case', { ...payload, amountCents: 4000 }), /标识已用于不同内容/);
  const second = f.create();
  assert.throws(() => f.run('goods.case', { ...payload, id: second }), /标识已用于不同内容/);
  f.run('goods.case', { ...payload, requestId: 'intent-2' });
  assert.equal(f.order(id).cases.length, 2);
  assert.equal(f.order(id).cases.reduce((n, c) => n + c.amountCents, 0), 10000);
});

test('整单取消批准后重试原请求，不受已取消状态影响且不重复', () => {
  const f = fixture(), id = f.create({ received: false });
  const payload = { id, requestId: 'cancel-once', kind: 'cancel', reason: '不再需要' };
  f.run('goods.case', payload); const caseId = f.order(id).cases[0].id;
  f.run('goods.case-review', { id, caseId, decision: 'approve', reason: '未发货同意' }, group);
  f.run('goods.case', payload);
  assert.equal(f.order(id).status, 'cancelled'); assert.equal(f.order(id).cases.length, 1);
});

test('旧版无请求标识仍可申请，兼容调用明确不推断同次意图', () => {
  const f = fixture(), id = f.create();
  const legacy = { id, kind: 'refund', skuId: 'oil', qty: 1, amountCents: 1000, reason: '旧版调用' };
  f.run('goods.case', legacy); f.run('goods.case', legacy);
  assert.equal(f.order(id).cases.length, 2); assert.equal(f.order(id).cases[0].requestId, undefined);
});
