import test from 'node:test';
import assert from 'node:assert/strict';
import { bookingSeed, bookingCommand, bookingView } from './booking.mjs';

const MIN = 60000, HOUR = 60 * MIN, DAY = 24 * HOUR;
const user = { role: 'user', userId: 'u1' }, other = { role: 'user', userId: 'u2' };
const lin = { role: 'tech', techId: 'lin' }, zhou = { role: 'tech', techId: 'zhou' };
const manager = { role: 'manager', storeId: 'xingfu' }, store = { role: 'store', storeId: 'xingfu' };
const foreign = { role: 'store', storeId: 'silver' }, group = { role: 'group' };
const time = value => Date.parse(`${value}+08:00`);
function harness() {
  let s = { ...bookingSeed(), users: [{ id: 'u1', name: '甲' }, { id: 'u2', name: '乙' }], now: time('2026-10-02T09:00'), seq: 0, logs: [] };
  const run = (actor, type, p = {}) => {
    const next = structuredClone(s), ctx = { fail: text => { throw new Error(text); }, id: prefix => `${prefix}${++next.seq}`, log: (entity, text) => { const e = { at: next.now, actor: actor.role, text }; entity.events ??= []; entity.events.push(e); next.logs.push({ ...e, entityId: entity.id }); } };
    const result = bookingCommand(next, actor, type, p, ctx); s = next; return structuredClone(result);
  };
  const advance = ms => { s.now += ms; return run(group, 'booking.tick'); };
  const input = (extra = {}) => ({ storeId: 'xingfu', serviceId: 'relax', regionId: 'home', techId: 'lin', startAt: time('2026-10-02T13:00'), mode: 'specified', genderPreference: 'any', contactName: '测试顾客', phone: '13800000001', healthConsent: true, identityVerified: true, adultConfirmed: true, requestId: `req-${s.seq}`, ...extra });
  const create = (extra, actor = user) => run(actor, 'booking.create', input(extra));
  const pay = (b, actor = user) => run(actor, 'booking.pay', { id: b.id, outcome: 'success' });
  const confirmed = extra => { const b = create(extra); pay(b); return run(lin, 'booking.accept', { id: b.id }); };
  const active = extra => { const b = confirmed(extra); advance(b.startAt - s.now); return run(lin, 'booking.start', { id: b.id }); };
  const done = extra => { const b = active(extra); advance(b.duration * MIN); return run(lin, 'booking.finish', { id: b.id, mode: 'normal' }); };
  return { get s() { return s; }, run, advance, input, create, pay, confirmed, active, done, get: id => s.bookings.find(x => x.id === id) };
}

test('多单唯一编号、提交幂等、每个用户可见数据隔离', () => {
  const h = harness(), b = h.create({ requestId: 'same' });
  assert.equal(h.create({ requestId: 'same' }).id, b.id);
  const c = h.create({ techId: 'zhou', requestId: 'same' }, other);
  assert.notEqual(c.id, b.id); assert.equal(h.s.bookings.length, 2);
  assert.deepEqual(bookingView(h.s, user).map(x => x.id), [b.id]);
  assert.deepEqual(bookingView(h.s, other).map(x => x.id), [c.id]);
  assert.equal(bookingView(h.s, foreign).length, 0); assert.equal(bookingView(h.s, group).length, 2);
  const view = bookingView(h.s, user); view[0].phone = 'changed'; assert.equal(h.get(b.id).phone, '13800000001');
});

test('外用户、外店和非本单技师不能付款、取消、确认或读详情', () => {
  const h = harness(), b = h.create();
  for (const actor of [other, foreign, zhou]) assert.throws(() => h.run(actor, 'booking.cancel', { id: b.id, reason: '越权' }), /无权|本人|门店/);
  assert.throws(() => h.pay(b, other), /无权/); h.pay(b);
  assert.throws(() => h.run(zhou, 'booking.accept', { id: b.id }), /无权/);
  assert.throws(() => h.run(group, 'booking.assign', { id: b.id, techId: 'lin' }), /无权/);
});

test('资格、门店、偏好、实名健康和手机号都是规则层约束', () => {
  const h = harness();
  for (const extra of [{ healthConsent: false }, { identityVerified: false }, { adultConfirmed: false }, { phone: '123' }, { techId: 'chen' }, { techId: 'ma' }, { genderPreference: 'female' }, { regionId: 'outside' }, { storeId: 'unknown' }]) assert.throws(() => h.create(extra));
  assert.equal(h.s.bookings.length, 0);
});

