import test from 'node:test';
import assert from 'node:assert/strict';
import { bookingSeed, bookingOptions, bookingSlots, bookingSchedule, bookingCommand } from './booking.mjs';

const MIN = 60000, HOUR = 60 * MIN;
const at = value => Date.parse(`${value}+08:00`);
const user = { role: 'user', userId: 'u1' }, lin = { role: 'tech', techId: 'lin' }, group = { role: 'group' };
const store = { role: 'store', storeId: 'xingfu' }, manager = { role: 'manager', storeId: 'xingfu' };
const selection = { storeId: 'xingfu', serviceId: 'relax', regionId: 'home', mode: 'nearest', genderPreference: 'any' };
const work = { start: '09:00', end: '23:00', breakStart: '12:00', breakEnd: '13:00' };
function harness() {
  let s = { ...bookingSeed(), now: at('2026-10-02T09:00'), users: [{ id: 'u1' }], seq: 0, logs: [] };
  const run = (actor, type, payload) => {
    const next = structuredClone(s), ctx = { fail: message => { throw new Error(message); }, id: prefix => `${prefix}${++next.seq}`, log: (entity, text) => { entity.events ??= []; entity.events.push({ text, at: next.now }); next.logs.push({ text, at: next.now, entityId: entity.id }); } };
    const result = bookingCommand(next, actor, type, payload, ctx); s = next; return structuredClone(result);
  };
  const create = (extra = {}) => run(user, 'booking.create', { ...selection, mode: 'specified', techId: 'lin', startAt: at('2026-10-02T13:00'), contactName: '演示预约人', phone: '13800000001', identityVerified: true, healthConsent: true, adultConfirmed: true, requestId: `req-${s.seq}`, ...extra });
  const pay = b => run(user, 'booking.pay', { id: b.id, outcome: 'success' });
  const confirm = b => { pay(b); return run(lin, 'booking.accept', { id: b.id }); };
  const advance = milliseconds => { s.now += milliseconds; run(group, 'booking.tick'); };
  return { get s() { return s; }, run, create, pay, confirm, advance };
}

test('未选时间只评估资格和偏好，不偷用默认时间或当前午休', () => {
  const h = harness(); h.s.now = at('2026-10-02T12:00');
  const snapshot = structuredClone(h.s), result = bookingOptions(h.s, selection);
  assert.equal(result.valid, true); assert.equal(result.selectedTechId, 'lin');
  assert.equal(result.candidates.find(t => t.id === 'chen').available, false);
  assert.match(result.candidates.find(t => t.id === 'chen').reason, /项目/);
  const neck = bookingOptions(h.s, { ...selection, serviceId: 'neck', genderPreference: 'female' });
  assert.equal(neck.selectedTechId, 'chen'); assert.equal(neck.priceCents, 19800); assert.equal(neck.duration, 45);
  assert.deepEqual(h.s, snapshot);
});

test('片区决定附近排序与覆盖，门店或指定技师不匹配不能保留可提交状态', () => {
  const h = harness();
  const result = bookingOptions(h.s, { ...selection, regionId: 'silver', storeId: 'silver' });
  assert.equal(result.stores[0].id, 'silver'); assert.equal(result.stores[0].distanceKm, 0); assert.equal(result.selectedTechId, 'ma');
  const outside = bookingOptions(h.s, { ...selection, regionId: 'outside' });
  assert.equal(outside.valid, false); assert.equal(outside.stores.some(s => s.covered), false);
  assert.equal(bookingOptions(h.s, { ...selection, storeId: 'silver', mode: 'specified', techId: 'lin' }).valid, false);
  assert.equal(bookingOptions(h.s, { ...selection, mode: 'specified' }).valid, false);
});

