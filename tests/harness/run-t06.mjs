/*
 * tests/harness/run-t06.mjs —— A40-2 的采集脚本（外壳在 5 个容器宽度下的截图 + 断言）。
 *
 * 产出（output/_verify/threadline/T06/）：
 *   shell-1440.png / shell-1024.png / shell-900.png / shell-600.png / shell-420.png
 *   responsive.txt（每个宽度的原始断言值 + 截图时间戳 + sha256 + "截图晚于最后一次代码改动"的证明）
 *
 * 纪律：
 * - 截图只在**全部断言通过**时才落盘（失败不落图，避免留假证据）；
 * - 每张图对应一个可复现状态：entry 相同、URL 参数相同、视口相同；
 * - 视口宽 = 容器宽（宿主面板宽度的模拟），并额外用"宽视口 + 窄容器"证明布局是容器查询驱动。
 *
 * 用法：node tests/harness/run-t06.mjs
 */
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
// 2026-11-04 Lead：样式源已扩成 styles/*.css 每区域一份，注入的 <style> 数 = STYLE_SHEETS.length，
// 这里不再写死 2（写死会让「新增一个 CSS 文件」变成假红）。
import { STYLE_SHEETS } from '../../src/client/styles/css.ts'
import { launchBrowser, renderAtWithBrowser } from './index.mjs'
import { PLUGIN_ROOT, WORKSPACE_ROOT } from './index.mjs'

const ENTRY = 'tests/harness/entries/shell.entry.ts'
const OUT_DIR = 'output/_verify/threadline/T06'
const HEIGHT = 900
const WIDTHS = [1440, 1024, 900, 600, 420]

