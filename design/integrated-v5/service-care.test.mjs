import test from 'node:test';
import assert from 'node:assert/strict';
import { upgradeCare, syncCare, careCommand, careView, careBlocksBooking, careBookingSummary, careClosureBlockers } from './service-care.mjs';

const HOUR = 3600000, DAY = 24 * HOUR, NOW = Date.parse('2026-10-03T10:00:00+08:00');
const user = { role: 'user', userId: 'u1' }, tech = { role: 'tech', techId: 't1' }, store = { role: 'store', storeId: 's1' }, manager = { role: 'manager', storeId: 's1' }, group = { role: 'group', job: 'support' };
function fixture() {
  let s = { now: NOW, seq: 0, users: [{ id: 'u1' }, { id: 'u2' }], stores: [{ id: 's1' }, { id: 's2' }], techs: [{ id: 't1', storeId: 's1' }, { id: 't2', storeId: 's2' }], safety: [], logs: [], serviceReviews: [], bookings: ['1', '2'].map(x => ({ id: 'B' + x, userId: 'u' + x, storeId: 's' + x, techId: 't' + x, serviceId: 'relax', status: 'done', completedAt: NOW, refunds: [], disputes: [] })) };
  let seq = 0; upgradeCare(s);
  const ctx = state => ({ id: prefix => prefix + (++state.seq), fail: message => { throw new Error(message); }, log: (row, content) => { const event = { at: state.now, text: content }; (row.events ??= []).push(event); state.logs.push({ ...event, id: row.id }); } });
  const run = (type, p = {}, actor = store) => { const next = structuredClone(s); const result = careCommand(next, actor, type, { requestId: 'test-' + (++seq), ...p }, ctx(next)); s = next; return result; };
  return { get s() { return s; }, get b() { return s.bookings[0]; }, get c() { return s.serviceCareCases.at(-1); }, get f() { return s.serviceCareFollowups.at(-1); }, run,
    create(p = {}, actor = user) { return run('care.case-create', { bookingId: 'B1', category: 'quality', description: '说明实际问题，希望改进服务', ...p }, actor); },
    respond(p = {}, actor = store) { return run('care.case-respond', { id: this.c.id, version: this.c.version, decision: 'respond', publicReply: '已核实问题并完成改进', ...p }, actor); },
    answer(p = {}) { return run('care.case-answer', { id: this.c.id, version: this.c.version, decision: 'accept', ...p }, user); },
    follow(p = {}, actor = store) { return run('care.followup-create', { bookingId: 'B1', reason: '人工选择的质量回访', scope: 'store', name: '王负责人', dueAt: s.now + DAY, ...p }, actor); },
    record(p = {}, actor = store) { return run('care.followup-record', { id: this.f.id, version: this.f.version, outcome: 'reached', note: '用户已接听并说明当前情况', ...p }, actor); },
    closeFollow(p = {}, actor = store) { return run('care.followup-close', { id: this.f.id, version: this.f.version, conclusion: '已核实无待处理问题', ...p }, actor); },
    sync() { syncCare(s, ctx(s)); }, advance(delta) { s.now += delta; this.sync(); }
  };
}

test('L03 增量容器与纯视图不伪造历史案件，普通回访不阻断资金', () => {
  const f = fixture(), before = structuredClone(f.s.bookings); f.follow();
  assert.equal(careBlocksBooking(f.s, 'B1'), false); assert.equal(careBookingSummary(f.s, f.b).openFollowupCount, 1);
  const snapshot = JSON.stringify(f.s); careView(f.s, store); careBookingSummary(f.s, f.b); careBlocksBooking(f.s, f.b); assert.equal(JSON.stringify(f.s), snapshot);
  upgradeCare(f.s); f.sync(); f.sync(); assert.deepEqual(f.s.bookings, before); assert.equal(f.s.serviceCareCases.length, 0);
});

