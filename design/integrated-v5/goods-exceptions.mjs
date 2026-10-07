// Additional goods facts stay separate from the original refund and stock ledgers.
import { actorAccountFields, resolveAccountActor, canAccountView } from './staff-accounts.mjs';

export const GOODS_INCIDENT_STAGES = ['delivery', 'return', 'return-back'];
export const GOODS_INCIDENT_KINDS = ['delay', 'lost', 'damaged', 'not-returned', 'unclaimed', 'wrong-item', 'receipt-dispute'];
const TYPED_DELIVERY = new Set(['wrong-item', 'receipt-dispute']);
const TYPES = new Set(['goods.address-change','goods.case-withdraw','goods.inspect-partial','goods.partial-propose','goods.partial-confirm','goods.incident-open','goods.incident-note','goods.incident-propose','goods.incident-confirm','goods.incident-verify','goods.incident-receipt']);
const closed = c => ['done','closed','rejected'].includes(c.status);
export function goodsShippingBlocked(o) { return (o.cases||[]).some(c=>!closed(c)&&(c.kind!=='cancel'||c.status==='requested'||!c.allocations?.length||!c.allocations.every(a=>(o.lines||[]).find(l=>l.skuId===a.skuId)?.cancelledQty>=a.qty))); }
const canonical = v => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k,canonical(v[k])])) : v;
const signature = v => JSON.stringify(canonical(v));
const copy = v => structuredClone(v);
const author = a => ({role:a.role,id:a.role==='user'?a.userId:a.role==='group'?'group':a.storeId,job:a.role==='group'?a.job||'all':null,...actorAccountFields(a)});
const owner = (a,o) => a.role==='user' && a.userId===o.userId;
const group = (a,jobs) => a.role==='group' && (!a.job || a.job==='all' || jobs.includes(a.job));
function fail(ctx,message) { if (ctx?.fail) ctx.fail(message); throw new Error(message); }
function text(value,label,ctx,required=true) { if (value!=null && typeof value!=='string') fail(ctx,`${label}格式无效。`); const v=String(value??'').trim(); if ((required&&!v)||v.length>1000) fail(ctx,`请填写${label}（最多1000字）。`); return v; }
function integer(value,label,ctx,min=0) { if (!['number','string'].includes(typeof value)||!String(value).trim()||!Number.isSafeInteger(Number(value))||Number(value)<min) fail(ctx,`请填写有效的${label}。`); return Number(value); }
function version(value,row,ctx) { if (!['number','string'].includes(typeof value)||!String(value).trim()||!Number.isSafeInteger(Number(value))||Number(value)!==row.version) fail(ctx,'记录已更新或缺少版本，请刷新核对后重试。'); }
function due(value,ctx,label='人工跟进时间') {
  if (value==null||value==='') return null;
  if (typeof value==='number' && Number.isSafeInteger(value) && Number.isFinite(new Date(value).getTime())) return value;
  const m=typeof value==='string' && /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?$/.exec(value);
  if (m&&+m[2]>=1&&+m[2]<=12&&+m[3]>=1&&+m[3]<=new Date(Date.UTC(+m[1],+m[2],0)).getUTCDate()&&+m[4]<24&&+m[5]<60&&+(m[6]||0)<60) {
    const n=Date.parse(m[7]?value:`${value}+08:00`); if (Number.isSafeInteger(n)) return n;
  }
  fail(ctx,`${label}格式无效。`);
}
export function goodsFactTime(s,value,label,ctx,min=0) {
  const n=due(value,ctx,label);
  if(n==null||n<min||n>s.now) fail(ctx,`${label}须真实发生于原事实之后且不晚于当前时间。`);
  return n;
}
const latestVerification = i => i.verifications?.at(-1);
const verificationReady = i => ['confirmed','not-confirmed'].includes(latestVerification(i)?.conclusion);
function request(s,a,type,p,ctx) {
  const requestId=text(p.requestId,'本次提交标识',ctx), identity=signature(author(a)), fingerprint=signature({type,p});
  const previous=s.goodsExceptionRequests.find(x=>x.actor===identity&&x.requestId===requestId);
  if (previous&&previous.fingerprint!==fingerprint) fail(ctx,'同一提交标识不能用于不同操作或内容。');
  return {requestId,actor:identity,fingerprint,previous};
}
function remember(s,r,row) { s.goodsExceptionRequests.push({requestId:r.requestId,actor:r.actor,fingerprint:r.fingerprint,id:row.id}); }
export function goodsExceptionRequest(s,a,type,p,ctx) { upgradeGoodsExceptions(s); return request(s,a,type,p,ctx); }
export function rememberGoodsExceptionRequest(s,req,row) { remember(s,req,row); }
function touch(s,o,row,a,action,ctx,details={}) { o.version++; o.updatedAt=s.now; if (row!==o) row.version++; (row.history??=[]).push({at:s.now,by:author(a),action,version:row.version,...copy(details)}); ctx?.log?.(o,action); }
function record(s,incident,a,action,details={}) { incident.records.push({at:s.now,by:author(a),action,...copy(details)}); }
function original(c) { return c.originalRequestSnapshot || {qty:c.qty,amountCents:c.amountCents,shippingCents:c.shippingCents,allocations:copy(c.allocations)}; }
const accepted = v => ['accept','approve','agree'].includes(v);

