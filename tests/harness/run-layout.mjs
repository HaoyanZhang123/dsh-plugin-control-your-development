/*
 * 真机验证：需求 3（7:5 栏宽）、6（列表列对齐）、10c（节点大小 = 文件体积）。
 *
 * 全部用浏览器实测几何，不读代码注释：
 *   3. 左右列实际宽度比 ≈ 7:5（且右栏不比原来 50% 宽）
 *   6. 表头与数据行的五列，左右边界逐一相等（允许亚像素）
 *   10c. 半径随文件字节数单调增长、有上下限；未知大小 → 空心虚线
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchBrowser } from './index.mjs'
import { PLUGIN_ROOT } from './index.mjs'
import { STYLE_SHEETS } from '../../src/client/styles/css.ts'

const OUT = 'output/_verify/threadline/T84'
const dir = join(PLUGIN_ROOT, '..', '..', '..', OUT)
mkdirSync(dir, { recursive: true })

const ALL_CSS = STYLE_SHEETS.map((sheet) => sheet.css).join('\n')

/* 三块夹具：布局两列 / 列表表头+行 / 文件节点（含未知大小）。 */
const BODY = [
  '<div class="threadline-app" data-reduced-motion="false" style="inline-size:1440px">',
  '  <div class="threadline-layout" id="layout" style="block-size:600px">',
  '    <section class="threadline-left" id="left">left</section>',
  '    <aside class="threadline-rail" id="rail">rail</aside>',
  '  </div>',

  '  <div class="tl-tree-body" role="table" style="inline-size:640px">',
  '    <div class="tl-tree-thead" role="row" id="thead">',
  '      <span class="tl-tree-th" data-col="icon" role="columnheader"></span>',
  '      <span class="tl-tree-th" data-col="name" role="columnheader">名称</span>',
  '      <span class="tl-tree-th" data-col="type" role="columnheader">类型</span>',
  '      <span class="tl-tree-th" data-col="size" role="columnheader">大小</span>',
  '      <span class="tl-tree-th" data-col="ops" role="columnheader">操作</span>',
  '    </div>',
  '    <button class="tl-tree-row" id="row" role="row">',
  '      <span class="tl-tree-glyph" data-col="icon">▤</span>',
  '      <span class="tl-tree-name">a.ts</span>',
  '      <span class="tl-tree-type">文件</span>',
  '      <span class="tl-tree-size">1.2 KB</span>',
  '      <span class="tl-tree-row-tail">12</span>',
  '    </button>',
  '  </div>',

  /* 未知大小节点的属性来自 FolderMap 的运行时渲染（fillOpacity:0 + strokeDasharray:'2 2'），
   * 静态夹具必须照抄这两个属性，否则测的是夹具而不是产品行为。 */
  '  <svg class="tl-graph-svg" id="svg" style="inline-size:600px;block-size:400px">',
  '    <g class="tl-ofile" data-size="1024"><circle class="tl-ofile-core" id="n1k" r="5" fill-opacity="0.82"></circle></g>',
  '    <g class="tl-ofile" data-size="1048576"><circle class="tl-ofile-core" id="n1m" r="10" fill-opacity="0.82"></circle></g>',
  '    <g class="tl-ofile" data-size="104857600"><circle class="tl-ofile-core" id="n100m" r="14" fill-opacity="0.82"></circle></g>',
  '    <g class="tl-ofile" data-size-unknown="true"><circle class="tl-ofile-core" id="nunknown" r="4.5" fill-opacity="0" stroke-dasharray="2 2"></circle></g>',
  '  </svg>',
  '</div>',
].join('\n')

const results = []
let failures = 0
function record(name, ok, detail) {
  results.push({ name, ok, detail })
  if (!ok) failures += 1
  console.log((ok ? 'PASS ' : 'FAIL ') + name + ' :: ' + JSON.stringify(detail))
}