test('L03 纯反馈不生成退款，门店回复、用户确认后闭环，永久幂等忽略残留岗位', () => {
  const f = fixture(), request = { bookingId: 'B1', category: 'quality', description: '用户反馈并希望改进', requestId: 'create-once' };
  f.run('care.case-create', request, user); f.run('care.case-create', request, { ...user, job: 'finance' });
  assert.equal(f.s.serviceCareCases.length, 1); assert.equal(f.b.refunds.length, 0); assert.equal(careBlocksBooking(f.s, f.b), true);
  assert.throws(() => f.run('care.case-create', { ...request, description: '篡改内容' }, user), /同一提交/);
  const reply = { id: f.c.id, version: f.c.version, decision: 'respond', publicReply: '完成核实，已改进', requestId: 'reply-once' };
  f.run('care.case-respond', reply, store); f.run('care.case-respond', reply, { ...store, job: 'support' });
  assert.equal(f.c.resolutions.length, 1); assert.equal(f.c.status, 'user_pending'); f.answer();
  assert.equal(f.c.status, 'closed'); assert.equal(careBlocksBooking(f.s, 'B1'), false); assert.equal(f.b.refunds.length, 0);
  f.advance(90 * DAY); f.run('care.case-create', request, user); assert.equal(f.s.serviceCareCases.length, 1);
});

test('L03 受理48小时与集团30天边界、未完成和退款诉求校验', () => {
  const f = fixture(); f.s.now = NOW + 2 * DAY; f.create();
  const g = fixture(); g.s.now = NOW + 2 * DAY + 1;
  assert.throws(() => g.create(), /48小时/); assert.throws(() => g.create({ reason: '门店代录' }, manager), /48小时/);
  g.create({ reason: '客服电话核实原诉求' }, group); assert.equal(g.c.status, 'group_pending'); assert.equal(g.c.groupDueAt, g.s.now + 2 * DAY);
  const h = fixture(); h.s.now = NOW + 30 * DAY; h.create({ reason: '期限内受理' }, group);
  const late = fixture(); late.s.now = NOW + 30 * DAY + 1; assert.throws(() => late.create({ reason: '超期' }, group), /30天/);
  const incomplete = fixture(); incomplete.b.status = 'active'; assert.throws(() => incomplete.create(), /已完成/);
  for (const p of [{ claim: 'refund' }, { amountCents: 1 }, { requests: [{ paymentId: 'P', amountCents: 100 }] }, { category: 'invented' }, { description: '' }]) assert.throws(() => fixture().create(p));
});

test('L03 权限先于请求幂等，跨用户技师门店和集团财务均不能冒用操作', () => {
  const f = fixture(); f.create({ requestId: 'owned' });
  for (const actor of [{ role: 'user', userId: 'u2' }, { role: 'tech', techId: 't2' }, { role: 'store', storeId: 's2' }, { role: 'group', job: 'finance' }, { role: 'group', job: 'operations' }, { role: 'user', userId: 'missing' }]) {
    assert.throws(() => f.run('care.case-statement', { id: f.c.id, version: f.c.version, text: '非法补充', requestId: 'owned' }, actor));
    assert.equal(careView(f.s, actor).cases.length, 0);
  }
  assert.throws(() => f.respond({}, tech), /工作端|客服/);
  assert.throws(() => f.run('care.case-answer', { id: f.c.id, version: f.c.version, decision: 'withdraw', reason: '冒用' }, store), /本人/);
});

test('L03 24小时升级与集团48小时沿原期限，晚打开页面不重计，重复同步不添历史', () => {
  const f = fixture(); f.create(); const createdAt = f.c.createdAt; f.advance(4 * DAY);
  assert.equal(f.c.status, 'group_pending'); assert.equal(f.c.groupStartedAt, createdAt + DAY); assert.equal(f.c.groupDueAt, createdAt + 3 * DAY); assert.equal(f.c.overdueAt, createdAt + 3 * DAY);
  const json = JSON.stringify(f.s); f.sync(); f.sync(); assert.equal(JSON.stringify(f.s), json);
  assert.throws(() => f.respond({}, store), /无权/); f.respond({}, group); assert.equal(f.c.status, 'closed'); assert.equal(f.c.final, true);
});

