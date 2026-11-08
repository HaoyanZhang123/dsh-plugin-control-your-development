/*
 * timeline.test.ts —— 时间轴纯函数 + 双轨渲染契约（03 §5；33 §5；R12 2.2.0）。
 *
 * R12（用户 2026-11-08 拍板「D · 双轨」）覆盖：
 * - 窗口：今天 / 7天 / 30天 / 全部，且永远夹在数据域内；
 * - 上轨活跃度：桶数确定性（宽度 / 8px）、柱高单调（ops 大 → 柱高）、空数据不造假柱；
 * - 下轨会话分层：行数 = min(4, N)、行号确定性、窗口外会话被丢弃；
 * - 刻度：**只有 3 个**（start / middle / end），没有密集刻度；
 * - 播放头：位置换算 + 唯一标签 + 贴边翻转；
 * - 空数据（domain=null）：不渲染假柱子 / 假会话，不写说明文字；
 * - DOM 合约：role=slider + aria 完整、可点击定位、**零解释性小字**。
 *
 * R12 删除的旧能力（不再有用例，改由「已删除」负向断言守）：
 * buildTicks / maxTicksForWidth / nextTick / floorToGranularity / growthAt / visiblePathsAt。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  ACTIVITY_BAR_MAX_H,
  ACTIVITY_BASE_Y,
  ACTIVITY_BAR_MIN_H,
  ACTIVITY_BIN_PX,
  binCountForWidth,
  buildActivityTrack,
  buildScaleTicks,
  buildSessionLanes,
  clampPlayhead,
  clampWindow,
  cumulativeOpsAt,
  DAY_MS,
  DEFAULT_ACTIVITY_WIDTH,
  formatTick,
  granularityFor,
  HOUR_MS,
  PLAYHEAD_LABEL_EDGE,
  playheadLabel,
  playheadLabelAnchor,
  ratioToTime,
  SCALE_TICK_COUNT,
  SESSION_LANE_BAND_H,
  SESSION_LANE_MAX,
  SESSION_LANE_PITCH,
  SESSION_LANE_TOP,
  SESSION_BAR_H,
  SESSION_MIN_RATIO,
  sessionLaneCount,
  SCALE_TICK_H,
  SCALE_TICK_TOP,
  startOfDay,
  TIMELINE_H,
  TRACK_H,
  timeToRatio,
  windowEdgeLabels,
  windowForRange,
  Timeline,
  type TimeRange,
  type TimelineNode,
  type TimelineSession,
} from '../../src/client/ui/timeline/index.ts'
import { NOW } from './fixtures.ts'

const h = React.createElement
const domain: TimeRange = { start: NOW - 30 * DAY_MS, end: NOW }

/* ------------------------------------------------------------------ *
 * 1. 窗口
 * ------------------------------------------------------------------ */

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
  assert.deepEqual(windowForRange('range.7d', NOW, tiny), tiny)

  // 没有数据域：退化为"最近一天"，不崩溃、不造 0。
  const fallback = windowForRange('range.all', NOW, null)
  assert.equal(fallback.end, NOW)
  assert.equal(fallback.start, NOW - DAY_MS)
})

