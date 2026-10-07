import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {seed,reduce,upgradeFinanceState} from './engine.mjs';
import {serviceExtraSourceToken} from './service-finance-extras.mjs';
import {serviceFinanceSummary} from './service-finance.mjs';
import {serviceFinanceComposition} from './service-finance-composition.mjs';
import {prepareServiceExtraEvidence} from './service-extra-file-validation.mjs';
import {authorizedInvoiceFile} from './invoice-files.mjs';
import {workTaskView} from './work-tasks.mjs';
import {createTaskReturnContext,taskNavigationTarget,taskReturnTarget} from './task-navigation.mjs';
import {customerView} from './customer.mjs';
import {staffView} from './staff.mjs';
import {resolveAccountActor} from './staff-accounts.mjs';
import {renderServiceFinanceExtras} from './service-finance-extras-ui.mjs';

const u={role:'user',userId:'u1'},t={role:'tech',techId:'lin'},g={role:'group',job:'finance'},a={role:'store',job:'store-finance',storeId:'xingfu'};
const bytes=new TextEncoder().encode('%PDF-1.4\nLocal integration evidence\n%%EOF');
const file={ref:'invoice-file:'+createHash('sha256').update(bytes).digest('hex'),name:'本地凭证.pdf',type:'application/pdf',size:bytes.length};
const blob=new Blob([bytes],{type:file.type});
const ui={esc:x=>String(x??''),money:x=>`¥${(Number(x)/100).toFixed(2)}`,date:x=>String(x??''),button:(x,c,p={})=>`<button data-command="${c}">${x}</button>`,link:(x,p)=>`<a href="#${p}">${x}</a>`,field:(x,n,v='')=>`<input name="${n}" value="${v}">`,select:(x,n)=>`<select name="${n}"></select>`,tag:x=>`<span>${x}</span>`,empty:x=>`<section>${x}</section>`,query:new URLSearchParams()};

function harness(initialNow){
  let s=seed(),n=0;
  if(initialNow!=null)s.now=initialNow;
  const h={get s(){return s;},get b(){return s.bookings.at(-1);},get issue(){return s.serviceRefundShortages.at(-1);},get advance(){return h.issue.advances.at(-1);},get debt(){return s.serviceExtraRecoveries.at(-1);},get plan(){return s.serviceExtraOffsets.at(-1);},
    async run(type,p={},actor=g){let result;const row=p.id?[...(s.serviceExtraEvidence||[]),...(s.serviceRefundShortages||[]),...(s.serviceExtraRecoveries||[]),...(s.serviceExtraOffsets||[])].find(x=>x.id===p.id):null;const payload={requestId:'C04-shared-'+ ++n,version:row?.version||0,...p};const evidence=await prepareServiceExtraEvidence(s,actor,type,payload,{readFile:async descriptor=>{assert.equal(descriptor.ref,file.ref);return blob;}});s=reduce(s,actor,type,payload,r=>result=r,evidence);return result;},
    proof(reference='DEMO-FACT-'+ ++n,occurredAt=s.now){return{reference,occurredAt,file,reason:'本地合成凭证用于验证原命令链'};},
    async create(){await h.run('booking.create',{storeId:'xingfu',serviceId:'relax',regionId:'home',techId:'lin',startAt:Math.ceil((s.now+4*3600000)/1800000)*1800000,mode:'specified',genderPreference:'any',contactName:'Demo顾客',phone:'13800000001',healthConsent:true,identityVerified:true,adultConfirmed:true},u);await h.run('booking.pay',{id:h.b.id,outcome:'success'},u);return h.b;},
    async failed(){await h.create();const id=h.b.id;await h.run('booking.cancel',{id,reason:'本地原取消退款验收'},u);await h.run('booking.refund-pay',{id,refundId:h.b.refunds.at(-1).id,outcome:'failed'});return h.b;},
    async shortage(){const b=await h.failed(),r=b.refunds.at(-1),part=r.executions[0];return h.run('service-extra.refund-shortage',{bookingId:b.id,paymentId:b.payment.id,refundId:r.id,shortageCents:10000,failedAt:part.updatedAt,sourceToken:serviceExtraSourceToken(s,b.id,b.payment.id),...h.proof(part.refundNo,part.updatedAt)},a);},
    async decide(path='merchant-balance'){await h.run('clock.advance',{minutes:1440});const policy=await h.run('service-extra.policy-publish',{path,effectiveAt:s.now,basis:'共享测试明确Demo路径，不作为正式决定'});await h.run('service-extra.advance-decision',{id:h.issue.id,decision:'approve',path,policyId:policy.id,amountCents:path==='direct-user'?h.issue.refundCents:10000,reason:'本地逐案决定'});if(path==='direct-user')await h.run('service-extra.advance-confirm',{id:h.issue.id,advanceId:h.advance.id,decision:'accept',reason:'本人确认本款完整直接退款'},u);},
    async funded(){await h.shortage();await h.decide();await h.run('service-extra.advance-pay',{id:h.issue.id,advanceId:h.advance.id,outcome:'success',...h.proof()});},
    async future(){await h.create();await h.run('booking.accept',{id:h.b.id},t);await h.run('clock.advance',{minutes:240});await h.run('booking.start',{id:h.b.id},t);await h.run('clock.advance',{minutes:60});await h.run('booking.finish',{id:h.b.id,mode:'normal'},t);await h.run('clock.advance',{minutes:2880});return s.serviceFinanceEntries.find(x=>x.bookingId===h.b.id);},
    async staff(job,storeId){const adminResult=await h.run('account.enter',{accountId:'DEMO-ADMIN',grantId:'DEMO-ADMIN-GRANT'},u),admin=resolveAccountActor(s,adminResult);const row=await h.run('account.create',{name:'C04共享'+job,reason:'本地合成岗位'},admin);const granted=await h.run('account.grant',{id:row.id,version:row.version,job,...(storeId?{storeId}:{}),reason:'本地原岗位授权'},admin);const entered=await h.run('account.enter',{accountId:row.id,grantId:granted.grants.at(-1).id},u);return resolveAccountActor(s,entered);}
  };return h;
}

