import test from 'node:test';
import assert from 'node:assert/strict';
import { upgradeTechIncome, captureTechIncome, syncTechIncome, techIncomeCommand, techIncomeView, previewTechIncome } from './tech-income.mjs';
import { captureBookingFinance, syncServiceFinance, serviceFinanceCommand, serviceFinanceSummary } from './service-finance.mjs';

const NOW = Date.parse('2026-10-03T10:00:00+08:00');
const finance = { role: 'group', job: 'finance' }, store = { role: 'store', storeId: 's1' };
function fixture() {
  let s = { schema: 5, seq: 0, now: NOW, users: [{ id: 'u1', serviceBinding: { status: 'unbound', recordedAt: NOW } }], stores: [{ id: 's1' }, { id: 's2' }], services: [{ id: 'relax' }, { id: 'care' }], techs: [{ id: 't1', storeId: 's1' }, { id: 't2', storeId: 's1' }], bookings: [], logs: [] };
  upgradeTechIncome(s);
  let requests = 0;
  const ctx = state => ({ id: prefix => prefix + ++state.seq, fail: msg => { throw new Error(msg); }, log: (entity, msg) => state.logs.push({ id: entity.id, msg, at: state.now }) });
  const run = (type, payload = {}, actor = finance) => { const next = structuredClone(s); const result = techIncomeCommand(next, actor, type, { requestId: `R${++requests}`, ...payload }, ctx(next)); s = next; return result; };
  const runFinance = (type, payload) => { const next = structuredClone(s); const result = serviceFinanceCommand(next, finance, type, { requestId: `F${++requests}`, ...payload }, ctx(next)); s = next; return result; };
  return {
    get s() { return s; }, get b() { return s.bookings.at(-1); }, get e() { return s.techIncomeEntries.at(-1); }, run,
    sync() { syncTechIncome(s, ctx(s)); },
    capture(b = this.b) { return captureTechIncome(s, b, ctx(s)); },
    rule(extra = {}) { return run('tech-income.rule-publish', { storeId: 's1', serviceId: 'all', version: 0, rateBps: 4000, refundPolicy: 'proportional', rounding: 'floor', effectiveAt: s.now, reason: '财务明确发布本轮演示参数', ...extra }); },
    booking(extra = {}) { const id = `B${s.bookings.length + 1}`; s.bookings.push({ id, userId: 'u1', storeId: 's1', serviceId: 'relax', techId: 't1', status: 'confirmed', startedAt: s.now, completedAt: null, payment: { id: `P-${id}`, status: 'success', paidAt: s.now, amountCents: 29800, refundedCents: 0 }, extensions: [], refunds: [], disputes: [], ...extra }); if (s.serviceFinanceRules?.length) captureBookingFinance(s, this.b, ctx(s)); return this.b; },
    finish() { this.b.status = 'done'; this.b.completedAt = s.now; this.sync(); },
    refund(cents) { this.b.payment.refundedCents = cents; this.sync(); },
    financeRules() { runFinance('finance.rule-publish', { scope: 'global', groupBps: 1000, storeBps: 500, effectiveAt: s.now, version: 0, reason: '显式发布演示分账依据' }); },
    settle() {
      s.now = Math.max(s.now, this.b.completedAt + 2 * 86400000); syncServiceFinance(s, ctx(s));
      let entry = serviceFinanceSummary(s, this.b, this.b.payment.id);
      if (entry.canSplit) runFinance('finance.split-start', { id: entry.id, version: entry.version, outcome: 'success' });
      entry = serviceFinanceSummary(s, this.b, this.b.payment.id);
      if (entry.canFinish) runFinance('finance.finish-start', { id: entry.id, version: entry.version, outcome: 'success' });
      assert.equal(serviceFinanceSummary(s, this.b, this.b.payment.id).canPayTech, true); this.sync();
    },
    payout(extra = {}, actor = store) { return run('tech-income.payout', { techId: this.e.techId, month: this.e.month, lines: [{ entryId: this.e.id, version: this.e.version }], paidAt: s.now, proof: 'BANK-DEMO', reason: '已实际线下转账，登记凭证', ...extra }, actor); }
  };
}

