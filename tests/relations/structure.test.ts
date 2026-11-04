/**
 * A30-1（结构部分）：结构边唯一、同目录/跨层语义、确定性。
 * 输入是 `events.FileNode`（T03 正式类型），不再是本地最小结构。
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildStructureEdges, finalizeGraph } from '../../src/shared/relations/index.ts'
import { fileNode } from './fixtures.ts'

const FILES = [
  fileNode('README.md', { ops: 5 }),
  fileNode('docs/a.md', { ops: 9 }),
  fileNode('docs/b.md', { ops: 2 }),
  fileNode('src/x.ts', { ops: 4 }),
  fileNode('src/y.ts', { ops: 7 }),
  fileNode('src/deep/z.ts', { ops: 1 }),
]

test('A30-1 结构边：同目录连锚点 + 跨层连祖先锚点，全部唯一', () => {
  const edges = buildStructureEdges(FILES)

  // 5 条：docs 内 1、src 内 1、跨层 3（docs→root、src→root、src/deep→src）
  assert.equal(edges.length, 5)
  const ids = new Set(edges.map((edge) => edge.id))
  assert.equal(ids.size, edges.length, 'id 必须唯一')
  for (const edge of edges) {
    assert.equal(edge.type, 'structure')
    assert.equal(edge.directed, false)
    assert.equal(edge.confirmed, true)
    assert.equal(edge.confidence, 'estimated')
    assert.notEqual(edge.from, edge.to)
  }

  const pairs = edges.map((edge) => `${edge.from}>${edge.to}`).sort()
  assert.deepEqual(pairs, [
    'docs/a.md>README.md',
    'docs/b.md>docs/a.md',
    'src/deep/z.ts>src/y.ts',
    'src/x.ts>src/y.ts',
    'src/y.ts>README.md',
  ].sort())

  const first = edges.find((edge) => edge.from === 'docs/b.md')
  assert.ok(first !== undefined)
  assert.equal(first.evidence.kind, 'structure')
  assert.equal(first.evidence.text, '同属目录 docs')

  const nested = edges.find((edge) => edge.from === 'docs/a.md')
  assert.ok(nested !== undefined)
  assert.equal(nested.evidence.text, 'docs/a.md 在 README.md 的目录下')
})

test('A30-1 结构边：同一份输入两次生成逐字段一致（确定性）', () => {
  const first = buildStructureEdges(FILES)
  const second = buildStructureEdges(FILES)
  assert.equal(JSON.stringify(first), JSON.stringify(second))
})

test('A30-1 结构边：重复路径只算一次；空输入不产生边', () => {
  const duplicated = buildStructureEdges([
    fileNode('docs/a.md', { ops: 9 }),
    fileNode('DOCS/A.md', { ops: 9 }),
    fileNode('docs/b.md', { ops: 2 }),
  ])
  assert.equal(duplicated.length, 1, '大小写重复路径不应产生第二条边')

  assert.deepEqual(buildStructureEdges([]), [])
})

test('A30-1 结构边：锚点按 ops 选，平手按路径升序（可复现）', () => {
  const edges = buildStructureEdges([
    fileNode('docs/z.md', { ops: 1 }),
    fileNode('docs/a.md', { ops: 1 }),
    fileNode('docs/m.md', { ops: 1 }),
  ])
  assert.equal(edges.length, 2)
  for (const edge of edges) assert.equal(edge.to, 'docs/a.md')
})

test('A30-1 结构边经过 finalizeGraph 后仍然唯一（去重键 type|from|to）', () => {
  const graph = finalizeGraph(buildStructureEdges(FILES))
  assert.equal(graph.truncation.truncated, false)
  assert.equal(graph.counts.structure, 5)
  assert.equal(graph.edges.length, 5)
})
