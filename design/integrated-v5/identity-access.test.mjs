import test from 'node:test';
import assert from 'node:assert/strict';
import {bookingSeed,bookingCommand,bookingView} from './booking.mjs';
import {upgradeAccounts,accountCommand,resolveAccountActor,assertAccountCommand} from './staff-accounts.mjs';
import {captureBookingHandoff,handoffCommand,handoffView} from './service-handoff.mjs';
import {serviceReviewCommand} from './service-reviews.mjs';
import {careCommand} from './service-care.mjs';
import {qualificationCommand} from './tech-qualification.mjs';
import {serviceFinanceCommand} from './service-finance.mjs';
import {techIncomeCommand} from './tech-income.mjs';
import {invoiceCommand} from './service-invoices.mjs';
import {upgradeManagement,managementCommand,stockMove} from './management.mjs';
import {busyCommand} from './busy.mjs';
import {handoffUiView} from './service-handoff-ui.mjs';
import {careView as careUiView} from './care-ui.mjs';
import {qualificationUiView} from './qualification-ui.mjs';
import {reviewUiView} from './review-ui.mjs';
import {financeView} from './finance-ui.mjs';
import {seed as engineSeed,reduce} from './engine.mjs';
import {staffView} from './staff.mjs';
const NOW=Date.parse('2026-10-03T10:00:00+08:00'),HOUR=3600000,user={role:'user',userId:'u1'};
let sequence=0;
const ctx=s=>({id:p=>p+(++s.seq),fail:m=>{throw Error(m)},log:(row,text)=>s.logs.push({id:row.id,text})});
function seed(){const s={...bookingSeed(),seq:0,now:NOW,users:[{id:'u1'}],skus:[],goods:[],logs:[],bookings:[{id:'B1',userId:'u1',storeId:'xingfu',techId:'lin',serviceId:'relax',status:'done',startedAt:NOW-2*HOUR,completedAt:NOW-HOUR,phone:'13812345678',contactName:'预约人',duration:60,extensions:[],refunds:[],events:[],payment:{id:'P1',status:'success',amountCents:29800,refundedCents:0}}]};upgradeManagement(s);upgradeAccounts(s);return s;}
function staff(s,job,name='员工甲',storeId='xingfu') {
  const command=(a,t,p)=>accountCommand(s,a,t,{requestId:'account'+(++sequence),...p},ctx(s)), admin=command({role:'group'},'account.enter',{accountId:'DEMO-ADMIN',grantId:'DEMO-ADMIN-GRANT'});
  let account=command(admin,'account.create',{name,reason:'测试员工'});account=command(admin,'account.grant',{id:account.id,version:account.version,job,...job.startsWith('store-')?{storeId}:{},reason:'授予测试岗位'});
  const enter=()=>resolveAccountActor(s,command({role:'group'},'account.enter',{accountId:account.id,grantId:account.grants[0].id}));return {actor:enter(),enter};
}
const commands={'handoff.':handoffCommand,'review.':serviceReviewCommand,'care.':careCommand,'qualification.':qualificationCommand,'finance.':serviceFinanceCommand,'tech-income.':techIncomeCommand,'invoice.':invoiceCommand,'manage.':managementCommand};
function command(s,raw,type,p={}){const a=resolveAccountActor(s,raw);assertAccountCommand(a,type);const fn=Object.entries(commands).find(([prefix])=>type.startsWith(prefix))?.[1] || (type.startsWith('booking.busy-')?busyCommand:bookingCommand);return fn(s,a,type,{requestId:'domain'+(++sequence),...p},ctx(s));}
function handoffFixture(){const s=seed();captureBookingHandoff(s,user,s.bookings[0],{recipientId:'visit',recipientKind:'self',recipientName:'本人',recipientRelationship:'本人',recipientConfirmed:true,attention:'当次事项',preference:'当次偏好'},ctx(s));return s;}
const note=(s,a,p={})=>command(s,a,'handoff.note',{bookingId:'B1',version:s.serviceHandoffs[0].version,observation:'本次客观事实',nextAdvice:'下次重新确认',occurredAt:NOW-HOUR,reason:'记录依据',...p});
function identity(value,a){assert.equal(value.accountId,a.accountId);assert.equal(value.accountName,a.accountName);assert.equal(value.grantId,a.grantId);assert.equal(value.sessionId,undefined);}