test('就近按片区距离选择具体合格技师，指定信息不符不能偷偷换人', () => {
  const h = harness(), b = h.create({ mode: 'nearest', techId: undefined });
  assert.equal(b.techId, 'lin');
  assert.throws(() => h.create({ mode: 'nearest', techId: 'lin' }, other), /变化/);
  const c = h.create({ mode: 'nearest', techId: undefined }, other); assert.equal(c.techId, 'zhou');
});

test('时段锁含前后缓冲、付款关闭后释放并支持多日', () => {
  const h = harness(), b = h.create();
  assert.throws(() => h.create({}, other), /已被/);
  assert.throws(() => h.create({ startAt: time('2026-10-02T14:30') }, other), /已被/);
  h.create({ startAt: time('2026-10-02T15:00') }, other);
  h.run(user, 'booking.cancel', { id: b.id, reason: '重新选择' });
  h.create({ requestId: 'after-close' });
  h.create({ startAt: time('2026-10-03T13:00'), requestId: 'next-day' });
  assert.equal(h.s.bookings.length, 4);
});

test('最早最远、半小时粒度和营业结束校验', () => {
  const h = harness();
  for (const value of ['2026-10-02T10:30', '2026-10-10T13:00', '2026-10-02T13:15', '2026-10-02T22:30']) assert.throws(() => h.create({ startAt: time(value) }));
  assert.equal(h.create({ startAt: '2026-10-02T11:00' }).startAt, time('2026-10-02T11:00'));
});

test('肩颈夜价228/舒缓夜价328，提交后价格快照不变', () => {
  const h = harness(), n = h.create({ serviceId: 'neck', startAt: time('2026-10-02T21:00') });
  assert.equal(n.priceCents, 22800);
  const r = h.create({ techId: 'zhou', startAt: time('2026-10-02T21:00') }, other); assert.equal(r.priceCents, 32800);
  h.s.services.find(x => x.id === 'neck').nightCents = 99900;
  h.pay(n); assert.equal(h.get(n.id).payment.amountCents, 22800);
});

test('支付15分钟到期关闭、无退款；未知结果必须先查询且保留资源', () => {
  const h = harness(), b = h.create(); h.advance(15 * MIN);
  assert.equal(h.get(b.id).status, 'closed'); assert.equal(h.get(b.id).refunds.length, 0);
  assert.throws(() => h.pay(b), /截止/);
  const c = h.create({ requestId: 'unknown' }); h.run(user, 'booking.pay', { id: c.id, outcome: 'processing' }); h.advance(16 * MIN);
  assert.equal(h.get(c.id).status, 'unpaid'); assert.throws(() => h.run(user, 'booking.cancel', { id: c.id, reason: '取消' }), /查询/);
  assert.throws(() => h.pay(c), /查询/); assert.throws(() => h.create({}, other), /已被/);
  h.run(user, 'booking.payment-query', { id: c.id, outcome: 'failed' }); assert.equal(h.get(c.id).status, 'closed');
});

test('晚到支付：空位恢复；已被占用自动全额退款，重复查询不重复', () => {
  const h = harness(), a = h.create(); h.advance(16 * MIN);
  h.run(user, 'booking.payment-query', { id: a.id, outcome: 'success' }); assert.equal(h.get(a.id).status, 'waiting');
  const k = harness(), b = k.create(); k.advance(16 * MIN); k.create({}, other);
  k.run(user, 'booking.payment-query', { id: b.id, outcome: 'success' });
  assert.equal(k.get(b.id).status, 'cancelled'); assert.equal(k.get(b.id).refunds[0].amountCents, 29800);
  k.run(user, 'booking.payment-query', { id: b.id, outcome: 'success' }); assert.equal(k.get(b.id).refunds.length, 1);
});

