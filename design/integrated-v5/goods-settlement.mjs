// Goods commission settlement uses the original order/bill/recovery ledgers.
import { actorAccountFields, resolveAccountActor, canAccountView, canAccountReadSource } from './staff-accounts.mjs';
const TYPES = new Set(['bill.dispute-lines','bill.split','bill.offset-propose','bill.offset-confirm','bill.offset-cancel','bill.offset-pay','bill.offset-query']);
const ACTIVE = new Set(['proposed','confirmed','processing','failed']);
const UNEXECUTED = new Set(['review','adjusted','disputed','confirmed','failed']);
const clone = value => structuredClone(value);
const sum = (rows,get) => rows.reduce((n,row)=>n+get(row),0);
const canonical = v => Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const fingerprint = v => JSON.stringify(canonical(v));
const by = a => ({role:a.role,id:a.role==='group'?'group':a.storeId,job:a.role==='group'?a.job||'all':a.job||null,...actorAccountFields(a)});
const finance = a => a.role==='group'&&(!a.job||['all','finance'].includes(a.job));
const ownStore = (a,b) => ['store','manager'].includes(a.role)&&a.storeId===b.storeId&&(!a.sessionId||a.job==='store-finance');
function fail(ctx,message) { if(ctx?.fail)ctx.fail(message);throw new Error(message); }
function text(value,label,ctx) { if(typeof value!=='string'||!value.trim()||value.trim().length>1000)fail(ctx,`请填写${label}（最多1000字）。`);return value.trim(); }
function integer(value,label,ctx,min=0) { if(!['string','number'].includes(typeof value)||!String(value).trim()||!Number.isSafeInteger(Number(value))||Number(value)<min)fail(ctx,`请填写有效的${label}。`);return Number(value); }
function version(value,row,ctx) { if(!['string','number'].includes(typeof value)||!String(value).trim()||!Number.isSafeInteger(Number(value))||Number(value)!==row.version)fail(ctx,'账单或方案已更新，请刷新核对当前版本。'); }
function nextId(s,ctx,prefix) { return ctx.id?ctx.id(prefix):`${prefix}${s.seq=(s.seq||0)+1}`; }
function ids(value,ctx) { const list=Array.isArray(value)?value:String(value||'').split(/[，,\s]+/).filter(Boolean);if(!list.length||list.some(x=>typeof x!=='string'||!x.trim())||new Set(list).size!==list.length)fail(ctx,'请选择不重复的商品订单明细。');return list.map(x=>x.trim()); }
function request(s,a,type,p,ctx) { const requestId=text(p.requestId,'本次提交标识',ctx),actor=fingerprint(by(a)),signature=fingerprint({type,p});const old=s.goodsSettlementRequests.find(x=>x.requestId===requestId&&x.actor===actor);if(old&&old.signature!==signature)fail(ctx,'同一提交标识不能用于不同操作或内容。');return{requestId,actor,signature,old}; }
function remember(s,r,result) { s.goodsSettlementRequests.push({requestId:r.requestId,actor:r.actor,signature:r.signature,id:result.id}); }
function audit(s,b,a,action,ctx,detail={}) { b.version++;(b.settlementHistory??=[]).push({at:s.now,by:by(a),action,version:b.version,...clone(detail)});ctx.log?.(b,action); }
function planAudit(s,plan,a,action,ctx,detail={}) { plan.version++;(plan.history??=[]).push({at:s.now,by:by(a),action,version:plan.version,...clone(detail)}); }
function summary(s,o,ctx) { if(typeof ctx?.goodsSummary!=='function')fail(ctx,'商品原计佣来源尚未接线。');return ctx.goodsSummary(s,o); }
function eligible(s,o,ctx) { if(!o)return false;if(typeof ctx?.eligible==='function')return ctx.eligible(o);const row=summary(s,o,ctx);return o.payment?.status==='success'&&!row.commissionReason; }
const outstanding = r => Math.max(0,Number(r.amountCents||0)-Number(r.recoveredCents||0));
function reserved(s,recoveryId,exclude) { return sum((s.goodsOffsetPlans||[]).filter(p=>p.id!==exclude&&ACTIVE.has(p.status)),p=>sum(p.allocations.filter(a=>a.recoveryId===recoveryId),a=>a.amountCents)); }
function activePlan(s,b) { return (s.goodsOffsetPlans||[]).find(p=>p.id===b.activeOffsetPlanId&&ACTIVE.has(p.status)); }
function source(s,b,ctx) { return fingerprint({amountCents:b.amountCents,dispute:b.dispute?.status==='open'?b.dispute:null,items:b.items.map(line=>{const o=(s.goods||[]).find(o=>o.id===line.orderId);const value=o?summary(s,o,ctx):null;return{orderId:line.orderId,amountCents:line.amountCents,commissionPaidCents:o?.commissionPaidCents,commissionCents:value?.commissionCents,eligible:eligible(s,o,ctx)};})}); }
function assertCurrentBill(s,b,ctx) {
  if(!b.items?.length||b.dispute?.status==='open'||b.status==='disputed')fail(ctx,'账单仍有差异，须先处理或拆出无争议明细。');
  if(b.amountCents!==sum(b.items,x=>x.amountCents)||b.amountCents<=0)fail(ctx,'当前账单没有有效可结金额。');
  for(const line of b.items) { const o=(s.goods||[]).find(o=>o.id===line.orderId);if(!o||o.source?.storeId!==b.storeId||!eligible(s,o,ctx)||line.amountCents!==Math.max(0,summary(s,o,ctx).commissionCents-o.commissionPaidCents))fail(ctx,'关联商品佣金或售后状态已变化，请按原账重新核对。'); }
}
function allocations(p,ctx) {
  const raw=Array.isArray(p.allocations)?p.allocations:p.recoveryId?[{recoveryId:p.recoveryId,amountCents:p.amountCents}]:[];
  if(!raw.length)fail(ctx,'请选择实际追回单及本次抵扣金额。');
  const rows=raw.map(x=>({recoveryId:text(x.recoveryId,'商品追回单',ctx),amountCents:integer(x.amountCents,'抵扣金额',ctx,1)}));if(new Set(rows.map(x=>x.recoveryId)).size!==rows.length)fail(ctx,'同一追回单不能重复列入方案。');return rows;
}
function knownDebt(s,b,a,ctx) {
  const r=(s.recoveries||[]).find(r=>r.id===a.recoveryId),o=(s.goods||[]).find(o=>o.id===r?.orderId);
  if(!r||!o||r.storeId!==b.storeId||o.source?.storeId!==b.storeId)fail(ctx,'抵扣只支持本店商品佣金追回，不得跨店或抵扣服务款。');
  if(Math.max(0,o.commissionPaidCents-summary(s,o,ctx).commissionCents)<r.amountCents||!r.amountCents)fail(ctx,'追回债务缺少已付商品佣金及成功退款依据。');return r;
}
function debtSource(s,p) { return fingerprint(p.allocations.map(a=>{const r=(s.recoveries||[]).find(r=>r.id===a.recoveryId);return{id:r?.id,amountCents:r?.amountCents,recoveredCents:r?.recoveredCents};})); }
function retirePlan(s,b,p,status,reason,ctx,a={role:'group',job:'all'}) {
  p.status=status;p.completedAt=s.now;p.completionReason=reason;planAudit(s,p,a,reason,ctx);b.activeOffsetPlanId=null;
  if(b.status!=='disputed'&&b.dispute?.status!=='open')b.status=b.status==='adjusted'?'adjusted':'review';
  if(p.execution?.attempts) { (b.paymentHistory??=[]).push({paymentId:p.paymentId,amountCents:p.cashCents,status:p.execution.status,attempts:p.execution.attempts,planId:p.id});b.paymentId=nextId(s,ctx,'OUT');b.attempts=0; }
  audit(s,b,a,reason,ctx,{planId:p.id});
}

