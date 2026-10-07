// Pure scope checks for a closed user's existing rights. Original domain guards still run.
import { resolveAccountActor } from './staff-accounts.mjs';

const fail = message => { throw new Error(message); };
const rows = (s, key) => Array.isArray(s?.[key]) ? s[key] : [];
const idValid = id => typeof id === 'string' && id.trim() === id && Boolean(id);
const currentVersion = row => Number.isSafeInteger(row?.version) && row.version >= 0 ? row.version : null;
const present = (p, key) => p[key] != null && p[key] !== '';
const PROMOTION_KINDS = new Set(['service-promoter', 'service-commission', 'service-withdrawal', 'service-promotion-recovery']);
const cents = n => Number.isSafeInteger(n) && n >= 0;
const canonical = v => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
function promotionRuleBasis(rule) {
  if (rule == null) return null;
  if (typeof rule !== 'object' || Array.isArray(rule)) fail('原个人佣金规则快照待人工核查');
  return Object.fromEntries(['id', 'version', 'firstBps', 'repeatBps', 'storeCostBps', 'csRounding', 'concurrency', 'lateFullRefund'].filter(key => rule[key] != null).map(key => {
    if (!['string', 'number', 'boolean'].includes(typeof rule[key])) fail('原个人佣金规则字段待人工核查');
    return [key, rule[key]];
  }));
}
function promotionBindingBasis(value) {
  if (value == null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) fail('原服务推广绑定快照待人工核查');
  return Object.fromEntries(['status', 'ownerType', 'ownerStoreId', 'promoterId', 'recordedAt', 'expiresAt', 'origin', 'bookingId', 'version'].filter(key => value[key] != null).map(key => {
    if (!['string', 'number', 'boolean'].includes(typeof value[key])) fail('原服务推广绑定字段待人工核查');
    return [key, value[key]];
  }));
}
function unique(list, id, label) {
  if (!idValid(id)) fail(`${label}编号缺失，需人工核查`);
  const found = list.filter(row => row?.id === id);
  if (found.length !== 1) fail(`${label}不存在或编号不唯一，需人工核查`);
  return found[0];
}
function time(value) {
  if (Number.isSafeInteger(value) && value >= 0 && Number.isFinite(new Date(value).getTime())) return value;
  if (typeof value !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!m || +m[2] < 1 || +m[2] > 12 || +m[3] < 1 || +m[3] > new Date(Date.UTC(+m[1], +m[2], 0)).getUTCDate() || +m[4] > 23 || +m[5] > 59 || +m[6] > 59 || (m[7] !== 'Z' && (+m[7].slice(1, 3) > 23 || +m[7].slice(4) > 59))) return null;
  const n = Date.parse(value); return Number.isSafeInteger(n) ? n : null;
}
function userActor(s, input) {
  const actor = resolveAccountActor(s, input);
  if (actor?.role !== 'user' || !idValid(actor.userId)) fail('本人身份缺失或当前会话不属于用户');
  unique(rows(s, 'users'), actor.userId, '本人账户');
  return actor;
}
function closedContext(s, input) {
  const actor = userActor(s, input), profiles = rows(s, 'privacyProfiles').filter(p => p.userId === actor.userId);
  if (profiles.length !== 1 || profiles[0].status !== 'use_closed') fail('本人使用关闭依据缺失或不唯一，需人工核查');
  const closures = rows(s, 'privacyClosures').filter(c => c.userId === actor.userId && c.status === 'use_closed');
  if (closures.length !== 1 || !idValid(closures[0].id)) fail('本人使用关闭回执缺失或冲突，需人工核查');
  const closure = closures[0], closedAt = time(closure.closedAt), now = time(s.now), createdAt = time(closure.createdAt);
  if (closedAt == null || now == null || closedAt > now || (closure.createdAt != null && (createdAt == null || createdAt > closedAt))) fail('使用关闭时间无有效依据，需人工核查');
  const closeRefs = (profiles[0].history || []).filter(h => h.action === '账号使用关闭，历史材料待清理').map(h => h.closureId);
  if (closeRefs.some(id => id !== closure.id)) fail('当前账户与原关闭回执不一致，需人工核查');
  const user = unique(rows(s, 'users'), actor.userId, '本人账户');
  if (user.status != null && user.status !== 'closed') fail('当前账户状态与使用关闭依据冲突，需人工核查');
  const snapshot = closure.rights;
  if (snapshot != null && (snapshot.schemaVersion !== 1 || snapshot.userId !== actor.userId || time(snapshot.capturedAt) !== closedAt || !Array.isArray(snapshot.roots))) fail('原权益快照与关闭依据不一致，需人工核查');
  return { actor, closure, closedAt, snapshot };
}
function rootFor(s, ctx, kind, id) {
  if (!['booking', 'goods'].includes(kind)) fail('原权益来源类型无效');
  const root = unique(rows(s, kind === 'booking' ? 'bookings' : 'goods'), id, '原交易');
  if (root.userId !== ctx.actor.userId) fail('原交易不属于当前本人');
  if (kind === 'booking' && !idValid(root.storeId)) fail('原服务门店编号缺失，需人工核查');
  const createdAt = time(root.createdAt);
  if (createdAt == null || createdAt > ctx.closedAt) fail('原交易创建时间缺失或晚于关闭，需人工核查');
  let captured = null;
  if (ctx.snapshot) {
    const matches = ctx.snapshot.roots.filter(r => r?.kind === kind && r.id === id);
    if (matches.length !== 1 || time(matches[0].createdAt) !== createdAt) fail('原交易不在关闭时的唯一权益快照中，需人工核查');
    captured = matches[0];
  }
  const result={ root, rootKind: kind, rootId: id, captured };
  if(ctx.snapshot){
    const originalPayments=[root.payment,...(kind==='booking'?root.extensions||[]:[])].filter(Boolean);
    const ids=captured.paymentIds;
    if(!Array.isArray(ids)||new Set(ids).size!==ids.length||originalPayments.length!==ids.length)fail('原支付集合与关闭时权益快照不一致，需人工核查');
    for(const payment of originalPayments)payments(result,ctx)(payment.id);
  }
  return result;
}
function promoterIdentity(s, userId, row, closedAt) {
  unique(rows(s, 'servicePromoters'), row?.id, '原个人推广身份');
  if (row.personKind !== 'user' || row.personId !== userId) fail('原个人推广身份不属于当前本人');
  const createdAt = time(row.createdAt);
  if (createdAt == null || createdAt > closedAt) fail('原个人推广身份创建时间缺失或晚于关闭，需人工核查');
  if (!['staff', 'store-promoter', 'group-promoter'].includes(row.promoterType) || !['store', 'group'].includes(row.ownerType)) fail('原个人推广归属类型待人工核查');
  if (row.ownerType === 'store') unique(rows(s, 'stores'), row.ownerStoreId, '原推广所属门店');
  else if (row.ownerStoreId != null) fail('原集团推广身份与门店归属冲突，需人工核查');
  return { id: row.id, personKind: row.personKind, personId: row.personId, promoterType: row.promoterType, ownerType: row.ownerType, ownerStoreId: row.ownerStoreId ?? null, createdAt };
}
function promotionSnapshot(ctx) {
  const v = ctx.snapshot?.servicePromotion;
  if (!v || v.schemaVersion !== 1 || v.userId !== ctx.actor.userId || time(v.capturedAt) !== ctx.closedAt || !['promoters', 'sources', 'commissions', 'withdrawals'].every(k => Array.isArray(v[k]))) fail('关闭时个人服务佣金快照缺失或不一致，需人工核查');
  return v;
}
function promotionRoot(s, ctx, id) {
  const root = unique(rows(s, 'servicePromoters'), id, '原个人推广身份'), identity = promoterIdentity(s, ctx.actor.userId, root, ctx.closedAt);
  const captured = unique(promotionSnapshot(ctx).promoters, id, '关闭时个人推广身份快照');
  if (!same(identity, captured)) fail('原个人推广身份与关闭时权益快照不一致，需人工核查');
  return { root, rootKind: 'service-promotion', rootId: root.id, captured };
}
function originalPromotionSource(s, userId, b, p, closedAt) {
  unique(rows(s, 'bookings'), b?.id, '原佣金预约来源');
  if (!idValid(b.userId) || !idValid(b.storeId)) fail('原佣金预约主体或门店缺失，需人工核查');
  const all = [b.payment, ...(b.extensions || [])].filter(Boolean);
  unique(all, p?.id, '原佣金支付来源');
  const createdAt = time(b.createdAt), paymentAt = p === b.payment && p.createdAt == null ? createdAt : time(p.createdAt);
  if (createdAt == null || createdAt > closedAt || paymentAt == null || paymentAt < createdAt || paymentAt > closedAt) fail('原佣金支付或加时创建时间缺失或晚于关闭，需人工核查');
  const source = b.servicePromotionSnapshot, capturedAt = time(source?.capturedAt);
  if (!source?.promoter || capturedAt == null || capturedAt < createdAt || capturedAt > closedAt) fail('原佣金推广快照时间缺失或晚于关闭，需人工核查');
  const promoter = unique(rows(s, 'servicePromoters'), source.promoter.id, '原佣金推广身份'), identity = promoterIdentity(s, userId, promoter, closedAt);
  const expected = { ...identity }; delete expected.createdAt;
  if (!same(source.promoter, expected) || identity.createdAt > capturedAt) fail('原佣金推广快照与本人原身份不一致，需人工核查');
  const ruleBasis = promotionRuleBasis(source.rule), bindingBasis = promotionBindingBasis(source.binding);
  if (p !== b.payment && (p.servicePromotionSnapshot?.inheritedFromBookingId !== b.id || time(p.servicePromotionSnapshot.capturedAt) !== capturedAt || !same(p.servicePromotionSnapshot.promoter, source.promoter) || !same(promotionRuleBasis(p.servicePromotionSnapshot.rule), ruleBasis) || !same(promotionBindingBasis(p.servicePromotionSnapshot.binding), bindingBasis))) fail('原加时没有继承该预约的唯一推广快照，需人工核查');
  return { bookingId: b.id, paymentId: p.id, bookingCreatedAt: createdAt, paymentCreatedAt: paymentAt, capturedAt, promoterId: promoter.id, personKind: identity.personKind, personId: userId, promoterType: identity.promoterType, ownerType: identity.ownerType, ownerStoreId: identity.ownerStoreId, storeId: b.storeId, customerId: b.userId, ruleBasis, bindingBasis };
}
function commissionIdentity(row, source) {
  return { id: row.id, createdAt: time(row.createdAt), promoterId: source.promoterId, personKey: row.personKey, bookingId: source.bookingId, paymentId: source.paymentId, customerId: source.customerId, storeId: source.storeId };
}
function promotionCommission(s, ctx, id) {
  const row = unique(rows(s, 'serviceCommissions'), id, '原个人服务佣金'), result = promotionRoot(s, ctx, row.promoterId);
  if (row.personKey !== `user:${ctx.actor.userId}`) fail('原服务佣金不属于当前本人');
  const b = unique(rows(s, 'bookings'), row.bookingId, '原佣金预约来源'), p = unique([b.payment, ...(b.extensions || [])].filter(Boolean), row.paymentId, '原佣金支付来源');
  const source = originalPromotionSource(s, ctx.actor.userId, b, p, ctx.closedAt);
  const captured = promotionSnapshot(ctx).sources.filter(x => x.bookingId === b.id && x.paymentId === p.id);
  if (captured.length !== 1 || !same(source, captured[0])) fail('原佣金付款不在关闭时唯一来源快照中，需人工核查');
  if (rows(s, 'serviceCommissions').filter(c => c.bookingId === b.id && c.paymentId === p.id).length !== 1 || row.userId !== b.userId || row.storeId !== b.storeId || row.promoterId !== source.promoterId || !same(row.sourceSnapshot?.promoter, b.servicePromotionSnapshot.promoter) || !same(promotionRuleBasis(row.sourceSnapshot?.rule), source.ruleBasis) || !same(promotionBindingBasis(row.sourceSnapshot?.binding), source.bindingBasis) || time(row.sourceSnapshot?.capturedAt) !== source.capturedAt) fail('原个人佣金与实际唯一付款来源不一致，需人工核查');
  const at = time(row.createdAt);
  if (at == null || at < source.paymentCreatedAt || at > time(s.now)) fail('原服务佣金核定创建时间待人工核查');
  const identity = commissionIdentity(row, source), capturedRows = promotionSnapshot(ctx).commissions.filter(c => c.id === row.id);
  if (!ctx.capturing && (capturedRows.length > 1 || capturedRows.length === 1 && !same(identity, capturedRows[0]) || capturedRows.length === 0 && at <= ctx.closedAt)) fail('原佣金编号与关闭时付款映射不一致，需人工核查');
  if (row.known === true && (!cents(row.commissionCents) || !cents(row.storeCents) || !cents(row.groupCents) || row.storeCents + row.groupCents !== row.commissionCents)) fail('原个人佣金金额组成待人工核查');
  return { ...result, row, source, commissionIdentity: identity };
}
function withdrawalFacts(s, ctx, row) {
  unique(rows(s, 'servicePromotionWithdrawals'), row?.id, '原个人服务提现');
  const result = promotionRoot(s, ctx, row.promoterId), identity = result.captured, at = time(row.createdAt);
  if (at == null || at < identity.createdAt || at > ctx.closedAt) fail('原提现创建时间缺失或晚于关闭，需人工核查');
  if (row.personKind !== 'user' || row.personId !== ctx.actor.userId || row.personKey !== `user:${ctx.actor.userId}` || row.ownerType !== identity.ownerType || (row.ownerStoreId ?? null) !== identity.ownerStoreId) fail('原提现本人或原承担方与推广身份不一致，需人工核查');
  if (!cents(row.amountCents) || row.amountCents === 0 || !Array.isArray(row.allocations) || !row.allocations.length) fail('原提现金额或分配明细待人工核查');
  const seen = new Set(), allocations = row.allocations.map(a => {
    if (!a || seen.has(a.commissionId)) fail('原提现佣金明细重复或缺失，需人工核查');
    seen.add(a.commissionId); const c = promotionCommission(s, ctx, a.commissionId);
    if (time(c.row.createdAt) > at) fail('原提现明细引用了申请之后才创建的佣金，需人工核查');
    if (!cents(a.amountCents) || !a.amountCents || !cents(a.storeCents) || !cents(a.groupCents) || a.storeCents + a.groupCents !== a.amountCents || !idValid(a.sourceToken) || !Number.isSafeInteger(a.sourceVersion) || a.sourceVersion < 0) fail('原提现申请的金额组成或原版本待人工核查');
    return { commissionId: a.commissionId, amountCents: a.amountCents, storeCents: a.storeCents, groupCents: a.groupCents, sourceToken: a.sourceToken, sourceVersion: a.sourceVersion, commissionSource: c.commissionIdentity };
  });
  const total = allocations.reduce((n, a) => n + a.amountCents, 0);
  if (!Number.isSafeInteger(total) || total !== row.amountCents) fail('原提现明细与申请金额不守恒，需人工核查');
  return { id: row.id, createdAt: at, promoterId: row.promoterId, personKind: row.personKind, personId: row.personId, personKey: row.personKey, ownerType: row.ownerType, ownerStoreId: row.ownerStoreId ?? null, amountCents: row.amountCents, allocations };
}
function promotionResource(s, ctx, kind, id) {
  if (kind === 'service-promoter') return { ...promotionRoot(s, ctx, id), row: null };
  if (kind === 'service-commission') return promotionCommission(s, ctx, id);
  if (kind === 'service-withdrawal') {
    const row = unique(rows(s, 'servicePromotionWithdrawals'), id, '原个人服务提现'), actual = withdrawalFacts(s, ctx, row);
    const captured = unique(promotionSnapshot(ctx).withdrawals, id, '关闭时原提现快照');
    if (!same(actual, captured)) fail('原提现与关闭时不可变申请快照不一致，需人工核查');
    return { ...promotionRoot(s, ctx, row.promoterId), row };
  }
  const row = unique(rows(s, 'servicePromotionRecoveries'), id, '原个人佣金追收'), c = promotionCommission(s, ctx, row.commissionId);
  if (row.personKey !== c.row.personKey || row.promoterId !== c.rootId || row.bookingId !== c.source.bookingId || row.paymentId !== c.source.paymentId || row.storeId !== c.source.storeId) fail('原个人追收与原佣金来源串号，需人工核查');
  const at = time(row.createdAt);
  if (at == null || at < time(c.row.createdAt) || at > time(s.now)) fail('原个人佣金追收创建时间待人工核查');
  for (const key of ['amountCents', 'receivedCents', 'outstandingCents', 'returnPendingCents']) if (!cents(row[key])) fail('原个人佣金追收金额待人工核查');
  return { ...c, row };
}
function capturePromotionRights(s, userId, at, manualReview) {
  const snapshot = { schemaVersion: 1, userId, capturedAt: at, promoters: [], sources: [], commissions: [], withdrawals: [] };
  const ctx = { actor: { role: 'user', userId }, closedAt: at, snapshot: { servicePromotion: snapshot }, capturing: true };
  const attempt = (kind, row, collect) => { try { collect(); } catch (error) { manualReview.push({ kind, id: idValid(row?.id) ? row.id : null, reason: error.message }); } };
  for (const r of rows(s, 'servicePromoters').filter(r => r.personKind === 'user' && r.personId === userId)) attempt('service-promoter', r, () => snapshot.promoters.push(promoterIdentity(s, userId, r, at)));
  for (const b of rows(s, 'bookings').filter(b => b.servicePromotionSnapshot?.promoter?.personKind === 'user' && b.servicePromotionSnapshot.promoter.personId === userId)) {
    for (const p of [b.payment, ...(b.extensions || [])].filter(Boolean)) attempt('service-commission-source', p, () => {
      const source = originalPromotionSource(s, userId, b, p, at); promotionRoot(s, ctx, source.promoterId); snapshot.sources.push(source);
    });
  }
  for (const row of rows(s, 'serviceCommissions').filter(c => c.personKey === `user:${userId}`)) attempt('service-commission', row, () => snapshot.commissions.push(promotionCommission(s, ctx, row.id).commissionIdentity));
  for (const row of rows(s, 'servicePromotionWithdrawals').filter(w => w.personKey === `user:${userId}` || w.personKind === 'user' && w.personId === userId)) attempt('service-withdrawal', row, () => snapshot.withdrawals.push(withdrawalFacts(s, ctx, row)));
  return snapshot;
}
function nestedUnique(s, container, field, id, label) {
  const matches = rows(s, container).flatMap(parent => (Array.isArray(parent[field]) ? parent[field] : []).filter(row => row?.id === id).map(row => ({ parent, row })));
  if (!idValid(id) || matches.length !== 1) fail(`${label}不存在或编号不唯一，需人工核查`);
  return matches[0];
}
function checkOwnedChild(ctx, child, root, { requireUser = true, requireStore = false } = {}) {
  if ((requireUser || child.userId != null) && child.userId !== ctx.actor.userId) fail('派生事项与原交易本人不一致，需人工核查');
  if ((requireStore || child.storeId != null) && child.storeId !== root.storeId) fail('派生事项与原服务门店不一致，需人工核查');
}
function careSource(s, row, root) {
  if (!row.source || !idValid(row.source.id)) fail('原反馈来源缺失，需人工核查');
  const { kind, id } = row.source;
  if (kind === 'booking') { if (id !== root.id) fail('原反馈来源与预约串号，需人工核查'); return; }
  const list = kind === 'refund' ? root.refunds || [] : kind === 'dispute' ? root.disputes || [] : kind === 'safety' ? rows(s, 'safety') : kind === 'review' ? rows(s, 'serviceReviews') : kind === 'followup' ? rows(s, 'serviceCareFollowups') : null;
  if (!list) fail('原反馈来源类型不明确，需人工核查');
  const source = unique(list, id, '原反馈关联事项');
  if (!['refund', 'dispute'].includes(kind) && (source.bookingId !== root.id || (source.userId != null && source.userId !== root.userId))) fail('原反馈关联事项与预约串号，需人工核查');
}
function invoiceChain(s, ctx, list, invoice, root, kind) {
  const seen = new Set();
  const validate = item => {
    checkOwnedChild(ctx, item, root, { requireStore: kind === 'booking' });
    if ((kind === 'booking' ? item.bookingId !== root.id : item.category !== 'goods' || item.orderId !== root.id)) fail('原票据链与本人交易不一致，需人工核查');
    unique(list, item.id, '原票据');
  };
  let anchor = invoice; validate(anchor);
  while (anchor.replacesId) {
    if (seen.has(anchor.id)) fail('原票据链存在循环，需人工核查');
    seen.add(anchor.id);
    const prior = unique(list, anchor.replacesId, '原票据'); validate(prior);
    if (prior.replacedById !== anchor.id) fail('原票据重开关系不完整，需人工核查');
    anchor = prior;
  }
  const appliedAt = time(anchor.createdAt);
  if (appliedAt == null || appliedAt > ctx.closedAt || appliedAt < time(root.createdAt)) fail('首次原票申请时间缺失或晚于关闭，需人工核查');
  // Validate both directions, including viewing an old replaced ticket.
  seen.clear(); let current = anchor;
  while (current) {
    if (seen.has(current.id)) fail('原票据链存在循环，需人工核查');
    seen.add(current.id); validate(current);
    if (!current.replacedById) break;
    const next = unique(list, current.replacedById, '原票据');
    if (next.replacesId !== current.id) fail('原票据重开关系不完整，需人工核查');
    current = next;
  }
  if (!seen.has(invoice.id)) fail('当前票据不属于原申请链，需人工核查');
}
function shortageSource(s, ctx, issue, root) {
  checkOwnedChild(ctx, issue, root, { requireStore: true });
  const refund = unique(root.refunds || [], issue.refundId, '原退款');
  const payment = unique([root.payment, ...(root.extensions || [])].filter(Boolean), issue.paymentId, '原支付');
  const parts = (refund.executions || []).filter(part => part.paymentId === payment.id && part.refundNo === issue.refundNo);
  if (!idValid(issue.refundNo) || parts.length !== 1) fail('直接款事项缺少对应的唯一原退款执行来源，需人工核查');
}
function resource(s, ctx, kind, id) {
  if (PROMOTION_KINDS.has(kind)) return promotionResource(s, ctx, kind, id);
  let row, found, result;
  if (kind === 'booking' || kind === 'goods') return { ...rootFor(s, ctx, kind, id), row: null };
  if (kind === 'booking-refund') {
    found = nestedUnique(s, 'bookings', 'refunds', id, '原退款'); result = rootFor(s, ctx, 'booking', found.parent.id); row = found.row;
    checkOwnedChild(ctx, row, result.root, { requireUser: false });
    for (const part of [...(row.requests || []), ...(row.lines || []), ...(row.executions || [])]) payments(result, ctx)(part?.paymentId);
  } else if (kind === 'goods-case' || kind === 'goods-incident') {
    found = nestedUnique(s, 'goods', kind === 'goods-case' ? 'cases' : 'incidents', id, '原商品事项'); result = rootFor(s, ctx, 'goods', found.parent.id); row = found.row; checkOwnedChild(ctx, row, result.root, { requireUser: false });
    if (kind === 'goods-incident') for (const caseId of [row.caseId, row.proposal?.caseId].filter(Boolean)) unique(result.root.cases || [], caseId, '异常关联售后');
  } else if (kind === 'care-case') {
    row = unique(rows(s, 'serviceCareCases'), id, '原反馈'); result = rootFor(s, ctx, 'booking', row.bookingId); checkOwnedChild(ctx, row, result.root, { requireStore: true }); careSource(s, row, result.root);
  } else if (kind === 'service-invoice' || kind === 'goods-invoice') {
    const list = rows(s, kind === 'service-invoice' ? 'serviceInvoices' : 'commerceInvoices'); row = unique(list, id, '原票据');
    result = rootFor(s, ctx, kind === 'service-invoice' ? 'booking' : 'goods', kind === 'service-invoice' ? row.bookingId : row.orderId);
    invoiceChain(s, ctx, list, row, result.root, result.rootKind);
  } else if (kind === 'service-shortage' || kind === 'service-advance') {
    if (kind === 'service-advance') { found = nestedUnique(s, 'serviceRefundShortages', 'advances', id, '原直接款方案'); unique(rows(s, 'serviceRefundShortages'), found.parent.id, '原退款不足事项'); row = found.row; if (row.path !== 'direct-user') fail('该方案不属于本人直接退款权益'); result = rootFor(s, ctx, 'booking', found.parent.bookingId); shortageSource(s, ctx, found.parent, result.root); }
    else { row = unique(rows(s, 'serviceRefundShortages'), id, '原退款不足事项'); if (!(row.advances || []).some(a => a.path === 'direct-user')) fail('该内部资金事项没有本人直接退款方案'); result = rootFor(s, ctx, 'booking', row.bookingId); shortageSource(s, ctx, row, result.root); }
    payments(result, ctx)((found?.parent || row).paymentId);
  } else fail('原权益事项类型无效');
  return { ...result, row, ...(found?.parent ? { parent: found.parent } : {}) };
}
function binding(ctx, result, kind, id) {
  return { closureId: ctx.closure.id, closedAt: ctx.closedAt, userId: ctx.actor.userId, rootKind: result.rootKind, rootId: result.rootId, storeId: result.rootKind === 'booking' ? result.root.storeId ?? null : null, kind, id, sourceVersion: currentVersion(result.row || result.root), rootVersion: currentVersion(result.root), basis: ctx.snapshot ? 'closure-snapshot' : 'original-created-at', ...(result.rootKind === 'service-promotion' ? { promoterId: result.rootId, personKey: `user:${ctx.actor.userId}` } : {}) };
}
export function closedRightsBinding(s, actor, kind, id) {
  const ctx = closedContext(s, actor); return binding(ctx, resource(s, ctx, kind, id), kind, id);
}

