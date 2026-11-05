# Changelog

`dsh-plugin-control-your-development` 的版本更新记录。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

发版纪律：把 Unreleased 落成 `## [<ver>] - <日期>` 后才能发版；不更新 CHANGELOG 不得发版。

## [Unreleased]

## [1.0.0] - 2026-11-06

用户第 9 轮反馈：版式重构为「左文件关系图 + 右两列目录卡片」，删除 `/threadline` 弹窗与检查器。

### 变更 | Changed

- **tab 版式（D-34）**：左列 = 文件关系图 + 时间轴 + 轮次带（sticky），右列 = 目录卡片两列（内容不变）；
  全页只有一条滚动（shell 唯一滚动容器），图/卡片/时间轴/轮次带都没有内部滚动。删除检查器面板与默认选中。
- **左图**：新 `FileGraph` 两 mode——目录图（默认当前会话最活跃目录，点卡片切换）与轮次图（点轮次→该轮涉及的跨目录文件）；
  确定性径向布局，无 pan/zoom/簇灰底框/网格；目录上限 40、轮次 200，显式「显示 N/M」；标签 top14+选中/悬停、6px 避让。
- **本轮状态**：文件级只显示 `读 N` / `写 +A/−D 行` / `首见`（文件级删除/新增不可证，不显示）；摘要条显示
  `删除命令 N（未逐文件归属）`，数据缺省为 `—`。host reducer 新增 `TurnDetail.deleteCommands?: number`（只计数、不存文本、不归属路径）。
- **文件大类 5 类**：文本（含配置）/ 代码 / 数据 / **媒体（图片+音频+视频）** / 其它；修 `html/css`→代码、dotfile→文本；
  图例和颜色令牌同步（文本 `--tl-fg-secondary`、代码 `--tl-accent`、数据 `--tl-warn`、媒体 `--tl-success`、其它 `--tl-fg-caption`）。
- **`/threadline` 命令**：保留命令，删除 `conversation.input.overlay` 注册与弹窗表面；执行改为 `requestFocus({kind:'session'}) + activateThreadlineTab()`。
- **清理**：删除旧星图（MapView/layout/viewport/ClusterOverview/overview）、modal 组件/样式/store、Portal/Overlay；
  样式共享根里的 `.threadline-modal-root` 死引用清零；`css.ts` 重建（新增 `impact.css`、`rail.css`）。
- **locale**：117 → 130 key（fileFamily 6→5 + graph/rail/turnStatus 13 条）；`modal.*` 6 条保留翻译但无 UI 引用。

### 修复 | Fixed（2026-11-06 第 10 轮真机反馈）

- **进 tab 后不再自动滑到底部**：`conversation.view` 宿主滚动容器内容高度是 auto，`block-size:100%` 只拿到内容高度；
  现在测量宿主 `[data-conversation-scroll]` 的**可视高度**并固定到 surface，外壳成为真正的滚动容器，宿主 scrollTop 清零。
- **滚轮可上下滚动**：同上——此前实际滚动的是宿主（内容被撑高），现在 shell 自身可滚；800/900/977/1200 都有回归断言。
- **悬停轮次不再上下跳**：摘要条改为**固定 36px 高、强制单行**（目录视图也占位），删除命令显示紧凑 `删除 N`，完整措辞在 tooltip；
  悬停只换内容，不改变面板高度。
- **左图 / 右卡 / 轮次 联动**：悬停卡片 → 左图临时预览该目录；悬停节点 → 所属目录卡 + 相关轮次块高亮；
  悬停轮次 → 左图预览该轮文件 + 相关目录卡高亮；离开整块视图才清预览，点击仍固定选择，hover 不改选择/滚动。
- 窄容器目录图节点上限 30（宽容器 40），减少 40 节点在 450px 宽里的重叠。

### 验证 | Verified

- `pnpm run typecheck` / `pnpm run build`（两次确定性）/ `pnpm run test`（550/550）/ `node tests/harness/emit-styles.mjs --check` 全 EXIT 0。
- `TL_TASK=T31 node tests/ui-map/run-t07.mjs` EXIT 0：1440 默认 / 轮次 / 1200 / 900 窄屏 / 滚动 sticky / 大目录截断，
  单滚动、无检查器、两列卡片、点卡切目录、轮次进出、标签上限/间距/边界断言全 PASS。
- 证据：`output/_verify/threadline/T30/`（数据层）、`T31/`（UI 与截图）、`T32/`（入口/弹窗删除）、`T33-lead/`（收口门禁）。
- 真机：已在运行中的 DSH 上用 HMR 核对 2.0 版式（真实内容宽约 977px 时左右两列、左图/时间轴/轮次带、右栏卡片滚动）；
  host 侧 `deleteCommands` 需重启 DSH 才会出现在旧会话上，本轮未擅自重启；未同步 `release/**`。
