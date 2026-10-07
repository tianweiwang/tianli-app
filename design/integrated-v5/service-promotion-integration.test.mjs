import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { seed, reduce, upgradeFinanceState } from './engine.mjs';
import { serviceFinanceSummary } from './service-finance.mjs';
import { servicePromotionView, servicePromotionBalanceToken, servicePromotionMonthlyFacts } from './service-promotion.mjs';
import { serviceExtraSourceToken } from './service-finance-extras.mjs';
import { prepareServiceExtraEvidence } from './service-extra-file-validation.mjs';
import { prepareServicePromotionEvidence } from './service-promotion-file-validation.mjs';
import { authorizedInvoiceFile } from './invoice-files.mjs';
import { resolveAccountActor } from './staff-accounts.mjs';
import { qualificationEligibility } from './tech-qualification.mjs';
import { reportView } from './operations-reports.mjs';
import { feeInvoiceSummary } from './commerce-invoices.mjs';
import { workTaskView } from './work-tasks.mjs';
import { createTaskReturnContext, taskNavigationTarget, taskReturnTarget } from './task-navigation.mjs';

const MIN = 60000, DAY = 86400000;
const customer = { role: 'user', userId: 'u1' }, personal = { role: 'user', userId: 'u2' };
const tech = { role: 'tech', techId: 'lin' }, finance = { role: 'group', job: 'finance' };
const support = { role: 'group', job: 'support' }, manager = { role: 'store', job: 'store-manager', storeId: 'xingfu' };
const localFinance = { role: 'store', job: 'store-finance', storeId: 'xingfu' };
const bytes = new TextEncoder().encode('%PDF-1.4\nSynthetic source for local shared-command acceptance\n%%EOF');
const evidenceFile = { ref: 'invoice-file:' + createHash('sha256').update(bytes).digest('hex'), name: '共享链路合成凭证.pdf', type: 'application/pdf', size: bytes.length };
const evidenceBlob = new Blob([bytes], { type: evidenceFile.type });
const floor = (n, bps) => Number(BigInt(n) * BigInt(bps) / 10000n);
const sum = (rows, fn) => rows.reduce((n, x) => n + fn(x), 0);
function assertOriginalTransaction(actual, original) {
  assert.ok(actual, 'Original transaction must remain in history');
  for (const [key, value] of Object.entries(original)) if (key !== 'reason') assert.deepEqual(actual[key], value, 'Original transaction fact must remain: ' + key);
}

// This is a real Blob / format / metadata / content digest read. It supplies
// only verified metadata to reduce, never a true callback or payload flag.
// Application upload/storage and production channel acceptance remain separate.
async function readRuntimeEvidence(p) {
  let files = p.evidenceRefs ?? (p.file ? [p.file] : []);
  if (typeof files === 'string') files = JSON.parse(files);
  const refs = [];
  for (const descriptor of files) {
    assert.equal(descriptor.ref, evidenceFile.ref);
    assert.equal(descriptor.type, evidenceBlob.type);
    assert.equal(descriptor.size, evidenceBlob.size);
    assert.equal(descriptor.name, evidenceFile.name);
    const buffer = await evidenceBlob.arrayBuffer();
    const content = new Uint8Array(buffer);
    assert.equal(new TextDecoder().decode(content.slice(0, 5)), '%PDF-');
    assert.ok(new TextDecoder().decode(content).includes('%%EOF'));
    assert.equal('invoice-file:' + createHash('sha256').update(content).digest('hex'), descriptor.ref);
    refs.push(structuredClone(descriptor));
  }
  return { evidenceRefs: refs };
}