test('同岗同店不同实际员工不能更正他人交接；同员工不同会话可更正并保留原文',()=>{
  const s=handoffFixture(),a=staff(s,'store-manager','主管甲'),b=staff(s,'store-manager','主管乙');note(s,a.actor);const original=s.serviceHandoffs[0].notes[0];identity(original.by,a.actor);
  assert.equal(handoffView(s,b.actor,'B1').notes[0].canCorrect,false);assert.throws(()=>note(s,b.actor,{correctionOf:original.id,observation:'冒改'}),/原记录作者/);assert.equal(original.replacedBy,null);
  const otherSession=a.enter();assert.notEqual(otherSession.sessionId,a.actor.sessionId);assert.equal(handoffView(s,otherSession,'B1').notes[0].canCorrect,true);
  note(s,otherSession,{correctionOf:original.id,observation:'经核对更正的事实'});assert.equal(s.serviceHandoffs[0].notes.length,2);assert.equal(original.observation,'本次客观事实');assert.equal(original.replacedBy,s.serviceHandoffs[0].notes[1].id);identity(s.serviceHandoffs[0].history.at(-1).by,a.actor);
});
test('账号员工不能冒认旧自由演示岗位作者，旧记录与旧模式作者判断继续兼容',()=>{
  const s=handoffFixture(),legacy={role:'store',storeId:'xingfu'};note(s,legacy);const original=s.serviceHandoffs[0].notes[0];assert.deepEqual(original.by,{role:'store',id:'xingfu',job:null});
  const a=staff(s,'store-manager');assert.throws(()=>note(s,a.actor,{correctionOf:original.id}),/原记录作者/);note(s,legacy,{correctionOf:original.id,observation:'旧演示身份更正'});assert.equal(s.serviceHandoffs[0].notes.length,2);
});
test('交接请求按实际员工隔离，同员工新会话的原请求幂等且不保存session',()=>{
  const s=handoffFixture(),a=staff(s,'store-manager','甲'),b=staff(s,'store-manager','乙');
  const p={requestId:'same',version:s.serviceHandoffs[0].version};note(s,a.actor,p);const noteCount=s.serviceHandoffs[0].notes.length;note(s,a.enter(),p);assert.equal(s.serviceHandoffs[0].notes.length,noteCount);
  note(s,b.actor,{requestId:'same'});assert.equal(s.serviceHandoffs[0].notes.length,2);assert.notEqual(s.handoffRequests[0].actor,s.handoffRequests[1].actor);assert.ok(s.handoffRequests.every(item=>!item.actor.includes('sessionId')));
});
test('评价审核、反馈处理和技师考核保存实际账号与授权身份',()=>{
  const s=seed(),support=staff(s,'support','客服甲'),otherSupport=staff(s,'support','客服乙'),manager=staff(s,'store-manager','主管甲');
  command(s,user,'review.create',{bookingId:'B1',score:2,tags:[],text:'待审核文字'});const review=s.serviceReviews[0];
  command(s,support.actor,'review.moderate-text',{id:review.id,version:1,result:'error',reason:'模拟异常',requestId:'same-review'});identity(review.textAudit.actor,support.actor);
  command(s,otherSupport.actor,'review.moderate-text',{id:review.id,version:2,result:'approved',reason:'审核通过',requestId:'same-review'});identity(review.textAudit.actor,otherSupport.actor);identity(review.history.at(-1).actor,otherSupport.actor);assert.equal(s.serviceReviewRequests.length,3);
  command(s,user,'care.case-create',{bookingId:'B1',category:'quality',description:'需要核对服务'});const item=s.serviceCareCases[0];command(s,manager.actor,'care.case-note',{id:item.id,version:item.version,text:'内部核对情况'});identity(item.notes[0].by,manager.actor);identity(item.history.at(-1).by,manager.actor);
  command(s,manager.actor,'qualification.assess',{techId:'lin',version:0,serviceIds:['relax'],occurredAt:NOW,result:'pass',kind:'mature',batch:'实际考核批次',assessor:'考核人员',proof:'凭证号',reason:'审核依据'});identity(s.techQualifications[0].assessments[0].createdBy,manager.actor);identity(s.techQualifications[0].history[0].by,manager.actor);
});
test('集团分账和提成规则保存发布员工，两个同岗员工的同号请求不串用',()=>{
  const s=seed(),a=staff(s,'finance','财务甲'),b=staff(s,'finance','财务乙');
  command(s,a.actor,'finance.rule-publish',{scope:'global',groupBps:0,storeBps:0,effectiveAt:NOW,version:0,reason:'测试空比例',requestId:'same-fund'});identity(s.serviceFinanceRules[0].actor,a.actor);
  command(s,b.actor,'finance.rule-publish',{scope:'store',storeId:'xingfu',groupBps:0,storeBps:0,effectiveAt:NOW,version:0,reason:'测试范围',requestId:'same-fund'});identity(s.serviceFinanceRules[1].actor,b.actor);assert.equal(s.serviceFinanceRequests.length,2);
  command(s,a.actor,'tech-income.rule-publish',{storeId:'xingfu',serviceId:'all',rateBps:0,refundPolicy:'proportional',rounding:'floor',effectiveAt:NOW,version:0,reason:'测试明确规则'});identity(s.techIncomeRules[0].publishedBy,a.actor);assert.match(s.techIncomeRequests[0].actor,new RegExp(a.actor.accountId));assert.doesNotMatch(s.techIncomeRequests[0].actor,/sessionId/);
});
test('发票办理请求账号归一化保留员工字段，同员工跨会话重放不重复办理',()=>{
  const s=seed(),a=staff(s,'store-finance','门店财务');command(s,user,'invoice.apply',{bookingId:'B1',kind:'personal',title:'本人',email:'user@example.test'});const invoice=s.serviceInvoices[0],p={id:invoice.id,version:invoice.version,reason:'资料待补齐',requestId:'invoice-once'};
  command(s,a.actor,'invoice.reject',p);identity(invoice.history.at(-1).actor,a.actor);const count=invoice.history.length;command(s,a.enter(),'invoice.reject',p);assert.equal(invoice.history.length,count);assert.match(s.serviceInvoiceRequests.at(-1).actor,new RegExp(a.actor.accountId));
});
test('资料历史和库存流水记录实际员工，既有actor字符串字段继续兼容',()=>{
  const s=seed(),a=staff(s,'operations','运营甲'),warehouse=staff(s,'warehouse','仓储甲');
  const service=s.services[0];command(s,a.actor,'manage.service-save',{id:service.id,version:service.version,name:service.name,duration:service.duration,priceCents:service.priceCents,nightCents:service.nightCents,extensionMinutes:30,extensionCents:14900,active:true,description:'项目说明',reason:'修改说明'});
  identity(service.history[0],a.actor);assert.equal(service.history[0].actor,'operations');identity(s.managementRequests.at(-1),a.actor);
  s.inventoryLedger=[];const sku={id:'sku',stock:1};stockMove(s,sku,1,'receive','编号','实际入库',warehouse.actor,ctx(s));identity(s.inventoryLedger[0],warehouse.actor);assert.equal(s.inventoryLedger[0].actor,'warehouse');
});
test('忙碌代录和预约安全接报保留员工，不按岗位合并两个登记请求',()=>{
  const s=seed(),a=staff(s,'store-manager','主管甲'),b=staff(s,'store-manager','主管乙');
  command(s,a.actor,'booking.busy-create',{techId:'lin',startAt:NOW-1000,endAt:NOW+HOUR,reason:'店内实际工作',requestId:'same-busy'});identity(s.busyRecords[0].createdBy,a.actor);identity(s.busyRecords[0].history[0].by,a.actor);
  command(s,b.actor,'booking.busy-create',{techId:'zhou',startAt:NOW-1000,endAt:NOW+HOUR,reason:'另一项实际工作',requestId:'same-busy'});assert.equal(s.busyRecords.length,2);identity(s.busyRecords[1].createdBy,b.actor);
  s.safety.push({id:'S1',bookingId:'B1',status:'open',stage:'pending',deadline:NOW+HOUR,escalationDeadline:NOW+2*HOUR,events:[]});command(s,a.actor,'booking.help-ack',{safetyId:'S1',responsibleName:'接报员工'});identity(s.safety[0].acknowledgedBy,a.actor);
});

