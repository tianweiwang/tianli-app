import test from 'node:test';
import assert from 'node:assert/strict';
import { seed, reduce, money, availableStock } from './engine.mjs';
import { customerView } from './customer.mjs';
import { staffView } from './staff.mjs';
import { goodsOrderExtras, goodsCaseExtras } from './goods-exceptions-ui.mjs';

const user = { role: 'user', userId: 'u1' }, other = { role: 'user', userId: 'u2' };
const support = { role: 'group', job: 'support' }, warehouse = { role: 'group', job: 'warehouse' }, finance = { role: 'group', job: 'finance' }, group = { role: 'group' }, store = { role: 'store', storeId: 'xingfu' };
const e = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const decode = v => v.replace(/&quot;|&#39;|&lt;|&gt;|&amp;/g, c => ({ '&quot;': '"', '&#39;': "'", '&lt;': '<', '&gt;': '>', '&amp;': '&' }[c]));
const ui = { esc: e, money, date: at => at ? new Date(at).toISOString() : '—', query: new URLSearchParams(),
  link: (label, path, kind = '') => `<a href="#${e(path)}" class="${e(kind)}">${label}</a>`,
  button: (label, command, p = {}, kind = '') => `<button type="button" data-command="${e(command)}" data-payload="${e(JSON.stringify(p))}" class="${e(kind)}">${e(label)}</button>`,
  field: (label, name, value = '', type = 'text', attrs = '') => `<label class="field"><span>${e(label)}</span><input name="${e(name)}" value="${e(value)}" type="${e(type)}" ${attrs}></label>`,
  select: (label, name, options, value) => `<label class="field"><span>${e(label)}</span><select name="${e(name)}">${options.map(o => `<option value="${e(o.value)}"${String(o.value) === String(value) ? ' selected' : ''}>${e(o.label)}</option>`).join('')}</select></label>`,
  tag: label => `<span class="tag">${e(label)}</span>`, empty: (label, detail = '') => `<section><h2>${e(label)}</h2><p>${e(detail)}</p></section>` };
function forms(html, command) { return [...html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/g)].map(([, raw, body]) => { const attrs = Object.fromEntries([...raw.matchAll(/([\w-]+)=("[^"]*"|'[^']*')/g)].map(([, k, v]) => [k, decode(v.slice(1, -1))])); return { attrs, body, command: attrs['data-command'], payload: JSON.parse(attrs['data-payload'] || '{}') }; }).filter(x => !command || x.command === command); }
function fixture({ qty = 3, shipped = false, secondSku = true } = {}) {
  let s = seed(), seq = 0;
  const f = { get s() { return s; }, run(type, payload = {}, actor = user) { let result; s = reduce(s, actor, type, { requestId: `goods-ui-${++seq}`, ...payload }, r => { result = r; }); return result; }, get order() { return s.goods.at(-1); }, get c() { return this.order.cases.at(-1); }, get incident() { return this.order.incidents.at(-1); }, page(actor = user) { return actor.role === 'user' ? customerView(s, actor, ['goods', this.order.id], ui) : staffView(s, actor, ['goods', this.order.id], ui); }, submit(command, form, values = {}, actor = user) { this.run(command, { ...form.payload, ...values }, actor); }, returnCase() { this.run('goods.case', { id: this.order.id, kind: 'return', skuId: 'oil', qty, amountCents: qty * 20000, shippingCents: 0, reason: '申请核实退货' }); this.run('goods.case-review', { id: this.order.id, caseId: this.c.id, decision: 'approve', reason: '同意用户寄回' }, support); this.run('goods.return', { id: this.order.id, caseId: this.c.id, carrier: '退货物流', tracking: 'RETURN-UI' }); return this.c; }, partial() { const form = forms(this.page(warehouse), 'goods.inspect-partial')[0]; this.submit('goods.inspect-partial', form, { qty: 1, evidence: '包装及收件数量已核实' }, warehouse); } };
  f.run('promotion.enter', { storeId: 'xingfu' }); f.run('cart.set', { skuId: 'oil', qty }); if (secondSku) f.run('cart.set', { skuId: 'care', qty: 1 });
  f.run('goods.submit', { addressId: 'AD1' }); f.run('goods.pay', { id: f.order.id, outcome: 'success' });
  if (shipped) f.run('goods.ship', { id: f.order.id, carrier: '演示物流', tracking: 'SHIP-UI' }, warehouse);
  return f;
}

test('order extras hide all data for another customer and an unrelated promotion store', () => {
  const f = fixture();
  for (const actor of [other, { role: 'store', storeId: 'silver' }, { role: 'tech', techId: 'lin' }]) { assert.equal(goodsOrderExtras(f.s, actor, f.order, ui), ''); assert.equal(goodsCaseExtras(f.s, actor, f.order, { id: 'AS' }, ui), ''); }
  assert.match(f.page(other), /无法查看该订单/); assert.doesNotMatch(f.page(other), /示例路128|按商品取消/);
});

test('address choices contain changed valid own addresses in the same province and city', () => {
  const f = fixture(), base = f.s.addresses[0];
  f.s.addresses.push({ ...base, id: 'OWN-VALID', detail: '同城新地址' }, { ...base, id: 'WRONG-CITY', city: '苏州市' }, { ...base, id: 'INACTIVE', active: false, detail: '停用地址' }, { ...base, id: 'DELETED', deletedAt: f.s.now, detail: '删除地址' }, { ...base, id: 'BAD-PHONE', phone: 'bad' });
  const html = f.page(), [change] = forms(html, 'goods.address-change'); assert.ok(change);
  assert.match(change.body, /OWN-VALID/); for (const id of ['AD1', 'AD2', 'WRONG-CITY', 'INACTIVE', 'DELETED', 'BAD-PHONE']) assert.ok(!change.body.includes(`value="${id}"`));
  assert.match(html, /跨区域配送范围与费用需联系集团核实/); assert.equal(change.payload.version, f.order.version);
});

test('actual address form changes the snapshot and history; a stale rendered version is rejected', () => {
  const f = fixture(); f.s.addresses.push({ ...f.s.addresses[0], id: 'OWN-NEW', detail: '同城新楼1号' });
  const original = structuredClone(f.order.address), [old] = forms(f.page(), 'goods.address-change');
  f.submit('goods.address-change', old, { addressId: 'OWN-NEW' }); assert.equal(f.order.address.detail, '同城新楼1号'); assert.deepEqual(f.order.addressHistory[0].before, original);
  assert.match(f.page(), /收货地址变更记录/); assert.match(f.page(), /同城新楼1号/);
  assert.throws(() => f.submit('goods.address-change', old, { addressId: 'AD1' }), /已更新/);
  f.run('goods.ship', { id: f.order.id, carrier: '物流', tracking: 'ADDR-UI' }, warehouse); assert.equal(forms(f.page(), 'goods.address-change').length, 0);
});

test('whole cancellation remains available while line cancellation carries exact SKU quantity and order version', () => {
  const f = fixture(), requests = forms(f.page(), 'goods.case');
  assert.ok(requests.some(x => x.payload.kind === 'cancel' && !x.payload.skuId));
  const oil = requests.find(x => x.payload.skuId === 'oil'); assert.equal(oil.payload.version, f.order.version); assert.match(oil.body, /max="3"/); assert.doesNotMatch(oil.body, /amountCents|退款金额/);
  f.submit('goods.case', oil, { qty: 1, reason: '仅取消一瓶' }); const html = f.page();
  assert.ok(!forms(html, 'goods.case').some(x => x.payload.kind === 'cancel' && !x.payload.skuId));
  assert.match(forms(html, 'goods.case').find(x => x.payload.skuId === 'oil').body, /max="2"/);
});

test('approved line cancellation keeps remaining shipment visible before its refund and preserves inventory', () => {
  const f = fixture(), oil = forms(f.page(), 'goods.case').find(x => x.payload.skuId === 'oil');
  f.submit('goods.case', oil, { qty: 1, reason: '只取消一瓶' });
  const [review] = forms(f.page(support), 'goods.case-review'); f.submit('goods.case-review', review, { decision: 'approve', reason: '核实部分取消' }, support);
  assert.equal(f.order.status, 'paid'); assert.equal(f.c.status, 'refund_ready'); assert.equal(f.order.lines[0].cancelledQty, 1); assert.equal(availableStock(f.s, 'oil'), 10);
  const remaining = forms(f.page(), 'goods.case').find(x => x.payload.skuId === 'oil'); assert.match(remaining.body, /max="2"/);
  const [ship] = forms(f.page(warehouse), 'goods.ship'); assert.ok(ship); assert.match(f.page(warehouse), /其余商品可继续发货/);
  f.submit('goods.ship', ship, { carrier: '物流', tracking: 'PARTIAL-SHIP-UI' }, warehouse); assert.equal(f.s.skus.find(x => x.id === 'oil').stock, 10); assert.equal(f.c.status, 'refund_ready');
});

test('old goods actions follow their actual support warehouse and finance permissions', () => {
  const f = fixture(); f.run('goods.case', { id: f.order.id, kind: 'cancel', reason: '核验办理权限' });
  assert.equal(forms(f.page(support), 'goods.case-review').length, 1); for (const actor of [warehouse, finance, store]) assert.equal(forms(f.page(actor), 'goods.case-review').length, 0);
  f.run('goods.case-review', { id: f.order.id, caseId: f.c.id, decision: 'approve', reason: '同意取消' }, support);
  assert.equal(forms(f.page(finance), 'goods.refund').length, 1); for (const actor of [warehouse, support, store]) assert.equal(forms(f.page(actor), 'goods.refund').length, 0);
  f.run('goods.refund', { id: f.order.id, caseId: f.c.id, outcome: 'processing' }, finance);
  assert.equal(forms(f.page(finance), 'goods.refund-query').length, 1); for (const actor of [warehouse, support, store]) assert.equal(forms(f.page(actor), 'goods.refund-query').length, 0);
});

test('withdrawal labels match the case kind and disappear once physical facts exist', () => {
  const f = fixture(); f.run('goods.case', { id: f.order.id, kind: 'cancel', reason: '取消请求' });
  assert.match(f.page(), /撤回尚未执行的申请/); const [withdraw] = forms(f.page(), 'goods.case-withdraw'); assert.match(withdraw.body, /name="reason"[^>]*required/); assert.equal(withdraw.payload.version, f.c.version);
  f.submit('goods.case-withdraw', withdraw, { reason: '保留原订单履约' }); assert.match(f.page(), /用户已撤回申请/);
  f.run('goods.ship', { id: f.order.id, carrier: '物流', tracking: 'WITHDRAW-UI' }, warehouse); f.returnCase(); assert.match(f.page(), /仓储|退货/); assert.equal(forms(f.page(), 'goods.case-withdraw').length, 0);
});

test('partial receipt is warehouse-only and its rendered payload opens support negotiation', () => {
  const f = fixture({ shipped: true }); f.returnCase();
  const [receipt] = forms(f.page(warehouse), 'goods.inspect-partial'); assert.equal(receipt.payload.caseId, f.c.id); assert.equal(receipt.payload.version, f.c.version); assert.match(receipt.body, /max="2"/);
  for (const actor of [support, finance, store, user]) assert.equal(forms(f.page(actor), 'goods.inspect-partial').length, 0);
  f.partial(); assert.equal(f.c.status, 'partial_received'); assert.equal(forms(f.page(warehouse), 'goods.inspect').length, 0);
  const [proposal] = forms(f.page(support), 'goods.partial-propose'); assert.ok(proposal); assert.match(proposal.body, /readonly required/); assert.match(proposal.body, /name="amountCents"[^>]*value=""[^>]*max="200"/);
  assert.equal(forms(f.page(warehouse), 'goods.partial-propose').length, 0); assert.equal(forms(f.page(), 'goods.case-withdraw').length, 0);
});

test('user confirmation precedes stock disposal and original finance refund in the rendered partial flow', () => {
  const f = fixture({ shipped: true }); f.returnCase(); f.partial();
  const [proposal] = forms(f.page(support), 'goods.partial-propose'); f.submit('goods.partial-propose', proposal, { resolution: 'refund', qty: 1, amountCents: 15000, shippingCents: 0, reason: '核实实收一件，其余两件保留' }, support);
  const [confirm] = forms(f.page(), 'goods.partial-confirm'); assert.ok(confirm); assert.match(confirm.body, /name="reason"[^>]*required/); assert.match(f.page(), /同意后，未寄回的 2 件由您继续保留，本案不退该部分金额；已实收原货按上述方案处置/); assert.equal(forms(f.page(warehouse), 'goods.inspect').length, 0);
  f.submit('goods.partial-confirm', confirm, { decision: 'accept', reason: '接受金额并保留未寄回两件' }); assert.equal(f.c.status, 'awaiting_return_disposition');
  const [inspect] = forms(f.page(warehouse), 'goods.inspect'); assert.ok(inspect); assert.equal(inspect.payload.version, f.c.version); assert.equal(forms(f.page(support), 'goods.inspect').length, 0);
  f.submit('goods.inspect', inspect, { disposition: 'sellable', reason: '实收一件可售入库' }, warehouse); assert.equal(f.order.lines[0].returnedQty, 1);
  const [refund] = forms(f.page(finance), 'goods.refund'); f.submit('goods.refund', refund, { outcome: 'success' }, finance); assert.equal(f.order.refunds[0].amountCents, 15000); assert.equal(f.order.lines[0].refundedCents, 15000);
});

test('rejected partial proposals retain their facts and provide a subsequent receipt and negotiation exit', () => {
  const f = fixture({ shipped: true }); f.returnCase(); f.partial();
  f.submit('goods.partial-propose', forms(f.page(support), 'goods.partial-propose')[0], { resolution: 'refund', qty: 1, amountCents: 10000, shippingCents: 0, reason: '首轮核实一件' }, support);
  f.submit('goods.partial-confirm', forms(f.page(), 'goods.partial-confirm')[0], { decision: 'reject', reason: '补寄剩余两件再办理' });
  assert.equal(f.c.status, 'partial_received'); assert.equal(forms(f.page(support), 'goods.partial-propose').length, 1); const [next] = forms(f.page(warehouse), 'goods.inspect-partial'); assert.ok(next); assert.match(next.body, /max="2"/);
  f.submit('goods.inspect-partial', next, { qty: 2, evidence: '后续包裹实收两件' }, warehouse); assert.equal(f.c.status, 'returning'); assert.equal(f.c.partialReceipt.qty, 3); assert.match(f.page(support), /历史部分验货方案/); assert.equal(forms(f.page(warehouse), 'goods.inspect-partial').length, 0); assert.equal(forms(f.page(warehouse), 'goods.inspect').length, 1);
});

test('partial original-return proposal states retained quantity and user receipt is a reasoned form', () => {
  const f = fixture({ shipped: true }); f.returnCase(); f.partial();
  f.submit('goods.partial-propose', forms(f.page(support), 'goods.partial-propose')[0], { resolution: 'return-back', qty: 1, amountCents: 0, shippingCents: 0, reason: '原货返还，未寄回两件继续保留' }, support);
  assert.match(f.page(), /未寄回 2 件仍由您保留/); assert.match(f.page(), /本案不退款，可按剩余额度另申请/);
  f.submit('goods.partial-confirm', forms(f.page(), 'goods.partial-confirm')[0], { decision: 'accept', reason: '同意返还一件并保留两件' });
  assert.equal(forms(f.page(support), 'goods.return-back').length, 0); const [back] = forms(f.page(warehouse), 'goods.return-back'); f.submit('goods.return-back', back, { carrier: '返还物流', tracking: 'BACK-UI', feePayer: 'group', reason: '按已确认方案返还一件' }, warehouse);
  const [receive] = forms(f.page(), 'goods.return-back-receive'); assert.ok(receive); assert.match(receive.body, /name="reason"[^>]*required/); assert.doesNotMatch(f.page(), /<button[^>]*data-command="goods.return-back-receive"/);
});

test('logistics registration and coordination stay with group jobs; customer confirms the actual proposal', () => {
  const f = fixture({ shipped: true });
  assert.equal(forms(f.page(), 'goods.incident-open').length, 0); assert.equal(forms(f.page(finance), 'goods.incident-open').length, 0); assert.ok(forms(f.page(warehouse), 'goods.incident-open').length);
  f.submit('goods.incident-open', forms(f.page(support), 'goods.incident-open')[0], { kind: 'delay', reason: '运输延迟，正在联系承运方', dueAt: '' }, support);
  assert.equal(forms(f.page(warehouse), 'goods.incident-propose').length, 0); assert.equal(forms(f.page(support), 'goods.incident-propose').length, 1);
  f.submit('goods.incident-propose', forms(f.page(support), 'goods.incident-propose')[0], { resolution: 'continue', reason: '承运方确认继续配送' }, support);
  const [confirm] = forms(f.page(), 'goods.incident-confirm'); assert.equal(confirm.payload.version, f.incident.version); assert.match(confirm.body, /name="reason"[^>]*required/);
  f.submit('goods.incident-confirm', confirm, { decision: 'accept', reason: '接受继续配送' }); assert.equal(f.incident.status, 'waiting'); assert.match(f.page(), /等待原配送、退货或退款流程的实际结果/);
  f.run('goods.receive', { id: f.order.id }); assert.equal(f.incident.status, 'done'); assert.equal(forms(f.page(support), 'goods.incident-note').length, 0); assert.match(f.page(), /已按业务事实办结/);
});

test('manual due times signal follow-up without offering a manual done action', () => {
  const f = fixture({ shipped: true }); f.submit('goods.incident-open', forms(f.page(support), 'goods.incident-open')[0], { kind: 'delay', reason: '人工跟进运输延迟', dueAt: f.s.now - 1 }, support);
  const html = f.page(support); assert.match(html, /已到人工跟进时间/); assert.equal(f.incident.status, 'open'); assert.equal(f.order.status, 'shipped');
  assert.ok(forms(html, 'goods.incident-note')[0].body.includes('人工跟进时间')); assert.doesNotMatch(html, /goods\.incident-(done|close)|标记完成|手动结案/);
});

test('an existing return shipment removes not-returned candidates across return and partial stages', () => {
  const f = fixture({ shipped: true }); f.returnCase();
  const returnForm = () => forms(f.page(support), 'goods.incident-open').find(x => x.payload.stage === 'return' && x.payload.caseId === f.c.id);
  assert.ok(returnForm()); assert.doesNotMatch(returnForm().body, /value="not-returned"/);
  f.partial(); assert.doesNotMatch(returnForm().body, /value="not-returned"/);
  f.submit('goods.partial-propose', forms(f.page(support), 'goods.partial-propose')[0], { resolution: 'refund', qty: 1, amountCents: 10000, shippingCents: 0, reason: '按实际收件协商金额' }, support);
  assert.equal(f.c.status, 'partial_confirmation'); assert.doesNotMatch(returnForm().body, /value="not-returned"/);
});

test('incident refund choices exclude cancellation and completed cases, and use business labels', () => {
  const f = fixture(), careCancel = forms(f.page(), 'goods.case').find(x => x.payload.skuId === 'care');
  f.submit('goods.case', careCancel, { qty: 1, reason: '仅取消未发货食品' }); const cancelId = f.c.id;
  f.submit('goods.case-review', forms(f.page(support), 'goods.case-review')[0], { decision: 'approve', reason: '核实取消食品' }, support);
  f.run('goods.ship', { id: f.order.id, carrier: '物流', tracking: 'CANDIDATE-UI' }, warehouse);
  f.submit('goods.incident-open', forms(f.page(support), 'goods.incident-open')[0], { kind: 'delay', reason: '修复液配送延迟' }, support);
  let [proposal] = forms(f.page(support), 'goods.incident-propose'); assert.ok(!proposal.body.includes(`value="${cancelId}"`)); assert.doesNotMatch(proposal.body, /value="refund"/);
  f.run('goods.refund', { id: f.order.id, caseId: cancelId, outcome: 'success' }, finance);
  [proposal] = forms(f.page(support), 'goods.incident-propose'); assert.ok(!proposal.body.includes(`value="${cancelId}"`));
  f.run('goods.case', { id: f.order.id, kind: 'refund', skuId: 'oil', qty: 1, amountCents: 5000, reason: '核实运输异常退款' });
  [proposal] = forms(f.page(support), 'goods.incident-propose'); assert.match(proposal.body, /仅退款 · 待受理/); assert.doesNotMatch(proposal.body, /· requested|· done/);
});

test('promotion stores receive status only without private reasons contacts address history or write forms', () => {
  const f = fixture({ shipped: true }); f.submit('goods.incident-open', forms(f.page(support), 'goods.incident-open')[0], { kind: 'lost', reason: '私密异常事实正文', dueAt: f.s.now }, support);
  f.order.addressHistory.push({ at: f.s.now, after: { name: '隐私收件姓名', phone: '13955556666', detail: '隐私改址街道' } });
  f.incident.records.push({ at: f.s.now, reason: '私密跟进事实正文' }); const html = f.page(store); assert.match(html, /商品异常进度/); assert.match(html, /集团待跟进/);
  for (const text of ['私密异常事实正文', '私密跟进事实正文', '隐私收件姓名', '13955556666', '隐私改址街道', 'SHIP-UI']) assert.ok(!html.includes(text), text);
  assert.equal(forms(html).filter(f => f.command.startsWith('goods.')).length, 0);
});

test('new reason-bearing displays escape source data and do not turn notices into actions', () => {
  const f = fixture({ shipped: true }); f.submit('goods.incident-open', forms(f.page(support), 'goods.incident-open')[0], { kind: 'damaged', reason: '<script>私有输入</script>', dueAt: '' }, support);
  const html = f.page(support); assert.match(html, /&lt;script&gt;/); assert.doesNotMatch(html, /<script>/);
  for (const [, attrs, body] of html.matchAll(/<div\b([^>]*role="status"[^>]*)>([\s\S]*?)<\/div>/g)) { assert.doesNotMatch(attrs, /data-command|role="button"/); assert.doesNotMatch(body, /<button|<input/); }
  const before = structuredClone(f.s); for (const actor of [user, support, warehouse, finance, store]) f.page(actor); assert.deepEqual(f.s, before);
});
