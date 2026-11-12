# Changelog

`dsh-plugin-control-your-development` 的版本更新记录。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

发版纪律：把 Unreleased 落成 `## [<ver>] - <日期>` 后才能发版；不更新 CHANGELOG 不得发版。

## [Unreleased]

## [1.5.5] - 2026-11-12

> 一次**结构性正确性**修复：先修「连不上、切换闪、筛选不一致、宿主输入框露出」，
> 再让两个页面的精修都建在同一个几何/状态口径上。布局、配色体系与原生 Shell **未改**。
> 依据：`DSH 脉络与思维链 UI 优化交接方案`（审计基线 v1.5.4 / commit `36f2044`）。
> 证据：`output/_verify/threadline/T95-p1-surface/`、`T96-p1-filter/`、`T97-final/`、
> `P2-map-graphscene/`。

### 修复

- **思维链页底部仍然露出宿主会话输入框（说了"独占一屏"，实际只加了类名）。**
  **根因**：只有「脉络」tab 接了 `useComposerSurface` + 宿主可视高度同步；思维链的
  `ReasoningSurface` 只补了 `class="threadline-app"` 和样式根，**两个机制都没有**。
  `reasoning.css` 的 `block-size:100%` 替代不了宿主高度测量 —— 宿主滚动容器的内容高度是
  `auto`，`100%` 只会拿到内容高度，外壳不会变成真正的滚动容器。
  **修法**：新增 `ui/shell/ConversationSurface.ts`，把「composer 隐藏 + 宿主可视高度 + 样式根」
  收敛成唯一实现，两个 tab 共用；`entries/tab.ts` 里那份手写逻辑删除（`useComposerSurface`
  与 `surfaceRef` 在该文件内 grep 归 0）。审批/提问/计划复核的 composer 仍由 `surface.css` 显式排除。

- **思维链的「语言」下拉是个摆设（选了任何语言，图表一个字都不变）。**
  **根因**：`filterSamples()` 明确不做语言过滤（语言是逐句判定的，样本级没有该字段），
  而 `deriveReasoning()` 也从没调用过已经存在的 `sentencesByLang()`。
  **修法**：语言筛选下沉到聚合层 —— `aggregateReasoning(samples, dim, { lang })` 按句剔除后
  重算字符/token/分组/句子明细（一个口径，不新增第二套统计）。语言选项改从
  `derived.allSentences`（**筛选前**）枚举，否则选了中文之后英语/混合会从下拉里消失。

- **Preset 是个隐性状态：有 `filter.preset`、注释写着"五个筛选"，但工具栏只渲染四个。**
  **修法**：新增 `presetOptionsOf()`（从真实样本枚举，不写死）+ 工具栏「更多筛选」入口。

- **脉络页「文件夹 ↔ 文件夹」的线不跟着节点动。**
  **根因**：`edgeSync.ts` 的 `edgeKeyOf()` 只认 `data-edge-id` / `data-hub-edge-hub|file`，
  而 `renderHubPair()` 输出的是 `data-hub-pair-*` → 这类边从未被插值。
  **修法**：删除整条 `edgeSync` 路径，改由 `sceneClock.ts` 用 hub A/B 的**当前帧坐标**派生端点。

- **边快照读早了（存下来的是旧帧，不是注释说的"动画结束后"）。**
  **根因**：`syncEdges()` 会把 DOM 钉回旧坐标，紧接着 `readEdgeFrames()` 读到的就是被钉回的值。
  **修法**：快照机制整体删除；`useSceneClock.ts` 以"当前可见帧"为起点，不再从 DOM 读。

- **节点、文件夹图标、标签、三类边各用不同时钟 → 中间帧四处错位。**
  **修法**：`interpolateGeometry()` 在同一帧插值 nodes/hubs（含卡片 `width/height`），
  渲染层全部从这一帧取坐标；`map.css` 删除 `cx/cy/r`、`x/y/width/height`、标签坐标的 CSS 几何过渡
  （保留颜色/透明度/描边的短过渡）。统一时钟只同步坐标，**不重排布局**。

- **SVG 每 30 秒自己被重建一次，入场动画周期性重播。**
  **根因**：`<svg>` 的 `key` 串含 `props.now`，而 `now` 在 tab 里每 30s 刷新一次。
  **修法**：删除整个 key（场景根常驻）；`props.now` 在该组件内出现次数归 0。入场动画改由元素级
  CSS keyframes 承担，不再依赖重挂载。

