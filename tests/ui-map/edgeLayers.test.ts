/*
 * edgeLayers.test.ts —— 边分档（L1/L2/L3）+ 硬上限（03 §4.2.2 / R10）。
 *
 * 覆盖：
 * - L1 = structure + reference；L2 = 每点 top-3 强共现；L3 = 其余；
 * - **总绘制边数 ≤ 1.6 × 节点数**（超出按权重截断并显式报告，不静默）；
 * - 密度三档（skeleton / standard / all）与默认「标准」；
 * - top-3 选取确定性（同输入两次逐字段相同）；
 * - 焦点相关的边永不被截断（悬停必能看到它的边）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  coSessionEvidence,
  coTurnEvidence,
  createEdge,
  referenceEvidence,
  type GraphEdge,
} from '../../src/shared/relations/index.ts'
import {
  compareLayeredPairs,
  edgeCapFor,
  layerOfTypes,
  selectEdgeLayers,
  totalWeightOf,
  GRAPH_COOCCURRENCE_TOP,
  GRAPH_EDGE_FACTOR,
} from '../../src/client/ui/map/index.ts'

function coTurnEdge(from: string, to: string, weight = 1): GraphEdge {
  return createEdge({
    type: 'coTurn',
    from,
    to,
    weight,
    evidence: coTurnEvidence({ samples: [{ sessionId: 'sess-0001', turn: 1 }], count: weight }),
  })
}

function structureEdge(from: string, to: string): GraphEdge {
  return createEdge({ type: 'structure', from, to, evidence: { kind: 'structure', dir: '', text: '同属目录' } })
}

function referenceEdge(from: string, to: string): GraphEdge {
  return createEdge({
    type: 'reference',
    from,
    to,
    confirmed: true,
    evidence: referenceEvidence({ line: 3, raw: './x.ts', target: to, from, to }),
  })
}

/* ================================================================== *
 * 分档规则
 * ================================================================== */

test('L1 = structure + reference；其余类型进 L2/L3', () => {
  assert.equal(layerOfTypes(['structure']), 'L1')
  assert.equal(layerOfTypes(['reference']), 'L1')
  assert.equal(layerOfTypes(['coTurn']), 'L3')
  assert.equal(layerOfTypes(['coSession']), 'L3')
  assert.equal(layerOfTypes(['sequence']), 'L3')
  // 多类型 pair：只要有 structure/reference 就算 L1（骨架优先）。
  assert.equal(layerOfTypes(['coTurn', 'structure']), 'L1')
  assert.equal(layerOfTypes(['reference', 'coTurn']), 'L1')
})

test('边数上限 = ceil(1.6 × 节点数)', () => {
  assert.equal(GRAPH_EDGE_FACTOR, 1.6)
  assert.equal(edgeCapFor(40), 64)
  assert.equal(edgeCapFor(137), 220)
  assert.equal(edgeCapFor(1), 2)
  assert.equal(edgeCapFor(0), 2, '至少 1 条的空间（不返回 0）')
  assert.equal(edgeCapFor(40, 12), 12, '覆盖值优先')
})

test('L1 骨架默认画；L2 是每点 top-3 强共现的并集；L3 是其余（默认不画）', () => {
  const { nodeKeys, edges } = graphWithL3()
  const all: GraphEdge[] = [
    structureEdge('b.ts', 'c.ts'),
    referenceEdge('d.ts', 'e.ts'),
    ...edges,
  ]
  const result = selectEdgeLayers(all, { nodeKeys })
  assert.equal(result.countByLayer.L1, 2, 'structure + reference')
  assert.ok(result.countByLayer.L2 > 0, '有共现进 L2')
  assert.ok(result.countByLayer.L3 > 0, '有共现落进 L3')
  // 默认（standard）= L1 + L2，不含 L3。
  for (const item of result.drawn) assert.notEqual(item.layer, 'L3')

  /**
   * top-3 口径：一条共现边进 L2 ⟺ 它至少是**某一端**的 top-3（按权重降序 → pair 键升序排名）。
   * 因此单个节点可以拥有 >3 条 L2 边（它是邻居的 top-3），这符合规格「每个节点按权重取 top-3」。
   */
  const coTurnPairs = result.drawn
    .concat(result.trimmed)
    .filter((item) => item.pair.typeList.every((type) => type !== 'structure' && type !== 'reference'))
    .map((item) => item.pair)
  const ranked = coTurnPairs.slice().sort((left, right) => {
    if (left.weight !== right.weight) return right.weight - left.weight
    return left.key < right.key ? -1 : 1
  })
  const topOf = (endpoint: string): Set<string> => {
    const set = new Set<string>()
    for (const pair of ranked) {
      if (set.size >= GRAPH_COOCCURRENCE_TOP) break
      if (pair.from === endpoint || pair.to === endpoint) set.add(pair.key)
    }
    return set
  }
  for (const item of result.drawn) {
    if (item.layer === 'L1') continue
    const inTop = topOf(item.pair.from).has(item.pair.key) || topOf(item.pair.to).has(item.pair.key)
    assert.equal(inTop, true, 'L2 边必须在某一端的 top-3 里：' + item.pair.key)
  }
  // a 自己的 top-3 一定是它权重最高的 9 / 8 / 7。
  const aTop = [...topOf('a.ts')]
  const aWeights = aTop
    .map((key) => ranked.find((pair) => pair.key === key)?.weight ?? 0)
    .sort((left, right) => right - left)
  assert.deepEqual(aWeights, [9, 8, 7], 'a 的 top-3 应是最高的三条权重')
})

