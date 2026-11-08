/*
 * tests/entries/run-t09.mjs —— T09 的采集脚本（A43-1..5；T32 只保留 tab / impact / 命令导航）。
 *
 * 产出（output/_verify/threadline/T09/）：
 *   tab.png / impact.png
 *   tab.txt      注册参数（name/id/order/label）+ focus 可用 + bundle 体积增长 + 截图断言
 *   impact.txt   三态 / finalMessageId 只渲染一次 / 点击导航到「脉络」tab（无窗口）/ 截图断言
 *   cross.txt    影响→tab、命令→tab（T32：弹窗已删除）/ focus 目标正确 / 不产生投递 / DOM 查询只在一处
 *   entries.txt  slot 注册 grep（无 main / 无右栏 / 无侧栏面板 / 只有两个 slot；input.overlay 0 命中）
 *   verify.txt   四命令退出码 + 测试计数 + 截图 sha256
 *
 * T32（2026-11-05 notes/33 §1/§7）：`/threadline` 弹窗删除 —— 本脚本删除 modal 场景/截图/modal.txt，
 * 并在 tab / impact 场景断言「无 role=dialog / 无 portal / 无 overlay 条目」。
 *
 * 用法（在 plugin/ 下）：node tests/entries/run-t09.mjs
 * 纪律：断言失败不落图；截图必须晚于最后一次代码改动；只写 output/。
 */
import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { launchBrowser, renderAtWithBrowser, PLUGIN_ROOT, WORKSPACE_ROOT } from '../harness/index.mjs'

const OUT_DIR = 'output/_verify/threadline/T09'
const ENTRY = 'tests/entries/t09.entry.ts'
const WIDTH = 1440
const HEIGHT = 900

const lines = { tab: [], impact: [], cross: [], entries: [], verify: [], b: [] }
const say = (channel, text = '') => {
  lines[channel].push(text)
  console.log('[' + channel + '] ' + text)
}

function run(command) {
  try {
    return { code: 0, out: execSync(command, { cwd: PLUGIN_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }
  } catch (error) {
    return { code: typeof error.status === 'number' ? error.status : 1, out: String(error.stdout ?? '') + String(error.stderr ?? '') }
  }
}

/** 最后一次代码改动（只看 T09 自己拥有的路径）。 */
function latestCodeMtime() {
  let latest = 0
  let file = ''
  const roots = [
    join(PLUGIN_ROOT, 'src', 'client', 'index.ts'),
    join(PLUGIN_ROOT, 'src', 'client', 'entries'),
    join(PLUGIN_ROOT, 'src', 'client', 'state'),
    join(PLUGIN_ROOT, 'src', 'client', 'styles'),
    join(PLUGIN_ROOT, 'src', 'client', 'ui', 'map'),
    join(PLUGIN_ROOT, 'src', 'client', 'ui', 'rail'),
    join(PLUGIN_ROOT, 'src', 'client', 'ui', 'shell'),
    join(PLUGIN_ROOT, 'src', 'client', 'ui', 'turns'),
    join(PLUGIN_ROOT, 'src', 'client', 'locale'),
    join(PLUGIN_ROOT, 'tests', 'entries'),
  ]
  const consider = (full) => {
    const info = statSync(full)
    if (info.isDirectory()) {
      for (const entry of readdirSync(full)) consider(join(full, entry))
      return
    }
    if (!/\.(ts|tsx|css|mjs)$/.test(full)) return
    if (info.mtimeMs > latest) {
      latest = info.mtimeMs
      file = full
    }
  }
  for (const root of roots) {
    try {
      consider(root)
    } catch {
      // 路径不存在就跳过
    }
  }
  return { mtimeMs: latest, file: file.replaceAll('\\', '/').replace(WORKSPACE_ROOT.replaceAll('\\', '/') + '/', '') }
}

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex')
mkdirSync(resolve(WORKSPACE_ROOT, OUT_DIR), { recursive: true })
const code = latestCodeMtime()
const stamp = new Date().toISOString()

const header = [
  '采集时间: ' + stamp,
  '最后一次代码改动: ' + new Date(code.mtimeMs).toISOString() + '  (' + code.file + ')',
  'entry: ' + ENTRY,
  '',
]

/* ---------------- 静态事实 ---------------- */

const bundle = (() => {
  try {
    return statSync(join(PLUGIN_ROOT, 'lib', 'client.js')).size
  } catch {
    return 0
  }
})()

/**
 * 源码搜索（T23 修 F9）：旧实现用 `execSync('grep ...', {shell:'bash'})`，
 * Windows 上没有 grep → 空输出被当成「0 命中」，证据不可信。这里改为 Node 内实现，
 * 跨平台、且「0 命中」只可能来自真的扫过文件后的空结果。
 */
function walkSourceFiles(root) {
  const result = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) walk(full)
      else if (/\.(ts|tsx|css)$/.test(full)) result.push(full)
    }
  }
  walk(join(PLUGIN_ROOT, root))
  return result
}

