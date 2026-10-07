import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { seed, reduce } from './engine.mjs';
import { serviceFinanceSummary } from './service-finance.mjs';
import { servicePromotionSharedTaskRows } from './service-promotion-shared-tasks.mjs';
import { serviceFinanceTaskRows, serviceFinanceTaskBinding } from './service-finance-tasks.mjs';
import { serviceFinanceComposition } from './service-finance-composition.mjs';
import { serviceFinanceCompositionReview, prepareServiceFinanceCompositionEvidence } from './service-finance-composition-review.mjs';
import { prepareServiceExtraEvidence } from './service-extra-file-validation.mjs';
import { serviceExtraSourceToken } from './service-finance-extras.mjs';
import { oldCash } from './service-finance-composition-test-fixture.mjs';

const MIN=60000, DAY=86400000, finance={role:'group',job:'finance'}, support={role:'group',job:'support'}, user={role:'user',userId:'u1'}, tech={role:'tech',techId:'lin'};
const bytes=new TextEncoder().encode('%PDF-1.4\nordinary service original cash classification\n%%EOF');
const blob=new Blob([bytes],{type:'application/pdf'}),file={ref:'invoice-file:'+createHash('sha256').update(bytes).digest('hex'),name:'普通原款分类凭据.pdf',type:blob.type,size:blob.size};

async function fixture({rule=true,ownerStoreId=null,extension=false,complete=true}={}) {
  let s=seed(),seq=0;
  const h={get s(){return s;},get b(){return s.bookings.find(b=>b.id===h.bookingId);},get e(){return s.serviceFinanceEntries.find(e=>e.bookingId===h.bookingId&&e.paymentId===h.b.payment.id);},
    rows(){return serviceFinanceTaskRows(s);},task(entryId=h.e.id){return h.rows().find(t=>t.category==='service-finance-entry'&&t.sourceId===entryId);},
    view(){return serviceFinanceSummary(s,h.e.bookingId,h.e.paymentId);},
    run(type,p={},actor=finance){const row=['serviceFinanceEntries','serviceFinanceRecoveries'].flatMap(k=>s[k]||[]).find(x=>x.id===p.id);let result;s=reduce(s,actor,type,{requestId:'ORDINARY-'+ ++seq,version:row?.version||0,reason:'原普通服务资金技术隔离验证',...p},x=>result=x);return result;},
    async extra(type,p={},actor=finance){const row=['serviceExtraPolicies','serviceRefundShortages','serviceExtraRecoveries','serviceExtraOffsets'].flatMap(k=>s[k]||[]).find(x=>x.id===p.id);const payload={requestId:'ORDINARY-EXTRA-'+ ++seq,version:row?.version||0,reason:'同一原资金来源C04技术验证',...p},evidence=await prepareServiceExtraEvidence(s,actor,type,payload,{readFile:async()=>blob});let result;s=reduce(s,actor,type,payload,x=>result=x,evidence);return result;},
    create(){h.run('booking.create',{storeId:'xingfu',serviceId:'relax',regionId:'home',techId:'lin',mode:'specified',genderPreference:'any',startAt:Math.ceil((s.now+4*3600000)/1800000)*1800000,contactName:'PRIVATE-ORDINARY-CUSTOMER',phone:'13800000001',healthConsent:true,identityVerified:true,adultConfirmed:true},user);h.bookingId=s.bookings.at(-1).id;h.run('booking.pay',{id:h.b.id,outcome:'success'},user);h.run('booking.accept',{id:h.b.id},tech);},
    complete(){h.advance(Math.ceil((h.b.startAt-s.now)/MIN));h.run('booking.start',{id:h.b.id},tech);h.advance(h.b.duration);h.run('booking.finish',{id:h.b.id,mode:'normal'},tech);h.advance(2881);},
    advance(minutes){while(minutes){const step=Math.min(minutes,44640);h.run('clock.advance',{minutes:step});minutes-=step;}},
    execute(kind='split-start',outcome='success',extra={}){return h.run('finance.'+kind,{id:h.e.id,outcome,...extra});},
    settle(){h.execute();h.execute('finish-start');},
    cash(){return structuredClone({bookings:s.bookings,split:h.e.split,splitHistory:h.e.splitHistory,returns:h.e.returns,recoveries:s.serviceFinanceRecoveries});},
    async confirm(key='split:'+h.e.split.id){const v=serviceFinanceCompositionReview(s,finance,h.e.id,key),p={id:h.e.id,version:v.entryVersion,sourceKey:key,sourceToken:v.sourceToken,requestId:'ORDINARY-REVIEW-'+ ++seq,hCents:v.facts.normalCents,csCents:0,retainedCsCents:null,allocations:[],basisReference:'ACTUAL-ORIGINAL-CLASSIFICATION-'+seq,basisDescription:'本笔真实技术合成分类依据，未倒套比例',evidenceRefs:[file],reason:'核对原成功现金组成'};const prepared=await prepareServiceFinanceCompositionEvidence(s,finance,'finance.composition-confirm',p,{readFile:async()=>blob,getState:()=>s});s=reduce(s,finance,'finance.composition-confirm',p,()=>{},{compositionPrepared:prepared});},
    refund(amount=9800,outcome='success'){h.run('booking.special-aftersale',{id:h.b.id,requests:[{paymentId:h.b.payment.id,amountCents:amount}]},support);const r=h.b.refunds.at(-1);h.run('booking.refund-review',{id:h.b.id,refundId:r.id,decision:'approve'},support);h.run('booking.refund-pay',{id:h.b.id,refundId:r.id,paymentId:h.b.payment.id,outcome});return r.id;}
  };
  if(rule)h.run('finance.rule-publish',{scope:'global',groupBps:1000,storeBps:500,effectiveAt:s.now,version:0});
  if(ownerStoreId)h.run('service-promotion.enter',{storeId:ownerStoreId,version:s.users.find(u=>u.id==='u1').serviceBinding.version||0},user);
  h.create();
  if(complete){h.advance(Math.ceil((h.b.startAt-s.now)/MIN));h.run('booking.start',{id:h.b.id},tech);if(extension){h.run('booking.extension-create',{id:h.b.id,minutes:30},user);h.run('booking.extension-pay',{id:h.b.id,extensionId:h.b.extensions.at(-1).id,outcome:'success'},user);}h.advance(h.b.duration+(extension?30:0));h.run('booking.finish',{id:h.b.id,mode:'normal'},tech);h.advance(2881);}
  return h;
}