test('首次派单轮固定、10分钟转门店、重复候选请求不延长', () => {
  const h = harness(), b = h.create(); h.pay(b); const deadline = h.get(b.id).round.deadline;
  h.advance(10 * MIN); assert.equal(h.get(b.id).confirmationPhase, 'store');
  assert.throws(() => h.run(lin, 'booking.accept', { id: b.id }), /超时/);
  h.run(manager, 'booking.assign', { id: b.id, techId: 'zhou', reason: '调整' });
  const changeId = h.get(b.id).change.id;
  h.advance(2 * MIN); h.run(manager, 'booking.assign', { id: b.id, techId: 'zhou', reason: '再次' });
  assert.equal(h.get(b.id).round.deadline, deadline); assert.equal(h.get(b.id).change.id, changeId);
  h.run(user, 'booking.change-answer', { id: b.id, changeId, decision: 'accept' });
  assert.equal(h.get(b.id).status, 'confirmed'); assert.equal(h.get(b.id).round.deadline, deadline); assert.equal(h.get(b.id).rounds.length, 1);
});

test('门店派单直接确认，原技师拒绝与派单不额外重开轮次', () => {
  const h = harness(), b = h.create({ mode: 'nearest', techId: undefined }); h.pay(b);
  h.run(lin, 'booking.reject', { id: b.id, reason: '个人原因' }); const deadline = h.get(b.id).round.deadline;
  h.run(manager, 'booking.assign', { id: b.id, techId: 'zhou' });
  assert.equal(h.get(b.id).status, 'confirmed'); assert.equal(h.get(b.id).techId, 'zhou'); assert.equal(h.get(b.id).round.deadline, deadline);
  h.advance(60 * MIN); assert.equal(h.get(b.id).status, 'confirmed');
});

test('派单30分钟自动取消，渠道失败→重试→未知查询幂等', () => {
  const h = harness(), b = h.create(); h.pay(b); h.advance(30 * MIN);
  assert.equal(h.get(b.id).status, 'cancelled'); assert.equal(h.get(b.id).refunds[0].status, 'approved');
  assert.throws(() => h.run(manager, 'booking.assign', { id: b.id, techId: 'lin' }), /状态/);
  const refundId = h.get(b.id).refunds[0].id;
  h.run(store, 'booking.refund-pay', { id: b.id, refundId, outcome: 'failed' });
  h.run(store, 'booking.refund-pay', { id: b.id, refundId, outcome: 'processing' });
  assert.throws(() => h.run(store, 'booking.refund-pay', { id: b.id, refundId, outcome: 'success' }), /未知/);
  h.run(group, 'booking.refund-query', { id: b.id, refundId, outcome: 'success' });
  h.run(group, 'booking.refund-query', { id: b.id, refundId, outcome: 'success' });
  assert.equal(h.get(b.id).payment.refundedCents, 29800); assert.equal(bookingView(h.s, user)[0].fundStatus, '全额退款');
});

test('用户改约一次，同价同店，新轮始于确认时且首次支付不变', () => {
  const h = harness(), b = h.confirmed(); h.advance(20 * MIN); const firstPaid = h.get(b.id).firstPaidAt;
  assert.throws(() => h.run(user, 'booking.reschedule', { id: b.id, startAt: b.startAt, techId: b.techId }), /相同/);
  assert.throws(() => h.run(manager, 'booking.propose-reschedule', { id: b.id, startAt: b.startAt, techId: b.techId, reason: '未实际变更' }), /相同/);
  h.run(user, 'booking.reschedule', { id: b.id, startAt: time('2026-10-03T13:00'), techId: 'zhou' });
  assert.equal(h.get(b.id).status, 'waiting'); assert.equal(h.get(b.id).round.startedAt, h.s.now); assert.equal(h.get(b.id).round.deadline, h.s.now + 30 * MIN); assert.equal(h.get(b.id).firstPaidAt, firstPaid);
  assert.throws(() => h.run(user, 'booking.reschedule', { id: b.id, startAt: time('2026-10-04T13:00') }), /一次/);
  const k = harness(), c = k.confirmed();
  assert.throws(() => k.run(user, 'booking.reschedule', { id: c.id, startAt: time('2026-10-02T21:00') }), /价格/);
  assert.throws(() => k.run(user, 'booking.reschedule', { id: c.id, startAt: time('2026-10-03T13:00'), techId: 'ma' }), /本店/);
});

