import test from 'node:test';
import assert from 'node:assert/strict';
import { qualityPolicyFormPayload as map, qualityPolicyScopeQuery, qualityPolicyScopeFromQuery, qualityPolicyLocalTime, syncQualityPolicyForm } from './quality-policy-form.mjs';

// Isolated runtime units. Explicit fixture numbers are not a published Demo policy.
const scope = { subject: 'tech', domain: 'service-order', storeIds: null, serviceIds: null };
const token = 'sha256:' + 'a'.repeat(64), time = '2026-10-04T10:00';
const copy = x => structuredClone(x);
function raw(p = {}) { return { scope: copy(scope), expectedVersion: 0, sourceToken: token, retainedRules: [], editingRuleId: null, ruleId: 'TEST-RULE', trigger: 'tech-general-series', sourceKinds: ['effective-general-warning'], minimum: '2', windowDays: '3', windowUnit: 'days', timeBasis: 'establishedAt', withdrawn: 'exclude', corrected: 'current-only', endMode: 'duration', durationDays: '4', durationUnit: 'hours', restorationMode: 'retraining-and-release', retrainingMode: 'all', retrainingServiceIds: [], appealExecution: 'continues', validFrom: time, validUntilMode: 'none', reference: 'ISOLATED-BASIS', basisVersion: 'fixture-only', occurredAt: time, requestId: 'ISOLATED-REQUEST', ...p }; }
const publish = p => map('quality.policy-publish', p);

test('显式范围all/selected精确query传输；不默认主体或范围', () => {
  const encoded = qualityPolicyScopeQuery({ subject: 'tech', storeMode: 'selected', storeIds: ['s2', 's1'], serviceMode: 'all', serviceIds: [] });
  assert.deepEqual(encoded, { subject: 'tech', storeMode: 'selected', storeIds: '["s1","s2"]', serviceMode: 'all', serviceIds: '' });
  assert.deepEqual(qualityPolicyScopeFromQuery(new URLSearchParams(encoded)), { ...scope, storeIds: ['s1', 's2'] });
  assert.equal(qualityPolicyScopeFromQuery(new URLSearchParams()), null);
  for (const p of [{ subject: '', storeMode: 'all', serviceMode: 'all' }, { subject: 'tech', storeMode: '', serviceMode: 'all' }, { subject: 'tech', storeMode: 'selected', storeIds: [], serviceMode: 'all' }, { subject: 'tech', storeMode: 'selected', storeIds: ['s1', 's1'], serviceMode: 'all' }]) assert.throws(() => qualityPolicyScopeQuery(p));
  for (const query of ['subject=tech&storeMode=all&storeIds=["s1"]&serviceMode=all', 'subject=tech&subject=user&storeMode=all&serviceMode=all', 'subject=tech&storeMode=selected&storeIds=s1&serviceMode=all', 'subject=tech&storeMode=all&serviceMode=all&serviceMode=selected']) assert.throws(() => qualityPolicyScopeFromQuery(new URLSearchParams(query)));
});

test('实际form正文转准确领域八字段，clone原快照不污染输入', () => {
  const p = raw(), before = copy(p), result = publish(p);
  assert.deepEqual(Object.keys(result).sort(), ['basis', 'expectedVersion', 'requestId', 'rules', 'scope', 'sourceToken', 'validFrom', 'validTo']);
  assert.equal(result.rules[0].counting.windowMs, 3 * 86400000); assert.equal(result.rules[0].effect.durationMs, 4 * 3600000);
  assert.equal(result.validFrom, Date.parse(time + '+08:00')); assert.equal(result.validTo, null); assert.equal(result.basis.version, 'fixture-only');
  assert.deepEqual(p, before); result.scope.storeIds = ['changed']; assert.deepEqual(p, before);
});

test('新增第二触发完整保留原规则；精确修订原id只替换原位置', () => {
  const first = publish(raw()).rules[0], second = { ...copy(first), id: 'SECOND', effect: { ...first.effect, durationMs: 123456 } }, retained = [first, second];
  const added = publish(raw({ ruleId: 'THIRD', retainedRules: retained, expectedVersion: 2 }));
  assert.deepEqual(added.rules.slice(0, 2), retained); assert.equal(added.rules[2].id, 'THIRD');
  const revised = publish(raw({ ruleId: 'SECOND', editingRuleId: 'SECOND', retainedRules: retained, expectedVersion: 2, durationDays: '123456', durationUnit: 'milliseconds' }));
  assert.deepEqual(revised.rules[0], first); assert.equal(revised.rules[1].effect.durationMs, 123456); assert.equal(revised.rules.length, 2);
  for (const patch of [{ retainedRules: retained }, { retainedRules: retained, editingRuleId: 'MISSING', ruleId: 'MISSING' }, { retainedRules: retained, editingRuleId: 'SECOND' }, { retainedRules: [first, first] }, { retainedRules: retained, editingRuleId: undefined }]) assert.throws(() => publish(raw(patch)));
});

