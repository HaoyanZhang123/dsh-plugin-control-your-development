/**
 * T13e · 共享扫描预热（真机反馈：不先开 tab 也要能看详情；打开 tab 即现成数据）。
 *
 * 断言：
 * - `ensureThreadlineWarmup` 幂等（连调 3 次只发 1 次 `/scan`）；
 * - workspaceKey 变化 → 旧扫描被 abort、新 `/scan` 发起、旧预热被移除；
 * - detail 请求 body 带 `cwd`（cold-read 归属校验）；
 * - 无 tab 场景顺序：先 `/scan` 再 `/detail`；
 * - 预热不因退订而停（页面级存活），`disposeAllWarmups` 才停；
 * - snapshot 落地后对 running / 最近会话预取 detail，按 updatedAt 去重。
 */
import test, { beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { createDetailStore } from '../../src/client/data/detail.ts'
import {
  activeWarmupKeys,
  disposeAllWarmups,
  ensureThreadlineWarmup,
  ensureWarmupForDetail,
  getWarmupState,
  isWarmupActive,
  registerWarmupDetailStore,
  scopeFromWarmup,
  threadlineWorkspaceKey,
  warmupDetailTargets,
} from '../../src/client/data/warmup.ts'
import type { WarmupSession } from '../../src/client/data/warmup.ts'
import {
  CWD,
  NOW,
  createFakeClock,
  createFakeFetch,
  detailPayload,
  progress,
  snapshotPayload,
  summary,
} from './fixtures.ts'

const OTHER_CWD = 'E:/DSH/workspaces/other'

const SESSIONS: WarmupSession[] = [
  { id: 's-run', updatedAt: NOW, running: true, cwd: CWD, title: 'running' },
  { id: 's-recent', updatedAt: NOW - 60_000, running: false, cwd: CWD, title: 'recent' },
  { id: 's-old', updatedAt: NOW - 40 * 24 * 3600_000, running: false, cwd: CWD, title: 'old' },
]

interface Harness {
  clock: ReturnType<typeof createFakeClock>
  fake: ReturnType<typeof createFakeFetch>
  store: ReturnType<typeof createDetailStore>
  scans: number
}

function harness(): Harness {
  const clock = createFakeClock(NOW)
  const fake = createFakeFetch()
  const store = createDetailStore({ fetch: fake.fetch, now: clock.now })
  const state: Harness = { clock, fake, store, scans: 0 }
  fake.on('scan', (body) => {
    state.scans += 1
    const sessions = Array.isArray(body.sessions) ? (body.sessions as Array<{ id: string }>) : []
    return { ok: true, scanId: `scan-${state.scans}`, rev: 0, total: sessions.length, order: sessions.map((s) => s.id) }
  })
  fake.on('snapshot', () =>
    snapshotPayload({
      rev: 1,
      reset: true,
      progress: progress({ total: 3, scanned: 1, phase: 'scanning' }),
    }),
  )
  fake.on('detail', (body) => detailPayload({ id: String(body.sessionId), updatedAt: NOW }))
  registerWarmupDetailStore(store)
  return state
}

function ensure(h: Harness, key: string, overrides: { cwd?: string; sessions?: WarmupSession[] } = {}) {
  return ensureThreadlineWarmup({
    workspaceKey: key,
    cwd: overrides.cwd ?? CWD,
    sessions: overrides.sessions ?? SESSIONS,
    fetch: h.fake.fetch,
    timer: h.clock.timer,
    now: h.clock.now,
    detailStore: h.store,
  })
}

beforeEach(() => {
  disposeAllWarmups()
})
afterEach(() => {
  disposeAllWarmups()
})

test('T13e warmup 幂等：连调 3 次只发 1 次 /scan，重复调用只更新 sessions', async () => {
  const h = harness()
  const key = threadlineWorkspaceKey('ws-main', CWD)
  const first = ensure(h, key)
  const second = ensure(h, key)
  const third = ensure(h, key, { sessions: [...SESSIONS, { id: 's-new', updatedAt: NOW - 10, running: false, cwd: CWD }] })
  await h.clock.flush()
  assert.equal(h.scans, 1)
  assert.equal(h.fake.callsOf('scan').length, 1)
  assert.equal(activeWarmupKeys().length, 1)
  assert.equal(second.workspaceKey, first.workspaceKey)
  assert.equal(third.workspaceKey, first.workspaceKey)
  await h.clock.advance(0)
  // 共享同一份 controller 状态（不是三个实例）
  assert.equal(getWarmupState(key)?.scanId, 'scan-1')
  assert.equal(isWarmupActive(key), true)
})

test('T13e workspaceKey 变化：旧扫描被 abort、新 /scan 发起、旧预热被移除', async () => {
  const h = harness()
  const keyA = threadlineWorkspaceKey('ws-a', CWD)
  const keyB = threadlineWorkspaceKey('ws-b', OTHER_CWD)
  ensure(h, keyA)
  await h.clock.flush()
  assert.equal(h.scans, 1)
  const firstSignal = h.fake.callsOf('scan')[0].init?.signal
  assert.ok(firstSignal !== undefined)
  assert.equal(firstSignal.aborted, false)

  ensure(h, keyB, {
    cwd: OTHER_CWD,
    sessions: [{ id: 's-other', updatedAt: NOW, running: true, cwd: OTHER_CWD }],
  })
  await h.clock.flush()
  assert.equal(h.scans, 2)
  assert.equal(firstSignal.aborted, true)
  assert.deepEqual(activeWarmupKeys(), [keyB])
  assert.equal(getWarmupState(keyA), undefined)
  assert.equal(h.fake.callsOf('scan')[1].body.cwd, OTHER_CWD)
})

test('T13e detail 请求 body 带 cwd（显式 / 默认 / 未给三态）', async () => {
  const h = harness()
  await h.store.request('s-explicit', { cwd: CWD })
  const explicit = h.fake.callsOf('detail')[0]
  assert.equal(explicit.body.cwd, CWD)

  h.store.setDefaultCwd(OTHER_CWD)
  await h.store.request('s-default')
  const byDefault = h.fake.callsOf('detail')[1]
  assert.equal(byDefault.body.cwd, OTHER_CWD)

  // 未给 cwd：不猜（body 里没有该字段，host 会兜底报错，不伪造）
  const bare = createDetailStore({ fetch: h.fake.fetch, now: h.clock.now })
  await bare.request('s-bare')
  const noCwd = h.fake.callsOf('detail')[2]
  assert.equal('cwd' in noCwd.body, false)
  bare.dispose()

  // 默认 cwd 变化会清掉旧工作区缓存（不串数据）
  h.store.setDefaultCwd(CWD)
  assert.equal(h.store.peek('s-default'), undefined)
  assert.equal(h.store.defaultCwd, CWD)
})

test('T13e 无 tab 场景顺序：先 ensure（/scan）再 /detail，且 detail 带 cwd', async () => {
  const h = harness()
  const key = threadlineWorkspaceKey('ws-main', CWD)
  // 与 useThreadlineDetail 内部完全相同的顺序：ensureWarmupForDetail → store.request
  const handle = ensureWarmupForDetail(h.store, {
    cwd: CWD,
    warmup: { workspaceKey: key, cwd: CWD, sessions: SESSIONS },
    fetch: h.fake.fetch,
  })
  assert.ok(handle !== undefined)
  await Promise.resolve()
  await h.store.request('s-run', { cwd: CWD })

  const routes = h.fake.calls.map((call) => call.route)
  assert.deepEqual(routes.slice(0, 2), ['scan', 'detail'])
  assert.equal(h.fake.callsOf('detail')[0].body.sessionId, 's-run')
  assert.equal(h.fake.callsOf('detail')[0].body.cwd, CWD)
  assert.equal(h.fake.callsOf('detail')[0].body.generation, 0)
  // 同一个工作区再 ensure 不重复 /scan
  ensureWarmupForDetail(h.store, { cwd: CWD, warmup: { workspaceKey: key, cwd: CWD, sessions: SESSIONS }, fetch: h.fake.fetch })
  await h.clock.flush()
  assert.equal(h.fake.callsOf('scan').length, 1)
})

test('T13e 预热保持存活：退订不停，dispose 才停', async () => {
  const h = harness()
  const key = threadlineWorkspaceKey('ws-main', CWD)
  const handle = ensure(h, key)
  const seen: string[] = []
  const unsubscribe = handle.subscribe((snapshot) => seen.push(snapshot.status))
  await h.clock.advance(0)
  assert.equal(seen.length > 0, true)
  unsubscribe()
  const before = h.fake.callsOf('snapshot').length
  await h.clock.advance(400)
  assert.equal(h.fake.callsOf('snapshot').length > before, true)
  disposeAllWarmups()
  const after = h.fake.callsOf('snapshot').length
  await h.clock.advance(4000)
  assert.equal(h.fake.callsOf('snapshot').length, after)
})

test('T13e snapshot 落地后预取 running + 最近会话 detail（并发≤2、按 updatedAt 去重）', async () => {
  const h = harness()
  const key = threadlineWorkspaceKey('ws-main', CWD)
  let snapshotIndex = 0
  h.fake.on('snapshot', () => {
    snapshotIndex += 1
    const runningUpdatedAt = snapshotIndex >= 2 ? NOW + 1000 : NOW
    return snapshotPayload({
      rev: snapshotIndex,
      reset: snapshotIndex === 1,
      progress: progress({ total: 3, scanned: snapshotIndex, phase: 'scanning' }),
      changedSessions: [
        summary('s-run', { running: true, updatedAt: runningUpdatedAt }),
        summary('s-recent', { updatedAt: NOW - 60_000 }),
        summary('s-old', { updatedAt: NOW - 40 * 24 * 3600_000 }),
      ],
    })
  })
  ensure(h, key)
  await h.clock.advance(0)
  await h.clock.flush()
  const firstBatch = h.fake.callsOf('detail')
  assert.equal(firstBatch.length > 0, true)
  // 预取目标 = running + 最近活动（最多 3 个），但**并发**始终 ≤2（store 队列保证）
  assert.equal(firstBatch.length <= 3, true)
  assert.equal(h.fake.maxActiveOf('detail') <= 2, true)
  const ids = firstBatch.map((call) => call.body.sessionId)
  assert.equal(ids.includes('s-run'), true)
  assert.equal(new Set(ids).size, ids.length)
  for (const call of firstBatch) {
    assert.equal(call.body.cwd, CWD)
    assert.equal(call.body.refresh, true)
  }

  // running 会话 updatedAt 变了 → 只重拉它（其余不重复）
  await h.clock.advance(400)
  await h.clock.flush()
  const afterChange = h.fake.callsOf('detail')
  assert.equal(
    afterChange.length,
    firstBatch.length + 1,
    JSON.stringify({
      first: firstBatch.map((call) => [call.body.sessionId, call.body.updatedAt]),
      after: afterChange.map((call) => [call.body.sessionId, call.body.updatedAt]),
    }),
  )
  // 只有 running 会话被重拉，且缓存条目记住新的 updatedAt（供 UI 判新旧）
  assert.equal(afterChange.filter((call) => call.body.sessionId === 's-run').length, 2)
  assert.equal(h.store.peek('s-run')?.updatedAt, NOW + 1000)

  // 同一 updatedAt 的下一次 snapshot 不重复预取
  await h.clock.advance(400)
  await h.clock.flush()
  assert.equal(h.fake.callsOf('detail').length, afterChange.length)
})

test('T13e 共享 detail store 后注册：注册时立刻补一次预取（tab 打开即现成）', async () => {
  const h = harness()
  registerWarmupDetailStore(null)
  const key = threadlineWorkspaceKey('ws-main', CWD)
  // 不注入 detailStore：模拟"预热先起、tab/store 后到"
  ensureThreadlineWarmup({
    workspaceKey: key,
    cwd: CWD,
    sessions: SESSIONS,
    fetch: h.fake.fetch,
    timer: h.clock.timer,
    now: h.clock.now,
  })
  await h.clock.advance(0)
  await h.clock.flush()
  assert.equal(h.fake.callsOf('detail').length, 0)
  registerWarmupDetailStore(h.store)
  await h.clock.flush()
  const calls = h.fake.callsOf('detail')
  assert.equal(calls.length > 0, true)
  assert.equal(calls[0].body.cwd, CWD)
})

test('T13e warmup 的 scope 合成：排序与子智能体规则与 tab 同一套（不另造状态机）', () => {
  const scope = scopeFromWarmup({
    workspaceKey: 'ws-main',
    cwd: CWD,
    sessions: [
      { id: 's-current', updatedAt: NOW, running: true, cwd: CWD },
      { id: 's-child', updatedAt: NOW - 1000, running: false, cwd: OTHER_CWD, parentId: 's-current' },
      { id: 's-old', updatedAt: NOW - 40 * 24 * 3600_000, running: false, cwd: CWD },
    ],
  })
  assert.equal(scope.workspaceId, 'ws-main')
  assert.equal(scope.cwd, CWD)
  assert.deepEqual(scope.order, ['s-current', 's-child', 's-old'])
  assert.equal(scope.sessions[1].bucket, 'subagent')
})

test('T13e warmupDetailTargets：running 优先、最近活动补位、去重', () => {
  const h = harness()
  const snapshot = {
    ...ensure(h, threadlineWorkspaceKey('ws-main', CWD)).getState(),
  }
  const targets = warmupDetailTargets(snapshot, SESSIONS)
  assert.deepEqual(targets.map((target) => target.id), ['s-run', 's-recent', 's-old'])
  assert.equal(new Set(targets.map((target) => target.id)).size, targets.length)
  const oneRecent = warmupDetailTargets(snapshot, SESSIONS, { recentLimit: 1 })
  assert.deepEqual(oneRecent.map((target) => target.id), ['s-run', 's-recent'])
})
