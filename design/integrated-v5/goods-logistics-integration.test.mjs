import test from 'node:test';
import assert from 'node:assert/strict';
import { seed, reduce, goodsSummary } from './engine.mjs';
import { resolveAccountActor, canAccountView } from './staff-accounts.mjs';
import { goodsLogisticsAutoReceipt } from './goods-logistics-policy.mjs';
import { workTaskView } from './work-tasks.mjs';
import { createTaskReturnContext, taskNavigationTarget, taskReturnTarget } from './task-navigation.mjs';
const MIN=60000,user={role:'user',userId:'u1'},other={role:'user',userId:'u2'};
function fixture(){
  let s=seed(),seq=0,currentId=null;
  const f={get s(){return s;},get o(){return s.goods.find(x=>x.id===currentId);},get fact(){return f.o.goodsDeliveryFacts?.at(-1);},get i(){return f.o.incidents.at(-1);},get c(){return f.o.cases.at(-1);},run(type,p={},a=user){let result;s=reduce(s,a,type,{requestId:`logistics-integration-${++seq}`,...p},r=>result=r);return result;},staff(job,storeId){const x=f.run('account.create',{name:`C06岗位 ${job}`,reason:'建立真实接线验收工作账号'},f.admin),granted=f.run('account.grant',{id:x.id,version:x.version,job,...(storeId?{storeId}:{}),reason:'明确验收岗位和门店'},f.admin),entered=f.run('account.enter',{accountId:x.id,grantId:granted.grants.at(-1).id});return resolveAccountActor(s,entered);},publish(extra={}){return f.run('goods-logistics.policy-publish',{version:Math.max(0,...s.goodsLogisticsPolicies.map(p=>p.version)),scope:'all',effectiveAt:s.now,autoReceiptMode:'enabled',autoReceiptMinutes:30,compensationMode:'not-configured',unclaimedMode:'not-configured',reason:'隔离测试明确输入，不是正式默认政策',...extra},f.ops);},create({pay=true,ship=true}={}){f.run('promotion.enter',{storeId:'xingfu'});f.run('cart.set',{skuId:'oil',qty:1});f.run('goods.submit',{addressId:'AD1'});currentId=s.goods.at(-1).id;if(pay)f.run('goods.pay',{id:currentId,outcome:'success'});if(ship)f.run('goods.ship',{id:currentId,carrier:'原命令实际发货物流',tracking:`SOURCE-${seq}`},f.warehouse);return currentId;},advance(minutes){f.run('clock.advance',{minutes});},delivery(extra={}){return f.run('goods-logistics.delivery-record',{id:f.o.id,version:f.o.version,kind:'signed',occurredAt:s.now,evidence:'原运单实际送达证据',reference:`ACTUAL-${seq}`,reason:'实际发生事实与原运单核对',...extra},f.warehouse);},verify(extra={}){return f.run('goods-logistics.delivery-verify',{id:f.o.id,factId:f.fact.id,version:f.o.version,decision:'verified',occurredAt:s.now,evidence:'客服实际核实原送达凭据',reason:'核实真实送达发生',...extra},f.support);},incident(kind='receipt-dispute',extra={}){return f.run('goods.incident-open',{id:f.o.id,version:f.o.version,stage:'delivery',kind,occurredAt:s.now,evidence:'本人主张与原物流原始证据',receiptClaim:'not-received',skuId:'oil',qty:1,actualItem:'实际收到不同货物',reason:'登记真实争议，不改变原资金',...extra},f.support);},verifiedIncident(){return f.run('goods.incident-verify',{id:f.o.id,incidentId:f.i.id,version:f.i.version,conclusion:'confirmed',occurredAt:s.now,evidence:'客服核实用户主张依据',reason:'完成实际人工核实'},f.support);},propose(resolution='continue',caseId){return f.run('goods.incident-propose',{id:f.o.id,incidentId:f.i.id,version:f.i.version,resolution,caseId,reason:'用户核对原履约或退款方案'},f.support);},confirm(extra={},a=user){return f.run('goods.incident-confirm',{id:f.o.id,incidentId:f.i.id,version:f.i.version,decision:'accept',reason:'本人已了解方案实际后果',...extra},a);},refundRequest(){f.run('goods.case',{id:f.o.id,kind:'refund',skuId:'oil',qty:1,amountCents:10000,shippingCents:0,reason:'实际原订单部分金额退款'});f.run('goods.case-review',{id:f.o.id,caseId:f.c.id,version:f.c.version,decision:'approve',reason:'原售后已核实部分金额'},f.support);return f.c.id;},loadAtDue(){
    // Only the isolated saved snapshot's business time changes, to model loading
    // after the rule falls due. Every success fact was produced by reduce.
    s=structuredClone(s);s.now=goodsLogisticsAutoReceipt(s,f.o).dueAt+MIN;
  }};
  const entry=f.run('account.enter',{accountId:'DEMO-ADMIN',grantId:'DEMO-ADMIN-GRANT'});f.admin=resolveAccountActor(s,entry);f.ops=f.staff('operations');f.warehouse=f.staff('warehouse');f.support=f.staff('support');f.finance=f.staff('finance');return f;
}
const financial=f=>structuredClone({payment:f.o.payment,paidAt:f.o.paidAt,paidCents:f.o.paidCents,shippingCents:f.o.shippingCents,lines:f.o.lines,refunds:f.o.refunds,commissionPaidCents:f.o.commissionPaidCents,stocks:f.s.skus.map(k=>[k.id,k.stock]),bills:f.s.bills,recoveries:f.s.recoveries});
function taskContext(f,a,task){return createTaskReturnContext(f.s,a,{taskKey:task.id,task,listHash:`/${a.role}/tasks?category=goods-logistics&status=open`,token:'C06-origin-context'});}

