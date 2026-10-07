// Store walk-in work is an observed fact. Recording it never rewrites an
// existing appointment; new arrangements must respect its occupied interval.
import { actorAccountFields } from './staff-accounts.mjs';
const MIN = 60000;
const OPEN = new Set(['unpaid', 'waiting', 'confirmed', 'active']);
const overlap = (a, b, c, d) => a < d && b > c;
const copy = value => structuredClone(value);
const storeActor = (actor, storeId) => ['manager', 'store'].includes(actor.role) && actor.storeId === storeId;
const canManage = (actor, row) => (actor.role === 'tech' && actor.techId === row.techId) || storeActor(actor, row.storeId);
const canSee = (actor, row) => canManage(actor, row) || (actor.role === 'group' && (!actor.job || ['all', 'support'].includes(actor.job)));
const actorRecord = actor => ({ role: actor.role, job: actor.job || null, id: actor.role === 'tech' ? actor.techId : actor.storeId, ...actorAccountFields(actor) });
const timestamp = (value, ctx) => {
  const result = typeof value === 'number' || /^\d{13}$/.test(String(value)) ? Number(value) : Date.parse(/(?:Z|[+-]\d\d:\d\d)$/.test(String(value)) ? value : `${value}+08:00`);
  if (!Number.isSafeInteger(result)) ctx.fail('日期时间无效');
  return result;
};
const text = (value, label, ctx) => { const result = String(value ?? '').trim(); if (!result || result.length > 300) ctx.fail(`请填写${label}（最多300字）`); return result; };
const minutes = booking => booking.duration + (booking.extensions || []).filter(x => ['success', 'unpaid', 'processing', 'failed'].includes(x.status)).reduce((total, x) => total + x.duration, 0);
const span = (s, row) => row.status === 'active' && s.now >= row.endAt ? Infinity : row.endAt;
const snapshot = row => ({ startAt: row.startAt, endAt: row.endAt, status: row.status, endedAt: row.endedAt });

export function upgradeBusy(s) { s.busyRecords ??= []; return s; }

export function busyAvailabilityError(s, techId, startAt, endAt, buffer = 0) {
  const row = (s.busyRecords || []).find(x => x.techId === techId && x.status === 'active' && overlap(startAt - buffer, endAt + buffer, x.startAt - buffer, span(s, x) + buffer));
  if (!row) return '';
  return s.now >= row.endAt ? '店内忙碌已超过预计结束时间，须先确认结束或由门店协调' : '该时段技师有店内忙碌记录，请重新选择或由门店协调';
}

function conflicts(s, row) {
  if (row.status !== 'active') return [];
  const buffer = (s.stores.find(x => x.id === row.storeId)?.bufferMinutes ?? 30) * MIN, result = [];
  const add = (booking, kind, startAt, endAt, status) => {
    if (overlap(row.startAt - buffer, span(s, row) + buffer, startAt - buffer, endAt + buffer)) result.push({ bookingId: booking.id, kind, startAt, endAt, status });
  };
  for (const booking of s.bookings || []) {
    if (!OPEN.has(booking.status)) continue;
    if (booking.techId === row.techId) {
      const finish = Math.max(booking.startAt, booking.startedAt || 0) + minutes(booking) * MIN;
      add(booking, 'booking', booking.startAt, booking.status === 'active' && !booking.completedAt && !booking.stoppedAt && s.now >= finish ? Infinity : finish, booking.status);
    }
    if (booking.change?.status === 'pending' && booking.change.techId === row.techId) add(booking, 'change', booking.change.startAt, booking.change.startAt + minutes(booking) * MIN, booking.change.status);
  }
  return result;
}

