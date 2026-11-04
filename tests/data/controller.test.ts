/**
 * A20-2 / N-11 / N-18 · 扫描驱动（06 §6）
 *
 * 用假时钟 + 假 fetch 断言：渐进加载顺序、进度真实、partial/complete、
 * truncated 立即续拉、reset 清空、generation 丢弃迟到响应、隐藏降频、退避重试、
 * scan-not-found 自动重开一次、降级不伪造。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildScanRequest, createDataController } from '../../src/client/data/controller.ts'
import { buildWorkspaceScope } from '../../src/client/data/scope.ts'
import type { WorkspaceScope } from '../../src/client/data/scope.ts'
import {
  CWD,
  NOW,
  createFakeClock,
  createFakeFetch,
  createGate,
  edge,
  fileNode,
  progress,
  scanError,
  sessionRow,
  snapshotPayload,
  summary,
} from './fixtures.ts'

/* ------------------------------------------------------------------ *
 * helpers
 * ------------------------------------------------------------------ */

function makeScope(options: { workspaceId?: string; cwd?: string; ids?: string[]; currentId?: string } = {}): WorkspaceScope {
  const workspaceId = options.workspaceId ?? 'ws-main'
  const cwd = options.cwd ?? CWD
  const currentId = options.currentId ?? 's-current'
  const ids = options.ids ?? [currentId, 's-child', 's-recent', 's-history']
  const byId: Record<string, ReturnType<typeof sessionRow>> = {}
  for (const id of ids) {
    byId[id] = sessionRow(id, {
      cwd,
      updatedAt: NOW - ids.indexOf(id) * 1000,
      parentId: id === 's-child' ? currentId : undefined,
      archived: id === 's-archived',
    })
  }
  return buildWorkspaceScope({
    workspaces: {
      items: [
        {
          id: workspaceId,
          sessionIds: ids.filter((id) => id !== 's-archived'),
          archivedSessionIds: ids.includes('s-archived') ? ['s-archived'] : [],
        },
      ],
    },
    sessions: { byId },
    sessionId: currentId,
    now: NOW,
  })
}

function lastStatuses(statuses: string[], count: number): string[] {
  return statuses.slice(Math.max(0, statuses.length - count))
}

/* ------------------------------------------------------------------ *
 * A20-2 渐进加载
 * ------------------------------------------------------------------ */

test('A20-2 渐进加载：顺序、进度、partial、complete 都真实', async () => {
  const clock = createFakeClock(NOW)
  const fake = createFakeFetch()
  const scope = makeScope()
  const statuses: string[] = []
  const progressSnapshots: Array<{ scanned: number; total: number; phase: string; loadedSessions: number }> = []

  fake.on('scan', (body) => {
    const sessions = Array.isArray(body.sessions) ? (body.sessions as Array<{ id: string }>) : []
    return {
      ok: true,
      scanId: 'scan-1',
      rev: 0,
      total: sessions.length,
      order: sessions.map((session) => session.id),
    }
  })
  const chunks = [
    snapshotPayload({
      rev: 1,
      reset: true,
      progress: progress({ total: 4, scanned: 1, phase: 'scanning' }),
      changedSessions: [summary('s-current')],
      changedFiles: [fileNode('src/current.ts')],
    }),
    snapshotPayload({
      rev: 2,
      progress: progress({ total: 4, scanned: 3, phase: 'scanning' }),
      changedSessions: [summary('s-child'), summary('s-recent')],
      changedFiles: [fileNode('src/child.ts')],
    }),
    snapshotPayload({
      rev: 3,
      done: true,
      progress: progress({ total: 4, scanned: 4, phase: 'complete' }),
      changedSessions: [summary('s-history')],
      changedEdges: [edge('src/current.ts', 'src/child.ts', 2)],
    }),
  ]
  let index = 0
  fake.on('snapshot', () => {
    const payload = chunks[Math.min(index, chunks.length - 1)]
    index += 1
    return payload
  })

  const controller = createDataController({
    fetch: fake.fetch,
    timer: clock.timer,
    now: clock.now,
    onSnapshot: (snapshot) => {
      statuses.push(snapshot.status)
      progressSnapshots.push({
        scanned: snapshot.coverage.scanned,
        total: snapshot.coverage.total,
        phase: snapshot.coverage.phase,
        loadedSessions: snapshot.coverage.loadedSessions,
      })
    },
  })

  void controller.start(scope)
  await clock.flush()
  assert.deepEqual(lastStatuses(statuses, 1), ['scanning'])

  await clock.advance(0) // 首包
  assert.equal(controller.getState().status, 'partial')
  assert.equal(controller.getState().graph.coverage.loadedSessions, 1)

  await clock.advance(400)
  assert.equal(controller.getState().status, 'partial')
  // 第二个包把当前会话 → 子 → 最近的顺序带进来
  assert.deepEqual(
    [...controller.getState().graph.sessions.keys()],
    ['s-current', 's-child', 's-recent'],
  )

  await clock.advance(400)
  const final = controller.getState()
  assert.equal(final.status, 'complete')
  assert.equal(final.coverage.complete, true)
  assert.equal(final.coverage.total, 4)
  assert.equal(final.coverage.scanned, 4)
  assert.equal(final.coverage.loadedSessions, 4)
  assert.equal(final.graph.files.size, 2)
  assert.equal(final.graph.edges.size, 1)
  // done 后不再轮询
  assert.equal(clock.pending(), 0)

  // 进度是真实读数（不是提前完成）
  const partials = progressSnapshots.filter((entry) => entry.phase === 'partial')
  assert.equal(partials.length >= 1, true)
  assert.equal(
    progressSnapshots.some((entry) => entry.phase === 'complete' && entry.scanned === entry.total),
    true,
  )

  // sinceRev 递增：0 → 1 → 2
  const snapshotCalls = fake.callsOf('snapshot')
  assert.deepEqual(
    snapshotCalls.map((call) => call.body.sinceRev),
    [0, 1, 2],
  )
  // 只发同源相对路径
  for (const call of fake.calls) {
    assert.equal(call.path.startsWith('/api/dsh-threadline/'), true)
    assert.equal(call.path.includes('://'), false)
  }
  controller.dispose()
})

