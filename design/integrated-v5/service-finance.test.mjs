import test from 'node:test';
import assert from 'node:assert/strict';
import { upgradeServiceFinance, captureBookingFinance, captureExtensionFinance, syncServiceFinance, serviceFinanceCommand, serviceFinanceView, serviceFinanceSummary, previewServiceFinanceRule } from './service-finance.mjs';
const DAY = 86400000;
const finance = { role: 'group', job: 'finance' };
function fixture() {
  let state = { schema: 5, seq: 0, now: Date.parse('2026-10-03T09:00:00+08:00'), bookingRules: { maxDays: 7 }, users: [{ id: 'u1' }, { id: 'u2' }], stores: [{ id: 's1' }, { id: 's2' }], services: [{ id: 'svc1' }, { id: 'svc2' }], bookings: [], safety: [], goods: [], logs: [] };
  state.users[0].serviceBinding = { status: 'unbound', recordedAt: state.now, origin: 'demo-initial' };
  upgradeServiceFinance(state); let request = 0;
  const context = s => ({ id: prefix => prefix + ++s.seq, fail: m => { throw new Error(m); }, log: (e, m) => s.logs.push({ id: e.id, at: s.now, text: m }) });
  const run = (type, p = {}, actor = finance) => { const next = structuredClone(state); const r = serviceFinanceCommand(next, actor, type, { requestId: `req-${++request}`, ...p }, context(next)); state = next; return r; };
  const f = {
    get s() { return state; }, get b() { return state.bookings[0]; }, get e() { return state.serviceFinanceEntries[0]; }, get v() { return serviceFinanceSummary(state, this.b, this.b.payment.id); }, run,
    sync() { syncServiceFinance(state, context(state)); },
    publish(p = {}) { return run('finance.rule-publish', { scope: 'global', version: Math.max(0, ...state.serviceFinanceRules.filter(x => x.scope === 'global').map(x => x.version)), groupBps: 1000, storeBps: 500, effectiveAt: state.now, reason: '本地测试显式输入，非默认规则', ...p }); },
    book(p = {}, snapshot = true) {
      const n = state.bookings.length + 1;
      const b = { id: `BK${n}`, userId: 'u1', storeId: 's1', serviceId: 'svc1', status: 'confirmed', createdAt: state.now, completedAt: null, payment: { id: `BP${n}`, status: 'unpaid', amountCents: 29800, refundedCents: 0 }, extensions: [], refunds: [], disputes: [], ...p };
      if (snapshot) captureBookingFinance(state, b, context(state));
      b.payment.status = 'success'; b.payment.paidAt = state.now; state.bookings.push(b); f.sync(); return b;
    },
    finish() { f.b.status = 'done'; f.b.completedAt = state.now; state.now += 2 * DAY; f.sync(); },
    execute(kind, outcome = 'success', extra = {}) { return run('finance.' + kind, { id: f.e.id, version: f.e.version, outcome, ...extra }); },
    settle() { f.execute('split-start'); f.execute('finish-start'); },
    refund(cents) { f.b.payment.refundedCents += cents; f.sync(); },
    receive(r, cents = r.amountCents - r.receivedCents) { return run('finance.recovery-receive', { id: r.id, version: r.version, amountCents: cents, reference: 'BANK-'+request, reason: '已核对实际线下收款', requestId: 'receive-'+(++request) }); }
  };
  return f;
}

test('资金迁移不默认比例、不补归属、不回填历史快照；新规则不追补旧单', () => {
  const f = fixture(); delete f.s.users[0].serviceBinding;
  const b = f.book({}, false); assert.equal(f.s.serviceFinanceRules.length, 0); assert.equal(f.e.sourceSnapshot, null); assert.equal(f.v.targetGroupCents, null);
  f.publish(); f.sync(); assert.equal(b.serviceFinanceSnapshot, undefined); assert.equal(f.e.ruleSnapshot, null); assert.equal(f.v.canSplit, false);
  const before = JSON.stringify(f.s); upgradeServiceFinance(f.s); serviceFinanceView(f.s, finance); assert.equal(JSON.stringify(f.s), before);
});

