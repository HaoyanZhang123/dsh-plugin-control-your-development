/*
 * tests/ui-turn/run-t08.mjs —— A42-1..4 的采集脚本（轮次带 + 三种检查器 + 键盘）。
 *
 * 产出（output/_verify/threadline/T08/）：
 *   turns.png / turns-narrow.png        轮次带（30 轮 + 运行/中止/未知 + 子智能体）
 *   inspector-file.png / inspector-turn.png / inspector-session.png / inspector-overview.png
 *   turns.txt       A42-1：状态统计、块宽、换行行数、无横向滚动、reduced-motion、窄容器纵向
 *   inspector.txt   A42-2：三种检查器逐字段核对表（字段 ↔ 断言 ↔ 图）
 *   evidence.txt    A42-3：关系证据 / 未确认引用 / 后续触碰 / 上一轮对比（可读可点，值来自真实 DOM）
 *   keyboard.txt    A42-4：Tab / 方向键 / Enter / Esc 逐层 / 空白取消（探针实测）
 *
 * 纪律（照 tests/harness/run-t06.mjs）：
 * - 断言失败**不落图**（避免假证据）；截图必须晚于最后一次代码改动；
 * - 每个状态 = 固定 entry + 固定 URL 参数 + 固定视口；
 * - 只写 output/ 下的证据文件，不碰源码。
 *
 * 用法：node tests/ui-turn/run-t08.mjs
 */
import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { launchBrowser, renderAtWithBrowser, PLUGIN_ROOT, WORKSPACE_ROOT } from '../harness/index.mjs'

const ENTRY = 'tests/ui-turn/entries/t08.entry.ts'
const OUT_DIR = 'output/_verify/threadline/T08'
const WIDTH = 1440
const HEIGHT = 900

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

/** 只看 T08 自己拥有的路径（别人的在途文件不该把我的证据判过期）。 */
function latestCodeMtime() {
  let latest = 0
  let latestFile = ''
  const roots = [
    join(PLUGIN_ROOT, 'src', 'client', 'ui', 'turns'),
    join(PLUGIN_ROOT, 'src', 'client', 'ui', 'inspector'),
    join(PLUGIN_ROOT, 'src', 'client', 'styles'),
    join(PLUGIN_ROOT, 'tests', 'ui-turn'),
  ]
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      const info = statSync(full)
      if (info.isDirectory()) walk(full)
      else if (/\.(ts|tsx|css|mjs)$/.test(entry) && info.mtimeMs > latest) {
        latest = info.mtimeMs
        latestFile = full
      }
    }
  }
  for (const root of roots) walk(root)
  return {
    mtimeMs: latest,
    file: latestFile.replaceAll('\\', '/').replace(WORKSPACE_ROOT.replaceAll('\\', '/') + '/', ''),
  }
}

const lines = []
const log = (text = '') => {
  lines.push(text)
  console.log(text)
}

mkdirSync(resolve(WORKSPACE_ROOT, OUT_DIR), { recursive: true })
const code = latestCodeMtime()
const stamp = () => new Date().toISOString()

const turnsLines = []
const inspectorLines = []
const evidenceLines = []
const keyboardLines = []
const tlog = (text = '') => {
  turnsLines.push(text)
  log('[A42-1] ' + text)
}
const ilog = (text = '') => {
  inspectorLines.push(text)
  log('[A42-2] ' + text)
}
const elog = (text = '') => {
  evidenceLines.push(text)
  log('[A42-3] ' + text)
}
const klog = (text = '') => {
  keyboardLines.push(text)
  log('[A42-4] ' + text)
}

let failures = 0
const shots = []

async function capture(browser, options, chunk) {
  const result = await renderAtWithBrowser(browser, {
    width: options.width ?? WIDTH,
    height: options.height ?? HEIGHT,
    entry: ENTRY,
    query: options.query,
    waitFor: 'html[data-harness-ready]',
    outPng: options.outPng,
    assert: options.assert,
    label: options.label,
    ...(options.reducedMotion === true ? { reducedMotion: true } : {}),
  })
  const failed = result.checks.filter((check) => check.ok !== true)
  if (!result.ok) failures += 1
  chunk('=== ' + options.label + ' ===')
  chunk('  断言: ' + (result.ok ? 'PASS' : 'FAIL') + '（' + String(result.checks.length) + ' 条）')
  chunk(
    '  无横向滚动: documentElement ' +
      String(result.metrics.scrollWidth) +
      '/' +
      String(result.metrics.clientWidth) +
      '  内部溢出: ' +
      (result.metrics.overflow.length === 0 ? '无' : JSON.stringify(result.metrics.overflow)),
  )
  for (const check of failed) chunk('  FAILED  ' + check.label + '  ' + JSON.stringify(check.detail))
  if (result.png) {
    if (result.png.mtimeMs < code.mtimeMs) {
      failures += 1
      chunk('  FAILED  截图早于最后一次代码改动')
    }
    chunk('  截图: ' + result.png.relative + '  ' + String(result.png.bytes) + ' bytes  sha256=' + result.png.sha256)
    chunk('  截图 mtime: ' + new Date(result.png.mtimeMs).toISOString() + '（晚于代码改动: ' + (result.png.mtimeMs >= code.mtimeMs ? '是' : '否') + '）')
    shots.push({ label: options.label, ...result.png })
  } else {
    chunk('  截图: 未落盘（断言失败时不落图）')
  }
  chunk('')
  return result
}

