# 历史天俪商城 Demo

2026-10-02 从原服务器取回，静态文件未改动。

- 名称：天俪加盟门店平台。
- 原发布目录：`/srv/tianli/releases/franchise-demo-20260803-073100`。
- 原服务器链接：`/srv/tianli/franchise-demo` 指向上述发布目录。
- 本地文件：`franchise-demo/`。
- 当前本地入口：http://127.0.0.1:4187/franchise-demo/
- 默认进入天俪锦江店商城，可见商品、服务项目、到店预约、购物车、我的及演示导航。

原 `/franchise-demo/` Nginx 路由仅在旧备份配置中找到，当前生效配置未挂载这一路径。此次仅下载静态文件并启动本地预览，未调整服务器配置或启动CRMEB容器。

重新启动本地预览：在本目录运行 `python -m http.server 4187 --bind 127.0.0.1`。

同服务器另存有 `/srv/tianli/crmeb-demo`，查询时其PHP、MySQL、Nginx、Redis容器均为Exited。此次未下载其环境配置或业务数据库。
