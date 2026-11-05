/*
 * tests/ui-turn/inspector-model.test.ts —— 三种检查器 + 工作区概览的字段（03 §8；06 A42-2 / A42-3）。
 *
 * 断言方式：
 * - **字段齐全**用 `*_FIELDS` 清单与模型实际键对账（缺项 = 红）；
 * - 关系证据**逐条等于边自带的 `evidence.text`**（UI 不造句、不产生假证据）；
 * - 未确认引用只出现在清单里，**不进关系组**（不画边）；
 * - 触碰历史 ≤50、后续触碰 ≤20、最近轮次 10，超限有显式「还有 N 条」；
 * - 未知一律 null / 「观测不到」，`计划`无数据是 `—` 不是 0。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createTranslator } from '../../src/client/locale/index.ts'
import { degradeHostUnavailable } from '../../src/client/data/index.ts'
import type { SessionDetail } from '../../src/shared/events/index.ts'
import {
  FILE_INSPECTOR_FIELDS,
  INSPECTOR_LIMITS,
  OVERVIEW_FIELDS,
  SESSION_INSPECTOR_FIELDS,
  TURN_INSPECTOR_FIELDS,
  buildFileInspector,
  buildInspectorModel,
  buildOverview,
  buildSessionInspector,
  buildTurnInspector,
  type InspectorContext,
} from '../../src/client/ui/inspector/index.ts'
import {
  buildArchivedDetail,
  buildEdges,
  buildInspectorData,
  buildSessionDetail,
  coverageComplete,
  coverageUnknown,
  fixtureNow,
} from './fixtures.ts'

const t = createTranslator('zh')
const data = buildInspectorData()
const now = fixtureNow()

function ctx(overrides: Partial<InspectorContext> = {}): InspectorContext {
  return { data, privacyMode: false, now, t, ...overrides }
}

/* ---------------- 文件检查器 ---------------- */

test('文件检查器：字段齐全（03 §8.1 逐条对账，缺项 0）', () => {
  const model = buildFileInspector('src/client/data/merge.ts', ctx())
  const keys = Object.keys(model)
  for (const field of FILE_INSPECTOR_FIELDS) {
    assert.ok(field in model, '缺字段 ' + field)
  }
  assert.deepEqual(model.fields, [...FILE_INSPECTOR_FIELDS])
  assert.deepEqual(model.kind, 'file')
  assert.ok(keys.includes('missing'))
  assert.equal(model.missing, false)
})

test('文件检查器：标题 = basename + 相对路径 + 族', () => {
  const model = buildFileInspector('src/client/data/merge.ts', ctx())
  assert.equal(model.name, 'merge.ts')
  assert.equal(model.displayPath, 'src/client/data/merge.ts')
  assert.equal(model.dir, 'src/client/data')
  assert.equal(model.family, 'code')
  assert.equal(model.familyLabel, '代码')
})

test('文件检查器：概览（首见/最近/ops/≈增删行，标注按工具参数估算）', () => {
  const model = buildFileInspector('src/client/data/merge.ts', ctx())
  assert.equal(model.overview.lastTouchedTurn, 10, '最近触碰应是 T10')
  assert.equal(model.overview.firstSeenTurn, 1, '首次出现来自归档会话的 T1')
  assert.equal(model.overview.firstSeenSession, '旧读模型试验')
  assert.equal(model.overview.ops, 24)
  assert.equal(model.overview.added, 17, '只把 write 的 ≈增行累加（12+5）')
  assert.equal(model.overview.removed, 5, '只把 write 的 ≈删行累加（2+3）')
  assert.equal(model.overview.estimateNote, '≈ 增删行（按工具参数估算）')
  assert.notEqual(model.overview.firstSeenText, '—')
})

test('文件检查器：操作统计四栏（读/写/搜索/命令关联）', () => {
  const model = buildFileInspector('src/client/data/merge.ts', ctx())
  assert.deepEqual(
    model.operationStats.map((row) => row.key),
    ['read', 'write', 'search', 'command'],
  )
  assert.deepEqual(
    model.operationStats.map((row) => row.label),
    ['读取', '写入', '搜索', '命令关联'],
  )
  assert.equal(model.operationStats[0].count, 18)
  assert.equal(model.operationStats[1].count, 4)
  assert.equal(model.operationStats[2].count, 2)
  assert.equal(model.operationStats[3].count, 1, '命令关联 = 触碰该文件且该轮有命令的轮次数')
})

