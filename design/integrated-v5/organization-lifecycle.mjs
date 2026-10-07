// Organization changes use the original reduce transaction. Reads never apply plans.
import { resolveAccountActor, actorAccountFields } from './staff-accounts.mjs';
import { deactivateServicePromoter, closeStoreServicePromoters } from './service-promotion.mjs';
import { lifecycleImpact, lifecycleFingerprint, captureLifecycleResponsibilities, lifecycleCaseImpact } from './organization-lifecycle-projection.mjs';
import { privacyUseClosed } from './privacy.mjs';
import { careBlocksBooking } from './service-care.mjs';
import { fulfilmentEndingSource } from './fulfilment.mjs';
import { LIFECYCLE_PAUSE_COMMANDS, canPauseStore, applyLifecyclePause, syncLifecyclePauses, supersedeLifecyclePauses } from './organization-lifecycle-pause.mjs';
export { lifecyclePauseImpact, lifecyclePauseView, lifecyclePauseEligibility, assertLifecycleStoreStatus } from './organization-lifecycle-pause.mjs';

const clone = value => structuredClone(value);
const fingerprint = lifecycleFingerprint;
const operations = a => a?.role === 'group' && (!a.job || ['all','operations'].includes(a.job));
const administrator = a => a?.role === 'group' && a.job === 'account-admin' && a.accountId && a.sessionId;
const actions = new Set(['lifecycle.identity-link','lifecycle.transfer-plan','lifecycle.departure-start','lifecycle.store-close-start','lifecycle.cancel-plan','lifecycle.complete',...LIFECYCLE_PAUSE_COMMANDS]);
const by = a => ({role:a.role,job:a.job || null,id:a.techId || a.storeId || a.userId || a.accountId || 'group',...actorAccountFields(a)});
function fail(ctx,message) { ctx?.fail?.(message); throw new Error(message); }
function text(value,label,ctx,max=1000) { if (typeof value !== 'string' || !value.trim() || value.trim().length > max) fail(ctx,`请填写${label}`); return value.trim(); }
function integer(value,label,ctx) { if (!['number','string'].includes(typeof value) || !String(value).trim() || !Number.isSafeInteger(Number(value)) || Number(value)<0) fail(ctx,`${label}无效`); return Number(value); }
function date(value,label,ctx) {
  if (typeof value === 'number') { if (!Number.isSafeInteger(value) || value<0 || !Number.isFinite(new Date(value).getTime())) fail(ctx,`${label}无效`); return value; }
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?$/.exec(String(value || ''));
  if (!m || +m[2]<1 || +m[2]>12 || +m[3]<1 || +m[3]>new Date(Date.UTC(+m[1],+m[2],0)).getUTCDate() || +m[4]>23 || +m[5]>59 || +(m[6] || 0)>59) fail(ctx,`${label}无效`);
  const out=Date.parse(m[7]?value:value+'+08:00'); if (!Number.isSafeInteger(out)) fail(ctx,`${label}无效`); return out;
}
function unique(rows,id,label,ctx) { const found=(rows || []).filter(x=>x.id===id); if (typeof id!=='string' || found.length!==1) fail(ctx,`${label}不存在或来源不唯一`); return found[0]; }
function version(row,value,ctx) { if (integer(value,'原资料版本',ctx)!==row.version) fail(ctx,'原资料已更新，请刷新核对'); }
function nextId(s,ctx,prefix) { return ctx?.id ? ctx.id(prefix) : prefix+(++s.seq); }
function currentImpact(s,scope,p,ctx) { const impact=lifecycleImpact(s,scope,{goodsSummary:ctx.goodsSummary}); if (typeof p.sourceToken!=='string' || p.sourceToken!==impact.sourceToken) fail(ctx,'原影响事项已变化，请刷新核对后重试'); return impact; }
function audit(s,row,a,action,reason,ctx,details={}) { row.version++; row.updatedAt=s.now; (row.history ??=[]).push({at:s.now,action,reason,by:by(a),version:row.version,...clone(details)}); ctx?.log?.(row,`组织办理 ${action} · ${row.id}`); }
function activeCases(s,key,id) { return (s.organizationLifecycleCases || []).filter(c=>c[key]===id && !['cancelled','completed'].includes(c.stage)); }
function stopPromoters(s,techId,reason,ctx,a) { for (const r of s.servicePromoters || []) if (r.personKind==='tech' && r.personId===techId && r.status==='active') deactivateServicePromoter(s,r.id,reason,ctx,a,false); }

