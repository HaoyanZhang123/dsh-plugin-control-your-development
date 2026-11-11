/*
 * tests/entries/reasoning-seed.test.ts —— 思维链 tab 的「缓存播种」（1.5.1 真机缺陷）。
 *
 * 真机现象：思维链 tab 永远显示「这个范围内没有可读取的思维链记录」，
 * 而同一份数据的 host /detail 响应里 reasoning 有几十条。
 *
 * 根因（已实测）：`createDetailStore.request()` **命中缓存时走 Promise.resolve(cached)、
 * 不发请求也不 notify**。真机上共享 store 早被页面级预热/脉络预取/影响入口填满，
 * 于是思维链要的那批会话全是缓存命中 → 只订阅的话一次回调都收不到 →
 * `extraDetails` 恒空 → 只剩「当前会话」一条孤线兜底 → 它一旦不是 ready 就显示"没有记录"。
 *
 * 这条套件用**真实 store** 复现那个顺序，并锁住修复后的语义：
 * 样本来源 = 缓存 ∪ 通知。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createDetailStore } from '../../src/client/data/detail.ts'
import type { FetchLike } from '../../src/client/data/http.ts'
import type { SessionDetail } from '../../src/shared/events/index.ts'
import { seedReasoningDetails } from '../../src/client/entries/reasoning.ts'

/** 最小可用 detail（只要有 id + reasoning 就够本套件判语义）。 */
function detailOf(id: string, samples: number): SessionDetail {
  return {
    id,
    rootId: id,
    cwd: 'E:\\DSH\\workspaces\\demo',
    startedAt: 0,
    updatedAt: 1,
    status: 'completed',
    turns: [],
    subagents: [],
    messageTurns: {},
    errors: [],
    counts: { turns: 0, steps: 0, toolCalls: 0, toolFailures: 0, files: 0, commands: 0, subagents: 0, errors: 0 },
    jobs: [],
    reasoning: Array.from({ length: samples }, (_, index) => ({
      text: 'sample ' + String(index),
      answerText: '',
      sessionId: id,
      turn: 1,
      at: index,
      kind: 'committed' as const,
    })),
  }
}

/** 假 fetch：按 sessionId 返回 detail，并记录真实发出了几次 /detail。 */
function makeFetch(seed: Record<string, number>): { fetch: FetchLike; calls: string[] } {
  const calls: string[] = []
  const fetch: FetchLike = async (_input, init) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { sessionId?: string }
    const sessionId = body.sessionId ?? ''
    calls.push(sessionId)
    const samples = seed[sessionId]
    if (samples === undefined) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: false, error: { code: 'threadline/session-unreadable', message: 'missing' } }),
      }
    }
    return { ok: true, status: 200, json: async () => ({ ok: true, session: detailOf(sessionId, samples) }) }
  }
  return { fetch, calls }
}

test('缓存命中时：只订阅收不到任何回调（这就是原实现丢数据的机制）', async () => {
  const { fetch, calls } = makeFetch({ a: 2, b: 3 })
  const store = createDetailStore({ fetch, now: () => 1 })

  /* 预热：模拟页面级预热/脉络预取先把这三条灌进共享 store。 */
  await store.request('a', { updatedAt: 1 })
  await store.request('b', { updatedAt: 1 })
  const before = calls.length
  assert.equal(before, 2)

  let notified = 0
  store.subscribe(() => {
    notified += 1
  })
  /* 再次 request 同一批（思维链 tab 进来的动作）：全部命中缓存。 */
  await store.request('a', { updatedAt: 1 })
  await store.request('b', { updatedAt: 1 })

  assert.equal(calls.length, before, '命中缓存不得再发 /detail（这是 store 的既有契约）')
  assert.equal(notified, 0, '命中缓存不 notify —— 原实现因此一条 detail 都收不到')
  assert.equal(store.stats.hits, 2, '应记为 2 次缓存命中')
  store.dispose()
})

