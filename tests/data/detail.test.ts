/**
 * A20-2 / N-16 · 按需详情（04 §2.6 / §5.4）
 *
 * 断言：LRU 20、并发 ≤2、同 id 去重、partial/truncated 显式标记、
 * updatedAt 变化触发重拉、refresh 强制重拉、错误保留旧数据、generation 丢弃迟到响应。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createDetailStore } from '../../src/client/data/detail.ts'
import { CWD, NOW, createFakeFetch, createGate, detailPayload } from './fixtures.ts'

test('A20-2 详情并发 ≤2（04 §5.4）', async () => {
  const fake = createFakeFetch()
  const gate = createGate()
  fake.on('detail', async (body) => {
    await gate.wait()
    return detailPayload({ id: String(body.sessionId) })
  })
  const store = createDetailStore({ fetch: fake.fetch, now: () => NOW })
  const ids = ['s-1', 's-2', 's-3', 's-4', 's-5']
  const promises = ids.map((id) => store.request(id))
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  assert.equal(fake.maxActive, 2)
  assert.equal(store.inflight, 5)
  gate.openAll()
  const entries = await Promise.all(promises)
  assert.equal(fake.maxActive, 2)
  assert.equal(entries.every((entry) => entry.status === 'ready'), true)
  assert.equal(fake.callsOf('detail').length, 5)
  store.dispose()
})

test('A20-2 同 id 在途去重（只发一次）', async () => {
  const fake = createFakeFetch()
  const gate = createGate()
  fake.on('detail', async (body) => {
    await gate.wait()
    return detailPayload({ id: String(body.sessionId) })
  })
  const store = createDetailStore({ fetch: fake.fetch, now: () => NOW })
  const first = store.request('s-1')
  const second = store.request('s-1')
  assert.equal(first, second)
  gate.openAll()
  await first
  assert.equal(fake.callsOf('detail').length, 1)
  store.dispose()
})

test('A20-2 LRU 上限 20（04 §5.4）', async () => {
  const fake = createFakeFetch()
  fake.on('detail', (body) => detailPayload({ id: String(body.sessionId) }))
  const store = createDetailStore({ fetch: fake.fetch, now: () => NOW })
  for (let i = 0; i < 21; i += 1) {
    await store.request(`s-${i}`)
  }
  assert.equal(store.size, 20)
  assert.equal(store.peek('s-0'), undefined)
  assert.equal(store.peek('s-20')?.status, 'ready')
  store.dispose()
})

test('A20-2 partial / truncated 显式标记，不伪造完整', async () => {
  const fake = createFakeFetch()
  fake.on('detail', (body) =>
    detailPayload({
      id: String(body.sessionId),
      partial: true,
      truncated: { turns: true, filesPerTurn: true },
      running: true,
      status: 'running',
    }),
  )
  const store = createDetailStore({ fetch: fake.fetch, now: () => NOW })
  const entry = await store.request('s-live')
  assert.equal(entry.status, 'ready')
  assert.equal(entry.partial, true)
  assert.deepEqual(entry.truncated, { turns: true, filesPerTurn: true })
  assert.equal(entry.detail?.partial, true)
  assert.equal(entry.stale, false)
  store.dispose()
})

test('A20-2 updatedAt 变化才重拉；相同 updatedAt 命中缓存', async () => {
  const fake = createFakeFetch()
  fake.on('detail', (body) => detailPayload({ id: String(body.sessionId), updatedAt: NOW }))
  const store = createDetailStore({ fetch: fake.fetch, now: () => NOW })
  await store.request('s-1', { updatedAt: 100 })
  assert.equal(fake.callsOf('detail').length, 1)
  // 相同 updatedAt：直接缓存
  await store.request('s-1', { updatedAt: 100 })
  assert.equal(fake.callsOf('detail').length, 1)
  // updatedAt 变了（running 会话追加了新轮）：重拉
  await store.request('s-1', { updatedAt: 200 })
  assert.equal(fake.callsOf('detail').length, 2)
  const entry = store.peek('s-1')
  assert.equal(entry?.updatedAt, 200)
  store.dispose()
})

test('A20-2 refresh 强制重拉，request generation 带上', async () => {
  const fake = createFakeFetch()
  fake.on('detail', (body) => detailPayload({ id: String(body.sessionId), updatedAt: NOW }))
  const store = createDetailStore({ fetch: fake.fetch, now: () => NOW })
  store.setGeneration(7)
  await store.request('s-1', { updatedAt: 100 })
  await store.refresh('s-1', 100)
  const calls = fake.callsOf('detail')
  assert.equal(calls.length, 2)
  assert.equal(calls[1].body.refresh, true)
  assert.equal(calls[1].body.generation, 7)
  store.dispose()
})

test('T13e refresh 透传 cwd；setDefaultCwd 后续请求自动带上', async () => {
  const fake = createFakeFetch()
  fake.on('detail', (body) => detailPayload({ id: String(body.sessionId), updatedAt: NOW }))
  const store = createDetailStore({ fetch: fake.fetch, now: () => NOW })
  await store.refresh('s-1', 100, CWD)
  assert.equal(fake.callsOf('detail')[0].body.cwd, CWD)
  assert.equal(store.defaultCwd, '', 'refresh 的 cwd 只影响本次请求，不偷偷变成默认值')
  store.setDefaultCwd(CWD)
  await store.request('s-2')
  assert.equal(fake.callsOf('detail')[1].body.cwd, CWD)
  store.dispose()
})

test('A20-2 详情失败时保留旧数据并标 stale（不把失败当成功）', async () => {
  const fake = createFakeFetch()
  let failing = false
  fake.on('detail', (body) => {
    if (failing) return { ok: false, error: { code: 'threadline/session-unreadable', message: 'broken' } }
    return detailPayload({ id: String(body.sessionId), updatedAt: NOW })
  })
  const store = createDetailStore({ fetch: fake.fetch, now: () => NOW })
  await store.request('s-1', { updatedAt: 100 })
  assert.equal(store.peek('s-1')?.status, 'ready')

  failing = true
  const entry = await store.refresh('s-1', 200)
  assert.equal(entry.status, 'error')
  assert.equal(entry.error?.code, 'threadline/session-unreadable')
  assert.equal(entry.stale, true)
  assert.equal(entry.detail?.id, 's-1')
  store.dispose()
})

test('N-18 generation 切换后迟到响应被丢弃（不串数据）', async () => {
  const fake = createFakeFetch()
  const gate = createGate()
  fake.on('detail', async (body) => {
    await gate.wait()
    return detailPayload({ id: String(body.sessionId), cwd: CWD })
  })
  const store = createDetailStore({ fetch: fake.fetch, now: () => NOW })
  const pending = store.request('s-old')
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  store.setGeneration(1)
  gate.openAll()
  await pending
  // 旧 generation 的结果不该写进缓存
  assert.equal(store.peek('s-old'), undefined)
  assert.equal(store.size, 0)
  store.dispose()
})

test('A20-2 dispose 中止在途请求，后续 request 返回错误而不是挂起', async () => {
  const fake = createFakeFetch()
  const gate = createGate()
  fake.on('detail', async (body) => {
    await gate.wait()
    return detailPayload({ id: String(body.sessionId) })
  })
  const store = createDetailStore({ fetch: fake.fetch, now: () => NOW })
  const pending = store.request('s-1')
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  store.dispose()
  gate.openAll()
  const entry = await pending
  assert.equal(entry.status === 'error' || entry.status === 'idle' || entry.status === 'loading', true)
  const after = await store.request('s-2')
  assert.equal(after.status, 'error')
  store.dispose()
})
