// Non-atomic external I/O: the durable journal describes actual partial results.
import { lifecycleFingerprint } from './organization-lifecycle-projection.mjs';
import { resolveAccountActor, canAccountView, actorAccountFields } from './staff-accounts.mjs';
import { privacyCleanupClosure, privacyCleanupInventory, privacyCleanupCoverage } from './privacy-cleanup-inventory.mjs';
const hash=value=>lifecycleFingerprint(value), clone=value=>structuredClone(value);
const time=n=>Number.isSafeInteger(n)&&n>=0;
const unique=(rows,id,label)=>{const found=(Array.isArray(rows)?rows:[]).filter(x=>x?.id===id);if(!id||found.length!==1)throw Error(label+'不存在或不唯一');return found[0];};
const text=value=>typeof value==='string'&&value.trim().length>0;
const authored=(s,a)=>{const account=unique(s.staffAccounts,a?.accountId,'持久政策记录作者');unique(account.grants,a?.grantId,'持久政策记录岗位');return true;};
function current(options) {
  if(typeof options.currentContext!=='function'||!options.storage?.originScope)throw Error('清理执行须由当前源context和同origin存储接入');
  const c=options.currentContext();if(!c||c instanceof Promise||!c.state)throw Error('当前清理源须同步真实读取');
  const actor=resolveAccountActor(c.state,c.actor);
  if(actor.role!=='group'||actor.job!=='support'||!actor.accountId||!actor.sessionId||actor.lifecyclePurpose||!canAccountView(actor,'privacy'))throw Error('仅当前真实集团客服会话可办理材料清理');
  return {...c,actor,actorKey:hash({accountId:actor.accountId,sessionId:actor.sessionId,grantId:actor.grantId}),by:{role:actor.role,job:actor.job,...actorAccountFields(actor)}};
}
function policy(s,item) {
  const r=unique(s.privacyUploadReservations,item.sourceId,'原上传登记'),d=r.cleanupDecision;
  if(!d)throw Error('正式清理政策及原逐项决定尚未发布');
  const p=unique(s.privacyCleanupPolicies,d.policyId,'正式持久清理政策'),source=unique(s.privacyCleanupPolicySources,p.sourceId,'正式保留依据原source');
  if(p.status!=='published'||source.status!=='confirmed'||p.version!==d.policyVersion||p.sourceVersion!==source.version||!Number.isSafeInteger(p.version)||p.version<1||!Number.isSafeInteger(source.version)||source.version<1||p.sourceToken!==hash(source))throw Error('正式政策source/发布版本待核对');
  if(!text(source.reference)||!text(source.issuer)||!text(p.basis)||p.basis!==source.basis||p.purpose!==source.purpose||p.purpose!==item.purpose||hash(p.scope)!==hash(source.scope)||p.scope?.kind!==item.kind||p.scope.library!==item.library||p.scope.userId!==item.subjectBinding.userId||p.scope.closureId!==item.subjectBinding.closureId)throw Error('正式依据/用途/准确本人范围未匹配');
  authored(s,p.publishedBy);authored(s,source.recordedBy);
  if(!time(source.approvedAt)||!time(source.recordedAt)||source.approvedAt>source.recordedAt||!time(p.publishedAt)||p.publishedAt<source.recordedAt||p.publishedAt>s.now||!time(p.effectiveAt)||p.effectiveAt>s.now||!Number.isSafeInteger(p.retentionMilliseconds)||p.retentionMilliseconds<=0||p.retentionMilliseconds!==source.retentionMilliseconds)throw Error('正式发布/起效或明确保留期限待核对，不采用零期限默认');
  if(d.startFact!==item.startFact||d.startAt!==item.startAt||d.retainUntil!==d.startAt+p.retentionMilliseconds||!time(d.retainUntil)||d.retainUntil>s.now||d.action!=='delete')throw Error('原明确起算事实/期限未到或不匹配');
  return {policyId:p.id,policyVersion:p.version,sourceId:source.id,sourceVersion:source.version,sourceToken:hash({p,source,d}),basis:p.basis,purpose:p.purpose,startFact:d.startFact,startAt:d.startAt,retainUntil:d.retainUntil};
}
function contextForJob(options,job,actorKey) {
  const c=current(options);if(actorKey&&actorKey!==c.actorKey)throw Error('执行期间当前客服会话已变化');
  if(job.originScope!==options.storage.originScope||c.coverage?.originScope!==job.originScope)throw Error('当前origin与原清理范围不一致');
  privacyCleanupClosure(c.state,job.userId,job.closureId);return c;
}
function guard(options,job,item,actorKey) {
  const c=contextForJob(options,job,actorKey),inventory=privacyCleanupInventory(c.state,job.userId,job.closureId,{coverage:c.coverage}),actual=inventory.items.find(x=>x.id===item.id);
  if(!actual||actual.kind!=='cancelled-upload'||actual.sourceToken!==item.sourceToken||actual.ref!==item.ref||actual.library!==item.library)throw Error('原清理单准确来源已变化，须重新准备');
  const coverage=privacyCleanupCoverage(c.coverage,job.originScope);if(coverage.blockers.length)throw Error(coverage.blockers.join('；'));
  if(actual.blockers.length)throw Error(actual.blockers.join('；'));
  const binding=policy(c.state,actual);if(item.policy&&item.policy.sourceToken!==binding.sourceToken)throw Error('原已核正式政策来源已变化，须重新准备');return {c,actual,binding};
}
async function commit(storage,job) {const previous=job.revision;job.revision++;try{return await storage.saveJob(job,previous);}catch(error){job.revision=previous;throw error;}}
function itemRecord(item) {return {id:item.id,kind:item.kind,sourceId:item.sourceId,library:item.library,ref:item.ref,file:clone(item.file),sourceToken:item.sourceToken,status:'prepared',attempts:[],blockers:[...item.blockers]};}

