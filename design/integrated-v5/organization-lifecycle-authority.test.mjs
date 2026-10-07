import test from 'node:test';
import assert from 'node:assert/strict';
import {seed,reduce,goodsSummary} from './engine.mjs';
import {accountCommand,resolveAccountActor,assertAccountCommand,canAccountCommand,canAccountReadSource,canAccountView} from './staff-accounts.mjs';
import {lifecycleCommand} from './organization-lifecycle.mjs';
import {lifecycleImpact,lifecycleCaseImpact,captureLifecycleResponsibilities} from './organization-lifecycle-projection.mjs';
import {lifecycleAuthorityCommand,lifecycleAuthorityPreflight,applyLifecycleAuthorityExit,lifecycleHandoverCommands} from './organization-lifecycle-authority.mjs';
import {invoiceCommand,canReadInvoice} from './service-invoices.mjs';
import {bookingView} from './booking.mjs';
import {techIncomeView} from './tech-income.mjs';
import {invoiceView,invoiceBookingPanel} from './invoice-ui.mjs';
const user={role:'user',userId:'u1'},ops={role:'group',job:'operations'},MIN=60000;
const ui={esc:v=>String(v??''),money:v=>String(v),date:v=>String(v),link:(label,path)=>`<a href="${path}">${label}</a>`,field:(label,name,value)=>`<input name="${name}" value="${value}">`,select:()=>'',tag:v=>`<span>${v}</span>`,empty:(title,detail)=>title+detail,query:new URLSearchParams()};

function fixture(){
  let s=reduce(seed(),user,'clock.advance',{minutes:1}),requests=0;
  const ctx=state=>({goodsSummary,lifecycleAuthorityCommand,id:prefix=>prefix+ ++state.seq,fail:message=>{throw new Error(message);},log:()=>{}});
  const run=(actor,type,p={})=>{const next=structuredClone(s),a=resolveAccountActor(next,actor),payload={requestId:'authority-test-'+ ++requests,reason:'本地隔离实际授权依据',...p};assertAccountCommand(a,type,payload,next);const command=type.startsWith('account.')?accountCommand:type.startsWith('lifecycle.')?lifecycleCommand:invoiceCommand,result=command(next,a,type,payload,ctx(next));s=next;return result;};
  const enter=(accountId='DEMO-ADMIN',grantId='DEMO-ADMIN-GRANT')=>{const result=run(user,'account.enter',{accountId,grantId});return resolveAccountActor(s,result);};
  const admin=enter();
  const f={get s(){return s;},get c(){return s.organizationLifecycleCases.at(-1);},admin,run,enter,resolve:actor=>resolveAccountActor(s,actor),account:id=>s.staffAccounts.find(a=>a.id===id),create(job,storeId,techId){let a=run(admin,'account.create',{name:'隔离实际'+job});a=run(admin,'account.employment',{id:a.id,version:a.version,employmentStatus:'active',reference:'EMP-'+a.id,verifiedAt:s.now,...(techId?{techId}:{})});a=run(admin,'account.grant',{id:a.id,version:a.version,job,...(storeId?{storeId}:{})});const grant=a.grants.at(-1);return {id:a.id,grantId:grant.id,job,storeId,actor:enter(a.id,grant.id)};},grant(m,job,storeId,extra={}){const a=f.account(m.id);return run(admin,'account.grant',{id:a.id,version:a.version,job,...(storeId?{storeId}:{}),...extra});},start(kind='store-close'){const scope=kind==='store-close'?{storeId:'xingfu'}:{techId:'lin'},subject=kind==='store-close'?s.stores[0]:s.techs[0];return run(ops,'lifecycle.'+kind+'-start',{...scope,version:subject.version,sourceToken:lifecycleImpact(s,scope,{goodsSummary}).sourceToken,reference:'CASE-'+kind});},register(m,storeId=m.storeId||f.c.fromStoreId,extra={}){const a=f.account(m.id);return run(admin,'account.handover',{caseId:f.c.id,caseVersion:f.c.version,accountId:m.id,accountVersion:a.version,grantId:m.grantId,storeId,allowedCommands:lifecycleHandoverCommands(m.job),reference:'HAND-'+m.id+'-'+storeId,...extra});},accept(m,h){return run(m.actor,'account.handover-accept',{id:h.id,version:h.version,reference:'SELF-'+h.id});},members(){return [f.create('support'),f.create('finance'),f.create('store-finance','xingfu')];},handover(members){for(const m of members)f.accept(m,f.register(m));},preflight(options={}){return lifecycleAuthorityPreflight(s,f.c,{goodsSummary,...options});},apply(options={}){const next=structuredClone(s),c=next.organizationLifecycleCases.at(-1),result=applyLifecycleAuthorityExit(next,c,{...ctx(next),...options});s=next;return result;},closeDomain(){f.c.stage=f.c.status='completed';const store=s.stores.find(x=>x.id===f.c.storeId);store.lifecycleStatus='closed';store.closedAt=s.now;store.active=false;},oldBooking(){const b={id:'OLD-B',userId:'u1',storeId:'xingfu',techId:'lin',createdAt:s.now-2*MIN,status:'done',completedAt:s.now-MIN,payment:{id:'OLD-P',status:'success',amountCents:19800,refundedCents:0},extensions:[],refunds:[],events:[]};s.bookings.push(b);return b;}};
  return f;
}

