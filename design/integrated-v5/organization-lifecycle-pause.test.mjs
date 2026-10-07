import test from 'node:test';
import assert from 'node:assert/strict';
import { seed, reduce, createLifecycleContext } from './engine.mjs';
import { storeOpeningReadiness } from './management.mjs';
import { lifecycleImpact } from './organization-lifecycle-projection.mjs';
import { syncLifecycle } from './organization-lifecycle.mjs';
import { lifecyclePauseImpact, lifecyclePauseView, lifecyclePauseSelection, lifecyclePauseEligibility } from './organization-lifecycle-pause.mjs';

const MIN = 60000, HOUR = 60 * MIN, DAY = 24 * HOUR;
const ops = { role: 'group', job: 'operations' }, user = { role: 'user', userId: 'u1' };
const local = { role: 'store', storeId: 'xingfu', job: 'store-manager' };

// Every positive readiness fact comes from the original management and
// qualification commands. Damaged copies below only exercise rejection.
function fixture() {
  let s = seed(), seq = 0;
  const h = {
    get s() { return s; }, get store() { return s.stores.find(x => x.id === 'xingfu'); },
    get tech() { return s.techs.at(-1); }, get c() { return s.organizationLifecycleCases.at(-1); },
    get q() { return s.techQualifications.find(x => x.techId === h.tech.id && x.storeId === 'xingfu'); },
    run(actor, type, p = {}) {
      let result;
      s = reduce(s, actor, type, { requestId: 'pause-real-' + ++seq, reason: '停业隔离原命令验收', ...p }, value => result = value);
      return result;
    },
    advance(minutes) { h.run(user, 'clock.advance', { minutes }); },
    at(time) { h.advance((time - s.now) / MIN); },
    token() { return lifecyclePauseImpact(s, h.store.id, { startAt: s.now, endAt: null }, createLifecycleContext()).sourceToken; },
    plan(extra = {}, actor = local) {
      return h.run(actor, 'lifecycle.store-pause', { storeId: h.store.id, version: h.store.version, sourceToken: h.token(), startAt: s.now + DAY, endAt: s.now + DAY + HOUR, reference: 'PAUSE-ACTUAL-PLAN', ...extra });
    },
    emergency(extra = {}, actor = ops) {
      return h.run(actor, 'lifecycle.store-pause-emergency', { storeId: h.store.id, version: h.store.version, sourceToken: h.token(), reference: 'PAUSE-ACTUAL-EMERGENCY', ...extra });
    },
    resume(extra = {}, actor = ops) {
      const view = lifecyclePauseView(s, h.c.id, createLifecycleContext());
      return h.run(actor, 'lifecycle.store-resume', { id: h.c.id, version: h.c.version, sourceToken: view.sourceToken, reference: 'PAUSE-ACTUAL-RESUME', ...extra });
    },
    qualify(type, p = {}, actor = local) { return h.run(actor, 'qualification.' + type, { techId: h.tech.id, version: h.q?.version || 0, ...p }); },
    saveStore(p = {}) { return h.run(ops, 'manage.store-save', { ...h.store, ...p }); }
  };
  h.advance(1);
  h.run(local, 'manage.tech-save', { name: '停业原资格师傅', phone: '13800007481', storeId: 'xingfu', gender: 'female', lat: 31.23, lng: 121.47, serviceIds: ['neck'], certificate: 'PAUSE-CERT-ACTUAL', insurance: 'PAUSE-INSURANCE-ACTUAL', validUntil: '2027-12-31' });
  h.run(ops, 'manage.tech-review', { id: h.tech.id, version: h.tech.version, decision: 'approve' });
  h.qualify('assess', { serviceIds: ['neck'], batch: '停业原考核名单', assessor: '隔离考核人', proof: 'PAUSE-ASSESS-ACTUAL', occurredAt: s.now, result: 'pass', kind: 'initial' });
  h.qualify('request', { assessmentId: h.q.assessments.at(-1).id });
  h.qualify('review', { grantId: h.q.grants.at(-1).id, decision: 'approve', reviewer: '原集团审核人', proof: 'PAUSE-GRANT-ACTUAL' }, ops);
  h.saveStore({ contact: '原门店负责人', phone: '13800007482', qualification: 'PAUSE-STORE-QUAL', merchantNo: 'PAUSE-STORE-MERCHANT' });
  assert.equal(storeOpeningReadiness(s, h.store).ready, true);
  return h;
}

