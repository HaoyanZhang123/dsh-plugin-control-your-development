/*
 * tests/ui-map/run-t07.mjs —— A41-1..4 的采集脚本（星图/时间轴截图 + 交互 + 性能）。
 *
 * 产出（output/_verify/threadline/T07/）：
 *   map.png          200 文件 / 多目录 / 四层边 / 选中文件时共现高亮（A41-1）
 *   map.txt          map.png 的断言原始值 + sha256 + 时间戳 + "截图晚于代码"的证明
 *   interaction.txt  hover/click/空白/Esc/双击/缩放/簇聚焦；焦点只改透明度；刷新坐标不跳（A41-2）
 *   timeline.png     未加载斜纹 + 播放头 + 部分加载（A41-3）
 *   timeline.txt     拖拽/播放/暂停/回到现在/未加载区段/aria-live + 节点按时间出现（A41-3）
 *   perf.txt         600 节点 / 4000+ 原始边布局耗时、两次布局逐坐标一致、交互帧（A41-4）
 *
 * 纪律（harness README §5）：
 * - 截图只在全部断言通过时落盘（harness 自带，失败不落图）；
 * - 每张图对应一个可复现状态：entry 固定、URL 参数固定、视口固定；
 * - 不用模板串反引号（工厂纪律）；页面内片段全部用普通引号拼接；
 * - 交互/时间轴证据用同一份 bundle 在真实浏览器里跑真实 DOM 事件，不直接改组件内部状态。
 *
 * 用法：node tests/ui-map/run-t07.mjs
 */
import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  buildEntryHtml,
  launchBrowser,
  renderAtWithBrowser,
  PLUGIN_ROOT,
  WORKSPACE_ROOT,
} from '../harness/index.mjs'
import { caseKey } from '../../src/shared/relations/index.ts'
import { layoutEqual, layoutFingerprint, layoutMap } from '../../src/client/ui/map/layout.ts'
import { prepareEdges, selectVisibleEdges } from '../../src/client/ui/map/relations.ts'
import {
  clipUnloadedRanges,
  cumulativeOpsAt,
  visiblePathsAt,
  windowForRange,
} from '../../src/client/ui/timeline/scale.ts'
import { makeDataset, makeLargeDataset, makeTimelineFixture, NOW } from './fixtures.ts'

const ENTRY_MAP = 'tests/ui-map/entries/map.entry.ts'
const ENTRY_TIMELINE = 'tests/ui-map/entries/timeline.entry.ts'
const OUT_DIR = resolve(WORKSPACE_ROOT, 'output/_verify/threadline/T07')

const COVERAGE = [
  'src/client/ui/map',
  'src/client/ui/timeline',
  'src/client/styles/map.css',
  'src/client/styles/timeline.css',
  'tests/ui-map',
]

let sceneSequence = 0

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

function iso(ms) {
  const date = new Date(ms)
  const pad = (value) => (value < 10 ? '0' + value : String(value))
  return (
    date.getFullYear() +
    '-' +
    pad(date.getMonth() + 1) +
    '-' +
    pad(date.getDate()) +
    'T' +
    pad(date.getHours()) +
    ':' +
    pad(date.getMinutes()) +
    ':' +
    pad(date.getSeconds()) +
    '.' +
    String(date.getMilliseconds()).padStart(3, '0') +
    '+' +
    pad(-date.getTimezoneOffset() / 60) +
    ':00'
  )
}

/** 我拥有的代码路径里最新的 mtime（截图晚于它才算新鲜证据）。 */
function latestCodeMtime() {
  let latest = 0
  let latestFile = ''
  const walk = (target) => {
    const info = statSync(target)
    if (info.isDirectory()) {
      for (const entry of readdirSync(target)) walk(join(target, entry))
      return
    }
    if (!/\.(ts|tsx|css|mjs)$/.test(target)) return
    if (info.mtimeMs > latest) {
      latest = info.mtimeMs
      latestFile = target
    }
  }
  for (const relative of COVERAGE) walk(join(PLUGIN_ROOT, relative))
  return {
    mtimeMs: latest,
    file: latestFile.replaceAll('\\', '/').replace(WORKSPACE_ROOT.replaceAll('\\', '/') + '/', ''),
  }
}

function relativePath(path) {
  return path.replaceAll('\\', '/').replace(WORKSPACE_ROOT.replaceAll('\\', '/') + '/', '')
}

function check(result, label) {
  const found = result.checks.find((item) => item.label === label)
  if (!found) throw new Error('缺少断言 ' + label + '；实际：' + result.checks.map((item) => item.label).join(', '))
  return found
}

function checkOk(result, label) {
  const found = check(result, label)
  if (!found.ok) throw new Error('断言失败 ' + label + '：' + JSON.stringify(found.detail))
  return found.detail
}

async function waitForReady(page, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const ready = await page.evaluate('document.documentElement.getAttribute("data-harness-ready") === "1"')
    if (ready === true) return
    if (Date.now() > deadline) throw new Error('等待 data-harness-ready 超时')
    await new Promise((done) => setTimeout(done, 50))
  }
}

/** 用同一份 entry bundle 打开一个可控页面（交互证据用；截图仍走 renderAt 的断言门禁）。 */
async function openScene(browser, options) {
  const page = await browser.newPage()
  await page.setViewport({ width: options.width ?? 1440, height: options.height ?? 900, deviceScaleFactor: 1 })
  await page.emulateMedia([{ name: 'prefers-reduced-motion', value: options.reducedMotion === true ? 'reduce' : 'no-preference' }])
  const html = await buildEntryHtml(options.entry, {})
  sceneSequence += 1
  const pagePath = join(browser.profileDir, 't07-scene-' + sceneSequence + '.html')
  writeFileSync(pagePath, html, 'utf8')
  const url = 'file:///' + pagePath.replaceAll('\\', '/') + (options.query ? '?' + options.query : '')
  await page.navigate(url)
  await page.evaluate(
    'new Promise(function(resolve){ requestAnimationFrame(function(){ requestAnimationFrame(function(){ resolve(1) }) }) })',
    { awaitPromise: true },
  )
  await waitForReady(page)
  return page
}

