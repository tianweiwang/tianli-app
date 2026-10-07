// Minimal recipient and order handoff records. No historical identity is inferred.
import { actorAccountFields } from './staff-accounts.mjs';
const clone = value => structuredClone(value);
const canonical = v => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
const signature = v => JSON.stringify(canonical(v));
const truth = value => value === true || value === 'true' || value === 'on';
const support = a => a?.role === 'group' && (!a.job || ['all', 'support'].includes(a.job));
const local = (a, b) => Boolean(['store', 'manager'].includes(a?.role) && a.storeId && a.storeId === b.storeId);
const owner = (a, b) => Boolean(a?.role === 'user' && a.userId && a.userId === b.userId);
const technician = (a, b) => Boolean(a?.role === 'tech' && a.techId && a.techId === b.techId);
const readable = (a, b) => !!b && (owner(a, b) || technician(a, b) || local(a, b) || support(a));
const writer = (a, b) => technician(a, b) || local(a, b) || support(a);
const by = a => ({ role:a.role, id:a.role === 'user' ? a.userId : a.role === 'tech' ? a.techId : ['store', 'manager'].includes(a.role) ? a.storeId : 'group', job:a.role === 'group' ? a.job || null : null, ...actorAccountFields(a) });
const sameAuthor = (a, note) => {
  const current = by(a);
  if (current.accountId || note.by?.accountId) return Boolean(current.accountId && current.accountId === note.by?.accountId);
  return signature(current) === signature(note.by);
};
const bookingFor = (s, id) => (s.bookings || []).find(b => b.id === id);
const recordFor = (s, id) => (s.serviceHandoffs || []).find(row => row.bookingId === id);
const recipientFor = (s, a, id) => (s.recipients || []).find(row => row.id === id && owner(a, row));
function fail(ctx, message) { ctx?.fail?.(message); throw new Error(message); }
function text(value, label, ctx, max = 1000, required = true) {
  if (value != null && typeof value !== 'string') fail(ctx, `${label}格式无效`);
  const result = String(value ?? '').trim();
  if ((required && !result) || result.length > max) fail(ctx, `请填写${label}（最多${max}字）`);
  return result;
}
function version(value, expected, ctx) {
  if (!['number', 'string'].includes(typeof value) || !String(value).trim() || !Number.isSafeInteger(Number(value)) || Number(value) !== expected) fail(ctx, '记录已更新或缺少版本，请刷新核对后重试');
}
function timestamp(value, ctx) {
  if (typeof value === 'number') { if (!Number.isSafeInteger(value) || !Number.isFinite(new Date(value).getTime())) fail(ctx, '事实发生时间无效'); return value; }
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?$/.exec(String(value || ''));
  if (!m || +m[2] < 1 || +m[2] > 12 || +m[3] < 1 || +m[3] > new Date(Date.UTC(+m[1], +m[2], 0)).getUTCDate() || +m[4] > 23 || +m[5] > 59 || +(m[6] || 0) > 59) fail(ctx, '事实发生时间无效');
  const result = Date.parse(m[7] ? value : `${value}+08:00`);
  if (!Number.isSafeInteger(result)) fail(ctx, '事实发生时间无效');
  return result;
}
function knownUser(s, a, ctx) { if (a?.role !== 'user' || !(s.users || []).some(u => u.id === a.userId)) fail(ctx, '仅有效的预约用户可以管理自己的服务对象'); }
function identity(p, ctx) {
  if (!['self', 'family', 'other'].includes(p.kind)) fail(ctx, '请选择本人、家人或其他服务对象');
  return {kind:p.kind, name:text(p.name, '服务对象称呼', ctx, 30), relationship:p.kind === 'self' ? '本人' : text(p.relationship, '与预约人的关系', ctx, 30)};
}
const nextId = (s, ctx, prefix) => ctx?.id ? ctx.id(prefix) : `${prefix}${s.seq = (s.seq || 0) + 1}`;
function request(s, a, type, p, ctx) {
  const requestId = text(p.requestId, '本次提交标识', ctx, 300), actor = signature(by(a)), fingerprint = signature({type, p});
  const previous = (s.handoffRequests || []).find(r => r.requestId === requestId && r.actor === actor);
  if (previous && previous.fingerprint !== fingerprint) fail(ctx, '同一提交标识不能用于不同操作或内容');
  return {requestId, actor, fingerprint, previous};
}
function remember(s, req, result, kind) { s.handoffRequests.push({requestId:req.requestId, actor:req.actor, fingerprint:req.fingerprint, kind, id:kind === 'recipient' ? result.id : result.bookingId}); }
function audit(s, row, a, action, ctx, details = {}) {
  row.version++; row.updatedAt = s.now;
  (row.history ??= []).push({at:s.now, by:by(a), action, version:row.version, ...clone(details)});
  // Shared management logs contain only identifiers, never names or handoff text.
  ctx?.log?.(row, `服务交接 ${action} · ${row.bookingId || row.id}`);
}
function actualService(s, b) { return ['active', 'interrupted', 'done'].includes(b.status) && Number.isFinite(b.startedAt) && b.startedAt <= s.now; }
function terminalService(s, b) { return b.status === 'done' && actualService(s, b) && [b.completedAt, b.stoppedAt].some(at => Number.isFinite(at) && at >= b.startedAt && at <= s.now); }
function assignmentKey(b) { return signature({techId:b.techId, changes:(b.changeHistory || []).filter(c => c.status === 'accepted').map(c => c.id)}); }
function currentRead(row, b) { return (row.acks || []).some(ack => ack.techId === b.techId && ack.assignmentKey === assignmentKey(b)); }
const matched = (row, b) => !!row && row.bookingId === b.id && row.userId === b.userId && row.storeId === b.storeId && row.recipientId === b.recipientId;

