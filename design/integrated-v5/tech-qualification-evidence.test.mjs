import test from 'node:test';
import assert from 'node:assert/strict';
import { upgradeQualifications, qualificationCommand, qualificationEligibility, qualificationView, qualificationEvidenceRefs, qualificationEvidenceFile } from './tech-qualification.mjs';

const NOW=Date.parse('2026-10-04T12:00:00+08:00'),local={role:'store',storeId:'s1'},group={role:'group',job:'operations'},support={role:'group',job:'support'};
const file={ref:'invoice-file:'+'a'.repeat(64),name:'隔离资格凭证.pdf',type:'application/pdf',size:100};
function fixture(){return{now:NOW,seq:0,techs:[{id:'t1',storeId:'s1',name:'甲',serviceIds:['a','b'],active:true,reviewStatus:'approved',certificate:'C',insurance:'I',validUntil:'2027-12-31',qualificationRequired:true}],stores:[{id:'s1',serviceIds:['a','b']},{id:'s2',serviceIds:['a','b']}],services:[{id:'a',active:true},{id:'b',active:true}],bookings:[],serviceCareCases:[],techQualifications:[],techQualificationRequests:[]};}
let request=0;
function payload(s,type,extra={}){return{techId:'t1',version:s.techQualifications.find(row=>row.id===(extra.profileId||s.techs[0].qualificationProfileId||'t1'))?.version||0,requestId:'qualification-evidence-'+(++request),reason:'实际逐人核验依据',...extra};}
function run(s,type,extra={},actor=local,verified=true){const out=structuredClone(s),p=payload(out,type,extra);qualificationCommand(out,actor,'qualification.'+type,p,{fail:message=>{throw Error(message);},id:prefix=>prefix+(++out.seq),log(){},...(verified?{validateEvidenceRefs:refs=>refs.every(item=>item.ref===file.ref&&item.name===file.name&&item.type===file.type&&item.size===file.size)}:{})});return out;}
const row=s=>s.techQualifications.find(item=>item.id==='t1');
const assess=(s,p={})=>run(s,'assess',{kind:'mature',serviceIds:['a'],occurredAt:NOW-1000,batch:'原成熟名单',assessor:'实际考核人',proof:'原纸质档案编号',result:'pass',...p});
function approved(s){s=assess(s);s=run(s,'request',{assessmentId:row(s).assessments.at(-1).id});return run(s,'review',{grantId:row(s).grants.at(-1).id,decision:'approve',reviewer:'集团核验作者',proof:'原集团审核编号'},group);}

