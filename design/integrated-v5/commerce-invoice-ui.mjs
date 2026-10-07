// C07 views. Pure reads; actual files reuse the permission-checked local attachment layer.
import { commerceInvoiceRule, goodsInvoiceSummary, feeInvoiceSummary, commerceInvoiceViewData, canReadCommerceInvoice } from './commerce-invoices.mjs';
import { resolveAccountActor, canAccountView } from './staff-accounts.mjs';
const STATUS = { pending: '待开票', issued: '已开票', rejected: '已驳回', red_pending: '待红冲', red: '已红冲' };
const groupFinance = a => a.role === 'group' && (!a.job || ['all', 'finance'].includes(a.job));
const storeFinance = a => a.role === 'store' && (!a.job || ['all', 'store-finance'].includes(a.job));
const categoryRoute = c => c === 'goods' ? 'commodity-invoices' : 'fee-invoices';
function helpers(actor, ui) {
  const e = ui.esc, m = x => Number.isSafeInteger(x) ? ui.money(x) : '待核对', d = x => e(ui.date(x));
  const path = (category, id = '') => `/${actor.role}/${categoryRoute(category)}${id ? '/' + encodeURIComponent(id) : ''}`;
  const link = (text, href, cls = 'secondary') => ui.link(e(text), href, cls);
  const note = (text, warning = false) => `<p class="notice${warning ? ' warning' : ''}">${e(text)}</p>`;
  const panel = (title, body) => `<section class="panel management-panel"><h2>${e(title)}</h2>${body}</section>`;
  const row = (label, value) => `<div class="row"><span class="muted">${e(label)}</span><span>${value}</span></div>`;
  const head = (title, desc = '', actions = '') => `<header class="page-head"><div><h1>${e(title)}</h1><p>${e(desc)}</p></div><div class="actions">${actions}</div></header>`;
  const badge = status => ui.tag(STATUS[status] || status, ['rejected', 'red_pending'].includes(status) ? 'warning' : status === 'issued' ? 'success' : '');
  const table = (heads, rows) => rows.length ? `<div class="table-wrap"><table><thead><tr>${heads.map(x => `<th>${e(x)}</th>`).join('')}</tr></thead><tbody>${rows.map(xs => `<tr>${xs.map(x => `<td>${x}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : ui.empty('暂无记录');
  const form = (op, payload, fields, label, key, next = '', confirm = '') => `<form class="management-form" data-invoice-form data-management-form="${e(`commerce-invoice:${actor.role}:${actor.accountId || actor.userId || actor.storeId || actor.job || 'all'}:${key}:${op}:${payload.slot || ''}`)}" data-command="commerce-invoice.${e(op)}" data-payload="${e(JSON.stringify(payload))}" data-live-version="${e(payload.version ?? '')}" data-next="${e(next)}" data-confirm="${e(confirm)}"><div class="management-grid">${fields}</div><p class="management-draft-note small muted" role="status">未提交内容保留在当前标签页，提交成功后清除。</p><div class="actions"><button class="primary" type="submit">${e(label)}</button><button class="secondary" type="button" data-command="ui.management-discard">放弃本页草稿</button></div></form>`;
  const title = (invoice = {}, category = 'goods') => ui.select('抬头类型', 'kind', category === 'fee' ? [{ value: 'company', label: '门店企业' }] : [{ value: 'personal', label: '个人' }, { value: 'company', label: '企业' }], category === 'fee' ? 'company' : invoice.kind || 'personal') + ui.field('受票抬头', 'title', invoice.title || '', 'text', 'required maxlength="120"') + ui.field('企业税号（企业必填）', 'taxId', invoice.taxId || '', 'text', `maxlength="20" ${category === 'fee' || invoice.kind === 'company' ? 'required' : 'disabled'}`) + ui.field('接收邮箱', 'email', invoice.email || '', 'email', 'required maxlength="254"');
  const reason = label => `<label class="field wide"><span>${e(label)}</span><textarea name="reason" required maxlength="300" rows="3"></textarea></label>`;
  const upload = () => `<div class="field wide"><label class="field"><span>实际凭证（PDF / PNG / JPEG，最大5 MiB）</span><input type="file" data-invoice-upload accept="application/pdf,image/png,image/jpeg"></label><input type="hidden" name="fileRef" value=""><input type="hidden" name="fileName" value=""><input type="hidden" name="fileType" value=""><input type="hidden" name="fileSize" value=""><span class="small muted" data-invoice-upload-status role="status">请选择本机实际文件；仅填写文件名不能提交。</span></div>`;
  const financeSource = (id, label) => link(label, `/${actor.role}/service-finance/entry/${encodeURIComponent(id)}`);
  return { e, m, d, path, link, note, panel, row, head, badge, table, form, title, reason, upload, financeSource };
}
function current(s, category, source) { return [...(s.commerceInvoices || [])].reverse().find(x => x.category === category && !x.replacedById && (category === 'goods' ? x.orderId === source.orderId : x.storeId === source.storeId && x.month === source.month)); }
function blocker(summary, initial = false) { return summary.blockedReason || (summary.netCents <= 0 ? '可开票净额为零或负数，不能申请或开具。' : initial && !summary.withinWindow ? '已超过商品新申请窗口。' : ''); }
function attachment(invoice, slot, h) {
  const ticket = invoice[slot], file = ticket?.file; if (!ticket) return '';
  const label = slot === 'issued' ? '原发票' : '红冲凭证';
  return h.panel(label, h.row('实际票号', h.e(ticket.ticketNumber)) + h.row('登记时间', h.d(ticket.at)) + h.row('票据金额', h.m(ticket.amountCents)) + (file?.ref ? `<div data-invoice-file="${h.e(file.ref)}" data-invoice-domain="commerce" data-invoice-id="${h.e(invoice.id)}" data-invoice-slot="${slot}"><p class="order-number">${h.e(file.name)} · ${h.e(file.type)}</p><div class="actions"><button type="button" class="btn secondary" data-invoice-action="view" aria-expanded="false" disabled>查看${label}</button><a class="btn secondary" data-invoice-action="download">下载${label}</a></div><span class="small muted" data-invoice-file-status role="status">正在读取本机文件；文件缺失请联系集团财务补传。</span><section class="invoice-inline-preview" data-invoice-preview role="region" aria-label="${label}预览" hidden><div class="invoice-preview-heading"><h3>${label}预览</h3><button type="button" class="btn secondary" data-invoice-action="close-preview">关闭预览</button></div><p class="small muted" data-invoice-preview-status role="status"></p><div data-invoice-preview-content></div></section></div>` : h.note('当前实际文件引用缺失，请联系集团财务补传。', true)));
}
function sourceTable(invoice, h, basis) {
  const date = (row, original) => {
    const at = Number.isSafeInteger(row.at) && row.at >= 0 ? row.at : original?.at;
    return Number.isSafeInteger(at) && at >= 0 ? h.d(at) : '—';
  };
  // Old invoice snapshots have no dates. Resolve only the exact original source;
  // keep their amounts and source list frozen, including after later refunds.
  const rows = (invoice.sourceSnapshot || []).map(x => [x.entryId ? h.financeSource(x.entryId, x.id) : h.e((x.sourceId || x.id) + (x.includedInInvoice === false ? '（本票不计）' : '')), h.e(x.paymentId || ''), date(x, invoice.category === 'goods' ? basis?.sourceSnapshot?.find(f => f.kind === x.kind && f.sourceId === x.sourceId && f.paymentId === x.paymentId) : null), h.m(x.paidCents ?? x.amountCents), h.m(x.refundedCents ?? x.returnedCents ?? (x.kind === 'return' ? x.amountCents : 0)), h.m(x.invoiceNetCents ?? x.netCents)]);
  let body = h.table(['来源', '原支付', invoice.category === 'goods' ? '实际支付时间' : '实际时间', '支付 / 收退原额', '成功退款 / 退回', '开票净额'], rows);
  if (invoice.refundSnapshot?.length) body += h.table(['成功退款原笔', '售后案件', '实际退款成功时间', '商品退款', '运费退款'], invoice.refundSnapshot.map(x => [h.e(x.refundId), h.e(x.caseId), date(x, invoice.category === 'goods' ? basis?.refundSnapshot?.find(f => f.refundId === x.refundId && f.caseId === x.caseId) : null), h.m(x.amountCents - x.shippingCents), h.m(x.shippingCents)]));
  if (invoice.allocationSnapshot?.length) body += h.table(['实际退回', '原收入来源', '归属金额', '退回时间'], invoice.allocationSnapshot.map(x => [h.e(x.returnId), h.e(x.incomeId), h.m(x.amountCents), h.d(x.returnedAt)]));
  return h.panel(invoice.issued ? '原票资金依据快照' : '申请资金依据快照', body);
}
export function goodsInvoicePanel(s, order, rawActor, ui) {
  let actor; try { actor = resolveAccountActor(s, rawActor); } catch { return ''; }
  if (!order || !canAccountView(actor, 'commodity-invoices') || !(groupFinance(actor) || actor.role === 'user' && actor.userId === order.userId)) return '';
  const h = helpers(actor, ui), invoice = current(s, 'goods', { orderId: order.id }), summary = goodsInvoiceSummary(s, order, invoice?.ruleSnapshot || commerceInvoiceRule(s, 'goods'));
  let body = h.row('开票主体', h.e((invoice?.issuerSnapshot || summary.rule?.issuer)?.name || '尚未配置')) + h.row('商品当前可开票净额', !summary.rule ? h.e('口径待确认') : summary.basisValid ? h.m(summary.netCents) : h.e('资金依据待核对'));
  if (invoice && canReadCommerceInvoice(s, actor, invoice)) body += h.row('办理进度', h.badge(invoice.status)) + `<div class="actions">${h.link('查看商品发票', h.path('goods', invoice.id))}</div>`;
  else if (actor.role === 'user') {
    const why = blocker(summary, true);
    body += why ? h.note(why, true) : `<details class="action-details"><summary>申请商品发票</summary>${h.note('按集团已发布的本地Demo开票口径申请，真实税务开票与邮件尚未接入。')}${h.form('apply-goods', { orderId: order.id }, h.title(), '提交商品发票申请', order.id, h.path('goods'))}</details>`;
  } else body += h.note('商品订单本人尚未提交开票申请。');
  return h.panel('商品发票', body);
}
function ruleView(s, actor, ui, h) {
  if (!groupFinance(actor) || !canAccountView(actor, 'commerce-invoice-rules')) return ui.empty('当前岗位无权发布集团开票配置');
  const data = commerceInvoiceViewData(s, actor);
  let html = h.head('集团开票配置', '商品票与服务费月票独立配置；输入仅用于本地Demo，真实主体与政策仍待财务确认。', h.link('商品票', h.path('goods')) + h.link('集团月票', h.path('fee')));
  for (const category of ['goods', 'fee']) {
    const rules = data.rules.filter(x => x.category === category), version = Math.max(0, ...rules.map(x => x.version)), active = commerceInvoiceRule(s, category);
    const common = ui.field('集团开票主体名称（Demo输入）', 'issuerName', '', 'text', 'required maxlength="120"') + ui.field('集团开票主体税号（Demo输入）', 'issuerTaxId', '', 'text', 'required maxlength="20"') + ui.field('开票项目', 'invoiceItem', '', 'text', 'required maxlength="120"') + ui.field('生效时间（不能倒签）', 'effectiveAt', '', 'datetime-local', 'required') + ui.field('可核对来源起点', 'sourceFromAt', '', 'datetime-local', 'required');
    const choose = [{ value: '', label: '请明确选择' }];
    const specific = category === 'goods' ? ui.select('可申请阶段', 'applicationStage', [...choose, { value: 'paid', label: '成功支付后' }, { value: 'received', label: '确认收货后' }], '') + ui.select('运费开票口径', 'shipping', [...choose, { value: 'include', label: '计入已付净运费' }, { value: 'exclude', label: '只计商品，不含运费' }], '') + ui.field('新申请窗口（天）', 'windowDays', '', 'number', 'required min="1" max="3650" step="1"') : ui.select('周期', 'cycle', [...choose, { value: 'monthly', label: '自然月' }], '') + ui.field('月份时区偏移（分钟）', 'timezoneMinutes', '', 'number', 'required min="-720" max="840" step="1"') + ui.select('退回归属模拟方案', 'returnPolicy', [...choose, { value: 'cash-month', label: '实际收退发生月' }, { value: 'original-income-fifo', label: '原收入月份，按原支付收入先后归属' }], '');
    html += h.panel(category === 'goods' ? '商品票配置' : '集团服务费月票配置', h.row('当前生效', h.e(active ? `v${active.version} · ${active.issuer.name}` : '尚未发布')) + h.note('空配置不能成为正式业务规则；发布保存依据与版本。已申请票据保留原主体和原方案快照。', true) + h.form('rule-publish', { category, version }, common + specific + h.reason('依据与发布说明（必须说明Demo方案）'), '发布本地Demo配置', category, `/${actor.role}/commerce-invoice-rules`, '确认发布这组本地Demo开票配置？真实主体与正式政策仍需财务确认。') + h.table(['版本', '开票主体 / 项目', '生效 / 来源起点', '依据', '正式确认'], [...rules].reverse().map(x => [`v${h.e(x.version)}`, `${h.e(x.issuer.name)}<small>${h.e(x.invoiceItem)}</small>`, `${h.d(x.effectiveAt)}<small>${h.d(x.sourceFromAt)}</small>`, h.e(x.reason), '尚未确认'])));
  }
  return html;
}
export function commerceInvoiceView(s, route = [], rawActor, ui) {
  if (!['commodity-invoices', 'fee-invoices', 'commerce-invoice-rules'].includes(route[0])) return null;
  let actor; try { actor = resolveAccountActor(s, rawActor); } catch (error) { return ui.empty('工作身份已失效', error.message); }
  const h = helpers(actor, ui);
  if (route[0] === 'commerce-invoice-rules') return ruleView(s, actor, ui, h);
  const category = route[0] === 'commodity-invoices' ? 'goods' : 'fee';
  if (!canAccountView(actor, route[0]) || !(groupFinance(actor) || (category === 'goods' ? actor.role === 'user' : storeFinance(actor)))) return ui.empty('当前身份无权查看此类集团票据');
  const data = commerceInvoiceViewData(s, actor), records = data.invoices.filter(x => x.category === category), id = route[1], query = ui.query || new URLSearchParams();
  if (!id) {
    const status = query.get('status') || '', q = (query.get('q') || '').trim().toLowerCase();
    const filtered = records.filter(x => (!status || x.status === status) && (!q || [x.id, x.orderId, x.storeId, x.month, x.title].some(v => String(v || '').toLowerCase().includes(q))));
    let html = h.head(category === 'goods' ? '商品发票' : '集团服务费月票', category === 'goods' ? '集团开具；按商品成功支付与退款核对，服务票分别办理。' : '按本门店集团实际已收服务费与实际退回逐来源核对。', groupFinance(actor) ? h.link('开票配置', '/group/commerce-invoice-rules') : '');
    html += h.panel('查找申请', `<form class="management-filters" data-command="ui.filter" data-payload="${h.e(JSON.stringify({ path: h.path(category) }))}">${ui.select('状态', 'status', [{ value: '', label: '全部' }, ...Object.entries(STATUS).map(([value, label]) => ({ value, label }))], status)}${ui.field('申请号 / 来源 / 抬头', 'q', query.get('q') || '', 'search')}<button class="secondary" type="submit">筛选</button>${h.link('清除筛选', h.path(category))}</form>`);
    if (category === 'fee') {
      const storeId = storeFinance(actor) ? actor.storeId : query.get('storeId') || '', month = query.get('month') || '';
      html += h.panel('核对月度来源', `<form class="management-filters" data-command="ui.filter" data-payload="${h.e(JSON.stringify({ path: h.path(category) }))}">${groupFinance(actor) ? ui.select('受票门店', 'storeId', [{ value: '', label: '请选择门店' }, ...(s.stores || []).map(x => ({ value: x.id, label: x.name }))], storeId) : ''}${ui.field('对账月', 'month', month, 'month', 'required')}<button class="secondary" type="submit">核对月份</button></form>`);
      if (storeId && month) {
        const item = current(s, category, { storeId, month }), summary = feeInvoiceSummary(s, storeId, month, item?.ruleSnapshot || commerceInvoiceRule(s, 'fee'));
        let body = h.row('开票主体', h.e(summary.rule?.issuer?.name || '尚未配置')) + h.row('实际集团收入', h.m(summary.paidCents)) + h.row('实际集团退回', h.m(summary.refundedCents)) + h.row('月票净额', h.m(summary.netCents));
        if (summary.blocked) body += h.note(summary.blockedReason, true);
        if (item) body += `<div class="actions">${h.link('查看本月申请', h.path(category, item.id))}</div>`;
        else if (storeFinance(actor)) body += blocker(summary) ? h.note(blocker(summary), true) : h.form('apply-fee', { storeId, month }, h.title({}, 'fee'), '申请集团服务费月票', `${storeId}:${month}`, h.path(category));
        body += sourceTable({ sourceSnapshot: summary.sourceSnapshot, allocationSnapshot: summary.allocationSnapshot }, h);
        html += h.panel(`${month} · ${s.stores?.find(x => x.id === storeId)?.name || storeId}`, body);
      }
    }
    html += h.panel('发票申请记录', h.table(['申请', category === 'goods' ? '商品订单' : '门店 / 月份', '受票抬头', '申请 / 原票金额', '状态 / 版本', '操作'], [...filtered].reverse().map(x => [h.e(x.id), `${h.e(x.orderId || x.storeId)}${x.month ? `<small>${h.e(x.month)}</small>` : ''}`, h.e(x.title), h.m(x.amount), `${h.badge(x.status)}<small>v${h.e(x.version)}</small>`, h.link('查看详情', h.path(category, x.id))])));
    if (category === 'goods' && actor.role === 'user') html += h.note('新申请从本人的商品订单详情进入。') + `<div class="actions">${h.link('查看商品订单', '/user/goods')}</div>`;
    return html;
  }
  const invoice = records.find(x => x.id === id); if (!invoice) return h.head('集团票据') + ui.empty('记录不存在或当前身份无权查看') + h.link('返回列表', h.path(category));
  const summary = category === 'goods' ? goodsInvoiceSummary(s, invoice.orderId, invoice.ruleSnapshot) : feeInvoiceSummary(s, invoice.storeId, invoice.month, invoice.ruleSnapshot);
  let html = h.head(invoice.id, `${STATUS[invoice.status]} · v${invoice.version}`, h.link('返回列表', h.path(category))) + h.panel('办理进度', h.row('状态', h.badge(invoice.status)) + h.row('独立开票主体', h.e(invoice.issuerSnapshot.name)) + h.row('开票主体税号', h.e(invoice.issuerSnapshot.taxId)) + h.row('开票项目 / 配置版本', `${h.e(invoice.ruleSnapshot.invoiceItem)} · v${h.e(invoice.ruleSnapshot.version)}`) + h.row('来源', category === 'goods' ? h.link(invoice.orderId, `/${actor.role}/goods/${encodeURIComponent(invoice.orderId)}`) : `${h.e(invoice.storeId)} · ${h.e(invoice.month)}`) + h.row(invoice.issued ? '原票金额' : '申请金额', h.m(invoice.amount)) + h.row('当前可开票净额', h.m(summary.netCents)) + (invoice.replacesId ? h.row('关联原票', h.link(invoice.replacesId, h.path(category, invoice.replacesId))) : '') + (invoice.replacedById ? h.row('后续净额票', h.link(invoice.replacedById, h.path(category, invoice.replacedById))) : ''));
  html += h.panel('受票资料', h.row('抬头', h.e(invoice.title)) + (invoice.kind === 'company' ? h.row('企业税号', h.e(invoice.taxId)) : '') + h.row('接收邮箱', h.e(invoice.email)) + h.note('本地Demo不发送邮件；实际开票由集团财务办理。'));
  const rule = invoice.ruleSnapshot;
  html += h.panel('申请时配置', h.row('本地Demo口径', h.e(category === 'goods' ? `${rule.applicationStage === 'paid' ? '成功支付后申请' : '确认收货后申请'} · 新申请${rule.windowDays}天 · ${rule.shipping === 'include' ? '含净运费' : '运费不计本票'}` : `${rule.returnPolicy === 'cash-month' ? '实际收退发生月' : '按原支付收入先后归属原月份'} · 月份时区偏移${rule.timezoneMinutes}分钟`)) + h.row('配置依据', h.e(rule.reason)) + h.note('本次配置仅用于本地模拟，正式税务主体与政策尚未确认。')) + sourceTable(invoice, h, summary);
  if (invoice.rejectReason) html += h.note('驳回原因：' + invoice.rejectReason, true);
  if (summary.blocked) html += h.note(summary.blockedReason, true);
  if (invoice.status === 'red_pending') html += h.note('成功资金事实已改变原票依据，请集团财务登记红冲；原票与原金额继续保留。', true);
  html += attachment(invoice, 'issued', h) + attachment(invoice, 'red', h);
  if (groupFinance(actor)) {
    if (invoice.status === 'pending') {
      html += blocker(summary) ? h.note(blocker(summary), true) : h.panel('登记集团实际发票', h.form('issue', { id, version: invoice.version }, ui.field('实际发票号码', 'ticketNumber', '', 'text', 'required maxlength="100"') + h.upload(), '登记已开票', id, h.path(category, id), '确认按此独立主体和净额登记已开具票据？'));
      html += `<details class="action-details"><summary>驳回申请</summary>${h.form('reject', { id, version: invoice.version }, h.reason('驳回原因'), '驳回申请', id, h.path(category, id))}</details>`;
    }
    if (invoice.status === 'red_pending') html += h.panel('登记原票红冲', h.form('red', { id, version: invoice.version }, ui.field('实际红冲票号', 'ticketNumber', '', 'text', 'required maxlength="100"') + h.upload(), '登记红冲', id, h.path(category, id)));
    for (const slot of ['issued', 'red']) if (invoice[slot]) html += `<details class="action-details"><summary>补传${slot === 'issued' ? '原票' : '红冲'}凭证</summary>${h.form('replace-file', { id, version: invoice.version, slot }, h.upload() + h.reason('补传原因'), '保存补传凭证', id, h.path(category, id))}</details>`;
  } else if (!invoice.replacedById && ['red', 'rejected'].includes(invoice.status)) {
    const why = blocker(summary, category === 'goods' && invoice.status === 'rejected' && !invoice.replacesId);
    html += why ? h.note(why, true) : h.panel(invoice.status === 'red' ? '申请净额重开' : '修改重提', h.form(invoice.status === 'red' ? 'reapply' : 'resubmit', { id, version: invoice.version }, h.title(invoice, category), invoice.status === 'red' ? '提交净额重开申请' : '修改后重提', id, h.path(category)));
  }
  html += h.panel('办理记录', `<ol class="timeline">${[...(invoice.history || [])].reverse().map(x => `<li><span>${h.e(x.action)} · ${h.d(x.at)} · v${h.e(x.version)}</span><p>${h.e(x.actor?.role)} · ${h.e(x.actor?.id || '')} · ${h.e(STATUS[x.status] || x.status || '')}</p>${x.reason ? `<p>${h.e(x.reason)}</p>` : ''}${x.amount != null ? `<p>当时金额：${h.m(x.amount)}</p>` : ''}</li>`).join('')}</ol>`);
  return html;
}