test('四级规则优先级、未来生效、明确0和旧快照版本均固定', () => {
  const f = fixture(); f.publish();
  f.publish({ scope: 'service', serviceId: 'svc1', groupBps: 1100, version: 0 });
  f.publish({ scope: 'store', storeId: 's1', groupBps: 1200, version: 0 });
  f.publish({ scope: 'store-service', storeId: 's1', serviceId: 'svc1', groupBps: 1300, version: 0 });
  f.book(); assert.equal(f.e.ruleSnapshot.groupBps, 1300); assert.equal(f.v.targetGroupCents, 3874);
  f.publish({ scope: 'store-service', storeId: 's1', serviceId: 'svc1', groupBps: 0, storeBps: 0, version: 1, effectiveAt: f.s.now + DAY });
  const before = JSON.stringify(f.b.serviceFinanceSnapshot); captureBookingFinance(f.s, f.b, {}); assert.equal(JSON.stringify(f.b.serviceFinanceSnapshot), before);
  f.book(); assert.equal(f.s.serviceFinanceEntries[1].ruleSnapshot.groupBps, 1300);
  f.s.now += DAY; f.book(); assert.equal(f.s.serviceFinanceEntries[2].ruleSnapshot.groupBps, 0);
  assert.equal(f.e.ruleSnapshot.mode, 'demo'); assert.equal(f.e.ruleSnapshot.productionApproved, false);
});

test('规则发布校验权限、范围、万分比、日历日期、冻结期限及版本', () => {
  const f = fixture();
  for (const p of [{ groupBps: '' }, { storeBps: null }, { groupBps: 3001 }, { groupBps: -1 }, { groupBps: 1.2 }, { scope: 'store', storeId: 'missing' }, { scope: 'service' }, { effectiveAt: '2027-02-30T10:00' }, { effectiveAt: f.s.now - 1 }]) assert.throws(() => f.publish(p));
  f.s.bookingRules.maxDays = 14; assert.throws(() => f.publish(), /25天/); f.s.bookingRules.maxDays = 7;
  f.publish({ effectiveAt: '2026-10-03T09:00' }); assert.throws(() => f.publish({ version: 0 }), /版本/);
  for (const actor of [{ role: 'store', storeId: 's1' }, { role: 'manager', storeId: 's1' }, { role: 'tech', techId: 't1' }, { role: 'group', job: 'operations' }]) assert.throws(() => f.run('finance.rule-publish', {}, actor), /仅集团财务/);
  assert.deepEqual(previewServiceFinanceRule({ groupBps: 1000, storeBps: 500, amountCents: 199, customerType: 'store' }), { valid: true, error: '', groupCents: 9, storeCents: 190 });
});

test('已知自然/本店/跨店来源与商品推广隔离，过期推广恢复未绑定，未知和D06不零佣放行', () => {
  const f = fixture(); f.publish(); f.s.promotions = { u1: { storeId: 's2' } }; f.book(); assert.equal(f.e.sourceSnapshot.customerType, 'group');
  f.s.users[0].serviceBinding = { status: 'store', ownerStoreId: 's1', recordedAt: f.s.now }; f.book(); assert.equal(f.s.serviceFinanceEntries[1].sourceSnapshot.customerType, 'store');
  f.book({ storeId: 's2' }); assert.equal(f.s.serviceFinanceEntries[2].sourceSnapshot.customerType, 'group'); assert.equal(f.s.serviceFinanceEntries[2].sourceSnapshot.ownerStoreId, 's1');
  f.s.users[0].serviceBinding.promoterId = 'p1'; f.book(); assert.equal(f.s.serviceFinanceEntries[3].sourceSnapshot.status, 'promotion-pending');
  f.s.users[0].serviceBinding.expiresAt = f.s.now; f.book(); assert.equal(f.s.serviceFinanceEntries[4].sourceSnapshot.status, 'known'); assert.equal(f.s.serviceFinanceEntries[4].sourceSnapshot.promoterId, null);
  delete f.s.users[0].serviceBinding; f.book(); assert.equal(f.s.serviceFinanceEntries[5].sourceSnapshot.status, 'unknown');
});

test('自然用户最早有效完成事实归集团365天，不按数组顺序或退款改旧快照', () => {
  const f = fixture(); f.publish(); f.book(); f.book();
  f.s.now += DAY; f.s.bookings[0].status = f.s.bookings[1].status = 'done'; f.s.bookings[0].completedAt = f.s.now; f.s.bookings[1].completedAt = f.s.now - 60000;
  const original = copy(f.s.bookings[0].serviceFinanceSnapshot); f.sync();
  assert.equal(f.s.users[0].serviceBinding.ownerType, 'group'); assert.equal(f.s.users[0].serviceBinding.bookingId, 'BK2'); assert.equal(f.s.users[0].serviceBinding.expiresAt, f.s.now - 60000 + 365 * DAY);
  f.refund(29800); f.sync(); assert.equal(f.s.users[0].serviceBindingHistory.length, 1); assert.deepEqual(f.b.serviceFinanceSnapshot, original);
  f.s.users[1].serviceBinding = undefined; f.book({ userId: 'u2', status: 'done', completedAt: f.s.now }); assert.equal(f.s.users[1].serviceBinding, undefined);
});
const copy = structuredClone;

