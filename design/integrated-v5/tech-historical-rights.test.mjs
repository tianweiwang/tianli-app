import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createTechHistoricalRightsAdapters, techHistoricalRightsCommand } from './tech-historical-rights.mjs';
import { accountCommand, upgradeAccounts, resolveAccountActor } from './staff-accounts.mjs';
import { lifecycleCommand, upgradeOrganizationLifecycle } from './organization-lifecycle.mjs';
import { lifecycleImpact } from './organization-lifecycle-projection.mjs';
import { applyTechnicianTransfer } from './organization-assignment.mjs';
import { qualificationCommand, qualificationEligibility, upgradeQualifications } from './tech-qualification.mjs';
import { upgradeTechIncome, captureTechIncome, syncTechIncome, techIncomeCommand, techIncomeView } from './tech-income.mjs';
import { captureBookingFinance, syncServiceFinance, serviceFinanceCommand, serviceFinanceSummary } from './service-finance.mjs';
import { upgradeServicePromotion, captureTechServicePromoter, captureServicePromotion, syncServicePromotion, servicePromotionCommand, servicePromotionView, servicePromotionBalanceToken } from './service-promotion.mjs';

const DAY = 86400000;
const owner = { role: 'user', userId: 'owner' }, customer = { role: 'user', userId: 'customer' };
const technician = { role: 'tech', techId: 't1' }, finance = { role: 'group', job: 'finance' }, support = { role: 'group', job: 'support' }, ops = { role: 'group', job: 'operations' };
const bytes = new TextEncoder().encode('%PDF-1.4\nIsolated historical-rights runtime proof\n%%EOF');
const evidenceFile = { ref: 'invoice-file:' + createHash('sha256').update(bytes).digest('hex'), name: '原核验凭证.pdf', type: 'application/pdf', size: bytes.length };
const adapters = createTechHistoricalRightsAdapters();