test('元数据只保留原四字段，沿现PDF/PNG/JPEG与Demo大小，拒假描述和重复',()=>{
  assert.deepEqual(qualificationEvidenceRefs([{...file,verified:true,owner:'fake'}]),[file]);
  for(const type of ['application/pdf','image/png','image/jpeg'])assert.equal(qualificationEvidenceRefs([{...file,type}])[0].type,type);
  for(const value of [null,'[]',{},[{...file,ref:'fake'}],[{...file,size:0}],[{...file,size:true}],[{...file,size:'100'}],[{...file,size:5*1024*1024+1}],[{...file,type:'image/webp'}],[{...file,name:'../原凭证.pdf'}],[file,file]])assert.throws(()=>qualificationEvidenceRefs(value),/资格|重复/);
  assert.deepEqual(qualificationEvidenceRefs(undefined),[]);
});
test('新增凭证必须运行上下文核验，载荷verified不能代替真实文件证据',()=>{
  assert.throws(()=>run(fixture(),'assess',{kind:'mature',serviceIds:['a'],occurredAt:NOW,batch:'B',assessor:'A',proof:'P',result:'pass',evidenceRefs:[file],verified:true},local,false),/实际文件核验/);
  assert.throws(()=>assess(fixture(),{evidenceRefs:[{...file,name:'伪造名称.pdf'}]}),/实际文件核验/);
});
test('旧记录及迁移不补文件不造批准，成熟技师仍逐人考核申请审核',()=>{
  let s=fixture();delete s.techs[0].qualificationRequired;upgradeQualifications(s);const before=structuredClone(s);upgradeQualifications(s);assert.deepEqual(s,before);assert.equal(s.techQualifications.length,0);
  s=assess(s);assert.equal(row(s).assessments[0].evidenceRefs,undefined);assert.equal(qualificationEligibility(s,'t1','a').allowed,false);s=run(s,'request',{assessmentId:row(s).assessments[0].id});assert.equal(row(s).grants[0].status,'pending');assert.equal(qualificationEligibility(s,'t1','a').allowed,false);
  s=run(s,'review',{grantId:row(s).grants[0].id,decision:'approve',reviewer:'真实核验人',proof:'真实原来源'},group);assert.equal(qualificationEligibility(s,'t1','a').allowed,true);assert.equal(qualificationEligibility(s,'t1','b').allowed,false);
});
test('考核附原项目时间作者来源，精确record和history槽返回分离副本',()=>{
  const s=assess(fixture(),{evidenceRefs:[file]}),r=row(s),assessment=r.assessments[0],before=structuredClone(s);
  assert.deepEqual(assessment.evidenceRefs,[file]);assert.deepEqual(assessment.serviceIds,['a']);assert.equal(assessment.occurredAt,NOW-1000);assert.equal(assessment.createdBy.id,'s1');assert.equal(assessment.proof,'原纸质档案编号');
  const actual=qualificationEvidenceFile(s,local,r.id,`assessment:${assessment.id}:0`),history=qualificationEvidenceFile(s,local,r.id,'history:1:0');assert.equal(actual.ref,file.ref);assert.equal(history.ref,file.ref);assert.ok(actual.sourceToken.includes(assessment.id));actual.name='变更';assert.deepEqual(s,before);
  for(const slot of [`assessment:${assessment.id}:01`,`assessment:${assessment.id}:1`,'history:0:0','history:2:0','evidence:0'])assert.throws(()=>qualificationEvidenceFile(s,local,r.id,slot),/槽|历史/);
});
test('申请与审核文件各归原来源，不改考核，不使附件独立授予资格',()=>{
  let s=assess(fixture(),{evidenceRefs:[file]}),original=structuredClone(row(s).assessments[0]);s=run(s,'request',{assessmentId:original.id,evidenceRefs:[file]});const grantId=row(s).grants[0].id;assert.equal(qualificationEligibility(s,'t1','a').allowed,false);assert.equal(qualificationEvidenceFile(s,support,'t1',`request:${grantId}:0`).ref,file.ref);
  s=run(s,'review',{grantId,decision:'approve',reviewer:'原集团审核人',proof:'原审核来源',evidenceRefs:[file]},group);assert.deepEqual(row(s).assessments[0],original);assert.equal(qualificationEvidenceFile(s,group,'t1',`review:${grantId}:0`).ref,file.ref);assert.equal(qualificationEvidenceFile(s,group,'t1','history:3:0').ref,file.ref);assert.equal(qualificationEligibility(s,'t1','a').allowed,true);
  const immutable=structuredClone(row(s).grants[0]);s=assess(s,{evidenceRefs:[file]});assert.deepEqual(row(s).grants[0],immutable);
});
test('原暂停后复训批准不自动恢复，五类来源可精确读取',()=>{
  let s=approved(fixture());s=run(s,'pause',{serviceIds:['a'],owner:'原复训负责人',evidenceRefs:[file]},support);const holdId=row(s).holds[0].id;assert.equal(qualificationEvidenceFile(s,support,'t1',`pause:${holdId}:0`).ref,file.ref);
  s=assess(s,{kind:'retraining',holdId,occurredAt:NOW,evidenceRefs:[file]});s=run(s,'request',{assessmentId:row(s).assessments.at(-1).id,evidenceRefs:[file]});s=run(s,'review',{grantId:row(s).grants.at(-1).id,decision:'approve',reviewer:'原复训审核人',proof:'复训审核编号',evidenceRefs:[file]},group);assert.equal(qualificationEligibility(s,'t1','a').allowed,false);
  s=run(s,'resume',{holdId,reviewer:'恢复核验作者',evidenceRefs:[file]},group);assert.equal(qualificationEligibility(s,'t1','a').allowed,true);assert.equal(qualificationEvidenceFile(s,group,'t1',`resume:${holdId}:0`).ref,file.ref);
});
test('沿原内部凭证边界，技师本人/普通用户/跨店/财务不得读取',()=>{
  const s=assess(fixture(),{evidenceRefs:[file]}),slot=`assessment:${row(s).assessments[0].id}:0`;
  for(const actor of [{role:'tech',techId:'t1'},{role:'user',userId:'u1'},{role:'store',storeId:'s2'},{role:'group',job:'finance'},{role:'group',job:'warehouse'}])assert.throws(()=>qualificationEvidenceFile(s,actor,'t1',slot),/无权/);
  for(const actor of [local,group,support,{role:'manager',storeId:'s1'}])assert.equal(qualificationEvidenceFile(s,actor,'t1',slot).ref,file.ref);
  const projected=qualificationView(s,{role:'tech',techId:'t1'});assert.equal(projected.technicians[0].profileId,'t1');assert.ok(!JSON.stringify(projected).includes(file.ref));assert.equal(projected.technicians[0].assessments[0].proof,undefined);
});
test('注册原岗位会话每次重核，陈旧载荷role不能冒充已撤岗位',()=>{
  const s=assess(fixture(),{evidenceRefs:[file]}),slot=`assessment:${row(s).assessments[0].id}:0`;
  s.staffAccounts=[{id:'A',name:'原运营账号',enabled:true,version:1,grants:[{id:'G',job:'operations',role:'group',enabled:true}]}];s.staffSessions=[{id:'S',accountId:'A',grantId:'G',accountVersion:1,expiresAt:NOW+1000}];const raw={sessionId:'S',role:'group',job:'finance'};
  assert.equal(qualificationEvidenceFile(s,raw,'t1',slot).ref,file.ref);s.staffSessions[0].revokedAt=NOW;assert.throws(()=>qualificationEvidenceFile(s,raw,'t1',slot),/会话/);
});
test('拒绝重复档案/原考核、历史副本更换和缺失原来源事实',()=>{
  const s=assess(fixture(),{evidenceRefs:[file]}),slot=`assessment:${row(s).assessments[0].id}:0`;
  for(const mutate of [x=>x.techQualifications.push(structuredClone(row(x))),x=>row(x).assessments.push(structuredClone(row(x).assessments[0])),x=>row(x).assessments[0].createdBy=null,x=>row(x).assessments[0].proof='']){const x=structuredClone(s);mutate(x);assert.throws(()=>qualificationEvidenceFile(x,local,'t1',slot),/不唯一|缺失/);}
  const x=structuredClone(s);row(x).history[0].evidenceRefs[0].name='串原件.pdf';assert.throws(()=>qualificationEvidenceFile(x,local,'t1','history:1:0'),/原记录不一致/);
  const y=assess(s,{evidenceRefs:[file]});row(y).history[0].assessmentId=row(y).assessments[1].id;assert.throws(()=>qualificationEvidenceFile(y,local,'t1','history:1:0'),/原记录不一致/);
});
test('多个历史店profile精确分开，旧店可回看自己的原件，全历史同人hold继续拦新单',()=>{
  let s=approved(fixture());s=run(s,'pause',{serviceIds:['a'],owner:'旧店复训',evidenceRefs:[file]});const old=row(s),holdId=old.holds[0].id;s.techs[0].storeId='s2';s.techs[0].qualificationProfileId='new-profile';s.techQualifications.push({id:'new-profile',techId:'t1',storeId:'s2',version:0,assessments:[],grants:[],holds:[],history:[]});
  assert.equal(qualificationEvidenceFile(s,local,'t1',`pause:${holdId}:0`).ref,file.ref);assert.throws(()=>qualificationEvidenceFile(s,{role:'store',storeId:'s2'},'t1',`pause:${holdId}:0`),/无权/);assert.equal(qualificationEligibility(s,'t1','a').reason.includes('暂停'),true);
  s=run(s,'assess',{profileId:'t1',storeId:'s1',kind:'retraining',holdId,serviceIds:['a'],occurredAt:NOW,batch:'旧店复训',assessor:'旧店实际作者',proof:'旧店原来源',result:'pass',evidenceRefs:[file]},group);assert.equal(s.techQualifications.find(x=>x.id==='new-profile').assessments.length,0);assert.equal(row(s).assessments.at(-1).holdId,holdId);
});
test('原精确请求重放不重复写文件记录，变更载荷不替换原件',()=>{
  const s=fixture(),p=payload(s,'assess',{kind:'mature',serviceIds:['a'],occurredAt:NOW,batch:'B',assessor:'A',proof:'P',result:'pass',evidenceRefs:[file]}),ctx={id:prefix=>prefix+(++s.seq),validateEvidenceRefs:()=>true};qualificationCommand(s,local,'qualification.assess',p,ctx);const before=structuredClone(s);qualificationCommand(s,local,'qualification.assess',p,{});assert.deepEqual(s,before);assert.throws(()=>qualificationCommand(s,local,'qualification.assess',{...p,evidenceRefs:[{...file,name:'替换.pdf'}]},ctx),/同一提交/);
});
test('完整sourceToken复核原关联考核和原作者变化，读取不改存储',()=>{
  let s=assess(fixture());s=run(s,'request',{assessmentId:row(s).assessments[0].id,evidenceRefs:[file]});const slot=`request:${row(s).grants[0].id}:0`,before=structuredClone(s),token=qualificationEvidenceFile(s,group,'t1',slot).sourceToken;assert.deepEqual(s,before);row(s).assessments[0].proof='原依据已变更';assert.notEqual(qualificationEvidenceFile(s,group,'t1',slot).sourceToken,token);
});
