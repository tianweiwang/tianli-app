import test from 'node:test';
import assert from 'node:assert/strict';
import { seed, reduce, availableStock, goodsSummary, upgradeGoods } from './engine.mjs';
import { goodsIncidentView, upgradeGoodsExceptions, syncGoodsExceptions } from './goods-exceptions.mjs';

const user={role:'user',userId:'u1'},other={role:'user',userId:'u2'},support={role:'group',job:'support'},warehouse={role:'group',job:'warehouse'},finance={role:'group',job:'finance'},store={role:'store',storeId:'xingfu'};
function fixture(qty=2) {
  let s=seed(),request=0;
  const f={get s(){return s;},run(type,p={},a=user){s=reduce(s,a,type,p);return s;},order(){return s.goods[0];},case(){return f.order().cases.at(-1);},incident(){return f.order().incidents.at(-1);},new(type,p={},a=user){return f.run(type,{id:f.order().id,version:type==='goods.incident-open'||type==='goods.address-change'||type==='goods.case'?f.order().version:type.startsWith('goods.incident-')?f.incident().version:f.case().version,requestId:`new-${++request}`,...p},a);},paid(){f.run('goods.pay',{id:f.order().id,outcome:'success'});return f;},shipped(){f.paid();f.run('goods.ship',{id:f.order().id,carrier:'演示物流',tracking:'D-1'},warehouse);return f;},returnCase(){f.new('goods.case',{kind:'return',skuId:'oil',qty,amountCents:20000*qty,shippingCents:1000,reason:'申请退货'});f.run('goods.case-review',{id:f.order().id,caseId:f.case().id,decision:'approve',reason:'同意'},support);return f;},sent(){f.returnCase();f.run('goods.return',{id:f.order().id,caseId:f.case().id,carrier:'演示物流',tracking:'R-1'});return f;},partial(){f.new('goods.inspect-partial',{caseId:f.case().id,qty:1,evidence:'现场清点仅一件，照片编号 P1'},warehouse);return f;},proposal(resolution='refund',amountCents=18000,shippingCents=500){f.new('goods.partial-propose',{caseId:f.case().id,qty:f.case().partialReceipt.qty,resolution,amountCents:resolution==='refund'?amountCents:0,shippingCents:resolution==='refund'?shippingCents:0,reason:'双方逐案协商；未寄回数量由用户保留'},support);return f;},confirm(decision='accept'){f.new('goods.partial-confirm',{caseId:f.case().id,decision,reason:decision==='accept'?'同意实收数量和金额；未寄回一件我保留、本案不退款':'拒绝此方案，请继续核实'});return f;},open(stage='delivery',kind='delay',caseId){f.new('goods.incident-open',{stage,kind,caseId,reason:'物流事实待核实',dueAt:null},support);return f;},incidentProposal(resolution='continue',caseId){f.new('goods.incident-propose',{incidentId:f.incident().id,resolution,caseId,reason:'已向物流核查，请用户确认处理方案'},support);return f;},incidentConfirm(decision='accept'){f.new('goods.incident-confirm',{incidentId:f.incident().id,decision,reason:'已阅读方案并确认'});return f;}};
  f.run('promotion.enter',{storeId:'xingfu'}); f.run('cart.set',{skuId:'oil',qty}); f.run('cart.set',{skuId:'care',qty:1}); f.run('goods.submit',{addressId:'AD1',requestId:'submit'}); return f;
}
function financial(f) { const o=f.order(); return structuredClone({status:o.status,paidCents:o.paidCents,lines:o.lines,refunds:o.refunds,stocks:f.s.skus.map(x=>[x.id,x.stock]),summary:goodsSummary(f.s,o),moves:f.s.stockMoves}); }
const casePayload=f=>({id:f.order().id,caseId:f.case().id});

test('旧存档增量兼容及重复升级，不从异常补造退款或库存事实',()=>{
  const f=fixture().shipped(),s=structuredClone(f.s); delete s.goods[0].version; delete s.goods[0].incidents; delete s.goodsExceptionRequests; delete s.goods[0].addressHistory;
  const funds=financial(f); upgradeGoods(s); const once=structuredClone(s); upgradeGoodsExceptions(s); syncGoodsExceptions(s); assert.deepEqual(s,once); assert.deepEqual(s.goods[0].refunds,funds.refunds); assert.equal(s.goods[0].version,0);
});