test('文件检查器：触碰历史（会话→轮次→时间→操作→≈行数）', () => {
  const model = buildFileInspector('src/client/data/merge.ts', ctx())
  assert.equal(model.touchHistory.total, 5)
  assert.equal(model.touchHistory.rows.length, 5)
  assert.equal(model.touchHistory.moreText, null)
  const writeRow = model.touchHistory.rows.find((row) => row.turn === 3)
  assert.ok(writeRow !== undefined)
  assert.equal(writeRow?.opsLabel, '写入')
  assert.equal(writeRow?.deltaText, '≈ +12 / −2')
  const readRow = model.touchHistory.rows.find((row) => row.turn === 2)
  assert.equal(readRow?.deltaText, '—', '只读的触碰没有行数估算')
  for (const row of model.touchHistory.rows) assert.notEqual(row.timeText, '—')
})

test('文件检查器：触碰历史超过 50 条时截断并显式「还有 N 条」', () => {
  const longSession: SessionDetail = {
    ...buildSessionDetail(),
    id: 'sess-long',
    turns: Array.from({ length: 60 }, (_, index) => ({
      n: index + 1,
      start: now + index,
      end: now + index + 1,
      status: 'completed' as const,
      endKind: 'completed' as const,
      files: [{ path: 'many.txt', ops: ['write' as const], added: 1, removed: 0 }],
      commands: [],
      subagents: [],
      errors: 0,
      toolCalls: 1,
      toolFailures: 0,
      messageIds: [],
    })),
  }
  const longData = {
    ...data,
    sessions: [{ ...data.sessions[0], id: 'sess-long', turns: 60 }],
    details: new Map([['sess-long', longSession]]),
    currentSessionId: 'sess-long',
  }
  const model = buildFileInspector('many.txt', { data: longData, privacyMode: false, now, t })
  assert.equal(model.touchHistory.total, 60)
  assert.equal(model.touchHistory.rows.length, INSPECTOR_LIMITS.touchHistory)
  assert.equal(model.touchHistory.moreText, '还有 10 条')
  assert.equal(model.touchHistory.hidden, 10)
})

test('文件检查器：关系分组带证据，证据逐条等于边的 evidence.text（无假数据）', () => {
  const model = buildFileInspector('src/client/data/merge.ts', ctx())
  assert.deepEqual(
    model.relations.groups.map((group) => group.type),
    ['structure', 'coTurn', 'reference', 'sequence'],
  )
  const evidencePool = new Set(buildEdges().map((edge) => edge.evidence.text))
  for (const group of model.relations.groups) {
    assert.ok(group.rows.length > 0)
    for (const row of group.rows) {
      assert.ok(row.evidence.length > 0, '每条关系都必须有证据文本')
      assert.ok(evidencePool.has(row.evidence), '证据不是来自边：' + row.evidence)
      assert.ok(row.rawTarget !== '', '关系行必须给出对端文件')
    }
  }
  const reference = model.relations.groups.find((group) => group.type === 'reference')
  assert.equal(reference?.rows[0].rawTarget, 'docs/facts/read-model.md')
  assert.match(reference?.rows[0].evidence ?? '', /引用/)
  const structure = model.relations.groups.find((group) => group.type === 'structure')
  assert.match(structure?.rows[0].evidence ?? '', /同属目录/)
})

test('文件检查器：未确认引用列出路径+行号+原因，且不进关系组（不画边）', () => {
  const model = buildFileInspector('src/client/data/merge.ts', ctx())
  assert.equal(model.unconfirmed.length, 2)
  assert.deepEqual(
    model.unconfirmed.map((row) => row.line),
    [3, 9],
  )
  assert.equal(model.unconfirmed[0].path, 'src/client/data/legacy-view-model.json')
  assert.equal(model.unconfirmed[0].reasonLabel, '文件不存在')
  assert.equal(model.unconfirmed[1].reasonLabel, '无扩展名，未猜测')
  const relationTargets = model.relations.groups.flatMap((group) => group.rows.map((row) => row.rawTarget))
  for (const row of model.unconfirmed) {
    assert.ok(!relationTargets.includes(row.path), '未确认引用不得出现在关系里（不画边）')
  }
})

test('文件检查器：外部来源只读列出（URL + 行号），不进入关系', () => {
  const model = buildFileInspector('src/client/data/merge.ts', ctx())
  assert.equal(model.external.length, 2)
  assert.deepEqual(
    model.external.map((row) => row.label),
    ['https://example.invalid/read-model', 'https://other.invalid/threadline'],
  )
  assert.deepEqual(
    model.external.map((row) => row.line),
    [7, 21],
  )
})

