import test from 'node:test';
import assert from 'node:assert/strict';
import { qualificationEligibility, qualificationCaseBlockers } from './tech-qualification.mjs';
import { seed, reduce } from './engine.mjs';
import { bookingOptions, bookingView } from './booking.mjs';
import { applyTechnicianTransfer, technicianAssignmentEligibility } from './organization-assignment.mjs';

const MIN=60000,HOUR=60*MIN;
const group={role:'group',job:'operations'},store={role:'store',storeId:'xingfu'},user={role:'user',userId:'u1'};
function harness({legacy=false}={}) {
  let s=seed(),seq=0,techId='lin';
  const h={get s(){return s;},get tech(){return s.techs.find(t=>t.id===techId);},get actor(){return {role:'tech',techId};},get b(){return s.bookings.at(-1);},
    run(a,type,p={}) {s=reduce(s,a,type,{reason:'C08独立回归来源',requestId:'assignment-'+(++seq),...p});return s;},
    profile(storeId=h.tech.storeId,profileId) {return s.techQualifications.find(r=>r.techId===techId && r.storeId===storeId && (profileId ? r.id===profileId : storeId!==h.tech.storeId || !h.tech.qualificationProfileId || r.id===h.tech.qualificationProfileId));},
    qual(type,p={},a=group) {return h.run(a,'qualification.'+type,{techId,version:h.profile(p.storeId,p.profileId)?.version || 0,...p});},
    authorize(storeId=h.tech.storeId,extra={}) {
      h.qual('assess',{storeId,serviceIds:['relax'],batch:'C08实际考核',assessor:'合成考核人',proof:'C08-ASSESS-'+seq,occurredAt:s.now,result:'pass',kind:'initial',...extra});
      h.qual('request',{storeId,profileId:extra.profileId,assessmentId:h.profile(storeId,extra.profileId).assessments.at(-1).id});
      h.qual('review',{storeId,profileId:extra.profileId,grantId:h.profile(storeId,extra.profileId).grants.at(-1).id,decision:'approve',reviewer:'合成集团审核',proof:'C08-GRANT-'+seq});
    },
    input(extra={}) {return {storeId:h.tech.storeId,serviceId:'relax',regionId:'home',techId,mode:'specified',genderPreference:'any',startAt:Math.ceil((s.now+4*HOUR)/(30*MIN))*30*MIN,contactName:'合成用户',phone:'13800008881',healthConsent:true,identityVerified:true,adultConfirmed:true,...extra};},
    book(extra={},accept=true) {h.run(user,'booking.create',h.input(extra));const id=h.b.id;h.run(user,'booking.pay',{id,outcome:'success'});if(accept)h.run(h.actor,'booking.accept',{id});return s.bookings.find(b=>b.id===id);},
    transfer(extra={}) {
      s=structuredClone(s);s.organizationLifecycleCases ??=[];
      const c={id:'TRANSFER-'+(++seq),kind:'transfer',techId,fromStoreId:h.tech.storeId,toStoreId:'silver',createdAt:s.now,effectiveAt:s.now+MIN,stage:'planned',status:'planned',version:1,createdBy:group,reference:'C08-TRANSFER',reason:'实际演示调店',impactSnapshot:{},...extra};
      s.organizationLifecycleCases.push(c);s.now=Math.max(s.now,c.effectiveAt);
      applyTechnicianTransfer(s,c,{fail:m=>{throw new Error(m);},id:p=>p+(++s.seq)});c.stage='effective';c.status='effective';c.appliedAt=s.now;return c;
    },
    advanceTo(at) {if(at>s.now)h.run(group,'clock.advance',{minutes:(at-s.now)/MIN});},
  };
  if (!legacy) {
    h.run(store,'manage.tech-save',{storeId:'xingfu',name:'C08回归师傅',phone:'13800008880',gender:'male',lat:31.231,lng:121.475,serviceIds:['relax','neck'],certificate:'C08-CERT',insurance:'C08-INSURANCE',validUntil:'2027-12-31'});
    techId=s.techs.at(-1).id;h.run(group,'manage.tech-review',{id:techId,version:h.tech.version,decision:'approve'});h.authorize();
  }
  return h;
}

