/*
 * inspector/model.ts —— 检查器的**纯逻辑**（03 §8；06 A42-2 / A42-3）。
 *
 * 三种检查器 + 工作区概览的全部字段都在这里一次算好（组件只渲染）：
 * - 文件：标题（basename + 相对路径 + 族）/ 概览（首见·最近·ops·≈增删行）/ 操作统计 /
 *   触碰历史（≤50 + 还有 N 条）/ 关系（结构·共现·引用·时序，每条带 evidence 文本）/ 未确认引用 /
 *   外部来源 / 动作；
 * - 轮次：标题·状态·时长 / 用户意图（默认折叠、隐私隐藏）/ 工具（总·失败·未知，按工具名分组）/
 *   文件（新增·修改·读取·搜索 + ≈行数）/ 命令 / 子智能体 / 计划 / 错误·未知 / 后续触碰（≤20）/
 *   与上一轮对比 / 动作；
 * - 会话：标题·状态 / 概览 / 模型（只作标签，不做成本·token）/ 工作线 / 最近 10 轮 / 动作；
 * - 概览：覆盖率 / 当前工作线 / 计数（不做大 KPI 卡）/ 图例与图层开关位。
 *
 * 纪律：
 * - 不伪造：未知一律 `null` 或 `unknown`，不用 0 顶替；`≈` 行数显式标注「按工具参数估算」；
 * - 未确认引用**不画边**（本层只列出来）；关系证据文本**只取边自带的 `evidence.text`**，不在这里造句；
 * - 文案全部来自 locale（`copy.ts` 是唯一映射点）；
 * - 纯函数，无 React / DOM / IO，可在 node --test 里直接断言。
 */
import type {
  CommandRecord,
  FileFamily,
  FileNode,
  FileOp,
  SessionDetail,
  SessionSummary,
  ThreadlineStatus,
  TurnDetail,
  TurnFile,
} from '../../../shared/events/index.ts'
import type { ExternalReference, GraphEdge, RelationType, UnconfirmedReference } from '../../../shared/relations/index.ts'
import { REFERENCE_SKIP_LABELS, RELATION_LAYER_DEFAULTS } from '../../../shared/relations/index.ts'
import type { Coverage, DegradeState } from '../../data/index.ts'
import type { Translator } from '../../locale/index.ts'
import {
  baseName,
  commandProgram,
  commandSummary,
  dateTimeOfDay,
  dirName,
  externalLabel,
  formatClock,
  isTurnPartial,
  maskPath,
  maskPathsInText,
  sessionStatusKey,
  sessionTitle,
  turnDurationMs,
  turnStatusLabel,
  turnStatusOf,
  type TurnStatusView,
} from '../turns/index.ts'
import { INSPECTOR_COPY, commandStatusLabel, familyLabel, label, opLabel } from './copy.ts'

/* ------------------------------------------------------------------ *
 * 0. 上限（03 §8.1 / §8.2；06 N-10：超限必须显式）
 * ------------------------------------------------------------------ */

export const INSPECTOR_LIMITS = {
  /** 触碰历史最多 50 条（03 §8.1）。 */
  touchHistory: 50,
  /** 后续触碰最多 20 条（03 §8.2）。 */
  laterTouches: 20,
  /** 会话检查器的最近轮次数（03 §8.3）。 */
  recentTurns: 10,
  /** 每组关系最多列出的行数（更多的用 relations.collapsed 汇总）。 */
  relationsPerGroup: 12,
  /** 命令/文件/子智能体列表最多列出的行数。 */
  listRows: 20,
} as const

/* ------------------------------------------------------------------ *
 * 1. 输入
 * ------------------------------------------------------------------ */

/** 检查器需要的只读数据（全部由 T09 从数据层取好传进来；这里不发起任何请求）。 */
export interface InspectorData {
  /** 工作区会话摘要（顺序 = 视图顺序，用于隐私编号与父/子解析）。 */
  sessions: readonly SessionSummary[]
  /** 已加载的会话详情（按 sessionId）。 */
  details: ReadonlyMap<string, SessionDetail>
  /** 工作区文件节点（key = 小写路径，与数据层一致）。 */
  files: ReadonlyMap<string, FileNode>
  /** 关系边（已过 finalizeGraph）。 */
  edges: readonly GraphEdge[]
  /** 未确认引用（不画边，只在文件检查器列出）。 */
  unconfirmed: readonly UnconfirmedReference[]
  /** 外部来源（只读展示）。 */
  external: readonly ExternalReference[]
  coverage: Coverage
  degrade: DegradeState
  /** 当前会话 id（概览里的"当前工作线"、会话默认选择都基于它）。 */
  currentSessionId: string
}

/** 构建上下文。 */
export interface InspectorContext {
  data: InspectorData
  privacyMode: boolean
  /** 未结束轮次的"进行中"时长基准。 */
  now: number
  t: Translator
}

/** 字段清单（与 03 §8 逐条对账；测试断言"无缺项"）。 */
export const FILE_INSPECTOR_FIELDS = [
  'title',
  'overview',
  'operationStats',
  'touchHistory',
  'relations',
  'unconfirmed',
  'external',
  'actions',
] as const

export const TURN_INSPECTOR_FIELDS = [
  'title',
  'intent',
  'tools',
  'files',
  'commands',
  'subagents',
  'plan',
  'errors',
  'laterTouches',
  'prevTurn',
  'actions',
] as const

export const SESSION_INSPECTOR_FIELDS = [
  'title',
  'overview',
  'model',
  'workline',
  'recentTurns',
  'actions',
] as const