export function upgradeHandoffs(s) { s.recipients ??= []; s.serviceHandoffs ??= []; s.handoffRequests ??= []; return s; }

export function recipientView(s, actor) {
  if (actor?.role !== 'user' || !(s.users || []).some(u => u.id === actor.userId)) return [];
  return clone((s.recipients || []).filter(row => owner(actor, row)));
}

export function recipientCommand(s, actor, type, p = {}, ctx) {
  if (!['recipient.save', 'recipient.status'].includes(type)) fail(ctx, '不支持的对象操作');
  knownUser(s, actor, ctx);
  const existing = p.id ? recipientFor(s, actor, p.id) : null;
  if (p.id && !existing) fail(ctx, '服务对象不存在或无权处理');
  const req = request(s, actor, type, p, ctx);
  if (req.previous) return recipientFor(s, actor, req.previous.id);
  if (existing) version(p.version, existing.version, ctx);
  else if (p.version != null) version(p.version, 0, ctx);
  if (type === 'recipient.status') {
    if (!existing) fail(ctx, '请选择要停用或恢复的服务对象');
    if (![true, false, 'true', 'false'].includes(p.active)) fail(ctx, '对象启用状态无效');
    const active = p.active === true || p.active === 'true';
    if (active === existing.active) fail(ctx, '对象状态没有变化');
    const reason = text(p.reason,'停用或恢复原因',ctx,300,false);
    upgradeHandoffs(s); existing.active = active;
    audit(s, existing, actor, active ? '恢复对象' : '停用对象', ctx, {reason});
    remember(s, req, existing, 'recipient'); return existing;
  }
  if (!truth(p.consent)) fail(ctx, '请确认已取得服务对象同意并授权保存称呼与关系');
  const fields = identity(p, ctx);
  if (existing && !existing.active) fail(ctx, '对象已停用，请先恢复后修改');
  const row = existing || {id:nextId(s,ctx,'RC'), userId:actor.userId, version:0, active:true, history:[], createdAt:s.now};
  upgradeHandoffs(s); const previous = existing ? {kind:row.kind,name:row.name,relationship:row.relationship} : null;
  Object.assign(row, fields, {consent:{at:s.now,userId:actor.userId}});
  if (!existing) s.recipients.push(row);
  audit(s, row, actor, existing ? '修改对象' : '保存对象', ctx, {previous});
  remember(s, req, row, 'recipient'); return row;
}

