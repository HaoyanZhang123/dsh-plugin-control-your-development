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
const CSS = ".cyd-app{\n  --bg:#f4f6fa; --panel:#ffffff; --ink:#1b2331; --ink2:#5b6575; --line:#e4e8f0;\n  --accent:#145ceb; --accent-soft:#e8effe; --ok:#127a40; --ok-soft:#e5f6ec; --on-solid:#fff;\n  --warn:#916000; --warn-soft:#fdf3e0; --gray:#616a7b; --gray-soft:#eef1f6;\n  --chip:#eef2f8; --shadow:0 1px 2px rgba(22,32,52,.05),0 4px 14px rgba(22,32,52,.06);\n  --radius:16px;\n}@media (prefers-color-scheme: dark){.cyd-app{\n  --bg:#13161c; --panel:#1c212b; --ink:#e7ebf3; --ink2:#9aa4b5; --line:#2b3240;\n  --accent:#6f9dff; --accent-soft:#22304d; --ok:#4ecb7f; --ok-soft:#173325; --on-solid:#13161c;\n  --warn:#e0a63c; --warn-soft:#3a2d14; --gray:#9099a8; --gray-soft:#262d3a;\n  --chip:#252c39; --shadow:0 1px 2px rgba(0,0,0,.35),0 4px 14px rgba(0,0,0,.3);\n}}.cyd-app[data-theme=\"light\"]{ --bg:#f4f6fa; --panel:#fff; --ink:#1b2331; --ink2:#5b6575; --line:#e4e8f0; --accent:#145ceb; --accent-soft:#e8effe; --ok:#127a40; --ok-soft:#e5f6ec; --warn:#916000; --warn-soft:#fdf3e0; --gray:#616a7b; --gray-soft:#eef1f6; --on-solid:#fff; --chip:#eef2f8; --shadow:0 1px 2px rgba(22,32,52,.05),0 4px 14px rgba(22,32,52,.06); }.cyd-app[data-theme=\"dark\"]{ --bg:#13161c; --panel:#1c212b; --ink:#e7ebf3; --ink2:#9aa4b5; --line:#2b3240; --accent:#6f9dff; --accent-soft:#22304d; --ok:#4ecb7f; --ok-soft:#173325; --warn:#e0a63c; --warn-soft:#3a2d14; --gray:#9099a8; --gray-soft:#262d3a; --on-solid:#13161c; --chip:#252c39; --shadow:0 1px 2px rgba(0,0,0,.35),0 4px 14px rgba(0,0,0,.3); }.cyd-app *{box-sizing:border-box}.cyd-app{scroll-behavior:smooth}.cyd-app :focus-visible, .cyd-app:focus-visible{outline:2px solid var(--accent) !important;outline-offset:2px}.cyd-app{margin:0;background:var(--bg);color:var(--ink);font:15px/1.7 -apple-system,\"Segoe UI\",\"PingFang SC\",\"Microsoft YaHei\",sans-serif;-webkit-font-smoothing:antialiased}.cyd-app .wrap{max-width:1120px;margin:0 auto;padding:26px 22px 70px}.cyd-app header.top{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}.cyd-app h1{font-size:21px;margin:0;letter-spacing:.2px}.cyd-app h1 .by{font-size:12.5px;color:var(--ink2);font-weight:400;margin-left:10px}.cyd-app #themeBtn{border:1px solid var(--line);background:var(--panel);color:var(--ink);border-radius:999px;padding:6px 13px;cursor:pointer;font-size:14px;box-shadow:var(--shadow)}.cyd-app .strip{display:flex;gap:10px;margin:18px 0 6px;flex-wrap:wrap}.cyd-app .pill{flex:1;min-width:150px;background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:10px 14px;box-shadow:var(--shadow);text-align:center;cursor:pointer;font:inherit;color:var(--ink)}.cyd-app .pill:hover{border-color:var(--accent)}.cyd-app .pill.static{cursor:default}.cyd-app .pill.static:hover{border-color:var(--line)}.cyd-app .pill .k{font-size:12px;color:var(--ink2);letter-spacing:.4px}.cyd-app .pill .v{font-size:16px;font-weight:650;margin-top:2px}.cyd-app .pill.alert{border-color:color-mix(in srgb,var(--warn) 55%,var(--line));background:var(--warn-soft)}.cyd-app .pill.good{border-color:color-mix(in srgb,var(--ok) 45%,var(--line));background:var(--ok-soft)}.cyd-app .min{border:1px solid var(--line);background:var(--panel);color:var(--ink2);border-radius:8px;padding:1px 7px;font-size:12px;cursor:pointer;line-height:1.5}.cyd-app .min:hover{border-color:var(--accent);color:var(--accent)}.cyd-app .lk{color:var(--accent);cursor:pointer;border-bottom:1px dashed color-mix(in srgb,var(--accent) 45%,transparent)}.cyd-app .lk:hover{border-bottom-style:solid}.cyd-app nav.tabs{display:flex;gap:8px;margin-top:14px;flex-wrap:wrap}.cyd-app nav.tabs button{border:1px solid var(--line);background:var(--panel);color:var(--ink2);padding:8px 18px;border-radius:999px;cursor:pointer;font-size:14px;transition:.15s;box-shadow:var(--shadow)}.cyd-app nav.tabs button:hover{color:var(--ink);transform:translateY(-1px)}.cyd-app nav.tabs button.on{background:var(--accent);border-color:var(--accent);color:var(--on-solid);font-weight:600}.cyd-app section{display:none;margin-top:20px}.cyd-app section.on{display:block;animation:fade .25s ease}\n@keyframes fade{from{opacity:0;transform:translateY(4px)}to{opacity:1}}.cyd-app .card{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);padding:20px 22px;box-shadow:var(--shadow);margin-bottom:16px}.cyd-app .card.flash{outline:2px solid var(--accent);outline-offset:2px}.cyd-app .card h3{margin:0 0 8px;font-size:16px;letter-spacing:.2px}.cyd-app .muted{color:var(--ink2);font-size:14px}.cyd-app .lede{font-size:15.5px;margin:4px 0 0;white-space:pre-line}.cyd-app .tag{display:inline-block;background:var(--accent-soft);color:var(--accent);border-radius:8px;font-size:12px;padding:2px 9px;margin:8px 8px 0 0;font-weight:600}.cyd-app .steps{margin:12px 0 0;padding:0;list-style:none}.cyd-app .steps li{position:relative;padding:0 0 24px 46px}.cyd-app .steps li::before{content:attr(data-n);position:absolute;left:0;top:1px;width:30px;height:30px;border-radius:50%;background:var(--accent-soft);color:var(--accent);display:flex;align-items:center;justify-content:center;font-size:13.5px;font-weight:700;border:1.5px solid color-mix(in srgb,var(--accent) 35%,transparent)}.cyd-app .steps li::after{content:\"\";position:absolute;left:14px;top:34px;bottom:4px;width:2px;background:var(--line);border-radius:2px}.cyd-app .steps li:last-child::after{display:none}.cyd-app .steps b{font-size:15px}.cyd-app .ev{margin-top:8px;display:flex;flex-wrap:wrap;gap:6px}.cyd-app .ev a, .cyd-app .ev button{font-size:12.5px;background:var(--chip);border:1px solid var(--line);border-radius:9px;padding:3px 10px;color:var(--ink2);text-decoration:none;cursor:pointer;transition:.15s}.cyd-app .ev a:hover, .cyd-app .ev button:hover{border-color:var(--accent);color:var(--accent)}.cyd-app .ev a.miss{border-color:color-mix(in srgb,var(--warn) 60%,var(--line));color:var(--warn)}.cyd-app .evrow{display:inline-flex;align-items:center;gap:3px;margin-right:4px}.cyd-app .filters{display:flex;gap:8px;flex-wrap:wrap;margin:2px 0 14px}.cyd-app .filters button{border:1px solid var(--line);background:var(--panel);color:var(--ink2);border-radius:999px;padding:5px 14px;font-size:13px;cursor:pointer;transition:.15s}.cyd-app .filters button.on{background:var(--ink);color:var(--bg);border-color:var(--ink);font-weight:600}.cyd-app .progress{height:12px;border-radius:8px;background:var(--chip);overflow:hidden;margin:4px 0 6px;position:relative}.cyd-app .progress i{display:block;height:100%;background:linear-gradient(90deg,var(--accent),var(--ok));border-radius:8px;transition:width .5s ease}.cyd-app .plabel{font-size:12.5px;color:var(--ink2);margin-bottom:16px}.cyd-app .graphbox{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);margin-bottom:18px;overflow:hidden;position:relative}.cyd-app .graphbox .ghead{display:flex;justify-content:space-between;align-items:center;padding:12px 18px;border-bottom:1px solid var(--line)}.cyd-app .graphbox .ghead b{font-size:15px}.cyd-app .graphbox .ghead span{font-size:12px;color:var(--ink2)}.cyd-app .legend{display:flex;gap:16px;flex-wrap:wrap;padding:9px 18px;border-bottom:1px solid var(--line);font-size:12.5px;color:var(--ink2)}.cyd-app .legend i{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:5px;vertical-align:-1px}.cyd-app .graphbox svg{display:block;width:100%;height:340px;cursor:grab;touch-action:none}.cyd-app .graphbox svg:active{cursor:grabbing}.cyd-app .node{cursor:pointer}.cyd-app .node rect{stroke-width:1.5;transition:.15s}.cyd-app .node:hover rect{filter:brightness(1.05)}.cyd-app .node text{font-size:12.5px;font-weight:600;pointer-events:none}.cyd-app .edge{fill:none;stroke:var(--gray);stroke-width:1.4;opacity:.45}.cyd-app .nodepop{position:absolute;z-index:5;width:235px;background:var(--panel);border:1px solid var(--accent);border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.25);padding:12px 14px;cursor:pointer;display:none}.cyd-app .nodepop.on{display:block}.cyd-app .nodepop h4{margin:0 0 4px;font-size:14px;display:flex;gap:7px;align-items:center;flex-wrap:wrap}.cyd-app .nodepop p{margin:2px 0 6px;font-size:12.5px;color:var(--ink2)}.cyd-app .nodepop .go{font-size:12px;color:var(--accent);font-weight:600}.cyd-app .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(310px,100%),1fr));gap:14px}.cyd-app .feat{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);padding:17px 19px;box-shadow:var(--shadow);transition:.18s;cursor:pointer}.cyd-app .feat:hover{transform:translateY(-2px);border-color:color-mix(in srgb,var(--accent) 45%,var(--line))}.cyd-app .feat.flash{outline:2px solid var(--accent);outline-offset:2px}.cyd-app .feat.deprecated{opacity:1;background:var(--chip)}.cyd-app .feat h3{display:flex;align-items:center;gap:8px;font-size:15.5px;flex-wrap:wrap;margin:0 0 4px}.cyd-app .badge{font-size:11.5px;padding:2px 10px;border-radius:999px;font-weight:700;white-space:nowrap}.cyd-app .b-x1{background:var(--gray-soft);color:var(--gray)}.cyd-app .b-x2{background:var(--accent-soft);color:var(--accent)}.cyd-app .b-x3{background:var(--warn-soft);color:var(--warn)}.cyd-app .b-x4{background:var(--ok-soft);color:var(--ok)}.cyd-app .b-x5{background:var(--gray-soft);color:var(--ink2);text-decoration:line-through}.cyd-app .verifier{margin-top:9px;font-size:12.5px;color:var(--ink2)}.cyd-app .cols{display:grid;grid-template-columns:1.15fr 1fr;gap:16px;align-items:start}@media (max-width:840px){.cyd-app .cols{grid-template-columns:1fr}}.cyd-app .tl{margin:0;padding:0;list-style:none}.cyd-app .tl li{position:relative;padding:0 0 20px 28px}.cyd-app .tl li::before{content:\"\";position:absolute;left:6px;top:8px;width:9px;height:9px;border-radius:50%;background:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}.cyd-app .tl li::after{content:\"\";position:absolute;left:10px;top:22px;bottom:1px;width:2px;background:var(--line)}.cyd-app .tl li:last-child::after{display:none}.cyd-app .tl time{font-size:12px;color:var(--ink2)}.cyd-app .tl .old{display:none}.cyd-app .tl.showold .old{display:block}.cyd-app #moreTl{margin-top:2px;border:1px dashed var(--line);background:transparent;color:var(--ink2);border-radius:10px;padding:7px 14px;font-size:13px;cursor:pointer;width:100%}.cyd-app #moreTl:hover{color:var(--accent);border-color:var(--accent)}.cyd-app .decision{border:1px solid color-mix(in srgb,var(--warn) 40%,var(--line));border-left:4px solid var(--warn);background:var(--warn-soft);border-radius:12px;padding:15px 17px;margin-bottom:14px}.cyd-app .decision.decided{border-color:var(--line);border-left-color:var(--ok);background:var(--panel)}.cyd-app .decision h4{margin:0 0 3px;font-size:15px}.cyd-app .decision .did{font-size:11.5px;color:var(--warn);font-weight:700;letter-spacing:.5px}.cyd-app .decision.decided .did{color:var(--ok)}.cyd-app .optbtn{display:flex;gap:10px;align-items:flex-start;width:100%;text-align:left;margin-top:8px;background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:9px 12px;cursor:pointer;font-size:13.5px;color:var(--ink);transition:.15s}.cyd-app .optbtn:hover{border-color:var(--warn);transform:translateY(-1px)}.cyd-app .optbtn b{min-width:20px;color:var(--warn)}.cyd-app .optbtn .tick{margin-left:auto;color:var(--accent);font-weight:800;visibility:hidden}.cyd-app .optbtn.sel{border-color:var(--accent);background:var(--accent-soft)}.cyd-app .optbtn.sel .tick{visibility:visible}.cyd-app .optbtn[disabled]{cursor:default;opacity:.75}.cyd-app .optbtn[disabled]:hover{transform:none;border-color:var(--line)}.cyd-app .optbtn .chosen{color:var(--ok);font-weight:700}.cyd-app .note{width:100%;margin-top:10px;border:1px solid var(--line);border-radius:10px;background:var(--panel);color:var(--ink);padding:8px 11px;font:inherit;font-size:13.5px;min-height:54px;resize:vertical}.cyd-app .copybtn{margin-top:10px;border:1px solid var(--accent);background:var(--accent);color:var(--on-solid);border-radius:10px;padding:8px 16px;font-size:13.5px;cursor:pointer;font-weight:600}.cyd-app .copybtn:hover{filter:brightness(1.07)}.cyd-app .dhint{font-size:12px;color:var(--ink2);margin:9px 0 0}.cyd-app .todo{display:flex;gap:9px;align-items:flex-start;font-size:14px;margin-top:8px}.cyd-app .todo input{margin-top:5px;accent-color:var(--ok)}.cyd-app .empty{border:1px dashed var(--line);border-radius:var(--radius);padding:22px;text-align:center;color:var(--ink2);font-size:13.5px;margin-bottom:16px}.cyd-app .toast{position:fixed;left:50%;bottom:34px;transform:translateX(-50%) translateY(20px);background:var(--ink);color:var(--bg);padding:10px 20px;border-radius:999px;font-size:13.5px;opacity:0;pointer-events:none;transition:.25s;box-shadow:0 6px 24px rgba(0,0,0,.25);z-index:70}.cyd-app .toast.show{opacity:1;transform:translateX(-50%) translateY(0)}.cyd-app .ovl{position:fixed;inset:0;background:rgba(15,20,30,.45);display:none;align-items:flex-start;justify-content:center;z-index:60;padding:40px 16px}.cyd-app .ovl.on{display:flex}.cyd-app .sheet{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);box-shadow:0 18px 60px rgba(0,0,0,.35);max-width:760px;width:100%;max-height:calc(100vh - 90px);overflow:hidden;padding:0;position:relative;display:flex;flex-direction:column}.cyd-app .sheethead{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:16px 24px 12px;border-bottom:1px solid var(--line);flex:none}.cyd-app .sheetbody{overflow:auto;padding:8px 24px 22px;flex:1;min-height:0}.cyd-app .sheethead h3{margin:0;font-size:17px;display:flex;gap:9px;align-items:center;flex-wrap:wrap}.cyd-app .xbtn{border:1px solid var(--line);background:var(--panel);color:var(--ink2);border-radius:50%;width:30px;height:30px;cursor:pointer;font-size:14px;line-height:1;flex:none}.cyd-app .xbtn:hover{border-color:var(--accent);color:var(--accent)}.cyd-app .kv{font-size:13.5px;margin-top:10px}.cyd-app .kv b{color:var(--ink2);font-weight:600;margin-right:6px}.cyd-app .depc{display:inline-block;background:var(--chip);border:1px solid var(--line);border-radius:999px;padding:3px 12px;font-size:12.5px;margin:4px 6px 0 0;cursor:pointer;color:var(--ink)}.cyd-app .depc:hover{border-color:var(--accent);color:var(--accent)}.cyd-app .actrow{display:flex;gap:10px;flex-wrap:wrap;margin-top:16px;padding-top:14px;border-top:1px dashed var(--line)}.cyd-app .actbtn{border:1px solid var(--line);background:var(--panel);color:var(--ink);border-radius:10px;padding:8px 15px;font-size:13.5px;cursor:pointer}.cyd-app .actbtn:hover{border-color:var(--accent);color:var(--accent)}.cyd-app .actbtn.primary{border-color:var(--ok);background:var(--ok);color:var(--on-solid);font-weight:700}.cyd-app .actbtn.primary:hover{filter:brightness(1.07);color:var(--on-solid)}.cyd-app footer{margin-top:30px;border-top:1px solid var(--line);padding-top:16px;font-size:13px;color:var(--ink2)}.cyd-app details{margin-top:10px}.cyd-app summary{cursor:pointer;font-size:13px}.cyd-app table{border-collapse:collapse;width:100%;font-size:12.5px;margin-top:10px}.cyd-app th, .cyd-app td{border:1px solid var(--line);padding:6px 10px;text-align:left}.cyd-app th{background:var(--chip)}.cyd-app code{background:var(--chip);border-radius:6px;padding:1px 6px;font-size:12.5px}@media screen and (max-width:380px){.cyd-app .wrap{padding:20px 12px 56px} }@media screen and (max-width:640px){.cyd-app .graphbox{overflow-x:auto}.cyd-app .graphbox svg{min-width:720px} }\n@page{margin:12mm}@media print{/* 打印一律按浅色纸面渲染：复位主题变量，压过 prefers-color-scheme 与 [data-theme=\"dark\"] */\n.cyd-app{--bg:#fff !important;--panel:#fff !important;--ink:#1b2331 !important;--ink2:#5b6575 !important;--line:#c9d0dc !important;--accent:#145ceb !important;--accent-soft:#e8effe !important;--ok:#127a40 !important;--ok-soft:#e5f6ec !important;--warn:#916000 !important;--warn-soft:#fdf3e0 !important;--gray:#616a7b !important;--gray-soft:#eef1f6 !important;--chip:#f2f4f8 !important;--on-solid:#fff !important;--shadow:none !important;background:#fff !important;color:#1b2331 !important;-webkit-print-color-adjust:exact;print-color-adjust:exact}.cyd-app{background:#fff !important}/* 隐藏交互壳；.ovl.on 必须一起压掉，否则弹层会盖在正文上一起打印 */\n.cyd-app nav.tabs, .cyd-app #themeBtn, .cyd-app .filters, .cyd-app .ghead span, .cyd-app .ovl, .cyd-app .ovl.on, .cyd-app .nodepop, .cyd-app .toast, .cyd-app #moreTl, .cyd-app #updBtn, .cyd-app .min[data-cp], .cyd-app .copybtn, .cyd-app .actrow{display:none !important}.cyd-app section{display:block !important}/* 展开被“查看更早的”折叠的时间线；证据按钮不再整体隐藏，文件路径照常打印 */\n.cyd-app .tl .old{display:block !important}.cyd-app .feat.deprecated{opacity:1;background:var(--chip)}.cyd-app .graphbox{overflow:visible}.cyd-app .ev .min, .cyd-app .ev a{background:none;border:0;padding:0;color:#1b2331;text-decoration:underline}.cyd-app .card, .cyd-app .feat, .cyd-app .graphbox, .cyd-app .decision{box-shadow:none !important;break-inside:avoid;page-break-inside:avoid}\n}\n.cyd-app .gtools{float:right;display:inline-flex;gap:4px}.cyd-app .gtools button{border:1px solid var(--line);background:var(--panel);color:var(--ink);border-radius:8px;padding:1px 9px;cursor:pointer;font-size:12.5px}.cyd-app .gtools button:hover{border-color:var(--accent);color:var(--accent)}.cyd-app .node .subbadge{cursor:pointer}.cyd-app .node .subbadge circle{fill:var(--panel);stroke:var(--ink2);stroke-width:1}.cyd-app .node .subbadge text{fill:var(--ink2);font-size:10px;pointer-events:none}.cyd-app .node .subbadge:hover circle{stroke:var(--accent)}.cyd-app .node .subbadge:hover text{fill:var(--accent)}.cyd-app .node.child rect{opacity:.92}.cyd-app .edge.child{stroke-dasharray:4 3;opacity:.7}.cyd-app .subsum{display:inline-block;margin-top:8px;font-size:12.5px;color:var(--ink2);background:var(--chip);border:1px solid var(--line);border-radius:8px;padding:2px 9px}.cyd-app .subrow{border-left:3px solid var(--line);padding:6px 0 6px 12px;margin:8px 0}.cyd-app .subrow .badge{margin-right:6px}.cyd-app table.gloss{width:100%;border-collapse:collapse;font-size:13.5px}.cyd-app table.gloss th,.cyd-app table.gloss td{border-bottom:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top}\n.cyd-app.fullgraph .graphbox svg{height:calc(100vh - 360px);min-height:440px}\n/* 整页模式（会话页顶部「功能地图」tab）：只留关系图并铺满可用高度。\n   宿主自己的标签栏与输入框保持原样——这里只裁剪本插件自己的版面，不碰宿主 DOM。 */\n.cyd-app.cyd-immersive{display:flex;flex-direction:column;height:100%;min-height:0;overflow:hidden}\n.cyd-app.cyd-immersive .wrap{display:flex;flex-direction:column;width:100%;max-width:none;height:100%;min-height:0;margin:0;padding:10px 12px 12px}\n.cyd-app.cyd-immersive header.top,.cyd-app.cyd-immersive .strip,.cyd-app.cyd-immersive nav.tabs,\n.cyd-app.cyd-immersive #project,.cyd-app.cyd-immersive #now,.cyd-app.cyd-immersive #guide,\n.cyd-app.cyd-immersive #foot,.cyd-app.cyd-immersive .filters,.cyd-app.cyd-immersive .progress,\n.cyd-app.cyd-immersive .plabel,.cyd-app.cyd-immersive .grid{display:none !important}\n.cyd-app.cyd-immersive section#features{display:flex;flex-direction:column;flex:1;min-height:0;margin:0}\n.cyd-app.cyd-immersive .graphbox{display:flex;flex-direction:column;flex:1;min-height:0;margin:0}\n/* height 由 JS 算死（见 renderGraph.layoutHeight）；flex:0 0 auto 保证 JS 值不被 flex 覆盖。\n   提示文字必须单行省略——窄栏（右侧栏展开 / 小窗口）时它会换行成几百像素，把图挤没。 */\n.cyd-app.cyd-immersive .graphbox svg{flex:0 0 auto;min-height:0}\n.cyd-app.cyd-immersive .ghead{flex:none;min-width:0;gap:10px}\n.cyd-app.cyd-immersive .ghead b{flex:none}\n.cyd-app.cyd-immersive .ghead span:not(.gtools){flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\n.cyd-app.cyd-immersive .ghead .gtools{flex:none}\n.cyd-app.cyd-immersive .legend{flex:none}\n/* 节点面板里的「直接和 agent 说一句」区块：输入框 + 醒目的主发送按钮 + 小胶囊快捷追问 */\n.cyd-app .askbox{border:1px solid var(--accent);border-radius:12px;background:var(--accent-soft);padding:14px 16px;margin:0 0 16px}\n.cyd-app .askbox .kv{margin-top:0}\n.cyd-app .askrow{display:flex;gap:10px;align-items:stretch;margin:8px 0 10px}\n.cyd-app .askrow textarea.note{flex:1;width:auto;margin:0;min-height:74px;background:var(--panel)}\n.cyd-app .asksend{flex:none;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;min-width:120px;padding:10px 18px;border:1px solid var(--accent);border-radius:12px;background:var(--accent);color:var(--on-solid);font-family:inherit;font-size:14px;font-weight:700;line-height:1.2;cursor:pointer;box-shadow:0 2px 10px rgba(20,92,235,.3)}\n.cyd-app .asksend:hover{filter:brightness(1.09)}\n.cyd-app .asksend:active{transform:translateY(1px)}\n.cyd-app .asksend:disabled{opacity:.55;cursor:default;box-shadow:none}\n.cyd-app .asksend .ico{font-size:20px;line-height:1}\n.cyd-app .asksend .txt{white-space:nowrap}\n.cyd-app .askquick{display:flex;flex-wrap:wrap;gap:7px;align-items:center;margin-top:2px}\n.cyd-app .askquick .lab{font-size:12.5px;color:var(--ink2)}\n.cyd-app .askchip{border:1px dashed var(--line);background:var(--panel);color:var(--ink2);border-radius:999px;padding:3px 11px;font-family:inherit;font-size:12.5px;cursor:pointer}\n.cyd-app .askchip:hover{border-style:solid;border-color:var(--accent);color:var(--accent)}\n/* 弹层内的返回条（版本差异 → 返回版本列表） */\n.cyd-app .sheetnav{display:flex;align-items:center;gap:10px;margin:2px 0 12px;padding-bottom:10px;border-bottom:1px dashed var(--line)}\n.cyd-app .sheetnav .actbtn{padding:5px 12px;font-size:13px}\n.cyd-app #verBtn{border:1px solid var(--line);background:var(--panel);color:var(--ink);border-radius:999px;padding:6px 13px;cursor:pointer;font-size:14px;box-shadow:var(--shadow);margin-right:8px}.cyd-app .verrow{display:flex;align-items:center;justify-content:space-between;gap:10px;border-bottom:1px solid var(--line);padding:9px 0}.cyd-app .verrow:last-child{border-bottom:0}.cyd-app .diffbox{font:12.5px/1.6 Consolas,\"Courier New\",monospace;border:1px solid var(--line);border-radius:10px;overflow:auto;max-height:46vh}.cyd-app .dline{white-space:pre-wrap;word-break:break-all;padding:1px 10px}.cyd-app .dline.add{background:var(--ok-soft);color:var(--ok)}.cyd-app .dline.del{background:var(--warn-soft);color:var(--warn);text-decoration:line-through}\n.cyd-app #setBtn{border:1px solid var(--line);background:var(--panel);color:var(--ink);border-radius:999px;padding:6px 13px;cursor:pointer;font-size:14px;box-shadow:var(--shadow);margin-right:8px}.cyd-app .setrow{border-bottom:1px solid var(--line);padding:12px 0;font-size:14px}.cyd-app .setrow:last-of-type{border-bottom:0}.cyd-app .setrow label{display:block;line-height:1.8}.cyd-app .setrow input[type=\"text\"],.cyd-app .setrow input[type=\"number\"]{border:1px solid var(--line);border-radius:8px;padding:5px 9px;background:var(--panel);color:var(--ink);font:inherit;margin-top:4px}\n\n/* 关系图全屏（弹窗式铺满窗口）：给 .graphbox 加 .fs。\n   z-index 55 —— 低于 .ovl(60)，所以在全屏里点节点弹出的面板照常盖在上面；\n   SVG 高度仍由 renderGraph.layoutHeight() 算死写进行内样式（与整页模式同款），\n   所以这里只负责把容器钉满窗口 + 保持头/图例/图三段的纵向排列。 */\n.cyd-app .graphbox.fs{position:fixed;inset:0;z-index:55;margin:0;border:0;border-radius:0;box-shadow:none;display:flex;flex-direction:column;background:var(--panel)}\n.cyd-app .graphbox.fs .ghead{flex:none}\n.cyd-app .graphbox.fs .legend{flex:none}\n.cyd-app .graphbox.fs svg{flex:0 0 auto;min-height:0}";
const SHELL = "<div class=\"wrap\">\n  <header class=\"top\">\n    <h1 id=\"projName\">开发仪表盘 <span class=\"by\">由 control-your-development 生成</span></h1>\n    <button id=\"setBtn\" title=\"设置\" style=\"display:none\">⚙</button>\n    <button id=\"verBtn\" title=\"版本快照\" style=\"display:none\">🕓</button>\n    <button id=\"themeBtn\" title=\"切换深浅色\">🌓</button>\n  </header>\n  <div class=\"strip\" id=\"strip\"></div>\n  <nav class=\"tabs\">\n    <button data-tab=\"project\" class=\"on\">🏠 项目</button>\n    <button data-tab=\"features\">🗺 功能地图</button>\n    <button data-tab=\"now\">⚡ 现在</button>\n    <button data-tab=\"guide\">❓ 使用指南</button>\n  </nav>\n\n  <section id=\"project\" class=\"on\"></section>\n  <section id=\"features\"></section>\n  <section id=\"now\"></section>\n\n  <section id=\"guide\">\n    <div class=\"card\">\n      <h3>功能简介</h3>\n      <p class=\"lede\">control-your-development 把开发过程中繁杂的技术细节，持续整理成清晰的产品视图。你随时可以知道：<b>产品能做什么、怎么用、进展到哪一步</b>；每到需要人做决定的地方，选择权都会交到你手上。</p>\n    </div>\n    <div class=\"card\">\n      <h3>上手方式</h3>\n      <ol class=\"steps\">\n        <li data-n=\"1\"><b>建立仪表盘</b><br><span class=\"muted\">在聊天框输入 <code>/control-your-development</code>，或直接说一句 \"control my development\"</span></li>\n        <li data-n=\"2\"><b>照常开发</b><br><span class=\"muted\">每完成一个阶段，仪表盘会自动更新（前提是建立时启动的看护任务还在运行）；改完文件点顶部「🔄 更新」立即刷新</span></li>\n        <li data-n=\"3\"><b>随时掌握全局</b><br><span class=\"muted\">在 DSH 右侧栏打开「开发仪表盘」，或点会话页顶部的「功能地图」看整页大图（可缩放平移）；顶部「数据健康 / 等你拍板 / 功能验证」等徽章都能点开看详情。想要离线分享时对我说「导出网页版」</span></li>\n        <li data-n=\"4\"><b>处理「等你拍板」</b><br><span class=\"muted\">点顶部「等你拍板」徽章打开拍板中心 → 点选选项（可写补充）→「发送拍板」直接告诉我；会话不在线时会先记下，下次更新生效</span></li>\n        <li data-n=\"5\"><b>亲手验证</b><br><span class=\"muted\">试用某功能后，点开它的功能卡按「✅ 我已验证」（或在聊天框说\"我验证过了\"）→ 🤖 变 ✅，进度条前进</span></li>\n      </ol>\n    </div>\n  </section>\n\n  <footer id=\"foot\"></footer>\n</div>\n<div class=\"toast\" id=\"toast\"></div>\n<div class=\"ovl\" id=\"ovl\"><div class=\"sheet\" id=\"sheet\"></div></div>";
const norm = t => t.replace(/\r\n?/g, '\n');  // CRLF 与 CR-only 行尾都归一
function pad(n){ return String(n).padStart(2, '0'); }
function fmtDate(d){ return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function fmtDT(d){ return fmtDate(d) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }
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
function parseProduct(text){
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
  return proj;
}
const STATUSES = ['设想', '进行中', '可用', '已验证', '已废弃'];
/* 确定性文本宽度（与 Python 渲染器逐字同构）：>U+2E00 按宽字符 14px，其余 8px。
   不用 canvas measureText——布局坐标要写进数据，两端必须算出一模一样的值。 */
function textWidth(s){ let w = 0; for (const c of String(s)) w += (c.codePointAt(0) > 0x2E00 ? 14 : 8); return w; }
const NODE_PAD = 46, NODE_MIN_W = 150, NODE_MAX_W = 280, NODE_TEXT_MAX = NODE_MAX_W - NODE_PAD;
/* 名称折行：最多 2 行，第二行放不下就 … 省略（悬浮 <title> 见全文）。码点数组操作，emoji 安全。 */
function wrapName(name){
  const chars = [...String(name)];
  const cw = c => (c.codePointAt(0) > 0x2E00 ? 14 : 8);
  if (textWidth(name) <= NODE_TEXT_MAX) return [chars.join('')];
  let i = 0, w = 0;
  while (i < chars.length && w + cw(chars[i]) <= NODE_TEXT_MAX){ w += cw(chars[i]); i++; }
  const l1 = chars.slice(0, i).join(''), rest = chars.slice(i);
  if (textWidth(rest.join('')) <= NODE_TEXT_MAX) return [l1, rest.join('')];
  let j = 0, w2 = 0;
  const limit = NODE_TEXT_MAX - 14;
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
/* 术语表（GLOSSARY.md，可选）：第一张表 → [{term, meaning, aliases}]。与 Python 同契约。 */
function parseGlossary(text, warnings){
  warnings = warnings || [];
  text = stripComments(text);
  const entries = [];
  const lines = text.split('\n');
  const cellsOf = l => l.trim().replace(/^\|+/, '').replace(/\|+$/, '').split('|').map(c => c.trim());
  for (let i = 0; i < lines.length; i++){
    if (!lines[i].trim().startsWith('|')) continue;
    const header = cellsOf(lines[i]);
    if (header.length < 3 || header[0] !== '标准用词'){
      warnings.push('GLOSSARY.md 第一张表的表头不是「标准用词 | 指什么 | 别名/曾用名」，按无术语表处理');
      return entries;
    }
    let j = i + 1;
    if (j < lines.length && /^\s*\|[|\-:\s]+\|\s*$/.test(lines[j])) j++;
    while (j < lines.length && lines[j].trim().startsWith('|')){
      const cells = cellsOf(lines[j]);
      if (cells.length < 2 || !cells[0]){
        warnings.push('GLOSSARY.md 有一行列数不足或标准用词为空，已忽略该行');
      } else {
        const aliases = (cells[2] || '').split(/[、，,/]/).map(a => a.trim()).filter(Boolean);
        entries.push({ term: cells[0], meaning: cells[1] || '', aliases });
      }
      j++;
    }
    return entries;
  }
  warnings.push('GLOSSARY.md 里没有表格，按无术语表处理');
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
    if (section === 'dec' && h3){ cur = { id: h3[1], title: h3[2].trim(), decided: '', options: [], multi: false }; decisions.push(cur); continue; }
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
/* parts: { prod, feat, now, factsRaw?, ignoreRaw?, workspace_uri?, updated_at? }；existsFn: async path => bool */
async function assembleData(parts, existsFn){
  const warnings = [];
  const project = parseProduct(norm(parts.prod));
  const features = layoutGraph(parseFeatures(norm(parts.feat), warnings), warnings);
  const nw = parseNow(norm(parts.now), warnings);
  /* 术语表（可选）与用词漂移（v1.3，与 Python 渲染器同口径） */
  let glossary = [], drift = [];
  if (parts.glossRaw != null){
    glossary = parseGlossary(norm(parts.glossRaw), warnings);
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
  const ignore = parts.ignoreRaw ? norm(parts.ignoreRaw).split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#')) : [];
  let facts = [], factsError = '', factsSource = '';
  if (!parts.factsRaw) factsError = 'missing';
  else { try { const parsed = JSON.parse(norm(parts.factsRaw)); facts = parsed.items || []; factsSource = parsed.source || ''; } catch (e){ factsError = 'corrupt'; } }
  const evSet = new Set(pairs.map(p => p.path.replace(/^\//, '')));
  let pending = 0;
  const fd = facts.map(it => {
    const p = normPath(it.path || '');
    const hit = evSet.has(p) || ignore.some(pat => globMatch(p, pat));
    if (!hit) pending++;
    return { path: p, kind: it.kind || '', change: it.change || '', pending: !hit };
  });
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
  return { project, features, timeline: nw.timeline, decisions: nw.decisions, todos: nw.todos, counts,
    glossary,
    workspace_uri: parts.workspace_uri, updated_at: parts.updated_at || fmtDT(new Date()),
    health: { ok, matrix, evidence_missing: missing, evidence_invalid: invalid,
              facts_pending: pending, facts_error: factsError, source: factsSource, verify_missing: noVerify,
              glossary_drift: drift,
              facts: fd, ignore, warnings } };
}

function initDashboard(rootEl, env){
  if (CSS && typeof document !== 'undefined' && !document.querySelector('style[data-cyd-core]')){
    const st = document.createElement('style');
    st.setAttribute('data-cyd-core', '1');
    st.textContent = CSS;
    document.head.appendChild(st);
  }
  let DATA = env.data;
let lastJson = JSON.stringify(env.data);
let docKeyHandler = null;   // 全局只保留一个 Esc 处理器：init 幂等
  const qs = s => rootEl.querySelector(s);
  const qsa = s => Array.from(rootEl.querySelectorAll(s));
  rootEl.classList.add('cyd-app');
  if (env.fullGraph) rootEl.classList.add('fullgraph');
  /* 整页模式（会话页顶部「功能地图」tab）：只渲染关系图并铺满可用高度。
     宿主自己的标签栏与输入框保持原样——本插件只裁剪自己的版面，不碰宿主 DOM。 */
  const IMMERSIVE = !!(env.fullGraph && env.onlyTab);
  if (IMMERSIVE) rootEl.classList.add('cyd-immersive');
  if (SHELL) rootEl.innerHTML = SHELL;

const esc = s => String(s==null?'':s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const SMAP = {"设想":1,"进行中":2,"可用":3,"已验证":4,"已废弃":5};
const SCOLOR = {"设想":"var(--gray)","进行中":"var(--accent)","可用":"var(--warn)","已验证":"var(--ok)","已废弃":"var(--ink2)"};
const SSOFT = {"设想":"var(--gray-soft)","进行中":"var(--accent-soft)","可用":"var(--warn-soft)","已验证":"var(--ok-soft)","已废弃":"var(--gray-soft)"};
const TL_SHOW = env.timelineShow || 30;
let currentTab = 'project', currentFilter = 'all';
const expanded = new Set();   // 关系图里展开子项的功能名（本挂载周期内保持，重渲染不丢）
/* 关系图视图状态：跨重渲染保留。pos = 手动摆过的节点位置（按功能名记），
   tx/ty/k = 缩放平移，adjusted = 用户是否亲手调过视野（调过就不再自动 fit）。
   drag = 正在拖节点（期间到来的自动刷新先押后，避免把图重排）。 */
const gview = { tx: 0, ty: 0, k: 1, adjusted: false, pos: new Map(), drag: false, deferred: false };
let graphRO = null;   // 关系图尺寸观察器（重渲染时换新，避免叠加）
let graphWinHandler = null;   // 窗口缩放兜底（重渲染时换新）
let graphEscHandler = null;   // 全屏时的 Esc 退出（重渲染时换新）
let graphFsHandler = null;    // fullscreenchange 同步（重渲染时换新）
let graphFs = false;   // 关系图是否处于全屏弹窗（重渲染会重建 DOM，状态记在这儿）
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


/* ---------- 证据：链接与否由宿主决定 ---------- */
function evHtml(list){
  return (list || []).map(e => {
    const disp = esc(truncMid(e.path));
    const full = esc(e.path);
    const canOpen = e.exists && env.evidenceAction;
    const url = !canOpen && e.exists && env.evidenceUrl ? env.evidenceUrl(e.path) : null;
    if (canOpen) return '<span class="evrow"><button class="min" data-ev="' + full + '" title="' + full + '（点击打开）" style="font-size:12.5px;padding:3px 10px">📄 ' + disp + '</button><button class="min" data-cp="' + full + '" title="复制完整路径">⧉</button></span>';
    if (url) return '<span class="evrow"><a href="' + url + '" target="_blank" rel="noopener" title="' + full + '（在浏览器中打开）">📄 ' + disp + '</a><button class="min" data-cp="' + full + '" title="复制完整路径">⧉</button></span>';
    if (!e.exists) return '<span class="evrow"><a class="miss" title="' + full + '（路径不存在）">📄 ' + disp + '</a></span>';
    return '<span class="evrow"><button class="min" data-cp="' + full + '" title="' + full + '（点击复制完整路径）" style="font-size:12.5px;padding:3px 10px">📄 ' + disp + '</button></span>';
  }).join('');
}

/* ---------- 掌控条（五徽章，全部可点） ---------- */
function renderStrip(){
  const d = DATA, active = d.counts.total_active || 0, verified = d.counts['已验证'] || 0;
  const pending = d.decisions.filter(x => !x.decided).length;
  const h =
    '<button class="pill" data-act="stage" title="查看当前方向"><div class="k">当前阶段</div><div class="v">' + esc(d.project.stage || '—') + '</div></button>'
    + '<div class="pill static"><div class="k">数据更新于</div><div class="v">' + esc(d.updated_at) + ' <button class="min" id="updBtn" title="重新读取文件并刷新页面">🔄 更新</button></div></div>'
    + '<button class="pill" data-act="verify" title="去功能地图验收"><div class="k">功能验证</div><div class="v">✅ ' + verified + ' / ' + active + '</div></button>'
    + '<button class="pill ' + (pending ? 'alert' : 'good') + '" data-act="decide" title="打开拍板中心"><div class="k">等你拍板</div><div class="v">' + (pending ? '⚠ ' + pending + ' 件' : '✅ 无') + '</div></button>'
    + '<button class="pill ' + (d.health.ok ? 'good' : 'alert') + '" data-act="health" title="查看完整审计"><div class="k">数据健康</div><div class="v">' + (d.health.ok ? '✅ 完整' : '⚠ 待整理') + '</div></button>';
  qs('#strip').innerHTML = h;
  qs('#projName').firstChild.textContent = d.project.name + ' ';
  if (env.browserTab) document.title = d.project.name + ' · 开发仪表盘';
  qsa('#strip [data-act]').forEach(b => b.onclick = () => stripAct(b.dataset.act));
  qs('#updBtn').onclick = e => { e.stopPropagation(); doRefresh(); };
}
function stripAct(a){
  if (a === 'stage'){ gotoTab('project'); flashEl('cardIntro'); }
  else if (a === 'verify'){ gotoTab('features'); }
  else if (a === 'decide'){ openDecisionCenter(); }
  else if (a === 'health'){ openAudit(); }
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
  if (p.direction) tags.push('当前方向：' + p.direction);
  if (p.next) tags.push('下一步：' + p.next);
  if (tags.length) h += '<div>' + tags.map(t => '<span class="tag">' + linkify(esc(t)) + '</span>').join('') + '</div>';
  h += '</div>';
  if (p.journey && p.journey.length){
    h += '<div class="card"><h3>它怎么用（真实使用流程）</h3><ol class="steps">';
    p.journey.forEach((j, i) => {
      h += '<li data-n="' + (i + 1) + '"><b>' + esc(j.title) + '</b><br><span class="muted">' + linkify(esc(j.desc)) + '</span>';
      if (j.evidence && j.evidence.length) h += '<div class="ev">' + evHtml(j.evidence) + '</div>';
      h += '</li>';
    });
    h += '</ol></div>';
  }
  /* 术语表（v1.3 可选）：用词的唯一对照标准 */
  if (DATA.glossary && DATA.glossary.length){
    h += '<div class="card"><h3>术语表</h3><table class="gloss"><tr><th>标准用词</th><th>指什么</th><th>别名/曾用名</th></tr>'
      + DATA.glossary.map(g => '<tr><td><b>' + esc(g.term) + '</b></td><td>' + esc(g.meaning) + '</td><td class="muted">' + esc((g.aliases || []).join('、')) + '</td></tr>').join('')
      + '</table></div>';
  }
  qs('#project').innerHTML = h;
}

/* ---------- 功能地图 Tab ---------- */
function graphBoxHtml(){
  if (!ACT().length) return '';
  return '<div class="graphbox"><div class="ghead"><b>功能关系图</b><span>滚轮缩放 · 拖背景平移 · 拖节点调整位置 · 点节点直接和 agent 交互 · 点 ▸n 徽标展开子项</span>'
    + '<span class="gtools" id="gTools"><button data-gz="out" title="缩小">－</button><button data-gz="in" title="放大">＋</button><button data-gz="fit" title="适应屏幕">⤢ 适应</button><button data-gz="fs" title="全屏看图（铺满窗口，Esc 退出）">⛶ 全屏</button><button data-gz="reset" title="把手动摆过的节点复位回分层布局">↺ 重置</button></span></div>'
    + '<div class="legend"><span><i style="background:var(--gray)"></i>设想</span><span><i style="background:var(--accent)"></i>进行中</span><span><i style="background:var(--warn)"></i>可用</span><span><i style="background:var(--ok)"></i>已验证</span></div>'
    + '<svg id="graph"></svg><div class="nodepop" id="nodePop"></div></div>';
}
function renderFeatures(){
  /* 整页模式（会话页「功能地图」tab）：只渲染关系图并铺满可用高度；
     标题栏/徽章/筛选/进度/功能卡网格/页脚都不渲染，宿主自己的标签栏与输入框不动。 */
  if (IMMERSIVE){
    qs('#features').innerHTML = graphBoxHtml() || '<div class="empty" style="padding:26px 18px">还没有可显示的功能</div>';
    renderGraph();
    return;
  }
  let h = graphBoxHtml();
  h += '<div class="filters" id="featFilters"></div>';
  const v = DATA.counts['已验证'] || 0, t = DATA.counts.total_active || 0, pct = t ? Math.round(v / t * 100) : 0;
  h += '<div class="progress"><i style="width:' + pct + '%"></i></div><div class="plabel">进度只统计你亲手验证过的功能（' + v + '/' + t + '）——点开功能卡可查看详情、一键验证</div>';
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
    + '<p class="muted" style="margin:4px 0 0">' + esc(f.desc) + '</p>';
  const kids = f.children || [];
  if (kids.length){
    const done = kids.filter(c => c.status === '已验证').length;
    h += '<div class="subsum" title="点开查看子项明细">🧩 子项 ✅' + done + '/' + kids.length + '</div>';
  }
  if (f.evidence && f.evidence.length) h += '<div class="ev">' + evHtml(f.evidence) + '</div>';
  if (f.verify) h += '<div class="verifier">' + esc(f.verify) + '</div>';
  else if (f.status === '可用') h += '<div class="verifier">🤖 标记可用，等你试用</div>';
  else if (f.status === '进行中') h += '<div class="verifier">🤖 开发中</div>';
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
  const svg = qs('#graph'); if (!svg) return;
  const pop = qs('#nodePop');
  const box = qs('.graphbox');
  if (box && graphFs) box.classList.add('fs');   // 重渲染会重建 DOM：全屏状态记在 graphFs 上，这里补回来
  const NS = 'http://www.w3.org/2000/svg';
  svg.innerHTML = '';
  const gWorld = document.createElementNS(NS, 'g'); svg.appendChild(gWorld);
  const feats = ACT();
  const byName = {}; feats.forEach(f => byName[f.name] = f);
  /* 手动摆过的位置优先（跨重渲染保留），其余用分层布局算出来的位置 */
  feats.forEach(f => { const m = gview.pos.get(f.name); if (m){ f.x = m.x; f.y = m.y; } });
  const edges = [];
  /* 内容外框：按实际布局（含手动位置）算，视野范围不再是写死的 960×340 */
  function contentBox(){
    let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    feats.forEach(f => {
      minX = Math.min(minX, f.x - f.w / 2); maxX = Math.max(maxX, f.x + f.w / 2);
      minY = Math.min(minY, f.y - f.h / 2); maxY = Math.max(maxY, f.y + f.h / 2);
    });
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
  function layoutHeight(){
    const fs = !!(box && box.classList.contains('fs'));
    if ((!IMMERSIVE && !fs) || !box) return;
    const gh = box.querySelector('.ghead'), lg = box.querySelector('.legend');
    const used = (gh ? gh.offsetHeight : 0) + (lg ? lg.offsetHeight : 0);
    let avail = box.clientHeight - used;                 // 容器高度确定时直接用
    if (!(avail > 120)){                                 // 父链高度还没确定（内容驱动 / 首帧）→ 按视口兜底
      avail = window.innerHeight - box.getBoundingClientRect().top - used - 24;
    }
    const h = Math.max(240, Math.round(avail));
    if (h > 0) svg.style.height = h + 'px';
  }
  function edgeD(a, b){
    const x1 = a.x + a.w / 2, y1 = a.y, x2 = b.x - b.w / 2, y2 = b.y, mx = (x1 + x2) / 2;
    return 'M' + x1 + ',' + y1 + ' C' + mx + ',' + y1 + ' ' + mx + ',' + y2 + ' ' + x2 + ',' + y2;
  }
  feats.forEach(f => (f.deps || []).forEach(dn => {
    const a = byName[dn]; if (!a) return;
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', edgeD(a, f)); p.setAttribute('class', 'edge'); gWorld.appendChild(p);
    edges.push({ path: p, from: a, to: f });
  }));
  function redraw(f){ edges.forEach(e => { if (e.from === f || e.to === f) e.path.setAttribute('d', edgeD(e.from, e.to)); }); }
  let dragNode = null;
  function applyT(){ gWorld.setAttribute('transform', 'translate(' + gview.tx + ',' + gview.ty + ') scale(' + gview.k + ')'); }
  function fit(){
    layoutHeight();
    const rect = syncBox();
    if (!rect) return;
    const b = contentBox();
    const bw = b.w + 80, bh = b.h + 160;   // 底部多留给子项展开
    gview.k = Math.min(1.6, Math.max(.25, 0.94 * Math.min(rect.width / bw, rect.height / bh)));
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
    pop.innerHTML = '<h4>' + esc(f.name) + ' <span class="badge b-x' + SMAP[f.status] + '">' + esc(f.status) + '</span></h4><p>' + esc(f.desc) + '</p><span class="go">点一下打开节点面板 →</span>';
    pop.style.left = left + 'px'; pop.style.top = top + 'px';
    clearTimeout(popTimer);
    pop.classList.add('on');
    pop.onclick = ev => { ev.stopPropagation(); pop.classList.remove('on'); openNodePanel(f.name); };
  }
  pop.addEventListener('mouseenter', () => { popHover = true; clearTimeout(popTimer); });
  pop.addEventListener('mouseleave', () => { popHover = false; hidePopSoon(); });
  /* 子项（思维导图式树展开）：默认折叠，点节点上的徽标展开/收起 */
  const childGs = [];   // 当前展开的子项节点与连线（重画时整体清掉重摆）
  function drawChildren(f, nodeG){
    childGs.forEach(c => { if (c.parent === f){ c.g.remove(); c.line.remove(); } });
    const rest = childGs.filter(c => c.parent !== f);
    childGs.length = 0; childGs.push(...rest);
    if (!expanded.has(f.name)) return;
    const kids = (f.children || []).filter(c => c.status !== '已废弃');
    kids.forEach((c, i) => {
      const cy = f.y + f.h / 2 + 26 + (c.ch || 42) / 2 + i * (42 + 16);
      const cx = f.x;
      const line = document.createElementNS(NS, 'path');
      line.setAttribute('d', 'M' + f.x + ',' + (f.y + f.h / 2) + ' L' + cx + ',' + (cy - 21));
      line.setAttribute('class', 'edge child'); gWorld.appendChild(line);
      const g = document.createElementNS(NS, 'g'); g.setAttribute('class', 'node child');
      const r = document.createElementNS(NS, 'rect');
      r.setAttribute('x', -70); r.setAttribute('y', -18); r.setAttribute('width', 140); r.setAttribute('height', 36); r.setAttribute('rx', 10);
      r.style.fill = SSOFT[c.status]; r.style.stroke = SCOLOR[c.status];
      const t = document.createElementNS(NS, 'text');
      t.setAttribute('x', 0); t.setAttribute('y', 4); t.setAttribute('text-anchor', 'middle');
      t.style.fill = SCOLOR[c.status];
      const cname = c.name.length > 10 ? c.name.slice(0, 9) + '…' : c.name;
      t.textContent = cname;
      const ttl = document.createElementNS(NS, 'title'); ttl.textContent = c.name + '（' + c.status + '）';
      g.appendChild(r); g.appendChild(t); g.appendChild(ttl);
      g.setAttribute('transform', 'translate(' + cx + ',' + cy + ')');
      gWorld.appendChild(g);
      childGs.push({ parent: f, g, line });
    });
  }
  feats.forEach(f => {
    const g = document.createElementNS(NS, 'g'); g.setAttribute('class', 'node');
    g.setAttribute('tabindex', '0'); g.setAttribute('role', 'button');
    g.setAttribute('data-fname', f.name);   // 键盘激活（回车/空格）靠它找到功能名
    const r = document.createElementNS(NS, 'rect');
    r.setAttribute('x', -f.w / 2); r.setAttribute('y', -f.h / 2); r.setAttribute('width', f.w); r.setAttribute('height', f.h); r.setAttribute('rx', 12);
    r.style.fill = SSOFT[f.status]; r.style.stroke = SCOLOR[f.status];
    const ttl = document.createElementNS(NS, 'title'); ttl.textContent = f.name + '（' + f.status + '）' + (f.desc ? '——' + f.desc : '');
    g.appendChild(r);
    g.appendChild(ttl);
    const lines = f.lines || [f.name];
    lines.forEach((ln, i) => {
      const t = document.createElementNS(NS, 'text');
      t.setAttribute('x', 0); t.setAttribute('text-anchor', 'middle');
      t.setAttribute('y', lines.length > 1 ? (i === 0 ? -2 : 16) : 4);
      t.style.fill = SCOLOR[f.status]; t.textContent = ln;
      g.appendChild(t);
    });
    const dot = document.createElementNS(NS, 'circle');
    dot.setAttribute('cx', -f.w / 2 + 14); dot.setAttribute('cy', lines.length > 1 ? -f.h / 2 + 16 : 0); dot.setAttribute('r', 4); dot.style.fill = SCOLOR[f.status];
    g.appendChild(dot); gWorld.appendChild(g);
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
        drawChildren(f, g);
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
      gview.drag = true;
      try{ svg.setPointerCapture(e.pointerId); }catch(err){}
    });
    g.addEventListener('mouseenter', () => { if (!dragNode) showPop(f); });
    g.addEventListener('mouseleave', () => { if (!dragNode) hidePopSoon(); });
    drawChildren(f, g);
  });
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
    try{ svg.setPointerCapture(e.pointerId); }catch(err){}
  });
  svg.addEventListener('pointermove', e => {
    if (dragNode){
      const m = dragNode;
      if (!m.moved && Math.hypot(e.clientX - m.sx, e.clientY - m.sy) < 4) return;
      m.moved = true;
      const p = toWorld(e);
      const nx = p.x - m.dx, ny = p.y - m.dy;
      m.f.x = nx; m.f.y = ny;
      m.g.setAttribute('transform', 'translate(' + nx + ',' + ny + ')');
      gview.pos.set(m.f.name, { x: nx, y: ny });   // 手动位置记下来，刷新后不丢
      redraw(m.f); drawChildren(m.f, m.g);
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
    dragNode = null; panning = null;
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
    bind('[data-gz="reset"]', () => { gview.pos.clear(); gview.adjusted = false; renderGraph(); });
    /* 全屏：优先走**真·窗口全屏**（requestFullscreen），拿不到或被拒就退回「铺满视口的弹层」（.fs）。
       为什么必须真全屏：桌面端那条原生标题栏（菜单栏 + 窗口按钮）页面 CSS 盖不住 —— DSH 自己也只在
       `html[data-fullscreen]` 时把那条 band 收掉（全屏状态由桌面端 preload 镜像上去）。
       fullscreen 落在 `.cyd-app` 上（不是图容器）：这样弹层 #ovl 仍在同一棵子树里，全屏中点节点
       弹出的面板照常可见；再给它补 cyd-immersive，复用「整页模式只留关系图」那套布局。
       进入先把视野置成「适应」，退出时：你亲手调过视野就还原回去，没调过就重新适应。
       relayout 在下面才定义 —— 这里只是注册闭包，点按钮时它早就初始化好了。 */
    const fsOn = () => !!(box && box.classList.contains('fs'));
    const syncFsBtn = () => {
      const b = tools.querySelector('[data-gz="fs"]'); if (!b) return;
      b.innerHTML = fsOn() ? '⤡ 退出全屏' : '⛶ 全屏';
      b.title = fsOn() ? '退出全屏（Esc）' : '全屏看图（Esc 退出）';
    };
    let fsSaved = null, fsAddedImmersive = false;
    const syncRoot = on => {
      if (on){ if (!rootEl.classList.contains('cyd-immersive')){ rootEl.classList.add('cyd-immersive'); fsAddedImmersive = true; } }
      else if (fsAddedImmersive){ rootEl.classList.remove('cyd-immersive'); fsAddedImmersive = false; }
    };
    const enterFs = () => {
      graphFs = true; box.classList.add('fs'); syncRoot(true); syncFsBtn();
      gview.adjusted = false; relayout();
    };
    const leaveFs = () => {
      graphFs = false; box.classList.remove('fs'); syncRoot(false); syncFsBtn();
      if (fsSaved && fsSaved.adjusted){
        gview.tx = fsSaved.tx; gview.ty = fsSaved.ty; gview.k = fsSaved.k; gview.adjusted = true;
      } else gview.adjusted = false;
      fsSaved = null; relayout();
    };
    const toggleFs = force => {
      if (!box) return;
      const on = (force === undefined) ? !fsOn() : !!force;
      if (on === fsOn()) return;
      if (on){
        fsSaved = { tx: gview.tx, ty: gview.ty, k: gview.k, adjusted: gview.adjusted };
        const req = rootEl.requestFullscreen || rootEl.webkitRequestFullscreen;
        if (typeof req === 'function') Promise.resolve(req.call(rootEl)).catch(enterFs);
        else enterFs();
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
  layoutHeight();
  if (gview.adjusted){ syncBox(); applyT(); } else fit();
}

/* ---------- 现在 Tab（时间线 + 拍板撰写器 + 待办） ---------- */
function decidedKeys(dc){ return dc.decided ? dc.decided.split(/[、,]/) : []; }
function decisionHtml(dc){
  const keys = decidedKeys(dc);
  let h = '<div class="decision' + (dc.decided ? ' decided' : '') + '" id="dec-' + esc(dc.id) + '"><div class="did">决策 ' + esc(dc.id) + (dc.decided ? ' · 已定 ' + esc(dc.decided) : ' · 等你拍板' + (dc.multi ? '（可多选）' : '')) + '</div><h4>' + (dc.decided ? '✅ ' : '⚠ ') + esc(dc.title) + '</h4>';
  dc.options.forEach(o => {
    if (dc.decided){
      h += '<button class="optbtn" disabled><b>' + esc(o.key) + '</b><span>' + esc(o.text) + (keys.includes(o.key) ? ' <span class="chosen">✓ 已定</span>' : '') + '</span></button>';
    } else {
      h += '<button class="optbtn selable" data-did="' + esc(dc.id) + '" data-key="' + esc(o.key) + '"><b>' + esc(o.key) + '</b><span>' + esc(o.text) + '</span><span class="tick">✓</span></button>';
    }
  });
  if (!dc.decided){
    h += '<textarea class="note" data-note="' + esc(dc.id) + '" placeholder="补充说明（可选，发送时会一并带上）"></textarea>';
    if (env.decide){
      h += '<button class="copybtn" data-senddec="' + esc(dc.id) + '">📤 发送拍板</button>';
      h += '<p class="dhint">先点选选项' + (dc.multi ? '（可多选）' : '') + '，需要的话写句补充 → 点「发送拍板」直接告诉我；会话不在线时会先记下，下次更新时生效</p>';
    } else {
      h += '<button class="copybtn" data-copydec="' + esc(dc.id) + '">📋 复制拍板</button>';
      h += '<p class="dhint">先点选选项' + (dc.multi ? '（可多选）' : '') + '，需要的话写句补充 → 点「复制拍板」→ 粘贴到聊天框发送，我就能带着完整上下文执行</p>';
    }
  }
  return h + '</div>';
}
// 选择与补充说明以 DOM 为准（不带外挂状态）：重渲染后屏幕上看到什么，复制出去就是什么
function bindComposers(root){
  root.querySelectorAll('.optbtn.selable').forEach(b => b.onclick = () => {
    const did = b.dataset.did;
    const dc = DATA.decisions.find(x => x.id === did);
    const group = root.querySelectorAll('.optbtn.selable[data-did="' + did + '"]');
    if (dc && dc.multi){ b.classList.toggle('sel'); return; }
    const was = b.classList.contains('sel');
    group.forEach(x => x.classList.remove('sel'));
    if (!was) b.classList.add('sel');
  });
  root.querySelectorAll('[data-copydec]').forEach(b => b.onclick = () => copyDecision(root, b.dataset.copydec));
  root.querySelectorAll('[data-senddec]').forEach(b => b.onclick = () => sendDecision(root, b.dataset.senddec, b));
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
  if (!d) return;
  if (d.empty) return toast('请先点选选项，或填写补充说明');
  if (btn) btn.disabled = true;
  try{
    const res = await env.decide({ id: d.dc.id, title: d.dc.title, keys: d.keys, note: d.note, text: d.msg });
    toast(sendResultText(res, '拍板'));
  }catch(e){
    console.warn(e);
    copyText(d.msg);
    toast('发送失败，已改为复制——粘贴到聊天框发送');
  }finally{ if (btn) btn.disabled = false; }
}
function copyDecision(root, did){
  const d = decisionDraft(root, did);
  if (!d) return;
  if (d.empty) return toast('请先点选选项，或填写补充说明');
  copyText(d.msg);
}
function renderNow(){
  const d = DATA;
  let left = '<div class="card"><h3>进展时间线（人话版）</h3>';
  if (d.timeline.length){
    left += '<ul class="tl" id="tl">';
    d.timeline.forEach((t, i) => {
      left += '<li class="' + (i < TL_SHOW ? '' : 'old') + '"><time>' + esc(t.dt) + '</time><br>' + linkify(esc(t.text));
      if (t.evidence && t.evidence.length) left += '<div class="ev">' + evHtml(t.evidence) + '</div>';
      left += '</li>';
    });
    left += '</ul>';
    if (d.timeline.length > TL_SHOW) left += '<button id="moreTl">查看更早的 ' + (d.timeline.length - TL_SHOW) + ' 条 ▾</button>';
  } else left += '<div class="empty">还没有进展记录</div>';
  left += '</div>';
  let right = '';
  d.decisions.forEach(dc => { right += decisionHtml(dc); });
  if (d.todos.length){
    right += '<div class="card"><h3>待办</h3>' + d.todos.map(t => '<div class="todo"><input type="checkbox" ' + (t.done ? 'checked ' : '') + 'disabled><span>' + linkify(esc(t.text)) + '</span></div>').join('') + '</div>';
  }
  qs('#now').innerHTML = '<div class="cols"><div>' + left + '</div><div>' + (right || '<div class="empty">暂无待拍板的决策和待办</div>') + '</div></div>';
  const more = qs('#moreTl');
  if (more) more.onclick = function(){
    const tl = qs('#tl'); tl.classList.toggle('showold');
    this.textContent = tl.classList.contains('showold') ? '收起 ▴' : ('查看更早的 ' + (d.timeline.length - TL_SHOW) + ' 条 ▾');
  };
  bindComposers(qs('#now'));
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
      + '<button class="min" data-vdiff="' + v.n + '">对比当前</button></div>').join('');
    openSheet('🕓 版本快照（' + list.length + ' 份）', '<p class="muted">快照只存 Markdown 事实源；网页版随时可由它重新导出。</p>' + h);
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
    h += '<h4 style="margin:14px 0 6px">' + name + '</h4>' + diffHtml(a, b);
  });
  openSheet('🕓 v' + n + ' → 当前 的差异',
    '<div class="sheetnav"><button class="actbtn" data-vback>← 返回版本列表</button>'
    + '<span class="muted">看完可以返回列表接着看别的版本</span></div>'
    + (h || '<div class="empty">与当前内容一致。</div>')
    + '<p class="dhint" style="margin-top:14px">要回到这版，对我说「恢复到版本 ' + n + '」。</p>');
  const back = qs('#sheet').querySelector('[data-vback]');
  if (back) back.onclick = () => openVersions();
}

/* ---------- 插件设置（宿主注入 env.settings 才可用；离线网页没有） ---------- */
async function openSettings(){
  if (!env.settings) return;
  openSheet('⚙ 设置', '<p class="muted">读取中…</p>');
  const render = view => {
    const v = view.values || {};
    let h = '<p class="muted">这些设置对整个 DSH 生效（不只当前项目）。' + (view.writable ? '' : '当前环境只读，不能修改。') + '</p>';
    h += '<div class="setrow"><label><input type="checkbox" id="setNotify" ' + (v.notifyEnabled !== false ? 'checked' : '') + '> <b>双向闭环</b>——面板上的拍板/动作按钮直接发送给当前会话；关闭后退回复制文本</label></div>';
    h += '<div class="setrow"><label>时间线默认显示条数（5–200，更早的收在展开按钮后）<br><input type="number" id="setTl" min="5" max="200" value="' + esc(v.timelineShow || 30) + '" style="width:90px"></label> <span class="muted">下次刷新面板生效</span></div>';
    h += '<div class="setrow"><label>配套 skill 安装目录（留空 = DSH 全局技能目录）<br><input type="text" id="setSkill" value="' + esc(v.skillRoot || '') + '" placeholder="留空即可" style="width:100%"></label> <span class="muted">重启 DSH 后生效</span></div>';
    h += '<div class="actrow"><button class="actbtn primary" data-setsave ' + (view.writable ? '' : 'disabled') + '>保存</button>'
       + '<button class="actbtn" data-setreset ' + (view.writable ? '' : 'disabled') + '>全部恢复默认</button></div>';
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
  const pend = DATA.decisions.filter(d => !d.decided), done = DATA.decisions.filter(d => d.decided);
  let h = '';
  if (!pend.length) h += '<div class="empty">当前没有待拍板的决策</div>';
  pend.forEach(dc => h += decisionHtml(dc));
  if (done.length) h += '<details><summary>已定历史（' + done.length + ' 件，保留备查）</summary>' + done.map(decisionHtml).join('') + '</details>';
  openSheet('⚖ 等你拍板（' + pend.length + ' 件）', h);
  bindComposers(qs('#sheet'));
}

function openAudit(){
  const h = DATA.health;
  let s = '';
  s += '<p class="muted">有 <b>' + h.facts_pending + '</b> 处改动还没记进看板 · <b>' + h.evidence_missing.length + '</b> 个引用的文件找不到'
    + ((h.evidence_invalid && h.evidence_invalid.length) ? (' · <b>' + h.evidence_invalid.length + '</b> 个引用写到了项目外面（不允许）') : '')
    + ((h.verify_missing && h.verify_missing.length) ? (' · <b>' + h.verify_missing.length + '</b> 个功能标了已验证却没写验证记录') : '')
    + ((h.facts_error === 'corrupt') ? ' · 变更记录文件损坏，请重新采集' : (h.facts_error === 'missing' ? ' · 还没采集过变更' : ''))
    + ' · 变更来源：' + (h.source === 'git' ? '代码仓库变更记录' : (h.source ? '文件修改时间' : '尚未采集')) + '</p>';
  s += '<h4 style="margin:14px 0 6px">这次发现的改动（' + (h.facts || []).length + ' 条）</h4>';
  if (h.facts && h.facts.length){
    s += '<table><tr><th>文件</th><th>类型</th><th>改动</th><th>记进看板了吗</th></tr>'
      + h.facts.map(x => '<tr><td>' + esc(x.path) + '</td><td>' + esc(x.kind) + '</td><td>' + esc(x.change) + '</td><td>' + (x.pending ? '⚠ 还没记' : '✅ 已记') + '</td></tr>').join('') + '</table>';
  } else s += '<p class="muted">这次没有发现改动。</p>';
  s += '<h4 style="margin:14px 0 6px">功能引用的文件（' + h.matrix.length + ' 条）</h4>';
  if (h.matrix.length){
    s += '<table><tr><th>文件</th><th>哪个功能在用</th><th>类型</th><th>文件在吗</th></tr>'
      + h.matrix.map(r => '<tr><td>' + esc(r.path) + '</td><td>' + esc(r.owners.join(' / ')) + '</td><td>' + esc(r.kind) + '</td><td>' + (r.exists ? '✅' : '⚠ 缺失') + '</td></tr>').join('') + '</table>';
  } else s += '<p class="muted">还没有功能登记引用文件。</p>';
  s += '<h4 style="margin:14px 0 6px">不用管的文件（内部工具、其他产品等；列在这里就不算产品改动）</h4>';
  s += (h.ignore && h.ignore.length) ? h.ignore.map(p => '<code style="display:block;margin:3px 0">' + esc(p) + '</code>').join('') : '<p class="muted">无。</p>';
  if (h.glossary_drift && h.glossary_drift.length){
    s += '<h4 style="margin:14px 0 6px">用词漂移（' + h.glossary_drift.length + ' 处——建议统一成标准用词）</h4>'
      + '<table><tr><th>别名</th><th>标准用词</th><th>出现在</th><th>次数</th></tr>'
      + h.glossary_drift.map(d => '<tr><td>' + esc(d.alias) + '</td><td>' + esc(d.term) + '</td><td>' + esc(d.file) + '</td><td>' + d.count + '</td></tr>').join('') + '</table>';
  }
  if (h.warnings && h.warnings.length){
    s += '<h4 style="margin:14px 0 6px">其他提示（' + h.warnings.length + ' 条）</h4>'
      + h.warnings.map(w => '<p class="muted" style="margin:3px 0">· ' + esc(w) + '</p>').join('');
  }
  openSheet('🩺 数据健康 · 完整审计', s);
}

/* 功能详情正文（功能卡、引用链接、节点面板共用） */
function featBodyHtml(f){
  const sendable = !!env.command;
  let h = '<p class="lede">' + esc(f.desc) + '</p>';
  if (f.verify) h += '<div class="kv"><b>验证</b>' + esc(f.verify) + '</div>';
  else if (f.status === '可用') h += '<div class="kv"><b>验证</b>🤖 已标为可用，等你试用后盖章</div>';
  else if (f.status === '进行中') h += '<div class="kv"><b>验证</b>🤖 开发中</div>';
  /* 子项明细（v1.3）：功能的组成块，五态 + 证据 + 验证记录 */
  if (f.children && f.children.length){
    h += '<div class="kv"><b>子项</b><span class="muted">（这个功能由哪几块组成）</span></div>';
    f.children.forEach(c => {
      h += '<div class="subrow"><span class="badge b-x' + SMAP[c.status] + '">' + esc(c.status) + '</span> <b>' + esc(c.name) + '</b>'
        + '<br><span class="muted">' + esc(c.desc) + '</span>';
      if (c.verify) h += '<div class="verifier">' + esc(c.verify) + '</div>';
      if (c.evidence && c.evidence.length) h += '<div class="ev">' + evHtml(c.evidence) + '</div>';
      h += '</div>';
    });
  }
  if (f.evidence && f.evidence.length) h += '<div class="kv"><b>证据</b><span class="muted">（点击可打开，⧉ 复制路径）</span></div><div class="ev">' + evHtml(f.evidence) + '</div>';
  /* 最近在忙：证据路径相交或正文点名「本功能」的近期时间线（子项证据也算） */
  const evPaths = new Set((f.evidence || []).map(e => e.path));
  (f.children || []).forEach(c => (c.evidence || []).forEach(e => evPaths.add(e.path)));
  const rel = DATA.timeline.filter(t => (t.evidence || []).some(e => evPaths.has(e.path)) || t.text.includes('「' + f.name + '」')).slice(0, 5);
  if (rel.length){
    h += '<div class="kv"><b>最近在忙</b><span class="muted">（与本功能相关的进展）</span></div><ul class="tl">'
      + rel.map(t => '<li><time>' + esc(t.dt) + '</time> ' + linkify(esc(t.text)) + '</li>').join('') + '</ul>';
  }
  if (f.deps && f.deps.length) h += '<div class="kv"><b>需要先有</b>' + f.deps.map(n => '<span class="depc" data-dep="' + esc(n) + '">' + esc(n) + '</span>').join('') + '</div>';
  const used = DATA.features.filter(x => (x.deps || []).includes(f.name));
  if (used.length) h += '<div class="kv"><b>这些功能需要它</b>' + used.map(x => '<span class="depc" data-dep="' + esc(x.name) + '">' + esc(x.name) + '</span>').join('') + '</div>';
  const P = sendable ? '📤 ' : '📋 生成指令：';
  h += '<div class="actrow">';
  if (f.status === '可用') h += '<button class="actbtn primary" data-verify="' + esc(f.name) + '">' + (env.verifyWrite || sendable ? '✅ 我已验证' : '✅ 我已验证（复制指令）') + '</button>';
  if (f.status === '设想') h += '<button class="actbtn" data-cmd="把「' + esc(f.name) + '」标为进行中">' + P + '开始做这个</button>';
  if (f.status === '可用' || f.status === '已验证') h += '<button class="actbtn" data-cmd="把「' + esc(f.name) + '」标为进行中">' + P + '返工重做</button>';
  if (f.status === '已验证') h += '<button class="actbtn" data-cmd="撤销「' + esc(f.name) + '」的验证">' + P + '撤销验证</button>';
  if (f.status === '已废弃') h += '<button class="actbtn" data-cmd="把「' + esc(f.name) + '」恢复为设想">' + P + '恢复为设想</button>';
  if (f.status !== '已废弃') h += '<button class="actbtn" data-cmd="废弃「' + esc(f.name) + '」">' + P + '废弃</button>';
  h += '</div>';
  if (f.status === '可用') h += '<p class="dhint">' + (env.verifyWrite ? '「我已验证」会直接更新你的记录（功能状态 + 时间线）；其余按钮' + (sendable ? '直接发送给我执行。' : '生成一句话指令，粘贴到聊天框我来执行。') : sendable ? '「我已验证」与其他按钮都会直接发送给当前会话的我来落实；会话不在线时会先记下，下次更新时生效。' : '这个入口不能直接改文件：「我已验证」会复制一句话指令，粘贴到聊天框发送，我来替你写入（功能状态 + 时间线）。其余按钮同样是复制指令。') + '</p>';
  else if (f.status === '进行中') h += '<p class="dhint">开发完成后我会把它标为「可用」，届时这里才会出现「✅ 我已验证」按钮。</p>';
  else if (f.status === '已验证') h += '<p class="dhint">「撤销验证」会退回到「可用」等你重新验收（功能没坏，只是撤回盖章）；按钮' + (sendable ? '直接发送给我执行。' : '均生成指令发给我执行。') + '</p>';
  else h += '<p class="dhint">状态变更属于工作请求：按钮' + (sendable ? '直接发送给我执行。' : '生成指令，粘贴到聊天框我来执行。') + '</p>';
  h += '<p class="dhint">' + (env.capabilityNote || '') + '</p>';
  return h;
}
/* 节点面板专用：一句话直发 + 一键追问。点节点就能和 agent 交互，不用再复制粘贴。 */
function askBoxHtml(f){
  const q = t => '<button class="askchip" data-askq="' + esc(t) + '">' + esc(t.length > 16 ? t.slice(0, 15) + '…' : t) + '</button>';
  return '<div class="askbox"><div class="kv"><b>直接和 agent 说一句</b><span class="muted">（消息会自动带上这个功能的名字和状态，直接进你与我的主对话）</span></div>'
    + '<div class="askrow">'
    + '<textarea class="note" data-asktext placeholder="例：这个功能现在到什么程度了？还有哪些坑？／帮我把它做得更稳／边界在哪？"></textarea>'
    + '<button class="asksend" data-ask><span class="ico">📤</span><span class="txt">发送给 agent</span></button>'
    + '</div>'
    + '<div class="askquick"><span class="lab">快捷追问</span>'
    + q('讲讲「' + f.name + '」现在到哪一步了')
    + q('「' + f.name + '」我该怎么验收')
    + q('围绕「' + f.name + '」下一步做什么')
    + '</div>'
    + '<p class="dhint">Ctrl/⌘+Enter 也能发送；点上面的快捷追问则是一键直发。拿不到直发通道时会改为复制并把原因说清楚。</p>'
    + '</div>';
}
/* 直发结果 → 人话（顺便告诉用户走的是哪条通道，出问题好排查） */
function sendResultText(r, what){
  if (r === 'queued') return '会话不在线：已记进收件箱，下次更新时生效';
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
    if (ta) ta.addEventListener('keydown', e => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)){ e.preventDefault(); if (ab) ab.click(); }
    });
    sh.querySelectorAll('[data-askq]').forEach(b => b.onclick = () => sendToAgent(name, b.dataset.askq, b));
  }
  const vb = sh.querySelector('[data-verify]');
  if (vb) vb.onclick = () => {
    const row = sh.querySelector('.actrow');
    if (!row) return;
    const canWrite = !!env.verifyWrite;
    row.innerHTML = '<span class="muted" style="font-size:13px">你已经在真实使用中试过「' + esc(name) + '」了吗？'
      + (canWrite ? '确认后会写入「已验证」并在时间线记一笔：' : '确认后会复制一句话指令，粘贴到聊天框发送，我来写入「已验证」并记一笔时间线：')
      + '</span>'
      + '<button class="actbtn primary" data-cfy>' + (canWrite ? '确认：我已验证' : '复制指令：我已验证') + '</button>'
      + '<button class="actbtn" data-cfn>取消</button>';
    row.querySelector('[data-cfy]').onclick = ev => { ev.currentTarget.disabled = true; ev.currentTarget.textContent = canWrite ? '写入中…' : '复制中…'; doVerify(name, reopen); };
    row.querySelector('[data-cfn]').onclick = () => reopen();
  };
}
function openFeatDetail(name){
  const f = DATA.features.find(x => x.name === name); if (!f) return;
  openSheet(esc(f.name) + ' <span class="badge b-x' + SMAP[f.status] + '">' + esc(f.status) + '</span>', featBodyHtml(f));
  bindFeatSheet(name, () => openFeatDetail(name), false);
}
/* 点关系图节点 → 节点面板：速览 + 一句话直发 agent + 常用动作 */
function openNodePanel(name){
  const f = DATA.features.find(x => x.name === name); if (!f) return;
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
      toast(sendResultText(r, '验收'));
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

/* ---------- 页脚（数据健康摘要） ---------- */
function renderFooter(){
  const h = DATA.health;
  const src = h.source === 'git' ? '代码仓库变更记录' : (h.source ? '文件修改时间' : '尚未采集');
  let txt = '数据健康：';
  txt += h.facts_pending ? ('⚠ ' + h.facts_pending + ' 条变更待整理 · ') : '变更全部已收录 ✅ · ';
  txt += h.evidence_missing.length ? ('⚠ ' + h.evidence_missing.length + ' 条引用文件找不到') : '引用文件都在 ✅';
  if (h.evidence_invalid && h.evidence_invalid.length) txt += ' · ⚠ ' + h.evidence_invalid.length + ' 条引用写到了项目外面';
  if (h.verify_missing && h.verify_missing.length) txt += ' · ⚠ ' + h.verify_missing.length + ' 个功能标了已验证但没写验证记录';
  if (h.facts_error === 'corrupt') txt += ' · ⚠ 变更记录文件损坏，请重新采集';
  if (h.facts_error === 'missing') txt += ' · 还没采集过变更';
  txt += ' · 来源：' + src;
  txt += ' · 点顶部「数据健康」查看完整审计';
  qs('#foot').innerHTML = txt;
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
    return;
  }
  renderStrip(); renderProject(); renderFeatures(); renderNow(); renderFooter();
  gotoTab(currentTab);
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
  if (saved) root.dataset.theme = saved;
  qs('#themeBtn').onclick = () => {
    const cur = root.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const nxt = cur === 'dark' ? 'light' : 'dark'; root.dataset.theme = nxt;
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
return { init: initDashboard, css: CSS, parseProduct, parseFeatures, parseNow, layoutGraph, assembleData, globMatch, kindOf, norm, pad, fmtDate, fmtDT, parseGlossary, glossaryDrift, textWidth, wrapName, nodeDims, truncMid };

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
      const glossRaw = await readOpt(remote, sessionId, 'dev-dashboard/GLOSSARY.md', signal);
      return window.CYD.assembleData(
        { prod, feat, now, glossRaw, factsRaw, ignoreRaw },
        p => exists(remote, sessionId, p, signal));
    }
    /* 版本快照读取（workspaceFiles 只有读方法，够了）：list / read(n) / current() */
    const VERSION_FILES = ['PRODUCT.md', 'FEATURES.md', 'NOW.md', 'GLOSSARY.md'];
    function makeVersions(remote, sessionId, signal){
      async function readIndex(){
        const raw = await readOpt(remote, sessionId, 'dev-dashboard/.versions/index.json', signal);
        if (!raw) return { versions: [] };
        try { const d = JSON.parse(raw); return { versions: Array.isArray(d.versions) ? d.versions : [] }; }
        catch (e){ return { versions: [] }; }
      }
      async function readFiles(prefix){
        const files = {};
        for (const f of VERSION_FILES){ files[f] = (await readOpt(remote, sessionId, prefix + f, signal)) || ''; }
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
    const EMPTY_STYLE = 'padding:26px 18px;color:var(--dsw-alias-label-tertiary,#8a93a3);font-size:13px;line-height:2';
    const CMD_BTN_STYLE = 'margin-top:10px;padding:6px 14px;border:1px solid var(--dsw-alias-line-secondary,#d5dae4);background:transparent;border-radius:999px;cursor:pointer;font-size:12.5px;color:inherit';
    /* 面板里唯一能做的动作是复制指令：把这句话发给我，我来建/更新仪表盘 */
    function copyCommand(mountEl, cmd){
      const btn = mountEl.querySelector('[data-copy-cmd]');
      if (!btn) return;
      btn.onclick = () => {
        const done = () => { btn.textContent = '✓ 已复制，去聊天框粘贴发送'; };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(cmd).then(done).catch(() => { btn.textContent = '复制失败，请手动输入：' + cmd; });
        else btn.textContent = '请手动输入：' + cmd;
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
          mountEl.innerHTML = '<div style="' + EMPTY_STYLE + '">先在左侧打开一个会话，<br>这里就会出现它工作区的开发仪表盘。</div>';
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
              ? '证据点击即在新标签页打开；点关系图节点可以直接写一句话发给我——消息直接进主对话（拿不到直发通道时会复制并说明原因）。'
              : props.openResource ? '证据点击即在新标签页打开；动作按钮复制指令，粘贴发送我执行。' : '面板内动作按钮会复制指令——粘贴到聊天框发送，我来执行。',
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
              mountEl.innerHTML = '<div style="' + EMPTY_STYLE + '">这个工作区还没有开发仪表盘。<br>建立后这里会自动出现，且每个工作区各显各的。<br><br>'
                + '<button data-send-cmd style="' + CMD_BTN_STYLE + '">📤 发送：control my development</button>'
                + '<br><br><span style="opacity:.75">点一下直接发给我，我来建立。</span></div>';
              const sb = mountEl.querySelector('[data-send-cmd]');
              sb.onclick = () => {
                sb.disabled = true;
                props.notify(sessionId, 'command', 'control my development', '用户请求建立开发仪表盘')
                  .then(r => { sb.textContent = r === 'queued' ? '✓ 已记下，下次更新时建立' : '✓ 已发送，我来建立'; })
                  .catch(() => { sb.disabled = false; sb.textContent = '发送失败，请在聊天框输入：control my development'; });
              };
            } else {
              mountEl.innerHTML = '<div style="' + EMPTY_STYLE + '">这个工作区还没有开发仪表盘。<br>建立后这里会自动出现，且每个工作区各显各的。<br><br>'
                + '<button data-copy-cmd style="' + CMD_BTN_STYLE + '">复制指令：control my development</button>'
                + '<br><br><span style="opacity:.75">复制后粘贴到左侧聊天框发送，我来建立。</span></div>';
              copyCommand(mountEl, 'control my development');
            }
          } else if (e && e.missing && e.missing.length){
            mountEl.innerHTML = '<div style="' + EMPTY_STYLE + '">这个工作区的仪表盘缺少文件：<b>' + e.missing.join('、') + '</b><br><br>'
              + '<button data-copy-cmd style="' + CMD_BTN_STYLE + '">复制指令：更新仪表盘</button></div>';
            copyCommand(mountEl, '更新仪表盘');
          } else {
            const plain = /bad-request/.test(code) ? '文件太大，宿主拒绝了本次读取'
              : /timeout|abort/i.test(code) ? '读取超时'
              : '读取失败（' + code + '）';
            mountEl.innerHTML = '<div style="' + EMPTY_STYLE + '">' + plain + '<br><br><a href="#" data-retry>重试</a>，或在聊天框对我说 <b>更新仪表盘</b>。</div>';
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
      // 带上项目名，一眼看出这份看板是哪个工作区的
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
    const zh = { title: '开发仪表盘', 'guide.title': '开发仪表盘', 'guide.desc': '功能地图、验证进度、等你拍板的事，都在这里', 'map.tab': '功能地图' };
    const en = { title: 'Dev Dashboard', 'guide.title': 'Dev Dashboard', 'guide.desc': 'Features, progress and pending decisions', 'map.tab': 'Feature Map' };

    /* ---------- 注册 ---------- */
    function apply(ctx){
      injectTitleCss();
      // 证据「打开文件」走宿主公开服务（与官方文件面板同一条路），不依赖组件 props 管道
      const nav = ctx.sidebarRight;
      let tabOpen = null;   // 由 DashboardBody 注入（官方同款 tab.actions.openResource）
      const setTabOpen = (fn) => { if (typeof fn === 'function') tabOpen = fn; };
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dev-dashboard: locale');
      const t = ctx.locale.bind(NS);
      // 双向闭环的 RPC 载波：没有 connection 服务时退化为「复制指令」
      const carrier = rpcCarrier(ctx);
      const notify = makeNotify(carrier, ctx);
      ctx.effect(() => ctx.sidebarRightTabs.register({
        id: TAB_ID, kind: 'dashboard', priority: 'builtin', keepMounted: true, title: () => t('title'),
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
        }),
      }, MapView));
    }

    const inject = ['slots', 'locale', 'sidebarRightTabs', 'sidebarRight', 'remote', 'remote.workspaceFiles', 'connection'];
    exports.inject = inject;
    exports.apply = apply;
    return module.exports;
  }
});