test('实际原管理员登记和目标本人会话确认，未确认及错误角色不能成为承接',()=>{
  const f=fixture(),members=f.members();f.start();const before=structuredClone(f.s),v=f.preflight();assert.equal(v.ready,false);assert.deepEqual(f.s,before);assert.ok(v.blockers.every(x=>x.sourceId&&x.path));assert.match(v.sourceToken,/^sha256:[a-f0-9]{64}$/);
  const support=members[0],h=f.register(support);assert.throws(()=>f.accept(members[1],h),/本人确认/);assert.equal(f.s.organizationAuthorityHandovers[0].status,'pending');assert.equal(f.preflight().ready,false);
  f.accept(support,h);for(const m of members.slice(1))f.accept(m,f.register(m));assert.equal(f.preflight().ready,true);assert.equal(f.preflight().retainedRights.length,3);
  assert.throws(()=>f.register(support),/已有同一/);assert.throws(()=>f.register(members[2],'silver'),/原责任门店/);
});

test('登记核原案与账号版本，不能凭标签、跨岗位或新权限承接',()=>{
  const f=fixture(),support=f.create('support'),finance=f.create('finance');f.start();
  for(const extra of [{caseVersion:f.c.version-1},{accountVersion:f.account(support.id).version-1},{allowedCommands:['invoice.issue']},{allowedCommands:['manage.tech-save']},{allowedCommands:['lifecycle.complete']}])assert.throws(()=>f.register(support,undefined,extra));
  delete f.account(finance.id).history.find(x=>x.action==='account.employment').employment;
  assert.throws(()=>f.register(finance),/在岗/,'伪在岗标签缺少实际人员记录不能承接');
  assert.throws(()=>f.run({role:'group',job:'all'},'account.handover',{caseId:f.c.id}),/管理员/);
});

test('原授权/会话容器或承接字段缺损返回真实阻断，纯读取不补事实',()=>{
  for(const mutate of [f=>{f.s.staffAccounts={};},f=>{delete f.s.staffSessions;},f=>{f.s.organizationAuthorityHandovers={};},f=>{f.s.organizationAuthorityHandovers[0].allowedCommands=null;},f=>{f.account(f.member.id).history={};}]){const f=fixture(),members=f.members();f.member=members[0];f.start();f.handover(members);mutate(f);const before=structuredClone(f.s),v=f.preflight();assert.equal(v.ready,false);assert.ok(v.blockers.length);assert.ok(v.blockers.every(x=>x.sourceId&&x.path));assert.deepEqual(f.s,before);}
});