test('同省同市本人改址保留快照历史，原地址改写不影响订单',()=>{
  const f=fixture().paid(),o=f.order(),first=structuredClone(o.address),amount=o.paidCents,source=structuredClone(o.source);
  f.run('address.save',{name:'王女士',phone:'13800008000',province:'江苏省',city:'南京市',detail:'新演示地址'}); const addressId=f.s.addresses.at(-1).id;
  f.new('goods.address-change',{addressId}); assert.equal(f.order().address.detail,'新演示地址'); assert.deepEqual(f.order().addressHistory[0].before,first); assert.equal(f.order().paidCents,amount); assert.deepEqual(f.order().source,source);
  f.run('address.save',{id:addressId,name:'王女士',phone:'13800008000',province:'江苏省',city:'南京市',detail:'地址簿再编辑'}); assert.equal(f.order().address.detail,'新演示地址');
});
test('改址拒绝他人、跨区域、发货后与旧版本，失败输入原样保留',()=>{
  const f=fixture().paid(),p={id:f.order().id,addressId:'AD2',version:f.order().version,requestId:'address'}; const before=structuredClone(f.s);
  assert.throws(()=>f.run('goods.address-change',p),/本人/); assert.deepEqual(f.s,before); assert.throws(()=>f.run('goods.address-change',p,other),/无权/);
  f.run('address.save',{name:'王女士',phone:'13800008000',province:'江苏省',city:'苏州市',detail:'跨市'}); assert.throws(()=>f.new('goods.address-change',{addressId:f.s.addresses.at(-1).id}),/同省同市/);
  assert.throws(()=>f.run('goods.address-change',{...p,addressId:'AD1',version:-1}),/记录已更新/); f.run('goods.ship',{id:f.order().id,carrier:'演示物流',tracking:'D-1'},warehouse); assert.throws(()=>f.new('goods.address-change',{addressId:'AD1'}),/未发货/);
});
test('改址请求同内容重放一次、复用标识改内容或操作会拒绝',()=>{
  const f=fixture().paid();f.run('address.save',{name:'王女士',phone:'13800008000',province:'江苏省',city:'南京市',detail:'新演示地址'});
  const p={id:f.order().id,addressId:f.s.addresses.at(-1).id,version:f.order().version,requestId:'same'};f.run('goods.address-change',p);f.run('goods.address-change',p);assert.equal(f.order().addressHistory.length,1);
  assert.throws(()=>f.run('goods.address-change',{...p,addressId:'AD1'}),/标识/); assert.throws(()=>f.run('goods.case',{id:p.id,kind:'cancel',skuId:'oil',qty:1,reason:'取消',version:f.order().version,requestId:'same'}),/标识/);
});

