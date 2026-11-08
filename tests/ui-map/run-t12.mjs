/*
 * tests/ui-map/run-t12.mjs —— R12 双轨时间轴：截图 + DOM 断言采集。
 *
 * 产出（默认 output/_verify/threadline/T51/R12/，由 TL_TASK 覆盖）：
 *   timeline-full.png     1440 宽：整页（看左列不压缩上面的图）
 *   timeline-today.png / timeline-7d.png / timeline-all.png    三档 range
 *   timeline-empty.png    domain=null 空数据（不画假柱子）
 *   timeline-narrow.png   880 宽（容器查询：字号收紧）
 *   timeline.txt / timeline.json   断言原始值 + sha256 + 实测高度 + 交互
 *
 * ## 重要：为什么要换样式（不是绕过门禁，而是门禁本身的限制）
 * 页面通过 installStyles() 注入的是**生成物** src/client/styles/css.ts。
 * 本轮改的是 styles/*.css 源文件，而重建 css.ts 属于 Lead 的收口动作
 * （本任务卡明令禁止跑 emit-styles）。若直接截图，页面里还是旧 CSS —— 图就是假证据。
 * 所以本脚本在断言前把 tokens.css / timeline.css 的**源文件文本**换进
 * <style data-plugin-css="threadline/...">（只在测试页面内、只影响本次渲染）。
 * 换完再断言 + 截图，图才反映真实源文件。**产品侧仍需重建 css.ts 才能生效。**
 *
 * 纪律：截图只在全部断言通过时落盘；每张图对应可复现状态；
 * 页面内脚本与断言一律用普通引号拼接（不用模板串反引号）。
 *
 * 用法：
 *   node tests/ui-map/run-t12.mjs
 *   TL_TASK=T51/R12 node tests/ui-map/run-t12.mjs
 */
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { launchBrowser, PLUGIN_ROOT, renderAtWithBrowser, WORKSPACE_ROOT } from '../harness/index.mjs'

const ENTRY_MAP = 'tests/ui-map/entries/map.entry.ts'
const TASK = process.env.TL_TASK ?? 'T51/R12'
const OUT_DIR = resolve(WORKSPACE_ROOT, 'output/_verify/threadline/' + TASK)

/** 代码新鲜度覆盖面：截图必须晚于这些产品代码的最后一次改动。 */
const COVERAGE = ['src/client/ui/timeline', 'src/client/styles/timeline.css', 'src/client/styles/tokens.css', 'src/client/ui/shell']

/** 需要换成源文件的样式表（生成物 css.ts 里的旧文本 → 磁盘上的新文本）。 */
const FRESH_SHEETS = ['threadline/tokens.css', 'threadline/timeline.css']

const started = new Date()
const lines = []
const results = []

function safeFreshSheet(key) {
  const file = key.replace('threadline/', 'src/client/styles/')
  return readFileSync(resolve(PLUGIN_ROOT, file), 'utf8')
}

/** 页面内：把生成的注入样式替换成源文件文本（只影响本页）。 */
const SWAP_CSS_ACTION = {
  type: 'evaluate',
  code: [
    '(function(){',
    '  var sheets = ' +
      JSON.stringify(
        Object.fromEntries(FRESH_SHEETS.map((key) => [key, safeFreshSheet(key)])),
      ) +
      ';',
    '  var swapped = [];',
    '  Object.keys(sheets).forEach(function(key){',
    '    var el = document.head.querySelector("style[data-plugin-css=\'" + key + "\']");',
    '    if (el === null) { swapped.push(key + ":missing"); return; }',
    '    el.textContent = sheets[key];',
    '    swapped.push(key + ":swapped");',
    '  });',
    '  window.__tlCssSwap = swapped.join(",");',
    '  return true;',
    '})()',
  ].join('\n'),
}

function log(text) {
  lines.push(text)
  console.log(text)
}

function record(label, result) {
  results.push({ label, ok: result.ok, checks: result.checks, png: result.png })
  for (const check of result.checks) {
    log('  ' + (check.ok ? 'PASS' : 'FAIL') + '  ' + check.label + (check.ok ? '' : '  ' + JSON.stringify(check.detail)))
  }
  return result.ok
}

function latestCodeMtime() {
  let latest = 0
  const walk = (target) => {
    const info = statSync(target)
    if (info.isDirectory()) {
      for (const entry of readdirSync(target)) walk(join(target, entry))
      return
    }
    if (!/\.(ts|tsx|css)$/.test(target)) return
    if (info.mtimeMs > latest) latest = info.mtimeMs
  }
  for (const relative of COVERAGE) walk(resolve(PLUGIN_ROOT, relative))
  return latest
}