test('L03 门店拒绝也须用户确认，可升级集团最终处理；确认48小时超时沿原窗口', () => {
  const f = fixture(); f.create(); f.respond({ decision: 'reject', publicReply: '已核实，证据不足并说明原因' });
  const due = f.c.userDueAt; f.answer({ decision: 'escalate', reason: '用户不同意原判断' });
  assert.equal(f.c.status, 'group_pending'); assert.equal(f.c.groupDueAt, f.s.now + 2 * DAY);
  assert.throws(() => f.run('care.task-assign', { entity: 'case', id: f.c.id, version: f.c.version, scope: 'store', name: '店长', reason: '退回处理' }, group), /不能退回/);
  f.respond({ decision: 'reject', publicReply: '集团复核的最终公开依据' }, group); assert.equal(f.c.status, 'closed');
  const g = fixture(); g.create(); g.respond(); g.s.now = g.c.userDueAt; g.sync(); assert.equal(g.c.status, 'closed'); assert.equal(g.c.confirmedAt, due); assert.equal(g.c.confirmationMode, 'timeout');
});

test('L03 认领与转派不重置期限，集团接管后原门店不能转回或再次裁决', () => {
  const f = fixture(); f.create(); const initial = f.c.storeDueAt;
  f.run('care.task-claim', { entity: 'case', id: f.c.id, version: f.c.version, name: '王店长' }, manager);
  f.advance(HOUR); f.run('care.task-assign', { entity: 'case', id: f.c.id, version: f.c.version, scope: 'store', name: '李负责人', reason: '值班交接' }); assert.equal(f.c.storeDueAt, initial); assert.equal(f.c.assignee.claimedAt, null);
  f.run('care.task-assign', { entity: 'case', id: f.c.id, version: f.c.version, scope: 'group', name: '集团客服甲', reason: '门店无法独立解决' });
  const groupDue = f.c.groupDueAt; f.advance(HOUR); f.run('care.task-assign', { entity: 'case', id: f.c.id, version: f.c.version, scope: 'group', name: '集团客服乙', reason: '集团值班交接' }, group);
  assert.equal(f.c.groupDueAt, groupDue); assert.equal(f.c.storeId, 's1'); assert.equal(f.c.storeDueAt, initial);
  assert.throws(() => f.run('care.task-claim', { entity: 'case', id: f.c.id, version: f.c.version, name: '门店冒领' }), /当前负责/);
  assert.throws(() => f.respond(), /无权/);
});

test('L03 用户与本人技师补充说明，公开回复与内部依据完全隔离', () => {
  const f = fixture(); f.create(); f.run('care.case-statement', { id: f.c.id, version: f.c.version, text: '用户补充事实' }, user);
  f.run('care.case-statement', { id: f.c.id, version: f.c.version, text: '实际服务技师说明' }, tech);
  f.run('care.case-note', { id: f.c.id, version: f.c.version, text: 'SECRET-NOTE 内部核查内容' });
  f.respond({ publicReply: '已核实并改进', internalNote: 'SECRET-REPLY 员工内部记录' });
  for (const actor of [user, tech]) { const v = careView(f.s, actor).cases[0]; assert.equal(v.statements.length, 2); assert.equal(v.publicReply, '已核实并改进'); assert.doesNotMatch(JSON.stringify(v), /SECRET/); assert.equal(v.notes, undefined); assert.equal(v.history, undefined); }
  assert.match(JSON.stringify(careView(f.s, manager).cases[0]), /SECRET-NOTE/); assert.match(JSON.stringify(careView(f.s, group).cases[0]), /SECRET-REPLY/);
});

test('L03 所有同预约未结退款安全争议阻止结案，不要求先手动关联', () => {
  const f = fixture(); f.create();
  f.b.refunds.push({ id: 'R1', status: 'failed', executions: [{ amountCents: 100, status: 'failed' }] });
  f.s.safety.push({ id: 'S1', bookingId: 'B1', status: 'open' }); f.b.disputes.push({ id: 'D1', status: 'open' });
  f.respond(); f.answer(); assert.equal(f.c.status, 'execution_pending'); assert.equal(careClosureBlockers(f.s, f.c).length, 3);
  assert.throws(() => f.run('care.case-close', { id: f.c.id, version: f.c.version, conclusion: '用备注代替执行' }), /退款/);
  f.b.refunds[0].status = 'success'; f.b.refunds[0].executions[0].status = 'success'; f.s.safety[0].status = 'closed'; f.b.disputes[0].status = 'closed';
  f.run('care.case-close', { id: f.c.id, version: f.c.version, conclusion: '逐项核实原退款安全争议均已完结' }); assert.equal(f.c.status, 'closed'); assert.equal(careBlocksBooking(f.s, f.b), false);
});