test('文件检查器：数据缺失时显式 missing（不伪造字段）', () => {
  const model = buildFileInspector('src/not/there.ts', ctx())
  assert.equal(model.missing, true)
  assert.equal(model.kind, 'file')
  assert.equal(model.touchHistory.total, 0)
  assert.equal(model.relations.groups.length, 0)
})

/* ---------------- 隐私模式（06 N-14） ---------------- */

test('隐私模式：路径只留 basename、外部来源只留域名、会话按编号', () => {
  const model = buildFileInspector('src/client/data/merge.ts', ctx({ privacyMode: true }))
  assert.equal(model.name, 'merge.ts')
  assert.equal(model.displayPath, 'merge.ts')
  assert.ok(!model.displayPath.includes('/'), '隐私模式下不得出现目录')
  assert.deepEqual(
    model.external.map((row) => row.label),
    ['example.invalid', 'other.invalid'],
  )
  assert.equal(model.touchHistory.rows[0].sessionLabel.startsWith('会话 '), true)

  const turn = buildTurnInspector('sess-alpha', 30, ctx({ privacyMode: true }))
  assert.equal(turn.intent.hidden, true)
  assert.equal(turn.intent.text, null, '隐私模式必须隐藏用户消息正文')
  const session = buildSessionInspector('sess-alpha', ctx({ privacyMode: true }))
  assert.match(session.title, /^会话 \d+$/)
})

/* ---------------- 轮次检查器 ---------------- */

test('轮次检查器：字段齐全（03 §8.2 逐条对账）', () => {
  const model = buildTurnInspector('sess-alpha', 12, ctx())
  for (const field of TURN_INSPECTOR_FIELDS) assert.ok(field in model, '缺字段 ' + field)
  assert.deepEqual(model.fields, [...TURN_INSPECTOR_FIELDS])
  assert.equal(model.missing, false)
})

test('轮次检查器：标题/状态/时长（完成只来自 completed）', () => {
  const completed = buildTurnInspector('sess-alpha', 12, ctx())
  assert.equal(completed.title, 'T12')
  assert.equal(completed.status, 'completed')
  assert.equal(completed.statusLabel, '完成')
  assert.equal(completed.partial, false)

  const aborted = buildTurnInspector('sess-alpha', 28, ctx())
  assert.equal(aborted.status, 'aborted')
  assert.equal(aborted.statusLabel, '已中断')

  const unknown = buildTurnInspector('sess-alpha', 27, ctx())
  assert.equal(unknown.status, 'unknown')

  const running = buildTurnInspector('sess-alpha', 30, ctx())
  assert.equal(running.status, 'running')
  assert.equal(running.statusLabel, '执行中')
  assert.equal(running.partial, true)
  assert.equal(running.partialLabel, '本轮仍在记录')
  assert.notEqual(running.durationText, '—', '运行中的轮次应给出"至今"时长')
})

test('轮次检查器：用户意图默认折叠（模型只给文本，展开由组件控制）', () => {
  const model = buildTurnInspector('sess-alpha', 30, ctx())
  assert.equal(model.intent.available, true)
  assert.equal(model.intent.text, '把字段核对表补上')
  assert.equal(model.intent.hidden, false)
  // T3 有用户消息：折叠态只给 ≤32 字符的摘要，正文全文留在 conversation 里（组件点开才挂载）
  const t3 = buildTurnInspector('sess-alpha', 3, ctx())
  assert.equal(t3.intent.available, true)
  assert.equal(t3.intent.preview, '先把 scope 与 merge 的字段对齐，再跑一次测试')
  assert.equal(t3.intent.text, t3.conversation.userText)
  assert.equal(t3.intent.hidden, false)

  // T2 没有用户消息：显式不可用（渲染 —），不是空串
  const none = buildTurnInspector('sess-alpha', 2, ctx())
  assert.equal(none.intent.available, false)
  assert.equal(none.intent.preview, null)
  assert.equal(none.conversation.userText, null)
})