export async function preparePrivacyCleanupJob(jobId,closureId,itemIds,options={}) {
  if(!text(jobId)||jobId.length>200||!Array.isArray(itemIds)||!itemIds.length||new Set(itemIds).size!==itemIds.length)throw Error('清理单及逐项编号无效');
  const c=current(options),closure=unique(c.state.privacyClosures,closureId,'原关闭回执'),inventory=privacyCleanupInventory(c.state,closure.userId,closureId,{coverage:c.coverage});
  if(options.inventoryToken!==inventory.sourceToken)throw Error('原清理目录版本已变化，请重新核对');
  if(c.coverage?.originScope!==options.storage.originScope)throw Error('当前origin覆盖来源不一致');
  const items=itemIds.map(id=>{const item=inventory.items.find(x=>x.id===id);if(!item||item.kind!=='cancelled-upload')throw Error('本子步只准备有明确原取消登记的文件，历史字段仍待政策/兼容接线');return itemRecord(item);});
  const existing=await options.storage.getJob(jobId);const after=current(options);
  if(after.actorKey!==c.actorKey||privacyCleanupInventory(after.state,closure.userId,closureId,{coverage:after.coverage}).sourceToken!==inventory.sourceToken)throw Error('准备期间原目录或当前会话已变化');
  if(existing){if(existing.closureId!==closureId||existing.userId!==closure.userId||hash(existing.items.map(x=>[x.id,x.sourceToken]))!==hash(items.map(x=>[x.id,x.sourceToken])))throw Error('原清理单不能改主体或覆盖来源');return existing;}
  const job={id:jobId,closureId,userId:closure.userId,originScope:options.storage.originScope,revision:0,status:'prepared',createdAt:after.state.now,preparedBy:after.by,scope:inventory.scope,items};
  for(const item of job.items){try{item.policy=guard(options,job,item,after.actorKey).binding;}catch(error){item.status='blocked';item.blockers=[error.message];}}
  return commit(options.storage,job); // Durable preparation, never a delete.
}

