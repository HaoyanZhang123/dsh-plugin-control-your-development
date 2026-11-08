/*
 * timeline/scale.ts —— 时间轴的纯函数：窗口 / 刻度 / 活跃度分桶 / 会话分层 / 播放头文本。
 *
 * 规范：03 §5（范围/刻度/播放头/回到现在）、33 §5（双轨：活跃度 + 会话分层）、03 §15（aria-live）。
 *
 * R12（2.2.0 重做，用户 2026-11-08 拍板「D · 双轨」）：
 * 旧的「生长带面积曲线」与「密集刻度」两条实现已整类删除（用户反馈「粗糙/丑陋」），
 * 现在时间轴只有一条执行路径：
 *   上轨 = 按时间分桶的 ops 柱状图   buildActivityTrack
 *   下轨 = 会话分层条（最多 4 行）   buildSessionLanes
 *   刻度 = 只有 start / middle / end 三个标签   buildScaleTicks
 *
 * 纪律：
 * - 不读时钟（now 由调用方给）、**不读真实 DOM 宽度**（宽度由调用方量好传入）、不用随机数
 *   → 同一输入同一输出，可单测 + 可复现截图；
 * - 桶数 = 把宽度按 8px 量化后取整（亚像素抖动不改桶数）；
 * - 会话行数 = min(4, 会话数)；同一会话永远落在同一行（贪心首次适配，排序后确定性）；
 * - 节点按 firstAt 出现，ops 按 samples（缺省 = 首现即全量）累计。
 */
import type { RangeKey } from '../shell/index.ts'

export const MINUTE_MS = 60 * 1000
export const HOUR_MS = 60 * MINUTE_MS
export const DAY_MS = 24 * HOUR_MS

/* ------------------------------------------------------------------ *
 * 0. 几何常量（组件与测试共用；CSS 里的对应像素值写死同名位置，改一处必须改两处）
 * ------------------------------------------------------------------ */

/** 时间轴**卡片**总高（= tokens.css 的 --tl-timeline-h；含上下各 1px 边框）。 */
export const TIMELINE_H = 104
/**
 * 轨道画布高 = 卡片高 - 上下边框（box-sizing: border-box）。
 * 所有轨道内的 y 坐标都相对于它，不是相对 TIMELINE_H —— 差这 2px 会让
 * 会话条与刻度标签互相压住（实测过：lanes 底部 90 > 刻度顶部 88）。
 */
export const TRACK_H = TIMELINE_H - 2
/** 上轨基线在轨道内的 y（px；基线下方没有内容，它就是上轨的下沿）。 */
export const ACTIVITY_BASE_Y = 46
/** 一个桶占的宽度（px）。桶数 = 量化后的宽度 / 这个值。 */
export const ACTIVITY_BIN_PX = 8
/** 柱宽 = 桶宽 × 这个系数（柱与柱之间留白，不做实心墙）。 */
export const ACTIVITY_BAR_WIDTH_FACTOR = 0.68
/** 柱高上限（px）：上轨顶部留出播放头标签行（14px），柱从基线往上长到这里。 */
export const ACTIVITY_BAR_MAX_H = 30
/** 非零 ops 的最小柱高（px）：1 次操作也要看得见。 */
export const ACTIVITY_BAR_MIN_H = 2
/** 柱透明度 = MIN + ratio × SPAN。 */
export const ACTIVITY_OPACITY_MIN = 0.25
export const ACTIVITY_OPACITY_SPAN = 0.65
/** 宽度未知（挂载前 / 无 ResizeObserver）时按这个宽度估桶数 → 首屏确定性。 */
export const DEFAULT_ACTIVITY_WIDTH = 640

/** 下轨第一行会话条在轨道内的 y（px）。 */
export const SESSION_LANE_TOP = 50
/** 下轨最多几行会话。 */
export const SESSION_LANE_MAX = 4
/** 会话行距（px）= 行高 6 + 间距 4。 */
export const SESSION_LANE_PITCH = 10
/** 会话条高度（px）。 */
export const SESSION_BAR_H = 6
/** 会话条最小可视宽度（占轨道比例）：零时长会话也给一点点宽度。 */
export const SESSION_MIN_RATIO = 0.006

/** 播放头标签的贴边翻转阈值（占轨道比例）：左右各留这么多就开始翻转。 */
export const PLAYHEAD_LABEL_EDGE = 0.15