test('成功支付后逐笔记录T0和加时继承主单快照，缺时间不能编造期限', () => {
  const f = fixture(); f.publish(); f.book(); f.s.now += 3600000;
  const x = { id: 'BX1', amountCents: 14900, refundedCents: 0, status: 'success', paidAt: f.s.now };
  f.publish({ groupBps: 2000 }); captureExtensionFinance(f.s, f.b, x, {}); f.b.extensions.push(x); f.sync();
  const e = f.s.serviceFinanceEntries[1]; assert.equal(e.ruleSnapshot.groupBps, 1000); assert.equal(e.paidAt - f.e.paidAt, 3600000);
  assert.equal(serviceFinanceSummary(f.s, f.b, x.id).forceAt - f.v.forceAt, 3600000);
  f.b.extensions.push({ id: 'BX2', amountCents: 100, refundedCents: 0, status: 'success' }); f.sync(); const missing = serviceFinanceSummary(f.s, f.b, 'BX2'); assert.equal(missing.paidAt, null); assert.equal(missing.canSplit, false);
});

test('正常分账与完结分离，未知先查，成功幂等与金额取整', () => {
  const f = fixture(); f.publish(); f.book(); assert.equal(f.v.canSplit, false); f.finish();
  const p = { id: f.e.id, version: f.e.version, outcome: 'processing', requestId: 'split-idempotent' }; f.run('finance.split-start', p); const no = f.e.split.requestNo;
  assert.equal(f.v.canPayTech, false); assert.throws(() => f.execute('split-start'), /未知/); f.run('finance.split-start', p); assert.equal(f.e.split.attempts, 1);
  assert.throws(() => f.run('finance.split-start', { ...p, outcome: 'success' }), /同一提交标识/);
  f.execute('split-query'); assert.equal(f.e.split.requestNo, no); assert.equal(f.v.canPayTech, false);
  f.execute('finish-start', 'processing'); assert.equal(f.v.canPayTech, false); f.execute('finish-query'); assert.equal(f.v.canPayTech, true); assert.equal(f.v.storeCashCents, 26820);
  assert.throws(() => f.execute('split-start', 'success', { version: f.e.version - 1 }), /已更新/);
});

test('0%明确规则仍须完结释放，全额退款不生成零分账交易', () => {
  const f = fixture(); f.publish({ groupBps: 0, storeBps: 0 }); f.book(); f.finish(); f.execute('split-start'); assert.equal(f.e.split.status, 'zero'); assert.equal(f.v.canPayTech, false); f.execute('finish-start'); assert.equal(f.v.canPayTech, true);
  const z = fixture(); z.publish(); z.book(); z.finish(); z.refund(29800); assert.equal(z.v.status, 'void'); assert.equal(z.v.canSplit, false); assert.equal(z.e.split, null);
});

test('售后安全并列阻断；25天可越过已知业务阻断但未知退款不可越过', () => {
  const f = fixture(); f.publish(); f.book(); f.finish(); f.s.safety.push({ bookingId: f.b.id, status: 'open' }); f.b.disputes.push({ status: 'open' }); f.sync(); assert.equal(f.v.canSplit, false);
  f.s.now = f.e.paidAt + 25 * DAY; f.sync(); assert.equal(f.v.canSplit, true); assert.equal(f.v.canPayTech, false);
  f.b.refunds.push({ id: 'RF1', status: 'processing', executions: [{ paymentId: f.b.payment.id, amountCents: 9800, status: 'processing' }] }); f.sync(); assert.equal(f.v.canSplit, false); assert.throws(() => f.execute('split-start', 'success', { manual: true, reason: '人工核对' }), /退款结果未知/);
  f.b.refunds[0].status = 'failed'; f.b.refunds[0].executions[0].status = 'failed'; f.sync(); assert.equal(f.v.splitTargetCents, 2000); f.execute('split-start'); assert.equal(f.e.split.amountCents, 2000);
});

