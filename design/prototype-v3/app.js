'use strict';
// 天俪 v3 原型：状态画廊与可点击演示共用组件；规则来源见 screens.js。
const q = new URLSearchParams(location.search);
let sid = q.get('screen') || 'u-home';
const I = n => `<i data-lucide="${n}" aria-hidden="true"></i>`;
const B = (label, cls = 'primary', attr = '') => `<button type="button" class="button ${cls}" ${attr}>${label}</button>`;
const av = (n, cls = '') => `<span class="avatar ${cls}" aria-hidden="true">${n}</span>`;
const badge = (t, cls = '') => `<span class="badge ${cls}">${t}</span>`;
const chev = I('chevron-right');
const SERVICE = {name:'舒缓放松', duration:60, price:298, icon:'hand', theme:'', label:'全身舒缓', desc:'全身放松 · 适合日常疲劳'};
const NECK = {name:'肩颈放松', duration:45, price:198, icon:'activity', theme:'sage', label:'肩颈舒缓', desc:'肩颈舒缓 · 适合久坐人群'};
const art = (s = SERVICE) => `<div class="service-art ${s.theme}" aria-hidden="true">${I(s.icon)}<span>${s.label}</span></div>`;

// ---------- 外壳 ----------
const statusbar = t => `<div class="statusbar"><span>${t}</span><div class="status-icons">${I('signal')}${I('wifi')}${I('battery-full')}</div></div>`;
const capsule = '<div class="capsule" aria-hidden="true"><b>•••</b><i></i><span></span></div>';
const nav = (title, back = true) => `<header class="navigation">${back ? `<button class="back" aria-label="返回">${I('chevron-left')}</button>` : ''}<h1>${title}</h1>${capsule}</header>`;
const brandNav = () => `<header class="navigation"><div class="navbrand"><span class="brand-mark">俪</span><strong>天俪</strong><small>上门保健</small></div>${capsule}</header>`;
const TABS = {
  user: [['house', '首页'], ['clipboard-list', '订单'], ['user', '我的']],
  tech: [['layout-grid', '工作台'], ['calendar-days', '排班'], ['wallet', '收入'], ['user', '我的']],
  store: [['list-checks', '派单'], ['clipboard-list', '今日订单'], ['shield-alert', '告警'], ['calendar-days', '排班']]
};
const tabbar = (role, active, dot = '') => `<nav class="tabbar">${TABS[role].map(([ic, l]) => `<button class="${l === active ? 'active' : ''}">${I(ic)}<span>${l}</span>${l === dot ? '<i class="nav-dot"></i>' : ''}</button>`).join('')}<span class="home-indicator"></span></nav>`;
const footer = (...items) => `<footer class="action-footer">${items.join('')}<span class="home-indicator"></span></footer>`;
const sheet = (title, body, foot = '') => `<div class="overlay"><section class="sheet" role="dialog" aria-label="${title}"><div class="sheet-head"><h2>${title}</h2><button aria-label="关闭">${I('x')}</button></div><div class="sheet-body">${body}</div>${foot ? `<div class="sheet-footer">${foot}</div>` : ''}</section></div>`;
const page = ({time, header, body, bodyClass = 'gray', foot = '', tabs = '', overlay = ''}) => `${statusbar(time)}${header}<main class="content ${bodyClass}">${body}</main>${foot}${tabs}${overlay}`;
const notice = (tone, icon, html) => `<div class="notice ${tone}">${I(icon)}<div>${html}</div></div>`;
const kv = (k, v, cls = '') => `<div class="kv ${cls}"><span>${k}</span><span>${v}</span></div>`;
const check = (on, html) => `<div class="check-row"><span class="box ${on ? 'on' : ''}">${on ? I('check') : ''}</span><div>${html}</div></div>`;

// ---------- 订单详情（用户端）通用块 ----------
const STEP_LABELS = ['已支付', '已接单', '已出发', '服务中', '已完成'];
const steps = n => `<div class="steps">${STEP_LABELS.map((l, i) => `<div class="step ${i < n ? 'done' : i === n ? 'current' : ''}">${l}</div>`).join('')}</div>`;
const hero = (title, desc, tone = 'brand', icon = '', extra = '') => `<section class="status-hero tone-${tone}"><h2>${icon ? I(icon) : ''}${title}</h2><p>${desc}</p>${extra}</section>`;
const techCard = ({n = '林', cls = '', name = '林师傅', tag = '就近安排', sub = '天俪·示例门店 · ★4.9 · 证书可查', right} = {}) => `<div class="card"><div class="person">${av(n, cls)}<div class="grow"><div class="row"><h3>${name}</h3>${tag ? badge(tag) : ''}</div><p>${sub}</p></div>${right === undefined ? `<div class="icon-label"><button class="icon-btn" aria-label="联系技师">${I('phone')}</button>联系</div>` : right}</div></div>`;
const serviceCard = (time = '今天 14:00–15:00', extra = '') => `<div class="card"><div class="compact-service flat">${art()}<div><h3>${SERVICE.name}</h3><p>60分钟 · 上门服务</p></div></div>${kv('预约时间', time)}${kv('上门地址', '幸福里小区 2号楼 8层 802室')}${kv('服务对象', '王女士 138****8000')}${extra}</div>`;
const orderInfo = (extra = '') => `<div class="card">${kv('订单编号', 'TL2026100100132')}${kv('服务门店', '天俪·示例门店')}${kv('实付金额', '¥298.00')}${extra}</div>`;
const detail = (time, heroHtml, blocks, foot, overlay = '') => page({time, header: nav('订单详情'), body: heroHtml + `<div class="detail">${blocks.join('')}</div>`, foot, overlay});

// ---------- 用户端 · 下单 ----------
const serviceRow = s => `<div class="service-row">${art(s)}<div class="grow"><div class="row"><h3>${s.name}</h3>${badge(s.duration + '分钟')}</div><p class="description">${s.desc}</p><div class="price-line"><div class="price"><em>¥</em>${s.price}<small>总价</small></div>${B('预约')}</div></div></div>`;
const techRow = (n, cls, name, tagHtml, meta, avail) => `<div class="tech-row">${av(n, cls)}<div class="grow"><div class="name-line"><h3>${name}</h3>${tagHtml}</div><p>${meta}</p><p class="availability">${avail}</p></div><button class="choose">查看</button></div>`;
const addressBar = (addr, b) => `<section class="location">${I('map-pin')}<div><button class="address-button">${addr}${chev}</button><p>根据上门地址，为你匹配附近服务</p></div>${b}</section>`;

const S = {};
S['u-home'] = () => page({time: '10:02', header: brandNav(), bodyClass: 'surface', body:
  addressBar('幸福里小区', badge('可上门', 'good')) +
  `<div class="trust-strip"><span>${I('badge-check')}培训记录可查</span><span>${I('store')}门店负责</span><span>${I('circle-check')}一口价含上门交通</span></div>` +
  `<div class="section-head padded"><h2>预约上门服务</h2><button>服务说明${chev}</button></div><div class="padded">${serviceRow(SERVICE)}${serviceRow(NECK)}</div><div class="section-gap"></div>` +
  `<div class="section-head padded"><h2>附近可约技师</h2><button>距离优先${I('arrow-down-wide-narrow')}</button></div><div class="padded">` +
  techRow('林', '', '林师傅', badge('证书可查'), '1.2km · <span class="star-mini">★</span>4.9（126条）· 肩颈 / 全身', '明天 14:00 可约') +
  techRow('陈', 'chen', '陈师傅', badge('证书可查'), '1.8km · <span class="star-mini">★</span>4.8（88条）· 肩颈', '今天 15:30 可约') +
  techRow('周', 'zhou', '周师傅', badge('新技师', 'warm'), '2.6km · 评价不足 5 条 · 全身', '今天 16:00 可约') + '</div>',
  tabs: tabbar('user', '首页')});

S['u-out-of-range'] = () => page({time: '10:02', header: brandNav(), bodyClass: 'surface', body:
  addressBar('远郊花园 1号楼', badge('暂未开通', 'warm')) +
  `<div class="block"><div class="ring">${I('map-pin-off')}</div><h2>当前地址暂未开通上门服务</h2><p>这个地址不在附近门店的服务范围内。<br>你可以更换上门地址后再看看。</p><div class="actions">${B('更换上门地址', 'primary full')}${B('查看已开通区域', 'secondary full')}</div></div>`,
  tabs: tabbar('user', '首页')});

