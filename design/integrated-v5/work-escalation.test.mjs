import test from 'node:test';
import assert from 'node:assert/strict';
import { seed } from './engine.mjs';
import { upgradeAccounts, accountCommand, resolveAccountActor } from './staff-accounts.mjs';
import { careCommand } from './service-care.mjs';
import { workTaskView, workTaskCommand } from './work-tasks.mjs';
import { upgradeWorkEscalations, workEscalationView, workEscalationCommand } from './work-escalation.mjs';
import { workEscalationPanel, workEscalationUiView } from './work-escalation-ui.mjs';

const user = { role: 'user', userId: 'u1' }, ASSIST = 'booking-assistance:AS1:reply', DISPATCH = 'booking-round:R1:dispatch', SAFETY = 'booking-safety:SF1:handle';
let seq = 0;
const context = s => ({ id: prefix => prefix + (++s.seq), fail: message => { throw Error(message); }, log: (row, text) => { (s.logs ??= []).push({ id: row.id, text, at: s.now }); } });
function fixture() {
  let s = seed();
  s.bookings = [{ id: 'B1', userId: 'u1', storeId: 'xingfu', techId: 'lin', serviceId: 'relax', status: 'waiting', confirmationPhase: 'store', startAt: s.now + 14400000, createdAt: s.now, phone: '13812345678', attention: '私密原始描述不得输出', payment: { id: 'P1', status: 'success', amountCents: 29800, refundedCents: 0 }, extensions: [], refunds: [], disputes: [], assistance: [{ id: 'AS1', status: 'open', createdAt: s.now, reason: '私密原始描述不得输出' }], round: { id: 'R1', startedAt: s.now, deadline: s.now + 1800000, techDeadline: s.now + 600000, completedAt: null }, rounds: [], changeHistory: [], events: [] }];
  upgradeAccounts(s);
  const f = { get s() { return s; }, edit: fn => fn(s), task: (a, id = ASSIST) => workTaskView(s, a).tasks.find(t => t.id === id), row: (a, id = ASSIST) => workEscalationView(s, a).rows.find(r => r.task.id === id),
    run(a, type, p = {}, adapter) { const next = structuredClone(s), ctx = context(next); if (adapter) ctx.takeoverNativeWork = x => adapter(next, x, ctx); const result = type.startsWith('account.') ? accountCommand(next, a, type, { requestId: `account-${++seq}`, ...p }, ctx) : type.startsWith('care.') ? careCommand(next, resolveAccountActor(next, a), type, { requestId: `care-${++seq}`, ...p }, ctx) : type.startsWith('work.') ? workTaskCommand(next, a, type, { requestId: `work-${++seq}`, ...p }, ctx) : workEscalationCommand(next, a, type, p, ctx); s = next; return result; },
    payload(a, id = ASSIST, p = {}) { const r = this.row(a, id); return { id, sourceToken: r?.task.sourceToken, ownerToken: r?.ownerToken, assignmentVersion: r?.assignmentVersion, version: r?.version, requestId: `escalation-${++seq}`, reason: '按实际责任与源事项核对', ...p }; },
    action(a, type, id = ASSIST, p = {}, adapter) { return this.run(a, type, this.payload(a, id, p), adapter); },
    claim(a, id = ASSIST) { const t = this.task(a, id); return this.run(a, 'work.claim', { id, sourceToken: t.sourceToken, version: t.assignmentVersion }); },
    raise(a, receiver = a, id = ASSIST, cause = 'manual-review', p = {}) { const target = resolveAccountActor(s, receiver); return this.action(a, 'work-escalation.raise', id, { cause, accountId: target.accountId, grantId: target.grantId, ...p }); },
    staff(job, name = job, storeId = 'xingfu') { let account = this.run(this.admin, 'account.create', { name, reason: '事项责任测试授权' }); account = this.run(this.admin, 'account.grant', { id: account.id, version: account.version, job, ...(job.startsWith('store-') ? { storeId } : {}), reason: '明确测试岗位与范围' }); const entered = this.run(user, 'account.enter', { accountId: account.id, grantId: account.grants[0].id }); return resolveAccountActor(s, entered); },
    revoke(actor) { const account = s.staffAccounts.find(x => x.id === actor.accountId); return this.run(this.admin, 'account.status', { id: account.id, version: account.version, enabled: false, reason: '停用实际测试负责人' }); },
    safety(a = null) { s.safety = [{ id: 'SF1', bookingId: 'B1', storeId: 'xingfu', status: 'open', stage: a ? 'acknowledged' : 'pending', createdAt: s.now, ackDeadline: s.now - 1, escalationDeadline: s.now + 360000, responsibleName: a ? resolveAccountActor(s, a).accountName : '未绑定工作账号的责任姓名', ...(a ? { acknowledgedAt: s.now, acknowledgedBy: { accountId: a.accountId, grantId: resolveAccountActor(s, a).grantId } } : {}) }]; },
    care() { s.bookings[0].status = 'done'; s.bookings[0].completedAt = s.now; const row = this.run(user, 'care.case-create', { bookingId: 'B1', category: 'quality', description: '私密原始描述不得输出' }); return `care-case:${row.id}:resolution`; },
    nativeBridge(next, { task, actor, reason }) { if (task.category === 'safety') { const h = next.safety.find(x => x.id === task.sourceId); h.responsibility = { accountId: actor.accountId, grantId: actor.grantId, name: actor.accountName, at: next.now, reason }; } else { const row = (task.category === 'care' ? next.serviceCareCases : next.serviceCareFollowups).find(x => x.id === task.sourceId); row.assignee = { ...row.assignee, accountId: actor.accountId, grantId: actor.grantId, name: actor.accountName }; row.version++; } }
  };
  f.admin = f.run(user, 'account.enter', { accountId: 'DEMO-ADMIN', grantId: 'DEMO-ADMIN-GRANT' });
  return f;
}