export const OVERVIEW_FIELDS = ['coverage', 'workline', 'counts', 'legend', 'layerToggles'] as const

export type FileInspectorField = (typeof FILE_INSPECTOR_FIELDS)[number]
export type TurnInspectorField = (typeof TURN_INSPECTOR_FIELDS)[number]
export type SessionInspectorField = (typeof SESSION_INSPECTOR_FIELDS)[number]
export type OverviewField = (typeof OVERVIEW_FIELDS)[number]

/* ------------------------------------------------------------------ *
 * 2. 小工具
 * ------------------------------------------------------------------ */

/** 会话在视图里的编号（隐私模式「会话 n」用）。 */
export function sessionOrder(data: InspectorData): string[] {
  return data.sessions
    .slice()
    .sort((a, b) => {
      if (a.archived !== b.archived) return a.archived ? 1 : -1
      return b.updatedAt - a.updatedAt
    })
    .map((session) => session.id)
}

/** 会话展示名（隐私模式 = 会话 n；否则标题或短 id）。 */
export function sessionDisplay(data: InspectorData, sessionId: string, privacyMode: boolean, t: Translator): string {
  const order = sessionOrder(data)
  const index = order.indexOf(sessionId)
  const summary = data.sessions.find((session) => session.id === sessionId)
  const detail = data.details.get(sessionId)
  const title = summary?.title ?? detail?.title
  return sessionTitle({ sessionId, ...(title === undefined ? {} : { title }) }, index < 0 ? 0 : index, privacyMode, t)
}

/** `≈ +24 / −3`（行数是按工具参数估算，调用方必须同时显示 `inspector.lineDelta`）。 */
export function deltaText(added: number, removed: number): string {
  return '≈ +' + String(added) + ' / −' + String(removed)
}

/** 一行摘要（折叠态用；不是正文全文，不泄漏长文本）。 */
export function excerpt(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= max) return flat
  return flat.slice(0, Math.max(0, max - 1)) + '…'
}

/**
 * 关系证据的展示文本：非隐私模式**原样**用边自带的 `evidence.text`（单一事实源）；
 * 隐私模式把路径片段换成 basename、把会话短 id 换成「会话 n」（03 §12.2），不改共享层。
 */
function evidenceText(
  data: InspectorData,
  text: string,
  privacyMode: boolean,
  t: Translator,
): string {
  if (!privacyMode) return text
  let out = maskPathsInText(text)
  sessionOrder(data).forEach((sessionId, index) => {
    const short = sessionId.length <= 8 ? sessionId : sessionId.slice(0, 8)
    out = out.split(short).join(t('inspector.session') + ' ' + String(index + 1))
  })
  return out
}

/** 路径按隐私模式掩码。 */
function shownPath(path: string, privacyMode: boolean): string {
  return maskPath(path, privacyMode)
}

/** 文件节点查找（大小写不敏感，与数据层身份键一致）。 */
export function findFile(data: InspectorData, path: string): FileNode | undefined {
  return data.files.get(path.toLowerCase()) ?? data.files.get(path)
}

/** 所有已加载详情（按 data.sessions 顺序，未加载的跳过）。 */
function loadedDetails(data: InspectorData): Array<{ sessionId: string; detail: SessionDetail }> {
  const list: Array<{ sessionId: string; detail: SessionDetail }> = []
  const seen = new Set<string>()
  for (const session of data.sessions) {
    const detail = data.details.get(session.id)
    if (detail !== undefined && !seen.has(session.id)) {
      seen.add(session.id)
      list.push({ sessionId: session.id, detail })
    }
  }
  // 不在 sessions 列表里但已加载的详情（例如子智能体会话详情）也纳入，避免"数据在手却看不见"。
  for (const [sessionId, detail] of data.details) {
    if (!seen.has(sessionId)) list.push({ sessionId, detail })
  }
  return list
}

function samePath(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase()
}

/* ------------------------------------------------------------------ *
 * 3. 文件检查器
 * ------------------------------------------------------------------ */

export type TouchOpFilter = 'read' | 'write' | 'search'

/** 一条触碰（会话 → 轮次 → 时间 → 操作类型 → ≈行数）。 */
export interface FileTouchRow {
  key: string
  sessionId: string
  sessionLabel: string
  turn: number | null
  timeText: string
  /** 操作类型标签（读取/写入/搜索）。 */
  opsLabel: string
  deltaText: string
  /** 是否发生在参考轮次之后（后续触碰用）。 */
  later: boolean
}

export interface FileTouchEntry {
  sessionId: string
  turn: number | null
  at: number
  ops: FileOp[]
  added: number
  removed: number
  seq: number
}

/**
 * 该文件的所有触碰（跨会话、按时间正序）。
 * 来源：已加载会话详情里的 `turn.files` + `unassigned.files`（归属不明的记录照实列出，turn=null）。
 */
export function collectFileTouches(data: InspectorData, path: string): FileTouchEntry[] {
  const entries: FileTouchEntry[] = []
  let seq = 0
  for (const { detail } of loadedDetails(data)) {
    for (const turn of detail.turns) {
      for (const file of turn.files) {
        if (!samePath(file.path, path)) continue
        seq += 1
        entries.push({
          sessionId: detail.id,
          turn: turn.n,
          at: turn.start,
          ops: file.ops.slice(),
          added: file.added,
          removed: file.removed,
          seq,
        })
      }
    }
    const unassigned = detail.unassigned
    if (unassigned !== undefined) {
      for (const touch of unassigned.files) {
        if (!samePath(touch.path, path)) continue
        seq += 1
        entries.push({
          sessionId: detail.id,
          turn: null,
          at: touch.lastAt,
          ops: touch.ops.slice(),
          added: touch.added,
          removed: touch.removed,
          seq,
        })
      }
    }
  }
  entries.sort((a, b) => (a.at === b.at ? a.seq - b.seq : a.at - b.at))
  return entries
}

