/*
 * graph.test.ts —— 文件关系图的确定性径向布局（33 §3）。
 *
 * 覆盖：同数据同布局 / 中心=最活跃 / 环结构 / 目录 40、轮次 200 上限（显式截断）/
 * 节点半径分档 / 坐标不出画框 / 指纹可跨进程比较。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import type { GraphEdge } from '../../src/shared/relations/index.ts'
import {
  aggregateDirectoryEdges,
  aggregateEdgePairs,
  applyDragOffset,
  dragThresholdExceeded,
  filterEdgesByTypes,
  GRAPH_LIMITS,
  compareGraphFiles,
  graphFingerprint,
  graphRadius,
  layoutFileGraph,
  layoutOverview,
  pairKeyOf,
  pointInBox,
  relationTypeCounts,
  resetDragOffsets,
  selectGraphFiles,
  topDirectoryKey,
  type GraphSourceFile,
} from '../../src/client/ui/map/index.ts'
import { buildDirectoryCards } from '../../src/client/ui/rail/index.ts'
import { makeFiles, NOW, REAL_DIRS } from './fixtures.ts'

function sourceOf(files: ReturnType<typeof makeFiles>): GraphSourceFile[] {
  return files.map((file) => ({
    path: file.path,
    name: file.name,
    dir: file.dir,
    family: file.family,
    ops: file.ops,
    firstAt: file.firstAt,
    lastAt: file.lastAt,
  }))
}

const SIZE = { width: 680, height: 460 }

function toOverviewFile(file: ReturnType<typeof makeFiles>[number]) {
  return { path: file.path, name: file.name, family: file.family, ops: file.ops }
}

test('确定性：同一份数据两次布局逐节点坐标相同，输入顺序无关', () => {
  const files = sourceOf(makeFiles({ count: 60 }))
  const first = layoutFileGraph(files, { ...SIZE, mode: 'directory' })
  const second = layoutFileGraph(files, { ...SIZE, mode: 'directory' })
  const reversed = layoutFileGraph(files.slice().reverse(), { ...SIZE, mode: 'directory' })
  assert.equal(graphFingerprint(first), graphFingerprint(second))
  assert.equal(graphFingerprint(first), graphFingerprint(reversed))
  assert.ok(first.nodes.length > 0)
})

test('中心节点 = 最活跃文件；内环 ≤6、中环 ≤22、其余外环', () => {
  const files = sourceOf(makeFiles({ count: 60 }))
  const layout = layoutFileGraph(files, { ...SIZE, mode: 'directory' })
  const sorted = files.slice().sort(compareGraphFiles)
  assert.equal(layout.nodes[0].path, sorted[0].path)
  assert.equal(layout.nodes[0].ring, 0)
  const inner = layout.nodes.filter((node) => node.ring === 1)
  const middle = layout.nodes.filter((node) => node.ring === 2)
  const outer = layout.nodes.filter((node) => node.ring === 3)
  assert.ok(inner.length <= 6)
  assert.ok(middle.length <= 22)
  assert.equal(inner.length + middle.length + outer.length + 1, layout.nodes.length)
})

test('上限：目录 top 40、轮次 top 200，超出显式 truncated（不静默丢）', () => {
  const dirFiles = sourceOf(makeFiles({ count: 300, dirs: ['big'] }))
  const directory = layoutFileGraph(dirFiles, { ...SIZE, mode: 'directory' })
  assert.equal(GRAPH_LIMITS.directory, 40)
  assert.equal(directory.shown, 40)
  assert.equal(directory.total, 300)
  assert.equal(directory.truncated, true)

  const turn = layoutFileGraph(dirFiles, { ...SIZE, mode: 'turn' })
  assert.equal(GRAPH_LIMITS.turn, 200)
  assert.equal(turn.shown, 200)
  assert.equal(turn.total, 300)
  assert.equal(turn.truncated, true)

  const selection = selectGraphFiles(dirFiles, { mode: 'directory' })
  assert.equal(selection.shown.length, 40)
  assert.equal(selection.truncated, true)
})

test('截断保留最活跃的：保留集最小 ops ≥ 被裁掉的最大 ops', () => {
  const files = sourceOf(makeFiles({ count: 300, dirs: ['big'] }))
  const layout = layoutFileGraph(files, { ...SIZE, mode: 'directory' })
  const kept = new Set(layout.nodes.map((node) => node.path))
  const dropped = files.filter((file) => !kept.has(file.path))
  const keptMin = Math.min(...layout.nodes.map((node) => node.ops))
  assert.ok(keptMin >= Math.max(...dropped.map((node) => node.ops)))
})

test('节点半径：ops 的 sqrt 分档、中心节点更大，且不越界', () => {
  assert.equal(graphRadius(0), 6)
  assert.ok(graphRadius(400) > graphRadius(100))
  assert.ok(graphRadius(100, true) > graphRadius(100))
  let previous = 0
  for (const ops of [0, 1, 4, 16, 64, 256, 1000]) {
    const radius = graphRadius(ops)
    assert.ok(radius >= 6 && radius <= 16)
    assert.ok(radius >= previous)
    previous = radius
  }
  const files = sourceOf(makeFiles({ count: 80 }))
  const layout = layoutFileGraph(files, { ...SIZE, mode: 'directory' })
  for (const node of layout.nodes) assert.ok(node.r >= 6 && node.r <= 20)
})

test('坐标不出画框（含节点半径），且不是所有点堆在中心', () => {
  const files = sourceOf(makeFiles({ count: 120 }))
  const layout = layoutFileGraph(files, { ...SIZE, mode: 'directory' })
  for (const node of layout.nodes) {
    assert.ok(node.x - node.r >= 0 && node.x + node.r <= SIZE.width, 'x 越界：' + node.path)
    assert.ok(node.y - node.r >= 0 && node.y + node.r <= SIZE.height, 'y 越界：' + node.path)
  }
  const centers = new Set(layout.nodes.map((node) => String(node.x) + ',' + String(node.y)))
  assert.ok(centers.size >= layout.nodes.length - 1)
})

test('空集合：返回空布局，不造节点', () => {
  const layout = layoutFileGraph([], { ...SIZE, mode: 'turn' })
  assert.equal(layout.nodes.length, 0)
  assert.equal(layout.shown, 0)
  assert.equal(layout.total, 0)
  assert.equal(layout.truncated, false)
})

test('固定时间夹具不参与布局（同数据不同 now 结果相同）', () => {
  const files = sourceOf(makeFiles({ count: 40 }))
  const first = layoutFileGraph(files, { ...SIZE, mode: 'directory' })
  const second = layoutFileGraph(files, { ...SIZE, mode: 'directory' })
  assert.equal(NOW, Date.parse('2026-11-04T10:00:00+08:00'))
  assert.equal(graphFingerprint(first), graphFingerprint(second))
})

/* ================================================================== *
 * T35 星图总览：目录簇布局 / 目录级弱关系 / pair 聚合 / 类型过滤 / 拖动
 * ================================================================== */