test('C11 旧存档只增量加请求容器；纯读不泄露源原文、不生成期限或任务完成状态', () => {
  const f = fixture(), a = f.staff('store-manager'), original = structuredClone(f.s);
  const r = f.row(a); assert.deepEqual(f.s, original); assert.equal(r.task.dueAt, null); assert.equal(r.record, null); assert.equal(r.version, 0); assert.doesNotMatch(JSON.stringify(workEscalationView(f.s, a)), /私密原始描述|13812345678/);
  f.edit(s => upgradeWorkEscalations(s)); const once = structuredClone(f.s); f.edit(s => upgradeWorkEscalations(s)); assert.deepEqual(f.s, once); assert.deepEqual(f.s.bookings, original.bookings); assert.deepEqual(f.s.workEscalations, []);
});
test('真实拒接、升级、接管闭环：原责任唯一，源业务保持待办，历史原因和实际账号可核验', () => {
  const f = fixture(), a = f.staff('store-manager', '甲'), b = f.staff('store-manager', '乙'); f.claim(a);
  const original = structuredClone({ bookings: f.s.bookings, goods: f.s.goods, skus: f.s.skus, bills: f.s.bills });
  f.action(a, 'work-escalation.decline', ASSIST, { reason: '本班次无法继续负责，申请交接' });
  assert.equal(f.row(b).status, 'declined'); assert.equal(f.task(b).ownerAccountId, a.accountId); assert.equal(f.task(b).status, 'open');
  f.raise(b, b, ASSIST, 'owner-refused'); assert.equal(f.row(b).canTakeover, true); assert.equal(f.task(b).ownerAccountId, a.accountId);
  f.action(b, 'work-escalation.takeover', ASSIST, { reason: '核对实际班次后本人接管' });
  assert.equal(f.row(b).status, 'taken-over'); assert.equal(f.task(b).ownerAccountId, b.accountId); assert.equal(f.s.workTaskAssignments.filter(x => x.id === ASSIST).length, 1); assert.equal(f.task(b).status, 'open');
  assert.deepEqual({ bookings: f.s.bookings, goods: f.s.goods, skus: f.s.skus, bills: f.s.bills }, original);
  const r = f.s.workEscalations[0]; assert.equal(r.history.length, 3); assert.equal(r.history[0].declinedBy.accountId, a.accountId); assert.equal(r.history[1].notification, 'local-request-only'); assert.equal(r.history[2].acceptedBy.accountId, b.accountId); assert.equal(r.originDueAt, null); assert.doesNotMatch(JSON.stringify(r), /sessionId/);
});
test('停用原负责人后真实失效升级；旧会话连请求重放都失权，接管仍走原分派', () => {
  const f = fixture(), a = f.staff('store-manager', '甲'), b = f.staff('store-manager', '乙'); f.claim(a);
  const p = f.payload(a); f.run(a, 'work-escalation.decline', p); f.revoke(a); assert.equal(f.row(b).owner.valid, false); assert.ok(f.row(b).causes.includes('owner-invalid'));
  assert.throws(() => f.run(a, 'work-escalation.decline', p), /失效/); f.raise(b, b, ASSIST, 'owner-invalid'); f.action(b, 'work-escalation.takeover'); assert.equal(f.row(b).owner.valid, true); assert.equal(f.task(b).ownerAccountId, b.accountId);
});
test('拒接只能是当前可核验本人，说明不可为空，拒接不解绑原责任', () => {
  const f = fixture(), a = f.staff('store-manager', '甲'), b = f.staff('store-manager', '乙');
  assert.throws(() => f.action(a, 'work-escalation.decline'), /本人负责人/); f.claim(a); assert.throws(() => f.action(b, 'work-escalation.decline'), /本人负责人/);
  const before = structuredClone(f.s); assert.throws(() => f.action(a, 'work-escalation.decline', ASSIST, { reason: '' }), /原因/); assert.deepEqual(f.s, before); f.action(a, 'work-escalation.decline'); assert.equal(f.task(a).ownerAccountId, a.accountId);
});
test('期限原因须实际原截止已到；无原SLA不能借升级添加期限', () => {
  const f = fixture(), a = f.staff('store-manager'), initial = f.s.bookings[0].round.deadline;
  assert.throws(() => f.raise(a, a, ASSIST, 'overdue'), /不符合/); assert.throws(() => f.raise(a, a, DISPATCH, 'overdue'), /不符合/);
  f.edit(s => s.now = initial); f.raise(a, a, DISPATCH, 'overdue'); f.action(a, 'work-escalation.takeover', DISPATCH); assert.equal(f.s.bookings[0].round.deadline, initial); assert.equal(f.row(a, DISPATCH).record.originDueAt, initial); assert.equal(f.s.bookings[0].status, 'waiting');
  f.raise(a, a, ASSIST); assert.equal(f.row(a).record.originDueAt, null); assert.equal(f.row(a).task.dueAt, null);
});
test('升级条件与接收岗位逐案复核，未拒接未失效不可假选原因', () => {
  const f = fixture(), a = f.staff('store-manager'), foreign = f.staff('store-manager', '外店', 'silver'), finance = f.staff('store-finance');
  for (const cause of ['owner-invalid', 'owner-refused', 'invented']) assert.throws(() => f.raise(a, a, ASSIST, cause), /不符合/);
  for (const target of [foreign, finance]) assert.throws(() => f.raise(a, target), /授权|读取范围/);
  assert.throws(() => f.raise(a, a, ASSIST, 'manual-review', { reason: '' }), /原因/);
});
test('派单集团可接收协调，但没有门店派单权；原门店账号实际接管才能成立', () => {
  const f = fixture(), a = f.staff('store-manager'), support = f.staff('support');
  f.raise(a, support, DISPATCH); const r = f.row(support, DISPATCH); assert.equal(r.receiverValid, true); assert.equal(r.canTakeover, false); assert.equal(r.candidates.find(x => x.accountId === support.accountId).canHandle, false);
  assert.throws(() => f.action(support, 'work-escalation.takeover', DISPATCH), /无原事项.*办理权/); assert.equal((f.s.workTaskAssignments || []).length, 0);
  f.raise(a, a, DISPATCH); f.action(a, 'work-escalation.takeover', DISPATCH); assert.equal(f.task(a, DISPATCH).ownerAccountId, a.accountId);
});
test('不能冒名接管：只有当前有效接收账号本人，payload目标字段不扩权', () => {
  const f = fixture(), a = f.staff('store-manager'), b = f.staff('store-manager', '乙'), c = f.staff('store-manager', '丙'); f.raise(a, b);
  assert.throws(() => f.action(c, 'work-escalation.takeover', ASSIST, { accountId: b.accountId, grantId: b.grantId }), /当前有效接收账号/);
  f.action(b, 'work-escalation.takeover', ASSIST, { accountId: c.accountId, grantId: c.grantId }); assert.equal(f.task(a).ownerAccountId, b.accountId);
});
test('自由演示、外店、无关岗位、账号管理员和伪造actor不能登记越界升级', () => {
  const f = fixture(), a = f.staff('store-manager'), foreign = f.staff('store-manager', '外店', 'silver'), finance = f.staff('store-finance'), p = f.payload(a, ASSIST, { cause: 'manual-review', accountId: a.accountId, grantId: a.grantId });
  for (const actor of [{ role: 'store', storeId: 'xingfu' }, foreign, finance, f.admin, user, { role: 'tech', techId: 'lin' }, { ...foreign, role: 'group', job: 'support', storeId: 'xingfu' }]) assert.throws(() => f.run(actor, 'work-escalation.raise', p), /实际工作账号|无权|岗位|身份/);
  assert.equal(f.s.workEscalations?.length || 0, 0);
});
test('同账号新会话稳定请求幂等；同请求内容变动、版本缺失或旧版本拒绝', () => {
  const f = fixture(), a = f.staff('store-manager'), p = f.payload(a, ASSIST, { cause: 'manual-review', accountId: a.accountId, grantId: a.grantId, requestId: 'stable' });
  const first = f.run(a, 'work-escalation.raise', p), again = f.run(user, 'account.enter', { accountId: a.accountId, grantId: a.grantId });
  assert.deepEqual(f.run(again, 'work-escalation.raise', p), first); assert.equal(f.s.workEscalations[0].version, 1); assert.equal(f.s.workEscalationRequests.length, 1);
  assert.throws(() => f.run(a, 'work-escalation.raise', { ...p, reason: '变更内容' }), /同一提交/);
  for (const override of [{ version: '' }, { version: -1 }, { version: 0 }, { assignmentVersion: undefined }, { ownerToken: 'old' }, { sourceToken: 'old' }]) assert.throws(() => f.action(a, 'work-escalation.raise', ASSIST, { cause: 'manual-review', accountId: a.accountId, grantId: a.grantId, ...override }), /版本|更新/);
});
test('接管响应重试保留同一原分派版本，源阶段改变或失权后不回放代办', () => {
  const f = fixture(), a = f.staff('store-manager'); f.raise(a); const p = f.payload(a, ASSIST, { requestId: 'takeover-retry' }), first = f.run(a, 'work-escalation.takeover', p), version = f.task(a).assignmentVersion;
  assert.deepEqual(f.run(a, 'work-escalation.takeover', p), first); assert.equal(f.task(a).assignmentVersion, version); assert.equal(f.s.workEscalations[0].history.length, 2);
  f.edit(s => s.bookings[0].assistance[0].status = 'closed'); assert.throws(() => f.run(a, 'work-escalation.takeover', p), /办理权/); f.revoke(a); assert.throws(() => f.run(a, 'work-escalation.takeover', p), /失效/);
});
test('源阶段变更不自动沿用升级；负责人变化也需以最新源与责任重新升级', () => {
  const f = fixture(), a = f.staff('store-manager'), b = f.staff('store-manager', '乙'); f.raise(a, b, DISPATCH); const p = f.payload(b, DISPATCH);
  f.edit(s => s.bookings[0].techId = 'zhou'); assert.equal(f.row(b, DISPATCH).status, 'source-changed'); assert.equal(f.row(b, DISPATCH).canTakeover, false); assert.throws(() => f.run(b, 'work-escalation.takeover', p), /更新/);
  f.raise(a, b, DISPATCH); f.claim(a, DISPATCH); assert.equal(f.row(b, DISPATCH).status, 'source-changed'); f.raise(a, b, DISPATCH); f.action(b, 'work-escalation.takeover', DISPATCH); assert.equal(f.task(a, DISPATCH).ownerAccountId, b.accountId); assert.equal(f.s.workEscalations[0].history.length, 4);
});
test('接收授权撤销令旧请求待重核，不能换岗重放或绕过源权限', () => {
  const f = fixture(), a = f.staff('store-manager'), b = f.staff('store-manager', '乙'); f.raise(a, b); const p = f.payload(b); f.revoke(b);
  assert.equal(f.row(a).receiverValid, false); assert.throws(() => f.run(b, 'work-escalation.takeover', p), /失效/);
  f.raise(a, a); f.action(a, 'work-escalation.takeover'); assert.equal(f.task(a).ownerAccountId, a.accountId);
});
test('实际来源结束只读推导，升级记录不能假标原事项完成', () => {
  const f = fixture(), a = f.staff('store-manager'); f.raise(a); const p = f.payload(a); f.edit(s => s.bookings[0].assistance[0].status = 'closed');
  const before = structuredClone(f.s), r = f.row(a); assert.equal(r.status, 'source-done'); assert.equal(r.record.status, 'raised'); assert.equal(r.canRaise, false); assert.equal(r.canTakeover, false); assert.deepEqual(f.s, before);
  for (const type of ['work-escalation.raise', 'work-escalation.takeover', 'work-escalation.done']) assert.throws(() => f.run(a, type, p), /结束|办理权|不支持/);
});
test('技师或用户等待阶段不能通过任务接管获得源命令权，原期限保持', () => {
  const f = fixture(), a = f.staff('store-manager'); f.edit(s => s.bookings[0].confirmationPhase = 'tech'); f.raise(a, a, DISPATCH); assert.equal(f.row(a, DISPATCH).task.status, 'waiting'); assert.equal(f.row(a, DISPATCH).canTakeover, false); assert.throws(() => f.action(a, 'work-escalation.takeover', DISPATCH), /办理权/); assert.equal(f.s.bookings[0].round.techDeadline, f.row(a, DISPATCH).task.dueAt);
});
test('native 姓名不猜工作账号，转派操作人不是接收人，实际认领账号才能拒接', () => {
  const f = fixture(), a = f.staff('store-manager'), id = f.care(); f.edit(s => { const c = s.serviceCareCases[0]; c.assignee = { scope: 'store', name: '姓名与账号同名', claimedAt: null, by: { accountId: a.accountId, grantId: a.grantId } }; });
  let r = f.row(a, id); assert.equal(r.owner.accountId, null); assert.equal(r.owner.unverified, true); assert.equal(r.canDecline, false); assert.throws(() => f.action(a, 'work-escalation.decline', id), /本人负责人/);
  f.run(a, 'care.task-claim', { entity: 'case', id: f.s.serviceCareCases[0].id, version: f.s.serviceCareCases[0].version, name: '本人真实认领' }); r = f.row(a, id); assert.equal(r.owner.accountId, a.accountId); assert.equal(r.owner.valid, true); f.action(a, 'work-escalation.decline', id); assert.equal((f.s.workTaskAssignments || []).length, 0);
});
test('native 安全实际接报仍未结案，未接报原deadline保留；无适配拒绝且不建立平行owner', () => {
  const f = fixture(), a = f.staff('support'); f.safety(); assert.equal(f.row(a, SAFETY).task.dueAt, f.s.safety[0].ackDeadline); assert.equal(f.row(a, SAFETY).owner.unverified, true);
  f.safety(a); const r = f.row(a, SAFETY); assert.equal(r.owner.accountId, a.accountId); assert.equal(r.task.dueAt, null); assert.equal(r.task.status, 'open'); f.raise(a, a, SAFETY); const before = structuredClone(f.s);
  assert.throws(() => f.action(a, 'work-escalation.takeover', SAFETY), /尚未接通/); assert.deepEqual(f.s, before); assert.equal((f.s.workTaskAssignments || []).length, 0);
});
test('native bridge 必須真实源owner，假返回或平行任务owner被事务拒绝', () => {
  const f = fixture(), a = f.staff('support'), b = f.staff('support', '乙'); f.safety(a); f.raise(a, b, SAFETY); const before = structuredClone(f.s);
  assert.throws(() => f.action(b, 'work-escalation.takeover', SAFETY, {}, () => ({ accountId: b.accountId })), /未保存/); assert.deepEqual(f.s, before);
  assert.throws(() => f.action(b, 'work-escalation.takeover', SAFETY, {}, s => { (s.workTaskAssignments ??= []).push({ id: SAFETY, accountId: b.accountId }); }), /第二份/); assert.deepEqual(f.s, before);
  assert.throws(() => f.action(b, 'work-escalation.takeover', SAFETY, {}, () => Promise.resolve()), /同步保存/); assert.deepEqual(f.s, before);
});
test('native 受控接管核验真实源owner且保留历史ack；质量唯一原assignee换人仍未完成', () => {
  const f = fixture(), a = f.staff('support'), b = f.staff('support', '乙'); f.safety(a); const ack = structuredClone(f.s.safety[0].acknowledgedBy); f.raise(a, b, SAFETY); f.action(b, 'work-escalation.takeover', SAFETY, {}, f.nativeBridge);
  assert.deepEqual(f.s.safety[0].acknowledgedBy, ack); assert.equal(f.s.safety[0].responsibility.accountId, b.accountId); assert.equal(f.row(b, SAFETY).owner.accountId, b.accountId); assert.equal((f.s.workTaskAssignments || []).length, 0); assert.equal(f.s.safety[0].status, 'open');
  const local = f.staff('store-manager'), id = f.care(); f.raise(local, local, id); const due = f.row(local, id).task.dueAt; f.action(local, 'work-escalation.takeover', id, {}, f.nativeBridge); assert.equal(f.row(local, id).owner.accountId, local.accountId); assert.equal(f.row(local, id).task.dueAt, due); assert.equal(f.s.serviceCareCases[0].status, 'store_pending'); assert.equal((f.s.workTaskAssignments || []).length, 0);
});
test('native 接管不能代办完成、换业务阶段或重置原期限', () => {
  const f = fixture(), a = f.staff('store-manager'), id = f.care(); f.raise(a, a, id); const before = structuredClone(f.s);
  for (const mutate of [s => s.serviceCareCases[0].status = 'closed', s => s.serviceCareCases[0].status = 'user_pending', s => s.serviceCareCases[0].storeDueAt += 3600000]) assert.throws(() => f.action(a, 'work-escalation.takeover', id, {}, (s, x) => { f.nativeBridge(s, x); mutate(s); }), /代替|阶段|截止/);
  assert.deepEqual(f.s, before);
});
test('安全离开原授权快照失效也纳入升级，沿原nativeOwnerValid而非姓名猜测', () => {
  const f = fixture(), a = f.staff('support'); f.edit(s => { s.bookings[0].status = 'done'; s.bookings[0].completedAt = s.now; s.fulfilmentDepartures = [{ id: 'FD1', bookingId: 'B1', storeId: 'xingfu', techId: 'lin', status: 'escalated', version: 1, owner: { accountId: a.accountId, grantId: a.grantId, accountName: '原值班客服' }, escalatedAt: s.now, contactDueAt: null, escalationDueAt: null, history: [] }]; });
  const r = f.row(a, 'fulfilment-exit:FD1:safety'); assert.equal(r.owner.accountId, a.accountId); assert.equal(r.owner.valid, false); assert.ok(r.causes.includes('owner-invalid')); assert.equal(r.canDecline, false);
});
test('最长稳定请求可实际接管，不把跨模块requestId长度变成隐蔽失败', () => {
  const f = fixture(), a = f.staff('store-manager'); f.raise(a); f.action(a, 'work-escalation.takeover', ASSIST, { requestId: 'a'.repeat(260) }); assert.equal(f.task(a).ownerAccountId, a.accountId); assert.equal(f.s.workTaskRequests.at(-1).requestId.length, 280);
  assert.throws(() => f.action(a, 'work-escalation.raise', ASSIST, { requestId: 'a'.repeat(261) }), /唯一提交标识/);
});

