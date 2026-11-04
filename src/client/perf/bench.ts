/*
 * perf/bench.ts —— 星图布局与交互选择的可复现基准（04 §8；06 A44-3）。
 *
 * 只测**纯计算**（不含 React 渲染），这样基准在 node 里稳定可跑、不依赖浏览器：
 *   layout  = `layoutMap(600 节点)`     —— 预算 150ms
 *   prepare = `prepareEdges(4000 条边)` —— 边去重/收拢（预算同布局，单列报告）
 *   select  = `selectVisibleEdges` + 邻居集 —— 每次 hover/选中重绘的纯计算，预算 16ms
 *
 * 合成数据是确定性的（同一 seed 同一形状），边用共享层的 `createEdge` + `coTurnEvidence`
 * 生成 —— 不手写证据文案，避免第二份模板。
 *
 * 纪律：`bench()` 只测量、不判定"通过"；判定在 `checkBench()` 里按 `PERF_BUDGET` 做，
 * 未达标就是 FAIL（不许调宽预算）。
 */
import type { FileFamily, FileNode } from '../../shared/events/index.ts'
import { coTurnEvidence, createEdge, type GraphEdge } from '../../shared/relations/index.ts'
import { layoutMap, prepareEdges, selectVisibleEdges } from '../ui/map/index.ts'
import { PERF_BUDGET, checkBudget, type BudgetCheck } from './budget.ts'
import { measureSync, median, minimum } from './timing.ts'

const FAMILIES: readonly FileFamily[] = ['doc', 'code', 'data', 'image', 'config', 'other']
const EXTENSIONS: Record<FileFamily, string> = {
  doc: '.md',
  code: '.ts',
  data: '.json',
  image: '.png',
  config: '.yml',
  other: '.txt',
}

/** 基准时间原点（固定值，保证每次合成数据完全相同；不读系统时间）。 */
const BASE_TIME = 1_700_000_000_000

/** 造 n 个确定性 FileNode（路径分散到 12 个顶层目录，ops 呈梯形分布）。 */
export function makeSyntheticFiles(count: number): FileNode[] {
  const files: FileNode[] = []
  for (let index = 0; index < count; index += 1) {
    const family = FAMILIES[index % FAMILIES.length]
    const top = 'area' + String(index % 12).padStart(2, '0')
    const sub = 'sub' + String(index % 7)
    const path = top + '/' + sub + '/file-' + String(index) + EXTENSIONS[family]
    const ops = (index % 40) + 1
    files.push({
      path,
      name: 'file-' + String(index) + EXTENSIONS[family],
      dir: top + '/' + sub,
      family,
      firstAt: BASE_TIME + index * 1000,
      lastAt: BASE_TIME + (count - index) * 1000,
      reads: ops - 1,
      writes: index % 3,
      searches: index % 5,
      added: index % 60,
      removed: index % 7,
      ops,
      sessionIds: ['s-' + String(index % 20)],
      sessionCount: 1 + (index % 4),
      turnCount: 1 + (index % 9),
    })
  }
  return files
}

/**
 * 造 n 条确定性 coTurn 边。
 * 用固定种子的线性同余（LCG）挑端点，避免"固定步长"导致大量重复被去重成几百条；
 * 这样 4000 条输入真的会压到 `prepareEdges` 的去重/每节点 12 条收拢逻辑上。
 */
export function makeSyntheticEdges(files: readonly FileNode[], count: number): GraphEdge[] {
  if (files.length < 2) return []
  const edges: GraphEdge[] = []
  const seen = new Set<string>()
  let state = 1_234_567_891
  const nextIndex = (modulo: number): number => {
    // 用高位缩放取 [0, modulo)：LCG 的低位周期短，直接取模会把端点挤到少数几对
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648
    return Math.floor((state / 2_147_483_648) * modulo)
  }
  let attempt = 0
  const maxAttempts = count * 6
  while (edges.length < count && attempt < maxAttempts) {
    attempt += 1
    const fromFile = files[nextIndex(files.length)]
    const toFile = files[nextIndex(files.length)]
    if (fromFile.path === toFile.path) continue
    const edge = createEdge({
      type: 'coTurn',
      from: fromFile.path,
      to: toFile.path,
      weight: (attempt % 5) + 1,
      evidence: coTurnEvidence({
        samples: [{ sessionId: 's-' + String(attempt % 20), turn: (attempt % 30) + 1 }],
        count: (attempt % 5) + 1,
      }),
    })
    if (seen.has(edge.id)) continue
    seen.add(edge.id)
    edges.push(edge)
  }
  return edges
}

export interface BenchOptions {
  nodes?: number
  edges?: number
  /** 每项测几轮（取中位数）。 */
  runs?: number
  /** select 每轮重复几次（它很快，多跑几次才稳定）。 */
  selectIterations?: number
}

export interface BenchTiming {
  layoutMs: number
  prepareMs: number
  selectMs: number
}

