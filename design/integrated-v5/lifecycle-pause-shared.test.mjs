import test from 'node:test';
import assert from 'node:assert/strict';
import {seed,reduce,createLifecycleContext,money,goodsSummary} from './engine.mjs';
import {bookingOptions,bookingSlots,bookingView} from './booking.mjs';
import {lifecyclePauseImpact,lifecyclePauseView,lifecyclePauseSelection,lifecyclePauseEligibility} from './organization-lifecycle-pause.mjs';
import {storeOpeningReadiness} from './management.mjs';
import {technicianAssignmentEligibility} from './organization-assignment.mjs';
import {qualificationEligibility} from './tech-qualification.mjs';
import {customerView} from './customer.mjs';
import {staffView} from './staff.mjs';
import {resolveAccountActor} from './staff-accounts.mjs';
import {createBookingDraft,patchBookingDraft,bookingDraftPayload,repeatBookingDraft} from './booking-draft.mjs';

const MIN=60000,HOUR=60*MIN,DAY=24*HOUR;
const user={role:'user',userId:'u1'},tech={role:'tech',techId:'lin'},ops={role:'group',job:'operations'},store={role:'store',storeId:'xingfu'},finance={role:'group',job:'finance'};
const at=value=>Date.parse(value+'+08:00');
const selection={storeId:'xingfu',serviceId:'neck',regionId:'home',mode:'specified',techId:'lin',genderPreference:'any'};

function harness(){
  let state=reduce(seed(),user,'clock.advance',{minutes:1}),seq=0;
  // Synthetic original opening evidence only; no successful lifecycle/booking
  // facts are invented. Every operation below uses the real reduce transaction.
  Object.assign(state.stores.find(s=>s.id==='xingfu'),{contact:'合成原店负责人',phone:'13800004441',qualification:'PAUSE-ORIGINAL-STORE-CERT',merchantNo:'PAUSE-ORIGINAL-MERCHANT'});
  Object.assign(state.techs.find(t=>t.id==='lin'),{certificate:'PAUSE-ORIGINAL-TECH-CERT',insurance:'PAUSE-ORIGINAL-TECH-INSURANCE',validUntil:'2027-12-31'});
  const h={get s(){return state;},get store(){return state.stores.find(s=>s.id==='xingfu');},get c(){return state.organizationLifecycleCases.at(-1);},
    run(actor,type,p={}){let result;state=reduce(state,actor,type,{requestId:'pause-shared-'+ ++seq,reason:'合成原停业实际验证',...p},r=>result=r);return result;},
    advanceTo(now){assert.ok(now>=state.now);h.run(user,'clock.advance',{minutes:(now-state.now)/MIN});},
    impact(){return lifecyclePauseImpact(state,'xingfu',{startAt:state.now,endAt:null},createLifecycleContext());},
    pause(extra={},actor=ops,type='lifecycle.store-pause-emergency'){return h.run(actor,type,{storeId:'xingfu',version:h.store.version,sourceToken:h.impact().sourceToken,reference:'PAUSE-ACTUAL-REFERENCE',...extra});},
    book(extra={},actor=user){h.run(actor,'booking.create',{...selection,startAt:at('2026-10-02T13:00'),contactName:'合成原预约人',phone:'13800004442',healthConsent:true,identityVerified:true,adultConfirmed:true,...extra});return state.bookings.at(-1);},
    confirm(b){h.run({role:'user',userId:b.userId},'booking.pay',{id:b.id,outcome:'success'});h.run({role:'tech',techId:b.techId},'booking.accept',{id:b.id});return state.bookings.find(x=>x.id===b.id);},
    booking(id){return state.bookings.find(b=>b.id===id);},
    account(job,storeId){
      let admin=state.staffSessions.find(x=>x.accountId==='DEMO-ADMIN'&&x.status==='active');
      if(!admin)admin=h.run(user,'account.enter',{accountId:'DEMO-ADMIN',grantId:'DEMO-ADMIN-GRANT'});
      admin=resolveAccountActor(state,admin);
      let account=h.run(admin,'account.create',{name:'停业共享实际'+job});
      account=h.run(admin,'account.employment',{id:account.id,version:account.version,employmentStatus:'active',reference:'PAUSE-EMPLOYMENT-'+job,verifiedAt:state.now});
      account=h.run(admin,'account.grant',{id:account.id,version:account.version,job,...(storeId?{storeId}:{})});
      const session=h.run(user,'account.enter',{accountId:account.id,grantId:account.grants.at(-1).id});
      return {actor:resolveAccountActor(state,session),admin};
    },
  };
  assert.equal(storeOpeningReadiness(state,h.store).ready,true);
  return h;
}

