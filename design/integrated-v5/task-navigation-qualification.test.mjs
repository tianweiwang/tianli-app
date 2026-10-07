import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { seed, reduce } from './engine.mjs';
import { applyTechnicianTransfer } from './organization-assignment.mjs';
import { workTaskView } from './work-tasks.mjs';
import { createTaskReturnContext, taskReturnTarget } from './task-navigation.mjs';
import { qualificationView, qualificationEvidenceFile } from './tech-qualification.mjs';
import { qualificationUiView } from './qualification-ui.mjs';
import { prepareQualificationEvidence } from './qualification-file-validation.mjs';
import { resolveAccountActor } from './staff-accounts.mjs';

// Runtime/domain unit evidence. No browser or origin data is used. Transfer setup
// uses the existing C08 isolated planned-case fixture and the actual transfer adapter.
const ops={role:'group',job:'operations'},user={role:'user',userId:'u1'},oldStore={role:'store',storeId:'xingfu'};
const decode=s=>s.replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
const forms=(html,type)=>[...html.matchAll(/<form\b([^>]*)>[\s\S]*?<\/form>/g)].map(([,attrs])=>({type:/data-command="([^"]+)"/.exec(attrs)?.[1],payload:JSON.parse(decode(/data-payload="([^"]+)"/.exec(attrs)?.[1]||'{}')),next:decode(/data-next="([^"]+)"/.exec(attrs)?.[1]||'')})).filter(f=>f.type===type);
function fixture(){
  let s=seed(),n=0,techId;
  const f={get s(){return s;},get tech(){return s.techs.find(t=>t.id===techId);},
    run(a,type,p={},evidence){let result;s=reduce(s,a,type,{reason:'C11精确原档命令回归',requestId:'C11-profile-'+ ++n,...p},r=>result=r,evidence);return result;},
    profile(storeId=f.tech.storeId,profileId=f.tech.qualificationProfileId){return s.techQualifications.find(p=>p.techId===techId&&p.storeId===storeId&&(!profileId||p.id===profileId));},
    qual(type,p={},a=ops,evidence){const storeId=p.storeId||f.tech.storeId,profile=f.profile(storeId,p.profileId||(storeId===f.tech.storeId?f.tech.qualificationProfileId:null));return f.run(a,'qualification.'+type,{techId,storeId,...(profile?{profileId:profile.id}:{}),version:profile?.version||0,reason:'C11精确原档回归',...p},evidence);},
    pending(){f.qual('assess',{serviceIds:['relax'],batch:'C11实际考核',assessor:'隔离考核人',proof:'C11-ASSESS-'+n,occurredAt:s.now,result:'pass',kind:'initial'});f.qual('request',{assessmentId:f.profile().assessments.at(-1).id});return f.profile();},
    approve(profile=f.profile()){return f.qual('review',{storeId:profile.storeId,profileId:profile.id,grantId:profile.grants.at(-1).id,decision:'approve',reviewer:'实际集团审核',proof:'C11-APPROVAL-'+n});},
    transfer(toStoreId='silver'){s=structuredClone(s);s.organizationLifecycleCases??=[];const c={id:'C11-TRANSFER-'+ ++n,kind:'transfer',techId,fromStoreId:f.tech.storeId,toStoreId,createdAt:s.now,effectiveAt:s.now+60000,stage:'planned',status:'planned',version:1,createdBy:ops,reference:'C11-C08-TRANSFER',reason:'原调店适配隔离验证',impactSnapshot:{}};s.organizationLifecycleCases.push(c);s.now=c.effectiveAt;applyTechnicianTransfer(s,c,{fail:m=>{throw Error(m);},id:p=>p+(++s.seq)});c.stage='effective';c.status='effective';c.appliedAt=s.now;},
    task(profile=f.profile(),actor=ops){const grantId=profile.grants.at(-1).id;return workTaskView(s,actor).tasks.find(t=>t.category==='qualification'&&t.grantId===grantId);},
    context(task,actor=ops){return createTaskReturnContext(s,actor,{taskKey:task.id,task,listHash:`/${actor.role}/tasks?category=qualification&status=${task.status}`,token:'C11-exact-profile'});},
    page(profile=f.profile(),actor=ops,query){return qualificationUiView(s,actor,['qualifications',techId],{query:new URLSearchParams(query??`profileId=${profile.id}&storeId=${profile.storeId}`)});},
    staff(job,storeId){const enteredAdmin=f.run(user,'account.enter',{accountId:'DEMO-ADMIN',grantId:'DEMO-ADMIN-GRANT'}),admin=resolveAccountActor(s,enteredAdmin);const row=f.run(admin,'account.create',{name:'C11 '+job,reason:'原岗位回归'}),g=f.run(admin,'account.grant',{id:row.id,version:row.version,job,...(storeId?{storeId}:{}),reason:'准确原资源范围'}),entered=f.run(user,'account.enter',{accountId:row.id,grantId:g.grants.at(-1).id});return resolveAccountActor(s,entered);}
  };
  f.run(oldStore,'manage.tech-save',{storeId:'xingfu',name:'C11原档技师',phone:'13800008880',gender:'male',lat:31.231,lng:121.475,serviceIds:['relax','neck'],certificate:'C11-CERT',insurance:'C11-INSURANCE',validUntil:'2027-12-31'});techId=s.techs.at(-1).id;f.run(ops,'manage.tech-review',{id:techId,version:f.tech.version,decision:'approve'});f.pending();f.approve();return f;
}

