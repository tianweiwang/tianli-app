// Internal, synchronous lifecycle projections. No upgrade, sync, or source write.
// The caller must authorize scope and project a smaller view for the current actor.
import { serviceFinanceSummary } from './service-finance.mjs';
import { techIncomeView } from './tech-income.mjs';
import { serviceFinanceExtrasExitBlockers } from './service-finance-extras.mjs';
import { servicePromotionExitBlockers, servicePromotionView } from './service-promotion.mjs';
import { goodsSettlementExitBlockers } from './goods-settlement.mjs';
import { qualificationEligibility, qualificationImpacts } from './tech-qualification.mjs';
import { fulfilmentBlockers } from './fulfilment.mjs';

const rows = (s, key) => Array.isArray(s?.[key]) ? s[key] : [];
const cents = n => Number.isSafeInteger(n) && n >= 0;
const time = n => Number.isSafeInteger(n) && n >= 0;
const amount = n => cents(n) ? n : null;
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
// The original canonical facts remain the input. Only an opaque digest leaves
// the projection; this fingerprint supplies concurrency checks, not authority.
function sha256(text) {
  const input=new TextEncoder().encode(text),length=Math.ceil((input.length+9)/64)*64;
  const bytes=new Uint8Array(length),data=new DataView(bytes.buffer);
  bytes.set(input);bytes[input.length]=0x80;
  data.setUint32(length-8,Math.floor(input.length/0x20000000));data.setUint32(length-4,(input.length*8)>>>0);
  const constants=[0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  const hash=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19],words=new Uint32Array(64);
  const rotate=(value,bits)=>(value>>>bits)|(value<<(32-bits));
  for(let offset=0;offset<length;offset+=64) {
    for(let i=0;i<16;i++)words[i]=data.getUint32(offset+i*4);
    for(let i=16;i<64;i++) {
      const x=words[i-15],y=words[i-2];
      words[i]=(words[i-16]+(rotate(x,7)^rotate(x,18)^(x>>>3))+words[i-7]+(rotate(y,17)^rotate(y,19)^(y>>>10)))>>>0;
    }
    let [a,b,c,d,e,f,g,h]=hash;
    for(let i=0;i<64;i++) {
      const first=(h+(rotate(e,6)^rotate(e,11)^rotate(e,25))+((e&f)^(~e&g))+constants[i]+words[i])>>>0;
      const second=((rotate(a,2)^rotate(a,13)^rotate(a,22))+((a&b)^(a&c)^(b&c)))>>>0;
      h=g;g=f;f=e;e=(d+first)>>>0;d=c;c=b;b=a;a=(first+second)>>>0;
    }
    [a,b,c,d,e,f,g,h].forEach((value,i)=>hash[i]=(hash[i]+value)>>>0);
  }
  return hash.map(value=>value.toString(16).padStart(8,'0')).join('');
}
export const lifecycleFingerprint = value => 'sha256:'+sha256(JSON.stringify(canonical(value)));
const token = lifecycleFingerprint;
const pick = (value, keys) => Object.fromEntries(keys.map(key => [key, value?.[key] ?? null]));
const path = (section, id) => `/group/${section==='booking'?'bookings':section}${id == null ? '' : '/' + encodeURIComponent(id)}`;
const incomePath = row => path('service-finance/income')+'?techId='+encodeURIComponent(row.techId)+'&month='+encodeURIComponent(row.month||'');
const financeActor = { role: 'group', job: 'finance' };
const OPEN_BOOKING = new Set(['unpaid', 'waiting', 'confirmed', 'active', 'interrupted']);
const OPEN_REFUND = new Set(['requested', 'offered', 'approved', 'processing', 'failed', 'escalated']);
const CORE = ['bookings','techs','stores','goods','bills','recoveries','serviceFinanceEntries','serviceFinanceRecoveries','techIncomeEntries','techIncomeDifferences','techIncomePayouts','servicePromoters','serviceCommissions','servicePromotionWithdrawals','servicePromotionRecoveries','servicePromotionOffsets','servicePromotionInvites','servicePromotionRisks','serviceRefundShortages','serviceExtraEvidence','serviceExtraRecoveries','serviceExtraOffsets','goodsOffsetPlans'];
const META = ['id','version','bookingId','paymentId','storeId','techId','userId','status','createdAt','updatedAt','completedAt','dueAt','amountCents','receivedCents','recoveredCents','remainingCents','personKey','promoterId','ownerStoreId','sourceToken'];

