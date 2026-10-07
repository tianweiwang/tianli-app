// Pure task metadata over the original service ledger. It never repairs sources
// or treats a requested payment, channel unknown or loss as actual settlement.
import { serviceFinanceView } from './service-finance.mjs';
import { assertServiceFinanceExtrasCommand } from './service-finance-extras.mjs';
import { serviceFinanceComposition, serviceFinanceCompositionToken, serviceFinanceCompositionFingerprint } from './service-finance-composition.mjs';
import { serviceFinanceCompositionReview } from './service-finance-composition-review.mjs';

const finance = { role: 'group', job: 'finance' };
const rows = (s, key) => Array.isArray(s[key]) ? s[key] : [];
const id = value => typeof value === 'string' && Boolean(value.trim());
const cents = value => Number.isSafeInteger(value) && value >= 0;
const unique = (list, key) => { const found = list.filter(x => x?.id === key); return id(key) && found.length === 1 ? found[0] : null; };
const sourceParts = source => source && [source.status, source.customerType, source.ownerType, source.ownerStoreId || null, source.promoterId];

function originalSource(s, entry) {
  if (!unique(rows(s, 'serviceFinanceEntries'), entry.id)) return null;
  const booking = unique(rows(s, 'bookings'), entry.bookingId);
  const payment = booking && unique([booking.payment, ...(booking.extensions || [])].filter(Boolean), entry.paymentId);
  if (!booking || !payment || payment.status !== 'success' || entry.storeId !== booking.storeId || !id(entry.storeId)) return null;
  if (entry.userId != null && entry.userId !== booking.userId) return null;
  const main = payment === booking.payment;
  if (entry.kind && entry.kind !== (main ? 'main' : 'extension')) return null;
  const promotion = main ? booking.servicePromotionSnapshot : payment.servicePromotionSnapshot;
  if (!id(promotion?.promoter?.id)) return null; // Never infer personal promotion from a current binding.
  const snapshot = main ? booking.serviceFinanceSnapshot : payment.serviceFinanceSnapshot;
  const promoter = promotion.promoter, original = entry.sourceSnapshot;
  const consistent = Boolean(
    ['group', 'store'].includes(promoter.ownerType) &&
    (promoter.ownerType !== 'store' || id(promoter.ownerStoreId)) &&
    promotion.binding?.promoterId === promoter.id &&
    (!promotion.inheritedFromBookingId || promotion.inheritedFromBookingId === booking.id) &&
    original?.status === 'promotion-pending' && original.promoterId === promoter.id &&
    original.ownerType === promoter.ownerType && (original.ownerStoreId || null) === (promoter.ownerStoreId || null) &&
    JSON.stringify(sourceParts(original)) === JSON.stringify(sourceParts(snapshot?.source))
  );
  return { booking, payment, promoterId: promoter.id, consistent };
}

