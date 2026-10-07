// Read-only task metadata. Native service records remain the state/ownership authority.
import { careView } from './service-care.mjs';
const encode = value => encodeURIComponent(String(value));
const time = value => Number.isFinite(value) ? value : null;
const token = value => JSON.stringify(value);
const routes = path => ({group:`/group/${path}`,store:`/store/${path}`});
const careJobs = () => ({group:['support'],store:['store-manager']});
const nativeOwner = row => typeof row.assignee?.name === 'string' ? row.assignee.name : '';
const nativeIdentity = row => {const a=row.assignee,actual=a?.accountId&&a?.grantId?a:a?.claimedAt!=null&&a.by?.accountId&&a.by?.grantId?a.by:null;return {nativeOwnerAccountId:actual?.accountId||null,nativeOwnerGrantId:actual?.grantId||null,nativeOwnerAccountVersion:actual?.accountVersion??null};};
const nativeToken = row => ({scope:row.ownerScope || null,name:nativeOwner(row),claimedAt:time(row.assignee?.claimedAt),...nativeIdentity(row)});
const caseLabels = {store_pending:'待门店处理',user_pending:'等待用户确认',group_pending:'待集团处理',execution_pending:'处理事项待办结',closed:'已完成',withdrawn:'已撤销'};
const followupLabels = {open:'待回访',working:'回访处理中',awaiting_actions:'问题事项待办结',closed:'已结案'};

function invoiceRows(s) {
  return (s.serviceInvoices || []).flatMap(invoice=>{
    const history=[...(invoice.history || [])].reverse(),reappliedAt=history.find(x=>x.action==='修改重提')?.at;
    const common={category:'invoice',sourceId:invoice.id,invoiceId:invoice.id,bookingId:invoice.bookingId,storeId:invoice.storeId,createdAt:time(reappliedAt ?? invoice.createdAt),dueAt:null,requiredRoute:'invoices',routes:routes(`invoices/${encode(invoice.id)}`),allowedJobs:{group:['finance'],store:['store-finance']},manageRoles:['store'],assignmentMode:'task'};
    const pending=invoice.status==='pending';
    const rows=[{...common,id:`invoice:${invoice.id}:issue`,title:'服务发票开具',status:pending?'open':'done',statusLabel:pending?'待开票':invoice.status==='rejected'?'已驳回，等待用户重提':'开票阶段已结束',sourceToken:token({version:invoice.version ?? 0,state:invoice.status,phase:'issue',replacedById:invoice.replacedById || null}),commands:pending?['invoice.issue','invoice.reject']:[]}];
    if(invoice.status==='red_pending'||invoice.status==='red'||invoice.red){
      const waiting=invoice.status==='red_pending';
      rows.push({...common,id:`invoice:${invoice.id}:red`,title:'服务发票红冲',createdAt:time(history.find(x=>x.action==='退款成功，待红冲')?.at),status:waiting?'open':'done',statusLabel:waiting?'待红冲':'已红冲',sourceToken:token({version:invoice.version ?? 0,state:invoice.status,phase:'red',replacedById:invoice.replacedById || null}),commands:waiting?['invoice.red']:[]});
    }
    return rows;
  });
}
function careRows(s) {
  // Use existing derived blockers without exporting their sensitive contents.
  const view=careView(s,{role:'group',job:'all'});
  const cases=(view.cases || []).map(row=>{
    const done=['closed','withdrawn'].includes(row.status),waiting=row.status==='user_pending'||row.status==='execution_pending'&&row.closureBlockers.length>0;
    const commands=done?[]:['care.task-claim','care.task-assign','care.case-note',...(['store_pending','group_pending'].includes(row.status)?['care.case-respond']:[]),...(row.canClose?['care.case-close']:[])];
    return {id:`care-case:${row.id}:resolution`,category:'care',title:'服务质量反馈',sourceId:row.id,caseId:row.id,bookingId:row.bookingId,storeId:row.storeId,status:done?'done':waiting?'waiting':'open',statusLabel:caseLabels[row.status] || '质量反馈待核对',createdAt:time(row.createdAt),dueAt:time(row.dueAt),sourceToken:token({version:row.version,state:row.status,phase:'resolution',dueAt:time(row.dueAt),owner:nativeToken(row),hasBlockers:row.closureBlockers.length>0}),requiredRoute:'care',routes:routes(`care/case/${encode(row.id)}`),allowedJobs:careJobs(),manageRoles:row.ownerScope==='group'?['group']:['store','group'],commands,assignmentMode:'source',nativeOwnerName:nativeOwner(row)};
  });
  const followups=(view.followups || []).map(row=>{
    const done=row.status==='closed',waiting=!done&&row.closureBlockers.length>0;
    const commands=done?[]:['care.task-claim','care.task-assign','care.followup-record','care.followup-link',...(row.canClose?['care.followup-close']:[])];
    return {id:`care-followup:${row.id}:followup`,category:'followup',title:'人工服务回访',sourceId:row.id,followupId:row.id,bookingId:row.bookingId,storeId:row.storeId,status:done?'done':waiting?'waiting':'open',statusLabel:followupLabels[row.status] || '人工回访待核对',createdAt:time(row.createdAt),dueAt:time(row.dueAt),sourceToken:token({version:row.version,state:row.status,phase:'followup',dueAt:time(row.dueAt),nextContactAt:time(row.nextContactAt),owner:nativeToken(row),hasBlockers:row.closureBlockers.length>0}),requiredRoute:'care',routes:routes(`care/followup/${encode(row.id)}`),allowedJobs:careJobs(),manageRoles:row.ownerScope==='group'?['group']:['store','group'],commands,assignmentMode:'source',nativeOwnerName:nativeOwner(row)};
  });
  return [...cases,...followups];
}
function qualificationRows(s) {
  return (s.techQualifications || []).flatMap(profile=>(profile.grants || []).map(grant=>{
    const pending=grant.status==='pending';
    const exact=profile.id?{profileId:profile.id}:{};
    const query=profile.id?`?profileId=${encode(profile.id)}&storeId=${encode(profile.storeId)}`:'';
    return {id:`qualification:${profile.techId}:${grant.id}:review`,category:'qualification',title:'独立服务授权审核',sourceId:grant.id,grantId:grant.id,techId:profile.techId,...exact,storeId:profile.storeId,status:pending?'open':'done',statusLabel:pending?'待集团运营审核':grant.status==='approved'?'审核已通过':'审核已驳回',createdAt:time(grant.requestedAt),dueAt:null,sourceToken:token({version:profile.version,state:grant.status,phase:'review',assessmentId:grant.assessmentId,reviewedAt:time(grant.review?.at),...exact,storeId:profile.storeId}),requiredRoute:'qualifications',routes:routes(`qualifications/${encode(profile.techId)}${query}`),allowedJobs:{group:['operations'],store:['store-manager']},manageRoles:['group'],commands:pending?['qualification.review']:[],assignmentMode:'task'};
  }));
}
export function careTaskRows(s) {return [...invoiceRows(s),...careRows(s),...qualificationRows(s)].map(row=>['care','followup'].includes(row.category)?{...row,...nativeIdentity((row.category==='care'?s.serviceCareCases:s.serviceCareFollowups).find(x=>x.id===row.sourceId))}:row);}
