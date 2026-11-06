/**
 * T37 · 共享 detail store 单例 + 可观测计数器（`state/detailStore.ts` 的接线）。
 *
 * 断言两件事：
 * - 同一 fetch 身份永远是**同一个 store**（三个入口/tab/预热共享同一份缓存 → tab 打开命中缓存的前提）；
 * - `detailStoreStats()` 能读到计数器（数字/错误码，不含路径/正文），供真机排查与测试用。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  detailStoreStats,
  disposeDetailStore,
  getDetailStore,
  hasDetailStore,
} from '../../src/client/state/detailStore.ts'
import { disposeAllWarmups } from '../../src/client/data/warmup.ts'
import { CWD, NOW, createFakeFetch, detailPayload } from './fixtures.ts'

test('T37 共享 store：同一 fetch 单例、stats 可读、dispose 后归零', async () => {
  disposeAllWarmups()
  disposeDetailStore()
  assert.equal(hasDetailStore(), false)
  assert.equal(detailStoreStats(), undefined)

  const fake = createFakeFetch()
  fake.on('detail', (body) => detailPayload({ id: String(body.sessionId), updatedAt: NOW }))
  const store = getDetailStore(fake.fetch)
  // 同一 fetch 身份 → 同一实例（tab/impact/warmup 共享缓存的前提）
  assert.equal(getDetailStore(fake.fetch), store)
  assert.equal(hasDetailStore(), true)
  assert.deepEqual(detailStoreStats(), { requests: 0, hits: 0, deduped: 0, fetches: 0, errors: 0 })

  await store.request('s-1', { cwd: CWD, updatedAt: NOW })
  const stats = detailStoreStats()
  assert.equal(stats?.requests, 1)
  assert.equal(stats?.fetches, 1)

  // 另一个 fetch 身份 → 换新实例（旧缓存不串工作区/措辞），stats 归零
  const other = createFakeFetch()
  other.on('detail', (body) => detailPayload({ id: String(body.sessionId), updatedAt: NOW }))
  const replaced = getDetailStore(other.fetch)
  assert.notEqual(replaced, store)
  assert.equal(detailStoreStats()?.fetches, 0)
  assert.equal(JSON.stringify(detailStoreStats()).includes('s-1'), false, '计数器不含 sessionId')

  disposeDetailStore()
  assert.equal(hasDetailStore(), false)
  assert.equal(detailStoreStats(), undefined)
  disposeAllWarmups()
})
