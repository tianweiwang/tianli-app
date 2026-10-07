// Read-only operations views. Commands and resource ownership remain in booking.mjs.
import { bookingView, bookingSchedule, busyView } from './booking.mjs';

const MINUTE = 60000, DAY = 86400000;
const OPEN = new Set(['unpaid', 'waiting', 'confirmed', 'active']);
const REFUNDS = new Set(['requested', 'offered', 'approved', 'processing', 'failed', 'escalated']);
const dateKey = at => new Date(Number(at) + 8 * 3600000).toISOString().slice(0, 10);
const inputTime = at => new Date(Number(at) + 8 * 3600000).toISOString().slice(0, 16);
const canRead = actor => ['tech', 'manager', 'store'].includes(actor.role) || (actor.role === 'group' && (!actor.job || ['all', 'support'].includes(actor.job)));
const isLocal = actor => ['manager', 'store'].includes(actor.role);
const minuteOfDay = value => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
const scopeTechs = (s, actor) => (s.techs || []).filter(t => actor.role === 'group' || (actor.role === 'tech' ? t.id === actor.techId : t.storeId === actor.storeId));
const bookedDuration = b => (b.duration || 0) + (b.extensions || []).filter(x => ['success', 'unpaid', 'processing', 'failed'].includes(x.status)).reduce((n, x) => n + x.duration, 0);

function model(s, actor) {
  const bookings = bookingView(s, actor), busy = busyView(s, actor), activeBusy = busy.filter(x => x.status === 'active');
  const today = dateKey(s.now), tomorrow = dateKey(s.now + DAY);
  const paidAppointments = bookings.filter(b => !['unpaid', 'closed', 'cancelled'].includes(b.status));
  const waiting = bookings.filter(b => b.status === 'waiting' && b.confirmationPhase === 'store');
  const changes = bookings.filter(b => b.change?.status === 'pending');
  const deadline = b => Math.min(...[
    ...(b.status === 'waiting' && b.round?.deadline ? [b.round.deadline] : []),
    ...(b.status === 'waiting' && b.confirmationPhase === 'tech' && b.round?.techDeadline ? [b.round.techDeadline] : []),
    ...(b.change?.status === 'pending' && b.change.expiresAt ? [b.change.expiresAt] : []),
  ]);
  const urgent = bookings.filter(b => deadline(b) <= s.now + 10 * MINUTE);
  const aftersale = bookings.filter(b => (b.refunds || []).some(r => REFUNDS.has(r.status) || (r.status === 'rejected' && r.deadline)) || (b.disputes || []).some(x => !['closed', 'resolved'].includes(x.status)));
  const assistance = actor.role === 'tech' ? [] : bookings.filter(b => (b.assistance || []).some(x => x.status === 'open'));
  const ids = new Set(bookings.map(b => b.id));
  const safety = (s.safety || []).filter(x => ids.has(x.bookingId) && x.status !== 'closed');
  const nowMinutes = new Date(s.now + 8 * 3600000).getUTCHours() * 60 + new Date(s.now + 8 * 3600000).getUTCMinutes();
  // This is a verification queue, not availability or permission to dispatch.
  const unoccupied = scopeTechs(s, actor).filter(t => {
    const store = s.stores.find(x => x.id === t.storeId);
    if (!t.active || (t.reviewStatus && t.reviewStatus !== 'approved') || (t.validUntil && Date.parse(t.validUntil + 'T23:59:59+08:00') < s.now) || !store?.active || (store.reviewStatus && store.reviewStatus !== 'approved')) return false;
    if (!t.serviceIds.some(id => store.serviceIds.includes(id) && s.services.some(x => x.id === id && x.active !== false))) return false;
    const schedule = bookingSchedule(s, t.id, today);
    if (nowMinutes < minuteOfDay(schedule.start) || nowMinutes >= minuteOfDay(schedule.end) || (schedule.breakStart && nowMinutes >= minuteOfDay(schedule.breakStart) && nowMinutes < minuteOfDay(schedule.breakEnd))) return false;
    if (activeBusy.some(x => x.techId === t.id) || (s.leaves || []).some(x => x.techId === t.id && x.status === 'approved' && x.startAt <= s.now && x.endAt > s.now)) return false;
    return !(s.bookings || []).some(b => {
      if (!OPEN.has(b.status)) return false;
      const buffer = (s.stores.find(x => x.id === b.storeId)?.bufferMinutes ?? 30) * MINUTE;
      const minutes = bookedDuration(b) * MINUTE;
      const start = b.startAt - buffer, plannedEnd = Math.max(b.startAt, b.startedAt || 0) + minutes;
      const end = b.status === 'active' && !b.completedAt && !b.stoppedAt && s.now >= plannedEnd ? Infinity : plannedEnd + buffer;
      return (b.techId === t.id && start <= s.now && end > s.now) || (b.change?.status === 'pending' && b.change.techId === t.id && b.change.startAt - buffer <= s.now && b.change.startAt + minutes + buffer > s.now);
    });
  });
  return { bookings, busy, activeBusy, today, tomorrow, waiting, changes, urgent, aftersale, assistance, safety, unoccupied,
    todayBookings: paidAppointments.filter(b => dateKey(b.startAt) === today), tomorrowBookings: paidAppointments.filter(b => dateKey(b.startAt) === tomorrow) };
}

