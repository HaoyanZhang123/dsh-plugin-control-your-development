/*
 * edges.test.ts —— 四层边的显示规则与上限（03 §4.2 / §10；06 N-09 / N-10；A41-1/A41-4）。
 *
 * 覆盖：
 * - 默认只在聚焦时画共现/引用；结构常驻；时序只在选中轮次；
 * - 未确认引用不画；图层开关可关；
 * - 单节点 top-12（不静默，给收拢计数）、全局 4000；
 * - 焦点邻居与 20% 透明度的纯函数。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import type { FileNode } from '../../src/shared/events/index.ts'
import {
  coTurnEvidence,
  createEdge,
  referenceEvidence,
  finalizeGraph,
  type GraphEdge,
} from '../../src/shared/relations/index.ts'
import { caseKey } from '../../src/shared/relations/index.ts'
import {
  FOCUS_DIM_OPACITY,
  aggregateEdgePairs,
  filterEdgesByTypes,
  nodeOpacity,
  prepareEdges,
  relationTypeCounts,
  selectVisibleEdges,
  neighborKeysOf,
  RELATION_LEGEND_ORDER,
} from '../../src/client/ui/map/index.ts'
import { makeDataset } from './fixtures.ts'

function minimalFile(path: string): FileNode {
  return {
    path,
    name: path.slice(path.lastIndexOf('/') + 1),
    dir: path.lastIndexOf('/') === -1 ? '' : path.slice(0, path.lastIndexOf('/')),
    family: 'code',
    firstAt: 0,
    lastAt: 1,
    reads: 1,
    writes: 0,
    searches: 0,
    added: 0,
    removed: 0,
    ops: 1,
    sessionIds: [],
    sessionCount: 0,
    turnCount: 0,
  }
}

function coTurnEdge(from: string, to: string, weight = 1): GraphEdge {
  return createEdge({
    type: 'coTurn',
    from,
    to,
    weight,
    evidence: coTurnEvidence({ samples: [{ sessionId: 'sess-0001', turn: 1 }], count: weight }),
  })
}

test('默认（无焦点）：只画结构层；共现/引用/时序都不画', () => {
  const dataset = makeDataset()
  const graph = prepareEdges(dataset.edges)
  const view = selectVisibleEdges(graph, {})
  assert.ok(view.drawn.length > 0)
  assert.equal(view.visibleByType.coTurn, 0)
  assert.equal(view.visibleByType.coSession, 0)
  assert.equal(view.visibleByType.reference, 0)
  assert.equal(view.visibleByType.sequence, 0)
  assert.equal(view.visibleByType.structure, view.drawn.length)
})

test('聚焦：共现/引用只画碰到焦点的边（其它边不画）', () => {
  const dataset = makeDataset()
  const graph = prepareEdges(dataset.edges)
  const focusEdge = graph.edges.find((edge) => edge.type === 'coTurn')
  assert.ok(focusEdge)
  const focusKey = caseKey(focusEdge.from)
  const view = selectVisibleEdges(graph, { focus: { key: focusKey } })
  assert.ok(view.visibleByType.coTurn > 0)
  for (const item of view.drawn) {
    if (item.type === 'structure') continue
    assert.ok(
      caseKey(item.edge.from) === focusKey || caseKey(item.edge.to) === focusKey,
      '非结构边必须碰到焦点：' + item.edge.id,
    )
  }
})

test('「显示全部关系」：全局画共现（受上限约束），打开 coSession 层后同会话共现也画', () => {
  const dataset = makeDataset()
  const graph = prepareEdges(dataset.edges)
  const view = selectVisibleEdges(graph, { showAllRelations: true, layers: { coSession: true } })
  assert.ok(view.visibleByType.coTurn > 0)
  assert.ok(view.visibleByType.coSession > 0)
  const coTurnTotal = graph.edges.filter((edge) => edge.type === 'coTurn').length
  assert.equal(view.visibleByType.coTurn, coTurnTotal)
})

test('引用：未确认（confirmed=false）一律不画（N-09）', () => {
  const dataset = makeDataset()
  const confirmed = dataset.edges.find((edge) => edge.type === 'reference' && edge.confirmed)
  assert.ok(confirmed)
  // 用一对"没有已确认引用"的文件，避免被 finalizeGraph 合并掉。
  const pair = dataset.files.slice(60, 62)
  assert.ok(pair.length === 2)
  const unconfirmed = createEdge({
    type: 'reference',
    from: pair[0].path,
    to: pair[1].path,
    confirmed: false,
    evidence: referenceEvidence({ line: 3, raw: './x.ts', target: pair[1].path, from: pair[0].path, to: pair[1].path }),
  })
  const graph = prepareEdges([...dataset.edges, unconfirmed])
  assert.ok(graph.edges.some((edge) => edge.id === unconfirmed.id && edge.confirmed === false))
  const view = selectVisibleEdges(graph, { showAllReferences: true, focus: { key: caseKey(confirmed.from) } })
  for (const item of view.drawn) {
    if (item.type !== 'reference') continue
    assert.equal(item.edge.confirmed, true, '未确认引用被画出来了: ' + item.edge.id)
  }
  assert.ok(view.visibleByType.reference >= 1)
})

test('单节点 top-12：hub 出 40 条共现 → 收拢到 12 条并显式给 dropped（不静默）', () => {
  const hub = 'src/hub.md'
  const edges: GraphEdge[] = []
  for (let index = 0; index < 40; index += 1) {
    edges.push(coTurnEdge(hub, 'src/leaf-' + String(index).padStart(2, '0') + '.md', 40 - index))
  }
  const graph = prepareEdges(edges)
  assert.equal(graph.edges.length, 12)
  assert.equal(graph.truncation.truncated, true)
  assert.ok(graph.truncation.droppedByNode >= 28)
  const view = selectVisibleEdges(graph, { showAllRelations: true, focus: { key: caseKey(hub) } })
  assert.equal(view.drawn.length, 12)
  assert.ok(view.drawn.every((item) => caseKey(item.edge.from) === caseKey(hub) || caseKey(item.edge.to) === caseKey(hub)))
  // top-k：保留的是权重最高的 12 条（权重 40..29）。
  const weights = view.drawn.map((item) => item.edge.weight).sort((left, right) => right - left)
  assert.deepEqual(weights, [40, 39, 38, 37, 36, 35, 34, 33, 32, 31, 30, 29])
})

test('全局 4000：6000 条（12-正则环）→ 保留 4000，droppedByGlobal=2000', () => {
  const nodes = 1000
  const edges: GraphEdge[] = []
  for (let index = 0; index < nodes; index += 1) {
    for (let step = 1; step <= 6; step += 1) {
      edges.push(coTurnEdge('src/n-' + String(index).padStart(4, '0') + '.ts', 'src/n-' + String((index + step) % nodes).padStart(4, '0') + '.ts'))
    }
  }
  const graph = prepareEdges(edges, { perNode: 12, global: 4000 })
  assert.equal(graph.edges.length, 4000)
  assert.equal(graph.truncation.droppedByGlobal, 2000)
  assert.equal(graph.truncation.truncated, true)
  const view = selectVisibleEdges(graph, { showAllRelations: true })
  assert.ok(view.drawn.length <= 4000)
  assert.ok(view.truncation.text.includes('2000') || view.truncation.dropped === 2000)
})

test('时序：只有选中轮次时画该轮；序号 1..n', () => {
  const dataset = makeDataset()
  const sequenceEdges = dataset.sequence
  assert.ok(sequenceEdges.length >= 2)
  const turn = dataset.turns[0]
  const graph = prepareEdges([...dataset.edges, ...sequenceEdges])
  const withoutTurn = selectVisibleEdges(graph, { layers: { sequence: true } })
  assert.equal(withoutTurn.visibleByType.sequence, 0)
  const view = selectVisibleEdges(graph, { layers: { sequence: true }, selectedTurn: { sessionId: turn.sessionId, turn: turn.turn } })
  assert.ok(view.visibleByType.sequence >= 2)
  const orders = view.drawn
    .filter((item) => item.type === 'sequence')
    .map((item) => item.order as number)
    .sort((left, right) => left - right)
  assert.deepEqual(
    orders,
    orders.map((_, index) => index + 1),
    '时序序号应从 1 连续递增',
  )
})

test('图层开关：关掉结构层后结构边不画', () => {
  const dataset = makeDataset()
  const graph = prepareEdges(dataset.edges)
  const view = selectVisibleEdges(graph, { layers: { structure: false } })
  assert.equal(view.visibleByType.structure, 0)
  assert.equal(view.drawn.length, 0)
})

test('焦点邻居 + 20% 透明度：只改透明度语义，不掺坐标', () => {
  const dataset = makeDataset()
  const graph = prepareEdges(dataset.edges)
  const focusEdge = graph.edges.find((edge) => edge.type === 'coTurn')
  assert.ok(focusEdge)
  const focusKey = caseKey(focusEdge.from)
  const neighbors = neighborKeysOf(graph.edges, focusKey)
  assert.equal(neighbors.has(focusKey), true)
  assert.equal(neighbors.has(caseKey(focusEdge.to)), true)
  assert.equal(nodeOpacity(focusKey, focusKey, neighbors), 1)
  assert.equal(nodeOpacity(caseKey(focusEdge.to), focusKey, neighbors), 1)
  const stranger = dataset.files.find((file) => !neighbors.has(caseKey(file.path)))
  assert.ok(stranger)
  assert.equal(nodeOpacity(caseKey(stranger.path), focusKey, neighbors), FOCUS_DIM_OPACITY)
  assert.equal(nodeOpacity(caseKey(stranger.path), null, new Set()), 1)
  assert.equal(FOCUS_DIM_OPACITY, 0.2)
})

test('图例顺序固定：结构 → 共现 → 同会话 → 引用 → 时序（03 §10）', () => {
  assert.deepEqual(RELATION_LEGEND_ORDER, ['structure', 'coTurn', 'coSession', 'reference', 'sequence'])
})

test('收口确定性：同一份 rawEdges 两次 prepareEdges 结果逐条一致', () => {
  const dataset = makeDataset()
  const first = prepareEdges(dataset.rawEdges)
  const second = prepareEdges(dataset.rawEdges)
  assert.deepEqual(
    first.edges.map((edge) => edge.id),
    second.edges.map((edge) => edge.id),
  )
  // 已收口的结果再收口一次也稳定（幂等；不会越收越少）。
  const again = prepareEdges(first.edges)
  assert.deepEqual(
    first.edges.map((edge) => edge.id),
    again.edges.map((edge) => edge.id),
  )
  // counts 是"收口前各层边数"，第二次收口看到的已经是收口后的输入，因此不比较 counts。
  assert.ok(first.counts.coTurn >= again.counts.coTurn)
  assert.deepEqual(minimalFile('src/x.ts').ops, 1)
  // 每层都过 finalizeGraph：结构层自身也是上限内、确定性排序。
  assert.deepEqual(
    finalizeGraph(dataset.edges).edges.map((edge) => edge.id),
    finalizeGraph(dataset.edges).edges.map((edge) => edge.id),
  )
})

/* ================================================================== *
 * T35：pair 聚合 / 关系类型过滤（视觉线合并 + chip 过滤）
 * ================================================================== */