test('当前有限暂停：未选时步骤可达，原active=false，结束后可见可约时段必须实际reduce下单',()=>{
  const h=harness(),endAt=at('2026-10-02T13:00');h.pause({endAt});
  assert.equal(h.store.active,false);assert.equal(h.c.stage,'effective');
  const before=structuredClone(h.s),noTime=bookingOptions(h.s,selection);
  assert.equal(noTime.valid,true,noTime.error);assert.equal(noTime.selectedTechId,'lin');
  const row=noTime.stores.find(x=>x.id==='xingfu');assert.equal(row.active,false);assert.equal(row.bookable,true);assert.equal(row.resumeAt,endAt);
  const slots=bookingSlots(h.s,selection,'2026-10-02');assert.equal(slots.find(x=>x.time==='13:00').available,true);assert.equal(slots.find(x=>x.time==='11:00').available,false);
  assert.deepEqual(h.s,before);
  const booking=h.book({startAt:endAt});assert.equal(booking.status,'unpaid');assert.equal(booking.startAt,endAt);assert.equal(h.store.active,false);
});

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const decode=value=>value.replace(/&quot;|&#39;|&lt;|&gt;|&amp;/g,e=>({'&quot;':'"','&#39;':"'",'&lt;':'<','&gt;':'>','&amp;':'&'}[e]));
function ui(bookingDraft,query=''){
  return {esc,money,goodsSummary,bookingDraft,query:new URLSearchParams(query),date:v=>v?new Date(v+8*HOUR).toISOString().slice(0,16):'—',
    link:(label,path,cls='')=>`<a href="#${esc(path)}" class="${esc(cls)}">${label}</a>`,
    button:(label,command,payload={},cls='')=>`<button type="button" class="${esc(cls)}" data-command="${esc(command)}" data-payload="${esc(JSON.stringify(payload))}">${esc(label)}</button>`,
    field:(label,name,value='',type='text',attrs='')=>`<label><span>${esc(label)}</span><input name="${esc(name)}" value="${esc(value)}" type="${esc(type)}" ${attrs}></label>`,
    select:(label,name,options,value)=>`<label><span>${esc(label)}</span><select name="${esc(name)}">${options.map(x=>`<option value="${esc(x.value)}" ${String(value)===String(x.value)?'selected':''}>${esc(x.label)}</option>`).join('')}</select></label>`,
    tag:label=>`<span>${esc(label)}</span>`,empty:(label,detail='')=>`<section><h2>${esc(label)}</h2><p>${esc(detail)}</p></section>`};
}
function payloads(html,command){
  return [...html.matchAll(/<(?:form|button)\b[^>]*>/g)].flatMap(([tag])=>{
    const attrs=Object.fromEntries([...tag.matchAll(/([\w-]+)=("[^"]*"|'[^']*')/g)].map(([,k,v])=>[k,decode(v.slice(1,-1))]));
    return attrs['data-command']===command?[JSON.parse(attrs['data-payload']||'{}')]:[];
  });
}
const customer=(h,page,draft)=>customerView(h.s,user,['booking',page],ui(draft));
const originalBusiness=s=>structuredClone({bookings:s.bookings,techs:s.techs,qualifications:s.techQualifications,goods:s.goods,income:s.techIncomeEntries,payouts:s.techIncomePayouts,finance:s.serviceFinanceEntries,commissions:s.serviceCommissions,promotionWithdrawals:s.servicePromotionWithdrawals});

test('当前暂停原UI从门店→项目→技师→选时→确认模型，原载荷走实际create/pay/accept',()=>{
  const h=harness(),endAt=at('2026-10-02T13:00');h.pause({endAt});const snapshot=structuredClone(h.s);
  let draft={...createBookingDraft(h.s,'u1','pause-ui-create'),...selection,startAt:null};
  const stores=customer(h,'stores',draft),choose=payloads(stores,'ui.booking').find(p=>p.patch.storeId==='xingfu');assert.ok(choose);assert.match(stores,/当前暂停，可查看/);
  draft=patchBookingDraft(h.s,draft,choose.patch);assert.equal(draft.startAt,null);
  for(const page of ['store','service','tech']){const html=customer(h,page,draft);assert.doesNotMatch(html,/请先选择可约门店|当前条件下暂无可约技师/);assert.match(html,page==='tech'?/可查看预约时间/:/肩颈/);}
  const slots=customer(h,'slots',draft),time=payloads(slots,'ui.booking').find(p=>p.patch.startAt===endAt);assert.ok(time,'必须从真实slot按钮得到结束后的时间');
  assert.ok(payloads(slots,'ui.booking').filter(p=>p.patch.startAt).every(p=>p.patch.startAt>=endAt));
  draft=patchBookingDraft(h.s,draft,time.patch);
  draft=patchBookingDraft(h.s,draft,{contactName:'合成原UI本人',phone:'13800004443',recipientId:'visit'});
  draft=patchBookingDraft(h.s,draft,{recipientKind:'self',recipientName:'合成原UI本人'});
  draft=patchBookingDraft(h.s,draft,{recipientConfirmed:true,adultConfirmed:true,healthConsent:true,identityConsent:true,identityVerified:true});
  const confirmation=customer(h,'confirm',draft),button=payloads(confirmation,'ui.booking-submit')[0];assert.ok(button);assert.equal(button.expectedTechId,'lin');assert.equal(button.expectedPriceCents,19800);assert.deepEqual(h.s,snapshot);
  const payload=bookingDraftPayload(draft);assert.equal(payload.techId,button.expectedTechId);assert.equal(payload.startAt,endAt);
  h.run(user,'booking.create',payload);const b=h.s.bookings.at(-1);assert.equal(b.startAt,endAt);assert.equal(b.priceCents,button.expectedPriceCents);assert.equal(h.store.active,false);
  h.confirm(b);assert.equal(h.booking(b.id).status,'confirmed');assert.match(customerView(h.s,user,['booking',b.id],ui()),/预约已确认|已确认/);
});

test('未来计划不提前停店，完整时长跨入暂停拒绝；结束/起点相邻保留原时段算法',()=>{
  const h=harness(),startAt=at('2026-10-03T15:00'),endAt=at('2026-10-03T16:00'),before=originalBusiness(h.s);
  h.pause({startAt,endAt},store,'lifecycle.store-pause');assert.equal(h.c.stage,'planned');assert.equal(h.store.active,true);assert.deepEqual(originalBusiness(h.s),before);
  assert.equal(bookingOptions(h.s,selection).valid,true);
  const query=(time,serviceId='neck')=>bookingOptions(h.s,{...selection,serviceId,startAt:at('2026-10-03T'+time)});
  assert.equal(query('14:00','relax').valid,true);assert.equal(query('14:30').valid,false);assert.match(query('14:30').error,/停业|重叠/);assert.equal(query('16:00').valid,true);
  assert.throws(()=>h.book({startAt:at('2026-10-03T14:30')}),/停业|重叠/);
  const b=h.book({startAt:at('2026-10-03T14:00'),serviceId:'relax'});assert.equal(b.duration,60);h.confirm(b);
  const future=h.book({startAt:endAt});h.confirm(future);
  h.advanceTo(at('2026-10-03T14:00'));h.run(tech,'booking.start',{id:b.id});const started=originalBusiness(h.s);
  h.advanceTo(startAt);assert.equal(h.store.active,false);assert.equal(h.c.stage,'effective');assert.equal(h.booking(b.id).status,'active');assert.equal(h.booking(future.id).status,'confirmed');
  assert.deepEqual(h.s.techs,started.techs);assert.deepEqual(h.s.techQualifications,started.qualifications);assert.deepEqual(h.s.serviceCommissions,started.commissions);
  h.run(tech,'booking.finish',{id:b.id,mode:'normal'});assert.equal(h.booking(b.id).status,'done');
  h.advanceTo(endAt);assert.equal(h.store.active,true);assert.equal(h.c.stage,'completed');h.run(tech,'booking.start',{id:future.id});assert.equal(h.booking(future.id).status,'active');
});

test('原已接未开始的暂停内安排须真实改约+本人接受，拒绝保留原单再走门店原因全退',()=>{
  for(const decision of ['accept','reject']){
    const h=harness(),b=h.confirm(h.book()),before=originalBusiness(h.s);h.pause({endAt:at('2026-10-02T14:00')});
    assert.deepEqual(originalBusiness(h.s),before);assert.equal(h.booking(b.id).status,'confirmed');
    const impact=lifecyclePauseView(h.s,h.c.id,createLifecycleContext()).impact;assert.ok(impact.blockers.some(x=>x.sourceId===b.id&&x.stage==='not-started'));
    h.advanceTo(b.startAt);assert.throws(()=>h.run(tech,'booking.start',{id:b.id}),/停业|重叠/);assert.equal(h.booking(b.id).startedAt,null);
    const html=staffView(h.s,store,['bookings',b.id,'reschedule'],ui(undefined,'startAt=2026-10-02T16%3A00'));
    const proposal=payloads(html,'booking.propose-reschedule')[0];assert.ok(proposal,'原门店页面必须提供可核本人改约载荷');
    h.run(store,'booking.propose-reschedule',{...proposal,startAt:at('2026-10-02T16:00'),techId:'lin',reason:'原停业结束后安排同价时段'});
    assert.equal(h.booking(b.id).startAt,b.startAt);assert.equal(h.booking(b.id).change.status,'pending');
    const userHtml=customerView(h.s,user,['booking',b.id],ui()),answer=payloads(userHtml,'booking.change-answer').find(x=>x.decision===decision);assert.ok(answer);h.run(user,'booking.change-answer',answer);
    if(decision==='accept'){assert.equal(h.booking(b.id).startAt,at('2026-10-02T16:00'));assert.equal(h.booking(b.id).status,'waiting');h.run(tech,'booking.accept',{id:b.id});assert.equal(h.booking(b.id).status,'confirmed');assert.equal(h.booking(b.id).refunds.length,0);}
    else{assert.equal(h.booking(b.id).startAt,b.startAt);assert.equal(h.booking(b.id).status,'confirmed');h.run(store,'booking.cancel',{id:b.id,reason:'停业无法协调，原门店原因取消全额退款'});const cancelled=h.booking(b.id),r=cancelled.refunds.at(-1);assert.equal(cancelled.status,'cancelled');assert.equal(r.status,'approved');assert.equal(r.requests[0].amountCents,cancelled.payment.amountCents);assert.equal(cancelled.payment.refundedCents,0);h.run(finance,'booking.refund-pay',{id:b.id,refundId:r.id,outcome:'success'});assert.equal(h.booking(b.id).payment.refundedCents,h.booking(b.id).payment.amountCents);assert.equal(h.booking(b.id).refunds.at(-1).status,'success');assert.equal(bookingView(h.s,user).find(x=>x.id===b.id).fundStatus,'全额退款');}
  }
});

test('紧急暂停保留已开始原服务和原加时跨度，伪bookingId不能给新来源或他人授权',()=>{
  const h=harness(),b=h.confirm(h.book());h.advanceTo(b.startAt);h.run(tech,'booking.start',{id:b.id});h.run(tech,'booking.extension-create',{id:b.id,requestId:'pause-existing-extension'});const extension=h.booking(b.id).extensions.at(-1);h.run(user,'booking.extension-pay',{id:b.id,extensionId:extension.id,outcome:'success'});
  const before=originalBusiness(h.s),caseRow=h.pause({endAt:at('2026-10-02T16:00')});assert.deepEqual(originalBusiness(h.s),before);assert.equal(h.booking(b.id).status,'active');
  const impact=lifecyclePauseView(h.s,caseRow.id,createLifecycleContext()).impact,affected=impact.bookings.find(x=>x.sourceId===b.id);assert.equal(affected.stage,'fulfilling');assert.equal(affected.endAt,b.startAt+75*MIN);
  const exact=technicianAssignmentEligibility(h.s,'lin','xingfu',h.s.now,b.id,'neck',{endAt:h.s.now+75*MIN});assert.equal(exact.allowed,true,exact.reason);assert.equal(exact.continuation,true);
  assert.equal(technicianAssignmentEligibility(h.s,'zhou','xingfu',h.s.now,b.id,'neck',{endAt:h.s.now+45*MIN}).allowed,false);
  assert.equal(lifecyclePauseEligibility(h.s,'xingfu',{startAt:at('2026-10-02T15:00'),endAt:at('2026-10-02T15:45'),bookingId:b.id},createLifecycleContext()).continuationCandidate,false);
  assert.throws(()=>h.book({startAt:at('2026-10-02T15:30'),bookingId:b.id,continuing:true}),/停业|重叠/);
  h.advanceTo(b.startAt+75*MIN);h.run(tech,'booking.finish',{id:b.id,mode:'normal'});assert.equal(h.booking(b.id).status,'done');assert.equal(h.booking(b.id).extensions.at(-1).amountCents,extension.amountCents);assert.equal(h.booking(b.id).payment.refundedCents,0);
});

test('真实门店/集团工作账号沿原岗位核验，紧急和恢复不能由门店、财务或他人办理',()=>{
  const h=harness(),manager=h.account('store-manager','xingfu'),operator=h.account('operations'),other=h.account('store-manager','silver'),financial=h.account('finance'),support=h.account('support');
  const startAt=at('2026-10-03T15:00'),endAt=at('2026-10-03T16:00'),p={storeId:'xingfu',version:h.store.version,sourceToken:h.impact().sourceToken,startAt,endAt,reference:'PAUSE-ACCOUNT-SOURCE',reason:'原岗位明确计划'};
  const before=structuredClone(h.s);for(const actor of [user,tech,other.actor,financial.actor,support.actor])assert.throws(()=>h.run(actor,'lifecycle.store-pause',p),/无权|岗位|门店/);assert.deepEqual(h.s,before);
  const current=staffView(h.s,manager.actor,['stores','xingfu'],ui());assert.equal(payloads(current,'lifecycle.store-pause').length,1);assert.equal(payloads(current,'lifecycle.store-pause-emergency').length,0);assert.equal(payloads(current,'lifecycle.store-close-start').length,0);
  for(const actor of [manager.actor,other.actor,financial.actor,support.actor])assert.throws(()=>h.run(actor,'lifecycle.store-pause-emergency',{...p,endAt:at('2026-10-02T13:00')}),/无权|岗位|集团/);
  const planned=h.run(manager.actor,'lifecycle.store-pause',p);assert.equal(planned.createdBy.accountId,manager.actor.accountId);
  const account=h.s.staffAccounts.find(a=>a.id===manager.actor.accountId);h.run(manager.admin,'account.revoke',{id:account.id,version:account.version,grantId:manager.actor.grantId,reason:'原管理员撤回当前门店计划权限'});
  assert.throws(()=>h.run(manager.actor,'lifecycle.store-pause-cancel',{id:h.c.id,version:h.c.version,sourceToken:h.impact().sourceToken}),/失效|无权/);
  h.run(operator.actor,'lifecycle.store-pause-cancel',{id:h.c.id,version:h.c.version,sourceToken:h.impact().sourceToken});assert.equal(h.c.stage,'cancelled');
  h.pause({endAt:at('2026-10-02T13:00')},operator.actor);for(const actor of [other.actor,financial.actor,support.actor])assert.throws(()=>h.run(actor,'lifecycle.store-resume',{id:h.c.id,version:h.c.version,sourceToken:h.impact().sourceToken,reference:'CANNOT-RESUME'}),/无权|岗位|集团/);
  const resume=lifecyclePauseView(h.s,h.c.id,createLifecycleContext());h.run(operator.actor,'lifecycle.store-resume',{id:h.c.id,version:resume.version,sourceToken:resume.sourceToken,reference:'ACTUAL-OPS-RESUME'});assert.equal(h.store.active,true);
});

test('有限结束恢复仍核实际营业源，未定结束和原最大排期不虚填可约；手动open不能绕过',()=>{
  const h=harness(),endAt=at('2026-10-02T13:00');h.pause({endAt});const before=structuredClone(h.s);
  for(const status of ['open','pause'])assert.throws(()=>h.run(ops,'manage.store-status',{id:'xingfu',version:h.store.version,status}),/原停业案|恢复入口|时段/);assert.deepEqual(h.s,before);
  h.s.techs.find(t=>t.id==='lin').certificate='';const broken=structuredClone(h.s);
  assert.equal(lifecyclePauseSelection(h.s,'xingfu',createLifecycleContext()).bookable,false);assert.equal(bookingOptions(h.s,selection).valid,false);assert.doesNotMatch(customer(h,'stores',selection),/data-payload="[^"]*xingfu/);assert.deepEqual(h.s,broken);
  h.advanceTo(endAt);assert.equal(h.store.active,false);assert.equal(h.c.stage,'effective');assert.match(h.c.effectBlockedReason,/营业条件|证书|技师/);
  const view=lifecyclePauseView(h.s,h.c.id,createLifecycleContext());assert.equal(view.canResume,false);const failed=structuredClone(h.s);assert.throws(()=>h.run(ops,'lifecycle.store-resume',{id:h.c.id,version:view.version,sourceToken:view.sourceToken,reference:'未齐不能恢复'}),/营业条件|证书|技师/);assert.deepEqual(h.s,failed);
  h.s.techs.find(t=>t.id==='lin').certificate='PAUSE-ORIGINAL-TECH-CERT';h.run(user,'clock.advance',{minutes:1});assert.equal(h.store.active,true);assert.equal(h.c.stage,'completed');
  const indefinite=harness();indefinite.pause({endAt:''});assert.equal(indefinite.c.endAt,null);assert.equal(lifecyclePauseSelection(indefinite.s,'xingfu',createLifecycleContext()).bookable,false);assert.equal(bookingOptions(indefinite.s,selection).valid,false);assert.ok(bookingSlots(indefinite.s,selection,'2026-10-03').every(x=>!x.available));assert.throws(()=>indefinite.book({startAt:at('2026-10-03T13:00')}),/暂不支持|停业|营业/);
  const distant=harness();distant.pause({endAt:distant.s.now+8*DAY});const options=bookingOptions(distant.s,selection);assert.equal(options.stores.find(s=>s.id==='xingfu').bookable,false);assert.equal(options.valid,false);assert.throws(()=>distant.book({startAt:at('2026-10-11T13:00')}),/7 天|首次支付|暂不支持/);
});

test('原草稿片区变化与原再次预约消费bookable，暂停状态仍false且时间/当次确认重新选择',()=>{
  const h=harness(),b=h.confirm(h.book());h.run(user,'booking.cancel',{id:b.id,reason:'原本人先取消后再次选择'});h.pause({endAt:at('2026-10-02T13:00')});
  const before=structuredClone(h.s),base={...createBookingDraft(h.s,'u1','pause-region-new'),...selection,startAt:at('2026-10-02T16:00'),recipientConfirmed:true,adultConfirmed:true,healthConsent:true};
  const moved=patchBookingDraft(h.s,base,{regionId:'silver'});assert.equal(moved.regionId,'silver');assert.equal(moved.storeId,'xingfu');assert.equal(moved.startAt,null);assert.equal(moved.techId,'');assert.equal(bookingOptions(h.s,{...moved,mode:'nearest'}).valid,true);
  const html=customer(h,'tech',moved);assert.match(html,/选择时间|可查看预约时间/);assert.doesNotMatch(html,/请先选择可约门店/);
  const next=patchBookingDraft(h.s,moved,{mode:'specified',techId:'lin'});assert.equal(next.techId,'lin');assert.equal(next.startAt,null);
  const repeated=repeatBookingDraft(h.s,'u1',b.id,'pause-original-repeat');assert.equal(repeated.draft.storeId,'xingfu');assert.equal(repeated.draft.techId,'lin');assert.equal(repeated.next,'/user/booking/slots');assert.equal(repeated.draft.startAt,null);assert.equal(repeated.draft.recipientConfirmed,false);assert.equal(repeated.draft.healthConsent,false);assert.equal(h.store.active,false);assert.deepEqual(h.s,before);
  const ordinary=harness();ordinary.run(ops,'manage.store-status',{id:'xingfu',version:ordinary.store.version,status:'pause'});assert.equal(ordinary.store.active,false);assert.equal(bookingOptions(ordinary.s,selection).valid,false);assert.equal(lifecyclePauseSelection(ordinary.s,'xingfu',createLifecycleContext()).bookable,false);assert.throws(()=>ordinary.book(),/暂不支持|营业/);
});

test('选时后原资格/来源变化仍拒绝，原resume版本/token不能被展示结果替代',()=>{
  const h=harness(),endAt=at('2026-10-03T13:00');h.pause({endAt});h.s.techs.find(t=>t.id==='lin').validUntil='2026-10-02';
  const noTime=bookingOptions(h.s,selection);assert.equal(noTime.valid,true);assert.equal(noTime.stores.find(x=>x.id==='xingfu').bookable,true);
  const chosen=bookingOptions(h.s,{...selection,startAt:endAt});assert.equal(chosen.valid,false);assert.match(chosen.error,/资质.*到期|有效期/);assert.throws(()=>h.book({startAt:endAt}),/资质.*到期|有效期/);
  const f=harness();f.pause({endAt:at('2026-10-02T13:00')});const stale=lifecyclePauseView(f.s,f.c.id,createLifecycleContext());
  f.run(ops,'manage.tech-review',{id:'lin',version:f.s.techs.find(t=>t.id==='lin').version,decision:'pause'});assert.equal(storeOpeningReadiness(f.s,f.store).ready,false);
  const before=structuredClone(f.s);assert.throws(()=>f.run(ops,'lifecycle.store-resume',{id:f.c.id,version:stale.version,sourceToken:stale.sourceToken,reference:'不能用旧展示来源恢复'}),/来源.*变化|资料.*更新|营业条件/);assert.deepEqual(f.s,before);
  assert.equal(bookingOptions(f.s,selection).valid,false);assert.equal(lifecyclePauseView(f.s,f.c.id,createLifecycleContext()).canResume,false);
  f.run(ops,'manage.tech-review',{id:'lin',version:f.s.techs.find(t=>t.id==='lin').version,decision:'approve'});const current=lifecyclePauseView(f.s,f.c.id,createLifecycleContext());assert.equal(current.canResume,true);f.run(ops,'lifecycle.store-resume',{id:f.c.id,version:current.version,sourceToken:current.sourceToken,reference:'实际原资料及在岗恢复后核验'});assert.equal(f.store.active,true);assert.equal(f.c.stage,'completed');
});

test('已结束暂停的主体来源变化后实际ready，fresh原恢复表单必须能一次reduce成功而非预sync版本循环',()=>{
  const h=harness(),endAt=at('2026-10-02T13:00');h.pause({endAt});
  h.run(ops,'manage.tech-review',{id:'lin',version:h.s.techs.find(t=>t.id==='lin').version,decision:'pause'});
  h.advanceTo(endAt);assert.equal(h.store.active,false);assert.equal(h.c.stage,'effective');assert.match(h.c.effectBlockedReason,/营业条件|技师/);
  const originalBasis=structuredClone(h.c.resumeBasis),s=h.store;
  h.run(ops,'manage.store-save',{id:s.id,version:s.version,name:s.name,address:s.address,regionId:s.regionId,lat:s.lat,lng:s.lng,radiusKm:s.radiusKm,bufferMinutes:s.bufferMinutes,serviceIds:s.serviceIds,contact:s.contact,phone:s.phone,qualification:'PAUSE-ACTUAL-REVIEWED-NEW-STORE-CERT',merchantNo:s.merchantNo});
  assert.notDeepEqual(h.c.resumeBasis,{qualification:h.store.qualification,merchantNo:h.store.merchantNo,reviewStatus:h.store.reviewStatus});assert.deepEqual(h.c.resumeBasis,originalBasis);
  h.run(ops,'manage.tech-review',{id:'lin',version:h.s.techs.find(t=>t.id==='lin').version,decision:'approve'});assert.equal(storeOpeningReadiness(h.s,h.store).ready,true);assert.equal(h.store.active,false);
  const view=lifecyclePauseView(h.s,h.c.id,createLifecycleContext());assert.equal(view.canResume,true,view.blockers.map(x=>x.reason).join('；'));
  const html=staffView(h.s,ops,['stores','xingfu'],ui()),form=payloads(html,'lifecycle.store-resume')[0];assert.ok(form);assert.equal(form.version,view.version);assert.equal(form.sourceToken,view.sourceToken);
  const before=structuredClone(h.s),payload={...form,requestId:'pause-ended-subject-resume',reference:'ACTUAL-NEW-SUBJECT-OPS-APPROVAL'};
  assert.throws(()=>h.run(ops,'lifecycle.store-resume',{...payload,requestId:'bad-current-resume-source',sourceToken:'sha256:'+'0'.repeat(64)}),/来源.*变化/);assert.deepEqual(h.s,before);
  assert.throws(()=>h.run(store,'lifecycle.store-resume',payload),/岗位|无权|集团/);assert.deepEqual(h.s,before);
  h.run(ops,'lifecycle.store-resume',payload);assert.equal(h.store.active,true);assert.equal(h.store.reviewStatus,'approved');assert.equal(h.c.stage,'completed');assert.equal(h.c.effectBlockedReason,undefined);
  const completed=structuredClone(h.s);h.run(ops,'lifecycle.store-resume',payload);assert.equal(h.c.version,completed.organizationLifecycleCases.at(-1).version);assert.equal(h.store.version,completed.stores.find(s=>s.id==='xingfu').version);assert.deepEqual({...h.s,revision:completed.revision},completed);
});
