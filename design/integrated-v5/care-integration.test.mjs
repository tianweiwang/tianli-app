import test from 'node:test';
import assert from 'node:assert/strict';
import {seed, reduce, upgradeFinanceState} from './engine.mjs';
import {serviceFinanceView} from './service-finance.mjs';
import {techIncomeView} from './tech-income.mjs';
import {careView, careBlocksBooking} from './service-care.mjs';
import {serviceReviewView, technicianReviewSummary} from './service-reviews.mjs';

const user={role:'user',userId:'u1'},tech={role:'tech',techId:'lin'},store={role:'store',storeId:'xingfu'},support={role:'group',job:'support'},finance={role:'group',job:'finance'};
function setup(){
  let s=seed(),seq=0;
  const run=(a,t,p={})=>{s=reduce(s,a,t,{requestId:`care-int-${++seq}`,...p});return s;};
  const h={get s(){return s;},get b(){return s.bookings.at(-1);},get c(){return s.serviceCareCases.at(-1);},get f(){return s.serviceCareFollowups.at(-1);},run,advance(minutes){run(finance,'clock.advance',{minutes});}};
  run(finance,'finance.rule-publish',{scope:'global',groupBps:1500,storeBps:500,effectiveAt:s.now,version:0,reason:'隔离测试输入'});
  run(finance,'tech-income.rule-publish',{storeId:'xingfu',serviceId:'all',rateBps:4000,refundPolicy:'proportional',rounding:'floor',effectiveAt:s.now,version:0,reason:'隔离测试输入'});
  run(user,'booking.create',{storeId:'xingfu',serviceId:'relax',regionId:'home',techId:'lin',startAt:s.now+4*3600000,mode:'specified',genderPreference:'any',contactName:'验收用户',phone:'13800000001',healthConsent:true,identityVerified:true,adultConfirmed:true});
  run(user,'booking.pay',{id:h.b.id,outcome:'success'});run(tech,'booking.accept',{id:h.b.id});h.advance(240);run(tech,'booking.start',{id:h.b.id});h.advance(60);run(tech,'booking.finish',{id:h.b.id,mode:'normal'});
  return h;
}
const caseCmd=(h,a,type,p={})=>h.run(a,type,{id:h.c.id,version:h.c.version,...p});
const followCmd=(h,a,type,p={})=>h.run(a,type,{id:h.f.id,version:h.f.version,...p});
const financeCmd=(h,type,p={})=>h.run(finance,type,{id:h.s.serviceFinanceEntries[0].id,version:h.s.serviceFinanceEntries[0].version,outcome:'success',...p});

test('L05 原预约完成→低分申诉全链，评价及普通回访不冻结服务资金',()=>{
  const h=setup();h.run(user,'review.create',{bookingId:h.b.id,score:2,tags:['准时'],text:'演示评价文字'});
  const cmd=(a,t,p)=>h.run(a,t,{id:h.s.serviceReviews[0].id,version:h.s.serviceReviews[0].version,...p});
  assert.equal(technicianReviewSummary(h.s,'lin').rating,null);
  assert.equal(serviceReviewView(h.s,tech).reviews[0].textVisible,false);
  cmd(support,'review.moderate-text',{result:'approved',reason:'模拟审核回执'});
  cmd(tech,'review.appeal',{reason:'核对实际约定内容'});cmd(store,'review.appeal-store',{opinion:'oppose',reason:'门店未发现不实'});
  assert.equal(h.s.serviceReviews[0].appeal.status,'group_pending');
  cmd(support,'review.appeal-final',{decision:'reject',reason:'维持原评价'});
  h.run(store,'care.followup-create',{bookingId:h.b.id,scope:'store',name:'演示负责人',reason:'人工安排复核沟通',dueAt:h.s.now+3*86400000});
  assert.equal(careBlocksBooking(h.s,h.b),false);h.advance(2880);
  financeCmd(h,'finance.split-start');financeCmd(h,'finance.finish-start');
  assert.equal(techIncomeView(h.s,store).summary.payableCents,11920);
  assert.equal(h.b.status,'done');assert.equal(h.s.goods.length,0);assert.equal(h.s.bills.length,0);
});

test('L05 未结反馈暂停分账，集团结案后恢复；回访未接通不能虚假结案',()=>{
  const h=setup();h.run(user,'care.case-create',{bookingId:h.b.id,category:'quality',description:'仅反馈服务沟通问题'});
  h.run(store,'care.followup-create',{bookingId:h.b.id,caseId:h.c.id,scope:'store',name:'演示负责人',reason:'追踪本次反馈',dueAt:h.s.now+3*86400000});
  assert.equal(h.b.refunds.length,0);assert.equal(h.b.status,'done');
  caseCmd(h,store,'care.case-respond',{decision:'respond',publicReply:'核实后已说明并改进',internalNote:'内部核实记录'});
  caseCmd(h,user,'care.case-answer',{decision:'escalate',reason:'申请集团进一步核实'});
  h.advance(2880);
  assert.equal(careBlocksBooking(h.s,h.b),true);
  assert.ok(serviceFinanceView(h.s,finance).entries[0].blockers.some(x=>x.includes('质量反馈')));
  assert.throws(()=>financeCmd(h,'finance.split-start'));
  // Group overdue stays open; no fabricated automatic ruling releases money.
  assert.equal(h.c.status,'group_pending');
  caseCmd(h,support,'care.case-respond',{decision:'respond',publicReply:'集团已核实沟通结果'});
  assert.equal(h.c.status,'closed');financeCmd(h,'finance.split-start');financeCmd(h,'finance.finish-start');
  followCmd(h,store,'care.followup-record',{outcome:'no_answer',note:'本次未接通，安排再次联系',nextContactAt:h.s.now+3600000});
  assert.throws(()=>followCmd(h,store,'care.followup-close',{conclusion:'不能假结案'}),/未接通|接通/);
  followCmd(h,store,'care.followup-record',{outcome:'reached',note:'已向用户确认改进结果'});
  followCmd(h,store,'care.followup-close',{conclusion:'用户确认反馈处理完成'});
  assert.equal(h.f.status,'closed');assert.equal(careBlocksBooking(h.s,h.b),false);
});