export function upgradeGoodsSettlement(s) { s.goodsOffsetPlans??=[];s.goodsSettlementRequests??=[];for(const b of s.bills||[]){b.childBillIds??=[];b.splitHistory??=[];b.settlementHistory??=[];}for(const r of s.recoveries||[])if(!Number.isSafeInteger(r.version))r.version=0;return s; }

export function syncGoodsSettlement(s,ctx) {
  upgradeGoodsSettlement(s);
  for(const p of s.goodsOffsetPlans.filter(p=>['proposed','confirmed','failed'].includes(p.status))) {
    const b=(s.bills||[]).find(b=>b.id===p.billId);
    if(!b)continue;
    const stale=source(s,b,ctx)!==p.billSource||debtSource(s,p)!==p.debtSource||p.allocations.some(a=>{const r=(s.recoveries||[]).find(r=>r.id===a.recoveryId);return!r||r.storeId!==p.storeId||outstanding(r)<a.amountCents+reserved(s,r.id,p.id);});
    if(stale)retirePlan(s,b,p,'invalidated','商品佣金或债务来源已变化，抵扣方案须重新核对',ctx);
  }
  return s;
}

export function assertGoodsSettlementCommand(s,actor,type,p,ctx) {
  if(['bill.confirm','bill.dispute','bill.resolve','bill.pay','bill.query'].includes(type)) {
    const b=(s.bills||[]).find(b=>b.id===p.id),plan=b&&activePlan(s,b);
    if(plan)fail(ctx,'该账单有有效抵扣方案，请从方案核对、撤销或查询原笔执行，不能绕过。');
  }
  if(type==='recovery.receive') {
    const r=(s.recoveries||[]).find(r=>r.id===p.id);
    if(p.requestId&&(s.recoveries||[]).some(x=>(x.records||[]).some(r=>r.requestId===p.requestId)))return;
    const held=r?reserved(s,r.id):0;
    if(r&&held>0&&Number(p.amountCents)>outstanding(r)-held)fail(ctx,'追回额度已被商品抵扣方案占用；付款未知须先核查，不能重复清偿。');
  }
}

