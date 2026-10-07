import test from 'node:test';
import assert from 'node:assert/strict';
import { seed, reduce, goodsSummary } from './engine.mjs';
import { upgradeGoodsSettlement, goodsSettlementView, goodsSettlementExitBlockers } from './goods-settlement.mjs';
const u={role:'user',userId:'u1'},g={role:'group',job:'finance'},support={role:'group',job:'support'},warehouse={role:'group',job:'warehouse'},store={role:'store',storeId:'xingfu'},wrong={role:'store',storeId:'silver'};
function fixture(){let s=seed(),n=0;const f={get s(){return s;},run(type,p={},a=u){s=reduce(s,a,type,p);return s;},bill(id){return s.bills.find(x=>x.id===id)||s.bills.at(-1);},plan(){return s.goodsOffsetPlans?.at(-1);},debt(){return s.recoveries.at(-1);},order(id){return s.goods.find(x=>x.id===id);},create(storeId='xingfu',qty=1){f.run('promotion.enter',{storeId});f.run('cart.set',{skuId:'oil',qty});f.run('goods.submit',{addressId:'AD1',requestId:`create-${++n}`});const id=s.goods.at(-1).id;f.run('goods.pay',{id,outcome:'success'});f.run('goods.ship',{id,carrier:'演示物流',tracking:`D-${n}`},warehouse);f.run('goods.receive',{id});return id;},mature(){f.run('clock.advance',{minutes:10080});},makeBill(storeId='xingfu'){f.run('bill.create',{storeId},g);return s.bills.at(-1).id;},payBill(id){f.run('bill.confirm',{id,version:f.bill(id).version},store);f.run('bill.pay',{id,outcome:'processing'},g);f.run('bill.query',{id,outcome:'success'},g);},refund(id,amount=10000){f.run('goods.case',{id,kind:'refund',skuId:'oil',qty:1,amountCents:amount,reason:'成功退货后调整商品佣金'});const caseId=f.order(id).cases.at(-1).id;f.run('goods.case-review',{id,caseId,decision:'approve',reason:'核实同意'},support);f.run('goods.refund',{id,caseId,outcome:'success'},g);return caseId;},new(type,p={},a=g){const b=f.bill(p.id),plan=p.planId?s.goodsOffsetPlans.find(x=>x.id===p.planId):null;return f.run(type,{requestId:`operation-${++n}`,version:plan?plan.version:b.version,...p},a);},propose(id,amount=1000,recoveryId=f.debt().id){f.new('bill.offset-propose',{id,recoveryId,amountCents:amount,reason:'以本店后续商品佣金偿还已确认商品债务'});return f.plan().id;},confirm(id,planId=f.plan().id,decision='accept'){f.new('bill.offset-confirm',{id,planId,decision,reason:'已核对商品债务、抵扣及现金金额'},store);},start(id,planId=f.plan().id){f.new('bill.offset-pay',{id,planId,outcome:'processing'});},query(id,outcome,planId=f.plan().id){f.new('bill.offset-query',{id,planId,outcome});}};return f;}
function debtor(){const f=fixture(),old=f.create();f.mature();const paid=f.makeBill();f.payBill(paid);f.refund(old);const next=f.create();f.mature();const billId=f.makeBill();return{f,old,next,paid,billId};}
function assertNoCashExecution(f,billId) {
  const bill=f.bill(billId),plan=f.plan();
  assert.deepEqual({billAttempts:bill.attempts,cashAttempts:bill.cashPayment.attempts,executionAttempts:plan.execution.attempts,cashStatus:bill.cashPayment.status},{billAttempts:0,cashAttempts:0,executionAttempts:1,cashStatus:'not-required'},'明确执行抵扣一次，不能生成现金付款尝试');
  assert.match(JSON.stringify(plan.history),/无需现金付款，商品抵扣与结佣实际入账/);
  assert.doesNotMatch(JSON.stringify(plan.history),/现金结果已确认/);
}

