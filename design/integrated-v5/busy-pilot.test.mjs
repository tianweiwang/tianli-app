import test from 'node:test';
import assert from 'node:assert/strict';
import { seed, reduce } from './engine.mjs';
import { bookingOptions, busyView } from './booking.mjs';

const MIN = 60000, HOUR = MIN * 60;
const time = value => Date.parse(`2026-10-02T${value}:00+08:00`);
const user = { role: 'user', userId: 'u1' }, second = { role: 'user', userId: 'u2' };
const lin = { role: 'tech', techId: 'lin' }, zhou = { role: 'tech', techId: 'zhou' };
const manager = { role: 'manager', storeId: 'xingfu' }, foreign = { role: 'manager', storeId: 'silver' }, group = { role: 'group', job: 'support' };
function harness() {
  let s = seed();
  const run = (actor, type, payload = {}) => { s = reduce(s, actor, type, payload); return s; };
  const now = value => { s.now = typeof value === 'number' ? value : time(value); };
  const input = overrides => ({ storeId: 'xingfu', serviceId: 'relax', regionId: 'home', techId: 'lin', startAt: time('13:00'), mode: 'specified', genderPreference: 'any', contactName: '测试用户', phone: '13800000001', healthConsent: true, identityVerified: true, adultConfirmed: true, requestId: `booking-${s.seq}`, ...overrides });
  const create = (overrides, actor = user) => { run(actor, 'booking.create', input(overrides)); return s.bookings.at(-1); };
  const confirmed = overrides => { const b = create(overrides); run(user, 'booking.pay', { id: b.id, outcome: 'success' }); run({ role: 'tech', techId: b.techId }, 'booking.accept', { id: b.id }); return s.bookings.find(x => x.id === b.id); };
  const busy = (overrides, actor = manager) => { run(actor, 'booking.busy-create', { techId: 'lin', startAt: s.now, endAt: s.now + HOUR, reason: '店内散客服务', requestId: `busy-${s.seq}`, ...overrides }); return s.busyRecords.at(-1); };
  return { get s() { return s; }, run, now, create, input, confirmed, busy, get: id => s.bookings.find(x => x.id === id) };
}

test('schema5无忙碌字段可增量登记，实际开始和代录时间分开留痕', () => {
  const h = harness(); delete h.s.busyRecords;
  const row = h.busy({ startAt: time('08:40') });
  assert.equal(h.s.schema, 5); assert.equal(row.startAt, time('08:40')); assert.equal(row.createdAt, time('09:00'));
  assert.deepEqual(row.createdBy, { role: 'manager', job: null, id: 'xingfu' });
  assert.equal(row.history.length, 1); assert.equal(row.history[0].action, 'create');
  assert.equal(h.s.logs.at(-1).actorId, 'xingfu');
});

test('忙碌登记只限本人和本店，跨店和集团均不能代录；可见范围隔离', () => {
  const h = harness();
  for (const actor of [foreign, group, user, zhou]) assert.throws(() => h.busy({}, actor), /本人|店长/);
  const own = h.busy({}, lin);
  h.busy({ techId: 'ma' }, foreign);
  assert.equal(busyView(h.s, lin).length, 1); assert.equal(busyView(h.s, manager).length, 1);
  assert.equal(busyView(h.s, foreign).length, 1); assert.equal(busyView(h.s, group).length, 2);
  assert.equal(busyView(h.s, { role: 'group', job: 'finance' }).length, 0); assert.deepEqual(busyView(h.s, user), []);
  assert.equal(busyView(h.s, group)[0].canManage, false);
  assert.throws(() => h.run(foreign, 'booking.busy-end', { id: own.id, version: 1, reason: '跨店' }), /无权/);
});

test('重复提交只有一条，内容变化拒绝且不能为同技师叠加未结束事实', () => {
  const h = harness(), row = h.busy({ requestId: 'same' });
  h.busy({ requestId: 'same' });
  assert.equal(h.s.busyRecords.length, 1); assert.equal(h.s.busyRecords[0].history.length, 1);
  assert.throws(() => h.busy({ requestId: 'same', reason: '换了内容' }), /内容已变化/);
  assert.throws(() => h.busy(), /未结束/);
  assert.equal(h.s.busyRecords[0].id, row.id);
});

test('必须登记实际发生的忙碌，开始未来和倒置区间拒绝；允许补登逾期事实', () => {
  const h = harness();
  assert.throws(() => h.busy({ startAt: time('09:30') }), /实际开始/);
  assert.throws(() => h.busy({ endAt: time('09:00') }), /晚于/);
  assert.throws(() => h.busy({ reason: '' }), /原因/);
  const row = h.busy({ startAt: time('08:00'), endAt: time('08:30') });
  assert.equal(busyView(h.s, manager)[0].overdue, true);
  assert.equal(row.endedAt, null);
});