test('真实普通成功原款未配置历史规则仍有待核任务，原新规则不追补',async()=>{
  const h=await fixture({rule:false}),before=structuredClone(h.s);
  assert.equal(h.e.ruleSnapshot,null);assert.equal(h.view().status,'needs-review');
  const task=h.task();assert.equal(task?.status,'waiting');assert.deepEqual(task.commands,[]);assert.deepEqual(h.s,before);
  const binding=serviceFinanceTaskBinding(h.s,h.e.id);assert.equal(binding.bookingId,h.b.id);assert.equal(binding.consistent,true);
  h.run('finance.rule-publish',{scope:'global',groupBps:700,storeBps:300,effectiveAt:h.s.now,version:0});
  assert.equal(h.e.ruleSnapshot,null);assert.equal(h.task().status,'waiting');assert.deepEqual(h.task().commands,[]);
});

test('自然原款真实split/finish依原权限可办，同一原任务在结清后done',async()=>{
  const h=await fixture(),first=h.task(),before=structuredClone(h.s);
  assert.equal(first.status,'open');assert.deepEqual(first.commands,['finance.split-start']);assert.deepEqual(h.s,before);
  assert.equal(first.id,'service-finance:entry:'+h.e.id);assert.equal(first.requiredRoute,'service-finance');assert.equal(first.assignmentMode,'task');
  assert.deepEqual(first.allowedJobs,{group:['finance'],store:[]});assert.deepEqual(first.manageRoles,['group']);
  assert.equal(first.routes.group,'/group/service-finance/entry/'+h.e.id);assert.equal(first.paymentId,h.b.payment.id);
  h.execute();assert.deepEqual(h.task().commands,['finance.finish-start']);h.execute('finish-start');
  assert.equal(h.task().id,first.id);assert.equal(h.task().status,'done');assert.deepEqual(h.task().commands,[]);
  assert.equal(serviceFinanceComposition(h.s,h.e.id).known,true);assert.notEqual(h.task().sourceToken,first.sourceToken);
});

