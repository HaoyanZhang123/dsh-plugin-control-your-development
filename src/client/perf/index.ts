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
  checkBench,
  formatBenchReport,
  makeSyntheticEdges,
  makeSyntheticFiles,
  type BenchOptions,
  type BenchResult,
  type BenchTiming,
  type BenchVerdict,
} from './bench.ts'