/* ------------------------------------------------------------------ *
 * 页面内实测（全部真实 DOM）
 * ------------------------------------------------------------------ */

const MEASURE = [
  '(function(){',
  '  function rect(sel){ var el = document.querySelector(sel); if (!el) return null; var r = el.getBoundingClientRect();',
  '    return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }; }',
  '  function css(sel, prop){ var el = document.querySelector(sel); if (!el) return null;',
  '    return getComputedStyle(el).getPropertyValue(prop).trim(); }',
  '  return {',
  '    cssSwap: window.__tlCssSwap || null,',
  '    graph: rect("[data-tl-graph]"),',
  '    graphStage: rect("[data-tl-graph] .tl-graph-stage"),',
  '    timelineRegion: rect("[data-region=\'timeline\']"),',
  '    timelineRoot: rect(".tl-timeline"),',
  '    plot: rect(".tl-plot"),',
  '    track: rect(".tl-track"),',
  '    leftColumn: rect(".threadline-left"),',
  '    activity: rect(".tl-activity"),',
  '    lanes: rect(".tl-lanes"),',
  '    barCount: document.querySelectorAll(".tl-bar").length,',
  '    laneCount: document.querySelectorAll(".tl-lane-bar").length,',
  '    tickCount: document.querySelectorAll(".tl-scale-tick").length,',
  '    playheadLabels: document.querySelectorAll("[data-playhead-label]").length,',
  '    tokenTimelineH: (function(){ var el = document.querySelector(".threadline-app"); if (!el) return null;',
  '      return getComputedStyle(el).getPropertyValue("--tl-timeline-h").trim(); })(),',
  '    timelineText: (function(){ var el = document.querySelector("[data-region=\'timeline\']");',
  '      return el ? (el.textContent || "") : null; })(),',
  '    oldStructures: {',
  '      growth: document.querySelectorAll("[class*=tl-growth]").length,',
  '      denseTicks: document.querySelectorAll(".tl-ticks, .tl-tick").length,',
  '      current: document.querySelectorAll("[class*=tl-current]").length,',
  '      handle: document.querySelectorAll("[class*=tl-playhead-handle]").length,',
  '      sessionLine: document.querySelectorAll("[class*=tl-session]").length,',
  '    },',
  '    aria: (function(){ var el = document.querySelector(".tl-track"); if (!el) return null;',
  '      return { role: el.getAttribute("role"), min: el.getAttribute("aria-valuemin"), max: el.getAttribute("aria-valuemax"),',
  '        now: el.getAttribute("aria-valuenow"), text: el.getAttribute("aria-valuetext"),',
  '        orientation: el.getAttribute("aria-orientation"), tabIndex: el.getAttribute("tabindex") }; })(),',
  '    barHeights: Array.prototype.map.call(document.querySelectorAll(".tl-bar"), function(el){',
  '      return Math.round(el.getBoundingClientRect().height * 100) / 100; }),',
  '    barOps: Array.prototype.map.call(document.querySelectorAll(".tl-bar"), function(el){',
  '      return Number(el.getAttribute("data-ops")); }),',
  '    laneRows: Array.prototype.map.call(document.querySelectorAll(".tl-lane-bar"), function(el){',
  '      return { lane: Number(el.getAttribute("data-lane")), title: el.getAttribute("title") }; }),',
  '    tickLabels: Array.prototype.map.call(document.querySelectorAll(".tl-scale-tick"), function(el){',
  '      return { text: el.textContent, align: el.getAttribute("data-tick-align") }; }),',
  '    tickFont: css(".tl-scale-tick", "font-size"),',
  '    playheadFont: css(".tl-playhead-label", "font-size"),',
  '    laneBarBg: css(".tl-lane-bar", "background-color"),',
  '    laneBarRadius: css(".tl-lane-bar", "border-radius"),',
  '    barBg: css(".tl-bar", "background-color"),',
  '    activityBorder: css(".tl-activity", "border-block-end-width"),',
  '  };',
  '})()',
].join('\n')