function harness() {
  let state = seed(), sequence = 0;
  const h = {
    get s() { return state; },
    b(id) { return state.bookings.find(x => x.id === id); },
    entry(id, paymentId) { const b = h.b(id); return (state.serviceFinanceEntries || []).find(x => x.bookingId === id && x.paymentId === (paymentId || b.payment.id)); },
    summary(id, paymentId) { const b = h.b(id); return serviceFinanceSummary(state, id, paymentId || b.payment.id); },
    commission(id, paymentId) { const b = h.b(id); return (state.serviceCommissions || []).find(x => x.bookingId === id && x.paymentId === (paymentId || b.payment.id)); },
    promoter() { return (state.servicePromoters || []).find(x => x.personKind === 'user' && x.personId === 'u2'); },
    withdrawal() { return state.servicePromotionWithdrawals.at(-1); },
    recovery(id) { return (state.serviceFinanceRecoveries || []).find(x => x.entryId === h.entry(id).id && x.type === 'unshared-release'); },
    personalDebt(id) { return (state.servicePromotionRecoveries || []).find(x => x.commissionId === h.commission(id).id); },
    proof(reference = 'C03-ACTUAL-' + ++sequence, occurredAt = state.now) { return { reference, occurredAt, file: evidenceFile, reason: '合成凭证经实际读取用于本地原指令验收' }; },
    async run(type, p = {}, actor = finance) {
      const records = ['servicePromoters', 'servicePromotionInvites', 'servicePromotionWithdrawals', 'servicePromotionRecoveries', 'servicePromotionRisks', 'serviceFinanceEntries', 'serviceFinanceRecoveries', 'serviceExtraEvidence', 'serviceRefundShortages', 'serviceExtraRecoveries', 'serviceExtraOffsets'].flatMap(key => state[key] || []);
      const row = records.find(x => x.id === (p.id || p.promoterId));
      const payload = { requestId: 'C03-SHARED-' + ++sequence, version: row?.version || 0, ...p };
      const fileRuntime = { readFile: async descriptor => { assert.equal(descriptor.ref, evidenceFile.ref); return evidenceBlob; } };
      const evidence = type.startsWith('service-extra.')
        ? await prepareServiceExtraEvidence(state, actor, type, payload, fileRuntime)
        : type.startsWith('service-promotion.') || type === 'finance.recovery-receive'
          ? await prepareServicePromotionEvidence(state, actor, type, payload, fileRuntime)
          : await readRuntimeEvidence(payload);
      let result;
      state = reduce(state, actor, type, payload, value => result = value, evidence);
      return result;
    },
    async advance(minutes) { while (minutes > 0) { const part = Math.min(minutes, 44640); await h.run('clock.advance', { minutes: part }); minutes -= part; } },
    async at(time) { assert.ok(time >= state.now, 'Original clock facts only move forward'); if (time > state.now) await h.advance(Math.ceil((time - state.now) / MIN)); },
    async setup({ groupBps = 1000, storeBps = 500, firstBps = 2000, repeatBps = 1000, storeCostBps = 5000, lateFullRefund = 'reassign' } = {}) {
      await h.run('finance.rule-publish', { scope: 'global', groupBps, storeBps, effectiveAt: state.now, version: 0, reason: '明确本地原H配置，正式比例另定' });
      await h.run('service-promotion.agreement-publish', { promoterType: 'store-promoter', title: '本地验证协议', body: '验证本人接受原协议、实际核验与原款佣金闭环。', effectiveAt: state.now, ...h.proof() }, support);
      await h.run('service-promotion.invite', { userId: 'u2', promoterType: 'store-promoter', expiresAt: state.now + DAY, reason: '原门店本人推广邀请' }, manager);
      const invite = state.servicePromotionInvites.at(-1);
      await h.run('service-promotion.invite-confirm', { id: invite.id, decision: 'accept', agreementAccepted: true, agreementId: invite.agreementSnapshot.id, reason: '本人核实原邀请协议' }, personal);
      await h.run('service-promotion.identity-review', { id: h.promoter().id, decision: 'verified', ...h.proof() }, support);
      await h.run('service-promotion.transfer-authorize', { id: h.promoter().id, enabled: true, reason: '本人明确本地免确认收款授权' }, personal);
      await h.run('service-promotion.rule-publish', { promoterType: 'store-promoter', firstBps, repeatBps, storeCostBps, csRounding: 'floor', concurrency: 'completed-created-id', lateFullRefund, effectiveAt: state.now, version: 0, basis: '本次明确Demo配置，D06正式审批另验' });
      await h.run('service-promotion.enter', { promoterId: h.promoter().id, version: state.users.find(x => x.id === 'u1').serviceBinding.version || 0 }, customer);
    },
    async create({ storeId = 'xingfu', techId = 'lin', regionId = 'home', serviceId = 'relax' } = {}) {
      const before = new Set(state.bookings.map(x => x.id));
      const startAt = Math.ceil((state.now + 4 * 3600000) / (30 * MIN)) * 30 * MIN;
      await h.run('booking.create', { storeId, serviceId, regionId, techId, startAt, mode: 'specified', genderPreference: 'any', contactName: '合成顾客', phone: '13800000001', healthConsent: true, identityVerified: true, adultConfirmed: true }, customer);
      const b = state.bookings.find(x => !before.has(x.id));
      assert.ok(b, 'Original booking.create must create the booking');
      await h.run('booking.pay', { id: b.id, outcome: 'success' }, customer);
      await h.run('booking.accept', { id: b.id }, { role: 'tech', techId });
      return b.id;
    },
    async complete(id, { extension = false } = {}) {
      let b = h.b(id);
      await h.at(Math.max(state.now, b.startAt));
      await h.run('booking.start', { id }, { role: 'tech', techId: b.techId });
      if (extension) { await h.run('booking.extension-create', { id }, customer); const ext = h.b(id).extensions.at(-1); await h.run('booking.extension-pay', { id, extensionId: ext.id, outcome: 'success' }, customer); }
      b = h.b(id);
      await h.advance(b.duration + sum(b.extensions.filter(x => x.status === 'success'), x => x.duration));
      await h.run('booking.finish', { id, mode: 'normal' }, { role: 'tech', techId: b.techId });
      return id;
    },
    async earning(options) { const id = await h.create(options); await h.complete(id); await h.advance(2881); return id; },
    async execute(id, type = 'split-start', outcome = 'success', p = {}) { const entry = h.entry(id, p.paymentId); return h.run('finance.' + type, { id: entry.id, version: entry.version, outcome, ...h.proof(), ...p }); },
    async settle(id) { await h.execute(id); await h.execute(id, 'finish-start'); },
    async refund(id, amountCents, { outcome = 'success', paymentId } = {}) {
      const b = h.b(id), requests = [{ paymentId: paymentId || b.payment.id, amountCents }];
      if (state.now > b.completedAt + 2 * DAY) await h.run('booking.special-aftersale', { id, requests, reason: '原客服特批处理实际售后申请' }, support);
      else await h.run('booking.refund-request', { id, requests, reason: '本人原分笔售后申请' }, customer);
      const refund = h.b(id).refunds.at(-1);
      await h.run('booking.refund-review', { id, refundId: refund.id, decision: 'approve', reason: '按原实际申请核实批准' }, refund.kind === 'special' ? support : manager);
      await h.run('booking.refund-pay', { id, refundId: refund.id, paymentId: paymentId || b.payment.id, outcome });
      return refund.id;
    },
    async withdraw(amountCents, p = {}) { const promoter = h.promoter(); await h.run('service-promotion.withdraw-create', { promoterId: promoter.id, amountCents, balanceToken: servicePromotionBalanceToken(state, promoter.id), version: promoter.version, ...p }, personal); return h.withdrawal().id; },
    async payPersonal(outcome = 'success', p = {}) { const w = h.withdrawal(); await h.run('service-promotion.withdraw-pay', { id: w.id, outcome, reason: '原个人转账结果核对', ...(outcome === 'success' ? h.proof() : {}), ...p }); },
    async queryPersonal(outcome = 'success', p = {}) { const w = h.withdrawal(); await h.run('service-promotion.withdraw-query', { id: w.id, outcome, reason: '只查原个人转账', ...(outcome === 'success' ? h.proof() : {}), ...p }); },
    async pair() { const first = await h.create(); await h.complete(first); const second = await h.create(); await h.complete(second); await h.advance(2881); return { first, second }; },
    async firstRefund(id) { return h.refund(id, h.b(id).payment.amountCents); },
    async goodsSentinel() {
      await h.run('promotion.enter', { storeId: 'silver' }, customer);
      await h.run('cart.set', { skuId: 'oil', qty: 1 }, customer);
      await h.run('goods.submit', { addressId: 'AD1' }, customer);
      const order = state.goods.at(-1);
      await h.run('goods.pay', { id: order.id, outcome: 'success' }, customer);
      return { goods: structuredClone(state.goods), skus: structuredClone(state.skus), bills: structuredClone(state.bills), recoveries: structuredClone(state.recoveries), promotions: structuredClone(state.promotions) };
    },
    assertGoods(original) { for (const key of ['goods', 'skus', 'bills', 'recoveries', 'promotions']) assert.deepEqual(state[key], original[key], 'Service flow must preserve goods ' + key); },
    async staff(job, storeId) {
      const adminEntry = await h.run('account.enter', { accountId: 'DEMO-ADMIN', grantId: 'DEMO-ADMIN-GRANT' }, customer), admin = resolveAccountActor(state, adminEntry);
      const account = await h.run('account.create', { name: 'C03共享' + job, reason: '原实际测试岗位账号' }, admin);
      const granted = await h.run('account.grant', { id: account.id, version: account.version, job, ...(storeId ? { storeId } : {}), reason: '原岗位明确授权' }, admin);
      const entered = await h.run('account.enter', { accountId: account.id, grantId: granted.grants.at(-1).id }, customer);
      return resolveAccountActor(state, entered);
    }
  };
  return h;
}

test('C03 shared: normal booking keeps the five-step flow, original H + Cs and real personal payout', async () => {
  const h = harness(); await h.setup(); const goods = await h.goodsSentinel(); const id = await h.earning();
  const b = h.b(id), amount = b.payment.amountCents, c = h.commission(id), initial = h.summary(id);
  assert.equal(b.status, 'done'); assert.equal(b.servicePromotionSnapshot.promoter.id, h.promoter().id);
  assert.equal(initial.platformCents, floor(amount, 500)); assert.equal(initial.commissionCents, floor(amount, 2000));
  assert.equal(initial.promotionStoreCents, floor(c.commissionCents, 5000));
  assert.equal(initial.targetGroupCents, initial.platformCents + initial.promotionStoreCents);
  assert.equal(servicePromotionView(h.s, personal).balances[0].availableCents, 0);
  await h.settle(id); assert.equal(h.summary(id).canPayTech, true);
  assert.equal(servicePromotionView(h.s, personal).balances[0].availableCents, c.commissionCents);
  await h.withdraw(c.commissionCents); await h.payPersonal('processing'); assert.equal(h.withdrawal().status, 'processing');
  assert.equal(servicePromotionMonthlyFacts(h.s, finance).rows.filter(x => x.kind === 'payment').length, 0);
  await h.queryPersonal(); assert.equal(h.withdrawal().status, 'paid');
  assert.equal(servicePromotionMonthlyFacts(h.s, finance).rows.filter(x => x.kind === 'payment')[0].amountCents, c.commissionCents);
  h.assertGoods(goods);
});

test('C03 shared: original self-service first refund within 48 hours reassigns the next main payment before ordinary settlement', async () => {
  const h = harness(); await h.setup(); const first = await h.create(); await h.complete(first); const second = await h.create(); await h.complete(second);
  assert.equal(h.commission(second).kind, 'repeat'); await h.firstRefund(first);
  const refund = h.b(first).refunds.at(-1); assert.notEqual(refund.kind, 'special'); assert.equal(refund.status, 'success');
  assert.equal(h.commission(first).commissionCents, 0); assert.equal(h.commission(second).kind, 'first');
  await h.advance(2881); const v = h.summary(second);
  assert.equal(v.commissionCents, floor(h.b(second).payment.amountCents, 2000)); assert.equal(v.targetGroupCents, v.platformCents + v.promotionStoreCents);
  await h.settle(second); assert.equal(h.summary(second).canPayTech, true); assert.equal(h.personalDebt(first), undefined);
});