test('普通停业须真实24小时、明确合法结束且不提前改变营业', () => {
  const h = fixture(), before = structuredClone(h.s);
  for (const p of [{ startAt: h.s.now + DAY - 1 }, { endAt: null }, { endAt: h.s.now + DAY }, { startAt: '2026-02-30T09:00' }]) {
    assert.throws(() => h.plan(p), /24小时|结束|无效/);
    assert.deepEqual(h.s, before);
  }
  h.plan(); assert.equal(h.c.startAt, h.s.now + DAY); assert.equal(h.c.stage, 'planned');
  assert.equal(h.store.active, true); assert.equal(h.store.pauseCaseId, undefined);
  assert.match(h.c.pauseBasis.sourceToken, /^sha256:[a-f0-9]{64}$/);
});

test('重叠拒绝、相邻允许，原时钟按顺序实际停业并恢复', () => {
  const h = fixture(); h.plan(); const first = h.c.id, start = h.c.startAt, end = h.c.endAt;
  assert.throws(() => h.plan({ startAt: start + MIN, endAt: end + MIN }), /重叠/);
  h.plan({ startAt: end, endAt: end + HOUR }); const second = h.c.id;
  h.at(start); assert.equal(h.store.active, false); assert.equal(h.store.pauseCaseId, first);
  h.at(end); assert.equal(h.s.organizationLifecycleCases.find(x => x.id === first).stage, 'completed');
  assert.equal(h.store.active, false); assert.equal(h.store.pauseCaseId, second);
  h.at(end + HOUR); assert.equal(h.store.active, true); assert.equal(h.c.stage, 'completed');
  assert.equal(h.c.resumedAt, end + HOUR);
});

test('未生效取消沿原版本/指纹/稳定提交幂等，保留原记录', () => {
  const h = fixture(); h.plan(); const p = { id: h.c.id, version: h.c.version, sourceToken: h.token(), requestId: 'PAUSE-CANCEL-STABLE' };
  const result = h.run(local, 'lifecycle.store-pause-cancel', p), snapshot = structuredClone(h.s);
  assert.equal(result.stage, 'cancelled'); assert.equal(h.store.active, true);
  assert.deepEqual(h.run(local, 'lifecycle.store-pause-cancel', p), result);
  assert.deepEqual({ ...h.s, revision: snapshot.revision }, snapshot);
  assert.throws(() => h.run(local, 'lifecycle.store-pause-cancel', { ...p, reason: '同提交换内容' }), /同一提交标识/);
  assert.ok(h.c.history.some(x => x.action === 'lifecycle.store-pause-cancel'));
});

test('原计划到点后不能撤回，也不能经组织complete伪装恢复', () => {
  const h = fixture(); h.plan(); h.at(h.c.startAt);
  const before = structuredClone(h.s);
  assert.throws(() => h.run(local, 'lifecycle.store-pause-cancel', { id: h.c.id, version: h.c.version, sourceToken: h.token() }), /已生效|起点/);
  assert.throws(() => h.run(ops, 'lifecycle.complete', { id: h.c.id, version: h.c.version, sourceToken: h.token() }), /停业|恢复/);
  assert.deepEqual(h.s, before);
});

test('集团紧急停业按实际now生效，不设默认期限且店方不能紧急或恢复', () => {
  const h = fixture(), before = structuredClone(h.s);
  assert.throws(() => h.emergency({}, local), /岗位|无权/); assert.deepEqual(h.s, before);
  const now = h.s.now; h.emergency({ startAt: now + DAY });
  assert.equal(h.c.startAt, now); assert.equal(h.c.endAt, null); assert.equal(h.c.appliedAt, now);
  assert.equal(h.store.active, false); assert.equal(h.store.pauseCaseId, h.c.id);
  assert.equal(lifecyclePauseSelection(h.s, h.store.id, createLifecycleContext()).bookable, false);
  assert.throws(() => h.resume({}, local), /岗位|无权/);
  h.resume(); assert.equal(h.store.active, true); assert.equal(h.c.resumedAt, now);
  assert.equal(h.c.history.at(-1).occurredAt, now);
});

test('当前原事实变化使旧停业提交失效，不靠去来源弱化指纹', () => {
  const h = fixture(), stale = { storeId: h.store.id, version: h.store.version, sourceToken: h.token(), reference: 'PAUSE-STALE', startAt: h.s.now + DAY, endAt: h.s.now + DAY + HOUR };
  h.qualify('pause', { serviceIds: ['neck'], owner: '真实复训负责人' });
  const before = structuredClone(h.s);
  assert.throws(() => h.run(local, 'lifecycle.store-pause', stale), /来源已变化/); assert.deepEqual(h.s, before);
  assert.notEqual(h.token(), stale.sourceToken); assert.match(h.token(), /^sha256:/);
  assert.doesNotMatch(h.token(), /PAUSE-CERT|PAUSE-GRANT|amountCents/);
});