/** 触碰行（供渲染）。 */
export function toTouchRows(
  data: InspectorData,
  entries: readonly FileTouchEntry[],
  ctx: { privacyMode: boolean; t: Translator },
): FileTouchRow[] {
  return entries.map((entry) => ({
    key: entry.sessionId + ':' + String(entry.turn ?? 'x') + ':' + String(entry.seq),
    sessionId: entry.sessionId,
    sessionLabel: sessionDisplay(data, entry.sessionId, ctx.privacyMode, ctx.t),
    turn: entry.turn,
    timeText: dateTimeOfDay(entry.at),
    opsLabel: entry.ops.map((op) => opLabel(op, ctx.t)).join(' · '),
    deltaText: entry.ops.includes('write') ? deltaText(entry.added, entry.removed) : '—',
    later: false,
  }))
}

export interface FileRelationRow {
  key: string
  /** 对端文件（工作区相对路径，隐私模式只留 basename）。 */
  target: string
  rawTarget: string
  /** 证据文本（**直接取边的 `evidence.text`**，不在 UI 层造句）。 */
  evidence: string
  confidence: string
  weight: number
}

export interface FileRelationGroup {
  type: RelationType
  title: string
  rows: FileRelationRow[]
  /** 该组被收拢的行数（>0 时显示 relations.collapsed）。 */
  hidden: number
}

export interface UnconfirmedRow {
  path: string
  line: number
  reasonLabel: string
  /** 完整一句话（`describeUnconfirmedReference` 同款信息，但在这里用已本地化的原因拼）。 */
  text: string
}

export interface ExternalRow {
  /** 可见文本：隐私模式只有域名（03 §12.2）。 */
  label: string
  /** 悬停标题：隐私模式同样只给域名，避免通过 title 泄漏完整 URL。 */
  title: string
  raw: string
  line: number
}

export interface FileInspectorModel {
  kind: 'file'
  /** 标题：basename + 相对路径 + 族（03 §8.1 第一行）。 */
  title: { name: string; path: string; dir: string; family: FileFamily; familyLabel: string }
  path: string
  displayPath: string
  name: string
  dir: string
  family: FileFamily
  familyLabel: string
  overview: {
    firstSeenAt: number | null
    firstSeenText: string
    firstSeenSession: string | null
    firstSeenTurn: number | null
    lastTouchedAt: number | null
    lastTouchedText: string
    lastTouchedSession: string | null
    lastTouchedTurn: number | null
    ops: number
    added: number
    removed: number
    estimateNote: string
  }
  operationStats: Array<{ key: 'read' | 'write' | 'search' | 'command'; label: string; count: number }>
  touchHistory: { rows: FileTouchRow[]; total: number; hidden: number; moreText: string | null }
  relations: { groups: FileRelationGroup[]; total: number; collapsedText: string | null }
  unconfirmed: UnconfirmedRow[]
  external: ExternalRow[]
  actions: { openFile: string; focusInMap: string; close: string }
  fields: FileInspectorField[]
  /** 数据是否不完整（详情没加载全 / 触碰被上限截断）。 */
  partial: boolean
  /** 文件节点缺失时的显式空态（不画假字段）。 */
  missing: boolean
}

const RELATION_GROUP_ORDER: readonly RelationType[] = ['structure', 'coTurn', 'coSession', 'reference', 'sequence']

function relationTypeLabel(type: RelationType, t: Translator): string {
  switch (type) {
    case 'structure':
      return label(INSPECTOR_COPY.relationsStructure, '−', t)
    case 'coTurn':
      return label(INSPECTOR_COPY.relationsCoTurn, '≈', t)
    case 'coSession':
      return label(INSPECTOR_COPY.relationsCoSession, '≈≈', t)
    case 'reference':
      return label(INSPECTOR_COPY.relationsReference, '→', t)
    case 'sequence':
    default:
      return label(INSPECTOR_COPY.relationsSequence, '›', t)
  }
}

/**
 * 文件检查器模型。
 * `path` 用工作区相对路径（原样大小写）；查不到节点时返回 `missing: true` 的模型（不伪造字段值）。
 */