// Runtime unit tests use isolated original source fixtures and real original
// domain commands/getters. No browser, channel or production acceptance is implied.
// serviceFinanceSummary is the real module; financialReady is never fabricated.
function harness({ legacy = false } = {}) {
  let s = {
    schema: 5, seq: 0, now: Date.parse('2026-10-04T10:00:00+08:00'), logs: [],
    users: ['owner', 'customer', 'other'].map(id => ({ id, serviceBinding: { status: 'unbound', recordedAt: Date.parse('2026-10-04T10:00:00+08:00'), version: 0 } })),
    stores: [{ id: 'a', active: true, version: 1, serviceIds: ['relax'] }, { id: 'b', active: true, version: 1, serviceIds: ['relax'] }],
    services: [{ id: 'relax', active: true }], serviceCareCases: [],
    techs: [{ id: 't1', storeId: 'a', version: 1, serviceIds: ['relax'], active: true, reviewStatus: 'approved', qualificationRequired: true, certificate: 'ORIGINAL-CERT', insurance: 'ORIGINAL-INSURANCE', validUntil: '2027-12-31', ...(legacy ? { userId: 'owner' } : {}) }],
    bookings: []
  };
  upgradeAccounts(s); upgradeOrganizationLifecycle(s); upgradeTechIncome(s); upgradeServicePromotion(s); upgradeQualifications(s);
  let sequence = 0;
  const ctx = state => ({
    id: prefix => prefix + ++state.seq,
    fail: message => { throw new Error(message); },
    log: (row, message) => state.logs.push({ id: row.id, message, at: state.now }),
    serviceFinanceSummary,
    applyTechnicianTransfer,
    validateEvidenceRefs: refs => refs.length > 0 && refs.every(file => {
      assert.equal(createHash('sha256').update(bytes).digest('hex'), file.ref.slice(13));
      return JSON.stringify(file) === JSON.stringify(evidenceFile);
    })
  });
  const run = (fn, actor, type, payload = {}) => {
    const next = structuredClone(s), result = fn(next, actor, type, { requestId: 'HISTORY-' + ++sequence, ...payload }, ctx(next));
    s = next; return result;
  };
  const h = {
    get s() { return s; }, get t() { return s.techs[0]; }, get p() { return s.servicePromoters.at(-1); }, get w() { return s.servicePromotionWithdrawals.at(-1); }, get b() { return s.bookings.at(-1); },
    ctx: () => ctx(s), run,
    proof(reference = 'ORIGINAL-PROOF-' + ++sequence) { return { reference, occurredAt: s.now, evidenceRefs: [evidenceFile], reason: '读取实际合成文件后核验原来源' }; },
    promo(command, payload = {}, actor = finance) {
      const row = [...s.servicePromoters, ...s.servicePromotionWithdrawals, ...s.servicePromotionRecoveries].find(row => row.id === (payload.id || payload.promoterId));
      return run(servicePromotionCommand, actor, 'service-promotion.' + command, { version: row?.version || 0, ...payload });
    },
    historical(command, payload = {}, actor = owner) {
      const row = [...s.servicePromoters, ...s.servicePromotionWithdrawals].find(row => row.id === (payload.id || payload.promoterId));
      return run(techHistoricalRightsCommand, actor, 'service-promotion.' + command, { version: row?.version || 0, ...payload });
    },
    sync() { syncServicePromotion(s, ctx(s), { phase: 'projection' }); syncServiceFinance(s, ctx(s)); syncServicePromotion(s, ctx(s)); syncTechIncome(s, ctx(s)); },
    wait(ms = 2 * DAY + 1) { s.now += ms; h.sync(); },
    left() { h.promo('disable', { id: h.p.id, kind: 'exit', reason: '原离职停推广，保留本人资金' }, ops); h.t.lifecycleStatus = 'left'; h.t.active = false; },
    transfer() {
      run(lifecycleCommand, ops, 'lifecycle.transfer-plan', { techId: 't1', version: h.t.version, sourceToken: lifecycleImpact(s, { techId: 't1' }).sourceToken, toStoreId: 'b', targetVersion: s.stores[1].version, effectiveAt: s.now, reference: 'ORIGINAL-TRANSFER', reason: '集团原调店实际记录' });
      assert.equal(h.t.storeId, 'b');
      const profile = () => s.techQualifications.find(q => q.id === h.t.qualificationProfileId);
      const qualify = (type, payload, actor = { role: 'store', storeId: 'b' }) => run(qualificationCommand, actor, 'qualification.' + type, { techId: 't1', storeId: 'b', profileId: profile().id, version: profile().version, reason: '新店按原流程考核授权', ...payload });
      qualify('assess', { serviceIds: ['relax'], batch: '新店单人考核', assessor: '原新店考核员', proof: 'ACTUAL-NEW-QA', occurredAt: s.now, result: 'pass', kind: 'initial' });
      qualify('request', { assessmentId: profile().assessments[0].id });
      qualify('review', { grantId: profile().grants[0].id, decision: 'approve', reviewer: '原集团审核员', proof: 'ACTUAL-NEW-QG' }, ops);
      const grant = profile().grants[0]; assert.equal(qualificationEligibility(s, 't1', 'relax').allowed, true);
      captureTechServicePromoter(s, 't1', { eligible: true, techId: 't1', storeId: 'b', reference: grant.review.proof, verifiedAt: grant.review.at, grantId: grant.id }, ctx(s));
      h.promo('identity-review', { id: h.p.id, decision: 'verified', ...h.proof() }, support);
      h.promo('enter', { promoterId: h.p.id, version: s.users.find(u => u.id === 'other').serviceBinding.version }, { role: 'user', userId: 'other' });
      run(techIncomeCommand, finance, 'tech-income.rule-publish', { storeId: 'b', serviceId: 'all', version: 0, rateBps: 4000, refundPolicy: 'proportional', rounding: 'floor', effectiveAt: s.now, reason: '明确原新店Demo提成参数' });
    },
    earning({ settle = true, amountCents = 100000, userId = 'customer' } = {}) {
      const id = 'B' + ++sequence;
      s.bookings.push({ id, userId, storeId: h.t.storeId, serviceId: 'relax', techId: h.t.id, createdAt: s.now, status: 'confirmed', startedAt: s.now, completedAt: null, payment: { id: 'P-' + id, status: 'success', amountCents, refundedCents: 0, paidAt: s.now }, extensions: [], refunds: [], disputes: [] });
      captureBookingFinance(s, h.b, ctx(s)); captureServicePromotion(s, h.b, ctx(s)); captureTechIncome(s, h.b, ctx(s));
      h.b.status = 'done'; h.b.completedAt = s.now; h.wait();
      if (settle) {
        let v = serviceFinanceSummary(s, id, h.b.payment.id);
        run(serviceFinanceCommand, finance, 'finance.split-start', { id: v.id, version: v.version, outcome: 'success' });
        v = serviceFinanceSummary(s, id, h.b.payment.id);
        run(serviceFinanceCommand, finance, 'finance.finish-start', { id: v.id, version: v.version, outcome: 'success' });
        h.sync(); assert.equal(serviceFinanceSummary(s, id, h.b.payment.id).canPayTech, true);
      } else assert.equal(serviceFinanceSummary(s, id, h.b.payment.id).canPayTech, false);
      return id;
    },
    withdraw(amountCents = 1000, payload = {}) { return h.historical('withdraw-create', { promoterId: h.p.id, amountCents, balanceToken: servicePromotionBalanceToken(s, h.p.id), ...payload }); },
    pay(outcome, payload = {}) { return h.promo('withdraw-pay', { id: h.w.id, outcome, reason: '原转账核对', ...(outcome === 'success' ? h.proof() : {}), ...payload }); },
    query(outcome, payload = {}) { return h.promo('withdraw-query', { id: h.w.id, outcome, reason: '仅查询原转账', ...(outcome === 'success' ? h.proof() : {}), ...payload }); }
  };
  if (!legacy) {
    const admin = run(accountCommand, owner, 'account.enter', { accountId: 'DEMO-ADMIN', grantId: 'DEMO-ADMIN-GRANT' });
    run(lifecycleCommand, admin, 'lifecycle.identity-link', { techId: 't1', userId: 'owner', version: h.t.version, reference: 'ORIGINAL-IDENTITY-CHECK', occurredAt: s.now, reason: '管理员明确本人核验' });
  }
  run(serviceFinanceCommand, finance, 'finance.rule-publish', { scope: 'global', version: 0, groupBps: 1000, storeBps: 500, effectiveAt: s.now, reason: '明确Demo原H参数，正式参数另验' });
  run(techIncomeCommand, finance, 'tech-income.rule-publish', { storeId: 'a', serviceId: 'all', version: 0, rateBps: 4000, refundPolicy: 'proportional', rounding: 'floor', effectiveAt: s.now, reason: '明确Demo原提成参数' });
  const qualify = (type, payload, actor = { role: 'store', storeId: h.t.storeId }) => run(qualificationCommand, actor, 'qualification.' + type, { techId: 't1', version: s.techQualifications.find(q => q.techId === 't1')?.version || 0, reason: '原考核与审核核验', ...payload });
  qualify('assess', { serviceIds: ['relax'], batch: '原单人考核', assessor: '原考核员', proof: 'ACTUAL-QA', occurredAt: s.now, result: 'pass', kind: 'initial' });
  qualify('request', { assessmentId: s.techQualifications[0].assessments[0].id });
  qualify('review', { grantId: s.techQualifications[0].grants[0].id, decision: 'approve', reviewer: '原集团审核员', proof: 'ACTUAL-QG' }, ops);
  const grant = s.techQualifications[0].grants[0];
  assert.equal(qualificationEligibility(s, 't1', 'relax').allowed, true);
  captureTechServicePromoter(s, 't1', { eligible: true, techId: 't1', storeId: 'a', reference: grant.review.proof, verifiedAt: grant.review.at, grantId: grant.id }, ctx(s));
  h.promo('identity-review', { id: h.p.id, decision: 'verified', ...h.proof() }, support);
  h.promo('rule-publish', { promoterType: 'tech', firstBps: 2000, repeatBps: 1000, storeCostBps: 5000, csRounding: 'floor', concurrency: 'completed-created-id', lateFullRefund: 'reassign', effectiveAt: s.now, basis: '明确本地Demo配置，正式D06另验' });
  h.promo('enter', { promoterId: h.p.id, version: s.users.find(u => u.id === 'customer').serviceBinding.version }, customer);
  return h;
}

