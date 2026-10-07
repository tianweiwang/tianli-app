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

const tech = {role:'tech',techId:'lin'}, zhou = {role:'tech',techId:'zhou'}, support = {role:'group',job:'support'};
function formParts(html, command) {
  return [...html.matchAll(/<form\b[^>]*>.*?<\/form>/gs)].map(([form]) => ({ form, payload: commandPayloads(form, command)[0] })).filter(x => x.payload);
}
function selectValues(html, name) {
  const select = html.match(new RegExp(`<select[^>]*name=["']${name}["'][^>]*>([\\s\\S]*?)<\\/select>`))?.[1] || '';
  return [...select.matchAll(/<option\b[^>]*value=["']([^"']*)["']/g)].map(x => decode(x[1]));
}
function fixture() {
  let state = seed();
  return {
    get state() { return state; },
    run(type, payload = {}, actor = user) { state = reduce(state, actor, type, payload); },
    booking(id) { return state.bookings.find(x => x.id === id); },
    staff(actor, id, route = 'bookings', query = '') { return staffView(state, actor, id ? [route,id] : [route], ui(query)); },
    customer(id) { return customerView(state, user, ['booking',id], ui()); },
    advance(minutes) { this.run('clock.advance',{minutes}); },
    create() {
      this.run('booking.create',{requestId:'ui-booking',storeId:'xingfu',serviceId:'relax',regionId:'home',mode:'specified',techId:'lin',startAt:Date.parse('2026-10-02T13:00:00+08:00'),contactName:'界面测试',phone:'13800000000',healthConsent:true,adultConfirmed:true,identityVerified:true});
      const id = state.bookings.at(-1).id; this.run('booking.pay',{id,outcome:'success'}); this.run('booking.accept',{id},tech); return id;
    },
    active() { const id = this.create(); this.advance(240); this.run('booking.start',{id},tech); return id; },
    done() { const id = this.active(); this.advance(60); this.run('booking.finish',{id,mode:'normal'},tech); return id; }
  };
}

test('中止核实界面载荷可创建方案，升级后集团只有offer且用户必须显式接受', () => {
  const f=fixture(), id=f.active(); f.advance(20);
  const stop=formParts(f.staff(tech,id),'booking.stop')[0]; assert.ok(stop);
  f.run('booking.stop',{...stop.payload,category:'health',reason:'用户身体不适'},tech);
  const review=formParts(f.staff(store,id),'booking.dispute-review')[0]; assert.ok(review);
  assert.deepEqual(selectValues(review.form,'responsibility'),['health','non-user']);
  f.run('booking.dispute-review',{...review.payload,responsibility:'health',reason:'实际已服务20分钟'},store);
  let html=f.customer(id), decisions=commandPayloads(html,'booking.refund-answer');
  assert.deepEqual(decisions.map(x=>x.decision).sort(),['accept','escalate']);
  assert.equal(commandPayloads(f.staff(finance,id),'booking.refund-pay').length,0);
  f.run('booking.refund-answer',decisions.find(x=>x.decision==='escalate'));
  const reReview=formParts(f.staff(support,id),'booking.refund-review')[0]; assert.ok(reReview);
  assert.deepEqual(selectValues(reReview.form,'decision'),['offer']);
  f.run('booking.refund-review',{...reReview.payload,decision:'offer',amountCents:19867,reason:'集团核实未服务40分钟'},support);
  decisions=commandPayloads(f.customer(id),'booking.refund-answer');
  assert.deepEqual(decisions.map(x=>x.decision).sort(),['accept','escalate']);
  f.run('booking.refund-answer',decisions.find(x=>x.decision==='accept'));
  const pay=commandPayloads(f.staff(finance,id),'booking.refund-pay'); assert.equal(pay.length,1); assert.equal(pay[0].paymentId,f.booking(id).payment.id);
  f.run('booking.refund-pay',{...pay[0],outcome:'success'},finance);
  assert.equal(f.booking(id).disputes[0].status,'resolved'); assert.match(f.customer(id),/退款成功/);
});

