/*
 * tests/ui-map/run-t07.mjs —— T31 脉络 2.0 版式的截图/断言采集（33 §8）。
 *
 * 产出（默认 output/_verify/threadline/T07/；用 TL_TASK=T31 存到 T31/）：
 *   default.png        1440x900 默认：左文件图（选中目录）+ 右两列卡片 + 左列时间轴/轮次带，无检查器
 *   turn.png           1440x900 点某一轮：图切本轮文件 + 读/写行/首见 + 摘要 + 删除命令
 *   default-1200.png   1200 宽同上
 *   scrolled.png       1440x900 滚到右栏中部：左列 sticky、页面仍只有 shell 一条滚动
 *   narrow.png         900 宽：上下堆叠（<1000）
 *   *.txt              每张图的断言原始值 + sha256 + 时间戳 + 截图晚于代码的证明
 *   interaction.txt    点卡片切目录/高亮、点轮次进/出本轮视图、Esc/空白退出、节点选中
 *
 * 纪律（harness README §5）：截图只在全部断言通过时落盘；每张图对应可复现状态；
 * 不用模板串反引号；交互用真实 DOM 事件，不直接改组件内部状态。
 *
 * 用法：
 *   node tests/ui-map/run-t07.mjs                 # T07（历史默认目录）
 *   TL_TASK=T31 node tests/ui-map/run-t07.mjs     # T31 证据目录
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
import { prepareEdges, selectVisibleEdges } from '../../src/client/ui/map/relations.ts'
import { GRAPH_LIMITS } from '../../src/client/ui/map/index.ts'
import { buildDirectoryCards, directoryKeyOf } from '../../src/client/ui/rail/index.ts'
import { makeDataset, REAL_DIRS } from './fixtures.ts'

const ENTRY_MAP = 'tests/ui-map/entries/map.entry.ts'
const TASK = process.env.TL_TASK ?? 'T07'
const OUT_DIR = resolve(WORKSPACE_ROOT, 'output/_verify/threadline/' + TASK)

const COVERAGE = [
  'src/client/ui/map',
  'src/client/ui/rail',
  'src/client/ui/turns',
  'src/client/ui/shell',
  'src/client/ui/timeline',
  'src/client/locale',
  'src/client/styles/map.css',
  'src/client/styles/rail.css',
  'src/client/styles/base.css',
  'src/client/styles/timeline.css',
  'src/client/styles/turns.css',
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
    date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) +
    'T' + pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds()) +
    '.' + String(date.getMilliseconds()).padStart(3, '0') +
    '+' + pad(-date.getTimezoneOffset() / 60) + ':00'
  )
}

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

async function openScene(browser, options) {
  const page = await browser.newPage()
  await page.setViewport({ width: options.width ?? 1440, height: options.height ?? 900, deviceScaleFactor: 1 })
  await page.emulateMedia([{ name: 'prefers-reduced-motion', value: options.reducedMotion === true ? 'reduce' : 'no-preference' }])
  const html = await buildEntryHtml(ENTRY_MAP, {})
  sceneSequence += 1
  const pagePath = join(browser.profileDir, 't31-scene-' + sceneSequence + '.html')
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
 * 共享断言片段
 * ------------------------------------------------------------------ */

/** 截图状态的期望值：目录卡数 / 默认目录图节点数（与 entry 同一份数据 + 同一套聚合）。 */
function expectedFor(options = {}) {
  const dataset = makeDataset({
    ...(options.files === 600 ? { count: 600, seed: 2026 } : {}),
    ...(options.dirs ? { dirs: REAL_DIRS } : {}),
  })
  const cards = buildDirectoryCards(dataset.files, { rootLabel: '根目录' })
  const directory = cards.length === 0 ? '' : cards[0].key
  const directoryFiles = dataset.files.filter((file) => directoryKeyOf(file.path) === directory)
  return {
    cards: cards.length,
    directory,
    nodes: Math.min(GRAPH_LIMITS.directory, directoryFiles.length),
    files: directoryFiles.length,
  }
}

