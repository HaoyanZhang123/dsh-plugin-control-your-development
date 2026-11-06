/**
 * T37 · 首屏「假空态」的数据侧回归（35 §2.1）。
 *
 * 真机症状：右侧 scan 卡片已有数据，左侧 T4 显示「0 文件 / 空图」，过一会才正常。
 * 数据侧根因：`DetailEntry` 可能是「还没回来」（null/loading）或「比会话行旧」（半截数据），
 * 调用方无法区分 → 把 undefined 画成 0。这里断言 helper 把三态分开：
 * - loading（骨架，`fileCount` 必须是 undefined，**不是 0**）；
 * - ready 且 0 文件（**可信的 0**，这一轮真的没有文件操作）；
 * - error（可重试）/ unknown（不猜）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createDetailStore } from '../../src/client/data/detail.ts'
import { detailLoadingOf, detailViewOf, turnDetailOf } from '../../src/client/data/detailView.ts'
import type { DetailEntry } from '../../src/client/data/detail.ts'
import type { TurnDetail } from '../../src/shared/events/index.ts'
import type { SessionDetail } from '../../src/shared/events/index.ts'
import { CWD, NOW, createFakeFetch, createGate, detailPayload } from './fixtures.ts'

/** 造一轮（files 只给路径；status 默认 completed）。 */
function turn(n: number, paths: readonly string[], overrides: Partial<TurnDetail> = {}): TurnDetail {
  return {
    n,
    start: NOW - 10_000 + n * 100,
    end: NOW - 9_000 + n * 100,
    status: 'completed',
    files: paths.map((path) => ({ path, ops: ['read'], added: 0, removed: 0 })),
    commands: [],
    subagents: [],
    errors: 0,
    toolCalls: 0,
    toolFailures: 0,
    messageIds: [],
    ...overrides,
  }
}

function readyEntry(session: Partial<SessionDetail> & { id: string }, updatedAt: number): DetailEntry {
  const payload = detailPayload(session) as { session: SessionDetail }
  return {
    sessionId: payload.session.id,
    status: 'ready',
    detail: payload.session,
    partial: false,
    updatedAt,
    fetchedAt: NOW,
    stale: false,
    generation: 0,
  }
}

test('T37 没请求/没回来：loading=true 且 fileCount 是 undefined（不许画成 0）', () => {
  const empty = detailViewOf(undefined)
  assert.equal(empty.status, 'idle')
  assert.equal(empty.loading, true)
  assert.equal(empty.hasDetail, false)
  assert.equal(empty.turnCount, undefined)
  assert.equal(detailLoadingOf(undefined), true)
  const turnView = turnDetailOf(empty, 4)
  assert.equal(turnView.status, 'loading')
  assert.equal(turnView.fileCount, undefined)
  assert.equal('fileCount' in turnView, false)

  // store 里正在读（loading 占位）同样是 loading，不是「0 文件」
  const entry: DetailEntry = {
    sessionId: 's-1',
    status: 'loading',
    partial: false,
    updatedAt: NOW,
    fetchedAt: NOW,
    stale: false,
    generation: 0,
  }
  const loadingView = detailViewOf(entry, { updatedAt: NOW })
  assert.equal(loadingView.status, 'loading')
  assert.equal(loadingView.loading, true)
  assert.equal(loadingView.hasDetail, false)
  assert.equal(detailLoadingOf(entry), true)
  assert.equal(turnDetailOf(loadingView, 4).fileCount, undefined)
})

test('T37 真实时序：loading → ready 后才有文件数（且 ready 的 0 才是真空）', async () => {
  const fake = createFakeFetch()
  const gate = createGate()
  fake.on('detail', async (body) => {
    await gate.wait()
    return detailPayload({
      id: String(body.sessionId),
      updatedAt: NOW,
      turns: [turn(3, ['src/old.ts']), turn(4, ['public/index.html', 'styles/site.css'])],
    })
  })
  const store = createDetailStore({ fetch: fake.fetch, now: () => NOW })

  const pending = store.request('s-1', { updatedAt: NOW, cwd: CWD })
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  const loading = detailViewOf(store.peek('s-1'), { updatedAt: NOW })
  assert.equal(loading.status, 'loading')
  assert.equal(turnDetailOf(loading, 4).status, 'loading')
  assert.equal(turnDetailOf(loading, 4).fileCount, undefined)

  gate.openAll()
  const entry = await pending
  const ready = detailViewOf(entry, { updatedAt: NOW })
  assert.equal(ready.status, 'ready')
  assert.equal(ready.loading, false)
  assert.equal(ready.fresh, true)
  assert.equal(ready.turnCount, 2)
  const turn4 = turnDetailOf(ready, 4)
  assert.equal(turn4.status, 'ready')
  assert.equal(turn4.fileCount, 2)
  assert.equal(turn4.partial, false)
  store.dispose()
})