test('C04 实际附件集合单独注入reduce，payload自称已核验或缺附件不能写不足事项',async()=>{
  const h=harness();await h.failed();const b=h.b,part=b.refunds[0].executions[0],p={bookingId:b.id,paymentId:b.payment.id,refundId:b.refunds[0].id,shortageCents:10000,failedAt:part.updatedAt,sourceToken:serviceExtraSourceToken(h.s,b.id,b.payment.id),...h.proof(part.refundNo),version:0,requestId:'NO-RUNTIME',validateEvidenceRefs:true,evidenceVerified:true};const before=structuredClone(h.s);
  assert.throws(()=>reduce(h.s,a,'service-extra.refund-shortage',p),/不存在|核验/);assert.deepEqual(h.s,before);
  const checked=await prepareServiceExtraEvidence(h.s,a,'service-extra.refund-shortage',p,{readFile:async()=>blob});const next=reduce(h.s,a,'service-extra.refund-shortage',p,()=>{},checked);assert.equal(next.serviceRefundShortages.length,1);assert.equal(next.bookings[0].payment.refundedCents,0);
  assert.throws(()=>reduce(h.s,a,'service-extra.refund-shortage',p,()=>{},{evidenceRefs:[{...file,size:file.size+1}]}),/不存在|核验/);
});

test('C04 原取消失败→余额不足→本店实际补足→原退款成功，补足不假退款且期限固定',async()=>{
  const h=harness();await h.shortage();const due=h.issue.dueAt,id=h.b.id,rid=h.b.refunds[0].id;
  assert.throws(()=>reduce(h.s,g,'booking.refund-pay',{id,refundId:rid,outcome:'success'}),/补足|绕过/);
  await h.run('service-extra.recharge',{id:h.issue.id,amountCents:10000,...h.proof()},a);assert.equal(h.issue.status,'retry_ready');assert.equal(h.issue.dueAt,due);assert.equal(h.b.payment.refundedCents,0);
  await h.run('booking.refund-pay',{id,refundId:rid,outcome:'success'});assert.equal(h.b.payment.refundedCents,29800);assert.equal(h.issue.status,'refunded');assert.equal(h.s.serviceExtraRecoveries.length,0);assert.equal(h.s.goods.length,0);assert.equal(h.s.bills.length,0);
});

