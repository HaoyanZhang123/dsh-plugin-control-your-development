/*
 * tests/ui-map/graph-enter.test.ts —— 节点图的入场动画（1.5.4 真机需求）。
 *
 * 用户原话：「我希望节点图每一次加载出来的时候都有动画，比如点不同轮次、初次加载、
 *            点击进文件夹等」。
 *
 * 这条套件守：
 * 1. 图根 `<svg>` 的 key 含「轮次 / 目录 / 档位」，换图即重挂载 → 动画每次重播；
 * 2. 节点与线都有入场动画，且**线在节点之后**（旧的"线先到位等节点"是否掉的）；
 * 3. 节点做错峰（不能整体一起弹）；
 * 4. reduced-motion 下不播；
 * 5. 拖动/选中**不在** key 里（那是同图内状态变化，重新入场会闪）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PLUGIN_ROOT } from '../harness/styles-codegen.ts'

const MAP_CSS_RAW = readFileSync(join(PLUGIN_ROOT, 'src', 'client', 'styles', 'map.css'), 'utf8')
const MAP_CSS = MAP_CSS_RAW.replace(/\/\*[\s\S]*?\*\//g, '')
const FOLDER_MAP = readFileSync(join(PLUGIN_ROOT, 'src', 'client', 'ui', 'map', 'FolderMap.ts'), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
)

test('图根 svg 的 key 含轮次 / 目录 / 档位（换图即重挂载）', () => {
  const keyBlock = /key:\s*'g:'([\s\S]{0,400}?)viewBox:/.exec(FOLDER_MAP)
  assert.ok(keyBlock !== null, '必须给 svg 一个复合 key（否则动画只播一次）')
  const body = keyBlock[1]
  assert.match(body, /props\.now/, '换轮次必须重新入场')
  assert.match(body, /props\.currentPath/, '换目录（点进文件夹）必须重新入场')
  assert.match(body, /showAllExpanded/, '切换「显示全部」是一张新图')
  assert.match(body, /density/, '切换关系密度是一张新图')
})

test('selectedKey / hoveredKey / 拖动不得进 key（那是同图内状态，重新入场会闪）', () => {
  const keyBlock = /key:\s*'g:'([\s\S]{0,400}?)viewBox:/.exec(FOLDER_MAP)
  assert.ok(keyBlock !== null)
  const body = keyBlock[1]
  for (const forbidden of ['selectedKey', 'hoveredKey', 'dragOffsets', 'camera']) {
    assert.equal(body.includes(forbidden), false, forbidden + ' 不能进 key（会打断布局过渡）')
  }
})

test('节点与线都有入场动画，且线在节点之后', () => {
  assert.match(MAP_CSS, /@keyframes threadline-graph-node-in/, '必须有节点入场关键帧')
  assert.match(MAP_CSS, /@keyframes threadline-graph-edge-in/, '必须有线入场关键帧')
  const nodeRule = /\.tl-graph-svg \.tl-ofile[\s\S]{0,400}?animation: threadline-graph-node-in/.exec(MAP_CSS)
  assert.ok(nodeRule !== null, '节点必须播入场动画')
  const edgeRule = /\.tl-graph-svg \.tl-graph-edge \{([^}]*)\}/.exec(MAP_CSS)
  assert.ok(edgeRule !== null, '线必须播入场动画')
  assert.match(edgeRule[1], /animation-delay:\s*\d+ms/, '线必须延迟（在节点之后淡入）')
})

test('节点做错峰（不是整体一起弹）', () => {
  assert.match(MAP_CSS, /--tl-enter-i/, 'CSS 必须用错峰变量')
  assert.match(MAP_CSS, /animation-delay:\s*calc\(var\(--tl-enter-i/, '延迟必须随序号递增')
  /* 渲染层必须真的写出这个变量，否则 CSS 规则永远不命中。 */
  assert.match(FOLDER_MAP, /'--tl-enter-i':/, '渲染层必须写 --tl-enter-i')
  assert.match(FOLDER_MAP, /Math\.min\(30, node\.index\)/, '错峰要封顶（再多也看不出来，反而慢）')
})

test('reduced-motion 下不播入场动画', () => {
  const reduced = MAP_CSS.slice(MAP_CSS.indexOf('@media (prefers-reduced-motion: reduce)'))
  assert.ok(reduced.length > 0, '必须有 reduced-motion 段')
  assert.match(reduced, /animation:\s*none/, 'reduced-motion 下必须关掉动画')
})