test('L05 反馈不阻止原退款办理；原退款成功后人工核验结案再放开结算',()=>{
  const h=setup();h.run(user,'care.case-create',{bookingId:h.b.id,category:'quality',description:'质量情况待核实'});
  h.run(user,'booking.refund-request',{id:h.b.id,reason:'原退款入口提出诉求',requests:[{paymentId:h.b.payment.id,amountCents:9800}]});
  const refundId=h.b.refunds[0].id;
  caseCmd(h,store,'care.case-respond',{decision:'respond',publicReply:'已同意处理，退款仍按原单执行'});
  caseCmd(h,user,'care.case-answer',{decision:'accept'});assert.equal(h.c.status,'execution_pending');
  assert.throws(()=>caseCmd(h,store,'care.case-close',{conclusion:'未退款不能结束'}),/退款/);
  h.run(store,'booking.refund-review',{id:h.b.id,refundId,decision:'approve',amountCents:9800,reason:'同意原退款诉求'});
  h.run(finance,'booking.refund-pay',{id:h.b.id,refundId,outcome:'success'});
  assert.equal(h.b.payment.refundedCents,9800);
  caseCmd(h,store,'care.case-close',{conclusion:'已核实原退款成功，反馈办结'});
  assert.equal(h.c.status,'closed');h.advance(2880);financeCmd(h,'finance.split-start');financeCmd(h,'finance.finish-start');
  assert.equal(serviceFinanceView(h.s,finance).entries[0].targetGroupCents,3000);
});

test('L05 用户/门店/集团岗位读写隔离，版本冲突与重放不重复创建',()=>{
  const h=setup(),payload={bookingId:h.b.id,category:'quality',description:'自己的反馈',requestId:'fixed-care-request'};
  h.run(user,'care.case-create',payload);h.run(user,'care.case-create',payload);assert.equal(h.s.serviceCareCases.length,1);
  const old=h.c.version;caseCmd(h,store,'care.case-note',{text:'内部核实信息仅授权处理端可见'});
  assert.throws(()=>caseCmd(h,store,'care.case-respond',{version:old,decision:'respond',publicReply:'旧版本提交'}),/版本|更新/);
  for(const a of [{role:'user',userId:'u2'},{role:'tech',techId:'chen'},{role:'store',storeId:'yinxing'},finance,{role:'group',job:'operations'}]){
    assert.equal(careView(h.s,a).cases.length,0);assert.throws(()=>caseCmd(h,a,'care.case-note',{text:'越权修改'}));
  }
  assert.equal(JSON.stringify(careView(h.s,user)).includes('内部核实信息'),false);
  assert.equal(JSON.stringify(careView(h.s,tech)).includes('内部核实信息'),false);
});

test('L05 已完结资金遇新反馈也暂停技师发放；反馈撤回不更改原资金事实',()=>{
  const h=setup();h.advance(2880);financeCmd(h,'finance.split-start');financeCmd(h,'finance.finish-start');
  const original=structuredClone(h.s.serviceFinanceEntries[0].split);
  assert.equal(techIncomeView(h.s,store).summary.payableCents,11920);
  h.run(user,'care.case-create',{bookingId:h.b.id,category:'quality',description:'48小时边界提交质量反馈'});
  assert.equal(techIncomeView(h.s,store).summary.payableCents,0);
  const income=h.s.techIncomeEntries[0];
  assert.throws(()=>h.run(store,'tech-income.payout',{techId:'lin',month:income.month,lines:[{entryId:income.id,version:income.version}],paidAt:h.s.now,proof:'DEMO-TRANSFER',reason:'未结不得发放'}));
  caseCmd(h,user,'care.case-answer',{decision:'withdraw',reason:'用户撤销此次反馈'});
  assert.equal(h.c.status,'withdrawn');assert.equal(techIncomeView(h.s,store).summary.payableCents,11920);
  assert.deepEqual(h.s.serviceFinanceEntries[0].split,original);
});

test('L05 schema5增量加载无虚构历史，重复迁移与所有投影只读稳定',()=>{
  const h=setup(),old=structuredClone(h.s);
  for(const key of ['serviceReviews','serviceReviewRequests','serviceCareCases','serviceCareFollowups','serviceCareRequests'])delete old[key];
  const originals=structuredClone({bookings:old.bookings,users:old.users,techs:old.techs});
  upgradeFinanceState(old);assert.equal(old.serviceReviews.length,0);assert.equal(old.serviceCareCases.length,0);
  assert.deepEqual({bookings:old.bookings,users:old.users,techs:old.techs},originals);
  const once=structuredClone(old);upgradeFinanceState(old);careView(old,store);serviceReviewView(old,tech);technicianReviewSummary(old,'lin');
  assert.deepEqual(old,once);
});
