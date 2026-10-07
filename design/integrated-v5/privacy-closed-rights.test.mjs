import test from 'node:test';
import assert from 'node:assert/strict';
import { captureClosedRights, closedRightsBinding, closedRightsView, assertClosedRightsCommand, CLOSED_RIGHTS_COMMANDS } from './privacy-closed-rights.mjs';
import { bookingCommand } from './booking.mjs';
import { careCommand } from './service-care.mjs';
import { invoiceCommand } from './service-invoices.mjs';
import { goodsExceptionCommand } from './goods-exceptions.mjs';
import { serviceFinanceExtrasCommand } from './service-finance-extras.mjs';
import { servicePromotionCommand } from './service-promotion.mjs';

const HOUR = 3600000, NOW = Date.parse('2026-10-04T12:00:00+08:00'), CLOSED = NOW - HOUR;
const user = { role: 'user', userId: 'u1' }, other = { role: 'user', userId: 'u2' };
const ctx = s => ({ fail(message) { throw new Error(message); }, id(prefix) { return prefix + (++s.seq); }, log() {} });
function fixture() {
  const b = (id, userId = 'u1', storeId = 's1') => ({ id, userId, storeId, techId: 't1', serviceId: 'relax', createdAt: CLOSED - 3 * HOUR, completedAt: CLOSED - HOUR, version: 2, status: 'done', payment: { id: 'P-' + id, status: 'success', amountCents: 19800, refundedCents: 0, createdAt: CLOSED - 3 * HOUR, paidAt: CLOSED - 2 * HOUR }, extensions: [], refunds: [], disputes: [], events: [], assistance: [] });
  const g = (id, userId = 'u1') => ({ id, userId, createdAt: CLOSED - 3 * HOUR, version: 2, status: 'received', payment: { id: 'P-' + id, status: 'success', amountCents: 19800 }, source: { storeId: 's2' }, lines: [{ skuId: 'SKU-' + id, qty: 2, cancelledQty: 0, returnedQty: 0, unitCents: 9900, paidCents: 19800, refundedCents: 0 }], cases: [], refunds: [], incidents: [], events: [], shippingCents: 0 });
  const s = { now: NOW, seq: 100, users: [{ id: 'u1', status: 'closed' }, { id: 'u2' }], stores: [{ id: 's1' }, { id: 's2' }], techs: [{ id: 't1', storeId: 's1' }], bookings: [b('B1'), b('B2', 'u1', 's2'), b('BF', 'u2')], goods: [g('G1'), g('G2'), g('GF', 'u2')], privacyProfiles: [{ userId: 'u1', status: 'use_closed', version: 4, history: [{ action: '账号使用关闭，历史材料待清理', closureId: 'PC1' }] }], privacyClosures: [{ id: 'PC1', userId: 'u1', status: 'use_closed', version: 2, createdAt: CLOSED - HOUR, closedAt: CLOSED, retention: [{ kind: 'bookings', count: 2, deadline: null }], cleanupStatus: 'pending_review' }], safety: [], logs: [], serviceReviews: [], serviceCareFollowups: [], serviceCareRequests: [], serviceInvoiceRequests: [], commerceInvoiceRequests: [], serviceExtraRequests: [] };
  s.bookings[0].extensions.push({ id: 'BX1', status: 'success', amountCents: 10000, refundedCents: 0, createdAt: CLOSED - HOUR });
  s.bookings[0].refunds.push({ id: 'RF1', status: 'offered', version: 1, deadline: NOW + HOUR, amountCents: 1000, requests: [{ paymentId: 'P-B1', amountCents: 1000 }], lines: [{ paymentId: 'P-B1', amountCents: 1000 }], executions: [], events: [] }, { id: 'RF2', status: 'failed', version: 1, requests: [{ paymentId: 'P-B1', amountCents: 5000 }], lines: [{ paymentId: 'P-B1', amountCents: 5000 }], executions: [{ paymentId: 'P-B1', refundNo: 'RN1', amountCents: 5000, status: 'failed' }] });
  s.bookings[1].refunds.push({ id: 'RF-other-root', status: 'offered', requests: [{ paymentId: 'P-B2', amountCents: 1000 }] });
  s.goods[0].cases.push({ id: 'AS1', kind: 'return', status: 'partial_confirmation', version: 1, skuId: 'SKU-G1', partialReceipt: { qty: 1 }, partialProposal: { status: 'pending', resolution: 'refund', qty: 1, amountCents: 9900, shippingCents: 0, keptQty: 1 }, events: [] });
  s.goods[1].cases.push({ id: 'AS-other-root', status: 'awaiting_return' });
  s.goods[0].incidents.push({ id: 'INC1', kind: 'delay', status: 'awaiting_user', version: 1, caseId: null, proposal: { status: 'pending', resolution: 'continue', caseId: null } });
  s.goods[1].incidents.push({ id: 'INC-other-root', status: 'open' });
  s.serviceCareCases = [{ id: 'SC1', userId: 'u1', storeId: 's1', bookingId: 'B1', source: { kind: 'booking', id: 'B1' }, status: 'user_pending', version: 1, statements: [], resolutions: [], history: [], publicHistory: [], links: [], specialistActions: [], notes: [], ownerScope: 'store' }, { id: 'SCF', userId: 'u2', storeId: 's1', bookingId: 'BF', source: { kind: 'booking', id: 'BF' }, status: 'closed', version: 1 }];
  s.serviceInvoices = [{ id: 'SI1', userId: 'u1', storeId: 's1', bookingId: 'B1', status: 'red', version: 2, createdAt: CLOSED - 30 * 60000, replacedById: 'SI2', red: { ticketNumber: 'technical-sample' }, history: [] }, { id: 'SI2', userId: 'u1', storeId: 's1', bookingId: 'B1', status: 'rejected', version: 1, createdAt: NOW, replacesId: 'SI1', replacedById: null, history: [] }];
  s.commerceInvoices = [{ id: 'GI1', userId: 'u1', category: 'goods', orderId: 'G1', status: 'rejected', version: 1, createdAt: CLOSED - 30 * 60000 }, { id: 'FI1', userId: 'u1', category: 'fee', orderId: 'G1', storeId: 's1', status: 'rejected', version: 1, createdAt: CLOSED - 30 * 60000 }];
  s.serviceRefundShortages = [{ id: 'SH1', bookingId: 'B1', userId: 'u1', storeId: 's1', paymentId: 'P-B1', refundId: 'RF2', refundNo: 'RN1', refundCents: 5000, status: 'awaiting_store', version: 3, failureEvidence: { evidenceRefs: [{ ref: 'private-file-reference' }] }, recharges: [], advances: [{ id: 'A1', path: 'direct-user', status: 'awaiting_user', amountCents: 5000, reason: 'private internal reason', history: [], version: 1 }] }];
  return s;
}
const guard = (s, type, p, actor = user) => assertClosedRightsCommand(s, actor, type, p);
const binding = (s, kind, id) => closedRightsBinding(s, user, kind, id);
const capture = s => captureClosedRights({ ...s, now: CLOSED }, 'u1', CLOSED); // Fixture's original normal-close transaction.

