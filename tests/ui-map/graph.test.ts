/*
 * graph.test.ts —— 轮次图的确定性径向布局 + 边 pair 聚合 / 类型过滤（纯函数）。
 *
 * 覆盖：同数据同布局 / 中心=最活跃 / 环结构 / 轮次 200 上限（显式截断）/
 * 节点半径分档 / 坐标不出画框 / 指纹可跨进程比较 / pair 聚合 / 类型计数与过滤 / 拖动阈值。
 *
 * 注意：目录图（folder）**不走**径向布局，它的确定性/分区断言在 `folder.test.ts`；
 * 相机（缩放中心）断言在 `camera.test.ts`。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import type { GraphEdge } from '../../src/shared/relations/index.ts'
import {
  aggregateEdgePairs,
  compareGraphFiles,
  dragThresholdExceeded,
  DRAG_THRESHOLD_PX,
  filterEdgesByTypes,
  graphFingerprint,
  graphRadius,
  GRAPH_LIMITS,
  layoutFileGraph,
  pairKeyOf,
  relationTypeCounts,
  selectGraphFiles,
  type GraphSourceFile,
} from '../../src/client/ui/map/index.ts'
import { makeFiles, NOW } from './fixtures.ts'

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

test('确定性：同一份数据两次布局逐节点坐标相同，输入顺序无关', () => {
  const files = sourceOf(makeFiles({ count: 60 }))
  const first = layoutFileGraph(files, { ...SIZE, mode: 'turn' })
  const second = layoutFileGraph(files, { ...SIZE, mode: 'turn' })
  const reversed = layoutFileGraph(files.slice().reverse(), { ...SIZE, mode: 'turn' })
  assert.equal(graphFingerprint(first), graphFingerprint(second))
  assert.equal(graphFingerprint(first), graphFingerprint(reversed))
  assert.ok(first.nodes.length > 0)
})

test('中心节点 = 最活跃文件；内环 ≤6、中环 ≤22、其余外环', () => {
  const files = sourceOf(makeFiles({ count: 60 }))
  const layout = layoutFileGraph(files, { ...SIZE, mode: 'turn' })
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

test('上限：轮次 top 200，超出显式 truncated（不静默丢）', () => {
  const files = sourceOf(makeFiles({ count: 300, dirs: ['big'] }))
  const turn = layoutFileGraph(files, { ...SIZE, mode: 'turn' })
  assert.equal(GRAPH_LIMITS.turn, 200)
  assert.equal(turn.shown, 200)
  assert.equal(turn.total, 300)
  assert.equal(turn.truncated, true)

  const selection = selectGraphFiles(files, { mode: 'turn' })
  assert.equal(selection.shown.length, 200)
  assert.equal(selection.truncated, true)
  // 显式覆盖上限（测试/特殊场景）。
  assert.equal(selectGraphFiles(files, { mode: 'turn', limit: 12 }).shown.length, 12)
})

test('截断保留最活跃的：保留集最小 ops ≥ 被裁掉的最大 ops', () => {
  const files = sourceOf(makeFiles({ count: 300, dirs: ['big'] }))
  const layout = layoutFileGraph(files, { ...SIZE, mode: 'turn' })
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
  const layout = layoutFileGraph(files, { ...SIZE, mode: 'turn' })
  for (const node of layout.nodes) assert.ok(node.r >= 6 && node.r <= 20)
})

test('坐标不出画框（含节点半径），且不是所有点堆在中心', () => {
  const files = sourceOf(makeFiles({ count: 120 }))
  const layout = layoutFileGraph(files, { ...SIZE, mode: 'turn' })
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
  const first = layoutFileGraph(files, { ...SIZE, mode: 'turn' })
  const second = layoutFileGraph(files, { ...SIZE, mode: 'turn' })
  assert.equal(NOW, Date.parse('2026-11-04T10:00:00+08:00'))
  assert.equal(graphFingerprint(first), graphFingerprint(second))
})

/* ================================================================== *
 * 边 pair 聚合 / 类型计数 / 过滤 / 拖动阈值
 * ================================================================== */

function fakeEdge(id: string, type: GraphEdge['type'], from: string, to: string, weight = 1): GraphEdge {
  return {
    id,
    type,
    from,
    to,
    weight,
    directed: type === 'sequence' || type === 'reference',
    evidence:
      type === 'structure'
        ? { kind: 'structure', dir: from.split('/')[0] ?? '', text: '同目录 ' + from }
        : { kind: 'coTurn', samples: [{ sessionId: 's', turn: 1 }], count: weight, text: '共现 ' + id },
    confirmed: true,
    confidence: type === 'structure' ? 'estimated' : 'confirmed',
  }
}

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
  // 权重最高的 pair 排在最前。
  assert.equal(pairs[0].key, pairKeyOf('src/a.ts', 'docs/b.md'))
})

test('pair 键：大小写不敏感、无向（from/to 交换得到同一个键）', () => {
  assert.equal(pairKeyOf('a', 'b'), pairKeyOf('b', 'a'))
  assert.equal(pairKeyOf('A', 'a'), pairKeyOf('a', 'A'))
  assert.equal(pairKeyOf('Src/A.ts', 'docs/B.md'), pairKeyOf('docs/b.md', 'src/a.ts'))
  // 左小右大：'docs/...' < 'src/...'，因此键里 docs 在前。
  assert.equal(pairKeyOf('src/a.ts', 'docs/b.md'), 'docs/b.md' + '\u0000' + 'src/a.ts')
})

test('关系类型计数：按固定顺序；过滤空集=全开，非空=只留所选', () => {
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

test('拖动阈值：3px 以下算 click，以上算拖动', () => {
  assert.equal(DRAG_THRESHOLD_PX, 3)
  assert.equal(dragThresholdExceeded(1, 1), false)
  assert.equal(dragThresholdExceeded(3, 0), true)
  assert.equal(dragThresholdExceeded(2.9, 0), false)
  assert.equal(dragThresholdExceeded(0, 0), false)
})
