/**
 * T37 · 首屏「假空态」的数据侧复现（35 §1 症状 / §2.1 期望）。
 *
 * 真机症状：首次进 tab 时右侧卡片（来自 `/scan` 快照）已有数据，
 * 左侧选中的 T4 显示「0 文件 / 空图」，过一会才正常。
 *
 * 这条用例把数据侧的两个缺陷按顺序复现出来（不是 UI 猜测）：
 * 1. **缓存不会自己变新**：`store.request` 不带 `updatedAt` 时永远命中缓存
 *    （`shouldReuse` 见 `data/detail.ts`）——聊天页早先读到的「T4 刚开、还没有文件操作」
 *    就一直被当成当前事实；
 * 2. **undefined 被当 0**：调用方直接读 `entry.detail.turns[n].files.length`，
 *    半截数据/未就绪都画成 `0 文件`（截图来源）。
 *
 * 断言的是「同一份输入，旧读法给假 0，新 helper 给 loading」。UI 接线由 Lead 做（tab.ts 不归 T37）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createDetailStore } from '../../src/client/data/detail.ts'
import { detailViewOf, turnDetailOf } from '../../src/client/data/detailView.ts'
import type { TurnDetail } from '../../src/shared/events/index.ts'
import { CWD, NOW, createFakeFetch, detailPayload } from './fixtures.ts'

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

test('T37 复现：scan 已就绪 + detail 半截 → 旧读法画「T4 · 0 文件」，新 helper 判 loading', async () => {
  const fake = createFakeFetch()
  let phase: 'mid' | 'done' = 'mid'
  fake.on('detail', (body) => {
    const turns =
      phase === 'mid'
        ? // T4 刚开始：turn/start 有了，文件操作还没记录（读数 0，但这是「还不是结论」）
          [turn(3, ['src/app.ts']), turn(4, [], { status: 'running', end: undefined, toolCalls: 0 })]
        : [turn(3, ['src/app.ts']), turn(4, ['public/index.html', 'styles/site.css'])]
    return detailPayload({
      id: String(body.sessionId),
      updatedAt: NOW,
      status: phase === 'mid' ? 'running' : 'completed',
      running: phase === 'mid',
      partial: phase === 'mid',
      turns,
    })
  })
  const store = createDetailStore({ fetch: fake.fetch, now: () => NOW })

  // 1) 聊天页/impact 早先读过一次（那时 T4 还在写）
  const mid = await store.request('s-current', { cwd: CWD })
  assert.equal(mid.status, 'ready')
  assert.equal(mid.detail?.turns[1].files.length, 0, '半截 detail：T4 的 files 是空的')

  // 2) 旧读法（tab 现状：请求不带 updatedAt）→ 永远命中同一个缓存条目
  const reused = await store.request('s-current', { cwd: CWD })
  assert.equal(reused, mid, '不带 updatedAt 时 store 直接复用旧条目（不会自己变新）')
  assert.equal(store.stats.fetches, 1)
  assert.equal(store.stats.hits, 1)

  // 3) 旧读法把「还不是结论」画成 0 —— 这就是截图里的「T4 · 0 文件 / 空图」
  const rawTurn = store.peek('s-current')?.detail?.turns.find((item) => item.n === 4)
  assert.equal(rawTurn?.files.length, 0, 'UI 当时读到的原始字段就是 0')

  // 4) 新口径（带会话行 updatedAt）：不把它当结论，判 loading（骨架 / 正在读取）
  const rowUpdatedAt = NOW + 5_000
  const staleView = detailViewOf(store.peek('s-current'), { updatedAt: rowUpdatedAt })
  assert.equal(staleView.status, 'ready', '有旧值可以显示（不是全黑屏）')
  assert.equal(staleView.fresh, false, '但它比会话行旧')
  const staleTurn = turnDetailOf(staleView, 4)
  assert.equal(staleTurn.status, 'loading')
  assert.equal(staleTurn.fileCount, undefined, 'loading 时 fileCount 必须是 undefined，不是 0')

  // 5) 会话推进后由 updatedAt 触发重拉（impact/tab 的新口径）→ 真数据到了才是 ready
  phase = 'done'
  const refreshed = await store.request('s-current', { cwd: CWD, updatedAt: rowUpdatedAt })
  assert.equal(fake.callsOf('detail').length, 2, 'updatedAt 变了才会真的重拉')
  const readyView = detailViewOf(refreshed, { updatedAt: rowUpdatedAt })
  assert.equal(readyView.fresh, true)
  const turn4 = turnDetailOf(readyView, 4)
  assert.equal(turn4.status, 'ready')
  assert.equal(turn4.fileCount, 2, '这时才是可信的文件数')
  store.dispose()
})

test('T37 复现：没请求过 detail（首帧）时，旧读法同样是 0，新 helper 是 loading', async () => {
  const fake = createFakeFetch()
  fake.on('detail', () => detailPayload({ id: 's-current', updatedAt: NOW, turns: [turn(4, ['a.ts'])] }))
  const store = createDetailStore({ fetch: fake.fetch, now: () => NOW })

  // 首帧：store 里还没有这个会话的条目（tab/impact 的第一次渲染）
  const entry = store.peek('s-current')
  // 旧读法：`entry?.detail ?? null` → 没有条目 → 文件数自然是 0（假空态）
  const legacyFiles = store.peek('s-current')?.detail?.turns.find((item) => item.n === 4)?.files.length ?? 0
  assert.equal(legacyFiles, 0)
  assert.equal(entry, undefined)
  // 新 helper：idle → loading，fileCount 不存在
  const view = detailViewOf(entry, { updatedAt: NOW })
  assert.equal(view.status, 'idle')
  assert.equal(view.loading, true)
  const turnView = turnDetailOf(view, 4)
  assert.equal(turnView.status, 'loading')
  assert.equal(turnView.fileCount, undefined)
  assert.equal(fake.callsOf('detail').length, 0, 'helper 不发请求（纯函数）')
  store.dispose()
})
