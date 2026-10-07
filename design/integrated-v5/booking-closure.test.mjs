import test from 'node:test';
import assert from 'node:assert/strict';
import { bookingSeed, bookingCommand, bookingView, bookingCanHelp, upgradeBookings } from './booking.mjs';

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

test('F01 上单未结束禁止同技师同时开始，实际结束后可继续', () => {
  const h = harness(), a = h.confirmed(), b = h.create({ startAt: time('2026-10-02T15:00') }, other);
  h.pay(b, other); h.run(lin, 'booking.accept', { id: b.id }); h.advance(4 * HOUR); h.run(lin, 'booking.start', { id: a.id }); h.advance(2 * HOUR);
  assert.throws(() => h.run(lin, 'booking.start', { id: b.id }), new RegExp(a.id));
  assert.throws(() => h.create({ startAt: time('2026-10-03T15:00') }), /已被/);
  assert.equal(h.get(b.id).status, 'confirmed');
  h.run(lin, 'booking.finish', { id: a.id, mode: 'normal' }); h.run(lin, 'booking.start', { id: b.id });
  assert.equal(h.get(b.id).status, 'active'); assert.equal(h.s.bookings.filter(x => x.status === 'active').length, 1);
});

test('安全15+10分钟监护及求助3+3分钟升级，接报和安全结案有独立记录', () => {
  const h = harness(), b = h.active(); h.advance(75 * MIN);
  assert.equal(h.get(b.id).supervision.status, 'reminded'); assert.equal(h.s.safety.length, 0);
  h.advance(10 * MIN); assert.equal(h.get(b.id).supervision.status, 'escalated');
  const id = h.s.safety[0].id; h.advance(3 * MIN); assert.equal(h.s.safety[0].stage, 'escalated');
  h.advance(3 * MIN); assert.equal(h.s.safety[0].stage, 'unanswered'); assert.equal(h.s.safety[0].emergencyNumber, '110');
  h.run(manager, 'booking.help-ack', { safetyId: id, responsibleName: '值班甲' }); assert.equal(h.s.safety[0].stage, 'acknowledged');
  assert.throws(() => h.run(manager, 'booking.help-close', { safetyId: id, resolution: '已联系' }), /争议/);
  h.run(manager, 'booking.help-close', { safetyId: id, resolution: '人员安全，费用有争议', unresolvedDispute: true });
  assert.equal(h.s.safety[0].status, 'closed'); assert.equal(bookingView(h.s, user)[0].settlementBlocked, true);
  h.run(group, 'booking.dispute-close', { id: b.id, disputeId: h.get(b.id).disputes[0].id, resolution: '双方已确认不再有费用争议' });
  assert.equal(bookingView(h.s, user)[0].settlementBlocked, false);
});

test('技师确认安全停止自动升级但不自动结束实际服务', () => {
  const h = harness(), b = h.active(); h.advance(75 * MIN); h.run(lin, 'booking.safety-confirm', { id: b.id }); h.advance(20 * MIN);
  assert.equal(h.get(b.id).status, 'active'); assert.equal(h.s.safety.length, 0); assert.equal(h.get(b.id).supervision.status, 'confirmed');
});

test('F02 身体不适立即中止，安全结案不解争议，用户确认后退款关闭独立争议', () => {
  const h = harness(), b = h.active(); h.advance(20 * MIN);
  const help = h.run(user, 'booking.help', { id: b.id, reason: '身体不适' });
  const d = h.run(lin, 'booking.stop', { id: b.id, category: 'health', reason: '用户身体不适立即停止' });
  const stoppedAt = h.s.now;
  assert.equal(h.get(b.id).status, 'interrupted'); assert.equal(d.actualMinutes, 20);
  assert.throws(() => h.run(lin, 'booking.finish', { id: b.id, mode: 'normal' }), /尚未开始/);
  h.run(manager, 'booking.help-close', { safetyId: help.id, resolution: '人已安全', unresolvedDispute: false });
  assert.equal(bookingView(h.s, user)[0].displayStatus, '客服处理中');
  assert.throws(() => h.run(manager, 'booking.dispute-review', { id: b.id, disputeId: d.id, responsibility: 'user', reason: '错误处理' }), /身体不适/);
  h.advance(30 * MIN); h.run(manager, 'booking.dispute-review', { id: b.id, disputeId: d.id, responsibility: 'health', reason: '双方核实实际服务20分钟' });
  const r = h.get(b.id).refunds[0]; assert.equal(r.amountCents, 19867); assert.equal(r.status, 'offered'); assert.equal(h.get(b.id).completedAt, stoppedAt);
  h.advance(3 * DAY); assert.equal(h.get(b.id).refunds[0].status, 'offered');
  assert.throws(() => h.run(group, 'booking.refund-pay', { id: b.id, refundId: r.id, paymentId: b.payment.id, outcome: 'success' }), /等待用户确认/);
  h.run(user, 'booking.refund-answer', { id: b.id, refundId: r.id, version: h.get(b.id).refunds.find(x => x.id === r.id).version, decision: 'accept' });
  h.run(group, 'booking.refund-pay', { id: b.id, refundId: r.id, paymentId: b.payment.id, outcome: 'success' });
  assert.equal(h.get(b.id).disputes[0].status, 'resolved'); assert.equal(bookingView(h.s, user)[0].settlementBlocked, false);
  assert.equal(h.get(b.id).completionKind, 'interrupted'); assert.equal(h.get(b.id).completedAt, stoppedAt);
});

