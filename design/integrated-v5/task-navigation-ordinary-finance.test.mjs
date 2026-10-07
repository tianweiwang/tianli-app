import test from 'node:test';
import assert from 'node:assert/strict';
import {seed,reduce} from './engine.mjs';
import {workTaskView} from './work-tasks.mjs';
import {createTaskReturnContext,taskReturnTarget,taskNavigationTarget} from './task-navigation.mjs';
import {workEscalationView} from './work-escalation.mjs';
import {TASK_CATEGORIES} from './work-task-labels.mjs';
import {oldCash} from './service-finance-composition-test-fixture.mjs';
import {servicePromotionSharedTaskRows} from './service-promotion-shared-tasks.mjs';
import {resolveAccountActor} from './staff-accounts.mjs';

const finance={role:'group',job:'finance'},user={role:'user',userId:'u1'},tech={role:'tech',techId:'lin'};
function fixture({rule=true,extension=false}={}){
  let s=seed(),seq=0;
  const f={get s(){return s;},get b(){return s.bookings.find(x=>x.id===f.bookingId);},get e(){return s.serviceFinanceEntries.find(x=>x.bookingId===f.bookingId&&x.paymentId===f.b.payment.id);},
    run(type,p={},actor=finance){let result;const row=['serviceFinanceEntries','serviceFinanceRecoveries'].flatMap(k=>s[k]||[]).find(x=>x.id===p.id);s=reduce(s,actor,type,{requestId:'ORDINARY-SHARED-'+ ++seq,version:row?.version??0,reason:'普通服务财务待办共享验证',...p},x=>result=x);return result;},
    advance(minutes){while(minutes){const step=Math.min(minutes,44640);f.run('clock.advance',{minutes:step});minutes-=step;}},
    task(actor=finance,entryId=f.e.id){return workTaskView(s,actor).tasks.find(x=>x.category==='service-finance-entry'&&x.entryId===entryId);},
    staff(job,storeId,interval={}){f.admin??=f.run('account.enter',{accountId:'DEMO-ADMIN',grantId:'DEMO-ADMIN-GRANT'},{role:'group'});const a=f.run('account.create',{name:'原财务任务测试'+job},f.admin);f.run('account.grant',{id:a.id,version:a.version,job,...(storeId?{storeId}:{}),...interval},f.admin);const grant=s.staffAccounts.find(x=>x.id===a.id).grants.at(-1),session=f.run('account.enter',{accountId:a.id,grantId:grant.id},{role:'group'});return resolveAccountActor(s,session);},
    context(actor=finance,task=f.task(actor),listHash='/group/tasks?category=service-finance-entry&status=waiting&store=xingfu'){assert.ok(task,'ordinary original finance must be included in shared work sources');return createTaskReturnContext(s,actor,{taskKey:task.id,task,listHash,token:'ordinary-original-return'});}
  };
  if(rule)f.run('finance.rule-publish',{scope:'global',groupBps:1000,storeBps:500,effectiveAt:s.now,version:0});
  f.run('booking.create',{storeId:'xingfu',serviceId:'relax',regionId:'home',techId:'lin',mode:'specified',genderPreference:'any',startAt:Math.ceil((s.now+4*3600000)/1800000)*1800000,contactName:'原业务合成客户',phone:'13800000001',healthConsent:true,identityVerified:true,adultConfirmed:true},user);
  f.bookingId=s.bookings.at(-1).id;f.run('booking.pay',{id:f.bookingId,outcome:'success'},user);f.run('booking.accept',{id:f.bookingId},tech);
  f.advance(Math.ceil((f.b.startAt-s.now)/60000));f.run('booking.start',{id:f.bookingId},tech);
  if(extension){f.run('booking.extension-create',{id:f.bookingId,minutes:30},user);f.run('booking.extension-pay',{id:f.bookingId,extensionId:f.b.extensions.at(-1).id,outcome:'success'},user);}
  f.advance(f.b.duration+(extension?30:0));f.run('booking.finish',{id:f.bookingId,mode:'normal'},tech);f.advance(2881);
  return f;
}

