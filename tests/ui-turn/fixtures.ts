/*
 * tests/ui-turn/fixtures.ts —— T08 的**确定性**夹具（合成数据，不含真实会话内容）。
 *
 * 用途：单测（node --test）与截图（tests/harness）共用同一份数据，保证"图上看到的"与"断言断的"
 * 是同一个状态（06 §17：「每张图必须对应一个可复现的断言状态」）。
 *
 * 纪律：
 * - 不用 Date.now() / Math.random()：全部时间戳是固定常量；
 * - 关系边的证据文本用 `shared/relations` 的**真构造器**生成（不手写文案，A42-3 的"无假数据"）；
 * - 覆盖 30 轮 + 运行/中止/未知 + 子智能体 + 错误 + 命令失败 + 未确认引用 + 外部来源 + 归档会话。
 */
import type {
  CommandRecord,
  FileNode,
  SessionDetail,
  SessionSummary,
  TurnDetail,
  TurnEndKind,
  ThreadlineStatus,
  TurnFile,
} from '../../src/shared/events/index.ts'
import type { Coverage } from '../../src/client/data/index.ts'
import { degradeNone } from '../../src/client/data/index.ts'
import {
  coTurnEvidence,
  createEdge,
  referenceEvidence,
  sequenceEvidence,
  structureEvidence,
} from '../../src/shared/relations/index.ts'
import type {
  ExternalReference,
  GraphEdge,
  UnconfirmedReference,
} from '../../src/shared/relations/index.ts'
import type { InspectorData } from '../../src/client/ui/inspector/model.ts'

/** 基准时间：2026-11-04 09:41 本地时间（固定常量，截图与断言共用）。 */
export const BASE_TIME = new Date(2026, 10, 4, 9, 41, 0, 0).getTime()
const MINUTE = 60_000

const HOUR = 60 * MINUTE

const TITLE = '修复读模型指纹'

/** 轮次模板：时长（毫秒）、结束原因、文件、命令、子智能体、错误数。 */
interface TurnSpec {
  durationMs: number
  endKind?: TurnEndKind
  /** 无 end 事件（运行中/未知）。 */
  open?: boolean
  files?: TurnFile[]
  commands?: CommandRecord[]
  subagents?: string[]
  errors?: number
  toolCalls?: number
  toolFailures?: number
  userText?: string
  assistantText?: string
  plan?: { total: number; done: number }
}

function file(path: string, ops: TurnFile['ops'], added = 0, removed = 0): TurnFile {
  return { path, ops, added, removed }
}

function command(id: string, tool: string, program: string, status: CommandRecord['status'], durationMs: number, text?: string): CommandRecord {
  return {
    id,
    tool,
    program,
    status,
    startedAt: BASE_TIME,
    durationMs,
    ...(text === undefined ? {} : { text }),
  }
}