test('R12 三档 range 各自的窗口起点正确（今天/7天/30天）', () => {
  const today = windowForRange('range.today', NOW, domain)
  assert.equal(today.start, startOfDay(NOW), '今天 = 本地当天 0 点')
  assert.ok(NOW - today.start <= DAY_MS)

  const week = windowForRange('range.7d', NOW, domain)
  assert.equal(week.start, NOW - 7 * DAY_MS)
  assert.equal(week.end, NOW)

  const month = windowForRange('range.30d', NOW, domain)
  assert.equal(month.start, NOW - 30 * DAY_MS)
  assert.equal(month.end, NOW)

  // 三档窗口都是「右界 = now」（回到最新的语义前提）。
  for (const range of ['range.today', 'range.7d', 'range.30d'] as const) {
    assert.equal(windowForRange(range, NOW, domain).end, NOW, range + ' 右界应是 now')
  }
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

test('clampWindow：窗口完全落在域外时退化为域本身（不造空窗口）', () => {
  const target = { start: NOW - 40 * DAY_MS, end: NOW + 5 * DAY_MS }
  assert.deepEqual(clampWindow(target, domain), domain)
  assert.deepEqual(clampWindow({ start: domain.start - 10, end: domain.end + 10 }, domain), domain)
  const half = clampWindow({ start: NOW - 10 * DAY_MS, end: NOW + 10 * DAY_MS }, domain)
  assert.equal(half.start, NOW - 10 * DAY_MS)
  assert.equal(half.end, domain.end)
})

/* ------------------------------------------------------------------ *
 * 2. 刻度：只有三个标签
 * ------------------------------------------------------------------ */

test('刻度粒度自适应：年/月/周/日/小时/分钟', () => {
  assert.equal(granularityFor(5 * 365 * DAY_MS), 'year')
  assert.equal(granularityFor(120 * DAY_MS), 'month')
  assert.equal(granularityFor(30 * DAY_MS), 'week')
  assert.equal(granularityFor(5 * DAY_MS), 'day')
  assert.equal(granularityFor(6 * HOUR_MS), 'hour')
  assert.equal(granularityFor(10 * 60 * 1000), 'minute')
})

test('R12 刻度：恰好 3 个标签（start / middle / end），比例 0 / 0.5 / 1，无密集刻度', () => {
  assert.equal(SCALE_TICK_COUNT, 3)
  for (const span of [3 * 365 * DAY_MS, 120 * DAY_MS, 30 * DAY_MS, 5 * DAY_MS, 6 * HOUR_MS, 30 * 60 * 1000]) {
    const window = { start: NOW - span, end: NOW }
    const ticks = buildScaleTicks(window)
    assert.equal(ticks.length, 3, '必须只有 3 个刻度，实际 ' + ticks.length)
    assert.deepEqual(
      ticks.map((tick) => tick.ratio),
      [0, 0.5, 1],
    )
    assert.deepEqual(
      ticks.map((tick) => tick.align),
      ['start', 'center', 'end'],
    )
    assert.equal(ticks[0].at, window.start)
    assert.equal(ticks[2].at, window.end)
    assert.ok(ticks[1].at > window.start && ticks[1].at < window.end)
    for (const tick of ticks) assert.ok(tick.label.length > 0, '标签不能为空')
  }
})

test('R12 刻度：首尾标签复用 windowEdgeLabels（同一事实源，不另造格式化）', () => {
  const window = { start: NOW - 30 * DAY_MS, end: NOW }
  const ticks = buildScaleTicks(window)
  const edges = windowEdgeLabels(window)
  assert.equal(ticks[0].label, edges.start)
  assert.equal(ticks[2].label, edges.end)
  const middle = buildScaleTicks(window)[1]
  assert.equal(middle.label, formatTick(middle.at, granularityFor(window.end - window.start)))
})

/* ------------------------------------------------------------------ *
 * 3. 上轨：活跃度柱
 * ------------------------------------------------------------------ */

test('R12 桶数确定性：宽度 / 8px 取整，亚像素抖动不改桶数', () => {
  assert.equal(ACTIVITY_BIN_PX, 8)
  assert.equal(binCountForWidth(640), 80)
  assert.equal(binCountForWidth(800), 100)
  // 同一 8px 格子内的亚像素抖动 → 同一个桶数（截图稳定）。
  assert.equal(binCountForWidth(640.2), 80)
  assert.equal(binCountForWidth(641), 80)
  assert.equal(binCountForWidth(647.9), 80)
  assert.equal(binCountForWidth(648), 81)
  // 宽度未知（0 / NaN / 负数）按默认宽度估 → 首屏确定性。
  assert.equal(binCountForWidth(0), Math.floor(DEFAULT_ACTIVITY_WIDTH / ACTIVITY_BIN_PX))
  assert.equal(binCountForWidth(Number.NaN), Math.floor(DEFAULT_ACTIVITY_WIDTH / ACTIVITY_BIN_PX))
  assert.equal(binCountForWidth(-100), Math.floor(DEFAULT_ACTIVITY_WIDTH / ACTIVITY_BIN_PX))
  // 再窄也至少 1 个桶（不出现 0 桶 / NaN）。
  assert.equal(binCountForWidth(1), 1)
  assert.equal(binCountForWidth(3, 8), 1)
})

test('R12 同输入同输出：buildActivityTrack 两次调用逐值相同（无随机/无时钟）', () => {
  const window = { start: NOW - 10 * DAY_MS, end: NOW }
  const nodes: TimelineNode[] = [
    { path: 'a.md', firstAt: NOW - 9 * DAY_MS, lastAt: NOW, ops: 12 },
    { path: 'b.md', firstAt: NOW - 5 * DAY_MS, lastAt: NOW, ops: 30 },
    { path: 'c.md', firstAt: NOW - 2 * DAY_MS, lastAt: NOW, ops: 3 },
  ]
  const first = buildActivityTrack(nodes, window, 40)
  const second = buildActivityTrack(nodes, window, 40)
  assert.deepEqual(first, second)
  assert.equal(first.binCount, 40)
  assert.equal(first.bins.length, 40)
  // 桶内 ops 之和 = 窗口内所有节点的 ops 总和（不丢不重）。
  const total = first.bins.reduce((sum, value) => sum + value, 0)
  assert.equal(total, 12 + 30 + 3)
})

test('R12 柱高单调：ops 越大柱越高，且夹在 [MIN_H, MAX_H]', () => {
  const window = { start: 0, end: 100 }
  // 三个节点落在三个不同桶：ops 1 / 5 / 10。
  const nodes: TimelineNode[] = [
    { path: 'small', firstAt: 0, lastAt: 10, ops: 1 },
    { path: 'mid', firstAt: 40, lastAt: 50, ops: 5 },
    { path: 'big', firstAt: 80, lastAt: 90, ops: 10 },
  ]
  const track = buildActivityTrack(nodes, window, 3)
  const heights = track.bars.map((bar) => bar.height)
  assert.equal(heights.length, 3)
  // 单调：按 ops 从小到大，柱高不降。
  const ordered = track.bars.slice().sort((left, right) => left.ops - right.ops)
  for (let index = 1; index < ordered.length; index += 1) {
    assert.ok(ordered[index].height >= ordered[index - 1].height, 'ops 大的柱不能更矮')
  }
  // 最大的柱 = MAX_H，最小的柱 ≥ MIN_H。
  assert.equal(track.bars[ordered[ordered.length - 1].index].height, ACTIVITY_BAR_MAX_H)
  for (const bar of track.bars) {
    assert.ok(bar.height >= ACTIVITY_BAR_MIN_H, '非零柱高度至少 MIN_H')
    assert.ok(bar.height <= ACTIVITY_BAR_MAX_H, '柱高不能超过上限')
    assert.ok(bar.opacity >= 0.25 && bar.opacity <= 0.9, '透明度在 0.25–0.90')
  }
  // 透明度也单调（ops 越大越实）。
  assert.ok(ordered[ordered.length - 1].opacity > ordered[0].opacity)
})

test('R12 反向：空数据 → 不渲染任何假柱子（bars 为空、不补 0 高柱）', () => {
  const window = { start: NOW - 7 * DAY_MS, end: NOW }
  const empty = buildActivityTrack([], window, 80)
  assert.equal(empty.bins.length, 80)
  assert.equal(empty.maxOps, 0)
  // 全 0 高度的桶不会被造出来（bars 里不存在 height===0 的项）。
  // 注意：先算过滤数量再断言数组为空 —— assert.deepEqual 会收窄类型，
  // 放在前面会让后面的 bar.height 变成 never[] 的元素而 typecheck 红。
  assert.equal(
    empty.bars.filter((bar) => bar.height === 0).length,
    0,
  )
  assert.deepEqual(empty.bars, [], '没有节点就不能有柱子')

  // 节点全在窗口外 → 窗口内 ops 全是 0 → 依然没有柱子。
  const outside: TimelineNode[] = [{ path: 'old.md', firstAt: 0, lastAt: 1, ops: 99 }]
  const silent = buildActivityTrack(outside, window, 20)
  assert.deepEqual(silent.bars, [], '窗口外节点的 ops 不能算进窗口')
  assert.equal(silent.bins.reduce((sum, value) => sum + value, 0), 0)
})

test('R12 上轨：窗口内只统计窗口内的增量（不把窗口前的累计算进来）', () => {
  const window = { start: 100, end: 200 }
  const samples: TimelineNode = {
    path: 'staged.md',
    firstAt: 0,
    lastAt: 200,
    ops: 100,
    samples: [
      { at: 0, ops: 50 },
      { at: 150, ops: 70 },
      { at: 200, ops: 100 },
    ],
  }
  const track = buildActivityTrack([samples], window, 2)
  // 窗口起点（t=100）累计 50 → 窗口内只该统计 100-50 = 50。
  assert.equal(track.bins.reduce((sum, value) => sum + value, 0), 50)
})

/* ------------------------------------------------------------------ *
 * 4. 下轨：会话分层
 * ------------------------------------------------------------------ */

function session(id: string, start: number, end: number, turns = 3): TimelineSession {
  return { id, title: 'title-' + id, start, end, turns }
}

test('R12 会话行数 = min(4, N)，最多 4 行；空数据 0 行', () => {
  assert.equal(SESSION_LANE_MAX, 4)
  assert.equal(sessionLaneCount(0), 0)
  assert.equal(sessionLaneCount(1), 1)
  assert.equal(sessionLaneCount(3), 3)
  assert.equal(sessionLaneCount(4), 4)
  assert.equal(sessionLaneCount(5), 4)
  assert.equal(sessionLaneCount(99), 4)

  const window = { start: 0, end: 1000 }
  const overlapping = [
    session('a', 0, 400),
    session('b', 0, 400),
    session('c', 0, 400),
    session('d', 0, 400),
    session('e', 0, 400),
  ]
  const lanes = buildSessionLanes(overlapping, window)
  assert.equal(lanes.length, 5, '会话条本身不丢（不合并），只是复用行')
  for (const lane of lanes) assert.ok(lane.lane >= 0 && lane.lane <= 3, '行号必须在 0–3')
  assert.equal(new Set(lanes.map((lane) => lane.lane)).size, 4, '同时占用 4 行')
})

test('R12 会话分层确定性：同输入两次逐值相同；不重叠的会话落同一行', () => {
  const window = { start: 0, end: 1000 }
  const input = [session('b', 300, 500), session('a', 0, 100), session('c', 700, 900)]
  const first = buildSessionLanes(input, window)
  const second = buildSessionLanes(input, window)
  assert.deepEqual(first, second)
  // 三条互不重叠 → 全在第一行（首次适配）。
  for (const lane of first) assert.equal(lane.lane, 0)
  // 输入顺序不影响结果（内部按 start / id 排序）。
  const reversed = buildSessionLanes([...input].reverse(), window)
  assert.deepEqual(reversed, first)
})

test('R12 会话分层：重叠会话分到不同行；与窗口不相交的被丢弃', () => {
  const window = { start: 100, end: 200 }
  const lanes = buildSessionLanes([session('a', 100, 150), session('b', 120, 180)], window)
  assert.equal(lanes.length, 2)
  assert.notEqual(lanes[0].lane, lanes[1].lane, '重叠会话不能叠在同一行')

  const outside = buildSessionLanes([session('gone', 0, 50)], window)
  assert.deepEqual(outside, [], '窗口外会话不画')
  // 反向：全空输入 → 空数组（不造假会话条）。
  assert.deepEqual(buildSessionLanes([], window), [])
})

test('R12 会话条：位置与宽度由窗口比例决定，零时长也有最小宽度且不越界', () => {
  const window = { start: 0, end: 1000 }
  const lanes = buildSessionLanes([session('a', 250, 750), session('point', 900, 900)], window)
  const bar = lanes.find((lane) => lane.id === 'a')
  assert.ok(bar !== undefined)
  assert.equal(bar.leftRatio, 0.25)
  assert.equal(Math.round(bar.widthRatio * 1000) / 1000, 0.5)

  const point = lanes.find((lane) => lane.id === 'point')
  assert.ok(point !== undefined)
  assert.equal(point.widthRatio, SESSION_MIN_RATIO, '零时长会话给最小宽度')
  // 任何会话条都不能越出右界。
  for (const lane of lanes) assert.ok(lane.leftRatio + lane.widthRatio <= 1 + 1e-9, '会话条不能越出右界')
})

/* ------------------------------------------------------------------ *
 * 5. 播放头：唯一标签 + 贴边翻转
 * ------------------------------------------------------------------ */

test('R12 播放头贴边翻转：左 15% / 右 15% 翻转（含边界），中间居中', () => {
  assert.equal(PLAYHEAD_LABEL_EDGE, 0.15)
  assert.equal(playheadLabelAnchor(0), 'start')
  assert.equal(playheadLabelAnchor(0.15), 'start')
  assert.equal(playheadLabelAnchor(0.16), 'center')
  assert.equal(playheadLabelAnchor(0.5), 'center')
  // 右边界对称：恰好 1 - 0.15 = 0.85 就翻转，0.84 仍是居中。
  assert.equal(playheadLabelAnchor(0.84), 'center')
  assert.equal(playheadLabelAnchor(0.85), 'end')
  assert.equal(playheadLabelAnchor(0.99), 'end')
  assert.equal(playheadLabelAnchor(1), 'end')
  // 非法输入不炸（当成最左）。
  assert.equal(playheadLabelAnchor(Number.NaN), 'start')
})

test('Q2 播放头文本至少带日期（MM-DD HH:MM），长窗口给完整日期', () => {
  const dayWindow = { start: NOW - 30 * DAY_MS, end: NOW }
  assert.match(playheadLabel(NOW - 5 * DAY_MS, dayWindow), /^\d{2}-\d{2} \d{2}:\d{2}$/)
  const yearWindow = { start: NOW - 3 * 365 * DAY_MS, end: NOW }
  assert.match(playheadLabel(NOW - 5 * DAY_MS, yearWindow), /^\d{4}-\d{2}-\d{2}$/)
})

/* ------------------------------------------------------------------ *
 * 6. 累计 ops
 * ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ *
 * 7. DOM 合约（SSR 静态渲染：aria / 唯一标签 / 零说明文字）
 * ------------------------------------------------------------------ */

function renderTimeline(props: Partial<React.ComponentProps<typeof Timeline>> = {}): string {
  return renderToStaticMarkup(
    h(Timeline, {
      range: 'range.30d',
      domain,
      playhead: NOW - 10 * DAY_MS,
      now: NOW,
      nodes: [
        { path: 'a.md', firstAt: NOW - 20 * DAY_MS, lastAt: NOW - DAY_MS, ops: 8 },
        { path: 'b.md', firstAt: NOW - 5 * DAY_MS, lastAt: NOW, ops: 24 },
      ],
      sessions: [
        { id: 's1', title: '会话一', start: NOW - 20 * DAY_MS, end: NOW - 10 * DAY_MS, turns: 4 },
        { id: 's2', title: '会话二', start: NOW - 6 * DAY_MS, end: NOW - DAY_MS, turns: 9 },
      ],
      ...props,
    }),
  )
}

test('R12 DOM：role=slider + aria 完整（min/max/now/valuetext/label）', () => {
  const html = renderTimeline()
  assert.match(html, /role="slider"/)
  assert.match(html, /aria-valuemin="/)
  assert.match(html, /aria-valuemax="/)
  assert.match(html, /aria-valuenow="/)
  assert.match(html, /aria-valuetext="/)
  assert.match(html, /aria-label="/)
  assert.match(html, /tabindex="0"/, '必须可键盘聚焦')
  assert.match(html, /aria-live="polite"/, 'aria-live 播报必须保留')
  assert.match(html, /role="status"/)
  const window = windowForRange('range.30d', NOW, domain)
  assert.ok(html.includes('aria-valuemin="' + window.start + '"'))
  assert.ok(html.includes('aria-valuemax="' + window.end + '"'))
})

test('R12 DOM：整条轨道是点击目标（不再只有小把手）', () => {
  const html = renderTimeline()
  // 指针事件挂在 role=slider 的轨道元素上（不是某个小 handle）。
  assert.match(html, /class="tl-track"/)
  // 旧的 8px 圆点把手已删除。
  assert.equal(html.includes('tl-playhead-handle'), false, '旧播放头把手必须删除')
})

test('R12 DOM：全时间轴只有一个播放头标签', () => {
  const html = renderTimeline()
  const labels = html.match(/data-playhead-label="true"/g) ?? []
  assert.equal(labels.length, 1, '播放头标签必须恰好 1 个，实际 ' + labels.length)
  // 旧版右侧常驻文本 .tl-current 已删除。
  assert.equal(html.includes('tl-current'), false, '旧 .tl-current 常驻文本必须删除')
})

/**
 * 2026-11-08 用户拍板：删掉「回到最新」按钮（它占掉左侧一列宽度）。
 *
 * 守两件事：
 * 1. 按钮与 `.tl-controls` 控件列**都不存在**（不能只把按钮隐藏，留下空列）；
 * 2. 能力**没丢**：`onDoubleClick` 挂在轨道上（替代按钮，见 spec §5）。
 *
 * 只删 UI 不删能力 —— 否则鼠标用户把播放头拖到历史时刻后没有一键复位的路
 * （键盘 End 仍在，但那是键盘专属）。
 */
test('R14 DOM：「回到最新」按钮已删除，能力改为双击轨道', () => {
  const html = renderTimeline()
  assert.equal(html.includes('timeline-now'), false, '按钮必须删除（data-testid 不得残留）')
  assert.equal(html.includes('tl-controls'), false, '控件列必须删除（不留空列占宽度）')
  assert.equal(/<button/.test(html), false, '时间轴里不应再有 button')
  // 能力保留的静态证据：track 上有 onDoubleClick（React 静态渲染不输出事件属性，
  // 所以这里断言「轨道仍存在且是 slider」＋ 运行时验证见 R14 浏览器探针）。
  assert.ok(html.includes('role="slider"'), '轨道必须仍在（双击挂在它上面）')
  assert.ok(html.includes('class="tl-track"'), '轨道类名不变')
})

test('R12 DOM：刻度恰好 3 个标签，没有任何刻度线元素', () => {
  const html = renderTimeline()
  const ticks = html.match(/class="tl-scale-tick"/g) ?? []
  assert.equal(ticks.length, SCALE_TICK_COUNT, '刻度标签必须恰好 3 个')
  for (const align of ['start', 'center', 'end']) {
    assert.ok(html.includes('data-tick-align="' + align + '"'), '缺少对齐 ' + align)
  }
  // 密集刻度的旧容器已删除（.tl-ticks / 旧 .tl-tick 都不得出现）。
  assert.equal(html.includes('tl-ticks'), false, '旧 .tl-ticks 容器必须删除')
  assert.equal(/class="tl-tick"/.test(html), false, '旧 .tl-tick 必须删除')
})

test('R12 DOM：旧的生长带 / 会话竖线已删除（单一执行路径）', () => {
  const html = renderTimeline()
  for (const banned of ['tl-growth', 'tl-growth-svg', 'tl-growth-line', 'tl-session']) {
    assert.equal(html.includes(banned), false, '旧结构必须删除：' + banned)
  }
})

test('R12 DOM：零解释性小字（没有图例 / 单位 / 拖动提示 / 会话标题常驻）', () => {
  const html = renderTimeline()
  // 会话标题只能出现在 title 属性里（hover tooltip），不能是可见文本节点。
  assert.equal(html.includes('>会话一<'), false, '会话标题不能常驻显示')
  assert.equal(html.includes('>会话二<'), false, '会话标题不能常驻显示')
  assert.ok(html.includes('title="会话一 · '), 'tooltip 仍应在 title 属性上')
  // 可见文本里不许有这些说明词。
  const visibleText = html
    .replace(/<[^>]*>/g, '\u0000')
    .split('\u0000')
    .join('')
  for (const banned of ['图例', '拖动查看', '点击定位', '操作/桶', '单位', '暂无数据', '提示', '说明']) {
    assert.equal(visibleText.includes(banned), false, '可见文本里不许有「' + banned + '」')
  }
})

test('R12 DOM 反向：domain=null → 不渲染假柱子、不报错、不写说明文字', () => {
  const html = renderTimeline({ domain: null, nodes: [], sessions: [] })
  assert.equal((html.match(/class="tl-bar"/g) ?? []).length, 0, '空数据不能有柱子')
  assert.equal((html.match(/class="tl-lane-bar"/g) ?? []).length, 0, '空数据不能有会话条')
  // 仍然是合法控件（不是白屏）：slider + 三个刻度都在。
  assert.match(html, /role="slider"/)
  assert.equal((html.match(/class="tl-scale-tick"/g) ?? []).length, 3)
  assert.match(html, /data-empty="true"/)
  // 旧版「不伪造 0」仍然守：不出现 NaN / undefined / Infinity。
  for (const bad of ['NaN', 'undefined', 'Infinity']) {
    assert.equal(html.includes(bad), false, 'DOM 里不许出现 ' + bad)
  }
})

test('R12 DOM：有数据时每行会话条数量正确（最多 4 行）', () => {
  const sessions: TimelineSession[] = []
  for (let index = 0; index < 6; index += 1) {
    sessions.push({
      id: 's' + index,
      title: 't' + index,
      start: NOW - (20 - index) * DAY_MS,
      end: NOW - (19 - index) * DAY_MS,
      turns: index + 1,
    })
  }
  const html = renderTimeline({ sessions })
  const bars = html.match(/class="tl-lane-bar"/g) ?? []
  assert.equal(bars.length, 6, '六条会话都要画（只是复用行）')
  const laneAttrs = html.match(/data-lane="(\d)"/g) ?? []
  const lanes = new Set(laneAttrs)
  assert.ok(lanes.size <= SESSION_LANE_MAX, '最多 4 行，实际 ' + lanes.size)
})

test('R12 DOM：上轨柱子数量 = 有 ops 的桶数（不铺满全宽假柱子）', () => {
  const window = windowForRange('range.30d', NOW, domain)
  const nodes: TimelineNode[] = [{ path: 'only.md', firstAt: NOW - 10 * DAY_MS, lastAt: NOW, ops: 5 }]
  const html = renderTimeline({ nodes, range: 'range.30d' })
  const bars = html.match(/class="tl-bar"/g) ?? []
  assert.ok(bars.length >= 1, '有数据的桶必须有柱')
  assert.ok(bars.length <= 80, '柱子数受桶数限制（640/8=80），不能铺满假柱')
  // 桶绑定：每根柱都带 data-bin / data-ops，便于探针与单测。
  assert.match(html, /data-bin="\d+"/)
  assert.match(html, /data-ops="\d+"/)
  // 纯函数与 DOM 一致：DOM 柱数 = buildActivityTrack().bars.length。
  const track = buildActivityTrack(nodes, window, binCountForWidth(DEFAULT_ACTIVITY_WIDTH))
  assert.equal(bars.length, track.bars.length)
})

test('R12 DOM：TIMELINE_H 常量与 tokens 的 104px 一致（几何单一事实源）', () => {
  assert.equal(TIMELINE_H, 104)
  assert.equal(TIMELINE_H % 8, 0, '104 应在 8px 网格上')
})

test('R12 几何自洽：上轨 / 下轨 / 刻度三条带互不重叠，且都在画布内', () => {
  /* 画布 = 卡片高 - 上下边框（box-sizing: border-box）。用错了会压住（实测过一次）。 */
  assert.equal(TRACK_H, TIMELINE_H - 2)
  // 上轨：0 .. ACTIVITY_BASE_Y
  assert.equal(ACTIVITY_BASE_Y, 46)
  // 下轨：首行在 50，最多 4 行，行距 10，条高 6 → 最后一行底边。
  const lanesTop = SESSION_LANE_TOP
  const lanesBottom = lanesTop + (SESSION_LANE_MAX - 1) * SESSION_LANE_PITCH + SESSION_BAR_H
  assert.equal(lanesBottom, 86)
  assert.equal(SESSION_LANE_BAND_H, SCALE_TICK_TOP - SESSION_LANE_TOP)
  assert.ok(lanesTop > ACTIVITY_BASE_Y, '下轨必须在基线之下')
  assert.ok(lanesBottom <= SCALE_TICK_TOP, '会话条不能压住刻度行，实际 ' + lanesBottom + ' > ' + SCALE_TICK_TOP)
  // 刻度行贴底。
  assert.equal(SCALE_TICK_TOP + SCALE_TICK_H, TRACK_H)
  // 柱子在基线之上，并且给顶部标签行留了空。
  assert.ok(ACTIVITY_BASE_Y - ACTIVITY_BAR_MAX_H >= 14, '柱顶必须让开顶部 14px 的播放头标签行')
  assert.ok(ACTIVITY_BAR_MIN_H > 0 && ACTIVITY_BAR_MIN_H < ACTIVITY_BAR_MAX_H)
})

/* ------------------------------------------------------------------ *
 * 8. 负向：旧路径已删除（不留兼容别名 / 双写）
 * ------------------------------------------------------------------ */

test('R12 负向：密集刻度与生长带的纯函数已从出口删除', async () => {
  const module = await import('../../src/client/ui/timeline/index.ts')
  const exported = Object.keys(module)
  for (const name of ['buildTicks', 'maxTicksForWidth', 'nextTick', 'floorToGranularity', 'growthAt', 'visiblePathsAt']) {
    assert.equal(exported.includes(name), false, 'R12 后不应再导出 ' + name)
  }
  // 双轨能力必须导出。
  for (const name of ['windowForRange', 'buildActivityTrack', 'buildSessionLanes', 'buildScaleTicks', 'playheadLabel', 'Timeline']) {
    assert.ok(exported.includes(name), '应保留导出 ' + name)
  }
})

test('R12 负向：源码层面不再出现旧的生长带 / 密集刻度 / 播放器标识', async () => {
  const { readFile } = await import('node:fs/promises')
  const { dirname, resolve } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const here = dirname(fileURLToPath(import.meta.url))
  const timelineDir = resolve(here, '..', '..', 'src', 'client', 'ui', 'timeline')
  const sources = ['Timeline.ts', 'scale.ts', 'index.ts']
  const banned = [
    // M1 已删的播放/倍速
    'timeline-play',
    'timeline-speed',
    'data-playing',
    'data-speed',
    'playbackSpeedForWindow',
    'PLAYBACK_DURATION',
    'advancePlayhead',
    'togglePlay',
    // R12 删的旧结构
    'tl-growth',
    'tl-ticks',
    'tl-current',
    'tl-playhead-handle',
    'tl-session',
    'buildTicks',
    'maxTicksForWidth',
    'growthAt',
    'visiblePathsAt',
    // 确定性纪律：源码里不许出现随机数与真实时间读取
    'Math.random',
  ]
  for (const file of sources) {
    const text = await readFile(resolve(timelineDir, file), 'utf8')
    for (const word of banned) {
      assert.equal(text.includes(word), false, file + ' 不应再出现 ' + word)
    }
  }
})

test('R12 负向：CSS 里没有解释性小字相关规则与旧结构', async () => {
  const { readFile } = await import('node:fs/promises')
  const { dirname, resolve } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const here = dirname(fileURLToPath(import.meta.url))
  const cssPath = resolve(here, '..', '..', 'src', 'client', 'styles', 'timeline.css')
  const css = await readFile(cssPath, 'utf8')
  for (const banned of ['tl-growth', 'tl-ticks', '.tl-tick ', '.tl-current', 'tl-playhead-handle', '.tl-session']) {
    assert.equal(css.includes(banned), false, 'CSS 旧结构必须删除：' + banned)
  }
  // 新双轨结构必须有样式。
  for (const required of ['.tl-activity', '.tl-lanes', '.tl-bar', '.tl-lane-bar', '.tl-playhead-label', '.tl-scale-tick']) {
    assert.ok(css.includes(required), 'CSS 缺少 ' + required)
  }
  // 工厂纪律：CSS 注释里不许有反引号（模板串截断事故）。
  assert.equal((css.match(/`/g) ?? []).length, 0, 'CSS 里不许出现反引号')
  // 颜色只来自 --tl-*：不出现十六进制颜色字面量。
  assert.equal(/#[0-9a-fA-F]{3,8}\b/.test(css), false, 'CSS 不许出现颜色字面量')
})

test('R12 负向：tokens.css 的 --tl-timeline-h 是 104px', async () => {
  const { readFile } = await import('node:fs/promises')
  const { dirname, resolve } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const here = dirname(fileURLToPath(import.meta.url))
  const tokens = await readFile(resolve(here, '..', '..', 'src', 'client', 'styles', 'tokens.css'), 'utf8')
  assert.match(tokens, /--tl-timeline-h:\s*104px/)
  assert.equal(/--tl-timeline-h:\s*48px/.test(tokens), false, '旧的 48px 必须删除')
})
