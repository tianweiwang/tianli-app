import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { seed, reduce } from './engine.mjs';
import { upgradeGoodsLogisticsPolicy, captureGoodsLogisticsPolicy, goodsLogisticsCommand, goodsLogisticsAutoReceipt, tickGoodsLogistics, goodsLogisticsTaskRows } from './goods-logistics-policy.mjs';
const MIN=60000,user={role:'user',userId:'u1'},ops={role:'group',job:'operations'},warehouse={role:'group',job:'warehouse'},support={role:'group',job:'support'};
function fixture() {
  let s=seed(),n=0;
  const f={get s(){return s;},get o(){return s.goods.at(-1);},get fact(){return f.o.goodsDeliveryFacts?.at(-1);},advance(minutes){s.now+=minutes*MIN;},run(type,p={},a=user){s=reduce(s,a,type,{requestId:`logistics-old-${++n}`,...p});},write(type,p={},a=ops){const next=structuredClone(s),ctx={id:k=>k+ ++next.seq,fail:m=>{throw Error(m);}},result=goodsLogisticsCommand(next,a,type,{requestId:`logistics-new-${++n}`,...p},ctx);s=next;return result;},publish(extra={}){return f.write('goods-logistics.policy-publish',{version:Math.max(0,...(s.goodsLogisticsPolicies || []).map(r=>r.version)),scope:'all',effectiveAt:s.now,autoReceiptMode:'enabled',autoReceiptMinutes:60,compensationMode:'not-configured',unclaimedMode:'not-configured',reason:'隔离验收显式输入，不是正式默认政策',...extra});},create(mixed=false){f.run('cart.set',{skuId:'oil',qty:1});if(mixed)f.run('cart.set',{skuId:'care',qty:1});f.run('goods.submit',{addressId:'AD1'});captureGoodsLogisticsPolicy(s,f.o);f.run('goods.pay',{id:f.o.id,outcome:'success'});f.run('goods.ship',{id:f.o.id,carrier:'真实隔离原运单',tracking:'POLICY-SOURCE'},warehouse);return f.o.id;},record(extra={},a=warehouse){return f.write('goods-logistics.delivery-record',{id:f.o.id,version:f.o.version,kind:'signed',occurredAt:s.now,evidence:'实际签收凭据-不应进入请求指纹正文',reference:'CARRIER-FACT-1',reason:'原运单实际送达',...extra},a);},verify(extra={},a=support){return f.write('goods-logistics.delivery-verify',{id:f.o.id,factId:f.fact.id,version:f.o.version,decision:'verified',occurredAt:s.now,evidence:'实际核实证据-不应进入请求指纹正文',reason:'核实原运单和实际签收',...extra},a);},ready(){f.publish();f.create();f.advance(20);f.record({occurredAt:s.now-10*MIN});f.verify();f.advance(50);return f;}};
  return f;
}
const money=f=>structuredClone({status:f.o.status,receivedAt:f.o.receivedAt,payment:f.o.payment,paidCents:f.o.paidCents,lines:f.o.lines,refunds:f.o.refunds,commissionPaidCents:f.o.commissionPaidCents,stocks:f.s.skus.map(k=>[k.id,k.stock]),bills:f.s.bills,recoveries:f.s.recoveries});
test('C06 物流升级只增空配置/摘要容器，无配置或旧单不追补规则与签收',()=>{
  const f=fixture();f.create();const before=money(f);upgradeGoodsLogisticsPolicy(f.s);upgradeGoodsLogisticsPolicy(f.s);assert.deepEqual(f.s.goodsLogisticsPolicies,[]);assert.deepEqual(f.o.logisticsPolicySnapshot,null);f.publish();captureGoodsLogisticsPolicy(f.s,f.o);assert.equal(f.o.logisticsPolicySnapshot,null);assert.equal(goodsLogisticsAutoReceipt(f.s,f.o).eligible,false);assert.deepEqual(money(f),before);
});
test('C06 发布需明确启停/范围/依据/版本与有效时间，空字段不变默认政策',()=>{
  for(const extra of [{scope:''},{autoReceiptMode:''},{autoReceiptMinutes:''},{reason:''},{version:''},{effectiveAt:0},{effectiveAt:'2026-02-30T12:00'},{compensationMode:''},{unclaimedMode:''},{scope:'skus',skuIds:'missing'},{scope:'skus',skuIds:'oil,oil'},{compensationMode:'case-agreement',compensationBasis:''},{unclaimedMode:'manual-hold',unclaimedBasis:''}]){const f=fixture(),before=structuredClone(f.s);assert.throws(()=>f.publish(extra));assert.deepEqual(f.s,before);}
  const f=fixture(),p=f.publish({autoReceiptMode:'disabled'});assert.equal(p.autoReceiptMinutes,null);assert.equal(p.productionApproved,false);assert.equal(p.returnBackFollowupMinutes,null);
});
test('C06 未来与整单SKU适用范围校验，旧单锁定的规则不随新配置变化',()=>{
  const f=fixture();f.publish({effectiveAt:f.s.now+MIN});f.create();assert.equal(f.o.logisticsPolicySnapshot,null);
  const a=fixture();a.publish({scope:'skus',skuIds:'oil'});a.create(true);assert.equal(a.o.logisticsPolicySnapshot,null);
  const b=fixture();const original=b.publish();b.create();b.advance(1);b.publish({autoReceiptMinutes:10});captureGoodsLogisticsPolicy(b.s,b.o);assert.equal(b.o.logisticsPolicySnapshot.id,original.id);assert.equal(b.o.logisticsPolicySnapshot.autoReceiptMinutes,60);
});
test('C06 实际签收与核实均必须有原运单、真实时间、证据，登记不改原资金',()=>{
  for(const extra of [{occurredAt:0},{occurredAt:Date.parse('2030-01-01')},{occurredAt:'2026-02-30T10:00'},{evidence:''},{reference:''},{reason:''},{kind:'shipped'}]){const f=fixture();f.publish();f.create();const before=money(f);assert.throws(()=>f.record(extra));assert.deepEqual(money(f),before);}
  const f=fixture();f.publish();f.create();f.advance(5);const before=money(f);f.record();assert.equal(f.fact.status,'pending');assert.equal(goodsLogisticsAutoReceipt(f.s,f.o).eligible,false);f.verify();assert.deepEqual(money(f),before);assert.equal(f.fact.verifications[0].by.job,'support');
});
test('C06 自动收货起算原实际签收时间，不取出库、登记或核实时间',()=>{
  const f=fixture();f.publish();f.create();const shipped=f.o.shipment.at;f.advance(20);f.record({occurredAt:shipped+10*MIN});f.verify();assert.equal(goodsLogisticsAutoReceipt(f.s,f.o).dueAt,shipped+70*MIN);f.advance(49);assert.equal(goodsLogisticsAutoReceipt(f.s,f.o).eligible,false);f.advance(1);assert.equal(goodsLogisticsAutoReceipt(f.s,f.o).eligible,true);
});
test('C06 只有最新完整核实的真实事实有效，更正旧事实保留原证据',()=>{
  const f=fixture().ready(),old=f.fact.id;f.record({replacesId:old,reference:'CORRECTED',reason:'追加真实更正依据'});assert.equal(f.o.goodsDeliveryFacts[0].replacedBy,f.fact.id);assert.equal(goodsLogisticsAutoReceipt(f.s,f.o).eligible,false);assert.throws(()=>f.verify({factId:old}),/已更正/);f.verify();f.advance(60);assert.equal(goodsLogisticsAutoReceipt(f.s,f.o).eligible,true);f.fact.verifications=[];assert.equal(goodsLogisticsAutoReceipt(f.s,f.o).eligible,false);
});
test('C06 到期仍拦截所有原未结售后、异常及待确定退款，不能凭时钟放行',()=>{
  for(const mutate of [o=>o.cases.push({id:'C',status:'requested'}),o=>o.cases.push({id:'C',status:'partial_confirmation'}),o=>o.incidents.push({id:'I',status:'open'}),o=>o.incidents.push({id:'I',status:'awaiting_user'}),o=>o.incidents.push({id:'I',status:'waiting'}),o=>o.refunds.push({id:'R',status:'processing'}),o=>o.refunds.push({id:'R',status:'failed'}),o=>o.refunds.push({id:'R',status:'unknown'})]){const f=fixture().ready();mutate(f.o);let calls=0;assert.equal(goodsLogisticsAutoReceipt(f.s,f.o).eligible,false);tickGoodsLogistics(f.s,{receiveGoods:()=>calls++});assert.equal(calls,0);assert.equal(f.o.status,'shipped');}
  const f=fixture().ready();f.o.incidents.push({id:'I',status:'open'});assert.equal(goodsLogisticsAutoReceipt(f.s,f.o).eligible,false);f.o.incidents[0].status='done';assert.equal(goodsLogisticsAutoReceipt(f.s,f.o).eligible,true);
});
test('C06 原运单或未发布快照失配不能自动收货，纯判定不改数据',()=>{
  const f=fixture().ready(),before=structuredClone(f.s);goodsLogisticsAutoReceipt(f.s,f.o);goodsLogisticsTaskRows(f.s);assert.deepEqual(f.s,before);f.o.shipment.tracking='another';assert.equal(goodsLogisticsAutoReceipt(f.s,f.o).eligible,false);
  const a=fixture().ready();a.o.logisticsPolicySnapshot.autoReceiptMinutes=1;assert.equal(goodsLogisticsAutoReceipt(a.s,a.o).eligible,false);
});
test('C06 仅受控原收货回调能记收货，空接线不伪完成，重复tick不重复调用',()=>{
  const f=fixture().ready(),before=money(f),report=tickGoodsLogistics(f.s);assert.deepEqual(report.unconfigured,[f.o.id]);assert.deepEqual(money(f),before);let calls=0,metadata;
  const ctx={receiveGoods:(o,m)=>{calls++;metadata=m;o.status='received';o.receivedAt=m.confirmedAt;}};tickGoodsLogistics(f.s,ctx);tickGoodsLogistics(f.s,ctx);assert.equal(calls,1);assert.equal(metadata.source,'logistics-auto');assert.equal(metadata.factId,f.fact.id);assert.equal(metadata.occurredAt,f.fact.occurredAt);assert.equal(metadata.policyVersion,1);assert.equal(f.o.commissionPaidCents,0);
});
test('C06 新请求只存可靠摘要，原请求重放一次、旧版本与跨岗位拒绝',()=>{
  const f=fixture();f.publish();f.create();const p={id:f.o.id,version:f.o.version,kind:'signed',occurredAt:f.s.now,evidence:'私密原始证据字符串',reference:'REAL-1',reason:'核实原事实',requestId:'stable-fact'};
  f.write('goods-logistics.delivery-record',p,warehouse);f.write('goods-logistics.delivery-record',p,warehouse);assert.equal(f.o.goodsDeliveryFacts.length,1);assert.throws(()=>f.write('goods-logistics.delivery-record',{...p,reason:'改变'},warehouse),/同一提交/);assert.throws(()=>f.write('goods-logistics.delivery-record',{...p,requestId:'new'},warehouse),/已更新/);
  const sorted=x=>Array.isArray(x)?x.map(sorted):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,sorted(x[k])])):x;
  assert.equal(f.s.goodsLogisticsRequests.at(-1).fingerprint,createHash('sha256').update(JSON.stringify(sorted({type:'goods-logistics.delivery-record',p}))).digest('hex'));assert.ok(!JSON.stringify(f.s.goodsLogisticsRequests).includes(p.evidence));
  assert.throws(()=>f.verify({},warehouse),/无权/);assert.throws(()=>f.record({},user),/无权/);
});
test('C06 原核实签收被使用后更正必须经过签收争议，不直接回退已收货或资金',()=>{
  const f=fixture().ready();f.o.status='received';f.o.receivedAt=f.s.now;const before=money(f);assert.throws(()=>f.verify({decision:'rejected'}),/签收争议/);assert.throws(()=>f.record({replacesId:f.fact.id}),/签收争议/);assert.deepEqual(money(f),before);
  f.o.incidents.push({id:'DISPUTE',kind:'receipt-dispute',status:'open'});f.verify({decision:'rejected'});assert.equal(f.fact.status,'rejected');assert.deepEqual(money(f),before);
});
test('C06 人工跟进来自本单已锁规则，时点不销毁货物、扣款或自动结案',()=>{
  const f=fixture();f.publish({deliveryFollowupMinutes:10,returnTransitFollowupMinutes:20,returnBackFollowupMinutes:30,unclaimedMode:'manual-hold',unclaimedBasis:'人工保管与联系用户，不自行处置'});f.create();f.o.cases.push({id:'C',status:'return_to_customer_shipping',returnShipment:{at:f.s.now},backShipment:{at:f.s.now},custody:'集团仓储'});const before=money(f),rows=goodsLogisticsTaskRows(f.s);assert.deepEqual(rows.filter(r=>r.dueAt!=null).map(r=>r.dueAt-f.s.now),[10*MIN,20*MIN,30*MIN]);f.advance(60);tickGoodsLogistics(f.s);assert.equal(f.o.cases[0].status,'return_to_customer_shipping');assert.equal(f.o.cases[0].custody,'集团仓储');assert.deepEqual(money(f),before);
});

test('C06 三类运单跟进使用稳定ASCII任务编号，兼容原导航安全校验',()=>{
  const f=fixture();f.publish({deliveryFollowupMinutes:10,returnTransitFollowupMinutes:20,returnBackFollowupMinutes:30});f.create();f.o.cases.push({id:'AS-ASCII-1',status:'return_to_customer_shipping',returnShipment:{at:f.s.now},backShipment:{at:f.s.now}});
  const rows=goodsLogisticsTaskRows(f.s);assert.deepEqual(rows.map(r=>r.id),[`goods-logistics:${f.o.id}:delivery`,'goods-logistics:AS-ASCII-1:return','goods-logistics:AS-ASCII-1:return-back']);
  assert.deepEqual(rows.map(r=>r.title),['配送运单跟进','寄回运单跟进','返还运单跟进']);for(const r of rows)assert.match(r.id,/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/);
  f.s.now+=60*MIN;assert.deepEqual(goodsLogisticsTaskRows(f.s).map(r=>r.id),rows.map(r=>r.id));
});
