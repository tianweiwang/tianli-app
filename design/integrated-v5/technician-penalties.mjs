// General warnings and their one personal appeal. No automatic penalty policy.
import { resolveAccountActor, actorAccountFields, canAccountView, canAccountReadSource } from './staff-accounts.mjs';
import { lifecycleFingerprint } from './organization-lifecycle-projection.mjs';

const commands = new Set(['penalty.warning-record', 'penalty.appeal', 'penalty.appeal-review']);
const clone = value => structuredClone(value);
const fingerprint = value => lifecycleFingerprint(value);
const support = a => a?.role === 'group' && (!a.job || ['support', 'all'].includes(a.job));
// The free-demo manager has no job selector; a previous group job is unrelated.
const local = (a, storeId) => (a?.role === 'manager' || a?.role === 'store' && (!a.job || ['store-manager', 'all'].includes(a.job))) && a.storeId === storeId;
const person = (a, techId) => a?.role === 'tech' && a.techId === techId;
const fail = message => { throw new Error(message); };
const text = (value, label, max = 1000) => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) fail('请填写' + label);
  return value.trim();
};
const optional = (value, label) => value == null || value === '' ? '' : text(value, label);
const integer = (value, label) => {
  if (!['string', 'number'].includes(typeof value) || !String(value).trim() || !Number.isSafeInteger(Number(value)) || Number(value) < 0) fail(label + '无效');
  return Number(value);
};
const unique = (rows, id, label) => {
  const found = Array.isArray(rows) ? rows.filter(row => row?.id === id) : [];
  if (typeof id !== 'string' || !id || found.length !== 1) fail(label + '原来源缺失或不唯一');
  return found[0];
};
const timeValid = value => Number.isSafeInteger(value) && value >= 0 && Number.isFinite(new Date(value).getTime());
function time(value, label, min, now) {
  let result = value;
  if (typeof value === 'string') {
    const m = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)(?::(\d\d)(?:\.\d{1,3})?)?(Z|[+-]\d\d:\d\d)?$/.exec(value);
    if (!m || +m[2] < 1 || +m[2] > 12 || +m[3] < 1 || +m[3] > new Date(Date.UTC(+m[1], +m[2], 0)).getUTCDate() || +m[4] > 23 || +m[5] > 59 || +(m[6] || 0) > 59) fail(label + '须为真实有效日期时间');
    result = Date.parse(m[7] ? value : value + '+08:00');
  }
  if (!timeValid(result) || result < min || result > now) fail(label + '须在原核实后且不晚于当前时间');
  return result;
}
const by = actor => ({ role: actor.role, job: actor.role === 'manager' ? null : actor.job || null, id: actor.role === 'tech' ? actor.techId : ['store', 'manager'].includes(actor.role) ? actor.storeId : actor.accountId || 'group', ...actorAccountFields(actor) });
const authorValid = (a, storeId) => Boolean(a && (a.role === 'group' ? support(a) && a.id : ['store', 'manager'].includes(a.role) && a.id === storeId && (!a.job || ['store-manager', 'all'].includes(a.job))));

export function upgradeTechnicianPenalties(s) {
  s.technicianPenalties ??= []; s.technicianPenaltyRequests ??= [];
  return s;
}