test('ordinary legacy waiting finance is visible and can return from the exact original entry without inventing a rule',()=>{
  const f=fixture({rule:false}),before=structuredClone(f.s),task=f.task(),c=f.context();
  assert.equal(task.status,'waiting');assert.equal(task.canClaim,false);assert.deepEqual(task.commands,[]);
  assert.equal(c.targetPath,'/group/service-finance/entry/'+f.e.id);assert.equal(taskReturnTarget(f.s,finance,c,c.targetPath),c.listHash);
  assert.equal(taskReturnTarget(f.s,finance,c,'/group/bookings/'+f.b.id),c.listHash);assert.equal(f.e.ruleSnapshot,null);
  assert.match(TASK_CATEGORIES[task.category],/服务.*资金/);assert.deepEqual(f.s,before);
});

test('actual finance claims and completes original split/finish; filtered return and one task remain after success',()=>{
  const f=fixture(),a=f.staff('finance'),task=f.task(a),c=f.context(a,task,'/group/tasks?category=service-finance-entry&status=open');
  assert.ok(task.canClaim);const paid=structuredClone(f.b.payment),due=task.dueAt;
  f.run('work.claim',{id:task.id,sourceToken:task.sourceToken,version:task.assignmentVersion},a);assert.equal(f.task(a).ownerAccountId,a.accountId);
  f.run('finance.split-start',{id:f.e.id,outcome:'success'},a);assert.equal(f.task(a).dueAt,due);
  assert.equal(taskReturnTarget(f.s,a,c,c.targetPath),c.listHash);f.run('finance.finish-start',{id:f.e.id,outcome:'success'},a);
  const done=f.task(a);assert.equal(done.id,task.id);assert.equal(done.status,'done');assert.equal(done.canClaim,false);
  assert.equal(taskReturnTarget(f.s,a,c,c.targetPath),c.listHash);assert.deepEqual(f.b.payment,paid);
  assert.equal(workTaskView(f.s,a).tasks.filter(x=>x.id===task.id).length,1);
});

test('ordinary finance stays group-finance only and current revoked sessions cannot use saved return contexts',()=>{
  const f=fixture(),a=f.staff('finance'),c=f.context(a);
  for(const raw of [{role:'group'},{role:'group',job:'support'},{role:'group',job:'operations'},{role:'store',storeId:'xingfu'},f.admin]){
    assert.equal(workTaskView(f.s,raw).tasks.some(x=>x.category.startsWith('service-finance-')),false);
    assert.equal(taskReturnTarget(f.s,raw,c,c.targetPath),null);
  }
  f.run('account.status',{id:a.accountId,version:f.s.staffAccounts.find(x=>x.id===a.accountId).version,enabled:false},f.admin);
  assert.equal(taskReturnTarget(f.s,a,c,c.targetPath),null);assert.throws(()=>workTaskView(f.s,a),/失效/);
});

test('navigation rechecks unique original roots while missing rule details remain readable and never authorize writes',()=>{
  const f=fixture(),c=f.context(),before=structuredClone(f.s);
  for(const damage of [s=>s.bookings.push(structuredClone(s.bookings[0])),s=>s.serviceFinanceEntries.push(structuredClone(s.serviceFinanceEntries[0])),s=>{s.serviceFinanceEntries[0].storeId='silver';},s=>{s.bookings[0].payment.id='WRONG-PAYMENT';}]){
    const s=structuredClone(before);damage(s);assert.equal(taskReturnTarget(s,finance,c,c.targetPath),null);
  }
  const missing=structuredClone(before);delete missing.bookings[0].serviceFinanceSnapshot;
  const task=workTaskView(missing,finance).tasks.find(x=>x.id===f.task().id);assert.equal(task.status,'waiting');assert.deepEqual(task.commands,[]);
  assert.equal(taskReturnTarget(missing,finance,c,c.targetPath),c.listHash);
  const forged={...f.task(),id:'service-finance:entry:INVENTED'};
  assert.throws(()=>createTaskReturnContext(f.s,finance,{task:forged,taskKey:forged.id,token:'ordinary-forged',listHash:'/group/tasks'}),/失效/);
});