test('四接口工厂纯读取，prospective/实际left原提成与tech资金不丢失', () => {
  const h = harness(); h.earning();
  const originalIncome = techIncomeView(h.s, technician), originalPromotion = servicePromotionView(h.s, technician), promoterId = h.p.id;
  h.left(); assert.throws(() => servicePromotionView(h.s, technician), /已离职/);
  const before = structuredClone(h.s);
  assert.ok(Object.isFrozen(adapters));
  assert.deepEqual(adapters.incomeView(h.s, owner, 't1'), originalIncome);
  const current = adapters.promotionView(h.s, owner, 't1');
  assert.deepEqual(current.commissions, originalPromotion.commissions);
  assert.equal(current.promoters[0].id, promoterId); assert.equal(current.promoters[0].status, 'disabled');
  assert.deepEqual(current.withdrawals, []); assert.deepEqual(current.recoveries, []);
  assert.deepEqual(h.s, before);
  const probe = structuredClone(h.s); probe.techs[0].lifecycleStatus = 'active';
  assert.deepEqual(adapters.incomeView(probe, owner, 't1'), originalIncome);
});

test('真实legacy tech.userId仍可读，多余及冲突本人映射拒绝', () => {
  const h = harness({ legacy: true }); h.earning(); h.left();
  assert.equal(adapters.incomeView(h.s, owner, 't1').entries.length, 1);
  h.s.techs.push({ id: 'other-tech', userId: 'owner' });
  assert.throws(() => adapters.promotionView(h.s, owner, 't1'), /冲突/);
});