function caseSource(s, caseId, actionIndex) {
  const c = unique(s.serviceCareCases, caseId, '原投诉'), b = unique(s.bookings, c.bookingId, '原预约');
  unique(s.techs, c.techId, '原技师'); unique(s.stores, c.storeId, '原门店'); unique(s.users, c.userId, '原预约本人');
  if (b.techId !== c.techId || b.storeId !== c.storeId || b.userId !== c.userId || b.status !== 'done' || !timeValid(b.completedAt) || b.completedAt > s.now) fail('原投诉与已完成预约主体不一致');
  const lists = { booking: s.bookings, refund: b.refunds, dispute: b.disputes, safety: s.safety, review: s.serviceReviews, followup: s.serviceCareFollowups };
  const source = unique(lists[c.source?.kind], c.source?.id, '原投诉关联事项');
  if (c.source.kind === 'booking' ? source.id !== b.id : source.bookingId != null ? source.bookingId !== b.id : !['refund', 'dispute'].includes(c.source.kind)) fail('原投诉关联事项串号');
  const index = integer(actionIndex, '处罚专项序号'), action = c.specialistActions?.[index];
  if (action?.kind !== 'penalty' || !timeValid(action.at) || action.at > s.now || !authorValid(action.by, c.storeId)) fail('原专项不是准确已记录的处罚来源');
  if (!Array.isArray(c.resolutions) || !c.resolutions.length) fail('原投诉尚无核实处理结果');
  const matches = c.resolutions.map((r, i) => ({ r, i })).filter(({ r }) => r.at === action.at && fingerprint(r.by) === fingerprint(action.by) && (r.internalNote || r.publicReply) === action.reason);
  if (matches.length !== 1) fail('原处罚专项与核实结论不唯一或已变化');
  const { r, i } = matches[0], latest = c.resolutions.at(-1);
  if (r.decision !== 'respond' || latest.decision !== 'respond' || !timeValid(latest.at) || latest.at > s.now || !authorValid(latest.by, c.storeId)) fail('原投诉未核为成立处理，不能登记一般警告');
  const acceptedAt = latest.final === true && c.final === true ? latest.at : ['user', 'timeout'].includes(c.confirmationMode) && timeValid(c.confirmedAt) && c.confirmedAt >= latest.at ? c.confirmedAt : null;
  if (!timeValid(acceptedAt) || acceptedAt > s.now || !['execution_pending', 'closed', 'withdrawn'].includes(c.status)) fail('原投诉处理尚未接受或集团尚未最终核实');
  const facts = {
    case: { id: c.id, bookingId: c.bookingId, userId: c.userId, storeId: c.storeId, techId: c.techId, category: c.category, description: c.description, evidence: c.evidence, evidenceRefs: c.evidenceRefs, source: c.source, createdAt: c.createdAt, createdBy: c.createdBy },
    booking: { id: b.id, userId: b.userId, storeId: b.storeId, techId: b.techId, completedAt: b.completedAt },
    action: { index, kind: action.kind, at: action.at, by: action.by, reason: action.reason },
    resolution: { index: i, ...r }, latest: { index: c.resolutions.length - 1, ...latest }, acceptedAt
  };
  return { c, b, action, index, resolutionIndex: i, acceptedAt, facts, sourceFingerprint: fingerprint(facts) };
}

function readable(s, actor, source) {
  return canAccountView(actor, 'care') && (local(actor, source.c.storeId) || support(actor) || person(actor, source.c.techId)) && canAccountReadSource(s, actor, 'care-case', source.c);
}
function commandScope(s, actor, source, type) {
  if (!readable(s, actor, source) || actor.lifecyclePurpose && !actor.allowedCommands?.includes(type)) fail('当前岗位或原案件范围无权办理处罚事项');
}
const canAct = (actor, type) => !actor.lifecyclePurpose || actor.allowedCommands?.includes(type);
function recordSource(s, row) {
  const source = caseSource(s, row.source?.caseId, row.source?.actionIndex);
  if (source.action.penaltyId !== row.id || row.techId !== source.c.techId || row.storeId !== source.c.storeId || row.bookingId !== source.b.id || row.source.resolutionIndex !== source.resolutionIndex || row.sourceFingerprint !== source.sourceFingerprint) fail('原警告与当前投诉专项来源不匹配');
  const d = row.decision;
  if (!timeValid(row.createdAt) || row.createdAt > s.now || !Number.isSafeInteger(row.version) || row.version < 1 || !Array.isArray(row.history) || d?.level !== 'general' || d.action !== 'warning' || !d.reference || !d.reason || !timeValid(d.occurredAt) || d.occurredAt < source.acceptedAt || d.occurredAt > row.createdAt || !authorValid(d.by, row.storeId) || !['store', 'manager'].includes(d.by.role)) fail('原一般警告未有真实门店决定入档');
  if (row.appeal) {
    const a = row.appeal;
    if (!a.reason || !timeValid(a.createdAt) || a.createdAt < row.createdAt || a.createdAt > s.now || a.by?.role !== 'tech' || a.by.id !== row.techId || !['pending', 'maintained', 'revoked'].includes(a.status) || a.status === 'pending' && a.review != null) fail('原本人申诉来源待核对');
    if (a.status !== 'pending' && (!a.review || !['maintain', 'revoke'].includes(a.review.decision) || a.status !== (a.review.decision === 'maintain' ? 'maintained' : 'revoked') || !a.review.reference || !a.review.reason || !timeValid(a.review.occurredAt) || !timeValid(a.review.recordedAt) || a.review.recordedAt > s.now || a.review.occurredAt < a.createdAt || a.review.occurredAt > a.review.recordedAt || !authorValid(a.review.by, row.storeId) || !support(a.review.by))) fail('原集团复核决定来源待核对');
  }
  return source;
}
const status = row => row.appeal?.status === 'pending' ? 'appeal_pending' : row.appeal?.status || 'warning';
const statusLabels = { warning: '一般警告已入档', appeal_pending: '本人申诉待集团复核', maintained: '集团已维持警告', revoked: '集团已撤回警告' };
const rowToken = (row, source) => fingerprint({ id: row.id, version: row.version, source: source.sourceFingerprint, decision: row.decision, appeal: row.appeal });

