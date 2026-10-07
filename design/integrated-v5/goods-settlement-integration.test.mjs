import test from 'node:test';
import assert from 'node:assert/strict';
import { seed, reduce, money } from './engine.mjs';
import { staffView } from './staff.mjs';
import { resolveAccountActor } from './staff-accounts.mjs';
import { goodsSettlementTaskRows } from './goods-settlement.mjs';
const u={role:'user',userId:'u1'},g={role:'group',job:'finance'},local={role:'store',storeId:'xingfu'},support={role:'group',job:'support'},warehouse={role:'group',job:'warehouse'};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const decode=v=>v.replace(/&quot;|&#39;|&lt;|&gt;|&amp;/g,c=>({'&quot;':'"','&#39;':"'",'&lt;':'<','&gt;':'>','&amp;':'&'}[c]));
const ui={esc,money,date:v=>v?new Date(v).toISOString():'—',query:new URLSearchParams(),link:(label,path,kind='')=>`<a href="#${esc(path)}" class="${esc(kind)}">${label}</a>`,button:(label,command,p={},kind='')=>`<button type="button" data-command="${esc(command)}" data-payload="${esc(JSON.stringify(p))}" class="${esc(kind)}">${esc(label)}</button>`,field:(label,name,value='',type='text',attrs='')=>`<label class="field"><span>${esc(label)}</span><input name="${esc(name)}" value="${esc(value)}" type="${esc(type)}" ${attrs}></label>`,select:(label,name,options,value)=>`<label class="field"><span>${esc(label)}</span><select name="${esc(name)}">${options.map(o=>`<option value="${esc(o.value)}"${String(o.value)===String(value)?' selected':''}>${esc(o.label)}</option>`).join('')}</select></label>`,tag:label=>`<span class="tag">${esc(label)}</span>`,empty:(label,detail='')=>`<section><h2>${esc(label)}</h2><p>${esc(detail)}</p></section>`};
function forms(html,type){return[...html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/g)].map(([,raw,body])=>{const attrs=Object.fromEntries([...raw.matchAll(/([\w-]+)="([^"]*)"/g)].map(([,k,v])=>[k,decode(v)]));return{command:attrs['data-command'],payload:JSON.parse(attrs['data-payload']||'{}'),body};}).filter(x=>!type||x.command===type);}
function fixture(){let s=seed(),seq=0;const f={get s(){return s;},get b(){return s.bills.at(-1);},get p(){return s.goodsOffsetPlans.at(-1);},run(type,p={},a=u){let result;s=reduce(s,a,type,{requestId:`settlement-integration-${++seq}`,...p},x=>result=x);return result;},page(a=g,route=['bills',f.b.id]){return staffView(s,a,route,ui);},submit(form,p={},a=g){assert.ok(form,'当前工作页面必须存在该表单');return f.run(form.command,{...form.payload,...p},a);},create(){f.run('promotion.enter',{storeId:'xingfu'});f.run('cart.set',{skuId:'oil',qty:1});f.run('goods.submit',{addressId:'AD1'});const id=s.goods.at(-1).id;f.run('goods.pay',{id,outcome:'success'});f.run('goods.ship',{id,carrier:'真实页面演示物流',tracking:`I-${seq}`},warehouse);f.run('goods.receive',{id});return id;},bill(){f.run('clock.advance',{minutes:10080});f.run('bill.create',{storeId:'xingfu'},g);return f.b.id;},pay(id=f.b.id){const b=s.bills.find(b=>b.id===id);f.run('bill.confirm',{id,version:b.version},local);f.run('bill.pay',{id,outcome:'processing'},g);f.run('bill.query',{id,outcome:'success'},g);},refund(id,amountCents=10000){f.run('goods.case',{id,kind:'refund',skuId:'oil',qty:1,amountCents,reason:'集团核实退款'});const caseId=s.goods.find(o=>o.id===id).cases.at(-1).id;f.run('goods.case-review',{id,caseId,decision:'approve',reason:'核实批准'},support);f.run('goods.refund',{id,caseId,outcome:'success'},g);},debt(){const old=f.create();f.bill();f.pay();f.refund(old);const next=f.create();f.bill();return next;},staff(job,storeId){const x=f.run('account.create',{name:`岗位${job}`,reason:'试点C05验证'},f.admin);const granted=f.run('account.grant',{id:x.id,version:x.version,job,...(storeId?{storeId}:{}),reason:'试点岗位授权'},f.admin);const entered=f.run('account.enter',{accountId:x.id,grantId:granted.grants.at(-1).id});return resolveAccountActor(s,entered);}};const entry=f.run('account.enter',{accountId:'DEMO-ADMIN',grantId:'DEMO-ADMIN-GRANT'});f.admin=resolveAccountActor(s,entry);return f;}

test('实际门店财务差异表单→集团财务拆账→本店重新确认→旧现金付款保留父账差异',()=>{
  const f=fixture(),storeFinance=f.staff('store-finance','xingfu'),finance=f.staff('finance'),a=f.create(),b=f.create();f.bill();f.submit(forms(f.page(storeFinance),'bill.dispute-lines')[0],{orderIds:[a],reason:'仅第一单差异，第二单核对正确'},storeFinance);const parent=f.b.id,split=forms(f.page(finance),'bill.split')[0];f.submit(split,{orderIds:[b],reason:'无争议第二单转子账'},finance);assert.equal(f.b.parentBillId,parent);assert.match(f.page(finance),new RegExp(`/group/bills/${parent}`));assert.match(f.page(storeFinance),/确认账单/);f.pay();assert.equal(f.s.bills.find(x=>x.id===parent).status,'disputed');assert.equal(f.s.goods.find(x=>x.id===b).commissionPaidCents,2000);assert.equal(f.s.goods.find(x=>x.id===a).commissionPaidCents,0);
});
test('真实岗位混合现金抵扣连续办理，未知→失败→原笔重试→成功及原请求重放',()=>{
  const f=fixture(),finance=f.staff('finance'),storeFinance=f.staff('store-finance','xingfu'),next=f.debt();const proposal=forms(f.page(finance),'bill.offset-propose')[0];f.submit(proposal,{recoveryId:f.s.recoveries[0].id,amountCents:1000,reason:'本店后续商品佣金偿债'},finance);assert.doesNotMatch(f.page(storeFinance),/data-command="bill.confirm"/);f.submit(forms(f.page(storeFinance),'bill.offset-confirm')[0],{decision:'accept',reason:'核对债务、抵扣和现金'},storeFinance);assert.doesNotMatch(f.page(finance),/data-command="bill.pay"/);f.submit(forms(f.page(finance),'bill.offset-pay')[0],{},finance);const original=f.p.paymentId;assert.equal(f.b.cashPaidCents,undefined);assert.equal(f.s.recoveries[0].recoveredCents,0);assert.doesNotMatch(f.page(finance,['recoveries']),/data-command="recovery.receive"/);assert.throws(()=>f.run('recovery.receive',{id:f.s.recoveries[0].id,amountCents:1,proof:'不能抢先清债'},finance),/占用/);f.submit(forms(f.page(finance),'bill.offset-query')[0],{outcome:'failed'},finance);assert.equal(f.p.paymentId,original);f.submit(forms(f.page(finance),'bill.offset-pay')[0],{},finance);const q=forms(f.page(finance),'bill.offset-query')[0],p={...q.payload,outcome:'success',requestId:'real-query-once'};f.run(q.command,p,finance);f.run(q.command,p,finance);assert.equal(f.s.goods.find(x=>x.id===next).commissionPaidCents,2000);assert.equal(f.b.cashPaidCents,1000);assert.equal(f.b.offsetSettledCents,1000);assert.equal(f.s.recoveries[0].records.filter(r=>r.kind==='offset').length,1);assert.match(f.page(finance,['recoveries']),/商品佣金抵扣/);assert.match(f.page(finance),/现金¥10.00/);assert.equal(forms(f.page(finance),'bill.offset-pay').length,0);
});
test('真实岗位与单店边界覆盖页面和命令，冒充上下文及没有授权岗位均拒绝',()=>{
  const f=fixture();f.debt();const finance=f.staff('finance'),storeFinance=f.staff('store-finance','xingfu'),foreign=f.staff('store-finance','silver'),ops=f.staff('operations'),wh=f.staff('warehouse');assert.match(f.page(ops),/无权查看/);assert.match(f.page(wh),/无权查看/);assert.doesNotMatch(f.page(foreign),/本店商品佣金抵扣方案/);const ungranted=f.run('account.create',{name:'未授予岗位',reason:'不得执行资金'},f.admin);assert.throws(()=>f.run('account.enter',{accountId:ungranted.id,grantId:'none'}),/未启用/);const form=forms(f.page(finance),'bill.offset-propose')[0];assert.throws(()=>f.submit(form,{recoveryId:f.s.recoveries[0].id,amountCents:1000,reason:'非财务越权'},ops),/无权|岗位/);assert.throws(()=>f.submit(form,{recoveryId:f.s.recoveries[0].id,amountCents:1000,reason:'伪造角色'}, {...wh,role:'group',job:'finance'}),/无权|岗位/);f.submit(form,{recoveryId:f.s.recoveries[0].id,amountCents:1000,reason:'授权财务方案'},finance);const confirm=forms(f.page(storeFinance),'bill.offset-confirm')[0];assert.throws(()=>f.submit(confirm,{decision:'accept',reason:'跨店确认'},foreign),/无权/);assert.equal(f.p.status,'proposed');
});
test('已登记现金回款在后续债务方案占用后可原请求重放，内容变更仍拒绝',()=>{
  const f=fixture();f.debt();const r=f.s.recoveries[0],p={id:r.id,amountCents:400,proof:'核实实际收到4元',requestId:'original-receipt'};f.run('recovery.receive',p,g);f.run('bill.offset-propose',{id:f.b.id,version:f.b.version,recoveryId:r.id,amountCents:600,reason:'其余6元抵扣',requestId:'remaining-offset'},g);f.run('recovery.receive',p,g);assert.equal(f.s.recoveries[0].recoveredCents,400);assert.equal(f.s.recoveries[0].records.length,1);assert.equal(f.p.status,'proposed');assert.throws(()=>f.run('recovery.receive',{...p,amountCents:500},g),/标识|内容/);
});
test('纯待办源从本店确认交给集团执行，债务占用等待，成功才三源完成',()=>{
  const f=fixture();f.debt();const before=structuredClone(f.s),rows=goodsSettlementTaskRows(f.s),bill=rows.find(r=>r.sourceId===f.b.id);assert.equal(bill.status,'open');assert.deepEqual(bill.manageRoles,['store']);assert.deepEqual(bill.allowedJobs.store,['store-finance']);assert.equal(bill.dueAt,null);assert.deepEqual(f.s,before);f.run('bill.offset-propose',{id:f.b.id,version:f.b.version,recoveryId:f.s.recoveries[0].id,amountCents:1000,reason:'商品同店抵扣'},g);let tasks=goodsSettlementTaskRows(f.s),plan=tasks.find(r=>r.sourceId===f.p.id);assert.deepEqual(plan.manageRoles,['store']);assert.equal(tasks.find(r=>r.sourceId===f.b.id).status,'waiting');assert.equal(tasks.find(r=>r.sourceId===f.s.recoveries[0].id).status,'waiting');f.run('bill.offset-confirm',{id:f.b.id,planId:f.p.id,version:f.p.version,decision:'accept',reason:'本店同意'},local);tasks=goodsSettlementTaskRows(f.s);assert.deepEqual(tasks.find(r=>r.id===plan.id).manageRoles,['group']);assert.notEqual(tasks.find(r=>r.id===plan.id).sourceToken,plan.sourceToken);f.run('bill.offset-pay',{id:f.b.id,planId:f.p.id,version:f.p.version,outcome:'processing'},g);assert.deepEqual(goodsSettlementTaskRows(f.s).find(r=>r.id===plan.id).commands,['bill.offset-query']);f.run('bill.offset-query',{id:f.b.id,planId:f.p.id,version:f.p.version,outcome:'success'},g);assert.ok(goodsSettlementTaskRows(f.s).filter(r=>[f.b.id,f.p.id,f.s.recoveries[0].id].includes(r.sourceId)).every(r=>r.status==='done'));
});

test('真实售后未知付款失败后本店重核全额抵扣，已付页显示办结并保留原调整记录',()=>{
  const f=fixture(),finance=f.staff('finance'),storeFinance=f.staff('store-finance','xingfu'),next=f.debt();
  f.submit(forms(f.page(finance),'bill.offset-propose')[0],{recoveryId:f.s.recoveries[0].id,amountCents:1000,reason:'原商品佣金偿债'},finance);
  f.submit(forms(f.page(storeFinance),'bill.offset-confirm')[0],{decision:'accept',reason:'核实原现金及抵扣'},storeFinance);
  f.submit(forms(f.page(finance),'bill.offset-pay')[0],{},finance);
  const oldPlanId=f.p.id,oldPaymentId=f.p.paymentId;f.refund(next);
  f.submit(forms(f.page(finance),'bill.offset-query')[0],{outcome:'failed'},finance);
  assert.equal(f.p.status,'invalidated');assert.equal(f.b.amountCents,1000);
  const originalReason=f.b.reason,originalAdjustment=f.b.adjustmentReason,originalEvents=structuredClone(f.b.events);
  assert.equal(originalReason,'关联订单售后变化，请重新核对');
  for(const actor of [finance,storeFinance])assert.match(f.page(actor),/<div class="notice [^"]*">核对说明：关联订单售后变化，请重新核对<\/div>/);
  const oldPlan=structuredClone(f.p);
  f.submit(forms(f.page(finance),'bill.offset-propose')[0],{recoveryId:f.s.recoveries[0].id,amountCents:1000,reason:'失败原笔后按新佣金全额抵扣'},finance);
  assert.notEqual(f.p.id,oldPlanId);assert.notEqual(f.p.paymentId,oldPaymentId);assert.equal(f.p.cashCents,0);
  f.submit(forms(f.page(storeFinance),'bill.offset-confirm')[0],{decision:'accept',reason:'重新核实无需现金付款'},storeFinance);
  f.submit(forms(f.page(finance),'bill.offset-pay')[0],{},finance);
  assert.equal(f.b.status,'paid');assert.equal(f.b.reason,originalReason);assert.equal(f.b.adjustmentReason,originalAdjustment);assert.deepEqual(f.b.events.slice(0,originalEvents.length),originalEvents);assert.deepEqual(f.s.goodsOffsetPlans.find(p=>p.id===oldPlanId),oldPlan);
  const beforeRead=structuredClone(f.s);
  for(const actor of [finance,storeFinance]){
    const html=f.page(actor),notices=[...html.matchAll(/<div class="notice [^"]*">([\s\S]*?)<\/div>/g)].map(([,body])=>decode(body));
    assert.ok(notices.includes('原调整已核对并结清，依据见操作记录。'));
    assert.ok(notices.every(body=>!body.includes('核对说明：关联订单售后变化，请重新核对')),'旧调整依据保留在操作记录，不作为当前待核提示');
    assert.match(html,/<ol class="timeline">[\s\S]*关联订单售后变化，请重新核对/);
    assert.equal(forms(html,'bill.offset-pay').length,0);assert.equal(forms(html,'bill.offset-query').length,0);
  }
  assert.deepEqual(f.s,beforeRead);
});

test('退款调整重新确认后及付款失败重试不再显示当前待重核，历史依据保持',()=>{
  const f=fixture(),finance=f.staff('finance'),storeFinance=f.staff('store-finance','xingfu'),orderId=f.create();f.bill();f.refund(orderId);
  const id=f.b.id,reason=f.b.reason,adjustment=f.b.adjustmentReason,originalEvents=structuredClone(f.b.events);
  assert.equal(f.b.status,'adjusted');
  const check=expected=>{const before=structuredClone(f.s);for(const actor of [finance,storeFinance]){
    const html=f.page(actor),notices=[...html.matchAll(/<div class="notice [^"]*">([\s\S]*?)<\/div>/g)].map(([,body])=>decode(body));
    assert.ok(notices.includes(expected));
    if(f.b.status!=='adjusted')assert.ok(notices.every(body=>!body.includes('核对说明：关联订单售后变化，请重新核对')));
    assert.match(html,/<ol class="timeline">[\s\S]*关联订单售后变化，请重新核对/);
  }assert.deepEqual(f.s,before);assert.equal(f.b.reason,reason);assert.equal(f.b.adjustmentReason,adjustment);assert.deepEqual(f.b.events.slice(0,originalEvents.length),originalEvents);};
  check('核对说明：关联订单售后变化，请重新核对');
  f.run('bill.confirm',{id,version:f.b.version},storeFinance);
  const confirmed='本账已重新核对，付款进度见账单状态；原调整依据见操作记录。';check(confirmed);
  f.run('bill.pay',{id,outcome:'processing'},finance);check(confirmed);
  f.run('bill.query',{id,outcome:'failed'},finance);check(confirmed);
  f.run('bill.pay',{id,outcome:'processing'},finance);check(confirmed);
  f.run('bill.query',{id,outcome:'success'},finance);check('原调整已核对并结清，依据见操作记录。');
});