test('真实管理员原link及版本来源保留，缺核验作者/时间/指向拒绝', () => {
  const h = harness(); h.left();
  const link = h.s.organizationIdentityLinks[0];
  assert.equal(link.createdBy.job, 'account-admin'); assert.ok(link.createdBy.accountId);
  assert.equal(adapters.assertCommand(h.s, owner, 'service-promotion.withdraw-create', { techId: 't1', promoterId: h.p.id }).identityLinkId, link.id);
  for (const mutate of [s => s.organizationIdentityLinks = [], s => s.organizationIdentityLinks[0].reference = '', s => s.organizationIdentityLinks[0].createdBy.accountId = null, s => s.organizationIdentityLinks[0].occurredAt = s.now + 1, s => s.organizationIdentityLinks[0].userId = 'other', s => s.organizationIdentityLinks.push(structuredClone(s.organizationIdentityLinks[0]))]) {
    const invalid = structuredClone(h.s); mutate(invalid);
    assert.throws(() => adapters.incomeView(invalid, owner, 't1'), /来源|冲突|重复/);
  }
});

test('其他user、岗位/伪工作session或指定其他tech均不能扩大本人范围', () => {
  const h = harness(); h.earning(); h.left(); const before = structuredClone(h.s);
  for (const actor of [{ role: 'user', userId: 'other' }, support, finance, technician, { ...owner, sessionId: 'FAKE' }, { ...owner, accountId: 'FAKE' }]) {
    assert.throws(() => adapters.incomeView(h.s, actor, 't1'), /本人|离职|会话|用户/);
    assert.throws(() => adapters.promotionView(h.s, actor, 't1'), /本人|离职|会话|用户/);
  }
  assert.throws(() => adapters.promotionView(h.s, owner, 'other-tech'), /来源|其他/);
  assert.deepEqual(h.s, before);
});

test('实际app普通user保留切换tech/store提示，提示不选本人也不能扩大资金目标', () => {
  const h = harness(); h.earning(); h.left();
  // app initialActor retains these switches while role=user. They are UI hints,
  // not the historical subject; the explicit target and source stay binding.
  const actor = { ...owner, techId: 'unrelated-ui-selection', storeId: 'unrelated-ui-store' };
  const before = structuredClone(h.s);
  assert.deepEqual(adapters.incomeView(h.s, actor, 't1'), adapters.incomeView(h.s, owner, 't1'));
  assert.deepEqual(adapters.promotionView(h.s, actor, 't1'), adapters.promotionView(h.s, owner, 't1'));
  assert.equal(adapters.assertCommand(h.s, actor, 'service-promotion.withdraw-create', { techId: 't1', promoterId: h.p.id }).techId, 't1');
  assert.deepEqual(h.s, before);
  assert.throws(() => adapters.incomeView(h.s, actor, 'unrelated-ui-selection'), /来源|其他/);
  assert.throws(() => adapters.assertCommand(h.s, actor, 'service-promotion.withdraw-create', { techId: 'unrelated-ui-selection', promoterId: h.p.id }), /来源|其他/);
  h.historical('withdraw-create', { promoterId: h.p.id, amountCents: 1000, balanceToken: servicePromotionBalanceToken(h.s, h.p.id) }, actor);
  assert.equal(h.w.personKey, 'tech:t1'); assert.equal(h.w.history.at(-1).by.historicalUserId, 'owner');
  assert.throws(() => h.historical('withdraw-cancel', { id: h.w.id, reason: '仅界面hint不能认本人' }, { ...actor, userId: 'other' }), /本人/);
});

