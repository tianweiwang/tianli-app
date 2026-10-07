import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { seed, reduce, goodsSummary } from './engine.mjs';
import { lifecycleImpact, lifecycleSettlement, lifecycleFingerprint } from './organization-lifecycle-projection.mjs';
import { fulfilmentBindingToken } from './fulfilment.mjs';
import { serviceExtraSourceToken } from './service-finance-extras.mjs';
import { prepareServiceExtraEvidence } from './service-extra-file-validation.mjs';
import { prepareServicePromotionEvidence } from './service-promotion-file-validation.mjs';
import { servicePromotionBalanceToken } from './service-promotion.mjs';
import { resolveAccountActor } from './staff-accounts.mjs';

const user={role:'user',userId:'u1'}, tech={role:'tech',techId:'lin'}, finance={role:'group',job:'finance'}, support={role:'group',job:'support'}, operations={role:'group',job:'operations'}, warehouse={role:'group',job:'warehouse'}, local={role:'store',job:'store-finance',storeId:'xingfu'}, manager={role:'store',job:'store-manager',storeId:'xingfu'};
const options={goodsSummary}, storeScope={storeId:'xingfu'}, techScope={techId:'lin'}, MIN=60000;
function harness(){let state=seed(),seq=0;const h={get s(){return state;},get b(){return state.bookings.at(-1);},get o(){return state.goods.at(-1);},get bill(){return state.bills.at(-1);},run(type,p={},actor=user,runtime=null){let result;state=reduce(state,actor,type,{requestId:'lifecycle-source-'+ ++seq,...p},x=>result=x,runtime);return result;},advance(minutes){h.run('clock.advance',{minutes});},settlement(scope=storeScope){return lifecycleSettlement(state,scope,options);},impact(scope=storeScope){return lifecycleImpact(state,scope,options);},rules(){h.run('finance.rule-publish',{scope:'global',groupBps:1500,storeBps:500,version:0,effectiveAt:state.now,reason:'仅本地来源验证明确输入'},finance);h.run('tech-income.rule-publish',{storeId:'xingfu',serviceId:'all',version:0,rateBps:4000,refundPolicy:'proportional',rounding:'floor',effectiveAt:state.now,reason:'仅本地来源验证明确输入'},finance);},create(extra={}){h.run('booking.create',{storeId:'xingfu',serviceId:'relax',regionId:'home',techId:'lin',startAt:Math.ceil((state.now+4*3600000)/1800000)*1800000,mode:'specified',genderPreference:'any',contactName:'本地验证顾客',phone:'13800000001',healthConsent:true,identityVerified:true,adultConfirmed:true,...extra});return h.b;},confirm(){h.run('booking.pay',{id:h.b.id,outcome:'success'});h.run('booking.accept',{id:h.b.id},tech);},done(){h.create();h.confirm();h.advance((h.b.startAt-state.now)/MIN);h.run('booking.start',{id:h.b.id},tech);h.advance(60);h.run('booking.finish',{id:h.b.id,mode:'normal'},tech);},settleFunds(){h.advance(2880);let e=state.serviceFinanceEntries.at(-1);h.run('finance.split-start',{id:e.id,version:e.version,outcome:'processing'},finance);e=state.serviceFinanceEntries.at(-1);h.run('finance.split-query',{id:e.id,version:e.version,outcome:'success'},finance);e=state.serviceFinanceEntries.at(-1);h.run('finance.finish-start',{id:e.id,version:e.version,outcome:'success'},finance);},payout(){const e=state.techIncomeEntries.at(-1);h.run('tech-income.payout',{techId:e.techId,month:e.month,lines:[{entryId:e.id,version:e.version}],paidAt:state.now,proof:'LOCAL-LIFECYCLE-PAYOUT',reason:'本地原命令登记实发'},local);},goods(){h.run('promotion.enter',{storeId:'xingfu'});h.run('cart.set',{skuId:'oil',qty:1});h.run('goods.submit',{addressId:'AD1'});h.run('goods.pay',{id:h.o.id,outcome:'success'});h.run('goods.ship',{id:h.o.id,carrier:'本地验证物流',tracking:'LOCAL-'+seq},warehouse);h.run('goods.receive',{id:h.o.id});return h.o;},makeBill(){h.advance(10080);h.run('bill.create',{storeId:'xingfu'},finance);},payBill(){h.run('bill.confirm',{id:h.bill.id,version:h.bill.version},local);h.run('bill.pay',{id:h.bill.id,outcome:'processing'},finance);h.run('bill.query',{id:h.bill.id,outcome:'success'},finance);},refundGoods(amountCents=10000){h.run('goods.case',{id:h.o.id,kind:'refund',skuId:'oil',qty:1,amountCents,reason:'本地核实商品退款'});const caseId=h.o.cases.at(-1).id;h.run('goods.case-review',{id:h.o.id,caseId,decision:'approve',reason:'本地真实命令核实'},support);h.run('goods.refund',{id:h.o.id,caseId,outcome:'success'},finance);},factPayload(extra={}){const r=state.fulfilmentRecords.find(x=>x.bookingId===h.b.id);return{bookingId:h.b.id,bookingToken:fulfilmentBindingToken(h.b),version:r?.version||0,...extra};}};h.advance(1);return h;}
const has=(out,kind)=>out.blockers.some(x=>x.kind===kind);
function freeze(value){if(value&&typeof value==='object'){Object.freeze(value);for(const x of Object.values(value))freeze(x);}return value;}

