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
const support = {role:'group', job:'support'}, warehouse = {role:'group', job:'warehouse'};

test('普通门店协助从用户表单到工作端筛选和回复闭环，安全求助仍受时限约束', () => {
  let s = seed();
  s = reduce(s,user,'booking.create',{requestId:'contact-ui',storeId:'xingfu',serviceId:'relax',regionId:'home',techId:'lin',mode:'specified',genderPreference:'any',startAt:'2026-10-02T13:00',contactName:'测试',phone:'13800000001',healthConsent:true,identityVerified:true,adultConfirmed:true});
  const id=s.bookings.at(-1).id;
  s=reduce(s,user,'booking.pay',{id,outcome:'success'});
  const contact=customerView(s,user,['booking',id,'contact-store'],ui());
  const [payload]=commandPayloads(contact,'booking.assistance-request');
  assert.ok(payload); assert.equal(commandPayloads(contact,'booking.help').length,0);
  s=reduce(s,user,'booking.assistance-request',{...payload,requestId:'contact-request',reason:'请确认时间安排'});
  assert.throws(()=>reduce(s,user,'booking.help',{id,reason:'提前测试安全求助'}),/求助仅在/);
  assert.match(staffView(s,store,['bookings'],ui('status=assistance')),new RegExp(id));
  const [reply]=commandPayloads(staffView(s,store,['bookings',id],ui()),'booking.assistance-close');
  assert.ok(reply);
  for(const actor of [finance,{role:'tech',techId:'lin'}]) {
    const html=staffView(s,actor,['bookings',id],ui());
    assert.doesNotMatch(html,/请确认时间安排/); assert.equal(commandPayloads(html,'booking.assistance-close').length,0);
  }
  s=reduce(s,store,'booking.assistance-close',{...reply,response:'预约保持原时间，门店已跟进'});
  assert.match(customerView(s,user,['booking',id],ui()),/预约保持原时间，门店已跟进/);
  assert.doesNotMatch(staffView(s,store,['bookings'],ui('status=assistance')),new RegExp(id));
  assert.equal(s.bookings[0].status,'waiting'); assert.equal(s.safety.length,0);
});

test('验收申诉页面分离客服裁决与仓储处置，用户可见裁决及等待进度', () => {
  let s=seed();
  const run=(a,t,p)=>(s=reduce(s,a,t,p));
  run(user,'cart.set',{skuId:'oil',qty:1}); run(user,'goods.submit',{requestId:'return-ui',addressId:'AD1'});
  const id=s.goods.at(-1).id;
  run(user,'goods.pay',{id,outcome:'success'}); run(warehouse,'goods.ship',{id,carrier:'演示物流',tracking:'SHIP-1'}); run(user,'goods.receive',{id});
  run(user,'goods.case',{id,requestId:'case-ui',kind:'return',skuId:'oil',qty:1,amountCents:20000,reason:'退货测试'});
  const caseId=s.goods[0].cases[0].id;
  run(support,'goods.case-review',{id,caseId,decision:'approve',reason:'同意寄回'});
  run(user,'goods.return',{id,caseId,carrier:'演示物流',tracking:'RETURN-1'});
  run(warehouse,'goods.inspect',{id,caseId,disposition:'disputed',reason:'验收有分歧'});
  run(user,'goods.appeal',{id,caseId,reason:'请客服核对开箱证据'});
  const supportView=staffView(s,support,['goods',id],ui()), warehouseView=staffView(s,warehouse,['goods',id],ui());
  const [decision]=commandPayloads(supportView,'goods.inspection-resolve');
  assert.ok(decision); assert.equal(commandPayloads(warehouseView,'goods.inspection-resolve').length,0);
  assert.equal(commandPayloads(warehouseView,'goods.inspect').length,0);
  run(support,'goods.inspection-resolve',{...decision,decision:'approve',reason:'证据支持退款'});
  const customer=customerView(s,user,['goods',id],ui());
  assert.match(customer,/客服已同意/); assert.match(customer,/证据支持退款/);
  const [disposition]=commandPayloads(staffView(s,warehouse,['goods',id],ui()),'goods.inspect');
  assert.ok(disposition); assert.equal(commandPayloads(staffView(s,support,['goods',id],ui()),'goods.inspect').length,0);
  run(warehouse,'goods.inspect',{...disposition,disposition:'damaged',reason:'不可售报损'});
  assert.equal(s.goods[0].cases[0].status,'refund_ready');
  const afterDisposition=customerView(s,user,['goods',id],ui());
  assert.match(afterDisposition,/客服复核决定/); assert.match(afterDisposition,/证据支持退款/);
  assert.match(afterDisposition,/仓储处置说明：不可售报损/);
  assert.equal(commandPayloads(staffView(s,warehouse,['goods',id],ui()),'goods.inspect').length,0);
});

test('历史已付款账单独立差异经核查后展示答复，保留付款状态与渠道查询入口', () => {
  const s=seed();
  for(const status of ['paid','processing']) {
    s.bills=[{id:'BILL-legacy',storeId:'xingfu',items:[],amountCents:2000,status,version:2,paymentId:'OUT-legacy',dispute:{status:'open',reason:'原差异尚未核查'},events:[]}];
    const html=staffView(s,finance,['bills','BILL-legacy'],ui());
    assert.match(html,/原差异尚未核查/);
    assert.equal(commandPayloads(html,'bill.resolve').length,1);
    assert.equal(commandPayloads(html,'bill.pay').length,0);
    assert.equal(commandPayloads(html,'bill.query').length,status==='processing'?1:0);
    const [resolvePayload]=commandPayloads(html,'bill.resolve');
    const resolutionReason=`核查 ${status} 账单：已对照推广比例快照，原应付金额正确`;
    const resolved=reduce(s,finance,'bill.resolve',{...resolvePayload,reason:resolutionReason});
    assert.equal(resolved.bills[0].dispute.status,'resolved');
    assert.equal(resolved.bills[0].dispute.resolutionReason,resolutionReason);
    assert.equal(resolved.bills[0].status,status);
    assert.equal(resolved.bills[0].paymentId,'OUT-legacy');
    for(const actor of [finance,store]) {
      const after=staffView(resolved,actor,['bills','BILL-legacy'],ui());
      assert.ok(after.includes(resolutionReason),`${actor.role} 应看见已提交的核查答复`);
      assert.match(after,/原差异尚未核查/);
      assert.equal(commandPayloads(after,'bill.resolve').length,0);
      assert.equal(commandPayloads(after,'bill.pay').length,0);
      assert.equal(commandPayloads(after,'bill.query').length,actor===finance&&status==='processing'?1:0);
    }
  }
});
