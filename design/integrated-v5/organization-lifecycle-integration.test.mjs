import test from 'node:test';
import assert from 'node:assert/strict';
import {seed,reduce,goodsSummary} from './engine.mjs';
import {lifecycleImpact,lifecycleCaseImpact} from './organization-lifecycle-projection.mjs';
import {lifecycleCasesView,syncLifecycle,lifecycleCompletionView,lifecycleCommand} from './organization-lifecycle.mjs';
import {qualificationEligibility} from './tech-qualification.mjs';
import {upgradeOrganizationLifecycle} from './organization-lifecycle.mjs';
import {lifecycleAuthorityPreflight,applyLifecycleAuthorityExit,lifecycleHandoverCommands} from './organization-lifecycle-authority.mjs';
import {fulfilmentBindingToken} from './fulfilment.mjs';
const ops={role:'group',job:'operations'},user={role:'user',userId:'u1'},store={role:'store',storeId:'xingfu'};
const MIN=60000,HOUR=60*MIN;
function harness() {
  let state=seed(),seq=0;
  const h={get s(){return state;},get t(){return state.techs.at(-1);},get q(){const t=h.t;return state.techQualifications.find(q=>q.techId===t.id&&q.storeId===t.storeId&&(!t.qualificationProfileId||q.id===t.qualificationProfileId));},get c(){return state.organizationLifecycleCases.at(-1);},get b(){return state.bookings.at(-1);},run(a,type,p={}){let result;state=reduce(state,a,type,{requestId:'organization-int-'+ ++seq,reason:'隔离原组织流程验收',...p},r=>result=r);return result;},advance(minutes){h.run(user,'clock.advance',{minutes});},impact(scope={techId:h.t.id}){return lifecycleImpact(state,scope,{goodsSummary});},authorize(storeId=h.t.storeId){const local={role:'store',storeId};const q=(type,p={},a=local)=>h.run(a,'qualification.'+type,{techId:h.t.id,version:h.q?.version||0,...p});q('assess',{serviceIds:['neck'],batch:'本次独立考核名单',assessor:'实际隔离考核人',proof:'ORG-ASSESS-'+seq,occurredAt:state.now,result:'pass',kind:'initial'});q('request',{assessmentId:h.q.assessments.at(-1).id});q('review',{grantId:h.q.grants.at(-1).id,decision:'approve',reviewer:'集团隔离审核人',proof:'ORG-GRANT-'+seq},ops);},book(extra={},a=user){h.run(a,'booking.create',{storeId:'xingfu',serviceId:'neck',techId:h.t.id,regionId:'home',mode:'specified',genderPreference:'any',startAt:Math.ceil((state.now+5*HOUR)/(30*MIN))*30*MIN,contactName:'合成客户',phone:'13800001111',healthConsent:true,identityVerified:true,adultConfirmed:true,...extra});return h.b;},confirm(b=h.b){h.run({role:'user',userId:b.userId},'booking.pay',{id:b.id,outcome:'success'});h.run({role:'tech',techId:b.techId},'booking.accept',{id:b.id});return state.bookings.find(x=>x.id===b.id);},plan(extra={}){return h.run(ops,'lifecycle.transfer-plan',{techId:h.t.id,version:h.t.version,sourceToken:h.impact().sourceToken,toStoreId:'silver',targetVersion:state.stores.find(x=>x.id==='silver').version,effectiveAt:state.now+10*MIN,reference:'ORG-TRANSFER',...extra});}};
  h.advance(1);
  h.run(store,'manage.tech-save',{name:'调店隔离师傅',phone:'13800005561',storeId:'xingfu',gender:'female',lat:31.231,lng:121.475,serviceIds:['neck'],certificate:'ORG-CERT',insurance:'ORG-INSURANCE',validUntil:'2027-12-31'});
  h.run(ops,'manage.tech-review',{id:h.t.id,version:h.t.version,decision:'approve'}); h.authorize(); return h;
}

const completionContext={goodsSummary,lifecycleAuthorityPreflight,applyLifecycleAuthorityExit};
function staffSources(h,{linked=false}={}) {
  const admin=h.run(user,'account.enter',{accountId:'DEMO-ADMIN',grantId:'DEMO-ADMIN-GRANT'}),members=[];
  const create=(job,storeId,techId)=>{
    let account=h.run(admin,'account.create',{name:'原组织真实'+job});
    account=h.run(admin,'account.employment',{id:account.id,version:account.version,employmentStatus:'active',reference:'ORG-EMPLOYMENT-'+job,verifiedAt:h.s.now,...(techId?{techId}:{})});
    account=h.run(admin,'account.grant',{id:account.id,version:account.version,job,...(storeId?{storeId}:{})});
    const grant=account.grants.at(-1),actor=h.run(user,'account.enter',{accountId:account.id,grantId:grant.id});
    return {id:account.id,grantId:grant.id,job,storeId,actor};
  };
  members.push(create('support'),create('finance'),create('store-finance','xingfu'));
  const worker=linked?create('store-manager','xingfu',h.t.id):null;
  return {admin,members,worker,create,accept(caseId=h.c.id){const c=h.s.organizationLifecycleCases.find(x=>x.id===caseId),impact=lifecycleCaseImpact(h.s,c.id,{goodsSummary}),stores=new Set([c.fromStoreId,...impact.bookings.map(x=>x.storeId),...Object.values(impact.settlement.groups).flat().map(x=>x.storeId)].filter(Boolean));for(const m of members){if(m.storeId&&!stores.has(m.storeId))continue;for(const storeId of m.storeId?[m.storeId]:stores){const a=h.s.staffAccounts.find(x=>x.id===m.id);const handover=h.run(admin,'account.handover',{caseId:c.id,caseVersion:c.version,accountId:a.id,accountVersion:a.version,grantId:m.grantId,storeId,allowedCommands:lifecycleHandoverCommands(m.job),reference:'ORG-HANDOVER-'+m.job+'-'+storeId});h.run(m.actor,'account.handover-accept',{id:handover.id,version:handover.version,reference:'ORG-SELF-ACCEPT-'+m.job+'-'+storeId});}}}};
}
function completion(h,caseId=h.c.id){return lifecycleCompletionView(h.s,caseId,completionContext);}