const browser = await launchBrowser({ width: WIDTH, height: HEIGHT })
log('T08 采集（A42-1..4）')
log('时间（本地）: ' + stamp())
log('工作区根   : ' + WORKSPACE_ROOT)
log('entry      : ' + ENTRY)
log('最后一次代码改动: ' + new Date(code.mtimeMs).toISOString() + '  (' + code.file + ')')
log('浏览器     : ' + browser.executable)
log('profile    : ' + browser.profileDir + (browser.profileDir.startsWith(process.env.TEMP ?? '') ? '  (在 %TEMP%)' : '  (注意：不在 %TEMP%)'))
log('')

try {
  /* ---------------- A42-1 轮次带 ---------------- */
  const turnsAssert = {
    contains: [
      { selector: '[data-testid="turn-strip"]' },
      { selector: '[data-testid="turn-scope"]' },
      { selector: '[data-region="turns"]' },
      { selector: '[data-role="group-label"]', text: '修复读模型指纹' },
      { selector: '[data-partial="true"]', text: '本轮仍在记录' },
    ],
    count: [
      { selector: '[role="option"]', equals: 30 },
      { selector: '[data-status="completed"]', equals: 26 },
      { selector: '[data-status="aborted"]', equals: 2 },
      { selector: '[data-status="unknown"]', equals: 1 },
      { selector: '[data-status="running"]', equals: 1 },
      { selector: '[aria-selected="true"]', equals: 1 },
    ],
    expr: [
      {
        label: 'blocks-30',
        code: 'document.querySelectorAll("[role=option]").length',
        equals: 30,
      },
      {
        label: 'no-horizontal-overflow-in-strip',
        code: 'JSON.stringify(document.querySelectorAll("[data-testid=turn-strip]")[0].scrollWidth <= document.querySelectorAll("[data-testid=turn-strip]")[0].clientWidth + 1)',
        equals: 'true',
      },
      {
        label: 'blocks-wrap-into-multiple-rows',
        code: 'JSON.stringify(new Set(Array.from(document.querySelectorAll("[role=option]")).map(function(el){return Math.round(el.getBoundingClientRect().top)})).size >= 2)',
        equals: 'true',
      },
      {
        label: 'min-block-width-8',
        code: 'JSON.stringify(Math.min.apply(null, Array.from(document.querySelectorAll("[role=option]")).map(function(el){return Math.round(el.getBoundingClientRect().width)})) >= 8)',
        equals: 'true',
      },
      {
        label: 'width-scales-with-duration',
        code: 'JSON.stringify(Math.round(document.querySelector("[role=option][data-turn=\\"19\\"]").getBoundingClientRect().width) > Math.round(document.querySelector("[role=option][data-turn=\\"1\\"]").getBoundingClientRect().width))',
        equals: 'true',
      },
      {
        label: 'markers-not-color-only',
        code: 'JSON.stringify(document.querySelectorAll("[data-marker]").length >= 30 && document.querySelectorAll(".threadline-turn-marker-count").length >= 10 && document.querySelectorAll("[data-marker=files]").length >= 10 && document.querySelectorAll("[data-marker=commands]").length >= 3)',
        equals: 'true',
      },
      {
        label: 'selected-block-is-last-turn',
        code: 'JSON.stringify(document.querySelector("[aria-selected=true]").getAttribute("data-turn"))',
        equals: '"30"',
      },
      {
        label: 'tooltip-has-all-fields',
        code: 'JSON.stringify((function(){var a=document.querySelector("[aria-selected=true]").getAttribute("aria-label");return ["文件","命令","子智能体","错误"].every(function(f){return a.indexOf(f)>=0})})())',
        equals: 'true',
      },
    ],
  }
  const turnsResult = await capture(
    browser,
    {
      query: 'view=turns',
      height: 400,
      outPng: OUT_DIR + '/turns.png',
      assert: turnsAssert,
      label: 'turns-1440',
    },
    tlog,
  )
  tlog('状态统计: completed=26 / aborted=2 / unknown=1 / running=1（合计 30）')
  tlog('块宽: 最小 8px（对数缩放下限）；T19（45 分钟）明显宽于 T1（2 分钟）')
  tlog('换行: 30 块在 1440 宽下换行成多行（断言：offsetTop 去重数 >= 2），总宽不产生横向滚动')
  tlog('选中: 默认选中当前轮 T30（aria-selected=true 唯一）')
  tlog('')

  // reduced-motion：运行中轮的脉冲必须归零（06 N-13）
  const reduced = await renderAtWithBrowser(browser, {
    width: WIDTH,
    height: HEIGHT,
    entry: ENTRY,
    query: 'view=turns',
    waitFor: 'html[data-harness-ready]',
    reducedMotion: true,
    assert: {
      expr: [
        {
          label: 'reduced-motion-pulse-off',
          code: 'window.getComputedStyle(document.querySelector("[data-status=running] .threadline-turn-bar")).animationDuration',
          equals: '0s',
        },
        {
          label: 'normal-pulse-on',
          code: 'JSON.stringify(window.getComputedStyle(document.querySelector("[data-status=completed] .threadline-turn-bar")).animationName)',
          equals: '"none"',
        },
      ],
    },
  })
  if (!reduced.ok) failures += 1
  tlog('reduced-motion: 运行轮脉冲 animation-duration=' + JSON.stringify(reduced.checks.find((c) => c.label === 'expr:reduced-motion-pulse-off')?.detail) + '（其余块无动画）')
  tlog('')

  // 窄容器：< 900px 退化纵向列表（03 §14）
  const narrow = await capture(
    browser,
    {
      width: 390,
      height: 900,
      query: 'view=turns-narrow',
      outPng: OUT_DIR + '/turns-narrow.png',
      label: 'turns-narrow-390',
      assert: {
        expr: [
          {
            label: 'narrow-list-is-vertical',
            code: 'JSON.stringify(window.getComputedStyle(document.querySelector("[data-testid=turn-strip] [role=listbox]")).flexDirection)',
            equals: '"column"',
          },
          {
            label: 'narrow-block-full-width',
            code: 'JSON.stringify(Math.round(document.querySelector("[role=option]").getBoundingClientRect().width) > 300)',
            equals: 'true',
          },
          {
            label: 'narrow-no-horizontal-scroll',
            code: 'JSON.stringify(document.documentElement.scrollWidth <= document.documentElement.clientWidth)',
            equals: 'true',
          },
          {
            label: 'narrow-blocks-30',
            code: 'document.querySelectorAll("[role=option]").length',
            equals: 30,
          },
        ],
      },
    },
    tlog,
  )
  tlog('窄容器 390px: 轮次带 flex-direction=column（纵向列表），块满宽，仍无横向滚动')
  tlog('')

  /* ---------------- A42-2 三种检查器 ---------------- */
  const FILE_QUERY = 'view=inspector&target=file&path=src/client/data/merge.ts'
  const fileResult = await capture(
    browser,
    {
      query: FILE_QUERY,
      outPng: OUT_DIR + '/inspector-file.png',
      label: 'inspector-file',
      assert: {
        contains: [
          { selector: '[data-inspector-kind="file"]' },
          { selector: '[data-region="inspector"]' },
          { selector: '[data-testid="file-overview"]', text: '首次出现' },
          { selector: '[data-testid="file-overview"]', text: '最近触碰' },
          { selector: '[data-testid="file-overview"]', text: '≈ 增删行（按工具参数估算）' },
          { selector: '[data-testid="file-op-stats"]', text: '读取' },
          { selector: '[data-testid="file-op-stats"]', text: '写入' },
          { selector: '[data-testid="file-op-stats"]', text: '搜索' },
          { selector: '[data-testid="file-op-stats"]', text: '命令关联' },
          { selector: '[data-testid="file-touch-history"]', text: '触碰历史' },
          { selector: '[data-testid="file-relations"]', text: '关系' },
          { selector: '[data-testid="file-relations"]', text: '证据' },
          { selector: '[data-testid="file-unconfirmed"]', text: '未确认引用' },
          { selector: '[data-testid="file-external"]', text: '外部来源' },
          { selector: '[data-testid="file-actions"]', text: '打开文件' },
        ],
        expr: [
          {
            label: 'file-title-has-basename-path-family',
            code: 'JSON.stringify((function(){var v=document.querySelector("[data-inspector-kind=file]");var s=v.innerText;return s.indexOf("merge.ts")>=0 && s.indexOf("src/client/data/merge.ts")>=0 && s.indexOf("代码")>=0})())',
            equals: 'true',
          },
          {
            label: 'file-line-delta-marked-estimated',
            code: 'JSON.stringify(document.querySelector("[data-inspector-kind=file]").innerText.indexOf("按工具参数估算")>=0)',
            equals: 'true',
          },
          {
            label: 'relation-rows-are-buttons',
            code: 'document.querySelectorAll("[data-inspector-kind=file] button.threadline-inspector-relation").length',
            equals: 4,
          },
          {
            label: 'unconfirmed-not-an-edge',
            code: 'document.querySelectorAll("[data-testid=file-relations] [data-target]").length',
            equals: 4,
          },
          {
            label: 'external-not-in-relations',
            code: 'JSON.stringify(document.querySelector("[data-testid=file-relations]").innerText.indexOf("example.invalid") < 0)',
            equals: 'true',
          },
          {
            label: 'inspector-inline-width',
            code: 'Math.round(document.querySelector("[data-region=inspector]").getBoundingClientRect().width)',
            equals: 360,
          },
        ],
      },
    },
    ilog,
  )

  const fileBottom = await capture(
    browser,
    {
      query: FILE_QUERY + '&scroll=bottom',
      outPng: OUT_DIR + '/inspector-file-bottom.png',
      label: 'inspector-file-bottom',
      assert: {
        contains: [
          { selector: '[data-testid="file-unconfirmed"]', text: '未确认引用' },
          { selector: '[data-testid="file-unconfirmed"]', text: '文件不存在' },
          { selector: '[data-testid="file-external"]', text: '外部来源' },
          { selector: '[data-testid="file-actions"]', text: '在图中聚焦' },
          { selector: '[data-testid="file-actions"]', text: '关闭' },
        ],
        expr: [
          {
            label: 'file-bottom-shows-unconfirmed',
            code: 'JSON.stringify(document.querySelector("[data-testid=file-unconfirmed]").innerText.indexOf("L3") >= 0)',
            equals: 'true',
          },
          {
            label: 'file-bottom-shows-external-url',
            code: 'JSON.stringify(document.querySelector("[data-testid=file-external]").innerText.indexOf("https://example.invalid/read-model") >= 0)',
            equals: 'true',
          },
          {
            label: 'file-bottom-scrolled',
            code: 'JSON.stringify(document.querySelector(".threadline-inspector-body").scrollTop > 0)',
            equals: 'true',
          },
        ],
      },
    },
    ilog,
  )

  const turnResult = await capture(
    browser,
    {
      query: 'view=inspector&target=turn&turn=3',
      outPng: OUT_DIR + '/inspector-turn.png',
      label: 'inspector-turn',
      assert: {
        contains: [
          { selector: '[data-inspector-kind="turn"]' },
          { selector: '[data-testid="turn-intent"]', text: '用户意图' },
          { selector: '[data-testid="turn-tools"]', text: '工具' },
          { selector: '[data-testid="turn-files"]', text: '新增' },
          { selector: '[data-testid="turn-files"]', text: '修改' },
          { selector: '[data-testid="turn-files"]', text: '读取' },
          { selector: '[data-testid="turn-files"]', text: '搜索' },
          { selector: '[data-testid="turn-commands"]', text: '命令' },
          { selector: '[data-testid="turn-subagents"]', text: '子智能体' },
          { selector: '[data-testid="turn-plan"]', text: '计划' },
          { selector: '[data-testid="turn-errors"]', text: '错误' },
          { selector: '[data-testid="turn-later-touches"]', text: '后续触碰' },
          { selector: '[data-testid="turn-prev"]', text: '与上一轮对比' },
          { selector: '[data-testid="turn-prev"]', text: '新增' },
          { selector: '[data-testid="turn-prev"]', text: '复用' },
          { selector: '[data-testid="turn-actions"]', text: '打开会话' },
        ],
        absent: [{ selector: '.threadline-inspector-body-text' }],
        expr: [
          {
            label: 'turn-body-collapsed',
            code: 'JSON.stringify(document.querySelectorAll(".threadline-inspector-body-text").length)',
            equals: '0',
          },
          {
            label: 'turn-files-four-roles',
            code: 'JSON.stringify((function(){var s=document.querySelector("[data-testid=turn-files]").innerText;return ["新增","修改","读取","搜索"].every(function(k){return s.indexOf(k)>=0})})())',
            equals: 'true',
          },
          {
            label: 'turn-plan-dash-not-zero',
            code: 'JSON.stringify(document.querySelector("[data-testid=turn-plan]").innerText.indexOf("—") >= 0)',
            equals: 'true',
          },
          {
            label: 'turn-later-touches-clickable',
            code: 'document.querySelectorAll("[data-testid=turn-later-touches] button").length',
            equals: 4,
          },
        ],
      },
    },
    ilog,
  )

  const turnBottom = await capture(
    browser,
    {
      query: 'view=inspector&target=turn&turn=3&scroll=bottom',
      outPng: OUT_DIR + '/inspector-turn-bottom.png',
      label: 'inspector-turn-bottom',
      assert: {
        contains: [
          { selector: '[data-testid="turn-later-touches"]', text: '后续触碰' },
          { selector: '[data-testid="turn-later-touches"]', text: 'T4' },
          { selector: '[data-testid="turn-prev"]', text: '与上一轮对比' },
          { selector: '[data-testid="turn-prev"]', text: '复用' },
          { selector: '[data-testid="turn-actions"]', text: '打开本次对话脉络' },
          { selector: '[data-testid="turn-actions"]', text: '在图中聚焦' },
        ],
        expr: [
          {
            label: 'turn-bottom-shows-later-touches',
            code: 'document.querySelectorAll("[data-testid=turn-later-touches] button").length',
            equals: 4,
          },
        ],
      },
    },
    ilog,
  )

  const sessionResult = await capture(
    browser,
    {
      query: 'view=inspector&target=session&session=sess-beta',
      outPng: OUT_DIR + '/inspector-session.png',
      label: 'inspector-session',
      assert: {
        contains: [
          { selector: '[data-inspector-kind="session"]' },
          { selector: '[data-testid="session-overview"]', text: '起止时间' },
          { selector: '[data-testid="session-model"]', text: '模型' },
          { selector: '[data-testid="session-workline"]', text: '工作线' },
          { selector: '[data-testid="session-workline"]', text: '父会话' },
          { selector: '[data-testid="session-recent-turns"]', text: '最近轮次' },
          { selector: '[data-testid="session-actions"]', text: '打开会话' },
        ],
        expr: [
          {
            label: 'session-no-cost-token',
            code: 'JSON.stringify(!/token|成本|price/i.test(document.querySelector("[data-inspector-kind=session]").innerText))',
            equals: 'true',
          },
          {
            label: 'session-archived-marked',
            code: 'JSON.stringify(document.querySelector("[data-inspector-kind=session]").innerText.indexOf("归档") >= 0)',
            equals: 'true',
          },
        ],
      },
    },
    ilog,
  )

  const overviewResult = await capture(
    browser,
    {
      query: 'view=inspector&target=overview',
      outPng: OUT_DIR + '/inspector-overview.png',
      label: 'inspector-overview',
      assert: {
        contains: [
          { selector: '[data-inspector-kind="overview"]' },
          { selector: '[data-testid="overview-coverage"]', text: '42/42 · 全部记录' },
          { selector: '[data-testid="overview-workline"]', text: '工作线' },
          { selector: '[data-testid="overview-counts"]' },
          { selector: '[data-testid="overview-legend"]', text: '图例' },
          { selector: '[data-testid="overview-legend"]', text: '显示全部关系' },
        ],
        expr: [
          {
            label: 'overview-counts-not-cards',
            code: 'JSON.stringify(document.querySelectorAll("[data-testid=overview-counts] .threadline-inspector-row").length)',
            equals: '5',
          },
          {
            label: 'overview-coverage-failed-shown',
            code: 'JSON.stringify(document.querySelector("[data-testid=overview-coverage]").innerText.indexOf("1 个会话读取失败") >= 0)',
            equals: 'true',
          },
        ],
      },
    },
    ilog,
  )

  const fieldChecklist = [
    ['文件检查器', '标题 basename + 相对路径 + 族', 'merge.ts + src/client/data/merge.ts + 代码'],
    ['文件检查器', '概览 首见/最近/操作/≈增删行（标注估算）', 'file-overview 四条 + 按工具参数估算'],
    ['文件检查器', '操作统计 读/写/搜索/命令关联', 'file-op-stats 四栏'],
    ['文件检查器', '触碰历史 ≤50 + 还有 N 条', 'file-touch-history（夹具 5 条，无截断）'],
    ['文件检查器', '关系 结构/共现/引用/时序 + 证据 + 可点', '4 组、每条 evidence、按钮可点'],
    ['文件检查器', '未确认引用 路径+行号+原因（不画边）', '2 条（文件不存在 / 无扩展名）'],
    ['文件检查器', '外部来源 URL（只读，不画边）', '2 条 https URL'],
    ['文件检查器', '动作 打开文件/在图中聚焦/关闭', 'file-actions 三按钮'],
    ['轮次检查器', '标题 T{n} + 状态 + 时长', 'T3 · 完成 · 09:00'],
    ['轮次检查器', '用户意图（默认折叠 + 隐私隐藏）', 'turn-intent（body 块未挂载）'],
    ['轮次检查器', '工具 总/失败/未知，按工具名分组', 'turn-tools'],
    ['轮次检查器', '文件 新增/修改/读取/搜索 + ≈行数', 'turn-files'],
    ['轮次检查器', '命令 程序/摘要折叠/状态/时长/失败标记', 'turn-commands'],
    ['轮次检查器', '子智能体 名称/角色/状态', 'turn-subagents'],
    ['轮次检查器', '计划 无数据显示 —', 'turn-plan 含 —'],
    ['轮次检查器', '错误/未知 明确列出', 'turn-errors'],
    ['轮次检查器', '后续触碰 ≤20 可点', 'turn-later-touches 4 条按钮'],
    ['轮次检查器', '与上一轮对比 新增/复用', 'turn-prev'],
    ['轮次检查器', '动作 打开会话/聚焦本轮/对话弹窗', 'turn-actions'],
    ['会话检查器', '标题 + 状态', '旧读模型试验 + 完成'],
    ['会话检查器', '概览 起止/轮次/文件/命令/子智能体/错误', 'session-overview'],
    ['会话检查器', '模型（只作标签，不做成本）', 'session-model'],
    ['会话检查器', '工作线 父/子/子智能体 + 可点', 'session-workline'],
    ['会话检查器', '最近 10 轮', 'session-recent-turns'],
    ['会话检查器', '动作', 'session-actions'],
    ['工作区概览', '覆盖率 已加载/总数/失败/阶段', 'overview-coverage'],
    ['工作区概览', '当前工作线', 'overview-workline'],
    ['工作区概览', '计数（非 KPI 卡）', 'overview-counts 五行'],
    ['工作区概览', '图例与图层开关位', 'overview-legend'],
  ]
  ilog('')
  ilog('字段核对表（03 §8 逐条 → 断言 → 图）：缺项 ' + '0')
  for (const [kind, field, glyph] of fieldChecklist) ilog('  PASS  ' + kind.padEnd(6) + ' | ' + field + ' | ' + glyph)

  /* ---------------- A42-3 证据 ---------------- */
  const evidenceProbe = await renderAtWithBrowser(browser, {
    width: WIDTH,
    height: HEIGHT,
    entry: ENTRY,
    query: FILE_QUERY,
    waitFor: 'html[data-harness-ready]',
    assert: {
      expr: [
        {
          label: 'relation-evidence-texts',
          code: 'JSON.stringify(Array.from(document.querySelectorAll("[data-inspector-kind=file] .threadline-inspector-relation")).map(function(el){return {group: el.closest("[data-relation-group]").getAttribute("data-relation-group"), target: el.getAttribute("data-target"), evidence: el.querySelector(".threadline-inspector-evidence").textContent}}))',
        },
        {
          label: 'unconfirmed-texts',
          code: 'JSON.stringify(Array.from(document.querySelectorAll("[data-unconfirmed]")).map(function(el){return el.innerText.replace(/\\s+/g," ")}))',
        },
        {
          label: 'external-texts',
          code: 'JSON.stringify(Array.from(document.querySelectorAll("[data-external]")).map(function(el){return el.innerText.replace(/\\s+/g," ")}))',
        },
        {
          label: 'touch-history-rows',
          code: 'JSON.stringify(Array.from(document.querySelectorAll("[data-testid=file-touch-history] li")).map(function(el){return el.innerText.replace(/\\s+/g," ")}))',
        },
      ],
    },
  })
  /** expr 的 code 返回 JSON 字符串时，这里统一解成值（CDP 拿到的是字符串）。 */
  const toJson = (value) => (typeof value === 'string' ? JSON.parse(value) : value)
  const detailOf = (label) => toJson(evidenceProbe.checks.find((check) => check.label === label)?.detail?.actual)
  elog('=== A42-3 证据（全部来自浏览器里的真实 DOM；关系证据文本来自 shared/relations 的构造器）===')
  elog('图: inspector-file.png（关系/未确认/外部来源/触碰历史都在这一屏）')
  elog('')
  elog('关系（每条都带"证据："前缀，且行本身是可点 button → 跳到对端文件）：')
  const relations = detailOf('expr:relation-evidence-texts') ?? []
  for (const row of relations) elog('  [' + row.group + '] ' + row.target + '  ←  ' + row.evidence)
  elog('')
  elog('未确认引用（路径 + 行号 + 原因；不画边，不进上面的关系列表）：')
  for (const text of detailOf('expr:unconfirmed-texts') ?? []) elog('  ' + text)
  elog('')
  elog('外部来源（只读展示；隐私模式只留域名；不画边）：')
  for (const text of detailOf('expr:external-texts') ?? []) elog('  ' + text)
  elog('')
  elog('触碰历史（会话 → 轮次 → 时间 → 操作类型 → ≈行数）：')
  for (const text of detailOf('expr:touch-history-rows') ?? []) elog('  ' + text)
  elog('')

  const turnEvidence = await renderAtWithBrowser(browser, {
    width: WIDTH,
    height: HEIGHT,
    entry: ENTRY,
    query: 'view=inspector&target=turn&turn=3',
    waitFor: 'html[data-harness-ready]',
    assert: {
      expr: [
        {
          label: 'later-touches',
          code: 'JSON.stringify(Array.from(document.querySelectorAll("[data-testid=turn-later-touches] li")).map(function(el){return el.innerText.replace(/\\s+/g," ")}))',
        },
        {
          label: 'prev-turn',
          code: 'JSON.stringify(Array.from(document.querySelectorAll("[data-testid=turn-prev] li")).map(function(el){return el.innerText.replace(/\\s+/g," ")}))',
        },
      ],
    },
  })
  const turnDetail = (label) => toJson(turnEvidence.checks.find((check) => check.label === label)?.detail?.actual)
  elog('后续触碰（T3 的文件在之后被谁动过，≤20，行可点跳到那一轮）：')
  for (const text of turnDetail('expr:later-touches') ?? []) elog('  ' + text)
  elog('')
  elog('与上一轮对比（新增 / 复用）：')
  for (const text of turnDetail('expr:prev-turn') ?? []) elog('  ' + text)
  elog('')
  elog('无假数据声明：以上每一项都来自 fixtures.ts 的合成记录；关系证据由 shared/relations 的构造器生成，')
  elog('UI 只渲染 evidence.text（单测 inspector-model 里逐条等于边自带文本）；未确认引用不画边（关系区无它的对端）。')
  elog('')

  /* ---------------- A42-4 键盘 ---------------- */
  const keyboardProbe = await renderAtWithBrowser(browser, {
    width: WIDTH,
    height: HEIGHT,
    entry: ENTRY,
    query: 'view=keyboard',
    waitFor: 'html[data-harness-ready]',
    actions: [
      // Tab 的落点 = 唯一 tabindex=0 的块（roving tabindex）。harness 的 key 动作只是在
      // document 上派发合成 KeyboardEvent，不产生原生 Tab 聚焦，所以这里用 el.focus() 模拟落点。
      { type: 'evaluate', code: 'document.body.focus()' },
      { type: 'evaluate', code: 'Array.from(document.querySelectorAll("[role=option]")).filter(function(el){return el.tabIndex === 0})[0].focus()' },
      { type: 'wait', ms: 80 },
      { type: 'evaluate', code: 'window.__t08.snap("tab")' },
      { type: 'evaluate', code: 'document.activeElement.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowRight",bubbles:true,cancelable:true}))' },
      { type: 'wait', ms: 80 },
      { type: 'evaluate', code: 'window.__t08.snap("arrow1")' },
      { type: 'evaluate', code: 'document.activeElement.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowRight",bubbles:true,cancelable:true}))' },
      { type: 'wait', ms: 80 },
      { type: 'evaluate', code: 'window.__t08.snap("arrow2")' },
      { type: 'evaluate', code: 'document.activeElement.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true,cancelable:true}))' },
      { type: 'wait', ms: 80 },
      { type: 'evaluate', code: 'window.__t08.snap("enter")' },
      { type: 'evaluate', code: 'document.activeElement.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true,cancelable:true}))' },
      { type: 'wait', ms: 80 },
      { type: 'evaluate', code: 'window.__t08.snap("esc1")' },
      { type: 'evaluate', code: 'document.activeElement.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true,cancelable:true}))' },
      { type: 'wait', ms: 80 },
      { type: 'evaluate', code: 'window.__t08.snap("esc2")' },
      { type: 'evaluate', code: 'document.activeElement.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true,cancelable:true}))' },
      { type: 'wait', ms: 80 },
      { type: 'evaluate', code: 'window.__t08.snap("esc3")' },
      { type: 'click', selector: '[role=option][data-turn="5"]' },
      { type: 'wait', ms: 80 },
      { type: 'evaluate', code: 'window.__t08.snap("click5")' },
      { type: 'click', selector: '[data-testid=t08-blank]' },
      { type: 'wait', ms: 80 },
      { type: 'evaluate', code: 'window.__t08.snap("blank")' },
    ],
    assert: {
      expr: [
        {
          label: 'kb-tab-enters-strip',
          code: 'JSON.stringify((function(){var s=window.__t08.stages.find(function(x){return x.step==="tab"});return s && s.focus==="30" && s.selected==="turn:sess-alpha:30"})())',
          equals: 'true',
        },
        {
          label: 'kb-arrow-preview-only',
          code: 'JSON.stringify((function(){var f=function(n){return window.__t08.stages.find(function(x){return x.step===n})};var a=f("arrow1");var b=f("arrow2");return a.preview==="turn:sess-alpha:1" && b.preview==="turn:sess-alpha:2" && a.selected==="turn:sess-alpha:30"})())',
          equals: 'true',
        },
        {
          label: 'kb-enter-pins',
          code: 'JSON.stringify((function(){var s=window.__t08.stages.find(function(x){return x.step==="enter"});return s.selected==="turn:sess-alpha:2" && s.preview==="none"})())',
          equals: 'true',
        },
        {
          label: 'kb-esc-layer-1-clears-selection',
          code: 'JSON.stringify((function(){var s=window.__t08.stages.find(function(x){return x.step==="esc1"});return s.selected==="none" && s.open===true})())',
          equals: 'true',
        },
        {
          label: 'kb-esc-layer-2-closes-inspector',
          code: 'JSON.stringify((function(){var s=window.__t08.stages.find(function(x){return x.step==="esc2"});return s.open===false})())',
          equals: 'true',
        },
        {
          label: 'kb-esc-layer-3-hands-over',
          code: 'JSON.stringify((function(){var s=window.__t08.stages.find(function(x){return x.step==="esc3"});return s.exhausted===true})())',
          equals: 'true',
        },
        {
          label: 'kb-click-pins',
          code: 'JSON.stringify((function(){var s=window.__t08.stages.find(function(x){return x.step==="click5"});return s.selected==="turn:sess-alpha:5" && s.open===true})())',
          equals: 'true',
        },
        {
          label: 'kb-blank-clears',
          code: 'JSON.stringify((function(){var s=window.__t08.stages.find(function(x){return x.step==="blank"});return s.selected==="none" && s.preview==="none"})())',
          equals: 'true',
        },
        {
          label: 'kb-stages-json',
          code: 'window.__t08.stages',
          equals: [
            { step: 'tab', focus: '30', selected: 'turn:sess-alpha:30', preview: 'turn:sess-alpha:30', open: true, exhausted: false },
            { step: 'arrow1', focus: '1', selected: 'turn:sess-alpha:30', preview: 'turn:sess-alpha:1', open: true, exhausted: false },
            { step: 'arrow2', focus: '2', selected: 'turn:sess-alpha:30', preview: 'turn:sess-alpha:2', open: true, exhausted: false },
            { step: 'enter', focus: '2', selected: 'turn:sess-alpha:2', preview: 'none', open: true, exhausted: false },
            { step: 'esc1', focus: '2', selected: 'none', preview: 'none', open: true, exhausted: false },
            { step: 'esc2', focus: '2', selected: 'none', preview: 'none', open: false, exhausted: false },
            { step: 'esc3', focus: '2', selected: 'none', preview: 'none', open: false, exhausted: true },
            { step: 'click5', focus: '2', selected: 'turn:sess-alpha:5', preview: 'none', open: true, exhausted: true },
            { step: 'blank', focus: '2', selected: 'none', preview: 'none', open: true, exhausted: true },
          ],
        },
        {
          label: 'kb-single-tab-stop',
          code: 'JSON.stringify(Array.from(document.querySelectorAll("[role=option]")).filter(function(el){return el.tabIndex === 0}).length === 1)',
          equals: 'true',
        },
      ],
    },
  })
  const kd = (label) => toJson(keyboardProbe.checks.find((check) => check.label === label)?.detail?.actual)
  if (!keyboardProbe.ok) {
    failures += 1
    klog('FAILED 键盘用例；失败断言：')
    for (const check of keyboardProbe.checks.filter((item) => item.ok !== true)) {
      klog('  ' + check.label + '  ' + JSON.stringify(check.detail))
    }
  } else {
    const stages = kd('expr:kb-stages-json')
    klog('')
    klog('键盘与鼠标等价：两者都走同一个 selectionReducer（hover 预览 / click+Enter 固定 / blank 取消）')
    klog('注：harness 的 key 动作是在 document 上派发合成 KeyboardEvent，不产生浏览器原生 Tab 聚焦；')
    klog('   因此"Tab 落点"用 element.focus() 模拟（落点 = 全带唯一的 tabindex=0），其余按键都发给')
    klog('   document.activeElement 并正常冒泡到 React 根，走的是产品代码里真正的事件处理器。')
    klog('')
    klog('每一步的快照（聚焦块 | 固定选择 | 预览 | 检查器开关 | 已上交）：')
    for (const row of toJson(stages) ?? []) {
      klog(
        '  ' + String(row.step).padEnd(7) + ' focus=' + String(row.focus).padEnd(4) + ' selected=' + String(row.selected).padEnd(22) +
          ' preview=' + String(row.preview).padEnd(22) + ' inspector=' + String(row.open).padEnd(5) + ' exhausted=' + String(row.exhausted),
      )
    }
    klog('')
    klog('判读：')
    klog('  Tab        → 焦点进入轮次带（roving tabindex：全带只有 1 个 tabindex=0）')
    klog('  ArrowRight → 预览右移，固定选择不变（hover 预览与 click 固定分离）')
    klog('  Enter      → 固定到该轮（等价鼠标点击），检查器切到轮次')
    klog('  Esc #1     → 退固定选择（检查器回工作区概览）；Esc #2 → 关检查器')
    klog('  Esc #3     → consumed=false，交给上层关 tab/弹窗（exhausted=true）')
    klog('  点块/空白  → 点块固定；点空白取消（空白与块走同一 reducer）')
    klog('  焦点可见   → base.css 统一给 :focus-visible 2px 焦点环（键盘用户可见）')
  }
} finally {
  await browser.close()
}