- **`--tl-fs-caption` 令牌从未定义，`map.css` 里 5 处引用集体失效。**
  **修法**：在 `tokens.css` 补上该令牌（取 meta-sm 与 meta 之间的一档）；不改那 5 处引用。

### 改进

- **矩形树图**：真 squarified 布局（同输入同输出）；`ResizeObserver` 读真实容器尺寸并以**相同尺寸**
  设 `viewBox`（窄屏是重新布局，不是把 960px 的图整体缩小）；每格独立 `clipPath`（名称与数值不越界）；
  颜色按 `group.key` 哈希**稳定映射**（筛选/排序后同一组不换色）；最多 12 格，其余并入「其他」，
  「其他」可下钻到被合并的分组列表。
- **词云**：两阶段布局 —— Canvas `measureText` 量真实包围盒 → 大词优先 + 确定性螺旋候选点 →
  相交继续找 → 放不下则降字号 → 仍放不下则**跳过并计数**（`未显示 N 项`，不静默丢失）。
  修了一个功能性缺陷：原来喂的是合并后的 ≤12 组，词云永远只有 11 个词、「未显示」永不出现；
  现在喂全量分组，放不下的事实才真的可见。
- **列表**：表头改成真 `<button>` + `aria-sort` + 方向箭头；分组与句子分页增量渲染
  （`显示 N/M`）；键盘 ↑↓ 移动、Enter 选择、Esc 清除，与图形视图共享同一个选中状态。
- **自研可访问 Listbox**：`button + listbox + option` 语义；↑↓ / Home / End / Enter / Esc / Tab、
  字符前缀搜索、点击外部关闭并归还焦点；替换全部原生 `select`，不引入任何 UI 库。
- **覆盖率与按需加载**：常驻显示「已加载 N/M 个会话」+ 失败数 + 「继续加载 / 加载全部」；
  `loaded` 只数**真的拿到 detail** 的会话，失败单独计数 —— 不用"请求发出去了"冒充已加载。
- **空态可解释**：区分「筛选滤空了」与「本来就没有记录」，前者列出具体条件并给「重置」。
  活动筛选行只在有非默认筛选时出现，不占高度。

### 测试

- 新增 `tests/reasoning/filter-pipeline.test.ts`（12 条）专守「控件改了必须真的改变数据」：
  每条先断言筛选前后**确实不同**，再断言结果**符合预期**。反向验证（把 `langFilter` 短路成 `'all'`
  模拟旧行为）实测 **5 条真的红**并点名「语言筛选没有改变字符总数」。
- 新增 `tests/ui-map/scene-clock.test.ts`（10 条）：在 progress = 0/0.25/0.5/0.75/1 采样，
  断言端点偏差。反向验证（端点改回读静态值）实测红并点名 `p=0 hub:src>README.md x1`。
- 新增 `tests/reasoning/{viz-layout,listbox,reasoning-view}.test.ts`。
- 重写两条已漂移的守卫：`reasoning-surface.test.ts`（从"源码里字面出现 className"→
  "入口必须经过共用表面 + 表面必须真的隐藏 composer/同步高度"）、
  `layout-transition.test.ts`（从"用 CSS 过渡做布局动画"→"几何由 rAF 驱动、CSS 不得再对几何声明过渡"）。
- 修正 `tests/harness/run-reasoning.mjs` 与 `reasoning.css` 里已失效的 `.tl-cloud-tile` 选择器
  （组件早已输出 `.tl-cloud-word`）。
- 全量 `node --test`：**1023 tests / pass 1023 / fail 0**；`typecheck` exit 0；
  `build` 两次逐字节一致；`emit-styles --check` exit 0。

### 文案

- 新增 17 条（§16 表格同步）：`reasoning.coverageLoaded|coverageFailed|loadMore|loadAll|loadingMore|
  moreFilters|preset|activeFilters|resetFilters|filteredEmpty|otherDrill|otherList|cloudSkipped|
  showing|noOptions|sortedAsc|sortedDesc`。`SPEC_KEYS` 225 → 242。

### 真机复核第二轮（同日，用户验收 8 条反馈）

安装后用户在真机上逐条验收，回报 8 个问题。全部先复现、定位根因，再改根因。