test('top-3 选取确定性：同输入两次逐字段相同（含顺序）', () => {
  const nodeKeys = new Set(['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts'])
  const edges: GraphEdge[] = [
    coTurnEdge('a.ts', 'b.ts', 5),
    coTurnEdge('a.ts', 'c.ts', 5),
    coTurnEdge('a.ts', 'd.ts', 5),
    coTurnEdge('a.ts', 'e.ts', 5),
    coTurnEdge('b.ts', 'c.ts', 3),
  ]
  const first = selectEdgeLayers(edges, { nodeKeys })
  const second = selectEdgeLayers(edges, { nodeKeys })
  assert.deepEqual(
    first.drawn.map((item) => item.pair.key + ':' + item.layer),
    second.drawn.map((item) => item.pair.key + ':' + item.layer),
  )
  assert.deepEqual(
    first.trimmed.map((item) => item.pair.key),
    second.trimmed.map((item) => item.pair.key),
  )
  // 权重相同时按 pair 键升序（确定性打破平局）。
  const order = first.drawn.filter((item) => item.layer === 'L2').map((item) => item.pair.key)
  assert.deepEqual(order, order.slice().sort())
})

/* ================================================================== *
 * 硬上限
 * ================================================================== */

test('硬上限：超过 1.6×n 时按权重截断，并显式报告 trimmed（不静默）', () => {
  const nodeKeys = new Set<string>()
  for (let index = 0; index < 10; index += 1) nodeKeys.add('n-' + String(index) + '.ts')
  const edges: GraphEdge[] = []
  // 10 个节点，全部两两共现（45 pair）→ 上限 = ceil(1.6×10) = 16。
  for (let left = 0; left < 10; left += 1) {
    for (let right = left + 1; right < 10; right += 1) {
      edges.push(coTurnEdge('n-' + String(left) + '.ts', 'n-' + String(right) + '.ts', 1 + ((left * 7 + right) % 20)))
    }
  }
  const result = selectEdgeLayers(edges, { nodeKeys, density: 'all' })
  assert.equal(result.maxEdges, edgeCapFor(10))
  assert.ok(result.drawn.length <= result.maxEdges, '画出来的边不得超过上限：' + result.drawn.length)
  assert.equal(result.truncated, true, '必须显式标记截断')
  assert.ok(result.trimmed.length > 0, '必须报告被截掉的边（不静默）')
  assert.equal(result.drawn.length + result.trimmed.length, 45, '守恒：drawn + trimmed = 全部 pair')
  // 保留的必须权重更高（按权重截断）。
  const keptWeights = result.drawn.map((item) => item.pair.weight)
  const droppedWeights = result.trimmed.map((item) => item.pair.weight)
  assert.ok(Math.min(...keptWeights) >= Math.max(...droppedWeights), '必须保留权重最高的一批')
})