test('actual transfer and new-store request enter the exact new profile; real review and return preserve it',()=>{
  const f=fixture();f.transfer();const p=f.pending(),task=f.task(p),c=f.context(task);
  assert.equal(task.profileId,p.id);assert.equal(c.binding.profileId,p.id);assert.equal(c.binding.storeId,'silver');
  const url=new URL(c.targetPath,'https://unit.invalid');assert.equal(url.searchParams.get('profileId'),p.id);assert.equal(url.searchParams.get('storeId'),'silver');
  const form=forms(f.page(p),'qualification.review')[0];assert.equal(form.payload.profileId,p.id);assert.equal(form.payload.storeId,'silver');assert.equal(form.payload.grantId,p.grants.at(-1).id);assert.equal(form.next,c.targetPath);
  const old=structuredClone(f.profile('xingfu',null));f.run(ops,form.type,{...form.payload,decision:'approve',reviewer:'实际原表单审核',proof:'C11-FORM-REVIEW',reason:'原档核验'});
  assert.equal(f.profile().grants.at(-1).status,'approved');assert.deepEqual(f.profile('xingfu',null),old);assert.equal(taskReturnTarget(f.s,ops,c,c.targetPath),c.listHash);
});

test('original-store historical profile is readable and forms never silently target the current profile',()=>{
  const f=fixture(),old=structuredClone(f.profile());f.transfer();f.pending();const task=f.task(old),c=f.context(task);
  assert.equal(c.binding.profileId,old.id);assert.equal(c.storeId,'xingfu');assert.equal(taskReturnTarget(f.s,ops,c,c.targetPath),c.listHash);
  const view=qualificationView(f.s,ops,{techId:f.tech.id,profileId:old.id,storeId:old.storeId});assert.equal(view.technicians[0].profileId,old.id);assert.equal(view.technicians[0].storeId,'xingfu');
  for(const form of ['qualification.assess','qualification.pause'].flatMap(type=>forms(f.page(old),type))){assert.equal(form.payload.profileId,old.id);assert.equal(form.payload.storeId,'xingfu');assert.equal(form.next,c.targetPath);}
  const currentBefore=structuredClone(f.profile()),assess=forms(f.page(old),'qualification.assess')[0];
  f.run(ops,assess.type,{...assess.payload,serviceIds:['neck'],kind:'mature',batch:'原店历史档真实考核',assessor:'集团原档考核人',occurredAt:f.s.now,result:'pass',proof:'C11-HISTORY-ASSESS'});
  const request=forms(f.page(old),'qualification.request').at(-1);assert.equal(request.payload.profileId,old.id);f.run(ops,request.type,request.payload);
  const review=forms(f.page(old),'qualification.review').at(-1);assert.equal(review.payload.profileId,old.id);f.run(ops,review.type,{...review.payload,decision:'approve',reviewer:'原档集团审核',proof:'C11-HISTORY-APPROVAL'});
  assert.equal(f.profile('xingfu',old.id).grants.at(-1).status,'approved');assert.deepEqual(f.profile(),currentBefore);assert.equal(taskReturnTarget(f.s,ops,c,c.targetPath),c.listHash);
  const storeTask=f.task(old,oldStore),storeContext=f.context(storeTask,oldStore);assert.equal(taskReturnTarget(f.s,oldStore,storeContext,storeContext.targetPath),storeContext.listHash);
  assert.match(f.page(old,{role:'store',storeId:'silver'}),/不存在|无权|失效/);assert.equal(forms(f.page(old,{role:'store',storeId:'silver'}),'qualification.assess').length,0);
});

test('returning to a former store keeps multiple historical profiles distinct',()=>{
  const f=fixture(),first=structuredClone(f.profile());f.transfer();f.pending();f.approve();f.transfer('xingfu');const current=f.pending();
  assert.notEqual(first.id,current.id);assert.equal(f.s.techQualifications.filter(p=>p.techId===f.tech.id&&p.storeId==='xingfu').length,2);
  for(const p of [first,current]){const task=f.task(p),c=f.context(task);assert.equal(c.binding.profileId,p.id);assert.equal(taskReturnTarget(f.s,ops,c,c.targetPath),c.listHash);assert.equal(qualificationView(f.s,ops,{techId:f.tech.id,profileId:p.id,storeId:p.storeId}).technicians[0].profileId,p.id);}
});

