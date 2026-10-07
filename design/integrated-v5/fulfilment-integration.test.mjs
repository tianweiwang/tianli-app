import test from 'node:test';
import assert from 'node:assert/strict';
import {seed,reduce} from './engine.mjs';
import {fulfilmentBindingToken,fulfilmentView} from './fulfilment.mjs';
import {workTaskView} from './work-tasks.mjs';
import {createTaskReturnContext,taskNavigationTarget} from './task-navigation.mjs';
import {resolveAccountActor} from './staff-accounts.mjs';
const u={role:'user',userId:'u1'},t={role:'tech',techId:'lin'},g={role:'group',job:'support'},local={role:'store',storeId:'xingfu'},MIN=60000;
function fixture(){let s=seed(),n=0;const f={get s(){return s;},get b(){return s.bookings[0];},run(type,p={},a=u){let result;s=reduce(s,a,type,{requestId:'fulfilment-integration-'+ ++n,...p},r=>result=r);return result;},payload(extra={}){return {bookingId:f.b.id,bookingToken:fulfilmentBindingToken(f.b),version:s.fulfilmentRecords.find(x=>x.bookingId===f.b.id)?.version||0,...extra};},policy(){return f.run('fulfilment.policy-publish',{version:0,collectorMode:'tech-store-confirm',noticeMode:'appointment-exception',blockUnconfirmed:false,departureContactMinutes:'',escalateMinutes:'',effectiveAt:s.now,basis:'本地共享接线验收，不作为正式政策',reason:'明确测试夹具'},g);},finish(){f.run('clock.advance',{minutes:(f.b.startAt-s.now)/MIN});f.run('booking.start',{id:f.b.id},t);f.run('clock.advance',{minutes:f.b.duration});f.run('booking.finish',{id:f.b.id,mode:'normal'},t);},staff(job,storeId){const row=f.run('account.create',{name:'验收'+job,reason:'本地合成账号'},f.admin),granted=f.run('account.grant',{id:row.id,version:row.version,job,...(storeId?{storeId}:{}),reason:'原岗位授权'},f.admin);const entry=f.run('account.enter',{accountId:row.id,grantId:granted.grants.at(-1).id});return resolveAccountActor(s,entry);}};const entry=f.run('account.enter',{accountId:'DEMO-ADMIN',grantId:'DEMO-ADMIN-GRANT'});f.admin=resolveAccountActor(s,entry);f.run('booking.create',{storeId:'xingfu',serviceId:'relax',regionId:'home',techId:'lin',startAt:s.now+240*MIN,mode:'specified',genderPreference:'any',contactName:'Demo顾客',phone:'13800000001',healthConsent:true,identityVerified:true,adultConfirmed:true});f.run('booking.pay',{id:f.b.id,outcome:'success'});f.run('booking.accept',{id:f.b.id},t);return f;}

test('原预约完成在真实reduce只新建待确认安全来源，无配置不虚造时间或安全事实',()=>{
 const f=fixture();f.finish();const exit=f.s.fulfilmentDepartures[0];assert.equal(f.b.status,'done');assert.equal(f.b.payment.amountCents,29800);assert.equal(f.b.payment.refundedCents,0);assert.equal(exit.status,'pending');assert.equal(exit.safeLeftFact??null,null);assert.equal(exit.policySnapshot,null);assert.equal(exit.contactDueAt,null);assert.equal(exit.escalationDueAt,null);
 const old=structuredClone(f.b);const p=f.payload({departureId:exit.id,version:exit.version,safeLeft:true,occurredAt:f.s.now,evidence:'本地技师实际确认',positionMode:'none'});f.run('fulfilment.departure-confirm',p,t);assert.equal(f.s.fulfilmentDepartures[0].status,'confirmed');assert.deepEqual(f.b,old);assert.equal(f.s.fulfilmentPolicies.length,0);
});

