/**
 * A20-4 · 降级不伪造（06 §6 / N-03）
 *
 * mock hostUnavailable / capability-missing / partial / failed → 显式状态与文案 key，
 * 且 `renderZeroForbidden === true`（UI 必须显示未知/错误，不能显示 0 图）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  canRetry,
  degradeEmptyWorkspace,
  degradeForCoverage,
  degradeForError,
  degradeHostUnavailable,
  degradeNone,
  isZeroForbidden,
  mergeDegrade,
} from '../../src/client/data/degrade.ts'
import type { Coverage } from '../../src/client/data/merge.ts'

function coverage(overrides: Partial<Coverage> = {}): Coverage {
  return {
    total: 10,
    scanned: 0,
    failed: 0,
    cached: 0,
    loadedFiles: 0,
    loadedEdges: 0,
    loadedSessions: 0,
    phase: 'scanning',
    known: true,
    truncated: false,
    complete: false,
    ...overrides,
  }
}

test('A20-4 hostUnavailable：文案 key 是 state.hostUnavailable，禁止渲染 0 图', () => {
  const state = degradeHostUnavailable()
  assert.equal(state.kind, 'hostUnavailable')
  assert.equal(state.messageKey, 'state.hostUnavailable')
  assert.equal(state.renderZeroForbidden, true)
  assert.equal(state.severity, 'error')
  assert.equal(state.retryable, true)
  assert.equal(state.retryKey, 'coverage.retry')
  assert.equal(canRetry(state), true)
  assert.equal(isZeroForbidden(state), true)
})

test('A20-4 capability-missing：按 04 §2.7 映射到 state.hostUnavailable', () => {
  const state = degradeForError('threadline/capability-missing')
  assert.equal(state.kind, 'capability-missing')
  assert.equal(state.code, 'threadline/capability-missing')
  assert.equal(state.messageKey, 'state.hostUnavailable')
  assert.equal(state.renderZeroForbidden, true)
  assert.equal(state.retryable, true)
})

test('A20-4 partial：文案 key 是 coverage.partial，带上真实计数', () => {
  const state = degradeForCoverage(coverage({ scanned: 3, loadedSessions: 2, phase: 'partial' }))
  assert.equal(state.kind, 'partial')
  assert.equal(state.messageKey, 'coverage.partial')
  assert.equal(state.renderZeroForbidden, true)
  assert.equal(state.failedSessions, 0)
  assert.equal(state.total, 10)
  assert.equal(state.loadedSessions, 2)
  assert.equal(state.retryable, false)
})

test('A20-4 failed：文案 key 是 state.unknown，可重试', () => {
  const state = degradeForCoverage(coverage({ phase: 'failed' }))
  assert.equal(state.kind, 'failed')
  assert.equal(state.messageKey, 'state.unknown')
  assert.equal(state.renderZeroForbidden, true)
  assert.equal(state.retryable, true)
  assert.equal(state.retryKey, 'coverage.retry')
})

test('A20-4 完成但存在失败会话：用 coverage.failed 列出，失败数不是 0', () => {
  const state = degradeForCoverage(
    coverage({ phase: 'complete', complete: true, scanned: 10, failed: 3, loadedSessions: 7 }),
  )
  assert.equal(state.kind, 'partial')
  assert.equal(state.messageKey, 'coverage.failed')
  assert.equal(state.failedSessions, 3)
  assert.equal(state.loadedSessions, 7)
  // 已有其它会话数据：不强制禁止 0（失败列表单独显示）
  assert.equal(state.renderZeroForbidden, false)
})

test('A20-4 全部会话失败（完成但 0 加载）：禁止显示 0', () => {
  const state = degradeForCoverage(
    coverage({ phase: 'complete', complete: true, scanned: 10, failed: 10, loadedSessions: 0 }),
  )
  assert.equal(state.kind, 'partial')
  assert.equal(state.renderZeroForbidden, true)
})

test('A20-4 scan-not-found / bad-request / limit-exceeded 的显式状态', () => {
  const notFound = degradeForError('threadline/scan-not-found')
  assert.equal(notFound.kind, 'failed')
  assert.equal(notFound.retryable, true)
  assert.equal(notFound.renderZeroForbidden, true)

  const bad = degradeForError('threadline/bad-request')
  assert.equal(bad.kind, 'failed')
  assert.equal(bad.retryable, false)
  assert.equal(bad.retryKey, null)

  const limited = degradeForError('threadline/limit-exceeded')
  assert.equal(limited.kind, 'partial')
  assert.equal(limited.messageKey, 'coverage.partial')
  assert.equal(limited.renderZeroForbidden, true)

  const unreadable = degradeForError('threadline/session-unreadable')
  assert.equal(unreadable.kind, 'partial')
  assert.equal(unreadable.messageKey, 'coverage.failed')
})

test('A20-4 健康/空工作区：允许 0（真实空态），不冒充错误', () => {
  const healthy = degradeNone()
  assert.equal(healthy.kind, 'none')
  assert.equal(healthy.messageKey, null)
  assert.equal(healthy.renderZeroForbidden, false)

  const empty = degradeEmptyWorkspace()
  assert.equal(empty.messageKey, 'state.emptyWorkspace')
  assert.equal(empty.renderZeroForbidden, false)
  assert.equal(canRetry(empty), false)

  // 扫描刚起步、还没数据：仍是 loading 而不是降级
  const starting = degradeForCoverage(coverage({ phase: 'starting', scanned: 0, loadedSessions: 0 }))
  assert.equal(starting.kind, 'none')
})

test('A20-4 mergeDegrade：错误态优先于进度态', () => {
  const host = degradeHostUnavailable()
  const partial = degradeForCoverage(coverage({ phase: 'partial', loadedSessions: 1 }))
  assert.equal(mergeDegrade(host, partial).kind, 'hostUnavailable')
  assert.equal(mergeDegrade(partial, host).kind, 'partial')
  assert.equal(mergeDegrade(degradeNone(), partial).kind, 'partial')
})

test('A20-4 所有降级态都给出非 null 文案 key（不发明 key）', () => {
  const states = [
    degradeHostUnavailable(),
    degradeForError('threadline/capability-missing'),
    degradeForError('threadline/scan-not-found'),
    degradeForError('threadline/bad-request'),
    degradeForError('threadline/internal'),
    degradeForError('threadline/limit-exceeded'),
    degradeForError('threadline/session-unreadable'),
    degradeForError('threadline/format-unsupported'),
    degradeForCoverage(coverage({ phase: 'partial', loadedSessions: 1 })),
    degradeForCoverage(coverage({ phase: 'failed' })),
  ]
  for (const state of states) {
    assert.equal(state.kind !== 'none', true)
    assert.equal(typeof state.messageKey, 'string')
    assert.equal(state.renderZeroForbidden, true)
  }
})