test('空/坏数字或未明确单位、口径、有效期拒绝，不安装示例值', () => {
  for (const patch of [{ minimum: '' }, { minimum: '0' }, { minimum: '2.2' }, { minimum: '9007199254740992' }, { windowDays: '' }, { windowDays: 'NaN' }, { windowDays: '-1' }, { windowUnit: '' }, { windowDays: '0.1', windowUnit: 'milliseconds' }, { durationDays: '9007199254740992', durationUnit: 'days' }, { timeBasis: '' }, { corrected: '' }, { withdrawn: '' }, { endMode: '' }, { validUntilMode: '' }, { appealExecution: '' }, { sourceKinds: [] }, { role: 'group' }]) assert.throws(() => publish(raw(patch)));
  assert.equal(publish(raw({ durationDays: '0.5', durationUnit: 'days' })).rules[0].effect.durationMs, 43200000);
});

test('日历与北京时间严格校验，不接受标准Date自动归一化', () => {
  assert.equal(qualityPolicyLocalTime('2028-02-29T10:01:02.003'), Date.parse('2028-02-29T10:01:02.003+08:00'));
  for (const value of ['', '2026-02-29T10:00', '2026-02-31T10:00', '2026-10-04T24:00', '2026-13-01T00:00', '2026-10-04T10:00Z', '2026-10-04T10:00+08:00', 0]) assert.throws(() => qualityPolicyLocalTime(value));
  assert.throws(() => publish(raw({ validUntilMode: 'none', validTo: time })));
  assert.throws(() => publish(raw({ validUntilMode: 'date', validTo: '' })));
});

test('单事件无计次、严重调查无期限，用户人工限制只接受实际解除', () => {
  const single = raw({ trigger: 'tech-noshow', sourceKinds: ['established-care'] });
  for (const key of ['minimum', 'windowDays', 'windowUnit', 'timeBasis', 'withdrawn', 'corrected']) delete single[key];
  assert.equal(publish(single).rules[0].counting, null);
  assert.throws(() => publish({ ...single, minimum: '1' }));
  const severe = { ...single, trigger: 'tech-severe-event', endMode: 'manual-review', restorationMode: 'lifecycle-decision' };
  for (const key of ['durationDays', 'durationUnit', 'retrainingMode', 'retrainingServiceIds']) delete severe[key];
  const r = publish(severe).rules[0]; assert.equal(r.effect.durationMs, null); assert.equal(r.restoration.mode, 'lifecycle-decision');
  assert.throws(() => publish({ ...severe, endMode: 'duration', durationDays: '1', durationUnit: 'days' }));
  const user = { ...severe, scope: { ...scope, subject: 'user' }, trigger: 'user-abuse', restorationMode: 'explicit-release' };
  assert.equal(publish(user).rules[0].effect.kind, 'restrict-new-service'); assert.throws(() => publish({ ...user, restorationMode: 'expiry' }));
});

test('指定项目不夹带全部复训；原撤回payload精确保留view token', () => {
  assert.throws(() => publish(raw({ scope: { ...scope, serviceIds: ['sv1'] } })));
  const result = publish(raw({ scope: { ...scope, serviceIds: ['sv1'] }, retrainingMode: 'selected', retrainingServiceIds: ['sv1'] }));
  assert.deepEqual(result.rules[0].restoration.serviceIds, ['sv1']);
  const p = { id: 'QP1', version: 2, revision: 1, sourceToken: token, reference: 'R', basisVersion: '2', occurredAt: time, reason: '原实际决定', requestId: 'W' };
  assert.deepEqual(map('quality.policy-withdraw', p), { ...p, occurredAt: Date.parse(time + '+08:00') });
  assert.throws(() => map('quality.policy-withdraw', { ...p, approved: true }));
});

test('真实DOM替身按触发/期限/复训切换禁用；不修改来源或写数据', () => {
  const values = { trigger: 'tech-general-series', endMode: 'duration', retrainingMode: 'selected', validUntilMode: 'date' }, controls = Object.fromEntries(Object.entries(values).map(([k, value]) => [k, { value }]));
  const sections = ['counting', 'duration', 'retraining', 'retrainingIds', 'validTo'].map(key => ({ dataset: { qualityPolicySection: key }, inputs: [{ disabled: false }], querySelectorAll() { return this.inputs; } }));
  let hidden = false; const source = { dataset: { qualityPolicySource: 'tech-general-series' }, closest: () => ({ toggleAttribute(name, value) { assert.equal(name, 'hidden'); hidden = value; } }) };
  const form = { dataset: { command: 'quality.policy-publish', payload: 'ORIGINAL-TOKEN' }, elements: { namedItem: n => controls[n] }, querySelectorAll: query => query === '[data-quality-policy-section]' ? sections : [source] };
  syncQualityPolicyForm(form); assert.ok(sections.every(s => !s.hidden && !s.disabled && !s.inputs[0].disabled));
  controls.trigger.value = 'tech-severe-event'; controls.endMode.value = 'manual-review'; controls.validUntilMode.value = 'none'; syncQualityPolicyForm(form);
  assert.ok(sections.every(s => s.hidden && s.disabled && s.inputs[0].disabled)); assert.equal(source.disabled, true); assert.equal(hidden, true); assert.equal(form.dataset.payload, 'ORIGINAL-TOKEN');
});