/** 底部刻度只留几个标签（用户：不要密集刻度）。 */
export const SCALE_TICK_COUNT = 3
/** 底部刻度行高度（px，11px 字号 / 14px 行高）。 */
export const SCALE_TICK_H = 14
/** 底部刻度行在轨道内的 y（贴底）。 */
export const SCALE_TICK_TOP = TRACK_H - SCALE_TICK_H
/** 下轨可用高度（px）= 刻度行上沿 - 会话首行上沿；4 行会话必须放得下。 */
export const SESSION_LANE_BAND_H = SCALE_TICK_TOP - SESSION_LANE_TOP

/** 时间区间（闭区间，ms）。 */
export interface TimeRange {
  start: number
  end: number
}

/** 时间轴上的一个节点（从 T04 FileNode 映射而来；samples 可选，来自触碰记录）。 */
export interface TimelineNode {
  path: string
  firstAt: number
  lastAt: number
  /** 总操作数（截至 lastAt）。 */
  ops: number
  /** 每个时间点的累计 ops（可选；缺省按 firstAt 一次性给足 ops）。 */
  samples?: ReadonlyArray<{ at: number; ops: number }>
}

/** 会话（下轨分层条；标题只做 hover tooltip，不常驻显示）。 */
export interface TimelineSession {
  id: string
  title?: string
  start: number
  end?: number
  turns: number
}

/** 刻度粒度（03 §5：年/月/日/小时）。 */
export type TickGranularity = 'year' | 'month' | 'week' | 'day' | 'hour' | 'minute'

/* ------------------------------------------------------------------ *
 * 1. 窗口
 * ------------------------------------------------------------------ */

/** 范围窗口：默认「全部」= 数据的起止；其它范围以 now 为右界。 */
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

/* ------------------------------------------------------------------ *
 * 2. 刻度：只有 start / middle / end 三个标签，没有刻度线
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

/** 默认刻度文本（本地时区；年 2026、月 2026-11、周/日 11-04、时 14:00、分 14:05）。 */
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

/** 底部标签的对齐方式（首贴左、尾贴右、中间居中 → 都不越出容器）。 */
export type ScaleTickAlign = 'start' | 'center' | 'end'

/** 底部刻度标签（比例固定 0 / 0.5 / 1，不随宽度增减 → 确定性 + 不密集）。 */
export interface ScaleTick {
  /** 时间点（ms）。 */
  at: number
  /** 展示文本（默认本地时区）。 */
  label: string
  /** 轨道内比例位置：0 / 0.5 / 1。 */
  ratio: number
  /** 标签对齐方式。 */
  align: ScaleTickAlign
}

/**
 * 构造底部三个标签：start / middle / end。
 * 目标视觉（用户选定）：**没有刻度线、没有网格**，只有三个 11px 数字标签。
 * 文本复用 windowEdgeLabels()（首尾）与 formatTick()（中间），不另造格式化函数。
 */
export function buildScaleTicks(window: TimeRange, format?: (at: number, granularity: TickGranularity) => string): ScaleTick[] {
  const span = Math.max(1, window.end - window.start)
  const granularity = granularityFor(span)
  const edges =
    format === undefined ? windowEdgeLabels(window) : { start: format(window.start, granularity), end: format(window.end, granularity) }
  const middleAt = Math.round(window.start + span / 2)
  const middleLabel = (format ?? formatTick)(middleAt, granularity)
  return [
    { at: window.start, label: edges.start, ratio: 0, align: 'start' },
    { at: middleAt, label: middleLabel, ratio: 0.5, align: 'center' },
    { at: window.end, label: edges.end, ratio: 1, align: 'end' },
  ]
}

/* ------------------------------------------------------------------ *
 * 3. 上轨：活跃度柱（按时间分桶的 ops）
 * ------------------------------------------------------------------ */

/** 上轨一根柱。 */
export interface ActivityBar {
  /** 桶序号（0 = 窗口最左）。 */
  index: number
  /** 该桶内的操作数（= 各节点在此区间的累计增量之和）。 */
  ops: number
  /** ops / 全局最大桶 ops（0–1）。 */
  ratio: number
  /** 像素高度（ACTIVITY_BAR_MIN_H ≤ height ≤ ACTIVITY_BAR_MAX_H）。 */
  height: number
  /** 不透明度（0.25–0.90）。 */
  opacity: number
}

