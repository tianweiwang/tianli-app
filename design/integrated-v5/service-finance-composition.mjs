// Per-source actual H/Cs cash. This module reads facts; it never moves money or selects a policy.
import { serviceFinanceSummary } from './service-finance.mjs';

const clone = value => structuredClone(value);
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value;
const signature = value => JSON.stringify(canonical(value));
const money = value => Number.isSafeInteger(value) && value >= 0;
const text = value => typeof value === 'string' && Boolean(value.trim());
const time = (s, value) => Number.isSafeInteger(value) && value >= 0 && value <= s.now;
const sum = (rows, key) => rows.reduce((n, row) => n + row[key], 0);
const contextFields = ['entryId', 'bookingId', 'paymentId', 'storeId', 'kind', 'sourceId', 'requestNo', 'recoveryId', 'recordId'];
const unique = rows => [...new Set(rows)];
// Synchronous browser SHA-256; a source fingerprint is never an authorization signature.
export function serviceFinanceCompositionFingerprint(value) {
  const input=new TextEncoder().encode(signature(value)),length=Math.ceil((input.length+9)/64)*64,bytes=new Uint8Array(length),data=new DataView(bytes.buffer);bytes.set(input);bytes[input.length]=0x80;data.setUint32(length-8,Math.floor(input.length/0x20000000));data.setUint32(length-4,(input.length*8)>>>0);
  const k=[0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2],h=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19],w=new Uint32Array(64),r=(n,b)=>(n>>>b)|(n<<(32-b));
  for(let o=0;o<length;o+=64){for(let i=0;i<16;i++)w[i]=data.getUint32(o+i*4);for(let i=16;i<64;i++){const x=w[i-15],y=w[i-2];w[i]=(w[i-16]+(r(x,7)^r(x,18)^(x>>>3))+w[i-7]+(r(y,17)^r(y,19)^(y>>>10)))>>>0;}let[a,b,c,d,e,f,g,j]=h;for(let i=0;i<64;i++){const t=(j+(r(e,6)^r(e,11)^r(e,25))+((e&f)^(~e&g))+k[i]+w[i])>>>0,u=((r(a,2)^r(a,13)^r(a,22))+((a&b)^(a&c)^(b&c)))>>>0;j=g;g=f;f=e;e=(d+t)>>>0;d=c;c=b;b=a;a=(t+u)>>>0;}[a,b,c,d,e,f,g,j].forEach((v,i)=>h[i]=(h[i]+v)>>>0);}return 'sha256:'+h.map(n=>n.toString(16).padStart(8,'0')).join('');
}
function reject(message) { throw new Error(message); }
function exactSource(a, b) { return Boolean(a && contextFields.every(k => (a[k] ?? null) === (b[k] ?? null))); }
function entryContext(s, entryId) {
  const entries = (s.serviceFinanceEntries || []).filter(e => e.id === entryId), entry = entries[0];
  const bookings = (s.bookings || []).filter(b => b.id === entry?.bookingId), booking = bookings[0];
  const payments = [booking?.payment, ...(booking?.extensions || [])].filter(p => p?.id === entry?.paymentId), payment = payments[0];
  const reason = entries.length !== 1 || !text(entryId) ? '缺少唯一原服务资金条目' : bookings.length !== 1 || payments.length !== 1 || payment.status !== 'success' || booking.storeId !== entry.storeId || !(s.stores || []).some(x => x.id === entry.storeId) || entry.kind !== (payment === booking.payment ? 'main' : 'extension') ? '原预约、主款或加钟支付及门店不一致' : '';
  return { entry, booking, payment, reason };
}
function sourceFor(entry, kind, raw, recovery = null) {
  return { entryId: entry.id, bookingId: entry.bookingId, paymentId: entry.paymentId, storeId: entry.storeId, kind,
    sourceId: raw.id, requestNo: kind === 'recovery' ? raw.requestId ?? null : raw.requestNo ?? null,
    recoveryId: recovery?.id ?? null, recordId: kind === 'recovery' ? raw.id : null };
}
function sourceKey(source) { return source.kind === 'recovery' ? `recovery:${source.recoveryId}:${source.recordId}` : `${source.kind}:${source.sourceId}`; }
function stableFacts(fact) {
  return { source: fact.source, normalCents: fact.normalCents, sourceCreatedAt: fact.createdAt, actualReference: fact.actualReference,
    incomeSourceId: fact.incomeSourceId, incomeRequestNo: fact.incomeRequestNo, recoveryType: fact.recoveryType ?? null, channelTotalCents: fact.channelTotalCents, principalCents: fact.principalCents, planId: fact.planId };
}
function collectFacts(s, entryId, includeFailed = false) {
  const context = entryContext(s, entryId), facts = [], errors = [], principals = [];
  if (context.reason) return { ...context, facts, errors: [context.reason], principals };
  const { entry } = context, ids = new Map(), requests = new Map();
  const add = fact => {
    const idKey = fact.source.kind === 'recovery' ? fact.id : `channel:${fact.source.sourceId}`;
    const requestKey = fact.source.kind === 'recovery' ? null : fact.source.requestNo;
    const prior = ids.get(idKey) || (requestKey && requests.get(requestKey));
    if (prior) {
      if (signature({ ...stableFacts(prior), status: prior.status, actualAt: prior.actualAt }) !== signature({ ...stableFacts(fact), status: fact.status, actualAt: fact.actualAt }) || signature({ confirmed: prior.raw.cashComposition ?? null, request: prior.raw.cashCompositionRequest ?? null }) !== signature({ confirmed: fact.raw.cashComposition ?? null, request: fact.raw.cashCompositionRequest ?? null })) {
        prior.factErrors.push('同一原编号或请求号存在冲突事实'); errors.push('同一原编号或请求号存在冲突事实');
      }
      return false;
    }
    facts.push(fact); ids.set(idKey, fact); if (requestKey) requests.set(requestKey, fact); return true;
  };
  for (const [kind, rows] of [['split', [entry.split, ...(entry.splitHistory || [])]], ['return', entry.returns || []]]) for (const raw of rows.filter(Boolean)) {
    if (!['success', 'processing', ...(includeFailed ? ['failed'] : [])].includes(raw.status)) continue;
    if (raw.amountCents === 0 && !(raw.recoveryCents > 0)) continue;
    const source = sourceFor(entry, kind, raw), principal = raw.recoveryCents ?? 0, total = raw.channelTotalCents ?? raw.amountCents;
    const fact = { id: sourceKey(source), source, direction: kind === 'split' ? 'income' : 'return', normalCents: raw.amountCents,
      status: raw.status, actualAt: raw.status === 'success' ? raw.completedAt : null, createdAt: raw.createdAt,
      actualReference: raw.requestNo ?? null, incomeSourceId: kind === 'return' && text(raw.splitId) ? `split:${raw.splitId}` : null,
      incomeRequestNo: kind === 'return' ? raw.splitRequestNo ?? null : null, channelTotalCents: total, principalCents: principal,
      planId: raw.serviceExtraPlanId ?? null, raw, factErrors: [] };
    if (!text(raw.id) || !text(raw.requestNo) || raw.kind !== kind || !money(raw.amountCents) || !time(s, raw.createdAt) || raw.status === 'success' && (!time(s, raw.completedAt) || raw.completedAt < raw.createdAt)) fact.factErrors.push('原现金编号、类型、金额或实际成功时间无效');
    if (!money(principal) || !money(total) || !Number.isSafeInteger(raw.amountCents + principal) || total !== raw.amountCents + principal || kind !== 'split' && (principal || total !== raw.amountCents) || principal > 0 && !text(fact.planId)) fact.factErrors.push('C04正常份额、额外本金与渠道总额不一致');
    if (kind === 'return' && (!fact.incomeSourceId || !text(fact.incomeRequestNo))) fact.factErrors.push('回退缺少精确原成功分账编号及请求号');
    const added = add(fact);
    if (added && principal > 0 && !fact.factErrors.length) principals.push({ source: clone(source), status: raw.status, actualAt: fact.actualAt, amountCents: principal, channelTotalCents: total, planId: fact.planId, domain: 'service-extra-recovery-principal' });
    if (raw.amountCents === 0) { errors.push(...fact.factErrors); if (added) facts.splice(facts.indexOf(fact), 1); }
  }
  for (const recovery of (s.serviceFinanceRecoveries || []).filter(r => r.entryId === entry.id)) {
    const incoming = recovery.type === 'unshared-release', outgoing = ['return-failed', 'offline-adjustment'].includes(recovery.type), records = recovery.records || [];
    const aggregateValid = money(recovery.receivedCents) && records.every(r => money(r.amountCents)) && Number.isSafeInteger(sum(records, 'amountCents')) && sum(records, 'amountCents') === recovery.receivedCents;
    const sameOrigin = recovery.bookingId === entry.bookingId && recovery.paymentId === entry.paymentId && recovery.storeId === entry.storeId;
    const directionValid = incoming ? recovery.payer === `store:${entry.storeId}` && recovery.payee === 'group' : outgoing && recovery.payer === 'group' && recovery.payee === `store:${entry.storeId}`;
    if (!aggregateValid || !sameOrigin || !directionValid || !text(recovery.id)) errors.push('原追偿实际记录总额、方向或原支付来源不一致');
    for (const raw of records) {
      if (raw.amountCents === 0) continue;
      const source = sourceFor(entry, 'recovery', raw, recovery), fact = { id: sourceKey(source), source, direction: incoming ? 'income' : 'return', normalCents: raw.amountCents,
        status: 'success', actualAt: raw.occurredAt, createdAt: raw.recordedAt ?? raw.at, actualReference: raw.reference ?? null,
        incomeSourceId: outgoing && recovery.type === 'return-failed' && text(raw.splitId) ? `split:${raw.splitId}` : recovery.type === 'offline-adjustment' ? raw.incomeSourceId ?? null : null,
        incomeRequestNo: outgoing && recovery.type === 'return-failed' ? raw.splitRequestNo ?? null : recovery.type === 'offline-adjustment' ? raw.incomeRequestNo ?? null : null,
        channelTotalCents: raw.amountCents, principalCents: 0, planId: null, recoveryType: recovery.type, raw, factErrors: [] };
      if (!aggregateValid || !sameOrigin || !directionValid || !text(raw.id) || !text(raw.reference) || !money(raw.amountCents) || !time(s, fact.createdAt) || !time(s, raw.occurredAt) || !time(s, recovery.createdAt) || raw.occurredAt < recovery.createdAt || raw.occurredAt > fact.createdAt) fact.factErrors.push('原追偿金额、实际凭据或发生时间无效');
      if (recovery.type === 'return-failed' && (!fact.incomeSourceId || !text(fact.incomeRequestNo))) fact.factErrors.push('线下代退缺少精确原成功分账来源');
      add(fact);
    }
  }
  const confirmations = (s.serviceFinanceCompositions || []).filter(row => row.source?.entryId === entry.id);
  const allConfirmations = s.serviceFinanceCompositions || [];
  for (const row of confirmations) {
    if (!facts.some(fact => exactSource(row.source, fact.source))) errors.push('独立核定未精确对应本款现有原现金来源');
    if (allConfirmations.filter(other => other.id === row.id).length !== 1 || allConfirmations.filter(other => other.requestId === row.requestId).length !== 1) errors.push('历史核定重复编号或提交标识冲突');
  }
  return { ...context, facts, errors, principals };
}
function requestPayload(row) {
  return { schema: row.schema, status: row.status, scope: row.scope, kind: row.kind, direction: row.direction, normalCents: row.normalCents,
    hCents: row.hCents, csCents: row.csCents, retainedCsCents: row.retainedCsCents, basis: row.basis, allocations: row.allocations, method: row.method,
    allocationPolicySnapshot: row.allocationPolicySnapshot, reason: row.reason };
}
function validMoneyParts(row) {
  return money(row.normalCents) && money(row.hCents) && money(row.csCents) && Number.isSafeInteger(row.hCents + row.csCents) && row.hCents + row.csCents === row.normalCents && (row.retainedCsCents == null || money(row.retainedCsCents) && row.retainedCsCents <= row.csCents);
}
function evidenceReady(refs) {
  return Array.isArray(refs) && refs.length > 0 && refs.every(r => /^invoice-file:[a-f0-9]{64}$/.test(r?.ref || '') && text(r.name) && ['application/pdf', 'image/png', 'image/jpeg'].includes(r.type) && Number.isSafeInteger(r.size) && r.size > 0 && r.size <= 5 * 1024 * 1024) && new Set(refs.map(r => r.ref)).size === refs.length;
}
function compositionErrors(s, fact, row, historical) {
  const errors = [];
  if (!row || row.schema !== 1 || row.status !== 'known') return ['本原现金尚无已核H/Cs组成'];
  if (!exactSource(row.source, fact.source) || row.normalCents !== fact.normalCents || row.direction !== fact.direction || row.actualReference !== fact.actualReference || row.sourceFactsToken !== signature(stableFacts(fact)) || row.sourceCreatedAt !== fact.createdAt) errors.push('组成与原现金来源、技术号、金额或方向不一致');
  if (!validMoneyParts(row)) errors.push('H/Cs须为有效非负分且合计精确等于本笔正常现金');
  if (fact.status === 'success' && row.actualAt !== fact.actualAt) errors.push('组成未精确引用原实际成功或发生时间');
  if (fact.status === 'processing' && row.actualAt !== null) errors.push('未知原现金不得伪造实际成功时间');
  if (row.method === 'unique-original-request') {
    if (!row.requestSignature || row.requestSignature !== signature(requestPayload(row)) || !time(s, row.basis?.capturedAt) || row.basis.capturedAt > fact.createdAt || row.basis.completeBefore !== true || !text(row.basis.sourceToken) || !money(row.basis.beforeHNetCents) || !money(row.basis.beforeCsNetCents) || !money(row.basis.targetH) || !money(row.basis.targetCs)) errors.push('新请求缺少完整原前值和冻结目标，不能倒套旧成功款');
  } else if (historical && ['verified-history', 'approved-allocation'].includes(row.method)) {
    if (!text(row.id) || !text(row.requestId) || !Number.isSafeInteger(row.version) || row.version < 1 || row.by?.role !== 'group' || !['finance', 'all'].includes(row.by.job) || !time(s, row.recordedAt) || row.recordedAt < fact.actualAt || !text(row.reason) || !evidenceReady(row.evidenceRefs)) errors.push('历史逐笔核定缺少唯一版本、集团财务、实际附件或核对依据');
    if (row.method === 'approved-allocation' && (!text(row.allocationPolicySnapshot?.id) || !Number.isSafeInteger(row.allocationPolicySnapshot?.version) || row.allocationPolicySnapshot.version < 1 || row.allocationPolicySnapshot.mode !== 'per-source-approved' || !text(row.allocationPolicySnapshot.basis))) errors.push('混合分配没有显式逐笔核定依据，不默认批准未决政策');
  } else errors.push('本笔组成没有原请求或独立逐笔核定来源');
  const allocations = row.allocations;
  if (!Array.isArray(allocations) || allocations.some(a => !text(a?.incomeSourceId) || !text(a?.incomeRequestNo) || !money(a?.hCents) || !money(a?.csCents)) || new Set(allocations.map(a => a.incomeSourceId)).size !== allocations.length) errors.push('退回必须有有效且唯一的原收入组成份额');
  else if (fact.direction === 'return') {
    if (sum(allocations, 'hCents') !== row.hCents || sum(allocations, 'csCents') !== row.csCents) errors.push('原收入分配合计与本次退回H/Cs不一致');
    if (fact.incomeSourceId && (allocations.length !== 1 || allocations[0].incomeSourceId !== fact.incomeSourceId || allocations[0].incomeRequestNo !== fact.incomeRequestNo)) errors.push('退回组成不能侵占其他原收入');
  } else if (allocations.length) errors.push('收入不得夹带退回份额');
  return errors;
}
function compositionCandidates(s, fact) {
  const inline = fact.raw.cashComposition || fact.raw.cashCompositionRequest;
  const entryIndex=(s.serviceFinanceEntries||[]).findIndex(e=>e.id===fact.source.entryId),entry=s.serviceFinanceEntries[entryIndex],base=`serviceFinanceEntries[${entryIndex}]`;
  let path;
  if(fact.source.kind==='split')path=entry.split===fact.raw?`${base}.split`:`${base}.splitHistory[${(entry.splitHistory||[]).indexOf(fact.raw)}]`;
  else if(fact.source.kind==='return')path=`${base}.returns[${(entry.returns||[]).indexOf(fact.raw)}]`;
  else {const index=(s.serviceFinanceRecoveries||[]).findIndex(r=>r.id===fact.source.recoveryId);path=`serviceFinanceRecoveries[${index}].records[${(s.serviceFinanceRecoveries[index]?.records||[]).indexOf(fact.raw)}]`;}
  path+=fact.raw.cashComposition?'.cashComposition':'.cashCompositionRequest';
  const describe=(row,historical,path)=>({row,historical,ref:{key:historical?`ledger:${row.id}`:`inline:${fact.id}`,path,id:historical?row.id:fact.id,version:historical?row.version:null,token:serviceFinanceCompositionFingerprint(row)}});
  const ledger=(s.serviceFinanceCompositions||[]).flatMap((row,i)=>row.source?.entryId===fact.source.entryId&&(row.source.kind===fact.source.kind&&row.source.sourceId===fact.source.sourceId||row.source.requestNo&&row.source.requestNo===fact.source.requestNo)?[describe(row,true,`serviceFinanceCompositions[${i}]`)]:[]);
  return [...(inline?[describe(inline,false,path)]:[]),...ledger];
}
function resolvedCandidates(s,fact,candidates) {
  const active=[],errors=[];
  for(const candidate of candidates){
    const chain=candidate.row.reconciliation;
    if(chain!==undefined){
      const refs=chain?.supersedes;
      const valid=candidate.historical&&chain?.schema===1&&Array.isArray(refs)&&refs.length>0&&refs.length===active.length&&new Set(refs.map(r=>r?.key)).size===refs.length
        &&refs.every(ref=>active.some(old=>signature(old.ref)===signature(ref)))
        &&candidate.row.method==='verified-history'&&text(candidate.row.basisReference)&&text(candidate.row.basisDescription)
        &&!compositionErrors(s,fact,candidate.row,true).length
        &&active.every(old=>exactSource(old.row.source,fact.source)&&(!old.historical||candidate.row.version>old.row.version&&candidate.row.recordedAt>=old.row.recordedAt));
      if(!valid)errors.push('组成更正链缺少全部精确原候选、有效依据或递增版本，不能默选最新');
      else active.length=0;
    }
    active.push(candidate);
  }
  return{active,errors};
}
function chooseComposition(s, fact) {
  const all = compositionCandidates(s,fact), resolved=resolvedCandidates(s,fact,all), candidates=resolved.active, ledger=all.filter(x=>x.historical).map(x=>x.row);
  if(resolved.errors.length)return{row:null,errors:resolved.errors};
  if (!candidates.length) return { row: null, errors: ['本原现金尚无已核H/Cs组成'] };
  if (ledger.length && (new Set(ledger.map(r => r.id)).size !== ledger.length || new Set(ledger.map(r => r.requestId)).size !== ledger.length)) return { row: null, errors: ['历史核定重复编号或提交标识冲突'] };
  const semantic = row => signature({ source: row.source, direction: row.direction, normalCents: row.normalCents, hCents: row.hCents, csCents: row.csCents, retainedCsCents: row.retainedCsCents ?? null, actualAt: row.actualAt, allocations: row.allocations });
  const known = candidates.filter(x => x.row.status === 'known');
  if (known.length > 1 && new Set(known.map(x => semantic(x.row))).size !== 1) return { row: null, errors: ['同一原现金存在冲突H/Cs核定，不能默默相加'] };
  const selected = known[0] || candidates[0];
  const errors = known.length ? known.flatMap(candidate => compositionErrors(s, fact, candidate.row, candidate.historical)) : compositionErrors(s, fact, selected.row, selected.historical);
  return { row: selected.row, errors: unique(errors) };
}

