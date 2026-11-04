# Changelog

`dsh-plugin-control-your-development` 的版本更新记录。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

发版纪律：把 Unreleased 落成 `## [<ver>] - <日期>` 后才能发版；不更新 CHANGELOG 不得发版。

## [Unreleased]

## [1.0.0-alpha.1] - 2026-11-05

首个 alpha 预览版：产品重构为「脉络 / Threadline」，永久只读，三个入口。

- 新增：工作区级星图（结构 / 共现 / 引用 / 时序四层关系）、时间轴、轮次带、三种检查器。
- 新增：`/threadline` 命令弹窗与每轮「影响 N」入口；两者不需要先打开 tab 也能读数据。
- 新增：隐私模式、列表视图（键盘可用）、reduced-motion 支持。
- 优化：插件加载即按工作区预热扫描并持续增量更新，打开 tab 时数据已就绪。
- 修复：弹窗与 popover 改为 portal 到 `document.body`（适配 DSH 0.2.2 的 docked composer）。
- 重要说明：本版本为 alpha 预览，接口与界面仍可能调整；旧版（0.7.x）的面板实现与其构建链已整体移除，不提供迁移。

## [1.0.0] - 2026-11-04

**破坏性重构：产品改为「脉络 / Threadline」，旧面板实现与其整条构建链整体移除。** 无向后兼容层，旧配置与旧产物不迁移。

### 新增 | Added

- **三个表面**（且只有这三个）：对话页 tab「脉络」（`conversation.view` / `id: threadline`）、每轮「影响 N」（`conversation.chat.assistant-actions` / `id: threadline-impact`）、`/threadline` 与 `/脉络` 命令 + 居中弹窗（`inputTriggers.registerSource` + `conversation.input.overlay`）。
- **星图**：工作区 → 会话 → 轮次 → 文件的分层关系视图；每条边可解释、可给证据，推断与共现显式标注。
- **host 只读扫描**：`sessionPersistence` / `sessionQuery` 读会话日志 → 内存索引；同一工作区新扫描取消旧扫描，按 50ms 预算让出事件循环，超限标 `truncated`。
- **三个同源只读路由**：`POST /api/dsh-threadline/{scan,snapshot,detail}`，全部只读、无外部 origin。
- **可解释降级**：`connection` / `slots` / `inputTriggers` 缺失只 warn 不崩；读不到 / 观测不到显式显示，不用 0 或空态冒充成功。
- **样式单一注入路径**：所有 CSS 走 `src/client/styles/index.ts` 的 `installStyles()`（`<style data-plugin-css>` 去重，卸载移除）；`css.ts` 由 `node tests/harness/emit-styles.mjs` 从 `styles/*.css` 逐字生成。

### 变更 | Changed

- 依赖政策收敛：`dependencies` 为空对象；React / React DOM 作为宿主 peer 由 `window.__ModuleLoader__` 注入，不打包；运行期零第三方依赖。
- 构建链收敛为一条：`pnpm run build` → `tools/build.mjs`（esbuild）产出 `lib/index.js`（host ESM）与 `lib/client.js`（CJS + `__ModuleLoader__.load` 包装），产物确定性（两次构建 sha256 相同、无 sourcemap / 时间戳 / 绝对路径）。
- 类型检查拆三套 tsconfig（host / client / test），测试用 Node 24 原生 `node --test` 直接跑 `.test.ts`，不引 jest / vitest。
- `package.json`：`files` 白名单只保留运行期需要的文件（`lib`、`cordis.patch.yml`、文档、`LICENSE`、`assets/icon.webp`）；移除 `locale/*.json` 导出（文案已进客户端 bundle）；`description` / `keywords` 改为脉络 / Threadline。
- `dsh.client.inject` 增加 `@deepseek-ai/dsh-client-ui-input-trigger`（命令入口依赖）。

### 移除 | Removed

- 旧实现与其构建链：源码、构建脚本、旧元信息文件共 5 个路径整体删除（删除清单与 sha256 见 `output/_verify/threadline/T12/removed.txt`），旧渲染链一并下线，不留兼容分支。
- 旧的产品化能力：右栏 tab、独立「使用指南」、离线 HTML 快照导出、任何写回/同步动作。
- 项目 `project.yml` 的 `skills` 声明（skill 实体是用户全局资产，不由插件包分发）。

### 修复 | Fixed

- 版本号单一事实源：`src/shared/version.ts` ↔ `package.json` 由构建脚本校验，不一致直接构建失败。

---

更早的 0.x 版本随旧产品线一并停止维护，本文件不再保留其条目；历史可查仓库提交记录。