test('轮次检查器：工具统计（总/失败/未知 + 按工具名分组）', () => {
  const model = buildTurnInspector('sess-alpha', 20, ctx())
  assert.equal(model.tools.total, 9)
  assert.equal(model.tools.failed, 0)
  assert.equal(model.tools.unknown, 1, 'c-21 记录为 unknown')
  assert.equal(model.tools.unrecorded, 7, '命令记录之外的调用显式记为未记录')
  assert.deepEqual(model.tools.rows, [{ tool: 'shell', total: 2, failed: 0, unknown: 1 }])

  const failed = buildTurnInspector('sess-alpha', 11, ctx())
  assert.equal(failed.tools.failed, 1)
  assert.equal(failed.tools.rows[0].failed, 1)
})

test('轮次检查器：文件 新增/修改/读取/搜索 + ≈行数', () => {
  // T12：第一次写 src/client/ui/turns/model.ts → 新增
  const added = buildTurnInspector('sess-alpha', 12, ctx())
  assert.deepEqual(
    added.files.added.map((row) => row.path),
    ['src/client/ui/turns/model.ts'],
  )
  assert.equal(added.files.added[0].deltaText, '≈ +88 / −0')
  assert.equal(added.files.addedLines, 88)
  assert.equal(added.files.removedLines, 0)

  // T15：T14 已写过 inspector/model.ts → 本轮写算修改；T12 写过 turns/model.ts → 本轮读
  const modified = buildTurnInspector('sess-alpha', 15, ctx())
  assert.deepEqual(
    modified.files.modified.map((row) => row.path),
    ['src/client/ui/inspector/model.ts'],
  )
  assert.deepEqual(
    modified.files.read.map((row) => row.path),
    ['src/client/ui/turns/model.ts'],
  )
  assert.equal(modified.files.added.length, 0)
  assert.equal(modified.files.estimateNote, '≈ 增删行（按工具参数估算）')

  // T3：一轮里四种文件角色齐全（新增/修改/读取/搜索）
  const t3 = buildTurnInspector('sess-alpha', 3, ctx())
  assert.deepEqual(
    t3.files.added.map((row) => row.path),
    ['src/client/ui/turns/merge-helpers.ts'],
  )
  assert.deepEqual(
    t3.files.modified.map((row) => row.path),
    ['src/client/data/merge.ts'],
  )
  assert.deepEqual(
    t3.files.read.map((row) => row.path),
    ['src/client/data/scope.ts'],
  )
  assert.deepEqual(
    t3.files.searched.map((row) => row.path),
    ['docs/facts/read-model.md'],
  )
  assert.equal(t3.files.addedLines, 42, 'T3 的 write ≈增行：12 + 30')
  assert.equal(t3.files.removedLines, 2)

  const readOnly = buildTurnInspector('sess-alpha', 26, ctx())
  assert.equal(readOnly.files.read.length, 1)
  assert.equal(readOnly.files.added.length + readOnly.files.modified.length, 0)
})

test('轮次检查器：命令（程序名 / 摘要 / 状态 / 时长 / 失败标记）', () => {
  const model = buildTurnInspector('sess-alpha', 11, ctx())
  assert.equal(model.commands.length, 1)
  const command = model.commands[0]
  assert.equal(command.program, 'pnpm')
  assert.equal(command.summary, 'pnpm run typecheck')
  assert.equal(command.status, 'error')
  assert.equal(command.statusLabel, '失败')
  assert.equal(command.durationText, '00:51')
})

test('轮次检查器：子智能体（名称/角色、状态；点击由上抛回调打开）', () => {
  const model = buildTurnInspector('sess-alpha', 5, ctx())
  assert.equal(model.subagents.length, 1)
  assert.equal(model.subagents[0].id, 'agent-reviewer')
  assert.equal(model.subagents[0].title, 'reviewer')
  assert.equal(model.subagents[0].statusLabel, '完成')
  const tester = buildTurnInspector('sess-alpha', 12, ctx())
  assert.deepEqual(
    tester.subagents.map((item) => item.statusLabel),
    ['完成', '执行中'],
  )
})

test('轮次检查器：计划无数据是 — 不是 0', () => {
  const withPlan = buildTurnInspector('sess-alpha', 21, ctx())
  assert.deepEqual(withPlan.plan, { total: 6, done: 3 })
  assert.equal(withPlan.planText, '3/6')
  const withoutPlan = buildTurnInspector('sess-alpha', 3, ctx())
  assert.equal(withoutPlan.plan, null)
  assert.equal(withoutPlan.planText, '—')
})