// Internal candidate snapshots for the actual finance review command. Never render row bodies as hidden form data.
export function serviceFinanceCompositionCandidates(s,entryId,source) {
  assertSourceArgument(source);const collected=collectFacts(s,entryId,true),key=typeof source==='string'?source:sourceKey(source),fact=collected.facts.find(f=>f.id===key);
  if(collected.reason||!fact||fact.factErrors.length)reject(collected.reason||fact?.factErrors[0]||'缺少可定位的原现金来源');
  const candidates=compositionCandidates(s,fact),resolved=resolvedCandidates(s,fact,candidates),selected=chooseComposition(s,fact);
  return clone({candidates,active:resolved.active.map(c=>c.ref),selected: selected.row,errors:unique([...collected.errors,...selected.errors])});
}

function compositionProjection(s, entryId, excludedReturn = null) {
  const collected = collectFacts(s, entryId), facts = collected.facts.filter(fact => !(fact.direction === 'return' && fact.id === excludedReturn)), rows = [], reservations = [], errors = [...collected.errors], unresolved = [], balances = new Map();
  const projected = facts.map(fact => { const checked = chooseComposition(s, fact); return { fact, composition: checked.row, errors: [...fact.factErrors, ...checked.errors] }; });
  for (const item of projected.filter(x => x.fact.direction === 'income')) {
    const { fact, composition } = item;
    if (item.errors.length || fact.status !== 'success') { unresolved.push(fact.id); if (item.errors.length) errors.push(...item.errors.map(e => `${fact.id}：${e}`)); continue; }
    balances.set(fact.id, { incomeSourceId: fact.id, incomeRequestNo: fact.actualReference, sourceKind: fact.source.kind, recoveryType: fact.recoveryType ?? null, normalCents: fact.normalCents, hCents: composition.hCents, csCents: composition.csCents, hReturnedCents: 0, csReturnedCents: 0, hReservedCents: 0, csReservedCents: 0, unknownReservedCents: 0, known: true, actualAt: fact.actualAt });
    rows.push({ id: fact.id, source: clone(fact.source), direction: fact.direction, normalCents: fact.normalCents, hCents: composition.hCents, csCents: composition.csCents, actualAt: fact.actualAt, actualReference: fact.actualReference, allocations: [], principalCents: fact.principalCents });
  }
  for (const item of projected.filter(x => x.fact.direction === 'return').sort((a, b) => (a.fact.actualAt ?? a.fact.createdAt) - (b.fact.actualAt ?? b.fact.createdAt) || a.fact.id.localeCompare(b.fact.id))) {
    const { fact, composition } = item, ownErrors = [...item.errors];
    if (!ownErrors.length) for (const allocation of composition.allocations) {
      const balance = balances.get(allocation.incomeSourceId);
      if (!balance || !balance.known || balance.incomeRequestNo !== allocation.incomeRequestNo || balance.actualAt > (fact.actualAt ?? fact.createdAt)) ownErrors.push('退回未精确引用此前已核成功原收入');
      else if (fact.recoveryType === 'offline-adjustment' && (balance.sourceKind !== 'recovery' || balance.recoveryType !== 'unshared-release')) ownErrors.push('线下追偿差额退回须引用原实际店债回款，不能消耗渠道分账');
      else if (allocation.hCents > balance.hCents - balance.hReturnedCents - balance.hReservedCents || allocation.csCents > balance.csCents - balance.csReturnedCents - balance.csReservedCents) ownErrors.push('成功退回、实际代退及未知占额超过该原来源H/Cs余额');
    }
    if (ownErrors.length) {
      unresolved.push(fact.id); errors.push(...ownErrors.map(e => `${fact.id}：${e}`));
      const referenced = unique([...(Array.isArray(composition?.allocations) ? composition.allocations.filter(a => a && typeof a === 'object').map(a => a.incomeSourceId) : []), ...(fact.incomeSourceId ? [fact.incomeSourceId] : [])]);
      for (const key of referenced) { const balance = balances.get(key); if (balance) { balance.known = false; if (fact.status === 'processing') balance.unknownReservedCents = money(fact.normalCents) && balance.unknownReservedCents !== null ? balance.unknownReservedCents + fact.normalCents : null; } }
      continue;
    }
    for (const allocation of composition.allocations) {
      const balance = balances.get(allocation.incomeSourceId);
      balance[fact.status === 'processing' ? 'hReservedCents' : 'hReturnedCents'] += allocation.hCents;
      balance[fact.status === 'processing' ? 'csReservedCents' : 'csReturnedCents'] += allocation.csCents;
    }
    const row = { id: fact.id, source: clone(fact.source), direction: fact.direction, normalCents: fact.normalCents, hCents: composition.hCents, csCents: composition.csCents, actualAt: fact.actualAt, actualReference: fact.actualReference, allocations: clone(composition.allocations), principalCents: 0 };
    if (fact.status === 'processing') { unresolved.push(fact.id); reservations.push(row); } else rows.push(row);
  }
  const knownSources = new Set(rows.map(r => r.id));
  for (const fact of facts) if (!knownSources.has(fact.id) && !reservations.some(r => r.id === fact.id)) unresolved.push(fact.id);
  const confirmed = { hReceivedCents: sum(rows.filter(r => r.direction === 'income'), 'hCents'), hReturnedCents: sum(rows.filter(r => r.direction === 'return'), 'hCents'), csReceivedCents: sum(rows.filter(r => r.direction === 'income'), 'csCents'), csReturnedCents: sum(rows.filter(r => r.direction === 'return'), 'csCents') };
  confirmed.hNetCents = confirmed.hReceivedCents - confirmed.hReturnedCents; confirmed.csNetCents = confirmed.csReceivedCents - confirmed.csReturnedCents;
  if (Object.values(confirmed).some(n => !Number.isSafeInteger(n) || n < 0)) errors.push('现金组成合计或净额超出有效分值范围');
  const known = !errors.length && !unresolved.length;
  const returnSources = [...balances.values()].map(b => ({ ...b, hRemainingCents: b.known ? b.hCents - b.hReturnedCents - b.hReservedCents : null, csRemainingCents: b.known ? b.csCents - b.csReturnedCents - b.csReservedCents : null }));
  return clone({ known, status: known ? 'known' : 'needs-review', reason: errors[0] || (unresolved.length ? '原现金结果未知，须查询原笔' : ''), entryId, rows: rows.sort((a, b) => a.actualAt - b.actualAt || a.id.localeCompare(b.id)), reservations, returnSources,
    ...Object.fromEntries(Object.entries(confirmed).map(([k, v]) => [k, known ? v : null])), confirmed, unresolvedSourceIds: unique(unresolved), errors: unique(errors), principalRows: collected.principals });
}
export function serviceFinanceComposition(s, entryId) { return compositionProjection(s,entryId); }
// Classification preview only: the command still validates the complete original cash projection.
export function serviceFinanceCompositionAllocationSources(s,entryId,key) {
  const fact=serviceFinanceCashSource(s,entryId,key),entry=entryContext(s,entryId).entry;
  if(fact.direction!=='return'||fact.status!=='success'||!(fact.normalCents>0))reject('原收入份额预览仅接受本款精确成功正常回退');
  if((s.serviceFinanceEntries||[]).filter(e=>e.bookingId===entry.bookingId&&e.paymentId===entry.paymentId).length!==1||(s.stores||[]).filter(store=>store.id===entry.storeId).length!==1)reject('原收入份额预览的原支付或门店不唯一');
  return compositionProjection(s,entryId,fact.id).returnSources;
}
export function serviceFinanceCompositionToken(s, entryId) {
  const facts = collectFacts(s, entryId), projection = serviceFinanceComposition(s, entryId);
  const target = !facts.reason && serviceFinanceSummary(s, facts.entry.bookingId, facts.entry.paymentId);
  return signature({ entryId, version: facts.entry?.version ?? null, entryContext: facts.reason,
    target: target ? { known: target.known, platformCents: target.platformCents, platformSplitCents: target.platformSplitCents, collectibleTargetCents: target.collectibleTargetCents, targetGroupCents: target.targetGroupCents, heldConfirmedCents: target.heldConfirmedCents, promotionSourceToken: target.promotionSourceToken, unknownChannel: target.unknownChannel, unknownRefund: target.unknownRefund, unknownPersonalTransfer: target.unknownPersonalTransfer } : null,
    facts: facts.facts.map(f => ({ ...stableFacts(f), status: f.status, actualAt: f.actualAt, errors: f.factErrors })).sort((a, b) => sourceKey(a.source).localeCompare(sourceKey(b.source))),
    rows: projection.rows, reservations: projection.reservations, returnSources: projection.returnSources, unresolved: projection.unresolvedSourceIds, errors: projection.errors });
}
export function assertServiceFinanceCompositionToken(s, entryId, token) {
  if (!text(token) || token !== serviceFinanceCompositionToken(s, entryId)) reject('原现金来源或组成占额已变化，请刷新核对');
  return true;
}