test('用户原因中止裁定不退款，保留真实时间及账户限制待办；越店不能核实', () => {
  const h = harness(), b = h.active(); h.advance(10 * MIN); const d = h.run(lin, 'booking.stop', { id: b.id, category: 'user', reason: '用户行为需核实' });
  assert.throws(() => h.run(foreign, 'booking.dispute-review', { id: b.id, disputeId: d.id, responsibility: 'user', reason: '越店' }), /无权/);
  h.run(group, 'booking.dispute-review', { id: b.id, disputeId: d.id, responsibility: 'user', reason: '核实为用户原因' });
  assert.equal(h.get(b.id).refunds.length, 0); assert.equal(h.get(b.id).completionKind, 'adjudicated-user'); assert.equal(h.get(b.id).disputes[0].accountRestriction.status, 'pending');
});

test('F04 普通请假拦截提案占位；紧急请假撤回目标提案且保留原安排', () => {
  for (const emergency of [false, true]) {
    const h = harness(), b = h.confirmed(); h.run(manager, 'booking.propose-reschedule', { id: b.id, techId: 'zhou', startAt: time('2026-10-03T13:00'), reason: '协调' });
    const l = h.run(zhou, 'booking.leave-request', { startAt: time('2026-10-03T12:00'), endAt: time('2026-10-03T16:00'), reason: '请假', emergency });
    if (!emergency) assert.throws(() => h.run(manager, 'booking.leave-review', { leaveId: l.id, decision: 'approve' }), /先处理/);
    else { h.run(manager, 'booking.leave-review', { leaveId: l.id, decision: 'approve' }); assert.deepEqual(h.s.leaves[0].impactedIds, [b.id]); assert.equal(h.get(b.id).change.status, 'withdrawn'); assert.equal(h.get(b.id).techId, 'lin'); assert.equal(h.get(b.id).status, 'confirmed'); assert.equal(h.get(b.id).changeHistory[0].status, 'withdrawn'); }
  }
});

test('F05 分笔混合结果只重试失败支付，固定退款号、累退和占额不重复', () => {
  const h = harness(), b = h.active(), ext = h.run(user, 'booking.extension-create', { id: b.id, requestId: 'extension' }); h.run(user, 'booking.extension-pay', { id: b.id, extensionId: ext.id, outcome: 'success' }); h.advance(90 * MIN); h.run(lin, 'booking.finish', { id: b.id, mode: 'normal' });
  const r = h.run(user, 'booking.refund-request', { id: b.id, reason: '分笔协商', requests: [{ paymentId: b.payment.id, amountCents: 9800 }, { paymentId: ext.id, amountCents: 4900 }] });
  h.run(manager, 'booking.refund-review', { id: b.id, refundId: r.id, decision: 'offer', amountCents: 10000, reason: '协商' }); h.run(user, 'booking.refund-answer', { id: b.id, refundId: r.id, version: h.get(b.id).refunds.find(x => x.id === r.id).version, decision: 'accept' });
  const lines = structuredClone(h.get(b.id).refunds[0].lines); assert.deepEqual(lines.map(x => x.amountCents), [6667, 3333]);
  h.run(group, 'booking.refund-pay', { id: b.id, refundId: r.id, paymentId: b.payment.id, outcome: 'success' });
  h.run(group, 'booking.refund-pay', { id: b.id, refundId: r.id, paymentId: ext.id, outcome: 'failed' });
  const no = h.get(b.id).refunds[0].executions[1].refundNo;
  assert.equal(h.get(b.id).refunds[0].status, 'failed'); assert.equal(bookingView(h.s, user)[0].refundedCents, 6667);
  h.run(group, 'booking.refund-pay', { id: b.id, refundId: r.id, paymentId: b.payment.id, outcome: 'success' }); assert.equal(bookingView(h.s, user)[0].refundedCents, 6667);
  h.run(group, 'booking.refund-pay', { id: b.id, refundId: r.id, paymentId: ext.id, outcome: 'processing' });
  assert.throws(() => h.run(group, 'booking.refund-pay', { id: b.id, refundId: r.id, paymentId: ext.id, outcome: 'success' }), /查询/);
  h.run(group, 'booking.refund-query', { id: b.id, refundId: r.id, paymentId: ext.id, outcome: 'success' });
  assert.equal(h.get(b.id).refunds[0].executions[1].refundNo, no); assert.equal(h.get(b.id).refunds[0].status, 'success'); assert.equal(bookingView(h.s, user)[0].refundedCents, 10000); assert.deepEqual(h.get(b.id).refunds[0].lines, lines);
  assert.equal(h.get(b.id).refunds[0].executions[0].attempts, 1);
});

