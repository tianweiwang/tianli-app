import test from 'node:test';
import assert from 'node:assert/strict';
import {seed,reduce,upgradeFinanceState} from './engine.mjs';
import {resolveAccountActor,canAccountCommand} from './staff-accounts.mjs';
import {qualityPolicyCommand,qualityPolicySource,qualityPolicyStream,qualityPolicyView} from './quality-policy.mjs';

const clone=value=>structuredClone(value),user={role:'user',userId:'u1'},scope={subject:'tech',domain:'service-order',storeIds:null,serviceIds:null};
// Explicit isolated policy parameters. No values are added to seed or defaults.
const rule=()=>({id:'SHARED-EXPLICIT-TECH',trigger:'tech-noshow',sourceKinds:['verified-fulfilment-responsibility'],counting:null,effect:{kind:'stop-new-service',endMode:'duration',durationMs:456789},restoration:{mode:'retraining-and-release',serviceIds:null},appeal:{limit:1,execution:'continues'}});
function fixture(){
  let s=seed(),seq=0;const f={get s(){return s;},run(actor,type,p={}){let result;const next=reduce(s,actor,type,{requestId:'quality-shared-'+ ++seq,...p},value=>result=value);s=next;return result;},
    staff(job,storeId){const a=this.run(this.admin,'account.create',{name:'原质量政策测试岗位',reason:'隔离真实账号生产者'}),g=this.run(this.admin,'account.grant',{id:a.id,version:a.version,job,...(storeId?{storeId}:{}),reason:'原岗位明确授权'});const entered=this.run(user,'account.enter',{accountId:a.id,grantId:g.grants.at(-1).id});return resolveAccountActor(s,entered);},
    publishPayload(extra={}){const stream=qualityPolicyStream(s,scope);return{scope:clone(scope),rules:[rule()],validFrom:s.now,validTo:null,basis:{reference:'SHARED-ACTUAL-DECISION',version:'isolated-explicit-1',occurredAt:s.now},expectedVersion:stream.version,sourceToken:stream.sourceToken,requestId:'quality-explicit-'+ ++seq,...extra};},
    publish(extra={},actor=this.support){return this.run(actor,'quality.policy-publish',this.publishPayload(extra));},
    withdrawPayload(id,extra={}){const row=qualityPolicyView(s,this.support).policies.find(row=>row.id===id);return{id,version:row.version,revision:row.revision,sourceToken:row.sourceToken,reference:'SHARED-WITHDRAWAL',basisVersion:'isolated-explicit-2',occurredAt:s.now,reason:'原实际撤回决定',requestId:'quality-withdraw-'+ ++seq,...extra};},
    advance(minutes=1){this.run({role:'group',job:'all'},'clock.advance',{minutes});},
    legacyPolicy(){const p=this.publishPayload(),next=clone(s);const result=qualityPolicyCommand(next,this.support,'quality.policy-publish',p,{id:prefix=>prefix+ ++next.seq});delete next.qualityPolicies[0].events;s=next;return result;}
  };
  const entered=f.run(user,'account.enter',{accountId:'DEMO-ADMIN',grantId:'DEMO-ADMIN-GRANT'});f.admin=resolveAccountActor(s,entered);f.support=f.staff('support');return f;
}
function reject(f,action){const before=clone(f.s);assert.throws(action);assert.deepEqual(f.s,before,'失败clone不能提交部分政策/账本');}

test('shared: old schema5 upgrades only empty quality containers; getters/upgrade do not install rules',()=>{
  const previous=seed(),before=clone(previous);assert.equal(qualityPolicySource(previous,{scope}).available,false);assert.deepEqual(previous,before);
  const next=upgradeFinanceState(clone(previous));assert.deepEqual(next.qualityPolicies,[]);assert.deepEqual(next.qualityPolicyRequests,[]);assert.equal(qualityPolicyStream(next,scope).version,0);
  const once=clone(next);upgradeFinanceState(next);assert.deepEqual(next,once);assert.deepEqual(next.bookings,previous.bookings);assert.deepEqual(next.goods,previous.goods);
});

