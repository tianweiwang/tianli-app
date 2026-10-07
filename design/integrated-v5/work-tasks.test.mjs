import test from 'node:test';
import assert from 'node:assert/strict';
import {seed as engineSeed,reduce} from './engine.mjs';
import {upgradeAccounts,accountCommand,resolveAccountActor} from './staff-accounts.mjs';
import {bookingTaskRows} from './work-booking.mjs';
import {upgradeWorkTasks,workTaskView,workTaskCommand} from './work-tasks.mjs';
const user={role:'user',userId:'u1'},store={role:'store',storeId:'xingfu'},support={role:'group',job:'support'};
let seq=0;
const ctx=s=>({id:p=>p+(++s.seq),fail:m=>{throw Error(m)},log:(row,text)=>{s.logs??=[];s.logs.push({id:row.id,text});}});
function staff(s,job,name=job,storeId='xingfu') {
  upgradeAccounts(s);const command=(a,type,p)=>accountCommand(s,a,type,{requestId:'actor-'+(++seq),...p},ctx(s));
  const admin=command(user,'account.enter',{accountId:'DEMO-ADMIN',grantId:'DEMO-ADMIN-GRANT'});
  let account=command(admin,'account.create',{name,reason:'测试授权'});account=command(admin,'account.grant',{id:account.id,version:account.version,job,...(job.startsWith('store-')?{storeId}:{}),reason:'明确测试岗位'});
  const enter=()=>resolveAccountActor(s,command(user,'account.enter',{accountId:account.id,grantId:account.grants[0].id}));
  return {actor:enter(),enter,account:()=>s.staffAccounts.find(x=>x.id===account.id),admin,command};
}
function fixture() {
  const s=engineSeed();
  s.bookings=[{id:'B1',userId:'u1',storeId:'xingfu',techId:'lin',serviceId:'relax',status:'waiting',confirmationPhase:'store',startAt:s.now+4*3600000,createdAt:s.now,phone:'13812345678',attention:'不得泄露的私人事项',payment:{id:'P1',status:'success',amountCents:29800,refundedCents:0},extensions:[],refunds:[],disputes:[],assistance:[{id:'AS1',status:'open',createdAt:s.now,reason:'不得泄露的协助原文',createdBy:{role:'store',accountId:'not-owner'}}],round:{id:'R1',startedAt:s.now,deadline:s.now+1800000,techDeadline:s.now+600000,completedAt:null},rounds:[],changeHistory:[],events:[]}];
  return s;
}
const get=(s,a,id='booking-assistance:AS1:reply')=>workTaskView(s,a).tasks.find(x=>x.id===id);
function change(s,a,type,id='booking-assistance:AS1:reply',p={}) {const task=get(s,a,id);return workTaskCommand(s,a,type,{id,sourceToken:task?.sourceToken,version:task?.assignmentVersion,requestId:'work-'+(++seq),...p},ctx(s));}

