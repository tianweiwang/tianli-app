# 预约领域接口 v0.5

仅本地结果演示，金额整数分，时间为 epoch 毫秒（字符串日期按 +08:00 解析）。`bookingSeed()` 返回组织、项目、片区及空 bookings/leaves/safety。`bookingCommand` 在传入副本上修改并返回实体；失败调用 ctx.fail。`bookingView(s,actor)` 返回经过身份范围过滤的预约数组（深复制），每项补 `displayStatus`、`fundStatus`、`totalDuration`、`paidCents`、`refundedCents`、`netCents`、`settlementBlocked`。不会返回 HTML。UI 负责渲染，主体记录字段如下。

## 字段

- booking: `id,userId,storeId,techId,serviceId,regionId,mode:'nearest'|'specified',genderPreference:'any'|'male'|'female',startAt,duration,priceCents,contactName,phone,healthConsent,identityVerified,status,confirmationPhase,createdAt,paymentDeadline,firstPaidAt,round,rounds,change,userReschedules,payment,extensions,refunds,events,startedAt,completedAt,finishReason,requestId`。
- status: `unpaid,waiting,confirmed,active,done,cancelled,closed`。`confirmationPhase` 为 `tech` 或 `store`。客服独立事件，displayStatus 可为“客服处理中”，不会覆盖完成事实。
- payment: `id,amountCents,status:'unpaid'|'processing'|'failed'|'success',attempts,refundedCents`。extensions 为相同支付字段加 `duration,expiresAt,createdAt`，还可 `expired`。
- round: `id,startedAt,deadline,techDeadline,reason,completedAt`；rounds 保留历史。门店派单直接 confirmed，不能延长期限。
- change: `id,kind:'reschedule'|'reassign',techId,startAt,reason,expiresAt,status:'pending'|'accepted'|'rejected'|'expired'`。提案未生效时保持原安排。
- refund: `id,status:'requested'|'offered'|'approved'|'processing'|'failed'|'success'|'rejected'|'escalated'|'withdrawn',reason,requests:[{paymentId,amountCents}],lines:[{paymentId,amountCents}],amountCents,createdAt,deadline,events`。lines 确认后锁定；退款成功后分别累计到 payment/extension.refundedCents。
- leave: `id,techId,storeId,startAt,endAt,reason,emergency,status:'pending'|'approved'|'rejected',affectedIds,impactedIds,events`。affectedIds 只记本次触发重派的订单；impactedIds 保存全部重叠有效预约（包括未自动回退的进行中预约）。
- safety: `id,bookingId,storeId,userId,techId,reason,status:'open'|'closed',createdAt,closedAt,resolution,events`。多个未结安全事件、未完退款/售后均阻断结算。
- services 包含 `id,name,duration,priceCents,nightCents`；门店 `id,name,regionId,lat,lng,active,serviceIds,bufferMinutes`；技师 `id,name,storeId,serviceIds,gender,lat,lng,active,rating`。

## 用户命令

公共订单定位字段 `id`；type 均以下完整名称。

| type | payload | 行为 |
| --- | --- | --- |
| booking.create | storeId,serviceId,regionId,techId,startAt,mode,genderPreference,contactName,phone,healthConsent,identityVerified,requestId | 具体技师须付款前确定；nearest 可不传 techId 自动计算，但传值须仍为当前最近合格者；至少2小时后、7天内、30分时段、9–23点；提交占整段含缓冲 |
| booking.pay | id,outcome:success/failed/processing | 本人模拟支付；未知只允许查询 |
| booking.payment-query | id,outcome:success/failed | 查询未知结果；关单后晚到成功会核验资源，冲突则全额退款 |
| booking.cancel | id,reason | 本人未支付关闭，尚未开始且无实际履约事实则全额退款；门店可取消待确认/已确认，原因必填 |
| booking.reschedule | id,startAt,techId | 本人确认改约生效（每单一次），同价同店、重新确认并开新轮 |
| booking.change-answer | id,changeId,decision:accept/reject | 本人接受/拒绝门店改约或指定改派；拒绝改约保留，拒绝指定改派全退 |
| booking.extension-create | id,requestId | 本人或本人技师服务中申请30分钟，最多2次，锁5分钟 |
| booking.extension-pay | id,extensionId,outcome | 本人支付加时；结果同主单 |
| booking.extension-query | id,extensionId,outcome | 本人/本店/集团核查未知加时 |
| booking.refund-request | id,reason,requests | 本人服务完成48h内提出分笔退款；requests 数组 {paymentId,amountCents}，默认不自动填；允许 JSON 字符串 |
| booking.refund-answer | id,refundId,decision:accept/escalate/withdraw | 本人确认协商、申请集团介入、撤销；已执行退款不可撤销 |
| booking.help | id,reason | 本人/所属技师求助，未结事件保留实际履约状态 |

## 工作角色命令

| type | payload | 权限与行为 |
| --- | --- | --- |
| booking.accept | id | 本单技师在 tech 阶段与10分钟内确认 |
| booking.reject | id,reason | 本单技师拒绝，进入原轮门店池 |
| booking.assign | id,techId,reason | 本店店长/后台；nearest或仍原技师直接确认；指定另一人生成待确认改派提案 |
| booking.propose-reschedule | id,startAt,techId,reason | 本店提出15分钟提案，用户确认前不改变原约 |
| booking.start | id | 本单技师，已确认且已到预约开始时间，无待确认变更 |
| booking.finish | id,mode:normal/early,reason | 本单技师正常完成须满主单及已付加时时长；提前结束需原因；求助未结也可记录真实完成 |
| booking.leave-request | startAt,endAt,reason,emergency | 本人技师申请完整区间 |
| booking.leave-review | leaveId,decision:approve/reject,reason | 本店；普通请假影响有效预约时拒绝批准，紧急批准仅重派本人重叠 confirmed 且无 startedAt/departedAt/arrivedAt 的预约 |
| booking.help-close | safetyId,resolution | 本店或集团结案；不改完成/取消/退款事实，其他未解事件仍阻断 |
| booking.refund-review | id,refundId,decision:approve/offer/reject,amountCents,reason | 本店处理 requested；集团处理 escalated；approve 默认同意申请总额，offer 须用户确认；总额按原分笔申请最大余数法拆分 |
| booking.refund-pay | id,refundId,outcome:success/failed/processing | 本店或集团模拟原路退款；approved/failed 可执行，processing 必须 query |
| booking.refund-query | id,refundId,outcome:success/failed | 本店或集团；success 重复查询不叠加 |

`booking.tick` 只供根引擎 clock.advance 调用，不在任何 UI 暴露。它处理支付/加时锁定、接单/派单/变更到期、售后处理时限；自动取消会生成 approved 退款，需本店/集团模拟渠道结果。根调用前已验证时钟权限。

## 本阶段边界

保留多单隔离、时段冲突、价格快照、固定派单轮、请假、加时、求助、分笔售后及未知/失败重试。实际地点/定位、真实履约事实采集、支付渠道、服务分账/开票/评价/个人佣金提现未在此领域模块实现，不能仅靠本地流程称为正式验收。
