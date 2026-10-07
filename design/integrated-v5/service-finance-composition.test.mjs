import test from 'node:test';
import assert from 'node:assert/strict';
import { captureBookingFinance, serviceFinanceCommand, serviceFinanceSummary, syncServiceFinance, upgradeServiceFinance } from './service-finance.mjs';
import { captureTechServicePromoter, captureServicePromotion, servicePromotionCommand, syncServicePromotion, upgradeServicePromotion } from './service-promotion.mjs';
import { serviceFinanceComposition, captureServiceFinanceComposition, bindServiceFinanceComposition, serviceFinanceCompositionToken, assertServiceFinanceCompositionToken, serviceFinanceCashSource } from './service-finance-composition.mjs';
import { applyServiceRecoverySplit } from './service-finance-bridges.mjs';

const DAY = 86400000, finance = { role: 'group', job: 'finance' }, file = { ref: `invoice-file:${'a'.repeat(64)}`, name: '逐笔实际现金依据.pdf', type: 'application/pdf', size: 123 };
function fixture() {
  const s = { schema: 5, seq: 0, now: Date.parse('2026-10-01T08:00:00+08:00'), bookingRules: { maxDays: 7 },
    users: [{ id: 'buyer', serviceBinding: { status: 'unbound', origin: 'demo-initial', recordedAt: Date.parse('2026-10-01T08:00:00+08:00'), version: 0 } }],
    stores: [{ id: 'a', active: true }, { id: 'b', active: true }], services: [{ id: 'svc' }], techs: [{ id: 'tech', storeId: 'a' }], bookings: [], safety: [], logs: [] };
  let request = 0;
  const ctx = { id: prefix => prefix + ++s.seq, fail: message => { throw new Error(message); }, log: () => {}, validateEvidenceRefs: rows => JSON.stringify(rows) === JSON.stringify([file]), serviceFinanceSummary };
  upgradeServiceFinance(s); upgradeServicePromotion(s);
  serviceFinanceCommand(s, finance, 'finance.rule-publish', { requestId: 'H-rule', scope: 'global', version: 0, groupBps: 1000, storeBps: 500, effectiveAt: s.now, reason: '显式测试H规则，正式规则另验' }, ctx);
  const promoter = captureTechServicePromoter(s, 'tech', { eligible: true, techId: 'tech', storeId: 'a', reference: '正式上岗测试来源', verifiedAt: s.now }, ctx);
  servicePromotionCommand(s, finance, 'service-promotion.rule-publish', { requestId: 'C-rule', version: 0, promoterType: 'tech', firstBps: 2000, repeatBps: 1000, storeCostBps: 5000, concurrency: 'completed-created-id', lateFullRefund: 'reassign', csRounding: 'floor', effectiveAt: s.now, basis: '显式测试首单与Cs规则，非财税政策' }, ctx);
  servicePromotionCommand(s, { role: 'user', userId: 'buyer' }, 'service-promotion.enter', { requestId: 'bind', version: 0, promoterId: promoter.id }, ctx);
  const sync = () => { syncServicePromotion(s, ctx, { phase: 'booking' }); syncServiceFinance(s, ctx); syncServicePromotion(s, ctx); };
  const book = (id = 'B1') => {
    const b = { id, userId: 'buyer', storeId: 'a', serviceId: 'svc', status: 'confirmed', createdAt: s.now, completedAt: null, payment: { id: `P-${id}`, amountCents: 20000, refundedCents: 0, status: 'success', paidAt: s.now }, extensions: [], refunds: [], disputes: [] };
    captureBookingFinance(s, b, ctx); captureServicePromotion(s, b, ctx); s.bookings.push(b); sync(); return b;
  };
  const entry = b => s.serviceFinanceEntries.find(e => e.bookingId === b.id && e.paymentId === b.payment.id);
  const summary = b => serviceFinanceSummary(s, b.id, b.payment.id);
  const run = (b, type, p = {}) => serviceFinanceCommand(s, finance, `finance.${type}`, { requestId: `cash-${++request}`, id: entry(b).id, version: entry(b).version, outcome: 'success', ...p }, ctx);
  const ready = b => { b.status = 'done'; b.completedAt = s.now; sync(); s.now += 2 * DAY + 1; sync(); };
  const refund = (b, amountCents) => { b.payment.refundedCents += amountCents; b.refunds.push({ id: `RF-${++request}`, status: 'success', executions: [{ paymentId: b.payment.id, status: 'success', amountCents, completedAt: s.now }] }); sync(); };
  const split = (b, outcome = 'success') => {
    const e = entry(b), request = captureServiceFinanceComposition(s, e.id, { kind: 'split', normalCents: summary(b).pendingAdditionalCents });
    assertServiceFinanceCompositionToken(s, e.id, request.basis.sourceToken); run(b, 'split-start', { outcome });
    const bound = bindServiceFinanceComposition(s, e.id, request, `split:${e.split.id}`); e.split[outcome === 'success' ? 'cashComposition' : 'cashCompositionRequest'] = bound;
    return e.split;
  };
  const returnCash = (b, tx, amountCents, outcome = 'success') => {
    const e = entry(b), request = captureServiceFinanceComposition(s, e.id, { kind: 'return', normalCents: amountCents, incomeSourceId: `split:${tx.id}`, incomeRequestNo: tx.requestNo });
    run(b, 'return-start', { amountCents, splitId: tx.id, splitRequestNo: tx.requestNo, outcome }); const returned = e.returns.at(-1);
    returned[outcome === 'success' ? 'cashComposition' : 'cashCompositionRequest'] = bindServiceFinanceComposition(s, e.id, request, `return:${returned.id}`);
    return returned;
  };
  return { s, ctx, sync, book, entry, summary, run, ready, refund, split, returnCash };
}
function prepared() { const f = fixture(), b = f.book(); f.ready(b); return { ...f, b, e: f.entry(b) }; }
function twoReceipts() {
  const f = fixture(), first = f.book('FIRST'); f.ready(first); const b = f.book('SECOND'); f.ready(b);
  const s1 = f.split(b); assert.equal(s1.cashComposition.hCents, 1000); assert.equal(s1.cashComposition.csCents, 1000);
  f.refund(first, 20000); const s2 = f.split(b);
  return { ...f, first, b, e: f.entry(b), s1, s2 };
}
function historyRow(s, entryId, key, hCents, csCents, extra = {}) {
  const source = serviceFinanceCashSource(s, entryId, key);
  return { schema: 1, ...source, status: 'known', id: `CONF-${key}`, requestId: `CONFIRM-${key}`, version: 1, hCents, csCents, retainedCsCents: null, allocations: [], method: 'verified-history', allocationPolicySnapshot: null,
    recordedAt: s.now, by: finance, evidenceRefs: [file], reason: '逐笔核对原成功现金，不采用默认组成政策', ...extra };
}

