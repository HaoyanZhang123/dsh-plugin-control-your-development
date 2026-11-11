/*
 * perf/index.ts —— T10 性能层的唯一出口。
 *
 * 下游（T09 入口 / 地图 / 列表视图 / 证据脚本）只 import 这里：
 *   import { PERF_BUDGET, checkBudget, bench, checkBench, createTimeline, computeVirtualWindow } from '<plugin>/src/client/perf/index.ts'
 */
export {
  PERF_BUDGET,
  PERF_BUDGET_NOTE,
  checkBudget,
  summarizeBudgets,
  type BudgetCheck,
  type BudgetKey,
  type BudgetSummary,
} from './budget.ts'

export {
  createTimeline,
  measureSync,
  median,
  minimum,
  nowMs,
  scheduleFrame,
  throttleFrame,
  type FrameScheduler,
  type MeasureResult,
  type Timeline,
  type TimelineEntry,
} from './timing.ts'

export {
  VIRTUALIZE_THRESHOLD,
  computeVirtualWindow,
  contentHeight,
  shouldVirtualize,
  type VirtualWindow,
  type VirtualWindowInput,
} from './virtual.ts'

export {
  bench,
  benchBest,
  checkBench,
  formatBenchReport,
  makeSyntheticEdges,
  makeSyntheticFiles,
  type BenchOptions,
  type BenchResult,
  type BenchTiming,
  type BenchVerdict,
} from './bench.ts'

/* R06：无感加载的两件基础设施（同输入复用 + 边端点索引） */
export {
  buildEdgeEndpointIndex,
  createInputMemo,
  filterEdgesWithin,
  turnRelationCounts,
  type DetailLike,
  type EdgeEndpoint,
  type EdgeEndpointIndex,
  type InputMemo,
  type LowerEdge,
  type TurnLike,
} from './derived.ts'
