import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { seed, reduce } from './engine.mjs';
import { servicePromotionSharedTaskRows } from './service-promotion-shared-tasks.mjs';
import { servicePromotionBalanceToken } from './service-promotion.mjs';
import { prepareServicePromotionEvidence } from './service-promotion-file-validation.mjs';

const MIN = 60000, DAY = 86400000;
const finance = { role: 'group', job: 'finance' }, support = { role: 'group', job: 'support' };
const manager = { role: 'store', job: 'store-manager', storeId: 'xingfu' }, user = { role: 'user', userId: 'u1' }, personal = { role: 'user', userId: 'u2' }, tech = { role: 'tech', techId: 'lin' };
const bytes = new TextEncoder().encode('%PDF-1.4\nTask acceptance source\n%%EOF'), blob = new Blob([bytes], { type: 'application/pdf' });
const file = { ref: 'invoice-file:' + createHash('sha256').update(bytes).digest('hex'), name: '待办合成凭证.pdf', type: blob.type, size: blob.size };
async function fixture({ promotion = true, pair = false, complete = true } = {}) {
  let s = seed(), n = 0, target;
  const h = {
    get s() { return s; }, get target() { return target; },
    b(id = target) { return s.bookings.find(x => x.id === id); },
    e(id = target) { return s.serviceFinanceEntries.find(x => x.bookingId === id && x.paymentId === h.b(id).payment.id); },
    d() { return s.serviceFinanceRecoveries.find(x => x.entryId === h.e().id && x.type === 'unshared-release'); },
    tasks() { return servicePromotionSharedTaskRows(s); },
    entryTask(id = target) { return h.tasks().find(x => x.category === 'service-promotion-finance-entry' && x.sourceId === h.e(id).id); },
    debtTask() { return h.tasks().find(x => x.category === 'service-promotion-finance-recovery' && x.sourceId === h.d().id); },
    proof(reference = 'TASK-FACT-' + ++n) { return { reference, occurredAt: s.now, file, reason: 'PRIVATE-EVIDENCE-BODY' }; },
    async op(type, p = {}, actor = finance) {
      const row = ['servicePromoters','servicePromotionInvites','servicePromotionWithdrawals','serviceFinanceEntries','serviceFinanceRecoveries'].flatMap(k => s[k] || []).find(x => x.id === (p.id || p.promoterId));
      const payload = { requestId: 'SP-TASK-' + ++n, version: row?.version || 0, ...p };
      const evidence = await prepareServicePromotionEvidence(s, actor, type, payload, { readFile: async descriptor => { assert.equal(descriptor.ref, file.ref); return blob; } });
      s = reduce(s, actor, type, payload, () => {}, evidence);
    },
    async clock(minutes) { await h.op('clock.advance', { minutes }); },
    async create() {
      const startAt = Math.ceil((s.now + 4 * 3600000) / (30 * MIN)) * 30 * MIN;
      await h.op('booking.create', { storeId: 'xingfu', serviceId: 'relax', regionId: 'home', techId: 'lin', mode: 'specified', genderPreference: 'any', startAt, contactName: 'PRIVATE-CUSTOMER', phone: '13800000001', healthConsent: true, identityVerified: true, adultConfirmed: true }, user);
      target = s.bookings.at(-1).id; await h.op('booking.pay', { id: target, outcome: 'success' }, user); await h.op('booking.accept', { id: target }, tech); return target;
    },
    async complete(id = target) { await h.clock(Math.max(0, Math.ceil((h.b(id).startAt - s.now) / MIN))); await h.op('booking.start', { id }, tech); await h.clock(60); await h.op('booking.finish', { id, mode: 'normal' }, tech); },
    async execute(op = 'split-start', outcome = 'success', p = {}) { await h.op('finance.' + op, { id: h.e().id, outcome, ...p }); },
    async settle() { await h.execute(); await h.execute('finish-start'); },
    async refund(id = target, amountCents = 9800, outcome = 'success') {
      await h.op('booking.special-aftersale', { id, requests: [{ paymentId: h.b(id).payment.id, amountCents }], reason: 'PRIVATE-REFUND-REASON' }, support);
      const r = h.b(id).refunds.at(-1); await h.op('booking.refund-review', { id, refundId: r.id, decision: 'approve', reason: 'PRIVATE-REVIEW' }, support); await h.op('booking.refund-pay', { id, refundId: r.id, outcome });
    }
  };
  await h.op('finance.rule-publish', { scope: 'global', groupBps: 1000, storeBps: 500, effectiveAt: s.now, version: 0, reason: '显式本地原H规则' });
  if (promotion) {
    await h.op('service-promotion.agreement-publish', { promoterType: 'store-promoter', title: '本地待办协议', body: 'PRIVATE-AGREEMENT', effectiveAt: s.now, ...h.proof() }, support);
    await h.op('service-promotion.invite', { userId: 'u2', promoterType: 'store-promoter', expiresAt: s.now + DAY, reason: '本店邀请' }, manager);
    const invite = s.servicePromotionInvites.at(-1); await h.op('service-promotion.invite-confirm', { id: invite.id, decision: 'accept', agreementAccepted: true, agreementId: invite.agreementSnapshot.id, reason: '本人确认' }, personal);
    const promoter = s.servicePromoters.at(-1); await h.op('service-promotion.identity-review', { id: promoter.id, decision: 'verified', ...h.proof() }, support);
    await h.op('service-promotion.transfer-authorize', { id: promoter.id, enabled: true, reason: '本人明确演示授权' }, personal);
    await h.op('service-promotion.rule-publish', { promoterType: 'store-promoter', firstBps: 2000, repeatBps: 1000, storeCostBps: 5000, csRounding: 'floor', concurrency: 'completed-created-id', lateFullRefund: 'reassign', effectiveAt: s.now, version: 0, basis: '明确本地Demo配置，正式规则另验' });
    await h.op('service-promotion.enter', { promoterId: promoter.id, version: s.users[0].serviceBinding.version || 0 }, user);
  }
  await h.create(); const first = target;
  if (complete) await h.complete();
  if (pair) { await h.create(); await h.complete(); h.first = first; }
  if (complete) await h.clock(2881);
  return h;
}

