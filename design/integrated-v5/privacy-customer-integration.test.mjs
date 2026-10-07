import test from 'node:test';
import assert from 'node:assert/strict';
import { seed, reduce } from './engine.mjs';
import { customerView } from './customer.mjs';
import { privacyUseClosed } from './privacy.mjs';
import { assertClosedRightsDraft } from './privacy-closed-rights.mjs';

const user={role:'user',userId:'u1'},other={role:'user',userId:'u2'},support={role:'group',job:'support'};
const ui={link:(label,path)=>`<a href="#${path}">${label}</a>`,getDraft(){throw new Error('关闭页面不能创建预约草稿');},field(){throw new Error('关闭页面不能调用普通交易字段');},button(){throw new Error('关闭页面不能调用普通交易按钮');},empty:(label,text)=>label+text};
function closeEmptyUser(){
  let s=seed();s=reduce(s,user,'privacy.request',{requestId:'C09-CUSTOMER-REQUEST',version:0,reason:'合成空账号请求关闭',acknowledged:true});
  const c=s.privacyClosures.at(-1);
  return reduce(s,support,'privacy.close',{requestId:'C09-CUSTOMER-CLOSE',id:c.id,version:c.version,reason:'合成账号基础资料关闭，保留范围待核',custodian:'演示客服',acknowledged:true});
}
test('原正常关闭回执与权益列表接通，查询页面不改原资料与账本',()=>{
  const s=closeEmptyUser(),before=structuredClone(s);
  const receipt=customerView(s,user,['privacy'],ui),rights=customerView(s,user,['rights'],ui);
  assert.match(receipt,/使用关闭回执/);assert.match(receipt,/href="#\/user\/rights"/);assert.match(rights,/既有交易权益/);assert.match(rights,/暂无已核验的原业务入口/);
  assert.match(rights,/href="#\/user\/privacy"/);assert.doesNotMatch(receipt+rights,/data-command=|<form\b/);assert.deepEqual(s,before);
});
test('任一完整关闭信号都封闭普通预约商城和推广入口，不调用新交易字段或草稿',()=>{
  const routes=[['booking'],['booking','time'],['booking','NEW','payment'],['mall'],['checkout'],['addresses'],['cart'],['product','p1'],['service-promotion','binding'],['service-promotion','withdrawals']];
  for(const markClosed of [s=>s.users[0].status='closed',s=>(s.privacyProfiles??=[]).push({userId:'u1',status:'use_closed',version:1,history:[]}),s=>(s.privacyClosures??=[]).push({id:'PC-CONFLICT',userId:'u1',status:'use_closed',closedAt:s.now})]){
    const s=seed();markClosed(s);assert.equal(privacyUseClosed(s,'u1'),true);const before=structuredClone(s);
    for(const route of routes){const html=customerView(s,user,route,ui);assert.match(html,/既有权益|使用关闭回执/);assert.doesNotMatch(html,/<form\b|data-command=|预约步骤|付款确认|申请提现|商品分类/);}
    assert.deepEqual(s,before);
  }
});
test('重复profile中的closed和关闭回执不能被第一条active掩盖，普通资料仍封闭',()=>{
  const s=closeEmptyUser();s.privacyProfiles.unshift({userId:'u1',status:'active',version:0,history:[]});const before=structuredClone(s);
  const entry=customerView(s,user,['rights'],ui),detail=customerView(s,user,['service-promotion','withdrawals','SPW-WRONG'],ui);
  assert.match(entry,/待人工核对/);assert.match(detail,/待人工核验/);assert.doesNotMatch(entry+detail,/SPW-WRONG|<form\b|data-command=/);assert.deepEqual(s,before);
});
test('使用关闭深链缺原资金源保持静态核验和两条返回，不显示内部记录',()=>{
  const s=closeEmptyUser();
  for(const route of [['service-promotion','commissions','SPC-MISSING'],['service-promotion','withdrawals','SPW-MISSING'],['service-promotion','recoveries','SPD-MISSING']]){
    const html=customerView(s,user,route,ui);assert.match(html,/原权益来源待人工核验/);assert.match(html,/href="#\/user\/rights"/);assert.match(html,/href="#\/user\/privacy"/);assert.doesNotMatch(html,/MISSING|<form\b|data-command=|¥/);
  }
});
test('关闭旧首页与个人页仍能回读原关闭回执，另一正常本人不受影响',()=>{
  const s=closeEmptyUser();for(const route of [[],['home'],['me']])assert.match(customerView(s,user,route,ui),/使用关闭回执/);
  const active=customerView(s,other,['privacy'],ui);assert.match(active,/privacy\.consent/);assert.match(active,/privacy\.request/);assert.doesNotMatch(active,/账号普通使用已关闭/);
});