test('实际承接撤回保留来源，版本变化后须重登记和本人重新确认',()=>{
  const f=fixture(),members=f.members();f.start();f.handover(members);const h=f.s.organizationAuthorityHandovers[0],support=members[0];
  const accepted=structuredClone(h),p={requestId:'cancel-once',id:h.id,version:h.version,reason:'实际承接安排撤回'};const cancelled=f.run(f.admin,'account.handover-cancel',p);assert.equal(cancelled.status,'cancelled');assert.equal(cancelled.acceptanceReference,accepted.acceptanceReference);assert.deepEqual(f.run(f.admin,'account.handover-cancel',p),cancelled);assert.equal(f.preflight().ready,false);
  const replacement=f.register(support);f.accept(support,replacement);assert.equal(f.preflight().ready,true);assert.equal(f.s.organizationAuthorityHandovers.length,4);
});

test('承接接受后真实撤权、到期、在岗结束或来源修改立即阻断，失败不撤任何权限',()=>{
  for(const mutate of [f=>{const a=f.account(f.membersUsed[0].id);f.run(f.admin,'account.revoke',{id:a.id,version:a.version,grantId:f.membersUsed[0].grantId});},f=>{f.account(f.membersUsed[0].id).grants[0].validTo=f.s.now;},f=>{const a=f.account(f.membersUsed[0].id);f.run(f.admin,'account.employment',{id:a.id,version:a.version,employmentStatus:'ended',reference:'REAL-END',verifiedAt:f.s.now});},f=>{f.account(f.membersUsed[0].id).employment.reference='changed-without-original-source';}]){
    const f=fixture();f.membersUsed=f.members();f.start();f.handover(f.membersUsed);const token=f.preflight().sourceToken;mutate(f);const before=structuredClone(f.s);assert.equal(f.preflight().ready,false);assert.throws(()=>f.apply({expectedAuthorityToken:token}));assert.deepEqual(f.s,before);
  }
});

test('开始关店保留原会话，实际adapter结束旧会话且保留原店财务限定承接',()=>{
  const f=fixture(),members=f.members(),manager=f.create('store-manager','xingfu');f.start();assert.equal(f.resolve(manager.actor).job,'store-manager');f.handover(members);
  const before=structuredClone({bookings:f.s.bookings,goods:f.s.goods,entries:f.s.techIncomeEntries}),r=f.apply({expectedAuthorityToken:f.preflight().sourceToken});
  assert.ok(r.endedGrantIds.includes(manager.grantId));assert.ok(r.retainedGrantIds.includes(members[2].grantId));assert.ok(r.revokedSessionIds.includes(manager.actor.sessionId));assert.ok(r.revokedSessionIds.includes(members[2].actor.sessionId));assert.throws(()=>f.resolve(manager.actor),/失效/);assert.throws(()=>f.resolve(members[2].actor),/失效/);
  assert.deepEqual({bookings:f.s.bookings,goods:f.s.goods,entries:f.s.techIncomeEntries},before);f.closeDomain();assert.throws(()=>f.enter(manager.id,manager.grantId),/未启用/);assert.throws(()=>f.resolve({role:'store',storeId:'xingfu'}),/已关闭/);const target=f.enter(members[2].id,members[2].grantId);assert.equal(target.lifecyclePurpose,'lifecycle-settlement');assert.equal(canAccountView(target,'invoices'),true);assert.equal(canAccountView(target,'technicians'),false);
});

test('原店限定会话可处理关店后原客户申请的原服务发票，原领域权限金额保持',()=>{
  const f=fixture(),members=f.members(),b=f.oldBooking();f.start();f.handover(members);f.apply();f.closeDomain();const finance=f.enter(members[2].id,members[2].grantId);
  const inv=f.run(user,'invoice.apply',{bookingId:b.id,kind:'personal',title:'合成原客户',email:'local@example.com'});assert.equal(inv.amount,19800);assert.equal(canAccountReadSource(f.s,finance,'invoice',inv),true);assert.equal(canReadInvoice(finance,inv,f.s),true);
  const rejected=f.run(finance,'invoice.reject',{id:inv.id,version:inv.version,reason:'按原票真实字段核对退回'});assert.equal(rejected.status,'rejected');assert.equal(rejected.amount,19800);assert.equal(rejected.history.at(-1).actor.accountId,finance.accountId);assert.throws(()=>f.run(members[1].actor,'invoice.reject',{id:inv.id,version:rejected.version}),/原门店|无权/);
});

