/**
 * A20-1 · 工作区范围（06 §6 / N-17 / N-18）
 *
 * 夹具：当前 workspace + 其它 workspace + 子智能体（cwd 不同）+ 归档；
 * 判据：只取当前 workspace、含子智能体与归档、不混其它 workspace、排序正确。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildWorkspaceScope,
  isScannableScope,
  prioritySessionIds,
  refocusScope,
  toScanSessions,
  withoutArchived,
} from '../../src/client/data/scope.ts'
import type { SessionsSnapshot, WorkspacesSnapshot } from '../../src/client/data/scope.ts'
import { DAY, NOW, OTHER_CWD, scopeFixture, sessionRow } from './fixtures.ts'

function build(now = NOW) {
  const fixture = scopeFixture({ now })
  const scope = buildWorkspaceScope({
    workspaces: fixture.workspaces,
    sessions: fixture.sessions,
    sessionId: fixture.currentId,
    now,
  })
  return { fixture, scope }
}

test('A20-1 只取当前 workspace，不混其它 workspace', () => {
  const { scope } = build()
  const ids = scope.order
  assert.deepEqual(
    [...ids].sort(),
    ['s-archived', 's-child', 's-current', 's-grandchild', 's-history', 's-recent', 's-sibling'].sort(),
  )
  assert.equal(ids.includes('s-other-root'), false)
  assert.equal(ids.includes('s-other-child'), false)
  assert.equal(scope.workspaceId, 'ws-main')
  assert.equal(scope.cwd, 'E:/DSH/workspaces/demo')
  assert.equal(scope.degraded, false)
})

test('A20-1 子智能体（cwd 不同也算）全部纳入', () => {
  const { scope } = build()
  const child = scope.sessions.find((session) => session.id === 's-child')
  const grandchild = scope.sessions.find((session) => session.id === 's-grandchild')
  assert.ok(child)
  assert.ok(grandchild)
  assert.equal(child.parentId, 's-current')
  assert.equal(grandchild.parentId, 's-child')
  // 子会话 cwd 与工作区不同，仍然纳入
  assert.equal(child.cwd, OTHER_CWD)
  assert.equal(child.depth, 1)
  assert.equal(grandchild.depth, 2)
  assert.equal(child.rootId, 's-current')
})

test('A20-1 归档会话默认纳入并打标（N-17）', () => {
  const { scope } = build()
  const archived = scope.sessions.find((session) => session.id === 's-archived')
  assert.ok(archived)
  assert.equal(archived.archived, true)
  assert.equal(archived.bucket, 'archived')
  assert.equal(scope.counts.archivedTotal, 1)
  assert.equal(scope.counts.archived, 1)
})

test('A20-1 排序：当前 → 子智能体 → 最近 7 天 → 历史 → 归档', () => {
  const { scope } = build()
  assert.deepEqual(scope.order, [
    's-current',
    's-child',
    's-grandchild',
    's-recent',
    's-sibling',
    's-history',
    's-archived',
  ])
  assert.deepEqual(
    scope.sessions.map((session) => session.bucket),
    ['current', 'subagent', 'subagent', 'recent', 'recent', 'history', 'archived'],
  )
  assert.equal(scope.currentSessionId, 's-current')
  assert.deepEqual(prioritySessionIds(scope), ['s-current', 's-child', 's-grandchild'])
})

test('A20-1 toScanSessions 只含当前 workspace，且行形状满足 04 §2.4', () => {
  const { scope } = build()
  const sessions = toScanSessions(scope)
  assert.equal(sessions.length, 7)
  const ids = sessions.map((session) => session.id)
  assert.equal(ids.includes('s-other-root'), false)
  assert.equal(ids.includes('s-other-child'), false)
  for (const session of sessions) {
    assert.equal(typeof session.id, 'string')
    assert.equal(Number.isFinite(session.updatedAt) && session.updatedAt >= 0, true)
    assert.equal(typeof session.running, 'boolean')
  }
  const child = sessions.find((session) => session.id === 's-child')
  assert.ok(child)
  assert.equal(child.parentId, 's-current')
  const archived = sessions.find((session) => session.id === 's-archived')
  assert.ok(archived)
  assert.equal(archived.archived, true)
  assert.equal(isScannableScope(scope), true)
})

test('A20-1 识别降级：找不到 workspace 时按 cwd 兜底并标 degraded', () => {
  const sessions: SessionsSnapshot = {
    byId: {
      's-current': sessionRow('s-current', { cwd: 'E:/w/demo' }),
      's-same-cwd': sessionRow('s-same-cwd', { cwd: 'E:/w/demo' }),
      's-other': sessionRow('s-other', { cwd: 'E:/w/other' }),
    },
  }
  const workspaces: WorkspacesSnapshot = { items: [{ id: 'ws-else', sessionIds: ['s-other'] }] }
  const scope = buildWorkspaceScope({ workspaces, sessions, sessionId: 's-current', now: NOW })
  assert.equal(scope.degraded, true)
  assert.equal(scope.degradedReason, 'workspace-not-found')
  assert.equal(scope.cwd, 'E:/w/demo')
  assert.deepEqual([...scope.order].sort(), ['s-current', 's-same-cwd'])
  assert.equal(scope.order[0], 's-current')
})

test('A20-1 当前会话行缺失也不崩，标 rowMissing', () => {
  const scope = buildWorkspaceScope({
    workspaces: { items: [{ id: 'ws', sessionIds: ['s-a', 's-b'] }] },
    sessions: { ids: ['s-a', 's-b'] },
    sessionId: 's-a',
    now: NOW,
  })
  assert.equal(scope.sessions.length, 2)
  const current = scope.sessions.find((session) => session.id === 's-a')
  assert.ok(current)
  assert.equal(current.rowMissing, true)
  assert.equal(current.updatedAt, 0)
  // 无法识别 cwd：不可发起扫描（调用方据此显示未知，而不是假图）
  assert.equal(scope.cwd, '')
  assert.equal(isScannableScope(scope), false)
})

test('A20-1 聚焦同工作区另一会话：不重扫，只改排序（03 §2.4）', () => {
  const { scope } = build()
  const focused = refocusScope(scope, 's-child')
  assert.equal(focused.workspaceId, scope.workspaceId)
  assert.equal(focused.cwd, scope.cwd)
  assert.deepEqual([...focused.order].sort(), [...scope.order].sort())
  assert.equal(focused.order[0], 's-child')
  assert.equal(focused.counts.current, 1)
  // s-current 变成“最近/历史”段，不再是 current
  assert.equal(focused.sessions.find((session) => session.id === 's-current')?.bucket !== 'current', true)
})

test('A20-1 归档可筛（N-17）：withoutArchived 只去掉归档段', () => {
  const { scope } = build()
  const visible = withoutArchived(scope)
  assert.equal(visible.order.includes('s-archived'), false)
  assert.equal(visible.counts.archivedTotal, 0)
  assert.equal(visible.order.length, scope.order.length - 1)
  assert.equal(visible.currentSessionId, 's-current')
})

test('A20-1 工作区条目只有 archivedSessionIds 命中当前会话也能识别', () => {
  const now = NOW
  const sessions: SessionsSnapshot = {
    byId: {
      's-old': sessionRow('s-old', { archived: true, updatedAt: now - 90 * DAY }),
      's-new': sessionRow('s-new', { updatedAt: now - 1000 }),
    },
  }
  const scope = buildWorkspaceScope({
    workspaces: { items: [{ id: 'ws', sessionIds: ['s-new'], archivedSessionIds: ['s-old'] }] },
    sessions,
    sessionId: 's-old',
    now,
  })
  assert.equal(scope.workspaceId, 'ws')
  assert.deepEqual(scope.order, ['s-old', 's-new'])
  assert.equal(scope.sessions[0].archived, true)
  assert.equal(scope.counts.archivedTotal, 1)
})