test('C03 shared: full first refund increases the next original A, before finish only the exact additional split is paid', async () => {
  const h = harness(); await h.setup(); const { first, second } = await h.pair();
  await h.execute(second); const original = structuredClone(h.entry(second).split), oldA = h.summary(second).targetGroupCents;
  await h.firstRefund(first); const target = h.summary(second).targetGroupCents;
  assert.ok(target > oldA); assert.equal(h.summary(second).pendingAdditionalCents, target - oldA);
  assert.equal(h.summary(second).additionalPath, 'channel');
  await h.execute(second); const e = h.entry(second);
  assert.equal(e.split.amountCents, target - oldA); assert.notEqual(e.split.requestNo, original.requestNo);
  assertOriginalTransaction(e.splitHistory.find(x => x.id === original.id), original);
  assert.equal(h.summary(second).splitPaidCents, target); assert.equal(h.summary(second).platformCents, floor(h.b(second).payment.amountCents, 500));
  await h.execute(second, 'finish-start'); assert.equal(h.summary(second).canPayTech, true);
  assert.equal((h.s.serviceFinanceRecoveries || []).filter(x => x.entryId === e.id).length, 0);
});

test('C03 shared: after successful finish, the same increase creates one original store debt and never a new split', async () => {
  const h = harness(); await h.setup(); const { first, second } = await h.pair(); await h.settle(second);
  const original = structuredClone(h.entry(second).split), paid = h.summary(second).splitPaidCents;
  await h.firstRefund(first); const v = h.summary(second), debt = h.recovery(second);
  assert.equal(v.additionalPath, 'recovery'); assert.equal(debt.amountCents, v.targetGroupCents - paid);
  assert.equal(debt.reasonCode, 'finished-adjustment'); assert.equal(debt.payer, 'store:xingfu'); assert.equal(debt.payee, 'group');
  await assert.rejects(() => h.execute(second), /完结|解冻|追偿|追收|不能/);
  assert.deepEqual(h.entry(second).split, original); assert.equal(v.canPayTech, false);
  await h.run('finance.recovery-receive', { id: debt.id, amountCents: debt.amountCents, ...h.proof() });
  assert.equal(h.summary(second).canPayTech, true); assert.equal(h.recovery(second).status, 'closed');
  await h.advance(1); assert.equal(h.s.serviceFinanceRecoveries.filter(x => x.entryId === h.entry(second).id && x.type === 'unshared-release').length, 1);
});

test('C03 shared: original pending split must query the fixed amount before refund-derived adjustment, replay records once', async () => {
  const h = harness(); await h.setup(); const { first, second } = await h.pair(); await h.execute(second, 'split-start', 'processing');
  const original = structuredClone(h.entry(second).split); await h.firstRefund(first);
  await assert.rejects(() => h.execute(second, 'split-start', 'success', { manual: true, reason: '不能绕过原笔未知' }), /未知|查询/);
  assert.equal(h.recovery(second), undefined); assert.equal(h.summary(second).canPayTech, false);
  const p = { transactionId: original.id, requestId: 'C03-ORIGINAL-QUERY', version: h.entry(second).version, ...h.proof('C03-ORIGINAL-SPLIT-QUERY') };
  await h.execute(second, 'split-query', 'success', p); await h.execute(second, 'split-query', 'success', p);
  assert.equal(h.summary(second).splitPaidCents, original.amountCents);
  assert.equal(h.entry(second).split.requestNo, original.requestNo); assert.equal(h.entry(second).split.results.filter(x => x.operation === 'query').length, 1);
  assert.equal(h.summary(second).pendingAdditionalCents, h.summary(second).targetGroupCents - original.amountCents);
  await h.execute(second); assert.equal(h.summary(second).splitPaidCents, h.summary(second).targetGroupCents);
});

test('C03 shared: explicit failed same-amount retry preserves the original request, changed target preserves old failed evidence', async () => {
  const h = harness(); await h.setup(); const { first, second } = await h.pair(); await h.execute(second, 'split-start', 'failed');
  const failed = structuredClone(h.entry(second).split);
  await h.execute(second, 'split-start', 'failed', { manual: true, reason: '明确失败的原笔人工重试' });
  assert.equal(h.entry(second).split.requestNo, failed.requestNo); assert.equal(h.entry(second).split.attempts, 2);
  await h.firstRefund(first); await h.execute(second, 'split-start', 'success', { manual: true, reason: '按新首单目标核对原失败款差额' });
  assert.notEqual(h.entry(second).split.requestNo, failed.requestNo);
  assert.ok(h.entry(second).splitHistory.some(x => x.id === failed.id && x.status === 'failed' && x.attempts === 2));
  assert.equal(h.summary(second).splitPaidCents, h.summary(second).targetGroupCents);
});

test('C03 shared: zero split completed before service uses store recovery after service, never rewrites zero as already paid', async () => {
  const h = harness(); await h.setup({ groupBps: 0, storeBps: 0 }); const id = await h.create(); const paidAt = h.b(id).payment.paidAt;
  await h.at(paidAt + 25 * DAY); await h.execute(id); assert.equal(h.entry(id).split.status, 'zero');
  await h.execute(id, 'finish-start'); const zero = structuredClone(h.entry(id).split);
  await h.complete(id); assert.equal(h.summary(id).additionalPath, 'recovery');
  assert.equal(h.recovery(id).amountCents, h.summary(id).promotionStoreCents); assert.deepEqual(h.entry(id).split, zero);
  await assert.rejects(() => h.execute(id), /完结|解冻|追偿|追收|不能/);
});

test('C03 shared: zero split before finish allows the new actual Cs while preserving the original zero source', async () => {
  const h = harness(); await h.setup({ groupBps: 0, storeBps: 0 }); const id = await h.create(), paidAt = h.b(id).payment.paidAt;
  await h.at(paidAt + 25 * DAY); await h.execute(id); const zero = structuredClone(h.entry(id).split);
  assert.equal(zero.status, 'zero'); await h.complete(id);
  const v = h.summary(id); assert.equal(v.additionalPath, 'channel'); assert.ok(v.pendingAdditionalCents > 0);
  await h.execute(id); assert.equal(h.entry(id).split.amountCents, v.promotionStoreCents);
  assertOriginalTransaction(h.entry(id).splitHistory.find(x => x.id === zero.id), zero);
  assert.equal(h.recovery(id), undefined);
});

test('C03 shared: 25 / 27 / 30 remain original payment dates and a completed force split creates only one debt for later Cs', async () => {
  const h = harness(); await h.setup(); const id = await h.create(), paidAt = h.b(id).payment.paidAt;
  await h.at(paidAt + 25 * DAY); const before = h.summary(id);
  assert.equal(before.forced, true); assert.equal(before.commissionCents, 0); await h.settle(id);
  const split = structuredClone(h.entry(id).split); assert.equal(split.amountCents, floor(h.b(id).payment.amountCents, 500));
  await h.complete(id); const debt = h.recovery(id); assert.equal(debt.reasonCode, 'finished-adjustment');
  assert.equal(debt.amountCents, h.summary(id).promotionStoreCents);
  await h.at(paidAt + 27 * DAY); assert.ok(h.entry(id).alertedAt); assert.equal(h.summary(id).alertAt, paidAt + 27 * DAY);
  await h.at(paidAt + 30 * DAY); assert.equal(h.summary(id).expiresAt, paidAt + 30 * DAY);
  assert.equal(h.recovery(id).id, debt.id); assert.equal(h.s.serviceFinanceRecoveries.filter(x => x.entryId === h.entry(id).id && x.type === 'unshared-release').length, 1);
  assert.deepEqual(h.entry(id).split, split); assert.equal(h.summary(id).canSplit, false);
  await h.run('finance.recovery-receive', { id: debt.id, amountCents: h.recovery(id).outstandingCents, ...h.proof() });
  assert.equal(h.summary(id).canPayTech, true);
});

