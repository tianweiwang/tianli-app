import { upgradeWorkTasks, workTaskCommand } from './work-tasks.mjs';
import { upgradeWorkEscalations, workEscalationCommand } from './work-escalation.mjs';
import { takeOver } from './work-native-takeover.mjs';
import { reportExport } from './operations-reports.mjs';
import { upgradeCommerceInvoices, syncCommerceInvoices, commerceInvoiceCommand } from './commerce-invoices.mjs';
import { upgradeFulfilment, fulfilmentCommand, captureFulfilmentTransition, tickFulfilment } from './fulfilment.mjs';
import { upgradeGoodsSettlement, syncGoodsSettlement, assertGoodsSettlementCommand, goodsSettlementCommand } from './goods-settlement.mjs';
import { upgradeAccounts, resolveAccountActor, assertAccountCommand, actorAccountFields, accountCommand } from './staff-accounts.mjs';
import { upgradePrivacy, assertPrivacyCommand, captureBookingPrivacy, privacyCommand } from './privacy.mjs';
import { sensitiveAccessCommand } from './sensitive-access.mjs';
import { bookingSeed, bookingCommand, bookingView } from './booking.mjs';
import { upgradeManagement, managementCommand, assertJob, stockMove, storeOpeningReadiness } from './management.mjs';
import { upgradeInvoices, syncInvoices, invoiceCommand } from './service-invoices.mjs';
import { upgradeServiceFinance, syncServiceFinance, serviceFinanceCommand, serviceFinanceSummary } from './service-finance.mjs';
import { serviceFinanceCompositionReviewCommand, createServiceFinanceCompositionEvidenceValidator } from './service-finance-composition-review.mjs';
import { upgradeServicePromotion, syncServicePromotion, servicePromotionCommand, captureServicePromotion, captureExtensionPromotion, captureTechServicePromoter } from './service-promotion.mjs';
import { upgradeTechIncome, syncTechIncome, techIncomeCommand } from './tech-income.mjs';
import { upgradeServiceReviews, serviceReviewCommand } from './service-reviews.mjs';
import { upgradeCare, syncCare, careCommand } from './service-care.mjs';
import { upgradeQualifications, qualificationCommand, qualificationEligibility } from './tech-qualification.mjs';
import { upgradeHandoffs, recipientCommand, handoffCommand } from './service-handoff.mjs';
import { upgradeGoodsExceptions, syncGoodsExceptions, goodsExceptionCommand, goodsExceptionRequest, rememberGoodsExceptionRequest, goodsShippingBlocked } from './goods-exceptions.mjs';
import { upgradeGoodsLogisticsPolicy, captureGoodsLogisticsPolicy, goodsLogisticsCommand, goodsLogisticsAutoReceipt, tickGoodsLogistics } from './goods-logistics-policy.mjs';
import { upgradeServiceFinanceExtras, syncServiceFinanceExtras, assertServiceFinanceExtrasCommand, serviceFinanceExtrasCommand } from './service-finance-extras.mjs';
import { createServiceFinanceExtrasBridges } from './service-finance-bridges.mjs';
import { upgradeOrganizationLifecycle, lifecycleCommand, syncLifecycle } from './organization-lifecycle.mjs';
import { applyTechnicianTransfer } from './organization-assignment.mjs';
import { lifecycleAuthorityCommand, lifecycleAuthorityPreflight, applyLifecycleAuthorityExit } from './organization-lifecycle-authority.mjs';
import { createTechHistoricalRightsAdapters, techHistoricalRightsCommand } from './tech-historical-rights.mjs';
import { upgradeTechnicianPenalties, technicianPenaltyCommand } from './technician-penalties.mjs';
import { upgradeQualityPolicies, qualityPolicyCommand } from './quality-policy.mjs';

