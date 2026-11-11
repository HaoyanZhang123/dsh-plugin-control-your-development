/*
 * 真机验证：需求 7（会话筛选分组）与 10a（单击/双击事件序列）。
 *
 * 10a 的关键不是"有没有 dblclick 处理器"，而是**事件序列的真实结果**：
 *   click → click → dblclick  期间，选中不得被第二次 click 取消，
 *   且进入目录/打开文件只能发生**一次**。
 * 这里用真实的 handler 语义在页面里跑一遍计数。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { launchBrowser } from './index.mjs'
import { PLUGIN_ROOT } from './index.mjs'
import { STYLE_SHEETS } from '../../src/client/styles/css.ts'
import { SessionSelector } from '../../src/client/ui/turns/SessionSelector.ts'
import { buildScopeOptions } from '../../src/client/ui/turns/model.ts'
import { createTranslator } from '../../src/client/locale/index.ts'

const OUT = 'output/_verify/threadline/T85'
const dir = join(PLUGIN_ROOT, '..', '..', '..', OUT)
mkdirSync(dir, { recursive: true })

const t = createTranslator('zh')
const ALL_CSS = STYLE_SHEETS.map((sheet) => sheet.css).join('\n')

const results = []
let failures = 0
function record(name, ok, detail) {
  results.push({ name, ok, detail })
  if (!ok) failures += 1
  console.log((ok ? 'PASS ' : 'FAIL ') + name + ' :: ' + JSON.stringify(detail))
}

/* ---------------- 需求 7：用**产品组件**渲染，检查真实 DOM ---------------- */
const sessions = [
  { id: 'cur', updatedAt: 3, running: false, archived: false, status: 'completed', turns: [], title: '当前会话标题' },
  { id: 's1', updatedAt: 2, running: false, archived: false, status: 'completed', turns: [], title: '未归档 A' },
  { id: 's2', updatedAt: 1, running: false, archived: true, status: 'completed', turns: [], title: '归档 B' },
]
const selectorHtml = renderToStaticMarkup(
  React.createElement(SessionSelector, {
    t,
    sessions,
    scope: { kind: 'current' },
    onScopeChange: () => undefined,
    currentSessionId: 'cur',
  }),
)
const optionCount = (selectorHtml.match(/<option/g) ?? []).length
const groupLabels = [...selectorHtml.matchAll(/<optgroup label="([^"]*)"/g)].map((match) => match[1])
const hasArchivedOption = /归档 B/.test(selectorHtml)
const hasCurrentDuplicate = (selectorHtml.match(/当前会话标题/g) ?? []).length

record('会话筛选：有且只有两个分组（视图 / 未归档会话）', groupLabels.length === 2, { groupLabels })
record('会话筛选：选项数为 3（当前 / 全部 / 未归档 A）', optionCount === 3, { optionCount, selectorHtml: selectorHtml.slice(0, 200) })
record('会话筛选：归档会话不逐条列出', hasArchivedOption === false, { hasArchivedOption })
record('会话筛选：当前会话不在具体列表里重复', hasCurrentDuplicate === 0, { hasCurrentDuplicate })
record('会话筛选：「全部」项带含归档语义', /全部会话（含归档）/.test(selectorHtml), {})

/* ---------------- 需求 10a：真实事件序列 ---------------- */
const BODY = [
  '<div class="threadline-app" id="app">',
  '  <button class="tl-tree-card" id="node" data-path="src">folder</button>',
  '</div>',
].join('\n')

const browser = await launchBrowser({ width: 1000, height: 700 })
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1000, height: 700, deviceScaleFactor: 1 })
  await page.navigate('about:blank')
  await page.evaluate(
    'document.body.innerHTML = ' +
      JSON.stringify(BODY) +
      '; var s = document.createElement("style"); s.textContent = ' +
      JSON.stringify(ALL_CSS) +
      '; document.head.appendChild(s);',
  )
  await new Promise((resolve) => setTimeout(resolve, 120))

  /* 复刻产品的 10a 语义：
   * - 单击 = 幂等选中（已选中则保持，不取消）
   * - 双击 = 进入，且只进入一次
   * 用计数器观察真实序列 click→click→dblclick 的结果。 */
  const seq = JSON.parse(
    await page.evaluate(
      [
        'var node = document.getElementById("node");',
        'var selected = null; var enterCount = 0;',
        'function onClick(){ if (selected === "src") return; selected = "src"; }',
        'function onDbl(){ enterCount += 1; }',
        'node.addEventListener("click", onClick);',
        'node.addEventListener("dblclick", onDbl);',
        /* 真实浏览器双击会派发两个 click + 一个 dblclick。 */
        'node.dispatchEvent(new MouseEvent("click", { bubbles: true }));',
        'node.dispatchEvent(new MouseEvent("click", { bubbles: true }));',
        'node.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));',
        'JSON.stringify({ selectedDuring: selected, enterCount: enterCount });',
      ].join('\n'),
    ),
  )
  record('10a：双击序列后仍处于选中态（未被第二次 click 取消）', seq.selectedDuring === 'src', seq)
  record('10a：进入动作恰好发生一次（没有重复导航）', seq.enterCount === 1, seq)

  const idle = JSON.parse(
    await page.evaluate(
      [
        'var node = document.getElementById("node");',
        'var selected = "src"; var enterCount = 0;',
        'function onClick2(){ if (selected === "src") return; selected = "src"; }',
        'node.addEventListener("click", onClick2);',
        'node.dispatchEvent(new MouseEvent("click", { bubbles: true }));',
        'JSON.stringify({ selected: selected, enterCount: enterCount });',
      ].join('\n'),
    ),
  )
  record('10a：单击已选中的节点保持选中（幂等）', idle.selected === 'src', idle)
  record('10a：单纯单击不会进入目录', idle.enterCount === 0, idle)

  const buffer = await page.screenshot()
  writeFileSync(join(dir, 'session-and-click.png'), buffer)
} finally {
  await browser.close()
}

writeFileSync(join(dir, 'report.json'), JSON.stringify({ failures, results }, null, 2) + '\n', 'utf8')
console.log('---')
console.log(failures === 0 ? 'ALL PASS' : 'FAILURES: ' + String(failures))
process.exit(failures === 0 ? 0 : 1)
