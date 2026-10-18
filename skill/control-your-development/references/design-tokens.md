# 设计令牌与组件规格（design-tokens）

> 用途：**执行者改代码时的唯一样式依据**。这里给的是定稿值，不是建议。
> 事实源：`output/review/文案与设计规范清单-v1.md`（用户逐条批注，「你的裁定」列即决定）+ 批注后对话补充的 6 条决定。
> 基准证据：颜色以审定过的视觉基准 `projects/dsh-plugin-control-your-development/mockups/dashboard-mock-v2.html:9-22` 为准；现值取自 `.dsh/skills/control-your-development/templates/dashboard.core.css`。
> 适用面：`CSS` = `templates/dashboard.core.css`；`SHELL` = `templates/dashboard.shell.html`；`CORE` = `templates/dashboard.core.js`；`SRC` = `projects/dsh-plugin-control-your-development/plugin/src/client.src.js`；`HOST` = `projects/dsh-plugin-control-your-development/plugin/lib/index.js`。
> **冲突总规则**：本文件与 `CSS` 现有声明冲突时，**以本文件为准**；`CSS` 是被改对象，不是依据。与评审稿裁定冲突时，以本节 §10「以谁为准」一览的裁定为准。
> 注意：`CORE`/`CSS`/`SHELL` 是面板与离线网页共用的唯一渲染核，改一处两端同步；`lib/client.js` 是 `tools/build_panel.py` 的产物，**禁止手改**，改完模板必须重跑构建。

## 目录