test('旧schema只增量加入责任容器；来源投影纯读且不输出原文和手机号',()=>{
  const s=fixture(),before=structuredClone(s);delete s.workTaskAssignments;delete s.workTaskRequests;
  const untouched=structuredClone(s),view=workTaskView(s,store);assert.deepEqual(s,untouched);assert.doesNotMatch(JSON.stringify(view),/不得泄露|13812345678|not-owner/);
  upgradeWorkTasks(s);const upgraded=structuredClone(s);upgradeWorkTasks(s);assert.deepEqual(s,upgraded);assert.deepEqual(s.bookings,before.bookings);assert.equal(get(s,store).ownerAccountId,null);assert.equal(get(s,store).ownerLabel,'待认领');assert.equal(get(s,store).dueAt,null);
});
test('派单当前轮与历史轮分别投影；技师等待、原截止和新轮编号保留',()=>{
  const s=fixture(),b=s.bookings[0];b.rounds=[{id:'OLD',startedAt:s.now-3600000,deadline:s.now-1800000,completedAt:s.now-3000000}];b.confirmationPhase='tech';
  let rows=bookingTaskRows(s).filter(x=>x.category==='dispatch');assert.equal(rows.find(x=>x.sourceId==='OLD').status,'done');assert.equal(rows.find(x=>x.sourceId==='R1').status,'waiting');assert.equal(rows.find(x=>x.sourceId==='R1').dueAt,b.round.techDeadline);
  b.confirmationPhase='store';rows=bookingTaskRows(s);assert.equal(rows.find(x=>x.sourceId==='R1').status,'open');assert.equal(rows.find(x=>x.sourceId==='R1').dueAt,b.round.deadline);b.status='cancelled';assert.equal(bookingTaskRows(s).find(x=>x.sourceId==='R1').status,'done');
});
test('退款按支付明细保留成功历史，同时出现失败重试和未知查询，父状态不吞子待办',()=>{
  const s=fixture();s.bookings[0].refunds=[{id:'RF1',status:'processing',version:2,createdAt:s.now,executions:[{paymentId:'P1',refundNo:'RF1-P1',status:'success'},{paymentId:'X1',refundNo:'RF1-X1',status:'failed'},{paymentId:'X2',refundNo:'RF1-X2',status:'processing'}]}];
  const rows=bookingTaskRows(s).filter(x=>x.refundId==='RF1');assert.equal(rows.length,3);assert.equal(rows.find(x=>x.paymentId==='P1').status,'done');assert.deepEqual(rows.find(x=>x.paymentId==='X1').commands,['booking.refund-pay']);assert.deepEqual(rows.find(x=>x.paymentId==='X2').commands,['booking.refund-query']);assert.ok(rows.every(x=>x.dueAt===null));
  s.bookings[0].refunds[0].status='offered';assert.ok(bookingTaskRows(s).filter(x=>x.refundId==='RF1'&&x.paymentId!=='P1').every(x=>x.status==='waiting'&&!x.commands.length));
});
test('售后原deadline与中止待确认保持，不把等待用户或退款申请当整案完成',()=>{
  const s=fixture(),b=s.bookings[0];b.refunds=[{id:'RF1',status:'escalated',deadline:s.now-1,createdAt:s.now-100,version:1}];b.disputes=[{id:'DS1',kind:'interruption',status:'awaiting-user',createdAt:s.now-100,deadline:null,refundId:'RF1'}];
  let rows=bookingTaskRows(s);assert.equal(rows.find(x=>x.sourceId==='RF1').dueAt,s.now-1);assert.equal(rows.find(x=>x.sourceId==='DS1').status,'waiting');b.refunds[0].status='offered';b.refunds[0].deadline=null;b.refunds[0].explicitAcceptance=true;rows=bookingTaskRows(s);assert.equal(rows.find(x=>x.sourceId==='RF1').status,'waiting');assert.equal(rows.find(x=>x.sourceId==='RF1').dueAt,null);
});
test('安全原接报人唯一且待接报期限原样；接报后仍open并无新结案SLA',()=>{
  const s=fixture();s.safety=[{id:'SF1',bookingId:'B1',storeId:'xingfu',status:'open',stage:'pending',createdAt:s.now,ackDeadline:s.now+180000,escalationDeadline:s.now+360000,responsibleName:'原责任人',reason:'不得泄露的安全原文'}];
  let task=get(s,support,'booking-safety:SF1:handle');assert.equal(task.dueAt,s.now+180000);assert.equal(task.ownerAccountId,null);assert.equal(task.ownerLabel,'原责任人（工作账号待核对）');assert.equal(task.ownerValid,null);assert.equal(task.canClaim,false);assert.equal(task.canAssign,false);assert.throws(()=>change(s,support,'work.assign',task.id,{accountId:'x',grantId:'x',reason:'不能另建'}),/原业务/);
  const account=staff(s,'support');s.safety[0].acknowledgedAt=s.now;s.safety[0].acknowledgedBy={accountId:account.actor.accountId};s.safety[0].stage='acknowledged';task=get(s,account.actor,task.id);assert.equal(task.status,'open');assert.equal(task.dueAt,null);assert.equal(task.ownerAccountId,null);assert.equal(task.mine,false);s.safety[0].status='closed';assert.equal(get(s,support,task.id).status,'done');
});
test('账号、岗位、来源及单店权限同时核验；伪造actor不扩权',()=>{
  const s=fixture(),manager=staff(s,'store-manager'),foreign=staff(s,'store-manager','外店','silver'),finance=staff(s,'store-finance'),admin=resolveAccountActor(s,manager.admin);
  assert.ok(get(s,manager.actor));assert.equal(workTaskView(s,foreign.actor).tasks.length,0);assert.equal(get(s,finance.actor),undefined);assert.equal(workTaskView(s,admin).tasks.length,0);assert.equal(workTaskView(s,{role:'tech',techId:'lin'}).tasks.length,0);
  assert.equal(get(s,{...foreign.actor,storeId:'xingfu',role:'group',job:'support'}),undefined);assert.throws(()=>workTaskCommand(s,finance.actor,'work.claim',{id:'booking-assistance:AS1:reply',requestId:'x'},ctx(s)),/无权/);
});
test('候选只含同端同店有效授权；集团不能认领门店派单或将责任跨店转移',()=>{
  const s=fixture(),a=staff(s,'store-manager','本店甲'),b=staff(s,'store-manager','本店乙'),foreign=staff(s,'store-manager','外店','silver'),finance=staff(s,'store-finance'),group=staff(s,'support');
  const task=get(s,a.actor),ids=task.candidates.map(x=>x.accountId);assert.deepEqual(new Set(ids),new Set([a.actor.accountId,b.actor.accountId]));assert.ok(!ids.includes(finance.actor.accountId));assert.ok(!ids.includes(foreign.actor.accountId));
  assert.throws(()=>change(s,a.actor,'work.assign',task.id,{accountId:foreign.actor.accountId,grantId:foreign.actor.grantId,reason:'跨店'}),/授权/);assert.equal(get(s,group.actor,'booking-round:R1:dispatch').canAssign,false);
});
test('责任认领实际账号与版本留痕；不同员工同请求号不串用，已认领须显式分派',()=>{
  const s=fixture(),a=staff(s,'store-manager','甲'),b=staff(s,'store-manager','乙');change(s,a.actor,'work.claim',undefined,{requestId:'shared'});assert.equal(get(s,a.actor).mine,true);assert.equal(get(s,b.actor).mine,false);assert.equal(get(s,a.actor).assignmentVersion,1);assert.equal(get(s,b.actor).canClaim,false);assert.throws(()=>change(s,b.actor,'work.claim',undefined,{requestId:'other'}),/有效负责人/);
  change(s,b.actor,'work.assign',undefined,{accountId:b.actor.accountId,grantId:b.actor.grantId,reason:'明确转派',requestId:'shared'});assert.equal(get(s,b.actor).ownerAccountId,b.actor.accountId);assert.equal(s.workTaskRequests.length,2);assert.equal(s.workTaskAssignments[0].history[0].by.accountId,a.actor.accountId);assert.equal(s.workTaskAssignments[0].history[1].to.accountName,'乙');assert.doesNotMatch(JSON.stringify(s.workTaskAssignments),/sessionId/);
});
test('同员工新会话重复请求幂等；旧版本、旧阶段、请求内容变动均拒绝',()=>{
  const s=fixture(),a=staff(s,'store-manager'),task=get(s,a.actor),p={id:task.id,sourceToken:task.sourceToken,version:0,requestId:'once'};
  const first=workTaskCommand(s,a.actor,'work.claim',p,ctx(s));assert.deepEqual(workTaskCommand(s,a.enter(),'work.claim',p,ctx(s)),first);assert.equal(s.workTaskAssignments[0].version,1);
  assert.throws(()=>workTaskCommand(s,a.actor,'work.claim',{...p,reason:'变更内容'},ctx(s)),/同一提交/);
  assert.throws(()=>workTaskCommand(s,a.actor,'work.assign',{...p,requestId:'new',accountId:a.actor.accountId,grantId:a.actor.grantId,reason:'旧版本'},ctx(s)),/版本|责任记录/);
  const current=get(s,a.actor);s.bookings[0].assistance[0].status='closed';assert.throws(()=>workTaskCommand(s,a.actor,'work.assign',{...p,requestId:'ended',version:current.assignmentVersion,accountId:a.actor.accountId,grantId:a.actor.grantId,reason:'旧阶段'},ctx(s)),/阶段|变化/);assert.equal(get(s,a.actor).status,'done');
});
test('来源仍open但版本变化阻止旧来源token；责任更新不能改变订单和期限',()=>{
  const s=fixture(),a=staff(s,'store-manager'),before=structuredClone(s.bookings),task=get(s,a.actor);change(s,a.actor,'work.claim');assert.deepEqual(s.bookings,before);
  const old=get(s,a.actor,'booking-round:R1:dispatch');s.bookings[0].techId='zhou';assert.throws(()=>change(s,a.actor,'work.assign',old.id,{sourceToken:old.sourceToken,accountId:a.actor.accountId,grantId:a.actor.grantId,reason:'旧来源'}),/原业务阶段/);assert.equal(get(s,a.actor).dueAt,task.dueAt);
});
test('撤销负责授权标出需重新分派；被撤销的旧session连幂等重放也拒绝',()=>{
  const s=fixture(),a=staff(s,'store-manager','甲'),b=staff(s,'store-manager','乙'),task=get(s,a.actor),p={id:task.id,sourceToken:task.sourceToken,version:0,requestId:'stable'};
  workTaskCommand(s,a.actor,'work.claim',p,ctx(s));const account=a.account();a.command(a.admin,'account.status',{id:account.id,version:account.version,enabled:false,reason:'停止授权'});
  const next=get(s,b.actor);assert.equal(next.ownerValid,false);assert.match(next.ownerLabel,/重新分派/);assert.equal(next.canClaim,true);assert.throws(()=>workTaskCommand(s,a.actor,'work.claim',p,ctx(s)),/失效/);change(s,b.actor,'work.claim');assert.equal(get(s,b.actor).ownerAccountId,b.actor.accountId);
});
test('自由演示可明确分派实际员工但不可按角色冒认本人',()=>{
  const s=fixture(),a=staff(s,'store-manager');assert.equal(get(s,store).canClaim,false);assert.throws(()=>change(s,store,'work.claim'),/实际工作账号/);change(s,store,'work.assign',undefined,{accountId:a.actor.accountId,grantId:a.actor.grantId,reason:'演示人工分派'});assert.equal(get(s,a.actor).mine,true);assert.equal(get(s,store).mine,false);
});
test('自由模式集团岗位切到门店后忽略残留job，账号门店仍以会话岗位和范围为准',()=>{
  const s=fixture(),manager=staff(s,'store-manager'),finance=staff(s,'store-finance'),base=workTaskView(s,store);
  for(const job of ['finance','support','warehouse','operations']) assert.deepEqual(workTaskView(s,{...store,job}),base);
  const stale={role:'store',storeId:'xingfu',job:'finance'},task=get(s,stale),p={id:task.id,sourceToken:task.sourceToken,version:0,requestId:'role-switch',accountId:manager.actor.accountId,grantId:manager.actor.grantId,reason:'返回门店后明确分派'};
  const first=workTaskCommand(s,stale,'work.assign',p,ctx(s));assert.deepEqual(workTaskCommand(s,{...stale,job:'support'},'work.assign',p,ctx(s)),first);assert.equal(s.workTaskAssignments.length,1);assert.equal(s.workTaskAssignments[0].history[0].by.job,null);
  assert.equal(get(s,{...finance.actor,job:'store-manager'}),undefined);assert.ok(get(s,{...manager.actor,job:'finance'}));assert.equal(workTaskView(s,{...stale,storeId:'silver'}).tasks.length,0);assert.throws(()=>change(s,stale,'work.claim'),/实际工作账号/);
});
test('发票驳回重提及红冲从原状态重新出现，历史派单不伪造原办理人',()=>{
  const s=fixture(),a=staff(s,'store-finance');s.serviceInvoices=[{id:'SI1',bookingId:'B1',storeId:'xingfu',status:'pending',version:1,createdAt:s.now}];
  let task=get(s,a.actor,'invoice:SI1:issue');assert.equal(task.status,'open');change(s,a.actor,'work.claim',task.id);s.serviceInvoices[0].status='rejected';s.serviceInvoices[0].version++;assert.equal(get(s,a.actor,task.id).status,'done');s.serviceInvoices[0].status='pending';s.serviceInvoices[0].version++;assert.equal(get(s,a.actor,task.id).status,'open');assert.notEqual(get(s,a.actor,task.id).sourceToken,task.sourceToken);
  s.serviceInvoices[0].status='red_pending';assert.equal(get(s,a.actor,task.id).status,'done');assert.equal(get(s,a.actor,'invoice:SI1:red').status,'open');assert.equal(get(s,a.actor,'invoice:SI1:red').ownerAccountId,null);
});
test('商品售后从客服转财务后，旧负责人的岗位不再有效；推广门店只读',()=>{
  const s=fixture(),a=staff(s,'support'),finance=staff(s,'finance'),local=staff(s,'store-manager');s.goods=[{id:'G1',userId:'u1',status:'paid',payment:{status:'success'},source:{storeId:'xingfu'},cases:[{id:'GC1',status:'requested',createdAt:s.now}],refunds:[]}];
  change(s,a.actor,'work.claim','goods-case:GC1:handling');s.goods[0].cases[0].status='refund_ready';const task=get(s,finance.actor,'goods-case:GC1:handling');assert.equal(task.ownerValid,false);assert.match(task.ownerLabel,/重新分派/);assert.equal(task.canClaim,true);assert.equal(get(s,local.actor,task.id).canAssign,false);assert.equal(get(s,a.actor,task.id),undefined);
});