- **思维链「token 显示观测不到，比例对吗」（这条是统计口径错，不是数据缺）。**
  **实测取证**（本会话 `session-6bf1e99a…`，1896 行）：带 reasoning 的 assistant 消息 150 条，
  其中 `reasoningTokens`/`totalTokens` 齐备 **150/150 —— 一条都不缺**。
  **根因三条**：① `aggregateReasoning` 把整段 token 只记给"字符占优"的那一组，
  其余组一律 0 → 6280 个组里绝大多数显示"未知"；② 「占总 token」用
  `reasoningTokens / totalTokens`，而 `totalTokens` 是上下文口径（含输入与缓存，
  实测 26639 里 cacheRead 就有 20480），该比值中位数只有 **0.13%**、最大 2.66%，
  没有解释力；③ 「字符占比」的分母只算"普通文本块"，而 150 条回复里只有 **10 条**有正文
  （其余只有 reasoning + tool-call），分母几乎为空 → 算出 **99.7%** 这种假数。
  **修法**：token 改为在同一段 thought 内**按各组字符占比分配**（守恒：各组之和 = 整段真实值，
  UI 标注「估算」）；「占输出」改用 `tokens / outputTokens`（同批样本中位数 **58.2%**）；
  新增「占上下文」列如实保留上下文口径；`charRatio` 在 `answerChars === 0` 时返回 **null**
  （显示 `—`，不再是 99%）。`hasTokens` 必需项随之改为 `tokens + outputTokens`。

- **思维链「整体统计口径有问题，应该只统计这一个对话」。**
  **修法**：`DEFAULT_FILTER.range` 从 `workspace` 改为 **`session`**；新增 `filter.turn` 与
  轮次下拉（`derived.turnOptions` 从**轮次过滤前**枚举，否则选 T3 后其他轮次会消失）；
  全工作区仍可从范围下拉显式切换。`range === 'session'` 时不再渲染「已加载 N/M」覆盖率条
  （当前会话是完备的，没有覆盖率问题）。

- **思维链「左侧『句式开头』『句式类型』排成几列很乱」。**
  **根因**：`reasoning.css` 两处容器查询把 `.tl-reasoning-nav` 改成 `flex-direction: row; wrap`。
  **修法**：两处 override 全删，任何宽度下恒为单列。

- **思维链「矩形树图格内文字对不上，很多地方空着；特别小的可以不显示，大的一定要显示」。**
  **根因**：阈值 `54×26` / `84×44` 太粗（大而窄的格整片空白），且文字画在 `x+8` 后靠
  `clipPath` **硬切**（出现 `Actually t` / `I should` 这种残片）。
  **修法**：阈值降到 `40×20`（名称）/ `64×40`（数值）；按格子真实可用宽度做省略号截断，
  `clipPath` 降级为纯兜底。实测 1440→260px 六档零越界，200px 时出现省略且无任何中间残片。

- **思维链「顶部『当前工作区』『全部』这些下拉不知所云，也没显示全」。**
  **根因**：换成自研 Listbox 时把**可见标签**丢了，`label` 只进了 `aria-label`/`title`
  → 五个按钮上只有值（全是"全部"）。
  **修法**：按钮前补 `<span class="tl-listbox-caption">`；按钮上限 190 → 260px。

- **思维链「点了详情之后，最上面的『字符数』『思维链』一栏就被遮住」。**
  **根因**：`.tl-reasoning` 是 column flex，子项默认 `flex-shrink: 1`；总高超出时 KPI 被压缩，
  而它自身 `overflow: hidden` → 数值被裁掉。不是 sticky 遮挡。
  **修法**：工具栏 / 覆盖率条 / 活动筛选行 / KPI / 详情带全部 `flex: 0 0 auto`，
  KPI 加 `min-block-size: fit-content`；超高时靠根容器滚动，不再压扁。
  实测 1440×1000 / 1440×600 / 1440×600+详情 / 900×600 四档，KPI 被裁 0px。

- **脉络「点具体轮次时，先出现线然后节点才加载进去」。**
  **根因**：folder 与 turn 的入场时序**不是同一套**——边写死 `animation-delay: 60ms`，
  节点有 `--tl-enter-i` 错峰，`TurnMap` 的节点**完全没写** `--tl-enter-i`，
  三类标签**根本没有入场动画**（一上来就是终点透明度）。
  **修法**：收敛成单一契约 `theme.ts:enterStyleOf()` + 两条 CSS 常量
  `--tl-enter-step: 12ms` / `--tl-enter-offset: 60ms`，分三层：节点 0ms 起按序错峰 →
  边 +60ms → 标签 +60ms。folder 与 turn 共用同一组选择器，不再各写一份。