test('半小时网格统一显示最早时间、午休、夜价及可在营业结束前完成的状态', () => {
  const h = harness(), slots = bookingSlots(h.s, selection, '2026-10-02');
  assert.equal(slots.length, 28); assert.equal(slots[0].time, '09:00'); assert.equal(slots.at(-1).time, '22:30');
  const slot = time => slots.find(x => x.time === time);
  assert.equal(slot('10:30').available, false); assert.match(slot('10:30').reason, /提前 2 小时/);
  assert.equal(slot('11:00').available, true); assert.equal(slot('11:00').techId, 'lin');
  assert.equal(slot('11:30').available, false); assert.match(slot('11:30').reason, /休息/);
  assert.equal(slot('12:30').available, false); assert.equal(slot('13:00').available, true);
  assert.equal(slot('20:30').priceCents, 29800); assert.equal(slot('21:00').priceCents, 32800);
  assert.equal(slot('22:00').available, true); assert.equal(slot('22:30').available, false);
  const neck = bookingSlots(h.s, { ...selection, serviceId: 'neck' }, '2026-10-02');
  assert.equal(neck.find(x => x.time === '21:00').priceCents, 22800);
  assert.equal(neck.find(x => x.time === '22:30').available, false);
  assert.deepEqual(bookingSlots(h.s, selection, '2026-02-30'), []);
  assert.equal(bookingSlots(h.s, selection, '2026-10-10').every(x => !x.available), true);
  h.s.now = at('2026-10-02T15:00');
  const later = bookingSlots(h.s, selection, '2026-10-02');
  assert.equal(later.find(x => x.time === '13:00').available, false);
  assert.equal(later.find(x => x.time === '16:30').available, false);
  assert.equal(later.find(x => x.time === '17:00').available, true);
});

test('所有显示可约时段均可用同一候选提交，下单时再次校验而非信任展示结果', () => {
  const h = harness(), slots = bookingSlots(h.s, selection, '2026-10-02');
  for (const slot of slots) {
    const next = harness();
    if (slot.available) {
      const b = next.create({ mode: 'nearest', techId: slot.techId, startAt: slot.startAt });
      assert.equal(b.priceCents, slot.priceCents); assert.equal(b.techId, slot.techId);
    } else assert.throws(() => next.create({ mode: 'specified', techId: 'lin', startAt: slot.startAt }));
  }
  const selected = slots.find(x => x.time === '13:00');
  h.create();
  assert.throws(() => h.create({ requestId: 'stale', mode: 'nearest', techId: selected.techId }), /变化/);
});

test('占位、请假和偏好共同筛选最近可用技师，查询不改订单和排班', () => {
  const h = harness(), b = h.create();
  const before = structuredClone(h.s), options = bookingOptions(h.s, { ...selection, startAt: b.startAt });
  assert.equal(options.selectedTechId, 'zhou'); assert.match(options.candidates.find(t => t.id === 'lin').reason, /预约|锁定/);
  assert.deepEqual(h.s, before);
  const leave = h.run({ role: 'tech', techId: 'zhou' }, 'booking.leave-request', { startAt: b.startAt, endAt: b.startAt + HOUR, reason: '演示请假' });
  assert.equal(bookingOptions(h.s, { ...selection, startAt: b.startAt }).selectedTechId, 'zhou');
  h.run(manager, 'booking.leave-review', { leaveId: leave.id, decision: 'approve' });
  const blocked = bookingOptions(h.s, { ...selection, startAt: b.startAt });
  assert.equal(blocked.valid, false); assert.match(blocked.candidates.find(t => t.id === 'zhou').reason, /请假/);
});

test('编辑排班权限与起止休息格式在规则层验证，失败不写状态', () => {
  const h = harness();
  for (const actor of [user, { role: 'tech', techId: 'ma' }, { role: 'store', storeId: 'silver' }]) assert.throws(() => h.run(actor, 'booking.schedule-save', { techId: 'lin', ...work }), /无权/);
  for (const extra of [{ start: '08:30' }, { end: '23:30' }, { start: '18:00', end: '12:00' }, { breakEnd: '' }, { breakStart: '08:00' }, { breakStart: '14:00', breakEnd: '13:00' }, { date: '2026-02-30' }, { date: '2026-10-01' }]) assert.throws(() => h.run(lin, 'booking.schedule-save', { ...work, ...extra }));
  assert.deepEqual(bookingSchedule(h.s, 'lin'), work);
  h.run(lin, 'booking.schedule-save', { ...work, start: '10:00' });
  h.run(store, 'booking.schedule-save', { ...work, techId: 'lin', start: '10:30' });
  h.run(group, 'booking.schedule-save', { ...work, techId: 'lin', start: '11:00' });
  assert.equal(bookingSchedule(h.s, 'lin').start, '11:00');
});

test('排班变化同时影响候选和下单，按日期覆盖不会污染其他日期', () => {
  const h = harness();
  h.run(lin, 'booking.schedule-save', { ...work, date: '2026-10-02', breakStart: '13:00', breakEnd: '15:00' });
  assert.equal(bookingSchedule(h.s, 'lin', '2026-10-02').breakEnd, '15:00');
  assert.deepEqual(bookingSchedule(h.s, 'lin', '2026-10-03'), work);
  assert.equal(bookingOptions(h.s, { ...selection, startAt: at('2026-10-02T13:00') }).selectedTechId, 'zhou');
  assert.throws(() => h.create(), /休息/);
  assert.equal(h.create({ startAt: at('2026-10-03T13:00') }).techId, 'lin');
});