test('普通本店与跨店客户均取原快照，实际当前客户归属不反推旧单',async()=>{
  for(const owner of ['xingfu','silver']){
    const h=await fixture({ownerStoreId:owner}),source=structuredClone(h.e.sourceSnapshot),task=h.task();
    assert.equal(source.customerType,owner==='xingfu'?'store':'group');assert.equal(source.promoterId,null);
    assert.equal(task.status,'open');assert.deepEqual(servicePromotionSharedTaskRows(h.s),[]);
    // Adversarial current-identity probe after all original booking/cash facts
    // were generated by real reduce; it is not a fabricated original payment.
    h.s.users.find(u=>u.id==='u1').serviceBinding={status:'store',ownerStoreId:owner==='xingfu'?'silver':'xingfu',promoterId:'CURRENT-UNRELATED',recordedAt:h.s.now};
    assert.deepEqual(h.e.sourceSnapshot,source);assert.deepEqual(h.task(),task);h.settle();assert.equal(h.task().status,'done');
  }
});

test('真实加时与主款分别唯一建任务，原快照继承和金额仍由原模型',async()=>{
  const h=await fixture({extension:true}),entries=h.s.serviceFinanceEntries.filter(e=>e.bookingId===h.b.id),tasks=h.rows();
  assert.equal(entries.length,2);assert.equal(tasks.length,2);assert.notEqual(tasks[0].id,tasks[1].id);
  const extension=entries.find(e=>e.kind==='extension');assert.equal(extension.paymentId,h.b.extensions[0].id);
  assert.equal(h.b.extensions[0].serviceFinanceSnapshot.inheritedFromBookingId,h.b.id);
  for(const e of entries){assert.deepEqual(h.task(e.id).commands,['finance.split-start']);h.run('finance.split-start',{id:e.id,outcome:'success'});h.run('finance.finish-start',{id:e.id,outcome:'success'});assert.equal(h.task(e.id).status,'done');}
});

test('原服务尚未完成只waiting，不给可办收付或默认期限',async()=>{
  const h=await fixture({complete:false}),task=h.task();assert.equal(task.status,'waiting');assert.deepEqual(task.commands,[]);
  assert.deepEqual(task.manageRoles,[]);assert.equal(task.dueAt,h.view().alertAt);
});

test('实际成功完结旧格式缺组成仍open，实读Blob和原reduce补核后同任务done',async()=>{
  const h=await fixture();h.settle();const originalTask=h.task();
  // The only legacy conversion removes sidecars. Original cash was produced
  // by the actual split/finish commands and remains byte-for-byte unchanged.
  delete h.e.split.cashComposition;delete h.e.split.cashCompositionRequest;
  const cash=h.cash(),pending=h.task();assert.equal(pending.id,originalTask.id);assert.equal(pending.status,'open');
  assert.deepEqual(pending.commands,['finance.composition-confirm']);assert.notEqual(pending.sourceToken,originalTask.sourceToken);
  await h.confirm();assert.equal(h.task().id,pending.id);assert.equal(h.task().status,'done');assert.deepEqual(h.cash(),cash);
  assert.equal(h.s.serviceFinanceCompositions.at(-1).by.job,'finance');assert.deepEqual(h.s.serviceFinanceCompositions.at(-1).evidenceRefs,[file]);
});

test('未知分账与原退款仅原query，退款未知不新增收付或补核',async()=>{
  const h=await fixture();h.execute('split-start','processing');assert.deepEqual(h.task().commands,['finance.split-query']);
  const no=h.e.split.requestNo,amount=h.e.split.amountCents;h.refund(9800,'processing');assert.deepEqual(h.task().commands,['finance.split-query']);
  h.execute('split-query','failed',{transactionId:h.e.split.id});assert.equal(h.task().status,'waiting');assert.deepEqual(h.task().commands,[]);
  assert.equal(h.e.split.requestNo,no);assert.equal(h.e.split.amountCents,amount);assert.equal(h.view().unknownRefund,true);
});

test('未知finish与return保留原号查询，真实结果结束才done',async()=>{
  const finish=await fixture();finish.execute();finish.execute('finish-start','processing');const finishNo=finish.e.finish.requestNo;
  assert.deepEqual(finish.task().commands,['finance.finish-query']);finish.execute('finish-query','success');assert.equal(finish.task().status,'done');assert.equal(finish.e.finish.requestNo,finishNo);
  const h=await fixture();h.settle();h.refund();h.execute('return-start','processing',{splitId:h.e.split.id,splitRequestNo:h.e.split.requestNo});
  const original=structuredClone(h.e.split),returnNo=h.e.returns[0].requestNo;assert.deepEqual(h.task().commands,['finance.return-query']);
  h.execute('return-query','success',{returnId:h.e.returns[0].id});assert.equal(h.task().status,'done');assert.equal(h.e.returns[0].requestNo,returnNo);assert.deepEqual(h.e.split,original);
});