test('C08 原退款和终结预约重复来源不能认已清，纯读取不修复重复资料',()=>{
  const h=harness();h.rules();h.create();h.confirm();h.run('booking.cancel',{id:h.b.id,reason:'本地原本人取消'});const r=h.b.refunds.at(-1);h.run('booking.refund-pay',{id:h.b.id,refundId:r.id,outcome:'success'},finance);
  assert.equal(h.settlement().clear,true);const duplicateRefund=structuredClone(h.s);duplicateRefund.bookings.at(-1).refunds.push(structuredClone(r));const before=structuredClone(duplicateRefund);
  assert.ok(has(lifecycleSettlement(duplicateRefund,storeScope,options),'source-invalid'));assert.deepEqual(duplicateRefund,before);
  const empty=harness();empty.create();empty.run('booking.cancel',{id:empty.b.id,reason:'本地未付款原预约取消'});const duplicateBooking=structuredClone(empty.s);duplicateBooking.bookings.push(structuredClone(empty.b));
  assert.ok(has(lifecycleImpact(duplicateBooking,techScope,options),'source-invalid'));
});

// Synthetic local file, read and hashed by the original evidence adapter.
async function promotionSource(h,type,p,actor=finance){
  const bytes=new TextEncoder().encode('%PDF-1.4\nLifecycle personal-source evidence\n%%EOF');
  const file={ref:'invoice-file:'+createHash('sha256').update(bytes).digest('hex'),name:'原个人佣金验证凭据.pdf',type:'application/pdf',size:bytes.length};
  const blob=new Blob([bytes],{type:file.type});
  const payload={requestId:'lifecycle-personal-'+h.s.seq+'-'+type,...p,...(p.reference?{occurredAt:h.s.now,file}:{} )};
  const evidence=await prepareServicePromotionEvidence(h.s,actor,type,payload,{readFile:async descriptor=>{assert.equal(descriptor.ref,file.ref);return blob;}});
  return h.run(type,payload,actor,evidence);
}

async function personalSetup(h){
  const personal={role:'user',userId:'u2'};h.rules();
  await promotionSource(h,'service-promotion.agreement-publish',{promoterType:'store-promoter',version:0,title:'本地原协议',body:'本地验证原邀请和本人接受、实名及资金事实。',effectiveAt:h.s.now,reference:'LOCAL-AGREEMENT',reason:'本地原协议来源'},support);
  await promotionSource(h,'service-promotion.invite',{userId:'u2',promoterType:'store-promoter',version:0,expiresAt:h.s.now+86400000,reason:'本地本人邀请'},manager);
  const invitation=h.s.servicePromotionInvites.at(-1);
  await promotionSource(h,'service-promotion.invite-confirm',{id:invitation.id,version:invitation.version,decision:'accept',agreementAccepted:true,agreementId:invitation.agreementSnapshot.id,reason:'本人本地接受'},personal);
  let promoter=h.s.servicePromoters.at(-1);
  await promotionSource(h,'service-promotion.identity-review',{id:promoter.id,version:promoter.version,decision:'verified',reference:'LOCAL-IDENTITY',reason:'本地实际身份依据'},support);
  promoter=h.s.servicePromoters.at(-1);
  await promotionSource(h,'service-promotion.transfer-authorize',{id:promoter.id,version:promoter.version,enabled:true,reason:'本人本地明确收款授权'},personal);
  await promotionSource(h,'service-promotion.rule-publish',{promoterType:'store-promoter',version:0,firstBps:2000,repeatBps:1000,storeCostBps:5000,csRounding:'floor',concurrency:'completed-created-id',lateFullRefund:'reassign',effectiveAt:h.s.now,basis:'本地原输入，正式审批另验'});
  await promotionSource(h,'service-promotion.enter',{promoterId:promoter.id,version:h.s.users.find(x=>x.id==='u1').serviceBinding.version},user);
  return personal;
}