export function goodsSettlementExitBlockers(s,storeId) {
  return clone({storeId,bills:(s.bills||[]).filter(b=>b.storeId===storeId&&(b.status!=='paid'||b.dispute?.status==='open')).map(b=>({id:b.id,status:b.status,amountCents:b.amountCents})),debts:(s.recoveries||[]).filter(r=>r.storeId===storeId&&outstanding(r)>0).map(r=>({id:r.id,orderId:r.orderId,outstandingCents:outstanding(r),reservedCents:reserved(s,r.id)})),plans:(s.goodsOffsetPlans||[]).filter(p=>p.storeId===storeId&&ACTIVE.has(p.status)).map(p=>({id:p.id,status:p.status,cashCents:p.cashCents,offsetCents:p.offsetCents}))});
}

export function goodsSettlementTaskRows(s) {
  const rows=[];
  const base=(storeId,sourceId,createdAt,route,billId=null)=>({storeId,sourceId,createdAt,dueAt:null,requiredRoute:route,assignmentMode:'task',allowedJobs:{group:['finance'],store:['store-finance']},routes:{group:`/group/${route}${billId?`/${encodeURIComponent(billId)}`:''}`,store:`/store/${route}${billId?`/${encodeURIComponent(billId)}`:''}`}});
  for(const b of s.bills||[]) {
    const plan=activePlan(s,b),unresolved=b.dispute?.status==='open'||b.status==='disputed',done=b.status==='paid'&&!unresolved;
    const local=['review','adjusted'].includes(b.status)&&!unresolved;
    const status=done?'done':plan?'waiting':'open';
    const statusLabel=done?'商品佣金已结清':plan?'从抵扣方案核对或查询':unresolved?'待集团核查差异':local?'待本店核对':b.status==='processing'?'现金付款未知，待原笔查询':b.status==='failed'?'现金付款失败，待原笔重试':'待集团财务执行';
    rows.push({...base(b.storeId,b.id,b.createdAt,'bills',b.id),id:`goods-bill:${b.id}:settlement`,category:'goods-settlement-bill',title:'商品佣金账单',status,statusLabel,manageRoles:done||plan?[]:local?['store']:['group'],commands:done||plan?[]:unresolved?['bill.resolve','bill.split']:local?['bill.confirm','bill.dispute-lines']:b.status==='processing'?['bill.query']:['bill.pay','bill.offset-propose'],sourceToken:fingerprint([b.version,b.status,b.amountCents,b.dispute?.status,b.dispute?.orderIds,b.activeOffsetPlanId,b.paymentId,b.attempts])});
  }
  for(const p of s.goodsOffsetPlans||[]) {
    const done=!ACTIVE.has(p.status),local=p.status==='proposed';
    const statusLabel={proposed:'待本店确认抵扣及现金方案',confirmed:'待集团执行已确认方案',processing:'现金未知，待原笔查询；尚未冲债',failed:'现金失败，待原笔重试；尚未冲债',succeeded:'现金及商品债务冲抵已入账',rejected:'本店已驳回方案',cancelled:'方案已撤销',invalidated:'原结算依据变化，方案已失效'}[p.status]||'待核查商品抵扣方案';
    rows.push({...base(p.storeId,p.id,p.createdAt,'bills',p.billId),id:`goods-offset:${p.id}:handling`,category:'goods-settlement-offset',title:'商品佣金抵扣方案',billId:p.billId,status:done?'done':'open',statusLabel,manageRoles:done?[]:local?['store']:['group'],commands:done?[]:local?['bill.offset-confirm']:p.status==='processing'?['bill.offset-query']:['bill.offset-pay','bill.offset-cancel'],sourceToken:fingerprint([p.version,p.status,p.billId,p.grossCents,p.offsetCents,p.cashCents,p.paymentId,p.execution?.status,p.execution?.attempts])});
  }
  for(const r of s.recoveries||[]) {
    const balance=outstanding(r),held=reserved(s,r.id),waiting=balance>0&&balance<=held;
    rows.push({...base(r.storeId,r.id,r.createdAt,'recoveries'),id:`goods-recovery:${r.id}:settlement`,category:'goods-settlement-recovery',title:'已付商品佣金追回',orderId:r.orderId,status:balance?waiting?'waiting':'open':'done',statusLabel:!balance?'商品债务已清偿':waiting?'债务被有效抵扣方案占用，等待原方案结果':'待登记商品现金回款或协商后续佣金抵扣',manageRoles:!balance||waiting?[]:['group'],commands:balance&&!waiting?['recovery.receive']:[],sourceToken:fingerprint([r.version,r.status,r.amountCents,r.recoveredCents,held])});
  }
  return rows;
}

