import test from 'node:test';
import assert from 'node:assert/strict';
import { seed, reduce, money } from './engine.mjs';
import { syncInvoices } from './service-invoices.mjs';
import { invoiceView, invoiceBookingPanel } from './invoice-ui.mjs';

const HOUR=3600000, DAY=24*HOUR;
const user={role:'user',userId:'u1'},otherUser={role:'user',userId:'u2'},store={role:'store',storeId:'xingfu'},manager={role:'manager',storeId:'xingfu'},finance={role:'group',job:'finance'};
const file={ref:'invoice-file:'+'a'.repeat(64),name:'服务发票.pdf',type:'application/pdf',size:200};
const redFile={ref:'invoice-file:'+'b'.repeat(64),name:'红冲凭证.pdf',type:'application/pdf',size:300};
const title={kind:'personal',title:'王女士',email:'wang@example.test'};
const e=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const decode=value=>value.replace(/&quot;|&#39;|&lt;|&gt;|&amp;/g,item=>({'&quot;':'"','&#39;':"'",'&lt;':'<','&gt;':'>','&amp;':'&'}[item]));
const ui=(query='')=>({
  esc:e,money,date:at=>at?new Date(at).toISOString():'—',query:new URLSearchParams(query),
  link:(label,path,kind='')=>`<a href="#${e(path)}" class="${e(kind)}">${label}</a>`,
  field:(label,name,value='',type='text',attrs='')=>`<label class="field"><span>${e(label)}</span><input name="${e(name)}" type="${e(type)}" value="${e(value)}" ${attrs}></label>`,
  select:(label,name,options,value)=>`<label><span>${e(label)}</span><select name="${e(name)}">${options.map(x=>`<option value="${e(x.value)}" ${x.value===value?'selected':''}>${e(x.label)}</option>`).join('')}</select></label>`,
  tag:(label,kind='')=>`<span class="tag ${e(kind)}">${e(label)}</span>`,empty:(label,detail='')=>`<section><h2>${e(label)}</h2><p>${e(detail)}</p></section>`,
});
function forms(html,command) {
  return [...html.matchAll(/<form\b([^>]+)>/g)].map(([,tag])=>Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(([,key,value])=>[key,decode(value)]))).filter(x=>x['data-command']===command);
}
function payload(html,command) {
  const [form]=forms(html,command); assert.ok(form,`页面缺少 ${command}`); return JSON.parse(form['data-payload']);
}
let request=0;
const run=(s,actor,command,values)=>reduce(s,actor,command,{requestId:'invoice-ui-'+(++request),...values});
function completed() {
  const s=seed();
  s.bookings.push({id:'BK-INVOICE',userId:'u1',storeId:'xingfu',serviceId:'relax',techId:'lin',status:'done',startAt:s.now-2*HOUR,startedAt:s.now-2*HOUR,completedAt:s.now-HOUR,duration:60,extensions:[],refunds:[],disputes:[],assistance:[],events:[],payment:{id:'BP-INVOICE',status:'success',amountCents:29800,refundedCents:0},priceCents:29800});
  return s;
}
function apply(s=completed(),fields=title) {
  return run(s,user,'invoice.apply',{bookingId:'BK-INVOICE',...fields});
}
function issue(s=apply()) {
  const inv=s.serviceInvoices.at(-1);
  return run(s,store,'invoice.issue',{id:inv.id,version:inv.version,ticketNumber:'FP20261003',file});
}
function successfulRefund(s,amount) {
  const next=structuredClone(s);next.bookings[0].payment.refundedCents=amount;syncInvoices(next);return next;
}
const view=(s,actor=user,id=s.serviceInvoices?.at(-1)?.id,query='')=>invoiceView(s,['invoices',...(id?[id]:[])],actor,ui(query));

test('发票视图仅匹配发票路由，技师及无权集团岗位深链不泄露内容',()=>{
  const s=apply();
  assert.equal(invoiceView(s,['bookings'],store,ui()),null);
  for(const actor of [{role:'tech',techId:'lin'},{role:'group',job:'support'},{role:'group',job:'warehouse'},{role:'group',job:'operations'}]) {
    const html=view(s,actor);
    assert.match(html,/无权查看服务发票/);assert.doesNotMatch(html,/wang@example|王女士|FP2026/);
    assert.equal(invoiceBookingPanel(s,s.bookings[0],actor,ui()),'');
  }
});

