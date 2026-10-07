import { qualificationEligibility } from './tech-qualification.mjs';
import { lifecyclePauseEligibility, lifecyclePauseSelection } from './organization-lifecycle-pause.mjs';
import { storeOpeningReadiness } from './management.mjs';

const clone = value => structuredClone(value);
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key,canonical(value[key])])) : value;
const signature = value => JSON.stringify(canonical(value));
const unique = (rows,id) => { const matches=(rows || []).filter(x=>x.id===id); return matches.length===1 ? matches[0] : null; };
const denied = reason => ({allowed:false,reason,continuation:false});
const validTime = value => Number.isSafeInteger(value) && value >= 0;
const endOfDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') && Number.isFinite(Date.parse(value+'T00:00:00Z')) && new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value ? Date.parse(value+'T23:59:59.999+08:00') : NaN;
function fail(ctx,message) { ctx?.fail?.(message); throw new Error(message); }
const caseSource = c => ({id:c.id,kind:c.kind,techId:c.techId,fromStoreId:c.fromStoreId,toStoreId:c.toStoreId,effectiveAt:c.effectiveAt,createdAt:c.createdAt,reference:c.reference});

function acceptedFacts(s,b) {
  if (!b || !['confirmed','active','interrupted','done'].includes(b.status)) return null;
  const round=b.round, income=b.techIncomeSnapshot;
  if (!round?.id || !validTime(round.completedAt) || round.completedAt>s.now || !(round.startedAt<=round.completedAt && round.completedAt<round.deadline)) return null;
  const original=unique(b.rounds,round.id);
  if (!original || original.completedAt!==round.completedAt || original.startedAt!==round.startedAt || original.deadline!==round.deadline) return null;
  if (!income?.id || income.bookingId!==b.id || income.techId!==b.techId || income.storeId!==b.storeId || !validTime(income.capturedAt) || income.capturedAt>round.completedAt) return null;
  const incomeOriginal=unique(b.techIncomeSnapshots,income.id);
  if (!incomeOriginal || signature(incomeOriginal)!==signature(income)) return null;
  if (!(b.events || []).some(e=>e.at===round.completedAt && e.text==='预约已确认')) return null;
  return {bookingId:b.id,techId:b.techId,storeId:b.storeId,serviceId:b.serviceId,startAt:b.startAt,duration:b.duration,roundId:round.id,acceptedAt:round.completedAt,incomeSnapshotId:income.id,incomeCapturedAt:income.capturedAt,incomeSource:signature(income)};
}
function qualificationSource(s,b,acceptedAt,profileId) {
  const tech=unique(s.techs,b.techId);
  if (!tech) return null;
  const rows=(s.techQualifications || []).filter(r=>r.techId===b.techId && r.storeId===b.storeId);
  const selectedId=profileId || (tech.storeId===b.storeId ? tech.qualificationProfileId : null);
  const row=selectedId ? unique(rows,selectedId) : rows.length===1 ? rows[0] : null;
  if (!row) {
    const ids=tech.legacyQualifiedServiceIds || tech.serviceIds || [];
    if (rows.length || selectedId || tech.qualificationRequired || tech.storeId!==b.storeId || !ids.includes(b.serviceId)) return null;
    return {legacy:true,storeId:b.storeId,serviceId:b.serviceId,legacyServiceIds:[...ids]};
  }
  const grants=(row.grants || []).filter(g=>g.status==='approved' && g.serviceIds?.includes(b.serviceId) && validTime(g.review?.at) && g.review.at<=acceptedAt).sort((a,z)=>z.review.at-a.review.at);
  for (const grant of grants) {
    const assessment=unique(row.assessments,grant.assessmentId);
    if (!assessment || assessment.result!=='pass' || !assessment.serviceIds?.includes(b.serviceId) || !validTime(assessment.createdAt) || !validTime(assessment.occurredAt) || assessment.occurredAt>assessment.createdAt || assessment.createdAt>grant.review.at) continue;
    return {legacy:false,storeId:b.storeId,profileId:row.id,serviceId:b.serviceId,grantId:grant.id,assessmentId:assessment.id,source:signature({grant,assessment})};
  }
  return null;
}
function sourceMatches(s,b,source) {
  if (!source || source.storeId!==b.storeId || source.serviceId!==b.serviceId) return false;
  const tech=unique(s.techs,b.techId);
  if (source.legacy) return Boolean(tech && source.legacyServiceIds?.includes(b.serviceId) && signature(source.legacyServiceIds)===signature(tech.legacyQualifiedServiceIds || tech.serviceIds || []));
  const row=unique((s.techQualifications || []).filter(r=>r.techId===b.techId && r.storeId===b.storeId),source.profileId);
  const grant=unique(row?.grants,source.grantId),assessment=unique(row?.assessments,source.assessmentId);
  return Boolean(grant && assessment && grant.status==='approved' && signature({grant,assessment})===source.source);
}
function acceptedBasis(s,b) {
  const facts=acceptedFacts(s,b);
  if (!facts) return null;
  const snapshot=b.technicianAssignmentSnapshot;
  if (snapshot) return signature(snapshot.facts)===signature(facts) && sourceMatches(s,b,snapshot.qualification) ? {facts,qualification:clone(snapshot.qualification)} : null;
  const qualification=qualificationSource(s,b,facts.acceptedAt);
  return qualification ? {facts,qualification} : null;
}

