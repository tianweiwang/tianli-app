import test from 'node:test';
import assert from 'node:assert/strict';
import {seed,reduce,goodsAfterSaleAvailability} from './engine.mjs';
import {resolveAccountActor} from './staff-accounts.mjs';

const user={role:'user',userId:'u1'},other={role:'user',userId:'u2'},support={role:'group',job:'support'},finance={role:'group',job:'finance'},warehouse={role:'group',job:'warehouse'};
function fixture({ship=true,pay=true,items=[['oil',3],['care',2]]}={}){
  let s=seed(),sequence=0,result;
  const h={get s(){return s;},get o(){return s.goods.at(-1);},run(type,p={},actor=user){s=reduce(s,actor,type,p,r=>result=r);return result;},get v(){return goodsAfterSaleAvailability(s,user,h.o.id);},line(skuId){return h.v.lines.find(l=>l.skuId===skuId);},
    apply(p={}){h.run('goods.case',{id:h.o.id,version:h.o.version,requestId:'availability-'+ ++sequence,reason:'真实原命令额度验证',...p});return h.o.cases.at(-1);},
    review(id,decision='approve'){h.run('goods.case-review',{id:h.o.id,caseId:id,decision,reason:'核实原申请'},support);},
    refund(id,outcome='success'){h.run('goods.refund',{id:h.o.id,caseId:id,outcome},finance);},
    ship(){h.run('goods.ship',{id:h.o.id,carrier:'原物流',tracking:'ORIGINAL-'+h.o.id},warehouse);},
    reject(p,pattern){const before=structuredClone(s);assert.throws(()=>h.apply(p),pattern);assert.deepEqual(s,before);}
  };
  for(const[skuId,qty]of items)h.run('cart.set',{skuId,qty});h.run('goods.submit',{addressId:'AD1',requestId:'availability-order'});if(pay)h.run('goods.pay',{id:h.o.id,outcome:'success'});if(pay&&ship)h.ship();return h;
}

test('真实多行订单getter只返回本人的最小原额度和版本，阶段沿原命令',()=>{
  const h=fixture({ship:false}),v=h.v;assert.equal(v.known,true);assert.equal(v.availableCents,81000);assert.equal(v.shippingCents,1000);assert.equal(v.version,h.o.version);assert.deepEqual(h.line('oil'),{skuId:'oil',known:true,reason:'',amountCents:60000,unitCents:20000,refundQty:3,returnQty:3,cancelQty:3});assert.equal(v.canCancel,true);assert.equal(v.canRefund,false);h.reject({kind:'refund',skuId:'oil',qty:1,amountCents:1},/发货后/);
  h.ship();assert.equal(h.v.canCancel,false);assert.equal(h.v.canRefund,true);assert.equal(h.v.canReturn,true);h.reject({kind:'cancel',skuId:'oil',qty:1},/未发货/);h.run('goods.receive',{id:h.o.id});assert.equal(h.v.canRefund,true);
});

test('并行SKU退款与运费占额和原金额/数量守卫一致，不因一个active案件封全部行',()=>{
  const h=fixture();h.apply({kind:'refund',skuId:'oil',qty:1,amountCents:12000,shippingCents:200});h.apply({kind:'refund',skuId:'care',qty:1,amountCents:4000,shippingCents:300});assert.equal(h.v.availableCents,64500);assert.equal(h.v.shippingCents,500);assert.equal(h.line('oil').amountCents,48000);assert.equal(h.line('care').amountCents,16000);assert.equal(h.v.canRefund,true);
  h.reject({kind:'refund',skuId:'oil',qty:3,amountCents:48001},/该商品尚可退金额/);h.reject({kind:'refund',skuId:'oil',qty:1,amountCents:20001},/所选数量实付/);h.reject({kind:'refund',skuId:'oil',qty:1,amountCents:100,shippingCents:501},/尚可退运费/);h.reject({kind:'refund',skuId:'care',qty:3,amountCents:1},/尚可退件数/);
  h.apply({kind:'refund',skuId:'oil',qty:3,amountCents:48000,shippingCents:500});assert.equal(h.line('oil').amountCents,0);assert.equal(h.v.shippingCents,0);h.reject({kind:'refund',skuId:'oil',qty:1,amountCents:1},/该商品尚可退金额/);
});