test('用户只从本人已完成且90天内有正净额、无退款阻断的预约申请',()=>{
  let s=completed();
  assert.equal(forms(invoiceBookingPanel(s,s.bookings[0],user,ui()),'invoice.apply').length,1);
  assert.equal(invoiceBookingPanel(s,s.bookings[0],otherUser,ui()),'');
  s.bookings[0].status='active';assert.equal(invoiceBookingPanel(s,s.bookings[0],user,ui()),'');
  s.bookings[0].status='done';s.now=s.bookings[0].completedAt+90*DAY+1;
  let html=invoiceBookingPanel(s,s.bookings[0],user,ui());assert.match(html,/90天/);assert.equal(forms(html,'invoice.apply').length,0);
  s=completed();s.bookings[0].payment.refundedCents=29800;
  html=invoiceBookingPanel(s,s.bookings[0],user,ui());assert.match(html,/净实付为零/);assert.equal(forms(html,'invoice.apply').length,0);
  s=completed();s.bookings[0].refunds=[{id:'RF',status:'processing'}];
  html=invoiceBookingPanel(s,s.bookings[0],user,ui());assert.match(html,/未结退款/);assert.equal(forms(html,'invoice.apply').length,0);
});

test('用户申请表单键包含用户身份与预约，单个抬头类型选择可由应用同步税号必填',()=>{
  const s=completed(),html=invoiceBookingPanel(s,s.bookings[0],user,ui()),[form]=forms(html,'invoice.apply');
  assert.match(form['data-management-form'],/u1.*BK-INVOICE/);assert.equal(form['data-next'],'/user/invoices');
  assert.deepEqual(JSON.parse(form['data-payload']),{bookingId:'BK-INVOICE'});
  assert.match(html,/name="kind" data-invoice-kind/);assert.match(html,/name="taxId"[^>]*disabled/);
  assert.match(html,/name="email"[^>]*type="email"[^>]*required/);assert.match(html,/management-draft-note/);
  assert.equal(forms(html,'invoice.apply').length,1);
  assert.equal(html,invoiceBookingPanel(s,s.bookings[0],user,ui()));
});

test('申请、门店驳回、用户企业抬头重提、门店开票均使用渲染表单中的目标及版本',()=>{
  let s=completed();
  s=run(s,user,'invoice.apply',{...payload(invoiceBookingPanel(s,s.bookings[0],user,ui()),'invoice.apply'),...title});
  s=run(s,store,'invoice.reject',{...payload(view(s,store),'invoice.reject'),reason:'请核对企业抬头'});
  assert.match(view(s,user),/驳回原因：请核对企业抬头/);
  s=run(s,user,'invoice.resubmit',{...payload(view(s,user),'invoice.resubmit'),kind:'company',title:'天俪测试企业',taxId:'91320100000000000X',email:'finance@example.test'});
  const html=view(s,store),[form]=forms(html,'invoice.issue');
  assert.equal(form['data-live-version'],String(s.serviceInvoices[0].version));
  assert.match(html,/data-invoice-upload/);assert.match(html,/name="fileRef"/);assert.match(html,/name="fileName"/);assert.match(html,/name="fileType"/);assert.match(html,/name="fileSize"/);
  s=run(s,store,'invoice.issue',{...payload(html,'invoice.issue'),ticketNumber:'FP-UI',file});
  assert.match(view(s,user),/已开票/);assert.match(view(s,user),/FP-UI/);
  assert.equal(forms(view(s,store),'invoice.issue').length,0);
});

