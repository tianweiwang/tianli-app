import test from 'node:test';
import assert from 'node:assert/strict';
import { accountCommand, upgradeAccounts, resolveAccountActor } from './staff-accounts.mjs';
import { qualityPolicyCommand, qualityPolicySource, qualityPolicyView } from './quality-policy.mjs';
import { qualityPolicyUiView } from './quality-policy-ui.mjs';
import { qualityPolicyFormPayload, qualityPolicyScopeQuery } from './quality-policy-form.mjs';

// Emitted HTML form + original domain runtime units. These do not establish
// browser layout, actual DOM event integration, or formal policy approval.
const NOW = Date.parse('2026-10-04T10:00:00+08:00'), TIME = '2026-10-04T10:00', DEMO = { role: 'user', userId: 'u1', storeId: 's1', techId: 't1' };
const copy = x => structuredClone(x);
const unescape = v => v.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
function forms(html, command) {
  return [...html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/g)].map(m => {
    const attrs = Object.fromEntries([...m[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(x => [x[1], unescape(x[2])]));
    return { attrs, body: m[2], payload: JSON.parse(attrs['data-payload'] || '{}') };
  }).filter(x => x.attrs['data-command'] === command);
}
function fields(form) {
  // Inspect actual rendered field values, not the implementation source.
  return Object.fromEntries([...form.body.matchAll(/<input\b([^>]*)>/g)].map(m => Object.fromEntries([...m[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(x => [x[1], unescape(x[2])]))).filter(x => x.name && x.type !== 'checkbox').map(x => [x.name, x.value]));
}
function selected(form, name) {
  const select = [...form.body.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/g)].find(m => m[1].includes(`name="${name}"`));
  return select ? [...select[2].matchAll(/<option\b([^>]*)>/g)].filter(m => /\bselected\b/.test(m[1])).map(m => unescape(/value="([^"]*)"/.exec(m[1])[1])) : [];
}
function body(p = {}) { return { ruleId: 'UI-R1', trigger: 'tech-general-series', sourceKinds: ['effective-general-warning'], minimum: '2', windowDays: '3', windowUnit: 'days', timeBasis: 'establishedAt', withdrawn: 'exclude', corrected: 'current-only', endMode: 'duration', durationDays: '4', durationUnit: 'hours', restorationMode: 'retraining-and-release', retrainingMode: 'all', retrainingServiceIds: [], appealExecution: 'continues', validFrom: TIME, validUntilMode: 'none', reference: 'ISOLATED-UI-BASIS', basisVersion: 'fixture-only', occurredAt: TIME, ...p }; }
function fixture() {
  let s = upgradeAccounts({ schema: 5, seq: 0, now: NOW, stores: [{ id: 's1', name: '原店一' }, { id: 's2', name: '原店二' }], services: [{ id: 'sv1', name: '原项目一' }, { id: 'sv2', name: '原项目二' }], users: [{ id: 'u1' }], techs: [{ id: 't1', storeId: 's1' }], bookings: [], logs: [] }), request = 0;
  const account = (a, type, p) => { const next = copy(s), result = accountCommand(next, a, type, { requestId: 'UI-ACCOUNT-' + (++request), ...p }, { id: prefix => prefix + (++next.seq), log: () => {} }); s = next; return result; };
  const enter = (accountId, grantId) => { const result = account(DEMO, 'account.enter', { accountId, grantId }); return resolveAccountActor(s, result); };
  const admin = enter('DEMO-ADMIN', 'DEMO-ADMIN-GRANT');
  const staff = job => { const x = account(admin, 'account.create', { name: '隔离UI-' + job, reason: '隔离实际建档' }), y = account(admin, 'account.grant', { id: x.id, version: x.version, job, reason: '隔离实际授权' }); return enter(x.id, y.grants.at(-1).id); };
  const support = staff('support');
  return { get s() { return s; }, support, admin, staff, account,
    query(subject = 'tech', p = {}) { return new URLSearchParams(qualityPolicyScopeQuery({ subject, storeMode: 'all', serviceMode: 'all', ...p })); },
    render(q = null, actor = support, id = null) { return qualityPolicyUiView(s, actor, ['quality-policies', ...(id ? [id] : [])], { query: q }); },
    run(form, input, actor = support) { const p = qualityPolicyFormPayload(form.attrs['data-command'], { ...form.payload, ...input, requestId: 'UI-COMMAND-' + (++request) }), next = copy(s), result = qualityPolicyCommand(next, actor, form.attrs['data-command'], p, { id: prefix => prefix + (++next.seq), log: row => (row.events ??= []).push({ at: next.now, content: '原engine同形日志' }) }); s = next; return result; },
    publish(input = {}, q = this.query()) { return this.run(forms(this.render(q), 'quality.policy-publish')[0], body(input)); }
  };
}

test('原路由/真实客服可见；自由Demo、财务、技师及越级路径无表单或私密数据', () => {
  const f = fixture(); assert.equal(qualityPolicyUiView(f.s, f.support, ['other']), null);
  assert.match(f.render(), /data-quality-policy-scope/); assert.equal(forms(f.render(), 'quality.policy-publish').length, 0);
  const id = f.publish().id;
  for (const actor of [{ role: 'group', job: 'support' }, { role: 'tech', techId: 't1' }, f.staff('finance'), { ...f.support, sessionId: 'FAKE' }]) {
    const html = f.render(f.query(), actor, id); assert.match(html, /无权查看/); assert.equal(forms(html, 'quality.policy-withdraw').length, 0); assert.doesNotMatch(html, /ISOLATED-UI-BASIS/);
  }
  assert.match(qualityPolicyUiView(f.s, f.support, ['quality-policies', id, 'extra']), /页面不存在/);
});

test('首次空范围原表单零数字默认；明示固定scope/token、状态与真实动作', () => {
  const f = fixture(), before = copy(f.s), html = f.render(f.query()), form = forms(html, 'quality.policy-publish')[0], input = fields(form);
  assert.deepEqual(form.payload.scope, { subject: 'tech', domain: 'service-order', storeIds: null, serviceIds: null });
  assert.equal(form.payload.expectedVersion, 0); assert.deepEqual(form.payload.retainedRules, []); assert.equal(form.payload.editingRuleId, null);
  for (const name of ['minimum', 'windowDays', 'durationDays', 'ruleId', 'validFrom', 'occurredAt']) assert.equal(input[name], '');
  assert.deepEqual(selected(form, 'trigger'), ['']); assert.deepEqual(selected(form, 'endMode'), ['']);
  assert.match(html, /role="status"/); assert.match(form.body, /type="submit" class="primary"/); assert.doesNotMatch(form.body, /textarea[^>]*name="rules"/);
  assert.deepEqual(f.s, before); assert.throws(() => f.run(form, { ...body(), durationDays: '' })); assert.deepEqual(f.s, before);
});

test('发出的实际表单映射→原command发布→原详情→原View token撤回', () => {
  const f = fixture(), result = f.publish(), detail = f.render(null, f.support, result.id);
  assert.match(detail, /ISOLATED-UI-BASIS/); assert.match(detail, /4 小时/); assert.match(detail, new RegExp(f.support.accountId));
  const renderedRows = [...detail.matchAll(/<div class="([^"]*\brow\b[^"]*)">/g)]; assert.ok(renderedRows.length > 0); assert.ok(renderedRows.every(x => x[1].split(' ').includes('quality-policy-row')));
  const form = forms(detail, 'quality.policy-withdraw')[0], view = qualityPolicyView(f.s, f.support).policies[0];
  assert.equal(form.payload.sourceToken, view.sourceToken); assert.notEqual(form.payload.sourceToken, view.contentFingerprint);
  f.run(form, { reference: 'ISOLATED-WITHDRAW', basisVersion: 'fixture-withdraw', occurredAt: TIME, reason: '隔离实际撤回' });
  assert.equal(forms(f.render(null, f.support, result.id), 'quality.policy-withdraw').length, 0); assert.match(f.render(null, f.support, result.id), /隔离实际撤回/);
  assert.equal(qualityPolicySource(f.s, { scope: view.scope }).available, false);
});

test('新增第二触发保留全部原规则；原表单与草稿key准确原版本', () => {
  const f = fixture(), q = f.query(), firstForm = forms(f.render(q), 'quality.policy-publish')[0]; f.publish();
  const first = copy(f.s.qualityPolicies[0].rules[0]), next = forms(f.render(q), 'quality.policy-publish')[0];
  assert.equal(next.attrs['data-management-form'], firstForm.attrs['data-management-form']); assert.notEqual(next.attrs['data-live-version'], firstForm.attrs['data-live-version']);
  const input = body({ ruleId: 'UI-R2', trigger: 'tech-noshow', sourceKinds: ['established-care'] });
  for (const key of ['minimum', 'windowDays', 'windowUnit', 'timeBasis', 'withdrawn', 'corrected']) delete input[key];
  f.run(next, input); assert.deepEqual(f.s.qualityPolicies[1].rules[0], first); assert.equal(f.s.qualityPolicies[1].rules[1].id, 'UI-R2');
  assert.match(f.render(q), /新版本将保留以下规则/); assert.match(f.render(q), /UI-R1/); assert.match(f.render(q), /UI-R2/);
  const before = copy(f.s); assert.throws(() => f.run(firstForm, body({ ruleId: 'UI-R3' })), /版本|来源/); assert.deepEqual(f.s, before);
});

test('明确原规则修订只替换选中条目；精确毫秒字段原样回显', () => {
  const f = fixture(), q = f.query(); f.publish(); f.publish({ ruleId: 'UI-R2', durationDays: '123456', durationUnit: 'milliseconds' });
  const first = copy(f.s.qualityPolicies[1].rules[0]); q.set('editRule', 'UI-R2'); const form = forms(f.render(q), 'quality.policy-publish')[0];
  assert.equal(form.payload.editingRuleId, 'UI-R2'); assert.equal(fields(form).durationDays, '123456'); assert.deepEqual(selected(form, 'durationUnit'), ['milliseconds']);
  assert.match(form.body, /name="ruleId"[^>]*readonly/); assert.equal(form.payload.retainedRules.length, 2);
  f.run(form, body({ ruleId: 'UI-R2', durationDays: '654321', durationUnit: 'milliseconds' }));
  assert.deepEqual(f.s.qualityPolicies[2].rules[0], first); assert.equal(f.s.qualityPolicies[2].rules[1].effect.durationMs, 654321); assert.equal(f.s.qualityPolicies[2].rules.length, 2);
});

test('最高未来计划版也是完整保留来源；不只取当前生效版', () => {
  const f = fixture(); f.publish(); f.publish({ ruleId: 'FUTURE', validFrom: '2026-10-05T10:00' });
  const form = forms(f.render(f.query()), 'quality.policy-publish')[0]; assert.equal(form.payload.expectedVersion, 2); assert.equal(form.payload.retainedRules.length, 2); assert.match(f.render(f.query()), /尚待生效/);
  f.run(form, body({ ruleId: 'AFTER-FUTURE', validFrom: '2026-10-05T11:00' })); assert.deepEqual(f.s.qualityPolicies[2].rules.map(r => r.id), ['UI-R1', 'FUTURE', 'AFTER-FUTURE']);
});

test('精确指定门店/项目与另一主体隔离；查询坏源不退全范围', () => {
  const f = fixture(), q = f.query('tech', { storeMode: 'selected', storeIds: ['s2'], serviceMode: 'selected', serviceIds: ['sv2'] }), form = forms(f.render(q), 'quality.policy-publish')[0];
  assert.deepEqual(form.payload.scope.storeIds, ['s2']); assert.deepEqual(form.payload.scope.serviceIds, ['sv2']); assert.match(f.render(q), /原店二/);
  const result = f.run(form, body({ retrainingMode: 'selected', retrainingServiceIds: ['sv2'] })); assert.equal(forms(f.render(f.query('user')), 'quality.policy-publish')[0].payload.retainedRules.length, 0);
  assert.match(f.render(null, f.support, result.id), /原项目二 · sv2/); assert.deepEqual(f.s.qualityPolicies[0].rules[0].restoration.serviceIds, ['sv2']);
  const bad = f.query('tech', { storeMode: 'selected', storeIds: ['MISSING'] }); assert.equal(forms(f.render(bad), 'quality.policy-publish').length, 0); assert.match(f.render(bad), /记录暂无法读取/);
  q.set('storeIds', 's2'); assert.equal(forms(f.render(q), 'quality.policy-publish').length, 0); assert.match(f.render(q), /查询无效/);
});

test('坏/重复/跨范围修订id拒绝；失权旧页不能发表或撤回', () => {
  const f = fixture(), q = f.query(); const id = f.publish().id;
  for (const edit of ['MISSING', '']) { const query = f.query(); query.set('editRule', edit); assert.equal(forms(f.render(query), 'quality.policy-publish').length, 0); }
  const otherSubject = f.query('user'); otherSubject.set('editRule', 'UI-R1'); assert.equal(forms(f.render(otherSubject), 'quality.policy-publish').length, 0);
  const otherStore = f.query('tech', { storeMode: 'selected', storeIds: ['s2'] }); otherStore.set('editRule', 'UI-R1'); assert.equal(forms(f.render(otherStore), 'quality.policy-publish').length, 0);
  q.append('editRule', 'UI-R1'); q.append('editRule', 'UI-R1'); assert.equal(forms(f.render(q), 'quality.policy-publish').length, 0);
  assert.equal(forms(f.render(new URLSearchParams('editRule=UI-R1')), 'quality.policy-publish').length, 0);
  const publishForm = forms(f.render(f.query()), 'quality.policy-publish')[0], withdrawForm = forms(f.render(null, f.support, id), 'quality.policy-withdraw')[0];
  f.account(f.admin, 'account.revoke', { id: f.support.accountId, version: f.s.staffAccounts.find(a => a.id === f.support.accountId).version, grantId: f.support.grantId, reason: '隔离真实撤权' });
  const before = copy(f.s); assert.equal(forms(f.render(f.query()), 'quality.policy-publish').length, 0);
  assert.throws(() => f.run(publishForm, body({ ruleId: 'LATE' })), /会话|工作|权限|授权/);
  assert.throws(() => f.run(withdrawForm, { reference: 'R', basisVersion: '2', occurredAt: TIME, reason: '迟到撤回' }), /会话|工作|权限|授权/); assert.deepEqual(f.s, before);
});

test('依据与门店名称按实际HTML转义；坏原来源无静默修复', () => {
  const f = fixture(); f.s.stores[0].name = '<script>未执行</script>'; f.publish({ reference: '<script>未执行</script>' });
  const html = f.render(null, f.support, f.s.qualityPolicies[0].id); assert.doesNotMatch(html, /<script>/); assert.match(html, /&lt;script&gt;/);
  const longReason = '这是保留全文的撤回理由。'.repeat(30), form = forms(html, 'quality.policy-withdraw')[0];
  f.run(form, { reference: '长依据'.repeat(60), basisVersion: '2', occurredAt: TIME, reason: longReason });
  assert.ok(f.render(null, f.support, f.s.qualityPolicies[0].id).includes(longReason));
  f.s.qualityPolicies[0].rules[0].effect.durationMs++; const before = copy(f.s); assert.match(f.render(f.query()), /无权查看|来源/); assert.equal(forms(f.render(f.query()), 'quality.policy-publish').length, 0); assert.deepEqual(f.s, before);
});

test('七类触发的真实form映射均走原领域；用户/严重调查详情不伪复训', () => {
  for (const trigger of ['tech-noshow', 'tech-general-series', 'tech-severe-event', 'user-interruption', 'user-abuse', 'user-noshow-series', 'user-malicious-refund']) {
    const f = fixture(), isUser = trigger.startsWith('user-'), input = body({ ruleId: 'ISOLATED-' + trigger, trigger, sourceKinds: trigger === 'tech-general-series' ? ['effective-general-warning'] : trigger === 'user-noshow-series' ? ['verified-fulfilment-responsibility'] : ['established-care'] });
    if (!['tech-general-series', 'user-noshow-series'].includes(trigger)) for (const key of ['minimum', 'windowDays', 'windowUnit', 'timeBasis', 'withdrawn', 'corrected']) delete input[key];
    if (isUser || trigger === 'tech-severe-event') { delete input.retrainingMode; delete input.retrainingServiceIds; input.restorationMode = isUser ? 'expiry' : 'lifecycle-decision'; }
    if (trigger === 'tech-severe-event') { input.endMode = 'manual-review'; delete input.durationDays; delete input.durationUnit; }
    const result = f.run(forms(f.render(f.query(isUser ? 'user' : 'tech')), 'quality.policy-publish')[0], input);
    const source = qualityPolicySource(f.s, { scope: f.s.qualityPolicies[0].scope }); assert.equal(source.available, true); assert.equal(source.policy.rules[0].trigger, trigger);
    const detail = f.render(null, f.support, result.id); if (isUser || trigger === 'tech-severe-event') assert.doesNotMatch(detail, /复训项目/); else assert.match(detail, /复训项目/);
  }
});