test('C08 真实个人佣金普通停用保留旧权利，未知提现经原笔查询后解除',async()=>{
  const h=harness(),personal=await personalSetup(h);h.done();h.settleFunds();h.payout();
  const commission=h.s.serviceCommissions.at(-1);assert.equal(commission.status,'available');
  let p=h.settlement();assert.equal(p.clear,true);assert.equal(p.retainedRights.find(x=>x.kind==='service-commission').amountCents,5960);
  let promoter=h.s.servicePromoters.at(-1);
  await promotionSource(h,'service-promotion.disable',{id:promoter.id,version:promoter.version,kind:'exit',reason:'本地普通退出保留历史权利'},manager);
  assert.equal(h.s.servicePromoters.at(-1).status,'disabled');assert.equal(h.b.servicePromotionSnapshot.promoter.id,promoter.id);
  assert.equal(h.settlement().retainedRights.find(x=>x.kind==='service-commission').amountCents,5960);
  promoter=h.s.servicePromoters.at(-1);
  await promotionSource(h,'service-promotion.withdraw-create',{promoterId:promoter.id,version:promoter.version,amountCents:5960,balanceToken:servicePromotionBalanceToken(h.s,promoter.id)},personal);
  let withdrawal=h.s.servicePromotionWithdrawals.at(-1);
  await promotionSource(h,'service-promotion.withdraw-pay',{id:withdrawal.id,version:withdrawal.version,outcome:'processing',reason:'本地原转账结果未知'});
  p=h.settlement();assert.ok(has(p,'service-withdrawal'));assert.ok(has(p,'service-commission'));
  withdrawal=h.s.servicePromotionWithdrawals.at(-1);const originalNo=withdrawal.execution.requestNo;
  await promotionSource(h,'service-promotion.withdraw-query',{id:withdrawal.id,version:withdrawal.version,outcome:'success',reference:'LOCAL-PERSONAL-PAYMENT',reason:'本地实际原笔成功结果'});
  p=h.settlement();assert.equal(p.clear,true);assert.equal(h.s.servicePromotionWithdrawals.at(-1).execution.requestNo,originalNo);
  assert.equal(p.groups.servicePromotion.find(x=>x.kind==='service-commission').paidCents,5960);
  assert.equal(h.s.techIncomePayouts.at(-1).amountCents,11920);
});

test('C08 明确本人映射后的个人旧账进入技师scope，不依姓名手机号推断',async()=>{
  const h=harness();await personalSetup(h);h.done();h.settleFunds();
  assert.equal(h.settlement({techId:'zhou'}).groups.servicePromotion.length,0);
  const entered=h.run('account.enter',{accountId:'DEMO-ADMIN',grantId:'DEMO-ADMIN-GRANT'}),admin=resolveAccountActor(h.s,entered);
  const t=h.s.techs.find(x=>x.id==='zhou');
  h.run('lifecycle.identity-link',{techId:'zhou',userId:'u2',version:t.version,occurredAt:h.s.now,reference:'LOCAL-EXPLICIT-IDENTITY',reason:'本地实际核验本人关联'},admin);
  const p=h.settlement({techId:'zhou'}),c=p.groups.servicePromotion.find(x=>x.kind==='service-commission');
  assert.equal(c.amountCents,5960);assert.equal(c.known,true);assert.equal(p.groups.goods.length,0);assert.equal(p.groups.techIncome.length,0);
  assert.ok(p.retainedRights.some(x=>x.sourceId===c.sourceId));
});

function grantSource(h,t,storeId){
  const actor={role:'store',job:'store-manager',storeId};
  const run=(command,p={},who=actor)=>{const profile=h.s.techQualifications.find(x=>x.techId===t.id&&x.storeId===storeId);h.run('qualification.'+command,{techId:t.id,storeId,profileId:profile?.id,version:profile?.version||0,reason:'本地原店项目来源',...p},who);};
  run('assess',{serviceIds:['relax'],batch:'LOCAL-'+storeId,assessor:'本地实际考核人',proof:'LOCAL-ASSESS-'+storeId,occurredAt:h.s.now,result:'pass',kind:'initial'});
  let profile=h.s.techQualifications.find(x=>x.techId===t.id&&x.storeId===storeId);run('request',{assessmentId:profile.assessments.at(-1).id});
  profile=h.s.techQualifications.find(x=>x.techId===t.id&&x.storeId===storeId);run('review',{grantId:profile.grants.at(-1).id,decision:'approve',reviewer:'本地集团实际审核',proof:'LOCAL-REVIEW-'+storeId},operations);
  return h.s.techQualifications.find(x=>x.techId===t.id&&x.storeId===storeId);
}