test('C03 shared: 25-day force can exclude confirmed refund amount, unknown refund cannot be bypassed', async () => {
  const h = harness(); await h.setup(); const id = await h.earning();
  await h.refund(id, 9800, { outcome: 'processing' }); const paidAt = h.b(id).payment.paidAt;
  await h.at(paidAt + 25 * DAY); await assert.rejects(() => h.execute(id, 'split-start', 'success', { manual: true, reason: '25日仍须查退款' }), /未知|查询/);
  const r = h.b(id).refunds.at(-1); await h.run('booking.refund-query', { id, refundId: r.id, outcome: 'failed' });
  const v = h.summary(id), base = v.netCents - v.heldConfirmedCents;
  assert.equal(v.heldConfirmedCents, 9800); assert.equal(v.splitTargetCents, floor(base, 500) + floor(floor(base, 2000), 5000));
  await h.execute(id); assert.equal(h.entry(id).split.amountCents, v.splitTargetCents);
});

test('C03 shared: multiple successful splits refund by exact original split; an unknown return holds that source', async () => {
  const h = harness(); await h.setup(); const { first, second } = await h.pair(); await h.execute(second);
  const firstSplit = structuredClone(h.entry(second).split); await h.firstRefund(first); await h.execute(second);
  const secondSplit = structuredClone(h.entry(second).split); await h.execute(second, 'finish-start'); await h.refund(second, 20000);
  let v = h.summary(second); assert.ok(v.pendingReturnCents > firstSplit.amountCents);
  await assert.rejects(() => h.execute(second, 'return-start', 'success', { splitId: 'UNRELATED-SPLIT' }), /分账|来源|原笔/);
  await h.execute(second, 'return-start', 'processing', { splitId: firstSplit.id, amountCents: firstSplit.amountCents });
  const ret = h.entry(second).returns.at(-1); assert.equal(ret.splitId, firstSplit.id); assert.equal(ret.splitRequestNo, firstSplit.requestNo);
  await assert.rejects(() => h.execute(second, 'return-start', 'success', { splitId: secondSplit.id }), /未知|查询/);
  await h.execute(second, 'return-query', 'success', { returnId: ret.id });
  const remaining = h.summary(second).pendingReturnCents; assert.ok(remaining > 0 && remaining <= secondSplit.amountCents);
  await h.execute(second, 'return-start', 'success', { splitId: secondSplit.id, amountCents: remaining });
  v = h.summary(second); assert.equal(v.returnedCents, firstSplit.amountCents + remaining); assert.equal(v.totalReturnPendingCents, 0);
  assert.equal(h.entry(second).returns.length, 2); assert.equal(v.platformCents, floor(h.b(second).payment.amountCents - 20000, 500));
});

test('C03 shared: partial actual commission payout retains only original unpaid-to-store Cs until real recovery', async () => {
  const h = harness(); await h.setup(); const id = await h.earning(); await h.settle(id);
  await h.withdraw(h.commission(id).commissionCents); await h.payPersonal(); await h.refund(id, 9800);
  const v = h.summary(id), debt = h.personalDebt(id); assert.equal(debt.storeCents, 980);
  assert.equal(v.retainedStoreCommissionCents, 980); assert.equal(v.pendingReturnCents, 490);
  await h.execute(id, 'return-start', 'success', { splitId: h.entry(id).split.id, amountCents: 490 });
  await h.run('service-promotion.recovery-receive', { id: debt.id, amountCents: debt.amountCents, ...h.proof() });
  assert.equal(h.summary(id).retainedStoreCommissionCents, 0); assert.equal(h.summary(id).pendingReturnCents, 980);
  await h.execute(id, 'return-start', 'success', { splitId: h.entry(id).split.id, amountCents: 980 });
  assert.equal(h.summary(id).totalReturnPendingCents, 0); assert.equal(h.personalDebt(id).outstandingCents, 0);
});

test('C03 shared: personal transfer unknown during refund blocks uncertain Cs return, success keeps debt and failure does not invent debt', async () => {
  for (const outcome of ['success', 'failed']) {
    const h = harness(); await h.setup(); const id = await h.earning(); await h.settle(id);
    await h.withdraw(h.commission(id).commissionCents); await h.payPersonal('processing'); const originalNo = h.withdrawal().execution.requestNo;
    await h.refund(id, 9800); assert.equal(h.summary(id).unknownPersonalTransfer, true); assert.equal(h.personalDebt(id), undefined);
    await assert.rejects(() => h.execute(id, 'return-start', 'success', { splitId: h.entry(id).split.id }), /未知|查询|佣金/);
    await h.queryPersonal(outcome); assert.equal(h.withdrawal().execution.requestNo, originalNo); assert.equal(h.summary(id).unknownPersonalTransfer, false);
    if (outcome === 'success') { assert.equal(h.personalDebt(id).amountCents, 1960); assert.equal(h.summary(id).retainedStoreCommissionCents, 980); }
    else { assert.equal(h.personalDebt(id), undefined); assert.equal(h.summary(id).retainedStoreCommissionCents, 0); assert.equal(h.summary(id).pendingReturnCents, 1470); }
  }
});

test('C03 shared: only financially ready future commission deducts the original personal debt and releases retained store Cs', async () => {
  const h = harness(); await h.setup(); const id = await h.earning(); await h.settle(id);
  await h.withdraw(h.commission(id).commissionCents); await h.payPersonal(); await h.refund(id, 9800);
  const debt = h.personalDebt(id), originalAmount = debt.amountCents;
  await h.execute(id, 'return-start', 'success', { splitId: h.entry(id).split.id, amountCents: 490 });
  const future = await h.earning(); await h.execute(future);
  assert.equal(h.personalDebt(id).receivedCents, 0); assert.equal(h.summary(id).retainedStoreCommissionCents, 980);
  await h.execute(future, 'finish-start'); await h.advance(1);
  const offset = h.s.servicePromotionOffsets.find(x => x.recoveryId === debt.id);
  assert.equal(offset.commissionId, h.commission(future).id); assert.equal(offset.amountCents, originalAmount);
  assert.equal(offset.storeCents + offset.groupCents, originalAmount); assert.equal(h.personalDebt(id).outstandingCents, 0);
  assert.equal(h.personalDebt(id).records.length, 0); assert.equal(h.summary(id).retainedStoreCommissionCents, 0);
  assert.equal(h.summary(id).pendingReturnCents, 980);
  await h.execute(id, 'return-start', 'success', { splitId: h.entry(id).split.id, amountCents: 980 });
  assert.equal(h.summary(id).totalReturnPendingCents, 0);
});

test('C03 shared: 90-day approved loss keeps original store Cs responsibility and records no actual recovery', async () => {
  const h = harness(); await h.setup(); const id = await h.earning(); await h.settle(id);
  await h.withdraw(h.commission(id).commissionCents); await h.payPersonal(); await h.refund(id, 9800);
  const debt = h.personalDebt(id);
  await h.execute(id, 'return-start', 'success', { splitId: h.entry(id).split.id, amountCents: 490 });
  await assert.rejects(() => h.run('service-promotion.recovery-loss', { id: debt.id, amountCents: debt.amountCents, ...h.proof() }), /90天|追收期/);
  await h.at(debt.dueAt); await h.run('service-promotion.recovery-loss', { id: debt.id, amountCents: h.personalDebt(id).outstandingCents, ...h.proof() });
  assert.equal(h.personalDebt(id).status, 'loss'); assert.equal(h.personalDebt(id).receivedCents, 0);
  assert.equal(h.personalDebt(id).records[0].kind, 'loss'); assert.equal(h.personalDebt(id).records[0].storeCents, 980);
  assert.equal(h.summary(id).retainedStoreCommissionCents, 980); assert.equal(h.summary(id).pendingReturnCents, 0);
  assert.equal(servicePromotionMonthlyFacts(h.s, finance).rows.filter(x => x.kind === 'recovery-cash').length, 0);
});

