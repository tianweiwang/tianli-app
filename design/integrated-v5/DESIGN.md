# 天俪整合版 v0.5 · 首阶段设计与接口

日期：2026-10-02。用户已授权开始统一入口、完整商品交易链与预约跨端联动。此版为本地业务 Demo，真实接入及扩展会员/补贴/代理不在本阶段。

## 设计规格

用途：用户购买集团商品并预约门店项目；技师、店长、门店与集团后台连续处理同一订单。
风格：沿用已认可 V4 和后台的日常业务工具样式（Industrial/utilitarian）。品牌 #C94F35，正文 #25282D，背景 #F5F6F7，边框 #E5E7EB，完成 #34705A。字体 Microsoft YaHei / PingFang SC。复用本地 Lucide 及已有商品图片。
移动视图以390宽设计并适配320/430；16px留白、48px主操作、底部导航。后台208px左栏、表格与详情页、内容24px留白；窄屏正常折行。按钮整体内容双轴居中，外边界不得溢出。既有设计优先于技能的装饰性非对称建议。

## 首阶段验收

### 原有操作优先（2026-10-02 用户纠偏）

以 `prototype-v4` 的预约流程与既有后台操作为基线。整合只增加商城入口、统一身份与数据，不能以长表单替代已认可的分步选择。

- 用户首页保留片区、当前门店、预约项目和附近技师；商城为新增入口。
- 流程为片区/门店→项目→就近或指定技师→可约日期时段→联系人→首次身份授权与核验演示→成年和完整健康告知→确认预约→付款结果。
- 选择即时生效；变更上游选择清理失效的技师/时间，保留联系人；返回、刷新、切角色及跨标签更新不能抹去本人草稿。不同用户草稿隔离。
- 候选和时段与提交使用同一套可用性规则；指定与就近互斥，提交前展示具体技师、总价与取消规则。
- 派单前展示候选不可用原因；恢复工作/休息时段编辑与预约列表筛选。付款期限、直接派单、变更轮次等已确认规则继续沿用。
- 视觉沿用v4的业务列表/选择卡片、390px手机内容，品牌#C94F35、正文#25282D、背景#F5F6F7，Microsoft YaHei/PingFang SC；按钮与时段块内容居中、有界，320/390/430验证。
- 验证以原流程逐步点击为准，规则测试和历史浏览器记录分别保留。扩展业务缺口不以入口变化掩盖。

- 五视图同一 origin，同一业务存储；每用户地址、购物车、订单、来源隔离，服务门店与商品推广店分开。
- 商品提交占库存→支付→集团发货→本人收货→等待期→集团出账→门店核对→付款中→成功/失败原笔重试。
- 未支付关闭与超时、未发货取消、退货部分退款、失败/未知核查、已付佣金追回，不篡改履约事实。
- 预约多单与同端联动，保留固定轮期限、直接派单、指定变更确认、请假筛选、时长、求助及分笔退款约束。
- D02–D04中的24小时、7天、佣金10%/20%、运费10元等仅演示配置；不写成正式政策。D05/D06未定部分不作已验收结论。
- 保存规则层测试、跨角色浏览器路径与截图；不把代码测试当真实渠道验收。

## 实现约定

### 经营管理补齐第一批（2026-10-02）

沿用上面的 Web 业务工具视觉规格，增加商品、分类、库存、预约项目、门店档案、技师档案、预约规则入口。集团编辑用两列表单、独立规格表、变更影响与版本记录；库存单独列出实物、占用、可售并链接订单。窄屏表单单列、表格容器可横向滚动，操作组在自身边界内居中。商品图片使用已有素材或本地上传，不生成新的装饰图。

商品用稳定商品 ID 关联规格，草稿可不完整，发布必须完整。库存只经独立单据调整。旧 schema-5 存档增量补字段，保留订单、身份和预约草稿。所有经营命令再次校验岗位、版本和输入；表单失败、刷新及跨标签更新保留草稿。旧订单持有商品/项目/规则快照，新配置只影响后续业务。预约仍走既有分步页面。

验证包括空白建档至真实页面跨端收货、改价和下架保护旧单、库存占用冲突、岗位拒绝、版本冲突及原预约回归。后续组织生命周期、资金与发票补齐继续由 docs/整合版-v0.5/09 清单跟踪。

沿用项目原生 HTML/CSS/JS，使用 ES modules、无在线依赖。新目录 integrated-v5，保留旧版本。模块：engine.mjs（含seed）、booking.mjs、booking-draft.mjs、booking-ui.mjs、customer.mjs、staff.mjs、app.mjs、app.css、booking-ui.css。Node内置test验证规则。

### 模型接口（供并行实现）