function context(s, scope) {
  if (!scope || typeof scope !== 'object' || Array.isArray(scope) || Object.keys(scope).length !== 1 || !['techId','storeId'].includes(Object.keys(scope)[0])) throw new Error('生命周期范围须且只能指定techId或storeId');
  const key = Object.keys(scope)[0], id = scope[key];
  if (typeof id !== 'string' || !id.trim() || id !== id.trim()) throw new Error('生命周期主体编号无效');
  const subjects = rows(s, key === 'techId' ? 'techs' : 'stores').filter(x => x.id === id);
  if (subjects.length !== 1) throw new Error('生命周期主体不存在或编号不唯一');
  const subject = subjects[0];
  // Normalize only the private getter input. Missing containers remain explicit blockers.
  const read = { ...s, ...Object.fromEntries(CORE.map(k => [k, rows(s,k)])) };
  const technical = key === 'techId', techIds = new Set(technical ? [id] : rows(s,'techs').filter(x => x.storeId === id).map(x => x.id));
  const factRows = rows(s,'fulfilmentRecords').filter(x => !technical ? x.storeId === id || rows(s,'bookings').some(b => b.id === x.bookingId && b.storeId === id) : (x.facts || []).some(f => f.techId === id));
  const departureRows = rows(s,'fulfilmentDepartures').filter(x => technical ? x.techId === id : x.storeId === id);
  const involvedIds = new Set([...factRows, ...departureRows].map(x => x.bookingId));
  const operational = rows(s,'bookings').filter(b => technical ? b.techId === id || b.change?.status === 'pending' && b.change.techId === id || involvedIds.has(b.id) : b.storeId === id || b.change?.status === 'pending' && b.change.storeId === id);
  const promoterRows = rows(s,'servicePromoters').filter(p => technical ? p.personKind === 'tech' && p.personId === id || subject.userId && p.personKind === 'user' && p.personId === subject.userId : p.ownerStoreId === id);
  const personKeys = new Set(promoterRows.map(p => `${p.personKind}:${p.personId}`));
  if (technical) { personKeys.add(`tech:${id}`); if (subject.userId) personKeys.add(`user:${subject.userId}`); }
  const techMoney = rows(s,'techIncomeEntries').filter(x => technical ? x.techId === id : x.storeId === id);
  const commissions = rows(s,'serviceCommissions').filter(c => technical ? personKeys.has(c.personKey) : c.storeId === id || personKeys.has(c.personKey));
  const moneyBookingIds = new Set([...operational, ...techMoney, ...commissions].map(x => x.bookingId || x.id));
  const financialBookings = rows(s,'bookings').filter(b => technical ? moneyBookingIds.has(b.id) : b.storeId === id);
  if (!technical) for (const row of [...operational,...techMoney,...factRows,...departureRows]) {
    if (row.techId) techIds.add(row.techId);
    for (const fact of row.facts || []) if (fact.techId) techIds.add(fact.techId);
  }
  const selected = (key, predicate) => rows(s,key).filter(predicate);
  const localMoney = row => technical ? moneyBookingIds.has(row.bookingId) : row.storeId === id;
  return { s, read, scope: { [key]:id }, key, id, subject, technical, techIds, promoterRows, personKeys, commissions, techMoney, operational, financialBookings, factRows, departureRows, selected, localMoney };
}

function base(kind, source, section, reason, extra = {}) {
  const id = typeof source?.id === 'string' ? source.id : `missing:${kind}`;
  const target=section==='service-finance'?path('service-finance/ledger'):section==='service-promotion'?path('service-promotion/commissions'):path(section,id);
  const row = { kind, sourceId:id, version:Number.isSafeInteger(source?.version) ? source.version : null, path:target, reason, amountCents:null, ...pick(source,['bookingId','paymentId','storeId','techId','status','createdAt','dueAt']), ...extra };
  row.sourceToken = token({ kind, source:pick(source,META), projection:row });
  return row;
}

function append(out, group, row, blocked = false, retained = false) {
  if (group) out.groups[group].push(row);
  if (blocked) out.blockers.push(row);
  if (retained) out.retainedRights.push(row);
  return row;
}

function getter(out, kind, source, section, fn) {
  try { return fn(); } catch {
    append(out,null,base(kind,source,section,'原来源getter无法核验，须核对原记录结构', { status:'needs-review' }),true);
    return null;
  }
}

function distinct(out, group, list, section) {
  const seen = new Set();
  for (const row of list) {
    if (typeof row.id !== 'string' || !row.id || seen.has(row.id)) append(out,group,base('source-invalid',row,section,'原记录编号缺失或重复，不能判定清算', { status:'needs-review' }),true);
    seen.add(row.id);
  }
}

function missing(out, c) {
  for (const name of CORE) if (!Array.isArray(c.s[name])) append(out,null,base('source-container-missing',{id:name},'service-finance','原'+name+'容器缺失，清算来源待核验',{status:'needs-review',path:path('service-finance/ledger')}),true);
  if (!time(c.s.now)) append(out,null,base('source-clock-missing',{id:c.id},c.technical?'technicians':'stores','原业务时钟缺失，生效及原账期限待核验',{status:'needs-review'}),true);
}

function serviceRows(out, c) {
  const entries = c.selected('serviceFinanceEntries',c.localMoney);
  distinct(out,'serviceFinance',c.financialBookings,'booking');
  distinct(out,'serviceFinance',entries,'service-finance');
  const matches = (bookingId,paymentId) => entries.filter(x => x.bookingId === bookingId && x.paymentId === paymentId);
  for (const b of c.financialBookings) {
    if (!b.payment || !['unpaid','success','failed','processing','expired','cancelled'].includes(b.payment.status)) append(out,'serviceFinance',base('service-payment-source',b,'booking','原主支付状态缺失或无效，不能按无资金处理',{status:'needs-review'}),true);
    for (const p of [b.payment,...(b.extensions || [])].filter(Boolean)) {
      if (p.status === 'processing') append(out,'serviceFinance',base('service-payment-unknown',p,'booking','原服务支付结果未知，先查询原笔',{bookingId:b.id,storeId:b.storeId,path:path('booking',b.id),amountCents:amount(p.amountCents)}),true);
      if (p.status !== 'success') continue;
      const own = matches(b.id,p.id);
      if (own.length !== 1) append(out,'serviceFinance',base('service-entry-missing',p,'service-finance','成功原支付缺少唯一服务账来源，不能按零处理',{bookingId:b.id,storeId:b.storeId,amountCents:amount(p.amountCents),status:'needs-review',path:path('booking',b.id)}),true);
    }
    distinct(out,'refunds',b.refunds||[],'booking');
    for (const r of b.refunds || []) {
      const executions = r.executions || [];
      const unknown = executions.some(x => x.status === 'processing') || r.status === 'processing';
      const known = cents(r.amountCents) && ['requested','offered','approved','processing','failed','escalated','success','rejected','withdrawn'].includes(r.status) && executions.every(x=>cents(x.amountCents)&&['approved','processing','failed','success'].includes(x.status));
      const blocked = !known || unknown || OPEN_REFUND.has(r.status) || r.status === 'rejected' && time(r.deadline) && c.s.now < r.deadline;
      append(out,'refunds',base('service-refund',r,'booking',!known?'原退款金额或执行状态待核对':blocked ? unknown?'原服务退款结果未知，先查询原笔':'原服务退款/确认尚未结束':'原服务退款处理事实保留',{bookingId:b.id,storeId:b.storeId,path:path('booking',b.id),amountCents:known?r.amountCents:null,known,unknown,executions:executions.map(x=>pick(x,['paymentId','refundNo','status','amountCents','updatedAt']))}),blocked,!blocked);
    }
  }
  for (const e of entries) {
    const b = rows(c.s,'bookings').filter(x=>x.id===e.bookingId), ps = b.length===1?[b[0].payment,...(b[0].extensions || [])].filter(x=>x?.id===e.paymentId):[];
    const rawKnown = b.length===1 && ps.length===1 && cents(ps[0].amountCents) && cents(ps[0].refundedCents) && ps[0].refundedCents <= ps[0].amountCents;
    const v = rawKnown ? getter(out,'service-getter-invalid',e,'service-finance',()=>serviceFinanceSummary(c.read,e.bookingId,e.paymentId)) : null;
    const known = Boolean(rawKnown && v?.known && [v.paidCents,v.refundedCents,v.netCents,v.targetGroupCents].every(cents));
    const blocked = !known || !['settled','void'].includes(v?.status);
    append(out,'serviceFinance',base('service-finance',e,'service-finance',!rawKnown?'原预约、支付或退款金额来源缺失/冲突，须核对':v?.eligibilityReason||'原服务资金未结清',{status:v?.status||'needs-review',known,amountCents:known?v.pendingAdditionalCents:null,paidCents:amount(v?.paidCents),refundedCents:rawKnown?amount(v?.refundedCents):null,netCents:rawKnown?amount(v?.netCents):null,pendingReturnCents:amount(v?.totalReturnPendingCents),unknownChannel:Boolean(v?.unknownChannel),unknownRefund:Boolean(v?.unknownRefund),forceAt:v?.forceAt??null,expiresAt:v?.expiresAt??null,canPayTech:Boolean(v?.canPayTech),path:path('service-finance/entry',e.id)}),blocked);
  }
  for (const d of c.selected('serviceFinanceRecoveries',c.localMoney)) {
    const known = cents(d.amountCents) && cents(d.receivedCents) && d.receivedCents <= d.amountCents;
    const left = known ? d.amountCents-d.receivedCents : null;
    append(out,'serviceFinance',base('service-recovery',d,'service-finance',!known?'原服务追偿金额缺失':'按原服务追偿事实办理',{amountCents:left,known,path:path('service-finance/recoveries') }),!known || left>0 || d.status==='channel_pending');
  }
}