test('关闭前精确本人来源可读，终态不清除既有权益，读取与快照均不修改原账本', () => {
  const s = fixture(), before = structuredClone(s), r = binding(s, 'booking', 'B1');
  assert.equal(r.closedAt, CLOSED); assert.equal(r.rootId, 'B1'); assert.equal(r.sourceVersion, 2); assert.equal(r.basis, 'original-created-at');
  const view = closedRightsView(s, user); assert.equal(view.closureId, 'PC1'); assert.ok(view.items.some(x => x.id === 'B1' && x.status === 'done')); assert.ok(view.items.some(x => x.id === 'G1' && x.status === 'received'));
  assert.ok(view.items.every(x => x.requiresOriginalGuard)); assert.equal(view.items.find(x => x.id === 'G1').storeId, null);
  capture(s); assert.deepEqual(s, before);
  r.rootId = 'tamper'; view.items[0].candidateCommands.push('booking.pay'); view.manualReview.push({ reason: 'tamper' }); assert.deepEqual(s, before);
});
test('本人视图只投影编号状态路径，不含他人源、内部财务附件与个人正文', () => {
  const s = fixture(); s.bookings[0].phone = '13800001234'; s.goods[0].address = { detail: 'private address' }; s.serviceCareCases[0].description = 'private health';
  const text = JSON.stringify(closedRightsView(s, user));
  assert.doesNotMatch(text, /BF|GF|SCF|FI1|private-file-reference|private internal|13800001234|private address|private health/);
  assert.match(text, /\/user\/commodity-invoices\/GI1/); assert.match(text, /\/user\/invoices\/SI2/);
});
test('纯内部商户资金事项不成为本人旧权益入口，binding也不开放商户余额方案', () => {
  const s = fixture(); s.serviceRefundShortages[0].advances[0].path = 'merchant-balance';
  assert.throws(() => binding(s, 'service-advance', 'A1'), /本人直接退款/); assert.throws(() => binding(s, 'service-shortage', 'SH1'), /内部资金/);
  const view = closedRightsView(s, user); assert.ok(!view.items.some(x => ['SH1', 'A1'].includes(x.id))); assert.ok(!view.manualReview.some(x => ['SH1', 'A1'].includes(x.id)));
});
test('关闭时间当天同一时刻创建的本人旧源允许，之后新源与他人源拒绝', () => {
  const s = fixture(); s.bookings[0].createdAt = CLOSED;
  assert.equal(binding(s, 'booking', 'B1').rootId, 'B1'); s.bookings[0].createdAt = CLOSED + 1;
  assert.throws(() => binding(s, 'booking', 'B1'), /晚于关闭/); assert.throws(() => binding(s, 'booking', 'BF'), /不属于/); assert.throws(() => binding(s, 'goods', 'GF'), /不属于/);
});
test('缺日期、日期格式歧义与日历越界的本人源转人工，不补造创建时间', () => {
  for (const value of [undefined, null, '', '2026-10-04', '2026-02-30T10:00:00+08:00', true, '123', Infinity]) {
    const s = fixture(); s.bookings[0].createdAt = value; const before = structuredClone(s);
    assert.throws(() => binding(s, 'booking', 'B1'), /创建时间/); const v = closedRightsView(s, user); assert.ok(v.manualReview.some(x => x.id === 'B1')); assert.ok(!v.items.some(x => x.id === 'B1')); assert.deepEqual(s, before);
  }
});
test('明确时区的真实ISO源日期可以核对，未来或无效关闭时间拒绝', () => {
  const s = fixture(); s.bookings[0].createdAt = new Date(CLOSED - HOUR).toISOString(); assert.doesNotThrow(() => binding(s, 'booking', 'B1'));
  for (const closedAt of [undefined, null, NOW + 1, '2026-02-30T10:00:00Z']) { const next = fixture(); next.privacyClosures[0].closedAt = closedAt; assert.throws(() => binding(next, 'booking', 'B1'), /关闭时间/); assert.equal(closedRightsView(next, user).items.length, 0); }
});
test('唯一关闭依据校验拒绝冲突回执、重复账户与profile、状态和关闭历史串号', () => {
  const mutations = [s => s.privacyClosures.push({ ...s.privacyClosures[0], id: 'PC-other' }), s => s.privacyClosures = [], s => s.privacyProfiles.push({ ...s.privacyProfiles[0] }), s => s.users.push({ ...s.users[0] }), s => s.users[0].status = 'active', s => s.privacyProfiles[0].history[0].closureId = 'another', s => s.privacyClosures[0].createdAt = CLOSED + 1];
  for (const mutate of mutations) { const s = fixture(); mutate(s); assert.throws(() => binding(s, 'booking', 'B1')); const v = closedRightsView(s, user); if (v) { assert.deepEqual(v.items, []); assert.ok(v.manualReview.length); } }
});
test('历史撤回和待办回执不是第二份实际关闭依据，原retention回执保持不变', () => {
  const s = fixture(); s.privacyClosures.push({ id: 'old-request', userId: 'u1', status: 'retracted' }, { id: 'pending-other', userId: 'u2', status: 'requested' });
  const before = structuredClone(s.privacyClosures); assert.doesNotThrow(() => binding(s, 'booking', 'B1')); closedRightsView(s, user); assert.deepEqual(s.privacyClosures, before);
});
test('最小新快照只含实际旧root及现存支付加时ID，缺源进入人工且不复制个人字段', () => {
  const s = fixture(); s.goods[1].createdAt = undefined; s.bookings[0].phone = 'private phone';
  const snap = capture(s); assert.equal(snap.schemaVersion, 1); assert.equal(snap.capturedAt, CLOSED); assert.deepEqual(snap.roots.find(r => r.id === 'B1').paymentIds, ['P-B1', 'BX1']); assert.deepEqual(snap.roots.find(r => r.id === 'B1').extensionIds, ['BX1']);
  assert.ok(!snap.roots.some(r => ['BF', 'GF', 'G2'].includes(r.id))); assert.ok(snap.manualReview.some(r => r.id === 'G2')); assert.doesNotMatch(JSON.stringify(snap), /private phone|private-file/);
  snap.roots[0].paymentIds.push('tampered'); assert.equal(s.bookings[0].payment.id, 'P-B1'); assert.equal(s.bookings[0].extensions.length, 1);
});
test('新快照按创建时ID和时间固定范围，旧源状态版本变化仍可读，倒填日期新根不能放行', () => {
  const s = fixture(); s.privacyClosures[0].rights = capture(s); const saved = structuredClone(s.privacyClosures[0]);
  s.bookings[0].version++; s.bookings[0].status = 'closed'; assert.equal(binding(s, 'booking', 'B1').basis, 'closure-snapshot');
  s.bookings.push({ ...structuredClone(s.bookings[0]), id: 'new-backdated' }); assert.throws(() => binding(s, 'booking', 'new-backdated'), /快照/);
  s.bookings[0].createdAt--; assert.throws(() => binding(s, 'booking', 'B1'), /快照/); assert.deepEqual(s.privacyClosures[0], saved);
});
test('快照关闭身份时间或版本不一致、同域重复root均转人工，不退回旧日期方式', () => {
  for (const mutate of [r => r.userId = 'u2', r => r.schemaVersion = 2, r => r.capturedAt = CLOSED + 1, r => r.roots.push({ ...r.roots[0] }), r => r.roots = []]) {
    const s = fixture(); s.privacyClosures[0].rights = capture(s); mutate(s.privacyClosures[0].rights); assert.throws(() => binding(s, 'booking', 'B1'), /快照/);
  }
});
test('所有核心白名单按实际root和派生事项绑定，允许返回后原领域继续校验', () => {
  const s = fixture(), payloads = {
    'booking.refund-request': { id: 'B1', requests: [{ paymentId: 'P-B1', amountCents: 100 }] }, 'booking.refund-answer': { id: 'B1', refundId: 'RF1', decision: 'accept' }, 'booking.assistance-request': { id: 'B1' }, 'booking.help': { id: 'B1' },
    'care.case-create': { bookingId: 'B1', sourceKind: 'booking', sourceId: 'B1', claim: 'feedback' }, 'care.case-statement': { id: 'SC1' }, 'care.case-answer': { id: 'SC1', decision: 'accept' },
    'goods.case': { id: 'G1', kind: 'return', skuId: 'SKU-G1' }, 'goods.receive': { id: 'G1' }, 'goods.appeal': { id: 'G1', caseId: 'AS1' }, 'goods.return': { id: 'G1', caseId: 'AS1' }, 'goods.return-back-accept': { id: 'G1', caseId: 'AS1' }, 'goods.return-back-receive': { id: 'G1', caseId: 'AS1' }, 'goods.case-withdraw': { id: 'G1', caseId: 'AS1' }, 'goods.partial-confirm': { id: 'G1', caseId: 'AS1', decision: 'reject' }, 'goods.incident-confirm': { id: 'G1', incidentId: 'INC1', decision: 'reject' }, 'goods.incident-receipt': { id: 'G1', incidentId: 'INC1' },
    'invoice.resubmit': { id: 'SI2' }, 'invoice.reapply': { id: 'SI1' }, 'commerce-invoice.resubmit': { id: 'GI1' }, 'commerce-invoice.reapply': { id: 'GI1' }, 'service-extra.advance-confirm': { id: 'SH1', advanceId: 'A1', decision: 'accept' }
  };
  assert.deepEqual(Object.keys(payloads).sort(), CLOSED_RIGHTS_COMMANDS.filter(x => !x.startsWith('service-promotion.')).sort()); const before = structuredClone(s);
  for (const [type, p] of Object.entries(payloads)) { const result = guard(s, type, p); assert.equal(result.userId, 'u1'); assert.equal(result.closureId, 'PC1'); }
  assert.deepEqual(s, before);
});