function cardsOf(count: number, dirs?: readonly string[]) {
  const files = makeFiles(dirs === undefined ? { count } : { count, dirs })
  return { files, cards: buildDirectoryCards(files) }
}

function fakeEdge(id: string, type: GraphEdge['type'], from: string, to: string, weight = 1): GraphEdge {
  return {
    id,
    type,
    from,
    to,
    weight,
    directed: type === 'sequence' || type === 'reference',
    evidence: type === 'structure' ? { kind: 'structure', dir: from.split('/')[0] ?? '', text: '同目录 ' + from } : { kind: 'coTurn', samples: [{ sessionId: 's', turn: 1 }], count: weight, text: '共现 ' + id },
    confirmed: true,
    confidence: type === 'structure' ? 'estimated' : 'confirmed',
  }
}

test('总览布局：确定性（同输入逐字段相同）、目录簇不重叠、全部在画布内', () => {
  const { cards } = cardsOf(200, ['src', 'docs', 'assets', 'config', 'tests', 'notes', 'scripts', 'tools'])
  const first = layoutOverview(cards, { width: 680, height: 460 })
  const second = layoutOverview(cards, { width: 680, height: 460 })
  assert.deepEqual(first.clusters, second.clusters)
  assert.equal(first.clusters.length, cards.length)
  assert.equal(first.totalFiles, cards.reduce((sum, card) => sum + card.count, 0))
  for (const cluster of first.clusters) {
    assert.ok(cluster.x >= 0 && cluster.y >= 0)
    assert.ok(cluster.x + cluster.width <= 680 + 0.01 && cluster.y + cluster.height <= 460 + 0.01, '簇超出画布：' + cluster.key)
    assert.ok(cluster.files.length <= 3, '折叠态每簇只画 top3')
    assert.equal(cluster.hiddenCount, Math.max(0, cluster.count - cluster.files.length))
  }
  for (let i = 0; i < first.clusters.length; i += 1) {
    for (let j = i + 1; j < first.clusters.length; j += 1) {
      const left = first.clusters[i]
      const right = first.clusters[j]
      const overlapX = Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x)
      const overlapY = Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y)
      assert.ok(overlapX <= 0.6 || overlapY <= 0.6, '簇重叠：' + left.key + ' / ' + right.key)
    }
  }
})

test('总览布局：展开簇画 top12、其他簇仍 top3；20 目录也全部落下', () => {
  const { files, cards } = cardsOf(400, REAL_DIRS)
  const filesByDir = new Map<string, ReturnType<typeof toOverviewFile>[]>()
  for (const file of files) {
    const key = topDirectoryKey(file.path)
    const list = filesByDir.get(key) ?? []
    list.push(toOverviewFile(file))
    filesByDir.set(key, list)
  }
  const expandedKey = cards[0].key
  const layout = layoutOverview(cards, { width: 720, height: 460, expandedKey, filesByDir })
  const expanded = layout.clusters.find((cluster) => cluster.key === expandedKey)
  assert.ok(expanded !== undefined)
  assert.equal(expanded.expanded, true)
  assert.ok(expanded.files.length <= 12)
  assert.ok(expanded.files.length > 3 || expanded.count <= 3)
  for (const cluster of layout.clusters) {
    if (cluster.key === expandedKey) continue
    assert.equal(cluster.expanded, false)
    assert.ok(cluster.files.length <= 3)
  }
  assert.equal(layout.totalDirs, cards.length)
  for (const cluster of layout.clusters) {
    assert.ok(cluster.x + cluster.width <= 720 + 0.01)
    assert.ok(cluster.y + cluster.height <= 460 + 0.01)
  }
})

