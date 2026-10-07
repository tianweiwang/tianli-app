/** V4 booking navigation, backed by the integrated domain and a per-user draft. */
import { bookingOptions, bookingSlots, bookingView } from './booking.mjs';
import { technicianReviewsPanel } from './review-ui.mjs';
import { bookingRecipientFields, bookingRecipientSummary } from './service-handoff-ui.mjs';

export const BOOKING_PAGES = new Set(['region', 'location', 'stores', 'store', 'service', 'tech', 'tech-detail', 'slots', 'contact', 'identity', 'identity-consent', 'health', 'confirm']);
const DAY = 86400000;
const localDate = value => new Date(Number(value) + 8 * 3600000).toISOString().slice(0, 10);
const truth = value => value === true || value === 'true' || value === 'on';
const description = service => service.description || (service.id === 'neck' ? '适合久坐后的日常放松' : '全身舒缓与日常放松');
const timeText = value => new Date(Number(value) + 8 * 3600000).toISOString().slice(11, 16);
const distanceText = value => Number.isFinite(Number(value)) ? `${Number(value).toFixed(1)} km` : '距离待确认';
const ratingText = tech => tech.count < 5 ? '新技师 · 评价不足 5 条' : `${tech.rating} 分 · ${tech.count} 条评价`;
const next = (h, label, patch, path, cls = 'primary') => h.button(label, 'ui.booking', { patch, next: path }, cls);
const disabled = (h, label, cls = 'primary') => `<button type="button" class="${h.esc(cls)}" disabled>${h.esc(label)}</button>`;
const field = (h, label, name, value, type = 'text', attrs = '') => h.field(label, name, value, type, `data-booking-field="${name}" ${attrs}`);
const check = (h, label, name, value) => `<label class="check-row booking-check"><input type="checkbox" name="${name}" value="true" data-booking-field="${name}" ${truth(value) ? 'checked' : ''} required><span>${h.esc(label)}</span></label>`;
const form = (h, path, body, patch = {}) => h.form('ui.booking', { patch, next: path }, body, 'stack booking-form');
const startPatch = (d, patch) => d.submittedId ? { restart: true, ...patch } : patch;
function draft(s, actor, ui) {
  const user = s.users.find(value => value.id === actor.userId);
  return { regionId: 'home', storeId: 'xingfu', serviceId: 'relax', mode: 'nearest', techId: '', genderPreference: 'any', date: localDate(s.now), startAt: '', contactName: user?.name || '', phone: user?.phone || '', ...ui.bookingDraft };
}
function meta(s, d) {
  const options = bookingOptions(s, d);
  return { options, store: d.storeSnapshot || s.stores.find(x => x.id === d.storeId), service: d.serviceSnapshot || s.services.find(x => x.id === d.serviceId), region: s.regions.find(x => x.id === d.regionId), tech: d.techSnapshot || s.techs.find(x => x.id === (d.id ? d.techId : options.selectedTechId || (d.mode === 'specified' ? d.techId : ''))) };
}
function head(h, title, back, step) {
  return `<header class="booking-head">${h.link('返回', back, 'booking-back')}<div><h1>${h.esc(title)}</h1>${step ? `<p>第 ${step} 步 · 共 5 步</p>` : ''}</div></header>`;
}
function footer(h, body, note = '') { return `<section class="panel booking-footer">${note ? `<p class="booking-footer-note">${h.esc(note)}</p>` : ''}${body}</section>`; }
function wrap(body) { return `<div class="booking-flow">${body}</div>`; }
function compactSummary(s, d, h, includeContact = false) {
  const { store, service, tech } = meta(s, d);
  return h.panel(service?.name || '预约信息', h.row('预约门店', h.esc(store?.name || '尚未选择')) + h.row('具体技师', h.esc(tech?.name || '请先选择可约时间')) + h.row('安排方式', d.mode === 'specified' ? '指定技师' : '就近安排') + h.row('预约时间', d.startAt ? h.date(Number(d.startAt)) : '尚未选择') + h.row('预约时长', service ? `${service.duration} 分钟` : '—') + (includeContact ? h.row('联系人', h.esc(`${d.contactName || ''} ${d.phone || ''}`)) : ''));
}
function serviceRows(s, d, h, excludeCurrent = false) {
  const store = s.stores.find(x => x.id === d.storeId);
  return s.services.filter(item => item.active !== false && store?.serviceIds?.includes(item.id) && (!excludeCurrent || item.id !== d.serviceId)).map(item => `<article class="booking-service-row"><div class="booking-service-mark ${item.id === 'neck' ? 'sage' : ''}">${h.esc(item.id === 'neck' ? '肩颈' : item.id === 'relax' ? '全身' : '项目')}<small>舒缓</small></div><div class="booking-grow"><div class="booking-name-line"><h3>${h.link(h.esc(item.name), `/user/booking?store=${encodeURIComponent(d.storeId)}&service=${encodeURIComponent(item.id)}`)}</h3>${h.tag(`${item.duration}分钟`)}</div><p>${h.esc(description(item))}</p><div class="booking-price-row"><span><strong class="amount">${h.money(item.priceCents)}</strong><small>日间总价</small></span>${next(h, '预约', startPatch(d, { serviceId: item.id, mode: 'nearest' }), '/user/booking/tech')}</div></div></article>`).join('');
}
function techRows(options, d, h, onlyAvailable = false) {
  const list = onlyAvailable ? options.candidates.filter(t => t.available) : options.candidates;
  return list.map(t => `<article class="booking-tech-row"><span class="booking-avatar">${h.esc(t.name.slice(0, 1))}</span><div class="booking-grow"><div class="booking-name-line"><h3>${h.esc(t.name)}</h3>${d.mode === 'specified' && d.techId === t.id ? h.tag('已选', 'success') : ''}</div><p>${distanceText(t.distanceKm)} · ${h.esc(ratingText(t))}</p><p class="${t.available ? 'booking-available' : 'muted'}">${h.esc(t.available ? '可查看预约时间' : t.reason || '当前不可约')}</p><div class="booking-tech-links">${h.link('查看档案', `/user/booking/tech-detail?tech=${encodeURIComponent(t.id)}`, 'text-link')}</div></div>${t.available ? next(h, d.mode === 'specified' && d.techId === t.id ? '已选' : '选择', startPatch(d, { mode: 'specified', techId: t.id }), '/user/booking/slots', 'secondary') : disabled(h, '不可约', 'secondary')}</article>`).join('') || '<p class="muted">当前条件下暂无可约技师，请更换项目或技师偏好。</p>';
}
function cancellation(h) {
  return h.panel('取消规则', '<p>取消前会显示本次可退金额和扣费，请核对后再确认。</p><p class="muted">已经开始履约、存在待处理事项或无法自助取消时，请联系门店核实。</p>');
}
function staleSelection(s, d, h, page) {
  if (['region', 'location', 'stores'].includes(page)) return '';
  const m = meta(s, d);
  if (!m.store || !m.options.stores.some(x => x.id === d.storeId && x.covered && x.bookable)) return h.empty('请先选择可约门店', '当前门店暂无可约安排，或不在所选片区覆盖范围内。', h.link('选择门店', '/user/booking/stores', 'primary'));
  if (!['store', 'entry'].includes(page) && (!m.service || m.service.active === false || !m.store.serviceIds.includes(d.serviceId))) return h.empty('请先选择项目', '选择本店项目后，再查看技师和时间。', h.link('查看项目', '/user/booking/store', 'primary'));
  return '';
}
export function bookingHome(s, actor, ui, h) {
  const d = draft(s, actor, ui), m = meta(s, d);
  const available = bookingOptions(s, { ...d, startAt: '' });
  const current = m.options.stores.find(x => x.id === d.storeId);
  const bookings = s.bookings.filter(x => x.userId === actor.userId);
  return wrap(h.head('天俪', '按门店、项目、技师和时间预约') +
    h.panel('', `<div class="booking-row"><div class="booking-grow"><h3>${h.esc(m.region?.name || '请选择片区')}</h3><p class="muted">${d.locationMode === 'gps' ? '演示定位片区，优先显示附近可约' : '已选片区，可手动更换'}</p></div>${h.link('切换片区', '/user/booking/region', 'secondary')}</div>`) +
    h.panel('', `<div class="booking-row"><div class="booking-grow"><h3>${h.esc(m.store?.name || '请选择门店')}</h3><p class="muted">当前预约门店${current ? ` · ${distanceText(current.distanceKm)}` : ''}</p></div>${h.link('选门店', '/user/booking/stores', 'secondary')}</div>`) +
    (bookings.length ? `<div class="shortcut-grid">${h.link(`<strong>我的预约</strong><span>${bookings.length} 笔预约</span>`, '/user/bookings', 'shortcut')}${next(h, '新建预约', { restart: true }, '/user/booking/stores', 'secondary')}</div>` : '') +
    h.panel('预约项目', current?.covered && current.bookable ? serviceRows(s, d, h) : h.notice('当前片区暂无可约项目，请更换片区或门店。')) +
    h.panel('附近可约技师', techRows({ ...available, candidates: available.candidates.slice(0, 3) }, d, h, true)) +
    h.panel('天俪商城', `<div class="booking-row"><div class="booking-grow"><h3>日常好物</h3><p>集团统一销售与配送</p></div>${h.link('逛商城', '/user/mall', 'secondary')}</div><details><summary>查看门店推荐好物</summary><nav class="menu-list">${s.stores.filter(x => !x.promotionDisabled).map(x => h.link(h.esc(x.name), `/user/mall?ref=${encodeURIComponent(x.id)}`)).join('')}</nav></details>`));
}
export function bookingWizard(s, actor, route, ui, h) {
  const d = draft(s, actor, ui), page = route[1] || 'entry', m = meta(s, d), guard = staleSelection(s, d, h, page);
  if (page === 'confirm' && d.submittedId) return wrap(head(h, '本次预约已提交', '/user/home', 5) + h.notice('请从原预约查看支付和确认进度，避免重复提交。') + footer(h, h.link('查看本次预约', `/user/booking/${d.submittedId}`, 'primary full')));
  if (guard) return wrap(head(h, '预约项目', '/user/home', 1) + guard);
  const change = (label, patch, path, cls) => next(h, label, patch, path, cls);
  if (page === 'region') return wrap(head(h, '选择片区', '/user/home', 1) + h.notice('位置仅用于附近门店推荐和就近匹配。也可以手动选择片区。') + h.panel('', h.link('使用当前位置', '/user/booking/location', 'primary full')) + h.panel('手动选择片区', s.regions.map(r => `<div class="booking-row booking-divided"><div class="booking-grow"><h3>${h.esc(r.name)}</h3><p>${r.id === 'outside' ? '查看当前是否有可约门店' : '显示这个片区的附近推荐'}</p></div>${change(d.regionId === r.id ? '已选' : '选择', { regionId: r.id, locationMode: 'manual' }, '/user/booking/stores', 'secondary')}</div>`).join('')));
  if (page === 'location') return wrap(head(h, '位置使用说明', '/user/booking/region', 1) + h.panel('附近推荐', '<p>允许后，根据当前位置推荐附近门店和技师。暂不允许时，仍可手动选片区继续预约。</p><p class="muted">当前为本地演示，不读取设备位置；允许后使用幸福里片区作为演示位置。</p>') + footer(h, `<div class="actions">${change('暂不允许，手动选择', { locationMode: 'denied' }, '/user/booking/region', 'secondary')}${change('允许演示定位', { regionId: 'home', locationMode: 'gps' }, '/user/booking/stores')}</div>`));
  if (page === 'stores') {
    const stores = m.options.stores.filter(x => x.covered && x.bookable);
    return wrap(head(h, '选择门店', '/user/booking/region', 1) + h.notice(`当前片区：${m.region?.name || '未选择'}`) + (stores.length ? h.panel('附近门店', stores.map(store => `<div class="booking-row booking-divided"><div class="booking-grow"><h3>${h.esc(store.name)}</h3><p>${distanceText(store.distanceKm)} · 09:00–23:00</p><p>可预约 ${store.serviceIds.length} 个项目</p>${store.resumeAt ? `<p class="muted">当前暂停，可查看 ${h.date(store.resumeAt)} 起的预约时间</p>` : ''}</div>${change(d.storeId === store.id ? '已选' : '选择', { storeId: store.id }, '/user/booking/service', 'secondary')}</div>`).join('')) : h.empty('这个片区暂不可约', '当前没有可提供预约的门店，可更换片区查看。', h.link('更换片区', '/user/booking/region', 'primary'))) + footer(h, h.link('返回首页', '/user/home', 'secondary full')));
  }
  if (page === 'store' || page === 'entry') return wrap(head(h, page === 'store' ? '门店详情' : '预约项目', page === 'store' ? '/user/booking/stores' : '/user/home', 1) + h.panel(m.store.name, h.row('营业时间', '09:00–23:00') + (m.options.stores.find(x=>x.id===d.storeId)?.resumeAt ? h.notice(`当前暂停，可查看 ${h.date(m.options.stores.find(x=>x.id===d.storeId).resumeAt)} 起的预约时间。`) : '') + h.row('当前片区', h.esc(m.region?.name)) + h.row('预约确认', '由本店安排技师') + h.link('更换门店', '/user/booking/stores', 'text-link')) + h.panel('可约项目', serviceRows(s, d, h)) + h.panel('本店技师', techRows(bookingOptions(s, { ...d, startAt: '' }), d, h, true)));
  if (page === 'service') return wrap(head(h, '项目详情', '/user/booking/store', 1) + h.panel(m.service.name, `<p class="muted">${h.esc(description(m.service))} · ${m.service.duration} 分钟</p><p class="booking-price"><strong>${h.money(m.service.priceCents)}</strong><span>日间总价</span></p>` + h.row('预约门店', h.esc(m.store.name)) + h.row('夜间总价', h.money(m.service.nightCents)) + h.row('加时单位', `${m.service.extensionMinutes || 30} 分钟 / ${h.money(m.service.extensionCents || Math.round(m.service.priceCents / m.service.duration * (m.service.extensionMinutes || 30) / 100) * 100)}（日间）`)) + h.panel('服务说明', '<p>服务前确认身体情况与力度偏好，过程中可以随时反馈。本项目用于日常放松，不提供疾病诊断或治疗。</p>') + h.notice('21:00 起按夜间总价。选择时间时会显示完整价格。') + h.panel('其他可约项目', serviceRows(s, d, h, true)) + footer(h, change('选择技师', { mode: 'nearest', techId: '' }, '/user/booking/tech', 'primary full')));
  if (page === 'tech') {
    const options = bookingOptions(s, { ...d, startAt: '' });
    const canProceed = d.mode === 'nearest' ? options.candidates.some(t => t.available) : options.candidates.some(t => t.available && t.id === d.techId);
    return wrap(head(h, '选择技师', '/user/booking/service', 2) + h.panel('', h.row('门店', h.esc(m.store.name)) + h.row('项目', h.esc(m.service.name))) + h.panel('技师偏好', `<div class="booking-segment" aria-label="技师偏好">${[['any', '不限'], ['female', '女技师'], ['male', '男技师']].map(([genderPreference, label]) => change(label, { genderPreference }, '/user/booking/tech', genderPreference === d.genderPreference ? 'booking-choice selected' : 'booking-choice')).join('')}</div>`) + h.panel('', `<div class="booking-row"><div class="booking-grow"><h3>就近安排</h3><p>按所选片区与可约时间匹配</p></div>${change(d.mode === 'nearest' ? '已选' : '选择', { mode: 'nearest', techId: '' }, '/user/booking/slots', d.mode === 'nearest' ? 'booking-choice selected' : 'secondary')}</div><p class="muted">确认预约前会显示匹配的具体技师。</p>`) + h.panel('指定本店技师', techRows(options, d, h)) + footer(h, canProceed ? h.link('选择时间', '/user/booking/slots', 'primary full') : disabled(h, '请选择可约技师', 'primary full')));
  }
  if (page === 'tech-detail') {
    const q = ui.query instanceof URLSearchParams ? ui.query.get('tech') : ui.query?.tech;
    const t = bookingOptions(s, { ...d, startAt: '' }).candidates.find(x => x.id === (q || d.techId || m.options.selectedTechId));
    if (!t) return wrap(head(h, '技师档案', '/user/booking/tech', 2) + h.empty('请选择本店技师', '从技师列表查看资料。', h.link('返回技师列表', '/user/booking/tech', 'primary')));
    return wrap(head(h, '技师档案', '/user/booking/tech', 2) + h.panel('', `<div class="booking-row"><span class="booking-avatar large">${h.esc(t.name.slice(0, 1))}</span><div><h2>${h.esc(t.name)}</h2><p>${h.esc(m.store.name)} · ${distanceText(t.distanceKm)}</p><p>${h.esc(ratingText(t))}</p></div></div>`) + h.panel('培训与项目', h.row('可约项目', h.esc(s.services.filter(x => t.serviceIds.includes(x.id)).map(x => x.name).join('、'))) + h.row('培训与证书', '演示档案待补录')) + technicianReviewsPanel(s, t.id, ui) + footer(h, t.available ? change('预约这位技师', { mode: 'specified', techId: t.id }, '/user/booking/slots', 'primary full') : disabled(h, t.reason || '当前不可约', 'primary full')));
  }
  if (page === 'slots') {
    const dates = [];
    for (let i = 0; i <= 7; i++) { const value = localDate(s.now + i * DAY); dates.push({ value, label: `${value.slice(5).replace('-', '月')}日` }); }
    const selectedDate = d.date || dates[0].value, slots = bookingSlots(s, d, selectedDate), chosen = slots.find(x => x.startAt === Number(d.startAt) && x.available);
    return wrap(head(h, '选择时间', '/user/booking/tech', 3) + h.panel('', h.row('门店', h.esc(m.store.name)) + h.row('项目', `${h.esc(m.service.name)} · ${m.service.duration} 分钟`) + h.row('技师', d.mode === 'specified' ? h.esc(m.tech?.name || '尚未选择') : '就近安排，按时段匹配')) + h.panel('可约时间', `<div class="booking-date-tabs">${dates.map(x => change(x.label, { date: x.value }, '/user/booking/slots', x.value === selectedDate ? 'booking-date selected' : 'booking-date')).join('')}</div><label class="field"><span>预约日期</span><select name="date" data-booking-field="date" data-booking-refresh>${dates.map(x => `<option value="${x.value}" ${x.value === selectedDate ? 'selected' : ''}>${x.label}</option>`).join('')}</select></label><div class="booking-slots" aria-label="可约时段">${slots.map(slot => `<button type="button" class="booking-slot ${chosen?.startAt === slot.startAt ? 'selected' : ''}" ${slot.available ? `data-command="ui.booking" data-payload="${h.esc(JSON.stringify({ patch: { startAt: slot.startAt, date: selectedDate }, next: '/user/booking/slots' }))}"` : 'disabled'} title="${h.esc(slot.available ? `${slot.time} ${h.money(slot.priceCents)}` : slotDescription(slot))}"><span>${slot.time}</span><small>${slot.available ? h.money(slot.priceCents) : h.esc(slotReason(s, slot))}</small></button>`).join('')}</div>`) + h.notice(`最早可约 ${s.bookingRules?.earliestHours || 2} 小时后，最多可约 ${s.bookingRules?.maxDays || 7} 天内。21:00 起按夜间总价；灰色时段显示不可约原因。`) + (!slots.some(x => x.available) ? h.empty('当前日期暂无可约时间', '可以更换日期、偏好或技师。', h.link('更换技师', '/user/booking/tech', 'secondary')) : '') + footer(h, `${chosen ? `<div class="booking-selected"><div><strong>${selectedDate.slice(5)} ${chosen.time}</strong><span>${h.esc(s.techs.find(t => t.id === chosen.techId)?.name || '已匹配技师')} · ${d.mode === 'specified' ? '指定' : '就近安排'}</span></div><strong class="amount">${h.money(chosen.priceCents)}</strong></div>` : '<p class="muted">请先选择可约时段</p>'}${chosen ? h.link('填写联系人', '/user/booking/contact', 'primary full') : disabled(h, '请选择时间', 'primary full')}`));
  }
  if (['contact', 'identity', 'health', 'confirm'].includes(page) && (!d.startAt || !m.options.valid)) return wrap(head(h, '预约信息已变化', '/user/booking/slots', 3) + h.empty('请重新选择可约时间', m.options.error || '确认具体技师与时间后继续。', h.link('选择时间', '/user/booking/slots', 'primary')));
  if (page === 'contact') return wrap(head(h, '预约联系人', '/user/booking/slots', 4) + compactSummary(s, d, h) + h.panel('', form(h, truth(d.identityVerified) ? '/user/booking/health' : '/user/booking/identity', field(h, '联系人姓名', 'contactName', d.contactName, 'text', 'required autocomplete="name" maxlength="30"') + field(h, '联系手机号', 'phone', d.phone, 'tel', 'required pattern="1[0-9]{10}" maxlength="11" inputmode="numeric" autocomplete="tel"') + bookingRecipientFields(s, actor, d, h) + h.submit('保存并继续', 'primary full'))) + h.notice('可以为家人预约。请先确认服务对象的意愿及健康情况，使用方便联系到的手机号。'));
  if (page === 'identity') return wrap(head(h, '实名核验', '/user/booking/contact', 4) + h.notice('首次预约需要完成身份核验，并单独同意相关信息处理。') + h.panel('身份核验演示', `<p>当前使用虚构身份完成核验流程，不收集真实姓名和身份证号。</p><p class="muted">正式身份核验渠道尚未接入，本次操作只记录本地演示通过状态。</p>`) + h.panel('', form(h, '/user/booking/health', check(h, '我同意本次身份核验演示及其状态记录', 'identityConsent', d.identityConsent) + h.link('查看单独授权说明', '/user/booking/identity-consent', 'text-link') + h.submit('授权并完成演示核验', 'primary full'), { identityVerified: true })));
  if (page === 'identity-consent') return wrap(head(h, '实名信息授权', '/user/booking/identity', 4) + h.panel('单独授权说明', '<p>身份核验用于确认预约人身份。正式渠道接入后，需单独告知处理目的、信息范围、保留期限和撤回方式。</p><p>本 Demo 不收集身份证号，仅在当前浏览器保存“演示核验通过”和同意状态，不向技师或门店展示身份凭证。</p><p class="muted">可在“我的 → 隐私与注销”查看同意记录或撤回授权；撤回后新预约须重新明确授权，已有订单仍可办理售后。真实身份渠道及留存期限仍待接入验收。</p>') + footer(h, h.link('返回核验并确认', '/user/booking/identity', 'secondary full')));
  if (page === 'health') return wrap(head(h, '健康告知', truth(d.identityVerified) ? '/user/booking/contact' : '/user/booking/identity', 4) + h.panel('请确认服务对象适合本项目', '<p>本次接受保健服务的人须已满 18 周岁。以下情况暂不适合预约：</p><ul class="booking-health-list"><li>孕期</li><li>急性损伤或骨折未愈</li><li>皮肤破损或传染性皮肤病</li><li>发热</li><li>严重心脑血管疾病</li><li>饮酒后</li></ul><p class="muted">如情况不确定，请先咨询医生，再决定是否预约。服务不适时应及时告知技师。</p>') + h.panel('', form(h, '/user/booking/confirm', check(h, '我确认本次服务对象已满 18 周岁', 'adultConfirmed', d.adultConfirmed) + check(h, '我已了解告知，确认不属于以上禁忌人群', 'healthConsent', d.healthConsent) + h.submit('确认并继续', 'primary full'))));
  if (page === 'confirm') {
    if (d.submittedId) return wrap(head(h, '本次预约已提交', '/user/home', 5) + h.notice('请从原预约查看支付和确认进度，避免重复提交。') + footer(h, h.link('查看本次预约', `/user/booking/${d.submittedId}`, 'primary full')));
    const ready = !!d.recipientId && truth(d.recipientConfirmed) && !!d.contactName?.trim() && /^1\d{10}$/.test(d.phone || '') && ['adultConfirmed', 'healthConsent', 'identityVerified', 'identityConsent'].every(k => truth(d[k]));
    return wrap(head(h, '确认预约', '/user/booking/health', 5) + compactSummary(s, d, h, true) + bookingRecipientSummary(s, actor, d, h) + h.panel('预约总价', h.row('应付总价', `<strong class="amount">${h.money(m.options.priceCents)}</strong>`) + `<p class="muted">${timeText(d.startAt) >= '21:00' ? '当前为夜间总价' : '当前为日间总价'}，为本次项目完整价格。</p>`) + cancellation(h) + h.panel('预约前确认', h.row('成年与健康告知', truth(d.adultConfirmed) && truth(d.healthConsent) ? '已确认' : '未完成') + h.row('身份核验演示', truth(d.identityVerified) && truth(d.identityConsent) ? '已完成' : '未完成') + `<nav class="menu-list">${h.link('修改技师或时间', '/user/booking/tech')}${h.link('修改联系人', '/user/booking/contact')}${h.link('查看健康告知', '/user/booking/health')}</nav>`) + footer(h, ready ? h.button('确认并支付', 'ui.booking-submit', { expectedTechId: m.options.selectedTechId, expectedPriceCents: m.options.priceCents }, 'primary full') : disabled(h, '请先完成预约信息与告知', 'primary full'), '支付前将再次核对可约状态；付款成功后等待技师确认。'));
  }
  return wrap(head(h, '预约项目', '/user/home', 1) + h.empty('页面暂不可查看', '请从预约入口继续。', h.link('预约项目', '/user/booking', 'primary')));
}