test('拆账先由本店明确差异，父账余项与差异保留，子账重新核对后现金付款',()=>{
  const f=fixture(),a=f.create(),b=f.create();f.mature();const id=f.makeBill();f.new('bill.dispute-lines',{id,orderIds:[a],reason:'第一单存在差异，第二单已核对无争议'},store);const original=structuredClone(f.bill(id).dispute);
  f.new('bill.split',{id,orderIds:[b],reason:'本店已明确第二单无争议，先转子账'});const child=f.s.bills.find(x=>x.parentBillId===id);assert.equal(f.bill(id).items.length,1);assert.equal(child.items.length,1);assert.equal(child.items[0].orderId,b);assert.equal(child.amountCents,2000);assert.equal(f.bill(id).amountCents,2000);assert.deepEqual(f.bill(id).dispute,original);assert.equal(f.bill(id).status,'disputed');assert.equal(child.status,'review');assert.equal(child.disputeReference.billId,id);f.payBill(child.id);assert.equal(f.order(b).commissionPaidCents,2000);assert.equal(f.order(a).commissionPaidCents,0);assert.equal(f.bill(id).dispute.status,'open');
});
test('旧整单差异不能被财务猜测拆出，必须本店补范围且保留旧依据',()=>{
  const f=fixture(),a=f.create(),b=f.create();f.mature();const id=f.makeBill();f.run('bill.dispute',{id,version:f.bill(id).version,reason:'旧整单差异说明'},store);assert.throws(()=>f.new('bill.split',{id,orderIds:[b],reason:'财务自行选择'}),/本店先确认/);f.new('bill.dispute-lines',{id,orderIds:[a],reason:'本店补充只第一单存在差异'},store);assert.equal(f.bill(id).disputeHistory[0].reason,'旧整单差异说明');f.new('bill.split',{id,orderIds:[b],reason:'已明确范围'});assert.equal(f.s.bills.length,2);
});
test('拒绝有差异、全部明细、跨账、跨店及非财务拆分；失败不改输入',()=>{
  const f=fixture(),a=f.create(),b=f.create();f.mature();const id=f.makeBill();f.new('bill.dispute-lines',{id,orderIds:[a],reason:'第一单差异'},store);const before=structuredClone(f.s);assert.throws(()=>f.new('bill.split',{id,orderIds:[a],reason:'拆争议行'}),/有差异/);assert.deepEqual(f.s,before);assert.throws(()=>f.new('bill.split',{id,orderIds:[a,b],reason:'全部拆'}),/保留余项/);assert.throws(()=>f.new('bill.split',{id,orderIds:['不存在'],reason:'跨账'}),/本账/);assert.throws(()=>f.new('bill.split',{id,orderIds:[b],reason:'越权'},warehouse),/岗位|财务|无权/);assert.throws(()=>f.new('bill.dispute-lines',{id,orderIds:[a],reason:'跨店'},wrong),/无权/);
});
test('已付或现金结果未知账单不能拆分，不能重复占用原订单',()=>{
  const f=fixture(),a=f.create(),b=f.create();f.mature();const id=f.makeBill();f.run('bill.confirm',{id,version:f.bill(id).version},store);f.run('bill.pay',{id,outcome:'processing'},g);assert.throws(()=>f.new('bill.split',{id,orderIds:[b],reason:'未知拆账'}),/未知|付款/);f.run('bill.query',{id,outcome:'success'},g);assert.throws(()=>f.new('bill.split',{id,orderIds:[b],reason:'已付拆账'}),/付款/);assert.equal(f.order(a).commissionPaidCents,2000);
});
test('父子账退款分别调整当前行，原账差异不丢，不能再次出账重复占用',()=>{
  const f=fixture(),a=f.create(),b=f.create();f.mature();const id=f.makeBill();f.new('bill.dispute-lines',{id,orderIds:[a],reason:'第一单差异'},store);f.new('bill.split',{id,orderIds:[b],reason:'第二单无争议'});const child=f.s.bills.at(-1),parent=structuredClone(f.bill(id));f.refund(b);assert.equal(f.bill(child.id).amountCents,1000);assert.equal(f.bill(id).amountCents,parent.amountCents);assert.equal(f.bill(id).dispute.reason,parent.dispute.reason);f.refund(a);assert.equal(f.bill(id).amountCents,1000);assert.equal(f.bill(id).status,'disputed');assert.equal(f.bill(child.id).amountCents,1000);assert.throws(()=>f.makeBill(),/没有/);assert.equal(f.s.bills.flatMap(x=>x.items).filter(x=>x.orderId===a).length,1);assert.equal(f.s.bills.flatMap(x=>x.items).filter(x=>x.orderId===b).length,1);
});
test('拆账版本和请求幂等；同请求改选择拒绝，旧版本新提交拒绝',()=>{
  const f=fixture(),a=f.create(),b=f.create();f.mature();const id=f.makeBill(),p={id,orderIds:[b],reason:'无争议先付',version:f.bill(id).version,requestId:'split-once'};f.run('bill.split',p,g);f.run('bill.split',p,g);assert.equal(f.s.bills.length,2);assert.equal(f.bill(id).splitHistory.length,1);assert.throws(()=>f.run('bill.split',{...p,orderIds:[a]},g),/标识/);assert.throws(()=>f.run('bill.split',{...p,requestId:'fresh'},g),/版本/);
});
test('同店抵扣方案由本店同意，现金未知/失败不冲债务或记已结，原笔重试成功一次',()=>{
  const{f,next,billId}=debtor(),debtId=f.debt().id;const pid=f.propose(billId);assert.equal(f.plan().grossCents,2000);assert.equal(f.plan().offsetCents,1000);assert.equal(f.plan().cashCents,1000);assert.equal(f.debt().recoveredCents,0);assert.throws(()=>f.start(billId),/本店确认/);f.confirm(billId,pid);f.start(billId);const paymentId=f.plan().paymentId;assert.equal(f.debt().recoveredCents,0);assert.equal(f.order(next).commissionPaidCents,0);assert.equal(f.bill(billId).cashPaidCents,undefined);f.query(billId,'failed');assert.equal(f.plan().paymentId,paymentId);assert.equal(f.debt().recoveredCents,0);f.start(billId);assert.equal(f.plan().paymentId,paymentId);f.query(billId,'success');assert.equal(f.debt().id,debtId);assert.equal(f.debt().recoveredCents,1000);assert.equal(f.debt().status,'closed');assert.equal(f.order(next).commissionPaidCents,2000);assert.equal(f.bill(billId).grossSettledCents,2000);assert.equal(f.bill(billId).cashPaidCents,1000);assert.equal(f.bill(billId).offsetSettledCents,1000);assert.equal(f.bill(billId).cashPayment.id,paymentId);assert.equal(f.debt().records.filter(x=>x.kind==='offset').length,1);assert.equal(f.plan().execution.attempts,2);assert.equal(f.bill(billId).attempts,2);assert.equal(f.bill(billId).cashPayment.attempts,2);
});
test('成功抵扣后原查询重放及新查询不重复清债务或结佣',()=>{
  const{f,next,billId}=debtor();f.propose(billId);f.confirm(billId);f.start(billId);const p={id:billId,planId:f.plan().id,version:f.plan().version,requestId:'query-once',outcome:'success'};f.run('bill.offset-query',p,g);f.run('bill.offset-query',p,g);f.query(billId,'success');assert.equal(f.debt().records.filter(x=>x.kind==='offset').length,1);assert.equal(f.order(next).commissionPaidCents,2000);assert.equal(f.order(next).goodsCommissionSettlements.length,1);assert.throws(()=>f.run('bill.offset-query',{...p,outcome:'failed'},g),/标识/);
});
test('全额抵扣无需现金，须本店确认及集团明确执行才清账',()=>{
  const{f,billId}=debtor();f.refund(f.s.goods.at(-1).id);assert.equal(f.bill(billId).amountCents,1000);f.propose(billId,1000);assert.equal(f.plan().cashCents,0);f.confirm(billId);assert.equal(f.debt().recoveredCents,0);f.start(billId);assert.equal(f.bill(billId).status,'paid');assert.equal(f.bill(billId).cashPaidCents,0);assert.equal(f.bill(billId).offsetSettledCents,1000);assert.equal(f.bill(billId).cashPayment.status,'not-required');assert.equal(f.debt().recoveredCents,1000);assertNoCashExecution(f,billId);
});
test('本店驳回或集团撤销释放方案占用，旧方案保留，未知执行不能撤销',()=>{
  const{f,billId}=debtor(),pid=f.propose(billId);f.confirm(billId,pid,'reject');assert.equal(f.plan().status,'rejected');assert.equal(f.bill(billId).activeOffsetPlanId,null);const second=f.propose(billId);f.confirm(billId,second);f.new('bill.offset-cancel',{id:billId,planId:second,reason:'双方重新协调'});assert.equal(f.plan().status,'cancelled');const third=f.propose(billId);f.confirm(billId,third);f.start(billId);assert.throws(()=>f.new('bill.offset-cancel',{id:billId,planId:third,reason:'未知撤销'}),/未知/);assert.equal(f.plan().status,'processing');
});
test('原付款/确认按钮不能绕过方案；人工回款不得占用待抵扣债务',()=>{
  const{f,billId}=debtor();f.propose(billId);assert.throws(()=>f.run('bill.confirm',{id:billId,version:f.bill(billId).version},store),/有效抵扣/);f.confirm(billId);assert.throws(()=>f.run('bill.pay',{id:billId,outcome:'processing'},g),/有效抵扣/);f.start(billId);assert.throws(()=>f.run('recovery.receive',{id:f.debt().id,amountCents:1000,proof:'另处收回',requestId:'manual'},g),/占用/);assert.equal(f.debt().recoveredCents,0);assert.throws(()=>f.run('bill.query',{id:billId,outcome:'success'},g),/有效抵扣/);
});
test('两个账单不能重复预占同一债务，跨店债务与伪造服务债务不能抵扣',()=>{
  const{f,billId}=debtor();f.create();f.mature();const otherBill=f.makeBill();f.propose(billId);assert.throws(()=>f.propose(otherBill),/占用/);const second=f.s.goods.at(-1).id;assert.equal(f.order(second).commissionPaidCents,0);const s=structuredClone(f.s),b=s.bills.find(x=>x.id===otherBill);s.recoveries.push({id:'fake',storeId:'xingfu',orderId:'service-booking',amountCents:1000,recoveredCents:0,status:'open',records:[]});assert.throws(()=>reduce(s,g,'bill.offset-propose',{id:otherBill,version:b.version,requestId:'fake-debt',recoveryId:'fake',amountCents:1000,reason:'伪服务债务'}),/跨店|服务款/);
});
test('方案源退款变化立即失效，未冲抵，旧页面确认不覆盖最新金额',()=>{
  const{f,next,billId}=debtor(),pid=f.propose(billId),old=f.plan().version;f.refund(next,5000);assert.equal(f.plan().status,'invalidated');assert.equal(f.bill(billId).amountCents,1500);assert.equal(f.debt().recoveredCents,0);assert.throws(()=>f.run('bill.offset-confirm',{id:billId,planId:pid,version:old,requestId:'stale-confirm',decision:'accept',reason:'旧版'},store),/版本/);assert.equal(f.order(next).commissionPaidCents,0);
});
test('现金未知时退款保留原付款快照；成功按实际已结gross产生新追回',()=>{
  const{f,next,billId}=debtor();f.propose(billId);f.confirm(billId);f.start(billId);const snapshot=structuredClone(f.plan().items);f.refund(next,10000);assert.equal(f.plan().status,'processing');assert.deepEqual(f.plan().items,snapshot);assert.equal(f.bill(billId).amountCents,2000);f.query(billId,'success');assert.equal(f.order(next).commissionPaidCents,2000);assert.equal(f.s.recoveries.find(r=>r.orderId===next).amountCents,1000);assert.equal(f.bill(billId).cashPaidCents+f.bill(billId).offsetSettledCents,2000);
});
test('现金未知时退款后查询确定失败须重核新佣金，不沿用过期抵扣金额',()=>{
  const{f,next,billId}=debtor();f.propose(billId);f.confirm(billId);f.start(billId);const old=f.plan().id,oldPaymentId=f.plan().paymentId;f.refund(next,10000);f.query(billId,'failed');assert.equal(f.plan().status,'invalidated');assert.equal(f.bill(billId).amountCents,1000);assert.equal(f.debt().recoveredCents,0);assert.throws(()=>f.start(billId,old),/本店确认/);
  const oldPlan=structuredClone(f.plan()),oldPaymentHistory=structuredClone(f.bill(billId).paymentHistory),fresh=f.propose(billId,1000);assert.notEqual(fresh,old);assert.notEqual(f.plan().paymentId,oldPaymentId);f.confirm(billId,fresh);f.start(billId,fresh);assert.equal(f.bill(billId).cashPaidCents,0);assert.equal(f.bill(billId).offsetSettledCents,1000);assert.equal(f.debt().recoveredCents,1000);assert.equal(f.order(next).commissionPaidCents,1000);assert.equal(f.s.recoveries.some(r=>r.orderId===next),false);assert.deepEqual(f.s.goodsOffsetPlans.find(p=>p.id===old),oldPlan);assert.deepEqual(f.bill(billId).paymentHistory,oldPaymentHistory);assertNoCashExecution(f,billId);
});
test('抵扣超债务或超账金额、越权/跨店确认及缺版本/缺请求拒绝',()=>{
  const{f,billId}=debtor();assert.throws(()=>f.propose(billId,1001),/超过/);assert.throws(()=>f.new('bill.offset-propose',{id:billId,recoveryId:f.debt().id,amountCents:1000,reason:'仓储越权'},warehouse),/岗位|财务|无权/);const pid=f.propose(billId);assert.throws(()=>f.new('bill.offset-confirm',{id:billId,planId:pid,decision:'accept',reason:'跨店'},wrong),/无权/);assert.throws(()=>f.run('bill.offset-confirm',{id:billId,planId:pid,version:0,decision:'accept',reason:'缺请求'},store),/标识/);assert.throws(()=>f.run('bill.offset-confirm',{id:billId,planId:pid,version:-1,requestId:'badversion',decision:'accept',reason:'旧版本'},store),/版本/);
  assert.throws(()=>f.run('bill.offset-confirm',{id:billId,planId:pid,requestId:'missing-version',decision:'accept',reason:'缺版本'},store),/版本/);
  f.new('bill.offset-cancel',{id:billId,planId:pid,reason:'验证较小当前账额的边界'});
  f.refund(f.s.goods.at(-1).id,15000);
  assert.equal(f.bill(billId).amountCents,500);
  const before=structuredClone(f.s);
  assert.throws(()=>f.propose(billId,501),/超过/,'501分未超1000分债务，但超过500分当前账单');
  for(const amount of [0,-1,1.5])assert.throws(()=>f.propose(billId,amount),/金额|整数|大于|正数/);
  assert.deepEqual(f.s,before,'拒绝请求不能改写原款或占额');
});