test('A20-2 scan 请求只含当前 workspace 的会话（A20-1 的请求侧证据）', () => {
  const scope = makeScope()
  const request = buildScanRequest(scope, 3)
  assert.equal(request.workspaceId, 'ws-main')
  assert.equal(request.cwd, CWD)
  assert.equal(request.generation, 3)
  assert.deepEqual(
    request.sessions.map((session) => session.id),
    ['s-current', 's-child', 's-recent', 's-history'],
  )
  assert.equal(request.sessions.some((session) => session.id.startsWith('s-other')), false)
  // refresh 只保留 scope 内的 id（host 会拒绝 scope 外的 id）
  const withRefresh = buildScanRequest(scope, 4, ['s-current', 's-other-root'])
  assert.deepEqual(withRefresh.refresh, ['s-current'])
})

test('A20-2 truncated 立即续拉（用最新 rev），不静默丢', async () => {
  const clock = createFakeClock(NOW)
  const fake = createFakeFetch()
  const scope = makeScope()
  fake.on('scan', () => ({ ok: true, scanId: 'scan-1', rev: 0, total: 4, order: [] }))
  const payloads = [
    snapshotPayload({
      rev: 2,
      reset: true,
      truncated: true,
      progress: progress({ total: 4, scanned: 2, phase: 'scanning' }),
      changedFiles: [fileNode('a.ts')],
    }),
    snapshotPayload({
      rev: 2,
      truncated: true,
      progress: progress({ total: 4, scanned: 2, phase: 'scanning' }),
      changedFiles: [fileNode('b.ts')],
    }),
    snapshotPayload({
      rev: 4,
      done: true,
      progress: progress({ total: 4, scanned: 4, phase: 'complete' }),
      changedFiles: [fileNode('c.ts')],
    }),
  ]
  let index = 0
  fake.on('snapshot', () => {
    const payload = payloads[Math.min(index, payloads.length - 1)]
    index += 1
    return payload
  })
  const controller = createDataController({ fetch: fake.fetch, timer: clock.timer, now: clock.now })
  void controller.start(scope)
  await clock.flush()
  const timeBefore = clock.now()

  // 一次 advance(0) 就应把“首包 + 未推进时间内的即时续页”全部跑完：
  // 说明续拉没有等 400ms，且每页用最新 rev（2 → 2 → 4）。
  await clock.advance(0)
  const calls = fake.callsOf('snapshot')
  assert.equal(calls.length, 3)
  assert.deepEqual(
    calls.map((call) => call.body.sinceRev),
    [0, 2, 2],
  )
  assert.equal(clock.now(), timeBefore)
  const state = controller.getState()
  assert.equal(state.status, 'complete')
  assert.equal(state.graph.files.size, 3)
  assert.equal(state.coverage.truncated, false)
  controller.dispose()
})