const BASE_ASSERTIONS = {
  noHScroll: true,
  noInnerOverflow: true,
  contains: [
    { selector: '[data-threadline-shell]' },
    { selector: '[data-threadline-layout]' },
    { selector: '[data-threadline-left]' },
    { selector: '[data-threadline-rail]' },
    { selector: '[data-tl-graph]' },
    { selector: '[data-directory-rail]' },
    { selector: '.threadline-timeline' },
    { selector: '.threadline-turns' },
    { selector: '.tl-graph-legend' },
  ],
  absent: [
    { selector: '[data-region="inspector"]' },
    { selector: '.threadline-inspector' },
    { selector: '[role="dialog"]' },
    { selector: '[data-threadline-portal]' },
    { selector: '.tl-map-toolbar' },
  ],
  expr: [
    {
      label: 'single-scroll',
      code: '(function(){var shell=document.querySelector("[data-threadline-shell]");var de=document.documentElement;return window.scrollY===0&&window.getComputedStyle(shell).overflowY==="auto"&&!(de.scrollHeight>de.clientHeight+1);})()',
    },
    {
      label: 'no-inner-scroll',
      code: '(function(){var els=[".tl-graph",".tl-rail",".threadline-timeline",".threadline-turns",".threadline-left"];for(var i=0;i<els.length;i++){var el=document.querySelector(els[i]);if(el!==null&&el.scrollHeight>el.clientHeight+1){return false;}}return true;})()',
    },
    {
      label: 'rail-two-columns',
      code: '(function(){var el=document.querySelector(".tl-rail");if(!el)return false;var cols=window.getComputedStyle(el).gridTemplateColumns.split(" ").filter(Boolean);return cols.length===2;})()',
    },
    {
      label: 'left-sticky',
      code: '(function(){var el=document.querySelector(".threadline-left");return el!==null&&window.getComputedStyle(el).position==="sticky";})()',
    },
    {
      label: 'family-legend-5',
      code: 'document.querySelectorAll(".tl-graph-legend-item").length',
      equals: 5,
    },
    {
      label: 'no-cluster-or-grid',
      code: '(function(){return document.querySelector(".tl-cluster-box")===null&&document.querySelector(".tl-map-grid")===null;})()',
    },
  ],
}

/* ------------------------------------------------------------------ *
 * 场景 1：默认目录图 / 1200 / 窄容器 / 滚动态
 * ------------------------------------------------------------------ */

async function captureDefault(browser, options) {
  const query = options.query ?? 'state=default'
  const expected = options.expected
  const baseExpr = BASE_ASSERTIONS.expr.filter((item) => {
    if (!options.stacked && item.label === 'left-sticky') return true
    if (options.stacked && item.label === 'left-sticky') return false
    return true
  })
  const expr = [
    ...baseExpr,
    {
      label: 'mode-directory',
      code: 'document.querySelector("[data-tl-graph]").getAttribute("data-graph-mode")',
      equals: 'directory',
    },
    {
      label: 'graph-directory',
      code: 'document.querySelector("[data-tl-graph]").getAttribute("data-graph-directory")',
      equals: expected.directory,
    },
    {
      label: 'rail-card-count',
      code: 'document.querySelectorAll("[data-directory-card]").length',
      equals: expected.cards,
    },
    {
      label: 'selected-card-count',
      code: 'document.querySelectorAll("[data-directory-card][data-selected=true]").length',
      equals: 1,
    },
    {
      label: 'node-count',
      code: 'document.querySelectorAll("[data-file-path]").length',
      equals: expected.nodes,
    },
    {
      label: 'file-count-attr',
      code: 'document.querySelector("[data-tl-graph]").getAttribute("data-file-count")',
      equals: String(expected.files),
    },
    {
      label: 'labels-gt-0',
      code: 'document.querySelectorAll("[data-label-for]").length > 0',
    },
    {
      label: 'labels-max',
      code: 'document.querySelectorAll("[data-label-for]").length <= 14',
    },
    {
      label: 'labels-in-bounds',
      code: '(function(){var stage=document.querySelector("[data-graph-stage]");if(stage===null)return false;var s=stage.getBoundingClientRect();var els=document.querySelectorAll("[data-label-for]");for(var i=0;i<els.length;i++){var r=els[i].getBoundingClientRect();if(r.left<s.left-2||r.right>s.right+2||r.top<s.top-2||r.bottom>s.bottom+2)return false;}return true;})()',
    },
    {
      label: 'labels-gap-4px',
      code: '(function(){var els=document.querySelectorAll("[data-label-for]");var rects=[];for(var i=0;i<els.length;i++)rects.push(els[i].getBoundingClientRect());for(var a=0;a<rects.length;a++){for(var b=a+1;b<rects.length;b++){var A=rects[a],B=rects[b];var gapX=Math.max(B.left-A.right,A.left-B.right);var gapY=Math.max(B.top-A.bottom,A.top-B.bottom);if(gapX<4&&gapY<4)return false;}}return true;})()',
    },
  ]
  if (options.expectTruncated) {
    expr.push(
      {
        label: 'truncated-note-present',
        code: 'document.querySelector("[data-graph-truncated]") !== null',
      },
      {
        label: 'truncated-note-text',
        code: '(function(){var el=document.querySelector("[data-graph-truncated]");return el!==null&&el.textContent.indexOf("显示 40/")>=0;})()',
      },
    )
  }
  if (options.stacked) {
    expr.push(
      {
        label: 'stacked-left-static',
        code: '(function(){var el=document.querySelector(".threadline-left");return el!==null&&window.getComputedStyle(el).position==="static";})()',
      },
      {
        label: 'stacked-single-column',
        code: '(function(){var el=document.querySelector(".threadline-layout");var cols=window.getComputedStyle(el).gridTemplateColumns.split(" ").filter(Boolean);return cols.length===1;})()',
      },
    )
  }
  if (options.scrolled) {
    expr.push({
      label: 'shell-scrolled',
      code: '(function(){var shell=document.querySelector("[data-threadline-shell]");return shell.scrollTop>0&&window.scrollY===0;})()',
    })
  }
  const result = await renderAtWithBrowser(browser, {
    width: options.width ?? 1440,
    height: 900,
    entry: ENTRY_MAP,
    query,
    waitFor: 'html[data-harness-ready]',
    outPng: relativePath(join(OUT_DIR, options.file)),
    assert: {
      ...BASE_ASSERTIONS,
      expr,
    },
  })
  if (!result.ok) throw new Error(options.file + ' 断言失败：' + JSON.stringify(result.checks.filter((item) => !item.ok)))
  return { result }
}