test('两店正常结佣后退款产生的真实债务不能跨店抵扣',()=>{
  const {f,billId}=debtor(),ownDebtId=f.debt().id;
  const otherOrder=f.create('yuan');f.mature();const otherBill=f.makeBill('yuan');
  f.run('bill.confirm',{id:otherBill,version:f.bill(otherBill).version},{role:'store',storeId:'yuan'});
  f.run('bill.pay',{id:otherBill,outcome:'processing'},g);
  f.run('bill.query',{id:otherBill,outcome:'success'},g);
  f.refund(otherOrder);
  const otherDebt=f.debt();assert.equal(otherDebt.storeId,'yuan');assert.notEqual(otherDebt.id,ownDebtId);
  const before=structuredClone(f.s);
  assert.throws(()=>f.propose(billId,1000,otherDebt.id),/跨店|同一门店|本店/);
  assert.deepEqual(f.s,before);
  assert.equal(f.s.goodsOffsetPlans.length,0);
});
test('抵扣后再退款按gross已结追回，原清偿记录不逆写，服务账保持原样',()=>{
  const {f,next,billId}=debtor(),tech={role:'tech',techId:'lin'};
  f.run('finance.rule-publish',{scope:'global',groupBps:1000,storeBps:500,effectiveAt:f.s.now,version:0,reason:'隔离验证的显式服务规则',requestId:'service-finance-rule'},g);
  f.run('tech-income.rule-publish',{storeId:'xingfu',serviceId:'all',version:0,rateBps:4000,refundPolicy:'proportional',rounding:'floor',effectiveAt:f.s.now,reason:'隔离验证的显式技师规则',requestId:'service-income-rule'},g);
  f.run('booking.create',{storeId:'xingfu',serviceId:'relax',regionId:'home',techId:'lin',startAt:Math.ceil((f.s.now+4*3600000)/1800000)*1800000,mode:'specified',genderPreference:'any',contactName:'本地合成顾客',phone:'13800000001',healthConsent:true,identityVerified:true,adultConfirmed:true,requestId:'service-booking'});
  const serviceId=f.s.bookings.at(-1).id;
  f.run('booking.pay',{id:serviceId,outcome:'success'});
  f.run('booking.accept',{id:serviceId},tech);
  f.run('clock.advance',{minutes:Math.ceil((f.s.bookings.at(-1).startAt-f.s.now)/60000)});
  f.run('booking.start',{id:serviceId},tech);
  f.run('clock.advance',{minutes:f.s.bookings.at(-1).duration});
  f.run('booking.finish',{id:serviceId,mode:'normal'},tech);
  f.run('clock.advance',{minutes:2881});
  const entry=()=>f.s.serviceFinanceEntries.find(row=>row.bookingId===serviceId);
  f.run('finance.split-start',{id:entry().id,version:entry().version,outcome:'success',requestId:'service-split'},g);
  f.run('finance.finish-start',{id:entry().id,version:entry().version,outcome:'success',requestId:'service-finish'},g);
  assert.equal(entry().split.status,'success');
  assert.ok(entry().split.amountCents>0,'保护的是实际分账金额，不是空服务账本');
  assert.ok(f.s.techIncomeEntries.some(row=>row.bookingId===serviceId&&row.amountCents>0),'保护的是按接单快照计算的实际技师提成');

  const protectedKeys=['bookings','serviceFinanceRules','serviceFinanceEntries','serviceFinanceRequests','serviceFinanceRecoveries','techIncomeRules','techIncomeEntries','techIncomeAdjustments','techIncomePayouts','techIncomeDifferences','techIncomeRequests','servicePromoters','servicePromotionInvites','servicePromotionRules','servicePromotionAgreements','servicePromotionPolicies','servicePromotionRisks','servicePromotionFirsts','serviceCommissions','servicePromotionWithdrawals','servicePromotionRecoveries','servicePromotionOffsets','servicePromotionRequests','inventoryLedger'];
  const protectedState=()=>{
    for(const key of protectedKeys)assert.ok(Array.isArray(f.s[key]),`${key}必须是实际存在的账本，不能比较两个undefined`);
    return structuredClone({...Object.fromEntries(protectedKeys.map(key=>[key,f.s[key]])),customerBindings:f.s.users.map(user=>({id:user.id,serviceBinding:user.serviceBinding}))});
  };
  const service=protectedState();
  f.propose(billId);f.confirm(billId);f.start(billId);
  assert.deepEqual(protectedState(),service,'商品提案、确认与现金未知均不能占用服务资金或库存');
  f.query(billId,'failed');
  assert.deepEqual(protectedState(),service,'商品现金失败不能改变服务账');
  f.start(billId);f.query(billId,'success');
  assert.deepEqual(protectedState(),service,'商品抵扣和现金成功仅结原商品账');
  const oldRecords=structuredClone(f.s.recoveries[0].records);
  f.refund(next,10000);
  assert.equal(f.s.recoveries.find(r=>r.orderId===next).amountCents,1000);
  assert.deepEqual(f.s.recoveries[0].records,oldRecords);
  assert.deepEqual(protectedState(),service,'后续仅退款产生商品追回，不借服务账或改库存');
});
test('读投影不迁移/反写；门店只本店，财务以外和用户不可读，退出不抹债',()=>{
  const{f,billId}=debtor();f.propose(billId);const before=structuredClone(f.s),v=goodsSettlementView(f.s,store,billId,{goodsSummary});assert.equal(v.plans.length,1);v.plans[0].allocations[0].amountCents=1;assert.deepEqual(f.s,before);assert.equal(goodsSettlementView(f.s,wrong,billId,{goodsSummary}).bills.length,0);assert.equal(goodsSettlementView(f.s,warehouse,billId,{goodsSummary}).bills.length,0);assert.equal(goodsSettlementView(f.s,u,billId,{goodsSummary}).bills.length,0);const exit=goodsSettlementExitBlockers(f.s,'xingfu');assert.equal(exit.debts[0].outstandingCents,1000);assert.equal(exit.plans.length,1);assert.deepEqual(f.s,before);
});
test('旧schema5升级幂等，不制造现金、冲抵或成功事实',()=>{
  const{f,billId}=debtor(),s=structuredClone(f.s);delete s.goodsOffsetPlans;delete s.goodsSettlementRequests;for(const b of s.bills){delete b.childBillIds;delete b.splitHistory;delete b.settlementHistory;}for(const r of s.recoveries)delete r.version;const paid=structuredClone(s.goods.map(o=>o.commissionPaidCents));upgradeGoodsSettlement(s);const after=structuredClone(s);upgradeGoodsSettlement(s);assert.deepEqual(s,after);assert.equal(s.bills.find(b=>b.id===billId).cashPaidCents,undefined);assert.equal(s.goodsOffsetPlans.length,0);assert.deepEqual(s.goods.map(o=>o.commissionPaidCents),paid);
});

test('全额退款的零佣金行不生成零额子账，已核查差异行可按当前金额拆分',()=>{
  const f=fixture(),a=f.create(),b=f.create();f.mature();const id=f.makeBill();f.refund(a,20000);assert.equal(f.bill(id).items.find(x=>x.orderId===a).amountCents,0);assert.throws(()=>f.new('bill.split',{id,orderIds:[a],reason:'零款项不能拆账'}),/零佣金/);assert.ok(!goodsSettlementView(f.s,g,id,{goodsSummary}).bills[0].splitCandidates.includes(a));
  f.new('bill.dispute-lines',{id,orderIds:[b],reason:'第二行差异'},store);f.run('bill.resolve',{id,reason:'核查完成，第二行金额正确'},g);assert.ok(goodsSettlementView(f.s,g,id,{goodsSummary}).bills[0].splitCandidates.includes(b));f.new('bill.split',{id,orderIds:[b],reason:'处理过的差异行已核对无争议'});assert.equal(f.s.bills.at(-1).amountCents,2000);assert.equal(f.s.bills.at(-1).disputeReference.status,'resolved');
});
