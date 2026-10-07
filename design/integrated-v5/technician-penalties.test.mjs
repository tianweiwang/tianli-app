import test from 'node:test';
import assert from 'node:assert/strict';
import { upgradeTechnicianPenalties, technicianPenaltyCommand, technicianPenaltyView, technicianPenaltyCaseResolution, technicianPenaltyCaseBlockers, technicianPenaltyTaskRows } from './technician-penalties.mjs';
import { fixture, NOW, HOUR, user, tech, store, support } from './technician-penalties-test-fixture.mjs';

const snapshot = f => JSON.stringify(f.s);
function rejects(f, fn, pattern) { const before = snapshot(f); assert.throws(fn, pattern); assert.equal(snapshot(f), before, 'rejected clone transaction must preserve original source'); }

test('迁移只补空容器，原投诉接受后仍有真实处罚专项待执行，纯读取不改原账', () => {
  const s = { now: NOW, bookings: [{ id: 'OLD', paidCents: 321 }] }, before = structuredClone(s.bookings); upgradeTechnicianPenalties(s); const once = structuredClone(s); upgradeTechnicianPenalties(s); assert.deepEqual(s, once); assert.deepEqual(s.bookings, before);
  const f = fixture(); assert.equal(f.c.status, 'execution_pending'); assert.equal(f.candidate().caseId, f.c.id); assert.equal(technicianPenaltyCaseResolution(f.s, f.c.id, 0).complete, false);
  const saved = snapshot(f); technicianPenaltyView(f.s, store); technicianPenaltyCaseBlockers(f.s, f.c); technicianPenaltyTaskRows(f.s); assert.equal(snapshot(f), saved);
});
test('实际门店警告关联准确原专项并增加案件版本，不改资金资格或伪标completed', () => {
  const f = fixture(), booking = structuredClone(f.s.bookings), techs = structuredClone(f.s.techs), version = f.c.version; f.warning();
  assert.equal(f.row.version, 1); assert.equal(f.c.version, version + 1); assert.equal(f.c.specialistActions[0].penaltyId, f.row.id); assert.equal(f.c.specialistActions[0].status, 'pending'); assert.equal(f.c.status, 'execution_pending');
  assert.deepEqual(f.s.bookings, booking); assert.deepEqual(f.s.techs, techs); assert.equal(f.s.techQualifications, undefined); assert.equal(f.row.decision.by.id, 's1'); assert.equal(f.row.source.caseId, f.c.id); assert.equal(f.row.source.actionIndex, 0);
  assert.equal(technicianPenaltyCaseResolution(f.s, f.c.id, 0).complete, true); assert.deepEqual(technicianPenaltyCaseBlockers(f.s, f.c), []);
});
test('本人一次申诉与集团维持产生真实作者/留痕，专项不新增等待或冻结', () => {
  const f = fixture(); f.warning(); const original = structuredClone(f.row.decision), bookings = structuredClone(f.s.bookings), cv = f.c.version; f.appeal();
  assert.equal(f.current().status, 'appeal_pending'); assert.equal(f.row.appeal.by.id, 't1'); assert.equal(technicianPenaltyCaseResolution(f.s, f.c.id, 0).complete, true);
  assert.equal(technicianPenaltyTaskRows(f.s).length, 1); assert.equal(technicianPenaltyTaskRows(f.s)[0].dueAt, null); f.review();
  assert.equal(f.current().status, 'maintained'); assert.equal(f.row.appeal.review.by.role, 'group'); assert.equal(f.row.appeal.review.by.job, 'support'); assert.equal(f.row.history.length, 3); assert.equal(technicianPenaltyTaskRows(f.s)[0].status, 'done'); assert.deepEqual(technicianPenaltyTaskRows(f.s)[0].commands, []);
  assert.deepEqual(f.row.decision, original); assert.deepEqual(f.s.bookings, bookings); assert.equal(f.c.version, cv); rejects(f, () => f.appeal(), /一次/); rejects(f, () => f.review(), /待集团/);
});
test('集团撤回只追加实际复核，原警告事实和来源继续保留', () => {
  const f = fixture(); f.warning(); const original = structuredClone(f.row.decision), source = structuredClone(f.row.source); f.advance(HOUR); f.appeal(); f.advance(HOUR); f.review({ decision: 'revoke', reason: '集团核查原证据不足，明确撤回警告' });
  assert.equal(f.current().status, 'revoked'); assert.equal(f.row.appeal.review.decision, 'revoke'); assert.deepEqual(f.row.decision, original); assert.deepEqual(f.row.source, source); assert.equal(technicianPenaltyCaseResolution(f.s, f.c.id, 0).status, 'revoked');
});
test('受理但未接受、拒绝、不匹配专项和集团未最终核实不能登记警告', () => {
  for (const options of [{ accepted: false }, { decision: 'reject' }, { action: 'restriction' }, { action: 'retraining' }, { action: 'none' }]) { const f = fixture(options); assert.equal(f.candidate(), undefined); rejects(f, () => f.warning({ caseId: f.c.id, actionIndex: 0 }), /原专项|尚未|未核|核实/); }
  const g = fixture({ responder: support }); assert.equal(g.c.final, true); assert.ok(g.candidate()); g.warning(); assert.equal(technicianPenaltyCaseResolution(g.s, g.c.id, 0).complete, true);
});
test('原用户技师其他店和集团其他岗位不能代店登记或代本人申诉', () => {
  const f = fixture(), p = { ...f.candidate(), reference: 'R', occurredAt: NOW, reason: '实际警告', requestId: 'unauthorized' };
  for (const a of [user, tech, support, { role: 'store', storeId: 's2' }, { role: 'group', job: 'finance' }, { role: 'group', job: 'operations' }, { role: 'group', job: 'warehouse' }]) rejects(f, () => f.run('penalty.warning-record', p, a), /无权/);
  f.warning(); for (const a of [user, store, support, { role: 'tech', techId: 't2' }]) rejects(f, () => f.appeal({}, a), /无权/);
  f.appeal(); for (const a of [store, tech, { role: 'group', job: 'operations' }, { role: 'group', job: 'finance' }]) rejects(f, () => f.review({}, a), /无权/);
});
test('台账按原店及本人授权，当前调店不能转移旧投诉归属，技师不泄内部或客户正文', () => {
  const f = fixture(); f.warning(); f.appeal(); f.review(); f.s.techs[0].storeId = 's2';
  for (const a of [store, support, tech]) assert.equal(technicianPenaltyView(f.s, a).penalties.length, 1);
  for (const a of [user, { role: 'user', userId: 'u2' }, { role: 'store', storeId: 's2' }, { role: 'tech', techId: 't2' }, { role: 'group', job: 'finance' }, { role: 'group', job: 'warehouse' }, { role: 'group', job: 'operations' }]) assert.equal(technicianPenaltyView(f.s, a).penalties.length, 0);
  const v = technicianPenaltyView(f.s, tech); assert.doesNotMatch(JSON.stringify(v), /SECRET|CLIENT-PRIVATE|sourceFingerprint/); assert.match(JSON.stringify(technicianPenaltyView(f.s, store)), /SECRET-INTERNAL-DECISION|SECRET-INTERNAL-REVIEW/);
});
test('真实工作账号入档作者可追溯，载荷角色提示不能伪造集团或跨店', () => {
  const f = fixture(), employee = f.staff(); f.warning({}, { ...employee, role: 'group', job: 'support', storeId: 's2' });
  assert.equal(f.row.decision.by.role, 'store'); assert.equal(f.row.decision.by.id, 's1'); assert.equal(f.row.decision.by.accountId, employee.accountId); assert.equal(f.row.history[0].by.grantId, employee.grantId);
  const g = fixture(), finance = g.staff('store-finance'); rejects(g, () => g.warning({ caseId: g.c.id, actionIndex: 0 }, { ...finance, role: 'store', job: 'store-manager' }), /无权/);
});
test('当前失效会话在读取/命令/旧请求重放前拒绝，不复活原岗位', () => {
  const f = fixture(), employee = f.staff(); f.warning({ requestId: 'account-source' }, employee); const p = { ...f.candidate(employee), caseId: f.c.id, actionIndex: 0, requestId: 'account-source' };
  f.s.staffSessions.find(x => x.id === employee.sessionId).revokedAt = NOW;
  assert.equal(technicianPenaltyView(f.s, employee).canEnter, false); rejects(f, () => f.run('penalty.warning-record', p, employee), /失效/);
  rejects(f, () => f.appeal({}, { role: 'tech', techId: 't1', accountId: 'self-reported' }), /会话缺失/);
});
test('警告和申诉复核永久幂等，改内容同请求/新请求旧版本拒绝', () => {
  const f = fixture(), p = { ...f.candidate(), reference: 'ONCE', occurredAt: NOW, reason: '实际一般警告事实', requestId: 'warning-once' }; const first = f.run('penalty.warning-record', p), before = snapshot(f);
  assert.deepEqual(f.run('penalty.warning-record', p), first); assert.equal(snapshot(f), before); rejects(f, () => f.run('penalty.warning-record', { ...p, reason: '改内容' }), /同一提交/); rejects(f, () => f.run('penalty.warning-record', { ...p, requestId: 'new' }), /版本/);
  const a = { id: f.row.id, version: f.row.version, sourceToken: f.current().sourceToken, reason: '本人申诉', requestId: 'appeal-once' }; f.run('penalty.appeal', a, tech); const beforeAppeal = snapshot(f); f.run('penalty.appeal', a, tech); assert.equal(snapshot(f), beforeAppeal);
  rejects(f, () => f.run('penalty.appeal', { ...a, requestId: 'second' }, tech), /版本/);
  const r = { id: f.row.id, version: f.row.version, sourceToken: f.current(support).sourceToken, decision: 'maintain', reference: 'R', occurredAt: NOW, reason: '实际集团复核', requestId: 'review-once' }; f.run('penalty.appeal-review', r, support); const beforeReview = snapshot(f); f.run('penalty.appeal-review', r, support); assert.equal(snapshot(f), beforeReview);
});
test('旧案件版本和当前源token都精确核验，增加原说明后旧警告表单拒绝', () => {
  const f = fixture(), p = { ...f.candidate(), reference: 'R', occurredAt: NOW, reason: 'warning' }; f.care('care.case-statement', { id: f.c.id, version: f.c.version, text: '用户补充事实' }, user); rejects(f, () => f.run('penalty.warning-record', p), /版本/);
  rejects(f, () => f.warning({ sourceToken: p.sourceToken }), /来源|岗位/); f.warning(); const token = f.current().sourceToken; f.appeal(); rejects(f, () => f.review({ sourceToken: token }), /来源/);
});
test('缺字段和无效发生时间拒绝，选择一般警告不允许夹带未定停单金额', () => {
  for (const p of [{ reference: '' }, { reason: '' }, { occurredAt: '' }, { occurredAt: true }, { occurredAt: NOW + 1 }, { occurredAt: NOW - 1 }, { occurredAt: '2026-02-30T10:00' }, { occurredAt: '2026-10-04T24:00' }, { caseVersion: false }, { actionIndex: false }, { level: 'heavy' }, { action: 'stop' }, { durationDays: 7 }, { fineCents: 0 }, { amountCents: 200 }, { startAt: null }, { endAt: NOW }]) { const f = fixture(); rejects(f, () => f.warning(p)); }
  const f = fixture(); f.warning({ occurredAt: '2026-10-04T10:00' }); assert.equal(f.row.decision.occurredAt, NOW);
});
test('集团复核缺明确决定、来源、理由或有效实际时间不伪造完成', () => {
  const f = fixture(); f.warning(); f.advance(HOUR); f.appeal();
  for (const p of [{ decision: '' }, { decision: false }, { decision: 'approved' }, { reference: '' }, { reason: '' }, { occurredAt: NOW }, { occurredAt: f.s.now + 1 }, { durationDays: 7 }]) rejects(f, () => f.review(p));
  assert.equal(f.current().status, 'appeal_pending'); assert.equal(technicianPenaltyTaskRows(f.s).length, 1);
});
test('原来源、准确专项、核实结果或主体被改都阻断，不接受手写completed', () => {
  const mutations = [f => f.c.source.id = 'B2', f => f.c.specialistActions[0].reason = 'changed', f => f.c.specialistActions[0].by.id = 's2', f => f.c.resolutions[0].decision = 'reject', f => f.c.description = 'replaced-original-fact', f => f.c.confirmedAt++, f => f.s.bookings[0].techId = 't2', f => f.s.bookings[0].completedAt++, f => f.c.specialistActions[0].penaltyId = 'missing', f => f.row.decision.by.role = 'group', f => f.row.createdAt = f.s.now + 1];
  for (const mutate of mutations) { const f = fixture(); f.warning(); mutate(f); assert.equal(technicianPenaltyCaseResolution(f.s, f.c.id, 0).complete, false); assert.ok(technicianPenaltyCaseBlockers(f.s, f.c).length); rejects(f, () => f.appeal()); }
  const missing = fixture(); missing.c.specialistActions[0].status = 'completed'; assert.equal(technicianPenaltyCaseResolution(missing.s, missing.c.id, 0).complete, false); assert.ok(technicianPenaltyCaseBlockers(missing.s, missing.c).length);
});
test('缺失或重复真实来源拒绝，追加别类专项不被警告getter清空', () => {
  for (const mutate of [f => f.s.serviceCareCases.push(structuredClone(f.c)), f => f.s.bookings.push(structuredClone(f.s.bookings[0])), f => f.s.techs.push(structuredClone(f.s.techs[0])), f => f.c.resolutions.push(structuredClone(f.c.resolutions[0]))]) { const f = fixture(); mutate(f); rejects(f, () => f.warning({ caseId: f.c.id, actionIndex: 0 }), /不唯一|缺失/); }
  const f = fixture(); f.warning(); f.c.specialistActions.push({ kind: 'restriction', status: 'pending' }); assert.deepEqual(technicianPenaltyCaseBlockers(f.s, f.c), []); assert.equal(f.c.specialistActions[1].status, 'pending');
});
test('普通结案字段演进不改警告源，本人申诉仍走原决定（隔离closure探针）', () => {
  const f = fixture(); f.warning(); const original = structuredClone(f.row.decision);
  // This isolates the post-close source contract; it is not a real care/reduce acceptance claim.
  f.c.status = 'closed'; f.c.version++; f.c.closedAt = NOW; f.c.history.push({ action: 'isolated-normal-close', at: NOW });
  assert.equal(technicianPenaltyCaseResolution(f.s, f.c.id, 0).complete, true); f.appeal(); f.review({ decision: 'revoke' }); assert.deepEqual(f.row.decision, original);
});
test('原warning容器已有而旧请求容器缺失时兼容补容器，不批量补决定', () => {
  const f = fixture(); f.warning(); delete f.s.technicianPenaltyRequests; f.appeal(); assert.equal(f.s.technicianPenaltyRequests.length, 1); assert.equal(f.s.technicianPenalties.length, 1);
  const before = snapshot(f); assert.equal(technicianPenaltyCommand(f.s, tech, 'penalty.unknown', {}), undefined); assert.equal(snapshot(f), before);
});
test('申诉被伪改维持/撤回或作者/未来时间则任务保留但无伪可执行动作', () => {
  for (const mutate of [f => f.row.appeal.by.id = 't2', f => f.row.appeal.createdAt = NOW + 1, f => f.row.appeal.review = { decision: 'maintain' }, f => f.row.appeal.status = 'maintained']) { const f = fixture(); f.warning(); f.appeal(); mutate(f); assert.equal(technicianPenaltyCaseResolution(f.s, f.c.id, 0).complete, false); rejects(f, () => f.review()); assert.equal(technicianPenaltyTaskRows(f.s)[0].status, 'waiting'); assert.deepEqual(technicianPenaltyTaskRows(f.s)[0].commands, []); }
});
