# Changelog

`dsh-plugin-control-your-development` 的版本更新记录。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

发版纪律：把 Unreleased 落成 `## [<ver>] - <日期>` 后才能发版；不更新 CHANGELOG 不得发版。

## [Unreleased]

## [1.5.0] - 2026-11-11

### 新增

- **「思维链」tab**：统计已持久化的 reasoning 记录，三种视图（矩形树图 / 图标云 / 列表），
  五个筛选（范围 / 模型 / Preset / 语言 / 记录类型），五个维度（句式开头 / 句式类型 / 语言 / 模型 / Preset）。
- **句式排行 + 句子下钻**：点排行里的某个开头（如 `I need`）即可看到具体是哪些句子，
  带会话、轮次、模型、preset、时间与字符数。
- 统计口径：`占总 token` = provider 上报的 `reasoningTokens / totalTokens`（缺失显示未知）；
  `字符占比` = 思维链字符 /（思维链 + 助手回复），两个口径独立，不互相换算。

### 变更

- **节点大小改为表达文件体积**：按字节数对数映射到 4.5–14px；大小未知渲染成空心虚线节点，
  不再按 0 B 处理。操作次数只保留在徽标与证据里。
- **单击 = 选中且幂等；双击 = 进入目录 / 打开文件**（图、卡片、列表三处一致）。
  修复旧实现"第一次单击选中、第二次单击取消"导致双击像是闪一下的问题。
- **hover 不再压暗其他节点与连线**：只提亮当前元素与邻接边。
- **左右栏配比 7:5**（右栏比原先的 50% 窄约 1/6），容器 <1080px 提前单列。
- **右栏列表表头与数据行共用同一组 grid 轨道**，修复名称/类型/大小列错位。
- **轮次会话选择器**：`当前会话` / `全部会话（含归档）` / 未归档的具体会话（用 optgroup 区分）。
- **关系证据移入时间线区域并完全覆盖它**，不再浮在图右下角；folder 与 turn 两种图共用同一个渲染器。

### 修复

- 助手回复摘要不再混入 reasoning 文本（旧实现会把思维链并进"助手回复"，导致字符口径重复计算）。
- 图内证据浮层的两套实现合并为一套，Esc/关闭/焦点行为统一。

## [1.4.3] - 2026-11-10

> 1.4.2 与 1.4.3 **代码完全相同**：1.4.2 发布时 npm registry 先返回 E409（该版本号此前留下过一条
> staged 记录），待其上线后才确认可用，故补发 1.4.3 作为**确认可用**的版本；npm 上两者并存。

### 修复 | Fixed（2026-11-10 真机反馈：选中没有文件改动的轮次，左图一直停在"正在读取"）

**现象**：选中的轮次没有任何文件操作时，左侧图区一直显示骨架 +「正在读取 T13 的文件…」，
永远等不到结果，用户会以为卡住了。轮次带上同时显示「状态未知」。

**根因**：`turnDetailOf` 把「0 文件」和「读不到」混为一谈 —— 只要
`found.files.length === 0 && (!view.fresh || partial)` 就返回 `loading`。
而 `partial` 包含「本轮仍在记录」，于是**正在进行的轮次**会永远停在 loading；
会话行时间戳一推进（`!fresh`），历史轮次也会重新回到 loading。

**修法**：区分「有没有数据」和「数字可不可信」两件事：
- **有数据就出结论** → 返回 `ready`，UI 显示「这一轮没有文件操作」；
- **数字只在可信时才给** → 仅当「数据最新 + 本轮已结束」给 `fileCount: 0`；
  否则 `fileCount` 保持 `undefined`（不谎报 0），并标 `partial`；
- `partial` 时标题追加既有的「本轮仍在记录」（复用 `state.partialTurn`，不新增文案）。

**未变**：`loading` 只用于「真的还没有数据」（detail 未到、或该轮次不在已知数据里且数据已旧），
这时仍显示骨架 —— 那是真的在等，不是假等。

## [1.4.1] - 2026-11-09