test('界面能力无需假载荷，真实submit仍核本案原来源且不能借actor缓存越权',()=>{
  const f=fixture(),members=f.members(),b=f.oldBooking();f.start();f.handover(members);f.apply();f.closeDomain();const actor=f.enter(members[2].id,members[2].grantId);
  for(const type of ['invoice.issue','tech-income.payout','booking.payment-query'])assert.equal(canAccountCommand(actor,type),true);assert.equal(canAccountCommand(actor,'account.leave'),true);for(const type of ['manage.tech-save','booking.assign','lifecycle.complete','invented.command'])assert.equal(canAccountCommand(actor,type),false);
  assert.equal(canAccountCommand({...actor,role:'group'},'invoice.issue'),false);assert.equal(canAccountCommand({accountId:actor.accountId},'invoice.issue'),false);assert.equal(canAccountCommand(f.create('operations').actor,'lifecycle.complete'),true);
  assert.throws(()=>assertAccountCommand(actor,'booking.payment-query'),/限定承接/);assert.doesNotThrow(()=>assertAccountCommand(actor,'booking.payment-query',{id:b.id},f.s));assert.throws(()=>assertAccountCommand(actor,'booking.assign',{id:b.id},f.s),/无权|限定承接/);
  const other={...b,id:'OTHER',storeId:'silver'},future={...b,id:'FUTURE',createdAt:f.s.now+1},invented={...b,id:'BACKDATED'};f.s.bookings.push(other,future,invented);
  for(const row of [other,future,invented]){assert.throws(()=>assertAccountCommand(actor,'booking.payment-query',{id:row.id},f.s),/限定承接/);assert.equal(canAccountReadSource(f.s,actor,'booking',row),false);}assert.equal(canAccountReadSource(f.s,actor,'booking',b),true);
  const a=f.account(members[2].id);f.run(f.admin,'account.revoke',{id:a.id,version:a.version,grantId:actor.grantId});assert.equal(canAccountReadSource(f.s,actor,'booking',b),false);assert.throws(()=>f.resolve(actor),/失效/);
});

test('实际新授权不能授予关停门店，原工作grant有效期在enter与resolve一致',()=>{
  const f=fixture(),m=f.create('support'),a=f.account(m.id);f.run(f.admin,'account.revoke',{id:a.id,version:a.version,grantId:m.grantId});const granted=f.grant(m,'support',undefined,{validFrom:f.s.now+MIN,validTo:f.s.now+2*MIN}),g=granted.grants.at(-1);
  assert.throws(()=>f.enter(m.id,g.id),/有效期/);f.s.now+=MIN;const actor=f.enter(m.id,g.id);f.s.now+=MIN;assert.throws(()=>f.resolve(actor),/失效/);f.start();assert.throws(()=>f.grant(m,'store-finance','xingfu'),/关停/);
});

test('已保留承接的原案来源或scope变化使新旧会话及原事项写入立即失效',()=>{
  for(const mutate of [f=>{f.c.reference='changed-case-reference';},f=>{f.account(f.target.id).grants.find(g=>g.id===f.target.grantId).originalBookingIds.push('invented');},f=>{delete f.c.authorityExitReceipt;}]){
    const f=fixture(),members=f.members(),b=f.oldBooking();f.start();f.handover(members);f.apply();f.closeDomain();f.target=members[2];const actor=f.enter(f.target.id,f.target.grantId);mutate(f);assert.throws(()=>f.resolve(actor),/承接来源失效/);assert.throws(()=>assertAccountCommand(actor,'booking.payment-query',{id:b.id},f.s),/承接来源失效/);assert.equal(canAccountReadSource(f.s,actor,'booking',b),false);assert.throws(()=>f.enter(f.target.id,f.target.grantId),/承接来源失效/);
  }
});