test('C08 已付投影仍须有原实发流水，丢失来源不能认已清且不能补账',()=>{
  const h=harness();h.rules();h.done();h.settleFunds();h.payout();assert.equal(h.settlement().clear,true);
  const corrupt=structuredClone(h.s);corrupt.techIncomePayouts=[];const before=structuredClone(corrupt);
  const p=lifecycleSettlement(corrupt,storeScope,options),income=p.groups.techIncome.find(x=>x.kind==='tech-income');
  assert.equal(income.known,false);assert.equal(income.amountCents,null);assert.equal(income.paidCents,null);assert.ok(has(p,'tech-income'));assert.deepEqual(corrupt,before);
  for(const change of [state=>delete state.techIncomePayouts.at(-1).proof,state=>state.techIncomePayouts.at(-1).amountCents++,state=>state.techIncomePayouts.at(-1).lines.push(structuredClone(state.techIncomePayouts.at(-1).lines[0]))]){
    const missing=structuredClone(h.s);change(missing);const original=structuredClone(missing),projection=lifecycleSettlement(missing,storeScope,options);
    assert.equal(projection.groups.techIncome.find(x=>x.kind==='tech-income').known,false);assert.ok(has(projection,'tech-income'));assert.deepEqual(missing,original);
  }
});

test('C08 预约、分账、提成及资格返回现有原页面路径',()=>{
  const h=harness();h.rules();h.done();const p=h.impact();
  assert.equal(p.bookings[0].path,'/group/bookings/'+h.b.id);
  assert.equal(p.settlement.groups.serviceFinance.find(x=>x.kind==='service-finance').path,'/group/service-finance/entry/'+h.s.serviceFinanceEntries[0].id);
  assert.match(p.settlement.groups.techIncome[0].path,/^\/group\/service-finance\/income\?techId=lin&month=/);
  assert.equal(p.qualifications.find(x=>x.techId==='lin').path,'/group/qualifications/lin');
});

test('C08 表单来源token不可读，完整资金与工作会话变化仍使其失效',()=>{
  const h=harness();h.rules();h.done();const p=h.impact();
  assert.match(p.sourceToken,/^sha256:[a-f0-9]{64}$/);
  assert.match(p.settlement.sourceToken,/^sha256:[a-f0-9]{64}$/);
  for(const row of [...p.blockers,...p.retainedRights,...p.bookings,...p.fulfilment,...p.qualifications,...p.authorizations])assert.match(row.sourceToken,/^sha256:[a-f0-9]{64}$/);
  for(const marker of ['amountCents','29800','11920','accountVersion','staffSessions'])assert.equal(p.sourceToken.includes(marker),false);
  const changed=structuredClone(h.s);changed.bookings[0].payment.refundedCents=1;
  assert.notEqual(lifecycleImpact(changed,storeScope,options).sourceToken,p.sourceToken);
});

test('C08 同步canonical指纹与原生SHA-256逐字节一致，不依Node-only运行库',()=>{
  for(const value of ['', 'abc', '汉字😀原账', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(64), 'a'.repeat(100000)]) {
    assert.equal(lifecycleFingerprint(value),'sha256:'+createHash('sha256').update(JSON.stringify(value),'utf8').digest('hex'));
  }
  const first={z:['旧店',29800],a:{sessions:[{id:'INTERNAL-SESSION',accountVersion:2}],amountCents:11920}};
  const reordered={a:{amountCents:11920,sessions:[{accountVersion:2,id:'INTERNAL-SESSION'}]},z:['旧店',29800]};
  assert.equal(lifecycleFingerprint(first),lifecycleFingerprint(reordered));
  assert.notEqual(lifecycleFingerprint(first),lifecycleFingerprint({...first,z:[29800,'旧店']}));
  assert.equal(typeof lifecycleFingerprint(first),'string');assert.equal(lifecycleFingerprint(first).includes('INTERNAL-SESSION'),false);
});