test('27天只告警一次，30天未分转追偿，分次实收且未收清不能发提成', () => {
  const f = fixture(); f.publish(); f.book(); f.finish(); f.s.now = f.e.paidAt + 27 * DAY; f.sync(); f.sync(); assert.equal(f.e.history.filter(x => x.action.includes('27天')).length, 1);
  f.s.now = f.e.paidAt + 30 * DAY; f.sync(); let r = f.s.serviceFinanceRecoveries[0]; assert.equal(r.amountCents, 2980); assert.equal(f.v.canSplit, false); assert.equal(f.v.canPayTech, false);
  f.receive(r, 1000); r = f.s.serviceFinanceRecoveries[0]; assert.equal(r.outstandingCents, 1980); assert.equal(f.v.canPayTech, false); f.receive(r); assert.equal(f.v.canPayTech, true); assert.equal(f.v.storeCashCents, 26820);
});

test('30天原分账未知不造确定追偿，查失败后才追偿，查成功后不重复分账', () => {
  for (const outcome of ['failed', 'success']) {
    const f = fixture(); f.publish(); f.book(); f.finish(); f.execute('split-start', 'processing'); f.s.now = f.e.paidAt + 30 * DAY; f.sync();
    assert.equal(f.s.serviceFinanceRecoveries.length, 0); assert.equal(f.v.canSplit, false); f.execute('split-query', outcome);
    assert.equal(f.s.serviceFinanceRecoveries.length, outcome === 'failed' ? 1 : 0); assert.equal(f.v.canPayTech, outcome === 'success');
  }
});

test('失败重试逐次延时、5次后转人工，人工不能绕过未知或30天', () => {
  const f = fixture(); f.publish(); f.book(); f.finish(); f.execute('split-start', 'failed'); const no = f.e.split.requestNo;
  assert.equal(f.v.canSplit, false); assert.equal(f.v.canManualSplit, true); assert.throws(() => f.execute('split-start', 'success', { manual: true }), /人工渠道处理原因/);
  for (let i = 1; i < 5; i++) { f.s.now = f.e.split.nextRetryAt; f.execute('split-start', 'failed'); assert.equal(f.e.split.requestNo, no); }
  f.s.now = f.e.split.nextRetryAt; assert.equal(f.v.canSplit, false); assert.throws(() => f.execute('split-start'), /人工/);
  f.execute('split-start', 'success', { manual: true, reason: '财务核对原笔确定失败后手工重试' }); assert.equal(f.e.split.attempts, 6); assert.equal(f.e.split.requestNo, no);
});

test('退款分笔成功才调整分账，累计分重算不丢零钱，回退不阻塞用户原退款', () => {
  const f = fixture(); f.publish(); f.book(); f.finish(); f.settle(); f.refund(1); f.refund(1);
  assert.equal(f.v.targetGroupCents, 2979); assert.equal(f.v.pendingReturnCents, 1); assert.equal(f.e.adjustments.length, 2); assert.equal(f.e.split.amountCents, 2980);
  f.execute('return-start'); assert.equal(f.v.returnedCents, 1); assert.equal(f.v.canPayTech, true); assert.equal(f.v.storeCashCents, 26819);
});

test('回退失败追偿与原笔渠道回退互斥，重复线下收款不可超额', () => {
  const f = fixture(); f.publish(); f.book(); f.finish(); f.settle(); f.refund(9800); f.execute('return-start', 'failed'); const r = f.s.serviceFinanceRecoveries[0]; assert.equal(r.amountCents, 980);
  f.receive(r, 500); assert.equal(f.v.pendingReturnCents, 480); assert.throws(() => f.execute('return-start', 'success', { returnId: f.e.returns[0].id, manual: true, reason: '测试' }), /线下回收/);
  f.receive(f.s.serviceFinanceRecoveries[0]); assert.equal(f.v.canPayTech, true); assert.equal(f.v.externalToStoreCents, 980); assert.equal(f.e.returns[0].status, 'failed');
  assert.throws(() => f.receive(f.s.serviceFinanceRecoveries[0], 1), /金额无效/);
});