test('只有未来或已到期备用管理员时，真实命令不得结束最后当前管理员',()=>{
  for(const interval of ['future','expired']){const f=fixture(),m=f.create('account-admin'),a=f.account(m.id);f.run(f.admin,'account.revoke',{id:a.id,version:a.version,grantId:m.grantId});f.grant(m,'account-admin',undefined,interval==='future'?{validFrom:f.s.now+MIN}:{validTo:f.s.now+MIN});if(interval==='expired')f.s.now+=MIN;const admin=f.account(f.admin.accountId),before=structuredClone(f.s);assert.throws(()=>f.run(f.admin,'account.status',{id:admin.id,version:admin.version,enabled:false}),/至少保留/);assert.throws(()=>f.run(f.admin,'account.revoke',{id:admin.id,version:admin.version,grantId:f.admin.grantId}),/至少保留/);assert.deepEqual(f.s,before);}
});

test('实际booking/invoice/提成域列表在汇总前只读本案原rows，后置原客户申请可见',()=>{
  const f=fixture(),members=f.members(),b=f.oldBooking();b.duration=45;b.priceCents=19800;b.serviceId='neck';
  const entry={id:'OLD-TI',bookingId:b.id,storeId:'xingfu',techId:'lin',month:'2026-10',amountCents:100,paidCents:25,recoveredCents:0,payableCents:75,status:'payable'};f.s.techIncomeEntries.push(entry);f.s.techIncomeAdjustments.push({id:'OLD-ADJ',bookingId:b.id,storeId:'xingfu',techId:'lin'});f.s.techIncomeDifferences.push({id:'OLD-DIFF',bookingId:b.id,storeId:'xingfu',techId:'lin',status:'open',remainingCents:2});f.s.techIncomePayouts.push({id:'OLD-PAYOUT',storeId:'xingfu',techId:'lin',month:'2026-10',lines:[{entryId:entry.id,bookingId:b.id,amountCents:25}]});
  f.start();f.handover(members);f.apply();f.closeDomain();const actor=f.enter(members[2].id,members[2].grantId),inv=f.run(user,'invoice.apply',{bookingId:b.id,kind:'personal',title:'原票范围可见',email:'old@example.test'});
  const future={...b,id:'FUTURE-VIEW',createdAt:f.s.now+1};f.s.bookings.push(future);f.s.serviceInvoices.push({...inv,id:'FUTURE-INV',bookingId:future.id,title:'后置来源不可见',amount:999999});for(const name of ['techIncomeEntries','techIncomeAdjustments','techIncomeDifferences'])f.s[name].push({...f.s[name][0],id:'FUTURE-'+name,bookingId:future.id,amountCents:999999,remainingCents:999999});f.s.techIncomePayouts.push({...f.s.techIncomePayouts[0],id:'FUTURE-PAYOUT',lines:[{entryId:'FUTURE-techIncomeEntries',bookingId:future.id,amountCents:999999}]});
  const before=structuredClone(f.s),bookings=bookingView(f.s,actor),income=techIncomeView(f.s,actor);assert.deepEqual(bookings.map(x=>x.id),[b.id]);for(const name of ['entries','adjustments','differences','payouts'])assert.equal(income[name].length,1);assert.equal(income.summary.accruedCents,100);assert.equal(income.summary.paidCents,25);assert.equal(income.summary.differenceCents,2);
  assert.equal(canReadInvoice(actor,inv,f.s),true);assert.equal(canReadInvoice(actor,inv),false,'限定授权未传实际s不可绕过范围');assert.equal(canReadInvoice(actor,f.s.serviceInvoices.at(-1),f.s),false);
  const html=invoiceView(f.s,['invoices'],actor,ui);assert.match(html,/原票范围可见/);assert.doesNotMatch(html,/后置来源不可见|999999/);assert.equal(invoiceBookingPanel(f.s,future,actor,ui),'');assert.deepEqual(f.s,before);
});