export function goodsSettlementView(s,actor,billId,ctx={}) {
  actor=resolveAccountActor(s,actor);
  const allowed=finance(actor)&&canAccountView(actor,'bills')||['store','manager'].includes(actor.role)&&canAccountView(actor,'bills');
  if(!allowed)return{bills:[],plans:[],recoveries:[]};
  const bills=(s.bills||[]).filter(b=>(!billId||b.id===billId)&&(finance(actor)||b.storeId===actor.storeId)&&canAccountReadSource(s,actor,'bill',b));
  const stores=new Set(bills.map(b=>b.storeId));
  const readableBill=id=>{const matches=(s.bills||[]).filter(b=>b.id===id);return matches.length===1&&(finance(actor)||matches[0].storeId===actor.storeId)&&canAccountReadSource(s,actor,'bill',matches[0]);};
  return clone({bills:bills.map(b=>({...b,parentBillId:readableBill(b.parentBillId)?b.parentBillId:null,childBillIds:(b.childBillIds||[]).filter(readableBill),disputeReference:b.disputeReference&&readableBill(b.disputeReference.billId)?{...b.disputeReference,currentStatus:(s.bills||[]).find(x=>x.id===b.disputeReference.billId).dispute?.status||null}:null,splitCandidates:b.items.filter(line=>line.amountCents>0&&!(b.dispute?.status==='open'&&b.dispute.orderIds?.includes(line.orderId))&&(!b.dispute||b.dispute.status!=='open'||Array.isArray(b.dispute.orderIds))&&eligible(s,(s.goods||[]).find(o=>o.id===line.orderId),ctx)).map(x=>x.orderId)})),plans:(s.goodsOffsetPlans||[]).filter(p=>stores.has(p.storeId)&&(!billId||p.billId===billId)&&canAccountReadSource(s,actor,'goods-offset',p)),recoveries:(s.recoveries||[]).filter(r=>stores.has(r.storeId)&&canAccountReadSource(s,actor,'goods-recovery',r)).map(r=>({...r,outstandingCents:outstanding(r),reservedCents:reserved(s,r.id),availableCents:Math.max(0,outstanding(r)-reserved(s,r.id))}))});
}