/* 断言：任何解释性小字都不许出现（把按钮 / 刻度 / 播放头标签摘掉后，剩的可见文字必须是空）。 */
const NO_COPY = {
  expr: [
    {
      label: 'no-explanatory-copy',
      code:
        '(function(){var el=document.querySelector("[data-region=\'timeline\']");if(!el)return "missing";' +
        'var clone=el.cloneNode(true);' +
        /* 摘掉三类**不是说明文字**的东西：
             1. 三个刻度标签 + 播放头唯一标签（必要数据标签，用户保留）；
             2. aria-live 状态区（threadline-visually-hidden，读屏专用、视觉上不可见）。
             「回到最新」按钮已于 2026-11-08 删除（用户拍板），所以这里不再有 button 需要摘。 */
        'var drop=clone.querySelectorAll(".tl-scale-tick,[data-playhead-label],[data-live],.threadline-visually-hidden");' +
        'for(var i=0;i<drop.length;i++){drop[i].parentNode.removeChild(drop[i]);}' +
        'var rest=(clone.textContent||"").replace(/\\s+/g,"");' +
        'return rest})()',
      equals: '',
    },
    {
      // 2026-11-08 用户拍板删掉「回到最新」按钮：时间轴里**不该再有按钮**，
      // 也不该留着 .tl-controls 控件列（能力改双击轨道，见 spec §5）。
      label: 'no-back-to-latest-button',
      code:
        '(function(){var el=document.querySelector("[data-region=\'timeline\']");if(!el)return "missing";' +
        'var btns=el.querySelectorAll("button,[data-testid=\'timeline-now\'],.tl-controls");' +
        'return btns.length})()',
      equals: 0,
    },
    {
      label: 'no-session-title-as-visible-text',
      code:
        '(function(){var bars=document.querySelectorAll(".tl-lane-bar");' +
        'var bad=[];for(var i=0;i<bars.length;i++){var t=(bars[i].textContent||"").trim();' +
        'if(t!==""){bad.push(t)}}return bad.join("|")})()',
      equals: '',
    },
  ],
}

/* 断言：旧结构一个都不许回来。 */
const NO_OLD_STRUCTURE = {
  absent: [
    { selector: '.tl-growth' },
    { selector: '.tl-growth-svg' },
    { selector: '.tl-ticks' },
    { selector: '.tl-tick' },
    { selector: '.tl-current' },
    { selector: '.tl-playhead-handle' },
    { selector: '.tl-session' },
  ],
}