- **脉络「有些文件夹不显示名称」（5 个卡片只出 1 个名字）。**
  **根因**：`labelVisible: wanted <= FOLDER_HUB_MAX_WIDTH`（132px）——名字一超 132px
  就**一个字都不画**，不是"放不下"而是"没做省略"。
  **修法**：新增 `truncateToWidth()`（同一套 `textWidth()`，省略号计入宽度，逐字符回退）
  与 `FolderLayoutHub.labelText`；卡片宽度钳制不变（布局不变），渲染用 `labelText`，
  `title`/`aria-label`/`data-hub-name` 仍用完整 `name`（省略不丢信息）。
  0.5px 容差用于抵消 `Math.round` 取整差（否则 `docs`/`assets` 会被截成 `do…`）。

### 测试（第二轮）

- 新增 `tests/reasoning/token-semantics.test.ts`（11 条）守 token 分配守恒与三个分母。
  **反向验证**：把分配改回"只给一个组"，**9/11 真的红**并点名「每组都应分到 token，实际只有 1 组」。
- 新增 `tests/reasoning/reasoning-fixes.test.ts`（16 条）覆盖导航单列 / 树图标签 / Listbox caption /
  KPI 不被压缩 / `range === 'session'` 不渲染覆盖率条。
- 新增 `tests/ui-map/hub-label.test.ts`（10 条），含**反向断言**「短名必须整词显示」。
- 重写 `tests/ui-map/graph-enter.test.ts`（12 条）守「两种模式共用同一入场规则」。
  **反向验证**：删掉 `FileGraph` 的 `--tl-enter-i`，真的红并点名。
- 全量 `node --test`：**1067 tests / pass 1067 / fail 0**；`typecheck` exit 0；
  `build`×2 逐字节一致（`index 9477a7ffc82d` / `client e38f1fc3d7fa`）；
  `emit-styles --check` exit 0；项目 smoke **7/7**；工厂 `ready.py` 全量 **PASS 196 / FAIL 0**。

### 真机复核第三轮（同日，用户验收 2 条反馈）

两条里有一条是**我上一轮修错了层次**，记在这里避免以后再犯。

- **思维链「下拉列表还是没显示完整」（语言下拉只剩 `33.4k` 这堆数字，语言名整列消失）。**
  **根因两条叠加**：① `.tl-listbox` 是 `inline-flex`（宽度收缩到按钮），而弹层的
  `min-inline-size: 100%` 是相对**这个收缩宽度**解析的 —— 「语言」这种短按钮的弹层只有按钮那么宽；
  ② 选项网格 `14px minmax(0, 1fr) auto` 里 `minmax(0, 1fr)` 的**下限是 0**，
  在窄弹层里先被压成零宽（连省略号都没东西可省），而 `auto` 那列（字符量 meta）按内容撑开
  → 名称列归零，只剩数字。
  **修法**：弹层改 `inline-size: max-content` + `min-inline-size: 100%` +
  `max-inline-size: min(340px, calc(100vw - 24px))`（内容驱动且不超出视口）；
  名称列改 `minmax(auto, 1fr)`（下限按内容）；新增 `data-align="end"` 右对齐兜底
  （纯 CSS 不知道弹层实际宽度，由 `Listbox` 开合后实测一次右边缘）。

- **脉络「点不同轮次还是关系线先出现并固定，然后节点才连上去」。**
  **上一轮我修错了层次**：只统一了 CSS 入场动画时序（给 `tl-fnode` 补 `--tl-enter-i`），
  但症状里的「线**固定**」说明真正的问题是**没有位置插值** ——
  `FolderMap` 在 P2 已接 `useSceneFrame`，而 **`FileGraph`（轮次图）从来没接过**
  （`useSceneFrame`/`interpolateGeometry` 在 `FileGraph.ts` 里 0 命中）。
  于是切轮次时边用**新坐标直接渲染**（先出现且定住），节点只有 CSS 入场动画从旧位置淡入。
  **修法**：把插值内核抽象成「按 key 的节点坐标快照」——
  `NodeFrame` + `interpolateNodeFrames()`，`FolderGeometry` 与 `GraphLayout` 各写一个薄适配器
  （`nodeFramesOfFolder` / `nodeFramesOfGraph`），`useNodeFrames<T>` 泛型时钟供两者共用；
  轮次图的边端点与标签坐标全部取自**当前帧** `nodeByKey`，不再读 `layout` 里的静态值。
  `interpolateGeometry` / `useSceneFrame` 退化为薄封装（单一执行路径：`lerp` 定义 1 处、
  `interpolateNodeFrames` 定义 1 处、`requestAnimationFrame` 只在 `useSceneClock.ts`）。