test('候选列表和预约提交都避开忙碌，就近会选择其他技师', () => {
  const h = harness(); h.busy({ endAt: time('14:00') });
  const selection = h.input(); const options = bookingOptions(h.s, selection);
  assert.equal(options.candidates.find(x => x.id === 'lin').available, false);
  assert.match(options.candidates.find(x => x.id === 'lin').reason, /店内忙碌/);
  assert.throws(() => h.create(), /店内忙碌/);
  const chosen = h.create({ mode: 'nearest', techId: undefined }); assert.equal(chosen.techId, 'zhou');
});

test('实际忙碌冲突仍能登记，保留原预约和待确认提案并列出协调对象', () => {
  const h = harness(), b = h.confirmed({ startAt: time('15:00'), techId: 'zhou' });
  h.run(manager, 'booking.propose-reschedule', { id: b.id, techId: 'lin', startAt: time('13:00'), reason: '客户协调' });
  const other = h.confirmed({ startAt: time('17:00') });
  const row = h.busy({ endAt: time('19:00') });
  const view = busyView(h.s, manager)[0];
  assert.deepEqual(new Set(view.conflictingBookingIds), new Set([b.id, other.id]));
  assert.equal(view.conflicts.find(x => x.bookingId === b.id).kind, 'change');
  assert.equal(h.get(b.id).change.status, 'pending'); assert.equal(h.get(other.id).status, 'confirmed');
  assert.deepEqual(new Set(row.history[0].conflictingBookingIds), new Set([b.id, other.id]));
  assert.match(row.events[0].text, /须协调/);
});

test('忙碌阻止技师接单、门店派单、改约提案和用户接受旧提案', () => {
  const h = harness(), b = h.create({ techId: 'zhou' });
  h.run(user, 'booking.pay', { id: b.id, outcome: 'success' });
  h.busy({ endAt: time('14:00') });
  assert.throws(() => h.run(manager, 'booking.assign', { id: b.id, techId: 'lin', reason: '换人' }), /店内忙碌/);
  assert.throws(() => h.run(user, 'booking.reschedule', { id: b.id, techId: 'lin', startAt: time('13:00') }), /店内忙碌/);
  assert.throws(() => h.run(manager, 'booking.propose-reschedule', { id: b.id, techId: 'lin', startAt: time('13:00'), reason: '协调' }), /店内忙碌/);
  const a = harness(), pending = a.create(); a.run(user, 'booking.pay', { id: pending.id, outcome: 'success' }); a.busy({ endAt: time('14:00') });
  assert.throws(() => a.run(lin, 'booking.accept', { id: pending.id }), /店内忙碌/);
  const c = harness(), original = c.confirmed({ startAt: time('15:00') });
  c.run(manager, 'booking.propose-reschedule', { id: original.id, startAt: time('13:00'), reason: '提前' });
  const changeId = c.get(original.id).change.id; c.busy({ endAt: time('14:00') });
  assert.throws(() => c.run(user, 'booking.change-answer', { id: original.id, changeId, decision: 'accept' }), /店内忙碌/);
  assert.equal(c.get(original.id).startAt, time('15:00'));
});

test('预计结束过时不自动空闲，直到明确结束；版本冲突不覆盖他人更改', () => {
  const h = harness(), row = h.busy();
  h.now('10:00');
  assert.equal(busyView(h.s, manager)[0].overdue, true);
  assert.throws(() => h.create({ startAt: time('16:00') }), /超过预计/);
  h.run(lin, 'booking.busy-extend', { id: row.id, endAt: time('11:00'), reason: '店内服务延长', version: 1 });
  assert.equal(h.s.busyRecords[0].version, 2); assert.equal(busyView(h.s, manager)[0].overdue, false);
  assert.throws(() => h.run(manager, 'booking.busy-end', { id: row.id, reason: '旧页提交', version: 1 }), /已更新/);
  h.now('10:20'); h.run(manager, 'booking.busy-end', { id: row.id, reason: '店内服务已结束', version: 2 });
  assert.equal(h.s.busyRecords[0].endedAt, time('10:20')); assert.equal(h.s.busyRecords[0].history.length, 3);
  assert.equal(busyView(h.s, manager)[0].overdue, false); assert.deepEqual(busyView(h.s, manager)[0].conflictingBookingIds, []);
  assert.throws(() => h.run(lin, 'booking.busy-extend', { id: row.id, endAt: time('12:00'), reason: '已结束不能延长', version: 3 }), /已结束/);
  assert.ok(h.create({ startAt: time('16:00') }));
});

test('门店代录的忙碌影响已开始预约加时校验且不擅自中止该预约', () => {
  const h = harness(), b = h.confirmed(); h.now('13:00'); h.run(lin, 'booking.start', { id: b.id });
  h.busy({ endAt: time('15:00') });
  assert.equal(h.get(b.id).status, 'active');
  assert.throws(() => h.run(user, 'booking.extension-create', { id: b.id, requestId: 'busy-extension' }), /店内忙碌/);
  assert.equal(h.get(b.id).extensions.length, 0);
});