export function handoffSources(s, actor, recipientId, storeId) {
  if (actor?.role !== 'user' || !(s.users || []).some(u => u.id === actor.userId)) return [];
  const recipient = recipientFor(s, actor, recipientId);
  if (!recipient?.active || !(s.stores || []).some(store => store.id === storeId)) return [];
  return (s.serviceHandoffs || []).flatMap(row => {
    const b = bookingFor(s, row.bookingId);
    if (!b || !matched(row,b) || !owner(actor,b) || b.storeId !== storeId || row.recipientId !== recipient.id || !row.confirmation || !terminalService(s,b)) return [];
    return (row.notes || []).filter(note => note.status === 'accepted' && note.decision?.decision === 'accept' && note.decision.userId === actor.userId && !note.replacedBy && note.nextAdvice && Number.isFinite(note.occurredAt) && note.occurredAt >= b.startedAt && note.occurredAt <= s.now).map(note => ({bookingId:b.id,noteId:note.id,version:row.version,advice:note.nextAdvice,at:note.createdAt}));
  }).sort((a,b) => b.at - a.at || b.noteId.localeCompare(a.noteId));
}

export function captureBookingHandoff(s, actor, b, p = {}, ctx) {
  const fields = ['recipientId','recipientVersion','recipientKind','recipientName','recipientRelationship','recipientConfirmed','attention','preference','sourceNoteId','sourceBookingId','sourceVersion'];
  if (!fields.some(key => Object.hasOwn(p,key))) return null;
  knownUser(s,actor,ctx);
  if (!owner(actor,b)) fail(ctx, '只能为自己的预约确认服务对象');
  if (recordFor(s,b.id)) fail(ctx, '预约已保存服务交接，不能覆盖历史确认');
  if (!truth(p.recipientConfirmed)) fail(ctx, '请重新确认本次服务对象、注意事项与偏好');
  const recipientId = text(p.recipientId, '本次服务对象',ctx,100);
  let snapshot;
  if (recipientId === 'visit') {
    snapshot = {...identity({kind:p.recipientKind,name:p.recipientName,relationship:p.recipientRelationship},ctx),id:'visit',version:null,saved:false};
  } else {
    const recipient = recipientFor(s,actor,recipientId);
    if (!recipient?.active) fail(ctx, '服务对象不存在、已停用或不属于当前用户');
    version(p.recipientVersion,recipient.version,ctx);
    snapshot = {id:recipient.id,kind:recipient.kind,name:recipient.name,relationship:recipient.relationship,version:recipient.version,saved:true};
  }
  const confirmation = {attention:text(p.attention,'本次注意事项',ctx,1000,false),preference:text(p.preference,'本次服务偏好',ctx,1000,false),confirmedAt:s.now,userId:actor.userId};
  const hasSource = [p.sourceNoteId,p.sourceBookingId,p.sourceVersion].some(value => value != null && value !== '');
  if (hasSource) {
    const source = handoffSources(s,actor,recipientId,b.storeId).find(x => x.noteId === p.sourceNoteId && x.bookingId === p.sourceBookingId);
    if (!source) fail(ctx, '历史建议已失效或不属于同一服务对象及门店，请重新选择');
    version(p.sourceVersion,source.version,ctx);
    Object.assign(confirmation,{sourceNoteId:source.noteId,sourceBookingId:source.bookingId,sourceVersion:source.version});
  }
  const row = {bookingId:b.id,recipientId,recipientSnapshot:clone(snapshot),userId:b.userId,storeId:b.storeId,version:1,confirmation,notes:[],acks:[],history:[{at:s.now,by:by(actor),action:'确认本次交接',version:1}],createdAt:s.now,updatedAt:s.now};
  upgradeHandoffs(s); b.recipientId = recipientId; b.recipientSnapshot = clone(snapshot); s.serviceHandoffs.push(row);
  return row;
}

export function handoffView(s, actor, bookingId) {
  const b = bookingFor(s,bookingId);
  if (!readable(actor,b)) return null;
  const row = recordFor(s,bookingId);
  if (!matched(row,b) || !row.confirmation) return {bookingId,recipientId:null,recipientSnapshot:null,version:0,legacy:true,confirmation:null,notes:[],acks:[],history:[],hasRead:false,canAck:false,canNote:false,canDecide:false,currentTechId:b.techId,storeId:b.storeId,userId:b.userId,reason:'旧预约未确认服务对象；保留原联系人，不自动建立档案或复用历史建议'};
  const hasRead = currentRead(row,b), canNote = writer(actor,b) && actualService(s,b);
  const notes = clone(row.notes || []).map(note => ({...note,canCorrect:canNote && sameAuthor(actor,note) && !note.replacedBy,canDecide:owner(actor,b) && note.status === 'pending' && !note.replacedBy}));
  return {...clone(row),legacy:false,notes,hasRead,canAck:technician(actor,b) && !hasRead && !['unpaid','cancelled','closed'].includes(b.status),canNote,canDecide:notes.some(n=>n.canDecide),currentTechId:b.techId,reason:canNote ? '' : !actualService(s,b) ? '实际开始服务后才可追加客观记录；交接不新增开始服务门槛' : '当前身份可查看记录，不能代替服务人员记录事实'};
}

