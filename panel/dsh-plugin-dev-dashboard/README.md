# dsh-plugin-dev-dashboard

把 control-your-development 的开发仪表盘嵌进 DSH 右侧边栏（与 文件/终端/浏览器 同列）。

- 数据：当前会话工作区的 dev-dashboard/ 三份 Markdown，经宿主 workspaceFiles RPC 读取
- 刷新：changes() 流式订阅，文件一变自动更新
- 动作：全部生成指令复制（粘贴到聊天框发送即执行）；面板只读不落盘

配套 skill：control-your-development（负责产出 dev-dashboard 数据）。

## 改了面板代码之后（重要）

客户端 bundle 是**页面加载时读进内存**的，改完 `lib/client.js` 后必须：

1. 把产物同步到 profile：`node_modules/dsh-plugin-dev-dashboard/lib/client.js`
2. **刷新 DSH 页面（Ctrl+R）或重启 DSH** —— 不刷新的话，右侧栏里跑的还是旧代码，改了什么都不会生效

排查"改了没反应"时，先确认这一步做过。
