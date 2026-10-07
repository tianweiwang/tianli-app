import test from 'node:test';
import assert from 'node:assert/strict';
import {seed,reduce,goodsSummary,createLifecycleContext,money} from './engine.mjs';
import {lifecycleImpact} from './organization-lifecycle-projection.mjs';
import {lifecycleCompletionView} from './organization-lifecycle.mjs';
import {lifecycleHandoverCommands} from './organization-lifecycle-authority.mjs';
import {resolveAccountActor,canAccountReadSource,assertAccountCommand} from './staff-accounts.mjs';
import {staffView} from './staff.mjs';
import {goodsSettlementExitBlockers,goodsSettlementView} from './goods-settlement.mjs';

const user={role:'user',userId:'u1'},ops={role:'group',job:'operations'},warehouse={role:'group',job:'warehouse'};
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ui={esc,money,date:value=>value?new Date(value).toISOString():'—',query:new URLSearchParams(),link:(label,path,kind='')=>`<a href="#${esc(path)}" class="${esc(kind)}">${label}</a>`,button:(label,command,payload={},kind='')=>`<button type="button" data-command="${esc(command)}" data-payload="${esc(JSON.stringify(payload))}" class="${esc(kind)}">${label}</button>`,field:(label,name,value='',type='text',attrs='')=>`<label>${label}<input name="${esc(name)}" value="${esc(value)}" type="${esc(type)}" ${attrs}></label>`,select:(label,name,options,value)=>`<label>${label}<select name="${esc(name)}">${options.map(x=>`<option value="${esc(x.value)}"${String(x.value)===String(value)?' selected':''}>${esc(x.label)}</option>`).join('')}</select></label>`,tag:label=>`<span class="tag">${label}</span>`,empty:(title,detail='')=>`<section><h2>${title}</h2><p>${detail}</p></section>`};