function incomeRows(out,c) {
  const view = getter(out,'income-getter-invalid',{id:c.id},'service-finance',()=>techIncomeView(c.read,financeActor));
  distinct(out,'techIncome',c.techMoney,'service-finance');
  for (const e of c.techMoney) {
    const projected = view?.entries.filter(x=>x.id===e.id) || [];
    const source = rows(c.s,'bookings').some(b=>b.id===e.bookingId && b.storeId===e.storeId);
    const payouts = rows(c.s,'techIncomePayouts').filter(p=>p.storeId===e.storeId&&p.techId===e.techId&&p.month===e.month);
    const differences = rows(c.s,'techIncomeDifferences').filter(d=>d.entryId===e.id);
    const recordsKnown = payouts.every(p=>p.status==='paid'&&cents(p.amountCents)&&time(p.paidAt)&&p.paidAt<=c.s.now&&typeof p.proof==='string'&&p.proof.trim()&&Array.isArray(p.lines)&&p.lines.length>0&&new Set(p.lines.map(l=>l.entryId)).size===p.lines.length&&p.lines.reduce((sum,l)=>sum+l.amountCents,0)===p.amountCents&&p.lines.every(l=>{const entry=c.techMoney.find(x=>x.id===l.entryId);return cents(l.amountCents)&&entry&&entry.storeId===p.storeId&&entry.techId===p.techId&&entry.month===p.month&&entry.bookingId===l.bookingId&&entry.paymentId===l.paymentId&&time(entry.earnedAt)&&p.paidAt>=entry.earnedAt;})) && differences.every(d=>Array.isArray(d.records)&&d.records.every(r=>cents(r.amountCents)&&['supplement','recover'].includes(r.kind)&&typeof r.proof==='string'&&r.proof.trim()&&time(r.occurredAt)&&r.occurredAt>=d.createdAt&&r.occurredAt<=c.s.now));
    const paid = recordsKnown?payouts.flatMap(p=>p.lines.filter(l=>l.entryId===e.id)).reduce((sum,l)=>sum+l.amountCents,0)+differences.flatMap(d=>d.records.filter(r=>r.kind==='supplement')).reduce((sum,r)=>sum+r.amountCents,0):null;
    const recovered = recordsKnown?differences.flatMap(d=>d.records.filter(r=>r.kind==='recover')).reduce((sum,r)=>sum+r.amountCents,0):null;
    const known = source && projected.length===1 && [e.amountCents,e.paidCents,e.recoveredCents,e.payableCents].every(cents) && recordsKnown && paid===e.paidCents && recovered===e.recoveredCents && ['pending','held','difference','payable','paid','void'].includes(e.status);
    const remaining = known ? Math.max(0,e.amountCents-(e.paidCents-e.recoveredCents)) : null;
    const blocked = !known || ['pending','held','difference','payable'].includes(e.status) || remaining>0;
    append(out,'techIncome',base('tech-income',e,'service-finance',!known?'原提成来源、金额或实际发放流水待核对':e.reason||'按原店原月份提成台账清算',{amountCents:remaining,known,month:e.month??null,paidCents:known?e.paidCents:null,recoveredCents:known?e.recoveredCents:null,payoutIds:payouts.filter(p=>p.lines?.some(l=>l.entryId===e.id)).map(p=>p.id),differenceIds:differences.map(d=>d.id),path:incomePath(e) }),blocked,!blocked);
  }
  for (const d of c.selected('techIncomeDifferences',x=>c.technical?x.techId===c.id:x.storeId===c.id)) {
    const known = cents(d.remainingCents) && c.techMoney.some(x=>x.id===d.entryId);
    append(out,'techIncome',base('tech-income-difference',d,'service-finance',known?'原已发提成差额须实际补发或收回':'原提成差额来源待核对',{known,amountCents:known?d.remainingCents:null,month:d.month??null,path:incomePath(d)}),!known||d.status==='open'||d.remainingCents>0);
  }
  for (const b of c.financialBookings) if (b.status==='done') for (const p of [b.payment,...(b.extensions || [])].filter(p=>p?.status==='success' && p.amountCents>0)) {
    // Absence is not a zero commission. A successful full refund has no remaining pay claim.
    if (c.technical && b.techId!==c.id) continue;
    if (p.amountCents===p.refundedCents) continue;
    if (!c.techMoney.some(e=>e.bookingId===b.id&&e.paymentId===p.id)) append(out,'techIncome',base('tech-income-missing',p,'service-finance','原完成服务缺少提成来源，不能默认零',{bookingId:b.id,storeId:b.storeId,techId:b.techId,status:'needs-review'}),true);
  }
}