test('rejected和本人withdraw closed释放原占额，done按实际成功退款继续扣除',()=>{
  const h=fixture(),a=h.apply({kind:'refund',skuId:'oil',qty:1,amountCents:10000,shippingCents:200}),b=h.apply({kind:'refund',skuId:'care',qty:1,amountCents:4000,shippingCents:300});h.review(a.id,'reject');assert.equal(h.line('oil').amountCents,60000);assert.equal(h.v.shippingCents,700);
  const current=h.o.cases.find(c=>c.id===b.id);h.run('goods.case-withdraw',{id:h.o.id,caseId:b.id,version:current.version,requestId:'withdraw-original',reason:'本人撤回未办理原申请'});assert.equal(h.o.cases.find(c=>c.id===b.id).status,'closed');assert.equal(h.v.availableCents,81000);assert.equal(h.v.shippingCents,1000);
  const next=h.apply({kind:'refund',skuId:'oil',qty:1,amountCents:12000,shippingCents:400});h.review(next.id);h.refund(next.id);assert.equal(h.o.cases.find(c=>c.id===next.id).status,'done');assert.equal(h.v.availableCents,68600);assert.equal(h.v.shippingCents,600);assert.equal(h.line('oil').amountCents,48000);assert.equal(h.line('oil').refundQty,3);assert.equal(h.line('oil').returnQty,3);h.apply({kind:'refund',skuId:'oil',qty:3,amountCents:48000});assert.equal(h.line('oil').amountCents,0);
});

test('failed/processing原退款保持占额，成功查询同笔金额不双扣',()=>{
  const h=fixture(),c=h.apply({kind:'refund',skuId:'oil',qty:1,amountCents:10000,shippingCents:300});h.review(c.id);const held=h.v;h.refund(c.id,'failed');assert.equal(h.v.availableCents,held.availableCents);assert.equal(h.v.shippingCents,held.shippingCents);h.refund(c.id,'processing');const original=structuredClone(h.o.refunds[0]);assert.equal(h.line('oil').amountCents,50000);h.run('goods.refund-query',{id:h.o.id,caseId:c.id,outcome:'success'},finance);assert.equal(h.o.refunds[0].id,original.id);assert.equal(h.v.availableCents,70700);assert.equal(h.line('oil').amountCents,50000);assert.equal(h.v.shippingCents,700);
});

test('未检退货申请占数量；实际验收转returnedQty，不和pending数量重复扣',()=>{
  const h=fixture(),c=h.apply({kind:'return',skuId:'oil',qty:2,amountCents:30000});assert.equal(h.line('oil').returnQty,1);assert.equal(h.line('oil').refundQty,3);h.reject({kind:'return',skuId:'oil',qty:2,amountCents:1},/尚可退件数/);h.review(c.id);h.run('goods.return',{id:h.o.id,caseId:c.id,carrier:'本人原寄回物流',tracking:'RETURN-ACTUAL'});h.run('goods.inspect',{id:h.o.id,caseId:c.id,disposition:'sellable',reason:'仓库真实验收两件'},warehouse);assert.equal(h.o.lines.find(l=>l.skuId==='oil').returnedQty,2);assert.equal(h.line('oil').returnQty,1);assert.equal(h.line('oil').amountCents,30000);h.refund(c.id);assert.equal(h.line('oil').returnQty,1);assert.equal(h.line('oil').refundQty,3);h.reject({kind:'return',skuId:'oil',qty:2,amountCents:1},/尚可退件数/);h.apply({kind:'return',skuId:'oil',qty:1,amountCents:20000});assert.equal(h.line('oil').returnQty,0);
});

test('requested按行取消数量与审批cancelledQty不双扣，原最后取消补运费守恒',()=>{
  const h=fixture({ship:false,items:[['oil',2],['care',1]]}),first=h.apply({kind:'cancel',skuId:'oil',qty:1});assert.equal(h.line('oil').cancelQty,1);assert.equal(h.line('oil').amountCents,20000);assert.equal(h.line('oil').refundQty,2);h.reject({kind:'cancel',skuId:'oil',qty:2},/尚可取消件数/);h.review(first.id);assert.equal(h.line('oil').cancelQty,1);assert.equal(h.line('oil').refundQty,1);assert.equal(h.line('oil').amountCents,20000);h.refund(first.id);assert.equal(h.line('oil').cancelQty,1);
  const oil=h.apply({kind:'cancel',skuId:'oil',qty:1}),care=h.apply({kind:'cancel',skuId:'care',qty:1});assert.equal(oil.shippingCents,0);assert.equal(care.shippingCents,0);assert.equal(h.line('oil').cancelQty,0);assert.equal(h.line('care').cancelQty,0);h.review(oil.id);h.review(care.id);assert.equal(h.o.status,'cancelled');assert.equal(h.o.cases.find(c=>c.id===care.id).shippingCents,1000);assert.equal(h.v.availableCents,0);assert.equal(h.v.shippingCents,0);assert.equal(h.v.canCancel,false);h.refund(oil.id);h.refund(care.id);assert.equal(h.v.availableCents,0);assert.equal(h.v.shippingCents,0);
});