### 测试（第三轮）
- 新增 `tests/reasoning/listbox-layout.test.ts`（5 条结构性断言）。
  **两次反向验证**：退回 `minmax(0,1fr)` → 1 条真红并点名；删掉 `max-content` → 2 条真红并点名；
  恢复后 5/5 绿。
- 新增 `tests/ui-map/turn-scene.test.ts`（13 条）：轮次图在 progress = 0/0.25/0.5/0.75/1
  采样，端点偏差**严格 = 0**，边端点 `x1` 单调连续（340 → 304 → 269 → 233 → 198）。
  **过程发现（值得记住）**：纯函数测试测不到渲染层接线 —— 把 `nodeByKey` 换成读静态坐标时
  内核测试全绿。因此补了**源码级断言**守住「边起点必须取当前帧 `nodeByKey`」，
  反向验证现在才能真红并点名。
- 全量 `node --test`：**1085 tests / pass 1085 / fail 0**；`build`×2 一致
  （`index 9477a7ffc82d` / `client d396228ffe73`）；`emit-styles --check` exit 0；
  项目 smoke **7/7**；工厂 `ready.py` **PASS 196 / FAIL 0**，验证记录 CURRENT。

### 真机复核第四轮（同日，"轮次图要生长，不要转场"）

用户第三次强调同一条，前两轮**我都修错了层次**，记在这里。

> 「我是希望关系线和节点一起**生长出来**，而不是提前预订好的那样**转场进入**。」

**前两轮错在哪**：
- 第一轮只统了 CSS 入场动画时序（补 `--tl-enter-i`）——症状里的"线**固定**"说明不是动画问题。
- 第二轮把轮次图接上统一时钟（`useNodeFrames`）——但那只是让线跟着节点**滑动**，
  仍然是"从旧布局滑到新布局"，不是"生长"。

**真正的根因**：`interpolateNodeFrames` 的语义是「同一 key 在旧快照里存在 → 从旧坐标滑到新坐标」。
于是两种模式的观感差异**不是路径不同，而是 key 重合度不同**：

| 场景 | 旧 key 命中 | 表现 |
| --- | --- | --- |
| 切目录 | 多数字文件不在旧图里 → 走「无旧值」分支 | 从画布中心长出（像生长） |
| 切轮次 | 文件几乎完全相同、只有 ops 变 → 几乎全部命中 | 从旧位置滑过去（就是"预订好的转场"） |

**修法**：给时钟加 `restartOn`（视图身份）。值变化时用**空快照**喂给同一个
`interpolateNodeFrames` → 每个 key 都命中「无旧值」→ 全部从 `enterOrigin()` 生长。
不新增第二个插值函数（`sceneStartFrames()` 是唯一的重置规则）。
- `FileGraph`：`restartOn: 'turn:' + 轮次号`；`FolderMap`：`restartOn: currentPath`。
- 顺带修掉第二个"转场感"来源：**`FileGraph` 的 SVG 有 `key: 'svg:turn:' + n`**，
  切轮次整张重建 → 生长动画直接作废（新场景以终点坐标挂载）。已删除，与 folder 图同一条
  「场景根常驻」纪律。
- **双重动画冲突**：几何在生长时，逐元素 `translateY(-6px)` + 错峰淡入会叠加成"抖着长出来"。
  现在时钟对外暴露 `growing`，渲染层写 `data-scene-motion='grow'`，CSS 据此关掉逐元素动画、
  改为整层短淡入。**首次挂载不受影响**（首帧不生长 → `idle` → 逐元素动画照常播，
  首屏不会变成"突然出现"）。
- 删掉 `.tl-fnode` 系列残留的 CSS 几何过渡（turn 图已归 rAF，留着就是两条时钟）。

**测试**：新增 `tests/ui-map/scene-restart.test.ts`（7 条），关键三条：
「`restartOn` 变化后同一 key 在 `p=0` 位于 origin」「反向：不重置快照时从 T1 坐标起步」
「`restartOn` 不变时仍是旧位置→新位置插值（不是每次都从中心重来）」。
**反向验证（Lead 亲自复核）**：把重置逻辑删掉 → **3 条真红**并点名；
恢复后 7/7 绿。`layout-transition.test.ts` 里一条「turn 图必须保留 CSS 几何过渡」的旧断言
方向反转（那是 turn 图还没接 rAF 时的事实），已说明理由并改语义，不是放宽。