function extrasRows(out,c) {
  const storeIds = new Set(c.technical ? c.financialBookings.map(b=>b.storeId) : [c.id]);
  for (const storeId of storeIds) {
    const v = getter(out,'service-extra-getter-invalid',{id:storeId},'service-finance/extras/shortages',()=>serviceFinanceExtrasExitBlockers(c.read,storeId));
    if (!v) continue;
    for (const [bucket,key,section,moneyKey] of [['evidence','serviceExtraEvidence','evidence',null],['refunds','serviceRefundShortages','shortages','refundCents'],['recoveries','serviceExtraRecoveries','recoveries','outstandingCents'],['offsets','serviceExtraOffsets','offsets','returnPendingCents']]) {
      const originals = c.selected(key,row=>row.storeId===storeId&&c.localMoney(row));
      distinct(out,'serviceExtras',originals,'service-finance/extras/'+section);
      for (const raw of originals) {
        const match = (v[bucket]||[]).filter(x=>x.id===raw.id);
        const source = rows(c.s,'bookings').filter(b=>b.id===raw.bookingId&&b.storeId===raw.storeId);
        const payments = source.length===1?[source[0].payment,...(source[0].extensions||[])].filter(p=>p?.id===raw.paymentId):[];
        let known = source.length===1 && payments.length===1;
        if (bucket==='refunds') known &&= cents(raw.refundCents) && source[0].refunds?.some(r=>r.id===raw.refundId&&(r.executions||[]).some(x=>x.paymentId===raw.paymentId&&x.refundNo===raw.refundNo));
        if (bucket==='recoveries') known &&= cents(raw.amountCents) && cents(raw.receivedCents) && Array.isArray(raw.records) && raw.records.every(r=>cents(r.amountCents)) && rows(c.s,'serviceRefundShortages').some(i=>i.id===raw.shortageId&&(i.advances||[]).some(a=>a.id===raw.advanceId&&a.execution?.status==='success'));
        if (bucket==='offsets') known &&= [raw.normalCents,raw.recoveryCents,raw.requiredReturnCents].every(cents) && Array.isArray(raw.returnRecords) && raw.returnRecords.every(r=>cents(r.amountCents)) && rows(c.s,'serviceExtraRecoveries').some(d=>d.id===raw.recoveryId&&d.storeId===raw.storeId);
        const blocked = match.length>0 || !known || match.some(x=>moneyKey && !cents(x[moneyKey]));
        append(out,'serviceExtras',base('service-extra-'+bucket,raw,'service-finance/extras/'+section,!known?'原特殊事项金额、流水或原支付来源待核对':blocked?'原服务特殊事项尚未清结':'原服务特殊事项事实保留',{known:Boolean(known),amountCents:known&&match.length===1&&moneyKey?amount(match[0][moneyKey]):null}),blocked);
      }
    }
  }
}

function promotionRows(out,c) {
  const view = getter(out,'promotion-getter-invalid',{id:c.id},'service-promotion',()=>servicePromotionView(c.read,financeActor));
  const exited = getter(out,'promotion-exit-invalid',{id:c.id},'service-promotion',()=>servicePromotionExitBlockers(c.read,c.scope));
  const scopePromoters = new Set(c.promoterRows.map(x=>x.id));
  distinct(out,'servicePromotion',c.commissions,'service-promotion/commissions');
  for (const raw of c.commissions) {
    const found = view?.commissions.filter(x=>x.id===raw.id) || [], v = found[0];
    const promoter = rows(c.s,'servicePromoters').filter(x=>x.id===raw.promoterId);
    const source = rows(c.s,'bookings').some(b=>b.id===raw.bookingId);
    const funds = source ? getter(out,'promotion-funding-invalid',raw,'service-promotion/commissions',()=>serviceFinanceSummary(c.read,raw.bookingId,raw.paymentId)) : null;
    const known = raw.known===true && source && promoter.length===1 && found.length===1 && [raw.commissionCents,v.availableCents,v.paidCents,v.lockedCents].every(cents) && funds?.known && raw.commissionCents===funds.commissionCents;
    const retained = known && v.availableCents>0;
    const blocked = !known || v.lockedCents>0 || raw.status==='pending' && raw.commissionCents>0;
    append(out,'servicePromotion',base('service-commission',raw,'service-promotion/commissions',!known?'原个人佣金及身份来源待核对':retained?'已成立可提现权利保留，普通停用不得没收':blocked?'原个人佣金尚未结清或正在提现':'原个人佣金实际事实保留',{known,amountCents:known?v.availableCents:null,availableCents:known?v.availableCents:null,paidCents:known?v.paidCents:null,lockedCents:known?v.lockedCents:null}),blocked,retained);
  }
  for (const raw of c.selected('servicePromotionWithdrawals',x=>c.personKeys.has(x.personKey)||scopePromoters.has(x.promoterId))) {
    const v = view?.withdrawals.find(x=>x.id===raw.id);
    const known = cents(raw.amountCents) && Array.isArray(raw.allocations) && raw.allocations.every(a=>[a.amountCents,a.storeCents,a.groupCents].every(cents)&&a.storeCents+a.groupCents===a.amountCents&&c.commissions.some(x=>x.id===a.commissionId)) && rows(c.s,'servicePromoters').some(x=>x.id===raw.promoterId&&`${x.personKind}:${x.personId}`===raw.personKey);
    const blocked = !known || !v || exited?.withdrawals.some(x=>x.id===raw.id) || !['paid','cancelled'].includes(raw.status);
    append(out,'servicePromotion',base('service-withdrawal',raw,'service-promotion/withdrawals',!known?'原提现金额/分配或本人来源待核对':blocked?'原个人转账须沿原笔查询/确认/重试，不结束旧收款权利':'原提现事实保留',{known,amountCents:known?raw.amountCents:null,requestNo:raw.execution?.requestNo??null,confirmExpiresAt:raw.confirmExpiresAt??null}),Boolean(blocked),!blocked);
  }
  for (const raw of c.selected('servicePromotionRecoveries',x=>c.technical?c.personKeys.has(x.personKey):x.storeId===c.id||c.personKeys.has(x.personKey))) {
    const v = view?.recoveries.find(x=>x.id===raw.id), unresolved = exited?.recoveries.find(x=>x.id===raw.id);
    const commission = c.commissions.find(x=>x.id===raw.commissionId), known = Boolean(commission?.known && cents(raw.amountCents) && v && cents(v.outstandingCents) && cents(v.returnPendingCents));
    append(out,'servicePromotion',base('service-promotion-recovery',raw,'service-promotion/recoveries',known?'原个人佣金扣回及超收退回按原账办理':'原个人佣金债务来源待核对',{known,amountCents:known?v.outstandingCents:null,returnPendingCents:known?v.returnPendingCents:null}),!known||Boolean(unresolved)||known&&(v.outstandingCents>0||v.returnPendingCents>0));
  }
}