test('交接、反馈、资格、评价和资金历史显示实际员工且名称转义，不冒充实际考核人',()=>{
  const s=handoffFixture(),a=staff(s,'store-manager','主管 <甲>'),support=staff(s,'support','客服 <乙>'),finance=staff(s,'finance','财务 <丙>');
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const ui={esc,date:String,money:String,query:new URLSearchParams(),empty:esc,tag:esc,link:(label,path)=>`<a href="#${esc(path)}">${label}</a>`,field:()=>'',select:()=>''};
  note(s,a.actor);const handoff=handoffUiView(s,a.actor,['handoffs','B1'],ui);assert.match(handoff,/主管 &lt;甲&gt;/);assert.ok(handoff.includes(a.actor.accountId));assert.doesNotMatch(handoff,/<甲>/);
  command(s,user,'care.case-create',{bookingId:'B1',category:'quality',description:'反馈'});const care=s.serviceCareCases[0];command(s,a.actor,'care.case-note',{id:care.id,version:care.version,text:'实际内部记录'});assert.match(careUiView(s,a.actor,['care','case',care.id],ui),/主管 &lt;甲&gt;/);
  command(s,a.actor,'qualification.assess',{techId:'lin',version:0,serviceIds:['relax'],occurredAt:NOW,result:'pass',kind:'mature',batch:'人工批次',assessor:'事实考核人',proof:'审核凭证',reason:'审核依据'});const qualification=qualificationUiView(s,a.actor,['qualifications','lin'],ui);assert.match(qualification,/主管 &lt;甲&gt;/);assert.match(qualification,/事实考核人/);
  command(s,user,'review.create',{bookingId:'B1',score:2,tags:[],text:'评价'});const review=s.serviceReviews[0];command(s,support.actor,'review.moderate-text',{id:review.id,version:1,result:'approved',reason:'记录模拟结果'});assert.match(reviewUiView(s,support.actor,['reviews',review.id],ui),/客服 &lt;乙&gt;/);
  command(s,finance.actor,'finance.rule-publish',{scope:'global',groupBps:0,storeBps:0,effectiveAt:NOW,version:0,reason:'发布测试规则'});
  s.serviceFinanceRecoveries=[{id:'REC-UI',entryId:'ENTRY-UI',storeId:'xingfu',kind:'offline-adjustment',status:'closed',amountCents:100,receivedCents:100,outstandingCents:0,from:'group',to:'store:xingfu',reason:'实际回款',records:[{at:NOW,amountCents:100,reference:'实际凭证',reason:'回款核实',actor:s.serviceFinanceRules[0].actor}]}];
  const html=financeView(s,finance.actor,['service-finance','recoveries'],ui);assert.match(html,/财务 &lt;丙&gt;/);assert.ok(html.includes(finance.actor.accountId));
});

