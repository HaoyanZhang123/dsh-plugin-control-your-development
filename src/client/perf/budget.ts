/*
 * perf/budget.ts —— 性能预算常量与判定（04 §8；06 A44-3）。
 *
 * 单一事实源：数值只在 `PERF_BUDGET` 里写一次，基准脚本、UI 的"已收拢/已截断"提示、
 * 测试断言都引用它。**不许为了变绿把数字调宽**（A44-3 明确要求：未达标就写 FAIL + 优化证据）。
 *
 * 与 04 §8 的一处口径说明：tab 首屏预算是 **< 1.5s**（04 §8 原文），T10 任务卡的"< 2s"是放宽口径；
 * 这里取严（1500ms），并在 `PERF_BUDGET_NOTE` 里写明，避免以后有人按 2s 论证"达标"。
 */

/** 04 §8 的性能预算（毫秒/字节/数量）。 */
export const PERF_BUDGET = {
  /** tab 首屏可用（当前会话数据）。 */
  firstUsableMs: 1500,
  /** 星图布局：600 节点 / 4000 边。 */
  layoutMs: 150,
  /** 交互（hover/选中重绘）。 */
  interactionMs: 16,
  /** snapshot 首包。 */
  snapshotFirstBytes: 8 * 1024 * 1024,
  snapshotFirstMs: 300,
  /** snapshot 增量。 */
  snapshotDeltaBytes: 200 * 1024,
  snapshotDeltaMs: 100,
  /** detail 单会话（大会话）。 */
  detailMs: 1000,
  detailLargeMs: 3000,
  /** 引用解析单文件。 */
  referenceParseMs: 300,
  /** 内存增量（MB）。 */
  memoryMb: 150,
  /** 全工作区扫描（267 会话）。 */
  scanMs: 60000,
  /** 扫描过程中让出 CPU 的粒度。 */
  scanYieldMs: 50,
  /** 轮询（前台 / 后台）。 */
  pollMs: 400,
  pollBackgroundMs: 2000,
  /** 渲染上限。 */
  maxNodes: 600,
  maxEdges: 4000,
} as const

/** 预算口径说明（写进证据，避免"2s 也算达标"的误读）。 */
export const PERF_BUDGET_NOTE =
  'tab 首屏按 04 §8 的 1.5s（T10 任务卡的 2s 是放宽口径，这里取严）；星图布局/交互按合成基准实测。'

export type BudgetKey = keyof typeof PERF_BUDGET

export interface BudgetCheck {
  name: string
  measured: number
  budget: number
  unit: 'ms' | 'bytes' | 'MB' | 'count'
  /** 实测 ≤ 预算。 */
  pass: boolean
  /** 超出预算时的比例（1.4 = 超了 40%），用于优化排期。 */
  overBy: number
}

/** 单项判定（不抛错；判定结果由调用方决定怎么报）。 */
export function checkBudget(name: string, measured: number, budget: number, unit: BudgetCheck['unit']): BudgetCheck {
  const finite = Number.isFinite(measured) && measured >= 0
  const pass = finite && measured <= budget
  const overBy = budget > 0 && finite ? Math.max(0, measured / budget - 1) : 0
  return { name, measured: finite ? measured : Number.POSITIVE_INFINITY, budget, unit, pass, overBy }
}

export interface BudgetSummary {
  total: number
  passed: number
  failed: number
  failedNames: string[]
  pass: boolean
}

export function summarizeBudgets(checks: readonly BudgetCheck[]): BudgetSummary {
  const failedNames = checks.filter((check) => !check.pass).map((check) => check.name)
  return {
    total: checks.length,
    passed: checks.length - failedNames.length,
    failed: failedNames.length,
    failedNames,
    pass: failedNames.length === 0,
  }
}