S['u-tech-detail'] = () => page({time: '10:03', header: nav('技师档案'), body:
  `<div class="detail"><div class="card"><div class="person">${av('林')}<div class="grow"><div class="row"><h3>林师傅</h3>${badge('证书可查', 'good')}</div><p>天俪·示例门店 · 距离 1.2km</p></div></div>` +
  `<div class="stats" style="padding:14px 0 2px"><div class="stat"><strong>4.9</strong><span>近 90 天评分</span></div><div class="stat"><strong>126</strong><span>评价</span></div><div class="stat"><strong>480</strong><span>培训课时</span></div></div></div>` +
  `<div class="card"><div class="card-title">培训与资质</div>${kv('培训批次', '天俪培训学院 2024 年第 6 期')}${kv('证书编号', `TL-2024-06-0132 <span class="brand">查验</span>`)}${kv('意外保险', '有效')}${kv('擅长项目', '肩颈放松、全身放松')}</div>` +
  `<div class="card"><div class="card-title">用户评价 <small>4.9 · 126 条</small></div>` +
  `<div class="list-row"><div class="grow"><div class="row"><span class="star-mini">★★★★★</span>${badge('准时')}${badge('手法专业')}</div><p style="font-size:13px;color:#4b5159;margin-top:4px">很准时，力度合适，沟通也很耐心。</p><p>王** · 9月28日</p></div></div>` +
  `<div class="list-row"><div class="grow"><div class="row"><span class="star-mini">★★★★★</span>${badge('沟通好')}</div><p style="font-size:13px;color:#4b5159;margin-top:4px">工装整洁，服务前确认了身体情况。</p><p>李** · 9月25日</p></div></div></div></div>`,
  foot: footer(`<div class="lead">最近可约<b>明天 14:00</b></div>`, B('预约林师傅'))});

S['u-slot'] = () => {
  const sl = (t, st = '', sub = '') => `<button class="slot ${st === 'on' ? 'on' : ''}" ${st === 'off' ? 'disabled' : ''}>${t}${sub ? `<small>${sub}</small>` : ''}</button>`;
  return page({time: '10:04', header: nav('选择时段'), body:
    `<div class="date-tabs"><button><b>今天</b>10/1</button><button class="on"><b>明天</b>10/2</button><button><b>周六</b>10/3</button><button><b>周日</b>10/4</button><button><b>周一</b>10/5</button></div>` +
    `<div class="detail"><div class="card"><div class="person">${av('林', 'small-avatar')}<div class="grow"><h3>林师傅</h3><p>舒缓放松 · 60分钟 · 已含上门交通</p></div><button class="link">换技师${chev}</button></div></div>` +
    `<div class="card"><div class="card-title">上午</div><div class="slots">${sl('09:00', 'off', '已约满')}${sl('09:30', 'off', '已约满')}${sl('10:00', 'off', '已约满')}${sl('10:30', 'off', '已约满')}${sl('11:00', 'off', '已约满')}${sl('11:30', 'off', '已约满')}</div>` +
    `<div class="card-title" style="margin-top:12px">下午</div><div class="slots">${sl('13:00', 'off', '已约满')}${sl('13:30', 'off', '已约满')}${sl('14:00', 'on', '¥298')}${sl('14:30', 'off', '已约满')}${sl('15:00', 'off', '已约满')}${sl('15:30')}${sl('16:00')}${sl('16:30')}</div>` +
    `<div class="card-title" style="margin-top:12px">晚上 <small>21:00 后为夜间价</small></div><div class="slots">${sl('19:00')}${sl('20:00')}${sl('21:00', '', '¥328')}${sl('22:00', '', '¥328')}</div>` +
    `<div class="legend"><span><i></i>可约</span><span><i style="background:#f6f7f8"></i>已约满</span><span>时间段已含前后路程</span></div></div></div>`,
    foot: footer(`<div class="lead">已选<b>明天 14:00–15:00 · ¥298</b></div>`, B('确定'))});
};

S['u-realname'] = () => page({time: '10:05', header: nav('实名核验'), body:
  `<div class="detail">${notice('gray', 'shield-check', '根据平台规定，首次预约上门服务前需要完成实名核验。核验信息只用于确认身份，不会展示给技师和门店。')}` +
  `<div class="card"><div class="field"><span>姓名</span><span class="input">王小雅</span></div><div class="field"><span>身份证号</span><span class="input">310***********1234</span></div><div class="field"><span>手机号</span><span class="input">138****8000</span></div></div>` +
  check(true, '我已阅读并同意<a>《身份信息处理单独授权》</a>，同意平台为实名核验处理我的身份证号') +
  `<p class="small muted" style="padding:0 4px">核验通过后，下次预约不再需要填写。你可以在"我的 → 隐私设置"中撤回授权，撤回后不能预约上门服务。</p></div>`,
  foot: footer(B('提交核验'))});

const confirmBody = (checked = true) =>
  `<div class="booking-content tight">${notice('brand', 'timer', '技师和时段已为你保留，请在 <b>14分32秒</b> 内完成支付')}` +
  `<div class="group address-card"><div class="row">${I('map-pin')}<div class="grow"><div class="address-line">幸福里小区 2号楼</div><div class="address-line" style="font-size:14px;font-weight:400">8层 802室</div><div class="contact">服务对象：王女士 138****8000</div></div><button class="link">修改${chev}</button></div></div>` +
  `<div class="group"><div class="compact-service">${art()}<div><h3>舒缓放松</h3><p>60分钟 · 上门服务</p></div></div>` +
  `<div class="form-row"><span class="label">预约时间</span><span class="value">明天 10月2日 14:00–15:00${I('chevron-right')}</span></div>` +
  `<div class="technician-confirm">${av('林', 'small-avatar')}<div class="grow"><div class="row"><strong>林师傅</strong>${badge('就近安排')}</div><p>已为你匹配具体技师 · ★4.9 · 1.2km</p></div><button class="link">查看档案${chev}</button></div>` +
  `<div class="form-row"><span class="label">服务门店</span><span class="value">天俪·示例门店</span></div></div>` +
  `<div class="group"><div class="total-row"><span>服务总价</span><strong>¥298.00</strong></div><div class="included">${I('circle-check')}已含上门交通费，无其他附加费用</div></div>` +
  `<div class="group"><div class="form-row"><span class="label">取消规则</span><span class="value">出发前免费 · 出发后扣 20%${I('chevron-right')}</span></div></div>` +
  check(checked, '服务对象已满 18 周岁，且不属于禁忌人群 <a>查看《健康告知》</a>') +
  `<p class="booking-notes" style="padding-top:0">支付后技师 10 分钟内确认接单；未能安排技师将自动全额退款。</p></div>`;
const payFooter = (disabled = false) => `<footer class="payment-footer"><div><span class="pay-label">应付</span><span class="price"><em>¥</em>298</span></div>${B('确认并支付', 'primary', disabled ? 'disabled' : '')}<span class="home-indicator"></span></footer>`;

S['u-confirm'] = () => page({time: '10:05', header: nav('确认订单'), body: confirmBody(true), foot: payFooter()});

S['u-health'] = () => page({time: '10:05', header: nav('确认订单'), body: confirmBody(false), foot: payFooter(true), overlay: sheet('健康告知',
  `<p>为了服务安全，请确认本次的服务对象：</p>` +
  `<div style="margin-top:12px">${check(true, '<strong>已满 18 周岁</strong>')}${check(true, '<strong>不属于以下禁忌人群</strong>')}</div>` +
  `<div class="card" style="background:#f7f8f9;margin:0">${['孕期', '急性损伤或骨折未愈', '皮肤破损或传染性皮肤病', '发热', '严重心脑血管疾病', '饮酒后'].map(x => `<div class="kv"><span>· ${x}</span><span></span></div>`).join('')}</div>` +
  `<div class="error-message" style="background:#fff6ea;color:#8a5716">技师到达后如发现服务对象不符合条件，可以中止服务；客服核实后按规则处理退款。</div>`,
  `<div class="actions">${B('我已确认，继续', 'primary full')}</div>`)});

S['u-paid'] = () => page({time: '10:06', header: nav('支付结果', false), body:
  `<div class="big-success"><div class="ok">${I('circle-check')}</div><h2>支付成功</h2><p>¥298.00 · 等待技师确认接单</p></div>` +
  `<div class="detail"><div class="card">${kv('服务项目', '舒缓放松 · 60分钟')}${kv('预约时间', '明天 10月2日 14:00–15:00')}${kv('技师', '林师傅（就近安排）')}</div>` +
  `<div class="card"><div class="person"><button class="icon-btn" style="background:var(--brand-soft);color:var(--brand)">${I('bell-ring')}</button><div class="grow"><h3>开启订单通知</h3><p>接单、出发、到达、退款等进度第一时间通知你</p></div></div><div class="actions">${B('开启通知', 'primary full')}</div><p class="small muted" style="margin-top:8px">不开启时，关键进度会通过短信发送到 138****8000。</p></div></div>`,
  foot: footer(B('返回首页', 'secondary'), B('查看订单', 'secondary'))});