test('缺原账容器、预约/原支付、旧身份或重复源不能当零余额', () => {
  const h = harness(); h.earning(); h.left();
  for (const mutate of [s => delete s.serviceCommissions, s => s.bookings = [], s => s.bookings[0].payment.id = 'REPLACED', s => s.servicePromoters = [], s => s.serviceCommissions.push(structuredClone(s.serviceCommissions[0])), s => s.bookings[0].servicePromotionSnapshot.promoter.personId = 'OTHER']) {
    const invalid = structuredClone(h.s); mutate(invalid);
    assert.throws(() => adapters.promotionView(invalid, owner, 't1'), /来源|身份|快照/);
  }
  const invalid = structuredClone(h.s); delete invalid.techIncomeEntries;
  assert.throws(() => adapters.incomeView(invalid, owner, 't1'), /容器缺失/);
});

test('三个原关闭信号均拒桥，原资金完整保留待C09闭域核验', () => {
  const h = harness(); h.earning(); h.left();
  for (const close of [s => s.users[0].status = 'closed', s => s.privacyProfiles = [{ userId: 'owner', status: 'use_closed' }], s => s.privacyClosures = [{ userId: 'owner', status: 'use_closed' }]]) {
    const invalid = structuredClone(h.s); close(invalid); const before = structuredClone(invalid);
    for (const read of [() => adapters.incomeView(invalid, owner, 't1'), () => adapters.promotionView(invalid, owner, 't1'), () => adapters.assertCommand(invalid, owner, 'service-promotion.withdraw-create', { techId: 't1', promoterId: h.p.id }), () => adapters.authorizeFile(invalid, owner, evidenceFile.ref, { techId: 't1' })]) assert.throws(read, /闭域来源尚未接齐/);
    assert.deepEqual(invalid, before);
  }
});

test('离职普通user实际原withdraw-create保留旧personKey、余额占额和审计', () => {
  const h = harness(); h.earning(); h.left();
  const commissions = structuredClone(h.s.serviceCommissions), income = structuredClone(h.s.techIncomeEntries);
  h.withdraw(1000);
  assert.equal(h.w.personKey, 'tech:t1'); assert.equal(h.w.personId, 't1'); assert.equal(h.w.promoterId, h.p.id);
  assert.equal(h.w.allocations[0].commissionId, commissions[0].id);
  assert.equal(h.w.history.at(-1).by.historicalUserId, 'owner'); assert.equal(h.w.history.at(-1).by.identityLinkId, h.t.identityLinkId);
  assert.equal(adapters.promotionView(h.s, owner, 't1').balances[0].dailyCreated, 1);
  assert.deepEqual(h.s.techIncomeEntries, income);
  assert.equal(h.s.servicePromoters.length, 1);
});

test('assertCommand只证明原route；实际未实名、缺财务适配、未结清和旧token原guard仍拒', () => {
  const h = harness(); h.earning({ settle: false }); h.left();
  assert.equal(adapters.assertCommand(h.s, owner, 'service-promotion.withdraw-create', { techId: 't1', promoterId: h.p.id }).allowed, true);
  const before = structuredClone(h.s); assert.throws(() => h.withdraw(), /余额不足/); assert.deepEqual(h.s, before);
  const ready = harness(); ready.earning(); ready.left();
  const payload = { promoterId: ready.p.id, amountCents: 1000, version: ready.p.version, balanceToken: servicePromotionBalanceToken(ready.s, ready.p.id), requestId: 'ORIGINAL-GUARD' };
  const noIdentity = structuredClone(ready.s); noIdentity.servicePromoters[0].identity = null;
  assert.throws(() => techHistoricalRightsCommand(noIdentity, owner, 'service-promotion.withdraw-create', payload, ready.ctx()), /实际实名/);
  assert.throws(() => techHistoricalRightsCommand(structuredClone(ready.s), owner, 'service-promotion.withdraw-create', payload, {}), /结清适配/);
  assert.throws(() => ready.withdraw(1000, { balanceToken: 'fake' }), /已变化/);
  assert.throws(() => ready.withdraw(1000, { version: ready.p.version - 1 }), /版本|变化/);
});