test('A20-2 reset 清空旧图；refresh 期间保留旧数据直到新数据到达（03 §11.4）', async () => {
  const clock = createFakeClock(NOW)
  const fake = createFakeFetch()
  const scope = makeScope()
  let scanCount = 0
  fake.on('scan', () => {
    scanCount += 1
    return { ok: true, scanId: `scan-${scanCount}`, rev: 0, total: 4, order: [] }
  })
  let phase = 0
  fake.on('snapshot', () => {
    if (phase === 0) {
      return snapshotPayload({
        rev: 1,
        reset: true,
        done: true,
        progress: progress({ total: 4, scanned: 4, phase: 'complete' }),
        changedFiles: [fileNode('old.ts')],
      })
    }
    return snapshotPayload({
      rev: 1,
      reset: true,
      done: true,
      progress: progress({ total: 4, scanned: 4, phase: 'complete' }),
      changedFiles: [fileNode('new.ts')],
    })
  })
  const controller = createDataController({ fetch: fake.fetch, timer: clock.timer, now: clock.now })
  void controller.start(scope)
  await clock.flush()
  await clock.advance(0)
  assert.deepEqual([...controller.getState().graph.files.keys()], ['old.ts'])

  phase = 1
  void controller.refresh()
  await clock.flush()
  // 新数据到达之前旧图仍在
  assert.deepEqual([...controller.getState().graph.files.keys()], ['old.ts'])
  assert.equal(controller.getState().retained, true)
  await clock.advance(0)
  assert.deepEqual([...controller.getState().graph.files.keys()], ['new.ts'])
  controller.dispose()
})

test('A20-2 失败会话保留在列表，其它会话继续（N-02）', async () => {
  const clock = createFakeClock(NOW)
  const fake = createFakeFetch()
  const scope = makeScope()
  fake.on('scan', () => ({ ok: true, scanId: 'scan-1', rev: 0, total: 4, order: [] }))
  let index = 0
  fake.on('snapshot', () => {
    index += 1
    if (index === 1) {
      return snapshotPayload({
        rev: 1,
        reset: true,
        progress: progress({ total: 4, scanned: 2, failed: 1, phase: 'scanning' }),
        changedSessions: [summary('s-current')],
        changedFiles: [fileNode('ok.ts')],
        errors: [scanError('s-child', 'threadline/session-unreadable')],
      })
    }
    return snapshotPayload({
      rev: 2,
      done: true,
      progress: progress({ total: 4, scanned: 4, failed: 1, phase: 'complete' }),
      changedSessions: [summary('s-recent'), summary('s-history')],
    })
  })
  const controller = createDataController({ fetch: fake.fetch, timer: clock.timer, now: clock.now })
  void controller.start(scope)
  await clock.flush()
  await clock.advance(0)
  assert.equal(controller.getState().graph.errors.length, 1)
  assert.equal(controller.getState().graph.sessions.size, 1)
  assert.equal(controller.getState().degrade.failedSessions, 1)
  await clock.advance(400)
  assert.equal(controller.getState().status, 'complete')
  assert.equal(controller.getState().graph.sessions.size, 3)
  assert.equal(controller.getState().graph.errors.length, 1)
  controller.dispose()
})

/* ------------------------------------------------------------------ *
 * N-11 scan-not-found / 重试
 * ------------------------------------------------------------------ */

