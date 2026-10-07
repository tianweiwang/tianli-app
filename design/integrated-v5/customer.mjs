import { privacyUiView } from './privacy-ui.mjs';
import { servicePromotionUi } from './service-promotion-ui.mjs';
import { assertAccountCommand } from './staff-accounts.mjs';
import { assertJob } from './management.mjs';
import { privacyProfile, privacyUseClosed } from './privacy.mjs';
import { closedRightsUiView } from './privacy-closed-rights-ui.mjs';
import { closedRightsDetailsUiView } from './privacy-closed-details-ui.mjs';
import { closedRightsTransactionsUiView } from './privacy-closed-transactions-ui.mjs';
import { techHistoricalRightsUi, techHistoricalRightsEntry } from './tech-historical-rights-ui.mjs';
/** User-facing views. All mutations are dispatched by the application to the engine. */
import { bookingView, bookingCanHelp } from './booking.mjs';
import { BOOKING_PAGES, bookingHome, bookingWizard, bookingPayment, bookingManage } from './booking-ui.mjs';
import { closurePanels } from './closure-ui.mjs';
import { invoiceView, invoiceBookingPanel } from './invoice-ui.mjs';
import { renderServiceFinanceExtras } from './service-finance-extras-ui.mjs';
import { reviewUiView, reviewBookingPanel } from './review-ui.mjs';
import { careView, careBookingPanel } from './care-ui.mjs';
import { handoffUiView, handoffBookingPanel } from './service-handoff-ui.mjs';
import { availableStock } from './engine.mjs';
import { goodsOrderExtras, goodsCaseExtras } from './goods-exceptions-ui.mjs';
import { commerceInvoiceView, goodsInvoicePanel } from './commerce-invoice-ui.mjs';
import { fulfilmentUiView, fulfilmentBookingPanel } from './fulfilment-ui.mjs';
const GOODS_STATUS = { unpaid: '待付款', paid: '待发货', shipped: '待收货', received: '已收货', closed: '已关闭', cancelled: '已取消' };
const PAYMENT_STATUS = { unpaid: '未付款', pending: '未付款', failed: '支付失败', processing: '支付结果确认中', success: '支付成功', paid: '支付成功', closed: '支付已关闭' };
const CASE_STATUS = { requested: '等待集团受理', pending: '等待集团受理', approved: '已受理', rejected: '已拒绝', appealing: '申诉处理中', appealed: '申诉处理中', awaiting_return: '等待寄回', returning: '退货运输中', returned: '等待验收', inspecting: '等待验收', inspected: '验收完成', partial_received: '部分收到，待集团协商', partial_confirmation: '部分验货方案待确认', inspection_disputed: '验收存在分歧', inspection_review: '集团复核验收中', awaiting_return_disposition: '方案已同意，等待仓储处置', awaiting_return_to_customer: '原货等待返还', return_to_customer_shipping: '原货返还运输中', refund_pending: '等待退款', refund_ready: '等待退款', refunding: '退款处理中', refund_failed: '退款失败，待重试', refunded: '退款完成', done: '售后完成', completed: '售后完成', closed: '售后已关闭' };

function query(ui) {
  if (ui.query instanceof URLSearchParams) return Object.fromEntries(ui.query);
  return ui.query || {};
}