function settle(s,b,plan,a,ctx) {
  if(plan.status==='succeeded')return;
  for(const item of plan.items) { const o=(s.goods||[]).find(o=>o.id===item.orderId);if(!o||o.source?.storeId!==plan.storeId)fail(ctx,'原商品佣金来源缺失，须核查原交易。'); }
  for(const allocation of plan.allocations) { const r=(s.recoveries||[]).find(r=>r.id===allocation.recoveryId);if(!r||r.storeId!==plan.storeId||outstanding(r)<allocation.amountCents)fail(ctx,'原商品债务余额已变化，须核查实际清偿。'); }
  for(const allocation of plan.allocations) {
    const r=s.recoveries.find(r=>r.id===allocation.recoveryId);r.recoveredCents+=allocation.amountCents;r.version++;r.status=outstanding(r)?'open':'closed';
    (r.records??=[]).push({kind:'offset',planId:plan.id,billId:b.id,paymentId:plan.paymentId,amountCents:allocation.amountCents,at:s.now,by:by(a),proof:`本店确认商品佣金抵扣 ${plan.id}`,requestId:`offset:${plan.id}:${r.id}`});ctx.log?.(r,`商品佣金实际抵扣 ${allocation.amountCents} 分 · ${plan.id}`);
  }
  for(const item of plan.items) { const o=s.goods.find(o=>o.id===item.orderId);o.commissionPaidCents+=item.amountCents;(o.goodsCommissionSettlements??=[]).push({billId:b.id,planId:plan.id,amountCents:item.amountCents,at:s.now});ctx.reconcileDebt?.(o); }
  plan.status='succeeded';plan.completedAt=s.now;plan.execution.status='success';plan.execution.completedAt=s.now;b.status='paid';b.paidAt=s.now;b.grossSettledCents=plan.grossCents;b.offsetSettledCents=plan.offsetCents;b.cashPaidCents=plan.cashCents;b.activeOffsetPlanId=null;
  b.cashPayment={id:plan.paymentId,amountCents:plan.cashCents,status:plan.cashCents?'success':'not-required',attempts:plan.cashCents?plan.execution.attempts:0,at:s.now,planId:plan.id};
  planAudit(s,plan,a,plan.cashCents?'现金结果已确认，商品抵扣与结佣实际入账':'无需现金付款，商品抵扣与结佣实际入账',ctx);audit(s,b,a,`商品结佣 ${plan.grossCents} 分＝现金 ${plan.cashCents} 分＋抵扣 ${plan.offsetCents} 分`,ctx,{planId:plan.id,paymentId:plan.paymentId});
}