### 优化 | Improved（2026-11-09 首次打开与轮次切换的等待感）

- **图区骨架**：loading 时不再只有一个居中转圈点，而是渲染与真实布局同构的占位
  （文件夹卡片 + 文件圆点 + 虚线关系；坐标来自固定表，不用随机数，两次渲染逐字节相同）。
  整块 `aria-hidden`，状态播报仍由 `role="status"` 那行文字负责；尊重 `prefers-reduced-motion`。
- **预热当前会话详情**：扫描一开始就在后台拉起「当前会话 + 其直接子智能体」（上限 4 个）的
  `detail`，这样一个会话只读一次、点它的**任意**轮次都命中缓存。
  原先只有「全部轮次」视图预热了前 8 个根会话，**默认单会话视图完全没有预热**。
- 不做全量预载：153 个会话全解析会让「打开 tab」变成几十秒，比现状更差。

### 修复 | Fixed（2026-11-09 真机事故：整条扫描被一行脏数据打掉）

**现象**：某个 153 个会话的工作区，「脉络」左图永远停在「正在加载文件关系…」，
诊断条显示 `status=failed degrade=failed code=threadline/bad-request sessions=153 files=0`。
右栏文件浏览器正常（它走 `/tree`，由 host 自己从持久层取 cwd），只有左图挂掉。

**根因（两层，都属于「一行坏 → 整条请求 400」）**
1. **协议层零容忍**：客户端 `toScanSessions` 只判 `!== undefined` 未判类型，
   宿主给的 `title: null` / `parentId: null` / `origin: null` 被原样发出，
   host 判定 `invalid title/parentId/origin` → 整条 `/scan` 400。
   TypeScript 的可选类型在运行时被擦除，**类型声明不构成防线**。
2. **归属校验全有全无**：`validateOwnership` 里任一会话读不出 header、
   或 `header.cwd` 与**客户端算出的 cwd**不完全相等 → 整条 400。
   客户端 cwd 与会话 header cwd 本就是两份事实来源，形态差异即致命。

**修法（改策略，不是加判断）**
- 新增 `src/shared/events/normalize.ts`：**边界归一化**（parse, don't validate）。
  客户端与 host 共用同一份实现，`isSessionId` / `SESSION_ID_RE` 上提到此处，
  host 内的重复副本删除 —— 两处各写一份正是"一边放行一边拒绝"的来源。
- `/scan` 校验分两层：**结构性错误**仍 `bad-request`（body 非对象、workspaceId/cwd/generation
  不可用、sessions 非数组或超 3000）；**行级问题**跳过并记账，不再打断整体。
- `validateOwnership` 改为**逐会话判定**：读不出 header 或不属于本工作区 → 跳过该会话；
  **空工作区仍合法**，只有「请求里有会话但一个都不属于本工作区」才响亮失败。
- `/scan` 的**权威 cwd 改为取会话 header cwd 的众数**，客户端传的只作兜底；
  并允许**子目录会话**（`containsPath`），不再要求 cwd 完全相等。
- `refresh` 是优化提示：非法/越界 id 丢弃并计数，绝不因此拒绝整条请求。
- 未知字段一律忽略（宿主以后加字段时前向兼容）。

**可见性（容错不等于静默）**
- `ScanResponse` 新增 `skipped: { request, ownership, refresh }`，只出数字不出 id/路径。
- 客户端 `ControllerSnapshot.skipped` → UI 诊断条新增 `skipped=N`，
  只在真的丢了东西时出现（`shouldShowDiag` 也据此显示）。

**测试**
- 新增 `tests/events/normalize.test.ts`：9 个**敌意输入**表驱动用例
  （`null` / 数字 / 嵌套对象 / 超长串 / 路径穿越 / 原型污染键 / 未知字段 / 非数组输入），
  钉住策略「数据形状再怪也不许整条失败、也不许静默丢」。
- 改写 `tests/events/limits.test.ts` 的校验与归属用例：
  断言从「整条拒绝」改为「跳过并计数」，同时**保留原安全性质**
  （工作区外会话永远不被 `open`，只 `stat` 读 header）。

