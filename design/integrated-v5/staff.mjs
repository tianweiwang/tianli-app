import { workTaskUiView } from './work-ui.mjs';
import { workEscalationUiView } from './work-escalation-ui.mjs';
import { reportsUiView } from './reports-ui.mjs';
import { commerceInvoiceView, goodsInvoicePanel } from './commerce-invoice-ui.mjs';
import { fulfilmentUiView, fulfilmentBookingPanel } from './fulfilment-ui.mjs';
import { goodsBillSettlementPanel, goodsRecoverySettlementPanel } from './goods-settlement-ui.mjs';
import { sensitiveAccessView } from './sensitive-access.mjs';
import { resolveAccountActor, canAccountView, canAccountReadSource, assertAccountCommand } from './staff-accounts.mjs';
import { accountUiView } from './accounts-ui.mjs';
import { privacyUiView } from './privacy-ui.mjs';
import { servicePromotionUi } from './service-promotion-ui.mjs';
// Five-role demo views: rendering is read-only; every action is validated again by engine.mjs.
import { bookingView, bookingOptions, bookingSchedule, bookingCanHelp } from './booking.mjs';
import { goodsSummary, availableStock } from './engine.mjs';
import { goodsOrderExtras, goodsCaseExtras } from './goods-exceptions-ui.mjs';
import { goodsShippingBlocked } from './goods-exceptions.mjs';
import { goodsLogisticsPolicyView } from './goods-logistics-policy-ui.mjs';
import { closurePanels } from './closure-ui.mjs';
import { invoiceView, invoiceBookingPanel } from './invoice-ui.mjs';
import { financeView, financeBookingPanel } from './finance-ui.mjs';
import { renderServiceFinanceExtras } from './service-finance-extras-ui.mjs';
import { reviewUiView, reviewBookingPanel } from './review-ui.mjs';
import { careView, careBookingPanel, careSummary } from './care-ui.mjs';
import { qualificationUiView } from './qualification-ui.mjs';
import { technicianPenaltyUiView } from './technician-penalties-ui.mjs';
import { qualityPolicyUiView } from './quality-policy-ui.mjs';
import { handoffUiView, handoffBookingPanel } from './service-handoff-ui.mjs';
import { careBlocksBooking } from './service-care.mjs';
import { managementView } from './management-ui.mjs';
import { operationsView, operationsSummary } from './operations-ui.mjs';
import { canManageView, assertJob, JOBS } from './management.mjs';
const labels = {
  unpaid: '待支付', paid: '待发货', shipped: '待收货', received: '已收货', closed: '已关闭', cancelled: '已取消', done: '已完成',
  waiting: '待确认', assigned: '已确认', confirmed: '已确认', active: '进行中', interrupted: '服务中止待处理', servicing: '进行中', completed: '已完成',
  pending: '待处理', approved: '已同意', rejected: '已驳回', processing: '处理中', success: '成功', failed: '失败待处理',
  requested: '待受理', awaiting_return: '待用户寄回', returning: '退货运输中', returned: '待验收', ready: '待执行',
  refunding: '退款中', refunded: '退款成功', refund_ready: '待退款', refund_failed: '退款失败', disputed: '差异待处理', review: '待核对', payable: '待付款', adjusted: '已调整，待重新出账',
  open: '待接报', handling: '处理中', escalated: '集团介入', resolved: '已结案', submitted: '待审批',
  awaiting_review: '待受理', awaiting_inspection: '待验收', awaiting_refund: '待退款', confirmed_bill: '已核对',
  offered: '待用户确认方案', withdrawn: '已撤销', expired: '已过期',
  inspection_disputed: '验收有分歧，待用户处理', inspection_review: '验收申诉待客服复核', awaiting_return_disposition: '客服已同意，待仓储处置', awaiting_return_to_customer: '拒退货物待返还', return_to_customer_shipping: '货物返还运输中',
  partial_received: '部分实收，待客服协商', partial_confirmation: '部分验货方案待用户确认',
};