// All positive goods, bills, grants, employment, handovers and final closure
// come from the actual reducer. Negative source corruption uses a clone only.
function harness(options={}){
  let state=seed(),sequence=0;
  const h={get s(){return state;},run(actor,type,payload={}){let result;state=reduce(state,actor,type,{requestId:'closed-goods-source-'+ ++sequence,reason:'隔离原商品承接来源回归',...payload},value=>result=value);return result;},enter(accountId,grantId){const raw=h.run(user,'account.enter',{accountId,grantId});return resolveAccountActor(state,raw);},account(id){return state.staffAccounts.find(x=>x.id===id);},goods(id){return state.goods.find(x=>x.id===id);},bill(id){return state.bills.find(x=>x.id===id);}};
  h.admin=h.enter('DEMO-ADMIN','DEMO-ADMIN-GRANT');
  h.members=['support','finance','store-finance'].map(job=>{
    let account=h.run(h.admin,'account.create',{name:'原商品承接'+job});
    account=h.run(h.admin,'account.employment',{id:account.id,version:account.version,employmentStatus:'active',reference:'CLOSED-GOODS-EMP-'+account.id,verifiedAt:state.now});
    account=h.run(h.admin,'account.grant',{id:account.id,version:account.version,job,...(job==='store-finance'?{storeId:'xingfu'}:{})});
    const grant=account.grants.at(-1);return {id:account.id,job,grantId:grant.id,actor:h.enter(account.id,grant.id)};
  });
  h.local=h.members.find(x=>x.job==='store-finance');h.finance=h.members.find(x=>x.job==='finance').actor;h.support=h.members.find(x=>x.job==='support').actor;
  h.create=(storeId='xingfu',paid=true)=>{
    h.run(user,'promotion.enter',{storeId});h.run(user,'cart.set',{skuId:'oil',qty:1});h.run(user,'goods.submit',{addressId:'AD1'});const id=state.goods.at(-1).id;
    if(paid){h.run(user,'goods.pay',{id,outcome:'success'});h.run(warehouse,'goods.ship',{id,carrier:'原演示物流',tracking:'CLOSED-GOODS-'+sequence});h.run(user,'goods.receive',{id});}
    return id;
  };
  h.refundOld=()=>{h.run(user,'goods.case',{id:h.oldId,kind:'refund',skuId:'oil',qty:1,amountCents:10000,reason:'本人原单继续退款'});const cid=h.goods(h.oldId).cases.at(-1).id;h.run(h.support,'goods.case-review',{id:h.oldId,caseId:cid,decision:'approve',reason:'核原商品退款'});h.run(h.finance,'goods.refund',{id:h.oldId,caseId:cid,outcome:'success'});return h.s.recoveries.find(x=>x.orderId===h.oldId);};
  h.oldId=h.create();h.foreignId=h.create('silver',false);
  h.run(user,'clock.advance',{minutes:10080});h.run(h.finance,'bill.create',{storeId:'xingfu'});h.billId=state.bills.at(-1).id;
  h.run(h.local.actor,'bill.confirm',{id:h.billId,version:h.bill(h.billId).version});h.run(h.finance,'bill.pay',{id:h.billId,outcome:'processing'});h.run(h.finance,'bill.query',{id:h.billId,outcome:'success'});
  if(options.offset){
    const debt=h.refundOld();h.previousBillId=h.billId;h.nextId=h.create();h.run(user,'clock.advance',{minutes:10080});h.run(h.finance,'bill.create',{storeId:'xingfu'});h.billId=state.bills.at(-1).id;
    h.run(h.finance,'bill.offset-propose',{id:h.billId,version:h.bill(h.billId).version,recoveryId:debt.id,amountCents:1000,reason:'后续原商品佣金冲抵真实旧债'});h.planId=state.goodsOffsetPlans.at(-1).id;
    h.run(h.local.actor,'bill.offset-confirm',{id:h.billId,planId:h.planId,version:state.goodsOffsetPlans.at(-1).version,decision:'accept',reason:'原本店核对真实债务及现金'});
    h.run(h.finance,'bill.offset-pay',{id:h.billId,planId:h.planId,version:state.goodsOffsetPlans.at(-1).version,outcome:'processing'});h.run(h.finance,'bill.offset-query',{id:h.billId,planId:h.planId,version:state.goodsOffsetPlans.at(-1).version,outcome:'success'});
  }
  if(options.split){
    h.splitAId=h.create();h.splitBId=h.create();h.run(user,'clock.advance',{minutes:10080});h.run(h.finance,'bill.create',{storeId:'xingfu'});h.parentBillId=state.bills.at(-1).id;
    h.run(h.local.actor,'bill.dispute-lines',{id:h.parentBillId,version:h.bill(h.parentBillId).version,orderIds:[h.splitAId],reason:'第一原单差异，第二原单明确正确'});
    h.run(h.finance,'bill.split',{id:h.parentBillId,version:h.bill(h.parentBillId).version,orderIds:[h.splitBId],reason:'真实无争议原单转子账'});h.billId=state.bills.at(-1).id;
    h.run(h.local.actor,'bill.confirm',{id:h.billId,version:h.bill(h.billId).version});h.run(h.finance,'bill.pay',{id:h.billId,outcome:'processing'});h.run(h.finance,'bill.query',{id:h.billId,outcome:'success'});
    h.run(h.finance,'bill.resolve',{id:h.parentBillId,reason:'原父账差异真实核查完毕'});h.run(h.local.actor,'bill.confirm',{id:h.parentBillId,version:h.bill(h.parentBillId).version});h.run(h.finance,'bill.pay',{id:h.parentBillId,outcome:'processing'});h.run(h.finance,'bill.query',{id:h.parentBillId,outcome:'success'});
  }
  const store=state.stores.find(x=>x.id==='xingfu');
  h.run(ops,'lifecycle.store-close-start',{storeId:store.id,version:store.version,sourceToken:lifecycleImpact(state,{storeId:store.id},{goodsSummary}).sourceToken,reference:'CLOSED-GOODS-CASE'});h.caseId=state.organizationLifecycleCases.at(-1).id;
  for(const member of h.members){const c=state.organizationLifecycleCases.find(x=>x.id===h.caseId),account=h.account(member.id),handover=h.run(h.admin,'account.handover',{caseId:c.id,caseVersion:c.version,accountId:member.id,accountVersion:account.version,grantId:member.grantId,storeId:'xingfu',allowedCommands:lifecycleHandoverCommands(member.job),reference:'CLOSED-GOODS-HANDOVER-'+member.job});h.run(member.actor,'account.handover-accept',{id:handover.id,version:handover.version,reference:'CLOSED-GOODS-SELF-'+member.job});}
  const completion=lifecycleCompletionView(state,h.caseId,createLifecycleContext());assert.equal(completion.canComplete,true,completion.blockers.map(x=>x.reason).join('；'));
  h.run(ops,'lifecycle.complete',{id:h.caseId,version:completion.version,sourceToken:completion.sourceToken});h.limited=h.enter(h.local.id,h.local.grantId);
  return h;
}