test('真实原岗位本人承接后可完成调店，撤原店授权和会话，重复完成不重复执行',()=>{
  const h=harness(),staff=staffSources(h,{linked:true}),operator=staff.create('operations');h.plan();h.advance(10);staff.accept();
  const view=completion(h);assert.equal(view.canComplete,true,view.blockers.map(x=>x.reason).join('；'));
  const c=h.c,p={requestId:'stable-complete',id:c.id,version:c.version,sourceToken:view.sourceToken};
  const result=h.run(operator.actor,'lifecycle.complete',p);assert.equal(result.stage,'completed');assert.equal(h.c.completedAt,h.s.now);
  assert.ok(result.authorityReceipt.endedGrantIds.includes(staff.worker.grantId));assert.ok(result.authorityReceipt.revokedSessionIds.includes(staff.worker.actor.sessionId));
  assert.throws(()=>h.run(staff.worker.actor,'booking.busy-create',{techId:h.t.id,startAt:h.s.now+HOUR,endAt:h.s.now+2*HOUR,reason:'旧会话已结束'}),/失效/);
  const before=structuredClone(h.s);assert.deepEqual(h.run(operator.actor,'lifecycle.complete',p),result);assert.equal(h.s.revision,before.revision+1);assert.deepEqual({...h.s,revision:before.revision},before);
  assert.throws(()=>h.run(operator.actor,'lifecycle.complete',{...p,reason:'改用同一提交'}),/同一提交标识/);
});

test('原服务退款清结后关闭门店，旧会话撤销，重进限定账号仅能办理本案原来源',()=>{
  const h=harness(),staff=staffSources(h,{linked:true}),finance={role:'group',job:'finance'};
  h.run(finance,'finance.rule-publish',{scope:'global',version:0,groupBps:1500,storeBps:500,effectiveAt:h.s.now,reason:'本地关店显式财务参数'});
  h.book();const old=h.confirm();h.run(user,'booking.cancel',{id:old.id,reason:'原本人取消后原款退回'});const r=h.s.bookings.find(x=>x.id===old.id).refunds.at(-1);h.run(finance,'booking.refund-pay',{id:old.id,refundId:r.id,outcome:'success'});
  h.book({storeId:'silver',techId:'ma',regionId:'silver'},{role:'user',userId:'u2'});const foreign=h.confirm();const subject=h.s.stores.find(x=>x.id==='xingfu');
  h.run(ops,'lifecycle.store-close-start',{storeId:subject.id,version:subject.version,sourceToken:h.impact({storeId:subject.id}).sourceToken,reference:'ORG-FINAL-CLOSE'});staff.accept();
  const c=h.c,view=completion(h);assert.equal(view.canComplete,true,view.blockers.map(x=>x.reason).join('；'));h.run(ops,'lifecycle.complete',{id:c.id,version:c.version,sourceToken:view.sourceToken});
  const closed=h.s.stores.find(x=>x.id==='xingfu'),member=staff.members.find(x=>x.job==='store-finance');assert.equal(closed.lifecycleStatus,'closed');assert.equal(closed.closedAt,h.s.now);assert.equal(closed.active,false);
  assert.ok(h.c.authorityReceipt.retainedGrantIds.includes(member.grantId));assert.ok(h.c.authorityReceipt.endedGrantIds.includes(staff.worker.grantId));
  assert.throws(()=>h.run(member.actor,'booking.payment-query',{id:old.id,outcome:'success'}),/失效/);
  const limited=h.run(user,'account.enter',{accountId:member.id,grantId:member.grantId});h.run(limited,'booking.payment-query',{id:old.id,outcome:'success'});
  const before=structuredClone(h.s);assert.throws(()=>h.run(limited,'booking.payment-query',{id:foreign.id,outcome:'success'}),/限定承接|原来源/);assert.deepEqual(h.s,before);
  assert.throws(()=>h.run(ops,'manage.store-status',{id:closed.id,version:closed.version,status:'open'}),/关停|关闭/);assert.throws(()=>h.book(),/关停|关闭|营业|不可用|暂不支持/);
  assert.equal(h.s.bookings.find(x=>x.id===foreign.id).status,'confirmed');assert.equal(h.s.bookings.find(x=>x.id===old.id).payment.refundedCents,19800);
});

