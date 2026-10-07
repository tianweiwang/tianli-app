import { serviceFinanceSummary } from './service-finance.mjs';
import { actorAccountFields, resolveAccountActor, canAccountReadSource } from './staff-accounts.mjs';

const DAY = 86400000;
const clone = value => structuredClone(value);
const actorInfo = a => ({ role: a.role, job: a.role === 'group' ? a.job || null : null, id: a.role === 'tech' ? a.techId : ['store', 'manager'].includes(a.role) ? a.storeId : a.role === 'system' ? 'system' : 'group', ...actorAccountFields(a) });
const canonical = v => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
const key = v => JSON.stringify(canonical(v));
const financeActor = a => a.role === 'group' && (!a.job || ['all', 'finance'].includes(a.job));
const monthAt = at => new Date(at + 8 * 3600000).toISOString().slice(0, 7);
function text(v, label, ctx, max = 300) { const value = String(v ?? '').trim(); if (!value || value.length > max) ctx.fail(`请填写${label}（最多${max}字）`); return value; }
function int(v, label, ctx, min = 0, max = Number.MAX_SAFE_INTEGER) { const value = Number(v); if (v == null || typeof v === 'boolean' || String(v).trim() === '' || !Number.isSafeInteger(value) || value < min || value > max) ctx.fail(`${label}无效`); return value; }
function date(v, label, ctx) {
  if (typeof v === 'number') { if (!Number.isSafeInteger(v) || !Number.isFinite(new Date(v).getTime())) ctx.fail(`${label}无效`); return v; }
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?(Z|[+-]\d{2}:\d{2})?$/.exec(String(v));
  if (!match) ctx.fail(`${label}无效`);
  const [, y, m, d, hh = '00', mm = '00', ss = '00', , zone] = match;
  const calendar = new Date(0); calendar.setUTCFullYear(Number(y), Number(m) - 1, Number(d));
  if (calendar.getUTCFullYear() !== Number(y) || calendar.getUTCMonth() !== Number(m) - 1 || calendar.getUTCDate() !== Number(d) || Number(hh) > 23 || Number(mm) > 59 || Number(ss) > 59) ctx.fail(`${label}无效`);
  const iso = match[4] ? String(v) : `${y}-${m}-${d}T00:00:00${zone || ''}`;
  const value = Date.parse(zone ? iso : `${iso}+08:00`);
  if (!Number.isSafeInteger(value)) ctx.fail(`${label}无效`); return value;
}
function version(row, p, ctx) { if (p.version == null || typeof p.version === 'boolean' || String(p.version).trim() === '' || !Number.isSafeInteger(Number(p.version)) || Number(p.version) !== row.version) ctx.fail('记录已更新或缺少版本，请刷新后重试'); }
function rounded(numerator, denominator, mode) {
  const n = BigInt(numerator), d = BigInt(denominator);
  return Number((n + (mode === 'round' ? d / 2n : 0n)) / d);
}
export function upgradeTechIncome(s) {
  for (const name of ['techIncomeRules', 'techIncomeEntries', 'techIncomeAdjustments', 'techIncomePayouts', 'techIncomeDifferences', 'techIncomeRequests']) s[name] ??= [];
  return s;
}
export function previewTechIncome({ amountCents, refundedCents = 0, rateBps, refundPolicy, rounding }) {
  if (![amountCents, refundedCents, rateBps].every(Number.isSafeInteger) || amountCents < 0 || refundedCents < 0 || refundedCents > amountCents || rateBps < 0 || rateBps > 10000 || !['proportional', 'unchanged'].includes(refundPolicy) || !['floor', 'round'].includes(rounding)) return { amountCents: null, reason: '请明确金额、比例、退款方式及取整规则' };
  const base = refundedCents === amountCents ? 0 : refundPolicy === 'proportional' ? amountCents - refundedCents : amountCents;
  return { amountCents: rounded(BigInt(base) * BigInt(rateBps), 10000n, rounding), reason: '' };
}
function selectRule(s, b) {
  return s.techIncomeRules.filter(r => r.storeId === b.storeId && ['all', b.serviceId].includes(r.serviceId) && r.effectiveAt <= s.now)
    .sort((a, z) => Number(z.serviceId !== 'all') - Number(a.serviceId !== 'all') || z.effectiveAt - a.effectiveAt || z.version - a.version)[0];
}
export function captureTechIncome(s, b, ctx) {
  upgradeTechIncome(s);
  if (!b?.techId) return null;
  if (b.techIncomeSnapshot?.techId === b.techId && b.techIncomeSnapshot.storeId === b.storeId) return b.techIncomeSnapshot;
  const rule = selectRule(s, b);
  const snapshot = { id: ctx.id('TIS'), bookingId: b.id, techId: b.techId, storeId: b.storeId, capturedAt: s.now, status: rule ? 'configured' : 'missing', ruleId: rule?.id || null, ruleVersion: rule?.version || null, rule: rule ? clone(rule) : null };
  ctx.log?.(snapshot, rule ? `技师提成规则已固定 · ${b.techId} · ${rule.id}` : `接单时未配置技师提成规则 · ${b.techId}`);
  b.techIncomeSnapshot = snapshot; (b.techIncomeSnapshots ??= []).push(clone(snapshot));
  return snapshot;
}
function calculation(b, payment) {
  const snapshot = b.techIncomeSnapshot;
  if (!snapshot || snapshot.techId !== b.techId || snapshot.storeId !== b.storeId) return { amountCents: null, reason: '历史订单缺少该服务技师的接单规则快照，待核对' };
  if (!snapshot.rule) return { amountCents: null, reason: '接单时提成规则未配置，不能追套当前规则' };
  const rule = snapshot.rule, ordinary = previewTechIncome({ amountCents: payment.amountCents, refundedCents: payment.refundedCents || 0, ...rule });
  if (ordinary.amountCents === null) return ordinary;
  if (b.completionKind !== 'interrupted') return ordinary;
  const d = (b.disputes || []).find(x => x.kind === 'interruption' && ['health', 'non-user'].includes(x.responsibility));
  if (!d || !Number.isSafeInteger(d.actualMinutes) || !Number.isSafeInteger(d.totalMinutes) || d.actualMinutes < 0 || d.totalMinutes <= 0 || d.actualMinutes > d.totalMinutes) return { amountCents: null, reason: '中止责任或服务时长尚未核实' };
  const expected = (b.refunds || []).filter(r => r.kind === 'interruption' && (r.disputeId === d.id || d.refundId === r.id));
  const interruptionRefunded = expected.reduce((total, r) => total + (r.executions?.length ? r.executions.filter(e => e.paymentId === payment.id && e.status === 'success').reduce((n, e) => n + e.amountCents, 0) : r.status === 'success' ? (r.lines || []).filter(e => e.paymentId === payment.id).reduce((n, e) => n + e.amountCents, 0) : 0), 0);
  if ((payment.refundedCents || 0) > interruptionRefunded) return { amountCents: null, reason: '中止后另有成功退款，提成调整口径待核对，不能再次按比例扣减' };
  return { amountCents: rounded(BigInt(payment.amountCents) * BigInt(rule.rateBps) * BigInt(d.actualMinutes), 10000n * BigInt(d.totalMinutes), rule.rounding), reason: '', actualMinutes: d.actualMinutes, totalMinutes: d.totalMinutes };
}
function log(s, entry, action, actor, ctx, details = {}) {
  (entry.history ??= []).push({ action, at: s.now, actor: actorInfo(actor), ...clone(details) }); entry.updatedAt = s.now;
  ctx.log?.(entry, `技师收入${action} · ${entry.id}`);
}
function paymentState(payment) { return { paymentId: payment.id, amountCents: payment.amountCents, refundedCents: payment.refundedCents || 0 }; }
function paidTotals(s, entry) {
  const paid = s.techIncomePayouts.reduce((sum, p) => sum + p.lines.filter(line => line.entryId === entry.id).reduce((n, line) => n + line.amountCents, 0), 0);
  const records = s.techIncomeDifferences.filter(d => d.entryId === entry.id).flatMap(d => d.records || []);
  return { paidCents: paid + records.filter(r => r.kind === 'supplement').reduce((n, r) => n + r.amountCents, 0), recoveredCents: records.filter(r => r.kind === 'recover').reduce((n, r) => n + r.amountCents, 0) };
}
function reconcileDifference(s, entry, known, ctx) {
  const open = s.techIncomeDifferences.find(d => d.entryId === entry.id && d.status === 'open');
  if (!known || entry.paidCents <= 0) return;
  const delta = entry.amountCents - entry.netPaidCents;
  const kind = delta < 0 ? 'recover' : 'supplement';
  if (open && (!delta || open.kind !== kind)) { open.status = 'closed'; open.remainingCents = 0; open.version++; log(s, open, '差额已平或方向变化', { role: 'system' }, ctx); }
  if (!delta) return;
  if (open?.status === 'open') {
    if (open.remainingCents !== Math.abs(delta)) { open.remainingCents = Math.abs(delta); open.amountCents = open.remainingCents + open.records.reduce((n, r) => n + r.amountCents, 0); open.version++; log(s, open, '差额更新', { role: 'system' }, ctx); }
  } else {
    const item = { id: ctx.id('TID'), entryId: entry.id, bookingId: entry.bookingId, paymentId: entry.paymentId, storeId: entry.storeId, techId: entry.techId, month: entry.month, version: 1, kind, amountCents: Math.abs(delta), remainingCents: Math.abs(delta), status: 'open', reason: '已发后应计变化，须核实实际收回或补发，不自动抵扣其他月份', records: [], createdAt: s.now, updatedAt: s.now };
    s.techIncomeDifferences.push(item); log(s, item, '生成已发差额事项', { role: 'system' }, ctx);
  }
}
export function syncTechIncome(s, ctx) {
  upgradeTechIncome(s);
  for (const b of s.bookings || []) {
    if (b.status !== 'done' || !Number.isFinite(b.completedAt) || b.completedAt > s.now || !b.techId) continue;
    const payments = [b.payment, ...(b.extensions || []).filter(p => p.duration > 0)].filter(p => p?.status === 'success' && p.amountCents > 0);
    for (const payment of payments) {
      let entry = s.techIncomeEntries.find(e => e.bookingId === b.id && e.paymentId === payment.id);
      const result = calculation(b, payment), financial = serviceFinanceSummary(s, b, payment.id);
      const facts = paymentState(payment);
      if (!entry) {
        entry = { id: ctx.id('TI'), bookingId: b.id, paymentId: payment.id, storeId: b.storeId, techId: b.techId, month: monthAt(b.completedAt), earnedAt: b.completedAt, version: 1, status: 'pending', reason: '', amountCents: result.amountCents, paidCents: 0, recoveredCents: 0, netPaidCents: 0, payableCents: 0, ruleSnapshot: clone(b.techIncomeSnapshot || null), paymentSnapshot: facts, createdAt: s.now, updatedAt: s.now, history: [] };
        s.techIncomeEntries.push(entry); log(s, entry, '应计建账', { role: 'system' }, ctx, { amountCents: result.amountCents, reason: result.reason, paymentSnapshot: facts });
      }
      const before = key({ amountCents: entry.amountCents, paymentSnapshot: entry.paymentSnapshot, status: entry.status, reason: entry.reason, paidCents: entry.paidCents, recoveredCents: entry.recoveredCents, payableCents: entry.payableCents });
      const factsChanged = key(entry.paymentSnapshot) !== key(facts);
      if (factsChanged || (result.amountCents !== null && result.amountCents !== entry.amountCents)) {
        const adjustment = { id: ctx.id('TIA'), entryId: entry.id, bookingId: b.id, paymentId: payment.id, storeId: entry.storeId, techId: entry.techId, month: monthAt(s.now), originMonth: entry.month, beforeCents: entry.amountCents, afterCents: result.amountCents, deltaCents: result.amountCents === null || entry.amountCents === null ? null : result.amountCents - entry.amountCents, reason: result.reason || '依据成功退款及接单规则更新应计', previousPayment: clone(entry.paymentSnapshot), paymentSnapshot: facts, at: s.now, actor: actorInfo({ role: 'system' }) };
        s.techIncomeAdjustments.push(adjustment);
        if (result.amountCents !== null) entry.amountCents = result.amountCents;
        entry.paymentSnapshot = facts; log(s, entry, '追加调整', { role: 'system' }, ctx, { adjustmentId: adjustment.id, deltaCents: adjustment.deltaCents, reason: adjustment.reason });
      }
      Object.assign(entry, paidTotals(s, entry)); entry.netPaidCents = entry.paidCents - entry.recoveredCents;
      const known = result.amountCents !== null;
      reconcileDifference(s, entry, known, ctx);
      const difference = s.techIncomeDifferences.find(d => d.entryId === entry.id && d.status === 'open');
      const blockedReason = result.reason || (!financial?.canPayTech ? financial?.eligibilityReason || '服务资金尚未结清或缺少财务依据' : '');
      entry.payableCents = known && !blockedReason && entry.paidCents === 0 ? Math.max(0, entry.amountCents - entry.netPaidCents) : 0;
      entry.reason = result.reason || (difference ? difference.reason : blockedReason);
      entry.status = !known ? 'pending' : difference ? 'difference' : entry.paidCents > 0 ? 'paid' : entry.amountCents === 0 ? 'void' : blockedReason ? 'held' : 'payable';
      const after = key({ amountCents: entry.amountCents, paymentSnapshot: entry.paymentSnapshot, status: entry.status, reason: entry.reason, paidCents: entry.paidCents, recoveredCents: entry.recoveredCents, payableCents: entry.payableCents });
      if (before !== after) { entry.version++; entry.updatedAt = s.now; }
    }
  }
  return s;
}
function storeAllowed(s, actor, storeId, ctx) {
  if (actor.role !== 'store' || actor.storeId !== storeId || !s.stores?.some(item => item.id === storeId)) ctx.fail('仅门店后台可以登记本店技师发放或差额事实');
}
export function techIncomeCommand(s, actor, type, p, ctx) {
  upgradeTechIncome(s);
  if (!['tech-income.rule-publish', 'tech-income.payout', 'tech-income.difference-record'].includes(type)) ctx.fail('不支持的技师收入操作');
  let difference;
  if (type === 'tech-income.rule-publish') { if (!financeActor(actor)) ctx.fail('仅集团管理员或财务可以发布技师提成规则'); }
  else if (type === 'tech-income.difference-record') { difference = s.techIncomeDifferences.find(d => d.id === p.id); if (!difference) ctx.fail('差额事项不存在'); storeAllowed(s, actor, difference.storeId, ctx); }
  else storeAllowed(s, actor, actor.storeId, ctx);
  const requestId = text(p.requestId, '唯一提交标识', ctx), who = key(actorInfo(actor)), fingerprint = key({ type, payload: p });
  const prior = s.techIncomeRequests.find(r => r.actor === who && r.requestId === requestId);
  if (prior) { if (prior.fingerprint !== fingerprint) ctx.fail('同一提交标识不能用于不同内容'); return clone(prior.result); }
  let result;
  if (type === 'tech-income.rule-publish') {
    if (!s.stores?.some(item => item.id === p.storeId)) ctx.fail('请选择有效门店');
    const serviceId = p.serviceId || 'all'; if (serviceId !== 'all' && !s.services?.some(item => item.id === serviceId)) ctx.fail('请选择有效项目');
    const previous = s.techIncomeRules.filter(r => r.storeId === p.storeId && r.serviceId === serviceId).sort((a, b) => b.version - a.version)[0];
    version({ version: previous?.version || 0 }, p, ctx);
    const rateBps = int(p.rateBps, '提成比例', ctx, 0, 10000);
    if (!['proportional', 'unchanged'].includes(p.refundPolicy) || !['floor', 'round'].includes(p.rounding)) ctx.fail('请明确选择退款处理及取整规则');
    const effectiveAt = date(p.effectiveAt, '生效时间', ctx); if (effectiveAt < s.now) ctx.fail('新规则不能追溯到过去生效');
    result = { id: ctx.id('TIR'), storeId: p.storeId, serviceId, rateBps, refundPolicy: p.refundPolicy, rounding: p.rounding, effectiveAt, version: (previous?.version || 0) + 1, publishedAt: s.now, publishedBy: actorInfo(actor), reason: text(p.reason, '规则发布依据', ctx) };
    s.techIncomeRules.push(result); log(s, result, '发布规则', actor, ctx);
  } else if (type === 'tech-income.payout') {
    syncTechIncome(s, ctx);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(p.month || '')) ctx.fail('请选择有效的发放所属月份');
    if (!Array.isArray(p.lines) || !p.lines.length) ctx.fail('请选择本次可发明细');
    const seen = new Set();
    const lines = p.lines.map(line => {
      if (seen.has(line.entryId)) ctx.fail('同一提成明细不能重复分配'); seen.add(line.entryId);
      const entry = s.techIncomeEntries.find(e => e.id === line.entryId);
      if (!entry || entry.storeId !== actor.storeId || entry.techId !== p.techId || entry.month !== p.month) ctx.fail('提成明细不属于本店本技师或本月');
      version(entry, line, ctx);
      if (entry.status !== 'payable' || entry.payableCents <= 0) ctx.fail('该提成明细尚不可发放、已发或需处理差额');
      return { entryId: entry.id, version: entry.version, bookingId: entry.bookingId, paymentId: entry.paymentId, amountCents: entry.payableCents };
    });
    const paidAt = date(p.paidAt, '实际发放日期', ctx);
    if (paidAt > s.now || lines.some(line => paidAt < s.techIncomeEntries.find(e => e.id === line.entryId).earnedAt)) ctx.fail('实际发放日期须在应计形成后且不能晚于当前时间');
    result = { id: ctx.id('TIP'), storeId: actor.storeId, techId: p.techId, month: p.month, lines, amountCents: lines.reduce((n, line) => n + line.amountCents, 0), proof: text(p.proof, '线下转账凭证编号', ctx), paidAt, reason: text(p.reason, '发放说明', ctx), status: 'paid', version: 1, createdAt: s.now, actor: actorInfo(actor), requestId };
    s.techIncomePayouts.push(result); log(s, result, '登记实际线下发放', actor, ctx); syncTechIncome(s, ctx);
  } else {
    syncTechIncome(s, ctx); version(difference, p, ctx);
    if (difference.status !== 'open' || p.kind !== difference.kind) ctx.fail('差额事项已关闭或处理方向不一致');
    const entry = s.techIncomeEntries.find(e => e.id === difference.entryId);
    if (!entry || entry.status === 'pending') ctx.fail('提成口径仍待核对，暂不能登记处理金额');
    if (difference.kind === 'supplement' && !serviceFinanceSummary(s, difference.bookingId, difference.paymentId)?.canPayTech) ctx.fail('服务资金尚未结清，不能补发');
    const amountCents = int(p.amountCents, '实际处理金额', ctx, 1, difference.remainingCents);
    const occurredAt = date(p.occurredAt, '实际处理日期', ctx); if (occurredAt > s.now || occurredAt < difference.createdAt) ctx.fail('实际处理日期须在差额形成后且不能晚于当前时间');
    result = { id: ctx.id('TIF'), differenceId: difference.id, kind: difference.kind, amountCents, occurredAt, proof: text(p.proof, '实际转账凭证编号', ctx), reason: text(p.reason, '差额处理依据', ctx), actor: actorInfo(actor), at: s.now, requestId };
    difference.records.push(result); difference.version++; log(s, difference, '登记实际差额处理', actor, ctx, { recordId: result.id }); syncTechIncome(s, ctx);
  }
  s.techIncomeRequests.push({ requestId, actor: who, fingerprint, result: clone(result), at: s.now });
  return result;
}
export function techIncomeView(s, actor) {
  // Historical tech reads are authorized by the caller's ordinary-user bridge.
  if(actor?.sessionId || actor?.accountId || actor?.role!=='tech')actor=resolveAccountActor(s,actor);
  const allowed = financeActor(actor) || ['store', 'manager', 'tech'].includes(actor.role);
  const visible = item => (financeActor(actor) || (actor.role === 'tech' ? item.techId === actor.techId : item.storeId === actor.storeId)) && (!actor.lifecyclePurpose || canAccountReadSource(s,actor,'tech-income',item));
  const entries = allowed ? (s.techIncomeEntries || []).filter(visible) : [];
  const differences = allowed ? (s.techIncomeDifferences || []).filter(visible) : [];
  const summary = {
    accruedCents: entries.filter(e => e.status !== 'pending').reduce((n, e) => n + (e.amountCents || 0), 0), knownAccruedCents: entries.filter(e => e.status !== 'pending').reduce((n, e) => n + (e.amountCents || 0), 0), lastKnownPendingCents: entries.filter(e => e.status === 'pending').reduce((n, e) => n + (e.amountCents || 0), 0), paidCents: entries.reduce((n, e) => n + e.paidCents, 0), recoveredCents: entries.reduce((n, e) => n + e.recoveredCents, 0),
    payableCents: entries.reduce((n, e) => n + e.payableCents, 0), heldCents: entries.filter(e => e.status === 'held').reduce((n, e) => n + (e.amountCents || 0), 0), pendingCount: entries.filter(e => e.status === 'pending').length,
    differenceCents: differences.filter(d => d.status === 'open').reduce((n, d) => n + d.remainingCents, 0),
    pendingTypes: ['交通补贴需履约事实和正式规则', '已出发取消、爽约及改派路费补偿待接入']
  };
  const details = allowed && actor.role !== 'manager';
  return clone({ rules: financeActor(actor) ? s.techIncomeRules || [] : [], entries: details ? entries : [], adjustments: details ? (s.techIncomeAdjustments || []).filter(visible) : [], payouts: details ? (s.techIncomePayouts || []).filter(visible) : [], differences: details ? differences : [], summary });
}
