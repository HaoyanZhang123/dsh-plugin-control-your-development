/*
 * tests/ui-turn/turns-model.test.ts —— 轮次带的纯逻辑（03 §6；06 A42-1 / A42-4 / N-16）。
 *
 * 重点：
 * - **完成只能来自 `turn/end.reason.kind === 'completed'`**；没有结束事件 = 运行中/未知；
 * - 块宽 = 对数缩放、最小 8px、单调；
 * - tooltip 字段齐全（T{n} · 时长 · 文件 · 命令 · 子智能体 · 错误），占位符不残留；
 * - 标记按宽度确定性收拢（图标模式 / 计数模式 / 只有状态条），tooltip 永远给全量；
 * - 会话选择器与分组：当前会话 / 全部工作线 / 具体会话（归档置后）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createTranslator } from '../../src/client/locale/index.ts'
import {
  TURN_METRICS,
  blockWidth,
  buildScopeOptions,
  buildTurnBlock,
  buildTurnGroups,
  currentTurnNumber,
  defaultSelection,
  formatClock,
  formatDuration,
  isTurnPartial,
  markerSlots,
  parseScopeKey,
  scopeKey,
  turnCounts,
  turnMarkers,
  turnStatusOf,
  turnTooltip,
} from '../../src/client/ui/turns/index.ts'
import type { TurnDetail } from '../../src/shared/events/index.ts'
import { buildArchivedDetail, buildSessionDetail, buildSummaries, buildTurns, fixtureNow } from './fixtures.ts'

const t = createTranslator('zh')
const turns = buildTurns()
const detail = buildSessionDetail()
const now = fixtureNow()

function turnNo(n: number): TurnDetail {
  const found = turns.find((turn) => turn.n === n)
  assert.ok(found !== undefined, '夹具缺少 T' + String(n))
  return found
}

/* ---------------- 状态判定 ---------------- */

test('30 轮夹具：完成只来自 completed，没有结束事件 = 运行中', () => {
  const runnings = turns.filter((turn) => turnStatusOf(turn, { sessionRunning: true }) === 'running')
  const aborted = turns.filter((turn) => turnStatusOf(turn, { sessionRunning: true }) === 'aborted')
  const unknown = turns.filter((turn) => turnStatusOf(turn, { sessionRunning: true }) === 'unknown')
  const completed = turns.filter((turn) => turnStatusOf(turn, { sessionRunning: true }) === 'completed')
  assert.equal(turns.length, 30)
  assert.deepEqual(runnings.map((turn) => turn.n), [30])
  assert.deepEqual(aborted.map((turn) => turn.n), [28, 29])
  assert.deepEqual(unknown.map((turn) => turn.n), [27])
  assert.equal(completed.length, 26)
})

test('完成标记的每一轮都真的有 endKind=completed（反例：无 endKind 不得算完成）', () => {
  for (const turn of turns) {
    if (turnStatusOf(turn, { sessionRunning: true }) !== 'completed') continue
    assert.equal(turn.endKind, 'completed', 'T' + String(turn.n) + ' 没有 completed 记录却被判成完成')
  }
  const fake: TurnDetail = {
    n: 99,
    start: 0,
    end: 60_000,
    status: 'completed',
    files: [],
    commands: [],
    subagents: [],
    errors: 0,
    toolCalls: 0,
    toolFailures: 0,
    messageIds: [],
  }
  assert.equal(turnStatusOf(fake), 'unknown', 'status 字段写 completed 但缺 endKind 时必须判未知')
})

test('没有结束事件 + 会话不在跑 = 未知（不是运行中、更不是完成）', () => {
  const open = turnNo(30)
  assert.equal(turnStatusOf(open, { sessionRunning: false }), 'unknown')
  assert.equal(turnStatusOf(open, { sessionRunning: true }), 'running')
  assert.equal(turnStatusOf(open, { sessionRunning: true, sessionPartial: true }), 'running')
})

test('中止类原因（aborted / error）都算中止，不写成完成', () => {
  assert.equal(turnNo(28).endKind, 'aborted')
  assert.equal(turnStatusOf(turnNo(28)), 'aborted')
  assert.equal(turnNo(29).endKind, 'error')
  assert.equal(turnStatusOf(turnNo(29)), 'aborted')
})

test('「本轮仍在记录」只对未结束且会话在跑的轮次为真（06 N-16）', () => {
  assert.equal(isTurnPartial(turnNo(30), { sessionRunning: true }), true)
  assert.equal(isTurnPartial(turnNo(30), { sessionRunning: false }), false)
  for (const turn of turns) {
    if (turn.n === 30) continue
    assert.equal(isTurnPartial(turn, { sessionRunning: true }), false, 'T' + String(turn.n) + ' 已结束却仍标"仍在记录"')
  }
})