test('异步旧会话与伪rawactor在实际域读取/深链中拒绝，原技师历史读取保留兼容',async()=>{
  const f=fixture(),members=f.members(),b=f.oldBooking();b.duration=45;f.start();f.handover(members);f.apply();f.closeDomain();const actor=f.enter(members[2].id,members[2].grantId),inv=f.run(user,'invoice.apply',{bookingId:b.id,kind:'personal',title:'敏感原票标题',email:'old@example.test'});
  assert.equal(canReadInvoice({role:'store',storeId:'xingfu'},inv,f.s),false);assert.equal(canReadInvoice({...actor,role:'group',job:'all',storeId:'silver'},inv,f.s),true,'实际会话只恢复原store-finance范围');assert.equal(canReadInvoice({...actor,sessionId:'invented'},inv,f.s),false);assert.equal(canAccountReadSource(f.s,{role:'store',storeId:'silver',lifecyclePurpose:'lifecycle-settlement',originalBookingIds:[b.id]},'booking',b),false);
  const a=f.account(actor.accountId),readLater=Promise.resolve().then(()=>({invoice:canReadInvoice(actor,inv,f.s),html:invoiceView(f.s,['invoices',inv.id],actor,ui)}));f.run(f.admin,'account.revoke',{id:a.id,version:a.version,grantId:actor.grantId});const later=await readLater;assert.equal(later.invoice,false);assert.doesNotMatch(later.html,/敏感原票标题/);assert.throws(()=>bookingView(f.s,actor),/失效/);assert.throws(()=>techIncomeView(f.s,actor),/失效/);assert.equal(invoiceBookingPanel(f.s,b,actor,ui),'');
  f.s.techs[0].lifecycleStatus='left';f.s.techIncomeEntries.push({id:'HISTORIC',techId:'lin',storeId:'xingfu',status:'paid',amountCents:20,paidCents:20,recoveredCents:0,payableCents:0});assert.equal(techIncomeView(f.s,{role:'tech',techId:'lin'}).entries.at(-1).id,'HISTORIC','普通本人桥内部原tech读取保持原兼容，本test不代表未授权客户端入口');
});

test('调店结束明确本人原店grant，保留新店原grant且旧会话均结束',()=>{
  const f=fixture(),members=f.members(),worker=f.create('store-manager','xingfu','lin'),account=f.grant(worker,'store-finance','silver'),newGrant=account.grants.at(-1),newActor=f.enter(worker.id,newGrant.id);
  const c={id:'TRANSFER-DOMAIN',kind:'transfer',techId:'lin',fromStoreId:'xingfu',toStoreId:'silver',effectiveAt:f.s.now,createdAt:f.s.now,reference:'REAL-TRANSFER',stage:'effective',status:'effective',version:2};f.s.organizationLifecycleCases.push(c);c.responsibilityBasis=captureLifecycleResponsibilities(f.s,c,{goodsSummary});f.s.techs[0].storeId='silver';f.handover(members);const r=f.apply();
  assert.deepEqual(r.endedGrantIds,[worker.grantId]);assert.equal(f.account(worker.id).grants.find(x=>x.id===newGrant.id).enabled,true);assert.throws(()=>f.resolve(worker.actor),/失效/);assert.throws(()=>f.resolve(newActor),/失效/);assert.equal(f.enter(worker.id,newGrant.id).storeId,'silver');
});

test('跨多个原责任店的同集团原grant可以分别承接，未来迁入店来源不扩本案',()=>{
  const f=fixture(),members=f.members(),old=f.oldBooking();old.storeId='silver';const sf=f.create('store-finance','silver');members.push(sf);
  const c={id:'TRANSFER-MULTI',kind:'transfer',techId:'lin',fromStoreId:'xingfu',toStoreId:'yuan',effectiveAt:f.s.now,createdAt:f.s.now,reference:'REAL-MULTI',stage:'effective',status:'effective',version:2};f.s.organizationLifecycleCases.push(c);c.responsibilityBasis=captureLifecycleResponsibilities(f.s,c,{goodsSummary});f.s.techs[0].storeId='yuan';
  for(const m of members)for(const storeId of m.storeId?[m.storeId]:['xingfu','silver'])f.accept(m,f.register(m,storeId));assert.equal(f.preflight().ready,true);const base=f.preflight().retainedRights;
  f.s.bookings.push({...old,id:'FUTURE-NEW',storeId:'yuan',createdAt:f.s.now+1});f.s.techIncomeEntries.push({id:'FUTURE-INCOME',techId:'lin',storeId:'yuan',bookingId:'FUTURE-NEW',status:'pending',amountCents:0,paidCents:0,recoveredCents:0,payableCents:0});
  assert.deepEqual(f.preflight().retainedRights,base);assert.ok(!lifecycleCaseImpact(f.s,c.id,{goodsSummary}).bookings.some(x=>x.sourceId==='FUTURE-NEW'));
});

