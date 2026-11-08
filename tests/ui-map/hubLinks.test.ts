/*
 * hubLinks.test.ts —— 文件夹枢纽的**跨目录真实关系**聚合（03 §4.2.2 / R10 需求 C）。
 *
 * 覆盖（含**反向断言**：没关系就绝不连线）：
 * - 跨边界真实边聚合到枢纽，权重累加、每个枢纽最多 3 条；
 * - **没有跨目录关系的枢纽：hasLinks=false / 不进 connected / 不产出任何 hubEdge**；
 * - `allEdges === undefined` → 空索引 → **零聚合、零连线**（不伪造）；
 * - 两端都在当前目录内的边**不算跨边界**（归图内分层，不要重复算到枢纽上）；
 * - 端点索引只建一次（O(E)），同输入两次逐字段相同。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { coTurnEvidence, createEdge, referenceEvidence, type GraphEdge } from '../../src/shared/relations/index.ts'
import {
  buildCrossBoundaryIndex,
  computeHubLinks,
  perimeterAngle,
  GRAPH_HUB_MAX_LINKS,
} from '../../src/client/ui/map/index.ts'

function edge(from: string, to: string, weight = 1, type: 'coTurn' | 'reference' = 'coTurn'): GraphEdge {
  if (type === 'reference') {
    return createEdge({
      type: 'reference',
      from,
      to,
      confirmed: true,
      evidence: referenceEvidence({ line: 1, raw: './x', target: to, from, to }),
    })
  }
  return createEdge({
    type: 'coTurn',
    from,
    to,
    weight,
    evidence: coTurnEvidence({ samples: [{ sessionId: 'sess-0001', turn: 1 }], count: weight }),
  })
}

/* ================================================================== *
 * 正向：有关系才连
 * ================================================================== */

test('跨边界聚合：当前目录文件 ↔ 子文件夹内文件 的边聚到枢纽（权重累加）', () => {
  const allEdges: GraphEdge[] = [
    edge('a.ts', 'docs/guide.md', 3),
    edge('a.ts', 'docs/api.md', 2),
    edge('b.ts', 'docs/guide.md', 4),
  ]
  const result = computeHubLinks(buildCrossBoundaryIndex(allEdges), {
    currentPath: '',
    filePaths: ['a.ts', 'b.ts'],
    hubPaths: ['docs', 'src'],
  })
  assert.equal(result.connected.has('docs'), true)
  assert.equal(result.connected.has('src'), false, '没有真实边的枢纽不得被标记为 connected')
  const docs = result.links.get('docs')
  assert.ok(docs !== undefined)
  // 聚合粒度是 (枢纽, 文件)，不是 (枢纽)。
  assert.equal(docs.length, 2, 'docs 下有 a.ts 与 b.ts 两个文件各一条')
  const byFile = new Map(docs.map((link) => [link.filePath, link]))
  assert.equal(byFile.get('a.ts')?.weight, 5, 'a.ts → docs 的两条边权重 3+2 应累加')
  assert.equal(byFile.get('a.ts')?.count, 2)
  assert.equal(byFile.get('b.ts')?.weight, 4)
  // src 完全没有跨边界边 → 不产生连线。
  assert.equal(result.links.has('src'), false)
})

test('跨边界聚合：同一对（枢纽,文件）多条边聚成一条（线宽 = 聚合权重）', () => {
  const allEdges: GraphEdge[] = [
    edge('a.ts', 'docs/x.md', 2),
    // reference 边的 weight 由 createEdge 决定（引用默认 1）；这里只断言"多类型也聚成一条"。
    edge('a.ts', 'docs/x.md', 3, 'reference'),
    edge('docs/x.md', 'a.ts', 5),
  ]
  const referenceWeight = allEdges[1].weight
  const result = computeHubLinks(buildCrossBoundaryIndex(allEdges), {
    currentPath: '',
    filePaths: ['a.ts'],
    hubPaths: ['docs'],
  })
  const docs = result.links.get('docs')
  assert.ok(docs !== undefined)
  assert.equal(docs.length, 1, '同一对只留一条聚合线')
  assert.equal(docs[0].weight, 2 + referenceWeight + 5, '权重累加（含引用边的真实 weight）')
  assert.equal(docs[0].count, 3, '条数是真实边数')
})