function bookingDetailsFixture() {
  let s=engineSeed();
  const tech={role:'tech',techId:'lin'},store={role:'store',storeId:'xingfu'},finance={role:'group',job:'finance'};
  const run=(a,type,p={})=>{s=reduce(s,a,type,{requestId:'details-'+(++sequence),...p});};
  const b=()=>s.bookings.at(-1);
  run(user,'booking.create',{storeId:'xingfu',serviceId:'relax',regionId:'home',techId:'lin',startAt:s.now+4*HOUR,mode:'specified',contactName:'联系人',phone:'13812345678',healthConsent:true,identityVerified:true,adultConfirmed:true,recipientId:'visit',recipientKind:'self',recipientName:'私人服务对象',recipientRelationship:'本人',recipientConfirmed:true,attention:'私人注意事项',preference:'私人偏好'});
  run(user,'booking.pay',{id:b().id,outcome:'success'});run(tech,'booking.accept',{id:b().id});run(finance,'clock.advance',{minutes:240});run(tech,'booking.start',{id:b().id});run(finance,'clock.advance',{minutes:60});run(tech,'booking.finish',{id:b().id,mode:'normal'});
  run(user,'invoice.apply',{bookingId:b().id,kind:'personal',title:'私人发票抬头',email:'fixture@example.test'});
  run(user,'booking.assistance-request',{id:b().id,reason:'私人门店协助原文'});
  run(store,'booking.assistance-close',{id:b().id,assistanceId:b().assistance[0].id,response:'私人门店回复'});
  run(user,'booking.help',{id:b().id,reason:'私人安全求助原文'});
  run(store,'booking.help-close',{safetyId:s.safety[0].id,resolution:'私人安全处理结论',unresolvedDispute:true});
  run(user,'care.case-create',{bookingId:b().id,category:'quality',description:'私人质量反馈原文'});
  const item=s.serviceCareCases.at(-1);run(store,'care.case-note',{id:item.id,version:item.version,text:'私人回访核实记录'});
  run(user,'review.create',{bookingId:b().id,score:2,tags:[],text:'私人待审核评价'});
  return s;
}
const detailsUi={esc:v=>String(v??''),money:v=>'¥'+Number(v||0)/100,date:v=>String(v),query:new URLSearchParams(),empty:(a,b='')=>a+b,tag:v=>String(v),link:(label,path)=>`<a href="#${path}">${label}</a>`,button:()=>'',field:()=>'',select:()=>''};
const privateQuality=/私人安全求助原文|私人安全处理结论|私人门店协助原文|私人门店回复|私人质量反馈原文|私人回访核实记录|私人待审核评价|私人服务对象|私人注意事项|私人偏好/;