export function busyView(s, actor) {
  return (s.busyRecords || []).filter(row => canSee(actor, row)).map(row => {
    const matching = conflicts(s, row);
    return { ...copy(row), techName: s.techs.find(x => x.id === row.techId)?.name || row.techId, storeName: s.stores.find(x => x.id === row.storeId)?.name || row.storeId, overdue: row.status === 'active' && s.now >= row.endAt, conflicts: matching, conflictingBookingIds: [...new Set(matching.map(x => x.bookingId))], canManage: canManage(actor, row) };
  });
}

function record(s, actor, row, action, before, reason, ctx) {
  row.history.push({ action, at: s.now, by: actorRecord(actor), before, after: snapshot(row), reason, conflictingBookingIds: [...new Set(conflicts(s, row).map(x => x.bookingId))] });
  row.updatedAt = s.now;
  const label = { create: '登记店内忙碌', extend: '延长店内忙碌', end: '确认店内忙碌结束' }[action];
  ctx.log(row, `${label}：${reason}${row.history.at(-1).conflictingBookingIds.length ? '；与已有预约或待确认变更冲突，门店须协调' : ''}`);
  return row;
}

export function busyCommand(s, actor, type, p, ctx) {
  upgradeBusy(s);
  if (type === 'booking.busy-create') {
    const techId = p.techId || actor.techId, technician = s.techs.find(x => x.id === techId);
    if (!technician || !canManage(actor, { techId, storeId: technician.storeId })) ctx.fail('仅技师本人或本店店长可以登记店内忙碌');
    const requestId = text(p.requestId, '登记标识', ctx), reason = text(p.reason, '忙碌原因', ctx), startAt = timestamp(p.startAt, ctx), endAt = timestamp(p.endAt, ctx);
    const by = actorRecord(actor), duplicate = s.busyRecords.find(x => x.requestId === requestId && x.createdBy.role === by.role && x.createdBy.id === by.id && (x.createdBy.accountId || null) === (by.accountId || null));
    if (duplicate) {
      const original = duplicate.history[0].after;
      if (duplicate.techId !== techId || original.startAt !== startAt || original.endAt !== endAt || duplicate.history[0].reason !== reason) ctx.fail('同一登记请求的内容已变化，请重新提交');
      return duplicate;
    }
    if (startAt > s.now) ctx.fail('请填写实际开始时间，不能提前登记尚未发生的忙碌');
    if (endAt <= startAt) ctx.fail('预计结束时间须晚于实际开始时间');
    if (s.busyRecords.some(x => x.techId === techId && x.status === 'active')) ctx.fail('这位技师仍有未结束的店内忙碌，请延长或确认结束原记录');
    const row = { id: ctx.id('BUSY'), techId, storeId: technician.storeId, startAt, endAt, reason, requestId, status: 'active', endedAt: null, version: 1, createdAt: s.now, createdBy: by, history: [], events: [] };
    s.busyRecords.push(row);
    return record(s, actor, row, 'create', null, reason, ctx);
  }
  if (!['booking.busy-extend', 'booking.busy-end'].includes(type)) ctx.fail('不支持的店内忙碌操作');
  const row = s.busyRecords.find(x => x.id === p.id);
  if (!row || !canManage(actor, row)) ctx.fail('店内忙碌记录不存在或无权处理');
  const version = Number(p.version);
  if (!Number.isSafeInteger(version) || version !== row.version) ctx.fail('店内忙碌记录已更新，请刷新后重试');
  if (row.status !== 'active') ctx.fail('这条店内忙碌已结束，不能继续修改');
  const reason = text(p.reason, type === 'booking.busy-end' ? '结束说明' : '延长原因', ctx), before = snapshot(row);
  if (type === 'booking.busy-extend') {
    const endAt = timestamp(p.endAt, ctx);
    if (endAt <= row.endAt || endAt <= s.now) ctx.fail('延长后的预计结束须晚于原预计结束和当前时间');
    row.endAt = endAt;
  } else { row.status = 'ended'; row.endedAt = s.now; }
  row.version++;
  return record(s, actor, row, type === 'booking.busy-end' ? 'end' : 'extend', before, reason, ctx);
}