test('C03 shared: a failed return with changed first eligibility preserves the old execution and has a new exact amount exit', async () => {
  const h = harness(); await h.setup(); const { first, second } = await h.pair(); await h.settle(second);
  await h.refund(second, 19800); const originalSplit = h.entry(second).split.id;
  await h.execute(second, 'return-start', 'failed', { splitId: originalSplit }); const oldReturn = structuredClone(h.entry(second).returns.at(-1));
  await h.firstRefund(first); const v = h.summary(second); assert.ok(v.pendingReturnCents > 0 && v.pendingReturnCents < oldReturn.amountCents);
  await assert.rejects(() => h.execute(second, 'return-start', 'success', { returnId: oldReturn.id, manual: true, reason: '旧失败金额不能照退' }), /变化|差额|原额|不能/);
  await h.execute(second, 'return-start', 'success', { splitId: originalSplit, amountCents: v.pendingReturnCents }); assert.equal(h.summary(second).pendingReturnCents, 0);
  assert.equal(h.entry(second).returns.find(x => x.id === oldReturn.id).amountCents, oldReturn.amountCents);
  assert.equal(h.entry(second).returns.find(x => x.id === oldReturn.id).status, 'failed');
});

test('C03 shared: original offline receipt followed by refund produces actual offline repayment, never an invented channel split/return', async () => {
  const h = harness(); await h.setup(); const id = await h.earning(), paidAt = h.b(id).payment.paidAt;
  await h.at(paidAt + 30 * DAY); const debt = h.recovery(id); assert.equal(debt.reasonCode, 'expired-unshared');
  await h.run('finance.recovery-receive', { id: debt.id, amountCents: debt.amountCents, ...h.proof() });
  const actualReceived = h.recovery(id).receivedCents; await h.refund(id, 9800);
  const v = h.summary(id), repayment = h.s.serviceFinanceRecoveries.find(x => x.entryId === h.entry(id).id && x.type === 'offline-adjustment');
  assert.equal(v.splitPaidCents, 0); assert.equal(v.pendingReturnCents, 0); assert.equal(repayment.amountCents, actualReceived - v.targetGroupCents);
  assert.equal(repayment.payer, 'group'); assert.equal(repayment.payee, 'store:xingfu');
  await assert.rejects(() => h.execute(id, 'return-start'), /线下|没有|回退/);
  await h.run('finance.recovery-receive', { id: repayment.id, amountCents: repayment.amountCents, ...h.proof() });
  assert.equal(h.summary(id).totalReturnPendingCents, 0); assert.equal(h.recovery(id).receivedCents, actualReceived);
  assert.equal(h.entry(id).returns.length, 0);
});

test('C03 shared: cross-store client ownership remains old store, H uses actual service group tier and Cs is zero', async () => {
  const h = harness(); await h.setup(); const id = await h.earning({ storeId: 'silver', techId: 'ma', regionId: 'silver' });
  const v = h.summary(id), amount = h.b(id).payment.amountCents;
  assert.equal(h.s.users.find(x => x.id === 'u1').serviceBinding.ownerStoreId, 'xingfu');
  assert.equal(v.platformCents, floor(amount, 1000)); assert.equal(v.promotionStoreCents, 0); assert.equal(v.targetGroupCents, v.platformCents);
  await h.execute(id); await h.execute(id, 'finish-start');
  assert.equal(servicePromotionView(h.s, localFinance).commissions.length, 0);
});

test('C03 shared: main and extension keep independent original paidAt, A and refund allocation', async () => {
  const h = harness(); await h.setup(); const id = await h.create(); await h.complete(id, { extension: true }); await h.advance(2881);
  const b = h.b(id), ext = b.extensions[0], main = h.summary(id), child = h.summary(id, ext.id);
  assert.equal(h.commission(id, ext.id).kind, h.commission(id).kind); assert.equal(child.paymentId, ext.id);
  assert.equal(child.forceAt, ext.paidAt + 25 * DAY); assert.equal(main.forceAt, b.payment.paidAt + 25 * DAY); assert.ok(child.forceAt > main.forceAt);
  await h.settle(id); await h.execute(id, 'split-start', 'success', { paymentId: ext.id }); await h.execute(id, 'finish-start', 'success', { paymentId: ext.id });
  const originalChild = structuredClone(h.entry(id, ext.id)); await h.refund(id, 9800);
  assert.equal(h.summary(id, ext.id).targetGroupCents, child.targetGroupCents); assert.deepEqual(h.entry(id, ext.id).split, originalChild.split);
  assert.equal(h.b(id).extensions[0].refundedCents, 0);
});

test('C03 shared: C04 combined execution preserves normal H + Cs, additional recovery is only paid to its original debt once', async () => {
  const h = harness(); await h.setup(); const cancelled = await h.create(); await h.run('booking.cancel', { id: cancelled, reason: '原预约取消不足验收' }, customer);
  const refund = h.b(cancelled).refunds.at(-1); await h.run('booking.refund-pay', { id: cancelled, refundId: refund.id, outcome: 'failed' });
  const part = h.b(cancelled).refunds.at(-1).executions[0];
  await h.run('service-extra.refund-shortage', { bookingId: cancelled, paymentId: h.b(cancelled).payment.id, refundId: refund.id, shortageCents: 10000, failedAt: part.updatedAt, sourceToken: serviceExtraSourceToken(h.s, cancelled, part.paymentId), ...h.proof(part.refundNo, part.updatedAt) }, localFinance);
  await h.advance(1440); await h.run('service-extra.policy-publish', { path: 'merchant-balance', effectiveAt: h.s.now, basis: '原C04明确Demo补余额方案' });
  const policy = h.s.serviceExtraPolicies.at(-1), shortage = h.s.serviceRefundShortages.at(-1);
  await h.run('service-extra.advance-decision', { id: shortage.id, decision: 'approve', path: 'merchant-balance', policyId: policy.id, amountCents: 10000, reason: '实际逐案决定' });
  await h.run('service-extra.advance-pay', { id: shortage.id, advanceId: h.s.serviceRefundShortages.at(-1).advances.at(-1).id, outcome: 'success', ...h.proof() });
  const debt = h.s.serviceExtraRecoveries.at(-1), future = await h.earning(), normal = h.summary(future).splitTargetCents;
  await h.run('service-extra.offset-propose', { entryId: h.entry(future).id, recoveryId: debt.id, amountCents: 2000, sourceToken: serviceExtraSourceToken(h.s, future, h.b(future).payment.id), reason: '原同店后续服务A加实际追收' });
  const plan = h.s.serviceExtraOffsets.at(-1); assert.equal(plan.normalCents, normal);
  await h.run('service-extra.offset-confirm', { id: plan.id, decision: 'accept', reason: '门店确认原A与额外债务分列' }, localFinance);
  await h.run('service-extra.offset-pay', { id: plan.id, outcome: 'processing' }); assert.equal(h.s.serviceExtraRecoveries.at(-1).receivedCents, 0);
  const execution = structuredClone(h.s.serviceExtraOffsets.at(-1).execution);
  const payload = { id: plan.id, version: h.s.serviceExtraOffsets.at(-1).version, requestId: 'C03-C04-ONE-QUERY', outcome: 'success' };
  await h.run('service-extra.offset-query', payload); await h.run('service-extra.offset-query', payload);
  assert.equal(h.entry(future).split.requestNo, execution.requestNo); assert.equal(h.entry(future).split.amountCents, normal); assert.equal(h.entry(future).split.channelTotalCents, normal + 2000);
  assert.equal(h.summary(future).splitPaidCents, normal); assert.equal(h.s.serviceExtraRecoveries.at(-1).receivedCents, 2000);
  assert.equal(h.summary(future).platformCents, floor(h.b(future).payment.amountCents, 500));
  assert.equal(h.s.goods.length, 0); assert.equal(h.s.bills.length, 0); assert.equal(h.s.recoveries.length, 0);
});