const SPECS: TurnSpec[] = [
  { durationMs: 2 * MINUTE, endKind: 'completed', files: [file('docs/facts/read-model.md', ['read'], 0, 0)], toolCalls: 3, userText: '先看一遍读模型的现状' },
  { durationMs: 5 * MINUTE, endKind: 'completed', files: [file('docs/facts/read-model.md', ['write'], 24, 3), file('src/client/data/merge.ts', ['read'], 0, 0)], toolCalls: 6 },
  {
    durationMs: 9 * MINUTE,
    endKind: 'completed',
    files: [
      file('src/client/data/merge.ts', ['write'], 12, 2),
      file('src/client/data/scope.ts', ['read']),
      file('src/client/ui/turns/merge-helpers.ts', ['write'], 30, 0),
      file('docs/facts/read-model.md', ['search']),
    ],
    commands: [command('c-3', 'shell', 'pnpm', 'success', 42_000, 'pnpm test')],
    toolCalls: 11,
    userText: '先把 scope 与 merge 的字段对齐，再跑一次测试',
  },
  { durationMs: 3 * MINUTE, endKind: 'completed', files: [file('src/client/data/scope.ts', ['write'], 7, 1)], errors: 1, toolCalls: 4, toolFailures: 1 },
  { durationMs: 40 * MINUTE, endKind: 'completed', files: [file('src/client/data/detail.ts', ['write'], 31, 6)], subagents: ['agent-reviewer'], toolCalls: 18 },
  { durationMs: 6 * MINUTE, endKind: 'completed', files: [file('src/client/data/detail.ts', ['read'])], commands: [command('c-6', 'shell', 'node', 'success', 3_000, 'node --test')], toolCalls: 5 },
  { durationMs: 12 * MINUTE, endKind: 'completed', files: [file('src/client/data/hooks.ts', ['write'], 9, 2), file('src/client/data/merge.ts', ['read'])], toolCalls: 8 },
  { durationMs: 1 * MINUTE, endKind: 'completed', toolCalls: 2 },
  { durationMs: 7 * MINUTE, endKind: 'completed', files: [file('docs/facts/read-model.md', ['write'], 4, 0)], toolCalls: 4 },
  { durationMs: 15 * MINUTE, endKind: 'completed', files: [file('src/shared/events/types.ts', ['read']), file('src/client/data/merge.ts', ['write'], 5, 3)], toolCalls: 9 },
  { durationMs: 22 * MINUTE, endKind: 'completed', commands: [command('c-11', 'shell', 'pnpm', 'error', 51_000, 'pnpm run typecheck')], errors: 1, toolCalls: 14, toolFailures: 1 },
  { durationMs: 33 * MINUTE, endKind: 'completed', files: [file('src/client/ui/turns/model.ts', ['write'], 88, 0)], subagents: ['agent-reviewer', 'agent-tester'], toolCalls: 21 },
  { durationMs: 4 * MINUTE, endKind: 'completed', files: [file('src/client/ui/turns/model.ts', ['write'], 6, 2)], toolCalls: 5 },
  { durationMs: 18 * MINUTE, endKind: 'completed', files: [file('src/client/ui/inspector/model.ts', ['write'], 140, 0)], toolCalls: 16 },
  { durationMs: 27 * MINUTE, endKind: 'completed', files: [file('src/client/ui/inspector/model.ts', ['write'], 22, 5), file('src/client/ui/turns/model.ts', ['read'])], toolCalls: 19, errors: 2 },
  { durationMs: 2 * MINUTE, endKind: 'completed', toolCalls: 1 },
  { durationMs: 11 * MINUTE, endKind: 'completed', files: [file('src/client/styles/turns.css', ['write'], 64, 0)], commands: [command('c-17', 'shell', 'node', 'success', 1_200, 'node tests/harness/emit-styles.mjs')], toolCalls: 7 },
  { durationMs: 8 * MINUTE, endKind: 'completed', files: [file('src/client/styles/inspector.css', ['write'], 120, 0)], toolCalls: 6 },
  { durationMs: 45 * MINUTE, endKind: 'completed', files: [file('src/client/ui/inspector/Inspector.ts', ['write'], 96, 0), file('src/client/ui/turns/TurnStrip.ts', ['write'], 40, 4)], toolCalls: 24 },
  { durationMs: 5 * MINUTE, endKind: 'completed', files: [file('src/client/ui/turns/TurnStrip.ts', ['write'], 8, 1)], commands: [command('c-20', 'shell', 'pnpm', 'success', 38_000, 'pnpm test'), command('c-21', 'shell', 'git', 'unknown', 0)], toolCalls: 9 },
  { durationMs: 14 * MINUTE, endKind: 'completed', plan: { total: 6, done: 3 }, toolCalls: 8 },
  { durationMs: 3 * MINUTE, endKind: 'completed', toolCalls: 3 },
  { durationMs: 19 * MINUTE, endKind: 'completed', files: [file('src/client/ui/inspector/FileInspector.ts', ['write'], 76, 2)], toolCalls: 12 },
  { durationMs: 26 * MINUTE, endKind: 'completed', toolCalls: 15 },
  { durationMs: 7 * MINUTE, endKind: 'completed', errors: 1, toolCalls: 6 },
  { durationMs: 31 * MINUTE, endKind: 'completed', files: [file('notes/31-脉络-1.0-交接/03-产品与交互规格.md', ['read'])], toolCalls: 13 },
  // T27：有结束事件但没有可识别的 reason.kind ⇒ 未知（不猜成功）
  { durationMs: 4 * MINUTE, toolCalls: 4 },
  // T28：中止
  { durationMs: 6 * MINUTE, endKind: 'aborted', errors: 1, toolCalls: 5 },
  // T29：错误（危险色，不写成"完成"）
  { durationMs: 9 * MINUTE, endKind: 'error', errors: 1, toolCalls: 7 },
  // T30：没有结束事件 + 会话在跑 ⇒ 运行中 + 「本轮仍在记录」
  { durationMs: 0, open: true, files: [file('src/client/ui/inspector/model.ts', ['write'], 12, 0)], toolCalls: 3, userText: '把字段核对表补上' },
]

