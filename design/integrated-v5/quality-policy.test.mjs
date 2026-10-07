import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { accountCommand, upgradeAccounts, resolveAccountActor, actorAccountFields } from './staff-accounts.mjs';
import { qualityPolicyCommand, qualityPolicySource, qualityPolicyStream, qualityPolicyView, upgradeQualityPolicies } from './quality-policy.mjs';

// Isolated runtime unit fixtures, with real account/grant/session commands.
// These numeric rules are never installed into the Demo or a browser origin.
const NOW = Date.parse('2026-10-04T10:00:00+08:00');
const DEMO = { role: 'user', userId: 'u1', storeId: 's1', techId: 't1' };
const techScope = { subject: 'tech', domain: 'service-order', storeIds: null, serviceIds: null };
const userScope = { ...techScope, subject: 'user' };
const copy = value => structuredClone(value);
function originalEngineLog(s, actor) {
  // Execute the actual private engine log body in a controlled context. This is
  // a runtime unit for the log hook, not a full reduce/browser acceptance test.
  const source = readFileSync(new URL('./engine.mjs', import.meta.url), 'utf8');
  const start = source.indexOf('  const log = (entity, content) => {');
  const end = source.indexOf('\n  };', start);
  if (start < 0 || end < 0) throw new Error('实际engine日志函数未定位，不能以镜像实现代替');
  return new Function('s', 'actor', 'actorAccountFields', source.slice(start, end + 5) + '\nreturn log;')(s, actor, actorAccountFields);
}
function techRule(trigger = 'tech-general-series') {
  return { id: 'isolated-' + trigger, trigger, sourceKinds: trigger === 'tech-general-series' ? ['effective-general-warning'] : trigger === 'tech-severe-event' ? ['established-safety'] : ['verified-fulfilment-responsibility'],
    counting: trigger === 'tech-general-series' ? { unit: 'distinct-source', minimum: 2, windowMs: 123456, timeBasis: 'establishedAt', withdrawn: 'exclude', corrected: 'current-only' } : null,
    effect: { kind: trigger === 'tech-severe-event' ? 'investigation-stop-new-service' : 'stop-new-service', endMode: trigger === 'tech-severe-event' ? 'manual-review' : 'duration', durationMs: trigger === 'tech-severe-event' ? null : 234567 },
    restoration: { mode: trigger === 'tech-severe-event' ? 'lifecycle-decision' : 'retraining-and-release', serviceIds: null }, appeal: { limit: 1, execution: 'continues' } };
}
function userRule(trigger = 'user-interruption') {
  return { id: 'isolated-' + trigger, trigger, sourceKinds: trigger === 'user-noshow-series' ? ['verified-fulfilment-responsibility'] : ['established-care'],
    counting: trigger === 'user-noshow-series' ? { unit: 'distinct-source', minimum: 2, windowMs: 345678, timeBasis: 'occurredAt', withdrawn: 'count-original', corrected: 'count-original' } : null,
    effect: { kind: 'restrict-new-service', endMode: 'duration', durationMs: 456789 }, restoration: { mode: 'expiry', serviceIds: null }, appeal: { limit: 1, execution: 'continues' } };
}
function fixture() {
  let s = upgradeAccounts({ schema: 5, seq: 0, now: NOW, stores: [{ id: 's1' }, { id: 's2' }], services: [{ id: 'sv1' }, { id: 'sv2' }], users: [{ id: 'u1' }], techs: [{ id: 't1', storeId: 's1' }], bookings: [{ id: 'B1', priceCents: 12000 }], goods: [{ id: 'G1', paidCents: 12345 }], logs: [] }), request = 0;
  const account = (a, type, p = {}) => {
    const next = copy(s), result = accountCommand(next, a, type, { requestId: 'policy-account-' + (++request), ...p }, { id: prefix => prefix + (++next.seq), log: () => {} });
    s = next; return result;
  };
  const enter = (accountId, grantId) => { const result = account(DEMO, 'account.enter', { accountId, grantId }); return resolveAccountActor(s, result); };
  const admin = enter('DEMO-ADMIN', 'DEMO-ADMIN-GRANT');
  const staff = (job, storeId) => {
    const created = account(admin, 'account.create', { name: 'isolated-' + job, reason: '隔离测试真实岗位建档' });
    const granted = account(admin, 'account.grant', { id: created.id, version: created.version, job, ...(storeId ? { storeId } : {}), reason: '隔离测试真实授权' });
    return enter(created.id, granted.grants.at(-1).id);
  };
  const support = staff('support');
  return {
    get s() { return s; }, admin, support, staff, account, enter,
    payload(p = {}) { const scope = p.scope || techScope, stream = qualityPolicyStream(s, scope); return { scope: copy(scope), rules: [techRule()], validFrom: s.now, validTo: null, basis: { reference: 'ISOLATED-POLICY-BASIS', version: 'fixture-only-1', occurredAt: s.now }, expectedVersion: stream.version, sourceToken: stream.sourceToken, requestId: 'policy-request-' + (++request), ...copy(p) }; },
    run(a, type, p, engineLog = false) { const next = copy(s), result = qualityPolicyCommand(next, a, type, p, { id: prefix => prefix + (++next.seq), log: engineLog ? originalEngineLog(next, resolveAccountActor(next, a)) : (row, message) => next.logs.push({ id: row.id, at: next.now, message }) }); s = next; return result; },
    publish(p = {}, a = support) { return this.run(a, 'quality.policy-publish', this.payload(p)); },
    source(query = {}) { return qualityPolicySource(s, { scope: techScope, ...query }); },
    withdraw(id, p = {}, a = support) { const row = s.qualityPolicies.find(r => r.id === id), view = qualityPolicyView(s, a).policies.find(r => r.id === id); return this.run(a, 'quality.policy-withdraw', { id, version: row.version, revision: row.revision, sourceToken: view?.sourceToken, reference: 'ISOLATED-WITHDRAWAL', basisVersion: 'fixture-only-2', occurredAt: s.now, reason: '隔离资料真实撤回决定', requestId: 'policy-request-' + (++request), ...p }); }
  };
}
function rejects(f, action, pattern = /政策|来源|规则|范围|版本|期限|时间|工作|会话|授权|字段|技师|用户|编号|原发布|原撤回|请求|限定|复训|计次|成立|观察|申诉|人工|服务|严重|依据|原因/) {
  const before = JSON.stringify(f.s); assert.throws(action, pattern); assert.equal(JSON.stringify(f.s), before, '原clone事务失败不能提交部分记录');
}

