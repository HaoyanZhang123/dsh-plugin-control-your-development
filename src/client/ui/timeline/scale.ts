/*
 * timeline/scale.ts —— 时间轴的纯函数：范围、刻度、窗口过滤、播放推进、未加载区段。
 *
 * 规范：03 §5（范围/刻度/播放头/未加载/回到现在）、03 §14（窄容器刻度减少）、03 §15（aria-live）。
 * 纪律：
 * - 不读时钟（`now` 由调用方给），不写存储，不用随机数 → 同一输入同一输出，可单测 + 可复现截图；
 * - 未加载区段（`unloadedRanges`）是**记录层面**的事实：那里没有节点数据，
 *   本文件只负责"标出来 + 判断播放头是否落在里面"，绝不生成假节点；
 * - 节点按 `firstAt` 出现，大小按**截至 T 的累计 ops** 增长；没有 `samples` 时按"首现即全部 ops"
 *   计算（这是数据能给的全部，不额外编造中间过程）。
 */
import type { RangeKey } from '../shell/index.ts'

export const MINUTE_MS = 60 * 1000
export const HOUR_MS = 60 * MINUTE_MS
export const DAY_MS = 24 * HOUR_MS

/** 时间区间（闭区间，ms）。 */
export interface TimeRange {
  start: number
  end: number
}

/** 时间轴上的一个节点（从 T04 `FileNode` 映射而来；`samples` 可选，来自触碰记录）。 */
export interface TimelineNode {
  path: string
  firstAt: number
  lastAt: number
  /** 总操作数（截至 lastAt）。 */
  ops: number
  /** 每个时间点的累计 ops（可选；缺省按 firstAt 一次性给足 ops）。 */
  samples?: ReadonlyArray<{ at: number; ops: number }>
}

/** 会话刻度（会话开始/结束各一根小竖线）。 */
export interface TimelineSession {
  id: string
  title?: string
  start: number
  end?: number
  turns: number
}

/** 刻度粒度（03 §5：年/月/日/小时）。 */
export type TickGranularity = 'year' | 'month' | 'week' | 'day' | 'hour' | 'minute'

export interface TimelineTick {
  /** 时间点（ms）。 */
  at: number
  /** 展示文本（默认按本地时区格式化）。 */
  label: string
  /** 在窗口内的比例位置 0–1。 */
  ratio: number
  /** 窄容器只保留 high（03 §14：时间轴标签减少）。 */
  priority: 'high' | 'low'
}

export interface TickOptions {
  /** 容器宽度（px），用于决定保留多少个刻度。 */
  width?: number
  /** 最多刻度数（缺省按宽度算，3–8）。 */
  maxTicks?: number
  /** 自定义格式化（T09 可注入 locale 相关格式）。 */
  format?: (at: number, granularity: TickGranularity) => string
}

/** 范围窗口：默认「全部」= 数据的起止；其它范围以 `now` 为右界。 */
export function windowForRange(range: RangeKey, now: number, domain: TimeRange | null): TimeRange {
  const safeNow = Number.isFinite(now) ? now : 0
  if (domain === null || !Number.isFinite(domain.start) || !Number.isFinite(domain.end)) {
    return { start: safeNow - DAY_MS, end: safeNow }
  }
  const start = Math.min(domain.start, domain.end)
  const end = Math.max(domain.start, domain.end)
  switch (range) {
    case 'range.today': {
      const dayStart = startOfDay(safeNow)
      return clampWindow({ start: dayStart, end: safeNow }, { start, end })
    }
    case 'range.7d':
      return clampWindow({ start: safeNow - 7 * DAY_MS, end: safeNow }, { start, end })
    case 'range.30d':
      return clampWindow({ start: safeNow - 30 * DAY_MS, end: safeNow }, { start, end })
    case 'range.all':
    default:
      return { start, end }
  }
}

/** 把窗口夹在数据域内；窗口完全落在域外时退化为域本身（不造空窗口）。 */
export function clampWindow(window: TimeRange, domain: TimeRange): TimeRange {
  const start = Math.max(window.start, domain.start)
  const end = Math.min(window.end, domain.end)
  if (end <= start) return { start: domain.start, end: domain.end }
  return { start, end }
}