function helpers(actor, ui) {
  const e = ui.esc;
  const path = (section, id = '') => `/${actor.role}/${section}${id ? '/' + encodeURIComponent(id) : ''}`;
  const link = (text, target, kind = '') => ui.link(e(text), target, kind);
  const panel = (title, body) => `<section class="panel"><div class="panel-head"><h2>${e(title)}</h2></div><div class="panel-body">${body}</div></section>`;
  const note = (text, warning = false) => `<p class="notice${warning ? ' warning' : ''}">${e(text)}</p>`;
  const table = (heads, rows) => rows.length ? `<div class="table-wrap"><table><thead><tr>${heads.map(x => `<th>${e(x)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : ui.empty('暂无相关记录');
  const head = (title, subtitle) => `<header class="page-head"><div><h1>${e(title)}</h1><p>${e(subtitle)}</p></div><div class="actions">${link('经营待办', path('operations'), 'secondary')}${link('店内忙碌', path('busy'), 'secondary')}</div></header>`;
  return { e, path, link, panel, note, table, head };
}

function metrics(data, actor, ui) {
  const h = helpers(actor, ui);
  const entries = [
    ['today', '今日预约', data.todayBookings.length, '含已完成；不含取消及未支付'],
    ['tomorrow', '明日预约', data.tomorrowBookings.length, '核对人员与安排'],
    ['waiting', '门店待派单', data.waiting.length, '按本轮固定截止处理'],
    ['urgent', '临近或已过截止', data.urgent.length, '10分钟内的确认及派单'],
    ['changes', '待确认变更', data.changes.length, '原安排仍保留'],
    ['aftersale', '预约售后及争议', data.aftersale.length, '按预约去重'],
    ...(actor.role !== 'tech' ? [['assistance', '普通协助待回复', data.assistance.length, '按预约去重']] : []),
    ['safety', '未结安全事件', data.safety.length, '按事件计数'],
    ['busy', '店内忙碌', data.activeBusy.length, `${data.activeBusy.filter(x => x.overdue).length}项超过预计结束`],
    ['unoccupied', '无登记占用待核实', data.unoccupied.length, '不能直接视为可约'],
  ];
  return `<div class="metrics">${entries.map(([filter, title, count, description]) => `<div class="metric"><span>${h.e(title)}</span><strong>${h.link(String(count), h.path('operations') + '?filter=' + filter).replace('<a ', `<a aria-label="${h.e(`${title} ${count} 项，查看明细`)}" `)}</strong><small>${h.e(description)}</small></div>`).join('')}</div>`;
}

export function operationsSummary(s, actor, ui) {
  if (!canRead(actor)) return '';
  const h = helpers(actor, ui);
  return h.panel('经营待办', metrics(model(s, actor), actor, ui) + h.link('查看待办明细', h.path('operations'), 'secondary'));
}

export function operationsView(s, actor, route = [], ui) {
  if (!['busy', 'operations'].includes(route[0])) return null;
  if (!canRead(actor)) return ui.empty('当前身份没有此页面权限', '店内忙碌及预约经营待办仅向本人技师、本店负责人和集团客服开放。');
  const h = helpers(actor, ui), { e, path, link, panel, note, table, head } = h;
  const data = model(s, actor), date = at => at === Infinity ? '尚未结束' : e(ui.date(at)), techs = scopeTechs(s, actor), query = ui.query || new URLSearchParams();
  const operator = (by, record) => {
    if (!by) return '未记录操作者';
    const role = ({tech:by.id === record.techId ? '本人技师' : '技师',manager:'店长代录',store:'门店后台代录',group:'集团人员',system:'系统'})[by.role] || by.role || '未知身份';
    const name = by.role === 'tech' ? s.techs.find(t => t.id === by.id)?.name : ['manager','store'].includes(by.role) ? s.stores.find(t => t.id === by.id)?.name : '';
    return `${role}${name ? ' · ' + name : ''}${by.id ? '（' + by.id + '）' : ''}`;
  };
  const bookingLink = id => data.bookings.some(b => b.id === id) ? link(id, path('bookings', id)) : `<strong>${e(id)}</strong><small>请交门店负责人协调此候选安排</small>`;
  const conflicts = x => x.conflicts?.length ? note('店内占用与以下安排冲突，原预约和派单期限保持，请立即协调。', true) + table(['预约', '原约 / 待确认候选', '占用时段'], x.conflicts.map(c => [bookingLink(c.bookingId), e(c.kind === 'change' ? '待确认候选' : '原约安排'), `${date(c.startAt)}–${date(c.endAt)}`])) : '<p class="muted">当前未发现预约冲突；延长占用时会重新核验。</p>';
  const form = (command, payload, fields, label, id = 'new') => `<form class="management-form" data-management-form="${e('busy:' + id + ':' + command + ':' + (actor.techId || actor.storeId || 'group'))}" data-command="${e(command)}" data-payload="${e(JSON.stringify(payload))}" data-live-version="${e(payload.version ?? '')}" data-next="${e(path('busy'))}"><div class="management-grid">${fields}<label class="field wide"><span>操作原因</span><textarea name="reason" rows="3" required maxlength="300" placeholder="说明店内服务或本次调整情况"></textarea></label></div><p class="management-draft-note small muted" role="status">未保存内容会保留在当前标签页，保存成功后清除。</p><div class="actions"><button class="primary" type="submit">${e(label)}</button><button class="secondary" type="button" data-command="ui.management-discard">放弃本页草稿</button></div></form>`;
  const busyCards = records => records.length ? `<div class="card-list">${records.map(x => `<article class="list-card"><div class="row"><strong>${e(x.techName)} · ${e(x.id)}</strong>${ui.tag(x.status === 'ended' ? '已确认结束' : x.overdue ? '超时待确认' : '店内忙碌', x.overdue ? 'warning' : '')}</div><p class="small muted">${e(x.storeName)} · v${e(x.version)}</p><p>实际开始：${date(x.startAt)}<br>预计结束：${date(x.endAt)}${x.endedAt ? `<br>确认结束：${date(x.endedAt)}` : ''}</p>${x.status === 'active' ? (x.overdue ? note('已超过预计结束时间，仍保留占用。请联系本人核实后延长或确认结束。', true) : '') + conflicts(x) : ''}${x.history?.length ? `<details class="action-details"><summary>操作记录</summary><ol class="timeline">${[...x.history].reverse().map(v => `<li><span>${e(({create:'登记忙碌',extend:'延长占用',end:'确认结束'})[v.action] || v.action)} · ${date(v.at)}</span><p class="small muted">操作者：${e(operator(v.by, x))}</p><p>${e(v.reason)}</p></li>`).join('')}</ol></details>` : ''}${x.status === 'active' && x.canManage && actor.role !== 'group' ? `<details class="action-details"><summary>延长占用</summary>${form('booking.busy-extend', {id:x.id,version:x.version}, ui.field('新的预计结束时间', 'endAt', inputTime(Math.max(x.endAt, s.now) + 30 * MINUTE), 'datetime-local', 'required'), '保存延长', x.id)}</details><details class="action-details"><summary>确认店内服务已结束</summary>${note('核实实际结束后再提交；系统记录当前业务时间并释放占用。')}${form('booking.busy-end', {id:x.id,version:x.version}, '', '确认结束', x.id)}</details>` : ''}</article>`).join('')}</div>` : ui.empty('暂无店内忙碌记录');
  if (route[0] === 'busy') {
    const selectable = techs.filter(t => !data.activeBusy.some(x => x.techId === t.id));
    const create = actor.role !== 'group' && selectable.length ? panel('登记店内忙碌', note('记录已经开始的店内服务，不替代未来排班。已有预约不会被取消、改派或延长截止。预计结束到点仍须核实并确认结束。') + form('booking.busy-create', {requestId:`busy-${actor.role}-${actor.role === 'tech' ? actor.techId : actor.storeId}-${s.seq}`}, ui.select('技师', 'techId', selectable.map(t => ({value:t.id,label:t.name})), selectable[0]?.id) + ui.field('实际开始时间', 'startAt', inputTime(s.now), 'datetime-local', 'required') + ui.field('预计结束时间', 'endAt', inputTime(s.now + 60 * MINUTE), 'datetime-local', 'required'), '登记忙碌')) : actor.role === 'group' ? note('集团客服只读追踪并联系原服务门店协调，忙碌事实由本人或本店负责人登记。') : note('当前人员均已有未结束占用，或没有本店技师。请先核对下方记录。');
    return head('店内忙碌', actor.role === 'tech' ? '本人店内服务占用与预约共用人员资源。' : '本店登记，集团追踪；占用事实与预约处理分别留痕。') + create + panel('未结束占用', busyCards(data.activeBusy)) + panel('已确认结束', busyCards(data.busy.filter(x => x.status === 'ended')));
  }
  const filter = query.get('filter') || 'today';
  const collections = {today:data.todayBookings,tomorrow:data.tomorrowBookings,waiting:data.waiting,urgent:data.urgent,changes:data.changes,aftersale:data.aftersale,assistance:data.assistance,all:data.bookings};
  const names = {today:'今日预约',tomorrow:'明日预约',waiting:'门店待派单',urgent:'临近或已过截止',changes:'待确认变更',aftersale:'预约售后及争议',assistance:'普通协助待回复',all:'全部预约与收付款明细',safety:'未结安全事件',busy:'店内忙碌',unoccupied:'无登记占用待核实'};
  const appointmentRows = records => table(['预约 / 门店', '项目 / 技师 / 时间', '状态与待办', '截止 / 变更', '操作'], records.map(b => {
    const notices = [b.displayStatus, ...(b.refunds || []).some(r => REFUNDS.has(r.status)) ? ['退款或售后待处理'] : [], ...(b.assistance || []).some(a => a.status === 'open') ? ['普通协助待回复'] : []];
    const timing = [b.status === 'waiting' && b.round?.deadline ? `派单截止：${ui.date(b.round.deadline)}` : '', b.status === 'waiting' && b.confirmationPhase === 'tech' && b.round?.techDeadline ? `技师确认：${ui.date(b.round.techDeadline)}` : ''].filter(Boolean).map(t => `<p>${e(t)}</p>`).join('') + (b.change?.status === 'pending' ? `<p>原约：${date(b.startAt)}<br>拟约：${date(b.change.startAt)}<br>用户确认截止：${date(b.change.expiresAt)}</p>` : '');
    return [`<strong>${e(b.id)}</strong><small>${e(b.storeSnapshot?.name || s.stores.find(x => x.id === b.storeId)?.name || b.storeId)}</small>`, `${e(b.serviceSnapshot?.name || s.services.find(x => x.id === b.serviceId)?.name || b.serviceId)}<small>${e(b.techSnapshot?.name || s.techs.find(x => x.id === b.techId)?.name || '待安排')} · ${date(b.startAt)}</small>`, notices.map(t => `<p>${e(t)}</p>`).join(''), timing || '—', link('查看预约', path('bookings', b.id))];
  }));
  let list;
  if (filter === 'safety') list = table(['事件', '关联预约', '当前状态', '责任人 / 接报截止', '操作'], data.safety.map(x => [e(x.id),bookingLink(x.bookingId),e(({pending:'待接报',acknowledged:'已接报',escalated:'已升级集团',unanswered:'升级后仍未响应'})[x.stage] || '处理中'),`${e(x.responsibleName || '待接报确认')}<small>${date(x.ackDeadline)}</small>`,link('查看安全记录',path('safety'))]));
  else if (filter === 'busy') list = busyCards(data.activeBusy);
  else if (filter === 'unoccupied') list = note('只表示当前排班内没有登记中的店内占用、预约占位或请假。请核实资料完整性、人员位置和实际情况；派单仍由原预约页面校验项目、时段、覆盖和其他条件。') + table(['技师', '门店', '资料记录', '下一步'], data.unoccupied.map(t => [e(t.name),e(s.stores.find(x => x.id === t.storeId)?.name || t.storeId),t.certificate && t.insurance && t.validUntil ? '已有证书及保单记录，仍须核实实际情况' : '证书或保单记录待核实',(actor.role === 'group' ? '<p class="small muted">联系原服务门店核对排班及实际在岗情况。</p>' : link('核对排班',path('schedule')) + ' · ') + link('核对店内忙碌',path('busy'))]));
  else list = Object.hasOwn(collections, filter) && !(filter === 'assistance' && actor.role === 'tech') ? appointmentRows(collections[filter]) : ui.empty('没有此待办分类');
  let finance = '';
  if (isLocal(actor) || (actor.role === 'group' && (!actor.job || actor.job === 'all'))) {
    const paid = data.bookings.reduce((n,b) => n + b.paidCents,0), refunded = data.bookings.reduce((n,b) => n + b.refundedCents,0);
    finance = panel('预约历史累计收付款', `<div class="kv-grid"><div class="kv"><span>累计实收</span><strong>${ui.money(paid)}</strong></div><div class="kv"><span>成功实退</span><strong>${ui.money(refunded)}</strong></div><div class="kv"><span>收款净额</span><strong>${ui.money(paid - refunded)}</strong></div></div><p class="small muted">当前权限范围内的全部历史主单及加时成功收退款；与上方今日、明日待办分别统计。服务分账、门店收益及技师提成请查看服务财务与提成账本，不能用本页收款净额代替。</p>${link('查看来源预约',path('operations')+'?filter=all','secondary')}`);
  }
  return head('经营待办', `业务日期 ${data.today}；点击数字查看具体记录。集团兜底处理不改变已付款预约的服务门店。`) + metrics(data, actor, ui) + panel(names[filter] || '待办明细', list) + finance;
}