function businessUser(){
  let s=seed(),n=0;
  const run=(type,p,actor=user)=>{s=reduce(s,actor,type,{requestId:'customer-original-'+(++n),...p});};
  const close=()=>{run('privacy.request',{version:0,reason:'合成原交易本人关闭申请',acknowledged:true});const c=s.privacyClosures.at(-1);run('privacy.close',{id:c.id,version:c.version,reason:'合成正常关闭事务保留原权益',custodian:'演示客服',acknowledged:true},support);};
  return{get s(){return s;},run,close};
}
function payloadFrom(html,command){
  const found=[...html.matchAll(/<form\b([^>]*)>/g)].find(([,attrs])=>attrs.includes(`data-command="${command}"`));
  assert.ok(found,`共享页面缺少原命令 ${command}`);
  return JSON.parse(found[1].match(/data-payload="([^"]*)"/)[1].replace(/&quot;|&#39;|&lt;|&gt;|&amp;/g,v=>({'&quot;':'"','&#39;':"'",'&lt;':'<','&gt;':'>','&amp;':'&'})[v]));
}
test('共享正常关闭后原预约与原票补正接通，退款和补正实际沿原reduce办理',()=>{
  const h=businessUser(),tech={role:'tech',techId:'lin',storeId:'xingfu'},store={role:'store',storeId:'xingfu'},finance={role:'group',job:'finance'};
  const startAt=h.s.now+4*3600000;
  h.run('booking.create',{storeId:'xingfu',serviceId:'relax',regionId:'home',techId:'lin',startAt,mode:'specified',genderPreference:'any',contactName:'C09-CONTACT-CANARY',phone:'13800000001',healthConsent:true,identityVerified:true,adultConfirmed:true});
  const id=h.s.bookings.at(-1).id;
  h.run('booking.pay',{id,outcome:'success'});h.run('booking.accept',{id},tech);h.run('clock.advance',{minutes:240},finance);h.run('booking.start',{id},tech);h.run('clock.advance',{minutes:60},finance);h.run('booking.finish',{id,mode:'normal'},tech);
  h.run('invoice.apply',{bookingId:id,kind:'personal',title:'合成原票抬头',taxId:'',invoiceType:'electronic',email:'demo@example.test'});
  const invoice=h.s.serviceInvoices.at(-1);
  h.run('invoice.reject',{id:invoice.id,version:invoice.version,reason:'合成原票抬头待补正'},store);h.close();
  const before=structuredClone(h.s),html=customerView(h.s,user,['booking',id],ui),ticket=customerView(h.s,user,['invoices',invoice.id],ui);
  assert.match(html,/原预约权益/);assert.match(html,/refundAmount:/);assert.match(ticket,/invoice\.resubmit/);assert.deepEqual(h.s,before);
  assert.doesNotMatch(html+ticket,/C09-CONTACT-CANARY|13800000001|booking\.pay|booking\.create|invoice\.apply|data-booking-field/);
  const p=payloadFrom(ticket,'invoice.resubmit');h.run('invoice.resubmit',{...p,kind:'personal',title:'合成原票补正抬头',taxId:'',invoiceType:'electronic',email:'demo@example.test'});
  assert.equal(h.s.serviceInvoices.at(-1).status,'pending');
  const refund=payloadFrom(html,'booking.refund-request'),paymentId=h.s.bookings.at(-1).payment.id;
  h.run('booking.refund-request',{...refund,requests:[{paymentId,amountCents:1000}],reason:'本人正常关闭后原预约退款'});
  assert.equal(h.s.bookings.at(-1).refunds.at(-1).amountCents,1000);
  assert.match(customerView(h.s,user,['booking',id],ui),/原预约退款/);
  const other=customerView(h.s,{role:'user',userId:'u2'},['booking',id],ui);assert.doesNotMatch(other,/原预约权益|refundAmount:/);
});
test('共享正常关闭后已收货原商品售后接通，原净额及实物事实保持',()=>{
  const h=businessUser(),warehouse={role:'group',job:'warehouse'};
  h.run('cart.set',{skuId:'oil',qty:1});h.run('goods.submit',{addressId:'AD1',expectedSourceId:''});const id=h.s.goods.at(-1).id;
  h.run('goods.pay',{id,outcome:'success'});h.run('goods.ship',{id,version:h.s.goods.at(-1).version,carrier:'合成原配送',tracking:'C09-ORIGINAL-SHIP'},warehouse);h.run('goods.receive',{id,version:h.s.goods.at(-1).version});h.close();
  const original=structuredClone(h.s.goods.at(-1)),before=structuredClone(h.s),html=customerView(h.s,user,['goods',id],ui);
  assert.match(html,/原商品权益/);assert.match(html,/goods\.case/);assert.match(html,/C09-ORIGINAL-SHIP/);assert.deepEqual(h.s,before);
  assert.doesNotMatch(html,/13800000001|示例路128|goods\.pay|goods\.submit|data-booking-field/);
  const p=payloadFrom(html,'goods.case');h.run('goods.case',{...p,qty:1,amountCents:1000,shippingCents:0,reason:'合成原已收货商品售后'});
  const actual=h.s.goods.at(-1);assert.equal(actual.status,original.status);assert.equal(actual.paidCents,original.paidCents);assert.deepEqual(actual.shipment,original.shipment);assert.equal(actual.cases.at(-1).amountCents,1000);
  assert.match(customerView(h.s,user,['goods',id],ui),/原商品售后/);
});