test('真实商品已付及三岗承接最终关店，重进限定会话保留原goods/bill读取',()=>{
  const h=harness(),o=h.goods(h.oldId),b=h.bill(h.billId),before=structuredClone(h.s);
  assert.equal(h.s.stores.find(x=>x.id==='xingfu').lifecycleStatus,'closed');assert.equal(h.limited.lifecyclePurpose,'lifecycle-settlement');assert.deepEqual(h.limited.originalGoodsIds,[o.id]);
  assert.equal(o.source.storeId,'xingfu');assert.equal(Object.hasOwn(o,'storeId'),false,'原生产者没有顶层归属别名');assert.equal(o.commissionPaidCents,2000);
  assert.equal(canAccountReadSource(h.s,h.limited,'goods',o),true,'原锁定source.storeId应识别本案原商品');
  assert.equal(canAccountReadSource(h.s,h.limited,'bill',b),true,'账单应沿每条原商品锁定source核验');
  assert.doesNotThrow(()=>assertAccountCommand(h.limited,'bill.confirm',{id:b.id,version:b.version},h.s),'只核原权限和来源；不代表已付账可重新确认');assert.deepEqual(h.s,before);
});

test('真实关店后的原已结账单独立getter与权限guard沿source授权，不重新付原款',()=>{
  const h=harness(),b=h.bill(h.billId),before=structuredClone(h.s);
  assert.equal(b.status,'paid');assert.equal(b.items.length,1);assert.equal(b.items[0].orderId,h.oldId);
  assert.equal(canAccountReadSource(h.s,h.limited,'bill',b),true,'原bill getter不能要求不存在的goods.storeId');
  assert.doesNotThrow(()=>assertAccountCommand(h.limited,'bill.confirm',{id:b.id,version:b.version,storeId:'silver'},h.s),'请求storeId不替代当前原账及原商品归属');
  assert.throws(()=>h.run(h.limited,'bill.confirm',{id:b.id,version:b.version}),/已经确认|不处于|不能|核对|状态/,'原已付状态仍拒绝再次确认');
  assert.deepEqual(h.s,before);
});

test('原商品顶层或请求storeId不替代下单source，跨店和重复原ID仍拒绝',()=>{
  const h=harness(),clone=structuredClone(h.s),owned=clone.goods.find(x=>x.id===h.oldId),foreign=clone.goods.find(x=>x.id===h.foreignId);
  owned.storeId='silver';assert.equal(canAccountReadSource(clone,h.limited,'goods',owned),true,'无来源含义的顶层字段不能改掉已锁定原店');
  assert.equal(canAccountReadSource(clone,h.limited,'bill',clone.bills.find(x=>x.id===h.billId)),true);
  foreign.storeId='xingfu';assert.equal(canAccountReadSource(clone,h.limited,'goods',{...foreign,storeId:'xingfu',source:{...foreign.source,storeId:'xingfu'}}),false,'请求对象伪造不能代替当前原row与本案ID');
  const mixed={...structuredClone(clone.bills.find(x=>x.id===h.billId)),id:'FOREIGN-MIXED-BILL',items:[{orderId:foreign.id,amountCents:2000}]};clone.bills.push(mixed);
  assert.equal(canAccountReadSource(clone,h.limited,'bill',mixed),false);assert.throws(()=>assertAccountCommand(h.limited,'bill.confirm',{id:mixed.id,version:mixed.version,storeId:'xingfu'},clone),/限定承接|原来源/);
  const changed=structuredClone(h.s),changedOwned=changed.goods.find(x=>x.id===h.oldId);changedOwned.storeId='xingfu';changedOwned.source.storeId='silver';
  assert.equal(canAccountReadSource(changed,h.limited,'goods',changedOwned),false);assert.equal(canAccountReadSource(changed,h.limited,'bill',changed.bills.find(x=>x.id===h.billId)),false,'当前锁定原源变化不能用顶层字段伪归属');
  changedOwned.source=null;assert.equal(canAccountReadSource(changed,h.limited,'goods',changedOwned),false,'缺锁定原源不能补认本店');
  clone.goods.push(structuredClone(owned));assert.equal(canAccountReadSource(clone,h.limited,'goods',owned),false);assert.equal(canAccountReadSource(clone,h.limited,'bill',clone.bills.find(x=>x.id===h.billId)),false,'重复真实ID不选择其中一个为授权来源');
});