test('L03 关联同预约实体并拒绝伪造/跨单，删失引用与安全孤立争议均待核对', () => {
  const f = fixture(); f.b.refunds.push({ id: 'R1', status: 'success' }); f.s.bookings[1].refunds.push({ id: 'R2', status: 'success' }); f.s.serviceReviews.push({ id: 'RV1', bookingId: 'B1' }); f.create();
  for (const targetId of ['missing', 'R2']) assert.throws(() => f.run('care.case-link', { id: f.c.id, version: f.c.version, kind: 'refund', targetId, reason: '校验' }), /不存在|不属于/);
  f.run('care.case-link', { id: f.c.id, version: f.c.version, kind: 'refund', targetId: 'R1', reason: '该反馈原退款' });
  f.run('care.case-link', { id: f.c.id, version: f.c.version, kind: 'review', targetId: 'RV1', reason: '相关评价' });
  f.b.refunds = []; f.s.safety.push({ id: 'S1', bookingId: 'B1', status: 'closed', unresolvedDispute: true, disputeId: 'missing' });
  f.respond(); f.answer(); assert.equal(f.c.status, 'execution_pending'); assert.match(careClosureBlockers(f.s, f.c).join(), /不存在|后续争议/);
});

test('L03 处罚限制复训待专项办理，撤销或普通结案备注不能清除待办', () => {
  for (const specialistAction of ['penalty', 'restriction', 'retraining']) {
    const f = fixture(); f.create(); f.respond({ specialistAction, internalNote: '需要专项核实，不直接改资格' }); f.answer();
    assert.equal(f.c.status, 'execution_pending'); assert.equal(careBlocksBooking(f.s, f.b), true);
    assert.throws(() => f.run('care.case-close', { id: f.c.id, version: f.c.version, conclusion: '已解决' }), /专项/);
    f.answer({ decision: 'withdraw', reason: '撤销个人诉求' }); assert.equal(f.c.status, 'execution_pending'); assert.equal(f.c.specialistActions[0].status, 'pending');
    assert.equal(f.s.techs[0].active, undefined);
  }
});

test('L03 用户撤销不撤原退款安全，有未结执行则继续跟踪，无依赖则保留撤销记录', () => {
  const f = fixture(); f.create(); f.b.refunds.push({ id: 'R1', status: 'processing' });
  f.answer({ decision: 'withdraw', reason: '撤销反馈，退款继续' }); assert.equal(f.c.status, 'execution_pending'); assert.equal(f.b.refunds[0].status, 'processing');
  f.b.refunds[0].status = 'success'; f.run('care.case-close', { id: f.c.id, version: f.c.version, conclusion: '原退款已成功' }); assert.equal(f.c.status, 'withdrawn');
  const g = fixture(); g.create(); g.answer({ decision: 'withdraw', reason: '已无诉求' }); assert.equal(g.c.status, 'withdrawn'); assert.equal(g.s.serviceCareCases.length, 1);
});

test('L03 多标签旧版本拒绝覆盖，期限自动升级后的旧处理表单同样拒绝', () => {
  const f = fixture(); f.create(); const old = f.c.version;
  f.run('care.case-statement', { id: f.c.id, version: old, text: '新增事实' }, tech);
  assert.throws(() => f.respond({ version: old }), /记录已更新/); assert.equal(f.c.resolutions.length, 0);
  const second = f.c.version; f.advance(DAY); assert.throws(() => f.respond({ version: second }, group), /记录已更新/);
});