## [1.4.0] - 2026-11-08

> **发布号说明**：开发树内部曾用 `1.2.0` 编号；正式发布跳到 **1.4.0**，因为发布仓的
> `v1.2.0` / `v1.2.1` / `v1.3.0` / `v1.3.1` 四个 tag 已被**重构前的旧项目**
> （`dsh-plugin-dev-dashboard`，开发仪表盘面板）占用，`v1.2.0` 还配着一个已发布的 Release。
> 本版包含 1.1.0 之后的全部改动：`notes/37-脉络1.2.0-返工交接/` 的 M1–M5 返工，
> 以及 2026-11-08 的第二轮真机反馈返工（左图关系图重做、文件夹互连、时间轴双轨等）。

### 新增 | Added（2026-11-08 真机反馈返工）

**左图改造成真正的关系图（用户原话：「他们之间也应该是有图的结构，有系的连在一起」）**
- 等宽网格布局整体废除，改为**确定性力导向布局**：初始位置由路径哈希决定（不用随机数）、
  固定迭代轮数、节点按路径排序、边按 (from,to) 排序 —— 同一输入两次布局逐坐标相同。
- **边按三档分层**：L1 骨架（结构 + 引用）/ L2 每个节点 top-3 共现 / L3 其余（悬停才淡入）；
  总绘制边数硬上限 `1.6 × 节点数`，超出按权重截断并显式提示。
- **文件夹枢纽参与结构**：① 枢纽 ↔ 当前目录文件（把真实跨边界边聚合到枢纽，线宽 = 聚合权重）；
  ② **枢纽 ↔ 枢纽**（文件夹之间也有真实连线，标准档每枢纽 top-2，全部档 top-4）。
  没有真实关系的枢纽放外围、不画线（绝不伪造）。
- **节点上限 40 + 「显示 N/M」chip**：常驻、可点、就地切全部（同一颗 chip 变「全部 N · 收起」）；
  切全部时自动降级（密度→骨架、标签只留悬停/选中、半径按 `1/√n` 缩、相机自动适应）；硬上限 300。

**时间轴重做为双轨（用户原话：「这个时间轴的格式很粗糙，很丑陋」）**
- 上轨：**活跃度柱状图**（每段一根柱，柱高 = 该时段操作量）。
- 下轨：**会话分层**（每个会话一行，最多 4 行）。
- 播放头一条 2px 竖线贯穿两轨，**全时间轴只有一个标签**（贴边自动翻转）。
- 底部只留 **start / middle / end 三个刻度标签**，取消密集刻度线与图例单位。
- 高度 48px → 104px；删除生长带面积曲线、会话起止竖线、轨道外常驻文本、10px 圆点把手。

**文件夹节点也能拖动（用户原话：「文件夹节点没法拖动？这很坏」）**
- 枢纽与文件节点共用同一套拖拽逻辑（布局层统一按 `path` 键应用偏移）；拖动中给 `grabbing` 光标。
- 点击语义不变：**点一下仍是进目录**；拖动不会误触发跳转。

### 优化 | Improved
- **悬停轮次不再抖动**：修掉「模式切换 → 面板高度变化 → 轮次带上下移动 → 鼠标脱离 → 循环」的
  正反馈循环。根因两条：① 图头在 folder/turn 两种模式下分别占两行/一行（差 32px）；
  ② 本轮摘要条只在 turn 模式存在（差 36px）。两处都改为**高度恒定**。
- **轮次选择改为「锁定优先」**：点选后锁定，悬停别的轮次不再抢画面；未选中时悬停仍可预览。
  修掉「hover 后移开鼠标画面卡住」（`TurnBlock` 原本缺 `onMouseLeave`）。
- 时间轴删除「回到最新」按钮（腾出左侧一列，绘图区变宽 +60px）；
  **能力保留为双击轨道**（语义不变：清空播放头、跟随"现在"）。