function helpers(ui) {
  const esc = ui.esc || (value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
  const money = ui.money || (value => `¥${(Number(value || 0) / 100).toFixed(2)}`);
  const date = ui.date || (value => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—');
  const link = (label, path, cls = '') => ui.link(label, path, cls);
  const button = (label, command, payload = {}, cls = 'primary') => ui.button(label, command, payload, cls);
  const payload = value => esc(JSON.stringify(value));
  const form = (command, data, body, cls = 'stack', next = '') => `<form class="${esc(cls)}" data-command="${esc(command)}" data-payload="${payload(data)}"${next ? ` data-next="${esc(next)}"` : ''}>${body}</form>`;
  const submit = (text, cls = 'primary') => `<button type="submit" class="${esc(cls)}">${esc(text)}</button>`;
  const field = (label, name, value = '', type = 'text', attrs = '') => ui.field(label, name, value, type, attrs);
  const select = (label, name, options, value) => ui.select(label, name, options, value);
  const tag = (label, tone = '') => ui.tag(label, tone);
  const head = (title, subtitle = '', action = '') => `<header class="page-head"><div><h1>${esc(title)}</h1>${subtitle ? `<p class="muted">${esc(subtitle)}</p>` : ''}</div>${action}</header>`;
  const panel = (title, body, cls = '') => `<section class="panel ${esc(cls)}">${title ? `<h2>${esc(title)}</h2>` : ''}${body}</section>`;
  const empty = (title, text, action = '') => `<section class="panel empty"><h2>${esc(title)}</h2><p class="muted">${esc(text)}</p>${action}</section>`;
  const row = (label, value, cls = '') => `<div class="row ${esc(cls)}"><span class="muted">${esc(label)}</span><span>${value}</span></div>`;
  const notice = (text, tone = '') => `<div class="notice ${esc(tone)}">${esc(text)}</div>`;
  return { esc, money, date, link, button, form, submit, field, select, tag, head, panel, empty, row, notice };
}

function image(sku, h, cls = 'product-image') {
  return sku.image ? `<img class="${h.esc(cls)}" src="${h.esc(sku.image)}" alt="${h.esc(sku.name)}" loading="lazy">` : `<div class="${h.esc(cls)} product-placeholder">${h.esc(sku.name.slice(0, 2))}</div>`;
}

function sourceInfo(s, actor, h) {
  const source = s.promotions?.[actor.userId];
  const valid = source && Number(s.now) - Number(source.at) < Number(s.settings.sourceHours) * 3600000;
  const store = valid && s.stores.find(item => item.id === source.storeId && !item.promotionDisabled);
  return { source: store ? source : null, store, text: store ? `${store.name}推荐` : '自主选购', expired: !!source && !valid };
}

function cartData(s, actor) {
  return (s.carts?.[actor.userId] || []).map(item => ({ ...item, sku: s.skus.find(sku => sku.id === item.skuId) })).filter(item => item.sku);
}

function productCard(s, sku, h) {
  const stock = availableStock(s, sku.id);
  return `<article class="product-card">${h.link(image(sku, h), `/user/product/${sku.id}`, 'product-image-link')}<div class="product-info"><h3>${h.link(h.esc(sku.name), `/user/product/${sku.id}`)}</h3><p class="muted">${h.esc(sku.spec)}</p><div class="row"><strong class="amount">${h.money(sku.priceCents)}</strong>${h.tag(stock > 0 ? '有货' : '暂时售罄', stock > 0 ? '' : 'warning')}</div></div></article>`;
}

function mall(s, actor, ui, h) {
  const q = query(ui);
  const term = String(q.q || '').trim().toLowerCase();
  const category = String(q.category || 'all');
  const names = [...new Set(s.skus.filter(item => item.active).map(item => item.category).filter(Boolean))];
  const categories = [...(s.categories || [])].filter(item => item.active && names.includes(item.name)).sort((a,b) => Number(a.sort) - Number(b.sort) || a.id.localeCompare(b.id)).map(item => item.name);
  categories.push(...names.filter(name => !categories.includes(name) && !(s.categories || []).some(item => item.name === name)));
  const products = s.skus.filter(item => item.active && (!term || `${item.name} ${item.spec}`.toLowerCase().includes(term)) && (category === 'all' || item.category === category));
  const source = sourceInfo(s, actor, h);
  return h.head('天俪商城', '集团统一销售与配送', h.link('购物车', '/user/cart', 'secondary')) +
    `<div class="row source-bar"><span>${h.esc(source.text)}</span>${source.source ? h.button('清除推广来源', 'promotion.clear', {}, 'text-link') : ''}</div>` +
    h.form('ui.filter', { path: '/user/mall', category }, `<div class="search-row">${h.field('搜索商品', 'q', q.q || '', 'search', 'placeholder="输入商品名称"')}${h.submit('搜索', 'secondary')}</div>`, 'search-form') +
    (categories.length ? `<nav class="filter-tabs" aria-label="商品分类">${[{ id: 'all', name: '全部' }, ...categories.map(id => ({ id, name: id }))].map(item => h.link(item.name, `/user/mall?category=${encodeURIComponent(item.id)}&q=${encodeURIComponent(q.q || '')}`, category === item.id ? 'active' : '')).join('')}</nav>` : '') +
    (products.length ? `<div class="product-grid">${products.map(item => productCard(s, item, h)).join('')}</div>` : h.empty('没有找到商品', '试试其他关键词或分类。', h.link('查看全部商品', '/user/mall', 'secondary')));
}

function product(s, actor, id, h) {
  const sku = s.skus.find(item => item.id === id && item.active);
  if (!sku) return h.head('商品详情') + h.empty('商品暂不可查看', '商品不存在或已下架。', h.link('返回商城', '/user/mall', 'secondary'));
  const variants = s.skus.filter(item => item.active && item.productId === sku.productId);
  const stock = availableStock(s, sku.id);
  const inCart = cartData(s, actor).find(item => item.skuId === sku.id)?.qty || 0;
  return h.head('商品详情', '', h.link('购物车', '/user/cart', 'secondary')) +
    `<section class="panel product-detail">${image(sku, h, 'product-hero')}<div class="row"><strong class="amount price-large">${h.money(sku.priceCents)}</strong>${h.tag('集团直发')}</div><h2>${h.esc(sku.name)}</h2><p class="muted">${h.esc(sku.description || '精选日常用品。商品信息与售后处理以本订单记录为准。')}</p>${(s.products?.find(p=>p.id===sku.productId)?.gallery||[]).map(src=>`<img class="product-hero" src="${h.esc(src)}" alt="${h.esc(sku.name)}详情">`).join('')}</section>` +
    h.panel('选择规格', `<nav class="variant-list" aria-label="商品规格">${variants.map(item => h.link(item.spec, `/user/product/${item.id}`, item.id === id ? 'active' : '')).join('')}</nav><p class="muted">可用库存 ${h.esc(stock)} 件${inCart ? ` · 购物车已有 ${inCart} 件` : ''}</p>` +
      (stock > 0 ? h.form('cart.set', { skuId: sku.id }, h.field('购物车数量', 'qty', Math.max(1, inCart), 'number', `min="1" max="${stock}" step="1" required`) + h.submit(inCart ? '更新购物车' : '加入购物车')) : h.notice('此规格暂时售罄，请选择其他规格。'))) +
    h.panel('配送与售后', `<p>集团统一发货，收货地址在提交订单前确认。商品售后由集团受理。</p><p class="muted">运费 ${h.money(s.settings.shippingCents)}，提交前显示完整应付金额。</p>`) + h.link('返回商城', '/user/mall', 'text-link');
}

function cart(s, actor, h) {
  const items = cartData(s, actor);
  if (!items.length) return h.head('购物车') + h.empty('购物车还是空的', '挑选商品后，在这里一起结算。', h.link('去商城逛逛', '/user/mall', 'primary'));
  const total = items.reduce((sum, item) => sum + item.sku.priceCents * item.qty, 0);
  return h.head('购物车', `${items.length} 种商品`) + items.map(item => h.panel('', `<div class="line-item">${image(item.sku, h, 'line-image')}<div class="line-content"><h3>${h.link(h.esc(item.sku.name), `/user/product/${item.sku.id}`)}</h3><p class="muted">${h.esc(item.sku.spec)}</p><strong class="amount">${h.money(item.sku.priceCents)}</strong></div></div>` +
    h.form('cart.set', { skuId: item.skuId }, `<div class="quantity-row">${h.field('数量', 'qty', item.qty, 'number', `min="1" max="${availableStock(s, item.skuId)}" step="1" required`)}${h.submit('更新', 'secondary')}${h.button('移除', 'cart.set', { skuId: item.skuId, qty: 0 }, 'text-link')}</div>`) +
    (item.quotedCents !== item.sku.priceCents ? h.notice(`加入时${h.money(item.quotedCents)}，现价${h.money(item.sku.priceCents)}。请核对后点“更新”确认新价格。`, 'warning') : '') +
    (!item.sku.active || item.qty > availableStock(s, item.skuId) ? h.notice(!item.sku.active ? '商品已下架，请移除后结算。' : '当前库存不足，请调整数量。', 'warning') : ''))).join('') +
    h.panel('', h.row('商品合计', `<strong class="amount">${h.money(total)}</strong>`) + `<p class="muted">运费将在确认订单时计算。</p>${h.link('确认订单', '/user/checkout', 'primary full')}`);
}

function checkout(s, actor, h) {
  const items = cartData(s, actor);
  if (!items.length) return h.head('确认订单') + h.empty('暂无待结算商品', '请先把商品加入购物车。', h.link('返回商城', '/user/mall', 'primary'));
  const addresses = s.addresses.filter(item => item.userId === actor.userId);
  const amount = items.reduce((sum, item) => sum + item.sku.priceCents * item.qty, 0);
  const source = sourceInfo(s, actor, h);
  return h.head('确认订单', '请核对商品、收货地址与应付金额') +
    h.panel('商品清单', items.map(item => `<div class="line-item">${image(item.sku, h, 'line-image')}<div class="line-content"><h3>${h.esc(item.sku.name)}</h3><p class="muted">${h.esc(item.sku.spec)} × ${item.qty}</p></div><strong>${h.money(item.sku.priceCents * item.qty)}</strong></div>`).join('')) +
    h.panel('收货与付款', addresses.length ? h.form('goods.submit', { requestId: `checkout-${actor.userId}-${s.seq}`, expectedSourceId: source.source?.sourceId || '' },
      h.select('收货地址', 'addressId', addresses.map(address => ({ value: address.id, label: `${address.name} ${address.phone} · ${address.province}${address.city}${address.detail}` })), addresses[0].id) +
      h.link('新增或编辑地址', '/user/addresses', 'text-link') + h.row('商品金额', h.money(amount)) + h.row('配送费', h.money(s.settings.shippingCents)) + h.row('应付合计', `<strong class="amount">${h.money(amount + s.settings.shippingCents)}</strong>`) +
      h.row('商品推广来源', h.esc(source.text)) + (source.expired ? h.notice('此前推广记录已过有效期，本次按自主选购提交。') : '') + h.submit('提交订单')) : h.empty('请先填写收货地址', '商品将配送至你确认的地址。', h.link('新增地址', '/user/addresses/new', 'primary'))) +
    h.notice('提交后请在规定时间内付款。未支付关闭后，所占商品库存会释放。');
}

function addresses(s, actor, id, h) {
  const list = s.addresses.filter(item => item.userId === actor.userId);
  if (id) {
    const address = id === 'new' ? null : list.find(item => item.id === id);
    if (id !== 'new' && !address) return h.head('收货地址') + h.empty('地址不可查看', '请从自己的地址列表重新选择。', h.link('返回地址列表', '/user/addresses', 'secondary'));
    return h.head(address ? '编辑收货地址' : '新增收货地址') + h.panel('', h.form('address.save', address ? { id: address.id } : {},
      h.field('收货人', 'name', address?.name || '', 'text', 'required maxlength="30" autocomplete="name"') +
      h.field('手机号', 'phone', address?.phone || '', 'tel', 'required pattern="1[0-9]{10}" maxlength="11" inputmode="numeric" autocomplete="tel"') +
      h.field('省份', 'province', address?.province || '', 'text', 'required maxlength="30"') + h.field('城市', 'city', address?.city || '', 'text', 'required maxlength="30"') +
      h.field('详细地址', 'detail', address?.detail || '', 'text', 'required maxlength="120" placeholder="区县、街道、门牌号" autocomplete="street-address"') + h.submit('保存地址'), 'stack', cartData(s, actor).length ? '/user/checkout' : '/user/addresses')) + h.link('返回地址列表', '/user/addresses', 'text-link');
  }
  return h.head('收货地址', '仅当前用户可见', h.link('新增', '/user/addresses/new', 'secondary')) +
    (list.length ? list.map(address => h.panel('', `<div class="row"><h3>${h.esc(address.name)} <small>${h.esc(address.phone)}</small></h3>${h.link('编辑', `/user/addresses/${address.id}`, 'text-link')}</div><p>${h.esc(address.province + address.city + address.detail)}</p>`)).join('') : h.empty('还没有收货地址', '新增地址后即可提交商品订单。', h.link('新增地址', '/user/addresses/new', 'primary'))) + (cartData(s, actor).length ? h.link('返回确认订单', '/user/checkout', 'secondary full') : h.link('返回我的', '/user/me', 'secondary full'));
}

function goodsList(s, actor, ui, h) {
  const status = query(ui).status || 'all';
  const orders = s.goods.filter(item => item.userId === actor.userId && (status === 'all' || item.status === status)).slice().sort((a, b) => b.createdAt - a.createdAt);
  return h.head('商品订单', '集团销售与售后') + `<nav class="filter-tabs" aria-label="订单状态">${[['all', '全部'], ['unpaid', '待付款'], ['paid', '待发货'], ['shipped', '待收货'], ['received', '已收货']].map(([value, label]) => h.link(label, `/user/goods?status=${value}`, status === value ? 'active' : '')).join('')}</nav>` +
    (orders.length ? orders.map(order => h.panel('', `<div class="row"><span class="order-number">${h.esc(order.id)}</span>${h.tag(GOODS_STATUS[order.status] || order.status)}</div>${order.lines.map(line => `<div class="order-line"><strong>${h.esc(line.name)}</strong><span class="muted">${h.esc(line.spec)} × ${line.qty}</span></div>`).join('')}<div class="row"><strong>${h.money(order.paidCents)}</strong>${h.link('查看订单', `/user/goods/${order.id}`, 'secondary')}</div>`)).join('') : h.empty('暂无此类商品订单', '购买后的商品订单会出现在这里。', h.link('去商城', '/user/mall', 'primary')));
}

function caseProgress(s, actor, order, item, h, ui) {
  const refund = (order.refunds || []).find(value => value.caseId === item.id);
  const status = item.status || 'requested';
  const allocations = item.allocations?.length ? item.allocations : item.skuId ? [{ skuId: item.skuId, qty: item.qty, amountCents: item.amountCents }] : [];
  const products = allocations.map(part => {
    const line = order.lines.find(value => value.skuId === part.skuId);
    return h.row('售后商品', h.esc(`${line?.name || '历史商品'} · ${line?.spec || '规格未记录'} · SKU ${part.skuId} · ${part.qty || 0} 件`)) + h.row('该商品申请退款', h.money(part.amountCents || 0));
  }).join('');
  let actions = '';
  if (['approved', 'awaiting_return'].includes(status) && item.kind === 'return' && !item.returnShipment && !item.shipment && !item.tracking) actions += h.form('goods.return', { id: order.id, caseId: item.id }, h.field('退货快递', 'carrier', '', 'text', 'required placeholder="如：顺丰速运" maxlength="30"') + h.field('退货单号', 'tracking', '', 'text', 'required maxlength="40"') + h.submit('提交退货单号'));
  if (['rejected', 'inspection_disputed'].includes(status)) actions += h.form('goods.appeal', { id: order.id, caseId: item.id }, h.field('申诉说明', 'reason', '', 'text', 'required minlength="2" maxlength="200" placeholder="请说明需要复核的原因"') + h.submit('申请复核', 'secondary'));
  if (status === 'inspection_disputed') actions += h.notice('货物暂由集团仓储保管。你可以申请复核，或接受本次拒退并取回原货。') + h.form('goods.return-back-accept', { id: order.id, caseId: item.id, version: item.version || 0 }, h.field('接受拒退的确认说明', 'reason', '', 'text', 'required minlength="2" maxlength="300"') + h.submit('接受拒退，申请返还原货', 'secondary'));
  if (status === 'return_to_customer_shipping') actions += h.form('goods.return-back-receive', { id: order.id, caseId: item.id, version: item.version || 0 }, h.field('原货收取确认说明', 'reason', '', 'text', 'required minlength="2" maxlength="300"') + h.submit('确认收回原货'));
  const shipment = item.returnShipment || item.shipment;
  return h.panel(`售后 ${item.id}`, h.row('当前进度', h.tag(status === 'awaiting_return_disposition' && !item.partialReceipt ? '客服已同意，等待仓储处置' : CASE_STATUS[status] || status, status === 'rejected' ? 'warning' : '')) + h.row('类型', h.esc({ cancel: '未发货取消', return: '退货退款', refund: '退款' }[item.kind] || item.kind)) +
    (products || h.row('售后范围', '仅运费')) + h.row('申请商品退款', h.money(item.amountCents ?? item.refundCents ?? 0)) + h.row('申请运费退款', h.money(item.shippingCents || 0)) +
    (item.reason ? `<p class="muted">申请原因：${h.esc(item.reason)}</p>` : '') + (item.reviewReason ? h.notice(`处理说明：${item.reviewReason}`) : '') +
    (item.inspectionDecision ? h.row('客服复核决定', item.inspectionDecision.decision === 'approve' ? '同意退货退款' : '拒绝退货退款') + `<p class="muted">裁决依据：${h.esc(item.inspectionDecision.reason)}</p><p class="small muted">${h.esc(item.inspectionDecision.job === 'all' ? '集团管理员' : '集团客服')} · ${h.date(item.inspectionDecision.at)}</p>` : '') +
    (item.dispositionReason ? `<p class="muted">仓储处置说明：${h.esc(item.dispositionReason)}</p>` : '') +
    (shipment ? h.row('退货物流', h.esc(`${shipment.carrier || ''} ${shipment.tracking || ''}`)) : '') +
    (item.backShipment ? h.row('返还原货物流', h.esc(`${item.backShipment.carrier} ${item.backShipment.tracking}`)) + h.row('返还运费承担', item.backShipment.feePayer === 'group' ? '集团承担' : '用户承担（按双方约定）') + `<p class="muted">返还约定：${h.esc(item.backShipment.agreement)}</p>` : '') +
    (refund ? h.row('资金状态', h.tag({ success: '已原路退回', failed: '退款失败，集团待处理', processing: '退款结果确认中', pending: '等待退款' }[refund.status] || refund.status, refund.status === 'failed' ? 'warning' : '')) + h.row('已退金额', h.money(refund.status === 'success' ? refund.amountCents : 0)) : '') + goodsCaseExtras(s, actor, order, item, ui) + actions);
}

function goodsDetail(s, actor, id, h, ui) {
  const order = s.goods.find(item => item.id === id && item.userId === actor.userId);
  if (!order) return h.head('商品订单') + h.empty('无法查看该订单', '订单不存在，或不属于当前用户。', h.link('返回我的订单', '/user/goods', 'secondary'));
  const payment = order.payment || {};
  const cases = order.cases || [];
  const openCase = cases.some(item => !['rejected', 'refunded', 'completed', 'closed', 'done'].includes(item.status));
  let actions = '';
  if (order.status === 'unpaid') {
    if (payment.status === 'processing') actions = h.notice('支付结果尚未确认，请查询原笔结果，不要重复付款。', 'warning') + `<div class="actions">${h.button('查询支付成功', 'goods.payment-query', { id, outcome: 'success' })}${h.button('查询支付失败', 'goods.payment-query', { id, outcome: 'failed' }, 'secondary')}</div>`;
    else actions = `<div class="actions">${h.button('立即付款', 'goods.pay', { id, outcome: 'success' })}${h.button('关闭订单', 'goods.close', { id }, 'secondary')}</div><details class="simulation"><summary>模拟其他支付结果</summary><div class="actions">${h.button('模拟支付失败', 'goods.pay', { id, outcome: 'failed' }, 'secondary')}${h.button('模拟结果确认中', 'goods.pay', { id, outcome: 'processing' }, 'secondary')}</div></details>`;
  } else if (order.status === 'shipped') actions = h.button('确认收货', 'goods.receive', { id }, 'primary full');
  const refunded = (order.refunds || []).filter(item => item.status === 'success').reduce((sum, item) => sum + Number(item.amountCents || 0), 0);
  const activeCases = cases.filter(item => !['rejected', 'done', 'closed'].includes(item.status));
  const refundableShipping = Math.max(0, order.shippingCents - cases.filter(item => !['rejected', 'closed'].includes(item.status)).reduce((sum, item) => sum + Number(item.shippingCents || 0), 0));
  let aftersales = '';
  if (order.status === 'paid' && !openCase) aftersales = h.panel('取消与退款', h.form('goods.case', { id, kind: 'cancel', version: order.version || 0 }, h.field('取消原因', 'reason', '', 'text', 'required maxlength="200" placeholder="请填写取消原因"') + h.submit('申请取消订单', 'secondary')));
  if (['shipped', 'received'].includes(order.status)) {
    const eligible = order.lines.map(line => {
      const heldAmount = activeCases.reduce((sum, item) => sum + (item.allocations || []).filter(part => part.skuId === line.skuId).reduce((amount, part) => amount + Number(part.amountCents || 0), 0), 0);
      const heldQty = activeCases.filter(item => item.kind === 'return' && !item.inspectedAt && item.skuId === line.skuId).reduce((sum, item) => sum + Number(item.qty || 0), 0);
      return { line, amount: Math.max(0, line.paidCents - (line.refundedCents || 0) - heldAmount), refundQty: Math.max(0, line.qty - (line.cancelledQty || 0)), returnQty: Math.max(0, line.qty - (line.cancelledQty || 0) - (line.returnedQty || 0) - heldQty) };
    }).filter(item => item.amount > 0 && item.refundQty > 0);
    if (eligible.length) aftersales = h.panel('申请商品售后', `<p class="muted">按商品逐项申请，处理中售后仅占用对应商品的金额和退货件数，其他商品可继续申请。</p>${eligible.map(({ line, amount, refundQty, returnQty }) => `<details class="aftersale-item"><summary>${h.esc(line.name)} · ${h.esc(line.spec)}</summary><p class="muted">尚可申请商品退款 ${h.money(amount)}，尚可退回实物 ${returnQty} 件。</p>${[
      ...(returnQty > 0 ? [{ kind: 'return', label: '退货退款', qty: returnQty }] : []), { kind: 'refund', label: '仅退款（需集团核实）', qty: refundQty }
    ].map(option => `<details class="action-details"><summary>${option.label}</summary>${h.form('goods.case', { id, skuId: line.skuId, kind: option.kind },
      h.field('申请数量', 'qty', 1, 'number', `min="1" max="${option.qty}" step="1" required`) +
      h.field('商品退款金额（元）', 'amountYuan', (Math.min(line.unitCents, amount) / 100).toFixed(2), 'number', `min="0.01" max="${(Math.min(amount, line.unitCents * option.qty) / 100).toFixed(2)}" step="0.01" required`) +
      h.field('申请退回运费（元）', 'shippingYuan', '0.00', 'number', `min="0" max="${(refundableShipping / 100).toFixed(2)}" step="0.01" required`) + `<p class="muted">更改数量后，请核对金额；退款不得超过所选数量的实付金额。仅退款不增加退货件数，运费由集团核实。</p>` +
      h.field('申请原因', 'reason', '', 'text', 'required maxlength="200"') + h.submit('提交售后申请', 'secondary'))}</details>`).join('')}</details>`).join('')}`);
  }
  if (['shipped', 'received'].includes(order.status) && refundableShipping > 0) aftersales += h.panel('运费售后', `<p class="muted">如仅需申请退回运费，可单独提交，由集团核实处理。运费退款不改变商品件数。</p>` +
    h.form('goods.case', { id, kind: 'refund', amountCents: 0 }, h.field('申请退回运费（元）', 'shippingYuan', (refundableShipping / 100).toFixed(2), 'number', `min="0.01" max="${(refundableShipping / 100).toFixed(2)}" step="0.01" required`) + h.field('运费退款原因', 'reason', '', 'text', 'required maxlength="200"') + h.submit('提交运费退款申请', 'secondary')));
  return h.head('商品订单', order.id, h.link('全部订单', '/user/goods', 'text-link')) + h.panel('', `<div class="row"><h2>${h.esc(GOODS_STATUS[order.status] || order.status)}</h2>${h.tag(PAYMENT_STATUS[payment.status] || payment.status || '未付款')}</div>${order.status === 'unpaid' ? `<p class="muted">付款截止 ${h.date(order.deadline)}</p>` : ''}${actions}`) +
    h.panel('商品与金额', order.lines.map(line => `<div class="order-line"><div><strong>${h.esc(line.name)}</strong><p class="muted">${h.esc(line.spec)} × ${line.qty}${line.cancelledQty ? ` · 已取消 ${h.esc(line.cancelledQty)} 件` : ''}${line.returnedQty ? ` · 已退回 ${h.esc(line.returnedQty)} 件` : ''}</p></div><strong>${h.money(line.paidCents)}</strong></div>`).join('') + h.row('配送费', h.money(order.shippingCents)) + h.row('订单金额', `<strong>${h.money(order.paidCents)}</strong>`) + h.row('累计退款', h.money(refunded)) + h.row('商品推广来源', h.esc(order.source ? order.source.storeName || s.stores.find(item => item.id === order.source.storeId)?.name || '门店推荐' : '自主选购'))) +
    h.panel('配送信息', `<p><strong>${h.esc(order.address.name)}</strong> ${h.esc(order.address.phone)}</p><p>${h.esc(`${order.address.province}${order.address.city}${order.address.detail}`)}</p>${order.shipment ? h.row('发货物流', h.esc(`${order.shipment.carrier} ${order.shipment.tracking}`)) : '<p class="muted">暂无发货物流</p>'}`) +
    cases.map(item => caseProgress(s, actor, order, item, h, ui)).join('') + aftersales + goodsOrderExtras(s, actor, order, ui) + goodsInvoicePanel(s,order,actor,ui) +
    h.panel('订单记录', `<ol class="timeline">${(order.events || []).slice().reverse().map(event => `<li><span>${h.esc(event.text || event.message || event.action || '')}</span><time>${h.date(event.at || event.time)}</time></li>`).join('') || '<li>订单已创建</li>'}</ol>`);
}

function my(s, actor, h) {
  const user = s.users.find(item => item.id === actor.userId);
  const goods = s.goods.filter(item => item.userId === actor.userId);
  const bookings = s.bookings.filter(item => item.userId === actor.userId);
  return h.head('我的') + h.panel('', `<h2>${h.esc(user?.name || '当前用户')}</h2><p class="muted">预约和商品订单分别查询，进度随时可见。</p>`) +
    `<div class="shortcut-grid">${h.link(`<strong>我的预约</strong><span>${bookings.length} 笔预约</span>`, '/user/bookings', 'shortcut')}${h.link(`<strong>商品订单</strong><span>${goods.length} 笔订单</span>`, '/user/goods', 'shortcut')}</div>` +
    h.panel('', `<nav class="menu-list">${h.link('隐私与注销', '/user/privacy')}${h.link('服务对象', '/user/recipients')}${h.link('我的评价', '/user/reviews')}${h.link('投诉与反馈', '/user/care')}${h.link('服务发票', '/user/invoices')}${h.link('商品发票', '/user/commodity-invoices')}${h.link('收货地址', '/user/addresses')}${h.link('购物车', '/user/cart')}${h.link('预约项目', '/user/booking')}</nav>`);
}

function bookingList(s, actor, ui, h) {
  const status = query(ui).status || 'all';
  const list = bookingView(s, actor).filter(item => status === 'all' || item.status === status).sort((a, b) => b.createdAt - a.createdAt);
  return h.head('我的预约', '安排、进度与售后都在这里', h.link('新预约', '/user/booking', 'secondary')) +
    `<nav class="filter-tabs" aria-label="预约状态">${[['all', '全部'], ['waiting', '待确认'], ['confirmed', '已确认'], ['active', '进行中'], ['done', '已完成']].map(([value, label]) => h.link(label, `/user/bookings?status=${value}`, status === value ? 'active' : '')).join('')}</nav>` +
    (list.length ? list.map(item => {
      const service = item.serviceSnapshot || s.services.find(value => value.id === item.serviceId);
      const store = item.storeSnapshot || s.stores.find(value => value.id === item.storeId);
      const tech = item.techSnapshot || s.techs.find(value => value.id === item.techId);
      return h.panel('', `<div class="row"><h3>${h.esc(service?.name || '预约项目')}</h3>${h.tag(item.displayStatus)}</div><p>${h.date(item.startAt)}</p><p class="muted">${h.esc(store?.name)} · ${h.esc(tech?.name || '等待安排')}</p><div class="row"><strong>${h.money(item.priceCents)}</strong>${h.link('查看预约', `/user/booking/${item.id}`, 'secondary')}</div>`);
    }).join('') : h.empty('暂无此类预约', '选择项目、技师和时间后即可预约。', h.link('预约项目', '/user/booking', 'primary')));
}

function bookingRefunds(booking, h) {
  const labels = { requested: '等待门店处理', offered: '待确认协商方案', approved: '等待原路退款', processing: '退款结果确认中', failed: '退款失败，待重试', success: '退款成功', rejected: '申请已拒绝', escalated: '集团处理中', withdrawn: '申请已撤销' };
  return (booking.refunds || []).map(refund => {
    let actions = '';
    if (refund.status === 'offered') actions += h.button('接受协商金额', 'booking.refund-answer', { id: booking.id, refundId: refund.id, version: refund.version, decision: 'accept' });
    const reviewOpen = !refund.final && !!refund.deadline;
    if (refund.status === 'offered' || (refund.status === 'rejected' && reviewOpen)) actions += h.button('申请集团介入', 'booking.refund-answer', { id: booking.id, refundId: refund.id, decision: 'escalate' }, 'secondary');
    if (refund.kind !== 'interruption' && (['requested', 'offered', 'escalated'].includes(refund.status) || (refund.status === 'rejected' && reviewOpen))) actions += h.button('撤销申请', 'booking.refund-answer', { id: booking.id, refundId: refund.id, decision: 'withdraw' }, 'text-link');
    return h.panel('预约退款', h.row('进度', h.tag(labels[refund.status] || refund.status, refund.status === 'failed' ? 'warning' : '')) + h.row('退款金额', h.money(refund.amountCents || 0)) + (refund.version ? h.row('处理版本', `第 ${h.esc(refund.version)} 版`) : '') + `<p class="muted">${h.esc(refund.reviewReason || refund.reason)}</p>` +
      (refund.lines?.length ? refund.lines : refund.requests || []).map(line => { const execution = refund.executions?.find(x => x.paymentId === line.paymentId); return h.row(line.paymentId === booking.payment.id ? '主预约' : '加时子单', h.money(line.amountCents) + (execution && ['approved','processing','failed','success'].includes(refund.status) ? ` · ${h.esc(labels[execution.status] || execution.status)}` : '')); }).join('') + (actions ? `<div class="actions">${actions}</div>` : ''));
  }).join('');
}

function bookingDetail(s, actor, id, h, ui) {
  const booking = bookingView(s, actor).find(item => item.id === id);
  if (!booking) return h.head('预约详情') + h.empty('无法查看该预约', '预约不存在，或不属于当前用户。', h.link('返回我的预约', '/user/bookings', 'secondary'));
  const service = booking.serviceSnapshot || s.services.find(item => item.id === booking.serviceId);
  const store = booking.storeSnapshot || s.stores.find(item => item.id === booking.storeId);
  const tech = booking.techSnapshot || s.techs.find(item => item.id === booking.techId);
  const payment = booking.payment;
  let actions = '';
  if (booking.status === 'unpaid') {
    if (payment.status === 'processing') actions = h.notice('请查询原笔支付结果，避免重复付款。', 'warning') + h.button('查询原笔支付结果', 'ui.booking-query', { id }, 'primary full');
    else actions = h.button('确认并支付', 'ui.booking-pay', { id }, 'primary full');
  }
  let change = '';
  if (booking.change?.status === 'pending') {
    const proposal = booking.change;
    const nextTech = s.techs.find(item => item.id === proposal.techId);
    change = h.panel(proposal.kind === 'reassign' ? '请确认技师调整' : '请确认改约方案', h.row('当前安排', h.esc(`${tech?.name || ''} · ${h.date(booking.startAt)}`)) + h.row('新安排', h.esc(`${nextTech?.name || ''} · ${h.date(proposal.startAt)}`)) + `<p class="muted">${h.esc(proposal.reason)}</p><p class="muted">确认截止：${h.date(proposal.expiresAt)}</p>` + h.notice(proposal.kind === 'reassign' ? '拒绝本次指定技师调整，将取消预约并原路退款。' : '拒绝本次改约，保留原预约安排。') + `<div class="actions">${h.button('接受新安排', 'booking.change-answer', { id, changeId: proposal.id, decision: 'accept' })}${h.button('拒绝调整', 'booking.change-answer', { id, changeId: proposal.id, decision: 'reject' }, 'secondary')}</div>`);
  }
  const extensions = (booking.extensions || []).map(extension => h.panel('加时预约', h.row('加时时长', `${extension.duration} 分钟`) + h.row('加时金额', h.money(extension.amountCents)) + h.row('支付状态', h.tag(PAYMENT_STATUS[extension.status] || (extension.status === 'expired' ? '已超时关闭' : extension.status))) +
    (['unpaid', 'failed'].includes(extension.status) ? `<div class="actions">${h.button('支付加时', 'booking.extension-pay', { id, extensionId: extension.id, outcome: 'success' })}</div><details class="simulation"><summary>模拟其他加时支付结果</summary><div class="actions">${h.button('模拟支付失败', 'booking.extension-pay', { id, extensionId: extension.id, outcome: 'failed' }, 'secondary')}${h.button('模拟结果确认中', 'booking.extension-pay', { id, extensionId: extension.id, outcome: 'processing' }, 'secondary')}</div></details>` : extension.status === 'processing' ? `<div class="actions">${h.button('查询加时成功', 'booking.extension-query', { id, extensionId: extension.id, outcome: 'success' })}${h.button('查询加时失败', 'booking.extension-query', { id, extensionId: extension.id, outcome: 'failed' }, 'secondary')}</div>` : ''))).join('');
  let management = '';
  if (['unpaid', 'waiting', 'confirmed'].includes(booking.status) && !booking.startedAt) management += h.panel('预约调整', `<nav class="menu-list">${h.link('取消预约', `/user/booking/${id}/cancel`)}${['waiting', 'confirmed'].includes(booking.status) && !booking.userReschedules && booking.change?.status !== 'pending' ? h.link('修改预约时间', `/user/booking/${id}/reschedule`) : ''}</nav>`);
  if (payment.status === 'success' || booking.status === 'unpaid') management += h.panel('门店协助', `<nav class="menu-list">${h.link('联系门店', `/user/booking/${id}/contact-store`)}</nav>`);
  if (['done', 'cancelled', 'closed'].includes(booking.status)) management += h.panel('再次预约', '<p class="muted">沿用原门店与项目，重新选择时间并核对当前价格、技师和预约信息。</p>' + h.button('再次预约', 'ui.booking-repeat', { id }, 'secondary full'));
  if (booking.status === 'active') management += h.panel('申请加时', h.button(`申请加时 ${booking.serviceSnapshot?.extensionMinutes || 30} 分钟`, 'booking.extension-create', { id, requestId: `extension-${id}-${s.seq}` }, 'secondary full') + `<p class="muted">须有可用后续时段，最多加时两次。提交后请在 5 分钟内完成付款。</p>`);
  if (bookingCanHelp(s, booking, actor)) management += h.panel('联系安全值班', h.form('booking.help', { id }, h.field('求助说明', 'reason', '', 'text', 'required maxlength="200" placeholder="请说明需要协助的情况"') + h.submit('联系门店处理', 'secondary')));
  const safety = s.safety.filter(item => item.bookingId === id && item.status === 'open');
  if (safety.length) management += h.panel('求助处理中', safety.map(item => `<p>${h.esc(item.reason)}</p><p class="muted">${h.date(item.createdAt)} 已提交 · ${h.esc(({pending:'等待接报',acknowledged:'值班人员已接报',escalated:'已升级集团',unanswered:'升级后仍未响应'})[item.stage] || '正在处理')}。</p><p>如有紧急人身危险，请直接报警。</p><a class="secondary" href="tel:110">拨打110</a>`).join(''));
  if (booking.status === 'done' && Number(s.now) <= Number(booking.completedAt) + 48 * 3600000 && !(booking.refunds || []).some(item => !['success', 'withdrawn', 'rejected'].includes(item.status))) {
    const payments = [payment, ...(booking.extensions || [])].filter(item => item.status === 'success' && item.amountCents > (item.refundedCents || 0));
    if (payments.length) management += h.panel('申请预约售后', h.form('booking.refund-request', { id }, `<p class="muted">请分别填写需要退回的金额，不申请的项目填 0。门店会核对实际履约情况。</p>` + payments.map(item => h.field(item.id === payment.id ? '主预约退款金额（元）' : `加时退款金额（元） · ${item.id}`, `refundAmount:${item.id}`, '0', 'number', `min="0" max="${((item.amountCents - (item.refundedCents || 0)) / 100).toFixed(2)}" step="0.01"`)).join('') + h.field('售后原因', 'reason', '', 'text', 'required maxlength="200"') + h.submit('提交售后申请', 'secondary')));
  }
  return h.head('预约详情', booking.id, h.link('我的预约', '/user/bookings', 'text-link')) +
    h.panel('', `<div class="row"><h2>${h.esc(booking.displayStatus)}</h2>${h.tag(booking.fundStatus)}</div>${booking.status === 'waiting' && booking.round ? `<p class="muted">本轮安排截止 ${h.date(booking.round.deadline)}</p>` : ''}${booking.status === 'unpaid' ? `<p class="muted">付款截止 ${h.date(booking.paymentDeadline)}</p>` : ''}${actions}`) + change +
    h.panel(service?.name || '预约项目', h.row('预约时间', h.date(booking.startAt)) + h.row('预约总时长', `${booking.totalDuration} 分钟`) + h.row('服务门店', h.esc(store?.name)) + h.row('具体技师', h.esc(tech?.name || '未安排')) + h.row('安排方式', booking.mode === 'specified' ? '指定技师' : '就近推荐') + h.row('联系人', h.esc(`${booking.contactName} ${booking.phone}`)) + h.row('主预约金额', `<strong>${h.money(booking.priceCents)}</strong>`) + h.row('累计支付', h.money(booking.paidCents)) + h.row('累计退款', h.money(booking.refundedCents))) + extensions + bookingRefunds(booking, h) + management + closurePanels(s, booking, actor, ui) + invoiceBookingPanel(s, booking, actor, ui) + reviewBookingPanel(s, booking, actor, ui) + careBookingPanel(s, actor, booking, ui) + handoffBookingPanel(s, actor, booking.id, ui) + fulfilmentBookingPanel(s,actor,booking.id,ui) + ((s.serviceRefundShortages||[]).some(x=>x.bookingId===booking.id&&x.userId===actor.userId)?renderServiceFinanceExtras(s,actor,'shortages','',{bookingId:booking.id}):'') +
    h.panel('预约记录', `<ol class="timeline">${(booking.events || []).filter(event => !/^(技师提成规则已固定|接单时未配置技师提成规则)/.test(event.text || '')).slice().reverse().map(event => `<li><span>${h.esc(event.text || event.message || '')}</span><time>${h.date(event.at || event.time)}</time></li>`).join('') || '<li>预约已创建</li>'}</ol>`);
}

export function customerView(s, actor, route = [], ui) {
  const h = helpers(ui);
  if (actor.role !== 'user' || !s.users.some(user => user.id === actor.userId)) return h.empty('请选择用户', '选择演示用户后，可查看本人的预约与商品订单。');
  const page = route[0] || 'home';
  const canCommand=command=>{try{assertAccountCommand(actor,command);assertJob(actor,command);return true;}catch{return false;}};
  if (privacyUseClosed(s, actor.userId)) {
    if (page === 'rights') return closedRightsUiView(s, actor, route, ui);
    if (['privacy', 'home', 'me'].includes(page)) return privacyUiView(s, actor, ['privacy'], ui);
    const transactions=closedRightsTransactionsUiView(s, actor, route, ui, {canCommand});
    if(transactions!==null)return transactions;
    return closedRightsDetailsUiView(s, actor, route, ui, {canCommand});
  }
  if (privacyProfile(s, actor.userId).status !== 'active') return privacyUiView(s, actor, ['privacy'], ui);
  if(page==='tech-rights') return techHistoricalRightsUi(s,actor,route,ui,{canCommand});
  if(page==='service-promotion') return servicePromotionUi(s,route,actor,ui,{canCommand});
  const commerceInvoices = commerceInvoiceView(s,route,actor,ui); if(commerceInvoices!==null) return commerceInvoices;
  const fulfilment = fulfilmentUiView(s,actor,route,ui); if(fulfilment!==null) return fulfilment;
  if (page === 'privacy') return privacyUiView(s, actor, route, ui);
  if (['recipients', 'handoffs'].includes(page)) return handoffUiView(s, actor, route, ui);
  if (page === 'reviews') return reviewUiView(s, actor, route, ui);
  if (page === 'care') return careView(s, actor, route, ui);
  if (page === 'invoices') return invoiceView(s, route, actor, ui);
  if (page === 'home') return bookingHome(s, actor, ui, h);
  if (page === 'mall') return mall(s, actor, ui, h);
  if (page === 'product') return product(s, actor, route[1], h);
  if (page === 'cart') return cart(s, actor, h);
  if (page === 'checkout') return checkout(s, actor, h);
  if (page === 'addresses') return addresses(s, actor, route[1], h);
  if (page === 'goods') return route[1] ? goodsDetail(s, actor, route[1], h, ui) : goodsList(s, actor, ui, h);
  if (page === 'bookings') return bookingList(s, actor, ui, h);
  if (page === 'booking') {
    if (!route[1] || BOOKING_PAGES.has(route[1])) return bookingWizard(s, actor, route, ui, h);
    if (route[2] === 'payment') return bookingPayment(s, actor, route[1], ui, h);
    if (['cancel', 'reschedule', 'contact-store'].includes(route[2])) return bookingManage(s, actor, route, ui, h);
    return bookingDetail(s, actor, route[1], h, ui);
  }
  if (page === 'me') return my(s, actor, h)+`<section class="panel"><h2>服务推广</h2>${h.link('个人佣金与邀请记录','/user/service-promotion/promoters')}${techHistoricalRightsEntry(s,actor,ui)}</section>`;
  return h.head('页面暂不可查看') + h.empty('入口不存在', '请返回首页继续操作。', h.link('返回首页', '/user/home', 'primary'));
}