export function buildFileInspector(path: string, ctx: InspectorContext): FileInspectorModel {
  const { data, privacyMode, t } = ctx
  const node = findFile(data, path)
  const touches = collectFileTouches(data, path)
  const touchRows = toTouchRows(data, touches, { privacyMode, t })
  const totalTouches = touchRows.length
  const shownTouches = touchRows.slice(Math.max(0, totalTouches - INSPECTOR_LIMITS.touchHistory))
  const hiddenTouches = totalTouches - shownTouches.length

  const first = touches.length > 0 ? touches[0] : undefined
  const last = touches.length > 0 ? touches[touches.length - 1] : undefined
  const firstSession = first === undefined ? null : sessionDisplay(data, first.sessionId, privacyMode, t)
  const lastSession = last === undefined ? null : sessionDisplay(data, last.sessionId, privacyMode, t)

  const writes = touches.filter((entry) => entry.ops.includes('write'))
  const added = writes.reduce((sum, entry) => sum + entry.added, 0)
  const removed = writes.reduce((sum, entry) => sum + entry.removed, 0)

  // 操作统计：读/写/搜索 取文件节点计数（工作区口径）；命令关联 = 「触碰该文件且该轮有命令」的轮次数。
  const commandTurns = new Set<string>()
  for (const { detail } of loadedDetails(data)) {
    for (const turn of detail.turns) {
      if (turn.commands.length === 0) continue
      if (turn.files.some((file) => samePath(file.path, path))) {
        commandTurns.add(detail.id + ':' + String(turn.n))
      }
    }
  }
  const operationStats = [
    { key: 'read' as const, label: opLabel('read', t), count: node?.reads ?? touches.filter((entry) => entry.ops.includes('read')).length },
    { key: 'write' as const, label: opLabel('write', t), count: node?.writes ?? writes.length },
    { key: 'search' as const, label: opLabel('search', t), count: node?.searches ?? touches.filter((entry) => entry.ops.includes('search')).length },
    { key: 'command' as const, label: label(INSPECTOR_COPY.opsCommand, '⌘', t), count: commandTurns.size },
  ]

  const relatedEdges = data.edges.filter((edge) => samePath(edge.from, path) || samePath(edge.to, path))
  const groups: FileRelationGroup[] = []
  let relatedTotal = 0
  let collapsedTotal = 0
  for (const type of RELATION_GROUP_ORDER) {
    const edges = relatedEdges.filter((edge) => edge.type === type)
    if (edges.length === 0) continue
    relatedTotal += edges.length
    const rows: FileRelationRow[] = edges.slice(0, INSPECTOR_LIMITS.relationsPerGroup).map((edge) => {
      const otherRaw = samePath(edge.from, path) ? edge.to : edge.from
      return {
        key: edge.id,
        target: shownPath(otherRaw, privacyMode),
        rawTarget: otherRaw,
        evidence: evidenceText(data, edge.evidence.text, privacyMode, t),
        confidence: edge.confidence,
        weight: edge.weight,
      }
    })
    const hidden = edges.length - rows.length
    collapsedTotal += hidden
    groups.push({ type, title: relationTypeLabel(type, t), rows, hidden })
  }

  const unconfirmed: UnconfirmedRow[] = data.unconfirmed
    .filter((item) => samePath(item.from, path))
    .slice(0, INSPECTOR_LIMITS.listRows)
    .map((item) => ({
      path: shownPath(item.target, privacyMode),
      line: item.line,
      reasonLabel: REFERENCE_SKIP_LABELS[item.reason],
      text: String(item.line) + ' · ' + shownPath(item.target, privacyMode) + ' — ' + REFERENCE_SKIP_LABELS[item.reason],
    }))

  const external: ExternalRow[] = data.external
    .filter((item) => samePath(item.from, path))
    .slice(0, INSPECTOR_LIMITS.listRows)
    .map((item) => ({
      label: externalLabel(item.raw, privacyMode),
      title: externalLabel(item.raw, privacyMode),
      raw: item.raw,
      line: item.line,
    }))

  const moreRows = hiddenTouches > 0 ? t('inspector.more', { n: hiddenTouches }) : null
  const collapsedText = collapsedTotal > 0 ? t('relations.collapsed', { n: collapsedTotal }) : null

  const shownName = privacyMode ? baseName(path) : (node?.name ?? baseName(path))
  const shownDir = privacyMode ? '' : (node?.dir ?? dirName(path))

  return {
    kind: 'file',
    title: {
      name: shownName,
      path: shownPath(path, privacyMode),
      dir: shownDir,
      family: node?.family ?? 'other',
      familyLabel: familyLabel(node?.family ?? 'other', t),
    },
    path,
    displayPath: shownPath(path, privacyMode),
    name: shownName,
    dir: shownDir,
    family: node?.family ?? 'other',
    familyLabel: familyLabel(node?.family ?? 'other', t),
    overview: {
      firstSeenAt: first?.at ?? node?.firstAt ?? null,
      firstSeenText: dateTimeOfDay(first?.at ?? node?.firstAt),
      firstSeenSession: firstSession,
      firstSeenTurn: first?.turn ?? null,
      lastTouchedAt: last?.at ?? node?.lastAt ?? null,
      lastTouchedText: dateTimeOfDay(last?.at ?? node?.lastAt),
      lastTouchedSession: lastSession,
      lastTouchedTurn: last?.turn ?? null,
      ops: node?.ops ?? touches.length,
      added,
      removed,
      estimateNote: t('inspector.lineDelta'),
    },
    operationStats,
    touchHistory: { rows: shownTouches, total: totalTouches, hidden: hiddenTouches, moreText: moreRows },
    relations: { groups, total: relatedTotal, collapsedText },
    unconfirmed,
    external,
    actions: {
      openFile: t('inspector.openFile'),
      focusInMap: label(INSPECTOR_COPY.focusInMap, '◎', t),
      close: t('ui.close'),
    },
    fields: [...FILE_INSPECTOR_FIELDS],
    partial: data.details.size < data.sessions.length || (node === undefined && touches.length > 0),
    missing: node === undefined && touches.length === 0,
  }
}

/* ------------------------------------------------------------------ *
 * 4. 轮次检查器
 * ------------------------------------------------------------------ */

export interface TurnFileRow {
  path: string
  deltaText: string
}

export interface TurnCommandRow {
  id: string
  program: string
  /** 命令摘要（隐私模式为 null → 不渲染折叠入口）。 */
  summary: string | null
  status: 'success' | 'error' | 'unknown'
  statusLabel: string
  durationText: string
  truncated: boolean
}

export interface LaterTouchRow {
  key: string
  sessionId: string
  path: string
  sessionLabel: string
  turn: number | null
  timeText: string
  opsLabel: string
}