test('纯读投影只新增真实原个人推广资金；非推广原账不扩入', async () => {
  const h = await fixture(), before = structuredClone(h.s), task = h.entryTask();
  assert.equal(task.status, 'open'); assert.deepEqual(task.commands, ['finance.split-start']);
  assert.equal(task.entryId, h.e().id); assert.equal(task.bookingId, h.target); assert.equal(task.paymentId, h.b().payment.id);
  assert.equal(task.requiredRoute, 'service-finance'); assert.equal(task.assignmentMode, 'task');
  assert.deepEqual(task.allowedJobs, { group: ['finance'], store: [] }); assert.deepEqual(task.manageRoles, ['group']);
  assert.equal(task.routes.group, '/group/service-finance/entry/' + h.e().id); assert.deepEqual(h.s, before);
  const old = await fixture({ promotion: false }); assert.deepEqual(old.tasks(), []);
});

test('原业务未完只等待；原split成功先完结，真资金结清才done', async () => {
  const waiting = await fixture({ complete: false }); assert.equal(waiting.entryTask().status, 'waiting'); assert.deepEqual(waiting.entryTask().commands, []);
  const h = await fixture(); await h.execute(); assert.deepEqual(h.entryTask().commands, ['finance.finish-start']);
  assert.equal(h.entryTask().status, 'open'); await h.execute('finish-start'); assert.equal(h.entryTask().status, 'done'); assert.deepEqual(h.entryTask().commands, []);
});

test('原split与退款结果未知仅保留原split查询，不能新分或回款', async () => {
  const h = await fixture(); await h.execute('split-start', 'processing'); await h.refund(h.target, 9800, 'processing');
  assert.deepEqual(h.entryTask().commands, ['finance.split-query']); assert.equal(h.entryTask().status, 'open');
  assert.equal(h.tasks().filter(x => x.commands.includes('finance.recovery-receive')).length, 0);
});

test('原return未知只query，明确失败后沿原可重试回退和真实代退出口', async () => {
  const h = await fixture(); await h.settle(); await h.refund(); await h.execute('return-start', 'processing', { splitId: h.e().split.id });
  assert.deepEqual(h.entryTask().commands, ['finance.return-query']);
  const ret = h.e().returns.at(-1); await h.execute('return-query', 'failed', { returnId: ret.id });
  assert.deepEqual(h.entryTask().commands, ['finance.return-start']);
  assert.equal(h.tasks().find(x => x.category === 'service-promotion-finance-recovery').commands[0], 'finance.recovery-receive');
});