test('T35 pair 聚合：合并后的条数守恒、pair 数 ≤ 边数、两次聚合逐字段一致', () => {
  const prepared = prepareEdges(makeDataset().rawEdges).edges
  const pairs = aggregateEdgePairs(prepared)
  assert.ok(pairs.length > 0)
  assert.ok(pairs.length <= prepared.length)
  assert.equal(
    pairs.reduce((sum, pair) => sum + pair.count, 0),
    prepared.length,
    '聚合不能丢边（count 之和 = 原始边数）',
  )
  const ids = pairs.flatMap((pair) => pair.ids).sort()
  assert.deepEqual(ids, prepared.map((edge) => edge.id).sort())
  assert.deepEqual(aggregateEdgePairs(prepared), pairs)
  for (const pair of pairs) {
    assert.equal(new Set(pair.ids).size, pair.ids.length, '同一对文件不能重复收同一条边')
    assert.ok(pair.typeList.length >= 1)
  }
})

test('T35 类型计数与过滤：计数之和 = 边数；过滤只留所选类型且不改变顺序', () => {
  const prepared = prepareEdges(makeDataset().rawEdges).edges
  const counts = relationTypeCounts(prepared)
  assert.equal(
    counts.reduce((sum, item) => sum + item.count, 0),
    prepared.length,
  )
  assert.ok(counts.length >= 1)
  const only = new Set([counts[0].type])
  const filtered = filterEdgesByTypes(prepared, only)
  assert.ok(filtered.length > 0)
  assert.equal(filtered.every((edge) => edge.type === counts[0].type), true)
  assert.deepEqual(
    filtered.map((edge) => edge.id),
    prepared.filter((edge) => edge.type === counts[0].type).map((edge) => edge.id),
    '过滤保持原顺序',
  )
  assert.equal(filterEdgesByTypes(prepared, null).length, prepared.length)
})