test('K03 规则初空且升级不替旧订单补接单快照', () => {
  const f = fixture(); f.booking(); f.finish();
  assert.equal(f.s.techIncomeRules.length, 0); assert.equal(f.e.amountCents, null); assert.equal(f.e.status, 'pending');
  assert.match(f.e.reason, /历史订单缺少/); assert.equal(f.b.techIncomeSnapshot, undefined);
  f.rule(); f.sync(); assert.equal(f.e.amountCents, null); assert.equal(f.b.techIncomeSnapshot, undefined);
  assert.equal(f.s.techIncomeEntries.length, 1);
});

test('K03 显式规则必填比例、退款处理、取整及生效依据，权限版本和永久请求幂等', () => {
  for (const extra of [{ rateBps: '' }, { rateBps: 10001 }, { refundPolicy: '' }, { rounding: '' }, { effectiveAt: NOW - 1 }, { effectiveAt: '2026-02-30T10:00' }, { effectiveAt: '2026-11-01T24:00' }, { reason: '' }, { storeId: 'missing' }, { serviceId: 'missing' }]) assert.throws(() => fixture().rule(extra));
  const f = fixture();
  const p = { storeId: 's1', serviceId: 'all', version: 0, rateBps: 0, refundPolicy: 'unchanged', rounding: 'round', effectiveAt: '2026-10-03T10:00', reason: '明确配置零比例', requestId: 'rule-once' };
  for (const actor of [store, { role: 'manager', storeId: 's1' }, { role: 'group', job: 'support' }, { role: 'tech', techId: 't1' }]) assert.throws(() => f.run('tech-income.rule-publish', p, actor), /仅集团/);
  const first = f.run('tech-income.rule-publish', p); f.run('tech-income.rule-publish', p);
  assert.equal(f.s.techIncomeRules.length, 1); assert.equal(first.rateBps, 0); assert.equal(first.effectiveAt, NOW);
  assert.throws(() => f.run('tech-income.rule-publish', { ...p, rateBps: 2000 }), /同一提交标识/);
  assert.throws(() => f.rule({ version: 0 }), /记录已更新/);
  f.rule({ version: 1 }); assert.equal(f.s.techIncomeRules[1].version, 2);
});

test('K03 项目规则优先且未来规则未生效，同技师改时间不重锁，换人才换快照', () => {
  const f = fixture(); f.rule(); f.rule({ serviceId: 'relax', rateBps: 3000 }); f.booking();
  f.capture(); assert.equal(f.b.techIncomeSnapshot.rule.rateBps, 3000);
  const first = structuredClone(f.b.techIncomeSnapshot);
  f.rule({ serviceId: 'relax', version: 1, rateBps: 6000, effectiveAt: NOW + 60000 });
  f.b.startAt += 60000; f.capture(); assert.deepEqual(f.b.techIncomeSnapshot, first);
  f.b.techId = 't2'; f.capture(); assert.equal(f.b.techIncomeSnapshot.rule.rateBps, 3000);
  f.s.now += 60000; f.b.techId = 't1'; f.capture(); assert.equal(f.b.techIncomeSnapshot.rule.rateBps, 6000);
  assert.equal(f.b.techIncomeSnapshots.length, 3); assert.equal(f.b.techIncomeSnapshots[0].rule.rateBps, 3000);
});

test('K03 接单时缺配置也锁定事实，发布后不能追套；首次换人确认可以使用新规则', () => {
  const f = fixture(); f.booking(); f.capture(); assert.equal(f.b.techIncomeSnapshot.status, 'missing');
  f.rule(); f.capture(); assert.equal(f.b.techIncomeSnapshot.status, 'missing');
  f.finish(); assert.equal(f.e.amountCents, null); assert.match(f.e.reason, /接单时提成规则未配置/);
  const second = f.booking({ techId: 't2' }); f.capture(second); f.finish(); assert.equal(f.e.amountCents, 11920);
});

test('K03 普通完成及提前结束不按时长折扣，用户原因中止同完成；有效加时逐支付建账', () => {
  for (const extra of [{}, { finishMode: 'early', finishReason: '用户要求提前结束', startedAt: NOW - 60000 }, { completionKind: 'adjudicated-user', stoppedAt: NOW }]) {
    const f = fixture(); f.rule(); f.booking(extra); f.capture();
    f.b.extensions.push({ id: 'X1', status: 'success', amountCents: 14900, refundedCents: 0, duration: 30 }); f.finish();
    assert.deepEqual(f.s.techIncomeEntries.map(e => e.amountCents), [11920, 5960]);
    assert.deepEqual(f.s.techIncomeEntries.map(e => e.techId), ['t1', 't1']);
    assert.equal(f.s.techIncomeEntries.reduce((n, e) => n + e.amountCents, 0), 17880);
  }
});