const transaction = tx => tx && ({
  id: tx.id || null, requestNo: tx.requestNo || null, kind: tx.kind || null,
  status: tx.status, amountCents: tx.amountCents, channelTotalCents: tx.channelTotalCents,
  splitId: tx.splitId || null, splitRequestNo: tx.splitRequestNo || null,
  attempts: tx.attempts, completedAt: tx.completedAt || null, updatedAt: tx.updatedAt || null,
  supersededAt: tx.supersededAt || null
});
function entryToken(s, v, source) {
  return {
    compositionToken: serviceFinanceCompositionFingerprint(serviceFinanceCompositionToken(s,v.id)),
    id: v.id, version: v.version, bookingId: v.bookingId, paymentId: v.paymentId, storeId: v.storeId,
    promoterId: source.promoterId, known: source.consistent && v.known,
    status: v.status, paidAt: v.paidAt, completedAt: source.booking.completedAt || null,
    paidCents: v.paidCents, refundedCents: v.refundedCents, heldConfirmedCents: v.heldConfirmedCents,
    targetGroupCents: v.targetGroupCents, splitPaidCents: v.splitPaidCents, returnedCents: v.returnedCents,
    pendingAdditionalCents: v.pendingAdditionalCents, totalReturnPendingCents: v.totalReturnPendingCents,
    externalToGroupCents: v.externalToGroupCents, externalToStoreCents: v.externalToStoreCents,
    unknownRefund: v.unknownRefund, unknownChannel: v.unknownChannel, unknownPersonalTransfer: v.unknownPersonalTransfer,
    split: transaction(v.split), splitHistory: (v.splitHistory || []).map(transaction),
    finish: transaction(v.finish), returns: (v.returns || []).map(transaction),
    extraPlans: rows(s, 'serviceExtraOffsets').filter(x => x.entryId === v.id).map(x => ({ id: x.id, version: x.version, status: x.status, normalCents: x.normalCents, recoveryCents: x.recoveryCents }))
  };
}
function originalCommand(s, entry, command) {
  try { assertServiceFinanceExtrasCommand(s, finance, command, { id: entry.id }); return true; }
  catch { return false; }
}
function entryCommands(s, v, source) {
  if (!source.consistent) return [];
  const queries = [
    ...(v.canQuerySplit ? ['finance.split-query'] : []),
    ...(v.canQueryFinish ? ['finance.finish-query'] : []),
    ...((v.returns || []).some(x => x.canQuery) ? ['finance.return-query'] : [])
  ];
  if (queries.length) return queries.filter(command => originalCommand(s, v, command));
  if (!v.known || v.unknownRefund || v.unknownPersonalTransfer || v.unknownChannel) return [];
  return [
    ...(v.canSplit || v.canManualSplit ? ['finance.split-start'] : []),
    ...(v.canFinish || v.canManualFinish ? ['finance.finish-start'] : []),
    ...(v.canReturn || v.canManualReturn ? ['finance.return-start'] : [])
  ].filter(command => originalCommand(s, v, command));
}
function task(data, kind, stage, status, commands, token, route, label) {
  return {
    id: `service-promotion-finance:${kind}:${data.id}:${stage}`,
    category: `service-promotion-finance-${kind}`, sourceId: data.id, entryId: kind === 'entry' ? data.id : data.entryId,
    bookingId: data.bookingId, paymentId: data.paymentId, storeId: data.storeId,
    title: kind === 'entry' ? '个人推广关联的原服务分账' : '个人推广关联的原门店资金差额',
    status, sourceStatus: stage, statusLabel: label, createdAt: data.createdAt,
    dueAt: kind === 'entry' ? data.alertAt ?? null : data.dueAt ?? null,
    commands, requiredRoute: 'service-finance', assignmentMode: 'task',
    manageRoles: commands.length ? ['group'] : [], allowedJobs: { group: ['finance'], store: [] },
    routes: { group: route }, sourceToken: JSON.stringify(token)
  };
}
const receipt = row => ({ id: row.id || null, amountCents: row.amountCents, occurredAt: row.occurredAt ?? row.at ?? null, splitId: row.splitId || null, splitRequestNo: row.splitRequestNo || null });
function recoveryFactsValid(s, debt, v) {
  if (!['unshared-release', 'return-failed', 'offline-adjustment'].includes(debt.type) || !cents(debt.amountCents) || !cents(debt.receivedCents) || debt.receivedCents > debt.amountCents) return false;
  if (!Number.isSafeInteger(debt.createdAt) || debt.createdAt < 0 || debt.createdAt > s.now) return false;
  if (debt.payer !== (debt.type === 'unshared-release' ? `store:${v.storeId}` : 'group') || debt.payee !== (debt.type === 'unshared-release' ? 'group' : `store:${v.storeId}`)) return false;
  const records = debt.records || [];
  if (records.some(x => !id(x.id) || !cents(x.amountCents)) || new Set(records.map(x => x.id)).size !== records.length || records.reduce((n, x) => n + x.amountCents, 0) !== debt.receivedCents) return false;
  if (records.some(x => !Number.isSafeInteger(x.occurredAt ?? x.at) || (x.occurredAt ?? x.at) < debt.createdAt || (x.occurredAt ?? x.at) > s.now)) return false;
  if (debt.type === 'unshared-release' && !v.successfulFinish) return false;
  return true;
}