test('C03 shared: actual tech income and financial report expose the same unpaid A instead of treating finish as settlement', async () => {
  const h = harness(); await h.setup();
  await h.run('tech-income.rule-publish', { storeId: 'xingfu', serviceId: 'all', rateBps: 5000, refundPolicy: 'proportional', rounding: 'floor', effectiveAt: h.s.now, version: 0, reason: '明确本地提成验证依据，正式比例另定' });
  const { first, second } = await h.pair(); await h.settle(second);
  const income = () => h.s.techIncomeEntries.find(x => x.bookingId === second && x.paymentId === h.b(second).payment.id);
  assert.equal(income().status, 'payable'); assert.ok(income().payableCents > 0);
  await h.firstRefund(first); assert.equal(h.summary(second).canPayTech, false);
  assert.equal(income().status, 'held'); assert.equal(income().payableCents, 0);
  const report = reportView(h.s, finance, { type: 'serviceFinance', q: h.entry(second).id }), row = report.rows.find(x => x.id === h.entry(second).id), v = h.summary(second);
  assert.equal(row.platformCents, v.platformCents); assert.equal(row.promotionStoreCents, v.promotionStoreCents);
  assert.equal(row.pendingAdditionalCents, v.pendingAdditionalCents); assert.equal(row.totalReturnPendingCents, v.totalReturnPendingCents);
  assert.ok(row.pendingAdditionalCents > 0); assert.ok(!JSON.stringify(row).includes(evidenceFile.ref));
  await h.run('finance.recovery-receive', { id: h.recovery(second).id, amountCents: h.recovery(second).outstandingCents, ...h.proof() });
  assert.equal(income().status, 'payable'); assert.ok(income().payableCents > 0);
});

test('C03 shared: group month invoice separates actual platform H from Cs, or explicitly waits for cash composition evidence', async () => {
  const h = harness(); await h.setup();
  await h.run('commerce-invoice.rule-publish', { category: 'fee', version: 0, issuerName: '明确本地验证主体', issuerTaxId: '91320100000000000Y', invoiceItem: 'Demo平台服务费', effectiveAt: h.s.now, sourceFromAt: h.s.now, reason: '仅验证H与代付Cs隔离，正式税务依据另定', cycle: 'monthly', timezoneMinutes: 480, returnPolicy: 'cash-month' });
  const id = await h.earning(); await h.settle(id); const v = h.summary(id), month = new Date(h.s.now + 8 * 3600000).toISOString().slice(0, 7);
  assert.ok(v.splitPaidCents > v.platformCents);
  await h.at(Date.parse(month + '-01T00:00:00+08:00') + 32 * DAY);
  const fee = feeInvoiceSummary(h.s, 'xingfu', month);
  if (fee.blocked) assert.match(fee.blockedReason, /H|Cs|组成|代付|平台费|推广|来源|核对/);
  else { assert.equal(fee.paidCents, v.platformCents); assert.equal(fee.netCents, v.platformCents); }
});

test('C03 shared: actual evidence, strict resource/version/replay and managed role/session prevent finance bypass', async () => {
  const h = harness(); await h.setup(); const id = await h.earning(); await h.settle(id); await h.withdraw(h.commission(id).commissionCents);
  const w = h.withdrawal(), p = { id: w.id, version: w.version, requestId: 'C03-STRICT-PAY', outcome: 'success', ...h.proof('C03-STRICT-RECEIPT') }, before = structuredClone(h.s);
  assert.throws(() => reduce(h.s, finance, 'service-promotion.withdraw-pay', { ...p, evidenceVerified: true, validateEvidenceRefs: true }), /实际|核验|文件|凭证/); assert.deepEqual(h.s, before);
  assert.throws(() => reduce(h.s, { role: 'group', job: 'warehouse' }, 'service-promotion.withdraw-pay', p), /无权|岗位|财务/);
  await assert.rejects(() => h.run('service-promotion.withdraw-pay', { ...p, version: w.version - 1, requestId: 'C03-STALE-VERSION' }), /变化|版本|更新/); assert.deepEqual(h.s, before);
  await assert.rejects(() => h.run('service-promotion.withdraw-pay', p, { role: 'user', userId: 'u1' }), /无权|岗位/);
  await h.run('service-promotion.withdraw-pay', p); await h.run('service-promotion.withdraw-pay', p); assert.equal(h.withdrawal().execution.results.length, 1);
  await assert.rejects(() => h.run('service-promotion.withdraw-pay', { ...p, outcome: 'failed' }), /同一|不同内容/);
  assert.throws(() => authorizedInvoiceFile(h.s, personal, w.id, 'payment:0', evidenceFile.ref, 'service-promotion'), /无权/);
  assert.deepEqual(authorizedInvoiceFile(h.s, finance, w.id, 'payment:0', evidenceFile.ref, 'service-promotion'), evidenceFile);
  const actualWarehouse = await h.staff('warehouse');
  assert.throws(() => reduce(h.s, { ...actualWarehouse, job: 'finance' }, 'service-promotion.policy-publish', { version: 0, requestId: 'C03-FORGED', bindingDays: 365, minWithdrawCents: 1000, dailyLimit: 3, effectiveAt: h.s.now, basis: '不能冒用岗位' }), /无权/);
  const validFinance = await h.staff('finance');
  assert.ok(servicePromotionView(h.s, validFinance).withdrawals.some(x => x.id === w.id));
  await assert.rejects(() => h.run('service-promotion.disable', { id: h.promoter().id, kind: 'exit', reason: '其他门店无权停用' }, { ...manager, storeId: 'silver' }), /无权/);
});

test('C03 shared: original non-personal booking retains natural ownership, H-only split and its original successful refund facts', async () => {
  const h = harness(); await h.run('finance.rule-publish', { scope: 'global', groupBps: 1000, storeBps: 500, effectiveAt: h.s.now, version: 0, reason: '明确原自然客户分账配置' });
  const id = await h.earning(); const amount = h.b(id).payment.amountCents, v = h.summary(id);
  assert.equal(h.s.users.find(x => x.id === 'u1').serviceBinding.ownerType, 'group');
  assert.equal(v.targetGroupCents, floor(amount, 1000)); assert.equal(h.s.serviceCommissions.length, 0);
  await h.settle(id); assert.equal(h.summary(id).canPayTech, true);
  const split = structuredClone(h.entry(id).split); await h.refund(id, 9800);
  assert.equal(h.summary(id).pendingReturnCents, 980); assert.deepEqual(h.entry(id).split, split);
  await h.execute(id, 'return-start', 'success', { splitId: split.id, amountCents: 980 });
  assert.equal(h.summary(id).canPayTech, true); assert.equal(h.b(id).payment.refundedCents, 9800);
  assert.equal(h.s.serviceCommissions.length, 0); assert.equal(h.s.servicePromotionRecoveries.length, 0);
});

test('C03 shared: real unified withdrawal task returns after final query without changing the list or source', async () => {
  const h = harness(); await h.setup(); const id = await h.earning(); await h.settle(id); await h.withdraw(h.commission(id).commissionCents); await h.payPersonal('processing');
  const task = workTaskView(h.s, finance).tasks.find(x => x.category === 'service-promotion-withdrawal' && x.sourceId === h.withdrawal().id);
  assert.ok(task, 'Actual work projection must include the original withdrawal');
  const hash = '/group/tasks?category=service-promotion-withdrawal&status=active&q=' + h.withdrawal().id;
  const context = createTaskReturnContext(h.s, finance, { taskKey: task.id, listHash: hash, task, token: 'C03-RETURN' });
  assert.equal(taskNavigationTarget(h.s, finance, context, task.route), true);
  assert.equal(taskNavigationTarget(h.s, finance, context, '/group/service-promotion/withdrawals/OTHER'), false);
  await h.queryPersonal(); assert.equal(taskReturnTarget(h.s, finance, context, task.route), hash);
  assert.equal(workTaskView(h.s, finance).tasks.find(x => x.sourceId === h.withdrawal().id && x.category === 'service-promotion-withdrawal').status, 'done');
});