test('K03 普通成功退款逐笔追加差额，失败未知不减额，不减少策略仍记零额调整', () => {
  const f = fixture(); f.rule(); f.booking(); f.capture(); f.finish();
  f.b.refunds.push({ id: 'RF1', status: 'failed', amountCents: 9800 }); f.sync(); assert.equal(f.e.amountCents, 11920); assert.equal(f.s.techIncomeAdjustments.length, 0);
  f.refund(9800); assert.equal(f.e.amountCents, 8000); assert.equal(f.s.techIncomeAdjustments[0].deltaCents, -3920);
  const entry = structuredClone(f.e), adjustments = structuredClone(f.s.techIncomeAdjustments); f.sync(); assert.deepEqual(f.e, entry); assert.deepEqual(f.s.techIncomeAdjustments, adjustments);
  f.refund(29800); assert.equal(f.e.amountCents, 0); assert.equal(f.e.status, 'void');
  const unchanged = fixture(); unchanged.rule({ refundPolicy: 'unchanged' }); unchanged.booking(); unchanged.capture(); unchanged.finish(); unchanged.refund(9800);
  assert.equal(unchanged.e.amountCents, 11920); assert.equal(unchanged.s.techIncomeAdjustments[0].deltaCents, 0);
  unchanged.refund(29800); assert.equal(unchanged.e.amountCents, 0);
});

test('K03 非用户原因中止按核实时长一次，原中止退款不重复折扣，额外退款留待核', () => {
  const f = fixture(); f.rule(); f.booking({ completionKind: 'interrupted' }); f.capture();
  f.b.disputes = [{ id: 'D1', kind: 'interruption', responsibility: 'health', actualMinutes: 20, totalMinutes: 60, refundId: 'RF1' }];
  f.b.refunds = [{ id: 'RF1', kind: 'interruption', disputeId: 'D1', status: 'offered', executions: [] }]; f.finish();
  assert.equal(f.e.amountCents, 3973);
  f.b.payment.refundedCents = 19867; f.b.refunds[0].status = 'success'; f.b.refunds[0].executions = [{ paymentId: f.b.payment.id, amountCents: 19867, status: 'success' }]; f.sync();
  assert.equal(f.e.amountCents, 3973); assert.equal(f.s.techIncomeAdjustments[0].deltaCents, 0);
  f.b.payment.refundedCents += 100; f.sync(); assert.equal(f.e.status, 'pending'); assert.equal(f.e.amountCents, 3973);
  assert.match(f.e.reason, /另有成功退款/); assert.equal(f.s.techIncomeAdjustments.at(-1).afterCents, null); assert.equal(f.e.payableCents, 0);
  const summary = techIncomeView(f.s, store).summary; assert.equal(summary.knownAccruedCents, 0); assert.equal(summary.accruedCents, 0); assert.equal(summary.lastKnownPendingCents, 3973); assert.equal(summary.pendingCount, 1);
});

test('K03 过期加时晚到成功全退不产生服务提成，取消补贴不凭净额伪造', () => {
  const f = fixture(); f.rule(); f.booking(); f.capture();
  f.b.extensions.push({ id: 'LATE', status: 'success', amountCents: 14900, refundedCents: 0, duration: 0 }); f.finish();
  assert.equal(f.s.techIncomeEntries.length, 1); f.b.extensions[0].refundedCents = 14900; f.sync(); assert.equal(f.s.techIncomeEntries.length, 1);
  f.booking({ status: 'cancelled', completedAt: NOW, departedAt: NOW - 60000 }); f.capture(); f.sync();
  assert.equal(f.s.techIncomeEntries.length, 1); assert.equal(techIncomeView(f.s, store).summary.pendingTypes.length, 2);
});

test('K03 月份按北京时间完成事实，跨月退款保留原月并记录调整发生月', () => {
  const f = fixture(); f.s.now = Date.parse('2026-10-31T23:30:00Z'); f.rule(); f.booking(); f.capture(); f.finish();
  assert.equal(f.e.month, '2026-11'); f.s.now = Date.parse('2026-12-01T00:00:00+08:00'); f.refund(100);
  assert.equal(f.e.month, '2026-11'); assert.equal(f.s.techIncomeAdjustments[0].month, '2026-12'); assert.equal(f.s.techIncomeAdjustments[0].originMonth, '2026-11');
});

