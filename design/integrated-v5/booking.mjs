// Local domain model. The caller applies commands to a copy and commits only on success.
import { serviceSnapshot, DEFAULT_RULES, assertJob, storeOpeningReadiness } from './management.mjs';
import { lifecyclePauseSelection } from './organization-lifecycle-pause.mjs';
import { upgradeBusy, busyAvailabilityError, busyCommand } from './busy.mjs';
import { captureBookingFinance, captureExtensionFinance } from './service-finance.mjs';
import { captureTechIncome } from './tech-income.mjs';
import { technicianReviewSummary } from './service-reviews.mjs';
import { careBlocksBooking } from './service-care.mjs';
import { technicianAssignmentEligibility, captureTechnicianAssignment } from './organization-assignment.mjs';
import { captureBookingHandoff } from './service-handoff.mjs';
import { actorAccountFields, resolveAccountActor, canAccountView, canAccountReadSource } from './staff-accounts.mjs';
import { projectBookingContact } from './sensitive-access.mjs';
export { busyView } from './busy.mjs';
const MIN = 60000, HOUR = 60 * MIN, DAY = 24 * HOUR;
const OPEN = new Set(['unpaid', 'waiting', 'confirmed', 'active']);
const RESULT_LABEL = { success: '成功', failed: '失败', processing: '处理中' };
const REFUND_RESERVED = new Set(['requested', 'offered', 'approved', 'processing', 'failed', 'escalated']);
const copy = value => structuredClone(value);
const truth = value => value === true || value === 'true' || value === 'on' || value === 1;
const overlap = (a, b, c, d) => a < d && b > c;
const required = (value, label, ctx) => { const str = String(value ?? '').trim(); if (!str) ctx.fail(`请填写${label}`); return str; };
const integer = (value, label, ctx, minimum = 0) => { const n = Number(value); if (!Number.isSafeInteger(n) || n < minimum) ctx.fail(`${label}无效`); return n; };
const timestamp = (value, ctx) => {
  const result = typeof value === 'number' || /^\d{13}$/.test(String(value)) ? Number(value)
    : Date.parse(/(?:Z|[+-]\d\d:\d\d)$/.test(String(value)) ? value : `${value}+08:00`);
  if (!Number.isSafeInteger(result)) ctx.fail('日期时间无效');
  return result;
};
const shanghai = time => new Date(time + 8 * HOUR);
const dateKey = time => shanghai(time).toISOString().slice(0, 10);
const defaultSchedule = { start: '09:00', end: '23:00', breakStart: '12:00', breakEnd: '13:00' };
// Existing schema-5 sessions had no editable schedules or lunch break. Keep their
// committed appointments valid; fresh demos use the v4 noon break again.
const legacySchedule = { start: '09:00', end: '23:00', breakStart: '', breakEnd: '' };
const minuteOfDay = value => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
const plainSchedule = value => ({ start: value.start, end: value.end, breakStart: value.breakStart || '', breakEnd: value.breakEnd || '' });
const distance = (a, b) => {
  const r = n => n * Math.PI / 180;
  const x = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
};
const allPayments = b => [b.payment, ...b.extensions];
const paid = b => allPayments(b).filter(x => x.status === 'success');
const totals = b => ({ paidCents: paid(b).reduce((n, x) => n + x.amountCents, 0), refundedCents: paid(b).reduce((n, x) => n + x.refundedCents, 0) });
const duration = (b, locks = false) => b.duration + b.extensions.filter(x => x.status === 'success' || (locks && ['unpaid', 'processing', 'failed'].includes(x.status))).reduce((n, x) => n + x.duration, 0);
const price = (service, startAt) => shanghai(startAt).getUTCHours() >= 21 ? service.nightCents : service.priceCents;
const isStore = (a, id) => ['manager', 'store'].includes(a.role) && a.storeId === id;
const canSee = (b, a) => a.role === 'group' || (a.role === 'user' && a.userId === b.userId) || (a.role === 'tech' && a.techId === b.techId) || isStore(a, b.storeId);
const staff = (a, b, ctx, group = true) => { if (!(isStore(a, b.storeId) || (group && a.role === 'group'))) ctx.fail('无权处理这家门店的预约'); };
const user = (a, b, ctx) => { if (a.role !== 'user' || a.userId !== b.userId) ctx.fail('仅预约本人可以操作'); };
const tech = (a, b, ctx) => { if (a.role !== 'tech' || a.techId !== b.techId) ctx.fail('仅本单技师可以操作'); };
const knownUser = (s, a, ctx) => { if (a.role !== 'user' || !s.users.some(x => x.id === a.userId)) ctx.fail('请先选择有效的用户身份'); };
const get = (s, a, id, ctx) => { const b = s.bookings.find(x => x.id === id); if (!b || !canSee(b, a)) ctx.fail('预约不存在或无权查看'); return b; };
const beforeStart = (b, ctx) => {
  if (!['waiting', 'confirmed'].includes(b.status) || b.startedAt || b.departedAt || b.arrivedAt) ctx.fail('已开始履约或当前状态不允许变更');
};
const event = (ctx, entity, text) => ctx.log(entity, text);
const activeSafety = (s, b) => s.safety.some(x => x.bookingId === b.id && x.status === 'open');
const openDisputes = b => (b.disputes || []).filter(d => !['resolved', 'closed'].includes(d.status));
const safetyDispute = (b, h) => (b.disputes || []).find(d => d.kind === 'service' && (d.safetyId === h.id || d.id === h.disputeId));
const orphanSafetyDispute = (s, b) => (s.safety || []).some(h => h.bookingId === b.id && h.unresolvedDispute && !safetyDispute(b, h));
const blocked = (s, b) => careBlocksBooking(s, b) || activeSafety(s, b) || openDisputes(b).length > 0 || orphanSafetyDispute(s, b) || b.refunds.some(r => REFUND_RESERVED.has(r.status) || (r.status === 'rejected' && r.deadline));
const actorRecord = a => ({ role: a.role, job: a.job || null, id: a.role === 'user' ? a.userId : a.role === 'tech' ? a.techId : ['manager','store'].includes(a.role) ? a.storeId : 'group', ...actorAccountFields(a) });
const arrangement = (s, b, overrides = {}) => {
  const x = { startAt: b.startAt, techId: b.techId, ...overrides };
  return { ...x, storeId: b.storeId, storeName: b.storeSnapshot?.name || s.stores.find(t => t.id === b.storeId)?.name, techName: overrides.techId ? s.techs.find(t => t.id === x.techId)?.name : b.techSnapshot?.name || s.techs.find(t => t.id === x.techId)?.name };
};
const setTechnician = (s, b, techId) => { b.techId = techId; b.techSnapshot = { id: techId, name: s.techs.find(t => t.id === techId)?.name }; };
function recordChange(s, b, c) {
  b.changeHistory ??= [];
  const old = b.changeHistory.findIndex(x => x.id === c.id);
  if (old < 0) b.changeHistory.push(copy(c)); else b.changeHistory[old] = copy(c);
}
function settleDispute(s, b, r) {
  const d = (b.disputes || []).find(x => x.refundId === r.id);
  if (!d || r.status !== 'success') return;
  d.status = 'resolved'; d.resolvedAt = s.now; d.actualRefundCents = (r.executions || []).filter(x => x.status === 'success').reduce((n, x) => n + x.amountCents, 0);
}
function recordRefundVersion(s, r, actor, decision, migrated = false) {
  r.versions ??= [];
  r.version = Math.max(r.version || 0, ...r.versions.map(x => x.version), 0) + 1;
  r.versions.push({ version: r.version, amountCents: r.amountCents, lines: copy(r.lines || []), reason: r.reviewReason || r.reason, createdAt: migrated ? r.updatedAt || r.createdAt : s.now, createdBy: actorRecord(actor), decision, ...(migrated ? { migrated: true } : {}) });
}
function ensureRefundVersion(s, r) {
  r.versions ??= [];
  if (!r.versions.length && r.status !== 'requested') recordRefundVersion(s, r, { role: 'system' }, r.status, true);
  r.version ??= 0;
  if (r.acceptedAt && r.acceptedVersion == null) { r.acceptedVersion = r.version; r.acceptedLines = copy(r.lines || []); r.acceptedAmountCents = r.amountCents; }
}
function lockRefundAcceptance(s, r, actor, mode) {
  r.acceptedAt = s.now; r.acceptedBy = actorRecord(actor); r.acceptanceMode = mode;
  r.acceptedVersion = r.version; r.acceptedLines = copy(r.lines); r.acceptedAmountCents = r.amountCents;
}
// Additive migration: legacy successful refunds have already adjusted payment totals.
// Creating execution records must never replay those adjustments.
export function upgradeBookings(s) {
  upgradeBusy(s);
  for (const b of s.bookings || []) {
    b.disputes ??= []; b.changeHistory ??= []; b.assistance ??= [];
    if (b.change) recordChange(s, b, b.change);
    for (const r of b.refunds || []) { ensureRefundVersion(s, r); ensureExecutions(r); }
  }
  for (const h of s.safety || []) {
    h.stage ??= h.status === 'closed' ? 'closed' : 'pending'; h.ackDeadline ??= h.createdAt + 3 * MIN; h.escalationDeadline ??= h.createdAt + 6 * MIN;
    const b = (s.bookings || []).find(x => x.id === h.bookingId);
    if (!h.unresolvedDispute || !b) continue;
    let d = safetyDispute(b, h);
    if (!d) { const createdAt = h.closedAt || h.createdAt; d = { id: `DS-${h.id}`, kind: 'service', status: 'open', reason: h.resolution || '旧安全结案仍有服务争议，待独立核实', safetyId: h.id, createdAt, deadline: createdAt + DAY, createdBy: h.closedBy || { role: 'system', id: 'migration' }, migrated: true, events: [] }; b.disputes.push(d); }
    d.safetyId ??= h.id; h.disputeId = d.id;
  }
  return s;
}
function ensureExecutions(r) {
  r.executions ??= [];
  for (const line of r.lines || []) {
    if (r.executions.some(x => x.paymentId === line.paymentId)) continue;
    r.executions.push({ ...line, refundNo: `${r.id}-${line.paymentId}`, status: line.amountCents === 0 ? 'success' : ['processing', 'failed', 'success'].includes(r.status) ? r.status : 'approved', attempts: r.attempts || 0, createdAt: r.createdAt, ...(r.status === 'success' ? { completedAt: r.completedAt || r.updatedAt || r.createdAt, migrated: true } : {}) });
  }
  return r.executions;
}
function aggregateRefund(s, b, r) {
  const parts = ensureExecutions(r);
  r.successCents = parts.filter(x => x.status === 'success').reduce((n, x) => n + x.amountCents, 0);
  r.status = parts.every(x => x.status === 'success') ? 'success' : parts.some(x => x.status === 'processing') ? 'processing' : parts.some(x => x.status === 'failed') ? 'failed' : parts.some(x => x.status === 'success' && x.amountCents > 0) ? 'processing' : 'approved';
  r.updatedAt = s.now;
  if (r.status === 'success') { r.completedAt ??= s.now; settleDispute(s, b, r); }
}
export function bookingCanHelp(s, b, actor) {
  if (!canSee(b, actor) || !['user', 'tech'].includes(actor.role)) return false;
  if (b.status === 'done' || b.stoppedAt) return actor.role === 'user' && s.now <= (b.stoppedAt || b.completedAt) + 2 * HOUR;
  return Boolean(b.startedAt || b.departedAt || b.arrivedAt) && !['cancelled', 'closed'].includes(b.status);
}
function createSafety(s, b, reporter, reason, ctx) {
  const h = { id: ctx.id('SF'), bookingId: b.id, storeId: b.storeId, techId: b.techId, userId: b.userId, reporter, reason, status: 'open', stage: 'pending', createdAt: s.now, ackDeadline: s.now + 3 * MIN, escalationDeadline: s.now + 6 * MIN, priorStatus: b.status, completedAtAtReport: b.completedAt, events: [], notifications: [{ at: s.now, channel: 'demo', target: '门店店长及集团值班客服', result: '本地待办已生成' }] };
  s.safety.push(h); event(ctx, h, '求助已提交，3分钟内待接报'); event(ctx, b, '求助待处理，暂停结算'); return h;
}