test('跨边界聚合：每个枢纽最多 3 条（只留权重最高的几个文件）', () => {
  const allEdges: GraphEdge[] = [
    edge('a.ts', 'docs/1.md', 1),
    edge('b.ts', 'docs/2.md', 5),
    edge('c.ts', 'docs/3.md', 9),
    edge('d.ts', 'docs/4.md', 7),
    edge('e.ts', 'docs/5.md', 3),
  ]
  const result = computeHubLinks(buildCrossBoundaryIndex(allEdges), {
    currentPath: '',
    filePaths: ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts'],
    hubPaths: ['docs'],
  })
  const docs = result.links.get('docs')
  assert.ok(docs !== undefined)
  assert.equal(docs.length, GRAPH_HUB_MAX_LINKS)
  assert.deepEqual(
    docs.map((link) => link.weight),
    [9, 7, 5],
    '只留权重最高的三条',
  )
  // 权重降序 → 文件路径升序（确定性）。
  for (let index = 1; index < docs.length; index += 1) {
    assert.ok(docs[index - 1].weight >= docs[index].weight)
  }
})

test('跨边界聚合：嵌套两层也归到直接子文件夹（不是更深那层）', () => {
  const allEdges: GraphEdge[] = [edge('a.ts', 'docs/deep/nested/x.md', 4)]
  const result = computeHubLinks(buildCrossBoundaryIndex(allEdges), {
    currentPath: '',
    filePaths: ['a.ts'],
    hubPaths: ['docs'],
  })
  const docs = result.links.get('docs')
  assert.ok(docs !== undefined)
  assert.equal(docs.length, 1)
  assert.equal(docs[0].weight, 4)
})

test('跨边界聚合：子目录层级下的当前目录也成立（currentPath=src）', () => {
  const allEdges: GraphEdge[] = [edge('src/a.ts', 'src/lib/b.ts', 6)]
  const result = computeHubLinks(buildCrossBoundaryIndex(allEdges), {
    currentPath: 'src',
    filePaths: ['src/a.ts'],
    hubPaths: ['src/lib'],
  })
  const lib = result.links.get('src/lib')
  assert.ok(lib !== undefined)
  assert.equal(lib[0].filePath, 'src/a.ts')
  assert.equal(lib[0].weight, 6)
})

/* ================================================================== *
 * 反向断言（必须有）
 * ================================================================== */

test('反向：没有跨目录关系的枢纽 —— 不连、不标 connected、不产任何线', () => {
  // only-inner 边 + 完全无关的边。
  const allEdges: GraphEdge[] = [
    edge('a.ts', 'b.ts', 9), // 两端都在当前目录 → 不是跨边界
    edge('elsewhere/x.ts', 'elsewhere/y.ts', 9), // 与当前目录无关
  ]
  const result = computeHubLinks(buildCrossBoundaryIndex(allEdges), {
    currentPath: '',
    filePaths: ['a.ts', 'b.ts'],
    hubPaths: ['docs', 'src'],
  })
  assert.equal(result.connected.size, 0, '不得标记任何枢纽为有连接')
  assert.equal(result.links.size, 0, '不得产出任何聚合线')
})

test('反向：allEdges === undefined → 零聚合（不做、不猜、不伪造）', () => {
  const index = buildCrossBoundaryIndex(undefined)
  assert.equal(index.size, 0)
  const result = computeHubLinks(index, {
    currentPath: '',
    filePaths: ['a.ts', 'b.ts'],
    hubPaths: ['docs'],
  })
  assert.equal(result.connected.size, 0)
  assert.equal(result.links.size, 0)
})

test('反向：两端都在当前目录内的边不算跨边界（不重复算到枢纽上）', () => {
  // a.ts ↔ b.ts 都在当前目录；不该因为路径前缀相似而被当成交往 docs。
  const allEdges: GraphEdge[] = [edge('a.ts', 'b.ts', 9)]
  const result = computeHubLinks(buildCrossBoundaryIndex(allEdges), {
    currentPath: '',
    filePaths: ['a.ts', 'b.ts'],
    hubPaths: ['a-docs'],
  })
  assert.equal(result.links.size, 0)
})

test('反向：前缀不跨目录边界匹配（docs 不该匹配 docs2 里的文件）', () => {
  const allEdges: GraphEdge[] = [edge('a.ts', 'docs2/x.md', 9)]
  const result = computeHubLinks(buildCrossBoundaryIndex(allEdges), {
    currentPath: '',
    filePaths: ['a.ts'],
    hubPaths: ['docs'],
  })
  assert.equal(result.links.size, 0, 'docs2 不是 docs 的子路径')
})