// ---------- 用户端 · 订单状态 ----------
const listCard = (no, st, stCls, title, time, meta, actions) => `<div class="order-card"><div class="order-top"><span>订单尾号 ${no}</span>${badge(st, stCls)}</div><div class="order-title"><h3>${title}</h3></div><div class="order-time" style="font-size:14px;margin-top:6px">${time}</div><div class="order-meta"><span>${meta}</span></div>${actions ? `<div class="actions">${actions}</div>` : ''}</div>`;
S['u-orders'] = () => page({time: '12:40', header: nav('我的订单', false), body:
  `<div class="filterbar"><button class="selected">全部</button><button>进行中 <span class="count">2</span></button><button>待评价 <span class="count">1</span></button><button>售后 <span class="count">1</span></button></div><div class="order-list">` +
  listCard('0132', '已接单', 'good', '舒缓放松 · 60分钟', '今天 14:00–15:00', '林师傅 · 天俪·示例门店', B('改约', 'secondary') + B('联系技师', 'secondary')) +
  listCard('0168', '等待技师确认', 'warm', '肩颈放松 · 45分钟', '10月5日 19:00–19:45', '陈师傅 · 天俪·示例门店', B('取消订单', 'secondary')) +
  listCard('0117', '已完成', '', '舒缓放松 · 60分钟', '9月30日 15:00–16:00', '林师傅 · 待评价', B('开发票', 'secondary') + B('去评价', 'soft')) +
  listCard('0109', '售后中', 'redtext', '肩颈放松 · 45分钟', '9月25日 18:00–18:45', '门店处理中', B('查看进度', 'secondary')) +
  listCard('0101', '已关闭', '', '舒缓放松 · 60分钟', '9月20日', '支付超时，订单已关闭', '') + '</div>',
  tabs: tabbar('user', '订单')});

S['u-o-waiting'] = () => detail('10:06', hero('等待技师确认', '林师傅将在 <b>09分12秒</b> 内确认接单；未能确认时，门店会为你安排其他技师。', 'brand', 'hourglass', steps(0) + notice('gray', 'info', '技师出发前可以免费取消；可以改约 1 次。')),
  [techCard({right: ''}), serviceCard('明天 10月2日 14:00–15:00'), orderInfo()],
  footer(B('联系客服', 'secondary tiny'), B('取消订单', 'secondary'), B('改约', 'secondary')));

S['u-o-dispatching'] = () => detail('10:17', hero('正在为你安排技师', '原技师未能接单，门店正在为你安排，最晚 <b>10:35</b> 前完成；未能安排将自动全额退款。', 'warm', 'user-search', steps(0)),
  [`<div class="card"><div class="person"><span class="avatar" style="background:#f3f4f5;border-color:#eceef0;color:#9aa0a6">${I('user-round')}</span><div class="grow"><h3>技师安排中</h3><p>就近安排 · 将从天俪·示例门店为你选择</p></div></div></div>`, serviceCard('明天 10月2日 14:00–15:00'), orderInfo()],
  footer(B('联系客服', 'secondary tiny'), B('取消订单', 'secondary'), B('改约', 'secondary')));

S['u-o-accepted'] = () => detail('12:40', hero('技师已接单', '林师傅将于 <b>今天 14:00</b> 上门，出发时会通知你。', 'green', 'circle-check', steps(1)),
  [techCard(), serviceCard(), orderInfo(kv('取消规则', '出发前免费 · 出发后扣 20%'))],
  footer(B('联系客服', 'secondary tiny'), B('取消订单', 'secondary'), B('改约（剩 1 次）', 'secondary')));

S['u-o-reassign'] = () => detail('11:20', hero('门店为你更换了技师', '原指定技师临时无法服务。请在 <b>14分05秒</b> 内确认；不确认将自动取消订单并全额退款。', 'warm', 'repeat', steps(1)),
  [`<div class="card"><div class="card-title">技师变更 <small>时间不变：今天 14:00–15:00</small></div><div class="compare"><div class="side old">${av('林')}<div class="name">林师傅</div><small>原指定技师</small></div>${I('arrow-right')}<div class="side new">${av('陈', 'chen')}<div class="name">陈师傅</div><small>★4.8 · 证书可查 · 1.8km</small></div></div></div>`, serviceCard(), orderInfo()],
  footer(B('不同意，取消并退款', 'secondary'), B('同意更换')));

S['u-o-store-reschedule'] = () => detail('09:30', hero('门店希望调整上门时间', '请在 <b>13分20秒</b> 内确认；不确认将保持原预约时间。', 'warm', 'calendar-clock', steps(1)),
  [`<div class="card"><div class="card-title">时间调整 <small>技师不变：林师傅</small></div><div class="compare"><div class="side old"><small>原时间</small><div class="when name">14:00–15:00</div><small>今天</small></div>${I('arrow-right')}<div class="side new"><small>新时间</small><div class="when">16:00–17:00</div><small>今天</small></div></div><p class="small muted" style="margin-top:10px">门店说明：技师上一单服务时间延长。门店发起的调整不占用你的改约次数。</p></div>`, techCard(), orderInfo()],
  footer(B('保持原时间', 'secondary'), B('同意调整')));

S['u-o-departed'] = () => detail('13:40', hero('技师已出发', '林师傅 13:30 已出发，预计 14:00 前到达。', 'green', 'navigation', steps(2)),
  [techCard(), serviceCard(), orderInfo()],
  footer(B(I('shield-alert') + '求助', 'ghost-red tiny', 'data-go="u-sos"'), B('取消订单', 'secondary'), B('联系技师', 'secondary')),
  sheet('取消订单', notice('warm', 'triangle-alert', '技师已出发，现在取消需要扣除订单金额的 20%，用于补偿技师已产生的路程成本。') +
    `<div class="card" style="padding:4px 0;margin:0">${kv('实付金额', '¥298.00')}${kv('扣除费用', '<span class="minus">−¥59.60</span>')}${kv('退款金额', '¥238.40', 'strong sep')}${kv('退款方式', '原路退回')}</div>` +
    `<p class="small muted" style="margin-top:10px">如果到 14:15 技师仍未到达，你可以免费取消。</p>`,
    `<div class="actions">${B('暂不取消', 'secondary')}${B('确认取消')}</div>`));

S['u-o-late'] = () => detail('14:17', hero('技师未按时到达', '林师傅已超过预约时间 17 分钟，门店正在联系技师。你可以继续等待，也可以免费取消。', 'red', 'clock-alert', steps(2) + notice('gray', 'store', '门店已收到提醒。免费取消将全额退款 ¥298.00。')),
  [techCard(), serviceCard(), orderInfo()],
  footer(B(I('shield-alert') + '求助', 'ghost-red tiny', 'data-go="u-sos"'), B('免费取消', 'secondary'), B('联系技师')));

S['u-o-arrived'] = () => detail('13:58', hero('技师已到达', '林师傅已到达，请开门迎接；服务开始后开始计时。', 'green', 'map-pin-check', steps(2) + notice('gray', 'info', '技师到达后不能自助取消，如需取消请联系客服。')),
  [techCard(), serviceCard(), orderInfo()],
  footer(`<button class="button ghost-red tiny">${I('shield-alert')}求助</button>`, B('联系客服', 'secondary'), B('联系技师', 'secondary')));

const servingBody = () => hero('服务中', '预计 <b>15:00</b> 结束 · 已服务 20 分钟', 'green', 'sparkles', `<div class="progress"><i style="width:33%"></i></div>` + steps(3));
S['u-o-serving'] = () => detail('14:20', servingBody(), [techCard(), serviceCard(), orderInfo(kv('加钟', '30分钟 ¥149 · 本单还可加 2 次'))],
  footer(`<button class="button ghost-red tiny">${I('shield-alert')}求助</button>`, B('加钟')));

S['u-o-extend'] = () => detail('14:52', servingBody(), [techCard(), serviceCard(), orderInfo()],
  footer(`<button class="button ghost-red tiny">${I('shield-alert')}求助</button>`, B('加钟')),
  sheet('加钟', `<button class="choice selected"><span class="grow">加钟 30 分钟<small>结束时间顺延至 15:30</small></span><strong>¥149</strong></button>` +
    notice('brand', 'timer', '林师傅后续时段已为你保留，请在 <b>04分48秒</b> 内支付，超时自动放弃。') +
    `<p class="small muted">本单最多加钟 2 次，加钟费用已含上门交通，付款给天俪·示例门店。</p>`,
    `<div class="actions">${B('放弃', 'secondary')}${B('支付 ¥149','primary','data-action="pay-extend"')}</div>`));

S['u-o-service'] = () => detail('14:35', hero('客服处理中', '本次服务已中止，平台客服将在 24 小时内联系你核实情况。', 'warm', 'headset', notice('gray', 'info', '核实期间暂停分账，退款或扣费以处理结果为准。')),
  [`<div class="card"><div class="card-title">处理进度</div><div class="timeline2"><div class="t"><time>14:31</time>技师中止了服务</div><div class="t"><time>14:32</time>已通知门店和平台客服</div><div class="t on"><time>待处理</time>客服核实情况（24 小时内）</div></div></div>`, techCard({right: ''}), serviceCard()],
  footer(B(I('shield-alert') + '求助', 'ghost-red tiny', 'data-go="u-sos"'), B('补充说明', 'secondary'), B('联系客服')));