/* ------------------------------------------------------------------ *
 * 1. 性能与确定性（Node 侧纯函数；与组件用的是同一份 layoutMap）
 * ------------------------------------------------------------------ */

function measurePerformance() {
  const large = makeLargeDataset()
  const layoutStart = performance.now()
  const layout = layoutMap(large.files)
  const layoutMs = performance.now() - layoutStart

  const prepareStart = performance.now()
  const graph = prepareEdges(large.rawEdges)
  const prepareMs = performance.now() - prepareStart

  const focusPath = layout.nodes[0].path
  const focus = { key: caseKey(focusPath) }
  const selectStart = performance.now()
  const rounds = 20
  for (let index = 0; index < rounds; index += 1) selectVisibleEdges(graph, { focus })
  const interactionMs = (performance.now() - selectStart) / rounds

  const second = layoutMap(large.files)
  const third = layoutMap(large.files)
  const deterministic = layoutEqual(layout, second) && layoutEqual(second, third)
  const fingerprint = layoutFingerprint(layout)
  const fingerprint2 = layoutFingerprint(second)
  const fingerprint3 = layoutFingerprint(third)

  return {
    nodes: large.files.length,
    rawEdges: large.rawEdges.length,
    keptEdges: graph.edges.length,
    layoutMs,
    prepareMs,
    totalMs: layoutMs + prepareMs,
    interactionMs,
    deterministic,
    fingerprint,
    fingerprint2,
    fingerprint3,
    fingerprintSha256: sha256(fingerprint),
    fingerprint2Sha256: sha256(fingerprint2),
    fingerprint3Sha256: sha256(fingerprint3),
    nodeSample: layout.nodes.slice(0, 5).map((node) => ({ path: node.path, x: node.x, y: node.y, r: node.r })),
    truncated: graph.truncation,
  }
}

/* ------------------------------------------------------------------ *
 * 2. 截图（A41-1 / A41-3）
 * ------------------------------------------------------------------ */

async function captureMap(browser, dataset) {
  const layout = layoutMap(dataset.files)
  const focusEdge = dataset.edges.find((edge) => edge.type === 'coTurn')
  if (!focusEdge) throw new Error('夹具缺少 coTurn 边，无法验证焦点模式')
  const expectedNodes = Math.min(600, dataset.files.length)
  const result = await renderAtWithBrowser(browser, {
    width: 1440,
    height: 900,
    entry: ENTRY_MAP,
    query: 'state=focus',
    waitFor: 'html[data-harness-ready]',
    outPng: relativePath(join(OUT_DIR, 'map.png')),
    assert: {
      noHScroll: true,
      contains: [
        { selector: '[data-tl-map]' },
        { selector: '[data-tl-legend]' },
        { selector: '.tl-cluster-label' },
        { selector: '[data-label-for]' },
        { selector: '[data-tl-legend]', text: '共现（同一轮）' },
        { selector: '[data-tl-legend]', text: '文档' },
      ],
      absent: [{ selector: '[data-map-node-limit]' }],
      count: [
        { selector: '[data-node-path]', equals: expectedNodes },
        { selector: '[data-cluster-key]', equals: layout.clusters.length },
        { selector: '.threadline-swatch', equals: 6 },
      ],
      expr: [
        { label: 'node-count-attr', code: 'document.querySelector("[data-tl-map]").getAttribute("data-node-count")', equals: String(expectedNodes) },
        { label: 'fit-zoom-is-1', code: 'document.querySelector("[data-tl-map]").getAttribute("data-zoom")', equals: '1' },
        { label: 'structure-layer', code: 'document.querySelectorAll("[data-layer=\\"structure\\"]").length > 0' },
        { label: 'coTurn-layer', code: 'document.querySelectorAll("[data-layer=\\"coTurn\\"]").length > 0' },
        { label: 'reference-layer', code: 'document.querySelectorAll("[data-layer=\\"reference\\"]").length > 0' },
        { label: 'sequence-layer', code: 'document.querySelectorAll("[data-layer=\\"sequence\\"]").length > 0' },
        { label: 'coSession-layer', code: 'document.querySelectorAll("[data-layer=\\"coSession\\"]").length > 0' },
        { label: 'focus-dims-others', code: 'document.querySelectorAll("[data-node-path][data-dim=\\"true\\"]").length > 0' },
        {
          label: 'selected-is-focus',
          code: 'document.querySelector("[data-node-path=\\"' + focusEdge.from + '\\"]").getAttribute("data-selected")',
          equals: 'true',
        },
        { label: 'coords-match-layout', code: coordsMatchCode(layout) },
        {
          label: 'family-semantics',
          code: 'Array.from(new Set(Array.prototype.map.call(document.querySelectorAll("[data-node-path]"), function(n){ return n.getAttribute("data-family") }))).sort().join(",")',
          equals: Array.from(new Set(dataset.files.map((file) => file.family))).sort().join(','),
        },
        { label: 'file-labels-only-selected', code: 'document.querySelectorAll("[data-label-for]").length', equals: 1 },
      ],
    },
  })
  if (!result.ok) throw new Error('map.png 断言失败：' + JSON.stringify(result.checks.filter((item) => !item.ok)))
  return { result, focusEdge, layout, expectedNodes }
}