test('原请求幂等和同额并发不重计次、不重造原资金', () => {
  const h = harness(); h.earning(); h.left();
  const payload = { promoterId: h.p.id, amountCents: 1000, balanceToken: servicePromotionBalanceToken(h.s, h.p.id), version: h.p.version, requestId: 'ORIGINAL-STABLE' };
  h.historical('withdraw-create', payload); const once = structuredClone(h.s);
  h.historical('withdraw-create', payload); assert.deepEqual(h.s, once);
  assert.throws(() => h.historical('withdraw-create', { ...payload, requestId: 'PARALLEL' }), /已变化/);
  assert.throws(() => h.historical('withdraw-create', { ...payload, amountCents: 2000 }), /不同内容/);
});

test('原撤销仍占日次数，第三笔后继续沿原policy守卫', () => {
  const h = harness(); h.earning(); h.left();
  const limit = adapters.promotionView(h.s, owner, 't1').effectivePolicy.dailyLimit;
  for (let i = 0; i < limit; i++) { h.withdraw(); h.historical('withdraw-cancel', { id: h.w.id, reason: '本人明确未转账撤销' }); }
  assert.equal(h.s.servicePromotionWithdrawals.length, limit);
  assert.throws(() => h.withdraw(), /笔提现申请/);
  assert.equal(adapters.promotionView(h.s, owner, 't1').balances[0].dailyCreated, limit);
});

test('未知原转账不可直接撤销；本人确认仍不造到账、过期仍原guard', () => {
  const h = harness(); h.earning(); h.left(); h.withdraw();
  h.pay('processing'); assert.throws(() => h.historical('withdraw-cancel', { id: h.w.id, reason: '不猜转账结果' }), /未知/);
  h.query('awaiting_user', { confirmExpiresAt: h.s.now + 60000 });
  const paidBefore = adapters.promotionView(h.s, owner, 't1').commissions[0].paidCents;
  h.historical('withdraw-confirm', { id: h.w.id, decision: 'accept', reason: '本人确认同一原提现' });
  assert.equal(h.w.status, 'processing'); assert.equal(adapters.promotionView(h.s, owner, 't1').commissions[0].paidCents, paidBefore);
  h.query('success'); assert.equal(adapters.promotionView(h.s, owner, 't1').commissions[0].paidCents, 1000);
  const expired = harness(); expired.earning(); expired.left(); expired.withdraw(); expired.pay('awaiting_user', { confirmExpiresAt: expired.s.now + 60000 }); expired.wait(60000);
  assert.throws(() => expired.historical('withdraw-confirm', { id: expired.w.id, decision: 'accept', reason: '原确认期限已过' }), /有效/);
  expired.historical('withdraw-confirm', { id: expired.w.id, decision: 'reject', reason: '本人拒收继续原笔查询' });
  assert.equal(expired.w.status, 'cancel_requested');
});

test('原扣回由原成功付款/退款生成，本人读债务且不能实施财务动作', () => {
  const h = harness(); h.earning(); h.left(); h.withdraw();
  h.pay('awaiting_user', { confirmExpiresAt: h.s.now + DAY }); h.historical('withdraw-confirm', { id: h.w.id, decision: 'accept', reason: '本人确认原笔' }); h.query('success');
  h.b.payment.refundedCents = h.b.payment.amountCents;
  h.b.refunds.push({ id: 'ORIGINAL-RF', status: 'success', executions: [{ paymentId: h.b.payment.id, status: 'success', amountCents: h.b.payment.amountCents, completedAt: h.s.now }] }); h.sync();
  const debt = h.s.servicePromotionRecoveries[0]; assert.ok(debt); assert.equal(debt.personKey, 'tech:t1');
  const view = adapters.promotionView(h.s, owner, 't1'); assert.equal(view.recoveries[0].id, debt.id); assert.equal(view.recoveries[0].outstandingCents, 1000);
  assert.equal(techHistoricalRightsCommand(h.s, owner, 'service-promotion.recovery-receive', { id: debt.id }, h.ctx()), undefined);
  assert.throws(() => adapters.assertCommand(h.s, owner, 'service-promotion.withdraw-pay', { techId: 't1', promoterId: h.p.id }), /只允许/);
  assert.throws(() => servicePromotionCommand(structuredClone(h.s), owner, 'service-promotion.recovery-receive', { id: debt.id }, h.ctx()), /无权/);
});