export function technicianPenaltyCaseResolution(s, caseId, actionIndex) {
  let penaltyId;
  try {
    const source = caseSource(s, caseId, actionIndex); penaltyId = source.action.penaltyId;
    const row = unique(s.technicianPenalties, penaltyId, '原处罚决定');
    recordSource(s, row);
    return { complete: true, caseId, actionIndex: source.index, penaltyId: row.id, status: status(row), sourceToken: rowToken(row, source) };
  } catch (error) {
    return { complete: false, caseId, actionIndex, ...(penaltyId ? { penaltyId } : {}), reason: error.message };
  }
}
export function technicianPenaltyCaseBlockers(s, caseOrId) {
  const c = typeof caseOrId === 'string' ? (s.serviceCareCases || []).find(row => row.id === caseOrId) : caseOrId;
  if (!c) return ['原投诉不存在，处罚来源待核对'];
  return (c.specialistActions || []).flatMap((action, index) => {
    if (action.kind !== 'penalty') return [];
    const result = technicianPenaltyCaseResolution(s, c.id, index);
    return result.complete ? [] : ['处罚专项未有匹配的实际决定：' + result.reason];
  });
}

function audit(s, row, actor, type, reason, ctx, details = {}) {
  row.version++; row.updatedAt = s.now;
  row.history.push({ type, at: s.now, by: by(actor), reason, version: row.version, ...clone(details) });
  ctx?.log?.(row, '技师处罚 ' + type + ' · ' + row.id);
}
function checkVersion(value, expected) {
  if (integer(value, '原记录版本') !== expected) fail('处罚或原案件版本已更新，请刷新核对');
}
function rejectUndecidedPolicy(p) {
  if (p.level != null && p.level !== 'general' || p.action != null && p.action !== 'warning' || ['startAt', 'endAt', 'durationDays', 'amountCents', 'fineCents'].some(key => Object.hasOwn(p, key))) fail('正式较重/严重处罚标准和执行政策尚未明确，不能以一般警告伪执行');
}