test('正常关闭后当前主付款变化拒绝旧商品表单草稿与提交，原快照及实物资金不倒写',()=>{
  const h=businessUser(),warehouse={role:'group',job:'warehouse'};
  h.run('cart.set',{skuId:'oil',qty:1});h.run('goods.submit',{addressId:'AD1',expectedSourceId:''});const id=h.s.goods.at(-1).id;
  h.run('goods.pay',{id,outcome:'success'});h.run('goods.ship',{id,version:h.s.goods.at(-1).version,carrier:'合成原配送',tracking:'C09-STALE-SHIP'},warehouse);h.run('goods.receive',{id,version:h.s.goods.at(-1).version});h.close();
  const html=customerView(h.s,user,['goods',id],ui),old=payloadFrom(html,'goods.case'),receipt=structuredClone(h.s.privacyClosures.at(-1));
  for(const change of [s=>s.goods.at(-1).payment.id='UNBOUND-REPLACEMENT',s=>s.goods.at(-1).payment=null]){
    const next=structuredClone(h.s);change(next);const before=structuredClone(next);
    assert.throws(()=>assertClosedRightsDraft(next,user,'goods.case',old),/原支付|快照/);
    assert.throws(()=>reduce(next,user,'goods.case',{...old,requestId:'C09-STALE-SOURCE',qty:1,amountCents:1000,shippingCents:0,reason:'旧表单原售后'}),/原支付|快照/);
    const current=customerView(next,user,['goods',id],ui);assert.match(current,/待人工核验/);assert.doesNotMatch(current,/<form\b|UNBOUND-REPLACEMENT|¥/);
    assert.deepEqual(next,before);assert.deepEqual(next.privacyClosures.at(-1),receipt);
  }
});