test('按商品取消仅释放选定数量，剩余商品在退款失败期间仍可发货',()=>{
  const f=fixture().paid();f.new('goods.case',{kind:'cancel',skuId:'oil',qty:1,reason:'取消一件'}); assert.equal(f.case().amountCents,20000); assert.equal(f.case().shippingCents,0);
  f.run('goods.case-review',{...casePayload(f),decision:'approve',reason:'批准选定一件'},support); assert.equal(f.order().status,'paid'); assert.equal(f.order().lines[0].cancelledQty,1); assert.equal(availableStock(f.s,'oil'),11);
  f.run('goods.refund',{...casePayload(f),outcome:'failed'},finance); const refundId=f.order().refunds[0].id;f.run('goods.ship',{id:f.order().id,carrier:'演示物流',tracking:'D-2'},warehouse);assert.equal(f.s.skus.find(x=>x.id==='oil').stock,11);assert.equal(f.s.skus.find(x=>x.id==='care').stock,19);
  f.run('goods.refund',{...casePayload(f),outcome:'processing'},finance);f.run('goods.refund-query',{...casePayload(f),outcome:'success'},finance);assert.equal(f.order().refunds[0].id,refundId);assert.equal(goodsSummary(f.s,f.order()).netCents,31000);assert.equal(goodsSummary(f.s,f.order()).commissionCents,4000);
});
test('按行取消数量占用防重复，新载荷缺版本或标识拒绝，旧载荷仍整单',()=>{
  const f=fixture().paid();assert.throws(()=>f.run('goods.case',{id:f.order().id,kind:'cancel',skuId:'oil',qty:1,reason:'取消',requestId:'line'}),/版本/);assert.throws(()=>f.run('goods.case',{id:f.order().id,kind:'cancel',skuId:'oil',qty:1,reason:'取消',version:f.order().version}),/标识/);
  f.new('goods.case',{kind:'cancel',skuId:'oil',qty:1,reason:'取消一件'}); assert.throws(()=>f.new('goods.case',{kind:'cancel',skuId:'oil',qty:2,reason:'重复取消'}),/件数/);assert.throws(()=>f.run('goods.ship',{id:f.order().id,carrier:'物流',tracking:'D'},warehouse),/不能发货/);
  const old=fixture().paid();old.run('goods.case',{id:old.order().id,kind:'cancel',skuId:'oil',qty:1,amountCents:0,reason:'旧整单'});assert.equal(old.case().allocations.length,2);assert.equal(old.case().amountCents,50000);assert.equal(old.case().shippingCents,1000);
});
test('并行按行全取消只最终案件退款运费，库存/资金总额守恒',()=>{
  const f=fixture().paid();f.new('goods.case',{kind:'cancel',skuId:'oil',qty:2,reason:'取消oil'});const first=f.case().id;f.new('goods.case',{kind:'cancel',skuId:'care',qty:1,reason:'取消care'});const second=f.case().id;
  assert.equal(f.case().shippingCents,0);f.run('goods.case-review',{id:f.order().id,caseId:first,decision:'approve',reason:'同意'},support);assert.equal(f.order().status,'paid');f.run('goods.case-review',{id:f.order().id,caseId:second,decision:'approve',reason:'同意'},support);assert.equal(f.order().status,'cancelled');assert.equal(f.case().shippingCents,1000);
  for(const caseId of [first,second])f.run('goods.refund',{id:f.order().id,caseId,outcome:'success'},finance);assert.equal(goodsSummary(f.s,f.order()).netCents,0);assert.equal(availableStock(f.s,'oil'),12);assert.equal(availableStock(f.s,'care'),20);
});
test('新按行取消重放不增案件、取消数量与退款，旧页面新提交拒绝',()=>{
  const f=fixture().paid(),p={id:f.order().id,kind:'cancel',skuId:'oil',qty:1,reason:'取消一件',version:f.order().version,requestId:'line-repeat'};
  f.run('goods.case',p);f.run('goods.case',p);assert.equal(f.order().cases.length,1);f.run('goods.case-review',{...casePayload(f),decision:'approve',reason:'同意'},support);f.run('goods.case',p);assert.equal(f.order().lines[0].cancelledQty,1);assert.throws(()=>f.run('goods.case',{...p,requestId:'fresh'}),/版本/);
});

test('未寄回主动撤回释放占额，保留撤回原因，仍可重新申请',()=>{
  const f=fixture().shipped().returnCase();const c=structuredClone(f.case()),before=financial(f);f.new('goods.case-withdraw',{caseId:c.id,reason:'暂不寄回，主动撤回'});assert.equal(f.case().status,'closed');assert.equal(f.case().withdrawal.reason,'暂不寄回，主动撤回');assert.equal(f.case().history.at(-1).action,'用户主动撤回售后申请');assert.deepEqual(f.order().refunds,before.refunds);assert.deepEqual(f.order().lines,before.lines);
  f.new('goods.case',{kind:'return',skuId:'oil',qty:2,amountCents:40000,reason:'重新申请'});assert.equal(f.order().cases.length,2);
});
test('寄回、仓储实收或退款事实后不可撤回，其他用户及门店无权',()=>{
  const f=fixture().shipped().sent(),p={...casePayload(f),version:f.case().version,requestId:'withdraw',reason:'撤回'};assert.throws(()=>f.run('goods.case-withdraw',p),/已有寄回/);assert.throws(()=>f.run('goods.case-withdraw',p,other),/无权/);assert.throws(()=>f.run('goods.case-withdraw',p,store),/无权/);
});
test('未寄回异常因本人主动撤回事实办结，不以任意closed或rejected推断',()=>{
  const f=fixture().shipped().returnCase();f.open('return','not-returned',f.case().id);f.new('goods.case-withdraw',{caseId:f.case().id,reason:'主动撤回，暂无退货需求'});assert.equal(f.incident().status,'done');assert.match(f.incident().completionReason,/主动撤回/);assert.equal(f.order().refunds.length,0);
  const s=structuredClone(f.s);s.goods[0].cases[0].withdrawal=null;s.goods[0].incidents[0].status='open';syncGoodsExceptions(s);assert.equal(s.goods[0].incidents[0].status,'open');s.goods[0].cases[0].status='rejected';syncGoodsExceptions(s);assert.equal(s.goods[0].incidents[0].status,'open');
});

