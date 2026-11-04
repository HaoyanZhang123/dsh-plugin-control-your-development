/**
 * A30-1（共现部分）：同轮共现权重累加、`type|from|to` 去重、单轮 top 12、样本上限。
 * 输入是 `events.TurnDetail`（经 `turnFromDetail()` 适配）与其 `TurnFile` 正式类型。
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  buildCoTurnEdges,
  CO_TURN_SAMPLE_LIMIT,
  finalizeGraph,
  operationCount,
  turnFileActivity,
  turnFromDetail,
} from '../../src/shared/relations/index.ts'
import { turn, turnDetail, turnFile } from './fixtures.ts'

const SESSION = 'sess-0001'

test('A30-1 同轮共现：权重 = 一起出现的次数，同一对只出一条边', () => {
  const result = buildCoTurnEdges([
    turn(SESSION, 1, [
      turnFile('docs/a.md', ['read', 'write']),
      turnFile('docs/b.md', ['read']),
      turnFile('docs/c.md', ['search']),
    ]),
    turn(SESSION, 2, [
      turnFile('docs/a.md', ['read']),
      turnFile('docs/b.md', ['read', 'write', 'search'], { added: 4 }),
    ]),
  ])

  assert.equal(result.edges.length, 3)
  assert.equal(result.droppedFiles, 0)
  const ids = new Set(result.edges.map((edge) => edge.id))
  assert.equal(ids.size, 3)

  const ab = result.edges.find((edge) => edge.from === 'docs/a.md' && edge.to === 'docs/b.md')
  assert.ok(ab !== undefined)
  assert.equal(ab.weight, 2, 'T1 与 T2 各一次 → 权重 2')
  assert.equal(ab.directed, false)
  assert.equal(ab.confidence, 'confirmed')
  assert.equal(ab.evidence.kind, 'coTurn')
  if (ab.evidence.kind !== 'coTurn') throw new Error('unreachable')
  assert.equal(ab.evidence.count, 2)
  assert.deepEqual(ab.evidence.samples, [
    { sessionId: SESSION, turn: 1 },
    { sessionId: SESSION, turn: 2 },
  ])
  assert.equal(ab.evidence.text, '在 sess-000 的 T2 中同时出现 2 次')

  const ac = result.edges.find((edge) => edge.from === 'docs/a.md' && edge.to === 'docs/c.md')
  assert.ok(ac !== undefined)
  assert.equal(ac.weight, 1)
})

test('A30-1 同轮共现：每轮只取活动量 top 12 参与成边，超出显式计数', () => {
  // 活动量相同时按路径升序 → 选 f01..f12，丢 f13..f20
  const files = Array.from({ length: 20 }, (_, index) => turnFile(`f${String(index + 1).padStart(2, '0')}.md`))
  const result = buildCoTurnEdges([turn(SESSION, 1, files)])
  assert.equal(result.edges.length, (12 * 11) / 2)
  assert.equal(result.droppedFiles, 8)
  const nodes = new Set(result.edges.flatMap((edge) => [edge.from, edge.to]))
  assert.equal(nodes.size, 12)
  assert.ok(!nodes.has('f13.md'))
})

test('A30-1 同轮共现：证据样本最多保留最近 3 个', () => {
  const turns = [1, 2, 3, 4].map((n) => turn(SESSION, n, [turnFile('a.md'), turnFile('b.md')]))
  const result = buildCoTurnEdges(turns)
  assert.equal(result.edges.length, 1)
  const edge = result.edges[0]
  assert.equal(edge.weight, 4)
  if (edge.evidence.kind !== 'coTurn') throw new Error('unreachable')
  assert.equal(edge.evidence.samples.length, CO_TURN_SAMPLE_LIMIT)
  assert.deepEqual(edge.evidence.samples, [
    { sessionId: SESSION, turn: 2 },
    { sessionId: SESSION, turn: 3 },
    { sessionId: SESSION, turn: 4 },
  ])
  assert.equal(edge.evidence.text, '在 sess-000 的 T4 中同时出现 4 次')
})

test('A30-1 同轮共现：重复路径/空轮次不产生假边', () => {
  const result = buildCoTurnEdges([
    turn(SESSION, 1, []),
    turn(SESSION, 2, [turnFile('a.md'), turnFile('A.md'), turnFile('b.md')]),
  ])
  assert.equal(result.emptyTurns, 1)
  assert.equal(result.edges.length, 1)
  assert.equal(result.edges[0].weight, 1)
})

test('A30-1 与 T03 TurnDetail 对接：turnFromDetail 保留 n/files，ops 列表按条数换算', () => {
  const detail = turnDetail(7, [
    turnFile('docs/a.md', ['read', 'write'], { added: 2, removed: 1 }),
    turnFile('docs/b.md', ['read']),
  ])
  const adapted = turnFromDetail(detail, 'sess-0001')
  assert.equal(adapted.sessionId, 'sess-0001')
  assert.equal(adapted.turn, 7)
  assert.equal(adapted.files, detail.files, '不复制 files：数组顺序就是轮内先后')
  assert.equal(operationCount(adapted.files[0].ops), 2)
  assert.ok(turnFileActivity(adapted.files[0]) > turnFileActivity(adapted.files[1]))

  const result = buildCoTurnEdges([adapted])
  assert.equal(result.edges.length, 1)
  assert.equal(result.edges[0].weight, 1)
})

test('A30-1 同轮共现经 finalizeGraph 后权重保留、条数一致', () => {
  const result = buildCoTurnEdges([
    turn(SESSION, 1, [turnFile('a.md'), turnFile('b.md')]),
    turn(SESSION, 2, [turnFile('a.md'), turnFile('b.md')]),
  ])
  const graph = finalizeGraph(result.edges)
  assert.equal(graph.edges.length, 1)
  assert.equal(graph.edges[0].weight, 2)
  assert.equal(graph.counts.coTurn, 1)
})