test('有限实际暂停可继续未选时间流程，查询不选now也不写真实状态', () => {
  const h = fixture(); h.emergency({ endAt: h.s.now + HOUR }); const before = structuredClone(h.s);
  const selection = lifecyclePauseSelection(h.s, h.store.id, createLifecycleContext());
  assert.deepEqual(selection, { bookable: true, resumeAt: h.c.endAt, reason: '' });
  assert.equal(selection.startAt, undefined); assert.equal(h.store.active, false);
  assert.equal(lifecyclePauseEligibility(h.s, h.store.id, { startAt: h.c.endAt, endAt: h.c.endAt + HOUR }, createLifecycleContext()).canBookOutsideWhilePaused, true);
  assert.deepEqual(h.s, before);
});

test('未来选店来源缺getter、损坏basis、重复case、非法clock和未知store均拒绝且不修源', () => {
  const h = fixture(); h.emergency({ endAt: h.s.now + HOUR });
  assert.equal(lifecyclePauseSelection(h.s, h.store.id, {}).bookable, false);
  const mutations = [s => { delete s.organizationLifecycleCases[0].pauseBasis; }, s => { s.organizationLifecycleCases[0].endAt++; }, s => { s.organizationLifecycleCases.push(structuredClone(s.organizationLifecycleCases[0])); }, s => { s.now = NaN; }, s => { s.stores.push(structuredClone(s.stores[0])); }];
  for (const damage of mutations) {
    const s = structuredClone(h.s); damage(s); const before = structuredClone(s);
    assert.equal(lifecyclePauseSelection(s, h.store.id, createLifecycleContext()).bookable, false);
    assert.deepEqual(s, before);
  }
  assert.equal(lifecyclePauseSelection(h.s, 'unknown', createLifecycleContext()).bookable, false);
});

test('完整时段两端按原半开区间核验，未知跨度不补0', () => {
  const h = fixture(); h.plan(); const { startAt, endAt } = h.c, ctx = createLifecycleContext();
  for (const [start, end, blocked] of [[startAt - HOUR, startAt, false], [startAt - MIN, startAt + MIN, true], [endAt - MIN, endAt + MIN, true], [endAt, endAt + HOUR, false]]) {
    assert.equal(lifecyclePauseEligibility(h.s, h.store.id, { startAt: start, endAt: end }, ctx).blocked, blocked);
  }
  for (const p of [{ startAt }, { startAt, endAt: startAt }, { startAt: 'unknown', endAt }]) assert.equal(lifecyclePauseEligibility(h.s, h.store.id, p, ctx).blocked, true);
});

test('缺原预约或独立履约来源容器保持待核对，查询不创建容器', () => {
  const h = fixture();
  for (const key of ['bookings', 'fulfilmentRecords']) {
    const s = structuredClone(h.s); delete s[key]; const before = structuredClone(s);
    const view = lifecyclePauseImpact(s, h.store.id, { startAt: s.now, endAt: null }, createLifecycleContext());
    assert.ok(view.blockers.some(x => x.kind === 'pause-source' && x.reason.includes(key)));
    assert.deepEqual(s, before);
  }
});

test('真实独立资格暂停阻断自动恢复，原复训授权和恢复后才能恢复营业', () => {
  const h = fixture(); h.plan(); const end = h.c.endAt; h.at(h.c.startAt);
  h.qualify('pause', { serviceIds: ['neck'], owner: '真实复训负责人' }); const holdId = h.q.holds.at(-1).id;
  assert.equal(lifecyclePauseSelection(h.s, h.store.id, createLifecycleContext()).bookable, false);
  h.at(end); assert.equal(h.store.active, false); assert.equal(h.c.stage, 'effective');
  assert.match(h.c.effectBlockedReason, /营业条件|独立项目资格/); assert.equal(lifecyclePauseView(h.s, h.c.id, createLifecycleContext()).canResume, false);
  h.qualify('assess', { serviceIds: ['neck'], batch: '原暂停后复训名单', assessor: '实际复训人', proof: 'PAUSE-RETRAIN-ACTUAL', occurredAt: h.s.now, result: 'pass', kind: 'retraining', holdId });
  h.qualify('request', { assessmentId: h.q.assessments.at(-1).id });
  h.qualify('review', { grantId: h.q.grants.at(-1).id, decision: 'approve', reviewer: '实际恢复审核人', proof: 'PAUSE-RETRAIN-GRANT' }, ops);
  h.qualify('resume', { holdId, reviewer: '实际集团恢复人' }, ops);
  assert.equal(lifecyclePauseView(h.s, h.c.id, createLifecycleContext()).canResume, true);
  h.advance(1);
  assert.equal(h.store.active, true); assert.equal(h.c.stage, 'completed');
  assert.equal(h.c.effectBlockedReason, undefined); assert.ok(h.c.history.some(x => x.action === 'pause-blocked'));
  assert.equal(h.q.holds.at(-1).status, 'resolved');
});