test('C03 shared: actual finance entry task keeps original filters through original query and completion without read mutations', async () => {
  const h = harness(); await h.setup(); const { first, second } = await h.pair(), actor = await h.staff('finance');
  const before = structuredClone(h.s), booking = structuredClone(h.b(second)), otherEntry = structuredClone(h.entry(first));
  const task = workTaskView(h.s, actor).tasks.find(x => x.category === 'service-promotion-finance-entry' && x.sourceId === h.entry(second).id);
  assert.ok(task); assert.deepEqual(task.commands, ['finance.split-start']);
  const hash = '/group/tasks?category=service-promotion-finance-entry&status=open&q=' + task.sourceId + '&owner=mine&store=xingfu';
  const context = createTaskReturnContext(h.s, actor, { taskKey: task.id, listHash: hash, task, token: 'C03-ENTRY-RETURN' });
  for (const path of [task.route, '/group/bookings/' + second, '/group/service-finance/ledger']) { assert.equal(taskNavigationTarget(h.s, actor, context, path), true); assert.equal(taskReturnTarget(h.s, actor, context, path), hash); }
  assert.equal(taskNavigationTarget(h.s, actor, context, '/group/service-finance/entry/' + h.entry(first).id), false);
  assert.equal(taskNavigationTarget(h.s, actor, context, '/group/bookings/' + first), false);
  assert.deepEqual(h.s, before);
  await h.run('finance.split-start', { id: task.sourceId, outcome: 'processing' }, actor);
  const pending = structuredClone(h.entry(second).split); assert.equal(taskNavigationTarget(h.s, actor, context, task.route), true);
  await h.run('finance.split-query', { id: task.sourceId, transactionId: pending.id, outcome: 'success' }, actor);
  await h.run('finance.finish-start', { id: task.sourceId, outcome: 'success' }, actor);
  const settled = structuredClone(h.s); assert.equal(taskReturnTarget(h.s, actor, context, task.route), hash);
  assert.equal(workTaskView(h.s, actor).tasks.find(x => x.category === task.category && x.sourceId === task.sourceId).status, 'done');
  assert.equal(h.entry(second).split.requestNo, pending.requestNo); assert.equal(h.entry(second).split.amountCents, pending.amountCents);
  assert.deepEqual(h.b(second), booking); assert.deepEqual(h.entry(first), otherEntry); assert.deepEqual(h.s, settled);
});

test('C03 shared: actual finished-adjustment recovery task returns from its original list, entry and booking after real receipt', async () => {
  const h = harness(); await h.setup(); const { first, second } = await h.pair(); await h.settle(second); await h.firstRefund(first);
  const actor = await h.staff('finance'), debt = h.recovery(second), split = structuredClone(h.entry(second).split), finish = structuredClone(h.entry(second).finish);
  assert.equal(debt.reasonCode, 'finished-adjustment');
  const before = structuredClone(h.s), task = workTaskView(h.s, actor).tasks.find(x => x.category === 'service-promotion-finance-recovery' && x.sourceId === debt.id);
  assert.ok(task); assert.deepEqual(task.commands, ['finance.recovery-receive']); assert.equal(task.route, '/group/service-finance/recoveries');
  const hash = '/group/tasks?category=service-promotion-finance-recovery&status=open&q=' + debt.id + '&owner=all&store=xingfu';
  const context = createTaskReturnContext(h.s, actor, { taskKey: task.id, listHash: hash, task, token: 'C03-DEBT-RETURN' });
  for (const path of [task.route, '/group/service-finance/entry/' + h.entry(second).id, '/group/bookings/' + second]) { assert.equal(taskNavigationTarget(h.s, actor, context, path), true); assert.equal(taskReturnTarget(h.s, actor, context, path), hash); }
  assert.equal(taskNavigationTarget(h.s, actor, context, '/group/service-finance/entry/' + h.entry(first).id), false); assert.deepEqual(h.s, before);
  await h.run('finance.recovery-receive', { id: debt.id, amountCents: debt.outstandingCents, ...h.proof('C03-TASK-ACTUAL-DEBT-RECEIPT') }, actor);
  const after = structuredClone(h.s);
  assert.equal(h.recovery(second).status, 'closed'); assert.equal(h.recovery(second).records.length, 1);
  for (const path of [task.route, '/group/service-finance/entry/' + h.entry(second).id, '/group/bookings/' + second]) assert.equal(taskReturnTarget(h.s, actor, context, path), hash);
  assert.equal(workTaskView(h.s, actor).tasks.find(x => x.category === task.category && x.sourceId === debt.id).status, 'done');
  assert.deepEqual(h.entry(second).split, split); assert.deepEqual(h.entry(second).finish, finish); assert.deepEqual(h.s, after);
  assert.ok(!JSON.stringify(context).includes(evidenceFile.ref)); assert.ok(!JSON.stringify(context).includes('13800000001'));
});

test('C03 shared: actual money task rejects crossed original source snapshots, foreign jobs and an exited managed session', async () => {
  const h = harness(); await h.setup(); const { first, second } = await h.pair(); await h.settle(second); await h.firstRefund(first);
  const actor = await h.staff('finance'), warehouse = await h.staff('warehouse'), storeActor = await h.staff('store-finance', 'xingfu');
  const task = workTaskView(h.s, actor).tasks.find(x => x.category === 'service-promotion-finance-recovery' && x.sourceId === h.recovery(second).id);
  const hash = '/group/tasks?category=service-promotion-finance-recovery&status=open&q=' + task.sourceId;
  const context = createTaskReturnContext(h.s, actor, { taskKey: task.id, listHash: hash, task, token: 'C03-STRICT-MONEY-RETURN' }), before = structuredClone(h.s);
  for (const binding of [
    { ...context.binding, entryId: h.entry(first).id }, { ...context.binding, bookingId: first },
    { ...context.binding, paymentId: h.b(first).payment.id }, { ...context.binding, sourceId: h.entry(first).id }
  ]) assert.equal(taskNavigationTarget(h.s, actor, { ...context, binding }, task.route), false);
  const mutations = [
    s => { s.bookings.find(x => x.id === second).servicePromotionSnapshot.promoter.ownerStoreId = 'silver'; },
    s => { s.bookings.find(x => x.id === second).serviceFinanceSnapshot.source.promoterId = 'OTHER-ORIGINAL-SOURCE'; }
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(h.s); mutate(changed); const snapshot = structuredClone(changed);
    assert.equal(taskNavigationTarget(changed, actor, context, task.route), false);
    const summary = serviceFinanceSummary(changed, second, h.b(second).payment.id);
    assert.equal(summary.known, false); assert.equal(summary.targetGroupCents, null);
    const debt = changed.serviceFinanceRecoveries.find(x => x.id === task.sourceId);
    const payload = { id: debt.id, version: debt.version, requestId: 'C03-CROSSED-SOURCE-CASH', amountCents: debt.outstandingCents, ...h.proof('C03-CROSSED-SOURCE-RECEIPT') };
    // Read real bytes and the exact digest to exercise the reducer's own source
    // guard even when the application preflight would reject the crossed source.
    const evidence = await readRuntimeEvidence(payload);
    assert.throws(() => reduce(changed, actor, 'finance.recovery-receive', payload, () => {}, evidence), /核|清|来源|归属|佣金/);
    assert.deepEqual(changed, snapshot);
  }
  for (const other of [warehouse, storeActor, support, personal]) { assert.equal(taskNavigationTarget(h.s, other, context, task.route), false); assert.throws(() => createTaskReturnContext(h.s, other, { taskKey: task.id, listHash: hash, task, token: 'C03-FORBIDDEN-MONEY-RETURN' })); }
  assert.deepEqual(h.s, before);
  await h.run('account.leave', {}, actor); const left = structuredClone(h.s);
  assert.equal(taskNavigationTarget(h.s, actor, context, task.route), false); assert.equal(taskReturnTarget(h.s, actor, context, task.route), null);
  assert.throws(() => createTaskReturnContext(h.s, actor, { taskKey: task.id, listHash: hash, task, token: 'C03-EXPIRED-MONEY-RETURN' }), /失效/);
  assert.deepEqual(h.s, left);
});