export function bookingPayment(s, actor, id, ui, h) {
  const b = bookingView(s, actor).find(x => x.id === id);
  if (!b) return h.empty('无法查看该预约', '请从自己的预约列表重新进入。', h.link('我的预约', '/user/bookings', 'primary'));
  const status = b.payment.status, success = status === 'success', processing = status === 'processing';
  const title = success ? '支付成功' : processing ? '支付结果确认中' : ['cancelled', 'closed'].includes(b.status) ? '预约已关闭' : '支付未完成';
  const text = success ? (b.status === 'waiting' ? '等待技师确认预约；门店未能安排时会自动全额退款。' : '支付结果已确认，可查看最新预约进度。') : processing ? '正在核实原笔支付结果，请勿重复付款。' : b.status === 'unpaid' ? '当前预约与联系人已保留，可以继续支付。' : '本次预约无法继续支付，请重新选择可约时间。';
  const d = { ...b, regionId: b.regionId || 'home', date: localDate(b.startAt) };
  return wrap(head(h, '支付结果', `/user/booking/${id}`, 5) + h.panel('', `<div class="booking-result"><h2>${title}</h2><p>${text}</p></div>` + h.row('支付金额', h.money(b.priceCents)) + h.row('预约编号', h.esc(b.id))) + compactSummary(s, d, h, true) + footer(h, `<div class="stack">${processing ? h.button('查询原笔支付结果', 'ui.booking-query', { id }, 'primary full') : !success && b.status === 'unpaid' ? h.button('继续支付', 'ui.booking-pay', { id }, 'primary full') : ''}${h.link('查看预约', `/user/booking/${id}`, success ? 'primary full' : 'secondary full')}${h.link('返回首页', '/user/home', 'secondary full')}</div>`));
}