test('逐笔退款界面：成功笔无按钮，失败仅原笔重试，未知仅原笔查询', () => {
  const f=fixture(),id=f.active(); f.run('booking.extension-create',{id,requestId:'ui-extra'}); const ext=f.booking(id).extensions[0]; f.run('booking.extension-pay',{id,extensionId:ext.id,outcome:'success'}); f.advance(90); f.run('booking.finish',{id,mode:'normal'},tech);
  f.run('booking.refund-request',{id,reason:'界面分笔测试',requests:[{paymentId:f.booking(id).payment.id,amountCents:9800},{paymentId:ext.id,amountCents:4900}]});
  const refundId=f.booking(id).refunds[0].id; f.run('booking.refund-review',{id,refundId,decision:'approve',reason:'同意'},store);
  const initial=commandPayloads(f.staff(finance,id),'booking.refund-pay'); assert.equal(initial.length,2);
  f.run('booking.refund-pay',{...initial.find(x=>x.paymentId!==ext.id),outcome:'success'},finance);
  f.run('booking.refund-pay',{...initial.find(x=>x.paymentId===ext.id),outcome:'failed'},finance);
  const afterFailure=f.staff(finance,id),retry=commandPayloads(afterFailure,'booking.refund-pay');
  assert.equal(retry.length,1); assert.equal(retry[0].paymentId,ext.id); assert.match(afterFailure,/原笔重试本款/); assert.equal(commandPayloads(f.staff(support,id),'booking.refund-pay').length,0);
  f.run('booking.refund-pay',{...retry[0],outcome:'processing'},finance);
  const afterPending=f.staff(finance,id); assert.equal(commandPayloads(afterPending,'booking.refund-pay').length,0);
  const query=commandPayloads(afterPending,'booking.refund-query'); assert.equal(query.length,1); assert.equal(query[0].paymentId,ext.id);
  assert.match(f.customer(id),/退款成功/); assert.match(f.customer(id),/退款结果确认中/);
  f.run('booking.refund-query',{...query[0],outcome:'success'},finance);
  assert.equal(commandPayloads(f.staff(finance,id),'booking.refund-pay').length,0); assert.equal(commandPayloads(f.staff(finance,id),'booking.refund-query').length,0);
});

test('求助界面接报及显式争议选择载荷回命令，安全结案后保留独立处理出口', () => {
  const f=fixture(),id=f.active(),help=formParts(f.customer(id),'booking.help')[0]; assert.ok(help);
  f.run('booking.help',{...help.payload,reason:'人员安全但服务有争议'});
  const staffHtml=f.staff(support,id),ack=formParts(staffHtml,'booking.help-ack')[0],close=formParts(staffHtml,'booking.help-close')[0]; assert.ok(ack); assert.ok(close);
  assert.deepEqual(selectValues(close.form,'unresolvedDispute'),['false','true']);
  f.run('booking.help-ack',{...ack.payload,responsibleName:'值班测试'},support); assert.equal(commandPayloads(f.staff(support,id),'booking.help-ack').length,0);
  f.run('booking.help-close',{...close.payload,resolution:'人员安全，服务争议待处理',unresolvedDispute:'true'},support);
  assert.equal(f.state.safety[0].status,'closed'); assert.equal(f.booking(id).disputes[0].status,'open'); assert.match(f.customer(id),/客服处理中/);
  assert.match(f.staff(support,null,'bookings','status=care'),new RegExp(id));
  const separate=formParts(f.staff(support,id),'booking.dispute-close')[0]; assert.ok(separate); f.run('booking.dispute-close',{...separate.payload,resolution:'双方确认争议已解决'},support); assert.equal(f.booking(id).disputes[0].status,'closed');
});

test('改约原新安排及姓名快照展示，后续人员门店改名不修改订单历史', () => {
  const f=fixture(),id=f.create(),old=f.booking(id).startAt;
  f.run('booking.reschedule',{id,startAt:Date.parse('2026-10-03T15:00:00+08:00'),techId:'zhou'});
  f.run('booking.accept',{id},zhou);
  f.advance(1800); f.run('booking.start',{id},zhou); f.advance(60); f.run('booking.finish',{id,mode:'normal'},zhou);
  const t=f.state.techs.find(x=>x.id==='zhou'); f.run('manage.tech-save',{...t,name:'周更名',phone:t.phone||'13800000998',version:t.version,requestId:'rename-ui-history',reason:'检查历史姓名'},group);
  for(const html of [f.customer(id),f.staff(store,id)]) { assert.match(html,/安排变更记录/); assert.match(html,/原安排：林师傅/); assert.match(html,/拟安排：周师傅/); assert.ok(html.includes(new Date(old).toISOString())); assert.doesNotMatch(html,/周更名/); }
});

test('完成后用户求助持续2小时，技师完成后隐藏新求助入口', () => {
  const f=fixture(),id=f.done(); assert.equal(commandPayloads(f.customer(id),'booking.help').length,1); assert.equal(commandPayloads(f.staff(tech,id),'booking.help').length,0);
  f.advance(120); assert.equal(commandPayloads(f.customer(id),'booking.help').length,1); f.advance(1); assert.equal(commandPayloads(f.customer(id),'booking.help').length,0);
  assert.equal(commandPayloads(f.staff(tech,id),'booking.help').length,0);
});

test('求助3+3分钟后用户与技师可见未响应阶段及110入口', () => {
  const f=fixture(),id=f.active(); f.run('booking.help',{id,reason:'升级可见测试'}); f.advance(3);
  assert.match(f.customer(id),/已升级集团/); f.advance(3);
  for(const html of [f.customer(id),f.staff(tech,id)]) { assert.match(html,/升级后仍未响应/); assert.match(html,/href="tel:110"/); }
});
