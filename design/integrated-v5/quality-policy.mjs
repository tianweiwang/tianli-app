// Explicit quality policy publication. No policy values or effects are installed by default.
// Call commands on the original reduce clone; the caller owns persistence and rollback.
import { resolveAccountActor } from './staff-accounts.mjs';
import { lifecycleFingerprint as hash } from './organization-lifecycle-projection.mjs';

const clone = value => structuredClone(value);
const fail = message => { throw new Error(message); };
const commands = new Set(['quality.policy-publish', 'quality.policy-withdraw']);
const digest = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const timeValid = value => Number.isSafeInteger(value) && value >= 0 && Number.isFinite(new Date(value).getTime());
function time(value, label) { if (!timeValid(value)) fail(label + '须为有效毫秒时间'); return value; }
function integer(value, label, minimum = 0) { if (!Number.isSafeInteger(value) || value < minimum) fail(label + '无效'); return value; }
function text(value, label, max = 1000) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) fail('请填写' + label);
  return value.trim();
}
function object(value, keys, label, optionalKeys = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail(label + '结构无效');
  if (Object.keys(value).some(key => !keys.includes(key))) fail(label + '含未允许字段');
  for (const key of keys) if (!optionalKeys.includes(key) && !Object.hasOwn(value, key)) fail(label + '缺少' + key);
  return value;
}
function unique(rows, id, label) {
  const found = Array.isArray(rows) ? rows.filter(row => row?.id === id) : [];
  if (typeof id !== 'string' || !id || found.length !== 1) fail(label + '原来源缺失或不唯一');
  return found[0];
}
function ids(value, rows, label) {
  if (value === null) return null;
  if (!Array.isArray(value) || !value.length || value.some(id => typeof id !== 'string' || !id || id !== id.trim()) || new Set(value).size !== value.length) fail(label + '须明确全部或唯一原来源列表');
  for (const id of value) unique(rows, id, label);
  return [...value].sort();
}
function scopeValue(s, input) {
  object(input, ['subject', 'domain', 'storeIds', 'serviceIds'], '政策范围');
  if (!['tech', 'user'].includes(input.subject) || input.domain !== 'service-order') fail('政策仅支持明确技师或用户的服务新单范围');
  return { subject: input.subject, domain: input.domain, storeIds: ids(input.storeIds, s.stores, '政策门店'), serviceIds: ids(input.serviceIds, s.services, '政策项目') };
}
const triggers = {
  'tech-noshow': { subject: 'tech', sources: ['verified-fulfilment-responsibility', 'established-care'], effect: 'stop-new-service', restoration: 'retraining-and-release' },
  'tech-general-series': { subject: 'tech', sources: ['effective-general-warning'], series: true, effect: 'stop-new-service', restoration: 'retraining-and-release' },
  'tech-severe-event': { subject: 'tech', sources: ['established-safety', 'established-dispute', 'established-care'], effect: 'investigation-stop-new-service', restoration: 'lifecycle-decision' },
  'user-interruption': { subject: 'user', sources: ['established-dispute', 'established-care'], effect: 'restrict-new-service' },
  'user-abuse': { subject: 'user', sources: ['established-safety', 'established-care'], effect: 'restrict-new-service' },
  'user-noshow-series': { subject: 'user', sources: ['verified-fulfilment-responsibility'], series: true, effect: 'restrict-new-service' },
  'user-malicious-refund': { subject: 'user', sources: ['established-care', 'established-dispute'], effect: 'restrict-new-service' }
};
function ruleValue(s, scope, rule) {
  object(rule, ['id', 'trigger', 'sourceKinds', 'counting', 'effect', 'restoration', 'appeal'], '政策规则');
  const id = text(rule.id, '规则编号', 100), definition = triggers[rule.trigger];
  if (!definition || definition.subject !== scope.subject) fail('规则事件与政策主体不一致');
  if (!Array.isArray(rule.sourceKinds) || !rule.sourceKinds.length || new Set(rule.sourceKinds).size !== rule.sourceKinds.length || rule.sourceKinds.some(kind => !definition.sources.includes(kind))) fail('规则须指定对应真实核实来源类别');
  let counting = null;
  if (definition.series) {
    object(rule.counting, ['unit', 'minimum', 'windowMs', 'timeBasis', 'withdrawn', 'corrected'], '政策计次');
    if (rule.counting.unit !== 'distinct-source' || !['occurredAt', 'establishedAt'].includes(rule.counting.timeBasis) || !['exclude', 'count-original'].includes(rule.counting.withdrawn) || !['current-only', 'count-original'].includes(rule.counting.corrected)) fail('政策须明确去重、时间和撤回/更正计次口径');
    counting = { ...rule.counting, minimum: integer(rule.counting.minimum, '成立次数', 1), windowMs: integer(rule.counting.windowMs, '观察窗口', 1) };
  } else if (rule.counting !== null) fail('单个核实事件不能自填计次');
  object(rule.effect, ['kind', 'endMode', 'durationMs'], '政策执行');
  if (rule.effect.kind !== definition.effect || !['duration', 'manual-review'].includes(rule.effect.endMode)) fail('规则执行动作或结束方式无效');
  const durationMs = rule.effect.endMode === 'duration' ? integer(rule.effect.durationMs, '显式限制期限', 1) : rule.effect.durationMs === null ? null : fail('人工审核结束不得伪填期限');
  if (rule.trigger === 'tech-severe-event' && rule.effect.endMode !== 'manual-review') fail('严重调查须明确实际审核及原生命周期决定');
  object(rule.restoration, ['mode', 'serviceIds'], '政策恢复');
  let restoration;
  if (definition.restoration) {
    if (rule.restoration.mode !== definition.restoration) fail('技师处罚须保留原复训解除或生命周期决定链');
    if (definition.restoration === 'retraining-and-release') {
      const serviceIds = ids(rule.restoration.serviceIds, s.services, '复训项目');
      if (scope.serviceIds && (serviceIds === null || serviceIds.some(id => !scope.serviceIds.includes(id)))) fail('复训项目不得扩大政策项目范围');
      restoration = { mode: rule.restoration.mode, serviceIds };
    } else {
      if (rule.restoration.serviceIds !== null) fail('生命周期决定不能伪填复训项目');
      restoration = clone(rule.restoration);
    }
  } else {
    if (!['expiry', 'explicit-release'].includes(rule.restoration.mode) || rule.restoration.serviceIds !== null || rule.effect.endMode === 'manual-review' && rule.restoration.mode !== 'explicit-release') fail('用户限制须明确到期或实际解除且不改技师资格');
    restoration = clone(rule.restoration);
  }
  object(rule.appeal, ['limit', 'execution'], '政策申诉');
  if (rule.appeal.limit !== 1 || !['continues', 'suspend-until-review'].includes(rule.appeal.execution)) fail('政策须明确一次申诉及申诉期间执行口径');
  return { id, trigger: rule.trigger, sourceKinds: [...rule.sourceKinds].sort(), counting, effect: { ...rule.effect, durationMs }, restoration, appeal: clone(rule.appeal) };
}
function rulesValue(s, scope, rules) {
  if (!Array.isArray(rules) || !rules.length) fail('不能发布空政策规则');
  const result = rules.map(rule => ruleValue(s, scope, rule));
  if (new Set(result.map(rule => rule.id)).size !== result.length) fail('政策规则编号不唯一');
  return result;
}
function basisValue(basis, now) {
  object(basis, ['reference', 'version', 'occurredAt'], '政策实际决定依据');
  const occurredAt = time(basis.occurredAt, '实际决定时间');
  if (occurredAt > now) fail('实际决定时间不能晚于登记时间');
  return { reference: text(basis.reference, '政策依据引用', 300), version: text(basis.version, '政策依据版本', 100), occurredAt };
}
function publisher(s, rawActor) {
  time(s.now, '当前时间');
  const actor = resolveAccountActor(s, rawActor);
  if (actor?.role !== 'group' || actor.job !== 'support' || !actor.accountId || !actor.grantId || !actor.sessionId || actor.lifecyclePurpose) fail('仅当前真实集团客服工作会话可发布或撤回质量政策');
  const session = unique(s.staffSessions, actor.sessionId, '政策工作会话'), account = unique(s.staffAccounts, actor.accountId, '政策工作账号'), grant = unique(account.grants, actor.grantId, '政策工作授权');
  if (session.accountId !== account.id || session.grantId !== grant.id || grant.purpose != null) fail('限定承接或冲突岗位不能发布质量政策');
  const author = { role: 'group', job: 'support', accountId: account.id, grantId: grant.id, sessionId: session.id, accountVersion: account.version };
  authorSource(s, author, s.now);
  return author;
}
function authorSource(s, author, at) {
  object(author, ['role', 'job', 'accountId', 'grantId', 'sessionId', 'accountVersion'], '政策实际作者');
  const session = unique(s.staffSessions, author.sessionId, '原政策会话'), account = unique(s.staffAccounts, author.accountId, '原政策账号'), grant = unique(account.grants, author.grantId, '原政策授权');
  if (!timeValid(account.createdAt) || account.createdAt > at) fail('原政策账号建档时间待核对');
  if (author.role !== 'group' || author.job !== 'support' || grant.role !== 'group' || grant.job !== 'support' || grant.purpose != null || session.accountId !== account.id || session.grantId !== grant.id || session.accountVersion !== author.accountVersion || !Number.isSafeInteger(author.accountVersion) || author.accountVersion < 1 || !timeValid(session.issuedAt) || session.issuedAt > at || !timeValid(grant.createdAt) || grant.createdAt > at || grant.validFrom != null && (!timeValid(grant.validFrom) || grant.validFrom > at) || grant.validTo != null && (!timeValid(grant.validTo) || grant.validTo <= at) || session.revokedAt != null && (!timeValid(session.revokedAt) || session.revokedAt < at) || grant.revokedAt != null && (!timeValid(grant.revokedAt) || grant.revokedAt < at) || session.expiresAt != null && (!timeValid(session.expiresAt) || session.expiresAt <= at)) fail('原政策作者或当时工作来源待核对');
  // A later revoked grant/session remains the original publication evidence.
}
const actorDigest = author => hash({ role: author.role, job: author.job, accountId: author.accountId, grantId: author.grantId });
function requestValue(request, author) {
  object(request, ['requestId', 'actorDigest', 'fingerprint'], '原政策提交来源');
  text(request.requestId, '原稳定提交编号', 300);
  if (!digest(request.fingerprint) || request.actorDigest !== actorDigest(author)) fail('原政策提交摘要与作者不一致');
}
const immutable = row => ({ recordVersion: row.recordVersion, id: row.id, version: row.version, scope: row.scope, rules: row.rules, validFrom: row.validFrom, validTo: row.validTo, basis: row.basis, publication: row.publication });
const rowToken = row => hash(row);
function sourceRows(s) {
  time(s.now, '当前时间');
  if (s.qualityPolicies != null && !Array.isArray(s.qualityPolicies) || s.qualityPolicyRequests != null && !Array.isArray(s.qualityPolicyRequests)) fail('政策原来源容器无效');
  const rows = s.qualityPolicies || [], requests = s.qualityPolicyRequests || [], streamVersions = new Set(), events = [];
  for (const row of rows) {
    object(row, ['recordVersion', 'id', 'version', 'revision', 'scope', 'rules', 'validFrom', 'validTo', 'basis', 'publication', 'contentFingerprint', 'status', 'withdrawal', 'events'], '原发布政策', ['events']);
    // Original engine logs append audit events. They do not grant publication
    // authority or change the immutable publication/withdrawal evidence.
    if (Object.hasOwn(row, 'events') && !Array.isArray(row.events)) fail('原政策日志容器无效');
    if (row.recordVersion !== 1 || !['published', 'withdrawn'].includes(row.status)) fail('政策记录版本或发布状态无效');
    text(row.id, '原政策编号', 100); unique(rows, row.id, '原政策'); integer(row.version, '原政策版本', 1);
    const scope = scopeValue(s, row.scope), streamKey = hash(scope) + ':' + row.version;
    if (streamVersions.has(streamKey)) fail('同范围政策版本来源不唯一');
    streamVersions.add(streamKey);
    if (hash(scope) !== hash(row.scope) || hash(rulesValue(s, scope, row.rules)) !== hash(row.rules)) fail('原政策范围或规则格式已变化');
    object(row.publication, ['at', 'by', 'request'], '政策发布事实');
    const publishedAt = time(row.publication.at, '原发布时间');
    if (publishedAt > s.now) fail('原发布发生在未来');
    authorSource(s, row.publication.by, publishedAt); requestValue(row.publication.request, row.publication.by);
    if (hash(basisValue(row.basis, publishedAt)) !== hash(row.basis)) fail('原政策依据已变化');
    time(row.validFrom, '政策生效时间');
    if (row.validFrom < publishedAt || row.validTo !== null && (!timeValid(row.validTo) || row.validTo <= row.validFrom)) fail('原政策有效期无效');
    if (row.contentFingerprint !== hash(immutable(row))) fail('原政策发布内容摘要不匹配');
    events.push({ row, type: 'quality.policy-publish', at: publishedAt, request: row.publication.request, result: { id: row.id, version: row.version, revision: 1 } });
    if (row.status === 'published') { if (row.revision !== 1 || row.withdrawal !== null) fail('原发布版状态与历史不一致'); }
    else {
      if (row.revision !== 2) fail('原撤回版本无效');
      const w = object(row.withdrawal, ['at', 'by', 'reference', 'basisVersion', 'occurredAt', 'reason', 'request', 'contentFingerprint'], '政策撤回事实');
      if (!timeValid(w.at) || w.at < publishedAt || w.at > s.now || !timeValid(w.occurredAt) || w.occurredAt < publishedAt || w.occurredAt > w.at) fail('原撤回发生时间无效');
      text(w.reference, '原撤回依据引用', 300); text(w.basisVersion, '原撤回依据版本', 100); text(w.reason, '原撤回原因'); authorSource(s, w.by, w.at); requestValue(w.request, w.by);
      const { contentFingerprint, ...withdrawalFacts } = w;
      if (contentFingerprint !== hash(withdrawalFacts)) fail('原政策撤回事实摘要不匹配');
      events.push({ row, type: 'quality.policy-withdraw', at: w.at, request: w.request, result: { id: row.id, version: row.version, revision: 2 } });
    }
  }
  const streams = new Map();
  for (const row of rows) { const key = hash(row.scope); if (!streams.has(key)) streams.set(key, []); streams.get(key).push(row); }
  for (const stream of streams.values()) {
    stream.sort((a, b) => a.version - b.version);
    for (let i = 0; i < stream.length; i++) if (stream[i].version !== i + 1 || i && (stream[i].validFrom < stream[i - 1].validFrom || stream[i].publication.at < stream[i - 1].publication.at)) fail('政策版本链缺失或生效顺序冲突');
  }
  if (requests.length !== events.length) fail('政策请求与实际发布/撤回事实不完整');
  const requestKeys = new Set();
  for (const request of requests) {
    object(request, ['digestVersion', 'digestAlgorithm', 'actorDigest', 'requestId', 'type', 'fingerprint', 'at', 'result'], '原政策请求');
    const key = request.actorDigest + ':' + request.requestId;
    if (requestKeys.has(key)) fail('原政策请求来源不唯一');
    requestKeys.add(key);
    if (request.digestVersion !== 1 || request.digestAlgorithm !== 'SHA-256' || !digest(request.fingerprint) || !digest(request.actorDigest)) fail('原政策请求摘要版本无效');
    const matches = events.filter(event => event.request.actorDigest === request.actorDigest && event.request.requestId === request.requestId);
    if (matches.length !== 1 || matches[0].type !== request.type || matches[0].at !== request.at || matches[0].request.fingerprint !== request.fingerprint || hash(matches[0].result) !== hash(request.result)) fail('原政策请求与唯一实际结果不匹配');
  }
  return rows;
}
export function upgradeQualityPolicies(s) { s.qualityPolicies ??= []; s.qualityPolicyRequests ??= []; return s; }
export function qualityPolicyStream(s, input) {
  const scope = scopeValue(s, input), rows = sourceRows(s).filter(row => hash(row.scope) === hash(scope)).sort((a, b) => a.version - b.version);
  return { scope: clone(scope), version: rows.at(-1)?.version || 0, sourceToken: hash({ scope, rows }) };
}
function strictPayload(p, keys) { return object(p, keys, '政策提交'); }
export function qualityPolicyCommand(s, rawActor, type, p = {}, ctx = {}) {
  if (!commands.has(type)) return undefined;
  const author = publisher(s, rawActor), creating = type === 'quality.policy-publish';
  strictPayload(p, creating ? ['scope', 'rules', 'validFrom', 'validTo', 'basis', 'expectedVersion', 'sourceToken', 'requestId'] : ['id', 'version', 'revision', 'sourceToken', 'reference', 'basisVersion', 'occurredAt', 'reason', 'requestId']);
  const rows = sourceRows(s), scope = creating ? scopeValue(s, p.scope) : unique(rows, p.id, '原撤回政策').scope;
  // Validate values before digest replay: JSON maps NaN to null and drops undefined.
  // A malformed payload must not collide with a prior valid request's digest.
  if (!digest(p.sourceToken)) fail('政策来源摘要格式无效');
  let proposed;
  if (creating) {
    integer(p.expectedVersion, '原范围版本');
    const validFrom = time(p.validFrom, '显式生效时间');
    if (p.validTo !== null && (!timeValid(p.validTo) || p.validTo <= validFrom)) fail('政策有效期不能为空期限');
    proposed = { rules: rulesValue(s, scope, p.rules), basis: basisValue(p.basis, s.now), validFrom };
  } else {
    integer(p.version, '原政策版本', 1); integer(p.revision, '原政策修订', 1);
    text(p.reference, '撤回依据引用', 300); text(p.basisVersion, '撤回依据版本', 100); text(p.reason, '撤回原因');
    if (time(p.occurredAt, '实际撤回时间') > s.now) fail('实际撤回时间不能晚于当前时间');
  }
  const requestId = text(p.requestId, '稳定提交编号', 300), request = { requestId, actorDigest: actorDigest(author), fingerprint: hash({ type, p }) };
  const previous = (s.qualityPolicyRequests || []).filter(r => r.actorDigest === request.actorDigest && r.requestId === requestId);
  if (previous.length) {
    if (previous[0].fingerprint !== request.fingerprint || previous[0].type !== type) fail('同一提交编号不能用于不同政策内容');
    unique(rows, previous[0].result.id, '原请求政策');
    return clone(previous[0].result);
  }
  let row;
  if (creating) {
    const stream = qualityPolicyStream(s, scope);
    if (integer(p.expectedVersion, '原范围版本') !== stream.version || p.sourceToken !== stream.sourceToken) fail('政策原版本或来源已更新，请刷新');
    const { rules, basis, validFrom } = proposed;
    if (validFrom < s.now || p.validTo !== null && (!timeValid(p.validTo) || p.validTo <= validFrom)) fail('政策有效期不能回溯或为空期限');
    const earlier = rows.filter(r => hash(r.scope) === hash(scope)).sort((a, b) => a.version - b.version).at(-1);
    if (earlier && validFrom < earlier.validFrom) fail('新版本生效时间不能早于前版计划');
    const id = ctx.id ? ctx.id('QP') : 'QP' + (s.seq = integer(s.seq ?? 0, '编号序列') + 1);
    text(id, '政策编号', 100); if (rows.some(r => r.id === id)) fail('政策编号已存在');
    row = { recordVersion: 1, id, version: stream.version + 1, revision: 1, scope, rules, validFrom, validTo: p.validTo, basis, publication: { at: s.now, by: author, request }, contentFingerprint: null, status: 'published', withdrawal: null, events: [] };
    row.contentFingerprint = hash(immutable(row));
    upgradeQualityPolicies(s); s.qualityPolicies.push(row);
  } else {
    row = unique(rows, p.id, '原撤回政策');
    if (integer(p.version, '原政策版本', 1) !== row.version || integer(p.revision, '原政策修订', 1) !== row.revision || p.sourceToken !== rowToken(row)) fail('原政策版本或撤回来源已变化');
    if (row.status !== 'published') fail('原政策已实际撤回，不能重复撤回');
    const occurredAt = time(p.occurredAt, '实际撤回时间');
    if (occurredAt < row.publication.at || occurredAt > s.now) fail('实际撤回时间须在原发布后且不晚于当前时间');
    row.withdrawal = { at: s.now, by: author, reference: text(p.reference, '撤回依据引用', 300), basisVersion: text(p.basisVersion, '撤回依据版本', 100), occurredAt, reason: text(p.reason, '撤回原因'), request };
    row.withdrawal.contentFingerprint = hash(row.withdrawal);
    row.status = 'withdrawn'; row.revision = 2;
  }
  const result = { id: row.id, version: row.version, revision: row.revision };
  s.qualityPolicyRequests.push({ digestVersion: 1, digestAlgorithm: 'SHA-256', actorDigest: request.actorDigest, requestId, type, fingerprint: request.fingerprint, at: s.now, result: clone(result) });
  ctx.log?.(row, '质量政策 ' + type + ' · ' + row.id);
  return clone(result);
}
export function qualityPolicySource(s, query = {}) {
  try {
    const scope = scopeValue(s, query.scope), mode = query.mode || 'current', rows = sourceRows(s).filter(row => hash(row.scope) === hash(scope));
    if (!['current', 'historical'].includes(mode)) fail('政策读取模式无效');
    const at = mode === 'current' ? s.now : time(query.at, '原决定发生时间');
    if (at > s.now || mode === 'current' && query.at != null && query.at !== s.now) fail('当前政策须用实际当前时间，历史时间不得在未来');
    if (mode === 'historical' && (!query.policyId || !Number.isSafeInteger(query.version))) fail('历史政策必须精确原id和版本');
    const effective = rows.filter(row => row.publication.at <= at && row.validFrom <= at).sort((a, b) => b.version - a.version)[0];
    if (!effective) return { available: false, reason: '没有实际生效的发布政策' };
    if (query.policyId != null && query.policyId !== effective.id || query.version != null && query.version !== effective.version) fail('指定政策不是该时点的唯一有效发布版');
    if (effective.validTo !== null && effective.validTo <= at || effective.withdrawal && effective.withdrawal.at <= at) return { available: false, reason: '该范围最新生效版已过期或实际撤回，旧版不自动复活' };
    let rule;
    if (query.ruleId != null) { const matches = effective.rules.filter(r => r.id === query.ruleId); if (matches.length !== 1) fail('原政策规则缺失或不唯一'); rule = matches[0]; }
    // Frozen decisions bind the immutable publication, not a later withdrawal revision.
    // Current callers must still call this getter again before executing a new decision.
    return { available: true, scope: clone(scope), policy: clone(effective), ...(rule ? { rule: clone(rule) } : {}), sourceToken: effective.contentFingerprint };
  } catch (error) { return { available: false, reason: error.message }; }
}
export function qualityPolicyView(s, rawActor, query = {}) {
  try {
    const actor = publisher(s, rawActor), scope = query.scope == null ? null : scopeValue(s, query.scope), rows = sourceRows(s).filter(row => !scope || hash(row.scope) === hash(scope));
    return { canEnter: true, actor: clone(actor), policies: rows.map(row => ({ ...clone(row), sourceToken: rowToken(row) })), ...(scope ? { stream: qualityPolicyStream(s, scope), current: qualityPolicySource(s, { scope }) } : {}) };
  } catch (error) { return { canEnter: false, reason: error.message, policies: [] }; }
}