test('真实到期原债进入独立recovery，原收到及完整组成后done',async()=>{
  const h=await fixture();h.advance(Math.ceil((h.e.paidAt+30*DAY-h.s.now)/MIN)+1);
  const debt=h.s.serviceFinanceRecoveries.find(d=>d.entryId===h.e.id&&d.type==='unshared-release');assert.ok(debt);
  const task=h.rows().find(t=>t.category==='service-finance-recovery'&&t.sourceId===debt.id);
  assert.equal(task.status,'open');assert.deepEqual(task.commands,['finance.recovery-receive']);assert.equal(task.routes.group,'/group/service-finance/recoveries');
  const binding=serviceFinanceTaskBinding(h.s,h.e.id,{recoveryId:debt.id});assert.equal(binding.recoveryId,debt.id);assert.equal(binding.bookingId,h.b.id);
  const original=structuredClone(h.b.payment);h.run('finance.recovery-receive',{id:debt.id,amountCents:debt.outstandingCents,reference:'ACTUAL-ORDINARY-RECEIPT'});
  assert.equal(h.rows().find(t=>t.sourceId===debt.id).status,'done');assert.equal(h.task().status,'done');assert.deepEqual(h.b.payment,original);
});

test('原实际回款缺凭据或时间不冒已结清，串债原店拒进入',async()=>{
  const h=await fixture();h.advance(Math.ceil((h.e.paidAt+30*DAY-h.s.now)/MIN)+1);
  const debt=h.s.serviceFinanceRecoveries.find(d=>d.entryId===h.e.id);h.run('finance.recovery-receive',{id:debt.id,amountCents:debt.outstandingCents,reference:'ACTUAL-RECEIPT-CHECK'});
  const current=h.s.serviceFinanceRecoveries.find(d=>d.id===debt.id),record=structuredClone(current.records[0]);
  delete current.records[0].reference;let task=h.rows().find(t=>t.sourceId===current.id);assert.equal(task.status,'waiting');assert.deepEqual(task.commands,[]);
  current.records[0]=record;current.records[0].occurredAt=h.s.now+MIN;assert.equal(h.rows().find(t=>t.sourceId===current.id).status,'waiting');
  current.records[0]=record;current.storeId='silver';assert.equal(serviceFinanceTaskBinding(h.s,h.e.id,{recoveryId:current.id}),null);assert.equal(h.rows().some(t=>t.sourceId===current.id),false);
});

test('重复原entry/支付/预约及跨店串号不产生可办或可导航任务',async()=>{
  const h=await fixture(),variants=[
    s=>s.serviceFinanceEntries.push(structuredClone(s.serviceFinanceEntries[0])),
    s=>s.serviceFinanceEntries.push({...structuredClone(s.serviceFinanceEntries[0]),id:'DUPLICATE-ENTRY'}),
    s=>s.bookings.push({...structuredClone(s.bookings[0]),id:'OTHER-BOOKING'}),
    s=>s.bookings.push(structuredClone(s.bookings[0])),
    s=>{s.serviceFinanceEntries[0].storeId='silver';},
    s=>{s.serviceFinanceEntries[0].paymentId='MISSING-ORIGINAL-PAYMENT';},
    s=>{s.serviceFinanceEntries[0].kind='extension';}
  ];for(const corrupt of variants){const s=structuredClone(h.s);corrupt(s);assert.equal(serviceFinanceTaskBinding(s,h.e.id),null);assert.deepEqual(serviceFinanceTaskRows(s),[]);}
});

test('原快照冲突只能待核，当前规则或客户归属不能填旧来源',async()=>{
  const h=await fixture(),token=h.task().sourceToken;
  h.e.sourceSnapshot.customerType='store';assert.equal(h.task().status,'waiting');assert.deepEqual(h.task().commands,[]);assert.equal(serviceFinanceTaskBinding(h.s,h.e.id).consistent,false);assert.notEqual(h.task().sourceToken,token);
  const missing=await fixture();delete missing.b.serviceFinanceSnapshot;assert.equal(missing.task().status,'waiting');assert.deepEqual(missing.task().commands,[]);
  assert.equal(serviceFinanceTaskBinding(missing.s,missing.e.id).bookingId,missing.b.id);assert.equal(serviceFinanceTaskBinding(missing.s,missing.e.id).consistent,false);
});