export function captureServiceFinanceComposition(s, entryId, input) {
  if (!input || !['split', 'return', 'recovery'].includes(input.kind) || !money(input.normalCents) || input.normalCents === 0) reject('新现金请求须有有效原类型和正整数分金额');
  const context = entryContext(s, entryId), before = serviceFinanceComposition(s, entryId);
  const summary = !context.reason && serviceFinanceSummary(s, context.entry.bookingId, context.entry.paymentId);
  const direction = input.kind === 'split' ? 'income' : input.kind === 'return' ? 'return' : input.direction;
  if (!['income', 'return'].includes(direction)) reject('实际追偿须明确原收退方向');
  const targetH = direction === 'income' ? summary?.platformSplitCents : summary?.platformCents;
  const groupTarget = direction === 'income' ? summary?.collectibleTargetCents : summary?.targetGroupCents;
  const targetCs = money(targetH) && money(groupTarget) && groupTarget >= targetH ? groupTarget - targetH : null;
  const basis = { sourceToken: serviceFinanceCompositionToken(s, entryId), ruleId: context.entry?.ruleSnapshot?.id ?? null, ruleVersion: context.entry?.ruleSnapshot?.version ?? null,
    promotionSourceToken: summary?.promotionSourceToken ?? null, beforeHNetCents: before.hNetCents, beforeCsNetCents: before.csNetCents,
    beforeSources: before.rows, beforeReservations: before.reservations, beforeReturnSources: before.returnSources, unresolvedSourceIds: before.unresolvedSourceIds,
    targetH: money(targetH) ? targetH : null, targetCs, heldConfirmedCents: summary?.heldConfirmedCents ?? null, capturedAt: s.now, completeBefore: before.known };
  let reason = context.reason || (!before.known ? before.reason || '旧成功现金缺组成，不能假定此前实收为零' : '') || (!summary?.known || summary.unknownChannel || summary.unknownRefund || summary.unknownPersonalTransfer ? '原服务资金目标或渠道结果尚未核清' : '') || (!money(targetH) || !money(targetCs) ? '原H/Cs目标未明确' : ''), hCents = null, csCents = null, allocations = [];
  if (!reason && direction === 'income') {
    const hDue = targetH - before.hNetCents, csDue = targetCs - before.csNetCents;
    if (hDue < 0 || csDue < 0) reason = 'H减少与Cs增加等反向变化须逐笔核定，不能当本次非负现金';
    else {
      const low = Math.max(0, input.normalCents - csDue), high = Math.min(input.normalCents, hDue);
      if (low > high) reason = '本次正常实收超过原H/Cs尚欠份额';
      else if (low !== high) reason = '本次部分混合实收有多种H/Cs分配，须显式逐笔核定';
      else { hCents = low; csCents = input.normalCents - low; }
    }
  } else if (!reason) {
    const balance = before.returnSources.find(r => r.incomeSourceId === input.incomeSourceId && r.incomeRequestNo === input.incomeRequestNo);
    if (!balance?.known) reason = '本次退回必须锁定精确已核原收入及组成余额';
    else if (input.normalCents === balance.hRemainingCents + balance.csRemainingCents) {
      // A whole original balance identifies the cash parts even when the new target differs.
      hCents = balance.hRemainingCents; csCents = balance.csRemainingCents;
      allocations = [{ incomeSourceId: balance.incomeSourceId, incomeRequestNo: balance.incomeRequestNo, hCents, csCents }];
      basis.uniqueCase = 'whole-original-income-balance';
    }
    else {
      const hDue = Math.max(0, before.hNetCents - targetH), csDue = Math.max(0, before.csNetCents - targetCs);
      const low = Math.max(0, input.normalCents - Math.min(balance.csRemainingCents, csDue)), high = Math.min(input.normalCents, balance.hRemainingCents, hDue);
      if (low > high) reason = '本次退回超过精确原来源或全局H/Cs待退份额';
      else if (low !== high) reason = '本次部分混合回退有多种H/Cs分配，须显式逐笔核定';
      else { hCents = low; csCents = input.normalCents - low; allocations = [{ incomeSourceId: balance.incomeSourceId, incomeRequestNo: balance.incomeRequestNo, hCents, csCents }]; }
    }
  }
  const result = { schema: 1, status: reason ? 'needs-review' : 'known', scope: { entryId, bookingId: context.entry?.bookingId ?? null, paymentId: context.entry?.paymentId ?? null, storeId: context.entry?.storeId ?? null }, kind: input.kind, direction,
    normalCents: input.normalCents, hCents, csCents, retainedCsCents: null, basis, allocations, method: 'unique-original-request', allocationPolicySnapshot: null, reason };
  result.requestSignature = signature(requestPayload(result));
  return clone(result);
}