test('qualification defaults to the current store without replacing the original store grant', () => {
  const s={now:100,techs:[{id:'t',storeId:'new',qualificationRequired:true,serviceIds:['a']}],techQualifications:[
    {id:'old-profile',techId:'t',storeId:'old',holds:[],grants:[{id:'old-grant',serviceIds:['a'],status:'approved',review:{at:1}}]},
    {id:'new-profile',techId:'t',storeId:'new',holds:[],grants:[{id:'new-grant',serviceIds:['a'],status:'approved',review:{at:2}}]}
  ]};
  assert.equal(qualificationEligibility(s,'t','a').allowed,true);
  assert.equal(qualificationEligibility(s,'t','a',100,'old').allowed,true);
  s.techQualifications[0].holds.push({id:'person-hold',status:'open',serviceIds:['a']});
  assert.equal(qualificationEligibility(s,'t','a').allowed,false);
});

test('actual approval is required again at the new store; original accepted service and money stay original',()=>{
  const h=harness(),original=h.book(),oldProfile=structuredClone(h.profile()),finance=structuredClone({payment:original.payment,income:original.techIncomeSnapshot,storeId:original.storeId});
  assert.ok(original.technicianAssignmentSnapshot);const c=h.transfer(),profile=h.profile();
  assert.equal(h.tech.storeId,'silver');assert.equal(h.tech.qualificationRequired,true);assert.equal(c.assignmentContinuations.length,1);assert.equal(c.assignmentContinuations[0].facts.acceptedAt,original.round.completedAt);assert.equal(c.assignmentContinuations[0].recordedAt,h.s.now);
  assert.deepEqual(h.profile('xingfu'),oldProfile);assert.deepEqual(profile.grants,[]);assert.deepEqual(profile.assessments,[]);
  assert.throws(()=>h.book({startAt:original.startAt+3*HOUR}),/独立服务授权/);
  h.qual('assess',{serviceIds:['relax'],batch:'新店实际初训',assessor:'新店合成考核员',proof:'NEW-STORE-ASSESS',occurredAt:h.s.now,result:'pass',kind:'initial'});
  assert.throws(()=>h.book({startAt:original.startAt+3*HOUR}),/独立服务授权/);
  h.qual('request',{assessmentId:h.profile().assessments.at(-1).id});
  assert.throws(()=>h.book({startAt:original.startAt+3*HOUR}),/独立服务授权/);
  h.qual('review',{grantId:h.profile().grants.at(-1).id,decision:'approve',reviewer:'集团实际审核',proof:'NEW-STORE-APPROVAL'});
  const next=h.book({startAt:original.startAt+3*HOUR});assert.equal(next.storeId,'silver');assert.equal(next.technicianAssignmentSnapshot.qualification.profileId,h.profile().id);
  h.advanceTo(original.startAt);h.run(h.actor,'booking.start',{id:original.id});h.advanceTo(original.startAt+original.duration*MIN);h.run(h.actor,'booking.finish',{id:original.id,mode:'normal'});
  const done=h.s.bookings.find(b=>b.id===original.id);assert.equal(done.status,'done');assert.deepEqual({payment:done.payment,income:done.techIncomeSnapshot,storeId:done.storeId},finance);
  assert.equal(bookingView(h.s,user).find(b=>b.id===done.id).technicianAssignmentSnapshot,undefined);
});

test('old unaccepted arrangements and pending proposals must coordinate; reads cannot manufacture continuation',()=>{
  const h=harness(),waiting=h.book({},false),accepted=h.book({startAt:waiting.startAt+3*HOUR});
  h.s.bookings.find(b=>b.id===accepted.id).change={id:'PENDING',status:'pending',techId:h.tech.id,startAt:accepted.startAt+3*HOUR};
  const c=h.transfer();assert.ok(c.assignmentCoordination.some(x=>x.bookingId===waiting.id && x.kind==='original'));assert.ok(c.assignmentCoordination.some(x=>x.changeId==='PENDING'));
  assert.throws(()=>h.run(h.actor,'booking.accept',{id:waiting.id}),/本店|调店/);
  const before=structuredClone(h.s);
  assert.equal(bookingOptions(h.s,{id:accepted.id,techId:h.tech.id,mode:'specified'}).valid,true);
  assert.equal(bookingOptions(h.s,{id:accepted.id,techId:h.tech.id,startAt:accepted.startAt+3*HOUR,mode:'specified'}).valid,false);
  assert.equal(bookingOptions(h.s,{id:accepted.id,techId:h.tech.id,serviceId:'neck',continuing:true,mode:'specified'}).valid,false);
  assert.equal(technicianAssignmentEligibility(h.s,h.tech.id,'xingfu',h.s.now,waiting.id,'relax').allowed,false);
  assert.deepEqual(h.s,before);
});