test('C03 shared: real credentials, assessment and group authorization enable only the newly qualified technician promoter', async () => {
  const h = harness(), oldTechIds = h.s.techs.map(x => x.id), goods = await h.goodsSentinel();
  assert.equal(h.s.servicePromoters.length, 0);
  const local = await h.staff('store-manager', 'xingfu'), operations = await h.staff('operations'), store = h.s.stores.find(x => x.id === 'xingfu');
  await h.run('manage.tech-save', { storeId: store.id, name: '共享考核合成技师', phone: '13800000099', gender: 'female', serviceIds: ['relax'], lat: store.lat, lng: store.lng, certificate: 'C03-LOCAL-CERTIFICATE', insurance: 'C03-LOCAL-INSURANCE', validUntil: '2027-10-04', reason: '本地原指令登记资料，正式审核凭证另验' }, local);
  const technician = h.s.techs.find(x => !oldTechIds.includes(x.id)), techId = technician.id;
  assert.equal(technician.reviewStatus, 'pending'); assert.equal(technician.active, false);
  assert.equal(qualificationEligibility(h.s, techId, 'relax').allowed, false);
  assert.equal(h.s.servicePromoters.length, 0);
  await h.run('manage.tech-review', { id: techId, version: technician.version, decision: 'approve', reason: '集团核实本次原证书及保单资料' }, operations);
  assert.equal(h.s.techs.find(x => x.id === techId).active, true); assert.equal(h.s.servicePromoters.length, 0);
  const qualified = () => h.s.techQualifications.find(x => x.techId === techId);
  await h.run('qualification.assess', { techId, version: 0, serviceIds: ['relax'], kind: 'initial', result: 'pass', occurredAt: h.s.now, batch: 'C03-LOCAL-ASSESSMENT', assessor: '本地考核负责人', proof: 'C03-LOCAL-ASSESSMENT-PROOF', reason: '实际原指令登记本地考核结果' }, local);
  const assessment = structuredClone(qualified().assessments[0]);
  await h.run('qualification.request', { techId, version: qualified().version, assessmentId: assessment.id, reason: '依据本次通过的考核申请独立授权' }, local);
  const grant = qualified().grants[0];
  assert.equal(grant.status, 'pending'); assert.equal(qualificationEligibility(h.s, techId, 'relax').allowed, false); assert.equal(h.s.servicePromoters.length, 0);
  const payload = { techId, version: qualified().version, requestId: 'C03-REAL-QUALIFICATION-REVIEW', grantId: grant.id, decision: 'approve', reviewer: '本地集团审核负责人', proof: 'C03-LOCAL-AUTHORIZATION-PROOF', reason: '集团核对原资料与原考核后明确授权' };
  await h.run('qualification.review', payload, operations);
  const promoter = h.s.servicePromoters.find(x => x.personKind === 'tech' && x.personId === techId);
  assert.equal(qualificationEligibility(h.s, techId, 'relax').allowed, true);
  assert.ok(promoter, 'Original approved project authorization must trigger the real automatic promoter hook');
  assert.equal(promoter.status, 'active'); assert.equal(promoter.origin, 'qualified-tech'); assert.equal(promoter.ownerStoreId, store.id);
  assert.deepEqual(promoter.eligibility, { eligible: true, techId, storeId: store.id, reference: payload.proof, verifiedAt: h.s.now, grantId: grant.id });
  assert.deepEqual(qualified().assessments[0], assessment);
  const accepted = structuredClone(h.s); await h.run('qualification.review', payload, operations);
  // Original reduce advances its session envelope for accepted qualification
  // replay; all qualification, promoter, source and money facts remain exact.
  assert.equal(h.s.revision, accepted.revision + 1); assert.deepEqual({ ...h.s, revision: accepted.revision }, accepted);
  const loaded = structuredClone(h.s); upgradeFinanceState(loaded); upgradeFinanceState(loaded);
  assert.equal(loaded.servicePromoters.filter(x => x.personKind === 'tech').length, 1);
  assert.ok(oldTechIds.every(id => !loaded.servicePromoters.some(x => x.personKind === 'tech' && x.personId === id)));
  assert.ok(oldTechIds.every(id => !loaded.techQualifications.some(x => x.techId === id)));
  h.assertGoods(goods);
});

test('C03 shared: original unknown withdrawal query enters exact personal confirmation, then final query without a second payment', async () => {
  const h=harness();await h.setup();await h.run('service-promotion.transfer-authorize',{id:h.promoter().id,enabled:false,reason:'本笔由本人逐笔确认'},personal);
  const id=await h.earning();await h.settle(id);await h.withdraw(h.commission(id).commissionCents);await h.payPersonal('processing');
  const original=structuredClone(h.withdrawal()),deadline=h.s.now+DAY;
  const payload={id:original.id,version:original.version,requestId:'C03-ORIGINAL-QUERY-CONFIRM',outcome:'awaiting_user',confirmExpiresAt:deadline,reason:'原渠道后续查询返回待本人确认'};
  await h.run('service-promotion.withdraw-query',payload);await h.run('service-promotion.withdraw-query',payload);
  let w=h.withdrawal();assert.equal(w.status,'awaiting_user');assert.equal(w.confirmExpiresAt,deadline);assert.equal(w.execution.requestNo,original.execution.requestNo);assert.equal(w.execution.id,original.execution.id);assert.equal(w.execution.attempts,1);assert.equal(w.execution.results.length,2);
  assert.equal(h.s.servicePromotionWithdrawals.length,1);assert.equal(servicePromotionView(h.s,personal).balances[0].dailyCreated,1);assert.equal(servicePromotionView(h.s,personal).commissions[0].paidCents,0);
  const before=structuredClone(h.s);await assert.rejects(()=>h.queryPersonal('success'),/本人确认/);assert.deepEqual(h.s,before);
  await assert.rejects(()=>h.run('service-promotion.withdraw-confirm',{id:w.id,decision:'accept',reason:'不是本人'},{role:'user',userId:'u1'}),/无权|本人/);assert.deepEqual(h.s,before);
  await h.run('service-promotion.withdraw-confirm',{id:w.id,decision:'accept',reason:'本人按同一原单确认'},personal);
  assert.equal(h.withdrawal().status,'processing');assert.equal(servicePromotionView(h.s,personal).commissions[0].paidCents,0);
  await h.queryPersonal('success');w=h.withdrawal();assert.equal(w.status,'paid');assert.equal(w.execution.requestNo,original.execution.requestNo);assert.equal(w.execution.attempts,1);
  assert.deepEqual(w.execution.results.at(-1).facts,w.execution.proof);
  assert.equal(authorizedInvoiceFile(h.s,finance,w.id,'result:2:0',evidenceFile.ref,'service-promotion').ref,evidenceFile.ref);
  assert.equal(servicePromotionView(h.s,personal).commissions[0].paidCents,w.amountCents);assert.equal(h.summary(id).refundedCents,0);assert.equal(h.b(id).status,'done');
  assert.equal(workTaskView(h.s,finance).tasks.find(x=>x.category==='service-promotion-withdrawal'&&x.sourceId===w.id).status,'done');
});

test('C03 shared: loading preserves original successful split identifiers and has no rule, agreement or historical promotion backfill', async () => {
  const h = harness(); await h.setup(); const id = await h.earning(); await h.settle(id);
  const saved = structuredClone(h.s), originalBooking = structuredClone(h.b(id)), originalSplit = structuredClone(h.entry(id).split);
  upgradeFinanceState(saved); const once = structuredClone(saved); upgradeFinanceState(saved); assert.deepEqual(saved, once);
  assert.deepEqual(saved.bookings.find(x => x.id === id), originalBooking);
  assert.deepEqual(saved.serviceFinanceEntries.find(x => x.bookingId === id).split, originalSplit);
  const old = seed(); upgradeFinanceState(old);
  assert.equal(old.servicePromotionRules.length, 0); assert.equal(old.servicePromotionAgreements.length, 0); assert.equal(old.serviceCommissions.length, 0);
});
