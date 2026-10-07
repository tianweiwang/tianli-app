import test from 'node:test';
import assert from 'node:assert/strict';
import { seed, reduce } from './engine.mjs';
import { goodsTaskRows } from './work-goods.mjs';
import { workTaskView } from './work-tasks.mjs';
import { assertJob } from './management.mjs';
import { assertAccountCommand, resolveAccountActor } from './staff-accounts.mjs';
import { createTaskReturnContext, taskReturnTarget } from './task-navigation.mjs';
import { upgradeGoodsExceptions } from './goods-exceptions.mjs';

function fixture() {
  let s=seed(),n=0;
  const run=(a,type,p={})=>{let value;s=reduce(s,a,type,{requestId:'goods-work-'+(++n),...p},r=>{value=r;});return value;};
  const admin=run({role:'group',job:'all'},'account.enter',{accountId:'DEMO-ADMIN',grantId:'DEMO-ADMIN-GRANT'});
  const staff=(name,job,storeId)=>{const acc=run(admin,'account.create',{name,reason:'商品异常岗位核验'});run(admin,'account.grant',{id:acc.id,version:acc.version,job,...(storeId?{storeId}:{}),reason:'岗位职责核验'});const saved=s.staffAccounts.find(x=>x.id===acc.id);return run({role:'user',userId:'u1'},'account.enter',{accountId:saved.id,grantId:saved.grants.at(-1).id});};
  const support=staff('异常客服','support'),warehouse=staff('实收仓储','warehouse'),finance=staff('退款财务','finance'),store=staff('推广主管','store-manager','xingfu'),other=staff('其他店主管','store-manager','silver');
  const o={id:'G-fixture',createdAt:1,status:'shipped',payment:{status:'success'},source:{storeId:'xingfu'},shipment:{carrier:'技术物流',tracking:'FIXTURE'},cases:[],refunds:[],incidents:[{id:'GI-fixture',stage:'delivery',kind:'delay',status:'open',version:1,createdAt:1,dueAt:null,reason:'私有异常正文',records:[{reason:'私有跟进正文'}]}]};
  s.goods.push(o);
  upgradeGoodsExceptions(s);
  return {get s(){return s;},get o(){return s.goods.find(x=>x.id===o.id);},run,support,warehouse,finance,store,other,admin};
}
const incidentTask=(f,a)=>workTaskView(f.s,a).tasks.find(t=>t.category==='goods-exception');