test('原个人推广任务全部保留且不被普通producer双计或修补',async()=>{
  const h=await oldCash(),before=structuredClone(h.s),personal=servicePromotionSharedTaskRows(h.s);assert.ok(personal.length);
  assert.deepEqual(serviceFinanceTaskRows(h.s),[]);assert.equal(serviceFinanceTaskBinding(h.s,h.entry.id),null);assert.deepEqual(servicePromotionSharedTaskRows(h.s),personal);assert.deepEqual(h.s,before);
});

test('损坏原个人标记不因非字符串而滑入普通来源',async()=>{
  const h=await fixture();
  for(const marker of [{damaged:true},0,false,''])for(const path of ['entry','main','binding']){
    const s=structuredClone(h.s),entry=s.serviceFinanceEntries.find(e=>e.id===h.e.id),booking=s.bookings.find(b=>b.id===h.b.id);
    if(path==='entry')entry.sourceSnapshot.promoterId=marker;
    if(path==='main')booking.serviceFinanceSnapshot.source.promoterId=marker;
    if(path==='binding')booking.servicePromotionSnapshot.binding.promoterId=marker;
    assert.equal(serviceFinanceTaskBinding(s,entry.id),null);assert.deepEqual(serviceFinanceTaskRows(s),[]);
  }
});

test('opaque来源指纹核原全部现金/组成变化，不泄原资料且投影无副作用',async()=>{
  const h=await fixture();h.settle();const before=structuredClone(h.s),task=h.task(),json=JSON.stringify(h.rows());
  assert.match(task.sourceToken,/^sha256:[a-f0-9]{64}$/);for(const secret of ['PRIVATE-ORDINARY-CUSTOMER','13800000001',file.ref,file.name,'原普通服务资金技术隔离验证'])assert.ok(!json.includes(secret),secret);
  assert.deepEqual(h.s,before);h.rows()[0].commands.push('forged');assert.deepEqual(h.s,before);
  h.e.split.results[0].reason='changed-real-source-body';assert.notEqual(h.task().sourceToken,task.sourceToken);
});

test('真实C04原追收计划阻断普通split，原撤回后同任务恢复可办',async()=>{
  const h=await fixture({complete:false}),store={role:'store',job:'store-finance',storeId:'xingfu'};
  h.run('booking.cancel',{id:h.b.id},user);h.run('booking.refund-pay',{id:h.b.id,refundId:h.b.refunds[0].id,outcome:'failed'});
  const b=h.b,r=b.refunds[0],part=r.executions[0];
  const issue=await h.extra('service-extra.refund-shortage',{bookingId:b.id,paymentId:b.payment.id,refundId:r.id,shortageCents:10000,failedAt:part.updatedAt,sourceToken:serviceExtraSourceToken(h.s,b.id,b.payment.id),reference:part.refundNo,occurredAt:part.updatedAt,file},store);
  h.advance(1440);const policy=await h.extra('service-extra.policy-publish',{path:'merchant-balance',effectiveAt:h.s.now,basis:'原C04技术隔离的明确Demo路径'});
  await h.extra('service-extra.advance-decision',{id:issue.id,decision:'approve',path:'merchant-balance',policyId:policy.id,amountCents:10000});
  const advance=h.s.serviceRefundShortages.find(i=>i.id===issue.id).advances.at(-1);
  await h.extra('service-extra.advance-pay',{id:issue.id,advanceId:advance.id,outcome:'success',reference:'ACTUAL-C04-ADVANCE',occurredAt:h.s.now,file});
  h.create();h.complete();const debt=h.s.serviceExtraRecoveries.at(-1),before=h.task();assert.deepEqual(before.commands,['finance.split-start']);
  const plan=await h.extra('service-extra.offset-propose',{entryId:h.e.id,recoveryId:debt.id,amountCents:1000,sourceToken:serviceExtraSourceToken(h.s,h.b.id,h.b.payment.id)});
  await h.extra('service-extra.offset-confirm',{id:plan.id,decision:'accept'},store);assert.equal(h.task().status,'waiting');assert.deepEqual(h.task().commands,[]);
  assert.throws(()=>h.execute(),/追收方案/);await h.extra('service-extra.offset-cancel',{id:plan.id});assert.equal(h.task().id,before.id);assert.deepEqual(h.task().commands,['finance.split-start']);
});