test('shared: real group support enters through original guard, publishes once with original log and callback',()=>{
  const f=fixture();assert.equal(canAccountCommand(f.support,'quality.policy-publish'),true);assert.equal(canAccountCommand(f.support,'quality.policy-withdraw'),true);
  const p=f.publishPayload(),r=f.run(f.support,'quality.policy-publish',p);assert.equal(r.version,1);assert.equal(r.revision,1);
  const row=f.s.qualityPolicies[0];assert.equal(row.publication.by.sessionId,f.support.sessionId);assert.equal(row.publication.by.grantId,f.support.grantId);assert.equal(row.events.length,1);assert.equal(row.events[0].accountId,f.support.accountId);
  assert.equal(qualityPolicySource(f.s,{scope}).available,true);assert.equal(qualityPolicyView(f.s,f.support).policies.length,1);
  const domain=clone({policies:f.s.qualityPolicies,requests:f.s.qualityPolicyRequests,logs:f.s.logs});assert.deepEqual(f.run(f.support,'quality.policy-publish',p),r);assert.deepEqual({policies:f.s.qualityPolicies,requests:f.s.qualityPolicyRequests,logs:f.s.logs},domain);
  reject(f,()=>f.run(f.support,'quality.policy-publish',{...p,basis:{...p.basis,reference:'OTHER'}}));
});

test('shared: exact withdrawal keeps publication/historical token, disables current newest version without revival',()=>{
  const f=fixture(),one=f.publish(),firstAt=f.s.now;f.advance();const two=f.publish(),decidedAt=f.s.now,published=clone(f.s.qualityPolicies[1]);f.advance();
  const p=f.withdrawPayload(two.id),r=f.run(f.support,'quality.policy-withdraw',p);assert.equal(r.revision,2);
  const row=f.s.qualityPolicies[1];assert.deepEqual(row.publication,published.publication);assert.deepEqual(row.rules,published.rules);assert.equal(row.contentFingerprint,published.contentFingerprint);assert.equal(row.events.length,2);
  assert.equal(qualityPolicySource(f.s,{scope}).available,false);assert.equal(qualityPolicySource(f.s,{scope,policyId:one.id,version:one.version}).available,false);
  const historical=qualityPolicySource(f.s,{scope,policyId:two.id,version:two.version,ruleId:rule().id,mode:'historical',at:decidedAt});assert.equal(historical.available,true);assert.equal(historical.sourceToken,published.contentFingerprint);
  assert.equal(qualityPolicySource(f.s,{scope,policyId:one.id,version:one.version,mode:'historical',at:firstAt}).available,true);
  const facts=clone({policies:f.s.qualityPolicies,requests:f.s.qualityPolicyRequests,logs:f.s.logs});assert.deepEqual(f.run(f.support,'quality.policy-withdraw',p),r);assert.deepEqual({policies:f.s.qualityPolicies,requests:f.s.qualityPolicyRequests,logs:f.s.logs},facts);
  reject(f,()=>f.run(f.support,'quality.policy-withdraw',{...p,requestId:'NEW-WITHDRAW'}));
});

test('shared: future/expired latest policy never supplies unknown old rule or revives an earlier publication',()=>{
  const f=fixture(),one=f.publish(),old=f.s.now;f.advance();const from=f.s.now+60000,to=from+60000,two=f.publish({validFrom:from,validTo:to});
  assert.equal(qualityPolicySource(f.s,{scope}).policy.id,one.id);assert.equal(qualityPolicySource(f.s,{scope,at:from}).available,false);
  f.advance();assert.equal(qualityPolicySource(f.s,{scope}).policy.id,two.id);f.advance();assert.equal(qualityPolicySource(f.s,{scope}).available,false);
  assert.equal(qualityPolicySource(f.s,{scope,policyId:one.id,version:1,mode:'historical',at:old}).available,true);
  assert.equal(qualityPolicySource(f.s,{scope,policyId:two.id,version:two.version,mode:'historical',at:from,ruleId:'UNKNOWN'}).available,false);
});

