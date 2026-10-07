import {bookingTaskRows} from './work-booking.mjs';
import {careTaskRows} from './work-care.mjs';
import {goodsTaskRows} from './work-goods.mjs';
import {goodsSettlementTaskRows} from './goods-settlement.mjs';
import {fulfilmentTaskRows} from './fulfilment.mjs';
import {goodsLogisticsTaskRows} from './goods-logistics-policy.mjs';
import {serviceFinanceExtrasTaskRows} from './service-finance-extras.mjs';
import {servicePromotionTaskRows} from './service-promotion.mjs';
import {servicePromotionSharedTaskRows} from './service-promotion-shared-tasks.mjs';
import {serviceFinanceTaskRows} from './service-finance-tasks.mjs';
import {technicianPenaltyTaskRows} from './technician-penalties.mjs';
import {resolveAccountActor,canAccountView,assertAccountCommand,actorAccountFields,staffGrantActive,staffSettlementGrantLive} from './staff-accounts.mjs';
import {assertJob} from './management.mjs';
const clone=value=>structuredClone(value);
const fail=message=>{throw new Error(message);};
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const signature=value=>JSON.stringify(canonical(value));
const text=(value,label,max=500)=>{if(typeof value!=='string'||!value.trim()||value.trim().length>max) fail(`请填写${label}（最多${max}字）。`);return value.trim();};
export function upgradeWorkTasks(s) {s.workTaskAssignments??=[];s.workTaskRequests??=[];return s;}
function sources(s) {
  const promotionLabels={'identity-pending':'待实名核验',verified:'实名核验已通过',pending:'待人工审核',requested:'待财务发起',processing:'原笔结果待查询',awaiting_user:'待本人确认收款',cancel_requested:'待查询渠道撤销结果',failed:'原转账明确失败',paid:'实际转账成功',cancelled:'渠道或申请已撤销',open:'待扣回',closed:'已按事实结清',loss:'已登记损失','return-pending':'超收待实际退回',approved:'审核通过',rejected:'审核未通过'};
  const promotion=servicePromotionTaskRows(s).map(row=>({...row,statusLabel:promotionLabels[row.statusLabel]||'原来源待核对'}));
  const rows=[...bookingTaskRows(s),...careTaskRows(s),...goodsTaskRows(s),...goodsSettlementTaskRows(s),...fulfilmentTaskRows(s),...goodsLogisticsTaskRows(s),...serviceFinanceExtrasTaskRows(s),...promotion,...servicePromotionSharedTaskRows(s),...serviceFinanceTaskRows(s),...technicianPenaltyTaskRows(s)],seen=new Set();
  for(const row of rows) {if(seen.has(row.id)) fail('统一待办来源编号重复，请核对来源。');seen.add(row.id);}
  return rows;
}
function readable(a,row) {
  if(!['group','store'].includes(a?.role)||a.job==='account-admin') return false;
  if((row.category.startsWith('service-promotion-')||row.category.startsWith('service-finance-'))&&a.role==='group'&&!a.job)return false;
  if(a.role==='store'&&(!a.storeId||row.storeId!==a.storeId)) return false;
  const jobs=row.allowedJobs?.[a.role] || [];
  if(!jobs.length) return false;
  if(a.accountId||a.role==='group'&&a.job&&a.job!=='all') {if(!jobs.includes(a.job)) return false;}
  return Boolean(row.routes?.[a.role]&&canAccountView(a,row.requiredRoute));
}
function canOperate(a,row) {
  return readable(a,row)&&(row.manageRoles || []).includes(a.role)&&(row.commands || []).some(type=>{try{assertAccountCommand(a,type);assertJob(a,type);return true;}catch{return false;}});
}
function grantActor(s,accountId,grantId) {
  const accounts=(s.staffAccounts || []).filter(x=>x.id===accountId),account=accounts.length===1?accounts[0]:null,grants=(account?.grants || []).filter(x=>x.id===grantId),grant=grants.length===1?grants[0]:null;
  if(!staffGrantActive(s,account,grant))return null;
  const store=grant.role==='store'&&(s.stores || []).find(x=>x.id===grant.storeId),restricted=grant.purpose==='lifecycle-settlement';
  if(restricted&&!staffSettlementGrantLive(s,account,grant)||store&&(store.lifecycleStatus==='closed'||store.closedAt!=null)&&!restricted)return null;
  return {role:grant.role,job:grant.job,storeId:grant.storeId,accountId:account.id,accountName:account.name,grantId:grant.id,sessionId:'work-candidate-check',...(restricted?{lifecyclePurpose:grant.purpose,lifecycleCaseId:grant.sourceCaseId,allowedCommands:clone(grant.allowedCommands),allowedRoutes:clone(grant.allowedRoutes),responsibilityAt:grant.responsibilityAt,originalBookingIds:clone(grant.originalBookingIds),originalGoodsIds:clone(grant.originalGoodsIds)}:{})};
}
function candidates(s,row,a) {
  if(row.status!=='open'||row.assignmentMode==='source'||!canOperate(a,row)) return [];
  return (s.staffAccounts || []).filter(x=>x.enabled).flatMap(account=>(account.grants || []).map(grant=>grantActor(s,account.id,grant.id)).filter(target=>target&&canOperate(target,row)&&target.role===a.role&&(a.role!=='store'||target.storeId===a.storeId)).map(target=>({accountId:target.accountId,grantId:target.grantId,name:target.accountName,job:target.job,storeId:target.storeId || null}))).sort((a,b)=>a.name.localeCompare(b.name)||a.accountId.localeCompare(b.accountId)||a.grantId.localeCompare(b.grantId));
}
function assignmentFor(s,id) {return (s.workTaskAssignments || []).find(x=>x.id===id);}
function project(s,a,row) {
  const original=row.assignmentMode==='source',assignment=original?null:assignmentFor(s,row.id),target=assignment?grantActor(s,assignment.accountId,assignment.grantId):null;
  const ownerAccountId=original?row.nativeOwnerAccountId || null:assignment?.accountId || null;
  const nativeTarget=original&&ownerAccountId&&row.nativeOwnerGrantId?grantActor(s,ownerAccountId,row.nativeOwnerGrantId):null;
  const nativeGrantValid=nativeTarget&&(row.status==='done'?readable(nativeTarget,row):canOperate(nativeTarget,row))&&(row.nativeOwnerAccountVersion==null||(s.staffAccounts||[]).find(x=>x.id===ownerAccountId)?.version===row.nativeOwnerAccountVersion);
  const ownerValid=original?(row.nativeOwnerGrantId?Boolean(nativeGrantValid&&row.nativeOwnerValid!==false):typeof row.nativeOwnerValid==='boolean'?row.nativeOwnerValid:null):assignment?Boolean(target&&(row.status==='open'?canOperate(target,row):readable(target,row))):null;
  const ownerLabel=original?(nativeTarget?.accountName||row.nativeOwnerName || '原负责岗位待认领')+(ownerValid===false?'（授权失效，需重新接管）':ownerValid===null&&row.nativeOwnerName?'（工作账号待核对）':''):assignment?(target?.accountName || assignment.accountName || assignment.accountId)+(ownerValid?'':'（授权失效，需重新分派）'):'待认领';
  const eligible=candidates(s,row,a),canAssign=eligible.length>0;
  const canClaim=Boolean(canAssign&&a.accountId&&(!assignment||!ownerValid)&&eligible.some(x=>x.accountId===a.accountId&&x.grantId===a.grantId));
  const history=(assignment?.history || []).map(h=>({at:h.at,type:h.type,reason:h.reason,accountName:h.to?.accountName || '',accountId:h.to?.accountId || null,by:clone(h.by),version:h.version}));
  return {...clone(row),route:row.routes[a.role],ownerLabel,ownerAccountId,ownerGrantId:original?row.nativeOwnerGrantId||null:assignment?.grantId || null,ownerValid,assignmentVersion:assignment?.version || 0,history,canAssign,canClaim,candidates:eligible,mine:Boolean(a.accountId&&ownerAccountId===a.accountId&&ownerValid),overdue:row.status!=='done'&&Number.isFinite(row.dueAt)&&s.now>=row.dueAt};
}
export function workTaskView(s,rawActor,filters={}) {
  const a=resolveAccountActor(s,rawActor),tasks=sources(s).filter(row=>readable(a,row)).map(row=>project(s,a,row));
  return {tasks,counts:{total:tasks.length,open:tasks.filter(x=>x.status==='open').length,waiting:tasks.filter(x=>x.status==='waiting').length,done:tasks.filter(x=>x.status==='done').length,mine:tasks.filter(x=>x.mine).length,unassigned:tasks.filter(x=>x.status==='open'&&!x.ownerAccountId&&(x.assignmentMode!=='source'||!x.nativeOwnerName)).length,overdue:tasks.filter(x=>x.overdue).length},candidates:[]};
}
export function workTaskCommand(s,rawActor,type,p={},ctx={}) {
  if(!['work.claim','work.assign'].includes(type)) fail('不支持的待办责任操作。');
  const a=resolveAccountActor(s,rawActor),row=sources(s).find(x=>x.id===p.id);
  if(!row||!readable(a,row)) fail('事项不存在或当前岗位无权查看。');
  const requestId=text(p.requestId,'本次提交标识',300),who=a.accountId || signature({role:a.role,job:a.role==='group'?a.job || 'all':null,storeId:a.role==='store'?a.storeId || null:null}),fingerprint=signature({type,p});
  const old=(s.workTaskRequests || []).find(x=>x.actor===who&&x.requestId===requestId);
  // A replay still requires current source scope and command authority.
  if(row.assignmentMode==='source'||!(row.manageRoles || []).includes(a.role)) fail('请从原业务页面办理责任认领和转派。');
  if(old) {if(row.status==='open'&&!canOperate(a,row)) fail('当前岗位无权办理此事项。');if(old.fingerprint!==fingerprint) fail('同一提交标识不能用于不同待办操作。');return clone(old.result);}
  if(row.status!=='open'||!canOperate(a,row)) fail('当前事项已变化或不是本岗位可办理阶段。');
  if(typeof p.sourceToken!=='string'||p.sourceToken!==row.sourceToken) fail('原业务阶段已更新，请刷新核对后重新分派。');
  const prior=assignmentFor(s,row.id),version=prior?.version || 0;
  if(!['number','string'].includes(typeof p.version)||!String(p.version).trim()||!Number.isSafeInteger(Number(p.version))||Number(p.version)!==version) fail('责任记录已更新或缺少版本，请刷新后重试。');
  if(type==='work.claim'&&!a.accountId) fail('请进入实际工作账号后认领；自由演示模式可分派给已授权员工。');
  if(type==='work.claim'&&prior&&project(s,a,row).ownerValid) fail('事项已有有效负责人，请填写原因办理分派。');
  const accountId=type==='work.claim'?a.accountId:text(p.accountId,'负责员工编号',150),grantId=type==='work.claim'?a.grantId:text(p.grantId,'负责授权编号',150);
  const target=candidates(s,row,a).find(x=>x.accountId===accountId&&x.grantId===grantId);if(!target) fail('负责员工未启用或不具备本事项当前岗位和门店授权。');
  const reason=p.reason==null||String(p.reason).trim()===''?(type==='work.claim'?'本人认领':fail('请填写分派原因。')):text(p.reason,'责任变更原因');
  const by={role:a.role,job:a.accountId||a.role==='group'?a.job || null:null,storeId:a.role==='store'?a.storeId || null:null,...actorAccountFields(a)};
  const history={at:s.now,type,reason,by,from:prior?{accountId:prior.accountId,grantId:prior.grantId,accountName:prior.accountName}:null,to:{accountId,grantId,accountName:target.name},sourceToken:row.sourceToken,version:version+1};
  const record={...(prior || {id:row.id,createdAt:s.now,history:[]}),accountId,grantId,accountName:target.name,sourceToken:row.sourceToken,updatedAt:s.now,version:version+1,history:[...(prior?.history || []),history]};
  upgradeWorkTasks(s);if(prior) Object.assign(prior,record);else s.workTaskAssignments.push(record);
  const result={id:row.id,version:record.version,accountId,grantId};s.workTaskRequests.push({actor:who,requestId,fingerprint,result:clone(result)});
  ctx.log?.(record,`${type==='work.claim'?'认领':'分派'}待办责任 · ${row.id}`);return result;
}