export function captureClosedRights(s, userId, closedAt = s.now) {
  unique(rows(s, 'users'), userId, '本人账户');
  const at = time(closedAt), now = time(s.now);
  if (at == null || now == null || at !== now) fail('关闭快照只能在当前正常关闭事务内采集，不能回填旧回执');
  const out = { schemaVersion: 1, userId, capturedAt: at, roots: [], manualReview: [] };
  for (const kind of ['booking', 'goods']) for (const root of rows(s, kind === 'booking' ? 'bookings' : 'goods').filter(r => r.userId === userId)) {
    const createdAt = time(root.createdAt);
    if (!idValid(root.id) || createdAt == null || createdAt > at || rows(s, kind === 'booking' ? 'bookings' : 'goods').filter(r => r.id === root.id).length !== 1) { out.manualReview.push({ kind, id: idValid(root.id) ? root.id : null, reason: '本人交易编号或原创建时间待核查' }); continue; }
    const allPayments = [root.payment, ...(kind === 'booking' ? root.extensions || [] : [])].filter(Boolean);
    const paymentIds = allPayments.map(p => p.id);
    if (paymentIds.some(id => !idValid(id)) || new Set(paymentIds).size !== paymentIds.length) { out.manualReview.push({ kind, id: root.id, reason: '原支付及加时编号待核查' }); continue; }
    const verifiedIds = allPayments.filter(p => {
      const created = time(p.createdAt), extension = kind === 'booking' && p !== root.payment;
      if ((extension || p.createdAt != null) && (created == null || created > at)) { out.manualReview.push({ kind: extension ? 'booking-extension' : 'payment', id: p.id, rootId: root.id, reason: '原支付或加时创建时间待核查' }); return false; }
      return true;
    }).map(p => p.id);
    out.roots.push({ kind, id: root.id, createdAt, sourceVersion: currentVersion(root), status: typeof root.status === 'string' ? root.status : null, paymentIds: verifiedIds, extensionIds: kind === 'booking' ? (root.extensions || []).filter(x => verifiedIds.includes(x.id)).map(x => x.id) : [] });
  }
  out.servicePromotion = capturePromotionRights(s, userId, at, out.manualReview);
  return out;
}