S['u-o-done'] = () => detail('15:05', hero('服务已完成', '感谢使用，期待再次为你服务。', 'green', 'circle-check', steps(5) + notice('gray', 'shield-check', '服务完成后 48 小时内（10月4日 15:00 前）可以申请售后。')),
  [techCard({right: ''}), serviceCard(), orderInfo()],
  footer(B(I('shield-alert') + '求助', 'ghost-red tiny', 'data-go="u-sos"'), B('申请售后', 'secondary'), B('去评价')));

S['u-o-aftersale'] = () => detail('10:00', hero('售后处理中', '门店将在 <b>23小时50分</b> 内处理（10月4日 09:50 前），超时自动转平台处理。', 'warm', 'messages-square'),
  [`<div class="card"><div class="card-title">售后进度</div><div class="timeline2"><div class="t"><time>10月3日 09:50</time>你提交了售后申请：时长不足，申请退款 ¥98.00</div><div class="t on"><time>处理中</time>天俪·示例门店处理中</div><div class="t"><time>待定</time>你确认处理结果，或申请平台介入</div></div></div>`, serviceCard('10月2日 14:00–15:00'), orderInfo()],
  footer(B('撤销申请', 'secondary'), B('补充材料')));

S['u-o-cancelled'] = () => detail('13:41', hero('订单已取消', '已退款 ¥238.40，按微信退款时效原路退回。', 'gray', 'circle-x'),
  [`<div class="card"><div class="card-title">退款明细</div>${kv('实付金额', '¥298.00')}${kv('扣除费用', '<span class="minus">−¥59.60</span>')}${kv('扣费原因', '技师出发后取消')}${kv('退款金额', '¥238.40', 'strong sep')}${kv('退款状态', '<span style="color:var(--green)">已退款</span>')}</div>`, serviceCard(), orderInfo()],
  footer(B('联系客服', 'secondary'), B('再次预约')));

S['u-o-autorefund'] = () => detail('10:35', hero('订单已取消', '很抱歉，门店未能在规定时间内为你安排技师，已全额退款 ¥298.00。', 'gray', 'circle-x'),
  [`<div class="card"><div class="card-title">退款明细</div>${kv('实付金额', '¥298.00')}${kv('退款金额', '¥298.00', 'strong')}${kv('退款原因', '派单超时，系统自动退款')}${kv('退款状态', '<span style="color:var(--green)">已退款</span>')}</div>`, serviceCard('明天 10月2日 14:00–15:00'), orderInfo()],
  footer(B('联系客服', 'secondary'), B('重新预约')));

// ---------- 用户端 · 改约、售后、评价、发票 ----------
S['u-reschedule'] = () => {
  const sl = (t, st = '', sub = '') => `<button class="slot ${st === 'on' ? 'on' : ''}" ${st === 'off' ? 'disabled' : ''}>${t}${sub ? `<small>${sub}</small>` : ''}</button>`;
  return page({time: '16:10', header: nav('改约'), body:
    `<div class="detail" style="padding-bottom:0"><div class="segmented"><button class="on">改时间</button><button>改地址</button></div>${notice('gray', 'info', '每单可以改约 1 次，技师出发前可改；只能改到同价时段，最晚到 10月8日。改约后需要技师重新确认。')}</div>` +
    `<div class="date-tabs"><button class="on"><b>明天</b>10/2</button><button><b>周六</b>10/3</button><button><b>周日</b>10/4</button><button disabled><b>10/9</b>不可选</button></div>` +
    `<div class="detail"><div class="card"><div class="card-title">林师傅可约时段 <small>原预约 14:00</small></div><div class="slots">${sl('13:00', 'off', '已约满')}${sl('13:30', 'off', '已约满')}${sl('14:00', 'off', '原时段')}${sl('14:30', 'off', '已约满')}${sl('16:00', 'on', '¥298')}${sl('16:30')}${sl('17:00')}${sl('17:30')}${sl('21:00', 'off', '价格不同')}${sl('21:30', 'off', '价格不同')}${sl('22:00', 'off', '价格不同')}</div>` +
    `<p class="small muted" style="margin-top:10px">价格不同的时段不能改约，如需预约请取消后重新下单（技师出发前取消免费）。</p></div>` +
    `<div class="card"><div class="person">${I('users')}<div class="grow"><h3 style="font-size:14px">想换一位技师？</h3><p>可以改约给同门店的其他技师</p></div><button class="link">选择技师${chev}</button></div></div></div>`,
    foot: footer(`<div class="lead">新时间<b>明天 16:00–17:00</b></div>`, B('确认改约'))});
};

S['u-aftersale-apply'] = () => page({time: '09:48', header: nav('申请售后'), body:
  `<div class="detail"><div class="card"><div class="compact-service flat" style="border:0;padding:0;margin:0">${art()}<div class="grow"><h3>舒缓放松 · 林师傅</h3><p>10月2日 14:00–15:00 · 实付 ¥298.00</p></div></div></div>` +
  `<div class="card"><div class="card-title">问题类型</div><div class="chips">${['服务质量', '没按约定服务', '时长不足', '技师态度', '其他'].map(x => `<button class="chip ${x === '时长不足' ? 'on' : ''}">${x}</button>`).join('')}</div>` +
  `<div class="card-title" style="margin-top:12px">你的诉求</div><div class="segmented" style="margin:0"><button class="on">申请退款</button><button>仅反馈问题</button></div>` +
    `<label class="check-row"><input type="checkbox" name="refundMain" checked>主订单退款</label><label class="field" style="margin-top:4px"><span>退款金额</span><input class="runtime-input" name="refundAmount" type="number" min="0" max="298" step="0.01" value="98.00" required></label><p class="small muted" data-refund-main-cap>最多可退 ¥298.00</p><div data-extension-refunds></div></div>` +
    `<div class="card"><label class="card-title" for="aftersaleDescription">问题描述</label><textarea class="runtime-textarea" id="aftersaleDescription" name="aftersaleDescription" required>实际服务大约 50 分钟，比预约的 60 分钟少了 10 分钟左右。</textarea><label class="upload-label">上传凭证<input type="file" name="aftersaleImages" accept="image/*" multiple></label><p class="small muted">最多 6 张图片</p></div></div>`,
  foot: footer(`<div class="lead">门店将在<b>24 小时内处理</b></div>`, B('提交申请'))});

S['u-aftersale-confirm'] = () => page({time: '15:20', header: nav('售后进度'), body:
  hero('门店已处理，请确认', '请在 <b>47小时38分</b> 内确认；超时不操作视为接受。', 'warm', 'messages-square') +
  `<div class="detail"><div class="card"><div class="card-title">门店处理结果</div>${kv('你的诉求', '退款 ¥98.00')}${kv('门店方案', '部分退款 ¥49.67', 'strong')}<div class="textarea" style="background:#f7f8f9;border:0">门店说明：经核实实际服务 50 分钟，按未服务的 10 分钟比例退款。</div></div>` +
  `<div class="card"><div class="card-title">处理进度</div><div class="timeline2"><div class="t"><time>10月3日 09:50</time>你提交了售后申请</div><div class="t"><time>10月3日 15:18</time>门店提出部分退款方案</div><div class="t on"><time>待确认</time>接受方案，或申请平台介入</div></div></div>` +
  `<p class="small muted" style="padding:0 4px">申请平台介入后，平台客服将在 48 小时内裁决，裁决结果为最终结果。</p></div>`,
  foot: footer(B('不接受，申请平台介入', 'secondary'), B('接受方案'))});

S['u-review'] = () => page({time: '15:10', header: nav('评价服务'), body:
  `<div class="detail"><div class="card" style="text-align:center;padding-top:18px">${av('林')}<h3 style="margin-top:8px">林师傅</h3><p class="small muted">舒缓放松 · 10月2日</p><div class="stars">${I('star').repeat(5)}</div><p class="small" style="color:#b07a1c">非常满意</p></div>` +
  `<div class="card"><div class="card-title">选择标签</div><div class="chips">${['准时', '手法专业', '沟通好', '着装规范', '力度合适', '服务细致'].map((x, i) => `<button class="chip ${i < 3 ? 'on' : ''}">${x}</button>`).join('')}</div>` +
  `<label class="card-title" for="reviewText" style="margin-top:12px">说说你的感受 <small>选填</small></label><textarea id="reviewText" name="reviewText" class="runtime-textarea" placeholder="写下你的真实体验"></textarea></div>` +
  `<p class="small muted" style="padding:0 4px">每单只能评价一次，提交后不能修改；文字内容审核通过后显示。</p></div>`,
  foot: footer(B('提交评价'))});

S['u-invoice'] = () => page({time: '15:12', header: nav('申请发票'), body:
  `<div class="detail"><div class="card">${kv('开票金额', '<strong>¥298.00</strong>')}${kv('开票方', '天俪·示例门店')}${kv('发票类型', '电子普通发票')}</div>` +
  `<div class="card"><div class="segmented"><button>个人</button><button class="on">企业</button></div><div class="field"><span>抬头名称</span><span class="input">上海某某科技有限公司</span></div><div class="field"><span>税号</span><span class="input">91310000MA1XXXXXXX</span></div><div class="field"><span>接收邮箱</span><span class="input">wang@example.com</span></div></div>` +
  notice('gray', 'info', '发票由服务门店开具，开具后可查看下载。退款后标记为待红冲，门店完成红冲后，按扣除退款后的金额重新开具。') + '</div>',
  foot: footer(B('提交申请'))});