test('实际原内部身份/财务附件授权均deny，保留精确ref与来源槽', () => {
  const h = harness(); h.earning(); h.left();
  const result = adapters.authorizeFile(h.s, owner, evidenceFile.ref, { techId: 't1', id: h.p.id, slot: 'identity:0' });
  assert.equal(result.allowed, false); assert.equal(result.reference, evidenceFile.ref); assert.equal(result.userId, 'owner'); assert.equal(result.techId, 't1'); assert.equal(result.personKey, 'tech:t1'); assert.equal(result.file, undefined);
  assert.equal(result.slot, 'identity:0'); assert.ok(result.reason);
  assert.equal(adapters.promotionView(h.s, owner, 't1').promoters[0].identityEvidenceRefs, undefined);
  h.withdraw(); h.pay('awaiting_user', { confirmExpiresAt: h.s.now + DAY }); h.historical('withdraw-confirm', { id: h.w.id, decision: 'accept', reason: '本人确认' }); h.query('success');
  assert.equal(adapters.authorizeFile(h.s, owner, evidenceFile.ref, { techId: 't1', id: h.w.id, slot: 'payment:0' }).allowed, false);
  assert.equal(JSON.stringify(adapters.promotionView(h.s, owner, 't1').withdrawals).includes(evidenceFile.ref), false);
});

test('附件每次核当前本人源/原slot，伪ref、换slot、源删除和失权即拒', () => {
  const h = harness(); h.left();
  assert.throws(() => adapters.authorizeFile(h.s, { role: 'user', userId: 'other' }, evidenceFile.ref, { techId: 't1' }), /本人/);
  assert.throws(() => adapters.authorizeFile(h.s, owner, evidenceFile.ref, { techId: 't1', id: h.p.id, slot: 'identity:1' }), /来源槽/);
  assert.throws(() => adapters.authorizeFile(h.s, owner, 'invoice-file:' + 'f'.repeat(64), { techId: 't1' }), /来源槽/);
  h.p.identity.evidenceRefs = []; assert.throws(() => adapters.authorizeFile(h.s, owner, evidenceFile.ref, { techId: 't1' }), /来源槽/);
  h.t.userId = 'other'; assert.throws(() => adapters.incomeView(h.s, owner, 't1'), /冲突/);
});

test('纯本人route probe允许不完整表单，实际确认缺id/decision仍拒绝', () => {
  const h = harness(); h.earning(); h.left();
  for (const type of ['withdraw-create', 'withdraw-confirm', 'withdraw-cancel']) assert.equal(adapters.assertCommand(h.s, owner, 'service-promotion.' + type, { techId: 't1', promoterId: h.p.id }).allowed, true);
  assert.throws(() => h.historical('withdraw-confirm', { techId: 't1', promoterId: h.p.id }), /准确原申请/);
  h.withdraw(); h.pay('awaiting_user', { confirmExpiresAt: h.s.now + DAY });
  assert.throws(() => h.historical('withdraw-confirm', { id: h.w.id, reason: '不能省略本人决定' }), /决定|有效/);
});

test('旧提成发放和成功退款差额保持原getter，不授予普通user财务写入', () => {
  const h = harness(); h.earning(); const entry = h.s.techIncomeEntries[0];
  h.run(techIncomeCommand, { role: 'store', storeId: 'a' }, 'tech-income.payout', { techId: 't1', month: entry.month, lines: [{ entryId: entry.id, version: entry.version }], paidAt: h.s.now, proof: 'ACTUAL-PAYOUT', reason: '原店实际发放' });
  h.b.payment.refundedCents = 10000; h.sync();
  const original = techIncomeView(h.s, technician); assert.equal(original.payouts.length, 1); assert.equal(original.adjustments.length, 1); assert.equal(original.differences.length, 1);
  h.left(); assert.deepEqual(adapters.incomeView(h.s, owner, 't1'), original);
  assert.throws(() => h.run(techIncomeCommand, owner, 'tech-income.difference-record', { id: original.differences[0].id }), /仅|无权|财务/);
});

test('普通user自己的非tech推广命令由原dispatcher继续处理', () => {
  const h = harness();
  h.s.servicePromoters.push({ id: 'USER-PROMOTER', personKind: 'user', personId: 'owner' });
  assert.equal(techHistoricalRightsCommand(h.s, owner, 'service-promotion.withdraw-create', { promoterId: 'USER-PROMOTER' }, h.ctx()), undefined);
  assert.equal(techHistoricalRightsCommand(h.s, owner, 'tech-income.payout', {}, h.ctx()), undefined);
  assert.equal(resolveAccountActor(h.s, owner).role, 'user');
});