export function technicianPenaltyCommand(s, rawActor, type, p = {}, ctx = {}) {
  if (!commands.has(type)) return undefined;
  const actor = resolveAccountActor(s, rawActor), creating = type === 'penalty.warning-record';
  let row = creating ? null : unique(s.technicianPenalties, p.id, '原处罚');
  const source = creating ? caseSource(s, p.caseId, p.actionIndex) : recordSource(s, row);
  commandScope(s, actor, source, type);
  if (creating ? !local(actor, source.c.storeId) : type === 'penalty.appeal' ? !person(actor, row.techId) : !support(actor)) fail('当前岗位或原技师本人无权执行此处罚动作');
  rejectUndecidedPolicy(p);
  const requestId = text(p.requestId, '稳定提交编号', 300), actorKey = fingerprint(by(actor)), signature = fingerprint({ type, p });
  const requests = s.technicianPenaltyRequests;
  if (requests != null && !Array.isArray(requests)) fail('原处罚请求来源容器无效');
  const matches = (requests || []).filter(r => r.actorKey === actorKey && r.requestId === requestId);
  if (matches.length > 1) fail('原处罚请求来源不唯一');
  if (matches.length) {
    if (matches[0].signature !== signature) fail('同一提交编号不能用于不同处罚内容');
    recordSource(s, unique(s.technicianPenalties, matches[0].result.id, '原请求处罚决定'));
    return clone(matches[0].result);
  }
  if (creating) {
    checkVersion(p.caseVersion, source.c.version);
    if (source.action.penaltyId != null || (s.technicianPenalties || []).some(r => r.source?.caseId === source.c.id && r.source.actionIndex === source.index)) fail('原专项已有处罚决定，不能重复警告入档');
    if (source.c.status !== 'execution_pending') fail('仅原已核投诉的待执行专项可登记一般警告');
    const token = fingerprint({ source: source.facts, caseVersion: source.c.version, by: by(actor) });
    if (p.sourceToken !== token) fail('原处罚核实来源或当前岗位已变化，请刷新');
    const decision = { level: 'general', action: 'warning', reference: text(p.reference, '实际警告决定来源编号', 200), occurredAt: time(p.occurredAt, '实际决定时间', source.acceptedAt, s.now), reason: text(p.reason, '本人可见的一般问题事实与警告依据'), internalNote: optional(p.internalNote, '内部核实备注'), by: by(actor) };
    upgradeTechnicianPenalties(s);
    const id = ctx.id ? ctx.id('TP') : 'TP' + (s.seq = (s.seq || 0) + 1);
    if (!id || s.technicianPenalties.some(r => r.id === id)) fail('处罚决定编号已存在');
    row = { id, techId: source.c.techId, storeId: source.c.storeId, bookingId: source.b.id, source: { caseId: source.c.id, actionIndex: source.index, resolutionIndex: source.resolutionIndex }, sourceFingerprint: source.sourceFingerprint, decision, appeal: null, version: 0, createdAt: s.now, updatedAt: s.now, history: [] };
    s.technicianPenalties.push(row);
    source.action.penaltyId = row.id; source.c.version++; source.c.updatedAt = s.now;
    (source.c.history ??= []).push({ action: '关联实际一般警告', at: s.now, by: by(actor), version: source.c.version, penaltyId: row.id, actionIndex: source.index });
    audit(s, row, actor, type, decision.reason, ctx);
  } else {
    checkVersion(p.version, row.version);
    if (p.sourceToken !== rowToken(row, source)) fail('原处罚决定或申诉来源已变化，请刷新');
    const reason = text(p.reason, type === 'penalty.appeal' ? '本人申诉事实与理由' : '本人可见的集团复核依据');
    if (type === 'penalty.appeal') {
      if (row.appeal) fail('每笔原处罚只能由本人申诉一次');
      row.appeal = { status: 'pending', reason, createdAt: s.now, by: by(actor), review: null };
      audit(s, row, actor, type, reason, ctx);
    } else {
      if (row.appeal?.status !== 'pending') fail('仅原待集团复核的一次申诉可以处理');
      if (!['maintain', 'revoke'].includes(p.decision)) fail('请选择明确维持或撤回原警告');
      row.appeal.review = { decision: p.decision, reference: text(p.reference, '实际集团复核来源编号', 200), occurredAt: time(p.occurredAt, '实际复核时间', row.appeal.createdAt, s.now), recordedAt: s.now, reason, internalNote: optional(p.internalNote, '内部复核备注'), by: by(actor) };
      row.appeal.status = p.decision === 'maintain' ? 'maintained' : 'revoked';
      audit(s, row, actor, type, reason, ctx, { decision: p.decision });
    }
  }
  const result = { id: row.id, version: row.version };
  upgradeTechnicianPenalties(s);
  s.technicianPenaltyRequests.push({ actorKey, requestId, signature, type, at: s.now, result: clone(result) });
  return clone(result);
}

