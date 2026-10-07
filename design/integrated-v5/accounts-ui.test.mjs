import test from 'node:test';
import assert from 'node:assert/strict';
import {accountUiView,accountEntryLink,accountExitTarget,accountExitActions,accountSessionErrorView} from './accounts-ui.mjs';
import {upgradeAccounts,accountCommand,resolveAccountActor,STAFF_JOBS} from './staff-accounts.mjs';
import {seed,reduce} from './engine.mjs';
import {organizationLifecyclePanel} from './organization-lifecycle-ui.mjs';
import {lifecycleHandoverCommands} from './organization-lifecycle-authority.mjs';
const NOW=Date.parse('2026-10-03T15:00:00+08:00'),DEMO={role:'user',userId:'u1'},GROUP={role:'group',job:'all'},STORE={role:'store',storeId:'s1'};
const decode=v=>v.replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
const forms=(html,command)=>[...html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/g)].map(([,attrs,body])=>({attrs,body,command:/data-command="([^"]+)"/.exec(attrs)?.[1],payload:JSON.parse(decode(/data-payload="([^"]+)"/.exec(attrs)?.[1] || '{}')),key:decode(/data-management-form="([^"]+)"/.exec(attrs)?.[1] || '')})).filter(x=>!command||x.command===command);
const exitButtons=html=>[...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].filter(([,attrs])=>/data-command="ui\.account-exit"/.test(attrs)).map(([,attrs,label])=>({attrs,label:decode(label),payload:JSON.parse(decode(/data-payload="([^"]+)"/.exec(attrs)?.[1] || '{}'))}));
function fixture(){
  let s=upgradeAccounts({schema:5,now:NOW,seq:0,stores:[{id:'s1',name:'幸福里门店'},{id:'s2',name:'银杏门店'}]}),seq=0;
  const run=(actor,type,p)=>{const next=structuredClone(s),result=accountCommand(next,actor,type,{requestId:'ui-'+(++seq),...p},{id:prefix=>prefix+(++next.seq),log:()=>{}});s=next;return result;};
  const enter=(id='DEMO-ADMIN',grantId='DEMO-ADMIN-GRANT')=>{const grant=s.staffAccounts.find(a=>a.id===id)?.grants.find(g=>g.id===grantId),entryActor=grant?.role==='store'?{role:'store',storeId:grant.storeId}:GROUP;const r=run(entryActor,'account.enter',{accountId:id,grantId});return resolveAccountActor(s,r);};
  const admin=enter();
  const page=(actor=admin,route=['accounts'])=>accountUiView(s,actor,route);
  const send=(form,fields={},actor=admin)=>{assert.ok(form,'需要实际页面表单');return run(actor,form.command,{...form.payload,...fields});};
  return {get s(){return s;},admin,run,enter,page,send,create(name='陈员工'){return send(forms(page(),'account.create')[0],{name,reason:'增加实际试点人员'});},grant(id,job,storeId){return send(forms(page(admin,['accounts',id]),'account.grant').find(x=>x.key.endsWith(STAFF_JOBS[job].role==='group'?'grant-group':'grant-store')),{job,...(storeId?{storeId}:{}),reason:'分配岗位职责和数据范围'});},staff(job='store-manager',store='s1'){const x=this.create();const y=this.grant(x.id,job,STAFF_JOBS[job].role==='store'?store:undefined);return enter(x.id,y.grants.at(-1).id);}};
}
test('集团后台岗位入口显示有效集团授权，未伪装真实登录',()=>{
  const f=fixture(),html=f.page(GROUP,['work-login']);assert.match(html,/集团后台岗位演示/);assert.match(html,/不校验真实员工身份/);assert.match(html,/以账号管理员进入/);assert.doesNotMatch(html,/type="password"|type="tel"|发送验证码|name="password"/);const enter=forms(html,'account.enter')[0];assert.deepEqual(enter.payload,{accountId:'DEMO-ADMIN',grantId:'DEMO-ADMIN-GRANT'});assert.match(enter.attrs,/data-next="\/group\/dashboard"/);assert.equal(forms(html,'account.create').length,0);assert.match(html,/#\/group\/dashboard/);
});

test('错误页只有唯一确实关闭的自由演示门店提供换店，缺失冲突来源不提供且读取纯净',()=>{
  const f=fixture(),source=f.s.stores.find(x=>x.id==='s1');source.lifecycleStatus='closed';
  const before=structuredClone(f.s),actor={...STORE};
  assert.match(accountSessionErrorView(f.s,actor,'原关闭原因'),/data-identity="storeId"/);
  for(const s of [
    {...f.s,stores:f.s.stores.filter(x=>x.id!=='s1')},
    {...f.s,stores:[...f.s.stores,structuredClone(source)]},
    {...f.s,stores:[{id:'',lifecycleStatus:'closed'},f.s.stores[1]]}
  ])assert.doesNotMatch(accountSessionErrorView(s,{...actor,storeId:s.stores[0]?.id===''?'':'s1'},'来源无法核验'),/data-identity/);
  assert.deepEqual(f.s,before);assert.deepEqual(actor,STORE);
});
test('没有授权账号不进入后台岗位列表，已停用的同端账号提示且不能进入',()=>{
  const f=fixture(),x=f.create('未授权员工');let html=f.page(GROUP,['work-login']);assert.doesNotMatch(html,/未授权员工/);assert.ok(!forms(html,'account.enter').some(form=>form.payload.accountId===x.id));assert.match(f.page(),/未授权员工/);const y=f.grant(x.id,'support');f.run(f.admin,'account.status',{id:x.id,version:y.version,enabled:false,reason:'停用测试'});html=f.page(GROUP,['work-login']);assert.match(html,/账号已停用，不能进入/);assert.ok(!forms(html,'account.enter').some(form=>form.payload.accountId===x.id));
});
test('实际页面表单串通建档、授权、进入、退出，工作范围与角色一致',()=>{
  const f=fixture(),create=forms(f.page(),'account.create')[0];assert.match(create.body,/name="name"[^>]*required/);assert.match(create.body,/name="reason"[^>]*required/);const x=f.send(create,{name:'门店财务王女士',reason:'试点财务办理'}),y=f.grant(x.id,'store-finance','s2'),store={role:'store',storeId:'s2'};const entry=forms(f.page(store,['work-login']),'account.enter').find(form=>form.payload.accountId===x.id);assert.match(entry.attrs,/data-next="\/store\/dashboard"/);const result=f.send(entry,{},store),a=resolveAccountActor(f.s,result);assert.equal(a.storeId,'s2');const html=f.page(a,['work-login']);assert.match(html,/门店财务王女士/);assert.match(html,/银杏门店/);assert.match(html,/data-command="ui.account-exit"/);assert.equal(forms(html,'account.enter').length,0);assert.equal(y.grants[0].job,'store-finance');
});
test('管理员有账号管理入口，不带资金或业务全权',()=>{
  const f=fixture(),html=f.page(f.admin,['dashboard']);assert.match(html,/<h1>集团工作台<\/h1>/);assert.match(html,/当前岗位：账号管理员/);assert.match(html,/#\/group\/accounts/);assert.match(html,/>账号与权限<\/a>/);assert.doesNotMatch(html,/#\/group\/(service-finance|bookings|catalog|goods|invoices)/);assert.match(html,/一个会话只使用当前岗位授权/);assert.match(html,/返回集团后台/);assert.match(html,/切换岗位/);
});
test('各岗位安全工作台只列授权入口，不渲染旧聚合业务',()=>{
  const f=fixture(),finance=f.staff('store-finance'),manager=f.staff('store-manager'),support=f.staff('support');
  const financePage=f.page(finance,['dashboard']);assert.match(financePage,/<h1>门店工作台<\/h1>/);assert.match(financePage,/当前岗位：门店财务/);assert.match(financePage,/#\/store\/invoices/);assert.doesNotMatch(financePage,/#\/store\/(handoffs|care|qualifications|schedule)/);assert.doesNotMatch(financePage,/今日实收|近期客户|值班负责人/);
  const managerPage=f.page(manager,['dashboard']);assert.match(managerPage,/<h1>门店工作台<\/h1>/);assert.match(managerPage,/当前岗位：门店主管/);assert.match(managerPage,/#\/store\/operations/);assert.doesNotMatch(managerPage,/#\/store\/(bills|recoveries|service-finance|invoices)/);
  const supportPage=f.page(support,['home']);assert.match(supportPage,/<h1>集团工作台<\/h1>/);assert.match(supportPage,/当前岗位：集团客服/);assert.match(supportPage,/#\/group\/privacy/);assert.doesNotMatch(supportPage,/#\/group\/accounts/);
});
test('账户页在自由演示及非管理员深链下不暴露员工历史',()=>{
  const f=fixture(),x=f.create('内部账号秘密'),finance=f.staff('finance');for(const actor of [DEMO,{role:'group',job:'all'},finance]){const html=f.page(actor,['accounts',x.id]);assert.match(html,/无权管理工作账号/);assert.doesNotMatch(html,/内部账号秘密|增加实际试点人员|name="reason"/);}
});
test('详情表单明确版本、理由、范围与撤会话影响，集团门店授权不混选',()=>{
  const f=fixture(),x=f.create(),html=f.page(f.admin,['accounts',x.id]);const grants=forms(html,'account.grant');assert.equal(grants.length,2);const group=grants.find(x=>x.key.endsWith('grant-group')),store=grants.find(x=>x.key.endsWith('grant-store'));assert.doesNotMatch(group.body,/name="storeId"|value="all"|value="store-finance"/);assert.match(store.body,/name="storeId"/);assert.match(store.body,/value="store-finance"/);assert.doesNotMatch(store.body,/value="account-admin"/);for(const form of forms(html)){assert.equal(form.payload.version,x.version);assert.match(form.attrs,/data-live-version="1"/);assert.match(form.attrs,/data-confirm=/);assert.match(form.body,/name="reason"/);}assert.match(html,/业务订单、资金及历史记录保留/);
});
test('通过页面撤权使旧会话失效，并保留撤销授权及实际操作人',()=>{
  const f=fixture(),a=f.staff('store-manager'),html=f.page(f.admin,['accounts',a.accountId]),revoke=forms(html,'account.revoke').find(x=>x.payload.grantId===a.grantId);f.send(revoke,{reason:'员工岗位调整'});const changed=f.page(f.admin,['accounts',a.accountId]);assert.match(changed,/已撤销/);assert.match(changed,/员工岗位调整/);assert.match(changed,/演示账号管理员/);assert.equal(forms(changed,'account.revoke').length,0);const expired=f.page(a,['dashboard']);assert.match(expired,/工作会话已失效/);assert.match(expired,/data-command="ui.account-exit"/);assert.doesNotMatch(expired,/#\/store\/bookings/);
});
test('通过页面停用恢复后旧会话仍失效，恢复不声称恢复登录',()=>{
  const f=fixture(),a=f.staff('support');let form=forms(f.page(f.admin,['accounts',a.accountId]),'account.status')[0];assert.equal(form.payload.enabled,false);f.send(form,{reason:'停用账号'});form=forms(f.page(f.admin,['accounts',a.accountId]),'account.status')[0];assert.equal(form.payload.enabled,true);assert.match(form.body,/恢复账号/);f.send(form,{reason:'恢复工作资格'});assert.match(f.page(a,['work-login']),/会话已失效/);assert.match(f.page(f.admin,['accounts',a.accountId]),/恢复后需重新进入/);
});
test('旧表单版本拒绝提交，失败不覆盖现有授权',()=>{
  const f=fixture(),x=f.create(),before=forms(f.page(f.admin,['accounts',x.id]),'account.status')[0];f.grant(x.id,'support');assert.throws(()=>f.send(before,{reason:'旧标签停用'}),/账号资料已更新/);assert.equal(f.s.staffAccounts.find(a=>a.id===x.id).enabled,true);const next=forms(f.page(f.admin,['accounts',x.id]),'account.status')[0];assert.equal(next.key,before.key);assert.equal(next.payload.version,before.payload.version+1);
});
test('草稿键按账号和会话隔离，不让两位管理员混用同一账号编辑草稿',()=>{
  const f=fixture(),x=f.create('第二管理员'),y=f.grant(x.id,'account-admin'),other=f.enter(x.id,y.grants[0].id),target=f.create('被管理账号');const one=forms(f.page(f.admin,['accounts',target.id]),'account.status')[0],two=forms(f.page(other,['accounts',target.id]),'account.status')[0];assert.notEqual(one.key,two.key);assert.ok(one.key.includes(f.admin.sessionId));assert.ok(two.key.includes(other.sessionId));
});
test('账号名称和原因安全转义，页面查询不修改业务数据',()=>{
  const f=fixture(),x=f.create('<img src=x onerror=alert(1)>'),before=structuredClone(f.s);const html=f.page(f.admin,['accounts',x.id]);assert.match(html,/&lt;img src=x onerror=alert\(1\)&gt;/);assert.doesNotMatch(html,/<img src=x/);f.page(DEMO,['work-login']);f.page(f.admin,['dashboard']);assert.deepEqual(f.s,before);assert.equal(accountUiView(f.s,f.admin,['care']),null);assert.equal(accountUiView(f.s,DEMO,['home']),null);assert.match(f.page(f.admin,['accounts','missing']),/不存在/);assert.match(f.page(f.admin,['accounts',x.id,'bad']),/页面不存在/);
});
test('静态状态和保存草稿反馈使用notice或status，不伪装可点击动作',()=>{
  const f=fixture(),html=f.page();assert.match(html,/<p class="notice" role="status">/);assert.match(html,/<p class="management-draft-note small muted" role="status">/);assert.doesNotMatch(html,/<button[^>]*>[^<]*(本地账号演示|未提交内容保留|账号已启用)/);assert.match(html,/<button type="submit" class="primary">开通账号<\/button>/);
});
test('用户技师店长旧工作入口只给后台方向，不列员工或授予工作身份',()=>{
  const f=fixture();f.staff('support');f.staff('store-manager');const before=structuredClone(f.s);
  for(const actor of [DEMO,{role:'tech',techId:'t1',storeId:'s1'},{role:'manager',storeId:'s1'}]){
    const html=f.page(actor,['work-login']);assert.match(html,/工作账号在后台使用/);assert.match(html,/#\/group\/accounts/);assert.match(html,/#\/store\/work-login/);assert.doesNotMatch(html,/DEMO-ADMIN|演示账号管理员|陈员工|当前工作身份|account\.enter/);assert.equal(forms(html).length,0);
  }
  assert.deepEqual(f.s,before,'读取旧链接不生成或撤销任何会话');
});
test('全局工作入口仅在集团和门店后台显示，三类小程序均无入口',()=>{
  for(const actor of [DEMO,{role:'tech',techId:'t1'},{role:'manager',storeId:'s1'}])assert.equal(accountEntryLink(actor),'');
  assert.match(accountEntryLink(GROUP),/href="#\/group\/work-login"[^>]*>后台岗位演示/);assert.match(accountEntryLink(STORE),/href="#\/store\/work-login"[^>]*>后台岗位演示/);
  const f=fixture(),store=f.staff('store-finance');assert.match(accountEntryLink(f.admin),/href="#\/group\/work-login"[^>]*>当前工作账号/);assert.match(accountEntryLink(store),/href="#\/store\/work-login"[^>]*>当前工作账号/);
});
test('集团与当前门店分别筛选同一员工的多岗位，其他端和跨店岗位不混入',()=>{
  const f=fixture(),mixed=f.create('跨端任职员工');f.grant(mixed.id,'support');f.grant(mixed.id,'store-manager','s1');const latest=f.grant(mixed.id,'store-finance','s2'),byJob=Object.fromEntries(latest.grants.map(g=>[g.job,g.id]));
  const groupOnly=f.create('集团专岗人员');f.grant(groupOnly.id,'warehouse');const remote=f.create('银杏独立人员');f.grant(remote.id,'store-manager','s2');
  const group=f.page(GROUP,['work-login']),local=f.page(STORE,['work-login']),other=f.page({role:'store',storeId:'s2'},['work-login']);
  assert.deepEqual(forms(group,'account.enter').filter(x=>x.payload.accountId===mixed.id).map(x=>x.payload.grantId),[byJob.support]);assert.match(group,/集团专岗人员/);assert.doesNotMatch(group,/银杏独立人员|以门店主管进入|以门店财务进入/);
  assert.match(local,/门店后台岗位演示/);assert.match(local,/选择幸福里门店的已授权岗位/);assert.deepEqual(forms(local,'account.enter').map(x=>x.payload.grantId),[byJob['store-manager']]);assert.doesNotMatch(local,/集团专岗人员|银杏独立人员|DEMO-ADMIN|以集团客服进入|以门店财务进入/);
  assert.deepEqual(forms(other,'account.enter').filter(x=>x.payload.accountId===mixed.id).map(x=>x.payload.grantId),[byJob['store-finance']]);assert.match(other,/银杏独立人员/);assert.doesNotMatch(other,/集团专岗人员|DEMO-ADMIN/);
});
test('无有效本店授权时显示后台空状态，未知门店不回退为全集团名单',()=>{
  const f=fixture();f.staff('support');f.staff('store-manager','s2');
  for(const actor of [STORE,{role:'store',storeId:'不存在的门店'}]){const html=f.page(actor,['work-login']);assert.match(html,/暂无可用岗位/);assert.match(html,/账号与授权由集团后台统一维护/);assert.doesNotMatch(html,/DEMO-ADMIN|陈员工|account\.enter/);assert.equal(forms(html).length,0);}
});
test('集团账号权限模块无会话只供管理员进入，进入后直接回账号管理才出现写操作',()=>{
  const f=fixture(),ordinary=f.create('普通运营秘密');f.grant(ordinary.id,'operations');
  const html=f.page(GROUP,['accounts']);assert.match(html,/<h1>账号与权限<\/h1>/);assert.doesNotMatch(html,/普通运营秘密|开通工作账号|name="reason"/);const entries=forms(html,'account.enter');assert.equal(entries.length,1);assert.equal(entries[0].payload.grantId,'DEMO-ADMIN-GRANT');assert.match(entries[0].attrs,/data-next="\/group\/accounts"/);assert.equal(forms(html).length,entries.length);
  assert.throws(()=>f.run(GROUP,'account.create',{name:'不能直接写',reason:'无工作会话'}),/账号管理员/);
  const result=f.send(entries[0],{},GROUP),administrator=resolveAccountActor(f.s,result),managed=f.page(administrator,['accounts']);assert.match(managed,/<h1>账号与权限<\/h1>/);assert.equal(forms(managed,'account.create').length,1);assert.match(managed,/普通运营秘密/);
  for(const actor of [STORE,{role:'group',job:'finance'},{role:'group',job:'operations'}]){const denied=f.page(actor,['accounts']);assert.match(denied,/无权管理工作账号/);assert.equal(forms(denied).length,0);}
});
test('已有岗位会话只展示本人工作身份，不混入后台其他账号选择器',()=>{
  const f=fixture(),finance=f.staff('store-finance'),support=f.staff('support');
  for(const actor of [finance,support]){const html=f.page(actor,['work-login']);assert.match(html,/当前工作身份/);assert.match(html,new RegExp(actor.accountId));assert.doesNotMatch(html,/以账号管理员进入|以集团客服进入|以门店财务进入|data-command="account\.enter"/);assert.equal(forms(html).length,0);assert.match(html,/返回(门店|集团)后台/);assert.match(html,/切换岗位/);}
});
test('真实撤权或停用后退出仍返回原后台门店，查询目标不改变历史记录',()=>{
  const f=fixture(),store=f.staff('store-finance','s2'),group=f.staff('support');
  const revoke=forms(f.page(f.admin,['accounts',store.accountId]),'account.revoke').find(x=>x.payload.grantId===store.grantId);f.send(revoke,{reason:'结束银杏财务授权'});const stop=forms(f.page(f.admin,['accounts',group.accountId]),'account.status')[0];f.send(stop,{reason:'暂时停用集团客服'});
  assert.throws(()=>resolveAccountActor(f.s,store),/失效/);assert.throws(()=>resolveAccountActor(f.s,group),/失效/);const before=structuredClone(f.s);
  const localTarget=accountExitTarget(f.s,store),groupTarget=accountExitTarget(f.s,group);assert.deepEqual(localTarget,{actor:{role:'store',storeId:'s2'},path:'/store/dashboard'});assert.deepEqual(groupTarget,{actor:{role:'group'},path:'/group/dashboard'});assert.ok(!('sessionId' in localTarget.actor));assert.ok(!('accountId' in groupTarget.actor));assert.deepEqual(f.s,before);
  assert.match(f.page(localTarget.actor,['work-login']),/暂无可用岗位/);assert.doesNotMatch(f.page(localTarget.actor,['work-login']),/DEMO-ADMIN|集团客服/);
});
test('退出后台归属采用存档会话授权，不能用篡改actor跳到另一后台或门店',()=>{
  const f=fixture(),store=f.staff('store-manager','s2'),group=f.staff('support');
  const fakeStore={...store,role:'group',job:'account-admin',accountId:'DEMO-ADMIN',grantId:'DEMO-ADMIN-GRANT',storeId:'s1'};assert.deepEqual(accountExitTarget(f.s,fakeStore),{actor:{role:'store',storeId:'s2'},path:'/store/dashboard'});
  const fakeGroup={...group,role:'store',job:'store-finance',storeId:'s1',accountId:store.accountId,grantId:store.grantId};assert.deepEqual(accountExitTarget(f.s,fakeGroup),{actor:{role:'group'},path:'/group/dashboard'});
  f.run(store,'account.leave');assert.deepEqual(accountExitTarget(f.s,fakeStore),{actor:{role:'store',storeId:'s2'},path:'/store/dashboard'},'已退出会话仍从保留的授权历史定位后台');
});
test('返回后台与切换岗位是两个明确命令目标，保持门店且不接受任意地址',()=>{
  const f=fixture(),store=f.staff('store-finance','s2');
  for(const a of [f.admin,store]){
    for(const html of [accountEntryLink(a),accountExitActions(a),f.page(a,['dashboard'])]){
      const buttons=exitButtons(html);assert.equal(buttons.length,2);assert.deepEqual(buttons.map(x=>x.payload),[{destination:'dashboard'},{destination:'work-login'}]);assert.equal(buttons[0].label,a.role==='store'?'返回门店后台':'返回集团后台');assert.equal(buttons[1].label,'切换岗位');assert.ok(buttons.every(x=>/type="button"/.test(x.attrs)));
      assert.equal(accountExitTarget(f.s,a,buttons[0].payload.destination).path,`/${a.role}/dashboard`);assert.equal(accountExitTarget(f.s,a,buttons[1].payload.destination).path,`/${a.role}/work-login`);
    }
  }
  for(const destination of [undefined,'/group/accounts','https://example.invalid/','../group/dashboard','user/home',null])assert.deepEqual(accountExitTarget(f.s,store,destination),{actor:{role:'store',storeId:'s2'},path:'/store/dashboard'});
  assert.deepEqual(accountExitTarget(f.s,store,'work-login'),{actor:{role:'store',storeId:'s2'},path:'/store/work-login'});assert.equal(exitButtons(accountEntryLink(STORE)).length,0);
});
test('真实结束会话后才能回自由后台，旧会话失效且返回身份不携带岗位权限',()=>{
  const f=fixture(),a=f.staff('store-manager','s2'),target=accountExitTarget(f.s,a),before=structuredClone(f.s.staffAccounts.find(x=>x.id===a.accountId));f.s.bookings=[{id:'BK-KEEP',status:'confirmed',priceCents:19800}];const bookings=structuredClone(f.s.bookings);
  assert.equal(resolveAccountActor(f.s,a).sessionId,a.sessionId);f.run(a,'account.leave');assert.throws(()=>resolveAccountActor(f.s,a),/失效/);assert.deepEqual(target,{actor:{role:'store',storeId:'s2'},path:'/store/dashboard'});assert.deepEqual(resolveAccountActor(f.s,target.actor),target.actor);assert.deepEqual(Object.keys(target.actor).sort(),['role','storeId']);assert.deepEqual(f.s.staffAccounts.find(x=>x.id===a.accountId),before);assert.deepEqual(f.s.bookings,bookings);assert.match(f.page(a,['dashboard']),/会话已失效/,'返回旧URL不应重新激活已结束的会话');
});
test('会话撤销后的错误页仍有返回与换岗两个出口，文案按存档授权归属',()=>{
  const f=fixture(),a=f.staff('store-finance','s2'),revoke=forms(f.page(f.admin,['accounts',a.accountId]),'account.revoke').find(x=>x.payload.grantId===a.grantId);f.send(revoke,{reason:'权限变更结束会话'});
  const html=f.page({...a,role:'group',storeId:'s1'},['work-login']);assert.match(html,/工作会话已失效/);const exits=exitButtons(html);assert.deepEqual(exits.map(x=>({label:x.label,payload:x.payload})),[{label:'返回门店后台',payload:{destination:'dashboard'}},{label:'切换岗位',payload:{destination:'work-login'}}]);assert.equal(forms(html,'account.enter').length,0);assert.doesNotMatch(html,/当前工作身份|返回集团后台/);
});

function identityFixture() {
  let s=seed(),seq=0;
  const h={get s(){return s;},get t(){return s.techs.at(-1);},run(a,type,p={}){let r;s=reduce(s,a,type,{requestId:'identity-page-'+ ++seq,reason:'实际本人核验页面',...p},x=>r=x);return r;},page(a=h.admin){return accountUiView(s,a,['accounts']);},send(f,p={},a=h.admin){assert.ok(f);return h.run(a,f.command,{...f.payload,...p});}};
  h.run({role:'user',userId:'u1'},'clock.advance',{minutes:1});
  h.run({role:'store',storeId:'xingfu'},'manage.tech-save',{name:'页面本人核验师傅',phone:'13800001439',storeId:'xingfu',gender:'female',lat:31.23,lng:121.47,serviceIds:['neck'],certificate:'IDENTITY-PRIVATE-CERT',insurance:'IDENTITY-PRIVATE-INSURANCE',validUntil:'2027-12-31'});
  h.admin=h.run({role:'group',job:'all'},'account.enter',{accountId:'DEMO-ADMIN',grantId:'DEMO-ADMIN-GRANT'});return h;
}

test('账号管理员的原页面选择实际主体和版本，再由原命令登记明确本人关联',()=>{
  const h=identityFixture(),before=structuredClone(h.s),html=h.page(),f=forms(html,'lifecycle.identity-link')[0];assert.deepEqual(h.s,before);
  assert.match(f.body,/name="techId" required data-lifecycle-identity-tech/);assert.match(f.body,new RegExp('value="'+h.t.id+'" data-subject-version="'+h.t.version+'"'));assert.match(f.body,/name="userId" required/);assert.match(f.body,/name="reference"[^>]*required/);assert.match(f.body,/type="datetime-local" name="occurredAt" required/);assert.match(f.body,/name="version" value=""/);assert.equal(f.attrs.includes('data-live-version=""'),true);
  const p={techId:h.t.id,version:h.t.version,userId:'u2',reference:'OWNER-UI-REFERENCE',occurredAt:h.s.now,reason:'实际核验本人关联',requestId:'stable-identity-page'},linked=h.send(f,p);assert.equal(h.t.userId,'u2');assert.equal(h.t.identityLinkId,linked.id);assert.equal(linked.reference,p.reference);assert.equal(linked.createdBy.accountId,h.admin.accountId);assert.equal(linked.createdBy.job,'account-admin');assert.equal(linked.occurredAt,p.occurredAt);
  const after=structuredClone(h.s);assert.deepEqual(h.send(f,p),linked);assert.deepEqual({...h.s,revision:after.revision},after);assert.equal(h.s.revision,after.revision+1);const next=h.page(),nextForm=forms(next,'lifecycle.identity-link')[0];assert.match(next,new RegExp(linked.id));assert.ok(!nextForm||!nextForm.body.includes('value="'+h.t.id+'"'));assert.ok(!nextForm||!nextForm.body.includes('value="u2"'));assert.match(next,/不能通过此表单重绑/);
  assert.throws(()=>h.send(f,{...p,requestId:'rebind-page',version:h.t.version,userId:'u1'}),/已有本人关联|冲突/);
});

test('本人关联表单只在原账号管理员列表，无其他岗位或主体页越权入口',()=>{
  const h=identityFixture();for(const a of [{role:'group',job:'all'},{role:'group',job:'operations'},{role:'group',job:'finance'},{role:'store',storeId:'xingfu'},{role:'tech',techId:h.t.id},{role:'user',userId:'u1'}]){const html=h.page(a);assert.equal(forms(html,'lifecycle.identity-link').length,0);assert.doesNotMatch(html,/页面本人核验师傅|IDENTITY-PRIVATE-CERT|13800001439/);}
  const detail=accountUiView(h.s,h.admin,['accounts','DEMO-ADMIN']);assert.equal(forms(detail,'lifecycle.identity-link').length,0);const f=forms(h.page(),'lifecycle.identity-link')[0];for(const a of [{role:'group',job:'operations'},{role:'group',job:'all'},{role:'store',storeId:'xingfu'}])assert.throws(()=>h.send(f,{techId:h.t.id,version:h.t.version,userId:'u2',reference:'OWNER',occurredAt:h.s.now},a),/岗位|无权|账号管理员/);
});

test('本人原版本变化或未发生的核验会拒绝，页面不能补造本人来源',()=>{
  const h=identityFixture(),f=forms(h.page(),'lifecycle.identity-link')[0],p={techId:h.t.id,version:h.t.version,userId:'u2',reference:'OWNER-UI',occurredAt:h.s.now};h.run({role:'group',job:'operations'},'manage.tech-review',{id:h.t.id,version:h.t.version,decision:'approve'});const before=structuredClone(h.s);assert.throws(()=>h.send(f,p),/资料已更新/);assert.deepEqual(h.s,before);assert.throws(()=>h.send(f,{...p,version:h.t.version,occurredAt:h.s.now+60000}),/尚未发生/);assert.deepEqual(h.s,before);assert.equal(h.s.organizationIdentityLinks.length,0);
});

test('冲突重复缺版本或关闭来源不成为可提交选择，负例查询不修复原资料',()=>{
  const h=identityFixture(),bad=structuredClone(h.s);bad.techs.push(structuredClone(bad.techs.at(-1)));bad.users.push(structuredClone(bad.users.find(u=>u.id==='u1')));bad.users.find(u=>u.id==='u2').status='closed';for(const t of bad.techs)if(t.id!==h.t.id)delete t.version;const before=structuredClone(bad),html=accountUiView(bad,h.admin,['accounts']);assert.equal(forms(html,'lifecycle.identity-link').length,0);assert.match(html,/暂无可新关联的唯一技师或普通用户/);assert.deepEqual(bad,before);
});

test('本人关联页不输出内部财务身份附件或联系方式，名称转义和状态语义保留',()=>{
  const h=identityFixture(),bad=structuredClone(h.s);bad.techs.at(-1).name='<img src=x onerror=alert(1)>';bad.users.find(u=>u.id==='u2').name='<script>私人</script>';const before=structuredClone(bad),html=accountUiView(bad,h.admin,['accounts']);assert.match(html,/&lt;img src=x onerror=alert\(1\)&gt;/);assert.match(html,/&lt;script&gt;私人&lt;\/script&gt;/);assert.doesNotMatch(html,/<img src=x|<script>私人|13800001439|IDENTITY-PRIVATE-CERT|IDENTITY-PRIVATE-INSURANCE|amountCents|evidenceRefs|原事项协调与清算|当前阻断原因/);assert.match(html,/<p class="notice" role="status">/);assert.match(html,/<button type="submit" class="primary">登记本人关联<\/button>/);assert.deepEqual(bad,before);
});

function handoverFixture() {
  const h=identityFixture();
  h.detail=id=>accountUiView(h.s,h.admin,['accounts',id]);
  h.staff=(job,storeId,employed=true)=>{
    let a=h.send(forms(h.page(),'account.create')[0],{name:'承接页面实际'+job});
    a=h.send(forms(h.detail(a.id),'account.grant').find(f=>f.key.endsWith(STAFF_JOBS[job].role==='group'?'grant-group':'grant-store')),{job,...(storeId?{storeId}:{}),reason:'已有岗位明确授权'});
    if(employed)a=h.send(forms(h.detail(a.id),'account.employment')[0],{employmentStatus:'active',verifiedAt:h.s.now,reference:'UI-EMPLOYMENT-'+job,reason:'实际人员核验在岗'});
    const g=a.grants.at(-1),entry=forms(accountUiView(h.s,STaffRole(g),['work-login']),'account.enter').find(f=>f.payload.accountId===a.id&&f.payload.grantId===g.id),actor=h.send(entry,{},STaffRole(g));return {id:a.id,grantId:g.id,job,storeId,actor};
  };
  h.operator=h.staff('operations');h.members=[h.staff('support'),h.staff('finance'),h.staff('store-finance','xingfu')];
  h.begin=()=>{const f=forms(organizationLifecyclePanel(h.s,h.operator.actor,{storeId:'xingfu'}),'lifecycle.store-close-start')[0];return h.send(f,{reference:'UI-ACTUAL-CLOSE'},h.operator.actor);};
  h.register=m=>{const f=forms(h.detail(m.id),'account.handover').find(f=>f.payload.grantId===m.grantId);assert.ok(f,'原详情应有实际case/grant表单');assert.deepEqual(f.payload.allowedCommands,lifecycleHandoverCommands(m.job));return h.send(f,{storeId:m.storeId || 'xingfu',reference:'UI-ACTUAL-HANDOVER-'+m.job,reason:'原主体明确承接'});};
  h.accept=m=>{const f=forms(accountUiView(h.s,m.actor,['work-login']),'account.handover-accept')[0];return h.send(f,{reference:'UI-OWNER-ACCEPT-'+m.job,reason:'本人已核对原事项'},m.actor);};
  return h;
}
const STaffRole=g=>g.role==='store'?{role:'store',storeId:g.storeId}:{role:'group',job:'all'};

test('原账号详情实际在岗→已有岗位承接→本人工作页接受→运营完成关店闭环',()=>{
  const h=handoverFixture(),c=h.begin();let html=organizationLifecyclePanel(h.s,h.operator.actor,{storeId:'xingfu'});assert.equal(forms(html,'lifecycle.complete').length,0);
  for(const m of h.members){const original=forms(h.detail(m.id),'account.handover')[0];assert.equal(original.payload.caseId,c.id);assert.equal(original.payload.caseVersion,c.version);assert.equal(original.payload.accountVersion,h.s.staffAccounts.find(a=>a.id===m.id).version);assert.match(original.body,/name="storeId" required/);assert.doesNotMatch(original.body,/value="silver"/);const r=h.register(m);assert.equal(r.status,'pending');const own=accountUiView(h.s,m.actor,['work-login']);assert.match(own,/本人原事项承接|本人确认承接/);assert.equal(forms(own,'account.handover-accept')[0].payload.id,r.id);assert.match(forms(own,'account.handover-accept')[0].attrs,new RegExp('data-next="/'+(m.storeId?'store':'group')+'/work-login"'));assert.equal(exitButtons(own).length,2);const accepted=h.accept(m);assert.equal(accepted.status,'accepted');assert.equal(accepted.acceptedBy.accountId,m.id);assert.equal(accepted.acceptedBy.grantId,m.grantId);assert.equal(forms(accountUiView(h.s,m.actor,['dashboard']),'account.handover-accept').length,0);}
  html=organizationLifecyclePanel(h.s,h.operator.actor,{storeId:'xingfu'});const complete=forms(html,'lifecycle.complete')[0];h.send(complete,{reason:'页面原承接及资金来源已核齐'},h.operator.actor);assert.equal(h.s.stores.find(s=>s.id==='xingfu').lifecycleStatus,'closed');assert.equal(forms(h.detail(h.members[2].id),'account.handover-cancel').length,0);assert.equal(forms(h.detail(h.members[2].id),'account.handover').length,0);
});

test('管理员可从原页撤回pending或accepted承接，保留历史并须重新本人确认',()=>{
  const h=handoverFixture();h.begin();const m=h.members[0],pending=h.register(m),old=forms(accountUiView(h.s,m.actor,['work-login']),'account.handover-accept')[0],cancel=forms(h.detail(m.id),'account.handover-cancel')[0];h.send(cancel,{reason:'核对来源后撤回'});assert.equal(h.s.organizationAuthorityHandovers.find(x=>x.id===pending.id).status,'cancelled');const before=structuredClone(h.s);assert.throws(()=>h.send(old,{reference:'旧接受',reason:'旧表单'},m.actor),/原承接|版本/);assert.deepEqual(h.s,before);const newRecord=h.register(m);assert.notEqual(newRecord.id,pending.id);h.accept(m);const acceptedCancel=forms(h.detail(m.id),'account.handover-cancel')[0];h.send(acceptedCancel,{reason:'实际承接范围变更后撤回'});assert.equal(h.s.organizationAuthorityHandovers.find(x=>x.id===newRecord.id).status,'cancelled');assert.equal(h.s.organizationAuthorityHandovers.find(x=>x.id===newRecord.id).acceptedBy.accountId,m.id);assert.match(h.detail(m.id),/管理员已撤回/);assert.ok(forms(h.detail(m.id),'account.handover').length);
});

test('本人接受只见当前账号且当前grant，其他账号岗位或管理员不能代接受',()=>{
  const h=handoverFixture();h.begin();const member=h.members[0],other=h.members[1],record=h.register(member),f=forms(accountUiView(h.s,member.actor,['work-login']),'account.handover-accept')[0];
  for(const a of [h.admin,other.actor,h.operator.actor,{role:'group',job:'all'}]){const html=accountUiView(h.s,a,['work-login']);assert.equal(forms(html,'account.handover-accept').length,0);assert.doesNotMatch(html,new RegExp(record.id));const before=structuredClone(h.s);assert.throws(()=>h.send(f,{reference:'他人不能接受',reason:'越权负例'},a),/目标本人|原承接|会话|确认/);assert.deepEqual(h.s,before);}
  let account=h.s.staffAccounts.find(a=>a.id===member.id);h.send(forms(h.detail(member.id),'account.grant').find(f=>f.key.endsWith('grant-group')),{job:'finance',reason:'同账号另一既有岗位'});account=h.s.staffAccounts.find(a=>a.id===member.id);const grant=account.grants.at(-1),second=h.run({role:'group',job:'all'},'account.enter',{accountId:member.id,grantId:grant.id});assert.equal(forms(accountUiView(h.s,second,['work-login']),'account.handover-accept').length,0);assert.throws(()=>h.send(f,{reference:'不能跨岗位',reason:'同账号不同grant'},second),/目标本人|原承接|确认/);
});

test('enabled或伪在岗标签不提供原承接表单，旧账号版本与实际核验时间仍拒绝',()=>{
  const h=handoverFixture(),notEmployed=h.staff('support',undefined,false);h.begin();assert.equal(forms(h.detail(notEmployed.id),'account.handover').length,0);assert.match(h.detail(notEmployed.id),/尚无实际人员在岗来源|先登记真实在岗来源/);const fake=structuredClone(h.s),account=fake.staffAccounts.find(a=>a.id===notEmployed.id);account.employment={status:'active',verifiedAt:fake.now,reference:'伪造标签',recordedAt:fake.now};assert.equal(forms(accountUiView(fake,h.admin,['accounts',notEmployed.id]),'account.handover').length,0);
  const m=h.members[0],old=forms(h.detail(m.id),'account.handover')[0],employment=forms(h.detail(m.id),'account.employment')[0];assert.match(employment.body,/type="datetime-local" name="verifiedAt" required[^>]*data-lifecycle-employment-time/);h.send(employment,{employmentStatus:'active',verifiedAt:h.s.now,reference:'重新核验真实人员',reason:'真实在岗来源更新'});const before=structuredClone(h.s);assert.throws(()=>h.send(old,{storeId:'xingfu',reference:'旧在岗来源',reason:'旧表单'}),/账号已更新/);assert.deepEqual(h.s,before);assert.throws(()=>h.send(forms(h.detail(m.id),'account.employment')[0],{employmentStatus:'active',verifiedAt:h.s.now+60000,reference:'尚未发生',reason:'未来负例'}),/核验发生时间无效/);assert.deepEqual(h.s,before);
});

test('原人员技师关联必须显式登记，不可静默重绑，结束真实在岗会撤旧会话',()=>{
  const h=handoverFixture(),m=h.members[0];h.run({role:'group',job:'operations'},'manage.tech-review',{id:h.t.id,version:h.t.version,decision:'approve'});let f=forms(h.detail(m.id),'account.employment')[0];assert.match(f.body,/明确关联技师（可不选）/);h.send(f,{employmentStatus:'active',techId:h.t.id,verifiedAt:h.s.now,reference:'明确原工作本人',reason:'已实际核验人员'});assert.equal(h.s.staffAccounts.find(a=>a.id===m.id).techId,h.t.id);f=forms(h.detail(m.id),'account.employment')[0];assert.doesNotMatch(f.body,/name="techId"/);assert.match(f.body,new RegExp('原关联技师：'+h.t.id));const before=structuredClone(h.s);assert.throws(()=>h.send(f,{employmentStatus:'active',techId:'lin',verifiedAt:h.s.now,reference:'不能重绑',reason:'负例'}),/不能静默改绑|关联来源/);assert.deepEqual(h.s,before);const actor=h.run({role:'group',job:'all'},'account.enter',{accountId:m.id,grantId:m.grantId});h.send(f,{employmentStatus:'ended',verifiedAt:h.s.now,reference:'工作实际结束来源',reason:'人员工作结束'});assert.throws(()=>resolveAccountActor(h.s,actor),/失效|在岗|结束/);assert.equal(h.s.staffAccounts.find(a=>a.id===m.id).employment.status,'ended');
});

test('承接页查询不改原账，内部原快照和财务身份字段不输出',()=>{
  const h=handoverFixture();h.begin();const m=h.members[0];h.register(m);const before=structuredClone(h.s),html=h.detail(m.id)+accountUiView(h.s,m.actor,['work-login']);assert.deepEqual(h.s,before);assert.doesNotMatch(html,/grantSource|employmentSource|caseSource|priceCents|amountCents|evidenceRefs|IDENTITY-PRIVATE-CERT|13800001439|原事项协调与清算|当前阻断原因/);assert.match(html,/<p class="notice" role="status">/);assert.doesNotMatch(html,/<button[^>]*>[^<]*(待目标本人确认|本人已确认|管理员已撤回)/);
});