/** 容器宽度 → 期望的检查器形态（03 §3.2 / §3.3 / §14）。 */
function inspectorExpectation(width) {
  if (width >= 1100) return { mode: 'inline', position: 'static', width: width >= 1280 ? 360 : 340 }
  if (width >= 600) return { mode: 'overlay', position: 'absolute', width: Math.min(360, Math.round(width * 0.44)) }
  return { mode: 'sheet', position: 'static', width }
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

function latestCodeMtime() {
  let latest = 0
  let latestFile = ''
  // 只看 T06 自己拥有的路径：别人的文件（T04 的 data/ 等）改动不该把我这份证据判成过期。
  const roots = [
    join(PLUGIN_ROOT, 'src', 'client', 'styles'),
    join(PLUGIN_ROOT, 'src', 'client', 'locale'),
    join(PLUGIN_ROOT, 'src', 'client', 'ui'),
    join(PLUGIN_ROOT, 'tests', 'ui-shell'),
    join(PLUGIN_ROOT, 'tests', 'harness'),
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
  return { mtimeMs: latest, file: latestFile.replaceAll('\\', '/').replace(WORKSPACE_ROOT.replaceAll('\\', '/') + '/', '') }
}

function assertionsFor(width) {
  const expectation = inspectorExpectation(width)
  const checks = {
    contains: [
      { selector: '.threadline-app', text: '脉络' },
      { selector: '[data-region="now"]', text: '执行中' },
      { selector: '[data-region="map"]' },
      { selector: '[data-region="timeline"]' },
      { selector: '[data-region="turns"]' },
      { selector: '[data-region="inspector"]', text: '文件' },
      { selector: '.threadline-legend' },
      { selector: '.threadline-pill', text: '正在补全历史 42/267' },
    ],
    styles: [
      { selector: '.threadline-app', property: 'container-type', equals: 'inline-size' },
      { selector: '[data-region="inspector"]', property: 'position', equals: expectation.position },
      { selector: '.threadline-btn', property: 'height', equals: '24px' },
    ],
    boxes: [
      { selector: '[data-region="header"]', minHeight: 56 },
      { selector: '[data-region="timeline"]', equalsHeight: 48 },
    ],
    expr: [
      {
        label: 'inspector-width-' + width,
        code:
          'JSON.parse(JSON.stringify({ w: Math.round(document.querySelector("[data-region=inspector]").getBoundingClientRect().width) })).w',
        equals: expectation.width,
      },
      {
        label: 'turns-direction-' + width,
        code: 'window.getComputedStyle(document.querySelector(".threadline-turns-list")).flexDirection',
        equals: width < 900 ? 'column' : 'row',
      },
      {
        label: 'legend-collapsed-' + width,
        code:
          width < 1100
            ? 'window.getComputedStyle(document.querySelector(".threadline-legend-toggle")).display !== "none"'
            : 'window.getComputedStyle(document.querySelector(".threadline-legend-list")).display',
        equals: width < 1100 ? true : 'flex',
      },
      {
        label: 'timeline-low-priority-' + width,
        code: 'window.getComputedStyle(document.querySelector("[data-tick-priority=low]")).display',
        equals: width < 900 ? 'none' : 'block',
      },
    ],
  }
  if (width < 600) {
    checks.boxes.push({ selector: '[data-region="map"]', minHeight: 320 })
    checks.styles.push({ selector: '[data-region="inspector"]', property: 'border-top-left-radius', equals: '16px' })
  }
  if (width >= 1100) {
    checks.styles.push({ selector: '[data-region="inspector"]', property: 'max-height', equals: 'none' })
  }
  return checks
}

const lines = []
const log = (text = '') => {
  lines.push(text)
  console.log(text)
}

mkdirSync(resolve(WORKSPACE_ROOT, OUT_DIR), { recursive: true })

const code = latestCodeMtime()
log('A40-2 外壳响应式采集')
log('时间（本地）: ' + new Date().toISOString())
log('工作区根   : ' + WORKSPACE_ROOT)
log('entry      : ' + ENTRY)
log('最后一次代码改动: ' + new Date(code.mtimeMs).toISOString() + '  (' + code.file + ')')
log('')

const browser = await launchBrowser({ width: 1440, height: HEIGHT })
log('浏览器     : ' + browser.executable)
log('profile 目 录: ' + browser.profileDir + (browser.profileDir.startsWith(process.env.TEMP ?? '') ? '  (在 %TEMP%)' : '  (注意：不在 %TEMP%)'))
log('')

let failures = 0
const records = []

try {
  for (const width of WIDTHS) {
    const outPng = OUT_DIR + '/shell-' + width + '.png'
    const result = await renderAtWithBrowser(browser, {
      width,
      height: HEIGHT,
      entry: ENTRY,
      waitFor: 'html[data-harness-ready]',
      outPng,
      assert: assertionsFor(width),
      label: 'shell-' + width,
    })
    const failed = result.checks.filter((check) => check.ok !== true)
    if (!result.ok) failures += 1
    records.push({ width, result })

    log('=== ' + width + '×' + HEIGHT + ' ===')
    log('  断言: ' + (result.ok ? 'PASS' : 'FAIL') + '  (' + result.checks.length + ' 条)')
    log('  无横向滚动: documentElement.scrollWidth=' + result.metrics.scrollWidth + ' clientWidth=' + result.metrics.clientWidth +
      '  body.scrollWidth=' + result.metrics.bodyScrollWidth + ' body.clientWidth=' + result.metrics.bodyClientWidth +
      '  → ' + (result.metrics.scrollWidth <= result.metrics.clientWidth ? 'OK' : '溢出'))
    log('  内部横向溢出扫描: ' + (result.metrics.overflow.length === 0 ? '无' : JSON.stringify(result.metrics.overflow)))
    log('  检查器: ' + JSON.stringify(result.metrics.inspector))
    for (const region of result.metrics.regions) {
      log('  区域 ' + region.region.padEnd(9) + ' w=' + String(region.width).padStart(4) + ' h=' + String(region.height).padStart(3) + ' position=' + region.position)
    }
    for (const check of failed) log('  FAILED  ' + check.label + '  ' + JSON.stringify(check.detail))
    if (result.png) {
      if (result.png.mtimeMs < code.mtimeMs) {
        failures += 1
        log('  FAILED  截图早于最后一次代码改动（' + new Date(result.png.mtimeMs).toISOString() + ' < ' + new Date(code.mtimeMs).toISOString() + '）')
      }
      log('  截图: ' + result.png.relative + '  ' + result.png.bytes + ' bytes  sha256=' + result.png.sha256)
      log('  截图 mtime: ' + new Date(result.png.mtimeMs).toISOString() + '（晚于代码改动: ' + (result.png.mtimeMs >= code.mtimeMs ? '是' : '否') + '）')
    } else {
      log('  截图: 未落盘（断言失败时不落图，避免留假证据）')
    }
    log('')
  }

  // 额外证据 1：宽视口 + 窄容器 —— 证明布局由容器查询驱动，而不是 viewport
  const containerProof = await renderAtWithBrowser(browser, {
    width: 1200,
    height: HEIGHT,
    containerWidth: 420,
    entry: ENTRY,
    waitFor: 'html[data-harness-ready]',
    assert: {
      styles: [{ selector: '[data-region="inspector"]', property: 'border-top-left-radius', equals: '16px' }],
      boxes: [{ selector: '[data-region="map"]', minHeight: 320 }],
      expr: [
        {
          label: 'container-query-not-viewport',
          code: 'window.innerWidth > 1100 && Math.round(document.querySelector(".threadline-app").getBoundingClientRect().width)',
          equals: 420,
        },
      ],
    },
  })
  if (!containerProof.ok) failures += 1
  log('=== 容器查询证据：视口 1200 / 容器 420 ===')
  log('  断言: ' + (containerProof.ok ? 'PASS' : 'FAIL') + '  viewportWidth=' + containerProof.metrics.viewportWidth +
    ' 容器宽=' + Math.round(containerProof.metrics.regions.find((region) => region.region === 'header').width) +
    ' 检查器=' + JSON.stringify(containerProof.metrics.inspector))
  log('  → 容器 420 时检查器按 <600 的 sheet 规则渲染（上圆角 16px、星图最小高 320px），与视口宽度无关')
  log('')

  // 额外证据 2：关闭检查器后主区扩展（1440，不落图）
  const closed = await renderAtWithBrowser(browser, {
    width: 1440,
    height: HEIGHT,
    entry: ENTRY,
    query: 'inspector=0',
    waitFor: 'html[data-harness-ready]',
    assert: {
      absent: [{ selector: '[data-region="inspector"]' }],
      expr: [
        {
          label: 'map-expands-when-inspector-closed',
          code: 'Math.round(document.querySelector("[data-region=map]").getBoundingClientRect().width)',
          equals: 1440,
        },
      ],
    },
  })
  if (!closed.ok) failures += 1
  log('=== 检查器关闭（1440，主区扩展）===')
  log('  断言: ' + (closed.ok ? 'PASS' : 'FAIL') + '  星图宽度=' + closed.metrics.regions.find((region) => region.region === 'map').width)
  log('')

  // 额外证据 3：reduced-motion 下动效归零（06 N-13，不落图）
  const reduced = await renderAtWithBrowser(browser, {
    width: 1440,
    height: HEIGHT,
    entry: ENTRY,
    reducedMotion: true,
    waitFor: 'html[data-harness-ready]',
    assert: {
      expr: [
        {
          label: 'reduced-motion-animation-off',
          code: 'window.getComputedStyle(document.querySelector(".threadline-now-dot")).animationDuration',
          equals: '0s',
        },
        {
          label: 'reduced-motion-transition-off',
          code: 'window.getComputedStyle(document.querySelector(".threadline-btn")).transitionDuration',
          equals: '0s',
        },
      ],
    },
  })
  if (!reduced.ok) failures += 1
  log('=== reduced-motion ===')
  log('  断言: ' + (reduced.ok ? 'PASS' : 'FAIL') + '  animation-duration=0s / transition-duration=0s')
  log('')
  // 额外证据 4：卸载可移除（注入 2 个 <style>，disposer 后 0 个；二次调用幂等）
  const uninstall = await renderAtWithBrowser(browser, {
    width: 800,
    height: 600,
    entry: 'tests/harness/entries/uninstall.entry.ts',
    waitFor: 'html[data-harness-ready]',
    assert: {
      expr: [
        {
          label: 'uninstall-probe',
          code: 'JSON.stringify(window.__threadlineUninstallProbe)',
          equals: JSON.stringify({
            injected: STYLE_SHEETS.length,
            installedAfterInject: true,
            afterDispose: 0,
            installedAfterDispose: false,
            secondPassRemoved: 0,
          }),
        },
      ],
    },
  })
  if (!uninstall.ok) {
    failures += 1
    for (const check of uninstall.checks.filter((item) => item.ok !== true)) {
      log('  FAILED  ' + check.label + '  ' + JSON.stringify(check.detail))
    }
  }
  log('=== 卸载可移除（样式注入 → disposer）===')
  log('  断言: ' + (uninstall.ok ? 'PASS' : 'FAIL') + '  ' + JSON.stringify(uninstall.checks.find((check) => check.label === 'expr:uninstall-probe')?.detail))
  log('')
} finally {
  await browser.close()
}

log('汇总: ' + WIDTHS.length + ' 个宽度 + 4 条额外证据；失败 ' + failures + ' 项')
log('结果: ' + (failures === 0 ? 'A40-2 PASS' : 'A40-2 FAIL'))
writeFileSync(resolve(WORKSPACE_ROOT, OUT_DIR, 'responsive.txt'), lines.join('\r\n') + '\r\n', 'utf8')
if (failures > 0) process.exit(1)