test('原领域新首笔冻结完整前值、原目标并只记录实际成功H/Cs', () => {
  const f = prepared(), v = f.summary(f.b), before = JSON.stringify(f.s), request = captureServiceFinanceComposition(f.s, f.e.id, { kind: 'split', normalCents: v.pendingAdditionalCents });
  assert.equal(JSON.stringify(f.s), before); assert.equal(request.status, 'known'); assert.equal(request.basis.beforeSources.length, 0); assert.equal(request.basis.completeBefore, true);
  assert.equal(request.hCents, v.platformSplitCents); assert.equal(request.csCents, v.collectibleTargetCents - v.platformSplitCents);
  f.run(f.b, 'split-start'); f.e.split.cashComposition = bindServiceFinanceComposition(f.s, f.e.id, request, `split:${f.e.split.id}`);
  const projection = serviceFinanceComposition(f.s, f.e.id); assert.equal(projection.known, true); assert.equal(projection.hNetCents, 1000); assert.equal(projection.csNetCents, 2000); assert.equal(projection.rows[0].actualAt, f.e.split.completedAt);
});
test('首单重算后的真实第二笔仅填Cs，旧成功H及原号不改写', () => {
  const f = twoReceipts(), old = f.e.splitHistory.find(x => x.id === f.s1.id), projection = serviceFinanceComposition(f.s, f.e.id);
  assert.equal(f.s2.amountCents, 1000); assert.equal(f.s2.cashComposition.hCents, 0); assert.equal(f.s2.cashComposition.csCents, 1000);
  assert.equal(f.s2.cashComposition.basis.beforeHNetCents, 1000); assert.equal(f.s2.cashComposition.basis.beforeCsNetCents, 1000);
  assert.equal(old.amountCents, 2000); assert.equal(old.requestNo, f.s1.requestNo); assert.equal(old.cashComposition.hCents, 1000);
  assert.equal(projection.hReceivedCents, 1000); assert.equal(projection.csReceivedCents, 2000); assert.equal(projection.rows.length, 2);
});
test('processing只保留原请求，查询时目标已变化仍确认原分配及原query时间', () => {
  const f = prepared(), tx = f.split(f.b, 'processing'), captured = structuredClone(tx.cashCompositionRequest), at = f.s.now;
  let projection = serviceFinanceComposition(f.s, f.e.id); assert.equal(projection.known, false); assert.equal(projection.hNetCents, null); assert.equal(projection.confirmed.hReceivedCents, 0);
  f.refund(f.b, 10000); f.s.now += 123; f.run(f.b, 'split-query', { transactionId: tx.id });
  tx.cashComposition = bindServiceFinanceComposition(f.s, f.e.id, captured, `split:${tx.id}`);
  assert.equal(tx.cashComposition.hCents, 1000); assert.equal(tx.cashComposition.csCents, 2000); assert.equal(tx.cashComposition.basis.capturedAt, at); assert.equal(tx.cashComposition.actualAt, tx.completedAt);
  assert.notEqual(tx.cashComposition.hCents, f.summary(f.b).platformCents); projection = serviceFinanceComposition(f.s, f.e.id); assert.equal(projection.known, true); assert.equal(projection.hNetCents, 1000);
});
test('同额failed原重试保留组成；finish、failed与zero不制造收入', () => {
  const f = prepared(), tx = f.split(f.b, 'failed'), request = structuredClone(tx.cashCompositionRequest), before = serviceFinanceComposition(f.s, f.e.id);
  assert.equal(before.known, true); assert.equal(before.hReceivedCents, 0); assert.equal(before.rows.length, 0);
  f.s.now = tx.nextRetryAt; f.run(f.b, 'split-start'); tx.cashComposition = bindServiceFinanceComposition(f.s, f.e.id, request, `split:${tx.id}`); f.run(f.b, 'finish-start');
  const projection = serviceFinanceComposition(f.s, f.e.id); assert.equal(projection.rows.length, 1); assert.equal(projection.hReceivedCents, 1000); assert.equal(tx.requestNo, request.source.requestNo);
});
test('全退同一原收入的全部余额，H/Cs精确消耗本源', () => {
  const f = prepared(), split = f.split(f.b); f.refund(f.b, 20000); const returned = f.returnCash(f.b, split, split.amountCents);
  assert.equal(returned.cashComposition.status, 'known'); assert.deepEqual(returned.cashComposition.allocations, [{ incomeSourceId: `split:${split.id}`, incomeRequestNo: split.requestNo, hCents: 1000, csCents: 2000 }]);
  const projection = serviceFinanceComposition(f.s, f.e.id); assert.equal(projection.known, true); assert.equal(projection.hReturnedCents, 1000); assert.equal(projection.csReturnedCents, 2000); assert.equal(projection.hNetCents, 0); assert.equal(projection.csNetCents, 0);
});
test('部分混合回退保持needs-review，不默认比例或H/Cs先后', () => {
  const f = prepared(), split = f.split(f.b); f.refund(f.b, 10000);
  const request = captureServiceFinanceComposition(f.s, f.e.id, { kind: 'return', normalCents: 500, incomeSourceId: `split:${split.id}`, incomeRequestNo: split.requestNo });
  assert.equal(request.status, 'needs-review'); assert.equal(request.hCents, null); assert.equal(request.csCents, null); assert.match(request.reason, /多种/);
  f.returnCash(f.b, split, 500); const projection = serviceFinanceComposition(f.s, f.e.id); assert.equal(projection.hNetCents, null); assert.equal(projection.confirmed.hReturnedCents, 0); assert.match(projection.reason, /尚无已核/);
});
test('多笔原收入退回只消耗指定纯Cs补差，不侵占首笔', () => {
  const f = twoReceipts(); f.refund(f.b, 20000); f.returnCash(f.b, f.s2, 1000);
  let projection = serviceFinanceComposition(f.s, f.e.id); const first = projection.returnSources.find(r => r.incomeSourceId === `split:${f.s1.id}`), second = projection.returnSources.find(r => r.incomeSourceId === `split:${f.s2.id}`);
  assert.equal(first.hRemainingCents, 1000); assert.equal(first.csRemainingCents, 1000); assert.equal(second.hRemainingCents, 0); assert.equal(second.csRemainingCents, 0);
  f.returnCash(f.b, f.s1, 2000); projection = serviceFinanceComposition(f.s, f.e.id); assert.equal(projection.known, true); assert.equal(projection.hNetCents, 0); assert.equal(projection.csNetCents, 0);
});
test('已知未知回退组成占原源，结果未知时完整合计为空', () => {
  const f = prepared(), split = f.split(f.b); f.refund(f.b, 20000); const returned = f.returnCash(f.b, split, 3000, 'processing');
  const projection = serviceFinanceComposition(f.s, f.e.id), balance = projection.returnSources[0]; assert.equal(projection.known, false); assert.equal(projection.confirmed.hReturnedCents, 0); assert.equal(projection.reservations.length, 1);
  assert.equal(balance.hReservedCents, 1000); assert.equal(balance.csReservedCents, 2000); assert.equal(balance.hRemainingCents, 0); assert.equal(balance.csRemainingCents, 0);
  const request = structuredClone(returned.cashCompositionRequest); f.s.now += 1; f.run(f.b, 'return-query', { returnId: returned.id }); returned.cashComposition = bindServiceFinanceComposition(f.s, f.e.id, request, `return:${returned.id}`);
  assert.equal(serviceFinanceComposition(f.s, f.e.id).hReturnedCents, 1000);
});
test('缺组成的未知占额不默作零，来源余额不可用于新退', () => {
  const f = prepared(), split = f.split(f.b); f.refund(f.b, 20000); const returned = f.returnCash(f.b, split, 3000, 'processing'); delete returned.cashCompositionRequest;
  const projection = serviceFinanceComposition(f.s, f.e.id); assert.equal(projection.returnSources[0].known, false); assert.equal(projection.returnSources[0].unknownReservedCents, 3000); assert.equal(projection.returnSources[0].hRemainingCents, null);
  assert.equal(captureServiceFinanceComposition(f.s, f.e.id, { kind: 'return', normalCents: 1, incomeSourceId: `split:${split.id}`, incomeRequestNo: split.requestNo }).status, 'needs-review');
});
test('部分混合未知回退保留空allocation请求时仍锁原源未知占额', () => {
  const f = prepared(), split = f.split(f.b); f.refund(f.b, 10000); const returned = f.returnCash(f.b, split, 500, 'processing');
  assert.equal(returned.cashCompositionRequest.status, 'needs-review'); assert.deepEqual(returned.cashCompositionRequest.allocations, []);
  const projection = serviceFinanceComposition(f.s, f.e.id), balance = projection.returnSources[0];
  assert.equal(balance.known, false); assert.equal(balance.unknownReservedCents, 500); assert.equal(balance.hRemainingCents, null); assert.equal(balance.csRemainingCents, null);
});
test('旧成功缺组成不能因已核rows为空或旧basis目标倒套成首笔', () => {
  const f = prepared(); f.run(f.b, 'split-start'); const tx = f.e.split; delete tx.cashComposition; delete tx.cashCompositionRequest; const json = JSON.stringify(f.s), originalBasis = structuredClone(tx.basisSnapshot); f.e.split.basisSnapshot = { platformCents: 1000, collectibleTargetCents: 3000 };
  const request = captureServiceFinanceComposition(f.s, f.e.id, { kind: 'split', normalCents: 1000 }); assert.equal(request.status, 'needs-review'); assert.equal(request.basis.completeBefore, false); assert.equal(request.basis.beforeHNetCents, null); assert.deepEqual(request.basis.unresolvedSourceIds, [`split:${tx.id}`]);
  f.s.now += 1; const later = captureServiceFinanceComposition(f.s, f.e.id, { kind: 'split', normalCents: tx.amountCents }); assert.throws(() => bindServiceFinanceComposition(f.s, f.e.id, later, `split:${tx.id}`), /倒套/);
  f.e.split.basisSnapshot = originalBasis; assert.equal(JSON.stringify({ ...f.s, now: f.s.now - 1 }), json);
});
test('原技术号、原金额、实际时间或同id冲突都拒核，不静默累计', () => {
  for (const mutate of [f => { f.e.split.requestNo = 'wrong-number'; }, f => { f.e.split.amountCents += 1; }, f => { f.e.split.completedAt += 1; }, f => { f.e.splitHistory.push({ ...structuredClone(f.e.split), amountCents: 7 }); }]) {
    const f = prepared(); f.split(f.b); mutate(f); const projection = serviceFinanceComposition(f.s, f.e.id); assert.equal(projection.known, false); assert.equal(projection.hNetCents, null);
  }
});
test('同一processing原编号的请求组成冲突不会依数组顺序默选占额', () => {
  const f = prepared(), split = f.split(f.b, 'processing'), duplicate = structuredClone(split); duplicate.cashCompositionRequest.hCents = 999; duplicate.cashCompositionRequest.csCents = 2001; f.e.splitHistory.push(duplicate);
  const projection = serviceFinanceComposition(f.s, f.e.id); assert.equal(projection.known, false); assert.match(projection.reason, /冲突/); assert.equal(projection.hReceivedCents, null);
});
test('错主款、加钟、门店、组成请求或原收入请求号不能跨源绑定', () => {
  const f = prepared(), request = captureServiceFinanceComposition(f.s, f.e.id, { kind: 'split', normalCents: 3000 }); f.run(f.b, 'split-start');
  for (const source of [{ kind: 'split', sourceId: f.e.split.id, requestNo: 'wrong' }, { kind: 'split', sourceId: f.e.split.id, storeId: 'b' }, { kind: 'split', sourceId: f.e.split.id, paymentId: 'extension' }]) assert.throws(() => bindServiceFinanceComposition(f.s, f.e.id, request, source), /来源|技术号/);
  const changed = structuredClone(request); changed.hCents++; assert.throws(() => bindServiceFinanceComposition(f.s, f.e.id, changed, `split:${f.e.split.id}`), /被修改/);
  for (const source of [null, undefined, 0, {}, [], { kind: 'split' }]) assert.throws(() => bindServiceFinanceComposition(f.s, f.e.id, request, source), error => error instanceof Error && !(error instanceof TypeError) && /来源参数/.test(error.message));
  f.e.split.cashComposition = bindServiceFinanceComposition(f.s, f.e.id, request, `split:${f.e.split.id}`); f.e.kind = 'extension'; assert.equal(serviceFinanceComposition(f.s, f.e.id).known, false);
});
test('原cash token拒绝捕获到提交间的组成占额、版本及原target变化', () => {
  const f = prepared(), token = serviceFinanceCompositionToken(f.s, f.e.id); assert.equal(assertServiceFinanceCompositionToken(f.s, f.e.id, token), true);
  f.e.version++; assert.throws(() => assertServiceFinanceCompositionToken(f.s, f.e.id, token), /变化/); f.e.version--;
  f.b.payment.refundedCents = 1; assert.throws(() => assertServiceFinanceCompositionToken(f.s, f.e.id, token), /变化/);
});
test('独立历史核定精确逐笔恢复，缺审批依据/附件/原时间则待核', () => {
  const f = prepared(); f.run(f.b, 'split-start'); delete f.e.split.cashComposition; delete f.e.split.cashCompositionRequest; const key = `split:${f.e.split.id}`, row = historyRow(f.s, f.e.id, key, 1000, 2000); f.s.serviceFinanceCompositions = [row];
  assert.equal(serviceFinanceComposition(f.s, f.e.id).known, true); assert.equal(serviceFinanceComposition(f.s, f.e.id).hNetCents, 1000);
  for (const mutate of [r => { r.by.job = 'operations'; }, r => { r.evidenceRefs = []; }, r => { r.actualAt++; }, r => { r.normalCents++; }, r => { r.method = 'approved-allocation'; }]) {
    f.s.serviceFinanceCompositions = [structuredClone(row)]; mutate(f.s.serviceFinanceCompositions[0]); assert.equal(serviceFinanceComposition(f.s, f.e.id).known, false);
  }
});
test('历史同源冲突与重复提交标识保留needs-review，不覆写成功款', () => {
  const f = prepared(); f.run(f.b, 'split-start'); delete f.e.split.cashComposition; delete f.e.split.cashCompositionRequest; const key = `split:${f.e.split.id}`, row = historyRow(f.s, f.e.id, key, 1000, 2000), tx = JSON.stringify(f.e.split);
  f.s.serviceFinanceCompositions = [row, { ...structuredClone(row), id: 'OTHER', requestId: 'different', hCents: 999, csCents: 2001 }]; assert.match(serviceFinanceComposition(f.s, f.e.id).reason, /冲突/);
  f.s.serviceFinanceCompositions = [row, { ...structuredClone(row), id: 'OTHER' }]; assert.match(serviceFinanceComposition(f.s, f.e.id).reason, /重复/); assert.equal(JSON.stringify(f.e.split), tx);
});
test('实际店债分次回款只计各record，未收债额及完成无现金', () => {
  const f = prepared(); f.s.now = f.e.paidAt + 30 * DAY; f.sync(); const debt = f.s.serviceFinanceRecoveries.find(r => r.entryId === f.e.id && r.type === 'unshared-release');
  assert.equal(serviceFinanceComposition(f.s, f.e.id).hReceivedCents, 0); assert.equal(debt.amountCents, 3000);
  const mixed = captureServiceFinanceComposition(f.s, f.e.id, { kind: 'recovery', direction: 'income', normalCents: 500 }); assert.equal(mixed.status, 'needs-review');
  const request = captureServiceFinanceComposition(f.s, f.e.id, { kind: 'recovery', direction: 'income', normalCents: 3000 });
  serviceFinanceCommand(f.s, finance, 'finance.recovery-receive', { requestId: 'bank-receipt', id: debt.id, version: debt.version, amountCents: 3000, reference: 'ACTUAL-BANK-RECEIPT', occurredAt: f.s.now, reason: '实际全额回款已核', evidenceRefs: [file] }, f.ctx);
  const record = debt.records[0]; record.cashComposition = bindServiceFinanceComposition(f.s, f.e.id, request, `recovery:${debt.id}:${record.id}`);
  assert.equal(serviceFinanceComposition(f.s, f.e.id).hReceivedCents, 1000); assert.equal(serviceFinanceComposition(f.s, f.e.id).csReceivedCents, 2000);
  record.occurredAt++; assert.equal(serviceFinanceComposition(f.s, f.e.id).known, false);
});
test('C04本金与正常H/Cs分列且不额外计费，渠道总额不一致拒核', () => {
  const f = prepared(), request = captureServiceFinanceComposition(f.s, f.e.id, { kind: 'split', normalCents: 3000 });
  const debt = { id: 'ORIGINAL-ADVANCE-DEBT', storeId: 'a', payer: 'store:a', payee: 'group', amountCents: 1000, receivedCents: 0, createdAt: f.b.createdAt - 1 };
  const execution = { id: 'ACTUAL-C04-SPLIT', requestNo: 'ORIGINAL-C04-REQUEST', status: 'success', normalCents: 3000, recoveryCents: 1000, totalCents: 4000, attempts: 1, results: [{ at: f.s.now, outcome: 'success' }] };
  const plan = { id: 'ORIGINAL-C04-PLAN', entryId: f.e.id, storeId: 'a', recoveryId: debt.id, normalCents: 3000, recoveryCents: 1000, createdAt: f.s.now, execution };
  f.s.serviceExtraRecoveries = [debt]; f.s.serviceExtraOffsets = [plan];
  applyServiceRecoverySplit(f.s, { entryId: f.e.id, planId: plan.id, transactionId: execution.id, requestNo: execution.requestNo, normalCents: 3000, recoveryCents: 1000, totalCents: 4000, status: 'success', attempts: 1, completedAt: f.s.now, results: execution.results }, finance, f.ctx);
  f.e.split.cashComposition = bindServiceFinanceComposition(f.s, f.e.id, request, `split:${f.e.split.id}`);
  const projection = serviceFinanceComposition(f.s, f.e.id); assert.equal(projection.known, true); assert.equal(projection.hReceivedCents, 1000); assert.equal(projection.csReceivedCents, 2000); assert.equal(projection.principalRows[0].amountCents, 1000);
  f.e.split.channelTotalCents = 4001; assert.equal(serviceFinanceComposition(f.s, f.e.id).known, false);
});
test('C04正常份额零而仅有本金，H/Cs不补造且不因缺正常组成冻结', () => {
  const f = prepared(); f.e.split = { id: 'PRINCIPAL-ONLY', requestNo: 'PRINCIPAL-ONLY-NO', kind: 'split', amountCents: 0, channelTotalCents: 1000, recoveryCents: 1000, serviceExtraPlanId: 'ORIGINAL-PRINCIPAL-PLAN', status: 'success', createdAt: f.s.now, completedAt: f.s.now };
  f.e.splitHistory.push(structuredClone(f.e.split)); const projection = serviceFinanceComposition(f.s, f.e.id);
  assert.equal(projection.known, true); assert.equal(projection.hReceivedCents, 0); assert.equal(projection.csReceivedCents, 0); assert.equal(projection.rows.length, 0); assert.equal(projection.principalRows.length, 1); assert.equal(projection.principalRows[0].amountCents, 1000);
});
test('25日原H先收，完成后同债分次纯Cs实际回款不再生成H', () => {
  const f = fixture(), b = f.book(), e = f.entry(b); f.s.now = e.paidAt + 25 * DAY; f.sync();
  assert.equal(f.summary(b).pendingAdditionalCents, 1000); const split = f.split(b); assert.equal(split.cashComposition.hCents, 1000); assert.equal(split.cashComposition.csCents, 0);
  b.status = 'done'; b.completedAt = f.s.now; f.s.now = e.paidAt + 30 * DAY; f.sync(); const debt = f.s.serviceFinanceRecoveries.find(r => r.entryId === e.id && r.type === 'unshared-release');
  assert.equal(debt.amountCents, 2000);
  for (const amountCents of [500, 1500]) {
    const request = captureServiceFinanceComposition(f.s, e.id, { kind: 'recovery', direction: 'income', normalCents: amountCents }); assert.equal(request.status, 'known'); assert.equal(request.hCents, 0); assert.equal(request.csCents, amountCents);
    serviceFinanceCommand(f.s, finance, 'finance.recovery-receive', { requestId: `pure-Cs-${amountCents}`, id: debt.id, version: debt.version, amountCents, reference: `ACTUAL-Cs-${amountCents}`, occurredAt: f.s.now, evidenceRefs: [file], reason: '实际店债本次纯Cs已核' }, f.ctx);
    const record = debt.records.at(-1); record.cashComposition = bindServiceFinanceComposition(f.s, e.id, request, `recovery:${debt.id}:${record.id}`); f.s.now += 1;
  }
  const projection = serviceFinanceComposition(f.s, e.id); assert.equal(projection.hReceivedCents, 1000); assert.equal(projection.csReceivedCents, 2000); assert.equal(projection.rows.length, 3);
});
test('线下实际代退与渠道回退共同占精确同原收入H/Cs余额', () => {
  const f = prepared(), split = f.split(f.b); f.refund(f.b, 20000); f.run(f.b, 'return-start', { amountCents: 3000, splitId: split.id, splitRequestNo: split.requestNo, outcome: 'failed' });
  const debt = f.s.serviceFinanceRecoveries.find(r => r.entryId === f.e.id && r.type === 'return-failed'), request = captureServiceFinanceComposition(f.s, f.e.id, { kind: 'recovery', direction: 'return', normalCents: 3000, incomeSourceId: `split:${split.id}`, incomeRequestNo: split.requestNo });
  serviceFinanceCommand(f.s, finance, 'finance.recovery-receive', { requestId: 'offline-original-source', id: debt.id, version: debt.version, amountCents: 3000, reference: 'ACTUAL-OFFLINE-RETURN', occurredAt: f.s.now, reason: '原渠道明确失败后实际代退', evidenceRefs: [file], splitId: split.id }, f.ctx);
  const record = debt.records.at(-1); record.cashComposition = bindServiceFinanceComposition(f.s, f.e.id, request, `recovery:${debt.id}:${record.id}`);
  const projection = serviceFinanceComposition(f.s, f.e.id); assert.equal(projection.known, true); assert.equal(projection.hReturnedCents, 1000); assert.equal(projection.csReturnedCents, 2000); assert.equal(projection.returnSources[0].hRemainingCents, 0);
  const bad = structuredClone(record.cashComposition); bad.allocations[0].incomeRequestNo = 'other-original-number'; f.s.serviceFinanceCompositions = [{ ...bad, id: 'CONF-BAD', requestId: 'CONF-BAD', version: 1, method: 'verified-history', by: finance, recordedAt: f.s.now, reason: '非法换原源', evidenceRefs: [file] }];
  assert.equal(serviceFinanceComposition(f.s, f.e.id).known, false);
});
test('已核部分历史回退不能超过指定原笔，审批不绕过源余额', () => {
  const f = prepared(), split = f.split(f.b); f.refund(f.b, 10000); const returned = f.returnCash(f.b, split, 500); delete returned.cashComposition;
  const key = `return:${returned.id}`, row = historyRow(f.s, f.e.id, key, 200, 300, { method: 'approved-allocation', allocationPolicySnapshot: { id: 'ACTUAL-REVIEW', version: 1, mode: 'per-source-approved', basis: '本次原源逐笔实际分类核定' }, allocations: [{ incomeSourceId: `split:${split.id}`, incomeRequestNo: split.requestNo, hCents: 200, csCents: 300 }] });
  f.s.serviceFinanceCompositions = [row]; assert.equal(serviceFinanceComposition(f.s, f.e.id).known, true); assert.equal(serviceFinanceComposition(f.s, f.e.id).hReturnedCents, 200);
  f.e.returns.push({ ...structuredClone(returned), id: 'OTHER-RETURN', requestNo: 'OTHER-RETURN-NO', amountCents: 1000, completedAt: f.s.now });
  const overflow = historyRow(f.s, f.e.id, 'return:OTHER-RETURN', 1000, 0, { allocations: [{ incomeSourceId: `split:${split.id}`, incomeRequestNo: split.requestNo, hCents: 1000, csCents: 0 }] }); f.s.serviceFinanceCompositions.push(overflow);
  const projection = serviceFinanceComposition(f.s, f.e.id); assert.equal(projection.known, false); assert.match(projection.reason, /超过/); assert.equal(projection.hReturnedCents, null);
});
test('线下差额退回不能借用渠道split组成，缺项allocations保持待核', () => {
  const f = prepared(), split = f.split(f.b), debt = { id: 'OLD-INCOMING-DEBT', entryId: f.e.id, bookingId: f.b.id, paymentId: f.b.payment.id, storeId: 'a', type: 'unshared-release', payer: 'store:a', payee: 'group', receivedCents: 1000, createdAt: f.b.createdAt, records: [{ id: 'OLD-INCOMING-RECORD', requestId: 'old-income', amountCents: 1000, reference: 'ACTUAL-OLD-RECEIPT', occurredAt: f.s.now, recordedAt: f.s.now }] };
  const adjustment = { ...structuredClone(debt), id: 'OLD-OUTGOING-DEBT', type: 'offline-adjustment', payer: 'group', payee: 'store:a', receivedCents: 500, records: [{ id: 'OLD-OUTGOING-RECORD', requestId: 'old-return', amountCents: 500, reference: 'ACTUAL-OLD-RETURN', occurredAt: f.s.now, recordedAt: f.s.now }] };
  f.s.serviceFinanceRecoveries = [debt, adjustment];
  const incoming = historyRow(f.s, f.e.id, `recovery:${debt.id}:${debt.records[0].id}`, 0, 1000);
  const outgoing = historyRow(f.s, f.e.id, `recovery:${adjustment.id}:${adjustment.records[0].id}`, 500, 0, { allocations: [{ incomeSourceId: `split:${split.id}`, incomeRequestNo: split.requestNo, hCents: 500, csCents: 0 }] });
  f.s.serviceFinanceCompositions = [incoming, outgoing]; assert.equal(serviceFinanceComposition(f.s, f.e.id).known, false); assert.match(serviceFinanceComposition(f.s, f.e.id).reason, /实际店债回款/);
  const correct = { ...structuredClone(outgoing), hCents: 0, csCents: 500, allocations: [{ incomeSourceId: `recovery:${debt.id}:${debt.records[0].id}`, incomeRequestNo: debt.records[0].reference, hCents: 0, csCents: 500 }] };
  f.s.serviceFinanceCompositions = [incoming, correct]; assert.equal(serviceFinanceComposition(f.s, f.e.id).known, true); assert.equal(serviceFinanceComposition(f.s, f.e.id).csReturnedCents, 500);
  for (const allocations of [{}, [null], ['invalid']]) { f.s.serviceFinanceCompositions = [incoming, { ...structuredClone(correct), allocations }]; assert.doesNotThrow(() => serviceFinanceComposition(f.s, f.e.id)); assert.equal(serviceFinanceComposition(f.s, f.e.id).known, false); }
});
test('完整原源全退依客观组成，不为当前目标差额改写正常H/Cs', () => {
  const f = fixture(), b = f.book(), e = f.entry(b); f.s.now = e.paidAt + 25 * DAY; f.sync(); const split = f.split(b);
  b.status = 'done'; b.completedAt = f.s.now; f.s.now = e.paidAt + 30 * DAY; f.sync(); const debt = f.s.serviceFinanceRecoveries.find(r => r.entryId === e.id && r.type === 'unshared-release');
  const request = captureServiceFinanceComposition(f.s, e.id, { kind: 'recovery', direction: 'income', normalCents: 2000 });
  serviceFinanceCommand(f.s, finance, 'finance.recovery-receive', { requestId: 'actual-C-s', id: debt.id, version: debt.version, amountCents: 2000, reference: 'ACTUAL-Cs-BANK', occurredAt: f.s.now, evidenceRefs: [file], reason: '原店债纯Cs回款' }, f.ctx);
  const record = debt.records[0]; record.cashComposition = bindServiceFinanceComposition(f.s, e.id, request, `recovery:${debt.id}:${record.id}`); f.refund(b, 10000);
  assert.equal(f.summary(b).platformCents, 500); assert.equal(f.summary(b).pendingReturnCents, 1000); const returned = f.returnCash(b, split, 1000);
  assert.equal(returned.cashComposition.hCents, 1000); assert.equal(returned.cashComposition.csCents, 0); assert.equal(returned.cashComposition.basis.targetH, 500);
  const projection = serviceFinanceComposition(f.s, e.id); assert.equal(projection.known, true); assert.equal(projection.hNetCents, 0); assert.equal(projection.csNetCents, 2000);
  const next = captureServiceFinanceComposition(f.s, e.id, { kind: 'recovery', direction: 'income', normalCents: 100 }); assert.equal(next.status, 'needs-review'); assert.match(next.reason, /反向/);
});
test('H/Cs混合反向目标变化保留待核，不塞负H或以最新target改旧现金', () => {
  const f = twoReceipts(); f.refund(f.b, 10000);
  const request = captureServiceFinanceComposition(f.s, f.e.id, { kind: 'split', normalCents: 100 }); assert.equal(request.status, 'needs-review'); assert.match(request.reason, /反向/);
  const projection = serviceFinanceComposition(f.s, f.e.id); assert.equal(projection.hReceivedCents, 1000); assert.equal(projection.csReceivedCents, 2000);
});
test('重复读取/捕获/绑定无state写入，返回行修改也不污染原来源', () => {
  const f = prepared(), request = captureServiceFinanceComposition(f.s, f.e.id, { kind: 'split', normalCents: 3000 }); f.run(f.b, 'split-start'); const before = JSON.stringify(f.s);
  const bound = bindServiceFinanceComposition(f.s, f.e.id, request, `split:${f.e.split.id}`); bound.hCents = 9; assert.equal(JSON.stringify(f.s), before);
  f.e.split.cashComposition = bindServiceFinanceComposition(f.s, f.e.id, request, `split:${f.e.split.id}`); const json = JSON.stringify(f.s), projection = serviceFinanceComposition(f.s, f.e.id);
  projection.rows[0].source.storeId = 'wrong'; projection.returnSources[0].hCents = 0; captureServiceFinanceComposition(f.s, f.e.id, { kind: 'recovery', direction: 'income', normalCents: 1 }); serviceFinanceCompositionToken(f.s, f.e.id);
  assert.equal(JSON.stringify(f.s), json); assert.equal(serviceFinanceComposition(f.s, f.e.id).rows[0].source.storeId, 'a');
});
