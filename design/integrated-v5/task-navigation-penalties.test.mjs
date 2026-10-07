import test from 'node:test';
import assert from 'node:assert/strict';
import { seed, reduce } from './engine.mjs';
import { resolveAccountActor } from './staff-accounts.mjs';
import { technicianPenaltyView } from './technician-penalties.mjs';
import { workTaskView } from './work-tasks.mjs';
import { createTaskReturnContext, taskReturnTarget } from './task-navigation.mjs';

const user = {role:'user',userId:'u1'}, tech = {role:'tech',techId:'lin'};
const store = {role:'store',storeId:'xingfu'};
const list = '/group/tasks?category=technician-penalty-appeal&status=open&q=TP&owner=unassigned&store=xingfu';
function fixture() {
  let s = seed(), seq = 0;
  const run = (actor, command, p = {}) => {
    let result;
    s = reduce(s, actor, command, {requestId:'penalty-nav-'+ ++seq,reason:'隔离导航验收',...p}, value => result=value);
    return result;
  };
  const adminSession = run(user,'account.enter',{accountId:'DEMO-ADMIN',grantId:'DEMO-ADMIN-GRANT'});
  const admin = resolveAccountActor(s,adminSession);
  let account = run(admin,'account.create',{name:'导航验收集团客服'});
  account = run(admin,'account.employment',{id:account.id,version:account.version,employmentStatus:'active',reference:'DEMO-NAV-EMP',verifiedAt:s.now});
  account = run(admin,'account.grant',{id:account.id,version:account.version,job:'support'});
  const session = run(user,'account.enter',{accountId:account.id,grantId:account.grants.at(-1).id});
  const actor = resolveAccountActor(s,session);
  const startAt = Math.ceil((s.now+5*3600000)/1800000)*1800000;
  run(user,'booking.create',{storeId:'xingfu',serviceId:'neck',regionId:'home',techId:'lin',mode:'specified',genderPreference:'any',startAt,contactName:'导航演示本人',phone:'13800000001',healthConsent:true,identityVerified:true,adultConfirmed:true});
  const bookingId = s.bookings.at(-1).id;
  run(user,'booking.pay',{id:bookingId,outcome:'success'});
  run(tech,'booking.accept',{id:bookingId});
  run(user,'clock.advance',{minutes:(startAt-s.now)/60000});
  run(tech,'booking.start',{id:bookingId});
  run(user,'clock.advance',{minutes:45});
  run(tech,'booking.finish',{id:bookingId,mode:'normal'});
  run(user,'care.case-create',{bookingId,category:'attitude',description:'导航验收投诉正文',evidence:'内部证据不得复制到导航'});
  const caseId = s.serviceCareCases.at(-1).id, care=()=>s.serviceCareCases.find(x=>x.id===caseId);
  run(store,'care.case-respond',{id:caseId,version:care().version,decision:'respond',publicReply:'已核实一般问题',internalNote:'内部处理记录',specialistAction:'penalty'});
  run(user,'care.case-answer',{id:caseId,version:care().version,decision:'accept'});
  const candidate=technicianPenaltyView(s,store).sourceCases.find(x=>x.caseId===caseId);
  assert.ok(candidate);
  run(store,'penalty.warning-record',{caseId,actionIndex:candidate.actionIndex,caseVersion:candidate.caseVersion,sourceToken:candidate.sourceToken,reference:'DEMO-NAV-WARNING',occurredAt:s.now,reason:'已核实的公开警告依据'});
  const penaltyId=s.technicianPenalties.at(-1).id;
  run(store,'care.case-close',{id:caseId,version:care().version,conclusion:'实际一般警告已记录'});
  const own=technicianPenaltyView(s,tech).penalties.find(x=>x.id===penaltyId);
  run(tech,'penalty.appeal',{id:penaltyId,version:own.version,sourceToken:own.sourceToken,reason:'本人一次申诉公开理由'});
  return {get s(){return s;},run,actor,admin,bookingId,caseId,penaltyId};
}
function task(f,s=f.s) { return workTaskView(s,f.actor).tasks.find(x=>x.category==='technician-penalty-appeal'&&x.sourceId===f.penaltyId); }
function context(f,s=f.s,a=f.actor,t=task(f,s)) { return createTaskReturnContext(s,a,{taskKey:t.id,task:t,listHash:list,token:'penalty-nav-context'}); }
const detail=f=>'/group/penalties/'+f.penaltyId;

test('真实本人申诉从客服待办进入原警告，相关原案和预约保留筛选返回且导航无写入',()=>{
  const f=fixture(),before=JSON.stringify(f.s),c=context(f);
  assert.equal(c.targetPath,detail(f));
  for(const path of [detail(f),'/group/penalties','/group/care/case/'+f.caseId,'/group/bookings/'+f.bookingId]) assert.equal(taskReturnTarget(f.s,f.actor,c,path),list);
  assert.doesNotMatch(JSON.stringify(c),/导航验收投诉正文|内部证据|公开警告依据|本人一次申诉公开理由|13800000001/);
  assert.equal(JSON.stringify(f.s),before);
});