**门禁**：全量 **1093/1093**；`build`×2 一致（`client ef73e641941c`）；
`emit-styles --check` exit 0；项目 smoke **7/7**；工厂 `ready.py` **PASS 196 / FAIL 0**。

## [1.5.4] - 2026-11-11

> 真机反馈八项：关系线与节点动画不同步、思维链独占一屏、配色饱和度、词云、模型筛选、
> 布局重排，以及思维链整体的 UI/UX 与内容口径。证据：`output/_verify/threadline/T93/`。

### 修复

- **关系线不跟着节点动（"节点动，线早就在位置上等着了"）。**
  **根因（实测）**：`<line>` 的 `x1/y1/x2/y2` 是**表现属性**，Chrome 不对它们做 CSS transition
  （探针：写 `transition: x1 …` 后改属性，70ms 就已到终点值；`getComputedStyle(line).x1` 返回空串）。
  用 `<g transform>` 能动画，但只能表达平移——端点分别移动时线长变化表达不了。
  **修法**：新增 `ui/map/edgeSync.ts`，在 `useLayoutEffect` 里用 rAF 逐帧插值端点，
  与节点共用 `--tl-dur-layout` 时长与缓动；拖动中不插值（会黏滞），reduced-motion 下直接跳。

- **节点图每次加载没有出场动画。**
  **修法**：`<svg>` 的 key 含轮次/目录/档位 → 换图即重挂载，入场动画每次重播；
  节点按序号错峰（`--tl-enter-i`，封顶 30 档 × 12ms），线在节点之后淡入。

- **思维链"仅仅是覆盖了会话页，甚至会显示会话框"。**
  **根因**：`.tl-reasoning` 没有 `block-size: 100%` 也没有不透明背景 → 内容不足一屏时
  下面直接露出宿主会话区。
  **修法**：撑满宿主区域 + 不透明底色 + 自己内部滚动；空态同样撑满。

- **思维链配色"太丑、饱和度太高"。**
  **根因**：直接借用了 `--dsw-alias-state-*`（语义状态色，饱和度天然很高，且"红=错误"会被误读）。
  **修法**：新增一组**统一浅色粉彩** `--tl-chart-1..8`（只混 26–34% 色相），
  格子文字统一用深色前景；词云另用 `--tl-chart-ink-1..8`（同色相深色版），避免浅字压浅底看不见。

- **图标云"非常丑，要词云且显示对应的文字"。**
  **修法**：`IconCloud` → `WordCloud`：文字本身就是图形，字号 ∝ 字符数（对数压缩），
  螺旋布点（确定性，同数据同画面），不再画色块矩阵；显示原词，不截断、不用符号。

- **模型筛选"只显示全部和其他"。**
  **根因**：筛选器把模型名**写死**成 `DeepSeek V4` / `Kimi K3`，而真机 `sample.model`
  是 `deepseek/deepseek-v4.1-flash` / `k3` / `k3-256k` → 选任何一项都把样本滤空。
  **修法**：`modelOptionsOf` / `langOptionsOf` 从真实样本枚举，下拉里就是真实存在的值。
  夹具的模型名也同步改成真实值（原来夹具与真机脱节，正是这个 bug 没被测出来的原因）。

- **思维链布局「图在左，排行在右，详情在下」。**
  **修法**：`.tl-reasoning-body` 两层——上层 `维度导航 | [主图 | 排行]`，下层详情整宽带；
  窄容器（<1080px）排行掉到主图下方；极窄（<760px）维度导航变横排。

### 变更

- **Top 10 → Top 50**（用户明确要求"显示前 50"）；合并阈值随之从 1% 收紧到 0.1%，
  避免 Top50 口径下仍出现 1–2px 细条。
- 新增卡片/词云相关令牌：`--tl-chart-ink-1..8`。

### 测试

- 新增 `tests/ui-map/edge-sync.test.ts`（7 条）：中间值、精确终点、跳过未变、reduced-motion、
  拖动禁用、取消清队列、**FolderMap 真的接入了插值器**。
- 新增 `tests/ui-map/graph-enter.test.ts`（5 条）：key 含轮次/目录/档位、选中不得进 key、
  线在节点后、错峰封顶、reduced-motion 不播。
- `tests/reasoning/viz-collapse.test.ts` 同步到 Top50 / 0.1%。
- 全量：**970 pass / 0 fail**（1.5.3 为 958）。

## [1.5.3] - 2026-11-11