test('真实主款与加时退款链：责任认领不动资金，失败保留待办，查询成功后自动成为已办',()=>{
  let s=engineSeed();const manager=staff(s,'store-manager').actor,finance=staff(s,'store-finance').actor,tech={role:'tech',techId:'lin'},clock={role:'group',job:'all'};
  const run=(a,type,p={})=>{s=reduce(s,a,type,{requestId:'integrated-work-'+(++seq),...p});};
  const b=()=>s.bookings.at(-1),refund=()=>b().refunds.at(-1);
  run(user,'booking.create',{storeId:'xingfu',serviceId:'relax',regionId:'home',techId:'lin',mode:'specified',startAt:s.now+4*3600000,contactName:'实际测试预约',phone:'13812345678',healthConsent:true,identityVerified:true,adultConfirmed:true});
  run(user,'booking.pay',{id:b().id,outcome:'success'});run(tech,'booking.accept',{id:b().id});run(clock,'clock.advance',{minutes:240});run(tech,'booking.start',{id:b().id});run(tech,'booking.extension-create',{id:b().id});run(user,'booking.extension-pay',{id:b().id,extensionId:b().extensions[0].id,outcome:'success'});run(clock,'clock.advance',{minutes:90});run(tech,'booking.finish',{id:b().id,mode:'normal'});
  const payments=[b().payment,...b().extensions];run(user,'booking.refund-request',{id:b().id,reason:'核对主单与加时退款',requests:payments.map(x=>({paymentId:x.id,amountCents:1000}))});run(manager,'booking.refund-review',{id:b().id,refundId:refund().id,decision:'approve',reason:'同意原申请'});
  const amounts=()=>({status:b().status,payment:b().payment,extensions:b().extensions,round:b().round,refundStatus:refund().status,refundAmount:refund().amountCents});
  const extensionTask=workTaskView(s,finance).tasks.find(x=>x.paymentId===payments[1].id),before=structuredClone(amounts());run(finance,'work.claim',{id:extensionTask.id,sourceToken:extensionTask.sourceToken,version:extensionTask.assignmentVersion});assert.deepEqual(amounts(),before);
  run(finance,'booking.refund-pay',{id:b().id,refundId:refund().id,paymentId:payments[0].id,outcome:'success'});run(finance,'booking.refund-pay',{id:b().id,refundId:refund().id,paymentId:payments[1].id,outcome:'failed'});
  let tasks=workTaskView(s,finance).tasks.filter(x=>x.refundId===refund().id);assert.equal(tasks.find(x=>x.paymentId===payments[0].id).status,'done');assert.deepEqual(tasks.find(x=>x.paymentId===payments[1].id).commands,['booking.refund-pay']);const refundNo=refund().executions[1].refundNo;
  run(finance,'booking.refund-pay',{id:b().id,refundId:refund().id,paymentId:payments[1].id,outcome:'processing'});assert.deepEqual(get(s,finance,extensionTask.id).commands,['booking.refund-query']);run(finance,'booking.refund-query',{id:b().id,refundId:refund().id,paymentId:payments[1].id,outcome:'success'});
  assert.equal(refund().status,'success');assert.equal(refund().executions[1].refundNo,refundNo);tasks=workTaskView(s,finance).tasks.filter(x=>x.refundId===refund().id);assert.ok(tasks.every(x=>x.status==='done'&&!x.canAssign));assert.equal(get(s,finance,extensionTask.id).ownerAccountId,finance.accountId);assert.equal(b().status,'done');assert.equal(b().payment.refundedCents+b().extensions[0].refundedCents,2000);
});