test('成功finish后的Cs追加只给原门店差额；真实收到原债后done', async () => {
  const h = await fixture({ pair: true }); await h.settle(); await h.refund(h.first, h.b(h.first).payment.amountCents);
  assert.equal(h.entryTask().status, 'waiting'); assert.deepEqual(h.entryTask().commands, []);
  const task = h.debtTask(), token = task.sourceToken; assert.equal(task.status, 'open'); assert.deepEqual(task.commands, ['finance.recovery-receive']);
  assert.equal(task.routes.group, '/group/service-finance/recoveries'); assert.equal(task.entryId, h.e().id);
  await h.op('finance.recovery-receive', { id: h.d().id, amountCents: h.d().outstandingCents, ...h.proof() });
  assert.equal(h.debtTask().status, 'done'); assert.equal(h.entryTask().status, 'done'); assert.notEqual(h.debtTask().sourceToken, token);
});

test('个人提现未知跨退款使原资金等待，不提前收付或假结案', async () => {
  const h = await fixture(); await h.settle(); const promoter = h.s.servicePromoters[0], commission = h.s.serviceCommissions[0];
  await h.op('service-promotion.withdraw-create', { promoterId: promoter.id, amountCents: commission.commissionCents, balanceToken: servicePromotionBalanceToken(h.s, promoter.id) }, personal);
  await h.op('service-promotion.withdraw-pay', { id: h.s.servicePromotionWithdrawals.at(-1).id, outcome: 'processing', reason: '原转账未知' });
  await h.refund(); assert.equal(h.entryTask().status, 'waiting'); assert.deepEqual(h.entryTask().commands, []); assert.notEqual(h.entryTask().sourceStatus, 'settled');
});

test('合法原源缺规则或归属待核对仅waiting；不从当前绑定修复', async () => {
  const h = await fixture(); h.e().ruleSnapshot = null; let task = h.entryTask(); assert.equal(task.status, 'waiting'); assert.deepEqual(task.commands, []);
  delete h.e().sourceSnapshot.ownerType; task = h.entryTask(); assert.equal(task.sourceStatus, 'needs-review'); assert.equal(task.status, 'waiting');
  h.b().servicePromotionSnapshot = null; assert.deepEqual(h.tasks(), []);
});

test('原源串号、重复编号与跨店原债不能进入可办理事项', async () => {
  const h = await fixture({ pair: true }); await h.settle(); await h.refund(h.first, h.b(h.first).payment.amountCents);
  h.d().storeId = 'silver'; assert.equal(h.tasks().some(x => x.category === 'service-promotion-finance-recovery'), false);
  const entry = h.e(); entry.paymentId = h.b(h.first).payment.id; assert.equal(h.tasks().some(x => x.sourceId === entry.id), false);
  const duplicate = await fixture(); duplicate.s.serviceFinanceEntries.push(structuredClone(duplicate.e())); assert.deepEqual(duplicate.tasks(), []);
});

test('实际回款缺原记录不能假closed；sourceToken不含原用户、正文或证据', async () => {
  const h = await fixture({ pair: true }); await h.settle(); await h.refund(h.first, h.b(h.first).payment.amountCents);
  await h.op('finance.recovery-receive', { id: h.d().id, amountCents: h.d().outstandingCents, ...h.proof('PRIVATE-BANK-FACT') });
  const tokens = JSON.stringify(h.tasks());
  for (const secret of ['PRIVATE-CUSTOMER','13800000001','PRIVATE-EVIDENCE-BODY','PRIVATE-REFUND-REASON','PRIVATE-AGREEMENT','PRIVATE-BANK-FACT',file.ref,file.name]) assert.ok(!tokens.includes(secret), secret);
  const record = structuredClone(h.d().records[0]); h.d().records[0].occurredAt = h.s.now + MIN;
  assert.equal(h.debtTask().sourceStatus, 'needs-review');
  h.d().records = []; const task = h.debtTask(); assert.equal(task.sourceStatus, 'needs-review'); assert.equal(task.status, 'waiting'); assert.deepEqual(task.commands, []);
  h.d().records = [record]; assert.equal(h.debtTask().status, 'done');
});

test('原C04追收方案占用时，不生成会被原guard拒绝的split指令', async () => {
  const h = await fixture(); h.s.serviceExtraOffsets.push({ id: 'BOUND-PLAN', entryId: h.e().id, version: 1, status: 'confirmed', normalCents: 4470, recoveryCents: 1000 });
  assert.deepEqual(h.entryTask().commands, []); assert.equal(h.entryTask().status, 'waiting');
  h.s.serviceExtraOffsets[0].status = 'processing'; h.e().split = { id: 'BOUND-SPLIT', kind: 'split', status: 'processing', requestNo: 'BOUND-SPLIT-NO', amountCents: 4470 };
  assert.deepEqual(h.entryTask().commands, []);
});