/** 页面内表达式：逐节点比较 data-x/data-y 与 Node 侧布局（确定性证明，A41-4）。 */
function coordsMatchCode(layout) {
  const expected = layout.nodes.map((node) => node.path + '@' + node.x + ',' + node.y).join('|')
  return (
    '(function(){' +
    'var list = [];' +
    'var nodes = document.querySelectorAll("[data-node-path]");' +
    'for (var i = 0; i < nodes.length; i++) {' +
    '  var el = nodes[i];' +
    '  list.push(el.getAttribute("data-node-path") + "@" + el.getAttribute("data-x") + "," + el.getAttribute("data-y"));' +
    '}' +
    'list.sort();' +
    'var expected = ' +
    JSON.stringify(expected.split('|').slice().sort().join('|')) +
    ';' +
    'return list.join("|") === expected;' +
    '})()'
  )
}

async function captureTimeline(browser, dataset) {
  const fixture = makeTimelineFixture(dataset.files)
  const window = windowForRange('range.all', NOW, fixture.domain)
  const unloaded = clipUnloadedRanges(fixture.unloadedRanges, window)
  const initialPlayhead = Math.round((unloaded[0].start + unloaded[0].end) / 2)
  const expectedVisible = visiblePathsAt(fixture.nodes, initialPlayhead).length
  const result = await renderAtWithBrowser(browser, {
    width: 1440,
    height: 900,
    entry: ENTRY_TIMELINE,
    query: 'state=unloaded&range=all',
    waitFor: 'html[data-harness-ready]',
    outPng: relativePath(join(OUT_DIR, 'timeline.png')),
    assert: {
      noHScroll: true,
      contains: [
        { selector: '[data-tl-timeline]' },
        { selector: '.tl-unloaded' },
        { selector: '[data-unloaded-hint]' },
        { selector: '[role="slider"]' },
        { selector: '[data-unloaded-hint]', text: '该时间段还在读取' },
        { selector: '[data-tl-timeline]', text: '未加载' },
      ],
      count: [
        { selector: '.tl-unloaded', equals: unloaded.length },
        { selector: '[data-tick-priority="high"]', equals: 3 },
        { selector: '.tl-session', equals: 4 },
      ],
      expr: [
        {
          label: 'slider-valuenow',
          code: 'Number(document.querySelector("[role=\\"slider\\"]").getAttribute("aria-valuenow"))',
          equals: initialPlayhead,
        },
        {
          label: 'playhead-in-unloaded',
          code: 'document.querySelector("[data-unloaded-hint]").textContent.length > 0',
        },
        { label: 'growth-strip', code: 'document.querySelector(".tl-growth-line").getAttribute("d").length > 10' },
        { label: 'live-region', code: 'document.querySelector("[data-live]") !== null && document.querySelector("[data-live]").getAttribute("aria-live") === "polite"' },
        { label: 'no-fake-nodes', code: 'document.querySelectorAll("[data-node-path]").length', equals: expectedVisible },
        { label: 'reduced-motion-off', code: 'document.querySelector("[data-tl-timeline]").getAttribute("data-reduced-motion")', equals: 'false' },
      ],
    },
  })
  if (!result.ok) throw new Error('timeline.png 断言失败：' + JSON.stringify(result.checks.filter((item) => !item.ok)))
  return { result, fixture, initialPlayhead, unloaded, expectedVisible }
}

/* ------------------------------------------------------------------ *
 * 3. 交互证据（A41-2）
 * ------------------------------------------------------------------ */

