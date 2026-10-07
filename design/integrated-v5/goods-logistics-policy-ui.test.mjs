import test from 'node:test';
import assert from 'node:assert/strict';
import { seed, reduce, money } from './engine.mjs';
import { goodsExceptionCommand, syncGoodsExceptions } from './goods-exceptions.mjs';
import { captureGoodsLogisticsPolicy, goodsLogisticsCommand } from './goods-logistics-policy.mjs';
import { goodsLogisticsPolicyView, goodsLogisticsOrderPanel } from './goods-logistics-policy-ui.mjs';
import { goodsOrderExtras } from './goods-exceptions-ui.mjs';
const user={role:'user',userId:'u1'},other={role:'user',userId:'u2'},ops={role:'group',job:'operations'},support={role:'group',job:'support'},warehouse={role:'group',job:'warehouse'},finance={role:'group',job:'finance'},store={role:'store',storeId:'xingfu'};
const e=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const decode=v=>v.replace(/&quot;|&#39;|&lt;|&gt;|&amp;/g,c=>({'&quot;':'"','&#39;':"'",'&lt;':'<','&gt;':'>','&amp;':'&'}[c]));
const ui={esc:e,money,date:t=>t?new Date(t).toISOString():'—',field:(label,name,value='',type='text',attrs='')=>`<label class="field"><span>${e(label)}</span><input name="${e(name)}" value="${e(value)}" type="${e(type)}" ${attrs}></label>`,select:(label,name,opts,value)=>`<label class="field"><span>${e(label)}</span><select name="${e(name)}">${opts.map(o=>`<option value="${e(o.value)}"${String(o.value)===String(value)?' selected':''}>${e(o.label)}</option>`).join('')}</select></label>`,empty:(label,detail='')=>`<section><h2>${e(label)}</h2><p>${e(detail)}</p></section>`,link:(label,path)=>`<a href="#${e(path)}">${e(label)}</a>`};
const options=a=>({canCommand:type=>{
  if(a.role!=='group')return false;
  if(!a.job||a.job==='all')return true;
  if(type==='goods-logistics.policy-publish')return a.job==='operations';
  if(['goods-logistics.delivery-verify','goods.incident-verify','goods.incident-propose'].includes(type))return a.job==='support';
  return ['warehouse','support'].includes(a.job);
}});
function forms(html,command){return [...html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/g)].map(([,raw,body])=>{const attrs=Object.fromEntries([...raw.matchAll(/([\w-]+)=("[^"]*"|'[^']*')/g)].map(([,k,v])=>[k,decode(v.slice(1,-1))]));return{attrs,body,command:attrs['data-command'],payload:JSON.parse(attrs['data-payload']||'{}')};}).filter(f=>!command||f.command===command);}
const policyInput=(s,extra={})=>({scope:'all',effectiveAt:s.now,autoReceiptMode:'enabled',autoReceiptMinutes:60,compensationMode:'not-configured',unclaimedMode:'not-configured',reason:'仅用于隔离验证的明确本地规则',...extra});
function fixture({received=false,policy=false}={}){
  let s=seed(),n=0;
  const f={get s(){return s;},get o(){return s.goods.at(-1);},get i(){return f.o.incidents.at(-1);},get fact(){return f.o.goodsDeliveryFacts?.at(-1);},run(type,p={},a=user){s=reduce(s,a,type,{requestId:`ui-old-${++n}`,...p});},write(type,p={},a=support){const next=structuredClone(s),ctx={id:k=>k+ ++next.seq,fail:m=>{throw Error(m);}},command=type.startsWith('goods-logistics.')?goodsLogisticsCommand:goodsExceptionCommand,result=command(next,a,type,{requestId:`ui-new-${++n}`,...p},ctx);syncGoodsExceptions(next,ctx);s=next;return result;},submit(form,values={},a=support){assert.ok(form,'实际页面应提供当前动作表单');return f.write(form.command,{...form.payload,...values},a);},page(a=user){return goodsOrderExtras(s,a,f.o,ui,options(a));},panel(a=user){return goodsLogisticsOrderPanel(s,a,f.o,ui,options(a));},open(){const form=forms(f.page(support),'goods.incident-open').find(x=>x.payload.kind==='wrong-item');f.submit(form,{skuId:'oil',qty:1,actualItem:'私密实际货物<img src=x>',occurredAt:s.now,evidence:'私密原证据<script>bad()</script>',reason:'私密错发事实说明'});},verify(conclusion='confirmed'){f.submit(forms(f.page(support),'goods.incident-verify')[0],{conclusion,occurredAt:s.now,evidence:'私密核实证据<svg>',reason:'私密核实说明'});},proposal(){f.submit(forms(f.page(support),'goods.incident-propose')[0],{resolution:'continue',reason:'协商继续原流程'});}};
  if(policy)f.write('goods-logistics.policy-publish',{version:0,...policyInput(s)},ops);
  f.run('promotion.enter',{storeId:'xingfu'});f.run('cart.set',{skuId:'oil',qty:2});f.run('goods.submit',{addressId:'AD1'});captureGoodsLogisticsPolicy(s,f.o);f.run('goods.pay',{id:f.o.id,outcome:'success'});f.run('goods.ship',{id:f.o.id,carrier:'原物流',tracking:'PRIVATE-SHIP'},warehouse);if(received)f.run('goods.receive',{id:f.o.id});return f;
}

test('C06 配置表单明确选择与空期限，不把演示值设成正式默认',()=>{
  const f=fixture(),html=goodsLogisticsPolicyView(f.s,ops,ui,options(ops)),form=forms(html,'goods-logistics.policy-publish')[0];
  assert.match(html,/本地Demo输入/);assert.match(html,/空配置不能自动收货或处置货物/);assert.equal(form.payload.version,0);
  for(const name of ['scope','autoReceiptMode','compensationMode','unclaimedMode'])assert.match(form.body,new RegExp(`<select name="${name}"><option value="" selected>`));
  for(const name of ['autoReceiptMinutes','deliveryFollowupMinutes','returnTransitFollowupMinutes','returnBackFollowupMinutes'])assert.match(form.body,new RegExp(`name="${name}" value=""`));
  assert.match(form.body,/name="reason" required/);assert.match(form.body,/type="submit" class="btn primary"/);assert.match(form.body,/role="status"/);assert.doesNotMatch(form.payload.requestId||'',/ui-/);
});

test('C06 实际配置表单版本接独立发布并保留历史，岗位与能力门控一致',()=>{
  const f=fixture(),old=forms(goodsLogisticsPolicyView(f.s,ops,ui,options(ops)),'goods-logistics.policy-publish')[0];f.submit(old,policyInput(f.s,{reason:'规则依据<iframe>'}),ops);
  assert.match(goodsLogisticsPolicyView(f.s,ops,ui,options(ops)),/规则依据&lt;iframe&gt;/);assert.throws(()=>f.submit(old,policyInput(f.s),ops),/已更新/);
  for(const a of [user,store,support,warehouse,finance])assert.equal(forms(goodsLogisticsPolicyView(f.s,a,ui,options(a))).length,0);
  assert.equal(forms(goodsLogisticsPolicyView(f.s,ops,ui,{canCommand:()=>false})).length,0);
});

test('C06 实际送达表单、客服核实与真实起算时间接通，旧版本不能覆盖',()=>{
  const f=fixture({policy:true}),before=structuredClone({status:f.o.status,payment:f.o.payment,lines:f.o.lines,stocks:f.s.skus});
  f.s.now+=10*60000;const record=forms(f.panel(warehouse),'goods-logistics.delivery-record')[0];assert.equal(record.payload.version,f.o.version);for(const name of ['occurredAt','evidence','reference','reason'])assert.match(record.body,new RegExp(`name="${name}"[^>]*required`));
  f.submit(record,{kind:'signed',occurredAt:f.s.now,evidence:'私密签收证据<img>',reference:'私密原凭据<svg>',reason:'私密实际发生说明'},warehouse);
  const verify=forms(f.panel(support),'goods-logistics.delivery-verify')[0];assert.equal(verify.payload.factId,f.fact.id);assert.equal(verify.payload.version,f.o.version);assert.equal(forms(f.panel(warehouse),'goods-logistics.delivery-verify').length,0);
  f.submit(verify,{decision:'verified',occurredAt:f.s.now,evidence:'私密核实签收证据',reason:'按原运单核实实际发生'});assert.throws(()=>f.submit(verify,{decision:'rejected',occurredAt:f.s.now,evidence:'另一个证据',reason:'重新核实'}),/已更新/);
  assert.match(f.panel(),/已核实/);assert.match(f.panel(),new RegExp(new Date(f.fact.occurredAt+60*60000).toISOString()));assert.deepEqual({status:f.o.status,payment:f.o.payment,lines:f.o.lines,stocks:f.s.skus},before);
});

test('C06 物流证据仅本人和办理岗位可见，推广门店与财务保留必要进度',()=>{
  const f=fixture({policy:true});f.submit(forms(f.panel(warehouse),'goods-logistics.delivery-record')[0],{kind:'signed',occurredAt:f.s.now,evidence:'私密签收证据<img>',reference:'私密原凭据<svg>',reason:'私密实际说明'},warehouse);
  for(const a of [user,support,warehouse]){const html=f.panel(a);assert.match(html,/私密签收证据&lt;img&gt;/);assert.doesNotMatch(html,/<img>|<svg>/);}
  for(const a of [store,finance]){const html=f.panel(a);assert.match(html,/待客服核实/);assert.doesNotMatch(html,/私密|PRIVATE-SHIP|data-command/);}
  for(const a of [other,{role:'store',storeId:'silver'},{role:'tech',techId:'lin'}])assert.equal(f.panel(a),'');
  assert.equal(forms(goodsLogisticsOrderPanel(f.s,support,f.o,ui,{canCommand:()=>false})).length,0);
});

test('C06 未配置旧单明确关闭自动收货，待核实不显示收货成功或处置动作',()=>{
  const f=fixture(),html=f.panel();assert.match(html,/创建时未配置，自动收货关闭/);assert.equal(f.o.status,'shipped');assert.doesNotMatch(html,/原收货事实已记录|销毁.*data-command/);
  const r=forms(f.panel(warehouse),'goods-logistics.delivery-record')[0];f.submit(r,{kind:'delivered',occurredAt:f.s.now,evidence:'真正送达证据',reference:'ACTUAL-1',reason:'保留实际送达原事实'},warehouse);assert.match(f.panel(),/待核实/);assert.equal(f.o.receivedAt,undefined);
});

test('C06 错发与签收争议登记保留固定类型、原版本和真实事实必填项',()=>{
  const f=fixture({received:true}),all=forms(f.page(support),'goods.incident-open'),wrong=all.find(x=>x.payload.kind==='wrong-item'),claim=all.find(x=>x.payload.kind==='receipt-dispute');
  for(const form of [wrong,claim]){assert.equal(form.payload.version,f.o.version);assert.equal(form.payload.stage,'delivery');for(const name of ['occurredAt','evidence','reason'])assert.match(form.body,new RegExp(`name="${name}"[^>]*required`));}
  assert.match(wrong.body,/name="actualItem"[^>]*required/);assert.match(wrong.body,/value="oil"/);assert.match(claim.body,/非本人授权签收/);assert.doesNotMatch(claim.body,/name="skuId"/);
  const original=forms(f.page(support),'goods.incident-open').find(x=>!x.payload.kind);assert.doesNotMatch(original.body,/value="delay"|value="lost"/);assert.equal(forms(f.page(finance),'goods.incident-open').length,0);
});

test('C06 核实、本人方案确认和实际收货从当前页面表单走通，旧收货不先结案',()=>{
  const f=fixture({received:true});f.open();assert.equal(forms(f.page(support),'goods.incident-propose').length,0);assert.equal(forms(f.page(warehouse),'goods.incident-verify').length,0);
  f.verify('inconclusive');assert.equal(forms(f.page(support),'goods.incident-propose').length,0);f.verify();f.proposal();assert.equal(forms(f.page(support),'goods.incident-verify').length,0);
  const confirmation=forms(f.page(),'goods.incident-confirm')[0];assert.equal(confirmation.payload.version,f.i.version);assert.equal(forms(f.page(),'goods.incident-receipt').length,0);f.submit(confirmation,{decision:'accept',reason:'本人已了解继续方案'},user);assert.equal(f.i.status,'waiting');
  const html=f.page(),receipt=forms(html,'goods.incident-receipt')[0];assert.match(html,/同意继续方案不代表已经收货/);assert.match(receipt.body,/name="occurredAt"[^>]*required/);assert.match(receipt.body,/name="evidence"[^>]*required/);assert.equal(forms(f.page(support),'goods.incident-receipt').length,0);
  f.submit(receipt,{occurredAt:f.s.now,evidence:'本人实际完整正确收到证据',reason:'本人核对完整货物'},user);assert.equal(f.i.status,'done');assert.equal(forms(f.page(),'goods.incident-receipt').length,0);assert.match(f.page(),/相关原流程事实已完成/);
});

test('C06 新争议事实转义且仅本人和客服仓储获原正文，门店财务不泄露主张',()=>{
  const f=fixture();f.open();f.verify();for(const a of [user,support,warehouse]){const html=f.page(a);assert.match(html,/私密原证据&lt;script&gt;/);assert.match(html,/私密核实说明/);assert.doesNotMatch(html,/<script>|<img src=x>|<svg>/);}
  for(const a of [store,finance,ops]){const html=f.page(a);assert.match(html,/集团待跟进/);assert.doesNotMatch(html,/私密|PRIVATE-SHIP|报告数量|核实证据/);}
  assert.equal(f.page(other),'');assert.equal(f.page({role:'store',storeId:'silver'}),'');
});