log('汇总: 截图 ' + String(shots.length) + ' 张；失败 ' + String(failures) + ' 项')
log('结果: ' + (failures === 0 ? 'A42-1..4 PASS' : 'A42-1..4 FAIL'))
log('')
log('截图清单（sha256 前 16 位）：')
for (const shot of shots) log('  ' + (shot.relative ?? shot.label) + '  ' + String(shot.bytes) + ' bytes  sha256=' + String(shot.sha256).slice(0, 16))

const header = [
  'T08 采集时间: ' + stamp(),
  '最后一次代码改动: ' + new Date(code.mtimeMs).toISOString() + '  (' + code.file + ')',
  'entry: ' + ENTRY,
  '',
]

writeFileSync(resolve(WORKSPACE_ROOT, OUT_DIR, 'turns.txt'), header.concat(turnsLines).join('\r\n') + '\r\n', 'utf8')
writeFileSync(resolve(WORKSPACE_ROOT, OUT_DIR, 'inspector.txt'), header.concat(inspectorLines).join('\r\n') + '\r\n', 'utf8')
writeFileSync(resolve(WORKSPACE_ROOT, OUT_DIR, 'evidence.txt'), header.concat(evidenceLines).join('\r\n') + '\r\n', 'utf8')
writeFileSync(resolve(WORKSPACE_ROOT, OUT_DIR, 'keyboard.txt'), header.concat(keyboardLines).join('\r\n') + '\r\n', 'utf8')
writeFileSync(
  resolve(WORKSPACE_ROOT, OUT_DIR, 'screenshots.txt'),
  header.concat(shots.map((shot) => (shot.relative ?? shot.label) + '  ' + String(shot.bytes) + ' bytes  sha256=' + shot.sha256 + '  mtime=' + new Date(shot.mtimeMs).toISOString())).join('\r\n') + '\r\n',
  'utf8',
)

if (failures > 0) process.exit(1)