// ---------- 用户端 · 推广与安全 ----------
const promoBody = () =>
  `<div class="detail"><div class="card"><div class="person"><div class="qr">${I('qr-code')}</div><div class="grow"><h3>我的推广码</h3><p>门店推广员 · 天俪·示例门店</p><div class="tag-line">${badge('协议已签署', 'good')}${badge('已实名')}</div></div></div><div class="actions">${B('生成海报', 'secondary')}${B('分享给好友', 'soft')}</div></div>` +
  `<div class="stat-cards"><div class="stat-card"><strong>23</strong><span>绑定客户</span></div><div class="stat-card"><strong>¥186.40</strong><span>可提现</span></div><div class="stat-card"><strong>¥59.60</strong><span>待结算</span></div></div>` +
  `<div class="card"><div class="card-title">佣金明细 <small>客户信息受保护，不展示</small></div>` +
  `<div class="list-row"><div class="grow">首单佣金<p>订单尾号 0132 · 10月2日</p></div><div style="text-align:right"><div class="amount plus">+¥29.80</div>${badge('待结算', 'warm')}</div></div>` +
  `<div class="list-row"><div class="grow">复购佣金<p>订单尾号 0098 · 9月28日</p></div><div style="text-align:right"><div class="amount plus">+¥14.90</div>${badge('可提现', 'good')}</div></div>` +
  `<div class="list-row"><div class="grow">退款扣回<p>订单尾号 0087 部分退款 · 9月26日</p></div><div style="text-align:right"><div class="amount minus">−¥9.80</div>${badge('已扣回')}</div></div>` +
  `<div class="list-row"><div class="grow">提现到微信零钱<p>9月20日</p></div><div style="text-align:right"><div class="amount">¥120.00</div>${badge('已到账', 'good')}</div></div></div></div>`;
S['u-promo'] = () => page({time: '20:15', header: nav('推广中心'), body: promoBody(), foot: footer(`<div class="lead">可提现<b>¥186.40</b></div>`, B('提现'))});

S['u-withdraw'] = () => page({time: '20:16', header: nav('推广中心'), body: promoBody(), foot: footer(`<div class="lead">可提现<b>¥186.40</b></div>`, B('提现')), overlay: sheet('提现到微信零钱',
  `<div style="text-align:center;padding:4px 0 12px"><div class="money"><em>¥</em>186.40</div><p class="small muted">全部可提现金额</p></div>` +
  `<div class="vsteps" style="border-top:1px solid var(--line);padding-top:4px"><div class="vs done"><span class="dot">${I('check')}</span><div class="grow"><strong>实名核验</strong><p>已完成，和微信实名一致</p></div></div>` +
  `<div class="vs now"><span class="dot">2</span><div class="grow"><strong>开通免确认收款</strong><p>授权一次，以后每次提现不用逐笔确认</p></div>${B('去授权', 'soft', 'style="min-height:34px;font-size:12px;padding:0 12px"')}</div></div>` +
  `<p class="small muted">不开通也可以提现，但每笔都需要你在微信里确认收款，超时未确认会退回。每次最低 ¥10，每天最多 3 次；到账以微信通知为准。</p>`,
  `<div class="actions">${B('确认提现', 'primary full')}</div>`)});

S['u-sos'] = () => detail('14:21', servingBody(), [techCard(), serviceCard(), orderInfo()],
  footer(`<button class="button ghost-red tiny">${I('shield-alert')}求助</button>`, B('加钟')),
  sheet('安全求助', `<p>如果遇到紧急危险，请先直接拨打 110。</p>` +
    `<div class="actions" style="flex-direction:column;margin-top:14px">${B(I('phone') + '直接拨打 110', 'red full')}${B(I('shield-alert') + '发起平台求助', 'ghost-red full')}</div>` +
    `<p class="small muted" style="margin-top:12px">发起求助后，平台会立即电话通知门店和平台值班人员，并记录你当前的位置和订单信息。</p>`));

S['u-restricted'] = () => page({time: '09:15', header: brandNav(), bodyClass: 'surface', body:
  addressBar('幸福里小区', badge('可上门', 'good')) +
  `<div class="block"><div class="ring red">${I('ban')}</div><h2>账号已限制下单</h2><p>原因：30 天内爽约 2 次<br>限制到 2026年10月31日</p><div class="actions">${B('联系客服申诉', 'primary full')}${B('查看平台规则', 'secondary full')}</div><p class="small muted" style="margin-top:14px">限制期间可以查看历史订单和发票，不能新建预约。</p></div>`,
  tabs: tabbar('user', '首页')});

// ---------- 技师端 ----------
const techOrderCard = ({no, title = '舒缓放松 · 60分钟', time, place, st, stCls, top = '', line = '', meta = '', actions}) => `<div class="order-card"><div class="order-top"><span>订单尾号 ${no}</span>${top || badge(st, stCls)}</div><div class="order-title"><h3>${title}</h3>${top ? badge(st, stCls) : ''}</div><div class="order-time"><small>今天</small>${time}</div><div class="order-place">${I('map-pin')}${place}${line}</div>${meta ? `<div class="order-meta">${meta}</div>` : ''}${actions}</div>`;
const workerHeader = (status = badge('在岗', 'good')) => `<section class="worker-header surface">${av('林', 'small-avatar')}<div class="grow"><div class="row"><strong>林师傅</strong>${status}</div><p>天俪·示例门店</p></div></section>`;

S['t-onboarding'] = () => page({time: '11:20', header: nav('技师入驻', false), body:
  `<div class="detail">${notice('brand', 'hourglass', '资料已提交，集团审核中。审核结果会通过消息通知你。')}` +
  `<div class="card vsteps"><div class="vs done"><span class="dot">${I('check')}</span><div class="grow"><strong>绑定微信账号</strong><p>按结业名单匹配：天俪培训学院 2024 年第 6 期</p></div></div>` +
  `<div class="vs done"><span class="dot">${I('check')}</span><div class="grow"><strong>实名与人脸核身</strong><p>已通过</p></div></div>` +
  `<div class="vs done"><span class="dot">${I('check')}</span><div class="grow"><strong>上传证书、保单、工装照片</strong><p>证书 TL-2024-06-0132 · 保单至 2027-03-31</p></div></div>` +
  `<div class="vs now"><span class="dot">4</span><div class="grow"><strong>集团审核</strong><p>审核中</p></div></div>` +
  `<div class="vs"><span class="dot">5</span><div class="grow"><strong>分配门店，开始接单</strong><p>审核通过后由集团分配</p></div></div></div>` +
  `<div class="card"><div class="card-title">照片要求</div><p class="small muted">统一工装、正面免冠、背景干净；不使用生活照和修饰过度的照片。</p></div></div>`,
  foot: footer(B('修改资料', 'secondary'))});

S['t-work'] = () => page({time: '13:45', header: nav('工作台', false), bodyClass: 'gray', body:
  workerHeader() + `<div class="stats"><div class="stat"><strong>4</strong><span>今日订单</span></div><div class="stat emphasis"><strong>1</strong><span>待确认</span></div><div class="stat"><strong>1</strong><span>已完成</span></div></div>` +
  `<div class="filterbar"><button class="selected">全部 <span class="count">4</span></button><button>待确认 <span class="count">1</span></button><button>进行中 <span class="count">1</span></button></div><div class="order-list">` +
  techOrderCard({no: '0132', time: '16:00–17:00', place: '幸福里小区 · 2号楼', st: '待接单', stCls: 'warm', top: `<span class="timer">${I('timer')}剩余 08分42秒</span>`, meta: '<span>王女士</span><span>就近安排</span>', actions: `<div class="actions">${B('拒单', 'secondary narrow')}${B('确认接单')}</div>`}) +
  techOrderCard({no: '0126', time: '14:00–15:00', place: '雅园小区 · 6号楼', st: '已出发', stCls: 'good', line: `<button class="nav-link">导航${I('navigation')}</button>`, actions: `<div class="order-statusline">${I('circle-check')}13:30 已出发，请到达后打卡</div><div class="actions"><button class="button ghost-red narrow">${I('shield-alert')}求助</button>${B('联系客户', 'secondary')}${B('到达打卡')}</div>`}) + '</div>',
  tabs: tabbar('tech', '工作台')});

const techDetail = (time, statusHtml, blocks, foot, overlay = '') => page({time, header: nav('订单详情'), body: statusHtml + `<div class="detail">${blocks.join('')}</div>`, foot, overlay});
const customerCard = (sos = false) => `<div class="card"><div class="person">${av('王', 'zhou')}<div class="grow"><h3>王女士</h3><p>服务对象：王女士 · 已确认满 18 周岁、无禁忌</p></div>${sos ? `<div class="icon-label"><button class="icon-btn redtone" aria-label="求助">${I('shield-alert')}</button>求助</div>` : ''}<div class="icon-label"><button class="icon-btn" aria-label="联系客户">${I('phone')}</button>联系</div></div></div>`;
const techServiceCard = () => `<div class="card"><div class="compact-service flat">${art()}<div><h3>舒缓放松 · 60分钟</h3><p>订单尾号 0132 · 就近安排</p></div></div>${kv('预约时间', '今天 14:00–15:00')}${kv('上门地址', '幸福里小区 2号楼 8层 802室')}<div class="kv"><span>距离</span><span>3.2km <span class="brand">导航</span></span></div></div>`;