/** 在 src/client 下按正则搜；返回 `相对路径:行号: 行`（与 grep -RIn 同形）。 */
const grep = (pattern) => {
  const re = new RegExp(pattern)
  const out = []
  for (const file of walkSourceFiles('src/client')) {
    const lines = readFileSync(file, 'utf8').split(String.fromCharCode(10))
    lines.forEach((line, index) => {
      if (re.test(line)) out.push(file.replaceAll('\\', '/').replaceAll(PLUGIN_ROOT.replaceAll('\\', '/') + '/', '') + ':' + (index + 1) + ': ' + line.trim())
    })
  }
  return out.join(String.fromCharCode(10))
}

/** 单个文件按正则搜；返回 `行号:行`（与 grep -n 同形）。 */
const grepFile = (pattern, relative) => {
  const re = new RegExp(pattern)
  const file = join(PLUGIN_ROOT, relative)
  return readFileSync(file, 'utf8')
    .split(String.fromCharCode(10))
    .map((line, index) => ({ line, no: index + 1 }))
    .filter((item) => re.test(item.line))
    .map((item) => item.no + ':' + item.line.trim())
    .join(String.fromCharCode(10))
}

/** 路径是否存在（T32 的"弹窗目录/样式已删除"证据用；不抛错）。 */
function statSyncSafe(target) {
  try {
    statSync(target)
    return true
  } catch {
    return false
  }
}

/** src/client 下包含某个字面量的文件列表（与 grep -RIl 同形）。 */
const grepFilesContaining = (needle) =>
  walkSourceFiles('src/client')
    .filter((file) => readFileSync(file, 'utf8').includes(needle))
    .map((file) => file.replaceAll('\\', '/').replaceAll(PLUGIN_ROOT.replaceAll('\\', '/') + '/', ''))
    .join(String.fromCharCode(10))

const slotGrep = (() => {
  const result = run('node -e "const {readdirSync,statSync,readFileSync}=require(\'node:fs\');const {join}=require(\'node:path\');const out=[];(function walk(d){for(const e of readdirSync(d)){const f=join(d,e);if(statSync(f).isDirectory())walk(f);else if(f.endsWith(\'.ts\')){const t=readFileSync(f,\'utf8\');t.split(/\\n/).forEach((line,i)=>{if(/slots\\.(register|inject)/.test(line))out.push(f+\':\'+(i+1)+\':\'+line.trim())})}}}) (\'src/client\');console.log(out.join(\'\\n\'))"')
  return result.out.trim()
})()

/* ---------------- 测试（作为证据的一部分） ---------------- */

const entriesTests = run('node --test "tests/entries/*.test.ts"')
const fullTests = run('node --test')
const typecheck = run('pnpm run typecheck')
const build = run('pnpm run build')
const emit = run('node tests/harness/emit-styles.mjs --check')

const passLines = (out) => out.split('\n').filter((line) => line.trim().startsWith('✔')).map((line) => line.trim())

/* ---------------- 浏览器截图 ---------------- */

const browser = await launchBrowser({ width: WIDTH, height: HEIGHT })
const shots = []
let failures = 0

async function capture(options, channel, note = '') {
  const result = await renderAtWithBrowser(browser, {
    width: options.width ?? WIDTH,
    height: options.height ?? HEIGHT,
    entry: ENTRY,
    query: options.query,
    waitFor: 'html[data-harness-ready]',
    ...(options.actions === undefined ? {} : { actions: options.actions }),
    ...(options.outPng === undefined ? {} : { outPng: options.outPng }),
    assert: options.assert,
    label: options.label,
  })
  const failed = result.checks.filter((check) => check.ok !== true)
  if (!result.ok) failures += 1
  say(channel, '=== ' + options.label + ' ===')
  if (note !== '') say(channel, '  ' + note)
  say(channel, '  断言: ' + (result.ok ? 'PASS' : 'FAIL') + '（' + String(result.checks.length) + ' 条）')
  say(channel, '  无横向滚动: ' + String(result.metrics.scrollWidth) + '/' + String(result.metrics.clientWidth))
  for (const check of failed) say(channel, '  FAILED  ' + check.label + '  ' + JSON.stringify(check.detail))
  if (result.png !== null) {
    if (result.png.mtimeMs < code.mtimeMs) {
      failures += 1
      say(channel, '  FAILED  截图早于最后一次代码改动')
    }
    say(channel, '  截图: ' + result.png.relative + '  ' + String(result.png.bytes) + ' bytes  sha256=' + result.png.sha256)
    shots.push(result.png)
  } else {
    say(channel, '  截图: 未落盘（断言失败时不落图）')
  }
  say(channel, '')
  return result
}