test('30天线下追偿收清后再退款，集团多收产生线下退回而非虚假分账回退', () => {
  const f = fixture(); f.publish(); f.book(); f.finish(); f.s.now = f.e.paidAt + 30 * DAY; f.sync(); f.receive(f.s.serviceFinanceRecoveries[0]);
  f.refund(9800); const r = f.s.serviceFinanceRecoveries.find(x => x.type === 'offline-adjustment'); assert.equal(r.amountCents, 980); assert.equal(r.payer, 'group'); assert.equal(f.v.pendingOfflineReturnCents, 980); assert.equal(f.v.canReturn, false); assert.equal(f.v.canPayTech, false);
  f.receive(r); assert.equal(f.v.canPayTech, true); assert.equal(f.v.storeCashCents, 18000); f.sync(); assert.equal(f.s.serviceFinanceRecoveries.length, 2);
  f.refund(20000); const rr = f.s.serviceFinanceRecoveries.find(x => x.type === 'offline-adjustment'); assert.equal(rr.outstandingCents, 2000); f.receive(rr); assert.equal(f.v.status, 'void'); assert.equal(f.v.storeCashCents, 0);
});

test('未知退款期间禁止新回退、失败回退重试和线下追偿实收，但允许查已在途渠道', () => {
  const f = fixture(); f.publish(); f.book(); f.finish(); f.settle(); f.refund(9800); f.execute('return-start', 'failed');
  f.b.refunds.push({ status: 'processing', executions: [{ paymentId: f.b.payment.id, amountCents: 1000, status: 'processing' }] }); f.sync();
  assert.equal(f.v.canReturn, false); assert.equal(f.v.returns[0].canManualRetry, false); assert.throws(() => f.receive(f.s.serviceFinanceRecoveries[0]), /未知退款/);
  assert.throws(() => f.execute('return-start', 'success', { returnId: f.e.returns[0].id, manual: true, reason: '测试' }), /未知退款/);
  f.b.refunds = []; f.s.now = f.e.returns[0].nextRetryAt; f.execute('return-start', 'processing', { returnId: f.e.returns[0].id });
  f.b.refunds.push({ status: 'processing', executions: [{ paymentId: f.b.payment.id, amountCents: 1000, status: 'processing' }] }); f.sync(); f.execute('return-query', 'success', { returnId: f.e.returns[0].id }); assert.equal(f.v.returnedCents, 980);
});

test('分账处理中遇成功退款，查原笔后回退差额，既有原笔不覆写金额', () => {
  const f = fixture(); f.publish(); f.book(); f.finish(); f.execute('split-start', 'processing'); f.refund(9800); assert.equal(f.e.split.amountCents, 2980); assert.equal(f.v.canSplit, false);
  f.execute('split-query'); assert.equal(f.v.pendingReturnCents, 980); f.execute('return-start'); f.execute('finish-start'); assert.equal(f.v.canPayTech, true); assert.equal(f.v.storeCashCents, 18000);
});

test('分账已完结后新售后不倒退为待完结，清除阻断后复用既有成功事实', () => {
  const f = fixture(); f.publish(); f.book(); f.finish(); f.settle(); const previous = copy(f.e.finish);
  f.b.refunds.push({ status: 'approved', executions: [{ paymentId: f.b.payment.id, amountCents: 9800, status: 'approved' }] }); f.sync();
  assert.equal(f.v.status, 'settled-blocked'); assert.match(f.v.statusLabel, /已完结.*阻断/); assert.equal(f.v.canFinish, false); assert.equal(f.v.canPayTech, false); assert.deepEqual(f.e.finish, previous);
  f.b.refunds = []; f.sync(); assert.equal(f.v.status, 'settled'); assert.equal(f.v.canPayTech, true); assert.deepEqual(f.e.finish, previous);
});

test('读取按角色和门店缩小范围，店长无原笔/规则；重复结果持久且权限优先', () => {
  const f = fixture(); f.publish(); f.book(); f.book({ storeId: 's2' }); f.finish(); const p = { id: f.e.id, version: f.e.version, outcome: 'success', requestId: 'persistent' }; f.run('finance.split-start', p);
  f.run('finance.split-start', p); assert.equal(f.e.split.attempts, 1); assert.equal(JSON.parse(JSON.stringify(f.s)).serviceFinanceRequests.at(-1).requestId, 'persistent');
  assert.throws(() => f.run('finance.split-start', p, { role: 'group', job: 'support' }), /仅集团财务/);
  assert.equal(serviceFinanceView(f.s, { role: 'store', storeId: 's1' }).entries.length, 1);
  const manager = serviceFinanceView(f.s, { role: 'manager', storeId: 's1' }); assert.equal(manager.entries[0].split, undefined); assert.equal(manager.rules.length, 0); assert.equal(manager.recoveries.length, 0);
  assert.equal(serviceFinanceView(f.s, { role: 'user', userId: 'u1' }).entries.length, 0); assert.equal(serviceFinanceView(f.s, { role: 'group', job: 'support' }).entries.length, 0);
});
