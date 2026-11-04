/*
 * a11y/reducedMotion.ts —— reduced-motion 的检测与订阅（03 §15；06 N-13）。
 *
 * 纪律：
 * - 只读 `matchMedia`，**不写任何存储**（不把偏好记到 localStorage/cookie）；
 * - matchMedia 不可用（SSR / 测试环境）时安全降级为 `false`（不抛错、也不假装支持）；
 * - 组件用 `useReducedMotion()`，纯逻辑用 `readReducedMotion` / `subscribeReducedMotion`，
 *   两处共用同一份判断，不出现第二套。
 */
import * as React from 'react'

/** 查询串（与 tokens.css 里的 `@media (prefers-reduced-motion: reduce)` 同源口径）。 */
export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

/** matchMedia 返回对象的最小形状（只用到这些；便于测试注入假实现）。 */
export interface MediaQueryLike {
  matches: boolean
  addEventListener?: (type: 'change', listener: (event: { matches: boolean }) => void) => void
  removeEventListener?: (type: 'change', listener: (event: { matches: boolean }) => void) => void
  addListener?: (listener: (event: { matches: boolean }) => void) => void
  removeListener?: (listener: (event: { matches: boolean }) => void) => void
}

/** 只依赖 `matchMedia` 的最小环境（浏览器 window 满足它）。 */
export interface MediaEnv {
  matchMedia: (query: string) => MediaQueryLike
}

function mediaOf(env: MediaEnv | null | undefined): MediaQueryLike | null {
  if (!env || typeof env.matchMedia !== 'function') return null
  try {
    return env.matchMedia(REDUCED_MOTION_QUERY)
  } catch {
    return null
  }
}

/** 当前是否要求减少动效。环境不支持时返回 false。 */
export function readReducedMotion(env: MediaEnv | null | undefined): boolean {
  const media = mediaOf(env)
  return media !== null && media.matches === true
}

/** 订阅变化；返回取消订阅函数（调用两次也安全）。 */
export function subscribeReducedMotion(
  env: MediaEnv | null | undefined,
  listener: (reduced: boolean) => void,
): () => void {
  const media = mediaOf(env)
  if (!media) return () => undefined
  let done = false
  const handler = (event: { matches: boolean }): void => listener(event.matches === true)
  const unsubscribe = (): void => {
    if (done) return
    done = true
    if (typeof media.removeEventListener === 'function') media.removeEventListener('change', handler)
    else media.removeListener?.(handler)
  }
  if (typeof media.addEventListener === 'function') {
    media.addEventListener('change', handler)
    return unsubscribe
  }
  if (typeof media.addListener === 'function') {
    media.addListener(handler)
    return unsubscribe
  }
  return () => undefined
}

/** 生产约定：动效时长在 reduced-motion 下归零（03 §13.1）。 */
export function motionDuration(baseMs: number, reduced: boolean): number {
  if (!Number.isFinite(baseMs) || baseMs <= 0) return 0
  return reduced ? 0 : baseMs
}

/** React hook：首帧读一次，之后订阅（卸载时取消订阅）。 */
export function useReducedMotion(): boolean {
  const getEnv = (): MediaEnv | null => (typeof window === 'undefined' ? null : (window as unknown as MediaEnv))
  const [reduced, setReduced] = React.useState<boolean>(() => readReducedMotion(getEnv()))

  React.useEffect(() => {
    const env = getEnv()
    setReduced(readReducedMotion(env))
    return subscribeReducedMotion(env, setReduced)
  }, [])

  return reduced
}