// Called after the real confirmation event, never during reads or transfer.
export function captureTechnicianAssignment(s,b,ctx={}) {
  const facts=acceptedFacts(s,b),qualification=facts && qualificationSource(s,b,facts.acceptedAt);
  if (!facts || !qualification) fail(ctx,'原接单轮次、提成或项目授权来源缺失，须核对后再确认');
  const snapshot={id:ctx.id ? ctx.id('TAS') : `TAS${++s.seq}`,recordedAt:s.now,facts,qualification};
  b.technicianAssignmentSnapshot=snapshot;
  (b.technicianAssignmentSnapshots ??=[]).push(clone(snapshot));
  return snapshot;
}

export function applyTechnicianTransfer(s,c,ctx={}) {
  if (!c?.id || unique(s.organizationLifecycleCases,c.id)!==c || c.kind!=='transfer' || !validTime(c.effectiveAt) || !validTime(c.createdAt) || c.createdAt>c.effectiveAt || !c.reference || !c.reason || !Number.isSafeInteger(c.version)) fail(ctx,'调店记录或原生效来源无效');
  const tech=unique(s.techs,c.techId),from=unique(s.stores,c.fromStoreId),to=unique(s.stores,c.toStoreId);
  if (c.assignmentAppliedAt!=null) {
    if (!tech || tech.storeId!==c.toStoreId || signature(caseSource(c))!==c.assignmentSource || !unique(s.techQualifications,tech.qualificationProfileId)) fail(ctx,'原调店所属或资格来源已变化，须核对');
    return c;
  }
  if (c.stage!=='planned' || c.status!=='planned' || c.effectiveAt>s.now || !tech || !from || !to || from.id===to.id || tech.storeId!==from.id || !tech.active || tech.reviewStatus!=='approved' || ['departure','left'].includes(tech.lifecycleStatus) || ['closing','closed'].includes(to.lifecycleStatus) || to.closedAt!=null) fail(ctx,'调店未到期、原所属或目标门店状态已变化，须核对原计划');
  const continuations=[],coordination=[];
  for (const b of s.bookings || []) {
    const current=b.techId===tech.id && b.storeId===from.id && ['unpaid','waiting','confirmed','active','interrupted'].includes(b.status);
    const proposed=b.change?.status==='pending' && b.change.techId===tech.id;
    if (current) {
      const basis=acceptedBasis(s,b);
      if (basis && basis.facts.acceptedAt<=c.effectiveAt) continuations.push({...basis,recordedAt:s.now});
      else coordination.push({bookingId:b.id,kind:'original',reason:'原单未接或原接受及授权来源缺失，须沿原流程协调'});
    }
    if (proposed) coordination.push({bookingId:b.id,kind:'proposed',changeId:b.change.id,reason:'拟安排仍须按原流程协调，不能承接原接单授权'});
  }
  const profile={id:ctx.id ? ctx.id('TQP') : `TQP${++s.seq}`,techId:tech.id,storeId:to.id,version:0,assessments:[],grants:[],holds:[],history:[],createdAt:s.now,assignmentCaseId:c.id};
  if (!profile.id || (s.techQualifications || []).some(r=>r.id===profile.id)) fail(ctx,'新店资格编号已存在，须核对');
  // Freeze legacy scope before ending original affiliation. No approval is copied.
  if (!tech.qualificationRequired && !Object.hasOwn(tech,'legacyQualifiedServiceIds')) tech.legacyQualifiedServiceIds=[...(tech.serviceIds || [])];
  (s.techQualifications ??=[]).push(profile);
  tech.storeId=to.id; tech.qualificationRequired=true; tech.qualificationProfileId=profile.id; tech.version=(tech.version || 0)+1;
  c.assignmentContinuations=continuations; c.assignmentCoordination=coordination; c.assignmentAppliedAt=s.now; c.assignmentSource=signature(caseSource(c));
  return c;
}

