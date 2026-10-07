'use strict';
// v3 补充：订单终态、安全失败分支和共享状态。与 app.js 共用组件。
(() => {
  const go = id => `data-go="${id}"`;
  const act = id => `data-action="${id}"`;
  const add = (id, role, group, title, state, caption, ref, renderer) => {
    S[id] = renderer;
    window.SCREENS.push({id, role, group, title, state, caption, ref});
  };
  const orderGroup = '用户端 · 订单状态';
  const afterGroup = '用户端 · 改约、售后、评价、发票';
  const safetyGroup = '用户端 · 推广与安全';
  const sharedGroup = '通用状态';
  const textInput = (name, label, value, attrs = '') => `<label class="field"><span>${label}</span><input name="${name}" value="${value}" ${attrs} style="min-width:0;max-width:100%;width:100%;flex:1;text-align:right;border:0;background:transparent;outline-offset:1px;padding:10px 0;color:var(--ink)"></label>`;
  const infoTimeline = rows => `<div class="card"><div class="card-title">处理进度</div><div class="timeline2">${rows.map(([at, content, on]) => `<div class="t ${on ? 'on' : ''}"><time>${at}</time>${content}</div>`).join('')}</div></div>`;
  const contact = () => B('联系客服', 'secondary', act('contact-customer-service'));
  const orderReturn = (id = 'u-o-serving') => B('返回订单', 'secondary', go(id));

  add('u-o-closed', 'user', orderGroup, '订单详情', '已关闭 · 未支付',
    '支付超时并确认未支付后关闭；没有扣款，时段释放。重新预约时重新校验库存。', '02 §4、§8 · 13 §1',
    () => detail('10:21', hero('订单已关闭', '支付时间已过，已确认本单未支付，技师和时段已释放。', 'gray', 'circle-x'),
      [serviceCard('明天 10月2日 14:00–15:00'), `<div class="card">${kv('订单编号', 'TL2026100100132')}${kv('关闭原因', '15 分钟内未完成支付')}${kv('支付状态', '未支付 · 未产生费用')}</div>`],
      footer(contact(), B('重新预约', 'primary', go('u-home')))));

  add('u-o-settled', 'user', orderGroup, '订单详情', '已完成 · 售后期已过',
    '用户仍看到已完成；售后期满隐藏申请售后，评价和发票按各自期限可用。', '11 §1、§3 · 03 §11 · 13 §1',
    () => detail('09:20', hero('服务已完成', '本单自助售后期已于 10月4日 15:00 结束。如有问题，请联系客服。', 'green', 'circle-check', steps(5)),
      [techCard({right: ''}), serviceCard('10月2日 14:00–15:00'), `<div class="card"><div class="card-title">可用服务</div>${kv('评价', '10月9日 15:00 前可评价一次')}${kv('发票', '12月31日 15:00 前可申请')}${kv('售后', '服务完成后 30 天内可联系客服核实')}</div>`, orderInfo()],
      footer(contact(), B('开发票', 'secondary', go('u-invoice')), B('去评价', 'primary', go('u-review')))));

  add('u-o-history', 'user', orderGroup, '订单详情', '已完成 · 评价与开票期限已过',
    '期限结束后保留订单记录，不再显示评价、发票申请、售后申请按钮。', '11 §1、§3 · 03 §11 · 13 §1',
    () => detail('09:20', hero('服务已完成', '本单评价、售后及发票申请期限已结束。订单记录仍可查看。', 'gray', 'clipboard-check', steps(5)),
      [serviceCard('2026年6月20日 14:00–15:00'), `<div class="card">${kv('评价期限', '6月27日 15:00 · 已结束')}${kv('售后客服受理期限', '7月20日 15:00 · 已结束')}${kv('发票申请期限', '9月18日 15:00 · 已结束')}</div>`, `<div class="card">${kv('订单编号', 'TL2026062000098')}${kv('服务门店', '天俪·示例门店')}${kv('实付金额', '¥298.00')}</div>`],
      footer(contact(), B('再次预约', 'primary', go('u-home')))));

  add('u-refund-processing', 'user', orderGroup, '退款进度', '退款执行中',
    '接受退款方案后进入执行中，分清平台发起退款与微信确认退款成功，未成功不能显示已到账。', '03 §6、§7 · 13 §1',
    () => page({time: '16:01', header: nav('退款进度'), body:
      hero('退款处理中', '退款申请已提交，正在等待支付渠道结果。当前尚未确认退款成功。', 'warm', 'hourglass') +
      `<div class="detail"><div class="card">${kv('退款金额', '¥49.67', 'strong')}${kv('退款方式', '原支付渠道退回')}${kv('申请时间', '10月3日 16:00')}${kv('退款原因', '时长不足，你已接受门店方案')}${kv('退款状态', '执行中 · 请等待结果')}</div>` +
      infoTimeline([['16:00', '你已接受部分退款方案'], ['16:01', '退款已提交支付渠道', true], ['待确认', '渠道确认退款结果后通知你']]) +
      notice('gray', 'info', '请以退款成功通知和支付账单为准。暂时失败会自动重试，无需重复申请。') + '</div>',
      foot: footer(contact(), B('刷新进度', 'primary', act('refund-refresh')))}));

  add('u-refund-received', 'user', orderGroup, '退款进度', '退款成功',
    '只有支付渠道确认成功才展示退款成功；展示退款金额和退款后的实际支付。', '03 §6、§7 · 13 §1',
    () => page({time: '16:02', header: nav('退款进度'), body:
      hero('退款成功', '支付渠道已确认退款 ¥49.67 成功，可在原支付账单查看。', 'green', 'circle-check') +
      `<div class="detail"><div class="card">${kv('原支付金额', '¥298.00')}${kv('本次退款', '¥49.67', 'strong')}${kv('退款后实际支付', '¥248.33')}${kv('退款方式', '原支付渠道退回')}${kv('退款完成时间', '10月3日 16:02')}</div>` +
      infoTimeline([['16:00', '你已接受部分退款方案'], ['16:01', '退款已提交支付渠道'], ['16:02', '支付渠道确认退款成功', true]]) + '</div>',
      foot: footer(B('查看订单', 'secondary', go('u-o-refunded')), B('再次预约', 'primary', go('u-home')))}));

  add('u-aftersale-rejected', 'user', afterGroup, '售后进度', '门店驳回 · 待用户确认',
    '门店驳回显示理由，用户 48 小时内可接受或申请集团介入，超时视为接受。', '11 §1.2、§1.3',
    () => page({time: '15:20', header: nav('售后进度'), body:
      hero('门店暂不支持退款', '请在 10月5日 15:18 前确认；48 小时内不操作视为接受门店结果。', 'warm', 'messages-square') +
      `<div class="detail"><div class="card"><div class="card-title">门店回复</div>${kv('你的诉求', '退款 ¥98.00')}${kv('处理结果', '驳回退款申请')}<p class="textarea">驳回理由：按服务记录，14:00 开始、15:00 结束，已服务满预约时长。请补充说明具体未服务的时段。</p></div>` +
      infoTimeline([['10月3日 09:50', '你提交了售后申请'], ['10月3日 15:18', '门店驳回并提供理由'], ['待确认', '接受结果或申请集团介入', true]]) + '</div>',
      foot: footer(B('接受结果', 'secondary', act('aftersale-accept-rejection')), B('申请平台介入', 'primary', go('u-aftersale-hq')))}));

  add('u-aftersale-withdrawn', 'user', afterGroup, '售后进度', '已撤销',
    '撤销前确认，撤销后明确未执行退款；订单恢复原完成状态。', '11 §1.2、§1.3',
    () => page({time: '11:02', header: nav('售后进度'), body:
      hero('售后申请已撤销', '本次未执行退款，订单恢复为已完成。', 'gray', 'circle-x') +
      `<div class="detail"><div class="card">${kv('售后编号', 'AS2026100300117')}${kv('原诉求', '退款 ¥98.00')}${kv('撤销时间', '10月3日 11:02')}${kv('本次退款', '¥0.00')}</div>` +
      infoTimeline([['10月3日 09:50', '你提交了售后申请'], ['10月3日 11:02', '你撤销了申请', true]]) +
      notice('gray', 'info', '订单的评价、售后及开票入口，仍按各自期限和实际状态显示。') + '</div>',
      foot: footer(contact(), B('查看订单', 'primary', go('u-o-done')))}));

  add('u-aftersale-accepted-rejection', 'user', afterGroup, '售后进度', '已完成 · 用户接受门店驳回',
    '用户接受门店驳回后形成明确终态，展示驳回理由和接受时间，不冒充集团裁决。', '11 §1.2、§1.3',
    () => page({time: '15:21', header: nav('售后进度'), body:
      hero('售后处理已完成', '你已接受门店处理结果，本次未退款。', 'gray', 'circle-check') +
      `<div class="detail"><div class="card"><div class="card-title">处理结果</div>${kv('你的诉求', '退款 ¥98.00')}${kv('门店结果', '驳回申请')}${kv('本次退款', '¥0.00')}<p class="textarea">门店理由：按服务记录，14:00 开始、15:00 结束，已服务满预约时长。</p></div>` +
      infoTimeline([['10月3日 09:50', '你提交了售后申请'], ['10月3日 15:18', '门店驳回并提供理由'], ['10月3日 15:21', '你接受门店结果，售后完成', true]]) + '</div>',
      foot: footer(contact(), B('查看订单', 'primary', go('u-o-done')))}));

  add('u-aftersale-result', 'user', afterGroup, '售后进度', '已完成 · 集团裁决驳回',
    '集团最终裁决显示理由与处理记录，终态不再显示撤销、接受或再次介入按钮。', '11 §1.2、§1.3',
    () => page({time: '10:00', header: nav('售后进度'), body:
      hero('售后处理已完成', '集团客服已核实并裁决，本次不支持退款。', 'gray', 'scale') +
      `<div class="detail"><div class="card"><div class="card-title">裁决结果</div>${kv('你的诉求', '退款 ¥98.00')}${kv('本次退款', '¥0.00')}<p class="textarea">理由：结合开始和结束打卡记录、双方说明，未发现时长不足。预约时长已完整提供，本次退款申请不予支持。</p><p class="small muted" style="margin-top:8px">集团裁决为最终结果，门店必须执行。</p></div>` +
      infoTimeline([['10月3日 09:50', '你提交了售后申请'], ['10月4日 10:00', '集团客服介入核实'], ['10月5日 10:00', '集团裁决驳回，售后完成', true]]) + '</div>',
      foot: footer(contact(), B('查看订单', 'primary', go('u-o-settled')))}));

  const addressBody = outside => `<div class="detail"><div class="segmented"><button ${go('u-reschedule')}>改时间</button><button class="on">改地址</button></div>` +
    notice('gray', 'store', '只能更改到天俪·示例门店的服务范围内；价格不变。提交后需要技师重新确认，占用本单 1 次改约机会。') +
    `<div class="card"><div class="card-title">原地址</div><p style="font-size:13px;line-height:21px">幸福里小区 2号楼 8层 802室</p>${kv('服务对象', '王女士 138****8000')}${kv('预约时间', '明天 14:00–15:00')}${kv('总价', '¥298.00')}</div>` +
    `<div class="card"><div class="card-title">新上门地址</div>${textInput('rescheduleCommunity', '小区 / 大厦', outside ? '远郊花园' : '幸福里小区', 'required maxlength="50" data-state="rescheduleAddress"')}${textInput('rescheduleDetail', '楼栋 / 门牌', '3号楼 5层 502室', 'required maxlength="80" data-state="rescheduleAddress"')}<p class="small muted" style="margin-top:8px">请填写完整楼栋和门牌。提交前重新检查原门店范围和技师时段。</p></div>` +
    (outside ? notice('red', 'map-pin-off', '<b>新地址超出原门店服务范围</b><br>无法修改本单地址。可更换地址，或在技师出发前免费取消后重新预约。') : notice('good', 'map-pin-check', '此地址在原门店服务范围内，距离 1.5km；服务总价保持 ¥298.00。')) + '</div>';

  add('u-reschedule-address', 'user', afterGroup, '改约', '改地址 · 原门店范围内',
    '真实地址输入；提交前检查原门店范围，不能跨门店，提交后技师重新确认。', '02 §6 · 13 §1',
    () => page({time: '16:10', header: nav('改约'), body: addressBody(false),
      foot: footer(B('检查新地址', 'secondary', act('reschedule-address-check')), B('确认改地址', 'primary', act('reschedule-address-submit')))}));

  add('u-reschedule-address-outside', 'user', afterGroup, '改约', '改地址 · 超出原门店范围',
    '越界后保留输入和原约，阻止提交；可修改地址重新检查。', '02 §6 · 13 §3',
    () => page({time: '16:11', header: nav('改约'), body: addressBody(true),
      foot: footer(B('重新检查地址', 'secondary', act('reschedule-address-check')), B('确认改地址', 'primary', 'disabled'))}));

  add('u-reschedule-limit', 'user', afterGroup, '改约', '已用完改约次数',
    '剩余改约次数为零不能改时间、地址或技师；门店发起的调整不占用户次数。', '02 §6 · 13 §1',
    () => page({time: '16:10', header: nav('改约'), body:
      `<div class="block"><div class="ring">${I('calendar-x')}</div><h2>本单改约次数已用完</h2><p>你已使用 1 次改约机会，不能再次修改时间、地址或技师。</p></div><div class="detail">${serviceCard('10月3日 16:00–17:00')}` +
      notice('gray', 'info', '技师还未出发时，可在订单详情免费取消后重新预约。门店发起的调整不占用用户改约次数。') + '</div>',
      foot: footer(contact(), B('返回订单', 'primary', go('u-o-accepted')))}));

  const extensionFailure = (title, description, extra) => detail('14:52', hero(title, description, 'warm', 'clock'),
    [techCard(), serviceCard(), `<div class="card">${kv('当前服务结束时间', '15:00')}${kv('本次加钟费用', '¥0.00')}${extra}</div>`],
    footer(B('安全求助', 'ghost-red', go('u-sos')), orderReturn()));

  add('u-extend-unavailable', 'user', orderGroup, '订单详情', '加钟不可用 · 后续时段冲突',
    '后续时段占用时不生成支付单、不扣款，主服务继续到原结束时间。', '02 §7 · 13 §3',
    () => extensionFailure('暂时不能加钟', '林师傅后续时段已有安排，本次无法增加服务时长。原服务正常继续。', kv('原因', '后续时段与其他订单冲突')));

  add('u-extend-limit', 'user', orderGroup, '订单详情', '加钟不可用 · 已达次数上限',
    '本单已经加钟 2 次，包含用户与技师发起的成功加钟，不能继续增加。', '02 §7 · 13 §1',
    () => detail('15:52', hero('本单加钟次数已用完', '已成功加钟 2 次，共增加 60 分钟，不能继续加钟。', 'warm', 'clock'),
      [techCard(), serviceCard('今天 14:00–16:00'), `<div class="card">${kv('当前结束时间', '16:00')}${kv('成功加钟', '2 次 × 30 分钟')}${kv('累计支付', '¥596.00')}${kv('本次新增费用', '¥0.00')}</div>`],
      footer(B('安全求助', 'ghost-red', go('u-sos')), orderReturn())));

  add('u-extend-expired', 'user', orderGroup, '订单详情', '加钟支付超时',
    '5 分钟支付超时后释放加钟时段，主订单结束时间与金额不变。再次加钟重新校验。', '02 §7 · 13 §3',
    () => detail('14:57', hero('加钟支付时间已过', '已确认本次加钟未支付，加钟时段已释放。原服务仍在 15:00 结束。', 'gray', 'timer-off'),
      [techCard(), serviceCard(), `<div class="card">${kv('原订单支付', '¥298.00')}${kv('本次加钟支付', '未支付 · ¥0.00')}${kv('当前结束时间', '15:00')}${kv('剩余加钟次数', '2 次')}</div>`],
      footer(B('安全求助', 'ghost-red', go('u-sos')), B('重新申请加钟', 'primary', act('extend-retry')))));

  const safetyContext = () => `<div class="card"><div class="card-title">关联订单 ${badge('客服介入', 'warm')}</div>${kv('订单尾号', '0132')}${kv('技师', '林师傅 · 天俪·示例门店')}${kv('上门地址', '幸福里小区 2号楼 8层 802室')}</div>` +
    `<div class="card"><div class="card-title">求助位置 ${badge('当前定位失败', 'warm')}</div><p style="font-size:13px;line-height:21px">已记录最后已知位置：幸福里小区 2号楼附近</p><p class="small muted" style="margin-top:5px">最后更新时间 14:20。定位失败不影响求助；请向接报人员说明当前所在位置。</p></div>`;
  const safetyFoot = () => footer(B(I('phone') + '直接拨打 110', 'red', act('sos-call-110')), B('查看订单', 'secondary', go('u-o-service')));

  add('u-sos-sent', 'user', safetyGroup, '安全求助', '已发出 · 待接报',
    '立即反馈求助已发出、关联订单与定位；3 分钟未确认自动升级，直接 110 始终可用。', '05 §1、§2 · 13 §2',
    () => page({time: '14:21', header: nav('安全求助'), body:
      hero('求助已发出', '已向门店和集团值班人员发出通知，正在等待接报。遇到紧急危险请立即拨打 110。', 'red', 'shield-alert') +
      `<div class="detail">${safetyContext()}${infoTimeline([['14:21', '已记录订单和最后已知位置'], ['14:21', '电话、短信等渠道通知门店与集团值班人员'], ['等待接报', '3 分钟内无人确认，自动升级通知集团安全负责人', true]])}` +
      notice('gray', 'info', '通知失败会自动重试并通知下一位值班人员。求助事件未结案时暂停相关订单分账。') + '</div>',
      foot: safetyFoot()}));

  add('u-sos-escalated', 'user', safetyGroup, '安全求助', '3 分钟无人确认 · 已升级',
    '第一轮无人接报后自动升级集团安全负责人，继续等待 3 分钟，同时保持直接 110。', '05 §1 · 13 §2',
    () => page({time: '14:24', header: nav('安全求助'), body:
      hero('求助已升级', '前 3 分钟无人确认，已电话通知集团安全负责人。紧急危险请直接拨打 110。', 'red', 'shield-alert') +
      `<div class="detail">${safetyContext()}${infoTimeline([['14:21', '已发出求助，通知门店和集团值班人员'], ['14:24', '无人确认，升级通知集团安全负责人', true], ['14:27 前', '继续等待确认，仍无人确认会提示直接报警']])}</div>`,
      foot: safetyFoot()}));

  add('u-sos-unanswered', 'user', safetyGroup, '安全求助', '6 分钟无人确认 · 无人响应',
    '升级后再过 3 分钟仍无人确认，明确告知无人响应并引导直接 110，事件保留待复盘。', '05 §1 · 13 §2',
    () => page({time: '14:27', header: nav('安全求助'), body:
      hero('目前无人响应，请直接报警', '求助发出 6 分钟仍无人确认。如有危险，请立即拨打 110 并说明你的位置。', 'red', 'phone-call') +
      `<div class="detail">${notice('red', 'triangle-alert', '平台暂未确认接报，不能将求助发送成功视为已经有人处理。')}${safetyContext()}` +
      infoTimeline([['14:21', '通知门店和集团值班人员'], ['14:24', '升级集团安全负责人'], ['14:27', '仍无人确认，事件标记无人响应并保留复盘', true]]) + '</div>',
      foot: safetyFoot()}));

  add('u-sos-closed', 'user', safetyGroup, '安全求助', '已结案 · 展示处理结果',
    '接报与结案分开；显示处理人、结果和关联订单。原事件已结案仍可直接拨打 110。', '05 §1 · 13 §2',
    () => page({time: '14:42', header: nav('安全求助'), body:
      hero('本次求助已结案', '门店已联系双方并记录处理结果，订单问题由客服继续核实。', 'green', 'shield-check') +
      `<div class="detail"><div class="card"><div class="card-title">处理结果</div>${kv('接报人员', '张店长 · 14:22')}${kv('结案时间', '14:40')}${kv('关联订单', '尾号 0132 · 客服介入')}<p class="textarea">14:24 已电话联系你，确认你已离开现场；技师也已安全离开。双方服务争议转集团客服核实。</p><p class="small muted" style="margin-top:8px">安全事件结案不代表订单争议已处理完成。</p></div>` +
      `<div class="card"><div class="card-title">求助时的位置</div><p class="small">当时定位失败，已记录 14:20 最后已知位置：幸福里小区 2号楼附近。</p></div>` +
      infoTimeline([['14:21', '求助已发出'], ['14:22', '张店长确认接报'], ['14:40', '记录处理结果并结案', true]]) + '</div>',
      foot: safetyFoot()}));

  add('u-loading', 'user', sharedGroup, '首页', '加载中 · 骨架屏',
    '数据加载前用骨架占位，按钮不提供可提交操作；加载成功后进入实际页面。', '13 §3',
    () => page({time: '09:20', header: brandNav(), bodyClass: 'surface', body:
      `<div class="padded" aria-busy="true" aria-label="正在加载首页" style="padding-top:18px"><div style="height:23px;width:60%;border-radius:5px;background:#edf0f2;margin-bottom:9px"></div><div style="height:13px;width:80%;border-radius:4px;background:#f0f2f4;margin-bottom:30px"></div>` +
      [1, 2].map(() => `<div class="service-row" style="margin-bottom:12px"><div style="height:92px;width:74px;border-radius:8px;background:#edf0f2;flex-shrink:0"></div><div class="grow"><div style="height:20px;width:70%;border-radius:4px;background:#edf0f2"></div><div style="height:12px;width:90%;margin:12px 0;background:#f0f2f4;border-radius:4px"></div><div style="height:37px;width:45%;background:#edf0f2;border-radius:5px;margin-top:16px"></div></div></div>`).join('') +
      `<div style="height:20px;width:42%;border-radius:4px;background:#edf0f2;margin:20px 0"></div>` +
      [1, 2].map(() => `<div class="tech-row"><div style="height:54px;width:54px;border-radius:50%;background:#edf0f2;flex-shrink:0"></div><div class="grow"><div style="height:17px;width:54%;background:#edf0f2;border-radius:4px"></div><div style="height:12px;width:86%;background:#f0f2f4;border-radius:4px;margin-top:12px"></div></div></div>`).join('') + '</div>',
      tabs: tabbar('user', '首页')}));

  add('u-no-slots', 'user', sharedGroup, '选择时段', '当前技师暂无可约时段',
    '查询结果为空时保留选择条件，允许改日期或换技师，不锁定时段。', '02 §4 · 13 §3',
    () => page({time: '10:04', header: nav('选择时段'), body:
      `<div class="date-tabs"><button class="on"><b>今天</b>10/1</button><button ${go('u-slot')}><b>明天</b>10/2</button><button ${go('u-slot')}><b>周六</b>10/3</button><button ${go('u-slot')}><b>周日</b>10/4</button></div>` +
      `<div class="detail"><div class="card"><div class="person">${av('林', 'small-avatar')}<div class="grow"><h3>林师傅</h3><p>舒缓放松 · 60分钟 · 今天</p></div></div></div></div>` +
      `<div class="block"><div class="ring">${I('calendar-x')}</div><h2>今天暂无可约时段</h2><p>可以选择其他日期，或查看同门店的其他技师。</p><div class="actions">${B('查看明天时段', 'primary full', go('u-slot'))}${B('更换技师', 'secondary full', go('u-home'))}</div></div>`}));

  add('s-forbidden', 'store', sharedGroup, '访问受限', '无权限 · 其他门店数据',
    '无权限时隐藏订单和个人数据，仅给返回与重新选择门店入口。', '05 §4 · 13 §3',
    () => page({time: '14:20', header: nav('访问受限'), bodyClass: 'surface', body:
      `<div class="block"><div class="ring">${I('lock-keyhole')}</div><h2>没有权限查看此内容</h2><p>当前账号只能访问授权门店的数据。请返回本店工作台，或联系集团管理员核实授权。</p><div class="actions">${B('返回本店工作台', 'primary full', go('s-dispatch'))}${B('联系集团管理员', 'secondary full', act('contact-group-admin'))}</div></div>`}));

  add('s-state-changed', 'store', sharedGroup, '订单已更新', '已被其他人员处理',
    '提交时订单状态已变，阻止重复派单，刷新后依据最新状态显示操作。', '02 §4 · 13 §3',
    () => page({time: '10:22', header: nav('订单已更新'), body:
      `<div class="detail">${notice('warm', 'refresh-cw', '这笔订单刚刚被其他人员处理，本次派单未提交。请以最新状态为准。')}<div class="card">${kv('订单尾号', '0132')}${kv('最新状态', '陈师傅已接单')}${kv('处理人员', '张店长')}${kv('更新时间', '10:22')}</div><p class="small muted" style="padding:0 4px">旧页面的操作已失效，不能重复派单或覆盖处理结果。</p></div>`,
      foot: footer(B('刷新工作台', 'primary', go('s-dispatch')))}));

  add('u-health-unchecked', 'user', '用户端 · 下单', '确认订单', '健康告知未勾选',
    '未确认成人及健康告知时支付按钮禁用；真实勾选后才可继续。', '02 §2 · 05 §3 · 13 §3',
    () => {
      const healthCheck = `<div class="check-row" style="align-items:center"><input type="checkbox" name="healthConfirmed" data-state="healthConfirmed" aria-label="确认服务对象成人且不属于禁忌人群" style="height:18px;width:18px;margin:0;flex-shrink:0;accent-color:var(--brand)"><div>服务对象已满 18 周岁，且不属于禁忌人群 <a href="?screen=u-health" ${go('u-health')}>查看《健康告知》</a></div></div>`;
      const body = confirmBody(false).replace(check(false, '服务对象已满 18 周岁，且不属于禁忌人群 <a>查看《健康告知》</a>'), healthCheck);
      return page({time: '10:05', header: nav('确认订单'), body, foot: payFooter(true)});
    });

  add('u-health-ineligible', 'user', '用户端 · 下单', '健康告知', '未成年或禁忌人群 · 阻止下单',
    '服务对象未满 18 岁或属于禁忌人群时明确阻止预约，不生成订单或扣款。', '02 §2 · 05 §3 · 13 §3',
    () => page({time: '10:05', header: nav('健康告知'), body:
      `<div class="block"><div class="ring red">${I('shield-x')}</div><h2>本次无法预约上门服务</h2><p>服务对象未满 18 周岁，或属于健康告知中的禁忌人群，平台无法提供本次服务。</p></div>` +
      `<div class="detail">${notice('red', 'circle-alert', '本次未生成订单、未扣款。请确认服务对象信息；不符合条件时请停止预约。')}${notice('gray', 'info', '如果技师到达后发现情况不符，会中止服务并交客服核实，费用按核实结果处理。')}</div>`,
      foot: footer(B('返回首页', 'secondary', go('u-home')), B('重新查看告知', 'primary', go('u-health')))}));

  add('u-consent-revoked', 'user', '用户端 · 账户与隐私', '预约受限', '身份信息授权已撤回',
    '撤回单独同意后阻止新上门订单，仍可查看已有订单与记录；重新使用需要明确授权和核验。', '05 §5 · 13 §3',
    () => page({time: '09:20', header: nav('预约受限'), bodyClass: 'surface', body:
      `<div class="block"><div class="ring">${I('shield-off')}</div><h2>需要重新授权才能预约</h2><p>你已撤回身份信息处理授权，当前不能新建上门预约。</p><div class="actions">${B('查看授权并重新核验', 'primary full', go('u-realname'))}${B('查看已有订单', 'secondary full', go('u-orders'))}</div><p class="small muted" style="margin-top:16px">已有订单和处理记录仍可查看。重新授权前，请阅读对应的单独同意内容。</p></div>`}));

  add('u-payment-expired', 'user', '用户端 · 下单', '支付结果核验', '支付超期 · 核验中',
    '支付超期先核验支付及关单结果；核验未支付后关单释放时段，已支付则继续订单。', '02 §4 · 13 §3',
    () => page({time: '10:20', header: nav('支付结果核验'), body:
      hero('支付时间已过', '正在核验订单的支付结果，请暂时不要重复付款。', 'warm', 'hourglass') +
      `<div class="detail"><div class="card">${kv('订单尾号', '0132')}${kv('应付金额', '¥298.00')}${kv('核验状态', '支付结果查询中')}</div>` +
      notice('gray', 'info', '未支付会关闭订单并释放时段；已支付会进入接单流程。若时段已被占用，则自动全额退款并通知你。') + '</div>',
      foot: footer(contact(), B('查询支付结果', 'primary', act('retry-payment-query')))}));
})();