function promotionFixture({ captured = true } = {}) {
  const s = fixture();
  const r = (id, storeId, personId = 'u1') => ({ id, personKind: 'user', personId, promoterType: 'store-promoter', ownerType: 'store', ownerStoreId: storeId, createdAt: CLOSED - 4 * HOUR, version: 3, status: 'disabled', identity: { status: 'verified', evidenceRefs: [{ ref: 'private-identity-proof' }] }, identityHistory: [], history: [], transferAuthorization: { exempt: false }, agreementSnapshot: { body: 'private agreement' } });
  s.servicePromoters = [r('SPR1', 's1'), r('SPR2', 's2'), r('SPRF', 's1', 'u2')];
  const identity = r => ({ id: r.id, personKind: r.personKind, personId: r.personId, promoterType: r.promoterType, ownerType: r.ownerType, ownerStoreId: r.ownerStoreId });
  const source = r => ({ capturedAt: CLOSED - 3 * HOUR, origin: 'booking-create', promoter: identity(r), binding: null, rule: null, mode: 'demo', productionApproved: false });
  const customer = s.bookings.find(b => b.id === 'BF'); customer.servicePromotionSnapshot = source(s.servicePromoters[0]); customer.phone = '13899999999'; customer.address = { detail: 'private customer address' };
  const b2 = structuredClone(customer); Object.assign(b2, { id: 'BC2', storeId: 's2', servicePromotionSnapshot: source(s.servicePromoters[1]) }); b2.payment.id = 'P-BC2'; s.bookings.push(b2);
  const c = (id, b, amount = 4000) => ({ id, promoterId: b.servicePromotionSnapshot.promoter.id, personKey: 'user:u1', userId: b.userId, storeId: b.storeId, bookingId: b.id, paymentId: b.payment.id, sourceSnapshot: structuredClone(b.servicePromotionSnapshot), sourceToken: 'current-' + id, createdAt: CLOSED - 90 * 60000, version: 4, status: 'withdrawing', known: true, commissionCents: amount, storeCents: amount / 2, groupCents: amount / 2, financialReady: true, availableAt: CLOSED - HOUR, adjustments: [] });
  s.serviceCommissions = [c('SPC1', customer), c('SPC2', b2, 6000)];
  s.servicePromotionWithdrawals = [{ id: 'SPW1', promoterId: 'SPR1', personKind: 'user', personId: 'u1', personKey: 'user:u1', ownerType: 'store', ownerStoreId: 's1', amountCents: 5000, allocations: [{ commissionId: 'SPC1', amountCents: 2000, storeCents: 1000, groupCents: 1000, sourceToken: 'original-SPC1', sourceVersion: 2 }, { commissionId: 'SPC2', amountCents: 3000, storeCents: 1500, groupCents: 1500, sourceToken: 'original-SPC2', sourceVersion: 2 }], status: 'awaiting_user', createdAt: CLOSED - 20 * 60000, version: 2, countDate: '2026-10-04', policySnapshot: { id: 'old-policy', version: 1, dailyLimit: 3 }, authorizationSnapshot: { exempt: false }, confirmExpiresAt: NOW + HOUR, execution: { id: 'SPTX1', requestNo: 'SPNO1', status: 'awaiting_user', attempts: 1, results: [], proof: { reference: 'private-payment-reference', evidenceRefs: [{ ref: 'private-payment-proof' }] } }, history: [] }];
  s.servicePromotionRecoveries = [{ id: 'SPD1', promoterId: 'SPR1', personKey: 'user:u1', commissionId: 'SPC1', bookingId: 'BF', paymentId: 'P-BF', storeId: 's1', amountCents: 800, receivedCents: 1000, outstandingCents: 0, returnPendingCents: 200, storeCents: 400, groupCents: 400, createdAt: CLOSED + 30 * 60000, dueAt: NOW + HOUR, version: 1, status: 'return-pending', records: [{ id: 'SPDR1', kind: 'cash', amountCents: 1000, storeCents: 500, groupCents: 500, reference: 'private-recovery-reference', occurredAt: NOW - 10, evidenceRefs: [{ ref: 'private-recovery-proof' }] }], history: [] }];
  s.servicePromotionOffsets = []; s.servicePromotionRequests = [];
  if (captured) s.privacyClosures[0].rights = capture(s);
  return s;
}
const promotionGuard = (s, type = 'service-promotion.withdraw-confirm', extra = {}) => guard(s, type, { id: 'SPW1', version: s.servicePromotionWithdrawals[0].version, requestId: 'closed-original-withdrawal', decision: 'accept', reason: '本人处理原收款', ...extra });
const promotionCommand = (s, type, p) => { guard(s, type, p); return servicePromotionCommand(s, user, type, p, { ...ctx(s), serviceFinanceSummary: () => ({ canPayTech: true, blockers: [], unknownRefund: false }) }); };