test('明确本人原历史出口接齐后实际离职完成，结束工作身份且原资历/本人来源保持',async()=>{
  const {createTechHistoricalRightsAdapters}=await import('./tech-historical-rights.mjs');
  const h=harness(),staff=staffSources(h,{linked:true}),operator=staff.create('operations');
  const original=structuredClone({qualification:h.q,certificate:h.t.certificate,insurance:h.t.insurance}),techId=h.t.id;
  h.run(staff.admin,'lifecycle.identity-link',{techId,userId:'u2',version:h.t.version,reference:'ORG-PERSON-DEPARTURE',occurredAt:h.s.now});
  h.run(ops,'lifecycle.departure-start',{techId,version:h.t.version,sourceToken:h.impact().sourceToken,reference:'ORG-FINAL-DEPARTURE'});staff.accept();
  const missing=lifecycleCompletionView(h.s,h.c.id,completionContext);assert.equal(missing.canComplete,false);assert.ok(missing.blockers.some(x=>x.kind==='historical-adapter'));
  const adapters=createTechHistoricalRightsAdapters(),ctx={...completionContext,historicalRightsAdapters:adapters};
  const view=lifecycleCompletionView(h.s,h.c.id,ctx);assert.equal(view.canComplete,true,view.blockers.map(x=>x.reason).join('；'));const c=h.c;
  h.run(operator.actor,'lifecycle.complete',{id:c.id,version:c.version,sourceToken:view.sourceToken});
  assert.equal(h.c.stage,'completed');assert.equal(h.t.lifecycleStatus,'left');assert.equal(h.t.leftAt,h.s.now);assert.equal(h.t.active,false);assert.equal(h.t.publicCredentialsVisible,false);
  assert.equal(h.t.certificate,original.certificate);assert.equal(h.t.insurance,original.insurance);assert.deepEqual(h.s.techQualifications.find(x=>x.id===original.qualification.id),original.qualification);
  assert.ok(h.c.authorityReceipt.endedGrantIds.includes(staff.worker.grantId));assert.ok(h.c.authorityReceipt.revokedSessionIds.includes(staff.worker.actor.sessionId));
  assert.throws(()=>h.run(staff.worker.actor,'booking.busy-create',{techId,startAt:h.s.now+HOUR,endAt:h.s.now+2*HOUR}),/失效|已结束/);
  assert.throws(()=>h.run({role:'tech',techId},'booking.schedule-save',{techId}),/离职|工作身份.*结束/);
  const person={role:'user',userId:'u2'},before=structuredClone(h.s),income=adapters.incomeView(h.s,person,techId),promotion=adapters.promotionView(h.s,person,techId);
  assert.ok(income.entries.every(x=>x.techId===techId));assert.ok(promotion.promoters.length>0);assert.ok(promotion.promoters.every(x=>x.personKind==='tech'&&x.personId===techId));assert.deepEqual(h.s,before);
  assert.throws(()=>adapters.promotionView(h.s,user,techId),/本人|无权|映射|身份/);
});

test('承接原授权变化使旧完成来源失效，越权完成与未本人确认均拒绝',()=>{
  const h=harness(),staff=staffSources(h);h.plan();h.advance(10);
  let view=completion(h);assert.equal(view.canComplete,false);assert.ok(view.blockers.some(x=>x.kind.startsWith('handover-')));
  staff.accept();view=completion(h);assert.equal(view.canComplete,true);
  const m=staff.members.find(x=>x.job==='support'),a=h.s.staffAccounts.find(x=>x.id===m.id);
  h.run(staff.admin,'account.revoke',{id:a.id,version:a.version,grantId:m.grantId});const before=structuredClone(h.s);
  assert.throws(()=>h.run(ops,'lifecycle.complete',{id:h.c.id,version:h.c.version,sourceToken:view.sourceToken}),/来源已变化/);assert.deepEqual(h.s,before);
  const current=completion(h);assert.equal(current.canComplete,false);assert.ok(current.blockers.some(x=>x.kind==='handover-invalid'));
  for(const actor of [user,store,{role:'tech',techId:h.t.id},{role:'group',job:'finance'},{role:'group',job:'support'}])assert.throws(()=>h.run(actor,'lifecycle.complete',{id:h.c.id,version:h.c.version,sourceToken:current.sourceToken}),/岗位|无权|身份/);
});