test('旧成功/失败退款迁移添加原笔执行状态，不重放成功金额', () => {
  const h = harness(), b = h.confirmed(); h.run(user, 'booking.cancel', { id: b.id, reason: '取消' }); const r = h.get(b.id).refunds[0];
  h.run(group, 'booking.refund-pay', { id: b.id, refundId: r.id, outcome: 'success' }); delete h.get(b.id).refunds[0].executions;
  upgradeBookings(h.s); upgradeBookings(h.s); assert.equal(h.get(b.id).refunds[0].executions[0].status, 'success'); assert.equal(h.get(b.id).payment.refundedCents, 29800);
  h.run(group, 'booking.refund-query', { id: b.id, refundId: r.id, paymentId: b.payment.id, outcome: 'success' }); assert.equal(h.get(b.id).payment.refundedCents, 29800);
});

test('F11 每次改约保存前后事实，后续新提案及档案修改不覆盖历史', () => {
  const h = harness(), b = h.confirmed(); h.run(user, 'booking.reschedule', { id: b.id, startAt: time('2026-10-03T15:00'), techId: 'zhou' });
  const first = h.get(b.id).changeHistory[0]; assert.equal(first.before.startAt, b.startAt); assert.equal(first.before.techName, '林师傅'); assert.equal(first.after.techName, '周师傅');
  h.run(zhou, 'booking.accept', { id: b.id }); h.run(manager, 'booking.propose-reschedule', { id: b.id, startAt: time('2026-10-04T15:00'), techId: 'lin', reason: '再次协调' }); const proposal = h.get(b.id).change.id;
  h.run(user, 'booking.change-answer', { id: b.id, changeId: proposal, decision: 'reject' });
  h.s.techs.find(t => t.id === 'zhou').name = '周新名'; assert.deepEqual(h.get(b.id).changeHistory[0], first); assert.equal(h.get(b.id).techSnapshot.name, '周师傅'); assert.equal(h.get(b.id).changeHistory.length, 2);
});

test('F11 演示身份保留多角色字段时，变更记录仍按实际岗位记录操作者', () => {
  const h = harness(), b = h.confirmed();
  h.run({...manager,userId:'u1',techId:'lin'}, 'booking.propose-reschedule', {id:b.id,startAt:time('2026-10-03T15:00'),techId:'zhou',reason:'门店协调'});
  assert.equal(h.get(b.id).changeHistory[0].initiatedBy.id, 'xingfu');
  h.run({...user,storeId:'xingfu',techId:'lin'},'booking.change-answer',{id:b.id,changeId:h.get(b.id).change.id,decision:'accept'});
  assert.equal(h.get(b.id).changeHistory[0].confirmedBy.id,'u1');
});

test('F12 求助资格用户至完成2小时，技师完成即终止，订单未履约不可新建', () => {
  const h = harness(), b = h.confirmed(); assert.equal(bookingCanHelp(h.s, h.get(b.id), user), false);
  assert.throws(() => h.run(user, 'booking.help', { id: b.id, reason: '过早' }), /履约开始/);
  h.advance(4 * HOUR); h.run(lin, 'booking.start', { id: b.id }); assert.equal(bookingCanHelp(h.s, h.get(b.id), lin), true);
  h.advance(HOUR); h.run(lin, 'booking.finish', { id: b.id, mode: 'normal' }); assert.equal(bookingCanHelp(h.s, h.get(b.id), lin), false);
  h.advance(2 * HOUR); h.run(user, 'booking.help', { id: b.id, reason: '保护窗口边界' }); h.advance(MIN);
  assert.throws(() => h.run(user, 'booking.help', { id: b.id, reason: '窗口外' }), /2小时/);
  assert.throws(() => h.run(lin, 'booking.help', { id: b.id, reason: '结束后' }), /2小时/);
});