test('限定工作页面从原源过滤商品和账单，不借本店字段看未冻结记录',()=>{
  const h=harness(),before=structuredClone(h.s);
  const goods=staffView(h.s,h.limited,['goods'],ui),bill=staffView(h.s,h.limited,['bills',h.billId],ui);
  assert.match(goods,new RegExp(h.oldId));assert.doesNotMatch(goods,new RegExp(h.foreignId));assert.match(bill,new RegExp(h.billId));assert.deepEqual(h.s,before);
  const clone=structuredClone(h.s),injected={...structuredClone(h.goods(h.foreignId)),id:'UNFROZEN-GOODS',source:{...h.goods(h.foreignId).source,storeId:'xingfu'},storeId:'xingfu',createdAt:clone.now+1};clone.goods.push(injected);
  clone.bills.push({...structuredClone(h.bill(h.billId)),id:'UNFROZEN-BILL',items:[{orderId:injected.id,amountCents:2000}]});
  assert.doesNotMatch(staffView(clone,h.limited,['goods'],ui),/UNFROZEN-GOODS/);assert.doesNotMatch(staffView(clone,h.limited,['bills'],ui),/UNFROZEN-BILL/);
  assert.match(staffView(clone,h.limited,['goods',injected.id],ui),/不存在|权限|无权/);assert.match(staffView(clone,h.limited,['bills','UNFROZEN-BILL'],ui),/不存在|权限|无权/);
});

test('已关闭店原用户后续真实退款仍走原财务，旧佣金付款与新追回可回读',()=>{
  const h=harness(),old=structuredClone(h.goods(h.oldId)),out=h.bill(h.billId).paymentId;
  const r=h.refundOld(),o=h.goods(h.oldId);assert.equal(o.payment.id,old.payment.id);assert.equal(h.bill(h.billId).paymentId,out);assert.equal(o.commissionPaidCents,2000);assert.equal(goodsSummary(h.s,o).commissionCents,1000);assert.equal(r.amountCents,1000);assert.equal(r.recoveredCents,0);assert.equal(r.storeId,'xingfu');
  assert.equal(canAccountReadSource(h.s,h.limited,'goods',o),true);assert.equal(canAccountReadSource(h.s,h.limited,'bill',h.bill(h.billId)),true);assert.match(staffView(h.s,h.limited,['recoveries'],ui),new RegExp(r.id));
  assert.equal(h.s.serviceFinanceEntries.length,0);assert.equal(h.s.techIncomeEntries.length,0);
  const receipt={id:r.id,amountCents:400,proof:'关店后原商品债务实际收到4元',requestId:'closed-goods-original-cash-4'};h.run(h.finance,'recovery.receive',receipt);h.run(h.finance,'recovery.receive',receipt);
  h.run(h.finance,'recovery.receive',{id:r.id,amountCents:600,proof:'关店后原商品债务实际收到6元',requestId:'closed-goods-original-cash-6'});
  const cleared=h.s.recoveries.find(x=>x.id===r.id);assert.equal(cleared.recoveredCents,1000);assert.equal(cleared.records.length,2);assert.equal(cleared.status,'closed');assert.equal(h.goods(h.oldId).commissionPaidCents,2000);assert.equal(h.bill(h.billId).paymentId,out);assert.equal(h.s.stores.find(x=>x.id==='xingfu').lifecycleStatus,'closed');assert.equal(canAccountReadSource(h.s,h.limited,'goods-recovery',cleared),true);
});