/** 上轨数据（纯函数输出，组件只摆位不计算）。 */
export interface ActivityTrack {
  /** 桶数（= 量化宽度 / 8px）。 */
  binCount: number
  /** 每个桶的 ops（长度 = binCount，含 0）。 */
  bins: number[]
  /** 最大桶 ops；全 0 时为 0。 */
  maxOps: number
  /** 只含 ops > 0 的柱（空数据 → 空数组，不造假柱子）。 */
  bars: ActivityBar[]
}

/**
 * 桶数：把宽度按 8px 量化后取整（确定性；宽度未知/为 0 时按 DEFAULT_ACTIVITY_WIDTH）。
 * 注意：这里**不读 DOM**，宽度必须由调用方量好传入。
 */
export function binCountForWidth(width: number, binPx: number = ACTIVITY_BIN_PX): number {
  const step = Number.isFinite(binPx) && binPx > 0 ? Math.floor(binPx) : ACTIVITY_BIN_PX
  const safe = Number.isFinite(width) && width > 0 ? width : DEFAULT_ACTIVITY_WIDTH
  return Math.max(1, Math.floor(safe / step))
}

/**
 * 上轨：把节点按时间分桶，桶内 ops = 各节点在此区间的累计增量之和。
 * 只用 cumulativeOpsAt 的差分 → 没有 samples 的节点「首现即全量」，有 samples 的按阶梯增长；
 * 窗口之前的累计被扣掉（只统计窗口内的操作）。
 * 空输入（没有节点）→ bars 为空数组，绝不补 0 高假柱子。
 */
export function buildActivityTrack(nodes: readonly TimelineNode[], window: TimeRange, binCount: number): ActivityTrack {
  const count = Math.max(1, Math.floor(Number.isFinite(binCount) && binCount > 0 ? binCount : 1))
  const span = Math.max(1, window.end - window.start)
  const bins: number[] = []
  for (let index = 0; index < count; index += 1) bins.push(0)

  for (const node of nodes) {
    // 从窗口**左侧一毫秒**起算：恰好落在窗口起点（或节点首现即起点）的 ops 也要计入，
    // 否则「首现即全量」的节点会把起点那一刻的 ops 整段吞掉。
    let previous = cumulativeOpsAt(node, window.start - 1)
    for (let index = 0; index < count; index += 1) {
      // 桶边界取整到 ms；最后一桶收到窗口右界上（不把尾巴算丢）。
      const edge = index + 1 === count ? window.end : Math.round(window.start + (span * (index + 1)) / count)
      const reached = cumulativeOpsAt(node, edge)
      if (reached > previous) {
        bins[index] += reached - previous
        previous = reached
      }
    }
  }

  let maxOps = 0
  for (const value of bins) if (value > maxOps) maxOps = value

  const bars: ActivityBar[] = []
  for (let index = 0; index < count; index += 1) {
    const ops = bins[index]
    if (ops <= 0) continue
    const ratio = maxOps === 0 ? 0 : ops / maxOps
    bars.push({
      index,
      ops,
      ratio,
      height: Math.max(ACTIVITY_BAR_MIN_H, Math.round(ratio * ACTIVITY_BAR_MAX_H)),
      opacity: Math.round((ACTIVITY_OPACITY_MIN + ratio * ACTIVITY_OPACITY_SPAN) * 1000) / 1000,
    })
  }
  return { binCount: count, bins, maxOps, bars }
}

/* ------------------------------------------------------------------ *
 * 4. 下轨：会话分层（最多 4 行）
 * ------------------------------------------------------------------ */

/** 下轨一条会话条。 */
export interface SessionLane {
  id: string
  title?: string
  /** 轮次数（hover tooltip 用）。 */
  turns: number
  /** 会话开始（ms，原值）。 */
  start: number
  /** 会话结束（ms；没有 end 时等于 start）。 */
  end: number
  /** 行号 0–3（0 = 最上面一行）。 */
  lane: number
  /** 左边界比例 0–1。 */
  leftRatio: number
  /** 宽度比例 0–1（至少 SESSION_MIN_RATIO，且不越出右界）。 */
  widthRatio: number
}