test('经理只看办理摘要且不通过列表搜索、详情或附件暴露抬头税号邮箱',()=>{
  const s=issue(apply(completed(),{kind:'company',title:'PRIVATE-COMPANY',taxId:'91320100000000000X',email:'private@example.test'}));
  for(const html of [view(s,manager),invoiceView(s,['invoices'],manager,ui()),invoiceBookingPanel(s,s.bookings[0],manager,ui())]) {
    assert.match(html,/已开票/);assert.match(html,/298\.00/);
    assert.doesNotMatch(html,/PRIVATE-COMPANY|91320100000000000X|private@example|invoice-file:|服务发票\.pdf|data-invoice-upload|data-invoice-file/);
    assert.equal(forms(html,'invoice.issue').length,0);
  }
  const filtered=invoiceView(s,['invoices'],manager,ui('q=PRIVATE-COMPANY'));
  assert.doesNotMatch(filtered,/查看进度/);
});

test('跨用户和跨店不可读取发票，集团财务可完整查看但无签发或补传表单',()=>{
  const s=issue();
  for(const actor of [otherUser,{role:'store',storeId:'silver'},{role:'manager',storeId:'silver'}]) {
    const html=view(s,actor);assert.match(html,/不存在或无权/);assert.doesNotMatch(html,/wang@example|invoice-file:/);
  }
  for(const actor of [finance,{role:'group'},{role:'group',job:'all'}]) {
    const html=view(s,actor);assert.match(html,/wang@example/);assert.match(html,/data-invoice-file/);
    for(const command of ['invoice.apply','invoice.issue','invoice.reject','invoice.red','invoice.replace-file','invoice.reapply']) assert.equal(forms(html,command).length,0);
    assert.match(html,/由原服务门店/);
  }
});

test('待开票受未结退款阻断时保留理由和驳回出口，不提供旧净额开票表单',()=>{
  const s=apply();s.bookings[0].refunds=[{id:'RF1',status:'requested'}];
  const html=view(s,store);assert.match(html,/未结退款/);assert.equal(forms(html,'invoice.issue').length,0);assert.equal(forms(html,'invoice.reject').length,1);
  const userPanel=invoiceBookingPanel(s,s.bookings[0],user,ui());
  assert.equal(forms(userPanel,'invoice.apply').length,0);assert.match(userPanel,/查看服务发票/);
});

test('开票后退款保留原票金额及原快照，另列当前净额和红冲办理',()=>{
  let s=completed();s.bookings[0].extensions=[{id:'BP-EXTENSION',status:'success',amountCents:10000,refundedCents:0,duration:30}];
  s=successfulRefund(issue(apply(s)),9800);
  const html=view(s,store);
  assert.match(html,/待红冲/);assert.match(html,/原票金额/);assert.match(html,/398\.00/);assert.match(html,/当前净实付/);assert.match(html,/300\.00/);
  assert.match(html,/原票支付与退款依据/);assert.match(html,/BP-EXTENSION/);
  assert.equal(forms(html,'invoice.red').length,1);assert.equal(forms(html,'invoice.issue').length,0);
});

test('待红冲时仍有另一笔未结退款，也允许登记原票红冲但不提前净额重开',()=>{
  const s=successfulRefund(issue(),9800);s.bookings[0].refunds=[{id:'RF-NEXT',status:'requested'}];
  const html=view(s,store);assert.match(html,/未结退款/);assert.equal(forms(html,'invoice.red').length,1);
  assert.equal(forms(view(s,user),'invoice.reapply').length,0);
});

test('已在期限内发起的票链，90天后可红冲后净额重开并保留替代关联',()=>{
  let s=successfulRefund(issue(),9800),oldId=s.serviceInvoices[0].id;
  s.now=s.bookings[0].completedAt+91*DAY;
  s=run(s,store,'invoice.red',{...payload(view(s,store),'invoice.red'),ticketNumber:'RED-UI',file:redFile});
  s=run(s,user,'invoice.reapply',{...payload(view(s,user),'invoice.reapply'),...title});
  const newId=s.serviceInvoices.at(-1).id;
  assert.match(view(s,user,oldId),new RegExp('后续重开申请'));
  assert.match(view(s,user,newId),new RegExp('替代原申请'));
  assert.equal(forms(view(s,user,oldId),'invoice.reapply').length,0);
  assert.match(invoiceBookingPanel(s,s.bookings[0],user,ui()),new RegExp(newId));
  s=run(s,store,'invoice.reject',{...payload(view(s,store,newId),'invoice.reject'),reason:'更正抬头'});
  assert.equal(forms(view(s,user,newId),'invoice.resubmit').length,1);
});

