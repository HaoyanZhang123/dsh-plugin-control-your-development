/*
 * tests/a11y/browser-check.mjs —— A44-2 的**真实浏览器**证据（键盘路径 + 读屏语义 + 隐私掩码）。
 *
 * 为什么需要它：node 单测能验证纯逻辑与静态标记，但"方向键真的移动了焦点""Enter 真的选中"
 * 只有在真实 DOM + 真实事件里才算数（06 §13.1 的教训：断言通过 ≠ 行为符合预期）。
 *
 * 复用 T06 的 tests/harness（renderAt），不另写一套 CDP。
 * 用法：node tests/a11y/browser-check.mjs       退出码 0 = 全过
 */
import { launchBrowser, renderAtWithBrowser } from '../harness/index.mjs'

const ENTRY = 'tests/a11y/entries/list.entry.ts'
const OUT = 'output/_verify/threadline/T10/a11y-list.png'

const FOCUS_FIRST = [
  'var rows = document.querySelectorAll(".threadline-table-row");',
  'rows[0].focus();',
  'document.activeElement === rows[0] ? "focus-ok" : "focus-fail"',
].join('\n')

const KEY_ON_ACTIVE = (key) =>
  [
    'var el = document.activeElement;',
    'el.dispatchEvent(new KeyboardEvent("keydown", { key: ' + JSON.stringify(key) + ', bubbles: true }));',
    '"dispatched"',
  ].join('\n')

const ACTIVE_ROW_LABEL = 'document.activeElement.getAttribute("aria-label")'
const SELECTED_COUNT = 'document.querySelectorAll(\'.threadline-table-row[aria-selected="true"]\').length'
// 页面上有两张表（文件表 + 轮次表）；roving tabindex 是每张表各一个，这里只数文件表
const TABBABLE_COUNT =
  "document.querySelectorAll('[data-testid=\"files\"] .threadline-table-row[tabindex=\"0\"]').length"

const lines = []
const log = (text = '') => {
  lines.push(text)
  console.log(text)
}

let failures = 0
const check = (label, ok, detail) => {
  if (!ok) failures += 1
  log((ok ? 'PASS' : 'FAIL') + ' | ' + label + (detail === undefined ? '' : ' | ' + detail))
}

log('A44-2 真实浏览器键盘路径（tests/harness/renderAt）')
log('时间: ' + new Date().toISOString())
log('')

const browser = await launchBrowser({ width: 900, height: 640 })
log('浏览器: ' + browser.executable + '  profile: ' + browser.profileDir)
log('')