/** 双轨的结构与几何断言：总高 104、柱在上轨、会话在下轨、播放头标签只有 1 个。 */
const DOUBLE_TRACK_EXPR = [
  {
    label: 'timeline-height-104',
    code: '(function(){var el=document.querySelector("[data-region=\'timeline\']");if(!el)return -1;return Math.round(el.getBoundingClientRect().height)})()',
    equals: 104,
  },
  {
    /* 图高未变（用户要求「不影响上面的节点图」）：
       probe-graph.mjs 实测 A/B —— 只切 --tl-timeline-h 48↔104，[data-tl-graph] 都是 533px。
       这里同时断两条：①绝对值 533；②左列可滚动（时间轴变高只让它变长，不压缩图）。 */
    label: 'graph-height-unchanged',
    code: '(function(){var el=document.querySelector("[data-tl-graph]");if(!el)return -1;return Math.round(el.getBoundingClientRect().height)})()',
    equals: 533,
  },
  {
    label: 'left-column-scrolls-instead-of-squeezing',
    code:
      '(function(){var left=document.querySelector(".threadline-left");var g=document.querySelector("[data-tl-graph]");' +
      'if(!left||!g)return "missing";' +
      'var stage=document.querySelector("[data-tl-graph] .tl-graph-stage");' +
      'if(!stage)return "no-stage";' +
      /* 图的实际渲染高度 = 图头 + 图体，不能因为时间轴变高而被压小；
         左列是 flex column + overflow-y:auto，所以它应该是「内容变长 → 可滚动」。 */
      'return Math.round(stage.getBoundingClientRect().height) === 420 && left.scrollHeight >= left.clientHeight})()',
  },
  {
    label: 'token-is-104px',
    code:
      '(function(){var el=document.querySelector(".threadline-app");if(!el)return "missing";' +
      'return getComputedStyle(el).getPropertyValue("--tl-timeline-h").trim()})()',
    equals: '104px',
  },
  {
    label: 'bars-in-upper-track',
    code:
      '(function(){var a=document.querySelector(".tl-activity");if(!a)return "missing";' +
      'var bars=document.querySelectorAll(".tl-bar");if(bars.length===0)return "no-bars";' +
      'var ar=a.getBoundingClientRect();' +
      'for(var i=0;i<bars.length;i++){var r=bars[i].getBoundingClientRect();' +
      'if(r.bottom>ar.bottom+0.5)return "bar-below-baseline";' +
      'if(r.top<ar.top-0.5)return "bar-above-track"}' +
      'return true})()',
  },
  {
    label: 'lanes-below-bars',
    code:
      '(function(){var a=document.querySelector(".tl-activity");var l=document.querySelector(".tl-lanes");' +
      'if(!a||!l)return "missing";return l.getBoundingClientRect().top >= a.getBoundingClientRect().bottom})()',
  },
  {
    label: 'bar-height-monotonic-with-ops',
    code:
      '(function(){var bars=document.querySelectorAll(".tl-bar");' +
      'var pairs=[];for(var i=0;i<bars.length;i++){pairs.push({h:Math.round(bars[i].getBoundingClientRect().height*100)/100,' +
      'ops:Number(bars[i].getAttribute("data-ops"))})}' +
      'pairs.sort(function(x,y){return x.ops-y.ops});' +
      'for(var j=1;j<pairs.length;j++){if(pairs[j].h+0.01<pairs[j-1].h)return "ops "+pairs[j].ops+" 的柱比 ops "+pairs[j-1].ops+" 矮"}' +
      'return true})()',
  },
  {
    label: 'playhead-spans-both-tracks',
    code:
      '(function(){var p=document.querySelector(".tl-playhead-line");var t=document.querySelector(".tl-track");' +
      'if(!p||!t)return "missing";var pr=p.getBoundingClientRect();var tr=t.getBoundingClientRect();' +
      'return pr.top<=tr.top+1 && pr.bottom>=tr.bottom-1})()',
  },
  {
    label: 'playhead-label-stays-inside-track',
    code:
      '(function(){var p=document.querySelector(".tl-playhead-label");var t=document.querySelector(".tl-track");' +
      'if(!p||!t)return "missing";var pr=p.getBoundingClientRect();var tr=t.getBoundingClientRect();' +
      'return pr.left>=tr.left-1 && pr.right<=tr.right+1})()',
  },
  {
    /* 实测踩过的坑：卡片上下 8px 内边距 + 1px 边框会把画布从 104 压到 86，
       于是「4 行会话条」下沿会压住「底部刻度行」。这条守死：会话条底 ≤ 刻度行顶。 */
    label: 'lanes-do-not-overlap-scale-row',
    code:
      '(function(){var scale=document.querySelector(".tl-scale");if(!scale)return "no-scale";' +
      'var scaleTop=scale.getBoundingClientRect().top;var bars=document.querySelectorAll(".tl-lane-bar");' +
      'var worst=-Infinity;for(var i=0;i<bars.length;i++){var b=bars[i].getBoundingClientRect().bottom;if(b>worst)worst=b}' +
      'if(worst===-Infinity)return true;' +
      'return worst <= scaleTop + 0.5 ? true : ("lane bottom " + Math.round(worst) + " > scale top " + Math.round(scaleTop))})()',
  },
  {
    label: 'canvas-height-102',
    code:
      '(function(){var t=document.querySelector(".tl-track");if(!t)return "missing";' +
      'return Math.round(t.getBoundingClientRect().height)})()',
    equals: 102,
  },
  {
    label: 'lane-rows-max-4',
    code:
      '(function(){var rows={};var bars=document.querySelectorAll(".tl-lane-bar");' +
      'for(var i=0;i<bars.length;i++)rows[bars[i].getAttribute("data-lane")]=1;' +
      'return Object.keys(rows).length<=4})()',
  },
  {
    label: 'aria-complete',
    code:
      '(function(){var el=document.querySelector(".tl-track");if(!el)return "missing";' +
      'var need=["role","aria-valuemin","aria-valuemax","aria-valuenow","aria-valuetext","aria-label","tabindex"];' +
      'var miss=need.filter(function(a){return !el.getAttribute(a)});return miss.join("|")})()',
    equals: '',
  },
  {
    label: 'tick-font-11',
    code: '(function(){var el=document.querySelector(".tl-scale-tick");if(!el)return "missing";return getComputedStyle(el).getPropertyValue("font-size").trim()})()',
    equals: '11px',
  },
  {
    label: 'playhead-label-font-11',
    code:
      '(function(){var el=document.querySelector(".tl-playhead-label");if(!el)return "missing";' +
      'return getComputedStyle(el).getPropertyValue("font-size").trim()})()',
    equals: '11px',
  },
  {
    /*
     * 会话条：6px 高 + 令牌圆角 --tl-radius-xs（4px）。
     * 注意 getComputedStyle 报的是**声明值**（4px），CSS 只在绘制时按
     * 「相邻半径之和不得超边长」等比压到 3px —— 所以这里断声明值 + 高度，
     * 视觉上的 3px 观感由设计保证，不用 computed style 去追。
     */
    label: 'lane-bar-6px-token-radius',
    code:
      '(function(){var el=document.querySelector(".tl-lane-bar");if(!el)return "missing";' +
      'var s=getComputedStyle(el);' +
      'return Math.round(el.getBoundingClientRect().height)+"px|"+s.getPropertyValue("border-top-left-radius").trim()})()',
    equals: '6px|4px',
  },
  {
    /* 样式纪律：圆角/字体必须是令牌（不许字面量）。令牌化后 computed 值应等于 4px。 */
    label: 'radius-comes-from-token',
    code:
      '(function(){var el=document.querySelector(".tl-lane-bar");if(!el)return "missing";' +
      'var tok=getComputedStyle(document.querySelector(".threadline-app")).getPropertyValue("--tl-radius-xs").trim();' +
      'var got=getComputedStyle(el).getPropertyValue("border-top-left-radius").trim();' +
      'return got===tok})()',
  },
  {
    label: 'baseline-1px-border',
    code:
      '(function(){var el=document.querySelector(".tl-activity");if(!el)return "missing";' +
      'return getComputedStyle(el).getPropertyValue("border-block-end-width").trim()})()',
    equals: '1px',
  },
]