test('C06 reduce 新单锁定明确规则，发布变化与旧单刷新不回补原快照',()=>{
  const f=fixture(),oldId=f.create();assert.equal(f.o.logisticsPolicySnapshot,null);const published=f.publish();f.create();assert.equal(f.o.logisticsPolicySnapshot.id,published.id);assert.equal(f.o.logisticsPolicySnapshot.autoReceiptMinutes,30);
  f.advance(1);f.publish({autoReceiptMinutes:10});assert.equal(f.o.logisticsPolicySnapshot.id,published.id);assert.equal(f.o.logisticsPolicySnapshot.autoReceiptMinutes,30);assert.equal(f.s.goods.find(o=>o.id===oldId).logisticsPolicySnapshot,null);
  f.advance(60);assert.equal(f.o.status,'shipped');assert.equal(f.s.goods.find(o=>o.id===oldId).status,'shipped');assert.equal(f.o.goodsDeliveryFacts,undefined);
});

test('C06 reduce 实际送达核实和到期复用原收货，自动审计为system且资金库存守恒',()=>{
  const f=fixture();f.publish();f.create();const shippedAt=f.o.shipment.at,before=financial(f);f.advance(10);f.delivery({occurredAt:shippedAt+5*MIN});f.verify();assert.equal(f.o.status,'shipped');f.advance(24);assert.equal(f.o.status,'shipped');f.advance(1);
  assert.equal(f.o.status,'received');assert.equal(f.o.receivedAt,shippedAt+35*MIN);assert.equal(f.o.receiptSource.source,'logistics-auto');assert.equal(f.o.receiptSource.occurredAt,shippedAt+5*MIN);assert.equal(f.o.receiptSource.factId,f.fact.id);assert.equal(f.o.receiptSource.policyVersion,1);
  const event=f.o.events.find(x=>x.source==='logistics-auto'),log=f.s.logs.find(x=>x.id===f.o.id&&x.source==='logistics-auto');for(const x of [event,log]){assert.equal(x.actor,'system');assert.equal(x.actorId,'system');assert.equal(x.job,null);assert.equal(x.accountId,undefined);}
  assert.deepEqual(financial(f),before);assert.match(goodsSummary(f.s,f.o).commissionReason,/等待期/);const at=f.o.receivedAt,events=f.o.events.length;f.advance(1);f.run('goods.receive',{id:f.o.id});assert.equal(f.o.receivedAt,at);assert.equal(f.o.events.length,events);assert.deepEqual(financial(f),before);
});

test('C06 reduce 到期后加载的真实快照，同次新增签收争议先阻断自动收货',()=>{
  const f=fixture();f.publish();f.create();f.delivery();f.verify();f.loadAtDue();assert.equal(goodsLogisticsAutoReceipt(f.s,f.o).eligible,true);const before=financial(f);f.incident();assert.equal(f.i.status,'open');assert.equal(f.o.status,'shipped');assert.equal(f.o.receivedAt,undefined);assert.equal(f.o.receiptSource,undefined);assert.equal(goodsLogisticsAutoReceipt(f.s,f.o).eligible,false);assert.deepEqual(financial(f),before);
});

