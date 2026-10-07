'use strict';
// 用户端补充页面。与 app.js 共用外壳和组件；交互由 flow.js 与 integration.js 接管。
(() => {
  const st = document.createElement('style');
  st.textContent = `
    .u-field{display:flex;flex-direction:column;gap:8px;padding:12px 0;border-bottom:1px solid var(--line)}
    .u-field:last-child{border:0}.u-field>span{font-size:12px;color:var(--muted)}
    .u-field input,.u-field textarea,.u-field select{display:block;width:100%;max-width:100%;min-width:0;border:1px solid #dfe2e6;border-radius:6px;background:#fff;padding:11px 12px;color:var(--ink);font:inherit;font-size:14px;line-height:22px;box-sizing:border-box}
    .u-field textarea{resize:vertical;min-height:88px}.u-field input[type=checkbox]{width:18px;height:18px;accent-color:var(--brand)}
    .u-check{display:flex;align-items:flex-start;gap:9px;font-size:12px;line-height:21px;margin:12px 0}
    .u-check input{width:18px;height:18px;flex:0 0 18px;margin:2px 0 0;accent-color:var(--brand)}
    .u-check a,.u-check button{color:var(--brand);font-size:12px;line-height:21px;text-align:left;justify-content:flex-start}
    .u-menu{width:100%;min-width:0;min-height:54px;text-align:left;justify-content:flex-start;border-bottom:1px solid var(--line);padding:10px 0;gap:10px;line-height:21px;font-size:14px}
    .u-menu:last-child{border:0}.u-menu>svg:first-child{color:#646b74;width:19px;height:19px}.u-menu>svg:last-child{width:15px;height:15px;color:#a0a5ad;margin-left:auto}
    .u-menu small{display:block;color:var(--muted);font-size:11px}.u-option{display:flex;align-items:flex-start;gap:10px;padding:12px 0;border-bottom:1px solid var(--line);line-height:22px}
    .u-option:last-child{border:0}.u-option input{accent-color:var(--brand);margin-top:5px;flex:0 0 16px;width:16px;height:16px}
    .u-option p{font-size:12px;line-height:19px;color:var(--muted);margin-top:3px}.u-option .avatar{width:42px;height:42px;font-size:18px}
    .u-result{text-align:center;padding:25px 12px 20px}.u-result .ring{margin:0 auto 14px}.u-result p{font-size:13px;line-height:22px;color:var(--muted);margin-top:7px}
    .u-policy{font-size:13px;line-height:23px}.u-policy h3{font-size:14px;margin:13px 0 4px}.u-policy p{margin-bottom:8px}
    .u-timeline{display:flex;gap:10px;padding:11px 0;border-bottom:1px solid var(--line);font-size:13px;line-height:22px}.u-timeline:last-child{border:0}.u-timeline>svg{width:17px;height:17px;color:var(--green);margin-top:3px}.u-timeline p{font-size:11px;line-height:18px;color:var(--muted)}
    .u-amount{font-size:32px;font-weight:700;line-height:42px;font-variant-numeric:tabular-nums;letter-spacing:-.6px}.u-note{padding:0 4px;color:var(--muted);font-size:12px;line-height:21px;margin:8px 0}
    .u-poster{background:#fff;border:1px solid var(--line);padding:26px 20px;border-radius:10px;text-align:center}.u-poster .service-art{width:104px;height:114px;margin:16px auto}.u-poster .qr{width:104px;height:104px;margin:20px auto 12px}.u-poster h2{font-size:23px;line-height:34px}.u-poster p{font-size:13px;line-height:23px;color:var(--muted)}
    .u-status-filters{display:flex;gap:6px;overflow-x:auto;padding:8px 0;scrollbar-width:none}.u-status-filters button{min-height:36px;padding:0 10px;border-radius:5px;font-size:12px;background:#f5f6f7;white-space:nowrap}.u-status-filters button.on{background:var(--brand-soft);color:var(--brand)}
    .u-service-process{display:flex;align-items:center;gap:7px;padding:14px 0;flex-wrap:wrap;font-size:12px;color:var(--muted)}.u-service-process b{font-weight:500;color:var(--ink)}.u-service-process svg{width:13px;height:13px}
    @media(max-width:350px){.u-amount{font-size:29px}.u-option .badge{font-size:10px}.u-menu{font-size:13px}}
  `;
  document.head.append(st);
  const btn = (label, id, cls = 'primary') => B(label, cls, `data-go="${id}"`);
  const act = (label, action, cls = 'primary', extra = '') => B(label, cls, `data-action="${action}" ${extra}`);
  const field = (label, name, value = '', type = 'text', extra = '') => `<label class="u-field"><span>${label}</span><input name="${name}" type="${type}" value="${value}" ${extra}></label>`;
  const area = (label, name, placeholder = '') => `<label class="u-field"><span>${label}</span><textarea name="${name}" placeholder="${placeholder}"></textarea></label>`;
  const cb = (name, text, checked = false) => `<label class="u-check"><input type="checkbox" name="${name}" ${checked ? 'checked' : ''}><span>${text}</span></label>`;
  const menu = (icon, title, id, sub = '') => `<button class="u-menu" data-go="${id}">${I(icon)}<span class="grow">${title}${sub ? `<small>${sub}</small>` : ''}</span>${chev}</button>`;
  const frame = (title, body, foot = '', tabs = '') => page({time:'10:08',header:nav(title),body:`<div class="detail">${body}</div>`,foot,tabs});
  const card = html => `<section class="card">${html}</section>`;
  const result = (icon, title, desc, tone = '') => `<div class="u-result"><div class="ring ${tone}">${I(icon)}</div><h2>${title}</h2><p>${desc}</p></div>`;
  const invoiceMeta = amount => card(kv('开票金额', `<strong>¥${amount}</strong>`) + kv('开票方','天俪·示例门店') + kv('发票类型','电子普通发票') + kv('关联订单','订单尾号 0132'));
  const invoiceRecipient = () => card(kv('抬头','上海某某科技有限公司') + kv('税号','91310000MA1XXXXXXX') + kv('接收邮箱','wang@example.com'));
  const withdrawMeta = () => card(kv('提现金额','<strong>¥186.40</strong>') + kv('收款方式','微信零钱') + kv('提现单号','TX2026100100041') + kv('提交时间','10月1日 20:16'));

  S['u-service-detail'] = () => frame('项目详情',
    card(`<div class="compact-service flat" style="border:0;padding:0">${art()}<div class="grow"><h2>舒缓放松</h2><p>60 分钟 · 上门保健</p><div class="price" style="margin-top:9px"><em>¥</em>298<small>日间总价</small></div></div></div>`) +
    notice('gray','circle-check','已含上门交通费，无其他附加费用。夜间时段 ¥328，预约时直接显示总价。') +
    card(`<div class="card-title">服务内容</div><p style="font-size:13px;line-height:23px">以全身舒缓为主，服务前确认身体情况和力度偏好，过程中可随时反馈。实际服务按预约项目进行。</p><div class="u-service-process"><b>核对信息</b>${chev}<b>健康确认</b>${chev}<b>舒缓服务</b>${chev}<b>确认结束</b></div>`) +
    card(kv('加钟单位','30 分钟 / ¥149') + kv('加钟次数','每单最多 2 次') + `<p class="u-note">能否加钟以技师后续空闲时间为准，确认后需在 5 分钟内支付。</p>`) +
    card(`<div class="card-title">服务前须知</div><p class="u-policy">服务对象须年满 18 周岁。孕期、急性损伤或骨折未愈、皮肤破损或传染性皮肤病、发热、严重心脑血管疾病、饮酒后暂不提供服务。</p><p class="u-note">本项目用于日常放松，不提供疾病诊断或治疗。服务不适时请及时告知技师。</p>`) +
    card(kv('取消规则','出发前免费 · 出发后扣 20%') + `<p class="u-note">预约开始后 15 分钟技师仍未到达，可免费取消。已到达后的取消请联系客服。</p>`),
    footer(btn('选择技师与时段','u-tech-picker')));

  S['u-tech-picker'] = () => frame('选择技师',
    notice('gray','map-pin','上门地址：幸福里小区。按上门地址匹配可服务的技师。') +
    card(`<div class="card-title">舒缓放松 · 60 分钟 <small>日间 ¥298</small></div><label class="u-option"><input type="radio" name="technician" value="nearest" checked><div class="grow"><strong>就近安排</strong>${badge('推荐','good')}<p>根据距离与可约时段选择，付款前会显示具体技师。</p></div></label>`) +
    card(`<div class="u-status-filters"><button class="on" data-action="tech-sort-distance">距离优先</button><button data-action="tech-sort-rating">评分优先</button></div>` +
      [['林','','林师傅','lin','1.2km · ★4.9（126 条）','明天 14:00 最近可约'],['陈','chen','陈师傅','chen','1.8km · ★4.8（88 条）','今天 15:30 最近可约'],['周','zhou','周师傅','zhou','2.6km · 评价不足 5 条','今天 16:00 最近可约']].map(([n,cls,name,value,meta,time]) => `<label class="u-option"><input type="radio" name="technician" value="${value}">${av(n,cls)}<div class="grow"><strong>${name}</strong>${value === 'zhou' ? badge('新技师','warm') : ''}<p>${meta}</p><p class="availability">${time}</p></div></label>`).join('') + `<div class="actions">${btn('查看技师档案','u-tech-detail','secondary full')}</div>`),
    footer(act('选好技师，选择时段','select-technician')));

  S['u-addresses'] = () => frame('地址管理',
    notice('gray','map-pin','选择后会重新校验门店服务范围与可约技师。') +
    card(`<label class="u-option"><input type="radio" name="selectedAddress" value="home" checked><div class="grow"><div class="row"><strong>幸福里小区 2号楼</strong>${badge('默认','good')}</div><p>8层 802室</p><p>王小雅 · 138****8000</p></div></label><div class="actions">${btn('编辑地址','u-address-edit','secondary full')}${act('使用这个地址','select-address','soft full')}</div>`) +
    card(`<label class="u-option"><input type="radio" name="selectedAddress" value="office"><div class="grow"><strong>银杏商务楼</strong><p>6层 602室 · 王小雅 · 138****8000</p><p>尚未校验当前服务范围</p></div></label><div class="actions">${act('选择并校验','select-office-address','secondary full')}</div>`),
    footer(btn('新增上门地址','u-address-edit')));

  S['u-address-edit'] = () => frame('填写上门地址',
    notice('gray','info','请填写详细上门地址。地址联系人与本次服务对象可以不同。') +
    card(`<form id="address-form">${field('联系人姓名','addressContact','王小雅','text','autocomplete="name" required')}${field('联系手机号','addressPhone','13800008000','tel','inputmode="tel" maxlength="11" required')}${field('城市 / 区县','addressRegion','上海市 · 浦东新区')}${field('小区 / 楼宇','addressBuilding','幸福里小区 2号楼','text','required')}${field('楼层 / 门牌','addressRoom','8层 802室','text','required')}${cb('defaultAddress','设为默认地址',true)}</form>`) +
    card(`<div class="card-title">服务范围</div><p class="u-policy">保存时会重新校验地址是否在服务门店范围内；超出范围时显示原因，并保留填写内容。</p>`),
    footer(act('保存并校验地址','save-address')));

  S['u-recipient'] = () => frame('填写服务对象',
    notice('gray','users','你可以为家人预约。服务对象不必与下单人或地址联系人相同。') +
    card(`<form id="recipient-form">${field('服务对象姓名','recipientName','王女士','text','required')}${field('服务对象手机号','recipientPhone','13800008000','tel','inputmode="tel" maxlength="11" required')}${cb('recipientSelf','服务对象就是我',false)}</form>`) +
    card(`<div class="card-title">预约人信息</div>${kv('下单人','王小雅 · 已实名')}${kv('预约人手机号','138****8000')}<p class="u-note">支付与售后由预约人处理，技师通过平台虚拟号码联系服务对象。</p>`) +
    card(`<form id="recipient-consent">${cb('recipientAdult','我确认服务对象已满 18 周岁',true)}${cb('recipientHealth','我已向服务对象说明健康告知，并确认不属于禁忌人群',true)}<button class="link" data-go="u-health" type="button">查看完整健康告知${chev}</button></form>`),
    footer(act('保存服务对象','save-recipient')));

  S['u-my'] = () => page({time:'10:08',header:nav('我的',false),body:`<div class="detail">` +
    card(`<div class="person">${av('王')}<div class="grow"><h3>王小雅</h3><p>138****8000</p><div class="tag-line">${badge('已实名','good')}</div></div></div>`) +
    card(menu('clipboard-list','我的订单','u-orders') + menu('map-pin','地址管理','u-addresses') + menu('shield-check','安全中心','u-safety') + menu('headset','联系客服','u-customer-service')) +
    card(menu('qr-code','推广中心','u-promo','已有推广身份可查看佣金') + menu('lock-keyhole','隐私设置','u-privacy') + menu('user-round-x','注销账号','u-delete-account')) +
    `<p class="u-note" style="text-align:center">天俪上门保健 · 服务由订单所示门店提供</p></div>`,tabs:tabbar('user','我的')});

  S['u-privacy'] = () => frame('隐私设置',
    card(menu('file-text','隐私政策','u-privacy-detail','当前版本 v1.0 · 2026年10月1日') + menu('badge-check','实名信息处理授权','u-privacy-detail','已同意 · 2026年10月1日 10:05')) +
    card(`<div class="card-title">已记录的同意</div>${kv('隐私政策','v1.0 · 已同意')}${kv('身份证号处理','v1.0 · 单独同意')}${kv('同意时间','2026年10月1日 10:05')}<p class="u-note">身份证号不在后台显示明文，仅用于实名核验。</p>`) +
    notice('gray','info','你可以查看和撤回同意。撤回实名信息授权后，将不能再预约上门服务。'),
    footer(btn('查看授权与撤回说明','u-privacy-detail','secondary')));

  S['u-privacy-detail'] = () => frame('实名信息处理授权',
    card(`<div class="u-policy"><h3>使用目的</h3><p>为首次预约上门服务核验实名信息，平台需要处理姓名和身份证号。核验结果用于确认身份。</p><h3>展示和保留</h3><p>技师与门店不查看身份证号明文。信息在账号存续期间保留，账号注销后按平台规则删除或匿名化。</p><h3>撤回后的影响</h3><p>撤回后不能新建上门服务预约。已有订单、退款和售后仍可通过订单页面或客服处理。</p><h3>你的同意记录</h3><p>版本：v1.0<br>同意时间：2026年10月1日 10:05</p></div>`) +
    notice('gray','info','提交撤回后会显示结果；再次预约时，需要重新授权并完成实名核验。'),
    footer(act('撤回这项授权','privacy-withdraw','secondary')));

  S['u-privacy-withdrawn'] = () => frame('授权已撤回',
    result('shield-check','实名信息授权已撤回','撤回时间：10月1日 10:10。当前不能新建上门预约。') +
    card(menu('clipboard-list','查看已有订单','u-orders') + menu('headset','联系客服','u-customer-service')),
    footer(btn('重新授权并核验','u-realname-form')));

  S['u-realname-form'] = () => frame('实名核验',
    notice('gray','shield-check','姓名和身份证号用于身份核验，不会展示给技师或门店。请使用本人真实信息。') +
    card(`<form id="realname-form">${field('本人姓名','legalName','','text','autocomplete="name" placeholder="请输入本人姓名" required')}${field('身份证号','identityNumber','','text','maxlength="18" placeholder="请输入18位身份证号" required')}${field('手机号','legalPhone','13800008000','tel','inputmode="tel" maxlength="11" required')}${cb('identityConsent','我已阅读《实名信息处理授权》，同意为实名核验处理我的身份证号')}<button type="button" class="link" data-go="u-privacy-detail">查看单独授权说明${chev}</button></form>`),
    footer(act('授权并提交核验','submit-realname')));

  S['u-delete-account'] = () => frame('注销账号',
    notice('gray','circle-alert','注销后账号资料将删除或匿名化，无法继续使用该账号预约服务。') +
    card(`<div class="card-title">注销前检查</div>${kv('进行中的订单','无')}${kv('退款 / 售后 / 安全事件','无未处理事项')}${kv('推广账户','无可提现余额或提现中款项')}<p class="u-note">如有未完成的订单、售后或资金事项，请先完成处理，再提交注销。</p>`) +
    card(`<div class="u-policy"><p>注销后手机号解绑，身份证号删除，历史订单中的个人信息按平台保留规则删除或匿名化。</p><p>与未处理纠纷或安全事件相关的记录，需先完成处理。</p></div><form id="delete-account-form">${cb('deleteConsent','我已了解注销结果，并确认申请注销这个账号')}</form>`),
    footer(act('确认申请注销','delete-account','secondary')));

  S['u-deleted'] = () => frame('账号已注销',
    result('user-round-check','注销已完成','账号资料已按隐私规则删除或匿名化。手机号已解绑。') +
    card(`<p class="u-policy">如需再次使用，可以重新登录并完成实名核验。此前的推广身份和授权不会自动恢复。</p>`),
    footer(btn('返回首页','u-home','secondary')));

  S['u-safety'] = () => frame('安全中心',
    card(menu('contact-round','紧急联系人','u-emergency-contact','王先生 · 139****6000')) +
    card(`<div class="card-title">当前订单</div>${kv('服务项目','舒缓放松 · 60 分钟')}${kv('技师 / 门店','林师傅 · 天俪·示例门店')}${kv('订单状态','服务中')}<div class="actions">${btn('查看订单','u-o-serving','secondary full')}</div>`) +
    notice('gray','shield-alert','平台求助从技师出发开始，到服务结束后 2 小时内可用。紧急危险请直接拨打 110。') +
    card(`<div class="card-title">平台求助</div><p class="u-policy">发起后将通知门店与集团值班人员，附带当前订单和定位信息；定位失败时保留最后已知位置。</p><div class="actions">${btn('当前订单求助','u-sos','ghost-red full')}</div>`),
    footer(act(I('phone') + '直接拨打 110','call-emergency','red')));

  S['u-emergency-contact'] = () => frame('紧急联系人',
    notice('gray','contact-round','请填写可以及时联系到的亲友，并先告知对方。') +
    card(`<form id="emergency-contact-form">${field('姓名','emergencyName','王先生','text','required')}${field('与我的关系','emergencyRelation','家人','text','required')}${field('联系电话','emergencyPhone','13900006000','tel','inputmode="tel" maxlength="11" required')}</form>`) +
    card(`<p class="u-policy">遇到安全事件时，值班人员可按事件情况联系你的紧急联系人。</p>`),
    footer(act('保存紧急联系人','save-emergency-contact')));

  S['u-customer-service'] = () => frame('联系客服',
    card(`<div class="person">${I('headset')}<div class="grow"><h3>天俪客服</h3><p>订单问题优先由服务门店处理</p></div></div><div class="actions">${act('打开微信客服','customer-service-message','primary full')}</div>`) +
    card(`<div class="card-title">订单相关问题</div>${kv('当前订单','尾号 0132 · 舒缓放松')}${kv('服务门店','天俪·示例门店')}<div class="actions">${act('联系服务门店','call-store-customer-service','secondary full')}</div><p class="u-note">门店无法处理或你要求升级时，可以转集团客服。</p>`) +
    card(`<div class="card-title">其他问题与申诉</div><p class="u-policy">账号限制、推广佣金和隐私信息问题，可联系集团客服说明。</p><div class="actions">${act('联系集团客服','call-group-customer-service','secondary full')}</div>`),
    footer(btn('返回我的','u-my','secondary')));

  S['u-promo-join'] = () => frame('推广邀请',
    notice('brand','mail-open','天俪·示例门店邀请你成为门店推广员。') +
    card(kv('邀请身份','门店推广员（个人）') + kv('所属门店','天俪·示例门店') + kv('邀请状态','待本人确认')) +
    card(`<div class="card-title">开通步骤</div><div class="u-timeline">${I('file-signature')}<div>阅读并签署推广协议<p>协议版本 v1.0</p></div></div><div class="u-timeline">${I('badge-check')}<div>完成本人实名核验<p>用于推广身份与提现，须与微信实名一致</p></div></div><div class="u-timeline">${I('qr-code')}<div>开通后生成推广码<p>分享小程序卡片或海报，只做一级推广</p></div></div>`) +
    card(`<form id="promo-join-form">${cb('promoAgreement','我已阅读并同意推广协议')}<button type="button" class="link" data-go="u-promo-agreement">查看完整协议${chev}</button></form>`),
    footer(act('拒绝邀请','promo-invitation-decline','secondary'),act('签署并开通','promo-join-submit')));

  S['u-promo-agreement'] = () => frame('推广协议',
    card(`<div class="u-policy"><h3>天俪推广协议 v1.0</h3><p>邀请方：天俪·示例门店<br>身份：门店推广员（个人）</p><h3>推广要求</h3><p>不做虚假宣传，不宣传疗效，不诱导分享，不私下收款。推广仅通过带本人参数的小程序卡片或海报进行。</p><h3>佣金与客户信息</h3><p>只做一级推广，订单的佣金按适用规则计算。售后期满并且分账成功后转为可提现；退款会相应调整佣金。推广中心仅显示绑定客户数量，不展示客户手机号和地址。</p><h3>违规与退出</h3><p>违反协议会取消推广资格，未结算佣金按协议处理；停用后的可提现佣金仍可按流程提现。</p><h3>协议确认</h3><p>开通前请阅读邀请方提供的正式协议全文，并确认本人姓名与实名信息。</p></div>`) +
    notice('gray','file-text','签署后可在推广中心查看协议版本和签署时间。'),
    footer(btn('返回邀请并确认','u-promo-join')));

  S['u-promo-declined'] = () => frame('邀请已拒绝',
    result('mail-check','已拒绝本次推广邀请','推广身份未开通。你仍可正常预约和查看服务订单。'),
    footer(btn('返回我的','u-my','secondary')));

  S['u-invoice-form'] = () => frame('申请发票',
    invoiceMeta('298.00') +
    card(`<form id="invoice-form"><label class="u-field"><span>抬头类型</span><select name="invoiceType"><option value="company">企业</option><option value="personal">个人</option></select></label>${field('抬头名称','invoiceTitle','上海某某科技有限公司','text','required')}${field('税号（企业必填）','invoiceTax','91310000MA1XXXXXXX','text','maxlength="20"')}${field('接收邮箱','invoiceEmail','wang@example.com','email','required')}</form>`) +
    notice('gray','info','按实付金额扣除已退款金额开具；主订单与加钟可合并开票。门店开具后可查看、下载。') +
    `<p class="u-note">服务完成后 90 天内可申请。开票后发生退款，会进入待红冲，由门店红冲后按新金额重新开具。</p>`,
    footer(act('提交开票申请','invoice-submit')));

  S['u-invoice-pending'] = () => frame('发票详情',
    result('file-clock','待开票','申请已提交，等待服务门店开具电子发票。') + invoiceMeta('298.00') + invoiceRecipient() +
    card(kv('申请时间','10月2日 15:12') + `<p class="u-note">开票完成后通过订单通知告知，可在本页查看和下载。</p>`),
    footer(btn('联系客服','u-customer-service','secondary'),btn('查看订单','u-o-done','secondary')));

  S['u-invoice-issued'] = () => frame('发票详情',
    result('file-check','已开票','电子发票已发送至 wang@example.com。') + invoiceMeta('298.00') + invoiceRecipient() +
    card(kv('开票日期','2026年10月3日') + kv('发票号码','示例 24003100123456789012')),
    footer(act('重新发送邮箱','invoice-email','secondary'),act('查看电子发票','invoice-download')));

  S['u-invoice-red'] = () => frame('发票详情',
    result('file-warning','待红冲','订单已退款 ¥98.00，原发票需要由门店红冲。') +
    card(kv('原发票金额','¥298.00') + kv('已退款金额','¥98.00') + kv('重新开票金额','<strong>¥200.00</strong>') + kv('当前进度','门店处理中')) +
    notice('gray','info','红冲完成后按退款后的金额重新开具。原发票目前处于待红冲状态。'),
    footer(btn('联系客服','u-customer-service','secondary'),btn('查看退款订单','u-o-refunded','secondary')));

  S['u-invoice-redone'] = () => frame('发票详情',
    result('file-minus','已红冲','原 ¥298.00 发票已完成红冲，按 ¥200.00 重新开票。') +
    card(kv('原发票状态','已红冲') + kv('退款后金额','<strong>¥200.00</strong>') + kv('新发票状态','待开票')) + invoiceRecipient() +
    notice('gray','file-clock','新的电子发票开具后会发送到接收邮箱。'),
    footer(btn('联系客服','u-customer-service','secondary'),btn('查看订单','u-o-refunded','secondary')));

  S['u-invoice-rejected'] = () => frame('发票详情',
    result('file-x','申请已驳回','门店反馈：企业抬头与税号信息不一致，请核对后重新申请。') + invoiceMeta('298.00') + invoiceRecipient() +
    card(kv('处理时间','10月3日 09:20') + `<p class="u-note">驳回不会改变订单金额。可以修改抬头、税号和邮箱后重新提交。</p>`),
    footer(btn('联系客服','u-customer-service','secondary'),btn('修改并重新申请','u-invoice-form')));

  const withdrawalPage = (icon,title,desc,extra,foot) => frame('提现详情',result(icon,title,desc) + withdrawMeta() + extra,foot);
  S['u-withdraw-processing'] = () => withdrawalPage('wallet','提现处理中','转账已受理，等待最终结果。',
    notice('gray','clock','正在处理的 ¥186.40 已从可提现余额中锁定，不能重复申请。到账以微信最终通知为准。'),
    footer(btn('返回推广中心','u-promo','secondary'),act('刷新进度','withdraw-query','secondary')));
  S['u-withdraw-success'] = () => withdrawalPage('circle-check','提现已到账','¥186.40 已转入微信零钱。',
    card(kv('到账时间','10月1日 20:18') + kv('佣金状态','已提现')),
    footer(btn('返回推广中心','u-promo')));
  S['u-withdraw-failed'] = () => withdrawalPage('circle-alert','提现失败','微信反馈：收款账户实名信息不一致。',
    notice('gray','rotate-ccw','¥186.40 已恢复为可提现。请核对实名信息后再申请；重复刷新不会重复转账。'),
    footer(btn('联系客服','u-customer-service','secondary'),btn('核对实名信息','u-realname-form')));
  S['u-withdraw-revoked'] = () => withdrawalPage('rotate-ccw','提现已撤销','未在微信规定的有效期内确认收款，本次转账已撤销。',
    notice('gray','wallet','¥186.40 已恢复为可提现，可以重新申请。'),
    footer(btn('返回推广中心','u-promo','secondary'),btn('重新申请提现','u-withdraw')));
  S['u-withdraw-confirm'] = () => withdrawalPage('hand-coins','等待你确认收款','本次使用逐笔确认收款模式，请在微信有效期内完成确认。',
    card(`<div class="card-title">未开通免确认收款</div><p class="u-policy">本次需要你确认到账。未在微信显示的截止时间前确认，会撤销并恢复可提现余额。</p><div class="actions">${act('开通免确认授权','withdraw-authorize','secondary full')}</div>`) +
    `<p class="u-note">页面会跳转至微信收款确认。确认后返回本页查看最终结果。</p>`,
    footer(act('确认收款','withdraw-confirm-receipt')));

  const commissionRow = (title,no,amount,state,tone = '') => `<div class="list-row"><div class="grow">${title}<p>订单尾号 ${no} · 10月2日</p></div><div style="text-align:right"><div class="amount">${amount}</div>${badge(state,tone)}</div></div>`;
  S['u-commission'] = () => frame('佣金明细',
    card(`<div class="u-status-filters"><button class="on" data-action="commission-filter-all">全部</button><button data-action="commission-filter-pending">待结算</button><button data-action="commission-filter-available">可提现</button><button data-action="commission-filter-paid">已提现</button><button data-action="commission-filter-clawback">待扣回</button></div>`) +
    card(commissionRow('首单佣金','0132','+¥29.80','待结算','warm') + commissionRow('复购佣金','0098','+¥14.90','可提现','good') + commissionRow('首单佣金','0086','¥29.80','提现中','warm') + commissionRow('复购佣金','0080','¥14.90','已提现','good') + commissionRow('订单全额退款','0074','¥0.00','已作废') + commissionRow('部分退款佣金调减','0062','−¥9.80','待扣回','redtext')) +
    notice('gray','info','待扣回 ¥9.80 会从后续佣金抵扣。可提现余额＝可提现佣金减去待扣回金额。客户手机号和地址不展示。'),
    footer(btn('查看提现进度','u-withdraw-processing','secondary'),btn('返回推广中心','u-promo','secondary')));

  S['u-poster'] = () => frame('推广海报',
    `<div class="u-poster"><div class="row" style="justify-content:center"><span class="brand-mark">俪</span><strong>天俪上门保健</strong></div>${art()}<h2>预约上门舒缓服务</h2><p style="margin-top:9px">明码标价 · 培训记录可查<br>由服务门店负责</p><div class="qr">${I('qr-code')}</div><p>微信扫码查看服务与可约技师</p><p style="font-size:11px;margin-top:8px">推广员：王小雅 · 天俪·示例门店</p></div>` +
    `<p class="u-note">小程序码带本人推广身份参数。通过海报首次进入的客户，按绑定规则确定归属。</p>`,
    footer(act('保存海报','promo-save-poster','secondary'),act('分享小程序卡片','promo-share')));

  // 原有编号保留；旧入口使用同一份真实表单，避免两套提交逻辑。
  S['u-realname']=()=>S['u-realname-form']();
  S['u-invoice']=()=>S['u-invoice-form']();
  const meta = [
    ['u-service-detail','下单','项目详情','一口价与服务须知','项目时长、流程、总价、加钟单位、禁忌和取消规则。','07 用户端 · 02 §2、§7、§8'],
    ['u-tech-picker','下单','选择技师','就近 / 指定技师','可选择就近安排；真实单选控件区分技师，附近技师显示距离、评分和可约时间。','07 用户端 · 11 §3'],
    ['u-addresses','下单','地址管理','选择 / 编辑','地址联系人与服务对象分别管理，选地址时重新校验服务范围。','07 用户端 · 02 §2'],
    ['u-address-edit','下单','填写地址','首次 / 编辑','姓名、手机号、楼宇与门牌使用真实表单，保存时校验地址。','07 用户端 · 02 §2'],
    ['u-recipient','下单','填写服务对象','为本人 / 家人预约','服务对象可以不同于下单人和地址联系人；健康与成年确认绑定服务对象。','07 用户端 · 02 §2 · 09 A4'],
    ['u-realname-form','下单','实名核验','填写 / 单独授权','首次或撤回后重新核验；本人姓名与身份证号使用真实表单。','05 §3、§5 · 07 用户端'],
    ['u-my','账户与安全','我的','已实名','订单、地址、安全、客服、推广、隐私和注销入口。','07 用户端'],
    ['u-privacy','账户与安全','隐私设置','查看同意记录','显示授权版本与同意时间，引导查看和撤回。','05 §4、§5 · 07 用户端'],
    ['u-privacy-detail','账户与安全','实名授权','撤回说明','说明处理目的、保留期限与撤回后的预约限制。','05 §4、§5'],
    ['u-privacy-withdrawn','账户与安全','授权结果','已撤回','撤回后不能新建预约，保留已有订单和客服入口，重新授权须核验。','05 §5 · 13 §3'],
    ['u-delete-account','账户与安全','注销账号','提交前检查','检查未完订单、资金和安全事项，再确认注销。','05 §4 · 07 用户端'],
    ['u-deleted','账户与安全','注销结果','已注销','显示删除或匿名化结果与重新使用入口。','05 §4 · 07 用户端'],
    ['u-safety','账户与安全','安全中心','当前订单关联','显示紧急联系人、关联订单、平台求助和直接拨打110。','05 §1 · 07 用户端'],
    ['u-emergency-contact','账户与安全','紧急联系人','填写 / 编辑','使用真实表单填写姓名、关系和电话。','07 用户端 · 05 §1'],
    ['u-customer-service','账户与安全','联系客服','门店 / 集团','订单问题先转门店，可按用户要求转集团；提供微信客服入口。','11 §5 · 07 用户端'],
    ['u-promo-join','推广与提现','推广邀请','待本人签署','显示邀请身份、所属门店、协议与实名要求，签署后开通。','04 §6'],
    ['u-promo-agreement','推广与提现','推广协议','查看版本','展示宣传约束、一级推广、退款调整与隐私边界。','04 §6'],
    ['u-promo-declined','推广与提现','邀请结果','已拒绝','拒绝本次邀请，不开通推广身份。','04 §6'],
    ['u-invoice-form','发票','申请发票','个人 / 企业填写','真实表单填写抬头、税号和邮箱；按退款后金额开具。','03 §11 · 07 用户端'],
    ['u-invoice-pending','发票','发票详情','待开票','申请已受理，等待门店上传电子发票。','03 §11 · 13 §2'],
    ['u-invoice-issued','发票','发票详情','已开票','显示开票信息，可查看下载、重新发送邮箱。','03 §11 · 13 §2'],
    ['u-invoice-red','发票','发票详情','待红冲','退款后原发票待门店红冲，显示原额、退款额和新金额。','03 §11 · 13 §2'],
    ['u-invoice-redone','发票','发票详情','已红冲 / 重开中','原发票已红冲，新发票按退款后的金额等待开具。','03 §11 · 13 §2'],
    ['u-invoice-rejected','发票','发票详情','已驳回','显示驳回理由，保留修改并重提入口。','03 §11 · 13 §2'],
    ['u-withdraw-processing','推广与提现','提现详情','处理中','已锁定佣金，接口受理不等于到账；查询最终状态。','04 §5 · 13 §2'],
    ['u-withdraw-success','推广与提现','提现详情','已到账','显示最终成功结果，佣金为已提现。','04 §5 · 13 §2'],
    ['u-withdraw-failed','推广与提现','提现详情','失败','显示失败原因与余额恢复，核对实名后重试。','04 §5 · 13 §2'],
    ['u-withdraw-revoked','推广与提现','提现详情','已撤销','逾期未确认撤销后恢复可提现，并可重新申请。','04 §5 · 13 §2'],
    ['u-withdraw-confirm','推广与提现','提现详情','待确认收款','未开通免确认授权时，使用逐笔确认收款路径。','04 §5 · 13 §2'],
    ['u-commission','推广与提现','佣金明细','全状态 / 待扣回','覆盖待结算、可提现、提现中、已提现、作废和待扣回，不展示客户隐私。','04 §4、§5 · 13 §2'],
    ['u-poster','推广与提现','推广海报','带本人推广参数','简洁服务介绍、小程序码和本人推广身份，提供保存与分享。','04 §6 · 07 用户端']
  ];
  window.SCREENS.push(...meta.map(([id,group,title,state,caption,ref]) => ({id,role:'user',group:'用户端 · '+group,title,state,caption,ref})));
})();