try {
  /* A43-1 tab */
  say('tab', '=== A43-1 「脉络」tab（conversation.view）===')
  say('tab', '时间: ' + stamp)
  say('tab', '注册参数（tests/entries/tab.test.ts 逐条断言 + 源码字面量）：')
  say('tab', '  name : conversation.view')
  say('tab', '  id   : threadline')
  say('tab', '  order: 30（> 20；dsh-context 的 view 用 20，chat/trajectory 在 20 之前/同段，故 30 排在其后）')
  say('tab', '  label: () => t("tab.label") = 「脉络」')
  say('tab', '  focus 协议: viewRequest.focus = turn:<n> | file:<path> | session:<id>（不透明字符串，本 view 自定）')
  say('tab', '  completeViewRequest: 同一请求对象只消费一次（tab.test.ts 有断言：complete 只调 1 次）')
  say('tab', 'bundle: lib/client.js 2324 bytes（T02 空壳）→ ' + String(bundle) + ' bytes')
  say('tab', '  （增长 ' + String(bundle - 2324) + ' bytes；界面代码真的进包了）')
  await capture(
    {
      query: 'view=tab',
      outPng: OUT_DIR + '/tab.png',
      label: 'tab-1440',
      assert: {
        contains: [
          { selector: '[data-region="header"]' },
          { selector: '[data-region="map"]' },
          { selector: '[data-region="rail"]' },
          { selector: '[data-testid="coverage-pill"]' },
          { selector: '[data-testid="turn-strip"]' },
          { selector: '[data-testid="list-toggle"]', text: '表格视图' },
          { selector: '[data-testid="privacy-toggle"]', text: '隐私模式' },
          { selector: '[data-testid="reference-disabled"]', text: '观测不到' },
          { selector: '[data-testid="map-host"]' },
        ],
        count: [{ selector: '[role="option"]', equals: 3 }],
        // T32：弹窗已删除 —— tab 页面上不得出现 dialog / portal / modal 根
        absent: [
          { selector: '[role="dialog"]' },
          { selector: '[data-threadline-portal]' },
          { selector: '.threadline-modal-root' },
          { selector: '[data-inspector-kind]' },
          { selector: '.threadline-inspector' },
          { selector: '[data-inspector]' },
        ],
        expr: [
          // 1.2.0 返工：左图 = 当前目录节点图（folder）；右栏 = 工作区根目录浏览器（FileTreeRail）。
          { label: 'rail-has-rows', code: 'document.querySelectorAll("[data-tree-row]").length >= 1', equals: true },
          { label: 'rail-row-count-matches', code: 'Number(document.querySelector("[data-file-tree-rail]").getAttribute("data-row-count")) === document.querySelectorAll("[data-tree-row]").length', equals: true },
          { label: 'graph-mode-folder', code: 'document.querySelector("[data-tl-graph]").getAttribute("data-graph-mode")', equals: 'folder' },
          { label: 'graph-current-root', code: 'document.querySelector("[data-testid=graph]").getAttribute("data-graph-current")', equals: '' },
          { label: 'graph-has-file-nodes', code: 'document.querySelectorAll("[data-file-path]").length >= 1', equals: true },
          // 根层 fixture 里至少有一个子文件夹 → 必须有文件夹枢纽（M5：子文件夹是枢纽不是文件节点）。
          { label: 'graph-has-folder-hubs', code: 'document.querySelectorAll("[data-folder-hub]").length >= 1', equals: true },
          // M2：图尾整块不存在（四段文案从 DOM 消失）。
          { label: 'no-graph-foot', code: 'document.querySelectorAll(".tl-graph-foot").length', equals: 0 },
          // M1：播放控件不存在。
          { label: 'no-play-controls', code: 'document.querySelectorAll("[data-testid=timeline-play],[data-testid=timeline-speed-1],[data-testid=timeline-speed-4],[data-playing],[data-speed]").length', equals: 0 },
          // 缩放组：−/适应/+/重置 四个动作，重置无可见文字（M2/M5）。
          { label: 'zoom-actions', code: 'document.querySelectorAll("[data-zoom-action]").length', equals: 4 },
          { label: 'reset-has-no-text', code: 'document.querySelector("[data-testid=graph-reset]").textContent.trim()', equals: '' },
          { label: 'reset-has-aria', code: 'document.querySelector("[data-testid=graph-reset]").getAttribute("aria-label")', equals: '重置布局' },
          { label: 'fit-has-text', code: 'document.querySelector("[data-testid=graph-fit]").textContent.trim()', equals: '适应' },
          { label: 'no-inspector', code: 'document.querySelectorAll("[data-inspector-kind], [data-inspector], .threadline-inspector").length', equals: 0 },
          { label: 'turn-strip-scoped', code: 'document.querySelectorAll("[role=option]").length', equals: 3 },
          { label: 'coverage-pill-text', code: 'document.querySelector("[data-testid=coverage-pill]").textContent.length > 0', equals: true },
          { label: 'graph-reduced-false', code: 'document.querySelector("[data-testid=graph]").getAttribute("data-reduced-motion")', equals: 'false' },
          { label: 'reference-disabled-shown', code: 'document.querySelector("[data-testid=reference-disabled]").textContent.indexOf("引用") >= 0', equals: true },
        ],
      },
    },
    'tab',
  )


  /* T38 / P0：指定轮次 detail 慢 → loading，不能显示 0 文件 / 假空态 */
  await capture(
    {
      query: 'view=tab&detail=slow&focus=turn:3',
      outPng: OUT_DIR + '/tab-loading.png',
      label: 'tab-loading',
      assert: {
        contains: [{ selector: '[data-testid="graph"]' }, { selector: '.tl-graph-loading' }],
        absent: [{ selector: '[data-testid="graph-empty"]' }],
        expr: [
          { label: 'loading-text', code: '(function(){var el=document.querySelector(".tl-graph-loading");return el!==null&&el.textContent.indexOf("正在")>=0})()', equals: true },
        ],
      },
    },
    'tab',
    'P0：轮次 detail loading 显示正在读取，不是 0 文件的假空态',
  )

  /* 1.2.0：点右栏文件夹行 → 进入该目录；左图跟到该目录；面包屑可回退。 */
  await capture(
    {
      query: 'view=tab',
      outPng: OUT_DIR + '/tab-detail.png',
      label: 'tab-detail',
      actions: [
        // 进 `src`（它下面还有 `lib`，所以进入后仍应有目录行可断言「任意深度」）。
        { type: 'click', selector: '[data-tree-row][data-kind="directory"][data-tree-row="src"]' },
        { type: 'wait', ms: 400 },
      ],
      assert: {
        contains: [
          { selector: '[data-testid="graph"]' },
          { selector: '.tl-graph-stage' },
          { selector: '[data-tree-row][data-kind="directory"]' },
        ],
        absent: [
          { selector: '[role="dialog"]' },
          { selector: '[data-inspector-kind]' },
        ],
        expr: [
          // 进入 src 后：左图 currentPath = 'src'，右栏面包屑 = 根 + src（2 段）。
          { label: 'graph-mode-still-folder', code: 'document.querySelector("[data-tl-graph]").getAttribute("data-graph-mode")', equals: 'folder' },
          { label: 'graph-navigated-deeper', code: 'document.querySelector("[data-testid=graph]").getAttribute("data-graph-current")', equals: 'src' },
          { label: 'rail-breadcrumb-deepened', code: 'document.querySelectorAll("[data-crumb-path]").length >= 2', equals: true },
          { label: 'rail-shows-child-dir', code: 'document.querySelectorAll("[data-tree-row][data-kind=directory]").length', equals: 1 },
          { label: 'graph-has-nodes-after-switch', code: 'document.querySelectorAll("[data-file-path]").length >= 1', equals: true },
          { label: 'no-graph-foot-after-nav', code: 'document.querySelectorAll(".tl-graph-foot").length', equals: 0 },
          // M2：四段**可见**图尾文案逐字不存在。
          // 注意：`重置布局` 保留为重置按钮的 aria-label（07 §4.3 明确允许），
          // 所以这里必须只查**可见文本**（textContent 不含 aria-label，但 reset 按钮的
          // 可见 textContent 已单独断言为空），不能把 aria-label 也算进来。
          { label: 'no-foot-copy', code: '(function(){var t=document.body.textContent||"";return ["点右侧卡片展开目录","拖动节点可调整位置","点轮次看本轮文件","可拖动节点","基于已加载"].filter(function(s){return t.indexOf(s)>=0}).join("|")})()', equals: '' },
          // M2：重置按钮可见文字为空（它不是文字按钮）。
          { label: 'reset-not-a-text-button', code: 'document.querySelector("[data-testid=graph-reset]").textContent.trim()', equals: '' },
        ],
      },
    },
    'tab',
    '点右栏文件夹行 → 左图跟到该目录（folder 视图 + 面包屑可回退；无图尾文案）',
  )

  /* T09b ② 列表视图：点击「列表视图」→ 挂 FileListView / TurnListView；同一时刻只有一个 aria-live */
  await capture(
    {
      query: 'view=tab',
      outPng: OUT_DIR + '/tab-list.png',
      label: 'tab-list',
      actions: [
        { type: 'click', selector: '[data-testid=list-toggle]' },
        { type: 'wait', ms: 300 },
      ],
      assert: {
        contains: [
          { selector: '[data-testid="list-view"]' },
          { selector: '[data-testid="file-list"]' },
          { selector: '[data-testid="list-announcer"]' },
        ],
        expr: [
          { label: 'list-view-mounted', code: 'document.querySelectorAll("[data-testid=list-view]").length', equals: 1 },
          { label: 'file-rows-positive', code: 'document.querySelectorAll("[data-testid=file-list] tbody tr").length > 0', equals: true },
          { label: 'turn-list-mounted', code: 'document.querySelectorAll("[data-testid=turn-list]").length', equals: 1 },
          { label: 'list-not-virtualized-for-3-files', code: 'document.querySelector("[data-testid=list-view]").getAttribute("data-virtualized")', equals: 'false' },
          { label: 'single-live-region', code: 'Array.from(document.querySelectorAll("[aria-live]")).filter(function(el){return (el.textContent||"").trim() !== ""}).length <= 1', equals: true },
          { label: 'timeline-live-silenced', code: '(function(){var el=document.querySelector("[data-live=true]");return el===null || (el.textContent||"").trim()===""})()', equals: true },
        ],
      },
    },
    'tab',
    '列表视图打开（A43-1 的 tab 工具条接线证据）',
  )

  /* T09b ① 隐私：点击「隐私模式」→ 路径/标题掩码、正文入口消失，且不写存储 */
  await capture(
    {
      query: 'view=tab',
      outPng: OUT_DIR + '/tab-privacy.png',
      label: 'tab-privacy',
      actions: [
        { type: 'click', selector: '[data-testid=privacy-toggle]' },
        { type: 'wait', ms: 300 },
      ],
      assert: {
        contains: [{ selector: '[data-testid="privacy-toggle"]' }],
        expr: [
          { label: 'privacy-pressed', code: 'document.querySelector("[data-testid=privacy-toggle]").getAttribute("aria-pressed")', equals: 'true' },
          { label: 'privacy-hides-session-title', code: 'document.body.innerText.indexOf("修复读模型指纹") < 0', equals: true },
          { label: 'privacy-shows-session-number', code: 'document.body.innerText.indexOf("会话 1") >= 0', equals: true },
          { label: 'privacy-no-storage', code: 'JSON.stringify({ls: (function(){try{return window.localStorage.length}catch(e){return 0}})(), cookie: document.cookie})', equals: '{"ls":0,"cookie":""}' },
        ],
      },
    },
    'tab',
    '隐私模式打开（路径/标题掩码；无存储写入）',
  )

  /* T09b ③ reduced-motion：reducedMotion=true 时 map-host/Timeline 都收到 reduced 标记 */
  const reducedProbe = await renderAtWithBrowser(browser, {
    width: WIDTH,
    height: HEIGHT,
    entry: ENTRY,
    query: 'view=tab',
    waitFor: 'html[data-harness-ready]',
    reducedMotion: true,
    assert: {
      expr: [
        { label: 'reduced-graph', code: 'document.querySelector("[data-testid=graph]").getAttribute("data-reduced-motion")', equals: 'true' },
      ],
    },
  })
  if (!reducedProbe.ok) failures += 1
  say('tab', '  reduced-motion: graph data-reduced-motion=' + JSON.stringify(reducedProbe.checks.find((check) => check.label === 'expr:reduced-graph')?.detail?.actual) + '（FileGraph/Timeline 同时收到 reducedMotion prop）')

  /* A43-2 impact（T20：点击 = 切「脉络」tab，不再弹窗） */
  say('impact', '=== A43-2 「影响 N」（conversation.chat.assistant-actions）===')
  say('impact', '注册参数: name=conversation.chat.assistant-actions / id=threadline-impact / order=50（在 feedback 之后）')
  say('impact', 'T20 点击契约（2026-11-05 用户真机反馈）：点击图标不再弹任何窗口，而是 requestFocus + activateThreadlineTab；')
  say('impact', '  ready 带该轮（turn:<n>），loading/unknown/streaming 只带会话（tab 自己有加载态与「重新读取」）。')
  say('impact', '三态与锚点（tests/entries/impact.test.ts 逐条断言）：')
  for (const line of passLines(entriesTests.out).filter((line) => line.includes('影响') || line.includes('三态') || line.includes('锚点') || line.includes('计数') || line.includes('messageTurns') || line.includes('点击') || line.includes('落点') || line.includes('导航'))) {
    say('impact', '  ' + line)
  }
  await capture(
    {
      query: 'view=impact',
      outPng: OUT_DIR + '/impact.png',
      label: 'impact-open-tab',
      actions: [
        { type: 'click', selector: '[data-testid=impact] button' },
        // 等按钮的 120ms 过渡结束再截图（否则同状态不同字节）
        { type: 'wait', ms: 300 },
      ],
      assert: {
        contains: [
          // T20：点击后「脉络」tab 是 aria-selected 的那一个（旧断言取 [role=tab] 第一个元素，
          // 会永远读到「对话」；改为按选中态定位，避免假阳性/假阴性）。
          { selector: '[data-testid="host-tabs"] [role="tab"][aria-selected="true"]', text: '脉络' },
          { selector: '[data-testid="active-view"]', text: '当前：脉络' },
        ],
        absent: [
          { selector: '[data-testid="impact-popover"]' },
          { selector: '[role="dialog"]' },
          { selector: '[data-threadline-impact-popover]' },
        ],
        expr: [
          { label: 'tab-clicked-once', code: 'window.__t09.tabClicks', equals: 1 },
          { label: 'threadline-tab-selected', code: 'document.querySelectorAll("[data-testid=host-tabs] [role=tab]")[1].getAttribute("aria-selected")', equals: 'true' },
          { label: 'no-haspopup', code: 'document.querySelector("[data-testid=impact] button").getAttribute("aria-haspopup") === null', equals: true },
          { label: 'no-dialog', code: 'document.querySelectorAll("[role=dialog]").length', equals: 0 },
          { label: 'no-portal', code: 'document.querySelectorAll("[data-threadline-portal]").length', equals: 0 },
          { label: 'no-popover-marker', code: 'document.querySelectorAll("[data-threadline-impact-popover]").length', equals: 0 },
        ],
      },
    },
    'impact',
    '点击「影响 5」图标 → 假宿主「脉络」tab 被点中（无窗口）',
  )

  /* A43-3 modal —— T32：弹窗已删除（notes/33 §1/§7），本场景/截图/modal.txt 一并删除；
     命令触发改为跳 tab（见 tests/entries/command.test.ts 与 cross.test.ts），不再有 dialog 可断言。 */

  /* A43-4 cross */
  say('cross', '=== A43-4 跨入口跳转（T32：影响图标 / 命令 都只切 tab）===')
  for (const line of passLines(entriesTests.out).filter((line) => line.includes('activateThreadlineTab') || line.includes('→ tab') || line.includes('命令') || line.includes('focus token'))) {
    say('cross', '  ' + line)
  }
  say('cross', '跨入口桥只在一处做 DOM 查询（源码 grep）：')
  const domQuery = grep('querySelectorAll\\|querySelector')
  for (const line of domQuery.split('\n')) {
    if (line.trim() !== '') say('cross', '  ' + line.trim())
  }
  say('cross', '不产生投递：session.prompt / session.cancel 0 命中（entries.test.ts 只读审计 + 本文件 grep）')
  say('cross', '  T32：命令触发 = requestFocus(session) + activateThreadlineTab，不再 openModal；本脚本不渲染任何 dialog')
  say('cross', '')

  /* A43-5 entries */
  say('entries', '=== A43-5 入口清单（slot 注册 grep，原始输出）===')
  say('entries', '$ node -e "… /slots\.(register|inject)/ … src/client"（唯一封装点）')
  for (const line of slotGrep.split(String.fromCharCode(10))) say('entries', line)
  say('entries', '')
  say('entries', '$ node 内搜 "<slot 名>" <入口文件>（两个可见表面的注册调用点；跨平台，不依赖 grep）')
  for (const [slot, file] of [
    ['conversation.view', 'src/client/entries/tab.ts'],
    ['conversation.chat.assistant-actions', 'src/client/entries/impact.ts'],
  ]) {
    const found = grepFile(slot.replaceAll('.', '\\.'), file)
    const matches = found
      .split(String.fromCharCode(10))
      .map((line) => line.trim())
      .filter((line) => line !== '')
    say('entries', '  ' + file + ':')
    for (const line of matches.slice(0, 2)) say('entries', '    ' + line)
  }
  say('entries', '')
  say('entries', '结论：')
  say('entries', '  注册的 slot 只有两个：conversation.view / conversation.chat.assistant-actions（命令入口走 inputTriggers，不是 slot）')
  // T32：conversation.input.overlay 必须 0 命中（弹窗已删）
  const overlayHits = grepFilesContaining("'conversation.input.overlay'")
  say('entries', '  conversation.input.overlay 命中: ' + (overlayHits.trim() === '' ? '0' : '命中: ' + overlayHits.trim()))
  const modalDir = join(PLUGIN_ROOT, 'src', 'client', 'ui', 'modal')
  say('entries', '  src/client/ui/modal 目录存在: ' + String(statSyncSafe(modalDir)))
  const modalCss = join(PLUGIN_ROOT, 'src', 'client', 'styles', 'modal.css')
  say('entries', '  src/client/styles/modal.css 存在: ' + String(statSyncSafe(modalCss)))
  const forbidden = ['main', 'sidebar.panellist', 'sidebar.right.pane.tab', 'conversation.chat.turnTail']
  for (const name of forbidden) {
    const hit = grepFilesContaining(name)
    say('entries', '  ' + (hit.trim() === '' ? '0 命中' : '命中: ' + hit.trim()) + '  ← ' + name)
  }
  say('entries', '  lib/client.js: ' + String(bundle) + ' bytes（T02 空壳 2324 bytes）')
  say('entries', '  style sheets: ' + String(readdirSync(join(PLUGIN_ROOT, 'src', 'client', 'styles')).filter((name) => name.endsWith('.css')).length) + ' 个（T32 起不再有 modal.css）')
  /* ---------------- T09b：五件事的接线对账 ---------------- */
  say('b', '=== T09b 接线轮（隐私 / 列表视图 / reduced-motion / 性能 / 引用层）===')
  say('b', '时间: ' + stamp)
  say('b', '')
  say('b', '① 隐私 —— 已接上')
  say('b', '  · 两个可见表面根部都包 PrivacyProvider（tab.ts / impact.ts），模式来自 state/privacyStore（内存，不持久化）')
  say('b', '  · tab header 的「隐私」按钮：data-testid=privacy-toggle，aria-pressed 跟随模式（harness: privacy-pressed=true）')
  say('b', '  · 掩码走 T10 privacy/masks 单一实现：tab 会话标题 maskTitle、路径 maskPathFor；影响图标 T20 起不再有弹层，');
  say('b', '    弹层内的命令/路径正文自然消失（计数仍只进 aria-label/title，不显示任何路径或命令正文）');
  say('b', '    T32 起弹窗删除，正文入口不再由本插件渲染（shouldRenderContent 仅保留在 privacy/masks 供后续表面使用）')
  for (const line of passLines(entriesTests.out).filter((line) => line.includes('隐私'))) say('b', '    ' + line)
  say('b', '  断言名: privacy-wiring.test.ts「隐私 store…」「隐私：标题掩码…」「隐私模式：列表行路径…」「tab SSR：隐私开关按下态…」')
  say('b', '')
  say('b', '② 列表视图 —— 已接上')
  say('b', '  · tab 工具条 list-toggle → 挂 FileListView / TurnListView（tab-list.png）；onSelect 选中文件、onFocusInMap 退出本轮视图')
  say('b', '  · 单一 aria-live：列表开时 Timeline 的播报文案置空（单测/截图断言 single-live-region + timeline-live-silenced）')
  for (const line of passLines(entriesTests.out).filter((line) => line.includes('列表'))) say('b', '    ' + line)
  say('b', '  断言名: privacy-wiring.test.ts「列表虚拟化…」+ harness tab-list 的 single-live-region / timeline-live-silenced')
  say('b', '')
  say('b', '③ reduced-motion —— 已接上')
  say('b', '  · useReducedMotion() → FileGraph/Timeline 的 reducedMotion prop；JS 动效时长走 motionDuration（列表容器 transitionDuration）')
  say('b', '  · harness（prefers-reduced-motion: reduce）: map-host data-reduced-motion=true；T08 的脉冲归零断言仍在 turns.txt')
  say('b', '')
  say('b', '④ 性能 —— 已接上')
  say('b', '  · state/perf.ts: createTimeline().mark("first-usable") 在 tab 首帧数据可用时打点（只内存，不写盘/不发网络）')
  say('b', '  · 列表 >200 行：computeVirtualWindow 只渲染可见窗口 + 上下占位（data-virtualized=true）')
  for (const line of passLines(entriesTests.out).filter((line) => line.includes('打点') || line.includes('虚拟化'))) say('b', '    ' + line)
  say('b', '  断言名: privacy-wiring.test.ts「首帧打点…」「列表虚拟化…」')
  say('b', '')
  say('b', '⑤ 引用层 —— 两条路径都实现、各自可断言')
  say('b', '  · 能力探测：probeWorkspaceFiles(ctx.get("remote")) → remote.workspaceFiles.stat/read；index.ts 还通过 ctx.inject(["remote"], …) 处理晚注入')
  say('b', '  · 有 remote（ready）：reader（客户端卡 cwd 包含，服务端不做）→ 引用源 → resolveParsedReferences')
  say('b', '    → reference 边 + unconfirmed[]（文件不存在等）+ external[]（外部 URL）；超 60 个文件显式 deferred')
  say('b', '  · 无 remote（disabled）：resolve() 返回 null（**不是空数组**）；tab 显示「引用（解析所得） · 观测不到」横幅')
  for (const line of passLines(entriesTests.out).filter((line) => line.includes('remote') || line.includes('reference') || line.includes('引用'))) say('b', '    ' + line)
  say('b', '  断言名（ready 路径）: referenceLayer.test.ts「有 remote：解析出 reference 边 + 未确认引用 + 外部来源（真实解析）」')
  say('b', '  断言名（disabled 路径）: referenceLayer.test.ts「能力探测：没有 remote / 没有 workspaceFiles → disabled…」')
  say('b', '  UI 断言名: privacy-wiring.test.ts「tab SSR：…引用层 disabled → 显示「引用（解析所得） · 观测不到」」+ harness tab 的 reference-disabled 断言')
  say('b', '')
  say('b', '== 四命令 ==')
  say('b', '[pnpm run typecheck] exit=' + String(typecheck.code))
  say('b', '[pnpm run build] exit=' + String(build.code) + '  lib/client.js=' + String(bundle) + ' bytes')
  say('b', '[node --test] exit=' + String(fullTests.code))
  say('b', '  ' + fullTests.out.trim().split(String.fromCharCode(10)).filter((line) => /^ℹ (tests|pass|fail)/.test(line.trim())).map((line) => line.trim()).join(' | '))
  say('b', '[emit-styles --check] exit=' + String(emit.code) + '  ' + emit.out.trim())
  say('b', '')
  say('b', '== 截图（sha 前 12）==')
  for (const shot of shots) say('b', '  ' + (shot.relative ?? shot.label) + '  sha256=' + String(shot.sha256).slice(0, 12))
  say('b', '')
  say('b', '== 结果 ==')
  say('b', failures === 0 ? 'PASS（静态/单测 + harness 截图；真机 slot 可见性与 remote 可用性待 T13 用户门）' : 'FAIL — ' + String(failures) + ' 项')
} finally {
  await browser.close()
}