test('轮次检查器：错误/未知明确列出（不推断）', () => {
  const model = buildTurnInspector('sess-alpha', 11, ctx())
  assert.deepEqual(model.errors.messages, ['typecheck-failed'])
  assert.equal(model.errors.failedCommands, 1)
  assert.equal(model.errors.unknownCommands, 0)
  const clean = buildTurnInspector('sess-alpha', 1, ctx())
  assert.deepEqual(clean.errors.messages, [])
  assert.equal(clean.errors.failedCommands, 0)
})

test('轮次检查器：后续触碰 ≤20，且都是"之后"的轮次', () => {
  const model = buildTurnInspector('sess-alpha', 3, ctx())
  assert.ok(model.laterTouches.total > 0)
  assert.ok(model.laterTouches.rows.length <= INSPECTOR_LIMITS.laterTouches)
  for (const row of model.laterTouches.rows) {
    assert.ok(row.turn !== null && row.turn > 3, '后续触碰必须晚于本轮：T' + String(row.turn))
    assert.ok(row.opsLabel.length > 0)
  }
  assert.deepEqual(
    model.laterTouches.rows.map((row) => row.turn),
    [4, 7, 9, 10],
    'T3 的文件在 T4、T7、T9、T10 又被其它轮次动过',
  )
  assert.equal(model.laterTouches.moreText, null)
})

test('轮次检查器：与上一轮对比（新增 / 复用）', () => {
  const model = buildTurnInspector('sess-alpha', 3, ctx())
  assert.equal(model.prevTurn.turn, 2)
  assert.deepEqual(model.prevTurn.added, ['src/client/data/scope.ts', 'src/client/ui/turns/merge-helpers.ts'])
  assert.deepEqual(model.prevTurn.reused, ['src/client/data/merge.ts', 'docs/facts/read-model.md'])
  assert.equal(model.prevTurn.addedLabel, '新增')
  assert.equal(model.prevTurn.reusedLabel, '复用')
})

test('轮次检查器：详情未加载时 missing（不画假字段）', () => {
  const model = buildTurnInspector('sess-nope', 3, ctx())
  assert.equal(model.missing, true)
  assert.equal(model.status, 'unknown')
})

/* ---------------- 会话检查器 ---------------- */

test('会话检查器：字段齐全（03 §8.3 逐条对账）', () => {
  const model = buildSessionInspector('sess-alpha', ctx())
  for (const field of SESSION_INSPECTOR_FIELDS) assert.ok(field in model, '缺字段 ' + field)
  assert.deepEqual(model.fields, [...SESSION_INSPECTOR_FIELDS])
})

test('会话检查器：概览计数与状态', () => {
  const model = buildSessionInspector('sess-alpha', ctx())
  assert.equal(model.title, '修复读模型指纹')
  assert.equal(model.status, 'running')
  assert.equal(model.statusLabel, '执行中')
  assert.equal(model.running, true)
  assert.equal(model.archived, false)
  assert.equal(model.overview.turns, 30)
  assert.equal(model.overview.files, 11)
  assert.equal(model.overview.commands, 5)
  assert.equal(model.overview.subagents, 2)
  assert.equal(model.overview.errors, 4)
  assert.equal(model.overview.endedAtText, '—', '还在跑 → 结束时间是 —，不是假时间')
})

test('会话检查器：模型只作标签（不做成本 / token）', () => {
  const model = buildSessionInspector('sess-alpha', ctx())
  assert.equal(model.model.provider, 'deepseek')
  assert.equal(model.model.model, 'deepseek-v4.1-flash')
  assert.equal(model.model.text, 'deepseek / deepseek-v4.1-flash')
  assert.ok(!/token|cost|price/i.test(JSON.stringify(model.model)))
})

test('会话检查器：工作线（父 / 子 / 子智能体）', () => {
  const model = buildSessionInspector('sess-alpha', ctx())
  assert.equal(model.workline.parent, null)
  assert.deepEqual(model.workline.children, [])
  assert.equal(model.workline.subagents.length, 2)
  assert.deepEqual(
    model.workline.subagents.map((item) => item.title),
    ['reviewer', 'tester'],
  )
})

test('会话检查器：最近 10 轮（不是全部 30 轮）', () => {
  const model = buildSessionInspector('sess-alpha', ctx())
  assert.equal(model.recentTurns.length, INSPECTOR_LIMITS.recentTurns)
  assert.equal(model.recentTurns[0].turn, 21)
  assert.equal(model.recentTurns[9].turn, 30)
  assert.equal(model.recentTurns[9].status, 'running')
})