test('无政策时所有getter只读，upgrade仅空容器且不启用示例', () => {
  const f = fixture(), before = copy(f.s);
  assert.equal(f.source().available, false); assert.equal(qualityPolicyStream(f.s, techScope).version, 0);
  assert.equal(qualityPolicyView(f.s, f.support).canEnter, true); assert.deepEqual(f.s, before);
  const next = copy(f.s); upgradeQualityPolicies(next); assert.deepEqual(next.qualityPolicies, []); assert.deepEqual(next.qualityPolicyRequests, []);
  const once = copy(next); upgradeQualityPolicies(next); assert.deepEqual(next, once); assert.equal(qualityPolicySource(next, { scope: techScope }).available, false);
});

test('真实客服发布实际版本和作者，来源getter克隆；资金预约及资格不被执行', () => {
  const f = fixture(), facts = copy({ bookings: f.s.bookings, goods: f.s.goods, techs: f.s.techs }), result = f.publish();
  assert.equal(result.version, 1); const source = f.source({ policyId: result.id, version: 1, ruleId: 'isolated-tech-general-series' });
  assert.equal(source.available, true); assert.equal(source.policy.publication.by.sessionId, f.support.sessionId);
  assert.equal(source.policy.publication.by.accountId, f.support.accountId); assert.equal(source.rule.counting.minimum, 2);
  source.policy.rules[0].effect.durationMs = 1; assert.equal(f.source().rule, undefined); assert.equal(f.source().policy.rules[0].effect.durationMs, 234567);
  assert.deepEqual({ bookings: f.s.bookings, goods: f.s.goods, techs: f.s.techs }, facts);
  const request = f.s.qualityPolicyRequests[0]; assert.equal(request.digestVersion, 1); assert.equal(request.digestAlgorithm, 'SHA-256');
  assert.match(request.fingerprint, /^sha256:[a-f0-9]{64}$/); assert.ok(!JSON.stringify(request).includes('ISOLATED-POLICY-BASIS')); assert.ok(!('p' in request));
});

