// Local service-money ledger. No channel call or production financial policy is implied.
import { careBlocksBooking } from './service-care.mjs';
import { fulfilmentBlockers } from './fulfilment.mjs';
import { actorAccountFields } from './staff-accounts.mjs';
import { servicePromotionFinance } from './service-promotion.mjs';
import { captureServiceFinanceComposition, assertServiceFinanceCompositionToken, bindServiceFinanceComposition } from './service-finance-composition.mjs';
import { serviceFinanceOriginalSource, serviceFinanceQueryTransaction } from './service-finance-source.mjs';
const DAY = 86400000;
const OPEN_REFUNDS = new Set(['requested', 'offered', 'approved', 'processing', 'failed', 'escalated']);
const RESULT = new Set(['success', 'failed', 'processing']);
const copy = value => structuredClone(value);
const sum = (items, fn) => items.reduce((n, item) => n + fn(item), 0);
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value;
const signature = value => JSON.stringify(canonical(value));
const actorInfo = actor => ({ role: actor.role, job: actor.job || null, id: actor.role === 'group' ? 'group' : actor.storeId || actor.userId || actor.techId, ...actorAccountFields(actor) });
const writer = actor => actor?.role === 'group' && (!actor.job || ['all', 'finance'].includes(actor.job));
const readable = (actor, entry) => writer(actor) || (['store', 'manager'].includes(actor?.role) && actor.storeId === entry.storeId);
const fail = (ctx, message) => { if (ctx?.fail) ctx.fail(message); throw new Error(message); };
function required(value, label, ctx, max = 500) { const text = String(value ?? '').trim(); if (!text || text.length > max) fail(ctx, `请填写${label}（最多${max}字）`); return text; }
function integer(value, label, ctx, min = 0, max = Number.MAX_SAFE_INTEGER) { const n = Number(value); if (value === '' || value == null || !Number.isSafeInteger(n) || n < min || n > max) fail(ctx, `${label}无效`); return n; }
function timestamp(value, ctx) {
  if (typeof value === 'number') { if (!Number.isSafeInteger(value)) fail(ctx, '生效时间无效'); return value; }
  const text = String(value || ''), parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?$/.exec(text);
  if (!parts || +parts[2] < 1 || +parts[2] > 12 || +parts[3] < 1 || +parts[3] > new Date(Date.UTC(+parts[1], +parts[2], 0)).getUTCDate() || +parts[4] > 23 || +parts[5] > 59 || +(parts[6] || 0) > 59) fail(ctx, '生效时间无效');
  const n = Date.parse(parts[7] ? text : `${text}+08:00`); if (!Number.isSafeInteger(n)) fail(ctx, '生效时间无效'); return n;
}
function id(s, ctx, prefix) { return ctx?.id ? ctx.id(prefix) : `${prefix}${++s.seq}`; }
function audit(s, entity, action, actor, ctx, details = {}) {
  entity.history ??= []; entity.history.push({ at: s.now, action, actor: actorInfo(actor), version: entity.version, ...copy(details) });
  ctx?.log?.(entity, `服务资金${action}${details.reason ? ' · ' + details.reason : ''}`);
}
function checkVersion(entity, p, ctx) { if (!Number.isSafeInteger(Number(p.version)) || Number(p.version) !== entity.version) fail(ctx, '资金记录已更新或缺少版本，请刷新后核对'); }
export function upgradeServiceFinance(s) {
  s.serviceFinanceRules ??= []; s.serviceFinanceEntries ??= []; s.serviceFinanceRequests ??= []; s.serviceFinanceRecoveries ??= [];
  return s;
}
function completeNaturalBindings(s, ctx) {
  for (const user of s.users || []) {
    const binding = user.serviceBinding;
    // Only an explicitly observed unbound identity can transition; legacy absence is unknown.
    if (!binding || binding.status !== 'unbound' || binding.origin !== 'demo-initial' || !Number.isFinite(binding.recordedAt)) continue;
    const completed = (s.bookings || []).filter(b => b.userId === user.id && b.status === 'done' && Number.isFinite(b.completedAt) && b.completedAt >= binding.recordedAt && b.completedAt <= s.now && b.payment?.status === 'success' && b.payment.amountCents > (b.payment.refundedCents || 0))
      .sort((a, z) => a.completedAt - z.completedAt || a.id.localeCompare(z.id))[0];
    if (!completed) continue;
    user.serviceBindingHistory ??= [];
    user.serviceBinding = { status: 'group', ownerType: 'group', ownerStoreId: null, promoterId: null, recordedAt: completed.completedAt, expiresAt: completed.completedAt + 365 * DAY, origin: 'natural-first-completion', bookingId: completed.id };
    user.serviceBindingHistory.push({ at: s.now, occurredAt: completed.completedAt, reason: '明确未绑定的自然用户完成首笔服务，按04归属集团', bookingId: completed.id, before: copy(binding), after: copy(user.serviceBinding), actor: { role: 'system' } });
  }
}
export function previewServiceFinanceRule(p) {
  const groupBps = Number(p.groupBps), storeBps = Number(p.storeBps), amount = Number(p.amountCents);
  const valid = p.groupBps !== '' && p.groupBps != null && p.storeBps !== '' && p.storeBps != null && [groupBps, storeBps].every(x => Number.isSafeInteger(x) && x >= 0 && x <= 3000) && Number.isSafeInteger(amount) && amount >= 0 && amount <= Math.floor(Number.MAX_SAFE_INTEGER / 10000);
  if (!valid) return { valid: false, error: '请明确填写两档0%至30%的Demo比例和整数分金额', groupCents: null, storeCents: null };
  const groupCents = Math.floor(amount * (p.customerType === 'store' ? storeBps : groupBps) / 10000);
  return { valid: true, error: '', groupCents, storeCents: amount - groupCents };
}
function scopeKey(rule) { return [rule.scope, rule.storeId || '', rule.serviceId || ''].join(':'); }
function selectRule(s, b) {
  const rank = { global: 1, service: 2, store: 3, 'store-service': 4 };
  return s.serviceFinanceRules.filter(r => r.effectiveAt <= s.now && (!r.storeId || r.storeId === b.storeId) && (!r.serviceId || r.serviceId === b.serviceId))
    .sort((a, z) => rank[z.scope] - rank[a.scope] || z.effectiveAt - a.effectiveAt || z.version - a.version)[0] || null;
}
function sourceSnapshot(s, b) {
  const binding = s.users.find(u => u.id === b.userId)?.serviceBinding;
  const base = { status: 'unknown', customerType: null, ownerType: null, ownerStoreId: null, promoterId: null, capturedAt: s.now, reason: '缺少下单时服务客户归属事实，待核对' };
  if (!binding || !Number.isFinite(binding.recordedAt) || binding.recordedAt > s.now) return base;
  if (binding.expiresAt && binding.expiresAt <= s.now) return { ...base, status: 'known', customerType: 'group', reason: '下单时原服务归属已到期，按未绑定集团客户档' };
  if (binding.promoterId) {
    const ownerType = binding.ownerType, ownerStoreId = binding.ownerStoreId || binding.storeId || null;
    if (!['store','group'].includes(ownerType) || ownerType === 'store' && !s.stores.some(x=>x.id===ownerStoreId)) return {...base,status:'promotion-pending',promoterId:binding.promoterId,reason:'原个人推广归属依据缺失，待核对'};
    return { ...base, status: 'promotion-pending', customerType:ownerType==='store'&&ownerStoreId===b.storeId?'store':'group', ownerType, promoterId: binding.promoterId, ownerStoreId:ownerType==='store'?ownerStoreId:null, reason: '按下单时个人服务推广快照核对佣金和承担方' };
  }
  if (binding.status === 'unbound') return { ...base, status: 'known', customerType: 'group', reason: '下单时明确未绑定，按集团客户档，无个人推广佣金' };
  const ownerType = binding.ownerType || (['group', 'store'].includes(binding.status) ? binding.status : null);
  if (ownerType === 'group') return { ...base, status: 'known', customerType: 'group', ownerType, reason: '下单时为集团客户，无个人推广佣金' };
  const ownerStoreId = binding.ownerStoreId || binding.storeId;
  if (ownerType === 'store' && s.stores.some(x => x.id === ownerStoreId)) return { ...base, status: 'known', customerType: ownerStoreId === b.storeId ? 'store' : 'group', ownerType, ownerStoreId, reason: ownerStoreId === b.storeId ? '服务门店自有客户，无个人推广佣金' : '跨店服务，按实际服务门店集团客户档；原归属店不分账' };
  return base;
}
export function captureBookingFinance(s, b, ctx) {
  upgradeServiceFinance(s);
  if (b.serviceFinanceSnapshot) return b.serviceFinanceSnapshot;
  const source = sourceSnapshot(s, b), rule = selectRule(s, b);
  b.serviceFinanceSnapshot = { capturedAt: s.now, origin: 'booking-create', source, rule: rule ? copy(rule) : null, missingRule: !rule, mode: 'demo', productionApproved: false };
  return b.serviceFinanceSnapshot;
}
export function captureExtensionFinance(s, b, payment, ctx) {
  if (!payment.serviceFinanceSnapshot) payment.serviceFinanceSnapshot = b.serviceFinanceSnapshot ? { ...copy(b.serviceFinanceSnapshot), inheritedFromBookingId: b.id } : { capturedAt: s.now, origin: 'legacy-missing', source: null, rule: null, missingRule: true };
  return payment.serviceFinanceSnapshot;
}
function paymentFor(b, paymentId) { return [b.payment, ...(b.extensions || [])].find(p => p?.id === paymentId); }
function financialFacts(s, b, payment) {
  const blockers = [];
  blockers.push(...fulfilmentBlockers(s,b.id));
  if (careBlocksBooking(s, b)) blockers.push('质量反馈案件尚未结案');
  if ((s.safety || []).some(h => h.bookingId === b.id && (h.status === 'open' || (h.unresolvedDispute && !(b.disputes || []).some(d => d.safetyId === h.id || d.id === h.disputeId))))) blockers.push('安全事项尚未结案');
  if ((b.disputes || []).some(d => !['resolved', 'closed'].includes(d.status))) blockers.push('服务争议或中止核实尚未结案');
  if ((b.refunds || []).some(r => OPEN_REFUNDS.has(r.status) || (r.status === 'rejected' && r.deadline))) blockers.push('售后退款事项尚未结案');
  const unknownRefund = (b.refunds || []).some(r => (r.executions || []).some(x => x.paymentId === payment.id && x.status === 'processing') || (r.status === 'processing' && !r.executions?.length));
  const heldConfirmedCents = sum(b.refunds || [], r => ['approved', 'processing', 'failed'].includes(r.status) ? sum(r.executions?.length ? r.executions : r.lines || [], x => x.paymentId === payment.id && ['approved', 'processing', 'failed', undefined].includes(x.status) ? Number(x.amountCents || 0) : 0) : 0);
  const paidCents = Number(payment.amountCents), refundedCents = Number(payment.refundedCents ?? 0), netCents = paidCents - refundedCents;
  const amountsValid = [paidCents, refundedCents, heldConfirmedCents].every(n => Number.isSafeInteger(n) && n >= 0) && refundedCents + heldConfirmedCents <= paidCents && paidCents <= Math.floor(Number.MAX_SAFE_INTEGER / 10000);
  return { blockers, unknownRefund, heldConfirmedCents, paidCents, refundedCents, netCents, amountsValid };
}
const txSuccess = tx => tx?.status === 'success';
function splitFacts(entry) {
  const transactions = [], byId = new Map(), byRequest = new Map(), errors = [];
  for (const tx of [entry.split, ...(entry.splitHistory || [])].filter(Boolean)) {
    const old = tx.id && byId.get(tx.id) || tx.requestNo && byRequest.get(tx.requestNo);
    if (old) {
      if (['id','requestNo','status','amountCents','channelTotalCents','completedAt'].some(key => old[key] !== tx[key])) errors.push('同一原分账编号存在冲突事实，须核对原笔');
      continue;
    }
    transactions.push(tx); if (tx.id) byId.set(tx.id, tx); if (tx.requestNo) byRequest.set(tx.requestNo, tx);
  }
  return { transactions, errors };
}
export function serviceSplitTransactions(entry) { return copy(splitFacts(entry).transactions); }
function returnSources(entry, t, pendingCents) {
  const successes = t.splitTransactions.filter(txSuccess), errors = [], rows = successes.map(tx => {
    const match = r => Boolean(r.splitId && tx.id && r.splitId === tx.id) || !r.splitId && successes.length === 1;
    const ownReturns = (entry.returns || []).filter(match);
    const returnedCents = sum(ownReturns.filter(txSuccess), x => x.amountCents);
    const reservedCents = sum(ownReturns.filter(x => x.status === 'processing'), x => x.amountCents);
    let offlineCents = 0;
    for (const debt of t.recoveries.filter(r => r.type === 'return-failed')) {
      if (!(debt.records || []).length && successes.length === 1) offlineCents += debt.receivedCents;
      else offlineCents += sum((debt.records || []).filter(match), x => x.amountCents);
      if (successes.length > 1 && debt.receivedCents && (!(debt.records || []).length || debt.records.some(r => !r.splitId))) errors.push('旧线下代退缺少原成功分账来源，多笔不可猜测分摊');
    }
    const remainingCents = tx.amountCents - returnedCents - reservedCents - offlineCents;
    if (remainingCents < 0) errors.push('原分账回退及实际代退超过本笔成功正常份额');
    return { splitId:tx.id, splitRequestNo:tx.requestNo, amountCents:tx.amountCents, returnedCents, reservedCents, offlineCents, remainingCents:Math.max(0,remainingCents), returnableCents:Math.min(Math.max(0,remainingCents),pendingCents || 0), failedReturn:(ownReturns || []).some(r=>r.status==='failed'&&!r.supersededAt) };
  });
  for (const r of entry.returns || []) if (!r.supersededAt && r.amountCents > 0 && (r.splitId ? !successes.some(x=>x.id===r.splitId&&(!r.splitRequestNo||r.splitRequestNo===x.requestNo)) : successes.length !== 1)) errors.push('分账回退缺少唯一原成功分账来源，请人工核实');
  return { rows, errors };
}
function totals(s, entry) {
  const splits = splitFacts(entry), splitPaidCents = sum(splits.transactions.filter(txSuccess), x => x.amountCents);
  const returnedCents = sum((entry.returns || []).filter(txSuccess), x => x.amountCents);
  const recoveries = s.serviceFinanceRecoveries.filter(r => r.entryId === entry.id);
  const externalChannelReturnCents = sum(recoveries.filter(r => r.type === 'return-failed'), r => r.receivedCents);
  const externalRecoveryReturnCents = sum(recoveries.filter(r => r.type === 'offline-adjustment'), r => r.receivedCents);
  const externalToStoreCents = externalChannelReturnCents + externalRecoveryReturnCents;
  const externalToGroupCents = sum(recoveries.filter(r => r.type === 'unshared-release'), r => r.receivedCents);
  return { splitPaidCents, returnedCents, externalToStoreCents, externalToGroupCents, externalChannelReturnCents, externalRecoveryReturnCents, recoveries, splitTransactions:splits.transactions, splitErrors:splits.errors };
}
function projectEntry(s, entry) {
  const b = s.bookings.find(x => x.id === entry.bookingId), payment = b && paymentFor(b, entry.paymentId);
  if (!b || !payment) return { ...copy(entry), status: 'needs-review', statusLabel: '来源缺失待核对', blockers: ['预约或原支付不存在'], eligibilityReason: '预约或原支付不存在', canPayTech: false };
  const facts = financialFacts(s, b, payment), t = totals(s, entry), source = entry.sourceSnapshot, rule = entry.ruleSnapshot;
  const paidAt = entry.paidAt, timingKnown = Number.isFinite(paidAt) && paidAt <= s.now;
  const forceAt = timingKnown ? paidAt + 25 * DAY : null, alertAt = timingKnown ? paidAt + 27 * DAY : null, expiresAt = timingKnown ? paidAt + 30 * DAY : null;
  const forced = timingKnown && s.now >= forceAt, expired = timingKnown && s.now >= expiresAt;
  const promotionSnapshot = payment === b.payment ? b.servicePromotionSnapshot : payment.servicePromotionSnapshot;
  const financeSnapshot=payment===b.payment?b.serviceFinanceSnapshot:payment.serviceFinanceSnapshot;
  const sourceFields=x=>x&&[x.status,x.customerType,x.ownerType,x.ownerStoreId||null,x.promoterId||null];
  const promotionBasis = source?.status === 'promotion-pending' && promotionSnapshot?.promoter?.id === source.promoterId && promotionSnapshot.promoter.ownerType === source.ownerType && (promotionSnapshot.promoter.ownerStoreId || null) === (source.ownerStoreId || null) && signature(sourceFields(financeSnapshot?.source))===signature(sourceFields(source));
  const original=serviceFinanceOriginalSource(s,entry.id);
  const sourceReason=!original?'原预约、支付或资金来源缺失、重复或串号，待核对':original.personal?!promotionBasis?'原个人推广来源缺失或冲突，待核对':'':!original.consistent?original.reason:'';
  let configReason = sourceReason || (source?.status === 'promotion-pending' && !promotionBasis ? source.reason : source?.status !== 'known' && !promotionBasis ? '下单时服务归属缺失，待核对，不能认定自然客户' : !rule ? '缺少下单时分账规则快照，待核对；发布新规则不追补旧单' : !timingKnown ? '原支付成功时间缺失，资金期限待渠道核对' : !facts.amountsValid ? '支付、退款或退款占额异常，待核对' : '');
  const rate = rule && (source?.status === 'known' || promotionBasis) ? Number(source.customerType === 'store' ? rule.storeBps : rule.groupBps) : null;
  const validRate = Number.isSafeInteger(rate) && rate >= 0 && rate <= 3000;
  const splitBaseCents = facts.netCents - (forced ? facts.heldConfirmedCents : 0);
  const platformCents = !configReason && validRate ? Math.floor(facts.netCents * rate / 10000) : null;
  const platformSplitCents = !configReason && validRate ? Math.floor(splitBaseCents * rate / 10000) : null;
  const promotion = promotionBasis && platformCents != null ? servicePromotionFinance(s,entry,{netCents:facts.netCents,splitBaseCents,platformCents,platformSplitCents}) : null;
  const commission = (s.serviceCommissions || []).find(c=>c.bookingId===b.id&&c.paymentId===payment.id);
  const unknownPersonalTransfer = Boolean(promotionBasis && (s.servicePromotionWithdrawals || []).some(w=>['processing','awaiting_user','cancel_requested'].includes(w.status)&&w.allocations.some(a=>a.commissionId===commission?.id&&(!commission.known||a.sourceToken!==commission.sourceToken))));
  if (promotionBasis && (!promotion?.applicable || !promotion.known)) configReason ||= promotion?.reason || '原个人推广佣金来源未接齐，不能按零佣金分账';
  if (unknownPersonalTransfer) configReason ||= '个人提现结果未知且佣金来源已变化，先查原转账，暂不回退或确定门店差额';
  if (t.splitErrors.length) configReason ||= t.splitErrors.join('；');
  let known = !configReason && validRate;
  let targetGroupCents = known ? promotionBasis ? promotion.targetGroupCents : platformCents : null;
  let splitTargetCents = known ? promotionBasis ? promotion.splitTargetCents : platformSplitCents : null;
  const retainedStoreCommissionCents = promotion?.known ? promotion.retainedStoreCommissionCents : null;
  let collectibleTargetCents = known ? splitTargetCents + (promotionBasis ? retainedStoreCommissionCents : 0) : null;
  const actualGroupNetCents = t.splitPaidCents - t.returnedCents - t.externalToStoreCents + t.externalToGroupCents;
  let pendingAdditionalCents = known ? Math.max(0,collectibleTargetCents-actualGroupNetCents) : null;
  const channelGroupNet = t.splitPaidCents - t.returnedCents - t.externalChannelReturnCents;
  let totalReturnPendingCents = known ? Math.max(0, channelGroupNet + t.externalToGroupCents - t.externalRecoveryReturnCents - targetGroupCents) : null;
  let pendingReturnCents = known ? Math.min(Math.max(0, channelGroupNet), totalReturnPendingCents) : null;
  let pendingOfflineReturnCents = known ? totalReturnPendingCents - pendingReturnCents : null;
  const unknownChannel = [...t.splitTransactions, entry.finish, ...(entry.returns || [])].some(x => x?.status === 'processing');
  const successfulFinish = Boolean(txSuccess(entry.finish) || (expired && !unknownChannel && entry.releaseConfirmedAt));
  const returnFacts = returnSources(entry,t,pendingReturnCents);
  if (returnFacts.errors.length) { configReason ||= returnFacts.errors.join('；'); known=false; targetGroupCents=splitTargetCents=collectibleTargetCents=pendingAdditionalCents=totalReturnPendingCents=pendingReturnCents=pendingOfflineReturnCents=null; }
  const debtOutstanding = sum(t.recoveries, r => Math.max(0, r.amountCents - r.receivedCents));
  const complete = b.status === 'done' && Number.isFinite(b.completedAt), aftersaleEnded = complete && s.now >= b.completedAt + 2 * DAY;
  const terminalRefunded = facts.netCents === 0 && !facts.unknownRefund && !facts.blockers.length && !unknownChannel && totalReturnPendingCents === 0 && !debtOutstanding;
  const canPayTech = Boolean(known && facts.netCents > 0 && aftersaleEnded && !facts.blockers.length && !facts.unknownRefund && !unknownChannel && successfulFinish && !totalReturnPendingCents && !debtOutstanding && !pendingAdditionalCents && actualGroupNetCents >= targetGroupCents);
  let status = 'waiting', statusLabel = '等待服务完成及售后期', eligibilityReason = '';
  if (configReason || !validRate) { status = 'needs-review'; statusLabel = unknownPersonalTransfer ? '个人转账结果待查询' : source?.status === 'promotion-pending' ? '推广来源待核对' : !rule ? '规则待核对' : '归属或资金待核对'; eligibilityReason = configReason || '比例快照无效'; }
  else if (facts.unknownRefund) { status = 'refund-query'; statusLabel = '退款结果待查询'; eligibilityReason = '退款结果未知，先查询原笔退款；强制日不能跳过'; }
  else if (unknownChannel) { status = 'processing'; statusLabel = '渠道结果待查询'; eligibilityReason = '原笔渠道结果未知，不得重复执行或登记线下回款'; }
  else if (terminalRefunded) { status = 'void'; statusLabel = '全额退款已闭环'; }
  else if (totalReturnPendingCents > 0) { status = 'return-pending'; statusLabel = pendingOfflineReturnCents > 0 ? '集团多收差额待退回' : '分账差额待回退'; eligibilityReason = pendingOfflineReturnCents > 0 ? '线下追偿收款后产生退款差额，须登记集团向门店的实际线下退回；不能调用不存在的分账原笔' : '成功退款产生分账差额，请回退或核对已有回退交易'; }
  else if (debtOutstanding > 0) { status = 'recovery'; statusLabel = '追偿待处理'; eligibilityReason = '已有资金差额追偿，不能视为已结清'; }
  else if (pendingAdditionalCents > 0 && successfulFinish) { status='additional-recovery'; statusLabel='已释放服务款差额待追收'; eligibilityReason='原完结及解冻事实保留，新增应得不能再次原款分账，须核对同店实际回款'; }
  else if (canPayTech) { status = 'settled'; statusLabel = '分账已完结'; }
  else if (successfulFinish) { status = 'settled-blocked'; statusLabel = facts.blockers.length ? '分账已完结，售后或安全阻断' : '分账已完结，待业务结案'; eligibilityReason = facts.blockers.length ? facts.blockers.join('；') : '资金释放事实保留，服务完成、售后期和其他结清条件尚未全部满足'; }
  else if (expired) { status = 'released'; statusLabel = '已到解冻日，待核对'; eligibilityReason = '冻结期限已过，停止新分账，按原笔结果核对追偿'; }
  else if ((txSuccess(entry.split) || entry.split?.status === 'zero') && !pendingAdditionalCents) { status = 'finish-pending'; statusLabel = entry.finish?.status === 'failed' ? '完结失败待处理' : '待完结分账'; eligibilityReason = entry.finish?.attempts >= 5 ? '完结已失败5次，请选择人工处理并填写核对原因' : '集团分账已确定，仍需完结后确认剩余资金释放'; }
  else if (pendingAdditionalCents > 0 && t.splitTransactions.some(x=>txSuccess(x)||x.status==='zero')) { status='additional-ready'; statusLabel='原服务款新增差额待分账'; eligibilityReason='只办理已知累计目标与成功净收之间的差额，原成功分账及技术号保留'; }
  else if (entry.split?.status === 'failed') { status = 'split-failed'; statusLabel = entry.split.attempts >= 5 ? '分账失败转人工' : '分账失败待重试'; eligibilityReason = entry.split.attempts >= 5 ? '分账已失败5次，请选择人工处理并填写核对原因' : s.now < entry.split.nextRetryAt ? '未到原笔重试时间；提前重试须填写人工核对原因' : '仅对明确失败的原笔重试，金额变化则保留旧笔后新建调整交易'; }
  else if (forced) { status = 'forced-ready'; statusLabel = '强制分账待处理'; }
  else if (facts.blockers.length) { status = 'blocked'; statusLabel = '售后或安全阻断'; eligibilityReason = facts.blockers.join('；'); }
  else if (aftersaleEnded) { status = 'ready'; statusLabel = '可分账'; }
  const channelCommittedCents=sum(t.splitTransactions.filter(txSuccess),x=>x.channelTotalCents??x.amountCents), remainingChannelCapCents=Math.max(0,Math.floor(splitBaseCents*3000/10000)-channelCommittedCents);
  const needsZeroSplit=splitTargetCents===0&&!entry.split&&!t.splitTransactions.length;
  const canManualSplit = Boolean(known && !expired && !successfulFinish && !facts.unknownRefund && !unknownChannel && !totalReturnPendingCents && (pendingAdditionalCents>0&&pendingAdditionalCents<=remainingChannelCapCents||needsZeroSplit) && (forced || (aftersaleEnded && !facts.blockers.length)) && facts.netCents > 0);
  const canSplit = canManualSplit && (!entry.split || ['success','zero'].includes(entry.split.status) || (entry.split.attempts < 5 && (!entry.split.nextRetryAt || s.now >= entry.split.nextRetryAt)));
  const canManualFinish = Boolean(known && !expired && !facts.unknownRefund && !unknownChannel && !pendingAdditionalCents && (t.splitTransactions.some(txSuccess) || entry.split?.status === 'zero') && !successfulFinish && (forced || !facts.blockers.length));
  const canFinish = canManualFinish && (!entry.finish || (entry.finish.attempts < 5 && (!entry.finish.nextRetryAt || s.now >= entry.finish.nextRetryAt)));
  const canReturn = Boolean(known && pendingReturnCents > 0 && !facts.unknownRefund && !unknownChannel && returnFacts.rows.some(x=>x.returnableCents>0&&!x.failedReturn));
  const returns = (entry.returns || []).map(tx => { const src=returnFacts.rows.find(x=>x.splitId===tx.splitId)||(!tx.splitId&&returnFacts.rows.length===1?returnFacts.rows[0]:null);const canManualRetry = Boolean(known && !facts.unknownRefund && !unknownChannel && tx.status === 'failed' && !tx.supersededAt && src && tx.amountCents <= pendingReturnCents && tx.amountCents <= src.remainingCents); return { ...copy(tx), canManualRetry, canRetry: canManualRetry && tx.attempts < 5 && s.now >= tx.nextRetryAt, canQuery: Boolean(serviceFinanceQueryTransaction(s,entry.id,'return',tx.id)) }; });
  return { ...copy(entry), ...facts, ...t, returns, recoveries: copy(t.recoveries), forceAt, alertAt, expiresAt, forced, expired, targetGroupCents, splitTargetCents, storeTargetCents: targetGroupCents == null ? null : facts.netCents - targetGroupCents, pendingReturnCents, pendingOfflineReturnCents, totalReturnPendingCents,
    storeCashCents: facts.netCents - t.splitPaidCents + t.returnedCents + t.externalToStoreCents - t.externalToGroupCents,
    known,originalSourceValid:!sourceReason,platformCents,platformSplitCents,commissionCents:promotion?.known?promotion.commissionCents:promotionBasis?null:0,promotionStoreCents:promotion?.known?promotion.storeCents:promotionBasis?null:0,promotionGroupCents:promotion?.known?promotion.groupCents:promotionBasis?null:0,baseTargetGroupCents:known?promotionBasis?promotion.baseTargetGroupCents:platformCents:null,retainedStoreCommissionCents:promotionBasis?retainedStoreCommissionCents:0,collectibleTargetCents,actualGroupNetCents,pendingAdditionalCents,remainingChannelCapCents,unknownChannel,unknownPersonalTransfer,successfulFinish,promotionSourceToken:commission?.sourceToken||null,returnSources:copy(returnFacts.rows),additionalPath:!known||facts.unknownRefund||unknownChannel?'blocked':!pendingAdditionalCents?'none':successfulFinish?'recovery':canManualSplit?'channel':'blocked',
    status, statusLabel, eligibilityReason: eligibilityReason || (canPayTech ? '' : statusLabel), canSplit, canManualSplit, canFinish, canManualFinish, canReturn, canManualReturn: returns.some(x => x.canManualRetry), canQuerySplit: t.splitTransactions.some(x=>Boolean(serviceFinanceQueryTransaction(s,entry.id,'split',x.id))), canQueryFinish: Boolean(serviceFinanceQueryTransaction(s,entry.id,'finish')), canPayTech,
    alerted: timingKnown && s.now >= alertAt && !canPayTech && !terminalRefunded };
}
export function serviceFinanceSummary(s, bookingOrId, paymentId) {
  const bookingId = typeof bookingOrId === 'string' ? bookingOrId : bookingOrId?.id;
  const entry = (s.serviceFinanceEntries || []).find(x => x.bookingId === bookingId && x.paymentId === paymentId);
  return entry ? projectEntry(s, entry) : null;
}
function recovery(s, entry, type, amountCents, reason, ctx) {
  let item = s.serviceFinanceRecoveries.find(r => r.entryId === entry.id && r.type === type);
  if (!item && amountCents > 0) { item = { id: id(s, ctx, 'SR'), entryId: entry.id, bookingId: entry.bookingId, paymentId: entry.paymentId, storeId: entry.storeId, type, payer: type !== 'unshared-release' ? 'group' : `store:${entry.storeId}`, payee: type !== 'unshared-release' ? `store:${entry.storeId}` : 'group', amountCents, receivedCents: 0, status: 'open', version: 1, records: [], history: [], reason, createdAt: s.now }; s.serviceFinanceRecoveries.push(item); }
  if (item) {
    const target = Math.max(item.receivedCents, amountCents);
    if (item.amountCents !== target) { const before = item.amountCents; item.amountCents = target; item.version++; audit(s, item, '追偿差额更新', { role: 'system' }, ctx, { before, amountCents: target }); }
    item.outstandingCents = item.amountCents - item.receivedCents;
    item.status = [...splitFacts(entry).transactions, entry.finish, ...(entry.returns || [])].some(x => x?.status === 'processing') ? 'channel_pending' : item.outstandingCents ? 'open' : 'closed';
  }
  return item;
}
export function syncServiceFinance(s, ctx) {
  upgradeServiceFinance(s);
  completeNaturalBindings(s, ctx);
  for (const b of s.bookings || []) for (const payment of [b.payment, ...(b.extensions || [])].filter(p => p?.status === 'success')) {
    let entry = s.serviceFinanceEntries.find(x => x.paymentId === payment.id);
    if (!entry) {
      const snapshot = payment === b.payment ? b.serviceFinanceSnapshot : payment.serviceFinanceSnapshot;
      entry = { id: id(s, ctx, 'SF'), bookingId: b.id, paymentId: payment.id, kind: payment === b.payment ? 'main' : 'extension', storeId: b.storeId, userId: b.userId, version: 1, paidAt: Number.isFinite(payment.paidAt) ? payment.paidAt : null,
        sourceSnapshot: copy(snapshot?.source || null), ruleSnapshot: copy(snapshot?.rule || null), snapshotCapturedAt: snapshot?.capturedAt || null,
        split: null, splitHistory: [], finish: null, returns: [], adjustments: [], history: [], createdAt: s.now };
      s.serviceFinanceEntries.push(entry); audit(s, entry, '登记成功支付', { role: 'system' }, ctx, { paidAt: entry.paidAt, amountCents: payment.amountCents });
    }
    let v = projectEntry(s, entry);
    // Loss of source integrity is not an actual money adjustment. Keep the
    // last recorded target as history while the live projection stays unknown.
    const basis = { paidCents: v.paidCents, refundedCents: v.refundedCents, netCents: v.netCents, targetGroupCents: v.originalSourceValid===false&&entry.basis?entry.basis.targetGroupCents:v.targetGroupCents };
    if (!entry.basis) entry.basis = basis;
    else if (signature(entry.basis) !== signature(basis)) { entry.adjustments.push({ at: s.now, reason: '按原规则及累计成功退款重算', before: copy(entry.basis), after: copy(basis) }); entry.basis = basis; entry.version++; audit(s, entry, '成功退款调整', { role: 'system' }, ctx, basis); }
    if (v.alerted && !entry.alertedAt) { entry.alertedAt = s.now; entry.version++; audit(s, entry, '支付满27天，集团财务核对待办', { role: 'system' }, ctx); }
    if (v.expired && !v.unknownChannel && !entry.releaseConfirmedAt) { entry.releaseConfirmedAt = s.now; entry.version++; audit(s, entry, '支付满30天，按Demo冻结期限登记解冻', { role: 'system' }, ctx); }
    v = projectEntry(s, entry);
    if (v.known && !v.unknownChannel && !v.unknownRefund) for(const tx of entry.returns.filter(x=>x.status==='failed'&&!x.supersededAt)){const src=v.returnSources.find(x=>x.splitId===tx.splitId)||(!tx.splitId&&v.returnSources.length===1?v.returnSources[0]:null);if(src&&tx.amountCents>Math.min(v.pendingReturnCents,src.remainingCents)){tx.supersededAt=s.now;tx.supersededReason='成功退款或佣金重算改变应回金额，原明确失败笔不再执行';entry.version++;audit(s,entry,'保留已失效的明确失败回退，办理新差额',{role:'system'},ctx,{transactionNo:tx.requestNo,amountCents:tx.amountCents});}}
    v = projectEntry(s,entry);
    if (v.known && v.pendingReturnCents != null && (entry.returns.some(x => x.status === 'failed'&&!x.supersededAt) || s.serviceFinanceRecoveries.some(r => r.entryId === entry.id && r.type === 'return-failed'))) recovery(s, entry, 'return-failed', v.pendingReturnCents + v.externalChannelReturnCents, '分账回退差额，集团应向服务门店偿还', ctx);
    if (v.known && v.pendingOfflineReturnCents != null) recovery(s, entry, 'offline-adjustment', v.pendingOfflineReturnCents + v.externalRecoveryReturnCents, '已收线下追偿后发生成功退款，集团向门店线下退回多收差额', ctx);
    if (v.known && (v.expired || v.successfulFinish) && !v.unknownChannel && !v.unknownRefund && !v.unknownPersonalTransfer) {
      const item=recovery(s,entry,'unshared-release',Math.max(v.externalToGroupCents,v.collectibleTargetCents-v.splitPaidCents+v.returnedCents+v.externalToStoreCents),v.expired?'冻结到期未足额分账，门店应向集团偿还':'原分账已完结，新增应得由原服务门店偿还',ctx);
      if(item&&!item.releaseFact){item.reasonCode=v.expired?'expired-unshared':'finished-adjustment';item.releaseFact={kind:v.expired?'demo-expired':'successful-finish',at:v.expired?entry.releaseConfirmedAt:entry.finish.completedAt,transactionId:entry.finish?.id||null,requestNo:entry.finish?.requestNo||null};}
    }
  }
  return s;
}
function newTx(s, entry, kind, amountCents, ctx) { const n = id(s, ctx, 'ST'); return { id: n, requestNo: `${kind}-${entry.paymentId}-${n}`, kind, amountCents, status: 'new', attempts: 0, results: [], createdAt: s.now }; }
function applyResult(s, tx, p, query, actor, ctx) {
  if (!RESULT.has(p.outcome)) fail(ctx, '请选择明确的Demo渠道结果');
  if (query ? tx.status !== 'processing' : !['new', 'failed'].includes(tx.status)) fail(ctx, '当前渠道状态不允许此操作；未知须查原笔，成功不重复执行');
  const manual = p.manual === true || p.manual === 'true' || p.manual === 'on';
  if (!query && manual) required(p.reason, '人工渠道处理原因', ctx);
  if (!query && !manual && tx.attempts >= 5) fail(ctx, '同笔已达到5次自动重试上限，请选择人工处理并填写核对原因');
  if (!query && !manual && tx.status === 'failed' && s.now < tx.nextRetryAt) fail(ctx, '尚未到原笔下次重试时间；提前处理须填写人工核对原因');
  if (!query) tx.attempts++;
  tx.status = p.outcome; tx.updatedAt = s.now;
  if (p.outcome === 'success') tx.completedAt = s.now;
  if (p.outcome === 'failed') tx.nextRetryAt = s.now + [1, 5, 30, 120, 720][Math.min(tx.attempts - 1, 4)] * 60000;
  tx.results.push({ at: s.now, outcome: p.outcome, operation: query ? 'query' : 'start', manual: !query && manual, actor: actorInfo(actor), reason: String(p.reason || '') });
}
function captureCashRequest(s, entry, input) {
  const request = captureServiceFinanceComposition(s, entry.id, input);
  assertServiceFinanceCompositionToken(s, entry.id, request.basis.sourceToken);
  return request;
}
function bindCashResult(s, entry, tx) {
  // A legacy request has no per-source allocation; querying it must not invent one.
  if (!tx.cashCompositionRequest || !['split', 'return'].includes(tx.kind) || tx.amountCents <= 0) return;
  const bound = bindServiceFinanceComposition(s, entry.id, tx.cashCompositionRequest, `${tx.kind}:${tx.id}`);
  if (!tx.cashCompositionRequest.source) tx.cashCompositionRequest = bound;
  if (tx.status === 'success') tx.cashComposition = bound;
}
export function serviceFinanceCommand(s, actor, type, p, ctx) {
  upgradeServiceFinance(s);
  if (!writer(actor)) fail(ctx, '仅集团财务或管理员可执行服务资金操作');
  const allowed = ['finance.rule-publish', 'finance.split-start', 'finance.split-query', 'finance.finish-start', 'finance.finish-query', 'finance.return-start', 'finance.return-query', 'finance.recovery-receive'];
  if (!allowed.includes(type)) fail(ctx, '不支持的服务资金命令');
  const requestId = required(p.requestId, '唯一提交标识', ctx), who = signature(actorInfo(actor)), fingerprint = signature({ type, p });
  const previous = s.serviceFinanceRequests.find(x => x.actor === who && x.requestId === requestId);
  if (previous) { if (previous.fingerprint !== fingerprint) fail(ctx, '同一提交标识不能用于不同服务资金内容'); return [...s.serviceFinanceRules, ...s.serviceFinanceEntries, ...s.serviceFinanceRecoveries].find(x => x.id === previous.resultId); }
  const originalQuery=type.endsWith('-query');
  if(originalQuery){
    const kind=type.slice('finance.'.length,-'-query'.length),source=serviceFinanceOriginalSource(s,p.id);
    if(!source||!serviceFinanceQueryTransaction(s,p.id,kind,kind==='split'?p.transactionId:kind==='return'?p.returnId:null))fail(ctx,'请选择编号及范围唯一的未知原渠道请求，缺失或冲突来源须先核对');
    // Check the submitted live version before this command's own synchronizer.
    // A missing basis may update projection history; it cannot trap a valid
    // existing request in a pre-sync version rejection loop.
    checkVersion(source.entry,p,ctx);
  }
  syncServiceFinance(s, ctx);
  let result;
  if (type === 'finance.rule-publish') {
    const scope = p.scope, storeId = ['store', 'store-service'].includes(scope) ? p.storeId : null, serviceId = ['service', 'store-service'].includes(scope) ? p.serviceId : null;
    if (!['global', 'service', 'store', 'store-service'].includes(scope)) fail(ctx, '规则范围无效');
    if (storeId && !s.stores.some(x => x.id === storeId)) fail(ctx, '规则门店不存在');
    if (serviceId && !s.services.some(x => x.id === serviceId)) fail(ctx, '规则项目不存在');
    if (['store', 'store-service'].includes(scope) && !storeId || ['service', 'store-service'].includes(scope) && !serviceId) fail(ctx, '请选择规则门店或项目');
    const groupBps = integer(p.groupBps, '集团客户Demo比例', ctx, 0, 3000), storeBps = integer(p.storeBps, '门店客户Demo比例', ctx, 0, 3000);
    const effectiveAt = timestamp(p.effectiveAt, ctx); if (effectiveAt < s.now) fail(ctx, '新发布规则不能倒签生效，历史订单保留原快照');
    if ((s.bookingRules?.maxDays || 7) + 2 + 10 > 25) fail(ctx, '最远可约天数加售后期及10天重试余量不能超过25天');
    const key = scopeKey({ scope, storeId, serviceId }), version = Math.max(0, ...s.serviceFinanceRules.filter(x => scopeKey(x) === key).map(x => x.version));
    if (Number(p.version) !== version || p.version == null || p.version === '') fail(ctx, '此范围规则版本已更新，请刷新后发布');
    result = { id: id(s, ctx, 'FR'), scope, storeId, serviceId, groupBps, storeBps, effectiveAt, version: version + 1, reason: required(p.reason, '发布说明', ctx), publishedAt: s.now, actor: actorInfo(actor), mode: 'demo', productionApproved: false, history: [] };
    s.serviceFinanceRules.push(result); audit(s, result, '发布本地Demo规则，正式比例待定', actor, ctx, { reason: result.reason });
  } else if (type === 'finance.recovery-receive') {
    result = s.serviceFinanceRecoveries.find(x => x.id === p.id); if (!result) fail(ctx, '服务追偿记录不存在'); checkVersion(result, p, ctx);
    const entry = s.serviceFinanceEntries.find(x => x.id === result.entryId);
    if(!entry)fail(ctx,'追偿缺少原服务资金来源，请先核对');
    const v=projectEntry(s,entry),booking=s.bookings.find(b=>b.id===entry.bookingId),payment=booking&&paymentFor(booking,entry.paymentId),promotionSnapshot=payment===booking?.payment?booking?.servicePromotionSnapshot:payment?.servicePromotionSnapshot;
    if(promotionSnapshot?.promoter&&!['finance','all'].includes(actor.job))fail(ctx,'个人推广关联的原服务资金须由集团财务核验');
    if (v.unknownRefund) fail(ctx, '原支付存在未知退款，请先查询原笔退款后核对追偿');
    if (v.unknownChannel || v.unknownPersonalTransfer) fail(ctx, '原渠道或个人转账结果未知，先查询，不能同时确认线下回款');
    if(!v.known)fail(ctx,'原归属、佣金或资金来源尚未核清，不能按旧差额登记实际回款');
    const amountCents = integer(p.amountCents, '实际回款金额', ctx, 1, result.amountCents - result.receivedCents), reference = required(p.reference, '线下回款凭据号', ctx), reason = required(p.reason, '回款说明', ctx);
    if(s.serviceFinanceRecoveries.some(r=>(r.records||[]).some(x=>x.reference===reference)))fail(ctx,'同一实际资金凭据已登记，不可重复回款');
    let evidenceRefs=null,occurredAt=s.now,splitId=null,splitRequestNo=null;
    if(promotionSnapshot?.promoter){evidenceRefs=p.evidenceRefs??(p.file?[p.file]:null);if(typeof evidenceRefs==='string'){try{evidenceRefs=JSON.parse(evidenceRefs);}catch{fail(ctx,'实际回款附件引用无效');}}if(!Array.isArray(evidenceRefs)||!evidenceRefs.length||ctx.validateEvidenceRefs?.(evidenceRefs)!==true)fail(ctx,'服务推广资金差额实际回款须核验原文件');occurredAt=timestamp(p.occurredAt,ctx);if(occurredAt<result.createdAt||occurredAt>s.now)fail(ctx,'实际回款发生时间须对应原债务且不晚于现在');}
    if(result.type==='return-failed'){const src=p.splitId?v.returnSources.find(x=>x.splitId===p.splitId):v.returnSources.length===1?v.returnSources[0]:null;if(!src||amountCents>src.remainingCents)fail(ctx,'实际代退须选原成功分账，金额不能超过该笔剩余正常份额');if(p.splitRequestNo!=null&&p.splitRequestNo!==src.splitRequestNo)fail(ctx,'实际代退原分账请求号与本源不一致');splitId=src.splitId;splitRequestNo=src.splitRequestNo;}
    const cashRequest=captureCashRequest(s,entry,{kind:'recovery',direction:result.type==='unshared-release'?'income':'return',normalCents:amountCents,incomeSourceId:splitId?`split:${splitId}`:p.incomeSourceId,incomeRequestNo:splitId?splitRequestNo:p.incomeRequestNo});
    const record={ id: id(s, ctx, 'RC'), amountCents, reference, reason, at:s.now,occurredAt,recordedAt:s.now, actor: actorInfo(actor), requestId,...(evidenceRefs?{evidenceRefs:copy(evidenceRefs)}:{}),...(splitId?{splitId,splitRequestNo}:{}),...(result.type==='offline-adjustment'&&p.incomeSourceId?{incomeSourceId:p.incomeSourceId,incomeRequestNo:p.incomeRequestNo??null}:{}) };
    result.records.push(record); result.receivedCents += amountCents; result.outstandingCents = result.amountCents - result.receivedCents; result.status = result.outstandingCents ? 'open' : 'closed'; result.version++; entry.version++;
    record.cashComposition=bindServiceFinanceComposition(s,entry.id,cashRequest,`recovery:${result.id}:${record.id}`);
    audit(s, result, '登记实际线下回款', actor, ctx, { amountCents, reference, reason });
  } else {
    result = s.serviceFinanceEntries.find(x => x.id === p.id); if (!result) fail(ctx, '服务支付资金记录不存在'); if(!originalQuery)checkVersion(result, p, ctx);
    const v = projectEntry(s, result), query = type.endsWith('-query'), manual = p.manual === true || p.manual === 'true' || p.manual === 'on'; let tx;
    if(v.promotionSourceToken&&!['finance','all'].includes(actor.job))fail(ctx,'个人推广关联的原服务资金须由集团财务办理');
    if (type.startsWith('finance.split-')) {
      if (query) { const pending=splitFacts(result).transactions.filter(x=>x.status==='processing');tx=p.transactionId?pending.find(x=>x.id===p.transactionId):pending.length===1?pending[0]:null;if (!v.canQuerySplit||!tx) fail(ctx, '请选择当前或历史的唯一未知原分账查询'); }
      else {
        if (!(manual ? v.canManualSplit : v.canSplit)) fail(ctx, v.eligibilityReason || '当前不能发起分账');
        if (v.splitTargetCents === 0) { result.split = { status: 'zero', amountCents: 0, attempts: 0, reason: '按已锁规则无需向集团分账', at: s.now }; }
        else {
          if (result.split && (['success','zero'].includes(result.split.status) || result.split.status === 'failed' && result.split.amountCents !== v.pendingAdditionalCents)) { result.splitHistory.push({ ...copy(result.split), supersededAt: s.now, reason: result.split.status==='success'?'原成功分账保留，另办理明确新增差额':'当前目标改变，旧明确失败或零额记录保留' }); result.split = null; }
          if(!result.split){const cashRequest=captureCashRequest(s,result,{kind:'split',normalCents:v.pendingAdditionalCents});result.split=newTx(s,result,'split',v.pendingAdditionalCents,ctx);result.split.cashCompositionRequest=cashRequest;result.split.purpose=v.splitPaidCents?'promotion-adjustment':'initial';result.split.basisSnapshot={netCents:v.netCents,heldConfirmedCents:v.heldConfirmedCents,targetGroupCents:v.targetGroupCents,collectibleTargetCents:v.collectibleTargetCents,platformCents:v.platformCents,platformSplitCents:v.platformSplitCents,commissionCents:v.commissionCents,promotionStoreCents:v.promotionStoreCents,promotionSourceToken:v.promotionSourceToken};}
          tx = result.split;
        }
      }
    } else if (type.startsWith('finance.finish-')) {
      if (query) { if (!v.canQueryFinish) fail(ctx, '当前无需查询完结分账'); tx = result.finish; }
      else { if (!(manual ? v.canManualFinish : v.canFinish)) fail(ctx, v.eligibilityReason || '当前不能完结分账'); tx = result.finish ||= newTx(s, result, 'finish', 0, ctx); }
    } else {
      if (p.returnId) {
        tx = result.returns.find(x => x.id === p.returnId); if (!tx) fail(ctx, '原分账回退不存在');
        if (!query && v.unknownRefund) fail(ctx, '原支付存在未知退款，请先查询原笔退款');
        if(p.splitId&&tx.splitId&&p.splitId!==tx.splitId)fail(ctx,'原回退不可改为其他分账来源');
        if(p.splitRequestNo!=null&&p.splitRequestNo!==tx.splitRequestNo)fail(ctx,'原回退不可更改原分账交易号');
        const originalSource=v.returnSources.find(x=>x.splitId===tx.splitId)||(!tx.splitId&&v.returnSources.length===1?v.returnSources[0]:null);
        if(!query&&originalSource?.offlineCents>0&&tx.amountCents>Math.min(originalSource.remainingCents,v.pendingReturnCents))fail(ctx,'原笔已有实际线下回收，不能重复办理同额渠道回退');
        if(!query&&!(manual?v.returns.find(x=>x.id===tx.id)?.canManualRetry:v.returns.find(x=>x.id===tx.id)?.canRetry))fail(ctx,'原回退已失效、来源余额变化或尚未到重试时间，请核对原笔');
      } else {
        if (query || !v.canReturn) fail(ctx, v.eligibilityReason || '当前没有可新建的回退差额');
        const src=p.splitId?v.returnSources.find(x=>x.splitId===p.splitId):v.returnSources.length===1?v.returnSources[0]:null;
        if(p.splitRequestNo!=null&&p.splitRequestNo!==src?.splitRequestNo)fail(ctx,'回退原分账交易号与来源不一致');
        if(!src||!src.splitId||!src.splitRequestNo||src.failedReturn||src.returnableCents<=0)fail(ctx,'请选择有实际剩余正常份额的原成功分账');
        const amountCents=p.amountCents==null?src.returnableCents:integer(p.amountCents,'原笔回退金额',ctx,1,src.returnableCents);
        const cashRequest=captureCashRequest(s,result,{kind:'return',normalCents:amountCents,incomeSourceId:`split:${src.splitId}`,incomeRequestNo:src.splitRequestNo});
        tx = newTx(s, result, 'return', amountCents, ctx);tx.cashCompositionRequest=cashRequest;tx.splitId=src.splitId;tx.splitRequestNo=src.splitRequestNo;tx.receiverId='group';result.returns.push(tx);
      }
    }
    if (tx) { applyResult(s, tx, p, query, actor, ctx); bindCashResult(s, result, tx); }
    result.version++; audit(s, result, type.slice('finance.'.length), actor, ctx, { transactionNo: tx?.requestNo, amountCents: tx?.amountCents, outcome: tx?.status || result.split?.status });
  }
  syncServiceFinance(s, ctx);
  s.serviceFinanceRequests.push({ requestId, actor: who, fingerprint, resultId: result.id, at: s.now });
  return result;
}
export function serviceFinanceView(s, actor) {
  const allowed = writer(actor) || ['store', 'manager'].includes(actor?.role);
  const rows = allowed ? (s.serviceFinanceEntries || []).filter(x => readable(actor, x)).map(x => projectEntry(s, x)) : [];
  const summary = { paidCents: sum(rows, x => x.paidCents || 0), refundedCents: sum(rows, x => x.refundedCents || 0), netCents: sum(rows, x => x.netCents || 0), targetGroupCents: sum(rows, x => x.targetGroupCents || 0), splitPaidCents: sum(rows, x => x.splitPaidCents || 0), returnedCents: sum(rows, x => x.returnedCents || 0), pendingCount: rows.filter(x => !['settled', 'void'].includes(x.status)).length, needsActionCount: rows.filter(x => !['settled', 'void', 'waiting'].includes(x.status)).length, unconfiguredCount: rows.filter(x => x.targetGroupCents == null).length, recoveryOutstandingCents: sum((s.serviceFinanceRecoveries || []).filter(x => allowed && readable(actor, x)), x => Math.max(0, x.amountCents - x.receivedCents)) };
  const entries = actor?.role === 'manager' ? rows.map(({ id, bookingId, paymentId, kind, storeId, paidCents, refundedCents, netCents, status, statusLabel, eligibilityReason }) => ({ id, bookingId, paymentId, kind, storeId, paidCents, refundedCents, netCents, status, statusLabel, eligibilityReason })) : rows;
  const recoveries=actor?.role==='manager'?[]:(s.serviceFinanceRecoveries||[]).filter(x=>allowed&&readable(actor,x)).map(r=>{const entry=(s.serviceFinanceEntries||[]).find(e=>e.id===r.entryId),b=entry&&(s.bookings||[]).find(x=>x.id===entry.bookingId),p=b&&paymentFor(b,entry.paymentId),snapshot=p===b?.payment?b?.servicePromotionSnapshot:p?.servicePromotionSnapshot;return {...copy(r),requiresPromotionEvidence:Boolean(snapshot?.promoter)};});
  return { entries, summary, rules: writer(actor) ? copy(s.serviceFinanceRules || []) : [], recoveries, canExecute: writer(actor), canPublish: writer(actor) };
}