/* ------------------------------------------------------------------ *
 * 场景 2：轮次视图
 * ------------------------------------------------------------------ */

async function captureTurn(browser) {
  const result = await renderAtWithBrowser(browser, {
    width: 1440,
    height: 900,
    entry: ENTRY_MAP,
    query: 'state=turn&turn=3',
    waitFor: 'html[data-harness-ready]',
    outPng: relativePath(join(OUT_DIR, 'turn.png')),
    assert: {
      ...BASE_ASSERTIONS,
      contains: [...BASE_ASSERTIONS.contains, { selector: '.tl-graph-summary' }, { selector: '[data-status="read"]' }, { selector: '.tl-fnode-status' }],
      expr: [
        ...BASE_ASSERTIONS.expr,
        { label: 'mode-turn', code: 'document.querySelector("[data-tl-graph]").getAttribute("data-graph-mode")', equals: 'turn' },
        { label: 'summary-read', code: 'document.querySelector("[data-status=read]").textContent.indexOf("读")>=0' },
        { label: 'summary-write', code: 'document.querySelector("[data-status=write]").textContent.indexOf("写 +")>=0' },
        { label: 'summary-first', code: 'document.querySelector("[data-status=first]").textContent.indexOf("首见")>=0' },
        { label: 'summary-delete', code: '(function(){var el=document.querySelector("[data-status=delete]");return el!==null&&el.textContent.indexOf("删除")>=0&&(el.getAttribute("title")||"").indexOf("未逐文件归属")>=0})()' },
        {
          label: 'status-nodes',
          code: 'document.querySelectorAll("[data-file-path][data-read]").length > 0',
        },
        {
          label: 'turn-nodes',
          code: 'document.querySelectorAll("[data-file-path]").length > 0',
        },
        {
          label: 'dim-cards',
          code: 'document.querySelectorAll("[data-directory-card][data-dim=true]").length > 0',
        },
        {
          label: 'rail-cards',
          code: 'document.querySelectorAll("[data-directory-card]").length > 0',
        },
        {
          label: 'labels-max-turn',
          code: 'document.querySelectorAll("[data-label-for]").length <= 30',
        },
        {
          label: 'labels-in-bounds',
          code: '(function(){var stage=document.querySelector("[data-graph-stage]");if(stage===null)return false;var s=stage.getBoundingClientRect();var els=document.querySelectorAll("[data-label-for]");for(var i=0;i<els.length;i++){var r=els[i].getBoundingClientRect();if(r.left<s.left-2||r.right>s.right+2||r.top<s.top-2||r.bottom>s.bottom+2)return false;}return true;})()',
        },
        {
          label: 'labels-gap-4px',
          code: '(function(){var els=document.querySelectorAll("[data-label-for]");var rects=[];for(var i=0;i<els.length;i++)rects.push(els[i].getBoundingClientRect());for(var a=0;a<rects.length;a++){for(var b=a+1;b<rects.length;b++){var A=rects[a],B=rects[b];var gapX=Math.max(B.left-A.right,A.left-B.right);var gapY=Math.max(B.top-A.bottom,A.top-B.bottom);if(gapX<4&&gapY<4)return false;}}return true;})()',
        },
      ],
    },
  })
  if (!result.ok) throw new Error('turn.png 断言失败：' + JSON.stringify(result.checks.filter((item) => !item.ok)))
  return { result, statusNodes: checkOk(result, 'expr:status-nodes'), turnNodes: checkOk(result, 'expr:turn-nodes'), railCards: checkOk(result, 'expr:rail-cards'), dimCards: checkOk(result, 'expr:dim-cards') }
}