test('C08 实际调店后旧店原单与旧资格/提成保留，新店仅认当前新资格',()=>{
  const h=harness();h.rules();
  h.run('manage.tech-save',{name:'本地真实调店师傅',phone:'13800006666',storeId:'xingfu',gender:'female',lat:31.231,lng:121.475,serviceIds:['relax'],certificate:'LOCAL-CERT',insurance:'LOCAL-INSURANCE',validUntil:'2027-12-31',reason:'本地原档案来源'},manager);
  let t=h.s.techs.at(-1);const person={role:'tech',techId:t.id};
  h.run('manage.tech-review',{id:t.id,version:t.version,decision:'approve',reason:'本地原审核'},operations);
  const oldProfile=structuredClone(grantSource(h,t,'xingfu'));
  h.create({techId:t.id});h.run('booking.pay',{id:h.b.id,outcome:'success'});h.run('booking.accept',{id:h.b.id},person);
  const originalBooking=h.b.id,payment=h.b.payment.id,merchant=h.b.payment.subMerchantId,assignment=structuredClone(h.b.technicianAssignmentSnapshot);
  t=h.s.techs.find(x=>x.id===t.id);const target=h.s.stores.find(x=>x.id==='silver');
  h.run('lifecycle.transfer-plan',{techId:t.id,toStoreId:target.id,version:t.version,targetVersion:target.version,effectiveAt:h.s.now+MIN,sourceToken:h.impact({techId:t.id}).sourceToken,reference:'LOCAL-ACTUAL-TRANSFER',reason:'本地集团明确生效计划'},operations);
  h.advance(1);t=h.s.techs.find(x=>x.id===t.id);assert.equal(t.storeId,'silver');assert.ok(t.qualificationProfileId);
  let p=h.impact({techId:t.id});assert.equal(p.qualifications.find(q=>q.storeId==='silver').allowed,false);
  assert.equal(p.qualifications.find(q=>q.storeId==='silver').profileId,t.qualificationProfileId);
  const old=h.impact(storeScope).qualifications.find(q=>q.techId===t.id&&q.storeId==='xingfu');assert.equal(old.profileId,oldProfile.id);assert.equal(old.allowed,true);assert.equal(old.current,false);assert.deepEqual(old.originalBookingIds,[originalBooking]);
  const newProfile=grantSource(h,t,'silver');p=h.impact({techId:t.id});
  assert.equal(p.qualifications.find(q=>q.storeId==='silver').profileId,newProfile.id);assert.equal(p.qualifications.find(q=>q.storeId==='silver').allowed,true);
  assert.deepEqual(h.s.techQualifications.find(q=>q.id===oldProfile.id),oldProfile);
  assert.deepEqual(h.b.technicianAssignmentSnapshot,assignment);assert.equal(h.b.payment.id,payment);assert.equal(h.b.payment.subMerchantId,merchant);
  h.advance((h.b.startAt-h.s.now)/MIN);h.run('booking.start',{id:originalBooking},person);h.advance(60);h.run('booking.finish',{id:originalBooking,mode:'normal'},person);
  assert.ok(h.settlement(storeScope).groups.techIncome.some(x=>x.techId===t.id&&x.storeId==='xingfu'));
  h.settleFunds();h.payout();assert.equal(h.settlement(storeScope).clear,true);
  assert.equal(h.s.techIncomePayouts.at(-1).storeId,'xingfu');assert.equal(h.b.storeId,'xingfu');assert.equal(h.b.payment.id,payment);
});

test('C08 scope严格唯一、真实主体，role/混合范围/重名均拒绝',()=>{const h=harness();for(const scope of [{},{role:'group'}, {...storeScope,...techScope},{storeId:'missing'},{techId:' lin'},{storeId:'xingfu',mode:'closing'}])assert.throws(()=>lifecycleImpact(h.s,scope,options));const broken=structuredClone(h.s);broken.stores.push(structuredClone(broken.stores[0]));assert.throws(()=>lifecycleSettlement(broken,storeScope,options),/不唯一/);});

test('C08 已初始化空业务纯读取且结果独立，缺容器不建账不认零',()=>{const h=harness(),before=structuredClone(h.s);freeze(h.s);const a=h.settlement(),b=h.impact();assert.equal(a.clear,true);assert.deepEqual(h.s,before);assert.equal(a.sourceToken,h.settlement().sourceToken);a.groups.goods.push({id:'local-only'});assert.equal(h.settlement().groups.goods.length,0);const legacy=seed(),legacyBefore=structuredClone(legacy);const v=lifecycleSettlement(legacy,storeScope,options);assert.equal(v.clear,false);assert.ok(has(v,'source-container-missing'));assert.deepEqual(legacy,legacyBefore);assert.ok(b.qualifications.some(q=>q.legacy&&q.known===false));});

test('C08 原支付未知→原笔查询成功，保留未知阻断和原资金来源',()=>{const h=harness();h.rules();h.create();h.run('booking.pay',{id:h.b.id,outcome:'processing'});const before=h.settlement();assert.ok(has(before,'service-payment-unknown'));const original=h.b.payment.id;h.run('booking.payment-query',{id:h.b.id,outcome:'success'},local);const after=h.settlement();assert.equal(h.b.payment.id,original);assert.equal(has(after,'service-payment-unknown'),false);assert.notEqual(before.sourceToken,after.sourceToken);assert.equal(after.groups.serviceFinance.find(x=>x.kind==='service-finance').paidCents,29800);});

