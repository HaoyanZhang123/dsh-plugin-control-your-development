# THIRD-PARTY NOTICES

`dsh-plugin-control-your-development` 的发布物**不内联任何第三方代码**：

- 运行时只导入 Node.js 内置模块与宿主（DeepSeek Harness）经 `peerDependencies` 提供的包；
- 浏览器端 `lib/client.js` 使用的 React 由宿主在运行时注入（`window.__ModuleLoader__`），不随包分发；
- 内嵌的仪表盘渲染核（`dashboard.core.js`）为本项目自研，许可证同本包（MIT，见 LICENSE）。

若未来引入打包进发布物的第三方依赖，本文件须逐条列出其名称、版本、许可证与版权归属，并在发版前核对不过期。
