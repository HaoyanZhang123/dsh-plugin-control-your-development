/*
 * tests/ui-map/layout-transition.test.ts —— 布局过渡（1.5.3 真机反馈）。
 *
 * 用户原话：「点击选中文件节点之后会改变图的布局，但是没有动态改变过去的过程，
 *            而是直接跳，这样很奇怪，加入动态变过去的过程。」
 *
 * 前提（已实测）：Chrome 对 SVG 的 `cx`/`cy`/`r` 支持 CSS transition
 * （改 cx 后 60ms 处于中间值、360ms 到位）。所以不必改布局算法，加过渡即可。
 *
 * 这条套件守：
 * 1. 节点/标签/边的几何元素都声明了布局过渡；
 * 2. 过渡时长用 `--tl-dur-layout` 令牌（不是随便写死的毫秒数）；
 * 3. reduced-motion 下**全部取消**（无障碍硬要求）；
 * 4. 拖动中**不加**过渡（否则逐帧跟随会拖出黏滞感）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PLUGIN_ROOT } from '../harness/styles-codegen.ts'

const MAP = readFileSync(join(PLUGIN_ROOT, 'src', 'client', 'styles', 'map.css'), 'utf8')
const TOKENS = readFileSync(join(PLUGIN_ROOT, 'src', 'client', 'styles', 'tokens.css'), 'utf8')

function strip(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}
const CODE = strip(MAP)

test('--tl-dur-layout 令牌存在，并在 reduced-motion 下归零', () => {
  assert.match(TOKENS, /--tl-dur-layout:\s*\d+ms/, '必须定义布局过渡时长令牌')
  const reduced = TOKENS.slice(TOKENS.indexOf('@media (prefers-reduced-motion: reduce)'))
  assert.match(reduced, /--tl-dur-layout:\s*0ms/, 'reduced-motion 下布局过渡必须归零')
})

test('圆形节点对 cx/cy/r 声明了过渡（位置与半径都要滑）', () => {
  const block = /\.tl-ofile\s+\.tl-ofile-core[\s\S]{0,600}?\{([^}]*)\}/.exec(CODE)
  assert.ok(block !== null, '必须为 .tl-ofile-core 声明过渡')
  const body = block[1]
  for (const prop of ['cx', 'cy', 'r']) {
    assert.match(body, new RegExp(prop + '\\s+var\\(--tl-dur-layout\\)'), prop + ' 必须走布局过渡')
  }
})

test('标签坐标也走过渡', () => {
  const block = /\.tl-ofile-label[\s\S]{0,600}?\{([^}]*)\}/.exec(CODE)
  assert.ok(block !== null, '必须为 .tl-ofile-label 声明过渡')
  assert.match(block[1], /x\s+var\(--tl-dur-layout\)/, '标签 x 必须走布局过渡')
  assert.match(block[1], /y\s+var\(--tl-dur-layout\)/, '标签 y 必须走布局过渡')
})

test('拖动中不得加过渡（否则逐帧跟随变黏滞）', () => {
  /* 布局过渡的选择器必须排除 data-dragging=true。 */
  assert.match(CODE, /\.tl-ofile:not\(\[data-dragging='true'\]\)/, '节点布局过渡必须排除拖动中')
  assert.match(CODE, /\.tl-foldhub:not\(\[data-dragging='true'\]\)/, '枢纽布局过渡必须排除拖动中')
})

test('不允许再出现把布局过渡覆盖掉的重复 transition（同特异性后写者胜）', () => {
  /* 旧 bug：`.tl-ofile-core { transition: fill-opacity ... }` 写在布局过渡之后，
   * 同特异性覆盖掉 cx/cy/r。现在这条规则必须已删除。 */
  const occurrences = [...CODE.matchAll(/\.tl-ofile-core\s*\{([^}]*)\}/g)]
    .map((match) => match[1])
    .filter((body) => /transition:\s*fill-opacity var\(--tl-dur-fast\) ease,\s*stroke/.test(body))
  assert.equal(occurrences.length, 0, '不得再保留只过渡颜色的 .tl-ofile-core 规则（会覆盖布局过渡）')
})

test('reduced-motion 下把几何元素的过渡显式关掉', () => {
  const reduced = CODE.slice(CODE.indexOf("@media (prefers-reduced-motion: reduce)"))
  for (const cls of ['.tl-ofile-core', '.tl-ofile-label', '.tl-foldhub-card']) {
    assert.ok(reduced.includes(cls), 'reduced-motion 段必须覆盖 ' + cls)
  }
  assert.match(reduced, /transition:\s*none/, 'reduced-motion 必须 transition: none')
})