export interface TurnInspectorModel {
  kind: 'turn'
  sessionId: string
  sessionLabel: string
  turn: number
  title: string
  status: TurnStatusView
  statusLabel: string
  durationText: string
  partial: boolean
  partialLabel: string
  conversation: {
    /** 首条用户消息（正文；隐私模式与默认折叠都由组件控制）。 */
    userText: string | null
    assistantText: string | null
    endKind: string | null
  }
  intent: {
    available: boolean
    /** 折叠时显示的一行摘要（≤32 字符，超出以 … 结尾；**不是**正文全文）。 */
    preview: string | null
    /** 展开后的截断正文（隐私模式为 null；组件只在用户点开后挂载）。 */
    text: string | null
    hidden: boolean
  }
  tools: {
    total: number
    failed: number
    unknown: number
    /** 没有状态明细的调用数（toolCalls 减去命令记录条数，>0 时显式标为不确定）。 */
    unrecorded: number
    rows: Array<{ tool: string; total: number; failed: number; unknown: number }>
  }
  files: {
    added: TurnFileRow[]
    modified: TurnFileRow[]
    read: TurnFileRow[]
    searched: TurnFileRow[]
    addedLines: number
    removedLines: number
    estimateNote: string
  }
  commands: TurnCommandRow[]
  subagents: Array<{ id: string; title: string; statusLabel: string | null }>
  plan: { total: number; done: number } | null
  planText: string
  errors: { messages: string[]; failedCommands: number; unknownCommands: number }
  laterTouches: { rows: LaterTouchRow[]; total: number; hidden: number; moreText: string | null }
  prevTurn: { turn: number | null; added: string[]; reused: string[]; addedLabel: string; reusedLabel: string }
  actions: {
    openSession: string
    focusInMap: string
    openModal: string
    close: string
  }
  fields: TurnInspectorField[]
  missing: boolean
}

/** 文件在轮次里的归类：写过的按「本轮是否首次出现」分新增/修改；只读/只搜各归一栏。 */
function classifyTurnFiles(
  turn: TurnDetail,
  earlier: ReadonlySet<string>,
  privacyMode: boolean,
): { added: TurnFileRow[]; modified: TurnFileRow[]; read: TurnFileRow[]; searched: TurnFileRow[] } {
  const added: TurnFileRow[] = []
  const modified: TurnFileRow[] = []
  const read: TurnFileRow[] = []
  const searched: TurnFileRow[] = []
  const push = (list: TurnFileRow[], file: TurnFile): void => {
    list.push({ path: shownPath(file.path, privacyMode), deltaText: deltaText(file.added, file.removed) })
  }
  for (const file of turn.files) {
    const key = file.path.toLowerCase()
    if (file.ops.includes('write')) {
      if (earlier.has(key)) push(modified, file)
      else push(added, file)
    } else if (file.ops.includes('read')) {
      push(read, file)
    } else if (file.ops.includes('search')) {
      push(searched, file)
    } else {
      push(read, file)
    }
  }
  return { added, modified, read, searched }
}

function turnOf(detail: SessionDetail, n: number): TurnDetail | undefined {
  return detail.turns.find((turn) => turn.n === n)
}

function earlierFiles(detail: SessionDetail, n: number): Set<string> {
  const set = new Set<string>()
  for (const turn of detail.turns) {
    if (turn.n >= n) continue
    for (const file of turn.files) set.add(file.path.toLowerCase())
  }
  return set
}

