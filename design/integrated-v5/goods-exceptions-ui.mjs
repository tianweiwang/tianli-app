/** Read-only order panels. The engine owns every quantity, amount and transition. */
import { goodsLogisticsOrderPanel } from './goods-logistics-policy-ui.mjs';
const STATUS = { open: '集团待跟进', awaiting_user: '待用户确认方案', waiting: '等待原流程结果', done: '已按业务事实办结' };
const STAGE = { delivery: '商品配送', return: '退货寄回', 'return-back': '原货返还' };
const KIND = { delay: '配送延迟', lost: '运输丢失', damaged: '运输破损', 'not-returned': '尚未寄回', unclaimed: '返还无人签收', 'wrong-item': '商品错发', 'receipt-dispute': '签收争议' };
const TYPED_DELIVERY = new Set(['wrong-item', 'receipt-dispute']);
const CLAIM = { 'not-received': '本人未收到货物', 'unauthorized-recipient': '非本人授权签收', 'partial-delivery': '实际收到数量不完整' };
const VERIFY = { confirmed: '已核实原主张', 'not-confirmed': '未证实原主张', inconclusive: '尚不能确定，继续核实' };
const verificationReady = i => ['confirmed', 'not-confirmed'].includes(i.verifications?.at(-1)?.conclusion);
const byLabel = a => a ? `${a.accountId || a.id || '未记录'} · ${a.job || a.role || '未记录'}` : '未记录';
const RESOLUTION = { continue: '继续原配送或寄回流程', refund: '按关联售后办理退款', 'return-back': '返还仓储保管的原货' };
const TERMINAL = new Set(['rejected', 'closed', 'done', 'refunded', 'completed', 'withdrawn']);
const CASE_STAGE = { requested: '待受理', awaiting_return: '待寄回', returning: '寄回运输中', partial_received: '部分实收待协商', partial_confirmation: '方案待确认', inspection_disputed: '验收有分歧', inspection_review: '待客服复核', awaiting_return_disposition: '待实物处置', awaiting_return_to_customer: '待返还原货', return_to_customer_shipping: '原货返还运输中', refund_ready: '待退款', refunding: '退款处理中', refund_failed: '退款失败待重试' };