S['t-o-accepted'] = () => techDetail('13:32', hero('已接单 · 待出发', '预约 14:00 开始，请尽快出发。', 'brand', 'clock', notice('warm', 'bell-ring', '已到出发提醒时间，门店已收到通知。14:00 前仍未出发将向店长告警。')),
  [customerCard(), techServiceCard(), notice('gray', 'map-pin', '点"出发"需要开启位置权限；出发到服务结束期间会记录位置，用于安全保障。')],
  footer(B('联系门店', 'secondary'), B(I('navigation') + '出发')));

S['t-o-arrived'] = () => techDetail('14:05', hero('已到达 13:58', '确认用户开门后点"开始服务"。', 'green', 'map-pin-check', notice('gray', 'info', '联系不上用户？到达 15 分钟后（14:13）可以标记用户爽约。')),
  [customerCard(true), techServiceCard(), `<div class="card"><div class="grid-actions"><button disabled>${I('user-x')}标记爽约<small class="muted" style="font-size:10px">14:13 后可用</small></button><button>${I('octagon-x')}中止服务</button><button class="redtone">${I('shield-alert')}安全求助</button></div></div>`],
  footer(B('联系客户', 'secondary'), B('开始服务')));

const techServing = (minutes = 20) => `<section class="status-hero tone-green"><h2>${I('sparkles')}服务中</h2><div class="row between" style="margin-top:6px"><div><div class="timer-big">${String(minutes).padStart(2,'0')}:00</div><p class="small muted">已服务 · 预计 15:00 结束</p></div>${badge('加钟 0/2')}</div><div class="progress"><i style="width:${Math.min(100,minutes/60*100)}%"></i></div></section>`;
S['t-o-serving'] = () => techDetail('14:20', techServing(),
  [`<div class="card"><div class="grid-actions"><button>${I('timer-reset')}发起加钟</button><button>${I('octagon-x')}中止服务</button><button class="redtone">${I('shield-alert')}安全求助</button></div></div>`, customerCard(), techServiceCard()],
  footer(B('结束服务')));

S['t-terminate'] = () => techDetail('14:31', techServing(31), [customerCard(), techServiceCard()], footer(B('结束服务')),
  sheet('中止服务', notice('red', 'shield-alert', '如有人身危险，请先离开现场并发起安全求助。') +
    ['用户提出不当要求', '醉酒或行为异常', '辱骂、威胁', '服务对象未满 18 周岁或属于禁忌人群', '现场环境不安全', '用户身体不适'].map((x, i) => `<button class="choice ${i === 0 ? 'selected' : ''}" style="min-height:44px;padding:9px 12px"><span class="grow">${x}</span><span class="radio ${i === 0 ? 'on' : ''}"></span></button>`).join('') +
    `<textarea class="runtime-textarea" name="terminationNote" placeholder="补充说明（选填）" style="min-height:52px"></textarea><p class="small muted" style="margin-top:8px">确认后可以立即离开。平台客服会在 24 小时内联系双方核实，核实前不结算。</p>`,
    `<div class="actions">${B(I('shield-alert') + '安全求助', 'ghost-red')}${B('确认中止')}</div>`));

S['t-finish'] = () => techDetail('14:46', techServing(45), [customerCard(), techServiceCard()], footer(B('结束服务')),
  sheet('结束服务', `<button class="choice" disabled><span class="grow">正常完成<small>未满预约时长，暂不可选</small></span><span class="radio"></span></button>` +
    `<button class="choice selected"><span class="grow">用户要求提前结束<small>已服务 45 分钟，预约 60 分钟</small></span><span class="radio on"></span></button>` +
    notice('gray', 'info', '提前结束不会自动退款。用户对服务不满意，可以在售后期内申请售后。') +
    `<p class="small muted">如果是用户身体不适，请改用"中止服务"并选择"用户身体不适"。</p>`,
    `<div class="actions">${B('确认结束', 'primary full')}</div>`));

S['t-income'] = () => page({time: '20:30', header: nav('收入', false), body:
  `<div class="detail"><div class="card"><p class="small muted">10月提成（门店按月发放）</p><div class="money" style="margin-top:2px"><em>¥</em>1,286.40</div><div class="stats" style="padding:12px 0 0"><div class="stat"><strong style="font-size:17px">¥129.20</strong><span>待结算</span></div><div class="stat"><strong style="font-size:17px">¥1,157.20</strong><span>已结算</span></div><div class="stat"><strong style="font-size:17px">¥0.00</strong><span>已发放</span></div></div></div>` +
  `<div class="card"><div class="card-title">最近明细</div>` +
  `<div class="list-row"><div class="grow">舒缓放松 · 尾号 0132<p>提成 ¥119.20 + 交通补贴 ¥10.00 · 10月2日</p></div><div style="text-align:right"><div class="amount">¥129.20</div>${badge('待结算', 'warm')}</div></div>` +
  `<div class="list-row"><div class="grow">取消补偿 · 尾号 0126<p>用户在你出发后取消 · 10月1日</p></div><div style="text-align:right"><div class="amount">¥29.80</div>${badge('已结算', 'good')}</div></div>` +
  `<div class="list-row"><div class="grow">退款调整 · 尾号 0117<p>用户部分退款 ¥98.00，按比例减少 · 9月30日</p></div><div style="text-align:right"><div class="amount minus">−¥39.20</div>${badge('已调整')}</div></div>` +
  `<div class="list-row"><div class="grow">肩颈放松 · 尾号 0109<p>提成 ¥79.20 + 交通补贴 ¥10.00 · 9月25日</p></div><div style="text-align:right"><div class="amount">¥89.20</div>${badge('已结算', 'good')}</div></div></div>` +
  `<div class="card"><div class="person"><div class="grow"><h3 style="font-size:14px">分销佣金</h3><p>可提现 ¥186.40 · 提现到微信零钱</p></div>${B('去提现', 'soft', 'style="min-height:36px;font-size:13px"')}</div></div></div>`,
  tabs: tabbar('tech', '收入')});

S['t-schedule'] = () => page({time: '18:05', header: nav('排班', false), body:
  `<div class="date-tabs"><button><b>周四</b>10/1</button><button class="on"><b>周五</b>10/2</button><button><b>周六</b>10/3</button><button><b>周日</b>10/4</button><button><b>周一</b>10/5</button></div>` +
  `<div class="detail"><div class="card"><div class="card-title">10月2日 · 在岗 09:00–21:00 <small>可修改</small></div>` +
  `<div class="list-row"><span class="badge good">14:00</span><div class="grow">舒缓放松 · 尾号 0132<p>占用 13:30–15:30（含前后路程各 30 分钟）</p></div></div>` +
  `<div class="list-row"><span class="badge good">17:00</span><div class="grow">舒缓放松 · 尾号 0158<p>占用 16:30–18:30</p></div></div>` +
  `<div class="list-row"><span class="badge">其余</span><div class="grow muted">可接单</div></div></div>` +
  `<div class="card"><div class="card-title">请假申请 ${badge('审批中', 'warm')}</div>${kv('请假时间', '10月5日 全天')}${kv('原因', '家中有事')}${notice('warm', 'triangle-alert', '这个时段有 1 笔已接订单（尾号 0168，19:00），店长改派后才能批准。')}</div>` +
  `<div class="actions" style="margin-top:0">${B('当天紧急请假', 'secondary')}${B('申请请假')}</div></div>`,
  tabs: tabbar('tech', '排班')});

S['t-profile'] = () => page({time: '20:40', header: nav('我的档案'), body:
  `<div class="detail"><div class="card"><div class="person">${av('林')}<div class="grow"><div class="row"><h3>林师傅</h3>${badge('在岗', 'good')}</div><p>天俪·示例门店 · 天俪培训学院 2024 年第 6 期</p></div></div></div>` +
  notice('warm', 'shield-alert', '意外保险将在 <b>10月15日</b> 到期（还有 14 天），到期当天会自动停止接单，请尽快续保并上传新保单。') +
  `<div class="card">` +
  `<div class="list-row">${I('award')}<div class="grow">证书<p>TL-2024-06-0132</p></div>${chev}</div>` +
  `<div class="list-row">${I('shield-check')}<div class="grow">意外保险<p>保单至 2026-10-15</p></div>${B('上传新保单', 'soft', 'style="min-height:32px;font-size:12px;padding:0 10px"')}</div>` +
  `<div class="list-row">${I('id-card')}<div class="grow">实名与人脸核身<p>已通过</p></div>${chev}</div></div>` +
  `<div class="card"><div class="card-title">评价 <small>近 90 天 4.9 · 126 条</small></div>` +
  `<div class="list-row"><div class="grow"><span class="star-mini">★★</span><span class="muted">☆☆☆</span> 9月30日<p>"迟到了几分钟"</p></div>${B('申诉', 'secondary', 'style="min-height:32px;font-size:12px;padding:0 12px"')}</div>` +
  `<p class="small muted">1–2 星评价可以在 7 天内申诉一次，门店初审、集团终审。</p></div>` +
  `<div class="card"><div class="card-title">处罚记录</div><div class="list-row"><div class="grow">警告 · 迟到<p>9月12日 · 门店处理</p></div>${badge('已申诉 · 维持')}</div></div></div>`});