function legacyFingerprint(value) {
  if (typeof value!=='string'||!value.startsWith('{')&&!value.startsWith('[')) return value;
  try { return fingerprint(JSON.parse(value)); } catch { return value; }
}
function replaceLegacyTokens(value) {
  if (!value||typeof value!=='object') return;
  if (typeof value.sourceToken==='string') value.sourceToken=legacyFingerprint(value.sourceToken);
  for (const child of Object.values(value)) if (child&&typeof child==='object') replaceLegacyTokens(child);
}

export function upgradeOrganizationLifecycle(s) {
  s.organizationLifecycleCases ??=[]; s.organizationLifecycleRequests ??=[]; s.organizationIdentityLinks ??=[];
  for (const row of s.organizationLifecycleRequests) {
    row.actorKey=legacyFingerprint(row.actorKey);row.signature=legacyFingerprint(row.signature);
    replaceLegacyTokens(row.result);
  }
  for (const row of s.organizationLifecycleCases) replaceLegacyTokens(row.impactSnapshot);
  return s;
}

export function lifecycleCommand(s,rawActor,type,p={},ctx={}) {
  if (!actions.has(type)) fail(ctx,'当前组织办理动作尚未接齐，请从原来源继续办理');
  const a=resolveAccountActor(s,rawActor);
  const pause=LIFECYCLE_PAUSE_COMMANDS.includes(type),pauseStoreId=p.storeId||(s.organizationLifecycleCases||[]).find(c=>c.id===p.id)?.storeId;
  if (pause ? !canPauseStore(a,pauseStoreId) || ['lifecycle.store-pause-emergency','lifecycle.store-resume'].includes(type)&&!operations(a) : type==='lifecycle.identity-link' ? !administrator(a) : !operations(a)) fail(ctx,'当前岗位无权办理该组织变更');
  upgradeOrganizationLifecycle(s);
  const requestId=text(p.requestId,'稳定提交标识',ctx,300),actorKey=fingerprint(by(a)),signature=fingerprint({type,p});
  const previous=s.organizationLifecycleRequests.find(x=>x.actorKey===actorKey && x.requestId===requestId);
  if (previous) { if (previous.signature!==signature) fail(ctx,'同一提交标识不能用于不同内容'); return clone(previous.result); }
  const reason=text(p.reason,'办理依据',ctx); let result;
  if (pause) result=applyLifecyclePause(s,a,type,p,ctx);
  else if (type==='lifecycle.identity-link') {
    const t=unique(s.techs,p.techId,'技师',ctx),u=unique(s.users,p.userId,'本人普通用户',ctx); version(t,p.version,ctx);
    if (privacyUseClosed(s,u.id)) fail(ctx,'普通用户使用已关闭或关闭依据待核对，不能建立新本人映射');
    if (t.userId || (s.techs || []).some(x=>x.id!==t.id && x.userId===u.id) || s.organizationIdentityLinks.some(x=>x.techId===t.id || x.userId===u.id)) fail(ctx,'已有本人关联或来源冲突，不能静默重绑');
    const occurredAt=date(p.occurredAt,'本人关联核验发生时间',ctx); if (occurredAt>s.now) fail(ctx,'本人核验尚未发生');
    const r={id:nextId(s,ctx,'OLI'),techId:t.id,userId:u.id,reference:text(p.reference,'明确本人核验来源',ctx,200),occurredAt,createdAt:s.now,createdBy:by(a),reason,version:1};
    s.organizationIdentityLinks.push(r); t.userId=u.id; t.identityLinkId=r.id; t.version++; ctx.log?.(t,'登记明确本人关联，原资金身份不变'); result=r;
  } else if (type==='lifecycle.cancel-plan') {
    const c=unique(s.organizationLifecycleCases,p.id,'原组织办理',ctx); version(c,p.version,ctx);
    if (c.stage!=='planned' || c.effectiveAt<=s.now && !c.effectBlockedReason) fail(ctx,'已经生效或已到可执行的生效时点，不能撤回原计划');
    currentImpact(s,c.techId?{techId:c.techId}:{storeId:c.storeId},p,ctx);
    c.stage='cancelled'; c.status='cancelled'; c.cancelledAt=s.now; audit(s,c,a,type,reason,ctx); result=c;
  } else if (type==='lifecycle.complete') {
    const c=unique(s.organizationLifecycleCases,p.id,'原组织办理',ctx);version(c,p.version,ctx);
    if(c.kind==='store-pause')fail(ctx,'停业案须从原恢复营业入口核验，不能使用组织清算完成');
    const view=lifecycleCompletionView(s,c.id,ctx);
    if(p.sourceToken!==view.sourceToken)fail(ctx,'原组织清算、协调或承接来源已变化，请刷新核对');
    if(!view.canComplete)fail(ctx,view.blockers.map(x=>x.reason).join('；')||'原组织事项尚未结齐');
    const receipt=ctx.applyLifecycleAuthorityExit(s,c,{...ctx,expectedAuthorityToken:view.authority.sourceToken,lifecycleCompletionImpact:view.impact});
    if(!receipt||receipt.caseId!==c.id||!['endedGrantIds','revokedSessionIds','retainedGrantIds'].every(k=>Array.isArray(receipt[k])))fail(ctx,'原工作权限退出未返回真实事务回执，不能完成');
    const subject=unique(c.kind==='store-close'?s.stores:s.techs,c.storeId||c.techId,'原组织主体',ctx);
    if(c.kind==='departure'){subject.lifecycleStatus='left';subject.leftAt=s.now;subject.active=false;subject.publicCredentialsVisible=false;subject.version++;}
    if(c.kind==='store-close'){subject.lifecycleStatus='closed';subject.closedAt=s.now;subject.active=false;subject.promotionDisabled=true;subject.version++;closeStoreServicePromoters(s,subject.id,ctx,a);}
    c.stage='completed';c.status='completed';c.completedAt=s.now;c.authorityReceipt=clone(receipt);c.completionSourceToken=view.sourceToken;
    audit(s,c,a,type,reason,ctx,{authorityReceipt:clone(receipt)});result=c;
  } else {
    const kind=type==='lifecycle.transfer-plan'?'transfer':type==='lifecycle.departure-start'?'departure':'store-close';
    const isTech=kind!=='store-close',subject=unique(isTech?s.techs:s.stores,isTech?p.techId:p.storeId,isTech?'技师':'门店',ctx); version(subject,p.version,ctx);
    if (activeCases(s,isTech?'techId':'storeId',subject.id).some(c=>kind!=='store-close'||c.kind!=='store-pause')) fail(ctx,'该主体已有未办结组织变更，请先处理原记录');
    if (isTech ? subject.lifecycleStatus==='left' : ['closing','closed'].includes(subject.lifecycleStatus)||subject.closedAt!=null) fail(ctx,'主体已离职或正在关闭，不能开启新的组织变更');
    const scope=isTech?{techId:subject.id}:{storeId:subject.id},impact=currentImpact(s,scope,p,ctx);
    const r={id:nextId(s,ctx,'OL'),kind,...scope,fromStoreId:isTech?subject.storeId:subject.id,toStoreId:null,effectiveAt:s.now,createdAt:s.now,updatedAt:s.now,createdBy:by(a),reference:text(p.reference,'组织办理来源',ctx,200),reason,version:0,stage:'effective',status:'effective',history:[],impactSnapshot:clone(impact)};
    if (kind==='transfer') {
      const destination=unique(s.stores,p.toStoreId,'目标门店',ctx); version(destination,p.targetVersion,ctx);
      if (destination.id===subject.storeId || ['closing','closed'].includes(destination.lifecycleStatus) || destination.closedAt!=null) fail(ctx,'请选择真实存在且未关停的其他门店');
      if (!subject.active || subject.reviewStatus!=='approved' || subject.lifecycleStatus==='departure') fail(ctx,'技师须在岗且资料已审，离职办理中不能计划调店');
      r.toStoreId=destination.id; r.effectiveAt=date(p.effectiveAt,'集团指定生效时间',ctx);
      if (r.effectiveAt<s.now) fail(ctx,'不能把新调店计划伪记为历史生效');
      r.stage='planned'; r.status='planned'; r.targetVersion=destination.version;
    } else if (kind==='departure') {
      subject.lifecycleStatus='departure'; subject.departureStartedAt=s.now;
      stopPromoters(s,subject.id,'技师开始离职办理，原余额与归属保留',ctx,a);
    } else {
      subject.lifecycleStatus='closing'; subject.closingAt=s.now; subject.promotionDisabled=true;
      supersedeLifecyclePauses(s,subject.id,r,ctx,a);
      closeStoreServicePromoters(s,subject.id,ctx,a);
    }
    r.responsibilityBasis=captureLifecycleResponsibilities(s,r,{goodsSummary:ctx.goodsSummary});
    subject.version++; s.organizationLifecycleCases.push(r); audit(s,r,a,type,reason,ctx); result=r;
    if (r.stage==='planned' && r.effectiveAt===s.now) { syncLifecycle(s,ctx); result=unique(s.organizationLifecycleCases,r.id,'原组织办理',ctx); }
  }
  const output=clone(result); s.organizationLifecycleRequests.push({actorKey,requestId,signature,type,result:output,at:s.now}); return output;
}