/** 轮次检查器模型（`sessionId + n` 必须能在已加载详情里找到，否则 `missing: true`）。 */
export function buildTurnInspector(sessionId: string, n: number, ctx: InspectorContext): TurnInspectorModel {
  const { data, privacyMode, now, t } = ctx
  const detail = data.details.get(sessionId)
  const turn = detail === undefined ? undefined : turnOf(detail, n)
  const sessionLabel = sessionDisplay(data, sessionId, privacyMode, t)
  const running = detail?.running === true || detail?.status === 'running'
  const partial = turn === undefined ? false : isTurnPartial(turn, { sessionRunning: running, sessionPartial: detail?.partial === true })
  const status: TurnStatusView = turn === undefined ? 'unknown' : turnStatusOf(turn, { sessionRunning: running, sessionPartial: detail?.partial === true })
  const durationText = turn === undefined ? '—' : formatClock(turnDurationMs(turn, partial ? now : undefined))

  // 工具：总数/失败数来自记录；「未知」只统计记录里明确 unknown 的命令；
  // 命令记录之外的调用单独记成 unrecorded（不假装它们成功）。
  const commands = turn?.commands ?? []
  const failedCommands = commands.filter((command) => command.status === 'error').length
  const unknownCommands = commands.filter((command) => command.status === 'unknown').length
  const rowsByTool = new Map<string, { tool: string; total: number; failed: number; unknown: number }>()
  for (const command of commands) {
    const key = command.tool === '' ? '?' : command.tool
    const row = rowsByTool.get(key) ?? { tool: key, total: 0, failed: 0, unknown: 0 }
    row.total += 1
    if (command.status === 'error') row.failed += 1
    if (command.status === 'unknown') row.unknown += 1
    rowsByTool.set(key, row)
  }
  const toolRows = Array.from(rowsByTool.values()).sort((a, b) => b.total - a.total || a.tool.localeCompare(b.tool))
  const commandCount = commands.length
  const toolCalls = turn?.toolCalls ?? 0
  const unrecorded = Math.max(0, toolCalls - commandCount)

  // 文件：本轮 vs 之前轮次
  const earlier = detail === undefined || turn === undefined ? new Set<string>() : earlierFiles(detail, turn.n)
  const classified = turn === undefined
    ? { added: [], modified: [], read: [], searched: [] }
    : classifyTurnFiles(turn, earlier, privacyMode)
  const addedLines = turn === undefined ? 0 : turn.files.reduce((sum, file) => (file.ops.includes('write') ? sum + file.added : sum), 0)
  const removedLines = turn === undefined ? 0 : turn.files.reduce((sum, file) => (file.ops.includes('write') ? sum + file.removed : sum), 0)

  // 子智能体：turn.subagents 是 id 列表，名字/状态从会话详情或工作区会话列表里取（取不到就不编）。
  const subagents = (turn?.subagents ?? []).map((id) => {
    const record = detail?.subagents.find((item) => item.id === id)
    const summary = data.sessions.find((session) => session.id === id)
    const title = summary?.title ?? record?.title ?? id.slice(0, 8)
    const statusValue = record?.status ?? summary?.status
    return {
      id,
      title,
      statusLabel: statusValue === undefined ? null : sessionStatusLabel(statusValue, t),
    }
  })

  // 命令
  const commandRows: TurnCommandRow[] = (turn?.commands ?? []).slice(0, INSPECTOR_LIMITS.listRows).map((command: CommandRecord) => ({
    id: command.id,
    program: commandProgram(command),
    summary: commandSummary(command, privacyMode),
    status: command.status,
    statusLabel: commandStatusLabel(command.status, t),
    durationText: formatClock(command.durationMs),
    truncated: command.truncated === true,
  }))

  // 错误 / 未知：会话 errors 里属于本轮的条目（格式 `turn n: code`，只做前缀匹配，不猜）
  const prefix = 'turn ' + String(n) + ': '
  const errorMessages = (detail?.errors ?? []).filter((message) => message.startsWith(prefix)).map((message) => message.slice(prefix.length))

  // 后续触碰：这些文件在后续轮次/会话中被谁动过（≤20）
  const laterRows: LaterTouchRow[] = []
  let laterTotal = 0
  if (turn !== undefined) {
    const paths = turn.files.map((file) => file.path)
    for (const { sessionId: otherSession, detail: otherDetail } of loadedDetails(data)) {
      for (const otherTurn of otherDetail.turns) {
        const isLater =
          otherSession === sessionId ? otherTurn.n > turn.n : otherDetail.startedAt > turn.start
        if (!isLater) continue
        for (const file of otherTurn.files) {
          if (!paths.some((path) => samePath(path, file.path))) continue
          laterTotal += 1
          if (laterRows.length >= INSPECTOR_LIMITS.laterTouches) continue
          laterRows.push({
            key: otherSession + ':' + String(otherTurn.n) + ':' + file.path.toLowerCase(),
            sessionId: otherSession,
            path: shownPath(file.path, privacyMode),
            sessionLabel: sessionDisplay(data, otherSession, privacyMode, t),
            turn: otherTurn.n,
            timeText: dateTimeOfDay(otherTurn.start),
            opsLabel: file.ops.map((op) => opLabel(op, t)).join(' · '),
          })
        }
      }
    }
  }

  // 与上一轮对比
  const previous = detail !== undefined ? detail.turns.filter((item) => item.n < n).sort((a, b) => b.n - a.n)[0] : undefined
  const prevAdded: string[] = []
  const prevReused: string[] = []
  if (turn !== undefined) {
    for (const file of turn.files) {
      const key = file.path.toLowerCase()
      if (earlier.has(key)) prevReused.push(shownPath(file.path, privacyMode))
      else prevAdded.push(shownPath(file.path, privacyMode))
    }
  }

  return {
    kind: 'turn',
    sessionId,
    sessionLabel,
    turn: n,
    title: 'T' + String(n),
    status,
    statusLabel: turnStatusLabel(status, t),
    durationText,
    partial,
    partialLabel: t('state.partialTurn'),
    conversation: {
      userText: turn?.userText ?? null,
      assistantText: turn?.assistantText ?? null,
      endKind: turn?.endKind ?? null,
    },
    intent: {
      available: turn?.userText !== undefined && turn.userText !== '',
      preview: privacyMode || turn?.userText === undefined ? null : excerpt(turn.userText, 32),
      text: privacyMode ? null : (turn?.userText ?? null),
      hidden: privacyMode,
    },
    tools: {
      total: toolCalls,
      failed: turn?.toolFailures ?? 0,
      unknown: unknownCommands,
      unrecorded,
      rows: toolRows,
    },
    files: {
      ...classified,
      addedLines,
      removedLines,
      estimateNote: t('inspector.lineDelta'),
    },
    commands: commandRows,
    subagents,
    plan: turn?.plan ?? null,
    planText: turn?.plan !== undefined ? String(turn.plan.done) + '/' + String(turn.plan.total) : '—',
    errors: { messages: errorMessages, failedCommands, unknownCommands },
    laterTouches: {
      rows: laterRows,
      total: laterTotal,
      hidden: Math.max(0, laterTotal - laterRows.length),
      moreText: laterTotal > laterRows.length ? t('inspector.more', { n: laterTotal - laterRows.length }) : null,
    },
    prevTurn: {
      turn: previous?.n ?? null,
      added: prevAdded,
      reused: prevReused,
      addedLabel: t('inspector.filesAdded'),
      reusedLabel: t('inspector.reused'),
    },
    actions: {
      openSession: t('inspector.openSession'),
      focusInMap: label(INSPECTOR_COPY.focusInMap, '◎', t),
      openModal: t('impact.openModal'),
      close: t('ui.close'),
    },
    fields: [...TURN_INSPECTOR_FIELDS],
    missing: turn === undefined,
  }
}

