/**
 * A30-5（top-k / 全局上限 / 已收拢）+ 去重合并规则（04 §6.2）。
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  coSessionEvidence,
  coTurnEvidence,
  compareEdges,
  createEdge,
  DEFAULT_GRAPH_LIMITS,
  edgeId,
  finalizeGraph,
  mergeEdges,
  referenceEvidence,
  sequenceEvidence,
  structureEvidence,
} from '../../src/shared/relations/index.ts'
import { degreeMap } from './fixtures.ts'

test('A30-5 默认上限：单节点 12、全局 4000', () => {
  assert.deepEqual(DEFAULT_GRAPH_LIMITS, { perNode: 12, global: 4000 })
})

test('A30-5 单节点 top-k：超过 12 条按权重收拢，并给“已收拢”计数', () => {
  const edges = Array.from({ length: 20 }, (_, index) =>
    createEdge({
      type: 'coTurn',
      from: 'hub.md',
      to: `leaf-${String(index + 1).padStart(2, '0')}.md`,
      weight: index + 1,
      evidence: coTurnEvidence({ samples: [{ sessionId: 's1', turn: index + 1 }], count: index + 1 }),
    }),
  )
  const graph = finalizeGraph(edges)
  assert.equal(graph.edges.length, 12)
  assert.equal(graph.truncation.droppedByNode, 8)
  assert.equal(graph.truncation.dropped, 8)
  assert.equal(graph.truncation.truncated, true)
  assert.equal(graph.truncation.text, '已收拢 8 条')
  for (const degree of degreeMap(graph.edges).values()) {
    assert.ok(degree <= DEFAULT_GRAPH_LIMITS.perNode, `节点度数超过 12：${degree}`)
  }
  const weights = graph.edges.map((edge) => edge.weight).sort((left, right) => left - right)
  assert.deepEqual(weights, [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], '保留权重最高的 12 条')
})

test('A30-5 全局上限：超过 4000 条按权重收拢', () => {
  const nodes = 5001
  const edges = Array.from({ length: nodes - 1 }, (_, index) =>
    createEdge({
      type: 'sequence',
      from: `n${String(index).padStart(4, '0')}.md`,
      to: `n${String(index + 1).padStart(4, '0')}.md`,
      evidence: sequenceEvidence({
        sessionId: 's1',
        turn: 1,
        order: index + 1,
        from: `n${String(index).padStart(4, '0')}.md`,
        to: `n${String(index + 1).padStart(4, '0')}.md`,
      }),
    }),
  )
  const graph = finalizeGraph(edges)
  assert.equal(graph.truncation.total, 5000)
  assert.equal(graph.truncation.kept, 4000)
  assert.equal(graph.truncation.droppedByGlobal, 1000)
  assert.equal(graph.truncation.droppedByNode, 0, '链式图每个节点度数 2，不应触发单节点上限')
  assert.equal(graph.truncation.text, '已收拢 1000 条')
})

test('A30-5 未超过上限时 truncation 为 false、文案为 0 条', () => {
  const edge = createEdge({
    type: 'structure',
    from: 'a.md',
    to: 'b.md',
    evidence: structureEvidence({ dir: '', from: 'a.md', to: 'b.md' }),
  })
  const graph = finalizeGraph([edge])
  assert.equal(graph.truncation.truncated, false)
  assert.equal(graph.truncation.dropped, 0)
  assert.equal(graph.truncation.text, '已收拢 0 条')
})

test('A30-5 去重键 type|from|to：无向边与有向边都不重复', () => {
  assert.equal(edgeId('structure', 'b.md', 'a.md'), edgeId('structure', 'a.md', 'b.md'))
  assert.notEqual(edgeId('reference', 'b.md', 'a.md'), edgeId('reference', 'a.md', 'b.md'))
  assert.equal(edgeId('coTurn', 'A.md', 'b.md'), edgeId('coTurn', 'a.md', 'B.md'), '身份键大小写归一')
  assert.equal(edgeId('structure', 'a.md', 'b.md'), 'structure|a.md|b.md')
})

test('A30-5 合并：同轮共现权重累加、样本合并且保留最近 3 个、文案重算', () => {
  const first = createEdge({
    type: 'coTurn',
    from: 'a.md',
    to: 'b.md',
    weight: 1,
    evidence: coTurnEvidence({ samples: [{ sessionId: 's1', turn: 1 }], count: 1 }),
  })
  const second = createEdge({
    type: 'coTurn',
    from: 'b.md',
    to: 'a.md',
    weight: 1,
    evidence: coTurnEvidence({ samples: [{ sessionId: 's1', turn: 2 }], count: 1 }),
  })
  const merged = mergeEdges([first, second])
  assert.equal(merged.length, 1)
  assert.equal(merged[0].weight, 2)
  if (merged[0].evidence.kind !== 'coTurn') throw new Error('unreachable')
  assert.deepEqual(merged[0].evidence.samples, [
    { sessionId: 's1', turn: 1 },
    { sessionId: 's1', turn: 2 },
  ])
  assert.equal(merged[0].evidence.text, '在 s1 的 T2 中同时出现 2 次')
})

test('A30-5 合并：引用保留最小行号、权重累加；同会话共现取并集', () => {
  const first = createEdge({
    type: 'reference',
    from: 'README.md',
    to: 'docs/a.md',
    evidence: referenceEvidence({ line: 9, raw: './a.md', target: 'docs/a.md', from: 'README.md', to: 'docs/a.md' }),
  })
  const second = createEdge({
    type: 'reference',
    from: 'README.md',
    to: 'docs/a.md',
    evidence: referenceEvidence({ line: 3, raw: './docs/a.md', target: 'docs/a.md', from: 'README.md', to: 'docs/a.md' }),
  })
  const merged = mergeEdges([first, second])[0]
  assert.equal(merged.weight, 2)
  if (merged.evidence.kind !== 'reference') throw new Error('unreachable')
  assert.equal(merged.evidence.line, 3, '保留第一条（行号最小）')
  assert.equal(merged.evidence.raw, './docs/a.md')
  assert.equal(merged.evidence.text, 'README.md 第 3 行引用 docs/a.md')

  const sessionA = createEdge({
    type: 'coSession',
    from: 'a.md',
    to: 'b.md',
    weight: 1,
    evidence: coSessionEvidence(['s1']),
  })
  const sessionB = createEdge({
    type: 'coSession',
    from: 'a.md',
    to: 'b.md',
    weight: 1,
    evidence: coSessionEvidence(['s2']),
  })
  const sessions = mergeEdges([sessionA, sessionB])[0]
  if (sessions.evidence.kind !== 'coSession') throw new Error('unreachable')
  assert.deepEqual(sessions.evidence.sessionIds, ['s1', 's2'])
  assert.equal(sessions.weight, 2)
})

test('A30-5 排序确定性：权重降序 → id 升序', () => {
  const low = createEdge({
    type: 'coTurn',
    from: 'a.md',
    to: 'b.md',
    weight: 1,
    evidence: coTurnEvidence({ samples: [{ sessionId: 's', turn: 1 }], count: 1 }),
  })
  const high = createEdge({
    type: 'coTurn',
    from: 'c.md',
    to: 'd.md',
    weight: 5,
    evidence: coTurnEvidence({ samples: [{ sessionId: 's', turn: 1 }], count: 5 }),
  })
  assert.ok(compareEdges(high, low) < 0)
  assert.deepEqual(finalizeGraph([low, high]).edges.map((edge) => edge.from), ['c.md', 'a.md'])
})
