/*
 * perf/virtual.ts —— 虚拟化窗口的纯函数（04 §8「超预算先优化：虚拟化列表」）。
 *
 * 只算数学：给定总项数、单项高度、视口高度、滚动偏移与 overscan，
 * 返回应渲染的区间和该区间在总高度里的偏移。组件据此只渲染可见行。
 *
 * 不依赖 DOM；边界（total=0、视口为 0、偏移越界）都夹取，不抛错、不返回负下标。
 */

/** 超过这个条数就建议虚拟化（600 节点是渲染上限，列表行同理取同一量级）。 */
export const VIRTUALIZE_THRESHOLD = 200

export interface VirtualWindowInput {
  total: number
  /** 单项高度（px，>0）。 */
  itemSize: number
  /** 视口高度（px）。 */
  viewportSize: number
  /** 已滚动距离（px，>=0）。 */
  scrollOffset: number
  /** 上下各多渲染几项（防白边），默认 2。 */
  overscan?: number
}

export interface VirtualWindow {
  /** 起始下标（含）。 */
  start: number
  /** 结束下标（不含）。 */
  end: number
  /** 渲染区在总高度中的偏移（style: translateY）。 */
  offset: number
  /** 渲染区高度。 */
  size: number
  /** 总数（原样回传，便于组件算 `aria-rowcount`）。 */
  total: number
  /** 实际渲染的项数。 */
  visible: number
}

export function computeVirtualWindow(input: VirtualWindowInput): VirtualWindow {
  const total = Number.isFinite(input.total) ? Math.max(0, Math.floor(input.total)) : 0
  const itemSize = Number.isFinite(input.itemSize) && input.itemSize > 0 ? input.itemSize : 1
  const viewport = Number.isFinite(input.viewportSize) ? Math.max(0, input.viewportSize) : 0
  const overscan = Number.isFinite(input.overscan ?? 2) ? Math.max(0, Math.floor(input.overscan ?? 2)) : 2
  const maxOffset = Math.max(0, total * itemSize - viewport)
  const scrollOffset = Number.isFinite(input.scrollOffset) ? Math.min(Math.max(0, input.scrollOffset), maxOffset) : 0

  if (total === 0 || viewport === 0) {
    return { start: 0, end: 0, offset: 0, size: 0, total, visible: 0 }
  }

  const firstVisible = Math.floor(scrollOffset / itemSize)
  const lastVisible = Math.min(total - 1, Math.ceil((scrollOffset + viewport) / itemSize) - 1)
  const start = Math.max(0, firstVisible - overscan)
  const end = Math.min(total, lastVisible + 1 + overscan)
  return {
    start,
    end,
    offset: start * itemSize,
    size: Math.max(0, (end - start) * itemSize),
    total,
    visible: Math.max(0, end - start),
  }
}

/** 是否需要虚拟化（低于阈值就全量渲染，省掉一层复杂度）。 */
export function shouldVirtualize(count: number, threshold: number = VIRTUALIZE_THRESHOLD): boolean {
  return Number.isFinite(count) && count > threshold
}

/** 总内容高度（用于滚动容器的占位高度）。 */
export function contentHeight(total: number, itemSize: number): number {
  if (!Number.isFinite(total) || !Number.isFinite(itemSize) || total <= 0 || itemSize <= 0) return 0
  return Math.floor(total) * itemSize
}