- T33 独立验证 3 个 major（800px 溢出、默认目录、运行中首见 0）已修并复验；证据见 `output/_verify/threadline/T34-recheck/`。


## [1.0.0-alpha.2] - 2026-11-05

真机反馈第 8 轮：每轮「影响」入口改为直接跳转，星图改为两级地图。

### 变更 | Changed

- **每轮「影响」入口改为导航**：点击图标不再弹出 popover，而是直接切到「脉络」tab 并聚焦该轮
  （ready → `turn:<n>`；加载 / 失败 / 本轮仍在记录 → `session:<id>`，由 tab 自己显示加载与只读重试）。
  删除整条 popover 旧路径（组件、Portal 定位、外部点击关闭、样式与 4 个落位纯函数）；入口不再声明
  `aria-haspopup` / `aria-expanded`，计数只进 tooltip / `aria-label`。
- **「脉络」tab 的星图改为两级地图**：
  - 默认「目录总览」：HTML 卡片网格，按顶层目录展示目录名、文件数、累计操作数、最近活动、
    文件族构成条与前 3 个最活跃文件；卡片数据来自**全部**文件（不再受 600 节点布局上限影响），
    带「本轮 N」徽章与时间轴「可见 N / M」；顶部有「点目录查看文件与关系」的轻提示。
  - 点击卡片进入「文件细节」：SVG 只渲染焦点目录的文件与**目录内**关系，视口按焦点目录 fit；
    标签按屏幕尺寸校正；跨目录关系由检查器「关系」区呈现。
- `activateThreadlineTab` 增强：`data-view-id` → 文本/aria 包含匹配；找不到时下一帧再试一次；
  失败原因可诊断（`activationFailure()`）。

### 修复 | Fixed

- 星图在真实规模（669 文件 / 20 个顶层目录）下退化成「一墙小圆点」：全部节点一次性 fit 到容器，
  11px 簇标签缩到 ~5px、节点半径缩到 1–4px 且互相压住。两级地图用「目录聚合 + 下钻」消除该退化，
  总览卡片文字保持固定屏幕字号，细节视图只承担一个目录。
- 聚焦簇时 pan/zoom 未计 SVG letterbox 居中偏移，导致聚焦整体偏右（新增 `tests/ui-map/viewport.test.ts` 守护；
  T23 起细节已无 pan/zoom，测试收敛为 `focusViewBox`）。
- 总览卡片的「本轮 N」徽章曾覆盖文件数计数；改为标题行内并排显示，两个数字同时可见。
- 细节视图的「节点截断 / 关系收拢」提示在 T21 重构中被删除且无替代；T23 恢复为右下角只读小条：
  节点提示按**本目录全量文件数**给「显示 N/M 个活跃文件」，关系提示给「已收拢 N 条」（修复独立验证 F1）。
- 总览空态文案不区分「观测不到 / 无记录 / 有文件操作记录但无文件」；T23 按 degrade 状态透传正确 key（F2）。
- 删除 T21 后已无调用方的 pan/zoom 纯数学与 `MAP_ZOOM` / `LABEL_ZOOM_THRESHOLD`（单一执行路径，F3）；
  `run-t09.mjs` 的 bash grep 改为 Node 内搜索，Windows 上不再把「空输出」当「0 命中」（F9）。

### 验证 | Verified

- `pnpm run typecheck` / `pnpm run build`（确定性）/ `pnpm run test` / `node tests/harness/emit-styles.mjs --check` /
  `python smoke/run_all_checks.py` 的原始输出与退出码见 `output/_verify/threadline/T22/`。
- 影响入口：`output/_verify/threadline/T20/`（含正向 77/77 与反向变异自审）。
- 星图两级：`output/_verify/threadline/T21/`（目录总览 / 文件细节 / 窄屏 / 600 文件 / real20 截图与断言）。
- **真机未验证**：客户端产物需刷新页面 / 重启 DSH 才可见（用户门），本轮只记「待真机确认」，不写成已通过。

## [1.0.0-alpha.1] - 2026-11-05

首个 alpha 预览版：产品重构为「脉络 / Threadline」，永久只读，三个入口。

- 新增：工作区级星图（结构 / 共现 / 引用 / 时序四层关系）、时间轴、轮次带、三种检查器。
- 新增：`/threadline` 命令弹窗与每轮「影响 N」入口；两者不需要先打开 tab 也能读数据。
- 新增：隐私模式、列表视图（键盘可用）、reduced-motion 支持。
- 优化：插件加载即按工作区预热扫描并持续增量更新，打开 tab 时数据已就绪。
- 修复：弹窗与 popover 改为 portal 到 `document.body`（适配 DSH 0.2.2 的 docked composer）。
- 重要说明：本版本为 alpha 预览，接口与界面仍可能调整；旧版（0.7.x）的面板实现与其构建链已整体移除，不提供迁移。

## [1.0.0-dev.0] - 2026-11-04

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
