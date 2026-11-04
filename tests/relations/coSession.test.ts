/**
 * A30-2（会话共现）：只在聚焦时生成、无焦点返回空、弱关系证据固定文案。
 * 输入是 `events.FileNode`（`sessionIds` 来自 04 §4.2 正式字段）。
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildCoSessionEdges } from '../../src/shared/relations/index.ts'
import { fileNode } from './fixtures.ts'

const FILES = [
  fileNode('docs/a.md', { sessionIds: ['s1', 's2'] }),
  fileNode('docs/b.md', { sessionIds: ['s2'] }),
  fileNode('src/x.ts', { sessionIds: ['s3'] }),
]

test('A30-2 会话共现：没有焦点时不生成任何边', () => {
  const result = buildCoSessionEdges(FILES)
  assert.deepEqual(result.edges, [])
  assert.equal(result.focused, false)
})

test('A30-2 会话共现：焦点文件不存在时不生成假关系', () => {
  const result = buildCoSessionEdges(FILES, 'not/there.md')
  assert.deepEqual(result.edges, [])
  assert.equal(result.focused, false)
})

test('A30-2 会话共现：只生成与焦点文件相关的边，权重 = 共同会话数', () => {
  const result = buildCoSessionEdges(FILES, 'docs/a.md')
  assert.equal(result.focused, true)
  assert.equal(result.edges.length, 1, '只连与焦点共享会话的文件')
  const edge = result.edges[0]
  assert.equal(edge.type, 'coSession')
  assert.equal(edge.from, 'docs/a.md')
  assert.equal(edge.to, 'docs/b.md')
  assert.equal(edge.weight, 1)
  assert.equal(edge.directed, false)
  assert.equal(edge.evidence.kind, 'coSession')
  if (edge.evidence.kind !== 'coSession') throw new Error('unreachable')
  assert.deepEqual(edge.evidence.sessionIds, ['s2'])
  assert.equal(edge.evidence.text, '同一会话中一起出现')
})

test('A30-2 会话共现：焦点文件没有任何会话记录时返回空', () => {
  const result = buildCoSessionEdges([fileNode('a.md'), fileNode('b.md')], 'a.md')
  assert.deepEqual(result.edges, [])
  assert.equal(result.focused, false)
})