function goodsRows(out,c,options) {
  if (c.technical) return;
  const goods = c.selected('goods',o=>o.source?.storeId===c.id);
  distinct(out,'goods',goods,'goods');
  for (const o of goods) {
    const rawKnown = cents(o.paidCents) && cents(o.commissionPaidCents) && Array.isArray(o.lines) && o.lines.every(l=>[l.paidCents,l.refundedCents,l.commissionBps].every(cents) && l.refundedCents<=l.paidCents) && Array.isArray(o.refunds) && Array.isArray(o.cases);
    const v = rawKnown && typeof options.goodsSummary==='function' ? getter(out,'goods-getter-invalid',o,'goods',()=>options.goodsSummary(c.read,o)) : null;
    const known = rawKnown && v && [v.commissionCents,v.debtCents].every(cents);
    const missingAdapter = typeof options.goodsSummary!=='function';
    const pending = o.payment?.status==='processing' || o.refunds?.some(r=>['approved','processing','failed'].includes(r.status)) || o.cases?.some(x=>!['closed','done','rejected'].includes(x.status)) || o.incidents?.some(x=>x.status!=='done');
    const owed = known ? Math.max(0,v.commissionCents-o.commissionPaidCents) : null;
    const blocked = !known || pending || owed>0 || v.debtCents>0 || !['received','closed','cancelled'].includes(o.status);
    append(out,'goods',base('goods-source',o,'goods',missingAdapter?'原商品计佣getter尚未接线':!known?'原商品金额/计佣来源待核对':pending?'原来源商品支付/退款/异常尚未结案':v.commissionReason||(blocked?'原商品佣金及追回尚未清算':'原商品资金事实保留'),{known:Boolean(known),amountCents:owed,commissionCents:known?v.commissionCents:null,commissionPaidCents:rawKnown?o.commissionPaidCents:null,debtCents:known?v.debtCents:null,receivedAt:time(o.receivedAt)?o.receivedAt:null,waitDays:time(o.waitDays)?o.waitDays:null}),Boolean(blocked));
  }
  const exit = getter(out,'goods-exit-invalid',{id:c.id},'bills',()=>goodsSettlementExitBlockers(c.read,c.id));
  for (const [bucket,key,section] of [['bills','bills','bills'],['debts','recoveries','recoveries'],['plans','goodsOffsetPlans','bills']]) {
    const originals = c.selected(key,x=>x.storeId===c.id);
    distinct(out,'goodsSettlement',originals,section);
    for (const raw of originals) {
      const v = exit?.[bucket].find(x=>x.id===raw.id), money = bucket==='debts'?raw.amountCents:bucket==='plans'?raw.grossCents:raw.amountCents;
      const known = cents(money) && (bucket!=='debts'||cents(raw.recoveredCents) && goods.some(o=>o.id===raw.orderId)) && (bucket!=='bills'||Array.isArray(raw.items) && raw.items.every(x=>goods.some(o=>o.id===x.orderId)&&cents(x.amountCents))) && (bucket!=='plans'||rows(c.s,'bills').some(b=>b.id===raw.billId&&b.storeId===c.id));
      const blocked = !known || !exit || Boolean(v);
      append(out,'goodsSettlement',base('goods-'+bucket,raw,section,known?'按原商品账单、债务及占额办理':'原商品账源或金额待核对',{known,amountCents:bucket==='debts'?known?Math.max(0,raw.amountCents-raw.recoveredCents):null:amount(money),reservedCents:amount(v?.reservedCents),cashCents:amount(raw.cashCents),offsetCents:amount(raw.offsetCents),path:bucket==='debts'?path('recoveries'):path(section,bucket==='plans'?raw.billId:raw.id)}),blocked);
    }
  }
}

