import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { workTaskView } from './work-tasks.mjs';
import { workEscalationView } from './work-escalation.mjs';
import { createTaskReturnContext, taskReturnTarget } from './task-navigation.mjs';
import { workEscalationUiView } from './work-escalation-ui.mjs';
import { resolveAccountActor } from './staff-accounts.mjs';

// Reuse the existing actual-reduce/real-Blob fixtures. Only fixture exports and
// relative module URLs are adapted; no business state machine is mirrored here.
// These are runtime/domain units, not a browser or production-channel acceptance.
async function fixtures(path,names){const url=new URL(path,import.meta.url);let body=readFileSync(url,'utf8').split("test('")[0];body=body.replace(/from '(\.\/[^']+)'/g,(_,p)=>`from '${new URL(p,url).href}'`);return import('data:text/javascript,'+encodeURIComponent(body+`\nexport {${names.join(',')}};`));}
const {harness:extraHarness,g:groupFinance}=await fixtures('./service-finance-extras-integration.test.mjs',['harness','g']);
const {harness:promotionHarness,finance,support,manager,personal}=await fixtures('./service-promotion-integration.test.mjs',['harness','finance','support','manager','personal']);
const current=(h,a,category)=>workTaskView(h.s,a).tasks.find(t=>t.category===category);
const rows=(h,a)=>workEscalationView(h.s,a).rows;
async function raise(h,a,task,reason='C11真实阶段协调'){
  const r=rows(h,a).find(r=>r.task.id===task.id&&!r.historicalTaskId),p={id:task.id,sourceToken:task.sourceToken,ownerToken:r.ownerToken,assignmentVersion:r.assignmentVersion,version:r.version,cause:'manual-review',accountId:a.accountId,grantId:a.grantId,reason};
  await h.run('work-escalation.raise',p,a);return {payload:p,record:structuredClone(h.s.workEscalations.find(r=>r.id===task.id))};
}
async function shortage(){const h=extraHarness();await h.shortage();const actor=await h.staff('store-finance','xingfu'),task=current(h,actor,'service-extra-shortage'),raised=await raise(h,actor,task);await h.run('service-extra.recharge',{id:h.issue.id,amountCents:10000,...h.proof()},actor);return{h,actor,task,...raised};}
const ui={esc:x=>String(x??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'),date:x=>String(x??''),button:(label,command,p)=>`<button data-command="${command}" data-payload='${JSON.stringify(p)}'>${label}</button>`,link:(label,path)=>`<a href="#${path}">${label}</a>`,empty:label=>`<section>${label}</section>`};

test('actual shortage recharge keeps the old-stage escalation visible with a fresh real source/return and no old actions',async()=>{
  const {h,actor,task,record}=await shortage(),before=structuredClone(h.s),currentTask=current(h,actor,'service-extra-shortage'),r=rows(h,actor).find(r=>r.record?.id===task.id);
  assert.ok(r,'Persisted old-phase record must remain visible');assert.equal(r.historicalTaskId,task.id);assert.equal(r.task.id,currentTask.id);assert.notEqual(r.task.id,task.id);assert.equal(r.status,'source-changed');assert.equal(r.canRaise,false);assert.equal(r.canDecline,false);assert.equal(r.canTakeover,false);assert.deepEqual(r.record,record);
  const c=createTaskReturnContext(h.s,actor,{taskKey:r.task.id,task:r.task,listHash:'/store/work-escalations',token:'C11-stage-history'});assert.equal(taskReturnTarget(h.s,actor,c,c.targetPath),'/store/work-escalations');
  assert.equal(workEscalationView(h.s,actor).counts.changed,1);const html=workEscalationUiView(h.s,actor,['work-escalations'],ui);assert.match(html,/C11真实阶段协调/);assert.ok(html.includes(currentTask.id));assert.doesNotMatch(html,/data-command="work-escalation\./);assert.deepEqual(h.s,before);
});

test('actual original refund completion reads the old escalation as source-done and never rewrites money/history',async()=>{
  const {h,actor,task,record}=await shortage();await h.run('booking.refund-pay',{id:h.b.id,refundId:h.b.refunds[0].id,outcome:'success'},groupFinance);
  const before=structuredClone(h.s),r=rows(h,actor).find(r=>r.record?.id===task.id);assert.ok(r);assert.equal(r.status,'source-done');assert.equal(r.task.status,'done');assert.deepEqual(r.record,record);assert.equal(workEscalationView(h.s,actor).counts.sourceDone,1);assert.equal(h.b.payment.refundedCents,29800);assert.equal(h.s.serviceExtraRecoveries.length,0);assert.deepEqual(h.s,before);
});

test('each real stage keeps its separate request while new coordination requires a fresh original payload',async()=>{
  const {h,actor,task,record}=await shortage(),next=current(h,actor,'service-extra-shortage');await raise(h,actor,next,'C11新阶段本人重新核对');
  assert.equal(h.s.workEscalations.length,2);assert.deepEqual(h.s.workEscalations.find(r=>r.id===task.id),record);assert.equal(rows(h,actor).filter(r=>r.record).length,2);
  await h.run('booking.refund-pay',{id:h.b.id,refundId:h.b.refunds[0].id,outcome:'success'},groupFinance);const visible=rows(h,actor).filter(r=>r.record);assert.equal(visible.length,2);assert.ok(visible.every(r=>r.status==='source-done'&&!r.canTakeover&&!r.canRaise));assert.equal(new Set(visible.map(r=>r.record.id)).size,2);
});

test('old stage commands cannot replay or take over the new phase',async()=>{
  const {h,actor,payload}=await shortage(),before=structuredClone(h.s);
  await assert.rejects(()=>h.run('work-escalation.raise',payload,actor),/原事项不存在|更新|办理权/);await assert.rejects(()=>h.run('work-escalation.takeover',payload,actor),/原事项不存在|更新|办理权/);assert.deepEqual(h.s,before);
});

test('foreign store and revoked actual session never regain a historical source from its snapshot',async()=>{
  const {h,actor}=await shortage(),foreign=await h.staff('store-finance','silver');assert.equal(rows(h,foreign).filter(r=>r.record).length,0);
  const entered=await h.run('account.enter',{accountId:'DEMO-ADMIN',grantId:'DEMO-ADMIN-GRANT'},{role:'user',userId:'u1'}),admin=resolveAccountActor(h.s,entered);await h.run('account.status',{id:actor.accountId,version:h.s.staffAccounts.find(r=>r.id===actor.accountId).version,enabled:false,reason:'C11实际撤权'},admin);
  assert.throws(()=>workEscalationView(h.s,actor),/失效|授权/);
});

test('missing/crossed/duplicated current sources and malformed old snapshots cannot manufacture history authority',async()=>{
  const {h,actor,task}=await shortage();
  for(const damage of [s=>{s.workEscalations[0].sourceSnapshot.sourceId='missing';},s=>{s.workEscalations[0].sourceSnapshot.taskId='another-task';},s=>{s.workEscalations.push(structuredClone(s.workEscalations[0]));},s=>{s.serviceRefundShortages[0].bookingId='missing';},s=>{s.serviceRefundShortages[0].storeId='silver';},s=>{const booking=s.bookings.find(b=>b.id===s.serviceRefundShortages[0].bookingId);s.bookings.push({...structuredClone(booking),refunds:[],assistance:[],disputes:[],round:null,rounds:[]});}]){const s=structuredClone(h.s);damage(s);assert.equal(workEscalationView(s,actor).rows.filter(r=>r.record?.id===task.id).length,0);}
});

test('actual personal withdrawal processing and success preserve original-stage coordination without adding attempts or widening support',async()=>{
  const h=promotionHarness();await h.setup();const id=await h.earning();await h.settle(id);await h.withdraw(h.commission(id).commissionCents);const actor=await h.staff('finance'),task=current(h,actor,'service-promotion-withdrawal');const {record}=await raise(h,actor,task,'C11原本人提现协调');
  await h.payPersonal('processing');const original=structuredClone(h.withdrawal().execution),processing=rows(h,actor).find(r=>r.record?.id===task.id);assert.ok(processing);assert.equal(processing.status,'source-changed');assert.deepEqual(processing.record,record);assert.equal(rows(h,support).filter(r=>r.record).length,0);
  await h.queryPersonal();const r=rows(h,actor).find(r=>r.record?.id===task.id);assert.ok(r);assert.equal(r.status,'source-done');assert.equal(h.withdrawal().execution.id,original.id);assert.equal(h.withdrawal().execution.requestNo,original.requestNo);assert.equal(h.withdrawal().execution.attempts,original.attempts);assert.equal(h.s.servicePromotionWithdrawals.length,1);assert.deepEqual(h.s.workEscalations[0],record);
  const c=createTaskReturnContext(h.s,actor,{taskKey:r.task.id,task:r.task,listHash:'/group/work-escalations',token:'C11-original-withdrawal'});assert.equal(taskReturnTarget(h.s,actor,c,c.targetPath),c.listHash);
});

test('actual invitation/acceptance and support identity verification preserve the completed original source, including later disable',async()=>{
  const h=promotionHarness();await h.run('service-promotion.agreement-publish',{promoterType:'store-promoter',title:'C11原实名协议',body:'原邀请及实名来源单元验收',effectiveAt:h.s.now,...h.proof()},support);await h.run('service-promotion.invite',{userId:'u2',promoterType:'store-promoter',expiresAt:h.s.now+86400000,reason:'原本人真实邀请'},manager);
  const invite=h.s.servicePromotionInvites.at(-1);await h.run('service-promotion.invite-confirm',{id:invite.id,decision:'accept',agreementAccepted:true,agreementId:invite.agreementSnapshot.id,reason:'本人接受原协议'},personal);
  const actor=await h.staff('support'),task=current(h,actor,'service-promotion-identity');assert.equal(task.status,'open');const {record}=await raise(h,actor,task,'C11本人实名待核协调');
  await h.run('service-promotion.identity-review',{id:h.promoter().id,decision:'verified',...h.proof('C11-PRIVATE-IDENTITY-REFERENCE')},actor);
  for(const expected of ['active','disabled']){
    assert.equal(h.promoter().status,expected);const actual=current(h,actor,'service-promotion-identity'),r=rows(h,actor).find(r=>r.record?.id===task.id);assert.ok(actual);assert.equal(actual.status,'done');assert.deepEqual(actual.commands,[]);assert.ok(r);assert.equal(r.status,'source-done');assert.deepEqual(r.record,record);assert.equal(r.canTakeover,false);assert.equal(rows(h,finance).filter(r=>r.record).length,0);assert.doesNotMatch(JSON.stringify(actual),/C11-PRIVATE-IDENTITY-REFERENCE|evidenceRefs|\.pdf/);
    const c=createTaskReturnContext(h.s,actor,{taskKey:r.task.id,task:r.task,listHash:'/group/work-escalations',token:'C11-original-identity'});assert.equal(taskReturnTarget(h.s,actor,c,c.targetPath),c.listHash);
    if(expected==='active')await h.run('service-promotion.disable',{id:h.promoter().id,kind:'exit',reason:'按原管理命令解除推广资格'},manager);
  }
});
