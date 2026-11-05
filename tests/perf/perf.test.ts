/*
 * tests/perf/perf.test.ts —— A44-3：性能预算与基准（04 §8；06 A44-3）。
 *
 * 判据分三层：
 * 1. **预算常量**必须与 04 §8 对齐（防止有人悄悄调宽）；
 * 2. **判定函数**正反两面（超预算必须 FAIL，并且报出超出比例；预算为 0/负数/NaN 不许"蒙混过关"）；
 * 3. **实测基准**：600 节点 / 4000 条边的布局与 hover/选中重绘必须落在预算内 —— 实测是多少就报多少，
 *    未达标就是 FAIL，不改断言。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  PERF_BUDGET,
  PERF_BUDGET_NOTE,
  VIRTUALIZE_THRESHOLD,
  bench,
  checkBench,
  checkBudget,
  computeVirtualWindow,
  contentHeight,
  createTimeline,
  formatBenchReport,
  makeSyntheticEdges,
  makeSyntheticFiles,
  measureSync,
  median,
  minimum,
  nowMs,
  shouldVirtualize,
  summarizeBudgets,
  throttleFrame,
} from '../../src/client/perf/index.ts'

test('预算常量与 04 §8 一致（600/4000/150/16/1.5s/400/2000）', () => {
  assert.equal(PERF_BUDGET.maxNodes, 600)
  assert.equal(PERF_BUDGET.maxEdges, 4000)
  assert.equal(PERF_BUDGET.layoutMs, 150)
  assert.equal(PERF_BUDGET.interactionMs, 16)
  assert.equal(PERF_BUDGET.firstUsableMs, 1500, 'tab 首屏按 04 §8 的 1.5s（任务卡 2s 是放宽口径）')
  assert.equal(PERF_BUDGET.pollMs, 400)
  assert.equal(PERF_BUDGET.pollBackgroundMs, 2000)
  assert.equal(PERF_BUDGET.scanYieldMs, 50)
  assert.equal(PERF_BUDGET.scanMs, 60000)
  assert.equal(PERF_BUDGET.snapshotFirstBytes, 8 * 1024 * 1024)
  assert.equal(PERF_BUDGET.snapshotDeltaBytes, 200 * 1024)
  assert.equal(PERF_BUDGET.referenceParseMs, 300)
  assert.equal(PERF_BUDGET.memoryMb, 150)
  assert.match(PERF_BUDGET_NOTE, /1\.5s/)
})

test('预算判定：达标/超支/非法值三种情况，超支要报比例', () => {
  const ok = checkBudget('布局', 100, 150, 'ms')
  assert.equal(ok.pass, true)
  assert.equal(ok.overBy, 0)

  const over = checkBudget('布局', 300, 150, 'ms')
  assert.equal(over.pass, false)
  assert.equal(over.overBy, 1, '300/150 → 超 100%')

  assert.equal(checkBudget('x', 1, 150, 'ms').pass, true)
  assert.equal(checkBudget('x', 150, 150, 'ms').pass, true, '等于预算算达标')
  assert.equal(checkBudget('x', Number.NaN, 150, 'ms').pass, false, '测不到就当没过，不许当达标')
  assert.equal(checkBudget('x', -1, 150, 'ms').pass, false)
  assert.equal(checkBudget('x', 5, 0, 'ms').pass, false, '预算 0 时只有 0 达标')

  const summary = summarizeBudgets([ok, over, checkBudget('y', 5, 10, 'ms')])
  assert.equal(summary.total, 3)
  assert.equal(summary.failed, 1)
  assert.deepEqual(summary.failedNames, ['布局'])
  assert.equal(summary.pass, false)
})

test('虚拟化窗口：只算可见区间 + overscan，越界夹取，空集不崩', () => {
  const window = computeVirtualWindow({ total: 1000, itemSize: 20, viewportSize: 200, scrollOffset: 0 })
  assert.deepEqual({ start: window.start, end: window.end, visible: window.visible }, { start: 0, end: 12, visible: 12 })
  assert.equal(window.offset, 0)
  assert.equal(window.size, 12 * 20)

  const middle = computeVirtualWindow({ total: 1000, itemSize: 20, viewportSize: 200, scrollOffset: 400 })
  assert.equal(middle.start, 18, '首可见行 20 - overscan 2')
  assert.equal(middle.end, 32)
  assert.equal(middle.offset, 18 * 20)

  const bottom = computeVirtualWindow({ total: 1000, itemSize: 20, viewportSize: 200, scrollOffset: 999_999 })
  assert.equal(bottom.end, 1000, '滚过头也不越界')
  assert.equal(bottom.offset + bottom.size, 20_000)

  const empty = computeVirtualWindow({ total: 0, itemSize: 20, viewportSize: 200, scrollOffset: 0 })
  assert.deepEqual({ start: empty.start, end: empty.end, visible: empty.visible }, { start: 0, end: 0, visible: 0 })
  assert.deepEqual(computeVirtualWindow({ total: 10, itemSize: 20, viewportSize: 0, scrollOffset: 0 }).visible, 0)

  assert.equal(VIRTUALIZE_THRESHOLD, 200)
  assert.equal(shouldVirtualize(201), true)
  assert.equal(shouldVirtualize(200), false)
  assert.equal(contentHeight(10, 20), 200)
  assert.equal(contentHeight(0, 20), 0)
  assert.equal(contentHeight(Number.NaN, 20), 0)
})

test('计时工具：中位数/最小值/同步测量/命名时间线', () => {
  assert.equal(median([]), 0)
  assert.equal(median([3]), 3)
  assert.equal(median([3, 1, 2]), 2)
  assert.equal(median([4, 1, 3, 2]), 2.5)
  assert.equal(minimum([]), 0)
  assert.equal(minimum([5, 2, 9]), 2)

  const measured = measureSync(() => 41 + 1)
  assert.equal(measured.value, 42)
  assert.ok(measured.ms >= 0)

  const timeline = createTimeline()
  assert.equal(timeline.measure('missing'), null, '没有 mark 时 measure 返回 null，不编造时间')
  timeline.mark('layout')
  const ms = timeline.measure('layout')
  assert.ok(ms !== null && ms >= 0)
  assert.equal(timeline.entries().length, 1)
  timeline.reset()
  assert.equal(timeline.entries().length, 0)
  assert.ok(nowMs() > 0)
})

test('rAF 节流：同一帧内多次 push 只执行一次；cancel 后不再执行', async () => {
  const seen: number[] = []
  const throttled = throttleFrame<number>((value) => seen.push(value))
  throttled.push(1)
  throttled.push(2)
  throttled.push(3)
  await new Promise((resolve) => setTimeout(resolve, 40))
  assert.deepEqual(seen, [3], '一帧只跑最后一次')

  throttled.push(4)
  throttled.cancel()
  await new Promise((resolve) => setTimeout(resolve, 40))
  assert.deepEqual(seen, [3], 'cancel 之后不再执行')
})

test('合成数据确定性：同样入参两次生成完全一致', () => {
  const a = makeSyntheticFiles(50)
  const b = makeSyntheticFiles(50)
  assert.deepEqual(a, b)
  const edgesA = makeSyntheticEdges(a, 120)
  const edgesB = makeSyntheticEdges(b, 120)
  assert.deepEqual(edgesA, edgesB)
  assert.equal(new Set(edgesA.map((edge) => edge.id)).size, edgesA.length, '边 id 必须唯一')
  assert.equal(edgesA.every((edge) => edge.evidence.kind === 'coTurn'), true)
})

test('A44-3 实测：600 节点 / 4000 条边的布局与重绘预算', () => {
  const result = bench()
  const report = formatBenchReport(result)
  for (const line of report) assert.equal(typeof line, 'string')

  assert.equal(result.nodes, 600)
  assert.equal(result.edges, 4000)
  // T31：文件关系图有 LOD 上限（目录 40）；bench 测的是"上限内实际布局的节点数"（600 输入被截到 40，
  // 边收口仍按 4000 原始边压）。节点上限的取舍见 33 §3。
  assert.equal(result.laidOutNodes, 40, '目录图上限 40（33 §3 + Lead 2026-11-05 复审）；超出显式截断')
  assert.ok(result.preparedEdges > 0 && result.preparedEdges <= PERF_BUDGET.maxEdges)

  const verdict = checkBench(result)
  const failed = verdict.checks.filter((check) => !check.pass)
  assert.deepEqual(
    failed.map((check) => check.name + '=' + check.measured.toFixed(2) + check.unit),
    [],
    '超出 04 §8 预算：' +
      failed
        .map((check) => check.name + ' ' + check.measured.toFixed(2) + check.unit + ' > ' + check.budget + check.unit)
        .join('; ') +
      ' —— 按 A44-3 要求写 FAIL 并给优化证据，不许调宽预算',
  )
  assert.equal(result.median.layoutMs <= PERF_BUDGET.layoutMs, true)
  assert.equal(result.median.selectMs <= PERF_BUDGET.interactionMs, true)
})

test('判定函数反向：把实测值换成超预算的数，必须 FAIL 并点名', () => {
  const result = bench({ nodes: 600, edges: 4000, runs: 1, selectIterations: 3 })
  const inflated = {
    ...result,
    median: { layoutMs: 999, prepareMs: 888, selectMs: 77 },
  }
  const verdict = checkBench(inflated)
  assert.equal(verdict.pass, false)
  assert.equal(verdict.failedNames.length, 3)
  assert.match(verdict.failedNames.join(' '), /星图布局/)
  assert.match(formatBenchReport(inflated).join('\n'), /FAIL/)
})