function sessionStatusLabel(status: ThreadlineStatus, t: Translator): string {
  return t(sessionStatusKey(status))
}

/* ------------------------------------------------------------------ *
 * 5. 会话检查器
 * ------------------------------------------------------------------ */

export interface SessionInspectorModel {
  kind: 'session'
  sessionId: string
  title: string
  status: ThreadlineStatus
  statusLabel: string
  running: boolean
  archived: boolean
  overview: {
    startedAtText: string
    endedAtText: string
    turns: number | null
    files: number | null
    commands: number | null
    subagents: number | null
    errors: number | null
  }
  model: { provider: string | null; model: string | null; text: string }
  workline: {
    parent: { id: string; label: string } | null
    children: Array<{ id: string; label: string; statusLabel: string }>
    subagents: Array<{ id: string; title: string; statusLabel: string | null }>
  }
  recentTurns: Array<{
    turn: number
    status: TurnStatusView
    statusLabel: string
    files: number
    commands: number
    errors: number
    durationText: string
  }>
  actions: { openSession: string; focusInMap: string; close: string }
  fields: SessionInspectorField[]
  missing: boolean
}

/** 会话检查器模型。 */
export function buildSessionInspector(sessionId: string, ctx: InspectorContext): SessionInspectorModel {
  const { data, privacyMode, now, t } = ctx
  const summary = data.sessions.find((session) => session.id === sessionId)
  const detail = data.details.get(sessionId)
  const status: ThreadlineStatus = detail?.status ?? summary?.status ?? 'unknown'
  const running = detail?.running === true || summary?.running === true || status === 'running'
  const archived = summary?.archived === true
  const title = sessionDisplay(data, sessionId, privacyMode, t)
  const counts = detail?.counts
  const fileCount = detail === undefined ? null : (counts?.files ?? null)

  const parentId = detail?.parentId ?? summary?.parentId
  const parent = parentId === undefined || parentId === '' ? null : { id: parentId, label: sessionDisplay(data, parentId, privacyMode, t) }
  const children = data.sessions
    .filter((session) => session.parentId === sessionId)
    .map((session) => ({
      id: session.id,
      label: sessionDisplay(data, session.id, privacyMode, t),
      statusLabel: sessionStatusLabel(session.status, t),
    }))
  const subagents = (detail?.subagents ?? []).map((record) => ({
    id: record.id,
    title: record.title ?? record.id.slice(0, 8),
    statusLabel: record.status === undefined ? null : sessionStatusLabel(record.status, t),
  }))

  const recentSource = detail?.turns.slice(Math.max(0, detail.turns.length - INSPECTOR_LIMITS.recentTurns)) ?? []
  const recentTurns = recentSource.map((turn) => {
    const partial = isTurnPartial(turn, { sessionRunning: running, sessionPartial: detail?.partial === true })
    const turnStatus = turnStatusOf(turn, { sessionRunning: running, sessionPartial: detail?.partial === true })
    return {
      turn: turn.n,
      status: turnStatus,
      statusLabel: turnStatusLabel(turnStatus, t),
      files: turn.files.length,
      commands: turn.commands.length,
      errors: turn.errors,
      durationText: formatClock(turnDurationMs(turn, partial ? now : undefined)),
    }
  })

  const provider = detail?.provider ?? summary?.provider ?? null
  const model = detail?.model ?? summary?.model ?? null
  const modelText = provider === null && model === null ? '—' : [provider, model].filter((part) => part !== null).join(' / ')

  return {
    kind: 'session',
    sessionId,
    title,
    status,
    statusLabel: sessionStatusLabel(status, t),
    running,
    archived,
    overview: {
      startedAtText: dateTimeOfDay(detail?.startedAt ?? summary?.startedAt),
      endedAtText: detail?.endedAt === undefined ? '—' : dateTimeOfDay(detail.endedAt),
      turns: detail === undefined ? (summary?.turns ?? null) : detail.turns.length,
      files: fileCount,
      commands: counts?.commands ?? summary?.commands ?? null,
      subagents: counts?.subagents ?? summary?.subagents ?? null,
      errors: counts?.errors ?? summary?.errors ?? null,
    },
    model: { provider, model, text: modelText },
    workline: { parent, children, subagents },
    recentTurns,
    actions: {
      openSession: t('inspector.openSession'),
      focusInMap: label(INSPECTOR_COPY.focusInMap, '◎', t),
      close: t('ui.close'),
    },
    fields: [...SESSION_INSPECTOR_FIELDS],
    missing: summary === undefined && detail === undefined,
  }
}

/* ------------------------------------------------------------------ *
 * 6. 工作区概览
 * ------------------------------------------------------------------ */

export interface OverviewModel {
  kind: 'overview'
  coverage: {
    known: boolean
    /** 覆盖率一句话（coverage.loading / partial / complete / failed）。 */
    text: string
    /** 0–100；未知为 null（不显示 0% 冒充"没加载"）。 */
    percent: number | null
    phase: string
    failed: number | null
    scanned: number | null
    total: number | null
  }
  workline: {
    running: Array<{ sessionId: string; label: string; turn: number | null; updatedAtText: string }>
    currentSessionId: string
    currentSessionLabel: string
    currentTurn: number | null
    lastActivityText: string
  }
  counts: {
    files: number | null
    sessions: number | null
    turns: number | null
    commands: number | null
    subagents: number | null
  }
  legend: Array<{ kind: 'doc' | 'code' | 'data' | 'image' | 'config' | 'other'; label: string }>
  /** 图层开关位（03 §10 的默认值来自 shared/relations，不在这里另写一遍）。 */
  layerToggles: Array<{ type: RelationType; label: string; defaultOn: boolean; focusOnly: boolean; weak: boolean }>
  degrade: { kind: string; message: string; retryable: boolean; retryLabel: string | null }
  fields: OverviewField[]
}

