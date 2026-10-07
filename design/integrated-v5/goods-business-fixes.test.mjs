import test from 'node:test';
import assert from 'node:assert/strict';
import { seed, reduce, money } from './engine.mjs';
import { customerView } from './customer.mjs';
import { staffView } from './staff.mjs';

const user = { role: 'user', userId: 'u1' };
const support = { role: 'group', job: 'support' };
const warehouse = { role: 'group', job: 'warehouse' };
const finance = { role: 'group', job: 'finance' };
const store = { role: 'store', storeId: 'xingfu' };
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const decode = value => value.replace(/&quot;|&#39;|&lt;|&gt;|&amp;/g, c => ({ '&quot;': '"', '&#39;': "'", '&lt;': '<', '&gt;': '>', '&amp;': '&' }[c]));
const ui = {
  esc, money, query: new URLSearchParams(), date: value => new Date(value).toISOString(),
  link: (label, path, cls = '') => `<a href="#${esc(path)}" class="${esc(cls)}">${label}</a>`,
  button: (label, command, payload = {}, cls = '') => `<button data-command="${esc(command)}" data-payload="${esc(JSON.stringify(payload))}" class="${esc(cls)}">${esc(label)}</button>`,
  field: (label, name, value = '', type = 'text', attrs = '') => `<label>${esc(label)}<input name="${esc(name)}" value="${esc(value)}" type="${esc(type)}" ${attrs}></label>`,
  select: (label, name, options, value) => `<label>${esc(label)}<select name="${esc(name)}">${options.map(o => `<option value="${esc(o.value)}" ${o.value === value ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select></label>`,
  tag: label => `<span>${esc(label)}</span>`, empty: label => `<p>${esc(label)}</p>`
};
const attributes = tag => Object.fromEntries([...tag.matchAll(/([\w-]+)=("[^"]*"|'[^']*')/g)].map(([, name, value]) => [name, decode(value.slice(1, -1))]));
function caseForms(html) {
  return [...html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/g)].map(([, tag, body]) => {
    const attrs = attributes(tag);
    if (attrs['data-command'] !== 'goods.case') return null;
    const fields = Object.fromEntries([...body.matchAll(/<input\b[^>]*>/g)].map(([tag]) => { const attrs = attributes(tag); return [attrs.name, attrs]; }));
    return { payload: JSON.parse(attrs['data-payload']), fields };
  }).filter(Boolean);
}
function submitPayload(form, overrides = {}) {
  const payload = { ...form.payload };
  for (const [name, field] of Object.entries(form.fields)) {
    if (name === 'amountYuan' || name === 'shippingYuan') payload[name === 'amountYuan' ? 'amountCents' : 'shippingCents'] = Math.round(Number(field.value) * 100);
    else payload[name] = field.type === 'number' ? Number(field.value) : field.value;
  }
  return { ...payload, reason: '业务复审回归申请', ...overrides };
}
function fixture(items = [['oil', 1], ['care', 1]], ship = true) {
  let s = seed();
  const run = (type, payload, actor = user) => (s = reduce(s, actor, type, payload));
  run('promotion.enter', { storeId: 'xingfu' });
  for (const [skuId, qty] of items) run('cart.set', { skuId, qty });
  run('goods.submit', { requestId: 'business-goods', addressId: 'AD1' });
  const id = s.goods.at(-1).id;
  run('goods.pay', { id, outcome: 'success' });
  if (ship) run('goods.ship', { id, carrier: '演示物流', tracking: 'SHIP-BUSINESS' }, warehouse);
  return {
    id, run, get s() { return s; }, get order() { return s.goods.find(o => o.id === id); },
    html() { return customerView(s, user, ['goods', id], ui); },
    forms() { return caseForms(this.html()); },
    approve(caseId) { run('goods.case-review', { id, caseId, decision: 'approve', reason: '集团受理' }, support); }
  };
}

test('B02 A等待寄回时B保留售后入口，页面载荷可提交，同件重复退货仍拒绝', () => {
  const f = fixture();
  const a = f.forms().find(v => v.payload.skuId === 'oil' && v.payload.kind === 'return');
  f.run('goods.case', submitPayload(a, { shippingCents: 1000 }));
  const caseId = f.order.cases[0].id; f.approve(caseId);
  assert.equal(f.order.cases[0].status, 'awaiting_return');
  assert.ok(!f.forms().some(v => v.payload.skuId === 'oil'));
  const b = f.forms().find(v => v.payload.skuId === 'care' && v.payload.kind === 'return');
  assert.ok(b); assert.equal(b.fields.shippingYuan.max, '0.00');
  assert.ok(!f.forms().some(v => !v.payload.skuId));
  assert.throws(() => f.run('goods.case', submitPayload(b, { shippingCents: 1 })), /运费申请超过/);
  assert.throws(() => f.run('goods.case', submitPayload(a)), /申请金额超过/);
  f.run('goods.case', submitPayload(b));
  assert.equal(f.order.cases.length, 2);
  assert.equal(f.order.cases[1].skuId, 'care');
  assert.equal(f.order.cases[1].amountCents, 10000);
  assert.equal(f.order.cases[0].status, 'awaiting_return');
  assert.equal(f.forms().length, 0);
});

test('B02 同规格按在途金额和实物分别限额，仅退款不被实物件数错误限制', () => {
  const f = fixture([['oil', 2]]);
  f.run('goods.case', { id: f.id, skuId: 'oil', kind: 'return', qty: 1, amountCents: 10000, reason: '第一件退货' });
  let forms = f.forms();
  const nextReturn = forms.find(v => v.payload.kind === 'return');
  const nextRefund = forms.find(v => v.payload.kind === 'refund');
  assert.equal(nextReturn.fields.qty.max, '1'); assert.equal(nextReturn.fields.amountYuan.max, '200.00');
  assert.equal(nextRefund.fields.qty.max, '2'); assert.equal(nextRefund.fields.amountYuan.max, '300.00');
  assert.throws(() => f.run('goods.case', submitPayload(nextReturn, { qty: 2 })), /退货数量超过/);
  f.run('goods.case', submitPayload(nextReturn, { amountCents: 10000 }));
  forms = f.forms();
  assert.ok(!forms.some(v => v.payload.kind === 'return'));
  assert.equal(forms.find(v => v.payload.skuId === 'oil').fields.amountYuan.max, '200.00');
  assert.throws(() => f.run('goods.case', submitPayload(nextRefund, { amountCents: 20001 })), /申请金额超过/);
});

test('B02 驳回释放占额，验收入库与退款成功后不重复扣除在途金额和件数', () => {
  const f = fixture([['oil', 2]]);
  f.run('goods.case', { id: f.id, skuId: 'oil', kind: 'return', qty: 1, amountCents: 10000, reason: '首笔申请' });
  f.run('goods.case-review', { id: f.id, caseId: f.order.cases[0].id, decision: 'reject', reason: '用户资料需补充' }, support);
  assert.equal(f.forms().find(v => v.payload.kind === 'return').fields.qty.max, '2');
  assert.equal(f.forms().find(v => v.payload.kind === 'return').fields.amountYuan.max, '400.00');
  f.run('goods.case', { id: f.id, skuId: 'oil', kind: 'return', qty: 1, amountCents: 10000, reason: '补充资料重提' });
  const caseId = f.order.cases.at(-1).id; f.approve(caseId);
  f.run('goods.return', { id: f.id, caseId, carrier: '演示物流', tracking: 'RETURN-BUSINESS' });
  f.run('goods.inspect', { id: f.id, caseId, disposition: 'sellable', reason: '实收一件可售' }, warehouse);
  assert.equal(f.forms().find(v => v.payload.kind === 'return').fields.qty.max, '1');
  f.run('goods.refund', { id: f.id, caseId, outcome: 'success' }, finance);
  assert.equal(f.order.cases.at(-1).status, 'done');
  assert.equal(f.forms().find(v => v.payload.kind === 'return').fields.qty.max, '1');
  assert.equal(f.forms().find(v => v.payload.skuId === 'oil' && v.payload.kind === 'refund').fields.amountYuan.max, '300.00');
});

test('B03 同名多规格案件各自展示订单快照，后续商品改名不改变用户和工作端案件', () => {
  const f = fixture([['oil', 1], ['oil-small', 1]]);
  for (const skuId of ['oil', 'oil-small']) f.run('goods.case', { id: f.id, skuId, kind: 'return', qty: 1, amountCents: 10000, reason: '规格核验' });
  for (const sku of f.s.skus) { sku.name = '已改的新名称'; sku.spec = '已改的新规格'; }
  for (const c of f.order.cases) {
    const line = f.order.lines.find(v => v.skuId === c.skuId);
    const own = line.spec, other = c.skuId === 'oil' ? '便携瓶装' : '标准瓶装';
    const userCard = f.html().split(`<h2>售后 ${c.id}</h2>`)[1].split('</section>')[0];
    for (const text of ['IGOOD修复液', own, `SKU ${c.skuId}`, '1 件']) assert.ok(userCard.includes(text));
    assert.ok(!userCard.includes(other)); assert.ok(!userCard.includes('已改的新'));
    for (const actor of [support, warehouse, finance, store]) {
      const page = staffView(f.s, actor, ['goods', f.id], ui);
      const card = page.split(`<h3>${c.id} ·`)[1].split('</article>')[0];
      for (const text of ['IGOOD修复液', own, `SKU ${c.skuId}`, '1 件']) assert.ok(card.includes(text));
      assert.ok(!card.includes(other)); assert.ok(!card.includes('已改的新'));
    }
  }
});

test('B03 整单取消逐项显示申请数量与规格，仅运费案件不假冒商品', () => {
  const cancelled = fixture([['oil', 2], ['oil-small', 1]], false);
  cancelled.run('goods.case', { id: cancelled.id, kind: 'cancel', reason: '未发货整单取消' });
  const c = cancelled.order.cases[0];
  const userCard = cancelled.html().split(`<h2>售后 ${c.id}</h2>`)[1].split('</section>')[0];
  const staffCard = staffView(cancelled.s, support, ['goods', cancelled.id], ui).split(`<h3>${c.id} ·`)[1].split('</article>')[0];
  for (const card of [userCard, staffCard]) {
    for (const text of ['标准瓶装', '便携瓶装', 'SKU oil', 'SKU oil-small', '2 件', '1 件', '¥400.00', '¥100.00']) assert.ok(card.includes(text));
  }
  const shipping = fixture();
  shipping.run('goods.case', { id: shipping.id, kind: 'refund', amountCents: 0, shippingCents: 1000, reason: '仅申请退运费' });
  const caseId = shipping.order.cases[0].id;
  const card = shipping.html().split(`<h2>售后 ${caseId}</h2>`)[1].split('</section>')[0];
  assert.match(card, /仅运费/); assert.doesNotMatch(card, /SKU/);
});
