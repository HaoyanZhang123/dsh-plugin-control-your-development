/*
 * tests/ui-map/graph-enter.test.ts —— 入场动画的**唯一契约**（P2 修复：folder / turn 必须一致）。
 *
 * ## 真机反馈（这次修的）
 *
 * 「点轮次时先出现线，然后节点才加载进去」。
 *
 * 根因是两种模式的入场时序不一致：
 * - `map.css` 的边写死 `animation-delay: 60ms`；
 * - 节点错峰 `animation-delay: calc(var(--tl-enter-i) * 12ms)` 只覆盖
 *   `.tl-ofile` / `.tl-fnode`（`.tl-foldhub` 还漏了）；
 * - `FileGraph`（turn 视图）**完全没有**写 `--tl-enter-i`，而 `FolderMap` 写了；
 * - 三类标签**根本没有**入场动画 —— 它们一开始就是终点透明度。
 *
 * 于是 turn 视图里：边 60ms 就淡入、节点没有任何延迟、标签立刻亮，
 * 观感就是"线先出来、节点后加载"。
 *
 * ## 契约（现在守的）
 *
 *   图层            起点延迟            时长
 *   节点            0ms + i*12ms        --tl-dur-slow
 *   边（三类全部）   60ms               --tl-dur-slow
 *   标签（三类全部） 60ms               --tl-dur-slow
 *
 * 且 folder 与 turn **共用同一组规则**、同一条 `--tl-enter-i` 生成规则（`enterStyleOf`）。
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
const FILE_GRAPH = readFileSync(join(PLUGIN_ROOT, 'src', 'client', 'ui', 'map', 'FileGraph.ts'), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
)
const THEME = readFileSync(join(PLUGIN_ROOT, 'src', 'client', 'ui', 'map', 'theme.ts'), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
)

/**
 * 取某条规则的 body。
 *
 * 注意：入场规则的选择器是**多行列表**（每条 `.tl-graph-svg .xxx` 一行），
 * 所以不能用「选择器片段紧跟 {」去匹配；这里先按「}」切块，再在块内查片段。
 */
function ruleBody(css: string, selectorPart: string): string {
  for (const match of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (match[1].includes(selectorPart)) return match[2]
  }
  assert.fail('缺少规则：' + selectorPart)
}

/** 某选择器所在的整条规则（含选择器列表，用于检查组内还有谁）。 */
function ruleHeadFor(css: string, selectorPart: string): string {
  for (const match of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (match[1].includes(selectorPart)) return match[1]
  }
  assert.fail('缺少选择器：' + selectorPart)
}

/* ================================================================== *
 * 1. 唯一契约：节点错峰 + 边/标签统一 +60ms
 * ================================================================== */

test('入场延迟只有一份事实源：--tl-enter-step / --tl-enter-offset', () => {
  assert.match(MAP_CSS, /--tl-enter-step:\s*12ms/, '错峰步长必须是令牌')
  assert.match(MAP_CSS, /--tl-enter-offset:\s*60ms/, '边/标签相对节点的偏移必须是令牌')
})

test('节点：0ms 起 + 按 --tl-enter-i 错峰（三种节点同一组）', () => {
  const head = ruleHeadFor(MAP_CSS, '.tl-graph-svg .tl-ofile')
  for (const cls of ['.tl-ofile', '.tl-fnode', '.tl-foldhub']) {
    assert.ok(head.includes(cls), '节点入场必须在同一组规则里覆盖 ' + cls)
  }
  const body = ruleBody(MAP_CSS, '.tl-graph-svg .tl-ofile')
  assert.match(body, /animation:\s*threadline-graph-node-in var\(--tl-dur-slow\)/, '节点必须播入场关键帧')
  assert.match(body, /animation-delay:\s*calc\(var\(--tl-enter-i, 0\) \* var\(--tl-enter-step\)\)/, '节点延迟必须按序号错峰')
})

test('边：三类全部 +60ms（folder 的 hub 边与 hub-pair 边不能再漏）', () => {
  const head = ruleHeadFor(MAP_CSS, '.tl-graph-svg .tl-graph-edge')
  for (const cls of ['.tl-graph-edge', '.tl-hub-edge', '.tl-hub-pair']) {
    assert.ok(head.includes(cls), '边入场必须在同一组规则里覆盖 ' + cls)
  }
  const body = ruleBody(MAP_CSS, '.tl-graph-svg .tl-graph-edge')
  assert.match(body, /animation:\s*threadline-graph-edge-in/, '边必须播入场关键帧')
  assert.match(body, /animation-delay:\s*var\(--tl-enter-offset\)/, '边必须晚于节点（+60ms）')
})

