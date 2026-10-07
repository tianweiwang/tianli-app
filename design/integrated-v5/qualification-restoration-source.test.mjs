import test from 'node:test';
import assert from 'node:assert/strict';
import {seed,reduce,createLifecycleContext} from './engine.mjs';
import * as qualification from './tech-qualification.mjs';
import {resolveAccountActor} from './staff-accounts.mjs';
import {lifecycleImpact} from './organization-lifecycle-projection.mjs';

const user={role:'user',userId:'u1'},MIN=60000;
let cached;
function originalSources(){
  let s=seed(),seq=0;
  const run=(actor,type,p={})=>{let result;s=reduce(s,actor,type,{requestId:'qrs-original-'+ ++seq,reason:'隔离真实资格来源',...p},value=>result=value);return result;};
  const login=run(user,'account.enter',{accountId:'DEMO-ADMIN',grantId:'DEMO-ADMIN-GRANT'}),admin=resolveAccountActor(s,login);
  const staff=(job,storeId)=>{let row=run(admin,'account.create',{name:'恢复来源实际'+job});row=run(admin,'account.employment',{id:row.id,version:row.version,employmentStatus:'active',reference:'QRS-EMP-'+job,verifiedAt:s.now});row=run(admin,'account.grant',{id:row.id,version:row.version,job,...(storeId?{storeId}:{})});const entered=run(user,'account.enter',{accountId:row.id,grantId:row.grants.at(-1).id});return resolveAccountActor(s,entered);};
  const local=staff('store-manager','xingfu'),operations=staff('operations'),support=staff('support');
  run(local,'manage.tech-save',{name:'恢复源实际技师',phone:'13800005555',storeId:'xingfu',gender:'female',lat:31.231,lng:121.475,serviceIds:['neck','relax'],certificate:'QRS-C',insurance:'QRS-I',validUntil:'2027-12-31'});
  const techId=s.techs.at(-1).id;run(operations,'manage.tech-review',{id:techId,version:s.techs.at(-1).version,decision:'approve'});
  return{s,techId,admin,local,operations,support};
}
function fixture(){
  const f=structuredClone(cached ||= originalSources());let seq=0;
  f.run=(actor,type,p={})=>{let result;f.s=reduce(f.s,actor,type,{requestId:'qrs-test-'+ ++seq,reason:'原资格恢复实际办理',...p},value=>result=value);return result;};
  Object.defineProperty(f,'tech',{get:()=>f.s.techs.find(t=>t.id===f.techId)});
  f.profile=(storeId=f.tech.storeId,profileId=f.tech.qualificationProfileId)=>f.s.techQualifications.find(row=>row.techId===f.techId&&row.storeId===storeId&&(!profileId||row.id===profileId));
  f.qual=(type,p={},actor=f.local)=>{const storeId=p.storeId||f.tech.storeId,row=f.profile(storeId,p.profileId);return f.run(actor,'qualification.'+type,{techId:f.techId,storeId,version:row?.version||0,...p});};
  f.advance=minutes=>f.run(user,'clock.advance',{minutes});return f;
}
function authorize(f,{holdId,storeId=f.tech.storeId,profileId=f.tech.qualificationProfileId}={}){
  const scope={storeId,...(profileId?{profileId}:{})};
  f.qual('assess',{...scope,serviceIds:['neck'],kind:holdId?'retraining':'initial',holdId,occurredAt:f.s.now,result:'pass',batch:'QRS-实际批次',assessor:'原考核员',proof:'QRS-实际考核'},f.operations);
  f.qual('request',{...scope,assessmentId:f.profile(storeId,profileId).assessments.at(-1).id},f.operations);
  f.qual('review',{...scope,grantId:f.profile(storeId,profileId).grants.at(-1).id,decision:'approve',reviewer:'原集团运营审核',proof:'QRS-实际授权'},f.operations);
}
function book(f,techId=f.techId){f.run(user,'booking.create',{storeId:f.tech.storeId,serviceId:'neck',techId,mode:'specified',regionId:'home',genderPreference:'any',startAt:Math.ceil((f.s.now+5*60*MIN)/(30*MIN))*30*MIN,contactName:'隔离本人',phone:'13800001111',healthConsent:true,identityVerified:true,adultConfirmed:true});return f.s.bookings.at(-1).id;}
function pause(f){f.qual('pause',{serviceIds:['neck'],owner:'原复训负责人'},f.support);f.oldProfileId=f.profile().id;f.holdId=f.profile().holds.at(-1).id;}
function selection(f){return{techId:f.techId,profileId:f.oldProfileId,holdId:f.holdId};}
function project(f,select=selection(f)){
  assert.equal(typeof qualification.qualificationRestorationSource,'function');
  const before=structuredClone(f.s),out=qualification.qualificationRestorationSource(f.s,select);assert.deepEqual(f.s,before,'来源 getter 不得写原 state');return out;
}
function restored({booking=false}={}){const f=fixture();authorize(f);if(booking)f.bookingId=book(f);pause(f);f.advance(10);authorize(f,{holdId:f.holdId});if(booking)f.run(user,'booking.cancel',{id:f.bookingId,reason:'原本人明确取消协调'});f.qual('resume',{holdId:f.holdId,reviewer:'原运营明确恢复'},f.operations);return f;}