test('N-11 scan-not-found → 自动重开一次扫描', async () => {
  const clock = createFakeClock(NOW)
  const fake = createFakeFetch()
  const scope = makeScope()
  let scanCount = 0
  fake.on('scan', () => {
    scanCount += 1
    return { ok: true, scanId: `scan-${scanCount}`, rev: 0, total: 4, order: [] }
  })
  let snapshotCount = 0
  fake.on('snapshot', () => {
    snapshotCount += 1
    if (snapshotCount === 1) {
      return { ok: false, error: { code: 'threadline/scan-not-found', message: 'gone' } }
    }
    return snapshotPayload({
      rev: 1,
      reset: true,
      done: true,
      progress: progress({ total: 4, scanned: 4, phase: 'complete' }),
      changedFiles: [fileNode('after-reopen.ts')],
    })
  })
  const controller = createDataController({ fetch: fake.fetch, timer: clock.timer, now: clock.now })
  void controller.start(scope)
  await clock.flush()
  await clock.advance(0) // 第一次 snapshot → scan-not-found → 自动重开（新 /scan 同一 tick 内发出）

  assert.equal(scanCount, 2)
  assert.equal(controller.getState().reopens, 1)
  await clock.advance(0) // 新扫描的首包 → 完成
  const state = controller.getState()
  assert.equal(state.status, 'complete')
  assert.equal(state.graph.files.size, 1)
  assert.equal(state.degrade.kind, 'none')
  controller.dispose()
})

test('N-11 自动重开只有一次：再次 scan-not-found 明确失败、保留已加载数据', async () => {
  const clock = createFakeClock(NOW)
  const fake = createFakeFetch()
  const scope = makeScope()
  let scans = 0
  fake.on('scan', () => {
    scans += 1
    return { ok: true, scanId: `scan-${scans}`, rev: 0, total: 4, order: [] }
  })
  let snapshots = 0
  fake.on('snapshot', () => {
    snapshots += 1
    if (snapshots === 1) {
      return snapshotPayload({
        rev: 1,
        reset: true,
        progress: progress({ total: 4, scanned: 1, phase: 'scanning' }),
        changedFiles: [fileNode('kept.ts')],
      })
    }
    return { ok: false, error: { code: 'threadline/scan-not-found', message: 'gone again' } }
  })
  const controller = createDataController({ fetch: fake.fetch, timer: clock.timer, now: clock.now })
  void controller.start(scope)
  await clock.flush()
  await clock.advance(0) // 第一包：有数据
  await clock.advance(400) // scan-not-found → 重开
  await clock.flush()
  await clock.advance(0) // 新 scan 的首包：再次 scan-not-found → 失败
  const state = controller.getState()
  assert.equal(state.status, 'failed')
  assert.equal(state.error?.code, 'threadline/scan-not-found')
  assert.equal(state.degrade.kind, 'failed')
  assert.equal(state.degrade.renderZeroForbidden, true)
  assert.equal(state.retained, true)
  assert.equal(state.graph.files.size, 1)
  assert.equal(scans, 2)
  assert.equal(clock.pending(), 0)
  controller.dispose()
})

test('N-11 传输失败退避 1s/2s/5s，最多 3 次后 failed（hostUnavailable）', async () => {
  const clock = createFakeClock(NOW)
  const fake = createFakeFetch()
  const scope = makeScope()
  fake.on('scan', () => ({ ok: true, scanId: 'scan-1', rev: 0, total: 4, order: [] }))
  fake.on('snapshot', () => {
    throw new Error('host unreachable')
  })
  const controller = createDataController({ fetch: fake.fetch, timer: clock.timer, now: clock.now })
  void controller.start(scope)
  await clock.flush()
  await clock.advance(0) // 第 1 次失败 → 1s 后重试
  assert.equal(fake.callsOf('snapshot').length, 1)
  await clock.advance(999)
  assert.equal(fake.callsOf('snapshot').length, 1)
  await clock.advance(1)
  assert.equal(fake.callsOf('snapshot').length, 2)
  await clock.advance(2000)
  assert.equal(fake.callsOf('snapshot').length, 3)
  await clock.advance(5000)
  assert.equal(fake.callsOf('snapshot').length, 4)
  const state = controller.getState()
  assert.equal(state.status, 'failed')
  assert.equal(state.degrade.kind, 'hostUnavailable')
  assert.equal(state.degrade.messageKey, 'state.hostUnavailable')
  assert.equal(state.degrade.renderZeroForbidden, true)
  assert.equal(clock.pending(), 0)
  controller.dispose()
})