> 真机反馈四修：列表行尾错位、选中后布局瞬跳、思维链树图不上色/太细/词云显示符号、
> 以及**打开脉络与思维链要等很久**（本轮做了架构级提速）。
> 证据：`output/_verify/threadline/T92/`。

### 修复

- **右栏列表「操作」列看起来没对齐。**
  **现象**：同一列的圆点在目录行和文件行之间左右乱跳。
  **根因**：行尾是一个 flex 右对齐行 `[色彩点, 当前标记, 操作徽标]`——目录行没有徽标，
  色点被推到最右（1340–1346）；文件行有徽标，色点被挤到左边（1318–1324），**跨行差 22px**。
  **修法**：第 5 条 grid 轨道内部再分两个**固定**子槽（色点 14px / 操作 26px），恒定渲染。
  实测两类行的色点都落在 1302。

- **选中文件节点后整图布局"瞬间跳过去"，没有过程。**
  **现象**：单击节点后其余节点被重新排布，但位置变化是瞬时的。
  **根因**：节点的几何是 SVG 的 `cx/cy/r`，此前没有任何 transition。
  **修法**：为节点/标签/枢纽卡片/边统一声明布局过渡（`--tl-dur-layout: 280ms`）。
  实测 Chrome 对 `cx` 有过渡：改属性后 70ms 屏幕位置处于中间值、670ms 到达终点。
  拖动中**不加**过渡（否则逐帧跟随会黏滞），reduced-motion 下全部取消。

- **思维链矩形树图没有上色。**
  **根因**：CSS 的 `.tl-tree-cell[data-tone]` 三色灰阶规则**同特异性且写在后**，
  覆盖了渲染层的 `fill`。且 `fill` 作为 SVG 表现属性，优先级低于任何 CSS 规则。
  **修法**：配色改为**内联 style**（`fill: var(--tl-chart-N)`），并删除那套灰阶规则；
  新增 8 个 `--tl-chart-*` 分类色令牌（只引用宿主令牌、fallback 灰阶，符合 A40-1）。
  格子文字同时改成反白 + 描边，深色格子上可读。

- **思维链矩形树图格子太细（真机 23106 组）。**
  **修法**：新增 `collapseTreemapGroups`——占比 < 1% 的并入「其他」，再取前 10 组，
  其余并入同一格；被合并的组数在标题旁显式提示（`reasoning.collapsed`），不静默。

- **思维链图标云显示符号而不是词语。**
  **根因**：`FORM_GLYPH` 只有 form 维度的 5 个 key；其它维度（句式开头/语言/模型/Preset）
  的 `group.key` 是任意字符串，查不到就落到 `◈` 兜底——用户看到的"星号"。
  **修法**：新增 `cloudGlyphOf(key, dimension)`——form 用符号，其它维度显示文字本身。
  方块同时改为彩色底 + 反白字（与树图共用分类色）。

### 性能（架构级）

**真机问题**：打开脉络/思维链要等很久，思维链会卡住。
**实测**（本工作区）：**304 个会话日志 / 302.7 MB**；单会话 10.9MB 的耗时分解为
读盘 4ms + **解压 80ms** + **JSON 解析 142ms** + 归约 24ms ≈ **249ms**，
其中 **89% 花在解压与解析**——而 `handle.read(0)` 每次都把整份日志全量读回来。

- **host：新增 detail 缓存命中（根因修复）。**
  `/detail` 请求新增可选 `updatedAt`；与缓存一致且非 `refresh` 时**直接返回缓存、不读日志**。
  没有 `updatedAt` 时不命中（无法判断过期，不伪造）。`coldDetail` 也写入缓存。
- **client：`updatedAt` 随 `/detail` 上行**（`data/detail.ts`），让上面的缓存真正生效。
- **思维链预取上限 12 → 4**：首屏本来就有当前会话兜底，其余按需。

### 变更

- 新增文案 key `reasoning.collapsed`（zh/en + `MESSAGE_KEYS` + 规范 03 §16 一并登记）。
- 新增令牌：`--tl-dur-layout`、`--tl-chart-1..8`。

### 测试

- 新增 `tests/host/detail-cache.test.ts`（4 条）：未变更不重读、变更必重读、不同会话不串、无 updatedAt 不伪造命中。
- 新增 `tests/ui-map/rail-tail.test.ts`（3 条）、`tests/ui-map/layout-transition.test.ts`（6 条）。
- 新增 `tests/reasoning/viz-collapse.test.ts`（7 条）：合并阈值/Top N/配色/词云文字。
- 全量：**958 pass / 0 fail**（1.5.1 为 919）。

