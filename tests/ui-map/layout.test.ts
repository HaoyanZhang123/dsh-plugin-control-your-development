/*
 * layout.test.ts —— 星图确定性布局（03 §4.1、04 §4.5；验收 A41-4 的静态一半）。
 *
 * 覆盖：
 * - 同数据同布局（两次调用逐节点坐标相等；输入顺序无关）；
 * - 刷新复用坐标（路径集合不变 → reusedPrevious，无位移）；
 * - 目录簇：按顶层目录分簇、节点在簇边界内、簇顺序确定；
 * - 上限：1200 → 600（不静默）；半径 3–9 的 log 缩放；
 * - 性能：600 节点 / 4000+ 原始边 的布局 + 边选择 < 150ms；
 * - 源码守门：布局相关模块里没有 Math.random / Date.now / new Date。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PLUGIN_ROOT } from '../harness/styles-codegen.ts'
import {
  clusterKeyOf,
  layoutEqual,
  layoutFingerprint,
  layoutMap,
  MAP_LIMITS,
  NODE_RADIUS,
  radiusFor,
  ringCapacity,
  ringSlot,
  selectActiveNodes,
} from '../../src/client/ui/map/index.ts'
import { prepareEdges, selectVisibleEdges } from '../../src/client/ui/map/relations.ts'
import { caseKey } from '../../src/shared/relations/index.ts'
import { makeFiles, makeLargeDataset, NOW } from './fixtures.ts'

test('确定性：同一份数据两次布局逐节点坐标相等', () => {
  const files = makeFiles({ count: 200 })
  const first = layoutMap(files)
  const second = layoutMap(files)
  assert.equal(layoutEqual(first, second), true)
  assert.equal(layoutFingerprint(first), layoutFingerprint(second))
  assert.ok(first.nodes.length > 0)
})

test('确定性：输入数组顺序不影响布局（内部先按活跃度排序）', () => {
  const files = makeFiles({ count: 120 })
  const ordered = layoutMap(files)
  const shuffled = layoutMap(files.slice().reverse())
  assert.equal(layoutFingerprint(ordered), layoutFingerprint(shuffled))
})

test('刷新不跳：同一路径集合传 previous → 坐标整体复用，无位移', () => {
  const files = makeFiles({ count: 200 })
  const first = layoutMap(files)
  const refreshed = layoutMap(files, { previous: first })
  assert.equal(refreshed.reusedPrevious, true)
  assert.deepEqual(refreshed.moved, [])
  assert.equal(layoutFingerprint(first), layoutFingerprint(refreshed))
  // 数据字段变了（ops 增大）但坐标不变：刷新不重排（03 §4.1）。
  const mutated = files.map((file, index) => (index % 7 === 0 ? { ...file, ops: file.ops + 10 } : file))
  const afterMutation = layoutMap(mutated, { previous: refreshed })
  assert.equal(afterMutation.reusedPrevious, true)
  for (const node of afterMutation.nodes) {
    const before = refreshed.nodes.find((item) => item.path === node.path)
    assert.ok(before)
    assert.equal(node.x, before.x)
    assert.equal(node.y, before.y)
  }
})

test('新增节点才重排：路径集合变化 → reusedPrevious=false', () => {
  const files = makeFiles({ count: 100 })
  const first = layoutMap(files)
  const withExtra = layoutMap([...files, ...makeFiles({ count: 1, seed: 99 })], { previous: first })
  assert.equal(withExtra.reusedPrevious, false)
  assert.equal(withExtra.nodes.length, 101)
})

test('目录簇：按顶层目录分簇，节点圆心在簇边界内，标签确定且唯一', () => {
  const files = makeFiles({ count: 200 })
  const layout = layoutMap(files)
  assert.ok(layout.clusters.length >= 2)
  const labels = layout.clusters.map((cluster) => cluster.label)
  assert.equal(new Set(labels).size, labels.length)
  for (const node of layout.nodes) {
    assert.equal(node.cluster, clusterKeyOf(node.path))
    const cluster = layout.clusters.find((item) => item.key === node.cluster)
    assert.ok(cluster, '节点必须有簇: ' + node.path)
    assert.ok(node.x >= cluster.x && node.x <= cluster.x + cluster.width, node.path + ' 横向越界')
    assert.ok(node.y >= cluster.y && node.y <= cluster.y + cluster.height, node.path + ' 纵向越界')
  }
})

test('上限：1200 个节点只布局最活跃的 600 个，并显式给出截断信息', () => {
  const files = makeFiles({ count: 1200, seed: 5 })
  const selection = selectActiveNodes(files)
  assert.equal(selection.total, 1200)
  assert.equal(selection.shown.length, MAP_LIMITS.maxNodes)
  assert.deepEqual(selection.truncation, { truncated: true, shown: 600, total: 1200, hidden: 600 })
  const layout = layoutMap(files)
  assert.equal(layout.nodes.length, 600)
  assert.equal(layout.total, 1200)
  // 保留的是 ops 最高的那批：最小值不小于被裁掉的最大值。
  const keptMinOps = Math.min(...layout.nodes.map((node) => node.ops))
  const dropped = files
    .slice()
    .sort((left, right) => right.ops - left.ops)
    .slice(600)
  assert.ok(keptMinOps >= Math.max(...dropped.map((node) => node.ops)))
})

test('半径：ops 的 log 缩放在 3–9px 之间，且随 ops 单调不减', () => {
  assert.equal(radiusFor(0, 100), NODE_RADIUS.min)
  assert.equal(radiusFor(100, 100), NODE_RADIUS.max)
  let previous = -1
  for (const ops of [1, 2, 5, 10, 40, 120, 500]) {
    const radius = radiusFor(ops, 500)
    assert.ok(radius >= NODE_RADIUS.min && radius <= NODE_RADIUS.max)
    assert.ok(radius >= previous)
    previous = radius
  }
})

test('同心环：ringSlot 覆盖序号不重叠，容量按周长增长', () => {
  let covered = 0
  for (let ring = 0; ring < 6; ring += 1) {
    const capacity = ringCapacity(ring)
    assert.equal(capacity, ring === 0 ? 1 : Math.floor(2 * Math.PI * ring))
    covered += capacity
    assert.equal(ringSlot(covered - 1).ring, ring)
  }
  assert.equal(ringSlot(0).ring, 0)
})

const LAYOUT_SOURCES = [
  'src/client/ui/map/layout.ts',
  'src/client/ui/map/labels.ts',
  'src/client/ui/map/relations.ts',
  'src/client/ui/map/viewport.ts',
]

test('源码守门：布局链路里没有 Math.random / Date.now / new Date（注释里的说明不算调用）', () => {
  for (const relative of LAYOUT_SOURCES) {
    const source = readFileSync(join(PLUGIN_ROOT, relative), 'utf8')
    assert.equal(/Math\.random\s*\(/.test(source), false, relative + ' 出现了 Math.random()')
    assert.equal(/Date\.now\s*\(/.test(source), false, relative + ' 出现了 Date.now()')
    assert.equal(/new\s+Date\s*\(/.test(source), false, relative + ' 出现了 new Date()')
  }
})

test('性能：600 节点 / 4000+ 原始边的布局 + 边选择 < 150ms，两次布局一致', () => {
  const dataset = makeLargeDataset()
  assert.ok(dataset.files.length === 600)
  assert.ok(dataset.rawEdges.length >= 4000, '夹具必须≥4000 条原始边，实际 ' + dataset.rawEdges.length)

  const layoutStart = performance.now()
  const first = layoutMap(dataset.files)
  const layoutMs = performance.now() - layoutStart

  const focusKey = caseKey(first.nodes[0].path)
  const edgeStart = performance.now()
  const graph = prepareEdges(dataset.rawEdges)
  const view = selectVisibleEdges(graph, {
    focus: { key: focusKey },
    showAllRelations: false,
    showAllReferences: false,
    selectedTurn: { sessionId: dataset.turns[0].sessionId, turn: dataset.turns[0].turn },
  })
  const edgeMs = performance.now() - edgeStart
  const elapsed = layoutMs + edgeMs

  const second = layoutMap(dataset.files)
  assert.equal(layoutEqual(first, second), true)
  assert.equal(first.nodes.length, 600)
  assert.ok(graph.edges.length <= 4000)
  assert.ok(view.graph.edges.length <= 4000)
  assert.ok(elapsed < 150, '布局+边选择耗时 ' + elapsed.toFixed(1) + 'ms，超过 150ms')
  console.log(
    '[A41-4] 600 节点 / ' + dataset.rawEdges.length + ' 原始边：layout ' + layoutMs.toFixed(1) + 'ms + 收口&选边 ' + edgeMs.toFixed(1) + 'ms = ' + elapsed.toFixed(1) + 'ms；两次布局逐节点一致',
  )
  // 交互帧：焦点切换（邻居计算 + 焦点边过滤）远低于 16ms（收口只在 edges 变化时做一次）。
  const interactionStart = performance.now()
  for (let index = 0; index < 20; index += 1) {
    selectVisibleEdges(graph, { focus: { key: focusKey }, selectedTurn: null })
  }
  const interactionElapsed = (performance.now() - interactionStart) / 20
  assert.ok(interactionElapsed < 16, '单次焦点切换 ' + interactionElapsed.toFixed(2) + 'ms，超过 16ms')
  console.log('[A41-4] 单次焦点切换（20 次均值）' + interactionElapsed.toFixed(2) + 'ms')
  assert.equal(NOW, dataset.now)
})