test('C06 reduce 原退款未知持续阻断，到原退款查询成功才允许收货且不重复退款',()=>{
  const f=fixture();f.publish();f.create();const caseId=f.refundRequest();f.run('goods.refund',{id:f.o.id,caseId,outcome:'processing'},f.finance);const paymentId=f.o.payment.id,refundId=f.o.refunds[0].id,stocks=structuredClone(f.s.skus.map(x=>[x.id,x.stock]));f.delivery();f.verify();f.advance(31);
  assert.equal(f.o.status,'shipped');assert.equal(f.c.status,'refunding');assert.equal(f.o.refunds[0].status,'processing');assert.equal(f.o.lines[0].refundedCents,0);assert.equal(goodsLogisticsAutoReceipt(f.s,f.o).eligible,false);assert.equal(f.o.commissionPaidCents,0);
  const request={id:f.o.id,caseId,outcome:'success',requestId:'C06-refund-channel-query'};f.run('goods.refund-query',request,f.finance);f.run('goods.refund-query',request,f.finance);assert.equal(f.c.status,'done');assert.equal(f.o.status,'received');assert.equal(f.o.refunds.length,1);assert.equal(f.o.refunds[0].id,refundId);assert.equal(f.o.refunds[0].amountCents,10000);assert.equal(f.o.lines[0].refundedCents,10000);assert.equal(f.o.payment.id,paymentId);assert.deepEqual(f.s.skus.map(x=>[x.id,x.stock]),stocks);
});

test('C06 reduce 未结物流异常不会被到期越过，原拒绝保留事实不释放阻断',()=>{
  const f=fixture();f.publish();f.create();f.incident('damaged');f.delivery();f.verify();f.advance(31);assert.equal(f.o.status,'shipped');assert.equal(f.i.status,'open');f.propose();f.confirm({decision:'reject'});assert.equal(f.i.status,'open');assert.equal(f.o.status,'shipped');assert.equal(f.i.proposal.status,'rejected');assert.equal(f.o.refunds.length,0);assert.equal(goodsLogisticsAutoReceipt(f.s,f.o).eligible,false);
});

test('C06 reduce 本人继续确认不假结案，实收依据与原收货齐全后办结且不造退款',()=>{
  const f=fixture();f.publish();f.create();f.incident('wrong-item');const before=financial(f);f.verifiedIncident();f.propose();assert.throws(()=>f.confirm({},other),/无权|本人/);assert.throws(()=>f.confirm({},f.support),/本人|无权/);assert.equal(f.i.status,'awaiting_user');f.confirm();assert.equal(f.i.status,'waiting');assert.equal(f.o.status,'shipped');assert.equal(f.o.refunds.length,0);
  const receipt={id:f.o.id,incidentId:f.i.id,version:f.i.version,requestId:'C06-owner-actual-receipt',occurredAt:f.s.now,evidence:'本人实际完整正确收货依据',reason:'本人已核对实际货物'};assert.throws(()=>f.run('goods.incident-receipt',receipt,other),/无权|本人/);assert.throws(()=>f.run('goods.incident-receipt',receipt,f.support),/本人|无权/);f.run('goods.incident-receipt',receipt);assert.equal(f.i.status,'waiting');assert.equal(f.o.status,'shipped');f.run('goods.receive',{id:f.o.id,version:f.o.version});assert.equal(f.i.status,'done');assert.equal(f.o.status,'received');assert.equal(f.o.receiptSource,undefined);assert.deepEqual(financial(f),before);
});

test('C06 reduce 本人退款方案同意不记成功，仍由原财务渠道查款办结',()=>{
  const f=fixture();f.create();f.incident('receipt-dispute');f.verifiedIncident();const caseId=f.refundRequest();f.propose('refund',caseId);f.confirm();assert.equal(f.i.status,'waiting');assert.equal(f.o.refunds.length,0);assert.equal(f.o.lines[0].refundedCents,0);
  assert.throws(()=>f.run('goods.refund',{id:f.o.id,caseId,outcome:'success'},f.support),/无权|岗位/);assert.throws(()=>f.run('goods.refund',{id:f.o.id,caseId,outcome:'success'}),/无权|岗位/);f.run('goods.refund',{id:f.o.id,caseId,outcome:'processing'},f.finance);assert.equal(f.i.status,'waiting');assert.equal(f.o.lines[0].refundedCents,0);f.run('goods.refund-query',{id:f.o.id,caseId,outcome:'success'},f.finance);assert.equal(f.i.status,'done');assert.equal(f.o.refunds.length,1);assert.equal(f.o.lines[0].refundedCents,10000);assert.equal(f.o.status,'shipped');
});