test('旧单后置原退款查询清结后可完成旧调店，未结束的新店未来单继续保留',()=>{
  const h=harness(),staff=staffSources(h);h.run({role:'group',job:'finance'},'finance.rule-publish',{scope:'global',version:0,groupBps:1500,storeBps:500,effectiveAt:h.s.now,reason:'本地闭环显式原财务参数'});h.book();const old=h.confirm();h.plan();h.advance(10);h.authorize('silver');
  h.book({storeId:'silver',startAt:old.startAt+2*HOUR},{role:'user',userId:'u2'});const future=h.confirm();staff.accept();
  h.run(user,'booking.cancel',{id:old.id,reason:'原客户取消旧店预约'});let b=h.s.bookings.find(x=>x.id===old.id),r=b.refunds.at(-1);
  h.run({role:'group',job:'finance'},'booking.refund-pay',{id:old.id,refundId:r.id,outcome:'processing'});let view=completion(h);
  assert.ok(view.blockers.some(x=>x.kind==='service-refund'));assert.equal(view.canComplete,false);
  h.run({role:'group',job:'finance'},'booking.refund-query',{id:old.id,refundId:r.id,outcome:'success'});view=completion(h);
  assert.equal(view.canComplete,true,view.blockers.map(x=>x.reason).join('；'));const current=h.c;
  h.run(ops,'lifecycle.complete',{id:current.id,version:current.version,sourceToken:view.sourceToken});
  assert.equal(h.c.stage,'completed');assert.equal(h.s.bookings.find(x=>x.id===future.id).status,'confirmed');assert.equal(h.s.bookings.find(x=>x.id===future.id).storeId,'silver');
  assert.equal(h.s.bookings.find(x=>x.id===old.id).payment.refundedCents,19800);
});

test('原服务完成、安全确认、原分账查询及原店实发全部满足才可完成调店',()=>{
  const h=harness(),staff=staffSources(h),finance={role:'group',job:'finance'};
  h.run(finance,'finance.rule-publish',{scope:'global',version:0,groupBps:1500,storeBps:500,effectiveAt:h.s.now,reason:'本地闭环显式财务参数'});
  h.run(finance,'tech-income.rule-publish',{storeId:'xingfu',serviceId:'all',version:0,rateBps:4000,refundPolicy:'proportional',rounding:'floor',effectiveAt:h.s.now,reason:'本地闭环显式原店提成参数'});
  h.book();const old=h.confirm();h.plan();h.advance(10);staff.accept();h.advance((old.startAt-h.s.now)/MIN);
  const tech={role:'tech',techId:h.t.id};h.run(tech,'booking.start',{id:old.id});h.advance(45);h.run(tech,'booking.finish',{id:old.id,mode:'normal'});
  let view=completion(h);assert.ok(view.blockers.some(x=>x.kind==='lifecycle-aftersale-window'));assert.ok(view.blockers.some(x=>x.kind==='safe-departure'));
  const missingExit=structuredClone(h.s);missingExit.fulfilmentDepartures=[];assert.ok(lifecycleCompletionView(missingExit,h.c.id,completionContext).blockers.some(x=>x.kind==='lifecycle-safe-departure-source'));
  const b=h.s.bookings.find(x=>x.id===old.id),departure=h.s.fulfilmentDepartures.find(x=>x.bookingId===old.id);
  h.run(tech,'fulfilment.departure-confirm',{bookingId:old.id,bookingToken:fulfilmentBindingToken(b),departureId:departure.id,version:departure.version,safeLeft:true,occurredAt:h.s.now,positionMode:'manual',place:'本地实际安全离开位置',evidence:'本地实际安全离开确认'});
  h.advance(2881);let e=h.s.serviceFinanceEntries.find(x=>x.bookingId===old.id);
  h.run(finance,'finance.split-start',{id:e.id,version:e.version,outcome:'processing'});view=completion(h);assert.ok(view.blockers.some(x=>x.kind==='service-finance'&&x.unknownChannel));
  e=h.s.serviceFinanceEntries.find(x=>x.bookingId===old.id);h.run(finance,'finance.split-query',{id:e.id,version:e.version,outcome:'success'});
  e=h.s.serviceFinanceEntries.find(x=>x.bookingId===old.id);h.run(finance,'finance.finish-start',{id:e.id,version:e.version,outcome:'success'});
  view=completion(h);assert.ok(view.blockers.some(x=>x.kind==='tech-income'));assert.equal(view.canComplete,false);
  const income=h.s.techIncomeEntries.find(x=>x.bookingId===old.id);h.run({role:'store',job:'store-finance',storeId:'xingfu'},'tech-income.payout',{techId:income.techId,month:income.month,lines:[{entryId:income.id,version:income.version}],paidAt:h.s.now,proof:'ORG-ORIGINAL-PAYOUT',reason:'本地实际原店提成发放流水'});
  view=completion(h);assert.equal(view.canComplete,true,view.blockers.map(x=>x.reason).join('；'));const c=h.c;
  h.run(ops,'lifecycle.complete',{id:c.id,version:c.version,sourceToken:view.sourceToken});assert.equal(h.c.stage,'completed');assert.equal(h.s.techIncomePayouts.at(-1).amountCents,7920);
  assert.equal(h.s.bookings.find(x=>x.id===old.id).storeId,'xingfu');assert.equal(h.s.bookings.find(x=>x.id===old.id).payment.amountCents,19800);
});