test('原案商品关店后新追回合法可读，跨店未冻结或伪造追回详情不能漏出',()=>{
  const h=harness(),r=h.refundOld(),before=structuredClone(h.s);
  assert.equal(canAccountReadSource(h.s,h.limited,'goods-recovery',r),true,'晚生成RC沿旧原商品授权，不要求RC早于责任时点');assert.match(staffView(h.s,h.limited,['recoveries'],ui),new RegExp(r.id));assert.deepEqual(h.s,before);
  const clone=structuredClone(h.s),future={...structuredClone(h.goods(h.foreignId)),id:'RC-UNFROZEN-GOODS',source:{...h.goods(h.foreignId).source,storeId:'xingfu'},storeId:'xingfu',createdAt:clone.now+1};clone.goods.push(future);
  const records=[{id:'RC-FOREIGN',orderId:h.foreignId},{id:'RC-UNFROZEN',orderId:future.id},{id:'RC-NO-GOODS',orderId:'MISSING-ORIGINAL-GOODS'}].map(x=>({...structuredClone(r),...x,storeId:'xingfu',records:[{kind:'cash',amountCents:1,proof:'HIDDEN-PROOF-'+x.id,at:clone.now}]}));clone.recoveries.push(...records);
  for(const row of records){assert.equal(canAccountReadSource(clone,h.limited,'goods-recovery',{...row,orderId:h.oldId,storeId:'xingfu'}),false,'请求orderId/storeId不能替换当前追回原源');}
  const page=staffView(clone,h.limited,['recoveries'],ui);for(const row of records){assert.doesNotMatch(page,new RegExp(row.id),'列表/退出摘要/折叠详情均不能展示未授权原RC');assert.doesNotMatch(page,new RegExp(row.records[0].proof));}
  const missing=structuredClone(h.s);delete missing.recoveries[0].orderId;assert.equal(canAccountReadSource(missing,h.limited,'goods-recovery',r),false,'旧缺原关联保留待核查，不能凭storeId推断');
  clone.recoveries.push(structuredClone(r));assert.equal(canAccountReadSource(clone,h.limited,'goods-recovery',r),false,'重复追回ID不能择一读取');
});

test('退出读摘要隐藏跨店未冻结bill/plan编号金额，全店实际退出阻断保持',()=>{
  const h=harness(),r=h.refundOld(),clone=structuredClone(h.s);
  const hiddenBill={...structuredClone(h.bill(h.billId)),id:'HIDDEN-C05-BILL',storeId:'xingfu',status:'review',amountCents:98765,items:[{orderId:h.foreignId,amountCents:98765}]};
  const hiddenPlan={id:'HIDDEN-C05-PLAN',storeId:'xingfu',billId:hiddenBill.id,status:'confirmed',version:1,grossCents:98765,cashCents:87654,offsetCents:11111,items:structuredClone(hiddenBill.items),allocations:[{recoveryId:'MISSING-C05-PLAN-DEBT',amountCents:11111}],history:[]};
  clone.bills.push(hiddenBill);clone.goodsOffsetPlans.push(hiddenPlan);
  assert.equal(canAccountReadSource(clone,h.limited,'bill',hiddenBill),false);assert.equal(canAccountReadSource(clone,h.limited,'bill',clone.bills.find(x=>x.id===h.billId)),true);assert.equal(canAccountReadSource(clone,h.limited,'goods-recovery',clone.recoveries.find(x=>x.id===r.id)),true);
  const before=structuredClone(clone),page=staffView(clone,h.limited,['recoveries'],ui);assert.match(page,new RegExp(r.id));
  for(const hidden of [hiddenBill.id,hiddenPlan.id,'987.65','876.54','111.11'])assert.equal(page.includes(hidden),false,'读摘要不返回隐藏账单/方案编号或金额：'+hidden);
  assert.match(staffView(clone,h.limited,['bills',h.billId],ui),new RegExp(h.billId));assert.match(staffView(clone,h.limited,['bills',hiddenBill.id],ui),/不存在|权限|无权/);
  const exit=goodsSettlementExitBlockers(clone,'xingfu');assert.ok(exit.bills.some(x=>x.id===hiddenBill.id));assert.ok(exit.plans.some(x=>x.id===hiddenPlan.id));assert.ok(exit.debts.some(x=>x.id===r.id));assert.match(page,/本案授权范围|完整退出条件由集团核对/);assert.deepEqual(clone,before,'原纯读不移除真正退出阻断或原来源');
});