test('C06 reduce 实际工作岗位与会话守卫不接受伪造角色，门店无物流写权',()=>{
  const f=fixture();f.publish();f.create();const store=f.staff('store-manager','xingfu'),foreign=f.staff('store-manager','silver'),record={id:f.o.id,version:f.o.version,kind:'signed',occurredAt:f.s.now,evidence:'原证据',reference:'REAL-1',reason:'原事实'};
  for(const a of [f.finance,f.ops,store,foreign,{...f.finance,job:'warehouse'},{...store,role:'group',job:'warehouse'}])assert.throws(()=>f.run('goods-logistics.delivery-record',record,a),/无权|岗位/);
  f.delivery();const factId=f.fact.id,verify={id:f.o.id,factId,version:f.o.version,decision:'verified',occurredAt:f.s.now,evidence:'原核实证据',reason:'真实核实'};assert.throws(()=>f.run('goods-logistics.delivery-verify',verify,{...f.warehouse,job:'support'}),/无权|岗位/);f.verify();assert.equal(f.fact.by.accountId,f.warehouse.accountId);assert.equal(f.fact.verifications[0].by.accountId,f.support.accountId);
  assert.equal(canAccountView(f.ops,'goods-logistics'),true);assert.equal(canAccountView(f.finance,'goods-logistics'),false);const account=f.s.staffAccounts.find(a=>a.id===f.support.accountId);f.run('account.status',{id:account.id,version:account.version,enabled:false,reason:'已撤销工作核实授权'},f.admin);assert.throws(()=>f.run('goods-logistics.delivery-verify',{...verify,version:f.o.version},f.support),/失效|变更/);
});

test('C06 统一待办原源导航可办理与回原列表，跨店/跨单/伪造源拒绝',()=>{
  const f=fixture();f.publish({deliveryFollowupMinutes:10,returnTransitFollowupMinutes:15,returnBackFollowupMinutes:20});f.create();f.delivery();const store=f.staff('store-manager','xingfu'),foreign=f.staff('store-manager','silver');
  const source=workTaskView(f.s,f.support).tasks.find(r=>r.id===`goods-delivery:${f.fact.id}:verify`);assert.ok(source);assert.equal(source.status,'open');assert.equal(source.canClaim,true);const c=taskContext(f,f.support,source),path=`/group/goods/${f.o.id}`;assert.equal(c.targetPath,path);assert.equal(taskNavigationTarget(f.s,f.support,c,path),true);assert.equal(taskReturnTarget(f.s,f.support,c,path),'/group/tasks?category=goods-logistics&status=open');assert.equal(taskNavigationTarget(f.s,f.finance,c,path),false);assert.equal(taskNavigationTarget(f.s,f.support,c,'/group/goods/G1001'),false);assert.equal(taskNavigationTarget(f.s,f.support,{...c,binding:{...c.binding,sourceId:'NOT-A-REAL-FACT'}},path),false);assert.doesNotMatch(JSON.stringify(c),/证据|ACTUAL|SOURCE-/);
  const local=workTaskView(f.s,store).tasks.find(r=>r.id===source.id);assert.ok(local);assert.equal(local.canClaim,false);assert.equal(workTaskView(f.s,foreign).tasks.some(r=>r.id===source.id),false);assert.throws(()=>taskContext(f,foreign,local));const localContext=taskContext(f,store,local),localPath=`/store/goods/${f.o.id}`;assert.equal(taskReturnTarget(f.s,store,localContext,localPath),'/store/tasks?category=goods-logistics&status=open');assert.equal(taskNavigationTarget(f.s,foreign,localContext,localPath),false);
  f.run('work.claim',{id:source.id,sourceToken:source.sourceToken,version:source.assignmentVersion,reason:'客服本人认领实际送达核实'},f.support);assert.equal(workTaskView(f.s,f.support).tasks.find(r=>r.id===source.id).ownerAccountId,f.support.accountId);f.verify();assert.equal(workTaskView(f.s,f.support).tasks.find(r=>r.id===source.id).status,'done');assert.equal(taskReturnTarget(f.s,f.support,c,path),c.listHash);
  const followup=workTaskView(f.s,f.support).tasks.find(r=>r.id===`goods-logistics:${f.o.id}:delivery`);assert.ok(followup);const fc=taskContext(f,f.support,followup);assert.equal(taskReturnTarget(f.s,f.support,fc,path),fc.listHash);
});