test('legacy accepted facts need matching actual round, original income and confirmation event without backdating',()=>{
  for (const missing of [null,'round','income','event']) {
    const h=harness({legacy:true}),b=h.book();delete b.technicianAssignmentSnapshot;delete b.technicianAssignmentSnapshots;
    if(missing==='round')b.rounds=[];if(missing==='income')delete b.techIncomeSnapshot;if(missing==='event')b.events=b.events.filter(e=>e.text!=='预约已确认');
    const c=h.transfer();assert.equal(c.assignmentContinuations.length,missing ? 0 : 1);
    assert.equal(technicianAssignmentEligibility(h.s,h.tech.id,'xingfu',b.startAt,b.id,'relax').allowed,!missing);
    assert.equal(b.technicianAssignmentSnapshot,undefined);
    if(!missing)assert.equal(c.assignmentContinuations[0].facts.incomeCapturedAt,b.round.completedAt);
  }
});

test('cross store same person locks and pending arrangement locks remain exact',()=>{
  const h=harness(),old=h.book();h.transfer();h.authorize();
  assert.throws(()=>h.book({startAt:old.startAt}),/预约或锁定/);
  assert.throws(()=>h.book({startAt:old.startAt+90*MIN}),/预约或锁定/);
  const proposalTime=old.startAt+3*HOUR;
  h.s.bookings.push({...structuredClone(old),id:'PROPOSAL-SOURCE',techId:'zhou',startAt:old.startAt+5*HOUR,change:{id:'PROPOSAL',status:'pending',techId:h.tech.id,startAt:proposalTime,expiresAt:h.s.now+15*MIN}});
  assert.throws(()=>h.book({startAt:proposalTime}),/变更申请锁定/);
  h.s.bookings.pop();assert.equal(h.book({startAt:proposalTime}).storeId,'silver');
});

test('original source or immutable original arrangement changes cannot use same booking id to continue',()=>{
  const mutations=[b=>b.startAt+=30*MIN,b=>b.round.completedAt++,b=>b.techIncomeSnapshot.ruleId='FORGED',b=>b.serviceId='neck'];
  for (const mutate of mutations) {const h=harness(),b=h.book();h.transfer();mutate(h.s.bookings.find(x=>x.id===b.id));assert.equal(technicianAssignmentEligibility(h.s,h.tech.id,'xingfu',b.startAt,b.id,'relax').allowed,false);}
  const h=harness(),b=h.book();h.transfer();h.profile('xingfu').grants[0].review.proof='CHANGED';assert.equal(technicianAssignmentEligibility(h.s,h.tech.id,'xingfu',b.startAt,b.id,'relax').allowed,false);
  const forged=harness(),f=forged.book();forged.transfer();forged.s.organizationLifecycleCases[0].reference='CHANGED';assert.equal(technicianAssignmentEligibility(forged.s,forged.tech.id,'xingfu',f.startAt,f.id,'relax').allowed,false);
});

test('person project hold survives transfer and old care restoration uses the original qualification row',()=>{
  const h=harness(),b=h.book();h.transfer();h.authorize();
  h.s.serviceCareCases=[{id:'OLD-CARE',techId:h.tech.id,storeId:'xingfu',bookingId:b.id,version:0,history:[],specialistActions:[{kind:'retraining'}]}];
  h.qual('pause',{storeId:'xingfu',serviceIds:['relax'],owner:'原店复训负责人',caseId:'OLD-CARE',caseVersion:0,actionIndex:0},store);
  const hold=h.profile('xingfu').holds.at(-1),caseRow=h.s.serviceCareCases[0];
  assert.equal(qualificationEligibility(h.s,h.tech.id,'relax').allowed,false);assert.equal(qualificationCaseBlockers(h.s,caseRow).length,1);
  assert.throws(()=>h.book({startAt:b.startAt+3*HOUR}),/资格已暂停/);
  h.advanceTo(b.startAt);assert.throws(()=>h.run(h.actor,'booking.start',{id:b.id,continuing:true}),/资格已暂停/);
  h.run(user,'booking.cancel',{id:b.id,reason:'原暂停预约协调取消'});h.authorize('xingfu',{kind:'retraining',holdId:hold.id});
  h.qual('resume',{storeId:'xingfu',holdId:hold.id,reviewer:'原店集团恢复'});
  assert.deepEqual(qualificationCaseBlockers(h.s,h.s.serviceCareCases[0]),[]);assert.equal(qualificationEligibility(h.s,h.tech.id,'relax').allowed,true);
});