/* ------------------------------------------------------------------ *
 * 场景
 * ------------------------------------------------------------------ */

async function scene(browser, options) {
  const outPng = join(OUT_DIR, options.file)
  /* swapCss: false → 不用源文件覆盖，直接看产品注入路径（installStyles → 生成物 css.ts）。
     只有「Lead 已重建 css.ts」时这个模式才代表真实产品；否则就是旧样式。 */
  const actions = options.swapCss === false ? (options.actions ?? []) : [SWAP_CSS_ACTION, ...(options.actions ?? [])]
  const result = await renderAtWithBrowser(browser, {
    width: options.width,
    height: options.height ?? 1000,
    entry: ENTRY_MAP,
    query: options.query,
    waitFor: 'html[data-harness-ready]',
    outPng,
    assert: options.assert,
    actions,
    label: options.file,
  })
  log('')
  log('[' + options.file + ']  ' + (result.ok ? 'OK' : 'FAILED') + '  viewport=' + options.width + 'x' + (options.height ?? 1000) + '  query=' + (options.query ?? ''))
  if (result.png !== null) log('  png sha256=' + result.png.sha256 + '  bytes=' + result.png.bytes)
  record(options.file, result)
  return result
}

const browser = await launchBrowser({ width: 1440, height: 1000 })
mkdirSync(OUT_DIR, { recursive: true })

let measured = null
let interaction = null
let afterClick = null
let keyStep = null
let keyResult = null
let keyboardOk = false
let clickOk = false