test('自由Demo、财务、运营、门店和伪会话不能发布或读取内部政策', () => {
  const f = fixture();
  for (const actor of [DEMO, { role: 'group', job: 'support' }, f.admin, f.staff('finance'), f.staff('operations'), f.staff('store-manager', 's1'), { ...f.support, sessionId: 'missing' }, { role: 'group', job: 'support', accountId: f.support.accountId }]) {
    const p = f.payload(); rejects(f, () => f.run(actor, 'quality.policy-publish', p)); assert.equal(qualityPolicyView(f.s, actor).canEnter, false);
  }
  const impersonatedHints = { ...f.support, role: 'store', job: 'store-manager', storeId: 's2' };
  f.publish({}, impersonatedHints); assert.equal(f.source().policy.publication.by.role, 'group', '作者取真实会话而不是UIhint');
});

test('限定承接、重复会话及冲突原账号来源拒绝', () => {
  for (const mutation of [f => f.s.staffAccounts.find(a => a.id === f.support.accountId).grants[0].purpose = 'lifecycle-settlement', f => f.s.staffSessions.push(copy(f.s.staffSessions.find(a => a.id === f.support.sessionId))), f => f.s.staffAccounts.push(copy(f.s.staffAccounts.find(a => a.id === f.support.accountId))), f => f.s.staffAccounts.find(a => a.id === f.support.accountId).grants.push(copy(f.s.staffAccounts.find(a => a.id === f.support.accountId).grants[0]))]) {
    const f = fixture(), p = f.payload(); mutation(f); rejects(f, () => f.run(f.support, 'quality.policy-publish', p));
  }
});

test('payload批准、作者、ctx、未知命令不能形成发布权限', () => {
  const f = fixture(); for (const extra of [{ approved: true }, { publishedBy: f.support }, { ctx: { approved: true } }, { durationDays: 7 }]) rejects(f, () => f.publish(extra));
  const before = copy(f.s); assert.equal(qualityPolicyCommand(f.s, DEMO, 'quality.invented', {}), undefined); assert.deepEqual(f.s, before);
});

test('空规则、空依据、缺期限/范围及错误计次参数拒绝，无零期限fallback', () => {
  const f = fixture();
  for (const patch of [{ rules: [] }, { basis: { reference: '', version: 'v', occurredAt: NOW } }, { basis: { reference: 'x', version: '', occurredAt: NOW } }, { validFrom: NOW - 1 }, { validTo: NOW }, { validTo: undefined }]) rejects(f, () => f.publish(patch));
  for (const mutate of [r => r.counting.minimum = 0, r => r.counting.windowMs = 0, r => r.counting.timeBasis = '', r => delete r.counting.withdrawn, r => r.effect.durationMs = 0, r => r.effect.durationMs = undefined, r => r.effect.endMode = '', r => r.restoration.mode = 'expiry', r => r.appeal.limit = 2, r => r.appeal.execution = undefined]) { const r = techRule(); mutate(r); rejects(f, () => f.publish({ rules: [r] })); }
});

test('七类原规则显式模型均可保存，但没有任何实际处罚或用户限制', () => {
  const f = fixture(); const techRules = ['tech-noshow', 'tech-general-series', 'tech-severe-event'].map(techRule), userRules = ['user-interruption', 'user-abuse', 'user-noshow-series', 'user-malicious-refund'].map(userRule);
  f.publish({ rules: techRules }); f.publish({ scope: userScope, rules: userRules });
  assert.equal(f.source().policy.rules.length, 3); assert.equal(f.source({ scope: userScope }).policy.rules.length, 4);
  assert.equal(f.s.technicianPenalties, undefined); assert.equal(f.s.userRestrictions, undefined); assert.equal(f.s.techs[0].active, undefined);
});

test('来源类别/主体与执行恢复动作严格一致，不能把退款/低分直接当成立', () => {
  const f = fixture();
  for (const r of [userRule(), { ...techRule(), sourceKinds: ['refund'] }, { ...techRule(), sourceKinds: ['effective-general-warning', 'effective-general-warning'] }, { ...techRule('tech-noshow'), counting: techRule().counting }, { ...techRule('tech-severe-event'), effect: { kind: 'investigation-stop-new-service', endMode: 'duration', durationMs: 1 } }]) rejects(f, () => f.publish({ rules: [r] }));
  const manual = userRule(); manual.effect = { kind: 'restrict-new-service', endMode: 'manual-review', durationMs: null }; manual.restoration.mode = 'explicit-release';
  f.publish({ scope: userScope, rules: [manual] }); assert.equal(f.source({ scope: userScope }).policy.rules[0].effect.durationMs, null);
});