test('C08 原完成→分账未知→查询→完结→提成实发逐项解除，不合并账本',()=>{const h=harness();h.rules();h.done();h.advance(2880);let e=h.s.serviceFinanceEntries[0];h.run('finance.split-start',{id:e.id,version:e.version,outcome:'processing'},finance);let p=h.settlement();assert.equal(p.groups.serviceFinance.find(x=>x.kind==='service-finance').unknownChannel,true);assert.ok(has(p,'tech-income'));e=h.s.serviceFinanceEntries[0];const originalNo=e.split.requestNo;h.run('finance.split-query',{id:e.id,version:e.version,outcome:'success'},finance);e=h.s.serviceFinanceEntries[0];h.run('finance.finish-start',{id:e.id,version:e.version,outcome:'success'},finance);p=h.settlement();assert.equal(has(p,'service-finance'),false);assert.ok(has(p,'tech-income'));assert.equal(p.groups.techIncome[0].amountCents,11920);h.payout();const after=h.settlement();assert.equal(after.clear,true);assert.equal(h.s.serviceFinanceEntries[0].split.requestNo,originalNo);assert.equal(h.s.techIncomePayouts[0].amountCents,11920);assert.equal(h.settlement(techScope).clear,true);});

test('C08 取消原退款未知→原退款查询成功，全退闭环按原服务账解除',()=>{const h=harness();h.rules();h.create();h.run('booking.pay',{id:h.b.id,outcome:'success'});h.run('booking.cancel',{id:h.b.id,reason:'本地原取消'});const refundId=h.b.refunds[0].id;h.run('booking.refund-pay',{id:h.b.id,refundId,outcome:'processing'},finance);const before=h.settlement();assert.ok(has(before,'service-refund'));assert.equal(before.groups.refunds[0].unknown,true);h.run('booking.refund-query',{id:h.b.id,refundId,outcome:'success'},finance);const after=h.settlement();assert.equal(has(after,'service-refund'),false);assert.equal(after.groups.serviceFinance.find(x=>x.kind==='service-finance').status,'void');assert.equal(after.clear,true);assert.equal(h.b.payment.refundedCents,29800);});

test('C08 缺原支付退款额、旧缺规则和重复账源均待核对，不推算零',()=>{const h=harness();h.create();h.run('booking.pay',{id:h.b.id,outcome:'success'});assert.equal(h.settlement().groups.serviceFinance.find(x=>x.kind==='service-finance').known,false);const corrupt=structuredClone(h.s);delete corrupt.bookings[0].payment.refundedCents;let p=lifecycleSettlement(corrupt,storeScope,options);const row=p.groups.serviceFinance.find(x=>x.kind==='service-finance');assert.equal(row.refundedCents,null);assert.equal(row.amountCents,null);assert.ok(has(p,'service-finance'));corrupt.serviceFinanceEntries.push(structuredClone(corrupt.serviceFinanceEntries[0]));p=lifecycleSettlement(corrupt,storeScope,options);assert.ok(has(p,'source-invalid'));assert.ok(has(p,'service-entry-missing'));});

test('C08 原来源商品未出账仍阻断，原建账/付款查询完成后解除',()=>{const h=harness();h.goods();const p=h.settlement();assert.equal(p.groups.goods[0].amountCents,2000);assert.ok(has(p,'goods-source'));assert.equal(h.s.bills.length,0);h.makeBill();h.run('bill.confirm',{id:h.bill.id,version:h.bill.version},local);h.run('bill.pay',{id:h.bill.id,outcome:'processing'},finance);const unknown=h.settlement();assert.ok(has(unknown,'goods-bills'));const original=h.bill.paymentId;h.run('bill.query',{id:h.bill.id,outcome:'success'},finance);const after=h.settlement();assert.equal(after.clear,true);assert.equal(h.bill.paymentId,original);assert.equal(h.o.commissionPaidCents,2000);assert.equal(after.groups.goods[0].amountCents,0);});

test('C08 商品旧已付款后退款→原现金回款解除债务，不抵服务账',()=>{const h=harness();h.goods();h.makeBill();h.payBill();h.refundGoods();const before=h.settlement();assert.ok(has(before,'goods-debts'));assert.equal(before.groups.goodsSettlement.find(x=>x.kind==='goods-debts').amountCents,1000);const debt=h.s.recoveries[0];h.run('recovery.receive',{id:debt.id,amountCents:1000,proof:'LOCAL-GOODS-CASH'},finance);const after=h.settlement();assert.equal(has(after,'goods-debts'),false);assert.equal(after.clear,true);assert.equal(h.s.serviceFinanceEntries.length,0);assert.equal(h.s.recoveries[0].recoveredCents,1000);});

test('C08 缺商品适配、追回金额缺失或不存在来源不能视作清偿',()=>{const h=harness();h.goods();const before=structuredClone(h.s);const missing=lifecycleSettlement(h.s,storeScope);assert.ok(has(missing,'goods-source'));assert.equal(missing.groups.goods[0].known,false);assert.match(missing.groups.goods[0].reason,/getter/);assert.deepEqual(h.s,before);h.makeBill();h.payBill();h.refundGoods();const corrupt=structuredClone(h.s);delete corrupt.recoveries[0].amountCents;const p=lifecycleSettlement(corrupt,storeScope,options);assert.ok(has(p,'goods-debts'));assert.equal(p.groups.goodsSettlement.find(x=>x.kind==='goods-debts').amountCents,null);});