export function servicePromotionSharedTaskRows(s) {
  const projected = serviceFinanceView(s, finance), result = [], entries = new Map();
  for (const v of projected.entries) {
    const source = originalSource(s, v); if (!source) continue;
    entries.set(v.id, { v, source });
    const composition=serviceFinanceComposition(s,v.id),compositionCommands=[];
    if(source.consistent&&!composition.known)for(const key of composition.unresolvedSourceIds){
      const review=serviceFinanceCompositionReview(s,finance,v.id,key);
      if(review.canConfirm)compositionCommands.push('finance.composition-confirm');
      if(review.canReconcile)compositionCommands.push('finance.composition-reconcile');
    }
    const commands = [...new Set([...entryCommands(s, v, source),...compositionCommands.filter(command=>originalCommand(s,v,command))])];
    const done = source.consistent && v.known && composition.known && !v.unknownChannel && !v.unknownRefund && !v.unknownPersonalTransfer && (v.canPayTech || v.status === 'void');
    const stage = !source.consistent ? 'needs-review' : v.status;
    result.push(task(v, 'entry', stage, done ? 'done' : commands.length ? 'open' : 'waiting', commands, entryToken(s, v, source), `/group/service-finance/entry/${v.id}`, !source.consistent ? '原推广资金来源待核对' : !composition.known ? '原现金组成待核对' : v.statusLabel));
  }
  for (const debt of projected.recoveries) {
    const context = entries.get(debt.entryId); if (!context || !unique(rows(s, 'serviceFinanceRecoveries'), debt.id)) continue;
    const { v, source } = context;
    if (debt.bookingId !== v.bookingId || debt.paymentId !== v.paymentId || debt.storeId !== v.storeId) continue;
    const valid = source.consistent && recoveryFactsValid(s, debt, v), unknown = !v.known || v.unknownChannel || v.unknownRefund || v.unknownPersonalTransfer;
    const closed = valid && !unknown && debt.status === 'closed' && debt.amountCents === debt.receivedCents;
    const currentDifference = debt.type === 'unshared-release' ? v.pendingAdditionalCents > 0 : debt.type === 'offline-adjustment' ? v.pendingOfflineReturnCents > 0 : v.pendingReturnCents > 0 && (v.returnSources || []).some(x => x.remainingCents > 0);
    const actionable = valid && !unknown && debt.status === 'open' && debt.amountCents > debt.receivedCents && currentDifference;
    const stage = !valid ? 'needs-review' : unknown ? 'waiting' : closed ? 'closed' : debt.status;
    const commands = actionable ? ['finance.recovery-receive'] : [];
    result.push(task(debt, 'recovery', stage, closed ? 'done' : commands.length ? 'open' : 'waiting', commands, {
      entry: entryToken(s, v, source), id: debt.id, version: debt.version, type: debt.type, status: debt.status,
      amountCents: debt.amountCents, receivedCents: debt.receivedCents,
      releaseFact: debt.releaseFact && { kind: debt.releaseFact.kind, at: debt.releaseFact.at, transactionId: debt.releaseFact.transactionId || null, requestNo: debt.releaseFact.requestNo || null },
      records: (debt.records || []).map(receipt)
    }, '/group/service-finance/recoveries', !valid ? '原门店资金差额来源待核对' : unknown ? '等待原资金结果核定' : closed ? '原资金差额已实际结清' : '待登记原门店资金差额实际收付'));
  }
  return result;
}
