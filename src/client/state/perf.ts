/*
 * state/perf.ts —— 入口的性能打点与列表虚拟化（T10 提供工具，T09 接线）。
 *
 * - `first-usable`：tab 首次把数据渲染出来时打点（只记录在内存里，不写文件、不发网络、不打 console）；
 * - `listWindow`：列表行数超过阈值时用 `computeVirtualWindow` 只渲染可见区间（04 §8；>200 行）。
 */
import { computeVirtualWindow, createTimeline, shouldVirtualize, type Timeline, type TimelineEntry, type VirtualWindow } from '../perf/index.ts'

/** 进程内唯一时间线（只读诊断；卸载时 reset）。 */
const timeline: Timeline = createTimeline()

/** tab 首次可用时打点（幂等：重复调用只更新同一个 mark）。 */
export function markFirstUsable(): number {
  return timeline.mark('first-usable')
}

/** 测量 first-usable 到现在的时间（诊断/证据用）。 */
export function measureFirstUsable(): number | null {
  return timeline.measure('first-usable')
}

/** 已记录的分段（证据脚本可读；不含正文）。 */
export function perfEntries(): readonly TimelineEntry[] {
  return timeline.entries()
}

/** 清空（卸载/测试复位）。 */
export function resetPerf(): void {
  timeline.reset()
}

/** 列表单行高度（px；与 CSS 的紧凑行高一致）。 */
export const LIST_ROW_HEIGHT = 26

/** 是否该虚拟化（>200 行）。 */
export function listNeedsVirtualization(rows: number): boolean {
  return shouldVirtualize(rows)
}

/** 视口内应渲染的区间（不虚拟化时返回全量窗口）。 */
export function listWindow(total: number, scrollOffset: number, viewportSize: number): VirtualWindow {
  if (!listNeedsVirtualization(total)) {
    return { start: 0, end: total, offset: 0, size: total * LIST_ROW_HEIGHT, total, visible: total }
  }
  return computeVirtualWindow({ total, itemSize: LIST_ROW_HEIGHT, viewportSize, scrollOffset, overscan: 4 })
}