test('main and extension keep separate source bindings and reject sibling entry, payment substitution or foreign return',()=>{
  const f=fixture({extension:true}),c=f.context(),extension=f.s.serviceFinanceEntries.find(x=>x.kind==='extension');
  assert.equal(workTaskView(f.s,finance).tasks.filter(x=>x.category==='service-finance-entry').length,2);
  assert.equal(taskNavigationTarget(f.s,finance,c,'/group/service-finance/entry/'+extension.id),false);
  assert.equal(taskReturnTarget(f.s,finance,{...c,binding:{...c.binding,paymentId:extension.paymentId}},c.targetPath),null);
  assert.equal(taskReturnTarget(f.s,finance,c,'/store/service-finance/entry/'+f.e.id),null);
  assert.equal(taskReturnTarget(f.s,finance,{...c,listHash:'https://unrelated.invalid'},c.targetPath),null);
});

test('actual ordinary recovery keeps its own original source and remains readable after cash collection',()=>{
  const f=fixture();f.advance(Math.ceil((f.e.paidAt+30*86400000-f.s.now)/60000)+1);
  const task=workTaskView(f.s,finance).tasks.find(x=>x.category==='service-finance-recovery');assert.ok(task);
  const debt=f.s.serviceFinanceRecoveries.find(x=>x.id===task.sourceId),c=f.context(finance,task,'/group/tasks?category=service-finance-recovery&status=open');
  assert.equal(c.targetPath,'/group/service-finance/recoveries');assert.equal(taskReturnTarget(f.s,finance,c,'/group/service-finance/entry/'+f.e.id),c.listHash);
  const bad=structuredClone(f.s);bad.serviceFinanceRecoveries.find(x=>x.id===debt.id).storeId='silver';assert.equal(taskReturnTarget(bad,finance,c,c.targetPath),null);
  f.run('finance.recovery-receive',{id:debt.id,amountCents:debt.outstandingCents,reference:'ACTUAL-ORIGINAL-CASH'});
  assert.equal(workTaskView(f.s,finance).tasks.find(x=>x.id===task.id).status,'done');assert.equal(taskReturnTarget(f.s,finance,c,c.targetPath),c.listHash);
});

test('original personal finance sources are not counted twice and verified identity gets an accurate completed label',async()=>{
  const h=await oldCash(),personal=servicePromotionSharedTaskRows(h.s),view=workTaskView(h.s,finance);
  assert.deepEqual(view.tasks.filter(x=>x.category.startsWith('service-finance-')),[]);
  assert.deepEqual(view.tasks.filter(x=>x.category.startsWith('service-promotion-finance-')).map(x=>x.id),personal.map(x=>x.id));
  const identity=workTaskView(h.s,{role:'group',job:'support'}).tasks.find(x=>x.category==='service-promotion-identity');
  assert.equal(identity.status,'done');assert.equal(identity.statusLabel,'实名核验已通过');
});

test('actual ordinary task escalation and takeover preserve cash and original deadline, with history after original completion',()=>{
  const f=fixture(),one=f.staff('finance'),two=f.staff('finance'),task=f.task(one),before=structuredClone(f.b.payment);
  f.run('work.claim',{id:task.id,sourceToken:task.sourceToken,version:task.assignmentVersion},one);
  const payload=(a)=>{const r=workEscalationView(f.s,a).rows.find(x=>x.task.id===task.id);return{id:task.id,sourceToken:r.task.sourceToken,ownerToken:r.ownerToken,assignmentVersion:r.assignmentVersion,version:r.version};};
  f.run('work-escalation.raise',{...payload(one),cause:'manual-review',accountId:two.accountId,grantId:two.grantId},one);
  f.run('work-escalation.takeover',payload(two),two);assert.equal(f.task(two).ownerAccountId,two.accountId);assert.equal(f.task(two).dueAt,task.dueAt);assert.deepEqual(f.b.payment,before);
  f.run('finance.split-start',{id:f.e.id,outcome:'success'},two);f.run('finance.finish-start',{id:f.e.id,outcome:'success'},two);
  const history=workEscalationView(f.s,two).rows.find(x=>x.task.id===task.id);assert.equal(history.status,'source-done');assert.equal(history.canTakeover,false);
  const c=f.context(two,history.task,'/group/work-escalations');assert.equal(taskReturnTarget(f.s,two,c,c.targetPath),c.listHash);
});

