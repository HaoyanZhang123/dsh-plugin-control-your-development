/**
 * A20-3 · 合并/去重/删除（06 §6 / N-02 / N-10）
 *
 * 判据：按 id/path 覆盖、removedFiles/removedEdges 生效、无重复、
 * 失败列表保留且不影响其它会话、覆盖率 `loaded` 不等于“全部”。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  applySnapshot,
  coverageOfGraph,
  createEmptyGraph,
  derivePhase,
  edgeKeyOf,
  failedSessions,
  graphStats,
  mergeErrors,
  removedEdgeKey,
} from '../../src/client/data/merge.ts'
import { edge, fileNode, progress, scanError, summary } from './fixtures.ts'

test('A20-3 重复 session/file/edge 按 id/path 覆盖，不产生重复', () => {
  let graph = createEmptyGraph()
  graph = applySnapshot(graph, {
    scanId: 'scan-1',
    rev: 1,
    reset: true,
    progress: progress({ total: 3, scanned: 1, phase: 'scanning' }),
    changedSessions: [summary('s-1', { turns: 1 }), summary('s-1', { turns: 5 })],
    changedFiles: [
      fileNode('src/a.ts', { ops: 1 }),
      fileNode('src/a.ts', { ops: 9 }),
      fileNode('SRC/A.TS', { ops: 10 }),
    ],
    changedEdges: [edge('src/a.ts', 'src/b.ts', 1), edge('src/a.ts', 'src/b.ts', 3)],
  }).graph

  assert.equal(graph.sessions.size, 1)
  assert.equal(graph.sessions.get('s-1')?.turns, 5)
  // 大小写不敏感身份键：三份同路径只留一个
  assert.equal(graph.files.size, 1)
  assert.equal(graph.files.get('src/a.ts')?.ops, 10)
  assert.equal(graph.edges.size, 1)
  assert.equal(graph.edges.get(edgeKeyOf('src/a.ts', 'src/b.ts'))?.weight, 3)
  assert.equal(graphStats(graph).files, 1)
})

test('A20-3 边顺序无关去重（from/to 反序也合并）', () => {
  let graph = createEmptyGraph()
  graph = applySnapshot(graph, {
    rev: 1,
    reset: true,
    changedEdges: [edge('a.ts', 'b.ts', 1), edge('b.ts', 'a.ts', 4)],
  }).graph
  assert.equal(graph.edges.size, 1)
  assert.equal([...graph.edges.values()][0].weight, 4)
})

test('A20-3 removedFiles / removedEdges 生效', () => {
  let graph = applySnapshot(createEmptyGraph(), {
    rev: 1,
    reset: true,
    changedFiles: [fileNode('src/a.ts'), fileNode('src/b.ts')],
    changedEdges: [edge('src/a.ts', 'src/b.ts', 2)],
  }).graph
  assert.equal(graph.files.size, 2)
  assert.equal(graph.edges.size, 1)

  const applied = applySnapshot(graph, {
    rev: 2,
    reset: false,
    removedFiles: ['src/a.ts', 'SRC/B.TS'],
    removedEdges: ['src/a.ts\u0000src/b.ts'],
  })
  graph = applied.graph
  assert.equal(applied.applied.filesRemoved, 2)
  assert.equal(applied.applied.edgesRemoved, 1)
  assert.equal(graph.files.size, 0)
  assert.equal(graph.edges.size, 0)
  // 删除不存在的路径是 no-op，不抛
  const noop = applySnapshot(graph, { rev: 3, removedFiles: ['nope.ts'], removedEdges: ['x\u0000y'] })
  assert.equal(noop.applied.filesRemoved, 0)
  assert.equal(noop.applied.edgesRemoved, 0)
})

test('A20-3 removedEdgeKey 解码 host 编码（from\\0to）', () => {
  assert.equal(removedEdgeKey('A.ts\u0000B.ts'), edgeKeyOf('a.ts', 'b.ts'))
  assert.equal(removedEdgeKey('b.ts\u0000a.ts'), edgeKeyOf('a.ts', 'b.ts'))
  assert.equal(removedEdgeKey('plain.ts'), 'plain.ts')
})

test('A20-3 reset: true 清空旧图再应用（04 §2.5）', () => {
  let graph = applySnapshot(createEmptyGraph(), {
    rev: 5,
    reset: true,
    changedSessions: [summary('s-old')],
    changedFiles: [fileNode('old.ts')],
  }).graph
  assert.equal(graph.files.size, 1)

  graph = applySnapshot(graph, {
    rev: 6,
    reset: true,
    changedSessions: [summary('s-new')],
    changedFiles: [fileNode('new.ts')],
  }).graph
  assert.equal(graph.sessions.size, 1)
  assert.equal(graph.sessions.has('s-new'), true)
  assert.equal(graph.sessions.has('s-old'), false)
  assert.equal(graph.files.size, 1)
  assert.equal(graph.files.has('new.ts'), true)
  assert.equal(graph.resets, 2)
})

test('A20-3 失败列表保留且不影响其它会话；按 sessionId+code 去重', () => {
  let graph = applySnapshot(createEmptyGraph(), {
    rev: 1,
    reset: true,
    progress: progress({ total: 3, scanned: 1, failed: 1, phase: 'scanning' }),
    changedSessions: [summary('s-ok')],
    changedFiles: [fileNode('ok.ts')],
    errors: [scanError('s-bad', 'threadline/session-unreadable', 'cannot read')],
  }).graph

  assert.equal(failedSessions(graph).count, 1)
  assert.equal(failedSessions(graph).sessions[0].sessionId, 's-bad')
  assert.equal(failedSessions(graph).sessions[0].code, 'threadline/session-unreadable')

  graph = applySnapshot(graph, {
    rev: 2,
    changedSessions: [summary('s-ok-2')],
    changedFiles: [fileNode('ok2.ts')],
    errors: [scanError('s-bad', 'threadline/session-unreadable', 'still cannot read')],
  }).graph
  // 同一会话同一码去重，保留最新 message
  assert.equal(graph.errors.length, 1)
  assert.equal(graph.errors[0].message, 'still cannot read')
  // 其它会话数据继续累积
  assert.equal(graph.sessions.size, 2)
  assert.equal(graph.files.size, 2)

  const merged = mergeErrors(
    [scanError('a', 'threadline/format-unsupported'), scanError('b', 'threadline/internal')],
    [scanError('a', 'threadline/session-unreadable', 'second')],
    false,
  )
  assert.equal(merged.length, 3)
})

test('A20-3 覆盖率：loaded 不等于“全部”，partial 真实（A20-2 依赖）', () => {
  let graph = applySnapshot(createEmptyGraph(), {
    rev: 1,
    reset: true,
    progress: progress({ total: 10, scanned: 3, failed: 1, cached: 1, phase: 'scanning' }),
    changedSessions: [summary('s-1'), summary('s-2')],
    changedFiles: [fileNode('a.ts')],
    changedEdges: [edge('a.ts', 'b.ts', 1)],
  }).graph

  let coverage = coverageOfGraph(graph)
  assert.equal(coverage.total, 10)
  assert.equal(coverage.scanned, 3)
  assert.equal(coverage.failed, 1)
  assert.equal(coverage.cached, 1)
  assert.equal(coverage.loadedSessions, 2)
  assert.equal(coverage.loadedFiles, 1)
  assert.equal(coverage.loadedEdges, 1)
  assert.equal(coverage.phase, 'partial')
  assert.equal(coverage.complete, false)
  // “已加载 2” ≠ “全部 10”
  assert.equal(coverage.loadedSessions < coverage.total, true)

  const remaining = Array.from({ length: 8 }, (_, index) => summary(`s-rest-${index}`))
  graph = applySnapshot(graph, {
    rev: 2,
    done: true,
    progress: progress({ total: 10, scanned: 10, cached: 2, phase: 'complete' }),
    changedSessions: remaining,
  }).graph
  coverage = coverageOfGraph(graph)
  assert.equal(coverage.phase, 'complete')
  assert.equal(coverage.complete, true)
  assert.equal(coverage.known, true)
  assert.equal(coverage.loadedSessions, coverage.total)
})

test('A20-3 truncated 保持可见（不静默丢）', () => {
  const applied = applySnapshot(createEmptyGraph(), {
    rev: 1,
    reset: true,
    progress: progress({ total: 2, scanned: 1, phase: 'scanning' }),
    changedFiles: [fileNode('a.ts')],
    truncated: true,
  })
  assert.equal(applied.applied.truncated, true)
  assert.equal(applied.graph.coverage.truncated, true)
  assert.equal(applied.graph.coverage.phase, 'partial')
})

test('A20-3 derivePhase 边界：starting → scanning → partial → complete / failed', () => {
  assert.equal(
    derivePhase({ progress: progress({ total: 2, phase: 'starting' }), done: false, truncated: false, loadedSessions: 0 }),
    'starting',
  )
  assert.equal(
    derivePhase({ progress: progress({ total: 2, phase: 'scanning' }), done: false, truncated: false, loadedSessions: 0 }),
    'scanning',
  )
  assert.equal(
    derivePhase({ progress: progress({ total: 2, phase: 'scanning' }), done: false, truncated: false, loadedSessions: 1 }),
    'partial',
  )
  assert.equal(
    derivePhase({ progress: progress({ total: 2, phase: 'complete' }), done: true, truncated: false, loadedSessions: 2 }),
    'complete',
  )
  assert.equal(
    derivePhase({ progress: progress({ total: 2, phase: 'failed' }), done: true, truncated: false, loadedSessions: 0 }),
    'failed',
  )
})