export function bindServiceFinanceComposition(s, entryId, request, source) {
  if (!request || request.schema !== 1 || request.requestSignature !== signature(requestPayload(request)) || request.scope?.entryId !== entryId) reject('原现金组成请求缺失、被修改或属另一原款');
  assertSourceArgument(source);
  const collected = collectFacts(s, entryId, true);
  if (collected.reason) reject(collected.reason);
  const key = typeof source === 'string' ? source : sourceKey(source || {}), fact = collected.facts.find(f => f.id === key);
  if (!fact || fact.factErrors.length || fact.source.kind !== request.kind || fact.direction !== request.direction || fact.normalCents !== request.normalCents || ['bookingId', 'paymentId', 'storeId'].some(k => request.scope[k] !== fact.source[k])) reject('组成必须绑定精确原现金编号、方向、金额和本款门店');
  if (typeof source === 'object' && Object.keys(source).some(k => contextFields.includes(k) && (source[k] ?? null) !== (fact.source[k] ?? null))) reject('提供的原现金技术号或来源不一致');
  if (request.source && !exactSource(request.source, fact.source)) reject('查询或重试不能换原现金编号和请求号');
  if (!time(s, request.basis.capturedAt) || fact.createdAt < request.basis.capturedAt) reject('新请求不能倒套捕获之前已存在的旧现金');
  if (fact.incomeSourceId && (request.allocations.length !== 1 || request.allocations[0].incomeSourceId !== fact.incomeSourceId || request.allocations[0].incomeRequestNo !== fact.incomeRequestNo) && request.status === 'known') reject('回退组成不能改用另一原收入来源');
  if (fact.recoveryType === 'offline-adjustment' && request.status === 'known' && request.allocations.some(allocation => !collected.facts.some(income => income.id === allocation.incomeSourceId && income.status === 'success' && income.direction === 'income' && income.recoveryType === 'unshared-release' && income.actualReference === allocation.incomeRequestNo))) reject('线下差额退回须引用原实际店债回款来源');
  if (request.sourceFactsToken && request.sourceFactsToken !== signature(stableFacts(fact))) reject('原现金技术号、正常金额或C04本金已变化');
  return clone({ ...request, source: fact.source, actualAt: fact.actualAt, actualReference: fact.actualReference, sourceCreatedAt: fact.createdAt, sourceFactsToken: signature(stableFacts(fact)) });
}

