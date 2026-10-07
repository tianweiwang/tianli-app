// C07. Local invoice records only; source cash, refunds, bookings and stock are read-only.
import { resolveAccountActor, canAccountView, assertAccountCommand, actorAccountFields } from './staff-accounts.mjs';
import { serviceFinanceComposition } from './service-finance-composition.mjs';
import { lifecycleFingerprint as requestDigest } from './organization-lifecycle-projection.mjs';

const DAY = 86400000;
const MIME = new Set(['application/pdf', 'image/png', 'image/jpeg']);
const terminalCase = x => ['done', 'closed', 'rejected'].includes(x.status);
const copy = x => structuredClone(x);
const canonical = x => Array.isArray(x) ? x.map(canonical) : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).sort().map(k => [k, canonical(x[k])])) : x;
const signature = x => JSON.stringify(canonical(x));
const cents = x => Number.isSafeInteger(x) && x >= 0;
const validId = x => typeof x === 'string' && x.trim().length > 0 && x.trim() === x;
const sum = (xs, f = x => x) => xs.reduce((n, x) => n + f(x), 0);
const groupFinance = a => a?.role === 'group' && (!a.job || ['all', 'finance'].includes(a.job));
const storeFinance = a => a?.role === 'store' && (!a.job || ['all', 'store-finance'].includes(a.job));
const routeFor = category => category === 'goods' ? 'commodity-invoices' : 'fee-invoices';
const actorRecord = a => ({ role: a.role, job: a.job || null, id: a.accountId || (a.role === 'user' ? a.userId : a.role === 'store' ? a.storeId : 'group'), ...actorAccountFields(a) });
function requestActorKey(value) {
  try {
    const a=typeof value==='string'?JSON.parse(value):value;
    if(!a||!['user','store','group'].includes(a.role)||!validId(a.id)||(a.job!=null&&typeof a.job!=='string'))return '';
    const hasAccount=Object.hasOwn(a,'accountId'),hasGrant=Object.hasOwn(a,'grantId');
    if(hasAccount!==hasGrant||hasAccount&&(!validId(a.accountId)||!validId(a.grantId)||a.id!==a.accountId))return '';
    // Commerce's original id and all-role job semantics remain intact. Names
    // and sessions are audit facts, not the stable request author identity.
    return signature({role:a.role,job:a.job||null,id:a.id,...(hasAccount?{accountId:a.accountId,grantId:a.grantId}:{})});
  } catch { return ''; }
}
function matchesRequest(request,facts,ctx) {
  if(!Object.hasOwn(request,'digestAlgorithm')&&!Object.hasOwn(request,'digestVersion')) {
    let legacy;try{legacy=JSON.parse(request.fingerprint);}catch{ctx.fail('原集团票据请求明文指纹损坏，请核对原记录');}
    if(!legacy||typeof legacy!=='object'||Array.isArray(legacy)||typeof legacy.type!=='string'||!legacy.p||typeof legacy.p!=='object'||Array.isArray(legacy.p))ctx.fail('原集团票据请求明文结构损坏，请核对原记录');
    return signature(legacy)===signature(facts);
  }
  if(request.digestVersion!==1)ctx.fail('原集团票据请求摘要版本缺失或未知，请核对原记录');
  if(request.digestAlgorithm!=='SHA-256')ctx.fail('原集团票据请求摘要算法缺失或未知，请核对原记录');
  if(!/^sha256:[a-f0-9]{64}$/.test(request.fingerprint||''))ctx.fail('原集团票据请求摘要损坏，请核对原记录');
  if(request.type!==facts.type)ctx.fail('原集团票据请求操作与摘要记录不一致');
  return request.fingerprint===requestDigest(facts);
}
function exactSource(list,id,label,ctx) {
  const matches=(list||[]).filter(x=>x.id===id);
  if(!validId(id)||matches.length!==1)ctx.fail(label+'来源缺失、冲突或编号不唯一');
  return matches[0];
}
function commandSource(s,op,invoice,category,p,ctx) {
  if(!['goods','fee'].includes(category))ctx.fail('集团票据类别来源无效');
  if(op==='rule-publish')return {category};
  if(invoice&&(!Number.isSafeInteger(invoice.version)||invoice.version<1))ctx.fail('原集团票据结果版本无效');
  if(category==='goods') {
    const root=exactSource(s.goods,invoice?invoice.orderId:p.orderId,'原商品订单',ctx);
    exactSource(s.users,root.userId,'原商品本人',ctx);
    if(invoice&&invoice.userId!==root.userId)ctx.fail('原商品票与订单本人来源归属不一致');
    return {category,root};
  }
  const root=exactSource(s.stores,invoice?invoice.storeId:p.storeId,'原服务费门店',ctx),month=invoice?invoice.month:p.month;
  if(typeof month!=='string'||!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month))ctx.fail('原服务费月份来源无效');
  return {category,root,month};
}
function requestResult(s,op,p,request,invoice,source,ctx) {
  const result=exactSource(op==='rule-publish'?s.commerceInvoiceRules:s.commerceInvoices,request.resultId,'原集团票据请求结果',ctx);
  if(result.category!==source.category||!Number.isSafeInteger(result.version)||result.version<1)ctx.fail('原集团票据请求结果类别来源或版本不一致');
  if(op==='rule-publish')return result;
  if(source.category==='goods') {
    if(result.orderId!==source.root.id||result.userId!==source.root.userId)ctx.fail('原集团票据请求结果与商品本人来源不一致');
  } else if(result.storeId!==source.root.id||result.month!==source.month)ctx.fail('原集团票据请求结果与门店月份来源不一致');
  if(op==='reapply') {
    if(result.replacesId!==invoice.id||invoice.replacedById!==result.id)ctx.fail('原集团票据重开结果与原票来源互链不一致');
  } else if(invoice&&result.id!==invoice.id)ctx.fail('原集团票据请求结果与本次原票来源不一致');
  return result;
}
const validTime = (s, n) => Number.isSafeInteger(n) && n >= 0 && n <= s.now;
function required(x, label, ctx, max = 300) {
  if (typeof x !== 'string' || !x.trim() || x.trim().length > max) ctx.fail(`请填写${label}（最多${max}字）`);
  return x.trim();
}
function integer(x, label, ctx, min, max) {
  if (!['number', 'string'].includes(typeof x) || String(x).trim() === '' || !Number.isSafeInteger(Number(x)) || Number(x) < min || Number(x) > max) ctx.fail(`${label}须为${min}至${max}的整数`);
  return Number(x);
}
function time(x, label, ctx) {
  const n = typeof x === 'number' ? x : typeof x === 'string' && x.trim() ? Date.parse(x) : NaN;
  if (!Number.isSafeInteger(n) || n < 0) ctx.fail(`请填写有效的${label}`);
  return n;
}
function version(row, p, ctx) {
  if (!['number', 'string'].includes(typeof p.version) || String(p.version).trim() === '' || Number(p.version) !== row.version) ctx.fail('发票资料已更新或缺少版本，请刷新后重试');
}
function audit(s, row, action, actor, ctx, detail = {}) {
  row.updatedAt = s.now;
  (row.history ??= []).push({ action, at: s.now, actor: actorRecord(actor), status: row.status, version: row.version, amount: row.amount, ...copy(detail) });
  ctx?.log?.(row, `集团${row.category === 'goods' ? '商品发票' : '服务费月票'} · ${action} · ${row.id}`);
}
export function upgradeCommerceInvoices(s) {
  s.commerceInvoiceRules ??= []; s.commerceInvoices ??= []; s.commerceInvoiceRequests ??= [];
  return s;
}
export function commerceInvoiceRule(s, category) {
  return [...(s.commerceInvoiceRules || [])].filter(x => x.category === category && x.effectiveAt <= s.now).sort((a, b) => b.effectiveAt - a.effectiveAt || b.version - a.version)[0] || null;
}
function issuerKey(x) { return String(x?.taxId || '').toUpperCase(); }
function ruleReady(rule, category) {
  return rule?.category === category && rule.mode === 'demo' && rule.productionApproved === false && rule.issuer?.name && /^[A-Z0-9]{15,20}$/.test(issuerKey(rule.issuer)) && rule.invoiceItem && rule.reason && Number.isSafeInteger(rule.sourceFromAt);
}
function goodsBasis(s, o) {
  const errors = [], lines = o?.lines || [], refunds = o?.refunds || [];
  if (!o || !lines.length || o.payment?.status !== 'success') errors.push('尚无已确认成功的商品支付');
  if (!cents(o?.paidCents) || !cents(o?.shippingCents) || lines.some(l => !l.skuId || !cents(l.paidCents) || !cents(l.refundedCents) || l.refundedCents > l.paidCents) || new Set(lines.map(l => l.skuId)).size !== lines.length || sum(lines, l => l.paidCents) + o?.shippingCents !== o?.paidCents) errors.push('商品明细、运费与支付总额不一致');
  if (!validTime(s, o?.paidAt)) errors.push('原支付成功时间缺失或异常，不能推定申请期限');
  const paidAt = o?.payment?.status === 'success' && validTime(s, o?.paidAt) ? o.paidAt : null;
  const snapshot = lines.map(l => ({ kind: 'goods', sourceId: l.skuId, paymentId: o?.payment?.id, at: paidAt, paidCents: l.paidCents, refundedCents: l.refundedCents, netCents: l.paidCents - l.refundedCents }));
  const success = refunds.filter(r => r.status === 'success'), seen = new Set(), seenCases = new Set(), allocation = new Map(lines.map(l => [l.skuId, 0]));
  let shippingRefunded = 0;
  const refundSnapshot = [];
  for (const r of success) {
    const c = o.cases?.find(c => c.id === r.caseId);
    if (!r.id || seen.has(r.id) || seenCases.has(r.caseId) || !c || c.status !== 'done' || !cents(r.amountCents) || !cents(c.amountCents) || !cents(c.shippingCents) || !Array.isArray(c.allocations) || sum(c.allocations, p => p.amountCents) !== c.amountCents || c.amountCents + c.shippingCents !== r.amountCents) { errors.push('成功退款缺少唯一原笔或完整分摊依据'); continue; }
    seen.add(r.id); seenCases.add(r.caseId); shippingRefunded += c.shippingCents;
    for (const p of c.allocations) {
      if (!allocation.has(p.skuId) || !cents(p.amountCents)) errors.push('成功退款商品分摊无效');
      else allocation.set(p.skuId, allocation.get(p.skuId) + p.amountCents);
    }
    // The refund's at is its submission time; the original case records success.
    refundSnapshot.push({ refundId: r.id, caseId: c.id, at: validTime(s, c.completedAt) ? c.completedAt : null, amountCents: r.amountCents, shippingCents: c.shippingCents, allocations: copy(c.allocations) });
  }
  if (lines.some(l => allocation.get(l.skuId) !== l.refundedCents) || shippingRefunded > (o?.shippingCents || 0) || !cents(sum(success, r => r.amountCents))) errors.push('成功退款累计与原商品明细或运费不一致');
  snapshot.push({ kind: 'shipping', sourceId: 'shipping', paymentId: o?.payment?.id, at: paidAt, paidCents: o?.shippingCents || 0, refundedCents: shippingRefunded, netCents: (o?.shippingCents || 0) - shippingRefunded });
  const paidCents = o?.payment?.status === 'success' ? o.paidCents : 0, refundedCents = sum(success, r => r.amountCents);
  if (!cents(paidCents) || refundedCents > paidCents || !cents(paidCents - refundedCents)) errors.push('商品支付退款净额异常');
  return { paidCents, refundedCents, netPaidCents: paidCents - refundedCents, sourceSnapshot: snapshot, refundSnapshot, basisValid: errors.length === 0, errors };
}
export function goodsInvoiceSummary(s, order, rule = commerceInvoiceRule(s, 'goods')) {
  const o = typeof order === 'string' ? (s.goods || []).find(x => x.id === order) : order, facts = goodsBasis(s, o);
  const includeShipping = rule?.shipping === 'include';
  const netCents = sum(facts.sourceSnapshot.filter(x => x.kind === 'goods' || includeShipping), x => x.netCents);
  const stageAt = rule?.applicationStage === 'received' ? o?.receivedAt : o?.paidAt;
  const stageReady = rule?.applicationStage === 'received' ? ['received', 'done'].includes(o?.status) && validTime(s, o?.receivedAt) : o?.payment?.status === 'success' && validTime(s, o?.paidAt);
  const windowEndsAt = validTime(s, stageAt) && Number.isSafeInteger(rule?.windowDays) ? stageAt + rule.windowDays * DAY : null;
  const reason = !ruleReady(rule, 'goods') ? '集团商品开票主体、申请规则及运费口径尚未发布' : !o ? '商品订单不存在' : facts.errors[0] ? facts.errors[0] : o.paidAt < rule.sourceFromAt ? '此订单早于已发布规则的可核对来源起点' : !stageReady ? '尚未达到已发布规则的开票申请阶段' : (o.cases || []).some(c => !terminalCase(c)) || (o.refunds || []).some(r => r.status === 'processing') ? '存在未结商品售后或退款结果待确定' : '';
  const sourceSnapshot = facts.sourceSnapshot.map(x => ({ ...x, includedInInvoice: x.kind === 'goods' || includeShipping, invoiceNetCents: x.kind === 'goods' || includeShipping ? x.netCents : 0 }));
  return { ...facts, sourceSnapshot, category: 'goods', orderId: o?.id, rule: rule ? copy(rule) : null, netCents, blocked: Boolean(reason), blockedReason: reason, stageReady, withinWindow: windowEndsAt != null && s.now <= windowEndsAt, windowEndsAt };
}
function monthBounds(month, offset) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month || '') || !Number.isSafeInteger(offset) || offset < -720 || offset > 840) return null;
  const [y, m] = month.split('-').map(Number);
  if (y < 2000 || y > 9998) return null;
  return { startAt: Date.UTC(y, m - 1, 1) - offset * 60000, endAt: Date.UTC(y, m, 1) - offset * 60000 };
}
function feeHasPersonalPromotion(s, entry) {
  const b = (s.bookings || []).find(b => b.id === entry?.bookingId);
  const p = [b?.payment, ...(b?.extensions || [])].find(p => p?.id === entry?.paymentId);
  const snapshot = p === b?.payment ? b?.servicePromotionSnapshot : p?.servicePromotionSnapshot || b?.servicePromotionSnapshot;
  const cashMarked = row => row?.basisSnapshot?.promotionSourceToken || row?.purpose === 'promotion-adjustment' || row?.cashComposition?.basis?.promotionSourceToken || row?.cashCompositionRequest?.basis?.promotionSourceToken || row?.cashComposition?.csCents > 0 || row?.cashCompositionRequest?.csCents > 0;
  return Boolean(snapshot?.promoter || entry?.servicePromotionSnapshot?.promoter || entry?.sourceSnapshot?.status === 'promotion-pending' || [entry?.split, ...(entry?.splitHistory || []), ...(entry?.returns || [])].some(cashMarked) || (s.serviceFinanceRecoveries || []).some(r => r.entryId === entry?.id && (r.reasonCode === 'finished-adjustment' || (r.records || []).some(cashMarked))));
}
function feeFacts(s, storeId, bounds, policy) {
  const allEntries = (s.serviceFinanceEntries || []).filter(e => e.storeId === storeId), sources = [], compositionPendingSources = [], principalSources = [], errors = [], seen = new Set(), compositions = new Map();
  const inMonth = at => !bounds || !validTime(s, at) || at >= bounds.startAt && at < bounds.endAt;
  const promotionEntries = new Set(allEntries.filter(e => feeHasPersonalPromotion(s, e)).map(e => e.id));
  const promotionRecovery = r => promotionEntries.has(r.entryId) || r.reasonCode === 'finished-adjustment';
  const recoveryTime = (r, record) => promotionRecovery(r) ? record.occurredAt : record.at;
  const unlocatedRecoveryCash = r => !cents(r.receivedCents) || r.receivedCents > 0 && (!(r.records || []).length || (r.records || []).some(x => !cents(x.amountCents) || !validTime(s, recoveryTime(r, x))) || sum(r.records || [], x => x.amountCents) !== r.receivedCents);
  // Only the selected month's receipts/returns and their original-payment chain
  // can block it. A new unrelated payment must not freeze historical invoices.
  const relevant = entry => {
    const incomes = [entry.split, ...(entry.splitHistory || [])].filter(tx => tx?.status === 'success');
    const returns = (entry.returns || []).filter(tx => tx?.status === 'success');
    const recoveries = (s.serviceFinanceRecoveries || []).filter(r => r.entryId === entry.id);
    if (recoveries.some(unlocatedRecoveryCash)) return true;
    if (incomes.some(tx => inMonth(tx.completedAt))) return true;
    if (recoveries.some(r => r.type === 'unshared-release' && (r.records || []).some(record => inMonth(recoveryTime(r, record))))) return true;
    if (policy === 'cash-month' && (
      returns.some(tx => inMonth(tx.completedAt)) ||
      recoveries.some(r => r.type !== 'unshared-release' && (r.records || []).some(record => inMonth(recoveryTime(r, record))))
    )) return true;
    return [entry.split, ...(entry.splitHistory || []), ...(entry.returns || [])].some(tx => tx?.status === 'processing' && validTime(s, tx.createdAt) && inMonth(tx.createdAt));
  };
  const entries = allEntries.filter(relevant);
  const add = (entry, id, kind, amount, at, reference = '', raw = {}) => {
    const promotion = promotionEntries.has(entry.id);
    const checked = compositions.get(entry.id)?.rows.find(row => row.id === id);
    const unresolved = promotion && cents(amount) && amount > 0 && !checked;
    if (unresolved && (policy === 'original-income-fifo' || inMonth(at))) errors.push('平台服务费与推广成本组成待核对');
    if (!id || !cents(amount) || !validTime(s, at)) { errors.push('集团收退记录缺少唯一来源、成功时间或有效金额'); return; }
    if (!amount) return;
    if (seen.has(id)) { errors.push('集团收退记录缺少唯一来源、成功时间或有效金额'); return; }
    seen.add(id);
    const source = { id, entryId: entry.id, bookingId: entry.bookingId, paymentId: entry.paymentId, storeId, kind, amountCents: amount, at, reference, ...raw };
    if (!promotion) sources.push(source);
    else if (!checked) compositionPendingSources.push(source);
    else sources.push({ ...source, amountCents: checked.hCents, normalCents: checked.normalCents, hCents: checked.hCents, csCents: checked.csCents, cashSource: copy(checked.source), cashAllocations: copy(checked.allocations) });
  };
  for (const entry of entries) {
    const b = (s.bookings || []).find(b => b.id === entry.bookingId), p = [b?.payment, ...(b?.extensions || [])].find(p => p?.id === entry.paymentId);
    if (!validId(entry.id) || !validId(entry.bookingId) || !validId(entry.paymentId) || !b || b.storeId !== storeId || p?.status !== 'success') { errors.push('集团收入未对应本店实际成功服务支付'); continue; }
    const txs = [entry.split, ...(entry.splitHistory || []), ...(entry.returns || [])].filter(Boolean);
    const affectsMonth = at => policy === 'original-income-fifo' || inMonth(at);
    if (promotionEntries.has(entry.id)) {
      const composition = serviceFinanceComposition(s, entry.id);
      compositions.set(entry.id, composition);
      principalSources.push(...composition.principalRows.filter(row => row.status === 'success' && inMonth(row.actualAt)));
      // Row-specific failures are handled with their actual month below. A
      // conflict without a locatable source still needs the original chain checked.
      const selectedCash = txs.some(tx => tx.status === 'success' && (tx.amountCents > 0 || tx.recoveryCents > 0) && affectsMonth(tx.completedAt)) || (s.serviceFinanceRecoveries || []).some(recovery => recovery.entryId === entry.id && (recovery.records || []).some(record => record.amountCents > 0 && affectsMonth(recoveryTime(recovery, record))));
      if (selectedCash && composition.errors.some(error => !composition.unresolvedSourceIds.some(id => error.startsWith(`${id}：`)))) errors.push('平台服务费与推广成本组成待核对');
    }
    const refundUnsettled = r => {
      const parts = [...(r.requests || []), ...(r.lines || []), ...(r.executions || [])];
      if (parts.length && !parts.some(x => x.paymentId === entry.paymentId)) return false;
      if (!affectsMonth(r.createdAt)) return false;
      return ['requested', 'offered', 'processing', 'failed', 'approved', 'escalated'].includes(r.status) || (r.status === 'rejected' && r.deadline) || !['withdrawn', 'closed', 'rejected'].includes(r.status) && (r.executions || []).some(x => x.paymentId === entry.paymentId && ['approved', 'processing', 'failed'].includes(x.status));
    };
    if ([...txs, entry.finish].some(tx => tx?.status === 'processing' && affectsMonth(tx.createdAt)) || (b.refunds || []).some(refundUnsettled)) errors.push('关联分账、退款结果未知或售后未结，须先核对原笔');
    for (const tx of [entry.split, ...(entry.splitHistory || [])].filter(x => x?.status === 'success')) {
      if (!validId(tx.id) || tx.kind !== 'split') { errors.push('集团成功分账来源标识或类型不明确'); continue; }
      add(entry, `split:${tx.id}`, 'income', tx.amountCents, tx.completedAt, tx.requestNo || '', { transactionId: tx.id });
    }
    for (const tx of (entry.returns || []).filter(x => x.status === 'success')) {
      if (!validId(tx.id) || tx.kind !== 'return') { errors.push('集团成功退回来源标识或类型不明确'); continue; }
      add(entry, `return:${tx.id}`, 'return', tx.amountCents, tx.completedAt, tx.requestNo || '', { transactionId: tx.id });
    }
    for (const recovery of (s.serviceFinanceRecoveries || []).filter(r => r.entryId === entry.id)) {
      const incoming = recovery.type === 'unshared-release', outgoing = ['return-failed', 'offline-adjustment'].includes(recovery.type);
      const records = recovery.records || [];
      if (!validId(recovery.id) || (!incoming && !outgoing) || recovery.storeId !== storeId || recovery.bookingId !== entry.bookingId || recovery.paymentId !== entry.paymentId || !cents(recovery.receivedCents) || sum(records, r => r.amountCents) !== recovery.receivedCents || (incoming ? recovery.payee !== 'group' || recovery.payer !== `store:${storeId}` : recovery.payer !== 'group' || recovery.payee !== `store:${storeId}`)) { errors.push('集团线下收退方向、实际金额或来源不一致'); continue; }
      for (const record of records) {
        if (!validId(record.id) || typeof record.reference !== 'string' || !record.reference.trim()) errors.push('集团线下收退缺少唯一记录或实际凭据号');
        add(entry, `recovery:${recovery.id}:${record.id}`, incoming ? 'income' : 'return', record.amountCents, recoveryTime(recovery, record), record.reference || '', { recoveryId: recovery.id, recordId: record.id });
      }
    }
  }
  const relevantRecoveries = (s.serviceFinanceRecoveries || []).filter(r => r.storeId === storeId && (
    unlocatedRecoveryCash(r) || r.receivedCents > 0 && (r.records || []).some(record => inMonth(recoveryTime(r, record)))
  ));
  for (const recovery of relevantRecoveries) if (!allEntries.some(e => e.id === recovery.entryId)) errors.push('实际线下收退缺少原服务资金条目或可定位的实际记录');
  sources.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
  compositionPendingSources.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
  return { sources, compositionPendingSources, principalSources: copy(principalSources), errors };
}
export function feeInvoiceSummary(s, storeId, month, rule = commerceInvoiceRule(s, 'fee')) {
  const bounds = monthBounds(month, rule?.timezoneMinutes), facts = feeFacts(s, storeId, bounds, rule?.returnPolicy), errors = [...facts.errors];
  let rows = [], allocationSnapshot = [];
  if (bounds && rule?.returnPolicy === 'original-income-fifo') {
    const incomes = facts.sources.filter(x => x.kind === 'income').map(x => ({ ...x, returnedCents: 0 }));
    for (const out of facts.sources.filter(x => x.kind === 'return')) {
      let remaining = out.amountCents;
      for (const income of incomes.filter(x => x.entryId === out.entryId && x.at <= out.at)) {
        const amount = Math.min(remaining, income.amountCents - income.returnedCents);
        if (amount > 0) { income.returnedCents += amount; remaining -= amount; allocationSnapshot.push({ returnId: out.id, incomeId: income.id, entryId: out.entryId, amountCents: amount, returnedAt: out.at, ...(out.cashSource ? { cashSource: copy(out.cashSource), cashAllocations: copy(out.cashAllocations), normalReturnCents: out.normalCents, csReturnCents: out.csCents } : {}) }); }
        if (!remaining) break;
      }
      if (remaining) errors.push('集团实际退回超过同原支付已收到的收入，不能自行分配差额');
    }
    rows = incomes.filter(x => x.at >= bounds.startAt && x.at < bounds.endAt).map(x => ({ ...x, netCents: x.amountCents - x.returnedCents }));
    allocationSnapshot = allocationSnapshot.filter(x => rows.some(row => row.id === x.incomeId));
  } else if (bounds && rule?.returnPolicy === 'cash-month') {
    rows = facts.sources.filter(x => x.at >= bounds.startAt && x.at < bounds.endAt).map(x => ({ ...x, netCents: x.kind === 'income' ? x.amountCents : -x.amountCents }));
    for (const entryId of new Set(facts.sources.map(x => x.entryId))) if (sum(facts.sources.filter(x => x.entryId === entryId), x => x.kind === 'income' ? x.amountCents : -x.amountCents) < 0) errors.push('集团同原支付退回超过已收收入，须核对来源');
  }
  const netCents = sum(rows, x => x.netCents), paidCents = sum(rows.filter(x => x.kind === 'income'), x => x.amountCents);
  const returnedCents = rule?.returnPolicy === 'original-income-fifo' ? sum(rows, x => x.returnedCents) : sum(rows.filter(x => x.kind === 'return'), x => x.amountCents);
  if (!Number.isSafeInteger(netCents) || !cents(paidCents) || !cents(returnedCents)) errors.push('集团月票合计超出有效分值范围');
  const reason = !ruleReady(rule, 'fee') ? '集团月票主体、时区和退回归属方案尚未发布' : !(s.stores || []).some(x => x.id === storeId) ? '受票门店不存在' : !bounds ? '请指定有效的对账月份' : bounds.startAt < rule.sourceFromAt ? '此月份早于已发布配置的可核对来源起点' : bounds.endAt > s.now ? '该对账月尚未结束，不能申请月票' : errors[0] || (netCents < 0 ? '本月集团退回大于收款，负净额待财务核定；不能开负票或自动结转' : '');
  return { category: 'fee', storeId, month, rule: rule ? copy(rule) : null, ...bounds, paidCents, refundedCents: returnedCents, netCents, sourceSnapshot: rows, compositionPendingSources: facts.compositionPendingSources, principalSources: facts.principalSources, allocationSnapshot, basisValid: errors.length === 0, blocked: Boolean(reason), blockedReason: reason, withinWindow: true };
}
function sourceSummary(s, invoice) {
  return invoice.category === 'goods' ? goodsInvoiceSummary(s, invoice.orderId, invoice.ruleSnapshot) : feeInvoiceSummary(s, invoice.storeId, invoice.month, invoice.ruleSnapshot);
}
function basisSignature(summary) {
  // Dates added for display do not change goods cash or invalidate legacy tickets.
  const withoutDisplayTime = rows => rows.map(({ at, ...row }) => row);
  // Confirmed pure Cs is visible for reconciliation but does not change fee H.
  const feeSources = summary.sourceSnapshot.filter(row => row.hCents !== 0);
  return signature({ netCents: summary.netCents, sources: summary.category === 'goods' ? withoutDisplayTime(summary.sourceSnapshot) : feeSources, refunds: summary.category === 'goods' ? withoutDisplayTime(summary.refundSnapshot || []) : summary.refundSnapshot || [], allocations: summary.allocationSnapshot || [] });
}
export function syncCommerceInvoices(s, ctx) {
  upgradeCommerceInvoices(s);
  for (const invoice of s.commerceInvoices) {
    const summary = sourceSummary(s, invoice);
    if (!summary.basisValid || invoice.basisSignature === basisSignature(summary)) continue;
    if (invoice.status === 'pending') {
      const before = { amount: invoice.amount, sourceSnapshot: copy(invoice.sourceSnapshot) };
      invoice.amount = summary.netCents; invoice.sourceSnapshot = copy(summary.sourceSnapshot); invoice.refundSnapshot = copy(summary.refundSnapshot || []); invoice.allocationSnapshot = copy(summary.allocationSnapshot || []); invoice.basisSignature = basisSignature(summary); invoice.version++;
      audit(s, invoice, '实际收退依据更新', { role: 'system' }, ctx, { before });
    } else if (invoice.status === 'issued') {
      invoice.status = 'red_pending'; invoice.version++;
      audit(s, invoice, '成功收退改变原票依据，待红冲', { role: 'system' }, ctx, { currentNetCents: summary.netCents, currentSourceSnapshot: summary.sourceSnapshot });
    }
  }
  return s;
}
function title(p, category, ctx) {
  if (!['personal', 'company'].includes(p.kind) || category === 'fee' && p.kind !== 'company') ctx.fail('请选择有效抬头；集团月票仅支持门店企业抬头');
  const result = { kind: p.kind, title: required(p.title, '发票抬头', ctx, 120), taxId: p.kind === 'company' ? required(p.taxId, '受票企业税号', ctx, 20).toUpperCase() : '', email: required(p.email, '接收邮箱', ctx, 254) };
  if (p.kind === 'company' && !/^[A-Z0-9]{15,20}$/.test(result.taxId)) ctx.fail('受票企业税号须为15至20位字母或数字');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.email)) ctx.fail('请填写有效的接收邮箱');
  return result;
}
function file(p, ctx) {
  if (!p || !/^invoice-file:[a-f0-9]{64}$/.test(p.ref || '') || !MIME.has(p.type) || !Number.isSafeInteger(p.size) || p.size <= 0 || p.size > 5 * 1024 * 1024) ctx.fail('请选择有效的实际PDF、PNG或JPEG凭证，最大5 MiB');
  return { ref: p.ref, name: required(p.name, '凭证文件名', ctx, 255), type: p.type, size: p.size };
}
function ticketNumber(s, invoice, p, ctx) {
  const n = required(p.ticketNumber, '实际票号', ctx, 100);
  if ((s.commerceInvoices || []).some(x => issuerKey(x.issuerSnapshot) === issuerKey(invoice.issuerSnapshot) && [x.issued, x.red].some(t => t?.ticketNumber === n))) ctx.fail('此集团开票主体已经使用该票号，请核对原票据');
  return n;
}
function available(summary, ctx, window = false) {
  if (summary.blocked) ctx.fail(summary.blockedReason);
  if (summary.netCents <= 0) ctx.fail('当前可开票净额为零或负数，不能申请或开具');
  if (window && !summary.withinWindow) ctx.fail('已超过发布规则的商品新申请期限');
}
function own(s, actor, category, source, ctx) {
  if (category === 'goods') {
    if (!source || actor.role !== 'user' || actor.userId !== source.userId || !(s.users || []).some(x => x.id === actor.userId)) ctx.fail('仅商品订单本人可以申请或修改商品发票');
  } else if (!storeFinance(actor) || actor.storeId !== source?.storeId || !(s.stores || []).some(x => x.id === actor.storeId)) ctx.fail('仅本门店财务可以申请或修改集团月票');
}
function currentInvoice(s, category, source) { return (s.commerceInvoices || []).find(x => x.category === category && (category === 'goods' ? x.orderId === source.orderId : x.storeId === source.storeId && x.month === source.month) && !x.replacedById); }
function newInvoice(s, category, source, summary, fields, actor, ctx, requestId, replacesId = null) {
  const row = { id: ctx.id(category === 'goods' ? 'GI' : 'FI'), category, ...source, ...fields, version: 1, status: 'pending', amount: summary.netCents, ruleSnapshot: copy(summary.rule), issuerSnapshot: copy(summary.rule.issuer), sourceSnapshot: copy(summary.sourceSnapshot), refundSnapshot: copy(summary.refundSnapshot || []), allocationSnapshot: copy(summary.allocationSnapshot || []), basisSignature: basisSignature(summary), requestId, replacesId, replacedById: null, issued: null, red: null, rejectReason: '', createdAt: s.now, updatedAt: s.now, history: [] };
  s.commerceInvoices.push(row); audit(s, row, replacesId ? '净额重开申请' : '申请', actor, ctx);
  return row;
}
function publishRule(s, actor, p, ctx) {
  if (!['goods', 'fee'].includes(p.category)) ctx.fail('请选择商品票或集团服务费月票配置');
  const v = Math.max(0, ...(s.commerceInvoiceRules || []).filter(x => x.category === p.category).map(x => x.version));
  version({ version: v }, p, ctx);
  const taxId = required(p.issuerTaxId, '集团开票主体税号（Demo输入）', ctx, 20).toUpperCase();
  if (!/^[A-Z0-9]{15,20}$/.test(taxId)) ctx.fail('开票主体税号须为15至20位字母或数字，不能从seed主体推定');
  const effectiveAt = time(p.effectiveAt, '配置生效时间', ctx), sourceFromAt = time(p.sourceFromAt, '可核对来源起点', ctx);
  if (effectiveAt < s.now || sourceFromAt > effectiveAt) ctx.fail('配置不能倒签生效；可核对来源起点不能晚于生效时间');
  const rule = { id: ctx.id('IR'), category: p.category, version: v + 1, issuer: { name: required(p.issuerName, '集团开票主体名称（Demo输入）', ctx, 120), taxId }, invoiceItem: required(p.invoiceItem, '开票项目', ctx, 120), reason: required(p.reason, '配置依据与发布说明', ctx), effectiveAt, sourceFromAt, mode: 'demo', productionApproved: false, publishedAt: s.now, actor: actorRecord(actor), history: [] };
  if (p.category === 'goods') {
    if (!['paid', 'received'].includes(p.applicationStage) || !['include', 'exclude'].includes(p.shipping)) ctx.fail('须明确商品申请阶段与运费开票口径');
    Object.assign(rule, { applicationStage: p.applicationStage, shipping: p.shipping, windowDays: integer(p.windowDays, '新申请窗口天数', ctx, 1, 3650) });
  } else {
    if (p.cycle !== 'monthly' || !['cash-month', 'original-income-fifo'].includes(p.returnPolicy)) ctx.fail('须明确月票周期和模拟退回归属方案；正式方案仍待财务确认');
    Object.assign(rule, { cycle: 'monthly', timezoneMinutes: integer(p.timezoneMinutes, '月份时区偏移分钟', ctx, -720, 840), returnPolicy: p.returnPolicy });
  }
  s.commerceInvoiceRules.push(rule); audit(s, rule, '发布本地Demo配置，正式政策待确认', actor, ctx, { reason: rule.reason }); return rule;
}
// Original ticket selection is read-only and precedes completing ticket number,
// reason or file fields. No isolated command is run to manufacture permission.
export function commerceInvoiceUploadScope(s,rawActor,type,p={}) {
  const ctx={fail:message=>{throw new Error(message);}},actor=resolveAccountActor(s,rawActor);
  assertAccountCommand(actor,type);
  if(!['commerce-invoice.issue','commerce-invoice.red','commerce-invoice.replace-file'].includes(type))ctx.fail('该原集团票据操作没有文件选择用途');
  const found=(s.commerceInvoices||[]).filter(row=>row.id===p.id);
  if(found.length!==1)ctx.fail('原集团票据缺失或编号不唯一');
  const row=found[0];
  if(!['goods','fee'].includes(row.category)||!canAccountView(actor,routeFor(row.category))||!groupFinance(actor))ctx.fail('仅当前集团财务可选择原票据凭证');
  version(row,p,ctx);
  let root;
  if(row.category==='goods') {
    const orders=(s.goods||[]).filter(order=>order.id===row.orderId),users=(s.users||[]).filter(user=>user.id===row.userId);
    if(orders.length!==1||users.length!==1||orders[0].userId!==row.userId)ctx.fail('原商品订单或申请本人来源缺失、冲突');
    root=orders[0];
  } else {
    const stores=(s.stores||[]).filter(store=>store.id===row.storeId);
    if(stores.length!==1||typeof row.month!=='string'||!/^\d{4}-\d{2}$/.test(row.month))ctx.fail('原服务费月份或门店来源缺失');
    root=stores[0];
  }
  const summary=sourceSummary(s,row),slot=type==='commerce-invoice.issue'?'issued':type==='commerce-invoice.red'?'red':p.slot;
  if(type==='commerce-invoice.issue'){if(row.status!=='pending')ctx.fail('只有待开票申请可选择开票凭证');available(summary,ctx);}
  else if(type==='commerce-invoice.red'){if(row.status!=='red_pending'||!row.issued)ctx.fail('原票没有待红冲事项');}
  else if(!['issued','red'].includes(slot)||!row[slot])ctx.fail('没有可补传的原票据凭证');
  return copy({actor,row,source:{root,summary},slot});
}
export function commerceInvoiceCommand(s, actor, type, p, ctx) {
  actor = resolveAccountActor(s, actor); assertAccountCommand(actor, type,p,s);
  upgradeCommerceInvoices(s);
  const op = type.replace(/^commerce-invoice\./, '');
  if (!type.startsWith('commerce-invoice.') || !['rule-publish', 'apply-goods', 'apply-fee', 'resubmit', 'reapply', 'issue', 'reject', 'red', 'replace-file'].includes(op)) ctx.fail('不支持的集团票据操作');
  const writing = ['rule-publish', 'issue', 'reject', 'red', 'replace-file'].includes(op);
  let invoice = ['rule-publish', 'apply-goods', 'apply-fee'].includes(op) ? null : exactSource(s.commerceInvoices,p.id,'原集团发票',ctx);
  const category = invoice?.category || (op === 'apply-goods' ? 'goods' : op === 'apply-fee' ? 'fee' : p.category);
  if (!canAccountView(actor, op === 'rule-publish' ? 'commerce-invoice-rules' : routeFor(category))) ctx.fail('当前工作岗位无权办理此类集团票据');
  const original=commandSource(s,op,invoice,category,p,ctx);
  if (writing) { if (!groupFinance(actor)) ctx.fail('仅集团财务可以发布配置或开具、红冲集团票据'); }
  else {
    own(s, actor, category, category === 'goods' ? (s.goods || []).find(x => x.id === (invoice?.orderId || p.orderId)) : { storeId: invoice?.storeId || p.storeId }, ctx);
    if (invoice?.category === 'goods' && invoice.userId !== actor.userId) ctx.fail('当前订单与原发票申请人不一致，请先核对资源归属');
  }
  const requestId = required(p.requestId, '唯一提交标识', ctx), author=signature(actorRecord(actor)),who=requestActorKey(author),facts={type,p};
  const candidates=s.commerceInvoiceRequests.filter(x=>x.requestId===requestId);
  if(candidates.some(x=>!requestActorKey(x.actor)))ctx.fail('原集团票据请求作者损坏，请核对原请求记录');
  const requests=candidates.filter(x=>requestActorKey(x.actor)===who);
  if(requests.length>1)ctx.fail('同一作者及提交标识存在冲突的原集团票据请求，请核对原记录');
  const previous=requests[0];
  if (previous) {
    if (!matchesRequest(previous,facts,ctx)) ctx.fail('同一提交标识不能用于不同票据操作或内容');
    return requestResult(s,op,p,previous,invoice,original,ctx);
  }
  syncCommerceInvoices(s, ctx);
  if (op === 'rule-publish') invoice = publishRule(s, actor, p, ctx);
  else {
    if (invoice) version(invoice, p, ctx);
    const source = invoice || (category === 'goods' ? { orderId: p.orderId, userId: actor.userId } : { storeId: actor.storeId, month: p.month });
    const summary = invoice ? sourceSummary(s, invoice) : category === 'goods' ? goodsInvoiceSummary(s, p.orderId) : feeInvoiceSummary(s, actor.storeId, p.month);
    if (op.startsWith('apply-')) {
      available(summary, ctx, category === 'goods');
      if (currentInvoice(s, category, source)) ctx.fail('该来源已有发票申请，请返回原记录修改、红冲或重开');
      invoice = newInvoice(s, category, source, summary, title(p, category, ctx), actor, ctx, requestId);
    } else if (op === 'resubmit') {
      if (invoice.status !== 'rejected' || invoice.replacedById) ctx.fail('只有当前已驳回申请可以修改重提');
      available(summary, ctx, category === 'goods' && !invoice.replacesId);
      Object.assign(invoice, title(p, category, ctx), { status: 'pending', rejectReason: '', amount: summary.netCents, sourceSnapshot: copy(summary.sourceSnapshot), refundSnapshot: copy(summary.refundSnapshot || []), allocationSnapshot: copy(summary.allocationSnapshot || []), basisSignature: basisSignature(summary) });
      invoice.version++; audit(s, invoice, '修改后重提', actor, ctx);
    } else if (op === 'issue') {
      if (invoice.status !== 'pending') ctx.fail('只有待开票申请可以登记实际票据'); available(summary, ctx);
      invoice.issued = { ticketNumber: ticketNumber(s, invoice, p, ctx), file: file(p.file, ctx), amountCents: summary.netCents, at: s.now };
      invoice.status = 'issued'; invoice.version++; audit(s, invoice, '登记已开票', actor, ctx, { issued: invoice.issued });
    } else if (op === 'reject') {
      if (invoice.status !== 'pending') ctx.fail('只有待开票申请可以驳回'); invoice.rejectReason = required(p.reason, '驳回原因', ctx);
      invoice.status = 'rejected'; invoice.version++; audit(s, invoice, '驳回', actor, ctx, { reason: invoice.rejectReason });
    } else if (op === 'red') {
      if (invoice.status !== 'red_pending' || !invoice.issued) ctx.fail('原票没有待红冲事项');
      invoice.red = { ticketNumber: ticketNumber(s, invoice, p, ctx), file: file(p.file, ctx), amountCents: invoice.issued.amountCents, at: s.now };
      invoice.status = 'red'; invoice.version++; audit(s, invoice, '登记原票红冲', actor, ctx, { red: invoice.red });
    } else if (op === 'replace-file') {
      if (!['issued', 'red'].includes(p.slot) || !invoice[p.slot]) ctx.fail('没有可补传的原票据凭证');
      const reason = required(p.reason, '补传原因', ctx), previousFile = copy(invoice[p.slot].file); invoice[p.slot].file = file(p.file, ctx);
      invoice.version++; audit(s, invoice, '补传凭证', actor, ctx, { reason, slot: p.slot, previousFile, file: invoice[p.slot].file });
    } else if (op === 'reapply') {
      if (invoice.status !== 'red' || !invoice.red || invoice.replacedById) ctx.fail('原票红冲后且尚未重开，才能申请新净额票'); available(summary, ctx);
      const prior = invoice;
      invoice = newInvoice(s, category, category === 'goods' ? { orderId: prior.orderId, userId: prior.userId } : { storeId: prior.storeId, month: prior.month }, summary, title(p, category, ctx), actor, ctx, requestId, prior.id);
      prior.replacedById = invoice.id; prior.version++; audit(s, prior, '关联净额重开申请', actor, ctx, { replacedById: invoice.id });
    }
  }
  s.commerceInvoiceRequests.push({ requestId, actor: author,type,fingerprint:requestDigest(facts),digestAlgorithm:'SHA-256',digestVersion:1,resultId: invoice.id, at: s.now }); return invoice;
}
export function canReadCommerceInvoice(s, actor, invoice) {
  try {
    actor = resolveAccountActor(s, actor);
    if (!invoice || !canAccountView(actor, routeFor(invoice.category))) return false;
    if (groupFinance(actor)) return true;
    return invoice.category === 'goods' ? actor.role === 'user' && actor.userId === invoice.userId && (s.users || []).some(u => u.id === actor.userId) && (s.goods || []).some(o => o.id === invoice.orderId && o.userId === actor.userId) : storeFinance(actor) && actor.storeId === invoice.storeId && (s.stores || []).some(x => x.id === actor.storeId);
  } catch { return false; }
}
export function authorizedCommerceInvoiceFile(s, actor, id, slot, ref) {
  const invoice = (s.commerceInvoices || []).find(x => x.id === id);
  if (!canReadCommerceInvoice(s, actor, invoice)) throw new Error('当前身份无权读取此集团票据附件');
  const file = ['issued', 'red'].includes(slot) ? invoice[slot]?.file : null;
  if (!file || file.ref !== ref) throw new Error('票据附件已更新，请刷新后查看当前凭证');
  return copy(file);
}
export function commerceInvoiceViewData(s, actor) {
  actor = resolveAccountActor(s, actor);
  return { rules: groupFinance(actor) && canAccountView(actor, 'commerce-invoice-rules') ? copy(s.commerceInvoiceRules || []) : [], invoices: copy((s.commerceInvoices || []).filter(x => canReadCommerceInvoice(s, actor, x))) };
}