/** 会话占几行：0 条 → 0 行；否则 min(4, 条数)。 */
export function sessionLaneCount(sessionCount: number): number {
  const safe = Number.isFinite(sessionCount) ? Math.floor(sessionCount) : 0
  if (safe <= 0) return 0
  return Math.min(SESSION_LANE_MAX, safe)
}

/**
 * 会话分层：先按开始时间（同一时刻再按 id）排序，再贪心首次适配到空出来的行，
 * 四行都占着时落到「最早空出来」的那行（并列取行号小的）→ 同一输入永远同一行号。
 * 与窗口不相交的会话直接丢弃（不画看不到的东西）。
 */
export function buildSessionLanes(
  sessions: readonly TimelineSession[],
  window: TimeRange,
  laneCount: number = SESSION_LANE_MAX,
): SessionLane[] {
  const lanes = Math.max(0, Math.min(SESSION_LANE_MAX, Math.floor(Number.isFinite(laneCount) ? laneCount : 0)))
  const result: SessionLane[] = []
  if (lanes === 0) return result

  const visible = sessions.filter((session) => {
    const end = session.end === undefined ? session.start : Math.max(session.start, session.end)
    return end >= window.start && session.start <= window.end
  })
  if (visible.length === 0) return result

  const sorted = visible.slice().sort((left, right) => {
    if (left.start !== right.start) return left.start - right.start
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0
  })

  const laneEnds: number[] = []
  for (let index = 0; index < lanes; index += 1) laneEnds.push(-Infinity)

  for (const session of sorted) {
    const end = session.end === undefined ? session.start : Math.max(session.start, session.end)
    let lane = -1
    for (let index = 0; index < lanes; index += 1) {
      if (laneEnds[index] <= session.start) {
        lane = index
        break
      }
    }
    if (lane === -1) {
      lane = 0
      for (let index = 1; index < lanes; index += 1) if (laneEnds[index] < laneEnds[lane]) lane = index
    }
    laneEnds[lane] = end

    const left = timeToRatio(session.start, window)
    const right = timeToRatio(end, window)
    const width = Math.min(Math.max(SESSION_MIN_RATIO, right - left), Math.max(0, 1 - left))
    result.push({
      id: session.id,
      ...(session.title === undefined ? {} : { title: session.title }),
      turns: session.turns,
      start: session.start,
      end,
      lane,
      leftRatio: left,
      widthRatio: width,
    })
  }
  return result
}

/* ------------------------------------------------------------------ *
 * 5. 播放头：位置 + 唯一标签（贴边翻转）
 * ------------------------------------------------------------------ */

/** 播放头标签对齐：贴左 → start；贴右 → end；中间 → center。 */
export type PlayheadLabelAnchor = 'start' | 'center' | 'end'

/** 标签是否贴边翻转：由比例决定（确定性，与容器实际像素无关）。 */
export function playheadLabelAnchor(ratio: number): PlayheadLabelAnchor {
  const safe = Number.isFinite(ratio) ? ratio : 0
  if (safe <= PLAYHEAD_LABEL_EDGE) return 'start'
  if (safe >= 1 - PLAYHEAD_LABEL_EDGE) return 'end'
  return 'center'
}

/**
 * 播放头文本（aria-live / aria-valuetext / 顶部唯一标签共用）。
 * Q2：单写 HH:MM 会丢掉日期（跨天窗口里看起来像乱序），至少给到 MM-DD HH:MM；
 * 长窗口（年/月粒度）给完整日期。R12：全时间轴只显示这一处标签。
 */
export function playheadLabel(at: number, window: TimeRange): string {
  const span = window.end - window.start
  const granularity = granularityFor(span)
  if (granularity === 'year' || granularity === 'month') {
    const date = new Date(at)
    return String(date.getFullYear()) + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate())
  }
  return formatTick(at, 'day') + ' ' + formatTick(at, 'minute')
}

/** 窗口左/右标签（首尾刻度）。 */
export function windowEdgeLabels(window: TimeRange): { start: string; end: string } {
  const span = window.end - window.start
  const granularity = granularityFor(span)
  return { start: formatTick(window.start, granularity), end: formatTick(window.end, granularity) }
}

/* ------------------------------------------------------------------ *
 * 6. 累计 ops（上轨分桶的基石）
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
