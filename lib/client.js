// dsh-plugin-control-your-development 浏览器端源文件（构建：tools/build_panel.py 注入共享渲染核）
// 视图 = skill 模板 dashboard.core.js（与网页版完全一致）；本文件只负责宿主接线。
window.__ModuleLoader__.load({
  id: 'dsh-plugin-control-your-development',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    const react = require('react');
    const h = react.createElement;

/* control-your-development 仪表盘共享渲染核：网页版（双击 html 离线打开）与 DSH 面板共用。
     宿主经 env 注入能力：reload（重读数据）/ verifyWrite（写回验证）/ evidenceUrl（证据链接）/ capabilityNote / browserTab。 */
window.CYD = (function(){
const CSS = "/* control-your-development 仪表盘样式（面板与离线网页共用的唯一渲染核）。\n   全部规则必须挂在 .cyd-app 作用域下 —— 这份样式会被面板注入 DSH 宿主页面（render_dashboard.py 自检会拦未作用域选择器）。\n   令牌与组件规格见 references/design-tokens.md；改这里等于同时改面板与离线网页。 */\n.cyd-app{\n  --bg:#f4f6fa; --panel:#ffffff; --ink:#1b2331; --ink2:#5b6575; --line:#e4e8f0;\n  --accent:#2f6fed; --accent-soft:#e8effe; --ok:#179a50; --ok-soft:#e5f6ec; --on-solid:#fff;\n  --warn:#c07f00; --warn-soft:#fdf3e0; --gray:#8a93a3; --gray-soft:#eef1f6;\n  --chip:#eef2f8;\n  --shadow-card:0 1px 2px rgba(22,32,52,.05),0 4px 14px rgba(22,32,52,.06);\n  --shadow-pop:0 10px 30px rgba(22,32,52,.18);\n  --radius:16px;\n}\n@media (prefers-color-scheme: dark){/* 系统深色：只在没有 data-theme 时兜底（主题的唯一来源是 data-theme） */\n.cyd-app{\n  --bg:#13161c; --panel:#1c212b; --ink:#e7ebf3; --ink2:#9aa4b5; --line:#2b3240;\n  --accent:#6f9dff; --accent-soft:#22304d; --ok:#4ecb7f; --ok-soft:#173325; --on-solid:#13161c;\n  --warn:#e0a63c; --warn-soft:#3a2d14; --gray:#8a93a3; --gray-soft:#262d3a;\n  --chip:#252c39;\n  --shadow-card:0 1px 2px rgba(0,0,0,.35),0 4px 14px rgba(0,0,0,.3);\n  --shadow-pop:0 10px 30px rgba(0,0,0,.5);\n}}\n.cyd-app[data-theme=\"light\"]{\n  --bg:#f4f6fa; --panel:#fff; --ink:#1b2331; --ink2:#5b6575; --line:#e4e8f0;\n  --accent:#2f6fed; --accent-soft:#e8effe; --ok:#179a50; --ok-soft:#e5f6ec; --warn:#c07f00;\n  --warn-soft:#fdf3e0; --gray:#8a93a3; --gray-soft:#eef1f6; --on-solid:#fff; --chip:#eef2f8;\n  --shadow-card:0 1px 2px rgba(22,32,52,.05),0 4px 14px rgba(22,32,52,.06);\n  --shadow-pop:0 10px 30px rgba(22,32,52,.18);\n}\n.cyd-app[data-theme=\"dark\"]{\n  --bg:#13161c; --panel:#1c212b; --ink:#e7ebf3; --ink2:#9aa4b5; --line:#2b3240;\n  --accent:#6f9dff; --accent-soft:#22304d; --ok:#4ecb7f; --ok-soft:#173325; --warn:#e0a63c;\n  --warn-soft:#3a2d14; --gray:#8a93a3; --gray-soft:#262d3a; --on-solid:#13161c; --chip:#252c39;\n  --shadow-card:0 1px 2px rgba(0,0,0,.35),0 4px 14px rgba(0,0,0,.3);\n  --shadow-pop:0 10px 30px rgba(0,0,0,.5);\n}\n.cyd-app *{box-sizing:border-box}\n.cyd-app{scroll-behavior:smooth}\n.cyd-app :focus-visible, .cyd-app:focus-visible{outline:2px solid var(--accent) !important;outline-offset:2px}.cyd-app :focus:not(:focus-visible), .cyd-app:focus:not(:focus-visible){outline:0}\n.cyd-app{margin:0;background:var(--bg);color:var(--ink);font:14px/1.7 -apple-system,\"Segoe UI\",\"PingFang SC\",\"Microsoft YaHei\",sans-serif;-webkit-font-smoothing:antialiased}\n.cyd-app .wrap{max-width:1120px;margin:0 auto;padding:24px 24px 48px}\n\n/* ---------- 头部：.brand 左 + .topacts 右（两段结构） ---------- */\n.cyd-app header.top{display:flex;align-items:center;gap:12px;flex-wrap:wrap}\n.cyd-app .brand{display:flex;align-items:baseline;min-width:0}\n.cyd-app .brand h1{font-size:21px;margin:0;letter-spacing:.2px}\n.cyd-app .brand .by{font-size:12.5px;color:var(--ink2);font-weight:400;margin-left:10px}\n.cyd-app .topacts{display:flex;align-items:center;gap:6px;margin-left:auto}\n.cyd-app .iconbtn{width:32px;height:32px;display:inline-flex;align-items:center;justify-content:center;border:1px solid var(--line);border-radius:10px;background:transparent;color:var(--ink2);font-size:16px;line-height:1;padding:0;cursor:pointer;transition:.15s}\n.cyd-app .iconbtn:hover{border-color:var(--accent);color:var(--accent)}\n.cyd-app .iconbtn:focus-visible{outline:2px solid var(--accent);outline-offset:2px}\n.cyd-app .iconbtn[aria-pressed=\"true\"]{background:var(--accent-soft);border-color:var(--accent);color:var(--accent)}\n\n/* ---------- 掌控条（徽章，全部可点） ----------\n   pill 高度**固定且一致**（用户裁定）：值超 2 行用 … 省略、完整原文进 title；单个 pill 永远撑不高整条。 */\n.cyd-app .strip{display:flex;gap:8px;margin:18px 0 6px;flex-wrap:wrap;align-items:stretch}\n.cyd-app .pill{flex:1;min-width:132px;height:88px;display:flex;flex-direction:column;justify-content:center;background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:8px 12px;box-shadow:var(--shadow-card);text-align:center;cursor:pointer;font:inherit;color:var(--ink)}\n.cyd-app .pill:hover{border-color:var(--accent)}\n.cyd-app .pill.static{cursor:default}\n.cyd-app .pill.static:hover{border-color:var(--line)}\n.cyd-app .pill .k{font-size:12.5px;line-height:1.4;color:var(--ink2);letter-spacing:.4px}\n.cyd-app .pill .v{font-size:16px;line-height:1.3;font-weight:650;color:var(--ink);margin-top:2px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}\n.cyd-app .pill .v .btn.mini{font-size:12.5px;line-height:1.4}\n.cyd-app .pill.alert{border-color:color-mix(in srgb,var(--warn) 55%,var(--line));background:var(--warn-soft)}\n/* ⏳ 待生效 N 条（v1.5）：底色/边框同 .pill.alert；class 与 ok 无关，只表示\"有待生效的条目\" */\n.cyd-app .pill.pending{border-color:color-mix(in srgb,var(--warn) 55%,var(--line));background:var(--warn-soft)}\n.cyd-app .pill.good{border-color:color-mix(in srgb,var(--ok) 45%,var(--line));background:var(--ok-soft)}\n.cyd-app .lk{color:var(--accent);cursor:pointer;border-bottom:1px dashed color-mix(in srgb,var(--accent) 45%,transparent)}\n.cyd-app .lk:hover{border-bottom-style:solid}\n\n/* ---------- 按钮：唯一一套 .btn / .btn.primary / .btn.mini ---------- */\n.cyd-app .btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;border:1px solid var(--line);background:var(--panel);color:var(--ink);border-radius:10px;padding:6px 12px;font:inherit;font-size:14px;line-height:1.4;font-weight:400;cursor:pointer;white-space:nowrap;transition:.15s}\n.cyd-app .btn:hover{border-color:var(--accent);color:var(--accent)}\n.cyd-app .btn:active{transform:translateY(1px)}\n.cyd-app .btn:disabled{opacity:.55;cursor:default;transform:none}\n.cyd-app .btn.primary{border-color:var(--accent);background:var(--accent);color:var(--on-solid);font-weight:600;box-shadow:var(--shadow-card)}\n.cyd-app .btn.primary:hover{filter:brightness(1.06);color:var(--on-solid)}\n.cyd-app .btn.primary:disabled{opacity:.55;box-shadow:none;filter:none;cursor:default}\n.cyd-app .btn.mini{padding:2px 9px;font-size:12.5px;border-radius:8px}\n\n/* ---------- Tab ---------- */\n.cyd-app nav.tabs{display:flex;gap:8px;margin-top:14px;flex-wrap:wrap}\n.cyd-app nav.tabs button{border:1px solid var(--line);background:var(--panel);color:var(--ink2);padding:8px 18px;border-radius:999px;cursor:pointer;font-size:14px;transition:.15s;box-shadow:var(--shadow-card)}\n.cyd-app nav.tabs button:hover{color:var(--ink);transform:translateY(-1px)}\n.cyd-app nav.tabs button.on{background:var(--accent);border-color:var(--accent);color:var(--on-solid);font-weight:600}\n.cyd-app section{display:none;margin-top:20px}\n.cyd-app section.on{display:block;animation:fade .25s ease}\n@keyframes fade{from{opacity:0;transform:translateY(4px)}to{opacity:1}}\n\n/* ---------- 卡片与通用文本 ---------- */\n.cyd-app .card{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);padding:18px 24px;box-shadow:var(--shadow-card);margin-bottom:12px}\n.cyd-app .card.flash{outline:2px solid var(--accent);outline-offset:2px}\n.cyd-app .card h3{margin:0 0 8px;font-size:16px;letter-spacing:.2px}\n.cyd-app .muted{color:var(--ink2);font-size:12.5px}\n/* `.kv` 标签列默认 5em（design-tokens §12.3）；「上游依赖功能」「下游依赖功能」是 6 个字，会在\n   `上游依赖功` / `能` 处折成两行。**只给这两行**放宽标签列（`max-content`）并禁止折行 ——\n   不动全局 `.kv`，避免把其它 5em 行的对齐一起改掉。 */\n.cyd-app .kv.kvwide{grid-template-columns:max-content 1fr}\n.cyd-app .kv.kvwide>b{white-space:nowrap}\n.cyd-app .lede{font-size:14px;margin:4px 0 0;white-space:pre-line}\n.cyd-app .snote{color:var(--ink2);font-size:12.5px;line-height:1.6;border-left:3px solid var(--line);padding-left:8px;margin:6px 0 0}\n/* 当前方向/下一步：标签片 + 正文两段式（长正文不再把蓝底撑成两行） */\n.cyd-app .tagrow{display:flex;align-items:baseline;gap:6px;margin:8px 0 0}\n.cyd-app .tag{flex:none;white-space:nowrap;max-width:100%;background:var(--accent-soft);color:var(--accent);border-radius:8px;font-size:11px;padding:2px 9px;font-weight:600}\n.cyd-app .tagval{min-width:0;font-size:14px;line-height:1.7;color:var(--ink);overflow-wrap:anywhere}\n.cyd-app .empty{border:1px dashed var(--line);border-radius:var(--radius);padding:24px;text-align:center;color:var(--ink2);font-size:14px;line-height:1.7;margin-bottom:12px}\n.cyd-app .dhint{font-size:12.5px;color:var(--ink2);margin:8px 0 0}\n\n/* ---------- 使用指南 ---------- */\n/* 步骤紧凑化：单行步骤总高 = max(30,21) + 12 = 42px（圆点与首行文字垂直居中，连线跨过间隙） */\n.cyd-app .steps{margin:12px 0 0;padding:0;list-style:none}\n.cyd-app .steps li{position:relative;padding:0 0 12px 46px;min-height:30px}\n.cyd-app .steps li::before{content:attr(data-n);position:absolute;left:0;top:-4px;width:30px;height:30px;border-radius:50%;background:var(--accent-soft);color:var(--accent);display:flex;align-items:center;justify-content:center;font-size:12.5px;font-weight:700;border:1.5px solid color-mix(in srgb,var(--accent) 35%,transparent)}\n.cyd-app .steps li::after{content:\"\";position:absolute;left:14px;top:34px;bottom:-4px;width:2px;background:var(--line);border-radius:2px}\n.cyd-app .steps li:last-child::after{display:none}\n.cyd-app .steps b{font-size:14px}\n\n/* ---------- 证据 ---------- */\n.cyd-app .ev{margin-top:8px;display:flex;flex-wrap:wrap;gap:6px}\n.cyd-app .ev a, .cyd-app .ev button{font-size:12.5px;background:var(--chip);border:1px solid var(--line);border-radius:8px;padding:3px 10px;color:var(--ink2);text-decoration:none;cursor:pointer;transition:.15s}\n.cyd-app .ev a:hover, .cyd-app .ev button:hover{border-color:var(--accent);color:var(--accent)}\n.cyd-app .ev a.miss{border-color:color-mix(in srgb,var(--warn) 60%,var(--line));color:var(--warn)}\n.cyd-app .evrow{display:inline-flex;align-items:center;gap:3px;margin-right:4px}\n\n/* ---------- 功能地图 ---------- */\n.cyd-app .filters{display:flex;gap:8px;flex-wrap:wrap;margin:2px 0 14px}\n.cyd-app .filters button{border:1px solid var(--line);background:var(--panel);color:var(--ink2);border-radius:999px;padding:5px 14px;font-size:12.5px;cursor:pointer;transition:.15s}\n.cyd-app .filters button.on{background:var(--ink);color:var(--bg);border-color:var(--ink);font-weight:600}\n/* 进度条：细化为 5px 单色 --ok（语义 = 人类亲手验证过的比例，不是\"加载条\"） */\n.cyd-app .progress{height:5px;border-radius:999px;background:var(--chip);overflow:hidden;margin:4px 0 6px;position:relative}\n.cyd-app .progress i{display:block;height:100%;background:var(--ok);border-radius:999px;transition:width .5s ease}\n@media (prefers-reduced-motion: reduce){ .cyd-app .progress i{transition:none} }\n.cyd-app .plabel{font-size:12.5px;color:var(--ink2);margin-bottom:18px}\n.cyd-app .plabel p{margin:0}\n.cyd-app .graphbox{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow-card);margin-bottom:18px;overflow:hidden;position:relative;user-select:none}\n.cyd-app .graphbox .ghead{display:flex;justify-content:space-between;align-items:center;padding:12px 18px;border-bottom:1px solid var(--line)}\n.cyd-app .graphbox .ghead b{font-size:16px}\n.cyd-app .graphbox .ghead span{font-size:12.5px;color:var(--ink2)}\n.cyd-app .gtools{float:right;display:inline-flex;gap:4px}\n/* 技术空态：真的渲染出来的提示块（有标题 + 可执行的下一步），不是禁用控件 */\n.cyd-app .tech-empty{margin:24px auto 0;max-width:520px;padding:16px 18px;border:1px solid var(--line);border-radius:12px;background:var(--panel)}\n.cyd-app .tech-empty b{display:block;font-size:14px;margin-bottom:6px}\n.cyd-app .tech-empty p{margin:4px 0 0;color:var(--ink2);font-size:12.5px;line-height:1.7}\n.cyd-app .gtools button{border:1px solid var(--line);background:var(--panel);color:var(--ink);border-radius:8px;padding:1px 9px;cursor:pointer;font-size:12.5px}\n.cyd-app .gtools button:hover{border-color:var(--accent);color:var(--accent)}\n.cyd-app .legend{display:flex;gap:16px;flex-wrap:wrap;padding:9px 18px;border-bottom:1px solid var(--line);font-size:12.5px;color:var(--ink2)}\n.cyd-app .legend i{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:5px;vertical-align:-1px}\n.cyd-app .legend i.x1{background:var(--gray)}\n/* 整页视图的「查看详情」：实心 accent 主按钮（点它 = 退出整页 + 在右侧边栏打开完整仪表盘） */\n.cyd-app .gtools .viewdetail{border:1px solid var(--accent);background:var(--accent);color:#fff;font:inherit;font-size:12.5px;font-weight:600;padding:3px 10px;border-radius:999px;cursor:pointer}\n.cyd-app .gtools .viewdetail:hover{filter:brightness(1.06)}\n/* S3 陈旧信号的「标题旁 ⚠」（契约 L563：陈旧必须比正确更显眼）。只在技术视图 + tech_stale 非空时渲染，\n   悬停 title 给出失效模块名 —— 与图例下那条 .snote 同一条信号的两个可见落点。 */\n.cyd-app .ghead .warnmark{color:var(--warn);margin-left:4px;cursor:help}\n/* ---------- 整页「功能地图」里隐藏宿主的输入框座席（用户要求；队长 2026-10-13 批准） ----------\n   机制照抄第三方插件 dsh-context v0.69.1 的做法：它的 `.lc-root` 对应我们的 `.cyd-immersive`。\n   标记**只挂在我们自己渲染的根上**，靠宿主两个属性名 `data-conversation-scroll` /\n   `data-composer-seat` 用 :has() 声明式隐藏；**不去改宿主的结构与样式**（不改宿主元素，只让它在\n   这一层不显示）。dsh-context 原文（`dsh-context/lib/client.js` offset 318578）：\n     [data-conversation-scroll]:has(.lc-root)>[data-composer-seat]:not(:has([data-approval-key],\n       [data-question-key],[data-plan-review-key])),[data-conversation-scroll]:has(.lc-root,\n       .lc-modal-backdrop)~[data-width-handle]{display:none}\n   **风险留痕**：这是宿主内部 DOM 约定，**不是官方支持的 API**；宿主若改这两个属性名即失效\n   （失效方向是安全的：输入框照旧显示，不会出现「打不了字」）。同一个风险由 dsh-context 在生产里\n   承担着 —— 属生态事实标准，不是我们的发明。\n   **三个例外必须保留**（照抄）：有待审批 / 待回答 / 待复核计划时输入框要留着，\n   否则会出现「审批要打字却没有输入框」——这是这条 CSS 最容易埋的坑。 */\n[data-conversation-scroll]:has(.cyd-immersive)>[data-composer-seat]:not(:has([data-approval-key],[data-question-key],[data-plan-review-key])){display:none}\n/* 第二条（照抄 dsh-context）：隐藏宿主的正文宽度拖拽条。**先实测确认它确实碍事才加**：\n   2026-10-13 真机（1680×1400、整页地图）实测两条 `[data-width-handle]` 为 10×1324、`cursor:col-resize`，\n   中心点 x=503 / x=1457 **落在我们 graphbox（292–1661）之内**，且 `document.elementFromPoint` 命中的是\n   拖拽条本身（不是我们的画布）⇒ 在地图中间横向拖动会**被宿主拿去改正文列宽**，而不是平移地图 ⇒ 必须隐藏。 */\n[data-conversation-scroll]:has(.cyd-immersive)~[data-width-handle]{display:none}\n.cyd-app .legend i.x2{background:var(--accent)}\n.cyd-app .legend i.x3{background:var(--warn)}\n.cyd-app .legend i.x4{background:var(--ok)}\n.cyd-app .legend .lgsub{margin-left:auto}\n/* 「功能 | 技术」切换（§F1）：放 ghead 内、缩放控件左侧；margin-left:auto 把它和标题推开。\n   这里**显式**写 flex:0 0 auto 与 width:max-content：整页视图里另有一条给标题/提示用的\n   省略号规则会把 ghead 内的 span 拉满，而本切换条也是 span（实测整页 387 vs 按钮和 99；\n   侧栏面板没有那条规则 ⇒ 101/99 贴合）⇒ 两处视图行为不同，基础规则里钉死它。 */\n.cyd-app .viewswitch{display:inline-flex;flex:0 0 auto;width:max-content;margin-left:auto;border:1px solid var(--line);border-radius:999px;overflow:hidden}\n.cyd-app .viewswitch button{border:0;background:transparent;color:var(--ink2);font:inherit;font-size:12.5px;padding:3px 12px;cursor:pointer}\n.cyd-app .viewswitch button + button{border-left:1px solid var(--line)}\n.cyd-app .viewswitch button.on{background:var(--accent-soft);color:var(--accent);font-weight:600}\n/* 技术图：层带（弱底 --chip + 文字标签，**不用彩色**，§F2）+ 边上关系文字（§F3） */\n.cyd-app .layerband{stroke:var(--line);stroke-width:.5;opacity:.3}\n.cyd-app .layerlabel{fill:var(--ink2);font-size:11px;font-weight:500}\n/* （原\"边标签\"那条样式已删：2026-10-13 用户裁决\"线上什么都别标\" ⇒ 标签层整体移除，\n   关系名改到边自身的 title 元素（悬停可见、不占视觉）。单一执行路径：样式/生成/测量一起删，\n   不留\"生成但隐藏\" ✗。**本注释不写点号选择器**——自检会把它当未作用域选择器报红，本轮实测踩过 ✗） */\n.cyd-app .graphbox svg{display:block;width:100%;height:340px;cursor:grab;touch-action:none}\n.cyd-app .graphbox svg:active{cursor:grabbing}.cyd-app .graphbox svg.is-dragging{cursor:grabbing}.cyd-app .graphbox svg g.node{outline:0}\n.cyd-app .node{cursor:pointer}\n.cyd-app .node rect{stroke-width:1;transition:.15s}\n.cyd-app .node:hover rect{filter:brightness(1.05)}\n.cyd-app .node text{font-size:12.5px;font-weight:600;pointer-events:none;fill:var(--ink)}\n/* 依赖边：状态渐变（V2，stroke 由 JS 逐边指向 url(#cyd-grad-i)）+ 实线 1.6 · opacity .75 */\n.cyd-app .edge{fill:none;stroke:var(--ink2);stroke-width:1;opacity:.55}\n.cyd-app .edge.dep{fill:none;stroke-width:1;opacity:.55}\n/* 子项连线：正交折线 + --ink2 单色 + 1.2 虚线 4 3 · opacity .7（与依赖边三条硬区分，§A4） */\n.cyd-app .edge.child{fill:none;stroke:var(--ink2);stroke-width:1;stroke-dasharray:4 3;opacity:.5}\n.cyd-app .node.child rect{stroke-width:1;opacity:.9}\n/* V1 幽灵边：断头桩 + 末端空心圆环（--gray + 2 4 点线 + .28） */\n.cyd-app .edge.ghost{fill:none;stroke:var(--gray);stroke-width:1;stroke-dasharray:2 4;opacity:.22}\n.cyd-app .ghostend{fill:none;stroke:var(--gray);stroke-width:1;opacity:.32}\n/* V1「缺 X」标记 / V4 变更角标 */\n.cyd-app .missingmark{pointer-events:none}\n.cyd-app .chgmark{pointer-events:none}\n/* V3 流动：仅「进行中」目标的上游边，全屏/整页才渲染（JS 三条件 + 下面三条 CSS 兜底） */\n.cyd-app .edge.flow{fill:none;stroke:var(--accent);stroke-width:1.5;stroke-dasharray:2 18;\n  stroke-linecap:round;opacity:.9;animation:cydFlow 1.1s linear infinite}\n@keyframes cydFlow{from{stroke-dashoffset:0}to{stroke-dashoffset:-20}}\n/* 兜底 1：非整页、非全屏 → 不流动；兜底 2：窄栏 → 不流动；兜底 3：打印 → 不流动 */\n.cyd-app:not(.cyd-immersive) .graphbox:not(.fs) .edge.flow{display:none !important}\n.cyd-app.narrow .edge.flow{display:none !important}\n@media print{ .cyd-app .edge.flow{display:none !important} }\n@media (prefers-reduced-motion: reduce){\n  /* 兜底 4（双保险）：减少动态偏好下即使 JS 判断被绕过也不动 */\n  .cyd-app .edge.flow{display:none !important}\n}\n.cyd-app .node .subbadge{cursor:pointer}\n.cyd-app .node .subbadge circle{fill:var(--panel);stroke:var(--ink2);stroke-width:1}\n.cyd-app .node .subbadge text{fill:var(--ink2);font-size:11px;pointer-events:none}\n.cyd-app .node .subbadge:hover circle{stroke:var(--accent)}\n.cyd-app .node .subbadge:hover text{fill:var(--accent)}\n.cyd-app .nodepop{position:absolute;z-index:5;width:235px;background:var(--panel);border:1px solid var(--accent);border-radius:16px;box-shadow:var(--shadow-pop);padding:12px 14px;cursor:pointer;display:none}\n.cyd-app .nodepop.on{display:block}\n.cyd-app .nodepop h4{margin:0 0 4px;font-size:14px;display:flex;gap:7px;align-items:center;flex-wrap:wrap}\n.cyd-app .nodepop p{margin:2px 0 6px;font-size:12.5px;color:var(--ink2)}\n.cyd-app .nodepop .go{font-size:12.5px;color:var(--accent);font-weight:600}\n\n/* ---------- 功能卡 ---------- */\n.cyd-app .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(310px,100%),1fr));gap:14px}\n.cyd-app .feat{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);padding:17px 19px;box-shadow:var(--shadow-card);transition:.18s;cursor:pointer}\n.cyd-app .feat:hover{transform:translateY(-2px);border-color:color-mix(in srgb,var(--accent) 45%,var(--line))}\n.cyd-app .feat.flash{outline:2px solid var(--accent);outline-offset:2px}\n.cyd-app .feat.deprecated{opacity:1;background:var(--chip)}\n.cyd-app .feat h3{display:flex;align-items:center;gap:8px;font-size:16px;flex-wrap:wrap;margin:0 0 4px}\n.cyd-app .feat .featdesc{margin:6px 0 0}\n.cyd-app .badge{font-size:11px;padding:2px 10px;border-radius:999px;font-weight:700;white-space:nowrap}\n.cyd-app .b-x1{background:var(--gray-soft);color:var(--gray)}\n.cyd-app .b-x2{background:var(--accent-soft);color:var(--accent)}\n.cyd-app .b-x3{background:var(--warn-soft);color:var(--warn)}\n.cyd-app .b-x4{background:var(--ok-soft);color:var(--ok)}\n.cyd-app .b-x5{background:var(--gray-soft);color:var(--ink2);text-decoration:line-through}\n.cyd-app .verifier{margin-top:8px;font-size:12.5px;color:var(--ink2)}\n.cyd-app .subsum{display:inline-block;margin-top:8px;font-size:12.5px;color:var(--ink2);background:var(--chip);border:1px solid var(--line);border-radius:8px;padding:2px 9px}\n.cyd-app .subrow{border-left:3px solid var(--line);padding:6px 0 6px 12px;margin:8px 0}\n.cyd-app .subrow .badge{margin-right:6px}\n\n/* ---------- 现在 ---------- */\n.cyd-app .cols{display:grid;grid-template-columns:1.15fr 1fr;gap:12px;align-items:start}\n.cyd-app .tl{margin:0;padding:0;list-style:none}\n.cyd-app .tl li{position:relative;padding:0 0 20px 28px}\n.cyd-app .tl li::before{content:\"\";position:absolute;left:6px;top:8px;width:9px;height:9px;border-radius:50%;background:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}\n.cyd-app .tl li::after{content:\"\";position:absolute;left:10px;top:22px;bottom:1px;width:2px;background:var(--line)}\n.cyd-app .tl li:last-child::after{display:none}\n.cyd-app .tl time{font-size:12.5px;color:var(--ink2)}\n.cyd-app .tl .old{display:none}\n.cyd-app .tl.showold .old{display:block}\n.cyd-app #moreTl{margin-top:2px;border:1px dashed var(--line);background:transparent;color:var(--ink2);border-radius:10px;padding:7px 14px;font-size:12.5px;cursor:pointer;width:100%}\n.cyd-app #moreTl:hover{color:var(--accent);border-color:var(--accent)}\n.cyd-app .decision{border:1px solid color-mix(in srgb,var(--warn) 40%,var(--line));border-left:4px solid var(--warn);background:var(--warn-soft);border-radius:16px;padding:15px 17px;margin-bottom:12px}\n.cyd-app .decision.decided{border-color:var(--line);border-left-color:var(--ok);background:var(--panel)}\n/* 已废弃 = 终态（与功能卡 .feat.deprecated 同一套处理）：灰化 + 降透明 + 标题删除线 */\n.cyd-app .decision.obsolete{border-color:var(--line);border-left-color:var(--line);background:var(--gray-soft);opacity:.55;cursor:default}\n.cyd-app .decision.obsolete > h4{text-decoration:line-through}\n.cyd-app .decision.obsolete .did{color:var(--ink2)}\n.cyd-app .decision h4{margin:0 0 3px;font-size:16px}\n.cyd-app .decision .did{font-size:11px;color:var(--warn);font-weight:700;letter-spacing:.5px}\n.cyd-app .decision.decided .did{color:var(--ok)}\n.cyd-app .optbtn{display:flex;gap:10px;align-items:flex-start;width:100%;text-align:left;margin-top:8px;background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:9px 12px;cursor:pointer;font-size:14px;color:var(--ink);transition:.15s}\n.cyd-app .optbtn:hover{border-color:var(--warn);transform:translateY(-1px)}\n.cyd-app .optbtn b{min-width:20px;color:var(--warn)}\n.cyd-app .optbtn .tick{margin-left:auto;color:var(--accent);font-weight:800;visibility:hidden}\n.cyd-app .optbtn.sel{border-color:var(--accent);background:var(--accent-soft)}\n.cyd-app .optbtn.sel .tick{visibility:visible}\n.cyd-app .optbtn[disabled]{cursor:default;opacity:.75}\n.cyd-app .optbtn[disabled]:hover{transform:none;border-color:var(--line)}\n.cyd-app .optbtn .chosen{color:var(--ok);font-weight:700}\n.cyd-app .note{width:100%;margin-top:8px;border:1px solid var(--line);border-radius:10px;background:var(--panel);color:var(--ink);padding:8px 11px;font:inherit;font-size:14px;line-height:1.6;min-height:54px;resize:vertical}\n.cyd-app .todo{display:flex;gap:9px;align-items:flex-start;font-size:14px;margin-top:8px}\n.cyd-app .todo input{margin-top:5px;accent-color:var(--ok)}\n.cyd-app .todo input[disabled]{cursor:default}\n/* 待办勾选后的确认条：勾选框只改界面，点「确认」才发消息 */\n.cyd-app .confirmbar{display:flex;align-items:center;gap:8px;margin-top:12px;padding-top:12px;border-top:1px dashed var(--line)}\n.cyd-app .confirmbar .snote{margin:0;flex:1 1 auto;border-left:0;padding-left:0}\n/* 离线「已报 · 待生效」行内标记 */\n.cyd-app .pending-tag{display:inline-block;font-size:11px;border-radius:999px;padding:2px 9px;background:var(--warn-soft);color:var(--warn);font-weight:600;white-space:nowrap}\n/* 决策与待办 tab 顶部工具行 + 「已选 n 项」 */\n.cyd-app .dtools{display:flex;gap:8px;flex-wrap:wrap;margin:2px 0 12px}\n.cyd-app .selcount{font-size:12.5px;color:var(--ink2);align-self:center;margin-right:auto}\n\n/* ---------- 关系图全屏（弹窗式铺满窗口）：给 .graphbox 加 .fs ----------\n   z-index 55 —— 低于 .ovl(60)，所以在全屏里点节点弹出的面板照常盖在上面；\n   SVG 高度仍由 renderGraph.layoutHeight() 算死写进行内样式（与整页模式同款），\n   所以这里只负责把容器钉满窗口 + 保持头/图例/图三段的纵向排列。 */\n.cyd-app .graphbox.fs{position:fixed;inset:0;z-index:55;margin:0;border:0;border-radius:0;box-shadow:none;display:flex;flex-direction:column;background:var(--panel)}\n.cyd-app .graphbox.fs .ghead{flex:none}\n.cyd-app .graphbox.fs .legend{flex:none}\n.cyd-app .graphbox.fs svg{flex:0 0 auto;min-height:0}\n.cyd-app.fullgraph .graphbox svg{height:calc(100vh - 360px);min-height:440px}\n\n/* ---------- 整页模式（会话页顶部「功能地图」tab）：只留关系图并铺满可用高度。\n   宿主自己的标签栏与输入框保持原样 —— 这里只裁剪本插件自己的版面，不碰宿主 DOM。 ---------- */\n.cyd-app.cyd-immersive{display:flex;flex-direction:column;height:100%;min-height:0;overflow:hidden}\n.cyd-app.cyd-immersive .wrap{display:flex;flex-direction:column;width:100%;max-width:none;height:100%;min-height:0;margin:0;padding:10px 12px 12px}\n.cyd-app.cyd-immersive header.top,.cyd-app.cyd-immersive .strip,.cyd-app.cyd-immersive nav.tabs,\n.cyd-app.cyd-immersive #project,.cyd-app.cyd-immersive #now,.cyd-app.cyd-immersive #guide,\n.cyd-app.cyd-immersive .filters,.cyd-app.cyd-immersive .progress,\n.cyd-app.cyd-immersive .plabel,.cyd-app.cyd-immersive .grid{display:none !important}\n.cyd-app.cyd-immersive section#features{display:flex;flex-direction:column;flex:1;min-height:0;margin:0}\n.cyd-app.cyd-immersive .graphbox{display:flex;flex-direction:column;flex:1;min-height:0;margin:0}\n/* height 由 JS 算死（见 renderGraph.layoutHeight）；flex:0 0 auto 保证 JS 值不被 flex 覆盖。\n   提示文字必须单行省略——窄栏（右侧栏展开 / 小窗口）时它会换行成几百像素，把图挤没。 */\n.cyd-app.cyd-immersive .graphbox svg{flex:0 0 auto;min-height:0}\n.cyd-app.cyd-immersive .ghead{flex:none;min-width:0;gap:10px}\n.cyd-app.cyd-immersive .ghead b{flex:none}\n.cyd-app.cyd-immersive .ghead span:not(.gtools):not(.viewswitch){flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\n/* ↑ 这条给\"标题/提示省略号\"用的规则**必须排除切换条**：切换条是 span，会被它的\n   flex:1 1 auto 拉满；侧栏面板没有这条规则所以看不出来。该规则特异性更高，\n   只改基础规则会被它盖掉（实测：叠加后甚至被压成 2px），所以**在这里排除**才有效。 */\n.cyd-app.cyd-immersive .ghead .gtools{flex:none}\n.cyd-app.cyd-immersive .legend{flex:none}\n\n/* ---------- 术语表 Tab（📖）：表格一律 .stable；空态/歧义/表头不符 的引导卡 + 指令按钮 + 格式示例 ---------- */\n.cyd-app .card.warncard{border-color:color-mix(in srgb,var(--warn) 45%,var(--line))}\n.cyd-app .codeblock{background:var(--chip);border:1px solid var(--line);border-radius:10px;padding:8px 12px;font:12.5px/1.7 Consolas,\"Courier New\",monospace;white-space:pre;overflow:auto;margin:12px 0 0}\n.cyd-app .actrow{display:flex;gap:8px;flex-wrap:wrap;margin-top:18px;padding-top:12px;border-top:1px dashed var(--line)}\n.cyd-app #glossary code{background:var(--chip);border:1px solid var(--line);border-radius:8px;padding:0 5px;font-size:12.5px}\n\n/* ---------- 弹层排版三原语：.sblock / .snote / .stable ---------- */\n.cyd-app .sblock{margin-top:18px}\n.cyd-app .sblock:first-child{margin-top:0}\n.cyd-app .sblock > * + *{margin-top:6px}\n.cyd-app .sblock > h4{margin:0;font-size:14px;font-weight:600}\n.cyd-app .sblock > h4 + *{margin-top:8px}\n.cyd-app .sblock > .sblocktext{margin:0;font-size:14px;line-height:1.7}\n.cyd-app .ev .btn.mini svg{display:block}\n.cyd-app .stablewrap{overflow-x:auto}\n.cyd-app .stable{width:100%;border-collapse:collapse;font-size:12.5px}\n.cyd-app .stable th,.cyd-app .stable td{padding:8px 10px;text-align:left;vertical-align:top;border-bottom:1px solid var(--line)}\n.cyd-app .stable th{background:var(--chip);font-weight:600}\n.cyd-app .stable tbody tr:nth-child(even){background:color-mix(in srgb,var(--chip) 60%,transparent)}\n.cyd-app .stable th.num,.cyd-app .stable td.num{text-align:right;font-variant-numeric:tabular-nums}\n/* 待生效明细「内容」列：原文逐字显示、允许任意处折行（copy-deck §8.6） */\n.cyd-app .stable td.itext{overflow-wrap:anywhere;min-width:12em}\n.cyd-app .ignline{display:block;font-size:12.5px}\n\n/* ---------- 弹层（拍板中心 / 审计 / 功能详情 / 版本 / 设置） ---------- */\n.cyd-app .ovl{position:fixed;inset:0;background:rgba(15,20,30,.45);display:none;align-items:flex-start;justify-content:center;z-index:60;padding:40px 16px}\n.cyd-app .ovl.on{display:flex}\n.cyd-app .sheet{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow-pop);max-width:760px;width:100%;max-height:calc(100vh - 90px);overflow:hidden;padding:0;position:relative;display:flex;flex-direction:column}\n.cyd-app .sheethead{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:18px 24px 12px;border-bottom:1px solid var(--line);flex:none}\n.cyd-app .sheetbody{overflow:auto;padding:18px 24px 24px;flex:1;min-height:0}\n.cyd-app .sheethead h3{margin:0;font-size:16px;display:flex;gap:9px;align-items:center;flex-wrap:wrap}\n.cyd-app .xbtn{border:1px solid var(--line);background:var(--panel);color:var(--ink2);border-radius:50%;width:30px;height:30px;cursor:pointer;font-size:14px;line-height:1;flex:none}\n.cyd-app .xbtn:hover{border-color:var(--accent);color:var(--accent)}\n/* 标签列 + 值列两列网格（§12.3）：标签与值可区分，值不再与标签连成一句 */\n.cyd-app .kv{display:grid;grid-template-columns:5em 1fr;gap:4px 8px;align-items:baseline;font-size:14px;margin-top:8px}\n.cyd-app .kv b{color:var(--ink2);font-weight:600;margin-right:0}\n.cyd-app .kv > *{min-width:0}\n.cyd-app .kv:not(:has(> b)){display:block}\n.cyd-app .depc{display:inline-block;background:var(--chip);border:1px solid var(--line);border-radius:999px;padding:3px 12px;font-size:12.5px;margin:4px 6px 0 0;cursor:pointer;color:var(--ink)}\n.cyd-app .depc:hover{border-color:var(--accent);color:var(--accent)}\n.cyd-app details{margin-top:8px}\n.cyd-app summary{cursor:pointer;font-size:12.5px}\n/* 弹层内的返回条（版本差异 → 返回版本列表） */\n.cyd-app .sheetnav{display:flex;align-items:center;gap:8px;margin:0 0 12px;padding-bottom:8px;border-bottom:1px dashed var(--line)}\n/* 拍板浮层底部跳转行（在 .sheetbody 之外，不随内容滚动） */\n.cyd-app .sheetfoot{flex:none;padding:12px 24px;border-top:1px solid var(--line);display:flex;justify-content:flex-end}\n.cyd-app .sheetfoot .linkbtn{border:0;background:none;color:var(--accent);font:inherit;font-size:12.5px;cursor:pointer;padding:0}\n.cyd-app .sheetfoot .linkbtn:hover{text-decoration:underline}\n.cyd-app .verrow{display:flex;align-items:center;justify-content:space-between;gap:10px;border-bottom:1px solid var(--line);padding:9px 0}\n.cyd-app .verrow:last-child{border-bottom:0}\n.cyd-app .diffbox{font:12.5px/1.6 Consolas,\"Courier New\",monospace;border:1px solid var(--line);border-radius:10px;overflow:auto;max-height:46vh}\n.cyd-app .dline{white-space:pre-wrap;word-break:break-all;padding:1px 10px}\n.cyd-app .dline.add{background:var(--ok-soft);color:var(--ok)}\n.cyd-app .dline.del{background:var(--warn-soft);color:var(--warn);text-decoration:line-through}\n\n/* ---------- 设置弹层 ---------- */\n.cyd-app .setrow{border-bottom:1px solid var(--line);padding:12px 0;font-size:14px}\n.cyd-app .setrow:last-of-type{border-bottom:0}\n.cyd-app .setrow label{display:block;line-height:1.8}\n.cyd-app .setrow input[type=\"text\"],.cyd-app .setrow input[type=\"number\"]{border:1px solid var(--line);border-radius:10px;padding:5px 9px;background:var(--panel);color:var(--ink);font:inherit;margin-top:4px}\n.cyd-app .setnum{width:90px}\n.cyd-app .settext{width:100%}\n\n/* ---------- 节点面板发送框（DSH 原生形态）----------\n   一个输入框只允许**一层**边框：边框画在 .composer 容器上；内层 textarea 无边框、无 outline、\n   背景透明，并且**显式压掉全局 :focus-visible 的描边**（那就是截图里\"两个蓝框\"的第二个）。 */\n.cyd-app .composerlabel{font-size:12.5px;color:var(--ink2);margin:0 0 6px}\n.cyd-app .composer{border:1px solid var(--line);border-radius:16px;background:var(--panel);padding:10px 12px;margin-bottom:6px;transition:.15s}\n.cyd-app .composer:focus-within{border-color:var(--accent)}\n.cyd-app .composer textarea{border:0;background:transparent;outline:none;resize:none;width:100%;display:block;padding:0;margin:0;font:inherit;font-size:14px;line-height:1.6;min-height:24px;max-height:96px;overflow-y:auto}\n.cyd-app .composer textarea:focus,.cyd-app .composer textarea:focus-visible{outline:none !important;border:0}\n/* 守卫：说明文字不许塞回框内（§12.4） */\n.cyd-app .composer > .snote{display:none}\n.cyd-app .composerbar{display:flex;align-items:center;gap:6px;margin-top:8px}\n.cyd-app .composer .chips{display:flex;gap:6px;flex:1 1 auto;min-width:0;flex-wrap:wrap;align-items:center}\n.cyd-app .composer .chiplab{font-size:12.5px;color:var(--ink2)}\n.cyd-app .composer .chip{border:1px solid var(--line);background:var(--panel);color:var(--ink2);border-radius:999px;padding:3px 11px;font:inherit;font-size:12.5px;cursor:pointer;white-space:nowrap}\n.cyd-app .composer .chip:hover{border-color:var(--accent);color:var(--accent)}\n.cyd-app .composer .send{flex:none;width:32px;height:32px;border-radius:999px;padding:0;border:1px solid var(--accent);background:var(--accent);color:var(--on-solid);display:inline-flex;align-items:center;justify-content:center;cursor:pointer}\n.cyd-app .composer .send:hover{filter:brightness(1.06)}\n.cyd-app .composer .send:disabled{background:var(--chip);border-color:var(--line);color:var(--ink2);filter:none;cursor:default}\n.cyd-app .composer .send svg{display:block}\n.cyd-app .composer-note{margin:0 0 18px}\n\n/* ---------- toast ---------- */\n.cyd-app .toast{position:fixed;left:50%;bottom:34px;transform:translateX(-50%) translateY(20px);background:var(--ink);color:var(--bg);padding:10px 20px;border-radius:999px;font-size:14px;opacity:0;pointer-events:none;transition:.25s;box-shadow:var(--shadow-pop);z-index:70}\n.cyd-app .toast.show{opacity:1;transform:translateX(-50%) translateY(0)}\n\n/* ---------- 窄栏（右侧栏 / 小窗口）：按容器宽度切 .narrow，不隐藏 header 与掌控条，只重排 ---------- */\n.cyd-app.narrow header.top{display:flex}\n.cyd-app.narrow .wrap{max-width:none;padding:12px 12px 24px}\n.cyd-app.narrow{font-size:12.5px;line-height:1.6}\n.cyd-app.narrow .brand h1{font-size:16px}\n.cyd-app.narrow .brand .by{display:none}\n.cyd-app.narrow .iconbtn{width:28px;height:28px}\n.cyd-app.narrow .strip{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;margin:12px 0 6px}\n/* 68px 级：3 行 + 2×6px 间隙；含按钮的 pill 走 flex（日期可省略号收缩，按钮绝不被裁） */\n.cyd-app.narrow .pill{flex:none;min-width:0;width:auto;height:66px;padding:8px 8px}\n.cyd-app.narrow .pill .v{font-size:12.5px;line-height:1.3;-webkit-line-clamp:2}\n.cyd-app.narrow .pill .v:has(.btn.mini){display:flex;align-items:center;justify-content:center;gap:4px}\n.cyd-app.narrow .pill .v .vtxt{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\n.cyd-app.narrow .pill .v .btn.mini{flex:none}\n.cyd-app.narrow .card{padding:14px 14px}\n.cyd-app.narrow .card h3,.cyd-app.narrow .sheethead h3,.cyd-app.narrow .ghead b{font-size:14px}\n.cyd-app.narrow nav.tabs{gap:6px}\n.cyd-app.narrow nav.tabs button{padding:6px 12px;font-size:13px}\n.cyd-app.narrow .cols{grid-template-columns:1fr;gap:12px}\n.cyd-app.narrow .btn,.cyd-app.narrow .lede,.cyd-app.narrow .kv,.cyd-app.narrow .toast,.cyd-app.narrow .setrow,\n.cyd-app.narrow .composer textarea{font-size:12.5px}\n.cyd-app.narrow .kv{grid-template-columns:4em 1fr}\n.cyd-app.narrow .composerbar{flex-wrap:wrap;align-items:flex-end}\n.cyd-app.narrow .composer .chips{flex-wrap:wrap}\n.cyd-app.narrow .composer .send{margin-left:auto;align-self:flex-end}\n.cyd-app.narrow .stable{display:block;overflow-x:auto}\n.cyd-app.narrow .empty{font-size:12.5px;line-height:1.6}\n.cyd-app.narrow .sheet{max-width:none;max-height:calc(100vh - 24px)}\n.cyd-app.narrow .sheethead{padding:14px 14px 12px}\n.cyd-app.narrow .sheetbody{padding:12px 14px 18px}\n\n@page{margin:12mm}\n@media print{/* 打印一律按浅色纸面渲染：复位主题变量，压过 prefers-color-scheme 与 [data-theme=\"dark\"] */\n.cyd-app{--bg:#fff !important;--panel:#fff !important;--ink:#1b2331 !important;--ink2:#5b6575 !important;--line:#c9d0dc !important;--accent:#2f6fed !important;--accent-soft:#e8effe !important;--ok:#179a50 !important;--ok-soft:#e5f6ec !important;--warn:#c07f00 !important;--warn-soft:#fdf3e0 !important;--gray:#8a93a3 !important;--gray-soft:#eef1f6 !important;--chip:#f2f4f8 !important;--on-solid:#fff !important;--shadow-card:none !important;--shadow-pop:none !important;background:#fff !important;color:#1b2331 !important;-webkit-print-color-adjust:exact;print-color-adjust:exact}\n.cyd-app{background:#fff !important}/* 隐藏交互壳；.ovl.on 必须一起压掉，否则弹层会盖在正文上一起打印 */\n.cyd-app nav.tabs, .cyd-app .iconbtn, .cyd-app .filters, .cyd-app .ghead span, .cyd-app .ovl, .cyd-app .ovl.on, .cyd-app .nodepop, .cyd-app .toast, .cyd-app #moreTl, .cyd-app #updBtn, .cyd-app .btn[data-cp], .cyd-app .btn.primary, .cyd-app .actrow, .cyd-app .composer{display:none !important}\n.cyd-app section{display:block !important}/* 展开被“查看更早的”折叠的时间线；证据按钮不再整体隐藏，文件路径照常打印 */\n.cyd-app .tl .old{display:block !important}.cyd-app .feat.deprecated,.cyd-app .decision.obsolete{opacity:1;background:var(--chip)}.cyd-app .graphbox{overflow:visible}.cyd-app .ev .btn.mini, .cyd-app .ev a{background:none;border:0;padding:0;color:#1b2331;text-decoration:underline}.cyd-app .card, .cyd-app .feat, .cyd-app .graphbox, .cyd-app .decision{box-shadow:none !important;break-inside:avoid;page-break-inside:avoid}\n}\n";
const SHELL = "<div class=\"wrap\">\n  <header class=\"top\">\n    <div class=\"brand\">\n      <h1 id=\"projName\">开发仪表盘</h1>\n      <span class=\"by\">（由 control-your-development 生成）</span>\n    </div>\n    <div class=\"topacts\">\n      <button id=\"setBtn\" class=\"iconbtn\" title=\"设置\" style=\"display:none\">⚙</button>\n      <button id=\"verBtn\" class=\"iconbtn\" title=\"版本快照\" style=\"display:none\">🕓</button>\n      <button id=\"themeBtn\" class=\"iconbtn\" title=\"切换主题\">🌓</button>\n    </div>\n  </header>\n  <div class=\"strip\" id=\"strip\"></div>\n  <nav class=\"tabs\">\n    <button data-tab=\"project\" class=\"on\">🏠 项目</button>\n    <button data-tab=\"features\">🗺 功能地图</button>\n    <button data-tab=\"now\">⚡ 现在</button>\n    <button data-tab=\"decisions\">⚖ 决策与待办</button>\n    <button data-tab=\"glossary\">📖 术语表</button>\n    <button data-tab=\"guide\">❓ 使用指南</button>\n  </nav>\n\n  <section id=\"project\" class=\"on\"></section>\n  <section id=\"features\"></section>\n  <section id=\"now\"></section>\n  <section id=\"decisions\"></section>\n  <section id=\"glossary\"></section>\n\n  <section id=\"guide\">\n    <div class=\"card\">\n      <h3>功能简介</h3>\n      <p class=\"lede\">control-your-development 仪表盘把开发进展翻译成人话。你能看到产品能做什么、怎么用、走到哪一步。需要你拿主意的地方，会摆在这里等你拍板。</p>\n    </div>\n    <div class=\"card\">\n      <h3>上手方式</h3>\n      <ol class=\"steps\">\n        <li data-n=\"1\"><b>建立仪表盘</b><br><span class=\"muted\">在聊天框输入 <code>/control-your-development</code>，或直接说一句 \"control my development\"</span></li>\n        <li data-n=\"2\"><b>照常开发</b><br><span class=\"muted\">每完成一个阶段，仪表盘就会更新。想立刻刷新，点顶部「更新」。</span></li>\n        <li data-n=\"3\"><b>随时掌握全局</b><br><span class=\"muted\">打开会话右侧栏，点击打开「开发仪表盘」，会话页顶部是整页「功能地图」。顶部徽章都能点开看详情。要离线分享就说「导出网页版」。</span></li>\n        <li data-n=\"4\"><b>处理「等你拍板」</b><br><span class=\"muted\">点顶部「等你拍板」打开拍板面板 → 勾选项、可写补充 → 「发送拍板」。会话不在线时会先记下，下次更新生效。</span></li>\n        <li data-n=\"5\"><b>亲手验证</b><br><span class=\"muted\">试用过某功能后，在它的功能卡上点「✅ 我已验证」，进度条前进。</span></li>\n      </ol>\n    </div>\n    <div class=\"card\">\n      <h3>⚖ 决策与待办怎么用</h3>\n      <p class=\"lede\">需要你拍板的事、等你做的待办都在这一页。勾选后点「发送拍板」，我来落定；做完一件待办，勾一下就行。</p>\n    </div>\n    <div class=\"card\">\n      <h3>待办不做也能跑</h3>\n      <p class=\"lede\">待办只是提醒你还没确认的事，不做也不会挡住开发。</p>\n    </div>\n  </section>\n</div>\n<div class=\"toast\" id=\"toast\"></div>\n<div class=\"ovl\" id=\"ovl\"><div class=\"sheet\" id=\"sheet\"></div></div>\n";
const norm = t => t.replace(/\r\n?/g, '\n');  // CRLF 与 CR-only 行尾都归一
function pad(n){ return String(n).padStart(2, '0'); }
function fmtDate(d){ return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function fmtDT(d){ return fmtDate(d) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }
/* 上次采集的相对时间（前端算，不写进数据）：今天/昨天给时刻，2–7 天给「N 天前」，更早给日期时间。
   显示层口径：解析不出合法日期时间（非法字符串 / 非字符串 / 空串）默认返回空串（调用方整块不渲染）；
   `rawFallback` 为真时改为**原样返回原文**（明细浮层的「时间」列要看到原始 ts，见 copy-deck §8.6）。
   字段层不管这个 —— health.facts_generated_at 只负责把字符串原样透出。 */
/* 「久未采集」阈值（天）。**只做显示层**：它是"相对于此刻"的判断 ——
   写进 data/warnings 会被离线导出页**冻结成永久为真**，且两端各自取 now 会在阈值边界上产生跨端差异
   （dual_parser_diff 变成偶发红）。所以这里按每次渲染现算，与 fmtRel 同层。
   阈值 = **30**（copy-deck §16.6 定稿：采集是手动的，"两周没动"在正常节奏里太常见，14 会把其实
   没变化的项目也报成旧数据；真实天数每次都在「上次采集」一行显示，放宽不丢信息）。 */
const FACTS_STALE_DAYS = 30;
function factsStaleDays(raw){
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return null;                                  // 没采集过 → 由「数据健康」那条管，不在这里说
  const t = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? s + 'T00:00:00' : s);
  if (isNaN(t.getTime())) return null;                  // 解析不出 → 不猜
  const days = Math.floor((Date.now() - t.getTime()) / 86400000);
  return days >= FACTS_STALE_DAYS ? days : null;
}
/* 久未采集的**三句文案**（copy-deck §16.6 定稿；**只在这一处生成**，条带 title 与审计行都从这里取）：
   ① 数据是旧的（多少天）② 刷新/重渲染都没用 ③ 怎么触发（沿用既有口令「更新仪表盘」）。 */
function factsStaleLines(days){
  return ['这批数据已经 ' + days + ' 天没采集了，可能不是最新的。',
          '刷新页面或重新渲染都不会更新它。',
          '说一句「更新仪表盘」就会重新采集。'];
}
/* S3「技术地图跟不上了」的**三句文案**（copy-deck §16.6 定稿；**只在这一处生成**，
   warnings[] / 技术视图 .snote / 徽标 title / 审计行四处都从这里取）。
   模块名**最多列 3 个、超出加「等」**（deck 要求：别让变量把句子撑过 40 字）。 */
function techStaleLines(ts){
  const names = (ts && ts.modules) || [];
  const shown = names.slice(0, 3).join('、') + (names.length > 3 ? '等' : '');
  return ['技术地图里有 ' + names.length + ' 个模块的证据找不到了：' + shown + '。',
          '这份地图可能已经跟不上代码了。',
          '去技术地图里把这几条证据改对。'];
}
/* S4「证据文件被删除（可能搬迁）」的**两条文案**（copy-deck 定稿前的占位；**只在这一处生成** ——
   warnings[] 从这里取，与 Python render_dashboard.py 里那两句逐字一致）。
   两侧各最多列 3 个名字、超出加「等」（与 techStaleLines 同规矩：别让变量把句子撑过 40 字）；
   某侧没命中就**不产那一句**（不许为了对称而报一句空的）。 */
function movedEvidenceLines(mv){
  const lines = [];
  const t = (mv && mv.tech) || [];
  if (t.length) lines.push('技术地图里有 ' + t.length + ' 个模块的证据文件已被删除（可能搬迁）：'
    + t.slice(0, 3).join('、') + (t.length > 3 ? '等' : '') + '。');
  const f = (mv && mv.features) || [];
  if (f.length) lines.push('功能地图里有 ' + f.length + ' 个功能的证据文件已被删除（可能搬迁）：'
    + f.slice(0, 3).join('、') + (f.length > 3 ? '等' : '') + '。');
  return lines;
}
function fmtRel(dt, rawFallback){
  const raw = String(dt == null ? '' : dt).trim();
  if (!raw) return '';
  // 只有日期（没有时刻）时按本地零点解析：ISO 的 'YYYY-MM-DD' 会被当成 UTC，跨时区会差一天
  const t = new Date(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw + 'T00:00:00' : raw);
  if (isNaN(t.getTime())) return rawFallback ? raw : '';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const day = new Date(t.getFullYear(), t.getMonth(), t.getDate());
  const days = Math.round((today - day) / 86400000);
  if (days === 0) return '今天 ' + pad(t.getHours()) + ':' + pad(t.getMinutes());
  if (days === 1) return '昨天 ' + pad(t.getHours()) + ':' + pad(t.getMinutes());
  if (days >= 2 && days <= 7) return days + ' 天前';
  return fmtDT(t);
}
/* 掌控条的值来自用户手写的 Markdown：先剥掉标记再显示（粗体星号不许原样出现在界面上）。
   粗体与斜体标记、行内代码反引号一律去掉；链接只留文字；图片整个删；行首的标题/列表符号去掉。 */
function stripMd(s){
  return String(s == null ? '' : s)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`{1,3}([^`]*)`{1,3}/g, '$1')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/[*_]/g, '')
    .split('\n').map(l => l.replace(/^\s{0,3}(#{1,6}|[-*>+])\s+/, '')).join(' ')
    .replace(/\s+/g, ' ').trim();
}
function kindOf(p){
  const n = p.split('/').pop().toLowerCase();
  const ext = n.includes('.') ? '.' + n.split('.').pop() : '';
  if (n.includes('test') || n.startsWith('spec')) return '测试';
  if (['.md', '.txt', '.rst', '.adoc'].includes(ext)) return '文档';
  if (['.py', '.js', '.ts', '.jsx', '.tsx', '.mjs', '.c', '.cpp', '.h', '.java', '.go', '.rs', '.rb', '.php', '.cs', '.swift', '.kt', '.sh', '.ps1', '.html', '.css', '.vue', '.svelte', '.sql'].includes(ext)) return '代码';
  return '其他';
}
/* 最小 glob（与渲染器 scripts/render_dashboard.py 的 glob_match 同语义）：
   双星号跨目录、单星号不跨目录、问号单字符、大小写敏感；线性匹配，无正则回溯风险。 */
function segMatch(s, p){
  let si = 0, pi = 0, star = -1, mark = 0;
  while (si < s.length){
    if (pi < p.length && (p[pi] === '?' || p[pi] === s[si])){ si++; pi++; continue; }
    if (pi < p.length && p[pi] === '*'){ star = pi++; mark = si; continue; }
    if (star >= 0){ pi = star + 1; si = ++mark; continue; }
    return false;
  }
  while (pi < p.length && p[pi] === '*') pi++;
  return pi === p.length;
}
/* 本插件支持的**事实源格式版本**（`.cyd.json.format`；契约「版本位分三件」L494）。
   写者**只有渲染器** ⇒ 共享核的职责是**说出同一件事**（面板路径上用户看得见 + dual_parser_diff 能逐条比对），
   **不是**执行"不写回" —— 它没有写回动作（宿主 `verifyWrite: null`，写回走 notify/信箱）。 */
const CYD_FORMAT_SUPPORTED = 1;
/* 本插件版本（**构建期注入**）：`build_panel.py` 会把下行常量右侧的占位注释替换成 manifest.yaml 的 version
   （写法用注释占位而非字符串，注意**不要在注释里再写一对注释符**——那会提前结束本注释，本轮实测踩过 ✗）。
   未构建时是 `null` ⇒ 读侧判据**返回"不比"**（fail-safe、行为明确），**不是** undefined 静默失效 ✗
   —— 这是"空绿"的第三型：构建期注入在未构建路径上缺失。**不要手改这一行**（改 `build_panel.py` 后重建）。 */
const CYD_SKILL_VERSION = "1.6.0";
/** 纯 stdlib 的 semver 比较（与 Python `semver_cmp` **同一套语义**）：返回 -1/0/1；任一无法解析 ⇒ null。
    三段数字 + 预发布按 semver 优先级（`1.9.0-rc < 1.9.0`）；**无法解析 ⇒ null = 不比**（fail-safe：
    这条 WARN 说错会让用户白忙 ⇒ 误报比漏报更坏，**不是因为这件事不重要**）。 */
function semverCmp(a, b){
  const parse = v => {
    if (typeof v !== 'string') return null;
    const s = v.trim(); if (!s) return null;
    const i = s.indexOf('-');
    const main = i < 0 ? s : s.slice(0, i), pre = i < 0 ? '' : s.slice(i + 1);
    const parts = main.split('.');
    if (parts.length !== 3 || !parts.every(p => /^[0-9]+$/.test(p))) return null;
    return { n: parts.map(Number), pre: pre };
  };
  const pa = parse(a), pb = parse(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < 3; i++){ if (pa.n[i] !== pb.n[i]) return pa.n[i] < pb.n[i] ? -1 : 1; }
  if (pa.pre === pb.pre) return 0;
  if (pa.pre === '') return 1;
  if (pb.pre === '') return -1;
  return pa.pre < pb.pre ? -1 : 1;
}
function globMatch(path, pat){
  const ss = path.split('/'), ps = pat.split('/');
  let i = 0, j = 0, star = -1, mark = 0;
  while (i < ss.length){
    if (j < ps.length && ps[j] === '**'){ star = j++; mark = i; continue; }
    if (j < ps.length && segMatch(ss[i], ps[j])){ i++; j++; continue; }
    if (star >= 0){ j = star + 1; i = ++mark; continue; }
    return false;
  }
  while (j < ps.length && ps[j] === '**') j++;
  return j === ps.length;
}


/* ---------- JS 解析器（与渲染器同契约，用于页面内刷新） ---------- */
function evError(rel){
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(rel)) return '网址（证据必须是工作区内的文件）';
  if (rel.startsWith('/') || rel.startsWith('\\')) return '绝对路径';
  if (/^[A-Za-z]:/.test(rel)) return '盘符绝对路径';
  if (rel.split(/[\\/]/).includes('..')) return '上跳目录';
  return '';
}
function stripComments(t){ return t.replace(/^\uFEFF/, '').replace(/<!--[\s\S]*?-->/g, ''); }
function splitEv(raw){ return raw.split(',').map(x => x.trim()).filter(Boolean); }
function parseProduct(text, warnings){
  warnings = warnings || [];
  const proj = { name: '未命名项目', intro: '', stage: '', direction: '', next: '', journey: [] };
  text = stripComments(text);
  const m = text.match(/^#\s+(.+)$/m);
  if (m) proj.name = m[1].trim().split(/\s[—–-]{1,2}\s/)[0].trim() || m[1].trim();
  const sec = text.split(/^##\s+/m);
  const keymap = { '阶段': 'stage', '方向': 'direction', '下一步': 'next' };
  for (let i = 1; i < sec.length; i++){
    const lines = sec[i].split('\n'), head = lines[0].trim(), body = lines.slice(1);
    if (head.startsWith('项目简介')){
      const para = [];
      for (const l of body){ if (l.trim().startsWith('#')) break; para.push(l.replace(/\s+$/, '')); }
      proj.intro = para.join('\n').trim();
    } else if (head.startsWith('当前方向')){
      for (const l0 of body){
        const mm = l0.trim().match(/^-\s*(阶段|方向|下一步)\s*[:：]\s*(.+)$/);
        if (mm) proj[keymap[mm[1]]] = mm[2].trim();
      }
    } else if (head.startsWith('使用流程')){
      for (const l0 of body){
        const mm = l0.trim().match(/^\d+\.\s*(.+)$/);
        if (!mm) continue;
        const parts = mm[1].split('::').map(x => x.trim());
        const step = { title: parts[0] || '', desc: '', evidence: [] };
        for (const p of parts.slice(1)){
          const em = p.match(/^证据\s*[:：]\s*(.+)$/);
          if (em) step.evidence = splitEv(em[1]);
          else if (!step.desc) step.desc = p;
          else step.desc += ' :: ' + p;
        }
        proj.journey.push(step);
      }
    }
  }
  /* 与 Python parse_product 同字一条（copy-deck §16.6 定稿，清单 #1）：
     PRODUCT.md 存在但没有 ## 项目简介 小节 → 两端都要产这条 WARN（此前只有 Python 产）。 */
  if (!proj.intro) warnings.push('PRODUCT.md 缺少 ## 项目简介');
  return proj;
}
const STATUSES = ['设想', '进行中', '可用', '已验证', '已废弃'];
/* 确定性文本宽度（与 Python 渲染器逐字同构）：>U+2E00 按宽字符 14px，其余 8px。
   不用 canvas measureText——布局坐标要写进数据，两端必须算出一模一样的值。 */
function textWidth(s){ let w = 0; for (const c of String(s)) w += (c.codePointAt(0) > 0x2E00 ? 14 : 8); return w; }
const NODE_PAD = 46, NODE_MIN_W = 150, NODE_MAX_W = 280, NODE_TEXT_MAX = NODE_MAX_W - NODE_PAD;
/* 名称折行：最多 2 行，第二行放不下就 … 省略（悬浮 <title> 见全文）。码点数组操作，emoji 安全。
   `maxTextW` 是**这一档卡片能容纳的文字宽度**——子项传自己的宽度，父节点用 NODE_TEXT_MAX：
   折行宽度必须与卡片宽度同口径，否则文字会横向溢出卡片（批 3 复审的 P0-2）。 */
function wrapName(name, maxTextW){
  const maxW = maxTextW || NODE_TEXT_MAX;
  const chars = [...String(name)];
  const cw = c => (c.codePointAt(0) > 0x2E00 ? 14 : 8);
  if (textWidth(name) <= maxW) return [chars.join('')];
  let i = 0, w = 0;
  while (i < chars.length && w + cw(chars[i]) <= maxW){ w += cw(chars[i]); i++; }
  const l1 = chars.slice(0, i).join(''), rest = chars.slice(i);
  if (textWidth(rest.join('')) <= maxW) return [l1, rest.join('')];
  let j = 0, w2 = 0;
  const limit = maxW - 14;
  while (j < rest.length && w2 + cw(rest[j]) <= limit){ w2 += cw(rest[j]); j++; }
  return [l1, rest.slice(0, j).join('') + '…'];
}
/* 路径显示中间省略（保住首尾最有辨识度的部分）；完整路径一律在悬浮 title 与复制值里 */
function truncMid(p, max){
  const chars = [...String(p)];
  max = max || 46;
  if (chars.length <= max) return String(p);
  const keep = max - 1;
  const head = Math.ceil(keep * 0.55), tail = keep - head;
  return chars.slice(0, head).join('') + '…' + chars.slice(chars.length - tail).join('');
}
function nodeDims(f){
  const lines = wrapName(f.name);
  return { w: Math.max(NODE_MIN_W, Math.min(NODE_MAX_W, textWidth(f.name) + NODE_PAD)), h: lines.length > 1 ? 58 : 42, lines };
}
function parseFeatures(text, warnings){
  warnings = warnings || [];
  text = stripComments(text);
  const feats = []; let cur = null, curChild = null;
  for (const line of text.split('\n')){
    const s = line.trim();
    const hm = s.match(/^##\s*功能\s*[:：]\s*(.+)$/);
    if (hm){ if (cur) feats.push(cur); cur = { name: hm[1].trim(), status: '', desc: '', evidence: [], deps: [], verify: '', children: [] }; curChild = null; continue; }
    const cm = s.match(/^###\s*子项\s*[:：]\s*(.+)$/);
    if (cm){
      if (!cur){ warnings.push('子项「' + cm[1].trim() + '」出现在任何功能之前，已忽略'); continue; }
      curChild = { name: cm[1].trim(), status: '', desc: '', evidence: [], verify: '' };
      cur.children.push(curChild); continue;
    }
    const target = curChild || cur;
    if (!target) continue;
    const fm = s.match(/^-\s*(状态|简介|证据|依赖|验证)\s*[:：]\s*(.*)$/);
    if (!fm) continue;
    const key = fm[1], val = fm[2].trim();
    if (key === '依赖'){
      if (curChild){ warnings.push('子项「' + curChild.name + '」（功能「' + cur.name + '」）不允许写依赖，已忽略'); continue; }
      target.deps = (val === '' || val === '无') ? [] : splitEv(val);
    }
    else if (key === '状态') target.status = val;
    else if (key === '简介') target.desc = val;
    else if (key === '证据') target.evidence = splitEv(val);
    else if (key === '验证') target.verify = val;
  }
  if (cur) feats.push(cur);
  function check(item, label, missDesc){
    if (!item.status){ warnings.push(label + '缺少状态字段'); item.status = '设想'; }
    else if (!STATUSES.includes(item.status)){ warnings.push('「' + item.name + '」状态非法: ' + "'" + item.status + "'" + '（允许: ' + STATUSES.join('/') + '）'); item.status = '设想'; }
    if (!item.desc){ warnings.push(label + '缺少简介'); item.desc = missDesc; }
  }
  feats.forEach(f => {
    check(f, '功能「' + f.name + '」', '[待确认: 功能简介]');
    const seenChild = new Set();
    f.children.forEach(c => {
      check(c, '功能「' + f.name + '」的子项「' + c.name + '」', '[待确认: 子项简介]');
      if (seenChild.has(c.name)) warnings.push('功能「' + f.name + '」内子项重名：「' + c.name + '」，按首个解析');
      seenChild.add(c.name);
    });
  });
  return feats;
}
/* 术语表：第一张表 → [{term, meaning, aliases}]。与 Python 同契约
   （表头接受「标准用词」的常见别名/英文写法；文件名不参与判断，所以调用方要把真实文件名传进来）。 */
const GLOSS_HEADERS = ['标准用词', '术语', '用词', 'term', 'glossary term'];
/* ---------- 术语表识别：**JS 侧唯一一份判定**（契约「术语表」节 §173-177）----------
   宿主只做 IO 注入（读 .cyd.json / 列 .md / 读候选文本），判定全在这里：
   ① .cyd.json 里用户手写的 `glossary` → 最高优先（指定了但不存在 → `meta_missing` flag + 退回自动识别）
   ② `.cyd.json` 存在但不是合法 JSON 对象 → `meta_error` flag（继续按自动识别）
   ③ 渲染器写下的 `glossary_file`（面板没有列目录能力，只能靠它知道真实文件名）
   ④ 内容嗅探：候选里**唯一一个**表头符合契约的文件；命中多个 → ambiguous（不猜）
   收敛前这段判定散在 driver 与两个宿主里（3 份），正是"面板比导出页少两条提示"的根因。
   入参形状照契约：`{ metaRaw, listMd, readText }`（**函数本身不碰 IO**）。 */
const GLOSS_HEADER_TERMS = ['标准用词', '术语', '用词', 'term', 'glossary term'];
const GLOSS_FIXED_MD = ['PRODUCT.md', 'FEATURES.md', 'NOW.md'];
function glossaryHeaderOk(text){
  for (const line of stripComments(String(text == null ? '' : text)).split(/\r\n?|\n/)){
    if (!line.trim().startsWith('|')) continue;
    const cells = line.trim().replace(/^\|+/, '').replace(/\|+$/, '').split('|').map(c => c.trim());
    return cells.length >= 3 && GLOSS_HEADER_TERMS.indexOf(cells[0].toLowerCase()) >= 0;
  }
  return false;
}
function resolveGlossary(inp){
  const metaRaw = (inp && inp.metaRaw != null) ? String(inp.metaRaw) : null;
  const listMd = (inp && inp.listMd) || [];
  const readText = (inp && inp.readText) || (() => null);
  const status = { file: null, source: 'none', candidates: [] };
  let meta = null;
  if (metaRaw !== null && metaRaw.trim() !== ''){
    try{
      const parsed = JSON.parse(stripComments(metaRaw));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) meta = parsed;
    }catch(e){ meta = null; }
    if (!meta) status.meta_error = true;              // 存在、读得到，但不是合法 JSON 对象
  }
  if (meta){
    const want = (typeof meta.glossary === 'string' && meta.glossary.trim()) ? meta.glossary.trim() : '';
    if (want){
      if (readText(want) != null){ status.file = want; status.source = 'explicit'; return status; }
      status.meta_missing = want;                     // 指定了但工作区里没有 → flag + 退回自动识别
    } else {
      const rf = (typeof meta.glossary_file === 'string' && meta.glossary_file.trim()) ? meta.glossary_file.trim() : '';
      if (rf && readText(rf) != null){
        status.file = rf;
        status.source = (typeof meta.glossary_source === 'string' && meta.glossary_source) ? meta.glossary_source : 'explicit';
        return status;
      }
    }
  }
  /* 候选排序按**文件名**（UTF-16 码位序，与 Python `key=lambda q: q.name` 同口径）；
     三大事实源按**大小写敏感**排除（契约明文，别改成不敏感） */
  const hits = listMd.map(String)
    .filter(n => n.toLowerCase().endsWith('.md') && GLOSS_FIXED_MD.indexOf(n) < 0)
    .sort()
    .filter(n => { const t = readText(n); return t != null && glossaryHeaderOk(t); });
  if (hits.length === 1){ status.file = hits[0]; status.source = 'sniff'; return status; }
  if (hits.length > 1){ status.source = 'ambiguous'; status.candidates = hits; return status; }
  return status;
}
/* ---------- 技术地图 / 变更规则（v1.6）：与 Python parse_tech / parse_changes 逐字同口径 ----------
   **不做代码解析**（保真红线）：层 / 技术 / 连到 只能来自用户声明。字段形状由契约钉死。 */
function parseTech(text, warnings){
  warnings = warnings || [];
  text = stripComments(text);
  const mods = [], layers = [];
  let cur = null;
  for (const line of text.split(/\r\n?|\n/)){
    const s = line.trim();
    const hm = s.match(/^##\s*模块\s*[:：]\s*(.+)$/);
    if (hm){
      cur = { name: hm[1].trim(), layer: '', duty: '', tech: '', status: '', evidence: [], links: [], children: [] };
      mods.push(cur); continue;
    }
    const cm = s.match(/^###\s*子项\s*[:：]\s*(.+)$/);
    if (cm){
      if (!cur){ warnings.push('子项「' + cm[1].trim() + '」出现在任何模块之前，已忽略'); continue; }
      cur.children.push({ name: cm[1].trim(), layer: '', duty: '', tech: '', status: '', evidence: [] });
      continue;
    }
    if (!cur) continue;
    const target = cur.children.length ? cur.children[cur.children.length - 1] : cur;
    const fm = s.match(/^-\s*(层|职责|技术|状态|证据|连到)\s*[:：]\s*(.*)$/);
    if (!fm) continue;
    const key = fm[1], val = fm[2].trim();
    if (key === '连到'){
      if (cur.children.length) continue;                 // 子项不写「连到」（契约：忽略）
      val.split(',').forEach(item => {
        item = item.trim(); if (!item) return;
        const lm = item.match(/^(.+?)\s*[（(](.*?)[）)]\s*$/);
        cur.links.push({ name: (lm ? lm[1] : item).trim(), rel: (lm ? lm[2].trim() : '') });
      });
      continue;
    }
    if (key === '层') target.layer = val;
    else if (key === '职责') target.duty = val;
    else if (key === '技术') target.tech = val;
    else if (key === '状态') target.status = val;
    else if (key === '证据') target.evidence = splitEv(val);
  }
  const seen = new Set();
  mods.forEach(m => {
    if (seen.has(m.name)){
      warnings.push('技术地图里有重名模块「' + m.name + '」，按第一个解析。请给其中一个改名。');
      return;
    }
    seen.add(m.name);
    if (m.layer && layers.indexOf(m.layer) < 0) layers.push(m.layer);   // 首次出现顺序
    if (!m.layer) warnings.push('模块「' + m.name + '」没写层，位置可能不对。在 TECH.md 里给它补一行层。');
    if (!m.duty) warnings.push('模块「' + m.name + '」没写职责，看不出这块是干什么的。在 TECH.md 里给它补一行职责。');
    if (STATUSES.indexOf(m.status) < 0){
      warnings.push('「' + m.name + '」状态非法: \'' + m.status + '\'（允许: 设想/进行中/可用/已验证/已废弃）');
    }
  });
  if (mods.length && !mods.some(m => m.evidence.length)) warnings.push('技术地图没有证据，无法审计。');
  return { modules: mods, layers };
}
function parseChanges(text, warnings){
  text = stripComments(text);
  const internal = [], rules = [];
  let section = null;
  for (const line of text.split(/\r\n?|\n/)){
    const s = line.trim();
    const h2 = s.match(/^##\s*(.+)$/);
    if (h2){
      const head = h2[1].trim();
      section = head.startsWith('内部工程') ? 'internal' : (head.startsWith('变更归属') ? 'rules' : null);
      continue;
    }
    if (!section || !s) continue;
    if (s.startsWith('|')){
      const cells = s.replace(/^\|+/, '').replace(/\|+$/, '').split('|').map(c => c.trim());
      if (cells.length < 3 || !/[^\s\-:]/.test(cells[0])) continue;     // 表头行或分隔行
      if (['路径 / 变更类型', '路径', '变更类型'].indexOf(cells[0]) >= 0) continue;
      rules.push({ path: cells[0], action: cells[1], owner: cells[2] });
      continue;
    }
    const bm = s.match(/^-\s*(.+?)\s*(?:→|->)\s*归置方式\s*[:：]\s*(.+)$/);
    if (bm) internal.push({ path: bm[1].trim(), action: bm[2].trim() });
  }
  return { internal, rules };
}
function declaredSniffOk(kind, text){
  const t = stripComments(String(text == null ? '' : text));
  const heads = t.split(/\r\n?|\n/).map(l => l.trim()).filter(l => l.startsWith('## '));
  const firstHead = heads.length ? heads[0].slice(3).trim() : '';
  let cells = [];
  for (const ln of t.split(/\r\n?|\n/)){
    const s = ln.trim();
    if (s.startsWith('|')){ cells = s.replace(/^\|+/, '').replace(/\|+$/, '').split('|').map(c => c.trim()); break; }
  }
  if (kind === 'tech'){
    if (firstHead.startsWith('模块')) return true;
    return cells.length >= 3 && cells[0].indexOf('模块') >= 0 && cells.indexOf('层') >= 0 && cells.indexOf('技术') >= 0;
  }
  if (firstHead.startsWith('内部工程') || firstHead.startsWith('变更归属')) return true;
  return cells.length >= 3 && ['路径/变更类型', '路径', '变更类型'].indexOf(cells[0].replace(/\s/g, '')) >= 0
    && cells.indexOf('归置方式') >= 0 && cells.indexOf('归属') >= 0;
}
function resolveDeclared(inp){
  /* 与 resolveGlossary 同构的四级链（宿主只做 IO 注入）：.cyd.json 的 <kind> → 嗅探 → 歧义 → none */
  const kind = inp && inp.kind;
  const metaRaw = (inp && inp.metaRaw != null) ? String(inp.metaRaw) : null;
  const listMd = (inp && inp.listMd) || [];
  const readText = (inp && inp.readText) || (() => null);
  const status = { file: null, source: 'none', candidates: [] };
  let meta = null;
  if (metaRaw !== null && metaRaw.trim() !== ''){
    try{
      const parsed = JSON.parse(stripComments(metaRaw));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) meta = parsed;
    }catch(e){ meta = null; }
  }
  if (meta){
    const want = (typeof meta[kind] === 'string' && meta[kind].trim()) ? meta[kind].trim() : '';
    if (want && readText(want) != null){ status.file = want; status.source = 'explicit'; return status; }
    const rf = (typeof meta[kind + '_file'] === 'string' && meta[kind + '_file'].trim()) ? meta[kind + '_file'].trim() : '';
    if (!want && rf && readText(rf) != null){
      status.file = rf;
      status.source = (typeof meta[kind + '_source'] === 'string' && meta[kind + '_source']) ? meta[kind + '_source'] : 'explicit';
      return status;
    }
  }
  const hits = listMd.map(String)
    .filter(n => n.toLowerCase().endsWith('.md'))
    .sort()
    .filter(n => { const t = readText(n); return t != null && declaredSniffOk(kind, t); });
  if (hits.length === 1){ status.file = hits[0]; status.source = 'sniff'; return status; }
  if (hits.length > 1){ status.source = 'ambiguous'; status.candidates = hits; return status; }
  return status;
}
function parseGlossary(text, warnings, name){
  warnings = warnings || [];
  name = name || 'GLOSSARY.md';
  text = stripComments(text);
  const entries = [];
  const lines = text.split('\n');
  const cellsOf = l => l.trim().replace(/^\|+/, '').replace(/\|+$/, '').split('|').map(c => c.trim());
  for (let i = 0; i < lines.length; i++){
    if (!lines[i].trim().startsWith('|')) continue;
    const header = cellsOf(lines[i]);
    if (header.length < 3 || GLOSS_HEADERS.indexOf((header[0] || '').toLowerCase()) < 0){
      warnings.push(name + ' 第一张表我认不出来，暂时按没有术语表处理。'
        + '去术语表页看表头示例，照它改就行。');
      return entries;
    }
    let j = i + 1;
    if (j < lines.length && /^\s*\|[|\-:\s]+\|\s*$/.test(lines[j])) j++;
    while (j < lines.length && lines[j].trim().startsWith('|')){
      const cells = cellsOf(lines[j]);
      if (cells.length < 2 || !cells[0]){
        warnings.push(name + ' 有一行列数不足或标准用词为空，已忽略该行');
      } else {
        const aliases = (cells[2] || '').split(/[、，,/]/).map(a => a.trim()).filter(Boolean);
        entries.push({ term: cells[0], meaning: cells[1] || '', aliases });
      }
      j++;
    }
    return entries;
  }
  warnings.push(name + ' 里没有表格，按无术语表处理');
  return entries;
}
/* 用词漂移：别名出现在 PRODUCT/FEATURES/NOW 正文（已剥注释）。texts: [[文件名, 正文]]。 */
function glossaryDrift(entries, texts){
  const drift = [];
  entries.forEach(e => (e.aliases || []).forEach(alias => {
    if (!alias || alias === e.term) return;
    texts.forEach(([fname, body]) => {
      let n = 0, idx = 0;
      while ((idx = body.indexOf(alias, idx)) >= 0){ n++; idx += alias.length; }
      if (n) drift.push({ alias, term: e.term, file: fname, count: n });
    });
  }));
  return drift;
}
function parseNow(text, warnings){
  warnings = warnings || [];
  text = stripComments(text);
  const timeline = [], decisions = [], todos = [];
  let section = null, cur = null;
  for (const line of text.split('\n')){
    const s = line.trim();
    const h2 = s.match(/^##(?!#)\s*(.+)$/);
    if (h2){ const head = h2[1]; section = head.startsWith('时间线') ? 'tl' : head.startsWith('决策') ? 'dec' : head.startsWith('待办') ? 'todo' : null; continue; }
    const h3 = s.match(/^###\s*(D\d+)\s+(.+)$/);
    if (section === 'dec' && h3){ cur = { id: h3[1], title: h3[2].trim(), decided: '', options: [], multi: false, obsolete: false }; decisions.push(cur); continue; }
    if (section === 'tl'){
      const tm = s.match(/^-\s*(.+)$/);
      if (tm){
        const parts = tm[1].split('|').map(x => x.trim());
        const e = { dt: parts[0], text: '', evidence: [] };
        for (const p of parts.slice(1)){
          const em = p.match(/^证据\s*[:：]\s*(.+)$/);
          if (em) e.evidence = splitEv(em[1]);
          else e.text = e.text ? e.text + ' | ' + p : p;
        }
        if (!e.text){ e.text = e.dt; e.dt = ''; }
        timeline.push(e);
      }
    } else if (section === 'dec' && cur){
      const sm = s.match(/^-\s*状态\s*[:：]\s*已定\s*([A-Za-z](?:\s*[、,，\s]\s*[A-Za-z])*)\s*$/);
      if (sm){ cur.decided = sm[1].toUpperCase().replace(/[\s,，]+/g, '、'); continue; }
      // v1.5 三态：待拍板 显式清空结论；已废弃 是终态（不进「待拍板」计数，界面按废弃样式渲染）
      const pm = s.match(/^-\s*状态\s*[:：]\s*待拍板\s*$/);
      if (pm){ cur.obsolete = false; cur.decided = ''; continue; }
      const ob = s.match(/^-\s*状态\s*[:：]\s*已废弃\s*$/);
      if (ob){ cur.obsolete = true; continue; }
      const mm2 = s.match(/^-\s*多选\s*[:：]\s*是\s*$/);
      if (mm2){ cur.multi = true; continue; }
      const om = s.match(/^-\s*([A-Z])\s*[:：]\s*(.+)$/);
      if (om) cur.options.push({ key: om[1], text: om[2].trim() });
    } else if (section === 'todo'){
      const dm = s.match(/^-\s*\[( |x|X)\]\s*(.+)$/);
      if (dm) todos.push({ done: dm[1].toLowerCase() === 'x', text: dm[2].trim() });
    }
  }
  decisions.forEach(d => {
    if (!d.decided) return;
    d.decided.split('、').forEach(k => {
      if (!d.options.some(o => o.key === k)) warnings.push('决策 ' + d.id + ' 标为已定 ' + k + '，但没有对应选项');
    });
  });
  return { timeline, decisions, todos };
}
function layoutGraph(feats, warnings){
  warnings = warnings || [];
  const active = feats.filter(f => f.status !== '已废弃');
  const byName = {};
  active.forEach(f => {
    if (f.name in byName) warnings.push('功能名重复：「' + f.name + '」出现多次，依赖按首个同名解析');
    else byName[f.name] = f;
  });
  const idx = new Map(active.map((f, i) => [f, i]));
  const edges = active.map(f => f.deps.filter(d => d in byName).map(d => idx.get(byName[d])));
  const resolved = {};
  const remaining = new Set(active.map((f, i) => i));
  let changed = true;
  while (remaining.size && changed){
    changed = false;
    for (const i of [...remaining].sort((a, b) => a - b)){
      if (edges[i].every(d => d in resolved)){
        resolved[i] = edges[i].length ? Math.max.apply(null, edges[i].map(d => resolved[d])) + 1 : 0;
        remaining.delete(i);
        changed = true;
      }
    }
  }
  for (const i of [...remaining].sort((a, b) => a - b)){
    warnings.push('依赖关系存在环（涉及「' + active[i].name + '」），该节点按第 0 层布局');
    resolved[i] = 0;
  }
  /* v1.3：节点宽度按名称自适应；层间距按相邻层实际最大宽度算（与 Python 渲染器逐字同构） */
  active.forEach(f => { const d = nodeDims(f); f.w = d.w; f.h = d.h; f.lines = d.lines; });
  const layerMaxW = {};
  active.forEach((f, i) => { const lv = resolved[i] || 0; layerMaxW[lv] = Math.max(layerMaxW[lv] || 0, f.w); });
  const layerX = {};
  let prev = null;
  Object.keys(layerMaxW).map(Number).sort((a, b) => a - b).forEach(lv => {
    if (prev === null) layerX[lv] = 90 + layerMaxW[lv] / 2;
    else layerX[lv] = layerX[prev] + layerMaxW[prev] / 2 + layerMaxW[lv] / 2 + 64;
    prev = lv;
  });
  const layerY = {};
  active.forEach((f, i) => {
    const lv = resolved[i] || 0;
    const y0 = layerY[lv] === undefined ? 80 : layerY[lv];
    f.x = layerX[lv]; f.y = y0 + f.h / 2;
    layerY[lv] = y0 + f.h + 30;
  });
  return feats;
}


/* ---------- 数据组装（网页版与面板共用，两端唯一事实源） ---------- */
/* parts: { prod, feat, now, factsRaw?, ignoreRaw?, inboxRaw?, glossRaw?, glossName?, glossStatus?, workspace_uri?, updated_at? }
   inboxRaw 三态：字符串 = .inbox.jsonl 内容；null = 读取失败；不传（undefined）= 该环境本来没有这个数据源（离线网页）。
   existsFn: async path => bool */
async function assembleData(parts, existsFn){
  const warnings = [];
  const project = parseProduct(norm(parts.prod), warnings);
  const features = layoutGraph(parseFeatures(norm(parts.feat), warnings), warnings);
  const nw = parseNow(norm(parts.now), warnings);
  /* 声明类文件（v1.6）：技术地图 / 变更规则 —— 与 Python parse_tech / parse_changes 同口径 */
  const techDoc = parts.techRaw != null ? parseTech(norm(parts.techRaw), warnings) : { modules: [], layers: [] };
  const changesDoc = parts.changesRaw != null ? parseChanges(norm(parts.changesRaw), warnings) : { internal: [], rules: [] };
  /* 术语表（可选）与用词漂移（v1.3，与 Python 渲染器同口径） */
  let glossary = [], drift = [];
  if (parts.glossRaw != null){
    glossary = parseGlossary(norm(parts.glossRaw), warnings, parts.glossName || 'GLOSSARY.md');
    drift = glossaryDrift(glossary, [
      ['PRODUCT.md', stripComments(norm(parts.prod))],
      ['FEATURES.md', stripComments(norm(parts.feat))],
      ['NOW.md', stripComments(norm(parts.now))]]);
    drift.forEach(d => warnings.push('用词漂移：别名「' + d.alias + '」在 ' + d.file + ' 出现 ' + d.count + ' 次，标准用词是「' + d.term + '」'));
  }
  const normPath = p => String(p).replace(/\\/g, '/');
  const pairs = [];
  const collect = (owner, list) => (list || []).forEach(p => {
    const rel = normPath(p);
    pairs.push({ owner, path: rel, err: evError(rel) });
  });
  features.forEach(f => { collect(f.name, f.evidence); (f.children || []).forEach(c => collect(f.name + ' / ' + c.name, c.evidence)); });
  project.journey.forEach(j => collect('使用流程', j.evidence));
  nw.timeline.forEach(t => collect('时间线', t.evidence));
  /* 技术地图的证据也进"归置 + 证据红线"（与功能证据同纪律）；变更规则是 glob，只参与归置/单列 */
  (techDoc.modules || []).forEach(m => {
    collect('技术地图 / ' + m.name, m.evidence);
    (m.children || []).forEach(c => collect('技术地图 / ' + m.name + ' / ' + c.name, c.evidence));
  });
  const uniq = [...new Set(pairs.filter(p => !p.err).map(p => p.path.replace(/^\//, '')))];
  const exMap = {};
  await Promise.all(uniq.map(async p => { try{ exMap[p] = await existsFn(p); }catch(e){ exMap[p] = false; } }));
  const withEx = list => (list || []).map(p => {
    const rel = normPath(p);
    if (evError(rel)) return { path: rel, exists: false };
    const key = rel.replace(/^\//, '');
    return { path: key, exists: !!exMap[key] };
  });
  features.forEach(f => { f.evidence = withEx(f.evidence); (f.children || []).forEach(c => { c.evidence = withEx(c.evidence); }); });
  project.journey.forEach(j => j.evidence = withEx(j.evidence));
  nw.timeline.forEach(t => t.evidence = withEx(t.evidence));
  const invalid = [...new Set(pairs.filter(p => p.err).map(p => p.path))];
  /* S3 部分失效（契约 L560）：与 S1 同一个载体 = `.versions/` 最近一份 TECH.md（`parts.techPrevRaw`）。
     **无快照 → null（fail-closed）**：渲染层据此不产 ⚠ / .snote（不许假装"没问题"）。
     判据逐条对齐 Python `compute_tech_stale`：只比**两边都在**的模块；分母 = **快照**为该模块声明的证据条数；
     分子 = 其中现在不存在的条数；`0 < 失效率` 的模块计入 modules（全灭也算）。
     存在性口径 = `evError` 越界 → false，否则 `existsFn`（与 matrix 同一份，不另写一套 stat 规则）。 */
  let techStale = null;
  if (parts.techPrevRaw != null){
    const prevDoc = parseTech(norm(parts.techPrevRaw), []);
    const curNames = new Set((techDoc.modules || []).map(m => m.name));
    const exCache = {};
    const existsOf = async p => {
      const rel = normPath(p);
      if (exCache[rel] !== undefined) return exCache[rel];
      let ok = false;
      if (!evError(rel)){ try { ok = await existsFn(rel.replace(/^\//, '')); } catch (e){ ok = false; } }
      exCache[rel] = ok; return ok;
    };
    const staleMods = []; let missTot = 0, declTot = 0;
    for (const pm of (prevDoc.modules || [])){
      if (!curNames.has(pm.name)) continue;
      const paths = pm.evidence || [];
      if (!paths.length) continue;
      let miss = 0;
      for (const p of paths){ if (!(await existsOf(p))) miss++; }
      declTot += paths.length; missTot += miss;
      if (miss > 0) staleMods.push(pm.name);
    }
    if (staleMods.length && declTot > 0)
      techStale = { modules: staleMods, ratio: Math.round(missTot / declTot * 10000) / 10000 };
  }
  /* tech_stale 非空 ⇒ 一条 WARN —— **推的时机见下面 S1 之后**（warnings[] 有序，两端顺序必须一致）。 */
  const ignore = parts.ignoreRaw ? norm(parts.ignoreRaw).split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#')) : [];
  let facts = [], factsError = '', factsSource = '', factsGeneratedAt = '';
  if (!parts.factsRaw) factsError = 'missing';
  else { try {
    const parsed = JSON.parse(norm(parts.factsRaw));
    const fmeta = (parsed && typeof parsed === 'object') ? parsed : {};
    facts = fmeta.items || [];
    factsSource = fmeta.source || '';
    factsGeneratedAt = typeof fmeta.generated_at === 'string' ? fmeta.generated_at : '';
  } catch (e){ factsError = 'corrupt'; } }
  const evSet = new Set(pairs.map(p => p.path.replace(/^\//, '')));
  let pending = 0;
  const fd = facts.map(it => {
    const p = normPath(it.path || '');
    const hit = evSet.has(p) || ignore.some(pat => globMatch(p, pat));
    if (!hit) pending++;
    return { path: p, kind: it.kind || '', change: it.change || '', pending: !hit };
  });
  /* .dashboard-ignore 旧写法失效 WARN —— **行为式判据**（契约 :504-521）+ 文案逐字 deck:599。
     作用域＝**两端**（ignore 解析与匹配两端各有实现，warnings[] 由 dual_parser_diff.py 逐条比对）。
     为什么行为式：看形状必然误报 —— ① 漏"旧版 * 跨 /"，`*.log` 旧版命中 dist/app.log、新版只命中根目录；
     ② "含大写"会误报"目录名真有大写"的情形（模式串本身判不出大小写是否与实际路径不符）。
     参照集合 = 本轮 .facts.json 的 items[].path；旧语义 = 大小写不敏感 + `*`/`?` 跨 `/` + 支持字符类；
     判据 = 存在 p 使「旧命中 ∧ 新 globMatch 不命中」⇒ 失效。两边都命中/都不命中 ⇒ 不报。
     `!` 取反不列入判据（旧版也不支持，非升级问题）。X=首个、N=总数，一条 WARN 覆盖全部。 */
  const _oldHit = (p, pat) => {
    const pl = String(p).toLowerCase(), pt = String(pat).toLowerCase();
    let rx = '';
    for (let i = 0; i < pt.length; i++){
      const ch = pt[i];
      if (ch === '*') rx += '.*';
      else if (ch === '?') rx += '[\\s\\S]';
      else if (ch === '['){
        const close = pt.indexOf(']', i + 1);
        if (close > i){ rx += pt.slice(i, close + 1); i = close; }
        else rx += '\\[';
      } else rx += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    try { return new RegExp('^' + rx + '$').test(pl); } catch (e){ return false; }
  };
  const _refPaths = facts.map(it => normPath(it.path || ''));
  const _badIgnore = [];
  ignore.forEach(pat => {
    if (pat.startsWith('!')) return;
    if (_refPaths.some(p => _oldHit(p, pat) && !globMatch(p, pat))) _badIgnore.push(pat);
  });
  if (_badIgnore.length){
    warnings.push('.dashboard-ignore 里「' + _badIgnore[0] + '」等 ' + _badIgnore.length + ' 条写法不再生效。'
      + '旧写法和新版本的匹配规则不一样。' + '照实际路径改一下写法就行。');
  }
  const missing = uniq.filter(p => !exMap[p]);
  const noVerify = features.filter(f => f.status === '已验证' && !f.verify).map(f => f.name);
  features.forEach(f => (f.children || []).forEach(c => { if (c.status === '已验证' && !c.verify) noVerify.push(f.name + ' 的子项 ' + c.name); }));
  const counts = {};
  STATUSES.forEach(s => counts[s] = 0);
  features.forEach(f => counts[f.status] = (counts[f.status] || 0) + 1);
  counts.total_active = counts['设想'] + counts['进行中'] + counts['可用'] + counts['已验证'];
  const seen = {}; const matrix = [];
  for (const pr of pairs){
    const key = pr.path;
    if (!seen[key]){
      seen[key] = { path: key, owners: [pr.owner], kind: kindOf(key), exists: !pr.err && !!exMap[key.replace(/^\//, '')] };
      matrix.push(seen[key]);
    } else if (!seen[key].owners.includes(pr.owner)) seen[key].owners.push(pr.owner);
  }
  matrix.sort((a, b) => a.path < b.path ? -1 : 1);
  // 缺失 .facts.json 只表示还没采集（提示即可）；损坏表示门禁不可用（不健康）
  const ok = missing.length === 0 && invalid.length === 0 && pending === 0 && factsError !== 'corrupt' && noVerify.length === 0;
  /* ---- 声明类文件（v1.6）：归置算入 / 审计单列 / 三组漂移（与 Python render() 同口径）----
     tech 侧单位是"文件"、changes 侧声明的是 glob（单位"路径/条目"）→ 两条 WARN 的措辞与 §16.4 标签同单位。 */
  const techEv = [];
  (techDoc.modules || []).forEach(m => {
    (m.evidence || []).forEach(p => techEv.push(normPath(p)));
    (m.children || []).forEach(c => (c.evidence || []).forEach(p => techEv.push(normPath(p))));
  });
  const ownedPaths = new Set(pairs.filter(p => p.owner.indexOf('技术地图 /') !== 0).map(p => p.path.replace(/^\//, '')));
  const techOnly = techEv.filter(p => !ownedPaths.has(p.replace(/^\//, '')));
  const declaredPaths = changesDoc.internal.concat(changesDoc.rules).map(r => r.path);
  const changesOnly = declaredPaths.filter(p => ![...ownedPaths].some(o => globMatch(o, p)));
  if (techOnly.length > 10) warnings.push('仅由技术地图引用的文件已有 ' + techOnly.length + ' 个，请复核这些模块的证据是否还准确。');
  if (changesOnly.length > 10) warnings.push('仅由变更规则声明的路径已有 ' + changesOnly.length + ' 条，请复核这些规则是否还准确。');
  const featNames = new Set(features.map(f => f.name));
  changesDoc.internal.concat(changesDoc.rules).forEach(r => {
    const om = String(r.owner || '').match(/功能\s*[「『](.+?)[」』]/);
    if (om && !featNames.has(om[1])){
      warnings.push('变更规则可能过期：规则「' + r.path + '」引用的功能「' + om[1] + '」已不在功能地图里，请确认。');
    }
  });
  /* 漂移②：载体 = 上一轮 .versions/ 的 TECH.md（由宿主注入 techPrevRaw）；没注入 → 不产（fail-closed） */
  if (parts.techPrevRaw != null){
    const prevDoc = parseTech(norm(parts.techPrevRaw), []);
    const curByName = {};
    (techDoc.modules || []).forEach(m => curByName[m.name] = m);
    (prevDoc.modules || []).forEach(pm => {
      const cm = curByName[pm.name];
      if ((pm.evidence || []).length && cm && !(cm.evidence || []).length){
        warnings.push('技术地图可能过期：模块「' + pm.name + '」的证据都不在了，请确认。');
      }
    });
  }
  /* S3 的那条 WARN **在这里**推（不是算 tech_stale 的地方）：warnings[] 是**有序**的，
     两端顺序必须一致 —— Python 的顺序是 S1（漂移②）在前、S3 在后，所以 JS 也照这个顺序推。
     （先算 tech_stale、后在这里 push：算出来只是为了数据字段 + 这条 WARN。）
    文案取自 `techStaleLines()`（**唯一生成处**）；三句各推一条，与 Python 的三条逐条对应。 */
  if (techStale) techStaleLines(techStale).forEach(w => warnings.push(w));
  /* S4 搬迁检测（判据与 Python `compute_moved_evidence` **同源**）：本轮 .facts.json 里 change === 'deleted'
     的路径 ∩ 上面 techEv / features / project.journey / nw.timeline 的证据。两侧都没命中 ⇒ null
     （**fail-closed 不产**，不许"有删除就报一句"，那等于恒真信号）。
     ⚠ 取路径时**必须**用 `evPath`：这里的 `f.evidence` / `j.evidence` / `t.evidence` 已在上面被 `withEx`
     换成了 `{path, exists}` 对象（`techDoc` 的证据**没有**被换，还是字符串）—— 两种形状都得吃。
     规范化只走 `normPath`（反斜杠→正斜杠），与 Python 逐字同口径；名字按声明顺序去重。 */
  const evPath = p => normPath((p && typeof p === 'object') ? (p.path || '') : p);
  const movedEv = (() => {
    const deleted = new Set();
    fd.forEach(it => { if (it && it.change === 'deleted'){ const p = normPath(it.path || ''); if (p) deleted.add(p); } });
    if (!deleted.size) return null;
    const hit = list => (list || []).some(p => deleted.has(evPath(p)));
    const add = (seq, name) => { if (seq.indexOf(name) < 0) seq.push(name); };
    const techNames = [], featNames = [];
    (techDoc.modules || []).forEach(m => {
      const ev = (m.evidence || []).slice();
      (m.children || []).forEach(c => (c.evidence || []).forEach(p => ev.push(p)));
      if (hit(ev)) add(techNames, m.name);
    });
    features.forEach(f => {
      const ev = (f.evidence || []).slice();
      (f.children || []).forEach(c => (c.evidence || []).forEach(p => ev.push(p)));
      if (hit(ev)) add(featNames, f.name);
    });
    if ((project.journey || []).some(j => hit(j.evidence))) add(featNames, '使用流程');
    if ((nw.timeline || []).some(t => hit(t.evidence))) add(featNames, '时间线');
    if (!techNames.length && !featNames.length) return null;
    return { tech: techNames, features: featNames };
  })();
  if (movedEv) movedEvidenceLines(movedEv).forEach(w => warnings.push(w));
  /* 漂移③：不需要历史 —— 本轮 .facts.json 的顶层目录 vs 本轮模块证据覆盖 */
  const coveredTops = new Set(techEv.map(p => String(p).split('/')[0]));
  const seenTops = [];
  fd.forEach(it => {
    const top = String((it && it.path) || '').split('/')[0];
    if (top && seenTops.indexOf(top) < 0) seenTops.push(top);
  });
  seenTops.forEach(top => {
    if (!coveredTops.has(top)) warnings.push('新目录 ' + top + ' 未进技术地图，请确认是内部工程还是漏了模块。');
  });

  /* 术语表来源：文件名不写死 —— 宿主（面板 / 离线页）先按 .cyd.json 或表头嗅探解析，再把真实文件名传进来 */
  const glossFile = parts.glossName || null;
  const glossStatus = parts.glossStatus || { file: glossFile, source: glossFile ? 'sniff' : 'none', candidates: [] };
  /* `.cyd.json` 出的岔子由宿主以 flag 喂进来（契约 v1.6 补录 `meta_error` / `meta_missing`）：
     各产一条与 Python **逐字同文案**的 WARN（copy-deck §16.6 定稿，清单 #11/#12）。
     缺 flag = **降级**（旧宿主）：不产 WARN、不报错，也不得当成"已检查且无问题"。 */
  /* `.cyd.json.format`（契约 L494）：判据与 Python `cyd_format_state` **同一套、同一句**
   （文案已按 copy-deck §16.6 定稿）。
     缺失 ⇒ 视为 1（向后兼容）；非整数 ⇒ 按只读处理。 */
  const _metaParsed = (() => { try { return parts.metaRaw ? JSON.parse(stripComments(String(parts.metaRaw))) : null; } catch (e){ return null; } })();
  const _fmt = (_metaParsed && typeof _metaParsed === 'object' && _metaParsed.format !== undefined) ? _metaParsed.format : 1;
  const _fmtBad = (typeof _fmt !== 'number' || !Number.isInteger(_fmt));     // B：格式无法解析（下一步＝改回一个数字）
  const _wv = (_metaParsed && typeof _metaParsed === 'object' && _metaParsed.writer && typeof _metaParsed.writer === 'object') ? _metaParsed.writer.skill : null;
  const _wcmp = semverCmp(_wv, CYD_SKILL_VERSION);
  /* **A（deck:600 定稿）**：两个信号合成**一条** —— `format > 支持` **或** `writer.skill > 当前`。
     尺子：**下一步相同 ⇒ 合并**（都是"升级插件"）；**下一步不同 ⇒ 分开**（B 见下）✓。
     只看 `skill`、不看 `at`（at 每次真写都变 ⇒ 进比对会假红 ✗）；解析失败/版本为空 ⇒ 不产（fail-safe）。
     **A 与 B 互斥**：同一份文件不可能既"比插件新"又"格式无法解析" ⇒ 用 else-if 保证**不会同时产** ✓。
     文案逐字取 deck；**不带"待定稿"之类工程前缀**（那是内部状态泄漏到界面 ✗）。 */
  const _aNewer = (!_fmtBad && _fmt > CYD_FORMAT_SUPPORTED) || (_wcmp !== null && _wcmp > 0);
  if (_aNewer){
    warnings.push('.cyd.json 是更新版插件写的，当前版本读不全。'
      + '所以这次不改它，免得把新内容写坏。' + '升级插件后再看就行。');
  } else if (_fmtBad){
    warnings.push('.cyd.json 里的格式版本写得不对，读不出来。'
      + '所以这次不改它，先按只读用。' + '把这一项改回一个数字就行。');
  }
  if (glossStatus.meta_error === true){
    warnings.push('.cyd.json 不是合法 JSON，已忽略（术语表按自动识别处理）');
  } else if (typeof glossStatus.meta_missing === 'string' && glossStatus.meta_missing){
    warnings.push('.cyd.json 指定的术语表「' + glossStatus.meta_missing + '」不存在，已退回自动识别');
  }
  /* 歧义是数据装配的结论，不是界面的事：契约（dashboard-format.md 术语表一节 + warnings 一节）要求
     歧义时进 warnings 一条「术语表找到 N 个候选…」，与 Python 渲染器同文案同位置。
     候选文件名只可能由宿主喂进来（共享核没有列目录能力），所以这里只负责产出这条警告。 */
  if (glossStatus.source === 'ambiguous' && (glossStatus.candidates || []).length){
    warnings.push('术语表找到 ' + glossStatus.candidates.length + ' 个候选（'
      + glossStatus.candidates.join(' / ') + '），暂时按没有术语表处理。告诉我用哪一个，我来指定术语表。');
  }
  /* 待生效条数与逐条明细（v1.5）：以 .inbox.jsonl 为准，不做本地增量；**同一次解析**出计数与明细
     （契约明令不得第二次读取）。undefined 表示这个环境没有该数据源（离线网页内刷新），此时不渲染徽章。 */
  let inboxPending, inboxItems;
  if (parts.inboxRaw !== undefined){
    if (parts.inboxRaw === null){ inboxPending = null; inboxItems = null; }   // 读取失败：不猜
    else {
      const items = [];
      norm(parts.inboxRaw).split('\n').forEach(line => {
        const s = line.trim();
        if (!s) return;
        let obj = null;
        try{ obj = JSON.parse(s); }catch (e){ obj = null; }
        if (!obj || typeof obj !== 'object' || Array.isArray(obj)){
          warnings.push('.inbox.jsonl 里有一行不是合法 JSON 对象，已跳过该行');
          return;
        }
        items.push({
          type: typeof obj.type === 'string' ? obj.type : '',
          text: typeof obj.text === 'string' ? obj.text : '',
          ts: typeof obj.ts === 'string' ? obj.ts : ''
        });
      });
      inboxPending = items.length;
      inboxItems = items;
    }
  }
  return { project, features, timeline: nw.timeline, decisions: nw.decisions, todos: nw.todos, counts,
    glossary, glossary_file: glossFile,
    tech: techDoc, changes: changesDoc,
    workspace_uri: parts.workspace_uri, updated_at: parts.updated_at || fmtDT(new Date()),
    health: { ok, matrix, evidence_missing: missing, evidence_invalid: invalid,
              facts_pending: pending, facts_error: factsError, source: factsSource,
              facts_generated_at: factsGeneratedAt,
              inbox_pending: inboxPending,
              inbox_items: inboxItems,
              verify_missing: noVerify,
              glossary_drift: drift, glossary_status: glossStatus,
              tech_status: parts.techStatus || { file: null, source: techDoc.modules.length ? 'sniff' : 'none', candidates: [] },
              changes_status: parts.changesStatus || { file: null, source: changesDoc.rules.length ? 'sniff' : 'none', candidates: [] },
              declared_refs: { changes_only: changesOnly, tech_only: techOnly },
              tech_stale: techStale,
              facts: fd, ignore, warnings } };
}

/* 样式只注入一次。导出给宿主：面板的空态/错误态在 init 之前就要用这份样式，不能各写一套内联值。 */
function ensureCss(){
  if (!CSS || typeof document === 'undefined' || document.querySelector('style[data-cyd-core]')) return;
  const st = document.createElement('style');
  st.setAttribute('data-cyd-core', '1');
  st.textContent = CSS;
  document.head.appendChild(st);
}
/* 窄栏断点按**容器宽度**判定：面板塞在约 360px 的右侧栏里，而视口仍是 1920px，视口断点没有意义。 */
const NARROW_MAX = 620;
function syncNarrow(el){
  const w = el.clientWidth || 0;
  el.classList.toggle('narrow', w > 0 && w < NARROW_MAX);
}
function initDashboard(rootEl, env){
  ensureCss();
  let DATA = env.data;
let lastJson = JSON.stringify(env.data);
let docKeyHandler = null;   // 全局只保留一个 Esc 处理器：init 幂等
  const qs = s => rootEl.querySelector(s);
  const qsa = s => Array.from(rootEl.querySelectorAll(s));
  rootEl.classList.add('cyd-app');
  if (env.fullGraph) rootEl.classList.add('fullgraph');
  /* 整页模式（会话页顶部「功能地图」tab）：只渲染关系图并铺满可用高度。
     宿主自己的标签栏与输入框保持原样——本插件只裁剪自己的版面，不碰宿主 DOM。 */
  /* 整页模式（会话页顶部「功能地图」tab）**是可进可出的视图，不是单向门**：
     `IMMERSIVE` 是 **per-mount 的局部变量**（本函数的 `rootEl`/`env` 各挂载点各一份，真机实测互不污染），
     所以退出只需就地摘掉自己那份的 `.cyd-immersive` 再重渲染。 */
  let IMMERSIVE = !!(env.fullGraph && env.onlyTab);
  if (IMMERSIVE) rootEl.classList.add('cyd-immersive');
  /* Esc 退整页：**整页时也执行**（上一版把这类处理挂进了「整页时不执行」的分支，等于没有出口）。
     优先级：**先进全屏则退全屏**——全屏激活时本处理器主动让位（`document.fullscreenElement` 判定），
     由全屏那条链处理；两者不会同时生效（整页里不提供全屏）。 */
  function exitImmersive(){
    if (!IMMERSIVE) return false;
    IMMERSIVE = false;
    rootEl.classList.remove('cyd-immersive');
    renderAll();
    return true;
  }
  if (IMMERSIVE){
    document.addEventListener('keydown', function cydEscFromImmersive(e){
      if (e.key !== 'Escape' || document.fullscreenElement || !IMMERSIVE) return;
      e.stopPropagation();
      exitImmersive();
    });
  }
  if (SHELL) rootEl.innerHTML = SHELL;
  /* 窄栏（右侧栏 / 小窗口）：不隐藏 header 与掌控条，只重排。监听器挂在元素上，重挂不会叠加。 */
  syncNarrow(rootEl);
  if (typeof ResizeObserver !== 'undefined'){
    if (rootEl.__cydNarrowRO) rootEl.__cydNarrowRO.disconnect();
    rootEl.__cydNarrowRO = new ResizeObserver(() => syncNarrow(rootEl));
    rootEl.__cydNarrowRO.observe(rootEl);
  }

const esc = s => String(s==null?'':s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const SMAP = {"设想":1,"进行中":2,"可用":3,"已验证":4,"已废弃":5};
const SCOLOR = {"设想":"var(--gray)","进行中":"var(--accent)","可用":"var(--warn)","已验证":"var(--ok)","已废弃":"var(--ink2)"};
/* SSOFT（状态浅底）已删：2026-10-13 用户裁决"节点改卡片（单层 1px 柔和描边 + 极浅底）、
   状态改用左侧小圆点" ⇒ 状态色不再进节点底色，卡片化后没有任何使用点。
   单一执行路径：删掉定义，不留"定义了但没人用"的死常量。 */
const TL_SHOW = env.timelineShow || 30;
let currentTab = 'project', currentFilter = 'all';
const expanded = new Set();   // 关系图里展开子项的功能名（本挂载周期内保持，重渲染不丢）
/* ---------- 关系图几何常量（SVG 世界坐标，随 gWorld 的 scale 缩放）----------
   与 design-tokens 的 HTML 间距节奏（6/8/12/18/24）是**两套数值域**，不互相换算：图形比例正确优先。
   依据 graph-visuals.md §A2/§A3/§B2/§D2（§H-5 记明理由）。 */
const CHILD_DROP = 22, CHILD_CORNER_R = 6, CHILD_GAP_X = 16, CHILD_GAP_Y = 20;
const CHILD_MIN_W = 120, CHILD_MAX_W = 180, CHILD_PAD = 36, CHILD_H = 34, CHILD_H2 = 50;
const CHILD_PER_ROW_WIDE = 4, CHILD_PER_ROW_NARROW = 2;
const CHILD_SPINE_PAD = 14;   // 多行时侧干离最左子项左边缘的距离（保证干线不穿框）
const GHOST_STUB = 56, GHOST_STUB_MIN = 16, GAP_AFTER_STUB = 8, FLOW_MAX = 30;
/* 矩形相交（容差 0）—— 布局占位求解与标记避让共用的唯一一份判定 */
function boxHit(a, b){ return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h; }
/* ---------- V4 变更角标：fail-closed 的记忆载体（读不到/写不进就一律不显示） ---------- */
const SEEN_KEY = 'cyd.seen.v1';
let seenSnap = null, seenLoaded = false, seenDisabled = false;
const chgSeen = new Set();          // 本次打开期间"状态变化且证据可解释"的功能名
const chgMarks = new Map();         // 功能名 → 角标元素（点开面板即时撤掉，不必重渲染）
let chgLoadedOnce = false;          // 快照只在本挂载周期第一次渲染时读一次
/* ---------- V4 变更角标（graph-visuals §E3：三条同时成立才显示，读不到就不显示，不许猜） ----------
   这四个函数与上面的状态同处 initDashboard 作用域：它们要读 DATA（快照与时间线都在其中）。 */
function curStatuses(){
  const m = {};
  (DATA.features || []).forEach(f => { m[f.name] = f.status; });
  return m;
}
function loadSeen(){
  if (seenLoaded) return seenSnap;
  seenLoaded = true;
  try{ const raw = localStorage.getItem(SEEN_KEY); seenSnap = raw ? JSON.parse(raw) : null; }
  catch(e){ seenDisabled = true; seenSnap = null; }   // 隐私模式/读不到 → 永不显示
  return seenSnap;
}
function saveSeen(){
  if (seenDisabled) return;
  try{
    localStorage.setItem(SEEN_KEY, JSON.stringify({
      ts: Date.now(), statuses: curStatuses(), tlLen: (DATA.timeline || []).length
    }));
  }catch(e){ seenDisabled = true; }                   // 写失败 → 此后不显示（宁可没有）
}
/* 三条同时成立：①有上次观察快照 ②状态确实不同 ③有时间线最近 3 条或版本 diff 能解释 */
function markChanges(){
  const snap = loadSeen();
  const out = new Set();
  if (seenDisabled || !snap || !snap.statuses) return out;
  const recent = (DATA.timeline || []).slice(0, 3);
  (DATA.features || []).forEach(f => {
    const old = snap.statuses[f.name];
    if (old === undefined || old === f.status) return;
    const tlHit = recent.some(t => String(t.text || '').indexOf(f.name) >= 0);
    const vText = (DATA.versions && DATA.versions.text) || '';
    if (!tlHit && !(vText && vText.indexOf(f.name) >= 0)) return;   // 两条都读不到 → 不显示
    out.add(f.name);
  });
  return out;
}
/* 证据回填只在 <title> 里（§E4）：有旧值就写「状态从 X 变为 Y」，有时间线日期再接「· 最近更新 …」 */
function chgTitle(f){
  const snap = loadSeen();
  const old = snap && snap.statuses ? snap.statuses[f.name] : undefined;
  const hit = (DATA.timeline || []).slice(0, 3).find(t => String(t.text || '').indexOf(f.name) >= 0);
  let s = (old === undefined) ? '状态已变化' : '状态从 ' + old + ' 变为 ' + f.status;
  if (hit && hit.dt) s += ' · 最近更新 ' + hit.dt;
  return s;
}
/* 关系图视图状态：跨重渲染保留。pos = 手动摆过的节点位置（按功能名记），
   tx/ty/k = 缩放平移，adjusted = 用户是否亲手调过视野（调过就不再自动 fit）。
   drag = 正在拖节点（期间到来的自动刷新先押后，避免把图重排）。 */
const gview = { tx: 0, ty: 0, k: 1, adjusted: false, pos: new Map(), drag: false, deferred: false,
  /* 降噪焦点：{kind:'node', name} | {kind:'edge', idx} | null；pinned = 点击锁住（悬停不许顶掉）。
     存内存不持久化（与"视角切换复位"同一口径）。 */
  focus: null,
  /* 幽灵标记的**选中槽记忆**：与 `pos`（手动节点位置）同款模式。
     为什么需要状态：选中的槽不可推导 —— 它取决于渲染时刻的占位/避让，是**与历史相关**的选择；
     不记住它，拖动后的重渲染就会**换槽**（用户原话："这个只要一移动就会错位"）。
     只存 `{ ci, dx, dy }`（相对节点的偏移）⇒ 位置只有**一处**算法：`f.x + dx` / `f.y + dy`。 */
  markSlots: new Map() };
/* 「功能 | 技术」视图状态（契约 §250）：**存内存、不持久化** —— 切 tab / 重渲染回默认「功能」 */
let graphView = 'features';
let graphRO = null;   // 关系图尺寸观察器（重渲染时换新，避免叠加）
let graphWinHandler = null;   // 窗口缩放兜底（重渲染时换新）
let graphEscHandler = null;   // 全屏时的 Esc 退出（重渲染时换新）
let graphFsHandler = null;    // fullscreenchange 同步（重渲染时换新）
let graphMqHandler = null;    // prefers-reduced-motion 变化 → 重画（重渲染时换新，避免堆积）
let graphFs = false;   // 关系图是否处于全屏弹窗（重渲染会重建 DOM，状态记在这儿）
/* 全屏的另两个状态必须和 graphFs 同级：renderGraph() 每次重渲染都会换新闭包，
   局部的标志位会归零 —— 那会导致「全屏中发生过重渲染 → 退出时摘不掉 cyd-immersive、
   也还原不了用户视野」。 */
let fsSaved = null;            // 进全屏前的视野（退出时还原用户亲手调过的那一份）
let fsAddedImmersive = false;  // cyd-immersive 是不是这次全屏自己加上去的（是才由我们摘掉）
/* 单板块模式（会话页顶部「功能地图」tab）：隐藏内部导航，只显示指定 section */
if (env.onlyTab){
  const navEl = qs('nav.tabs'); if (navEl) navEl.style.display = 'none';
  currentTab = env.onlyTab;
}
const ACT = () => DATA.features.filter(f => f.status !== '已废弃');
const DEPR = () => DATA.features.filter(f => f.status === '已废弃');

/* ---------- 自动链接：D 编号 → 决策卡，「功能名」→ 功能卡 ---------- */
function linkify(s){
  s = s.replace(/\bD(\d+)\b/g, '<a class="lk" data-jd="D$1">D$1</a>');
  const names = DATA.features.map(f => f.name).filter(n => n.length >= 2).sort((a, b) => b.length - a.length);
  if (names.length){
    const re = new RegExp('「(' + names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')」', 'g');
    s = s.replace(re, '<a class="lk" data-jf="$1" tabindex="0" role="button">「$1」</a>');
  }
  return s;
}


/* ---------- 证据：链接与否由宿主决定 ----------
   控件位一律内联 SVG（不依赖 emoji 字体）：路径片只显示文件名，复制键用单色 SVG 图标。 */
const COPY_ICON = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true">'
  + '<rect x="5.5" y="5.5" width="8" height="8" rx="1.6" stroke="currentColor"/>'
  + '<path d="M10.5 3.5v-1a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h1" stroke="currentColor"/></svg>';
function evHtml(list){
  return (list || []).map(e => {
    const disp = esc(truncMid(e.path));
    const full = esc(e.path);
    const cp = '<button class="btn mini" data-cp="' + full + '" title="复制完整路径">' + COPY_ICON + '</button>';
    const canOpen = e.exists && env.evidenceAction;
    const url = !canOpen && e.exists && env.evidenceUrl ? env.evidenceUrl(e.path) : null;
    if (canOpen) return '<span class="evrow"><button class="btn mini" data-ev="' + full + '" title="' + full + '（点击打开）">' + disp + '</button>' + cp + '</span>';
    if (url) return '<span class="evrow"><a href="' + url + '" target="_blank" rel="noopener" title="' + full + '（在浏览器中打开）">' + disp + '</a>' + cp + '</span>';
    if (!e.exists) return '<span class="evrow"><a class="miss" title="' + full + '（路径不存在）">' + disp + '</a></span>';
    return '<span class="evrow"><button class="btn mini" data-cp="' + full + '" title="' + full + '（点击复制完整路径）">' + disp + '</button></span>';
  }).join('');
}

/* ---------- 掌控条（徽章，全部可点；「上次采集」只在真有采集时间时才出现） ---------- */
function renderStrip(){
  const d = DATA, active = d.counts.total_active || 0, verified = d.counts['已验证'] || 0;
  const pending = d.decisions.filter(x => !x.decided).length;
  const collected = fmtRel(d.health && d.health.facts_generated_at);
  /* pill 高度固定（CSS 88px），值超 2 行由 -webkit-line-clamp 省略；完整原文进 title（鼠标悬停可见）。 */
  const val = v => { const s = stripMd(v); return '<div class="v" title="' + esc(s) + '">' + esc(s) + '</div>'; };
  /* ⏳ 待生效 N 条（v1.5）：N 以 .inbox.jsonl 文件为准，不做本地增量；底色仍由 ok 决定。
     0 与「字段缺失（离线网页）」都不渲染；null（读取失败）显示 —，不猜数字。 */
  const inboxN = d.health ? d.health.inbox_pending : undefined;
  /* 离线导出页带的是导出时刻的真实值，照常渲染，但 title 要注明它不会自动更新（copy-deck §1/§8.6） */
  const inboxTitle = env.browserTab ? ' title="导出时刻的待生效条数；网页版不会自动更新"' : '';
  const inboxPill = (inboxN === undefined || inboxN === 0) ? ''
    : '<button class="pill pending" data-act="inbox"' + inboxTitle + '><div class="k">⏳ 待生效 </div>'
      + val(inboxN === null ? '—' : inboxN + ' 条') + '</button>';
  const h =
    '<button class="pill" data-act="stage" title="当前方向"><div class="k">当前阶段</div>' + val(d.project.stage || '—') + '</button>'
    + '<div class="pill static"><div class="k">数据更新于</div><div class="v" title="' + esc(stripMd(d.updated_at)) + '"><span class="vtxt">' + esc(stripMd(d.updated_at)) + '</span> <button class="btn mini" id="updBtn" title="重新读取并刷新页面">更新</button></div></div>'
    + (collected ? (() => {
        /* 久未采集（②：与 tech_stale 同族）：⚠ + 悬停说明；文案取自 `factsStaleLines()`（**唯一生成处**，
           copy-deck §16.6 定稿三句：数据旧了 / 刷新没用 / 怎么触发），标题里带上采集时刻作为语境。 */
        const age = factsStaleDays(d.health && d.health.facts_generated_at);
        const ttl = age === null ? '' : ' title="上次采集是 ' + esc(stripMd(d.health.facts_generated_at))
          + '。' + factsStaleLines(age).join('') + '"';
        return '<div class="pill static' + (age === null ? '' : ' alert') + '"' + ttl + '><div class="k">⏱ 上次采集'
          + (age === null ? '' : ' ⚠') + '</div>' + val(collected) + '</div>';
      })() : '')
    + '<button class="pill" data-act="verify" title="去验证"><div class="k">功能验证</div>' + val('✅ ' + verified + ' / ' + active) + '</button>'
    + '<button class="pill ' + (pending ? 'alert' : 'good') + '" data-act="decide" title="拍板中心"><div class="k">等你拍板</div>' + val(pending ? '⚠ ' + pending + ' 件' : '✅ 无') + '</button>'
    + '<button class="pill ' + (d.health.ok ? 'good' : 'alert') + '" data-act="health" title="' + (d.health.facts_error === 'missing' ? '还没采集过变更，说一句「更新仪表盘」即可' : '查看完整审计') + '"><div class="k">数据健康</div>' + val(d.health.facts_error === 'missing' ? '⚠ 未采集' : (d.health.ok ? '✅ 完整' : '⚠ 待整理')) + '</button>'
    + inboxPill;
  qs('#strip').innerHTML = h;
  qs('#projName').firstChild.textContent = d.project.name + ' ';
  /* 项目名与工具名相同时，副标题会变成「X（由 X 生成）」——隐藏它（design-tokens §12.10） */
  const by = qs('.brand .by');
  if (by) by.style.display = (d.project.name === 'control-your-development') ? 'none' : '';
  if (env.browserTab) document.title = d.project.name + ' · 开发仪表盘';
  qsa('#strip [data-act]').forEach(b => b.onclick = () => stripAct(b.dataset.act));
  qs('#updBtn').onclick = e => { e.stopPropagation(); doRefresh(); };
}
function stripAct(a){
  if (a === 'stage'){ gotoTab('project'); flashEl('cardIntro'); }
  else if (a === 'verify'){ gotoTab('features'); }
  else if (a === 'decide'){ openDecisionCenter(); }
  else if (a === 'inbox'){ openInboxSheet(); }
  else if (a === 'health'){ openAudit(); }
}
/* ⏳ 待生效明细浮层（copy-deck §8.6）：逐条标注类型，不计数的 null 态显式说"读不到" */
function inboxType(it){
  /* 类型标注：decide→拍板 / verify→验证 / command→指令 / ask→提问；
     `command` 且文本以待办固定句式开头 → 待办（可精确判定，契约「待办」三种环境）。 */
  if (it.type === 'command' && it.text.indexOf('待办「') === 0) return ['待办', 'b-x3'];
  if (it.type === 'decide') return ['拍板', 'b-x2'];
  if (it.type === 'command') return ['指令', 'b-x1'];
  if (it.type === 'verify') return ['验证', 'b-x4'];
  if (it.type === 'ask') return ['提问', 'b-x1'];
  /* 未登记的类型**原样显示原文**（中性徽章）——不兜成「指令」，那是猜语义（队长裁定）。
     type 为空串时给中性占位「未知类型」。 */
  return [it.type ? it.type : '未知类型', 'b-x1'];
}
function openInboxSheet(){
  const h = DATA.health || {};
  const n = h.inbox_pending;
  const items = h.inbox_items;
  const title = '⏳ 待生效' + ((n === null || n === undefined) ? '' : '（' + n + ' 条）');
  let body;
  if (items === null || items === undefined){
    body = '<p class="snote">读不到待生效明细，刷新面板后重试。</p>';
  } else if (!items.length){
    body = '<p class="snote">暂无</p>';
  } else {
    body = '<div class="stablewrap"><table class="stable"><tr><th>类型</th><th>内容</th><th>时间</th></tr>'
      + items.map(it => {
        const t = inboxType(it);
        return '<tr><td><span class="badge ' + t[1] + '">' + t[0] + '</span></td>'
          + '<td class="itext">' + esc(it.text) + '</td>'
          + '<td>' + esc(fmtRel(it.ts, true)) + '</td></tr>';
      }).join('')
      + '</table></div>';
  }
  openSheet(title, body);
}
function gotoTab(name){ const b = qs('nav.tabs button[data-tab="' + name + '"]'); if (b) b.click(); }
function flashEl(id){
  const el = qs('#' + id); if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1600);
}

/* ---------- 项目 Tab ---------- */
function renderProject(){
  const p = DATA.project;
  let h = '<div class="card" id="cardIntro"><h3>项目简介</h3><p class="lede">' + linkify(esc(p.intro || '（尚未填写项目简介）')) + '</p>';
  const tags = [];
  if (p.direction) tags.push(['当前方向', p.direction]);
  if (p.next) tags.push(['下一步', p.next]);
  /* 标签片 + 正文两段式：长正文在标签右侧折行，不会把蓝底标签撑成两行（design-tokens §12.11） */
  if (tags.length) h += tags.map(t => '<p class="tagrow"><span class="tag">' + esc(t[0]) + '</span>'
    + '<span class="tagval">' + linkify(esc(t[1])) + '</span></p>').join('');
  h += '</div>';
  if (p.journey && p.journey.length){
    h += '<div class="card"><h3>使用流程</h3><ol class="steps">';
    p.journey.forEach((j, i) => {
      h += '<li data-n="' + (i + 1) + '"><b>' + esc(j.title) + '</b><br><span class="muted">' + linkify(esc(j.desc)) + '</span>';
      if (j.evidence && j.evidence.length) h += '<div class="ev">' + evHtml(j.evidence) + '</div>';
      h += '</li>';
    });
    h += '</ol></div>';
  }
  /* 术语表已搬到独立 tab（📖 术语表）：项目页不再重复展示，避免同一份数据两个渲染点。 */
  qs('#project').innerHTML = h;
}

/* ---------- 术语表 Tab（📖，位于「现在」与「使用指南」之间） ----------
   术语表默认在建仪表盘时一并创建；文件名不写死 —— 靠表头契约识别（真实文件名见 .cyd.json 的 glossary_file）。
   四种状态都要有出口：有表 / 有漂移 / 文件在但表头不符 / 未启用（空态给一键建立）。 */
const GLOSS_HEADER_DEMO = '| 标准用词 | 指什么 | 别名/曾用名 |\n| --- | --- | --- |\n| 开发仪表盘 | 本产品 | 看板、dashboard |';
function glossaryBuildText(){
  return '请在这个项目的 dev-dashboard/ 下建一份术语表。'
    + '\n\n第一张表用这三列：标准用词 / 指什么 / 别名·曾用名。'
    + '正文一律用标准用词；别名写进正文请在数据健康里报用词漂移。建完重新渲染仪表盘。'
    + '\n\n' + GLOSS_HEADER_DEMO;
}
function glossaryTableHtml(list, drift, file){
  let h = '<div class="card"><h3>术语表</h3>'
    + '<p class="muted">共 ' + list.length + ' 条标准用词'
    + (drift.length ? ' · ⚠ ' + drift.length + ' 处用词漂移' : ' · 用词一致 ✅') + '</p>'
    + '<p class="snote">来源：<code>' + esc(file) + '</code>（漂移只查 PRODUCT / FEATURES / NOW 正文，注释不算）</p>'
    + '<div class="stablewrap"><table class="stable"><tr><th>标准用词</th><th>指什么</th><th>别名/曾用名</th></tr>'
    + list.map(g => '<tr><td><b>' + esc(g.term) + '</b></td><td>' + esc(g.meaning) + '</td><td class="muted">'
        + esc((g.aliases || []).join('、')) + '</td></tr>').join('')
    + '</table></div></div>';
  if (drift.length){
    h += '<div class="card warncard"><h3>用词漂移（' + drift.length + ' 处）</h3>'
      + '<p class="snote">这些别名出现在正文里，建议统一成标准用词。</p>'
      + '<div class="stablewrap"><table class="stable"><tr><th>别名</th><th>应写成</th><th>位置</th><th class="num">次数</th><th></th></tr>'
      + drift.map((d, i) => '<tr><td>' + esc(d.alias) + '</td><td><b>' + esc(d.term) + '</b></td><td class="muted">'
          + esc(d.file) + '</td><td class="num">' + d.count + '</td><td><button class="btn mini" data-gfix="' + i + '">统一用词</button></td></tr>').join('')
      + '</table></div></div>';
  }
  return h;
}
function renderGlossary(){
  const sec = qs('#glossary'); if (!sec) return;
  const st = (DATA.health && DATA.health.glossary_status) || {};
  const cands = st.candidates || [];
  const file = DATA.glossary_file || st.file || null;
  const list = DATA.glossary || [];
  const drift = (DATA.health && DATA.health.glossary_drift) || [];
  let h = '', askText = '', askLabel = '';
  if (st.source === 'ambiguous' && cands.length){
    askText = '术语表有多个候选（' + cands.join(' / ') + '）：请确认用哪一个，把结论写进 dev-dashboard/.cyd.json 的 glossary 字段'
      + '（例如 {"glossary": "' + cands[0] + '"}），然后重新渲染仪表盘。';
    askLabel = '选一个术语表';
    h += '<div class="card warncard"><h3>⚠ 术语表有多个候选</h3>'
      + '<p class="lede">这几个文件都像术语表：<b>' + cands.map(esc).join('、') + '</b>。请挑一个。</p>'
      + '<p class="snote">在 <code>dev-dashboard/.cyd.json</code> 里写 <code>{"glossary": "'
      + esc(cands[0]) + '"}</code>，或把多余的那份改名、移走。</p></div>';
  } else if (file && list.length){
    h += glossaryTableHtml(list, drift, file);
  } else if (file && !list.length){
    const why = (DATA.health.warnings || []).filter(w => w.indexOf(file) === 0).slice(0, 2).join('；');
    askText = 'dev-dashboard/' + file + ' 的第一张表不符合术语表契约：请改成三列（标准用词 | 指什么 | 别名/曾用名）并重新渲染仪表盘。';
    askLabel = '按契约改表头';
    h += '<div class="card warncard"><h3>⚠ 找到了 <code>' + esc(file) + '</code>，但表头不符合契约</h3>'
      + '<p class="lede">' + esc(why || '第一张表需要三列：标准用词 | 指什么 | 别名/曾用名。') + '</p>'
      + '<p class="snote">下面这个表头可以直接照抄：</p>'
      + '<pre class="codeblock">' + esc(GLOSS_HEADER_DEMO) + '</pre></div>';
  } else {
    askText = glossaryBuildText();
    askLabel = (env.ask || env.command) ? '建立术语表' : '复制「建立术语表」指令';
    h += '<div class="card"><h3>还没有术语表</h3>'
      + '<p class="lede">同一样东西常被叫成好几个名字，AI 会越写越飘。术语表把标准用词钉死。</p>'
      + '<p class="snote">别名写进正文时，数据健康里会报「用词漂移」。</p>'
      + '<p class="snote">文件名可以按项目习惯取（<code>术语表.md</code>、<code>glossary.md</code> 都认）。'
      + '第一张表的前三列要是下面这个表头：</p>'
      + '<pre class="codeblock">' + esc(GLOSS_HEADER_DEMO) + '</pre></div>';
  }
  if (askText) h += '<div class="actrow"><button class="btn primary" id="glossAsk">' + esc(askLabel) + '</button></div>';
  sec.innerHTML = h;
  const btn = qs('#glossAsk'); if (btn) btn.onclick = () => dispatchSend(askText, '术语表', btn);
  qsa('[data-gfix]').forEach(b => b.onclick = () => {
    const d = drift[Number(b.dataset.gfix)]; if (!d) return;
    dispatchSend('请把 ' + d.file + ' 里的别名「' + d.alias + '」统一成标准用词「' + d.term
      + '」（术语表里已有的对照），改完重新渲染仪表盘。', '统一用词', b);
  });
}

/* ---------- 功能地图 Tab ---------- */
function graphBoxHtml(immersive, canSend){
  if (!ACT().length) return '';
  const hasTech = !!(DATA.tech && (DATA.tech.modules || []).length);
  /* 特性可发现性：切换控件**有数据没数据都渲染**（用户不知道存在的功能等于没有）；
     没有技术数据时，切过去看到的是**真的渲染出来的空态**（不是"看得见点不动"的控件）。 */
  const techEmpty = graphView === 'tech' && !hasTech;
  const techSource = (DATA.health && DATA.health.tech_status) ? DATA.health.tech_status.source : 'none';
  const techNone = techEmpty && (techSource === 'none' || techSource === 'ambiguous');   // 连文件都没有
  /* 「能不能直发」只由宿主注入的 env.command 决定，并经**参数**传进来 ——
     旧写法在模块作用域读 initDashboard 的局部 sendable，恒为 false（面板在线也会显示成复制档）。
     单一执行路径：这个判断只此一处。 */
  const techCanSend = !!canSend;
  /* 「功能 | 技术」切换放 `.ghead` 内、缩放控件左侧（契约「界面结构」+ §F1）：**不新增 tab**
     （六 tab 顺序与数量不变），视角状态存内存、不持久化。 */
  /* 整页的可见出口（文案已按 copy-deck §16.6 定稿）：按钮 `查看详情`。
     行为（2026-10-13 用户要求）＝①退出整页 ②在右侧边栏打开**完整仪表盘**
     （走宿主正式服务 `ctx.sidebarRight.openTab`，见 client.src.js 的 `face.openSidebar`）。
     Esc 是另一条**更弱**的出口（只退出整页、不开侧栏）⇒ 两者不再等价。 */
  const exitBtn = immersive
    ? '<button class="viewdetail" id="viewDetail" title="在右侧边栏打开完整仪表盘（也可按 Esc 退出整页）。">查看详情</button>' : '';
  const sw = '<span class="viewswitch" id="viewSwitch"><button data-view="features" class="' + (graphView === 'features' ? 'on' : '') + '">功能</button>'
    + '<button data-view="tech" class="' + (graphView === 'tech' ? 'on' : '') + '"'
    + (hasTech ? '' : ' title="还没有技术地图，点开看怎么建。"') + '>技术</button></span>';
  const hint = graphView === 'tech' ? '滚轮缩放 · 拖动平移 · 按层排布' : '滚轮缩放 · 拖动平移 · 点节点对话';
  /* S3 可见性（契约 L563「陈旧必须比正确更显眼」）：**不许只在审计弹层可见** ——
     技术视图里 ① 标题旁 `⚠`（悬停给全三句）② 图例下一条 `.snote`（给第一句）。
     两处**都从 `techStaleLines()` 取**（唯一生成处），不再各自拼字符串。 */
  const ts = (DATA.health && DATA.health.tech_stale) || null;
  const tsShow = graphView === 'tech' && ts && ts.modules.length;
  const tsLines = tsShow ? techStaleLines(ts) : null;
  const tsMark = tsShow
    ? '<span class="warnmark" title="' + esc(tsLines.join('')) + '">⚠</span>' : '';
  return '<div class="graphbox"><div class="ghead"><b>' + (graphView === 'tech' ? '技术地图' : '功能关系图') + tsMark + '</b><span>'
    + hint + '</span>' + sw
    + '<span class="gtools" id="gTools"><button data-gz="out" title="缩小">－</button><button data-gz="in" title="放大">＋</button><button data-gz="fit" title="适应屏幕">⤢ 适应</button><button data-gz="fs" title="全屏（Esc 退出）">⛶ 全屏</button><button data-gz="reset" title="把手动摆过的节点复位回分层布局">↺ 重置</button>' + exitBtn + '</span></div>'
    + '<div class="legend">' + (graphView === 'tech'
      ? '<span><i class="x1"></i>设想</span><span><i class="x2"></i>进行中</span><span><i class="x3"></i>可用</span><span><i class="x4"></i>已验证</span><span class="lgsub">按「层」自上而下排 · 点节点看相关功能</span>'
      : '<span><i class="x1"></i>设想</span><span><i class="x2"></i>进行中</span><span><i class="x3"></i>可用</span><span><i class="x4"></i>已验证</span><span class="lgsub">拖节点可调整位置 · 点 ▸n 徽标展开子项</span>')
    + '</div>'
    + (tsShow ? '<p class="snote">' + esc(tsLines[0]) + '</p>' : '')
    + (techEmpty
        ? (techNone
            ? '<div class="tech-empty"><b>还没有技术地图</b><p>技术地图说明这些功能是怎么搭起来的。</p><p>它和功能地图共用同一批证据，不另做一张图。</p>'
              + '<button class="btn" data-cmd="建立技术地图">' + (techCanSend ? '建立技术地图' : '复制「建立技术地图」指令') + '</button></div>'
            : '<div class="tech-empty"><b>暂无模块</b><p>在「## 模块」下加一条，写清层与技术。</p></div>')
        : '<svg id="graph"></svg><div class="nodepop" id="nodePop"></div>') + '</div>';
}
function renderFeatures(){
  /* 整页模式（会话页「功能地图」tab）：只渲染关系图并铺满可用高度；
     标题栏/徽章/筛选/进度/功能卡网格/页脚都不渲染，宿主自己的标签栏与输入框不动。 */
  if (IMMERSIVE){
    qs('#features').innerHTML = graphBoxHtml(IMMERSIVE, !!(env && env.command)) || '<div class="empty">暂无可显示的功能</div>';
    renderGraph();
    return;
  }
  let h = graphBoxHtml(IMMERSIVE, !!(env && env.command));
  h += '<div class="filters" id="featFilters"></div>';
  const v = DATA.counts['已验证'] || 0, t = DATA.counts.total_active || 0, pct = t ? Math.round(v / t * 100) : 0;
  h += '<div class="progress"><i style="width:' + pct + '%"></i></div><div class="plabel"><p>进度只算你亲手验证过的功能（' + v + '/' + t + '）。</p><p>点开功能卡可以看详情、一键验证。</p></div>';
  h += '<div class="grid" id="featGrid"></div>';
  qs('#features').innerHTML = h;
  const counts = DATA.counts;
  const filt = [['all', '全部 ' + (ACT().length + DEPR().length)]];
  ['设想', '进行中', '可用', '已验证', '已废弃'].forEach(s => { if (counts[s]) filt.push([s, s + ' ' + counts[s]]); });
  qs('#featFilters').innerHTML = filt.map((f, i) => '<button data-f="' + f[0] + '" class="' + (i ? '' : 'on') + '">' + f[1] + '</button>').join('');
  qsa('#featFilters button').forEach(b => b.onclick = () => {
    qsa('#featFilters button').forEach(x => x.classList.remove('on'));
    b.classList.add('on'); currentFilter = b.dataset.f; renderCards(currentFilter);
  });
  renderCards(currentFilter);
  renderGraph();
}
function featCard(f){
  const dep = f.status === '已废弃';
  let h = '<div class="feat' + (dep ? ' deprecated' : '') + '" id="feat-' + esc(f.name) + '" data-fname="' + esc(f.name) + '" tabindex="0" role="button" title="点击或按回车查看详情">'
    + '<h3>' + esc(f.name) + ' <span class="badge b-x' + SMAP[f.status] + '">' + esc(f.status) + '</span></h3>'
    + '<p class="muted featdesc">' + esc(f.desc) + '</p>';
  const kids = f.children || [];
  if (kids.length){
    const done = kids.filter(c => c.status === '已验证').length;
    h += '<div class="subsum" title="点开查看子项明细">🧩 子项 ✅' + done + '/' + kids.length + '</div>';
  }
  if (f.evidence && f.evidence.length) h += '<div class="ev">' + evHtml(f.evidence) + '</div>';
  if (f.verify) h += '<div class="verifier">' + esc(f.verify) + '</div>';
  else if (f.status === '可用') h += '<div class="verifier">已标为可用，试用后确认</div>';
  else if (f.status === '进行中') h += '<div class="verifier">开发中</div>';
  return h + '</div>';
}
function renderCards(f){
  const grid = qs('#featGrid');
  const list = f === 'all' ? DATA.features : DATA.features.filter(x => x.status === f);
  grid.innerHTML = list.length ? list.map(featCard).join('') : '<div class="empty">暂无该状态的功能</div>';
  grid.querySelectorAll('.feat').forEach(c => c.onclick = e => {
    if (e.target.closest('a,button,input,textarea')) return;
    openFeatDetail(c.dataset.fname);
  });
}

/* ---------- 关系图（自适应节点 + 缩放平移 + 子项展开 + 拖动跟手） ----------
   坐标模型：世界坐标 = 节点数据坐标（与 Python 渲染器同口径）；gWorld 变换 = translate(tx,ty)·scale(k)。
   viewBox 固定为元素 CSS 像素尺寸（1 单位 = 1 CSS 像素），指针换算一律走 getScreenCTM().inverse()，
   因此不受 preserveAspectRatio、缩放、平移、容器尺寸变化影响。
   （旧版按 sc = vb.w/rect.width 估算，SVG 用的是等比缩放 + 居中，增益与偏移都是错的，
     表现为"拖节点乱窜"；且 pointerdown 没记抓取偏移，一按下去节点就瞬移到光标。） */
function renderGraph(){
  /* 技术空态：只有**提示块**、没有图 —— 直接返回，避免去碰不存在的 svg#graph。
     注：`techEmpty` 必须在本函数内现算（用 graphBoxHtml 的局部会 ReferenceError —— 本轮踩过）。 */
  if (graphView === 'tech' && !(DATA.tech && (DATA.tech.modules || []).length)) return;
  const svg = qs('#graph'); if (!svg) return;
  const pop = qs('#nodePop');
  const box = qs('.graphbox');
  if (box && graphFs) box.classList.add('fs');   // 重渲染会重建 DOM：全屏状态记在 graphFs 上，这里补回来
  const NS = 'http://www.w3.org/2000/svg';
  svg.innerHTML = '';
  /* <defs> 必须在 gWorld 之前：否则 url(#id) 解析不到（graph-visuals §C1） */
  const defs = document.createElementNS(NS, 'defs'); svg.appendChild(defs);
  const gWorld = document.createElementNS(NS, 'g'); svg.appendChild(gWorld);
  /* 四个图层（顺序即 z-order）：边 → 子项连线 → 节点 → 标记。
     分层的理由：现状子项与节点交替 append，A 功能已画的子项会被 B 功能的节点盖住（§A1）。 */
  const lyr = {};
  /* 五层固定创建（`lyr-bands` 只有技术视图会往里放东西）：**不能按 techMode 条件建** ——
     那一来 techMode 就得在使用点之前声明，顺序一错就是 TDZ 白屏（本轮真踩过）。 */
  ['lyr-bands', 'lyr-edges', 'lyr-child', 'lyr-nodes', 'lyr-marks'].forEach(c => {
    const g = document.createElementNS(NS, 'g'); g.setAttribute('class', c); gWorld.appendChild(g); lyr[c] = g;
  });
  chgMarks.clear();   // DOM 重建 → 角标引用全部作废（角标内容仍来自内存 chgSeen）
  /* 技术视图（批 6）：把 `DATA.tech` 的模块**合成**成引擎认识的节点模型，复用同一套
     布局适配 / 缩放平移 / 拖动 / 渐变边 / 幽灵边能力（契约 §250 明写"复用 renderGraph 能力"）。
     `层` 决定列位置（首次出现顺序，不硬编码层名）；`连到` 就是依赖边（目标不存在 → 幽灵边）。 */
  const techMode = graphView === 'tech' && !!(DATA.tech && (DATA.tech.modules || []).length);
  const techMods = techMode ? (DATA.tech.modules || []) : [];
  const synthMod = m => {
    const d = nodeDims({ name: m.name });
    return { name: m.name, status: (STATUSES.indexOf(m.status) >= 0 ? m.status : '设想'),
             w: d.w, h: d.h, lines: d.lines, desc: m.duty || '', evidence: [], children: [],
             desc: (m.duty ? m.duty + ' · ' : '') + '层: ' + (m.layer || '未填写') + ' · 技术: ' + (m.tech || '未填写'),
             deps: (m.links || []).map(l => l.name), __layer: m.layer || '', __tech: m.tech || '' };
  };
  const feats = techMode ? techMods.map(synthMod) : ACT();
  const byName = {}; feats.forEach(f => byName[f.name] = f);
  /* 全量索引：byName 只含未废弃，判断"已废弃 vs 不存在"必须另建一份（§B1） */
  const byAllName = {}; (techMode ? techMods.map(synthMod) : DATA.features).forEach(f => byAllName[f.name] = f);
  if (techMode){
    /* 按层排布（契约 §F2：**纵向**——「从上到下 = 从用户到数据」）：
       层的 y 按首次出现顺序自上而下；**同一层内横向排列**（x 递增、y 相同）。 */
    const layerIdx = {}; (DATA.tech.layers || []).forEach((L, i) => layerIdx[L] = i);
    const rowX = {};
    feats.forEach(f => {
      const ri = layerIdx[f.__layer] == null ? 0 : layerIdx[f.__layer];
      const y0 = 90 + ri * 120;                       // 层的带顶（纵向堆叠）
      const x0 = rowX[ri] === undefined ? 110 : rowX[ri];
      f.x = x0 + f.w / 2; f.y = y0 + f.h / 2;         // 同层横向排列
      rowX[ri] = x0 + f.w + 40;
    });
  }
  /* 手动摆过的位置优先（跨重渲染保留），其余用分层布局算出来的位置 */
  feats.forEach(f => { const m = gview.pos.get(f.name); if (m){ f.x = m.x; f.y = m.y; } });
  /* 展开占位求解：先把「自身 ∪ 子项块」互相推开到零重叠，再画（批 3 复审 P0-1） */
  const lay = resolveLayout();
  const markBoxes = [];   // V1 桩/标记的包围盒：纳入 contentBox()，保证它们不会被容器裁切（P0-3 复查）
  const markEls = new Map();   /* 已停用：幽灵标记改由 syncGhosts() 独占（单一执行路径）。
                                留空 Map 仅为兼容 renderGraphMarks 的旧形参 —— 详见该函数内的注释。 */
  const edges = [];
const nodeG = {};           // 功能名 → 该节点的 <g>（降噪要按名开关 on 类；DOM 重建即重建）
  const ghostMarks = [];      // {f, name, obsolete}：依赖指向不存在/已废弃的功能（V1）
  let edgeSeq = 0;
  /* V3 触发条件（三条同时成立）：目标「进行中」 + (整页或全屏) + 非减少动态偏好 */
  const reduceMotion = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const fsOn = () => !!(box && box.classList.contains('fs'));
  const flowOk = () => !reduceMotion() && (IMMERSIVE || fsOn());
  let flowCount = 0, flowCapped = false;
  /* 内容外框：按实际布局（含手动位置与**展开中的子项**）算，视野范围不再是写死的 960×340 */
  function contentBox(){
    let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    feats.forEach(f => {
      minX = Math.min(minX, f.x - f.w / 2); maxX = Math.max(maxX, f.x + f.w / 2);
      minY = Math.min(minY, f.y - f.h / 2); maxY = Math.max(maxY, f.y + f.h / 2);
    });
    /* A6.1：子项必须纳入 bbox（母线落在父底边与子项顶边之间，被这个 bbox 覆盖，不必单独算） */
    childGs.forEach(c => {
      const m = c.meta;
      minX = Math.min(minX, m.cx - m.w / 2); maxX = Math.max(maxX, m.cx + m.w / 2);
      minY = Math.min(minY, m.cy - m.h / 2); maxY = Math.max(maxY, m.cy + m.h / 2);
    });
    /* 幽灵桩与「缺 X」标记也在画面里，必须一起框住（否则 fit 之后会被容器裁掉） */
    markBoxes.forEach(b => {
      minX = Math.min(minX, b.x); maxX = Math.max(maxX, b.x + b.w);
      minY = Math.min(minY, b.y); maxY = Math.max(maxY, b.y + b.h);
    });
    if (expanded.size && !childGs.length) console.warn('[cyd] contentBox 未纳入子项：请检查 drawChildren 是否在 fit 之前执行');
    if (!feats.length){ minX = 0; maxX = 960; minY = 0; maxY = 340; }
    return { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) };
  }
  function syncBox(){
    const rect = svg.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    svg.setAttribute('viewBox', '0 0 ' + rect.width + ' ' + rect.height);
    return rect;
  }
  /* 整页模式：SVG 的高度由 JS 按「图容器高度 − 标题条 − 图例」算死。
     不用 flex:1——父链高度在极短窗口/重挂载时可能瞬时不确定，会让 SVG 塌成 0。 */
  /* 非整页/全屏：高度按**内容自适应** —— 小图不再被固定 340px 撑出大片空白，也不靠放大去填满。
     320px 起、随内容增长到 720px 封顶（缩放在 fit() 里另有 1.25 上限，两者一起才既不留白又不放大）。 */
  function layoutHeight(){
    const fs = !!(box && box.classList.contains('fs'));
    if (!box) return;
    if (!IMMERSIVE && !fs){
      const b = contentBox();
      const h = Math.max(320, Math.min(720, Math.round(b.h + 80)));
      if (svg.style.height !== h + 'px') svg.style.height = h + 'px';
      return;
    }
    const gh = box.querySelector('.ghead'), lg = box.querySelector('.legend');
    const used = (gh ? gh.offsetHeight : 0) + (lg ? lg.offsetHeight : 0);
    let avail = box.clientHeight - used;                 // 容器高度确定时直接用
    if (!(avail > 120)){                                 // 父链高度还没确定（内容驱动 / 首帧）→ 按视口兜底
      avail = window.innerHeight - box.getBoundingClientRect().top - used - 24;
    }
    const h = Math.max(240, Math.round(avail));
    if (h > 0) svg.style.height = h + 'px';
  }
  /* 出边锚点**必须合并成一个点**（2026-10-13 用户裁决）：同一源节点发出的所有连线都从
     **源卡片右边缘中点** (a.x + a.w/2, a.y) 出发，再由贝塞尔各自散开。
     历史实现按出边序号在右侧竖边 ±(n-1)/2·10 内错开，注释还写着"分开锚点，否则起点重合看着像
     一条线分叉"——那条**已被用户否决**，整套 outDeg / outSeen / aOff 一并删净（单一执行路径，
     不留兼容分支）。我们的图是横向 左→右，所以上游那个"卡片底边中点"的等价物是**右边缘中点**，
     不是照搬它的 y+100。 */
  function edgeD(a, b){
    const x1 = a.x + a.w / 2, y1 = a.y, x2 = b.x - b.w / 2, y2 = b.y, mx = (x1 + x2) / 2;
    return 'M' + x1 + ',' + y1 + ' C' + mx + ',' + y1 + ' ' + mx + ',' + y2 + ' ' + x2 + ',' + y2;
  }
  /* 依赖边：源状态色 → 目标状态色渐变（V2）；目标不存在/已废弃 → 幽灵断头桩（V1）。 */
  feats.forEach(f => (f.deps || []).forEach(dn => {
    const a = byName[dn];
    if (!a){
      /* V1：不连向不存在的目标 —— 断头桩 + 末端空心圆环（§B2 修订：向**左**）。
         同一个节点有多条幽灵依赖时**只画一条桩**（与"等 n 个"标签同一口径），避免叠画。 */
      ghostMarks.push({ f, name: dn, obsolete: !!byAllName[dn] });
      return;
    }
    const gid = 'cyd-grad-' + (edgeSeq++);          // 每条边一个 gradient：共用 id 会让方向错（§C1）
    const grad = document.createElementNS(NS, 'linearGradient');
    grad.setAttribute('id', gid); grad.setAttribute('gradientUnits', 'userSpaceOnUse');
    grad.setAttribute('x1', a.x + a.w / 2); grad.setAttribute('y1', a.y);
    grad.setAttribute('x2', f.x - f.w / 2); grad.setAttribute('y2', f.y);
    [['0', a.status], ['1', f.status]].forEach(([off, st]) => {
      const stp = document.createElementNS(NS, 'stop');
      stp.setAttribute('offset', off);
      /* 必须走 CSS 属性：呈现属性不支持 var()，setAttribute('stop-color','var(--ok)') 会让整条边变黑 */
      stp.style.stopColor = SCOLOR[st] || 'var(--ink2)';
      grad.appendChild(stp);
    });
    defs.appendChild(grad);
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('class', 'edge dep');
    p.setAttribute('d', edgeD(a, f));
    p.setAttribute('data-from', a.name);   // 只给断言读，判定一律走渲染期的 edges 数组
    p.setAttribute('data-to', f.name);
    p.setAttribute('stroke', 'url(#' + gid + ')');
    lyr['lyr-edges'].appendChild(p);
    const e = { path: p, from: a, to: f, gid, flow: null };
    /* V3 流动：目标「进行中」的上游边；全屏/整页才渲染，上限 30 条 */
    if (f.status === '进行中' && flowOk()){
      if (flowCount < FLOW_MAX){
        const fl = document.createElementNS(NS, 'path');
        fl.setAttribute('class', 'edge flow');
        fl.setAttribute('d', edgeD(a, f));
        fl.style.animationDelay = '-' + ((flowCount % 4) * 0.28) + 's';
        lyr['lyr-edges'].appendChild(fl);
        e.flow = fl; flowCount++;
      } else flowCapped = true;
    }
    edges.push(e);
  }));
  /* 流动被上限截断时在标题栏明说，避免"为什么这几条不动"的困惑（§D2） */
  if (flowCapped){
    const hint = box ? box.querySelector('.ghead span') : null;
    if (hint && hint.textContent.indexOf('流动仅显示前 30 条') < 0) hint.textContent += ' · 流动仅显示前 30 条';
  }
  function syncGrad(gid, a, b){
    const g = defs.querySelector('#' + gid); if (!g) return;
    g.setAttribute('x1', a.x + a.w / 2); g.setAttribute('y1', a.y);
    g.setAttribute('x2', b.x - b.w / 2); g.setAttribute('y2', b.y);
  }
  /* 技术视图的层带：拖动必须**跟随**（用户原话"拖动节点会和『界面』『工具』分开很怪"）。
     几何仍在**一处算**：按该层节点的 x/y 现算 bbox（不引入新状态）。 */
  let bandEls = [];
  function syncBands(){
    if (!bandEls.length) return;
    const layerIdx = {}; ((DATA.tech && DATA.tech.layers) || []).forEach((L, i) => layerIdx[L] = i);
    const bands = {};
    feats.forEach(f => {
      const ci = layerIdx[f.__layer] == null ? 0 : layerIdx[f.__layer];
      const b = bands[ci] || (bands[ci] = { x1: 1e9, x2: -1e9, y1: 1e9, y2: -1e9 });
      b.x1 = Math.min(b.x1, f.x - f.w / 2); b.x2 = Math.max(b.x2, f.x + f.w / 2);
      b.y1 = Math.min(b.y1, f.y - f.h / 2); b.y2 = Math.max(b.y2, f.y + f.h / 2);
    });
    bandEls.forEach(be => {
      const b = bands[be.ci]; if (!b) return;
      const pad = 26;
      be.rect.setAttribute('x', b.x1 - pad); be.rect.setAttribute('y', b.y1 - pad);
      be.rect.setAttribute('width', (b.x2 - b.x1) + pad * 2); be.rect.setAttribute('height', (b.y2 - b.y1) + pad * 2);
      be.label.setAttribute('x', b.x1 - pad); be.label.setAttribute('y', b.y1 - pad - 8);
    });
  }
  function redraw(f){
    edges.forEach(e => {
      if (e.from !== f && e.to !== f) return;
      e.path.setAttribute('d', edgeD(e.from, e.to));
      syncGrad(e.gid, e.from, e.to);                       // 渐变端点必须同步，否则分界线不跟手（§C2）
      if (e.flow) e.flow.setAttribute('d', edgeD(e.from, e.to));
    });
    syncBands();                 // 拖动中也要跟手（否则层带留在原地 → 用户看到"分层被拖散"）
    syncGhosts();                // 幽灵桩/圆环/「缺 X」标记同理（用户："这个只要一移动就会错位"）
  }
  let dragNode = null;
  function applyT(){ gWorld.setAttribute('transform', 'translate(' + gview.tx + ',' + gview.ty + ') scale(' + gview.k + ')'); }
  function fit(){
    layoutHeight();
    const rect = syncBox();
    if (!rect) return;
    const b = contentBox();
    /* 视野适配：缩放**上限 1.25**（不超过自然尺寸的 1.25 倍，宁可留白也不放大）；
       留白靠 layoutHeight() 把容器收矮解决。留边 +80（A6.2：contentBox 已纳入子项，不必再留 +160）。 */
    const bw = b.w + 80, bh = b.h + 80;
    gview.k = Math.max(.25, Math.min(1.25, 0.94 * Math.min(rect.width / bw, rect.height / bh)));
    gview.tx = rect.width / 2 - gview.k * (b.x + b.w / 2);
    gview.ty = rect.height / 2 - gview.k * (b.y + b.h / 2);
    gview.adjusted = false;
    applyT();
  }
  /* 指针 → 视口坐标（viewBox 单位）/ 世界坐标：CTM 反变换，缩放、平移、长宽比全都精确 */
  function toView(e){
    const p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY;
    const m = svg.getScreenCTM();
    if (!m){ const r = svg.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
    const q = p.matrixTransform(m.inverse()); return { x: q.x, y: q.y };
  }
  function toWorld(e){
    const p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY;
    const m = gWorld.getScreenCTM();
    if (!m){ const v = toView(e); return { x: (v.x - gview.tx) / gview.k, y: (v.y - gview.ty) / gview.k }; }
    const q = p.matrixTransform(m.inverse()); return { x: q.x, y: q.y };
  }
  /* 速览气泡：放在节点**旁边**（不压住节点），并给收起加延迟——指针进气泡时取消收起。
     否则"气泡盖住节点 → 节点触发 mouseleave → 气泡消失 → 指针又回到节点"会无限闪烁，点都点不到。 */
  let popTimer = 0, popHover = false;
  function hidePopSoon(){
    if (popHover) return;                       // 指针还在气泡里 → 不收起
    clearTimeout(popTimer);
    popTimer = setTimeout(() => { if (!popHover) pop.classList.remove('on'); }, 260);
  }
  function showPop(f){
    const host = box || svg.parentNode;
    const rect = host.getBoundingClientRect();
    const p = svg.createSVGPoint(); p.x = f.x; p.y = f.y;
    const m = gWorld.getScreenCTM();
    const s = m ? p.matrixTransform(m) : p;            // 世界坐标 → 屏幕坐标（含缩放平移）
    const halfW = Math.max(20, (f.w * gview.k) / 2);
    const nodeLeft = (s.x - rect.left) - halfW, nodeRight = (s.x - rect.left) + halfW;
    const nodeBottom = (s.y - rect.top) + Math.max(16, (f.h * gview.k) / 2);
    let left, top;
    if (nodeRight + 12 + 235 <= rect.width - 8){          // 优先放右侧
      left = nodeRight + 12; top = (s.y - rect.top) - 30;
    } else if (nodeLeft - 12 - 235 >= 8){                 // 右侧放不下就放左侧
      left = nodeLeft - 12 - 235; top = (s.y - rect.top) - 30;
    } else {                                              // 两边都放不下（窄栏）→ 放节点下方，别压住节点
      left = (s.x - rect.left) - 235 / 2; top = nodeBottom + 10;
    }
    left = Math.max(8, Math.min(left, Math.max(8, rect.width - 243)));
    top = Math.max(8, Math.min(top, Math.max(8, rect.height - 120)));
    pop.innerHTML = '<h4>' + esc(f.name) + ' <span class="badge b-x' + SMAP[f.status] + '">' + esc(f.status) + '</span></h4><p>' + esc(f.desc) + '</p><span class="go">详情</span>';
    pop.style.left = left + 'px'; pop.style.top = top + 'px';
    clearTimeout(popTimer);
    pop.classList.add('on');
    pop.onclick = ev => { ev.stopPropagation(); pop.classList.remove('on'); openNodePanel(f.name); };
  }
  pop.addEventListener('mouseenter', () => { popHover = true; clearTimeout(popTimer); });
  pop.addEventListener('mouseleave', () => { popHover = false; hidePopSoon(); });
  /* ---------- 子项几何：**唯一一份**布局计算（渲染 / 拖动 / bbox / 重叠求解都读它） ----------
     展开的子项会向下占掉一整块空间，必须把这块空间从别的节点的可用区里扣掉，
     否则子项会画在别人身上（批 3 复审 P0-1）。求解在渲染前做，结果缓存在 lay 里。 */
  const childGs = [];   // 当前展开的子项：{parent, kid, g, line, meta}
  const childPaths = new Map();   // parentName → {spine, buses:[path]}（拖动时只改 d，不重建 DOM）
  function childWide(){
    return !!(IMMERSIVE || (box && box.classList.contains('fs')) || ((box ? box.clientWidth : 0) >= 720));
  }
  function childDims(c){
    /* 折行宽度 = 卡片宽度 − 内边距（与矩形宽度同一口径）；宽度走 clamp(120,180,text+36) */
    const lines = wrapName(c.name, CHILD_MAX_W - CHILD_PAD);
    const w = Math.max(CHILD_MIN_W, Math.min(CHILD_MAX_W, textWidth(c.name) + CHILD_PAD));
    return { w, h: lines.length > 1 ? CHILD_H2 : CHILD_H, lines };
  }
  function childLayout(f){
    const kids = (f.children || []).filter(c => c.status !== '已废弃');
    const perRow = childWide() ? CHILD_PER_ROW_WIDE : CHILD_PER_ROW_NARROW;
    const groups = [];
    for (let i = 0; i < kids.length; i += perRow) groups.push(kids.slice(i, i + perRow));
    const P = { x: f.x, y: f.y + f.h / 2 };
    const single = groups.length === 1 && groups[0].length === 1;
    const multi = groups.length > 1;
    let busY = P.y + CHILD_DROP, minX = 1e9, maxX = -1e9, maxY = P.y;
    const rows = [];
    groups.forEach(group => {
      const dims = group.map(childDims);
      const W = dims.reduce((s, d) => s + d.w, 0) + CHILD_GAP_X * (group.length - 1);
      let x = f.x - W / 2;
      const centers = dims.map(d => { const cx = x + d.w / 2; x += d.w + CHILD_GAP_X; return cx; });
      const rowH = Math.max(...dims.map(d => d.h));
      const items = group.map((kid, i) => {
        const cx = centers[i], cy = busY + CHILD_DROP + dims[i].h / 2;
        minX = Math.min(minX, cx - dims[i].w / 2); maxX = Math.max(maxX, cx + dims[i].w / 2);
        maxY = Math.max(maxY, cy + dims[i].h / 2);
        return { kid, cx, cy, w: dims[i].w, h: dims[i].h, lines: dims[i].lines };
      });
      rows.push({ busY, rowLeft: centers[0], rowRight: centers[centers.length - 1], rowH, items });
      busY += CHILD_DROP + rowH + CHILD_GAP_Y;
    });
    /* 多行时向下贯通的干线**必须绕到所有行的最左侧之外**：
       放在 f.x 会让它在第一行的子项框里纵向穿过（用户原话"虚线穿过子单元框"，批 3 复审 P0-1 残留）。
       侧干位置 = 最左子项左边再外 14px；每一行的横梁都在行间空隙里，天然不碰框。 */
    const spineX = multi ? (minX - CHILD_SPINE_PAD) : null;
    const spine = multi ? spinePath(f, P, spineX, rows) : null;
    const buses = rows.map((row, ri) => multi
      ? ('M' + spineX + ',' + row.busY + ' L' + row.rowRight + ',' + row.busY)          // 多行：横梁从侧干向右
      : busPath(f, P, row, rows.length === 1, single, ri));                            // 单行：§A2.4 的对称双横梁
    const boxX = multi ? spineX - 2 : minX;
    return { P, rows, buses, spine, single, multi, spineX,
             box: { x: boxX, y: P.y, w: Math.max(1, maxX - boxX), h: Math.max(1, maxY - P.y) } };
  }
  /* 侧干：父底边中点 → 垂直下 → 拐进侧干 → 一路下到最后一行的横梁（拐角都带圆角） */
  function spinePath(f, P, spineX, rows){
    const r = CHILD_CORNER_R, X = f.x, y0 = rows[0].busY, y1 = rows[rows.length - 1].busY;
    return 'M' + X + ',' + P.y + ' L' + X + ',' + (y0 - r)
      + ' Q' + X + ',' + y0 + ' ' + (X - r) + ',' + y0
      + ' L' + (spineX + r) + ',' + y0
      + ' Q' + spineX + ',' + y0 + ' ' + spineX + ',' + (y0 + r)
      + ' L' + spineX + ',' + (y1 - r)
      + ' Q' + spineX + ',' + y1 + ' ' + (spineX + r) + ',' + y1;
  }
  /* 单行横梁：§A2.4 原文（两个子路径共用一个元素；单子项退化为一条竖直线，§A2.6） */
  function busPath(f, P, row, onlyRow, single, ri){
    const X = f.x, busY = row.busY, len = row.rowRight - row.rowLeft;
    if (single) return 'M' + X + ',' + P.y + ' L' + X + ',' + (busY + CHILD_DROP);
    const r = Math.min(CHILD_CORNER_R, Math.max(1, len / 2));
    return 'M' + X + ',' + P.y + ' L' + X + ',' + (busY - r)
      + ' Q' + X + ',' + busY + ' ' + (X - r) + ',' + busY + ' L' + row.rowLeft + ',' + busY
      + ' M' + X + ',' + (busY - r)
      + ' Q' + X + ',' + busY + ' ' + (X + r) + ',' + busY + ' L' + row.rowRight + ',' + busY;
  }
  function nodeBox(f){ return { x: f.x - f.w / 2, y: f.y - f.h / 2, w: f.w, h: f.h }; }
  /* 展开占位求解：把「自身 ∪ 子项块」当整体障碍，沿 y 把靠后的节点推开，直到**零重叠**。
     手工摆过的节点（gview.pos）优先保留 —— 推另一个。迭代收敛（无位移即停）。 */
  function resolveLayout(){
    const lay = new Map();
    const refresh = f => lay.set(f.name, expanded.has(f.name) ? childLayout(f) : null);
    feats.forEach(refresh);
    const boxes = f => [nodeBox(f)].concat(lay.get(f.name) ? [lay.get(f.name).box] : []);
    for (let pass = 0; pass < 24; pass++){
      const order = feats.slice().sort((a, b) => (a.y - b.y) || (a.x - b.x));
      let moved = false;
      for (let i = 0; i < order.length; i++){
        for (let j = i + 1; j < order.length; j++){
          const A = order[i], B = order[j];
          const ba = boxes(A), bb = boxes(B);
          let need = 0;
          ba.forEach(x => bb.forEach(y => { if (boxHit(x, y)) need = Math.max(need, x.y + x.h - y.y + CHILD_GAP_Y); }));
          if (need <= 0) continue;
          const aPinned = gview.pos.has(A.name), bPinned = gview.pos.has(B.name);
          if (aPinned && !bPinned){ A.y -= need; refresh(A); }
          else { B.y += need; refresh(B); }
          moved = true;
        }
      }
      if (!moved) break;
    }
    return lay;
  }
  /* 清掉某个功能的子项 DOM（展开集合变化/收起/重渲染时调用） */
  function removeChildren(f){
    childGs.forEach(c => { if (!f || c.parent === f){ c.g.remove(); c.line.remove(); } });
    const rest = childGs.filter(c => f && c.parent !== f);
    childGs.length = 0; childGs.push(...rest);
    const kill = name => {
      const rec = childPaths.get(name);
      if (!rec) return;
      if (rec.spine) rec.spine.remove();
      rec.buses.forEach(b => b.remove());
      childPaths.delete(name);
    };
    if (f) kill(f.name); else [...childPaths.keys()].forEach(kill);
  }
  function mkChildPath(cls, d){
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('class', cls); p.setAttribute('d', d);
    lyr['lyr-child'].appendChild(p);
    return p;
  }
  function dropD(cx, busY, childTop){ return 'M' + cx + ',' + busY + ' L' + cx + ',' + childTop; }
  /* 拖动时只更新既有元素的 transform 与 d（不重建 DOM）：按当前位置重算这一份布局。
     注意：拖动落点**允许**与别人重叠（用户显式摆放优先）；零重叠只在渲染求解时保证。 */
  function placeChildren(f){
    const list = childGs.filter(c => c.parent === f);
    if (!list.length) return;
    const L = childLayout(f);
    const rec = childPaths.get(f.name);
    if (rec){
      if (L.spine && !rec.spine) rec.spine = mkChildPath('edge child spine', L.spine);
      else if (!L.spine && rec.spine){ rec.spine.remove(); rec.spine = null; }
      else if (rec.spine && L.spine) rec.spine.setAttribute('d', L.spine);
      L.buses.forEach((d, i) => { if (rec.buses[i]) rec.buses[i].setAttribute('d', d); });
    }
    L.rows.forEach(row => {
      row.items.forEach(it => {
        const item = list.find(x => x.kid === it.kid);
        if (!item) return;
        item.meta = it;
        item.g.setAttribute('transform', 'translate(' + it.cx + ',' + it.cy + ')');
        if (item.line) item.line.setAttribute('d', dropD(it.cx, row.busY, it.cy - it.h / 2));
      });
    });
  }
  function drawChildren(f, lay){
    removeChildren(f);
    const L = lay && lay.get(f.name);
    if (!L || !L.rows.length) return;
    const spine = L.spine ? mkChildPath('edge child spine', L.spine) : null;
    const buses = L.buses.map(d => mkChildPath('edge child bus', d));
    L.rows.forEach(row => {
      row.items.forEach(it => {
        const line = mkChildPath('edge child drop', dropD(it.cx, row.busY, it.cy - it.h / 2));
        const g = document.createElementNS(NS, 'g'); g.setAttribute('class', 'node child');
        const r = document.createElementNS(NS, 'rect');
        r.setAttribute('x', -it.w / 2); r.setAttribute('y', -it.h / 2);
        r.setAttribute('width', it.w); r.setAttribute('height', it.h); r.setAttribute('rx', 10);
        r.style.fill = 'var(--bg)'; r.style.stroke = 'var(--line)';
        const ttl = document.createElementNS(NS, 'title'); ttl.textContent = it.kid.name + '（' + it.kid.status + '）';
        g.appendChild(r);
        /* 状态**只由左侧小圆点**承载（与父节点同一口径；子项原本靠 rect 的状态色底/边表示，
           2026-10-13 用户裁决"节点改卡片、去掉双层边框、状态改用左侧小圆点" ⇒ 子项同样要补点，
           否则状态在卡片化之后**会静默丢失**） */
        const kdot = document.createElementNS(NS, 'circle');
        kdot.setAttribute('class', 'statusdot');
        kdot.setAttribute('cx', -it.w / 2 + 12);
        kdot.setAttribute('cy', it.lines.length > 1 ? -it.h / 2 + 14 : 0);
        kdot.setAttribute('r', 3.5); kdot.style.fill = SCOLOR[it.kid.status];
        g.appendChild(kdot);
        it.lines.forEach((ln, li) => {
          const t = document.createElementNS(NS, 'text');
          t.setAttribute('x', 0); t.setAttribute('text-anchor', 'middle');
          t.setAttribute('y', it.lines.length > 1 ? (li === 0 ? -4 : 14) : 4);
          t.style.fill = 'var(--ink)'; t.textContent = ln;
          g.appendChild(t);
        });
        g.appendChild(ttl);
        g.setAttribute('transform', 'translate(' + it.cx + ',' + it.cy + ')');
        lyr['lyr-nodes'].appendChild(g);
        childGs.push({ parent: f, kid: it.kid, g, line, meta: it });
      });
    });
    childPaths.set(f.name, { spine, buses });
  }
  feats.forEach(f => {
    const g = document.createElementNS(NS, 'g'); g.setAttribute('class', 'node');
    g.setAttribute('tabindex', '0'); g.setAttribute('role', 'button');
    g.setAttribute('data-fname', f.name);   // 键盘激活（回车/空格）靠它找到功能名
    const r = document.createElementNS(NS, 'rect');
    r.setAttribute('x', -f.w / 2); r.setAttribute('y', -f.h / 2); r.setAttribute('width', f.w); r.setAttribute('height', f.h); r.setAttribute('rx', 12);
    r.style.fill = 'var(--bg)'; r.style.stroke = 'var(--line)';
    const ttl = document.createElementNS(NS, 'title'); ttl.textContent = f.name + '（' + f.status + '）' + (f.desc ? '——' + f.desc : '');
    g.appendChild(r);
    g.appendChild(ttl);
    const lines = f.lines || [f.name];
    lines.forEach((ln, i) => {
      const t = document.createElementNS(NS, 'text');
      t.setAttribute('x', 0); t.setAttribute('text-anchor', 'middle');
      t.setAttribute('y', lines.length > 1 ? (i === 0 ? -2 : 16) : 4);
      t.style.fill = 'var(--ink)'; t.textContent = ln;
      g.appendChild(t);
    });
    const dot = document.createElementNS(NS, 'circle');
    dot.setAttribute('class', 'statusdot');
    dot.setAttribute('cx', -f.w / 2 + 14); dot.setAttribute('cy', lines.length > 1 ? -f.h / 2 + 16 : 0); dot.setAttribute('r', 4); dot.style.fill = SCOLOR[f.status];
    g.appendChild(dot); lyr['lyr-nodes'].appendChild(g);   // 进 nodes 层：z-order 见 §A1（父节点与子项同层）
    g.setAttribute('transform', 'translate(' + f.x + ',' + f.y + ')');
    /* 子项徽标：右下小圆，数字 = 子项数；点击展开/收起（思维导图式） */
    const kids = (f.children || []).filter(c => c.status !== '已废弃');
    if (kids.length){
      const bg = document.createElementNS(NS, 'g'); bg.setAttribute('class', 'subbadge');
      bg.setAttribute('tabindex', '0'); bg.setAttribute('role', 'button');
      const bc = document.createElementNS(NS, 'circle');
      bc.setAttribute('cx', f.w / 2 - 6); bc.setAttribute('cy', f.h / 2 - 6); bc.setAttribute('r', 11);
      const bt = document.createElementNS(NS, 'text');
      bt.setAttribute('x', f.w / 2 - 6); bt.setAttribute('y', f.h / 2 - 2); bt.setAttribute('text-anchor', 'middle');
      bt.textContent = (expanded.has(f.name) ? '▾' : '▸') + kids.length;
      const bttl = document.createElementNS(NS, 'title'); bttl.textContent = '展开/收起子项（' + kids.length + ' 个）';
      bg.appendChild(bc); bg.appendChild(bt); bg.appendChild(bttl); g.appendChild(bg);
      const toggle = ev => {
        ev.stopPropagation();
        if (expanded.has(f.name)) expanded.delete(f.name); else expanded.add(f.name);
        bt.textContent = (expanded.has(f.name) ? '▾' : '▸') + kids.length;
        renderGraph();      // 展开/收起改变了占位 → 重新求解重叠并重画（离散动作，不是拖动）
      };
      bg.addEventListener('pointerdown', ev => ev.stopPropagation());
      bg.addEventListener('pointerup', toggle);
    }
    /* 拖节点：按下时记住「指针 ↔ 节点」偏移，之后严格跟手；没移动就是点击 → 打开节点面板 */
    g.addEventListener('pointerdown', e => {
      e.stopPropagation();
      if (e.button !== undefined && e.button !== 0) return;   // 只响应主键 / 触摸 / 笔
      pop.classList.remove('on'); clearTimeout(popTimer);
      const p = toWorld(e);
      dragNode = { f, g, dx: p.x - f.x, dy: p.y - f.y, sx: e.clientX, sy: e.clientY, moved: false };
      e.preventDefault();   /* 拦默认：拖动时不选中文字、鼠标按下时不出焦点粗框（键盘 Tab 的焦点环走 :focus-visible，不受影响） */
      svg.classList.add('is-dragging');
      gview.drag = true;
      try{ svg.setPointerCapture(e.pointerId); }catch(err){}
    });
    g.addEventListener('mouseenter', () => { if (!dragNode) showPop(f); });
    g.addEventListener('mouseleave', () => { if (!dragNode) hidePopSoon(); });
    drawChildren(f, lay);
  });
  /* 技术视图：层带 + 层标签（§F2：`--chip` 弱底 + 文字，**不用彩色**）+ 边上关系文字（§F3） */
  if (techMode){
    const layerIdx = {}; (DATA.tech.layers || []).forEach((L, i) => layerIdx[L] = i);
    const bands = {};
    feats.forEach(f => {
      const ci = layerIdx[f.__layer] == null ? 0 : layerIdx[f.__layer];
      const b = bands[ci] || (bands[ci] = { x1: 1e9, x2: -1e9, y1: 1e9, y2: -1e9, name: f.__layer || '未分层' });
      b.x1 = Math.min(b.x1, f.x - f.w / 2); b.x2 = Math.max(b.x2, f.x + f.w / 2);
      b.y1 = Math.min(b.y1, f.y - f.h / 2); b.y2 = Math.max(b.y2, f.y + f.h / 2);
    });
    bandEls = [];
    Object.keys(bands).forEach(ci => {
      const b = bands[ci], pad = 26;
      const r = document.createElementNS(NS, 'rect');
      r.setAttribute('class', 'layerband');
      r.setAttribute('x', b.x1 - pad); r.setAttribute('y', b.y1 - pad);
      r.setAttribute('width', (b.x2 - b.x1) + pad * 2); r.setAttribute('height', (b.y2 - b.y1) + pad * 2);
      r.setAttribute('rx', 10); r.style.fill = 'var(--chip)';
      lyr['lyr-bands'].appendChild(r);
      const t = document.createElementNS(NS, 'text');
      t.setAttribute('class', 'layerlabel');
      t.setAttribute('x', b.x1 - pad); t.setAttribute('y', b.y1 - pad - 8);
      t.setAttribute('text-anchor', 'start'); t.textContent = b.name;
      lyr['lyr-bands'].appendChild(t);
      bandEls.push({ ci: ci, rect: r, label: t });
    });
    const relOf = {};
    /* 引擎里边是「依赖 → 依赖者」（from = 被连到的模块），所以键要按这个方向建 */
    techMods.forEach(m => (m.links || []).forEach(l => { relOf[l.name + '->' + m.name] = l.rel || ''; }));
    /* **线上不标字**（2026-10-13 用户裁决："算了，这个过程太浪费时间了，直接选择线上什么都别标了"）。
       用户放大图里线明确穿过字身，而我们三格测量都是 0 ⇒ **以用户的眼为准**（我们的判据是错的/盲的 ✗）。
       信息不丢：关系名改放进**边自身的 `<title>`** —— **悬停可见、不占视觉**（"悬停"不算"标" ✓）；
       节点详情里的「连到」仍在 ⇒ 关系信息还有落点 ✓。
       单一执行路径：旧的 `edgelabel` **生成/候选避让/样式/测量**全部删净，不留"生成但隐藏" ✗。 */
    edges.forEach(e => {
      const rel = relOf[e.from.name + '->' + e.to.name];
      if (!rel || !e.path) return;
      const ttl = document.createElementNS(NS, 'title');
      ttl.textContent = rel;                 // 悬停才显示：不占视觉、不遮线
      ttl.setAttribute('data-rel', rel);     // 断言按它取（不必再量视觉层）
      e.path.appendChild(ttl);
    });
  }
  /* 「功能 | 技术」切换：切了就把手动位置与视野复位（两种图坐标系不同），状态存内存不持久化 */
  qsa('#viewSwitch button').forEach(b => b.onclick = () => {
    if (graphView === b.dataset.view) return;
    graphView = b.dataset.view; gview.pos.clear(); gview.markSlots.clear(); gview.adjusted = false;
    renderFeatures();
  });
  /* 「查看详情」按钮：**只打开右侧边栏；不退出整页**（用户要求原话：「不需要退出整页然后显示整个对话框，
     我在这里就是想弄个单独的查看地图」）。
     **为什么不再调 `exitImmersive()`**：本核的"只显示地图"完全靠 `IMMERSIVE`（L886）；
     一旦 `exitImmersive()` 把它置 false，同一个视图容器就会走完整仪表盘那条渲染路径
     （`renderStrip()` 等在 L3008 是无条件渲染的）⇒ **会话页那个 tab 自己变成仪表盘** = 用户报的"跳转" ✗。
     Esc 仍是退出整页的出口（L898-902 不动）；本按钮与 Esc 因此**不等价**：按钮只开侧栏。 */
  const exb = qs('#viewDetail');
  if (exb) exb.onclick = () => {
    const openSide = env.openSidebar;
    if (typeof openSide === 'function'){ try { openSide(); } catch (e){ console.warn('[cyd] 打开右侧边栏失败', e); } }
  };
  /* V1 桩/标记 + V4 角标：**在 fit 之前**建好，并把自己的 bbox 交给 contentBox，
     否则 fit 之后它们可能落在框外被裁掉（P0-3 复查）。 */
  {
    const obstacles = feats.map(nodeBox).concat(childGs.map(c => ({
      x: c.meta.cx - c.meta.w / 2, y: c.meta.cy - c.meta.h / 2, w: c.meta.w, h: c.meta.h
    })));
    renderGraphMarks(lyr['lyr-marks'], lyr['lyr-edges'], ghostMarks, chgMarks, markEls, NS, obstacles, markBoxes);
  }
  svg.addEventListener('wheel', e => {
    e.preventDefault();
    const q = toView(e);
    const nk = Math.min(3, Math.max(.25, gview.k * (e.deltaY < 0 ? 1.12 : 0.89)));
    gview.tx = q.x - nk * (q.x - gview.tx) / gview.k;
    gview.ty = q.y - nk * (q.y - gview.ty) / gview.k;
    gview.k = nk; gview.adjusted = true; applyT();
  }, { passive: false });
  let panning = null;
  svg.addEventListener('pointerdown', e => {
    const q = toView(e);
    panning = { qx: q.x, qy: q.y, tx: gview.tx, ty: gview.ty };
    /* 背景平移与拖节点同一条「拖动」语义：同一处拦默认 + 同一处挂 is-dragging */
    e.preventDefault();
    svg.classList.add('is-dragging');
    try{ svg.setPointerCapture(e.pointerId); }catch(err){}
  });
  svg.addEventListener('pointermove', e => {
    if (dragNode){
      const m = dragNode;
      if (!m.moved && Math.hypot(e.clientX - m.sx, e.clientY - m.sy) < 4) return;
      m.moved = true;
      const p = toWorld(e);
      const nx = p.x - m.dx, ny0 = p.y - m.dy;
      /* 技术视图的纵向**夹在本层行**：**层是 TECH.md 声明的事实，而拖动没有写回路径** ——
         不写回就不许假装能改层（否则用户会以为"它换层了"，界面承诺了它做不到的事）。
         这条判据适用于今后任何拖动/编辑行为的加挂。 */
      let ny = ny0;
      if (graphView === 'tech' && m.f.__layer != null){
        const li = {}; ((DATA.tech && DATA.tech.layers) || []).forEach((L, i) => li[L] = i);
        const ri = li[m.f.__layer] == null ? 0 : li[m.f.__layer];
        ny = 90 + ri * 120 + m.f.h / 2;
      }
      m.f.x = nx; m.f.y = ny;
      m.g.setAttribute('transform', 'translate(' + nx + ',' + ny + ')');
      gview.pos.set(m.f.name, { x: nx, y: ny });   // 手动位置记下来，刷新后不丢
      redraw(m.f); placeChildren(m.f);            // 同一帧内更新连线与子项（不重建 DOM，§A5）
      const ck = chgMarks.get(m.f.name); if (ck) ck.setAttribute('transform', 'translate(' + nx + ',' + ny + ')');
      /* 幽灵标记**不在这里搬**：它的落点是"记忆槽 + 相对偏移"，由 syncGhosts() 独占（见其定义处）。
         上一轮就是这条路径与 syncGhosts 同时动它 ⇒ 用户"一移动就错位"（实测 markDx=355 而 stubDx=74）。 */
      return;
    }
    if (!panning) return;
    const q = toView(e);
    gview.tx = panning.tx + (q.x - panning.qx);
    gview.ty = panning.ty + (q.y - panning.qy);
    gview.adjusted = true; applyT();
  });
  function endGesture(e, cancelled){
    const m = dragNode;
    dragNode = null; panning = null; svg.classList.remove('is-dragging');
    if (m){
      gview.drag = false;
      if (m.moved) gview.adjusted = true;
      else if (!cancelled){ pop.classList.remove('on'); openNodePanel(m.f.name); }
      if (gview.deferred){ gview.deferred = false; doRefreshQuiet(); }   // 拖动期间押后的自动刷新
    }
    if (e && e.pointerId !== undefined){ try{ svg.releasePointerCapture(e.pointerId); }catch(err){} }
  }
  svg.addEventListener('pointerup', e => endGesture(e, false));
  svg.addEventListener('pointercancel', e => endGesture(e, true));
  svg.addEventListener('lostpointercapture', () => { if (dragNode || panning) endGesture(null, true); });
  /* 缩放控件：＋ / － / 适应屏幕（以视野中心为锚点）/ 重置布局（把手动位置清掉） */
  const tools = qs('#gTools');
  if (tools){
    const zoomAt = f => {
      const rect = svg.getBoundingClientRect();
      const cx = rect.width / 2, cy = rect.height / 2;
      const nk = Math.min(3, Math.max(.25, gview.k * f));
      gview.tx = cx - nk * (cx - gview.tx) / gview.k;
      gview.ty = cy - nk * (cy - gview.ty) / gview.k;
      gview.k = nk; gview.adjusted = true; applyT();
    };
    const bind = (sel, fn) => { const b = tools.querySelector(sel); if (b) b.onclick = fn; };
    bind('[data-gz="in"]', () => zoomAt(1.25));
    bind('[data-gz="out"]', () => zoomAt(1 / 1.25));
    bind('[data-gz="fit"]', fit);
    bind('[data-gz="reset"]', () => { gview.pos.clear(); gview.markSlots.clear(); gview.adjusted = false; renderGraph(); });
    /* 全屏：优先走**真·窗口全屏**（requestFullscreen），拿不到或被拒就退回「铺满视口的弹层」（.fs）。
       为什么必须真全屏：桌面端那条原生标题栏（菜单栏 + 窗口按钮）页面 CSS 盖不住 —— DSH 自己也只在
       `html[data-fullscreen]` 时把那条 band 收掉（全屏状态由桌面端 preload 镜像上去）。
       fullscreen 落在 `.cyd-app` 上（不是图容器）：这样弹层 #ovl 仍在同一棵子树里，全屏中点节点
       弹出的面板照常可见；再给它补 cyd-immersive，复用「整页模式只留关系图」那套布局。
       进入先把视野置成「适应」，退出时：你亲手调过视野就还原回去，没调过就重新适应。
       relayout 在下面才定义 —— 这里只是注册闭包，点按钮时它早就初始化好了。 */
    const syncFsBtn = () => {
      const b = tools.querySelector('[data-gz="fs"]'); if (!b) return;
      b.innerHTML = fsOn() ? '⤡ 退出全屏' : '⛶ 全屏';
      b.title = fsOn() ? '退出全屏（Esc）' : '全屏（Esc 退出）';
    };
    const syncRoot = on => {
      if (on){ if (!rootEl.classList.contains('cyd-immersive')){ rootEl.classList.add('cyd-immersive'); fsAddedImmersive = true; } }
      else if (fsAddedImmersive){ rootEl.classList.remove('cyd-immersive'); fsAddedImmersive = false; }
    };
    /* 进/出全屏必须**重渲染**：V3 流动边只在 renderGraph 里按 fs 状态创建（进全屏只 relayout 的话
       永远不会有流动元素）。renderGraph 末尾自带 layoutHeight/fit，gview.pos 与展开状态都跨重渲染保留。 */
    const enterFs = () => {
      graphFs = true; box.classList.add('fs'); syncRoot(true); syncFsBtn();
      gview.adjusted = false; renderGraph();
    };
    const leaveFs = () => {
      graphFs = false; box.classList.remove('fs'); syncRoot(false); syncFsBtn();
      if (fsSaved && fsSaved.adjusted){
        gview.tx = fsSaved.tx; gview.ty = fsSaved.ty; gview.k = fsSaved.k; gview.adjusted = true;
        renderGraph(); applyT();
      } else { gview.adjusted = false; renderGraph(); }
      fsSaved = null;
    };
    const toggleFs = force => {
      if (!box) return;
      const on = (force === undefined) ? !fsOn() : !!force;
      if (on === fsOn()) return;
      if (on){
        fsSaved = { tx: gview.tx, ty: gview.ty, k: gview.k, adjusted: gview.adjusted };
        const req = rootEl.requestFullscreen || rootEl.webkitRequestFullscreen;
        if (typeof req === 'function'){
          /* 同步抛错也要兜底：某些环境（旧 webkit 别名、直接拒绝）不是 reject 而是 throw，
             不 catch 按钮就"点了没反应"——这正是 .fs 兜底要覆盖的形态。 */
          let p;
          try { p = req.call(rootEl); }
          catch (e){
            console.warn('[cyd] requestFullscreen 失败，退回铺满视口的弹层：' + ((e && e.message) || e));
            enterFs(); return;
          }
          Promise.resolve(p).catch(enterFs);
        } else enterFs();
      } else if (document.fullscreenElement){
        Promise.resolve(document.exitFullscreen()).catch(leaveFs);
      } else leaveFs();
    };
    bind('[data-gz="fs"]', () => toggleFs());
    syncFsBtn();
    if (graphFsHandler) document.removeEventListener('fullscreenchange', graphFsHandler);
    graphFsHandler = () => {
      if (document.fullscreenElement === rootEl) enterFs();
      else if (fsOn()) leaveFs();
    };
    document.addEventListener('fullscreenchange', graphFsHandler);
    if (graphEscHandler) document.removeEventListener('keydown', graphEscHandler);
    graphEscHandler = e => {
      if (e.key === 'Escape' && fsOn() && !document.fullscreenElement){ e.stopPropagation(); toggleFs(false); }
    };
    document.addEventListener('keydown', graphEscHandler);
  }
  /* 容器尺寸变化（切进整页、拉伸侧栏、缩放窗口）→ 重算 SVG 高度、同步 viewBox 并重新适配 */
  const relayout = () => {
    if (!svg.isConnected){ if (graphRO) graphRO.disconnect(); return; }
    layoutHeight();
    syncBox();
    if (gview.adjusted) applyT(); else fit();
  };
  if (typeof ResizeObserver !== 'undefined'){
    if (graphRO) graphRO.disconnect();
    graphRO = new ResizeObserver(relayout);
    graphRO.observe(box || svg);
  }
  if (graphWinHandler) window.removeEventListener('resize', graphWinHandler);
  graphWinHandler = relayout;
  window.addEventListener('resize', graphWinHandler);
  /* V3 保险 1 的配套：偏好变化时重画（每次重渲染先摘掉旧监听，避免堆积） */
  if (window.matchMedia){
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (graphMqHandler && mq.removeEventListener) mq.removeEventListener('change', graphMqHandler);
    graphMqHandler = () => renderGraph();
    if (mq.addEventListener) mq.addEventListener('change', graphMqHandler);
  }
  layoutHeight();
  if (gview.adjusted){ syncBox(); applyT(); } else fit();
}

/* ---------- V1「缺 X」标记 与 V4 变更角标（都进 g.lyr-marks，随节点平移） ---------- */
/* 幽灵桩 / 圆环 / 「缺 X」标记的**引用登记**：它们原先每轮渲染新建后即丢引用，
   于是 `redraw()`（拖动重绘）重算不了 → 用户说"**这个只要一移动就会错位**"。
   现在登记进 `ghostEls`，由 `syncGhosts()` 在重绘时按当前 `f.x/f.y` **现算**（与层带同一口径）。 */
let ghostEls = [];
function syncGhosts(){
  if (!ghostEls.length) return;
  ghostEls.forEach(e => {
    const f = e.f, x0 = f.x - f.w / 2;
    if (e.gp){ e.gp.setAttribute('d', 'M' + x0 + ',' + f.y + ' L' + (x0 - e.stub) + ',' + f.y); }
    if (e.ring){ e.ring.setAttribute('cx', x0 - e.stub); e.ring.setAttribute('cy', f.y); }
    if (e.g && e.ci >= 0){
      /* 位置只有**一处**算法：节点坐标 + 记忆槽的相对偏移（`gview.markSlots`，渲染时写入）。
         拖动中（`redraw`）与重渲染（`renderGraphMarks`）都从**同一个记忆**取值 ⇒ 不换槽。 */
      const m = gview.markSlots.get(f.name);
      const dx = m ? m.dx : e.dx, dy = m ? m.dy : e.dy;
      e.g.setAttribute('transform', 'translate(' + (f.x + dx) + ',' + (f.y + dy) + ')');
    }
  });
}

function renderGraphMarks(lyrMarks, lyrEdges, ghostMarks, chgMarks, markEls, NS, obstacles, markBoxes){
  obstacles = obstacles || [];
  markBoxes = markBoxes || [];
  const [minX0, maxX0, minY0, maxY0] = obstacles.reduce((a, o) => [
    Math.min(a[0], o.x), Math.max(a[1], o.x + o.w), Math.min(a[2], o.y), Math.max(a[3], o.y + o.h)
  ], [1e9, -1e9, 1e9, -1e9]);
  const clampX = (x, w) => Math.max(minX0, Math.min(x, maxX0 - w));
  const clampY = (y, h) => Math.max(minY0, Math.min(y, maxY0 - h));
  const hitAny = box => obstacles.some(o => boxHit(box, o));
  /* 按节点归并幽灵依赖（**本地 Map**：早期版本把列表挂在 DATA 的功能对象上，
     重渲染会累积成"等 4 个"、title 里同一条列两遍——那是重复计数的老毛病） */
  const ghostByNode = new Map();
  ghostMarks.forEach(m => {
    if (!ghostByNode.has(m.f.name)) ghostByNode.set(m.f.name, { f: m.f, list: [] });
    ghostByNode.get(m.f.name).list.push(m);
  });
  /* V1 断头桩 +「缺 X」标记（§B2 修订后：桩在**左**——依赖从左侧进入，左侧才是"进口"，与 §B3 语义一致）
     固定顺序：节点左边缘 → 断头桩（16–56，夹到最近左邻之外）→ 8px → 标记；标记与桩**绝不重叠**。 */
  ghostEls = [];
  ghostByNode.forEach(({ f, list }) => {
    const x0 = f.x - f.w / 2;                       // 源节点**左**边缘（§B2 修订）
    let gap = GHOST_STUB;                           // 没有左邻 → 取满
    obstacles.forEach(o => {
      if (o.x + o.w <= x0 + 0.01 && o.y - 0.01 < f.y && f.y < o.y + o.h + 0.01)
        gap = Math.min(gap, x0 - (o.x + o.w));
    });
    const stub = Math.max(GHOST_STUB_MIN, Math.min(GHOST_STUB, gap - GAP_AFTER_STUB));
    /* 一条桩 + 一个空心圆环（同一个节点只画一次） */
    const gp = document.createElementNS(NS, 'path');
    gp.setAttribute('class', 'edge ghost');
    /* `data-stub` / `data-stub-len`：让**断言与实现同源** —— 验收直接按它取桩，
       不再靠"猜哪个 .edge.ghost 是桩"（本轮就是因为猜错元素，拿到 `桩长=null`，差点把
       "已按 §B2 实现"误判成"桩没锚在节点左边缘"）。 */
    gp.setAttribute('data-stub', '1');
    gp.setAttribute('data-stub-len', String(stub));
    gp.setAttribute('data-stub-from', 'node-left');   /* 实现自己声明锚点（§B2）：断言按它取，不另算几何 */
    gp.setAttribute('d', 'M' + x0 + ',' + f.y + ' L' + (x0 - stub) + ',' + f.y);
    lyrEdges.appendChild(gp);
    const ring = document.createElementNS(NS, 'circle');
    ring.setAttribute('class', 'ghostend');
    ring.setAttribute('cx', x0 - stub); ring.setAttribute('cy', f.y); ring.setAttribute('r', 2.5);
    lyrEdges.appendChild(ring);
    markBoxes.push({ x: x0 - stub, y: f.y - 3, w: stub, h: 6 });     // 桩也纳入 bbox（细矩形）
    /* 标记**一个表达式拼完**（不跨语句累加，门禁才守得住「缺 X」「X 已废弃」「缺 X 等 N 个」）；
       **形态逐字取 copy-deck §3**：不存在 = 「缺 X」、已废弃 = 「**X 已废弃**」（名字在前，不是"已废弃 X"）；
       截断**只截名字**：旧写法把整句截到 12 字 → 「等 2 个」被砍掉 → 用户看到「缺 不存在的模块 等…」，
       正是"看不懂缺标注"的来源（实测真机 FAIL 才暴露）。计数与「已废弃」**永不被截断**。 */
    const _tail = list.length > 1 ? ' 等 ' + list.length + ' 个' : '';
    const _obs = !!list[0].obsolete;
    const _nameMax = Math.max(6, 12 - [...((_obs ? '' : '缺 ') + (_obs ? ' 已废弃' : '') + _tail)].length);
    const _nm = [...list[0].name].length > _nameMax ? [...list[0].name].slice(0, _nameMax).join('') + '…' : list[0].name;
    /* 标签拼装：**段间只留单个变量、纯拼接**（门禁第二层「字面段逐字 + 相邻」里，段与段之间只容忍
       拼接语法 —— 套三元/函数调用会让它判"顺序/相邻对不上"，实测四轮）。四段字面按 deck 顺序写出：
       「缺 X」「X 已废弃」「缺 X 等 N 个」；截断只作用于名字（后缀不可截）。 */
    let label;
    if (list.length > 1){
      label = _obs ? (_nm + ' 已废弃 等 ' + list.length + ' 个')
                   : ('缺 ' + _nm + ' 等 ' + list.length + ' 个');
    } else {
      label = _obs ? (_nm + ' 已废弃') : ('缺 ' + _nm);
    }
    const w = textWidth(label) + 12, h = 14;
    /* 候选位置 #1 = 固定顺序「节点左边缘 → 断头桩 → 8px → 标记」（§B2 修订）；
       #2 上方、#3 下方为避让退路；都被占则退化为节点内左上角小徽标（只留图标 + <title>）。 */
    const cands = [
      { x: f.x - f.w / 2 - stub - GAP_AFTER_STUB - w, y: f.y - h / 2 },
      { x: f.x - w / 2, y: f.y - f.h / 2 - 6 - h },
      { x: f.x - w / 2, y: f.y + f.h / 2 + 6 }
    ];
    let spot = null, spotI = -1;
    /* ① **记忆槽优先**：该节点上次选中过槽 ⇒ 先按它算位置；只要不被占/不越界就**沿用**（不换槽）。
       ② 否则按候选顺序挑，并把结果写进 `gview.markSlots`（**唯一写点**）。 */
    const memo = gview.markSlots.get(f.name);
    if (memo){
      const p = { x: f.x + memo.dx, y: f.y + memo.dy, w: w, h: h };
      if (!hitAny(p) && !boxHit(p, { x: x0 - stub, y: f.y - 3, w: stub, h: 6 })){ spot = p; spotI = memo.ci; }
    }
    if (!spot){
      for (let i = 0; i < cands.length; i++){
        const c = cands[i];
        const probe = { x: c.x, y: c.y, w, h };
        /* 桩本身也是障碍：标记不许压在桩上（与"节点左边缘 → 桩 → 8px → 标记"同一口径） */
        if (!hitAny(probe) && !boxHit(probe, { x: x0 - stub, y: f.y - 3, w: stub, h: 6 })){ spot = c; spotI = i; break; }
      }
      if (spot) gview.markSlots.set(f.name, { ci: spotI, dx: spot.x - f.x, dy: spot.y - f.y });
    }
    if (spot) markBoxes.push({ x: spot.x, y: spot.y, w, h });
    const ttlText = list.map(x => '依赖的功能「' + x.name + '」' + (x.obsolete ? '已废弃' : '不存在')).join('；');
    const g = document.createElementNS(NS, 'g');
    const ttl = document.createElementNS(NS, 'title'); ttl.textContent = ttlText;
    if (spot){
      g.setAttribute('class', 'missingmark');
      /* 独占定位属性：断言/探针**必须按它取**，不许再靠"DOM 里第一个 .missingmark"这种隐含假定
         （本轮实测：类名确实专属，但"第一个"未必是这条桩的标记 ⇒ 测量证明不了实现，白改一轮）。
         `data-for` = **宿主节点名**（不是缺失名），便于与"被拖动的那个节点"对齐。 */
      g.setAttribute('data-ghost-mark', '1');
      g.setAttribute('data-for', f.name);
      g.setAttribute('transform', 'translate(' + spot.x + ',' + spot.y + ')');
      const r = document.createElementNS(NS, 'rect');
      r.setAttribute('x', 0); r.setAttribute('y', 0);
      r.setAttribute('width', w); r.setAttribute('height', h); r.setAttribute('rx', 8);
      r.setAttribute('stroke-width', 1);
      r.style.fill = 'var(--warn-soft)'; r.style.stroke = 'var(--warn)';
      const t = document.createElementNS(NS, 'text');
      t.setAttribute('x', w / 2); t.setAttribute('y', h / 2 + 4); t.setAttribute('text-anchor', 'middle');
      t.setAttribute('font-size', 11);
      t.style.fill = 'var(--warn)'; t.textContent = label;
      g.appendChild(r); g.appendChild(t);
      /* 登记引用（含**选中的候选序号**与尺寸），拖动时由 syncGhosts() 按同一公式重算 */
      ghostEls.push({ gp: gp, ring: ring, g: g, f: f, stub: stub, ci: spotI, w: w, h: h,
                      dx: spot.x - f.x, dy: spot.y - f.y });
    } else {
      /* 兜底：贴在节点左上角内部（永远不可能压到别人），细节进 <title> */
      g.setAttribute('class', 'missingmark compact');
      g.setAttribute('data-ghost-mark', '1'); g.setAttribute('data-for', f.name);
      g.setAttribute('transform', 'translate(' + (f.x - f.w / 2 + 9) + ',' + (f.y - f.h / 2 + 9) + ')');
      const r = document.createElementNS(NS, 'rect');
      r.setAttribute('x', -6); r.setAttribute('y', -6); r.setAttribute('width', 12); r.setAttribute('height', 12); r.setAttribute('rx', 4);
      r.setAttribute('stroke-width', 1);
      r.style.fill = 'var(--warn-soft)'; r.style.stroke = 'var(--warn)';
      const t = document.createElementNS(NS, 'text');
      t.setAttribute('x', 0); t.setAttribute('y', 4); t.setAttribute('text-anchor', 'middle');
      t.setAttribute('font-size', 10);
      t.style.fill = 'var(--warn)'; t.textContent = '!';
      g.appendChild(r); g.appendChild(t);
      markBoxes.push({ x: f.x - f.w / 2 + 3, y: f.y - f.h / 2 + 3, w: 12, h: 12 });
    }
    g.appendChild(ttl);
    lyrMarks.appendChild(g);
    /* **不登记进 `markEls`**：那是"按 `translate(节点x, 节点y)` 整体搬运"的路径（给变更角标等用），
       而幽灵标记的落点是"记忆槽 + 相对偏移"，由 `syncGhosts()` 独占负责 —— 两条路径同时动它
       就是上一轮"一移动就错位"的根因（实测 `markDx=355.47` 而 `stubDx=74.47`）。单一执行路径。 */
  });
  /* V4：本挂载周期第一次渲染时读快照算一次，之后靠内存集合（点开面板即撤） */
  if (!chgLoadedOnce){ markChanges().forEach(n => chgSeen.add(n)); chgLoadedOnce = true; }
  chgSeen.forEach(name => {
    const f = DATA.features.find(x => x.name === name);
    if (!f){ chgSeen.delete(name); return; }
    const c = document.createElementNS(NS, 'circle');
    c.setAttribute('class', 'chgmark');
    c.setAttribute('cx', f.w / 2 - 6); c.setAttribute('cy', -f.h / 2 + 6); c.setAttribute('r', 5);
    c.style.fill = 'var(--accent)'; c.style.stroke = 'var(--panel)'; c.style.strokeWidth = '1.5';
    c.setAttribute('transform', 'translate(' + f.x + ',' + f.y + ')');
    const ttl = document.createElementNS(NS, 'title');
    ttl.textContent = chgTitle(f);
    c.appendChild(ttl);
    lyrMarks.appendChild(c);
    chgMarks.set(name, c);
  });
}
/* 打开节点面板 / 功能详情 = "看过了"：撤掉角标（§E5） */
function dismissChgMark(name){
  if (!chgSeen.has(name)) return;
  chgSeen.delete(name);
  const el = chgMarks.get(name);
  if (el && el.parentNode) el.parentNode.removeChild(el);
  chgMarks.delete(name);
}

/* ---------- 现在 Tab（只留时间线；决策与待办已搬到独立 tab） ---------- */
function renderNow(){
  const d = DATA;
  let h = '<div class="card"><h3>进展时间线</h3>';
  if (d.timeline.length){
    h += '<ul class="tl" id="tl">';
    d.timeline.forEach((t, i) => {
      h += '<li class="' + (i < TL_SHOW ? '' : 'old') + '"><time>' + esc(t.dt) + '</time><br>' + linkify(esc(t.text));
      if (t.evidence && t.evidence.length) h += '<div class="ev">' + evHtml(t.evidence) + '</div>';
      h += '</li>';
    });
    h += '</ul>';
    if (d.timeline.length > TL_SHOW) h += '<button id="moreTl">查看更早的 ' + (d.timeline.length - TL_SHOW) + ' 条 ▾</button>';
  } else h += '<div class="empty">还没有进展记录</div>';
  h += '</div>';
  qs('#now').innerHTML = h;
  const more = qs('#moreTl');
  if (more) more.onclick = function(){
    const tl = qs('#tl'); tl.classList.toggle('showold');
    this.textContent = tl.classList.contains('showold') ? '收起 ▴' : ('查看更早的 ' + (d.timeline.length - TL_SHOW) + ' 条 ▾');
  };
}

/* ---------- 决策与待办 Tab（⚖）：四个分段 + 三态卡 + 待办勾选 ---------- */
let onlyPending = false;         // 顶部工具「只看待拍板」
let pickedTodos = new Set();     // 复选框勾上的待办（只改界面，点「确认」才发消息）
let reportedTodos = new Set();   // 本会话内已报上去的待办（行内「已报 · 待生效」；条数 N 仍以文件为准）
function todoCmd(text){ return '待办「' + text + '」我做完了，记一笔'; }
function decidedKeys(dc){ return dc.decided ? dc.decided.split(/[、,]/) : []; }
function decisionHtml(dc){
  const keys = decidedKeys(dc);
  const ob = !!dc.obsolete;
  /* 三态：待拍板 / 已定 X / 已废弃（终态）。已定与已废弃都不给勾选框与发送按钮。 */
  const cls = 'decision' + (ob ? ' obsolete' : (dc.decided ? ' decided' : ''));
  const state = ob ? ' · 已废弃' : (dc.decided ? ' · 已定 ' + esc(dc.decided) : ' · 等你拍板');
  let h = '<div class="' + cls + '" id="dec-' + esc(dc.id) + '"><div class="did">决策 ' + esc(dc.id) + state + '</div>'
    + '<h4>' + (dc.decided && !ob ? '✅ ' : (ob ? '' : '⚠ ')) + esc(dc.title) + '</h4>';
  dc.options.forEach(o => {
    if (ob || dc.decided){
      h += '<button class="optbtn" disabled><b>' + esc(o.key) + '</b><span>' + esc(o.text)
        + (!ob && keys.includes(o.key) ? ' <span class="chosen">✓ 已定</span>' : '') + '</span></button>';
    } else {
      h += '<button class="optbtn selable" data-did="' + esc(dc.id) + '" data-key="' + esc(o.key) + '"><b>' + esc(o.key) + '</b><span>' + esc(o.text) + '</span><span class="tick">✓</span></button>';
    }
  });
  if (ob){
    h += '<div class="actrow"><button class="btn mini" data-recover="' + esc(dc.id) + '">恢复</button></div>';
  } else if (!dc.decided){
    h += '<textarea class="note" data-note="' + esc(dc.id) + '" placeholder="补充说明（可选，发送时会一并带上）"></textarea>';
    if (env.decide){
      h += '<div class="actrow"><span class="selcount" data-selcount="' + esc(dc.id) + '"></span>'
        + '<button class="btn primary" data-senddec="' + esc(dc.id) + '" disabled>发送拍板</button></div>';
      h += '<p class="dhint">勾选项（可多选），想补充就写一句 → 「发送拍板」。</p>';
      h += '<p class="dhint">会话不在线时会先记下，下次更新生效。</p>';
    } else {
      h += '<div class="actrow"><span class="selcount" data-selcount="' + esc(dc.id) + '"></span>'
        + '<button class="btn primary" data-copydec="' + esc(dc.id) + '" disabled>复制拍板</button></div>';
      h += '<p class="dhint">勾选项（可多选），想补充就写一句 → 「复制拍板」→ 粘贴到聊天框发送。</p>';
    }
  }
  return h + '</div>';
}
// 选择与补充说明以 DOM 为准（不带外挂状态）：重渲染后屏幕上看到什么，复制出去就是什么
function bindComposers(root){
  /* 契约 v1.5：界面一律允许多选——`- 多选: 是` 只是提示语，不得用它限制 UI（评审 L-1 的落地点）。 */
  root.querySelectorAll('.optbtn.selable').forEach(b => b.onclick = () => {
    b.classList.toggle('sel');
    syncDecisionButtons(root, b.dataset.did);
  });
  root.querySelectorAll('textarea[data-note]').forEach(t =>
    t.addEventListener('input', () => syncDecisionButtons(root, t.dataset.note)));
  root.querySelectorAll('[data-copydec]').forEach(b => b.onclick = () => copyDecision(root, b.dataset.copydec));
  root.querySelectorAll('[data-senddec]').forEach(b => b.onclick = () => sendDecision(root, b.dataset.senddec, b));
  DATA.decisions.forEach(dc => syncDecisionButtons(root, dc.id));
}
/* 没勾选项也没写补充说明时，发送/复制按钮置灰（不再用一句提示拦截）；顺带刷「已选 n 项」 */
function syncDecisionButtons(root, did){
  const d = decisionDraft(root, did);
  if (!d) return;
  root.querySelectorAll('[data-senddec="' + did + '"], [data-copydec="' + did + '"]')
    .forEach(b => { b.disabled = !!d.empty; });
  const c = root.querySelector('[data-selcount="' + did + '"]');
  if (c) c.textContent = d.keys.length ? '已选 ' + d.keys.length + ' 项' : '';
}
function decisionDraft(root, did){
  const dc = DATA.decisions.find(x => x.id === did); if (!dc) return null;
  const sel = Array.from(root.querySelectorAll('.optbtn.selable[data-did="' + did + '"].sel')).map(x => x.dataset.key);
  const keys = sel.slice().sort((a, b) => dc.options.findIndex(o => o.key === a) - dc.options.findIndex(o => o.key === b));
  const ta = root.querySelector('textarea[data-note="' + did + '"]');
  const note = (ta ? ta.value : '').trim();
  if (!keys.length && !note) return { dc, keys, note, empty: true };
  let msg = '拍板 ' + did + '「' + dc.title + '」：';
  if (keys.length) msg += '选 ' + keys.join('、');
  if (note) msg += (keys.length ? '；' : '') + '补充：' + note;
  return { dc, keys, note, msg };
}
async function sendDecision(root, did, btn){
  const d = decisionDraft(root, did);
  if (!d || d.empty) return;
  if (btn) btn.disabled = true;
  try{
    const res = await env.decide({ id: d.dc.id, title: d.dc.title, keys: d.keys, note: d.note, text: d.msg });
    toast(sendResultText(res, '拍板'));
  }catch(e){
    console.warn(e);
    copyText(d.msg);
    toast('发送失败，已改为复制——粘贴到聊天框发送');
  }finally{ syncDecisionButtons(root, did); }
}
function copyDecision(root, did){
  const d = decisionDraft(root, did);
  if (!d || d.empty) return;
  copyText(d.msg);
}
/* 已废弃 → 待拍板：走既有指令通道（离线退回复制），由我改文件并在时间线留痕 */
function recoverDecision(dc, btn){
  dispatchSend('把决策 ' + dc.id + '「' + dc.title + '」从「已废弃」恢复为「待拍板」，并在 NOW.md 时间线记一笔（编号不变）',
    '恢复决策 ' + dc.id, btn);
}
function todoRowHtml(t, done){
  return '<div class="todo">'
    + '<input type="checkbox" data-todo="' + esc(t.text) + '"' + (done ? ' checked disabled' : '') + '>'
    + '<span>' + linkify(esc(t.text)) + '</span>'
    + (reportedTodos.has(t.text) ? ' <span class="pending-tag">已报 · 待生效</span>' : '')
    + '</div>';
}
/* 勾选框只改界面；确认条上的「确认」才发消息（防误触） */
function syncTodoBar(root){
  const bar = root.querySelector('#todoConfirm');
  if (!bar) return;
  const items = Array.from(pickedTodos);
  bar.hidden = !items.length;
  const lab = bar.querySelector('.snote');
  if (lab) lab.textContent = items.length === 1 ? '待办「' + items[0] + '」做完了？' : items.length + ' 项待办做完了？';
}
async function confirmTodos(root, btn){
  const items = Array.from(pickedTodos);
  if (!items.length) return;
  if (!env.command){
    copyText(items.map(todoCmd).join('\n'));
    toast('已复制指令 · 待粘贴');
    pickedTodos.clear(); renderDecisions();
    return;
  }
  if (btn) btn.disabled = true;
  try{
    for (const t of items){
      const r = await env.command(todoCmd(t), '待办：' + t);
      if (r === 'queued') reportedTodos.add(t);
      toast(sendResultText(r, '', '我现在不在线，已记下「' + t + '」做完。下次让我更新仪表盘时生效。'));
    }
  }catch(e){
    console.warn(e);
    copyText(items.map(todoCmd).join('\n'));
    toast('发送失败，已改为复制——粘贴到聊天框发送');
  }finally{
    pickedTodos.clear();
    renderDecisions();
  }
}
function renderDecisions(){
  const d = DATA;
  const pend = d.decisions.filter(x => !x.decided && !x.obsolete);
  const done = d.decisions.filter(x => x.decided || x.obsolete);
  const undone = d.todos.filter(t => !t.done);
  const fin = d.todos.filter(t => t.done);
  let h = '<div class="dtools">'
    + '<button class="btn mini" id="onlyPendBtn" aria-pressed="' + (onlyPending ? 'true' : 'false') + '">只看待拍板</button>'
    + '<button class="btn mini" id="decCenterBtn">拍板中心</button></div>';
  if (!onlyPending){
    /* 分段 1 待拍板决策（n=0 不渲染该分段；副标题 = n 件） */
    if (pend.length){
      h += '<div class="card"><h3>待拍板决策 <span class="muted">' + pend.length + ' 件</span></h3>'
        + pend.map(decisionHtml).join('') + '</div>';
    }
    /* 分段 2 已定决策（折叠；已废弃也归在这里，不新增分段） */
    h += '<details class="card"><summary>已定决策 <span class="muted">已定 ' + done.length + ' 件</span></summary>'
      + (done.length ? done.map(decisionHtml).join('') : '<p class="snote">暂无</p>') + '</details>';
    /* 分段 3 待办（未完成在上，全部展开） */
    h += '<div class="card"><h3>待办</h3>'
      + (undone.length ? undone.map(t => todoRowHtml(t, false)).join('') : '<p class="snote">暂无</p>')
      + '<div class="confirmbar" id="todoConfirm" hidden><span class="snote"></span>'
      + '<button class="btn primary" id="todoOk">确认</button>'
      + '<button class="btn" id="todoCancel">取消</button></div></div>';
    /* 分段 4 已完成（折叠，不可点） */
    h += '<details class="card"><summary>已完成 <span class="muted">已完成 ' + fin.length + ' 件</span></summary>'
      + (fin.length ? fin.map(t => todoRowHtml(t, true)).join('') : '<p class="snote">暂无</p>') + '</details>';
  } else {
    if (pend.length){
      h += '<div class="card"><h3>待拍板决策 <span class="muted">' + pend.length + ' 件</span></h3>'
        + pend.map(decisionHtml).join('') + '</div>';
    } else h += '<div class="empty">暂无</div>';
  }
  qs('#decisions').innerHTML = h;
  const sec = qs('#decisions');
  bindComposers(sec);
  sec.querySelectorAll('[data-recover]').forEach(b => b.onclick = () => {
    const dc = DATA.decisions.find(x => x.id === b.dataset.recover); if (dc) recoverDecision(dc, b);
  });
  sec.querySelectorAll('.todo input[type="checkbox"]:not([disabled])').forEach(cb => cb.onchange = () => {
    const text = cb.dataset.todo;
    if (cb.checked) pickedTodos.add(text); else pickedTodos.delete(text);
    syncTodoBar(sec);
  });
  const okBtn = sec.querySelector('#todoOk');
  if (okBtn) okBtn.onclick = () => confirmTodos(sec, okBtn);
  const cancelBtn = sec.querySelector('#todoCancel');
  if (cancelBtn) cancelBtn.onclick = () => { pickedTodos.clear(); renderDecisions(); };
  const onlyBtn = sec.querySelector('#onlyPendBtn');
  if (onlyBtn) onlyBtn.onclick = () => { onlyPending = !onlyPending; renderDecisions(); };
  const centerBtn = sec.querySelector('#decCenterBtn');
  if (centerBtn) centerBtn.onclick = () => openDecisionCenter();
  syncTodoBar(sec);
}

/* ---------- 版本快照（宿主注入 env.versions 才可用；离线网页没有） ---------- */
function diffLines(a, b){
  const A = String(a).split('\n'), B = String(b).split('\n');
  const n = A.length, m = B.length;
  if (n * m > 2000000) return null;   // 超大文件退化为 null（调用方给提示）
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
    dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = []; let i = 0, j = 0;
  while (i < n && j < m){
    if (A[i] === B[j]){ out.push([' ', A[i]]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]){ out.push(['-', A[i]]); i++; }
    else { out.push(['+', B[j]]); j++; }
  }
  while (i < n) out.push(['-', A[i++]]);
  while (j < m) out.push(['+', B[j++]]);
  return out;
}
function diffHtml(a, b){
  const rows = diffLines(a, b);
  if (!rows) return '<p class="muted">文件太大，暂不支持行级对比；可对 AI 说「对比版本」让我来讲差异。</p>';
  return '<div class="diffbox">' + rows.map(([t, l]) =>
    t === ' ' ? '' : '<div class="dline ' + (t === '+' ? 'add' : 'del') + '">' + (t === '+' ? '+ ' : '− ') + esc(l) + '</div>').join('') + '</div>';
}
async function openVersions(){
  if (!env.versions) return;
  openSheet('🕓 版本快照', '<p class="muted">读取中…</p>');
  try{
    const list = await env.versions.list();
    if (!list.length){
      openSheet('🕓 版本快照', '<div class="empty">还没有版本快照。每次拍板落定会自动存一份；也可以对我说「存个版本」（可附一句说明）。</div>');
      return;
    }
    const h = list.slice().reverse().map(v =>
      '<div class="verrow"><div><b>v' + v.n + '</b> <span class="muted">' + esc(v.created_at || '') + '</span><br>'
      + '<span>' + esc(v.note || '（无说明）') + '</span></div>'
      + '<button class="btn mini" data-vdiff="' + v.n + '">对比当前</button></div>').join('');
    openSheet('🕓 版本快照（' + list.length + ' 份）', '<p class="snote">快照只存 Markdown 事实源；网页版可随时重新导出。</p>' + h);
    qs('#sheet').querySelectorAll('[data-vdiff]').forEach(b => b.onclick = async () => {
      b.disabled = true; b.textContent = '对比中…';
      try{ await showVersionDiff(+b.dataset.vdiff); }
      catch(e){ toast('读取版本失败：' + ((e && e.message) || e)); }
      finally{ b.disabled = false; b.textContent = '对比当前'; }
    });
  }catch(e){
    openSheet('🕓 版本快照', '<p class="muted">读取失败：' + esc((e && e.message) || e) + '</p>');
  }
}
async function showVersionDiff(n){
  const snap = await env.versions.read(n);
  const cur = await env.versions.current();
  let h = '';
  ['PRODUCT.md', 'FEATURES.md', 'NOW.md', 'GLOSSARY.md'].forEach(name => {
    const a = (snap.files && snap.files[name]) || '', b = cur[name] || '';
    if (a === b) return;
    h += '<div class="sblock"><h4>' + name + '</h4>' + diffHtml(a, b) + '</div>';
  });
  openSheet('🕓 v' + n + ' → 当前 的差异',
    '<div class="sheetnav"><button class="btn" data-vback>← 返回版本列表</button>'
    + '<span class="muted">列表查看其他版本</span></div>'
    + (h || '<div class="empty">与当前一致。</div>')
    + '<p class="snote">回退版本：「恢复到版本 ' + n + '」。</p>');
  const back = qs('#sheet').querySelector('[data-vback]');
  if (back) back.onclick = () => openVersions();
}

/* ---------- 插件设置（宿主注入 env.settings 才可用；离线网页没有） ---------- */
async function openSettings(){
  if (!env.settings) return;
  openSheet('⚙ 设置', '<p class="muted">读取中…</p>');
  const render = view => {
    const v = view.values || {};
    let h = '<div class="sblock"><p class="snote">这些设置对整个 DSH 生效（不只当前项目）。</p>'
      + (view.writable ? '' : '<p class="snote">当前环境只读，不能修改。</p>') + '</div>';
    h += '<div class="setrow"><label><input type="checkbox" id="setNotify" ' + (v.notifyEnabled !== false ? 'checked' : '') + '> <b>双向闭环</b></label><p class="snote">面板上的拍板与指令直接发送给当前会话。关闭后改为复制文本。</p></div>';
    h += '<div class="setrow"><label>时间线默认显示条数<br><input type="number" id="setTl" class="setnum" min="5" max="200" value="' + esc(v.timelineShow || 30) + '"></label> <span class="snote">5–200。更早的收在展开按钮后。</span> <span class="snote">下次刷新面板生效</span></div>';
    h += '<div class="setrow"><label>配套 skill 的安装目录<br><input type="text" id="setSkill" class="settext" value="' + esc(v.skillRoot || '') + '" placeholder="留空即可"></label> <span class="snote">留空 = DSH 全局 skill 目录。</span> <span class="snote">重启 DSH 后生效</span></div>';
    h += '<div class="actrow"><button class="btn primary" data-setsave ' + (view.writable ? '' : 'disabled') + '>保存</button>'
       + '<button class="btn" data-setreset ' + (view.writable ? '' : 'disabled') + '>全部恢复默认</button></div>';
    openSheet('⚙ 设置', h);
    const sh = qs('#sheet');
    sh.querySelector('[data-setsave]').onclick = async ev => {
      ev.currentTarget.disabled = true;
      const set = {
        notifyEnabled: sh.querySelector('#setNotify').checked,
        timelineShow: Math.max(5, Math.min(200, parseInt(sh.querySelector('#setTl').value, 10) || 30)),
        skillRoot: sh.querySelector('#setSkill').value.trim(),
      };
      try{
        const next = await env.settings.set(view.revision, set, []);
        toast('✅ 设置已保存'); render(next);
      }catch(e){
        toast('保存失败：' + ((e && e.message) || e));
        const fresh = await env.settings.refresh().catch(() => view); render(fresh);
      }
    };
    sh.querySelector('[data-setreset]').onclick = async ev => {
      ev.currentTarget.disabled = true;
      try{
        const next = await env.settings.set(view.revision, {}, ['skillRoot', 'notifyEnabled', 'timelineShow']);
        toast('✅ 已恢复默认'); render(next);
      }catch(e){
        toast('操作失败：' + ((e && e.message) || e));
        const fresh = await env.settings.refresh().catch(() => view); render(fresh);
      }
    };
  };
  try{ render(env.settings.view || await env.settings.refresh()); }
  catch(e){ openSheet('⚙ 设置', '<p class="muted">读取失败：' + esc((e && e.message) || e) + '</p>'); }
}

/* ---------- 弹层：拍板中心 / 审计 / 功能详情 / 版本 ---------- */
function openSheet(title, body){
  qs('#sheet').innerHTML = '<div class="sheethead"><h3>' + title + '</h3><button class="xbtn" data-x title="关闭">✕</button></div><div class="sheetbody">' + body + '</div>';
  qs('#ovl').classList.add('on');
}
function closeSheet(){ qs('#ovl').classList.remove('on'); }

function openDecisionCenter(){
  const pend = DATA.decisions.filter(d => !d.decided && !d.obsolete);
  const done = DATA.decisions.filter(d => d.decided || d.obsolete);
  let h = '';
  if (!pend.length) h += '<div class="empty">当前没有待拍板的决策</div>';
  pend.forEach(dc => h += decisionHtml(dc));
  if (done.length) h += '<details><summary>已定 ' + done.length + ' 件</summary>' + done.map(decisionHtml).join('') + '</details>';
  openSheet('⚖ 等你拍板（' + pend.length + ' 件）', h);
  bindComposers(qs('#sheet'));
  /* 徽章行为不变（照旧打开本浮层）；浮层底部给一个跳去完整列表的入口 */
  const sh = qs('#sheet');
  const foot = document.createElement('div');
  foot.className = 'sheetfoot';
  foot.innerHTML = '<button class="linkbtn" data-godec>完整列表见「决策与待办」页 →</button>';
  sh.appendChild(foot);
  foot.querySelector('[data-godec]').onclick = () => { closeSheet(); gotoTab('decisions'); };
}

function openAudit(){
  const h = DATA.health;
  const head = [];
  head.push('有 <b>' + h.facts_pending + '</b> 处改动还未进仪表盘');
  head.push('<b>' + h.evidence_missing.length + '</b> 个引用的文件找不到');
  if (h.evidence_invalid && h.evidence_invalid.length) head.push('<b>' + h.evidence_invalid.length + '</b> 个引用到项目外（不允许）');
  if (h.verify_missing && h.verify_missing.length) head.push('<b>' + h.verify_missing.length + '</b> 个功能标了已验证却没写验证记录');
  if (h.facts_error === 'corrupt') head.push('变更记录文件损坏，请重新采集');
  else if (h.facts_error === 'missing') head.push('未采集变更');
  head.push('变更来源：' + (h.source === 'git' ? '代码仓库变更记录' : (h.source ? '文件修改时间' : '尚未采集')));
  const collected = fmtRel(h.facts_generated_at);
  if (collected) head.push('上次采集：' + collected);
  /* 久未采集的**审计行**（与 strip 上的 ⚠ 同一条判断、**同一个生成处** `factsStaleLines()`；三句） */
  const _age = factsStaleDays(h.facts_generated_at);
  if (_age !== null) factsStaleLines(_age).forEach(l => head.push('⚠ ' + l));
  /* S3 的**审计行**（契约 L560：技术视图 .snote + 审计行 + 徽标三处都要有；
     与 `warnings[]` 同源 `techStaleLines()`，三句各一行） */
  if (h.tech_stale && h.tech_stale.modules.length) techStaleLines(h.tech_stale).forEach(l => head.push('⚠ ' + l));
  let s = '<div class="sblock">' + head.map(l => '<p class="snote">' + l + '</p>').join('') + '</div>';
  s += '<div class="sblock"><h4>本次发现改动（' + (h.facts || []).length + ' 条）</h4>';
  if (h.facts && h.facts.length){
    s += '<div class="stablewrap"><table class="stable"><tr><th>文件</th><th>类型</th><th>改动</th><th>记进仪表盘了吗</th></tr>'
      + h.facts.map(x => '<tr><td>' + esc(x.path) + '</td><td>' + esc(x.kind) + '</td><td>' + esc(x.change) + '</td><td>' + (x.pending ? '⚠ 否' : '✅ 是') + '</td></tr>').join('') + '</table></div>';
  } else s += '<p class="snote">这次没有发现改动。</p>';
  s += '</div>';
  s += '<div class="sblock"><h4>功能引用的文件（' + h.matrix.length + ' 条）</h4>';
  if (h.matrix.length){
    s += '<div class="stablewrap"><table class="stable"><tr><th>文件</th><th>在用功能</th><th>类型</th><th>文件在吗</th></tr>'
      + h.matrix.map(r => '<tr><td>' + esc(r.path) + '</td><td>' + esc(r.owners.join(' / ')) + '</td><td>' + esc(r.kind) + '</td><td>' + (r.exists ? '✅' : '⚠ 缺失') + '</td></tr>').join('') + '</table></div>';
  } else s += '<p class="snote">还没有功能登记引用文件。</p>';
  s += '</div>';
  s += '<div class="sblock"><h4 title="内部工具、其他产品等；列在这里就不算产品改动">其他文件</h4>';
  s += (h.ignore && h.ignore.length) ? h.ignore.map(p => '<code class="ignline">' + esc(p) + '</code>').join('') : '<p class="snote">无。</p>';
  s += '</div>';
  /* 声明类文件（v1.6 防后门）：**固定两行、0 条也显示** —— 只算归置而不单列，把变更往规则里一写
     就能把「未归置」清零；单列是最低成本的防线。单位不同 → 分两类、量词各自跟着单位走
     （copy-deck §16.4：changes 侧是"声明条目/路径"，tech 侧是"具体文件"）。 */
  const dr = h.declared_refs || { changes_only: [], tech_only: [] };
  s += '<div class="sblock"><h4>仅由声明类文件引用</h4>';
  s += '<p class="snote">仅由变更规则声明的路径：' + dr.changes_only.length + ' 条</p>';
  if (dr.changes_only.length){
    s += '<div class="stablewrap"><table class="stable"><tr><th>路径</th></tr>'
      + dr.changes_only.map(p => '<tr><td>' + esc(p) + '</td></tr>').join('') + '</table></div>';
  }
  s += '<p class="snote">仅由技术地图引用的文件：' + dr.tech_only.length + ' 个</p>';
  if (dr.tech_only.length){
    s += '<div class="stablewrap"><table class="stable"><tr><th>文件</th></tr>'
      + dr.tech_only.map(p => '<tr><td>' + esc(p) + '</td></tr>').join('') + '</table></div>';
  }
  s += '</div>';
  if (h.glossary_drift && h.glossary_drift.length){
    s += '<div class="sblock"><h4>用词漂移（' + h.glossary_drift.length + ' 处——建议统一成标准用词）</h4>'
      + '<div class="stablewrap"><table class="stable"><tr><th>别名</th><th>标准用词</th><th>出现在</th><th class="num">次数</th></tr>'
      + h.glossary_drift.map(d => '<tr><td>' + esc(d.alias) + '</td><td>' + esc(d.term) + '</td><td>' + esc(d.file) + '</td><td class="num">' + d.count + '</td></tr>').join('') + '</table></div></div>';
  }
  if (h.warnings && h.warnings.length){
    s += '<div class="sblock"><h4>其他提示（' + h.warnings.length + ' 条）</h4>'
      + h.warnings.map(w => '<p class="snote">· ' + esc(w) + '</p>').join('') + '</div>';
  }
  openSheet('🩺 数据健康 · 完整审计', s);
}

/* 功能详情正文（功能卡、引用链接、节点面板共用） */
/* ---------- B2 改动影响面（§G：纯前端派生，**算法只此一处**，不进内嵌数据、不进差分比对面） ----------
   要动的文件 = 自己证据 ∪ 上游依赖链（沿 `依赖` 正向走）证据的传递闭包；
   受影响的下游 = 沿 `依赖` 反向可达的功能；文件共用 = 每条证据路径出现在哪些功能/子项里。
   环检测：闭包遍历带已访问集合；**幽灵依赖（目标不存在/已废弃）不进闭包**（由幽灵边表达）。 */
function impactOf(name){
  const byName = {};
  (DATA.features || []).forEach(f => { byName[f.name] = f; });
  const self = byName[name];
  if (!self) return null;
  const realDeps = f => (f.deps || []).filter(d => byName[d] && byName[d].status !== '已废弃');
  const seen = new Set(), files = [];
  const walk = n => {
    if (seen.has(n)) return; seen.add(n);
    const f = byName[n]; if (!f) return;
    const add = p => { if (files.indexOf(p) < 0) files.push(p); };
    (f.evidence || []).forEach(e => add(e.path));
    (f.children || []).forEach(c => (c.evidence || []).forEach(e => add(e.path)));
    realDeps(f).forEach(walk);
  };
  walk(name);
  const down = new Set();
  const rwalk = n => {
    (DATA.features || []).forEach(f => {
      if (down.has(f.name) || f.name === name) return;
      if (realDeps(f).indexOf(n) >= 0){ down.add(f.name); rwalk(f.name); }
    });
  };
  rwalk(name);
  const share = {};
  (DATA.features || []).forEach(f => {
    const list = (f.evidence || []).concat(...(f.children || []).map(c => c.evidence || []));
    list.forEach(e => {
      const s = share[e.path] || (share[e.path] = { n: 0, owners: [] });
      s.n++; if (s.owners.indexOf(f.name) < 0) s.owners.push(f.name);
    });
  });
  return { files, down: [...down], share };
}
function impactHtml(f){
  const im = impactOf(f.name);
  if (!im) return '';
  let h = '<details class="impact"><summary>改动的连带影响（要动 ' + im.files.length + ' 个文件 · 下游 '
    + im.down.length + ' 个功能）</summary>';
  h += '<div class="sblock"><h4>要动的文件（' + im.files.length + ' 个）</h4>';
  h += im.files.length
    ? '<ul class="impactlist">' + im.files.map(p => {
        const s = im.share[p] || { owners: [] };
        return '<li><code>' + esc(p) + '</code>' + (s.owners.length > 1
          ? ' <span class="badge count" title="' + esc(s.owners.join(' / ')) + '">共用 ' + s.owners.length + ' 个功能</span>' : '') + '</li>';
      }).join('') + '</ul>'
    : '<p class="muted">这个功能及其上游都还没登记证据文件。</p>';
  h += '</div>';
  h += '<div class="sblock"><h4>受影响的下游功能（' + im.down.length + ' 个）</h4>';
  h += im.down.length ? '<p class="impactval">' + im.down.map(esc).join('、') + '</p>'
    : '<p class="muted">没有别的功能依赖它。</p>';
  h += '</div>';
  const shared = Object.keys(im.share).filter(p => im.share[p].owners.length > 1);
  h += '<div class="sblock"><h4>被多个功能共用的文件（' + shared.length + ' 个）</h4>';
  h += shared.length
    ? '<div class="stablewrap"><table class="stable"><tr><th>文件</th><th>被哪些功能用</th></tr>'
      + shared.map(p => '<tr><td>' + esc(p) + '</td><td>' + esc(im.share[p].owners.join(' / ')) + '</td></tr>').join('') + '</table></div>'
    : '<p class="muted">没有共用文件。</p>';
  h += '</div></details>';
  return h;
}
function featBodyHtml(f){
  const sendable = !!env.command;
  /* 弹层排版：六个 .sblock 区块（简介/验证/子项/证据/最近在忙/依赖关系），块间 18px、块内 6–8px。
     用户 §10 的诉求是"别一行行挤在一起"，所以每个语义单元各成一块（design-tokens §12.5）。 */
  let h = '<div class="sblock"><h4>简介</h4><p class="lede">' + esc(f.desc) + '</p></div>';
  const vtext = f.verify || (f.status === '可用' ? '已标为可用，试用后确认' : (f.status === '进行中' ? '开发中' : ''));
  if (vtext) h += '<div class="sblock"><h4>验证</h4><p class="sblocktext">' + esc(vtext) + '</p></div>';
  /* 子项明细（v1.3）：功能的组成块，五态 + 证据 + 验证记录 */
  if (f.children && f.children.length){
    h += '<div class="sblock"><h4>子项</h4><p class="muted">（这个功能由哪几块组成）</p>';
    f.children.forEach(c => {
      h += '<div class="subrow"><span class="badge b-x' + SMAP[c.status] + '">' + esc(c.status) + '</span> <b>' + esc(c.name) + '</b>'
        + '<br><span class="muted">' + esc(c.desc) + '</span>';
      if (c.verify) h += '<div class="verifier">' + esc(c.verify) + '</div>';
      if (c.evidence && c.evidence.length) h += '<div class="ev">' + evHtml(c.evidence) + '</div>';
      h += '</div>';
    });
    h += '</div>';
  }
  if (f.evidence && f.evidence.length) h += '<div class="sblock"><h4>证据</h4><div class="ev">' + evHtml(f.evidence) + '</div></div>';
  /* 最近在忙：证据路径相交或正文点名「本功能」的近期时间线（子项证据也算） */
  const evPaths = new Set((f.evidence || []).map(e => e.path));
  (f.children || []).forEach(c => (c.evidence || []).forEach(e => evPaths.add(e.path)));
  const rel = DATA.timeline.filter(t => (t.evidence || []).some(e => evPaths.has(e.path)) || t.text.includes('「' + f.name + '」')).slice(0, 5);
  if (rel.length){
    h += '<div class="sblock"><h4>最近在忙</h4><p class="muted">与本功能相关的进展</p><ul class="tl">'
      + rel.map(t => '<li><time>' + esc(t.dt) + '</time> ' + linkify(esc(t.text)) + '</li>').join('') + '</ul></div>';
  }
  const used = DATA.features.filter(x => (x.deps || []).includes(f.name));
  if ((f.deps && f.deps.length) || used.length){
    h += '<div class="sblock"><h4>依赖关系</h4>';
    if (f.deps && f.deps.length) h += '<div class="kv kvwide"><b>上游依赖功能</b><span>' + f.deps.map(n => '<span class="depc" data-dep="' + esc(n) + '">' + esc(n) + '</span>').join('') + '</span></div>';
    if (used.length) h += '<div class="kv kvwide"><b>下游依赖功能</b><span>' + used.map(x => '<span class="depc" data-dep="' + esc(x.name) + '">' + esc(x.name) + '</span>').join('') + '</span></div>';
    h += '</div>';
  }
  /* 动作行：按钮一律**动词开头的纯文字**（前缀"生成指令："不重复、不用缺字形的符号） */
  h += '<div class="actrow">';
  if (f.status === '可用') h += '<button class="btn primary" data-verify="' + esc(f.name) + '">' + (env.verifyWrite || sendable ? '✅ 我已验证' : '✅ 我已验证（复制指令）') + '</button>';
  if (f.status === '设想') h += '<button class="btn" data-cmd="把「' + esc(f.name) + '」标为进行中">开始做这个</button>';
  if (f.status === '可用' || f.status === '已验证') h += '<button class="btn" data-cmd="把「' + esc(f.name) + '」标为进行中">返工重做</button>';
  if (f.status === '已验证') h += '<button class="btn" data-cmd="撤销「' + esc(f.name) + '」的验证">撤销验证</button>';
  if (f.status === '已废弃') h += '<button class="btn" data-cmd="把「' + esc(f.name) + '」恢复为设想">恢复为设想</button>';
  if (f.status !== '已废弃') h += '<button class="btn" data-cmd="废弃「' + esc(f.name) + '」">废弃</button>';
  h += '</div>';
  h += impactHtml(f);
  if (f.status === '可用'){
    h += '<p class="dhint">「我已验证」会写入状态和时间线。</p>';
    h += '<p class="dhint">其余按钮直接发给我。</p>';
    h += '<p class="dhint">（没有直发通道时，改成复制一句指令。）</p>';
  }
  else if (f.status === '进行中') h += '<p class="dhint">开发完成后我会把它标为「可用」，届时这里才会出现「✅ 我已验证」按钮。</p>';
  else if (f.status === '已验证') h += '<p class="dhint">「撤销验证」会退回到「可用」，等你重新验证。</p><p class="dhint">功能没坏，只是撤回盖章。</p>';
  else h += '<p class="dhint">状态变更属于工作请求：按钮' + (sendable ? '直接发给我。' : '会生成指令，粘贴到聊天框发给我。') + '</p>';
  h += '<p class="dhint">' + (env.capabilityNote || '') + '</p>';
  return h;
}
/* 节点面板专用：一句话直发 + 一键追问。点节点就能和 agent 交互，不用再复制粘贴。
   发送框走 DSH 原生形态：大圆角容器包住输入区，底部动作条左边五个快捷追问胶囊、右边圆形发送按钮。 */
const SEND_ICON = '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" aria-hidden="true">'
  + '<path d="M8 13V3.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>'
  + '<path d="M4 7.5 8 3.5l4 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
function askBoxHtml(f){
  const chips = [
    ['进度', '讲讲「' + f.name + '」现在到哪一步了'],
    ['风险', '「' + f.name + '」有哪些坑和风险'],
    ['改进', '「' + f.name + '」还有哪些可以改进的地方'],
    ['边界', '「' + f.name + '」的边界在哪，不做什么'],
    ['下一步', '围绕「' + f.name + '」下一步做什么'],
  ];
  /* 框内只留「输入 + 快捷追问 + 发送键」：标签在框外上方，说明在框外下方（用户裁定 + §12.4）。
     一个输入框只有一层边框 —— 边框在 .composer 上，内层 textarea 无边框无 outline。 */
  return '<p class="composerlabel">发送到主对话：</p>'
    + '<div class="composer">'
    + '<textarea data-asktext aria-label="发送到主对话"></textarea>'
    + '<div class="composerbar"><div class="chips"><span class="chiplab">快捷追问</span>'
    + chips.map(c => '<button class="chip" data-askq="' + esc(c[1]) + '">' + c[0] + '</button>').join('')
    + '</div><button class="send" data-ask title="发送到主对话" aria-label="发送到主对话">' + SEND_ICON + '</button></div>'
    + '</div>'
    + '<p class="snote composer-note">消息会自动带上这个功能的名字和状态，直接进你与我的主对话。</p>';
}
/* 直发结果 → 人话（顺便告诉用户走的是哪条通道，出问题好排查）；queuedText 允许调用方给特化句 */
function sendResultText(r, what, queuedText){
  if (r === 'queued') return queuedText || (what === '拍板'
    ? '我现在不在线，已记下你的拍板。下次让我更新仪表盘时生效。'
    : '我现在不在线，这条已记下。下次让我更新仪表盘时生效。');
  if (r === 'sent') return '✅ ' + (what || '') + '已发送到主对话';
  return '✅ ' + (what || '') + '已直达 agent';
}
/* 统一的直发：消息直接进主对话；拿不到通道或发送失败才退回复制，并把原因说清楚 */
function dispatchSend(text, summary, btn){
  const send = env.ask || env.command;
  if (!send){
    copyText(text);
    toast('这个环境拿不到直发通道，已复制——粘贴到聊天框发送');
    return;
  }
  if (btn) btn.disabled = true;
  Promise.resolve(send(text, summary))
    .then(r => toast(sendResultText(r)))
    .catch(e => {
      const why = ((e && e.message) || e || '未知原因');
      console.warn('[cyd] 直发失败，改为复制：' + why);
      copyText(text);
      toast('直发失败（' + why + '），已复制——粘贴到聊天框发送');
    })
    .finally(() => { if (btn) btn.disabled = false; });
}
function sendToAgent(name, text, btn){
  const f = DATA.features.find(x => x.name === name);
  dispatchSend('【功能地图】「' + name + '」' + (f ? '（状态：' + f.status + '）' : '') + '——' + text, '功能地图：' + name, btn);
}
function bindFeatSheet(name, reopen, withAsk){
  const sh = qs('#sheet');
  sh.querySelectorAll('[data-dep]').forEach(b => b.onclick = () => openNodePanel(b.dataset.dep));
  sh.querySelectorAll('[data-cmd]').forEach(b => b.onclick = () => dispatchSend(b.dataset.cmd, '功能地图：' + name, b));
  if (withAsk){
    const ta = sh.querySelector('[data-asktext]');
    const ab = sh.querySelector('[data-ask]');
    if (ab) ab.onclick = () => {
      const t = ((ta && ta.value) || '').trim();
      if (!t) return toast('先写一句话，或直接点下面的快捷追问');
      sendToAgent(name, t, ab);
    };
    /* 自动增高 1–4 行（24–96px），超出滚动；与 dashboard.core.css 的 max-height 同一口径 */
    const grow = () => { if (!ta) return; ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 96) + 'px'; };
    if (ta){
      ta.addEventListener('input', grow);
      grow();
      ta.addEventListener('keydown', e => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)){ e.preventDefault(); if (ab) ab.click(); }
      });
    }
    /* 快捷追问 = 把完整问句**插入**输入框（多条换行累计），不发送、不投递、不复制；
       由用户自己点发送键统一发出（用户裁定，替换掉旧的"点一下直发"实现）。 */
    sh.querySelectorAll('[data-askq]').forEach(b => b.onclick = () => {
      if (!ta) return;
      const q = b.dataset.askq;
      ta.value = ta.value ? (ta.value.replace(/\s+$/, '') + '\n' + q) : q;
      grow();
      ta.focus();
    });
  }
  const vb = sh.querySelector('[data-verify]');
  if (vb) vb.onclick = () => {
    const row = sh.querySelector('.actrow');
    if (!row) return;
    const canWrite = !!env.verifyWrite;
    row.innerHTML = '<span class="snote">你在真实使用里试过「' + esc(name) + '」了吗？'
      + (canWrite ? '确认后会写入「已验证」并在时间线记一笔：' : '确认后会复制一句话指令，粘贴到聊天框发送，我来写入「已验证」并记一笔时间线：')
      + '</span>'
      + '<button class="btn primary" data-cfy>' + (canWrite ? '确认：我已验证' : '复制指令：我已验证') + '</button>'
      + '<button class="btn" data-cfn>取消</button>';
    row.querySelector('[data-cfy]').onclick = ev => { ev.currentTarget.disabled = true; ev.currentTarget.textContent = canWrite ? '写入中…' : '复制中…'; doVerify(name, reopen); };
    row.querySelector('[data-cfn]').onclick = () => reopen();
  };
}
function openFeatDetail(name){
  const f = DATA.features.find(x => x.name === name); if (!f) return;
  dismissChgMark(name);                    // 看过即撤角标（§E5）
  openSheet(esc(f.name) + ' <span class="badge b-x' + SMAP[f.status] + '">' + esc(f.status) + '</span>', featBodyHtml(f));
  bindFeatSheet(name, () => openFeatDetail(name), false);
}
/* 点关系图节点 → 节点面板：速览 + 一句话直发 agent + 常用动作 */
function openNodePanel(name){
  /* **节点类型决定用哪张表**（不再"查不到就 return"）：技术视图的模块不是功能，
     拿模块名去 `DATA.features` 查必然落空 —— 旧写法 `if (!f) return;` 的表现就是
     "点了什么也不发生"（用户原话：节点详情根本点不开）。分支之后也**不许静默空白**：
     既不是功能也不是模块时，也要给出明确内容（而不是留一个空弹层）。 */
  const mod = ((DATA.tech && DATA.tech.modules) || []).find(x => x.name === name);
  if (mod){
    const kvRow = (k, v) => '<div class="kv kvwide"><b>' + k + '</b><span>'
      + esc((v == null || String(v).trim() === '') ? '未填写' : String(v)) + '</span></div>';
    const body = '<div class="sblock"><h4>模块</h4>'
      + kvRow('层', mod.layer) + kvRow('职责', mod.duty) + kvRow('技术', mod.tech) + kvRow('状态', mod.status)
      + kvRow('证据', (mod.evidence || []).join(', '))
      + kvRow('连到', (mod.links || []).map(l => l.name + (l.rel ? '（' + l.rel + '）' : '')).join(', '))
      + '</div><div class="sblock"><p class="snote">技术模块的详情来自 TECH.md 的声明；要改就改那份文件。</p></div>';
    dismissChgMark(name);
    openSheet(esc(name) + ' <span class="badge">技术模块</span>', body);
    return;
  }
  const f = DATA.features.find(x => x.name === name);
  if (!f){
    openSheet(esc(name), '<div class="sblock"><p class="snote">这个节点在当前数据里查不到详情（可能已被改名或删除）。</p></div>');
    return;
  }
  dismissChgMark(name);                    // 看过即撤角标（§E5）
  openSheet(esc(f.name) + ' <span class="badge b-x' + SMAP[f.status] + '">' + esc(f.status) + '</span>', askBoxHtml(f) + featBodyHtml(f));
  bindFeatSheet(name, () => openNodePanel(name), true);
}


/* ---------- 刷新与验证（能力由宿主经 env 注入） ---------- */
function applyData(d, quiet){ if (!d) return false;
  const j = JSON.stringify(d);
  if (quiet && j === lastJson) return false;   // 内容没变就不重排 DOM（面板文件流高频触发）
  if (quiet && gview.drag){ gview.deferred = true; return false; }   // 拖节点期间不重排，松手后再应用
  DATA = d; lastJson = j; renderAll(); return true; }
function doRefresh(){
  return Promise.resolve()
    .then(() => env.reload())
    .then(d => { if (d){ applyData(d); toast('✅ 已重新读取，页面已刷新'); } else { copyText('更新一下仪表盘'); toast('已复制指令，粘贴到聊天框让我更新'); } })
    .catch(e => { console.warn(e); toast('读取失败：' + (e && e.message ? e.message : e)); });
}
function doRefreshQuiet(){ return Promise.resolve().then(() => env.reload()).then(d => applyData(d, true)).catch(() => {}); }
async function doVerify(name, reopen){
  // 无论成功、发送、复制还是失败，都要把弹层里的按钮恢复到可用状态（否则会一直卡在"中…"）
  const back = typeof reopen === 'function' ? reopen : () => openFeatDetail(name);
  const restore = () => { try { back(); } catch (e) { /* 弹层已关闭也无所谓 */ } };
  try{
    const res = env.verifyWrite ? await env.verifyWrite(name) : 'fallback';
    if (res === 'ok'){ closeSheet(); await doRefreshQuiet(); toast('✅ 已写入「已验证」'); return; }
    if (env.command){
      const r = await env.command('「' + name + '」我验证过了');
      toast(sendResultText(r, '验证'));
      restore(); return;
    }
    copyText('「' + name + '」我验证过了');
    toast('指令已复制——粘贴到聊天框发送，我来写入「已验证」');
    restore();
  }catch(e){
    console.warn(e);
    copyText('「' + name + '」我验证过了');
    toast('发送失败（' + (e && e.name ? e.name : '未知错误') + '），指令已复制备用');
    restore();
  }
}

/* ---------- 复制 / toast ---------- */
function copyText(t){
  const done = () => toast('✓ 已复制，去聊天框粘贴发送');
  if (navigator.clipboard && navigator.clipboard.writeText){ navigator.clipboard.writeText(t).then(done).catch(() => fallback()); } else fallback();
  function fallback(){
    const ta = document.createElement('textarea'); ta.value = t; rootEl.appendChild(ta); ta.select();
    try{ document.execCommand('copy'); done(); }catch(e){ toast('复制失败，请手动复制：' + t); }
    rootEl.removeChild(ta);
  }
}
let toastTimer;
function toast(msg){
  const t = qs('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

/* ---------- 总渲染 ---------- */
function renderAll(){
  /* 整页模式：只渲染关系图（其余板块不生成 DOM，避免白占版面与无谓重排） */
  if (IMMERSIVE){
    const sec = qs('#features'); if (sec) sec.classList.add('on');
    renderFeatures();
    saveSeen();                      // V4 快照：渲染成功之后覆盖写入（写不进 → seenDisabled，此后不显示）
    return;
  }
  renderStrip(); renderProject(); renderFeatures(); renderNow(); renderDecisions(); renderGlossary();
  gotoTab(currentTab);
  saveSeen();
}

/* ---------- 全局事件委托 ---------- */
rootEl.addEventListener('click', e => {
  const evb = e.target.closest('[data-ev]');
  if (evb){
    const p = evb.dataset.ev;
    if (env.evidenceAction){
      try { env.evidenceAction(p); }
      catch (err){
        // 打不开要说话，不能装作没事：提示原因并把路径复制好
        toast('打不开预览（' + ((err && err.message) || '宿主未提供打开能力') + '），已复制路径');
        copyText(p);
      }
    }
    return;
  }
  const cp = e.target.closest('[data-cp]');
  if (cp){ copyText(cp.dataset.cp); return; }
  const jd = e.target.closest('[data-jd]');
  if (jd){ gotoTab('now'); flashEl('dec-' + jd.dataset.jd); return; }
  const jf = e.target.closest('[data-jf]');
  if (jf){
    gotoTab('features');
    const fb = qs('#featFilters button[data-f="all"]'); if (fb) fb.click();
    flashEl('feat-' + jf.dataset.jf);
    return;
  }
  if (e.target.closest('[data-x]')){ closeSheet(); return; }
  const pop = qs('.nodepop.on');
  if (pop && !pop.contains(e.target) && !e.target.closest('.node')) pop.classList.remove('on');
});
// 键盘可达：功能卡 / 引用链接 / 图节点与子项徽标，回车或空格等价于点击
rootEl.addEventListener('keydown', e => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const t = e.target;
  if (!t || !t.matches) return;
  if (t.matches('.feat') || t.matches('[data-jf]')){
    e.preventDefault(); t.click(); return;
  }
  if (!t.closest) return;
  const badge = t.closest('.subbadge');
  if (badge){ e.preventDefault(); badge.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); return; }
  const node = t.closest('g.node');
  if (node){
    e.preventDefault();
    if (node.dataset && node.dataset.fname) openNodePanel(node.dataset.fname);   // 与鼠标单击一致
  }
});
// Esc 关闭弹层；全局只保留一个处理器（面板每次重挂都会 init，不能叠加）
if (docKeyHandler) document.removeEventListener('keydown', docKeyHandler);
docKeyHandler = e => {
  if (!rootEl.isConnected) return;
  if (e.key === 'Escape'){
    closeSheet();
    const pop = qs('.nodepop.on'); if (pop) pop.classList.remove('on');
  }
};
document.addEventListener('keydown', docKeyHandler);

qs('#ovl').addEventListener('click', e => { if (e.target.id === 'ovl') closeSheet(); });

/* ---------- Tab ---------- */
qsa('nav.tabs button').forEach(b => b.onclick = () => {
  qsa('nav.tabs button').forEach(x => x.classList.remove('on')); b.classList.add('on');
  qsa('section').forEach(s => s.classList.toggle('on', s.id === b.dataset.tab));
  currentTab = b.dataset.tab;
});

/* ---------- 主题（深 / 浅） ---------- */
(function(){
  const root = rootEl;
  let saved = null; try{ saved = localStorage.getItem('cyd-theme'); }catch(e){}
  /* 主题只有一个来源：rootEl 的 data-theme。没存过就按系统偏好定下初始值，
     不再让 CSS 的 prefers-color-scheme 与 data-theme 各说一套。 */
  root.dataset.theme = saved || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  qs('#themeBtn').onclick = () => {
    const nxt = root.dataset.theme === 'dark' ? 'light' : 'dark'; root.dataset.theme = nxt;
    try{ localStorage.setItem('cyd-theme', nxt); }catch(e){}
  };
  /* 版本快照/设置按钮只在宿主提供对应能力时出现（DSH 面板；离线网页没有） */
  const vb2 = qs('#verBtn');
  if (vb2 && env.versions){ vb2.style.display = ''; vb2.onclick = () => openVersions(); }
  const sb = qs('#setBtn');
  if (sb && env.settings){ sb.style.display = ''; sb.onclick = () => openSettings(); }
})();


  window.__CYD_TOAST__ = toast;
  renderAll();
  return { reload: doRefresh, reloadQuiet: doRefreshQuiet, notice: toast };
}
return { init: initDashboard, ensureCss, css: CSS, parseProduct, parseFeatures, parseNow, layoutGraph, assembleData, resolveGlossary, glossaryHeaderOk, resolveDeclared, declaredSniffOk, parseTech, parseChanges, globMatch, kindOf, norm, pad, fmtDate, fmtDT, parseGlossary, glossaryDrift, textWidth, wrapName, nodeDims, truncMid };

})();


    /* 标签标题截断样式（对齐终端/文件标签的宿主规则） */
    const TITLE_CSS = ".cydp-tabtitle{text-overflow:ellipsis;white-space:nowrap;min-width:0;overflow:hidden}";
    function injectTitleCss(){
      if (typeof document === 'undefined' || document.querySelector('style[data-cydp-title]')) return;
      const s = document.createElement('style');
      s.setAttribute('data-cydp-title', '1');
      s.textContent = TITLE_CSS;
      document.head.appendChild(s);
    }

    const NS = 'devDashboard';
    const TAB_ID = 'dev-dashboard';
    /* 右侧栏 tab 的 kind：`sidebarRightTabs.register` 与 `sidebarRight.openTab` 两处共用一份 —— 单一事实源 */
    const TAB_KIND = 'dashboard';
    const MAP_TAB_ID = 'dev-dashboard-map';

    /* 标签标题里的项目名：面板体读到数据后写进来，标签订阅它 */
    const titleStore = { name: '', subs: new Set() };
    function setProjectTitle(name){
      const v = (name && name !== '未命名项目') ? name : '';
      if (titleStore.name === v) return;
      titleStore.name = v;
      titleStore.subs.forEach(fn => { try { fn(); } catch (e) { /* 单个订阅出错不影响其他 */ } });
    }
    function useProjectTitle(){
      const [v, setV] = react.useState(titleStore.name);
      react.useEffect(() => {
        const fn = () => setV(titleStore.name);
        titleStore.subs.add(fn);
        fn();
        return () => titleStore.subs.delete(fn);
      }, []);
      return v;
    }

    /* ---------- 数据层（宿主 RPC，零鉴权代码） ---------- */
    async function rpcValue(p){
      const r = await p;
      if (!r || !r.ok){ const e = r && r.error; throw new Error((e && e.code) || 'rpc-failed'); }
      return r.value;
    }
    /* ---------- 双向闭环：面板动作 → host RPC → steer / 信箱 ---------- */
    const RPC_NS = 'control-your-development';
    function rpcCarrier(ctx){
      // 按形状收窄 connection 服务（workflow-lite 同款做法）：拿不到就返回 null，面板退化为复制指令
      try{
        const svc = ctx.get('connection');
        const call = svc && svc.rpc && svc.rpc.call;
        if (typeof call !== 'function') return null;
        return { call: (ep, payload) => call.call(svc.rpc, '/api', RPC_NS + '/' + ep, payload) };
      }catch(e){ return null; }
    }
    /* 直发通道（按优先级）：
       ① 官方会话直发 ctx.sessions.binding(id).session.prompt([...],'queue')
          —— 消息直接出现在你与 agent 的主对话里，等价于你在输入框回车；
       ② 宿主 RPC（control-your-development/notify）—— agent 在线就 steer 直达，
          不在线写 dev-dashboard/.inbox.jsonl 兜底；
       ③ 两条都拿不到 → 面板退回复制，并把失败原因说清楚（不再静默复制）。 */
    function makeSessionSend(ctx){
      return async (sessionId, text) => {
        const sessions = ctx.get && ctx.get('sessions');
        const binding = sessions && typeof sessions.binding === 'function' ? sessions.binding(sessionId) : null;
        const session = binding && binding.session;
        if (!session || typeof session.prompt !== 'function') throw new Error('会话直发接口不可用');
        const r = await session.prompt([{ type: 'text', text }], 'queue');
        if (!r || r.ok !== true) throw new Error((r && r.error && (r.error.code || r.error.message)) || 'prompt-failed');
        return 'sent';
      };
    }
    function makeNotify(carrier, ctx){
      const viaSession = makeSessionSend(ctx);
      const viaRpc = carrier ? async (sessionId, kind, text, summary) => {
        const r = await carrier.call('notify', { sessionId, kind, text, summary });
        if (!r || !r.ok) throw new Error((r && r.error && (r.error.code || r.error.message)) || 'notify-failed');
        return r.value && r.value.delivered === 'queued' ? 'queued' : 'ok';
      } : null;
      /* 返回 'sent' | 'ok' | 'queued'；全都失败则抛错，带两条通道各自的原因 */
      return async (sessionId, kind, text, summary) => {
        const errs = [];
        try{ return await viaSession(sessionId, text); }
        catch (e){ errs.push('会话直发：' + ((e && e.message) || e)); }
        if (viaRpc){
          try{ return await viaRpc(sessionId, kind, text, summary); }
          catch (e){ errs.push('宿主 RPC：' + ((e && e.message) || e)); }
        } else errs.push('宿主 RPC：不可用');
        throw new Error(errs.join('；'));
      };
    }
    async function readText(remote, sessionId, path, signal){
      // 分页续读：宿主 read 有单页行数上限，靠 eof 判断是否读完，避免静默截断
      var offset = 1, out = '', page = 2000;
      for (var i = 0; i < 50; i++){
        const v = await rpcValue(remote.workspaceFiles.read(sessionId, path, { offset: offset, limit: page }, signal));
        out += v.text || '';
        if (!v.eof) break;
        const lines = v.lines || 0;
        if (!lines) break;
        offset = (v.offset || offset) + lines;
      }
      return out;
    }
    async function readOpt(remote, sessionId, path, signal){
      try { return await readText(remote, sessionId, path, signal); } catch (e){ return null; }
    }
    async function exists(remote, sessionId, path, signal){
      try { await rpcValue(remote.workspaceFiles.stat(sessionId, path, signal)); return true; } catch (e){ return false; }
    }
    async function loadAll(remote, sessionId, signal){
      const missing = [];
      const need = async (name) => {
        try { return await readText(remote, sessionId, 'dev-dashboard/' + name, signal); }
        catch (e){ missing.push(name); return ''; }
      };
      const prod = await need('PRODUCT.md');
      const feat = await need('FEATURES.md');
      const now = await need('NOW.md');
      if (missing.length){ const err = new Error('missing:' + missing.join(',')); err.missing = missing; throw err; }
      const factsRaw = await readOpt(remote, sessionId, 'dev-dashboard/.facts.json', signal);
      const ignoreRaw = await readOpt(remote, sessionId, 'dev-dashboard/.dashboard-ignore', signal);
      /* 术语表：文件名不写死 —— 面板没有列目录能力（workspaceFiles 只有 read/stat），
         所以先读渲染器写下的 .cyd.json（真实文件名 + 解析状态），再按候选名 stat 兜底。 */
      /* 术语表：判定**调用共享核**（`CYD.resolveGlossary`，契约化入口），这里只做 IO 注入。
         面板没有列目录能力（workspaceFiles 只有 read/stat），所以候选集只能按惯用名探测 ——
         那是"IO 能拿到哪些文件"，判定（显式指定 / 嗅探 / 歧义 / 两个失败 flag）全在共享核里。
         读 `.cyd.json` 失败**不再静默**：原文照传，由共享核判成 `meta_error` flag → 两端同一条 WARN。 */
      const metaRaw = await readOpt(remote, sessionId, 'dev-dashboard/.cyd.json', signal);
      const probe = ['GLOSSARY.md', 'glossary.md', '术语表.md', '词汇表.md', 'TERMS.md'];
      const texts = {};
      for (const c of probe){
        const t = await readOpt(remote, sessionId, 'dev-dashboard/' + c, signal);
        if (t != null) texts[c] = t;
      }
      /* .cyd.json 里点名的文件也要能读到（显式指定优先于探测列表） */
      let metaHint = null;
      try { metaHint = metaRaw ? JSON.parse(metaRaw) : null; }catch (e){ metaHint = null; }
      const extra = metaHint && typeof metaHint === 'object'
        ? [metaHint.glossary, metaHint.glossary_file].filter(x => typeof x === 'string' && x.trim()) : [];
      for (const c of extra){
        if (texts[c] === undefined){
          const t = await readOpt(remote, sessionId, 'dev-dashboard/' + c, signal);
          if (t != null) texts[c] = t;
        }
      }
      const glossStatus = window.CYD.resolveGlossary({
        metaRaw,
        listMd: Object.keys(texts).filter((k, i, arr) => arr.findIndex(x => x.toLowerCase() === k.toLowerCase()) === i),
        readText: n => (texts[n] === undefined ? null : texts[n])
      });
      const glossName = glossStatus.file;
      const glossRaw = glossName ? (texts[glossName] != null ? texts[glossName]
        : await readOpt(remote, sessionId, 'dev-dashboard/' + glossName, signal)) : null;
      lastGlossName = glossName;
      /* 声明类文件（v1.6）：判定调共享核 `CYD.resolveDeclared`，这里只做 IO（与术语表同款）。
         面板没有列目录能力 → 候选按惯用名探测；.cyd.json 里点名的文件也读上。
         `.versions/index.json` → 最近一份 TECH.md（**只读、不写**；缺失/坏 JSON/文件不存在 → null
         = **不产**漂移 WARN，fail-closed 与契约一致）。 */
      const declaredOf = async kind => {
        const cands = kind === 'tech'
          ? ['TECH.md', 'tech.md', '技术地图.md'] : ['CHANGES.md', 'changes.md', '变更规则.md'];
        const texts = {};
        for (const c of cands){
          const t = await readOpt(remote, sessionId, 'dev-dashboard/' + c, signal);
          if (t != null) texts[c] = t;
        }
        let hint = null;
        try { hint = metaRaw ? JSON.parse(metaRaw) : null; }catch (e){ hint = null; }
        const extra = hint && typeof hint === 'object'
          ? [hint[kind], hint[kind + '_file']].filter(x => typeof x === 'string' && x.trim()) : [];
        for (const c of extra){
          if (texts[c] === undefined){
            const t = await readOpt(remote, sessionId, 'dev-dashboard/' + c, signal);
            if (t != null) texts[c] = t;
          }
        }
        const st = window.CYD.resolveDeclared({ kind, metaRaw, listMd: Object.keys(texts).filter((k, i, arr) => arr.findIndex(x => x.toLowerCase() === k.toLowerCase()) === i),
          readText: n => (texts[n] === undefined ? null : texts[n]) });
        return { st, raw: st.file ? (texts[st.file] != null ? texts[st.file] : null) : null };
      };
      const techD = await declaredOf('tech');
      const changesD = await declaredOf('changes');
      const prevTechRaw = await (async () => {
        const idx = await readOpt(remote, sessionId, 'dev-dashboard/.versions/index.json', signal);
        if (idx == null) return null;
        let data = null;
        try { data = JSON.parse(idx); }catch (e){ return null; }
        const vers = data && Array.isArray(data.versions) ? data.versions : null;
        if (!vers) return null;
        for (let i = vers.length - 1; i >= 0; i--){
          const d = vers[i] && vers[i].dir;
          if (typeof d !== 'string') continue;
          const t = await readOpt(remote, sessionId, 'dev-dashboard/.versions/' + d + '/TECH.md', signal);
          if (t != null) return t;
        }
        return null;
      })();
      /* 待生效条数（v1.5）：以 .inbox.jsonl 文件为准，不做本地增量；投递成功后靠本函数/watch 重读再算。
         三态必须分清：stat 说没有 → 空串（= 0）；stat 说有但读失败 → null（界面显示 —，不猜数字）。 */
      let inboxRaw = '';
      if (await exists(remote, sessionId, 'dev-dashboard/.inbox.jsonl', signal)){
        inboxRaw = await readOpt(remote, sessionId, 'dev-dashboard/.inbox.jsonl', signal);
      }
      return window.CYD.assembleData(
        { prod, feat, now, glossRaw, glossName, glossStatus, factsRaw, ignoreRaw, inboxRaw,
          techRaw: techD.raw, techName: techD.st.file, techStatus: techD.st, techPrevRaw: prevTechRaw,
          changesRaw: changesD.raw, changesName: changesD.st.file, changesStatus: changesD.st },
        p => exists(remote, sessionId, p, signal));
    }
    /* 版本快照读取（workspaceFiles 只有读方法，够了）：list / read(n) / current()
       术语表按 loadAll 解析到的真实文件名走（项目可以叫 术语表.md / glossary.md …） */
    const VERSION_BASE = ['PRODUCT.md', 'FEATURES.md', 'NOW.md'];
    /* 候选探测名单只表示"面板能读哪些惯用名"（没有列目录能力）；**判定**在共享核 resolveGlossary 里 */
    let lastGlossName = null;
    function makeVersions(remote, sessionId, signal){
      async function readIndex(){
        const raw = await readOpt(remote, sessionId, 'dev-dashboard/.versions/index.json', signal);
        if (!raw) return { versions: [] };
        try { const d = JSON.parse(raw); return { versions: Array.isArray(d.versions) ? d.versions : [] }; }
        catch (e){ return { versions: [] }; }
      }
      async function readFiles(prefix){
        const files = {};
        for (const f of VERSION_BASE.concat(lastGlossName ? [lastGlossName] : [])){ files[f] = (await readOpt(remote, sessionId, prefix + f, signal)) || ''; }
        return files;
      }
      return {
        list: async () => (await readIndex()).versions,
        read: async (n) => {
          const idx = await readIndex();
          const v = idx.versions.find(x => x.n === n);
          if (!v) throw new Error('没有版本 ' + n);
          return { entry: v, files: await readFiles('dev-dashboard/.versions/' + v.dir + '/') };
        },
        current: () => readFiles('dev-dashboard/'),
      };
    }
    function watchDash(remote, sessionId, signal){
      return (async function*(){
        if (signal.aborted) return;
        const stream = remote.$stream({
          name: 'dev-dashboard watch',
          open: (lifetime) => remote.workspaceFiles.changes(sessionId, 'dev-dashboard', lifetime),
          ended: () => new Error('dashboard watch ended')
        });
        const abort = () => stream.dispose();
        signal.addEventListener('abort', abort, { once: true });
        try {
          for await (const item of stream){
            if (signal.aborted) return;
            if (item.value.kind === 'ready') item.accept();
            else yield item.value.kind;
          }
        } finally {
          signal.removeEventListener('abort', abort);
          await stream.dispose();
        }
      })();
    }

    /* ---------- 面板挂载：共享渲染核 ---------- */
    /* 空态/错误态与仪表盘本体共用 .cyd-app 变量：先补渲染核样式、再加类名。
       这里不许再写一套内联字号/宿主 token —— 与仪表盘内的文案和控件同一套样式。 */
    function emptyEl(mountEl, html){
      if (window.CYD && window.CYD.ensureCss) window.CYD.ensureCss();
      mountEl.classList.add('cyd-app');
      mountEl.innerHTML = '<div class="empty">' + html + '</div>';
    }
    /* 面板里唯一能做的动作是复制指令：把这句话发给我，我来建/更新仪表盘 */
    function copyCommand(mountEl, cmd){
      const btn = mountEl.querySelector('[data-copy-cmd]');
      if (!btn) return;
      btn.onclick = () => {
        const done = () => { btn.textContent = '✓ 已复制，去聊天框粘贴发送'; };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(cmd).then(done).catch(() => { btn.textContent = '复制失败，请手动复制：' + cmd; });
        else btn.textContent = '请手动复制：' + cmd;
      };
    }
    function mountDashboard(root, props){
      const sessionId = props.sessionId;
      const ctrl = new AbortController();
      let dead = false, timer = 0, inst = null;
      root.innerHTML = '';
      const mountEl = document.createElement('div');
      mountEl.style.height = '100%';
      // 整页模式（会话页「功能地图」）自己撑满父容器，不让滚动条插进来影响关系图高度
      mountEl.style.overflow = props.fullGraph ? 'hidden' : 'auto';
      if (props.fullGraph){ mountEl.style.display = 'flex'; mountEl.style.flexDirection = 'column'; mountEl.style.minHeight = '0'; }
      root.appendChild(mountEl);
      async function boot(){
        setProjectTitle('');   // 切会话时先清空，避免短暂显示上一个项目
        if (!sessionId){
          emptyEl(mountEl, '在左侧打开一个会话，点击右侧边栏，选择开发仪表盘，工作区内共享，初次点击需建立');
          return;
        }
        try{
          const cfg = props.configGet ? await props.configGet().catch(() => ({ available: false, values: {} })) : { available: false, values: {} };
          const data = await props.loadAll(sessionId, ctrl.signal);
          if (dead) return;
          setProjectTitle(data && data.project && data.project.name);
          const canSend = !!props.notify;
          inst = window.CYD.init(mountEl, {
            data,
            browserTab: false,
            onlyTab: props.onlyTab || null,
            fullGraph: !!props.fullGraph,
            timelineShow: (cfg.values && cfg.values.timelineShow) || undefined,
            capabilityNote: canSend
              ? '证据在新标签页打开。点关系图节点可以写一句话发给我，消息进主对话。（没有直发通道时会改成复制。）'
              : props.openResource ? '证据在新标签页打开。动作按钮会复制一句指令，粘贴到聊天框发给我。' : '动作按钮会复制一句指令，粘贴到聊天框发给我。',
            evidenceUrl: () => null,
            evidenceAction: props.openResource ? path => {
              // 地址按官方 encodeSegment/encodePath 逐字构造（保留盘符冒号）
              const enc = s => encodeURIComponent(s).replace(/%3A/gi, ':');
              const norm = String(path).replace(/\\/g, '/').replace(/^(?:\.\/)+/, '');
              const addr = 'dsh-resource://file/session/' + enc(sessionId) + '/' + norm.split('/').map(enc).join('/');
              props.openResource(addr, {});
            } : null,
            reload: () => props.loadAll(sessionId, ctrl.signal),
            verifyWrite: null,   // 写回走 notify（steer/信箱），面板不直接改文件
            /* 整页「查看详情」用：宿主未注入时为 null ⇒ 共享核只退出整页（不静默假装开了侧栏） */
            openSidebar: props.openSidebar || null,
            decide: canSend ? d => props.notify(sessionId, 'decide', d.text, '用户在仪表盘拍板 ' + d.id + (d.keys && d.keys.length ? '：选 ' + d.keys.join('、') : '') + (d.note ? '（附补充）' : '')) : null,
            command: canSend ? (text, summary) => props.notify(sessionId, 'command', text, summary || String(text).slice(0, 60)) : null,
            /* 节点面板的「直接和 agent 说一句」：kind=ask，信箱兜底时可以区分是提问还是改状态的指令 */
            ask: canSend ? (text, summary) => props.notify(sessionId, 'ask', text, summary || String(text).slice(0, 60)) : null,
            versions: props.makeVersions ? props.makeVersions(sessionId, ctrl.signal) : null,
            settings: (cfg.available && props.configSet) ? {
              view: cfg,
              refresh: () => props.configGet(),
              set: (revision, set, reset) => props.configSet(revision, set, reset),
            } : null,
          });
        }catch(e){
          if (dead || ctrl.signal.aborted) return;
          const code = String((e && e.message) || e);
          const noDash = (e && e.missing && e.missing.length === 3) || /not-found/.test(code);
          if (noDash){
            // 这个工作区还没建仪表盘：能直发就直接发，不行再给复制指令
            if (props.notify){
              emptyEl(mountEl, '这个工作区还没有仪表盘。每个工作区各有一份，工作区内对话共享。'
                + '<br><br><button class="btn primary" data-send-cmd>发送：control my development</button>'
                + '<br><br><span class="muted">点一下发给我，我来建。</span>');
              const sb = mountEl.querySelector('[data-send-cmd]');
              sb.onclick = () => {
                sb.disabled = true;
                props.notify(sessionId, 'command', 'control my development', '用户请求建立开发仪表盘')
                  .then(r => { sb.textContent = r === 'queued' ? '✓ 已记下，下次更新时生效' : '✓ 已发送，我来建立'; })
                  .catch(() => { sb.disabled = false; sb.textContent = '发送失败，请在聊天框输入：control my development'; });
              };
            } else {
              emptyEl(mountEl, '这个工作区还没有仪表盘。每个工作区各有一份，工作区内对话共享。'
                + '<br><br><button class="btn primary" data-copy-cmd>复制指令：control my development</button>'
                + '<br><br><span class="muted">复制好了，粘贴到聊天框发给我。</span>');
              copyCommand(mountEl, 'control my development');
            }
          } else if (e && e.missing && e.missing.length){
            emptyEl(mountEl, '仪表盘缺文件：<b>' + e.missing.join('、') + '</b><br><br>'
              + '<button class="btn primary" data-copy-cmd>复制指令：更新仪表盘</button>');
            copyCommand(mountEl, '更新仪表盘');
          } else {
            const plain = /bad-request/.test(code) ? '文件太大，宿主拒绝了本次读取'
              : /timeout|abort/i.test(code) ? '读取超时'
              : '读取失败（' + code + '）';
            emptyEl(mountEl, plain + '<br><br><a href="#" data-retry>点这里重试</a>，或在聊天框对我说 <b>更新仪表盘</b>。');
            const b = mountEl.querySelector('[data-retry]');
            if (b) b.onclick = ev => { ev.preventDefault(); boot(); };
          }
        }
      }
      boot();
      if (sessionId){
        (async () => {
          let backoff = 1000;
          while (!dead && !ctrl.signal.aborted){
            try{
              for await (const kind of props.watchDash(sessionId, ctrl.signal)){
                if (dead) return;
                backoff = 1000;
                clearTimeout(timer);
                timer = setTimeout(() => { if (inst) inst.reloadQuiet(); else boot(); }, 400);
              }
              // 正常结束也视为断开：退避后重连，避免静默停更
            }catch(e){
              if (dead || ctrl.signal.aborted) return;
              if (inst) inst.notice('自动更新暂时断开，正在重连…');
            }
            await new Promise(r => setTimeout(r, backoff));
            if (!dead && !ctrl.signal.aborted && inst) inst.reloadQuiet();  // 补上断线期间漏掉的变更
            backoff = Math.min(backoff * 2, 30000);
          }
        })();
      }
      return () => { dead = true; ctrl.abort(); clearTimeout(timer); };
    }

    /* ---------- 图标（与右侧栏内置图标同一画风：16×16 细线 currentColor） ---------- */
    function DashIcon(){
      return h('svg', { width: '16', height: '16', viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
        h('rect', { x: '2.5', y: '2.5', width: '11', height: '11', rx: '2', stroke: 'currentColor' }),
        h('path', { d: 'M8 2.5V13.5', stroke: 'currentColor' }),
        h('path', { d: 'M2.5 8H13.5', stroke: 'currentColor' }));
    }
    function DashGuideArtwork(){
      return h('svg', { width: '32', height: '32', viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
        h('rect', { x: '2.5', y: '2.5', width: '11', height: '11', rx: '2', stroke: 'currentColor' }),
        h('path', { d: 'M8 2.5V13.5', stroke: 'currentColor' }),
        h('path', { d: 'M2.5 8H13.5', stroke: 'currentColor' }));
    }

    /* ---------- 标签标题与面板体 ---------- */
    function DashTitle(props){
      const tab = props.useTabInfo ? props.useTabInfo().tab : null;
      const proj = useProjectTitle();
      const base = tab ? tab.title : '开发仪表盘';
      // 带上项目名，一眼看出这份仪表盘是哪个工作区的
      return h(react.Fragment, null, h(DashIcon), h('span', { className: 'cydp-tabtitle' }, proj ? base + ' · ' + proj : base));
    }
    function DashboardBody(props){
      const ref = react.useRef(null);
      const sid = props.sessionId;
      // 打开文件的两条路：宿主服务（face 注入，最稳）优先；官方同款 tab.actions 兜底
      let tabOpen = null;
      try { const info = props.useTabInfo ? props.useTabInfo() : null; tabOpen = (info && info.tab && info.tab.actions && info.tab.actions.openResource) || null; } catch (e) { tabOpen = null; }
      const openResource = props.openResource || tabOpen;
      if (props.setTabOpen) props.setTabOpen(tabOpen);
      react.useEffect(() => {
        if (!ref.current) return undefined;
        return mountDashboard(ref.current, Object.assign({}, props, { openResource }));
      }, [sid]);
      return h('div', { className: 'cydp-host', style: { height: '100%', minHeight: 0 }, ref });
    }
    /* 会话页顶部「功能地图」整页视图：同一份共享核，只显示功能板块，图占满整页 */
    function MapView(props){
      const ref = react.useRef(null);
      const sid = props.sessionId;
      react.useEffect(() => {
        if (!ref.current) return undefined;
        return mountDashboard(ref.current, Object.assign({}, props, { onlyTab: 'features', fullGraph: true }));
      }, [sid]);
      return h('div', { className: 'cydp-host', style: { height: '100%', minHeight: 0, flex: '1 1 auto' }, ref });
    }

    /* ---------- 文案 ---------- */
    const zh = { title: '开发仪表盘', 'guide.title': '开发仪表盘', 'guide.desc': '功能地图、验证进度、等你拍板的事，都在这里。', 'map.tab': '功能地图' };
    const en = { title: 'Dev Dashboard', 'guide.title': 'Dev Dashboard', 'guide.desc': 'Features, progress and pending decisions', 'map.tab': 'Feature Map' };

    /* ---------- 注册 ---------- */
    function apply(ctx){
      injectTitleCss();
      // 证据「打开文件」走宿主公开服务（与官方文件面板同一条路），不依赖组件 props 管道
      const nav = ctx.sidebarRight;
      /* 整页「功能地图」的「查看详情」按钮：退出整页 + 在右侧边栏打开**本**仪表盘 tab。
         ⚠ **`nav.openTab(TAB_KIND)` 这条路已确认有问题（2026-10-13 用户实拍）**：会话页那个视图
         自己变成了仪表盘，从侧栏回来仍是。**根因**：我按 **kind** 传参，依据是这里原先那句注释，
         而那句来自**生态里的一个例子**（dsh-context 的 id 与 kind 恰好同串 ⇒ 对参数语义零信息量）：
         **"生态里有例子" ≠ "有契约"**。详见
         `plugins/control-your-development/notes/2026-10-13-opentab-参数语义歧义.md`。
         修法（方向 A，已批准）：改成「**揭示右侧栏 + 激活我们那个 tab**」两步，**不再调 openTab**。
         ⚠ **本行以下的行为按修法改造前不要依赖**（本注释只负责不让下一个人再照着旧结论写一遍）。 */
      function openDashboardTab(){
        /* **D 版**（2026-10-13 队长批准）：**只点宿主侧栏开关**；不调任何 nav 服务、不点任何 tab。
           ——「退出整页」那半由调用方完成（`dashboard.core.js` 的点击处理器先 `exitImmersive()` 再调本函数）。
           为什么砍到这一步：`nav.openTab` 已确认会把【当前视图类型】切成 dashboard（用户实拍）；
           替代品 `nav.show()` 的语义**我没有任何依据**（"揭示侧栏"是我猜的），`focusTab()`
           （按标题文本点 `button[role="tab"]`）**可能点到别的 tab** —— 两条都可能是肇事者 ⇒ 一次排除，
           先把用户看到的"跳转切换"消掉。代价：侧栏可能停在别的 tab（**失效方向安全**：不切视图、不炸）。 */
        try {
          const b = document.querySelector('[aria-label="打开右侧边栏"]');
          if (b){ b.click(); return true; }
        } catch (e){ console.warn('[cyd] 打开右侧边栏失败', e); }
        return false;
      }
      let tabOpen = null;   // 由 DashboardBody 注入（官方同款 tab.actions.openResource）
      const setTabOpen = (fn) => { if (typeof fn === 'function') tabOpen = fn; };
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dev-dashboard: locale');
      const t = ctx.locale.bind(NS);
      // 双向闭环的 RPC 载波：没有 connection 服务时退化为「复制指令」
      const carrier = rpcCarrier(ctx);
      const notify = makeNotify(carrier, ctx);
      ctx.effect(() => ctx.sidebarRightTabs.register({
        id: TAB_ID, kind: TAB_KIND, priority: 'builtin', keepMounted: true, title: () => t('title'),
        guide: [{ id: 'open', order: 30, title: () => t('guide.title'), description: () => t('guide.desc'), icon: DashGuideArtwork }]
      }), 'dev-dashboard: tab type');
      const face = {
        loadAll: (sessionId, signal) => loadAll(ctx.remote, sessionId, signal),
        watchDash: (sessionId, signal) => watchDash(ctx.remote, sessionId, signal),
        notify,
        versions: null,   // 每个挂载点按自己的 sessionId/signal 现做（见下方 makeVersions 包装）
        makeVersions: (sessionId, signal) => makeVersions(ctx.remote, sessionId, signal),
        configGet: async () => {
          if (!carrier) return { available: false, values: {} };
          try{ const r = await carrier.call('config/get', {}); return (r && r.ok && r.value) || { available: false, values: {} }; }catch(e){ return { available: false, values: {} }; }
        },
        configSet: async (revision, set, reset) => {
          if (!carrier) throw new Error('unavailable');
          const r = await carrier.call('config/set', { revision, set, reset });
          if (!r || !r.ok) throw new Error((r && r.error && r.error.message) || (r && r.error && r.error.code) || 'config-set-failed');
          return r.value;
        },
        setTabOpen,
        openSidebar: openDashboardTab,
        openResource: (address) => {
          const errs = [];
          try { if (nav && typeof nav.openResource === 'function'){ nav.openResource(address, {}); return; } }
          catch (e){ errs.push('sidebarRight: ' + ((e && e.message) || e)); }
          try { if (typeof tabOpen === 'function'){ tabOpen(address); return; } }
          catch (e){ errs.push('tab.actions: ' + ((e && e.message) || e)); }
          throw new Error(errs.length ? errs.join(' / ') : '宿主未提供打开能力');
        }
      };
      ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
        name: 'sidebar.right.pane.tab', key: TAB_ID, locale: NS, inject: () => face
      }, DashboardBody)), 'dev-dashboard: tab body');
      ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({
        name: 'sidebar.right.pane.tab.title', key: TAB_ID
      }, DashTitle)), 'dev-dashboard: tab title');
      // 会话页顶部「功能地图」整页 tab（conversation.view 槽位，与「对话 / 轨迹」并列）
      ctx.slots.inject('conversation.view', () => ctx.slots.register({
        name: 'conversation.view', id: MAP_TAB_ID, order: 30, label: () => t('map.tab'), locale: NS,
        inject: (sessionId) => ({
          sessionId: String(sessionId),
          loadAll: face.loadAll, watchDash: face.watchDash, notify: face.notify,
          makeVersions: face.makeVersions, configGet: face.configGet, configSet: face.configSet, openResource: face.openResource,
          openSidebar: face.openSidebar,
        }),
      }, MapView));
    }

    const inject = ['slots', 'locale', 'sidebarRightTabs', 'sidebarRight', 'remote', 'remote.workspaceFiles', 'connection'];
    exports.inject = inject;
    exports.apply = apply;
    return module.exports;
  }
});