test('门店改约提案占新时段但不改原约；拒绝/过期保留原约且不扣自主次数', () => {
  const h = harness(), b = h.confirmed(), oldRound = h.get(b.id).round.id;
  const proposal = { id: b.id, startAt: time('2026-10-03T13:00'), techId: 'zhou', reason: '调整排班' };
  h.run(manager, 'booking.propose-reschedule', proposal);
  assert.equal(h.get(b.id).startAt, time('2026-10-02T13:00')); assert.equal(h.get(b.id).round.id, oldRound);
  assert.throws(() => h.create({ techId: 'zhou', startAt: proposal.startAt }, other), /变更/);
  h.run(user, 'booking.change-answer', { id: b.id, changeId: h.get(b.id).change.id, decision: 'reject' });
  assert.equal(h.get(b.id).status, 'confirmed'); assert.equal(h.get(b.id).userReschedules, 0);
  h.run(manager, 'booking.propose-reschedule', proposal); h.advance(15 * MIN);
  assert.equal(h.get(b.id).status, 'confirmed'); assert.equal(h.get(b.id).change.status, 'expired');
});

test('门店改约由本人确认后新轮重新确认，跨用户确认失败', () => {
  const h = harness(), b = h.confirmed(); h.run(manager, 'booking.propose-reschedule', { id: b.id, startAt: time('2026-10-03T13:00'), techId: 'zhou', reason: '排班' });
  const args = { id: b.id, changeId: h.get(b.id).change.id, decision: 'accept' };
  assert.throws(() => h.run(other, 'booking.change-answer', args), /无权/);
  h.advance(5 * MIN); h.run(user, 'booking.change-answer', args);
  assert.equal(h.get(b.id).techId, 'zhou'); assert.equal(h.get(b.id).status, 'waiting'); assert.equal(h.get(b.id).round.startedAt, h.s.now); assert.equal(h.get(b.id).rounds.length, 2);
});

test('已确认指定改派接受后直接确认、新轮已完成，拒绝全退', () => {
  const h = harness(), b = h.confirmed(); h.advance(5 * MIN);
  h.run(manager, 'booking.assign', { id: b.id, techId: 'zhou', reason: '排班' }); h.advance(3 * MIN);
  h.run(user, 'booking.change-answer', { id: b.id, changeId: h.get(b.id).change.id, decision: 'accept' });
  assert.equal(h.get(b.id).status, 'confirmed'); assert.equal(h.get(b.id).round.startedAt, h.s.now); assert.equal(h.get(b.id).round.completedAt, h.s.now);
  const k = harness(), c = k.confirmed(); k.run(manager, 'booking.assign', { id: c.id, techId: 'zhou', reason: '排班' });
  k.run(user, 'booking.change-answer', { id: c.id, changeId: k.get(c.id).change.id, decision: 'reject' }); assert.equal(k.get(c.id).status, 'cancelled');
});

test('未完成轮的指定改派等待不得超出当前轮截止，确认不能救活过期单', () => {
  const h = harness(), b = h.create(); h.pay(b); h.advance(27 * MIN);
  h.run(manager, 'booking.assign', { id: b.id, techId: 'zhou', reason: '候选' }); const changeId = h.get(b.id).change.id;
  assert.equal(h.get(b.id).change.expiresAt, h.get(b.id).round.deadline); h.advance(3 * MIN);
  assert.equal(h.get(b.id).status, 'cancelled'); assert.throws(() => h.run(user, 'booking.change-answer', { id: b.id, changeId, decision: 'accept' }), /结束/);
});

test('已过开始前60分钟的新改派轮立即取消，无额外30分钟', () => {
  const h = harness(), b = h.confirmed(); h.advance(3 * HOUR + 5 * MIN);
  h.run(manager, 'booking.assign', { id: b.id, techId: 'zhou', reason: '紧急调整' });
  h.run(user, 'booking.change-answer', { id: b.id, changeId: h.get(b.id).change.id, decision: 'accept' });
  assert.equal(h.get(b.id).status, 'cancelled'); assert.equal(h.get(b.id).round.deadline, time('2026-10-02T12:00'));
});

test('开始须到预约时间，正常完成校验分钟，提前结束需理由且不自动退款', () => {
  const h = harness(), b = h.confirmed(); assert.throws(() => h.run(lin, 'booking.start', { id: b.id }), /时间/);
  h.advance(4 * HOUR); h.run(lin, 'booking.start', { id: b.id }); h.advance(30 * MIN);
  assert.throws(() => h.run(lin, 'booking.finish', { id: b.id, mode: 'normal' }), /还差 30/);
  assert.throws(() => h.run(lin, 'booking.finish', { id: b.id, mode: 'early' }), /原因/);
  h.run(lin, 'booking.finish', { id: b.id, mode: 'early', reason: '用户要求提前结束' });
  assert.equal(h.get(b.id).status, 'done'); assert.equal(h.get(b.id).refunds.length, 0); assert.equal(h.get(b.id).completedAt, h.s.now);
});