test('原店/项目唯一列表与null全范围分开，商品推广和未知scope拒绝', () => {
  const f = fixture();
  for (const scope of [{ ...techScope, domain: 'goods-purchase' }, { ...techScope, domain: 'promotion' }, { ...techScope, storeIds: [] }, { ...techScope, storeIds: ['missing'] }, { ...techScope, storeIds: ['s1', 's1'] }, { ...techScope, serviceIds: ['missing'] }, { subject: 'tech', domain: 'service-order', storeIds: null }]) rejects(f, () => f.publish({ scope }));
  const rule = techRule(); rule.restoration.serviceIds = ['sv1'];
  const scope = { ...techScope, storeIds: ['s1'], serviceIds: ['sv1'] }; f.publish({ scope, rules: [rule] });
  assert.equal(f.source({ scope }).available, true); assert.equal(f.source({ scope: { ...scope, storeIds: ['s2'] } }).available, false); assert.equal(f.source().available, false);
  rejects(f, () => f.publish({ scope, rules: [techRule()] }));
  rule.restoration.serviceIds = ['sv2']; rejects(f, () => f.publish({ scope, rules: [rule] }));
});

test('scope列表排序归同stream，版本不能跨范围或旧token覆盖', () => {
  const f = fixture(), a = { ...techScope, storeIds: ['s2', 's1'] }, b = { ...techScope, storeIds: ['s1', 's2'] }, stale = f.payload({ scope: a });
  const first = f.publish({ scope: b }); assert.equal(qualityPolicyStream(f.s, a).version, 1);
  rejects(f, () => f.run(f.support, 'quality.policy-publish', stale));
  rejects(f, () => f.publish({ expectedVersion: 99 }));
  const other = f.publish({ scope: userScope, rules: [userRule()] }); assert.equal(other.version, 1); assert.notEqual(other.id, first.id);
});

test('未来生效不提前实施，边界采用实际now，current不能指定未来或过去', () => {
  const f = fixture(); f.publish({ validFrom: NOW + 100, validTo: NOW + 200 });
  assert.equal(f.source().available, false); assert.equal(f.source({ at: NOW + 100 }).available, false);
  f.s.now = NOW + 100; assert.equal(f.source().available, true); f.s.now = NOW + 200; assert.equal(f.source().available, false);
  assert.equal(f.source({ at: NOW + 150 }).available, false);
});

test('新有效版过期不回退旧无期限版；历史决定只取当时精确版', () => {
  const f = fixture(), first = f.publish(); f.s.now += 10;
  const second = f.publish({ validTo: NOW + 30 });
  assert.equal(f.source().policy.id, second.id); assert.equal(f.source({ policyId: first.id, version: 1 }).available, false);
  assert.equal(f.source({ mode: 'historical', policyId: first.id, version: 1, at: NOW + 5 }).available, true);
  assert.equal(f.source({ mode: 'historical', policyId: first.id, version: 1, at: NOW + 10 }).available, false);
  assert.equal(f.source({ mode: 'historical', at: NOW + 5 }).available, false);
  f.s.now = NOW + 30; assert.equal(f.source().available, false);
});

test('新版本不能早于已排定前版，历史查询也不能选未来或伪rule', () => {
  const f = fixture(); const first = f.publish({ validFrom: NOW + 100 });
  rejects(f, () => f.publish({ validFrom: NOW + 50 }));
  assert.equal(f.source({ mode: 'historical', policyId: first.id, version: 1, at: NOW + 100 }).available, false);
  f.s.now += 100; assert.equal(f.source({ ruleId: 'other' }).available, false);
});

test('真实撤回保留原发布和历史有效版，不解除/删除原事实或复活旧版', () => {
  const f = fixture(), first = f.publish(); f.s.now += 10; const second = f.publish(), frozen = copy(f.s.qualityPolicies[1]); f.s.now += 10;
  const result = f.withdraw(second.id); assert.equal(result.revision, 2); const row = f.s.qualityPolicies[1];
  assert.deepEqual(row.rules, frozen.rules); assert.deepEqual(row.publication, frozen.publication); assert.equal(row.contentFingerprint, frozen.contentFingerprint); assert.equal(row.withdrawal.by.accountId, f.support.accountId);
  assert.equal(f.source().available, false); assert.equal(f.source({ mode: 'historical', policyId: second.id, version: 2, at: NOW + 15 }).available, true);
  assert.equal(f.source({ mode: 'historical', policyId: second.id, version: 2, at: NOW + 15 }).sourceToken, frozen.contentFingerprint, '后续撤回不能改写旧决定冻结的发布依据');
  assert.equal(f.source({ mode: 'historical', policyId: first.id, version: 1, at: NOW + 5 }).available, true);
  assert.equal(f.s.bookings[0].priceCents, 12000); rejects(f, () => f.withdraw(second.id));
});