export function bookingSeed() {
  return {
    stores: [
      { id: 'xingfu', name: '天俪·幸福里门店', regionId: 'home', address: '幸福路128号', lat: 31.231, lng: 121.475, active: true, serviceIds: ['relax', 'neck'], bufferMinutes: 30 },
      { id: 'silver', name: '天俪·银杏门店', regionId: 'silver', address: '银杏路66号', lat: 31.25, lng: 121.50, active: true, serviceIds: ['relax', 'neck'], bufferMinutes: 30 },
      { id: 'yuan', name: '天俪·雅园门店', regionId: 'yuan', address: '雅园路20号', lat: 31.215, lng: 121.46, active: true, serviceIds: ['relax', 'neck'], bufferMinutes: 30 }
    ],
    services: [
      { id: 'relax', name: '舒缓放松', duration: 60, priceCents: 29800, nightCents: 32800 },
      { id: 'neck', name: '肩颈舒缓', duration: 45, priceCents: 19800, nightCents: 22800 }
    ],
    techs: [
      { id: 'lin', name: '林师傅', storeId: 'xingfu', serviceIds: ['relax', 'neck'], gender: 'male', lat: 31.238, lng: 121.478, active: true, rating: 4.9, count: 126 },
      { id: 'chen', name: '陈师傅', storeId: 'xingfu', serviceIds: ['neck'], gender: 'female', lat: 31.246, lng: 121.481, active: true, rating: 4.8, count: 88 },
      { id: 'zhou', name: '周师傅', storeId: 'xingfu', serviceIds: ['relax', 'neck'], gender: 'male', lat: 31.222, lng: 121.49, active: true, rating: null, count: 3 },
      { id: 'ma', name: '马师傅', storeId: 'silver', serviceIds: ['relax', 'neck'], gender: 'female', lat: 31.251, lng: 121.50, active: true, rating: 4.9, count: 53 },
      { id: 'gao', name: '高师傅', storeId: 'silver', serviceIds: ['relax', 'neck'], gender: 'male', lat: 31.247, lng: 121.505, active: true, rating: 4.8, count: 42 },
      { id: 'su', name: '苏师傅', storeId: 'yuan', serviceIds: ['relax', 'neck'], gender: 'female', lat: 31.216, lng: 121.461, active: true, rating: 4.9, count: 67 }
    ],
    regions: [
      { id: 'home', name: '幸福里片区', lat: 31.23, lng: 121.47 },
      { id: 'silver', name: '银杏片区', lat: 31.25, lng: 121.50 },
      { id: 'yuan', name: '雅园片区', lat: 31.215, lng: 121.46 },
      { id: 'outside', name: '其他区域', lat: 32, lng: 122 }
    ], schedules: Object.fromEntries(['lin', 'chen', 'zhou', 'ma', 'gao', 'su'].map(id => [id, { ...defaultSchedule, dates: {} }])), bookings: [], leaves: [], safety: [], busyRecords: []
  };
}

export function bookingSchedule(s, techId, date) {
  const schedule = s.schedules?.[techId];
  return plainSchedule((date && schedule?.dates?.[date]) || schedule || legacySchedule);
}

function scheduleError(s, techId, startAt, minutes) {
  const d = shanghai(startAt), from = d.getUTCHours() * 60 + d.getUTCMinutes(), until = from + minutes;
  const schedule = bookingSchedule(s, techId, dateKey(startAt));
  if (from < minuteOfDay(schedule.start) || until > minuteOfDay(schedule.end)) return `不在工作时间 ${schedule.start}–${schedule.end} 内`;
  if (schedule.breakStart && schedule.breakEnd && overlap(from, until, minuteOfDay(schedule.breakStart), minuteOfDay(schedule.breakEnd))) return `休息时间 ${schedule.breakStart}–${schedule.breakEnd}`;
  return '';
}

function availability(s, b, techId, startAt, minutes, ctx, continuing = false) {
  const t = s.techs.find(x => x.id === techId), store = s.stores.find(x => x.id === b.storeId);
  const original = s.bookings.find(x => x.id === b.id);
  const exact = original && original.techId === techId && original.storeId === b.storeId && original.serviceId === b.serviceId && original.startAt === b.startAt && original.duration === b.duration && (startAt === original.startAt || (continuing && startAt === s.now));
  const assignment = technicianAssignmentEligibility(s, techId, b.storeId, startAt, exact ? b.id : undefined, b.serviceId, {endAt:startAt + minutes * MIN});
  if (!assignment.allowed) ctx.fail(assignment.reason);
  if (b.genderPreference !== 'any' && t.gender !== b.genderPreference) ctx.fail('技师不符合所选偏好');
  const d = shanghai(startAt), startMinute = d.getUTCHours() * 60 + d.getUTCMinutes();
  if (startMinute < 540 || startMinute + minutes > 1380) ctx.fail('请选择 09:00–23:00 内可完成的时段');
  if (d.getUTCSeconds() || d.getUTCMilliseconds()) ctx.fail('时段须精确到分钟');
  const scheduleReason = scheduleError(s, techId, startAt, minutes);
  if (scheduleReason) ctx.fail(scheduleReason);
  const endAt = startAt + minutes * MIN, buffer = (store.bufferMinutes ?? 30) * MIN;
  const busyReason = busyAvailabilityError(s, techId, startAt, endAt, buffer);
  if (busyReason) ctx.fail(busyReason);
  if (s.leaves.some(l => l.techId === techId && l.status === 'approved' && overlap(startAt, endAt, l.startAt, l.endAt))) ctx.fail('该时段技师已请假');
  for (const other of s.bookings) {
    if (other.id === b.id || !OPEN.has(other.status)) continue;
    if (other.techId === techId) {
      const plannedFinish = Math.max(other.startAt, other.startedAt || 0) + duration(other, true) * MIN;
      const finish = other.status === 'active' && !other.completedAt && !other.stoppedAt && s.now >= plannedFinish ? Infinity : plannedFinish;
      if (overlap(startAt - buffer, endAt + buffer, other.startAt - buffer, finish + buffer)) ctx.fail('该时段已被预约或锁定，请重新选择');
    }
    if (other.change?.status === 'pending' && other.change.techId === techId && overlap(startAt - buffer, endAt + buffer, other.change.startAt - buffer, other.change.startAt + duration(other) * MIN + buffer)) ctx.fail('该时段已被其他变更申请锁定');
  }
  return t;
}

function slot(s, b, startAt, techId, ctx, changing = false) {
  const rules = b.rulesSnapshot || s.bookingRules || DEFAULT_RULES;
  if (startAt < s.now + rules.earliestHours * HOUR || startAt > (b.firstPaidAt ?? s.now) + rules.maxDays * DAY) ctx.fail(`预约须至少提前 ${rules.earliestHours} 小时，且不超过首次支付起 ${rules.maxDays} 天`);
  if (shanghai(startAt).getUTCMinutes() % 30) ctx.fail('请选择整点或半点时段');
  const service = b.serviceSnapshot || s.services.find(x => x.id === b.serviceId);
  if (changing && price(service, startAt) !== b.priceCents) ctx.fail('价格不同，请取消后重新预约');
  availability(s, b, techId, startAt, duration(b), ctx);
}