test('硬上限：焦点相关的边永不被截断（悬停必能看到它的边）', () => {
  const nodeKeys = new Set<string>()
  for (let index = 0; index < 8; index += 1) nodeKeys.add('n-' + String(index) + '.ts')
  const edges: GraphEdge[] = []
  // 让 n-7 的边权重最低（否则会被优先保留，测不出"强制保留"）。
  for (let other = 0; other < 7; other += 1) edges.push(coTurnEdge('n-7.ts', 'n-' + String(other) + '.ts', 1))
  for (let left = 0; left < 7; left += 1) {
    for (let right = left + 1; right < 7; right += 1) {
      edges.push(coTurnEdge('n-' + String(left) + '.ts', 'n-' + String(right) + '.ts', 5))
    }
  }
  const withoutFocus = selectEdgeLayers(edges, { nodeKeys, density: 'all', maxEdges: 4 })
  const withFocus = selectEdgeLayers(edges, { nodeKeys, density: 'all', maxEdges: 4, focusKey: 'n-7.ts' })
  // 无焦点时 n-7 的边（权重 1）全被截掉。
  assert.equal(
    withoutFocus.drawn.some((item) => item.pair.from === 'n-7.ts' || item.pair.to === 'n-7.ts'),
    false,
    '低权重边在无焦点时应被截掉',
  )
  // 有焦点时，n-7 的边必须都在（强制保留）。
  const focusDrawn = withFocus.drawn.filter((item) => item.pair.from === 'n-7.ts' || item.pair.to === 'n-7.ts')
  assert.ok(focusDrawn.length > 0, '焦点边必须保留')
  assert.ok(withFocus.drawn.length >= focusDrawn.length)
  // 除焦点边外仍然受上限约束（不能因为焦点就无限画）。
  assert.ok(withFocus.drawn.length <= withFocus.maxEdges + focusDrawn.length)
})

test('上限守恒：任何档位下 drawn ≤ maxEdges（除焦点例外）', () => {
  const nodeKeys = new Set<string>()
  for (let index = 0; index < 20; index += 1) nodeKeys.add('n-' + String(index) + '.ts')
  const edges: GraphEdge[] = []
  for (let left = 0; left < 20; left += 1) {
    for (let step = 1; step <= 3; step += 1) {
      edges.push(coTurnEdge('n-' + String(left) + '.ts', 'n-' + String((left + step) % 20) + '.ts', 1))
    }
  }
  for (const density of ['skeleton', 'standard', 'all'] as const) {
    const result = selectEdgeLayers(edges, { nodeKeys, density })
    assert.ok(result.drawn.length <= result.maxEdges, density + ' 档超上限：' + result.drawn.length)
  }
})

/* ================================================================== *
 * 密度档位
 * ================================================================== */

/**
 * 构造"确定会落进 L3"的图：
 * - a 有 5 条共现（9/8/7/6/5）→ a 自己的 top-3 = 9/8/7；
 * - 邻居 e / f 各有 3 条**更重**的边（12/11/10）→ 它们的 top-3 被占满，a-e / a-f 也进不去；
 *   于是 a-e（6）、a-f（5）必然是 L3。
 */
function graphWithL3(): { nodeKeys: Set<string>; edges: GraphEdge[] } {
  const nodeKeys = new Set([
    'a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts', 'f.ts',
    'e1.ts', 'e2.ts', 'e3.ts', 'f1.ts', 'f2.ts', 'f3.ts',
  ])
  const edges: GraphEdge[] = [
    coTurnEdge('a.ts', 'b.ts', 9),
    coTurnEdge('a.ts', 'c.ts', 8),
    coTurnEdge('a.ts', 'd.ts', 7),
    coTurnEdge('a.ts', 'e.ts', 6),
    coTurnEdge('a.ts', 'f.ts', 5),
    coTurnEdge('e.ts', 'e1.ts', 12),
    coTurnEdge('e.ts', 'e2.ts', 11),
    coTurnEdge('e.ts', 'e3.ts', 10),
    coTurnEdge('f.ts', 'f1.ts', 12),
    coTurnEdge('f.ts', 'f2.ts', 11),
    coTurnEdge('f.ts', 'f3.ts', 10),
  ]
  return { nodeKeys, edges }
}

test('密度三档：skeleton 只 L1；standard = L1+L2（默认）；all 含 L3', () => {
  const { nodeKeys, edges } = graphWithL3()
  edges.unshift(structureEdge('b.ts', 'c.ts'))
  const skeleton = selectEdgeLayers(edges, { nodeKeys, density: 'skeleton' })
  const standard = selectEdgeLayers(edges, { nodeKeys, density: 'standard' })
  const all = selectEdgeLayers(edges, { nodeKeys, density: 'all' })
  assert.equal(skeleton.drawn.every((item) => item.layer === 'L1'), true)
  assert.equal(skeleton.drawn.length, 1)
  assert.ok(standard.drawn.length > skeleton.drawn.length, '标准档比骨架多（L2）')
  assert.equal(standard.drawn.every((item) => item.layer !== 'L3'), true)
  assert.ok(all.countByLayer.L3 > 0, '应真有 L3（证明分档发生了）')
  assert.ok(all.truncated === false, '不该触发硬上限')
  assert.ok(all.drawn.length > standard.drawn.length, '全部档比标准多（L3）')
  assert.ok(all.drawn.some((item) => item.layer === 'L3'))
  // 缺省 = standard。
  const front = selectEdgeLayers(edges, { nodeKeys })
  assert.deepEqual(
    front.drawn.map((item) => item.pair.key),
    standard.drawn.map((item) => item.pair.key),
  )
})