test('完成adapter重复实际执行不重复撤权或记账，原不可变案来源变化拒绝',()=>{
  const f=fixture(),members=f.members();f.start();f.handover(members);const receipt=f.apply(),once=structuredClone(f.s);assert.deepEqual(f.apply(),receipt);assert.deepEqual(f.s,once);f.c.reference='changed-case-source';const changed=structuredClone(f.s);assert.throws(()=>f.apply(),/来源已变化/);assert.deepEqual(f.s,changed);
});

test('离职仅开始不结束本人工作，缺实际历史身份或假ready出口均阻断',()=>{
  const f=fixture(),members=f.members(),worker=f.create('store-manager','xingfu','lin');f.start('departure');f.handover(members);assert.equal(f.resolve(worker.actor).storeId,'xingfu');assert.equal(f.s.techs[0].lifecycleStatus,'departure');const before=structuredClone(f.s);assert.ok(f.preflight().blockers.some(x=>x.kind==='historical-identity'));assert.throws(()=>f.apply({historicalRightsAdapters:{ready:true}}),/历史权利/);assert.deepEqual(f.s,before);
  f.run(f.admin,'lifecycle.identity-link',{techId:'lin',userId:'u1',version:f.s.techs[0].version,reference:'REAL-IDENTITY-LINK',occurredAt:f.s.now});assert.ok(f.preflight({historicalRightsAdapters:{ready:true}}).blockers.some(x=>x.kind==='historical-adapter'));
});

test('历史preflight拒漏原源/他人源/只读写入并保留原内部附件拒绝权限',()=>{
  const f=fixture(),members=f.members();f.run(f.admin,'lifecycle.identity-link',{techId:'lin',userId:'u1',version:f.s.techs[0].version,reference:'REAL-IDENTITY-LINK',occurredAt:f.s.now});f.start('departure');f.handover(members);
  const ref='invoice-file:'+'a'.repeat(64);f.s.servicePromoters.push({id:'OLD-PROMOTER',personKind:'tech',personId:'lin',ownerStoreId:'xingfu',status:'disabled',identity:{evidenceRefs:[{ref,name:'内部审核.png',type:'image/png',size:8}]}});
  const adapters={incomeView:()=>({entries:[],differences:[],adjustments:[],payouts:[]}),promotionView:()=>({promoters:[{id:'OLD-PROMOTER'}],commissions:[],withdrawals:[],recoveries:[]}),assertCommand:(s,a,type,p)=>({allowed:true,techId:p.techId,userId:a.userId,personKey:'tech:'+p.techId}),authorizeFile:(s,a,reference,p)=>({allowed:false,reference,techId:p.techId,userId:a.userId,personKey:'tech:'+p.techId})};
  const before=structuredClone(f.s);assert.equal(f.preflight({historicalRightsAdapters:adapters}).ready,true,'模块隔离适配器正例只验证合同，真实历史桥由Root集成');assert.deepEqual(f.s,before);
  for(const overrides of [{promotionView:()=>({promoters:[],commissions:[],withdrawals:[],recoveries:[]})},{incomeView:()=>({entries:[{id:'OTHER'}],differences:[],adjustments:[],payouts:[]})},{authorizeFile:(s,a,reference,p)=>({allowed:true,reference,techId:p.techId,userId:a.userId,personKey:'tech:'+p.techId})},{incomeView:s=>{s.seq++;return {entries:[],differences:[],adjustments:[],payouts:[]};}}])assert.ok(f.preflight({historicalRightsAdapters:{...adapters,...overrides}}).blockers.some(x=>x.kind==='historical-exit'));
});