export function staffView(s, actor, route = [], ui) {
  try { actor = resolveAccountActor(s, actor); } catch (error) { return ui.empty('工作会话已失效', error.message); }
  if (!canAccountView(actor, route[0])) return ui.empty('当前工作授权无权查看此页面');
  const account = accountUiView(s, actor, route, ui); if (account !== null) return account;
  const privacy = privacyUiView(s, actor, route, ui); if (privacy !== null) return privacy;
  if (!canManageView(actor, route[0])) return ui.empty('当前岗位无权查看此页面');
  const canCommand = command => { try { assertAccountCommand(actor, command); assertJob(actor, command); return true; } catch { return false; } };
  if(route[0]==='service-promotion') return servicePromotionUi(s,route,actor,ui,{canCommand});
  if (route[0] === 'goods-logistics') return goodsLogisticsPolicyView(s,actor,ui,{canCommand});
  const work = workTaskUiView(s, actor, route, ui); if (work !== null) return work;
  const escalations = workEscalationUiView(s,actor,route,ui); if(escalations !== null) return escalations;
  const handoff = handoffUiView(s, actor, route, ui); if (handoff !== null) return handoff;
  const qualification = qualificationUiView(s, actor, route, ui); if (qualification !== null) return qualification;
  const penalty = technicianPenaltyUiView(s,actor,route,ui); if(penalty!==null)return penalty;
  const qualityPolicy = qualityPolicyUiView(s,actor,route,ui); if(qualityPolicy!==null)return qualityPolicy;
  const care = careView(s, actor, route, ui); if (care !== null) return care;
  const reviews = reviewUiView(s, actor, route, ui); if (reviews !== null) return reviews;
  if (route[0] === 'service-finance' && route[1] === 'extras') return renderServiceFinanceExtras(s,actor,route[2]||'evidence',route[3]||'');
  const finance = financeView(s, actor, route, ui); if (finance !== null) return (canCommand('service-extra.policy-publish') || canCommand('service-extra.evidence-submit') ? `<div class="actions">${ui.link('历史依据、退款补足与追收',`/${actor.role}/service-finance/extras/shortages`,'secondary')}</div>` : '') + finance;
  const invoices = invoiceView(s, route, actor, ui); if (invoices !== null) return invoices;
  const commerceInvoices = commerceInvoiceView(s, route, actor, ui); if (commerceInvoices !== null) return commerceInvoices;
  const fulfilment = fulfilmentUiView(s,actor,route,ui); if(fulfilment!==null) return fulfilment;
  const operations = operationsView(s, actor, route, ui); if (operations !== null) return operations;
  if (route[0] === 'reports') return reportsUiView(s, actor, ui);
  const managed = managementView(s, actor, route, ui); if (managed !== null) return managed;
  if (actor.role === 'group' && actor.job && actor.job !== 'all' && ['dashboard', 'home'].includes(route[0])) return `<header class="page-head"><div><h1>${ui.esc(JOBS[actor.job])}工作台</h1><p>按左侧菜单处理当前岗位业务；操作权限会再次校验。</p></div></header><section class="panel"><div class="menu-list">${[['tasks','统一待办'],['qualifications','服务准入'],['catalog','商品管理'],['inventory','库存管理'],['goods','商品订单'],['returns','商品售后'],['bookings','预约订单'],['care','投诉与回访'],['reviews','评价与申诉'],['service-finance','服务财务'],['bills','商品佣金结算'],['invoices','服务发票']].filter(([r])=>canManageView(actor,r)).map(([r,n])=>ui.link(n,'/group/'+r)).join('')}</div></section>` + careSummary(s, actor, ui);
  const { esc: e, money: m, date: d, button: b, link: l, field: f, select: sel, tag: rawTag, empty } = ui;
  const tag = (text, tone = '') => rawTag(text, ({ good: 'success', bad: 'danger', warn: 'warning' })[tone] || tone);
  const role = actor.role;
  if (!['tech', 'manager', 'store', 'group'].includes(role)) return empty('暂无查看权限');
  const group = role === 'group';
  const local = role === 'manager' || role === 'store';
  const mobile = role === 'tech' || role === 'manager';
  const title = (text, sub = '', tools = '') => `<header class="page-head"><div><h1>${e(text)}</h1>${sub ? `<p>${e(sub)}</p>` : ''}</div>${tools ? `<div class="actions">${tools}</div>` : ''}</header>`;
  const panel = (text, body, extra = '') => `<section class="panel"><div class="panel-head"><h2>${e(text)}</h2>${extra}</div><div class="panel-body">${body}</div></section>`;
  const note = (text, tone = '') => `<div class="notice ${tone === 'warn' ? 'warning' : tone}">${e(text)}</div>`;
  const badge = value => tag(labels[value] || value || '—', /failed|rejected|disputed|escalated/.test(value || '') ? 'bad' : /success|completed|received|resolved/.test(value || '') ? 'good' : '');
  const billBadge = value => tag(({ review: '待门店核对', disputed: '差异待处理', confirmed: '待付款', processing: '付款中', failed: '付款失败', paid: '已付', adjusted: '调整后待重核' })[value] || value, value === 'paid' ? 'good' : ['failed', 'disputed'].includes(value) ? 'bad' : '');
  const path = (name, id) => `/${role}/${name}${id ? `/${encodeURIComponent(id)}` : ''}`;
  const nav = (text, name, id, kind = '') => l(text, path(name, id), kind === 'btn' ? 'secondary' : kind.replace(/\bbtn\s*/g, ''));
  const form = (command, payload, body, label, kind = 'primary') => `<form data-command="${e(command)}" data-payload='${e(JSON.stringify(payload))}' class="stack"><div class="form-grid">${body}</div><div class="actions"><button type="submit" class="btn ${kind}">${e(label)}</button></div></form>`;
  const rows = (heads, data) => data.length ? `<div class="table-wrap"><table><thead><tr>${heads.map(x => `<th>${e(x)}</th>`).join('')}</tr></thead><tbody>${data.map(row => `<tr>${row.map(cell => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : empty('暂无相关记录', '业务创建后会同步显示在这里。');
  const kv = (label, value) => `<div class="kv"><span>${e(label)}</span><strong>${value}</strong></div>`;
  const details = (summary, body) => `<details class="action-details"><summary>${e(summary)}</summary><div class="stack">${body}</div></details>`;
  const lookup = (arr, id) => arr?.find(x => x.id === id);
  const storeName = id => lookup(s.stores, id)?.name || id || '集团自然销售';
  const bookingStore = o => o.storeSnapshot?.name || storeName(o.storeId);
  const bookingTech = o => o.techSnapshot?.name || techName(o.techId);
  const sourceStore = o => o.source?.storeName || storeName(o.source?.storeId);
  const actualPaid = o => o.payment?.status === 'success' ? o.paidCents : 0;
  const techName = id => lookup(s.techs, id)?.name || '待安排';
  const userName = id => lookup(s.users, id)?.name || '用户';
  const serviceName = id => lookup(s.services, id)?.name || '预约项目';
  const safeId = id => e(id || '—');
  const bookings = bookingView(s, actor);
  const goods = (s.goods || []).filter(o => (group || (local && o.source?.storeId === actor.storeId)) && canAccountReadSource(s,actor,'goods',o));
  const bills = (s.bills || []).filter(o => (group || (local && o.storeId === actor.storeId)) && canAccountReadSource(s,actor,'bill',o));
  const leaves = (s.leaves || []).filter(o => group || (local ? o.storeId === actor.storeId : o.techId === actor.techId));
  const recoveries = (s.recoveries || []).filter(o => (group || (local && o.storeId === actor.storeId)) && canAccountReadSource(s,actor,'goods-recovery',o));
  const sum = (arr, get) => arr.reduce((acc, item) => acc + Number(get(item) || 0), 0);
  const refunds = o => goodsSummary(s, o).refundedCents;
  const commission = o => goodsSummary(s, o).commissionCents;
  const pendingCase = o => (o.cases || []).some(c => !['rejected', 'closed', 'refunded', 'completed', 'resolved', 'done'].includes(c.status));
  const roleLabel = value => ({ user: '用户', tech: '技师', manager: '店长', store: '门店后台', group: '集团后台', system: '系统' })[value] || value;
  const events = o => (o.events || []).length ? `<ol class="timeline">${[...o.events].reverse().map(v => `<li><span class="small muted">${e(d(v.at || v.time))}${v.actor ? ` · ${e(roleLabel(typeof v.actor === 'string' ? v.actor : v.actor.role || ''))}` : ''}</span><p>${e(v.text || v.message || v.action || '')}</p></li>`).join('')}</ol>` : `<p class="muted">暂无操作记录</p>`;
  const missing = text => title(text) + empty('记录不存在或不在当前权限范围内', '请返回列表，或切换到有权处理该业务的身份。') + nav('返回工作台', 'home', '', 'btn');
  const metrics = items => `<div class="metrics">${items.map(([name, value, sub]) => `<div class="metric"><span>${e(name)}</span><strong>${e(value)}</strong><small>${e(sub || '')}</small></div>`).join('')}</div>`;
  const defaultCarrier = [{ value: '顺丰速运', label: '顺丰速运' }, { value: '中通快递', label: '中通快递' }, { value: '圆通速递', label: '圆通速递' }];
  const outcome = (name = 'outcome', includeProcessing = true) => sel('模拟渠道结果', name, [...(includeProcessing ? [{ value: 'processing', label: '处理中（需查询）' }] : []), { value: 'success', label: '成功' }, { value: 'failed', label: '失败，可原笔重试' }], includeProcessing ? 'processing' : 'success');
  const q = ui.query || new URLSearchParams();
  const dateOnly = time => new Date(Number(time) + 8 * 3600000).toISOString().slice(0, 10);
  const scheduleText = work => `${work.start}–${work.end} · ${work.breakStart && work.breakEnd ? `休息 ${work.breakStart}–${work.breakEnd}` : '无固定休息'}`;
  const entry = (label, detail, target) => `<a class="staff-entry" href="#${e(target)}"><span><strong>${e(label)}</strong><small>${e(detail)}</small></span><span aria-hidden="true">›</span></a>`;
  const assistanceCount = o => (local || (group && canCommand('booking.assistance-close'))) ? (o.assistance || []).filter(x => x.status === 'open').length : 0;
  const inStatus = (o, status) => !status || (status === 'ongoing' ? ['confirmed', 'active'].includes(o.status) : status === 'assistance' ? assistanceCount(o) > 0 : status === 'care' ? (careBlocksBooking(s, o) || (s.safety || []).some(x => x.bookingId === o.id && x.status !== 'closed') || (o.disputes || []).some(x => !['resolved','closed'].includes(x.status))) : status === 'aftersale' ? (o.refunds || []).some(x => !['rejected', 'success', 'closed', 'withdrawn'].includes(x.status)) : o.status === status);
  function bookingList() {
    const status = q.get('status') || '', keyword = (q.get('q') || '').trim();
    const filtered = bookings.filter(o => inStatus(o, status) && (!keyword || [o.id, userName(o.userId), o.contactName, bookingTech(o)].some(v => String(v || '').toLocaleLowerCase().includes(keyword.toLocaleLowerCase()))));
    const states = [['', '全部'], ['waiting', '待确认'], ['confirmed', '已确认'], ['active', '进行中'], ['interrupted', '中止待处理'], ['done', '已完成'], ...(local || (group && canCommand('booking.assistance-close')) ? [['assistance', '门店协助待回复']] : []), ['care', '客服处理中'], ['aftersale', '售后处理中'], ['unpaid', '待支付'], ['cancelled', '已取消'], ['closed', '已关闭']];
    const tabs = (mobile ? [['', '全部'], ['waiting', '待确认'], ['ongoing', '进行中'], ['done', '已完成']] : [['', '全部'], ['waiting', '待安排'], ['confirmed', '已确认'], ['active', '进行中'], ['interrupted', '中止待处理'], ['done', '已完成']]).map(([value, label]) => l(`${label} ${bookings.filter(o => inStatus(o, value)).length}`, path('bookings') + '?' + new URLSearchParams({ status: value, q: keyword }), status === value ? 'active' : '')).join('');
    return title(group && actor.job === 'finance' ? '预约退款待办' : role === 'tech' ? '我的预约' : '预约与安排', '按预约状态查找；打开详情继续处理同一笔预约。') + `<nav class="filter-tabs staff-state-tabs" aria-label="预约状态">${tabs}</nav>` + panel('查找预约', form('ui.filter', { path: path('bookings') }, sel('预约状态', 'status', [...states, ['ongoing', '已确认与进行中']].map(([value, label]) => ({ value, label })), status) + f('预约号 / 用户 / 技师', 'q', keyword, 'search', 'placeholder="输入预约号、用户或技师姓名"'), '查询', 'secondary') + `<p class="small muted">找到 ${filtered.length} 笔预约${keyword ? `，关键词：${e(keyword)}` : ''}。</p>`) + panel('预约列表', bookingListBody([...filtered].reverse()));
  }

  function home() {
    const waiting = bookings.filter(o => o.status === 'waiting');
    const urgent = goods.filter(o => o.payment?.status === 'success' && o.status === 'paid');
    const pendingBills = bills.filter(o => !['paid', 'success', 'closed'].includes(o.status));
    let html = title(group ? '集团工作台' : role === 'tech' ? '我的预约' : `${storeName(actor.storeId)}工作台`, '业务记录由各端共同处理，操作后自动同步。');
    html += metrics(role === 'tech' ? [
      ['待确认', waiting.length, '请在期限内处理'], ['进行中', bookings.filter(o => ['confirmed', 'active'].includes(o.status)).length, '已确认及开始记录'], ['已完成', bookings.filter(o => o.status === 'done').length, '查看历史记录'],
    ] : [
      ['预约记录', bookings.length, group ? '全部服务门店' : '本店服务预约'], ['商品订单', goods.length, group ? `${urgent.length} 笔待发货` : '本店推广来源'], ['待处理账单', pendingBills.length, '核对与付款结果分别记录'],
    ]);
    html += panel(role === 'tech' ? '预约处理' : '预约工作台', `<div class="staff-entry-list">${entry(role === 'tech' ? '我的预约' : '预约安排', role === 'tech' ? '待确认、进行中和已完成记录' : '确认、选择技师、改派和调整时间', path('bookings'))}${entry('客服协助', '查看求助与处理进度', path('safety'))}${role !== 'tech' ? entry('预约售后', '查看申请、协商及分笔退款', path('bookings') + '?status=aftersale') : ''}${entry(role === 'tech' ? '今日排班' : '排班与请假', role === 'tech' ? scheduleText(bookingSchedule(s, actor.techId, dateOnly(s.now))) : '工作时间、休息和请假审批', path('schedule'))}${role === 'tech' ? entry('个人资料', '所属门店与可预约项目', path('profile')) : ''}</div>`);
    html += operationsSummary(s, actor, ui);
    html += careSummary(s, actor, ui);
    if (canManageView(actor,'qualifications')) html += panel('服务准入', entry(role === 'tech' ? '我的项目授权' : '考核与独立服务授权', role === 'tech' ? '本人资格、暂停和复训进度' : '按项目核验准入，跟踪暂停与复训恢复', path('qualifications')));
    if(canManageView(actor,'penalties')&&canAccountView(actor,'penalties'))html+=panel('一般警告与申诉',entry(role==='tech'?'我的警告与申诉':'原警告档案',role==='tech'?'查看原决定并提交本人一次申诉':'按原案件记录一般警告，查看实际复核结果',path('penalties')));
    if (!group || canCommand('review.hide')) html += panel('服务评价', entry(role === 'tech' ? '评价与申诉' : '评价处理', role === 'tech' ? '本人评价、说明与差评申诉进度' : '服务评价和申诉处理记录', path('reviews')));
    html += panel(role === 'tech' ? '我的服务收入' : '服务财务', entry(role === 'tech' ? '提成与发放记录' : '对账与技师提成', role === 'tech' ? '查看本人应计、调整与门店发放' : role === 'manager' ? '本店资金及发放进度' : '逐笔服务账本、退款调整和线下发放', path('service-finance')));
    if(canManageView(actor,'service-promotion')) html += panel('服务推广',entry(role==='tech'?'个人佣金与提现':'服务推广与个人佣金','查看原服务推广身份、佣金及办理记录',path('service-promotion')));
    if (role === 'manager') html += panel('服务发票进度', l('查看本店办理进度', '/manager/invoices', 'secondary'));
    html += panel('近期预约', bookingListBody(bookings.slice(-6).reverse()), nav('查看全部', 'bookings'));
    if (local || (group && canCommand('booking.assistance-close'))) html += panel('门店协助', entry(`待回复 ${bookings.reduce((n, o) => n + assistanceCount(o), 0)} 项`, '查看用户预约咨询并记录处理回复', path('bookings') + '?status=assistance'));
    if (role !== 'tech') html += panel('商品经营', `<div class="staff-entry-list">${entry(group ? '商品履约' : '推广订单', group ? '统一发货与处理售后' : '本店推广商品及售后进度', path('goods'))}${entry('商品佣金账单', '核对商品佣金及付款记录', path('bills'))}</div>`);
    if (group) html += panel('售后与退款待办', caseListBody(goods.flatMap(o => (o.cases || []).filter(c => !['closed', 'refunded', 'completed', 'rejected', 'done'].includes(c.status)).map(c => ({ o, c }))).slice(0, 6)));
    if (local) html += note('商品由集团收款、发货和处理售后。本店按订单锁定的推广来源核对佣金。');
    return html;
  }

  function bookingListBody(items) {
    if (!items.length) return empty('暂无预约', '用户完成预约提交后，会同步到对应门店和技师。');
    if (mobile) return `<div class="card-list">${items.map(o => `<article class="list-card"><div class="row"><strong>${e((o.serviceSnapshot?.name || serviceName(o.serviceId)))}</strong>${tag(o.displayStatus || labels[o.status])}</div><p>${e(d(o.startAt))} · ${e(bookingTech(o))}</p><p class="small muted">${safeId(o.id)} · ${e(userName(o.userId))}</p><div class="actions">${nav('查看预约', 'bookings', o.id, 'btn')}</div></article>`).join('')}</div>`;
    return rows(['预约 / 用户', '项目 / 时段', '技师 / 门店', '状态', '操作'], items.map(o => [
      `<strong>${safeId(o.id)}</strong><small>${e(userName(o.userId))}</small>`, `${e((o.serviceSnapshot?.name || serviceName(o.serviceId)))}<small>${e(d(o.startAt))}</small>`, `${e(bookingTech(o))}<small>${e(bookingStore(o))}</small>`, tag(o.displayStatus || labels[o.status]), nav('处理详情', 'bookings', o.id),
    ]));
  }

  function goodsList() {
    if (role === 'tech') return missing('商品经营');
    return title(group ? '商品订单与发货' : '商品推广订单', group ? '集团统一履约；待处理的取消或售后会阻断发货。' : '只展示本店推广订单及佣金，不向门店展示收货地址与电话。') +
      metrics([['支付成功订单', goods.filter(o => o.payment?.status === 'success').length, '包含退款订单'], ['商品应计佣金', m(sum(goods.filter(o => o.payment?.status === 'success'), commission)), '按商品净额及下单比例快照'], ['已付佣金', m(sum(goods, o => o.commissionPaidCents)), '付款结果已确认']]) +
      panel(group ? '订单列表' : '本店推广记录', rows(['商品订单', group ? '用户 / 推广店' : '客户', '应付 / 实付 / 已退', '履约', '佣金', '操作'], [...goods].reverse().map(o => [
        `<strong>${safeId(o.id)}</strong><small>${e(o.lines?.map(x => `${x.name} × ${x.qty}`).join('、') || '')}</small>`, group ? `${e(userName(o.userId))}<small>${e(sourceStore(o))}</small>` : '已脱敏用户',
        `${m(o.paidCents)}<small>实付 ${m(actualPaid(o))} · 已退 ${m(refunds(o))}</small>`, `${badge(o.status)}${pendingCase(o) ? '<small>售后处理中</small>' : ''}`, `${m(commission(o))}<small>${e(goodsSummary(s, o).commissionStatus)}</small>`, nav('查看详情', 'goods', o.id),
      ]))) + (group ? inventory() : '');
  }

  function inventory() {
    return panel('商品与可售库存', rows(['商品 / 规格', '现价', '可售库存', '佣金规则', '状态'], (s.skus || []).map(x => [
      `${e(x.name)}<small>${e(x.spec)}</small>`, m(x.priceCents), `${e(availableStock(s, x.id))} 件<small>实物库存 ${e(x.stock)}</small>`, `${Number(x.commissionBps || 0) / 100}%<small>演示参数，新订单快照</small>`, tag(x.active ? '销售中' : '已下架'),
    ])), `<div class="actions">${canManageView(actor,'catalog')?nav('管理商品','catalog','','btn'):''}${canManageView(actor,'inventory')?nav('入库与盘点','inventory','','btn'):''}</div>`);
  }

  function goodsDetail(id) {
    const o = goods.find(x => x.id === id);
    if (!o || role === 'tech') return missing('商品订单');
    const shipmentBlocked = goodsShippingBlocked(o);
    let html = title(o.id, group ? '商品销售、发货、收退款由集团负责。' : '此订单以本店为推广来源，地址及联系方式不向门店开放。', nav('返回列表', 'goods', '', 'btn'));
    html += panel('订单概况', `<div class="kv-grid">${kv('履约状态', badge(o.status))}${kv('支付结果', badge(o.payment?.status))}${kv('订单应付', m(o.paidCents))}${kv('订单实付', m(actualPaid(o)))}${kv('净收款', m(actualPaid(o) - refunds(o)))}${kv('成功退款', m(refunds(o)))}${kv('推广门店', e(sourceStore(o)))}${kv('商品佣金净额', m(commission(o)))}${kv('订单创建', e(d(o.createdAt)))}${kv('付款截止', e(d(o.deadline)))}</div>`);
    const summary = goodsSummary(s, o);
    html += note(`佣金：${summary.commissionStatus}${summary.commissionReason ? ` · ${summary.commissionReason}` : ''}${summary.debtCents ? ` · 待追回 ${m(summary.debtCents)}` : ''}`);
    html += panel('商品明细', rows(['商品 / 规格', '数量', '商品金额', '成功退款', '佣金比例'], (o.lines || []).map(x => [`${e(x.name)}<small>${e(x.spec)}</small>`, `${e(x.qty)}${x.cancelledQty ? `<small>已取消 ${e(x.cancelledQty)} 件</small>` : ''}${x.returnedQty ? `<small>已退回 ${e(x.returnedQty)} 件</small>` : ''}`, m(x.paidCents), m(x.refundedCents || 0), `${x.commissionBps / 100}%`])) + `<p class="small muted">运费 ${m(o.shippingCents)}，不参与商品佣金计算。</p>`);
    if (group) {
      const a = o.address || {};
      html += panel('收货与物流', `<div class="kv-grid">${kv('收件人', `${e(a.name)} · ${e(a.phone)}`)}${kv('地址', e([a.province, a.city, a.detail].filter(Boolean).join(' ')))}${kv('物流公司', e(o.shipment?.carrier || '尚未发货'))}${kv('运单号', e(o.shipment?.tracking || '—'))}</div>`);
      if (o.status === 'paid' && !shipmentBlocked && canCommand('goods.ship')) html += panel('登记出库', form('goods.ship', { id: o.id, version: o.version || 0 }, sel('物流公司', 'carrier', defaultCarrier, '顺丰速运') + f('运单号', 'tracking', '', 'text', 'required minlength="5" autocomplete="off"'), '确认发货'));
      if (o.status === 'paid' && shipmentBlocked) html += note('当前存在待核实取消或其他未结售后，请先核实处理。', 'warn');
      if (o.status === 'paid' && !shipmentBlocked && pendingCase(o)) html += note('已批准的取消数量已从发货件数扣除。其余商品可继续发货，原取消退款由财务单独跟进。');
    } else html += panel('物流进度', `<p>${e(o.shipment ? `${o.shipment.carrier} · 已登记发货` : '集团尚未登记发货')}</p>${o.receivedAt ? `<p>用户确认收货：${e(d(o.receivedAt))}</p>` : ''}`);
    html += goodsOrderExtras(s, actor, o, ui, { canCommand });
    html += goodsInvoicePanel(s,o,actor,ui);
    if ((o.cases || []).length) html += panel('售后案件', (o.cases || []).map(c => caseDetail(o, c)).join(''));
    if ((o.refunds || []).length) html += panel('退款流水', rows(['退款号', '金额', '状态', '尝试次数'], o.refunds.map(r => [safeId(r.id), m(r.amountCents), badge(r.status), e(r.attempts || 0)])));
    if (group) html += panel('操作记录', events(o));
    return html;
  }

  function caseListBody(items) {
    return rows(['案件 / 订单', '申请原因', '申请金额', '状态', '操作'], items.map(({ o, c }) => [
      `${safeId(c.id)}<small>${safeId(o.id)}</small>`, group ? e(c.reason || '—') : '由集团核实处理', m(Number(c.amountCents || 0) + Number(c.shippingCents || 0)), badge(c.status), nav(group ? '处理售后' : '查看进度', 'goods', o.id),
    ]));
  }

  function returnsPage() {
    if (role === 'tech') return missing('商品售后');
    return title(group ? '商品售后与退款' : '推广商品售后', group ? '先确定处理方案，再执行退款；退款与库存分别记账。' : '集团负责售后处理，本店查看进度及佣金影响。') + panel('案件列表', caseListBody(goods.flatMap(o => (o.cases || []).map(c => ({ o, c }))).reverse()));
  }

  function caseDetail(o, c) {
    const allocations = c.allocations?.length ? c.allocations : c.skuId ? [{ skuId: c.skuId, qty: c.qty, amountCents: c.amountCents }] : [];
    const products = allocations.map(part => {
      const line = o.lines.find(value => value.skuId === part.skuId);
      return `${e(line?.name || '历史商品')} · ${e(line?.spec || '规格未记录')}<small>SKU ${e(part.skuId)} · ${e(part.qty || 0)} 件 · 申请退款 ${m(part.amountCents || 0)}</small>`;
    }).join('<br>');
    let html = `<article class="case-card"><div class="row"><h3>${safeId(c.id)} · ${e({ cancel: '未发货取消', return: '退货退款', refund: '仅退款' }[c.kind] || '商品售后')}</h3>${badge(c.status)}</div>${group ? `<p>${e(c.reason)}</p>` : ''}<div class="kv-grid">${kv('申请退款', m(Number(c.amountCents || 0) + Number(c.shippingCents || 0)))}${kv('商品数量', `${e(c.qty || sum(allocations, x => x.qty))} 件`)}${kv('退款商品', products || '仅运费')}${kv('运费退款', m(c.shippingCents || 0))}${c.custody ? kv('退货保管 / 去向', e(c.custody)) : ''}</div>`;
    if (group && (c.returnShipment || c.shipment)) html += `<p class="small">退货物流：${e((c.returnShipment || c.shipment).carrier)} · ${e((c.returnShipment || c.shipment).tracking)}</p>`;
    if (group && c.reviewReason) html += `<p class="small muted">处理说明：${e(c.reviewReason)}</p>`;
    if (group && c.backShipment) html += `<p class="small">返还物流：${e(c.backShipment.carrier)} · ${e(c.backShipment.tracking)}</p><p class="small">返还运费：${c.backShipment.feePayer === 'group' ? '集团承担' : '用户承担'} · ${e(c.backShipment.agreement)}</p>`;
    if (group) {
      if (['requested', 'pending', 'awaiting_review', 'appealed', 'disputed'].includes(c.status) && canCommand('goods.case-review')) html += details('核实售后方案', form('goods.case-review', { id: o.id, caseId: c.id, version: c.version || 0 }, sel('处理决定', 'decision', [{ value: 'approve', label: '同意申请' }, { value: 'reject', label: '驳回并说明原因' }], 'approve') + f('处理说明', 'reason', '', 'text', 'required'), '提交处理结果'));
      if (c.status === 'inspection_review') html += c.appealReason ? `<p>用户申诉：${e(c.appealReason)}</p>` : '';
      if (c.inspectionDecision) html += `<p>客服裁决：${c.inspectionDecision.decision === 'approve' ? '同意退款，仓储处理实物后进入退款' : '维持拒退，安排返还原货'} · ${e(c.inspectionDecision.reason)}</p>`;
      if (c.dispositionReason) html += `<p>仓储处置：${e(c.dispositionReason)}</p>`;
      if (c.status === 'inspection_review' && canCommand('goods.inspection-resolve')) html += details('客服复核验收申诉', form('goods.inspection-resolve', { id: o.id, caseId: c.id }, sel('裁决结果', 'decision', [{ value: 'approve', label: '同意退款，交仓储处置实物' }, { value: 'reject', label: '维持拒退，交仓储返还原货' }], 'approve') + f('裁决依据', 'reason', '', 'text', 'required maxlength="300"'), '提交客服裁决'));
      if (c.status === 'inspection_review' && !canCommand('goods.inspection-resolve')) html += note('等待集团客服复核验收申诉，仓储继续保管原货。');
      if (['returning', 'awaiting_return_disposition'].includes(c.status) && canCommand('goods.inspect')) html += details(c.status === 'awaiting_return_disposition' ? '执行已确认方案并处置退货' : '退货收件与验收', form('goods.inspect', { id: o.id, caseId: c.id, version: c.version || 0 }, sel('验收处置', 'disposition', [{ value: 'sellable', label: '可售入库，进入退款' }, { value: 'damaged', label: '不可售报损，进入退款' }, ...(c.status === 'returning' ? [{ value: 'disputed', label: '验收不符，保管货物并通知用户' }] : [])], 'sellable') + f('验收及实物处置说明', 'reason', '', 'text', 'required maxlength="300"'), '确认实物处置'));
      if (c.status === 'awaiting_return_disposition' && !canCommand('goods.inspect')) html += note('客服已同意退款，等待仓储登记可售入库或报损结果。');
      if (c.status === 'awaiting_return_to_customer' && canCommand('goods.return-back')) html += details('登记货物返还', form('goods.return-back', { id: o.id, caseId: c.id, version: c.version || 0 }, sel('返还物流', 'carrier', defaultCarrier, '顺丰速运') + f('返还运单', 'tracking', '', 'text', 'required') + sel('双方约定的返还运费', 'feePayer', [{ value: 'group', label: '集团承担' }, { value: 'customer', label: '用户承担' }], 'group') + f('返还方案与协商依据', 'reason', '', 'text', 'required'), '登记返还发货'));
      if (c.status === 'inspection_disputed') html += note('货物暂由集团保管。等待用户接受拒退或发起验收申诉，处理后再执行返还或退款。');
      if (c.status === 'return_to_customer_shipping') html += note('货物已返还发出，等待用户确认收取；不提前关闭案件。');
      if (['refund_ready', 'refund_failed'].includes(c.status) && canCommand('goods.refund')) html += details('执行原路退款', form('goods.refund', { id: o.id, caseId: c.id }, outcome(), '发起退款'));
      if ((['refunding', 'processing', 'refund_processing'].includes(c.status) || (o.refunds || []).some(r => r.caseId === c.id && r.status === 'processing')) && canCommand('goods.refund-query')) html += details('查询退款最终结果', form('goods.refund-query', { id: o.id, caseId: c.id }, outcome('outcome', false), '查询原笔退款'));
    }
    return html + goodsCaseExtras(s, actor, o, c, ui, { canCommand }) + '</article>';
  }

  function billList() {
    if (role === 'tech') return missing('商品佣金账单');
    let html = title('商品佣金对账', group ? '集团出账 → 门店核对 → 集团付款 → 查询最终结果。' : '核对推广订单与退款调整，差异可反馈集团处理。');
    if (group) html += panel('生成门店账单', form('bill.create', {}, sel('结算门店', 'storeId', (s.stores || []).map(x => ({ value: x.id, label: x.name })), s.stores?.[0]?.id), '生成可结算账单') + note(`演示等待期 ${s.settings.waitDays} 天。只有已收货且等待期届满、无未决售后的订单进入账单。`));
    html += panel('账单列表', rows(['账单 / 门店', '应付金额', '账单版本', '状态', '操作'], [...bills].reverse().map(x => [
      `${safeId(x.id)}<small>${e(storeName(x.storeId))}${x.parentBillId && bills.filter(b=>b.id===x.parentBillId).length===1 ? ` · 原账 ${e(x.parentBillId)}` : ''}</small>`, m(x.amountCents) + (x.cashPaidCents != null ? `<small>现金 ${m(x.cashPaidCents)} · 抵扣 ${m(x.offsetSettledCents)}</small>` : ''), `第 ${e(x.version)} 版`, billBadge(x.status) + (x.dispute?.status === 'open' && x.status !== 'disputed' ? tag('差异待核查', 'warning') : ''), nav('核对详情', 'bills', x.id),
    ])));
    html += recoveriesPanel();
    return html;
  }

  function billDetail(id) {
    const x = bills.find(v => v.id === id);
    if (!x || role === 'tech') return missing('佣金账单');
    const entries = x.lines || x.items || [];
    const offsetActive = (s.goodsOffsetPlans || []).some(p => p.billId === x.id && ['proposed','confirmed','processing','failed'].includes(p.status));
    let html = title(x.id, `${storeName(x.storeId)} · 商品佣金账单`, nav('返回账单', 'bills', '', 'btn'));
    html += panel('账单金额', `<div class="kv-grid">${kv('账单状态', billBadge(x.status))}${kv('应付金额', m(x.amountCents))}${kv('核对版本', `第 ${e(x.version)} 版`)}${kv('付款交易', safeId(x.paymentId))}</div>`);
    html += panel('关联明细', rows(['商品订单', '本次应计', '说明'], entries.map(v => [nav(v.orderId || v.goodsId || v.id, 'goods', v.orderId || v.goodsId || v.id), m(v.amountCents ?? v.commissionCents), e(v.reason || '以商品净额和比例快照计算')])));
    const unresolved = ['disputed', 'dispute'].includes(x.status) || x.dispute?.status === 'open';
    if (x.dispute?.reason) html += note(`${unresolved ? '待处理差异' : '原差异'}：${x.dispute.reason}`);
    else if (x.disputeReason || x.reason) html += note(!unresolved && x.status === 'paid' ? '原调整已核对并结清，依据见操作记录。' : !unresolved && ['confirmed', 'confirmed_bill', 'payable', 'processing', 'paying', 'failed'].includes(x.status) ? '本账已重新核对，付款进度见账单状态；原调整依据见操作记录。' : `核对说明：${x.disputeReason || x.reason}`);
    if (x.dispute?.resolutionReason) html += note(`核查结果：${x.dispute.resolutionReason}`);
    if (local && !unresolved && !offsetActive && ['review', 'adjusted'].includes(x.status)) html += panel('门店核对', `<div class="actions">${b('确认账单', 'bill.confirm', { id: x.id, version: x.version })}</div>` + details('账单存在差异', form('bill.dispute', { id: x.id, version: x.version }, f('差异原因', 'reason', '', 'text', 'required'), '提交差异', 'secondary')));
    if (group && unresolved && !offsetActive) html += panel('处理门店差异', form('bill.resolve', { id: x.id }, f('核对结果与处理依据', 'reason', '', 'text', 'required'), ['paid','processing'].includes(x.status) ? '记录差异核查结果' : '处理并重新发送核对'));
    if (group && !unresolved && !offsetActive && ['confirmed', 'confirmed_bill', 'payable', 'failed'].includes(x.status)) html += panel('集团财务付款', `<p class="small muted">向门店合同主体付款。发起后进入处理中，继续查询最终到账结果。</p>` + b(x.status === 'failed' ? '原笔重新发起付款' : '发起付款', 'bill.pay', { id: x.id, outcome: 'processing' }));
    if (group && !offsetActive && ['processing', 'paying'].includes(x.status)) html += panel('查询付款结果', form('bill.query', { id: x.id }, outcome('outcome', false), '查询原笔付款'));
    html += goodsBillSettlementPanel(s, actor, x, ui, { goodsSummary, canCommand });
    html += panel('操作记录', events(x));
    return html;
  }

  function recoveriesPanel() {
    const reserved = r => (s.goodsOffsetPlans || []).filter(p => ['proposed','confirmed','processing','failed'].includes(p.status)).reduce((total,p) => total + (p.allocations || []).filter(a => a.recoveryId === r.id).reduce((n,a) => n + a.amountCents,0),0);
    let html = rows(['追回单 / 来源', '推广门店', '应追回', '已清偿', '余额 / 方案占用', '状态'], recoveries.map(r => [
      `${safeId(r.id)}<small>${safeId(r.orderId || r.goodsId)}</small>`, e(storeName(r.storeId)), m(r.amountCents), m(r.receivedCents || r.recoveredCents || 0), m(Math.max(0, r.amountCents - (r.receivedCents || r.recoveredCents || 0))) + (reserved(r) ? `<small>方案占用 ${m(reserved(r))}</small>` : ''), tag(r.status === 'closed' ? '已结清' : '待追回', r.status === 'closed' ? 'success' : 'warning'),
    ]));
    if (group) html += recoveries.filter(r => r.amountCents - (r.receivedCents || r.recoveredCents || 0) - reserved(r) > 0).map(r => details(`登记 ${r.id} 回款`, form('recovery.receive', { id: r.id }, f('本次回款（元）', 'amountCents', (r.amountCents - (r.receivedCents || r.recoveredCents || 0) - reserved(r)) / 100, 'number', `required min="0.01" max="${(r.amountCents - (r.receivedCents || r.recoveredCents || 0) - reserved(r)) / 100}" step="0.01" data-unit="yuan"`) + f('回款凭证 / 说明', 'proof', '', 'text', 'required'), '登记回款'))).join('');
    html += recoveries.filter(r => r.records?.length).map(r => details(`${r.id} 清偿记录`, rows(['发生时间', '金额', '清偿方式', '凭证 / 来源'], r.records.map(x => [e(d(x.at)), m(x.amountCents), x.kind === 'offset' ? '商品佣金抵扣' : '实际现金回款', e(x.proof) + (x.billId ? `<small>账单 ${safeId(x.billId)} · 方案 ${safeId(x.planId)}</small>` : '')])))).join('');
    return panel('已付佣金追回', html + note('先退用户，再单独追回已付商品佣金；现金回款与本店商品佣金抵扣分别记录，不影响预约门店或技师收入。')) + goodsRecoverySettlementPanel(s, actor, recoveries, ui);
  }

  function dateInput(t) { return new Date(Number(t) + 8 * 3600000).toISOString().slice(0, 16); }
  function candidateChoices(options, currentId) {
    const selected = options.candidates.find(t => t.id === currentId && t.available)?.id || options.candidates.find(t => t.id === options.selectedTechId && t.available)?.id || options.candidates.find(t => t.available)?.id;
    return `<fieldset class="staff-candidates"><legend>可安排技师</legend>${options.candidates.map(t => `<label class="staff-candidate ${t.available ? '' : 'unavailable'}"><input type="radio" name="techId" value="${e(t.id)}" ${t.available && t.id === selected ? 'checked' : ''} ${t.available ? 'required' : 'disabled'}><span class="staff-candidate-content"><strong>${e(t.name)}${t.id === currentId ? ' · 当前技师' : ''}</strong><small>${e(t.available ? `项目匹配 · ${Number(t.distanceKm || 0).toFixed(1)} km` : t.reason || '此时段不可安排')}</small></span>${tag(t.available ? '可选择' : '不可选择', t.available ? 'success' : '')}</label>`).join('') || '<p class="muted">本店暂无技师。</p>'}</fieldset>`;
  }
  function bookingAction(o, action) {
    if (!local || !['waiting', 'confirmed'].includes(o.status) || o.change?.status === 'pending') return missing('预约安排');
    const changing = action === 'reschedule';
    const rawStart = changing ? q.get('startAt') || dateInput(o.startAt) : dateInput(o.startAt);
    const startAt = Date.parse(`${rawStart}+08:00`);
    const options = bookingOptions(s, { id: o.id, storeId: o.storeId, serviceId: o.serviceId, mode: 'nearest', startAt, proposal: changing });
    if (!changing && o.status === 'confirmed') options.candidates = options.candidates.map(t => t.id === o.techId ? { ...t, available: false, reason: '当前预约技师，无需重复改派' } : t);
    const hasCandidate = options.candidates.some(t => t.available);
    let html = title(changing ? '调整预约时间' : o.status === 'waiting' ? '选择预约技师' : '改派预约技师', `${o.id} · ${(o.serviceSnapshot?.name || serviceName(o.serviceId))}`, nav('返回预约详情', 'bookings', o.id, 'btn'));
    html += panel('原预约', `<div class="kv-grid">${kv('预约时间', e(d(o.startAt)))}${kv('当前技师', e(bookingTech(o)))}${kv('安排方式', o.mode === 'specified' ? '指定技师' : '就近安排')}${kv('门店', e(bookingStore(o)))}</div>`);
    if (changing) html += panel('选择新时间', form('ui.filter', { path: path('bookings', o.id) + '/reschedule' }, f('新的预约开始时间', 'startAt', rawStart, 'datetime-local', 'required step="1800"'), '更新可安排技师', 'secondary').replace('<form ', '<form data-auto-filter="true" ') + note('门店方案须在最早可约提前量外，预留完整的15分钟确认时间。用户同意前，原预约继续保留。'));
    if (changing && startAt === o.startAt) html += note('请选择与原预约不同的新时间，再确认技师和调整原因。');
    if (options.error) html += note(options.error, 'warn');
    const command = changing ? 'booking.propose-reschedule' : 'booking.assign';
    let actionForm = form(command, { id: o.id, ...(changing ? { startAt } : {}) }, candidateChoices(options, o.techId) + f(changing ? '调整原因' : '安排原因', 'reason', '', 'text', 'required maxlength="500"'), changing ? '发送调整方案' : '确认安排');
    if (!hasCandidate || !options.valid || (changing && startAt === o.startAt)) actionForm = actionForm.replace('<button type="submit"', '<button type="submit" disabled');
    actionForm = actionForm.replace('<form ', `<form data-next="${e(path('bookings', o.id))}" `);
    html += panel(changing ? '新预约方案' : '选择技师', actionForm);
    html += note(changing ? '新时间、技师和原因一起发给用户确认；被拒绝时仍保留原安排。' : o.mode === 'specified' ? '改给其他技师时先由用户确认。未确认前，原技师和期限继续保留。' : '门店派单成功直接确认，切换候选或重试不会延长期限。');
    return html;
  }
  function bookingDetail(id) {
    const o = bookings.find(x => x.id === id);
    if (!o) return missing('预约详情');
    if (['assign', 'reschedule'].includes(route[2])) return bookingAction(o, route[2]);
    const elapsed = o.startedAt ? Math.max(0, Math.floor((s.now - o.startedAt) / 60000)) : 0;
    const due = o.round?.deadline ? Math.max(0, Math.ceil((o.round.deadline - s.now) / 60000)) : 0;
    let html = title(o.id, `${(o.serviceSnapshot?.name || serviceName(o.serviceId))} · ${bookingStore(o)}`, nav('返回预约', 'bookings', '', 'btn'));
    html += panel('预约信息', `<div class="kv-grid">${kv('当前进度', tag(o.displayStatus || labels[o.status]))}${kv('实际履约', o.completionKind ? tag(o.status === 'interrupted' ? '中止待核实' : '中止已核实') : badge(o.status))}${kv('预约时间', e(d(o.startAt)))}${kv('预约总时长', `${e(o.totalDuration || o.duration)} 分钟`)}${kv('当前技师', e(bookingTech(o)))}${kv('预约方式', e(o.mode === 'specified' ? '指定技师' : '就近安排'))}${kv('联系人', `${e(o.contactName)} · ${e(o.phone || o.contactMethod)}`)}${kv('预约用户', e(userName(o.userId)))}${kv('实付', m(o.paidCents))}${kv('成功退款', m(o.refundedCents))}${kv('净收款', m(o.netCents))}${kv('资金状态', e(o.fundStatus || '—'))}</div>`);
    if (role === 'group' && (!actor.job || ['all','support'].includes(actor.job))) {
      html += panel('联系方式访问', ui.sensitiveContact?.bookingId === o.id ? `<p role="status">本次查看：${e(ui.sensitiveContact.name)} · ${e(ui.sensitiveContact.phone)}</p><p class="muted">访问已留痕；离开页面后不再显示。</p>` : form('sensitive.reveal', { bookingId:o.id }, f('查看完整联系方式的原因','reason','','text','required maxlength="300"'), '查看并记录访问', 'secondary'));
      const accesses = sensitiveAccessView(s, actor).records.filter(x => x.bookingId === o.id);
      if (accesses.length) html += details('联系方式访问记录', accesses.map(x => `<article><p>${e(d(x.at))} · ${e(x.by.accountName || x.by.id)} · ${e(x.phoneMasked)}</p><p>${e(x.reason)}</p></article>`).join(''));
    }
    if (o.status === 'waiting') html += note(`本轮派单截止 ${d(o.round?.deadline)}，剩余 ${due} 分钟。切换候选或重试不会延长期限。${o.confirmationPhase === 'tech' ? ` 技师确认截止 ${d(o.round?.techDeadline)}。` : ' 当前由门店安排。'}`, 'warn');
    if (o.change?.status === 'pending') html += panel('等待用户确认变更', `<div class="kv-grid">${kv('变更类型', e(o.change.kind === 'reassign' ? '指定技师改派' : '门店改约'))}${kv('拟安排技师', e(techName(o.change.techId)))}${kv('拟预约时间', e(d(o.change.startAt)))}${kv('用户确认截止', e(d(o.change.expiresAt)))}</div><p>${e(o.change.reason)}</p>` + note('提案尚未生效，原安排保留。请切到该用户的预约详情接受或拒绝。'));
    if (role === 'tech') {
      if (o.status === 'waiting' && o.confirmationPhase === 'tech' && s.now < o.round?.techDeadline) html += panel('接单确认', `<div class="actions">${b('确认预约', 'booking.accept', { id: o.id })}</div>` + details('无法接受此预约', form('booking.reject', { id: o.id }, f('拒绝原因', 'reason', '', 'text', 'required'), '拒绝并转门店安排', 'secondary')));
      if (o.status === 'confirmed' && o.change?.status !== 'pending') html += panel('预约履约', s.now >= o.startAt ? b('开始服务', 'booking.start', { id: o.id }) : note(`预约于 ${d(o.startAt)} 开始。到达该业务时间后可登记开始。`));
      if (o.status === 'active') {
        if (o.supervision?.status === 'reminded') html += panel('超时安全确认', note('服务已超过计划时长，请确认安全并协调后续预约。', 'warn') + b('确认当前安全', 'booking.safety-confirm', {id:o.id}, 'secondary'));
        html += details('异常中止服务', form('booking.stop', {id:o.id}, sel('中止类型','category',[{value:'health',label:'身体不适'},{value:'user',label:'用户原因'},{value:'other',label:'其他原因'}],'health') + f('中止说明','reason','','text','required maxlength="500"'),'登记中止并交门店核实','secondary'));
        html += panel('进行中', `<div class="kv-grid">${kv('实际开始', e(d(o.startedAt)))}${kv('已进行', `${elapsed} 分钟`)}${kv('应完成时长', `${o.totalDuration || o.duration} 分钟`)}</div>` +
          (elapsed >= (o.totalDuration || o.duration) ? `<div class="actions">${b('正常完成', 'booking.finish', { id: o.id, mode: 'normal' })}</div>` : note('尚未满预约与已付加时时长；如需结束，请记录提前结束原因。')) +
          details('提前结束', form('booking.finish', { id: o.id, mode: 'early' }, f('提前结束原因', 'reason', '', 'text', 'required'), '记录提前结束', 'secondary')) +
          ((o.extensions || []).filter(x => !['expired', 'failed'].includes(x.status)).length < 2 ? `<div class="actions">${b(`申请加时 ${o.serviceSnapshot?.extensionMinutes || 30} 分钟`, 'booking.extension-create', { id: o.id, requestId: `staff-extension-${o.id}-${(o.extensions || []).length}` }, 'secondary')}</div><p class="small muted">创建后由用户在 5 分钟内完成支付，付款成功才计入服务时长。</p>` : ''));
      }
      if (bookingCanHelp(s, o, actor)) html += details('联系安全值班', form('booking.help', { id: o.id }, f('需要协助的情况', 'reason', '', 'text', 'required'), '提交求助', 'secondary'));
    }
    if (local && ['waiting', 'confirmed'].includes(o.status) && o.change?.status !== 'pending') {
      html += panel(o.status === 'waiting' ? '门店安排' : '调整安排', `<div class="staff-entry-list">${entry(o.status === 'waiting' ? '选择可约技师' : '改派预约技师', '先查看时段、项目和请假状态，再确认安排', path('bookings', o.id) + '/assign')}${entry('调整预约时间', '选择新时间、技师并发送用户确认', path('bookings', o.id) + '/reschedule')}</div>` + note(o.mode === 'specified' ? '改给其他技师时，先发给用户确认；原技师派单直接确认。' : '派单成功直接进入已确认，不再要求技师二次接单。'));
      html += details('门店原因取消', form('booking.cancel', { id: o.id }, f('取消原因', 'reason', '', 'text', 'required'), '取消并生成退款待办', 'secondary'));
    }
    html += panel('支付与加时', rows(['款项', '金额', '已退', '状态', '说明'], [
      [`主预约 ${safeId(o.payment?.id)}`, m(o.payment?.amountCents), m(o.payment?.refundedCents || 0), badge(o.payment?.status), '收款门店：' + e(bookingStore(o))],
      ...(o.extensions || []).map(x => [`加时 ${safeId(x.id)}`, m(x.amountCents), m(x.refundedCents || 0), badge(x.status), `${x.duration} 分钟${x.status === 'unpaid' ? ` · 付款截止 ${e(d(x.expiresAt))}` : ''}`]),
    ]));
    if (local || group) {
      const unknownExtensions = (o.extensions || []).filter(x => x.status === 'processing');
      html += unknownExtensions.map(x => panel('加时付款待核查', form('booking.extension-query', { id: o.id, extensionId: x.id }, outcome('outcome', false), '查询加时付款'))).join('');
    }
    if ((o.refunds || []).length) html += panel('预约售后与分笔退款', o.refunds.map(r => bookingRefund(o, r)).join(''));
    if (group && canCommand('booking.special-aftersale') && o.status === 'done' && s.now > o.completedAt + 2 * 86400000 && s.now <= o.completedAt + 30 * 86400000) {
      const candidates = [o.payment, ...(o.extensions || [])].filter(p => p.status === 'success' && p.amountCents > p.refundedCents);
      const unresolved = (o.refunds || []).some(r => ['requested','offered','approved','processing','failed','escalated'].includes(r.status) || r.status === 'rejected' && r.deadline) || (o.disputes || []).some(d => !['resolved','closed'].includes(d.status));
      if (unresolved) html += note('特批受理前请先核实原未结售后或争议案件，避免重复建立处理单。');
      if (candidates.length && !unresolved) html += panel('售后期后特批受理', note('记录用户原诉求与受理依据，提交后进入集团裁决。财务在裁决后按原支付分别退款。') + form('booking.special-aftersale', { id: o.id }, candidates.map(p => f(`${p.id} 申请退款（元，最高 ${m(p.amountCents - p.refundedCents)}）`, 'refundAmount:' + p.id, '', 'number', `min="0.01" max="${(p.amountCents - p.refundedCents) / 100}" step="0.01"`)).join('') + f('用户诉求与受理依据', 'reason', '', 'text', 'required maxlength="500"'), '登记特批售后').replace('<form ', `<form data-management-form="special-aftersale-${e(o.id)}" `));
    }
    const relatedSafety = (s.safety || []).filter(x => x.bookingId === o.id);
    if (canAccountView(actor, 'safety') && relatedSafety.length) html += panel('关联求助', relatedSafety.map(x => safetyCard(x)).join(''));
    if (o.completedAt) html += note(`${o.completionKind ? '履约停止于' : '实际完成于'} ${d(o.completedAt)}${o.finishReason ? `，${o.finishReason}` : ''}。${o.settlementBlocked ? '仍有未结事项，结算继续阻断。' : '后续售后及资金结果单独跟踪。'}`);
    html += closurePanels(s, o, actor, ui);
    if (canAccountView(actor, 'invoices')) html += invoiceBookingPanel(s, o, actor, ui);
    if (canAccountView(actor,'fulfilment') && canManageView(actor,'fulfilment')) html += fulfilmentBookingPanel(s,actor,o.id,ui,{canCommand});
    if (canAccountView(actor, 'service-finance')) html += financeBookingPanel(s, actor, o);
    if (canAccountView(actor, 'reviews')) html += reviewBookingPanel(s, o, actor, ui);
    if (canAccountView(actor, 'care')) html += careBookingPanel(s, actor, o, ui);
    if (canAccountView(actor, 'handoffs')) html += handoffBookingPanel(s, actor, o.id, ui);
    html += panel('预约时间线', events(o));
    return html;
  }

  function bookingRefund(o, r) {
    let html = `<article class="case-card"><div class="row"><h3>${safeId(r.id)}</h3>${badge(r.status)}</div><p>${e(r.reviewReason || r.reason)}</p>`;
    html += rows(['关联支付', '申请金额', '确认退款'], (r.requests || r.lines || []).map(x => [safeId(x.paymentId), m(x.amountCents), m((r.lines || []).find(v => v.paymentId === x.paymentId)?.amountCents || 0)]));
    const mayReview = (local && r.status === 'requested') || (group && (!actor.job || ['all','support'].includes(actor.job)) && r.status === 'escalated');
    if (mayReview) html += form('booking.refund-review', { id: o.id, refundId: r.id }, sel('处理决定', 'decision', r.kind === 'interruption' ? [{value:'offer',label:'提出方案并交用户确认'}] : [{ value: 'approve', label: '同意申请金额' }, { value: 'offer', label: '提出协商退款金额' }, { value: 'reject', label: '驳回并说明依据' }], r.kind === 'interruption' ? 'offer' : 'approve') + f('退款总额（元）', 'amountCents', (r.amountCents || sum(r.requests || [], x => x.amountCents)) / 100, 'number', 'min="0" step="0.01" data-unit="yuan"') + f('处理依据', 'reason', '', 'text', 'required'), '提交售后方案');
    html += (r.executions || []).map(x => {
      let row = `<article class="case-card"><div class="row"><strong>${x.paymentId === o.payment.id ? '主预约退款' : '加时退款'} · ${safeId(x.paymentId)}</strong>${badge(['offered','requested','escalated','rejected'].includes(r.status) ? r.status : x.status)}</div><p>${m(x.amountCents)} · 退款号 ${safeId(x.refundNo)} · 尝试 ${e(x.attempts || 0)} 次</p>`;
      const finance = local || (group && (!actor.job || ['all','finance'].includes(actor.job)));
      if (finance && ['approved','processing','failed'].includes(r.status)) {
        if (['approved','failed'].includes(x.status)) row += form('booking.refund-pay',{id:o.id,refundId:r.id,paymentId:x.paymentId},outcome(), x.status === 'failed' ? '原笔重试本款' : '执行本款退款');
        if (x.status === 'processing') row += form('booking.refund-query',{id:o.id,refundId:r.id,paymentId:x.paymentId},outcome('outcome',false),'查询本款退款结果');
      }
      return row + '</article>';
    }).join('');
    if (r.status === 'offered') html += note('已发给用户确认协商方案，确认后才可执行退款。');
    if (r.status === 'escalated' && local) html += note('用户已申请集团介入，请由集团处理。');
    return html + '</article>';
  }

  function schedule() {
    const staff = (s.techs || []).filter(t => group || (role === 'tech' ? t.id === actor.techId : t.storeId === actor.storeId));
    const selectedDate = /^\d{4}-\d{2}-\d{2}$/.test(q.get('date') || '') ? q.get('date') : dateOnly(s.now);
    if (route[1] === 'edit') {
      const target = staff.find(t => t.id === route[2]);
      if (!target) return missing('编辑排班');
      const day = q.get('date') || '', work = bookingSchedule(s, target.id, day || undefined);
      return title('编辑排班', `${target.name} · ${day ? `${day} 当日排班` : '每天的工作时间'}`, nav('返回排班', 'schedule', '', 'btn')) + panel(day ? '当日工作时间' : '日常工作时间', form('booking.schedule-save', { techId: target.id, ...(day ? { date: day } : {}) }, f('工作开始', 'start', work.start, 'time', 'required') + f('工作结束', 'end', work.end, 'time', 'required') + f('休息开始', 'breakStart', work.breakStart || '', 'time') + f('休息结束', 'breakEnd', work.breakEnd || '', 'time'), '保存排班').replace('<form ', `<form data-next="${e(path('schedule') + (day ? '?date=' + day : ''))}" `)) + note('结束须晚于开始，休息须在工作时段内。不设固定休息时请同时清空两个休息时间；已有预约与变更占用会继续保留，冲突时须先协调预约。');
    }
    let html = title(role === 'tech' ? '我的排班与请假' : '人员安排与请假', '按完整时间区间安排，已开始的服务保留履约事实。', nav('店内忙碌登记', 'busy', '', 'btn'));
    html += panel('排班日期', form('ui.filter', { path: path('schedule') }, f('查看日期', 'date', selectedDate, 'date', 'required'), '查看排班', 'secondary').replace('<form ', '<form data-auto-filter="true" '));
    html += panel('工作时间', `<div class="staff-schedule-list">${staff.map(t => {
      const work = bookingSchedule(s, t.id, selectedDate), dayStart = Date.parse(`${selectedDate}T00:00:00+08:00`), dayEnd = dayStart + 86400000;
      const dayLeaves = leaves.filter(x => x.techId === t.id && x.status === 'approved' && x.startAt < dayEnd && x.endAt > dayStart);
      return `<article class="staff-schedule-card"><div class="row"><strong>${e(t.name)}</strong>${tag(!t.active ? '暂停安排' : dayLeaves.length ? '有请假' : '按排班可约', dayLeaves.length ? 'warning' : '')}</div><p class="small muted">${e(storeName(t.storeId))}</p><p>${e(scheduleText(work))}</p>${dayLeaves.map(x => `<p class="small">已批准请假：${e(d(x.startAt))}–${e(d(x.endAt))}</p>`).join('')}<div class="actions">${l('编辑日常排班', path('schedule') + '/edit/' + t.id, 'secondary')}${l('调整当日排班', path('schedule') + '/edit/' + t.id + '?date=' + selectedDate, 'secondary')}</div></article>`;
    }).join('')}</div>` + note('可约时段同时核对工作时间、休息、已批准请假、预约和店内忙碌占用；按排班可约不代表当前实际空闲。'));
    html += panel(`${selectedDate} 预约占用`, rows(['技师 / 门店', '预约', '起止时间', '当前进度'], bookings.filter(o => dateOnly(o.startAt) === selectedDate && !['cancelled', 'closed'].includes(o.status)).map(o => [
      `${e(bookingTech(o))}<small>${e(bookingStore(o))}</small>`, nav(o.id, 'bookings', o.id), `${e(d(o.startAt))}<small>至 ${e(d(o.startAt + (o.totalDuration || o.duration) * 60000))}</small>`, tag(o.displayStatus || labels[o.status]),
    ])));
    if (role === 'tech') html += panel('申请请假', form('booking.leave-request', {}, f('开始时间', 'startAt', dateInput(s.now + 120 * 60000), 'datetime-local', 'required') + f('结束时间', 'endAt', dateInput(s.now + 240 * 60000), 'datetime-local', 'required') + sel('请假类型', 'emergency', [{ value: 'false', label: '普通请假' }, { value: 'true', label: '紧急请假' }], 'false') + f('请假原因', 'reason', '', 'text', 'required'), '提交请假'));
    html += panel('请假记录', leaves.length ? `<div class="stack">${[...leaves].reverse().map(x => {
      const affected = bookings.filter(o => !['cancelled', 'closed', 'done'].includes(o.status) && ((o.techId === x.techId && o.startAt < x.endAt && o.startAt + (o.totalDuration || o.duration) * 60000 > x.startAt) || (o.change?.status === 'pending' && o.change.techId === x.techId && o.change.startAt < x.endAt && o.change.startAt + (o.totalDuration || o.duration) * 60000 > x.startAt)));
      const review = local && x.status === 'pending' ? form('booking.leave-review', { leaveId: x.id }, sel('审批结果', 'decision', [{ value: 'approve', label: '批准请假' }, { value: 'reject', label: '不批准' }], 'approve') + f('审批说明', 'reason', '', 'text', 'required'), '提交审批') : '';
      return `<article class="list-card"><div class="row"><strong>${e(techName(x.techId))} · ${x.emergency ? '紧急请假' : '普通请假'}</strong>${badge(x.status)}</div><p>${e(d(x.startAt))} — ${e(d(x.endAt))}</p><p>${e(x.reason)}</p><p class="small muted">关联预约：${affected.length ? affected.map(o => nav(`${o.id} · ${o.displayStatus || labels[o.status]}`, 'bookings', o.id)).join('、') : '无重叠有效预约'}</p>${x.status === 'pending' ? note('普通请假有有效预约或待确认变更占用时不可批准。紧急请假撤回受影响方案；只将已确认且尚无出发或开始事实的预约交回门店安排。') : ''}${review}${x.affectedIds?.length ? `<p class="small">已移入安排池：${x.affectedIds.map(id => safeId(id)).join('、')}</p>` : ''}</article>`;
    }).join('')}</div>` : empty('暂无请假申请', role === 'tech' ? '需要请假时填写完整时间和原因。' : '技师提交后会出现在本店审批记录中。'));
    html += panel('人员', rows(['姓名', '门店', '可服务项目', '状态'], staff.map(t => [e(t.name), e(storeName(t.storeId)), (t.serviceIds || []).map(id => e(serviceName(id))).join('、'), tag(!t.active ? '暂停安排' : (s.leaves || []).some(x => x.techId === t.id && x.status === 'approved' && x.startAt <= s.now && x.endAt > s.now) ? '请假中' : '在岗；按时段核验')])));
    return html;
  }

  function safetyCard(x) {
    const allowed = group || (local && x.storeId === actor.storeId);
    let html = `<article class="case-card"><div class="row"><h3>${safeId(x.id)}</h3>${tag(x.status === 'closed' ? '已结案' : '待处置', x.status === 'closed' ? 'good' : 'warn')}</div><p>${e(x.reason)}</p><p class="small muted">${e(d(x.createdAt))} · ${e(storeName(x.storeId))}</p><div class="actions">${nav('查看关联预约', 'bookings', x.bookingId, 'btn')}</div>`;
    const responsibleName=x.responsibility?.name||x.responsibleName;
    if (x.status === 'open') html += note(`当前阶段：${({pending:'等待接报',acknowledged:'已接报',escalated:'已升级集团',unanswered:'升级后仍未响应'})[x.stage] || '等待处理'}${responsibleName ? ' · 责任人：' + responsibleName : ''}`);
    if (allowed && x.status === 'open') {
      if (!x.acknowledgedAt) html += form('booking.help-ack', {safetyId:x.id}, f('接报责任人','responsibleName','','text','required'), '确认接报');
      html += form('booking.help-close', { safetyId: x.id }, f('联系与处置结果', 'resolution', '', 'text', 'required') + sel('是否仍有服务争议','unresolvedDispute',[{value:'false',label:'没有未结服务争议'},{value:'true',label:'有，创建独立争议继续跟进'}],'false'), '记录结果并结案');
    }
    if (x.status === 'open' && role === 'tech') html += '<p class="notice warning">如有紧急人身危险，请直接报警。</p><a class="secondary" href="tel:110">拨打110</a>';
    if (x.resolution) html += `<p>处置结果：${e(x.resolution)}</p>`;
    return html + '</article>';
  }

  function safety() {
    const items = (s.safety || []).filter(x => group || (local ? x.storeId === actor.storeId : x.techId === actor.techId));
    return title('安全值班与求助', '先处理求助并记录事实；结案不会覆盖已完成、已取消或退款结果。') + note('求助未结时继续阻断结算；技师仍可如实记录服务完成。其他未结争议需分别处理。') + panel('求助事件', items.length ? [...items].reverse().map(safetyCard).join('') : empty('暂无求助事件', '用户或技师可从预约详情发起求助。'));
  }

  const section = route[0] || 'home';
  if (section === 'goods') return route[1] ? goodsDetail(route[1]) : goodsList();
  if (section === 'bills') return route[1] ? billDetail(route[1]) : billList();
  if (section === 'returns') return returnsPage();
  if (section === 'inventory') return group ? title('商品与库存', '库存由订单占用、出库、取消及退货验收共同变化。') + inventory() : missing('商品库存');
  if (section === 'recoveries') return role === 'tech' ? missing('佣金追回') : title('已付佣金追回', '按来源订单记录应追回金额，集团核实回款后结清。') + recoveriesPanel();
  if (section === 'booking' || section === 'bookings') return route[1] ? bookingDetail(route[1]) : bookingList();
  if (section === 'schedule') return schedule();
  if (section === 'profile') {
    const t = (s.techs || []).find(x => x.id === actor.techId);
    if (role !== 'tech' || !t) return missing('个人资料');
    return title('个人资料', '当前预约技师的门店与项目资料。') + panel(t.name, `<div class="kv-grid">${kv('所属门店', e(storeName(t.storeId)))}${kv('可约项目', e(t.serviceIds.map(serviceName).join('、')))}${kv('安排状态', t.active ? '可参与预约安排' : '暂停安排')}</div>`) + panel('排班管理', entry('我的排班', '设置工作、休息和请假时段', path('schedule')));
  }
  if (section === 'safety') return safety();
  if (['home', 'dashboard'].includes(section)) return home();
  return missing('页面不存在');
}