export function syncLifecycle(s,ctx={},command={}) {
  syncLifecyclePauses(s,ctx,command);
  const due=(s.organizationLifecycleCases || []).filter(c=>c.kind==='transfer' && c.stage==='planned' && c.effectiveAt<=s.now).map(c=>c.id);
  for (const caseId of due) {
    const c=unique(s.organizationLifecycleCases,caseId,'原组织办理',ctx),candidate=clone(s),next=unique(candidate.organizationLifecycleCases,caseId,'原组织办理',ctx);
    const localCtx={...ctx,id:prefix=>prefix+(++candidate.seq),log:(entity,content)=>{const event={at:candidate.now,text:content,actor:'system',actorId:'organization-clock',job:null,sourceCaseId:next.id};(entity.events??=[]).push(event);(candidate.logs??=[]).push({...event,id:entity.id||''});}};
    try {
      const t=unique(candidate.techs,next.techId,'原调店技师',localCtx),destination=unique(candidate.stores,next.toStoreId,'目标门店',localCtx);
      if (t.storeId!==next.fromStoreId || !t.active || t.reviewStatus!=='approved' || ['departure','left'].includes(t.lifecycleStatus) || ['closing','closed'].includes(destination.lifecycleStatus) || destination.closedAt!=null) fail(localCtx,'到期调店的原所属、在岗状态或目标门店已变化，须核对原计划');
      if (typeof localCtx.applyTechnicianTransfer!=='function') fail(localCtx,'原订单及资格持续适配尚未接齐，不能单独改变所属门店');
      (next.responsibilityHistory??=[]).push(captureLifecycleResponsibilities(candidate,next,{goodsSummary:localCtx.goodsSummary}));
      localCtx.applyTechnicianTransfer(candidate,next,localCtx);
      if (t.storeId!==next.toStoreId) fail(localCtx,'调店事务未完成真实所属适配');
      stopPromoters(candidate,t.id,'技师调店，原客户和资金留原来源',localCtx,next.createdBy);
      next.stage='effective'; next.status='effective'; next.appliedAt=candidate.now; next.version++; next.updatedAt=candidate.now; delete next.effectBlockedReason;
      next.history.push({at:candidate.now,occurredAt:next.effectiveAt,action:'transfer-effective',version:next.version,by:{role:'system',id:'organization-clock'},plannedBy:clone(next.createdBy)});
      (candidate.logs ??=[]).push({at:candidate.now,occurredAt:next.effectiveAt,id:next.id,text:'调店已按原计划生效，原单与资格来源保留',actor:'system',actorId:'organization-clock',job:null,sourceCaseId:next.id});
      Object.assign(s,candidate);
    } catch(error) {
      const message=String(error?.message || '原调店适配失败，待核对');
      if (c.effectBlockedReason!==message) { c.effectBlockedReason=message; c.lastEffectAttemptAt=s.now; c.version++; c.updatedAt=s.now; c.history.push({at:s.now,action:'transfer-blocked',reason:message,version:c.version,by:{role:'system',id:'organization-clock'}}); }
    }
  }
}