export function bookingManage(s, actor, route, ui, h) {
  const id = route[1], page = route[2], b = bookingView(s, actor).find(x => x.id === id);
  if (!b) return h.empty('无法查看该预约', '请从自己的预约列表重新进入。', h.link('我的预约', '/user/bookings', 'primary'));
  const back = `/user/booking/${id}`, summary = compactSummary(s, b, h, true);
  const activeRefund = b.refunds.some(r => ['requested', 'offered', 'approved', 'processing', 'failed', 'escalated'].includes(r.status));
  const blocked = !['unpaid', 'waiting', 'confirmed'].includes(b.status) || b.startedAt || b.departedAt || b.arrivedAt || b.change?.status === 'pending' || activeRefund || s.safety.some(x => x.bookingId === id && x.status === 'open');
  if (page === 'contact-store') return wrap(head(h, '联系门店', back, '') + summary + h.panel('请门店协助处理', b.payment?.status === 'success' ? '<p class="muted">提交后由预约门店跟进，回复会显示在预约详情中。</p>' + h.form('booking.assistance-request', { id }, h.field('需要协助的事项', 'reason', '', 'text', 'required maxlength="200" placeholder="请说明需要核实或处理的情况"') + h.submit('提交门店协助', 'primary full'), 'stack', back) : '<p>当前预约尚未支付，可返回预约查看进度。真实电话与客服渠道尚未接入。</p>'));
  if (page === 'cancel') {
    const payments = [b.payment, ...b.extensions].filter(x => x.status === 'success');
    const amount = payments.reduce((sum, p) => sum + p.amountCents - p.refundedCents, 0);
    const content = b.payment.status === 'processing' ? h.notice('原笔支付结果尚未确认，请先查询后再取消。', 'warning') + h.button('查询原笔支付结果', 'ui.booking-query', { id }, 'primary full') : blocked ? h.empty('当前需要门店核实取消', '原预约保持当前状态。请门店核实履约情况和可退金额。', h.link('联系门店', `${back}/contact-store`, 'primary')) : h.panel('取消金额核对', h.row('已支付', h.money(b.paidCents)) + h.row('已退款', h.money(b.refundedCents)) + h.row('本次取消扣费', h.money(0)) + h.row('本次申请原路退回', `<strong class="amount">${h.money(amount)}</strong>`) + `<p class="muted">${amount ? '确认后释放当前预约，并提交原路退款；资金到账以退款结果为准。' : '此预约尚未支付，确认后关闭预约并释放时段。'}</p>`) + h.panel('', h.form('booking.cancel', { id }, h.field('取消原因', 'reason', '', 'text', 'required maxlength="200" placeholder="请填写取消原因"') + h.submit('确认取消预约', 'primary full') + h.link('保留预约', back, 'secondary full'), 'stack', back));
    return wrap(head(h, '取消预约', back, '') + summary + content);
  }
  if (page === 'reschedule') {
    if (blocked || b.userReschedules >= 1 || b.status === 'unpaid') return wrap(head(h, '修改预约时间', back, '') + h.empty('当前不能自主改约', '每笔预约可主动改约一次；已经开始履约或有待处理事项时，请门店协助。', h.link('联系门店', `${back}/contact-store`, 'primary')));
    const q = ui.query instanceof URLSearchParams ? Object.fromEntries(ui.query) : ui.query || {};
    const date = /^\d{4}-\d{2}-\d{2}$/.test(q.date || '') ? q.date : localDate(b.startAt), techId = q.tech || b.techId;
    const selection = { ...b, techId, mode: 'specified' }, slots = bookingSlots(s, selection, date), chosen = slots.find(x => x.available && x.startAt === Number(q.startAt));
    const path = (newDate, newTech, time = '') => `${back}/reschedule?date=${encodeURIComponent(newDate)}&tech=${encodeURIComponent(newTech)}${time ? `&startAt=${time}` : ''}`;
    const maxDays = b.rulesSnapshot?.maxDays || 7;
    const dates = Array.from({ length: maxDays + 1 }, (_, i) => localDate(s.now + i * DAY)).filter(x => x <= localDate(b.firstPaidAt + maxDays * DAY));
    const techs = bookingOptions(s, { ...b, startAt: '', mode: 'nearest' }).candidates.filter(t => t.available);
    return wrap(head(h, '修改预约时间', back, '') + summary + h.notice('每笔预约可主动改约一次，只能选择与原预约同价的可约时段。确认前原安排继续保留。') + h.panel('选择本店技师', `<div class="booking-segment">${techs.map(t => h.link(h.esc(t.name), path(date, t.id), t.id === techId ? 'booking-choice selected' : 'booking-choice')).join('')}</div>`) + h.panel('新预约时间', `<div class="booking-date-tabs">${dates.map(x => h.link(`${x.slice(5).replace('-', '月')}日`, path(x, techId), x === date ? 'booking-date selected' : 'booking-date')).join('')}</div><div class="booking-slots">${slots.map(x => { const same = x.startAt === b.startAt && x.techId === b.techId; return x.available && !same ? h.link(`<span>${x.time}</span><small>${h.money(x.priceCents)}</small>`, path(date, techId, x.startAt), chosen?.startAt === x.startAt ? 'booking-slot selected' : 'booking-slot') : `<button class="booking-slot" type="button" disabled title="${h.esc(same ? '与原预约相同' : slotDescription(x))}"><span>${x.time}</span><small>${same ? '原预约时段' : h.esc(slotReason(s, x))}</small></button>`; }).join('')}</div>`) + footer(h, chosen && (chosen.startAt !== b.startAt || techId !== b.techId) ? h.form('booking.reschedule', { id, startAt: chosen.startAt, techId }, h.row('新预约时间', h.date(chosen.startAt)) + h.row('具体技师', h.esc(s.techs.find(t => t.id === techId)?.name)) + h.row('预约价格', h.money(chosen.priceCents)) + '<p class="muted">确认后立即替换原安排，开启新一轮确认期限。</p>' + h.submit('确认改约', 'primary full'), 'stack', back) : disabled(h, '请选择新的可约时段', 'primary full')));
  }
  return h.empty('页面暂不可查看', '请返回预约继续。', h.link('查看预约', back, 'primary'));
}

function slotDescription(slot) {
  return (slot.reason || '').includes('预约跨度与原停业时段重叠') ? '该时段门店暂停预约，请选择其他时间。' : slot.reason;
}

function slotReason(s, slot) {
  const reason = slot.reason || '';
  if (slot.startAt < s.now + (s.bookingRules?.earliestHours || 2) * 3600000) return `不足 ${s.bookingRules?.earliestHours || 2} 小时`;
  if (reason.includes('预约跨度与原停业时段重叠')) return '门店暂停预约';
  if (reason.includes('首次支付起')) return '超出预约范围';
  if (reason.includes('价格不同')) return '与原预约不同价';
  if (/休息|休假|请假/.test(reason)) return '技师休息 / 请假';
  if (/被预约|锁定/.test(reason)) return '时段已约满';
  if (/09:00|工作时段|工作时间|排班/.test(reason)) return '非可约时段';
  if (reason.includes('偏好')) return '无符合偏好技师';
  return reason || '不可约';
}
