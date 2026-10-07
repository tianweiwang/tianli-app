import { qualificationCaseBlockers } from './tech-qualification.mjs';
import { technicianPenaltyCaseBlockers } from './technician-penalties.mjs';
// Local quality cases and manual callbacks. Refund, safety and dispute records remain authoritative.
import { actorAccountFields, resolveAccountActor, canAccountView } from './staff-accounts.mjs';
const HOUR = 3600000, DAY = 24 * HOUR;
const TERMINAL = new Set(['closed', 'withdrawn']);
const REFUNDS = new Set(['requested', 'offered', 'approved', 'processing', 'failed', 'escalated']);
const CATEGORIES = [{ value: 'quality', label: '服务质量' }, { value: 'agreement', label: '没按约定服务' }, { value: 'duration', label: '时长不足' }, { value: 'attitude', label: '技师态度' }, { value: 'other', label: '其他' }];
const CASE_LABELS = { store_pending: '待门店处理', user_pending: '待用户确认', group_pending: '集团介入中', execution_pending: '处理事项待办结', closed: '已完成', withdrawn: '已撤销' };
const FOLLOW_LABELS = { open: '待回访', working: '回访处理中', awaiting_actions: '问题事项待办结', closed: '已结案' };
const clone = value => structuredClone(value);
const canonical = v => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
const signature = v => JSON.stringify(canonical(v));
const support = a => a?.role === 'group' && (!a.job || ['all', 'support'].includes(a.job));
const local = (a, storeId) => ['store', 'manager'].includes(a?.role) && a.storeId === storeId;
const staff = (a, row) => support(a) || local(a, row.storeId);
const actorRecord = a => ({ role: a.role, job: a.role === 'group' ? a.job || null : null, id: a.role === 'user' ? a.userId : a.role === 'tech' ? a.techId : ['store', 'manager'].includes(a.role) ? a.storeId : a.role === 'system' ? 'system' : 'group', ...actorAccountFields(a) });
const ownUser = (a, row) => a?.role === 'user' && a.userId === row.userId;
const ownTech = (a, row) => a?.role === 'tech' && a.techId === row.techId;
const readable = (a, row) => staff(a, row) || ownUser(a, row) || ownTech(a, row);
const handling = (a, row) => support(a) || (row.ownerScope === 'store' && local(a, row.storeId));
function fail(ctx, message) { if (ctx?.fail) ctx.fail(message); throw new Error(message); }
function text(value, label, ctx, max = 1000) { const out = String(value ?? '').trim(); if (!out || out.length > max) fail(ctx, `请填写${label}（最多${max}字）`); return out; }
function optional(value, label, ctx, max = 1000) { return value == null || String(value).trim() === '' ? '' : text(value, label, ctx, max); }
function version(row, p, ctx) { if (p.version == null || typeof p.version === 'boolean' || String(p.version).trim() === '' || !Number.isSafeInteger(Number(p.version)) || Number(p.version) !== row.version) fail(ctx, '记录已更新或缺少版本，请刷新核对后重试'); }
function date(value, ctx) {
  if (typeof value === 'number') { if (!Number.isSafeInteger(value) || !Number.isFinite(new Date(value).getTime())) fail(ctx, '日期时间无效'); return value; }
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?$/.exec(String(value || ''));
  if (!m || +m[2] < 1 || +m[2] > 12 || +m[3] < 1 || +m[3] > new Date(Date.UTC(+m[1], +m[2], 0)).getUTCDate() || +m[4] > 23 || +m[5] > 59 || +(m[6] || 0) > 59) fail(ctx, '日期时间无效');
  const n = Date.parse(m[7] ? value : `${value}+08:00`); if (!Number.isSafeInteger(n)) fail(ctx, '日期时间无效'); return n;
}
const booking = (s, id) => (s.bookings || []).find(b => b.id === (typeof id === 'string' ? id : id?.id));
function audit(s, row, action, actor, ctx, details = {}, publicText = '') {
  row.updatedAt = s.now;
  (row.history ??= []).push({ at: s.now, action, by: actorRecord(actor), version: row.version, ...clone(details) });
  if (publicText) (row.publicHistory ??= []).push({ at: s.now, text: publicText });
  ctx?.log?.(row, `质量跟进${action} · ${row.id}`);
}
function changed(s, row, action, actor, ctx, details = {}, publicText = '') { row.version++; audit(s, row, action, actor, ctx, details, publicText); }
function id(s, ctx, prefix) { return ctx?.id ? ctx.id(prefix) : prefix + (++s.seq); }
export function upgradeCare(s) { s.serviceCareCases ??= []; s.serviceCareFollowups ??= []; s.serviceCareRequests ??= []; return s; }
function timing(s, b) {
  const completed = Boolean(b && b.status === 'done' && Number.isFinite(b.completedAt) && b.completedAt <= s.now);
  return { completed, withinUserWindow: Boolean(completed && s.now <= b.completedAt + 2 * DAY), withinSpecialWindow: Boolean(completed && s.now <= b.completedAt + 30 * DAY) };
}
function createAllowed(s, a, b) {
  if (!b || !(staff(a, b) || ownUser(a, b))) return { allowed: false, reason: '仅本人或原服务门店、集团客服可受理' };
  const t = timing(s, b);
  if (!t.completed) return { allowed: false, reason: '仅已完成预约可提交质量反馈；进行中的安全事项仍走原求助入口' };
  if (support(a)) return { allowed: t.withinSpecialWindow, reason: t.withinSpecialWindow ? '' : '已超过完成后30天的集团特批期限' };
  return { allowed: t.withinUserWindow, reason: t.withinUserWindow ? '' : '自助反馈限完成后48小时内，之后请联系集团客服核实特批' };
}
function bookingBlockers(s, b) {
  if (!b) return ['关联预约不存在，待核对'];
  const out = [];
  for (const r of b.refunds || []) if (REFUNDS.has(r.status) || (r.status === 'rejected' && r.deadline) || (!['withdrawn', 'closed', 'rejected'].includes(r.status) && (r.executions || []).some(e => e.amountCents > 0 && ['approved', 'processing', 'failed'].includes(e.status)))) out.push(`退款 ${r.id} 尚未办结`);
  for (const h of s.safety || []) if (h.bookingId === b.id) {
    if (h.status !== 'closed') out.push(`安全事件 ${h.id} 尚未结案`);
    else if (h.unresolvedDispute && !(b.disputes || []).some(d => d.safetyId === h.id || d.id === h.disputeId)) out.push(`安全事件 ${h.id} 的后续争议记录待核对`);
  }
  for (const d of b.disputes || []) if (!['closed', 'resolved'].includes(d.status)) out.push(`服务争议 ${d.id} 尚未结案`);
  return out;
}
function reference(s, b, kind, targetId) {
  if (kind === 'booking') return targetId === b.id ? b : null;
  if (kind === 'refund') return (b.refunds || []).find(x => x.id === targetId);
  if (kind === 'safety') return (s.safety || []).find(x => x.id === targetId && x.bookingId === b.id);
  if (kind === 'dispute') return (b.disputes || []).find(x => x.id === targetId);
  if (kind === 'review') return (s.serviceReviews || []).find(x => x.id === targetId && x.bookingId === b.id);
  if (kind === 'followup') return (s.serviceCareFollowups || []).find(x => x.id === targetId && x.bookingId === b.id);
  if (kind === 'case') return (s.serviceCareCases || []).find(x => x.id === targetId && x.bookingId === b.id);
  return null;
}
// Actual photo bytes stay in the existing attachment store. These are source metadata only.
export function careEvidenceRefs(value, ctx) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 6) fail(ctx, '原投诉图片须为数组，案件合计最多6张');
  const seen = new Set();
  return value.map(file => {
    if (!file || Array.isArray(file) || !/^invoice-file:[a-f0-9]{64}$/.test(file.ref || '') || !['image/png','image/jpeg'].includes(file.type)) fail(ctx, '投诉图片须引用实际PNG或JPEG附件');
    if (typeof file.name !== 'string' || !file.name.trim() || file.name !== file.name.trim() || file.name.length > 150 || /[\\/:*?"<>|\x00-\x1f]/.test(file.name)) fail(ctx, '投诉图片文件名无效');
    if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > 5 * 1024 * 1024) fail(ctx, '投诉图片须为非空文件，Demo附件技术上限为5MiB');
    if (seen.has(file.ref)) fail(ctx, '同一投诉图片不能重复提交');
    seen.add(file.ref); return {ref:file.ref,name:file.name,type:file.type,size:file.size};
  });
}
function uniqueCare(rows, id, label) {
  const found = (rows || []).filter(x => x.id === id);
  if (typeof id !== 'string' || !id || id.trim() !== id || found.length !== 1) fail(null, `${label}缺失或编号不唯一`);
  return found[0];
}
function evidenceRoot(s, bookingId) {
  const b = uniqueCare(s.bookings, bookingId, '原预约');
  uniqueCare(s.users, b.userId, '原预约本人'); uniqueCare(s.stores, b.storeId, '原服务门店'); uniqueCare(s.techs, b.techId, '原服务技师');
  return b;
}
function evidenceSource(s, row) {
  const b = evidenceRoot(s, row.bookingId);
  if (row.userId !== b.userId || row.storeId !== b.storeId || row.techId !== b.techId) fail(null, '原案件与预约本人、门店或技师来源不一致');
  const source = row.source && reference(s,b,row.source.kind,row.source.id);
  if (!source) fail(null, '原案件关联来源已缺失或串号');
  const list = row.source.kind === 'booking' ? s.bookings : row.source.kind === 'refund' ? b.refunds : row.source.kind === 'dispute' ? b.disputes : row.source.kind === 'safety' ? s.safety : row.source.kind === 'review' ? s.serviceReviews : row.source.kind === 'followup' ? s.serviceCareFollowups : null;
  uniqueCare(list,row.source.id,'原案件关联来源');
  return b;
}
function storedPhotos(row) { return [...careEvidenceRefs(row.evidenceRefs), ...(row.statements || []).flatMap(x => careEvidenceRefs(x.evidenceRefs))]; }
// Selecting bytes can precede completing the text form. This checks only the
// original source/capability; it never creates a case or changes a request.
export function careUploadScope(s, rawActor, type, p = {}, {assertUserScope} = {}) {
  const actor = resolveAccountActor(s,rawActor); validateActor(s,actor);
  if (!canAccountView(actor,'care')) fail(null,'当前岗位无权选择投诉图片');
  let row = null, b, source;
  if (type === 'care.case-create') {
    b = evidenceRoot(s,p.bookingId);
    const allowed = createAllowed(s,actor,b); if (!allowed.allowed) fail(null,allowed.reason);
    source = sourceFor(s,b,p);
    if (ownUser(actor,b) && source.kind !== 'booking') fail(null,'用户反馈须从本人原预约提交');
    if (source.kind === 'followup') { const target=reference(s,b,source.kind,source.id); if(target.status==='closed'||!handling(actor,target)) fail(null,'原回访不能由当前身份转案'); }
    if (source.kind !== 'booking' && (s.serviceCareCases || []).some(c=>c.source?.kind===source.kind&&c.source.id===source.id&&!TERMINAL.has(c.status))) fail(null,'原来源已有未结案件');
    evidenceSource(s,{bookingId:b.id,userId:b.userId,storeId:b.storeId,techId:b.techId,source});
  } else if (type === 'care.case-statement') {
    row = uniqueCare(s.serviceCareCases,p.id,'原案件'); b=evidenceSource(s,row); version(row,p);
    if (!(ownUser(actor,row)||ownTech(actor,row)) || TERMINAL.has(row.status) || row.withdrawnAt) fail(null,'当前身份或案件状态不能补充图片');
    source = row.source;
  } else fail(null,'图片只能从原投诉或补充说明选择');
  if (actor.role==='user') {
    if(typeof assertUserScope!=='function') fail(null,'本人原投诉图片范围核验尚未接入');
    const result=assertUserScope(s,actor,type==='care.case-create'?'booking':'care-case',row?.id||b.id);
    if(result===false||result?.then) fail(null,'本人原投诉图片范围核验未通过');
  }
  const photos=row?storedPhotos(row):[];
  if(photos.length>6||new Set(photos.map(f=>f.ref)).size!==photos.length)fail(null,'原案件图片总量或来源冲突');
  return {sourceToken:signature({actor:actorRecord(actor),booking:b,case:row,source,now:s.now}),available:6-photos.length,existingRefs:photos.map(f=>f.ref)};
}
function validateNewPhotos(s, row, b, incoming, ctx) {
  if (!incoming.length) return;
  if (row) evidenceSource(s,row); else evidenceRoot(s,b.id);
  const previous = row ? storedPhotos(row) : [];
  if (previous.length + incoming.length > 6) fail(ctx, '原投诉及全部补充图片合计最多6张');
  if (incoming.some(file => previous.some(old => old.ref === file.ref))) fail(ctx, '已保存投诉图片不能重复或替换，请保留原事实');
  if (typeof ctx?.validateEvidenceRefs !== 'function' || ctx.validateEvidenceRefs(clone(incoming)) !== true) fail(ctx, '投诉图片尚未经当前事务真实文件核验');
}
// Root supplies the canonical closed-rights check without a care -> privacy import cycle.
export function careEvidenceFile(s, rawActor, id, slot, {assertUserScope} = {}) {
  const actor = resolveAccountActor(s,rawActor); validateActor(s,actor);
  if (!canAccountView(actor,'care')) fail(null, '当前岗位无权查看投诉图片');
  const row = uniqueCare(s.serviceCareCases,id,'原案件'), b = evidenceSource(s,row);
  if (!readable(actor,row)) fail(null, '当前身份无权查看原案件图片');
  const photos = storedPhotos(row);
  if (photos.length > 6 || new Set(photos.map(file=>file.ref)).size !== photos.length) fail(null, '原案件图片总量或引用冲突，须核对原事实');
  if (actor.role === 'user') {
    if (typeof assertUserScope !== 'function') fail(null, '本人原案件附件范围核验尚未接入');
    const result = assertUserScope(s,actor,'care-case',row.id);
    if (result === false) fail(null, '本人原案件附件范围核验拒绝');
    if (result?.then) fail(null, '本人原案件附件范围核验必须同步完成');
  }
  let files, statement = null, index;
  let match = /^evidence:(0|[1-9]\d*)$/.exec(String(slot));
  if (match) { files = careEvidenceRefs(row.evidenceRefs); index = Number(match[1]); }
  else {
    match = /^statement:([^:]+):(0|[1-9]\d*)$/.exec(String(slot));
    if (!match) fail(null, '原投诉图片槽无效');
    statement = uniqueCare(row.statements,match[1],'原补充说明'); files = careEvidenceRefs(statement.evidenceRefs); index = Number(match[2]);
  }
  const file = files?.[index];
  if (!Number.isSafeInteger(index) || !file) fail(null, '原投诉图片槽已变化或不存在');
  const author = statement?.by || row.createdBy;
  const sourceToken = signature({actor:{role:actor.role,userId:actor.userId,techId:actor.techId,storeId:actor.storeId,job:actor.job,accountId:actor.accountId,grantId:actor.grantId},sessionId:actor.sessionId || null,case:{id:row.id,bookingId:row.bookingId,userId:row.userId,storeId:row.storeId,techId:row.techId,source:row.source,version:row.version,status:row.status},booking:{id:b.id,userId:b.userId,storeId:b.storeId,techId:b.techId,status:b.status,completedAt:b.completedAt},slot,author:author?{role:author.role,id:author.id,accountId:author.accountId,grantId:author.grantId}:null,at:statement?.at ?? row.createdAt,file});
  return {...clone(file),sourceToken};
}
function specialistBlockers(s, row) {
  return [...qualificationCaseBlockers(s,row), ...technicianPenaltyCaseBlockers(s,row), ...(row.specialistActions || []).filter(a=>!['restriction','retraining','penalty'].includes(a.kind) && a.status !== 'completed').map(()=> '专项事项待实际办理，不能用结案备注代替')];
}
export function careClosureBlockers(s, caseOrId) {
  const row = typeof caseOrId === 'string' ? (s.serviceCareCases || []).find(x => x.id === caseOrId) : caseOrId;
  if (!row) return ['反馈案件不存在'];
  const b = booking(s, row.bookingId), out = bookingBlockers(s, b);
  if (row.source && (!b || !reference(s, b, row.source.kind, row.source.id))) out.push('反馈来源记录不存在或不属于本预约，待核对');
  for (const link of row.links || []) if (!b || !reference(s, b, link.kind, link.id)) out.push(`关联 ${link.kind} ${link.id} 不存在或不属于本预约`);
  out.push(...specialistBlockers(s,row));
  return [...new Set(out)];
}
export function careBlocksBooking(s, bookingOrId) {
  const bookingId = typeof bookingOrId === 'string' ? bookingOrId : bookingOrId?.id;
  return (s.serviceCareCases || []).some(c => c.bookingId === bookingId && (!TERMINAL.has(c.status) || specialistBlockers(s,c).length > 0));
}
export function careBookingSummary(s, bookingOrId) {
  const b = booking(s, bookingOrId), cases = (s.serviceCareCases || []).filter(c => c.bookingId === b?.id), followups = (s.serviceCareFollowups || []).filter(c => c.bookingId === b?.id);
  return { ...timing(s, b), blocked: careBlocksBooking(s, b), openCaseCount: cases.filter(c => !TERMINAL.has(c.status)).length, openFollowupCount: followups.filter(c => c.status !== 'closed').length, caseIds: cases.map(c => c.id), followupIds: followups.map(c => c.id) };
}
function caseDue(row) { return row.status === 'store_pending' ? row.storeDueAt : row.status === 'user_pending' ? row.userDueAt : row.status === 'group_pending' ? row.groupDueAt : null; }
function escalate(s, row, at, actor, ctx, reason) {
  row.status = 'group_pending'; row.ownerScope = 'group'; row.groupStartedAt ??= at; row.groupDueAt ??= row.groupStartedAt + 2 * DAY;
  row.assignee = { scope: 'group', name: '', claimedAt: null, by: actorRecord(actor) };
  changed(s, row, '升级集团', actor, ctx, { reason, stageStartedAt: row.groupStartedAt }, '已转集团客服处理');
}
function finishCase(s, row, actor, ctx, mode, publicText) {
  const blockers = careClosureBlockers(s, row);
  row.status = blockers.length ? 'execution_pending' : mode === 'withdraw' ? 'withdrawn' : 'closed';
  row.conclusionAcceptedAt = s.now; row.closingMode = mode;
  if (mode === 'withdraw') row.withdrawnAt = s.now;
  if (TERMINAL.has(row.status)) row.closedAt = s.now;
  changed(s, row, mode === 'withdraw' ? '用户撤销反馈' : '处理结果确认', actor, ctx, { blockers }, blockers.length ? `${publicText}，原有处理事项继续跟踪` : publicText);
}
function followupBlockers(s, row) {
  const b = booking(s, row.bookingId), out = bookingBlockers(s, b);
  if (row.source && (!b || !reference(s, b, row.source.kind, row.source.id))) out.push('回访来源记录不存在或不属于本预约，待核对');
  for (const c of s.serviceCareCases || []) if (c.bookingId === row.bookingId && (!TERMINAL.has(c.status) || specialistBlockers(s,c).length > 0)) out.push(`反馈案件 ${c.id} 尚未办结`);
  for (const link of row.links || []) if (!b || !reference(s, b, link.kind, link.id)) out.push(`关联反馈案件 ${link.id} 不存在或不属于本预约`);
  return [...new Set(out)];
}
export function syncCare(s, ctx) {
  upgradeCare(s);
  for (const row of s.serviceCareCases) {
    if (row.status === 'store_pending' && s.now >= row.storeDueAt) escalate(s, row, row.storeDueAt, { role: 'system' }, ctx, '门店24小时处理期限已到');
    if (row.status === 'user_pending' && s.now >= row.userDueAt) {
      row.confirmationMode = 'timeout'; row.confirmedAt = row.userDueAt;
      finishCase(s, row, { role: 'system' }, ctx, 'accepted', '用户确认期已结束');
    }
    if (row.status === 'group_pending' && s.now >= row.groupDueAt && !row.overdueAt) { row.overdueAt = row.groupDueAt; changed(s, row, '集团处理超时', { role: 'system' }, ctx, {}, '集团处理已超时，保留待办继续处理'); }
  }
  for (const row of s.serviceCareFollowups) if (row.status !== 'closed' && s.now >= row.dueAt && !row.overdueAt) { row.overdueAt = row.dueAt; changed(s, row, '回访超时待接管', { role: 'system' }, ctx); }
  return s;
}
function validateActor(s, actor, ctx) {
  if (actor?.role === 'user' && (s.users || []).some(x => x.id === actor.userId)) return;
  if (actor?.role === 'tech' && (s.techs || []).some(x => x.id === actor.techId)) return;
  if (['store', 'manager'].includes(actor?.role) && (s.stores || []).some(x => x.id === actor.storeId)) return;
  if (support(actor)) return;
  fail(ctx, '当前身份无权执行质量跟进操作');
}
function assignee(scope, name, actor, ctx, requiredName = true) {
  if (!['store', 'group'].includes(scope)) fail(ctx, '负责工作端无效');
  return { scope, name: requiredName ? text(name, '负责人姓名', ctx, 60) : '', claimedAt: null, by: actorRecord(actor) };
}
function sourceFor(s, b, p, ctx) {
  const kind = p.sourceKind || 'booking', targetId = p.sourceId || (kind === 'booking' ? b.id : '');
  if (!['booking', 'review', 'followup', 'refund', 'safety', 'dispute'].includes(kind) || !reference(s, b, kind, targetId)) fail(ctx, '来源不存在或不属于本预约');
  return { kind, id: targetId };
}
const COMMANDS = new Set(['care.case-create', 'care.case-respond', 'care.case-answer', 'care.case-statement', 'care.case-note', 'care.case-link', 'care.case-close', 'care.followup-create', 'care.followup-record', 'care.followup-link', 'care.followup-close', 'care.task-assign', 'care.task-claim']);
export function careCommand(s, actor, type, p, ctx) {
  upgradeCare(s); validateActor(s, actor, ctx);
  if (!COMMANDS.has(type)) fail(ctx, '不支持的质量跟进命令');
  const task = type.startsWith('care.task-'), follow = type.startsWith('care.followup-') || (task && p.entity === 'followup');
  if (task && !['case', 'followup'].includes(p.entity)) fail(ctx, '事项类型无效');
  let row = type.endsWith('-create') ? null : (follow ? s.serviceCareFollowups : s.serviceCareCases).find(x => x.id === p.id);
  const b = booking(s, row?.bookingId || p.bookingId);
  if (!b || !(follow ? staff(actor, b) : readable(actor, b))) fail(ctx, '记录不存在或无权访问此预约');
  if (!type.endsWith('-create') && !row) fail(ctx, '质量跟进记录不存在');
  if (type === 'care.case-create') { if (!(ownUser(actor, b) || staff(actor, b))) fail(ctx, '仅本人或原服务门店、集团客服可受理反馈'); }
  else if (type === 'care.case-answer') { if (!ownUser(actor, row)) fail(ctx, '仅预约本人可以确认或撤回反馈'); }
  else if (type === 'care.case-statement') { if (!(ownUser(actor, row) || ownTech(actor, row))) fail(ctx, '仅预约本人或本单技师可以补充说明'); }
  else if (!staff(actor, row || b)) fail(ctx, '仅本店工作端或集团客服可以处理此事项');
  const incomingPhotos = careEvidenceRefs(p.evidenceRefs,ctx);
  if (incomingPhotos.length && !['care.case-create','care.case-statement'].includes(type)) fail(ctx, '图片仅可通过原投诉或本人补充说明提交');
  const requestId = text(p.requestId, '唯一提交标识', ctx, 200), who = signature(actorRecord(actor)), fingerprint = signature({ type, p });
  const old = s.serviceCareRequests.find(r => r.actor === who && r.requestId === requestId);
  if (old) { if (old.fingerprint !== fingerprint) fail(ctx, '同一提交标识不能用于不同质量跟进内容'); return (old.entity === 'followup' ? s.serviceCareFollowups : s.serviceCareCases).find(x => x.id === old.resultId); }
  syncCare(s, ctx);
  if (row) version(row, p, ctx);
  validateNewPhotos(s,row,b,incomingPhotos,ctx);
  if (type === 'care.case-create') {
    const allowed = createAllowed(s, actor, b); if (!allowed.allowed) fail(ctx, allowed.reason);
    if (!CATEGORIES.some(c => c.value === p.category)) fail(ctx, '请选择反馈类型');
    if (p.claim && p.claim !== 'feedback' || (p.requests && p.requests.length) || Number(p.amountCents || 0) !== 0) fail(ctx, '反馈案件不执行退款，请从原预约申请或关联原退款记录');
    const source = sourceFor(s, b, p, ctx);
    if (ownUser(actor, b) && source.kind !== 'booking') fail(ctx, '用户反馈须从本人原预约提交，内部事项来源由工作端关联');
    if (source.kind === 'followup') {
      const target = reference(s, b, source.kind, source.id);
      if (target.status === 'closed' || !handling(actor, target)) fail(ctx, '仅当前负责工作端可以由未结回访转案，请联系当前负责人');
    }
    if (source.kind !== 'booking' && s.serviceCareCases.some(c => c.source.kind === source.kind && c.source.id === source.id && !TERMINAL.has(c.status))) fail(ctx, '该来源已有未结反馈案件，请在原案件补充');
    const special = !timing(s, b).withinUserWindow;
    const scope = special ? 'group' : 'store';
    row = { id: id(s, ctx, 'SC'), bookingId: b.id, userId: b.userId, storeId: b.storeId, techId: b.techId, source, claim: 'feedback', category: p.category, description: text(p.description, '情况说明与原诉求', ctx), evidence: optional(p.evidence, '证据编号或说明', ctx), status: special ? 'group_pending' : 'store_pending', version: 1, createdAt: s.now, updatedAt: s.now, createdBy: actorRecord(actor), special, intakeReason: special || !ownUser(actor, b) ? text(p.reason, '受理依据', ctx) : '', storeDueAt: s.now + DAY, userDueAt: null, groupStartedAt: special ? s.now : null, groupDueAt: special ? s.now + 2 * DAY : null, ownerScope: scope, assignee: assignee(scope, '', actor, ctx, false), statements: [], notes: [], resolutions: [], links: [], specialistActions: [], history: [], publicHistory: [] };
    if (incomingPhotos.length) { evidenceSource(s,row); row.evidenceRefs = clone(incomingPhotos); }
    s.serviceCareCases.push(row); audit(s, row, '受理反馈', actor, ctx, {}, special ? '集团客服已特批受理反馈' : '反馈已提交，等待门店处理');
    if (['refund', 'safety', 'dispute', 'review'].includes(source.kind)) row.links.push({ kind: source.kind, id: source.id, at: s.now, reason: '反馈来源' });
    if (source.kind === 'followup') {
      const target = reference(s, b, source.kind, source.id);
      if (target.status === 'closed') fail(ctx, '已结案回访不能追加问题，请新建回访');
      target.links.push({ kind: 'case', id: row.id, at: s.now, reason: '回访发现问题转反馈案件' }); target.status = 'awaiting_actions';
      changed(s, target, '回访问题转案', actor, ctx, { caseId: row.id });
    }
  } else if (type === 'care.followup-create') {
    if (!timing(s, b).completed) fail(ctx, '人工回访须关联已完成预约');
    const dueAt = date(p.dueAt, ctx); if (dueAt <= s.now) fail(ctx, '请明确安排未来的回访期限');
    const owner = assignee(p.scope, p.name, actor, ctx);
    const linked = p.caseId ? reference(s, b, 'case', p.caseId) : null; if (p.caseId && !linked) fail(ctx, '反馈案件不存在或不属于本预约');
    row = { id: id(s, ctx, 'CF'), bookingId: b.id, userId: b.userId, storeId: b.storeId, techId: b.techId, caseId: linked?.id || null, source: { kind: linked ? 'case' : 'booking', id: linked?.id || b.id }, reason: text(p.reason, '安排依据', ctx), ownerScope: p.scope, assignee: owner, dueAt, nextContactAt: null, status: 'open', version: 1, createdAt: s.now, updatedAt: s.now, createdBy: actorRecord(actor), attempts: [], links: linked ? [{ kind: 'case', id: linked.id, at: s.now, reason: '回访安排来源' }] : [], history: [], conclusion: '' };
    s.serviceCareFollowups.push(row); audit(s, row, '安排人工回访', actor, ctx);
  } else if (task) {
    if (TERMINAL.has(row.status)) fail(ctx, '已结案事项不能重新分派或认领');
    if (type === 'care.task-claim') {
      if (!(row.ownerScope === 'group' ? support(actor) : local(actor, row.storeId))) fail(ctx, '请由当前负责工作端认领，集团接管请使用转派');
      const name = text(p.name, '认领人姓名', ctx, 60);
      if (row.assignee.claimedAt != null) fail(ctx, '事项已被认领，变更负责人请转派并记录原因');
      row.assignee = { ...row.assignee, name, claimedAt: s.now, by: actorRecord(actor) };
      changed(s, row, '认领事项', actor, ctx, { name });
    } else {
      if (!handling(actor, row)) fail(ctx, '集团已接管，原门店不能再转派此事项');
      const owner = assignee(p.scope, p.name, actor, ctx), reason = text(p.reason, '转派原因', ctx), before = clone(row.assignee);
      if (!follow && row.ownerScope === 'group' && p.scope !== 'group') fail(ctx, '集团介入的投诉裁决不能退回门店');
      if (!follow && row.status === 'user_pending' && p.scope !== row.ownerScope) fail(ctx, '正在等待用户确认，不能通过转派改变处理阶段');
      if (!follow && p.scope === 'group' && row.status === 'store_pending') escalate(s, row, s.now, actor, ctx, reason);
      row.ownerScope = p.scope; row.assignee = owner; changed(s, row, '转派事项', actor, ctx, { before, after: owner, reason });
    }
  } else if (type === 'care.case-statement') {
    if (TERMINAL.has(row.status) || row.withdrawnAt) fail(ctx, '此反馈已结束，不能继续补充说明');
    const statement = { id: id(s, ctx, 'CS'), at: s.now, text: text(p.text, '补充说明', ctx), by: actorRecord(actor) };
    if (incomingPhotos.length) Object.assign(statement,{requestId,evidenceRefs:clone(incomingPhotos)});
    row.statements.push(statement); changed(s, row, '补充说明', actor, ctx, { statementId: statement.id }, actor.role === 'tech' ? '本单技师已补充说明' : '用户已补充说明');
  } else if (type === 'care.case-note') {
    if (TERMINAL.has(row.status)) fail(ctx, '已结束的反馈不能添加处理备注');
    row.notes.push({ at: s.now, text: text(p.text, '内部备注', ctx), by: actorRecord(actor) }); changed(s, row, '记录内部备注', actor, ctx);
  } else if (type === 'care.case-link') {
    if (TERMINAL.has(row.status)) fail(ctx, '已结束的反馈不能变更关联事项');
    if (!['refund', 'safety', 'dispute', 'review'].includes(p.kind) || !reference(s, b, p.kind, p.targetId)) fail(ctx, '关联记录不存在或不属于本预约');
    if (row.links.some(l => l.kind === p.kind && l.id === p.targetId)) fail(ctx, '此事项已关联');
    row.links.push({ kind: p.kind, id: p.targetId, at: s.now, reason: text(p.reason, '关联依据', ctx) }); changed(s, row, '关联原处理事项', actor, ctx);
  } else if (type === 'care.case-respond') {
    if (!['store_pending', 'group_pending'].includes(row.status) || !handling(actor, row)) fail(ctx, '当前阶段无权提出处理结果');
    if (!['respond', 'reject'].includes(p.decision)) fail(ctx, '请选择明确处理结果');
    const publicReply = text(p.publicReply, '公开处理结果', ctx), internalNote = optional(p.internalNote, '内部核实依据', ctx), specialistAction = p.specialistAction || 'none';
    if (!['none', 'penalty', 'restriction', 'retraining'].includes(specialistAction)) fail(ctx, '专项处理类型无效');
    if (specialistAction !== 'none') row.specialistActions.push({ kind: specialistAction, status: 'pending', reason: internalNote || publicReply, at: s.now, by: actorRecord(actor) });
    const final = row.status === 'group_pending';
    row.resolutions.push({ at: s.now, decision: p.decision, publicReply, internalNote, by: actorRecord(actor), final });
    if (final) { row.final = true; finishCase(s, row, actor, ctx, 'group-final', '集团已给出最终处理结果'); }
    else { row.status = 'user_pending'; row.userDueAt = s.now + 2 * DAY; changed(s, row, '门店提出处理结果', actor, ctx, {}, '门店已回复，请在48小时内接受或申请集团介入'); }
  } else if (type === 'care.case-answer') {
    if (p.decision === 'withdraw') {
      if (TERMINAL.has(row.status) || row.withdrawnAt) fail(ctx, '反馈已结束，不能重复撤销');
      row.withdrawReason = text(p.reason, '撤销原因', ctx); finishCase(s, row, actor, ctx, 'withdraw', '用户已撤销本次反馈');
    } else {
      if (row.status !== 'user_pending' || row.final) fail(ctx, '当前没有待用户确认的门店结果');
      if (p.decision === 'escalate') escalate(s, row, s.now, actor, ctx, text(p.reason, '申请集团介入原因', ctx));
      else if (p.decision === 'accept') {
        row.confirmationNote = optional(p.reason, '确认说明', ctx, 500);
        row.confirmationMode = 'user'; row.confirmedAt = s.now;
        finishCase(s, row, actor, ctx, 'accepted', `用户已接受处理结果${row.confirmationNote ? '：' + row.confirmationNote : ''}`);
      }
      else fail(ctx, '反馈处理选择无效');
    }
  } else if (type === 'care.case-close') {
    if (row.status !== 'execution_pending' || !handling(actor, row)) fail(ctx, '仅当前处理工作端可以关闭待办结案件');
    const blockers = careClosureBlockers(s, row); if (blockers.length) fail(ctx, blockers.join('；'));
    row.conclusion = text(p.conclusion, '结案结论', ctx); row.status = row.withdrawnAt ? 'withdrawn' : 'closed'; row.closedAt = s.now;
    changed(s, row, '核验执行后结案', actor, ctx, {}, row.withdrawnAt ? '撤销反馈的原有关联事项已处理' : '相关事项已核验办结');
  } else if (type === 'care.followup-record') {
    if (row.status === 'closed' || !handling(actor, row)) fail(ctx, '仅当前负责工作端可以登记未结回访');
    if (!['reached', 'no_answer', 'refused', 'invalid_contact'].includes(p.outcome)) fail(ctx, '请选择联系结果');
    const retry = ['no_answer', 'invalid_contact'].includes(p.outcome);
    const nextContactAt = p.nextContactAt ? date(p.nextContactAt, ctx) : null;
    if (retry && (!nextContactAt || nextContactAt <= s.now) || nextContactAt != null && nextContactAt <= s.now) fail(ctx, '未接通或联系方式待核须明确未来的下次联系时间');
    row.attempts.push({ id: id(s, ctx, 'CA'), at: s.now, outcome: p.outcome, note: text(p.note, '联系结果与后续安排', ctx), nextContactAt, by: actorRecord(actor) });
    row.nextContactAt = nextContactAt; row.status = followupBlockers(s, row).length ? 'awaiting_actions' : 'working';
    changed(s, row, '登记回访联系', actor, ctx, { outcome: p.outcome });
  } else if (type === 'care.followup-link') {
    if (row.status === 'closed' || !handling(actor, row)) fail(ctx, '仅当前负责工作端可以关联回访问题');
    if (!reference(s, b, 'case', p.caseId)) fail(ctx, '反馈案件不存在或不属于本预约');
    if (row.links.some(l => l.kind === 'case' && l.id === p.caseId)) fail(ctx, '反馈案件已经关联');
    row.links.push({ kind: 'case', id: p.caseId, at: s.now, reason: text(p.reason, '关联依据', ctx) }); row.status = 'awaiting_actions'; changed(s, row, '关联回访问题', actor, ctx);
  } else if (type === 'care.followup-close') {
    if (row.status === 'closed' || !handling(actor, row)) fail(ctx, '仅当前负责工作端可以结案未结回访');
    const last = row.attempts.at(-1); if (!last || !['reached', 'refused'].includes(last.outcome)) fail(ctx, '须记录接通或拒访事实；未接通不能当作问题已解决');
    const blockers = followupBlockers(s, row); if (blockers.length) fail(ctx, blockers.join('；'));
    row.conclusion = text(p.conclusion, '回访结案结论', ctx); row.status = 'closed'; row.closedAt = s.now;
    changed(s, row, '回访结案', actor, ctx);
  }
  s.serviceCareRequests.push({ requestId, actor: who, fingerprint, entity: follow ? 'followup' : 'case', resultId: row.id, at: s.now });
  return row;
}
function projectCase(s, actor, row) {
  const internal = staff(actor, row), open = !TERMINAL.has(row.status), dueAt = caseDue(row), closureBlockers = careClosureBlockers(s, row), handle = internal && handling(actor, row);
  const caps = { canClaim: internal && open && row.assignee?.claimedAt == null && (row.ownerScope === 'group' ? support(actor) : local(actor, row.storeId)), canAssign: handle && open, canRespond: handle && ['store_pending', 'group_pending'].includes(row.status), canAnswer: ownUser(actor, row) && row.status === 'user_pending' && !row.final, canWithdraw: ownUser(actor, row) && open && !row.withdrawnAt, canStatement: (ownUser(actor, row) || ownTech(actor, row)) && open && !row.withdrawnAt, canNote: internal && open, canLink: internal && open, canClose: handle && row.status === 'execution_pending' && !closureBlockers.length };
  const common = { id: row.id, bookingId: row.bookingId, userId: row.userId, storeId: row.storeId, techId: row.techId, claim: row.claim, category: row.category, description: row.description, evidence: row.evidence, source: clone(row.source), status: row.status, statusLabel: CASE_LABELS[row.status] || row.status, version: row.version, createdAt: row.createdAt, updatedAt: row.updatedAt, storeDueAt: row.storeDueAt, userDueAt: row.userDueAt, groupDueAt: row.groupDueAt, dueAt, overdue: Boolean(dueAt && s.now >= dueAt), ownerScope: row.ownerScope, assignee: clone(row.assignee), statements: clone(row.statements), publicHistory: clone(row.publicHistory), publicReply: row.resolutions.at(-1)?.publicReply || '', resolutions: row.resolutions.map(r => ({ at: r.at, decision: r.decision, publicReply: r.publicReply, final: r.final, by: { role: r.by.role } })), links: (row.links || []).map(l => ({ kind: l.kind, id: l.id, at: l.at })), withdrawnAt: row.withdrawnAt || null, closedAt: row.closedAt || null, conclusion: row.conclusion || '', closureBlockers: internal ? closureBlockers : closureBlockers.length ? ['原有关联处理事项尚未全部办结'] : [], ...caps };
  Object.assign(common, { confirmationNote: row.confirmationNote || '', confirmationMode: row.confirmationMode || null, confirmedAt: row.confirmedAt ?? null });
  common.evidenceRefs = careEvidenceRefs(row.evidenceRefs);
  return internal ? { ...clone(row), ...common, notes: clone(row.notes), resolutions: clone(row.resolutions), links: clone(row.links), closureBlockers } : common;
}
function projectFollowup(s, actor, row) {
  const handle = handling(actor, row), open = row.status !== 'closed', closureBlockers = followupBlockers(s, row), last = row.attempts.at(-1);
  return { ...clone(row), statusLabel: FOLLOW_LABELS[row.status] || row.status, overdue: open && s.now >= row.dueAt, closureBlockers, canClaim: open && row.assignee?.claimedAt == null && (row.ownerScope === 'group' ? support(actor) : local(actor, row.storeId)), canAssign: open && handle, canRecord: open && handle, canLink: open && handle, canClose: open && handle && ['reached', 'refused'].includes(last?.outcome) && !closureBlockers.length };
}
export function careView(s, actor) {
  const allCases = (s.serviceCareCases || []).filter(c => readable(actor, c)), followups = (s.serviceCareFollowups || []).filter(c => staff(actor, c));
  const cases = allCases.map(c => projectCase(s, actor, c));
  const bookingOptions = (s.bookings || []).filter(b => staff(actor, b) || ownUser(actor, b)).map(b => { const t = timing(s, b), allowed = createAllowed(s, actor, b); return { id: b.id, bookingId: b.id, label: `${b.id} · ${b.serviceSnapshot?.name || b.serviceId}`, storeId: b.storeId, userId: b.userId, techId: b.techId, completedAt: b.completedAt, ...t, canCreateCase: allowed.allowed, reason: allowed.reason, caseCreateReason: allowed.reason, withinWindow: allowed.allowed }; });
  const sourceOptions = [];
  for (const option of bookingOptions) {
    const b = booking(s, option.id); sourceOptions.push({ kind: 'booking', id: b.id, bookingId: b.id, label: `预约 ${b.id}` });
    if (staff(actor, b)) for (const [kind, items] of [['refund', b.refunds || []], ['safety', (s.safety || []).filter(x => x.bookingId === b.id)], ['dispute', b.disputes || []], ['review', (s.serviceReviews || []).filter(x => x.bookingId === b.id)], ['followup', followups.filter(x => x.bookingId === b.id && x.status !== 'closed' && handling(actor, x) && !(s.serviceCareCases || []).some(c => c.source?.kind === 'followup' && c.source.id === x.id && !TERMINAL.has(c.status)))]]) for (const item of items) sourceOptions.push({ kind, id: item.id, bookingId: b.id, label: `${kind} ${item.id}` });
  }
  return { cases, followups: followups.map(c => projectFollowup(s, actor, c)), summary: { openCaseCount: cases.filter(c => !TERMINAL.has(c.status)).length, overdueCaseCount: cases.filter(c => c.overdue).length, openFollowupCount: followups.filter(c => c.status !== 'closed').length, overdueFollowupCount: followups.filter(c => c.status !== 'closed' && s.now >= c.dueAt).length, awaitingActionCount: cases.filter(c => c.status === 'execution_pending').length }, canCreateCase: actor?.role === 'user' || ['store', 'manager'].includes(actor?.role) || support(actor), canCreateFollowup: ['store', 'manager'].includes(actor?.role) || support(actor), bookingOptions, sourceOptions, categories: clone(CATEGORIES) };
}