try {
  /* 1. 主场景：1440 宽，全部时间范围。 */
  const main = await scene(browser, {
    file: 'timeline-full.png',
    width: 1440,
    query: 'state=default',
    assert: {
      contains: [{ selector: '[data-region="timeline"]' }, { selector: '.tl-track' }, { selector: '.tl-bar' }],
      expr: [...DOUBLE_TRACK_EXPR, ...NO_COPY.expr],
      absent: NO_OLD_STRUCTURE.absent,
      count: [
        { selector: '[data-playhead-label]', equals: 1 },
        { selector: '.tl-scale-tick', equals: 3 },
      ],
    },
  })

  /* 2. 实测：把数字记进 timeline.txt（图高未变的核心证据）。 */
  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 })
  await page.navigate(main.pageUrl)
  await page.evaluate(
    'new Promise(function(resolve){ requestAnimationFrame(function(){ requestAnimationFrame(function(){ resolve(1) }) }) })',
    { awaitPromise: true },
  )
  await page.evaluate(SWAP_CSS_ACTION.code)
  await page.evaluate(
    'new Promise(function(resolve){ requestAnimationFrame(function(){ requestAnimationFrame(function(){ resolve(1) }) }) })',
    { awaitPromise: true },
  )
  measured = await page.evaluate(MEASURE)
  await page.close()

  log('')
  log('=== 实测（1440x1000, state=default） ===')
  log('css 换源            : ' + measured.cssSwap)
  log('--tl-timeline-h     : ' + measured.tokenTimelineH)
  log('graph height        : ' + measured.graph.height + 'px')
  log('graph stage height  : ' + measured.graphStage.height + 'px')
  log('timeline region     : ' + measured.timelineRegion.height + 'px')
  log('timeline root       : ' + measured.timelineRoot.height + 'px')
  log('left column height  : ' + measured.leftColumn.height + 'px')
  log('activity track      : y=' + measured.activity.y + ' h=' + measured.activity.height)
  log('lanes track         : y=' + measured.lanes.y + ' h=' + measured.lanes.height)
  log('bars / lanes / ticks: ' + measured.barCount + ' / ' + measured.laneCount + ' / ' + measured.tickCount)
  log('playhead labels     : ' + measured.playheadLabels)
  log('old structures      : ' + JSON.stringify(measured.oldStructures))
  log('timeline visible txt: ' + JSON.stringify(measured.timelineText))
  log('aria                : ' + JSON.stringify(measured.aria))
  log('tick labels         : ' + JSON.stringify(measured.tickLabels))
  log('tick / playhead font: ' + measured.tickFont + ' / ' + measured.playheadFont)
  log('lane bar bg / radius: ' + measured.laneBarBg + ' / ' + measured.laneBarRadius)
  log('bar bg              : ' + measured.barBg)
  log('baseline border     : ' + measured.activityBorder)
  log('lane rows           : ' + JSON.stringify(measured.laneRows))

  /* 3. 键盘 / 点击定位交互。 */
  log('')
  log('=== 交互（点击定位 / 键盘 ← → Home End） ===')
  const interactPage = await browser.newPage()
  await interactPage.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 })
  await interactPage.navigate(main.pageUrl)
  await interactPage.evaluate(
    'new Promise(function(resolve){ requestAnimationFrame(function(){ requestAnimationFrame(function(){ resolve(1) }) }) })',
    { awaitPromise: true },
  )
  await interactPage.evaluate(SWAP_CSS_ACTION.code)

  interaction = await interactPage.evaluate(
    [
      '(function(){',
      '  var track = document.querySelector(".tl-track");',
      '  if (!track) return { error: "no-track" };',
      '  var rect = track.getBoundingClientRect();',
      '  var before = track.getAttribute("aria-valuenow");',
      '  track.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, pointerId: 1,',
      '    clientX: Math.round(rect.left + rect.width * 0.25), clientY: Math.round(rect.top + rect.height / 2) }));',
      '  return { before: before, rect: { left: Math.round(rect.left), width: Math.round(rect.width) } };',
      '})()',
    ].join('\n'),
  )
  await interactPage.evaluate(
    'new Promise(function(resolve){ requestAnimationFrame(function(){ requestAnimationFrame(function(){ resolve(1) }) }) })',
    { awaitPromise: true },
  )
  afterClick = await interactPage.evaluate(
    '(function(){var track=document.querySelector(".tl-track");' +
      'var min=Number(track.getAttribute("aria-valuemin"));var max=Number(track.getAttribute("aria-valuemax"));' +
      'var now=Number(track.getAttribute("aria-valuenow"));' +
      /* 受控组件的 aria-valuenow 由父级 playhead 决定；harness 的 onPlayheadChange 是 no-op，
         所以这里验证「点击命中的几何比例」而不是「DOM 值变了」——
         真正的状态回写由单测里的 ratioToTime 正向用例守。 */
      'var rect=track.getBoundingClientRect();' +
      'var probeRatio=window.__tlLastClickRatio===undefined?null:window.__tlLastClickRatio;' +
      'return {now: now, min: min, max: max, expected: Math.round(min + (max-min)*0.25),' +
      '  ratio: (now-min)/(max-min), probeRatio: probeRatio, width: Math.round(rect.width)}})()',
  )
  log('click@25%  before=' + interaction.before + '  after=' + afterClick.now + '  expected≈' + afterClick.expected + '  ratio=' + afterClick.ratio.toFixed(4))
  clickOk = Math.abs(afterClick.ratio - 0.25) < 0.02
  log('点击定位判定: ' + (clickOk ? 'PASS' : 'FAIL'))

  keyStep = await interactPage.evaluate(
    [
      '(function(){',
      '  var track = document.querySelector(".tl-track");',
      '  track.focus();',
      '  var before = Number(track.getAttribute("aria-valuenow"));',
      '  track.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));',
      '  return { before: before };',
      '})()',
    ].join('\n'),
  )
  await interactPage.evaluate(
    'new Promise(function(resolve){ requestAnimationFrame(function(){ requestAnimationFrame(function(){ resolve(1) }) }) })',
    { awaitPromise: true },
  )
  /* ⚠️ 每一次按键后必须等 React 重渲染完再读 aria-valuenow：
     同步连按三次时 DOM 还没更新，读到的是旧值（这是测法问题，不是组件问题）。 */
  const afterRight = await interactPage.evaluate(
    '(function(){var t=document.querySelector(".tl-track");return Number(t.getAttribute("aria-valuenow"))})()',
  )
  await interactPage.evaluate(
    '(function(){document.querySelector(".tl-track").dispatchEvent(new KeyboardEvent("keydown",{key:"Home",bubbles:true,cancelable:true}));return 1})()',
  )
  await interactPage.evaluate(
    'new Promise(function(resolve){ requestAnimationFrame(function(){ requestAnimationFrame(function(){ resolve(1) }) }) })',
    { awaitPromise: true },
  )
  const afterHome = await interactPage.evaluate(
    '(function(){var t=document.querySelector(".tl-track");return Number(t.getAttribute("aria-valuenow"))})()',
  )
  await interactPage.evaluate(
    '(function(){document.querySelector(".tl-track").dispatchEvent(new KeyboardEvent("keydown",{key:"End",bubbles:true,cancelable:true}));return 1})()',
  )
  await interactPage.evaluate(
    'new Promise(function(resolve){ requestAnimationFrame(function(){ requestAnimationFrame(function(){ resolve(1) }) }) })',
    { awaitPromise: true },
  )
  keyResult = await interactPage.evaluate(
    '(function(){var t=document.querySelector(".tl-track");' +
      'return {now: Number(t.getAttribute("aria-valuenow")), min: Number(t.getAttribute("aria-valuemin")),' +
      'max: Number(t.getAttribute("aria-valuemax"))}})()',
  )
  keyResult.afterRight = afterRight
  keyResult.home = afterHome
  keyResult.end = keyResult.now
  log('ArrowRight: ' + keyStep.before + ' -> ' + keyResult.afterRight + '（应增大）')
  log('Home -> ' + keyResult.home + '（应 = min ' + keyResult.min + '）')
  log('End  -> ' + keyResult.end + '（应 = max ' + keyResult.max + '）')
  keyboardOk = keyResult.afterRight > keyStep.before && keyResult.home === keyResult.min && keyResult.end === keyResult.max
  log('键盘判定: ' + (keyboardOk ? 'PASS' : 'FAIL'))
  await interactPage.close()

  /* 4. 三档 range。 */
  for (const range of ['range.today', 'range.7d', 'range.all']) {
    await scene(browser, {
      file: 'timeline-' + range.replace('range.', '') + '.png',
      width: 1440,
      query: 'state=default&range=' + range,
      assert: {
        contains: [{ selector: '.tl-track' }, { selector: '.tl-scale-tick' }],
        expr: [...NO_COPY.expr, DOUBLE_TRACK_EXPR[0], DOUBLE_TRACK_EXPR[9]],
        absent: NO_OLD_STRUCTURE.absent,
        count: [{ selector: '.tl-scale-tick', equals: 3 }],
      },
    })
  }

  /* 5. 窄容器（容器查询生效：880 < 899.98 → 字号 10px）。 */
  await scene(browser, {
    file: 'timeline-narrow.png',
    width: 880,
    query: 'state=default',
    assert: {
      contains: [{ selector: '.tl-track' }, { selector: '[data-playhead-label]' }],
      expr: [
        ...NO_COPY.expr,
        {
          label: 'narrow-tick-font-10',
          code: '(function(){var el=document.querySelector(".tl-scale-tick");if(!el)return "missing";return getComputedStyle(el).getPropertyValue("font-size").trim()})()',
          equals: '10px',
        },
        {
          label: 'narrow-timeline-height-104',
          code: '(function(){var el=document.querySelector("[data-region=\'timeline\']");if(!el)return -1;return Math.round(el.getBoundingClientRect().height)})()',
          equals: 104,
        },
      ],
      absent: NO_OLD_STRUCTURE.absent,
      count: [{ selector: '[data-playhead-label]', equals: 1 }],
    },
  })

  /* 6. 空数据（domain=null）：不画假柱子。 */
  await scene(browser, {
    file: 'timeline-empty.png',
    width: 1440,
    query: 'state=default&empty=1',
    assert: {
      contains: [{ selector: '.tl-track' }, { selector: '.tl-activity' }, { selector: '.tl-lanes' }],
      count: [
        { selector: '.tl-bar', equals: 0 },
        { selector: '.tl-lane-bar', equals: 0 },
        { selector: '.tl-scale-tick', equals: 3 },
        { selector: '[data-playhead-label]', equals: 1 },
      ],
      expr: [
        ...NO_COPY.expr,
        {
          label: 'empty-flag',
          code: '(function(){var el=document.querySelector(".tl-timeline");return el?el.getAttribute("data-empty"):null})()',
          equals: 'true',
        },
        {
          label: 'no-nan-in-dom',
          code:
            '(function(){var el=document.querySelector("[data-region=\'timeline\']");if(!el)return "missing";' +
            'var t=el.innerHTML;return ["NaN","undefined","Infinity"].filter(function(s){return t.indexOf(s)>=0}).join("|")})()',
          equals: '',
        },
      ],
      absent: NO_OLD_STRUCTURE.absent,
    },
  })
  /* 7. 产品注入路径（不换样式）：生成物 css.ts 里必须已经是双轨 CSS。
     Lead 手工重建 css.ts 之后这一条才有意义；它同时守住「新 CSS 进得了 bundle」。 */
  await scene(browser, {
    file: 'timeline-product-path.png',
    width: 1440,
    query: 'state=default',
    swapCss: false,
    assert: {
      contains: [{ selector: '.tl-track' }, { selector: '.tl-scale-tick' }, { selector: '.tl-lane-bar' }],
      count: [
        { selector: '.tl-scale-tick', equals: 3 },
        { selector: '[data-playhead-label]', equals: 1 },
      ],
      expr: [
        {
          label: 'product-css-is-dual-track',
          code:
            '(function(){var t=document.querySelector(".tl-scale-tick");var l=document.querySelector(".tl-lane-bar");' +
            'if(!t||!l)return "missing";var ts=getComputedStyle(t),ls=getComputedStyle(l);' +
            'return ts.getPropertyValue("font-size").trim()+"/"+ls.getPropertyValue("border-top-left-radius").trim()})()',
          equals: '11px/4px',
        },
        {
          label: 'product-css-no-old-structure',
          code:
            '(function(){return document.querySelectorAll("[class*=tl-growth], .tl-ticks, .tl-tick, .tl-current").length})()',
          equals: 0,
        },
      ],
      absent: NO_OLD_STRUCTURE.absent,
    },
  })
} finally {
  await browser.close()
}