test('加时30分钟锁5分钟，独立支付且正常完成包含已付时长', () => {
  const h = harness(), b = h.active(); const x = h.run(user, 'booking.extension-create', { id: b.id, requestId: 'e1' });
  assert.equal(x.amountCents, 14900); assert.equal(h.run(user, 'booking.extension-create', { id: b.id, requestId: 'e1' }).id, x.id);
  h.run(user, 'booking.extension-pay', { id: b.id, extensionId: x.id, outcome: 'success' }); h.advance(60 * MIN);
  assert.throws(() => h.run(lin, 'booking.finish', { id: b.id, mode: 'normal' }), /还差 30/);
  h.advance(30 * MIN); h.run(lin, 'booking.finish', { id: b.id, mode: 'normal' }); assert.equal(bookingView(h.s, user)[0].paidCents, 44700);
});

test('过期加时不计时长，未支付占位与后续订单冲突，并限制最多两次', () => {
  const h = harness(), b = h.active(); let x = h.run(user, 'booking.extension-create', { id: b.id, requestId: 'e1' }); h.advance(5 * MIN);
  assert.equal(h.get(b.id).extensions[0].status, 'expired'); assert.equal(bookingView(h.s, user)[0].totalDuration, 60);
  for (const requestId of ['e2', 'e3']) { x = h.run(user, 'booking.extension-create', { id: b.id, requestId }); h.run(user, 'booking.extension-pay', { id: b.id, extensionId: x.id, outcome: 'success' }); }
  assert.throws(() => h.run(user, 'booking.extension-create', { id: b.id, requestId: 'e4' }), /两次/);
  const k = harness(), c = k.confirmed(), next = k.create({ startAt: time('2026-10-02T15:00') }, other); k.pay(next, other); k.run(lin, 'booking.accept', { id: next.id }); k.advance(4 * HOUR); k.run(lin, 'booking.start', { id: c.id });
  assert.throws(() => k.run(user, 'booking.extension-create', { id: c.id, requestId: 'conflict' }), /已被/);
});

test('未知加时锁定持续，结束前须查询；晚到成功冲突自动退款且不增加时长', () => {
  const h = harness(), b = h.active(), x = h.run(user, 'booking.extension-create', { id: b.id, requestId: 'e1' });
  h.run(user, 'booking.extension-pay', { id: b.id, extensionId: x.id, outcome: 'processing' }); h.advance(6 * MIN);
  assert.throws(() => h.run(lin, 'booking.finish', { id: b.id, mode: 'early', reason: '结束' }), /查询/);
  h.run(user, 'booking.extension-query', { id: b.id, extensionId: x.id, outcome: 'failed' });
  h.run(lin, 'booking.finish', { id: b.id, mode: 'early', reason: '结束' });
  h.run(user, 'booking.extension-query', { id: b.id, extensionId: x.id, outcome: 'success' });
  assert.equal(h.get(b.id).extensions[0].duration, 0); assert.equal(h.get(b.id).refunds[0].amountCents, 14900); assert.equal(h.get(b.id).status, 'done');
});