/* ------------------------------------------------------------------ *
 * 场景 3：交互（点卡片切目录、点轮次进出、Esc/空白、节点选中）
 * ------------------------------------------------------------------ */

async function captureInteraction(browser) {
  const page = await openScene(browser, { entry: ENTRY_MAP, query: 'state=default&dirs=20' })
  try {
    const script =
      '(async function(){' +
      'function api(){ return window.__tl }' +
      'function frame(){ return new Promise(function(resolve){ requestAnimationFrame(function(){ requestAnimationFrame(function(){ resolve(1) }) }) }) }' +
      'function q(sel){ return document.querySelector(sel) }' +
      'var out = { steps: [] };' +
      'out.modeStart = api().mode(); out.dirStart = api().directory();' +
      'out.cardCount = api().cardCount(); out.nodeCountStart = api().nodeCount();' +
      'out.selectedStart = api().selectedCard();' +
      'var keys = api().cardKeys();' +
      'var second = keys.find(function(k){ return k !== out.dirStart });' +
      'var otherCards = document.querySelectorAll("[data-directory-card]"); var otherCard = null; for (var ci=0; ci<otherCards.length; ci++){ if (otherCards[ci].getAttribute("data-directory-card") !== out.dirStart) { otherCard = otherCards[ci]; break; } }' +
      'otherCard.dispatchEvent(new MouseEvent("click", { bubbles: true }));' +
      'await frame();' +
      'out.dirAfterCard = api().directory(); out.selectedAfterCard = api().selectedCard();' +
      'out.modeAfterCard = api().mode();' +
      'out.nodeCountAfterCard = api().nodeCount();' +
      // 点一轮 → 本轮视图（状态 + 摘要 + 卡片变淡）
      'var block = q(".threadline-turn-strip [role=option]");' +
      'block.dispatchEvent(new MouseEvent("click", { bubbles: true }));' +
      'await frame();' +
      'out.modeAfterTurn = api().mode();' +
      'out.statusNodes = api().statusNodes().length;' +
      'out.summary = api().summaryText();' +
      'out.dimCards = api().dimCards().length;' +
      'out.turnNodeCount = api().nodeCount();' +
      // 再点同一轮 → 回目录图
      'q(".threadline-turn-strip [role=option]").dispatchEvent(new MouseEvent("click", { bubbles: true }));' +
      'await frame();' +
      'out.modeAfterTurnAgain = api().mode();' +
      // 再进一轮，用 Esc / 空白退出
      'q(".threadline-turn-strip [role=option]").dispatchEvent(new MouseEvent("click", { bubbles: true }));' +
      'await frame();' +
      'out.modeBeforeEsc = api().mode();' +
      'q(".tl-graph-svg").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));' +
      'await frame();' +
      'out.modeAfterEsc = api().mode();' +
      // 节点选中（填充+细环）
      'var node = q("[data-file-path]");' +
      'node.dispatchEvent(new MouseEvent("click", { bubbles: true }));' +
      'await frame();' +
      'out.selectedPath = api().selectedPath();' +
      'out.selectedNodes = document.querySelectorAll("[data-file-path][data-selected=true]").length;' +
      // 滚动：左列 sticky、页面仅 shell 滚动
      'var proof = api().scrollProof(); api().scrollShell(Math.round(proof.shellScrollHeight*0.45)); await frame();'
    const raw = await page.evaluate(script + 'return JSON.stringify({out:out, proof:api().scrollProof(), windowScrollAfter: window.scrollY});})()', { awaitPromise: true })
    const parsed = JSON.parse(raw)
    // wheel：滚轮必须能滚 shell（不是只有 scrollbar/程序化 scrollTop 能滚）。
    const before = await page.evaluate('(function(){var s=document.querySelector("[data-threadline-shell]");if(s)s.scrollTop=0;return s?s.scrollTop:0})()')
    await page.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 700, y: 360, deltaX: 0, deltaY: 320, button: 'none', clickCount: 0 })
    await page.evaluate('new Promise(function(resolve){ setTimeout(resolve, 350) })', { awaitPromise: true })
    const after = await page.evaluate('(function(){var s=document.querySelector("[data-threadline-shell]");return s?s.scrollTop:0})()')
    if (!(after > before)) throw new Error('wheel 未滚动 shell：' + before + ' -> ' + after)
    parsed.wheel = { before, after }
    return parsed
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
  const browser = await launchBrowser({ width: 1440, height: 900 })
  let defaultCapture
  let turnCapture
  let narrowCapture
  let narrow800Capture
  let mid980Capture
  let wideCapture
  let scrolledCapture
  let truncatedCapture
  let interaction
  const expected = expectedFor()
  try {
    defaultCapture = await captureDefault(browser, { file: 'default.png', width: 1440, query: 'state=default', expected })
    turnCapture = await captureTurn(browser)
    wideCapture = await captureDefault(browser, { file: 'default-1200.png', width: 1200, query: 'state=default', expected: { ...expected, nodes: 30 } })
    narrowCapture = await captureDefault(browser, { file: 'narrow.png', width: 900, query: 'state=default', expected, stacked: true })
    // T33-verify M1：600–899 区间曾因 1.0 的 168px 内滚上限压到卡片；800 必须有断言。
    narrow800Capture = await captureDefault(browser, { file: 'narrow-800.png', width: 800, query: 'state=default', expected, stacked: true })
    // 960 断点：真实窗口内容宽约 977px，必须仍是左右两列（不是堆叠）。
    mid980Capture = await captureDefault(browser, { file: 'mid-980.png', width: 980, query: 'state=default', expected: { ...expected, nodes: 30 } })
    truncatedCapture = await captureDefault(browser, {
      file: 'truncated.png',
      width: 1440,
      query: 'state=default&files=600',
      expected: expectedFor({ files: 600 }),
      expectTruncated: true,
    })
    scrolledCapture = await captureDefault(browser, { file: 'scrolled.png', width: 1440, query: 'state=scrolled&dirs=20', expected: expectedFor({ dirs: true }), scrolled: true })
    interaction = await captureInteraction(browser)
  } finally {
    await browser.close()
  }

  const code = latestCodeMtime()
  const pngs = {
    default: defaultCapture.result.png,
    turn: turnCapture.result.png,
    wide1200: wideCapture.result.png,
    narrow: narrowCapture.result.png,
    narrow800: narrow800Capture.result.png,
    mid980: mid980Capture.result.png,
    scrolled: scrolledCapture.result.png,
    truncated: truncatedCapture.result.png,
  }
  const fresh = {}
  for (const [name, png] of Object.entries(pngs)) fresh[name] = png !== null && png.mtimeMs >= code.mtimeMs
  const pngPath = (png) => (png === null ? '-' : relativePath(resolve(WORKSPACE_ROOT, png.relative)))

  const screenshotLines = [
    '# T31 截图清单（sha256 / bytes / mtime；全部晚于代码最后改动）',
    'generated: ' + iso(Date.now()),
    'latest-code.mtime: ' + iso(code.mtimeMs),
    'latest-code.file: ' + code.file,
    '',
    ...Object.entries(pngs).map(([name, png]) =>
      png === null
        ? '- ' + name + ': (missing)'
        : '- ' + name + ': ' + pngPath(png) + '  sha256=' + png.sha256 + '  bytes=' + png.bytes + '  mtime=' + iso(png.mtimeMs) + '  fresh=' + (fresh[name] ? 'YES' : 'NO'),
    ),
    '',
    '## 场景',
    '- default.png：1440 默认目录图（左图 + 左列时间轴/轮次带 + 右两列卡片；无检查器）',
    '- turn.png：1440 轮次视图（读/写行/首见 + 摘要 + 删除命令；未涉及目录变淡）',
    '- default-1200.png：1200 宽默认',
    '- narrow.png：900 宽（<960 上下堆叠）',
    '- narrow-800.png：800 宽（600–899 溢出回归）',
    '- mid-980.png：980 宽（≥960 左右两列）',
    '- scrolled.png：1440 滚到 shell 中部（左列 sticky、页面仅 shell 滚动）',
    '- truncated.png：1440 大目录截断（600 文件夹具 → 目录 40 上限，显式「显示 40/N」）',
  ]

  const defaultLines = [
    '# T31 默认目录图（default.png）',
    'generated: ' + iso(Date.now()),
    'viewport: 1440x900  entry: ' + ENTRY_MAP + '  query: state=default',
    'png: ' + pngPath(pngs.default),
    'png.sha256: ' + (pngs.default === null ? '-' : pngs.default.sha256),
    'assertions: ' + defaultCapture.result.checks.length + ' / failed 0',
    '',
    '## 断言原始值',
    ...defaultCapture.result.checks.map((item) => '- ' + item.label + ': ' + (item.ok ? 'PASS' : 'FAIL') + ' ' + JSON.stringify(item.detail)),
  ]

  const turnLines = [
    '# T31 本轮视图（turn.png）',
    'generated: ' + iso(Date.now()),
    'viewport: 1440x900  entry: ' + ENTRY_MAP + '  query: state=turn&turn=3',
    'png: ' + pngPath(pngs.turn),
    'png.sha256: ' + (pngs.turn === null ? '-' : pngs.turn.sha256),
    'assertions: ' + turnCapture.result.checks.length + ' / failed 0',
    'turn-nodes: ' + JSON.stringify(turnCapture.turnNodes) + '  status-nodes: ' + JSON.stringify(turnCapture.statusNodes) + '  rail-cards: ' + JSON.stringify(turnCapture.railCards) + '  dim-cards: ' + JSON.stringify(turnCapture.dimCards),
    '',
    '## 断言原始值',
    ...turnCapture.result.checks.map((item) => '- ' + item.label + ': ' + (item.ok ? 'PASS' : 'FAIL') + ' ' + JSON.stringify(item.detail)),
  ]

  const interactionLines = [
    '# T31 交互（真实浏览器 DOM 事件）',
    'generated: ' + iso(Date.now()),
    'scene: ' + ENTRY_MAP + '  query: state=default  1440x900',
    '',
    '## 目录图',
    '- 初始 mode: ' + interaction.out.modeStart + '  directory=' + JSON.stringify(interaction.out.dirStart) + '  cards=' + interaction.out.cardCount + '  nodes=' + interaction.out.nodeCountStart,
    '- 点第二张卡后 directory: ' + JSON.stringify(interaction.out.dirAfterCard) + '  selected: ' + JSON.stringify(interaction.out.selectedAfterCard) + '  mode=' + interaction.out.modeAfterCard + '  nodes=' + interaction.out.nodeCountAfterCard,
    '',
    '## 轮次视图',
    '- 点一轮后 mode: ' + interaction.out.modeAfterTurn + '  status-nodes=' + interaction.out.statusNodes + '  turn-nodes=' + interaction.out.turnNodeCount + '  dim-cards=' + interaction.out.dimCards,
    '- 摘要: ' + JSON.stringify(interaction.out.summary),
    '- 再点同一轮: mode=' + interaction.out.modeAfterTurnAgain,
    '- 再进一轮后 Esc: ' + interaction.out.modeBeforeEsc + ' → ' + interaction.out.modeAfterEsc,
    '',
    '## 节点选中与单滚动',
    '- 点击节点 selected: ' + JSON.stringify(interaction.out.selectedPath) + '（data-selected=true 节点数 ' + interaction.out.selectedNodes + '）',
    '- 滚动窗口: windowScroll=' + interaction.proof.windowScroll + '  shellScroll=' + interaction.proof.shellScroll + '  shellScrollHeight=' + interaction.proof.shellScrollHeight + '  leftSticky=' + interaction.proof.leftSticky + '  graphOverflow=' + interaction.proof.graphOverflowY + '  railOverflow=' + interaction.proof.railOverflowY,
    '- 滚动后 window.scrollY=' + interaction.windowScrollAfter,
    '',
    '## 原始 trace',
    JSON.stringify(interaction, null, 2),
  ]

  writeFileSync(join(OUT_DIR, 'screenshots.txt'), screenshotLines.join('\n') + '\n', 'utf8')
  writeFileSync(join(OUT_DIR, 'default.txt'), defaultLines.join('\n') + '\n', 'utf8')
  writeFileSync(join(OUT_DIR, 'turn.txt'), turnLines.join('\n') + '\n', 'utf8')
  writeFileSync(join(OUT_DIR, 'interaction.txt'), interactionLines.join('\n') + '\n', 'utf8')
  writeFileSync(join(OUT_DIR, 'wide-1200.txt'), JSON.stringify(wideCapture.result.checks, null, 2) + '\n', 'utf8')
  writeFileSync(join(OUT_DIR, 'narrow-900.txt'), JSON.stringify(narrowCapture.result.checks, null, 2) + '\n', 'utf8')

  const failures = []
  for (const [name, ok] of Object.entries(fresh)) if (!ok) failures.push(name + '.png 早于最后一次代码改动')
  if (interaction.out.modeStart !== 'directory') failures.push('默认不是目录图')
  if (interaction.out.modeAfterCard !== 'directory') failures.push('点卡片后不是目录图')
  if (interaction.out.dirAfterCard === interaction.out.dirStart) failures.push('点卡片没有切换目录')
  if (interaction.out.selectedAfterCard !== interaction.out.dirAfterCard) failures.push('点卡片没有高亮选中卡')
  if (!(interaction.out.nodeCountAfterCard > 0)) failures.push('切换目录后图里没有节点')
  if (interaction.out.modeAfterTurn !== 'turn') failures.push('点轮次没有进入本轮视图')
  if (!(interaction.out.statusNodes >= 3)) failures.push('本轮图里状态节点 < 3（' + interaction.out.statusNodes + '）')
  if (!(interaction.out.dimCards > 0)) failures.push('本轮视图没有把未涉及目录变淡')
  if (interaction.out.modeAfterTurnAgain !== 'directory') failures.push('再点同一轮没有回目录图')
  if (interaction.out.modeAfterEsc !== 'directory') failures.push('Esc 没有退出本轮视图')
  if (!(interaction.out.selectedNodes === 1)) failures.push('点击节点没有唯一选中态')
  if (interaction.proof.windowScroll !== 0 || interaction.windowScrollAfter !== 0) failures.push('页面（window）发生滚动，破坏单滚动')
  if (!(interaction.proof.shellScroll > 0)) failures.push('shell 没有滚动（sticky 验证失败）')
  if (!interaction.proof.leftSticky) failures.push('左列不是 sticky')
  if (interaction.proof.graphOverflowY || interaction.proof.railOverflowY) failures.push('图/卡片出现内部滚动')

  if (failures.length > 0) {
    console.error('T31 evidence FAILED:')
    for (const failure of failures) console.error('  - ' + failure)
    process.exit(1)
  }

  console.log('T31 default.png PASS  ' + pngPath(pngs.default) + '  sha256=' + (pngs.default === null ? '-' : pngs.default.sha256.slice(0, 8)))
  console.log('T31 turn.png PASS     ' + pngPath(pngs.turn) + '  sha256=' + (pngs.turn === null ? '-' : pngs.turn.sha256.slice(0, 8)) + '  turnNodes=' + interaction.out.turnNodeCount)
  console.log('T31 1200/narrow PASS')
  console.log('T31 interaction PASS  单滚动 / 左列 sticky / 点卡片切目录 / 轮次进出 / 节点选中')
  console.log('evidence dir: ' + relativePath(OUT_DIR) + '  (' + iso(startedAt) + ' → ' + iso(Date.now()) + ')')
}

main().catch((error) => {
  console.error('run-t07 failed:', error && error.stack ? error.stack : error)
  process.exit(1)
})