/* ---------------- 时长与宽度 ---------------- */

test('时长宽度：对数缩放、最小 8px、单调不减', () => {
  assert.equal(blockWidth(null), TURN_METRICS.minBlockPx)
  assert.equal(blockWidth(0), TURN_METRICS.minBlockPx)
  assert.equal(blockWidth(-5), TURN_METRICS.minBlockPx)
  let previous = 0
  for (const seconds of [0, 1, 5, 30, 60, 300, 600, 3600, 10800]) {
    const width = blockWidth(seconds * 1000)
    assert.ok(Number.isInteger(width), '宽度必须是整数像素')
    assert.ok(width >= TURN_METRICS.minBlockPx, '宽度不得小于 8px：' + String(width))
    assert.ok(width >= previous, '宽度必须随时长单调不减')
    previous = width
  }
  assert.ok(blockWidth(60 * 60 * 1000) > blockWidth(60 * 1000))
  assert.equal(blockWidth(134_000), blockWidth(134_000), '同时长必须同宽（确定性）')
})

test('时长文案：时钟格式与 locale 模板', () => {
  assert.equal(formatClock(0), '00:00')
  assert.equal(formatClock(134_000), '02:14')
  assert.equal(formatClock(3_600_000), '1:00:00')
  assert.equal(formatClock(null), '—')
  assert.equal(formatDuration(134_000, t), '2 分 14 秒')
  assert.equal(formatDuration(5_000, t), '5 秒')
  assert.equal(formatDuration(3_900_000, t), '1 小时 5 分')
  assert.equal(formatDuration(null, t), '—')
})

/* ---------------- 计数 / 标记 / tooltip ---------------- */

test('计数：同一文件多次只算 1；命令/子智能体/错误各按记录', () => {
  const counts = turnCounts(turnNo(3))
  assert.deepEqual(counts, { files: 4, commands: 1, subagents: 0, errors: 0 })
  const multi = turnCounts({
    ...turnNo(1),
    files: [
      { path: 'a.ts', ops: ['read'], added: 0, removed: 0 },
      { path: 'a.ts', ops: ['write'], added: 1, removed: 0 },
      { path: 'b.ts', ops: ['read'], added: 0, removed: 0 },
    ],
  })
  assert.equal(multi.files, 2)
})

test('标记只显示非零项，顺序固定为 文件 → 命令 → 错误 → 子智能体', () => {
  assert.deepEqual(turnMarkers({ files: 2, commands: 0, subagents: 1, errors: 3 }), [
    { kind: 'files', count: 2 },
    { kind: 'errors', count: 3 },
    { kind: 'subagents', count: 1 },
  ])
  assert.deepEqual(turnMarkers({ files: 0, commands: 0, subagents: 0, errors: 0 }), [])
})

test('标记槽位按宽度确定性收拢（8px 只有状态条；≥56px 才给计数）', () => {
  assert.deepEqual(markerSlots(8), { mode: 'bar', slots: 0 })
  assert.deepEqual(markerSlots(23), { mode: 'bar', slots: 0 })
  assert.equal(markerSlots(24).mode, 'icon')
  assert.ok(markerSlots(24).slots >= 1)
  assert.equal(markerSlots(60).mode, 'count')
  assert.equal(markerSlots(60).slots, 4)
  assert.equal(markerSlots(1000).slots, TURN_METRICS.markerKinds)
})

test('tooltip：模板占位符全部被替换，四类计数都在（03 §6）', () => {
  const block = buildTurnBlock(turnNo(3), { sessionId: 'sess-alpha', sessionRunning: true, t, now })
  assert.equal(block.tooltip, 'T3 · 9 分 0 秒 · 文件 4 · 命令 1 · 子智能体 0 · 错误 0')
  assert.ok(!block.tooltip.includes('{'), 'tooltip 残留占位符：' + block.tooltip)
  assert.equal(block.ariaLabel, block.tooltip, '读屏描述必须与 tooltip 同源')
  const empty = turnTooltip({ turn: 7, durationText: '00:00', counts: { files: 0, commands: 0, subagents: 0, errors: 0 }, t })
  for (const piece of ['T7', '00:00', '文件 0', '命令 0', '子智能体 0', '错误 0']) {
    assert.ok(empty.includes(piece), 'tooltip 缺字段 ' + piece + '：' + empty)
  }
})