function qualificationRows(out,c) {
  for (const techId of c.techIds) {
    const tech=rows(c.s,'techs').find(x=>x.id===techId);
    const originals=c.operational.filter(b=>b.techId===techId), income=c.techMoney.filter(e=>e.techId===techId);
    const storeIds=new Set(c.technical?[tech?.storeId,...originals.map(b=>b.storeId),...income.map(e=>e.storeId)]:[c.id]);
    for (const storeId of storeIds) {
      if (!storeId) continue;
      const profiles=rows(c.s,'techQualifications').filter(x=>x.techId===techId&&x.storeId===storeId);
      const current=tech?.storeId===storeId, selectedId=current?tech?.qualificationProfileId:null;
      const candidates=selectedId?profiles.filter(x=>x.id===selectedId):profiles;
      const profile=candidates.length===1?candidates[0]:null;
      const conflict=candidates.length>1||Boolean(selectedId&&!profile)||!selectedId&&profiles.length>1;
      const ownBookings=originals.filter(b=>b.storeId===storeId);
      const serviceIds=new Set([...(current?tech?.serviceIds||[]:[]),...ownBookings.map(b=>b.serviceId),...income.filter(e=>e.storeId===storeId).map(e=>e.serviceId).filter(Boolean),...(profile?.grants||[]).flatMap(g=>g.serviceIds||[])]);
      for (const serviceId of serviceIds) {
        const eligibility=getter(out,'qualification-getter-invalid',{id:techId},'qualifications',()=>qualificationEligibility(c.read,techId,serviceId,c.s.now,storeId));
        const allHolds=rows(c.s,'techQualifications').filter(x=>x.techId===techId).flatMap(x=>(x.holds||[]).filter(h=>h.status==='open'&&h.serviceIds?.includes(serviceId)));
        const impacts=getter(out,'qualification-impact-invalid',{id:techId},'qualifications',()=>qualificationImpacts(c.read,techId,[serviceId]))||[];
        out.qualifications.push(base('qualification',{id:profile?.id||techId,version:profile?.version,techId,storeId},'qualifications','原项目资格、暂停及旧来源分别核验',{
          serviceId,current,path:path('qualifications',techId),profileId:profile?.id??null,allowed:!conflict&&Boolean(eligibility?.allowed),legacy:Boolean(eligibility?.legacy),known:!conflict&&!eligibility?.legacy&&Boolean(profile),
          qualificationReason:conflict?'资格来源缺失或不唯一，须核对':eligibility?.reason??'资格getter无法核验',
          credentials:{reviewStatus:tech?.reviewStatus??null,certificateRecorded:Boolean(tech?.certificate),insuranceRecorded:Boolean(tech?.insurance),validUntil:tech?.validUntil??null},
          grantIds:(profile?.grants||[]).filter(g=>g.status==='approved'&&g.serviceIds?.includes(serviceId)).map(g=>g.id),holdIds:allHolds.map(h=>h.id),
          originalBookingIds:ownBookings.filter(b=>b.serviceId===serviceId).map(b=>b.id),
          assignmentSources:ownBookings.filter(b=>b.serviceId===serviceId&&b.technicianAssignmentSnapshot).map(b=>({bookingId:b.id,snapshotId:b.technicianAssignmentSnapshot.id,qualification:pick(b.technicianAssignmentSnapshot.qualification,['legacy','storeId','profileId','serviceId','grantId','assessmentId'])})),
          impacts:impacts.filter(x=>c.technical||x.storeId===c.id).map(x=>pick(x,['bookingId','storeId','current','proposed','stage','needsCoordination']))
        }));
      }
    }
  }
}

export function lifecycleSettlement(s,scope,options={}) {
  const c = context(s,scope), out = {scope:c.scope,at:time(s.now)?s.now:null,groups:Object.fromEntries(['serviceFinance','refunds','techIncome','serviceExtras','servicePromotion','goods','goodsSettlement'].map(k=>[k,[]])),blockers:[],retainedRights:[]};
  missing(out,c); serviceRows(out,c); incomeRows(out,c); extrasRows(out,c); promotionRows(out,c); goodsRows(out,c,options);
  out.clear=out.blockers.length===0;
  out.sourceToken=token(out);
  return out;
}

export function lifecycleImpact(s,scope,options={}) {
  const c=context(s,scope), settlement=lifecycleSettlement(s,scope,options);
  const out={scope:c.scope,at:time(s.now)?s.now:null,subject:pick(c.subject,['id','version','storeId','userId','active','reviewStatus','lifecycleStatus','closingAt','closedAt','departureStartedAt','leftAt']),bookings:[],fulfilment:[],qualifications:[],authorizations:[],settlement,blockers:[...settlement.blockers],retainedRights:[...settlement.retainedRights]};
  distinct(out,null,c.operational,'booking');
  for(const b of c.operational) {
    const facts=c.factRows.filter(x=>x.bookingId===b.id).flatMap(x=>(x.facts||[]).filter(f=>!c.technical||f.techId===c.id));
    const trusted=facts.filter(f=>!f.replacedBy&&['confirmed','verified'].includes(f.status));
    const current=c.technical?b.techId===c.id:b.storeId===c.id,proposed=b.change?.status==='pending'&&(c.technical?b.change.techId===c.id:(b.change.storeId||b.storeId)===c.id);
    const started=Boolean(current&&(time(b.departedAt)||time(b.arrivedAt)||time(b.startedAt)||['active','interrupted'].includes(b.status))||trusted.some(f=>['departure','arrival'].includes(f.kind)));
    const disputed=facts.some(f=>!f.replacedBy&&['pending-tech','reported','disputed'].includes(f.status)&&['departure','arrival'].includes(f.kind));
    const pending=current&&OPEN_BOOKING.has(b.status)||proposed,stage=['done','cancelled','closed'].includes(b.status)?'ended':started?'fulfilling':disputed?'needs-review':'not-started';
    const row=base('booking',b,'booking',disputed?'实际出发/到达仍待确认或核实':started?'原履约继续完成或走客服处理':pending?'原安排/拟安排须逐笔协调':'原历史订单及用户权利保留',{current,proposed,stage,needsCoordination:proposed||pending&&!started,startAt:time(b.startAt)?b.startAt:null,startedAt:time(b.startedAt)?b.startedAt:null,completedAt:time(b.completedAt)?b.completedAt:null,proposedTechId:proposed?b.change.techId??null:null,proposedStartAt:proposed?b.change.startAt??null:null,changeId:proposed?b.change.id??null:null,changeExpiresAt:proposed?b.change.expiresAt??null:null,factIds:facts.map(f=>f.id)});
    out.bookings.push(row);if(pending||disputed)out.blockers.push(row);else out.retainedRights.push(row);
    const safety=fulfilmentBlockers(c.read,b.id);
    if(safety.length)out.blockers.push(base('fulfilment-safety',b,'fulfilment',safety.join('；'),{path:path('fulfilment',b.id)}));
  }
  for(const record of c.factRows)for(const fact of record.facts||[]){if(c.technical&&fact.techId!==c.id)continue;out.fulfilment.push(base('fulfilment-fact',{...fact,bookingId:record.bookingId,storeId:record.storeId},'fulfilment','原独立履约事实及确认/核实来源保留',{path:path('fulfilment',record.bookingId),factKind:fact.kind??null,occurredAt:time(fact.occurredAt)?fact.occurredAt:null,recordedAt:time(fact.recordedAt)?fact.recordedAt:null,confirmationState:fact.confirmationState??null}));}
  for(const departure of c.departureRows){const unresolved=!['confirmed','resolved'].includes(departure.status);const row=base('safe-departure',departure,'fulfilment',unresolved?'实际安全离开尚未核实，原事项继续办理':'原安全离开结案事实保留',{path:path('fulfilment',departure.bookingId),endingAt:time(departure.endingAt)?departure.endingAt:null,contactDueAt:departure.contactDueAt??null,escalationDueAt:departure.escalationDueAt??null});out.fulfilment.push(row);if(unresolved)out.blockers.push(row);}
  qualificationRows(out,c);
  for(const account of rows(s,'staffAccounts'))for(const grant of account.grants||[]){if(c.technical?grant.techId!==c.id&&account.techId!==c.id:grant.storeId!==c.id)continue;const effective=account.enabled&&grant.enabled&&(grant.validFrom==null||time(grant.validFrom)&&grant.validFrom<=s.now)&&(grant.validTo==null||time(grant.validTo)&&s.now<grant.validTo);const sessions=rows(s,'staffSessions').filter(x=>x.accountId===account.id&&x.grantId===grant.id);out.authorizations.push(base('staff-authorization',{...grant,version:account.version},'accounts','工作授权生效、结束及旧事项承接按原账号来源核验',{path:path('accounts',account.id),accountId:account.id,job:grant.job??null,effective:Boolean(effective),validFrom:grant.validFrom??null,validTo:grant.validTo??null,purpose:grant.purpose??null,sessions:sessions.map(x=>pick(x,['id','accountVersion','issuedAt','expiresAt','revokedAt']))}));}
  out.sourceToken=token(out);
  return out;
}

