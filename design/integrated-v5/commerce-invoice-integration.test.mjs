import test from 'node:test';
import assert from 'node:assert/strict';
import {seed,reduce,money} from './engine.mjs';
import {staffView} from './staff.mjs';
import {customerView} from './customer.mjs';
import {resolveAccountActor} from './staff-accounts.mjs';
const user={role:'user',userId:'u1'},finance={role:'group',job:'finance'},support={role:'group',job:'support'};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ui={esc,money,date:v=>String(v??''),query:new URLSearchParams(),link:(n,p,c='')=>`<a class="${c}" href="#${p}">${n}</a>`,button:(n,t,p={},c='primary')=>`<button class="${c}" data-command="${t}" data-payload="${esc(JSON.stringify(p))}">${n}</button>`,field:(n,k,v='',t='text',attrs='')=>`<label>${n}<input name="${k}" type="${t}" value="${esc(v)}" ${attrs}></label>`,select:(n,k,opts,v)=>`<label>${n}<select name="${k}">${opts.map(o=>`<option value="${o.value}" ${String(o.value)===String(v)?'selected':''}>${o.label}</option>`).join('')}</select></label>`,tag:(n,c='')=>`<span class="${c}">${n}</span>`,empty:n=>`<p>${n}</p>`};
const file={ref:'invoice-file:'+'b'.repeat(64),name:'local-demo.pdf',type:'application/pdf',size:734};
const title={kind:'personal',title:'Demo王女士',email:'demo@example.com'};
function fixture(){let s=seed(),n=0;const f={get s(){return s;},get inv(){return s.commerceInvoices.at(-1);},run(t,p={},a=user){let result;s=reduce(s,a,t,{requestId:'commerce-integration-'+ ++n,...p},x=>result=x);return result;},publish(){return f.run('commerce-invoice.rule-publish',{category:'goods',version:0,issuerName:'明确输入的Demo集团主体',issuerTaxId:'91320100000000000Y',invoiceItem:'Demo商品销售',effectiveAt:s.now,sourceFromAt:s.now,applicationStage:'paid',shipping:'include',windowDays:30,reason:'本地验收输入，不是正式开票政策'},finance);},create(){f.run('cart.set',{skuId:'oil',qty:1});f.run('goods.submit',{addressId:'AD1'});const id=s.goods.at(-1).id;f.run('goods.pay',{id,outcome:'success'});f.run('goods.ship',{id,carrier:'Demo物流',tracking:'DEMO-'+n},{role:'group',job:'warehouse'});f.run('goods.receive',{id});return id;},staff(job,storeId){const x=f.run('account.create',{name:'演示'+job,reason:'本地角色验证'},f.admin);const g=f.run('account.grant',{id:x.id,version:x.version,job,...(storeId?{storeId}:{}),reason:'本地角色验证'},f.admin);const entry=f.run('account.enter',{accountId:x.id,grantId:g.grants.at(-1).id});return resolveAccountActor(s,entry);}};const entry=f.run('account.enter',{accountId:'DEMO-ADMIN',grantId:'DEMO-ADMIN-GRANT'});f.admin=resolveAccountActor(s,entry);return f;}

