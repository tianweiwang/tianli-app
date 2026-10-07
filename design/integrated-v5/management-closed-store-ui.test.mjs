import test from 'node:test';
import assert from 'node:assert/strict';
import {seed,reduce,createLifecycleContext} from './engine.mjs';
import {managementView} from './management-ui.mjs';
import {lifecycleImpact} from './organization-lifecycle-projection.mjs';
import {lifecycleCompletionView} from './organization-lifecycle.mjs';
import {lifecycleHandoverCommands} from './organization-lifecycle-authority.mjs';

const ops={role:'group',job:'operations'},user={role:'user',userId:'u1'};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ui={esc,query:new URLSearchParams(),money:v=>String(v),date:v=>v==null?'—':new Date(v).toISOString(),
  link:(label,path)=>`<a href="#${esc(path)}">${label}</a>`,tag:label=>`<span>${esc(label)}</span>`,empty:label=>`<p>${esc(label)}</p>`,
  field:(label,name,value='')=>`<label>${esc(label)}<input name="${name}" value="${esc(value)}"></label>`,
  select:(label,name,options,value)=>`<label>${esc(label)}<select name="${name}">${options.map(o=>`<option value="${esc(o.value)}" ${String(value)===String(o.value)?'selected':''}>${esc(o.label)}</option>`).join('')}</select></label>`};
const page=(s,id='xingfu',actor=ops)=>managementView(s,actor,['stores',id],ui);

test('原默认门店已关闭时集团仍能在可用门店新建及导入待审人员',()=>{
  const {s}=closedFixture(),actor={...ops,storeId:'xingfu'},before=structuredClone(s);
  const html=managementView(s,actor,['technicians','new'],ui);
  assert.match(html,/data-command="manage\.tech-save"/);assert.doesNotMatch(html,/工作身份已结束/);
  assert.doesNotMatch(html,/<option value="xingfu"/);assert.match(html,/<option value="silver" selected/);
  const imported=managementView(s,actor,['technicians','import'],ui);
  assert.match(imported,/data-command="manage\.tech-import"/);assert.doesNotMatch(imported,/<option value="xingfu"/);
  const old=managementView(s,actor,['technicians','lin'],ui);
  assert.match(old,/工作身份已结束/);assert.doesNotMatch(old,/data-command="manage\.tech-save"/);
  assert.deepEqual(s,before);
});

test('新增人员范围沿原关停限制，暂停和未审核门店可建档，无候选则给出静态原因',()=>{
  const s=seed();s.stores.find(x=>x.id==='xingfu').lifecycleStatus='closing';
  const silver=s.stores.find(x=>x.id==='silver');silver.active=false;silver.reviewStatus='pending';
  const html=managementView(s,{...ops,storeId:'xingfu'},['technicians','new'],ui);
  assert.doesNotMatch(html,/<option value="xingfu"/);assert.match(html,/<option value="silver" selected/);
  for(const id of ['new','import']){
    const scoped=managementView(s,{role:'store',job:'store-manager',storeId:'xingfu'},['technicians',id],ui);
    assert.doesNotMatch(scoped,/data-command="manage\.tech-(save|import)"/);
    assert.match(scoped,/没有可新增人员的门店/);
  }
  for(const store of s.stores)store.closedAt=s.now;
  assert.doesNotMatch(managementView(s,ops,['technicians','new'],ui),/data-command="manage\.tech-save"/);
});