test('A20-4 capability-missing：明确错误、不重试、不显示 0 图', async () => {
  const clock = createFakeClock(NOW)
  const fake = createFakeFetch()
  const scope = makeScope()
  fake.on('scan', () => ({ ok: false, error: { code: 'threadline/capability-missing', message: 'no persistence' } }))
  const controller = createDataController({ fetch: fake.fetch, timer: clock.timer, now: clock.now })
  void controller.start(scope)
  await clock.flush()
  const state = controller.getState()
  assert.equal(state.status, 'failed')
  assert.equal(state.degrade.kind, 'capability-missing')
  assert.equal(state.degrade.messageKey, 'state.hostUnavailable')
  assert.equal(state.degrade.renderZeroForbidden, true)
  assert.equal(fake.callsOf('scan').length, 1)
  assert.equal(clock.pending(), 0)
  controller.dispose()
})

test('A20-4 host 不可达（scan 抛错）重试 3 次后 hostUnavailable', async () => {
  const clock = createFakeClock(NOW)
  const fake = createFakeFetch()
  const scope = makeScope()
  fake.on('scan', () => {
    throw new Error('connect ECONNREFUSED')
  })
  const controller = createDataController({ fetch: fake.fetch, timer: clock.timer, now: clock.now })
  void controller.start(scope)
  await clock.flush()
  await clock.advance(1000)
  await clock.advance(2000)
  await clock.advance(5000)
  const state = controller.getState()
  assert.equal(state.status, 'failed')
  assert.equal(state.degrade.kind, 'hostUnavailable')
  assert.equal(fake.callsOf('scan').length, 4)
  assert.equal(state.coverage.known, false)
  controller.dispose()
})

/* ------------------------------------------------------------------ *
 * N-18 切换工作区 / generation
 * ------------------------------------------------------------------ */

test('N-18 切换工作区：取消旧请求，迟到响应被丢弃（不串数据）', async () => {
  const clock = createFakeClock(NOW)
  const fake = createFakeFetch()
  const gate = createGate()
  const scopeA = makeScope({ workspaceId: 'ws-a', ids: ['s-current', 's-a-child'] })
  const scopeB = makeScope({ workspaceId: 'ws-b', ids: ['s-current', 's-b-child'] })

  fake.on('scan', (body) => ({ ok: true, scanId: `scan-${String(body.workspaceId)}`, rev: 0, total: 2, order: [] }))
  fake.on('snapshot', async (body) => {
    if (String(body.scanId) === 'scan-ws-a') {
      await gate.wait()
      return snapshotPayload({
        rev: 9,
        reset: true,
        done: true,
        progress: progress({ total: 2, scanned: 2, phase: 'complete' }),
        changedSessions: [summary('s-a-child')],
        changedFiles: [fileNode('from-a.ts')],
      })
    }
    return snapshotPayload({
      rev: 1,
      reset: true,
      done: true,
      progress: progress({ total: 2, scanned: 2, phase: 'complete' }),
      changedSessions: [summary('s-b-child')],
      changedFiles: [fileNode('from-b.ts')],
    })
  })

  const controller = createDataController({ fetch: fake.fetch, timer: clock.timer, now: clock.now })
  void controller.start(scopeA)
  await clock.flush()
  await clock.advance(0) // A 的 snapshot 挂起

  void controller.start(scopeB)
  await clock.flush()
  await clock.advance(0) // B 完成
  assert.equal(controller.getState().workspaceId, 'ws-b')
  assert.deepEqual([...controller.getState().graph.files.keys()], ['from-b.ts'])

  // 迟到的 A 响应到达：必须被丢弃
  gate.open()
  await clock.flush()
  await clock.advance(0)
  const state = controller.getState()
  assert.equal(state.workspaceId, 'ws-b')
  assert.deepEqual([...state.graph.files.keys()], ['from-b.ts'])
  assert.equal(state.graph.sessions.has('s-a-child'), false)
  controller.dispose()
})

test('N-18 start 后旧 generation 的轮询定时器被清理（不继续请求旧扫描）', async () => {
  const clock = createFakeClock(NOW)
  const fake = createFakeFetch()
  const scopeA = makeScope({ workspaceId: 'ws-a' })
  const scopeB = makeScope({ workspaceId: 'ws-b' })
  fake.on('scan', (body) => ({ ok: true, scanId: `scan-${String(body.workspaceId)}`, rev: 0, total: 4, order: [] }))
  fake.on('snapshot', () =>
    snapshotPayload({
      rev: 1,
      reset: true,
      progress: progress({ total: 4, scanned: 1, phase: 'scanning' }),
      changedFiles: [fileNode('a.ts')],
    }),
  )
  const controller = createDataController({ fetch: fake.fetch, timer: clock.timer, now: clock.now })
  void controller.start(scopeA)
  await clock.flush()
  await clock.advance(0)
  const beforeSwitch = fake.callsOf('snapshot').length
  void controller.start(scopeB)
  await clock.flush()
  await clock.advance(0)
  const afterSwitch = fake.callsOf('snapshot').slice(beforeSwitch)
  assert.equal(afterSwitch.length, 1)
  assert.equal(afterSwitch[0].body.scanId, 'scan-ws-b')
  controller.dispose()
})