test('真实reduce商品票申请→开票→原部分取消退款→待红冲→红冲→净额重开，原服务账不变',()=>{
 const f=fixture();f.publish();const id=f.create(),original=structuredClone({bookings:f.s.bookings,serviceInvoices:f.s.serviceInvoices,finance:f.s.serviceFinanceEntries});
 const inv=f.run('commerce-invoice.apply-goods',{orderId:id,...title});assert.equal(inv.amount,21000);
 f.run('commerce-invoice.issue',{id:inv.id,version:f.inv.version,ticketNumber:'DEMO-GOODS-BLUE',file},finance);
 assert.match(customerView(f.s,user,['goods',id],ui),/查看商品发票/);
 const o=f.s.goods.find(x=>x.id===id);f.run('goods.case',{id,kind:'refund',skuId:'oil',qty:1,amountCents:10000,reason:'Demo原售后协商'});
 const caseId=f.s.goods.find(x=>x.id===id).cases.at(-1).id;f.run('goods.case-review',{id,caseId,decision:'approve',reason:'Demo核对通过'},support);
 f.run('goods.refund',{id,caseId,outcome:'processing'},finance);assert.equal(f.inv.status,'issued');
 f.run('goods.refund-query',{id,caseId,outcome:'success'},finance);assert.equal(f.inv.status,'red_pending');assert.equal(f.inv.issued.amountCents,21000);
 f.run('commerce-invoice.red',{id:inv.id,version:f.inv.version,ticketNumber:'DEMO-GOODS-RED',file},finance);
 f.run('commerce-invoice.reapply',{id:inv.id,version:f.inv.version,...title});assert.equal(f.inv.amount,11000);assert.equal(f.inv.replacesId,inv.id);
 assert.deepEqual({bookings:f.s.bookings,serviceInvoices:f.s.serviceInvoices,finance:f.s.serviceFinanceEntries},original);
 assert.equal(f.s.goods.find(x=>x.id===id).commissionPaidCents,0);assert.equal(o.lines[0].paidCents,20000);
});

test('真实工作账号岗位能访问集团票，原服务票开具权限保持；仓储客服店长及跨店拒绝',()=>{
 const f=fixture();f.publish();const id=f.create(),inv=f.run('commerce-invoice.apply-goods',{orderId:id,...title});
 const gf=f.staff('finance'),sf=f.staff('store-finance','xingfu'),warehouse=f.staff('warehouse'),customer=f.staff('support'),manager=f.staff('store-manager','xingfu');
 assert.match(staffView(f.s,gf,['commodity-invoices',inv.id],ui),/登记已开票/);
 for(const a of [sf,warehouse,customer,manager]){assert.match(staffView(f.s,a,['commodity-invoices',inv.id],ui),/无权/);assert.throws(()=>f.run('commerce-invoice.issue',{id:inv.id,version:f.inv.version,ticketNumber:'NO',file},a),/无权|仅集团/);}
 assert.match(staffView(f.s,sf,['fee-invoices'],ui),/集团服务费月票/);
 assert.throws(()=>f.run('commerce-invoice.apply-fee',{storeId:'silver',month:'2026-09',kind:'company',taxId:'91320100000000000X',title:'Demo',email:'demo@example.com'},sf),/仅本店|当前身份|归属|无权|本门店/);
 f.run('commerce-invoice.issue',{id:inv.id,version:f.inv.version,ticketNumber:'BLUE-AUTH',file},gf);
 f.run('account.status',{id:gf.accountId,version:f.s.staffAccounts.find(x=>x.id===gf.accountId).version,enabled:false,reason:'本地失效会话验收'},f.admin);
 assert.match(staffView(f.s,gf,['commodity-invoices',inv.id],ui),/失效/);
 assert.throws(()=>f.run('commerce-invoice.replace-file',{id:inv.id,version:f.inv.version,slot:'issued',reason:'失权后不能补传',file},gf),/失效/);
});

test('共享reduce迁移不把无配置变成默认规则；本人重放不重复申请，其他用户或内容变化拒绝',()=>{
 const f=fixture(),id=f.create();assert.equal(f.s.commerceInvoiceRules.length,0);assert.throws(()=>f.run('commerce-invoice.apply-goods',{orderId:id,...title}),/尚未发布/);
 f.publish();const p={orderId:id,...title,requestId:'apply-stable'},inv=f.run('commerce-invoice.apply-goods',p);f.run('commerce-invoice.apply-goods',p);assert.equal(f.s.commerceInvoices.length,1);
 assert.throws(()=>f.run('commerce-invoice.apply-goods',{...p,title:'changed'}),/不同/);
 assert.throws(()=>f.run('commerce-invoice.apply-goods',p,{role:'user',userId:'u2'}),/本人|无权|归属/);
 assert.match(customerView(f.s,{role:'user',userId:'u2'},['commodity-invoices',inv.id],ui),/不存在|无权/);
 assert.equal(f.s.commerceInvoiceRules[0].productionApproved,false);
});