test('forged profile/grant/store, duplicate sources and foreign store cannot create or reuse context',()=>{
  const f=fixture(),old=structuredClone(f.profile());f.transfer();const p=f.pending(),task=f.task(p),c=f.context(task);
  for(const extra of [{profileId:old.id},{storeId:'xingfu'},{grantId:old.grants[0].id},{profileId:'missing'}])assert.throws(()=>f.context({...task,...extra}),/失效/);
  assert.throws(()=>f.context(task,oldStore),/失效/);
  const different=c.targetPath.replace(p.id,old.id);assert.equal(taskReturnTarget(f.s,ops,c,different),null);
  const duplicate=structuredClone(f.s);duplicate.techQualifications.push(structuredClone(p));assert.equal(taskReturnTarget(duplicate,ops,c,c.targetPath),null);
  const duplicateGrant=structuredClone(f.s);duplicateGrant.techQualifications.find(x=>x.id===p.id).grants.push(structuredClone(p.grants.at(-1)));assert.equal(taskReturnTarget(duplicateGrant,ops,c,c.targetPath),null);
});

test('explicit detail query rejects incomplete/duplicate/unknown scope and never falls back to current profile',()=>{
  const f=fixture(),old=structuredClone(f.profile());f.transfer();f.pending();
  for(const q of [`profileId=${old.id}`,`storeId=xingfu`,`profileId=${old.id}&storeId=silver`,`profileId=missing&storeId=xingfu`,`profileId=${old.id}&storeId=xingfu&profileId=${old.id}`,`profileId=${old.id}&storeId=xingfu&next=all`]){const html=f.page(old,ops,q);assert.match(html,/不存在|无权|失效/);assert.equal(forms(html,'qualification.assess').length,0,q);}
  const current=qualificationView(f.s,ops).technicians.find(t=>t.techId===f.tech.id);assert.equal(current.profileId,f.profile().id);assert.equal(forms(f.page(f.profile(),ops,''),'qualification.assess')[0].payload.profileId,f.profile().id);
});

test('actual work session revocation rejects both historical navigation and detail',()=>{
  const f=fixture(),a=f.staff('operations'),old=structuredClone(f.profile());f.transfer();f.pending();const task=f.task(old,a),c=f.context(task,a);
  assert.equal(taskReturnTarget(f.s,a,c,c.targetPath),c.listHash);
  const enteredAdmin=f.run(user,'account.enter',{accountId:'DEMO-ADMIN',grantId:'DEMO-ADMIN-GRANT'}),admin=resolveAccountActor(f.s,enteredAdmin);f.run(admin,'account.status',{id:a.accountId,version:f.s.staffAccounts.find(x=>x.id===a.accountId).version,enabled:false,reason:'实际撤销旧工作授权'});
  assert.equal(taskReturnTarget(f.s,a,c,c.targetPath),null);assert.match(f.page(old,a),/不存在|无权|失效/);assert.equal(forms(f.page(old,a),'qualification.assess').length,0);
});

test('legacy navigation without a profile only restores its unique current-store source',()=>{
  const f=fixture(),old=structuredClone(f.profile()),original=f.task(old),task={...original,routes:{group:`/group/qualifications/${f.tech.id}`,store:`/store/qualifications/${f.tech.id}`}};delete task.profileId;
  const c=f.context(task);assert.equal(taskReturnTarget(f.s,ops,c,c.targetPath),c.listHash);f.transfer();f.pending();assert.equal(taskReturnTarget(f.s,ops,c,c.targetPath),null);
});

test('historical attachments remain attached to the exact original profile and internal proof stays hidden from tech',async()=>{
  const f=fixture(),bytes=new TextEncoder().encode('%PDF-1.4\nC11 actual original profile file\n%%EOF'),blob=new Blob([bytes],{type:'application/pdf'}),file={ref:'invoice-file:'+createHash('sha256').update(bytes).digest('hex'),name:'原档.pdf',type:'application/pdf',size:bytes.length};
  const p=f.profile(),payload={techId:f.tech.id,profileId:p.id,storeId:p.storeId,version:p.version,requestId:'C11-profile-file',serviceIds:['neck'],batch:'原档实际文件',assessor:'真实单元考核人',occurredAt:f.s.now,result:'pass',kind:'mature',proof:'C11-INTERNAL-FILE',reason:'真实合成文件原命令',evidenceRefs:[file]};
  const evidence=await prepareQualificationEvidence(f.s,ops,'qualification.assess',payload,{readFile:async()=>blob});f.run(ops,'qualification.assess',payload,evidence);const original=structuredClone(f.profile()),assessment=original.assessments.at(-1);f.transfer();f.pending();
  const html=f.page(original);assert.ok(html.includes(`data-invoice-id="${original.id}"`));assert.ok(html.includes(`data-invoice-slot="assessment:${assessment.id}:0"`));const authorized=qualificationEvidenceFile(f.s,ops,original.id,`assessment:${assessment.id}:0`);assert.deepEqual({ref:authorized.ref,name:authorized.name,type:authorized.type,size:authorized.size},file);assert.equal(JSON.parse(authorized.sourceToken).profile.id,original.id);
  assert.throws(()=>qualificationEvidenceFile(f.s,ops,f.profile().id,`assessment:${assessment.id}:0`),/不存在|失效|缺失/);
  assert.doesNotMatch(f.page(original,{role:'tech',techId:f.tech.id}),/C11-INTERNAL-FILE|data-invoice-id|原档\.pdf/);
});
