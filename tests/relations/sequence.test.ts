/**
 * A30-2（时序）：有向、带 1-based 轮内序号、只在选中轮次时生成。
 * 轮内先后以 `events.TurnDetail.files` 的**数组顺序**为准（T03 已按事件顺序产出，无 order 字段）。
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildSequenceEdges } from '../../src/shared/relations/index.ts'
import { turn, turnFile } from './fixtures.ts'

const TURN = turn('sess-0001', 3, [
  turnFile('docs/a.md'),
  turnFile('src/x.ts'),
  turnFile('docs/b.md'),
])

test('A30-2 时序：没有选中轮次时不生成边', () => {
  assert.deepEqual(buildSequenceEdges(undefined), { edges: [], files: 0, deduped: 0 })
})

test('A30-2 时序：有向且带 1-based 序号，只连相邻项', () => {
  const result = buildSequenceEdges(TURN)
  assert.equal(result.edges.length, 2)
  assert.equal(result.files, 3)

  const [first, second] = result.edges
  assert.equal(first.directed, true)
  assert.equal(first.from, 'docs/a.md')
  assert.equal(first.to, 'src/x.ts')
  if (first.evidence.kind !== 'sequence') throw new Error('unreachable')
  assert.equal(first.evidence.order, 1)
  assert.equal(first.evidence.turn, 3)
  assert.equal(first.evidence.sessionId, 'sess-0001')
  assert.equal(first.evidence.text, '同一轮内：docs/a.md 先于 src/x.ts')

  assert.equal(second.from, 'src/x.ts')
  assert.equal(second.to, 'docs/b.md')
  if (second.evidence.kind !== 'sequence') throw new Error('unreachable')
  assert.equal(second.evidence.order, 2)

  // 有向：反方向不是同一条边
  assert.notEqual(first.id, `${second.type}|${second.to}|${second.from}`)
})

test('A30-2 时序：重复文件去重，顺序仍按数组顺序', () => {
  const result = buildSequenceEdges(turn('s', 1, [turnFile('a.md'), turnFile('a.md'), turnFile('b.md')]))
  assert.equal(result.files, 2)
  assert.equal(result.deduped, 1)
  assert.equal(result.edges.length, 1)
  assert.equal(result.edges[0].to, 'b.md')
})

test('A30-2 时序：单文件轮次没有边（不伪造先后）', () => {
  const result = buildSequenceEdges(turn('s', 1, [turnFile('a.md')]))
  assert.equal(result.edges.length, 0)
  assert.equal(result.files, 1)
})