test('expiry never receives the retained booking id exception after transfer',()=>{
  const h=harness(),b=h.book();h.transfer();h.tech.validUntil='2026-10-01';
  assert.equal(technicianAssignmentEligibility(h.s,h.tech.id,'xingfu',b.startAt,b.id,'relax').allowed,false);
  h.advanceTo(b.startAt);assert.throws(()=>h.run(h.actor,'booking.start',{id:b.id,continuing:true}),/资质已到期/);
});

test('transfer checks actual source and destination, is repeat safe, and preserves late effect acceptance time',()=>{
  for (const kind of ['future','foreign','closed','closing','departure','source']) {
    const h=harness();h.book();const original=structuredClone(h.s),c={id:'BAD',kind:'transfer',techId:h.tech.id,fromStoreId:'xingfu',toStoreId:'silver',createdAt:h.s.now,effectiveAt:h.s.now,stage:'planned',status:'planned',version:1,reference:'ACTUAL',reason:'实际来源'};
    h.s.organizationLifecycleCases=[c];if(kind==='future')c.effectiveAt+=MIN;if(kind==='foreign')c.techId='none';if(kind==='closed')h.s.stores[1].closedAt=0;if(kind==='closing')h.s.stores[1].lifecycleStatus='closing';if(kind==='departure')h.tech.lifecycleStatus='departure';if(kind==='source')c.fromStoreId='yuan';
    const before=structuredClone(h.s);assert.throws(()=>applyTechnicianTransfer(h.s,c));assert.deepEqual(h.s,before);assert.equal(h.tech.storeId,original.techs.at(-1).storeId);
  }
  const h=harness(),b=h.book(),acceptedAt=b.round.completedAt;h.s.now+=2*MIN;
  const c=h.transfer({effectiveAt:h.s.now-MIN,createdAt:h.s.now-2*MIN});assert.equal(c.assignmentContinuations[0].facts.acceptedAt,acceptedAt);
  const after=structuredClone(h.s);applyTechnicianTransfer(h.s,c);assert.deepEqual(h.s,after);
  assert.throws(()=>applyTechnicianTransfer(h.s,structuredClone(c)),/记录|来源/);
});

test('closing and departure keep only actual accepted obligations and reject new or fabricated same id work',()=>{
  for (const kind of ['store-close','departure']) {
    const h=harness(),b=h.book(),at=h.s.now;
    h.s.organizationLifecycleCases=[{id:'END',kind,storeId:kind==='store-close'?'xingfu':undefined,techId:kind==='departure'?h.tech.id:undefined,effectiveAt:at,createdAt:at,stage:'effective',status:'effective'}];
    if(kind==='store-close'){const st=h.s.stores.find(x=>x.id==='xingfu');st.lifecycleStatus='closing';st.closingAt=at;st.active=false;}else{h.tech.lifecycleStatus='departure';h.tech.departureStartedAt=at;}
    assert.equal(technicianAssignmentEligibility(h.s,h.tech.id,'xingfu',b.startAt,b.id,'relax').allowed,true);
    assert.throws(()=>h.book({startAt:b.startAt+3*HOUR}));
    const fake={...structuredClone(b),id:'FAKE',round:null};h.s.bookings.push(fake);assert.equal(technicianAssignmentEligibility(h.s,h.tech.id,'xingfu',b.startAt,fake.id,'relax').allowed,false);h.s.bookings.pop();
    h.advanceTo(b.startAt);h.run(h.actor,'booking.start',{id:b.id});h.advanceTo(b.startAt+b.duration*MIN);h.run(h.actor,'booking.finish',{id:b.id,mode:'normal'});assert.equal(h.s.bookings[0].status,'done');
    if(kind==='store-close')h.s.stores[0].lifecycleStatus='closed';else h.tech.lifecycleStatus='left';assert.equal(technicianAssignmentEligibility(h.s,h.tech.id,'xingfu',h.s.now,b.id,'relax').allowed,false);
  }
});