test('撤回准确版本/token/实际时间/依据必填，其他岗位拒绝', () => {
  const f = fixture(), r = f.publish(), old = qualityPolicyView(f.s, f.support).policies[0].sourceToken;
  for (const patch of [{ version: 2 }, { revision: 2 }, { sourceToken: 'bad' }, { occurredAt: NOW - 1 }, { occurredAt: NOW + 1 }, { reference: '' }, { basisVersion: '' }, { reason: '' }]) rejects(f, () => f.withdraw(r.id, patch));
  const finance = f.staff('finance'); rejects(f, () => f.withdraw(r.id, { sourceToken: old }, finance));
});

test('发布/撤回幂等不新增版本/日志，同request改正文和多条冲突拒绝', () => {
  const f = fixture(), p = f.payload(), r = f.run(f.support, 'quality.policy-publish', p), before = copy(f.s);
  assert.deepEqual(f.run(f.support, 'quality.policy-publish', p), r); assert.deepEqual(f.s, before);
  rejects(f, () => f.run(f.support, 'quality.policy-publish', { ...p, validTo: NOW + 100 }));
  const row = qualityPolicyView(f.s, f.support).policies[0], w = { id: r.id, version: r.version, revision: r.revision, sourceToken: row.sourceToken, reference: 'ISOLATED', basisVersion: '2', occurredAt: NOW, reason: '撤回', requestId: 'withdraw-one' };
  const result = f.run(f.support, 'quality.policy-withdraw', w), after = copy(f.s); assert.deepEqual(f.run(f.support, 'quality.policy-withdraw', w), result); assert.deepEqual(f.s, after);
  f.s.qualityPolicyRequests.push(copy(f.s.qualityPolicyRequests[0])); rejects(f, () => f.run(f.support, 'quality.policy-publish', p));
});

test('摘要重放前验证真实载荷类型，NaN不能与原null有效期碰撞', () => {
  const f = fixture(), p = f.payload(); f.run(f.support, 'quality.policy-publish', p);
  for (const validTo of [NaN, Infinity, undefined, '']) rejects(f, () => f.run(f.support, 'quality.policy-publish', { ...p, validTo }));
  rejects(f, () => f.run(f.support, 'quality.policy-publish', { ...p, expectedVersion: NaN }));
  f.s.now += 10; const before = copy(f.s); assert.equal(f.run(f.support, 'quality.policy-publish', p).version, 1); assert.deepEqual(f.s, before, '原同请求晚些重放不回溯发布新政策');
});

test('撤权/停用/会话到期先于幂等；历史发布不因后来撤权被抹掉', () => {
  for (const mutate of [f => f.account(f.admin, 'account.revoke', { id: f.support.accountId, version: f.s.staffAccounts.find(a => a.id === f.support.accountId).version, grantId: f.support.grantId, reason: '真实撤权' }), f => f.account(f.admin, 'account.status', { id: f.support.accountId, version: f.s.staffAccounts.find(a => a.id === f.support.accountId).version, enabled: false, reason: '真实停用' }), f => f.s.staffSessions.find(a => a.id === f.support.sessionId).expiresAt = f.s.now]) {
    const f = fixture(), p = f.payload(); f.run(f.support, 'quality.policy-publish', p); f.s.now += 10; mutate(f); rejects(f, () => f.run(f.support, 'quality.policy-publish', p)); assert.equal(f.source().available, true);
  }
});