test('K03 未结清资金不开放线下发放；旧缺归属不能被技师规则放行', () => {
  const f = fixture(); f.rule(); f.booking(); f.capture(); f.finish();
  assert.equal(f.e.status, 'held'); assert.equal(f.e.payableCents, 0);
  assert.throws(() => f.run('tech-income.payout', { techId: 't1', month: f.e.month, lines: [{ entryId: f.e.id, version: f.e.version }], paidAt: NOW, proof: 'BANK1', reason: '不能先发', requestId: 'held-payout' }, store), /尚不可发放/);
  assert.equal(f.s.techIncomePayouts.length, 0);
});

test('K03 取整明确到分，试算无副作用，不隐含40%或默认为零', () => {
  assert.equal(previewTechIncome({ amountCents: 101, refundedCents: 0, rateBps: 5000, refundPolicy: 'proportional', rounding: 'floor' }).amountCents, 50);
  assert.equal(previewTechIncome({ amountCents: 101, refundedCents: 0, rateBps: 5000, refundPolicy: 'proportional', rounding: 'round' }).amountCents, 51);
  assert.equal(previewTechIncome({ amountCents: 29800 }).amountCents, null);
  assert.equal(previewTechIncome({ amountCents: 101, refundedCents: 102, rateBps: 4000, refundPolicy: 'proportional', rounding: 'floor' }).amountCents, null);
});

test('K03 技师仅本人、店长只摘要、集团仅财务及管理员可读，查询不建账', () => {
  const f = fixture(); f.rule(); f.booking(); f.capture(); f.finish(); f.booking({ techId: 't2' }); f.capture(); f.finish();
  const before = structuredClone(f.s);
  assert.equal(techIncomeView(f.s, { role: 'tech', techId: 't1' }).entries.length, 1);
  assert.equal(techIncomeView(f.s, { role: 'tech', techId: 't2' }).entries.length, 1);
  const manager = techIncomeView(f.s, { role: 'manager', storeId: 's1' }); assert.equal(manager.entries.length, 0); assert.equal(manager.summary.accruedCents, 23840);
  for (const actor of [{ role: 'store', storeId: 's2' }, { role: 'user', userId: 'u1' }, { role: 'group', job: 'support' }, { role: 'group', job: 'operations' }]) assert.equal(techIncomeView(f.s, actor).entries.length, 0);
  assert.equal(techIncomeView(f.s, finance).entries.length, 2); assert.deepEqual(f.s, before);
});

test('K03 结清后按技师月份版本发放，校验实际日期凭证，原请求幂等且多次同月只发新明细', () => {
  const f = fixture(); f.financeRules(); f.rule(); f.booking(); f.capture(); f.finish(); f.settle();
  assert.equal(f.e.status, 'payable'); assert.equal(f.e.payableCents, 11920);
  for (const extra of [{ proof: '' }, { reason: '' }, { paidAt: '2026-02-30T10:00' }, { paidAt: f.s.now + 1 }, { paidAt: NOW - 1 }, { month: '2026-13' }, { techId: 't2' }, { lines: [{ entryId: f.e.id, version: f.e.version }, { entryId: f.e.id, version: f.e.version }] }]) assert.throws(() => f.payout(extra));
  for (const actor of [finance, { role: 'manager', storeId: 's1' }, { role: 'tech', techId: 't1' }, { role: 'store', storeId: 's2' }]) assert.throws(() => f.payout({}, actor));
  const p = { techId: f.e.techId, month: f.e.month, lines: [{ entryId: f.e.id, version: f.e.version }], paidAt: f.s.now, proof: 'BANK-FIRST', reason: '十月实际发放', requestId: 'month-first' };
  const first = f.run('tech-income.payout', p, { ...store, job: 'support' }); f.run('tech-income.payout', p, { ...store, job: 'finance' });
  assert.equal(f.s.techIncomePayouts.length, 1); assert.equal(f.e.paidCents, 11920); assert.equal(f.e.payableCents, 0); assert.equal(f.e.status, 'paid');
  assert.throws(() => f.run('tech-income.payout', { ...p, requestId: 'new-click' }, store), /记录已更新/);
  assert.throws(() => f.payout(), /已发/);
  f.booking(); f.capture(); f.finish(); f.settle(); f.payout({ proof: 'BANK-SECOND' });
  assert.equal(f.s.techIncomePayouts.length, 2); assert.equal(f.s.techIncomePayouts[1].month, first.month);
  assert.deepEqual(f.s.techIncomePayouts[0], first); assert.equal(f.s.techIncomePayouts.reduce((n, row) => n + row.amountCents, 0), 23840);
});

