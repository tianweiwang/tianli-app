import test from 'node:test';
import assert from 'node:assert/strict';
import { seed, reduce, goodsSummary } from './engine.mjs';
import { goodsExceptionCommand, syncGoodsExceptions } from './goods-exceptions.mjs';
const user={role:'user',userId:'u1'},other={role:'user',userId:'u2'},support={role:'group',job:'support'},warehouse={role:'group',job:'warehouse'},finance={role:'group',job:'finance'};
function fixture(received=true) {
  let s=seed(),n=0;
  const f={get s(){return s;},get o(){return s.goods.at(-1);},get i(){return f.o.incidents.at(-1);},run(type,p={},a=user){s=reduce(s,a,type,{requestId:`typed-old-${++n}`,...p});},write(type,p={},a=support){const next=structuredClone(s),ctx={id:p=>p+ ++next.seq,fail:m=>{throw Error(m);}},value=goodsExceptionCommand(next,a,type,{id:f.o.id,version:f.i?.version ?? f.o.version,requestId:`typed-new-${++n}`,...p},ctx);syncGoodsExceptions(next,ctx);s=next;return value;},open(kind='wrong-item',extra={}){return f.write('goods.incident-open',{version:f.o.version,stage:'delivery',kind,skuId:'oil',qty:1,actualItem:'收到与原规格不同的货物',receiptClaim:'not-received',occurredAt:s.now,evidence:'核对原包装和运单证据',reason:'按真实诉求登记',...extra});},verify(conclusion='confirmed'){return f.write('goods.incident-verify',{incidentId:f.i.id,conclusion,occurredAt:s.now,evidence:'客服核对原运单及用户说明',reason:'明确核实结论'});},propose(resolution='continue',caseId){return f.write('goods.incident-propose',{incidentId:f.i.id,resolution,caseId,reason:'协商按原流程处理'});},confirm(decision='accept'){return f.write('goods.incident-confirm',{incidentId:f.i.id,decision,reason:'本人核对方案意见'},user);},receipt(extra={},a=user){return f.write('goods.incident-receipt',{incidentId:f.i.id,occurredAt:s.now,evidence:'本人实际核对本单完整正确货物',reason:'实际收货说明',...extra},a);}};
  f.run('promotion.enter',{storeId:'xingfu'});f.run('cart.set',{skuId:'oil',qty:2});f.run('goods.submit',{addressId:'AD1'});f.run('goods.pay',{id:f.o.id,outcome:'success'});f.run('goods.ship',{id:f.o.id,carrier:'隔离物流',tracking:'TYPED'},warehouse);if(received)f.run('goods.receive',{id:f.o.id});return f;
}
const funds=f=>structuredClone({payment:f.o.payment,paid:f.o.paidCents,lines:f.o.lines,refunds:f.o.refunds,stocks:f.s.skus.map(k=>[k.id,k.stock]),commission:goodsSummary(f.s,f.o).commissionCents});
test('C06 错发和签收争议必须有原发货、真实时间、证据及明确原商品/主张',()=>{
  for(const extra of [{occurredAt:null},{occurredAt:'2026-02-30T10:00'},{occurredAt:0},{occurredAt:Date.parse('2030-01-01')},{evidence:''},{skuId:'absent'},{qty:3},{actualItem:''},{stage:'return'}]){const f=fixture(),before=structuredClone(f.s);assert.throws(()=>f.open('wrong-item',extra));assert.deepEqual(f.s,before);}
  const f=fixture();assert.throws(()=>f.open('receipt-dispute',{receiptClaim:'yes'}),/主张/);f.open('receipt-dispute');assert.equal(f.i.fact.receiptClaim,'not-received');assert.equal(f.i.fact.shipment.tracking,'TYPED');assert.equal(f.i.fact.recordedBy.job,'support');
});
test('C06 未核实或仍不能确定不能提案，核实本身不改款或库存',()=>{
  const f=fixture(),before=funds(f);f.open();assert.throws(()=>f.propose(),/核实/);f.verify('inconclusive');assert.throws(()=>f.propose(),/核实/);f.verify('not-confirmed');assert.equal(f.i.verifications.length,2);f.propose();assert.equal(f.i.status,'awaiting_user');assert.deepEqual(funds(f),before);
});
test('C06 旧收货不假结案，接受继续后须本人实际收货事实，原时间不覆盖',()=>{
  const f=fixture(),at=f.o.receivedAt,before=funds(f);f.open();f.verify();f.propose();f.confirm();assert.equal(f.i.status,'waiting');assert.throws(()=>f.receipt({},other),/无权|本人/);f.receipt();assert.equal(f.i.status,'done');assert.equal(f.i.receiptFacts.length,1);assert.equal(f.o.receivedAt,at);assert.deepEqual(funds(f),before);
});
test('C06 本人补认不替代原订单收货，两个真实事实齐全才办结',()=>{
  const f=fixture(false);f.open('receipt-dispute');f.verify();f.propose();f.confirm();f.receipt();assert.equal(f.i.status,'waiting');assert.equal(f.o.status,'shipped');f.run('goods.receive',{id:f.o.id});assert.equal(f.i.status,'done');assert.equal(f.o.status,'received');
});
test('C06 重新核实保留旧记录与方案，待确认期间不能改核实依据',()=>{
  const f=fixture();f.open();f.verify();const old=f.i.verifications[0].id;f.propose();assert.throws(()=>f.verify(),/待确认/);f.confirm('reject');f.verify('not-confirmed');assert.equal(f.i.verifications.length,2);assert.equal(f.i.verifications[0].id,old);assert.equal(f.i.proposalHistory[0].status,'rejected');f.propose();assert.notEqual(f.i.proposal.verificationId,old);
});
test('C06 退款方案仍等待原案件原路退款成功，不凭核实或同意记成功',()=>{
  const f=fixture();f.open();f.verify();f.run('goods.case',{id:f.o.id,kind:'refund',skuId:'oil',qty:1,amountCents:10000,reason:'错发原退款申请'});const caseId=f.o.cases.at(-1).id;f.propose('refund',caseId);f.confirm();assert.equal(f.i.status,'waiting');f.run('goods.case-review',{id:f.o.id,caseId,decision:'approve',reason:'按核实原案处理'},support);f.run('goods.refund',{id:f.o.id,caseId,outcome:'processing'},finance);assert.equal(f.i.status,'waiting');f.run('goods.refund-query',{id:f.o.id,caseId,outcome:'success'},finance);assert.equal(f.i.status,'done');assert.equal(f.o.refunds[0].amountCents,10000);
});
test('C06 核实和收货岗位隔离，旧版本与同请求异内容拒绝',()=>{
  const f=fixture();f.open();const p={incidentId:f.i.id,conclusion:'confirmed',occurredAt:f.s.now,evidence:'原始核实凭据',reason:'核实说明',requestId:'stable-verify',version:f.i.version};
  for(const a of [warehouse,finance,user,{role:'store',storeId:'xingfu'}])assert.throws(()=>f.write('goods.incident-verify',p,a),/仅集团客服|无权/);
  f.write('goods.incident-verify',p);f.write('goods.incident-verify',p);assert.equal(f.i.verifications.length,1);assert.throws(()=>f.write('goods.incident-verify',{...p,reason:'改变'}),/同一提交/);assert.throws(()=>f.write('goods.incident-verify',{...p,requestId:'new'}),/已更新/);f.propose();f.confirm();assert.throws(()=>f.receipt({},support),/本人/);
});