## [1.5.1] - 2026-11-11

> 真机反馈三修：脉络版式的双栏断点、文件节点的 hover 反馈、思维链 tab 恒空态。
> 三条都在真实组件上复现、修根因、并用渲染级证据复核（`output/_verify/threadline/T90/`）。

### 修复

- **脉络版式：双栏不再在宿主侧栏展开时掉成单列。**
  **现象**：卡片只在收起左侧栏时才在右边；展开侧栏就变成图在上、卡片在下。
  **根因**：`base.css` 的双栏降级断点是 `max-width: 1079.98px`，而宿主左侧栏展开时
  脉络 tab 的容器宽度只有 ~820px —— 最常见的窗口形态恰好落在"降单列"那一侧。
  容器查询本身是生效的（`tokens.css` 用 `container: threadline / inline-size` 命名容器），
  错的是断点数值。
  **修法**：断点改为 `BREAKPOINTS.split = 760`（容器 <760 才单列，此时 7:5 分配下
  左图约 440 + 右栏约 316，两栏仍可用）。实测 820 / 960 / 1024 / 1200 / 1440 均保持双栏。

- **文件节点 hover 反馈恢复到"看得见"。**
  **现象**：鼠标移到文件节点上几乎看不出变化。
  **根因**：D-35 按用户要求删掉了"hover 时其他节点压暗"（避免整图忽明忽暗），
  于是"哪里被指着"只剩被悬浮节点自己的描边 1.1→1.8px 与外圈光晕 0→0.12。
  这个强度在真机上弱到不可见 —— 反馈没消失，但**弱到不可见就是坏掉了**。
  **修法**：只强化被悬浮的那一个节点（不压暗邻居，不改色相语义），数值集中到
  `FOLDER_HOVER`（填充 0.82→0.98、光晕 0→0.24、描边 →2px；集线器卡片描边同样 →2px），
  渲染层与 CSS 引用同一份常量，不再各写裸数字。未知大小的节点仍保持空心虚线（语义不变）。
  实测 hover 与邻居的填充差 0.16，邻居数值完全不变。

- **思维链 tab 不再恒显示「这个范围内没有可读取的思维链记录」。**
  **现象**：思维链页永远空态，而同一条会话的 `/detail` 响应里 reasoning 有几十条。
  **根因**（两层）：
  1. `createDetailStore.request()` **命中缓存时走 `Promise.resolve(cached)`，不发请求也不 notify**。
     真机上共享 store 早被页面级预热 / 脉络预取 / 每轮影响入口填满 → 思维链要的那 12 个会话
     全是缓存命中 → 只订阅的话一次回调都收不到 → `extraDetails` 恒空 → 只剩「当前会话」
     一条孤线兜底；
  2. 当前会话详情读失败时，`pending` 只看 `loading`，于是把**故障**渲染成**结论**
     （「没有可读取的记录」）。
  **修法**：样本来源改为**缓存 ∪ 通知**（新增 `seedReasoningDetails`，先读一次已有缓存，
  与订阅回调共用同一个合并实现，纯读取、不触发请求）；空态拆三态 —— 还在读显示「正在读取」、
  有失败显示新增的 `reasoning.partial`（并把"确实没读到记录"单独说一行）、其余才是「没有」；
  有数据但有会话读失败时在页面顶部常驻一条 `data-partial` 提示（不静默）。

### 变更

- 新增文案 key `reasoning.partial`（zh/en + `MESSAGE_KEYS` + 规范 03 §16 表格同步登记）。
- `BREAKPOINTS` 新增 `split: 760`（双栏分界），并在 `styles.test.ts` 里断言
  "双栏断点 = `BREAKPOINTS.split`"且"旧的 1080 断点必须不存在"（防回归）。

### 测试

- 新增 `tests/entries/reasoning-seed.test.ts`（5 条）：用**真实 store** 复现"缓存命中不 notify"
  这一机制，并锁住"缓存播种后预热与冷启动拿到同样多的 detail"。
- 新增 `tests/ui-map/hover-lift.test.ts`（6 条）：悬停强化数值必须可感知、不得重新引入 dim、
  CSS 描边宽度必须等于 `FOLDER_HOVER.strokeWidth`。
- `tests/ui-shell/styles.test.ts` 新增 1 条双栏断点回归断言。
- 全量：919 pass / 0 fail（1.5.0 为 907）。

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
