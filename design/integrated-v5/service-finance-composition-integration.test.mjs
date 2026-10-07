import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { seed, reduce, upgradeFinanceState } from './engine.mjs';
import { serviceFinanceSummary } from './service-finance.mjs';
import { serviceFinanceComposition } from './service-finance-composition.mjs';
import { prepareServicePromotionEvidence } from './service-promotion-file-validation.mjs';

const DAY = 86400000, finance = { role: 'group', job: 'finance' }, support = { role: 'group', job: 'support' }, manager = { role: 'store', job: 'store-manager', storeId: 'xingfu' };
const buyer = { role: 'user', userId: 'u1' }, person = { role: 'user', userId: 'u2' }, tech = { role: 'tech', techId: 'lin' };
const bytes = new TextEncoder().encode('%PDF-1.4\nActual local bytes for composition integration\n%%EOF'), blob = new Blob([bytes], { type: 'application/pdf' });
const file = { ref: 'invoice-file:' + createHash('sha256').update(bytes).digest('hex'), name: '现金组成原依据.pdf', type: blob.type, size: blob.size };
function harness() {
  let state = seed(), sequence = 0;
  const h = { get s() { return state; }, b: id => state.bookings.find(b => b.id === id), e: id => state.serviceFinanceEntries.find(e => e.bookingId === id), v: id => serviceFinanceSummary(state, id, h.b(id).payment.id),
    proof: (reference = 'ACTUAL-' + ++sequence) => ({ reference, occurredAt: state.now, file, reason: '实际Blob与原号核对的合成验收依据' }),
    async run(type, p = {}, actor = finance) {
      const row = ['servicePromoters', 'servicePromotionInvites', 'serviceFinanceEntries', 'serviceFinanceRecoveries'].flatMap(k => state[k] || []).find(x => x.id === (p.id || p.promoterId));
      const payload = { requestId: 'COMPOSITION-' + ++sequence, version: row?.version || 0, ...p };
      const runtime = await prepareServicePromotionEvidence(state, actor, type, payload, { readFile: async metadata => { assert.equal(metadata.ref, file.ref); return blob; } });
      state = reduce(state, actor, type, payload, () => {}, runtime); return state;
    },
    async advance(minutes) { while (minutes) { const step = Math.min(minutes, 44640); await h.run('clock.advance', { minutes: step }); minutes -= step; } },
    async setup({ hBps = 500 } = {}) {
      await h.run('finance.rule-publish', { scope: 'global', groupBps: 1000, storeBps: hBps, effectiveAt: state.now, version: 0, reason: '显式原H测试配置' });
      await h.run('service-promotion.agreement-publish', { promoterType: 'store-promoter', title: '原邀请测试协议', body: '本人核实原协议，仅验证本地命令和真实文件读取。', effectiveAt: state.now, ...h.proof() }, support);
      await h.run('service-promotion.invite', { userId: 'u2', promoterType: 'store-promoter', expiresAt: state.now + DAY, reason: '本店本人原邀请' }, manager);
      const invite = state.servicePromotionInvites.at(-1);
      await h.run('service-promotion.invite-confirm', { id: invite.id, decision: 'accept', agreementAccepted: true, agreementId: invite.agreementSnapshot.id, reason: '本人确认原协议' }, person);
      await h.run('service-promotion.identity-review', { id: state.servicePromoters.find(r => r.personKind === 'user' && r.personId === 'u2').id, decision: 'verified', ...h.proof() }, support);
      await h.run('service-promotion.rule-publish', { promoterType: 'store-promoter', firstBps: 2000, repeatBps: 1000, storeCostBps: 5000, csRounding: 'floor', concurrency: 'completed-created-id', lateFullRefund: 'reassign', effectiveAt: state.now, version: 0, basis: '显式测试佣金，不作为正式审批' });
      const promoter = state.servicePromoters.find(r => r.personKind === 'user' && r.personId === 'u2');
      await h.run('service-promotion.enter', { promoterId: promoter.id, version: state.users.find(u => u.id === 'u1').serviceBinding.version }, buyer);
    },
    async create() {
      await h.run('booking.create', { storeId: 'xingfu', serviceId: 'relax', regionId: 'home', techId: 'lin', startAt: Math.ceil((state.now + 4 * 3600000) / 1800000) * 1800000, mode: 'specified', genderPreference: 'any', contactName: '本地合成顾客', phone: '13800000001', healthConsent: true, identityVerified: true, adultConfirmed: true }, buyer);
      const id = state.bookings.at(-1).id; await h.run('booking.pay', { id, outcome: 'success' }, buyer); await h.run('booking.accept', { id }, tech); return id;
    },
    async complete(id) { await h.advance(Math.ceil((h.b(id).startAt - state.now) / 60000)); await h.run('booking.start', { id }, tech); await h.advance(h.b(id).duration); await h.run('booking.finish', { id, mode: 'normal' }, tech); await h.advance(2881); },
    async refund(id, amountCents) { await h.run('booking.special-aftersale', { id, requests: [{ paymentId: h.b(id).payment.id, amountCents }], reason: '原客服特批真实售后' }, support); const refund = h.b(id).refunds.at(-1); await h.run('booking.refund-review', { id, refundId: refund.id, decision: 'approve', reason: '原本款金额核准' }, support); await h.run('booking.refund-pay', { id, refundId: refund.id, paymentId: h.b(id).payment.id, outcome: 'success' }); },
    async execute(id, operation = 'split-start', outcome = 'success', extra = {}) { return h.run('finance.' + operation, { id: h.e(id).id, version: h.e(id).version, outcome, ...extra }); }
  }; return h;
}