function proposalWindowError(s, b, startAt) {
  const rules = b.rulesSnapshot || s.bookingRules || DEFAULT_RULES;
  return startAt < s.now + rules.earliestHours * HOUR + 15 * MIN ? `门店改约须保留完整15分钟确认时间，请选择至少提前${rules.earliestHours}小时15分钟的时段` : '';
}

const queryContext = { fail: message => { throw new Error(message); } };

// The selection UI and dispatch UI use the same availability rules as commands.
// Before a time is selected this deliberately checks only eligibility, not an
// invented/default time. Supplying an existing booking id excludes its own hold.
export function bookingOptions(s, selection = {}) {
  const existing = selection.id && s.bookings.find(b => b.id === selection.id);
  const input = { ...existing, ...selection }, mode = input.mode || 'nearest';
  const genderPreference = input.genderPreference || 'any';
  const service = existing?.serviceSnapshot || s.services.find(x => x.id === input.serviceId), region = s.regions.find(x => x.id === input.regionId), store = s.stores.find(x => x.id === input.storeId);
  const stores = s.stores.map(x => {
    const readiness=lifecyclePauseSelection(s,x.id,{storeOpeningReadiness});
    const maxStart=(existing?.firstPaidAt??s.now)+(existing?.rulesSnapshot||s.bookingRules||DEFAULT_RULES).maxDays*DAY;
    return { ...copy(x), distanceKm: region ? distance(region, x) : null, covered: Boolean(region && distance(region, x) <= (x.radiusKm ?? 20)), bookable: readiness.bookable && (readiness.resumeAt==null || readiness.resumeAt<=maxStart), resumeAt:readiness.resumeAt };
  }).sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity) || a.id.localeCompare(b.id));
  let error = '', startAt = null;
  const hasTime = input.startAt !== undefined && input.startAt !== null && input.startAt !== '';
  if (!store || (!existing && !stores.find(x=>x.id===store.id)?.bookable) || !service || (!existing && service.active === false) || !store.serviceIds.includes(service.id) || !region || (!existing && distance(region, store) > (store.radiusKm ?? 20))) error = '当前片区或门店暂不支持此项目，请重新选择';
  else if (!['nearest', 'specified'].includes(mode) || !['any', 'male', 'female'].includes(genderPreference)) error = '预约方式或偏好无效';
  if (hasTime) { try { startAt = timestamp(input.startAt, queryContext); } catch (e) { error ||= e.message; } }
  const b = { ...existing, ...input, mode, genderPreference, duration: existing?.duration ?? service?.duration ?? 0, extensions: existing?.extensions || [], refunds: existing?.refunds || [] };
  const candidates = s.techs.filter(t => t.storeId === input.storeId || (existing && t.id === existing.techId)).map(t => {
    let reason = error;
    if (!reason && (!t.active || !t.serviceIds.includes(input.serviceId))) reason = '技师当前不可用或不支持此项目';
    if (!reason && !existing && t.validUntil && Date.parse(t.validUntil+'T23:59:59+08:00') < s.now) reason = '技师资质已到期，待审核续期';
    if (!reason) {
      const exact = existing && t.id === existing.techId && input.storeId === existing.storeId && input.serviceId === existing.serviceId && (!hasTime || startAt === existing.startAt);
      const q = technicianAssignmentEligibility(s,t.id,input.storeId,hasTime ? startAt : s.now,exact ? existing.id : undefined,input.serviceId,{selectionPending:!hasTime,endAt:hasTime?startAt+duration(b)*MIN:undefined}); if (!q.allowed) reason = q.reason;
    }
    if (!reason && genderPreference !== 'any' && t.gender !== genderPreference) reason = '技师不符合所选偏好';
    if (!reason && hasTime) {
      try {
        if (input.proposal === true) {
          const windowError = proposalWindowError(s, b, startAt);
          if (windowError) queryContext.fail(windowError);
        }
        // Dispatching an already-held appointment must remain possible inside
        // the 2-hour new-booking window; a changed time uses reschedule rules.
        if (existing && startAt === existing.startAt) availability(s, b, t.id, startAt, duration(b), queryContext);
        else slot(s, b, startAt, t.id, queryContext, Boolean(existing));
      } catch (e) { reason = e.message; }
    }
    const review = technicianReviewSummary(s, t.id);
    return { ...copy(t), rating: review.rating, count: review.count, distanceKm: region ? distance(region, t) : null, available: !reason, reason };
  }).sort((a, z) => (a.distanceKm ?? Infinity) - (z.distanceKm ?? Infinity) || (z.rating || 0) - (a.rating || 0) || a.count - z.count || a.id.localeCompare(z.id));
  const selected = mode === 'nearest' ? candidates.find(t => t.available) : candidates.find(t => t.id === input.techId && t.available);
  if (!selected && !error) error = mode === 'specified' ? (candidates.find(t => t.id === input.techId)?.reason || '请选择可预约的技师') : (candidates.find(t => t.active && t.serviceIds.includes(input.serviceId) && (genderPreference === 'any' || t.gender === genderPreference))?.reason || '当前没有可用技师，请更换时段或偏好');
  return { stores, candidates, selectedTechId: selected?.id || null, priceCents: service ? (startAt === null ? service.priceCents : price(service, startAt)) : 0, duration: b.duration ? duration(b) : 0, valid: !error && Boolean(selected), error };
}

export function bookingSlots(s, selection, date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) return [];
  const base = Date.parse(`${date}T00:00:00+08:00`);
  if (!Number.isFinite(base) || dateKey(base) !== date) return [];
  return Array.from({ length: 28 }, (_, i) => {
    const minutes = 540 + i * 30, startAt = base + minutes * MIN;
    const result = bookingOptions(s, { ...selection, startAt });
    return { startAt, time: `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`, priceCents: result.priceCents, available: result.valid, techId: result.selectedTechId, reason: result.error };
  });
}

function startRound(s, b, reason, ctx, phase = 'tech') {
  const r = { id: ctx.id('BR'), startedAt: s.now, deadline: Math.min(s.now + 30 * MIN, b.startAt - HOUR), techDeadline: Math.min(s.now + 10 * MIN, b.startAt - HOUR), reason, completedAt: null };
  b.round = r;
  b.rounds.push(copy(r));
  b.status = 'waiting'; b.confirmationPhase = phase;
  event(ctx, b, `开启派单轮次：${reason}`);
  if (r.deadline <= s.now) cancel(s, b, '本轮派单截止已到，全额退款', ctx);
}

function confirm(s, b, techId, ctx) {
  if (!b.round || b.round.deadline <= s.now) ctx.fail('本轮派单已到期');
  availability(s, b, techId, b.startAt, duration(b), ctx);
  setTechnician(s, b, techId); b.status = 'confirmed'; b.confirmationPhase = null;
  captureTechIncome(s, b, ctx);
  b.round.completedAt = s.now;
  const original = b.rounds.find(x => x.id === b.round.id); if (original) original.completedAt = s.now;
  event(ctx, b, '预约已确认');
  captureTechnicianAssignment(s, b, ctx);
}

function refundAvailable(b, paymentId, excludingId = null) {
  const payment = allPayments(b).find(x => x.id === paymentId);
  if (!payment || payment.status !== 'success') return 0;
  const reserved = b.refunds.filter(r => r.id !== excludingId && REFUND_RESERVED.has(r.status)).reduce((sum, r) => sum + (r.lines.length ? r.lines : r.requests).filter(x => x.paymentId === paymentId && !r.executions?.some(e => e.paymentId === x.paymentId && e.status === 'success')).reduce((n, x) => n + x.amountCents, 0), 0);
  return payment.amountCents - payment.refundedCents - reserved;
}
// Existing-rights views reuse the original per-payment reservation calculation.
// The caller must bind the booking and payment before displaying this amount.
export { refundAvailable as bookingRefundAvailable };

function refundRecord(s, b, requests, reason, ctx, approved = false) {
  const r = { id: ctx.id('RF'), status: approved ? 'approved' : 'requested', reason, requests: copy(requests), lines: approved ? copy(requests) : [], amountCents: requests.reduce((n, x) => n + x.amountCents, 0), createdAt: s.now, deadline: approved ? null : s.now + DAY, events: [], attempts: 0 };
  b.refunds.push(r);
  if (approved) { recordRefundVersion(s, r, { role: 'system' }, 'approved'); ensureExecutions(r); }
  event(ctx, b, `${approved ? '已创建原路退款' : '提交售后退款申请'} ${r.id}`);
  return r;
}

function cancel(s, b, reason, ctx) {
  if (['cancelled', 'closed'].includes(b.status)) return b;
  const requests = paid(b).map(x => ({ paymentId: x.id, amountCents: refundAvailable(b, x.id) })).filter(x => x.amountCents > 0);
  b.status = b.payment.status === 'success' ? 'cancelled' : 'closed'; b.cancelledAt = s.now; b.cancelReason = reason; b.confirmationPhase = null;
  if (b.change?.status === 'pending') { b.change.status = 'expired'; b.change.decidedAt = s.now; b.change.resolution = reason; recordChange(s, b, b.change); }
  for (const x of b.extensions) if (['unpaid', 'failed'].includes(x.status)) x.status = 'expired';
  if (requests.length) refundRecord(s, b, requests, reason, ctx, true);
  event(ctx, b, reason);
  return b;
}