test('真实原调店与新店考核不复制资格，两店历史技师资金完整归原personKey', () => {
  const h = harness(); h.earning(); const oldPromoter = h.p.id, oldIncome = h.s.techIncomeEntries[0].id;
  h.transfer(); h.earning({ userId: 'other' }); const newPromoter = h.p.id; h.left();
  const before = structuredClone(h.s), view = adapters.promotionView(h.s, owner, 't1');
  assert.notEqual(oldPromoter, newPromoter); assert.deepEqual(view.promoters.map(p => p.id), [oldPromoter, newPromoter]);
  assert.deepEqual(view.commissions.map(c => c.storeId), ['a', 'b']);
  const income = adapters.incomeView(h.s, owner, 't1'); assert.deepEqual(income.entries.map(e => e.storeId), ['a', 'b']); assert.equal(income.entries[0].id, oldIncome);
  assert.deepEqual(h.s, before);
  h.historical('withdraw-create', { promoterId: oldPromoter, amountCents: 1000, version: h.s.servicePromoters[0].version, balanceToken: servicePromotionBalanceToken(h.s, oldPromoter) });
  assert.equal(h.w.promoterId, oldPromoter); assert.equal(h.w.personKey, 'tech:t1'); assert.equal(h.s.servicePromoters.length, 2);
});

test('原本人资金关联错personKey、提现串号或外部ctx不能转主体', () => {
  const h = harness(); h.earning(); h.left(); h.withdraw();
  const invalid = structuredClone(h.s); invalid.serviceCommissions[0].personKey = 'user:owner';
  assert.throws(() => adapters.promotionView(invalid, owner, 't1'), /personKey来源冲突/);
  assert.throws(() => h.historical('withdraw-cancel', { id: h.w.id, promoterId: 'OTHER', reason: '串号' }), /来源/);
  const before = structuredClone(h.s);
  assert.throws(() => techHistoricalRightsCommand(h.s, { role: 'user', userId: 'other' }, 'service-promotion.withdraw-cancel', { id: h.w.id, version: h.w.version, reason: '不能自报callback', requestId: 'FORGED' }, { ...h.ctx(), historicalTechOwner: () => ({ techId: 't1', userId: 'other', personKey: 'tech:t1' }) }), /本人/);
  assert.deepEqual(h.s, before);
});

test('明确旧本人协议来源沿原ACL可读，其他同类型全局协议不开放', () => {
  const h = harness();
  h.promo('agreement-publish', { promoterType: 'staff', title: '实际原协议', body: '原文件保留本人准确授权槽', effectiveAt: h.s.now, ...h.proof() }, support);
  const agreement = h.s.servicePromotionAgreements[0];
  // Isolated persisted legacy tech invitation source. This is not a new tech
  // invitation policy or a shortcut that creates/approves promotion identity.
  h.s.servicePromotionInvites.push({ id: 'LEGACY-TECH-INVITE', personKind: 'tech', personId: 't1', status: 'accepted', agreementSnapshot: structuredClone(agreement) });
  h.p.agreementSnapshot = structuredClone(agreement); h.p.promoterType = 'staff'; h.left();
  const before = structuredClone(h.s), result = adapters.authorizeFile(h.s, owner, evidenceFile.ref, { techId: 't1', id: agreement.id, slot: 'agreement:0' });
  assert.equal(result.allowed, true); assert.equal(result.id, agreement.id); assert.equal(result.slot, 'agreement:0'); assert.deepEqual(result.file, evidenceFile);
  assert.equal(adapters.authorizeFile(h.s, owner, evidenceFile.ref, { techId: 't1', id: h.p.id, slot: 'identity:0' }).allowed, false);
  assert.deepEqual(adapters.promotionView(h.s, owner, 't1').agreements[0].evidenceRefs, [evidenceFile]); assert.deepEqual(h.s, before);
  h.s.servicePromotionInvites[0].personId = 'other';
  assert.equal(adapters.authorizeFile(h.s, owner, evidenceFile.ref, { techId: 't1', id: agreement.id, slot: 'agreement:0' }).allowed, false);
  assert.deepEqual(adapters.promotionView(h.s, owner, 't1').agreements[0].evidenceRefs, []);
});