### 修复 | Fixed
- `[data-rail-back]` 选择器不存在（真实是 `data-testid="rail-back"`）：既有「进目录 → 回退」
  步骤长期是静默 no-op，断言却一直绿 —— 属于**断言形同虚设**，已修并补强断言。
- 换目录后 hover 状态残留，导致整图长期处于 dim。
- 枢纽/文件点击统一走 `click` 入口：此前把执行权放在 `pointerup`，导致**程序化点击 / 屏幕阅读器 /
  辅助技术**（没有 pointer 阶段）无法进入目录。
- 跨平台：`isInsideCwd` / 文件读取器的 `caseInsensitive` 默认 `true` 在 Linux/macOS 上会
  把「工作区外、只差大小写」的路径误判为区内 → 越界放行。改为按平台自适应（仅 Windows 折叠大小写）。
- 两条计时断言在机器负载下假红（`force.test` 的 p50、`derived.test` 的比值）→ 改为多次采样取最小值，
  阈值不变。



### 返工 | Rework（2026-11-07 真机反馈，M1–M5）

**M1 删除播放（用户原话：「直接把播放 1x 4x 这个功能删掉吧，很莫名其妙」）**
- 删除 `播放/暂停`、`1×`/`4×` 倍速、播放 rAF 推进、`data-playing`/`data-speed`、
  `advancePlayhead`/`playbackSpeedForWindow`/`PLAYBACK_DURATION_*`、`timeline.play`/`timeline.pause` 文案。
- **保留**：范围（今天/7天/30天/全部）、刻度、生长带、可拖播放头、`回到最新`。

**M2 删图尾文案 + 重置布局进缩放组（用户原话：「这个截图里的所有文案都删了」）**
- 整块删除 `.tl-graph-foot` 与四段可见文案（`graph.overviewHint`/`graph.dragHint`/`graph.coverage`/`graph.resetLayout` 文字）。
- `重置布局` 改成缩放组里的**图标按钮**（无可见文字、保留 `aria-label`）；`适应` 只回相机，`重置` = 清拖动 + 相机复位。
- 覆盖信息不消失成谎言：等价信息留在 header 的 coverage 胶囊。

**M3 无感加载（用户原话：「彻底无延迟的体验」；拍板「模仿 dsh-context」）**
- 冷开热点修复：`turnRelations` 由 O(轮次×边) + 每边每轮 `toLowerCase` 改为**边端点小写预索引**（实测 121×–195×，结果逐 key 等价）。
- 缓存命中不盖 skeleton：详情/轮次切换保留旧图 + 内联更新标记。
- 详见 `notes/31-脉络-1.0-交接/04-数据与架构规格.md` §8.1 的硬上限表。

**M4 右栏 = 工作区根目录浏览器（用户原话：「从工作区的根目录开始…点进去之后就会显示这个卡片的文件夹里面有什么内容…增一个回退跟更新…也可以一键切换成列表格式」）**
- 新增目录树数据层（`client/data/tree.ts`）+ 右栏浏览器（`ui/rail/FileTreeRail.ts` + `ui/rail/model.ts` + `styles/tree.css`）。
- 数据源双路径：**首选 `remote.workspaceFiles.list`**；不可用走**用户已批准的 B1 host 只读目录列表**
  （`host/tree.ts` + 第 4 条只读路由 `POST /api/dsh-threadline/tree`，只读 fs、零写、cwd 卡口、拒绝对路径/`..`/越界、不跟随逃逸符号链接、有上限）。
- 功能：任意深度下钻、可点面包屑、回退、更新（只失效当前路径）、卡片/列表一键切换、>200 行虚拟化、无横向滚动、
  空/读取失败/截断显式、未触碰文件中性显示（**不显示假 0 ops**）。
- **纠正一条官方 API 口径**：`list` 的 `path` **不接受空串**（已安装 `dsh-api-workspace-files@0.2.2-rc.1`：
  "An empty read or listing path is a `gateway/bad-request`"）；根层必须用**会话 cwd 绝对路径**。
  旧 `notes/21` 写的「空串=根」已在该文档标注纠正。