function project(s, actor, row, source) {
  const internal = local(actor, row.storeId) || support(actor), d = row.decision;
  const decision = { level: d.level, action: d.action, reference: d.reference, occurredAt: d.occurredAt, reason: d.reason, by: clone(d.by), ...(internal ? { internalNote: d.internalNote } : {}) };
  const appeal = row.appeal ? clone(row.appeal) : null;
  if (appeal?.review && !internal) delete appeal.review.internalNote;
  return {
    id: row.id, techId: row.techId, storeId: row.storeId, bookingId: row.bookingId, source: clone(row.source), version: row.version, createdAt: row.createdAt, updatedAt: row.updatedAt,
    status: status(row), statusLabel: statusLabels[status(row)], decision, appeal, sourceValid: true, sourceToken: rowToken(row, source),
    canAppeal: person(actor, row.techId) && !row.appeal && canAct(actor, 'penalty.appeal'),
    canReview: support(actor) && row.appeal?.status === 'pending' && canAct(actor, 'penalty.appeal-review'),
    history: row.history.map(h => ({ type: h.type, at: h.at, by: clone(h.by), version: h.version, reason: h.reason, ...(h.decision ? { decision: h.decision } : {}) }))
  };
}
export function technicianPenaltyView(s, rawActor) {
  let actor;
  try { actor = resolveAccountActor(s, rawActor); } catch (error) { return { canEnter: false, reason: error.message, penalties: [], sourceCases: [] }; }
  if (!canAccountView(actor, 'care') || !(support(actor) || ['store', 'manager', 'tech'].includes(actor?.role))) return { canEnter: false, reason: '当前身份无权查看技师处罚档案', penalties: [], sourceCases: [] };
  const penalties = [];
  for (const row of s.technicianPenalties || []) {
    if (!(support(actor) || local(actor, row.storeId) || person(actor, row.techId))) continue;
    const originals = (s.serviceCareCases || []).filter(c => c.id === row.source?.caseId);
    if (originals.length !== 1 || originals[0].techId !== row.techId || originals[0].storeId !== row.storeId || originals[0].bookingId !== row.bookingId || !canAccountReadSource(s, actor, 'care-case', originals[0])) continue;
    try {
      unique(s.technicianPenalties, row.id, '原处罚');
      const source = recordSource(s, row);
      if (!readable(s, actor, source)) continue;
      penalties.push(project(s, actor, row, source));
    } catch (error) {
      penalties.push({ id: row.id, version: row.version, status: 'source_unverified', statusLabel: '原决定来源待核对', sourceValid: false, reason: error.message, canAppeal: false, canReview: false });
    }
  }
  const sourceCases = [];
  for (const c of s.serviceCareCases || []) {
    if (!local(actor, c.storeId) || !canAct(actor, 'penalty.warning-record')) continue;
    for (const [index, action] of (c.specialistActions || []).entries()) {
      if (action.kind !== 'penalty' || action.penaltyId != null) continue;
      try {
        const source = caseSource(s, c.id, index);
        if (c.status !== 'execution_pending' || !readable(s, actor, source)) continue;
        sourceCases.push({ caseId: c.id, caseVersion: c.version, actionIndex: index, techId: c.techId, storeId: c.storeId, bookingId: c.bookingId, acceptedAt: source.acceptedAt, sourceToken: fingerprint({ source: source.facts, caseVersion: c.version, by: by(actor) }) });
      } catch { /* Unverified complaints remain in their original care queue. */ }
    }
  }
  return { canEnter: true, penalties, sourceCases, summary: { count: penalties.length, pendingAppeals: penalties.filter(r => r.status === 'appeal_pending').length, revoked: penalties.filter(r => r.status === 'revoked').length } };
}

export function technicianPenaltyTaskRows(s) {
  return (s.technicianPenalties || []).filter(row => row.appeal).map(row => {
    const resolution = technicianPenaltyCaseResolution(s, row.source?.caseId, row.source?.actionIndex), pending = row.appeal.status === 'pending';
    return {
    id: 'technician-penalty:' + row.id + ':appeal', category: 'technician-penalty-appeal', sourceId: row.id, storeId: row.storeId, bookingId: row.bookingId,
    title: '技师一般警告申诉复核', status: !resolution.complete ? 'waiting' : pending ? 'open' : 'done', statusLabel: !resolution.complete ? '原申诉来源待核对' : pending ? '待集团实际复核' : statusLabels[status(row)], createdAt: row.appeal.createdAt, dueAt: null,
    requiredRoute: 'penalties', assignmentMode: 'task', sourceToken: fingerprint({ row, resolution }),
    manageRoles: ['group'], allowedJobs: { group: ['support'], store: [] }, routes: { group: '/group/penalties/' + encodeURIComponent(row.id) }, commands: resolution.complete && pending ? ['penalty.appeal-review'] : []
    };
  });
}