test('K03 发放预览后新增退款/安全/争议或版本变化均阻止旧页面登记', () => {
  for (const kind of ['refund', 'safety', 'dispute']) {
    const f = fixture(); f.financeRules(); f.rule(); f.booking(); f.capture(); f.finish(); f.settle();
    const line = { entryId: f.e.id, version: f.e.version };
    if (kind === 'refund') f.b.refunds.push({ id: 'R-PENDING', status: 'requested', requests: [{ paymentId: f.b.payment.id, amountCents: 1000 }] });
    if (kind === 'safety') f.s.safety = [{ bookingId: f.b.id, status: 'open' }];
    if (kind === 'dispute') f.b.disputes.push({ id: 'D-PENDING', status: 'open' });
    assert.throws(() => f.payout({ lines: [line] }), /记录已更新|尚不可发放/); assert.equal(f.s.techIncomePayouts.length, 0);
  }
});

test('K03 已发后成功退款生成独立差额，部分实际收回与幂等，后续月份不自动抵工资', () => {
  const f = fixture(); f.financeRules(); f.rule(); f.booking(); f.capture(); f.finish(); f.settle(); f.payout();
  const original = structuredClone(f.s.techIncomePayouts[0]); f.refund(9800);
  let d = f.s.techIncomeDifferences[0]; assert.equal(d.kind, 'recover'); assert.equal(d.remainingCents, 3920); assert.equal(f.e.paidCents, 11920); assert.equal(f.e.amountCents, 8000);
  const record = { id: d.id, version: d.version, kind: 'recover', amountCents: 2000, occurredAt: f.s.now, proof: 'RECOVER-1', reason: '双方协商后已实际收回20元', requestId: 'recover-partial' };
  for (const extra of [{ amountCents: 3921 }, { kind: 'supplement' }, { proof: '' }, { occurredAt: '2026-02-30T10:00' }, { occurredAt: f.s.now + 1 }]) assert.throws(() => f.run('tech-income.difference-record', { ...record, ...extra, requestId: 'invalid-' + JSON.stringify(extra) }, store));
  f.run('tech-income.difference-record', record, store); f.run('tech-income.difference-record', record, { ...store, job: 'support' });
  d = f.s.techIncomeDifferences[0]; assert.equal(d.remainingCents, 1920); assert.equal(d.records.length, 1); assert.equal(f.e.recoveredCents, 2000);
  assert.deepEqual(f.s.techIncomePayouts[0], original);
  // A fresh month's salary is not reduced by this outstanding recovery.
  f.s.now = Date.parse('2026-11-02T10:00:00+08:00'); f.booking(); f.capture(); f.finish(); f.settle(); const second = f.payout({ proof: 'NOVEMBER-FULL' });
  assert.equal(second.amountCents, 11920); assert.equal(second.month, '2026-11'); assert.equal(f.s.techIncomeDifferences[0].remainingCents, 1920);
  d = f.s.techIncomeDifferences[0];
  f.run('tech-income.difference-record', { id: d.id, version: d.version, kind: 'recover', amountCents: 1920, occurredAt: f.s.now, proof: 'RECOVER-2', reason: '实际收回剩余差额', requestId: 'recover-rest' }, store);
  assert.equal(f.s.techIncomeDifferences[0].status, 'closed'); assert.equal(f.s.techIncomeDifferences[0].remainingCents, 0);
  assert.equal(f.s.techIncomePayouts[0].amountCents, 11920);
});