test('反向：只有一端在当前目录的边（另一端既不在当前目录也不在任何枢纽下）→ 不连', () => {
  const allEdges: GraphEdge[] = [edge('a.ts', 'unrelated/x.md', 9)]
  const result = computeHubLinks(buildCrossBoundaryIndex(allEdges), {
    currentPath: '',
    filePaths: ['a.ts'],
    hubPaths: ['docs'],
  })
  assert.equal(result.links.size, 0)
})

test('反向：空输入 → 空结果（不炸）', () => {
  const result = computeHubLinks(buildCrossBoundaryIndex([]), { currentPath: '', filePaths: ['a.ts'], hubPaths: ['docs'] })
  assert.equal(result.links.size, 0)
  assert.equal(result.connected.size, 0)
  // 没有枢纽 / 没有文件时也不炸。
  assert.equal(computeHubLinks(buildCrossBoundaryIndex([]), { currentPath: '', filePaths: [], hubPaths: ['docs'] }).links.size, 0)
  assert.equal(computeHubLinks(buildCrossBoundaryIndex([]), { currentPath: '', filePaths: ['a.ts'], hubPaths: [] }).links.size, 0)
})

/* ================================================================== *
 * 索引 / 确定性 / 外围环
 * ================================================================== */

test('端点索引：每条边对两个端点各登记一次，同输入两次逐字段相同', () => {
  const allEdges: GraphEdge[] = [edge('a.ts', 'b.ts', 1), edge('b.ts', 'c.ts', 2)]
  const first = buildCrossBoundaryIndex(allEdges)
  const second = buildCrossBoundaryIndex(allEdges)
  assert.deepEqual([...first.keys()].sort(), [...second.keys()].sort())
  assert.deepEqual([...first.keys()].sort(), ['a.ts', 'b.ts', 'c.ts'])
  assert.equal(first.get('b.ts')?.length, 2, 'b.ts 出现在两条边里')
  assert.equal(first.get('a.ts')?.length, 1)
  // 自环只登记一次（不重复算）。
  const self = buildCrossBoundaryIndex([edge('x.ts', 'x.ts', 1)])
  assert.equal(self.get('x.ts')?.length, 1)
})

test('确定性：同输入两次聚合逐字段相同（含顺序）', () => {
  const allEdges: GraphEdge[] = [
    edge('a.ts', 'docs/1.md', 2),
    edge('b.ts', 'docs/2.md', 2),
    edge('c.ts', 'docs/3.md', 2),
    edge('a.ts', 'lib/x.ts', 1),
  ]
  const options = { currentPath: '', filePaths: ['a.ts', 'b.ts', 'c.ts'], hubPaths: ['docs', 'lib'] }
  const first = computeHubLinks(buildCrossBoundaryIndex(allEdges), options)
  const second = computeHubLinks(buildCrossBoundaryIndex(allEdges), options)
  assert.deepEqual([...first.links.entries()], [...second.links.entries()])
  assert.deepEqual([...first.connected], [...second.connected])
  // 权重相同时按文件路径升序（确定性打破平局）。
  const docs = first.links.get('docs')
  assert.ok(docs !== undefined)
  const paths = docs.map((link) => link.filePath)
  assert.deepEqual(paths, paths.slice().sort())
})

test('大小写不敏感：边端点与文件路径大小写不同也能聚合', () => {
  const allEdges: GraphEdge[] = [edge('SRC/A.TS', 'src/Lib/B.TS', 5)]
  const result = computeHubLinks(buildCrossBoundaryIndex(allEdges), {
    currentPath: 'src',
    filePaths: ['src/a.ts'],
    hubPaths: ['src/lib'],
  })
  const lib = result.links.get('src/lib')
  assert.ok(lib !== undefined)
  // filePath 保留真实（原大小写）路径用于展示。
  assert.equal(lib[0].filePath, 'src/a.ts')
  assert.equal(lib[0].hubPath, 'src/lib')
})

test('perimeterAngle：外围环角度均分（−90° 起），count=0 不炸', () => {
  assert.equal(perimeterAngle(0, 0), -Math.PI / 2)
  assert.equal(perimeterAngle(0, 4), -Math.PI / 2)
  const angles = [0, 1, 2, 3].map((index) => perimeterAngle(index, 4))
  assert.deepEqual(angles.map((angle) => Math.round((angle * 180) / Math.PI)), [-90, 0, 90, 180])
})