/* ------------------------------------------------------------------ *
 * 04 §5.2 页面隐藏降频
 * ------------------------------------------------------------------ */

test('04 §5.2 页面隐藏降频 400ms → 2s，恢复后立即拉一次', async () => {
  const clock = createFakeClock(NOW)
  const fake = createFakeFetch()
  const scope = makeScope()
  let hidden = false
  fake.on('scan', () => ({ ok: true, scanId: 'scan-1', rev: 0, total: 4, order: [] }))
  let calls = 0
  fake.on('snapshot', () => {
    calls += 1
    return snapshotPayload({
      rev: calls,
      reset: calls === 1,
      progress: progress({ total: 4, scanned: 1, phase: 'scanning' }),
      changedFiles: [fileNode(`f${calls}.ts`)],
    })
  })
  const controller = createDataController({
    fetch: fake.fetch,
    timer: clock.timer,
    now: clock.now,
    visibility: () => (hidden ? 'hidden' : 'visible'),
  })
  void controller.start(scope)
  await clock.flush()
  await clock.advance(0)
  assert.equal(fake.callsOf('snapshot').length, 1)

  // 可见：400ms 一次
  await clock.advance(400)
  assert.equal(fake.callsOf('snapshot').length, 2)

  // 隐藏：通知后降到 2s（400ms 不拉，2000ms 才拉）
  hidden = true
  controller.notifyVisibility('hidden')
  await clock.advance(400)
  assert.equal(fake.callsOf('snapshot').length, 2)
  await clock.advance(1599)
  assert.equal(fake.callsOf('snapshot').length, 2)
  await clock.advance(1)
  assert.equal(fake.callsOf('snapshot').length, 3)

  // 恢复可见：立即拉一次（不等 400ms）
  hidden = false
  controller.notifyVisibility('visible')
  await clock.flush()
  assert.equal(fake.callsOf('snapshot').length, 4)
  controller.dispose()
})

/* ------------------------------------------------------------------ *
 * 停止 / 释放
 * ------------------------------------------------------------------ */

test('stop() 停止轮询并中止在途请求，之后不再请求', async () => {
  const clock = createFakeClock(NOW)
  const fake = createFakeFetch()
  const scope = makeScope()
  fake.on('scan', () => ({ ok: true, scanId: 'scan-1', rev: 0, total: 4, order: [] }))
  fake.on('snapshot', () =>
    snapshotPayload({
      rev: 1,
      reset: true,
      progress: progress({ total: 4, scanned: 1, phase: 'scanning' }),
    }),
  )
  const controller = createDataController({ fetch: fake.fetch, timer: clock.timer, now: clock.now })
  void controller.start(scope)
  await clock.flush()
  await clock.advance(0)
  const before = fake.callsOf('snapshot').length
  controller.stop()
  await clock.advance(4000)
  assert.equal(fake.callsOf('snapshot').length, before)
  assert.equal(controller.getState().polling, false)
  controller.dispose()
})

test('cwd 无法识别：显式失败，不发请求（不伪造 0 图）', async () => {
  const clock = createFakeClock(NOW)
  const fake = createFakeFetch()
  const scope = buildWorkspaceScope({
    workspaces: { items: [{ id: 'ws', sessionIds: ['s-a'] }] },
    sessions: { ids: ['s-a'] },
    sessionId: 's-a',
    now: NOW,
  })
  const controller = createDataController({ fetch: fake.fetch, timer: clock.timer, now: clock.now })
  void controller.start(scope)
  await clock.flush()
  const state = controller.getState()
  assert.equal(state.status, 'failed')
  assert.equal(state.failureKind, 'route')
  assert.equal(state.error?.code, 'threadline/bad-request')
  assert.equal(state.degrade.renderZeroForbidden, true)
  assert.equal(fake.calls.length, 0)
  controller.dispose()
})