test('K03 已有欠发实际记录形成补发事项，补发需资金稳定且保留实际凭证', () => {
  const f = fixture(); f.financeRules(); f.rule(); f.booking(); f.capture(); f.finish(); f.settle();
  // A separately evidenced historical partial payment is preserved, not silently changed to full payment.
  f.s.techIncomePayouts.push({ id: 'HISTORICAL-PAYOUT', storeId: 's1', techId: 't1', month: f.e.month, amountCents: 5000, proof: 'EXISTING-BANK', paidAt: f.s.now, status: 'paid', lines: [{ entryId: f.e.id, amountCents: 5000 }] }); f.sync();
  let d = f.s.techIncomeDifferences[0]; assert.equal(d.kind, 'supplement'); assert.equal(d.remainingCents, 6920);
  f.s.safety = [{ bookingId: f.b.id, status: 'open' }];
  assert.throws(() => f.run('tech-income.difference-record', { id: d.id, version: d.version, kind: 'supplement', amountCents: 6920, occurredAt: f.s.now, proof: 'SUPPLEMENT', reason: '实际补发' }, store), /服务资金尚未结清/);
  f.s.safety[0].status = 'closed'; f.sync(); d = f.s.techIncomeDifferences[0];
  f.run('tech-income.difference-record', { id: d.id, version: d.version, kind: 'supplement', amountCents: 6920, occurredAt: f.s.now, proof: 'SUPPLEMENT', reason: '实际补发' }, store);
  assert.equal(f.e.paidCents, 11920); assert.equal(f.e.status, 'paid'); assert.equal(f.s.techIncomePayouts[0].amountCents, 5000); assert.equal(f.s.techIncomeDifferences[0].status, 'closed');
});

test('K03 engine实链：接单固定规则→同人改约保留→指定换人确认采用新规则→收入只归实际技师', async () => {
  const { seed, reduce } = await import('./engine.mjs');
  let s = seed(); const user = { role: 'user', userId: 'u1' }, shop = { role: 'store', storeId: 'xingfu' };
  const run = (type, p, actor = user) => { s = reduce(s, actor, type, p); };
  const rules = { storeId: 'xingfu', serviceId: 'all', rateBps: 4000, refundPolicy: 'proportional', rounding: 'floor', effectiveAt: s.now, reason: '明确用于本次演示' };
  run('tech-income.rule-publish', { ...rules, version: 0, requestId: 'engine-rule-1' }, finance);
  run('booking.create', { storeId: 'xingfu', serviceId: 'relax', regionId: 'home', techId: 'lin', mode: 'specified', genderPreference: 'any', startAt: '2026-10-02T13:00', contactName: '王女士', phone: '13800009999', adultConfirmed: true, identityVerified: true, healthConsent: true, requestId: 'tech-rule-booking' });
  const id = s.bookings.at(-1).id;
  run('booking.pay', { id, outcome: 'success' }); run('booking.accept', { id }, { role: 'tech', techId: 'lin' });
  const snapshot = structuredClone(s.bookings.at(-1).techIncomeSnapshot);
  assert.equal(snapshot.bookingId, id);
  assert.match(snapshot.events[0].text, /技师提成规则已固定/);
  assert.deepEqual(s.bookings.at(-1).techIncomeSnapshots[0].events, snapshot.events);
  assert.equal(s.bookings.at(-1).events.some(e => /技师提成规则已固定|接单时未配置技师提成规则/.test(e.text)), false);
  assert.equal(s.logs.some(e => e.id === snapshot.id && /技师提成规则已固定/.test(e.text)), true);
  run('tech-income.rule-publish', { ...rules, rateBps: 6000, version: 1, requestId: 'engine-rule-2' }, finance);
  run('booking.reschedule', { id, startAt: '2026-10-02T15:00', techId: 'lin' }); run('booking.accept', { id }, { role: 'tech', techId: 'lin' });
  assert.deepEqual(s.bookings.at(-1).techIncomeSnapshot, snapshot);
  run('booking.assign', { id, techId: 'zhou', reason: '用户申请换人' }, shop);
  assert.deepEqual(s.bookings.at(-1).techIncomeSnapshot, snapshot);
  run('booking.change-answer', { id, changeId: s.bookings.at(-1).change.id, decision: 'accept' });
  assert.equal(s.bookings.at(-1).techIncomeSnapshot.techId, 'zhou'); assert.equal(s.bookings.at(-1).techIncomeSnapshot.rule.rateBps, 6000);
  run('clock.advance', { minutes: 360 }); run('booking.start', { id }, { role: 'tech', techId: 'zhou' });
  run('clock.advance', { minutes: 60 }); run('booking.finish', { id, mode: 'normal' }, { role: 'tech', techId: 'zhou' });
  assert.equal(s.techIncomeEntries.length, 1); assert.equal(s.techIncomeEntries[0].techId, 'zhou'); assert.equal(s.techIncomeEntries[0].amountCents, 17880);
  assert.equal(techIncomeView(s, { role: 'tech', techId: 'lin' }).entries.length, 0);
});