/** 本地时区的当天 0 点（「今天」范围）。 */
export function startOfDay(at: number): number {
  const date = new Date(at)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

/** 比例 → 时间。 */
export function ratioToTime(ratio: number, window: TimeRange): number {
  const span = Math.max(1, window.end - window.start)
  const clamped = Math.min(1, Math.max(0, Number.isFinite(ratio) ? ratio : 0))
  return Math.round(window.start + span * clamped)
}

/** 时间 → 比例（窗口外夹到 0/1）。 */
export function timeToRatio(at: number, window: TimeRange): number {
  const span = Math.max(1, window.end - window.start)
  return Math.min(1, Math.max(0, (at - window.start) / span))
}

/** 播放头夹到窗口内（03 §5：选择范围后播放头限制在范围内）。 */
export function clampPlayhead(at: number, window: TimeRange): number {
  if (!Number.isFinite(at)) return window.end
  return Math.min(window.end, Math.max(window.start, at))
}

/** 区间是否包含某时刻（闭区间）。 */
export function rangeContains(range: TimeRange, at: number): boolean {
  return at >= range.start && at <= range.end
}

/** 播放头是否落在某个未加载区段。 */
export function unloadedRangeAt(ranges: readonly TimeRange[] | undefined, at: number): TimeRange | null {
  if (!ranges) return null
  for (const range of ranges) if (rangeContains(range, at)) return range
  return null
}

/** 把未加载区段裁到当前窗口并合并重叠（确定性：按 start 排序）。 */
export function clipUnloadedRanges(ranges: readonly TimeRange[] | undefined, window: TimeRange): TimeRange[] {
  if (!ranges || ranges.length === 0) return []
  const clipped: TimeRange[] = []
  for (const range of ranges) {
    const start = Math.max(range.start, window.start)
    const end = Math.min(range.end, window.end)
    if (end > start) clipped.push({ start, end })
  }
  clipped.sort((left, right) => left.start - right.start || left.end - right.end)
  const merged: TimeRange[] = []
  for (const range of clipped) {
    const last = merged[merged.length - 1]
    if (last && range.start <= last.end) {
      last.end = Math.max(last.end, range.end)
    } else {
      merged.push({ ...range })
    }
  }
  return merged
}

/* ------------------------------------------------------------------ *
 * 1. 刻度
 * ------------------------------------------------------------------ */

/** 跨度 → 粒度（03 §5）。 */
export function granularityFor(span: number): TickGranularity {
  const abs = Math.max(1, span)
  if (abs >= 3 * 365 * DAY_MS) return 'year'
  if (abs >= 100 * DAY_MS) return 'month'
  if (abs >= 21 * DAY_MS) return 'week'
  if (abs >= 2 * DAY_MS) return 'day'
  if (abs >= 2 * HOUR_MS) return 'hour'
  return 'minute'
}

function pad2(value: number): string {
  return value < 10 ? '0' + value : String(value)
}

/** 默认刻度文本（本地时区；年 `2026`、月 `2026-11`、周/日 `11-04`、时 `14:00`、分 `14:05`）。 */
export function formatTick(at: number, granularity: TickGranularity): string {
  const date = new Date(at)
  switch (granularity) {
    case 'year':
      return String(date.getFullYear())
    case 'month':
      return date.getFullYear() + '-' + pad2(date.getMonth() + 1)
    case 'week':
    case 'day':
      return pad2(date.getMonth() + 1) + '-' + pad2(date.getDate())
    case 'hour':
      return pad2(date.getHours()) + ':00'
    case 'minute':
    default:
      return pad2(date.getHours()) + ':' + pad2(date.getMinutes())
  }
}

/** 把时刻对齐到粒度边界（向前）。 */
export function floorToGranularity(at: number, granularity: TickGranularity): number {
  const date = new Date(at)
  switch (granularity) {
    case 'year':
      return new Date(date.getFullYear(), 0, 1).getTime()
    case 'month':
      return new Date(date.getFullYear(), date.getMonth(), 1).getTime()
    case 'week': {
      const day = date.getDay()
      const mondayOffset = (day + 6) % 7
      const floored = new Date(date.getFullYear(), date.getMonth(), date.getDate())
      floored.setDate(floored.getDate() - mondayOffset)
      return floored.getTime()
    }
    case 'day':
      return startOfDay(at)
    case 'hour':
      return new Date(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours()).getTime()
    case 'minute':
    default:
      return new Date(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours(), date.getMinutes()).getTime()
  }
}

/** 下一个粒度边界（用于步进）。 */
export function nextTick(at: number, granularity: TickGranularity): number {
  const date = new Date(at)
  switch (granularity) {
    case 'year':
      return new Date(date.getFullYear() + 1, 0, 1).getTime()
    case 'month':
      return new Date(date.getFullYear(), date.getMonth() + 1, 1).getTime()
    case 'week':
      return at + 7 * DAY_MS
    case 'day':
      return at + DAY_MS
    case 'hour':
      return at + HOUR_MS
    case 'minute':
    default:
      return at + MINUTE_MS
  }
}

/** 最多保留的刻度数：按容器宽度（每个标签 ~88px），夹在 3–8。 */
export function maxTicksForWidth(width: number): number {
  const safe = Number.isFinite(width) && width > 0 ? width : 640
  return Math.min(8, Math.max(3, Math.floor(safe / 88)))
}

/**
 * 构造刻度：先按跨度选粒度，再按最多标签数放大步进（整除式放大，保证边界对齐）。
 * 首/中/尾标记为 high（窄容器只保留 high，03 §14）。
 */
export function buildTicks(window: TimeRange, options: TickOptions = {}): { granularity: TickGranularity; ticks: TimelineTick[] } {
  const span = Math.max(1, window.end - window.start)
  const granularity = granularityFor(span)
  const maxTicks = Math.max(2, options.maxTicks ?? maxTicksForWidth(options.width ?? 640))
  const format = options.format ?? formatTick

  // 先按 1 步长生成，再按 ceil(count / maxTicks) 倍步进。
  const raw: number[] = []
  let cursor = floorToGranularity(window.start, granularity)
  let guard = 0
  while (cursor <= window.end && guard < 512) {
    if (cursor >= window.start) raw.push(cursor)
    cursor = nextTick(cursor, granularity)
    guard += 1
  }
  if (raw.length === 0) raw.push(window.start)
  const stride = Math.max(1, Math.ceil(raw.length / maxTicks))
  const kept = raw.filter((_, index) => index % stride === 0)
  if (kept[kept.length - 1] !== raw[raw.length - 1]) kept.push(raw[raw.length - 1])

  const ticks: TimelineTick[] = kept.map((at, index) => ({
    at,
    label: format(at, granularity),
    ratio: timeToRatio(at, window),
    priority: index === 0 || index === kept.length - 1 || index === Math.floor(kept.length / 2) ? 'high' : 'low',
  }))
  return { granularity, ticks }
}

/* ------------------------------------------------------------------ *
 * 2. 生长：按 firstAt 出现，按截至 T 的累计 ops 增长
 * ------------------------------------------------------------------ */

/** 截至 at 的累计 ops（有 samples 用 samples，否则首现即全部；未出现 = 0）。 */
export function cumulativeOpsAt(node: TimelineNode, at: number): number {
  if (at < node.firstAt) return 0
  const samples = node.samples
  if (!samples || samples.length === 0) return Math.max(0, node.ops)
  let total = 0
  for (const sample of samples) if (sample.at <= at) total = Math.max(total, sample.ops)
  return Math.max(0, total)
}

/** 截至 at 已出现的文件（按 firstAt 过滤；未加载区段没有数据，自然不会被造出来）。 */
export function visiblePathsAt(nodes: readonly TimelineNode[], at: number): string[] {
  const result: string[] = []
  for (const node of nodes) if (node.firstAt <= at) result.push(node.path)
  return result
}

/** 截至 at 的生长条数据（累计文件数 + 累计 ops）。 */
export function growthAt(nodes: readonly TimelineNode[], at: number, window: TimeRange): { files: number; ops: number; ratios: number[] } {
  let files = 0
  let ops = 0
  for (const node of nodes) {
    if (node.firstAt <= at) files += 1
    ops += cumulativeOpsAt(node, at)
  }
  // 生长曲线采样：固定 64 段（确定性），首现时刻之后线性累加节点数。
  const samples = 64
  const ratios: number[] = []
  const sorted = nodes.slice().sort((left, right) => left.firstAt - right.firstAt)
  for (let index = 0; index <= samples; index += 1) {
    const time = window.start + ((window.end - window.start) * index) / samples
    let count = 0
    for (const node of sorted) if (node.firstAt <= time) count += 1
    ratios.push(count / Math.max(1, sorted.length))
  }
  return { files, ops, ratios }
}

/** 播放头推进：dt 毫秒 × speed；到窗口尾部即停（返回 done=true）。 */
export function advancePlayhead(current: number, deltaMs: number, speed: number, window: TimeRange): { value: number; done: boolean } {
  const safeDelta = Number.isFinite(deltaMs) ? Math.max(0, deltaMs) : 0
  const safeSpeed = Number.isFinite(speed) ? Math.max(0.1, speed) : 1
  const next = clampPlayhead(current + safeDelta * safeSpeed, window)
  return { value: next, done: next >= window.end }
}

/** 播放头文本（aria-live / aria-valuetext / tooltip 共用）。 */
export function playheadLabel(at: number, window: TimeRange): string {
  const span = window.end - window.start
  const granularity = granularityFor(span)
  if (granularity === 'year') return formatTick(at, 'month')
  if (granularity === 'month') return formatTick(at, 'day')
  if (granularity === 'week' || granularity === 'day') return formatTick(at, 'hour')
  return formatTick(at, 'minute')
}

/** 窗口左/右标签（首尾刻度）。 */
export function windowEdgeLabels(window: TimeRange): { start: string; end: string } {
  const span = window.end - window.start
  const granularity = granularityFor(span)
  return { start: formatTick(window.start, granularity), end: formatTick(window.end, granularity) }
}