function helpers(ui) {
  const e = ui.esc || (v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
  const m = ui.money || (v => `¥${(Number(v || 0) / 100).toFixed(2)}`);
  const d = ui.date || (v => v ? new Date(v).toLocaleString('zh-CN', { hour12: false }) : '—');
  const f = ui.field;
  const select = (label, name, options, value = '') => `<label class="field"><span>${e(label)}</span><select name="${e(name)}">${options.map(([id, text]) => `<option value="${e(id)}"${String(id) === String(value) ? ' selected' : ''}>${e(text)}</option>`).join('')}</select></label>`;
  const form = (command, payload, body, label, kind = 'secondary') => `<form class="stack" data-command="${e(command)}" data-payload="${e(JSON.stringify(payload))}"><div class="form-grid">${body}</div><div class="actions"><button type="submit" class="${e(kind)}">${e(label)}</button></div></form>`;
  const panel = (title, body) => `<section class="panel"><h2>${e(title)}</h2>${body}</section>`;
  const detail = (title, body) => `<details class="action-details"><summary>${e(title)}</summary><div class="stack">${body}</div></details>`;
  const note = (text, tone = '') => `<div class="notice ${e(tone)}" role="status">${e(text)}</div>`;
  const row = (label, text) => `<div class="row"><span class="muted">${e(label)}</span><span>${e(text)}</span></div>`;
  const reason = (label = '处理说明') => f(label, 'reason', '', 'text', 'required minlength="2" maxlength="500"');
  return { e, m, d, f, select, form, panel, detail, note, row, reason };
}
function dateInput(value) { return value ? new Date(Number(value) + 8 * 3600000).toISOString().slice(0, 16) : ''; }
function access(actor, order) { return actor.role === 'user' ? order.userId === actor.userId : actor.role === 'group' || ['store', 'manager'].includes(actor.role) && order.source?.storeId === actor.storeId; }
function can(actor, command, options) { return actor.role === 'group' && !!options?.canCommand?.(command); }
const version = value => Number.isSafeInteger(value?.version) ? value.version : 0;
const caseOriginal = c => c.originalRequestSnapshot || c;

function incidentOpen(s, actor, order, ui, options, h) {
  if (!can(actor, 'goods.incident-open', options)) return '';
  const contexts = [];
  if (['shipped', 'received'].includes(order.status) && order.shipment) contexts.push({ stage: 'delivery', caseId: null, title: '登记商品配送问题', kinds: order.status === 'received' ? ['damaged'] : ['delay', 'lost', 'damaged'] });
  for (const c of order.cases || []) {
    if (c.kind === 'return' && ['awaiting_return', 'returning', 'partial_received', 'partial_confirmation'].includes(c.status)) contexts.push({ stage: 'return', caseId: c.id, title: `登记退货寄回问题 · ${c.id}`, kinds: !c.returnShipment ? c.status === 'awaiting_return' ? ['not-returned'] : ['delay', 'lost', 'damaged', 'not-returned'] : ['delay', 'lost', 'damaged'] });
    if (c.status === 'return_to_customer_shipping') contexts.push({ stage: 'return-back', caseId: c.id, title: `登记原货返还问题 · ${c.id}`, kinds: ['delay', 'lost', 'damaged', 'unclaimed'] });
  }
  let html = contexts.map(context => h.detail(context.title, h.form('goods.incident-open', { id: order.id, stage: context.stage, ...(context.caseId ? { caseId: context.caseId } : {}), version: version(order) },
    h.select('异常类型', 'kind', context.kinds.map(id => [id, KIND[id]]), context.kinds[0]) + h.reason('异常事实与诉求') + (actor.role === 'group' ? h.f('人工跟进时间（选填）', 'dueAt', '', 'datetime-local') : ''), '提交异常登记'))).join('');
  if (contexts.some(x => x.stage === 'delivery')) for (const kind of TYPED_DELIVERY) {
    const lines = (order.lines || []).filter(l => l.qty > (l.cancelledQty || 0));
    const specific = kind === 'wrong-item' ? h.select('原订单应发商品', 'skuId', lines.map(l => [l.skuId, `${l.name} · ${l.spec}`]), lines[0]?.skuId || '') + h.f('报告错发数量', 'qty', '', 'number', 'required min="1" step="1"') + h.f('实际收到货物说明', 'actualItem', '', 'text', 'required maxlength="1000"') : h.select('签收争议主张', 'receiptClaim', Object.entries(CLAIM), 'not-received');
    html += h.detail(`登记${KIND[kind]}`, h.note('按真实发生事实登记，客服核实后再发送处理方案。登记不会改变收货、库存或款项。') + h.form('goods.incident-open', { id: order.id, stage: 'delivery', kind, version: version(order) }, specific + h.f('异常实际发生时间', 'occurredAt', '', 'datetime-local', 'required') + h.f('异常证据 / 凭据说明', 'evidence', '', 'text', 'required maxlength="1000"') + h.reason('异常事实与诉求') + h.f('人工跟进时间（选填）', 'dueAt', '', 'datetime-local'), '登记事实并交客服核实'));
  }
  return html;
}

function incidents(s, actor, order, ui, options, h) {
  const list = order.incidents || [];
  const store = ['store', 'manager'].includes(actor.role);
  if (store) return list.length ? h.panel('商品异常进度', h.note('集团负责处理；本店可跟踪进度与佣金变化。') + list.map(i => `<article class="case-card">${h.row('异常记录', i.id)}${h.row('阶段', STAGE[i.stage] || i.stage)}${h.row('当前进度', STATUS[i.status] || i.status)}</article>`).join('')) : '';
  let body = list.map(i => {
    if (TYPED_DELIVERY.has(i.kind) && actor.role === 'group' && actor.job && !['all', 'support', 'warehouse'].includes(actor.job)) return `<article class="case-card">${h.row('异常记录', i.id)}${h.row('阶段', STAGE[i.stage] || i.stage)}${h.row('当前进度', STATUS[i.status] || i.status)}</article>`;
    const payload = { id: order.id, incidentId: i.id, version: version(i) };
    const proposal = i.proposal;
    let html = `<article class="case-card"><div class="row"><h3>${h.e(i.id)}</h3><span class="tag">${h.e(STATUS[i.status] || i.status)}</span></div>${h.row('阶段与类型', `${STAGE[i.stage] || i.stage} · ${KIND[i.kind] || i.kind}`)}${i.caseId ? h.row('关联售后', i.caseId) : ''}<p>${h.e(i.reason)}</p>${h.row('记录版本', version(i))}${h.row('人工跟进时间', i.dueAt ? h.d(i.dueAt) : '未指定')}`;
    if (i.fact) {
      const f = i.fact;
      html += h.detail('原发生事实', h.row('实际发生', h.d(f.occurredAt)) + h.row('登记时间', h.d(f.recordedAt)) + h.row('实际记录人', byLabel(f.recordedBy)) + h.row('原运单', `${f.shipment?.carrier || ''} · ${f.shipment?.tracking || ''}`) + (f.skuId ? h.row('应发商品 / 报告数量', `${f.expectedName || f.skuId} · ${f.expectedSpec || ''} · ${f.qty} 件`) + h.row('实际货物说明', f.actualItem) : h.row('签收争议主张', CLAIM[f.receiptClaim] || f.receiptClaim)) + `<p>原事实证据：${h.e(f.evidence)}</p>`);
      if ((i.verifications || []).length) html += h.detail('人工核实记录', i.verifications.map(v => `<article>${h.row('核实结论', VERIFY[v.conclusion] || v.conclusion)}${h.row('核实实际发生', h.d(v.occurredAt))}${h.row('核实登记时间', h.d(v.recordedAt))}${h.row('核实人', byLabel(v.by))}<p>${h.e(v.reason)}</p><p>核实证据：${h.e(v.evidence)}</p></article>`).join(''));
      if (!verificationReady(i) && i.status !== 'done') html += h.note('客服尚未形成明确核实结论，处理方案待核实后确认。', 'warning');
      if (['open', 'waiting'].includes(i.status) && can(actor, 'goods.incident-verify', options)) html += h.detail('追加人工核实', h.form('goods.incident-verify', payload, h.select('核实结论', 'conclusion', Object.entries(VERIFY), 'inconclusive') + h.f('核实实际发生时间', 'occurredAt', '', 'datetime-local', 'required') + h.f('核实证据 / 凭据说明', 'evidence', '', 'text', 'required maxlength="1000"') + h.reason('核实说明'), '保存核实记录'));
      if ((i.receiptFacts || []).length) html += h.detail('本人实际收货记录', i.receiptFacts.map(r => `<article>${h.row('本人实际完整正确收货', h.d(r.occurredAt))}${h.row('登记时间 / 记录人', `${h.d(r.recordedAt)} · ${byLabel(r.by)}`)}<p>${h.e(r.reason)}</p><p>收货依据：${h.e(r.evidence)}</p></article>`).join(''));
    }
    if (i.dueAt && i.status !== 'done' && Number(i.dueAt) <= Number(s.now)) html += h.note('已到人工跟进时间，请继续核实。订单、库存及退款结果按原流程记录。', 'warning');
    if (proposal) html += h.row('当前方案', RESOLUTION[proposal.resolution] || proposal.resolution) + (proposal.caseId ? h.row('方案关联售后', proposal.caseId) : '') + `<p>方案依据：${h.e(proposal.reason)}</p>` + h.row('用户确认', ({ pending: '等待确认', accepted: '已同意', rejected: '已拒绝' })[proposal.status] || proposal.status || '等待确认') + (proposal.confirmationReason ? `<p class="small muted">确认说明：${h.e(proposal.confirmationReason)}</p>` : '');
    if ((i.records || []).length) html += h.detail('异常跟进记录', `<ol class="timeline">${i.records.map(r => `<li><p>${h.e(r.action || '')}${r.reason || r.text ? ` · ${h.e(r.reason || r.text)}` : ''}</p><time>${h.e(r.at ? h.d(r.at) : '')}</time></li>`).join('')}</ol>`);
    if ((i.proposalHistory || []).length) html += h.detail('历史协商方案', i.proposalHistory.map(p => `<article><p>${h.e(RESOLUTION[p.resolution] || p.resolution)} · ${h.e(p.reason)}</p><p class="small muted">${h.e(({ accepted: '已同意', rejected: '已拒绝', pending: '待确认' })[p.status] || p.status || '')}</p></article>`).join(''));
    if (i.status !== 'done' && can(actor, 'goods.incident-note', options)) html += h.detail('记录跟进事实', h.form('goods.incident-note', payload, h.reason('本次跟进事实') + h.f('人工跟进时间（选填，清空可取消提醒）', 'dueAt', dateInput(i.dueAt), 'datetime-local'), '保存跟进记录'));
    if (['open', 'waiting'].includes(i.status) && (!TYPED_DELIVERY.has(i.kind) || verificationReady(i)) && can(actor, 'goods.incident-propose', options)) {
      const cases = (order.cases || []).filter(c => c.kind !== 'cancel' && !TERMINAL.has(c.status) && (i.stage === 'delivery' || c.id === i.caseId));
      const resolutions = [['continue', RESOLUTION.continue], ...(cases.length ? [['refund', RESOLUTION.refund]] : []), ...(cases.some(c => c.kind === 'return' && ['awaiting_return_to_customer', 'return_to_customer_shipping'].includes(c.status)) ? [['return-back', RESOLUTION['return-back']]] : [])];
      html += h.detail('提出异常处理方案', h.note('退款或原货返还方案须关联原售后。用户同意后，继续在原退款或实物流程办理。') + h.form('goods.incident-propose', payload, h.select('处理方案', 'resolution', resolutions, 'continue') + h.select('关联原售后', 'caseId', [['', '继续流程无需新关联'], ...cases.map(c => [c.id, `${c.id} · ${c.kind === 'return' ? '退货退款' : '仅退款'} · ${CASE_STAGE[c.status] || '处理中'}`])], i.caseId || '') + h.reason('方案与协商依据'), '发送用户确认'));
    }
    if (actor.role === 'user' && i.status === 'awaiting_user') html += h.form('goods.incident-confirm', payload, h.select('确认异常方案', 'decision', [['accept', '同意此方案'], ['reject', '不同意，继续协调']], 'accept') + h.reason('确认意见'), '提交方案意见', 'primary');
    if (actor.role === 'user' && TYPED_DELIVERY.has(i.kind) && i.status === 'waiting' && proposal?.status === 'accepted' && proposal.resolution === 'continue' && verificationReady(i) && i.receiptFact?.proposalRevision !== proposal.revision) html += h.note('同意继续方案不代表已经收货。请按真实情况记录完整正确收到本单商品的时间和依据；原订单收货事实也须完成。') + h.form('goods.incident-receipt', payload, h.f('本人实际完整正确收货时间', 'occurredAt', '', 'datetime-local', 'required') + h.f('本人实际收货依据', 'evidence', '', 'text', 'required maxlength="1000"') + h.reason('实际收货说明'), '确认实际完整正确收到', 'primary');
    if (i.status === 'waiting') html += h.note('方案已确认，等待原配送、退货或退款流程的实际结果。');
    if (i.status === 'done') html += h.note('相关原流程事实已完成，异常进度已同步。');
    return html + '</article>';
  }).join('');
  body += incidentOpen(s, actor, order, ui, options, h);
  return body ? h.panel('物流与退货异常', h.note('异常登记和人工提醒用于跟进，资金与实物结果由原订单和售后流程记录。') + body) : '';
}

export function goodsOrderExtras(s, actor, order, ui, options = {}) {
  if (!access(actor, order)) return '';
  const h = helpers(ui), own = actor.role === 'user';
  let html = '';
  if (own && ['unpaid', 'paid'].includes(order.status) && !order.shipment) {
    const current = order.address || {};
    const addresses = (s.addresses || []).filter(a => a.userId === actor.userId && a.active !== false && !a.deletedAt && a.name && /^1\d{10}$/.test(a.phone || '') && a.province && a.city && a.detail && a.province === current.province && a.city === current.city && JSON.stringify(a) !== JSON.stringify(current));
    html += h.panel('发货前修改地址', h.note('请选择本人有效的同省同市地址。跨区域配送范围与费用需联系集团核实。') + (addresses.length ? h.form('goods.address-change', { id: order.id, version: version(order) }, h.select('改为本人收货地址', 'addressId', addresses.map(a => [a.id, `${a.name} · ${a.phone} · ${a.province}${a.city}${a.detail}`]), current.id || addresses[0].id), '保存收货地址') : `<p class="muted">暂无可用的同省同市地址。</p>`) + ui.link('管理本人收货地址', '/user/addresses', 'text-link'));
  }
  if ((own || actor.role === 'group') && (order.addressHistory || []).length) html += h.panel('收货地址变更记录', `<ol class="timeline">${order.addressHistory.map(item => { const a = item.to || item.address || item.after || {}; return `<li><p>${h.e(`${a.name || ''} ${a.phone || ''}`)}</p><p>${h.e([a.province, a.city, a.detail].filter(Boolean).join(' '))}</p><time>${h.e(item.at ? h.d(item.at) : '')}</time></li>`; }).join('')}</ol>`);
  if (own && order.status === 'paid') {
    const active = (order.cases || []).filter(c => !TERMINAL.has(c.status));
    const eligible = (order.lines || []).map(line => ({ line, qty: Math.max(0, line.qty - (line.cancelledQty || 0) - active.filter(c => c.kind === 'cancel' && c.status === 'requested').reduce((sum, c) => sum + (c.allocations || []).filter(a => a.skuId === line.skuId).reduce((total, a) => total + Number(a.qty || 0), 0), 0)), amount: line.paidCents - (line.refundedCents || 0) - active.reduce((sum, c) => sum + (c.allocations || []).filter(a => a.skuId === line.skuId).reduce((total, a) => total + Number(a.amountCents || 0), 0), 0) })).filter(x => x.qty > 0 && x.amount > 0);
    if (eligible.length) html += h.panel('按商品取消', h.note('集团核实后，仅取消所选商品数量；其余商品继续履约。退款按对应实付金额及原退款结果办理。') + eligible.map(({ line, qty }) => h.detail(`${line.name} · ${line.spec}`, h.form('goods.case', { id: order.id, kind: 'cancel', skuId: line.skuId, version: version(order) }, h.f('取消数量', 'qty', 1, 'number', `min="1" max="${qty}" step="1" required`) + h.reason('取消原因'), '申请取消这些商品'))).join(''));
  }
  return html + incidents(s, actor, order, ui, options, h) + goodsLogisticsOrderPanel(s, actor, order, ui, options);
}

export function goodsCaseExtras(s, actor, order, c, ui, options = {}) {
  if (!access(actor, order) || ['store', 'manager'].includes(actor.role)) return '';
  const h = helpers(ui), payload = { id: order.id, caseId: c.id, version: version(c) }, original = caseOriginal(c);
  let html = '';
  if (actor.role === 'user' && ['requested', 'awaiting_return'].includes(c.status) && !c.returnShipment && !c.shipment && !c.custody && !c.inspectedAt && !c.partialReceipt && !(order.refunds || []).some(r => r.caseId === c.id)) html += h.detail(c.kind === 'return' ? '撤回尚未寄回的申请' : '撤回尚未执行的申请', h.note('已有寄回、实物保管或退款事实时，须继续原售后流程处理。') + h.form('goods.case-withdraw', payload, h.reason('撤回原因'), '撤回此申请'));
  if (c.withdrawal) html += h.note(`用户已撤回申请：${c.withdrawal.reason || ''}`);
  if (c.partialReceipt) {
    html += h.row('原申请数量', `${original.qty || c.qty} 件`) + h.row('仓储累计实收', `${c.partialReceipt.qty} 件`) + h.row('尚未寄回', `${Math.max(0, Number(original.qty || c.qty) - Number(c.partialReceipt.qty))} 件`) + `<p class="muted">实收依据：${h.e(c.partialReceipt.evidence)}</p>`;
    if ((c.receipts || []).length) html += h.detail('逐次收件记录', c.receipts.map(r => `<article><p>${h.e(r.qty)} 件 · ${h.e(r.evidence)}</p><p class="small muted">${h.e(r.at ? h.d(r.at) : '')}</p></article>`).join(''));
    if (c.partialProposal) {
      const p = c.partialProposal;
      html += h.row('协商处置', p.resolution === 'return-back' ? '返还已收到的原货，本案不退款' : '按确认数量退款') + h.row('协商商品数量', `${p.qty} 件`) + h.row('协商商品退款', h.m(p.amountCents)) + h.row('协商运费退款', h.m(p.shippingCents)) + `<p>协商依据：${h.e(p.reason)}</p>` + h.row('用户意见', ({ pending: '待确认', accepted: '已同意', rejected: '不同意，继续协调' })[p.status] || p.status) + (p.confirmationReason ? `<p class="small muted">确认说明：${h.e(p.confirmationReason)}</p>` : '');
      if (p.resolution === 'return-back') html += h.note(`未寄回 ${Math.max(0, Number(original.qty || c.qty) - Number(c.partialReceipt.qty))} 件仍由您保留。本案不退款，可按剩余额度另申请售后。`);
      if (actor.role === 'user' && c.status === 'partial_confirmation') html += h.note(`同意后，未寄回的 ${Number(p.keptQty || 0)} 件由您继续保留，本案不退该部分金额；已实收原货按上述方案处置。`) + h.form('goods.partial-confirm', payload, h.select('确认部分验货方案', 'decision', [['accept', '同意此方案'], ['reject', '不同意，继续协调']], 'accept') + h.reason('确认意见'), '提交部分验货意见', 'primary');
    }
    if ((c.partialProposalHistory || []).length) html += h.detail('历史部分验货方案', c.partialProposalHistory.map(p => `<article><p>${h.e(p.qty)} 件 · ${h.e(h.m(p.amountCents))} · ${h.e(p.reason)}</p><p class="small muted">${h.e(({ accepted: '已同意', rejected: '已拒绝', pending: '待确认' })[p.status] || p.status || '')}</p></article>`).join(''));
    const refundMaxCents = Math.min(Number(original.amountCents || 0), Number(c.partialReceipt.qty || 0) * Number(order.lines.find(line => line.skuId === c.skuId)?.unitCents || 0));
    if (c.status === 'partial_received' && can(actor, 'goods.partial-propose', options)) html += h.detail('协商部分验货方案', h.note('方案覆盖本案全部实收货物。金额按本次协商填写；返还原货时商品及运费退款均填写0。用户确认后再执行实物处置。') + h.form('goods.partial-propose', payload, h.select('部分验货处理方式', 'resolution', [['refund', '按实收商品协商退款'], ['return-back', '返还实收原货，本案不退款']], 'refund') + h.f('协商数量（全部实收）', 'qty', c.partialReceipt.qty, 'number', `min="${c.partialReceipt.qty}" max="${c.partialReceipt.qty}" step="1" readonly required`) + h.f('协商商品退款（元）', 'amountCents', '', 'number', `min="0" max="${refundMaxCents / 100}" step="0.01" data-unit="yuan" required`) + h.f('协商运费退款（元）', 'shippingCents', '0.00', 'number', `min="0" max="${Number(original.shippingCents || 0) / 100}" step="0.01" data-unit="yuan" required`) + h.reason('协商依据'), '发送部分验货方案'));
  }
  const remaining = Number(original.qty || c.qty || 0) - Number(c.partialReceipt?.qty || 0);
  const receiptMax = c.partialReceipt ? remaining : Math.max(0, remaining - 1);
  if (c.kind === 'return' && ['returning', 'partial_received'].includes(c.status) && receiptMax > 0 && can(actor, 'goods.inspect-partial', options)) html += h.detail(c.partialReceipt ? '补记本次实收数量' : '部分收件登记', h.note('仅记录本次新增收件事实。入库、报损和退款在后续确认的原流程办理。') + h.form('goods.inspect-partial', payload, h.f('本次实收数量', 'qty', 1, 'number', `min="1" max="${receiptMax}" step="1" required`) + h.f('收件证据与说明', 'evidence', '', 'text', 'required minlength="2" maxlength="500"'), '登记本次实收'));
  return html;
}
