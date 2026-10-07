// C11. Escalation requests never replace source business state or native owners.
import { workTaskView, workTaskCommand } from './work-tasks.mjs';
import { resolveAccountActor, canAccountView, assertAccountCommand, actorAccountFields, staffGrantActive, staffSettlementGrantLive } from './staff-accounts.mjs';
import { assertJob } from './management.mjs';
import { createTaskReturnContext } from './task-navigation.mjs';
const copy = x => structuredClone(x);
const canonical = x => Array.isArray(x) ? x.map(canonical) : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).sort().map(k => [k, canonical(x[k])])) : x;
const sig = x => JSON.stringify(canonical(x));
const fail = message => { throw new Error(message); };
const text = (x, label, max = 500) => { if (typeof x !== 'string' || !x.trim() || x.trim().length > max) fail(`请填写${label}（最多${max}字）`); return x.trim(); };
const by = a => ({ role: a.role, job: a.job || null, storeId: a.storeId || null, ...actorAccountFields(a) });
const checkVersion = (p, current, label) => { if (!['number', 'string'].includes(typeof p) || !String(p).trim() || !Number.isSafeInteger(Number(p)) || Number(p) !== current) fail(`${label}已更新或缺少版本，请刷新核对`); };
export function upgradeWorkEscalations(s) { s.workEscalations ??= []; s.workEscalationRequests ??= []; return s; }
function backend(s, raw) {
  const a = resolveAccountActor(s, raw);
  if (!['group', 'store'].includes(a?.role) || a.job === 'account-admin' || !canAccountView(a, 'tasks')) fail('当前工作身份无权查看事项升级');
  return a;
}
function grant(s, accountId, grantId) {
  const accounts=(s.staffAccounts || []).filter(x=>x.id===accountId),account=accounts.length===1?accounts[0]:null,grants=(account?.grants || []).filter(x=>x.id===grantId),g=grants.length===1?grants[0]:null;
  if (!staffGrantActive(s,account,g)) return null;
  const store=g.role==='store'&&(s.stores || []).find(x=>x.id===g.storeId),restricted=g.purpose==='lifecycle-settlement';
  if(restricted&&!staffSettlementGrantLive(s,account,g)||store&&(store.lifecycleStatus==='closed'||store.closedAt!=null)&&!restricted)return null;
  return { role: g.role, job: g.job, storeId: g.storeId || null, accountId, grantId, accountName: account.name, sessionId: 'candidate-authorization-check', accountVersion: account.version,...(restricted?{lifecyclePurpose:g.purpose,lifecycleCaseId:g.sourceCaseId,allowedCommands:copy(g.allowedCommands),allowedRoutes:copy(g.allowedRoutes),responsibilityAt:g.responsibilityAt,originalBookingIds:copy(g.originalBookingIds),originalGoodsIds:copy(g.originalGoodsIds)}:{}) };
}
function readable(a, t) {
  return Boolean(a && ['group', 'store'].includes(a.role) && t.routes?.[a.role] && t.allowedJobs?.[a.role]?.includes(a.job) && (a.role !== 'store' || a.storeId === t.storeId) && canAccountView(a, t.requiredRoute) && canAccountView(a, 'tasks'));
}
function handles(a, t) {
  const phase = t.status === 'open' || t.assignmentMode === 'source' && t.status === 'waiting';
  return Boolean(phase && readable(a, t) && t.manageRoles?.includes(a.role) && (t.commands || []).some(command => { try { assertAccountCommand(a, command); assertJob(a, command); return true; } catch { return false; } }));
}
function candidates(s, t) {
  if (t.status === 'done') return [];
  return (s.staffAccounts || []).filter(x => x.enabled).flatMap(account => (account.grants || []).map(g => grant(s, account.id, g.id)).filter(a => readable(a, t)).map(a => ({ accountId: a.accountId, grantId: a.grantId, name: a.accountName, role: a.role, job: a.job, storeId: a.storeId, canHandle: handles(a, t) }))).sort((a, b) => a.name.localeCompare(b.name) || a.accountId.localeCompare(b.accountId) || a.grantId.localeCompare(b.grantId));
}
function native(s, t) {
  if (['care', 'followup'].includes(t.category)) {
    const row = (t.category === 'care' ? s.serviceCareCases : s.serviceCareFollowups)?.find(x => x.id === t.sourceId), a = row?.assignee;
    const direct = a?.accountId && a?.grantId, claimed = a?.claimedAt != null && a?.by?.accountId && a?.by?.grantId;
    return { accountId: direct ? a.accountId : claimed ? a.by.accountId : null, grantId: direct ? a.grantId : claimed ? a.by.grantId : null, name: a?.name || '', binding: { scope: row?.ownerScope || null, name: a?.name || '', claimedAt: a?.claimedAt ?? null, directAccountId: a?.accountId || null, directGrantId: a?.grantId || null, claimedByAccountId: claimed ? a.by.accountId : null, claimedByGrantId: claimed ? a.by.grantId : null } };
  }
  if (t.category === 'safety') {
    const h = (s.safety || []).find(x => x.id === t.sourceId), current = h?.responsibility;
    const a = current || (h?.acknowledgedAt != null ? h.acknowledgedBy : null);
    return { accountId: a?.accountId || null, grantId: a?.grantId || null, name: current?.name || h?.responsibleName || '', binding: { acknowledgedAt: h?.acknowledgedAt ?? null, accountId: a?.accountId || null, grantId: a?.grantId || null, name: current?.name || h?.responsibleName || '', responsibilityAt: current?.at ?? null } };
  }
  if (t.category === 'safe-departure') {
    const row = (s.fulfilmentDepartures || []).find(x => x.id === t.sourceId), a = row?.owner;
    return { accountId: a?.accountId || null, grantId: a?.grantId || null, name: a?.accountName || '', binding: { owner: a ? copy(a) : null, nativeValid: t.nativeOwnerValid ?? null } };
  }
  return { accountId: null, grantId: null, name: t.nativeOwnerName || '', binding: { unsupported: true, name: t.nativeOwnerName || '' } };
}
function owner(s, t) {
  const original = t.assignmentMode === 'source', assignment = original ? null : (s.workTaskAssignments || []).find(x => x.id === t.id);
  const n = original ? native(s, t) : { accountId: assignment?.accountId || null, grantId: assignment?.grantId || null, name: assignment?.accountName || '', binding: { sourceToken: assignment?.sourceToken || null, version: assignment?.version || 0 } };
  const a = n.accountId && n.grantId ? grant(s, n.accountId, n.grantId) : null, valid = n.accountId ? Boolean(a && (t.status === 'done' ? readable(a, t) : handles(a, t)) && (!original || t.nativeOwnerValid !== false)) : null;
  const account = (s.staffAccounts || []).find(x => x.id === n.accountId), g = account?.grants?.find(x => x.id === n.grantId);
  return { accountId: n.accountId, grantId: n.grantId, name: a?.accountName || n.name, valid, unverified: Boolean(!n.accountId && n.name), token: sig({ mode: t.assignmentMode, ...n, enabled: account?.enabled ?? null, accountVersion: account?.version ?? null, grantEnabled: g?.enabled ?? null, job: g?.job || null, role: g?.role || null, storeId: g?.storeId || null }), assignmentVersion: assignment?.version || 0 };
}
function snapshot(t) { return { taskId: t.id, category: t.category, sourceId: t.sourceId, storeId: t.storeId || null, status: t.status, statusLabel: t.statusLabel, dueAt: Number.isFinite(t.dueAt) ? t.dueAt : null, sourceToken: t.sourceToken }; }
function project(s, a, t) {
  const o = owner(s, t), r = (s.workEscalations || []).find(x => x.id === t.id), eligible = candidates(s, t), receiver = r?.receiver ? grant(s, r.receiver.accountId, r.receiver.grantId) : null;
  const stale = Boolean(r && (r.sourceToken !== t.sourceToken || r.ownerToken !== o.token || r.assignmentVersion !== o.assignmentVersion));
  const active = t.status !== 'done', declined = Boolean(r?.status === 'declined' && !stale), canHandle = Boolean(a.accountId && handles(a, t));
  const causes = [...(o.valid === false ? ['owner-invalid'] : []), ...(declined ? ['owner-refused'] : []), ...(Number.isFinite(t.dueAt) && s.now >= t.dueAt && active ? ['overdue'] : []), 'manual-review'];
  return { task: copy(t), owner: { accountId: o.accountId, grantId: o.grantId, name: o.name, valid: o.valid, unverified: o.unverified }, ownerToken: o.token, assignmentVersion: o.assignmentVersion, record: r ? copy(r) : null, version: r?.version || 0, status: !active ? 'source-done' : stale ? 'source-changed' : r?.status || 'none', receiverValid: r?.receiver ? readable(receiver, t) : null, candidates: eligible, causes, canRaise: active && Boolean(a.accountId) && eligible.length > 0, canDecline: active && canHandle && o.valid === true && o.accountId === a.accountId && o.grantId === a.grantId, canTakeover: active && !stale && r?.status === 'raised' && canHandle && receiver?.accountId === a.accountId && receiver.grantId === a.grantId };
}
export function workEscalationView(s, rawActor) {
  const a = backend(s, rawActor), tasks = workTaskView(s, a).tasks;
  const rows = tasks.map(t => project(s, a, t));
  // Some original producers include the business phase in task.id. An old
  // escalation remains a real record after that phase changes, but only the
  // current, independently authorized producer may supply its navigation exit.
  for(const r of s.workEscalations || []){
    if(tasks.some(t=>t.id===r.id))continue;
    const old=r.sourceSnapshot;
    if(!old||old.taskId!==r.id||old.sourceToken!==r.sourceToken||!['raised','declined','taken-over'].includes(r.status)||
      !Number.isSafeInteger(r.version)||r.version<1||(s.workEscalations || []).filter(x=>x.id===r.id).length!==1)continue;
    const matches=tasks.filter(t=>t.category===old.category&&t.sourceId===old.sourceId&&(t.storeId || null)===old.storeId);
    if(matches.length!==1)continue;
    const t=matches[0];
    try{
      const context=createTaskReturnContext(s,a,{taskKey:t.id,task:t,listHash:`/${a.role}/tasks`,token:'work-escalation-history-source'});
      // These metadata fields have the same original typed domain for every
      // producer. A find-first legacy navigation read cannot prove a unique root.
      const roots={bookingId:'bookings',orderId:'goods',techId:'techs',profileId:'techQualifications'};
      if(Object.entries(roots).some(([key,container])=>{const root=context.binding[key]??t[key];return root!=null&&(s[container] || []).filter(x=>x.id===root).length!==1;}))continue;
    }catch{continue;}
    const current=project(s,a,t),receiver=r.receiver?grant(s,r.receiver.accountId,r.receiver.grantId):null;
    rows.push({...current,record:copy(r),version:r.version,historicalTaskId:r.id,status:t.status==='done'?'source-done':'source-changed',
      receiverValid:r.receiver?readable(receiver,t):null,candidates:[],causes:[],canRaise:false,canDecline:false,canTakeover:false});
  }
  return { rows, counts: { raised: rows.filter(x => x.status === 'raised').length, declined: rows.filter(x => x.status === 'declined').length, changed: rows.filter(x => x.status === 'source-changed').length, sourceDone: rows.filter(x => x.status === 'source-done' && x.record).length } };
}
function audit(s, r, type, a, t, reason, details = {}) {
  (r.history ??= []).push({ at: s.now, type, by: by(a), reason, source: snapshot(t), ownerToken: r.ownerToken, assignmentVersion: r.assignmentVersion, version: r.version, ...copy(details) });
  r.updatedAt = s.now;
}
export function workEscalationCommand(s, rawActor, type, p = {}, ctx = {}) {
  if (!['work-escalation.decline', 'work-escalation.raise', 'work-escalation.takeover'].includes(type)) fail('不支持的事项升级动作');
  const a = backend(s, rawActor); assertAccountCommand(a, type); assertJob(a, type); assertAccountCommand(a, 'work.assign');
  if (!a.accountId || !a.grantId || !a.sessionId) fail('请进入实际工作账号后登记拒接、升级或接管');
  const t = workTaskView(s, a).tasks.find(x => x.id === p.id); if (!t) fail('原事项不存在或当前岗位无权查看');
  // Leave room for the original work.assign request namespace (max 300).
  const projected = project(s, a, t), requestId = text(p.requestId, '唯一提交标识', 260), who = sig({ accountId: a.accountId, grantId: a.grantId }), fingerprint = sig({ type, p });
  if (type.endsWith('decline') && !projected.canDecline) fail('仅当前可核验的本人负责人可以登记拒接；姓名待核对请回原页面');
  if (type.endsWith('takeover') && !handles(a, t)) fail('当前岗位无原事项本阶段的办理权，不能借升级代办');
  const old = (s.workEscalationRequests || []).find(x => x.actor === who && x.requestId === requestId);
  if (old) { if (old.fingerprint !== fingerprint) fail('同一提交标识不能用于不同升级动作或内容'); return copy(old.result); }
  if (t.status === 'done') fail('原事项已经结束，不能拒接、升级或接管');
  if (typeof p.sourceToken !== 'string' || p.sourceToken !== t.sourceToken || typeof p.ownerToken !== 'string' || p.ownerToken !== projected.ownerToken) fail('原阶段或负责人已更新，请重新核对');
  checkVersion(p.assignmentVersion, projected.assignmentVersion, '原分派责任'); checkVersion(p.version, projected.version, '升级记录');
  const reason = text(p.reason, '实际原因或核对依据'), prior = projected.record;
  let r = prior ? copy(prior) : { id: t.id, createdAt: s.now, version: 0, originDueAt: Number.isFinite(t.dueAt) ? t.dueAt : null, history: [] };
  r.version++; r.sourceToken = t.sourceToken; r.ownerToken = projected.ownerToken; r.assignmentVersion = projected.assignmentVersion; r.sourceSnapshot = snapshot(t);
  if (type.endsWith('decline')) {
    r.status = 'declined'; r.receiver = null; r.cause = 'owner-refused'; audit(s, r, type, a, t, reason, { declinedBy: by(a) });
  } else if (type.endsWith('raise')) {
    if (!projected.causes.includes(p.cause)) fail('实际条件不符合所选升级原因，请核对原负责人、拒接记录或原期限');
    const receiver = projected.candidates.find(x => x.accountId === p.accountId && x.grantId === p.grantId);
    if (!receiver) fail('接收核对账号已停用、撤权或不在原资源读取范围');
    r.status = 'raised'; r.cause = p.cause; r.receiver = { accountId: receiver.accountId, grantId: receiver.grantId, name: receiver.name, role: receiver.role, job: receiver.job, storeId: receiver.storeId };
    audit(s, r, type, a, t, reason, { receiver: r.receiver, notification: 'local-request-only' });
  } else {
    if (!projected.canTakeover) fail('请由当前有效接收账号在最新源阶段接管；已失效或变化须重新升级');
    const beforeAssignments = sig(s.workTaskAssignments || []);
    if (t.assignmentMode === 'source') {
      if (typeof ctx.takeoverNativeWork !== 'function') fail('原业务责任接管尚未接通，请回原办理页核对；不能另建负责人');
      const adapted = ctx.takeoverNativeWork({ task: copy(t), actor: copy(a), reason, requestId });
      if (adapted && typeof adapted.then === 'function') fail('原责任接管须在本次源事务内同步保存');
      if (sig(s.workTaskAssignments || []) !== beforeAssignments) fail('原责任接管不能建立第二份统一待办负责人');
    } else workTaskCommand(s, a, 'work.assign', { id: t.id, sourceToken: t.sourceToken, version: projected.assignmentVersion, accountId: a.accountId, grantId: a.grantId, reason, requestId: `escalation-takeover:${requestId}` }, ctx);
    const after = workTaskView(s, a).tasks.find(x => x.id === t.id); if (!after || after.status === 'done') fail('接管适配不能代替原业务完成');
    if (after.status !== t.status || (Number.isFinite(after.dueAt) ? after.dueAt : null) !== (Number.isFinite(t.dueAt) ? t.dueAt : null)) fail('责任接管不能修改原办理阶段或原截止，请回原页面处理阶段变更');
    const nextOwner = owner(s, after);
    if (nextOwner.valid !== true || nextOwner.accountId !== a.accountId || nextOwner.grantId !== a.grantId) fail('原业务未保存可核验的当前本人负责人，接管未成立');
    r.status = 'taken-over'; r.sourceToken = after.sourceToken; r.ownerToken = nextOwner.token; r.assignmentVersion = nextOwner.assignmentVersion; r.sourceSnapshot = snapshot(after);
    audit(s, r, type, a, after, reason, { beforeSource: snapshot(t), acceptedBy: by(a) });
  }
  upgradeWorkEscalations(s); const actual = s.workEscalations.find(x => x.id === r.id);
  if (actual) Object.assign(actual, r); else s.workEscalations.push(r);
  const result = { id: r.id, version: r.version, status: r.status }; s.workEscalationRequests.push({ actor: who, requestId, fingerprint, result: copy(result), at: s.now });
  ctx.log?.(r, `事项责任${type.split('.').at(-1)} · ${t.id}`); return result;
}