function transferredBasis(s,b) {
  for (const c of s.organizationLifecycleCases || []) {
    if (c.kind!=='transfer' || !['effective','completed'].includes(c.stage) || !['effective','completed'].includes(c.status) || c.techId!==b.techId || c.fromStoreId!==b.storeId || !validTime(c.assignmentAppliedAt) || c.assignmentAppliedAt>s.now || c.effectiveAt>s.now || c.assignmentSource!==signature(caseSource(c))) continue;
    const records=(c.assignmentContinuations || []).filter(r=>r.facts?.bookingId===b.id);
    const record=records.length===1 ? records[0] : null,facts=acceptedFacts(s,b);
    if (!record || !facts || facts.acceptedAt>c.effectiveAt || signature(record.facts)!==signature(facts) || !sourceMatches(s,b,record.qualification)) continue;
    let storeId=c.toStoreId;
    for (const later of (s.organizationLifecycleCases || []).filter(x=>x.kind==='transfer' && x.techId===b.techId && ['effective','completed'].includes(x.stage) && x.assignmentAppliedAt>=c.assignmentAppliedAt && x.id!==c.id).sort((a,z)=>a.assignmentAppliedAt-z.assignmentAppliedAt)) {
      if (later.fromStoreId===storeId && later.assignmentSource===signature(caseSource(later))) storeId=later.toStoreId;
    }
    if (unique(s.techs,b.techId)?.storeId===storeId) return record;
  }
  return null;
}
function lifecycleOriginal(s,b,kind,scopeKey,scopeId,basis,startedAt) {
  if (!basis || !validTime(startedAt) || basis.facts.acceptedAt>startedAt) return false;
  return (s.organizationLifecycleCases || []).some(c=>c.kind===kind && c[scopeKey]===scopeId && c.effectiveAt===startedAt && ['effective','completed'].includes(c.stage) && ['effective','completed'].includes(c.status) && c.createdAt<=s.now && c.effectiveAt<=s.now);
}
export function technicianAssignmentEligibility(s,techId,storeId,at=s.now,bookingId,serviceId,selection={}) {
  const tech=unique(s.techs,techId),store=unique(s.stores,storeId),b=bookingId ? unique(s.bookings,bookingId) : null;
  serviceId ??= b?.serviceId;
  if (!tech || !store || !validTime(at) || !tech.active || !tech.serviceIds?.includes(serviceId) || !store.serviceIds?.includes(serviceId)) return denied('技师不属于本店、项目不匹配、资质已到期或当前不可用');
  if (store.lifecycleStatus==='closed' || store.closedAt!=null || tech.lifecycleStatus==='left') return denied('门店已关闭或技师已离职，不能使用工作指派');
  if ((tech.reviewStatus!=null || tech.qualificationRequired) && tech.reviewStatus!=='approved') return denied('请先完成集团资料审核，并保持人员在岗');
  if (tech.validUntil!=null && !(endOfDate(tech.validUntil)>=Math.max(s.now,at))) return denied('技师资质已到期或有效期无效，待审核续期');
  const exact=Boolean(b && b.techId===techId && b.storeId===storeId && b.serviceId===serviceId),basis=exact ? acceptedBasis(s,b) : null,transfer=exact ? transferredBasis(s,b) : null;
  const differentAssignment=exact && b.technicianAssignmentSnapshot && tech.qualificationProfileId && b.technicianAssignmentSnapshot.qualification?.profileId!==tech.qualificationProfileId;
  let continuation=Boolean(transfer);
  if (tech.storeId!==storeId || differentAssignment) {
    if (!transfer) return denied('技师不属于本店或已调店，原单未接或原接受及资格来源待核对，请协调原安排');
  }
  const pauseContext={storeOpeningReadiness};
  const service=(s.services || []).find(x=>x.id===serviceId);
  const originalMinutes=exact ? b.duration+(b.extensions || []).filter(x=>['success','unpaid','processing','failed'].includes(x.status)).reduce((n,x)=>n+x.duration,0) : service?.duration;
  const pause=selection.selectionPending===true ? null : lifecyclePauseEligibility(s,storeId,{startAt:at,endAt:selection.endAt??at+originalMinutes*60000,bookingId:exact?b.id:undefined},pauseContext);
  const originalDuringPause=Boolean(pause?.continuationCandidate && (basis || transfer));
  if (pause?.blocked && !originalDuringPause) return denied(pause.reason);
  if (originalDuringPause) continuation=true;
  if (store.lifecycleStatus==='closing') {
    if (!exact || !lifecycleOriginal(s,b,'store-close','storeId',store.id,basis || transfer,store.closingAt)) return denied('门店正在关停，不能接受新预约或缺源原安排');
    continuation=true;
  } else if (!store.active && !originalDuringPause && !(selection.selectionPending===true ? lifecyclePauseSelection(s,storeId,pauseContext).bookable : pause?.canBookOutsideWhilePaused)) return denied('门店当前不可营业');
  if (tech.lifecycleStatus==='departure') {
    if (!exact || !lifecycleOriginal(s,b,'departure','techId',tech.id,basis || transfer,tech.departureStartedAt)) return denied('技师正在离职办理，不能接受新单或缺源原安排');
    continuation=true;
  }
  const qualification=qualificationEligibility(s,techId,serviceId,at,storeId,continuation ? (basis || transfer)?.qualification.profileId : undefined);
  // Original Q03 keeps genuine begun fulfillment; an arbitrary continuing flag
  // or the mere booking id cannot manufacture that exception.
  const begunAt=exact && Boolean(basis || transfer) ? [b.departedAt,b.arrivedAt,b.startedAt].filter(t=>validTime(t) && t>=b.round.completedAt && t<=s.now).sort((a,z)=>a-z)[0] : undefined;
  const holds=(s.techQualifications || []).filter(r=>r.techId===techId).flatMap(r=>(r.holds || []).filter(h=>h.status==='open' && h.serviceIds?.includes(serviceId)));
  const begun=validTime(begunAt) && holds.every(h=>validTime(h.startedAt) && begunAt<=h.startedAt);
  if (!qualification.allowed && !(begun && qualification.reason.includes('资格已暂停')) && !(continuation && qualification.reason.includes('尚未获') && sourceMatches(s,b,(basis || transfer)?.qualification))) return denied(qualification.reason);
  return {allowed:true,reason:'',continuation};
}