function closedFixture(){
  let s=seed(),seq=0;
  const run=(actor,type,p={})=>{let result;s=reduce(s,actor,type,{requestId:'closed-store-ui-'+ ++seq,reason:'关闭门店历史页面验证',...p},r=>result=r);return result;};
  const admin=run(user,'account.enter',{accountId:'DEMO-ADMIN',grantId:'DEMO-ADMIN-GRANT'}),members=[];
  for(const [job,storeId] of [['support'],['finance'],['store-finance','xingfu']]){
    let a=run(admin,'account.create',{name:'页面验证'+job});
    a=run(admin,'account.employment',{id:a.id,version:a.version,employmentStatus:'active',reference:'UI-EMP-'+job,verifiedAt:s.now});
    a=run(admin,'account.grant',{id:a.id,version:a.version,job,...(storeId?{storeId}:{})});
    const grant=a.grants.at(-1),actor=run(user,'account.enter',{accountId:a.id,grantId:grant.id});
    members.push({id:a.id,grantId:grant.id,job,actor});
  }
  const x=s.stores.find(x=>x.id==='xingfu'),ctx=createLifecycleContext();
  run(ops,'lifecycle.store-close-start',{storeId:x.id,version:x.version,sourceToken:lifecycleImpact(s,{storeId:x.id},ctx).sourceToken,reference:'UI-CLOSED-STORE'});
  for(const m of members){
    const c=s.organizationLifecycleCases.at(-1),a=s.staffAccounts.find(a=>a.id===m.id);
    const h=run(admin,'account.handover',{caseId:c.id,caseVersion:c.version,accountId:a.id,accountVersion:a.version,grantId:m.grantId,storeId:'xingfu',allowedCommands:lifecycleHandoverCommands(m.job),reference:'UI-HANDOVER-'+m.job});
    run(m.actor,'account.handover-accept',{id:h.id,version:h.version,reference:'UI-ACCEPT-'+m.job});
  }
  const c=s.organizationLifecycleCases.at(-1),completion=lifecycleCompletionView(s,c.id,ctx);
  assert.equal(completion.canComplete,true,completion.blockers.map(x=>x.reason).join('；'));
  run(ops,'lifecycle.complete',{id:c.id,version:c.version,sourceToken:completion.sourceToken});
  return {s,caseId:c.id};
}

test('真实关停完成后原事务拒绝资料保存和全部营业推广变更，原事实保持',()=>{
  const {s}=closedFixture(),x=s.stores.find(x=>x.id==='xingfu'),before=structuredClone(s);
  assert.equal(x.lifecycleStatus,'closed');
  assert.throws(()=>reduce(s,ops,'manage.store-save',{...x,requestId:'closed-store-save',reason:'旧表单提交'}),/已关闭门店档案只读/);
  for(const status of ['open','pause','promotion-on','promotion-off'])assert.throws(()=>reduce(s,ops,'manage.store-status',{id:x.id,version:x.version,status,requestId:'closed-store-'+status,reason:'旧表单提交'}),/关停或已关闭/);
  assert.deepEqual(s,before);
});

test('真实已关闭门店显示静态历史资料，收起无效维护表单并保留原组织记录',()=>{
  const {s,caseId}=closedFixture(),x=s.stores.find(x=>x.id==='xingfu'),before=structuredClone(s),html=page(s);
  assert.doesNotMatch(html,/data-command="manage\.(store-save|store-status)"/);
  assert.doesNotMatch(html,/保存门店资料|审核通过 \/ 恢复营业|确认状态变更|营业条件核验/);
  assert.match(html,/<p class="notice" role="status">门店已关闭/);
  for(const text of [x.name,x.address,'基础资料','操作记录','组织办理记录',caseId,'限定承接','办理完成'])assert.ok(html.includes(esc(text)),text);
  assert.doesNotMatch(html,/<button[^>]*>[^<]*门店已关闭/);
  assert.deepEqual(s,before);
});

test('旧closedAt标记仍与原守卫一致收起编辑，并安全转义原资料',()=>{
  const {s}=closedFixture(),x=s.stores.find(x=>x.id==='xingfu');delete x.lifecycleStatus;x.name='<img src=x onerror=alert(1)>';
  const before=structuredClone(s),html=page(s);
  assert.doesNotMatch(html,/data-command="manage\.(store-save|store-status)"/);
  assert.match(html,/&lt;img src=x onerror=alert\(1\)&gt;/);assert.doesNotMatch(html,/<img src=x/);
  assert.deepEqual(s,before);
});

test('新店与未关闭门店保留原维护能力，其他门店不能读取关闭档案',()=>{
  const s=seed();
  for(const id of ['new','xingfu'])assert.match(page(s,id),/data-command="manage\.store-save"/);
  assert.match(page(s),/data-command="manage\.store-status"/);
  assert.match(page(s),/营业条件核验/);
  const closed=closedFixture().s;
  assert.match(page(closed,'silver'),/data-command="manage\.store-save"/);
  const denied=page(closed,'xingfu',{role:'store',storeId:'silver'});
  assert.match(denied,/门店不存在或无权访问/);assert.doesNotMatch(denied,/UI-CLOSED-STORE|基础资料/);
});