// Freeze only source identities. Amounts, status and authority always come from
// the original current sources; future child refunds retain the original parent.
export function captureLifecycleResponsibilities(s,c,options={}) {
  const scope=c.kind==='store-close'?{storeId:c.storeId}:{techId:c.techId};
  const full=lifecycleImpact(s,scope,options),cx=context(s,scope);
  const bookingIds=new Set([...full.bookings.map(b=>b.sourceId),...Object.values(full.settlement.groups).flat().map(x=>x.bookingId).filter(Boolean)]);
  const arrangements=cx.operational.map(b=>({bookingId:b.id,techId:b.techId,proposedTechId:b.change?.status==='pending'?b.change.techId:null,proposedChangeId:b.change?.status==='pending'?b.change.id:null}));
  const basis={version:1,caseId:c.id,kind:c.kind,scope,fromStoreId:c.fromStoreId,cutoffAt:c.effectiveAt,recordedAt:s.now,bookingIds:[...bookingIds],arrangements,promoterIds:cx.promoterRows.map(p=>p.id),commissionIds:cx.commissions.map(p=>p.id),goodsIds:full.settlement.groups.goods.filter(x=>x.kind==='goods-source').map(x=>x.sourceId),impactToken:full.sourceToken};
  basis.sourceToken=token(basis);return basis;
}