test('忙碌登记后加时支付成功无法履行，则保持原时长并为该子单创建原路退款', () => {
  const h = harness(), b = h.confirmed(); h.now('13:00'); h.run(lin, 'booking.start', { id: b.id });
  h.run(user, 'booking.extension-create', { id: b.id, requestId: 'extension' });
  const extensionId = h.get(b.id).extensions[0].id;
  h.busy({ endAt: time('15:00') });
  h.run(user, 'booking.extension-pay', { id: b.id, extensionId, outcome: 'success' });
  assert.equal(h.get(b.id).extensions[0].duration, 0);
  assert.equal(h.get(b.id).refunds[0].lines[0].paymentId, extensionId);
});

test('改约提案保留完整15分钟确认窗口，零窗口拒绝且原预约不变', () => {
  const h = harness(), b = h.confirmed({ startAt: time('15:00') }); h.now('11:00');
  assert.throws(() => h.run(manager, 'booking.propose-reschedule', { id: b.id, startAt: time('13:00'), reason: '提前' }), /完整15分钟/);
  assert.equal(h.get(b.id).change, null); assert.equal(h.get(b.id).startAt, time('15:00'));
  h.now('11:16');
  assert.throws(() => h.run(manager, 'booking.propose-reschedule', { id: b.id, startAt: time('13:30'), reason: '提前' }), /完整15分钟/);
});

test('改约提案最早完整窗口内最后一刻仍能接受，支付轮次从用户确认计算', () => {
  const h = harness(), b = h.confirmed({ startAt: time('15:00') }); h.now('10:45');
  h.run(manager, 'booking.propose-reschedule', { id: b.id, startAt: time('13:00'), reason: '提前' });
  const change = h.get(b.id).change; assert.equal(change.expiresAt, time('11:00'));
  h.now(change.expiresAt - 1);
  h.run(user, 'booking.change-answer', { id: b.id, changeId: change.id, decision: 'accept' });
  assert.equal(h.get(b.id).change.status, 'accepted'); assert.equal(h.get(b.id).startAt, time('13:00'));
  assert.equal(h.get(b.id).round.startedAt, change.expiresAt - 1);
});

test('到改约期限整点不再接受，原安排保留且过期释放候选', () => {
  const h = harness(), b = h.confirmed({ startAt: time('15:00') }); h.now('10:45');
  h.run(manager, 'booking.propose-reschedule', { id: b.id, startAt: time('13:00'), reason: '提前' });
  const change = h.get(b.id).change; h.now(change.expiresAt);
  assert.throws(() => h.run(user, 'booking.change-answer', { id: b.id, changeId: change.id, decision: 'accept' }), /已结束|期限/);
  h.run(manager, 'clock.advance', { minutes: 1 });
  assert.equal(h.get(b.id).change.status, 'expired'); assert.equal(h.get(b.id).startAt, time('15:00'));
});

test('门店提案候选提前15分钟筛选，用户即时自主改约仍保留原两小时边界', () => {
  const h = harness(), b = h.confirmed({ startAt: time('15:00') }); h.now('11:00');
  const selection = { id: b.id, startAt: time('13:00'), techId: 'lin', mode: 'specified' };
  assert.equal(bookingOptions(h.s, selection).valid, true);
  const proposal = bookingOptions(h.s, { ...selection, proposal: true });
  assert.equal(proposal.valid, false); assert.match(proposal.error, /完整15分钟/);
  assert.equal(bookingOptions(h.s, { ...selection, proposal: true, startAt: time('13:30') }).valid, true);
  h.run(user, 'booking.reschedule', selection);
  assert.equal(h.get(b.id).startAt, time('13:00'));
});

test('同秒确认结束允许释放误登事实，原因和原始登记仍在历史且预约未被更改', () => {
  const h = harness(), b = h.confirmed(), before = structuredClone(b), row = h.busy({ endAt: time('14:00') });
  h.run(manager, 'booking.busy-end', { id: row.id, version: 1, reason: '发现误登记，已当场核实空闲' });
  const ended = h.s.busyRecords[0];
  assert.equal(ended.endedAt, ended.startAt); assert.equal(ended.history[0].action, 'create');
  assert.equal(ended.history[1].reason, '发现误登记，已当场核实空闲');
  assert.deepEqual(h.get(b.id), before);
  const view = busyView(h.s, manager); view[0].history[0].reason = '外部修改';
  assert.equal(ended.history[0].reason, '店内散客服务');
});

test('延长不允许缩短或结束在过去，逾期结束保留实际结束而不按预计时间倒填', () => {
  const h = harness(), row = h.busy();
  assert.throws(() => h.run(manager, 'booking.busy-extend', { id: row.id, endAt: time('09:50'), reason: '缩短', version: 1 }), /晚于原预计/);
  h.now('14:00');
  assert.throws(() => h.run(manager, 'booking.busy-extend', { id: row.id, endAt: time('13:00'), reason: '过时', version: 1 }), /当前时间/);
  h.run(manager, 'booking.busy-end', { id: row.id, version: 1, reason: '现已核实结束' });
  assert.equal(h.s.busyRecords[0].endAt, time('10:00')); assert.equal(h.s.busyRecords[0].endedAt, time('14:00'));
});