test('原门店补录→原技师确认→客服核实，待办返回按来源及本店验证且不泄露事实正文',()=>{
 const f=fixture();f.policy();const fact=f.run('fulfilment.fact-record',f.payload({kind:'contact',occurredAt:f.s.now,evidence:'私密联系说明',positionMode:'none'}),local);
 let task=workTaskView(f.s,g).tasks.find(x=>x.sourceId===fact.id);assert.equal(task.status,'waiting');assert.ok(!JSON.stringify(task).includes('私密联系说明'));
 f.run('fulfilment.fact-confirm',f.payload({factId:fact.id,decision:'accept',reason:'本人核对实际发生'}),t);task=workTaskView(f.s,g).tasks.find(x=>x.sourceId===fact.id);assert.equal(task.status,'open');
 const hash='/group/tasks?category=fulfilment&status=active&q='+f.b.id,context=createTaskReturnContext(f.s,g,{taskKey:task.id,listHash:hash,task,token:'fulfilment-navigation-proof'});assert.equal(taskNavigationTarget(f.s,g,context,'/group/fulfilment/'+f.b.id),true);
 const old=structuredClone(f.b);f.run('fulfilment.fact-verify',f.payload({factId:fact.id,decision:'verified',evidence:'实际证据已核对'}),g);assert.equal(workTaskView(f.s,g).tasks.find(x=>x.sourceId===fact.id).status,'done');assert.deepEqual(f.b,old);
 assert.equal(taskNavigationTarget(f.s,{role:'store',storeId:'silver'},context,'/store/fulfilment/'+f.b.id),false);
 assert.equal(taskNavigationTarget(f.s,g,context,'/group/fulfilment/OTHER'),false);
});

test('实际安全接管责任失权在统一待办显示无效，新的真实职责接管恢复，资金保持原事实',()=>{
 const f=fixture();f.policy();f.finish();const support=f.staff('support'),replacement=f.staff('support');f.run('fulfilment.duty-save',{version:0,scope:'group',storeId:null,accountId:support.accountId,grantId:support.grantId,startAt:f.s.now,endAt:f.s.now+60*MIN,enabled:true,reason:'本地实际岗位值班夹具'},g);f.run('fulfilment.duty-save',{version:0,scope:'group',storeId:null,accountId:replacement.accountId,grantId:replacement.grantId,startAt:f.s.now,endAt:f.s.now+60*MIN,enabled:true,reason:'第二位实际职责夹具'},g);
 const exitPayload=extra=>f.payload({departureId:f.s.fulfilmentDepartures[0].id,version:f.s.fulfilmentDepartures[0].version,...extra});f.run('fulfilment.departure-help',exitPayload({reason:'Demo离开前求助',positionMode:'none'}),t);f.run('fulfilment.departure-takeover',exitPayload({reason:'当前值班人员实际接管'}),support);
 let task=workTaskView(f.s,g).tasks.find(x=>x.category==='safe-departure');assert.equal(task.ownerValid,true);f.run('account.status',{id:support.accountId,version:f.s.staffAccounts.find(x=>x.id===support.accountId).version,enabled:false,reason:'本地失效责任验收'},f.admin);task=workTaskView(f.s,g).tasks.find(x=>x.category==='safe-departure');assert.equal(task.ownerValid,false);assert.match(task.ownerLabel,/失效/);
 assert.throws(()=>f.run('fulfilment.departure-resolve',exitPayload({method:'onsite-verification',occurredAt:f.s.now,evidence:'失权不能结案'}),support),/失效/);
 f.run('fulfilment.departure-takeover',exitPayload({reason:'另一有效值班人员接管'}),replacement);const old=structuredClone(f.b);f.run('fulfilment.departure-resolve',exitPayload({method:'onsite-verification',occurredAt:f.s.now,evidence:'本地现场核实事实'}),replacement);assert.equal(workTaskView(f.s,g).tasks.find(x=>x.category==='safe-departure').status,'done');assert.deepEqual(f.b,old);assert.equal(fulfilmentView(f.s,u,f.b.id).facts.length,0);
});