S['t-suspended'] = () => page({time: '09:10', header: nav('工作台', false), body:
  workerHeader(badge('停单', 'redtext')) + `<div class="banner red">${I('octagon-pause')}<div><strong>已暂停接单</strong><p>意外保险已于 10月15日到期。续保并上传新保单，审核通过后恢复接单。</p></div></div>` +
  `<div class="stats" style="padding-top:14px"><div class="stat"><strong>0</strong><span>今日订单</span></div><div class="stat"><strong>0</strong><span>待确认</span></div><div class="stat"><strong>0</strong><span>已完成</span></div></div>` +
  `<div class="block" style="padding-top:28px"><div class="ring">${I('calendar-x')}</div><h2>停单期间不会收到新订单</h2><p>你名下 2 笔已接订单已交给店长改派。</p><div class="actions">${B('上传新保单', 'primary full')}${B('联系门店', 'secondary full')}</div></div>`,
  bodyClass: 'surface', tabs: tabbar('tech', '工作台')});

// ---------- 店长小程序 ----------
const storeHeader = () => `<section class="store-header surface">${I('store')}<div><strong>天俪·示例门店</strong><p>10月2日 · 今日门店订单</p></div><button>店长${I('chevron-down')}</button></section>`;
const storeStats = (a = 2, b = 3, c = 12) => `<div class="stats"><div class="stat emphasis"><strong>${a}</strong><span>待派单</span></div><div class="stat"><strong>${b}</strong><span>服务中</span></div><div class="stat"><strong>${c}</strong><span>今日订单</span></div></div>`;
const sosAlert = () => `<section class="sos-alert" role="alert"><div class="alert-heading">${I('siren')}安全求助 · 待接报<time>01:52 后升级</time></div><p>技师 林师傅 发起 · 订单尾号 0126 · 雅园小区 6号楼</p><p class="sub">14:06 已记录位置 · 同时通知集团值班客服</p><div class="actions">${B(I('phone') + '拨打技师', 'ghost')}${B('立即接报', 'white')}</div></section>`;
const dispatchCard = (no, title, time, place, remain, meta) => `<div class="order-card"><div class="order-top"><span>订单尾号 ${no}</span><span class="timer">${I('timer')}剩余 ${remain}</span></div><div class="order-title"><h3>${title}</h3>${badge('待派单', 'warm')}</div><div class="order-time"><small>今天</small>${time}</div><div class="order-place">${I('map-pin')}${place}</div><div class="order-meta">${meta}</div><div class="actions">${B('选择技师派单', 'primary full')}</div></div>`;
const dispatchBody = (alert = true) => storeHeader() + storeStats() + (alert ? sosAlert() : '') +
  `<div class="filterbar"><button class="selected">待派单 <span class="count">2</span></button><button>全部订单</button></div><div class="order-list">` +
  dispatchCard('0158', '舒缓放松 · 60分钟', '17:00–18:00', '幸福里小区 · 2号楼', '18分36秒', '<span>就近安排</span><span>原技师拒单，需店内改派</span>') +
  dispatchCard('0161', '肩颈放松 · 45分钟', '18:00–18:45', '阳光花园 · 3号楼', '24分08秒', '<span>指定技师</span><span>改派需用户确认</span>') + '</div>';

S['s-dispatch'] = () => page({time: '14:07', header: nav('门店派单', false), body: dispatchBody(true), tabs: tabbar('store', '派单', '告警')});

S['s-pick'] = () => page({time: '14:12', header: nav('门店派单', false), body: dispatchBody(false), tabs: tabbar('store', '派单', '告警'), overlay: sheet('选择技师派单',
  `<div class="card" style="background:#f7f8f9;margin:0 0 12px">${kv('订单', '尾号 0158 · 舒缓放松 60分钟')}${kv('时间', '今天 17:00–18:00')}${kv('派单方式', '就近安排 · 性别偏好不限')}</div>` +
  `<button class="choice selected"><span class="grow">陈师傅 ${badge('可约', 'good')}<small>1.8km · ★4.8 · 今日已接 2 单</small></span><span class="radio on"></span></button>` +
  `<button class="choice"><span class="grow">周师傅 ${badge('可约', 'good')}<small>3.1km · 新技师 · 今日已接 1 单</small></span><span class="radio"></span></button>` +
  `<button class="choice" disabled><span class="grow">李师傅 ${badge('时段冲突')}<small>16:30–18:30 已有订单</small></span></button>` +
  `<button class="choice" disabled><span class="grow">赵师傅 ${badge('请假')}<small>今天全天请假</small></span></button>` +
  `<p class="small muted">就近安排的订单改派不需要用户确认，派单后会通知用户。派单期限还剩 13分36秒。</p>`,
  `<div class="actions">${B('确认派单', 'primary full')}</div>`)});

S['s-sos-handling'] = () => page({time: '14:18', header: nav('门店派单', false), body: storeHeader() + storeStats() +
  `<section class="handling"><div class="alert-heading">${I('shield-alert')}安全求助 · 处理中<time>接报人 张店长 14:07</time></div><p style="font-size:12px;margin-top:6px">技师 林师傅 · 订单尾号 0126 · 雅园小区 6号楼</p><div class="actions">${B(I('phone') + '技师', 'secondary')}${B(I('phone') + '用户', 'secondary')}${B('110', 'secondary')}</div></section>`,
  tabs: tabbar('store', '派单', '告警'), overlay: sheet('记录处理结果',
  `<p class="small muted">确认已联系当事人、完成处理后再结案。</p>` +
  `<label class="card-title" for="sosResult" style="margin-top:12px">处理结果</label><textarea id="sosResult" name="sosResult" class="runtime-textarea" required>14:09 电话联系技师，确认人身安全；用户情绪激动，技师已离开现场。已通知集团客服跟进订单。</textarea>` +
  `<div class="card-title" style="margin-top:12px">是否报警</div><div class="segmented" style="margin:0"><button class="on">未报警</button><button>已报警</button></div>` +
  check(true, '订单转"客服介入"，由集团客服核实') +
  `<p class="small muted">结案后，事件记录和每次通知记录保存在集团安全中心。</p>`,
  `<div class="actions">${B('提交并结案', 'primary full')}</div>`)});

S['s-orders'] = () => page({time: '14:20', header: nav('今日订单', false), body:
  `<div class="filterbar"><button>全部 <span class="count">12</span></button><button>进行中 <span class="count">3</span></button><button class="selected">异常 <span class="count">3</span></button></div><div class="order-list">` +
  techOrderCard({no: '0144', time: '14:00–15:00', place: '雅园小区 · 6号楼', st: '未按时出发', stCls: 'redtext', meta: '<span>周师傅</span><span>已过开始时间，仍未出发</span>', actions: `<div class="actions">${B('联系技师', 'secondary')}${B('改派')}</div>`}) +
  techOrderCard({no: '0139', time: '13:30–14:30', place: '阳光花园 · 3号楼', st: '定位失败', stCls: 'warm', meta: '<span>李师傅 · 服务中</span><span>14:02 后未获取到位置</span>', actions: `<div class="actions">${B('联系技师', 'secondary')}</div>`}) +
  `<div class="order-card"><div class="order-top"><span>订单尾号 0121 · 售后退款</span>${badge('退款待垫付', 'redtext')}</div><div class="order-title"><h3>退款 ¥98.00 未成功</h3></div><div class="order-place">${I('circle-alert')}商户号余额不足，充值后系统自动重试</div><div class="order-meta"><span>舒缓放松 · 9月30日</span><span>集团财务已收到通知</span></div><div class="actions">${B('查看充值说明', 'secondary')}</div></div>` + '</div>',
  tabs: tabbar('store', '今日订单', '告警')});