test('goods exception tasks expose source metadata and original route with group-only handling',()=>{
  const f=fixture(),before=structuredClone(f.s);
  for(const a of [f.support,f.warehouse]) {const t=incidentTask(f,a);assert.equal(t.status,'open');assert.equal(t.canClaim,true);assert.equal(t.route,'/group/goods/G-fixture');assert.equal(t.dueAt,null);}
  const t=incidentTask(f,f.store);assert.equal(t.route,'/store/goods/G-fixture');assert.equal(t.canClaim,false);assert.equal(t.canAssign,false);
  for(const a of [f.finance,f.other,f.admin])assert.equal(incidentTask(f,a),undefined);
  assert.deepEqual(f.s,before);
  assert.ok(!JSON.stringify(workTaskView(f.s,f.support)).includes('私有异常正文'));
  assert.ok(!JSON.stringify(workTaskView(f.s,f.store)).includes('私有跟进正文'));
});
test('manual follow-up time only flags overdue; never completes an unresolved delivery',()=>{
  const f=fixture();f.o.incidents[0].status='waiting';f.o.incidents[0].dueAt=f.s.now-1;
  const before=structuredClone(f.s),t=incidentTask(f,f.support);
  assert.equal(t.status,'waiting');assert.equal(t.overdue,true);assert.deepEqual(f.s,before);
  f.o.incidents[0].status='done';assert.equal(incidentTask(f,f.support).overdue,false);
});
test('exception source version invalidates stale responsibility assignment and does not affect funds',()=>{
  const f=fixture(),t=incidentTask(f,f.support),money=structuredClone({skus:f.s.skus,goods:f.s.goods});
  f.run(f.support,'work.claim',{id:t.id,version:t.assignmentVersion,sourceToken:t.sourceToken});
  assert.equal(incidentTask(f,f.support).ownerAccountId,f.support.accountId);
  assert.deepEqual({skus:f.s.skus,goods:f.s.goods},money);
  f.o.incidents[0].version++;
  assert.throws(()=>f.run(f.support,'work.assign',{id:t.id,version:t.assignmentVersion,sourceToken:t.sourceToken,accountId:f.warehouse.accountId,grantId:resolveAccountActor(f.s,f.warehouse).grantId,reason:'旧页面重派'}),/阶段已更新/);
});
test('partial receipt awaits support; user agreement waits; physical disposal stays warehouse',()=>{
  const f=fixture(),c={id:'AS-fixture',createdAt:2,status:'partial_received',version:1};f.o.cases.push(c);
  let t=goodsTaskRows(f.s).find(t=>t.sourceId===c.id);assert.equal(t.status,'open');assert.deepEqual(t.allowedJobs.group,['support']);assert.deepEqual(t.commands,['goods.partial-propose']);
  c.status='partial_confirmation';t=goodsTaskRows(f.s).find(t=>t.sourceId===c.id);assert.equal(t.status,'waiting');
  c.status='awaiting_return_disposition';t=goodsTaskRows(f.s).find(t=>t.sourceId===c.id);assert.deepEqual(t.allowedJobs.group,['warehouse']);assert.deepEqual(t.commands,['goods.inspect']);
});
test('new working commands remain confined to their granted physical and coordination jobs',()=>{
  const f=fixture(),a=resolveAccountActor(f.s,f.support),w=resolveAccountActor(f.s,f.warehouse),fin=resolveAccountActor(f.s,f.finance);
  for(const cmd of ['goods.incident-open','goods.incident-note','goods.incident-propose','goods.partial-propose']) {assert.doesNotThrow(()=>assertAccountCommand(a,cmd));assert.doesNotThrow(()=>assertJob(a,cmd));}
  for(const cmd of ['goods.incident-open','goods.incident-note','goods.inspect-partial']) {assert.doesNotThrow(()=>assertAccountCommand(w,cmd));assert.doesNotThrow(()=>assertJob(w,cmd));}
  for(const [actor,cmd] of [[a,'goods.inspect-partial'],[w,'goods.partial-propose'],[fin,'goods.incident-note']]) {assert.throws(()=>assertAccountCommand(actor,cmd),/无权/);assert.throws(()=>assertJob(actor,cmd),/无权/);}
  assert.throws(()=>f.run(f.store,'goods.incident-note',{id:f.o.id,incidentId:'GI-fixture',version:1,reason:'越权'}),/无权/);
});
test('goods incident keeps original task filters on return after completion and rejects another source',()=>{
  const f=fixture(),t=incidentTask(f,f.support),a=f.support;
  const list='/group/tasks?category=goods-exception&status=open&q=G-fixture&owner=mine&store=xingfu';
  const context=createTaskReturnContext(f.s,a,{taskKey:t.id,listHash:list,task:t,token:'goods-exception-token'});
  f.o.incidents[0].status='done';
  assert.equal(taskReturnTarget(f.s,a,context,'/group/goods/G-fixture'),list);
  assert.equal(taskReturnTarget(f.s,a,context,'/group/goods/another'),null);
  assert.equal(taskReturnTarget(f.s,f.other,context,'/store/goods/G-fixture'),null);
  f.o.incidents=[];assert.equal(taskReturnTarget(f.s,a,context,'/group/goods/G-fixture'),null);
});
test('natural goods exception has group ownership with no promotion-store disclosure',()=>{
  const f=fixture();f.o.source=null;assert.ok(incidentTask(f,f.support));assert.equal(incidentTask(f,f.store),undefined);
});

test('approved line cancellation leaves remaining shipment open while its original refund is pending',()=>{
  const f=fixture();f.o.status='paid';delete f.o.shipment;
  f.o.lines=[{skuId:'oil',qty:2,cancelledQty:0},{skuId:'care',qty:1,cancelledQty:0}];
  const c={id:'AS-line',kind:'cancel',status:'requested',version:0,allocations:[{skuId:'care',qty:1,amountCents:10000}]};f.o.cases.push(c);
  const shipping=()=>goodsTaskRows(f.s).find(t=>t.category==='goods-shipping');
  assert.equal(shipping().status,'waiting');
  c.status='refund_ready';f.o.lines[1].cancelledQty=1;
  assert.equal(shipping().status,'open');
  assert.equal(goodsTaskRows(f.s).find(t=>t.sourceId===c.id).statusLabel,'待执行退款');
  c.status='refund_failed';assert.equal(shipping().status,'open');
  f.o.shipment={tracking:'remaining-oil'};f.o.status='shipped';assert.equal(shipping().status,'done');
  assert.equal(goodsTaskRows(f.s).find(t=>t.sourceId===c.id).statusLabel,'退款失败，待重试');
});