test('会话检查器：归档会话显式标记', () => {
  const model = buildSessionInspector('sess-beta', ctx())
  assert.equal(model.archived, true)
  assert.equal(model.title, '旧读模型试验')
  assert.equal(model.statusLabel, '完成')
})

/* ---------------- 工作区概览 ---------------- */

test('概览：字段齐全（03 §8.4 逐条对账）', () => {
  const model = buildOverview(ctx())
  for (const field of OVERVIEW_FIELDS) assert.ok(field in model, '缺字段 ' + field)
  assert.deepEqual(model.fields, [...OVERVIEW_FIELDS])
})

test('概览：覆盖率（已加载/总数、失败数、阶段）', () => {
  const model = buildOverview(ctx())
  assert.equal(model.coverage.known, true)
  assert.equal(model.coverage.percent, 100)
  assert.equal(model.coverage.text, '42/42 · 全部记录 · 1 个会话读取失败')
  assert.equal(model.coverage.failed, 1)
  assert.equal(model.coverage.phase, 'complete')
})

test('概览：计数是概览（不是 KPI 墙），未知时一律「观测不到」', () => {
  const model = buildOverview(ctx())
  assert.deepEqual(model.counts, { files: 3, sessions: 2, turns: 31, commands: 5, subagents: 2 })
  const unknown = buildOverview({ data: { ...data, coverage: coverageUnknown() }, privacyMode: false, now, t })
  assert.deepEqual(unknown.counts, { files: null, sessions: null, turns: null, commands: null, subagents: null })
  assert.equal(unknown.coverage.percent, null)
  assert.equal(unknown.coverage.text, '观测不到')
})

test('概览：工作线（running 会话 / 当前轮 / 最近活动）', () => {
  const model = buildOverview(ctx())
  assert.equal(model.workline.currentSessionId, 'sess-alpha')
  assert.equal(model.workline.currentTurn, 30)
  assert.deepEqual(
    model.workline.running.map((row) => row.sessionId),
    ['sess-alpha'],
  )
  assert.notEqual(model.workline.lastActivityText, '—')
})

test('概览：图层开关位来自 03 §10 的默认表（不在这里另写一套默认值）', () => {
  const model = buildOverview(ctx())
  assert.deepEqual(
    model.layerToggles.map((row) => row.type),
    ['structure', 'coTurn', 'coSession', 'sequence', 'reference'],
  )
  const structure = model.layerToggles.find((row) => row.type === 'structure')
  assert.equal(structure?.defaultOn, true)
  assert.equal(structure?.focusOnly, false)
  const coSession = model.layerToggles.find((row) => row.type === 'coSession')
  assert.equal(coSession?.defaultOn, false)
  assert.equal(coSession?.weak, true)
})

test('概览：图例 5 项（族标签来自 locale key；33 §5 五类）', () => {
  const model = buildOverview(ctx())
  assert.deepEqual(
    model.legend.map((item) => item.label),
    ['文本', '代码', '数据', '媒体', '其它'],
  )
})

test('概览：host 不可用时给出可重试的显式错误（不显示 0）', () => {
  const model = buildOverview({
    data: { ...data, coverage: coverageUnknown(), degrade: degradeHostUnavailable() },
    privacyMode: false,
    now,
    t,
  })
  assert.equal(model.degrade.kind, 'hostUnavailable')
  assert.equal(model.degrade.message, '观测不到工作区记录')
  assert.equal(model.degrade.retryable, true)
  assert.equal(model.degrade.retryLabel, '重新读取')
})

/* ---------------- 派发 ---------------- */

test('派发：四种选择各回各的模型，none = 概览', () => {
  assert.equal(buildInspectorModel({ kind: 'none' }, ctx()).kind, 'overview')
  assert.equal(buildInspectorModel({ kind: 'file', path: 'src/client/data/merge.ts' }, ctx()).kind, 'file')
  assert.equal(buildInspectorModel({ kind: 'turn', sessionId: 'sess-alpha', turn: 3 }, ctx()).kind, 'turn')
  assert.equal(buildInspectorModel({ kind: 'session', sessionId: 'sess-beta' }, ctx()).kind, 'session')
})

test('夹具与覆盖率口径自洽（防止夹具漂移后断言变成空转）', () => {
  assert.equal(coverageComplete().complete, true)
  assert.ok(buildArchivedDetail().archived === true)
  assert.ok(buildSessionDetail().turns.length === 30)
})