test('C04 原表单保留失败事实秒和毫秒，精确建立24小时不足期限',async()=>{
  const h=harness(Date.parse('2026-10-02T09:00:45.123+08:00'));
  await h.failed();
  const refund=h.b.refunds.at(-1),part=refund.executions[0],failedAt=part.updatedAt;
  const html=renderServiceFinanceExtras(h.s,a,'shortages');
  const form=html.match(/<form[^>]*data-command="service-extra\.refund-shortage"[\s\S]*?<\/form>/)?.[0];
  assert.ok(form);
  const decode=x=>x.replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
  const source=JSON.parse(decode(form.match(/data-payload="([^"]+)"/)[1]));
  const option=form.match(/<select name="failedAt"[^>]*>[\s\S]*?<option value="(\d+)"/)[1];
  assert.equal(Number(option),failedAt);
  const payload={...source,shortageCents:10000,...h.proof(part.refundNo),failedAt:Number(option),occurredAt:Number(option)};
  await assert.rejects(()=>h.run('service-extra.refund-shortage',{...payload,failedAt:Math.floor(failedAt/60000)*60000}),/失败时间|余额不足时间/);
  await h.run('service-extra.refund-shortage',payload,a);
  assert.equal(h.issue.failedAt,failedAt);
  assert.equal(h.issue.failureEvidence.occurredAt,failedAt);
  assert.equal(h.issue.dueAt,failedAt+86400000);
  assert.equal(h.b.payment.refundedCents,0);
  assert.equal(part.status,'failed');
});

test('C04 本人确认直接垫付→未知原笔→实读凭证查询成功，原退款精确结清且不双付',async()=>{
  const h=harness();await h.shortage();await h.decide('direct-user');const id=h.issue.id,aid=h.advance.id,originalNo=h.b.refunds[0].executions[0].refundNo;
  await h.run('service-extra.advance-pay',{id,advanceId:aid,outcome:'processing'});assert.equal(h.b.payment.refundedCents,0);assert.equal(h.s.serviceExtraRecoveries.length,0);
  assert.throws(()=>reduce(h.s,g,'booking.refund-pay',{id:h.b.id,refundId:h.b.refunds[0].id,outcome:'success'}),/不能同时/);
  const p={id,advanceId:aid,outcome:'success',...h.proof('DIRECT-ONE'),version:h.issue.version,requestId:'DIRECT-QUERY'};assert.throws(()=>reduce(h.s,g,'service-extra.advance-query',p),/不存在|核验/);
  await h.run('service-extra.advance-query',p);assert.equal(h.b.payment.refundedCents,29800);assert.equal(h.b.refunds[0].executions[0].refundNo,originalNo);assert.equal(h.b.refunds[0].executions[0].paymentPath,'direct-user');assert.equal(h.debt.amountCents,29800);
  await h.run('service-extra.advance-query',p);assert.equal(h.b.payment.refundedCents,29800);assert.equal(h.b.refunds[0].offlinePaymentFacts.length,1);assert.equal(h.s.serviceExtraRecoveries.length,1);
});

test('C04 同店后续服务追收复用原分账；未知不清债，正常份额与偿债金额分开',async()=>{
  const h=harness();await h.run('finance.rule-publish',{scope:'global',groupBps:1000,storeBps:500,effectiveAt:h.s.now,version:0,reason:'本地明确验收规则'});await h.funded();assert.equal(h.b.payment.refundedCents,0);
  const e=await h.future();await h.run('service-extra.offset-propose',{entryId:e.id,recoveryId:h.debt.id,amountCents:2000,sourceToken:serviceExtraSourceToken(h.s,e.bookingId,e.paymentId),reason:'同店后续服务实际追收'});await h.run('service-extra.offset-confirm',{id:h.plan.id,decision:'accept',reason:'本店核对正常分成和追收'},a);
  assert.throws(()=>reduce(h.s,g,'finance.split-start',{id:e.id,version:e.version,outcome:'success'}),/原方案/);
  assert.equal(h.plan.cashCompositionRequest.hCents,2980);assert.equal(h.plan.cashCompositionRequest.csCents,0);
  await h.run('service-extra.offset-pay',{id:h.plan.id,outcome:'processing'});assert.equal(h.debt.receivedCents,0);const original=h.s.serviceFinanceEntries.find(x=>x.id===e.id).split;
  assert.equal(original.cashCompositionRequest.source.sourceId,original.id);assert.equal(original.cashCompositionRequest.normalCents,2980);assert.equal(original.cashComposition,undefined);const originalComposition=structuredClone(original.cashCompositionRequest);
  await h.run('service-extra.offset-query',{id:h.plan.id,outcome:'success'});const after=h.s.serviceFinanceEntries.find(x=>x.id===e.id);assert.equal(after.split.requestNo,original.requestNo);assert.equal(after.split.amountCents,2980);assert.equal(after.split.channelTotalCents,4980);assert.equal(h.debt.receivedCents,2000);assert.equal(serviceFinanceSummary(h.s,e.bookingId,e.paymentId).splitPaidCents,2980);assert.equal(h.s.bills.length,0);assert.equal(h.s.recoveries.length,0);
  assert.deepEqual(after.split.cashCompositionRequest,originalComposition);assert.equal(after.split.cashComposition.actualAt,after.split.completedAt);const composition=serviceFinanceComposition(h.s,e.id);assert.equal(composition.known,true);assert.equal(composition.hReceivedCents,2980);assert.equal(composition.csReceivedCents,0);assert.equal(composition.principalRows[0].amountCents,2000);
});

test('C04 不足待办绑定真实原预约/支付/门店，原阶段结束后仍能返回，拒绝跨源与跨店',async()=>{
  const h=harness();await h.shortage();const task=workTaskView(h.s,a).tasks.find(x=>x.category==='service-extra-shortage'),hash='/store/tasks?category=service-extra-shortage&status=active&q='+h.b.id,context=createTaskReturnContext(h.s,a,{taskKey:task.id,listHash:hash,task,token:'C04-return'});
  assert.equal(taskNavigationTarget(h.s,a,context,task.route),true);assert.equal(taskNavigationTarget(h.s,a,context,'/store/bookings/'+h.b.id),true);
  assert.equal(taskNavigationTarget(h.s,{...a,storeId:'silver'},context,task.route),false);assert.equal(taskNavigationTarget(h.s,a,context,'/store/service-finance/extras/shortages/OTHER'),false);
  await h.run('service-extra.recharge',{id:h.issue.id,amountCents:10000,...h.proof()},a);await h.run('booking.refund-pay',{id:h.b.id,refundId:h.b.refunds[0].id,outcome:'success'});assert.equal(taskReturnTarget(h.s,a,context,task.route),hash);
  const projected=workTaskView(h.s,a).tasks.find(x=>x.sourceId===h.issue.id&&x.category==='service-extra-shortage');assert.equal(projected.status,'done');assert.ok(!JSON.stringify(projected).includes(file.ref));
});

test('C04 实际岗位会话、本人原单与证据域隔离；用户详情仅展示该预约方案',async()=>{
  const h=harness();await h.shortage();await h.decide('direct-user');const ownBooking=h.b.id;
  assert.deepEqual(authorizedInvoiceFile(h.s,a,h.issue.id,'failure:0',file.ref,'service-extra'),file);for(const actor of [u,{...a,storeId:'silver'},{role:'group',job:'warehouse'}])assert.throws(()=>authorizedInvoiceFile(h.s,actor,h.issue.id,'failure:0',file.ref,'service-extra'),/无权/);
  const storeActor=await h.staff('store-finance','xingfu');assert.match(staffView(h.s,storeActor,['service-finance','extras','shortages'],ui),/退款余额不足/);
  const warehouse=await h.staff('warehouse');assert.throws(()=>reduce(h.s,{...warehouse,role:'group',job:'finance'},'service-extra.policy-publish',{path:'direct-user',effectiveAt:h.s.now,basis:'伪造岗位',version:1,requestId:'FORGED'}),/无权/);
  await h.create();const otherBooking=h.b.id;assert.ok(!customerView(h.s,u,['booking',otherBooking],ui).includes('预约 '+ownBooking+' 的退款方案'));assert.ok(customerView(h.s,u,['booking',ownBooking],ui).includes('预约 '+ownBooking+' 的退款方案'));
});

test('C04 增量加载不伪造历史依据或实际款，反复升级保持原预约事实',async()=>{
  const h=harness();await h.create();const before=structuredClone(h.b);const saved=structuredClone(h.s);for(const key of ['serviceExtraEvidence','serviceExtraPolicies','serviceRefundShortages','serviceExtraRecoveries','serviceExtraOffsets','serviceExtraRequests'])delete saved[key];upgradeFinanceState(saved);const once=structuredClone(saved);upgradeFinanceState(saved);assert.deepEqual(saved,once);assert.deepEqual(saved.bookings.at(-1),before);assert.equal(saved.serviceExtraEvidence.length,0);assert.equal(saved.serviceExtraPolicies.length,0);assert.equal(saved.serviceExtraRecoveries.length,0);
});

test('C04 原组合结果未知期间原退款变化，query仍核原正常组成与原本金',async()=>{
  const h=harness();await h.run('finance.rule-publish',{scope:'global',groupBps:1000,storeBps:500,effectiveAt:h.s.now,version:0,reason:'本地原H配置'});await h.funded();const e=await h.future();
  await h.run('service-extra.offset-propose',{entryId:e.id,recoveryId:h.debt.id,amountCents:2000,sourceToken:serviceExtraSourceToken(h.s,e.bookingId,e.paymentId),reason:'原正常款加原债本金'});await h.run('service-extra.offset-confirm',{id:h.plan.id,decision:'accept',reason:'本店确认原金额'},a);await h.run('service-extra.offset-pay',{id:h.plan.id,outcome:'processing'});
  const request=structuredClone(h.plan.cashCompositionRequest),original=structuredClone(h.s.serviceFinanceEntries.find(x=>x.id===e.id).split),support={role:'group',job:'support'};
  await h.run('clock.advance',{minutes:1});await h.run('booking.special-aftersale',{id:e.bookingId,requests:[{paymentId:e.paymentId,amountCents:14900}],reason:'查询前原服务部分售后'},support);const refund=h.b.refunds.at(-1);await h.run('booking.refund-review',{id:e.bookingId,refundId:refund.id,decision:'approve',reason:'核准原本款售后'},support);await h.run('booking.refund-pay',{id:e.bookingId,refundId:refund.id,paymentId:e.paymentId,outcome:'success'});
  assert.equal(serviceFinanceSummary(h.s,e.bookingId,e.paymentId).targetGroupCents,1490);await h.run('clock.advance',{minutes:1});await h.run('service-extra.offset-query',{id:h.plan.id,outcome:'success'});
  const tx=h.s.serviceFinanceEntries.find(x=>x.id===e.id).split,projection=serviceFinanceComposition(h.s,e.id);assert.deepEqual(tx.cashCompositionRequest,request);assert.deepEqual(h.plan.cashCompositionRequest,request);assert.equal(tx.id,original.id);assert.equal(tx.requestNo,original.requestNo);assert.equal(tx.amountCents,2980);assert.equal(tx.cashComposition.hCents,2980);assert.equal(tx.cashComposition.csCents,0);assert.equal(tx.cashComposition.actualAt,tx.completedAt);assert.equal(projection.hReceivedCents,2980);assert.equal(projection.principalRows[0].amountCents,2000);assert.equal(h.debt.receivedCents,2000);
});

test('C04 旧plan和原tx缺组成时只查询原现金，不倒套当前H目标',async()=>{
  const h=harness();await h.run('finance.rule-publish',{scope:'global',groupBps:1000,storeBps:500,effectiveAt:h.s.now,version:0,reason:'本地原H配置'});await h.funded();const e=await h.future();
  await h.run('service-extra.offset-propose',{entryId:e.id,recoveryId:h.debt.id,amountCents:2000,sourceToken:serviceExtraSourceToken(h.s,e.bookingId,e.paymentId),reason:'旧方案源测试'});await h.run('service-extra.offset-confirm',{id:h.plan.id,decision:'accept',reason:'本店确认原金额'},a);await h.run('service-extra.offset-pay',{id:h.plan.id,outcome:'processing'});
  delete h.plan.cashCompositionRequest;delete h.s.serviceFinanceEntries.find(x=>x.id===e.id).split.cashCompositionRequest;const original=structuredClone(h.s.serviceFinanceEntries.find(x=>x.id===e.id).split);await h.run('service-extra.offset-query',{id:h.plan.id,outcome:'success'});
  const tx=h.s.serviceFinanceEntries.find(x=>x.id===e.id).split,projection=serviceFinanceComposition(h.s,e.id);assert.equal(tx.cashCompositionRequest,undefined);assert.equal(tx.cashComposition,undefined);assert.equal(h.plan.cashCompositionRequest,undefined);assert.equal(tx.id,original.id);assert.equal(tx.requestNo,original.requestNo);assert.equal(tx.amountCents,original.amountCents);assert.equal(tx.channelTotalCents,original.channelTotalCents);assert.equal(projection.known,false);assert.equal(projection.hReceivedCents,null);assert.equal(projection.principalRows[0].amountCents,2000);assert.equal(h.debt.receivedCents,2000);
});

test('C04 原正常额零的组合执行只清偿本金，成功不伪造H或Cs',async()=>{
  const h=harness();await h.run('finance.rule-publish',{scope:'global',groupBps:0,storeBps:0,effectiveAt:h.s.now,version:0,reason:'本地正常份额为零配置'});await h.funded();const e=await h.future();
  await h.run('service-extra.offset-propose',{entryId:e.id,recoveryId:h.debt.id,amountCents:2000,sourceToken:serviceExtraSourceToken(h.s,e.bookingId,e.paymentId),reason:'本店后续实际本金追收'});assert.equal(h.plan.normalCents,0);assert.equal(h.plan.cashCompositionRequest,undefined);await h.run('service-extra.offset-confirm',{id:h.plan.id,decision:'accept',reason:'本店确认仅本金'},a);await h.run('service-extra.offset-pay',{id:h.plan.id,outcome:'processing'});await h.run('service-extra.offset-query',{id:h.plan.id,outcome:'success'});
  const tx=h.s.serviceFinanceEntries.find(x=>x.id===e.id).split,projection=serviceFinanceComposition(h.s,e.id);assert.equal(tx.amountCents,0);assert.equal(tx.channelTotalCents,2000);assert.equal(tx.cashComposition,undefined);assert.equal(tx.cashCompositionRequest,undefined);assert.equal(projection.known,true);assert.equal(projection.rows.length,0);assert.equal(projection.hNetCents,0);assert.equal(projection.csNetCents,0);assert.equal(projection.principalRows[0].amountCents,2000);assert.equal(h.debt.receivedCents,2000);
});

test('C04 明确失败后的原方案重试复用原组成请求，原债仅成功结清一次',async()=>{
  const h=harness();await h.run('finance.rule-publish',{scope:'global',groupBps:1000,storeBps:500,effectiveAt:h.s.now,version:0,reason:'本地原H配置'});await h.funded();const e=await h.future();
  await h.run('service-extra.offset-propose',{entryId:e.id,recoveryId:h.debt.id,amountCents:2000,sourceToken:serviceExtraSourceToken(h.s,e.bookingId,e.paymentId),reason:'明确失败原方案重试'});await h.run('service-extra.offset-confirm',{id:h.plan.id,decision:'accept',reason:'本店确认原款'},a);await h.run('service-extra.offset-pay',{id:h.plan.id,outcome:'failed'});
  const failed=structuredClone(h.s.serviceFinanceEntries.find(x=>x.id===e.id).split),request=structuredClone(h.plan.cashCompositionRequest);assert.equal(h.debt.receivedCents,0);await h.run('clock.advance',{minutes:1});await h.run('service-extra.offset-pay',{id:h.plan.id,outcome:'processing'});assert.equal(h.debt.receivedCents,0);await h.run('service-extra.offset-query',{id:h.plan.id,outcome:'success',requestId:'OFFSET-FINAL-QUERY'});const tx=h.s.serviceFinanceEntries.find(x=>x.id===e.id).split;
  assert.deepEqual(tx.cashCompositionRequest,request);assert.deepEqual(h.plan.cashCompositionRequest,request);assert.equal(tx.id,failed.id);assert.equal(tx.requestNo,failed.requestNo);assert.equal(tx.createdAt,failed.createdAt);assert.equal(tx.attempts,2);assert.equal(tx.cashComposition.hCents,2980);assert.equal(tx.cashComposition.csCents,0);assert.equal(h.debt.receivedCents,2000);const before=structuredClone({entries:h.s.serviceFinanceEntries,debts:h.s.serviceExtraRecoveries,plans:h.s.serviceExtraOffsets,requests:h.s.serviceExtraRequests});await h.run('service-extra.offset-query',{id:h.plan.id,outcome:'success',requestId:'OFFSET-FINAL-QUERY',version:h.plan.version-1});assert.deepEqual({entries:h.s.serviceFinanceEntries,debts:h.s.serviceExtraRecoveries,plans:h.s.serviceExtraOffsets,requests:h.s.serviceExtraRequests},before);
});
