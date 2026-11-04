/*
 * ui/timeline/index.ts —— 时间轴的唯一出口（T09 只从这里 import）。
 *
 * 纯展示组件 + 可单测的纯函数（范围/刻度/生长/播放推进/未加载区段）。
 */
export { ANNOUNCE_THROTTLE_MS, Timeline, type TimelineProps } from './Timeline.ts'
export {
  advancePlayhead,
  buildTicks,
  clampPlayhead,
  clampWindow,
  clipUnloadedRanges,
  cumulativeOpsAt,
  DAY_MS,
  floorToGranularity,
  formatTick,
  granularityFor,
  growthAt,
  HOUR_MS,
  maxTicksForWidth,
  MINUTE_MS,
  nextTick,
  playheadLabel,
  rangeContains,
  ratioToTime,
  startOfDay,
  timeToRatio,
  unloadedRangeAt,
  visiblePathsAt,
  windowEdgeLabels,
  windowForRange,
  type TickGranularity,
  type TickOptions,
  type TimeRange,
  type TimelineNode,
  type TimelineSession,
  type TimelineTick,
} from './scale.ts'