test('普通手动暂停在计划生效前发生，不被期限自动重开', () => {
  const h = fixture(); h.plan(); const start = h.c.startAt, end = h.c.endAt;
  h.run(ops, 'manage.store-status', { id: h.store.id, version: h.store.version, status: 'pause' });
  h.at(start); assert.equal(h.c.autoResumeOwned, false); h.at(end);
  assert.equal(h.store.active, false); assert.equal(h.c.stage, 'effective'); assert.match(h.c.effectBlockedReason, /另行暂停/);
  h.resume(); assert.equal(h.store.active, true); assert.equal(h.c.stage, 'completed'); assert.equal(h.c.effectBlockedReason, undefined);
});

test('原资质/收款主体变化须原审核核验，不自动恢复，显式恢复仍用原getter', () => {
  const h = fixture(); h.plan(); h.at(h.c.startAt); const end = h.c.endAt;
  h.saveStore({ merchantNo: 'PAUSE-NEW-ACTUAL-MERCHANT' }); assert.equal(h.store.reviewStatus, 'pending');
  h.at(end); assert.equal(h.store.active, false); assert.match(h.c.effectBlockedReason, /审核|主体/);
  assert.throws(() => h.run(ops, 'manage.store-status', { id: h.store.id, version: h.store.version, status: 'open' }), /停业案/);
  assert.equal(lifecyclePauseView(h.s, h.c.id, createLifecycleContext()).canResume, true);
  h.resume({ reference: 'PAUSE-NEW-MERCHANT-VERIFIED' }); assert.equal(h.store.reviewStatus, 'approved'); assert.equal(h.store.active, true);
});

test('缺真实营业getter阻断到期恢复；正常时钟保留实际暂停和原因', () => {
  const h = fixture(); h.plan(); h.at(h.c.startAt);
  const s = structuredClone(h.s); s.now = h.c.endAt;
  syncLifecycle(s, {}); assert.equal(s.stores.find(x => x.id === h.store.id).active, false);
  assert.equal(s.organizationLifecycleCases[0].stage, 'effective'); assert.match(s.organizationLifecycleCases[0].effectBlockedReason, /适配尚未接齐/);
});

test('原关停实际替代停业恢复能力，截止之后仍不重开且历史保留', () => {
  const h = fixture(); h.emergency({ endAt: h.s.now + HOUR }); const pauseId = h.c.id, end = h.c.endAt;
  const impact = lifecycleImpact(h.s, { storeId: h.store.id }, createLifecycleContext());
  h.run(ops, 'lifecycle.store-close-start', { storeId: h.store.id, version: h.store.version, sourceToken: impact.sourceToken, reference: 'PAUSE-ACTUAL-CLOSE' });
  const pause = h.s.organizationLifecycleCases.find(x => x.id === pauseId);
  assert.equal(pause.stage, 'completed'); assert.equal(pause.supersededBy, h.c.id); assert.ok(pause.history.some(x => x.action === 'pause-superseded'));
  h.at(end); assert.equal(h.store.active, false); assert.equal(h.store.lifecycleStatus, 'closing');
  assert.equal(lifecyclePauseSelection(h.s, h.store.id, createLifecycleContext()).bookable, false);
  assert.throws(() => h.run(ops, 'lifecycle.store-resume', { id: pause.id, version: pause.version, sourceToken: h.token(), reference: 'invalid-reopen' }), /关闭|关停|实际暂停/);
});