export function handoffCommand(s, actor, type, p = {}, ctx) {
  if (!['handoff.ack','handoff.note','handoff.decide'].includes(type)) fail(ctx,'不支持的交接操作');
  const b = bookingFor(s,p.bookingId), row = recordFor(s,p.bookingId);
  if (!readable(actor,b)) fail(ctx,'预约不存在或无权处理服务交接');
  if (!matched(row,b) || !row.confirmation) fail(ctx,'本预约没有已确认服务对象，不能补造历史交接');
  if (type === 'handoff.ack' && !technician(actor,b)) fail(ctx,'仅当前分配技师可以确认已读');
  if (type === 'handoff.note' && !writer(actor,b)) fail(ctx,'仅当前技师、本店或集团客服可以追加客观记录');
  if (type === 'handoff.decide' && !owner(actor,b)) fail(ctx,'仅预约用户可以确认是否采用建议');
  const req = request(s,actor,type,p,ctx);
  if (req.previous) return recordFor(s,req.previous.id);
  version(p.version,row.version,ctx);
  if (type === 'handoff.ack') {
    if (['unpaid','cancelled','closed'].includes(b.status)) fail(ctx,'当前预约状态无需确认交接已读');
    if (currentRead(row,b)) fail(ctx,'当前技师已确认阅读本次事项');
    row.acks.push({techId:actor.techId,at:s.now,assignmentKey:assignmentKey(b),by:by(actor)});
    audit(s,row,actor,'确认已读',ctx);
  } else if (type === 'handoff.note') {
    if (!actualService(s,b)) fail(ctx,'实际开始服务后才可追加客观记录');
    const occurredAt = timestamp(p.occurredAt,ctx);
    if (occurredAt < b.startedAt || occurredAt > s.now) fail(ctx,'事实发生时间须位于实际开始服务之后且不能晚于当前时间');
    const observation = text(p.observation,'客观服务或协调记录',ctx), nextAdvice = text(p.nextAdvice,'下次服务建议',ctx,1000,false);
    const original = p.correctionOf ? (row.notes || []).find(note=>note.id === p.correctionOf) : null;
    if (p.correctionOf && (!original || original.replacedBy || !sameAuthor(actor,original))) fail(ctx,'仅原记录作者可以更正尚未被更正的记录');
    const reason = p.correctionOf ? text(p.reason,'更正原因',ctx,300) : text(p.reason,'补充说明',ctx,300,false);
    const note = {id:nextId(s,ctx,'HN'),observation,nextAdvice,occurredAt,createdAt:s.now,by:by(actor),status:'pending',decision:null,correctionOf:original?.id || null,reason,replacedBy:null};
    if (original) original.replacedBy = note.id;
    row.notes.push(note); audit(s,row,actor,original ? '更正客观记录' : '追加客观记录',ctx,{noteId:note.id,correctionOf:note.correctionOf});
  } else {
    const note = (row.notes || []).find(note=>note.id === p.noteId);
    if (!note || note.status !== 'pending' || note.replacedBy) fail(ctx,'记录不存在、已处理或已被更正，请核对最新记录');
    if (!['accept','reject'].includes(p.decision)) fail(ctx,'请选择采用或不采用建议');
    note.status = p.decision === 'accept' ? 'accepted' : 'rejected'; note.decision = {decision:p.decision,at:s.now,userId:actor.userId};
    audit(s,row,actor,p.decision === 'accept' ? '用户接受记录' : '用户不采用记录',ctx,{noteId:note.id});
  }
  upgradeHandoffs(s); remember(s,req,row,'handoff'); return row;
}
