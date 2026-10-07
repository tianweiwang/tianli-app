import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {upgradeAccounts,resolveAccountActor,assertAccountCommand,canAccountView,actorAccountFields,accountCommand,STAFF_JOBS} from './staff-accounts.mjs';
import {assertJob} from './management.mjs';
const DEMO={role:'user',userId:'u1',storeId:'s1',techId:'t1'},NOW=Date.parse('2026-10-03T15:00:00+08:00');
function fixture(){
  let s=upgradeAccounts({schema:5,seq:0,now:NOW,stores:[{id:'s1',name:'幸福里'},{id:'s2',name:'银杏'}],bookings:[{id:'B1',status:'done'}],goods:[{id:'G1',paidCents:19800}],logs:[]}),request=0;
  const run=(a,type,p={})=>{const next=structuredClone(s),result=accountCommand(next,a,type,{requestId:'account-test-'+(++request),...p},{id:prefix=>prefix+(++next.seq),log:()=>{}});s=next;return result;};
  const enter=(accountId='DEMO-ADMIN',grantId='DEMO-ADMIN-GRANT')=>{const result=run(DEMO,'account.enter',{accountId,grantId});return resolveAccountActor(s,result);};
  const first=enter();
  return {get s(){return s;},admin:first,run,enter,resolve:a=>resolveAccountActor(s,a),create(name='陈员工',a=first){return run(a,'account.create',{name,reason:'试点工作账号建档'});},grant(id,job,storeId,a=first){return run(a,'account.grant',{id,version:s.staffAccounts.find(x=>x.id===id).version,job,storeId,reason:'按当前岗位与门店职责授权'});},status(id,enabled,a=first){return run(a,'account.status',{id,version:s.staffAccounts.find(x=>x.id===id).version,enabled,reason:'实际人员权限调整'});},revoke(id,grantId,a=first){return run(a,'account.revoke',{id,version:s.staffAccounts.find(x=>x.id===id).version,grantId,reason:'结束本岗位授权'});},staff(job='store-manager',storeId='s1',name){const x=this.create(name);const y=this.grant(x.id,job,STAFF_JOBS[job].role==='store'?storeId:undefined);return enter(x.id,y.grants.at(-1).id);}};
}
test('账号迁移仅增量建立独立容器，bootstrap只有账号管理员',()=>{
  const s={schema:5,now:NOW,bookings:[{id:'B',priceCents:19800}],staffSessions:[]},old=structuredClone(s.bookings);upgradeAccounts(s);const once=structuredClone(s);upgradeAccounts(s);assert.deepEqual(s,once);assert.deepEqual(s.bookings,old);assert.equal(s.staffAccounts.length,1);assert.deepEqual(s.staffAccounts[0].grants.map(x=>x.job),['account-admin']);assert.ok(!('password' in s.staffAccounts[0]));
  const empty={now:NOW,staffAccounts:[]};upgradeAccounts(empty);assert.deepEqual(empty.staffAccounts,[],'不自动重新生成被迁移保留的空名单');
});
test('自由演示身份兼容，工作会话只从有效授权生成上下文',()=>{
  const f=fixture(),legacy={role:'group',job:'all'};assert.equal(resolveAccountActor(f.s,legacy),legacy);
  const a=f.staff('store-manager','s1');const resolved=f.resolve({...a,role:'group',job:'all',storeId:'s2',userId:'u2',accountName:'冒充名字'});assert.equal(resolved.role,'store');assert.equal(resolved.job,'store-manager');assert.equal(resolved.storeId,'s1');assert.notEqual(resolved.accountName,'冒充名字');assert.ok(!('userId' in resolved));
  assert.throws(()=>f.resolve({accountId:a.accountId,role:'group',job:'all'}),/会话缺失/);assert.throws(()=>f.resolve({sessionId:'missing'}),/已失效/);
});
test('开通账号不自动授权，没有有效岗位不能进入',()=>{
  const f=fixture(),x=f.create();assert.equal(x.enabled,true);assert.deepEqual(x.grants,[]);assert.equal(x.version,1);assert.throws(()=>f.enter(x.id,'invented'),/未启用/);assert.equal(f.s.staffAccountLog.filter(x=>x.action==='account.create').length,1);assert.equal(x.history[0].by.accountId,f.admin.accountId);
});
test('自由演示集团管理员和其他工作岗位均不能维护工作账号',()=>{
  const f=fixture();for(const actor of [DEMO,{role:'group',job:'all'},f.staff('finance'),f.staff('support'),f.staff('store-manager')])assert.throws(()=>f.run(actor,'account.create',{name:'X',reason:'Y'}),/账号管理员/);assert.equal(canAccountView(f.admin,'accounts'),true);assert.equal(canAccountView(f.admin,'service-finance'),false);assert.throws(()=>assertAccountCommand(f.admin,'finance.rule-publish'),/无权/);
});
test('授权覆盖集团及单店，不能提交不存在门店或全能岗位',()=>{
  const f=fixture(),x=f.create();for(const [job,storeId] of [['all'],['store-manager','other'],['operations','s1']])assert.throws(()=>f.grant(x.id,job,storeId),/岗位|门店|范围/);
  const y=f.grant(x.id,'store-manager','s1');assert.throws(()=>f.grant(x.id,'store-manager','s1'),/已有相同/);assert.equal(y.grants[0].role,'store');assert.equal(y.grants[0].storeId,'s1');const z=f.grant(x.id,'store-finance','s2');assert.equal(z.grants.length,2);assert.equal(f.enter(x.id,z.grants[1].id).storeId,'s2');
});
test('同一账号多个岗位分别进入，工作会话不能直接切换账号岗位',()=>{
  const f=fixture(),x=f.create();f.grant(x.id,'store-manager','s1');const y=f.grant(x.id,'store-finance','s1'),a=f.enter(x.id,y.grants[0].id);assert.throws(()=>f.run(a,'account.enter',{accountId:x.id,grantId:y.grants[1].id}),/先退出/);f.run(a,'account.leave');assert.throws(()=>f.resolve(a),/失效/);assert.equal(f.enter(x.id,y.grants[1].id).job,'store-finance');
});
test('授权变更撤销该账号全部旧会话，其他账号会话保留',()=>{
  const f=fixture(),a=f.staff('store-manager'),second=f.enter(a.accountId,a.grantId),other=f.staff('finance');f.grant(a.accountId,'store-finance','s2');assert.throws(()=>f.resolve(a),/失效/);assert.throws(()=>f.resolve(second),/失效/);assert.equal(f.resolve(other).accountId,other.accountId);assert.ok(f.s.staffSessions.filter(x=>x.accountId===a.accountId).every(x=>x.revokedAt===NOW));
});
test('停用后不能进入与重放，恢复不复活旧会话',()=>{
  const f=fixture(),a=f.staff('support');f.status(a.accountId,false);assert.throws(()=>f.resolve(a),/失效/);assert.throws(()=>f.enter(a.accountId,a.grantId),/未启用/);f.status(a.accountId,true);assert.throws(()=>f.resolve(a),/失效/);assert.equal(f.enter(a.accountId,a.grantId).job,'support');
});
test('撤授权保留历史记录，可重新授予但旧会话不复活',()=>{
  const f=fixture(),a=f.staff('store-manager');f.revoke(a.accountId,a.grantId);const x=f.s.staffAccounts.find(x=>x.id===a.accountId);assert.equal(x.grants[0].enabled,false);assert.equal(x.grants[0].revokedBy.accountId,f.admin.accountId);assert.throws(()=>f.enter(a.accountId,a.grantId),/未启用/);const y=f.grant(a.accountId,'store-manager','s1');assert.equal(y.grants.length,2);assert.notEqual(y.grants[1].id,a.grantId);assert.throws(()=>f.resolve(a),/失效/);
});
test('最后一个有效管理员不能停用或撤权，另有有效管理员时可交接',()=>{
  const f=fixture();assert.throws(()=>f.status('DEMO-ADMIN',false),/至少保留/);assert.throws(()=>f.revoke('DEMO-ADMIN','DEMO-ADMIN-GRANT'),/至少保留/);const x=f.create('第二管理员'),y=f.grant(x.id,'account-admin'),second=f.enter(x.id,y.grants[0].id);f.status('DEMO-ADMIN',false,second);assert.throws(()=>f.resolve(f.admin),/失效/);assert.equal(f.resolve(second).accountId,x.id);assert.throws(()=>f.status(x.id,false,second),/至少保留/);
});
test('停用账号的管理员授权不算有效保障',()=>{
  const f=fixture(),x=f.create('备用管理员');f.grant(x.id,'account-admin');f.status(x.id,false);assert.throws(()=>f.status('DEMO-ADMIN',false),/至少保留/);
});
test('版本与原因必填，旧版本不能覆盖最新授权',()=>{
  const f=fixture(),x=f.create();f.grant(x.id,'support');assert.throws(()=>f.run(f.admin,'account.status',{id:x.id,version:x.version,enabled:false,reason:'old'}),/已更新/);assert.throws(()=>f.run(f.admin,'account.status',{id:x.id,enabled:false,reason:'missing'}),/版本/);assert.throws(()=>f.run(f.admin,'account.create',{name:'new',reason:''}),/原因/);assert.equal(f.s.staffAccounts.find(y=>y.id===x.id).enabled,true);
});
test('管理提交幂等且内容变更拒绝，入场重复不新增会话',()=>{
  const f=fixture(),p={requestId:'create-one',name:'陈员工',reason:'建立'};const x=f.run(f.admin,'account.create',p);assert.deepEqual(f.run(f.admin,'account.create',p),x);assert.equal(f.s.staffAccounts.filter(y=>y.id===x.id).length,1);assert.throws(()=>f.run(f.admin,'account.create',{...p,name:'其他'}),/同一提交/);
  const entry={accountId:'DEMO-ADMIN',grantId:'DEMO-ADMIN-GRANT',requestId:'enter-once'},r=f.run(DEMO,'account.enter',entry);assert.deepEqual(f.run(DEMO,'account.enter',entry),r);f.run(f.resolve(r),'account.leave');assert.throws(()=>f.run(DEMO,'account.enter',entry),/失效/);
});
test('不同管理员相同请求编号相互独立，作者用稳定账号字段',()=>{
  const f=fixture(),x=f.create('第二管理员'),y=f.grant(x.id,'account-admin'),b=f.enter(x.id,y.grants[0].id);const p={requestId:'same-id',name:'新成员',reason:'增加成员'};const one=f.run(f.admin,'account.create',p),two=f.run(b,'account.create',p);assert.notEqual(one.id,two.id);assert.notEqual(one.history[0].by.accountId,two.history[0].by.accountId);assert.deepEqual(actorAccountFields(DEMO),{});const fields=actorAccountFields(b);assert.equal(fields.accountId,b.accountId);assert.equal(fields.grantId,b.grantId);assert.ok(!('sessionId' in fields));
});
test('可选期限到期及版本失配均拒绝，正常入场不新增演示期限业务值',()=>{
  const f=fixture(),a=f.staff('support'),session=f.s.staffSessions.find(x=>x.id===a.sessionId);assert.ok(!('expiresAt' in session));session.expiresAt=NOW;assert.throws(()=>f.resolve(a),/失效/);delete session.expiresAt;session.accountVersion--;assert.throws(()=>f.resolve(a),/已变更/);
});
test('被删门店与伪造授权角色不能形成有效会话',()=>{
  const f=fixture(),a=f.staff('store-manager');f.s.stores=f.s.stores.filter(x=>x.id!=='s1');assert.throws(()=>f.resolve(a),/门店不存在/);const grant=f.s.staffAccounts.find(x=>x.id===a.accountId).grants[0];grant.role='group';assert.throws(()=>f.resolve(a),/变更/);
});
test('主管与财务动作分开，不能靠增加页面或命令名称默认放行',()=>{
  const f=fixture(),manager=f.staff('store-manager'),finance=f.staff('store-finance');
  for(const command of ['booking.assign','booking.busy-create','booking.busy-extend','booking.busy-end','care.task-claim','handoff.note'])assert.doesNotThrow(()=>assertAccountCommand(manager,command));
  for(const command of ['booking.refund-pay','invoice.issue','tech-income.payout','bill.confirm'])assert.throws(()=>assertAccountCommand(manager,command),/无权/);
  for(const command of ['booking.refund-pay','booking.refund-query','invoice.issue','invoice.reject','invoice.red','invoice.replace-file','tech-income.payout','tech-income.difference-record','bill.confirm','bill.dispute'])assert.doesNotThrow(()=>assertAccountCommand(finance,command));
  for(const command of ['booking.assign','care.case-create','handoff.note','manage.tech-save','finance.rule-publish','clock.advance','invented.admin'])assert.throws(()=>assertAccountCommand(finance,command),/无权/);
  assert.equal(canAccountView(manager,'bills'),false);assert.equal(canAccountView(finance,'handoffs'),false);assert.equal(canAccountView(finance,'invoices'),true);assert.equal(canAccountView(finance,'invented'),false);
});
test('集团客服只决策不执行资金，运营仓储财务与管理员互相隔离',()=>{
  const f=fixture(),support=f.staff('support'),finance=f.staff('finance'),ops=f.staff('operations'),warehouse=f.staff('warehouse');
  for(const command of ['privacy.close','privacy.followup','sensitive.reveal','booking.refund-review','goods.case-review','review.appeal-final'])assert.doesNotThrow(()=>assertAccountCommand(support,command));
  for(const command of ['goods.refund','booking.refund-pay','finance.split-start','account.grant'])assert.throws(()=>assertAccountCommand(support,command),/无权/);
  for(const command of ['finance.rule-publish','finance.split-start','finance.split-query','finance.finish-start','finance.finish-query','finance.return-start','finance.return-query','finance.recovery-receive','goods.refund-query','tech-income.rule-publish'])assert.doesNotThrow(()=>assertAccountCommand(finance,command));
  assert.doesNotThrow(()=>assertAccountCommand(ops,'manage.product-save'));assert.throws(()=>assertAccountCommand(ops,'manage.inventory'),/无权/);assert.doesNotThrow(()=>assertAccountCommand(warehouse,'manage.inventory'));assert.throws(()=>assertAccountCommand(warehouse,'manage.product-save'),/无权/);
  assert.equal(canAccountView(ops,'bookings'),false);assert.equal(canAccountView(warehouse,'service-finance'),false);assert.equal(canAccountView(support,'accounts'),false);assert.equal(canAccountView(finance,'privacy'),false);
});
test('每次账号管理保留原因、员工和时间，业务订单金额不变化',()=>{
  const f=fixture(),old=structuredClone({bookings:f.s.bookings,goods:f.s.goods}),a=f.staff('store-manager');f.status(a.accountId,false);f.status(a.accountId,true);const logs=f.s.staffAccounts.find(x=>x.id===a.accountId).history;assert.deepEqual(logs.map(x=>x.action),['account.create','account.grant','account.status','account.status']);assert.ok(logs.every(x=>x.by.accountId==='DEMO-ADMIN' && x.at===NOW && x.reason));assert.deepEqual({bookings:f.s.bookings,goods:f.s.goods},old);
});
test('岗位关键允许动作对应真实领域命令，且通过原有业务岗位守卫',()=>{
  const f=fixture();
  const cases=[
    ['operations','management.mjs',['manage.product-save','manage.sku-save','manage.product-status','manage.category-save','manage.service-save','manage.store-save','manage.store-status','manage.tech-import','manage.tech-save','manage.tech-review','manage.rules-save']],
    ['operations','tech-qualification.mjs',['qualification.assess','qualification.request','qualification.review','qualification.pause','qualification.resume']],
    ['warehouse','engine.mjs',['goods.ship','goods.inspect','goods.return-back']],
    ['warehouse','management.mjs',['manage.inventory']],
    ['finance','engine.mjs',['goods.refund','goods.refund-query','bill.create','bill.resolve','bill.pay','bill.query','recovery.receive']],
    ['finance','service-finance.mjs',['finance.rule-publish','finance.split-start','finance.split-query','finance.finish-start','finance.finish-query','finance.return-start','finance.return-query','finance.recovery-receive']],
    ['finance','tech-income.mjs',['tech-income.rule-publish']],
    ['support','booking.mjs',['booking.assign','booking.payment-query','booking.extension-query','booking.refund-review','booking.special-aftersale']],
    ['support','busy.mjs',['booking.busy-create','booking.busy-extend','booking.busy-end']],
    ['support','service-care.mjs',['care.case-create','care.case-respond','care.case-statement','care.case-note','care.case-link','care.case-close','care.followup-create','care.followup-record','care.followup-link','care.followup-close','care.task-assign','care.task-claim']],
    ['store-finance','service-invoices.mjs',['invoice.issue','invoice.reject','invoice.red','invoice.replace-file']],
    ['store-finance','tech-income.mjs',['tech-income.payout','tech-income.difference-record']]
  ];
  const actors={};for(const [job,file,commands] of cases){const actor=actors[job] ||= f.staff(job),source=readFileSync(new URL(file,import.meta.url),'utf8');for(const command of commands){assert.ok(source.includes(`'${command}'`) || source.includes(`"${command}"`),`${command} 须在 ${file} 中存在真实处理契约`);assert.doesNotThrow(()=>assertAccountCommand(actor,command),`${job} 的 ${command} 应可执行`);assert.doesNotThrow(()=>assertJob(actor,command),`${job} 的 ${command} 不应被旧岗位守卫拒绝`);}}
  for(const command of ['booking.payment-query','booking.extension-query'])assert.throws(()=>assertAccountCommand(actors.finance,command),/无权/,'集团支付状态查询沿用原客服职责');
});