`booking.mjs` 导出 `bookingSeed()`、`bookingCommand(s,actor,type,p,ctx)`、`bookingView(s,actor)`，以及下文的候选/时段/排班查询。`bookingSeed` 返回 stores/techs/services/regions 数组、schedules 排班对象、bookings/leaves/safety 空数组。ID沿V4（xingfu/silver/yuan、lin/chen/zhou/ma/gao/su、relax/neck）。store/tech/service字段统一为 `id,name,storeId,serviceIds,priceCents,nightCents,duration` 等清晰名称。

`engine.mjs` 导出 `seed()`、`reduce(state,actor,type,p={})`（深复制，失败不写入）、`visible(state,actor)`、`money(cents)`。actor={role:'user'|'tech'|'manager'|'store'|'group',userId,storeId,techId}。所有业务存储整数分，state.now为统一业务时钟。

ctx={fail(message),id(prefix),log(entity,text)}，log写entity.events及全局state.logs。type带命名空间；预约统一 `booking.*`，全局 `clock.advance`。状态变更须验证actor，保护不依赖UI。

state字段：schema:5, now,seq, users:[{id,name}], stores,techs,services,regions, schedules（旧存档可缺省，按下文兼容）, bookings,leaves,safety, skus:[{id,name,spec,priceCents,commissionBps,stock,image,active}], carts:{userId:[{skuId,qty}]},addresses:[{id,userId,name,phone,province,city,detail}],promotions:{userId:{storeId,at,sourceId}},goods:[],bills:[],recoveries:[],logs:[],settings:{sourceHours:24,paymentMinutes:15,waitDays:7,shippingCents:1000,version:'DEMO-1'}。

商品record={id,userId,source:{storeId,at,sourceId}|null,lines:[{skuId,name,spec,qty,unitCents,paidCents,commissionBps,refundedCents,returnedQty}],address,payment:{id,status,attempts},status:'unpaid'|'paid'|'shipped'|'received'|'closed'|'cancelled',paidCents,shippingCents,refunds:[],cases:[],events:[],createdAt,deadline,paidAt,receivedAt,shipment,commissionPaidCents}。

商品操作：cart.set{skuId,qty}; address.save{id?,name,phone,province,city,detail}; promotion.enter{storeId}; promotion.clear{}; goods.submit{addressId,requestId}; goods.pay{id,outcome:'success'|'failed'|'processing'}; goods.payment-query{id,outcome:'success'|'failed'}; goods.close{id}; goods.ship{id,carrier,tracking}; goods.receive{id}; goods.case{id,kind:'cancel'|'return'|'refund',skuId,qty,reason,amountCents,shippingCents?}; goods.case-review{id,caseId,decision:'approve'|'reject',reason}; goods.return{id,caseId,carrier,tracking}; goods.inspect{id,caseId,disposition:'sellable'|'damaged'}; goods.refund{id,caseId,outcome:'success'|'failed'|'processing'}; goods.refund-query 同字段；goods.appeal{id,caseId,reason}。

账单：bill.create{storeId}; bill.confirm{id}; bill.dispute{id,reason}; bill.resolve{id,reason}; bill.pay{id,outcome:'processing'|'success'|'failed'}; bill.query 同字段；recovery.receive{id,amountCents,proof}。付款申请与结果分开，未知必须query；对应退款冻结/调整，已付转追回。group执行集团动作，store/manager本店核对。

UI接口：`customerView(s,actor,route,ui)` / `staffView(s,actor,route,ui)` 返回HTML。route数组，如['mall']、['goods',id]、['booking',id]、['bookings']、['bills']；app统一hash `#/user/mall`、`#/group/goods` 等。ui={esc,money,date,button,link,field,select,tag,empty}；button(label,command,payload={},className='primary')输出data-command/data-payload；link(label,path,className='')输出hash链接；field(label,name,value='',type='text',attrs='')；select(label,name,options,value) options=[{value,label}]；tag(text,tone='')。表单 `<form data-command="..." data-payload='JSON'>` 的FormData合并payload后dispatch。数字由引擎转换校验。禁止视图直接修改state。

app处理导航与展示动作：data-go、data-role；业务命令全部engine；新增/查询失败以明确页面状态和错误信息呈现。渲染函数拿到完整state但必须经选择器筛数据，深链须保护。

### 预约查询与排班接口

```js
bookingOptions(s, {
  storeId, serviceId, regionId, genderPreference: 'any',
  mode: 'nearest', // 或 specified
  techId, startAt, id // 后两项可省略；id 指已有预约
})
// => {stores, candidates, selectedTechId, priceCents, duration, valid, error}
// stores: 原门店字段 + distanceKm + covered
// candidates: 本店技师字段 + distanceKm + available + reason

bookingSlots(s, selection, '2026-10-02')
// => [{startAt, time, priceCents, available, techId, reason}]

bookingSchedule(s, techId, date)
// => {start, end, breakStart, breakEnd}

// 命令：booking.schedule-save
// {techId?, start, end, breakStart, breakEnd, date?}
```