test('C08 技师scope不收别人的商品账/预约，原拟改派在被提案技师scope可见',()=>{const h=harness();h.rules();h.create();h.confirm();h.run('booking.assign',{id:h.b.id,techId:'zhou',reason:'本地改派候选'},manager);h.goods();const lin=h.impact(techScope),zhou=h.impact({techId:'zhou'}),chen=h.impact({techId:'chen'});assert.equal(lin.bookings.length,1);assert.equal(zhou.bookings.length,1);assert.equal(zhou.bookings[0].proposed,true);assert.equal(zhou.bookings[0].current,false);assert.equal(chen.bookings.length,0);assert.equal(lin.settlement.groups.goods.length,0);assert.equal(zhou.bookings[0].changeId,h.b.change.id);});

test('C08 独立出发事实待核实→原核实后归履约中，保持原预约状态',()=>{const h=harness();h.rules();h.create();h.confirm();h.run('fulfilment.policy-publish',{storeId:'xingfu',version:0,collectorMode:'tech-only',noticeMode:'none',departureContactMinutes:null,escalateMinutes:null,blockUnconfirmed:false,effectiveAt:h.s.now,basis:'本地显式采集分工',reason:'仅本地验收输入'},support);h.run('fulfilment.fact-record',h.factPayload({kind:'departure',occurredAt:h.s.now,positionMode:'manual',place:'本地实际出发点',evidence:'本地技师实际出发记录'}),tech);const before=h.impact(techScope);assert.equal(before.bookings[0].stage,'needs-review');const fact=h.s.fulfilmentRecords[0].facts[0];h.run('fulfilment.fact-verify',h.factPayload({factId:fact.id,decision:'verified',reason:'核实实际出发依据',evidence:'实际原证据核验通过'}),support);const after=h.impact(techScope);assert.equal(after.bookings[0].stage,'fulfilling');assert.equal(after.bookings[0].needsCoordination,false);assert.equal(h.b.status,'confirmed');assert.equal(h.b.departedAt,undefined);assert.equal(after.fulfilment[0].occurredAt,h.s.fulfilmentRecords[0].facts[0].occurredAt);});

test('C08 实际服务结束和安全离开分别读取，原确认解除安全阻断',()=>{const h=harness();h.rules();h.done();let p=h.impact(techScope);assert.ok(has(p,'safe-departure'));const row=h.s.fulfilmentDepartures[0],money=structuredClone(h.b.payment);h.run('fulfilment.departure-confirm',{bookingId:h.b.id,bookingToken:fulfilmentBindingToken(h.b),departureId:row.id,version:row.version,safeLeft:true,occurredAt:h.s.now,positionMode:'manual',place:'本地安全离开位置',evidence:'本地本人已实际离开'},tech);p=h.impact(techScope);assert.equal(has(p,'safe-departure'),false);assert.equal(h.b.status,'done');assert.deepEqual(h.b.payment,money);assert.equal(p.fulfilment.find(x=>x.kind==='safe-departure').status,'confirmed');});

test('C08 新资格真实审查/暂停及凭据来源保持，纯投影不补旧资历',()=>{const h=harness();h.run('manage.tech-save',{name:'本地生命周期师傅',phone:'13800005555',storeId:'xingfu',gender:'female',lat:31.231,lng:121.475,serviceIds:['relax'],certificate:'LOCAL-C',insurance:'LOCAL-I',validUntil:'2027-12-31',reason:'本地实际档案来源'},manager);const t=h.s.techs.at(-1);h.run('manage.tech-review',{id:t.id,version:t.version,decision:'approve',reason:'本地审核'},operations);const qual=(command,p={},actor=manager)=>{const q=h.s.techQualifications.find(x=>x.techId===t.id);h.run('qualification.'+command,{techId:t.id,version:q?.version||0,reason:'本地原资格来源',...p},actor);};qual('assess',{serviceIds:['relax'],batch:'LOCAL',assessor:'本地考核人',proof:'LOCAL-QUAL-ASSESS',occurredAt:h.s.now,result:'pass',kind:'initial'});let q=h.s.techQualifications.at(-1);qual('request',{assessmentId:q.assessments[0].id});q=h.s.techQualifications.at(-1);qual('review',{grantId:q.grants[0].id,decision:'approve',reviewer:'本地集团审核',proof:'LOCAL-QUAL-REVIEW'},operations);let p=h.impact({techId:t.id});assert.equal(p.qualifications[0].known,true);assert.equal(p.qualifications[0].allowed,true);assert.equal(p.qualifications[0].credentials.certificateRecorded,true);qual('pause',{serviceIds:['relax'],owner:'本地复训责任人'});p=h.impact({techId:t.id});assert.equal(p.qualifications[0].allowed,false);assert.equal(p.qualifications[0].holdIds.length,1);const before=structuredClone(h.s);h.impact({techId:t.id});assert.deepEqual(h.s,before);});

