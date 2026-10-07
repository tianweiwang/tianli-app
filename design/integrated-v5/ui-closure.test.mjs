import test from 'node:test';
import assert from 'node:assert/strict';
import { seed, reduce, goodsSummary, money } from './engine.mjs';
import { customerView } from './customer.mjs';
import { staffView } from './staff.mjs';

const user = { role: 'user', userId: 'u1' }, group = { role: 'group' }, store = { role: 'store', storeId: 'xingfu' }, finance = { role: 'group', job: 'finance' };
const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const decode = value => value.replace(/&quot;|&#39;|&lt;|&gt;|&amp;/g, entity => ({ '&quot;': '"', '&#39;': "'", '&lt;': '<', '&gt;': '>', '&amp;': '&' }[entity]));
const ui = (query = '') => ({
  esc, money, query: new URLSearchParams(query), date: value => value ? new Date(value).toISOString() : '—',
  link: (label, path, cls = '') => `<a href="#${esc(path)}" class="${esc(cls)}">${label}</a>`,
  button: (label, command, payload = {}, cls = '') => `<button type="button" class="${esc(cls)}" data-command="${esc(command)}" data-payload="${esc(JSON.stringify(payload))}">${esc(label)}</button>`,
  field: (label, name, value = '', type = 'text', attrs = '') => `<label><span>${esc(label)}</span><input name="${esc(name)}" value="${esc(value)}" type="${esc(type)}" ${attrs}></label>`,
  select: (label, name, options, value) => `<label><span>${esc(label)}</span><select name="${esc(name)}">${options.map(option => `<option value="${esc(option.value)}" ${String(value) === String(option.value) ? 'selected' : ''}>${esc(option.label)}</option>`).join('')}</select></label>`,
  tag: label => `<span class="tag">${esc(label)}</span>`,
  empty: (label, detail = '') => `<section><h2>${esc(label)}</h2><p>${esc(detail)}</p></section>`
});
function commandPayloads(html, command) {
  return [...html.matchAll(/<(?:form|button)\b[^>]*>/g)].map(([tag]) => {
    const attrs = Object.fromEntries([...tag.matchAll(/([\w-]+)=("[^"]*"|'[^']*')/g)].map(([, name, value]) => [name, decode(value.slice(1, -1))]));
    return attrs['data-command'] === command ? JSON.parse(attrs['data-payload'] || '{}') : null;
  }).filter(Boolean);
}
function fixture() {
  let state = seed(), requests = 0;
  return {
    get state() { return state; },
    run(type, payload = {}, actor = user) { state = reduce(state, actor, type, payload); },
    order(id) { return state.goods.find(o => o.id === id); },
    staff(actor, route, query = '') { return staffView(state, actor, route, ui(query)); },
    customer(route, query = '') { return customerView(state, user, route, ui(query)); },
    createGoods({ paid = false, received = false } = {}) {
      this.run('promotion.enter', { storeId: 'xingfu' }); this.run('cart.set', { skuId: 'oil', qty: 1 });
      this.run('goods.submit', { requestId: 'ui-order-' + ++requests, addressId: 'AD1' }); const id = state.goods.at(-1).id;
      if (paid) this.run('goods.pay', { id, outcome: 'success' });
      if (received) { this.run('goods.ship', { id, carrier: '演示物流', tracking: 'UI-GOODS' }, group); this.run('goods.receive', { id }); }
      return id;
    },
    bill() { this.run('clock.advance', { minutes: 10080 }); this.run('bill.create', { storeId: 'xingfu' }, group); return state.bills.at(-1); },
    refund(id, amountCents) {
      this.run('goods.case', { id, requestId: 'ui-case-' + ++requests, kind: 'refund', skuId: 'oil', qty: 1, amountCents, reason: '界面核验退款' });
      const caseId = this.order(id).cases.at(-1).id;
      this.run('goods.case-review', { id, caseId, decision: 'approve', reason: '同意核验' }, group);
      this.run('goods.refund', { id, caseId, outcome: 'success' }, finance);
    }
  };
}

test('账单界面携带实际显示版本，旧页面请求拒绝，新页面载荷能完成确认', () => {
  const f = fixture(), id = f.createGoods({ paid: true, received: true }), first = f.bill();
  const html = f.staff(store, ['bills', first.id]);
  assert.match(html, new RegExp(`核对版本</span><strong>第 ${first.version} 版`));
  const [oldConfirm] = commandPayloads(html, 'bill.confirm'), [oldDispute] = commandPayloads(html, 'bill.dispute');
  assert.deepEqual(oldConfirm, { id: first.id, version: first.version }); assert.deepEqual(oldDispute, oldConfirm);
  f.refund(id, 10000);
  assert.throws(() => f.run('bill.confirm', oldConfirm, store), /账单已更新/);
  assert.throws(() => f.run('bill.dispute', { ...oldDispute, reason: '旧页面请求' }, store), /账单已更新/);
  const [fresh] = commandPayloads(f.staff(store, ['bills', first.id]), 'bill.confirm');
  assert.equal(fresh.version, f.state.bills[0].version); assert.ok(fresh.version > first.version);
  f.run('bill.confirm', fresh, store); assert.equal(f.state.bills[0].status, 'confirmed');
});

test('未付、失败和未付关闭的商品订单，集团与门店均区分应付210和实付0', () => {
  for (const phase of ['unpaid', 'failed', 'closed']) {
    const f = fixture(), id = f.createGoods();
    if (phase === 'failed') f.run('goods.pay', { id, outcome: 'failed' });
    if (phase === 'closed') f.run('goods.close', { id });
    assert.equal(goodsSummary(f.state, f.order(id)).netCents, 0);
    for (const actor of [group, store]) {
      const detail = f.staff(actor, ['goods', id]), list = f.staff(actor, ['goods']);
      assert.match(detail, /订单应付<\/span><strong>¥210\.00/);
      assert.match(detail, /订单实付<\/span><strong>¥0\.00/);
      assert.match(detail, /净收款<\/span><strong>¥0\.00/);
      assert.match(detail, /<th>商品金额<\/th>/); assert.doesNotMatch(detail, /商品实付/);
      assert.match(list, /应付 \/ 实付 \/ 已退/); assert.match(list, /实付 ¥0\.00 · 已退 ¥0\.00/);
    }
  }
});

test('实际付款和退款后的商品界面分别显示原实付、已退和净收', () => {
  const f = fixture(), id = f.createGoods({ paid: true, received: true }); f.refund(id, 5000);
  for (const actor of [group, store]) {
    const detail = f.staff(actor, ['goods', id]);
    assert.match(detail, /订单实付<\/span><strong>¥210\.00/);
    assert.match(detail, /成功退款<\/span><strong>¥50\.00/);
    assert.match(detail, /净收款<\/span><strong>¥160\.00/);
  }
});

test('零佣金成交在集团和推广门店界面显示无需结算，不显示全退作废', () => {
  const f = fixture(), sku = f.state.skus.find(x => x.id === 'oil');
  f.run('manage.sku-save', { ...sku, commissionBps: 0, requestId: 'ui-zero-rate', reason: '零佣金规则' }, group);
  const id = f.createGoods({ paid: true });
  for (const actor of [group, store]) {
    const detail = f.staff(actor, ['goods', id]), list = f.staff(actor, ['goods']);
    assert.match(detail, /佣金：无需结算 · 推广规则为零佣金/);
    assert.doesNotMatch(detail, /商品金额已全退|已作废/); assert.match(list, /无需结算/);
  }
});

test('门店改名后商品详情和后台列表继续显示下单时推广名称', () => {
  const f = fixture(), id = f.createGoods({ paid: true }), before = f.order(id).source.storeName;
  const x = f.state.stores.find(t => t.id === 'xingfu');
  f.run('manage.store-save', { ...x, name: '重新命名的门店', contact: x.contact || '负责人', phone: x.phone || '13800000000', qualification: x.qualification || '演示资质', merchantNo: x.merchantNo || '演示商户', requestId: 'ui-rename-store', reason: '核验历史显示' }, group);
  assert.equal(f.state.stores.find(t => t.id === 'xingfu').name, '重新命名的门店');
  const screens = [f.customer(['goods', id]), f.staff(group, ['goods', id]), f.staff(store, ['goods', id]), f.staff(group, ['goods'])];
  for (const html of screens) { assert.ok(html.includes(before)); assert.doesNotMatch(html, /重新命名的门店/); }
});

test('分类排序保存后立即改变商城入口顺序，筛选仍显示对应商品', () => {
  const f = fixture(), category = f.state.categories.find(c => c.id === 'food');
  f.run('manage.category-save', { ...category, sort: 1, requestId: 'ui-category-order', reason: '营养食品优先展示' }, group);
  assert.equal(f.state.categories.find(c => c.id === 'food').sort, 1);
  const html = f.customer(['mall']), nav = html.match(/<nav[^>]*aria-label="商品分类"[^>]*>(.*?)<\/nav>/s)?.[1];
  assert.ok(nav); assert.ok(nav.indexOf('>营养食品<') < nav.indexOf('>日常护理<'));
  const filtered = f.customer(['mall'], 'category=' + encodeURIComponent('营养食品'));
  assert.match(filtered, /IGOOD蛋白粉/); assert.doesNotMatch(filtered, /IGOOD修复液/);
});

test('财务工作台能进入预约列表和退款详情，并以页面载荷执行退款', () => {
  const f = fixture();
  f.run('booking.create', { requestId: 'ui-finance-booking', storeId: 'xingfu', serviceId: 'relax', regionId: 'home', mode: 'specified', techId: 'lin', startAt: Date.parse('2026-10-02T13:00:00+08:00'), contactName: '演示预约人', phone: '13800000000', identityVerified: true, healthConsent: true, adultConfirmed: true });
  const id = f.state.bookings.at(-1).id;
  f.run('booking.pay', { id, outcome: 'success' }); f.run('booking.cancel', { id, reason: '提前取消' });
  const dashboard = f.staff(finance, ['dashboard']), list = f.staff(finance, ['bookings']), detail = f.staff(finance, ['bookings', id]);
  assert.match(dashboard, /href="#\/group\/bookings"/); assert.match(dashboard, /财务工作台/);
  assert.ok(list.includes(id)); assert.ok(detail.includes(id));
  assert.doesNotMatch(list + detail, /当前岗位无权查看/);
  const commands = commandPayloads(detail, 'booking.refund-pay'); assert.ok(commands.length > 0);
  for (const command of commands) f.run('booking.refund-pay', { ...command, outcome: 'success' }, finance);
  assert.equal(f.state.bookings.at(-1).payment.refundedCents, 29800);
  assert.match(f.staff(finance, ['bookings', id]), /成功退款<\/span><strong>¥298\.00/);
});
