import { lifecycleFingerprint } from './organization-lifecycle-projection.mjs';
import { actorAccountFields } from './staff-accounts.mjs';
const DAY=86400000,MIN=60000,open=new Set(['unpaid','waiting','confirmed','active','interrupted']);
export const LIFECYCLE_PAUSE_COMMANDS=['lifecycle.store-pause','lifecycle.store-pause-emergency','lifecycle.store-pause-cancel','lifecycle.store-resume'];
const time=v=>Number.isSafeInteger(v)&&v>=0,rows=(s,key)=>Array.isArray(s[key])?s[key]:[],unique=(list,id)=>{const found=list.filter(x=>x.id===id);return typeof id==='string'&&found.length===1?found[0]:null;};
const ended=c=>['completed','cancelled'].includes(c.stage),until=c=>c.resumedAt??c.endAt??Infinity,overlap=(a,b,c,d)=>a<d&&b>c;
const operations=a=>a?.role==='group'&&(!a.job||['all','operations'].includes(a.job));
export const canPauseStore=(a,id)=>operations(a)||['store','manager'].includes(a?.role)&&a.storeId===id&&(!a.job||a.job==='store-manager');
const author=a=>({role:a.role,job:a.job||null,id:a.accountId||a.storeId||'group',...actorAccountFields(a)});
function fail(ctx,message){ctx?.fail?.(message);throw new Error(message);}
function text(v,label,ctx){if(typeof v!=='string'||!v.trim()||v.trim().length>1000)fail(ctx,'请填写'+label);return v.trim();}
function date(v,label,ctx){if(time(v))return v;const match=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:\d{2})?$/.exec(String(v||''));if(!match||+match[2]<1||+match[2]>12||+match[3]<1||+match[3]>new Date(Date.UTC(+match[1],+match[2],0)).getUTCDate()||+match[4]>23||+match[5]>59||+(match[6]||0)>59)fail(ctx,label+'无效');const out=Date.parse(match[7]?v:v+'+08:00');if(!time(out))fail(ctx,label+'无效');return out;}
function version(row,v,ctx){if(!['number','string'].includes(typeof v)||!String(v).trim()||!Number.isSafeInteger(Number(v))||Number(v)!==row.version)fail(ctx,'原停业资料已更新，请刷新核对');}
function record(s,c,action,reason,ctx,a={role:'system'},occurredAt=s.now){c.version++;c.updatedAt=s.now;(c.history??=[]).push({at:s.now,occurredAt,action,reason,version:c.version,by:author(a)});ctx?.log?.(c,reason);}
function opening(s,store,ctx){if(typeof ctx.storeOpeningReadiness!=='function')return {available:false,ready:false,missing:['原营业条件核验适配尚未接齐']};try{const result=ctx.storeOpeningReadiness(s,store);if(typeof result?.ready!=='boolean'||!Array.isArray(result.missing))throw new Error('原营业条件来源不完整');return {available:true,ready:result.ready,missing:[...result.missing]};}catch(error){return {available:false,ready:false,missing:[String(error.message||'原营业条件待核对')]};}}
function source(s,store,ctx){const own=rows(s,'bookings').filter(b=>b.storeId===store.id),ids=new Set(own.map(b=>b.id));return lifecycleFingerprint({now:s.now,store,bookings:own,fulfilment:rows(s,'fulfilmentRecords').filter(r=>ids.has(r.bookingId)),techs:rows(s,'techs').filter(t=>t.storeId===store.id),qualifications:rows(s,'techQualifications').filter(q=>q.storeId===store.id),services:s.services,cases:rows(s,'organizationLifecycleCases').filter(c=>c.storeId===store.id),opening:opening(s,store,ctx),missing:['bookings','techs','techQualifications','services','fulfilmentRecords','organizationLifecycleCases'].filter(key=>!Array.isArray(s[key]))});}
function basisValid(c){const b=c.pauseBasis;if(!b||!time(c.createdAt)||!time(c.startAt)||c.startAt<c.createdAt||c.effectiveAt!==c.startAt||c.endAt!=null&&(!time(c.endAt)||c.endAt<=c.startAt)||!Number.isSafeInteger(c.version)||c.version<1)return false;const {sourceToken,...facts}=b;return sourceToken===lifecycleFingerprint(facts)&&b.caseId===c.id&&b.storeId===c.storeId&&b.startAt===c.startAt&&b.endAt===c.endAt&&b.createdAt===c.createdAt&&Array.isArray(b.bookingIds)&&b.bookingIds.every(id=>typeof id==='string');}
function span(b){if(!time(b.startAt)||!Number.isSafeInteger(b.duration)||b.duration<=0||!Array.isArray(b.extensions))return null;const extras=b.extensions.filter(x=>['success','unpaid','processing','failed'].includes(x.status));if(extras.some(x=>!Number.isSafeInteger(x.duration)||x.duration<=0))return null;return {startAt:b.startAt,endAt:b.startAt+(b.duration+extras.reduce((n,x)=>n+x.duration,0))*MIN};}
function begun(s,b){const direct=[b.departedAt,b.arrivedAt,b.startedAt].filter(v=>time(v)&&v<=s.now);const facts=rows(s,'fulfilmentRecords').filter(r=>r.bookingId===b.id&&r.storeId===b.storeId).flatMap(r=>r.facts||[]).filter(f=>f.techId===b.techId&&!f.replacedBy&&['confirmed','verified'].includes(f.status)&&['departure','arrival'].includes(f.kind)&&time(f.occurredAt)&&f.occurredAt<=s.now);return [...direct,...facts.map(f=>f.occurredAt)].sort((a,z)=>a-z)[0];}

