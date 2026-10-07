// Manual project authorization. Reads do not manufacture historical assessments.
import { actorAccountFields, resolveAccountActor, canAccountView, assertAccountCommand } from './staff-accounts.mjs';
import { lifecycleFingerprint } from './organization-lifecycle-projection.mjs';
const clone = value => structuredClone(value);
const COMMANDS = new Set(['qualification.assess', 'qualification.request', 'qualification.review', 'qualification.pause', 'qualification.resume']);
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const fingerprint = value => JSON.stringify(canonical(value));
const groupOperations = a => a?.role === 'group' && (!a.job || ['all', 'operations'].includes(a.job));
const groupSupport = a => a?.role === 'group' && a.job === 'support';
const local = (a, storeId) => ['store', 'manager'].includes(a?.role) && a.storeId === storeId;
const canRead = (a, tech) => Boolean(tech && (groupOperations(a) || groupSupport(a) || local(a, tech.storeId) || (a?.role === 'tech' && a.techId === tech.id)));
const by = a => ({role:a.role, id:a.role === 'tech' ? a.techId : ['store','manager'].includes(a.role) ? a.storeId : 'group', job:a.role === 'group' ? a.job || null : null, ...actorAccountFields(a)});
function fail(ctx, message) { ctx?.fail?.(message); throw new Error(message); }
function text(value, label, ctx, max = 1000) { const out = String(value ?? '').trim(); if (!out || out.length > max) fail(ctx, `请填写${label}（最多${max}字）`); return out; }
// Same local-demo formats/5 MiB bound as invoice-files; this is not a formal qualification policy.
export function qualificationEvidenceRefs(value, ctx) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) fail(ctx, '资格凭证必须为实际附件数组');
  const refs = value.map(file => {
    if (!file || typeof file !== 'object' || !/^invoice-file:[a-f0-9]{64}$/.test(file.ref || '') || typeof file.name !== 'string' || !file.name.trim() || file.name !== file.name.trim() || file.name.length > 150 || /[\\/:*?"<>|\x00-\x1f]/.test(file.name) || !['application/pdf','image/png','image/jpeg'].includes(file.type) || !Number.isSafeInteger(file.size) || file.size <= 0 || file.size > 5 * 1024 * 1024) fail(ctx, '资格凭证引用、名称、格式或大小无效');
    return {ref:file.ref,name:file.name,type:file.type,size:file.size};
  });
  if (new Set(refs.map(file => file.ref)).size !== refs.length) fail(ctx, '同次资格凭证不能重复');
  return refs;
}
function uniqueEvidence(rows, id, label) {
  const matches = (rows || []).filter(row => row.id === id);
  if (typeof id !== 'string' || !id || id.trim() !== id || matches.length !== 1) fail(null, `${label}缺失或编号不唯一`);
  return matches[0];
}
const evidenceActor = a => ({role:a.role,job:a.job || null,storeId:a.storeId || null,accountId:a.accountId || null,grantId:a.grantId || null,sessionId:a.sessionId || null});
function evidenceSource(row, kind, id) {
  if (kind === 'assessment') {
    const assessment=uniqueEvidence(row.assessments,id,'原考核');
    if(!assessment.serviceIds?.length||!['initial','mature','retraining'].includes(assessment.kind)||!['pass','fail'].includes(assessment.result)||!Number.isFinite(assessment.occurredAt)||!Number.isFinite(assessment.createdAt)||assessment.occurredAt>assessment.createdAt||!assessment.createdBy?.role||![assessment.assessor,assessment.proof,assessment.batch].every(value=>typeof value==='string'&&value.trim()))fail(null,'原考核项目、时间、核验作者或凭证来源缺失');
    return assessment;
  }
  if (['request','review'].includes(kind)) {
    const grant = uniqueEvidence(row.grants,id,'原授权申请'), assessment = evidenceSource(row,'assessment',grant.assessmentId);
    if (assessment.result !== 'pass' || !grant.serviceIds?.length || !grant.serviceIds.every(serviceId => assessment.serviceIds?.includes(serviceId))) fail(null,'授权申请与原考核项目不一致');
    if (kind === 'review' && (!grant.review || !['approve','reject'].includes(grant.review.decision) || grant.status !== (grant.review.decision === 'approve' ? 'approved' : 'rejected'))) fail(null,'原授权审核来源不一致');
    return kind === 'review' ? grant.review : grant;
  }
  if (['pause','resume'].includes(kind)) {
    const hold = uniqueEvidence(row.holds,id,'原资格暂停');
    if (kind === 'pause') return hold;
    const resolution = hold.resolution, assessment = resolution && uniqueEvidence(row.assessments,resolution.assessmentId,'恢复原考核'), grant = resolution && uniqueEvidence(row.grants,resolution.grantId,'恢复原授权');
    if (hold.status !== 'resolved' || !resolution || grant.status !== 'approved' || grant.assessmentId !== assessment.id || assessment.kind !== 'retraining' || assessment.holdId !== hold.id || assessment.result !== 'pass' || assessment.sequence <= hold.sequence || !hold.serviceIds?.every(serviceId => assessment.serviceIds?.includes(serviceId))) fail(null,'原复训恢复来源不一致');
    return resolution;
  }
  fail(null,'资格附件来源槽无效');
}
function historySource(row, history) {
  const kind = {'qualification.assess':'assessment','qualification.request':'request','qualification.review':'review','qualification.pause':'pause','qualification.resume':'resume'}[history?.action];
  const sourceId = kind === 'assessment' ? history.assessmentId : ['request','review'].includes(kind) ? history.grantId : history.holdId;
  const source = evidenceSource(row,kind,sourceId);
  const at=kind==='assessment'?source.createdAt:kind==='request'?source.requestedAt:kind==='pause'?source.startedAt:source.at;
  const author=kind==='assessment'||kind==='pause'?source.createdBy:kind==='request'?source.requestedBy:source.by;
  if (source.evidenceVersion !== history.version || history.at !== at || fingerprint(history.by) !== fingerprint(author) || history.reason !== source.reason || fingerprint(qualificationEvidenceRefs(source.evidenceRefs)) !== fingerprint(qualificationEvidenceRefs(history.evidenceRefs))) fail(null,'资格历史凭证与原记录不一致');
  return {kind,sourceId,source};
}
export function qualificationEvidenceFile(s, rawActor, profileId, slot) {
  const actor = resolveAccountActor(s,rawActor), row = uniqueEvidence(s.techQualifications,profileId,'原资格档案'), person = uniqueEvidence(s.techs,row.techId,'原技师');
  uniqueEvidence(s.stores,row.storeId,'原资格门店');
  if (!actor || actor.role === 'tech' || !canAccountView(actor,'qualifications') || !canRead(actor,{...person,storeId:row.storeId})) fail(null,'当前身份无权查看原资格凭证');
  const match = /^(assessment|request|review|pause|resume):([A-Za-z0-9_-]+):(0|[1-9]\d*)$/.exec(String(slot)), historic = /^history:([1-9]\d*):(0|[1-9]\d*)$/.exec(String(slot));
  let source, kind, sourceId, index, history = null;
  if (match) { [,kind,sourceId] = match; index = Number(match[3]); source = evidenceSource(row,kind,sourceId); }
  else if (historic) {
    const histories = (row.history || []).filter(item => item.version === Number(historic[1]));
    if (histories.length !== 1) fail(null,'资格历史来源缺失或不唯一');
    history = histories[0]; ({source,kind,sourceId} = historySource(row,history)); index = Number(historic[2]);
  } else fail(null,'资格附件来源槽无效');
  const file = qualificationEvidenceRefs(source.evidenceRefs)[index];
  if (!file || !Number.isSafeInteger(index)) fail(null,'原资格附件槽缺失');
  let related = null;
  if (['request','review'].includes(kind)) { const grant=uniqueEvidence(row.grants,sourceId,'原授权申请'); related={grant:clone(grant),assessment:clone(uniqueEvidence(row.assessments,grant.assessmentId,'申请原考核'))}; }
  else if (['pause','resume'].includes(kind)) { const hold=uniqueEvidence(row.holds,sourceId,'原资格暂停'); related={hold:clone(hold)}; if(kind==='resume'){related.assessment=clone(uniqueEvidence(row.assessments,hold.resolution.assessmentId,'恢复原考核'));related.grant=clone(uniqueEvidence(row.grants,hold.resolution.grantId,'恢复原授权'));} }
  else if (source.holdId) related={hold:clone(uniqueEvidence(row.holds,source.holdId,'考核原暂停'))};
  return {...clone(file),sourceToken:fingerprint({actor:evidenceActor(actor),profile:{id:row.id,techId:row.techId,storeId:row.storeId,version:row.version},slot,kind,sourceId,source:clone(source),related,history:history ? clone(history) : null})};
}
function checkVersion(value, expected, ctx) { if (!['number','string'].includes(typeof value) || String(value).trim() === '' || !Number.isSafeInteger(Number(value)) || Number(value) !== expected) fail(ctx, '资格记录已更新或缺少版本，请刷新核对后重试'); }
function date(value, ctx) {
  if (typeof value === 'number') { if (!Number.isSafeInteger(value) || !Number.isFinite(new Date(value).getTime())) fail(ctx, '考核发生时间无效'); return value; }
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?$/.exec(String(value || ''));
  if (!m || +m[2] < 1 || +m[2] > 12 || +m[3] < 1 || +m[3] > new Date(Date.UTC(+m[1], +m[2], 0)).getUTCDate() || +m[4] > 23 || +m[5] > 59 || +(m[6] || 0) > 59) fail(ctx, '考核发生时间无效');
  const out = Date.parse(m[7] ? value : value + '+08:00'); if (!Number.isSafeInteger(out)) fail(ctx, '考核发生时间无效'); return out;
}
const techFor = (s, techId) => (s.techs || []).find(x => x.id === techId);
const profilesFor = (s, techId, storeId = techFor(s, techId)?.storeId) => (s.techQualifications || []).filter(x => x.techId === techId && x.storeId === storeId);
const profileFor = (s, techId, storeId = techFor(s, techId)?.storeId, profileId) => {
  const rows = profilesFor(s, techId, storeId), tech = techFor(s, techId);
  const selectedId = profileId || (storeId === tech?.storeId ? tech.qualificationProfileId : null);
  if (selectedId) { const selected=rows.filter(x => x.id === selectedId); return selected.length === 1 ? selected[0] : undefined; }
  return rows.length === 1 ? rows[0] : undefined;
};
const endOfDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') && Number.isFinite(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0,10) === value ? Date.parse(value + 'T23:59:59.999+08:00') : NaN;
function currentCredentials(s, tech, serviceIds) {
  if (!tech || tech.reviewStatus !== 'approved' || !tech.active || !String(tech.certificate || '').trim() || !String(tech.insurance || '').trim() || !(endOfDate(tech.validUntil) >= s.now)) return '请先完成有效证书、保单和集团资料审核，并保持人员在岗';
  const store = (s.stores || []).find(x => x.id === tech.storeId);
  if (!store || serviceIds.some(id => !tech.serviceIds?.includes(id) || !store.serviceIds?.includes(id) || !(s.services || []).some(x => x.id === id && x.active !== false))) return '授权项目已不在技师或所属门店的有效项目范围内';
  return '';
}
function projects(s, tech, value, ctx) {
  const ids = [...new Set(Array.isArray(value) ? value : String(value || '').split(',').filter(Boolean))];
  if (!ids.length || ids.some(id => typeof id !== 'string' || !tech.serviceIds?.includes(id) || !(s.services || []).some(x => x.id === id) || !(s.stores || []).find(x => x.id === tech.storeId)?.serviceIds?.includes(id))) fail(ctx, '请选择技师及所属门店范围内的项目');
  return ids;
}
export function upgradeQualifications(s) {
  s.techQualifications ??= []; s.techQualificationRequests ??= [];
  for (const tech of s.techs || []) if (!tech.qualificationRequired && !Object.hasOwn(tech, 'legacyQualifiedServiceIds')) tech.legacyQualifiedServiceIds = [...(tech.serviceIds || [])];
  return s;
}
export function qualificationEligibility(s, techId, serviceId, at = s.now, storeId = techFor(s, techId)?.storeId, profileId) {
  const tech = techFor(s, techId), row = profileFor(s, techId, storeId, profileId);
  if (!tech) return {allowed:false, reason:'技师档案不存在', legacy:false};
  if ((s.techQualifications || []).some(r => r.techId === techId && (r.holds || []).some(h => h.status === 'open' && h.serviceIds?.includes(serviceId)))) return {allowed:false, reason:'该项目资格已暂停，须复训审核并明确恢复', legacy:false};
  if (!row) {
    if (profilesFor(s,techId,storeId).length || profileId || (storeId === tech.storeId && tech.qualificationProfileId)) return {allowed:false, reason:'技师所属门店与资格档案不一致，待集团核对', legacy:false};
    const allowed = storeId === tech.storeId && !tech.qualificationRequired && (tech.legacyQualifiedServiceIds || tech.serviceIds || []).includes(serviceId);
    return {allowed, reason:allowed ? '' : '该项目尚未获独立服务授权', legacy:allowed};
  }
  const allowed = (row.grants || []).some(g => g.status === 'approved' && g.serviceIds.includes(serviceId) && Number.isFinite(g.review?.at) && g.review.at <= at);
  return {allowed, reason:allowed ? '' : '该项目尚未获独立服务授权', legacy:false};
}
export function qualificationImpacts(s, techId, serviceIds) {
  const ids = serviceIds || techFor(s, techId)?.serviceIds || [];
  return (s.bookings || []).filter(b => ['unpaid','waiting','confirmed','active','interrupted'].includes(b.status)).flatMap(b => {
    const current = b.techId === techId && ids.includes(b.serviceId);
    const proposed = b.change?.status === 'pending' && b.change.techId === techId && ids.includes(b.change.serviceId || b.serviceId);
    if (!current && !proposed) return [];
    const fulfilling = Boolean(b.startedAt || b.departedAt || b.arrivedAt || ['active','interrupted'].includes(b.status));
    return [{bookingId:b.id, status:b.status, serviceId:b.serviceId, storeId:b.storeId, startAt:b.startAt, proposedStartAt:proposed ? b.change.startAt : null, current, proposed, stage:fulfilling ? 'fulfilling' : 'not_started', needsCoordination:(!fulfilling && current) || proposed}];
  });
}
function restorationEvidence(row, hold) {
  const approved = (row.grants || []).filter(g => g.status === 'approved' && hold.serviceIds.every(id => g.serviceIds.includes(id))).sort((a,b) => (b.review?.at || 0) - (a.review?.at || 0));
  for (const grant of approved) {
    const assessment = (row.assessments || []).find(a => a.id === grant.assessmentId);
    if (assessment?.kind === 'retraining' && assessment.result === 'pass' && assessment.holdId === hold.id && assessment.sequence > hold.sequence && assessment.occurredAt >= hold.startedAt && assessment.createdAt >= hold.startedAt && hold.serviceIds.every(id => assessment.serviceIds.includes(id)) && grant.review?.at >= assessment.createdAt) return {assessment, grant};
  }
  return null;
}
function unresolvedImpacts(s, row, hold) {
  const original = new Set(hold.affectedBookingIds || []);
  return qualificationImpacts(s, row.techId, hold.serviceIds).filter(x => original.has(x.bookingId) && x.needsCoordination);
}
// Internal source proof only. A penalty command must separately prove its own
// policy/effect, term, typed hold link and current actor before any release.
export function qualificationRestorationSource(s, selection) {
  const out = {available:false,qualificationReady:false,reason:'',techId:selection?.techId ?? null,profileId:selection?.profileId ?? null,storeId:null,holdId:selection?.holdId ?? null,serviceIds:[],hold:null,assessment:null,grant:null,resolution:null,currentCredentials:null,currentEligibility:[],remainingImpacts:{original:[],current:[]},blockers:[],sourceToken:null};
  const add = (kind,sourceId,path,reason) => out.blockers.push({kind,sourceId,path,reason});
  const requireSource = (condition,sourceId,path,reason) => {if(!condition){add('qualification-source',sourceId,path,reason);throw Error(reason);}};
  const exact = (rows,id,path,label) => {const matches=rows.filter(row=>row?.id===id);requireSource(typeof id==='string'&&id.trim()===id&&id.length>0&&matches.length===1,id,path,`${label}缺失或编号不唯一`);return matches[0];};
  const validAt = value => Number.isSafeInteger(value)&&value>=0&&value<=s.now;
  const nonempty = value => typeof value==='string'&&Boolean(value.trim());
  const ids = value => Array.isArray(value)&&value.length>0&&value.every(nonempty)&&new Set(value).size===value.length;
  try {
    requireSource(selection&&typeof selection==='object'&&!Array.isArray(selection)&&Object.keys(selection).length===3&&Object.keys(selection).every(key=>['techId','profileId','holdId'].includes(key)),null,'selection','恢复来源必须使用精确技师、原档及暂停编号，不能携带就绪或期限');
    requireSource(s&&Number.isSafeInteger(s.now)&&s.now>=0&&['techs','techQualifications','techQualificationRequests','stores','services','bookings'].every(key=>Array.isArray(s[key])),null,'state','原资格、人员、项目、请求或预约来源容器无效');
    const person=exact(s.techs,selection.techId,'techs','原技师'),row=exact(s.techQualifications,selection.profileId,'techQualifications','原资格档案');
    requireSource(row.techId===person.id&&Number.isSafeInteger(row.version)&&row.version>0&&['holds','assessments','grants','history'].every(key=>Array.isArray(row[key]))&&row.history.every(h=>Number.isSafeInteger(h?.version)&&h.version>0&&h.version<=row.version)&&new Set(row.history.map(h=>h.version)).size===row.history.length,row.id,`techQualifications.${row.id}`,'原资格档案主体、版本、历史或来源容器不一致');
    const oldStore=exact(s.stores,row.storeId,'stores','原资格门店'),currentStore=exact(s.stores,person.storeId,'stores','当前所属门店');
    const hold=exact(row.holds,selection.holdId,`techQualifications.${row.id}.holds`,'原资格暂停');
    out.storeId=row.storeId;out.hold=clone(hold);out.serviceIds=clone(hold.serviceIds || []);
    const relatedProfiles=s.techQualifications.filter(item=>item?.techId===person.id);
    const originalIds=Array.isArray(hold.affectedBookingIds)?hold.affectedBookingIds:[];
    const relatedBookings=s.bookings.filter(b=>b&&(originalIds.includes(b.id)||b.techId===person.id||b.change?.techId===person.id));
    out.sourceToken=lifecycleFingerprint({contract:'qualification-restoration:1',selection,now:s.now,person,profiles:relatedProfiles,requests:s.techQualificationRequests.filter(request=>request?.techId===person.id),stores:[oldStore,currentStore],services:s.services.filter(service=>hold.serviceIds?.includes(service?.id)),bookings:relatedBookings});
    requireSource(ids(hold.serviceIds)&&validAt(hold.startedAt)&&Number.isSafeInteger(hold.sequence)&&hold.sequence>0&&hold.sequence<=row.version&&Array.isArray(hold.affectedBookingIds)&&new Set(hold.affectedBookingIds).size===hold.affectedBookingIds.length&&Array.isArray(hold.impacts),hold.id,`techQualifications.${row.id}.holds.${hold.id}`,'原暂停项目、时间、版本或影响快照缺失');
    for(const serviceId of hold.serviceIds)exact(s.services,serviceId,'services','原暂停项目');
    for(const bookingId of originalIds)exact(s.bookings,bookingId,'bookings','原受影响预约');
    for(const booking of relatedBookings)exact(s.bookings,booking.id,'bookings','当前资格影响预约');
    const expectedIds=hold.impacts.filter(impact=>impact?.needsCoordination===true).map(impact=>impact.bookingId);
    requireSource(hold.impacts.every(impact=>impact&&nonempty(impact.bookingId)&&['fulfilling','not_started'].includes(impact.stage)&&typeof impact.current==='boolean'&&typeof impact.proposed==='boolean'&&typeof impact.needsCoordination==='boolean')&&new Set(expectedIds).size===expectedIds.length&&fingerprint([...expectedIds].sort())===fingerprint([...originalIds].sort()),hold.id,`techQualifications.${row.id}.holds.${hold.id}.impacts`,'原暂停影响快照与原协调编号不一致');
    requireSource(hold.status==='resolved'&&hold.resolution&&typeof hold.resolution==='object',hold.id,`techQualifications.${row.id}.holds.${hold.id}.resolution`,'原资格暂停尚未明确恢复');
    const resolution=hold.resolution,assessment=exact(row.assessments,resolution.assessmentId,`techQualifications.${row.id}.assessments`,'恢复原复训考核'),grant=exact(row.grants,resolution.grantId,`techQualifications.${row.id}.grants`,'恢复原批准授权');
    const pair=restorationEvidence({...row,assessments:[assessment],grants:[grant]},hold);
    requireSource(pair&&grant.review?.decision==='approve'&&grant.assessmentId===assessment.id&&ids(assessment.serviceIds)&&ids(grant.serviceIds)&&grant.serviceIds.every(id=>assessment.serviceIds.includes(id))&&[assessment.occurredAt,assessment.createdAt,grant.requestedAt,grant.review.at,resolution.at].every(validAt)&&assessment.occurredAt<=assessment.createdAt&&assessment.createdAt<=grant.requestedAt&&grant.requestedAt<=grant.review.at&&grant.review.at<=resolution.at,hold.id,`techQualifications.${row.id}.holds.${hold.id}.resolution`,'原复训、批准授权与明确恢复时间或项目来源不一致');
    const groupAuthor = author => author?.role==='group'&&(!author.job||['all','operations'].includes(author.job));
    const localAuthor = (author,storeId=row.storeId) => ['store','manager'].includes(author?.role)&&author.id===storeId;
    const pauseAuthor = author => groupAuthor(author)||author?.role==='group'&&author.job==='support'||localAuthor(author);
    requireSource((groupAuthor(assessment.createdBy)||localAuthor(assessment.createdBy))&&(groupAuthor(grant.requestedBy)||localAuthor(grant.requestedBy))&&groupAuthor(grant.review.by)&&groupAuthor(resolution.by)&&pauseAuthor(hold.createdBy)&&[assessment.assessor,assessment.proof,assessment.batch,grant.review.reviewer,grant.review.proof,resolution.reviewer].every(nonempty),hold.id,`techQualifications.${row.id}.holds.${hold.id}.resolution`,'原复训、授权或恢复实际作者与凭据缺失');
    const history = (action,key,id,source,at,author,record=row) => {
      const matches=record.history.filter(item=>item?.action===action&&item[key]===id);
      requireSource(matches.length===1,id,`techQualifications.${record.id}.history`,`${action}原历史缺失或不唯一`);
      const h=matches[0],refs=qualificationEvidenceRefs(source.evidenceRefs);
      requireSource(Number.isSafeInteger(h.version)&&h.version>0&&h.version<=record.version&&h.at===at&&h.reason===source.reason&&nonempty(source.reason)&&fingerprint(h.by)===fingerprint(author)&&fingerprint(refs)===fingerprint(qualificationEvidenceRefs(h.evidenceRefs))&&(!refs.length||source.evidenceVersion===h.version),id,`techQualifications.${record.id}.history.${h.version}`,'原资格历史与实际记录的时间、作者、正文或附件不一致');
      if(refs.length)historySource(record,h);
      const receipts=s.techQualificationRequests.filter(request=>request?.techId===person.id&&request.profileId===record.id&&request.storeId===record.storeId).map(request=>{let body;try{body=JSON.parse(request.fingerprint);}catch{body=null;}return{request,body};}).filter(({body})=>body?.type===action&&Number(body.p?.version)===h.version-1);
      requireSource(receipts.length===1,id,'techQualificationRequests','原资格命令回执缺失、格式待核或版本不唯一');
      const {request,body}=receipts[0],p=body.p,trim=value=>typeof value==='string'?value.trim():value;
      requireSource(request.at===at&&request.actor===fingerprint(author)&&nonempty(request.requestId)&&p.requestId===request.requestId&&p.techId===person.id&&(!p.storeId||p.storeId===record.storeId)&&(!p.profileId||p.profileId===record.id)&&trim(p.reason)===source.reason&&fingerprint(qualificationEvidenceRefs(p.evidenceRefs))===fingerprint(refs),id,'techQualificationRequests','原资格命令正文、作者或附件回执不一致');
      if(['qualification.assess','qualification.pause'].includes(action)){const projects=[...new Set(Array.isArray(p.serviceIds)?p.serviceIds:String(p.serviceIds||'').split(',').filter(Boolean))];requireSource(fingerprint(projects)===fingerprint(source.serviceIds),id,'techQualificationRequests','原考核或暂停项目正文已变化');}
      if(action==='qualification.assess')requireSource(p.kind===source.kind&&p.result===source.result&&date(p.occurredAt,null)===source.occurredAt&&trim(p.batch)===source.batch&&trim(p.assessor)===source.assessor&&trim(p.proof)===source.proof&&(p.holdId||null)===source.holdId,id,'techQualificationRequests','原复训考核正文已变化');
      if(action==='qualification.pause')requireSource(trim(p.owner)===source.owner,id,'techQualificationRequests','原资格暂停负责人正文已变化');
      if(action==='qualification.request')requireSource(p.assessmentId===source.assessmentId&&fingerprint(exact(record.assessments,source.assessmentId,`techQualifications.${record.id}.assessments`,'申请原考核').serviceIds)===fingerprint(source.serviceIds),id,'techQualificationRequests','原授权申请考核关联或项目已变化');
      if(action==='qualification.review')requireSource(p.grantId===id&&p.decision===source.decision&&trim(p.reviewer)===source.reviewer&&trim(p.proof)===source.proof,id,'techQualificationRequests','原批准审核正文已变化');
      if(action==='qualification.resume')requireSource(p.holdId===id&&trim(p.reviewer)===source.reviewer,id,'techQualificationRequests','原资格恢复正文已变化');
      return h;
    };
    const pauseHistory=history('qualification.pause','holdId',hold.id,hold,hold.startedAt,hold.createdBy);
    const assessmentHistory=history('qualification.assess','assessmentId',assessment.id,assessment,assessment.createdAt,assessment.createdBy);
    const requestHistory=history('qualification.request','grantId',grant.id,grant,grant.requestedAt,grant.requestedBy);
    const reviewHistory=history('qualification.review','grantId',grant.id,grant.review,grant.review.at,grant.review.by);
    const resumeHistory=history('qualification.resume','holdId',hold.id,resolution,resolution.at,resolution.by);
    requireSource(pauseHistory.version===hold.sequence&&assessmentHistory.version===assessment.sequence&&pauseHistory.version<assessmentHistory.version&&assessmentHistory.version<requestHistory.version&&requestHistory.version<reviewHistory.version&&reviewHistory.version<resumeHistory.version,hold.id,`techQualifications.${row.id}.history`,'原暂停、复训、申请、批准与恢复历史顺序不一致');
    out.assessment=clone(assessment);out.grant=clone(grant);out.resolution=clone(resolution);out.available=true;
    const credentialReason=currentCredentials(s,person,hold.serviceIds);out.currentCredentials={valid:!credentialReason,reason:credentialReason};
    if(credentialReason)add('qualification-credentials',person.id,`techs.${person.id}`,credentialReason);
    const currentProfiles=relatedProfiles.filter(item=>item.storeId===currentStore.id);
    const selected=person.qualificationProfileId?currentProfiles.filter(item=>item.id===person.qualificationProfileId):currentProfiles;
    requireSource(selected.length===1,person.id,`techQualifications.${currentStore.id}`,'当前所属门店资格档案缺失或不唯一');
    const currentProfile=selected[0];
    exact(s.techQualifications,currentProfile.id,'techQualifications','当前资格档案');
    requireSource(Number.isSafeInteger(currentProfile.version)&&currentProfile.version>=0&&['assessments','grants','holds','history'].every(key=>Array.isArray(currentProfile[key])),currentProfile.id,`techQualifications.${currentProfile.id}`,'当前资格档案版本或来源容器无效');
    for(const serviceId of hold.serviceIds){
      const eligibility=qualificationEligibility(s,person.id,serviceId,s.now,currentStore.id,currentProfile.id);
      for(const currentGrant of currentProfile.grants.filter(item=>item?.status==='approved'&&item.serviceIds?.includes(serviceId))){
        evidenceSource(currentProfile,'review',currentGrant.id);
        const currentAssessment=exact(currentProfile.assessments,currentGrant.assessmentId,`techQualifications.${currentProfile.id}.assessments`,'当前授权原考核');
        requireSource((groupAuthor(currentAssessment.createdBy)||localAuthor(currentAssessment.createdBy,currentStore.id))&&(groupAuthor(currentGrant.requestedBy)||localAuthor(currentGrant.requestedBy,currentStore.id))&&groupAuthor(currentGrant.review.by)&&[currentAssessment.createdAt,currentGrant.requestedAt,currentGrant.review.at].every(validAt),currentGrant.id,`techQualifications.${currentProfile.id}.grants`,'当前原项目授权实际作者或时间无效');
        const a=history('qualification.assess','assessmentId',currentAssessment.id,currentAssessment,currentAssessment.createdAt,currentAssessment.createdBy,currentProfile);
        const q=history('qualification.request','grantId',currentGrant.id,currentGrant,currentGrant.requestedAt,currentGrant.requestedBy,currentProfile);
        const r=history('qualification.review','grantId',currentGrant.id,currentGrant.review,currentGrant.review.at,currentGrant.review.by,currentProfile);
        requireSource(a.version<q.version&&q.version<r.version&&currentAssessment.createdAt<=currentGrant.requestedAt&&currentGrant.requestedAt<=currentGrant.review.at,currentGrant.id,`techQualifications.${currentProfile.id}.history`,'当前考核、申请与批准授权顺序不一致');
      }
      out.currentEligibility.push({serviceId,storeId:currentStore.id,profileId:currentProfile.id,...eligibility});
      if(!eligibility.allowed)add('qualification-current-authorization',currentProfile.id,`techQualifications.${currentProfile.id}`,eligibility.reason);
    }
    out.remainingImpacts.original=clone(unresolvedImpacts(s,row,hold));
    out.remainingImpacts.current=clone(qualificationImpacts(s,person.id,hold.serviceIds).filter(impact=>impact.needsCoordination));
    const seen=new Set();for(const impact of [...out.remainingImpacts.original,...out.remainingImpacts.current]){if(seen.has(impact.bookingId))continue;seen.add(impact.bookingId);add('qualification-coordination',impact.bookingId,`bookings.${impact.bookingId}`,'原安排或拟安排仍须沿原预约流程协调');}
    out.qualificationReady=out.blockers.length===0;
  } catch(error) {
    out.available=false;out.qualificationReady=false;
    if(!out.blockers.some(blocker=>blocker.reason===error.message))add('qualification-source',out.holdId,out.profileId?`techQualifications.${out.profileId}`:'techQualifications',error.message);
  }
  out.reason=out.blockers[0]?.reason || '';
  return out;
}
// Selection is a read-only permission/source check. Empty form facts are validated on submission.
export function qualificationUploadScope(s, rawActor, type, p = {}) {
  if(!COMMANDS.has(type)||!p||typeof p!=='object'||Array.isArray(p))fail(null,'资格附件选择操作或载荷无效');
  const actor=resolveAccountActor(s,rawActor);assertAccountCommand(actor,type);
  const person=uniqueEvidence(s.techs,p.techId,'原技师'),storeId=p.storeId||person.storeId,store=uniqueEvidence(s.stores,storeId,'原资格门店'),rows=profilesFor(s,person.id,storeId),existing=profileFor(s,person.id,storeId,p.profileId),tech={...person,storeId};
  if(!actor||actor.role==='tech'||!canAccountView(actor,'qualifications')||!canRead(actor,tech)||(!existing&&(rows.length||storeId!==person.storeId||p.profileId||person.qualificationProfileId)))fail(null,'原技师归属待核对或当前身份无权选择资格凭证');
  if(existing)uniqueEvidence(s.techQualifications,existing.id,'原资格档案');
  if(['qualification.review','qualification.resume'].includes(type)&&!groupOperations(actor))fail(null,'仅集团运营或管理员可以选择授权审核及恢复凭证');
  if(['qualification.assess','qualification.request'].includes(type)&&!(local(actor,storeId)||groupOperations(actor)))fail(null,'当前岗位不能选择考核或申请凭证');
  if(!existing&&!['qualification.assess','qualification.pause'].includes(type))fail(null,'原资格档案尚未建立');
  if(!existing&&(s.techQualifications||[]).some(item=>item.id===person.id))fail(null,'新资格档案编号已占用');
  checkVersion(p.version,existing?.version||0,null);
  let source=null;
  if(type==='qualification.request') {
    const assessment=evidenceSource(existing,'assessment',p.assessmentId);
    if(assessment.result!=='pass'||existing.grants.some(grant=>grant.assessmentId===assessment.id))fail(null,'原考核尚未通过或已申请授权');
    if(assessment.holdId&&!existing.holds.some(hold=>hold.id===assessment.holdId&&hold.status==='open'))fail(null,'原复训暂停已结束');
    projects(s,tech,assessment.serviceIds,null);source=clone(assessment);
  } else if(type==='qualification.review') {
    const grant=evidenceSource(existing,'request',p.grantId);
    if(grant.status!=='pending')fail(null,'原授权申请已不在待审核阶段');
    if(p.decision!==undefined&&p.decision!==null&&p.decision!==''&&!['approve','reject'].includes(p.decision))fail(null,'请选择有效审核决定');
    const assessment=evidenceSource(existing,'assessment',grant.assessmentId);
    if(p.decision==='approve') {const error=currentCredentials(s,tech,grant.serviceIds);if(error)fail(null,error);if(assessment.holdId&&!existing.holds.some(hold=>hold.id===assessment.holdId&&hold.status==='open'))fail(null,'原复训暂停已结束');}
    source={grant:clone(grant),assessment:clone(assessment)};
  } else if(type==='qualification.assess') {
    if(p.holdId) {const hold=uniqueEvidence(existing?.holds,p.holdId,'原复训暂停');if(hold.status!=='open'||p.kind!=='retraining')fail(null,'请选择未恢复暂停的原复训考核');projects(s,tech,hold.serviceIds,null);source=clone(hold);}
    else if(p.kind==='retraining')fail(null,'复训缺少原暂停来源');
  } else if(type==='qualification.pause') {
    if(p.caseId) {
      const original=uniqueEvidence(s.serviceCareCases,p.caseId,'原质量反馈'),booking=uniqueEvidence(s.bookings,original.bookingId,'原反馈预约');
      if(original.techId!==person.id||original.storeId!==storeId||booking.techId!==person.id||booking.storeId!==storeId||!['number','string'].includes(typeof p.actionIndex)||String(p.actionIndex).trim()===''||!Number.isSafeInteger(Number(p.actionIndex))||Number(p.actionIndex)<0)fail(null,'原反馈不属于本技师门店或事项无效');
      checkVersion(p.caseVersion,original.version,null);const action=original.specialistActions?.[Number(p.actionIndex)];
      if(!action||!['restriction','retraining'].includes(action.kind)||action.qualificationHoldId||action.status==='completed')fail(null,'原反馈专项已变化或不能新建资格暂停');
      projects(s,tech,[booking.serviceId],null);source={case:clone(original),booking:clone(booking),actionIndex:Number(p.actionIndex)};
    } else if(p.actionIndex!=null||p.caseVersion!=null)fail(null,'缺少原反馈来源');
  } else if(type==='qualification.resume') {
    const hold=uniqueEvidence(existing?.holds,p.holdId,'原资格暂停'),evidence=restorationEvidence(existing,hold);
    if(hold.status!=='open'||!evidence)fail(null,'原暂停尚未完成对应复训和集团授权');
    const error=currentCredentials(s,tech,hold.serviceIds);if(error)fail(null,error);
    if(unresolvedImpacts(s,existing,hold).length)fail(null,'原暂停受影响预约仍待协调');
    source={hold:clone(hold),assessment:clone(evidence.assessment),grant:clone(evidence.grant)};
  }
  const profiles=(s.techQualifications||[]).filter(item=>item.techId===person.id);
  return {actor:evidenceActor(actor),type,now:s.now,person:clone(person),store:clone(store),profile:existing?clone(existing):null,profiles:clone(profiles),source,services:clone((s.services||[]).filter(service=>person.serviceIds?.includes(service.id))),bookings:clone((s.bookings||[]).filter(booking=>booking.techId===person.id||booking.change?.techId===person.id))};
}
export function qualificationCaseBlockers(s, caseRow) {
  const out = [];
  for (const [index, action] of (caseRow?.specialistActions || []).entries()) {
    if (!['restriction','retraining'].includes(action.kind)) continue;
    const rows = profilesFor(s,caseRow?.techId,caseRow?.storeId).filter(r => r.holds?.some(h => h.id === action.qualificationHoldId));
    const row = rows.length === 1 ? rows[0] : undefined;
    const hold = row?.holds?.find(h => h.id === action.qualificationHoldId);
    const label = action.kind === 'restriction' ? '限制接单' : '复训';
    if (!hold || row.storeId !== caseRow.storeId || hold.source?.caseId !== caseRow.id || hold.source?.actionIndex !== index) { out.push(`${label}专项尚未关联匹配的资格暂停记录`); continue; }
    const evidence = restorationEvidence(row, hold);
    if (hold.status !== 'resolved' || !hold.resolution || !evidence || hold.resolution.assessmentId !== evidence.assessment.id || hold.resolution.grantId !== evidence.grant.id || !Number.isFinite(hold.resolution.at) || hold.resolution.at < evidence.grant.review.at || unresolvedImpacts(s, row, hold).length) out.push(`${label}专项 ${hold.id} 尚未完成复训、授权及恢复`);
  }
  return out;
}
function audit(s, row, actor, type, reason, ctx, details = {}) {
  row.version++; row.updatedAt = s.now;
  row.history.push({at:s.now, action:type, reason, version:row.version, by:by(actor), ...clone(details)});
  ctx?.log?.(row, `技师资格 ${type} · ${row.techId}`);
}
export function qualificationCommand(s, actor, type, p, ctx) {
  if (!COMMANDS.has(type)) fail(ctx, '不支持的资格操作');
  const person = techFor(s, p.techId), storeId = p.storeId || person?.storeId, existing = profileFor(s, p.techId, storeId, p.profileId);
  const tech = person && {...person,storeId};
  if (!tech || !canRead(actor, tech) || actor.role === 'tech' || (!existing && (profilesFor(s,p.techId,storeId).length || storeId !== person.storeId || p.profileId || person.qualificationProfileId))) fail(ctx, '技师不存在、归属待核对或当前身份无权处理');
  if (['qualification.review','qualification.resume'].includes(type) && !groupOperations(actor)) fail(ctx, '仅集团运营或管理员可以审核授权及恢复资格');
  if (['qualification.assess','qualification.request'].includes(type) && !(local(actor, tech.storeId) || groupOperations(actor))) fail(ctx, '当前岗位只能查看或暂停资格，不能登记考核与申请授权');
  const requestId = text(p.requestId, '本次提交标识', ctx, 300), actorKey = fingerprint(by(actor)), digest = fingerprint({type,p});
  const prior = (s.techQualificationRequests || []).find(x => x.requestId === requestId && x.actor === actorKey);
  if (prior) { if (prior.fingerprint !== digest) fail(ctx, '同一提交标识不能用于不同操作或内容'); return profileFor(s, prior.techId, prior.storeId || storeId, prior.profileId); }
  const evidenceRefs = qualificationEvidenceRefs(p.evidenceRefs,ctx);
  if (evidenceRefs.length) {
    if (uniqueEvidence(s.techs,p.techId,'原技师') !== person || (existing && uniqueEvidence(s.techQualifications,existing.id,'原资格档案') !== existing)) fail(ctx,'原资格来源已变化');
    uniqueEvidence(s.stores,storeId,'原资格门店');
    if(!existing&&(s.techQualifications||[]).some(item=>item.id===person.id))fail(ctx,'新资格档案编号已占用');
    if(type==='qualification.request')evidenceSource(existing,'assessment',p.assessmentId);
    if(type==='qualification.review')evidenceSource(existing,'request',p.grantId);
    if(type==='qualification.resume'||(type==='qualification.assess'&&p.holdId))uniqueEvidence(existing?.holds,p.holdId,'原资格暂停');
    if(type==='qualification.pause'&&p.caseId){const original=uniqueEvidence(s.serviceCareCases,p.caseId,'原质量反馈');uniqueEvidence(s.bookings,original.bookingId,'原反馈预约');}
    if (typeof ctx?.validateEvidenceRefs !== 'function' || ctx.validateEvidenceRefs(clone(evidenceRefs)) !== true) fail(ctx,'新增资格凭证尚未通过实际文件核验');
  }
  checkVersion(p.version, existing?.version || 0, ctx);
  const reason = text(p.reason, '处理依据', ctx);
  if (!existing && !['qualification.assess','qualification.pause'].includes(type)) fail(ctx, '请先建立考核或暂停记录');
  const row = existing || {id:tech.id,techId:tech.id,storeId:tech.storeId,version:0,assessments:[],grants:[],holds:[],history:[],createdAt:s.now};
  let details = {};
  const id = prefix => ctx?.id ? ctx.id(prefix) : `${prefix}${++s.seq}`;
  if (type === 'qualification.assess') {
    const serviceIds = projects(s,tech,p.serviceIds,ctx), occurredAt = date(p.occurredAt,ctx);
    if (occurredAt > s.now) fail(ctx, '不能登记尚未发生的考核');
    if (!['pass','fail'].includes(p.result) || !['initial','mature','retraining'].includes(p.kind)) fail(ctx, '请选择有效的考核类型和结果');
    const assessment = {serviceIds,occurredAt,result:p.result,kind:p.kind,batch:text(p.batch,'培训或审核批次',ctx,150),assessor:text(p.assessor,'实际考核人',ctx,80),proof:text(p.proof,'考核凭证编号',ctx,200),reason,holdId:p.holdId || null,createdAt:s.now,createdBy:by(actor),sequence:row.version + 1};
    if (p.kind === 'retraining') {
      const hold = row.holds.find(h => h.id === p.holdId && h.status === 'open');
      if (!hold || occurredAt < hold.startedAt || !hold.serviceIds.every(x => serviceIds.includes(x))) fail(ctx, '复训须关联未恢复暂停，发生于暂停后并覆盖全部暂停项目');
    } else if (p.holdId) fail(ctx, '只有复训考核可以关联暂停记录');
    if (evidenceRefs.length) {assessment.evidenceRefs = clone(evidenceRefs);assessment.evidenceVersion=row.version+1;}
    assessment.id = id('QA'); row.assessments.push(assessment); details = {assessmentId:assessment.id};
  } else if (type === 'qualification.request') {
    const assessment = row.assessments.find(x => x.id === p.assessmentId);
    if (!assessment || assessment.result !== 'pass') fail(ctx, '仅考核通过的记录可以申请独立授权');
    if (row.grants.some(g => g.assessmentId === assessment.id)) fail(ctx, '该考核已申请授权；驳回后请补充新的考核记录');
    if (assessment.holdId && !row.holds.some(h => h.id === assessment.holdId && h.status === 'open')) fail(ctx, '关联暂停已结束，不能再次申请复训授权');
    projects(s,tech,assessment.serviceIds,ctx);
    const grant = {id:id('QG'),assessmentId:assessment.id,serviceIds:[...assessment.serviceIds],status:'pending',requestedAt:s.now,requestedBy:by(actor),reason,review:null}; if(evidenceRefs.length){grant.evidenceRefs=clone(evidenceRefs);grant.evidenceVersion=row.version+1;} row.grants.push(grant); details = {grantId:grant.id};
  } else if (type === 'qualification.review') {
    const grant = row.grants.find(x => x.id === p.grantId);
    if (!grant || grant.status !== 'pending') fail(ctx, '仅待审核的授权申请可以处理');
    if (!['approve','reject'].includes(p.decision)) fail(ctx, '请选择有效审核决定');
    const review = {decision:p.decision,reviewer:text(p.reviewer,'集团审核人',ctx,80),proof:text(p.proof,'授权审核凭据',ctx,200),reason,at:s.now,by:by(actor)};
    if (evidenceRefs.length) {review.evidenceRefs = clone(evidenceRefs);review.evidenceVersion=row.version+1;}
    if (p.decision === 'approve') {
      const credentials = currentCredentials(s,tech,grant.serviceIds); if (credentials) fail(ctx, credentials);
      const assessment = row.assessments.find(x => x.id === grant.assessmentId);
      if (!assessment || assessment.result !== 'pass' || !grant.serviceIds.every(x => assessment.serviceIds.includes(x))) fail(ctx, '考核依据无效，请核对申请');
      if (assessment.holdId && !row.holds.some(h => h.id === assessment.holdId && h.status === 'open')) fail(ctx, '关联暂停已结束，不能批准过期的复训申请');
    }
    grant.status = p.decision === 'approve' ? 'approved' : 'rejected'; grant.review = review; details = {grantId:grant.id,decision:p.decision};
  } else if (type === 'qualification.pause') {
    const serviceIds = projects(s,tech,p.serviceIds,ctx), owner = text(p.owner,'复训负责人',ctx,80);
    let source = null, caseRow = null, action = null;
    if (p.caseId) {
      caseRow = (s.serviceCareCases || []).find(c => c.id === p.caseId);
      if (!caseRow || caseRow.techId !== tech.id || caseRow.storeId !== row.storeId || !Number.isInteger(Number(p.actionIndex)) || p.actionIndex === '' || p.actionIndex == null || Number(p.actionIndex) < 0) fail(ctx, '反馈来源不存在或不属于本技师及门店');
      checkVersion(p.caseVersion,caseRow.version,ctx); action = caseRow.specialistActions?.[Number(p.actionIndex)];
      if (!action || !['restriction','retraining'].includes(action.kind) || action.qualificationHoldId) fail(ctx, '请选择尚未关联的限制接单或复训专项');
      const b = (s.bookings || []).find(b => b.id === caseRow.bookingId);
      if (!b || b.techId !== tech.id || b.storeId !== row.storeId || !serviceIds.includes(b.serviceId)) fail(ctx, '暂停项目须包含来源预约的实际服务项目');
      source = {caseId:caseRow.id,actionIndex:Number(p.actionIndex),caseVersion:caseRow.version};
    } else if (p.actionIndex != null || p.caseVersion != null) fail(ctx, '缺少反馈来源编号');
    const impacts = qualificationImpacts(s,tech.id,serviceIds);
    const hold = {id:id('QH'),serviceIds,status:'open',owner,reason,startedAt:s.now,sequence:row.version + 1,createdBy:by(actor),source,affectedBookingIds:impacts.filter(x => x.needsCoordination).map(x => x.bookingId),impacts:clone(impacts),resolution:null};
    if(evidenceRefs.length){hold.evidenceRefs=clone(evidenceRefs);hold.evidenceVersion=row.version+1;}
    row.holds.push(hold); details = {holdId:hold.id};
    if (caseRow) { action.qualificationHoldId = hold.id; caseRow.version++; caseRow.updatedAt=s.now; (caseRow.history ??= []).push({at:s.now,action:'关联资格暂停',by:by(actor),version:caseRow.version,qualificationHoldId:hold.id,actionIndex:source.actionIndex}); }
  } else if (type === 'qualification.resume') {
    const hold = row.holds.find(x => x.id === p.holdId);
    if (!hold || hold.status !== 'open') fail(ctx, '暂停记录不存在或已经恢复');
    const reviewer = text(p.reviewer,'恢复审核人',ctx,80), evidence = restorationEvidence(row,hold);
    if (!evidence) fail(ctx, '须完成该次暂停后的复训考核和对应集团授权，再明确恢复');
    const credentials = currentCredentials(s,tech,hold.serviceIds); if (credentials) fail(ctx,credentials);
    const impacts = unresolvedImpacts(s,row,hold); if (impacts.length) fail(ctx, `请先协调受影响的未开始预约或待确认变更：${impacts.map(x => x.bookingId).join('、')}`);
    hold.status='resolved'; hold.resolution={assessmentId:evidence.assessment.id,grantId:evidence.grant.id,reviewer,reason,at:s.now,by:by(actor)}; details={holdId:hold.id};
    if(evidenceRefs.length){hold.resolution.evidenceRefs=clone(evidenceRefs);hold.resolution.evidenceVersion=row.version+1;}
  }
  upgradeQualifications(s); if (!existing) s.techQualifications.push(row);
  if(evidenceRefs.length)details.evidenceRefs=clone(evidenceRefs);
  audit(s,row,actor,type,reason,ctx,details);
  s.techQualificationRequests.push({actor:actorKey,requestId,fingerprint:digest,techId:row.techId,storeId:row.storeId,profileId:row.id,at:s.now,...(evidenceRefs.length?{evidenceVersion:row.version}:{})});
  return row;
}
export function qualificationView(s, actor, selection) {
  actor=resolveAccountActor(s,actor);
  let selected;
  if(selection!==undefined){
    const valid=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(x);
    if(!selection||Object.keys(selection).some(k=>!['techId','profileId','storeId'].includes(k))||!['techId','profileId','storeId'].every(k=>valid(selection[k])))fail(null,'资格档案来源不存在或已失效');
    const people=(s.techs || []).filter(t=>t.id===selection.techId),profiles=(s.techQualifications || []).filter(p=>p.id===selection.profileId),stores=(s.stores || []).filter(r=>r.id===selection.storeId);
    if(people.length!==1||profiles.length!==1||stores.length!==1||profiles[0].techId!==selection.techId||profiles[0].storeId!==selection.storeId||profileFor(s,selection.techId,selection.storeId,selection.profileId)!==profiles[0])fail(null,'资格档案来源不存在或已失效');
    selected={...people[0],storeId:profiles[0].storeId};
    if(!canAccountView(actor,'qualifications')||!canRead(actor,selected))fail(null,'当前身份无权查看原资格档案');
  }
  const technicians = (selected?[selected]:(s.techs || []).filter(t => canRead(actor,t))).map(t => {
    const row = selection?profileFor(s,t.id,selection.storeId,selection.profileId):profileFor(s,t.id), staff = actor.role !== 'tech';
    const assessments = clone(row?.assessments || []), grants = clone(row?.grants || []), holds = clone(row?.holds || []);
    for (const hold of holds) { hold.currentImpacts = qualificationImpacts(s,t.id,hold.serviceIds); hold.unresolvedImpacts = row ? unresolvedImpacts(s,row,hold) : []; hold.readyForResume = hold.status === 'open' && Boolean(restorationEvidence(row,hold)) && !currentCredentials(s,t,hold.serviceIds) && !hold.unresolvedImpacts.length; }
    if (!staff) { for (const a of assessments) { delete a.proof; delete a.createdBy; delete a.evidenceRefs; } for (const g of grants) { delete g.requestedBy; delete g.evidenceRefs; if(g.review){delete g.review.proof; delete g.review.by; delete g.review.evidenceRefs;} } for (const h of holds) { delete h.createdBy; delete h.evidenceRefs; delete h.impacts; delete h.currentImpacts; delete h.unresolvedImpacts; delete h.affectedBookingIds; if(h.resolution){delete h.resolution.by; delete h.resolution.evidenceRefs;} } }
    return {id:t.id,profileId:row?.id || null,techId:t.id,name:t.name,storeId:t.storeId,storeName:(s.stores || []).find(x=>x.id===t.storeId)?.name || t.storeId,version:row?.version || 0,hasProfile:Boolean(row),legacy:!row && !t.qualificationRequired,serviceIds:[...(t.serviceIds || [])],services:(t.serviceIds || []).map(id=>({id,name:(s.services || []).find(x=>x.id===id)?.name || id,...qualificationEligibility(s,t.id,id,s.now,t.storeId,row?.id)})),assessments,grants,holds,history:staff ? clone(row?.history || []) : (row?.history || []).map(h=>({at:h.at,action:h.action})),impacts:staff ? qualificationImpacts(s,t.id,t.serviceIds) : [],canAssess:local(actor,t.storeId)||groupOperations(actor),canRequest:local(actor,t.storeId)||groupOperations(actor),canReview:groupOperations(actor),canPause:staff,canResume:groupOperations(actor)};
  });
  return {technicians,canRead:['tech','store','manager'].includes(actor?.role)||groupOperations(actor)||groupSupport(actor)};
}