test('shared: original later grant revocation blocks current writes/replay but preserves old valid policy history',()=>{
  const f=fixture(),p=f.publishPayload(),r=f.run(f.support,'quality.policy-publish',p),at=f.s.now;f.advance();
  const account=f.s.staffAccounts.find(row=>row.id===f.support.accountId);f.run(f.admin,'account.revoke',{id:account.id,version:account.version,grantId:f.support.grantId,reason:'结束实际旧岗位'});
  reject(f,()=>f.run(f.support,'quality.policy-publish',p));assert.equal(qualityPolicyView(f.s,f.support).canEnter,false);
  assert.equal(qualityPolicySource(f.s,{scope,policyId:r.id,version:r.version,mode:'historical',at}).available,true);
  f.support=f.staff('support');const withdrawal=f.withdrawPayload(r.id);f.run(f.support,'quality.policy-withdraw',withdrawal);
  assert.equal(qualityPolicySource(f.s,{scope}).available,false);assert.equal(qualityPolicySource(f.s,{scope,policyId:r.id,version:r.version,mode:'historical',at}).available,true);
});

test('shared: free strings, other real jobs, forged/half work identities and unknown commands never publish',()=>{
  const f=fixture(),finance=f.staff('finance'),operations=f.staff('operations'),store=f.staff('store-manager','xingfu');
  for(const actor of [user,{role:'group',job:'support'},{role:'group',job:'all'},finance,operations,store,{...finance,job:'support'},{role:'group',job:'support',accountId:f.support.accountId},{...f.support,sessionId:'missing'}])reject(f,()=>f.run(actor,'quality.policy-publish',f.publishPayload()));
  reject(f,()=>f.run(f.support,'quality.unknown',{}));assert.equal((f.s.qualityPolicies||[]).length,0);
});

test('shared: old completed booking with unknown policy keeps original fulfilment/payment; publishing is not a penalty',()=>{
  const f=fixture(),tech={role:'tech',techId:'lin'};
  f.run(user,'booking.create',{storeId:'xingfu',serviceId:'relax',regionId:'home',techId:'lin',startAt:f.s.now+4*3600000,mode:'specified',genderPreference:'any',contactName:'隔离原顾客',phone:'13800000001',healthConsent:true,identityVerified:true,adultConfirmed:true});const id=f.s.bookings.at(-1).id;
  f.run(user,'booking.pay',{id,outcome:'success'});f.run(tech,'booking.accept',{id});f.advance(240);f.run(tech,'booking.start',{id});f.advance(60);f.run(tech,'booking.finish',{id,mode:'normal'});
  assert.equal(qualityPolicySource(f.s,{scope}).available,false);const facts=clone({bookings:f.s.bookings,goods:f.s.goods,techs:f.s.techs,qualifications:f.s.techQualifications,penalties:f.s.technicianPenalties});f.publish();
  assert.deepEqual({bookings:f.s.bookings,goods:f.s.goods,techs:f.s.techs,qualifications:f.s.techQualifications,penalties:f.s.technicianPenalties},facts);assert.equal(f.s.bookings.at(-1).status,'done');
  assert.equal(qualityPolicySource(f.s,{scope,policyId:f.s.qualityPolicies[0].id,version:1,mode:'historical',at:facts.bookings[0].createdAt}).available,false,'new publication cannot backfill unknown old decision');
});

test('shared: isolated actual v1 publication lacking only events remains readable, upgrades unchanged and withdraws via full reduce',()=>{
  const f=fixture(),r=f.legacyPolicy(),before=clone(f.s.qualityPolicies);assert.equal(Object.hasOwn(before[0],'events'),false);assert.equal(qualityPolicySource(f.s,{scope}).available,true);
  const next=upgradeFinanceState(clone(f.s));assert.deepEqual(next.qualityPolicies,before);assert.deepEqual(next.qualityPolicyRequests,f.s.qualityPolicyRequests);
  f.advance();const p=f.withdrawPayload(r.id);f.run(f.support,'quality.policy-withdraw',p);assert.equal(f.s.qualityPolicies[0].status,'withdrawn');assert.equal(f.s.qualityPolicies[0].events.length,1);assert.equal(qualityPolicySource(f.s,{scope,policyId:r.id,version:r.version,mode:'historical',at:before[0].publication.at}).available,true);
});