test('C03关闭权益：正常关闭精确捕获个人、他人客户付款源和跨旧门店提现，保持纯读', () => {
  const s = promotionFixture({ captured: false }), before = structuredClone(s), result = capture(s), financial = result.servicePromotion;
  assert.deepEqual(financial.promoters.map(r => r.id), ['SPR1', 'SPR2']); assert.deepEqual(financial.sources.map(r => r.bookingId), ['BF', 'BC2']); assert.equal(financial.withdrawals[0].allocations.length, 2); assert.deepEqual(s, before);
  assert.doesNotMatch(JSON.stringify(financial), /private-|13899999999|policySnapshot|balanceToken/);
  s.privacyClosures[0].rights = result;
  assert.equal(binding(s, 'service-withdrawal', 'SPW1').rootKind, 'service-promotion'); assert.equal(binding(s, 'service-commission', 'SPC1').rootId, 'SPR1');
  assert.throws(() => binding(s, 'booking', 'BF'), /不属于/); assert.doesNotThrow(() => promotionGuard(s));
});
test('C03关闭权益：只增加两项本人续办，精确24命令不按推广前缀开放', () => {
  const s = promotionFixture(); assert.equal(CLOSED_RIGHTS_COMMANDS.length, 24);
  assert.deepEqual(CLOSED_RIGHTS_COMMANDS.filter(x => x.startsWith('service-promotion.')), ['service-promotion.withdraw-confirm', 'service-promotion.withdraw-cancel']);
  for (const cmd of ['withdraw-create', 'enter', 'clear-expired', 'invite-confirm', 'transfer-authorize', 'withdraw-pay', 'withdraw-query', 'identity-review', 'risk-review', 'recovery-receive', 'recovery-return', 'recovery-loss', 'policy-publish', 'rule-publish', 'agreement-publish', 'invite', 'disable', 'withdraw-confirm-extra']) assert.throws(() => promotionGuard(s, 'service-promotion.' + cmd), /不属于本人既有权益/);
  assert.throws(() => promotionGuard(s, 'booking.create'), /不属于本人既有权益/);
});
test('C03关闭权益：无个人财务快照的旧关闭回执转人工，不自动授权或改回执', () => {
  for (const mutate of [s => delete s.privacyClosures[0].rights, s => delete s.privacyClosures[0].rights.servicePromotion]) {
    const s = promotionFixture(); mutate(s); const before = structuredClone(s);
    assert.throws(() => promotionGuard(s), /个人服务佣金快照/); const v = closedRightsView(s, user);
    assert.ok(v.manualReview.some(x => x.id === 'SPW1')); assert.ok(!v.items.some(x => x.rootKind === 'service-promotion')); assert.deepEqual(s, before);
    assert.doesNotThrow(() => binding(s, 'booking', 'B1'));
  }
});
test('C03关闭权益：原财务快照本人、时间、类型与唯一根不一致均拒绝', () => {
  for (const mutate of [r => r.userId = 'u2', r => r.capturedAt++, r => r.schemaVersion++, r => r.promoters.push({ ...r.promoters[0] }), r => r.sources.push({ ...r.sources[0] }), r => r.withdrawals.push({ ...r.withdrawals[0] }), r => r.sources = []]) {
    const s = promotionFixture(); mutate(s.privacyClosures[0].rights.servicePromotion); assert.throws(() => promotionGuard(s), /快照/);
  }
});
test('C03关闭权益：关闭后与事后回填创建时间的新提现都不能续办', () => {
  for (const at of [CLOSED + 1, CLOSED - 1]) {
    const s = promotionFixture(), w = structuredClone(s.servicePromotionWithdrawals[0]); w.id = 'SPW-new'; w.createdAt = at; s.servicePromotionWithdrawals.push(w);
    assert.throws(() => promotionGuard(s, undefined, { id: w.id }), /晚于关闭|快照/);
    assert.ok(!closedRightsView(s, user).items.some(x => x.id === w.id));
  }
});
test('C03关闭权益：提现原日期、金额、分配来源和申请版本快照不能被替换', () => {
  for (const mutate of [w => w.createdAt++, w => w.amountCents++, w => w.ownerStoreId = 's2', w => w.allocations[0].sourceToken = 'replaced', w => w.allocations[0].sourceVersion++, w => w.allocations.reverse(), w => w.allocations[0].groupCents++]) {
    const s = promotionFixture(); mutate(s.servicePromotionWithdrawals[0]); assert.throws(() => promotionGuard(s), /快照|原承担方|金额|组成/);
  }
});
test('C03关闭权益：同本人不同旧身份及门店的分配保留，停用身份不等于资金权益失效', () => {
  const s = promotionFixture(); assert.doesNotThrow(() => promotionGuard(s));
  s.servicePromoters[0].version++; s.servicePromoters[1].version++; assert.doesNotThrow(() => promotionGuard(s));
  assert.equal(binding(s, 'service-commission', 'SPC2').promoterId, 'SPR2');
});
test('C03关闭权益：同一本人的两笔旧佣金不能互换原付款映射冒充提现allocation', () => {
  const s = promotionFixture(), [a, b] = s.serviceCommissions;
  for (const key of ['promoterId', 'bookingId', 'paymentId', 'userId', 'storeId', 'sourceSnapshot']) [a[key], b[key]] = [b[key], a[key]];
  assert.throws(() => promotionGuard(s), /付款映射/); assert.throws(() => binding(s, 'service-commission', a.id), /付款映射/);
});
test('C03关闭权益：原佣金ID不能换名或回填成关闭前新记录，真实退款重算金额版本不冻结', () => {
  const s = promotionFixture(); s.serviceCommissions[0].commissionCents = 1000; s.serviceCommissions[0].storeCents = 500; s.serviceCommissions[0].groupCents = 500; s.serviceCommissions[0].version++; s.serviceCommissions[0].sourceToken = 'refund-current-token';
  assert.doesNotThrow(() => promotionGuard(s)); assert.equal(closedRightsView(s, user).items.find(x => x.id === 'SPC1').financial.commissionCents, 1000);
  s.serviceCommissions[0].id = 'SPC-backdated'; assert.throws(() => binding(s, 'service-commission', 'SPC-backdated'), /付款映射/);
});
test('C03关闭权益：本人或原承担方变更、他人推广身份及本人明细串号不能借用', () => {
  for (const mutate of [s => s.servicePromoters[0].personId = 'u2', s => s.servicePromotionWithdrawals[0].personId = 'u2', s => s.serviceCommissions[1].personKey = 'user:u2', s => s.serviceCommissions[1].promoterId = 'SPRF', s => s.servicePromotionWithdrawals[0].promoterId = 'SPR2']) {
    const s = promotionFixture(); mutate(s); assert.throws(() => promotionGuard(s), /不属于|不一致|快照/);
  }
});
test('C03关闭权益：缺日期或重复佣金支付/身份/申请一律人工核对', () => {
  for (const mutate of [s => delete s.servicePromoters[0].createdAt, s => delete s.servicePromotionWithdrawals[0].createdAt, s => delete s.serviceCommissions[0].createdAt, s => s.serviceCommissions.push({ ...s.serviceCommissions[0], id: 'duplicate-payment' }), s => s.servicePromoters.push({ ...s.servicePromoters[0] }), s => s.servicePromotionWithdrawals.push({ ...s.servicePromotionWithdrawals[0] })]) {
    const s = promotionFixture(); mutate(s); assert.throws(() => promotionGuard(s)); assert.ok(closedRightsView(s, user).manualReview.some(x => x.id === 'SPW1'));
  }
});
test('C03关闭权益：原推广付款或客户根被替换，不能凭旧佣金编号继续', () => {
  for (const mutate of [b => b.createdAt++, b => b.payment.id = 'new-payment', b => b.servicePromotionSnapshot.capturedAt++, b => b.userId = 'u1', b => b.storeId = 's2', b => b.servicePromotionSnapshot.promoter.personId = 'u2']) {
    const s = promotionFixture(); mutate(s.bookings.find(b => b.id === 'BF')); assert.throws(() => promotionGuard(s));
  }
});
test('C03关闭权益：原比例和D06规则快照保持原笔，发布新规则不改变旧权益', () => {
  const s = promotionFixture({ captured: false }), b = s.bookings.find(b => b.id === 'BF');
  b.servicePromotionSnapshot.rule = { id: 'old-rule', version: 1, firstBps: 2000, repeatBps: 1000, storeCostBps: 5000, csRounding: 'floor', concurrency: 'completed-order', lateFullRefund: 'keep-first-slot', basis: 'private policy memo' }; s.serviceCommissions[0].sourceSnapshot = structuredClone(b.servicePromotionSnapshot); s.privacyClosures[0].rights = capture(s);
  s.servicePromotionRules = [{ id: 'new-rule', version: 2, firstBps: 1000, effectiveAt: NOW }]; assert.doesNotThrow(() => promotionGuard(s));
  assert.doesNotMatch(JSON.stringify(s.privacyClosures[0].rights.servicePromotion), /private policy memo/);
  s.serviceCommissions[0].sourceSnapshot.rule.firstBps++; assert.throws(() => promotionGuard(s), /来源不一致/);
  s.serviceCommissions[0].sourceSnapshot.rule.firstBps--; b.servicePromotionSnapshot.rule.lateFullRefund = 'different'; assert.throws(() => promotionGuard(s), /来源快照/);
});
test('C03关闭权益：关闭前实际加时保留；关闭后或回填新增加时不能借旧预约认佣', () => {
  const s = promotionFixture({ captured: false }), b = s.bookings.find(b => b.id === 'BF');
  const x = { id: 'P-X-before', createdAt: CLOSED - 2 * HOUR, status: 'success', amountCents: 10000, refundedCents: 0, servicePromotionSnapshot: { ...structuredClone(b.servicePromotionSnapshot), inheritedFromBookingId: b.id } };
  b.extensions.push(x); s.privacyClosures[0].rights = capture(s);
  const c = { ...structuredClone(s.serviceCommissions[0]), id: 'SPC-X', paymentId: x.id, createdAt: NOW - 1 }; s.serviceCommissions.push(c);
  assert.doesNotThrow(() => binding(s, 'service-commission', c.id));
  for (const at of [CLOSED + 1, CLOSED - 1]) {
    const fresh = structuredClone(s), booking = fresh.bookings.find(b => b.id === 'BF'); booking.extensions.push({ ...structuredClone(x), id: 'new-ext', createdAt: at }); fresh.serviceCommissions.push({ ...structuredClone(c), id: 'new-ext-commission', paymentId: 'new-ext' });
    assert.throws(() => binding(fresh, 'service-commission', 'new-ext-commission'), /晚于关闭|快照/);
  }
});
test('C03关闭权益：加时原继承快照及创建时间缺失不得认作本人旧款', () => {
  for (const mutate of [x => delete x.createdAt, x => delete x.servicePromotionSnapshot, x => x.servicePromotionSnapshot.inheritedFromBookingId = 'B1', x => x.servicePromotionSnapshot.promoter.id = 'SPR2', x => x.servicePromotionSnapshot.rule = { id: 'foreign-rule' }, x => x.servicePromotionSnapshot.binding = { promoterId: 'SPR2' }]) {
    const s = promotionFixture({ captured: false }), b = s.bookings.find(b => b.id === 'BF'), x = { id: 'PX', createdAt: CLOSED - HOUR, servicePromotionSnapshot: { ...structuredClone(b.servicePromotionSnapshot), inheritedFromBookingId: 'BF' } }; mutate(x); b.extensions.push(x);
    const snap = capture(s); assert.ok(snap.manualReview.some(x => x.id === 'PX')); assert.ok(!snap.servicePromotion.sources.some(r => r.paymentId === 'PX'));
  }
});
test('C03关闭权益：原客户绑定核心只取原快照，现时客户绑定变化不改本人财务根', () => {
  const s = promotionFixture({ captured: false }), b = s.bookings.find(b => b.id === 'BF');
  b.servicePromotionSnapshot.binding = { status: 'store', ownerType: 'store', ownerStoreId: 's1', promoterId: 'SPR1', recordedAt: CLOSED - 4 * HOUR, expiresAt: NOW + HOUR, version: 1, origin: 'service-promotion-entry', policySnapshot: { body: 'private policy body' } }; s.serviceCommissions[0].sourceSnapshot = structuredClone(b.servicePromotionSnapshot); s.privacyClosures[0].rights = capture(s);
  s.users.find(u => u.id === 'u2').serviceBinding = { status: 'group', promoterId: null }; assert.doesNotThrow(() => promotionGuard(s)); assert.doesNotMatch(JSON.stringify(s.privacyClosures[0].rights.servicePromotion), /private policy body/);
  b.servicePromotionSnapshot.binding.promoterId = 'SPR2'; assert.throws(() => promotionGuard(s), /来源快照/);
});
test('C03关闭权益：关闭后才核定的原佣金及派生追收可查，新付款不因新核定变成旧权益', () => {
  const s = promotionFixture({ captured: false }); s.serviceCommissions = []; s.servicePromotionWithdrawals = []; s.servicePromotionRecoveries = []; s.privacyClosures[0].rights = capture(s);
  const actual = promotionFixture().serviceCommissions[0]; actual.createdAt = NOW - 1; s.serviceCommissions.push(actual);
  assert.equal(binding(s, 'service-commission', actual.id).rootId, 'SPR1'); const before = structuredClone(s);
  const v = closedRightsView(s, user); assert.equal(v.items.find(x => x.id === actual.id).financial.commissionCents, 4000); assert.deepEqual(s, before);
  const c = { ...structuredClone(actual), id: 'new-source', paymentId: 'brand-new' }; s.serviceCommissions.push(c);
  assert.throws(() => binding(s, 'service-commission', c.id));
});
test('C03关闭权益：个人金额未知明确返回null，不把旧数或待结佣金当零/新提现能力', () => {
  const s = promotionFixture(); s.serviceCommissions[0].known = false; s.serviceCommissions[0].status = 'needs-review';
  const v = closedRightsView(s, user), row = v.items.find(x => x.id === 'SPC1'); assert.deepEqual(row.financial, { known: false, commissionCents: null, financialReady: false }); assert.deepEqual(row.candidateCommands, []);
  assert.doesNotMatch(JSON.stringify(v), /balanceToken|dailyLimit|minWithdrawCents|withdraw-create|customerId|bookingId|private-|13899999999/);
});
test('C03关闭权益：本人提现与超收待退的原追收只给最小事实，不给内部文件和客户详情', () => {
  const s = promotionFixture(), before = structuredClone(s), v = closedRightsView(s, user), w = v.items.find(x => x.id === 'SPW1'), d = v.items.find(x => x.id === 'SPD1');
  assert.equal(w.path, '/user/service-promotion/withdrawals/SPW1'); assert.equal(w.financial.amountCents, 5000); assert.equal(w.financial.execution.status, 'awaiting_user'); assert.equal(d.financial.returnPendingCents, 200); assert.deepEqual(d.candidateCommands, []); assert.equal(d.path, '/user/service-promotion/recoveries/SPD1');
  assert.ok(!v.items.some(x => x.kind === 'booking' && ['BF', 'BC2'].includes(x.id))); assert.doesNotMatch(JSON.stringify(v), /private-|13899999999|sourceSnapshot|reference|identity|policySnapshot|serviceBinding/); assert.deepEqual(s, before);
  w.financial.amountCents = 1; d.financial.outstandingCents = 1; assert.deepEqual(s, before);
});
test('C03关闭权益：派生个人追收也必须匹配原佣金与付款，不开放员工收退命令', () => {
  for (const mutate of [d => d.commissionId = 'SPC2', d => d.personKey = 'user:u2', d => d.bookingId = 'B1', d => d.paymentId = 'P-B1', d => d.receivedCents = NaN, d => delete d.createdAt]) {
    const s = promotionFixture(); mutate(s.servicePromotionRecoveries[0]); assert.throws(() => binding(s, 'service-promotion-recovery', 'SPD1')); assert.ok(closedRightsView(s, user).manualReview.some(x => x.id === 'SPD1'));
  }
});
test('C03关闭权益：追收依据未知保留实收事实，当前应收与待退金额不冒充已核定', () => {
  const s = promotionFixture(); s.servicePromotionRecoveries[0].status = 'needs-review'; s.serviceCommissions[0].known = false;
  const d = closedRightsView(s, user).items.find(x => x.id === 'SPD1'); assert.deepEqual(d.financial, { amountCents: null, receivedCents: 1000, outstandingCents: null, returnPendingCents: null, known: false });
  assert.deepEqual(d.candidateCommands, []); assert.equal(s.servicePromotionRecoveries[0].amountCents, 800);
});
test('C03关闭权益：提现提交任何本人、来源、金额或附件串号均拒绝', () => {
  const s = promotionFixture();
  for (const p of [{ userId: 'u2' }, { promoterId: 'SPR2' }, { personId: 'u2' }, { personKind: 'tech' }, { personKey: 'user:u2' }, { ownerStoreId: 's2' }, { amountCents: 1 }, { bookingId: 'BF' }, { paymentId: 'P-BF' }, { commissionId: 'SPC1' }, { sourceId: 'BF' }, { file: { ref: 'private-file' } }, { evidenceRefs: [] }, { allocations: [] }]) assert.throws(() => promotionGuard(s, undefined, p), /不一致|其他来源|串号/);
  assert.throws(() => promotionGuard(s, undefined, { decision: 'approve' }), /选择无效/);
});
test('C03关闭权益：读取和写入均重新核当前本人，会话撤销、换人、关闭依据冲突不放行', () => {
  const s = promotionFixture(); assert.throws(() => assertClosedRightsCommand(s, { role: 'user', userId: 'u1', sessionId: 'revoked' }, 'service-promotion.withdraw-confirm', { id: 'SPW1', decision: 'accept' }));
  assert.throws(() => closedRightsBinding(s, other, 'service-withdrawal', 'SPW1')); assert.equal(closedRightsView(s, { role: 'user', sessionId: 'revoked', userId: 'u1' }), null);
  s.privacyProfiles.push({ ...s.privacyProfiles[0] }); assert.throws(() => promotionGuard(s), /关闭依据/); assert.deepEqual(closedRightsView(s, user).items, []);
});
test('C03关闭权益：原收款accept仅进未知待查询，金额不变且不伪造paid', () => {
  const s = promotionFixture(), type = 'service-promotion.withdraw-confirm', p = { id: 'SPW1', version: 2, decision: 'accept', reason: '本人确认原收款', requestId: 'original-accept' }, beforeAmount = s.servicePromotionWithdrawals[0].amountCents;
  const result = promotionCommand(s, type, p), w = s.servicePromotionWithdrawals[0]; assert.equal(result.id, w.id); assert.equal(w.status, 'processing'); assert.equal(w.execution.status, 'awaiting_user'); assert.equal(w.amountCents, beforeAmount); assert.equal(w.userDecision.decision, 'accept');
  assert.doesNotThrow(() => binding(s, 'service-withdrawal', w.id)); assert.equal(closedRightsView(s, user).items.find(x => x.id === w.id).status, 'processing');
});
test('C03关闭权益：原本人reject进cancel_requested，实际转账未知时仍不能直接撤销', () => {
  const s = promotionFixture(), p = { id: 'SPW1', version: 2, decision: 'reject', reason: '本人拒绝原收款', requestId: 'original-reject' };
  promotionCommand(s, 'service-promotion.withdraw-confirm', p); assert.equal(s.servicePromotionWithdrawals[0].status, 'cancel_requested');
  assert.throws(() => promotionCommand(s, 'service-promotion.withdraw-cancel', { id: 'SPW1', version: 3, reason: '撤销', requestId: 'no-cancel-unknown' }), /未知不能直接撤销/);
});
test('C03关闭权益：原确认截止及版本照旧，scope不为过期确认延时', () => {
  const s = promotionFixture(), w = s.servicePromotionWithdrawals[0]; w.confirmExpiresAt = NOW;
  assert.doesNotThrow(() => promotionGuard(s)); assert.throws(() => promotionCommand(s, 'service-promotion.withdraw-confirm', { id: w.id, version: 2, decision: 'accept', reason: '确认', requestId: 'expired' }), /有效本人收款确认/); assert.equal(w.confirmExpiresAt, NOW); assert.equal(w.status, 'awaiting_user');
  assert.throws(() => promotionCommand(s, 'service-promotion.withdraw-confirm', { id: w.id, version: 1, decision: 'reject', reason: '拒绝', requestId: 'stale' }), /版本已变化/);
  assert.doesNotThrow(() => promotionCommand(s, 'service-promotion.withdraw-confirm', { id: w.id, version: 2, decision: 'reject', reason: '过期仍拒收原笔', requestId: 'expired-reject' }));
});
test('C03关闭权益：明确failed/requested原提现撤销保留申请及计次，paid/processing不可撤销', () => {
  for (const status of ['requested', 'failed']) {
    const s = promotionFixture(), w = s.servicePromotionWithdrawals[0]; w.status = status; w.execution.status = status === 'failed' ? 'failed' : 'new'; const countDate = w.countDate;
    promotionCommand(s, 'service-promotion.withdraw-cancel', { id: w.id, version: 2, reason: '撤销明确未付原申请', requestId: 'cancel-' + status }); assert.equal(w.status, 'cancelled'); assert.equal(w.countDate, countDate); assert.equal(w.amountCents, 5000); assert.doesNotThrow(() => binding(s, 'service-withdrawal', w.id));
  }
  for (const status of ['paid', 'processing']) {
    const s = promotionFixture(), w = s.servicePromotionWithdrawals[0]; w.status = status; w.execution.status = status === 'paid' ? 'success' : 'processing';
    assert.throws(() => promotionCommand(s, 'service-promotion.withdraw-cancel', { id: w.id, version: 2, reason: '撤销', requestId: 'cancel-' + status }), /未知不能直接撤销/);
  }
});
test('C03关闭权益：成功请求原样重放不再确认、计次或付钱，内容变更仍拒绝', () => {
  const s = promotionFixture(), type = 'service-promotion.withdraw-confirm', p = { id: 'SPW1', version: 2, decision: 'accept', reason: '确认原笔', requestId: 'stable-original' };
  const result = promotionCommand(s, type, p), before = structuredClone(s); assert.deepEqual(promotionCommand(s, type, p), result); assert.deepEqual(s, before);
  assert.throws(() => promotionCommand(s, type, { ...p, decision: 'reject' }), /同一提交标识/);
});
test('C03关闭权益：财务查询后paid和原提现cancelled仍可查，续办原命令守卫拒绝新动作', () => {
  const s = promotionFixture(), w = s.servicePromotionWithdrawals[0]; w.status = 'paid'; w.execution.status = 'success'; w.execution.completedAt = NOW - 1;
  assert.equal(closedRightsView(s, user).items.find(x => x.id === w.id).financial.execution.completedAt, NOW - 1); assert.doesNotThrow(() => binding(s, 'service-withdrawal', w.id));
  assert.throws(() => promotionCommand(s, 'service-promotion.withdraw-confirm', { id: w.id, version: 2, decision: 'accept', reason: '再确认', requestId: 'new-paid-confirm' }), /有效本人收款确认/);
  w.status = 'cancelled'; assert.equal(closedRightsView(s, user).items.find(x => x.id === w.id).status, 'cancelled');
});
test('C03关闭权益：capture不采未来身份/提现或缺源佣金，保留人工核查事实', () => {
  const s = promotionFixture({ captured: false }); s.servicePromoters[1].createdAt = CLOSED + 1; delete s.serviceCommissions[0].sourceSnapshot;
  const result = capture(s); assert.ok(!result.servicePromotion.promoters.some(x => x.id === 'SPR2')); assert.equal(result.servicePromotion.withdrawals.length, 0); assert.ok(result.manualReview.some(x => x.id === 'SPR2')); assert.ok(result.manualReview.some(x => x.id === 'SPC1')); assert.ok(result.manualReview.some(x => x.id === 'SPW1'));
});
test('明确禁止新预约付款、改约加时、商品交易和地址对象、身份恢复、新票评价和工作人员命令', () => {
  const types = ['booking.create', 'booking.pay', 'booking.payment-query', 'booking.cancel', 'booking.extension-create', 'booking.extension-pay', 'booking.extension-query', 'booking.reschedule', 'booking.change-answer', 'goods.submit', 'goods.pay', 'goods.payment-query', 'goods.close', 'goods.address-change', 'cart.set', 'address.save', 'recipient.save', 'handoff.confirm', 'privacy.consent', 'promotion.capture', 'invoice.apply', 'commerce-invoice.apply-goods', 'commerce-invoice.apply-fee', 'review.create', 'review.appeal', 'care.case-respond', 'goods.refund', 'invoice.issue', 'service-extra.advance-pay', 'ui.repeat-booking', 'ui.new-goods', 'account.enter'];
  const s = fixture(), before = structuredClone(s); for (const type of types) assert.throws(() => guard(s, type, { id: 'B1', requestId: 'old-attempt' }), /不属于本人既有权益/); assert.deepEqual(s, before);
});
test('未关闭用户返回null，原用户与工作人员授权仍交给原守卫而非新权益模块', () => {
  const s = fixture(); s.privacyProfiles[0].status = 'active'; s.users[0].status = 'active';
  assert.equal(guard(s, 'booking.pay', { id: 'B1' }), null); assert.equal(closedRightsView(s, user), null); assert.equal(guard(s, 'finance.split-start', {}, { role: 'group', job: 'finance' }), null);
});
test('本人身份缺失、未知账户和伪装工作会话不能取得旧权益，真实撤销和到期会话先拒绝', () => {
  const s = fixture(); for (const a of [null, { role: 'user' }, { role: 'user', userId: 'unknown' }, { role: 'group', userId: 'u1' }, { role: 'user', userId: 'u1', accountId: 'X' }]) { assert.equal(closedRightsView(s, a), null); assert.throws(() => closedRightsBinding(s, a, 'booking', 'B1')); }
  s.staffAccounts = [{ id: 'W1', enabled: true, version: 1, grants: [{ id: 'WG1', role: 'group', job: 'support', enabled: true }] }]; s.staffSessions = [{ id: 'WS1', accountId: 'W1', grantId: 'WG1', accountVersion: 1 }];
  const a = { role: 'user', userId: 'u1', sessionId: 'WS1' }; assert.equal(closedRightsView(s, a), null); assert.throws(() => guard(s, 'booking.refund-answer', { id: 'B1', refundId: 'RF1', decision: 'accept' }, a), /会话不属于/);
  s.staffSessions[0].revokedAt = NOW; assert.throws(() => guard(s, 'booking.help', { id: 'B1' }, a), /失效/); s.staffSessions[0].revokedAt = null; s.staffSessions[0].expiresAt = NOW; assert.throws(() => closedRightsBinding(s, a, 'booking', 'B1'), /失效/);
});
test('退款、售后、异常及直接款子号不能与同一用户的另一根单串接', () => {
  const s = fixture(); const inputs = [ ['booking.refund-answer', { id: 'B1', refundId: 'RF-other-root', decision: 'accept' }], ['goods.appeal', { id: 'G1', caseId: 'AS-other-root' }], ['goods.partial-confirm', { id: 'G1', caseId: 'AS-other-root', decision: 'accept' }], ['goods.incident-confirm', { id: 'G1', incidentId: 'INC-other-root', decision: 'accept' }], ['service-extra.advance-confirm', { id: 'other-shortage', advanceId: 'A1', decision: 'accept' }] ];
  for (const [type, p] of inputs) assert.throws(() => guard(s, type, p), /串号/);
});
test('全部明确提供的本人root字段与子来源要一致，不信payload或地址来源推导本人', () => {
  const s = fixture(); for (const extra of [{ bookingId: 'B2' }, { orderId: 'G1' }, { userId: 'u2' }, { storeId: 's2' }, { refundId: 'RF-other-root' }, { paymentId: 'P-B2' }, { caseId: 'AS1' }, { incidentId: 'INC1' }, { advanceId: 'A1' }]) assert.throws(() => guard(s, 'booking.help', { id: 'B1', ...extra }));
  assert.throws(() => guard(s, 'goods.case', { id: 'G1', kind: 'return', skuId: 'SKU-G2' }), /规格/);
  assert.throws(() => guard(s, 'invoice.resubmit', { id: 'SI2', bookingId: 'B2' }), /串号/);
});
test('每项合法子选择受限，非法审批或恢复动作不能伪装本人确认', () => {
  const s = fixture(); for (const type of ['booking.refund-answer', 'care.case-answer', 'goods.partial-confirm', 'goods.incident-confirm', 'service-extra.advance-confirm']) {
    const p = type === 'booking.refund-answer' ? { id: 'B1', refundId: 'RF1' } : type === 'care.case-answer' ? { id: 'SC1' } : type === 'goods.partial-confirm' ? { id: 'G1', caseId: 'AS1' } : type === 'goods.incident-confirm' ? { id: 'G1', incidentId: 'INC1' } : { id: 'SH1', advanceId: 'A1' };
    for (const decision of [undefined, 'pay', 'reopen', 'delete', false]) assert.throws(() => guard(s, type, { ...p, decision }), /选择无效/);
  }
});
test('退款分笔JSON必须逐笔绑定原支付，不能混入另一单、空来源或重复来源', () => {
  const s = fixture(); assert.doesNotThrow(() => guard(s, 'booking.refund-request', { id: 'B1', requests: JSON.stringify([{ paymentId: 'P-B1', amountCents: 100 }, { paymentId: 'BX1', amountCents: 100 }]) }));
  for (const requests of ['not-json', [], [{}], [{ paymentId: 'P-B2' }], [{ paymentId: 'P-B1' }, { paymentId: 'P-B1' }]]) assert.throws(() => guard(s, 'booking.refund-request', { id: 'B1', requests }));
});
test('关闭快照后新增的支付加时不能借旧root申请退款或通过原退款方案确认', () => {
  const s = fixture(); s.privacyClosures[0].rights = capture(s); s.bookings[0].extensions.push({ id: 'new-ext-backdated', status: 'success', createdAt: CLOSED - 1 });
  assert.throws(() => guard(s, 'booking.refund-request', { id: 'B1', requests: [{ paymentId: 'new-ext-backdated' }] }), /快照/);
  s.bookings[0].refunds[0].requests[0].paymentId = 'new-ext-backdated'; assert.throws(() => guard(s, 'booking.refund-answer', { id: 'B1', refundId: 'RF1', decision: 'accept' }), /快照/);
});
test('无快照兼容不接受实际创建在关闭后的加时分笔，也不篡改原支付记录', () => {
  const s = fixture(), x = s.bookings[0].extensions[0]; x.createdAt = CLOSED + 1; const before = structuredClone(s);
  assert.throws(() => guard(s, 'booking.refund-request', { id: 'B1', requests: [{ paymentId: x.id }] }), /晚于关闭/); assert.deepEqual(s, before);
});
test('加时缺原创建时间一律人工，新快照不能事后回填旧关闭回执', () => {
  const s = fixture(); delete s.bookings[0].extensions[0].createdAt;
  assert.throws(() => guard(s, 'booking.refund-request', { id: 'B1', requests: [{ paymentId: 'BX1' }] }), /创建时间缺失/);
  const snap = capture(s); assert.ok(snap.manualReview.some(x => x.id === 'BX1')); assert.ok(!snap.roots.find(x => x.id === 'B1').paymentIds.includes('BX1'));
  assert.throws(() => captureClosedRights(s, 'u1', CLOSED), /不能回填旧回执/);
  s.privacyClosures[0].rights = snap; assert.throws(() => guard(s, 'booking.refund-request', { id: 'B1', requests: [{ paymentId: 'BX1' }] }), /快照/);
});
test('关闭后派生反馈可沿旧root继续回应，原来源/本人/门店串号和孤立记录必须拒绝', () => {
  const s = fixture(); s.serviceCareCases[0].createdAt = NOW; assert.doesNotThrow(() => guard(s, 'care.case-statement', { id: 'SC1' }));
  for (const change of [{ bookingId: 'BF' }, { userId: 'u2' }, { storeId: 's2' }, { source: { kind: 'booking', id: 'B2' } }, { source: { kind: 'refund', id: 'RF-other-root' } }, { bookingId: 'missing' }]) { const n = fixture(); Object.assign(n.serviceCareCases[0], change); assert.throws(() => binding(n, 'care-case', 'SC1')); }
});
test('关闭后新反馈只允许本人原预约来源及feedback，不借此提交退款或内部转案', () => {
  const s = fixture(); for (const extra of [{ sourceKind: 'refund', sourceId: 'RF1' }, { sourceId: 'B2' }, { claim: 'refund' }, { amountCents: 1 }, { requests: [{ paymentId: 'P-B1' }] }, { id: 'SC1' }]) assert.throws(() => guard(s, 'care.case-create', { bookingId: 'B1', ...extra }));
});
test('原票据新净额派生链允许，首次申请在关闭后或原日期未知不能成为本人重提入口', () => {
  const s = fixture(); assert.doesNotThrow(() => binding(s, 'service-invoice', 'SI2')); assert.doesNotThrow(() => binding(s, 'service-invoice', 'SI1'));
  for (const date of [undefined, CLOSED + 1]) { const n = fixture(); n.serviceInvoices[0].createdAt = date; assert.throws(() => guard(n, 'invoice.resubmit', { id: 'SI2' }), /首次原票申请时间/); }
  s.commerceInvoices[0].createdAt = CLOSED + 1; assert.throws(() => guard(s, 'commerce-invoice.resubmit', { id: 'GI1' }), /首次原票申请时间/);
});
test('双向原票据链每一节点同域本人root门店一致，无环且没有孤立或重复编号', () => {
  const mutations = [s => s.serviceInvoices[0].replacedById = 'other', s => s.serviceInvoices[1].bookingId = 'B2', s => s.serviceInvoices[0].userId = 'u2', s => s.serviceInvoices[0].storeId = 's2', s => s.serviceInvoices[0].replacesId = 'SI2', s => s.serviceInvoices.push({ ...s.serviceInvoices[0] }), s => s.serviceInvoices[1].replacesId = 'missing'];
  for (const mutate of mutations) { const s = fixture(); mutate(s); assert.throws(() => binding(s, 'service-invoice', 'SI2')); }
  const s = fixture(); assert.throws(() => binding(s, 'goods-invoice', 'FI1')); assert.throws(() => guard(s, 'commerce-invoice.resubmit', { id: 'FI1' }));
});
test('派生商品异常的原case或协商case必须属于该商品单，关闭后异常时间不恢复新购买', () => {
  const s = fixture(); s.goods[0].incidents[0].createdAt = NOW; assert.doesNotThrow(() => binding(s, 'goods-incident', 'INC1'));
  s.goods[0].incidents[0].caseId = 'AS-other-root'; assert.throws(() => binding(s, 'goods-incident', 'INC1'));
  s.goods[0].incidents[0].caseId = null; s.goods[0].incidents[0].proposal.caseId = 'AS-other-root'; assert.throws(() => binding(s, 'goods-incident', 'INC1'));
});
test('重复root或跨根重复子编号不能取第一项绕过核查', () => {
  const s = fixture(); s.bookings.push({ ...structuredClone(s.bookings[0]) }); assert.throws(() => binding(s, 'booking', 'B1'), /不唯一/);
  const g = fixture(); g.goods[1].cases.push({ id: 'AS1', status: 'closed' }); assert.throws(() => guard(g, 'goods.appeal', { id: 'G1', caseId: 'AS1' }), /不唯一/);
  const d = fixture(); d.serviceRefundShortages.push({ ...d.serviceRefundShortages[0], advances: [{ id: 'another-advance', path: 'direct-user' }] }); assert.throws(() => guard(d, 'service-extra.advance-confirm', { id: 'SH1', advanceId: 'A1', decision: 'accept' }), /不唯一/);
});
test('直接款只核真实不足事项、原退款执行和本人方案，不收内部证明或允许商户补款方案', () => {
  const s = fixture(); const p = { id: 'SH1', advanceId: 'A1', decision: 'reject', paymentId: 'P-B1', refundId: 'RF2', refundNo: 'RN1' };
  assert.doesNotThrow(() => guard(s, 'service-extra.advance-confirm', p)); assert.throws(() => guard(s, 'service-extra.advance-confirm', { ...p, paymentId: 'BX1' }), /串号/);
  s.serviceRefundShortages[0].advances[0].path = 'merchant-balance'; assert.throws(() => guard(s, 'service-extra.advance-confirm', p), /本人直接退款/);
  for (const change of [{ userId: 'u2' }, { storeId: 's2' }, { refundNo: 'not-original' }, { paymentId: 'P-B2' }]) { const n = fixture(); Object.assign(n.serviceRefundShortages[0], change); assert.throws(() => guard(n, 'service-extra.advance-confirm', p)); }
});
test('原退款办理保留当前版本、终态与中止不可撤回规则，scope通过不冒充办理成功', () => {
  const s = fixture(), p = { id: 'B1', refundId: 'RF1', decision: 'accept', version: 0 }; guard(s, 'booking.refund-answer', p);
  assert.throws(() => bookingCommand(structuredClone(s), user, 'booking.refund-answer', p, ctx(s)), /版本/);
  const n = fixture(); n.bookings[0].refunds[0].status = 'approved'; const withdraw = { id: 'B1', refundId: 'RF1', decision: 'withdraw' }; guard(n, 'booking.refund-answer', withdraw); assert.throws(() => bookingCommand(n, user, 'booking.refund-answer', withdraw, ctx(n)), /不能撤销/);
  const interrupted = fixture(); interrupted.bookings[0].refunds[0].kind = 'interruption'; guard(interrupted, 'booking.refund-answer', withdraw); assert.throws(() => bookingCommand(interrupted, user, 'booking.refund-answer', withdraw, ctx(interrupted)), /不能撤销/);
});
test('原退款请求窗口和金额继续由原模块拒绝，关闭日期不重置期限', () => {
  const s = fixture(), p = { id: 'B1', requests: [{ paymentId: 'P-B1', amountCents: 1 }], reason: '原服务售后' }; s.bookings[0].completedAt = NOW - 49 * HOUR; guard(s, 'booking.refund-request', p);
  assert.throws(() => bookingCommand(s, user, 'booking.refund-request', p, ctx(s)), /48/);
  const n = fixture(); n.bookings[0].refunds = []; const large = { ...p, requests: [{ paymentId: 'P-B1', amountCents: 999999 }] }; guard(n, 'booking.refund-request', large); assert.throws(() => bookingCommand(n, user, 'booking.refund-request', large, ctx(n)), /可退金额/);
});
test('原反馈补充及本人接受通过真实原care命令，关闭不修改源责任或原截止', () => {
  const s = fixture(); s.bookings[0].refunds = []; s.serviceCareCases[0].userDueAt = NOW + HOUR;
  const p = { id: 'SC1', version: 1, requestId: 'statement-original', text: '补充原事项' }; guard(s, 'care.case-statement', p); careCommand(s, user, 'care.case-statement', p, ctx(s)); assert.equal(s.serviceCareCases[0].statements.length, 1);
  const p2 = { id: 'SC1', version: s.serviceCareCases[0].version, requestId: 'answer-original', decision: 'accept', reason: '接受原处理结果' }; guard(s, 'care.case-answer', p2); careCommand(s, user, 'care.case-answer', p2, ctx(s)); assert.equal(s.serviceCareCases[0].status, 'closed'); assert.equal(s.serviceCareCases[0].ownerScope, 'store'); assert.equal(s.serviceCareCases[0].userDueAt, NOW + HOUR); assert.doesNotThrow(() => binding(s, 'care-case', 'SC1'));
  const before = structuredClone(s); guard(s, 'care.case-statement', { id: 'SC1' }); assert.throws(() => careCommand(structuredClone(s), user, 'care.case-statement', { ...p, requestId: 'post-finish', version: s.serviceCareCases[0].version }, ctx(s)), /已结束/); assert.deepEqual(s, before);
});
test('原部分退货实际拒绝流程保留实收货物，已寄回撤回仍被原领域拒绝', () => {
  const s = fixture(), p = { id: 'G1', caseId: 'AS1', decision: 'reject', version: 1, requestId: 'original-partial', reason: '不同意原方案' }; guard(s, 'goods.partial-confirm', p); goodsExceptionCommand(s, user, 'goods.partial-confirm', p, ctx(s)); assert.equal(s.goods[0].cases[0].status, 'partial_received'); assert.equal(s.goods[0].cases[0].partialReceipt.qty, 1);
  const n = fixture(); n.goods[0].cases[0].status = 'awaiting_return'; n.goods[0].cases[0].returnShipment = { tracking: 'technical-demo' }; const withdraw = { id: 'G1', caseId: 'AS1', version: 1, requestId: 'withdraw-return', reason: '撤回' }; guard(n, 'goods.case-withdraw', withdraw); assert.throws(() => goodsExceptionCommand(n, user, 'goods.case-withdraw', withdraw, ctx(n)), /不能撤回/);
});
test('原票重提仍校验当前版本与业务净额，闭户scope不替代票据规则', () => {
  const s = fixture(); s.bookings[0].refunds = [];
  const p = { id: 'SI2', version: 0, requestId: 'old-ticket', kind: 'personal', title: '技术样本', email: 'test@example.com' }; guard(s, 'invoice.resubmit', p); assert.throws(() => invoiceCommand(s, user, 'invoice.resubmit', p, ctx(s)), /版本/);
  const n = fixture(); n.bookings[0].refunds = []; const correct = { ...p, version: 1, requestId: 'old-ticket-v1' }; guard(n, 'invoice.resubmit', correct); invoiceCommand(n, user, 'invoice.resubmit', correct, ctx(n)); assert.equal(n.serviceInvoices[1].status, 'pending'); assert.equal(n.serviceInvoices[1].amount, 29800); assert.equal(n.privacyProfiles[0].status, 'use_closed');
});
test('本人直接款确认沿原extras命令成功，原未知和旧版本仍拒绝，没有执行新资金', () => {
  const s = fixture(), p = { id: 'SH1', advanceId: 'A1', version: 3, requestId: 'original-direct', decision: 'accept', reason: '本人接受原本款处理方案' }; guard(s, 'service-extra.advance-confirm', p); serviceFinanceExtrasCommand(s, user, 'service-extra.advance-confirm', p, ctx(s)); assert.equal(s.serviceRefundShortages[0].advances[0].status, 'confirmed'); assert.equal(s.bookings[0].payment.refundedCents, 0); assert.equal(s.bookings[0].refunds[1].executions[0].status, 'failed');
  for (const change of [n => n.bookings[0].refunds[1].executions[0].status = 'processing', n => n.serviceRefundShortages[0].version = 4]) { const n = fixture(); change(n); guard(n, 'service-extra.advance-confirm', p); assert.throws(() => serviceFinanceExtrasCommand(n, user, 'service-extra.advance-confirm', p, ctx(n)), /未知|版本/); }
});