test('多次真实迁店每案保留起点/资格来源，第二案新单不回流已完成第一案',()=>{
  const h=harness(),staff=staffSources(h);h.run({role:'group',job:'finance'},'finance.rule-publish',{scope:'global',version:0,groupBps:1500,storeBps:500,effectiveAt:h.s.now,reason:'本地多次迁店显式原财务参数'});h.plan();h.advance(10);staff.accept();let c=h.c,view=completion(h);
  assert.equal(view.canComplete,true,view.blockers.map(x=>x.reason).join('；'));h.run(ops,'lifecycle.complete',{id:c.id,version:c.version,sourceToken:view.sourceToken});
  const firstId=h.c.id,firstBasis=structuredClone(h.c.responsibilityBasis),firstReceipt=structuredClone(h.c.authorityReceipt);h.authorize('silver');
  staff.members.push(staff.create('store-finance','silver'));
  h.book({storeId:'silver'});const secondOld=h.confirm();h.plan({toStoreId:'xingfu',targetVersion:h.s.stores.find(x=>x.id==='xingfu').version,reference:'ORG-SECOND-TRANSFER'});const secondId=h.c.id;h.advance(10);h.authorize('xingfu');
  h.book({startAt:secondOld.startAt+2*HOUR},{role:'user',userId:'u2'});const future=h.confirm();staff.accept(secondId);
  h.run(user,'booking.cancel',{id:secondOld.id,reason:'原客户取消第二案原门店预约'});const r=h.s.bookings.find(x=>x.id===secondOld.id).refunds.at(-1);
  h.run({role:'group',job:'finance'},'booking.refund-pay',{id:secondOld.id,refundId:r.id,outcome:'success'});view=completion(h,secondId);
  assert.equal(view.canComplete,true,view.blockers.map(x=>x.reason).join('；'));c=h.s.organizationLifecycleCases.find(x=>x.id===secondId);
  h.run(ops,'lifecycle.complete',{id:c.id,version:c.version,sourceToken:view.sourceToken});
  const first=h.s.organizationLifecycleCases.find(x=>x.id===firstId);assert.deepEqual(first.responsibilityBasis,firstBasis);assert.deepEqual(first.authorityReceipt,firstReceipt);
  assert.ok(!lifecycleCaseImpact(h.s,firstId,{goodsSummary}).bookings.some(x=>x.sourceId===secondOld.id||x.sourceId===future.id));
  assert.ok(!lifecycleCaseImpact(h.s,secondId,{goodsSummary}).bookings.some(x=>x.sourceId===future.id));assert.equal(h.t.storeId,'xingfu');
  assert.equal(h.s.techQualifications.filter(x=>x.techId===h.t.id&&x.storeId==='xingfu').length,2);assert.equal(h.q.id,h.t.qualificationProfileId);
});

test('组织提交及来源仅留opaque摘要，旧幂等透明摘要转换后仍可重放',()=>{
  const h=harness(),p={requestId:'stable-opaque-transfer',techId:h.t.id,version:h.t.version,sourceToken:h.impact().sourceToken,toStoreId:'silver',targetVersion:h.s.stores.find(x=>x.id==='silver').version,effectiveAt:h.s.now+10*MIN,reference:'ORG-OPAQUE'};
  h.run(ops,'lifecycle.transfer-plan',p);const request=h.s.organizationLifecycleRequests.at(-1);
  assert.match(request.actorKey,/^sha256:[a-f0-9]{64}$/);assert.match(request.signature,/^sha256:[a-f0-9]{64}$/);
  const oldActor={role:'group',job:'operations',id:'group'},oldPayload={requestId:p.requestId,reason:'隔离原组织流程验收',...p};
  request.actorKey=JSON.stringify(oldActor);request.signature=JSON.stringify({type:'lifecycle.transfer-plan',p:oldPayload});
  upgradeOrganizationLifecycle(h.s);h.run(ops,'lifecycle.transfer-plan',p);assert.equal(h.s.organizationLifecycleCases.length,1);
  assert.match(h.s.organizationLifecycleRequests.at(-1).signature,/^sha256:[a-f0-9]{64}$/);
  assert.throws(()=>h.run(ops,'lifecycle.cancel-plan',{id:h.c.id,version:h.c.version,sourceToken:JSON.stringify(h.impact())}),/影响事项已变化/);
});

test('每案原责任包含生效前原单及之后原退款，排除迁入新店未来订单',()=>{
  const h=harness();h.book();const old=h.confirm();h.plan();const caseId=h.c.id;h.advance(10);h.authorize('silver');
  h.book({storeId:'silver',startAt:old.startAt+2*HOUR},{role:'user',userId:'u2'});const future=h.confirm();
  let view=lifecycleCaseImpact(h.s,caseId,{goodsSummary});assert.deepEqual(view.bookings.map(x=>x.sourceId),[old.id]);
  assert.ok(view.settlement.groups.serviceFinance.every(x=>x.bookingId!==future.id));
  const basis=structuredClone(h.s.organizationLifecycleCases.find(c=>c.id===caseId).responsibilityBasis);
  h.run(user,'booking.cancel',{id:old.id,reason:'原本人取消旧店服务'});
  let b=h.s.bookings.find(x=>x.id===old.id);const refund=b.refunds.at(-1);
  h.run({role:'group',job:'finance'},'booking.refund-pay',{id:old.id,refundId:refund.id,outcome:'processing'});
  view=lifecycleCaseImpact(h.s,caseId,{goodsSummary});assert.ok(view.blockers.some(x=>x.kind==='service-refund'&&x.bookingId===old.id));
  assert.ok(view.settlement.groups.refunds.some(x=>x.sourceId===refund.id&&x.unknown));
  assert.deepEqual(h.s.organizationLifecycleCases.find(c=>c.id===caseId).responsibilityBasis,basis);
  assert.equal(h.s.bookings.find(x=>x.id===future.id).storeId,'silver');
});