export interface BenchResult {
  nodes: number
  edges: number
  runs: number
  selectIterations: number
  /** 中位数（报告口径）。 */
  median: BenchTiming
  /** 最好一次（看波动）。 */
  best: BenchTiming
  samples: { layoutMs: number[]; prepareMs: number[]; selectMs: number[] }
  /** 实际参与布局的节点 / 收拢后的边（上限生效的证据）。 */
  laidOutNodes: number
  preparedEdges: number
  budget: { layoutMs: number; selectMs: number; prepareMs: number }
}

/** 跑基准（纯计算；不打印、不写文件）。 */
export function bench(options: BenchOptions = {}): BenchResult {
  const nodeCount = options.nodes ?? PERF_BUDGET.maxNodes
  const edgeCount = options.edges ?? PERF_BUDGET.maxEdges
  const runs = options.runs ?? 3
  const selectIterations = options.selectIterations ?? 20

  const files = makeSyntheticFiles(nodeCount)
  const edges = makeSyntheticEdges(files, edgeCount)

  const layoutSamples: number[] = []
  const prepareSamples: number[] = []
  const selectSamples: number[] = []
  let laidOutNodes = 0
  let preparedEdges = 0

  for (let run = 0; run < runs; run += 1) {
    const layout = measureSync(() => layoutMap(files))
    laidOutNodes = layout.value.shown
    layoutSamples.push(layout.ms)

    const prepared = measureSync(() => prepareEdges(edges))
    preparedEdges = prepared.value.edges.length
    prepareSamples.push(prepared.ms)

    // 交互：一次 hover/选中后的可见边与邻居集（每轮多跑几次取中位数）
    const perIteration: number[] = []
    const focusPath = files[files.length - 1].path.toLowerCase()
    for (let iteration = 0; iteration < selectIterations; iteration += 1) {
      const measured = measureSync(() =>
        selectVisibleEdges(prepared.value, { focus: { key: focusPath } }),
      )
      perIteration.push(measured.ms)
    }
    selectSamples.push(median(perIteration))
  }

  return {
    nodes: nodeCount,
    edges: edgeCount,
    runs,
    selectIterations,
    median: {
      layoutMs: median(layoutSamples),
      prepareMs: median(prepareSamples),
      selectMs: median(selectSamples),
    },
    best: {
      layoutMs: minimum(layoutSamples),
      prepareMs: minimum(prepareSamples),
      selectMs: minimum(selectSamples),
    },
    samples: { layoutMs: layoutSamples, prepareMs: prepareSamples, selectMs: selectSamples },
    laidOutNodes,
    preparedEdges,
    budget: {
      layoutMs: PERF_BUDGET.layoutMs,
      prepareMs: PERF_BUDGET.layoutMs,
      selectMs: PERF_BUDGET.interactionMs,
    },
  }
}

export interface BenchVerdict {
  checks: BudgetCheck[]
  pass: boolean
  failedNames: string[]
}

/** 按 04 §8 判定（未达标 = FAIL，附超出比例，供优化排期；不调宽预算）。 */
export function checkBench(result: BenchResult): BenchVerdict {
  const checks = [
    checkBudget('星图布局 ' + result.nodes + ' 节点', result.median.layoutMs, PERF_BUDGET.layoutMs, 'ms'),
    checkBudget('边收拢 ' + result.edges + ' 条', result.median.prepareMs, PERF_BUDGET.layoutMs, 'ms'),
    checkBudget('hover/选中重绘', result.median.selectMs, PERF_BUDGET.interactionMs, 'ms'),
  ]
  const failedNames = checks.filter((check) => !check.pass).map((check) => check.name)
  return { checks, pass: failedNames.length === 0, failedNames }
}

/** 人类可读的基准报告（写进证据文件；只含数字与预算名，不含任何路径/正文）。 */
export function formatBenchReport(result: BenchResult): string[] {
  const verdict = checkBench(result)
  const line = (label: string, timing: BenchTiming): string =>
    label +
    ' layout=' + timing.layoutMs.toFixed(2) + 'ms' +
    ' prepare=' + timing.prepareMs.toFixed(2) + 'ms' +
    ' select=' + timing.selectMs.toFixed(2) + 'ms'
  const lines = [
    'bench: nodes=' + String(result.nodes) + ' (laidOut=' + String(result.laidOutNodes) + ')' +
      ' edges=' + String(result.edges) + ' (prepared=' + String(result.preparedEdges) + ')' +
      ' runs=' + String(result.runs) + ' selectIterations=' + String(result.selectIterations),
    line('median', result.median),
    line('best  ', result.best),
    'budget: layout<=' + String(result.budget.layoutMs) + 'ms select<=' + String(result.budget.selectMs) + 'ms',
  ]
  for (const check of verdict.checks) {
    lines.push(
      (check.pass ? 'PASS' : 'FAIL') + ' ' + check.name + ': ' + check.measured.toFixed(2) + check.unit +
        ' / 预算 ' + String(check.budget) + check.unit +
        (check.pass ? '' : '（超 ' + (check.overBy * 100).toFixed(0) + '%）'),
    )
  }
  lines.push('verdict: ' + (verdict.pass ? 'PASS' : 'FAIL' + (verdict.failedNames.length > 0 ? ' (' + verdict.failedNames.join('; ') + ')' : '')))
  return lines
}