export function lifecycleCaseImpact(s,caseId,options={}) {
  const cases=rows(s,'organizationLifecycleCases').filter(c=>c.id===caseId);
  if(cases.length!==1)throw new Error('原生命周期case不存在或不唯一');
  const c=cases[0],scope=c.kind==='store-close'?{storeId:c.storeId}:{techId:c.techId};
  if(!['transfer','departure','store-close'].includes(c.kind))throw new Error('原生命周期case类型待核对');
  const full=lifecycleImpact(s,scope,options),basis=c.responsibilityBasis;
  const invalid=[];
  const issue=(id,reason)=>invalid.push(base('lifecycle-case-source',{id,storeId:c.fromStoreId,techId:c.techId},c.techId?'technicians':'stores',reason,{path:path(c.techId?'technicians':'stores',c.techId||c.storeId),status:'needs-review'}));
  if(!basis||basis.version!==1||basis.caseId!==c.id||basis.kind!==c.kind||basis.fromStoreId!==c.fromStoreId||basis.cutoffAt!==c.effectiveAt||!time(c.createdAt)||!time(c.effectiveAt)||c.createdAt>c.effectiveAt)issue(c.id,'原case起点、范围或生效来源缺失，不能猜滤清算');
  const allowedBases=[basis,...(c.responsibilityHistory||[])].filter(Boolean);
  for(const item of allowedBases){const {sourceToken,...facts}=item;if(sourceToken!==token(facts)||item.caseId!==c.id||item.kind!==c.kind||item.fromStoreId!==c.fromStoreId||item.cutoffAt!==c.effectiveAt||!time(item.recordedAt)||item.recordedAt<c.createdAt||item.recordedAt>s.now||token(item.scope)!==token(scope)||!['bookingIds','promoterIds','commissionIds','goodsIds'].every(k=>Array.isArray(item[k])&&item[k].every(id=>typeof id==='string'))||!Array.isArray(item.arrangements))issue(c.id,'原case范围依据已变化或字段缺失，须核对');}
  const coordinated=[];
  for(const item of allowedBases)for(const arrangement of item.arrangements||[])if(c.techId){
    const b=rows(s,'bookings').find(b=>b.id===arrangement.bookingId);
    if(!b){issue(arrangement.bookingId,'原协调预约已缺失，不能认已办理');continue;}
    if(b.techId===c.techId||b.change?.status==='pending'&&b.change.techId===c.techId||['done','cancelled','closed'].includes(b.status))continue;
    const accepted=[],history=(b.changeHistory||[]).filter(x=>x.status==='accepted'&&time(x.decidedAt)&&x.decidedAt>=item.recordedAt&&x.decidedAt<=s.now&&x.before?.techId&&x.after?.techId&&x.confirmedBy);
    let previous=b.techId;
    for(const change of history.toReversed())if(change.after.techId===previous){accepted.unshift(change);previous=change.before.techId;if(previous===c.techId)break;}
    const endedProposal=(b.changeHistory||[]).find(x=>x.id===arrangement.proposedChangeId&&['rejected','withdrawn','expired'].includes(x.status)&&time(x.decidedAt)&&x.decidedAt>=item.recordedAt&&x.decidedAt<=s.now);
    if(arrangement.techId===c.techId?previous!==c.techId:arrangement.proposedTechId===c.techId&&!endedProposal)issue(b.id,'原技师责任/拟安排已变化但缺少原改派或撤回事实');
    else if((arrangement.techId===c.techId||arrangement.proposedTechId===c.techId)&&!coordinated.some(x=>x.sourceId===b.id))coordinated.push(base('booking-coordinated',b,'booking','原改派/撤回已按原来源生效，该技师协调责任已结束',{resolvedForSubject:true,changeIds:accepted.map(x=>x.id),coordinationSourceToken:token({arrangement,recordedAt:item.recordedAt,accepted,endedProposal:endedProposal||null})}));
  }
  if(c.kind!=='transfer') {
    full.caseId=c.id;full.caseKind=c.kind;full.bookings.push(...coordinated);full.retainedRights.push(...coordinated);full.blockers.push(...invalid);delete full.sourceToken;full.sourceToken=token(full);return full;
  }
  const bookIds=new Set(allowedBases.flatMap(x=>x.bookingIds||[])),promoterIds=new Set(allowedBases.flatMap(x=>x.promoterIds||[])),commissionIds=new Set(allowedBases.flatMap(x=>x.commissionIds||[]));
  // An original store source appearing after a planned start is included up to
  // the true effective boundary. Child ledger creation time does not exclude it.
  for(const b of rows(s,'bookings'))if(b.storeId===c.fromStoreId&&(b.techId===c.techId||b.change?.status==='pending'&&b.change.techId===c.techId)){
    if(!time(b.createdAt))issue(b.id,'原店预约缺少创建时间，范围待核对');
    else if(b.createdAt<=c.effectiveAt)bookIds.add(b.id);
  }
  for(const p of rows(s,'servicePromoters'))if(p.personKind==='tech'&&p.personId===c.techId&&p.ownerStoreId===c.fromStoreId){if(!time(p.createdAt))issue(p.id,'原推广身份起点缺失，范围待核对');else if(p.createdAt<=c.effectiveAt)promoterIds.add(p.id);}
  for(const b of rows(s,'bookings'))if(promoterIds.has(b.servicePromotionSnapshot?.promoter?.id)){if(!time(b.createdAt))issue(b.id,'原推广订单缺少创建时间，范围待核对');else if(b.createdAt<=c.effectiveAt)bookIds.add(b.id);}
  for(const entry of rows(s,'techIncomeEntries'))if(entry.techId===c.techId&&entry.storeId===c.fromStoreId){const b=rows(s,'bookings').find(b=>b.id===entry.bookingId);if(!b)issue(entry.id,'原店提成关联预约缺失，不能排除旧责任');else if(!time(b.createdAt)||b.createdAt<=c.effectiveAt)bookIds.add(b.id);}
  for(const row of rows(s,'serviceCommissions'))if(bookIds.has(row.bookingId)||commissionIds.has(row.id))commissionIds.add(row.id);
  for(const id of bookIds)if(rows(s,'bookings').filter(b=>b.id===id).length!==1)issue(id,'原case预约来源缺失或重复，不能认已协调');
  for(const id of commissionIds)if(rows(s,'serviceCommissions').filter(x=>x.id===id).length!==1)issue(id,'原case佣金来源缺失或重复，不能认已结清');
  const selectedIds=new Set([...bookIds,...commissionIds]);
  for(const key of CORE)for(const row of rows(s,key)){
    if(bookIds.has(row.bookingId))selectedIds.add(row.id);
    if(key==='servicePromotionWithdrawals'&&row.allocations?.some(a=>commissionIds.has(a.commissionId)))selectedIds.add(row.id);
    if(key==='servicePromotionRecoveries'&&commissionIds.has(row.commissionId))selectedIds.add(row.id);
  }
  const keep=row=>bookIds.has(row.bookingId)||selectedIds.has(row.sourceId)||row.kind.startsWith('source-container-')||row.kind==='source-clock-missing'||row.kind.includes('getter-invalid')&&[c.techId,c.fromStoreId].includes(row.sourceId);
  const settlement={...full.settlement,groups:Object.fromEntries(Object.entries(full.settlement.groups).map(([name,list])=>[name,list.filter(keep)])),blockers:full.settlement.blockers.filter(keep),retainedRights:full.settlement.retainedRights.filter(keep)};
  settlement.clear=settlement.blockers.length===0;delete settlement.sourceToken;settlement.sourceToken=token(settlement);
  const result={...full,caseId:c.id,caseKind:c.kind,cutoffAt:c.effectiveAt,bookingIds:[...bookIds],bookings:[...full.bookings.filter(b=>bookIds.has(b.sourceId)),...coordinated],fulfilment:full.fulfilment.filter(x=>bookIds.has(x.bookingId)),qualifications:full.qualifications.filter(q=>q.storeId===c.fromStoreId||q.originalBookingIds?.some(id=>bookIds.has(id))),authorizations:full.authorizations.filter(a=>a.storeId===c.fromStoreId),settlement,blockers:[...full.blockers.filter(keep),...invalid],retainedRights:[...full.retainedRights.filter(keep),...coordinated]};
  delete result.sourceToken;result.sourceToken=token(result);return result;
}