try {
  const result = await renderAtWithBrowser(browser, {
    width: 900,
    height: 640,
    entry: ENTRY,
    waitFor: 'html[data-harness-ready]',
    outPng: OUT,
    assert: {
      contains: [
        { selector: 'table[role="table"]', text: '文件' },
        { selector: '.threadline-table-row[tabindex="0"]' },
        { selector: '[data-testid="list-announcer"][aria-live="polite"]' },
      ],
      styles: [
        { selector: 'table[role="table"]', property: 'aria-label' },
      ],
      expr: [
        { label: 'rows-are-tabbable-roving', code: TABBABLE_COUNT, equals: 1 },
        { label: 'no-selection-initially', code: SELECTED_COUNT, equals: 0 },
      ],
    },
  })
  check('页面渲染与基础语义', result.ok, result.checks.filter((c) => !c.ok).map((c) => c.label).join(','))
  if (result.png) log('截图: ' + result.png.relative + '  sha256=' + result.png.sha256.slice(0, 16))
  log('')

  // —— 键盘路径：focus → ArrowDown → Enter → Escape ——
  const focus = await renderAtWithBrowser(browser, {
    width: 900,
    height: 640,
    entry: ENTRY,
    waitFor: 'html[data-harness-ready]',
    actions: [
      { type: 'evaluate', code: FOCUS_FIRST },
      { type: 'evaluate', code: KEY_ON_ACTIVE('ArrowDown') },
      { type: 'wait', ms: 60 },
    ],
    assert: {
      expr: [
        {
          label: 'arrow-down-moves-focus-to-2nd-row',
          code: ACTIVE_ROW_LABEL,
          equals: '文件 03-产品与交互规格.md，操作 7',
        },
        { label: 'roving-tabindex-follows-focus', code: TABBABLE_COUNT, equals: 1 },
      ],
    },
  })
  check('↓ 把焦点移到下一行（roving tabindex 跟随）', focus.ok, JSON.stringify(focus.checks.filter((c) => !c.ok)))

  const activated = await renderAtWithBrowser(browser, {
    width: 900,
    height: 640,
    entry: ENTRY,
    waitFor: 'html[data-harness-ready]',
    actions: [
      { type: 'evaluate', code: FOCUS_FIRST },
      { type: 'evaluate', code: KEY_ON_ACTIVE('Enter') },
      { type: 'wait', ms: 60 },
    ],
    assert: {
      expr: [
        { label: 'enter-selects-row', code: SELECTED_COUNT, equals: 1 },
        {
          label: 'announcer-speaks-selection',
          code: 'document.querySelector(\'[data-testid="list-announcer"]\').textContent',
          equals: '文件 src/client/a11y/ListTable.ts',
        },
      ],
    },
  })
  check('Enter 选中该行并播报（aria-live=polite）', activated.ok, JSON.stringify(activated.checks.filter((c) => !c.ok)))

  const escaped = await renderAtWithBrowser(browser, {
    width: 900,
    height: 640,
    entry: ENTRY,
    waitFor: 'html[data-harness-ready]',
    actions: [
      { type: 'evaluate', code: FOCUS_FIRST },
      { type: 'evaluate', code: KEY_ON_ACTIVE('Enter') },
      { type: 'wait', ms: 40 },
      { type: 'evaluate', code: KEY_ON_ACTIVE('Escape') },
      { type: 'wait', ms: 60 },
    ],
    assert: {
      expr: [{ label: 'escape-clears-selection', code: SELECTED_COUNT, equals: 0 }],
    },
  })
  check('Esc 清掉选择（逐层退出的一层）', escaped.ok, JSON.stringify(escaped.checks.filter((c) => !c.ok)))
  log('')

  // —— 隐私模式：单元格里不得出现完整目录 ——
  const hidden = await renderAtWithBrowser(browser, {
    width: 900,
    height: 640,
    entry: ENTRY,
    query: 'mode=hidden',
    waitFor: 'html[data-harness-ready]',
    assert: {
      expr: [
        {
          label: 'hidden-mode-hides-dir',
          code: 'document.querySelector(".threadline-table-row td").textContent',
          equals: 'ListTable.ts',
        },
        {
          label: 'hidden-mode-no-full-path-in-dom',
          code: 'document.querySelector(".threadline-list").outerHTML.indexOf("src/client/a11y")',
          equals: -1,
        },
      ],
    },
  })
  check('隐私模式：单元格只剩 basename，DOM 里没有完整目录', hidden.ok, JSON.stringify(hidden.checks.filter((c) => !c.ok)))
  log('')

  // —— reduced-motion：动画被 CSS 归零（真实浏览器 computed style）——
  const reduced = await renderAtWithBrowser(browser, {
    width: 900,
    height: 640,
    entry: ENTRY,
    reducedMotion: true,
    waitFor: 'html[data-harness-ready]',
    assert: {
      expr: [
        {
          label: 'reduced-motion-no-animation',
          code: 'window.getComputedStyle(document.querySelector(".threadline-list *") || document.body).animationDuration',
          equals: '0s',
        },
        {
          label: 'reduced-motion-no-transition',
          code: 'window.getComputedStyle(document.querySelector(".threadline-list *") || document.body).transitionDuration',
          equals: '0s',
        },
      ],
    },
  })
  check('reduced-motion：动画/过渡时长为 0', reduced.ok, JSON.stringify(reduced.checks.filter((c) => !c.ok)))
} finally {
  await browser.close()
}

log('')
log('汇总: 失败 ' + failures + ' 项')
log('结果: ' + (failures === 0 ? 'A44-2 browser PASS' : 'A44-2 browser FAIL'))
if (failures > 0) process.exit(1)