test('缺/重复policy、请求、scope版本、作者源或内容摘要均明确不可用，不能用幂等绕过', () => {
  const mutations = [f => f.s.qualityPolicies.push(copy(f.s.qualityPolicies[0])), f => f.s.qualityPolicies[0].rules[0].counting.minimum++, f => f.s.qualityPolicies[0].publication.by.accountId = 'missing', f => f.s.qualityPolicies[0].publication.by.sessionId = 'missing', f => f.s.qualityPolicies[0].basis.version = 'replaced', f => f.s.qualityPolicies[0].version++, f => f.s.qualityPolicies[0].status = 'withdrawn', f => f.s.qualityPolicyRequests[0].result.id = 'other', f => f.s.qualityPolicyRequests[0].digestVersion = 2, f => delete f.s.qualityPolicyRequests, f => f.s.services.push(copy(f.s.services[0])), f => f.s.staffAccounts.find(a => a.id === f.support.accountId).createdAt++, f => f.s.staffAccounts.find(a => a.id === f.support.accountId).grants[0].validTo = 'unknown'];
  for (const mutate of mutations) {
    const f = fixture(), scope = { ...techScope, serviceIds: ['sv1'] }, r = techRule(); r.restoration.serviceIds = ['sv1']; const p = f.payload({ scope, rules: [r] }); f.run(f.support, 'quality.policy-publish', p); mutate(f);
    assert.equal(f.source({ scope }).available, false); rejects(f, () => f.run(f.support, 'quality.policy-publish', p));
  }
});

test('撤回事实被替换/伪作者/未来时间或请求摘要错配拒绝，getter不修源', () => {
  for (const mutate of [f => f.s.qualityPolicies[0].withdrawal.reason = 'replaced', f => f.s.qualityPolicies[0].withdrawal.by.grantId = 'other', f => f.s.qualityPolicies[0].withdrawal.at++, f => f.s.qualityPolicyRequests[1].fingerprint = f.s.qualityPolicyRequests[0].fingerprint]) {
    const f = fixture(), r = f.publish(); f.withdraw(r.id); mutate(f); const before = copy(f.s); assert.equal(f.source().available, false); assert.equal(qualityPolicyView(f.s, f.support).canEnter, false); assert.deepEqual(f.s, before);
  }
});

test('未来发布/时钟回退或容器损坏不伪造当前有效；重复新编号拒绝', () => {
  const f = fixture(), r = f.publish(); f.s.now = NOW - 1; assert.equal(f.source().available, false);
  const broken = fixture(); broken.s.qualityPolicies = {}; assert.equal(broken.source().available, false);
  f.s.now = NOW; const p = f.payload(), next = copy(f.s); assert.throws(() => qualityPolicyCommand(next, f.support, 'quality.policy-publish', p, { id: () => r.id }), /编号已存在/);
  const unused = fixture(), original = unused.payload(); unused.s.now = NOW - 1; rejects(unused, () => unused.run(unused.support, 'quality.policy-publish', original));
});

test('实际engine日志追加events后发布Source/View与再次withdraw均保持真实有效', () => {
  const f = fixture(), payload = f.payload(), published = f.run(f.support, 'quality.policy-publish', payload, true);
  assert.equal(f.s.qualityPolicies[0].events.length, 1);
  assert.equal(f.s.qualityPolicies[0].events[0].accountId, f.support.accountId);
  assert.equal(f.source().available, true, '原engine追加日志不能使实际已发布版失去来源');
  assert.deepEqual(f.run(f.support, 'quality.policy-publish', payload, true), published);
  assert.equal(f.s.qualityPolicies[0].events.length, 1); assert.equal(f.s.logs.length, 1);
  const view = qualityPolicyView(f.s, f.support); assert.equal(view.canEnter, true);
  f.s.now += 10; const row = view.policies[0];
  f.run(f.support, 'quality.policy-withdraw', { id: published.id, version: 1, revision: 1, sourceToken: row.sourceToken, reference: 'ISOLATED-ENGINE-WITHDRAW', basisVersion: 'fixture-only', occurredAt: f.s.now, reason: '实际日志兼容回归', requestId: 'engine-withdraw-one' }, true);
  assert.equal(f.s.qualityPolicies[0].events.length, 2); assert.equal(f.s.logs.length, 2);
  assert.equal(qualityPolicyView(f.s, f.support).canEnter, true); assert.equal(f.source().available, false);
  assert.equal(f.source({ mode: 'historical', policyId: published.id, version: 1, at: NOW }).available, true);
  delete f.s.qualityPolicies[0].events;
  assert.equal(qualityPolicyView(f.s, f.support).canEnter, true, '原无events记录保留兼容且不补日志');
  f.s.qualityPolicies[0].events = null;
  assert.equal(qualityPolicyView(f.s, f.support).canEnter, false, '仅准确日志array可兼容');
});