test('标签：三类全部 +60ms（之前它们根本没有入场动画）', () => {
  const head = ruleHeadFor(MAP_CSS, '.tl-graph-svg .tl-ofile-label')
  for (const cls of ['.tl-ofile-label', '.tl-foldhub-label', '.tl-fnode-label']) {
    assert.ok(head.includes(cls), '标签入场必须在同一组规则里覆盖 ' + cls)
  }
  const body = ruleBody(MAP_CSS, '.tl-graph-svg .tl-ofile-label')
  assert.match(body, /animation:\s*threadline-graph-label-in/, '标签必须播入场关键帧（不能在节点出现前就亮）')
  assert.match(body, /animation-delay:\s*var\(--tl-enter-offset\)/, '标签必须与边同步（+60ms）')
})

test('三种节点的错峰规则里都必须包含 .tl-foldhub（之前漏了枢纽）', () => {
  const guarded = MAP_CSS.slice(MAP_CSS.indexOf("[style*='--tl-enter-i']"))
  assert.ok(guarded.includes('.tl-foldhub[style*=\'--tl-enter-i\']'), '枢纽也必须参与错峰')
})

/* ================================================================== *
 * 2. 两个模式共用同一条 --tl-enter-i 生成规则
 * ================================================================== */

test('--tl-enter-i 只有一条生成规则（theme.ts 的 enterStyleOf），两个模式都调它', () => {
  assert.match(THEME, /export function enterStyleOf\(/, '必须有唯一生成函数')
  assert.match(THEME, /'--tl-enter-i':/, '它负责写这个自定义属性')
  assert.match(FOLDER_MAP, /style: enterStyleOf\(/, 'folder 图必须用同一条规则')
  assert.match(FILE_GRAPH, /style: enterStyleOf\(/, 'turn 图必须用同一条规则（之前完全没写）')
  /* 反向：不许再各自写死 Math.min(30, ...) 那一套。 */
  assert.equal(FOLDER_MAP.includes('Math.min(30,'), false, 'folder 图不得再自己算错峰序号')
  assert.equal(FILE_GRAPH.includes('Math.min(30,'), false, 'turn 图不得自己算错峰序号')
})

test('封顶序号只定义一次（theme.ts），不在两处各写 30', () => {
  assert.match(THEME, /export const GRAPH_ENTER_MAX_INDEX = 30/, '封顶必须是一个具名常量')
  const occurrences = [...MAP_CSS.matchAll(/--tl-enter-step/g)].length
  assert.ok(occurrences >= 1, 'CSS 必须用错峰令牌')
})

/* ================================================================== *
 * 3. 场景根常驻（P2 第一轮的结论，别回归）
 * ================================================================== */

test('图根 svg 不得再有会周期性变化的 key（数据没变就不许重挂载）', () => {
  const start = FOLDER_MAP.indexOf("className: 'tl-graph-svg'")
  assert.ok(start >= 0, '必须能找到图根 svg 的渲染位置')
  const end = FOLDER_MAP.indexOf('viewBox:', start)
  assert.ok(end > start)
  const block = FOLDER_MAP.slice(start, end)
  assert.equal(/\bkey\s*:/.test(block), false, '图根 svg 不得有 key（否则换图会重建整张 SVG）')
  for (const forbidden of ['props.now', 'density', 'nodes.length']) {
    assert.equal(block.includes(forbidden), false, forbidden + ' 不得出现在图根 svg 的属性里')
  }
})

test('节点 key 只用数据身份（path），不含 now/序号', () => {
  assert.match(FOLDER_MAP, /key: 'f:' \+ node\.path/, 'folder 文件节点 key 必须只用 path')
  assert.match(FOLDER_MAP, /key: 'hub:' \+ hub\.path/, '枢纽 key 必须只用 path')
  assert.match(FILE_GRAPH, /key: 'n:' \+ node\.path/, 'turn 文件节点 key 必须只用 path')
})

/* ================================================================== *
 * 4. 关键帧与 reduced-motion
 * ================================================================== */

test('三个入场关键帧都存在', () => {
  for (const name of ['threadline-graph-node-in', 'threadline-graph-edge-in', 'threadline-graph-label-in']) {
    assert.match(MAP_CSS, new RegExp('@keyframes ' + name), '必须有关键帧 ' + name)
  }
})

test('线只动透明度（translate 会让端点离开节点）', () => {
  const block = /@keyframes threadline-graph-edge-in\s*\{([\s\S]*?)\n\}/.exec(MAP_CSS)
  assert.ok(block !== null)
  assert.equal(/transform/.test(block[1]), false, '边入场不得用 transform（端点会脱离节点）')
})

test('reduced-motion 下不播入场动画', () => {
  const reduced = MAP_CSS.slice(MAP_CSS.indexOf('@media (prefers-reduced-motion: reduce)', MAP_CSS.indexOf('threadline-graph-label-in')))
  assert.ok(reduced.length > 0, '必须有 reduced-motion 段')
  assert.match(reduced, /animation:\s*none/, 'reduced-motion 下必须关掉动画')
})