test('L04 人工回访须负责人原因未来期限，不暗设自动触发阈值', () => {
  for (const p of [{ name: '' }, { reason: '' }, { scope: 's2' }, { dueAt: NOW }, { dueAt: '2026-02-30T10:00' }, { dueAt: '2026-11-03T24:00' }, { caseId: 'missing' }]) assert.throws(() => fixture().follow(p));
  const f = fixture(); f.follow({ dueAt: '2026-10-04T10:00' }); assert.equal(f.f.dueAt, NOW + DAY); assert.equal(f.f.assignee.claimedAt, null); assert.equal(f.s.serviceCareCases.length, 0);
  assert.equal(careView(f.s, user).followups.length, 0); assert.equal(careView(f.s, tech).followups.length, 0);
  for (const actor of [user, tech, { role: 'store', storeId: 's2' }, { role: 'group', job: 'finance' }]) assert.throws(() => fixture().follow({}, actor));
});

test('L04 未接通保留待办，下次联系时间不改变原dueAt，超时转派接管不重计', () => {
  const f = fixture(); f.follow(); const due = f.f.dueAt;
  assert.throws(() => f.record({ outcome: 'no_answer' }), /下次联系/);
  f.record({ outcome: 'no_answer', nextContactAt: NOW + 2 * DAY }); assert.equal(f.f.dueAt, due); assert.equal(f.f.nextContactAt, NOW + 2 * DAY);
  assert.throws(() => f.closeFollow(), /未接通/); f.advance(DAY); assert.equal(f.f.overdueAt, due);
  f.run('care.task-assign', { entity: 'followup', id: f.f.id, version: f.f.version, scope: 'group', name: '集团回访员', reason: '超时接管' }, group);
  assert.equal(f.f.dueAt, due); assert.equal(f.f.overdueAt, due); assert.throws(() => f.record(), /当前负责/);
  f.record({}, group); f.closeFollow({}, group); assert.equal(f.f.status, 'closed'); assert.equal(f.f.overdueAt, due);
});

test('L04 拒访可结束联系，但不能掩盖同预约未结投诉退款安全争议', () => {
  const f = fixture(); f.create(); f.follow(); f.record({ outcome: 'refused', note: '用户明确拒绝后续联系' });
  assert.throws(() => f.closeFollow(), /反馈案件/); f.respond(); f.answer();
  f.b.refunds.push({ id: 'R1', status: 'approved' }); assert.throws(() => f.closeFollow(), /退款/); f.b.refunds[0].status = 'success';
  f.s.safety.push({ id: 'S1', bookingId: 'B1', status: 'open' }); assert.throws(() => f.closeFollow(), /安全/); f.s.safety[0].status = 'closed';
  f.b.disputes.push({ id: 'D1', status: 'verifying' }); assert.throws(() => f.closeFollow(), /争议/); f.b.disputes[0].status = 'resolved';
  f.closeFollow({ conclusion: '联系以拒访结束，原各项问题已逐项办结' }); assert.equal(f.f.status, 'closed');
});

test('L04 回访发现问题转案自动关联并升版本，跨预约来源和用户伪造内部来源拒绝', () => {
  const f = fixture(); f.follow(); const callbackId = f.f.id, oldVersion = f.f.version;
  assert.throws(() => f.create({ sourceKind: 'followup', sourceId: callbackId }), /工作端关联/);
  f.create({ sourceKind: 'followup', sourceId: callbackId, reason: '回访核实需要正式反馈处理' }, store);
  assert.equal(f.f.status, 'awaiting_actions'); assert.equal(f.f.links[0].id, f.c.id); assert.equal(f.f.version, oldVersion + 1);
  assert.throws(() => f.create({ sourceKind: 'followup', sourceId: callbackId, reason: '重复问题' }, store), /已有未结/);
  f.record({ outcome: 'refused', note: '拒绝后续联系，原案继续办理' }); assert.throws(() => f.closeFollow(), /反馈案件/);
  f.respond(); f.answer(); f.closeFollow(); assert.equal(f.f.status, 'closed');
  const g = fixture(); g.follow({ bookingId: 'B2' }, { role: 'store', storeId: 's2' }); assert.throws(() => g.create({ sourceKind: 'followup', sourceId: g.f.id, reason: '跨单' }, store), /不属于/);
});