/* ------------------------------------------------------------------ *
 * 结论与落盘
 * ------------------------------------------------------------------ */

const failed = results.filter((entry) => entry.ok !== true)
const codeMtime = latestCodeMtime()
const fresh = results.every((entry) => entry.png === null || entry.png.mtimeMs >= codeMtime)

log('')
log('=== 汇总 ===')
log('场景数        : ' + results.length)
log('通过          : ' + (results.length - failed.length))
log('失败          : ' + failed.length + (failed.length === 0 ? '' : ' → ' + failed.map((f) => f.label).join(', ')))
log('截图晚于代码  : ' + (fresh ? 'yes' : 'NO（证据过期）'))
log('代码最新 mtime: ' + new Date(codeMtime).toISOString())
log('开始时间      : ' + started.toISOString())

const payload = {
  started: started.toISOString(),
  cssSourceSwap: FRESH_SHEETS,
  results,
  measured,
  interaction,
  afterClick,
  keyStep,
  keyResult,
  keyboardOk,
  clickOk,
  fresh,
  codeMtime: new Date(codeMtime).toISOString(),
}
writeFileSync(
  join(OUT_DIR, 'timeline.txt'),
  ['R12 双轨时间轴 —— 截图 + 断言', '生成: ' + new Date().toISOString(), '', lines.join('\n'), '', '=== 机器可读 ===', JSON.stringify(payload, null, 2)].join('\n'),
  'utf8',
)
writeFileSync(join(OUT_DIR, 'timeline.json'), JSON.stringify(payload, null, 2), 'utf8')

const allOk = failed.length === 0 && keyboardOk && clickOk && fresh
console.log('')
console.log(allOk ? 'R12 RESULT: PASS' : 'R12 RESULT: FAIL')
process.exit(allOk ? 0 : 1)