**M5 左图 = 当前目录节点图 + 缩放居中（用户原话：「左边节点放大或缩小，它会默认往左上方缩小，但是我想放在中间」）**
- 新 `folder` 模式（`ui/map/FolderMap.ts` + `folderLayout.ts`）：当前目录的**文件夹枢纽** + 文件网格；
  默认不画边、无跨目录蜘蛛网；未触碰文件是中性节点；标签不截成 `relati…` 碎片；>40 节点显示「显示 N/M」。
- **缩放往左上缩的根因修复**：旧相机平移软边界 `max(0, size*(scale-1)/2 + 48)` 在 `scale<1` 时恒为 0
  → `tx/ty` 钉在 0 → 只能往左上收。新 `cameraPanLimit = |size*(1-scale)/2| + 48`；
  五档（0.5/0.8/1/2/3）中心误差实测 **max 0.12px**（阈值 2px）。
- **单一执行路径**：删除 `OverviewMap.ts`/`overview.ts`/`levels.ts` 与全部全工作区星图符号（grep 0 命中）。

**顺带修复**
- `tab.ts` 的 remote 门面优先级：旧 `owner.remote ?? getRemote()` 会让 **Cordis 代理永久挡住**已 inject 好的真实门面
  （引用层恒 disabled / 目录树退 fallback）；改为优先解析后的门面（R00 探针定位）。
- 右栏列表虚拟化的滚动源：从 `globalThis.scrollY` 改为**最近的 scrollable 祖先**（右栏是独立滚动容器，用 window 会卡在首屏）。
- `Timeline` 的 aria-live 静音即时生效（不再被 800ms 节流延迟，避免两个 live region 同时有内容）。
- 构建门禁 `assertHostShape` 由「host 不许 import fs」一刀切改为**只读白名单 + 写 API 黑名单 + 正向前提**，
  抽到 `tools/host-shape.mjs` 并配 `tests/integration/host-shape.test.ts` 做**正反两侧**审计（13 例）。

### 新增 | Added（第一版，上半场）

第一版 1.2.0 面向用户第 13 轮反馈（7 条）：目录卡口径、时间轴回放、点击大焦点框、标签重叠/缩放、逐层下钻、列表排版、hover/状态泄漏。

- **逐层下钻（Q5）**：点目录簇/右栏顶层卡进入下一层并停住；图头面包屑「全部目录 / 段…」+「上一层」；
  点空白 / Esc 退回一层；「本目录文件」哨兵卡只展开；轮次视图退出后回到原层；切工作区/会话重置。
- **缩放（Q4）**：图头 `− / 适应 / +`；相机 scale 0.5–3，默认 1，只存内存；缩放围绕视口中心；scale>1 空白拖拽平移；
  节点拖动按 scale 换算；不持久化；reduced-motion 无过渡。
- **时间轴回放接通（Q2 A）**：播放头驱动左图可见性（`visibleAt`）与簇「可见 k/N」；范围按钮同时筛图/卡片/时间轴；
  1×/4× 改为整窗约 30s / 7.5s；播放头文本带日期；「回到最新」清空播放头跟随现在。
- **列表视图样式（Q6）**：新增 `styles/list.css`；fixed 布局、两行首列（主名 + 次级目录）、窄栏容器查询降级、
  行高锁 26px、表头 sticky、无横向滚动、时间带日期、进入列表滚动复位。

### 修复 | Fixed

- **点击节点的大焦点框（Q3）**：`.tl-ofile` 补 `:focus{outline:none}` + `:focus-visible` 细环，鼠标 pointerdown 不抢焦点；
  选中只保留填充加深 + 1.5px 环。
- **关系证据 X 关不掉（Q3）**：`close()`/Esc 统一清本地 + `onSelectFile(null)` + 焦点回 SVG；浮层 `role="dialog"` → 非模态 `region`。
- **标签重叠（Q4）**：簇内标签改 `placeLabels` 避让层，占位节点圆/簇头/内边距，clamp 簇框、放不下隐藏、hover/选中强制。
- **hover 卡住 / 回不到完整图（Q7）**：右栏卡补 `mouseleave`；图背景点击清 hover；布局变化清 dragOffsets / hoverFileKey；
  Esc 按「证据 → 轮次 → 下钻层 → 选择」逐层退；dim 提到 0.55/0.5；文件节点加 r+8 命中圆。