export const money = cents => '¥' + (Number(cents || 0) / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// Completion previews and the original transaction use the same real adapters.
// A payload cannot replace these source, authority or historical-owner checks.
export function createLifecycleContext() {
  return Object.freeze({ goodsSummary, applyTechnicianTransfer, lifecycleAuthorityCommand,
    lifecycleAuthorityPreflight, applyLifecycleAuthorityExit, storeOpeningReadiness,
    historicalRightsAdapters: createTechHistoricalRightsAdapters() });
}
const fail = message => { throw new Error(message); };
const integer = (value, min = 0) => { const n = Number(value); if (!Number.isSafeInteger(n) || n < min) fail('请输入有效的整数金额或数量。'); return n; };
const text = (value, label) => { const v = String(value || '').trim(); if (!v || v.length > 300) fail('请填写' + label + '（最多300字）。'); return v; };
const activeCase = c => !['rejected', 'done', 'closed'].includes(c.status);
const sum = (rows, get) => rows.reduce((n, row) => n + get(row), 0);
function syncServiceFunds(s,ctx) {
  ctx.serviceFinanceSummary=serviceFinanceSummary;
  syncServicePromotion(s,ctx,{phase:'sources'});
  syncServiceFinance(s,ctx); syncServiceFinanceExtras(s,ctx);
  syncServicePromotion(s,ctx,{phase:'funds'});
  // New commission offsets can release a retained store share. Reproject the
  // original money ledger before exposing readiness; successful facts stay intact.
  syncServiceFinance(s,ctx); syncServicePromotion(s,ctx,{phase:'funds'});
  syncServiceFinance(s,ctx); syncTechIncome(s,ctx);
}
// Additive loading migration: derive ledgers only from existing successful facts.
// Called while loading a saved session, never from a view renderer.
export function upgradeFinanceState(s) {
  upgradeOrganizationLifecycle(s);
  upgradeCommerceInvoices(s);
  upgradeFulfilment(s);
  upgradeWorkEscalations(s);
  upgradeGoodsSettlement(s);
  upgradeAccounts(s); upgradePrivacy(s); upgradeWorkTasks(s); upgradeQualifications(s); upgradeServiceReviews(s); upgradeCare(s); upgradeHandoffs(s);
  upgradeServiceFinance(s); upgradeTechIncome(s);
  upgradeServiceFinanceExtras(s);
  upgradeServicePromotion(s);
  upgradeTechnicianPenalties(s);
  upgradeQualityPolicies(s);
  const ctx = { fail, id: prefix => prefix + (++s.seq), log: (entity, content) => {
    const event = { at: s.now, text: content, actor: 'system', job: null, actorId: 'system' };
    (entity.events ??= []).push(event); (s.logs ??= []).push({ ...event, id: entity.id || '' });
  } };
  syncCare(s, ctx); syncServiceFunds(s,ctx); return s;
}
// Keep a bill difference independent from recalculated amounts. Older schema-5
// records may have lost their status, but their ordered events still preserve it.
export function upgradeGoods(s) {
  upgradeGoodsSettlement(s);
  upgradeGoodsExceptions(s);
  upgradeGoodsLogisticsPolicy(s);
  for (const b of s.bills || []) {
    if (!b.dispute) {
      let pending;
      for (const event of b.events || []) {
        if (event.text?.startsWith('门店提出差异 · ')) pending = event;
        else if (event.text?.startsWith('集团完成差异核查')) pending = null;
      }
      if (pending || b.status === 'disputed') b.dispute = { status: 'open', reason: pending?.text.slice('门店提出差异 · '.length) || b.reason || '历史账单差异待核查', openedAt: pending?.at || b.createdAt, openedVersion: b.version, recoveredFromLegacy: true };
    }
    if (b.dispute?.status === 'open') {
      if (!['paid', 'processing'].includes(b.status)) b.status = 'disputed';
      b.reason = b.dispute.reason;
    }
  }
  return s;
}
export function seed() {
  return upgradeCare(upgradeServiceReviews(upgradeManagement({
    ...bookingSeed(), schema: 5, revision: 0, now: Date.parse('2026-10-02T09:00:00+08:00'), seq: 1000,
    users: [{ id: 'u1', name: '王女士' }, { id: 'u2', name: '李先生' }].map(user => ({ ...user, serviceBinding: { status: 'unbound', recordedAt: Date.parse('2026-10-02T09:00:00+08:00'), origin: 'demo-initial' } })),
    skus: [
      { id: 'oil', name: 'IGOOD修复液', spec: '标准瓶装', category: '日常护理', priceCents: 20000, commissionBps: 1000, stock: 12, active: true, image: '../reference-demos/franchise-demo/products/igood-01.svg' },
      { id: 'oil-small', name: 'IGOOD修复液', spec: '便携瓶装', category: '日常护理', priceCents: 10000, commissionBps: 1000, stock: 8, active: true, image: '../reference-demos/franchise-demo/products/igood-01.svg' },
      { id: 'care', name: 'IGOOD蛋白粉', spec: '单罐装', category: '营养食品', priceCents: 10000, commissionBps: 2000, stock: 20, active: true, image: '../reference-demos/franchise-demo/products/igood-02.svg' }
    ],
    carts: {}, addresses: [
      { id: 'AD1', userId: 'u1', name: '王女士', phone: '13800008000', province: '江苏省', city: '南京市', detail: '示例路128号1幢101室（演示地址）' },
      { id: 'AD2', userId: 'u2', name: '李先生', phone: '13800008001', province: '江苏省', city: '南京市', detail: '示例路66号2幢202室（演示地址）' }
    ], promotions: {}, goods: [], bills: [], recoveries: [], serviceInvoices: [], serviceInvoiceRequests: [], logs: [],
    settings: { sourceHours: 24, paymentMinutes: 15, waitDays: 7, shippingCents: 1000, version: 'DEMO-1' }
  })));
}

export function availableStock(s, skuId) {
  const sku = s.skus.find(x => x.id === skuId);
  if (!sku) return 0;
  const held = sum(s.goods.filter(o => ['unpaid', 'paid'].includes(o.status)), o => sum(o.lines.filter(l => l.skuId === skuId), l => l.qty - (l.cancelledQty || 0)));
  return sku.stock - held;
}
export function goodsSummary(s, o) {
  const refundedCents = sum(o.refunds.filter(r => r.status === 'success'), r => r.amountCents);
  const commissionCents = o.source ? sum(o.lines, l => Math.floor((l.paidCents - l.refundedCents) * l.commissionBps / 10000)) : 0;
  const goodsFullyRefunded = o.lines.length > 0 && o.lines.every(l => l.refundedCents >= l.paidCents);
  const zeroCommissionReason = o.lines.every(l => l.commissionBps === 0) ? '推广规则为零佣金，无需结算' : '佣金按分取整后为零，无需结算';
  const openCase = o.cases.some(activeCase), open = openCase || o.status === 'received' && (o.incidents || []).some(i => i.status !== 'done');
  const reason = !o.source ? '自然购买，无门店佣金' : o.payment.status !== 'success' ? '尚未支付' : goodsFullyRefunded ? '商品金额已全退' : commissionCents === 0 ? zeroCommissionReason : open ? openCase ? '售后或退款处理中' : '物流或退货异常待处理' : o.status !== 'received' ? '等待收货' : s.now < o.receivedAt + o.waitDays * 86400000 ? '售后结算等待期未结束' : '';
  const bill = s.bills.find(b => (b.status !== 'paid' || b.dispute?.status === 'open') && b.items.some(i => i.orderId === o.id));
  const debtCents = sum(s.recoveries.filter(r => r.orderId === o.id), r => Math.max(0, r.amountCents - r.recoveredCents));
  const commissionStatus = !o.source ? '无需结算' : o.payment.status !== 'success' ? '未产生' : bill?.dispute?.status === 'open' ? '账单有差异' : commissionCents === 0 ? (debtCents ? '已付待追回' : o.commissionPaidCents ? '已追回结清' : bill?.status === 'processing' ? '付款待核查' : goodsFullyRefunded ? '已作废' : '无需结算') : debtCents ? '待追回' : open ? '阻断中' : bill ? ({ review: '待门店核对', disputed: '账单有差异', confirmed: '待付款', processing: '付款中', failed: '付款失败', adjusted: '账单待重核' }[bill.status]) : o.commissionPaidCents >= commissionCents ? '已付' : reason ? '预估' : '可结算';
  return { refundedCents, netCents: o.payment.status === 'success' ? o.paidCents - refundedCents : 0, commissionCents, commissionStatus, commissionReason: reason, debtCents };
}
// Original goods.case arithmetic, shared with its read-only customer capabilities.
function goodsAfterSaleLimits(o) {
  const shippingCents=o.shippingCents-sum(o.cases.filter(x=>activeCase(x)||x.status==='done'),x=>x.shippingCents);
  return {availableCents:o.paidCents-sum(o.refunds.filter(r=>r.status==='success'),r=>r.amountCents)-sum(o.cases.filter(activeCase),c=>c.amountCents+c.shippingCents),shippingCents,
    remainingCancelQty:sum(o.lines,l=>l.qty-l.cancelledQty),lines:o.lines.map(l=>({skuId:l.skuId,unitCents:l.unitCents,
      amountCents:l.paidCents-l.refundedCents-sum(o.cases.filter(activeCase),x=>sum(x.allocations.filter(a=>a.skuId===l.skuId),a=>a.amountCents)),
      refundQty:l.qty-l.cancelledQty,
      returnQty:l.qty-l.cancelledQty-l.returnedQty-sum(o.cases.filter(x=>x.kind==='return'&&activeCase(x)&&!x.inspectedAt),x=>x.skuId===l.skuId?x.qty:0),
      cancelQty:l.qty-l.cancelledQty-sum(o.cases.filter(x=>x.kind==='cancel'&&x.status==='requested'),x=>sum(x.allocations.filter(a=>a.skuId===l.skuId),a=>a.qty))}))};
}
export function goodsAfterSaleAvailability(s,rawActor,orderId) {
  const actor=resolveAccountActor(s,rawActor),orders=(s.goods||[]).filter(o=>o.id===orderId);
  if(actor?.role!=='user'||typeof actor.userId!=='string'||!(s.users||[]).some(u=>u.id===actor.userId)||typeof orderId!=='string'||!orderId||orders.length!==1||orders[0].userId!==actor.userId)fail('原商品订单不存在或当前身份无权访问。');
  const o=orders[0],valid=n=>Number.isSafeInteger(n)&&n>=0,shaped=Array.isArray(o.lines)&&Array.isArray(o.cases)&&Array.isArray(o.refunds)&&o.lines.every(l=>l&&typeof l==='object')&&o.refunds.every(r=>r&&typeof r==='object')&&o.cases.every(c=>c&&typeof c==='object'&&Array.isArray(c.allocations)&&c.allocations.every(a=>a&&typeof a==='object'));
  const limits=shaped?goodsAfterSaleLimits(o):null,active=shaped?o.cases.filter(activeCase):[],usedShipping=shaped?o.cases.filter(x=>activeCase(x)||x.status==='done'):[];
  const statuses=shaped&&o.cases.every(c=>typeof c.status==='string'&&c.status.length>0)&&o.refunds.every(r=>['success','processing','failed','closed','withdrawn'].includes(r.status));
  const availableCents=limits&&statuses&&valid(o.paidCents)&&o.refunds.filter(r=>r.status==='success').every(r=>valid(r.amountCents))&&active.every(c=>valid(c.amountCents)&&valid(c.shippingCents))&&valid(limits.availableCents)?limits.availableCents:null;
  const shippingCents=limits&&statuses&&valid(o.shippingCents)&&usedShipping.every(c=>valid(c.shippingCents))&&valid(limits.shippingCents)?limits.shippingCents:null;
  const lines=(Array.isArray(o.lines)?o.lines:[]).map((l,index)=>{
    const raw=limits?.lines[index],identity=typeof l?.skuId==='string'&&l.skuId.length>0&&o.lines.filter(x=>x?.skuId===l.skuId).length===1,allocations=active.flatMap(c=>c.allocations.filter(a=>a.skuId===l?.skuId)),pendingReturn=shaped?o.cases.filter(c=>c.kind==='return'&&activeCase(c)&&!c.inspectedAt&&c.skuId===l?.skuId):[],pendingCancel=shaped?o.cases.filter(c=>c.kind==='cancel'&&c.status==='requested').flatMap(c=>c.allocations.filter(a=>a.skuId===l?.skuId)):[];
    const amountCents=raw&&identity&&statuses&&valid(l.paidCents)&&valid(l.refundedCents)&&allocations.every(a=>valid(a.amountCents))&&valid(raw.amountCents)?raw.amountCents:null,unitCents=identity&&valid(l?.unitCents)?l.unitCents:null;
    const baseQty=raw&&identity&&statuses&&valid(l.qty)&&valid(l.cancelledQty)&&valid(raw.refundQty),refundQty=baseQty?raw.refundQty:null,returnQty=baseQty&&valid(l.returnedQty)&&pendingReturn.every(c=>valid(c.qty))&&valid(raw.returnQty)?raw.returnQty:null,cancelQty=baseQty&&pendingCancel.every(a=>valid(a.qty))&&valid(raw.cancelQty)?raw.cancelQty:null;
    const known=[amountCents,unitCents,refundQty,returnQty,cancelQty].every(x=>x!==null);return{skuId:identity?l.skuId:null,known,reason:known?'':'原商品行金额、数量或售后占额缺少完整依据，待核对',amountCents,unitCents,refundQty,returnQty,cancelQty};
  });
  const version=valid(o.version)?o.version:null,phaseKnown=['unpaid','paid','shipped','received','cancelled','closed'].includes(o.status)&&['unpaid','processing','failed','success','closed'].includes(o.payment?.status),known=availableCents!==null&&shippingCents!==null&&version!==null&&phaseKnown&&lines.length>0&&lines.every(l=>l.known),paid=known&&o.payment.status==='success';
  return structuredClone({orderId:o.id,version,known,status:known?'known':'needs-review',reason:known?'':'原商品支付金额、运费、数量、版本或售后占额依据待核对',availableCents,shippingCents,canCancel:Boolean(paid&&o.status==='paid'),canRefund:Boolean(paid&&['shipped','received'].includes(o.status)),canReturn:Boolean(paid&&['shipped','received'].includes(o.status)),lines});
}
export function visible(s, actor) {
  actor = resolveAccountActor(s, actor);
  return { bookings: bookingView(s, actor), goods: s.goods.filter(o => actor.role === 'group' || (actor.role === 'user' && o.userId === actor.userId) || (['store', 'manager'].includes(actor.role) && o.source?.storeId === actor.storeId)) };
}

export function reduce(previous, actor, type, p = {}, onResult = () => {}, runtimeEvidence = null) {
  if (type === 'booking.tick') fail('时钟维护只能由演示时间工具触发。');
  const s = upgradeCare(upgradeServiceReviews(upgradeTechIncome(upgradeServiceFinance(upgradeInvoices(upgradeGoods(upgradeManagement(structuredClone(previous))))))));
  upgradeQualifications(s); upgradeHandoffs(s); upgradeAccounts(s); upgradePrivacy(s); upgradeWorkTasks(s);
  upgradeCommerceInvoices(s);
  upgradeFulfilment(s);
  upgradeWorkEscalations(s);
  upgradeServiceFinanceExtras(s);
  upgradeServicePromotion(s);
  upgradeTechnicianPenalties(s);
  upgradeQualityPolicies(s);
  actor = resolveAccountActor(s, actor);
  upgradeOrganizationLifecycle(s);
  assertAccountCommand(actor, type, p, s);
  assertPrivacyCommand(s, actor, type, p);
  if (!type.startsWith('account.')) assertJob(actor, type);
  if (!['user', 'tech', 'manager', 'store', 'group'].includes(actor.role)) fail('请选择有效身份。');
  if (actor.role === 'user' && !s.users.some(u => u.id === actor.userId)) fail('用户不存在。');
  if (['store', 'manager'].includes(actor.role) && !s.stores.some(t => t.id === actor.storeId)) fail('门店不存在。');
  if (actor.role === 'tech' && !s.techs.some(t => t.id === actor.techId)) fail('技师不存在。');
  const id = prefix => prefix + (++s.seq);
  const log = (entity, content) => {
    const event = { ...actorAccountFields(actor), at: s.now, text: content, actor: actor.role, job: actor.role === 'group' ? actor.job || 'all' : null, actorId: actor.role === 'user' ? actor.userId : actor.role === 'tech' ? actor.techId : actor.role === 'group' ? 'group' : actor.storeId };
    entity.events ??= []; entity.events.push(event);
    s.logs.push({ ...event, id: entity.id || '' });
  };
  const ctx = { fail, id, log };
  Object.assign(ctx, createLifecycleContext());
  // Runtime evidence is supplied separately after actual attachment reads inside
  // the app transaction. Business payload flags cannot authorize a fund fact.
  const verifiedFiles = structuredClone(runtimeEvidence?.evidenceRefs || []);
  ctx.validateEvidenceRefs = refs => Array.isArray(verifiedFiles) && Array.isArray(refs) && refs.length > 0 && refs.every(file => verifiedFiles.some(checked => ['ref','name','type','size'].every(key => checked[key] === file[key])));
  if (['finance.composition-confirm','finance.composition-reconcile'].includes(type) && runtimeEvidence?.compositionPrepared) ctx.validateCompositionEvidence = createServiceFinanceCompositionEvidenceValidator(runtimeEvidence.compositionPrepared);
  Object.assign(ctx,createServiceFinanceExtrasBridges(ctx));
  ctx.takeoverNativeWork=args=>takeOver(s,args,ctx);
  const requireRole = (...roles) => { if (!roles.includes(actor.role)) fail('当前身份无权执行此操作。'); };
  const order = () => {
    const o = s.goods.find(x => x.id === p.id);
    if (!o || !(actor.role === 'group' || (actor.role === 'user' && o.userId === actor.userId) || (['store', 'manager'].includes(actor.role) && o.source?.storeId === actor.storeId))) fail('订单不存在或当前身份无权访问。');
    return o;
  };
  const customerOrder = () => { requireRole('user'); return order(); };
  const groupOrder = () => { requireRole('group'); return order(); };
  const getCase = o => { const c = o.cases.find(x => x.id === p.caseId); if (!c) fail('售后案件不存在。'); return c; };
  const goodsBefore = structuredClone(s.goods);
  const receiveGoods = (o, metadata = null) => {
    if (o.status !== 'shipped') fail('订单尚未发货或收货已记录。');
    if (o.cases.some(activeCase)) fail('存在未处理售后，请先完成处理。');
    if (metadata) {
      const current = goodsLogisticsAutoReceipt(s,o), fact = o.goodsDeliveryFacts?.find(f=>f.id===current.factId);
      if (!current.eligible || metadata.source !== 'logistics-auto' || metadata.confirmedAt !== s.now || metadata.policyId !== current.policyId || metadata.policyVersion !== current.policyVersion || metadata.factId !== current.factId || metadata.occurredAt !== fact?.occurredAt) fail('原物流规则或核实送达依据已变化，不能自动确认收货。');
      o.receiptSource = structuredClone(metadata);
    }
    o.status = 'received'; o.receivedAt = s.now;
    if (metadata) {
      const event = { at:s.now, text:'依据已核实送达与本单锁定规则自动确认收货，进入佣金结算等待期', actor:'system', actorId:'system', job:null, ...structuredClone(metadata) };
      (o.events??=[]).push(event); s.logs.push({...event,id:o.id});
    } else log(o,'用户确认收货，进入佣金结算等待期');
  };
  const finalGoods = () => {
    syncGoodsExceptions(s,ctx);
    tickGoodsLogistics(s,{receiveGoods});
    for (const o of s.goods) {
      const before = goodsBefore.find(x=>x.id===o.id);
      if (!Number.isSafeInteger(o.version)) o.version=0;
      for (const c of o.cases) {
        if (!Number.isSafeInteger(c.version)) c.version=0;
        const previousCase=before?.cases.find(x=>x.id===c.id);
        if (previousCase && JSON.stringify(previousCase)!==JSON.stringify(c) && previousCase.version===c.version) c.version++;
      }
      if (before && JSON.stringify(before)!==JSON.stringify(o) && before.version===o.version) o.version++;
    }
  };
  const sourceVersion = (row, required=false) => {
    if (required || p.version!=null) if (!['number','string'].includes(typeof p.version)||!String(p.version).trim()||!Number.isSafeInteger(Number(p.version))||Number(p.version)!==row.version) fail('记录已更新或缺少版本，请刷新核对后重试。');
  };
  const goodsOperation = (o,c) => {
    const req=goodsExceptionRequest(s,actor,type,p,ctx);
    return { previous:req.previous, remember:()=>rememberGoodsExceptionRequest(s,req,c||o) };
  };
  const getBill = () => { const b = s.bills.find(x => x.id === p.id); if (!b || !(actor.role === 'group' || (['store', 'manager'].includes(actor.role) && b.storeId === actor.storeId))) fail('账单不存在或无权访问。'); return b; };
  const availableRefund = o => goodsAfterSaleLimits(o).availableCents;
  const closeUnpaid = (o, reason) => { o.status = 'closed'; o.payment.status = 'closed'; log(o, reason + '，库存占用已释放'); };
  const eligible = o => !goodsSummary(s, o).commissionReason && o.payment.status === 'success';
  const adjustBills = o => {
    for (const b of s.bills.filter(b => !['paid', 'processing'].includes(b.status) && b.items.some(i => i.orderId === o.id))) {
      const line = b.items.find(i => i.orderId === o.id);
      const next = Math.max(0, goodsSummary(s, o).commissionCents - o.commissionPaidCents);
      if (line.amountCents !== next || o.cases.some(activeCase)) {
        line.amountCents = next; b.amountCents = sum(b.items, i => i.amountCents); b.version++;
        b.adjustmentReason = '关联订单售后变化，请重新核对';
        b.status = b.dispute?.status === 'open' ? 'disputed' : 'adjusted';
        b.reason = b.dispute?.status === 'open' ? b.dispute.reason : b.adjustmentReason;
        log(b, b.adjustmentReason);
      }
    }
  };
  const reconcileDebt = o => {
    const debt = Math.max(0, o.commissionPaidCents - goodsSummary(s, o).commissionCents);
    if (!debt) return;
    let r = s.recoveries.find(r => r.orderId === o.id);
    if (!r) { r = { id: id('RC'), orderId: o.id, storeId: o.source.storeId, amountCents: debt, recoveredCents: 0, status: 'open', records: [], events: [] }; s.recoveries.push(r); }
    r.amountCents = debt; r.status = r.recoveredCents >= debt ? 'closed' : 'open';
  };
  const settlementCtx = { ...ctx, goodsSummary, eligible, reconcileDebt, adjustBills };
  const tick = () => {
    for (const o of s.goods) if (o.status === 'unpaid' && o.deadline <= s.now && o.payment.status !== 'processing') closeUnpaid(o, '支付期限已到，已确认未付款');
    bookingCommand(s, actor, 'booking.tick', {}, ctx);
    tickFulfilment(s,ctx);
  };
  const successPay = o => {
    if (o.payment.status === 'success') return;
    o.payment.status = 'success'; o.paidAt = s.now;
    if (o.deadline <= s.now || o.status === 'closed') {
      o.status = 'cancelled';
      o.lines.forEach(l => l.cancelledQty = l.qty);
      o.cases.push({ id: id('AS'), kind: 'cancel', reason: '支付关闭后查到成功，停止履约并原路退款', status: 'refund_ready', amountCents: sum(o.lines, l => l.paidCents), shippingCents: o.shippingCents, allocations: o.lines.map(l => ({ skuId: l.skuId, amountCents: l.paidCents, qty: l.qty })) });
      log(o, '晚到支付已核实，原路退款待集团执行');
    } else { o.status = 'paid'; log(o, '集团收款成功，等待发货'); }
  };
  const refundResult = (o, c, outcome, query) => {
    if (!['success', 'failed', 'processing'].includes(outcome)) fail('请选择有效退款结果。');
    let r = o.refunds.find(r => r.caseId === c.id);
    if (r?.status === 'success') return;
    if (!['refund_ready', 'refund_failed', 'refunding'].includes(c.status)) fail('当前案件尚不能退款。');
    if (r?.status === 'processing' && !query) fail('退款结果未知，请查询原交易。');
    if (query && r?.status !== 'processing') fail('当前没有等待查询的退款。');
    if (!r) { r = { id: id('RF'), caseId: c.id, amountCents: c.amountCents + c.shippingCents, status: 'processing', attempts: 0, at: s.now }; o.refunds.push(r); c.refundId = r.id; }
    if (!query) r.attempts++;
    r.status = outcome;
    if (outcome === 'success') {
      for (const part of c.allocations) {
        const l = o.lines.find(l => l.skuId === part.skuId);
        l.refundedCents += part.amountCents;
        if (l.refundedCents > l.paidCents) fail('退款超出明细实付。');
      }
      c.status = 'done'; c.completedAt = s.now;
      reconcileDebt(o); adjustBills(o); log(o, '原路退款成功 ' + money(r.amountCents) + ' · ' + r.id);
    } else { c.status = outcome === 'failed' ? 'refund_failed' : 'refunding'; log(o, outcome === 'failed' ? '原路退款失败，集团财务待重试' : '退款处理中，等待原笔查询'); }
  };

  syncLifecycle(s,ctx,{type,id:p.id});
  tick();
  syncCare(s, ctx);
  syncInvoices(s, ctx);
  syncServiceFunds(s,ctx);
  syncGoodsExceptions(s,ctx);
  syncGoodsSettlement(s,settlementCtx);
  syncCommerceInvoices(s,ctx);
  assertGoodsSettlementCommand(s,actor,type,p,settlementCtx);
  assertServiceFinanceExtrasCommand(s,actor,type,p,ctx);
  if (type.startsWith('account.')) onResult(accountCommand(s, actor, type, p, ctx));
  else if (type.startsWith('lifecycle.')) onResult(lifecycleCommand(s,actor,type,p,ctx));
  else if (type.startsWith('work.')) onResult(workTaskCommand(s, actor, type, p, ctx));
  else if (type.startsWith('work-escalation.')) onResult(workEscalationCommand(s,actor,type,p,ctx));
  else if (type === 'report.export') onResult(reportExport(s, actor, p, ctx));
  else if (type.startsWith('commerce-invoice.')) onResult(commerceInvoiceCommand(s,actor,type,p,ctx));
  else if (type.startsWith('fulfilment.')) onResult(fulfilmentCommand(s,actor,type,p,ctx));
  else if (type.startsWith('goods-logistics.')) onResult(goodsLogisticsCommand(s,actor,type,p,ctx));
  else if (type.startsWith('service-extra.')) { const result=serviceFinanceExtrasCommand(s,actor,type,p,ctx); if(result===undefined)fail('当前服务资金操作不存在。'); onResult(result); }
  else if (type.startsWith('service-promotion.')) {
    let result=actor.role==='user'?techHistoricalRightsCommand(s,actor,type,p,ctx):undefined;
    if(result===undefined)result=servicePromotionCommand(s,actor,type,p,ctx);
    if(result===undefined)fail('当前服务推广操作不存在。');
    onResult(result);
  }
  else if (['bill.dispute-lines','bill.split','bill.offset-propose','bill.offset-confirm','bill.offset-cancel','bill.offset-pay','bill.offset-query'].includes(type)) onResult(goodsSettlementCommand(s,actor,type,p,settlementCtx));
  else if (type.startsWith('privacy.')) onResult(privacyCommand(s, actor, type, p, ctx));
  else if (type.startsWith('sensitive.')) onResult(sensitiveAccessCommand(s, actor, type, p, ctx));
  else if (type.startsWith('manage.')) managementCommand(s, actor, type, p, ctx);
  else if (type.startsWith('invoice.')) invoiceCommand(s, actor, type, p, ctx);
  else if (['finance.composition-confirm','finance.composition-reconcile'].includes(type)) onResult(serviceFinanceCompositionReviewCommand(s,actor,type,p,ctx));
  else if (type.startsWith('finance.')) serviceFinanceCommand(s, actor, type, p, ctx);
  else if (type.startsWith('tech-income.')) techIncomeCommand(s, actor, type, p, ctx);
  else if (type.startsWith('review.')) serviceReviewCommand(s, actor, type, p, ctx);
  else if (type.startsWith('care.')) careCommand(s, actor, type, p, ctx);
  else if (type.startsWith('quality.')) {
    const result = qualityPolicyCommand(s, actor, type, p, ctx);
    if (result === undefined) fail('当前质量政策操作不存在。');
    onResult(result);
  }
  else if (type.startsWith('penalty.')) {
    const result=technicianPenaltyCommand(s,actor,type,p,ctx);
    if(result===undefined)fail('当前处罚操作不存在。');
    onResult(result);
  }
  else if (type.startsWith('qualification.')) {
    qualificationCommand(s, actor, type, p, ctx);
    if(type==='qualification.review'&&p.decision==='approve') {
      const tech=s.techs.find(x=>x.id===p.techId),storeId=p.storeId||tech?.storeId,profileId=p.profileId||(storeId===tech?.storeId?tech?.qualificationProfileId:null),profiles=(s.techQualifications||[]).filter(x=>x.techId===p.techId&&x.storeId===storeId&&(!profileId||x.id===profileId)),profile=profiles.length===1?profiles[0]:null,grant=profile?.grants?.find(x=>x.id===p.grantId),store=s.stores.find(x=>x.id===tech?.storeId);
      if(tech?.active&&tech.reviewStatus==='approved'&&profile?.storeId===tech.storeId&&(!tech.qualificationProfileId||profile.id===tech.qualificationProfileId)&&!['departure','left'].includes(tech.lifecycleStatus)&&store?.closedAt==null&&!['closing','closed'].includes(store?.lifecycleStatus)&&grant?.status==='approved'&&grant.serviceIds.some(serviceId=>qualificationEligibility(s,tech.id,serviceId).allowed))captureTechServicePromoter(s,tech.id,{eligible:true,techId:tech.id,storeId:tech.storeId,reference:grant.review.proof,verifiedAt:grant.review.at,grantId:grant.id},ctx);
    }
  }
  else if (type.startsWith('recipient.')) recipientCommand(s, actor, type, p, ctx);
  else if (type.startsWith('handoff.')) handoffCommand(s, actor, type, p, ctx);
  else if (type.startsWith('booking.')) { const existing = type === 'booking.create' && p.requestId && s.bookings.some(b => b.userId === actor.userId && b.requestId === p.requestId); const before=s.bookings.find(b=>b.id===p.id); const beforeBooking=before?structuredClone(before):null; bookingCommand(s, actor, type, p, ctx); if(beforeBooking) captureFulfilmentTransition(s,actor,beforeBooking,s.bookings.find(b=>b.id===p.id),type,ctx); if (type === 'booking.create' && !existing) { captureServicePromotion(s,s.bookings.find(b=>b.userId===actor.userId&&b.requestId===p.requestId)||s.bookings.at(-1),ctx); captureBookingPrivacy(s, actor, p, ctx); } if(type==='booking.extension-create') {const b=s.bookings.find(b=>b.id===p.id);for(const payment of b?.extensions||[])if(!beforeBooking?.extensions.some(x=>x.id===payment.id))captureExtensionPromotion(s,b,payment);} }
  else if (['goods.address-change','goods.case-withdraw','goods.inspect-partial','goods.partial-propose','goods.partial-confirm','goods.incident-open','goods.incident-note','goods.incident-propose','goods.incident-confirm','goods.incident-verify','goods.incident-receipt'].includes(type)) onResult(goodsExceptionCommand(s,actor,type,p,{...ctx,adjustBills}));
  else if (type === 'clock.advance') {
    const minutes = integer(p.minutes, 1); if (minutes > 44640) fail('单次最多推进31天。');
    s.now += minutes * 60000; syncLifecycle(s,ctx); tick(); log({ id: 'clock' }, '演示时钟推进 ' + minutes + ' 分钟');
  } else if (type === 'cart.set') {
    requireRole('user'); const sku = s.skus.find(x => x.id === p.skuId), qty = integer(p.qty);
    if (!sku || (qty && !sku.active)) fail('商品不存在或已下架。');
    if (qty > availableStock(s, sku.id)) fail('数量超过当前可售库存。');
    const cart = s.carts[actor.userId] ??= []; const line = cart.find(l => l.skuId === sku.id);
    if (!qty) s.carts[actor.userId] = cart.filter(l => l.skuId !== sku.id);
    else if (line) { line.qty = qty; line.quotedCents = sku.priceCents; } else cart.push({ skuId: sku.id, qty, quotedCents: sku.priceCents });
  } else if (type === 'address.save') {
    requireRole('user'); let a = s.addresses.find(a => a.id === p.id);
    if (p.id && (!a || a.userId !== actor.userId)) fail('地址不存在或不属于当前用户。');
    const data = { name: text(p.name, '收货人'), phone: text(p.phone, '11位手机号'), province: text(p.province, '省份'), city: text(p.city, '城市'), detail: text(p.detail, '详细地址') };
    if (!/^1\d{10}$/.test(data.phone)) fail('请输入11位手机号。');
    if (a) Object.assign(a, data); else s.addresses.push({ id: id('AD'), userId: actor.userId, ...data });
  } else if (type === 'promotion.enter') {
    requireRole('user'); const store = s.stores.find(x => x.id === p.storeId);
    if (!store || store.promotionDisabled) fail('该门店推广入口已失效。');
    s.promotions[actor.userId] = { storeId: store.id, at: s.now, sourceId: text(p.sourceId || 'STORE-' + store.id, '来源标识') };
  } else if (type === 'promotion.clear') {
    requireRole('user'); delete s.promotions[actor.userId];
  } else if (type === 'goods.submit') {
    requireRole('user'); const requestId = text(p.requestId, '提交标识');
    if (s.goods.some(o => o.userId === actor.userId && o.requestId === requestId)) return s;
    const cart = s.carts[actor.userId] || []; if (!cart.length) fail('购物车为空，请先选择商品。');
    const address = s.addresses.find(a => a.id === p.addressId && a.userId === actor.userId); if (!address) fail('请选择本人收货地址。');
    if (address.province !== '江苏省') fail('当前演示配送范围为江苏省，请选择范围内地址。');
    const lines = cart.map(line => {
      const sku = s.skus.find(x => x.id === line.skuId), qty = integer(line.qty, 1);
      if (!sku || !sku.active || availableStock(s, sku.id) < qty) fail('商品已下架或库存不足，请更新购物车。');
      if (line.quotedCents !== sku.priceCents) fail('商品价格已变更，请在购物车重新确认数量和价格。');
      return { skuId: sku.id, productId: sku.productId, productVersion: s.products.find(x => x.id === sku.productId)?.version, skuVersion: sku.version, image: sku.image, name: sku.name, spec: sku.spec, qty, unitCents: sku.priceCents, paidCents: sku.priceCents * qty, commissionBps: sku.commissionBps, refundedCents: 0, returnedQty: 0, cancelledQty: 0 };
    });
    const pr = s.promotions[actor.userId], sourceStore = pr && s.stores.find(t => t.id === pr.storeId);
    const source = pr && sourceStore && s.now < pr.at + s.settings.sourceHours * 3600000 && !sourceStore.promotionDisabled ? {
      ...structuredClone(pr), storeName: sourceStore.name, storeVersion: sourceStore.version,
      qualification: { promotionEnabled: !sourceStore.promotionDisabled, reviewStatus: sourceStore.reviewStatus, active: sourceStore.active },
      ruleVersion: s.settings.version, lockedAt: s.now
    } : null;
    if (p.expectedSourceId !== undefined && p.expectedSourceId !== (source?.sourceId || '')) fail('商品推广来源已变化或过期，请重新核对确认页。');
    const o = { id: id('G'), requestId, userId: actor.userId, source, lines, address: structuredClone(address), payment: { id: id('PAY'), status: 'unpaid', attempts: 0 }, status: 'unpaid', version:0, incidents:[], addressHistory:[], paidCents: sum(lines, l => l.paidCents) + s.settings.shippingCents, shippingCents: s.settings.shippingCents, refunds: [], cases: [], events: [], createdAt: s.now, deadline: s.now + s.settings.paymentMinutes * 60000, waitDays: s.settings.waitDays, ruleVersion: s.settings.version, commissionPaidCents: 0 };
    s.goods.push(o); captureGoodsLogisticsPolicy(s,o,ctx); s.carts[actor.userId] = []; log(o, '订单已提交，库存已占用 · ' + (source ? '推广门店已锁定' : '集团自然销售'));
  } else if (type === 'goods.pay' || type === 'goods.payment-query') {
    const o = customerOrder(), query = type.endsWith('query');
    if (o.payment.status === 'success') return s;
    sourceVersion(o);
    if (!['success', 'failed', 'processing'].includes(p.outcome)) fail('请选择有效支付结果。');
    if (query) { if (o.payment.status !== 'processing') fail('当前没有等待核查的支付。'); }
    else { if (o.status !== 'unpaid' || s.now >= o.deadline) fail('订单已关闭或超过支付期限。'); if (o.payment.status === 'processing') fail('支付结果未知，请先查询原交易。'); o.payment.attempts++; }
    if (p.outcome === 'success') successPay(o);
    else { o.payment.status = p.outcome; log(o, p.outcome === 'failed' ? '支付失败，可在有效期内重试' : '支付处理中，请查询原交易'); if (s.now >= o.deadline && p.outcome === 'failed') closeUnpaid(o, '支付超时且查询确认失败'); }
  } else if (type === 'goods.close') {
    const o = customerOrder(); if (o.status === 'closed') return s;
    sourceVersion(o);
    if (o.status !== 'unpaid') fail('已支付订单请申请取消退款。');
    if (o.payment.status === 'processing') fail('支付结果未知，请先核查，库存暂不释放。'); closeUnpaid(o, '用户取消未付订单');
  } else if (type === 'goods.ship') {
    const o = groupOrder(); sourceVersion(o);
    if (o.status !== 'paid' || goodsShippingBlocked(o)) fail('订单非待发货或存在未结售后，不能发货。');
    o.shipment = { carrier: text(p.carrier, '物流公司'), tracking: text(p.tracking, '运单号'), at: s.now };
    for (const line of o.lines) { const sku = s.skus.find(k => k.id === line.skuId); const qty = line.qty - line.cancelledQty; if (sku.stock < qty) fail('实物库存不足。'); stockMove(s, sku, -qty, 'ship', o.id, '订单发货出库', actor, ctx); }
    o.status = 'shipped'; log(o, '集团已出库 · ' + o.shipment.carrier + ' ' + o.shipment.tracking);
  } else if (type === 'goods.receive') {
    const o = customerOrder(); if (o.status === 'received') return s;
    sourceVersion(o);
    receiveGoods(o);
  } else if (type === 'goods.case') {
    const o = customerOrder();
    // Old schema-5 callers without an operation ID remain valid. New UI requests
    // keep one ID for retries and choose a new ID only for a new application.
    const requestId = p.requestId == null ? null : text(p.requestId, '售后申请标识');
    // Older callers included a SKU even for whole-order cancellation. Explicit
    // operation metadata identifies the new line-cancellation contract.
    const perLineCancel = p.kind==='cancel'&&!!p.skuId&&(p.version!=null||requestId!=null);
    const lineRequest = perLineCancel&&requestId ? goodsExceptionRequest(s,actor,type,p,ctx) : null;
    if (lineRequest?.previous) return s;
    const requestSignature = JSON.stringify({ id: o.id, kind: p.kind, skuId: p.skuId || '', qty: Number(p.qty || 0), amountCents: Number(p.amountCents || 0), shippingCents: Number(p.shippingCents || 0), reason: String(p.reason || '').trim() });
    if (requestId) {
      const existing = s.goods.filter(x => x.userId === actor.userId).flatMap(x => x.cases).find(c => c.requestId === requestId);
      if (existing) { if (existing.requestSignature !== requestSignature) fail('该售后申请标识已用于不同内容，请重新提交新的申请。'); return s; }
    }
    sourceVersion(o,perLineCancel);
    if (perLineCancel&&!requestId) fail('请填写本次按商品取消标识。');
    if (o.payment.status !== 'success') fail('未支付订单不能退款。');
    if (!['cancel', 'return', 'refund'].includes(p.kind)) fail('请选择有效售后类型。');
    if (p.kind === 'cancel' && o.status !== 'paid') fail('整单取消仅支持未发货订单。');
    if (p.kind !== 'cancel' && !['shipped', 'received'].includes(o.status)) fail('发货后可申请退货或仅退款。');
    const limits=goodsAfterSaleLimits(o);
    const c = { id: id('AS'), kind: p.kind, reason: text(p.reason, '售后原因'), status: 'requested', version:0, allocations: [], shippingCents: 0, createdAt: s.now, ...(requestId ? { requestId, requestSignature } : {}) };
    if (p.kind === 'cancel') {
      if (perLineCancel) {
        const l=o.lines.find(l=>l.skuId===p.skuId); if (!l) fail('请选择本单商品。');
        const qty=integer(p.qty,1),capacity=limits.lines.find(x=>x.skuId===l.skuId);
        if (qty>capacity.cancelQty) fail('取消数量超过尚可取消件数。');
        const amountCents=Math.min(l.unitCents*qty,capacity.amountCents);
        if (amountCents<=0) fail('当前商品没有可取消退款金额。');
        c.skuId=l.skuId; c.qty=qty; c.allocations=[{skuId:l.skuId,qty,amountCents}]; c.amountCents=amountCents;
        const remaining=limits.remainingCancelQty-qty;
        c.shippingCents=remaining===0?limits.shippingCents:0;
      } else {
        if (o.cases.some(activeCase)) fail('请先处理已有售后。');
        c.allocations = o.lines.map((l,index)=>({skuId:l.skuId,qty:limits.lines[index].refundQty,amountCents:limits.lines[index].amountCents})).filter(a=>a.qty>0);
        c.amountCents = sum(c.allocations, a => a.amountCents);
        c.shippingCents = limits.shippingCents;
      }
    } else if (p.kind === 'refund' && Number(p.amountCents || 0) === 0 && !p.skuId) {
      c.amountCents = 0; c.shippingCents = integer(p.shippingCents, 1);
      if (c.shippingCents > limits.shippingCents) fail('运费申请超过尚可退运费。');
    } else {
      const l = o.lines.find(l => l.skuId === p.skuId); if (!l) fail('请选择本单商品。');
      c.skuId = l.skuId; c.qty = integer(p.qty, 1); c.amountCents = integer(p.amountCents, 1); c.shippingCents = integer(p.shippingCents || 0);
      const capacity=limits.lines.find(x=>x.skuId===l.skuId);
      if (c.amountCents > capacity.amountCents) fail('申请金额超过该商品尚可退金额。');
      if (c.amountCents > l.unitCents * c.qty) fail('退款不能超过所选数量实付。');
      if (c.qty > (p.kind==='return'?capacity.returnQty:capacity.refundQty)) fail('退货数量超过尚可退件数。');
      if (c.shippingCents > limits.shippingCents) fail('运费申请超过尚可退运费。');
      c.allocations = [{ skuId: l.skuId, qty: c.qty, amountCents: c.amountCents }];
    }
    if (c.amountCents + c.shippingCents > limits.availableCents) fail('申请超过当前可退金额（含处理中占额）。');
    o.cases.push(c); if (lineRequest) rememberGoodsExceptionRequest(s,lineRequest,c); adjustBills(o); log(o, '用户申请' + (c.kind === 'cancel' ? '取消' : c.kind === 'return' ? '退货退款' : '仅退款') + ' · ' + money(c.amountCents + c.shippingCents));
  } else if (type === 'goods.case-review') {
    const o = groupOrder(), c = getCase(o); sourceVersion(c); if (c.status !== 'requested') fail('该案件已受理，请勿重复审批。');
    if (!['approve', 'reject'].includes(p.decision)) fail('请选择处理决定。'); c.reviewReason = text(p.reason, '处理说明');
    if (p.decision === 'reject') c.status = 'rejected';
    else if (c.kind === 'return') c.status = 'awaiting_return';
    else { c.status = 'refund_ready'; if (c.kind === 'cancel') { if (o.status !== 'paid') fail('订单已出库，不能按未发货取消。'); for (const a of c.allocations) { const line=o.lines.find(l=>l.skuId===a.skuId); if (a.qty>line.qty-line.cancelledQty) fail('取消数量已变化，请重新核查。'); line.cancelledQty+=a.qty; } if (o.lines.every(l=>l.cancelledQty===l.qty)) { o.status = 'cancelled'; c.shippingCents=Math.max(0,o.shippingCents-sum(o.cases.filter(x=>x.id!==c.id&&(activeCase(x)||x.status==='done')),x=>x.shippingCents)); } } }
    log(o, c.status === 'rejected' ? '集团驳回申请，可补充说明申诉' : '集团已受理售后');
  } else if (type === 'goods.appeal') {
    const o = customerOrder(), c = getCase(o);
    sourceVersion(c);
    if (c.status === 'inspection_disputed') { c.appealReason = text(p.reason, '验收申诉说明'); c.status = 'inspection_review'; log(o, '用户对验收提出申诉，货物由集团保管，待复核'); finalGoods(); s.revision++; return s; }
    if (c.status !== 'rejected') fail('仅已驳回或验收有争议的案件可申诉。');
    if (c.kind === 'cancel' && o.status !== 'paid') fail('订单已发货，不能恢复未发货取消，请按实际情况新申请售后。');
    if (c.amountCents + c.shippingCents > availableRefund(o)) fail('退款额度已被其他案件占用，请联系集团核查。');
    const shippingUsed = sum(o.cases.filter(x => activeCase(x) || x.status === 'done'), x => x.shippingCents);
    if (c.shippingCents > o.shippingCents - shippingUsed) fail('运费额度已被其他案件使用，不能恢复原申请。');
    for (const a of c.allocations) { const l = o.lines.find(l => l.skuId === a.skuId); const held = sum(o.cases.filter(activeCase), x => sum(x.allocations.filter(q => q.skuId === l.skuId), q => q.amountCents)); if (a.amountCents > l.paidCents - l.refundedCents - held) fail('该商品退款额度已变化。'); }
    if (c.kind === 'return') { const l = o.lines.find(l => l.skuId === c.skuId); const pendingQty = sum(o.cases.filter(x => x.kind === 'return' && activeCase(x) && !x.inspectedAt && x.skuId === l.skuId), x => x.qty); if (c.qty > l.qty - l.cancelledQty - l.returnedQty - pendingQty) fail('该商品可退件数已变化，不能重复退货。'); }
    c.appealReason = text(p.reason, '申诉说明'); c.status = 'requested'; adjustBills(o); log(o, '用户补充申诉，集团待复核');
  } else if (type === 'goods.return') {
    const o = customerOrder(), c = getCase(o); sourceVersion(c); if (c.status !== 'awaiting_return') fail('请等待集团同意退货。');
    c.returnShipment = { carrier: text(p.carrier, '退货物流公司'), tracking: text(p.tracking, '退货运单'), at:s.now }; c.status = 'returning'; log(o, '用户已寄回，等待集团验收');
  } else if (type === 'goods.inspect') {
    const o = groupOrder(), c = getCase(o), op=c.partialReceipt?goodsOperation(o,c):null;
    if (op?.previous) return s;
    sourceVersion(c,!!c.partialReceipt);
    if (!['returning', 'awaiting_return_disposition'].includes(c.status)) fail('退货尚未寄回、等待客服裁决或已经验收。');
    if (c.partialReceipt && (c.qty!==c.partialReceipt.qty || (c.partialReceipt.qty<c.originalRequestSnapshot.qty && c.partialProposal?.status!=='accepted'))) fail('部分实收尚未得到用户确认，不能按原全量验收。');
    if (p.disposition === 'disputed') {
      if (c.status !== 'returning') fail('客服已裁决同意退货，请登记可售入库或不可售报损。');
      c.reviewReason = text(p.reason, '验收证据及说明'); c.status = 'inspection_disputed'; c.custody = '集团仓储'; log(o, '验收不符，货物暂存，等待用户确认或申诉'); op?.remember(); finalGoods(); s.revision++; return s;
    }
    if (!['sellable', 'damaged'].includes(p.disposition)) fail('请确认验收处置。');
    const returningLine = o.lines.find(l => l.skuId === c.skuId);
    if (c.qty > returningLine.qty - returningLine.cancelledQty - returningLine.returnedQty) fail('退回件数超过本单实际可退数量，请核查。');
    c.disposition = p.disposition; c.dispositionReason = p.reason ? text(p.reason, '实物处置说明') : ''; c.inspectedAt = s.now; c.status = 'refund_ready';
    o.lines.find(l => l.skuId === c.skuId).returnedQty += c.qty;
    stockMove(s, s.skus.find(k => k.id === c.skuId), p.disposition === 'sellable' ? c.qty : 0, p.disposition === 'sellable' ? 'return' : 'return-damage', c.id, `订单 ${o.id} 验收${c.qty}件，${p.disposition === 'sellable' ? '可售入库' : '不可售报损，不计可售库存'}`, actor, ctx);
    log(o, (p.disposition === 'sellable' ? '集团验收可售，退货已入库，待退款' : '集团验收不可售，记入报损记录，待退款') + (c.dispositionReason ? ' · ' + c.dispositionReason : ''));
    op?.remember();
  } else if (type === 'goods.inspection-resolve') {
    const o = groupOrder(), c = getCase(o);
    sourceVersion(c);
    if (c.status !== 'inspection_review') fail('当前没有等待客服裁决的验收申诉。');
    if (!['approve', 'reject'].includes(p.decision)) fail('请选择申诉裁决。');
    c.inspectionDecision = { decision: p.decision, reason: text(p.reason, '客服裁决说明'), at: s.now, actor: actor.role, job: actor.job || 'all' };
    c.status = p.decision === 'approve' ? 'awaiting_return_disposition' : 'awaiting_return_to_customer'; c.custody = '集团仓储';
    log(o, p.decision === 'approve' ? '客服裁决同意退货，等待仓储登记实物处置' : '客服裁决维持拒退，货物待返还用户');
  } else if (type === 'goods.return-back-accept') {
    const o = customerOrder(), c = getCase(o); sourceVersion(c); if (c.status !== 'inspection_disputed') fail('当前没有待确认的验收分歧。'); c.status = 'awaiting_return_to_customer'; log(o, '用户接受拒退，要求集团返还原货');
  } else if (type === 'goods.return-back') {
    const o = groupOrder(), c = getCase(o); sourceVersion(c); if (c.status !== 'awaiting_return_to_customer') fail('须先确定拒退及货物返还方案。');
    if (!['group', 'customer'].includes(p.feePayer)) fail('请记录双方约定的运费承担方。');
    c.backShipment = { carrier: text(p.carrier, '返还物流'), tracking: text(p.tracking, '返还运单'), qty:c.partialReceipt?.qty||c.qty, feePayer: p.feePayer, agreement: text(p.reason, '返还方案及协商依据'), at: s.now };
    c.status = 'return_to_customer_shipping'; c.custody = '返还物流'; log(o, '拒退货物已寄回用户，等待用户确认收到');
  } else if (type === 'goods.return-back-receive') {
    const o = customerOrder(), c = getCase(o); sourceVersion(c); if (c.status !== 'return_to_customer_shipping') fail('当前没有等待收取的返还货物。'); c.status = 'closed'; c.custody = '用户'; c.completedAt = s.now; log(o, '用户确认收到拒退返还货物，案件无退款关闭');
  } else if (type === 'goods.refund' || type === 'goods.refund-query') {
    const o = groupOrder(),c=getCase(o); if (!o.refunds.some(r=>r.caseId===c.id&&r.status==='success')) sourceVersion(c); refundResult(o, c, p.outcome, type.endsWith('query'));
  } else if (type === 'bill.create') {
    requireRole('group'); const store = s.stores.find(x => x.id === p.storeId); if (!store) fail('门店不存在。');
    const items = s.goods.filter(o => o.source?.storeId === store.id && eligible(o) && !s.bills.some(b => b.items.some(i => i.orderId === o.id))).map(o => ({ orderId: o.id, amountCents: Math.max(0, goodsSummary(s, o).commissionCents - o.commissionPaidCents) })).filter(i => i.amountCents > 0);
    if (!items.length) fail('当前没有满足收货及等待期条件的可结佣金。');
    const b = { id: id('BILL'), storeId: store.id, items, amountCents: sum(items, i => i.amountCents), status: 'review', paymentId: id('OUT'), attempts: 0, version: 1, events: [], createdAt: s.now };
    s.bills.push(b); log(b, '集团生成账单，等待门店核对');
  } else if (type === 'bill.confirm' || type === 'bill.dispute') {
    requireRole('store', 'manager'); const b = getBill();
    if (!Number.isSafeInteger(Number(p.version)) || Number(p.version) < 1) fail('请重新打开账单并核对当前版本。');
    if (Number(p.version) !== b.version) fail('账单已更新，请重新核对当前版本后再确认或提出差异。');
    if (b.dispute?.status === 'open') fail('账单差异尚未完成核查，请等待集团处理。');
    if (!['review', 'adjusted'].includes(b.status)) fail('当前账单不能重复核对。');
    if (type === 'bill.dispute') {
      b.reason = text(p.reason, '差异说明');
      if (b.dispute) (b.disputeHistory ??= []).push(structuredClone(b.dispute));
      b.dispute = { status: 'open', reason: b.reason, openedAt: s.now, openedVersion: b.version };
      b.status = 'disputed'; log(b, '门店提出差异 · ' + b.reason);
    }
    else { if (b.items.some(i => !eligible(s.goods.find(o => o.id === i.orderId)) && i.amountCents > 0)) fail('关联订单仍有售后阻断，请等待处理完成。'); b.status = 'confirmed'; log(b, '门店已确认账单版本 ' + b.version); }
  } else if (type === 'bill.resolve') {
    requireRole('group'); const b = getBill(); if (b.dispute?.status !== 'open') fail('当前账单没有待核查差异。');
    b.reason = text(p.reason, '核查说明'); Object.assign(b.dispute, { status: 'resolved', resolutionReason: b.reason, resolvedAt: s.now, resolvedBy: actor.job || 'all' });
    if (!['paid', 'processing'].includes(b.status)) b.status = 'review';
    b.version++; log(b, ['paid', 'processing'].includes(b.status) ? '集团完成差异核查，原付款状态保留' : '集团完成差异核查，等待门店重新确认');
  } else if (type === 'bill.pay' || type === 'bill.query') {
    requireRole('group'); const b = getBill(), query = type.endsWith('query'); if (b.status === 'paid') return s;
    if (!['success', 'failed', 'processing'].includes(p.outcome)) fail('请选择有效付款结果。');
    if (query) { if (b.status !== 'processing') fail('当前付款无需查询。'); }
    else {
      if (b.dispute?.status === 'open') fail('账单差异尚未完成核查，不能提交付款。');
      if (!['confirmed', 'failed'].includes(b.status)) fail('账单须由门店核对；处理中请查询原交易。');
      if (p.outcome !== 'processing') fail('请先提交付款，再查询渠道结果。');
      if (b.items.some(i => i.amountCents > 0 && !eligible(s.goods.find(o => o.id === i.orderId)))) fail('关联订单有售后或尚不可结算。');
      if (!b.amountCents) { b.status = 'paid'; log(b, '调整后账单为零，无需转账，已结清'); s.revision++; return s; }
      b.attempts++;
    }
    b.status = p.outcome === 'success' ? 'paid' : p.outcome === 'failed' ? 'failed' : 'processing';
    if (p.outcome === 'success') { for (const line of b.items) { const o = s.goods.find(o => o.id === line.orderId); o.commissionPaidCents += line.amountCents; reconcileDebt(o); } b.paidAt = s.now; log(b, '集团付款成功 ' + money(b.amountCents) + ' · ' + b.paymentId); }
    else if (p.outcome === 'failed') { log(b, '付款失败，保留原交易号待重试'); for (const line of b.items) adjustBills(s.goods.find(o => o.id === line.orderId)); }
    else log(b, '付款已提交，等待渠道核查 · ' + b.paymentId);
  } else if (type === 'recovery.receive') {
    requireRole('group'); const r = s.recoveries.find(r => r.id === p.id); if (!r) fail('追回记录不存在。');
    const amount = integer(p.amountCents, 1), proof = text(p.proof, '回款凭证 / 说明'), requestId = text(p.requestId, '回款登记标识');
    const requestSignature = JSON.stringify({ id: r.id, amountCents: amount, proof });
    const previousReceipt = s.recoveries.flatMap(x => x.records || []).find(x => x.requestId === requestId);
    if (previousReceipt) { if (previousReceipt.requestSignature !== requestSignature) fail('该回款登记标识已用于不同内容，请核对后重新提交。'); return s; }
    if (amount > r.amountCents - r.recoveredCents) fail('金额超过尚待追回金额。');
    r.recoveredCents += amount; (r.records ??= []).push({ requestId, requestSignature, amountCents: amount, proof, at: s.now }); r.status = r.recoveredCents === r.amountCents ? 'closed' : 'open'; log(r, '登记集团收到门店回款 ' + money(amount));
  } else fail('暂不支持此操作：' + type);
  syncCare(s, ctx);
  syncInvoices(s, ctx);
  syncServiceFunds(s,ctx);
  finalGoods();
  syncGoodsSettlement(s,settlementCtx);
  syncCommerceInvoices(s,ctx);
  s.revision++; return s;
}