export function lifecyclePauseImpact(s,storeId,interval={startAt:s.now,endAt:null},ctx={}){
  const store=unique(rows(s,'stores'),storeId);if(!store||!time(s.now)||!time(interval.startAt)||interval.endAt!=null&&(!time(interval.endAt)||interval.endAt<=interval.startAt))throw new Error('请选择唯一真实门店及有效停业时段');
  const bookings=[],blockers=[],endAt=interval.endAt??Infinity;
  for(const b of rows(s,'bookings').filter(b=>b.storeId===storeId&&open.has(b.status))){
    const arrangements=[{proposed:false,startAt:b.startAt},...(b.change?.status==='pending'?[{proposed:true,startAt:b.change.startAt}]:[])],actual=span(b);
    for(const a of arrangements){const startAt=a.startAt,finish=actual&&time(startAt)?startAt+(actual.endAt-actual.startAt):null;if(finish!=null&&!overlap(startAt,finish,interval.startAt,endAt))continue;
      const first=begun(s,b),stage=!actual||!time(startAt)||!unique(rows(s,'bookings'),b.id)?'needs-review':!a.proposed&&time(first)?'fulfilling':'not-started';
      const row={kind:'pause-booking',sourceId:b.id,changeId:a.proposed?b.change.id:null,storeId,proposed:a.proposed,status:b.status,startAt:time(startAt)?startAt:null,endAt:finish,stage,path:'/group/bookings/'+encodeURIComponent(b.id),reason:stage==='needs-review'?'原预约时段或来源不唯一，须核对':stage==='fulfilling'?'原已开始履约保留，无法继续须走原中止或客服处理':'停业时段原安排/拟安排须门店改约并由本人确认，无法改约沿原门店原因全额退款'};
      row.sourceToken=lifecycleFingerprint({booking:b,facts:rows(s,'fulfilmentRecords').filter(r=>r.bookingId===b.id),interval,a});bookings.push(row);if(stage!=='fulfilling')blockers.push(row);
    }
  }
  for(const key of ['bookings','fulfilmentRecords'])if(!Array.isArray(s[key]))blockers.push({kind:'pause-source',sourceId:storeId,path:'/group/stores/'+encodeURIComponent(storeId),reason:'原'+key+'来源容器缺失，不能认已协调'});
  return {storeId,startAt:interval.startAt,endAt:interval.endAt??null,bookings,blockers,opening:opening(s,store,ctx),sourceToken:source(s,store,ctx)};
}
export function lifecyclePauseView(s,caseId,ctx={}){
  const c=unique(rows(s,'organizationLifecycleCases'),caseId);if(c?.kind!=='store-pause')throw new Error('原停业案不存在或不唯一');
  const store=unique(rows(s,'stores'),c.storeId);if(!store)throw new Error('原停业门店来源待核对');
  const impact=lifecyclePauseImpact(s,c.storeId,{startAt:c.startAt,endAt:c.endAt},ctx),ready=impact.opening,blockers=[];
  const add=reason=>blockers.push({kind:'pause-resume',sourceId:c.id,path:'/group/stores/'+encodeURIComponent(c.storeId),reason});
  if(!basisValid(c))add('原停业起点或时段来源缺失/变化，须核对');
  if(c.stage!=='effective'||store.pauseCaseId!==c.id||store.active!==false)add('本案尚未实际暂停或原停业拥有来源已变化');
  if(['closing','closed'].includes(store.lifecycleStatus)||store.closedAt!=null)add('门店关停或已关闭，不能恢复营业');
  if(!ready.available||!ready.ready)add('恢复营业条件未齐：'+ready.missing.join('、'));
  return {caseId:c.id,storeId:c.storeId,version:c.version,impact,blockers,canResume:blockers.length===0,sourceToken:source(s,store,ctx)};
}

