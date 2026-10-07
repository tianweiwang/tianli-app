// Human form mapping only. The original quality policy command remains the authority.
const copy = value => structuredClone(value);
const fail = message => { throw new Error(message); };
const text = (value, label) => typeof value === 'string' && value.trim() ? value.trim() : fail('请填写' + label);
const definitions = {
  'tech-noshow': { subject: 'tech', effect: 'stop-new-service', restoration: 'retraining-and-release' },
  'tech-general-series': { subject: 'tech', effect: 'stop-new-service', restoration: 'retraining-and-release', series: true },
  'tech-severe-event': { subject: 'tech', effect: 'investigation-stop-new-service', restoration: 'lifecycle-decision' },
  'user-interruption': { subject: 'user', effect: 'restrict-new-service' },
  'user-abuse': { subject: 'user', effect: 'restrict-new-service' },
  'user-noshow-series': { subject: 'user', effect: 'restrict-new-service', series: true },
  'user-malicious-refund': { subject: 'user', effect: 'restrict-new-service' }
};
export const qualityPolicyTriggerDefinitions = Object.freeze(Object.fromEntries(Object.entries(definitions).map(([k, v]) => [k, Object.freeze(v)])));
function list(value, label) {
  if (!Array.isArray(value) || !value.length || value.some(id => typeof id !== 'string' || !id || id !== id.trim()) || new Set(value).size !== value.length) fail('请明确选择' + label);
  return [...value].sort();
}
function scope(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).sort().join(',') !== 'domain,serviceIds,storeIds,subject' || !['tech', 'user'].includes(raw.subject) || raw.domain !== 'service-order') fail('政策范围结构无效');
  return { subject: raw.subject, domain: raw.domain, storeIds: raw.storeIds === null ? null : list(raw.storeIds, '原门店'), serviceIds: raw.serviceIds === null ? null : list(raw.serviceIds, '原项目') };
}
export function qualityPolicyScopeQuery(raw) {
  if (!['tech', 'user'].includes(raw.subject)) fail('请明确选择政策主体');
  const output = { subject: raw.subject };
  for (const [mode, ids] of [['storeMode', 'storeIds'], ['serviceMode', 'serviceIds']]) {
    if (!['all', 'selected'].includes(raw[mode])) fail('请明确选择全部或指定范围');
    output[mode] = raw[mode];
    output[ids] = raw[mode] === 'all' ? '' : JSON.stringify(list(raw[ids], ids === 'storeIds' ? '原门店' : '原项目'));
  }
  return output;
}
export function qualityPolicyScopeFromQuery(query) {
  const get = key => query?.get ? query.get(key) : query?.[key];
  if (!['subject', 'storeMode', 'storeIds', 'serviceMode', 'serviceIds'].some(key => get(key) != null)) return null;
  const raw = { subject: get('subject'), domain: 'service-order' };
  for (const [mode, ids] of [['storeMode', 'storeIds'], ['serviceMode', 'serviceIds']]) {
    if (query?.getAll && query.getAll(mode).length > 1 || query?.getAll && query.getAll(ids).length > 1) fail('政策范围查询重复');
    const value = get(ids);
    if (get(mode) === 'all') { if (value != null && value !== '') fail('全部范围不能夹带指定来源'); raw[ids] = null; }
    else if (get(mode) === 'selected') { try { raw[ids] = list(JSON.parse(value), '政策指定来源'); } catch { fail('政策指定来源查询无效'); } }
    else fail('政策范围查询未明确');
  }
  if (query?.getAll && query.getAll('subject').length > 1) fail('政策主体查询重复');
  return scope(raw);
}
const units = { days: 86400000n, hours: 3600000n, minutes: 60000n, milliseconds: 1n };
function amount(value, unit, label) {
  // Decimal arithmetic avoids rounding an existing explicit interval into a new value.
  if (typeof value !== 'string' || value.length > 40 || !/^\d+(?:\.\d{1,12})?$/.test(value) || !Object.hasOwn(units, unit)) fail('请填写明确的' + label + '及单位');
  const [whole, fraction = ''] = value.split('.'), scale = 10n ** BigInt(fraction.length), numerator = BigInt(whole + fraction) * units[unit];
  if (numerator % scale !== 0n) fail(label + '须换算为准确整数毫秒');
  const result = numerator / scale;
  if (result <= 0n || result > BigInt(Number.MAX_SAFE_INTEGER)) fail(label + '必须为有效正数');
  return Number(result);
}
function positive(value, label) { if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) fail('请填写明确的' + label); return Number(value); }
export function qualityPolicyLocalTime(value, label = '时间') {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/.test(value)) fail('请填写明确的' + label);
  const result = Date.parse(value + '+08:00'), parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(value), expected = parts.slice(1, 7).map(Number);
  const d = new Date(result + 8 * 3600000);
  if (!Number.isSafeInteger(result) || result < 0 || [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()].some((n, i) => n !== (expected[i] || 0))) fail(label + '不是有效日历时间');
  return result;
}
function choice(value, allowed, label) { return allowed.includes(value) ? value : fail('请明确选择' + label); }
function unused(raw, keys, label) { if (keys.some(key => Array.isArray(raw[key]) ? raw[key].length : raw[key] != null && raw[key] !== '')) fail(label + '不能夹带不适用字段'); }
const publishKeys = ['scope', 'expectedVersion', 'sourceToken', 'retainedRules', 'editingRuleId', 'ruleId', 'trigger', 'sourceKinds', 'minimum', 'windowDays', 'windowUnit', 'timeBasis', 'withdrawn', 'corrected', 'endMode', 'durationDays', 'durationUnit', 'restorationMode', 'retrainingMode', 'retrainingServiceIds', 'appealExecution', 'validFrom', 'validUntilMode', 'validTo', 'reference', 'basisVersion', 'occurredAt', 'requestId'];
export function qualityPolicyFormPayload(type, raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('政策表单结构无效');
  if (type === 'quality.policy-withdraw') {
    const allowed = ['id', 'version', 'revision', 'sourceToken', 'reference', 'basisVersion', 'occurredAt', 'reason', 'requestId'];
    if (Object.keys(raw).some(key => !allowed.includes(key))) fail('撤回表单含未允许字段');
    return { id: raw.id, version: raw.version, revision: raw.revision, sourceToken: raw.sourceToken, reference: text(raw.reference, '撤回依据引用'), basisVersion: text(raw.basisVersion, '撤回依据版本'), occurredAt: qualityPolicyLocalTime(raw.occurredAt, '实际撤回时间'), reason: text(raw.reason, '实际撤回原因'), requestId: raw.requestId };
  }
  if (type !== 'quality.policy-publish') fail('不是质量政策表单命令');
  if (Object.keys(raw).some(key => !publishKeys.includes(key))) fail('发布表单含未允许字段');
  const selectedScope = scope(raw.scope), definition = definitions[raw.trigger];
  if (!definition || definition.subject !== selectedScope.subject) fail('规则触发与原主体不一致');
  if (!Array.isArray(raw.retainedRules) || raw.retainedRules.some(r => !r || typeof r.id !== 'string' || !r.id) || new Set(raw.retainedRules.map(r => r.id)).size !== raw.retainedRules.length) fail('原保留规则快照无效');
  const id = text(raw.ruleId, '规则编号'), editing = raw.editingRuleId;
  if (editing !== null && (typeof editing !== 'string' || editing !== id || raw.retainedRules.filter(r => r.id === editing).length !== 1)) fail('原修订规则来源不一致');
  if (editing === null && raw.retainedRules.some(r => r.id === id)) fail('新增规则编号已存在，请选择原规则修订');
  let counting = null;
  if (definition.series) counting = { unit: 'distinct-source', minimum: positive(raw.minimum, '成立次数'), windowMs: amount(raw.windowDays, raw.windowUnit, '观察窗口'), timeBasis: choice(raw.timeBasis, ['occurredAt', 'establishedAt'], '计次时间'), withdrawn: choice(raw.withdrawn, ['exclude', 'count-original'], '撤回计次口径'), corrected: choice(raw.corrected, ['current-only', 'count-original'], '更正计次口径') };
  else unused(raw, ['minimum', 'windowDays', 'windowUnit', 'timeBasis', 'withdrawn', 'corrected'], '单个事件');
  const endMode = choice(raw.endMode, ['duration', 'manual-review'], '结束方式');
  if (raw.trigger === 'tech-severe-event' && endMode !== 'manual-review') fail('严重调查必须按实际审核与生命周期决定结束');
  const durationMs = endMode === 'duration' ? amount(raw.durationDays, raw.durationUnit, '限制期限') : (unused(raw, ['durationDays', 'durationUnit'], '人工审核结束'), null);
  let restoration;
  if (definition.restoration === 'retraining-and-release') {
    if (raw.restorationMode !== definition.restoration) fail('请选择原复训及实际解除');
    const mode = choice(raw.retrainingMode, ['all', 'selected'], '复训项目范围');
    restoration = { mode: definition.restoration, serviceIds: mode === 'all' ? null : list(raw.retrainingServiceIds, '复训原项目') };
    if (mode === 'all' && selectedScope.serviceIds !== null) fail('指定政策项目须明确对应复训项目');
    if (mode === 'all') unused(raw, ['retrainingServiceIds'], '全部复训项目');
  } else {
    unused(raw, ['retrainingMode', 'retrainingServiceIds'], '该恢复方式');
    const mode = definition.restoration ? choice(raw.restorationMode, [definition.restoration], '实际生命周期决定') : choice(raw.restorationMode, ['expiry', 'explicit-release'], '限制解除方式');
    if (endMode === 'manual-review' && mode === 'expiry') fail('人工审核结束须实际解除');
    restoration = { mode, serviceIds: null };
  }
  const rule = { id, trigger: raw.trigger, sourceKinds: list(raw.sourceKinds, '真实核实来源类别'), counting, effect: { kind: definition.effect, endMode, durationMs }, restoration, appeal: { limit: 1, execution: choice(raw.appealExecution, ['continues', 'suspend-until-review'], '申诉期间执行口径') } };
  const rules = copy(raw.retainedRules);
  if (editing === null) rules.push(rule); else rules[rules.findIndex(r => r.id === editing)] = rule;
  const until = choice(raw.validUntilMode, ['none', 'date'], '政策有效期');
  if (until === 'none') unused(raw, ['validTo'], '没有结束时间');
  return { scope: selectedScope, rules, validFrom: qualityPolicyLocalTime(raw.validFrom, '生效时间'), validTo: until === 'none' ? null : qualityPolicyLocalTime(raw.validTo, '政策结束时间'), basis: { reference: text(raw.reference, '政策依据引用'), version: text(raw.basisVersion, '政策依据版本'), occurredAt: qualityPolicyLocalTime(raw.occurredAt, '实际决定时间') }, expectedVersion: raw.expectedVersion, sourceToken: raw.sourceToken, requestId: raw.requestId };
}
export function syncQualityPolicyForm(form) {
  if (form?.dataset?.command !== 'quality.policy-publish') return;
  const control = name => form.elements?.namedItem?.(name) || form.querySelector?.(`[name="${name}"]`);
  const value = name => control(name)?.value || '';
  const definition = definitions[value('trigger')];
  const visibility = { counting: !!definition?.series, duration: value('endMode') === 'duration' && !!definition && value('trigger') !== 'tech-severe-event', retraining: definition?.restoration === 'retraining-and-release', retrainingIds: definition?.restoration === 'retraining-and-release' && value('retrainingMode') === 'selected', validTo: value('validUntilMode') === 'date' };
  for (const section of form.querySelectorAll('[data-quality-policy-section]')) {
    const active = !!visibility[section.dataset.qualityPolicySection]; section.hidden = !active; section.disabled = !active;
    for (const input of section.querySelectorAll('input,select,textarea')) input.disabled = !active;
  }
  for (const input of form.querySelectorAll('[data-quality-policy-source]')) {
    const applicable = !definition || input.dataset.qualityPolicySource.split(' ').includes(value('trigger'));
    input.disabled = !applicable; input.closest?.('label')?.toggleAttribute?.('hidden', !applicable);
  }
  const end = control('endMode');
  if (end?.options) for (const option of end.options) if (option.value === 'duration') option.disabled = value('trigger') === 'tech-severe-event';
  const restoration = control('restorationMode');
  if (restoration?.options) for (const option of restoration.options) if (option.value) option.disabled = !!definition && (definition.restoration ? option.value !== definition.restoration : !['expiry', 'explicit-release'].includes(option.value) || value('endMode') === 'manual-review' && option.value === 'expiry');
}
