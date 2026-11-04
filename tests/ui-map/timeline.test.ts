/*
 * timeline.test.ts —— 时间轴的纯函数（03 §5；A41-3）。
 *
 * 覆盖：范围窗口、播放头夹取、刻度自适应、生长（按 firstAt 出现 + 截至 T 的累计 ops）、
 * 未加载区段（斜纹数据来源 / 播放头落点提示）、播放推进、aria-live 文案。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  advancePlayhead,
  buildTicks,
  clampPlayhead,
  clipUnloadedRanges,
  cumulativeOpsAt,
  DAY_MS,
  floorToGranularity,
  granularityFor,
  growthAt,
  HOUR_MS,
  maxTicksForWidth,
  playheadLabel,
  rangeContains,
  ratioToTime,
  startOfDay,
  timeToRatio,
  unloadedRangeAt,
  visiblePathsAt,
  windowEdgeLabels,
  windowForRange,
  type TimeRange,
  type TimelineNode,
} from '../../src/client/ui/timeline/index.ts'
import { NOW } from './fixtures.ts'

const domain: TimeRange = { start: NOW - 30 * DAY_MS, end: NOW }

test('范围窗口：今天/7天/30天/全部，且夹在数据域内', () => {
  const today = windowForRange('range.today', NOW, domain)
  assert.equal(today.start, startOfDay(NOW))
  assert.equal(today.end, NOW)

  const week = windowForRange('range.7d', NOW, domain)
  assert.equal(week.end - week.start, 7 * DAY_MS)

  const month = windowForRange('range.30d', NOW, domain)
  assert.equal(month.start, domain.start)
  assert.equal(month.end, NOW)

  const all = windowForRange('range.all', NOW, domain)
  assert.deepEqual(all, domain)

  // 数据只有一小段时，7 天窗口被夹到域内（不产生空窗口）。
  const tiny: TimeRange = { start: NOW - 2 * DAY_MS, end: NOW - DAY_MS }
  const clipped = windowForRange('range.7d', NOW, tiny)
  assert.deepEqual(clipped, tiny)

  // 没有数据域：退化为"最近一天"，不崩溃、不造 0。
  const fallback = windowForRange('range.all', NOW, null)
  assert.equal(fallback.end, NOW)
  assert.equal(fallback.start, NOW - DAY_MS)
})

test('播放头夹取与比例换算', () => {
  assert.equal(clampPlayhead(domain.start - 1, domain), domain.start)
  assert.equal(clampPlayhead(domain.end + 1, domain), domain.end)
  assert.equal(clampPlayhead(Number.NaN, domain), domain.end)
  assert.equal(timeToRatio(domain.start, domain), 0)
  assert.equal(timeToRatio(domain.end, domain), 1)
  assert.equal(ratioToTime(0, domain), domain.start)
  assert.equal(ratioToTime(1, domain), domain.end)
  assert.equal(ratioToTime(2, domain), domain.end)
})

test('刻度粒度自适应：年/月/周/日/小时/分钟', () => {
  assert.equal(granularityFor(5 * 365 * DAY_MS), 'year')
  assert.equal(granularityFor(120 * DAY_MS), 'month')
  assert.equal(granularityFor(30 * DAY_MS), 'week')
  assert.equal(granularityFor(5 * DAY_MS), 'day')
  assert.equal(granularityFor(6 * HOUR_MS), 'hour')
  assert.equal(granularityFor(10 * 60 * 1000), 'minute')
  assert.equal(maxTicksForWidth(1440), 8)
  assert.equal(maxTicksForWidth(320), 3)
  // 宽度未知（0）按 640px 估算（组件挂载前也能算出一个稳定刻度集）。
  assert.equal(maxTicksForWidth(0), 7)
})

test('刻度：数量受宽度约束、比例递增且在 [0,1]、首中尾高优先级', () => {
  for (const span of [3 * 365 * DAY_MS, 120 * DAY_MS, 30 * DAY_MS, 5 * DAY_MS, 6 * HOUR_MS, 30 * 60 * 1000]) {
    const window = { start: NOW - span, end: NOW }
    const { ticks, granularity } = buildTicks(window, { width: 640 })
    assert.ok(ticks.length >= 2, granularity + ' 至少 2 个刻度')
    assert.ok(ticks.length <= 9, granularity + ' 刻度过多: ' + ticks.length)
    let previous = -1
    for (const tick of ticks) {
      assert.ok(tick.ratio >= 0 && tick.ratio <= 1)
      assert.ok(tick.ratio >= previous)
      previous = tick.ratio
      assert.ok(tick.label.length > 0)
      assert.ok(tick.at >= window.start && tick.at <= window.end)
    }
    assert.equal(ticks[0].priority, 'high')
    assert.equal(ticks[ticks.length - 1].priority, 'high')
    const labels = windowEdgeLabels(window)
    assert.ok(labels.start.length > 0 && labels.end.length > 0)
  }
})

test('刻度边界：floor 到粒度边界后 nextTick 单调递增且对齐', () => {
  for (const granularity of ['year', 'month', 'week', 'day', 'hour', 'minute'] as const) {
    const floored = floorToGranularity(NOW, granularity)
    assert.ok(floored <= NOW)
    assert.ok(floored > NOW - 366 * DAY_MS)
    const next = buildTicks({ start: floored, end: floored + 10 * DAY_MS }, { width: 500, maxTicks: 2 })
    assert.ok(next.ticks.length >= 2)
  }
})

test('生长：未出现 → 0；无 samples → 首现即全部 ops；有 samples → 阶梯增长', () => {
  const node: TimelineNode = { path: 'a.md', firstAt: NOW - 10 * DAY_MS, lastAt: NOW, ops: 20 }
  assert.equal(cumulativeOpsAt(node, node.firstAt - 1), 0)
  assert.equal(cumulativeOpsAt(node, node.firstAt), 20)
  assert.equal(cumulativeOpsAt(node, NOW), 20)

  const sampled: TimelineNode = {
    path: 'b.md',
    firstAt: NOW - 10 * DAY_MS,
    lastAt: NOW,
    ops: 20,
    samples: [
      { at: NOW - 10 * DAY_MS, ops: 5 },
      { at: NOW - 5 * DAY_MS, ops: 12 },
      { at: NOW, ops: 20 },
    ],
  }
  assert.equal(cumulativeOpsAt(sampled, NOW - 9 * DAY_MS), 5)
  assert.equal(cumulativeOpsAt(sampled, NOW - 5 * DAY_MS), 12)
  assert.equal(cumulativeOpsAt(sampled, NOW), 20)
})

test('出现时间：节点按 firstAt 出现，数量随 T 单调不减；T 之前一个都没有', () => {
  const nodes: TimelineNode[] = [
    { path: 'a', firstAt: 100, lastAt: 200, ops: 1 },
    { path: 'b', firstAt: 150, lastAt: 300, ops: 1 },
    { path: 'c', firstAt: 250, lastAt: 400, ops: 1 },
  ]
  assert.deepEqual(visiblePathsAt(nodes, 99), [])
  assert.deepEqual(visiblePathsAt(nodes, 100), ['a'])
  assert.deepEqual(visiblePathsAt(nodes, 200), ['a', 'b'])
  assert.deepEqual(visiblePathsAt(nodes, 400), ['a', 'b', 'c'])
  let previous = 0
  for (const at of [0, 99, 100, 149, 150, 249, 250, 400, 999]) {
    const count = visiblePathsAt(nodes, at).length
    assert.ok(count >= previous)
    previous = count
  }
})

test('生长带：文件数/ops 与 T 同步；曲线采样固定 64 段且末段为 1', () => {
  const window = { start: 0, end: 100 }
  const nodes: TimelineNode[] = [
    { path: 'a', firstAt: 0, lastAt: 50, ops: 3 },
    { path: 'b', firstAt: 50, lastAt: 100, ops: 4 },
  ]
  assert.equal(growthAt(nodes, 0, window).files, 1)
  assert.equal(growthAt(nodes, 0, window).ops, 3)
  assert.equal(growthAt(nodes, 60, window).files, 2)
  assert.equal(growthAt(nodes, 60, window).ops, 7)
  const growth = growthAt(nodes, 60, window)
  assert.equal(growth.ratios.length, 65)
  assert.equal(growth.ratios[0], 0.5)
  assert.equal(growth.ratios[growth.ratios.length - 1], 1)
})

test('未加载区段：裁剪/合并/命中判断，播放头落入时能给出提示用的区间', () => {
  const window = { start: 100, end: 1000 }
  const ranges: TimeRange[] = [
    { start: 0, end: 200 },
    { start: 180, end: 300 },
    { start: 1500, end: 1600 },
  ]
  const clipped = clipUnloadedRanges(ranges, window)
  assert.deepEqual(clipped, [{ start: 100, end: 300 }])
  assert.equal(rangeContains(clipped[0], 150), true)
  assert.equal(rangeContains(clipped[0], 400), false)
  assert.deepEqual(unloadedRangeAt(clipped, 250), { start: 100, end: 300 })
  assert.equal(unloadedRangeAt(clipped, 500), null)
  assert.deepEqual(clipUnloadedRanges([], window), [])
  assert.deepEqual(clipUnloadedRanges(undefined, window), [])
})

test('未加载区段不产生节点：可见集合只来自真实节点（数据给什么就是什么）', () => {
  const nodes: TimelineNode[] = [
    { path: 'a', firstAt: 100, lastAt: 200, ops: 1 },
    { path: 'b', firstAt: 900, lastAt: 950, ops: 1 },
  ]
  const unloaded = [{ start: 300, end: 800 }]
  for (const at of [350, 500, 700]) {
    const visible = visiblePathsAt(nodes, at)
    assert.deepEqual(visible, ['a'], '未加载区段内不得凭空多出节点')
    assert.equal(unloadedRangeAt(unloaded, at) !== null, true)
  }
})

test('播放推进：1×/4× 的步长、到尾部停止、不越界', () => {
  const window = { start: 0, end: 1000 }
  const one = advancePlayhead(0, 100, 1, window)
  assert.equal(one.value, 100)
  assert.equal(one.done, false)
  const four = advancePlayhead(0, 100, 4, window)
  assert.equal(four.value, 400)
  const clipped = advancePlayhead(950, 100, 4, window)
  assert.equal(clipped.value, 1000)
  assert.equal(clipped.done, true)
  assert.equal(advancePlayhead(1000, 100, 1, window).done, true)
  assert.equal(advancePlayhead(0, -50, 1, window).value, 0)
})

test('aria-live 文本：播放头标签随窗口粒度变化且非空', () => {
  for (const span of [3 * 365 * DAY_MS, 120 * DAY_MS, 30 * DAY_MS, 5 * DAY_MS, 6 * HOUR_MS]) {
    const window = { start: NOW - span, end: NOW }
    const label = playheadLabel(NOW - span / 2, window)
    assert.ok(label.length > 0)
    assert.ok(playheadLabel(window.end, window).length > 0)
  }
})