/** 产生 30 轮（T1..T30）。 */
export function buildTurns(): TurnDetail[] {
  let cursor = BASE_TIME
  const turns: TurnDetail[] = []
  SPECS.forEach((spec, index) => {
    const n = index + 1
    const start = cursor
    const end = spec.open === true ? undefined : start + spec.durationMs
    cursor = (end ?? start) + 2 * MINUTE
    const turn: TurnDetail = {
      n,
      start,
      status: spec.open === true ? 'running' : spec.endKind === 'completed' ? 'completed' : spec.endKind === 'aborted' ? 'aborted' : 'unknown',
      files: spec.files ?? [],
      commands: spec.commands ?? [],
      subagents: spec.subagents ?? [],
      errors: spec.errors ?? 0,
      toolCalls: spec.toolCalls ?? 0,
      toolFailures: spec.toolFailures ?? 0,
      messageIds: ['m-' + String(n)],
      finalMessageId: 'm-' + String(n),
      ...(end === undefined ? {} : { end }),
      ...(spec.endKind === undefined ? {} : { endKind: spec.endKind }),
      ...(spec.userText === undefined ? {} : { userText: spec.userText }),
      ...(spec.assistantText === undefined ? {} : { assistantText: spec.assistantText }),
      ...(spec.plan === undefined ? {} : { plan: spec.plan }),
    }
    turns.push(turn)
  })
  return turns
}

/** 主会话（30 轮，运行中）。 */
export function buildSessionDetail(): SessionDetail {
  const turns = buildTurns()
  return {
    id: 'sess-alpha',
    rootId: 'sess-alpha',
    title: TITLE,
    cwd: 'E:/DSH/workspaces/myself/skill开发',
    startedAt: BASE_TIME,
    updatedAt: turns[turns.length - 1].start + 30_000,
    model: 'deepseek-v4.1-flash',
    provider: 'deepseek',
    status: 'running',
    running: true,
    turns,
    subagents: [
      { id: 'agent-reviewer', title: 'reviewer', status: 'completed' },
      { id: 'agent-tester', title: 'tester', status: 'running' },
    ],
    messageTurns: { 'm-30': 30 },
    errors: ['turn 4: read-failed', 'turn 11: typecheck-failed', 'turn 15: test-failed', 'turn 25: lint-failed'],
    counts: { turns: turns.length, steps: 0, toolCalls: 260, toolFailures: 2, files: 11, commands: 5, subagents: 2, errors: 4 },
    jobs: [],
  }
}

/** 归档会话（用于选择器排序与「归档」标记）。 */
export function buildArchivedDetail(): SessionDetail {
  return {
    id: 'sess-beta',
    rootId: 'sess-beta',
    title: '旧读模型试验',
    cwd: 'E:/DSH/workspaces/myself/skill开发',
    startedAt: BASE_TIME - 5 * HOUR,
    endedAt: BASE_TIME - 4 * HOUR,
    updatedAt: BASE_TIME - 4 * HOUR,
    status: 'completed',
    archived: true,
    turns: [
      {
        n: 1,
        start: BASE_TIME - 5 * HOUR,
        end: BASE_TIME - 5 * HOUR + 10 * MINUTE,
        status: 'completed',
        endKind: 'completed',
        files: [file('src/client/data/merge.ts', ['read'])],
        commands: [],
        subagents: [],
        errors: 0,
        toolCalls: 2,
        toolFailures: 0,
        messageIds: [],
      },
    ],
    subagents: [],
    messageTurns: {},
    errors: [],
    counts: { turns: 1, steps: 0, toolCalls: 2, toolFailures: 0, files: 1, commands: 0, subagents: 0, errors: 0 },
    jobs: [],
  }
}

