# 关系图与技术地图视觉规范（graph-visuals）

> 用途：**执行者写 SVG 与 CSS 时的唯一依据**。几何有数值、颜色有令牌名、样式可照抄。
> 事实源：`output/review/文案与设计规范清单-v1.md` §17（关系图落点）+ 队长对本文件的三条口径（V3 尊重 reduced-motion 且只在全屏/整页流动；V4 用角标不用外发光、读不到证据不显示；新增颜色令牌要克制）。
> 依赖：`references/design-tokens.md`（样式基线）。**与 `design-tokens.md` 冲突时以 `design-tokens.md` 为准**；本文件只在它未覆盖的 SVG 域补充，并在 §H 逐条说明。
> 契约：批 6 技术图的数据**字段名以 `references/dashboard-format.md` 的 v1.6 为准**（由架构师在批 6 契约里定义）。本文件 §F2 末的 `DATA.tech` 是**假定形状**，只用于把视觉定下来，字段名以契约为准。
> 代码现状（2026-10-12 复核）：`CORE` = `.dsh/skills/control-your-development/templates/dashboard.core.js`；`renderGraph()` 672-1019、`drawChildren()` 793-820、`contentBox()` 686-694、`fit()` 731-742、`edgeD()` 718-721、`nodeDims()` 119-122（常量 `NODE_PAD=46 / NODE_MIN_W=150 / NODE_MAX_W=280`，高 42/58）、`layoutGraph()` 260-304（层内 x 间距 64、层间 y 间距 30）、`textWidth()` 94（CJK 14px/字，其他 8px/字）、`expanded` 432、`gview`/`graphFs`/`IMMERSIVE`。
> SVG 常量一律命名大写并集中定义在 `renderGraph` 顶部，便于与 Python 渲染器对齐检查。

```js
/* 本规范新增的几何常量（集中放在 renderGraph 顶部） */
const CHILD_DROP      = 22;   // 父节点底边 → 母线；母线 → 子项顶边（同一常量，故意对称）
const CHILD_CORNER_R  = 6;    // 「母线 → 横梁」L 型拐角的圆角半径
const CHILD_GAP_X     = 16;   // 同行子项间距
const CHILD_GAP_Y     = 20;   // 相邻两行母线之间的空隙
const CHILD_MIN_W     = 120, CHILD_MAX_W = 180, CHILD_PAD = 36;
const CHILD_H         = 34, CHILD_H2 = 50;          // 单行 / 双行
const CHILD_PER_ROW_WIDE = 4, CHILD_PER_ROW_NARROW = 2;
const GHOST_STUB      = 56;   // 幽灵边断头桩长度
const FLOW_MAX        = 30;   // 流动边数量上限
const LAYER_PAD_Y     = 12, LAYER_GAP_Y = 16;       // 层带内留白 / 层带间空隙（合计层间距 40）
const LAYER_LABEL_W   = 56, TECH_GAP_X = 32;
const EDGE_LABEL_MAX_W = 96, EDGE_LABEL_MAX_W_NARROW = 60, EDGE_LABEL_OFF = 8;
```

## 目录