test('计划开始后、生效前新增原承诺在真实生效事务补入每案责任',()=>{
  const h=harness();h.plan();const caseId=h.c.id;assert.equal(h.c.responsibilityBasis.bookingIds.length,0);
  h.book();const old=h.confirm();h.advance(10);const c=h.s.organizationLifecycleCases.find(c=>c.id===caseId);
  assert.ok(c.responsibilityHistory.some(x=>x.bookingIds.includes(old.id)));
  assert.ok(lifecycleCaseImpact(h.s,caseId,{goodsSummary}).bookings.some(x=>x.sourceId===old.id));
  const broken=structuredClone(h.s);broken.organizationLifecycleCases.find(c=>c.id===caseId).responsibilityBasis.cutoffAt++;
  assert.ok(lifecycleCaseImpact(broken,caseId,{goodsSummary}).blockers.some(x=>x.kind==='lifecycle-case-source'));
});

test('缺真实权限adapter不能完成；拒绝不会截断原时钟/原款办理',()=>{
  const h=harness();h.plan();h.advance(10);const c=h.c,ctx={goodsSummary},view=lifecycleCompletionView(h.s,c.id,ctx);
  assert.equal(view.canComplete,false);assert.ok(view.blockers.some(x=>x.kind==='lifecycle-authority-adapter'));
  const before=structuredClone(h.s);
  const candidate=structuredClone(h.s);assert.throws(()=>lifecycleCommand(candidate,ops,'lifecycle.complete',{requestId:'missing-actual-adapter',reason:'缺真实适配不能完成',id:c.id,version:c.version,sourceToken:view.sourceToken},ctx),/真实工作授权.*适配/);assert.deepEqual(candidate,before);
  assert.throws(()=>h.run(ops,'lifecycle.complete',{id:c.id,version:c.version,sourceToken:view.sourceToken}),/适配|原组织|来源|岗位|无权/);
  assert.deepEqual(h.s,before);h.advance(1);assert.equal(h.s.now,before.now+MIN);assert.equal(h.c.stage,'effective');
});

test('离职原未出发预约须本人确认改派，实际生效后仅结束该技师协调责任',()=>{
  const h=harness();h.book();const old=h.confirm();
  h.run(ops,'lifecycle.departure-start',{techId:h.t.id,version:h.t.version,sourceToken:h.impact().sourceToken,reference:'ORG-DEPART-COORDINATION'});
  const caseId=h.c.id;h.run(store,'booking.assign',{id:old.id,techId:'zhou',reason:'原未出发预约协调改派'});
  let view=lifecycleCaseImpact(h.s,caseId,{goodsSummary});assert.ok(view.blockers.some(x=>x.kind==='booking'));
  h.run(user,'booking.change-answer',{id:old.id,changeId:h.s.bookings.find(b=>b.id===old.id).change.id,decision:'accept'});
  view=lifecycleCaseImpact(h.s,caseId,{goodsSummary});assert.ok(view.bookings.some(x=>x.sourceId===old.id&&x.resolvedForSubject));
  assert.equal(h.s.bookings.find(x=>x.id===old.id).techId,'zhou');assert.equal(h.s.bookings.find(x=>x.id===old.id).status,'confirmed');
  assert.ok(!lifecycleCompletionView(h.s,caseId,{goodsSummary}).blockers.some(x=>x.kind==='lifecycle-booking-open'));
});

test('离职原责任连续实际改派保留完整确认链，丢失任一原链仍阻断',()=>{
  const h=harness();h.book();const old=h.confirm();
  h.run(ops,'lifecycle.departure-start',{techId:h.t.id,version:h.t.version,sourceToken:h.impact().sourceToken,reference:'ORG-DEPART-CHAIN'});
  const caseId=h.c.id;
  for(const techId of ['zhou','chen']) {
    h.run(store,'booking.assign',{id:old.id,techId,reason:'原客户确认连续协调'});
    h.run(user,'booking.change-answer',{id:old.id,changeId:h.s.bookings.find(b=>b.id===old.id).change.id,decision:'accept'});
  }
  let view=lifecycleCaseImpact(h.s,caseId,{goodsSummary});const coordinated=view.bookings.find(x=>x.resolvedForSubject);
  assert.equal(coordinated.changeIds.length,2);assert.equal(h.s.bookings.find(b=>b.id===old.id).techId,'chen');
  const broken=structuredClone(h.s);broken.bookings.find(b=>b.id===old.id).changeHistory.shift();
  view=lifecycleCaseImpact(broken,caseId,{goodsSummary});assert.ok(view.blockers.some(x=>x.kind==='lifecycle-case-source'));
});

