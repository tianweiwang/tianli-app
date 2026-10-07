// Explicit local logistics rules and independently verified delivery facts.
// Original goods receive/refund/stock/commission writes remain with engine.mjs.
import { actorAccountFields, resolveAccountActor } from './staff-accounts.mjs';
import { goodsFactTime } from './goods-exceptions.mjs';
const MIN = 60000, MAX_MINUTES = 3650 * 1440;
const TYPES = new Set(['goods-logistics.policy-publish', 'goods-logistics.delivery-record', 'goods-logistics.delivery-verify']);
const terminalCase = c => ['done', 'closed', 'rejected'].includes(c.status);
const copy = x => structuredClone(x);
const canonical = x => Array.isArray(x) ? x.map(canonical) : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).sort().map(k => [k, canonical(x[k])])) : x;
const json = x => JSON.stringify(canonical(x));
// Synchronous SHA-256 preserves the caller's synchronous deep-copy transaction.
function sha256(value) {
  const input = new TextEncoder().encode(value), length = Math.ceil((input.length + 9) / 64) * 64, bytes = new Uint8Array(length), data = new DataView(bytes.buffer);
  bytes.set(input); bytes[input.length] = 0x80; data.setUint32(length - 8, Math.floor(input.length / 0x20000000)); data.setUint32(length - 4, (input.length * 8) >>> 0);
  const k = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2], h = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19], w = new Uint32Array(64), r = (n,b) => (n>>>b)|(n<<(32-b));
  for (let offset = 0; offset < length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = data.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) { const x = w[i-15], y = w[i-2]; w[i] = (w[i-16] + (r(x,7)^r(x,18)^(x>>>3)) + w[i-7] + (r(y,17)^r(y,19)^(y>>>10))) >>> 0; }
    let [a,b,c,d,f,g,j,l] = h;
    for (let i = 0; i < 64; i++) { const t1 = (l + (r(f,6)^r(f,11)^r(f,25)) + ((f&g)^(~f&j)) + k[i] + w[i]) >>> 0, t2 = ((r(a,2)^r(a,13)^r(a,22)) + ((a&b)^(a&c)^(b&c))) >>> 0; l=j; j=g; g=f; f=(d+t1)>>>0; d=c; c=b; b=a; a=(t1+t2)>>>0; }
    [a,b,c,d,f,g,j,l].forEach((v,i) => h[i]=(h[i]+v)>>>0);
  }
  return h.map(n => n.toString(16).padStart(8,'0')).join('');
}
const digest = x => sha256(json(x));
const author = a => ({ role: a.role, job: a.job || null, id: a.accountId || a.userId || a.storeId || 'group', ...actorAccountFields(a) });
const group = (a,jobs) => a?.role === 'group' && (!a.job || a.job === 'all' || jobs.includes(a.job));
const validAt = (s,t) => Number.isSafeInteger(t) && t >= 0 && t <= s.now;
function fail(ctx,message) { if (ctx?.fail) ctx.fail(message); throw new Error(message); }
function text(x,label,ctx,required = true) { if (x != null && typeof x !== 'string') fail(ctx,`${label}格式无效`); const v = String(x ?? '').trim(); if (required && !v || v.length > 1000) fail(ctx,`请填写${label}（最多1000字）`); return v; }
function version(x,current,ctx) { if (!['string','number'].includes(typeof x) || !String(x).trim() || !Number.isSafeInteger(Number(x)) || Number(x) !== current) fail(ctx,'物流记录或配置已更新，或缺少版本，请刷新核对'); }
function minutes(x,label,ctx,required = false) { if ((x == null || x === '') && !required) return null; if (!['string','number'].includes(typeof x) || !String(x).trim() || !Number.isSafeInteger(Number(x)) || Number(x) < 1 || Number(x) > MAX_MINUTES) fail(ctx,`${label}须为明确的正整数分钟`); return Number(x); }
function effectiveTime(s,x,ctx) {
  let t = typeof x === 'number' ? x : NaN;
  if (typeof x === 'string') {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:\d{2})?$/.exec(x);
    if (m && +m[2] >= 1 && +m[2] <= 12 && +m[3] >= 1 && +m[3] <= new Date(Date.UTC(+m[1],+m[2],0)).getUTCDate() && +m[4] < 24 && +m[5] < 60 && +(m[6] || 0) < 60) t = Date.parse(m[7] ? x : x + '+08:00');
  }
  if (!Number.isSafeInteger(t) || !Number.isFinite(new Date(t).getTime()) || t < s.now) fail(ctx,'配置生效时间必须有效，不能倒签');
  return t;
}
function id(s,ctx,prefix) { return ctx.id ? ctx.id(prefix) : prefix + (s.seq = (s.seq || 0) + 1); }
function source(o) { return digest({ orderId: o.id, paymentId: o.payment?.id, shipment: o.shipment }); }
function audit(s,o,a,action,ctx,detail = {}) { o.version = (o.version || 0) + 1; o.updatedAt = s.now; ctx.log?.(o,action); if (detail.fact) (detail.fact.history ??= []).push({ action, at: s.now, by: author(a), version: o.version }); }
function request(s,a,type,p,ctx) {
  const requestId = text(p.requestId,'本次提交标识',ctx), actorDigest = digest({ role:a.role,job:a.job || null,id:a.accountId || a.userId || a.storeId || 'group' }), fingerprint = digest({type,p});
  const old = s.goodsLogisticsRequests.find(r => r.requestId === requestId && r.actorDigest === actorDigest);
  if (old && old.fingerprint !== fingerprint) fail(ctx,'同一提交标识不能用于不同操作或内容');
  return { requestId, actorDigest, fingerprint, old };
}
export function upgradeGoodsLogisticsPolicy(s) { s.goodsLogisticsPolicies ??= []; s.goodsLogisticsRequests ??= []; return s; }
export function captureGoodsLogisticsPolicy(s,o,ctx = {}) {
  if (Object.hasOwn(o,'logisticsPolicySnapshot')) return o.logisticsPolicySnapshot;
  const applicable = validAt(s,o.createdAt) ? (s.goodsLogisticsPolicies || []).filter(r => r.effectiveAt <= o.createdAt && r.publishedAt <= o.createdAt && r.mode === 'demo' && r.productionApproved === false && (r.scope === 'all' || (o.lines || []).length > 0 && o.lines.every(l => r.skuIds.includes(l.skuId)))).sort((a,b) => b.effectiveAt-a.effectiveAt || b.version-a.version)[0] : null;
  o.logisticsPolicySnapshot = applicable ? copy(applicable) : null;
  o.logisticsPolicyCapturedAt = s.now;
  ctx.log?.(o, applicable ? `商品物流规则锁定 v${applicable.version}` : '创建时未配置适用商品物流规则，自动收货保持关闭');
  return o.logisticsPolicySnapshot;
}
export function goodsLogisticsCommand(s,rawActor,type,p = {},ctx = {}) {
  if (!TYPES.has(type)) return undefined;
  const a = resolveAccountActor(s,rawActor), publishing = type === 'goods-logistics.policy-publish';
  if (!group(a,publishing ? ['operations'] : type.endsWith('delivery-verify') ? ['support'] : ['warehouse','support'])) fail(ctx,'当前岗位无权发布物流规则或登记核实送达事实');
  upgradeGoodsLogisticsPolicy(s);
  const o = publishing ? null : (s.goods || []).find(o => o.id === p.id);
  if (!publishing && !o) fail(ctx,'商品订单不存在');
  const req = request(s,a,type,p,ctx);
  if (req.old) return publishing ? s.goodsLogisticsPolicies.find(r => r.id === req.old.resultId) : o.goodsDeliveryFacts?.find(f => f.id === req.old.resultId);
  const current = publishing ? Math.max(0,...s.goodsLogisticsPolicies.map(r => r.version)) : o.version || 0;
  version(p.version,current,ctx);
  let result;
  if (publishing) {
    if (!['all','skus'].includes(p.scope) || !['enabled','disabled'].includes(p.autoReceiptMode)) fail(ctx,'须明确适用范围及自动收货启停');
    const skuIds = p.scope === 'all' ? [] : (Array.isArray(p.skuIds) ? p.skuIds : String(p.skuIds || '').split(/[,，\s]+/).filter(Boolean));
    if (p.scope === 'skus' && (!skuIds.length || new Set(skuIds).size !== skuIds.length || skuIds.some(k => !(s.skus || []).some(x => x.id === k)))) fail(ctx,'请选择不重复的有效SKU编号');
    if (!['not-configured','case-agreement'].includes(p.compensationMode) || !['not-configured','manual-hold'].includes(p.unclaimedMode)) fail(ctx,'须明确赔付及无人领取仍采用的人工办理口径');
    result = { id:id(s,ctx,'GLP'), version:current+1, scope:p.scope, skuIds, effectiveAt:effectiveTime(s,p.effectiveAt,ctx), publishedAt:s.now, publishedBy:author(a), mode:'demo', productionApproved:false, reason:text(p.reason,'配置依据与发布说明',ctx), autoReceiptMode:p.autoReceiptMode, autoReceiptMinutes:p.autoReceiptMode === 'enabled' ? minutes(p.autoReceiptMinutes,'自动收货等待',ctx,true) : null, deliveryFollowupMinutes:minutes(p.deliveryFollowupMinutes,'配送运单人工跟进',ctx), returnTransitFollowupMinutes:minutes(p.returnTransitFollowupMinutes,'寄回运单人工跟进',ctx), returnBackFollowupMinutes:minutes(p.returnBackFollowupMinutes,'返还运单人工跟进',ctx), compensationMode:p.compensationMode, compensationBasis:p.compensationMode === 'case-agreement' ? text(p.compensationBasis,'逐案赔付协商规则说明',ctx) : '', unclaimedMode:p.unclaimedMode, unclaimedBasis:p.unclaimedMode === 'manual-hold' ? text(p.unclaimedBasis,'人工保管与协调依据',ctx) : '' };
    s.goodsLogisticsPolicies.push(result); ctx.log?.(result,`发布本地商品物流配置 v${result.version}，正式政策未确认`);
  } else if (type === 'goods-logistics.delivery-record') {
    if (!['shipped','received'].includes(o.status) || o.payment?.status !== 'success' || !o.shipment || !validAt(s,o.shipment.at)) fail(ctx,'送达事实须对应本单真实成功付款和原发货');
    if (!['delivered','signed'].includes(p.kind)) fail(ctx,'请选择实际送达或签收事实');
    const previous = p.replacesId ? o.goodsDeliveryFacts?.find(f => f.id === p.replacesId) : null;
    if (p.replacesId && (!previous || previous.replacedBy)) fail(ctx,'被更正的原送达事实不存在或已更正');
    if (previous?.status === 'verified' && o.status === 'received' && !(o.incidents || []).some(i => i.kind === 'receipt-dispute' && i.status !== 'done')) fail(ctx,'已收货的核实依据更正须先登记仍办理中的签收争议，不能绕过原异常处理');
    result = { id:id(s,ctx,'GDF'), kind:p.kind, occurredAt:goodsFactTime(s,p.occurredAt,'实际送达或签收时间',ctx,o.shipment.at), recordedAt:s.now, by:author(a), evidence:text(p.evidence,'实际送达证据',ctx), reference:text(p.reference,'外部实际凭据号',ctx), reason:text(p.reason,'事实说明或更正依据',ctx), shipment:copy(o.shipment), sourceToken:source(o), status:'pending', verifications:[], replacesId:previous?.id || null, replacedBy:null, history:[] };
    if (previous) previous.replacedBy = result.id;
    (o.goodsDeliveryFacts ??= []).push(result); audit(s,o,a,'集团记录实际送达或签收事实，待客服核实',ctx,{fact:result});
  } else {
    const f = o.goodsDeliveryFacts?.find(f => f.id === p.factId);
    if (!f || f.replacedBy || f.sourceToken !== source(o)) fail(ctx,'原送达事实不存在、已更正或与当前原运单不符');
    if (!['verified','rejected'].includes(p.decision)) fail(ctx,'请选择明确核实或不予核实');
    if (f.status === 'verified' && p.decision === 'rejected' && o.status === 'received' && !(o.incidents || []).some(i => i.kind === 'receipt-dispute' && i.status !== 'done')) fail(ctx,'已收货的核实依据更正须先登记签收争议，原收货和资金不直接回退');
    const v = { decision:p.decision, occurredAt:goodsFactTime(s,p.occurredAt,'核实实际发生时间',ctx,f.occurredAt), recordedAt:s.now, by:author(a), evidence:text(p.evidence,'核实证据',ctx), reason:text(p.reason,'核实说明',ctx) };
    f.verifications.push(v); f.status=p.decision; audit(s,o,a,'客服核实原送达或签收事实',ctx,{fact:f}); result=f;
  }
  s.goodsLogisticsRequests.push({ requestId:req.requestId, actorDigest:req.actorDigest, fingerprint:req.fingerprint, digestAlgorithm:'SHA-256', type, resultId:result.id, orderId:o?.id || null, at:s.now });
  return result;
}
export function goodsLogisticsAutoReceipt(s,o) {
  const p=o.logisticsPolicySnapshot, f=(o.goodsDeliveryFacts || []).filter(f => !f.replacedBy).at(-1);
  const base={eligible:false,reason:'',dueAt:null,policyId:p?.id || null,policyVersion:p?.version || null,factId:f?.id || null};
  const no = reason => ({...base,reason});
  if (o.status !== 'shipped') return no('尚无待确认收货的原发货订单');
  if (o.payment?.status !== 'success' || !o.shipment || !validAt(s,o.shipment.at)) return no('原付款或发货事实不完整');
  if (!p || p.mode !== 'demo' || p.productionApproved !== false || p.autoReceiptMode !== 'enabled' || !Number.isSafeInteger(p.autoReceiptMinutes) || p.autoReceiptMinutes < 1 || !validAt(s,o.createdAt) || !validAt(s,p.effectiveAt) || !validAt(s,p.publishedAt) || p.effectiveAt > o.createdAt || p.publishedAt > o.createdAt || !(s.goodsLogisticsPolicies || []).some(r => r.id === p.id && r.version === p.version && digest(r) === digest(p)) || !(p.scope === 'all' || p.scope === 'skus' && (o.lines || []).length > 0 && o.lines.every(l => p.skuIds.includes(l.skuId)))) return no('本单未锁定明确启用的物流规则');
  const verified = f?.verifications?.at(-1);
  if (!f || f.status !== 'verified' || !['delivered','signed'].includes(f.kind) || !f.evidence || !f.reference || f.sourceToken !== source(o) || !validAt(s,f.occurredAt) || !validAt(s,f.recordedAt) || f.occurredAt < o.shipment.at || verified?.decision !== 'verified' || !verified.evidence || !validAt(s,verified.occurredAt) || !validAt(s,verified.recordedAt) || verified.occurredAt < f.occurredAt) return no('最新实际送达或签收事实尚未核实');
  base.dueAt=f.occurredAt+p.autoReceiptMinutes*MIN;
  if (!Number.isSafeInteger(base.dueAt) || !Number.isFinite(new Date(base.dueAt).getTime())) return no('自动收货时点无效');
  if ((o.cases || []).some(c => !terminalCase(c))) return {...base,reason:'原商品售后尚未结案'};
  if ((o.incidents || []).some(i => i.status !== 'done')) return {...base,reason:'配送或退货异常尚未按源事实办结'};
  if ((o.refunds || []).some(r => r.status !== 'success')) return {...base,reason:'原退款结果仍需确定或处理'};
  return {...base,eligible:s.now >= base.dueAt,reason:s.now >= base.dueAt ? '' : '尚未到本单已锁定的自动收货时点'};
}
export function tickGoodsLogistics(s,ctx = {}) {
  const report={ready:[],applied:[],unconfigured:[]};
  for (const o of s.goods || []) {
    const value=goodsLogisticsAutoReceipt(s,o); if(!value.eligible)continue;
    report.ready.push(o.id);
    if(typeof ctx.receiveGoods !== 'function') {report.unconfigured.push(o.id);continue;}
    const fact=o.goodsDeliveryFacts.find(f => f.id===value.factId);
    ctx.receiveGoods(o,{source:'logistics-auto',confirmedAt:s.now,occurredAt:fact.occurredAt,policyId:value.policyId,policyVersion:value.policyVersion,factId:value.factId});
    if(o.status==='received')report.applied.push(o.id);
  }
  return report;
}
export function goodsLogisticsTaskRows(s) {
  const rows=[];
  for(const o of s.goods || []) {
    const base={orderId:o.id,storeId:o.source?.storeId || null,requiredRoute:'goods',routes:{group:`/group/goods/${encodeURIComponent(o.id)}`,store:`/store/goods/${encodeURIComponent(o.id)}`},allowedJobs:{group:['support'],store:['store-manager','store-finance']},manageRoles:['group'],assignmentMode:'task',dueAt:null};
    for(const f of o.goodsDeliveryFacts || []) rows.push({...base,id:`goods-delivery:${f.id}:verify`,category:'goods-logistics',title:'商品实际送达核实',sourceId:f.id,createdAt:f.recordedAt,status:f.replacedBy || f.status!=='pending'?'done':'open',statusLabel:f.replacedBy?'原事实已有更正':f.status==='pending'?'待客服核实实际送达':f.status==='verified'?'实际送达已核实':'未予核实，继续原流程',commands:f.replacedBy || f.status!=='pending'?[]:['goods-logistics.delivery-verify'],sourceToken:digest([o.id,o.version,f.id,f.status,f.replacedBy])});
    const p=o.logisticsPolicySnapshot;
    const add=(sourceId,stage,title,at,wait,done)=>{if(!validAt(s,at)||!Number.isSafeInteger(wait))return;rows.push({...base,id:`goods-logistics:${sourceId}:${stage}`,category:'goods-logistics',title,sourceId,createdAt:at,dueAt:at+wait*MIN,status:done?'done':'open',statusLabel:done?'原流程已结束':'按已锁配置人工核查运单进度',commands:done?[]:['goods.incident-open'],sourceToken:digest([o.id,o.version,sourceId,p.id,p.version,done,at,wait])});};
    if(p) {add(o.id,'delivery','配送运单跟进',o.shipment?.at,p.deliveryFollowupMinutes,['received','cancelled','closed'].includes(o.status));for(const c of o.cases || []) {add(c.id,'return','寄回运单跟进',c.returnShipment?.at,p.returnTransitFollowupMinutes,terminalCase(c));add(c.id,'return-back','返还运单跟进',c.backShipment?.at,p.returnBackFollowupMinutes,terminalCase(c));}}
  }
  return rows;
}