- [A. 子项展开（方案 B，正交母线路由）](#a-子项展开批-3-方案-b正交母线--横梁--支线)
  - [A1 坐标系与图层](#a1-坐标系与图层)
  - [A2 几何规则](#a2-几何规则可照抄)
  - [A3 子项横排、换行与自适应](#a3-子项横排换行与自适应)
  - [A4 层次与视觉区分](#a4-层次与视觉区分必须与依赖边可区分)
  - [A5 拖动跟随规则](#a5-拖动跟随规则)
  - [A6 contentBox() 与 fit()](#a6-contentbox-与-fit)
- [B. V1 幽灵边](#b-v1-幽灵边依赖指向不存在--已废弃的功能)
  - [B1 判定](#b1-判定)
  - [B2 样式](#b2-样式可照抄)
  - [B3 「缺 X」标记](#b3-缺-x标记)
- [C. V2 渐变边](#c-v2-渐变边源状态色--目标状态色)
  - [C1 `<defs>` 结构与 id](#c1-defs-结构与-id)
  - [C2 拖动时的重算](#c2-拖动时的重算)
- [D. V3 流动](#d-v3-流动仅进行中功能的上游依赖边)
  - [D1 触发条件](#d1-触发条件三条同时成立)
  - [D2 元素与样式](#d2-元素与样式可照抄)
  - [D3 reduced-motion 关闭方式](#d3-reduced-motion-关闭方式双保险两条都要落)
  - [D4 右栏静默的 CSS 兜底](#d4-右栏静默的-css-兜底硬要求)
- [E. V4 变更高亮](#e-v4-变更高亮)
  - [E1 形态裁决：角标](#e1-形态裁决角标不是外发光)
  - [E2 角标形态与位置](#e2-角标形态与位置)
  - [E3 判定（fail-closed）](#e3-判定fail-closed读不到就不显示不许猜)
  - [E4 证据回填](#e4-证据回填只影响-title不参与判定)
  - [E5 生命周期](#e5-生命周期)
- [F. 技术地图（批 6）](#f-技术地图批-6)
  - [F1 「功能 | 技术」视图切换控件](#f1-功能--技术视图切换控件)
  - [F2 分层轴可视化](#f2-分层轴可视化)
  - [F3 技术边与依赖边的区分，以及标签排版](#f3-技术边与依赖边的区分以及标签排版)
- [G. B2「改动影响面」DOM 结构（批 5）](#g-b2改动影响面dom-结构批-5)
  - [G1 折叠态：摘要行](#g1-折叠态摘要行)
  - [G2 展开态：三段清单](#g2-展开态三段清单)
  - [G3 共用浮层](#g3-点文件看它被哪些功能共用浮层不是跳转)
- [H. 新增令牌与冲突说明](#h-新增令牌与冲突说明)
  - [H-1 零新增颜色令牌](#h-1-零新增颜色令牌硬结论)
  - [H-2 与 design-tokens.md 的关系](#h-2-与-design-tokensmd-的关系)
  - [H-3 新增的类](#h-3-新增的类不是颜色令牌)
  - [H-4 SVG 圆角档](#h-4-svg-圆角档补充-design-tokens-2-未覆盖的部分)
  - [H-5 间距值：两套数值域](#h-5-间距值两套数值域补充-design-tokens-5-未覆盖的部分)
  - [H-6 已发现的命名冲突](#h-6-已发现的命名冲突需统一见-i-4)
- [I. 落点索引与不确定处](#i-落点索引与不确定处)
  - [I1 代码落点](#i1-代码落点)
  - [I2 与既有 CSS 逐条「以谁为准」](#i2-与既有-css-逐条以谁为准)
  - [I3 交付自查](#i3-交付自查)
  - [I4 待确认](#i4-待确认)

---

## A. 子项展开（批 3 方案 B：正交「母线 + 横梁 + 支线」）

**要解决的问题**（评审稿 §17.1）：`drawChildren()` 现在 `cx = f.x`、`cy = f.y + f.h/2 + 26 + (c.ch||42)/2 + i*(42+16)`，竖排 + 竖直 `L` 直线，连线**穿过子项矩形**。

### A1 坐标系与图层

- 保持现有坐标模型：世界坐标 = 节点数据坐标；`gWorld` 变换 = `translate(tx,ty)·scale(k)`；指针换算走 `getScreenCTM().inverse()`（`CORE:743-755`，不要改）。
- **新增 4 个图层**（全部是 `gWorld` 的子节点，顺序即 z-order）：

| 图层 | 类名 | 内容 |
|---|---|---|
| 1 | `g.lyr-edges` | 依赖边（V2 渐变边）、V3 流动边 |
| 2 | `g.lyr-child` | 子项母线 + 支线（本节） |
| 3 | `g.lyr-nodes` | 父节点矩形/文字、子项矩形/文字 |
| 4 | `g.lyr-marks` | `subbadge`、V1「缺 X」标记、V4 变更角标 |

依据：现状把子项连线与节点混在 `feats.forEach` 里交替 append（`CORE:793-877`），导致 A 功能已画的子项会被 B 功能的节点盖住。

### A2 几何规则（可照抄）

设父节点 `f`（中心 `f.x,f.y`，宽高 `f.w,f.h`），父节点**底边中点** `P = (f.x, f.y + f.h/2)`。

**A2.1 子项分行**：`rows = chunk(kids, perRow)`，`perRow = (IMMERSIVE || fs || containerWidth >= 720) ? CHILD_PER_ROW_WIDE(4) : CHILD_PER_ROW_NARROW(2)`。

**A2.2 每行宽度与子项中心 x**：

```
W_r    = Σ w_i + CHILD_GAP_X * (n_r - 1)          // 行总宽
x0     = f.x - W_r / 2                            // 行左边界（整行以父节点中心居中）
cx_i   = x0 + Σ_{j<i}(w_j + CHILD_GAP_X) + w_i/2  // 第 i 个子项中心 x
busY_r : 母线 y（见 A2.3）
rowLeft_r  = cx_0        // 母线左端点 = 最左子项中心
rowRight_r = cx_{n-1}    // 母线右端点 = 最右子项中心
childTop_i = busY_r + CHILD_DROP
```

**A2.3 母线 y（逐行累加）**：

```
busY_0 = P.y + CHILD_DROP                                  // = f.y + f.h/2 + 22
busY_{r} = busY_{r-1} + CHILD_DROP + max(h_i in row r-1) + CHILD_GAP_Y
         = (上一行子项底边 y) + CHILD_GAP_Y
```

**A2.4 母线与横梁的 `d`**（一条 `<path class="edge child bus">`；两个子路径共用一个元素，`opacity` 只作用一次，不会在竖直段叠加变深）：

```js
const X = f.x, r = CHILD_CORNER_R;
const d = 'M' + X + ',' + P.y + ' L' + X + ',' + (busY - r)
        + ' Q' + X + ',' + busY + ' ' + (X - r) + ',' + busY + ' L' + rowLeft + ',' + busY
        + ' M' + X + ',' + (busY - r)
        + ' Q' + X + ',' + busY + ' ' + (X + r) + ',' + busY + ' L' + rowRight + ',' + busY;
```

- **拐角圆角**只加在「竖直干线 → 水平横梁」这两个 **L 型拐角**（半径 `CHILD_CORNER_R = 6`）。
- **支线与母线的 T 型交汇处不加圆角**（T 型加圆角会留下断口）；交汇处不做圆点装饰。
- 因为整行以 `f.x` 居中，`rowLeft < X < rowRight` 恒成立（`n ≥ 2`），左右两个拐角的朝向固定，无需判断方向。

**A2.5 每个子项的支线**（一个子项一条 `<path class="edge child drop">`）：

```js
const d = 'M' + cx + ',' + busY + ' L' + cx + ',' + childTop;   // 纯竖直
```

**A2.6 单个子项的退化形态（硬规定）**：`rows.length === 1 && n === 1` 时**不画母线**，直接一条竖直直线：

```js
const d = 'M' + X + ',' + P.y + ' L' + X + ',' + childTop;      // class="edge child"
```

理由：单子项时 `rowLeft === rowRight === X`，母线长度 0，画出来只剩两个零长度的 `Q/L`，既无视觉收益又让 `d` 多 60 字符。

**A2.7 母线最小长度**：`n ≥ 2` 时无需下限；若 `rowRight - rowLeft < 2 * CHILD_CORNER_R`（子项极窄的边界情况），把 `CHILD_CORNER_R` 降为 `(rowRight - rowLeft) / 2`，避免圆角吃掉整条横梁。

### A3 子项横排、换行与自适应

| 项 | 值 | 依据 |
|---|---|---|
| 单行最多 | 宽场景 `4`，窄栏（`.narrow` / 非全屏右栏）`2` | 4×180 + 3×16 = 768px，窄栏放不下 |
| 超出处理 | **换行**（多行母线，逐行按 A2.3 下移）；**不做横向滚动**（SVG 本身可平移缩放，横向滚动没有意义） | 任务书 A |
| 子项宽度 | 复用 `nodeDims` 的算法，换成子项夹取：`w = clamp(CHILD_MIN_W, CHILD_MAX_W, textWidth(name) + CHILD_PAD)`；`h = wrapName(name).length > 1 ? CHILD_H2 : CHILD_H` | 任务书 A「复用 `nodeDims` 自适应」；取代写死的 140×36（`CORE:807`） |
| 同行间距 | `CHILD_GAP_X = 16` | 节奏 8/12 之间取 16 不合法 → 取 `12` 与 `18` 相邻档；**最终值 16 见 §H-5 说明** |
| 行间距 | `CHILD_GAP_Y = 20` | 同上 |
| 子项名字截断 | 宽度自适应后**不再截断**（现状 `CORE:812` 截 10 字）；两行用 `wrapName` | 任务书 A + 评审稿 1.13 |
| 子项上限 | 不限制数量，全部展示（换行承担） | — |

> `CHILD_GAP_X = 16`、`CHILD_GAP_Y = 20` 落在 `design-tokens` 的 6/8/12/18/24 节奏之外，属于 **SVG 几何量而非 HTML 间距**（与 `layoutGraph` 既有的 x 间距 64、y 间距 30 同性质）。见 §H-5。

### A4 层次与视觉区分（**必须与依赖边可区分**）

| 元素 | 类名 | stroke | 宽度 | 虚线 | opacity | fill |
|---|---|---|---|---|---|---|
| 依赖边（V2 后） | `.edge.dep` | `url(#cyd-grad-<i>)` 渐变 | `1.6` | 实线 | `.75` | `none` |
| 子项母线/支线 | `.edge.child` | `var(--ink2)` | `1.2` | `4 3` | `.7` | `none` |
| 子项矩形 | `.node.child rect` | `SCOLOR[status]` | `1` | — | — | `SSOFT[status]` |
| 父节点矩形 | `.node rect` | `SCOLOR[status]` | `1.5` | — | — | `SSOFT[status]` |

```css
.cyd-app .edge.child{fill:none;stroke:var(--ink2);stroke-width:1.2;stroke-dasharray:4 3;opacity:.7}
.cyd-app .node.child rect{stroke-width:1;fill-opacity:.9}
.cyd-app .node rect{stroke-width:1.5}
```

**三条硬区分指标**（任意一条单独成立即可区分，三条都有）：

1. **线型**：依赖边是三次贝塞尔曲线（`edgeD()` 的 `C`），子项连线是正交折线（`L` + 90° 拐角）。
2. **颜色**：依赖边两端分别是源/目标状态色（渐变），子项连线统一 `--ink2` 单色。
3. **粗细与虚线**：依赖边 `1.6` 实线 `opacity .75`；子项 `1.2` 虚线 `4 3` `opacity .7`。

**圆角**：父节点 `rx 12`（现状，保留）、子项 `rx 10`（取代现状 `rx 10` 写死宽度）、标签底衬 `rx 8`。见 §H-1。

**子项图标**：不新增子项专用形状（现状是矩形），但要**去掉**现状对名字的 10 字截断（`CORE:812`）。

### A5 拖动跟随规则

- 父节点被拖动（`CORE:892-903` 的 `dragNode` 分支）时，**同一帧内**必须完成三件事：①父节点 `transform` 更新；②`redraw(m.f)` 重算所有与它相连的依赖边；③`drawChildren(m.f, m.g)` 重算母线、横梁与全部支线。
- **子项不可单独拖动**（子项位置完全由父节点决定）；子项也不参与 `gview.pos` 的手动位置记忆。
- **性能硬规定**：`pointermove` 里**禁止** `remove()` + 重新 `createElementNS()` 重建子项 DOM（现状 `drawChildren` 每次都整体重建，`CORE:794-818`）。改为：
  - 子项集合变化（展开/收起、数据刷新）时才重建；
  - 拖动中只更新既有元素的 `transform`（子项）与 `d`（母线/支线），复用 `childGs` 里的引用；
  - `childGs` 元素增加 `meta = {cx, cy, w, h, busY, rowLeft, rowRight}` 字段，供 `contentBox()` 与拖动复用。
- 拖动期间 `gview.drag = true` 时自动刷新被押后（`CORE:1402`），保持不变。

### A6 `contentBox()` 与 `fit()`

**A6.1 `contentBox()` 必须纳入子项**（评审稿 §17.2）：

```js
childGs.forEach(c => {                       // 在现有 feats.forEach 之后追加
  const m = c.meta;
  minX = Math.min(minX, m.cx - m.w / 2); maxX = Math.max(maxX, m.cx + m.w / 2);
  minY = Math.min(minY, m.cy - m.h / 2); maxY = Math.max(maxY, m.cy + m.h / 2);
});
```

母线不需要单独纳入：母线 y 位于「父节点底边」与「子项顶边」之间，母线 x 位于 `[最左子项中心, 最右子项中心]`，两者都被子项矩形的 bbox 覆盖。**必须保留一条开发态断言**：

```js
if (expanded.size && !childGs.length) console.warn('[cyd] contentBox 未纳入子项：请检查 drawChildren 是否在 fit 之前执行');
```

**A6.2 `fit()` 去掉 `+160` 硬留**（评审稿 §17.3）的具体判定：

```js
const bw = b.w + 80, bh = b.h + 80;   // 上下左右各 40 留白，对称
```

- **可以去掉 `+160` 的充要条件**：`contentBox()` 已遍历 `childGs` 的全部 `meta`（上面的代码落地并生效）。
- **执行顺序**：`fit()` 里的 `layoutHeight()` 之后、`syncBox()` 之后调用 `contentBox()` 之前，**子项 DOM 必须已经建好**（即 `drawChildren` 先于 `fit`）。若某次重构破坏了顺序，必须**恢复 `bh = b.h + 160`** 作为兜底，并在 `console.warn` 里说明原因。
- 现状 `CORE:736` 的 `const bw = b.w + 80, bh = b.h + 160;` 是唯一改动点。

**A6.3 子项不参与分层（硬约束）**：`layoutGraph()`（`CORE:260-304`）**不改**。子项只在 `renderGraph` 的绘制与 bbox 里出现，不进入层次计算、不预留层内空间。理由（评审稿 §17.5）：一旦子项参与分层，就必须同步改 `render_dashboard.py:500-547`，否则 `smoke/dual_parser_diff.py` 的双解析器差分门禁会红。

---

## B. V1 幽灵边（依赖指向不存在 / 已废弃的功能）

### B1 判定

遍历 `f.deps` 时，现状 `const a = byName[dn]; if (!a) return;`（`CORE:722-723`）**静默丢弃**。改为三分类：

| 情况 | 判定 | 处理 |
|---|---|---|
| 正常 | `dn in byName` | 渐变边（§C） |
| 不存在 | `dn` 不在 `DATA.features` 的任何名字里 | 幽灵边 + 标记「缺 X」 |
| 已废弃 | `dn` 在功能里但 `status === '已废弃'`（`byName` 由 `ACT()` 构建，已废弃不在其中，因此需另建 `byAllName` 全量索引来判断） | 幽灵边 + 标记「X 已废弃」 |

### B2 样式（可照抄）

```css
.cyd-app .edge.ghost{fill:none;stroke:var(--gray);stroke-width:1.2;
  stroke-dasharray:2 4;opacity:.28}
.cyd-app .ghostend{fill:none;stroke:var(--gray);stroke-width:1.2;opacity:.4}
```

- **形态**：幽灵边**不连向不存在的目标**，而是**从源节点左边缘水平向左**的**断头桩**，末端一个空心小圆环表示"接不上"。**方向必须取左侧**——`layoutGraph` 把依赖放在左侧，左侧才是"进口"，与 §B3「进口断了」的语义一致；放右侧表达的是"出口断了"，与理由矛盾（2026-10-12 队长裁决以 §B3 为准）。
- **长度按实际空隙夹取**（不能戳进左邻卡片）：`stub = Math.max(16, Math.min(GHOST_STUB, gap - 8))`，其中 `gap` = 同一行（`o.y ≤ a.y ≤ o.y + o.h`）里 `o.x + o.w ≤ a.x - a.w/2` 的**最近左邻矩形**到本节点左边缘的水平距离；没有左邻时 `gap = GHOST_STUB`，即取满 56px。下限 16px。

```js
const x0 = a.x - a.w / 2;                       // 源节点左边缘
const stub = Math.max(16, Math.min(GHOST_STUB, gap - 8));
const d = 'M' + x0 + ',' + a.y + ' L' + (x0 - stub) + ',' + a.y;
// 末端圆环：<circle class="ghostend" cx="x0 - stub" cy="a.y" r="2.5"/>
```

- **与真实边的区分度**：颜色 `--gray` 同族但 **透明度 `.28`**（真实边 `.75`）、**虚线 `2 4`**（更稀的点线 vs 子项 `4 3` 的短划）、**更细 `1.2`**、**只有 16–56px 短桩**、**末端空心圆环**。五条差异叠加，不依赖颜色即可区分。

### B3 「缺 X」标记

- 位置：**在同一条水平线上，桩贴节点、标签再往外**——顺序固定为「**节点左边缘 → 断头桩（§B2，长 `stub`）→ 间距 8px → 标记**」，即标记的右边缘离桩尾（空心圆环）**8px**。理由：两者同在左侧，必须有明确先后才不打架；桩是这条依赖的"进口断口"（贴节点才读得出从哪断的），标记是对节点的注解，放最外侧。**禁止**让标记压在桩上。
- 垂直方向与节点中心对齐（`y = -h/2` 相对节点中心）；横向随 `stub` 变化，所以**标记必须用与桩相同的 `stub` 计算**，两者一起移动。
- 若外侧与别的节点/标记相交（实现里按「左 → 上 → 下 → 节点内左上角小徽标」四档候选依次退让，见 `renderGraphMarks`），仍按上面的顺序优先取左侧。
- 结构（追加到该节点自己的 `<g>` 里，随节点平移；但 **z-order 放 `g.lyr-marks`**，避免被别的节点盖住）：

```js
const label = (kind === 'gone' ? '缺 ' : '已废弃 ') + name;
const w = textWidth(label) + 12, h = 14;
const GAP_AFTER_STUB = 8;                       // 桩尾圆环 → 标记右边缘
// rect: x = -f.w/2 - stub - GAP_AFTER_STUB - w, y = -h/2, width = w, height = h, rx = 8
//        style.fill = 'var(--warn-soft)'; style.stroke = 'var(--warn)'; stroke-width = 1
// text: x = -f.w/2 - stub - GAP_AFTER_STUB - w/2, y = 4, text-anchor = 'middle'
//        style.fill = 'var(--warn)'; font-size = 11px
```

| 项 | 值 | 依据 |
|---|---|---|
| 底色 / 边框 / 文字 | `--warn-soft` / `--warn` / `--warn` | 复用现有令牌，零新增 |
| 字号 | `11px`（徽标档） | `design-tokens §3` |
| 圆角 | `rx 8`（小件档） | `design-tokens §2` |
| 多个缺失 | 只显示第一条；其余并入「等 n 个」后缀——**四种形态的逐字原文见 `copy-deck §3`「幽灵依赖标记」两条**（本节**不复制字符串**）。**截断只作用于名字**：名字过长时截到 `max(6, 12 − 前后缀长度)` 个字并加 `…`；**`等 n 个` 与 `已废弃` 属于不可截断部分**；完整列表进 `<title>` | 避免标记比节点还长；**但计数与「已废弃」是判断依据、比名字长度重要**——整句截到 12 字会把 `等 n 个` 砍掉，用户看到的就是"看不懂缺标注"（实测反馈的直接来源）。实现见 `_nameMax` |
| 标记顺序（**只能一处成句**） | 有名字的**四种形态**（单条／合并 × 不存在／已废弃）一律**名字在前**，后缀（`已废弃`、`等 n 个`）**附在最后**；**逐字原文与顺序一律以 `copy-deck §3` 为准，本节只写形态、不复制字符串** | 文案唯一来源 = `copy-deck §3`「幽灵依赖标记」两行。实现须**一个表达式拼完**（`label` 里自带 ` 等 `／` 个` 字面，`_tail` 只用于宽度计算），否则跨语言门禁的"字面段相邻"判据守不住（本轮实测：把条件夹在值与字面之间即判红） |
| 无障碍 | `<title>` = `依赖的功能「X」不存在` / `依赖的功能「X」已废弃` | — |

---

## C. V2 渐变边（源状态色 → 目标状态色）

### C1 `<defs>` 结构与 id

```js
const defs = document.createElementNS(NS, 'defs');
svg.appendChild(defs);                       // 必须在 gWorld 之前，否则 url(#id) 解析不到
// 每条依赖边一个 <linearGradient>：
const gid = 'cyd-grad-' + edgeIndex;         // edgeIndex = edges 数组下标，全局唯一
const grad = document.createElementNS(NS, 'linearGradient');
grad.setAttribute('id', gid);
grad.setAttribute('gradientUnits', 'userSpaceOnUse');
grad.setAttribute('x1', a.x + a.w / 2); grad.setAttribute('y1', a.y);
grad.setAttribute('x2', f.x - f.w / 2); grad.setAttribute('y2', f.y);
const stop0 = document.createElementNS(NS, 'stop');
stop0.setAttribute('offset', '0'); stop0.style.stopColor = SCOLOR[a.status];
const stop1 = document.createElementNS(NS, 'stop');
stop1.setAttribute('offset', '1'); stop1.style.stopColor = SCOLOR[f.status];
grad.appendChild(stop0); grad.appendChild(stop1); defs.appendChild(grad);
// 边：p.setAttribute('stroke', 'url(#' + gid + ')'); p.setAttribute('class', 'edge dep');
```

| 项 | 值/规则 | 依据 |
|---|---|---|
| 单位 | `gradientUnits="userSpaceOnUse"` | 边端点在世界坐标里，用世界坐标定义渐变才与 `gWorld` 变换一致 |
| 朝向 | `x1,y1` = 源节点右边缘中点；`x2,y2` = 目标节点左边缘中点（与 `edgeD()` 的端点逐字一致，`CORE:718-721`） | 与边本身同向 |
| 颜色 | `SCOLOR[src]` → `SCOLOR[dst]`（`CORE:412`），即 `var(--gray/--accent/--warn/--ok/--ink2)` | 复用现有五态令牌，零新增 |
| **id 粒度** | **每条边一个 gradient**，`id = cyd-grad-<edgeIndex>` | 见下 |
| 赋值方式 | **必须** `stop.style.stopColor = 'var(--ok)'`（CSS 属性）；**禁止** `stop.setAttribute('stop-color','var(--ok)')` —— 呈现属性不支持 `var()`，会整条边变黑 | 技术约束 |
| 深色模式 | **不新增任何取值**。`var(--ok)` 等令牌在 `[data-theme="dark"]` 下自动切换，因此主题切换时**不需要**重建 gradient | 队长口径「新增令牌要克制」 |
| 打印 | 渐变照常打印（`print-color-adjust:exact` 已在 `CSS:15` 设定） | — |

**为什么 id 按边而不是按状态对**：按 `(src,dst)` 状态组合缓存只有 25 个 id，但 `userSpaceOnUse` 的 `x1..y2` 是**每个 gradient 一组**；两条状态组合相同的边端点不同，共用同一 id 会让其中一条的渐变方向错。按边建 id 后每条边各自正确，数量 = 边数（通常 < 100），开销可忽略。

### C2 拖动时的重算

```js
function syncGrad(id, a, b){
  const g = defs.querySelector('#' + id); if (!g) return;
  g.setAttribute('x1', a.x + a.w / 2); g.setAttribute('y1', a.y);
  g.setAttribute('x2', b.x - b.w / 2); g.setAttribute('y2', b.y);
}
function redraw(f){
  edges.forEach(e => {
    if (e.from !== f && e.to !== f) return;
    e.path.setAttribute('d', edgeD(e.from, e.to));
    syncGrad(e.gid, e.from, e.to);          // 新增：渐变端点必须同步
    if (e.flow) e.flow.setAttribute('d', edgeD(e.from, e.to));   // V3 流动边同路径
  });
}
```

- **必须**同步：`redraw()` 只改 `d` 不改渐变 → 节点一拖，颜色分界停在旧位置（表现为"颜色分界线不跟着走"）。
- 缩放/平移**不需要**重算：`userSpaceOnUse` + `gWorld` 变换下，渐变随世界坐标一起缩放平移。
- 影响面：`redraw()` 现有 4 处调用点（父节点拖动）全部自动受益，无需新增调用点。

---

## D. V3 流动（仅「进行中」功能的上游依赖边）

### D1 触发条件（三条同时成立）

1. **目标节点** `f.status === '进行中'`（即这条边是「进行中」功能的上游依赖边）。
2. **处于全屏或整页模式**：`IMMERSIVE === true`（会话页整页「功能地图」）或 `box.classList.contains('fs')`（真全屏 / 铺满视口兜底）。**右栏（普通面板）与窄栏一律不渲染流动元素** —— 是"不渲染"，不是 `animation:none`（省 CPU）。
3. **不处于减少动态偏好**：`!window.matchMedia('(prefers-reduced-motion: reduce)').matches`。**硬要求。**

### D2 元素与样式（可照抄）

```js
// 紧跟在该边的渐变边之后插入（同一图层 g.lyr-edges）
const flow = document.createElementNS(NS, 'path');
flow.setAttribute('class', 'edge flow');
flow.setAttribute('d', edgeD(a, f));
flow.style.animationDelay = '-' + ((idx % 4) * 0.28) + 's';   // 错峰
```

```css
.cyd-app .edge.flow{fill:none;stroke:var(--accent);stroke-width:2;
  stroke-dasharray:2 18;stroke-linecap:round;opacity:.9;
  animation:cydFlow 1.1s linear infinite}
@keyframes cydFlow{from{stroke-dashoffset:0}to{stroke-dashoffset:-20}}
```

| 项 | 值 | 依据 |
|---|---|---|
| 光点形态 | `stroke-dasharray: 2 18`（段长 2、空隙 18）+ `stroke-linecap:round`（圆头光点） | 段长/空隙由任务书「光点的虚线段长/宽度」 |
| 线宽 | `stroke-width: 2`（比渐变边 1.6 粗，叠在上面可见） | — |
| 速度 | 一个周期 20 单位 / `1.1s` ≈ 18 单位/秒，`linear`，`infinite` | `20 = 2 + 18`，`stroke-dashoffset` 从 `0` 走到 `-20` 正好一个周期，无缝 |
| 错峰 | 同一功能的多条上游边按 `idx` 写 `style.animationDelay = -(idx % 4) * 0.28s` | 避免所有边同步闪动 |
| 颜色 | `var(--accent)`（唯一"流动"语义色）——即使两端状态色不同，流动点也统一 accent | 零新增令牌 |
| 长边多光点 | 由 `dasharray` 自动平铺，无需额外处理 | — |
| 数量上限 | `FLOW_MAX = 30`；超出时按 `edges` 顺序取前 30 条，并在 `.ghead` 提示尾部追加 `· 流动仅显示前 30 条` | 防性能塌陷 |

### D3 reduced-motion 关闭方式（**双保险，两条都要落**）

```js
/* 保险 1：JS 不渲染 */
const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
if (!reduceMotion() && (IMMERSIVE || fsOn())) { /* 才创建 .edge.flow */ }
/* 偏好变化时重画（监听一次，重渲染时 removeEventListener 旧引用） */
mq.addEventListener?.('change', () => renderGraph());
```

```css
/* 保险 2：CSS 兜底（即使 JS 判断被绕过也不动） */
@media (prefers-reduced-motion: reduce){
  .cyd-app .edge.flow{display:none !important}
}
```

### D4 右栏静默的 CSS 兜底（硬要求）

```css
/* 非整页、非全屏 → 不流动（防 JS 条件写错） */
.cyd-app:not(.cyd-immersive) .graphbox:not(.fs) .edge.flow{display:none !important}
/* 窄栏 → 不流动 */
.cyd-app.narrow .edge.flow{display:none !important}
/* 打印 → 不流动（避免纸面上出现半截虚线） */
@media print{ .cyd-app .edge.flow{display:none !important} }
```

---

## E. V4 变更高亮

### E1 形态裁决：**角标**（不是外发光）

| 理由 | 说明 |
|---|---|
| 不依赖动画/滤镜 | `prefers-reduced-motion` 下无差别；打印稳定 |
| 深浅色都稳 | 只需 `--accent` 一个令牌；外发光要在 5 种状态色 × 2 主题上调 10 个值，还得避开现有 `.node:hover rect{filter:brightness(1.05)}`（CSS 现状）的叠加效果 |
| 不干扰状态色语义 | 不改节点自身 `fill/stroke`；状态色是节点的第一语义，外发光会把它染色 |

### E2 角标形态与位置

```js
// 追加到 g.lyr-marks
const c = document.createElementNS(NS, 'circle');
c.setAttribute('class', 'chgmark');
c.setAttribute('cx', f.w / 2 - 6); c.setAttribute('cy', -f.h / 2 + 6); c.setAttribute('r', 5);
c.style.fill = 'var(--accent)'; c.style.stroke = 'var(--panel)'; c.style.strokeWidth = '1.5';
c.setAttribute('transform', 'translate(' + f.x + ',' + f.y + ')');
```

```css
.cyd-app .chgmark{pointer-events:none}
```

| 项 | 值 | 依据 |
|---|---|---|
| 位置 | **右上角**，`cx = f.w/2 - 6`、`cy = -f.h/2 + 6` | 右下 (`f.w/2-6, f.h/2-6`) 已被 `subbadge` 占用（`CORE:849`）；左上/左下留给 V1 缺失标记的视觉空间 |
| 半径 | `r = 5`，外描边 `--panel` `1.5px`（把角标从节点底色上"切"出来） | — |
| 颜色 | `var(--accent)` | 复用现有令牌，零新增；`--warn` 留给"缺失/警告"，`--ok` 留给"已验证" |
| 动效 | **无**（不闪、不缩放、hover 不变大） | 队长口径「不依赖动画」 |
| 无障碍 | `<title>` = `状态从 旧 变为 新 · 最近更新 <时间>` | 见 E4 |

### E3 判定（**fail-closed，读不到就不显示，不许猜**）

三条**同时**成立才渲染角标：

1. **有上次观察快照**：`localStorage['cyd.seen.v1']`，JSON 形状 `{ ts, statuses: { <功能名>: <状态> }, tlLen }`。
   - 写入时机：每次渲染**成功之后**（`renderAll()` 末尾）覆盖写入，`try/catch` 包住；写失败（隐私模式/配额）→ 内存标记 `seenDisabled = true`，此后**永不显示角标**（宁可没有）。
   - 首次打开（无快照）→ **不显示任何角标**。
2. **状态确实变过**：`cur.status !== seen.statuses[name]` —— 这就是"自上次打开以来状态变化过"的定义。
3. **有证据可解释**（任务书「判定来源用时间线最近条目 + `.versions/` 快照 diff（可选）」）：
   - `DATA.timeline` 的**最近 3 条**里，至少一条的 `text` 包含该功能名；**或**
   - （可选来源）`DATA.versions` 提供的最新快照对比文本包含该功能名。离线网页没有 `env.versions`（`CORE:1158`），该分支自然不生效。
   - **两条都读不到 → 不显示角标。**

### E4 证据回填（只影响 `<title>`，不参与判定）

| 可用证据 | `<title>` 文本 |
|---|---|
| 快照旧值 + 时间线日期 | `状态从 可用 变为 已验证 · 最近更新 2026-10-12 09:30` |
| 只有快照旧值 | `状态从 可用 变为 已验证` |
| 只有时间线日期 | `状态已变化 · 最近更新 2026-10-12 09:30` |
| 都没有（不会发生，第 3 条已拦截） | 不渲染角标 |

### E5 生命周期

- 本次打开期间：变化过的功能名进内存集合 `chgSeen`；渲染时按 `chgSeen` 画角标。
- 用户**点开该功能的节点面板或功能详情**（`openNodePanel` / `openFeatDetail`）→ `chgSeen.delete(name)`，下次渲染角标消失（"看过了"）。
- 下一次页面加载：新快照已写入，不再显示（直到又有变化）。

---

## F. 技术地图（批 6）

### F1 「功能 | 技术」视图切换控件

**位置裁决：`.ghead` 右侧、缩放控件 `.gtools` 左侧**（`.viewswitch{margin-left:auto}` 把这一组顶到右侧）。
理由：缩放/全屏是"对当前视图的操作"，视图切换是"选哪个视图"；放右侧且整体在 `.gtools` 左边，视线顺序 = 标题 → 提示 → 视图 → 操作，语义从大到小。

**图标题随视图切换**：功能视图用本来的图标题（不变），技术视图换成**与空态标题同一个名称**的那个标题；**`.ghint` 图例与 `.gtools` 工具行保留**（只换标题，不重排头部）。
**这条口径的唯一成文处是 `references/dashboard-format.md`「界面结构」**（含依据：让用户一眼知道在看哪张图 + 与空态标题里的名称自洽）；本节只做**视觉侧落实**，不另立说法、**也不复制这两个标题的字面**——**字面以 `references/copy-deck.md` §3 的两行登记为定稿**。

```html
<div class="ghead">
  <b id="gTitle">功能关系图</b>   <!-- 值取自 copy-deck §3：功能视图用本来的图标题；技术视图换成与空态标题同名的那个（实现见 dashboard.core.js 的 gTitle） -->
  <span class="ghint">滚轮缩放 · 拖动平移 · 点节点对话</span>
  <span class="viewswitch" role="tablist" aria-label="关系图视图">
    <button data-view="feature" class="on" role="tab" aria-selected="true" title="按功能看依赖">功能</button>
    <button data-view="tech" role="tab" aria-selected="false" title="按技术分层看实现">技术</button>
  </span>
  <span class="gtools" id="gTools">…</span>
</div>
```

```css
.cyd-app .graphbox .ghead{display:flex;align-items:center;gap:10px;padding:12px 18px;border-bottom:1px solid var(--line)}
.cyd-app .ghead .ghint{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  font-size:12.5px;color:var(--ink2)}
.cyd-app .viewswitch{display:inline-flex;flex:none;gap:2px;padding:2px;border:1px solid var(--line);
  border-radius:999px;background:var(--panel);margin-left:auto}
.cyd-app .viewswitch button{border:0;background:none;border-radius:999px;padding:4px 12px;
  font:inherit;font-size:12.5px;color:var(--ink2);cursor:pointer;transition:.15s}
.cyd-app .viewswitch button:hover{color:var(--ink)}
.cyd-app .viewswitch button.on{background:var(--accent);color:var(--on-solid);font-weight:600}
.cyd-app .narrow .ghead{flex-wrap:wrap}
.cyd-app .narrow .viewswitch{margin-left:0;order:3;flex-basis:100%}
```

- 取代现状 `.ghead{justify-content:space-between}`（`CSS` 现状）；提示行现在必须有 `.ghint` 类才能拿到 `flex:1`（整页模式已依赖 `.ghead span:not(.gtools)` 规则，`CSS:36`，二者一致）。
- 切到「技术」时 `.ghead` / `.legend` / `.gtools` 全部保留（缩放、全屏、重置对技术图同样有效），只重建 `<svg id="graph">` 的内容。
- 视图状态存在内存 `graphView`（`'feature' | 'tech'`，默认 `'feature'`），本挂载周期保持，**不持久化**（避免与"上次打开"语义混淆）。

### F2 分层轴可视化

**层的顺序（v1.6 起以契约为准）**：**层名是自由文本、由用户自己写**——`界面` / `服务` / `存储` / `外部` / `基础设施` 这五个词是**示例，不是固定清单**，实现里**不得硬编码层名单**。**纵向位置 = 按层名首次出现的顺序**（自上而下，先出现的在上）；有序层名单由数据侧 `tech.layers` 给出。**与 `references/dashboard-format.md` 冲突时以契约为准。**
**答案：左侧竖排标签与背景色带**同时使用**，分工不同**：

| 手段 | 规格 | 为什么需要 |
|---|---|---|
| 层背景色带 `<rect class="layerband">` | `fill:var(--chip)`、`opacity:.55`、`rx:10`；x = 层内容左边界 − 24，width = 层内容宽 + 48，y = 层带顶 − `LAYER_PAD_Y`，height = 层内容高 + `2*LAYER_PAD_Y` | 表达"这几个节点在同一层"（整行归属）；弱对比不抢状态色 |
| 左侧竖排层标签 `<text class="layerlabel">` | `transform="translate(X,Y) rotate(-90)"`、`font-size:12.5px`、`fill:var(--ink2)`、`font-weight:600`、`letter-spacing:.5px`、`text-anchor:middle`；`X = 层带左边界 − 8`、`Y = 层带垂直中点` | 表达"这一层叫什么"；用 `rotate` 而**不用** `writing-mode`（离线单文件在部分浏览器上不稳） |
| 层间分隔线 `<line class="layerdiv">` | `stroke:var(--line)`、`stroke-width:1`；x 覆盖层带宽度，y = 相邻两层之间中点；**仅当相邻两层都有节点时画** | 视觉上断开 40px 的空隙，避免色带黏成一片 |

```css
.cyd-app .layerband{fill:var(--chip);opacity:.55}
.cyd-app .layerlabel{font-size:12.5px;fill:var(--ink2);font-weight:600;letter-spacing:.5px}
.cyd-app .layerdiv{stroke:var(--line);stroke-width:1}
```

**层间距（可照抄）**：

```
LAYER_PAD_Y = 12                              // 层带内上下留白
LAYER_GAP_Y = 16                              // 层带之间的空隙
层间距（上一层节点底边 → 下一层节点顶边）= 12 + 16 + 12 = 40   // 任务书「层间距」= 40
层带高 = (该层节点最大高) + 2 * LAYER_PAD_Y
层带顶 y_0 = 24
y_{n} = y_{n-1} + 层带高_{n-1} + LAYER_GAP_Y
```

**层内横排**：复用 `nodeDims`（宽 150–280，高 42/58），层内间距 `TECH_GAP_X = 32`，起点 `x = LAYER_LABEL_W + 24 = 80`；节点在层内水平居中于该层最大宽度。

**技术节点样式（无状态语义 → 中性）**：

```css
.cyd-app .node.tech rect{fill:var(--gray-soft);stroke:var(--ink2);stroke-width:1.2;rx:12}
.cyd-app .node.tech text{fill:var(--ink2);font-size:12.5px;font-weight:600}
```

理由：技术节点没有功能状态，用状态色会与功能图的 `SCOLOR/SSOFT` 语义冲突；`--gray-soft` + `--ink2` 是现有令牌里唯一的"中性对"，零新增。

**数据契约**（本文件只定视觉，**字段名与结构以 `references/dashboard-format.md` v1.6 为准**，见 §I-1）：

```js
DATA.tech = {
  layers: [ /* 有序层名单，来自契约 */ ],  // 顺序 = 用户书写 / 层名首次出现的顺序；不写死
  nodes: [{ name, layer, desc }],       // layer = 自由文本层名（界面/服务/存储/外部/基础设施只是示例）
  edges: [{ from, to, label }]          // label = 技术关系的文字（如「HTTP 调用」）
};
```

### F3 技术边与依赖边的区分，以及标签排版

| 项 | 技术边 | 依赖边（V2 后） |
|---|---|---|
| 线型 | **正交折线**（`M…L…`，直角，不加圆角） | 三次贝塞尔曲线（`C`） |
| 颜色 | 单色 `var(--ink2)` | 两端状态色渐变 |
| 宽度 / 透明度 | `1.2` / `.6` | `1.6` / `.75` |
| 虚线 | 实线 | 实线 |
| 标签 | **有文字标签** | 无 |

```css
.cyd-app .edge.tech{fill:none;stroke:var(--ink2);stroke-width:1.2;opacity:.6}
.cyd-app .edgelabel text{font-size:11px;fill:var(--ink2);text-anchor:middle;dominant-baseline:middle}
.cyd-app .edgelabelbg{fill:var(--panel);stroke:var(--line);stroke-width:1;opacity:.92}
```

**标签排版规则**：

| 项 | 值/规则 |
|---|---|
| 结构 | `<g class="edgelabel"><rect class="edgelabelbg"/><text/></g>`，追加到 `g.lyr-marks`（最上） |
| 位置 | 边中点，沿边法线方向外移 `EDGE_LABEL_OFF = 8px`；水平边向上偏、垂直边向右偏 |
| 底衬尺寸 | `width = textWidth(label) + 12`、`height = 11 + 6 = 17`、`rx = 8`（小件档），底衬中心对准文字 |
| 最大宽度 | `EDGE_LABEL_MAX_W = 96`（窄栏 `60`）。`textWidth(label) > 最大宽度 - 12` 时**截断**：逐字累加至 `≤ 最大宽度 - 12`，末位替换为 `…` |
| 完整文字 | 始终写进该边的 `<title>`（鼠标悬停可读），不受截断影响 |
| 避让 | 候选偏移序列 `+8 → +18 → +28 → -8`（同侧依次远离，再翻到另一侧）；逐个做 AABB 相交检查：①已有标签 rect ②任何节点 rect ③层带边界。取第一个不相交的；**四个都冲突 → 隐藏该标签**（`display:none`），只留 `<title>` |
| 跨层边 | 垂直跨层边的标签放在两层之间的空隙中点（`LAYER_GAP_Y` 的中点），避免压层带边界 |

---

## G. B2「改动影响面」DOM 结构（批 5）

排版基调见 `design-tokens.md §9`（间距 18/12/8/6、`.badge`、`--ok/--warn`、≤40 字、一句一 `<p>`）。本节把它细化到**可直接实现的 DOM 骨架**。

### G1 折叠态：摘要行

```html
<section class="sblock impact" data-impact>
  <p class="summary" role="button" tabindex="0" aria-expanded="false" aria-controls="impact-body-1">
    改它要动 <b>3</b> 个文件 · 影响 <b>2</b> 个下游功能 · 还差 <b>1</b> 个上游
    <span class="caret" aria-hidden="true">▸</span>
  </p>
  <p class="snote">点开看每个文件与每个功能。</p>   <!-- 可选，仅当需要引导时 -->
  <div class="impact-body" id="impact-body-1" hidden> …（G2）… </div>
</section>
```

| 项 | 值 |
|---|---|
| 文案 | `改它要动 N 个文件 · 影响 N 个下游功能 · 还差 N 个上游`，**≤30 字**，单行 |
| 数字 | 用 `<b>`（不是 `.badge`）—— 摘要行是句子，徽章会打断阅读 |
| 折叠交互 | `Enter` / `Space` / 点击切换 `aria-expanded` 与 `hidden` |
| caret | `▸` 展开 `▾`；展开时 `transform:rotate(90deg)`，**`prefers-reduced-motion: reduce` 下不旋转、只换字符** |
| 空情况 | 三个数都为 0 → 摘要行只显示 `改它不用动别的功能或文件。`，不渲染 `.impact-body` |

### G2 展开态：三段清单

```html
<div class="impact-body" id="impact-body-1">
  <!-- 段 1 -->
  <div class="sec" data-sec="files">
    <h5>要动的文件 <span class="badge count">3 个</span></h5>
    <p><span class="file-ok">src/store.js</span> <span class="badge count">被 3 个功能共用</span></p>
    <p><span class="file-missing">src/old-api.js</span> <span class="badge b-x3">找不到</span></p>
    <p><button class="btn mini" data-shared="src/store.js">看谁在共用</button></p>
  </div>
  <!-- 段 2 -->
  <div class="sec" data-sec="down">
    <h5>影响的下游功能 <span class="badge count">2 个</span></h5>
    <p><span class="badge b-x2">进行中</span> 记账</p>
    <p><span class="badge b-x4">已验证</span> 登录</p>
  </div>
  <!-- 段 3 -->
  <div class="sec" data-sec="up">
    <h5>上游依赖 <span class="badge count">1 个</span></h5>
    <p><span class="badge b-x1">设想</span> 导出</p>
  </div>
  <p class="snote" data-cycle hidden>这些功能互相依赖（记账 → 导出 → 记账），改一个会牵动整环。</p>
</div>
```

| 块 | 类名 | 间距 | 依据 |
|---|---|---|---|
| 三段 | `.sec` | 段间 `margin-top:12px`；标题与内容 `8px`；段内 `<p>` 之间 `6px` | `design-tokens §9` |
| 段标题 | `.sec h5` | `font-size:12.5px`、`--ink2`、`600`、`margin:0 0 8px` | 同上 |
| 文件行 | `.sec p` | `font-size:14px`、`margin:0`、`+p` 的 `margin-top:6px`；**每句独占一个 `<p>`** | 同上 |
| 文件状态 | `.file-ok`（`--ok`）/ `.file-missing`（`--warn`） | 行内 `<span>`，不换行 | 同上 |
| 缺失徽章 | `.badge.b-x3`（`--warn-soft`/`--warn`）文案 `找不到` | — | `design-tokens §9` |
| 共用计数 | `.badge.count`（**新增类，非新令牌**）：`background:var(--chip);color:var(--ink2)` | `margin-right:6px` | 见 §H-3 |
| 功能状态 | `.badge.b-x{1..5}`，配 `SMAP`（`CORE:411`） | — | `design-tokens §9` |
| 依赖环 | `.snote[data-cycle]`，文案 ≤40 字，路径最多列 5 个节点、超出加 `…` | `margin:6px 0 0` | 复用 `layoutGraph` 已产出的环警告（`CORE:284`），不新增检测 |
| 单条文案 | **≤40 字** | — | `design-tokens §9` |

```css
.cyd-app .impact .badge.count{background:var(--chip);color:var(--ink2)}
.cyd-app .impact .sec h5{margin:0 0 8px;font-size:12.5px;font-weight:600;color:var(--ink2)}
.cyd-app .impact .sec h5 .badge.count{margin-left:6px;vertical-align:1px}
.cyd-app .impact .caret{display:inline-block;margin-left:6px;transition:transform .15s}
.cyd-app .impact .summary[aria-expanded="true"] .caret{transform:rotate(90deg)}
@media (prefers-reduced-motion: reduce){ .cyd-app .impact .caret{transition:none} }
```

### G3 「点文件看它被哪些功能共用」：**浮层**（不是跳转）

形态裁决：**浮层**，复用 `.nodepop` 的观感（`width:235px`、`border:1px solid var(--accent)`、`radius:16px`、`--shadow-pop`），锚在触发按钮右侧 8px、垂直居中对齐。

```html
<div class="sharedpop" hidden>
  <h4>谁在用 src/store.js</h4>
  <div class="sblock">
    <table class="stable">
      <thead><tr><th>功能</th><th class="num">状态</th></tr></thead>
      <tbody>
        <tr><td>记账</td><td class="num"><span class="badge b-x2">进行中</span></td></tr>
        <tr><td>报表</td><td class="num"><span class="badge b-x4">已验证</span></td></tr>
      </tbody>
    </table>
  </div>
  <div class="sheetfoot">
    <button class="linkbtn" data-goto-feature="记账">在功能地图里看</button>
  </div>
</div>
```

| 项 | 值 | 依据 |
|---|---|---|
| 形态 | 浮层（保留上下文）；**不用跳转**（跳走会让用户丢掉"改动影响面"的阅读位置） | — |
| 表格 | 复用 `.stable`（`design-tokens §7`），状态列右对齐 | — |
| 关闭 | 点外部 / `Esc` / 再次点触发按钮 | — |
| 跳转 | `在功能地图里看` → 关浮层 + 切到功能地图 tab + `fit()` + 对相关节点加 `.flash`（复用 `CORE:491` 机制） | 让"跳转"成为可选的第二步，而不是唯一路径 |
| 复用 | 视觉与 `sharedpop` 之外的浮层（`.nodepop`）保持一致，不新增第二套浮层样式 | — |

---

## H. 新增令牌与冲突说明

### H-1 零新增颜色令牌（**硬结论**）

本文件所有颜色只引用现有令牌：`--accent / --ok / --warn / --gray / --ink2 / --panel / --line / --chip / --warn-soft / --gray-soft / --accent-soft / --ok-soft`，以及 `SCOLOR`(`CORE:412`)/`SSOFT`(`CORE:413`)。**一个都不新增。**

技术图分层色带曾考虑用彩色分层（每层一个色），最终**不用**，理由：

1. 5 层 × 2 主题 = 10 个新值，与队长「新增令牌要克制」直接冲突；
2. 分层色是**分类色**，而本产品已有的 `SCOLOR/SSOFT` 是**状态色**；两套色系同屏会让"这个颜色的节点是什么意思"变得不可读；
3. 层区分可以只用文字标签 + 弱底色带完成，信息没有损失。

**唯一允许的派生方式**（若将来确实需要分层色，需队长批准）：`color-mix(in srgb, var(--accent) N%, var(--chip))`，N 依次取 `8 / 6 / 4 / 2 / 0`。为什么现有令牌不够：需要一个"同色系但不同浓度"的 5 档阶梯，而现有 5 个 `*-soft` 令牌各属不同语义（ok/warn/accent/gray），直接复用会让层的颜色与功能状态混淆。

### H-2 与 `design-tokens.md` 的关系

| 项 | 冲突？ | 处理 |
|---|---|---|
| `.ghead` 去掉 `justify-content:space-between`，改 `gap:10px` + `.viewswitch{margin-left:auto}` | 否 | 与 `design-tokens §6.2` 的 `.topacts{margin-left:auto}` 同款手法 |
| `.edge.dep` 的 stroke/width/opacity（渐变、`1.6`、`.75`） | 否 | `design-tokens` 未覆盖 `.edge`；本文件为准 |
| `.node rect` `stroke-width:1.5`（父）/`1`（子）、父子项 `fill/stroke` 用 `SCOLOR/SSOFT` | 否 | `design-tokens` 未覆盖 SVG 节点 |
| `.badge.count`（chip 底 + ink2 字） | 否 | 复用 `design-tokens §9` 的「数量与状态一律用 `.badge`」，只是新增一个中性变体 |
| 圆角 `12/10/8`（SVG 节点与标签底衬） | **是（补充）** | 见 H-4 |
| `CHILD_GAP_X=16`、`CHILD_GAP_Y=20`、`LAYER_PAD_Y=12`、`LAYER_GAP_Y=16`、`TECH_GAP_X=32` | **是（补充）** | 见 H-5 |

### H-3 新增的类（不是颜色令牌）

`.edge.dep` `.edge.child` `.edge.ghost` `.edge.flow` `.edge.tech` `.ghostend` `.missingmark` `.chgmark` `.viewswitch` `.ghint` `.layerband` `.layerlabel` `.layerdiv` `.edgelabel` `.edgelabelbg` `.badge.count` `.sharedpop` `.impact .caret` `@keyframes cydFlow`。

### H-4 SVG 圆角档（补充 `design-tokens §2` 未覆盖的部分）

| 用途 | 值 | 说明 |
|---|---|---|
| 父节点 / 技术节点矩形 | `rx 12` | 现状（`CORE:826`），评审稿 1.13 只要求子项走自适应宽度，未要求改圆角 |
| 子项矩形 | `rx 10` | 现状（`CORE:807`），与"控件档 10"一致 |
| 标签底衬 / 缺失标记 / 标签底衬 rect | `rx 8` | 小件档 8 |
| 角标 | 圆（`r=5`），不涉及圆角档 | — |
| 层带 | `rx 10` | 控件档 |

**结论**：`design-tokens §2` 的 999/16/10/8 是 **HTML 组件**圆角；SVG 节点额外需要 `12` 一档（父节点现状）。以 `design-tokens` 为准的范围不变，本文件只在 SVG 域补充 `rx 12` 并把理由写在此处。

### H-5 间距值：两套数值域（补充 `design-tokens §5` 未覆盖的部分）

**结论：HTML 间距节奏与 SVG 布局量是两套数值域，不得互相套用。**

| 数值域 | 单位性质 | 取值 | 受约束于 |
|---|---|---|---|
| HTML 组件间距 | 设备像素（CSS px）下的视觉节奏 | `6 / 8 / 12 / 18 / 24` | `design-tokens §5`（唯一合法取值） |
| SVG 关系图几何量 | **世界坐标**（随 `gWorld` 的 `scale(k)` 缩放） | `layoutGraph` 既有：层内 x `64`、层间 y `30`；本文件：`CHILD_DROP 22`、`CHILD_CORNER_R 6`、`CHILD_GAP_X 16`、`CHILD_GAP_Y 20`、`TECH_GAP_X 32`、`LAYER_GAP_Y 16` | 本文件（图形比例正确优先） |

- `CHILD_GAP_X=16`、`CHILD_GAP_Y=20`、`TECH_GAP_X=32` 落在 6/8/12/18/24 之外，性质同 `layoutGraph` 既有的 64/30——**是 SVG 布局几何量（世界坐标），不是 HTML 间距节奏**。
- `LAYER_PAD_Y=12` 与 `LAYER_GAP_Y=16` 之和等于层间距 `40`（任务书指定值）；其中 12 在节奏内、16 不在，但层间距 40 是硬要求，拆分值随之确定。这是本文件里**唯一**允许出现"节奏内外的分界"的地方，且理由是外部硬约束。
- **禁止**拿 6/8/12/18/24 去套 SVG（例如把 `CHILD_GAP_X` 强行改成 18、把 `CHILD_CORNER_R` 改成 8）：两者不互相换算、不强行对齐。理由：SVG 数值是世界坐标下的图形布局量（缩放时同比例变化，图形比例才不失真），HTML 数值是设备像素下的视觉节奏；混成一套会同时破坏"图形比例正确"与"界面节奏统一"。
- 已在 `design-tokens.md §5` 顶部写入同一条适用范围声明，两边口径一致。

### H-6 已发现的命名冲突（需统一，见 §I-4）

`design-tokens §11.1` 写 `.decision.done`，而 `dashboard.core.css` 现状已实现为 `.decision.decided`。**以已落盘代码 `.decision.decided` 为准**，`design-tokens §11.1` 需修正（本文件不重复定义 `.decision`）。

---

## I. 落点索引与不确定处

### I1 代码落点

| 落点 | 改动 |
|---|---|
| `CORE:672-1019` `renderGraph()` | 新增 4 图层、`<defs>` + 每边 gradient、幽灵边分支、V3 流动、V4 角标、技术图分支 |
| `CORE:793-820` `drawChildren()` | **重写**为 A2 的母线/横梁/支线几何 + 子项自适应宽度 + 复用 DOM |
| `CORE:686-694` `contentBox()` | 追加 `childGs` 的 `meta` bbox（A6.1） |
| `CORE:731-742` `fit()` | `bh = b.h + 160` → `b.h + 80`（A6.2） |
| `CORE:718-721` `edgeD()` | 不改（渐变复用同一端点公式） |
| `CORE:728` `redraw()` | 追加 `syncGrad()` 与流动边 `d` 同步（C2） |
| `CORE:222-227` 依赖边创建处 | 追加幽灵边分支（V1）与 `edges.push` 里的 `gid` |
| `CORE:260-304` `layoutGraph()` | **不改**（A6.3）；`render_dashboard.py:500-547` 因此**不改** |
| `CSS` `.edge` / `.node` / `.ghead` / `.legend` | 按 §A4/§B2/§D2/§D4/§F1/§F2/§F3 覆盖 |
| `smoke/cdp_verify.mjs:249-262` | 断言 `g.node.child` 数量与 `.subbadge`；子项改为自适应宽度后**数量不变**，但类名与选择器要保持（评审稿 §17.7） |

### I2 与既有 CSS 逐条「以谁为准」

| 既有声明 | 本文件定稿 | 以谁为准 |
|---|---|---|
| `.edge{stroke:var(--gray);opacity:.45;stroke-width:1.4}` | 渐变 / `.75` / `1.6` | 本文件（`design-tokens` 未覆盖） |
| `.edge.child{stroke-dasharray:4 3;opacity:.7}` | 同上 + `stroke:var(--ink2)`、`1.2` | 本文件 |
| `.node.child rect` 写死 140×36、名字截 10 字（`CORE:807,812`） | 自适应 `120–180` × `34/50`，不截断 | 本文件 + 评审稿 1.13 |
| `.graphbox .ghead{justify-content:space-between}` | `gap:10px` + `.viewswitch{margin-left:auto}` | 本文件 |
| `.subbadge` 圆 `r=11`、右下角 | 不变（V4 角标改占右上） | 现状保留 |
| `fit()` 的 `+160` | `+80` | 本文件（评审稿 §17.3） |
| `.narrow` 下隐藏 header/掌控条（评审稿 1.7 旧建议） | **不隐藏**（`design-tokens §6.3` N1） | `design-tokens` |

### I3 交付自查

- [x] A 几何有数值（22 / 6 / 16 / 20 / 120–180 / 34-50 / 4 或 2 列）、退化形态明确、含 contentBox 与 fit 判定
- [x] V1 幽灵边（色/虚线/透明度/短桩/末端圆环 + 「缺 X」标记）
- [x] V2 渐变边（`userSpaceOnUse`、id 命名、`stopColor` 赋值方式、深色不新增值、拖动重算）
- [x] V3 流动（触发三条件、段长/宽度/速度/错峰、reduced-motion 双保险、右栏静默 CSS 兜底）
- [x] V4 变更高亮（角标 + 三条理由 + fail-closed 判定 + 生命周期）
- [x] F 技术地图（切换控件位置与样式、分层轴双手段与层间距 40、层内排布、技术边与标签避让/截断）
- [x] G B2 DOM 骨架（摘要行、三段、文件状态、共用徽章、共用浮层、依赖环、间距）
- [x] 全部颜色引用现有令牌，零新增；新增只有类名与几何常量

### I4 [待确认]

1. **技术图数据契约**：`DATA.tech` 的字段名、结构与 `layer` 的取值来源**以 `references/dashboard-format.md` v1.6 为准**；本文件 §F2 末的假定形状只用于把视觉定下来。层名是自由文本、纵向位置按首次出现顺序，**不得硬编码层名单**。
2. **V4 的记忆载体**：`localStorage['cyd.seen.v1']` 是"自上次打开以来"的必要记忆。若不允许用 localStorage，则角标一律不显示（fail-closed）——请确认是否接受 localStorage（含隐私模式下降级为不显示）。
3. **分层色带**：当前定稿为**不用彩色**（只用 `--chip` 弱底 + 文字标签）。若你要彩色，请批准 §H-1 的 `color-mix` 派生公式。
4. **命名冲突**：`design-tokens §11.1` 的 `.decision.done` 与代码里的 `.decision.decided` 不一致，建议统一为 `.decision.decided`（以已落盘代码为准），并同步修 `design-tokens`。
5. **子项宽度上限**：`CHILD_MAX_W = 180` 是我按"子项不该比父节点（150–280）更抢眼"定的；若你希望子项与父节点同宽（150–280），需要认可 4 列会溢出到 1120px+。