test('全额退款完成红冲后只展示历史票，不出现零金额重开表单',()=>{
  let s=successfulRefund(issue(),29800);
  s=run(s,store,'invoice.red',{...payload(view(s,store),'invoice.red'),ticketNumber:'RED-FULL',file:redFile});
  const html=view(s,user);assert.match(html,/净实付为零/);assert.match(html,/298\.00/);assert.equal(forms(html,'invoice.reapply').length,0);
  assert.match(html,/data-invoice-slot="issued"/);assert.match(html,/data-invoice-slot="red"/);
});

test('附件只提供经过权限存储层接管的引用，未加载前没有虚假查看下载地址',()=>{
  const s=issue(),html=view(s,user),id=s.serviceInvoices[0].id;
  assert.ok(html.includes(`data-invoice-file="${file.ref}"`));assert.ok(html.includes(`data-invoice-id="${id}"`));assert.match(html,/data-invoice-slot="issued"/);
  const links=[...html.matchAll(/<a\b[^>]*data-invoice-action="download"[^>]*>/g)].map(x=>x[0]);
  assert.equal(links.length,1);for(const link of links) assert.doesNotMatch(link,/href=/);
  assert.match(html,/<button[^>]*data-invoice-action="view"[^>]*aria-expanded="false"[^>]*disabled/);
  assert.match(html,/data-invoice-preview role="region"[^>]*hidden/);
  assert.match(html,/data-invoice-action="close-preview"/);
  assert.doesNotMatch(html,/<a[^>]*data-invoice-action="view"/);
  assert.match(html,/data-invoice-file-status/);assert.match(html,/文件不可用时请联系服务门店补传/);
  const replacement=payload(view(s,store),'invoice.replace-file');assert.equal(replacement.slot,'issued');assert.equal(replacement.version,s.serviceInvoices[0].version);
  assert.match(view(s,store),/补传原因/);assert.equal(forms(html,'invoice.replace-file').length,0);
});

test('企业驳回重提表单保留企业字段和版本，过期原申请仅给明确不可重提原因',()=>{
  let s=apply(completed(),{kind:'company',title:'原企业',taxId:'91320100000000000X',email:'corp@example.test'});
  s=run(s,store,'invoice.reject',{...payload(view(s,store),'invoice.reject'),reason:'核对资料'});
  const html=view(s,user);assert.match(html,/name="taxId"[^>]*required/);assert.match(html,/value="91320100000000000X"/);
  const [form]=forms(html,'invoice.resubmit');assert.match(form['data-management-form'],/u1/);assert.equal(form['data-live-version'],String(s.serviceInvoices[0].version));
  s.now=s.bookings[0].completedAt+90*DAY+1;
  assert.equal(forms(view(s,user),'invoice.resubmit').length,0);assert.match(view(s,user),/90天/);
});

test('纯发票页面渲染不修改状态，抬头原因文件名转义，列表状态筛选准确',()=>{
  let s=apply(completed(),{...title,title:'<script>申请人</script>'});
  const snapshot=JSON.stringify(s);
  const html=view(s,user);assert.doesNotMatch(html,/<script>/);assert.match(html,/&lt;script&gt;/);
  invoiceBookingPanel(s,s.bookings[0],user,ui());
  assert.equal(JSON.stringify(s),snapshot);
  assert.match(invoiceView(s,['invoices'],store,ui('status=pending')),/查看详情/);
  assert.doesNotMatch(invoiceView(s,['invoices'],store,ui('status=issued')),/查看详情/);
  s=run(s,store,'invoice.issue',{...payload(view(s,store),'invoice.issue'),ticketNumber:'SAFE',file:{...file,name:'<img src=x>.pdf'}});
  assert.doesNotMatch(view(s,user),/<img src=x>/);assert.match(view(s,user),/&lt;img src=x&gt;\.pdf/);
});