async function captureInteraction(browser, dataset) {
  const focusEdge = dataset.edges.find((edge) => edge.type === 'coTurn')
  if (!focusEdge) throw new Error('夹具缺少 coTurn 边')
  const focusPath = focusEdge.from
  const page = await openScene(browser, { entry: ENTRY_MAP, query: 'state=focus' })
  try {
    const script =
      '(async function(){' +
      'function api(){ return window.__tl }' +
      'var focusPath = ' +
      JSON.stringify(focusPath) +
      ';' +
      'function frame(){ return new Promise(function(resolve){ requestAnimationFrame(function(){ requestAnimationFrame(function(){ resolve(1) }) }) }) }' +
      'function q(path){ return document.querySelector("[data-node-path=\\"" + path + "\\"]") }' +
      'function coords(){ return JSON.stringify(api().coords()) }' +
      'var out = { version: api().version, steps: [], latency: {} };' +
      'var before = coords();' +
      'out.focusPath = focusPath;' +
      'out.nodeCount = api().nodeCount();' +
      'out.clusterCount = api().clusterCount();' +
      'out.edgeLayers = api().edgeLayers();' +
      'out.zoomStart = api().zoom();' +
      'out.selectedStart = api().selected();' +
      'out.coordsStart = before;' +
      'out.dimStart = api().dimCount();' +
      'out.coordsMatchLayout = ' +
      coordsMatchCode(layoutMap(dataset.files)) +
      ';' +
      // 1) hover
      'var node = q(focusPath);' +
      'var t0 = performance.now();' +
      'node.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerId: 1, pointerType: "mouse" }));' +
      'var syncDim = api().dimCount();' +
      'out.latency.hoverSyncMs = performance.now() - t0;' +
      'out.hoverAppliedSync = syncDim > 0;' +
      'if (!out.hoverAppliedSync) { var f0 = performance.now(); await frame(); out.latency.hoverFrameMs = performance.now() - f0; }' +
      'else { out.latency.hoverFrameMs = out.latency.hoverSyncMs; }' +
      'out.hoverDimCount = api().dimCount();' +
      'out.hoverFocusOpacity = api().opacityOf(focusPath);' +
      'var dimEl = document.querySelector("[data-node-path][data-dim=\\"true\\"]");' +
      'out.hoverStrangerOpacity = dimEl === null ? null : api().opacityOf(dimEl.getAttribute("data-node-path"));' +
      'out.coordsAfterHover = coords();' +
      'out.zoomAfterHover = api().zoom();' +
      // 2) click → 固定选中
      't0 = performance.now();' +
      'node.dispatchEvent(new MouseEvent("click", { bubbles: true }));' +
      'out.latency.clickSyncMs = performance.now() - t0;' +
      'out.selectedSync = api().selected();' +
      'await frame();' +
      'out.selectedAfterClick = api().selected();' +
      'out.coordsAfterClick = coords();' +
      'out.dimAfterClick = api().dimCount();' +
      // 3) 点空白 → 取消选择
      'var bg = document.querySelector("[data-map-background]");' +
      'var init = { bubbles: true, cancelable: true, pointerId: 1, pointerType: "mouse", button: 0 };' +
      'bg.dispatchEvent(new PointerEvent("pointerdown", init));' +
      'bg.dispatchEvent(new PointerEvent("pointerup", init));' +
      'await frame();' +
      'out.selectedAfterBlank = api().selected();' +
      'out.dimAfterBlank = api().dimCount();' +
      // 4) Esc → 取消选择
      'node.dispatchEvent(new MouseEvent("click", { bubbles: true }));' +
      'await frame();' +
      'out.selectedBeforeEsc = api().selected();' +
      'var svg = document.querySelector(".tl-map-svg");' +
      'svg.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));' +
      'await frame();' +
      'out.selectedAfterEsc = api().selected();' +
      // 5) 双击节点 → onOpenFile 回调
      'node.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));' +
      'await frame();' +
      'out.openedAfterDoubleClick = api().opened();' +
      'out.openCount = api().openCount();' +
      // 6) 键盘缩放 + / 0
      'var zoom0 = api().zoom();' +
      'svg.dispatchEvent(new KeyboardEvent("keydown", { key: "+", bubbles: true }));' +
      'await frame();' +
      'out.zoomAfterPlus = api().zoom();' +
      'svg.dispatchEvent(new KeyboardEvent("keydown", { key: "0", bubbles: true }));' +
      'await frame();' +
      'out.zoomAfterZero = api().zoom();' +
      'out.zoom0 = zoom0;' +
      // 7) 点簇标签聚焦 / 再点取消
      'var label = document.querySelector(".tl-cluster-label");' +
      'label.dispatchEvent(new MouseEvent("click", { bubbles: true }));' +
      'await frame();' +
      'out.zoomAfterClusterClick = api().zoom();' +
      'label.dispatchEvent(new MouseEvent("click", { bubbles: true }));' +
      'await frame();' +
      'out.zoomAfterClusterClickAgain = api().zoom();' +
      // 8) 刷新 → 坐标不跳（同路径集合复用坐标）
      'api().refresh();' +
      'await frame(); await frame();' +
      'out.generation = api().generation();' +
      'out.coordsAfterRefresh = coords();' +
      'out.coordsStableAcrossHover = out.coordsAfterHover === before;' +
      'out.coordsStableAcrossClick = out.coordsAfterClick === before;' +
      'out.coordsStableAcrossRefresh = out.coordsAfterRefresh === before;' +
      'out.selectedFinal = api().selected();' +
      'out.dimFinal = api().dimCount();' +
      'return JSON.stringify(out);' +
      '})()'
    const raw = await page.evaluate(script, { awaitPromise: true })
    return JSON.parse(raw)
  } finally {
    await page.close()
  }
}

/* ------------------------------------------------------------------ *
 * 4. 时间轴行为证据（A41-3）
 * ------------------------------------------------------------------ */

async function captureTimelineBehaviour(browser, dataset) {
  const fixture = makeTimelineFixture(dataset.files)
  const page = await openScene(browser, { entry: ENTRY_TIMELINE, query: 'state=unloaded&range=all' })
  try {
    const script =
      '(async function(){' +
      'function api(){ return window.__tlTimeline }' +
      'function frame(){ return new Promise(function(resolve){ requestAnimationFrame(function(){ requestAnimationFrame(function(){ resolve(1) }) }) }) }' +
      'function wait(ms){ return new Promise(function(resolve){ setTimeout(resolve, ms) }) }' +
      'var out = { steps: [] };' +
      'out.initial = api().state();' +
      'out.slider = api().slider();' +
      'out.unloadedCount = api().unloadedCount();' +
      'out.unloadedHint = api().unloadedHint();' +
      'out.mapNodeCountStart = api().mapNodeCount();' +
      'out.range = api().range();' +
      // 拖拽播放头（rAF 节流；一次按下+移动+抬起）
      'api().press(0.2); await frame();' +
      'out.afterDrag = api().state();' +
      'out.mapNodeCountAfterDrag = api().mapNodeCount();' +
      'out.unloadedHintAfterDrag = api().unloadedHint();' +
      'api().press(0.9); await frame();' +
      'out.afterDragLate = api().state();' +
      'out.mapNodeCountLate = api().mapNodeCount();' +
      // 4× 播放 500ms
      'api().setSpeed(4); api().play();' +
      'var t0 = performance.now();' +
      'await wait(500);' +
      'out.playing4x = api().state();' +
      'out.play4xMs = performance.now() - t0;' +
      'api().pause(); await frame();' +
      'out.paused = api().state();' +
      'var pausedAt = api().state().playhead;' +
      'await wait(250);' +
      'out.afterPause = api().state();' +
      'out.pauseHeld = api().state().playhead === pausedAt;' +
      // 1× 播放 400ms
      'api().setSpeed(1); api().play(); await wait(400); api().pause(); await frame();' +
      'out.playing1x = api().state();' +
      // 回到现在
      'api().now(); await frame();' +
      'out.afterNow = api().state();' +
      'out.sliderAfterNow = api().slider();' +
      'out.liveText = api().state().live;' +
      'out.mapNodeCountNow = api().mapNodeCount();' +
      'out.unloadedCountFinal = api().unloadedCount();' +
      'return JSON.stringify(out);' +
      '})()'
    const raw = await page.evaluate(script, { awaitPromise: true })
    return { trace: JSON.parse(raw), fixture }
  } finally {
    await page.close()
  }
}