test('原仅运费申请使用同一运费余量；旧整单取消守卫保持',()=>{
  const h=fixture();h.apply({kind:'refund',amountCents:0,shippingCents:400});assert.equal(h.v.shippingCents,600);assert.equal(h.v.availableCents,80600);h.reject({kind:'refund',amountCents:0,shippingCents:601},/尚可退运费/);h.apply({kind:'refund',amountCents:0,shippingCents:600});assert.equal(h.v.shippingCents,0);assert.equal(h.line('oil').amountCents,60000);
  const old=fixture({ship:false});old.run('goods.case',{id:old.o.id,kind:'cancel',skuId:'oil',qty:1,amountCents:0,reason:'保留旧整单取消合同'});assert.equal(old.o.cases[0].allocations.length,2);assert.equal(old.o.cases[0].amountCents,80000);assert.equal(old.o.cases[0].shippingCents,1000);assert.equal(old.v.availableCents,0);old.reject({kind:'cancel'},/已有售后/);
});

test('未知原金额/数量/版本保持null和待核；已核零余额才显示0',()=>{
  const h=fixture(),cases=[
    {change:o=>delete o.lines[0].refundedCents,key:'amountCents'},
    {change:o=>delete o.lines[0].returnedQty,key:'returnQty'},
    {change:o=>delete o.lines[0].cancelledQty,key:'refundQty'},
    {change:o=>{o.lines[0].qty=null;},key:'cancelQty'},
  ];
  for(const scenario of cases){const state=structuredClone(h.s),order=state.goods[0];scenario.change(order);const before=structuredClone(state),v=goodsAfterSaleAvailability(state,user,order.id);assert.equal(v.known,false);assert.equal(v.status,'needs-review');assert.equal(v.lines[0][scenario.key],null);assert.match(v.reason,/待核对/);assert.equal(v.canRefund,false);assert.deepEqual(state,before);}
  for(const key of ['paidCents','shippingCents','version']){const state=structuredClone(h.s);delete state.goods[0][key];const v=goodsAfterSaleAvailability(state,user,h.o.id);assert.equal(v.known,false);assert.equal(v[key==='paidCents'?'availableCents':key],null);}
  const active=h.apply({kind:'return',skuId:'oil',qty:2,amountCents:10000});const missing=structuredClone(h.s);delete missing.goods[0].cases.find(c=>c.id===active.id).qty;assert.equal(goodsAfterSaleAvailability(missing,user,h.o.id).lines[0].returnQty,null);const invalid=structuredClone(h.s);delete invalid.goods[0].cases[0].allocations;assert.equal(goodsAfterSaleAvailability(invalid,user,h.o.id).availableCents,null);
});

test('getter拒绝跨本人/非用户/工作会话冒名，返回对象独立且不带敏感原明细',()=>{
  const h=fixture(),before=structuredClone(h.s),v=h.v;for(const actor of [other,support,warehouse,{role:'store',storeId:'xingfu'},null])assert.throws(()=>goodsAfterSaleAvailability(h.s,actor,h.o.id),/无权/);assert.throws(()=>goodsAfterSaleAvailability(h.s,{role:'user',userId:'u1',sessionId:'not-real'},h.o.id),/会话/);assert.throws(()=>goodsAfterSaleAvailability(h.s,user,'other-original'),/无权/);v.lines[0].amountCents=1;assert.deepEqual(h.s,before);assert.equal(h.v.lines[0].amountCents,60000);assert.doesNotMatch(JSON.stringify(h.v),/AD1|13800008000|address|allocations|tracking|payment/);
  h.run('account.enter',{accountId:'DEMO-ADMIN',grantId:'DEMO-ADMIN-GRANT',requestId:'actual-original-session'},user);const session=h.s.staffSessions.at(-1),actual=resolveAccountActor(h.s,{sessionId:session.id});assert.equal(actual.role,'group');assert.throws(()=>goodsAfterSaleAvailability(h.s,{...actual,role:'user',userId:'u1'},h.o.id),/无权/);
});

test('getter原版本可交给原申请；过期能力提交拒绝且未支付阶段不承诺动作',()=>{
  const h=fixture(),v=h.v;h.apply({kind:'refund',skuId:'care',qty:1,amountCents:1});const before=structuredClone(h.s);assert.throws(()=>h.run('goods.case',{id:v.orderId,version:v.version,requestId:'old-capability',kind:'refund',skuId:'oil',qty:1,amountCents:1,reason:'旧能力不能替代原校验'}),/更新|版本/);assert.deepEqual(h.s,before);const unpaid=fixture({pay:false});assert.equal(unpaid.v.known,true);assert.equal(unpaid.v.canRefund,false);assert.equal(unpaid.v.canCancel,false);unpaid.reject({kind:'cancel'},/未支付/);
});