test('原时钟按指定生效点迁店，旧已接单仍按原资格、收款与提成完成',()=>{
  const h=harness();h.book();const old=h.confirm(),original=structuredClone(old),fromQualification=structuredClone(h.q);const c=h.plan();
  const pure=structuredClone(h.s);lifecycleCasesView(h.s,ops,{techId:h.t.id});h.impact();assert.deepEqual(h.s,pure);assert.equal(h.t.storeId,'xingfu');
  h.advance(20);assert.equal(h.t.storeId,'silver');assert.equal(h.c.stage,'effective');assert.equal(h.c.effectiveAt,c.effectiveAt);assert.equal(h.c.appliedAt,h.s.now);const continuation=h.c.assignmentContinuations.find(x=>x.facts.bookingId===old.id);assert.ok(continuation);assert.equal(continuation.facts.incomeSnapshotId,original.techIncomeSnapshot.id);assert.equal(continuation.qualification.grantId,fromQualification.grants.at(-1).id);
  assert.deepEqual(h.s.techQualifications.find(q=>q.id===fromQualification.id),fromQualification);assert.equal(qualificationEligibility(h.s,h.t.id,'neck').allowed,false);
  assert.throws(()=>h.book({storeId:'silver',startAt:original.startAt+2*HOUR}),/独立服务授权/);
  const current=()=>h.s.bookings.find(x=>x.id===old.id);assert.deepEqual(current().payment,original.payment);assert.deepEqual(current().techIncomeSnapshot,original.techIncomeSnapshot);assert.equal(current().storeId,'xingfu');
  h.advance((old.startAt-h.s.now)/MIN);h.run({role:'tech',techId:old.techId},'booking.start',{id:old.id});h.advance(45);h.run({role:'tech',techId:old.techId},'booking.finish',{id:old.id,mode:'normal'});
  assert.equal(current().status,'done');assert.equal(current().payment.amountCents,19800);assert.equal(current().payment.refundedCents,0);assert.deepEqual(current().techIncomeSnapshot,original.techIncomeSnapshot);
});

test('新店实际重新考核批准后可约，跨旧新门店同人占用仍拒绝冲突',()=>{
  const h=harness();h.book();const old=h.confirm();h.plan();h.advance(10);h.authorize('silver');
  assert.equal(qualificationEligibility(h.s,h.t.id,'neck').allowed,true);const before=structuredClone(h.s);
  assert.throws(()=>h.book({storeId:'silver',startAt:old.startAt},{role:'user',userId:'u2'}),/预约|锁定/);assert.deepEqual(h.s,before);
  h.book({storeId:'silver',startAt:old.startAt+2*HOUR},{role:'user',userId:'u2'});const next=h.confirm();assert.equal(next.storeId,'silver');assert.equal(next.techIncomeSnapshot.storeId,'silver');assert.equal(h.s.bookings.find(b=>b.id===old.id).storeId,'xingfu');
});

test('未来计划可按原版本来源撤回；同提交重放不再建案，改内容拒绝',()=>{
  const h=harness();const p={requestId:'stable-transfer',techId:h.t.id,version:h.t.version,sourceToken:h.impact().sourceToken,toStoreId:'silver',targetVersion:h.s.stores.find(x=>x.id==='silver').version,effectiveAt:h.s.now+10*MIN,reference:'ORG-STABLE'};
  h.run(ops,'lifecycle.transfer-plan',p);h.run(ops,'lifecycle.transfer-plan',p);assert.equal(h.s.organizationLifecycleCases.length,1);assert.throws(()=>h.run(ops,'lifecycle.transfer-plan',{...p,toStoreId:'yuan'}),/同一提交标识/);
  h.run(ops,'lifecycle.cancel-plan',{id:h.c.id,version:h.c.version,sourceToken:h.impact().sourceToken});h.advance(20);assert.equal(h.c.stage,'cancelled');assert.equal(h.t.storeId,'xingfu');
});

test('当前影响或目标版本变化拒绝旧计划，其他岗位不能计划调店',()=>{
  const h=harness(),token=h.impact().sourceToken;h.book();const before=structuredClone(h.s);
  assert.throws(()=>h.plan({sourceToken:token}),/影响事项已变化/);assert.deepEqual(h.s,before);
  assert.throws(()=>h.plan({targetVersion:0}),/原资料已更新/);
  for(const a of [user,store,{role:'tech',techId:h.t.id},{role:'group',job:'finance'},{role:'group',job:'support'}]) assert.throws(()=>h.run(a,'lifecycle.transfer-plan',{techId:h.t.id,version:h.t.version,sourceToken:h.impact().sourceToken}),/岗位|身份|无权/);
});

test('到期原计划受阻保留旧事实与实际时钟，原用户取消退款仍可办理',()=>{
  const h=harness();h.book();const old=h.confirm();h.plan();const target=h.s.stores.find(s=>s.id==='silver');
  h.run(ops,'lifecycle.store-close-start',{storeId:target.id,version:target.version,sourceToken:h.impact({storeId:target.id}).sourceToken,reference:'ORG-CLOSE-TARGET'});
  const payment=structuredClone(h.s.bookings.find(b=>b.id===old.id).payment),now=h.s.now;h.advance(20);
  const transfer=h.s.organizationLifecycleCases.find(c=>c.kind==='transfer');assert.equal(transfer.stage,'planned');assert.match(transfer.effectBlockedReason,/目标门店/);assert.equal(h.s.now,now+20*MIN);assert.equal(h.t.storeId,'xingfu');assert.deepEqual(h.s.bookings.find(b=>b.id===old.id).payment,payment);
  h.run(user,'booking.cancel',{id:old.id,reason:'原用户按原规则取消'});const b=h.s.bookings.find(b=>b.id===old.id);assert.equal(b.status,'cancelled');assert.equal(b.refunds.at(-1).amountCents,19800);
  h.run(ops,'lifecycle.cancel-plan',{id:transfer.id,version:transfer.version,sourceToken:h.impact().sourceToken});assert.equal(h.s.organizationLifecycleCases.find(c=>c.id===transfer.id).stage,'cancelled');
});

