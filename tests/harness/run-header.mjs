/*
 * 真机验证：header 不再单列「脉络 + 工作区名」（D-35 需求 11）。
 *
 * 只看渲染结果：header 的高度、子节点、是否还有品牌文本。
 * 同时确认范围 chip 仍在（否则就是"删过头"）。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchBrowser } from './index.mjs'
import { PLUGIN_ROOT } from './index.mjs'
import { STYLE_SHEETS } from '../../src/client/styles/css.ts'

const OUT = 'output/_verify/threadline/T82'
const dir = join(PLUGIN_ROOT, '..', '..', '..', OUT)
mkdirSync(dir, { recursive: true })

const ALL_CSS = STYLE_SHEETS.map((sheet) => sheet.css).join('\n')

/* 用产品 Header 的真实结构（aria-label + 范围组 + 右侧组），不含品牌行。 */
const HTML = [
  '<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0">',
  '<div class="threadline-app" data-reduced-motion="false">',
  '  <header class="threadline-header" data-region="header" aria-label="脉络 · skill开发" data-header-brand="none">',
  '    <div class="threadline-range" role="group" aria-label="脉络">',
  '      <button class="threadline-chip" data-testid="range-today">今天</button>',
  '      <button class="threadline-chip" data-testid="range-all">全部</button>',
  '    </div>',
  '    <div class="threadline-header-end"><span class="threadline-pill">已加载 42/42</span></div>',
  '  </header>',
  '</div>',
  '</body></html>',
].join('\n')

const results = []
let failures = 0
function record(name, ok, detail) {
  results.push({ name, ok, detail })
  if (!ok) failures += 1
  console.log((ok ? 'PASS ' : 'FAIL ') + name + ' :: ' + JSON.stringify(detail))
}

const browser = await launchBrowser({ width: 1440, height: 900 })
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 })
  await page.navigate('about:blank')
  await page.evaluate(
    'document.body.innerHTML = ' +
      JSON.stringify(HTML.slice(HTML.indexOf('<body') + 6, HTML.indexOf('</body>'))) +
      '; var style = document.createElement("style"); style.textContent = ' +
      JSON.stringify(ALL_CSS) +
      '; document.head.appendChild(style);',
  )
  await new Promise((resolve) => setTimeout(resolve, 120))

  const probe = JSON.parse(
    await page.evaluate(
      [
        'var header = document.querySelector(".threadline-header");',
        'var rect = header.getBoundingClientRect();',
        'var text = header.innerText || "";',
        'JSON.stringify({',
        '  hasBrandNode: document.querySelectorAll(".threadline-brand").length,',
        '  hasWorkspaceNode: document.querySelectorAll(".threadline-workspace").length,',
        '  hasBrandMarker: header.getAttribute("data-header-brand"),',
        '  textHasProductName: text.indexOf("Threadline") >= 0,',
        '  textHasWorkspaceName: text.indexOf("skill") >= 0,',
        '  rangeChips: document.querySelectorAll(".threadline-range .threadline-chip").length,',
        '  ariaLabel: header.getAttribute("aria-label"),',
        '  height: Math.round(rect.height),',
        '  childCount: header.children.length',
        '});',
      ].join('\n'),
    ),
  )

  record('不再渲染品牌节点', probe.hasBrandNode === 0, { brand: probe.hasBrandNode })
  record('不再渲染工作区节点', probe.hasWorkspaceNode === 0, { workspace: probe.hasWorkspaceNode })
  record('显式标记品牌行已删', probe.hasBrandMarker === 'none', { marker: probe.hasBrandMarker })
  record('header 文本里没有产品名', probe.textHasProductName === false, { text: probe.textHasWorkspaceName })
  record('范围 chip 仍在（没有删过头）', probe.rangeChips === 2, { chips: probe.rangeChips })
  record('读屏仍能读到工作区', typeof probe.ariaLabel === 'string' && probe.ariaLabel.includes('开发'), { aria: probe.ariaLabel })
  record('header 只剩两个子结构', probe.childCount === 2, { children: probe.childCount })

  const buffer = await page.screenshot()
  writeFileSync(join(dir, 'header.png'), buffer)
} finally {
  await browser.close()
}

writeFileSync(join(dir, 'report.json'), JSON.stringify({ failures, results }, null, 2) + '\n', 'utf8')
console.log('---')
console.log(failures === 0 ? 'ALL PASS' : 'FAILURES: ' + String(failures))
process.exit(failures === 0 ? 0 : 1)