test('L04 关联既有案件与回访提交幂等，旧联系表单不能覆盖新结果', () => {
  const f = fixture(); f.create(); f.follow({ caseId: f.c.id, requestId: 'follow-once' }); const callback = structuredClone(f.f);
  f.follow({ caseId: f.c.id, requestId: 'follow-once' }); assert.equal(f.s.serviceCareFollowups.length, 1);
  const p = { id: callback.id, version: callback.version, outcome: 'reached', note: '实际联系', requestId: 'attempt-once' };
  f.run('care.followup-record', p); f.run('care.followup-record', p); assert.equal(f.f.attempts.length, 1);
  assert.throws(() => f.run('care.followup-record', { ...p, requestId: 'stale', note: '旧页替换新记录' }), /记录已更新/);
  assert.throws(() => f.run('care.followup-record', { ...p, note: '复用编号换内容' }), /同一提交/);
});

test('L04 回访交集团后原门店不能通过来源转案旁路权限，但仍可独立登记原预约反馈', () => {
  const f = fixture(); f.follow();
  f.run('care.task-assign', { entity: 'followup', id: f.f.id, version: f.f.version, scope: 'group', name: '集团负责人', reason: '移交集团继续跟进' });
  const callback = structuredClone(f.f), source = { sourceKind: 'followup', sourceId: f.f.id, reason: '回访发现问题转案' };
  assert.equal(careView(f.s, store).followups[0].canLink, false);
  assert.equal(careView(f.s, store).sourceOptions.some(x => x.kind === 'followup' && x.id === callback.id), false);
  for (const actor of [store, manager]) assert.throws(() => f.create(source, actor), /当前负责工作端/);
  assert.deepEqual(f.f, callback); assert.equal(f.s.serviceCareCases.length, 0);
  f.create({ reason: '原门店另有独立预约反馈事实' }, store); assert.deepEqual(f.f, callback);
  assert.equal(careView(f.s, group).sourceOptions.some(x => x.kind === 'followup' && x.id === callback.id), true);
  f.create(source, group); assert.equal(f.f.status, 'awaiting_actions'); assert.equal(f.f.version, callback.version + 1); assert.equal(f.f.links[0].id, f.c.id);
  assert.equal(careView(f.s, group).sourceOptions.some(x => x.kind === 'followup' && x.id === callback.id), false);
});

test('L03 用户接受时保存可选公开确认说明，幂等不覆盖，旧记录与超时确认不补造用户文字', () => {
  const f = fixture(); f.create(); f.respond({ internalNote: 'SECRET 内部核实' });
  const p = { id: f.c.id, version: f.c.version, decision: 'accept', reason: '已收到解释，接受这次改进安排', requestId: 'accept-note-once' };
  f.run('care.case-answer', p, user); const after = structuredClone(f.c); f.run('care.case-answer', p, user);
  assert.deepEqual(f.c, after); assert.equal(f.c.confirmationNote, p.reason); assert.equal(f.c.confirmationMode, 'user');
  assert.equal(f.c.publicHistory.filter(e => e.text.includes(p.reason)).length, 1);
  for (const actor of [user, tech, store, manager, group]) {
    const view = careView(f.s, actor).cases[0]; assert.equal(view.confirmationNote, p.reason); assert.equal(view.confirmedAt, NOW);
    if (actor === user || actor === tech) assert.doesNotMatch(JSON.stringify(view), /SECRET/);
  }
  assert.throws(() => f.run('care.case-answer', { ...p, reason: '重试改写用户说明' }, user), /同一提交/);
  const blank = fixture(); blank.create(); blank.respond(); blank.answer(); assert.equal(blank.c.confirmationNote, '');
  delete blank.c.confirmationNote; const old = JSON.stringify(blank.c); blank.sync(); careView(blank.s, user); assert.equal(JSON.stringify(blank.c), old); assert.equal(Object.hasOwn(blank.c, 'confirmationNote'), false);
  const timed = fixture(); timed.create(); timed.respond(); timed.advance(2 * DAY); assert.equal(timed.c.confirmationMode, 'timeout'); assert.equal(Object.hasOwn(timed.c, 'confirmationNote'), false); assert.equal(careView(timed.s, user).cases[0].confirmationNote, '');
  const tooLong = fixture(); tooLong.create(); tooLong.respond(); assert.throws(() => tooLong.answer({ reason: '长'.repeat(501) }), /确认说明/); assert.equal(tooLong.c.status, 'user_pending');
});