/** 会话摘要（工作区列表）。 */
export function buildSummaries(): SessionSummary[] {
  return [
    {
      id: 'sess-alpha',
      rootId: 'sess-alpha',
      title: TITLE,
      cwd: 'E:/DSH/workspaces/myself/skill开发',
      archived: false,
      running: true,
      startedAt: BASE_TIME,
      updatedAt: BASE_TIME + 6 * HOUR,
      model: 'deepseek-v4.1-flash',
      provider: 'deepseek',
      status: 'running',
      turns: 30,
      files: 11,
      commands: 5,
      subagents: 2,
      errors: 4,
    },
    {
      id: 'sess-beta',
      rootId: 'sess-beta',
      title: '旧读模型试验',
      cwd: 'E:/DSH/workspaces/myself/skill开发',
      archived: true,
      running: false,
      startedAt: BASE_TIME - 5 * HOUR,
      endedAt: BASE_TIME - 4 * HOUR,
      updatedAt: BASE_TIME - 4 * HOUR,
      status: 'completed',
      turns: 1,
      files: 1,
      commands: 0,
      subagents: 0,
      errors: 0,
    },
  ]
}

/** 文件节点（文件检查器的标题/概览/统计来源）。 */
export function buildFiles(): Map<string, FileNode> {
  const map = new Map<string, FileNode>()
  const add = (node: FileNode): void => {
    map.set(node.path.toLowerCase(), node)
  }
  add({
    path: 'src/client/data/merge.ts',
    name: 'merge.ts',
    dir: 'src/client/data',
    family: 'code',
    firstAt: BASE_TIME + 2 * MINUTE,
    lastAt: BASE_TIME + 5 * HOUR,
    reads: 18,
    writes: 4,
    searches: 2,
    added: 120,
    removed: 8,
    ops: 24,
    sessionIds: ['sess-alpha', 'sess-beta'],
    sessionCount: 2,
    turnCount: 6,
  })
  add({
    path: 'src/client/ui/turns/model.ts',
    name: 'model.ts',
    dir: 'src/client/ui/turns',
    family: 'code',
    firstAt: BASE_TIME + 2 * HOUR,
    lastAt: BASE_TIME + 5 * HOUR,
    reads: 6,
    writes: 3,
    searches: 0,
    added: 134,
    removed: 3,
    ops: 9,
    sessionIds: ['sess-alpha'],
    sessionCount: 1,
    turnCount: 3,
  })
  add({
    path: 'docs/facts/read-model.md',
    name: 'read-model.md',
    dir: 'docs/facts',
    family: 'text',
    firstAt: BASE_TIME,
    lastAt: BASE_TIME + 3 * HOUR,
    reads: 5,
    writes: 2,
    searches: 0,
    added: 28,
    removed: 3,
    ops: 7,
    sessionIds: ['sess-alpha'],
    sessionCount: 1,
    turnCount: 3,
  })
  return map
}