test('缓存播种：播种后即使一次回调都没有，也能拿到全部已缓存 detail', async () => {
  const { fetch } = makeFetch({ a: 2, b: 3 })
  const store = createDetailStore({ fetch, now: () => 1 })
  await store.request('a', { updatedAt: 1 })
  await store.request('b', { updatedAt: 1 })

  const absorbed = new Map<string, SessionDetail>()
  const failed: string[] = []
  seedReasoningDetails(
    store,
    ['a', 'b'],
    (id, detail) => absorbed.set(id, detail),
    (id) => failed.push(id),
  )

  assert.equal(absorbed.size, 2, '缓存里的两条都必须被播种进来')
  assert.equal(absorbed.get('a')?.reasoning?.length, 2)
  assert.equal(absorbed.get('b')?.reasoning?.length, 3)
  assert.deepEqual(failed, [], '成功的会话不得被记成失败')
  store.dispose()
})

test('缓存播种是纯读取：不触发任何 /detail，也不改变 store 状态', async () => {
  const { fetch, calls } = makeFetch({ a: 1 })
  const store = createDetailStore({ fetch, now: () => 1 })
  const absorbed = new Map<string, SessionDetail>()
  seedReasoningDetails(store, ['a'], (id, detail) => absorbed.set(id, detail), () => undefined)
  assert.deepEqual(calls, [], '未缓存时播种不得自己发请求（发请求是调用方的事）')
  assert.equal(absorbed.size, 0)

  await store.request('a', { updatedAt: 1 })
  const beforeCalls = calls.length
  const beforePeek = store.peek('a')
  seedReasoningDetails(store, ['a'], (id, detail) => absorbed.set(id, detail), () => undefined)
  assert.equal(calls.length, beforeCalls, '播种不得新增请求')
  assert.equal(store.peek('a'), beforePeek, '播种不得改动 entry 引用')
  assert.equal(absorbed.size, 1)
  store.dispose()
})

test('读完失败（无旧数据）的会话被记为失败，不冒充"没有记录"', async () => {
  const { fetch } = makeFetch({ a: 1 })
  const store = createDetailStore({ fetch, now: () => 1 })
  await store.request('a', { updatedAt: 1 })
  await store.request('missing', { updatedAt: 1 })

  const absorbed = new Map<string, SessionDetail>()
  const failed: string[] = []
  seedReasoningDetails(
    store,
    ['a', 'missing', 'never-requested'],
    (id, detail) => absorbed.set(id, detail),
    (id) => failed.push(id),
  )

  assert.equal(absorbed.size, 1, '只有 a 有数据')
  assert.deepEqual(failed, ['missing'], '读失败且无旧数据的会话必须被点名；未请求过的不算失败')
  store.dispose()
})

test('回归：命中缓存的场景下，缓存∪通知 与 冷启动场景拿到同样多的数据', async () => {
  /* 冷启动：subscribe → request，靠通知收齐。 */
  const cold = makeFetch({ a: 2, b: 3 })
  const coldStore = createDetailStore({ fetch: cold.fetch, now: () => 1 })
  const coldAbsorbed = new Map<string, SessionDetail>()
  coldStore.subscribe((id, entry) => {
    if (entry.detail !== undefined) coldAbsorbed.set(id, entry.detail)
  })
  await Promise.all([coldStore.request('a', { updatedAt: 1 }), coldStore.request('b', { updatedAt: 1 })])
  assert.equal(coldAbsorbed.size, 2, '冷启动应靠通知收齐')

  /* 已预热：同样的动作，靠播种收齐（修复前这里是 0）。 */
  const warm = makeFetch({ a: 2, b: 3 })
  const warmStore = createDetailStore({ fetch: warm.fetch, now: () => 1 })
  await warmStore.request('a', { updatedAt: 1 })
  await warmStore.request('b', { updatedAt: 1 })
  const warmAbsorbed = new Map<string, SessionDetail>()
  warmStore.subscribe((id, entry) => {
    if (entry.detail !== undefined) warmAbsorbed.set(id, entry.detail)
  })
  seedReasoningDetails(
    warmStore,
    ['a', 'b'],
    (id, detail) => warmAbsorbed.set(id, detail),
    () => undefined,
  )
  await Promise.all([warmStore.request('a', { updatedAt: 1 }), warmStore.request('b', { updatedAt: 1 })])

  assert.equal(warmAbsorbed.size, coldAbsorbed.size, '预热与冷启动必须拿到同样多的 detail（修复前预热是 0）')
  coldStore.dispose()
  warmStore.dispose()
})