/** 工作区概览模型（无选择时显示；03 §8.4：只作概览，不做 KPI 墙）。 */
export function buildOverview(ctx: InspectorContext): OverviewModel {
  const { data, privacyMode, t } = ctx
  const coverage = data.coverage
  const known = coverage.known === true
  const failed = coverage.failed
  let text = t('state.unknown')
  if (known) {
    if (coverage.phase === 'complete') text = t('coverage.complete', { done: coverage.scanned, total: coverage.total })
    else if (coverage.phase === 'starting' || coverage.phase === 'scanning') text = t('coverage.loading', { done: coverage.scanned, total: coverage.total })
    else if (coverage.phase === 'failed') text = t('coverage.failed', { n: failed })
    else text = t('coverage.partial', { done: coverage.scanned, total: coverage.total })
    if (failed > 0 && coverage.phase !== 'failed') text = text + ' · ' + t('coverage.failed', { n: failed })
  }
  const percent = known && coverage.total > 0 ? Math.max(0, Math.min(100, Math.round((coverage.scanned / coverage.total) * 100))) : null

  const running = data.sessions
    .filter((session) => session.running || session.status === 'running')
    .map((session) => {
      const detail = data.details.get(session.id)
      const lastTurn = detail?.turns[detail.turns.length - 1]
      return {
        sessionId: session.id,
        label: sessionDisplay(data, session.id, privacyMode, t),
        turn: lastTurn?.n ?? null,
        updatedAtText: dateTimeOfDay(session.updatedAt),
      }
    })
  const currentDetail = data.details.get(data.currentSessionId)
  const currentTurn = currentDetail !== undefined && currentDetail.turns.length > 0 ? currentDetail.turns[currentDetail.turns.length - 1].n : null
  const currentSummary = data.sessions.find((session) => session.id === data.currentSessionId)
  const lastActivity =
    currentSummary?.updatedAt ?? data.sessions.reduce((max, session) => Math.max(max, session.updatedAt), 0)

  // 计数只做概览：覆盖率未知时一律 null（而不是 0），避免把"没读到"显示成"没有"。
  const counts = known
    ? {
        files: data.files.size,
        sessions: data.sessions.length,
        turns: data.sessions.reduce((sum, session) => sum + session.turns, 0),
        commands: data.sessions.reduce((sum, session) => sum + session.commands, 0),
        subagents: data.sessions.reduce((sum, session) => sum + session.subagents, 0),
      }
    : { files: null, sessions: null, turns: null, commands: null, subagents: null }

  const legend = (['doc', 'code', 'data', 'image', 'config', 'other'] as const).map((kind) => ({
    kind,
    label: familyLabel(kind, t),
  }))
  const layerToggles = (Object.keys(RELATION_LAYER_DEFAULTS) as RelationType[]).map((type) => {
    const settings = RELATION_LAYER_DEFAULTS[type]
    return {
      type,
      label: relationTypeLabel(type, t),
      defaultOn: settings.defaultOn,
      focusOnly: settings.focusOnly,
      weak: settings.weak === true,
    }
  })

  return {
    kind: 'overview',
    coverage: {
      known,
      text,
      percent,
      phase: coverage.phase,
      failed: known ? failed : null,
      scanned: known ? coverage.scanned : null,
      total: known ? coverage.total : null,
    },
    workline: {
      running,
      currentSessionId: data.currentSessionId,
      currentSessionLabel: sessionDisplay(data, data.currentSessionId, privacyMode, t),
      currentTurn,
      lastActivityText: dateTimeOfDay(lastActivity),
    },
    counts,
    legend,
    layerToggles,
    degrade: {
      kind: data.degrade.kind,
      message: data.degrade.messageKey === null ? '' : t(data.degrade.messageKey),
      retryable: data.degrade.retryable,
      retryLabel: data.degrade.retryKey === null ? null : t(data.degrade.retryKey),
    },
    fields: [...OVERVIEW_FIELDS],
  }
}

/* ------------------------------------------------------------------ *
 * 7. 派发
 * ------------------------------------------------------------------ */

/** 检查器模型：按选择类型派发（无选择 = 工作区概览）。 */
export type InspectorModel =
  | FileInspectorModel
  | TurnInspectorModel
  | SessionInspectorModel
  | OverviewModel

/** 选择 → 模型（`none` 时给概览）。 */
export function buildInspectorModel(
  selection: { kind: 'none' } | { kind: 'file'; path: string } | { kind: 'turn'; sessionId: string; turn: number } | { kind: 'session'; sessionId: string },
  ctx: InspectorContext,
): InspectorModel {
  switch (selection.kind) {
    case 'file':
      return buildFileInspector(selection.path, ctx)
    case 'turn':
      return buildTurnInspector(selection.sessionId, selection.turn, ctx)
    case 'session':
      return buildSessionInspector(selection.sessionId, ctx)
    case 'none':
    default:
      return buildOverview(ctx)
  }
}

/** `TurnFile` 的公共视图（组件里不用直接摸 shared 类型）。 */
export function turnFileSummary(file: TurnFile): { path: string; ops: readonly FileOp[]; deltaText: string } {
  return { path: file.path, ops: file.ops, deltaText: deltaText(file.added, file.removed) }
}
