import test from 'node:test';
import assert from 'node:assert/strict';
import {seed,reduce} from './engine.mjs';
import {resolveAccountActor} from './staff-accounts.mjs';
import {workTaskView} from './work-tasks.mjs';
import {workEscalationView} from './work-escalation.mjs';
import {createTaskReturnContext,taskReturnTarget,taskNavigationTarget} from './task-navigation.mjs';
import {staffView} from './staff.mjs';
const user={role:'user',userId:'u1'},tech={role:'tech',techId:'lin'},MIN=60000;
function fixture(){
 let s=seed(),n=0;const f={get s(){return s;},get b(){return s.bookings[0];},run(type,p={},a=user){let result;s=reduce(s,a,type,{requestId:'escalation-shared-'+ ++n,...p},r=>result=r);return result;},staff(job,name,storeId){const row=f.run('account.create',{name,reason:'本地工作责任验收'},f.admin),g=f.run('account.grant',{id:row.id,version:row.version,job,...(storeId?{storeId}:{}),reason:'明确原资源岗位范围'},f.admin);const entered=f.run('account.enter',{accountId:row.id,grantId:g.grants.at(-1).id});return resolveAccountActor(s,entered);},task(a,category){return workTaskView(s,a).tasks.find(x=>x.category===category);},row(a,id){return workEscalationView(s,a).rows.find(x=>x.task.id===id);},action(a,type,id,p={}){const r=f.row(a,id);return f.run(type,{id,sourceToken:r.task.sourceToken,ownerToken:r.ownerToken,assignmentVersion:r.assignmentVersion,version:r.version,reason:'本人按原阶段核对责任',...p},a);},raise(a,target,id,cause='manual-review'){return f.action(a,'work-escalation.raise',id,{cause,accountId:target.accountId,grantId:target.grantId});},finish(){f.run('clock.advance',{minutes:(f.b.startAt-s.now)/MIN});f.run('booking.start',{id:f.b.id},tech);f.run('clock.advance',{minutes:f.b.duration});f.run('booking.finish',{id:f.b.id,mode:'normal'},tech);}};
 f.admin=f.run('account.enter',{accountId:'DEMO-ADMIN',grantId:'DEMO-ADMIN-GRANT'});
 f.run('booking.create',{storeId:'xingfu',serviceId:'relax',regionId:'home',techId:'lin',mode:'specified',genderPreference:'any',startAt:s.now+240*MIN,contactName:'本地测试顾客',phone:'13800000001',healthConsent:true,identityVerified:true,adultConfirmed:true});
 f.run('booking.pay',{id:f.b.id,outcome:'success'});f.run('booking.accept',{id:f.b.id},tech);return f;
}
test('真实reduce：原协助认领→拒接→升级→接管→原页办结，账务与原期限不受责任变更影响',()=>{
 const f=fixture(),a=f.staff('store-manager','验收主管甲','xingfu'),b=f.staff('store-manager','验收主管乙','xingfu');
 f.run('booking.assistance-request',{id:f.b.id,reason:'预约信息需要人工核对'});let t=f.task(a,'assistance');f.run('work.claim',{id:t.id,sourceToken:t.sourceToken,version:t.assignmentVersion},a);
 const booking=structuredClone(f.b),money=structuredClone([f.s.goods,f.s.bills,f.s.recoveries,f.s.serviceFinanceEntries]);f.action(a,'work-escalation.decline',t.id);assert.equal(f.task(b,'assistance').ownerAccountId,a.accountId);
 f.raise(b,b,t.id,'owner-refused');f.action(b,'work-escalation.takeover',t.id);assert.equal(f.task(b,'assistance').ownerAccountId,b.accountId);assert.equal(f.row(b,t.id).status,'taken-over');assert.deepEqual(f.b,booking);assert.deepEqual([f.s.goods,f.s.bills,f.s.recoveries,f.s.serviceFinanceEntries],money);
 const task=f.task(b,'assistance'),context=createTaskReturnContext(f.s,b,{taskKey:task.id,listHash:'/store/work-escalations',task,token:'escalation-original-return'});assert.equal(taskReturnTarget(f.s,b,context,'/store/bookings/'+f.b.id),'/store/work-escalations');
 assert.equal(taskNavigationTarget(f.s,b,context,'/group/bookings/'+f.b.id),false);assert.throws(()=>createTaskReturnContext(f.s,b,{taskKey:task.id,listHash:'/store/work-escalations?store=silver',task,token:'escalation-no-query'}),/失效/);
 f.run('booking.assistance-close',{id:f.b.id,assistanceId:task.sourceId,response:'原安排已核对，用户问题解决'},b);assert.equal(f.task(b,'assistance').status,'done');assert.equal(f.row(b,t.id).status,'source-done');assert.equal(f.b.payment.refundedCents,0);
});
test('真实reduce：质量原责任实际接管→撤权→重新升级；唯一源身份同步原待办与升级页',()=>{
 const f=fixture(),a=f.staff('store-manager','核验主管甲','xingfu'),b=f.staff('store-manager','核验主管乙','xingfu');f.finish();
 f.run('care.case-create',{bookingId:f.b.id,category:'quality',description:'本地实际质量反馈'});const c=f.s.serviceCareCases.at(-1),t=f.task(a,'care');const old=structuredClone(f.b),due=t.dueAt;
 f.raise(a,a,t.id);f.action(a,'work-escalation.takeover',t.id);let actual=f.s.serviceCareCases.find(x=>x.id===c.id);assert.equal(actual.assignee.accountId,a.accountId);assert.equal(f.task(a,'care').ownerAccountId,a.accountId);assert.equal(f.task(a,'care').ownerGrantId,a.grantId);assert.equal(f.task(a,'care').mine,true);assert.equal(f.s.workTaskAssignments.some(x=>x.id===t.id),false);assert.equal(f.task(a,'care').dueAt,due);assert.deepEqual(f.b,old);
 f.run('account.status',{id:a.accountId,version:f.s.staffAccounts.find(x=>x.id===a.accountId).version,enabled:false,reason:'责任授权失效验收'},f.admin);assert.equal(f.task(b,'care').ownerValid,false);f.raise(b,b,t.id,'owner-invalid');f.action(b,'work-escalation.takeover',t.id);actual=f.s.serviceCareCases.find(x=>x.id===c.id);assert.equal(actual.assignee.accountId,b.accountId);assert.equal(f.task(b,'care').ownerValid,true);assert.equal(f.task(b,'care').dueAt,due);assert.deepEqual(f.b,old);
 assert.throws(()=>f.action(a,'work-escalation.raise',t.id,{cause:'manual-review',accountId:b.accountId,grantId:b.grantId}),/失效/);
 const adminPage=staffView(f.s,f.admin,['work-escalations'],{empty:t=>t});assert.match(adminPage,/无权/);
});
test('真实reduce：安全接报历史保留，新接管账号写原当前责任，后续原结案保留独立资金',()=>{
 const f=fixture(),a=f.staff('support','接报客服甲'),b=f.staff('support','接管客服乙');f.run('clock.advance',{minutes:(f.b.startAt-f.s.now)/MIN});f.run('booking.start',{id:f.b.id},tech);f.run('booking.help',{id:f.b.id,reason:'本地安全核验'});const h=f.s.safety.at(-1);f.run('booking.help-ack',{safetyId:h.id,responsibleName:a.accountName},a);
 const t=f.task(b,'safety'),original=structuredClone(f.b),acked=structuredClone(f.s.safety.at(-1).acknowledgedBy),deadline=[h.ackDeadline,h.escalationDeadline];f.raise(b,b,t.id);f.action(b,'work-escalation.takeover',t.id);
 const live=f.s.safety.find(x=>x.id===h.id);assert.deepEqual(live.acknowledgedBy,acked);assert.equal(live.responsibility.accountId,b.accountId);assert.equal(f.task(b,'safety').ownerAccountId,b.accountId);assert.equal(f.task(b,'safety').ownerLabel,b.accountName);assert.deepEqual([live.ackDeadline,live.escalationDeadline],deadline);assert.deepEqual(f.b,original);
 f.run('booking.help-close',{safetyId:h.id,resolution:'已通过实际联系核对并处理',unresolvedDispute:false},b);assert.equal(f.task(b,'safety').status,'done');assert.equal(f.b.payment.refundedCents,0);
});