test('共享reduce新split自动保存原H/Cs，未知查询和幂等重放只确认一次', async () => {
  const h = harness(); await h.setup(); const id = await h.create(); await h.complete(id); const v = h.v(id);
  await h.execute(id, 'split-start', 'processing'); const tx = h.e(id).split, original = structuredClone(tx.cashCompositionRequest);
  assert.equal(original.hCents, v.platformSplitCents); assert.equal(original.csCents, v.collectibleTargetCents - v.platformSplitCents); assert.equal(original.normalCents, tx.amountCents); assert.equal(tx.cashComposition, undefined);
  await h.refund(id, h.b(id).payment.amountCents / 2); const query = { id: h.e(id).id, version: h.e(id).version, outcome: 'success', transactionId: tx.id, requestId: 'ORIGINAL-QUERY' };
  await h.run('finance.split-query', query); const success = h.e(id).split;
  assert.deepEqual(success.cashCompositionRequest, original); assert.equal(success.cashComposition.hCents, original.hCents); assert.equal(success.cashComposition.csCents, original.csCents); assert.equal(success.cashComposition.actualAt, success.completedAt);
  const count = success.results.length; await h.run('finance.split-query', query); assert.equal(h.e(id).split.results.length, count); assert.equal(serviceFinanceComposition(h.s, h.e(id).id).hReceivedCents, original.hCents);
});
test('共享reduce首单退款只形成下一原款纯Cs补差，不重复H', async () => {
  const h = harness(); await h.setup(); const first = await h.create(); await h.complete(first); const next = await h.create(); await h.complete(next); await h.execute(next); const before = structuredClone(h.e(next).split);
  await h.refund(first, h.b(first).payment.amountCents); await h.execute(next); const added = h.e(next).split;
  assert.equal(added.cashComposition.hCents, 0); assert.equal(added.cashComposition.csCents, added.amountCents); assert.equal(added.cashComposition.basis.beforeHNetCents, before.cashComposition.hCents);
  assert.deepEqual(h.e(next).splitHistory[0].cashComposition, before.cashComposition); assert.equal(serviceFinanceComposition(h.s, h.e(next).id).hReceivedCents, before.cashComposition.hCents);
});
test('共享reduce部分混合未知仍占本源未知额', async () => {
  const h = harness(); await h.setup(); const id = await h.create(); await h.complete(id); await h.execute(id); const split = h.e(id).split;
  await h.refund(id, h.b(id).payment.amountCents / 2); await h.execute(id, 'return-start', 'processing', { splitId: split.id, splitRequestNo: split.requestNo, amountCents: 500 });
  const ret = h.e(id).returns.at(-1), balance = serviceFinanceComposition(h.s, h.e(id).id).returnSources[0];
  assert.equal(ret.cashCompositionRequest.status, 'needs-review'); assert.equal(balance.known, false); assert.equal(balance.unknownReservedCents, 500); assert.equal(balance.hRemainingCents, null);
});
test('共享reduce完整原源回退与查询自动保存客观H/Cs余额', async () => {
  const h = harness(); await h.setup(); const id = await h.create(); await h.complete(id); await h.execute(id); const split = structuredClone(h.e(id).split);
  await h.refund(id, h.b(id).payment.amountCents); await h.execute(id, 'return-start', 'processing', { splitId: split.id, splitRequestNo: split.requestNo, amountCents: split.amountCents }); const returned = h.e(id).returns.at(-1), request = structuredClone(returned.cashCompositionRequest);
  assert.equal(request.status, 'known'); assert.equal(request.hCents, split.cashComposition.hCents); assert.equal(request.csCents, split.cashComposition.csCents); assert.equal(request.allocations[0].incomeSourceId, `split:${split.id}`);
  await h.execute(id, 'return-query', 'success', { returnId: returned.id }); const success = h.e(id).returns.at(-1), projection = serviceFinanceComposition(h.s, h.e(id).id);
  assert.deepEqual(success.cashCompositionRequest, request); assert.equal(success.cashComposition.actualAt, success.completedAt); assert.equal(projection.known, true); assert.equal(projection.hNetCents, 0); assert.equal(projection.csNetCents, 0);
});
test('共享reduce旧未知无组成查询不回填，新金额原号和成功时间保持', async () => {
  const h = harness(); await h.setup(); const id = await h.create(); await h.complete(id); await h.execute(id, 'split-start', 'processing');
  // Represent a pre-feature stored transaction by removing only the new sidecar fields.
  delete h.e(id).split.cashCompositionRequest; const original = structuredClone(h.e(id).split); await h.refund(id, h.b(id).payment.amountCents / 2); await h.execute(id, 'split-query', 'success', { transactionId: original.id });
  assert.equal(h.e(id).split.cashComposition, undefined); assert.equal(h.e(id).split.cashCompositionRequest, undefined); assert.equal(h.e(id).split.amountCents, original.amountCents); assert.equal(h.e(id).split.requestNo, original.requestNo);
  const before = JSON.stringify(h.s); serviceFinanceComposition(h.s, h.e(id).id); assert.equal(JSON.stringify(h.s), before); assert.equal(serviceFinanceComposition(h.s, h.e(id).id).known, false);
});
test('共享reduce同额failed重试复用原组成，旧failed缺请求仍不补核', async () => {
  for (const legacy of [false, true]) {
    const h = harness(); await h.setup(); const id = await h.create(); await h.complete(id); await h.execute(id, 'split-start', 'failed'); const tx = h.e(id).split;
    if (legacy) delete tx.cashCompositionRequest; const request = structuredClone(tx.cashCompositionRequest), no = tx.requestNo;
    await h.execute(id, 'split-start', 'success', { manual: true, reason: '原笔已明确失败，财务沿原请求处理' }); const success = h.e(id).split;
    assert.equal(success.requestNo, no); assert.deepEqual(success.cashCompositionRequest, request);
    if (legacy) assert.equal(success.cashComposition, undefined); else { assert.equal(success.cashComposition.hCents, request.hCents); assert.equal(success.cashComposition.csCents, request.csCents); }
  }
});
test('共享reduce实际店债回款必须实读附件，H已收后分次Cs不生成H', async () => {
  const h = harness(); await h.setup({ hBps: 0 }); const id = await h.create(); await h.advance(25 * 1440); await h.execute(id); await h.execute(id, 'finish-start');
  const b = h.b(id);
  await h.run('booking.start', { id: b.id }, tech); await h.advance(b.duration); await h.run('booking.finish', { id: b.id, mode: 'normal' }, tech); await h.advance(2881);
  const debt = h.s.serviceFinanceRecoveries.find(r => r.entryId === h.e(id).id && r.type === 'unshared-release'), amount = 500;
  const payload = { id: debt.id, version: debt.version, requestId: 'NO-BYTES', amountCents: amount, ...h.proof('ACTUAL-NO-BYTES') }, before = structuredClone(h.s);
  assert.throws(() => reduce(h.s, finance, 'finance.recovery-receive', payload), /核验|文件/); assert.deepEqual(h.s, before);
  await h.run('finance.recovery-receive', { ...payload, requestId: 'WITH-BYTES' }); const record = h.s.serviceFinanceRecoveries.find(r => r.id === debt.id).records.at(-1);
  assert.equal(record.cashComposition.status, 'known'); assert.equal(record.cashComposition.hCents, 0); assert.equal(record.cashComposition.csCents, amount); assert.equal(record.cashComposition.actualAt, record.occurredAt); assert.equal(record.cashComposition.source.recordId, record.id);
  assert.equal(serviceFinanceComposition(h.s, h.e(id).id).hReceivedCents, 0);
});
test('共享升级不创建现金组成与H/Cs税务policy，真实岗位仍挡跨店写入', async () => {
  const h = harness(); await h.setup(); const id = await h.create(); await h.complete(id); const before = structuredClone(h.s);
  assert.throws(() => reduce(h.s, { role: 'store', job: 'store-finance', storeId: 'xingfu' }, 'finance.split-start', { id: h.e(id).id, version: h.e(id).version, requestId: 'OTHER-ROLE', outcome: 'success' }), /无权|仅集团/); assert.deepEqual(h.s, before);
  const old = structuredClone(h.s); delete old.serviceFinanceCompositions; const upgraded = upgradeFinanceState(old); assert.equal(upgraded.serviceFinanceCompositions, undefined); assert.equal(upgraded.serviceFinanceEntries.find(e => e.id === h.e(id).id).split, null);
});
test('共享reduce线下差额原回款源缺失保存待核，明确原record后只退本源Cs', async () => {
  for (const explicit of [false, true]) {
    const h = harness(); await h.setup({ hBps: 0 }); const id = await h.create(); await h.advance(25 * 1440); await h.execute(id); await h.execute(id, 'finish-start');
    await h.run('booking.start', { id }, tech); await h.advance(h.b(id).duration); await h.run('booking.finish', { id, mode: 'normal' }, tech); await h.advance(2881);
    const debt = h.s.serviceFinanceRecoveries.find(r => r.entryId === h.e(id).id && r.type === 'unshared-release');
    await h.run('finance.recovery-receive', { id: debt.id, amountCents: 500, ...h.proof('ACTUAL-Cs-INCOME') }); const incoming = h.s.serviceFinanceRecoveries.find(r => r.id === debt.id).records[0];
    await h.refund(id, h.b(id).payment.amountCents); const adjustment = h.s.serviceFinanceRecoveries.find(r => r.entryId === h.e(id).id && r.type === 'offline-adjustment');
    await h.run('finance.recovery-receive', { id: adjustment.id, amountCents: 500, ...h.proof('ACTUAL-Cs-RETURN'), ...(explicit ? { incomeSourceId: `recovery:${debt.id}:${incoming.id}`, incomeRequestNo: incoming.reference } : {}) });
    const outgoing = h.s.serviceFinanceRecoveries.find(r => r.id === adjustment.id).records[0]; assert.equal(outgoing.amountCents, 500); assert.equal(outgoing.cashComposition.actualAt, outgoing.occurredAt);
    if (explicit) { assert.equal(outgoing.cashComposition.status, 'known'); assert.equal(outgoing.cashComposition.hCents, 0); assert.equal(outgoing.cashComposition.csCents, 500); assert.equal(serviceFinanceComposition(h.s, h.e(id).id).csNetCents, 0); }
    else { assert.equal(outgoing.cashComposition.status, 'needs-review'); assert.match(outgoing.cashComposition.reason, /原收入|原来源/); assert.equal(serviceFinanceComposition(h.s, h.e(id).id).csNetCents, null); }
  }
});