test('排班不能排除未支付占位、待确认、已确认和进行中的有效预约', () => {
  for (const stage of ['unpaid', 'waiting', 'confirmed', 'active']) {
    const h = harness(), b = h.create();
    if (stage !== 'unpaid') h.pay(b);
    if (['confirmed', 'active'].includes(stage)) h.run(lin, 'booking.accept', { id: b.id });
    if (stage === 'active') { h.advance(b.startAt - h.s.now); h.run(lin, 'booking.start', { id: b.id }); }
    assert.throws(() => h.run(lin, 'booking.schedule-save', { ...work, breakStart: '13:00', breakEnd: '14:00' }), new RegExp(b.id));
    assert.equal(h.s.bookings[0].status, stage);
    assert.deepEqual(bookingSchedule(h.s, 'lin'), work);
  }
});

test('待确认改约占位及未支付加时均保护排班，不产生新冲突', () => {
  const h = harness(), b = h.create(); h.confirm(b);
  h.run(store, 'booking.propose-reschedule', { id: b.id, techId: 'zhou', startAt: at('2026-10-03T15:00'), reason: '演示改约' });
  assert.throws(() => h.run({ role: 'tech', techId: 'zhou' }, 'booking.schedule-save', { ...work, date: '2026-10-03', end: '15:30' }), /待确认变更/);
  h.run(user, 'booking.change-answer', { id: b.id, changeId: h.s.bookings[0].change.id, decision: 'reject' });
  h.advance(b.startAt - h.s.now); h.run(lin, 'booking.start', { id: b.id });
  h.run(lin, 'booking.extension-create', { id: b.id, requestId: 'extra' });
  assert.throws(() => h.run(lin, 'booking.schedule-save', { ...work, end: '14:00' }), /已有预约/);
});

test('旧 schema 5 无排班兼容无午休，保留既有预约和成人确认历史', () => {
  const h = harness(); delete h.s.schedules;
  assert.equal(bookingSchedule(h.s, 'lin').breakStart, '');
  const b = h.create({ startAt: at('2026-10-02T12:00') });
  delete h.s.bookings[0].adultConfirmed;
  const before = structuredClone(h.s);
  assert.equal(bookingOptions(h.s, { ...selection, id: b.id }).valid, true);
  assert.deepEqual(h.s, before); assert.equal(h.s.schedules, undefined);
  h.pay(b); h.run(lin, 'booking.accept', { id: b.id });
  assert.equal(h.s.bookings[0].status, 'confirmed'); assert.equal(h.s.bookings[0].adultConfirmed, undefined);
  assert.throws(() => h.run(lin, 'booking.schedule-save', work), /已有预约/);
  h.run(lin, 'booking.schedule-save', { ...work, breakStart: '', breakEnd: '' });
  assert.equal(bookingSchedule(h.s, 'lin').breakEnd, '');
});

test('新预约成人确认不可省略，实名与健康告知不能用成人确认替代', () => {
  const h = harness();
  for (const extra of [{ adultConfirmed: undefined }, { adultConfirmed: false }, { identityVerified: false }, { healthConsent: false }]) assert.throws(() => h.create(extra));
  const b = h.create(); assert.equal(b.adultConfirmed, true); assert.equal(b.healthConsent, true); assert.equal(b.identityVerified, true);
});

test('派单当前时段允许进入2小时窗口，换时间仍校验提前量和同价', () => {
  const h = harness(), b = h.create(); h.confirm(b);
  h.advance(b.startAt - h.s.now - 90 * MIN);
  const current = bookingOptions(h.s, { id: b.id, mode: 'nearest' });
  assert.equal(current.valid, true); assert.equal(current.selectedTechId, 'lin');
  const changed = bookingOptions(h.s, { id: b.id, mode: 'nearest', startAt: b.startAt + 30 * MIN });
  assert.equal(changed.valid, true);
  const tooSoon = bookingOptions(h.s, { id: b.id, mode: 'nearest', startAt: b.startAt - 30 * MIN });
  assert.equal(tooSoon.valid, false); assert.match(tooSoon.error, /提前 2 小时/);
  const night = bookingOptions(h.s, { id: b.id, mode: 'nearest', startAt: at('2026-10-02T21:00') });
  assert.equal(night.valid, false); assert.match(night.error, /价格不同/);
});
