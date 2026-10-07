import test from 'node:test';
import assert from 'node:assert/strict';
import { seed, reduce, money } from './engine.mjs';
import { bookingOptions } from './booking.mjs';
import { createBookingDraft, repeatBookingDraft, bookingDraftPayload } from './booking-draft.mjs';
import { customerView } from './customer.mjs';
import { staffView } from './staff.mjs';

const user = { role: 'user', userId: 'u1' }, store = { role: 'store', storeId: 'xingfu' };
const tech = { role: 'tech', techId: 'lin' }, group = { role: 'group' };
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const decode = value => value.replace(/&quot;|&#39;|&lt;|&gt;|&amp;/g, c => ({ '&quot;': '"', '&#39;': "'", '&lt;': '<', '&gt;': '>', '&amp;': '&' }[c]));
const ui = {
  esc, money, query: new URLSearchParams(), date: value => value ? new Date(value).toISOString() : '—',
  link: (label, path, cls = '') => `<a href="#${esc(path)}" class="${esc(cls)}">${label}</a>`,
  button: (label, command, payload = {}, cls = '') => `<button data-command="${esc(command)}" data-payload="${esc(JSON.stringify(payload))}" class="${esc(cls)}">${esc(label)}</button>`,
  field: (label, name, value = '', type = 'text', attrs = '') => `<label>${esc(label)}<input name="${esc(name)}" value="${esc(value)}" type="${esc(type)}" ${attrs}></label>`,
  select: (label, name, options, value) => `<label>${esc(label)}<select name="${esc(name)}">${options.map(o => `<option value="${esc(o.value)}" ${o.value === value ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select></label>`,
  tag: label => `<span>${esc(label)}</span>`, empty: label => `<p>${esc(label)}</p>`
};
function commandPayloads(html, command) {
  return [...html.matchAll(/<(?:form|button)\b[^>]*>/g)].map(([tag]) => {
    const attributes = Object.fromEntries([...tag.matchAll(/([\w-]+)=("[^"]*"|'[^']*')/g)].map(([, name, value]) => [name, decode(value.slice(1, -1))]));
    return attributes['data-command'] === command ? JSON.parse(attributes['data-payload'] || '{}') : null;
  }).filter(Boolean);
}
function fixture(mode = 'specified') {
  let s = seed();
  s.users[0].phone = '13800001234';
  const run = (type, payload, actor = user) => (s = reduce(s, actor, type, payload));
  run('booking.create', { storeId: 'xingfu', serviceId: 'relax', regionId: 'home', techId: 'lin', mode, genderPreference: 'any', startAt: '2026-10-02T13:00', contactName: '上次代约的亲属', phone: '13800009999', adultConfirmed: true, identityVerified: true, healthConsent: true, requestId: 'old-booking' });
  const id = s.bookings.at(-1).id;
  return {
    id, run, get s() { return s; }, get booking() { return s.bookings.find(b => b.id === id); },
    close() { run('booking.cancel', { id, reason: '结束旧预约' }); },
    pay() { run('booking.pay', { id, outcome: 'success' }); },
    accept() { run('booking.accept', { id }, tech); },
    start() { run('clock.advance', { minutes: 240 }); run('booking.start', { id }, tech); },
    finish() { run('clock.advance', { minutes: 60 }); run('booking.finish', { id, mode: 'normal' }, tech); },
    repeat(requestId = 'fresh-repeat') { return repeatBookingDraft(s, 'u1', id, requestId); },
    page() { return customerView(s, user, ['booking', id], ui); }
  };
}

test('I05 再次预约仅允许本人终态订单，拒绝不存在、他人和进行中的历史单', () => {
  const f = fixture();
  assert.throws(() => f.repeat(), /已完成、已取消或已关闭/);
  assert.throws(() => repeatBookingDraft(f.s, 'u2', f.id, 'other-user'), /本人的历史订单/);
  assert.throws(() => repeatBookingDraft(f.s, 'missing', f.id, 'unknown-user'), /本人的历史订单/);
  assert.throws(() => repeatBookingDraft(f.s, 'u1', 'missing', 'missing-booking'), /本人的历史订单/);
  f.pay(); assert.throws(() => f.repeat(), /已完成、已取消或已关闭/);
  f.accept(); assert.throws(() => f.repeat(), /已完成、已取消或已关闭/);
  f.start(); assert.throws(() => f.repeat(), /已完成、已取消或已关闭/);
  f.finish(); assert.equal(f.repeat().next, '/user/booking/slots');
  assert.equal(commandPayloads(f.page(), 'ui.booking-repeat')[0].id, f.id);
});

test('I05 新草稿沿用有效选择，重置时间同意和提交记录，联系人使用本人当前默认', () => {
  const f = fixture(); f.close();
  f.s.now += 86400000;
  f.s.users[0].name = '当前本人姓名';
  const before = structuredClone(f.s), result = f.repeat();
  const draft = result.draft;
  assert.equal(result.next, '/user/booking/slots');
  assert.equal(draft.storeId, 'xingfu'); assert.equal(draft.serviceId, 'relax');
  assert.equal(draft.regionId, 'home'); assert.equal(draft.mode, 'specified'); assert.equal(draft.techId, 'lin');
  assert.equal(draft.requestId, 'fresh-repeat'); assert.equal(draft.submittedId, null);
  assert.equal(draft.startAt, null); assert.equal(draft.date, createBookingDraft(f.s, 'u1', 'new').date);
  assert.equal(draft.contactName, '当前本人姓名'); assert.equal(draft.phone, '13800001234');
  for (const name of ['identityVerified', 'identityConsent', 'adultConfirmed', 'healthConsent']) assert.equal(draft[name], false);
  for (const name of ['id', 'payment', 'priceCents', 'serviceSnapshot', 'rulesSnapshot', 'extensions', 'refunds']) assert.ok(!(name in draft));
  assert.throws(() => bookingDraftPayload(draft), /先选择/);
  assert.deepEqual(f.s, before);
  for (const requestId of ['', 'old-booking']) assert.throws(() => f.repeat(requestId), /新的提交标识/);
});

test('I05 就近历史订单不锁定旧自动分配技师，已付取消可以再次预约', () => {
  const f = fixture('nearest'); f.pay(); f.close();
  assert.equal(f.booking.status, 'cancelled');
  const result = f.repeat();
  assert.equal(result.next, '/user/booking/slots'); assert.equal(result.draft.mode, 'nearest'); assert.equal(result.draft.techId, '');
  assert.equal(f.booking.techId, 'lin');
  assert.equal(commandPayloads(f.page(), 'ui.booking-repeat').length, 1);
});

test('I05 片区门店项目失效分别回到显式选择步骤，不静默换店或换项目', () => {
  for (const scenario of [
    { change: s => { s.regions = s.regions.filter(r => r.id !== 'home'); }, next: 'stores', empty: 'regionId', message: /片区已失效/ },
    { change: s => { s.stores.find(r => r.id === 'xingfu').active = false; }, next: 'stores', empty: 'storeId', message: /原门店/ },
    { change: s => { s.stores.find(r => r.id === 'xingfu').radiusKm = 0; }, next: 'stores', empty: 'storeId', message: /覆盖/ },
    { change: s => { s.services.find(r => r.id === 'relax').active = false; }, next: 'store', empty: 'serviceId', message: /原项目/ },
    { change: s => { s.stores.find(r => r.id === 'xingfu').serviceIds = ['neck']; }, next: 'store', empty: 'serviceId', message: /本店不再提供/ }
  ]) {
    const f = fixture(); f.close(); scenario.change(f.s);
    const result = f.repeat();
    assert.equal(result.next, '/user/booking/' + scenario.next); assert.equal(result.draft[scenario.empty], '');
    assert.match(result.message, scenario.message); assert.notEqual(result.draft.storeId, 'silver'); assert.notEqual(result.draft.serviceId, 'neck');
    assert.equal(result.draft.startAt, null);
  }
});

test('I05 原指定技师停用、转店、资格过期后须重选，不降级为就近安排', () => {
  for (const change of [
    t => { t.active = false; }, t => { t.storeId = 'silver'; },
    t => { t.validUntil = '2026-10-01'; }, t => { t.serviceIds = ['neck']; }
  ]) {
    const f = fixture(); f.close(); change(f.s.techs.find(t => t.id === 'lin'));
    const result = f.repeat();
    assert.equal(result.next, '/user/booking/tech'); assert.equal(result.draft.mode, 'specified');
    assert.equal(result.draft.techId, ''); assert.equal(result.draft.serviceId, 'relax'); assert.match(result.message, /重新确认技师/);
  }
});

test('I05 再次预约按当前项目价格和规则生成新单，原订单快照及款项不变', () => {
  const f = fixture(); f.close();
  const original = structuredClone(f.booking), service = f.s.services.find(v => v.id === 'relax');
  f.run('manage.service-save', { ...service, priceCents: 39800, nightCents: 42800, duration: 90, requestId: 'new-price', reason: '经营调价' }, group);
  const { draft } = f.repeat();
  const ready = { ...draft, recipientId: 'visit', recipientKind: 'self', recipientName: '当次本人', recipientConfirmed: true, startAt: Date.parse('2026-10-03T13:00+08:00'), identityConsent: true, identityVerified: true, adultConfirmed: true, healthConsent: true };
  assert.equal(bookingOptions(f.s, ready).priceCents, 39800);
  f.run('booking.create', bookingDraftPayload(ready));
  const next = f.s.bookings.at(-1);
  assert.notEqual(next.id, f.id); assert.equal(next.requestId, 'fresh-repeat'); assert.equal(next.priceCents, 39800);
  assert.equal(next.duration, 90); assert.equal(next.payment.amountCents, 39800); assert.equal(next.payment.status, 'unpaid');
  assert.equal(next.contactName, f.s.users[0].name); assert.deepEqual(f.booking, original);
  assert.throws(() => f.repeat('fresh-repeat'), /新的提交标识/);
});

test('B04 已支付预约各履约阶段保留普通门店协助，终态再次预约入口与状态一致', () => {
  const f = fixture();
  const check = expectedRepeat => {
    assert.ok(f.page().includes(`/user/booking/${f.id}/contact-store`));
    assert.equal(commandPayloads(f.page(), 'ui.booking-repeat').length, expectedRepeat ? 1 : 0);
  };
  check(false); f.pay(); check(false); f.accept(); check(false); f.start(); check(false); f.finish(); check(true);
  const cancelled = fixture(); cancelled.pay(); cancelled.close();
  assert.ok(cancelled.page().includes(`/user/booking/${cancelled.id}/contact-store`));
  assert.equal(commandPayloads(cancelled.page(), 'ui.booking-repeat').length, 1);
});

test('B04 完成超过两小时安全求助关闭，普通协助可由页面提交并由门店回复', () => {
  const f = fixture(); f.pay(); f.accept(); f.start(); f.finish();
  f.run('clock.advance', { minutes: 181 });
  assert.equal(commandPayloads(f.page(), 'booking.help').length, 0);
  assert.ok(f.page().includes(`/user/booking/${f.id}/contact-store`));
  const contact = customerView(f.s, user, ['booking', f.id, 'contact-store'], ui);
  const payload = commandPayloads(contact, 'booking.assistance-request')[0];
  assert.ok(payload);
  f.run('booking.assistance-request', { ...payload, requestId: 'after-completion-help', reason: '想核对本次预约款项' });
  assert.throws(() => f.run('booking.help', { id: f.id, reason: '超时安全求助' }), /结束后2小时/);
  const work = staffView(f.s, store, ['bookings', f.id], ui);
  const reply = commandPayloads(work, 'booking.assistance-close')[0]; assert.ok(reply);
  f.run('booking.assistance-close', { ...reply, response: '门店已核对款项并说明' }, store);
  assert.match(f.page(), /门店已核对款项并说明/);
  assert.equal(f.booking.assistance[0].status, 'closed'); assert.equal(f.booking.status, 'done'); assert.equal(f.s.safety.length, 0);
});