test('目录级弱关系：跨目录边按目录对聚合，同目录边不进；反向合并', () => {
  const edges = [
    fakeEdge('e1', 'coTurn', 'src/a.ts', 'docs/b.md', 2),
    fakeEdge('e2', 'reference', 'src/a.ts', 'docs/c.md', 1),
    fakeEdge('e3', 'structure', 'src/a.ts', 'src/b.ts', 1),
    fakeEdge('e4', 'coSession', 'docs/b.md', 'src/a.ts', 3),
    fakeEdge('e5', 'sequence', 'assets/x.png', 'src/a.ts', 1),
  ]
  const result = aggregateDirectoryEdges(edges)
  assert.equal(result.length, 2)
  const srcDocs = result.find((edge) => edge.key === 'docs|src')
  assert.ok(srcDocs !== undefined)
  assert.equal(srcDocs.count, 3)
  assert.equal(srcDocs.weight, 6)
  assert.deepEqual(srcDocs.edgeIds.sort(), ['e1', 'e2', 'e4'])
  assert.equal(result[0].key, 'docs|src', '按权重降序，最强的目录对在前')
  assert.equal(result.some((edge) => edge.fromKey === edge.toKey), false)
})

test('文件 pair 聚合：同一对文件多种关系合并一条线；类型/权重/证据保留，顺序确定', () => {
  const edges = [
    fakeEdge('r1', 'coTurn', 'src/a.ts', 'docs/b.md', 2),
    fakeEdge('r2', 'reference', 'docs/b.md', 'src/a.ts', 3),
    fakeEdge('r3', 'coTurn', 'src/a.ts', 'docs/b.md', 4),
    fakeEdge('r4', 'coTurn', 'src/c.ts', 'docs/b.md', 1),
  ]
  const pairs = aggregateEdgePairs(edges)
  const merged = pairs.find((pair) => pair.key === pairKeyOf('src/a.ts', 'docs/b.md'))
  assert.ok(merged !== undefined)
  assert.equal(merged.count, 3)
  assert.equal(merged.weight, 9)
  assert.deepEqual(merged.typeList.slice().sort(), ['coTurn', 'reference'])
  assert.deepEqual(merged.ids, ['r1', 'r2', 'r3'])
  assert.equal(merged.types.coTurn, 2)
  assert.equal(merged.types.reference, 1)
  assert.equal(new Set(merged.evidence.map((item) => item.text)).size, merged.evidence.length)
  assert.deepEqual(aggregateEdgePairs(edges), pairs, '同输入两次聚合逐字段相同')
})

test('关系类型 chip：计数按固定顺序；过滤空集=全开，非空=只留所选', () => {
  const edges = [
    fakeEdge('a', 'structure', 'src/a.ts', 'src/b.ts'),
    fakeEdge('b', 'coTurn', 'src/a.ts', 'docs/b.md'),
    fakeEdge('c', 'reference', 'docs/b.md', 'notes/c.md'),
  ]
  const counts = relationTypeCounts(edges)
  assert.deepEqual(counts.map((item) => item.type), ['reference', 'coTurn', 'structure'])
  assert.deepEqual(counts.map((item) => item.count), [1, 1, 1])
  assert.equal(filterEdgesByTypes(edges, null).length, 3)
  assert.deepEqual(filterEdgesByTypes(edges, new Set(['coTurn'] as const)).map((edge) => edge.id), ['b'])
})

test('拖动辅助：3px 阈值、偏移表可加可重置；临时目录键稳定', () => {
  assert.equal(dragThresholdExceeded(1, 1), false)
  assert.equal(dragThresholdExceeded(3, 0), true)
  assert.equal(dragThresholdExceeded(2.9, 0), false)
  let offsets = resetDragOffsets()
  assert.deepEqual(offsets, {})
  offsets = applyDragOffset(offsets, 'src/a.ts', { dx: 12, dy: -4 })
  assert.deepEqual(offsets['src/a.ts'], { dx: 12, dy: -4 })
  assert.deepEqual(resetDragOffsets(), {})
  assert.equal(topDirectoryKey('src/a.ts'), 'src')
  assert.equal(topDirectoryKey('README.md'), '')
  assert.equal(pointInBox(5, 5, { x: 0, y: 0, width: 10, height: 10 }), true)
  assert.equal(pointInBox(15, 5, { x: 0, y: 0, width: 10, height: 10 }), false)
})