test('third store and returning original store retain original accepted obligations while each current profile stays empty until actual approval',()=>{
  // Explicit effective case fixtures isolate this adapter; lifecycle completion
  // and permission to plan a subsequent case belong to the Root command layer.
  const h=harness(),b=h.book(),originalProfile=structuredClone(h.profile());h.transfer();h.authorize();
  const silverProfile=structuredClone(h.profile());h.transfer({toStoreId:'yuan'});
  assert.equal(technicianAssignmentEligibility(h.s,h.tech.id,'xingfu',b.startAt,b.id,'relax').allowed,true);
  assert.equal(h.profile().storeId,'yuan');assert.deepEqual(h.profile().grants,[]);assert.throws(()=>h.book({startAt:b.startAt+3*HOUR}),/独立服务授权/);
  h.authorize();h.transfer({toStoreId:'xingfu'});
  assert.equal(h.s.techQualifications.filter(r=>r.techId===h.tech.id && r.storeId==='xingfu').length,2);
  assert.notEqual(h.profile().id,originalProfile.id);assert.deepEqual(h.profile().grants,[]);
  assert.equal(qualificationEligibility(h.s,h.tech.id,'relax').allowed,false);
  assert.equal(technicianAssignmentEligibility(h.s,h.tech.id,'xingfu',b.startAt,b.id,'relax').allowed,true);
  assert.throws(()=>h.book({startAt:b.startAt+3*HOUR}),/独立服务授权/);
  assert.deepEqual(h.profile('silver'),silverProfile);
  h.authorize();assert.equal(qualificationEligibility(h.s,h.tech.id,'relax').allowed,true);
  assert.throws(()=>h.book({startAt:b.startAt}),/预约或锁定/);assert.equal(h.book({startAt:b.startAt+3*HOUR}).storeId,'xingfu');
  h.transfer({toStoreId:'silver'});assert.equal(qualificationEligibility(h.s,h.tech.id,'relax').allowed,false);
  assert.equal(technicianAssignmentEligibility(h.s,h.tech.id,'xingfu',b.startAt,b.id,'relax').allowed,true);
  const originalRow=h.s.techQualifications.find(r=>r.id===originalProfile.id);originalRow.grants[0].review.proof='CHANGED-ORIGINAL';
  assert.equal(technicianAssignmentEligibility(h.s,h.tech.id,'xingfu',b.startAt,b.id,'relax').allowed,false);
});

test('returning store old care hold requires explicit original profile for real retraining and never substitutes the new current profile',()=>{
  const h=harness(),b=h.book(),originalProfileId=h.profile().id;h.transfer();h.authorize();h.transfer({toStoreId:'xingfu'});h.authorize();
  h.advanceTo(b.startAt);h.run(h.actor,'booking.start',{id:b.id});h.advanceTo(b.startAt+b.duration*MIN);h.run(h.actor,'booking.finish',{id:b.id,mode:'normal'});
  const currentProfileId=h.profile().id,currentGrantId=h.profile().grants.at(-1).id;
  h.s.serviceCareCases=[{id:'RETURN-OLD-CARE',techId:h.tech.id,storeId:'xingfu',bookingId:b.id,version:0,history:[],specialistActions:[{kind:'retraining'}]}];
  const scope={storeId:'xingfu',profileId:originalProfileId};
  h.qual('pause',{...scope,serviceIds:['relax'],owner:'原授权档复训负责人',caseId:'RETURN-OLD-CARE',caseVersion:0,actionIndex:0},group);
  const holdId=h.profile('xingfu',originalProfileId).holds.at(-1).id;
  assert.equal(qualificationEligibility(h.s,h.tech.id,'relax').allowed,false);assert.equal(qualificationCaseBlockers(h.s,h.s.serviceCareCases[0]).length,1);
  assert.throws(()=>h.qual('resume',{storeId:'xingfu',holdId,reviewer:'错误当前档恢复'}),/暂停记录/);
  const before=structuredClone(h.s.servicePromoters);h.authorize('xingfu',{profileId:originalProfileId,kind:'retraining',holdId});
  h.qual('resume',{...scope,holdId,reviewer:'集团明确原档恢复'});
  assert.deepEqual(qualificationCaseBlockers(h.s,h.s.serviceCareCases[0]),[]);assert.equal(qualificationEligibility(h.s,h.tech.id,'relax').allowed,true);
  assert.equal(h.profile().id,currentProfileId);assert.equal(h.profile().grants.at(-1).id,currentGrantId);assert.deepEqual(h.s.servicePromoters,before);
});

test('late departure facts do not manufacture permission to begin after an original person hold',()=>{
  const h=harness(),b=h.book();h.transfer();h.qual('pause',{storeId:'xingfu',serviceIds:['relax'],owner:'原项目负责人'});
  h.advanceTo(b.startAt);const original=h.s.bookings.find(x=>x.id===b.id);original.departedAt=h.s.now;
  assert.throws(()=>h.run(h.actor,'booking.start',{id:b.id,continuing:true}),/资格已暂停/);
});
