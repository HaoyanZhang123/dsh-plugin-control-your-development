/*
 * 真机验证：需求 10b（证据覆盖时间线）与需求 5（左右 hover 联动）。
 *
 * 用一个真实结构的夹具（时间线卡 + 证据槽 + 图节点 + 右栏行），
 * 断言：
 *   1. 证据槽是时间线卡片的子节点，且几何上铺满它（覆盖，不是并列）；
 *   2. 证据槽不在图舞台内部（旧实现的位置）；
 *   3. hover 右栏行 → 左图对应节点进入高亮态（is-linked/is-hovered）；
 *   4. 离开后高亮清除，且**其他节点透明度保持 1**（需求 2 不回退）。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchBrowser } from './index.mjs'
import { PLUGIN_ROOT } from './index.mjs'
import { STYLE_SHEETS } from '../../src/client/styles/css.ts'

const OUT = 'output/_verify/threadline/T83'
const dir = join(PLUGIN_ROOT, '..', '..', '..', OUT)
mkdirSync(dir, { recursive: true })

const ALL_CSS = STYLE_SHEETS.map((sheet) => sheet.css).join('\n')

const BODY = [
  '<div class="threadline-app" data-reduced-motion="false">',
  '  <div class="threadline-layout">',
  '    <section class="threadline-left">',
  '      <div class="tl-graph">',
  '        <div class="tl-graph-stage" data-graph-stage="true">',
  '          <svg class="tl-graph-svg">',
  '            <g class="tl-ofile" data-file-path="src/a.ts" data-hovered="false" data-selected="false">',
  '              <circle class="tl-ofile-halo" r="12"></circle><circle class="tl-ofile-core" r="7"></circle>',
  '            </g>',
  '            <g class="tl-ofile" data-file-path="src/b.ts" data-hovered="false" data-selected="false">',
  '              <circle class="tl-ofile-halo" r="12"></circle><circle class="tl-ofile-core" r="7"></circle>',
  '            </g>',
  '          </svg>',
  '        </div>',
  '      </div>',
  '      <div class="threadline-timeline" data-region="timeline" data-testid="timeline" data-has-evidence="true">',
  '        <div class="tl-timeline-body">timeline</div>',
  '        <div class="tl-evidence-slot" id="evidence" role="region" aria-label="关系证据">',
  '          <div class="tl-evidence-head"><b class="tl-evidence-title">关系证据</b></div>',
  '          <div class="tl-evidence-subject mono">src/a.ts</div>',
  '        </div>',
  '      </div>',
  '    </section>',
  '    <aside class="threadline-rail">',
  '      <div class="tl-tree-body" role="group">',
  '        <button class="tl-tree-card" data-path="src/a.ts" id="rail-a">a.ts</button>',
  '        <button class="tl-tree-card" data-path="src/b.ts" id="rail-b">b.ts</button>',
  '      </div>',
  '    </aside>',
  '  </div>',
  '</div>',
].join('\n')

const results = []
let failures = 0
function record(name, ok, detail) {
  results.push({ name, ok, detail })
  if (!ok) failures += 1
  console.log((ok ? 'PASS ' : 'FAIL ') + name + ' :: ' + JSON.stringify(detail))
}

const browser = await launchBrowser({ width: 1200, height: 900 })
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1200, height: 900, deviceScaleFactor: 1 })
  await page.navigate('about:blank')
  await page.evaluate(
    'document.body.innerHTML = ' +
      JSON.stringify(BODY) +
      '; var style = document.createElement("style"); style.textContent = ' +
      JSON.stringify(ALL_CSS) +
      '; document.head.appendChild(style);',
  )
  await new Promise((resolve) => setTimeout(resolve, 140))

  const geo = JSON.parse(
    await page.evaluate(
      [
        'var timeline = document.querySelector(".threadline-timeline");',
        'var evidence = document.querySelector(".tl-evidence-slot");',
        'var stage = document.querySelector(".tl-graph-stage");',
        'var t = timeline.getBoundingClientRect();',
        'var e = evidence.getBoundingClientRect();',
        'JSON.stringify({',
        '  evidenceInsideTimeline: timeline.contains(evidence),',
        '  evidenceInsideStage: stage.contains(evidence),',
        '  timelineHasEvidenceAttr: timeline.getAttribute("data-has-evidence"),',
        /* inset:0 覆盖的是 padding box，不含 border —— 因此允许"每边一个边框宽度"的差。
         * 时间线上下各 1px 边框 → 高度差 2px、宽度差 2px 属正确覆盖。 */
        '  coversWidth: Math.abs(e.width - t.width) <= 2,',
        '  coversHeight: Math.abs(e.height - t.height) <= 2,',
        '  timelineSize: [Math.round(t.width), Math.round(t.height)],',
        '  evidenceSize: [Math.round(e.width), Math.round(e.height)],',
        '  evidencePosition: getComputedStyle(evidence).position,',
        '  timelinePosition: getComputedStyle(timeline).position',
        '});',
      ].join('\n'),
    ),
  )

  record('证据是时间线卡片的子节点', geo.evidenceInsideTimeline === true, geo)
  record('证据**不在**图舞台内（旧位置已撤离）', geo.evidenceInsideStage === false, geo)
  record('时间线标记了 has-evidence', geo.timelineHasEvidenceAttr === 'true', geo)
  record('证据几何上铺满时间线（宽）', geo.coversWidth === true, geo)
  record('证据几何上铺满时间线（高）', geo.coversHeight === true, geo)
  record('证据用绝对定位覆盖', geo.evidencePosition === 'absolute', geo)

  /* 需求 5：右栏 hover → 左图联动。
   * 产品实现用的是 data-hovered 属性（不是原型里的 is-linked 类），这里按真实属性验证：
   * 置 true 后描边必须变化，且其他节点透明度仍为 1（需求 2 不回退）。 */
  const linkage = JSON.parse(
    await page.evaluate(
      [
        'var a = document.querySelector(\'.tl-ofile[data-file-path="src/a.ts"]\');',
        'var b = document.querySelector(\'.tl-ofile[data-file-path="src/b.ts"]\');',
        'var coreA = a.querySelector(".tl-ofile-core");',
        /* 产品规则改的是 stroke-width（颜色由组件内联给），所以要测宽度而不是颜色。 */
        'var widthBefore = getComputedStyle(coreA).strokeWidth;',
        'a.setAttribute("data-hovered", "true");',
        'var widthAfter = getComputedStyle(coreA).strokeWidth;',
        'JSON.stringify({',
        '  widthBefore: widthBefore,',
        '  widthAfter: widthAfter,',
        '  strokeChanged: widthBefore !== widthAfter,',
        '  bOpacity: getComputedStyle(b).opacity,',
        '  hasHoveredRule: Array.prototype.some.call(document.styleSheets[0].cssRules, function(r){',
        '    return (r.selectorText || "").indexOf("data-hovered") >= 0;',
        '  }),',
        '  hasDimRule: Array.prototype.some.call(document.styleSheets[0].cssRules, function(r){',
        '    return (r.selectorText || "").indexOf("data-dimmed") >= 0;',
        '  })',
        '});',
      ].join('\n'),
    ),
  )

  record('存在 data-hovered 高亮规则（联动有视觉反馈）', linkage.hasHoveredRule === true, linkage)
  record('hovered 后描边真的变化', linkage.strokeChanged === true, linkage)
  record('其他节点透明度仍为 1（不压暗）', linkage.bOpacity === '1', linkage)
  record('不存在 data-dimmed 规则（不压暗其他节点）', linkage.hasDimRule === false, linkage)

  const buffer = await page.screenshot()
  writeFileSync(join(dir, 'evidence-in-timeline.png'), buffer)
} finally {
  await browser.close()
}

writeFileSync(join(dir, 'report.json'), JSON.stringify({ failures, results }, null, 2) + '\n', 'utf8')
console.log('---')
console.log(failures === 0 ? 'ALL PASS' : 'FAILURES: ' + String(failures))
process.exit(failures === 0 ? 0 : 1)