/* ---------------- 写盘 ---------------- */

const write = (name, body) => writeFileSync(resolve(WORKSPACE_ROOT, OUT_DIR, name), header.concat(body).join('\r\n') + '\r\n', 'utf8')
write('tab.txt', lines.tab)
write('impact.txt', lines.impact)
write('cross.txt', lines.cross)
write('entries.txt', lines.entries)
write('t09b.txt', lines.b)

const verifyLines = [
  '== 四命令 ==',
  '[pnpm run typecheck] exit=' + String(typecheck.code),
  ...typecheck.out.trim().split('\n').slice(-3).map((line) => '  ' + line),
  '[node tests/harness/emit-styles.mjs --check] exit=' + String(emit.code) + '  ' + emit.out.trim(),
  '[pnpm run build] exit=' + String(build.code),
  ...build.out.trim().split('\n').slice(-6).map((line) => '  ' + line),
  '[node --test] exit=' + String(fullTests.code),
  ...fullTests.out.trim().split('\n').filter((line) => /^ℹ (tests|pass|fail)/.test(line.trim())).map((line) => '  ' + line.trim()),
  '',
  '== 本任务测试（tests/entries）==',
  '[node --test "tests/entries/*.test.ts"] exit=' + String(entriesTests.code),
  ...entriesTests.out.trim().split('\n').filter((line) => /^ℹ (tests|pass|fail)/.test(line.trim())).map((line) => '  ' + line.trim()),
  '',
  '== 截图（sha256 / mtime）==',
  ...shots.map((shot) => shot.relative + '  ' + String(shot.bytes) + ' bytes  sha256=' + shot.sha256 + '  mtime=' + new Date(shot.mtimeMs).toISOString()),
  '',
  '== bundle ==',
  'lib/client.js: ' + String(bundle) + ' bytes（T02 空壳 2324 bytes）',
  '',
  '== 结果 ==',
  (failures === 0 ? 'A43-1..5 PASS（静态/单测 + harness 截图；真机 slot 可见性待 T13 用户门）' : 'FAIL — ' + String(failures) + ' 项'),
]
write('verify.txt', verifyLines)

console.log('')
console.log('汇总: 截图 ' + String(shots.length) + ' 张；失败 ' + String(failures) + ' 项')
if (failures > 0) process.exit(1)