test('紧急请假仅本人重叠已确认未开始单入池，普通/重复批准不改期限', () => {
  const h = harness(), a = h.confirmed(), b = h.create({ startAt: time('2026-10-03T13:00') }); h.pay(b); h.run(lin, 'booking.accept', { id: b.id });
  const z = h.create({ techId: 'zhou' }, other); h.pay(z, other); h.run(zhou, 'booking.accept', { id: z.id });
  const l = h.run(lin, 'booking.leave-request', { startAt: time('2026-10-02T12:00'), endAt: time('2026-10-02T15:00'), reason: '紧急', emergency: true });
  assert.throws(() => h.run(foreign, 'booking.leave-review', { leaveId: l.id, decision: 'approve' }), /无权/);
  h.run(manager, 'booking.leave-review', { leaveId: l.id, decision: 'approve' });
  assert.equal(h.get(a.id).confirmationPhase, 'store'); assert.equal(h.get(b.id).status, 'confirmed'); assert.equal(h.get(z.id).status, 'confirmed');
  const deadline = h.get(a.id).round.deadline; h.advance(5 * MIN); h.run(manager, 'booking.leave-review', { leaveId: l.id, decision: 'approve' }); assert.equal(h.get(a.id).round.deadline, deadline);
  assert.throws(() => h.run(manager, 'booking.assign', { id: a.id, techId: 'lin' }), /请假/);
  const k = harness(); k.confirmed(); const normal = k.run(lin, 'booking.leave-request', { startAt: time('2026-10-02T12:00'), endAt: time('2026-10-02T15:00'), reason: '普通' }); assert.throws(() => k.run(manager, 'booking.leave-review', { leaveId: normal.id, decision: 'approve' }), /先处理/);
});

test('服务中、已完成、已有出发事实的订单请假批准不回退', () => {
  for (const stage of ['active', 'done', 'departed', 'arrived']) {
    const h = harness(), b = stage === 'done' ? h.done() : stage === 'active' ? h.active() : h.confirmed();
    if (stage === 'departed') h.get(b.id).departedAt = h.s.now; if (stage === 'arrived') h.get(b.id).arrivedAt = h.s.now;
    const oldStatus = h.get(b.id).status, oldRound = h.get(b.id).round.id;
    const l = h.run(lin, 'booking.leave-request', { startAt: time('2026-10-02T12:00'), endAt: time('2026-10-02T18:00'), reason: '紧急', emergency: true }); h.run(manager, 'booking.leave-review', { leaveId: l.id, decision: 'approve' });
    assert.equal(h.get(b.id).status, oldStatus); assert.equal(h.get(b.id).round.id, oldRound);
  }
});

test('求助期间实际完成、分笔退款和多事件结案不覆盖终态或其他阻断', () => {
  const h = harness(), b = h.active(), a = h.run(user, 'booking.help', { id: b.id, reason: '请客服协助' }), c = h.run(lin, 'booking.help', { id: b.id, reason: '补充求助' });
  assert.equal(bookingView(h.s, user)[0].displayStatus, '客服处理中');
  h.advance(HOUR); h.run(lin, 'booking.finish', { id: b.id, mode: 'normal' }); const completedAt = h.get(b.id).completedAt;
  h.run(manager, 'booking.help-close', { safetyId: a.id, resolution: '一项已处理', unresolvedDispute: false }); assert.equal(bookingView(h.s, user)[0].settlementBlocked, true);
  const r = h.run(user, 'booking.refund-request', { id: b.id, reason: '服务质量', requests: [{ paymentId: b.payment.id, amountCents: 10000 }] });
  h.run(manager, 'booking.refund-review', { id: b.id, refundId: r.id, decision: 'approve', reason: '同意' }); h.run(store, 'booking.refund-pay', { id: b.id, refundId: r.id, outcome: 'success' });
  h.run(group, 'booking.help-close', { safetyId: c.id, resolution: '全部处理', unresolvedDispute: false });
  assert.equal(h.get(b.id).status, 'done'); assert.equal(h.get(b.id).completedAt, completedAt); assert.equal(bookingView(h.s, user)[0].fundStatus, '部分退款'); assert.equal(bookingView(h.s, user)[0].settlementBlocked, false);
});