test('块模型：宽度/标记模式/partial/状态文案一致', () => {
  const running = buildTurnBlock(turnNo(30), { sessionId: 'sess-alpha', sessionRunning: true, t, now })
  assert.equal(running.status, 'running')
  assert.equal(running.partial, true)
  assert.equal(running.partialLabel, '本轮仍在记录')
  assert.equal(running.statusLabel, '执行中')
  assert.ok(running.widthPx >= TURN_METRICS.minBlockPx)

  const completed = buildTurnBlock(turnNo(1), { sessionId: 'sess-alpha', sessionRunning: true, t, now })
  assert.equal(completed.status, 'completed')
  assert.equal(completed.statusLabel, '完成')
  assert.equal(completed.partial, false)

  const hidden = buildTurnBlock(
    { ...turnNo(1), files: [{ path: 'a.ts', ops: ['read'], added: 0, removed: 0 }], commands: [], subagents: ['x'], errors: 2 },
    { sessionId: 'sess-alpha', sessionRunning: true, t, now },
  )
  assert.equal(hidden.hiddenMarkers, Math.max(0, hidden.markers.length - hidden.markerSlots))
})

/* ---------------- 会话选择器与分组 ---------------- */

test('选择器选项：当前会话 / 全部会话（含归档） / 具体未归档会话', () => {
  const options = buildScopeOptions(buildSummaries(), t)
  /* 用户口径（2026-11-11）：只列「当前会话」「全部会话（含归档）」与未归档的具体会话；
   * 归档会话不再逐条列出，统一归入「全部会话（含归档）」。 */
  assert.deepEqual(
    options.map((option) => option.label),
    ['当前会话', '全部会话（含归档）', '修复读模型指纹'],
  )
  assert.deepEqual(options.map((option) => option.value), ['current', 'all', 'session:sess-alpha'])
  assert.equal(options[1].archived, true, '「全部会话」覆盖归档，因此标 archived')
  assert.deepEqual(options.map((option) => option.group), ['view', 'view', 'sessions'])
  // 归档会话不出现在具体列表里（即使 updatedAt 更新也不列）
  const reversed = buildScopeOptions(
    [
      { ...buildSummaries()[1], updatedAt: Date.now() },
      buildSummaries()[0],
    ],
    t,
  )
  assert.equal(reversed.some((option) => option.value === 'session:sess-beta'), false, '归档会话只归入全部会话')
})

test('scope 键 round-trip（不认识的键退回当前会话，不抛错）', () => {
  for (const scope of [{ kind: 'current' as const }, { kind: 'all' as const }, { kind: 'session' as const, sessionId: 'sess-beta' }]) {
    assert.deepEqual(parseScopeKey(scopeKey(scope)), scope)
  }
  assert.deepEqual(parseScopeKey('nonsense'), { kind: 'current' })
  assert.deepEqual(parseScopeKey('session:'), { kind: 'current' })
})

test('分组：当前会话 1 组 30 轮；全部工作线含归档会话；指定会话只给那一个', () => {
  const details = new Map([
    [detail.id, detail],
    ['sess-beta', buildArchivedDetail()],
  ])
  const sessions = buildSummaries()
  const current = buildTurnGroups({ scope: { kind: 'current' }, currentSessionId: 'sess-alpha', sessions, details })
  assert.equal(current.length, 1)
  assert.equal(current[0].turns.length, 30)
  assert.equal(current[0].running, true)

  const all = buildTurnGroups({ scope: { kind: 'all' }, currentSessionId: 'sess-alpha', sessions, details })
  assert.deepEqual(all.map((group) => group.sessionId), ['sess-alpha', 'sess-beta'])

  const single = buildTurnGroups({
    scope: { kind: 'session', sessionId: 'sess-beta' },
    currentSessionId: 'sess-alpha',
    sessions,
    details,
  })
  assert.equal(single.length, 1)
  assert.equal(single[0].sessionId, 'sess-beta')

  const missing = buildTurnGroups({ scope: { kind: 'current' }, currentSessionId: 'sess-nope', sessions, details })
  assert.deepEqual(missing, [], '没有详情就不画假块')
})

test('默认选择 = 当前轮（最后一轮）', () => {
  assert.equal(currentTurnNumber(detail), 30)
  assert.deepEqual(defaultSelection(detail), { kind: 'turn', sessionId: 'sess-alpha', turn: 30 })
  assert.deepEqual(defaultSelection(null), { kind: 'none' })
  assert.deepEqual(defaultSelection({ ...detail, turns: [] }), { kind: 'none' })
})