test('F13 协商分币余数相同时固定主单优先，无关输入数组顺序', () => {
  const h = harness(), b = h.active(), ext = h.run(user, 'booking.extension-create', { id: b.id, requestId: 'extra' }); h.run(user, 'booking.extension-pay', { id: b.id, extensionId: ext.id, outcome: 'success' }); h.advance(90 * MIN); h.run(lin, 'booking.finish', { id: b.id, mode: 'normal' });
  const r = h.run(user, 'booking.refund-request', { id: b.id, reason: '尾差', requests: [{ paymentId: ext.id, amountCents: 100 }, { paymentId: b.payment.id, amountCents: 100 }] });
  h.run(manager, 'booking.refund-review', { id: b.id, refundId: r.id, decision: 'offer', amountCents: 1, reason: '尾差' }); const lines = h.get(b.id).refunds[0].lines;
  assert.equal(lines.find(x => x.paymentId === b.payment.id).amountCents, 1); assert.equal(lines.find(x => x.paymentId === ext.id).amountCents, 0);
});

test('中止不能被未知加时付款阻拦，先停止、查询晚到原笔，再核实退款', () => {
  const h = harness(), b = h.active(), ext = h.run(user, 'booking.extension-create', { id: b.id, requestId: 'unknown' });
  h.run(user, 'booking.extension-pay', { id: b.id, extensionId: ext.id, outcome: 'processing' });
  h.advance(10 * MIN); const d = h.run(lin, 'booking.stop', { id: b.id, category: 'health', reason: '立即停止' });
  assert.equal(h.get(b.id).status, 'interrupted');
  assert.throws(() => h.run(manager, 'booking.dispute-review', { id: b.id, disputeId: d.id, responsibility: 'health', reason: '核实' }), /先查询/);
  h.run(group, 'booking.extension-query', { id: b.id, extensionId: ext.id, outcome: 'success' });
  assert.equal(h.get(b.id).extensions[0].duration, 0); assert.equal(h.get(b.id).refunds[0].amountCents, 14900);
  h.run(manager, 'booking.dispute-review', { id: b.id, disputeId: d.id, responsibility: 'health', reason: '核实' });
  assert.equal(h.get(b.id).refunds[1].amountCents, 24833); assert.equal(bookingView(h.s, user)[0].settlementBlocked, true);
});

test('中止方案升级和失败保留争议，集团新方案也必须由用户确认', () => {
  const h = harness(), b = h.active(); h.advance(30 * MIN); const d = h.run(lin, 'booking.stop', { id: b.id, category: 'other', reason: '需核实' });
  h.run(manager, 'booking.dispute-review', { id: b.id, disputeId: d.id, responsibility: 'non-user', reason: '非用户原因' }); const r = h.get(b.id).refunds[0];
  assert.throws(() => h.run(user, 'booking.refund-answer', { id: b.id, refundId: r.id, decision: 'withdraw' }), /不能撤销/);
  h.run(user, 'booking.refund-answer', { id: b.id, refundId: r.id, decision: 'escalate' });
  assert.throws(() => h.run(group, 'booking.refund-review', { id: b.id, refundId: r.id, decision: 'reject', reason: '直接驳回' }), /用户明确确认/);
  assert.equal(bookingView(h.s, user)[0].settlementBlocked, true);
  h.run(group, 'booking.refund-review', { id: b.id, refundId: r.id, decision: 'offer', reason: '重新核实提出160元方案', amountCents: 16000 });
  assert.equal(h.get(b.id).refunds[0].status, 'offered');
  h.run(user, 'booking.refund-answer', { id: b.id, refundId: r.id, version: h.get(b.id).refunds.find(x => x.id === r.id).version, decision: 'accept' });
  h.run(group, 'booking.refund-pay', { id: b.id, refundId: r.id, paymentId: b.payment.id, outcome: 'failed' });
  assert.equal(h.get(b.id).disputes[0].status, 'refunding'); assert.equal(bookingView(h.s, user)[0].settlementBlocked, true);
  h.run(group, 'booking.refund-pay', { id: b.id, refundId: r.id, paymentId: b.payment.id, outcome: 'success' });
  assert.equal(h.get(b.id).disputes[0].status, 'resolved');
});