function allocations(b, r, target, ctx) {
  const requested = r.requests.reduce((n, x) => n + x.amountCents, 0);
  if (target < 0 || target > requested) ctx.fail('协商总额不得超过申请总额');
  if (!requested) return [];
  const orderedPayments = [...paid(b)].sort((a, z) => (a.id === b.payment.id ? -1 : z.id === b.payment.id ? 1 : (a.paidAt || 0) - (z.paidAt || 0) || a.id.localeCompare(z.id)));
  const lines = r.requests.map(x => ({ paymentId: x.paymentId, amountCents: Math.floor(target * x.amountCents / requested), remainder: (target * x.amountCents) % requested, i: orderedPayments.findIndex(p => p.id === x.paymentId) }));
  let extra = target - lines.reduce((n, x) => n + x.amountCents, 0);
  const sorted = [...lines].sort((a, b) => b.remainder - a.remainder || a.i - b.i);
  for (let i = 0; i < extra; i++) sorted[i].amountCents++;
  for (const line of lines) if (line.amountCents > refundAvailable(b, line.paymentId, r.id)) ctx.fail('某笔退款超过尚可退金额');
  return lines.map(({ paymentId, amountCents }) => ({ paymentId, amountCents }));
}

function applyChange(s, b, change, ctx) {
  if (change.status !== 'pending' || change.expiresAt <= s.now) ctx.fail('变更已处理或确认期限已到');
  beforeStart(b, ctx);
  availability(s, b, change.techId, change.startAt, duration(b), ctx);
  if (change.kind === 'reschedule') {
    slot(s, b, change.startAt, change.techId, ctx, true);
    b.startAt = change.startAt; setTechnician(s, b, change.techId); change.status = 'accepted'; change.decidedAt = s.now;
    startRound(s, b, '用户确认门店改约', ctx);
  } else {
    const needsRound = b.status === 'confirmed';
    if (!needsRound && b.round.deadline <= s.now) ctx.fail('当前派单轮已到期');
    setTechnician(s, b, change.techId); change.status = 'accepted'; change.decidedAt = s.now;
    if (needsRound) startRound(s, b, '用户确认指定改派', ctx, 'store');
    if (b.status !== 'cancelled') confirm(s, b, change.techId, ctx);
  }
  change.confirmedBy = { role: 'user', id: b.userId }; recordChange(s, b, change); event(ctx, b, '用户确认变更生效');
}

function mainPayment(s, b, outcome, query, ctx) {
  if (!['success', 'failed', 'processing'].includes(outcome) || (query && outcome === 'processing')) ctx.fail('支付结果无效');
  const p = b.payment;
  if (p.status === 'success') return b;
  if (!query && p.status === 'processing') ctx.fail('支付结果未知，请先查询原笔支付');
  if (!query && (b.status !== 'unpaid' || s.now >= b.paymentDeadline)) ctx.fail('付款已截止，请重新预约');
  if (query && p.status !== 'processing' && b.status !== 'closed') ctx.fail('当前无需查询支付结果');
  p.status = outcome; p.attempts++; p.updatedAt = s.now;
  if (outcome === 'success') {
    b.firstPaidAt ??= s.now; p.paidAt = s.now;
    let conflict = false;
    try { availability(s, b, b.techId, b.startAt, duration(b), ctx); } catch { conflict = true; }
    if (conflict || (b.status === 'closed' && b.cancelReason !== '支付超时关闭')) {
      b.status = 'waiting'; cancel(s, b, conflict ? '晚到支付成功，但时段已不可用，全额退款' : '关闭后收到支付成功，全额退款', ctx);
    } else startRound(s, b, '首次支付成功', ctx);
  } else if (outcome === 'failed' && s.now >= b.paymentDeadline) cancel(s, b, '支付超时关闭', ctx);
  event(ctx, b, `模拟支付结果：${RESULT_LABEL[outcome]}`);
  return b;
}

function tick(s, ctx) {
  upgradeBookings(s);
  for (const b of s.bookings) {
    if (b.status === 'unpaid' && s.now >= b.paymentDeadline && b.payment.status !== 'processing') cancel(s, b, '支付超时关闭', ctx);
    for (const x of b.extensions) if (['unpaid', 'failed'].includes(x.status) && s.now >= x.expiresAt) { x.status = 'expired'; event(ctx, b, '加时支付超时，释放锁定'); }
    if (b.change?.status === 'pending' && s.now >= b.change.expiresAt) {
      b.change.status = 'expired'; b.change.decidedAt = s.now;
      recordChange(s, b, b.change);
      if (b.change.kind === 'reassign') cancel(s, b, '指定改派确认超时，全额退款', ctx);
      else event(ctx, b, '门店改约确认超时，保留原预约');
    }
    if (b.status === 'waiting' && s.now >= b.round.deadline) cancel(s, b, '派单超时，全额退款', ctx);
    else if (b.status === 'waiting' && b.confirmationPhase === 'tech' && s.now >= b.round.techDeadline) { b.confirmationPhase = 'store'; event(ctx, b, '技师确认超时，进入门店待分配'); }
    for (const r of b.refunds) {
      if (r.deadline && s.now >= r.deadline && r.status === 'requested') { r.status = 'escalated'; r.deadline += 2 * DAY; event(ctx, b, '售后门店处理超时，转集团介入'); }
      else if (r.kind !== 'interruption' && r.deadline && s.now >= r.deadline && ['offered', 'rejected'].includes(r.status)) {
        if (r.status === 'offered') lockRefundAcceptance(s, r, { role: 'system' }, 'confirmation-timeout');
        r.status = r.status === 'offered' ? (r.amountCents ? 'approved' : 'success') : 'rejected'; r.deadline = null;
        event(ctx, b, '售后结果确认期结束');
      } else if (r.deadline && s.now >= r.deadline && r.status === 'escalated' && !r.overdueAt) { r.overdueAt = s.now; event(ctx, b, '集团裁决已超时，继续保留客服待办'); }
    }
    for (const d of openDisputes(b)) if (d.deadline && s.now >= d.deadline && !d.overdueAt) { d.overdueAt = s.now; d.escalatedTo = 'group'; event(ctx, b, '服务争议核实超时，保留集团待办'); }
    if (b.status === 'active' && !b.stoppedAt) {
      const expectedEnd = b.startedAt + duration(b) * MIN;
      if (s.now >= expectedEnd + 15 * MIN && !b.supervision) { b.supervision = { status: 'reminded', expectedEnd, remindedAt: expectedEnd + 15 * MIN, escalationAt: expectedEnd + 25 * MIN }; event(ctx, b, '服务超时15分钟，请技师确认安全并处理后续预约'); }
      if (b.supervision?.status === 'reminded' && s.now >= b.supervision.escalationAt) {
        const h = createSafety(s, b, 'system:supervision', '服务超时提醒后10分钟未确认安全', ctx); b.supervision.status = 'escalated'; b.supervision.safetyId = h.id;
        h.createdAt = b.supervision.escalationAt; h.ackDeadline = h.createdAt + 3 * MIN; h.escalationDeadline = h.createdAt + 6 * MIN;
      }
    }
  }
  for (const h of s.safety) if (h.status === 'open' && !h.acknowledgedAt) {
    if (s.now >= h.ackDeadline && h.stage === 'pending') { h.stage = 'escalated'; h.escalatedAt = h.ackDeadline; h.notifications ??= []; h.notifications.push({ at: h.ackDeadline, channel: 'demo', target: '集团安全负责人', result: '本地升级待办已生成' }); event(ctx, h, '3分钟未接报，升级集团安全负责人'); }
    if (s.now >= h.escalationDeadline && h.stage === 'escalated') { h.stage = 'unanswered'; h.unansweredAt = h.escalationDeadline; h.emergencyNumber = '110'; event(ctx, h, '再次3分钟无人确认，标记无人响应，提示直接拨打110'); }
  }
  return s.bookings;
}

export function bookingView(s, actor) {
  actor = resolveAccountActor(s, actor);
  if (!canAccountView(actor, 'bookings')) return [];
  const labels = { unpaid: '待支付', waiting: '待确认', confirmed: '已确认', active: '进行中', interrupted: '中止待核实', done: '已完成', cancelled: '已取消', closed: '已关闭' };
  return s.bookings.filter(b => canSee(b, actor) && canAccountReadSource(s,actor,'booking',b)).map(b => {
    const t = totals(b), openHelp = activeSafety(s, b), pending = b.refunds.some(x => ['approved', 'processing'].includes(x.status));
    const fundStatus = b.refunds.some(x => x.status === 'failed') ? '退款待处理' : pending ? '退款处理中' : t.paidCents && t.refundedCents === t.paidCents ? '全额退款' : t.refundedCents > 0 ? '部分退款' : b.payment.status === 'processing' ? '支付结果待查询' : t.paidCents ? '已支付' : '未支付';
    const view = copy(b); delete view.technicianAssignmentSnapshot; delete view.technicianAssignmentSnapshots; Object.assign(view, projectBookingContact(b, actor)); view.disputes ??= []; view.changeHistory ??= []; view.assistance ??= []; for (const r of view.refunds) { ensureRefundVersion(s, r); ensureExecutions(r); }
    if (!canAccountView(actor, 'care') || actor.role === 'tech' || (actor.role === 'group' && actor.job && !['all', 'support'].includes(actor.job))) view.assistance = [];
    if (!canAccountView(actor, 'care')) view.disputes = [];
    return { ...view, ...t, netCents: t.paidCents - t.refundedCents, totalDuration: duration(b), displayStatus: openDisputes(b).length || orphanSafetyDispute(s, b) || (openHelp && !['done', 'cancelled', 'closed'].includes(b.status)) ? '客服处理中' : b.status === 'done' && b.completionKind ? '中止已处理' : labels[b.status], fundStatus, settlementBlocked: Boolean(blocked(s, b)), openSafetyCount: s.safety.filter(x => x.bookingId === b.id && x.status === 'open').length, canHelp: bookingCanHelp(s, b, actor), actualMinutes: b.startedAt ? Math.max(0, Math.min(duration(b), Math.floor(((b.stoppedAt || b.completedAt || s.now) - b.startedAt) / MIN))) : 0 };
  });
}