test('部分验货只留实物事实，不变库存、退款或原申请快照',()=>{
  const f=fixture().shipped().sent(),before=financial(f);f.partial();assert.equal(f.case().status,'partial_received');assert.equal(f.case().partialReceipt.qty,1);assert.equal(f.case().originalRequestSnapshot.qty,2);assert.equal(f.case().originalRequestSnapshot.amountCents,40000);assert.deepEqual(financial(f),before);assert.equal(f.case().receipts.length,1);
});
test('部分实收版本/岗位/数量/证据和请求重放严格校验',()=>{
  const f=fixture().shipped().sent(),p={...casePayload(f),version:f.case().version,requestId:'receive-1',qty:1,evidence:'现场证据'};assert.throws(()=>f.run('goods.inspect-partial',p,support),/岗位|仓储/);assert.throws(()=>f.run('goods.inspect-partial',{...p,version:-1},warehouse),/版本/);assert.throws(()=>f.run('goods.inspect-partial',{...p,qty:2},warehouse),/小于/);assert.throws(()=>f.run('goods.inspect-partial',{...p,evidence:''},warehouse),/证据/);
  f.run('goods.inspect-partial',p,warehouse);f.run('goods.inspect-partial',p,warehouse);assert.equal(f.case().partialReceipt.qty,1);assert.equal(f.case().receipts.length,1);assert.throws(()=>f.run('goods.inspect-partial',{...p,qty:2},warehouse),/标识/);
});
test('客服逐案金额受原申请及实收金额限制，不自动按比例退款',()=>{
  const f=fixture().shipped().sent().partial(),p={caseId:f.case().id,qty:1,resolution:'refund',amountCents:21000,shippingCents:0,reason:'协商'};assert.throws(()=>f.new('goods.partial-propose',p,support),/超过/);assert.throws(()=>f.new('goods.partial-propose',{...p,qty:2,amountCents:18000},support),/全部/);assert.throws(()=>f.new('goods.partial-propose',{...p,amountCents:18000},warehouse),/岗位|客服/);
  f.proposal();assert.equal(f.case().amountCents,40000);assert.equal(f.case().partialProposal.amountCents,18000);assert.equal(f.case().status,'partial_confirmation');assert.equal(f.order().refunds.length,0);
});
test('用户接受后仅处置实收一件，确认未寄回保留，并沿原退款失败/查询链',()=>{
  const f=fixture().shipped().sent().partial().proposal().confirm();assert.equal(f.case().qty,1);assert.equal(f.case().keptQty,1);assert.equal(f.case().unreturnedDisposition.refundCents,0);assert.equal(f.case().status,'awaiting_return_disposition');assert.equal(f.case().amountCents,18000);assert.equal(f.case().originalRequestSnapshot.amountCents,40000);
  f.new('goods.inspect',{caseId:f.case().id,disposition:'sellable'},warehouse);assert.equal(f.order().lines[0].returnedQty,1);assert.equal(f.s.skus.find(x=>x.id==='oil').stock,11);f.run('goods.refund',{...casePayload(f),outcome:'failed'},finance);const refundId=f.order().refunds[0].id;f.run('goods.refund',{...casePayload(f),outcome:'processing'},finance);f.run('goods.refund-query',{...casePayload(f),outcome:'success'},finance);assert.equal(f.order().refunds[0].id,refundId);assert.equal(goodsSummary(f.s,f.order()).netCents,32500);assert.equal(goodsSummary(f.s,f.order()).commissionCents,4200);
  f.new('goods.case',{kind:'return',skuId:'oil',qty:1,amountCents:20000,reason:'剩余一件新申请'});assert.equal(f.case().qty,1);assert.throws(()=>f.new('goods.case',{kind:'return',skuId:'oil',qty:1,amountCents:1000,reason:'超实物数量'}),/件数/);
});
test('部分验货后旧全量inspect不能执行，确认后相同请求不得重复入库',()=>{
  const f=fixture().shipped().sent().partial();assert.throws(()=>f.run('goods.inspect',{...casePayload(f),disposition:'sellable'},warehouse),/标识/);assert.throws(()=>f.new('goods.inspect',{caseId:f.case().id,disposition:'sellable'},warehouse),/尚未寄回|验收/);
  f.proposal().confirm();const p={...casePayload(f),version:f.case().version,requestId:'dispose',disposition:'sellable'};f.run('goods.inspect',p,warehouse);f.run('goods.inspect',p,warehouse);assert.equal(f.order().lines[0].returnedQty,1);assert.equal(f.s.skus.find(x=>x.id==='oil').stock,11);assert.throws(()=>f.run('goods.inspect',{...p,requestId:'new-dispose'},warehouse),/版本/);
});
test('用户驳回后可补记后续实收，全部到齐再走原全量验收',()=>{
  const f=fixture().shipped().sent().partial().proposal().confirm('reject');assert.equal(f.case().status,'partial_received');assert.equal(f.case().qty,2);f.new('goods.inspect-partial',{caseId:f.case().id,qty:1,evidence:'第二批补寄已清点'},warehouse);assert.equal(f.case().partialReceipt.qty,2);assert.equal(f.case().receipts.length,2);assert.equal(f.case().partialProposalHistory[0].status,'rejected');assert.equal(f.case().status,'returning');assert.equal(f.case().amountCents,40000);
  f.new('goods.inspect',{caseId:f.case().id,disposition:'sellable'},warehouse);f.run('goods.refund',{...casePayload(f),outcome:'success'},finance);assert.equal(f.order().lines[0].returnedQty,2);assert.equal(goodsSummary(f.s,f.order()).refundedCents,41000);
});
test('部分实收协商返还只寄实收一件，剩余用户持有，无库存或退款增量',()=>{
  const f=fixture().shipped().sent().partial().proposal('return-back').confirm(),before=financial(f);assert.equal(f.case().status,'awaiting_return_to_customer');assert.equal(f.case().keptQty,1);f.run('goods.return-back',{...casePayload(f),carrier:'演示物流',tracking:'B-1',feePayer:'group',reason:'双方同意返还实收一件'},warehouse);assert.equal(f.case().backShipment.qty,1);f.run('goods.return-back-receive',casePayload(f));assert.equal(f.case().status,'closed');assert.deepEqual(f.order().lines,before.lines);assert.deepEqual(f.order().refunds,before.refunds);assert.deepEqual(f.s.skus.map(x=>[x.id,x.stock]),before.stocks);assert.equal(f.case().originalRequestSnapshot.qty,2);
});