export function upgradeGoodsExceptions(s) {
  s.goodsExceptionRequests??=[];
  for (const o of s.goods || []) { if (!Number.isSafeInteger(o.version)) o.version=0; o.incidents??=[]; o.addressHistory??=[]; for (const c of o.cases||[]) if (!Number.isSafeInteger(c.version)) c.version=0; for (const i of o.incidents) { if (!Number.isSafeInteger(i.version)) i.version=0; i.records??=[]; } }
  return s;
}

export function syncGoodsExceptions(s,ctx) {
  upgradeGoodsExceptions(s);
  for (const o of s.goods||[]) for (const i of o.incidents) {
    if (i.status==='done') continue;
    const p=i.proposal,c=(o.cases||[]).find(c=>c.id===(p?.caseId||i.caseId));
    if (i.stage==='return'&&i.kind==='not-returned'&&c?.status==='closed'&&c.withdrawal&&!c.returnShipment&&!c.partialReceipt&&!c.inspectedAt&&!(o.refunds||[]).some(r=>r.caseId===c.id)) {
      i.status='done';i.completedAt=s.now;i.completionReason='用户主动撤回未寄回申请，无实物或退款事实';i.version++;o.version++;record(s,i,{role:'group',job:'all'},'源事实办结',{reason:i.completionReason});ctx?.log?.(o,`商品异常 ${i.id} · ${i.completionReason}`);continue;
    }
    if (p?.status!=='accepted') continue;
    let reason='';
    if (p.resolution==='refund' && c?.status==='done' && (o.refunds||[]).some(r=>r.caseId===c.id&&r.status==='success')) reason='关联售后原路退款已成功';
    if (p.resolution==='return-back' && c?.status==='closed' && c.backShipment && c.custody==='用户' && Number.isFinite(c.completedAt)) reason='用户已确认收到返还原货';
    if (p.resolution==='continue') {
      if (i.stage==='delivery' && o.status==='received' && Number.isFinite(o.receivedAt) && (!TYPED_DELIVERY.has(i.kind) || verificationReady(i) && i.receiptFact?.verificationId===p.verificationId && i.receiptFact?.proposalRevision===p.revision)) reason=TYPED_DELIVERY.has(i.kind)?'本人核实完整正确收货，原收货事实已记录':'用户已按原流程确认收货';
      if (i.stage==='return' && i.kind==='not-returned' && c?.returnShipment) reason='用户已按原流程登记寄回事实';
      if (i.stage==='return' && i.kind!=='not-returned' && c && (Number.isFinite(c.inspectedAt) || (c.custody==='集团仓储' && ['inspection_disputed','inspection_review','awaiting_return_disposition','awaiting_return_to_customer'].includes(c.status) && (!c.partialReceipt || c.partialReceipt.qty===original(c).qty)))) reason='原售后已记录集团实物收件事实';
      if (i.stage==='return-back' && c?.status==='closed' && c.backShipment && c.custody==='用户' && Number.isFinite(c.completedAt)) reason='用户已按原流程确认返还收货';
    }
    if (reason) { i.status='done'; i.completedAt=s.now; i.completionReason=reason; i.version++; o.version++; record(s,i,{role:'group',job:'all'},'源事实办结',{reason}); ctx?.log?.(o,`商品异常 ${i.id} · ${reason}`); }
  }
  return s;
}