test('真实混合抵扣成功再关店，同源plan可读，外源items/RC/串账/重复plan均拒绝',()=>{
  const h=harness({offset:true}),plan=h.s.goodsOffsetPlans.find(x=>x.id===h.planId),before=structuredClone(h.s);
  assert.equal(plan.status,'succeeded');assert.equal(plan.grossCents,2000);assert.equal(plan.cashCents,1000);assert.equal(plan.offsetCents,1000);assert.equal(canAccountReadSource(h.s,h.limited,'goods-offset',plan),true);
  assert.doesNotThrow(()=>assertAccountCommand(h.limited,'bill.offset-confirm',{id:h.billId,planId:plan.id,version:plan.version},h.s));
  assert.throws(()=>h.run(h.limited,'bill.offset-confirm',{id:h.billId,planId:plan.id,version:plan.version,decision:'accept'}),/已经|状态|变化|不能|等待本店确认/,'来源通过仍不重办已成功方案');
  assert.throws(()=>assertAccountCommand(h.limited,'bill.offset-confirm',{id:h.previousBillId,planId:plan.id,version:plan.version},h.s),/限定承接|原来源/,'同本案另一合法账也不能串该方案');
  assert.deepEqual(goodsSettlementView(h.s,h.limited,h.billId,{goodsSummary}).plans.map(x=>x.id),[plan.id]);assert.match(staffView(h.s,h.limited,['bills',h.billId],ui),new RegExp(plan.id));assert.deepEqual(h.s,before);
  const clone=structuredClone(h.s),foreignRC={...structuredClone(h.s.recoveries[0]),id:'HIDDEN-C05-OFFSET-RC',storeId:'xingfu',orderId:h.foreignId};clone.recoveries.push(foreignRC);
  const hiddenPlans=[{id:'HIDDEN-C05-ITEMS',items:[{orderId:h.foreignId,amountCents:98765}]},{id:'HIDDEN-C05-RC',allocations:[{recoveryId:foreignRC.id,amountCents:11111}]}].map(x=>({...structuredClone(plan),...x,billId:h.billId,grossCents:98765,cashCents:87654,offsetCents:11111,reason:'HIDDEN-C05-PLAN-REASON'}));clone.goodsOffsetPlans.push(...hiddenPlans);
  for(const p of hiddenPlans){assert.equal(canAccountReadSource(clone,h.limited,'goods-offset',p),false);assert.throws(()=>assertAccountCommand(h.limited,'bill.offset-confirm',{id:h.billId,planId:p.id,version:p.version},clone),/限定承接|原来源/);}
  const view=goodsSettlementView(clone,h.limited,h.billId,{goodsSummary}),page=staffView(clone,h.limited,['bills',h.billId],ui);assert.deepEqual(view.plans.map(x=>x.id),[plan.id]);assert.match(page,new RegExp(plan.id));
  for(const hidden of [...hiddenPlans.map(x=>x.id),foreignRC.id,'HIDDEN-C05-PLAN-REASON','987.65','876.54','111.11'])assert.equal(page.includes(hidden),false,'原账抵扣panel不返回隐藏方案/债务或金额：'+hidden);
  clone.goodsOffsetPlans.push(structuredClone(plan));assert.equal(canAccountReadSource(clone,h.limited,'goods-offset',plan),false);assert.throws(()=>assertAccountCommand(h.limited,'bill.offset-confirm',{id:h.billId,planId:plan.id,version:plan.version},clone),/限定承接|原来源/);
});