// The caller must combine continuationCandidate with the original exact
// accepted/transfer basis, qualification, safety and occupancy guards.
// This projection only keeps the original store -> service -> tech -> time
// selection reachable. It never chooses a time or changes the real open state.
export function lifecyclePauseSelection(s,storeId,ctx={}){
  const store=unique(rows(s,'stores'),storeId),deny=reason=>({bookable:false,resumeAt:null,reason});
  if(!time(s.now)||!store||['closing','closed'].includes(store.lifecycleStatus)||store.closedAt!=null)return deny('门店已关停或来源待核对');
  const active=rows(s,'organizationLifecycleCases').filter(c=>c.kind==='store-pause'&&c.storeId===storeId&&!ended(c));
  if(active.some(c=>!basisValid(c)||!unique(rows(s,'organizationLifecycleCases'),c.id)))return deny('原停业时段来源待核对');
  if(store.active===true)return {bookable:true,resumeAt:null,reason:''};
  const owned=active.find(c=>c.id===store.pauseCaseId&&c.stage==='effective');
  if(!owned||!time(owned.appliedAt)||owned.appliedAt>s.now||!time(owned.endAt)||owned.endAt<=s.now||!owned.autoResumeOwned||store.reviewStatus!=='approved')return deny('门店当前不可营业');
  if(lifecycleFingerprint(owned.resumeBasis)!==lifecycleFingerprint({qualification:store.qualification,merchantNo:store.merchantNo,reviewStatus:store.reviewStatus})||!opening(s,store,ctx).ready)return deny('恢复营业条件待核对');
  return {bookable:true,resumeAt:owned.endAt,reason:''};
}
export function lifecyclePauseEligibility(s,storeId,selection,ctx={}){
  const store=unique(rows(s,'stores'),storeId),startAt=selection?.startAt,endAt=selection?.endAt;
  if(!store||!time(startAt)||!time(endAt)||endAt<=startAt)return {blocked:true,reason:'原预约跨度或门店来源待核对',caseIds:[],continuationCandidate:false,canBookOutsideWhilePaused:false};
  const active=rows(s,'organizationLifecycleCases').filter(c=>c.kind==='store-pause'&&c.storeId===storeId&&!ended(c));
  if(active.some(c=>!basisValid(c)||!unique(rows(s,'organizationLifecycleCases'),c.id)))return {blocked:true,reason:'原停业时段来源待核对',caseIds:active.map(c=>c.id),continuationCandidate:false,canBookOutsideWhilePaused:false};
  const matches=active.filter(c=>overlap(startAt,endAt,c.startAt,until(c))),b=selection.bookingId&&unique(rows(s,'bookings'),selection.bookingId),began=b&&begun(s,b);
  const originalSpan=b&&span(b),exactStart=b&&(startAt===b.startAt||time(began)&&startAt===s.now);
  const continuationCandidate=Boolean(matches.length&&b&&open.has(b.status)&&originalSpan&&exactStart&&endAt-startAt<=originalSpan.endAt-originalSpan.startAt&&b.storeId===storeId&&matches.every(c=>c.pauseBasis.bookingIds.includes(b.id)&&time(b.createdAt)&&b.createdAt<=c.createdAt&&(b.startAt<c.startAt||time(began)&&began<=c.startAt)));
  const owned=active.find(c=>c.id===store.pauseCaseId&&c.stage==='effective'),readiness=opening(s,store,ctx);
  const canBookOutsideWhilePaused=Boolean(!matches.length&&owned&&store.active===false&&time(owned.appliedAt)&&owned.appliedAt<=s.now&&time(owned.endAt)&&startAt>=owned.endAt&&owned.autoResumeOwned&&store.reviewStatus==='approved'&&lifecycleFingerprint(owned.resumeBasis)===lifecycleFingerprint({qualification:store.qualification,merchantNo:store.merchantNo,reviewStatus:store.reviewStatus})&&readiness.ready&&!['closing','closed'].includes(store.lifecycleStatus)&&store.closedAt==null);
  return {blocked:matches.length>0,reason:matches.length?'预约跨度与原停业时段重叠，请沿原改约/退款办理':'',caseIds:matches.map(c=>c.id),continuationCandidate,canBookOutsideWhilePaused,sourceToken:source(s,store,ctx)};
}
export function assertLifecycleStoreStatus(s,storeId,status){if(['open','pause'].includes(status)&&rows(s,'organizationLifecycleCases').some(c=>c.kind==='store-pause'&&c.storeId===storeId&&c.stage==='effective'))throw new Error('原停业案尚未结束，请从原停业恢复入口核验，不可绕过时段');}
function restore(s,c,store,ctx,a,reference,reason){store.active=true;store.reviewStatus='approved';store.version++;delete store.pauseCaseId;c.stage='completed';c.status='completed';c.completedAt=s.now;c.resumedAt=s.now;c.resumeReference=reference;delete c.effectBlockedReason;record(s,c,'pause-resumed',reason,ctx,a,a.role==='system'?c.endAt??s.now:s.now);}
export function applyLifecyclePause(s,a,type,p,ctx={}){
  const existing=['lifecycle.store-pause-cancel','lifecycle.store-resume'].includes(type),c=existing&&unique(rows(s,'organizationLifecycleCases'),p.id),storeId=existing?c?.storeId:p.storeId,store=unique(rows(s,'stores'),storeId);
  if(!store||existing&&c?.kind!=='store-pause')fail(ctx,'原停业门店或记录不存在/不唯一');
  if(!canPauseStore(a,storeId)||['lifecycle.store-pause-emergency','lifecycle.store-resume'].includes(type)&&!operations(a))fail(ctx,'当前岗位无权设置本店停业，紧急暂停及恢复由集团运营办理');
  version(existing?c:store,p.version,ctx);if(p.sourceToken!==source(s,store,ctx))fail(ctx,'原停业影响、营业条件或来源已变化，请刷新核对');
  const reason=text(p.reason,'实际停业/恢复依据',ctx);
  if(type==='lifecycle.store-pause-cancel'){if(c.stage!=='planned'||s.now>=c.startAt)fail(ctx,'原停业已生效或到达起点，不能撤回');c.stage='cancelled';c.status='cancelled';c.cancelledAt=s.now;record(s,c,type,reason,ctx,a);return c;}
  if(type==='lifecycle.store-resume'){const view=lifecyclePauseView(s,c.id,ctx);if(!view.canResume)fail(ctx,view.blockers.map(x=>x.reason).join('；'));restore(s,c,store,ctx,a,text(p.reference,'集团实际恢复来源',ctx),reason);return c;}
  if(!store.active||store.reviewStatus!=='approved'||store.pauseCaseId||['closing','closed'].includes(store.lifecycleStatus)||store.closedAt!=null)fail(ctx,'门店须实际营业且未关停，不能用停业计划开启或重复暂停');
  const emergency=type==='lifecycle.store-pause-emergency',startAt=emergency?s.now:date(p.startAt,'停业开始时间',ctx),endAt=p.endAt==null||p.endAt===''?null:date(p.endAt,'停业结束时间',ctx);
  if(!emergency&&startAt<s.now+DAY)fail(ctx,'普通门店停业须至少提前24小时');if(!emergency&&endAt==null||endAt!=null&&endAt<=startAt)fail(ctx,'请明确停业结束时间且晚于开始');
  if(rows(s,'organizationLifecycleCases').some(x=>x.kind==='store-pause'&&x.storeId===storeId&&!ended(x)&&overlap(startAt,endAt??Infinity,x.startAt,until(x))))fail(ctx,'原停业时段重叠，请核对或撤回未生效原计划');
  if(rows(s,'organizationLifecycleCases').some(x=>x.storeId===storeId&&x.kind!=='store-pause'&&!ended(x)))fail(ctx,'门店有未结束组织办理，不能设置停业');
  const r={id:ctx.id?ctx.id('OLP'):'OLP'+ ++s.seq,kind:'store-pause',storeId,fromStoreId:storeId,toStoreId:null,startAt,endAt,effectiveAt:startAt,createdAt:s.now,updatedAt:s.now,createdBy:author(a),reference:text(p.reference,'实际停业来源',ctx),reason,emergency,stage:'planned',status:'planned',version:1,history:[],resumeBasis:{qualification:store.qualification,merchantNo:store.merchantNo,reviewStatus:store.reviewStatus}};
  const basis={caseId:r.id,storeId,createdAt:r.createdAt,startAt,endAt,bookingIds:rows(s,'bookings').filter(b=>b.storeId===storeId).map(b=>b.id)};basis.sourceToken=lifecycleFingerprint(basis);r.pauseBasis=basis;
  s.organizationLifecycleCases.push(r);store.version++;record(s,r,type,reason,ctx,a);if(emergency)syncLifecyclePauses(s,ctx);return r;
}
export function syncLifecyclePauses(s,ctx={},command={}){
  for(const c of rows(s,'organizationLifecycleCases').filter(c=>c.kind==='store-pause'&&!ended(c)).sort((a,b)=>a.startAt-b.startAt)){
    // The explicit command checks its original version and full current source.
    // Updating this same case first would invalidate even a freshly read form.
    if(command.type==='lifecycle.store-resume'&&command.id===c.id&&c.stage==='effective'&&unique(rows(s,'organizationLifecycleCases'),c.id))continue;
    const store=unique(rows(s,'stores'),c.storeId);let reason='';
    if(!store||!basisValid(c))reason='原停业主体/时段来源待核对，保持原营业状态';
    else if(['closing','closed'].includes(store.lifecycleStatus)||store.closedAt!=null)reason='门店已另行关停，不可自动恢复';
    else if(c.stage==='planned'&&c.startAt<=s.now){
      if(store.pauseCaseId&&store.pauseCaseId!==c.id)reason='原门店有另一实际暂停来源，不能覆盖';
      else{c.autoResumeOwned=store.active===true&&store.reviewStatus==='approved';store.active=false;store.pauseCaseId=c.id;store.pausedAt=s.now;store.version++;c.stage='effective';c.status='effective';c.appliedAt=s.now;delete c.effectBlockedReason;record(s,c,'pause-effective','原时段停业已生效，新预约停止，原单沿原流程协调',ctx,undefined,c.startAt);}
    }
    if(!reason&&c.stage==='effective'&&time(c.endAt)&&c.endAt<=s.now){
      const view=lifecyclePauseView(s,c.id,ctx);
      if(!view.canResume)reason=view.blockers.map(x=>x.reason).join('；');
      else if(!c.autoResumeOwned||store.reviewStatus!=='approved'||lifecycleFingerprint(c.resumeBasis)!==lifecycleFingerprint({qualification:store.qualification,merchantNo:store.merchantNo,reviewStatus:store.reviewStatus}))reason='门店另行暂停或营业审核/资质主体已变化，须集团核实恢复';
      else restore(s,c,store,ctx,{role:'system'},c.reference,'原停业结束，实际营业条件核验通过后恢复');
    }
    if(reason&&c.effectBlockedReason!==reason){c.effectBlockedReason=reason;record(s,c,'pause-blocked',reason,ctx);}
  }
}
export function supersedeLifecyclePauses(s,storeId,closingCase,ctx,a){for(const c of rows(s,'organizationLifecycleCases').filter(c=>c.kind==='store-pause'&&c.storeId===storeId&&!ended(c))){c.stage='completed';c.status='completed';c.completedAt=s.now;c.supersededAt=s.now;c.supersededBy=closingCase.id;delete c.effectBlockedReason;record(s,c,'pause-superseded','原集团关停办理结束停业恢复能力，原停业历史保留',ctx,a);}const store=unique(rows(s,'stores'),storeId);if(store)delete store.pauseCaseId;}