test('门店财务预约详情不旁路读取安全、协助、回访、评价和交接，保留资金与结算阻断',()=>{
  const s=bookingDetailsFixture(),actor=staff(s,'store-finance').actor,b=s.bookings.at(-1),before=structuredClone(s);
  const projection=bookingView(s,actor)[0];assert.deepEqual(projection.assistance,[]);assert.deepEqual(projection.disputes,[]);assert.equal(projection.settlementBlocked,true);
  const html=staffView(s,actor,['bookings',b.id],detailsUi);
  assert.doesNotMatch(html,privateQuality);assert.doesNotMatch(html,/关联求助|门店协助记录|服务对象与交接|查看评价与申诉进度|\/store\/care\//);
  assert.match(html,/结算继续阻断/);assert.match(html,/¥298/);assert.match(html,/服务资金/);assert.match(html,/服务发票/);assert.deepEqual(s,before);
});

test('集团财务预约详情保持脱敏和资金权限，同样不从内嵌页读取质量处理正文',()=>{
  const s=bookingDetailsFixture(),actor=staff(s,'finance').actor,b=s.bookings.at(-1),projection=bookingView(s,actor)[0];
  assert.deepEqual(projection.assistance,[]);assert.deepEqual(projection.disputes,[]);assert.equal(projection.phone,'138****5678');assert.equal(projection.settlementBlocked,true);
  const html=staffView(s,actor,['bookings',b.id],detailsUi);assert.doesNotMatch(html,privateQuality);assert.match(html,/结算继续阻断/);assert.match(html,/服务资金/);assert.match(html,/服务发票/);
});

test('门店主管保留授权质量信息但不内嵌发票与服务账本，旧自由门店模式保持原入口',()=>{
  const s=bookingDetailsFixture(),actor=staff(s,'store-manager').actor,b=s.bookings.at(-1),html=staffView(s,actor,['bookings',b.id],detailsUi);
  for(const text of ['私人安全求助原文','私人安全处理结论','私人门店协助原文','私人门店回复','私人服务对象','服务评价','服务对象与交接']) assert.ok(html.includes(text),text);
  assert.match(html,/\/store\/care\//);assert.match(html,/¥298/);assert.doesNotMatch(html,/服务资金|服务发票|\/store\/service-finance\/entry/);
  const legacy=staffView(s,{role:'store',storeId:'xingfu'},['bookings',b.id],detailsUi);assert.match(legacy,/私人安全求助原文/);assert.match(legacy,/私人服务对象/);assert.match(legacy,/服务资金/);assert.match(legacy,/服务发票/);
});