- [1. 颜色令牌](#1-颜色令牌)
  - [1.1 定稿值（浅色）](#11-定稿值浅色)
  - [1.2 定稿值（深色）](#12-定稿值深色)
  - [1.3 现值偏离清单](#13-现值偏离清单必须回滚的四项--深色灰)
  - [1.4 打印覆盖](#14-打印覆盖css14-18)
  - [1.5 主题唯一来源](#15-主题唯一来源评审稿-110-裁定改)
  - [1.6 面板专有面（SRC）](#16-面板专有面src评审稿-111-裁定改)
- [2. 圆角（3 档 + 小件）](#2-圆角3-档--小件)
- [3. 字号阶梯（5 档）](#3-字号阶梯5-档)
  - [3.1 逐选择器映射](#31-逐选择器映射改代码时照这张表)
  - [3.2 窄栏降档规则](#32-窄栏降档规则配合-63)
- [4. 阴影（2 档）](#4-阴影2-档)
- [5. 间距节奏（6 / 8 / 12 / 18 / 24）](#5-间距节奏6--8--12--18--24)
- [6. 组件规格](#6-组件规格)
  - [6.1 `.btn` / `.btn.primary` / `.btn.mini`](#61-btn--btnprimary--btnmini)
  - [6.2 `.iconbtn` 与头部两段结构](#62-iconbtn-与头部两段结构)
  - [6.3 窄栏断点 `.cyd-app.narrow`](#63-窄栏断点-cyd-appnarrow)
- [7. 弹层排版三原语](#7-弹层排版三原语sblock--snote--stable)
- [8. `.composer` 发送框规格](#8-composer-发送框规格)
- [9. 改动影响面区块（B2）排版规格](#9-改动影响面区块b2批-5-用排版规格)
- [10. 冲突与「以谁为准」一览](#10-冲突与以谁为准一览)
- [11. 决策卡三态与「待生效」标记](#11-决策卡三态与待生效标记队长裁决补入)
  - [11.1 决策卡三态](#111-决策卡三态)
  - [11.2 离线「待生效」标记与徽章](#112-离线待生效标记与徽章)
  - [11.3 拍板浮层底部跳转行](#113-拍板浮层底部跳转行队长裁决)
  - [11.4 `.narrow` 触发方式](#114-narrow-触发方式已确认禁止视口断点)
- [12. 批 2 视觉补条（队长实测）](#12-批-2-视觉补条队长实测)
  - [12.1 掌控条 pill：塌陷修复与窄栏两列网格](#121-掌控条-pill塌陷修复与窄栏两列网格)
  - [12.2 pill 内部的字号与行高](#122-pill-内部的字号与行高)
  - [12.3 `.kv` 改两列网格](#123-kv-改两列网格)
  - [12.4 `.composer` 收窄职责](#124-composer-收窄职责)
  - [12.5 功能详情弹层必须区块化](#125-功能详情弹层必须区块化sblock)
  - [12.6 使用指南步骤紧凑化](#126-使用指南步骤紧凑化)
  - [12.7 进度条细化](#127-进度条细化)
  - [12.8 关系图：文字色与依赖边可见度下限](#128-关系图文字色与依赖边可见度下限)
  - [12.9 图标策略](#129-图标策略内联-svg-优先--白名单下限)
  - [12.10 头部 `.by` 与项目名重复时隐藏](#1210-头部-by-与项目名重复时隐藏)
  - [12.11 `.tag` 长文案两段式](#1211-tag-长文案两段式)
  - [12.12 证据路径胶囊窄栏：单行省略 + 复制键永不被裁](#1212-证据路径胶囊窄栏单行省略--复制键永不被裁本轮实测)

---

## 1. 颜色令牌

变量作用域：全部挂在 `.cyd-app` 上（`CSS:1-6`、`CSS:7-11`），不挂 `:root`。

### 1.1 定稿值（浅色）

| 令牌 | 定稿值 | 依据 |
|---|---|---|
| `--bg` | `#f4f6fa` | mock-v2:9（与现值一致，无偏离） |
| `--panel` | `#ffffff` | mock-v2:9 |
| `--ink` | `#1b2331` | mock-v2:9 |
| `--ink2` | `#5b6575` | mock-v2:9 |
| `--line` | `#e4e8f0` | mock-v2:9 |
| `--accent` | `#2f6fed` | mock-v2:10 · 评审稿 1.1 裁定：改 |
| `--accent-soft` | `#e8effe` | mock-v2:10 |
| `--ok` | `#179a50` | mock-v2:10 · 评审稿 1.1 |
| `--ok-soft` | `#e5f6ec` | mock-v2:10 |
| `--warn` | `#c07f00` | mock-v2:11 · 评审稿 1.1 |
| `--warn-soft` | `#fdf3e0` | mock-v2:11 |
| `--gray` | `#8a93a3` | mock-v2:11 · 评审稿 1.1 + 1.2 |
| `--gray-soft` | `#eef1f6` | mock-v2:11 |
| `--chip` | `#eef2f8` | mock-v2:12 |
| `--on-solid` | `#fff` | mock-v2 浅色未显式写，实心按钮上的文字用白；`CSS:3` 一致 |

### 1.2 定稿值（深色）

| 令牌 | 定稿值 | 依据 |
|---|---|---|
| `--bg` | `#13161c` | mock-v2:16 |
| `--panel` | `#1c212b` | mock-v2:16 |
| `--ink` | `#e7ebf3` | mock-v2:16 |
| `--ink2` | `#9aa4b5` | mock-v2:16 |
| `--line` | `#2b3240` | mock-v2:16 |
| `--accent` | `#6f9dff` | mock-v2:17 |
| `--accent-soft` | `#22304d` | mock-v2:17 |
| `--ok` | `#4ecb7f` | mock-v2:17 |
| `--ok-soft` | `#173325` | mock-v2:17 |
| `--warn` | `#e0a63c` | mock-v2:18 |
| `--warn-soft` | `#3a2d14` | mock-v2:18 |
| `--gray` | `#8a93a3` | mock-v2:18 · 评审稿 1.2（**深色与浅色同值，不要照搬 `CSS:10` 的 `#9099a8`**） |
| `--gray-soft` | `#262d3a` | mock-v2:18 |
| `--chip` | `#252c39` | mock-v2:19 |
| `--on-solid` | `#13161c` | `CSS:9`（mock-v2 深色块漏写此令牌，是 mock 的缺陷；深色实心底上用深色字才够对比，**以 `CSS:9` 的 `#13161c` 为准**） |

### 1.3 现值偏离清单（必须回滚的四项 + 深色灰）

| 令牌 | 定稿（mock-v2） | 现值 `CSS` | 结论 |
|---|---|---|---|
| `--accent` | `#2f6fed` | `#145ceb`（`CSS:3`，另见 `CSS:12`、`CSS:15`） | **改回 `#2f6fed`** |
| `--ok` | `#179a50` | `#127a40`（`CSS:3`、`CSS:12`、`CSS:15`） | **改回 `#179a50`** |
| `--warn` | `#c07f00` | `#916000`（`CSS:3`、`CSS:12`、`CSS:15`） | **改回 `#c07f00`** |
| `--gray`（浅） | `#8a93a3` | `#616a7b`（`CSS:4`、`CSS:12`、`CSS:15`） | **改回 `#8a93a3`** |
| `--gray`（深） | `#8a93a3` | `#9099a8`（`CSS:10`、`CSS:13`） | **改回 `#8a93a3`** |

除上表五项，其余颜色令牌与 mock-v2 **逐字一致**（浅色 10 项、深色 14 项），不要顺手改。

### 1.4 打印覆盖（`CSS:14-18`）

`@media print` 里的浅色复位块出现 `--accent:#145ceb`、`--ok:#127a40`、`--warn:#916000`、`--gray:#616a7b` 四处偏离值，**必须同步为 §1.1 的定稿值**（打印走浅色纸面，纸面同样要回滚）。`--chip:#f2f4f8 !important`（`CSS:15`）保留现值不变。

### 1.5 主题唯一来源（评审稿 1.10 裁定：改）

深色只由 `[data-theme="light"]` / `[data-theme="dark"]`（`CSS:12`、`CSS:13`）定义，`@media (prefers-color-scheme: dark)`（`CSS:7-11`）只作为**无 data-theme 时的回退**，`@media print` 只做纸面复位。三处值必须保持一致；新增令牌时三处同改。

### 1.6 面板专有面（`SRC`，评审稿 1.11 裁定：改）

- 面板空态外层加 `class="cyd-app"`，正文/边框一律用 `.cyd-app` 变量：文字 `var(--ink2)`、边框 `var(--line)`、背景 `var(--panel)`。
- **删除** `SRC:204` 的 `EMPTY_STYLE`（`--dsw-alias-label-tertiary` / `font-size:13px;line-height:2`）与 `SRC:205` 的 `CMD_BTN_STYLE`；空态改用 `.empty` 类，按钮改用 `.btn` 类（见 §6）。
- 宿主 token（`--dsw-alias-*`）在面板内只允许出现在必须贴合宿主外壳的容器上，不得用于本插件自己的文字与控件。

---

## 2. 圆角（3 档 + 小件）

| 档位 | 值 | 用途 | 依据 |
|---|---|---|---|
| 胶囊 | `999px` | tab、pill、badge、tag、快捷追问 chip、圆形/胶囊按钮 | 评审稿 1.3 裁定：改 |
| 卡片 | `16px` | `.card`、`.empty`、`.graphbox`、`.sheet`、`.composer` 外层、`.graphbox.fs` 除外 | 同上；`--radius:16px` 保留 |
| 控件 | `10px` | `.btn`、`.iconbtn`、input/textarea 容器、`.codeblock`、`.diffbox` | 同上 |
| 小件 | `8px` | `.btn.mini`、`.tag`、`.ev a`、`.ev button`、`table code`、`.gtools button` | 同上（1.3 明列「小件 8」） |

**收编**：`14px`（`.pill`，`CSS:12`）→ `16px`；`12px`（`.askbox`、`.asksend`，`CSS:40`、`CSS:44`）→ 随 `.composer` 重写删除；`9px`（`.ev a/.ev button`，`CSS:13`）→ `8px`；`13px`（`.sheetnav .actbtn` 覆写，`CSS:56`）→ 删除覆写，走 `.btn`。

---

## 3. 字号阶梯（5 档）

基准字体：`.cyd-app{font:14px/1.7 -apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}`（现值 `CSS:12` 是 `15px/1.7`，**改为 14px**；字族不动）。

| 档位 | 值 | 用途 | 依据 |
|---|---|---|---|
| 页标题 | `21px` | `h1`（页名） | 评审稿 1.4 裁定：改 |
| 卡标题 | `16px` | `.card h3`、`.sheethead h3`、`.pill .v`、图标题 `b` | 同上 |
| 正文 | `14px` | `.cyd-app` 基准、`.btn`、`.lede`、`.kv`、`.setrow`、`.toast`、`.empty`、`.impact p`、`.composer textarea` | 同上 |
| 次要 | `12.5px` | `.muted`、`.brand .by`、`.ev a/.ev button`、`.gtools button`、`.subsum`、`.stable`、`.codeblock`、`.diffbox`、`.snote`、`.ghead span`、`.plabel`、`.dhint`、`.verifier`、`.steps li::before`、`.composer chip` | 同上 |
| 徽标 | `11px` | `.badge`、`.tag`、`.subbadge text` | 同上 |

### 3.1 逐选择器映射（改代码时照这张表）

| 选择器 | 现值 | 定稿 | 依据 |
|---|---|---|---|
| `.cyd-app` 基准 | `15px/1.7`（`CSS:12`） | `14px/1.7` | 1.4 |
| `h1` | `21px`（`CSS:12`） | `21px` 不变 | 1.4 |
| `h1 .by` | `12.5px`（`CSS:12`） | `12.5px`，选择器改 `.brand .by` | 1.4 + 6.2 |
| `.pill .k` | `12px`（`CSS:12`） | `12.5px` | 1.4 |
| `.pill .v` | `16px`（`CSS:12`） | `16px` 不变 | 1.4 |
| `.tag` | `12px`（`CSS:13`） | `11px` | 1.4 |
| `.card h3` | `16px`（`CSS:13`） | `16px` 不变 | 1.4 |
| `.lede` | `15.5px`（`CSS:13`） | `14px` | 1.4 |
| `.muted` | `14px`（`CSS:13`） | `12.5px` | 1.4 |
| `.steps li::before` | `13.5px`（`CSS:13`） | `12.5px` | 1.4 |
| `.steps b` | `15px`（`CSS:13`） | `14px` | 1.4 |
| `.badge` | `11.5px`（`CSS:12-13`） | `11px` | 1.4 |
| `.note` | `13.5px`（`CSS:13`） | 随 `.composer textarea` 改 `14px` | 1.4 + §8 |
| `.copybtn` | `13.5px`（`CSS:116`） | 并入 `.btn` = `14px` | 1.4 + 1.5 |
| `.actbtn` | `13.5px`（`CSS:137`） | 并入 `.btn` = `14px` | 1.4 + 1.5 |
| `.empty` | `13.5px`（`CSS:121`） | `14px`，行高 `1.7` | 见 §10 冲突 C-1 |
| `.toast` | `13.5px`（`CSS:122`） | `14px` | 1.4 |
| `.sheethead h3` | `17px`（`CSS:126`） | `16px` | 1.4 |
| `.kv` | `13.5px`（`CSS:126`） | `14px` | 1.4 |
| `table.gloss` | `13.5px`（`CSS:19`） | 并入 `.stable` = `12.5px` | 1.4 + §7 |
| `.subbadge text` | `10px`（`CSS:19`） | `11px`（`CORE:789-802` 的圆半径同步放大到能容下 11px 字） | 1.4 |
| `.setrow` | `14px`（`CSS:58`） | `14px` 不变 | 1.4 |

未列出的选择器：若现值是 `13.5/15/15.5/12/11.5/10` 之一，按同语义归入上表对应档位（控件/正文 → 14，辅助说明 → 12.5，徽标 → 11）；不要新增第六档。

### 3.2 窄栏降档规则（配合 §6.3）

窄栏不新增档位，只**整体降一级**：页标题 `21 → 16`、卡标题 `16 → 14`、正文 `14 → 12.5`、次要 `12.5 → 12.5`（不变）、徽标 `11 → 11`（不变）。

---

## 4. 阴影（2 档）

**删除** `--shadow`（`CSS:5`、`CSS:11`、`CSS:12`、`CSS:13`），改为两个具名变量：

| 令牌 | 浅色值 | 深色值 | 用途 |
|---|---|---|---|
| `--shadow-card` | `0 1px 2px rgba(22,32,52,.05),0 4px 14px rgba(22,32,52,.06)` | `0 1px 2px rgba(0,0,0,.35),0 4px 14px rgba(0,0,0,.3)` | `.card`、`.pill`、`.btn.primary`、`.graphbox` |
| `--shadow-pop` | `0 10px 30px rgba(22,32,52,.18)` | `0 10px 30px rgba(0,0,0,.5)` | `.sheet`（弹层）、`.nodepop`、`.toast` |

依据：评审稿 1.6 裁定：改（4 套强度收成 2 档）。`--shadow-card` 逐字等于 mock-v2:12 的 `--shadow`。

**四处散落阴影的归口**（改完不得再有裸阴影值）：

| 现值位置 | 现值 | 归口 |
|---|---|---|
| `CSS:44` `.asksend` 的 `0 2px 10px rgba(20,92,235,.3)` | 蓝色发光 | **删除**（随 `.asksend` 重写为 `.composer` 的发送按钮，不再发光） |
| `CSS:71` 的 `0 10px 30px` | 浮层 | `--shadow-pop` |
| `CSS:122` `.toast` 的 `0 6px 24px rgba(0,0,0,.25)` | 浮层 | `--shadow-pop` |
| `CSS:126` `.sheet` 的 `0 18px 60px rgba(0,0,0,.35)` | 浮层 | `--shadow-pop` |
| `CSS:64` `.graphbox.fs` 的 `box-shadow:none` | 全屏无阴影 | 保留 `none` |

---

## 5. 间距节奏（6 / 8 / 12 / 18 / 24）

只允许这 5 个间距值（外加 `0` 与 `1px` 边框）。语义分工：

> **适用范围（两套数值域，不得互相套用）**：本节奏只约束 **HTML 组件**的间距（`padding` / `margin` / `gap`）。
> SVG 关系图的布局量属**另一套数值域**——**世界坐标几何量**：`layoutGraph()`（`CORE:260-304`）既有的层内 x 间距 `64`、层间 y 间距 `30`，以及 `references/graph-visuals.md` 的 `CHILD_GAP_X=16`、`CHILD_GAP_Y=20`、`TECH_GAP_X=32`、`LAYER_GAP_Y=16`、`CHILD_DROP=22`、`CHILD_CORNER_R=6`。
> **禁止拿 6/8/12/18/24 去套 SVG**：两者不互相换算、不强行对齐。理由：SVG 的数值是世界坐标下的图形布局量（会随 `gWorld` 的 `scale` 缩放），HTML 的数值是设备像素下的视觉节奏；把它们混成一套会同时破坏"图形比例正确"与"界面节奏统一"。

| 值 | 语义 | 典型落点 |
|---|---|---|
| `6px` | 同组内的紧凑间隙 | `.topacts` gap、`.composerbar` gap、`.snote` 与其上元素、`.sblock` 内相邻子元素、`.impact .sec p + p` |
| `8px` | 同类控件/表格行之间 | `.btn` 组 gap、`.stable` 单元格纵向 padding、`.steps` 内、`.ev` gap、`.setrow` 行内、小节内标题与内容 |
| `12px` | 卡片之间、区块内分栏 | `.card` 之间、`.cols` gap、`.composer` 内 padding 纵向、`.sblock` 内小节之间、`.impact .sec` margin-top |
| `18px` | 跨区块 | `.strip` margin-top、`.sblock + .sblock` margin-top、`.card` 内纵向 padding、`.composer` 与上一块 |
| `24px` | 页面级 | `.wrap` padding 纵向、`.card` 横向 padding、`.sheethead` / `.sheetbody` 横向 padding、`.impact` 与其他区块 |

**映射表**（现值不在节奏内的一律改）：

| 选择器 | 现值 | 定稿 | 依据 |
|---|---|---|---|
| `.wrap` | `padding:26px 22px 70px`（`CSS:12`） | `padding:24px 24px 48px` | 1.6 节奏收口 |
| `.strip` | `margin:18px 0 6px`（`CSS:12`） | `margin:18px 0 6px` 不变 | — |
| `.card` | `padding:20px 22px`、`margin-bottom:16px`（`CSS:13`） | `padding:18px 24px`、`margin-bottom:12px` | 1.6 节奏收口 |
| `.pill` | `padding:10px 14px`（`CSS:12`） | `padding:8px 12px` | 1.6 节奏收口 |
| `.sheethead` | `padding:16px 24px 12px`（`CSS:126`） | `padding:18px 24px 12px` | 1.6 节奏收口 |
| `.sheetbody` | `padding:8px 24px 22px`（`CSS:126`） | `padding:18px 24px 24px` | §7 弹层三原语 |
| `.empty` | `padding:22px`、`margin-bottom:16px`（`CSS:121`） | `padding:24px`、`margin-bottom:12px` | 1.6 节奏收口 |
| `.steps li` | `padding:0 0 24px 46px`（`CSS:13`） | `padding:0 0 24px 46px` 不变 | — |

---

## 6. 组件规格

### 6.1 `.btn` / `.btn.primary` / `.btn.mini`

定稿（替换 `CSS:116` `.copybtn`、`CSS:137` `.actbtn`、`CSS:223` `#glossary .actrow button.primary`、`SRC:205` `CMD_BTN_STYLE` 四套写法；评审稿 1.5 裁定：改）：

```css
.cyd-app .btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;
  border:1px solid var(--line);background:var(--panel);color:var(--ink);
  border-radius:10px;padding:6px 12px;font:inherit;font-size:14px;line-height:1.4;font-weight:400;
  cursor:pointer;white-space:nowrap;transition:.15s}
.cyd-app .btn:hover{border-color:var(--accent);color:var(--accent)}
.cyd-app .btn:active{transform:translateY(1px)}
.cyd-app .btn:disabled{opacity:.55;cursor:default;transform:none}
.cyd-app .btn.primary{border-color:var(--accent);background:var(--accent);color:var(--on-solid);
  font-weight:600;box-shadow:var(--shadow-card)}
.cyd-app .btn.primary:hover{filter:brightness(1.06);color:var(--on-solid)}
.cyd-app .btn.primary:disabled{opacity:.55;box-shadow:none;filter:none;cursor:default}
.cyd-app .btn.mini{padding:2px 9px;font-size:12.5px;border-radius:8px}
```

| 项 | 值 | 依据 |
|---|---|---|
| 形状 | `border-radius:10px`（小件 `.mini` 用 8px） | 1.3 + 1.5 |
| 尺寸 | `padding:6px 12px`，`font-size:14px`；`.mini` 用 `2px 9px`/12.5px | 1.4 + 1.5 |
| 常态 | 1px `--line` 边框、`--panel` 底、`--ink` 字 | 1.5 |
| hover | 边框与文字都变 `--accent` | 1.5 |
| 禁用 | `opacity:.55` + `cursor:default`（**不得**只靠提示文案拦截，见评审稿 11.10） | 11.10 |
| 主按钮 | **单一主色 `--accent`**；`--ok` 只表达"成功/已验证"状态，不做按钮底色 | 见 §10 冲突 C-3 |

**绿色主按钮的处理**：`CSS:139-140` 的 `.actbtn.primary{border-color:var(--ok);background:var(--ok)}` 归并为 `.btn.primary`（accent）。同一界面只允许一种主按钮配色。

### 6.2 `.iconbtn` 与头部两段结构

```css
.cyd-app .iconbtn{width:32px;height:32px;display:inline-flex;align-items:center;justify-content:center;
  border:1px solid var(--line);border-radius:10px;background:transparent;color:var(--ink2);
  font-size:16px;line-height:1;padding:0;cursor:pointer;transition:.15s}
.cyd-app .iconbtn:hover{border-color:var(--accent);color:var(--accent)}
.cyd-app .iconbtn:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.cyd-app .iconbtn[aria-pressed="true"]{background:var(--accent-soft);border-color:var(--accent);color:var(--accent)}
.cyd-app.narrow .iconbtn{width:28px;height:28px}
```

| 项 | 值 | 依据 |
|---|---|---|
| 尺寸 | `32×32`（窄栏 `28×28`） | 任务书 §② |
| 圆角 | `10px` | 1.3 |
| 边框 | `1px solid var(--line)` | 1.5 |
| 底色 | `transparent`（**不是** `--panel`；贴头部时不要出白色方块） | 任务书 §② |
| 常态色 | `--ink2` | 1.9 |
| hover | 边框 + 文字变 `--accent` | 1.5 |
| focus-visible | `outline:2px solid var(--accent);outline-offset:2px`（全库已有同款，`CSS:12`） | 1.9 |
| 内容 | 内联 SVG（描边跟随 `currentColor`）；**头部三枚 ⚙/🕓/🌓 例外，按评审稿 3.2 裁定保留 emoji 字形** | 见 §10 冲突 C-2 |

头部两段结构（替换 `SHELL:2-7` 的现有结构；**取代** `CSS:12` 的 `header.top{justify-content:space-between}` 与 `h1 .by`）：

```html
<header class="top">
  <div class="brand">
    <h1 id="projName">开发仪表盘</h1>
    <span class="by">（由 control-your-development 生成）</span>
  </div>
  <div class="topacts">
    <button id="setBtn" class="iconbtn" title="设置" style="display:none">⚙</button>
    <button id="verBtn" class="iconbtn" title="版本快照" style="display:none">🕓</button>
    <button id="themeBtn" class="iconbtn" title="切换主题">🌓</button>
  </div>
</header>
```

```css
.cyd-app header.top{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.cyd-app .brand{display:flex;align-items:baseline;min-width:0}
.cyd-app .brand h1{font-size:21px;margin:0;letter-spacing:.2px}
.cyd-app .brand .by{font-size:12.5px;color:var(--ink2);font-weight:400;margin-left:10px}
.cyd-app .topacts{display:flex;align-items:center;gap:6px;margin-left:auto}
```

| 项 | 值 | 依据 |
|---|---|---|
| `.brand` | `h1` + `.by` 副标题两段；`.by` 从 `h1` 内部**移出**到 `.brand` 内 | 3.1 + 任务书 §② |
| `.by` 文案 | `（由 control-your-development 生成）`，与 `h1` 的「开发仪表盘」拼接后等于裁定句「开发仪表盘（由 control-your-development 生成）」 | 3.1 |
| `.topacts` | `display:flex;gap:6px;margin-left:auto` | 任务书 §② |

### 6.3 窄栏断点 `.cyd-app.narrow`

**触发方式（新增实现点）**：`CORE` 在 `rootEl`（`CORE:402` 已加 `.cyd-app`）上按**容器宽度**切换 `.narrow`：`rootEl.clientWidth < 620` 时加，否则摘；`ResizeObserver(rootEl)` 同步。**不得**用 `@media (max-width:…)` 视口断点——面板塞在约 360px 的右侧栏里而视口仍是 1920px。窄栏常量命名为 `NARROW_MAX = 620`。

规则清单（**全部**要落地；与本清单冲突的现有声明一律删除）：

| # | 规则 | 说明/依据 |
|---|---|---|
| N1 | `.cyd-app.narrow header.top{display:flex}`、`.cyd-app.narrow .strip{display:flex}` | **不隐藏 header 与掌控条**（任务书明令）。禁止出现 `display:none` 命中这两处 |
| N2 | `.cyd-app.narrow .wrap{max-width:none;padding:12px 12px 24px}` | `CSS:12` 的 `max-width:1120px` 是"面板塞进侧栏很丑"的首因（评审稿 1.7） |
| N3 | `.cyd-app.narrow .strip{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:12px 0 6px}` + `.cyd-app.narrow .pill{flex:none;min-width:0;width:auto}` | **窄栏改为 2 列网格**（原"pill 单列"作废）——依据队长实测：旧规则下窄栏 `.strip` 实测宽 **438px**，横向溢出。完整规则与阈值见 **§12.1**（以 §12.1 为准） |
| N4 | `.cyd-app.narrow .cols{grid-template-columns:1fr;gap:12px}` | `.cols` 单列。`CSS:13` 的 `@media (max-width:840px){.cols{1fr}}` **删除**，改为本容器断点 |
| N5 | `.cyd-app.narrow{font-size:12.5px;line-height:1.6}` | 正文基准 12.5px（评审稿 1.7）；其余按 §3.2 降一级 |
| N6 | `.cyd-app.narrow .brand .by{display:none}` | 副标题隐藏（替代"隐藏整个 header"的旧方案） |
| N7 | `.cyd-app.narrow .iconbtn{width:28px;height:28px}` | 图标按钮 28×28 |
| N8 | `.cyd-app.narrow .card{padding:14px 14px}` | 窄栏横向留白收窄 |
| N9 | `.cyd-app.narrow nav.tabs{gap:6px}` + `.cyd-app.narrow nav.tabs button{padding:6px 12px;font-size:13px}` | tab 单行可换行、不再横向溢出 |
| N10 | `.cyd-app.narrow .composerbar{flex-wrap:wrap;align-items:flex-end}` + `.cyd-app.narrow .composer .chips{flex-wrap:wrap}` + `.cyd-app.narrow .composer .send{margin-left:auto;align-self:flex-end}` | chips 换行、发送按钮固定右下（§8） |
| N11 | `.cyd-app.narrow .stable{display:block;overflow-x:auto}`（外层 `.stablewrap{overflow-x:auto}`） | 表格在窄栏横向滚动，不挤压列宽 |
| N12 | `.cyd-app.narrow .empty{font-size:12.5px;line-height:1.6}` | 窄栏空态（评审稿 1.12） |
| N13 | `.cyd-app.narrow .sheet{max-width:none;max-height:calc(100vh - 24px)}` + `.cyd-app.narrow .sheethead{padding:14px 14px 12px}` + `.cyd-app.narrow .sheetbody{padding:12px 14px 18px}` | 弹层在窄栏贴边铺满 |

**互斥说明**：`.cid-app.cyd-immersive`（`CSS:23-38`，会话页整页模式）下 `.strip`/`header.top` 本来就隐藏（`CSS:25-28`），那是**整页模式的刻意裁剪**，与 N1 不矛盾；N1 只约束普通面板与窄窗口网页版。

---

## 7. 弹层排版三原语（`.sblock` / `.snote` / `.stable`）

评审稿 §10 的批注："弹层里的文案都一行行挤在一起，不同的文案之间也没有明确区分。" 三个原语是**唯一**的弹层排版手段。

```css
.cyd-app .sblock{margin-top:18px}
.cyd-app .sblock:first-child{margin-top:0}
.cyd-app .sblock > * + *{margin-top:6px}
.cyd-app .sblock > h4{margin:0;font-size:14px;font-weight:600}
.cyd-app .sblock > h4 + *{margin-top:8px}

.cyd-app .snote{color:var(--ink2);font-size:12.5px;line-height:1.6;
  border-left:3px solid var(--line);padding-left:8px;margin:6px 0 0}

.cyd-app .stable{width:100%;border-collapse:collapse;font-size:12.5px}
.cyd-app .stable th,.cyd-app .stable td{padding:8px 10px;text-align:left;vertical-align:top;
  border-bottom:1px solid var(--line)}
.cyd-app .stable th{background:var(--chip);font-weight:600}
.cyd-app .stable tbody tr:nth-child(even){background:color-mix(in srgb,var(--chip) 60%,transparent)}
.cyd-app .stable th.num,.cyd-app .stable td.num{text-align:right;font-variant-numeric:tabular-nums}
```

| 原语 | 用法 | 依据 |
|---|---|---|
| `.sblock` | 一个语义区块（如"版本列表"、"审计汇总"各是一个 `.sblock`）；区块之间 `18px`，区块内相邻元素 `6px`，标题与正文之间 `8px` | 任务书 §③ |
| `.snote` | 辅助说明/免责/条件分支句。`--ink2`、`12.5px`、左侧 `3px` 竖线、左边距 `8px` | 任务书 §③ |
| `.stable` | 所有弹层表格。表头 `--chip` 底 + 600 字重，单元格 `8px 10px`，偶行斑马纹，数字列加 `.num` 右对齐 | 任务书 §③ |
| 表格行 | 竖向 padding `8px`；表格与上下元素之间 `12px` | 任务书 §③ |

**删除全部内联 margin**（评审稿 1.8 裁定：改）：

- `CORE:1159, 1239, 1244, 1249, 1252, 1257` 的 `style="margin:14px 0 6px"`（6 处）→ 换成 `<div class="sblock">` / `.snote`，间距由类给。
- `CORE:458, 461, 601, 1178, 1250, 1376` 的内联复刻样式 → 收进类。
- 例外：`SHELL:4-6` 的 `style="display:none"` 是**显隐**不是排版，保留。

**归并**：`table.gloss`（`CSS:19`，13.5px / `6px 8px`）删除，全部改用 `.stable`；`CORE:529, 536`、`CORE:1241`、`CORE:1244` 等 `<table>` 一律加 `class="stable"`，数字列加 `class="num"`。

---

## 8. `.composer` 发送框规格

评审稿 §10 的批注："发送给 agent 的输入与发送框布局很丑，改成 dsh 原生的那种发送框形状。" 定稿为一个大圆角容器 + 内层无边框输入区 + 底部动作条。

```css
.cyd-app .composer{border:1px solid var(--line);border-radius:16px;background:var(--panel);
  padding:10px 12px;transition:.15s}
.cyd-app .composer:focus-within{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
.cyd-app .composer textarea{border:0;background:transparent;outline:none;resize:none;
  width:100%;display:block;padding:0;margin:0;font:inherit;font-size:14px;line-height:1.6;
  min-height:24px;max-height:96px;overflow-y:auto}
.cyd-app .composerbar{display:flex;align-items:center;gap:6px;margin-top:8px}
.cyd-app .composer .chips{display:flex;gap:6px;flex:1 1 auto;min-width:0;flex-wrap:wrap}
.cyd-app .composer .chip{border:1px solid var(--line);background:var(--panel);color:var(--ink2);
  border-radius:999px;padding:3px 11px;font:inherit;font-size:12.5px;cursor:pointer;white-space:nowrap}
.cyd-app .composer .chip:hover{border-color:var(--accent);color:var(--accent)}
.cyd-app .composer .send{flex:none;width:32px;height:32px;border-radius:999px;padding:0;
  border:1px solid var(--accent);background:var(--accent);color:var(--on-solid);
  display:inline-flex;align-items:center;justify-content:center;cursor:pointer}
.cyd-app .composer .send:hover{filter:brightness(1.06)}
.cyd-app .composer .send:disabled{background:var(--chip);border-color:var(--line);color:var(--ink2);
  filter:none;cursor:default}
```

| 项 | 值 | 依据 |
|---|---|---|
| 外层容器 | 圆角 `16px`、`1px solid var(--line)`、底 `--panel`、内 padding `10px 12px` | 任务书 §④ |
| focus 态 | `:focus-within{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}` | 任务书 §④ |
| 内层 textarea | 无边框、透明底、`resize:none`、`outline:none`、`padding:0` | 任务书 §④ |
| 自动增高 | **1–4 行**：`min-height:24px`（1 行 = 14×1.6 ≈ 22.4）、`max-height:96px`（4 行），超出滚动。JS 在 `input` 时设 `el.style.height='auto'` 再设 `el.style.height=Math.min(el.scrollHeight,96)+'px'` | 任务书 §④ |
| 底部动作条 | `.composerbar`：左 `.chips`（`flex:1 1 auto`），右 `.send`（`flex:none`），`gap:6px` | 任务书 §④ |
| 五个快捷追问胶囊 | 固定五枚、固定顺序：**进度 / 风险 / 改进 / 边界 / 下一步**（标签就是这五个词，发出的问句见 `copy-deck.md` §10.13） | 10.13 裁定 |
| 发送按钮 | 圆形（`999px`）、`32×32`、内容为**内联 SVG 向上箭头**（`currentColor` 描边），禁用态改灰底灰字 | 10.13 裁定「📤」+ 1.9（控件用 SVG） |
| 窄栏 | chips 换行、发送按钮固定右下（N10） | 任务书 §④ |

**删除**：`CSS:40-53` 的 `.askbox` / `.askrow` / `.asksend` / `.asksend .ico` / `.asksend .txt` / `.askquick` / `.askquick .lab` / `.askchip` 全部删除，连同 `CSS:44` 的蓝色发光阴影（见 §4）；`CORE:1312-1322` 的 `askBoxHtml()` 内联结构改写为 `.composer` 结构；`.note`（`CSS:13`）在 `.composer` 内不再需要独立类（若别处仍用 `.note`，其样式与 `.composer textarea` 一致）。

---

## 9. 改动影响面区块（B2，批 5 用）排版规格

```css
.cyd-app .impact{margin-top:18px}
.cyd-app .impact .summary{margin:0;font-size:14px;line-height:1.7}
.cyd-app .impact .sec{margin-top:12px}
.cyd-app .impact .sec h5{margin:0 0 8px;font-size:12.5px;font-weight:600;color:var(--ink2)}
.cyd-app .impact .sec p{margin:0;font-size:14px;line-height:1.7}
.cyd-app .impact .sec p + p{margin-top:6px}
.cyd-app .impact .file-ok{color:var(--ok)}
.cyd-app .impact .file-missing{color:var(--warn)}
.cyd-app .impact .sec .badge{margin-right:6px}
```

| 项 | 定稿 | 依据 |
|---|---|---|
| 摘要行 | `改它要动 N 个文件 · 影响 N 个下游功能 · 还差 N 个上游`，**≤30 字**，单行 `<p class="summary">`，数量用 `<b>` 不用 `.badge` | 任务书 §⑤ |
| 展开后三段 | 固定三段、固定顺序：**要动的文件 / 影响的下游功能 / 上游依赖**，每段一个 `.sec`，标题 `<h5>` | 任务书 §⑤ |
| 文件在不在用 | 在用的文件 `class="file-ok"`（`--ok`）；找不到的文件 `class="file-missing"`（`--warn`）。**不用 `--gray`**（`--gray` 只表达"设想/已废弃"状态，见 `CORE:412`） | 任务书 §⑤ |
| 功能状态用 | 现有 `SCOLOR`/`SSOFT`（`CORE:412-413`）经 `.badge.b-x{1..5}` 表达；`CORE:411` 的 `SMAP` 不动 | 任务书 §⑤ |
| 数量与状态 | **一律用 `.badge`**（数量也用，如 `.badge` 里写 `3 个`），不得用裸数字或加粗代替 | 任务书 §⑤ |
| 单条文案 | **≤40 字**；每句独占一个 `<p>`（`.sec p`），不得把两句塞进一个 `<p>` | 任务书 §⑤ |
| 间距 | 区块与其他内容之间 `18px`；段与段之间 `12px`；段内 `<p>` 之间 `6px`；标题与列表之间 `8px` | §5 节奏 |

---

## 10. 冲突与「以谁为准」一览

| # | 冲突 | 裁定 |
|---|---|---|
| C-1 | 评审稿 **1.4**（字号收成 5 档）与 **1.12**（空态统一 `13.5px/1.7`）冲突：`13.5` 不在五档内 | **队长已裁决，以 1.4 为准**：`.empty` = `14px/1.7`（正文档），窄栏 `12.5/1.6`；**`13.5px` 这一档从全库删除**（`.note` 并入正文档 14px、`table.gloss` 并入 `.stable` 12.5px）。全文出现 `13.5px` 一律按最近档位改 |
| C-2 | 评审稿 **1.9**（界面控件用内联 SVG，状态标记保留 emoji）与 **3.2** 裁定（保留 `⚙`/`🕓`/`🌓`）冲突 | **队长已裁决，以 3.2 为准**：头部三枚保留 emoji 字形，但外框改 `.iconbtn`；其余控件一律内联 SVG；`🤖` 全删 |
| C-3 | `CSS:139-140` 的 `.actbtn.primary` 用 `--ok` 绿底，与 `CSS:223` `#glossary .primary` 的 `--accent` 蓝底并存 | **以 `--accent` 为准**：`.btn.primary` 只有一种主色，`--ok` 不得做按钮底色 |
| C-4 | `CSS:12` `header.top{justify-content:space-between}` + `h1 .by`，与 §6.2 的两段结构冲突 | **以 §6.2 为准**：`.by` 移出 `h1`，`space-between` 由 `.topacts{margin-left:auto}` 取代 |
| C-5 | `CSS:13` `@media (max-width:840px){.cols{1fr}}` 是**视口**断点，与 §6.3 的**容器**断点冲突 | **以 §6.3 为准**：删除该 media 块，改 `.cyd-app.narrow .cols` |
| C-6 | `CSS:19` `table.gloss`（13.5px / `6px 8px`）与 §7 的 `.stable` 冲突 | **以 `.stable` 为准**：删除 `table.gloss`，全部表格改用 `.stable` |
| C-7 | mock-v2 深色块缺 `--on-solid` | **以 `CSS:9` 的 `#13161c` 为准**（mock 缺陷） |
| C-8 | `CSS:44` 的蓝光阴影、`CSS:71/122/126` 的三套浮层阴影 | **以 §4 的两档为准**，蓝光删除 |

**构建纪律**：所有改动只落在 `templates/` 三个核文件；改完必须重跑 `tools/build_panel.py` 生成 `lib/client.js`（评审稿 18.8），否则面板不更新。`lib/client.js` 与 `release/` 下的副本不得手改。

---

## 11. 决策卡三态与「待生效」标记（队长裁决④⑤补入）

### 11.1 决策卡三态

| 态 | 类名 | 视觉规格 | 依据 |
|---|---|---|---|
| 待拍板 | `.decision` | 1px `--line` 边框、`--panel` 底、圆角 16px、padding `12px 14px`；选项为可勾选控件（默认多选） | 7.3 裁定 |
| 已定 | `.decision.decided` | 沿用 `.decision` 底色，内容区 `opacity:.75`、`cursor:default`，选择结果以 `.badge.b-x4`（`--ok-soft`/`--ok`）显示 | 7.3 + 7.4 |
| 已废弃 | `.decision.obsolete` | `opacity:.55`；标题 `text-decoration:line-through`；`background:var(--gray-soft)`、`border-color:var(--line)`；`cursor:default`。**与功能卡 `.feat.deprecated` 同一套处理**（`CSS:17` 打印规则里的 `.feat.deprecated` 同步补 `.decision.obsolete`） | 队长裁决④ |

```css
.cyd-app .decision{background:var(--panel);border:1px solid var(--line);border-radius:16px;
  padding:12px 14px;margin-top:12px}
.cyd-app .decision + .decision{margin-top:8px}
.cyd-app .decision.decided{opacity:.75;cursor:default}
.cyd-app .decision.obsolete{opacity:.55;background:var(--gray-soft)}
.cyd-app .decision.obsolete > h4{text-decoration:line-through}
```

- **风格族**：`.decision.decided` 与 `.decision.obsolete` 是**同一风格族的两个终态**（都是"不可再改"的卡片），只在底色与透明度上分层——`.decided` 保留 `--panel` 底、`opacity .75`；`.obsolete` 换 `--gray-soft` 底、`opacity .55` + 标题删除线。两者都不加动效（`prefers-reduced-motion` 下表现一致）。
- 恢复按钮：`.decision.obsolete .btn.mini` 文案 `恢复`（→ `copy-deck.md` §5）；点击后 `已废弃 → 待拍板`，**必须在 `NOW.md` 时间线留痕**（队长裁决④）。
- 契约：由架构师在 task-4 升 `references/dashboard-format.md` v1.5，决策状态新增 `已废弃`；`render_dashboard.py` 的 `parse_now` 同步。

### 11.2 离线「待生效」标记与徽章

| 元素 | 类名 | 视觉规格 | 依据 |
|---|---|---|---|
| 待办行内标记 | `.pending-tag` | 文本 `已报 · 待生效`；`font-size:11px`（徽标档）、`--warn-soft` 底、`--warn` 字、`border-radius:999px`、`padding:2px 9px` | 7.9b + 队长裁决⑤ |
| 掌控条徽章 | `.pill.pending` | 标签 `⏳ 待生效 n 条`；沿用 `.pill`，边框改 `color-mix(in srgb,var(--warn) 55%,var(--line))`、底色 `--warn-soft`（与 `.pill.alert` 同款，`CSS:12`/mock-v2:35） | 队长裁决⑤ |
| 明细浮层 | `.sblock` + `.stable` | 点开 `⏳ 待生效 n 条` 后，用 `.stable` 列出明细，第一列标注 `待办` / `拍板` / `指令`（用 `.badge.b-x3` / `.badge.b-x2` / `.badge.b-x1`），构成「明确区分」的排版 | 队长裁决⑤ + 评审稿 §10 批注 |

```css
.cyd-app .pending-tag{display:inline-block;font-size:11px;border-radius:999px;padding:2px 9px;
  background:var(--warn-soft);color:var(--warn);font-weight:600;white-space:nowrap}
.cyd-app .pill.pending{border-color:color-mix(in srgb,var(--warn) 55%,var(--line));
  background:var(--warn-soft)}
```

### 11.3 拍板浮层底部跳转行（队长裁决③）

拍板浮层（`CORE:1216-1229`）底部新增一行 `.sheetfoot`：文案 `完整列表见「决策与待办」页 →`，整行可点，点击切到 `decisions` tab 并关闭浮层。**tab id 统一为 `decisions`**（契约口径，与 `features`／`glossary` 同族；不用 `decide`）：nav 按钮写 `data-tab="decisions"`，对应 section 写 `id="decisions"`。

```css
.cyd-app .sheetfoot{flex:none;padding:12px 24px;border-top:1px solid var(--line);
  display:flex;justify-content:flex-end}
.cyd-app .sheetfoot .linkbtn{border:0;background:none;color:var(--accent);font:inherit;
  font-size:12.5px;cursor:pointer;padding:0}
.cyd-app .sheetfoot .linkbtn:hover{text-decoration:underline}
```

**徽章行为不变**：掌控条「等你拍板」照旧打开本浮层（评审稿 3.4 裁定），不跳 tab；**评审稿 7.7「徽章跳 tab」作废**。

### 11.4 `.narrow` 触发方式（已确认，禁止视口断点）

`.cyd-app.narrow` 由 `CORE` 按**容器宽度**切换：`NARROW_MAX = 620`，`rootEl.clientWidth < NARROW_MAX` 时加 `.narrow`；用 `ResizeObserver(rootEl)` 同步（面板挂在约 360px 的右侧栏里，视口仍是 1920px，**`@media (max-width:…)` 视口断点在此场景必然失效，禁止使用**）。详见 §6.3。

---

## 12. 批 2 视觉补条（队长实测）

> 来源：队长肉眼审计 + 实拍实测（`output/_probe/shots-real/`、`shots-v2/`）与 avatar 探针计数。每条给**值 + 依据 + 反例**，不写「建议」。
> 本节是**批 2 整改单（task-22）的权威数值来源**；与 §1–§11 冲突时**以本节为准**（本节更晚、且有实测依据），冲突处已逐条注明。

### 12.1 掌控条 pill：塌陷修复与窄栏两列网格

**实测（依据）**：宽栏 6 个 pill **全被拉到 177px**；窄栏 `.strip` 实测宽 **438px**（横向溢出）；长值会把整条掌控条撑高（"塌陷"）。

| 项 | 值 | 依据 / 反例 |
|---|---|---|
| 值的文本处理 | **剥离 Markdown 标记**再渲染：`**`/`__`/`*`/`_`/`` ` `` 去掉；`[文字](url)` → 只留 `文字`；`![alt](url)` → 删；行首 `#`/`-`/`*`/`>` 去掉。实现：`stripMd(s)`，在 `renderStrip()`（`CORE:543-559`）的 `<div class="v">` 内容上调用，形如 `esc(stripMd(v))` | 数据来自用户手写的 `PRODUCT.md`，**不能要求用户不用 Markdown**；反例：`当前阶段` 值写成 `**核心功能收尾**` 时，现状会把星号一起显示 |
| 值最多 2 行（宽栏）／**1 行（窄栏）** | `.cyd-app .pill .v{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}`；窄栏覆盖 `.cyd-app.narrow .pill .v{-webkit-line-clamp:1}`；同时给该 pill 的**值元素**加 `title="<未截断全文>"`（全量，不做截断判断） | 超出行数就 `…` 省略；反例：现状长值把 pill 撑到 3–4 行，整条掌控条跟着变高 |
| **固定高度（硬约束，不得被内容撑高）** | **`.cyd-app .pill{height:88px;min-width:132px;display:flex;flex-direction:column;justify-content:center;overflow:hidden}`**（宽栏）／**`.cyd-app.narrow .pill{height:66px}`**（窄栏）——**以实现为准**（executor 已实现并过图验收）。**禁止 `min-height`**：它允许内容把 pill 撑高，与"维持高度一致／不改变原来的高度"直接冲突。`.k` 恒 1 行（`white-space:nowrap;overflow:hidden;text-overflow:ellipsis`），`.v` 靠行数钳制，`overflow:hidden` 只作兜底 | 用户要求：**维持高度一致 + 超长用 `…` + 悬停看全文 + 不改变原来的高度**。高度基线：宽栏 `padding 8+8` + `.k` **17.5**（12.5×1.4）+ `margin-top` **2** + `.v` **41.6**（16×1.3×2 行）= **77.1** → 实现取 **88px**（余量吸收字体/行高浮动与「数据更新于」的按钮同行）；窄栏 `8+8 + 17.5 + 2 + 18.2`（14×1.3×1 行）= **53.7** → 实现取 **66px**。**反例**：现状无高度约束，任一 pill 的长值就把整条抬到 177px |
| `.pill` 的 `min-width` | **`132px`**（原 `150px`）→ **6 个 pill 排单行需要 ≈832px 以上**（6×132 + 5×8 = 832），低于此宽度自动折行 | executor 实测：132 是"6 pill 单行且不挤爆"的最小值 |
| `.vtxt`（值文本可收缩）与「数据更新于」pill | 「数据更新于」pill 走 `display:flex`（日期 + `更新` 按钮同行）；**日期必须包一层 `.vtxt`**：`.vtxt{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}`，日期可被省略号收缩；**按钮 `flex:none`，永不被裁** | 实测：360px 窄栏下「数据更新于」的**更新按钮曾被 `overflow:hidden` 裁掉**（日期 + 按钮放不进）。**硬要求：宁可日期显示为 `…`，也不能让按钮消失** （本条纪律**同款复用**于证据路径胶囊的 `.evtxt`：同类纪律、不同类名，见 **§12.12**） |
| 中宽（760–900px）折行 | 该区间 6 个 pill 会**换成 2 行、总高 184px**（= 2×88 + gap 8）。**这是 6 pill 布局的固有行为，不是缺陷**；高度上限仍按下面两行卡 | executor 实测。反例：把它当 bug 去压高度，会挤坏单 pill 的 88px 固定高度 |
| `.strip` 的行内等高 | `.cyd-app .strip{align-items:stretch}` | 每个 pill 已是同一固定高度，"等高"自然成立；`align-items` 取 stretch 只为消除底边参差。**不再依赖 `min-height` 达成等高** |
| 宽栏 `.strip` 高度上限 | **单行实测 = 88px**（= pill 固定高度）；**回归阈值 ≤ 104px**；中宽 2 行时 = **184px** | 6 个 pill 排 1 行 → strip 内容高 88px。> 104px 且非 2 行即说明固定高度被绕过（有人写回 `min-height` 或去掉行数钳制）。**不得**用 `overflow:hidden` 把内容裁掉 |
| 窄栏：2 列网格 | `.cyd-app.narrow .strip{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:12px 0 6px}` + `.cyd-app.narrow .pill{flex:none;min-width:0;width:auto;height:66px;padding:8px 10px}` | 6 个 pill = 3 行；strip 内容高 = **3×66 + 2×8 = 214px**。窄栏把值压到 **1 行**是刻意的：2 行会把 3 行网格推到 240px 以上、突破下一行的 220px 上限 |
| 窄栏 `.strip` 高度上限 | **≤ 220px**（回归阈值；当前值 214px） | 反例：旧规则 `.strip{flex-direction:column}` + `.pill{min-width:150px;width:100%}` 实测宽 438px、6 行、高度远超 220px |

**与既有条文的冲突（以本节为准）**：`§6.3 N3` 原写「pill 单列」，**作废**，改为 2 列网格（N3 行已同步指向本节）；`§6.3 N1` 的「不隐藏掌控条」仍然有效，不受影响。

### 12.2 pill 内部的字号与行高

| 元素 | 值 | 档位（§3） | 依据 |
|---|---|---|---|
| `.pill .k`（标签） | `font-size:12.5px; line-height:1.4; letter-spacing:.4px; color:var(--ink2)` | **次要档 12.5px** | 落在 5 档内，不新增字号 |
| `.pill .v`（值） | `font-size:16px; line-height:1.3; font-weight:650; color:var(--ink)` | **卡标题档 16px** | 同上；`line-height:1.3` 是 2 行钳制的计算基准（16×1.3=20.8，2 行 41.6px） |
| `.pill .v .btn.mini`（如「🔄 更新」） | `font-size:12.5px; line-height:1.4` | **次要档 12.5px** | 与 §6.1 `.btn.mini` 一致 |

反例：`.pill .v` 现无 `line-height`（`CSS` 现状 `font-size:16px;font-weight:650;margin-top:2px`）→ 2 行时行距不可预测，§12.1 的高度上限算不出来；`.pill .k` 已落到 12.5px，若回退到 12px 就落在 5 档之外（§3）。

### 12.3 `.kv` 改两列网格（标签列 + 值列）

**依据（反例）**：截图里 `验证 已标为可用` 只隔一个空格，读起来像"验证已标为可用"。

```css
.cyd-app .kv{display:grid;grid-template-columns:5em 1fr;gap:4px 8px;align-items:baseline;
  font-size:14px;margin-top:8px}
.cyd-app .kv b{color:var(--ink2);font-weight:600;margin-right:0}
.cyd-app .kv > *{min-width:0}
/* 没有 <b> 标签的 .kv（纯文本块）退回块级，避免被塞进第一列 */
.cyd-app .kv:not(:has(> b)){display:block}
/* 局部例外：标签超过 5em 的**个别行**才加 .kvwide，别动全局列宽 */
.cyd-app .kv.kvwide{grid-template-columns:max-content 1fr}
.cyd-app .kv.kvwide > b{white-space:nowrap}
```

| 项 | 值 | 依据 |
|---|---|---|
| 列定义 | 标签列 **`5em`**（14px 下 = 70px，够放 3–4 个中文字）＋ 值列 **`1fr`** | 队长实测截图 |
| 列间距 / 行间距 | **`8px` / `4px`** | `4px` 是紧邻行的最小视觉分隔（节奏允许 0/6/8 的最小档） |
| 标签色 / 值色 | 标签 `--ink2`、值 `--ink` | 契约要求的"标签与值可区分"；现状两者色差不足 |
| 兜底 | `.kv:not(:has(> b)){display:block}` | 面板标签行等无 `<b>` 的用法不被网格破坏 |
| **局部例外** | **标签超过 5em 的个别行**可加 **`.kvwide`**（`max-content 1fr` + 标签 `nowrap`）；**不改全局列宽**（改全局会同时移动所有 `.kv` 的价值列起点）。已落地：「上游依赖功能」「下游依赖功能」两行（6 个字，默认 5em 会折成两行） | 队长实测（executor 已按此修）——**通用规格 + 被命名的局部例外**，而不是把通用规格改宽去迁就最长的那一个 |
| 窄栏 | `.cyd-app.narrow .kv{grid-template-columns:4em 1fr}`（**以实现为准**：窄栏标签列降为 `4em`，`12.5px` 基准下与 `5em` 等宽） | `CSS` 现状（executor 已落）；本节原未规定窄栏列宽，此处补登记 |

**与既有条文**：`§3.1` 的 `.kv = 14px` 不变，本节只加网格布局。反例：现状 `margin-right:6px` 的空白间隔（非网格）在标签长度不一时值不会对齐。

### 12.4 `.composer` 收窄职责（框内只留输入与动作）

**依据（反例）**：截图里框内塞了标签 + 两条说明 + textarea + chips，上方说明压着 textarea 顶边。

| 项 | 值 | 依据 |
|---|---|---|
| 框内（`.composer` 直接子元素） | **只允许** `textarea` 与 `.composerbar`（含 chips + 发送键）；**其他一律不放** | 任务书 §12.4 |
| 标签（如 `发送到主对话：`） | 移到**框外上方**，`<p class="composerlabel">`：`font-size:12.5px;color:var(--ink2);margin:0 0 6px` | 标签不是输入内容 |
| 说明文字（`消息会自动带上…`、`拿不到直发通道时会改成复制…`） | 移到**框外下方**，用 `.snote`（`§7` 原语）：`margin:6px 0 0` | 与框间距 **6px**（节奏档） |
| 守卫规则 | `.cyd-app .composer > .snote{display:none}` | 防止说明被塞回框内（DOM 契约的硬保险） |
| 框本体 | 不变：`border:1px solid var(--line);border-radius:16px;padding:10px 12px`；`:focus-within` 见 §8 | §8 |

反例：现状框内 5 类元素混排，且说明与 textarea 顶边相压（实测截图）。

### 12.5 功能详情弹层必须区块化（`.sblock`）

**依据（探针实测）**：审计弹层 `sblock:4`，**功能详情弹层 `sblock:0`** —— 用户 §10.2 的诉求只修了一半。

| 项 | 值 |
|---|---|
| `featBodyHtml()` 输出**必须**用 `.sblock` 分成 6 块 | 简介 / 验证 / 子项 / 证据 / 最近在忙 / 依赖关系（上游依赖功能 + 下游依赖功能 同属第 6 块） |
| 块间 / 块内 | 块间 **18px**（`.sblock + .sblock`）、块内相邻元素 **6px**、块内标题与内容 **8px**（§7） |
| 验收阈值（探针） | 功能详情弹层的 `sblock` 计数 **≥ 6**；审计弹层保持 **≥ 4** |

反例：现状功能详情是 `<div class="kv">` 平铺（`sblock:0`），所有字段挤在一起，正是用户抱怨的"文案一行行挤在一起"。

### 12.6 使用指南步骤紧凑化

**依据（实测）**：每步**只有一行文字却隔 75px**。

```css
.cyd-app .steps li{position:relative;padding:0 0 12px 46px;min-height:30px}
.cyd-app .steps li::before{top:-4px}          /* 30px 圆圈与首行文字（21px）垂直居中 */
.cyd-app .steps li::after{top:34px;bottom:-4px}  /* 连接线接到下一枚圆圈的顶边 */
```

| 项 | 值 | 依据 |
|---|---|---|
| 步骤间距 | `padding-bottom:12px`（单行步骤总高 = `max(30,21) + 12 = 42px`） | 队长示例给的是 `16px`；**归一为节奏档 `12px`**（§5 只允许 6/8/12/18/24），理由：12 与 18 之间取 12 才真正解决"75px 太大"，且不与 §5 冲突 |
| 圆圈与文字对齐 | 圆圈 `30×30`、首行文字行高 `21px`（14×1.5）→ 圆心对首行中心 → 圆圈 `top:-4px` | 反例：现状 `top:1px` 时圆圈偏下 |
| 连接线 | `top:34px;bottom:-4px` | 必须跨过 12px 间隙接到下一步，否则圆点之间断线 |
| 圆圈尺寸 / 字号 | `30×30`、`12.5px` 不变 | §3.1 |

### 12.7 进度条细化到 4–6px

**依据（反例）**：截图里是全宽粗绿条，像"加载条"，与"进度只算人类验证过的"语义不匹配。

```css
.cyd-app .progress{height:5px;border-radius:999px;background:var(--chip);overflow:hidden;
  margin:4px 0 6px;position:relative}
.cyd-app .progress i{display:block;height:100%;background:var(--ok);border-radius:999px;
  transition:width .5s ease}
@media (prefers-reduced-motion: reduce){ .cyd-app .progress i{transition:none} }
```

| 项 | 值 | 依据 |
|---|---|---|
| 高度 | **`5px`**（允许区间 4–6px） | 降低视觉权重；反例：现状 `12px` 全宽 → 像加载条 |
| 颜色 | **纯 `--ok`**，去掉 `linear-gradient(--accent → --ok)` | 进度语义 = "人类亲手验证过的比例"，用 `--ok` 单色；渐变会让它看起来像"装饰" |
| 圆角 | `999px`（胶囊档） | §2 |
| 动效 | 保留 `transition:.5s`，`prefers-reduced-motion: reduce` 下关闭 | 无障碍硬要求 |
| 分段条 | **不采用** | 4–6px 细条已解决"视觉权重"问题，分段会引入新令牌与新逻辑 |

### 12.8 关系图：文字色与依赖边可见度下限

**依据（反例）**：现状一整片饱和绿字（节点文字用状态色），对比度低。

| 项 | 值 | 依据 |
|---|---|---|
| 节点文字色 | **`var(--ink)`**；`CORE` 里 `t.style.fill = SCOLOR[...]`（`CORE:790-793`、`809-818`、`836` 一带）**必须删除**，改 `t.style.fill = 'var(--ink)'`，CSS 兜底 `.cyd-app .node text{fill:var(--ink)}` | `--ink` 在白底约 13:1；反例：`--ok`（`#179a50`）在白底约 3.6:1，低于正文 4.5:1 |
| 状态色的允许用途（**仅这三处**） | ① 节点矩形描边 `stroke = SCOLOR`；② 节点左上圆点 `dot` 的 `fill = SCOLOR`；③ 状态徽章 `.badge.b-x{n}`（`SCOLOR`/`SSOFT`）；④ 子项矩形 `fill = SSOFT` | 状态色是"分类/状态"编码，不是文字色 |
| 依赖边可见度**下限** | 任何改造都不得突破：`stroke-width ≥ 1.4`、`opacity ≥ 0.6`、线色在白底对比度 **≥ 3:1**（图形元素下限） | 现状 `.edge{stroke:var(--gray);stroke-width:1.4;opacity:.45}` 等效对比度约 **1.5:1** → 不合格 |
| 批 2 生效值 | `.cyd-app .edge{stroke:var(--ink2);stroke-width:1.6;opacity:.7}`（等效对比度约 **3.1:1**）；窄栏同值，**不因窄栏而降透明度** | `--ink2` @ .7 达标；`--gray` @ .45 不可见 |

**与 `graph-visuals.md` 的关系**：`§C`（V2 渐变边）定的是 `stroke-width:1.6`、`opacity:.75`，**已满足本节下限**，无冲突；本节只补"文字色"这条它未规定的项（`graph-visuals §A4` 只规定矩形与连线的颜色）。

### 12.9 图标策略（控件位环境无关；白名单以 Edge 实测为下限）

> **本节的替换依据是"控件位不依赖 emoji 字体"这条环境无关性纪律，不是"本机渲染成方块"。**
> executor 已用两种独立方法实测（canvas 位图比对 + DOM 逐字符裁剪截图比对，并用 `U+FFFF` 自证方法有效，落档 `output/_probe/tofu.json` + `tofu_dom.json`）：**本机 Edge/Windows 下 41 个候选符号全部渲染出真字形**，包括实拍里曾看到方块的 `🔄📄⧉📋`。**未复现"方块"**——所以不能用"实测是方块"当替换理由。

| 位置 | 值 | 依据 |
|---|---|---|
| **控件位**（按钮、可点图标、tab 图标、复制键、发送/关闭/全屏、证据路径片） | **优先用单色内联 SVG 或纯文字**，`fill`/`stroke` 用 `currentColor`（跟随文字色）；尺寸：`.iconbtn` 内 `16×16`，行内小控件 `14×14`。**目的是不依赖 emoji 字体是否存在**（环境无关），不是"本机显示不出来" | 纪律本身即依据（见上方引用块）；`§6.2` 已定 `.iconbtn` 为内联 SVG |
| **可保留的语义 emoji**（**已实测可显示，按此保留**） | **tab**：`🏠🗺⚡⚖📖❓`；**图标按钮**：`⚙🕓🌓⛶✕`；**状态**：`✅⚠✓`；**其余**：`⏱`（上次采集）、`⏳`（待生效）、`🧩`（子项）、`🩺`（数据健康） | 实测结论 + 评审稿 3.2/§3/§8.2 的明文保留 |
| **已从白名单移出**（控件位已改 SVG/纯文字） | `🔄`（→ 纯文字 `更新`）、`📄`（→ 纯路径文字）、`⧉`（→ **内联 SVG 复制图标**）、`📋`（`生成指令：X` → 纯文字动词）、`📤`（`发送拍板`/`复制拍板` → 纯文字）；`🗑` 从未进入白名单 | 控件位纪律；清单与 `copy-deck.md §13.2` 逐字一致 |
| **文字位**（正文、说明、状态标记） | 只能用**「Edge 实测可渲染白名单」**里的符号；**白名单的唯一来源是 `copy-deck.md §13.2`**（本节不重复列符号，避免两处漂移） | 队长要求"白名单以 Edge 实测可渲染为下限" |
| 判定原则 | **"在 Edge 下能正常渲染"是入选白名单的最低条件**；离线网页可能被任何浏览器打开，一律按同一清单执行；任何新增符号必须先过 Edge 实测才允许登记 | 避免"只在 Edge 修、换个环境又变方块" |
| 若在其它机器/字体环境出现方块 | 控件位由上面的环境无关纪律已覆盖（SVG/纯文字）；文字位则从 `copy-deck.md §13.2` 白名单里移除该符号并补登记 | 纪律的兜底路径 |

### 12.10 头部 `.by` 与项目名重复时隐藏

| 项 | 值 | 依据 |
|---|---|---|
| 规则 | `project.name === 'control-your-development'` 时，**`.by` 不渲染**（`display:none` / 不输出）；其余项目名照常显示 | 反例：会出现 `control-your-development（由 control-your-development 生成）` |
| 实现位置 | `renderStrip()`（`CORE:555` 一带，`qs('#projName').firstChild.textContent = d.project.name + ' '`）同处同步切换 `.by` 的显隐 | 该函数是唯一写 `#projName` 的地方 |
| 字号 | 不变 `12.5px / --ink2`（§6.2） | §6.2 |

### 12.11 `.tag` 长文案两段式（不要撑成两行蓝块）

**依据（反例）**：`当前方向：<长文本>` 被塞进一个 `.tag`，长文案把蓝底标签撑成两行。

| 项 | 值 | 依据 |
|---|---|---|
| 结构 | **两段式**：标签 + 正文。`<p class="tagrow"><span class="tag">当前方向</span><span class="tagval">记账</span></p>` | 选两段式而不是 `ellipsis`：省略号会截断用户写的方向/下一步正文（**信息丢失**），标签词本身很短 |
| `.tag`（标签片） | 保留现值（`11px`、`--accent-soft` 底、`--accent` 字、`padding:2px 9px`、`rx 8`）＋ **`flex:none;white-space:nowrap;max-width:100%`** | 标签片永远单行、不被正文挤压 |
| `.tagrow` | `display:flex;align-items:baseline;gap:6px;margin:8px 0 0` | 节奏档 6/8；反例：现状 `.tag{margin:8px 8px 0 0}` 是"多个标签并排"的旧语义 |
| `.tagval`（正文） | `min-width:0;font-size:14px;line-height:1.7;color:var(--ink);overflow-wrap:anywhere` | 长正文在标签右侧正常折行，**不再有蓝底** |

`renderProject()`（`CORE:577-580`）的输出需从 `tags.map(t => '<span class="tag">' + '当前方向：' + t + '</span>')` 改为 `tagrow` 结构（标签词与正文分离；`当前方向` / `下一步` 留在 `.tag` 内）。

反例：现状 `.tag{display:inline-block}` 无 `max-width`、无 `nowrap` → 长文案变成两行蓝块，且同一行的"下一步"被挤到下一行。

### 12.12 证据路径胶囊窄栏：单行省略 + 复制键永不被裁（本轮实测）

> **本节只补「窄栏下的截断纪律」，不改任何既有结论**：`.ev`/`.evrow`/`.btn.mini` 的**现值与几何**（`margin-top:8px;gap:6px`、`gap:3px;margin-right:4px`、`padding:2px 9px`）不变，见上文 `CSS:118-130`、`CSS:70-78`（**行号是本节定稿时的现值；锚点是选择器名，行号会随他人注释漂移，引用前先用选择器 grep 一次**）；圆角仍走 §2 的**小件档 `8px`**（`.btn.mini`）。**全文不新增任何设计令牌、不新增字号档**（§1/§3/§9 纪律）。

**依据（本轮实测）**：证据在面板里渲染成分支 ①（`button.btn.mini`，`CORE:1106`），继承 `.btn{white-space:nowrap}`（`CSS:71`）⇒ **胶囊最小宽度 = 整条路径**；`.evrow` 是 `inline-flex`（`CSS:127`）且 flex 子项 `min-width:auto` 不可收缩 ⇒ 容器窄于「胶囊 + 复制键」自然宽度时**复制键被挤出卡片**——容器 **404px 首次溢出**，**380px 时最大溢出 68.8px**（3 个复制键全部出框）。离线网页走分支 ②（`<a>`，无 `nowrap`，**修前**会折行）⇒ **260–520px 全程 0 溢出**——但**该分支**在收窄时**既不省略也不越界**（`<a>` 折行），故它**不是**"本条修好了"的证据；**一旦给 `.evtxt` 上了 `white-space:nowrap` 却没给 `display:block`，分支 ② 立刻从"折行"翻转为"不省略 + 文字越界"**（见下行 `.evtxt` 的依据栏），**所以两端必须同版一起改**；分支 ③（`.miss`，无独立复制键）同为 `<a>`、同理；**分支 ④（整片可点、无独立复制键）仍要进**——它是 `.btn.mini{white-space:nowrap}`，路径片会被撑出卡片，只是"出框的是路径片本身、不是复制键"。**这就是此前门禁全绿却漏掉它的原因：只有面板分支会溢出，而离线分支永远不会。**

| 项 | 定稿（逐字规则） | 依据 |
|---|---|---|
| **HTML 结构（硬要求）** | 路径文字**必须**包一层 `<span class="evtxt">`（**四个分支都要包**）。**有复制键的两个分支（①/②）统一到同一形态**：`<span class="evrow"><button class="btn mini" data-ev="…" title="…（点击打开）"><span class="evtxt">…（disp）…</span></button><button class="btn mini evcp" data-cp="…" title="复制完整路径">…（COPY_ICON）…</button></span>`（**复制键只增 `.evcp` 类名，`btn mini` 保留不删**）；分支 ③（`<a class="miss">`，无复制键）与分支 ④（整片可点、无独立复制键）同样只把 `disp` 包进 `.evtxt`，且**分支 ④ 的路径片绝不可加 `.evcp`**——它本身就是路径片，加上去等于重新锁死 | `text-overflow:ellipsis` **只在块级/可收缩的子元素上生效**；flex 容器里的**匿名文本项**不可收缩 ⇒ 不包 `.evtxt` 就永远看到硬截断而没有 `…`。**`.evtxt` 必须同时吃到 `display:block`**（见下行）：`.btn.mini` 的几何（`padding:2px 9px` 等，`CSS:78`）**不反映子元素的 `display`**，**只量外层胶囊的盒不可能发现行内导致的失效**，判据只能是"是否真省略" |
| `.evrow` | `.cyd-app .evrow{max-width:100%}`（保留 `display:inline-flex;align-items:center;gap:3px;margin-right:4px`） | 行自身不许超过 `.ev` 内容盒；`.ev` 有 `flex-wrap:wrap`，`.evrow` 作为 flex 项**基础宽度即自然宽度**，必须显式封顶 |
| 路径胶囊（分支 ①/④ 的 `button.btn.mini`，分支 ② 的 `a`） | `.cyd-app .evrow>button, .cyd-app .evrow>a{min-width:0}`（用 `>` 子选择器，**不要用后代选择器**：它会连带命中行内的复制键） | `min-width:auto` 是 flex 项不可收缩的成因；该值**按元素解析、不继承** ⇒ 复制键不会因此被压小 |
| `.evtxt`（路径文本，**与 §12.1 的 `.vtxt` 同款职责**） | `.cyd-app .evtxt{display:block;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}`（证据路径专用类名，**不复用** `.vtxt`；**与 `.vtxt` 只差 `display:block` 一项，而这一项必须有**，理由见右栏；**`flex:none` 不在本行**，由下面「复制键」那一行的 `.evcp` 负责） | `.evtxt` **恒为 `<span>`，`display` 由父级决定**：分支 ①/④ 的父级是 `button.btn.mini`，而 `.btn{display:inline-flex}`（`CSS:71`）⇒ `.evtxt` 是 **flex 项、本就块化**，`display:block` 对它们**零副作用**（实测两变体数字逐位相同）；**分支 ②/③ 的父级是 `<a>`，`.evtxt` 是其中的普通行内子元素 ⇒ `display:inline` ⇒ `overflow:hidden` / `text-overflow:ellipsis` 对行内盒不生效 ⇒ 不省略、文字直接画到卡片外**。**队长实测**（真机 Edge 380px、同一份真实渲染产物、只切这一条声明）：**无 `display:block`** ⇒ 文字越出卡片右边界（`.dsh/skills/control-your-development/SI` 之后仍有字符飘在框外）、**真发生省略的行 0/3**；**有 `display:block`** ⇒ 路径以 `…` 结束、完整在框内、**3/3**（两张截图 sha 不同：`output/_probe/evtxt-380-withblock.png` `45EC9174…` / `evtxt-380-withoutblock.png` `FD659E0B…`）。**§12.1 的 `.vtxt` 为什么不需要这一条**：它的父级 `.pill .v` 是 `-webkit-box`（宽栏，`CSS:61`）/ `flex`（窄栏，`CSS:433`），`.vtxt` 在两种形态下**都是 flex 项、天然块化**；而 `.evtxt` 在 `<a>` 里不是——**这正是"同款职责"必须差一项的地方，不要照抄 `.vtxt` 的声明串**。另：**不要给证据片套用 `.vtxt`**（§12.1 的选择器带 `.pill .v` 前缀，套用会失效） |
| 复制键 | **必须用专属类名**：`.cyd-app .evrow>.evcp{flex:none}`（HTML 侧写 `class="btn mini evcp"`，见上行）。**不得用 `.btn.mini` / `[data-cp]` / `[data-ev]` / `:last-child` 当「复制键」判据**：**分支 ①/④ 的路径片本身也是 `.btn.mini`**（`CORE:1106`、`CORE:1109`），`[data-cp]` 还同时落在**分支 ④ 的路径片**上（它是「点整片即复制」，`CORE:1109`）、`[data-ev]` 只覆盖分支 ①，`:last-child` 在分支 ④ 上只有单个子元素同样失效——**用它们都会把路径片一起锁死，复制键照样出框** | `.btn` 现值**未设 `flex-shrink`**，默认 `1` ⇒ 收窄时复制键（含内联 SVG）被压到 0 宽而"看不见"；**`flex:none` = 不可收缩、不可拉伸，永不被裁**。**队长实测对照**（同一 HTML、容器内容宽 **201px**、路径 `projects/dsh-plugin-control-your-development/evals/22-v0.5验收记录.md`）：按本节逐字但复制键改用 `.btn.mini` 当判据 ⇒ **复制键出界 227.8px**、路径片 `flex-shrink:0`（被锁死）**✗ 修复失效**；改用专属类名 `.evcp` ⇒ **复制键出界 0**、路径片 `flex-shrink:1`、省略量 228px（**真省略**）**✓**。**同族教训（屏幕/打印共用一条判据）**：`data-cp` 是**值属性**、分支 ④ 的路径片也带它 ⇒ **凡"按 `data-cp` 认复制键"的规则都会误伤**：**屏幕收缩规则（`.evcp`）与打印隐藏规则（`.evcp`，见下行）必须用同一个判据**，一处用类名、一处用属性必然再漂一次 |
| 悬停看全文 | 路径胶囊的 `title` 用**完整路径 `full`**（沿用现值，全量加、不判断是否截断）；在线分支格式 `full + '（点击打开）'` / `full + '（在浏览器中打开）'` / `full + '（点击复制完整路径）'`，不存在分支 `full + '（路径不存在）'`；复制键 `title="复制完整路径"`，且它**带 `data-cp="<完整路径>"`**（`CORE:1103`）——**但 `[data-cp]` 不能当复制键判据**：**分支 ④ 的路径片本身也带 `data-cp`**（`CORE:1109`） | 与 §12.1「值元素加 `title`（全量，不做截断判断）」同一纪律；`data-cp` 是**值**属性（携带完整路径供复制），不是**身份**标记（区分复制键 vs 路径片），两者不可混用。**但 `data-cp` 属性本身必须保留、不得删除**：`CORE:3094` 的点击处理器靠 `e.target.closest('[data-cp]')` 取复制值工作——**要改的是"谁算复制键"的判据（改用 `.evcp` 类名），不是删掉这个属性** |
| **硬要求（与 §12.1 同款纪律，此处不重述）** | **宁可路径显示为 `…`（甚至整片只剩 `…`），也不能让复制键出框、消失或被压成 0 宽。** | 与 §12.1 的「宁可日期显示为 `…`，也不能让按钮消失」**同款复用**：都是「信息可省略，操作不可丢」 |
| 打印例外（**恢复折行**） | `@media print{ .cyd-app .evrow{max-width:none} .cyd-app .evrow>button, .cyd-app .evrow>a{min-width:auto} .cyd-app .evtxt, .cyd-app .evrow>.evcp{white-space:normal;overflow:visible;text-overflow:clip;flex:none} }` 放进 **`CSS:454` 起的那一个 `@media print` 块**（不要新开块），**用类名精确覆盖、不要用 `*`**（`*` 会把「不该重置」的弹性/溢出一并清掉）。**这里指代复制键一律用 `.evcp`，不得退回 `.btn.mini`**。**`.evtxt` 的 `display:block` 在这里保留、不得重置为 `inline`**：该段只改 `white-space`/`overflow`/`text-overflow`/`flex`，**不碰 `display`** ⇒ `block` 继续生效；而 `display:block` 与 `white-space:normal` **天然兼容**（块级 + 正常换行 = 折行），**若这里把 `display` 重置掉，分支 ②/③ 会退回行内、`white-space:normal` 反而失效**。**本行只负责"折行"；"哪些元素在纸面上被隐藏"是另一件事，判据见下一行** | 纸面没有悬停，`…` 之后拿不到全文 ⇒ **恢复折行**；同时保住 §12.8 的 `overflow:visible`（SVG）与 `.ev` 的 `flex-wrap:wrap` |
| 打印例外（**隐藏判据**） | 打印隐藏清单（`CSS:457`）里**必须用 `.cyd-app .evcp`，不得用 `.cyd-app .btn[data-cp]`**：把现值的 `.cyd-app .btn[data-cp]` **替换**为 `.cyd-app .evcp`。**理由**：`CSS:457` 的 `.btn[data-cp]` 会命中**分支 ④ 的路径片本身**（`<button class="btn mini" data-cp="路径">`，`CORE:1109`，整片即复制）⇒ **纸面上该分支的路径整条消失**。**队长实测**（构造了真正走分支 ④ 的页面 `output/_probe/branch4.html`）：**screen 隐藏路径片 0 个；print 隐藏 143 个**。这是**既有缺陷**（修前 `HEAD` 用 `.min[data-cp]` 同样隐藏），**本轮改动未引入**，但本节此前把「路径打印完整」写成了现状——**那是目标形态，不是当时的事实**。改用 `.evcp` 后：**复制键仍被隐藏、分支 ④ 的路径片恢复打印** | **屏幕收缩判据与打印隐藏判据必须是同一个（`.evcp`），不要一处用类名、一处用属性**——二者都回答"哪个元素是复制键"这同一个问题，判据分叉必然再漂一次。**`.btn[data-cp]` 只对分支 ①/② 的复制键"碰巧正确"，对分支 ④ 就是把路径片当复制键隐藏掉** |

**前端配套要求（不在本 CSS 范围内，但缺了 CSS 会失效）**：`.evtxt` 里放的是**已渲染的 `disp`**（现值 `esc(truncMid(e.path))`，`CORE:1101`，默认 46 字符）。`truncMid` 是**字符数**中间省略（保住首尾辨识度），CSS 省略号是**像素**省略；两者叠加安全（都是「更短」），但 **`title` 必须始终是 `full` 原文**——否则悬停看全文失效。

**验收（可对账）**：
1. **数值**：面板分支在容器 **404px 首次溢出**、**380px 最大溢出 68.8px**、3 个复制键出框（修前）；修后同两档溢出**均回 0**，且 `.evrow` 内复制键的 `getBoundingClientRect().right` **≤ 卡片内容盒右边界**。
1b. **收缩方向反了的判据（必须单列一条，否则上面那条会假绿）**：路径片的 `flex-shrink` 必须为 **1**、复制键（`.evcp`）为 **0**；**仅"溢出 = 0"不足以判定通过**——用 `.btn.mini` 当复制键判据时，整行被锁死、溢出量与形态都不变，**唯一能区分"锁死"与"真省略"的是这个 shrink 值对**（队长实测：锁死态路径片 `flex-shrink=0` / 出界 227.8px；正确态路径片 `flex-shrink=1` / 省略量 228px）。**只断言几何溢出、不断言收缩方向 = 空绿。**
1c. **"是否真的发生了省略"（唯一能看见 `display:inline` 的判据）**：窄栏下每个证据行必须满足 **`evtxt.scrollWidth > evtxt.clientWidth`**，计数应为 **N/N**（380px 实测：无 `display:block` 时 **0/3**、有则 **3/3**）。**这条不能省**：`display:inline` 的文本**会画出自己的盒子而不撑大任何元素 rect** ⇒ `rowOver` / `pillOver` 一类**几何溢出断言全为 0、看不见它**（队长实测：其 rect 断言与 Range 断言都没抓到，只有截图抓到）——**只测几何溢出、不测"真省略"，越界与不省略会一起假绿。**
2. **形态**：窄栏截图里路径完整且**以 `…` 结尾**、复制键图标完整可见；**图 ↔ 断言可对账**（截图所用视口/容器档位必须在断言里有同名条目），不许用手工拖动后的任意状态当验收图。
3. **离线**：**260–520px 全程 0 溢出**（分支 ② 本就折行，不得因本次改动回归）。
4. **打印**：`@media print` 下路径**折行、不被截断**；且**隐藏判据逐项对账**：分支 ④ 的路径片（`button.btn.mini[data-cp]`）**`display ≠ none`、可见**，复制键 `.evcp` **隐藏**。**必须有这一条**：现值 `CSS:457` 的 `.btn[data-cp]` 会把分支 ④ 路径片整片隐藏（实测 screen 隐藏 0 / print 隐藏 143）⇒ **只测"折行"的打印断言会漏掉"整条消失"**（一个还看得见、一个已经没了，两者的 `white-space` 都对）。
5. 截图须**晚于最后一次代码改动**，且 `sha256` 与上一版不同（时间戳只是必要条件）。

**反例**：**打印隐藏用 `.btn[data-cp]` ⇒ 分支 ④ 的路径片被整片隐藏、纸面上路径消失（实测 print 隐藏 143 个、screen 0 个）**；**漏 `display:block` ⇒ 分支 ②/③（`<a>`）的 `.evtxt` 是行内元素、`text-overflow` 不生效：不省略、文字直接画到卡片外，而几何溢出断言全为 0 ⇒ 假绿**；**用 `.btn.mini`（或 `[data-cp]` / `[data-ev]` / `:last-child`）当复制键判据 ⇒ 路径片一起被锁死、复制键照样出框（实测出界 227.8px）**；只给 `.evrow{max-width:100%}` 而不给路径片 `min-width:0` ⇒ `.evrow` 虽封顶，但胶囊仍以自然宽度撑开，**复制键照样出框**（只是溢出量变小）；只给 `.evtxt` 而不包结构 ⇒ **没有 `…` 的硬截断**；漏掉 `flex:none`（没给 `.evcp`） ⇒ 复制键被压成 0 宽，看起来"消失"。

