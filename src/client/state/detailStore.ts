/*
 * state/detailStore.ts —— 三个入口共享的**同一份**详情缓存（04 §5.4；LRU 20 / 并发 ≤2 由 T04 实现）。
 *
 * 为什么共享：tab、每轮影响、弹窗都会读同一会话的 detail；各建一个 store 会重复请求，
 * 也让"正在读取/失败"三态在不同入口不一致。这里只做「按 fetch 身份单例化 + 统一 dispose」。
 *
 * T13e：创建后把实例注册给 `data/warmup`，让页面级预热与三个入口共享同一份缓存
 * （否则预热取到的 detail 在弹窗里看不到，会重复请求）。内存态，无持久化。
 */
import { createDetailStore, registerWarmupDetailStore, type DetailStore, type FetchLike } from '../data/index.ts'

let current: DetailStore | null = null
let currentFetch: FetchLike | null = null

/** 取共享 store（fetch 变化时换新实例并释放旧的；同一 fetch 永远同一个 store）。 */
export function getDetailStore(fetch: FetchLike): DetailStore {
  if (current === null || currentFetch !== fetch) {
    current?.dispose()
    current = createDetailStore({ fetch })
    currentFetch = fetch
    registerWarmupDetailStore(current)
  }
  return current
}

/** 释放共享 store（插件卸载时调用）。 */
export function disposeDetailStore(): void {
  registerWarmupDetailStore(null)
  current?.dispose()
  current = null
  currentFetch = null
}

/** 当前是否有 store（测试/诊断用）。 */
export function hasDetailStore(): boolean {
  return current !== null
}