/** 关系边（证据文本用真构造器）；含结构 / 同轮共现 / 引用 / 时序四种。 */
export function buildEdges(): GraphEdge[] {
  const target = 'src/client/data/merge.ts'
  const edges: GraphEdge[] = []
  edges.push(
    createEdge({
      type: 'structure',
      from: target,
      to: 'src/client/data/scope.ts',
      evidence: structureEvidence({ dir: 'src/client/data', from: target, to: 'src/client/data/scope.ts' }),
      confidence: 'estimated',
      directed: false,
    }),
  )
  edges.push(
    createEdge({
      type: 'coTurn',
      from: target,
      to: 'src/client/data/scope.ts',
      evidence: coTurnEvidence({ samples: [{ sessionId: 'sess-alpha', turn: 3 }], count: 2 }),
      confidence: 'confirmed',
      directed: false,
      weight: 2,
    }),
  )
  edges.push(
    createEdge({
      type: 'reference',
      from: 'docs/facts/read-model.md',
      to: target,
      evidence: referenceEvidence({
        line: 12,
        raw: '../../src/client/data/merge.ts',
        target,
        from: 'docs/facts/read-model.md',
        to: target,
      }),
      confidence: 'parsed',
      directed: true,
    }),
  )
  edges.push(
    createEdge({
      type: 'sequence',
      from: target,
      to: 'src/client/data/scope.ts',
      evidence: sequenceEvidence({ sessionId: 'sess-alpha', turn: 3, order: 1, from: target, to: 'src/client/data/scope.ts' }),
      confidence: 'confirmed',
      directed: true,
    }),
  )
  return edges
}

/** 未确认引用（目标不在已触碰集合 ⇒ 不画边，只在文件检查器列出）。 */
export function buildUnconfirmed(): UnconfirmedReference[] {
  return [
    {
      from: 'src/client/data/merge.ts',
      raw: './legacy-view-model.json',
      target: 'src/client/data/legacy-view-model.json',
      line: 3,
      reason: 'not-found',
      exists: false,
    },
    {
      from: 'src/client/data/merge.ts',
      raw: '../shared/old-types',
      target: 'src/client/shared/old-types',
      line: 9,
      reason: 'no-extension',
    },
    {
      from: 'docs/facts/read-model.md',
      raw: 'https://example.invalid/spec',
      target: 'https://example.invalid/spec',
      line: 20,
      reason: 'outside-workspace',
    },
  ]
}

/** 外部来源（只读展示）。 */
export function buildExternal(): ExternalReference[] {
  return [
    { from: 'src/client/data/merge.ts', raw: 'https://example.invalid/read-model', line: 7 },
    { from: 'src/client/data/merge.ts', raw: 'https://other.invalid/threadline', line: 21 },
  ]
}

/** 覆盖率（完整、已知）。 */
export function coverageComplete(): Coverage {
  return {
    total: 42,
    scanned: 42,
    failed: 1,
    cached: 3,
    loadedFiles: 3,
    loadedEdges: 5,
    loadedSessions: 2,
    phase: 'complete',
    known: true,
    truncated: false,
    complete: true,
  }
}

/** 覆盖率（未知：还没收到真实进度 ⇒ 禁止把 0 当成数据）。 */
export function coverageUnknown(): Coverage {
  return {
    total: 0,
    scanned: 0,
    failed: 0,
    cached: 0,
    loadedFiles: 0,
    loadedEdges: 0,
    loadedSessions: 0,
    phase: 'starting',
    known: false,
    truncated: false,
    complete: false,
  }
}

/** 检查器完整输入。 */
export function buildInspectorData(): InspectorData {
  const alpha = buildSessionDetail()
  const beta = buildArchivedDetail()
  return {
    sessions: buildSummaries(),
    details: new Map([
      [alpha.id, alpha],
      [beta.id, beta],
    ]),
    files: buildFiles(),
    edges: buildEdges(),
    unconfirmed: buildUnconfirmed(),
    external: buildExternal(),
    coverage: coverageComplete(),
    degrade: degradeNone(),
    currentSessionId: alpha.id,
  }
}

/** 30 轮夹具的"现在"：最后一条记录之后 30 秒。 */
export function fixtureNow(): number {
  const turns = buildTurns()
  const last = turns[turns.length - 1]
  return (last.end ?? last.start) + 30_000
}

/** 会话状态标签的原始值（断言用，不参与 UI）。 */
export const FIXTURE_STATUSES: Record<number, ThreadlineStatus> = { 27: 'unknown', 28: 'aborted', 29: 'unknown', 30: 'running' }