test('旧账parent/child/差异引用分别核原范围，不输出无权账单编号或链接',()=>{
  const h=harness({split:true}),foreign={...structuredClone(h.bill(h.billId)),id:'HIDDEN-C05-RELATED-BILL',storeId:'xingfu',items:[{orderId:h.foreignId,amountCents:98765}],amountCents:98765};
  assert.equal(h.bill(h.billId).parentBillId,h.parentBillId);assert.ok(h.bill(h.parentBillId).childBillIds.includes(h.billId));assert.equal(h.bill(h.billId).disputeReference.billId,h.parentBillId);
  const frozenReference=structuredClone(h.bill(h.billId).disputeReference);assert.equal(frozenReference.status,'open');assert.equal(h.bill(h.parentBillId).dispute.status,'resolved');assert.equal(h.bill(h.parentBillId).status,'paid');
  const childPage=staffView(h.s,h.limited,['bills',h.billId],ui);assert.match(childPage,new RegExp(h.parentBillId));assert.match(childPage,/差异已核查/);assert.doesNotMatch(childPage,/差异继续在原账处理/);assert.match(staffView(h.s,h.limited,['bills',h.parentBillId],ui),new RegExp(h.billId));
  const projectedReference=goodsSettlementView(h.s,h.limited,h.billId,{goodsSummary}).bills[0].disputeReference;assert.equal(projectedReference.status,'open','原冻结拆分时状态仍保留');assert.equal(projectedReference.currentStatus,'resolved','当前授权父账实际状态单独投影');assert.deepEqual(h.bill(h.billId).disputeReference,frozenReference);assert.equal(Object.hasOwn(h.bill(h.billId).disputeReference,'currentStatus'),false,'纯读取不回写当前状态到原snapshot');
  for(const patch of [{parentBillId:foreign.id},{childBillIds:[foreign.id]},{disputeReference:{billId:foreign.id,status:'open'}}]){
    const clone=structuredClone(h.s);clone.bills.push(structuredClone(foreign));Object.assign(clone.bills.find(x=>x.id===h.billId),patch);const before=structuredClone(clone);
    assert.equal(canAccountReadSource(clone,h.limited,'bill',foreign),false);assert.equal(canAccountReadSource(clone,h.limited,'bill',clone.bills.find(x=>x.id===h.billId)),true);
    const page=staffView(clone,h.limited,['bills',h.billId],ui);assert.match(page,new RegExp(h.billId));assert.equal(page.includes(foreign.id),false,'相关账单元数据也须原源授权：'+Object.keys(patch)[0]);assert.equal(staffView(clone,h.limited,['bills'],ui).includes(foreign.id),false,'原账单列表也不能直接输出无权parent编号');assert.equal(JSON.stringify(goodsSettlementView(clone,h.limited,h.billId,{goodsSummary})).includes(foreign.id),false,'原读取投影不返回无权相关元数据');assert.deepEqual(clone,before);
  }
});

test('关店前工作会话与当前撤权均失效，旧原权利不授权伪raw actor',()=>{
  const h=harness(),o=h.goods(h.oldId),b=h.bill(h.billId);
  assert.throws(()=>resolveAccountActor(h.s,h.local.actor),/失效/);assert.equal(canAccountReadSource(h.s,h.local.actor,'goods',o),false);
  assert.equal(canAccountReadSource(h.s,{role:'store',storeId:'xingfu',lifecyclePurpose:'lifecycle-settlement',originalGoodsIds:[o.id]},'goods',o),false);
  const actor=h.limited;assert.equal(canAccountReadSource(h.s,{...actor,role:'group',job:'finance',storeId:'silver'},'goods',o),true,'当前原会话恢复唯一真实岗位和来源');
  const account=h.account(h.local.id);h.run(h.admin,'account.revoke',{id:account.id,version:account.version,grantId:h.local.grantId});
  assert.equal(canAccountReadSource(h.s,actor,'goods',o),false);assert.equal(canAccountReadSource(h.s,actor,'bill',b),false);assert.throws(()=>assertAccountCommand(actor,'bill.dispute',{id:b.id,version:b.version,storeId:'xingfu'},h.s),/失效/);
});