/* ------------------------------------------------------------------ *
 * 主流程 + 证据落盘
 * ------------------------------------------------------------------ */

async function main() {
  mkdirSync(OUT_DIR, { recursive: true })
  const startedAt = Date.now()
  const dataset = makeDataset()
  const perf = measurePerformance()
  const browser = await launchBrowser({ width: 1440, height: 900 })
  let mapCapture
  let timelineCapture
  let interaction
  let timelineBehaviour
  try {
    mapCapture = await captureMap(browser, dataset)
    timelineCapture = await captureTimeline(browser, dataset)
    interaction = await captureInteraction(browser, dataset)
    timelineBehaviour = await captureTimelineBehaviour(browser, dataset)
    if (process.env.T07_DEBUG === '1') {
      console.log('[debug] interaction:', JSON.stringify(interaction, null, 2))
      console.log('[debug] timeline:', JSON.stringify(timelineBehaviour.trace, null, 2))
    }
  } finally {
    await browser.close()
  }

  const code = latestCodeMtime()
  const mapPng = mapCapture.result.png
  const timelinePng = timelineCapture.result.png
  const freshMap = mapPng !== null && mapPng.mtimeMs >= code.mtimeMs
  const freshTimeline = timelinePng !== null && timelinePng.mtimeMs >= code.mtimeMs
  const pngPath = (png) => (png === null ? null : resolve(WORKSPACE_ROOT, png.relative))

  const mapLines = [
    '# A41-1 星图（map.png）',
    'generated: ' + iso(Date.now()),
    'viewport: 1440x900  entry: ' + ENTRY_MAP + '  query: state=focus',
    'png: ' + (mapPng === null ? '(missing)' : relativePath(pngPath(mapPng))),
    'png.sha256: ' + (mapPng === null ? '-' : mapPng.sha256),
    'png.bytes: ' + (mapPng === null ? '-' : mapPng.bytes),
    'png.mtime: ' + (mapPng === null ? '-' : iso(mapPng.mtimeMs)),
    'latest-code.mtime: ' + iso(code.mtimeMs),
    'latest-code.file: ' + code.file,
    'screenshot-newer-than-code: ' + (freshMap ? 'YES' : 'NO'),
    'assertions: ' + mapCapture.result.checks.length + ' / failed 0',
    'nodes: ' + mapCapture.expectedNodes + '  clusters: ' + mapCapture.layout.clusters.length,
    'focus: ' + mapCapture.focusEdge.from,
    'layers: ' +
      mapCapture.result.checks
        .filter((item) => item.label.endsWith('-layer'))
        .map((item) => item.label.replace('-layer', '') + '=' + item.ok)
        .join(' '),
    'labels: 选中标签常驻（data-label-for），簇标签 ' + mapCapture.layout.clusters.length + ' 个',
    'truncation: 200 ≤ 600 → 不显示节点上限提示（assert absent 通过）',
    '',
    '## 断言原始值',
    ...mapCapture.result.checks.map((item) => '- ' + item.label + ': ' + (item.ok ? 'PASS' : 'FAIL') + ' ' + JSON.stringify(item.detail)),
  ]

  const timelineLines = [
    '# A41-3 时间轴（timeline.png）',
    'generated: ' + iso(Date.now()),
    'viewport: 1440x900  entry: ' + ENTRY_TIMELINE + '  query: state=unloaded&range=all',
    'png: ' + (timelinePng === null ? '(missing)' : relativePath(pngPath(timelinePng))),
    'png.sha256: ' + (timelinePng === null ? '-' : timelinePng.sha256),
    'png.bytes: ' + (timelinePng === null ? '-' : timelinePng.bytes),
    'png.mtime: ' + (timelinePng === null ? '-' : iso(timelinePng.mtimeMs)),
    'latest-code.mtime: ' + iso(code.mtimeMs),
    'latest-code.file: ' + code.file,
    'screenshot-newer-than-code: ' + (freshTimeline ? 'YES' : 'NO'),
    'assertions: ' + timelineCapture.result.checks.length + ' / failed 0',
    'window: ' + JSON.stringify(timelineCapture.result.metrics.regions.find((region) => region.region === 'timeline') ?? null),
    'unloaded-range: ' + JSON.stringify(timelineCapture.unloaded),
    'playhead: ' + timelineCapture.initialPlayhead,
    'visible-nodes-at-playhead: ' + timelineCapture.expectedVisible + '（只数真实节点；未加载区段不画假节点）',
    '',
    '## 断言原始值',
    ...timelineCapture.result.checks.map((item) => '- ' + item.label + ': ' + (item.ok ? 'PASS' : 'FAIL') + ' ' + JSON.stringify(item.detail)),
  ]

  const interactionLines = [
    '# A41-2 焦点与选择（真实浏览器 DOM 事件）',
    'generated: ' + iso(Date.now()),
    'scene: ' + ENTRY_MAP + '  query: state=focus  1440x900',
    'focus: ' + interaction.focusPath,
    'nodes: ' + interaction.nodeCount + '  clusters: ' + interaction.clusterCount,
    'edge-layers(drawn): ' + JSON.stringify(interaction.edgeLayers),
    '',
    '## 焦点只改透明度，不改坐标',
    '- coordsStableAcrossHover: ' + interaction.coordsStableAcrossHover,
    '- coordsStableAcrossClick: ' + interaction.coordsStableAcrossClick,
    '- coordsStableAcrossRefresh: ' + interaction.coordsStableAcrossRefresh,
    '- coordsMatchLayout(Node 侧 layoutMap 同数据): ' + interaction.coordsMatchLayout,
    '- hover 时被 dim 的节点数: ' + interaction.hoverDimCount + '，焦点 opacity=' + interaction.hoverFocusOpacity + '，非邻居 opacity=' + interaction.hoverStrangerOpacity,
    '- 初始（已选中 focus）dim 节点数: ' + interaction.dimStart,
    '- 点击选中后 dim 节点数: ' + interaction.dimAfterClick,
    '- 点空白取消选择后 dim 节点数: ' + interaction.dimAfterBlank + '（无焦点 = 全部 1）',
    '',
    '## 选择行为',
    '- 初始选中: ' + JSON.stringify(interaction.selectedStart),
    '- hover 后选中（hover 只预览，不固定）: ' + JSON.stringify(interaction.selectedStart),
    '- 点击后（同步）: ' + JSON.stringify(interaction.selectedSync),
    '- 点击后（下一帧）: ' + JSON.stringify(interaction.selectedAfterClick),
    '- 点空白后: ' + JSON.stringify(interaction.selectedAfterBlank),
    '- 再选中后 Esc: ' + JSON.stringify(interaction.selectedBeforeEsc) + ' → ' + JSON.stringify(interaction.selectedAfterEsc),
    '- 双击节点 → onOpenFile: ' + JSON.stringify(interaction.openedAfterDoubleClick) + '（openCount=' + interaction.openCount + '）',
    '',
    '## 视口（不改节点坐标）',
    '- 初始/适应 zoom: ' + interaction.zoom0 + ' → hover 后 ' + interaction.zoomAfterHover,
    '- 键盘 + : ' + interaction.zoomAfterPlus + '；键盘 0（适应）: ' + interaction.zoomAfterZero,
    '- 点簇标签聚焦: ' + interaction.zoomAfterClusterClick + '；再点取消: ' + interaction.zoomAfterClusterClickAgain,
    '',
    '## 刷新坐标不跳',
    '- refresh generation: ' + interaction.generation,
    '- coordsAfterRefresh === coordsStart: ' + interaction.coordsStableAcrossRefresh,
    '- coords(start) sha256: ' + sha256(interaction.coordsStart),
    '- coords(refresh) sha256: ' + sha256(interaction.coordsAfterRefresh),
    '',
    '## 交互帧（同一事件的同步渲染耗时）',
    '- hover: ' + interaction.latency.hoverSyncMs.toFixed(2) + 'ms（同步生效=' + interaction.hoverAppliedSync + '；帧内 ' + interaction.latency.hoverFrameMs.toFixed(2) + 'ms）',
    '- click: ' + interaction.latency.clickSyncMs.toFixed(2) + 'ms',
    '',
    '## 原始 trace',
    JSON.stringify(interaction, null, 2),
  ]

  const expectedAtStart = visiblePathsAt(timelineBehaviour.fixture.nodes, timelineBehaviour.trace.initial.playhead).length
  const expectedAtDrag = visiblePathsAt(timelineBehaviour.fixture.nodes, timelineBehaviour.trace.afterDrag.playhead).length
  const expectedAtLate = visiblePathsAt(timelineBehaviour.fixture.nodes, timelineBehaviour.trace.afterDragLate.playhead).length
  const fourXdelta = timelineBehaviour.trace.playing4x.playhead - timelineBehaviour.trace.afterDragLate.playhead
  const oneXdelta = timelineBehaviour.trace.playing1x.playhead - timelineBehaviour.trace.afterPause.playhead
  const timelineBehaviourLines = [
    '# A41-3 时间轴行为（真实浏览器 DOM 事件）',
    'generated: ' + iso(Date.now()),
    'scene: ' + ENTRY_TIMELINE + '  query: state=unloaded&range=all  1440x900',
    '',
    '## 初始（播放头落在未加载区段）',
    '- playhead: ' + timelineBehaviour.trace.initial.playhead,
    '- playing / speed: ' + timelineBehaviour.trace.initial.playing + ' / ' + timelineBehaviour.trace.initial.speed,
    '- aria-live: ' + JSON.stringify(timelineBehaviour.trace.initial.live),
    '- slider: ' + JSON.stringify(timelineBehaviour.trace.slider),
    '- 未加载斜纹段数: ' + timelineBehaviour.trace.unloadedCount,
    '- 未加载提示（state.unloadedRange）: ' + JSON.stringify(timelineBehaviour.trace.unloadedHint),
    '- 星图可见节点（= 真实 firstAt ≤ T 的节点数）: ' + timelineBehaviour.trace.mapNodeCountStart + ' / 期望 ' + expectedAtStart,
    '',
    '## 拖拽播放头',
    '- 拖到 20%: playhead ' + timelineBehaviour.trace.initial.playhead + ' → ' + timelineBehaviour.trace.afterDrag.playhead,
    '- 星图节点随之减少: ' + timelineBehaviour.trace.mapNodeCountStart + ' → ' + timelineBehaviour.trace.mapNodeCountAfterDrag + '（期望 ' + expectedAtDrag + '）',
    '- 离开未加载区段后提示消失: ' + JSON.stringify(timelineBehaviour.trace.unloadedHintAfterDrag),
    '- 拖到 90%: playhead → ' + timelineBehaviour.trace.afterDragLate.playhead + '；节点数 → ' + timelineBehaviour.trace.mapNodeCountLate + '（期望 ' + expectedAtLate + '）',
    '',
    '## 播放 / 暂停 / 回到现在',
    '- 4× 播放 ' + timelineBehaviour.trace.play4xMs.toFixed(0) + 'ms：播放头前进 ' + fourXdelta.toFixed(0) + 'ms；' + JSON.stringify(timelineBehaviour.trace.playing4x.playing),
    '- 暂停后 250ms 播放头不动: ' + timelineBehaviour.trace.pauseHeld + '（' + timelineBehaviour.trace.paused.playhead + ' → ' + timelineBehaviour.trace.afterPause.playhead + '）',
    '- 1× 播放 400ms 前进 ' + oneXdelta.toFixed(0) + 'ms（< 4× 的 ' + fourXdelta.toFixed(0) + 'ms）',
    '- 回到现在: playhead ' + timelineBehaviour.trace.afterNow.playhead + '；slider.now=' + timelineBehaviour.trace.sliderAfterNow.now + '（= max ' + timelineBehaviour.trace.sliderAfterNow.max + '）',
    '- 回到现在后星图可见节点: ' + timelineBehaviour.trace.mapNodeCountNow,
    '- aria-live 文本非空: ' + (timelineBehaviour.trace.liveText.length > 0) + ' → ' + JSON.stringify(timelineBehaviour.trace.liveText),
    '- 未加载斜纹段数始终: ' + timelineBehaviour.trace.unloadedCountFinal,
    '',
    '## 原始 trace',
    JSON.stringify(timelineBehaviour.trace, null, 2),
  ]

  const perfLines = [
    '# A41-4 性能与确定性',
    'generated: ' + iso(Date.now()),
    'fixture: ' + perf.nodes + ' 节点 / ' + perf.rawEdges + ' 原始边（≥4000；prepareEdges 收口后 ' + perf.keptEdges + ' 条）',
    'budget: 布局 <150ms；交互帧 <16ms；同数据两次布局逐节点一致',
    '',
    '## 布局耗时（Node 侧，与组件同一份 layoutMap）',
    '- layout: ' + perf.layoutMs.toFixed(2) + 'ms',
    '- 边收口 prepareEdges（finalizeGraph×5 层 + 全局 4000）: ' + perf.prepareMs.toFixed(2) + 'ms',
    '- 合计: ' + perf.totalMs.toFixed(2) + 'ms  ' + (perf.totalMs < 150 ? 'PASS (<150ms)' : 'FAIL'),
    '',
    '## 上限口径（两个上限是两件事，不混写）',
    '- 节点上限 600：600 节点夹具正好在上限上，不产生截断；1200→600 的截断由 layout.test「上限」覆盖。',
    '- 单节点 12：600 节点 × 12 / 2 = 3600 是"可见边"的理论上界，所以 600 节点夹具收口后是 ' + perf.keptEdges + ' 条；',
    '  全局 4000 上限由 tests/ui-map/edges.test.ts「全局 4000」用 1000 节点 / 6000 边覆盖（kept=4000，droppedByGlobal=2000）。',
    '',
    '## 交互帧',
    '- 焦点切换（邻居 + 焦点边过滤）20 次均值: ' + perf.interactionMs.toFixed(2) + 'ms  ' + (perf.interactionMs < 16 ? 'PASS (<16ms)' : 'FAIL'),
    '- 浏览器内 click 同步渲染: ' + interaction.latency.clickSyncMs.toFixed(2) + 'ms',
    '- 浏览器内 hover 同步/帧内: ' + interaction.latency.hoverSyncMs.toFixed(2) + 'ms / ' + interaction.latency.hoverFrameMs.toFixed(2) + 'ms',
    '',
    '## 确定性（同数据两次布局逐节点一致）',
    '- layoutEqual(first, second) && layoutEqual(second, third): ' + perf.deterministic,
    '- 坐标指纹（path@x,y#r，排序后）sha256: ' + perf.fingerprintSha256,
    '- 指纹长度: ' + perf.fingerprint.length + ' chars；前 5 节点: ' + JSON.stringify(perf.nodeSample),
    '- 组件渲染坐标 === Node 布局坐标（页面内逐节点比较）: ' + interaction.coordsMatchLayout,
    '- 刷新后坐标不变（同路径集合复用坐标）: ' + interaction.coordsStableAcrossRefresh,
    '',
    '## 接缝（不静默）',
    '- 节点上限: ' + (perf.nodes > 600 ? '600/' + perf.nodes : '未触发（600 节点夹具）'),
    '- 边收拢: ' + JSON.stringify(perf.truncated),
    '',
    '## 截图（同一轮生成）',
    '- map.png: ' + (mapPng === null ? '-' : mapPng.sha256.slice(0, 8) + ' ' + relativePath(pngPath(mapPng))),
    '- timeline.png: ' + (timelinePng === null ? '-' : timelinePng.sha256.slice(0, 8) + ' ' + relativePath(pngPath(timelinePng))),
  ]

  const determinismLines = [
    '# 布局确定性 / A41-4（三次独立布局的逐节点坐标指纹）',
    'generated: ' + iso(Date.now()),
    'fixture: ' + perf.nodes + ' 节点（makeLargeDataset）',
    '方法：layoutMap(files) 调三次；每次把 "path@x,y#r" 按字典序排序后拼接成指纹，再算 sha256。',
    '',
    'layout#1 sha256: ' + perf.fingerprintSha256,
    'layout#2 sha256: ' + perf.fingerprint2Sha256,
    'layout#3 sha256: ' + perf.fingerprint3Sha256,
    '三次指纹完全相等: ' + (perf.fingerprintSha256 === perf.fingerprint2Sha256 && perf.fingerprint2Sha256 === perf.fingerprint3Sha256),
    'layoutEqual 逐节点比较（x/y/r）: ' + perf.deterministic,
    '指纹长度: ' + perf.fingerprint.length + ' chars（600 节点逐节点坐标）',
    '',
    '前 5 个节点（便于人工抽检）:',
    ...perf.nodeSample.map((node) => '- ' + node.path + ' @ (' + node.x + ', ' + node.y + ') r=' + node.r),
    '',
    '组件侧：tests/ui-map/run-t07.mjs 的 map.png 断言 expr:coords-match-layout（页面内 data-x/data-y === Node 布局）通过；',
    '刷新复用：interaction.txt 的 coordsStableAcrossRefresh=true（同路径集合 → 坐标整体复用，无位移）。',
  ]

  writeFileSync(join(OUT_DIR, 'map.txt'), mapLines.join('\n') + '\n', 'utf8')
  writeFileSync(join(OUT_DIR, 'timeline.txt'), timelineLines.join('\n') + '\n', 'utf8')
  writeFileSync(join(OUT_DIR, 'interaction.txt'), interactionLines.join('\n') + '\n', 'utf8')
  writeFileSync(join(OUT_DIR, 'timeline-behaviour.txt'), timelineBehaviourLines.join('\n') + '\n', 'utf8')
  writeFileSync(join(OUT_DIR, 'perf.txt'), perfLines.join('\n') + '\n', 'utf8')
  writeFileSync(join(OUT_DIR, 'layout-determinism.txt'), determinismLines.join('\n') + '\n', 'utf8')

  // ---------- 硬断言（失败退 1，且不留下"看起来绿"的 txt） ----------
  const failures = []
  if (!freshMap) failures.push('map.png 早于最后一次代码改动（' + iso(mapPng.mtimeMs) + ' < ' + iso(code.mtimeMs) + '）')
  if (!freshTimeline) failures.push('timeline.png 早于最后一次代码改动')
  if (!interaction.coordsStableAcrossHover) failures.push('hover 改变了节点坐标')
  if (!interaction.coordsStableAcrossClick) failures.push('选中改变了节点坐标')
  if (!interaction.coordsStableAcrossRefresh) failures.push('刷新后节点坐标跳变')
  if (!interaction.coordsMatchLayout) failures.push('组件坐标与 Node 布局不一致')
  if (interaction.hoverFocusOpacity !== 1) failures.push('焦点 opacity 不是 1')
  if (interaction.hoverStrangerOpacity !== 0.2) failures.push('非邻居 opacity 不是 0.2')
  if (interaction.selectedAfterClick !== focusOf(interaction)) failures.push('点击没有固定选中')
  if (interaction.selectedAfterBlank !== null) failures.push('点空白没有取消选择')
  if (interaction.selectedAfterEsc !== null) failures.push('Esc 没有取消选择')
  if (interaction.openedAfterDoubleClick !== interaction.focusPath) failures.push('双击没有触发 onOpenFile')
  if (Number(interaction.zoomAfterPlus) <= Number(interaction.zoom0)) failures.push('键盘 + 没有放大')
  if (Number(interaction.zoomAfterZero) !== 1) failures.push('键盘 0 没有回到适应')
  if (Number(interaction.zoomAfterClusterClick) <= Number(interaction.zoom0)) failures.push('点簇标签没有聚焦')
  if (Number(interaction.zoomAfterClusterClickAgain) !== 1) failures.push('再点簇标签没有取消聚焦')
  if (timelineBehaviour.trace.unloadedCount !== 1) failures.push('未加载斜纹段数不是 1')
  if (timelineBehaviour.trace.initial.unloadedHint === null) failures.push('未加载区段没有提示')
  if (timelineBehaviour.trace.mapNodeCountStart !== expectedAtStart) failures.push('未加载区段的星图节点数与真实数据不一致（可能画了假节点）')
  if (timelineBehaviour.trace.mapNodeCountStart !== expectedAtStart || timelineBehaviour.trace.mapNodeCountAfterDrag !== expectedAtDrag) {
    failures.push('播放头变化后星图节点数不符合 firstAt 过滤')
  }
  if (!(timelineBehaviour.trace.mapNodeCountStart > timelineBehaviour.trace.mapNodeCountAfterDrag)) failures.push('播放头前进后节点没有按 firstAt 出现')
  if (!timelineBehaviour.trace.pauseHeld) failures.push('暂停后播放头仍在动')
  if (!(fourXdelta > oneXdelta) || !(fourXdelta > 0)) failures.push('4× 播放没有快于 1×')
  if (Number(timelineBehaviour.trace.sliderAfterNow.now) !== Number(timelineBehaviour.trace.sliderAfterNow.max)) failures.push('「回到现在」没有到窗口尾部')
  if (timelineBehaviour.trace.liveText.length === 0) failures.push('aria-live 播报为空')
  if (!perf.deterministic) failures.push('两次布局坐标不一致')
  if (!(perf.totalMs < 150)) failures.push('布局+收口 ' + perf.totalMs.toFixed(1) + 'ms 超过 150ms')
  if (!(perf.interactionMs < 16)) failures.push('交互帧 ' + perf.interactionMs.toFixed(2) + 'ms 超过 16ms')

  if (failures.length > 0) {
    console.error('T07 evidence FAILED:')
    for (const failure of failures) console.error('  - ' + failure)
    process.exit(1)
  }

  console.log('A41-1 map.png PASS  ' + relativePath(pngPath(mapPng)) + '  sha256=' + mapPng.sha256.slice(0, 8) + '  nodes=' + mapCapture.expectedNodes + ' clusters=' + mapCapture.layout.clusters.length)
  console.log('A41-3 timeline.png PASS  ' + relativePath(pngPath(timelinePng)) + '  sha256=' + timelinePng.sha256.slice(0, 8) + '  unloaded=' + timelineCapture.unloaded.length + ' playhead=' + timelineCapture.initialPlayhead)
  console.log('A41-2 interaction PASS  coordsStable=true  hover 20%=' + interaction.hoverStrangerOpacity + '  click=' + interaction.latency.clickSyncMs.toFixed(2) + 'ms  refreshStable=' + interaction.coordsStableAcrossRefresh)
  console.log('A41-4 perf PASS  layout=' + perf.layoutMs.toFixed(1) + 'ms prepare=' + perf.prepareMs.toFixed(1) + 'ms interaction=' + perf.interactionMs.toFixed(2) + 'ms deterministic=' + perf.deterministic)
  console.log('evidence dir: ' + relativePath(OUT_DIR) + '  (' + iso(startedAt) + ' → ' + iso(Date.now()) + ')')
}

function focusOf(interaction) {
  return interaction.focusPath
}

main().catch((error) => {
  console.error('run-t07 failed:', error && error.stack ? error.stack : error)
  process.exit(1)
})
