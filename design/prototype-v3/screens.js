'use strict';
// 每一项 = 一张设计图。ref 指向 docs/ 里的规则来源，改图前先看规则。
window.SCREENS = [
  // 用户端 · 下单
  {id:'u-home', role:'user', group:'用户端 · 下单', title:'首页', state:'可上门', caption:'项目和一口价直接可见；技师卡片显示距离、评分和最近可约时间。', ref:'07 用户端 · 13 §3'},
  {id:'u-out-of-range', role:'user', group:'用户端 · 下单', title:'首页', state:'不在服务范围', caption:'地址不在任何门店的服务范围内：提示暂未开通，引导更换地址。', ref:'02 §2 · 13 §3'},
  {id:'u-tech-detail', role:'user', group:'用户端 · 下单', title:'技师档案', state:'—', caption:'培训批次、证书编号可查；评分为近 90 天均分，不足 5 条显示"新技师"。', ref:'07 · 11 §3'},
  {id:'u-slot', role:'user', group:'用户端 · 下单', title:'选择时段', state:'—', caption:'只显示可约时段；最早可约为 2 小时后；夜间时段直接显示总价。', ref:'02 §2、§4、§10'},
  {id:'u-realname', role:'user', group:'用户端 · 下单', title:'实名核验', state:'首次下单', caption:'首次下单前完成姓名 + 身份证号核验；身份证号单独同意。', ref:'05 §3、§5'},
  {id:'u-health', role:'user', group:'用户端 · 下单', title:'健康告知', state:'首次弹出', caption:'确认服务对象满 18 周岁且不属于禁忌人群，才能提交订单。', ref:'02 §2 · 05 §3'},
  {id:'u-confirm', role:'user', group:'用户端 · 下单', title:'确认订单', state:'待支付', caption:'付款前看到具体技师、扣费规则和时段保留倒计时；未勾选健康告知不能支付。', ref:'02 §2 · 13 §1'},
  {id:'u-paid', role:'user', group:'用户端 · 下单', title:'支付成功', state:'引导订阅', caption:'引导订阅消息；不订阅时关键进度改用短信通知。', ref:'02 §2 · 13 §4'},
  // 用户端 · 订单状态
  {id:'u-orders', role:'user', group:'用户端 · 订单状态', title:'我的订单', state:'多种状态', caption:'按进行中、待评价、售后筛选；每张卡片只给当前状态可用的操作。', ref:'07 · 13 §1'},
  {id:'u-o-waiting', role:'user', group:'用户端 · 订单状态', title:'订单详情', state:'待接单 · 技师确认中', caption:'技师 10 分钟内确认；可免费取消、改约。', ref:'02 §3 · 13 §1'},
  {id:'u-o-dispatching', role:'user', group:'用户端 · 订单状态', title:'订单详情', state:'待接单 · 门店派单中', caption:'技师未确认，门店安排中；派单期限到了自动全额退款。', ref:'02 §3'},
  {id:'u-o-accepted', role:'user', group:'用户端 · 订单状态', title:'订单详情', state:'已接单', caption:'显示剩余改约次数；联系技师走虚拟号码。', ref:'02 §6 · 13 §1'},
  {id:'u-o-reassign', role:'user', group:'用户端 · 订单状态', title:'订单详情', state:'改派待确认', caption:'指定技师被更换需要用户确认，15 分钟未确认自动全额退款。', ref:'02 §5'},
  {id:'u-o-store-reschedule', role:'user', group:'用户端 · 订单状态', title:'订单详情', state:'门店改约待确认', caption:'门店发起改约需要用户同意；拒绝或超时保持原约；不占用户改约次数。', ref:'02 §6'},
  {id:'u-o-departed', role:'user', group:'用户端 · 订单状态', title:'订单详情', state:'技师已出发 · 取消确认', caption:'出发后取消先弹窗显示扣费和退款金额。', ref:'02 §8 · 03 §6.3'},
  {id:'u-o-late', role:'user', group:'用户端 · 订单状态', title:'订单详情', state:'技师已出发 · 超时未到', caption:'开始后 15 分钟技师仍未到达，可以免费取消；店长同时收到告警。', ref:'02 §8'},
  {id:'u-o-arrived', role:'user', group:'用户端 · 订单状态', title:'订单详情', state:'已到达', caption:'到达后不能自助取消，需要取消时联系客服。', ref:'02 §8 · 13 §1'},
  {id:'u-o-serving', role:'user', group:'用户端 · 订单状态', title:'订单详情', state:'服务中', caption:'可以加钟、求助；显示预计结束时间。', ref:'02 §7 · 05 §1'},
  {id:'u-o-extend', role:'user', group:'用户端 · 订单状态', title:'订单详情', state:'服务中 · 加钟待支付', caption:'技师后续时段锁定 5 分钟，超时自动放弃；每单最多加钟 2 次。', ref:'02 §7'},
  {id:'u-o-service', role:'user', group:'用户端 · 订单状态', title:'订单详情', state:'客服介入', caption:'中止服务或纠纷时客服 24 小时内判定，期间暂停分账。', ref:'02 §9 · 03 §5'},
  {id:'u-o-done', role:'user', group:'用户端 · 订单状态', title:'订单详情', state:'已完成', caption:'48 小时内可以申请售后；可以评价、开发票。用户端看不到"已结算"。', ref:'11 §1、§3 · 03 §11 · 13 §1'},
  {id:'u-o-aftersale', role:'user', group:'用户端 · 订单状态', title:'订单详情', state:'售后中 · 门店处理中', caption:'门店 24 小时内处理，超时自动转集团。', ref:'11 §1'},
  {id:'u-o-cancelled', role:'user', group:'用户端 · 订单状态', title:'订单详情', state:'已取消 · 有扣费', caption:'显示退款与扣费明细。', ref:'03 §6.3 · 13 §1'},
  {id:'u-o-autorefund', role:'user', group:'用户端 · 订单状态', title:'订单详情', state:'已取消 · 派单超期', caption:'门店未能按时安排技师，系统自动全额退款。', ref:'02 §3'},
  {id:'u-o-refunded', role:'user', group:'用户端 · 订单状态', title:'订单详情', state:'已退款 · 部分退款', caption:'售后部分退款完成后的终态；剩余金额按退款后重新分账。', ref:'03 §6.2 · 13 §1'},
  // 用户端 · 改约、售后、评价、发票
  {id:'u-reschedule', role:'user', group:'用户端 · 改约、售后、评价、发票', title:'改约', state:'—', caption:'只能改到同价时段，并且不晚于支付后 7 天；每单 1 次；改约后技师重新确认。', ref:'02 §6'},
  {id:'u-aftersale-apply', role:'user', group:'用户端 · 改约、售后、评价、发票', title:'申请售后', state:'—', caption:'服务完成后 48 小时内；选择类型和诉求，上传凭证。', ref:'11 §1'},
  {id:'u-aftersale-confirm', role:'user', group:'用户端 · 改约、售后、评价、发票', title:'售后进度', state:'待用户确认', caption:'接受门店方案或申请集团介入；48 小时不操作视为接受。', ref:'11 §1 · 03 §6.2'},
  {id:'u-aftersale-hq', role:'user', group:'用户端 · 改约、售后、评价、发票', title:'售后进度', state:'集团介入中', caption:'用户不接受门店方案后由集团客服 48 小时内裁决，裁决为最终结果。', ref:'11 §1'},
  {id:'u-review', role:'user', group:'用户端 · 改约、售后、评价、发票', title:'评价', state:'—', caption:'服务完成后 7 天内评价一次，不能修改；文字审核后显示。', ref:'11 §3'},
  {id:'u-invoice', role:'user', group:'用户端 · 改约、售后、评价、发票', title:'申请发票', state:'—', caption:'由服务门店开具；订单退款后发票需要红冲。', ref:'03 §11'},
  // 用户端 · 推广与安全
  {id:'u-promo', role:'user', group:'用户端 · 推广与安全', title:'推广中心', state:'—', caption:'只显示绑定客户数和佣金，不显示客户个人信息；佣金按状态区分。', ref:'04 §4、§6'},
  {id:'u-withdraw', role:'user', group:'用户端 · 推广与安全', title:'提现', state:'首次提现', caption:'首次提现需要实名和免确认收款授权；以最终到账结果为准。', ref:'04 §5'},
  {id:'u-sos', role:'user', group:'用户端 · 推广与安全', title:'一键求助', state:'服务中', caption:'始终可以直接拨打 110；发起求助后通知门店和集团值班人员，并记录位置。', ref:'05 §1'},
  {id:'u-restricted', role:'user', group:'用户端 · 推广与安全', title:'限制下单', state:'—', caption:'显示原因类别、到期日和申诉入口。', ref:'11 §4 · 13 §3'},
  // 技师端
  {id:'t-onboarding', role:'tech', group:'技师端', title:'技师入驻', state:'审核中', caption:'绑定、实名人脸、上传资料、集团审核、分配门店，逐步完成后才能接单。', ref:'12 §2'},
  {id:'t-work', role:'tech', group:'技师端', title:'工作台', state:'在岗', caption:'待确认订单带倒计时；求助入口放在进行中的订单上，自动关联这一单。', ref:'02 §3 · 05 §1'},
  {id:'t-o-accepted', role:'tech', group:'技师端', title:'订单详情', state:'已接单 · 未出发提醒', caption:'开始前 30 分钟还没出发会提醒，店长同时收到通知；出发需要授权位置。', ref:'02 §8 · 05 §2'},
  {id:'t-o-arrived', role:'tech', group:'技师端', title:'订单详情', state:'已到达', caption:'到达 15 分钟后才能标记用户爽约；现场异常可以中止服务。', ref:'02 §8、§9'},
  {id:'t-o-serving', role:'tech', group:'技师端', title:'订单详情', state:'服务中', caption:'结束服务、发起加钟、中止服务、求助。', ref:'02 §7、§9 · 05 §1'},
  {id:'t-terminate', role:'tech', group:'技师端', title:'中止服务', state:'选择原因', caption:'选择原因后可以立即离开；客服 24 小时内核实；有危险先求助。', ref:'02 §9.1'},
  {id:'t-finish', role:'tech', group:'技师端', title:'结束服务', state:'提前结束', caption:'用户要求提前结束：订单正常完成，不自动退款。', ref:'02 §9.2'},
  {id:'t-income', role:'tech', group:'技师端', title:'收入', state:'—', caption:'提成按状态区分，取消补偿和退款调整单独列出；提成由门店按月发放。', ref:'03 §6、§8'},
  {id:'t-schedule', role:'tech', group:'技师端', title:'排班与请假', state:'请假审批中', caption:'请假时段有已接订单的，店长改派完才能批准；占用时间含前后路程。', ref:'12 §2 · 02 §4'},
  {id:'t-profile', role:'tech', group:'技师端', title:'我的档案', state:'保单即将到期', caption:'保单到期前 15 天提醒；差评和处罚各可以申诉一次。', ref:'05 §3 · 11 §2、§3'},
  {id:'t-suspended', role:'tech', group:'技师端', title:'工作台', state:'停单 · 保单到期', caption:'停单期间不能接新单，名下已接订单交给店长改派。', ref:'12 §2 · 05 §3'},
  // 店长小程序
  {id:'s-dispatch', role:'store', group:'店长小程序', title:'派单', state:'求助待接报', caption:'求助告警用整块红色和普通按钮区分；接报前可以直接拨打技师。', ref:'05 §1 · 01 §5.4'},
  {id:'s-pick', role:'store', group:'店长小程序', title:'选择技师派单', state:'—', caption:'时段冲突、请假、停单的技师不可选；就近安排订单改派不需要用户确认。', ref:'02 §3、§5'},
  {id:'s-sos-handling', role:'store', group:'店长小程序', title:'求助处理', state:'处理中 · 记录结果', caption:'接报和结案分开记录；处理结果写入安全事件。', ref:'05 §1'},
  {id:'s-orders', role:'store', group:'店长小程序', title:'今日订单', state:'含异常', caption:'未按时出发、定位失败、退款待垫付单独标出。', ref:'02 §8 · 05 §2 · 03 §7'},
  {id:'s-aftersale', role:'store', group:'店长小程序', title:'售后处理', state:'待门店处理', caption:'24 小时内处理，超时自动转集团；驳回必须写理由。', ref:'11 §1'},
  {id:'s-schedule', role:'store', group:'店长小程序', title:'技师排班', state:'紧急请假审批', caption:'当天紧急请假可以直接批准，名下已接订单自动进入待派单池。', ref:'12 §2'},
  // 通用状态：每个页面都要考虑，统一样式
  {id:'u-empty', role:'user', group:'通用状态', title:'我的订单', state:'空状态', caption:'没有数据时给出说明和下一步操作。', ref:'13 §3'},
  {id:'u-neterror', role:'user', group:'通用状态', title:'首页', state:'网络错误', caption:'请求失败时提示并提供重试。', ref:'13 §3'},
  {id:'t-expired', role:'tech', group:'通用状态', title:'工作台', state:'操作已过期', caption:'倒计时结束后才点接单：提示原因并刷新为最新状态。', ref:'02 §3 · 13 §3'},
  {id:'t-location', role:'tech', group:'通用状态', title:'订单详情', state:'未授权定位', caption:'未开启位置权限不能点出发，引导开启。', ref:'05 §2 · 13 §3'}
];
// 编号和导出文件名：U = 用户端，T = 技师端，S = 店长小程序
// 所有导出入口复用此规则，避免状态名中的斜杠成为目录分隔符。
window.SAFE_EXPORT_NAME = value => {
  let name = String(value).replace(/[\\/<>:"|?*\u0000-\u001f\u007f]/g, '、').replace(/\s*、\s*/g, '、').replace(/\s*·\s*/g, '-').replace(/[ .]+$/g, '');
  if (!name || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = '_' + name;
  return name;
};
(() => {
  const count = {user: 0, tech: 0, store: 0};
  const prefix = {user: 'U', tech: 'T', store: 'S'};
  for (const s of window.SCREENS) {
    s.no = prefix[s.role] + String(++count[s.role]).padStart(2, '0');
    s.file = window.SAFE_EXPORT_NAME(`${s.no}-${s.title}${s.state && s.state !== '—' ? '-' + s.state : ''}.png`);
  }
})();