- **卡片「最近」用 UTC（Q6 顺带）**：rail/图统一本地 `MM-DD HH:MM`。
- **列表进入时顶部空白（Q6）**：`listScroll` 进入/挂载时复位。
- **未加载假能力（Q2）**：删除 `unloadedRanges` 渲染/纯函数/CSS（从未有数据源）；`onPlayheadTick` 死接口删除。

### 验证 | Verified

- `typecheck` 0；`build`×2 逐字节一致；`emit-styles --check` 0；`pnpm test` 610/610；`t07`/`t09` EXIT 0。
- 证据：`output/_verify/threadline/T40/`（unit/probe/typecheck/build/test/t07/t09 原始输出与截图）。

## [1.1.0] - 2026-11-07

用户第 12 轮反馈：首屏假空态、滚轮不分区、图不够可读/可交互。P0–P2 一起做。

### 新增 | Added

- **默认总览星图**：左图默认显示全部目录簇（右卡全部目录；每簇 top3 + `+N` 聚合），不再只显示单目录；
  簇间只画目录级弱关系，hover/点击簇再展开 top12 文件，避免数千节点蜘蛛网。
- **确定性有机布局**：目录簇轻量碰撞/螺旋排布 + 簇内黄金角；无第三方依赖、固定 seed；节点可拖动（pointer capture，内存态），双击/按钮重置。
- **交互联动**：卡片/簇 hover 展开、节点放大/光晕/相连边提亮、无关 dim；轮次切换 180–240ms 过渡；reduced-motion 直接切换。
- **关系可解释**：同一对文件多条关系按 pair 聚合为一条视觉线 + 类型徽标；关系类型 chip 计数可过滤；边/文件点击显示 evidence 浮层；图尾显示已加载会话覆盖。
- **目录卡关系摘要**：与多少其它目录相关 + top partner；**轮次块关系徽标**：本轮文件之间关系数。
- 新 locale：`graph.*` / `rail.*` / `turns.relations*` 17 条（147 条 key）。

### 修复 | Fixed

- **首屏假 0/假空态**：detail 三态（loading / ready 0 文件 / error）接入；loading 显示骨架和「T{n} 正在读取」，不把 undefined 画成 0；
  会话行 `updatedAt` 变化会重拉 detail，聊天页/impact 入口提早预热当前会话；无 messageId 也至少启动 warmup。
- **滚轮分区**：桌面 ≥960 左右两栏各自滚动（shell/页面不滚），滚轮按指针所在栏；header/Now 固定；左列取消 sticky；<960 回退单页滚动+堆叠。
- **tab 默认焦点**：直接点 tab 默认总览，不再先恢复旧轮次；显式 impact/命令 focus 才落到轮次，且先显示加载骨架。

### 验证 | Verified

- `pnpm run typecheck` / `pnpm run build`（两次逐字节一致）/ `pnpm test` **591/591** / `emit-styles --check` 全 EXIT 0。
- `TL_TASK=T38 node tests/ui-map/run-t07.mjs` EXIT 0：1440 总览/焦点展开/轮次/1200/900/800/980、双栏独立滚动、**真实 wheel 分区**、**真实拖动**、
  点卡片 pin/收起、轮次进出、Esc。
- `node tests/entries/run-t09.mjs` EXIT 0：tab 总览、**慢 detail loading 不显示 0 文件**、impact 导航、无 dialog/popover。
- `smoke/run_all_checks.py` PASS 7 / FAIL 0 / SKIP 0。
- 证据：`output/_verify/threadline/T35/`（星图）、`T36/`（布局/关系卡）、`T37/`（首屏数据）、`T38-check/`（总装门禁）。

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