test('主单/加时退款协商最大余数精确到分，失败重试明细锁定且累计有界', () => {
  const h = harness(), b = h.active(), x = h.run(user, 'booking.extension-create', { id: b.id, requestId: 'e1' }); h.run(user, 'booking.extension-pay', { id: b.id, extensionId: x.id, outcome: 'success' });
  h.advance(90 * MIN); h.run(lin, 'booking.finish', { id: b.id, mode: 'normal' });
  const r = h.run(user, 'booking.refund-request', { id: b.id, reason: '协商退款', requests: [{ paymentId: b.payment.id, amountCents: 20000 }, { paymentId: x.id, amountCents: 10000 }] });
  assert.throws(() => h.run(manager, 'booking.refund-review', { id: b.id, refundId: r.id, decision: 'approve', amountCents: 10001, reason: '部分' }), /协商/);
  h.run(manager, 'booking.refund-review', { id: b.id, refundId: r.id, decision: 'offer', amountCents: 10001, reason: '协商' });
  assert.deepEqual(h.get(b.id).refunds[0].lines.map(x => x.amountCents), [6667, 3334]);
  h.run(user, 'booking.refund-answer', { id: b.id, refundId: r.id, version: h.get(b.id).refunds.find(x => x.id === r.id).version, decision: 'accept' }); const lines = structuredClone(h.get(b.id).refunds[0].lines);
  h.run(store, 'booking.refund-pay', { id: b.id, refundId: r.id, outcome: 'failed' }); h.run(group, 'booking.refund-pay', { id: b.id, refundId: r.id, outcome: 'success' }); h.run(group, 'booking.refund-query', { id: b.id, refundId: r.id, outcome: 'success' });
  assert.deepEqual(h.get(b.id).refunds[0].lines, lines); assert.equal(bookingView(h.s, user)[0].refundedCents, 10001);
  assert.throws(() => h.run(user, 'booking.refund-request', { id: b.id, reason: '超额', requests: [{ paymentId: b.payment.id, amountCents: 23134 }] }), /超过/);
  h.run(user, 'booking.refund-request', { id: b.id, reason: '再次', requests: [{ paymentId: b.payment.id, amountCents: 23133 }] });
});

test('售后撤销、驳回确认、集团介入、24/48小时期限和48小时受理边界', () => {
  const h = harness(), b = h.done();
  const request = () => h.run(user, 'booking.refund-request', { id: b.id, reason: '质量', requests: [{ paymentId: b.payment.id, amountCents: 10000 }] });
  let r = request(); h.run(user, 'booking.refund-answer', { id: b.id, refundId: r.id, decision: 'withdraw' }); assert.equal(h.get(b.id).refunds[0].status, 'withdrawn');
  r = request(); h.run(manager, 'booking.refund-review', { id: b.id, refundId: r.id, decision: 'reject', reason: '不符' }); assert.equal(bookingView(h.s, user)[0].settlementBlocked, true);
  h.run(user, 'booking.refund-answer', { id: b.id, refundId: r.id, decision: 'escalate' });
  assert.throws(() => h.run(manager, 'booking.refund-review', { id: b.id, refundId: r.id, decision: 'approve', reason: '同意' }), /集团/);
  h.run(group, 'booking.refund-review', { id: b.id, refundId: r.id, decision: 'approve', amountCents: 9000, reason: '裁决' }); assert.equal(h.get(b.id).refunds.at(-1).status, 'approved');
  const k = harness(), c = k.done(), q = k.run(user, 'booking.refund-request', { id: c.id, reason: '质量', requests: [{ paymentId: c.payment.id, amountCents: 10000 }] }); k.advance(DAY); assert.equal(k.get(c.id).refunds[0].status, 'escalated'); k.advance(2 * DAY); assert.ok(k.get(c.id).refunds[0].overdueAt); k.run(group, 'booking.refund-review', { id: c.id, refundId: q.id, decision: 'reject', reason: '终审' });
  assert.throws(() => k.run(user, 'booking.refund-request', { id: c.id, reason: '超期', requests: [{ paymentId: c.payment.id, amountCents: 100 }] }), /48/);
});

test('退款处理中额度预留、外店不能处理退款与求助，失败不污染原状态', () => {
  const h = harness(), b = h.done(), r = h.run(user, 'booking.refund-request', { id: b.id, reason: '质量', requests: [{ paymentId: b.payment.id, amountCents: 20000 }] });
  h.run(manager, 'booking.refund-review', { id: b.id, refundId: r.id, decision: 'approve', reason: '同意' });
  assert.throws(() => h.run(user, 'booking.refund-request', { id: b.id, reason: '重复额度', requests: [{ paymentId: b.payment.id, amountCents: 10000 }] }), /超过/);
  const snapshot = JSON.stringify(h.s); assert.throws(() => h.run(foreign, 'booking.refund-pay', { id: b.id, refundId: r.id, outcome: 'success' }), /无权/); assert.equal(JSON.stringify(h.s), snapshot);
  const help = h.run(user, 'booking.help', { id: b.id, reason: '补充' }); assert.throws(() => h.run(foreign, 'booking.help-close', { safetyId: help.id, resolution: '越权' }), /无权/);
});