export function goodsIncidentView(s,actor,orderId) {
  actor=resolveAccountActor(s,actor);
  const groupRead=group(actor,['support','warehouse','finance'])&&canAccountView(actor,'goods'),storeRead=['store','manager'].includes(actor.role)&&canAccountView(actor,'goods');
  const rows=(s.goods||[]).filter(o=>(!orderId||o.id===orderId)&&(groupRead||owner(actor,o)||(storeRead&&o.source?.storeId===actor.storeId)));
  return copy(rows.flatMap(o=>(o.incidents||[]).map(i=>storeRead?{id:i.id,orderId:o.id,storeId:o.source?.storeId||null,stage:i.stage,kind:i.kind,status:i.status,version:i.version,createdAt:i.createdAt,completedAt:i.completedAt,proposal:i.proposal?{resolution:i.proposal.resolution,status:i.proposal.status}:null}:{...i,orderId:o.id,storeId:o.source?.storeId||null})));
}

export function goodsExceptionCommand(s,a,type,p={},ctx={}) {
  if (!TYPES.has(type)) return undefined;
  upgradeGoodsExceptions(s);
  const o=(s.goods||[]).find(x=>x.id===p.id);
  if (!o || !(owner(a,o)||a.role==='group')) fail(ctx,'订单不存在或当前身份无权访问。');
  const userTypes=['goods.address-change','goods.case-withdraw','goods.partial-confirm','goods.incident-confirm','goods.incident-receipt'];
  if (userTypes.includes(type) && !owner(a,o)) fail(ctx,'仅订单本人可以确认或撤回。');
  if (['goods.inspect-partial'].includes(type) && !group(a,['warehouse'])) fail(ctx,'仅集团仓储可以登记实收。');
  if (['goods.partial-propose','goods.incident-propose'].includes(type) && !group(a,['support'])) fail(ctx,'仅集团客服可以提出协商方案。');
  if (['goods.incident-open','goods.incident-note'].includes(type) && !group(a,['support','warehouse'])) fail(ctx,'仅集团客服或仓储可以登记跟进。');
  if (type==='goods.incident-verify' && !group(a,['support'])) fail(ctx,'仅集团客服可以核实错发或签收争议。');
  const c=p.caseId?(o.cases||[]).find(x=>x.id===p.caseId):null;
  if (type.startsWith('goods.partial-')||type==='goods.inspect-partial'||type==='goods.case-withdraw') if (!c) fail(ctx,'售后案件不存在。');
  const i=p.incidentId?o.incidents.find(x=>x.id===p.incidentId):null;
  if (type.startsWith('goods.incident-') && type!=='goods.incident-open' && !i) fail(ctx,'商品异常记录不存在。');
  const req=request(s,a,type,p,ctx);
  if (req.previous) return o.incidents.find(x=>x.id===req.previous.id)||o.cases.find(x=>x.id===req.previous.id)||o;
  version(p.version,type==='goods.incident-open'?o:(i||c||o),ctx);
  if (type==='goods.address-change') {
    if (!['unpaid','paid'].includes(o.status)||o.shipment) fail(ctx,'仅未发货订单可以变更地址。');
    const address=(s.addresses||[]).find(x=>x.id===p.addressId&&x.userId===a.userId&&x.active!==false&&!x.deletedAt);
    if (!address) fail(ctx,'请选择本人有效收货地址。');
    if (address.province!==o.address.province||address.city!==o.address.city) fail(ctx,'当前固定运费只支持同省同市改址，跨区域请联系集团客服核查。');
    if (!/^1\d{10}$/.test(address.phone)||!address.name||!address.detail) fail(ctx,'收货地址信息不完整，请先更新地址。');
    if (signature(address)===signature(o.address)) fail(ctx,'收货地址没有变化。');
    o.addressHistory.push({at:s.now,by:author(a),before:copy(o.address),after:copy(address),requestId:req.requestId}); o.address=copy(address);
    touch(s,o,o,a,'用户更新未发货收货地址',ctx);
  } else if (type==='goods.case-withdraw') {
    if (!['requested','awaiting_return'].includes(c.status)||c.returnShipment||c.inspectedAt||c.partialReceipt||c.custody||(o.refunds||[]).some(r=>r.caseId===c.id)) fail(ctx,'已有寄回、实物保管或退款事实，不能撤回申请。');
    c.withdrawal={reason:text(p.reason,'撤回原因',ctx),at:s.now,by:author(a)}; c.status='closed'; c.completedAt=s.now;
    touch(s,o,c,a,'用户主动撤回售后申请',ctx,{withdrawal:c.withdrawal}); ctx.adjustBills?.(o);
  } else if (type==='goods.inspect-partial') {
    if (c.kind!=='return'||!['returning','partial_received'].includes(c.status)||c.inspectedAt||c.partialProposal?.status==='pending') fail(ctx,'当前不能登记部分实收，请先完成用户方案确认。');
    const requested=original(c),qty=integer(p.qty,'本次实收数量',ctx,1),evidence=text(p.evidence,'收件证据',ctx);
    const received=(c.partialReceipt?.qty||0)+qty;
    if (received>requested.qty || (!c.partialReceipt&&received>=requested.qty)) fail(ctx,'部分实收必须小于申请数量；全部收到请使用原验收。');
    c.originalRequestSnapshot??=copy(requested); (c.receipts??=[]).push({qty,evidence,at:s.now,by:author(a),requestId:req.requestId});
    c.partialReceipt={qty:received,evidence,at:s.now,by:author(a)}; c.custody='集团仓储';
    if (c.partialProposal) { (c.partialProposalHistory??=[]).push(copy(c.partialProposal)); c.partialProposal=null; }
    c.status=received===requested.qty?'returning':'partial_received';
    touch(s,o,c,a,received===requested.qty?'退货后续实收已补齐，待原流程验收':'仓储登记部分实收，待客服协商',ctx,{qty,received,evidence});
  } else if (type==='goods.partial-propose') {
    if (c.kind!=='return'||c.status!=='partial_received'||!c.partialReceipt||c.inspectedAt) fail(ctx,'请先登记部分实收，或等待当前方案完成。');
    const resolution=p.resolution||'refund'; if (!['refund','return-back'].includes(resolution)) fail(ctx,'请选择部分退货退款或返还原货方案。');
    const requested=original(c),qty=integer(p.qty,'协商实收数量',ctx,1);
    if (qty!==c.partialReceipt.qty) fail(ctx,'协商数量必须覆盖本案已实收的全部货物。');
    const amountCents=integer(p.amountCents??0,'协商退款金额',ctx),shippingCents=integer(p.shippingCents??0,'协商退运费',ctx);
    const line=o.lines.find(l=>l.skuId===c.skuId);
    if (amountCents>requested.amountCents||amountCents>qty*line.unitCents||shippingCents>requested.shippingCents||amountCents+shippingCents>requested.amountCents+requested.shippingCents) fail(ctx,'协商金额超过原申请或实收数量实付。');
    if (resolution==='refund'&&!amountCents&&!shippingCents) fail(ctx,'退款方案必须填写协商金额。');
    if (resolution==='return-back'&&(amountCents||shippingCents)) fail(ctx,'原货返还方案本案不退款。');
    if (c.partialProposal) (c.partialProposalHistory??=[]).push(copy(c.partialProposal));
    c.partialProposal={resolution,qty,amountCents,shippingCents,keptQty:requested.qty-qty,reason:text(p.reason,'协商依据及未寄回数量处理',ctx),status:'pending',at:s.now,by:author(a)};
    c.status='partial_confirmation'; touch(s,o,c,a,'客服提出部分退货方案，等待用户确认',ctx,{proposal:c.partialProposal});
  } else if (type==='goods.partial-confirm') {
    if (c.status!=='partial_confirmation'||c.partialProposal?.status!=='pending') fail(ctx,'当前没有等待确认的部分退货方案。');
    if (!accepted(p.decision)&&p.decision!=='reject') fail(ctx,'请选择同意或驳回方案。');
    const reason=text(p.reason,'确认说明及未寄回货物处理',ctx),proposal=c.partialProposal;
    proposal.status=accepted(p.decision)?'accepted':'rejected'; proposal.confirmedAt=s.now; proposal.confirmationReason=reason; proposal.confirmedBy=author(a);
    if (proposal.status==='rejected') c.status='partial_received';
    else {
      c.keptQty=proposal.keptQty; c.qty=proposal.qty; c.amountCents=proposal.amountCents; c.shippingCents=proposal.shippingCents;
      c.allocations=proposal.resolution==='refund'?[{skuId:c.skuId,qty:c.qty,amountCents:c.amountCents}]:[];
      c.status=proposal.resolution==='refund'?'awaiting_return_disposition':'awaiting_return_to_customer';
      c.unreturnedDisposition={qty:c.keptQty,holder:'用户',refundCents:0,reason,at:s.now,by:author(a)};
    }
    touch(s,o,c,a,proposal.status==='accepted'?'用户确认部分退货及未寄回货物方案':'用户驳回部分退货方案，继续核查',ctx,{proposal}); ctx.adjustBills?.(o);
  } else if (type==='goods.incident-open') {
    if (!GOODS_INCIDENT_STAGES.includes(p.stage)||!GOODS_INCIDENT_KINDS.includes(p.kind)) fail(ctx,'请选择有效异常阶段及类型。');
    if (p.stage==='delivery' && !['shipped','received'].includes(o.status)) fail(ctx,'配送异常须已有发货事实。');
    if (p.stage==='delivery' && ['delay','lost'].includes(p.kind) && o.status!=='shipped') fail(ctx,'已确认收货后不能新登记未送达的延迟或丢失，请按真实破损等事实处理。');
    if (p.stage==='return' && (!c||c.kind!=='return'||!['awaiting_return','returning','partial_received','partial_confirmation'].includes(c.status))) fail(ctx,'寄回异常须关联本单正在等待寄回或收件的退货。');
    if (p.stage==='return' && p.kind==='not-returned' && c?.returnShipment) fail(ctx,'已有寄回运单，请按实际配送或收件异常登记。');
    if (p.stage==='return' && p.kind!=='not-returned' && !c?.returnShipment) fail(ctx,'尚未寄回，请登记未寄回事实。');
    if (p.stage==='return-back' && (!c||!c.backShipment||c.status!=='return_to_customer_shipping')) fail(ctx,'原货返还异常须关联本单正在返还运输中的案件。');
    if (p.stage==='delivery'&&p.caseId&&!c) fail(ctx,'关联售后须属于本单。');
    if (p.kind==='not-returned'&&p.stage!=='return') fail(ctx,'未寄回仅适用于退货寄回阶段。');
    if (p.kind==='unclaimed'&&p.stage!=='return-back') fail(ctx,'无人签收仅适用于原货返还阶段。');
    let fact;
    if(TYPED_DELIVERY.has(p.kind)) {
      if(p.stage!=='delivery'||!o.shipment||!Number.isSafeInteger(o.shipment.at)) fail(ctx,'错发或签收争议须有本单真实原发货事实。');
      fact={occurredAt:goodsFactTime(s,p.occurredAt,'异常实际发生时间',ctx,o.shipment.at),recordedAt:s.now,recordedBy:author(a),evidence:text(p.evidence,'异常证据',ctx),shipment:copy(o.shipment)};
      if(p.kind==='wrong-item') {
        const line=(o.lines||[]).find(l=>l.skuId===p.skuId),qty=integer(p.qty,'报告错发数量',ctx,1);
        if(!line||qty>line.qty-(line.cancelledQty||0)) fail(ctx,'错发须关联原已发货商品，数量不能超过原出库数量。');
        Object.assign(fact,{skuId:line.skuId,qty,expectedName:line.name,expectedSpec:line.spec,actualItem:text(p.actualItem,'实际收到货物说明',ctx)});
      } else {
        if(!['not-received','unauthorized-recipient','partial-delivery'].includes(p.receiptClaim)) fail(ctx,'请选择明确的签收争议主张。');
        fact.receiptClaim=p.receiptClaim;
      }
    }
    const row={id:ctx.id?ctx.id('GI'):`GI${s.seq=(s.seq||0)+1}`,stage:p.stage,kind:p.kind,caseId:c?.id||null,version:0,reason:text(p.reason,'异常事实与原因',ctx),dueAt:due(p.dueAt,ctx),createdAt:s.now,status:'open',records:[],events:[]};
    if(fact) Object.assign(row,{fact,verifications:[],receiptFacts:[]});
    record(s,row,a,'异常登记',{reason:row.reason,dueAt:row.dueAt}); o.incidents.push(row); touch(s,o,o,a,`集团登记商品异常 ${row.id}`,ctx); remember(s,req,row); return row;
  } else if(type==='goods.incident-verify') {
    if(!TYPED_DELIVERY.has(i.kind)||!i.fact||!['open','waiting'].includes(i.status)) fail(ctx,'当前错发或签收争议不能核实，请先处理待确认方案。');
    if(!['confirmed','not-confirmed','inconclusive'].includes(p.conclusion)) fail(ctx,'请选择有效核实结论。');
    const v={id:ctx.id?ctx.id('GV'):`GV${s.seq=(s.seq||0)+1}`,conclusion:p.conclusion,occurredAt:goodsFactTime(s,p.occurredAt,'核实实际发生时间',ctx,i.fact.occurredAt),recordedAt:s.now,by:author(a),evidence:text(p.evidence,'核实证据',ctx),reason:text(p.reason,'核实说明',ctx)};
    (i.verifications??=[]).push(v);
    if(i.proposal) {(i.proposalHistory??=[]).push(copy(i.proposal));i.proposal=null;}
    i.status='open';record(s,i,a,'客服追加人工核实',{verificationId:v.id,conclusion:v.conclusion});touch(s,o,i,a,'错发或签收争议已核实，继续原方案确认',ctx);
  } else if(type==='goods.incident-receipt') {
    if(!TYPED_DELIVERY.has(i.kind)||!verificationReady(i)||i.status!=='waiting'||i.proposal?.status!=='accepted'||i.proposal.resolution!=='continue'||i.proposal.verificationId!==latestVerification(i).id) fail(ctx,'须先完成人工核实并由本人同意继续方案。');
    if(i.receiptFact?.proposalRevision===i.proposal.revision) fail(ctx,'本方案已有本人收货事实，请继续原订单收货流程。');
    const receipt={occurredAt:goodsFactTime(s,p.occurredAt,'本人实际完整正确收货时间',ctx,i.fact.occurredAt),recordedAt:s.now,by:author(a),evidence:text(p.evidence,'本人实际收货依据',ctx),reason:text(p.reason,'实际收货说明',ctx),verificationId:i.proposal.verificationId,proposalRevision:i.proposal.revision};
    (i.receiptFacts??=[]).push(receipt);i.receiptFact=copy(receipt);record(s,i,a,'本人登记完整正确收货事实',{occurredAt:receipt.occurredAt});touch(s,o,i,a,'本人收货事实已记录，按原订单事实核对办结',ctx);syncGoodsExceptions(s,ctx);
  } else if (type==='goods.incident-note') {
    if (i.status==='done') fail(ctx,'异常已依据原业务事实办结，不能继续修改。');
    const reason=text(p.reason||p.note,'跟进事实',ctx); if (Object.hasOwn(p,'dueAt')) i.dueAt=due(p.dueAt,ctx);
    record(s,i,a,'跟进记录',{reason,dueAt:i.dueAt}); touch(s,o,i,a,`集团跟进商品异常 ${i.id}`,ctx);
  } else if (type==='goods.incident-propose') {
    if (!['open','waiting'].includes(i.status)) fail(ctx,'当前异常已结束或等待用户确认，不能重复提出方案。');
    if(TYPED_DELIVERY.has(i.kind)&&!verificationReady(i)) fail(ctx,'错发或签收争议须有明确人工核实结果，不能用未核实方案代替事实。');
    if (!['continue','refund','return-back'].includes(p.resolution)) fail(ctx,'请选择继续履约、关联退款或原货返还方案。');
    const caseId=p.caseId||i.caseId, linked=caseId?(o.cases||[]).find(x=>x.id===caseId):null;
    if (caseId&&!linked) fail(ctx,'关联售后须属于本单。');
    if (p.resolution==='refund'&&(!linked||linked.kind==='cancel'||closed(linked))) fail(ctx,'退款方案须关联本单仍办理中的非取消原售后。');
    if (p.resolution==='return-back'&&(!linked||linked.kind!=='return'||!['awaiting_return_to_customer','return_to_customer_shipping','closed'].includes(linked.status))) fail(ctx,'请先通过原售后确定原货返还方案。');
    if (i.stage!=='delivery'&&caseId!==i.caseId) fail(ctx,'寄回及返还阶段不能更换关联案件。');
    if (i.proposal) (i.proposalHistory??=[]).push(copy(i.proposal));
    i.proposal={resolution:p.resolution,reason:text(p.reason,'处理方案与协商依据',ctx),caseId:caseId||null,at:s.now,by:author(a),status:'pending'}; i.status='awaiting_user';
    if(TYPED_DELIVERY.has(i.kind)) Object.assign(i.proposal,{verificationId:latestVerification(i).id,revision:i.version+1});
    record(s,i,a,'处理方案待确认',{proposal:i.proposal}); touch(s,o,i,a,`客服提出商品异常方案 ${i.id}`,ctx);
  } else if (type==='goods.incident-confirm') {
    if (i.status!=='awaiting_user'||i.proposal?.status!=='pending') fail(ctx,'当前没有待用户确认的异常方案。');
    if (!accepted(p.decision)&&p.decision!=='reject') fail(ctx,'请选择同意或驳回方案。');
    const reason=text(p.reason,'确认说明',ctx); i.proposal.status=accepted(p.decision)?'accepted':'rejected'; i.proposal.confirmedAt=s.now; i.proposal.confirmationReason=reason; i.proposal.confirmedBy=author(a); i.status=accepted(p.decision)?'waiting':'open';
    record(s,i,a,'用户确认处理方案',{decision:p.decision,reason}); touch(s,o,i,a,`用户${accepted(p.decision)?'确认':'驳回'}商品异常方案 ${i.id}`,ctx); syncGoodsExceptions(s,ctx);
  }
  const result=i||c||o; remember(s,req,result); return result;
}
