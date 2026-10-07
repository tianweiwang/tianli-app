import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Script, createContext } from 'node:vm';
import { webcrypto } from 'node:crypto';
import { seed, reduce } from './engine.mjs';
import { careClosureBlockers } from './service-care.mjs';
import { technicianPenaltyView, technicianPenaltyCaseResolution, technicianPenaltyTaskRows } from './technician-penalties.mjs';
import { workTaskView } from './work-tasks.mjs';
import { qualificationEligibility } from './tech-qualification.mjs';
import { resolveAccountActor } from './staff-accounts.mjs';

// Runtime unit only: execute the actual app body and its registered handlers.
// The DOM/Storage subset below has no layout, browser navigation, or file download.
// Imports are rebound to their original exports; privacy/business logic is not copied.
const KEY = 'tianli-integrated-v5';
const DRAFT = KEY + '-booking-draft:u1';
const RESULT = KEY + '-booking-result';
const appUrl = new URL('./app.mjs', import.meta.url);
const appSource = await readFile(appUrl, 'utf8');
const imported = {};
const importDeclarations = [...appSource.matchAll(/^import\s+\{([^}]+)\}\s+from\s+(['"])([^'"]+)\2;\s*$/gm)];
for (const declaration of importDeclarations) {
  const module = await import(new URL(declaration[3], appUrl));
  for (const name of declaration[1].split(',').map(s => s.trim())) {
    const [exported, local = exported] = name.split(/\s+as\s+/);
    imported[local] = module[exported];
  }
}

const MIN=60000;
const user={role:'user',userId:'u1'},tech={role:'tech',techId:'lin'},rawFinance={role:'group',job:'finance'};
const ledger=a=>JSON.parse(a.localStorage.getItem(KEY));
const pageText=a=>a.document.getElementById('app').textContent;
const toastText=a=>a.document.getElementById('toast').textContent;
const formFor=(a,type)=>a.document.querySelector(`form[data-command="${type}"]`);
const payloadFor=form=>JSON.parse(form.dataset.payload);
const localTime=s=>new Date(s.now+8*60*MIN).toISOString().slice(0,16);
const careRow=(s,id)=>s.serviceCareCases.find(c=>c.id===id);
const penaltyRow=s=>s.technicianPenalties.at(-1);
const personalRoute=id=>'#/tech/penalties/'+id;
const careRoute=(actor,id)=>'#/'+actor.role+'/care/case/'+id;
const penaltyRoute=(actor,id='')=>'#/'+actor.role+'/penalties'+(id?'/'+id:'');
const penaltyTask=(s,actor,id)=>workTaskView(s,actor).tasks.find(t=>t.category==='technician-penalty-appeal'&&t.sourceId===id);

// Actual service/care/account commands produce every positive source. The
// ordinary tech role remains the existing local demo identity, not a fabricated
// staff login; store/support/finance use original account/grant/session sources.
async function createServiceFixture(){
  let s=seed(),seq=0;
  const op=(actor,type,p={})=>{let result;s=reduce(s,actor,type,{requestId:'penalty-shared-source-'+ ++seq,reason:'隔离原处罚来源实际办理',...p},r=>result=r);return result;};
  const adminSession=op(user,'account.enter',{accountId:'DEMO-ADMIN',grantId:'DEMO-ADMIN-GRANT'}),admin=resolveAccountActor(s,adminSession);
  const staff=(job,storeId)=>{
    let a=op(admin,'account.create',{name:'处罚共享实际'+job});
    a=op(admin,'account.employment',{id:a.id,version:a.version,employmentStatus:'active',reference:'PENALTY-EMP-'+job,verifiedAt:s.now});
    a=op(admin,'account.grant',{id:a.id,version:a.version,job,...(storeId?{storeId}:{})});
    const g=a.grants.at(-1),session=op(user,'account.enter',{accountId:a.id,grantId:g.id});return resolveAccountActor(s,session);
  };
  const storeActor=staff('store-manager','xingfu'),supportActor=staff('support'),financeActor=staff('finance');
  op(financeActor,'finance.rule-publish',{scope:'global',version:0,groupBps:1000,storeBps:500,effectiveAt:s.now,reason:'明确本地原H配置'});
  op(financeActor,'tech-income.rule-publish',{storeId:'xingfu',serviceId:'all',version:0,rateBps:4000,refundPolicy:'proportional',rounding:'floor',effectiveAt:s.now,reason:'明确原店原提成配置'});
  const startAt=Math.ceil((s.now+5*60*MIN)/(30*MIN))*30*MIN;
  op(user,'booking.create',{storeId:'xingfu',serviceId:'neck',regionId:'home',techId:'lin',mode:'specified',genderPreference:'any',startAt,contactName:'CLIENT-PRIVATE-CONTACT',phone:'13800007771',healthConsent:true,identityVerified:true,adultConfirmed:true});
  const bookingId=s.bookings.at(-1).id;
  op(user,'booking.pay',{id:bookingId,outcome:'success'});op(tech,'booking.accept',{id:bookingId});op(user,'clock.advance',{minutes:(startAt-s.now)/MIN});op(tech,'booking.start',{id:bookingId});op(user,'clock.advance',{minutes:45});op(tech,'booking.finish',{id:bookingId,mode:'normal'});
  return {s:JSON.parse(JSON.stringify(s)),bookingId,storeActor,supportActor,financeActor,admin};
}
let servicePromise;
async function fixture({stage='accepted',decision='respond',groupFinal=false}={}){
  const f=structuredClone(await(servicePromise ||= createServiceFixture()));let n=0;
  f.op=(actor,type,p={})=>{let result;f.s=reduce(f.s,actor,type,{requestId:'penalty-shared-case-'+ ++n,reason:'隔离原处罚来源实际办理',...p},r=>result=r);return result;};
  f.op(user,'care.case-create',{bookingId:f.bookingId,category:'attitude',description:'CLIENT-PRIVATE-COMPLAINT',evidence:'CLIENT-PRIVATE-HEALTH-NOTE'});f.caseId=f.s.serviceCareCases.at(-1).id;
  f.c=()=>careRow(f.s,f.caseId);
  if(stage!=='new'){
    f.op(f.storeActor,'care.case-respond',{id:f.caseId,version:f.c().version,decision:groupFinal?'respond':decision,publicReply:'公开核实原一般问题',internalNote:'INTERNAL-CARE-FACTS',specialistAction:groupFinal?'none':'penalty'});
    if(groupFinal){f.op(user,'care.case-answer',{id:f.caseId,version:f.c().version,decision:'escalate',reason:'本人要求集团核实原事项'});f.op(f.supportActor,'care.case-respond',{id:f.caseId,version:f.c().version,decision,publicReply:'集团公开核实原一般问题',internalNote:'INTERNAL-GROUP-FACTS',specialistAction:'penalty'});}
    else if(stage==='accepted')f.op(user,'care.case-answer',{id:f.caseId,version:f.c().version,decision:'accept',reason:'本人接受原已核实处理结果'});
  }
  f.s=JSON.parse(JSON.stringify(f.s));return f;
}
function warningCandidate(f,actor=f.storeActor){return technicianPenaltyView(f.s,actor).sourceCases.find(c=>c.caseId===f.caseId);}
function warningFields(s,extra={}){return {reference:'ACTUAL-STORE-WARNING',occurredAt:localTime(s),reason:'原已核一般问题的公开警告依据',internalNote:'INTERNAL-WARNING-NOTE',...extra};}
function warningPayload(f,extra={}){const c=warningCandidate(f);assert.ok(c,'原已核投诉必须有本店候选');return {caseId:c.caseId,actionIndex:c.actionIndex,caseVersion:c.caseVersion,sourceToken:c.sourceToken,...warningFields(f.s),...extra};}
async function navigate(a,hash){a.location.hash=hash;await a.render();assert.deepEqual(a.errors,[]);}
async function refresh(a,s){a.authoritative(s);const event=new Event('storage');Object.defineProperty(event,'key',{value:KEY});for(const listener of a.window.listeners.get('storage')||[])await listener(event);assert.deepEqual(a.errors,[]);}
async function actualSubmit(a,type,fields={},choice='accept',beforeConfirm){
  const form=formFor(a,type);assert.ok(form,'实际共享页面缺少'+type+'：'+pageText(a));
  for(const [name,value] of Object.entries(fields)){const field=form.querySelector(`[name="${name}"]`);assert.ok(field,'实际控件缺少'+name);field.value=value;}
  const pending=a.dispatch('submit',form);await new Promise(setImmediate);
  const dialog=a.document.querySelector('[role="dialog"]');
  if(form.reportValidity()&&form.dataset.confirm){assert.ok(dialog,'实际管理确认弹窗必须出现');assert.match(dialog.textContent,/确认|核对/);beforeConfirm?.(a,form);await a.dispatch('click',dialog.querySelector(`[data-confirm-choice="${choice}"]`));}
  // Observe the actual submit handler's render/error result. An extra synthetic
  // hashchange would replace command feedback with a separate draft restore.
  await pending;return {form,payload:payloadFor(form),s:ledger(a),dialogShown:Boolean(dialog)};
}
async function warningViaApp(f){const a=await runtime(f.s,careRoute(f.storeActor,f.caseId),{initialActor:f.storeActor});const out=await actualSubmit(a,'penalty.warning-record',warningFields(f.s));assert.ok(penaltyRow(out.s),'真实warning submit未入档：'+toastText(a));return {a,...out};}
function originalBusiness(s){return JSON.parse(JSON.stringify({bookings:s.bookings,techs:s.techs,qualifications:s.techQualifications,income:s.techIncomeEntries,payouts:s.techIncomePayouts,differences:s.techIncomeDifferences,adjustments:s.techIncomeAdjustments,finance:s.serviceFinanceEntries,financeRecoveries:s.serviceFinanceRecoveries,commissions:s.serviceCommissions,withdrawals:s.servicePromotionWithdrawals,goods:s.goods}));}

test('未接受/未核实/拒绝原投诉不生成warning入口，原专项真实门控拒绝',async()=>{
  for(const options of [{stage:'new'},{stage:'pending'},{decision:'reject'},{groupFinal:true,decision:'reject'}]){
    const f=await fixture(options),a=await runtime(f.s,careRoute(f.storeActor,f.caseId),{initialActor:f.storeActor});assert.equal(formFor(a,'penalty.warning-record'),null);assert.equal(warningCandidate(f),undefined);
    assert.throws(()=>f.op(f.storeActor,'penalty.warning-record',{caseId:f.caseId,actionIndex:0,caseVersion:f.c().version,sourceToken:'sha256:'+'0'.repeat(64),...warningFields(f.s)}),/处罚来源|处罚专项|核实|接受|成立|原专项/);
    if(f.c().status==='execution_pending')assert.throws(()=>f.op(f.c().ownerScope==='group'?f.supportActor:f.storeActor,'care.case-close',{id:f.caseId,version:f.c().version,conclusion:'不能以结案备注代替警告'}),/处罚专项/);
    assert.equal(f.s.technicianPenalties.length,0);
  }
});

test('用户已接受→原case真实warning表单/弹窗→原reduce入档→原专项实际办结',async()=>{
  const f=await fixture(),before=originalBusiness(f.s),c=f.c(),a=await runtime(f.s,careRoute(f.storeActor,f.caseId),{initialActor:f.storeActor});
  const form=formFor(a,'penalty.warning-record');assert.ok(form);const p=payloadFor(form),candidate=warningCandidate(f);assert.deepEqual(p,{caseId:f.caseId,actionIndex:0,caseVersion:c.version,sourceToken:candidate.sourceToken});assert.equal(form.dataset.liveVersion,String(c.version));assert.match(p.sourceToken,/^sha256:[a-f0-9]{64}$/);
  assert.match(pageText(a),/待实际决定入档/);assert.equal(formFor(a,'care.case-close'),null);
  const out=await actualSubmit(a,'penalty.warning-record',warningFields(f.s)),row=penaltyRow(out.s);assert.ok(row,toastText(a));assert.equal(out.dialogShown,true);assert.equal(out.s.technicianPenalties.length,1);
  assert.equal(row.decision.level,'general');assert.equal(row.decision.action,'warning');assert.equal(row.decision.by.accountId,f.storeActor.accountId);assert.equal(row.decision.reference,'ACTUAL-STORE-WARNING');
  assert.equal(careRow(out.s,f.caseId).specialistActions[0].penaltyId,row.id);assert.equal(careRow(out.s,f.caseId).version,c.version+1);assert.equal(careRow(out.s,f.caseId).status,'execution_pending');assert.equal(technicianPenaltyCaseResolution(out.s,f.caseId,0).complete,true);assert.deepEqual(careClosureBlockers(out.s,f.caseId),[]);assert.deepEqual(originalBusiness(out.s),before);
  const request=out.s.technicianPenaltyRequests[0],replay=reduce(out.s,f.storeActor,'penalty.warning-record',{...out.payload,...warningFields(f.s),requestId:request.requestId});assert.equal(replay.technicianPenalties.length,1);assert.equal(careRow(replay,f.caseId).version,c.version+1);assert.equal(replay.technicianPenaltyRequests.length,1);
  await navigate(a,careRoute(f.storeActor,f.caseId));assert.match(pageText(a),/已按实际决定入档/);assert.equal(formFor(a,'penalty.warning-record'),null);assert.ok(formFor(a,'care.case-close'));
  const closed=await actualSubmit(a,'care.case-close',{conclusion:'原一般警告已实际入档，逐项核验后结案'});assert.equal(careRow(closed.s,f.caseId).status,'closed');assert.equal(technicianPenaltyCaseResolution(closed.s,f.caseId,0).complete,true);assert.equal(penaltyRow(closed.s).version,1);
  await navigate(a,penaltyRoute(f.storeActor,row.id));assert.match(pageText(a),/一般警告已入档/);assert.equal(formFor(a,'penalty.appeal'),null);assert.deepEqual(originalBusiness(closed.s).bookings,before.bookings);assert.deepEqual(closed.s.techQualifications,f.s.techQualifications);
});

test('集团实际最终核实原投诉仍由原门店警告，不让集团/财务冒充门店决定',async()=>{
  const f=await fixture({groupFinal:true});assert.equal(f.c().final,true);assert.equal(f.c().status,'execution_pending');const p=warningPayload(f);
  for(const actor of [f.supportActor,f.financeActor,{role:'group',job:'operations'}])assert.throws(()=>f.op(actor,'penalty.warning-record',p),/岗位|门店|无权/);
  const out=await warningViaApp(f);assert.equal(penaltyRow(out.s).decision.by.accountId,f.storeActor.accountId);assert.equal(penaltyRow(out.s).source.resolutionIndex,1);assert.equal(technicianPenaltyCaseResolution(out.s,f.caseId,0).complete,true);
  const closed=reduce(out.s,f.supportActor,'care.case-close',{id:f.caseId,version:careRow(out.s,f.caseId).version,requestId:'shared-group-final-close',conclusion:'集团核实原一般警告已入档'});assert.equal(careRow(closed,f.caseId).status,'closed');assert.equal(technicianPenaltyCaseResolution(closed,f.caseId,0).complete,true);
});

test('技师本人实际一次申诉→客服实际maintain/revoke，原care闭案和原金额/资格保持',async()=>{
  for(const decision of ['maintain','revoke']){
    const f=await fixture(),out=await warningViaApp(f),id=penaltyRow(out.s).id;
    let s=reduce(out.s,f.storeActor,'care.case-close',{id:f.caseId,version:careRow(out.s,f.caseId).version,requestId:'shared-before-appeal-close',conclusion:'已核真实警告入档'});const before=originalBusiness(s),originalDecision=structuredClone(penaltyRow(s).decision);
    const a=await runtime(s,personalRoute(id),{initialActor:tech}),appeal=formFor(a,'penalty.appeal');assert.ok(appeal);assert.doesNotMatch(pageText(a),/INTERNAL-|CLIENT-PRIVATE|13800007771|sourceFingerprint/);
    const sent=await actualSubmit(a,'penalty.appeal',{reason:'本人一次申诉的准确事实'});s=sent.s;assert.equal(penaltyRow(s).appeal.status,'pending');assert.equal(penaltyRow(s).version,2);assert.equal(penaltyRow(s).appeal.by.id,'lin');assert.equal(careRow(s,f.caseId).status,'closed');assert.equal(technicianPenaltyCaseResolution(s,f.caseId,0).complete,true);assert.equal(formFor(a,'penalty.appeal'),null);
    const task=penaltyTask(s,f.supportActor,id);assert.equal(task.status,'open');assert.deepEqual(task.commands,['penalty.appeal-review']);assert.equal(task.dueAt,null);assert.equal(penaltyTask(s,f.financeActor,id),undefined);
    const own=technicianPenaltyView(s,tech).penalties[0];assert.throws(()=>reduce(s,tech,'penalty.appeal',{id,version:own.version,sourceToken:own.sourceToken,requestId:'shared-second-appeal',reason:'不能第二次申诉'}),/一次/);
    const reviewApp=await runtime(s,penaltyRoute(f.supportActor,id),{initialActor:f.supportActor}),review=formFor(reviewApp,'penalty.appeal-review');assert.ok(review);assert.equal(review.querySelector('[name="decision"]').value,'');
    const untouched=ledger(reviewApp);await reviewApp.dispatch('submit',review);assert.equal(reviewApp.document.querySelector('[role="dialog"]'),null);assert.deepEqual(ledger(reviewApp),untouched);
    const result=await actualSubmit(reviewApp,'penalty.appeal-review',{decision,reference:'ACTUAL-GROUP-'+decision,occurredAt:localTime(s),reason:'集团已实际复核的公开依据',internalNote:'INTERNAL-REVIEW-'+decision});s=result.s;
    assert.equal(penaltyRow(s).appeal.status,decision==='maintain'?'maintained':'revoked');assert.equal(penaltyRow(s).appeal.review.by.accountId,f.supportActor.accountId);assert.deepEqual(penaltyRow(s).decision,originalDecision);assert.equal(penaltyRow(s).version,3);assert.equal(technicianPenaltyCaseResolution(s,f.caseId,0).complete,true);
    const done=penaltyTask(s,f.supportActor,id);assert.equal(done.status,'done');assert.deepEqual(done.commands,[]);assert.equal(done.dueAt,null);assert.deepEqual(originalBusiness(s),before);assert.equal(qualificationEligibility(s,'lin','neck').allowed,true);
    await refresh(a,s);assert.match(pageText(a),decision==='maintain'?/集团已维持警告/:/集团已撤回警告/);assert.doesNotMatch(pageText(a),/INTERNAL-|CLIENT-PRIVATE|13800007771|sourceFingerprint/);assert.equal(formFor(a,'penalty.appeal'),null);
    const req=s.technicianPenaltyRequests.at(-1),replayed=reduce(s,f.supportActor,'penalty.appeal-review',{...result.payload,decision,reference:'ACTUAL-GROUP-'+decision,occurredAt:localTime(s),reason:'集团已实际复核的公开依据',internalNote:'INTERNAL-REVIEW-'+decision,requestId:req.requestId});assert.equal(penaltyRow(replayed).version,3);assert.equal(replayed.technicianPenaltyRequests.length,3);
  }
});

test('原共享确认返回修改不提交，刷新保留草稿；实际接收后稳定请求不会重复入档',async()=>{
  const f=await fixture(),a=await runtime(f.s,careRoute(f.storeActor,f.caseId),{initialActor:f.storeActor}),before=ledger(a);
  const cancelled=await actualSubmit(a,'penalty.warning-record',warningFields(f.s),'cancel');assert.equal(cancelled.dialogShown,true);assert.deepEqual(ledger(a),before);assert.equal(a.document.querySelector('[role="dialog"]'),null);assert.equal(formFor(a,'penalty.warning-record').querySelector('[name="reference"]').value,'ACTUAL-STORE-WARNING');
  const out=await actualSubmit(a,'penalty.warning-record',{});assert.equal(out.s.technicianPenalties.length,1);assert.equal(out.s.technicianPenaltyRequests.length,1);assert.equal(penaltyRow(out.s).decision.reason,warningFields(f.s).reason);assert.equal(careRow(out.s,f.caseId).version,careRow(before,f.caseId).version+1);
});

test('旧case版本/当前源串号/伪completed不能越过真实专项或重复warning',async()=>{
  const f=await fixture(),a=await runtime(f.s,careRoute(f.storeActor,f.caseId),{initialActor:f.storeActor}),old=formFor(a,'penalty.warning-record');
  for(const [name,value] of Object.entries(warningFields(f.s)))old.querySelector(`[name="${name}"]`).value=value;
  f.op(user,'care.case-statement',{id:f.caseId,version:f.c().version,text:'本人补充准确事实，旧版本必须刷新'});const changed=structuredClone(f.s);a.authoritative(changed);
  await actualSubmit(a,'penalty.warning-record',{});assert.match(toastText(a),/版本|变化/);assert.deepEqual(ledger(a),changed);assert.equal(changed.technicianPenalties.length,0);
  const out=await warningViaApp(f),s=out.s,id=penaltyRow(s).id;
  for(const mutate of [state=>careRow(state,f.caseId).specialistActions[0].penaltyId='WRONG',state=>penaltyRow(state).source.caseId='WRONG',state=>careRow(state,f.caseId).description='SOURCE-REPLACED',state=>{careRow(state,f.caseId).specialistActions[0].status='completed';state.technicianPenalties=[];}]){
    const broken=structuredClone(s);mutate(broken);const snap=JSON.stringify(broken);assert.equal(technicianPenaltyCaseResolution(broken,f.caseId,0).complete,false);assert.ok(careClosureBlockers(broken,f.caseId).length);assert.throws(()=>reduce(broken,f.storeActor,'care.case-close',{id:f.caseId,version:careRow(broken,f.caseId).version,requestId:'broken-source-close',conclusion:'不能用假专项执行关闭'}),/处罚专项/);assert.equal(JSON.stringify(broken),snap);
  }
  const own=technicianPenaltyView(s,tech).penalties.find(r=>r.id===id),appealed=reduce(s,tech,'penalty.appeal',{id,version:own.version,sourceToken:own.sourceToken,requestId:'fresh-appeal-before-stale',reason:'本人一次申诉'});
  assert.throws(()=>reduce(appealed,tech,'penalty.appeal',{id,version:own.version,sourceToken:own.sourceToken,requestId:'old-appeal-version',reason:'旧版本重复'}),/版本/);assert.equal(penaltyRow(appealed).version,2);
});

test('真实当前撤权在确认弹窗期间阻断旧表单和旧请求，其他人/岗位深链不露原记录',async()=>{
  const f=await fixture(),a=await runtime(f.s,careRoute(f.storeActor,f.caseId),{initialActor:f.storeActor});let revoked;
  await actualSubmit(a,'penalty.warning-record',warningFields(f.s),'accept',()=>{const account=f.s.staffAccounts.find(a=>a.id===f.storeActor.accountId);revoked=reduce(f.s,f.admin,'account.revoke',{id:account.id,version:account.version,grantId:f.storeActor.grantId,requestId:'real-revoke-in-dialog',reason:'原账号管理员明确撤回本店工作授权'});a.authoritative(revoked);});
  assert.match(toastText(a),/失效|无权/);assert.deepEqual(ledger(a),revoked);assert.equal(ledger(a).technicianPenalties.length,0);
  // Deliver the other document's native storage notification after observing
  // command rejection, so the app reloads the authoritative revoked source.
  await refresh(a,revoked);assert.match(pageText(a),/会话已失效/);
  const g=await fixture(),out=await warningViaApp(g),row=penaltyRow(out.s),req=out.s.technicianPenaltyRequests[0],account=out.s.staffAccounts.find(a=>a.id===g.storeActor.accountId),ended=reduce(out.s,g.admin,'account.revoke',{id:account.id,version:account.version,grantId:g.storeActor.grantId,requestId:'real-revoke-after-warning',reason:'原账号管理员明确撤回本店工作授权'});
  assert.throws(()=>reduce(ended,g.storeActor,'penalty.warning-record',{...out.payload,...warningFields(g.s),requestId:req.requestId}),/失效|无权/);
  const publicAppeal=technicianPenaltyView(out.s,tech).penalties[0];
  for(const actor of [{role:'user',userId:'u1'},{role:'user',userId:'u2'},{role:'tech',techId:'ma'},{role:'store',storeId:'silver'},g.financeActor,{role:'group',job:'operations'}]){
    const page=await runtime(out.s,penaltyRoute(actor,row.id),{initialActor:actor});assert.equal(formFor(page,'penalty.appeal'),null);assert.equal(formFor(page,'penalty.appeal-review'),null);assert.doesNotMatch(pageText(page),/ACTUAL-STORE-WARNING|INTERNAL-WARNING-NOTE/);
    assert.throws(()=>reduce(out.s,actor,'penalty.appeal',{id:row.id,version:row.version,sourceToken:publicAppeal.sourceToken,requestId:'wrong-person-appeal',reason:'不能冒用技师申诉'}),/无权|岗位|本人/);
  }
});

test('真实warning表单无默认处罚执行字段，恶意金额/期限/等级载荷全拒且原业务保持',async()=>{
  const f=await fixture(),a=await runtime(f.s,careRoute(f.storeActor,f.caseId),{initialActor:f.storeActor}),form=formFor(a,'penalty.warning-record');
  for(const name of ['durationDays','fineCents','amountCents','startAt','endAt','level','action'])assert.equal(form.querySelector(`[name="${name}"]`),null);
  const payload=warningPayload(f),before=JSON.stringify(f.s);
  for(const extra of [{durationDays:7},{fineCents:1000},{amountCents:0},{startAt:f.s.now},{endAt:f.s.now+7*1440*MIN},{level:'severe'},{action:'suspend'}])assert.throws(()=>f.op(f.storeActor,'penalty.warning-record',{...payload,...extra}),/政策尚未明确|伪执行/);
  assert.equal(JSON.stringify(f.s),before);assert.equal(qualificationEligibility(f.s,'lin','neck').allowed,true);assert.equal(f.s.technicianPenalties.length,0);
});
let executable = appSource;
for (const declaration of [...importDeclarations].reverse()) {
  executable = executable.slice(0, declaration.index) + executable.slice(declaration.index + declaration[0].length);
}
const appScript = new Script('(async () => {\n' + executable + '\n})()', { filename: appUrl.pathname });

class Storage {
  get length() { return Object.keys(this).length; }
  key(index) { return Object.keys(this)[index] ?? null; }
  constructor(entries = {}) {
    Object.defineProperty(this, 'writes', { value: [], writable: true });
    for (const [key, value] of Object.entries(entries)) this.setItem(key, value);
    this.writes.length = 0;
  }
  getItem(key) { return Object.hasOwn(this, key) ? this[key] : null; }
  setItem(key, value) {
    Object.defineProperty(this, key, { value: String(value), writable: true, configurable: true, enumerable: true });
    this.writes.push({ method: 'set', key, value: String(value) });
  }
  removeItem(key) { delete this[key]; this.writes.push({ method: 'remove', key }); }
}

const dataAttribute = name => 'data-' + name.replace(/[A-Z]/g, c => '-' + c.toLowerCase());
const decode = value => value.replace(/&quot;|&#39;|&lt;|&gt;|&amp;/g, v => ({ '&quot;': '"', '&#39;': "'", '&lt;': '<', '&gt;': '>', '&amp;': '&' })[v]);
function simpleMatch(node, selector) {
  if (node.tagName.startsWith('#')) return false;
  const head = selector.replace(/\[[^\]]*\]/g, '');
  const tag = /^[A-Za-z][\w-]*/.exec(head)?.[0];
  if (tag && node.tagName.toLowerCase() !== tag.toLowerCase()) return false;
  for (const [, id] of head.matchAll(/#([\w-]+)/g)) if (node.id !== id) return false;
  for (const [, name] of head.matchAll(/\.([\w-]+)/g)) if (!node.className.split(/\s+/).includes(name)) return false;
  for (const [, name, operator, quoted, plain] of selector.matchAll(/\[([^\s=\]^]+)(?:(\^?=)(?:"([^"]*)"|([^\]]*)))?\]/g)) {
    const actual = node.getAttribute(name), expected = quoted ?? plain;
    if (actual == null || operator === '=' && actual !== expected || operator === '^=' && !actual.startsWith(expected)) return false;
  }
  return true;
}
function matches(node, selector) {
  return selector.split(',').some(part => {
    const tokens = part.trim().replace(/>/g, ' > ').split(/\s+/);
    let current = node;
    if (!simpleMatch(current, tokens.pop())) return false;
    while (tokens.length) {
      const token = tokens.pop();
      if (token === '>') {
        current = current.parentNode;
        if (!current || !simpleMatch(current, tokens.pop())) return false;
      } else {
        do { current = current.parentNode; } while (current && !simpleMatch(current, token));
        if (!current) return false;
      }
    }
    return true;
  });
}

class Node {
  constructor(tag, document) {
    this.tagName = tag.toUpperCase(); this.ownerDocument = document; this.parentNode = null;
    this.children = []; this.attributes = new Map(); this.listeners = new Map(); this._text = '';
    this.dataset = new Proxy({}, {
      get: (_, name) => this.getAttribute(dataAttribute(String(name))) ?? undefined,
      set: (_, name, value) => { this.setAttribute(dataAttribute(String(name)), value); return true; },
    });
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  hasAttribute(name) { return this.attributes.has(name); }
  removeAttribute(name) { this.attributes.delete(name); }
  get id() { return this.getAttribute('id') || ''; }
  get className() { return this.getAttribute('class') || ''; }
  set className(value) { this.setAttribute('class', value); }
  get classList() { return { toggle: (name, enabled) => {
    const names = new Set(this.className.split(/\s+/).filter(Boolean));
    if (enabled ?? !names.has(name)) names.add(name); else names.delete(name);
    this.className = [...names].join(' ');
  } }; }
  get name() { return this.getAttribute('name') || ''; }
  get type() { return this.getAttribute('type') || (this.tagName === 'SELECT' ? 'select-one' : 'text'); }
  get value() {
    if (this._value !== undefined) return this._value;
    if (this.tagName === 'SELECT') return this.selectedOptions[0]?.getAttribute('value') || '';
    return this.getAttribute('value') || (this.tagName === 'TEXTAREA' ? this.textContent : '');
  }
  set value(value) { this._value = String(value); }
  get checked() { return this.hasAttribute('checked'); }
  set checked(value) { if (value) this.setAttribute('checked', ''); else this.removeAttribute('checked'); }
  get disabled() { return this.hasAttribute('disabled'); }
  set disabled(value) { if (value) this.setAttribute('disabled', ''); else this.removeAttribute('disabled'); }
  get required() { return this.hasAttribute('required'); }
  set required(value) { if (value) this.setAttribute('required', ''); else this.removeAttribute('required'); }
  get hidden() { return this.hasAttribute('hidden'); }
  set hidden(value) { if (value) this.setAttribute('hidden', ''); else this.removeAttribute('hidden'); }
  get selectedOptions() { const options = this.querySelectorAll('option'); const selected = options.filter(n => n.hasAttribute('selected')); return selected.length ? selected : options.slice(0, 1); }
  get elements() { return { namedItem: name => this.querySelector('[name="' + name + '"]') }; }
  reportValidity() {
    return this.querySelectorAll('[name]').every(field => {
      if (field.disabled) return true;
      if (field.required && (['checkbox', 'radio'].includes(field.type) ? !field.checked : field.value === '')) return false;
      if (field.type !== 'number' || field.value === '') return true;
      const value = Number(field.value);
      return Number.isFinite(value) && (!field.hasAttribute('min') || value >= Number(field.getAttribute('min'))) && (!field.hasAttribute('max') || value <= Number(field.getAttribute('max')));
    });
  }
  get isConnected() { let root = this; while (root.parentNode) root = root.parentNode; return root === this.ownerDocument; }
  append(...nodes) { for (const node of nodes) { node.remove(); node.parentNode = this; this.children.push(node); } }
  remove() { if (this.parentNode) this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1); this.parentNode = null; }
  replaceChildren(...nodes) { for (const child of [...this.children]) child.remove(); this._text = ''; this.append(...nodes); }
  get textContent() { return this._text + this.children.map(n => n.textContent).join(''); }
  set textContent(value) { this.replaceChildren(); this._text = String(value); }
  set innerHTML(value) { this.replaceChildren(); parseHtml(String(value), this); }
  insertAdjacentHTML(position, value) { if (position !== 'beforeend') throw new Error('DOM subset supports beforeend only'); parseHtml(String(value), this); }
  matches(selector) { return matches(this, selector); }
  closest(selector) { let node = this; while (node) { if (node.matches(selector)) return node; node = node.parentNode; } return null; }
  querySelectorAll(selector) {
    const found = [];
    for (const child of this.children) { if (child.matches(selector)) found.push(child); found.push(...child.querySelectorAll(selector)); }
    return found;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  addEventListener(type, listener) { const list = this.listeners.get(type) || []; list.push(listener); this.listeners.set(type, list); }
  removeEventListener(type, listener) { this.listeners.set(type, (this.listeners.get(type) || []).filter(x => x !== listener)); }
  async emit(type, target = this) {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'target', { value: target });
    // Preserve the actual target while bubbling to the document's app listeners.
    for (let node = target; node; node = node.parentNode) for (const listener of node.listeners.get(type) || []) await listener(event);
    return event;
  }
  focus() { this.ownerDocument.activeElement = this; }
}

function parseHtml(html, root) {
  const stack = [root];
  for (const token of html.matchAll(/<!--[\s\S]*?-->|<\/?[A-Za-z][^>]*>|[^<]+/g)) {
    const text = token[0];
    if (text.startsWith('<!--')) continue;
    if (text.startsWith('</')) { if (stack.length > 1) stack.pop(); continue; }
    if (text.startsWith('<')) {
      const tag = /^<([\w-]+)/.exec(text)[1], node = root.ownerDocument.createElement(tag);
      const attrs = text.slice(tag.length + 1).replace(/\/?\s*>$/, '');
      for (const [, name, double, single, plain] of attrs.matchAll(/([^\s=<>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>]+)))?/g)) node.setAttribute(name, decode(double ?? single ?? plain ?? ''));
      stack.at(-1).append(node);
      if (!['input', 'img', 'br', 'hr', 'meta', 'link', 'source'].includes(tag.toLowerCase()) && !text.endsWith('/>')) stack.push(node);
    } else {
      const node = root.ownerDocument.createElement('#text'); node._text = decode(text); stack.at(-1).append(node);
    }
  }
}
class Document extends Node {
  constructor() {
    super('#document'); this.ownerDocument = this; this.body = this.createElement('body'); this.append(this.body);
    this.body.innerHTML = '<div id="app"></div><div id="toast"></div>';
  }
  createElement(tag) { return new Node(tag, this); }
  getElementById(id) { return this.querySelector('#' + id); }
}

// Native Node FormData cannot consume a DOM form. This adapter provides the
// successful-controls iteration used by the unchanged app, without scope logic.
class FormDataSubset {
  constructor(form) {
    this.values = [];
    for (const field of form?.querySelectorAll('[name]') || []) {
      if (!['INPUT', 'SELECT', 'TEXTAREA'].includes(field.tagName) || !field.name || field.disabled || ['submit', 'button', 'reset'].includes(field.type)) continue;
      if (['checkbox', 'radio'].includes(field.type) && !field.checked) continue;
      if (field.type === 'file') { for (const file of field.files || []) this.values.push([field.name, file]); continue; }
      if (field.tagName === 'SELECT' && field.hasAttribute('multiple')) {
        for (const option of field.querySelectorAll('option').filter(x => x.hasAttribute('selected'))) this.values.push([field.name, option.getAttribute('value') ?? option.textContent]);
      } else this.values.push([field.name, field.value]);
    }
  }
  *entries() { yield* this.values; }
  [Symbol.iterator]() { return this.entries(); }
  getAll(name) { return this.values.filter(([key]) => key === name).map(([, value]) => value); }
}

async function runtime(ledger = seed(), hash = '#/user/home', { initialActor, apiOverrides = {} } = {}) {
  const document = new Document(), window = new Node('#window', document);
  window.scrollTo = () => {};
  const localStorage = new Storage({ [KEY]: JSON.stringify(ledger) });
  const sessionStorage = new Storage({ [RESULT]: 'success' });
  if(initialActor)sessionStorage.setItem(KEY+'-actor',JSON.stringify(initialActor));
  let currentHash=hash;
  const location = {get hash(){return currentHash;},set hash(value){currentHash=value.startsWith('#')?value:'#'+value;},origin:'http://127.0.0.1:4204',pathname:'/'};
  const history = { state: null, replaceState(value, _title, url) { this.state = value; if (url?.includes('#')) location.hash = url.slice(url.indexOf('#')); } };
  const errors = [], timers = new Map(); let nextTimer = 0;
  const context = createContext({
    ...imported,
    // Original module default parameters use their own realm: pass this DOM explicitly.
    hydrateMedia: () => imported.hydrateMedia(document),
    ...apiOverrides,
    document, window, localStorage, sessionStorage, location, history,
    navigator: {}, crypto: webcrypto, URL, Blob, Event, FormData: FormDataSubset, TextEncoder, TextDecoder, structuredClone,
    setTimeout: callback => { timers.set(++nextTimer, callback); return nextTimer; }, clearTimeout: id => timers.delete(id),
    console: { error: error => errors.push(error), log() {}, warn: message => errors.push(message) },
  });
  await appScript.runInContext(context);
  assert.deepEqual(errors, [], 'initial render must execute without swallowed runtime errors');
  return {
    document, window, sessionStorage, localStorage, errors, location,
    authoritative(next) { localStorage.setItem(KEY, JSON.stringify(next)); },
    resetWrites() { localStorage.writes.length = 0; sessionStorage.writes.length = 0; },
    async dispatch(type, target) {
      assert.ok(target.isConnected, 'event starts on a connected old page node');
      const event = await document.emit(type, target);
      await new Promise(setImmediate);
      return event;
    },
    async render() { return window.emit('hashchange', window); },
  };
}