export function goodsSettlementCommand(s,actor,type,p={},ctx={}) {
  if(!TYPES.has(type))return undefined;
  actor=resolveAccountActor(s,actor);upgradeGoodsSettlement(s);
  const b=(s.bills||[]).find(b=>b.id===p.id);if(!b||!(finance(actor)||ownStore(actor,b)))fail(ctx,'商品佣金账单不存在或当前身份无权办理。');
  const local=['bill.dispute-lines','bill.offset-confirm'].includes(type);if(local?!ownStore(actor,b):!finance(actor))fail(ctx,local?'仅本店门店财务可以核对方案。':'仅集团财务可以执行商品结算。');
  const plan=p.planId?s.goodsOffsetPlans.find(x=>x.id===p.planId&&x.billId===b.id):null;
  if(['bill.offset-confirm','bill.offset-cancel','bill.offset-pay','bill.offset-query'].includes(type)&&!plan)fail(ctx,'抵扣方案不存在或不属于本账单。');
  const req=request(s,actor,type,p,ctx);if(req.old)return plan||s.goodsOffsetPlans.find(p=>p.id===req.old.id)||s.bills.find(b=>b.id===req.old.id)||b;
  version(p.version,plan||b,ctx);
  if(type==='bill.dispute-lines') {
    if(!UNEXECUTED.has(b.status)||activePlan(s,b))fail(ctx,'账单已执行或有有效抵扣方案，不能修改差异范围。');
    const orderIds=ids(p.orderIds,ctx);if(orderIds.some(id=>!b.items.some(x=>x.orderId===id)))fail(ctx,'差异明细必须属于当前账单。');
    if(b.dispute)(b.disputeHistory??=[]).push(clone(b.dispute));
    const reason=text(p.reason,'差异范围及核对依据',ctx);b.dispute={...(b.dispute||{}),status:'open',reason,orderIds,openedAt:b.dispute?.openedAt||s.now,openedVersion:b.dispute?.openedVersion||b.version,scopedAt:s.now,scopedBy:by(actor)};b.reason=reason;b.status='disputed';audit(s,b,actor,'本店明确商品佣金差异明细及无争议范围',ctx,{orderIds,reason});
  } else if(type==='bill.split') {
    if(!UNEXECUTED.has(b.status)||activePlan(s,b))fail(ctx,'已付款、付款未知或有效抵扣方案不能拆账。');
    const selected=ids(p.orderIds,ctx);if(selected.length>=b.items.length||selected.some(id=>!b.items.some(x=>x.orderId===id)))fail(ctx,'须选择本账部分明细，并在原账保留余项。');
    if(b.dispute?.status==='open'&&!Array.isArray(b.dispute.orderIds))fail(ctx,'原整单差异未明确范围，须由本店先确认有差异的明细。');
    if(selected.some(id=>b.dispute?.status==='open'&&b.dispute.orderIds.includes(id)))fail(ctx,'有差异的明细必须留在原账，不能作为无争议款拆出。');
    const items=b.items.filter(x=>selected.includes(x.orderId));for(const line of items){const o=(s.goods||[]).find(o=>o.id===line.orderId);if(!o||line.amountCents<=0||o.source?.storeId!==b.storeId||!eligible(s,o,ctx)||line.amountCents!==Math.max(0,summary(s,o,ctx).commissionCents-o.commissionPaidCents))fail(ctx,'所选明细存在售后、零佣金或佣金已变化，不能拆出付款。');}
    const reason=text(p.reason,'拆账依据',ctx),child={id:nextId(s,ctx,'BILL'),storeId:b.storeId,items:clone(items),amountCents:sum(items,x=>x.amountCents),status:'review',paymentId:nextId(s,ctx,'OUT'),attempts:0,version:1,events:[],createdAt:s.now,parentBillId:b.id,childBillIds:[],splitHistory:[],settlementHistory:[],splitReason:reason,disputeReference:b.dispute?{billId:b.id,status:b.dispute.status,openedVersion:b.dispute.openedVersion,openedAt:b.dispute.openedAt,reason:b.dispute.reason}:null};
    if(b.attempts){(b.paymentHistory??=[]).push({paymentId:b.paymentId,amountCents:b.amountCents,status:'failed',attempts:b.attempts,reason:'确定失败后拆账，旧付款快照保留'});b.paymentId=nextId(s,ctx,'OUT');b.attempts=0;}
    b.items=b.items.filter(x=>!selected.includes(x.orderId));b.amountCents=sum(b.items,x=>x.amountCents);b.childBillIds.push(child.id);b.splitHistory.push({childBillId:child.id,orderIds:selected,amountCents:child.amountCents,at:s.now,by:by(actor),reason});if(b.dispute?.status!=='open')b.status='review';s.bills.push(child);audit(s,b,actor,`无争议商品明细转入子账 ${child.id}`,ctx,{orderIds:selected,reason});ctx.log?.(child,`由原账 ${b.id} 拆出，本店须重新核对`);remember(s,req,child);return child;
  } else if(type==='bill.offset-propose') {
    if(!UNEXECUTED.has(b.status)||activePlan(s,b))fail(ctx,'账单已执行或存在有效抵扣方案，请先处理原方案。');assertCurrentBill(s,b,ctx);
    const rows=allocations(p,ctx);for(const item of rows){const r=knownDebt(s,b,item,ctx);if(item.amountCents>outstanding(r)-reserved(s,r.id))fail(ctx,'抵扣超过尚未清偿且未被其他方案占用的商品债务。');}
    const offsetCents=sum(rows,x=>x.amountCents);if(offsetCents>b.amountCents)fail(ctx,'抵扣金额不能超过本账可结商品佣金。');
    const newPlan={id:nextId(s,ctx,'GOF'),billId:b.id,storeId:b.storeId,version:0,status:'proposed',createdAt:s.now,by:by(actor),reason:text(p.reason,'抵扣方案依据',ctx),allocations:rows,items:clone(b.items),grossCents:b.amountCents,offsetCents,cashCents:b.amountCents-offsetCents,paymentId:nextId(s,ctx,'OUT'),history:[],billSource:source(s,b,ctx)};
    newPlan.debtSource=debtSource(s,newPlan);s.goodsOffsetPlans.push(newPlan);b.activeOffsetPlanId=newPlan.id;b.status='review';audit(s,b,actor,'集团提出商品佣金抵扣方案，等待本店确认',ctx,{planId:newPlan.id});remember(s,req,newPlan);return newPlan;
  } else if(type==='bill.offset-confirm') {
    if(plan.status!=='proposed'||activePlan(s,b)?.id!==plan.id)fail(ctx,'当前没有等待本店确认的方案。');
    if(!['accept','reject'].includes(p.decision))fail(ctx,'请选择同意或驳回抵扣方案。');
    const reason=text(p.reason,'本店确认意见',ctx);
    if(source(s,b,ctx)!==plan.billSource||debtSource(s,plan)!==plan.debtSource)fail(ctx,'佣金或债务来源已变化，请集团重新提出方案。');
    plan.confirmation={decision:p.decision,reason,at:s.now,by:by(actor)};
    if(p.decision==='reject')retirePlan(s,b,plan,'rejected','本店驳回商品抵扣方案',ctx,actor);else{plan.status='confirmed';b.status='confirmed';planAudit(s,plan,actor,'本店确认商品抵扣及现金付款金额',ctx,{reason});audit(s,b,actor,'本店确认商品抵扣方案',ctx,{planId:plan.id});}
  } else if(type==='bill.offset-cancel') {
    if(!['proposed','confirmed','failed'].includes(plan.status)||activePlan(s,b)?.id!==plan.id)fail(ctx,'付款未知或已完成的抵扣不能撤销，请查询原交易。');retirePlan(s,b,plan,'cancelled',text(p.reason,'撤销依据',ctx),ctx,actor);
  } else if(type==='bill.offset-pay') {
    if(!['confirmed','failed'].includes(plan.status)||activePlan(s,b)?.id!==plan.id)fail(ctx,'方案须本店确认；付款未知请查询原笔。');if(p.outcome!=='processing')fail(ctx,'请先明确发起执行，再查询最终结果。');assertCurrentBill(s,b,ctx);
    if(source(s,b,ctx)!==plan.billSource||debtSource(s,plan)!==plan.debtSource)fail(ctx,'源金额已变化，请重新核对方案。');
    if(!plan.execution)plan.execution={status:'processing',attempts:0,at:s.now};plan.execution.status='processing';plan.execution.attempts++;plan.status='processing';b.status='processing';
    if(b.paymentId!==plan.paymentId&&b.attempts)(b.paymentHistory??=[]).push({paymentId:b.paymentId,amountCents:b.amountCents,status:'failed',attempts:b.attempts});b.paymentId=plan.paymentId;b.attempts=plan.cashCents?plan.execution.attempts:0;
    if(plan.cashCents===0)settle(s,b,plan,actor,ctx);else{planAudit(s,plan,actor,'原笔现金付款已提交，结果未知，债务未冲抵',ctx);audit(s,b,actor,'抵扣方案现金付款待原笔查询，债务保持未清偿',ctx,{planId:plan.id,paymentId:plan.paymentId,cashCents:plan.cashCents});}
  } else if(type==='bill.offset-query') {
    if(plan.status==='succeeded'&&p.outcome==='success'){remember(s,req,plan);return plan;}
    if(plan.status!=='processing'||plan.execution?.status!=='processing'||b.status!=='processing')fail(ctx,'当前没有等待原笔查询的商品抵扣付款。');if(!['success','failed','processing'].includes(p.outcome))fail(ctx,'请选择有效现金付款查询结果。');
    if(p.outcome==='success')settle(s,b,plan,actor,ctx);
    else{plan.execution.status=p.outcome;plan.status=p.outcome==='failed'?'failed':'processing';b.status=p.outcome==='failed'?'failed':'processing';planAudit(s,plan,actor,p.outcome==='failed'?'原笔现金付款失败，抵扣未入账':'原笔现金付款仍未知，保留债务占用',ctx);audit(s,b,actor,p.outcome==='failed'?'现金付款失败，保留原方案及交易标识待重试':'现金付款仍处理中，抵扣未入账',ctx,{planId:plan.id});if(p.outcome==='failed')for(const item of b.items)ctx.adjustBills?.(s.goods.find(o=>o.id===item.orderId));}
  }
  const result=plan||b;remember(s,req,result);return result;
}