export async function executePrivacyCleanupItem(jobId,itemId,options={}) {
  const initial=current(options),job=await options.storage.getJob(jobId);if(!job)throw Error('原持久清理单不存在');
  contextForJob(options,job,initial.actorKey);const item=unique(job.items,itemId,'原逐项清理来源');
  if(item.status==='deleted'||item.status==='already_absent') {
    // Preserve original execution facts; a later same-ref upload is never deleted
    // by replaying this completed item. Re-read actual presence instead.
    const observation={by:initial.by,checkedAt:initial.state.now};
    try{observation.present=await options.storage.hasStoredRef(item.library,item.ref);contextForJob(options,job,initial.actorKey);observation.status=observation.present?'reappeared':'current_absent';}
    catch(error){observation.status='current_unverified';observation.reason=error.message;}
    item.currentObservation=observation;
    if(observation.status!=='current_absent')job.status='partial';
    return commit(options.storage,job);
  }
  let pre;
  try{pre=guard(options,job,item,initial.actorKey);}catch(error){item.status='blocked';item.blockers=[error.message];job.status='partial';return commit(options.storage,job);}
  item.policy=pre.binding;
  let bytes;
  try {bytes=await options.storage.readStoredRef(item.library,item.ref);guard(options,job,item,initial.actorKey);if(bytes&&(bytes.size!==item.file.size||bytes.type!==item.file.type))throw Error('原取消文件元数据与实际字节不一致');
    if(bytes){const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await bytes.arrayBuffer()))].map(x=>x.toString(16).padStart(2,'0')).join('');guard(options,job,item,initial.actorKey);if(item.ref.split(':').at(-1)!==digest)throw Error('原取消文件实际hash与ref不匹配');}
  }catch(error){item.status='failed';item.blockers=[error.message];job.status='partial';return commit(options.storage,job);}
  const attempt={number:item.attempts.length+1,status:'executing',startedAt:pre.c.state.now,by:pre.c.by,policy:pre.binding};item.attempts.push(attempt);item.status='executing';item.blockers=[];job.status='partial';
  await commit(options.storage,job); // Irreversible I/O cannot precede the durable executing record.
  try {
    guard(options,job,item,initial.actorKey);
    const io=await options.storage.deleteStoredRef(item.library,item.ref,{beforeDelete:()=>{guard(options,job,item,initial.actorKey);return true;}});
    attempt.io=io;attempt.status=io.status;item.status=io.status;
    try{const post=guard(options,job,item,initial.actorKey);attempt.completedAt=post.c.state.now;attempt.postcheck='verified';}catch(error){attempt.postcheck='changed';attempt.postcheckReason=error.message;}
  }catch(error){attempt.status='failed';attempt.error=error.message;item.status='failed';item.blockers=[error.message];}
  job.status=job.items.every(x=>['deleted','already_absent'].includes(x.status)&&x.attempts.at(-1)?.postcheck==='verified')?'scope_verified':'partial';
  try{return await commit(options.storage,job);}catch(error){const e=Error('执行结果journal保存失败；原executing记录保留，须回读核对；实际已发生的I/O不会回滚');e.ioResult=clone(attempt);e.cause=error;throw e;}
}

export function privacyCleanupJobView(s,rawActor,job) {
  const actor=resolveAccountActor(s,rawActor);privacyCleanupClosure(s,job.userId,job.closureId);
  const staff=actor.role==='group'&&actor.job==='support'&&actor.accountId&&actor.sessionId&&canAccountView(actor,'privacy');
  if(!staff&&!(actor.role==='user'&&actor.userId===job.userId))throw Error('无权查看原清理结果');
  return {id:job.id,closureId:job.closureId,status:job.status,scope:job.scope,revision:job.revision,items:job.items.map(item=>({id:staff?item.id:hash(item.id),kind:item.kind,status:item.status,blockers:clone(item.blockers),currentObservation:item.currentObservation?{status:item.currentObservation.status,checkedAt:item.currentObservation.checkedAt,present:item.currentObservation.present??null,reason:item.currentObservation.reason??null}:null,...(staff?{ref:item.ref,library:item.library}:{}),attempts:item.attempts.map(a=>({number:a.number,status:a.status,startedAt:a.startedAt,completedAt:a.completedAt??null,postcheck:a.postcheck,reason:a.error||a.postcheckReason||a.io?.readbackError||null,policy:a.policy,io:a.io?{status:a.io.status,transactionCommitted:a.io.transactionCommitted,absent:a.io.absent??null,originScope:a.io.originScope,cacheReleased:a.io.cacheReleased??null}:null}))}))};
}