test('C08 原账号授予/撤销后生效授权和会话证据改变，保留原授权记录',()=>{const h=harness();const enter=h.run('account.enter',{accountId:'DEMO-ADMIN',grantId:'DEMO-ADMIN-GRANT'}),admin=resolveAccountActor(h.s,enter);const a=h.run('account.create',{name:'本地清算财务',reason:'本地原账号授权'},admin),granted=h.run('account.grant',{id:a.id,version:a.version,job:'store-finance',storeId:'xingfu',reason:'本地原门店授权'},admin);const working=h.run('account.enter',{accountId:a.id,grantId:granted.grants[0].id});const before=h.impact();const g=before.authorizations.find(x=>x.accountId===a.id);assert.equal(g.effective,true);assert.equal(g.sessions[0].id,working.sessionId);h.run('account.revoke',{id:a.id,version:granted.version,grantId:granted.grants[0].id,reason:'本地清算完成撤权'},admin);const after=h.impact();assert.equal(after.authorizations.find(x=>x.accountId===a.id).effective,false);assert.notEqual(before.sourceToken,after.sourceToken);assert.equal(after.authorizations.find(x=>x.accountId===a.id).sessions[0].revokedAt,h.s.now);});

test('C08 内部来源token绑定资金及授权，投影不泄露健康/联系/事实正文',()=>{const h=harness();h.rules();h.create();h.confirm();h.b.contactName='SECRET-CONTACT';h.b.phone='SECRET-PHONE';h.b.healthNote='SECRET-HEALTH';const before=structuredClone(h.s),p=h.impact();const json=JSON.stringify(p);for(const value of ['SECRET-CONTACT','SECRET-PHONE','SECRET-HEALTH'])assert.equal(json.includes(value),false);assert.deepEqual(h.s,before);const changed=structuredClone(h.s);changed.bookings[0].payment.refundedCents=1;assert.notEqual(lifecycleImpact(changed,storeScope,options).sourceToken,p.sourceToken);for(const r of [...p.blockers,...p.retainedRights]){assert.equal(typeof r.path,'string');assert.ok(r.path.startsWith('/group/'));assert.equal(typeof r.sourceId,'string');assert.equal(typeof r.sourceToken,'string');}});

test('C08 原退款不足→实际附件补款→原笔成功退款，extras阻断才解除',async()=>{const h=harness();h.rules();h.create();h.run('booking.pay',{id:h.b.id,outcome:'success'});h.run('booking.cancel',{id:h.b.id,reason:'本地不足退款'});const rid=h.b.refunds[0].id;h.run('booking.refund-pay',{id:h.b.id,refundId:rid,outcome:'failed'},finance);const bytes=new TextEncoder().encode('%PDF-1.4\nLifecycle original funds evidence\n%%EOF'),file={ref:'invoice-file:'+createHash('sha256').update(bytes).digest('hex'),name:'原资金测试凭据.pdf',type:'application/pdf',size:bytes.length},blob=new Blob([bytes],{type:file.type});let part=h.b.refunds[0].executions[0];const payload={bookingId:h.b.id,paymentId:h.b.payment.id,refundId:rid,shortageCents:10000,failedAt:part.updatedAt,sourceToken:serviceExtraSourceToken(h.s,h.b.id,h.b.payment.id),version:0,requestId:'lifecycle-shortage',reference:part.refundNo,occurredAt:part.updatedAt,file,reason:'本地原笔实际不足来源'};let evidence=await prepareServiceExtraEvidence(h.s,local,'service-extra.refund-shortage',payload,{readFile:async()=>blob});h.run('service-extra.refund-shortage',payload,local,evidence);const before=h.settlement();assert.ok(has(before,'service-extra-refunds'));const issue=h.s.serviceRefundShortages[0],dueAt=issue.dueAt;const recharge={id:issue.id,version:issue.version,requestId:'lifecycle-recharge',amountCents:10000,reference:'LOCAL-MERCHANT-RECHARGE',occurredAt:h.s.now,file,reason:'本地实际商户补足'};evidence=await prepareServiceExtraEvidence(h.s,local,'service-extra.recharge',recharge,{readFile:async()=>blob});h.run('service-extra.recharge',recharge,local,evidence);assert.ok(has(h.settlement(),'service-extra-refunds'));h.run('booking.refund-pay',{id:h.b.id,refundId:rid,outcome:'success'},finance);assert.equal(has(h.settlement(),'service-extra-refunds'),false);assert.equal(h.s.serviceRefundShortages[0].dueAt,dueAt);assert.equal(h.settlement().clear,true);});