const e = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ui = (ready = false) => ({ esc: e, date: at => new Date(at).toISOString(), nativeWorkTakeoverReady: () => ready, button: (label, command, p = {}, kind = '') => `<button type="button" class="${e(kind)}" data-command="${e(command)}" data-payload="${e(JSON.stringify(p))}">${e(label)}</button>`, link: (label, path, kind = '') => `<a class="${e(kind)}" href="#${e(path)}">${e(label)}</a>`, empty: (label, detail) => `<section><h2>${e(label)}</h2><p>${e(detail)}</p></section>` });
test('UI 用原task-open保留返回协议；反馈只读独立，升级表单携带全部源/责任版本', () => {
  const f = fixture(), a = f.staff('store-manager'); f.claim(a); const r = f.row(a), html = workEscalationPanel(f.s, a, r.task, ui());
  assert.match(html, /data-command="ui.task-open"/); assert.ok(html.includes(e(JSON.stringify({ taskKey: ASSIST })))); assert.match(html, /data-command="work-escalation.decline"/); assert.match(html, /data-command="work-escalation.raise"/); assert.match(html, /name="target" required/); assert.match(html, /name="reason" required maxlength="500"/);
  assert.ok(html.includes(e(JSON.stringify({ id: ASSIST, sourceToken: r.task.sourceToken, ownerToken: r.ownerToken, assignmentVersion: r.assignmentVersion, version: r.version })))); assert.match(html, /data-live-version=/); assert.doesNotMatch(html, /work-escalation\.(done|close)|标记完成|通知已发送/);
  for (const [, attributes] of html.matchAll(/<p\b([^>]*role="status"[^>]*)>/g)) assert.doesNotMatch(attributes, /data-command|role="button"/);
});
test('native UI 缺适配只给回原办理页，明确能力接通才给真实接管表单', () => {
  const f = fixture(), a = f.staff('support'); f.safety(a); f.raise(a, a, SAFETY); const t = f.row(a, SAFETY).task;
  const pending = workEscalationPanel(f.s, a, t, ui()); assert.match(pending, /原业务接管尚未接通/); assert.doesNotMatch(pending, /data-command="work-escalation.takeover"/); assert.match(pending, /data-command="ui.task-open"/);
  assert.match(workEscalationPanel(f.s, a, t, ui(true)), /data-command="work-escalation.takeover"/);
});
test('源更新和完成UI保持准确口径；已接管仍指向原办理、不可人工完成', () => {
  const f = fixture(), a = f.staff('store-manager'); f.raise(a); f.action(a, 'work-escalation.takeover'); let html = workEscalationPanel(f.s, a, f.row(a).task, ui()); assert.match(html, /已接管，原事项继续办理/); assert.match(html, /回原办理页/);
  f.edit(s => s.bookings[0].assistance[0].status = 'closed'); html = workEscalationPanel(f.s, a, f.row(a).task, ui()); assert.match(html, /原事项已结束/); assert.match(html, /查看原记录/); assert.doesNotMatch(html, /data-command="work-escalation\./);
});
test('原事项结束不使接收授权失效；真实停用后仍如实展示失权，末态无操作出口', () => {
  const f = fixture(), a = f.staff('store-manager', '甲'), b = f.staff('store-manager', '乙');
  f.claim(a); f.action(a, 'work-escalation.decline'); f.raise(a, b, ASSIST, 'owner-refused'); f.action(b, 'work-escalation.takeover');
  f.edit(s => s.bookings[0].assistance[0].status = 'closed');
  let row = f.row(a), html = workEscalationPanel(f.s, a, row.task, ui());
  assert.equal(row.status, 'source-done'); assert.equal(row.receiverValid, true); assert.deepEqual(row.candidates, []);
  assert.equal(row.canRaise, false); assert.equal(row.canDecline, false); assert.equal(row.canTakeover, false);
  assert.match(html, /原事项已结束/); assert.doesNotMatch(html, /授权已失效|data-command="work-escalation\./);
  f.revoke(b); row = f.row(a); html = workEscalationPanel(f.s, a, row.task, ui());
  assert.equal(row.status, 'source-done'); assert.equal(row.receiverValid, false); assert.deepEqual(row.candidates, []);
  assert.match(html, /授权已失效/); assert.doesNotMatch(html, /data-command="work-escalation\./);
});
test('升级汇总只沿当前源权限显示，不将保存的门店/路径用于已失权访问', () => {
  const f = fixture(), a = f.staff('store-manager'), foreign = f.staff('store-manager', '外店', 'silver'); f.raise(a); const before = structuredClone(f.s);
  assert.match(workEscalationUiView(f.s, a, ['work-escalations'], ui()), /普通门店协助/); const other = workEscalationUiView(f.s, foreign, ['work-escalations'], ui()); assert.doesNotMatch(other, /AS1|升级核对接收者/); assert.match(other, /当前没有需升级核对的事项/); assert.equal(workEscalationUiView(f.s, a, ['tasks'], ui()), null); assert.deepEqual(f.s, before);
});
test('已经真实结束的来源没有升级记录时，不因旧owner停用重新进入升级队列', () => {
  const f = fixture(), a = f.staff('store-manager'), b = f.staff('store-manager', '乙'); f.claim(a); f.edit(s => s.bookings[0].assistance[0].status = 'closed'); f.revoke(a);
  assert.equal(f.row(b).status, 'source-done'); assert.equal(f.row(b).owner.valid, false); const html = workEscalationUiView(f.s, b, ['work-escalations'], ui()); assert.doesNotMatch(html, /AS1/); assert.match(html, /当前没有需升级核对的事项/);
});
test('UI 对员工姓名、理由转义，不读取业务原文或联系信息，历史保留原期限', () => {
  const f = fixture(), a = f.staff('store-manager', '<img src=x onerror=alert(1)>'); f.claim(a); f.action(a, 'work-escalation.decline', ASSIST, { reason: '<script>交接依据</script>' }); const html = workEscalationUiView(f.s, a, ['work-escalations'], ui());
  assert.match(html, /&lt;img src=x/); assert.match(html, /&lt;script&gt;交接依据&lt;\/script&gt;/); assert.doesNotMatch(html, /<img src=x|<script>|私密原始描述|13812345678/); assert.match(html, /原期限：未设定办理期限/); assert.match(html, /接收核对请求只保存本地记录/);
});