test('关停只停止新来源；原已接服务继续，普通营业入口不能重开',()=>{
  const h=harness();h.book();const old=h.confirm(),payment=structuredClone(old.payment),income=structuredClone(old.techIncomeSnapshot),subject=h.s.stores.find(x=>x.id==='xingfu');
  h.run(ops,'lifecycle.store-close-start',{storeId:subject.id,version:subject.version,sourceToken:h.impact({storeId:subject.id}).sourceToken,reference:'ORG-CLOSE'});
  const current=h.s.stores.find(x=>x.id==='xingfu');assert.equal(current.lifecycleStatus,'closing');assert.equal(current.promotionDisabled,true);assert.equal(current.active,true);
  assert.throws(()=>h.book(),/关停|关闭|营业|不可用|暂不支持/);assert.throws(()=>h.run(user,'promotion.enter',{storeId:current.id}),/推广/);assert.throws(()=>h.run(ops,'manage.store-status',{id:current.id,version:current.version,status:'open'}),/关停|关闭/);
  h.advance((old.startAt-h.s.now)/MIN);h.run({role:'tech',techId:old.techId},'booking.start',{id:old.id});h.advance(45);h.run({role:'tech',techId:old.techId},'booking.finish',{id:old.id,mode:'normal'});
  const b=h.s.bookings.find(x=>x.id===old.id);assert.equal(b.status,'done');assert.deepEqual(b.payment,payment);assert.deepEqual(b.techIncomeSnapshot,income);assert.equal(h.c.stage,'effective');
});

test('离职开始不把服务中原单退回派单，停止新接单且保留原资金',()=>{
  const h=harness();h.book();const old=h.confirm();h.advance((old.startAt-h.s.now)/MIN);h.run({role:'tech',techId:old.techId},'booking.start',{id:old.id});const before=structuredClone(h.s.bookings.find(x=>x.id===old.id));
  h.run(ops,'lifecycle.departure-start',{techId:h.t.id,version:h.t.version,sourceToken:h.impact().sourceToken,reference:'ORG-DEPARTURE'});assert.equal(h.t.lifecycleStatus,'departure');assert.deepEqual(h.s.bookings.find(x=>x.id===old.id),before);
  assert.throws(()=>h.book({startAt:old.startAt+4*HOUR}),/离职|接单|不可用/);h.advance(45);h.run({role:'tech',techId:old.techId},'booking.finish',{id:old.id,mode:'normal'});assert.equal(h.s.bookings.find(x=>x.id===old.id).status,'done');
});

test('生效后重复同步不重复变更、停用或写事件，也不能撤回',()=>{
  const h=harness();h.book();h.confirm();h.plan();h.advance(10);const snapshot=structuredClone(h.s);syncLifecycle(h.s);syncLifecycle(h.s);assert.deepEqual(h.s,snapshot);
  assert.throws(()=>h.run(ops,'lifecycle.cancel-plan',{id:h.c.id,version:h.c.version,sourceToken:h.impact().sourceToken}),/已经生效/);
});

test('明确本人映射须当前账号管理员来源，旧资金身份不重建且不能静默重绑',()=>{
  const h=harness(),p={techId:h.t.id,version:h.t.version,userId:'u2',reference:'ORG-PERSON-VERIFIED',occurredAt:h.s.now};
  assert.throws(()=>h.run(ops,'lifecycle.identity-link',p),/岗位|账号管理员/);assert.throws(()=>h.run({role:'group',job:'account-admin'},'lifecycle.identity-link',p),/岗位|身份/);
  let entered;h.run({role:'group'},'account.enter',{accountId:'DEMO-ADMIN',grantId:'DEMO-ADMIN-GRANT'});entered=h.s.staffSessions.at(-1);const admin={sessionId:entered.id,accountId:entered.accountId};const money=structuredClone(h.s.serviceCommissions);
  h.run(admin,'lifecycle.identity-link',p);assert.equal(h.t.userId,'u2');assert.equal(h.s.organizationIdentityLinks.length,1);assert.deepEqual(h.s.serviceCommissions,money);
  assert.throws(()=>h.run(admin,'lifecycle.identity-link',{...p,version:h.t.version,userId:'u1'}),/重绑|冲突/);
  const grants=h.s.staffAccounts.find(x=>x.id==='DEMO-ADMIN');h.run(admin,'account.create',{name:'第二演示管理员'});assert.ok(grants);h.run(admin,'account.leave');assert.throws(()=>h.run(admin,'lifecycle.identity-link',{...p,version:h.t.version}),/失效/);
});