test('人工异常登记/到期跟进仅保留事实，绝不自动款库存或结案',()=>{
  const f=fixture().shipped(),before=financial(f);f.open();f.new('goods.incident-note',{incidentId:f.incident().id,reason:'人工催办，等待物流答复',dueAt:f.s.now+60000},warehouse);f.run('clock.advance',{minutes:10});assert.equal(f.incident().status,'open');assert.equal(f.incident().dueAt<f.s.now,true);assert.deepEqual(financial(f),before);assert.equal(f.incident().records.length,2);
});
test('异常continue须本人确认，随后原收货事实办结且无直接done命令',()=>{
  const f=fixture().shipped().open().incidentProposal(),before=financial(f);assert.equal(f.incident().status,'awaiting_user');assert.throws(()=>f.new('goods.incident-confirm',{incidentId:f.incident().id,decision:'accept',reason:'确认'},other),/无权/);f.incidentConfirm();assert.equal(f.incident().status,'waiting');assert.deepEqual(financial(f),before);assert.throws(()=>f.new('goods.incident-close',{incidentId:f.incident().id}),/不支持/);
  f.run('goods.receive',{id:f.order().id});assert.equal(f.incident().status,'done');assert.match(f.incident().completionReason,/确认收货/);
});
test('异常驳回后保留原方案历史，可重新协商；pending不可覆盖',()=>{
  const f=fixture().shipped().open().incidentProposal();assert.throws(()=>f.incidentProposal(),/等待用户/);f.incidentConfirm('reject');assert.equal(f.incident().status,'open');f.incidentProposal();assert.equal(f.incident().proposalHistory.length,1);assert.equal(f.incident().proposalHistory[0].status,'rejected');
});
test('异常退款只绑定本单原售后，失败/处理中继续等待，成功后办结',()=>{
  const f=fixture().shipped().open();assert.throws(()=>f.incidentProposal('refund'),/原售后/);f.new('goods.case',{kind:'refund',skuId:'oil',qty:1,amountCents:10000,reason:'丢失协商退款'});const caseId=f.case().id;f.incidentProposal('refund',caseId).incidentConfirm();assert.equal(f.incident().status,'waiting');f.run('goods.case-review',{...casePayload(f),decision:'approve',reason:'同意'},support);f.run('goods.refund',{...casePayload(f),outcome:'failed'},finance);assert.equal(f.incident().status,'waiting');f.run('goods.refund',{...casePayload(f),outcome:'processing'},finance);assert.equal(f.incident().status,'waiting');f.run('goods.refund-query',{...casePayload(f),outcome:'success'},finance);assert.equal(f.incident().status,'done');assert.equal(goodsSummary(f.s,f.order()).refundedCents,10000);
});
test('未寄回异常等待真实运单；已寄回延误须等仓储事实，不因已有运单假结案',()=>{
  const f=fixture().shipped().returnCase();f.open('return','not-returned',f.case().id).incidentProposal('continue',f.case().id).incidentConfirm();assert.equal(f.incident().status,'waiting');f.run('goods.return',{...casePayload(f),carrier:'演示物流',tracking:'R-1'});assert.equal(f.incident().status,'done');
  f.open('return','delay',f.case().id).incidentProposal('continue',f.case().id).incidentConfirm();assert.equal(f.incident().status,'waiting');f.run('goods.inspect',{...casePayload(f),disposition:'sellable'},warehouse);assert.equal(f.incident().status,'done');
});
test('拒退返还无人签收保持跟进，只有用户原收货能办结',()=>{
  const f=fixture().shipped().sent().partial().proposal('return-back').confirm();f.run('goods.return-back',{...casePayload(f),carrier:'演示物流',tracking:'B-1',feePayer:'group',reason:'返还实收货'},warehouse);f.open('return-back','unclaimed',f.case().id).incidentProposal('return-back',f.case().id).incidentConfirm();assert.equal(f.incident().status,'waiting');f.run('clock.advance',{minutes:40000});assert.equal(f.incident().status,'waiting');assert.equal(f.order().refunds.length,0);f.run('goods.return-back-receive',casePayload(f));assert.equal(f.incident().status,'done');assert.match(f.incident().completionReason,/返还原货/);
});
test('异常角色隔离、源版本和提交内容重放，门店仅查看锁定推广单',()=>{
  const f=fixture().shipped(),p={id:f.order().id,stage:'delivery',kind:'delay',reason:'配送延迟',version:f.order().version,requestId:'incident'};assert.throws(()=>f.run('goods.incident-open',p,finance),/岗位|跟进/);assert.throws(()=>f.run('goods.incident-open',p,store),/无权/);f.run('goods.incident-open',p,support);f.run('goods.incident-open',p,support);assert.equal(f.order().incidents.length,1);assert.throws(()=>f.run('goods.incident-open',{...p,reason:'不同事实'},support),/标识/);assert.throws(()=>f.new('goods.incident-propose',{incidentId:f.incident().id,resolution:'continue',reason:'继续'},warehouse),/岗位|客服/);
  const tracked=goodsIncidentView(f.s,store,f.order().id);assert.equal(tracked.length,1);assert.equal(tracked[0].reason,undefined);assert.equal(tracked[0].records,undefined);assert.equal(tracked[0].dueAt,undefined);assert.equal(goodsIncidentView(f.s,{role:'store',storeId:'silver'}).length,0);assert.equal(goodsIncidentView(f.s,other).length,0);assert.deepEqual(goodsIncidentView(f.s,{role:'group',job:'operations'}),[]);assert.deepEqual(goodsIncidentView(f.s,{role:'group',job:'account-admin'}),[]);const view=goodsIncidentView(f.s,user);view[0].reason='不能反写';assert.equal(f.incident().reason,'配送延迟');
});
test('配送异常不能用取消单或已完成历史退款办结',()=>{
  const f=fixture().paid();f.new('goods.case',{kind:'cancel',skuId:'care',qty:1,reason:'发货前取消care'});const cancelId=f.case().id;f.run('goods.case-review',{...casePayload(f),decision:'approve',reason:'同意'},support);f.run('goods.refund',{...casePayload(f),outcome:'success'},finance);f.run('goods.ship',{id:f.order().id,carrier:'演示物流',tracking:'D'},warehouse);f.open();assert.throws(()=>f.incidentProposal('refund',cancelId),/仍办理/);
  f.new('goods.case',{kind:'refund',skuId:'oil',qty:1,amountCents:10000,reason:'历史售后'});const old=f.case().id;f.run('goods.case-review',{...casePayload(f),decision:'approve',reason:'同意'},support);f.run('goods.refund',{...casePayload(f),outcome:'success'},finance);assert.throws(()=>f.incidentProposal('refund',old),/仍办理/);assert.equal(f.incident().status,'open');
});
test('已收货配送只可登记实际破损，不能创建延迟或丢失来假办结',()=>{
  const f=fixture().shipped();f.run('goods.receive',{id:f.order().id});for(const kind of ['delay','lost'])assert.throws(()=>f.open('delivery',kind),/已确认收货/);f.open('delivery','damaged');assert.equal(f.incident().status,'open');assert.equal(f.incident().kind,'damaged');
});
test('撤回相同提交标识重放仅一条记录、修改原因拒绝',()=>{
  const f=fixture().shipped().returnCase(),p={...casePayload(f),version:f.case().version,requestId:'withdraw-once',reason:'用户主动撤回'};f.run('goods.case-withdraw',p);f.run('goods.case-withdraw',p);assert.equal(f.case().history.filter(x=>x.action==='用户主动撤回售后申请').length,1);assert.throws(()=>f.run('goods.case-withdraw',{...p,reason:'不同原因'}),/标识/);
});
test('异常阶段准入与现有实物事实一致，不登记不存在的运输或重复未寄回',()=>{
  const f=fixture().shipped().returnCase();assert.throws(()=>f.open('return','delay',f.case().id),/尚未寄回/);f.run('goods.return',{...casePayload(f),carrier:'物流',tracking:'R'});assert.throws(()=>f.open('return','not-returned',f.case().id),/已有寄回/);f.partial().proposal('return-back').confirm();f.run('goods.return-back',{...casePayload(f),carrier:'物流',tracking:'B',feePayer:'group',reason:'双方约定返还'},warehouse);f.run('goods.return-back-receive',casePayload(f));assert.throws(()=>f.open('return-back','unclaimed',f.case().id),/运输中/);
});
test('人工日期精确校验，不接受被Date自动滚动的不存在日期',()=>{
  const f=fixture().shipped();assert.throws(()=>f.new('goods.incident-open',{stage:'delivery',kind:'delay',reason:'需跟进',dueAt:'2026-02-31T10:00'},support),/时间格式/);f.new('goods.incident-open',{stage:'delivery',kind:'delay',reason:'需跟进',dueAt:'2026-10-03T10:30'},support);assert.equal(f.incident().dueAt,Date.parse('2026-10-03T10:30:00+08:00'));
});