test('实际工作账号只能办理本店普通停业，原授权撤销后旧会话拒绝', () => {
  const h = fixture(), admin = h.run(user, 'account.enter', { accountId: 'DEMO-ADMIN', grantId: 'DEMO-ADMIN-GRANT' });
  let a = h.run(admin, 'account.create', { name: '真实停业门店主管' });
  a = h.run(admin, 'account.grant', { id: a.id, version: a.version, job: 'store-manager', storeId: h.store.id });
  const grant = a.grants.at(-1), actor = h.run(user, 'account.enter', { accountId: a.id, grantId: grant.id });
  h.plan({}, actor); const before = structuredClone(h.s);
  assert.throws(() => h.emergency({}, actor), /岗位|无权/);
  assert.throws(() => h.plan({ storeId: 'silver', version: h.s.stores.find(x => x.id === 'silver').version }, actor), /岗位|无权/);
  assert.deepEqual(h.s, before);
  a = h.s.staffAccounts.find(x => x.id === a.id); h.run(admin, 'account.revoke', { id: a.id, version: a.version, grantId: grant.id });
  assert.throws(() => h.run(actor, 'lifecycle.store-pause-cancel', { id: h.c.id, version: h.c.version, sourceToken: h.token() }), /失效/);
});

test('到期当前ready恢复跳过本案自动写，仍拒旧token/版本/伪ready和越权，其他案仍同步', () => {
  const h = fixture(); h.emergency({ endAt: h.s.now + HOUR }); const target = h.c.id, end = h.c.endAt;
  h.run(ops, 'manage.tech-review', { id: h.tech.id, version: h.tech.version, decision: 'pause' });
  h.at(end); const stale = lifecyclePauseView(h.s, target, createLifecycleContext());
  h.saveStore({ merchantNo: 'PAUSE-REAL-CHANGED-MERCHANT' });
  h.run(ops, 'manage.tech-review', { id: h.tech.id, version: h.tech.version, decision: 'approve' });
  const fresh = lifecyclePauseView(h.s, target, createLifecycleContext()); assert.equal(fresh.canResume, true);
  assert.notEqual(fresh.sourceToken, stale.sourceToken); assert.match(h.c.effectBlockedReason, /营业条件/);
  const base = { id: target, version: fresh.version, sourceToken: fresh.sourceToken, reference: 'PAUSE-REAL-FRESH-RESUME' }, before = structuredClone(h.s);
  for (const p of [{ version: fresh.version - 1 }, { sourceToken: stale.sourceToken }, { sourceToken: 'forged', ready: true, skipPreSync: true }]) {
    assert.throws(() => h.run(ops, 'lifecycle.store-resume', { ...base, ...p }), /已更新|来源已变化/); assert.deepEqual(h.s, before);
  }
  for (const a of [user, local, { role: 'group', job: 'finance' }, { role: 'group', job: 'support' }]) {
    assert.throws(() => h.run(a, 'lifecycle.store-resume', base), /岗位|无权|身份/); assert.deepEqual(h.s, before);
  }
  const silver = h.s.stores.find(x => x.id === 'silver'), peerSource = lifecyclePauseImpact(h.s, silver.id, { startAt: h.s.now, endAt: null }, createLifecycleContext()).sourceToken;
  h.run(ops, 'lifecycle.store-pause-emergency', { storeId: silver.id, version: silver.version, sourceToken: peerSource, endAt: h.s.now + MIN, reference: 'PAUSE-OTHER-STORE' });
  // On an isolated copy, prove the internal exception only excludes its exact
  // target; another due case still records the real missing opening source.
  const copy = structuredClone(h.s), peer = copy.organizationLifecycleCases.at(-1), targetRow = copy.organizationLifecycleCases.find(x => x.id === target), oldVersion = targetRow.version;
  copy.now += MIN; syncLifecycle(copy, createLifecycleContext(), { type: 'lifecycle.store-resume', id: target });
  assert.equal(targetRow.version, oldVersion); assert.equal(peer.stage, 'effective'); assert.match(peer.effectBlockedReason, /营业条件/);
  const current = lifecyclePauseView(h.s, target, createLifecycleContext()), p = { ...base, requestId: 'PAUSE-RESUME-STABLE', version: current.version, sourceToken: current.sourceToken };
  const result = h.run(ops, 'lifecycle.store-resume', p), snapshot = structuredClone(h.s);
  assert.equal(result.stage, 'completed'); assert.equal(h.store.active, true); assert.equal(h.store.reviewStatus, 'approved');
  assert.deepEqual(h.run(ops, 'lifecycle.store-resume', p), result); assert.deepEqual({ ...h.s, revision: snapshot.revision }, snapshot);
});