test('真实暂停→复训→申请批准→明确恢复取得纯来源，不携带期限授权',()=>{
  const f=restored(),out=project(f);assert.equal(out.available,true);assert.equal(out.qualificationReady,true);assert.equal(out.hold.status,'resolved');assert.equal(out.assessment.id,out.resolution.assessmentId);assert.equal(out.grant.id,out.resolution.grantId);assert.equal(out.assessment.kind,'retraining');assert.equal(out.grant.review.by.accountId,f.operations.accountId);assert.deepEqual(out.blockers,[]);assert.deepEqual(out.remainingImpacts,{original:[],current:[]});assert.match(out.sourceToken,/^sha256:[a-f0-9]{64}$/);assert.equal(Object.hasOwn(out,'releaseEligible'),false);assert.equal(Object.hasOwn(out,'endAt'),false);
  const before=structuredClone(f.s);out.hold.reason='不能反写';out.assessment.proof='不能反写';out.grant.review.reason='不能反写';assert.deepEqual(f.s,before);assert.equal(project(f).sourceToken,project(f).sourceToken);
});
test('仍暂停/复训未授权/已批准未明确恢复都不能冒资格已恢复',()=>{
  const f=fixture();authorize(f);pause(f);assert.equal(project(f).qualificationReady,false);f.advance(10);f.qual('assess',{kind:'retraining',holdId:f.holdId,serviceIds:['neck'],occurredAt:f.s.now,result:'pass',batch:'真实复训',assessor:'原考核人',proof:'原复训编号'});assert.equal(project(f).available,false);f.qual('request',{assessmentId:f.profile().assessments.at(-1).id});assert.equal(project(f).qualificationReady,false);f.qual('review',{grantId:f.profile().grants.at(-1).id,decision:'approve',reviewer:'运营',proof:'原批准'},f.operations);assert.equal(project(f).qualificationReady,false);
});
test('精确 selectors 拒缺省/错人/错档/ready/期限载荷',()=>{
  const f=restored();for(const p of [{techId:f.techId,holdId:f.holdId},{...selection(f),techId:'chen'},{...selection(f),profileId:'WRONG'},{...selection(f),ready:true},{...selection(f),endAt:0}]){const out=project(f,p);assert.equal(out.available,false);assert.equal(out.qualificationReady,false);assert.ok(out.blockers.length);}
});
test('缺或重复主体/原档/原店/原暂停保持缺源，不选择首行',()=>{
  const base=restored();for(const mutate of [f=>f.s.techs.push(structuredClone(f.tech)),f=>f.s.techQualifications.push(structuredClone(f.profile())),f=>f.s.stores.push(structuredClone(f.s.stores.find(x=>x.id==='xingfu'))),f=>f.profile().holds.push(structuredClone(f.profile().holds[0])),f=>f.s.techQualifications=[],f=>f.s.techs=f.s.techs.filter(x=>x.id!==f.techId)]){const f=restored();mutate(f);const out=project(f,selection(base));assert.equal(out.available,false);assert.ok(out.blockers.length);}
});
test('恢复 assessment/grant/resolution 精确唯一；撤销/改号/历史更正损坏副本拒绝',()=>{
  const mutations=[r=>r.assessments.push(structuredClone(r.assessments.at(-1))),r=>r.grants.push(structuredClone(r.grants.at(-1))),r=>r.holds[0].resolution.assessmentId='WRONG',r=>r.holds[0].resolution.grantId='WRONG',r=>r.grants.at(-1).status='rejected',r=>r.grants.at(-1).review.decision='reject',r=>r.assessments.at(-1).proof='改掉原考核正文',r=>r.holds[0].resolution.reason='改掉原恢复正文',r=>r.history.push(structuredClone(r.history.at(-1)))];
  for(const mutate of mutations){const f=restored();mutate(f.profile());assert.equal(project(f).available,false);assert.equal(project(f).qualificationReady,false);}
});
test('未来/倒序复训与恢复时间不构成原来源',()=>{
  for(const mutate of [f=>f.profile().assessments.at(-1).occurredAt=f.s.now+1,f=>f.profile().grants.at(-1).review.at=f.s.now+1,f=>f.profile().holds[0].resolution.at=f.s.now+1,f=>f.profile().assessments.at(-1).occurredAt=f.profile().holds[0].startedAt-1]){const f=restored();mutate(f);assert.equal(project(f).available,false);}
});
test('原 resolution 不被后来实际初训批准的最新 grant 替代',()=>{
  const f=restored(),old=project(f);f.advance(10);authorize(f);const next=project(f);assert.equal(next.qualificationReady,true);assert.equal(next.assessment.id,old.assessment.id);assert.equal(next.grant.id,old.grant.id);assert.notEqual(next.sourceToken,old.sourceToken);
});
test('当前资料实际暂停与时钟过期阻断当前资格，原恢复证据仍保留',()=>{
  const f=restored();f.run(f.operations,'manage.tech-review',{id:f.techId,version:f.tech.version,decision:'pause'});let out=project(f);assert.equal(out.available,true);assert.equal(out.qualificationReady,false);assert.equal(out.currentCredentials.valid,false);
  const z=restored();for(let i=0;i<16;i++)z.advance(44640);out=project(z);assert.equal(out.available,true);assert.equal(out.qualificationReady,false);assert.equal(out.currentCredentials.valid,false);
});
test('同人另一原暂停仍阻断；原本人取消事实保留',()=>{
  const f=restored({booking:true}),original=structuredClone(f.profile().holds[0].resolution);f.qual('pause',{serviceIds:['neck'],owner:'另一原暂停'},f.support);const out=project(f);assert.equal(out.available,true);assert.equal(out.qualificationReady,false);assert.ok(out.currentEligibility.some(x=>!x.allowed));assert.deepEqual(out.resolution,original);assert.equal(f.s.bookings.find(x=>x.id===f.bookingId).status,'closed');
});
test('原快照预约缺失/重复不能伪已协调；实际取消后的纯源可通过',()=>{
  const f=restored({booking:true});assert.equal(project(f).qualificationReady,true);for(const missing of [true,false]){const z=restored({booking:true}),b=z.s.bookings.find(x=>x.id===z.bookingId);if(missing)z.s.bookings=z.s.bookings.filter(x=>x.id!==z.bookingId);else z.s.bookings.push(structuredClone(b));assert.equal(project(z).available,false);}
});
test('真实未开始当前安排仍返回协调阻断；原本人取消后解除该阻断',()=>{
  const f=restored(),id=book(f),out=project(f);assert.equal(out.available,true);assert.equal(out.qualificationReady,false);assert.ok(out.remainingImpacts.current.some(x=>x.bookingId===id));f.run(user,'booking.cancel',{id,reason:'本人明确原取消'});assert.equal(project(f).qualificationReady,true);assert.notEqual(project(f).sourceToken,out.sourceToken);
});
test('当前拟改派准确目标须协调，不能只按原当前 tech 隐藏',()=>{
  const f=restored(),id=book(f,'chen');f.run(user,'booking.pay',{id,outcome:'success'});f.run({role:'tech',techId:'chen'},'booking.accept',{id});f.run(f.local,'booking.assign',{id,techId:f.techId,reason:'原店提出明确目标'});const out=project(f);assert.equal(out.qualificationReady,false);assert.ok(out.remainingImpacts.current.some(x=>x.bookingId===id&&x.proposed));
});
test('实际调店不借旧恢复批准新店；新店实际授权后保留原恢复链',()=>{
  const f=restored(),old=project(f),impact=lifecycleImpact(f.s,{techId:f.techId},createLifecycleContext());f.run(f.operations,'lifecycle.transfer-plan',{techId:f.techId,version:f.tech.version,toStoreId:'silver',targetVersion:f.s.stores.find(x=>x.id==='silver').version,effectiveAt:f.s.now+10*MIN,reference:'QRS-原调店依据',sourceToken:impact.sourceToken});f.advance(10);assert.equal(f.tech.storeId,'silver');let out=project(f);assert.equal(out.available,true);assert.equal(out.qualificationReady,false);authorize(f);out=project(f);assert.equal(out.qualificationReady,true);assert.equal(out.grant.id,old.grant.id);assert.equal(out.storeId,'xingfu');assert.ok(out.currentEligibility.every(x=>x.storeId==='silver'));
});
test('后来实际撤回审批人工作授权不篡改当时批准，getter不授予写权',()=>{
  const f=restored(),a=f.s.staffAccounts.find(x=>x.id===f.operations.accountId);f.run(f.admin,'account.revoke',{id:a.id,version:a.version,grantId:f.operations.grantId,reason:'原管理员撤回当前工作授权'});assert.equal(project(f).qualificationReady,true);assert.throws(()=>f.qual('resume',{holdId:f.holdId,reviewer:'失权旧人'},f.operations),/失效|无权/);
});
test('原暂停/复训项目与当前授权正文更改须与原命令回执一致',()=>{
  for(const mutate of [f=>f.profile().holds[0].serviceIds.push('relax'),f=>f.profile().assessments.at(-1).serviceIds.push('relax'),f=>{authorize(f);f.profile().grants.at(-1).review.proof='更改当前批准凭据';},f=>f.s.techQualificationRequests=f.s.techQualificationRequests.filter(x=>!JSON.parse(x.fingerprint).type.endsWith('resume'))]){const f=restored();mutate(f);assert.equal(project(f).available,false);}
});
test('真实服务中暂停及恢复保留原已开始安排，getter不写原资金或服务事实',()=>{
  const f=fixture();authorize(f);const id=book(f);f.run(user,'booking.pay',{id,outcome:'success'});f.run({role:'tech',techId:f.techId},'booking.accept',{id});const b=f.s.bookings.find(x=>x.id===id);f.advance((b.startAt-f.s.now)/MIN);f.run({role:'tech',techId:f.techId},'booking.start',{id});pause(f);f.advance(10);authorize(f,{holdId:f.holdId});f.qual('resume',{holdId:f.holdId,reviewer:'原运营核原服务中安排'},f.operations);const out=project(f);assert.equal(out.qualificationReady,true);assert.deepEqual(out.remainingImpacts,{original:[],current:[]});assert.equal(f.s.bookings.find(x=>x.id===id).status,'active');assert.ok(f.profile().holds[0].impacts.some(x=>x.bookingId===id&&x.stage==='fulfilling'));
});
test('未知容器与丢失原请求回执保持待核，不补数组或修存档',()=>{
  for(const key of ['techs','techQualifications','techQualificationRequests','stores','services','bookings']){const f=restored();f.s[key]=null;const out=project(f);assert.equal(out.available,false);assert.equal(out.qualificationReady,false);assert.match(out.reason,/容器/);}
  const f=restored();f.s.techQualificationRequests=[];assert.equal(project(f).qualificationReady,false);
});
