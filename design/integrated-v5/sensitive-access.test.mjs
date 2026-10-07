import test from 'node:test';
import assert from 'node:assert/strict';
import {bookingSeed,bookingView} from './booking.mjs';
import {upgradeAccounts,accountCommand,resolveAccountActor} from './staff-accounts.mjs';
import {upgradeSensitiveAccess,sensitiveAccessCommand,sensitiveAccessView,maskPhone} from './sensitive-access.mjs';
import {authorizedInvoiceFile,hydrateInvoiceFiles,clearInvoiceFileUrls} from './invoice-files.mjs';
import {assertJob} from './management.mjs';
const NOW=Date.parse('2026-10-03T10:00:00+08:00');
let counter=0;
const context=s=>({id:p=>p+(++s.seq),fail:m=>{throw new Error(m);},log:(row,text)=>s.logs.push({id:row.id,text})});
function seed(){const s={...bookingSeed(),now:NOW,seq:0,users:[{id:'u1'}],logs:[],bookings:[{id:'B1',userId:'u1',storeId:'xingfu',techId:'lin',serviceId:'relax',status:'done',completedAt:NOW-3600000,startedAt:NOW-7200000,duration:60,contactName:'联系称呼',phone:'13812345678',payment:{id:'P1',status:'success',amountCents:29800,refundedCents:0},refunds:[],extensions:[],assistance:[],events:[],recipientSnapshot:{name:'服务对象',kind:'family'}}]};upgradeAccounts(s);return s;}
function staff(s,job='support',name='客服甲',storeId='xingfu') {
  const ctx=context(s),cmd=(actor,type,p)=>accountCommand(s,actor,type,{requestId:'account-'+(++counter),...p},ctx);
  const admin=cmd({role:'group'},'account.enter',{accountId:'DEMO-ADMIN',grantId:'DEMO-ADMIN-GRANT'});
  let account=cmd(admin,'account.create',{name,reason:'测试账号'});account=cmd(admin,'account.grant',{id:account.id,version:account.version,job,...job.startsWith('store-')?{storeId}:{},reason:'测试岗位'});
  const session=cmd({role:'group'},'account.enter',{accountId:account.id,grantId:account.grants[0].id});
  return {actor:resolveAccountActor(s,session),admin,accountId:account.id,enter:()=>cmd({role:'group'},'account.enter',{accountId:account.id,grantId:account.grants[0].id}),disable:()=>cmd(admin,'account.status',{id:account.id,version:s.staffAccounts.find(x=>x.id===account.id).version,enabled:false,reason:'撤销测试会话'})};
}
const reveal=(s,actor,p={})=>sensitiveAccessCommand(s,actor,'sensitive.reveal',{bookingId:'B1',reason:'处理用户反馈需核实联系方式',requestId:'reveal-'+(++counter),...p},context(s));
test('预约读取按角色脱敏，原单及其业务快照不被改写',()=>{
  const s=seed(),original=JSON.stringify(s);
  assert.equal(bookingView(s,{role:'user',userId:'u1'})[0].phone,'13812345678');
  const tech=bookingView(s,{role:'tech',techId:'lin'})[0];assert.equal(tech.phone,'');assert.equal(tech.contactMethod,'通过平台联系');assert.doesNotMatch(JSON.stringify(tech),/13812345678/);
  for(const a of [{role:'store',storeId:'xingfu'},{role:'manager',storeId:'xingfu'},{role:'group',job:'support'},{role:'group',job:'finance'},{role:'group'}]) {const b=bookingView(s,a)[0];assert.equal(b.phone,'138****5678');assert.deepEqual(b.recipientSnapshot,s.bookings[0].recipientSnapshot);assert.doesNotMatch(JSON.stringify(b),/13812345678/);}
  assert.deepEqual(bookingView(s,{role:'store',storeId:'silver'}),[]);assert.equal(JSON.stringify(s),original);assert.equal(maskPhone('invalid'),'已隐藏联系方式');
});
test('真实工作会话覆盖伪造路由身份，账号管理员无预约读取权，停用立即拒读',()=>{
  const s=seed(),a=staff(s,'store-manager','本店主管'),other=staff(s,'store-manager','跨店主管','silver');
  assert.equal(bookingView(s,{...a.actor,role:'group',job:'support',storeId:'silver'})[0].phone,'138****5678');
  assert.deepEqual(bookingView(s,{...other.actor,storeId:'xingfu'}),[]);assert.deepEqual(bookingView(s,resolveAccountActor(s,a.admin)),[]);
  a.disable();assert.throws(()=>bookingView(s,a.actor),/失效/);assert.throws(()=>bookingView(s,{role:'group',job:'support',accountId:a.accountId}),/会话缺失/);
});
test('客服按原因临时查看并审计，不把完整手机号复制到日志、请求或预约投影',()=>{
  const s=seed(),a=staff(s),original=structuredClone(s.bookings),result=reveal(s,a.actor,{reason:'联系 13812345678 核查反馈'});
  assert.deepEqual(result,{bookingId:'B1',phone:'13812345678',name:'联系称呼'});assert.deepEqual(s.bookings,original);
  assert.equal(s.sensitiveAccessLogs[0].by.accountId,a.accountId);assert.equal(s.sensitiveAccessLogs[0].by.accountName,'客服甲');assert.equal(s.sensitiveAccessLogs[0].by.sessionId,undefined);
  assert.doesNotMatch(JSON.stringify([s.sensitiveAccessLogs,s.sensitiveAccessRequests,s.logs]),/13812345678/);assert.match(s.sensitiveAccessLogs[0].reason,/138\*\*\*\*5678/);
  assert.equal(bookingView(s,a.actor)[0].phone,'138****5678');assert.equal(sensitiveAccessView(s,a.actor).records.length,1);
});
test('完整号码拒绝无原因、无请求号和越权账号；旧自由演示客服管理员明确兼容',()=>{
  const s=seed();for(const job of ['account-admin','finance','warehouse','operations','store-manager','store-finance']) {const a=staff(s,job);assert.throws(()=>reveal(s,{...a.actor,role:'group',job:'support'}),/无权|客服/);assert.equal(sensitiveAccessView(s,a.actor).canReveal,false);}
  for(const a of [{role:'user',userId:'u1'},{role:'tech',techId:'lin'},{role:'store',storeId:'xingfu'},{role:'group',job:'finance'}]) assert.throws(()=>reveal(s,a),/客服/);
  assert.throws(()=>reveal(s,{role:'group',job:'support'},{reason:''}),/原因/);assert.throws(()=>reveal(s,{role:'group',job:'support'},{requestId:''}),/标识/);
  for(const a of [{role:'group',job:'support'},{role:'group',job:'all'},{role:'group'}]) assert.equal(reveal(s,a).phone,'13812345678');
  assert.doesNotThrow(()=>assertJob({role:'group',job:'support'},'sensitive.reveal'));assert.doesNotThrow(()=>assertJob({role:'group',job:'support'},'privacy.close'));assert.throws(()=>assertJob({role:'group',job:'finance'},'privacy.close'),/无权/);
});
test('查看请求持久幂等按实际员工隔离，撤权后旧成功请求不能重放',()=>{
  const s=seed(),a=staff(s),b=staff(s,'support','客服乙'),p={requestId:'same',reason:'原请求'};
  reveal(s,a.actor,p);reveal(s,resolveAccountActor(s,a.enter()),p);assert.equal(s.sensitiveAccessLogs.length,1);
  reveal(s,b.actor,p);assert.equal(s.sensitiveAccessLogs.length,2);assert.throws(()=>reveal(s,a.actor,{...p,reason:'不同原因'}),/同一提交/);
  a.disable();assert.throws(()=>reveal(s,a.actor,p),/失效/);const before=JSON.stringify(s);upgradeSensitiveAccess(s);assert.equal(JSON.stringify(s),before);
});
test('发票附件读取也核当前会话与岗位，门店主管不能借财务route读取',()=>{
  const s=seed(),file={ref:'invoice-file:'+'a'.repeat(64),name:'票.pdf',type:'application/pdf',size:3};s.serviceInvoices=[{id:'I1',userId:'u1',storeId:'xingfu',issued:{file}}];
  const manager=staff(s,'store-manager'),finance=staff(s,'store-finance');
  assert.throws(()=>authorizedInvoiceFile(s,{...manager.actor,job:'store-finance'},'I1','issued',file.ref),/无权/);
  assert.equal(authorizedInvoiceFile(s,finance.actor,'I1','issued',file.ref),file);finance.disable();assert.throws(()=>authorizedInvoiceFile(s,finance.actor,'I1','issued',file.ref),/失效/);
});
test('异步附件等待中切换会话不插链；插链后会话变化仍阻止旧链接点击',async t=>{
  const s=seed(),a=staff(s,'store-finance'),blob=new Blob(['pdf'],{type:'application/pdf'}),file={ref:'invoice-file:'+'b'.repeat(64),name:'票.pdf',type:blob.type,size:blob.size};s.serviceInvoices=[{id:'I1',userId:'u1',storeId:'xingfu',issued:{file}}];
  const pending=[],oldDb=globalThis.indexedDB;globalThis.indexedDB={open(){const req={};queueMicrotask(()=>{req.result={transaction(){return {objectStore(){return {get(){const r={};pending.push(r);return r;}};}};}};req.onsuccess();});return req;}};
  t.after(()=>{globalThis.indexedDB=oldDb;clearInvoiceFileUrls();});
  function surface(){const link={dataset:{invoiceAction:'view'},listeners:[],removeAttribute(name){delete this[name];},addEventListener(_,fn){this.listeners.push(fn);}},status={textContent:''},node={dataset:{invoiceId:'I1',invoiceSlot:'issued',invoiceFile:file.ref},isConnected:true,matches:()=>false,querySelectorAll:()=>[link],querySelector:()=>status};return {link,status,root:{querySelectorAll:()=>[node]}};}
  let current=true,view=surface(),promise=hydrateInvoiceFiles(s,a.actor,view.root,()=>current);await new Promise(resolve=>setImmediate(resolve));current=false;let request=pending.shift();request.result=blob;request.onsuccess();await promise;assert.equal(view.link.href,undefined);assert.equal(view.status.textContent,'');
  current=true;view=surface();promise=hydrateInvoiceFiles(s,a.actor,view.root,()=>current);await new Promise(resolve=>setImmediate(resolve));request=pending.shift();request.result=blob;request.onsuccess();await promise;assert.match(view.link.href,/^blob:/);
  current=false;let prevented=false;view.link.listeners[0]({preventDefault(){prevented=true;}});assert.equal(prevented,true);assert.equal(view.link.href,undefined);
  current=true;view=surface();promise=hydrateInvoiceFiles(s,a.actor,view.root,()=>current);await new Promise(resolve=>setImmediate(resolve));a.disable();request=pending.shift();request.result=blob;request.onsuccess();await promise;assert.equal(view.link.href,undefined);assert.match(view.status.textContent,/失效/);
});