for(const decision of ['maintain','revoke']) test('实际集团'+decision+'后待办结束仍能返回原筛选',()=>{
  const f=fixture(),c=context(f),row=technicianPenaltyView(f.s,f.actor).penalties.find(x=>x.id===f.penaltyId);
  const original=structuredClone(f.s.technicianPenalties[0].decision),bookings=structuredClone(f.s.bookings);
  f.run(f.actor,'penalty.appeal-review',{id:row.id,version:row.version,sourceToken:row.sourceToken,decision,reference:'DEMO-REVIEW-'+decision,occurredAt:f.s.now,reason:'集团实际复核公开依据'});
  assert.equal(task(f).status,'done');
  assert.equal(taskReturnTarget(f.s,f.actor,c,detail(f)),list);
  assert.equal(context(f).targetPath,detail(f));
  assert.deepEqual(f.s.technicianPenalties[0].decision,original);
  assert.deepEqual(f.s.bookings,bookings);
});

test('串号或不唯一的原警告、投诉、预约与专项不可通过保存上下文继续进入',()=>{
  const f=fixture(),c=context(f),t=task(f);
  for(const change of [
    s=>s.technicianPenalties.push(structuredClone(s.technicianPenalties[0])),
    s=>s.serviceCareCases.push(structuredClone(s.serviceCareCases[0])),
    s=>s.bookings.push(structuredClone(s.bookings[0])),
    s=>s.technicianPenalties[0].source.caseId='SC-WRONG',
    s=>s.technicianPenalties[0].bookingId='BK-WRONG',
    s=>s.technicianPenalties[0].storeId='silver',
    s=>s.technicianPenalties[0].appeal=null,
    s=>s.serviceCareCases[0].specialistActions[0].penaltyId='TP-WRONG',
    s=>s.serviceCareCases[0].description='已被替换的来源正文'
  ]) {
    const damaged=structuredClone(f.s); change(damaged); const before=JSON.stringify(damaged);
    assert.equal(taskReturnTarget(damaged,f.actor,c,detail(f)),null);
    assert.throws(()=>context(f,damaged,f.actor,t),/失效/);
    assert.equal(JSON.stringify(damaged),before);
  }
});

test('任意任务载荷、另一档案、跨端及其他岗位路径不扩大原客服办理范围',()=>{
  const f=fixture(),c=context(f),t=task(f);
  for(const path of ['/group/penalties/TP-OTHER','/group/care/case/SC-OTHER','/store/penalties/'+f.penaltyId,detail(f)+'?caseId=SC-OTHER','//evil.test/','/group/penalties/%2e%2e/accounts']) assert.equal(taskReturnTarget(f.s,f.actor,c,path),null);
  for(const changed of [{...t,id:'invented:task'}, {...t,bookingId:'BK-OTHER'}, {...t,storeId:'silver'}, {...t,routes:{group:'/group/penalties/TP-OTHER'}}]) assert.throws(()=>context(f,f.s,f.actor,changed),/失效/);
  for(const a of [store,{role:'store',storeId:'silver'},{role:'group',job:'finance'},{role:'group',job:'operations'},tech,user,f.admin]) {
    assert.equal(taskReturnTarget(f.s,a,c,detail(f)),null);
    assert.throws(()=>context(f,f.s,a,{...t,allowedJobs:{group:['finance','operations','account-admin'],store:['store-manager']}}));
  }
});

test('原客服授权撤回后旧待办上下文和新进入均拒绝',()=>{
  const f=fixture(),c=context(f),t=task(f),account=f.s.staffAccounts.find(x=>x.id===f.actor.accountId);
  f.run(f.admin,'account.revoke',{id:account.id,version:account.version,grantId:f.actor.grantId});
  assert.equal(taskReturnTarget(f.s,f.actor,c,detail(f)),null);
  assert.throws(()=>context(f,f.s,f.actor,t));
});

test('原投诉待办只可沿已核验的本案专项警告继续办理并返回',()=>{
  const f=fixture(),t=workTaskView(f.s,f.actor).tasks.find(x=>x.category==='care'&&x.sourceId===f.caseId);
  assert.ok(t);
  const c=createTaskReturnContext(f.s,f.actor,{taskKey:t.id,task:t,listHash:'/group/tasks?category=care&status=done',token:'care-nav-warning'});
  assert.equal(taskReturnTarget(f.s,f.actor,c,detail(f)),'/group/tasks?category=care&status=done');
  assert.equal(taskReturnTarget(f.s,f.actor,c,'/group/penalties/TP-OTHER'),null);
});