export function bookingCommand(s, actor, type, payload, ctx) {
  const p = payload || {};
  if (type === 'booking.tick') return tick(s, ctx);
  tick(s, ctx);
  if (type.startsWith('booking.busy-')) return busyCommand(s, actor, type, p, ctx);
  if (type === 'booking.schedule-save') {
    const techId = p.techId || actor.techId, t = s.techs.find(x => x.id === techId);
    if (!t || !(actor.role === 'group' || (actor.role === 'tech' && actor.techId === t.id) || isStore(actor, t.storeId))) ctx.fail('无权修改这位技师的排班');
    const start = String(p.start ?? ''), end = String(p.end ?? ''), breakStart = String(p.breakStart ?? ''), breakEnd = String(p.breakEnd ?? '');
    const validTime = value => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
    if (!validTime(start) || !validTime(end) || start >= end || start < '09:00' || end > '23:00') ctx.fail('工作时间须在 09:00–23:00 内，结束须晚于开始');
    if ((breakStart || breakEnd) && (!validTime(breakStart) || !validTime(breakEnd) || breakStart >= breakEnd || breakStart < start || breakEnd > end)) ctx.fail('休息时段须完整且位于工作时段内');
    const date = String(p.date || '');
    if (date) {
      const dateTime = Date.parse(`${date}T00:00:00+08:00`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(dateTime) || dateKey(dateTime) !== date || date < dateKey(s.now)) ctx.fail('请选择今天或之后的有效排班日期');
    }
    const schedule = { start, end, breakStart, breakEnd }, previous = s.schedules?.[techId] || { ...legacySchedule, dates: {} };
    const next = date ? { ...previous, dates: { ...previous.dates, [date]: schedule } } : { ...previous, ...schedule, dates: { ...previous.dates } };
    const candidate = { ...s, schedules: { ...s.schedules, [techId]: next } };
    for (const b of s.bookings) {
      if (!OPEN.has(b.status)) continue;
      if (b.techId === techId) {
        const startAt = Math.max(b.startAt, b.startedAt || 0);
        if ((!date || date === dateKey(startAt)) && scheduleError(candidate, techId, startAt, duration(b, true))) ctx.fail(`排班或休息不能与已有预约 ${b.id} 冲突`);
      }
      if (b.change?.status === 'pending' && b.change.techId === techId && (!date || date === dateKey(b.change.startAt)) && scheduleError(candidate, techId, b.change.startAt, duration(b))) ctx.fail(`排班或休息不能与待确认变更 ${b.id} 冲突`);
    }
    s.schedules ??= {}; s.schedules[techId] = next;
    next.id = `SCHEDULE-${techId}`; next.updatedAt = s.now;
    event(ctx, next, `保存${date || '常规'}排班：${start}–${end}${breakStart ? `，休息 ${breakStart}–${breakEnd}` : '，无固定休息时段'}`);
    return next;
  }
  if (type === 'booking.create') {
    knownUser(s, actor, ctx);
    const requestId = required(p.requestId, '提交标识', ctx), duplicate = s.bookings.find(x => x.userId === actor.userId && x.requestId === requestId);
    if (duplicate) return duplicate;
    const service = s.services.find(x => x.id === p.serviceId), store = s.stores.find(x => x.id === p.storeId), region = s.regions.find(x => x.id === p.regionId);
    if (!store || !lifecyclePauseSelection(s,store.id,{storeOpeningReadiness}).bookable || !service || service.active === false || !store.serviceIds.includes(service.id) || !region || distance(region, store) > (store.radiusKm ?? 20)) ctx.fail('当前片区或门店暂不支持此项目，请重新选择');
    if (!truth(p.healthConsent) || !truth(p.identityVerified)) ctx.fail('请完成实名确认和健康告知');
    if (!truth(p.adultConfirmed)) ctx.fail('请确认服务对象已满18周岁');
    const phone = required(p.phone, '联系人手机号', ctx); if (!/^1\d{10}$/.test(phone)) ctx.fail('请填写 11 位手机号');
    const mode = p.mode || 'specified', genderPreference = p.genderPreference || 'any';
    if (!['nearest', 'specified'].includes(mode) || !['any', 'male', 'female'].includes(genderPreference)) ctx.fail('预约方式或偏好无效');
    const b = { id: ctx.id('BK'), userId: actor.userId, storeId: store.id, serviceId: service.id, regionId: region.id, techId: p.techId, mode, genderPreference, startAt: timestamp(p.startAt, ctx), duration: service.duration, priceCents: 0, contactName: required(p.contactName, '联系人姓名', ctx), phone, healthConsent: true, identityVerified: true, adultConfirmed: true, status: 'unpaid', confirmationPhase: null, createdAt: s.now, paymentDeadline: s.now + 15 * MIN, firstPaidAt: null, rounds: [], round: null, change: null, userReschedules: 0, extensions: [], refunds: [], events: [], requestId, startedAt: null, completedAt: null };
    b.priceCents = price(service, b.startAt);
    b.serviceSnapshot = serviceSnapshot(service); b.rulesSnapshot = copy(s.bookingRules || DEFAULT_RULES); delete b.rulesSnapshot.history; delete b.rulesSnapshot.events;
    b.storeSnapshot = { name: store.name };
    if (mode === 'nearest') {
      const candidates = s.techs.filter(t => { try { slot(s, b, b.startAt, t.id, ctx); return true; } catch { return false; } }).map(t => { const review = technicianReviewSummary(s, t.id); return { ...t, rating: review.rating, count: review.count }; }).sort((a, z) => distance(region, a) - distance(region, z) || (z.rating || 0) - (a.rating || 0) || a.count - z.count || a.id.localeCompare(z.id));
      if (!candidates.length) ctx.fail('当前没有可用技师，请更换时段');
      if (p.techId && p.techId !== candidates[0].id) ctx.fail('就近技师已变化，请重新确认具体技师');
      b.techId = candidates[0].id;
    }
    slot(s, b, b.startAt, b.techId, ctx);
    b.techSnapshot = { name: s.techs.find(t => t.id === b.techId)?.name };
    b.payment = { id: ctx.id('BP'), amountCents: b.priceCents, status: 'unpaid', attempts: 0, refundedCents: 0 };
    captureBookingFinance(s, b, ctx);
    captureBookingHandoff(s, actor, b, p, ctx);
    s.bookings.push(b); event(ctx, b, '提交预约，时段保留 15 分钟'); return b;
  }
  if (type === 'booking.leave-request') {
    const t = s.techs.find(x => x.id === actor.techId);
    if (actor.role !== 'tech' || !t) ctx.fail('仅技师本人可以申请请假');
    const startAt = timestamp(p.startAt, ctx), endAt = timestamp(p.endAt, ctx);
    if (endAt <= startAt || endAt <= s.now) ctx.fail('请假结束时间须晚于开始时间和当前时间');
    const same = s.leaves.find(l => l.techId === t.id && l.status !== 'rejected' && l.startAt === startAt && l.endAt === endAt); if (same) return same;
    const l = { id: ctx.id('LV'), techId: t.id, storeId: t.storeId, startAt, endAt, reason: required(p.reason, '请假原因', ctx), emergency: truth(p.emergency), status: 'pending', affectedIds: [], events: [], createdAt: s.now };
    s.leaves.push(l); event(ctx, l, '提交请假申请'); return l;
  }
  if (type === 'booking.leave-review') {
    const l = s.leaves.find(x => x.id === p.leaveId); if (!l) ctx.fail('请假申请不存在'); staff(actor, l, ctx, false);
    if (l.status !== 'pending') return l;
    if (!['approve', 'reject'].includes(p.decision)) ctx.fail('审批结果无效');
    if (p.decision === 'reject') { l.status = 'rejected'; l.reviewReason = required(p.reason, '驳回原因', ctx); event(ctx, l, '请假已驳回'); return l; }
    const currentAffected = b => b.techId === l.techId && OPEN.has(b.status) && overlap(b.startAt, b.status === 'active' && s.now >= b.startedAt + duration(b, true) * MIN ? Infinity : Math.max(b.startAt, b.startedAt || 0) + duration(b, true) * MIN, l.startAt, l.endAt);
    const proposedAffected = b => OPEN.has(b.status) && b.change?.status === 'pending' && b.change.techId === l.techId && overlap(b.change.startAt, b.change.startAt + duration(b, true) * MIN, l.startAt, l.endAt);
    const affected = s.bookings.filter(b => currentAffected(b) || proposedAffected(b));
    if (!l.emergency && affected.length) ctx.fail('普通请假须先处理受影响预约');
    l.status = 'approved'; l.approvedAt = s.now; l.impactedIds = affected.map(x => x.id); l.affectedIds = [];
    for (const b of affected) {
      if (b.change?.status === 'pending' && (currentAffected(b) || proposedAffected(b))) { b.change.status = 'withdrawn'; b.change.decidedAt = s.now; b.change.resolution = `紧急请假 ${l.id}，撤回失效提案`; recordChange(s, b, b.change); event(ctx, b, '紧急请假撤回待确认提案，原安排保留；门店需重新协调'); }
      if (currentAffected(b) && b.status === 'confirmed' && !b.startedAt && !b.departedAt && !b.arrivedAt) {
        startRound(s, b, `紧急请假 ${l.id}`, ctx, 'store');
        l.affectedIds.push(b.id);
      }
    }
    event(ctx, l, '批准请假，仅符合重派条件的预约进入门店池'); return l;
  }
  if (['booking.help-close', 'booking.help-ack'].includes(type)) {
    const h = s.safety.find(x => x.id === p.safetyId); if (!h) ctx.fail('求助事件不存在'); const b = get(s, actor, h.bookingId, ctx); staff(actor, b, ctx);
    if (h.status === 'closed') return h;
    if (type === 'booking.help-ack') { if (h.acknowledgedAt) return h; h.responsibleName = required(p.responsibleName, '接报责任人', ctx); h.acknowledgedBy = actorRecord(actor); h.acknowledgedAt = s.now; h.stage = 'acknowledged'; event(ctx, h, `已接报：${h.responsibleName}`); return h; }
    if (![true, false, 'true', 'false'].includes(p.unresolvedDispute)) ctx.fail('请明确选择是否仍有未解决的服务争议');
    h.resolution = required(p.resolution, '结案说明', ctx); h.unresolvedDispute = truth(p.unresolvedDispute); h.closedBy = actorRecord(actor); h.status = 'closed'; h.closedAt = s.now; h.stage = 'closed';
    if (h.unresolvedDispute) {
      let d = safetyDispute(b, h);
      if (!d) { d = { id: ctx.id('DS'), kind: 'service', status: 'open', reason: h.resolution, safetyId: h.id, createdAt: s.now, deadline: s.now + DAY, createdBy: actorRecord(actor), events: [] }; b.disputes.push(d); }
      h.disputeId = d.id;
    }
    event(ctx, h, '安全事件结案'); event(ctx, b, '安全事件已结案，独立服务争议及退款继续处理'); return h;
  }
  const b = get(s, actor, p.id, ctx);
  switch (type) {
    case 'booking.pay': user(actor, b, ctx); return mainPayment(s, b, p.outcome, false, ctx);
    case 'booking.payment-query': if (actor.role === 'user') user(actor, b, ctx); else staff(actor, b, ctx); return mainPayment(s, b, p.outcome, true, ctx);
    case 'booking.cancel': {
      if (actor.role === 'user') user(actor, b, ctx); else staff(actor, b, ctx, false);
      if (['closed', 'cancelled'].includes(b.status)) return b;
      if (!['unpaid', 'waiting', 'confirmed'].includes(b.status) || b.startedAt || b.departedAt || b.arrivedAt) ctx.fail('已开始履约，请联系客服核实取消及退款金额');
      if (b.payment.status === 'processing') ctx.fail('支付结果未知，请先查询原笔支付再取消');
      return cancel(s, b, required(p.reason, '取消原因', ctx), ctx);
    }
    case 'booking.accept': {
      tech(actor, b, ctx); if (b.status === 'confirmed') return b;
      if (b.status !== 'waiting' || b.confirmationPhase !== 'tech' || s.now >= b.round.techDeadline) ctx.fail('已超时或已交门店分配');
      if (b.change?.status === 'pending') ctx.fail('变更等待用户确认'); confirm(s, b, b.techId, ctx); return b;
    }
    case 'booking.reject': {
      tech(actor, b, ctx); if (b.status === 'waiting' && b.confirmationPhase === 'store') return b;
      if (b.status !== 'waiting' || b.confirmationPhase !== 'tech') ctx.fail('当前不能拒绝此预约');
      b.confirmationPhase = 'store'; event(ctx, b, `技师拒绝：${required(p.reason, '拒绝原因', ctx)}`); return b;
    }
    case 'booking.assign': {
      staff(actor, b, ctx, false); beforeStart(b, ctx); const techId = required(p.techId, '技师', ctx);
      if (b.status === 'confirmed' && techId === b.techId) return b;
      if (b.change?.status === 'pending') {
        if (b.change.kind === 'reassign' && b.change.techId === techId) return b;
        ctx.fail('已有变更等待用户确认，请先处理');
      }
      availability(s, b, techId, b.startAt, duration(b), ctx);
      if (b.mode === 'specified' && techId !== b.techId) {
        b.change = { id: ctx.id('BC'), kind: 'reassign', techId, startAt: b.startAt, reason: required(p.reason, '改派原因', ctx), status: 'pending', createdAt: s.now, expiresAt: Math.min(s.now + 15 * MIN, b.status === 'waiting' ? b.round.deadline : Infinity) };
        b.change.before = arrangement(s, b); b.change.after = arrangement(s, b, { techId }); b.change.initiatedBy = actorRecord(actor); recordChange(s, b, b.change);
        event(ctx, b, '指定改派等待用户确认'); return b;
      }
      const before = arrangement(s, b);
      if (b.status === 'confirmed') startRound(s, b, '门店就近改派', ctx, 'store');
      if (b.status !== 'cancelled') { confirm(s, b, techId, ctx); if (before.techId !== techId) recordChange(s, b, { id: ctx.id('BC'), kind: 'reassign', before, after: arrangement(s, b), techId, startAt: b.startAt, reason: p.reason || '门店就近派单', initiatedBy: actorRecord(actor), confirmedBy: actorRecord(actor), createdAt: s.now, decidedAt: s.now, status: 'accepted' }); } return b;
    }
    case 'booking.reschedule': {
      user(actor, b, ctx); beforeStart(b, ctx);
      if (b.userReschedules >= 1) ctx.fail('每单最多自主改约一次');
      if (b.change?.status === 'pending') ctx.fail('请先处理待确认的门店变更');
      const startAt = timestamp(p.startAt, ctx), techId = p.techId || b.techId;
      if (startAt === b.startAt && techId === b.techId) ctx.fail('新安排与原预约相同，无需改约');
      slot(s, b, startAt, techId, ctx, true); const before = arrangement(s, b); b.startAt = startAt; setTechnician(s, b, techId); b.userReschedules++;
      recordChange(s, b, { id: ctx.id('BC'), kind: 'reschedule', before, after: arrangement(s, b), techId, startAt, reason: p.reason || '用户自主改约', initiatedBy: actorRecord(actor), confirmedBy: actorRecord(actor), createdAt: s.now, decidedAt: s.now, status: 'accepted' });
      startRound(s, b, '用户确认自主改约', ctx); return b;
    }
    case 'booking.propose-reschedule': {
      staff(actor, b, ctx, false); beforeStart(b, ctx);
      if (b.change?.status === 'pending') ctx.fail('已有变更等待用户确认');
      const startAt = timestamp(p.startAt, ctx), techId = p.techId || b.techId; slot(s, b, startAt, techId, ctx, true);
      if (startAt === b.startAt && techId === b.techId) ctx.fail('新安排与原预约相同，无需改约');
      const windowError = proposalWindowError(s, b, startAt);
      if (windowError) ctx.fail(windowError);
      b.change = { id: ctx.id('BC'), kind: 'reschedule', startAt, techId, reason: required(p.reason, '改约原因', ctx), status: 'pending', createdAt: s.now, expiresAt: s.now + 15 * MIN };
      b.change.before = arrangement(s, b); b.change.after = arrangement(s, b, { startAt, techId }); b.change.initiatedBy = actorRecord(actor); recordChange(s, b, b.change);
      event(ctx, b, '门店提出改约，等待用户确认'); return b;
    }
    case 'booking.change-answer': {
      user(actor, b, ctx); const c = b.change;
      if (!c || c.id !== p.changeId) ctx.fail('变更请求不存在或已被替换');
      if (c.status !== 'pending') { if ((c.status === 'accepted' && p.decision === 'accept') || (c.status === 'rejected' && p.decision === 'reject')) return b; ctx.fail('变更已结束'); }
      if (p.decision === 'accept') applyChange(s, b, c, ctx);
      else if (p.decision === 'reject') { c.status = 'rejected'; c.decidedAt = s.now; c.confirmedBy = actorRecord(actor); recordChange(s, b, c); if (c.kind === 'reassign') cancel(s, b, '用户拒绝指定改派，全额退款', ctx); else event(ctx, b, '用户拒绝改约，保持原预约'); }
      else ctx.fail('确认结果无效'); return b;
    }
    case 'booking.start': {
      tech(actor, b, ctx); if (b.status === 'active') return b;
      if (b.status !== 'confirmed' || s.now < b.startAt) ctx.fail('须已确认且到预约开始时间才可开始');
      if (b.change?.status === 'pending') ctx.fail('请先完成待确认变更');
      const unfinished = s.bookings.find(x => x.id !== b.id && x.techId === b.techId && x.status === 'active' && !x.stoppedAt && !x.completedAt);
      if (unfinished) ctx.fail(`上一单 ${unfinished.id} 尚未结束，请先完成或中止核实，并由门店协调后续预约`);
      availability(s, b, b.techId, s.now, duration(b), ctx, true); b.status = 'active'; b.startedAt = s.now; event(ctx, b, '技师开始预约'); return b;
    }
    case 'booking.finish': {
      tech(actor, b, ctx); if (b.status === 'done') return b;
      if (b.status !== 'active') ctx.fail('当前预约尚未开始');
      if (b.extensions.some(x => x.status === 'processing')) ctx.fail('加时支付结果未知，请先查询');
      if (!['normal', 'early'].includes(p.mode)) ctx.fail('请选择完成方式');
      if (p.mode === 'normal' && s.now - b.startedAt < duration(b) * MIN) ctx.fail(`未满预约及已付加时时长，还差 ${Math.ceil((duration(b) * MIN - (s.now - b.startedAt)) / MIN)} 分钟`);
      b.finishMode = p.mode;
      b.finishReason = p.mode === 'early' ? required(p.reason, '提前结束原因', ctx) : '正常完成'; b.status = 'done'; b.completedAt = s.now;
      for (const x of b.extensions) if (['unpaid', 'failed'].includes(x.status)) x.status = 'expired';
      event(ctx, b, b.finishReason); return b;
    }
    case 'booking.stop': {
      tech(actor, b, ctx);
      const existing = openDisputes(b).find(d => d.kind === 'interruption'); if (existing) return existing;
      if (!(b.status === 'active' || (b.status === 'confirmed' && (b.departedAt || b.arrivedAt)))) ctx.fail('仅已开始履约的预约可以中止');
      if (!['health', 'user', 'other'].includes(p.category)) ctx.fail('请选择中止原因类别');
      const reason = required(p.reason, '中止说明', ctx), stoppedAt = s.now;
      b.stoppedAt = stoppedAt; b.status = 'interrupted'; b.completionKind = 'interrupted';
      for (const x of b.extensions) if (['unpaid', 'failed'].includes(x.status)) x.status = 'expired';
      const d = { id: ctx.id('DS'), kind: 'interruption', category: p.category, reason, status: 'verifying', createdAt: s.now, stoppedAt, actualMinutes: b.startedAt ? Math.max(0, Math.min(duration(b), Math.floor((stoppedAt - b.startedAt) / MIN))) : 0, totalMinutes: duration(b), createdBy: actorRecord(actor), deadline: s.now + DAY, events: [] };
      b.disputes.push(d); event(ctx, b, `已中止服务，等待核实：${reason}`); return d;
    }
    case 'booking.dispute-review': {
      staff(actor, b, ctx); const d = b.disputes.find(x => x.id === p.disputeId); if (!d || d.kind !== 'interruption') ctx.fail('中止核实记录不存在');
      if (d.status !== 'verifying') ctx.fail('该中止记录已形成方案，不可重复裁定');
      if (b.extensions.some(x => x.status === 'processing')) ctx.fail('加时支付结果未知，请先查询后核实中止金额');
      if (!['health', 'non-user', 'user'].includes(p.responsibility)) ctx.fail('请选择核实责任');
      if (d.category === 'health' && p.responsibility === 'user') ctx.fail('身体不适须按未服务时长处理，不能判为用户原因不退');
      d.resolution = required(p.reason, '核实依据', ctx); d.responsibility = p.responsibility; d.reviewedAt = s.now; d.reviewedBy = actorRecord(actor); d.deadline = null;
      // Preserve the actual stop time. Adjudication does not pretend full duration was delivered.
      b.status = 'done'; b.completedAt = b.stoppedAt; b.finishReason = `中止核实：${d.resolution}`;
      if (p.responsibility === 'user') {
        d.status = 'resolved'; d.resolvedAt = s.now; d.actualRefundCents = 0;
        b.completionKind = 'adjudicated-user'; d.accountRestriction = { status: 'pending', reason: '用户原因中止，账户限制需按用户管理规则处理', createdAt: s.now };
      } else {
        const requests = paid(b).map(x => ({ paymentId: x.id, amountCents: refundAvailable(b, x.id) })).filter(x => x.amountCents > 0);
        const unserved = Math.max(0, d.totalMinutes - d.actualMinutes), target = Math.round(requests.reduce((n, x) => n + x.amountCents, 0) * unserved / d.totalMinutes);
        const r = refundRecord(s, b, requests, `中止服务未完成${unserved}/${d.totalMinutes}分钟：${d.resolution}`, ctx);
        r.lines = allocations(b, r, target, ctx); r.amountCents = target; r.kind = 'interruption'; r.disputeId = d.id; r.status = 'offered'; r.deadline = null; r.explicitAcceptance = true; r.executions = []; recordRefundVersion(s, r, actor, 'offer'); ensureExecutions(r);
        d.refundId = r.id; d.status = 'awaiting-user'; d.proposedRefundCents = target; b.completionKind = 'interrupted';
      }
      event(ctx, b, '中止核实已记录，保留实际服务时长与独立安全阻断'); return d;
    }
    case 'booking.dispute-close': {
      staff(actor, b, ctx); const d = b.disputes.find(x => x.id === p.disputeId); if (!d) ctx.fail('争议不存在');
      if (d.kind !== 'service' || d.refundId) ctx.fail('中止或退款争议须按核实及分笔退款结果结案');
      if (d.status === 'closed') return d;
      d.resolution = required(p.resolution, '争议处理结果', ctx); d.status = 'closed'; d.closedAt = s.now; d.closedBy = actorRecord(actor); event(ctx, b, '独立服务争议已结案'); return d;
    }
    case 'booking.safety-confirm': {
      tech(actor, b, ctx); if (!b.supervision || b.supervision.status !== 'reminded') ctx.fail('当前没有待确认的超时安全提醒');
      b.supervision.status = 'confirmed'; b.supervision.confirmedAt = s.now; event(ctx, b, '技师确认安全，仍须结束当前服务或协调后续预约'); return b.supervision;
    }
    case 'booking.extension-create': {
      if (actor.role === 'user') user(actor, b, ctx); else tech(actor, b, ctx);
      if (b.status !== 'active') ctx.fail('仅进行中的预约可以加时');
      const requestId = required(p.requestId, '加时提交标识', ctx), old = b.extensions.find(x => x.requestId === requestId); if (old) return old;
      if (b.extensions.some(x => ['unpaid', 'processing', 'failed'].includes(x.status))) ctx.fail('请先处理当前加时支付');
      if (b.extensions.filter(x => x.status === 'success').length >= 2) ctx.fail('每单最多加时两次');
      const minutes = b.serviceSnapshot?.extensionMinutes || 30;
      availability(s, b, b.techId, Math.max(b.startAt, b.startedAt), duration(b) + minutes, ctx);
      const x = { id: ctx.id('BX'), duration: minutes, amountCents: b.serviceSnapshot?.extensionCents || Math.round(b.priceCents / b.duration * minutes / 100) * 100, status: 'unpaid', attempts: 0, refundedCents: 0, createdAt: s.now, expiresAt: s.now + 5 * MIN, requestId };
      captureExtensionFinance(s, b, x, ctx);
      b.extensions.push(x); event(ctx, b, `申请加时 ${minutes} 分钟，锁定 5 分钟`); return x;
    }
    case 'booking.extension-pay':
    case 'booking.extension-query': {
      const query = type.endsWith('query'); if (actor.role === 'user') user(actor, b, ctx); else if (query) staff(actor, b, ctx); else user(actor, b, ctx);
      const x = b.extensions.find(x => x.id === p.extensionId); if (!x) ctx.fail('加时支付不存在');
      if (x.status === 'success') return x;
      if (!['success', 'failed', 'processing'].includes(p.outcome) || (query && p.outcome === 'processing')) ctx.fail('支付结果无效');
      if (!query && (x.status === 'processing' || s.now >= x.expiresAt || b.status !== 'active')) ctx.fail('加时支付已到期或结果未知，请查询原笔');
      if (query && !['processing', 'expired'].includes(x.status)) ctx.fail('当前无需查询加时支付');
      x.attempts++; x.updatedAt = s.now; x.status = p.outcome;
      if (p.outcome === 'success') {
        let conflict = b.status !== 'active';
        try { availability(s, b, b.techId, Math.max(b.startAt, b.startedAt || 0), duration(b), ctx); } catch { conflict = true; }
        if (conflict) { x.duration = 0; refundRecord(s, b, [{ paymentId: x.id, amountCents: x.amountCents }], '晚到加时付款无法生效，全额退款', ctx, true); }
        x.paidAt = s.now;
      } else if (p.outcome === 'failed' && s.now >= x.expiresAt) x.status = 'expired';
      event(ctx, b, `模拟加时支付结果：${RESULT_LABEL[p.outcome]}`); return x;
    }
    case 'booking.assistance-request': {
      user(actor, b, ctx); if (b.payment.status !== 'success') ctx.fail('请完成预约支付后提交门店协助');
      const reason = required(p.reason, '需要协助的事项', ctx), requestId = required(p.requestId, '协助提交标识', ctx);
      if (reason.length > 500) ctx.fail('协助事项最多500字');
      const old = b.assistance.find(x => x.requestId === requestId);
      if (old) { if (old.reason !== reason) ctx.fail('同一协助请求的内容已变化，请刷新后重新提交'); return old; }
      const item = { id: ctx.id('AS'), requestId, reason, status: 'open', createdAt: s.now, createdBy: actorRecord(actor), events: [] };
      b.assistance.push(item); event(ctx, item, '用户已提交门店协助'); event(ctx, b, `门店协助 ${item.id} 已提交`); return item;
    }
    case 'booking.assistance-close': {
      staff(actor, b, ctx); assertJob(actor, type);
      const item = b.assistance.find(x => x.id === p.assistanceId); if (!item) ctx.fail('门店协助记录不存在');
      if (item.status === 'closed') return item;
      const response = required(p.response, '处理回复', ctx); if (response.length > 500) ctx.fail('处理回复最多500字');
      item.response = response; item.status = 'closed'; item.closedAt = s.now; item.closedBy = actorRecord(actor);
      event(ctx, item, '门店协助已回复并结案'); event(ctx, b, `门店协助 ${item.id} 已回复`); return item;
    }
    case 'booking.help': {
      if (actor.role === 'user') user(actor, b, ctx); else tech(actor, b, ctx);
      if (!bookingCanHelp(s, b, actor)) ctx.fail('求助仅在履约开始至结束期间可用，用户可延续至结束后2小时');
      const reason = required(p.reason, '求助说明', ctx), old = s.safety.find(x => x.bookingId === b.id && x.status === 'open' && x.reason === reason && x.reporter === `${actor.role}:${actor.userId || actor.techId}`); if (old) return old;
      return createSafety(s, b, `${actor.role}:${actor.userId || actor.techId}`, reason, ctx);
    }
    case 'booking.special-aftersale': {
      if (actor.role !== 'group' || (actor.job && !['all', 'support'].includes(actor.job))) ctx.fail('仅集团客服可以特批受理');
      const requestId = required(p.requestId, '特批受理标识', ctx), reason = required(p.reason, '用户诉求与受理依据', ctx);
      let requests = p.requests;
      if (typeof requests === 'string') { try { requests = JSON.parse(requests); } catch { ctx.fail('分笔申请格式无效'); } }
      if (!Array.isArray(requests) || !requests.length) ctx.fail('请登记用户分笔退款诉求');
      const seen = new Set();
      requests = requests.map(x => {
        if (seen.has(x.paymentId)) ctx.fail('同一支付不能重复填写'); seen.add(x.paymentId);
        return { paymentId: x.paymentId, amountCents: integer(x.amountCents, '申请金额', ctx, 1) };
      }).sort((a, z) => a.paymentId.localeCompare(z.paymentId));
      const signature = JSON.stringify({ requests, reason });
      const previous = b.refunds.find(r => r.specialRequestId === requestId);
      if (previous) { if (previous.specialSignature !== signature) ctx.fail('同一特批受理标识不能用于不同内容'); return previous; }
      if (b.status !== 'done' || !Number.isFinite(b.completedAt) || s.now <= b.completedAt + 2 * DAY || s.now > b.completedAt + 30 * DAY) ctx.fail('特批受理限服务完成超过48小时且不超过30天');
      if (openDisputes(b).length || b.refunds.some(r => REFUND_RESERVED.has(r.status) || (r.status === 'rejected' && r.deadline))) ctx.fail('请先核实原未结售后或争议案件，不能重复特批受理');
      for (const line of requests) if (line.amountCents > refundAvailable(b, line.paymentId)) ctx.fail('申请超过该笔可退金额');
      const r = refundRecord(s, b, requests, reason, ctx);
      Object.assign(r, { status: 'escalated', kind: 'special', deadline: s.now + 2 * DAY, specialRequestId: requestId, specialSignature: signature, receivedBy: actorRecord(actor) });
      event(ctx, b, `集团客服特批受理 ${r.id}，待集团裁决`); return r;
    }
    case 'booking.refund-request': {
      user(actor, b, ctx); if (b.status !== 'done' || s.now > b.completedAt + 2 * DAY) ctx.fail('自助售后仅支持完成后 48 小时内，其他情形请联系客服');
      if (openDisputes(b).some(d => d.kind === 'interruption')) ctx.fail('中止服务争议尚未解决，请在原方案中确认或申请集团介入');
      if (b.refunds.some(r => ['requested', 'offered', 'escalated', 'rejected'].includes(r.status) && r.deadline)) ctx.fail('已有售后申请等待处理');
      let requests = p.requests; if (typeof requests === 'string') { try { requests = JSON.parse(requests); } catch { ctx.fail('分笔申请格式无效'); } }
      if (!Array.isArray(requests) || !requests.length) ctx.fail('请填写分笔退款金额');
      const seen = new Set(); requests = requests.map(x => {
        if (seen.has(x.paymentId)) ctx.fail('同一支付不能重复填写'); seen.add(x.paymentId);
        const amountCents = integer(x.amountCents, '退款金额', ctx, 1); if (amountCents > refundAvailable(b, x.paymentId)) ctx.fail('退款申请超过该笔尚可退金额'); return { paymentId: x.paymentId, amountCents };
      });
      return refundRecord(s, b, requests, required(p.reason, '售后原因', ctx), ctx);
    }
    case 'booking.refund-review': {
      staff(actor, b, ctx); const r = b.refunds.find(x => x.id === p.refundId); if (!r) ctx.fail('退款申请不存在');
      if (!['requested', 'escalated'].includes(r.status)) ctx.fail('该申请当前不能审核');
      if (r.status === 'escalated' && actor.role !== 'group') ctx.fail('此申请已交集团裁决');
      const reason = required(p.reason, '处理说明', ctx); if (!['approve', 'offer', 'reject'].includes(p.decision)) ctx.fail('处理结果无效');
      if (r.kind === 'interruption' && p.decision !== 'offer') ctx.fail('中止服务退款调整须重新提出方案，由用户明确确认');
      if (p.decision === 'reject') { r.status = 'rejected'; r.amountCents = 0; r.lines = []; r.deadline = actor.role === 'group' ? null : s.now + 2 * DAY; r.final = actor.role === 'group'; }
      else {
        const amount = p.amountCents === '' || p.amountCents == null ? r.requests.reduce((n, x) => n + x.amountCents, 0) : integer(p.amountCents, '协商退款金额', ctx);
        if (actor.role !== 'group' && p.decision === 'approve' && amount !== r.requests.reduce((n, x) => n + x.amountCents, 0)) ctx.fail('调整申请金额须提出协商方案，由用户确认');
        r.lines = allocations(b, r, amount, ctx); r.executions = []; r.amountCents = amount;
        r.status = p.decision === 'offer' && actor.role !== 'group' ? 'offered' : amount > 0 ? 'approved' : 'success'; r.deadline = r.status === 'offered' ? s.now + 2 * DAY : null; r.final = actor.role === 'group';
        if (r.kind === 'interruption') { r.status = 'offered'; r.deadline = null; r.final = false; const d = b.disputes.find(x => x.refundId === r.id); if (d) d.status = 'awaiting-user'; }
      }
      r.reviewReason = reason; recordRefundVersion(s, r, actor, p.decision); event(ctx, b, `售后处理：${p.decision}，${reason}`); return r;
    }
    case 'booking.refund-answer': {
      user(actor, b, ctx); const r = b.refunds.find(x => x.id === p.refundId); if (!r) ctx.fail('退款申请不存在');
      if (p.decision === 'withdraw') {
        if (r.kind === 'interruption') ctx.fail('中止退款方案不能撤销，存在争议请申请集团介入');
        if (!['requested', 'offered', 'escalated', 'rejected'].includes(r.status) || r.final) ctx.fail('退款已执行或裁决已终结，不能撤销');
        r.status = 'withdrawn'; r.deadline = null;
      } else if (p.decision === 'escalate') {
        if (!['offered', 'rejected'].includes(r.status) || r.final || (!r.deadline && !r.explicitAcceptance)) ctx.fail('当前不能申请集团介入');
        r.status = 'escalated'; r.deadline = s.now + 2 * DAY;
      } else if (p.decision === 'accept') {
        if (!Number.isSafeInteger(Number(p.version)) || Number(p.version) !== r.version || !r.version) ctx.fail('退款方案已更新或缺少版本，请刷新核对金额后重新确认');
        if (r.acceptedVersion === r.version) return r;
        if (!['offered', 'rejected'].includes(r.status) || (!r.deadline && !r.explicitAcceptance)) ctx.fail('当前没有待确认的处理结果');
        if (r.status === 'offered') r.status = r.amountCents ? 'approved' : 'success';
        r.deadline = null; lockRefundAcceptance(s, r, actor, 'user'); ensureExecutions(r);
        const d = b.disputes.find(x => x.refundId === r.id); if (d) d.status = r.status === 'success' ? 'resolved' : 'refunding'; settleDispute(s, b, r);
      } else ctx.fail('确认结果无效');
      event(ctx, b, `用户处理售后：${p.decision}`); return r;
    }
    case 'booking.refund-pay':
    case 'booking.refund-query': {
      staff(actor, b, ctx); const r = b.refunds.find(x => x.id === p.refundId); if (!r) ctx.fail('退款不存在');
      if (r.status === 'success') return r;
      const query = type.endsWith('query');
      if (!['success', 'failed', 'processing'].includes(p.outcome) || (query && p.outcome === 'processing')) ctx.fail('退款结果无效');
      if (!['approved', 'processing', 'failed'].includes(r.status)) ctx.fail('退款尚未批准或等待用户确认');
      const executions = ensureExecutions(r), target = p.paymentId ? executions.filter(x => x.paymentId === p.paymentId) : executions.filter(x => x.status !== 'success');
      if (!target.length) ctx.fail('退款支付明细不存在');
      if (target.every(x => x.status === 'success')) return r;
      for (const part of target.filter(x => x.status !== 'success')) {
        if (query ? part.status !== 'processing' : !['approved', 'failed'].includes(part.status)) ctx.fail('退款状态不允许此操作，未知结果须先查询原笔');
        if (p.outcome === 'success') { const payment = allPayments(b).find(x => x.id === part.paymentId); if (!payment || payment.refundedCents + part.amountCents > payment.amountCents) ctx.fail('退款累计金额校验失败'); payment.refundedCents += part.amountCents; part.completedAt = s.now; }
        part.status = p.outcome; part.attempts++; part.updatedAt = s.now; part.results ??= []; part.results.push({ at: s.now, outcome: p.outcome, operation: query ? 'query' : 'pay', actor: actorRecord(actor) });
      }
      r.attempts++; aggregateRefund(s, b, r);
      event(ctx, b, `模拟原路退款${p.paymentId ? ` ${p.paymentId}` : ''}结果：${RESULT_LABEL[p.outcome]}`); return r;
    }
    default: ctx.fail(`不支持的预约命令：${type}`);
  }
}