export function lifecycleCompletionView(s,caseId,ctx={}) {
  const c=unique(s.organizationLifecycleCases,caseId,'原组织办理',ctx),scope=c.kind==='store-close'?{storeId:c.storeId}:{techId:c.techId};
  const impact=lifecycleCaseImpact(s,c.id,{goodsSummary:ctx.goodsSummary}),blockers=[...impact.blockers];
  const add=(kind,sourceId,reason,target)=>blockers.push({kind,sourceId,sourceToken:fingerprint({kind,sourceId,reason}),path:target||`/group/${c.techId?'technicians/'+encodeURIComponent(c.techId):'stores/'+encodeURIComponent(c.storeId)}`,reason,amountCents:null});
  if(c.stage!=='effective'||c.status!=='effective')add('lifecycle-stage',c.id,'原组织变更尚未实际生效或已结束，不能完成');
  if(c.kind==='transfer'&&(!Number.isSafeInteger(c.assignmentAppliedAt)||c.assignmentAppliedAt>s.now||c.effectBlockedReason))add('lifecycle-assignment',c.id,'原调店所属和原订单持续适配来源未齐');
  const subject=unique(c.kind==='store-close'?s.stores:s.techs,c.storeId||c.techId,'原组织主体',ctx);
  if(c.kind==='transfer'&&subject.storeId!==c.toStoreId||c.kind==='departure'&&(subject.lifecycleStatus!=='departure'||subject.departureStartedAt!==c.effectiveAt)||c.kind==='store-close'&&(subject.lifecycleStatus!=='closing'||subject.closingAt!==c.effectiveAt))add('lifecycle-subject-source',c.id,'原组织主体所属或办理阶段已变化，须核对');
  const ids=new Set(impact.bookings.map(b=>b.sourceId));
  for(const row of Object.values(impact.settlement.groups).flat())if(row.bookingId)ids.add(row.bookingId);
  for(const id of ids) {
    const sources=(s.bookings||[]).filter(b=>b.id===id),b=sources.length===1?sources[0]:null,target='/group/bookings/'+encodeURIComponent(id);
    if(!b){add('lifecycle-booking-missing',id,'原预约不存在或来源不唯一，不能认已协调',target);continue;}
    if(impact.bookings.some(x=>x.sourceId===id&&x.resolvedForSubject))continue;
    if(!['done','cancelled','closed'].includes(b.status))add('lifecycle-booking-open',id,'原预约尚未完成或取消，沿原改约/改派/履约办理',target);
    if(b.change?.status==='pending')add('lifecycle-change-pending',b.change.id,'原拟安排尚待本人确认，不能替本人结束',target);
    if(['done','interrupted'].includes(b.status)) {
      const original=fulfilmentEndingSource(s,b),departures=(s.fulfilmentDepartures||[]).filter(x=>x.bookingId===b.id);
      if(!original.available||departures.length!==1||departures[0].storeId!==b.storeId||departures[0].techId!==original.techId||departures[0].endingAt!==original.endingAt)add('lifecycle-safe-departure-source',id,'原结束技师、实际结束或安全离开来源缺失/冲突，须沿原历史补认及确认核实',`/group/fulfilment/${encodeURIComponent(id)}`);
    }
    if(b.status==='done'&&(!Number.isSafeInteger(b.completedAt)||s.now<=b.completedAt+2*86400000))add('lifecycle-aftersale-window',id,'原服务48小时自助售后期尚未结束或完成时间待核对',target);
    if(careBlocksBooking(s,b))add('lifecycle-care',id,'原质量反馈或客服事项尚未结案','/group/care');
    if((b.disputes||[]).some(d=>!['closed','resolved'].includes(d.status)))add('lifecycle-dispute',id,'原服务争议尚未结案，不能以资金结束代替客服核实',target);
    if((s.safety||[]).some(x=>x.bookingId===id&&x.status!=='closed'))add('lifecycle-safety',id,'原安全事件尚未结束，不能关闭原责任',target);
  }
  let authority=null;
  if(typeof ctx.lifecycleAuthorityPreflight!=='function'||typeof ctx.applyLifecycleAuthorityExit!=='function')add('lifecycle-authority-adapter',c.id,'真实工作授权结束/限定承接适配尚未接齐，不能完成');
  else {
    try {
      authority=ctx.lifecycleAuthorityPreflight(s,c,{impact,scope,historicalRightsAdapters:ctx.historicalRightsAdapters});
      if(!authority||typeof authority.ready!=='boolean'||!/^sha256:[a-f0-9]{64}$/.test(authority.sourceToken)||!Array.isArray(authority.blockers)||!Array.isArray(authority.retainedRights)||authority.blockers.some(row=>typeof row?.kind!=='string'||typeof row?.reason!=='string'))add('lifecycle-authority-source',c.id,'原工作授权核验未返回完整真实来源');
      else {blockers.push(...authority.blockers.map(row=>({...row,sourceId:row.sourceId||c.id,path:row.path||'/group/accounts',amountCents:null})));if(!authority.ready&&!authority.blockers.length)add('lifecycle-authority-source',c.id,'原工作授权及本人/主体承接尚未核齐');}
    } catch(error) {add('lifecycle-authority-source',c.id,String(error?.message||'原工作授权来源无法核验'));}
  }
  const view={caseId:c.id,kind:c.kind,version:c.version,scope,cutoffAt:c.effectiveAt,impact,authority,blockers,retainedRights:[...impact.retainedRights,...(authority?.retainedRights||[])],canComplete:blockers.length===0};
  view.sourceToken=fingerprint(view);return view;
}

