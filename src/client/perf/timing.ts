/*
 * perf/timing.ts —— 轻量计时与 rAF 辅助（04 §8「超预算先优化：裁剪边、虚拟化列表、rAF、memo」）。
 *
 * 设计：不引第三方库、不依赖 DOM。浏览器里用 `performance.now()` + `requestAnimationFrame`，
 * node（基准脚本/单测）里退化为 `performance.now()` + `setTimeout(0)`，行为可预测、可测。
 */

/** 单调时钟（毫秒）。 */
export function nowMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') return performance.now()
  return Date.now()
}

export interface MeasureResult<T> {
  value: T
  ms: number
}

/** 同步测一段逻辑的耗时（不做预热、不抛错，异常照常抛出）。 */
export function measureSync<T>(fn: () => T): MeasureResult<T> {
  const start = nowMs()
  const value = fn()
  return { value, ms: nowMs() - start }
}

/** 取中位数（偶数个取中间两个的平均）；空数组返回 0。 */
export function median(values: readonly number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[middle]
  return (sorted[middle - 1] + sorted[middle]) / 2
}

/** 取最小值（用于报告"最好情况"，与中位数一起看波动）。 */
export function minimum(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((best, value) => (value < best ? value : best), Number.POSITIVE_INFINITY)
}

export interface TimelineEntry {
  name: string
  startMs: number
  ms: number
}

/**
 * 命名的分段计时器（`mark`/`measure` 的轻量替身；不用 PerformanceObserver）。
 * 只做内存记录：不写 storage、不发请求、不写 console。
 */
export interface Timeline {
  mark: (name: string) => number
  measure: (name: string) => number | null
  entries: () => readonly TimelineEntry[]
  reset: () => void
}

export function createTimeline(): Timeline {
  const marks = new Map<string, number>()
  const list: TimelineEntry[] = []
  return {
    mark: (name: string): number => {
      const at = nowMs()
      marks.set(name, at)
      return at
    },
    measure: (name: string): number | null => {
      const start = marks.get(name)
      if (start === undefined) return null
      const ms = nowMs() - start
      list.push({ name, startMs: start, ms })
      return ms
    },
    entries: () => list.slice(),
    reset: () => {
      marks.clear()
      list.length = 0
    },
  }
}

export type FrameScheduler = (callback: () => void) => () => void

/** 下一次帧回调；返回取消函数。没有 rAF 的环境退化为 `setTimeout(0)`。 */
export function scheduleFrame(callback: () => void): () => void {
  if (typeof requestAnimationFrame === 'function') {
    const handle = requestAnimationFrame(() => callback())
    return () => cancelAnimationFrame(handle)
  }
  const handle = setTimeout(callback, 0)
  return () => clearTimeout(handle)
}

/**
 * 把高频事件压到每帧最多一次（03 §5「播放头拖动时星图实时更新（节流到 rAF）」）。
 * 返回的 `cancel` 用于卸载清理。
 */
export function throttleFrame<T>(fn: (value: T) => void): { push: (value: T) => void; cancel: () => void } {
  let pending: { value: T } | null = null
  let cancelFrame: (() => void) | null = null
  return {
    push: (value: T): void => {
      pending = { value }
      if (cancelFrame !== null) return
      cancelFrame = scheduleFrame(() => {
        cancelFrame = null
        const next = pending
        pending = null
        if (next !== null) fn(next.value)
      })
    },
    cancel: (): void => {
      if (cancelFrame !== null) cancelFrame()
      cancelFrame = null
      pending = null
    },
  }
}