S['s-aftersale'] = () => page({time: '15:10', header: nav('售后处理'), body:
  `<div class="detail"><div class="card"><div class="order-top" style="margin:0 0 6px"><span>订单尾号 0117 · 王女士</span><span class="timer" style="color:var(--brand)">${I('timer')}剩余 18小时40分</span></div>${kv('服务', '舒缓放松 · 林师傅 · 10月2日')}${kv('问题类型', '时长不足')}${kv('用户诉求', '退款 ¥98.00')}<div class="textarea" style="background:#f7f8f9;border:0">实际服务大约 50 分钟，比预约的 60 分钟少了 10 分钟左右。</div><div class="uploads"><span class="upload img"></span></div></div>` +
  `<div class="card"><div class="card-title">技师说明</div><p class="small" style="color:#4b5159">14:05 开始服务，14:55 结束打卡，用户 14:50 表示可以结束。</p></div>` +
  notice('gray', 'info', '24 小时内未处理将自动转集团客服；用户不接受门店方案时，可以申请集团介入，集团裁决为最终结果。') + '</div>',
  foot: footer(B('驳回', 'secondary tiny'), B('部分退款', 'secondary'), B('同意退款 ¥98')), overlay: sheet('部分退款',
  `<label class="field"><span>退款金额</span><input class="runtime-input" name="refundOffer" type="number" min="0" max="98" step="0.01" value="49.67" required></label><p class="small muted">按未服务的 10 分钟计算：¥298 × 10 ÷ 60；最多 ¥98.00</p>` +
  `<label class="card-title" for="refundReason" style="margin-top:12px">给用户的说明</label><textarea class="runtime-textarea" id="refundReason" name="refundOfferReason" required>经核实实际服务 50 分钟，按未服务的 10 分钟比例退款。</textarea>` +
  `<p class="small muted" style="margin-top:8px">用户确认接受后执行退款；退款从门店商户号余额支出，分成按退款后的金额重新计算。</p>`,
  `<div class="actions">${B('提交方案', 'primary full')}</div>`)});

S['s-schedule'] = () => page({time: '13:12', header: nav('技师排班', false), body:
  `<div class="detail"><div class="card" style="border:1px solid #ecdcbc;background:#fffaf1"><div class="card-title">紧急请假 ${badge('待审批', 'warm')}</div>` +
  `<div class="person" style="margin-top:4px">${av('林', 'small-avatar')}<div class="grow"><h3>林师傅 · 今天全天</h3><p>原因：身体不适 · 13:10 提交</p></div></div>` +
  notice('warm', 'triangle-alert', '受影响订单 2 笔：尾号 0132（14:00）、0158（17:00）。批准后自动进入待派单池，需要尽快改派。') +
  `<div class="actions" style="margin-top:0">${B('驳回', 'secondary narrow')}${B('批准')}</div></div>` +
  `<div class="card roster"><div class="card-title">今日技师 <small>10月2日</small></div>` +
  `<div class="list-row">${av('陈', 'chen small-avatar')}<div class="grow">陈师傅<p>09:00–21:00 · 已接 2 单</p></div>${badge('空闲', 'good')}</div>` +
  `<div class="list-row">${av('周', 'zhou small-avatar')}<div class="grow">周师傅<p>12:00–22:00 · 已接 1 单</p></div>${badge('服务中', 'warm')}</div>` +
  `<div class="list-row">${av('李', 'small-avatar')}<div class="grow">李师傅<p>保单 10月1日 到期</p></div>${badge('停单', 'redtext')}</div>` +
  `<div class="list-row">${av('赵', 'chen small-avatar')}<div class="grow">赵师傅<p>10月2日 全天</p></div>${badge('请假')}</div></div></div>`,
  tabs: tabbar('store', '排班', '告警')});

S['u-o-refunded'] = () => detail('16:02', hero('售后已完成', '已退款 ¥49.67，按微信退款时效原路退回。', 'gray', 'circle-check'),
  [`<div class="card"><div class="card-title">退款明细</div>${kv('实付金额', '¥298.00')}${kv('退款金额', '<span class="minus">−¥49.67</span>')}${kv('退款原因', '时长不足，你已接受门店方案')}${kv('实际支付', '¥248.33', 'strong sep')}${kv('退款状态', '<span style="color:var(--green)">已退款</span>')}</div>`, serviceCard('10月2日 14:00–15:00'), orderInfo()],
  footer(B('联系客服', 'secondary'), B('再次预约')));

S['u-aftersale-hq'] = () => page({time: '10:05', header: nav('售后进度'), body:
  hero('平台客服处理中', '平台客服将在 <b>47小时55分</b> 内裁决（10月6日 10:00 前），裁决结果为最终结果。', 'warm', 'scale') +
  `<div class="detail"><div class="card"><div class="card-title">处理进度</div><div class="timeline2"><div class="t"><time>10月3日 09:50</time>你提交了售后申请：退款 ¥98.00</div><div class="t"><time>10月3日 15:18</time>门店提出部分退款 ¥49.67</div><div class="t"><time>10月4日 10:00</time>你不接受门店方案，申请平台介入</div><div class="t on"><time>处理中</time>平台客服核实双方说明和服务记录</div></div></div>` +
  `<div class="card">${kv('你的诉求', '退款 ¥98.00')}${kv('门店方案', '部分退款 ¥49.67')}</div>${notice('gray', 'info', '裁决前你可以补充材料；裁决后系统自动执行，门店必须执行裁决结果。')}</div>`,
  foot: footer(B('撤销申请', 'secondary'), B('补充材料'))});

S['u-empty'] = () => page({time: '09:20', header: nav('我的订单', false), bodyClass: 'surface', body:
  `<div class="filterbar"><button class="selected">全部</button><button>进行中</button><button>待评价</button><button>售后</button></div>` +
  `<div class="block"><div class="ring">${I('clipboard-list')}</div><h2>还没有订单</h2><p>预约上门服务后，订单会显示在这里。</p><div class="actions">${B('去预约', 'primary full')}</div></div>`,
  tabs: tabbar('user', '订单')});

S['u-neterror'] = () => page({time: '09:20', header: brandNav(), bodyClass: 'surface', body:
  `<div class="block" style="padding-top:90px"><div class="ring">${I('wifi-off')}</div><h2>网络不太好</h2><p>页面没有加载出来，请检查网络后重试。</p><div class="actions">${B('重新加载', 'primary full')}</div></div>`,
  tabs: tabbar('user', '首页')});

S['t-expired'] = () => page({time: '13:55', header: nav('工作台', false), bodyClass: 'gray', body:
  workerHeader() + `<div class="stats"><div class="stat"><strong>3</strong><span>今日订单</span></div><div class="stat"><strong>0</strong><span>待确认</span></div><div class="stat"><strong>1</strong><span>已完成</span></div></div>` +
  `<div class="filterbar"><button class="selected">全部 <span class="count">3</span></button><button>待确认 <span class="count">0</span></button><button>进行中 <span class="count">1</span></button></div><div class="order-list">` +
  `<div class="order-card" style="opacity:.62"><div class="order-top"><span>订单尾号 0132</span>${badge('已超时')}</div><div class="order-title"><h3>舒缓放松 · 60分钟</h3></div><div class="order-time"><small>今天</small>16:00–17:00</div><div class="order-place">${I('map-pin')}幸福里小区 · 2号楼</div><div class="actions">${B('拒单', 'secondary narrow', 'disabled')}${B('确认接单', 'primary', 'disabled')}</div></div></div>` +
  `<div class="toast">确认时间已过，这笔订单已交给门店派单</div>`,
  tabs: tabbar('tech', '工作台')});

S['t-location'] = () => techDetail('13:31', hero('已接单 · 待出发', '预约 14:00 开始，请按时出发。', 'brand', 'clock'), [customerCard(), techServiceCard()],
  footer(B('联系门店', 'secondary'), B(I('navigation') + '出发')),
  sheet('需要开启位置权限', `<div style="text-align:center;padding:6px 0 12px"><div class="block" style="padding:0"><div class="ring">${I('map-pin-off')}</div></div></div><p>从出发到服务结束，平台需要记录你的位置，用于安全保障和一键求助定位。</p><p class="small muted">未开启位置权限不能点"出发"。位置记录仅门店值班人员和集团安全人员可见，保留 30 天。</p>`,
  `<div class="actions">${B('暂不开启', 'secondary')}${B('去开启')}</div>`));

// ---------- 渲染 ----------
function render() {
  const app = document.getElementById('app');
  if (!app) return;
  const fn = S[sid];
  app.innerHTML = fn ? fn() : `<div class="empty"><h3>未找到页面</h3><p>${sid}</p></div>`;
  window.PrototypeRuntime?.hydrate(app, sid);
  const navTitle=app.querySelector('.navigation h1'),navCapsule=app.querySelector('.navigation .capsule');
  if(navTitle&&navCapsule){
    if(navTitle.textContent==='集团已撤销本次处罚')navTitle.textContent='处罚已撤销';
    const center=app.getBoundingClientRect().left+app.clientWidth/2;
    const available=2*(navCapsule.getBoundingClientRect().left-center-6);
    navTitle.style.whiteSpace='nowrap';
    for(let size=17;size>=14;size--){navTitle.style.fontSize=size+'px';if(navTitle.getBoundingClientRect().width<=available)break;}
  }
  document.title = '天俪 · ' + ((window.SCREENS || []).find(s => s.id === sid)?.title || sid);
  lucide.createIcons({attrs: {'stroke-width': 1.7}});
  document.body.dataset.ready = '1';
}
document.addEventListener('DOMContentLoaded', render);