const SCOPE = Object.freeze({
  'booking.refund-request': 'booking', 'booking.refund-answer': 'booking-refund',
  'booking.assistance-request': 'booking', 'booking.help': 'booking',
  'care.case-create': 'booking', 'care.case-statement': 'care-case', 'care.case-answer': 'care-case',
  'goods.case': 'goods', 'goods.receive': 'goods', 'goods.appeal': 'goods-case', 'goods.return': 'goods-case',
  'goods.return-back-accept': 'goods-case', 'goods.return-back-receive': 'goods-case', 'goods.case-withdraw': 'goods-case',
  'goods.partial-confirm': 'goods-case', 'goods.incident-confirm': 'goods-incident', 'goods.incident-receipt': 'goods-incident',
  'invoice.resubmit': 'service-invoice', 'invoice.reapply': 'service-invoice',
  'commerce-invoice.resubmit': 'goods-invoice', 'commerce-invoice.reapply': 'goods-invoice',
  'service-extra.advance-confirm': 'service-advance',
  'service-promotion.withdraw-confirm': 'service-withdrawal', 'service-promotion.withdraw-cancel': 'service-withdrawal'
});
export const CLOSED_RIGHTS_COMMANDS = Object.freeze(Object.keys(SCOPE));
function payments(result, ctx) {
  const list = [result.root.payment, ...(result.rootKind === 'booking' ? result.root.extensions || [] : [])].filter(Boolean);
  return id => {
    const p = unique(list, id, '原支付');
    if (ctx.snapshot && (!Array.isArray(result.captured.paymentIds) || result.captured.paymentIds.filter(v => v === id).length !== 1)) fail('该笔支付不在关闭时的原权益快照中，需人工核查');
    if ((p !== result.root.payment || p.createdAt != null) && (time(p.createdAt) == null || time(p.createdAt) > ctx.closedAt)) fail('支付或加时创建时间缺失或晚于关闭，需人工核查');
    return p;
  };
}
function decision(p, allowed) { if (!allowed.includes(p.decision)) fail('关闭后的原权益选择无效'); }
function assertPayloadSources(s, ctx, result, kind, p) {
  const root = result.root;
  if (present(p, 'userId') && p.userId !== ctx.actor.userId) fail('提交本人身份与原权益不一致');
  if (present(p, 'bookingId') && (result.rootKind !== 'booking' || p.bookingId !== root.id)) fail('提交预约与原权益串号');
  if (present(p, 'orderId') && (result.rootKind !== 'goods' || p.orderId !== root.id)) fail('提交商品订单与原权益串号');
  if (present(p, 'storeId') && (result.rootKind !== 'booking' || p.storeId !== root.storeId)) fail('提交门店与原权益不一致');
  if (present(p, 'paymentId')) payments(result, ctx)(p.paymentId);
  if (present(p, 'refundId')) {
    if (result.rootKind !== 'booking') fail('提交退款与原权益串号');
    const r = unique(root.refunds || [], p.refundId, '原退款');
    if (kind === 'booking-refund' && r.id !== result.row.id || ['service-shortage', 'service-advance'].includes(kind) && r.id !== (result.parent || result.row).refundId) fail('提交退款与原权益串号');
  }
  if (present(p, 'caseId')) {
    if (result.rootKind !== 'goods') fail('提交售后与原权益串号');
    const c = unique(root.cases || [], p.caseId, '原售后');
    if (kind === 'goods-case' && c.id !== result.row.id || kind === 'goods-incident' && result.row.proposal?.caseId && c.id !== result.row.proposal.caseId) fail('提交售后与原权益串号');
  }
  if (present(p, 'incidentId')) {
    if (result.rootKind !== 'goods') fail('提交异常与原权益串号');
    const i = unique(root.incidents || [], p.incidentId, '原异常');
    if (kind === 'goods-incident' && i.id !== result.row.id) fail('提交异常与原权益串号');
  }
  if (present(p, 'advanceId') && (kind !== 'service-advance' || p.advanceId !== result.row.id)) fail('提交直接款方案与原权益串号');
  if (present(p, 'skuId')) { if (result.rootKind !== 'goods' || !(root.lines || []).some(l => l.skuId === p.skuId)) fail('提交商品规格与原权益串号'); }
  if (present(p, 'sourceKind') || present(p, 'sourceId')) {
    if (p.sourceKind && p.sourceKind !== 'booking' || result.rootKind !== 'booking' || p.sourceId && p.sourceId !== root.id) fail('提交反馈来源与原预约串号');
  }
}
function assertPromotionPayload(ctx, result, p) {
  const row = result.row;
  for (const key of ['userId', 'promoterId', 'personKind', 'personId', 'personKey', 'ownerType', 'ownerStoreId', 'amountCents']) {
    const expected = key === 'userId' ? ctx.actor.userId : row[key];
    if (present(p, key) && p[key] !== expected) fail('提交提现本人、原身份或原金额与既有权益不一致');
  }
  if (present(p, 'allocations') && !same(p.allocations, row.allocations)) fail('提交提现明细与原申请串号');
  for (const key of ['bookingId', 'orderId', 'paymentId', 'storeId', 'refundId', 'caseId', 'incidentId', 'advanceId', 'commissionId', 'sourceKind', 'sourceId', 'skuId', 'file', 'evidenceRefs']) if (present(p, key)) fail('原提现确认不能提交其他来源或内部证明');
}
function assertRightsScope(s, input, type, p = {}, draft = false) {
  const actor = resolveAccountActor(s, input);
  if (actor?.role !== 'user') { if (input?.role === 'user') fail('当前会话不属于本人用户'); return null; }
  userActor(s, actor);
  const profiles = rows(s, 'privacyProfiles').filter(row => row.userId === actor.userId);
  if (!profiles.some(row => row.status === 'use_closed')) return null;
  const ctx = closedContext(s, actor), kind = SCOPE[type];
  if (!kind) fail('账号使用已关闭，该操作不属于本人既有权益');
  if (!p || typeof p !== 'object' || Array.isArray(p)) fail('原权益提交内容无效');
  const decisionFilled = !draft || p.decision != null && p.decision !== '';
  const id = kind === 'booking-refund' ? p.refundId : kind === 'goods-case' ? p.caseId : kind === 'goods-incident' ? p.incidentId : kind === 'service-advance' ? p.advanceId : type === 'care.case-create' ? p.bookingId : p.id;
  const result = resource(s, ctx, kind, id);
  if (kind === 'service-withdrawal') {
    assertPromotionPayload(ctx, result, p);
    if (type === 'service-promotion.withdraw-confirm' && decisionFilled) decision(p, ['accept', 'reject']);
    return binding(ctx, result, kind, id);
  }
  if (['booking-refund', 'goods-case', 'goods-incident'].includes(kind) && p.id !== result.rootId || kind === 'service-advance' && p.id !== result.parent.id) fail('提交事项与原交易串号');
  assertPayloadSources(s, ctx, result, kind, p);
  if (['booking.refund-answer', 'care.case-answer'].includes(type) && decisionFilled) decision(p, ['accept', 'escalate', 'withdraw']);
  if (['goods.partial-confirm', 'goods.incident-confirm'].includes(type) && decisionFilled) decision(p, ['accept', 'approve', 'agree', 'reject']);
  if (type === 'service-extra.advance-confirm') {
    if(decisionFilled)decision(p, ['accept', 'reject']);
    if (result.row.path !== 'direct-user') fail('该方案不属于本人直接退款权益');
    payments(result, ctx)(result.parent.paymentId);
    if (present(p, 'paymentId') && p.paymentId !== result.parent.paymentId || present(p, 'refundNo') && p.refundNo !== result.parent.refundNo) fail('直接款原支付或退款执行来源串号');
  }
  if (type === 'care.case-create') {
    if (present(p, 'id')) fail('新反馈应从原预约提交，不能串入其他事项编号');
    if (p.claim && p.claim !== 'feedback' || p.requests && (!Array.isArray(p.requests) || p.requests.length) || Number(p.amountCents || 0) !== 0) fail('原质量反馈不能变为新退款或内部事项');
  }
  if (type === 'goods.case' && !['cancel', 'return', 'refund'].includes(p.kind)) fail('原商品售后类型无效');
  if (type === 'booking.refund-request') {
    let requests = draft && p.requests == null ? [] : p.requests;
    if (typeof requests === 'string') { try { requests = JSON.parse(requests); } catch { fail('原退款分笔来源格式无效'); } }
    if (!Array.isArray(requests) || !draft && !requests.length) fail('原退款缺少分笔支付来源');
    const seen = new Set();
    for (const line of requests) { if (!line || seen.has(line.paymentId)) fail('原退款分笔支付来源缺失或重复'); payments(result, ctx)(line.paymentId); seen.add(line.paymentId); }
  }
  return binding(ctx, result, kind, id);
}