候选查询没有选择时间时只判断门店、项目、偏好和覆盖，不代入隐藏时段。选择时间后与实际下单共用排班、请假和占用校验。已有预约 ID 排除自身占位；原时段派单不重新要求提前 2 小时，换时间则按改约的提前量、首次支付后 7 天和同价约束检查。查询函数均不修改 state。

排班工作范围为 09:00–23:00，休息双方留空表示无固定休息；填写时须完整且位于工作区间。省略 `date` 保存常规排班，提供 `YYYY-MM-DD` 保存当天覆盖。权限为技师本人、本店店长/门店或集团。有效预约、待确认变更和加时占位均受保护；冲突时拒绝保存并说明预约号。

结构：`schedules[techId]={start,end,breakStart,breakEnd,dates:{[date]:{start,end,breakStart,breakEnd}}}`，另有更新时间和操作记录。新 seed 按 V4 设置工作 09:00–23:00、休息 12:00–13:00；旧 schema 5 缺少排班时返回工作 09:00–23:00、无固定休息，首次保存才初始化，避免原有 12 点预约被追溯判无效。

### 预约草稿与提交

`booking-draft.mjs` 导出 `createBookingDraft(s,userId,requestId)`、`patchBookingDraft(s,current,changes,requestId?)` 和 `bookingDraftPayload(draft)`。`app.mjs` 将草稿按用户保存在本标签页 `sessionStorage`，业务数据同步只重绘页面，不替换草稿。上游变化清理失效技师/时间；返回和刷新保留其余填写项；重新发起使用新 `requestId`。

新 `booking.create` 必须收到 `adultConfirmed=true`，仍要求 `identityVerified` 和 `healthConsent`；UI 草稿另要求单独同意 `identityConsent`。成年告知针对服务对象，身份演示针对预约账户。旧订单不补造新字段，不影响既有付款、确认和完成记录。

`ui.booking-submit` 先检查草稿，再在业务锁内复核 `expectedTechId/expectedPriceCents`，创建预约并提交首次模拟付款。结果为失败时保留同一待支付单；未知结果只查询原笔。提交时截取身份、付款结果和草稿快照；等待期间内容发生变化则不覆盖新草稿，保留内容并按需要换新请求标识，也不强制跳离已经切换的页面。

本次原操作恢复的范围和验证区分见 [08](../../docs/整合版-v0.5/08-原操作流程恢复.md)。当前 67/67 项规则测试与 13 个模块语法检查通过；本轮用户端 25 组、工作端 18 项浏览器检查、27 条纯渲染路径和 6 项草稿探针分别记录，历史 50 项证据保留。


## 2026-10-02 复审修复契约

- `upgradeBookings(s)` 增量补争议、安排历史和退款执行记录；不重放成功退款。
- `booking.refund-pay/query` 使用 `{id,refundId,paymentId,outcome}`，`refunds[].lines`保存方案，`executions[]`保存分笔退款号、状态和结果；页面逐笔执行。省略paymentId仅兼容旧调用。
- `booking.stop` 保存中止时间和原因；`booking.dispute-review`核实形成未服务比例方案；中止退款必须用户明确确认，没有超时自动同意。安全事件结案须显式提交`unresolvedDispute`，已有争议分别结案。
- `booking.help-ack`登记接报人，`booking.safety-confirm`确认超时安全提醒；提醒与通知只是本地待办。`bookingCanHelp`供用户/技师页面与命令共用时限。
- `changeHistory`保留前后安排快照、角色相关操作者ID及决定。完成的异常中止在页面显示“中止已处理”，不显示正常完成。
- `bill.confirm/dispute`须传所见`version`。新商品订单`source.storeName`及资格/版本在提交时锁定；旧档缺失快照时保留当前资料回退，不伪造历史。
- 新商品售后带稳定`requestId`。同用户同ID及同规范化内容重试返回原案；同ID换内容拒绝。
- `storeOpeningReadiness`统一营业条件；技师可先于门店营业完成审核。管理影响清单计入待确认提案。
- `media.mjs`将图片Blob按内容摘要存入IndexedDB。业务记录/草稿/历史使用`media:`引用；渲染时`mediaMarkup`和`hydrateMedia`恢复图片。先写媒体，后提交JSON，失败保留原数据。

验证和范围以[复审修复记录](../../docs/整合版-v0.5/10-复审修复与验证.md)为准。后续完整业务模块继续按09清单推进。