for(const mode of ['expired','employment-ended'])test(`original finance owner ${mode} loses candidate and handling eligibility without changing money`,()=>{
  const f=fixture(),one=f.staff('finance',null,mode==='expired'?{validTo:f.s.now+60000}:{}),two=f.staff('finance'),task=f.task(one);
  f.run('work.claim',{id:task.id,sourceToken:task.sourceToken,version:task.assignmentVersion},one);
  if(mode==='expired')f.advance(1);
  else f.run('account.employment',{id:one.accountId,version:f.s.staffAccounts.find(a=>a.id===one.accountId).version,employmentStatus:'ended',verifiedAt:f.s.now,reference:'DEMO-ENDED-ACTUAL-ACCOUNT'},f.admin);
  const before=structuredClone(f.b.payment),current=f.task(two),escalation=workEscalationView(f.s,two).rows.find(r=>r.task.id===task.id);
  assert.equal(current.ownerValid,false);assert.equal(escalation.owner.valid,false);
  assert.ok(!current.candidates.some(a=>a.accountId===one.accountId));assert.ok(!escalation.candidates.some(a=>a.accountId===one.accountId));
  assert.throws(()=>f.run('work.assign',{id:task.id,sourceToken:current.sourceToken,version:current.assignmentVersion,accountId:one.accountId,grantId:one.grantId},two),/授权|岗位|未启用/);
  f.run('work-escalation.raise',{id:task.id,sourceToken:current.sourceToken,ownerToken:escalation.ownerToken,assignmentVersion:escalation.assignmentVersion,version:escalation.version,cause:'owner-invalid',accountId:two.accountId,grantId:two.grantId},two);
  const raised=workEscalationView(f.s,two).rows.find(r=>r.task.id===task.id);
  f.run('work-escalation.takeover',{id:task.id,sourceToken:raised.task.sourceToken,ownerToken:raised.ownerToken,assignmentVersion:raised.assignmentVersion,version:raised.version},two);
  assert.equal(f.task(two).ownerAccountId,two.accountId);assert.deepEqual(f.b.payment,before);
});

test('future finance grant is unavailable until its original start time and duplicate authority roots never become candidates',()=>{
  const f=fixture(),current=f.staff('finance'),account=f.run('account.create',{name:'DEMO未来班次财务'},f.admin),validFrom=f.s.now+60000;
  f.run('account.grant',{id:account.id,version:account.version,job:'finance',validFrom},f.admin);
  const task=f.task(current),pending=workEscalationView(f.s,current).rows.find(r=>r.task.id===task.id);
  assert.ok(!task.candidates.some(a=>a.accountId===account.id));assert.ok(!pending.candidates.some(a=>a.accountId===account.id));
  f.advance(1);assert.ok(f.task(current).candidates.some(a=>a.accountId===account.id));
  for(const change of [s=>s.staffAccounts.push(structuredClone(s.staffAccounts.find(a=>a.id===account.id))),s=>{const a=s.staffAccounts.find(a=>a.id===account.id);a.grants.push(structuredClone(a.grants[0]));}]){
    const s=structuredClone(f.s);change(s);
    assert.ok(!workTaskView(s,current).tasks.find(t=>t.id===task.id).candidates.some(a=>a.accountId===account.id));
    assert.ok(!workEscalationView(s,current).rows.find(r=>r.task.id===task.id).candidates.some(a=>a.accountId===account.id));
  }
});