test('T37 ready 且 0 文件：是真的「这一轮没有文件操作」（不是「还不知道」）', () => {
  const entry = readyEntry({ id: 's-1', updatedAt: NOW, turns: [turn(4, [])] }, NOW)
  const view = detailViewOf(entry, { updatedAt: NOW })
  assert.equal(view.status, 'ready')
  assert.equal(view.fresh, true)
  const turnView = turnDetailOf(view, 4)
  assert.equal(turnView.status, 'ready')
  assert.equal(turnView.fileCount, 0)
  assert.equal(turnView.partial, false)
})

test('T37 缓存的 detail 比会话行旧（半截数据）：0 文件不当结论，显示 loading', () => {
  // 聊天页早先读到的 detail 停在 T4 刚开、还没记录文件操作；会话行已经推进了。
  const stale = readyEntry({ id: 's-1', updatedAt: NOW, turns: [turn(4, [])] }, NOW)
  const view = detailViewOf(stale, { updatedAt: NOW + 5_000 })
  assert.equal(view.status, 'ready', '数据本身是 ready（有旧值可用）')
  assert.equal(view.fresh, false, '但相对会话行已经旧了')
  assert.equal(view.stale, true)
  const turnView = turnDetailOf(view, 4)
  assert.equal(turnView.status, 'loading', '旧数据的 0 文件不能当结论')
  assert.equal(turnView.fileCount, undefined)
  assert.equal(turnView.partial, true, '标「可能还会长」，UI 显示正在读取')

  // 旧数据里有文件：可以显示，但仍标 partial（可能少文件）
  const staleWithFiles = readyEntry({ id: 's-1', updatedAt: NOW, turns: [turn(4, ['src/a.ts'])] }, NOW)
  const withFiles = turnDetailOf(detailViewOf(staleWithFiles, { updatedAt: NOW + 5_000 }), 4)
  assert.equal(withFiles.status, 'ready')
  assert.equal(withFiles.fileCount, 1)
  assert.equal(withFiles.partial, true)
})

test('T37 旧数据里根本没有这一轮：fresh 才是 unknown，不 fresh 就继续等', () => {
  const entry = readyEntry({ id: 's-1', updatedAt: NOW, turns: [turn(1, ['a.ts']), turn(2, ['b.ts'])] }, NOW)
  const fresh = detailViewOf(entry, { updatedAt: NOW })
  const missingFresh = turnDetailOf(fresh, 4)
  assert.equal(missingFresh.status, 'unknown', '最新数据里确实没有 T4：不猜、也不显示 0')
  assert.equal(missingFresh.fileCount, undefined)

  const stale = detailViewOf(entry, { updatedAt: NOW + 1_000 })
  const missingStale = turnDetailOf(stale, 4)
  assert.equal(missingStale.status, 'loading', '数据旧了：可能还没读到 T4 → 加载态')
  assert.equal(missingStale.fileCount, undefined)
})

test('T37 失败：没有可用数据 → error（可重试），不伪造空详情', async () => {
  const fake = createFakeFetch()
  fake.on('detail', () => ({ ok: false, error: { code: 'threadline/session-unreadable', message: 'broken' } }))
  const store = createDetailStore({ fetch: fake.fetch, now: () => NOW })
  const entry = await store.request('s-1', { updatedAt: NOW, cwd: CWD })
  const view = detailViewOf(entry, { updatedAt: NOW })
  assert.equal(view.status, 'error')
  assert.equal(view.hasDetail, false)
  assert.equal(view.error?.code, 'threadline/session-unreadable')
  assert.equal(view.turnCount, undefined)
  const turnView = turnDetailOf(view, 4)
  assert.equal(turnView.status, 'error')
  assert.equal(turnView.fileCount, undefined)
  store.dispose()
})

test('T37 后台刷新：有旧值时 detailLoadingOf 为 false（照常显示旧值 + 更新中）', () => {
  const ready = readyEntry({ id: 's-1', updatedAt: NOW, turns: [turn(4, ['src/a.ts'])] }, NOW)
  const refreshing: DetailEntry = { ...ready, status: 'loading', stale: true }
  const view = detailViewOf(refreshing, { updatedAt: NOW })
  assert.equal(view.status, 'loading')
  assert.equal(view.loading, false, '有旧值就不该整块骨架')
  assert.equal(view.refreshing, true)
  assert.equal(view.hasDetail, true)
  assert.equal(view.stale, true)
  assert.equal(detailLoadingOf(refreshing), false)
  // 半截刷新中：文件数可以显示，但标 partial
  const turnView = turnDetailOf(view, 4)
  assert.equal(turnView.status, 'ready')
  assert.equal(turnView.fileCount, 1)
  assert.equal(turnView.partial, true)
})

test('T37 非法轮号 / 非法 updatedAt：不抛错、不猜', () => {
  const entry = readyEntry({ id: 's-1', updatedAt: NOW, turns: [turn(4, ['a.ts'])] }, NOW)
  assert.equal(turnDetailOf(detailViewOf(entry), -1).status, 'unknown')
  assert.equal(turnDetailOf(detailViewOf(entry, { updatedAt: Number.NaN }), 4).status, 'ready')
  assert.equal(turnDetailOf(detailViewOf(entry, { updatedAt: -5 }), 4).status, 'ready')
})