// A draft keeps incomplete inputs but must still belong to an original source.
// The dispatcher uses the complete command guard, never this draft-only export.
export function assertClosedRightsDraft(s, input, type, p = {}) {
  return assertRightsScope(s, input, type, p, true);
}
export function assertClosedRightsCommand(s, input, type, p = {}) {
  return assertRightsScope(s, input, type, p, false);
}

const PATHS = {
  booking: row => `/user/booking/${encodeURIComponent(row.id)}`, goods: row => `/user/goods/${encodeURIComponent(row.id)}`,
  'booking-refund': (row, root) => `/user/booking/${encodeURIComponent(root.id)}`,
  'goods-case': (row, root) => `/user/goods/${encodeURIComponent(root.id)}`, 'goods-incident': (row, root) => `/user/goods/${encodeURIComponent(root.id)}`,
  'care-case': row => `/user/care/case/${encodeURIComponent(row.id)}`,
  'service-invoice': row => `/user/invoices/${encodeURIComponent(row.id)}`, 'goods-invoice': row => `/user/commodity-invoices/${encodeURIComponent(row.id)}`,
  'service-shortage': (row, root) => `/user/booking/${encodeURIComponent(root.id)}`, 'service-advance': (row, root) => `/user/booking/${encodeURIComponent(root.id)}`,
  'service-promoter': row => `/user/service-promotion/promoters/${encodeURIComponent(row.id)}`,
  'service-commission': row => `/user/service-promotion/commissions/${encodeURIComponent(row.id)}`,
  'service-withdrawal': row => `/user/service-promotion/withdrawals/${encodeURIComponent(row.id)}`,
  'service-promotion-recovery': row => `/user/service-promotion/recoveries/${encodeURIComponent(row.id)}`
};
function financialProjection(kind, row) {
  if (kind === 'service-commission') return { financial: { known: row.known === true, commissionCents: row.known === true ? row.commissionCents : null, financialReady: row.known === true && row.financialReady === true } };
  if (kind === 'service-withdrawal') return { financial: { amountCents: row.amountCents, confirmExpiresAt: time(row.confirmExpiresAt), execution: row.execution ? { status: typeof row.execution.status === 'string' ? row.execution.status : null, completedAt: time(row.execution.completedAt) } : null } };
  if (kind === 'service-promotion-recovery') {
    const known = row.status !== 'needs-review';
    return { financial: { amountCents: known ? row.amountCents : null, receivedCents: row.receivedCents, outstandingCents: known ? row.outstandingCents : null, returnPendingCents: known ? row.returnPendingCents : null, known } };
  }
  return {};
}
export function closedRightsView(s, input) {
  let actor;
  try { actor = userActor(s, input); } catch { return null; }
  if (!rows(s, 'privacyProfiles').some(p => p.userId === actor.userId && p.status === 'use_closed')) return null;
  let ctx;
  try { ctx = closedContext(s, actor); } catch (error) { return { closureId: null, closedAt: null, items: [], manualReview: [{ kind: 'closure', id: null, reason: error.message }] }; }
  const out = { closureId: ctx.closure.id, closedAt: ctx.closedAt, items: [], manualReview: [] }, visited = new Set();
  const add = (kind, row) => {
    const key = `${kind}:${row?.id}`;
    if (visited.has(key)) return; visited.add(key);
    try {
      const result = resource(s, ctx, kind, row?.id), actual = result.row || result.root;
      out.items.push({ ...binding(ctx, result, kind, actual.id), status: typeof actual.status === 'string' ? actual.status : null, path: PATHS[kind](actual, result.root), candidateCommands: Object.keys(SCOPE).filter(command => SCOPE[command] === kind), requiresOriginalGuard: true, ...financialProjection(kind, actual) });
    } catch (error) { out.manualReview.push({ kind, id: idValid(row?.id) ? row.id : null, reason: error.message }); }
  };
  for (const b of rows(s, 'bookings').filter(b => b.userId === actor.userId)) { add('booking', b); for (const r of b.refunds || []) add('booking-refund', r); }
  for (const o of rows(s, 'goods').filter(o => o.userId === actor.userId)) { add('goods', o); for (const c of o.cases || []) add('goods-case', c); for (const i of o.incidents || []) add('goods-incident', i); }
  for (const [key, kind] of [['serviceCareCases', 'care-case'], ['serviceInvoices', 'service-invoice'], ['commerceInvoices', 'goods-invoice'], ['serviceRefundShortages', 'service-shortage']]) {
    for (const r of rows(s, key).filter(r => r.userId === actor.userId && (kind !== 'goods-invoice' || r.category === 'goods') && (kind !== 'service-shortage' || (r.advances || []).some(a => a.path === 'direct-user')))) {
      add(kind, r); if (kind === 'service-shortage') for (const a of r.advances || []) if (a.path === 'direct-user') add('service-advance', a);
    }
  }
  const ownPerson = row => row?.personKey === `user:${actor.userId}` || row?.personKind === 'user' && row.personId === actor.userId || rows(s, 'servicePromoters').some(p => p.id === row?.promoterId && p.personKind === 'user' && p.personId === actor.userId);
  for (const [key, kind] of [['serviceCommissions', 'service-commission'], ['servicePromotionWithdrawals', 'service-withdrawal'], ['servicePromotionRecoveries', 'service-promotion-recovery']]) for (const row of rows(s, key).filter(ownPerson)) add(kind, row);
  return out;
}