// Exact facts for a separate audited historical-confirmation command; no allocation is invented here.
export function serviceFinanceCashSource(s, entryId, source) {
  assertSourceArgument(source);
  const collected = collectFacts(s, entryId, true), key = typeof source === 'string' ? source : sourceKey(source || {}), fact = collected.facts.find(f => f.id === key);
  if (collected.reason || !fact || fact.factErrors.length) reject(collected.reason || fact?.factErrors[0] || '缺少可定位的原现金来源');
  if (typeof source === 'object' && Object.keys(source).some(k => contextFields.includes(k) && (source[k] ?? null) !== (fact.source[k] ?? null))) reject('原现金来源与技术号不一致');
  return clone({ id: fact.id, source: fact.source, direction: fact.direction, status: fact.status, normalCents: fact.normalCents, actualAt: fact.actualAt,
    actualReference: fact.actualReference, sourceCreatedAt: fact.createdAt, sourceFactsToken: signature(stableFacts(fact)), incomeSourceId: fact.incomeSourceId,
    incomeRequestNo: fact.incomeRequestNo, recoveryType: fact.recoveryType ?? null, principalCents: fact.principalCents, channelTotalCents: fact.channelTotalCents, planId: fact.planId });
}

function assertSourceArgument(source) {
  if (typeof source === 'string' && text(source)) return;
  if (!source || typeof source !== 'object' || Array.isArray(source) || !['split', 'return', 'recovery'].includes(source.kind) || !text(source.sourceId) || source.kind === 'recovery' && (!text(source.recoveryId) || !text(source.recordId))) reject('原现金来源参数无效，须提供精确原编号');
}