test('只画两端都在节点集合内的边（当前目录之外的关系不进图内分层）', () => {
  const nodeKeys = new Set(['a.ts', 'b.ts'])
  const edges: GraphEdge[] = [structureEdge('a.ts', 'b.ts'), structureEdge('a.ts', 'outside/x.ts'), coTurnEdge('b.ts', 'outside/y.ts', 9)]
  const result = selectEdgeLayers(edges, { nodeKeys })
  assert.equal(result.drawn.length, 1)
  assert.equal(result.drawn[0].pair.from, 'a.ts')
  assert.equal(result.drawn[0].pair.to, 'b.ts')
})

test('大小写不敏感：节点键与边端点大小写不同也能匹配', () => {
  const nodeKeys = new Set(['src/a.ts', 'src/b.ts'])
  const edges: GraphEdge[] = [structureEdge('SRC/A.TS', 'src/B.ts')]
  const result = selectEdgeLayers(edges, { nodeKeys })
  assert.equal(result.drawn.length, 1)
})

/* ================================================================== *
 * 焦点淡入（L3）
 * ================================================================== */

test('焦点：L3 里碰到焦点的边进 focusOnly（默认不画，悬停才淡入）', () => {
  const { nodeKeys, edges } = graphWithL3()
  const plain = selectEdgeLayers(edges, { nodeKeys, density: 'standard' })
  assert.ok(plain.countByLayer.L3 >= 2, '应有 L3 边（a-e / a-f）')
  assert.equal(plain.focusOnly.length, 0, '无焦点时没有 focusOnly')
  const focused = selectEdgeLayers(edges, { nodeKeys, density: 'standard', focusKey: 'a.ts' })
  assert.ok(focused.focusOnly.length >= 2, '有焦点时 a 的 L3 边进 focusOnly：' + focused.focusOnly.length)
  for (const item of focused.focusOnly) {
    assert.equal(item.layer, 'L3')
    assert.ok(
      item.pair.from.toLowerCase() === 'a.ts' || item.pair.to.toLowerCase() === 'a.ts',
      'focusOnly 必须碰到焦点：' + item.pair.key,
    )
  }
  // focusOnly 不进 drawn（默认不画；UI 负责在悬停时淡入）。
  const drawnKeys = new Set(focused.drawn.map((item) => item.pair.key))
  assert.equal(
    focused.focusOnly.some((item) => drawnKeys.has(item.pair.key)),
    false,
    'focusOnly 不能同时出现在 drawn 里',
  )
})

test('同会话共现也算共现（进 L2/L3，不当成 L1）', () => {
  const nodeKeys = new Set(['a.ts', 'b.ts'])
  const edge = createEdge({
    type: 'coSession',
    from: 'a.ts',
    to: 'b.ts',
    evidence: coSessionEvidence(['sess-0001']),
  })
  const result = selectEdgeLayers([edge], { nodeKeys })
  assert.equal(result.countByLayer.L1, 0, '同会话共现不是骨架')
  assert.ok(result.countByLayer.L2 + result.countByLayer.L3 === 1)
})

/* ================================================================== *
 * 排序与工具
 * ================================================================== */

test('compareLayeredPairs：权重降序 → pair 键升序（稳定）', () => {
  const nodeKeys = new Set(['a.ts', 'b.ts', 'c.ts'])
  const heavy = selectEdgeLayers([structureEdge('a.ts', 'b.ts'), structureEdge('a.ts', 'c.ts')], { nodeKeys })
  const sorted = heavy.drawn.slice().sort(compareLayeredPairs)
  assert.deepEqual(
    heavy.drawn.map((item) => item.pair.key),
    sorted.map((item) => item.pair.key),
  )
})

test('totalWeightOf：权重求和（图头/线宽用）', () => {
  const nodeKeys = new Set(['a.ts', 'b.ts'])
  const edges: GraphEdge[] = [coTurnEdge('a.ts', 'b.ts', 7)]
  const result = selectEdgeLayers(edges, { nodeKeys })
  assert.equal(result.drawn.length, 1)
  assert.equal(totalWeightOf(result.drawn), 7)
  assert.equal(totalWeightOf([]), 0)
})

test('空输入：不炸、不产生边', () => {
  const result = selectEdgeLayers([], { nodeKeys: new Set() })
  assert.deepEqual(result.drawn, [])
  assert.deepEqual(result.trimmed, [])
  assert.deepEqual(result.focusOnly, [])
  assert.equal(result.truncated, false)
  assert.deepEqual(result.countByLayer, { L1: 0, L2: 0, L3: 0 })
})
