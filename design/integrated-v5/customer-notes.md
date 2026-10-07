# 用户视图接入说明

`customer.mjs` 仅导出纯 HTML 视图，不写业务状态。商品命令交 `engine.mjs`，预约命令交 `booking.mjs`，UI 选择和表单转换交应用壳。

路由：home、mall、product/:id、cart、checkout、addresses[/id]、goods[/id]、bookings、booking[/id]、me。用户深链按当前 `userId` 过滤；来源仅取当前用户有效记录，提交附 `expectedSourceId`。

地址保存：购物车非空返回 checkout，否则回 addresses。商品/预约提交由应用壳导航新订单详情。金额表单以元展示，应用壳转整数分；预约分笔退款由 `refundAmount:<paymentId>` 汇总成 requests。

售后支持未发货取消、按商品部分退货/仅退款、运费申请、退货物流、拒绝申诉、退款状态、验收分歧复核、接受拒退与原货返还收取。预约支持创建付款、改约与提案确认、加时付款、求助和分笔退款交互。

验证记录见 [用户浏览器验证](verification/customer-browser.md)。