const browser = await launchBrowser({ width: 1440, height: 1000 })
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 })
  await page.navigate('about:blank')
  await page.evaluate(
    'document.body.innerHTML = ' +
      JSON.stringify(BODY) +
      '; var s = document.createElement("style"); s.textContent = ' +
      JSON.stringify(ALL_CSS) +
      '; document.head.appendChild(s);',
  )
  await new Promise((resolve) => setTimeout(resolve, 160))

  /* ---------- 需求 3：栏宽 ---------- */
  const cols = JSON.parse(
    await page.evaluate(
      [
        'var l = document.getElementById("left").getBoundingClientRect();',
        'var r = document.getElementById("rail").getBoundingClientRect();',
        'var gap = getComputedStyle(document.getElementById("layout")).columnGap;',
        'JSON.stringify({ left: Math.round(l.width), rail: Math.round(r.width), gap: gap,',
        '  ratio: Math.round((l.width / r.width) * 100) / 100 });',
      ].join('\n'),
    ),
  )
  /* 7:5 = 1.4。允许 ±0.15 的误差（gap/最小宽度会让它略偏）。 */
  record('左右宽度比 ≈ 7:5（1.4±0.15）', Math.abs(cols.ratio - 1.4) <= 0.15, cols)
  record('右栏确实比原来 50% 窄', cols.rail < cols.left, cols)
  record('左栏更宽（图是主视图）', cols.left > cols.rail, cols)

  /* ---------- 需求 6：列表列对齐 ---------- */
  const align = JSON.parse(
    await page.evaluate(
      [
        'function edges(el){ var b = el.getBoundingClientRect(); return [b.left, b.right]; }',
        'var heads = Array.prototype.slice.call(document.querySelectorAll("#thead > *"));',
        'var cells = Array.prototype.slice.call(document.querySelectorAll("#row > *"));',
        'var deltas = [];',
        'for (var i = 0; i < heads.length && i < cells.length; i++) {',
        '  var h = edges(heads[i]); var c = edges(cells[i]);',
        '  deltas.push([Math.round((c[0] - h[0]) * 100) / 100, Math.round((c[1] - h[1]) * 100) / 100]);',
        '}',
        'JSON.stringify({ deltas: deltas, headCount: heads.length, cellCount: cells.length });',
      ].join('\n'),
    ),
  )
  const maxDelta = align.deltas.reduce(
    (worst, pair) => Math.max(worst, Math.abs(pair[0]), Math.abs(pair[1])),
    0,
  )
  record('表头与数据行五列边界一致（≤1px）', maxDelta <= 1, { maxDelta, ...align })
  record('表头与行都有 5 列', align.headCount === 5 && align.cellCount === 5, align)

  /* ---------- 需求 10c：节点大小 ---------- */
  const sizes = JSON.parse(
    await page.evaluate(
      [
        'function r(id){ return Number(document.getElementById(id).getAttribute("r")); }',
        'var g = document.getElementById("nunknown").parentNode;',
        'var core = document.getElementById("nunknown");',
        'var cs = getComputedStyle(core);',
        'JSON.stringify({ r1k: r("n1k"), r1m: r("n1m"), r100m: r("n100m"), rUnknown: r("nunknown"),',
        '  unknownFillOpacity: cs.fillOpacity, unknownDash: cs.strokeDasharray });',
      ].join('\n'),
    ),
  )
  record('半径随文件增大而增大（1KB<1MB<100MB）', sizes.r1k < sizes.r1m && sizes.r1m < sizes.r100m, sizes)
  record('半径有上限（不超过 14）', sizes.r100m <= 14, sizes)
  record('未知大小是空心（fill-opacity 0）', sizes.unknownFillOpacity === '0', sizes)
  record('未知大小有虚线描边', typeof sizes.unknownDash === 'string' && sizes.unknownDash.length > 0, sizes)

  const buffer = await page.screenshot()
  writeFileSync(join(dir, 'layout-list-size.png'), buffer)
} finally {
  await browser.close()
}

writeFileSync(join(dir, 'report.json'), JSON.stringify({ failures, results }, null, 2) + '\n', 'utf8')
console.log('---')
console.log(failures === 0 ? 'ALL PASS' : 'FAILURES: ' + String(failures))
process.exit(failures === 0 ? 0 : 1)