export function lifecycleCasesView(s,rawActor,scope) {
  if (!scope || typeof scope!=='object' || Array.isArray(scope) || Object.keys(scope).length!==1 || !['techId','storeId'].includes(Object.keys(scope)[0])) fail(null,'请选择唯一真实组织主体');
  const a=resolveAccountActor(s,rawActor),isTech=typeof scope?.techId==='string',subject=unique(isTech?s.techs:s.stores,isTech?scope.techId:scope?.storeId,isTech?'技师':'门店');
  const rows=(s.organizationLifecycleCases || []).filter(c=>isTech?c.techId===subject.id:c.storeId===subject.id || c.fromStoreId===subject.id || c.toStoreId===subject.id);
  const group=a.role==='group' && (!a.job || ['all','operations','support','finance'].includes(a.job)),local=['store','manager'].includes(a.role) && (subject.storeId===a.storeId || !isTech && subject.id===a.storeId || rows.some(c=>c.fromStoreId===a.storeId||c.toStoreId===a.storeId)),self=a.role==='tech' && a.techId===subject.id;
  if (!group && !local && !self) fail(null,'当前身份无权读取组织办理记录');
  const cases=rows.filter(c=>group||self||c.fromStoreId===a.storeId||c.toStoreId===a.storeId||c.storeId===a.storeId).map(c=>{
    const canReadBlock=group||c.kind==='store-pause'&&canPauseStore(a,subject.id);
    const lastBlock=c.kind==='store-pause'&&(c.history||[]).findLast(h=>h.action==='pause-blocked'&&h.reason===c.effectBlockedReason);
    return {id:c.id,kind:c.kind,techId:c.techId||null,storeId:c.storeId||null,fromStoreId:c.fromStoreId,toStoreId:c.toStoreId,effectiveAt:c.effectiveAt,startAt:c.startAt??null,endAt:c.endAt??null,stage:c.stage,status:c.status,version:c.version,createdAt:c.createdAt,appliedAt:c.appliedAt??null,effectBlockedReason:canReadBlock?c.effectBlockedReason||null:null,effectBlockedAt:canReadBlock&&Number.isSafeInteger(lastBlock?.at)&&lastBlock.at>=0&&lastBlock.at<=s.now?lastBlock.at:null,reference:group?c.reference:null,reason:group?c.reason:null};
  });
  return clone({subjectId:subject.id,lifecycleStatus:subject.lifecycleStatus || null,cases,canPlan:operations(a),canPause:!isTech&&canPauseStore(a,subject.id),completeAvailable:false});
}
