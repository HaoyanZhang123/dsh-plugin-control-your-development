/*
 * turns/model.ts —— 轮次带的**纯逻辑**（03 §6；06 A42-1 / N-16）。
 *
 * 这里没有 React，全部是可单测的纯函数：
 * - 状态判定：**完成只能来自 `turn/end.reason.kind === 'completed'`**；没有结束事件 ⇒ 运行中（会话在跑）
 *   或未知；有结束事件但 kind 缺失 ⇒ 未知。绝不用 `完成` 去顶替未知（10 §2.2）。
 * - 块宽：`8 + 10·log2(1 + 秒)`，最小 8px；对数缩放保证 30 轮也能换行放下。
 * - 标记：文件数 / 命令数 / 错误 / 子智能体；宽度不够时按**确定性的槽位数**收起，剩余给 `+n`
 *   （tooltip 与 aria-label 永远给全量，不靠颜色也不靠鼠标）。
 * - 会话选择器：`当前会话` / `全部工作线` / 具体会话（根会话按最近活动排序、归档置后）。
 */
import type {
  SessionDetail,
  SessionSummary,
  TurnDetail,
  TurnEndKind,
} from '../../../shared/events/index.ts'
import type { Translator } from '../../locale/index.ts'
import { TURN_COPY, turnLabel } from './copy.ts'
import { select, type Selection } from './selection.ts'

/* ------------------------------------------------------------------ *
 * 0. 度量（与 base.css 的 92px 轮次带、8px 网格一致）
 * ------------------------------------------------------------------ */

export const TURN_METRICS = {
  /** 最短块宽（03 §6：最小 8px）。 */
  minBlockPx: 8,
  /** 对数缩放系数：1 秒 ≈ 10px，1 分钟 ≈ 58px，1 小时 ≈ 125px。 */
  logPx: 10,
  /** 块高（含状态条与标记行）。 */
  blockHeightPx: 44,
  /** 块间距。 */
  gapPx: 4,
  /** ≥ 此宽度显示标记图标（无计数）。 */
  iconMarkerMinPx: 24,
  /** ≥ 此宽度显示「图标 + 计数」。 */
  countMarkerMinPx: 56,
  /** 图标模式每个标记占位。 */
  iconSlotPx: 9,
  /** 计数模式每个标记占位。 */
  countSlotPx: 14,
  /** 标记种类数：文件 / 命令 / 错误 / 子智能体。 */
  markerKinds: 4,
} as const

/* ------------------------------------------------------------------ *
 * 1. 时间与宽度
 * ------------------------------------------------------------------ */

/** 时钟格式（不依赖 locale）：`MM:SS` / `H:MM:SS`；不可知时 `—`。 */
export function formatClock(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return '—'
  const totalSec = Math.round(ms / 1000)
  const hours = Math.floor(totalSec / 3600)
  const minutes = Math.floor((totalSec % 3600) / 60)
  const seconds = totalSec % 60
  const pad = (value: number): string => (value < 10 ? '0' + String(value) : String(value))
  return hours > 0 ? String(hours) + ':' + pad(minutes) + ':' + pad(seconds) : pad(minutes) + ':' + pad(seconds)
}

/**
 * 轮次时长（毫秒）。
 * - 已结束：`end - start`；
 * - 未结束但已知 `now`：`now - start`（"进行中"的可读时长，不写完整）；
 * - 否则 `null`（渲染 `—`，不猜）。
 */
export function turnDurationMs(turn: TurnDetail, now?: number): number | null {
  if (typeof turn.end === 'number' && Number.isFinite(turn.end)) {
    const value = turn.end - turn.start
    return value >= 0 ? value : null
  }
  if (typeof now === 'number' && Number.isFinite(now)) {
    const value = now - turn.start
    return value >= 0 ? value : null
  }
  return null
}

/**
 * 块宽：`min 8 + 10·log2(1 + 秒)`，四舍五入。
 * 时长不可知 ⇒ 最小宽度（不伪造一个"短轮"的视觉印象之外的任何东西：宽度只是视觉权重）。
 */
export function blockWidth(durationMs: number | null | undefined): number {
  const { minBlockPx, logPx } = TURN_METRICS
  if (durationMs === null || durationMs === undefined || !Number.isFinite(durationMs) || durationMs <= 0) {
    return minBlockPx
  }
  const seconds = durationMs / 1000
  return Math.max(minBlockPx, Math.round(minBlockPx + logPx * Math.log2(1 + seconds)))
}

/** 时长文本：有 locale key 用 key（分/秒/时），否则用时钟格式（locale 无关）。 */
export function formatDuration(ms: number | null, t: Translator): string {
  if (ms === null || !Number.isFinite(ms)) return '—'
  const totalSec = Math.max(0, Math.round(ms / 1000))
  const hours = Math.floor(totalSec / 3600)
  const minutes = Math.floor((totalSec % 3600) / 60)
  const seconds = totalSec % 60
  if (hours > 0 && TURN_COPY.durationHour !== null) {
    return t(TURN_COPY.durationHour, { h: hours, m: minutes })
  }
  if (hours === 0 && minutes > 0 && TURN_COPY.durationMin !== null) {
    return t(TURN_COPY.durationMin, { m: minutes, s: seconds })
  }
  if (hours === 0 && minutes === 0 && TURN_COPY.durationSec !== null) {
    return t(TURN_COPY.durationSec, { s: seconds })
  }
  return formatClock(ms)
}

/* ------------------------------------------------------------------ *
 * 2. 状态判定（不伪造：完成只认 turn/end.kind==='completed'）
 * ------------------------------------------------------------------ */

export type TurnStatusView = 'completed' | 'aborted' | 'running' | 'unknown'

export interface TurnStatusOptions {
  /** 会话是否在跑（来自会话行 / detail.running）。 */
  sessionRunning?: boolean
  /** 日志尾部未读完（detail.partial）。 */
  sessionPartial?: boolean
}

/** 危险（中止类）原因的原始 kind 集合。 */
const ABORT_KINDS: readonly TurnEndKind[] = ['aborted', 'error', 'interrupted', 'blocked', 'max-tokens', 'forked']

/**
 * 轮次状态（03 §6：完成 / 中止 / 运行中 / 未知）。
 * 规则（06 N-04 / N-05 / N-16；10 §2.2）：
 * 1. `endKind === 'completed'` ⇒ completed（**唯一**来源）；
 * 2. `endKind` 属于中止类 ⇒ aborted；
 * 3. 有结束事件但 kind 缺失或其它 ⇒ unknown（不猜成功）；
 * 4. 没有结束事件：会话在跑 ⇒ running；否则 unknown。
 */
export function turnStatusOf(turn: TurnDetail, options?: TurnStatusOptions): TurnStatusView {
  const kind = turn.endKind
  if (kind === 'completed') return 'completed'
  if (kind !== undefined && ABORT_KINDS.includes(kind)) return 'aborted'
  const hasEnd = typeof turn.end === 'number' && Number.isFinite(turn.end)
  // 有结束事件但没有可识别的原因 → 未知（不猜成功，也不把「其它」当成中止）。
  if (hasEnd) return 'unknown'
  const running = options?.sessionRunning === true
  // 会话行说在跑 → 运行中；明细本身标了 partial（还在记录）也算运行中；其余未知。
  if (running || (options?.sessionPartial === true && turn.status === 'running')) return 'running'
  return 'unknown'
}

/**
 * 「本轮仍在记录」（06 N-16）：没有结束事件、且会话在跑或明细 partial。
 * 此时不显示时长之外的完整结论，也不显示"完成"。
 */
export function isTurnPartial(turn: TurnDetail, options?: TurnStatusOptions): boolean {
  const hasEnd = typeof turn.end === 'number' && Number.isFinite(turn.end)
  if (hasEnd) return false
  return options?.sessionRunning === true || options?.sessionPartial === true
}

export interface TurnCounts {
  files: number
  commands: number
  subagents: number
  errors: number
}

/** 轮次计数（同一文件多次只算 1，与 03 §7.1 的计数口径一致）。 */
export function turnCounts(turn: TurnDetail): TurnCounts {
  const paths = new Set<string>()
  for (const file of turn.files) paths.add(file.path)
  return {
    files: paths.size,
    commands: turn.commands.length,
    subagents: turn.subagents.length,
    errors: turn.errors,
  }
}

/** 状态文案：key 未落地时退回符号（只用于 A42 采集前的过渡态，不写句子）。 */
export function turnStatusLabel(status: TurnStatusView, t: Translator): string {
  switch (status) {
    case 'completed':
      return turnLabel(TURN_COPY.statusCompleted, '✓', t)
    case 'aborted':
      return turnLabel(TURN_COPY.statusAborted, '✕', t)
    case 'running':
      return turnLabel(TURN_COPY.statusRunning, '●', t)
    case 'unknown':
    default:
      return turnLabel(TURN_COPY.statusUnknown, '?', t)
  }
}

/* ------------------------------------------------------------------ *
 * 3. 轮次块模型
 * ------------------------------------------------------------------ */

export type MarkerMode = 'bar' | 'icon' | 'count'

/** 标记种类（顺序 = 视觉顺序：文件 → 命令 → 错误 → 子智能体）。 */
export type MarkerKind = 'files' | 'commands' | 'errors' | 'subagents'

/** 一个标记：种类 + 计数（计数为 0 的标记不渲染，避免噪声；tooltip 仍给全量）。 */
export interface TurnMarker {
  kind: MarkerKind
  count: number
}

/** 计数 → 标记列表（只保留非零项；顺序固定）。 */
export function turnMarkers(counts: TurnCounts): TurnMarker[] {
  const list: TurnMarker[] = [
    { kind: 'files', count: counts.files },
    { kind: 'commands', count: counts.commands },
    { kind: 'errors', count: counts.errors },
    { kind: 'subagents', count: counts.subagents },
  ]
  return list.filter((marker) => marker.count > 0)
}

export interface TurnBlockModel {
  kind: 'turn'
  selection: Selection
  sessionId: string
  turn: number
  status: TurnStatusView
  statusLabel: string
  partial: boolean
  /** 时长（毫秒）；未知为 null。 */
  durationMs: number | null
  durationText: string
  widthPx: number
  counts: TurnCounts
  /** 非零标记（顺序固定）。 */
  markers: TurnMarker[]
  markerMode: MarkerMode
  /** 该宽度下能显示几个标记（0..markers.length）。 */
  markerSlots: number
  /** 收起未显示的标记数（>0 时界面显示 `+n`）。 */
  hiddenMarkers: number
  /** 「本轮仍在记录」文案（partial 时显示；否则空串）。 */
  partialLabel: string
  /** hover tooltip / `title`。 */
  tooltip: string
  /** 读屏可获取的完整描述（与 tooltip 同源，且**含全部计数**）。 */
  ariaLabel: string
  /** `T{n}` 标签（视觉上的序号，不是文案）。 */
  label: string
}

export interface BuildTurnBlockOptions extends TurnStatusOptions {
  sessionId: string
  /** 当前时间（未结束轮次的进行中时长用）；不给则未结束轮次时长记 `—`。 */
  now?: number
  t: Translator
}

/** 标记槽位：宽度决定显示模式与槽位数（确定性，便于断言）。 */
export function markerSlots(widthPx: number): { mode: MarkerMode; slots: number } {
  const { iconMarkerMinPx, countMarkerMinPx, iconSlotPx, countSlotPx, markerKinds } = TURN_METRICS
  if (widthPx < iconMarkerMinPx) return { mode: 'bar', slots: 0 }
  if (widthPx < countMarkerMinPx) {
    const slots = Math.max(0, Math.min(markerKinds, Math.floor((widthPx - 4) / iconSlotPx)))
    return { mode: 'icon', slots }
  }
  const slots = Math.max(0, Math.min(markerKinds, Math.floor((widthPx - 4) / countSlotPx)))
  return { mode: 'count', slots }
}

/** tooltip：03 §6 的模板 `T{n} · 时长 · 文件 n · 命令 n · 子智能体 n · 错误 n`。 */
export function turnTooltip(input: {
  turn: number
  durationText: string
  counts: TurnCounts
  t: Translator
}): string {
  const { turn, durationText, counts, t } = input
  if (TURN_COPY.tooltip !== null) {
    return t(TURN_COPY.tooltip, {
      n: turn,
      duration: durationText,
      files: counts.files,
      commands: counts.commands,
      subagents: counts.subagents,
      errors: counts.errors,
    })
  }
  // key 未落地：只给"标签 + 数字"，不拼句子（缺 key 的可见后果由 Lead 决策后一次性补齐）。
  return (
    'T' + String(turn) + ' · ' + durationText + ' · ' + String(counts.files) + ' · ' +
    String(counts.commands) + ' · ' + String(counts.subagents) + ' · ' + String(counts.errors)
  )
}

/** 构造一个轮次块（组件只渲染，不做判定）。 */
export function buildTurnBlock(turn: TurnDetail, options: BuildTurnBlockOptions): TurnBlockModel {
  const status = turnStatusOf(turn, options)
  const partial = isTurnPartial(turn, options)
  const durationMs = turnDurationMs(turn, partial ? options.now : undefined)
  const durationText = formatDuration(durationMs, options.t)
  const counts = turnCounts(turn)
  const markers = turnMarkers(counts)
  const widthPx = blockWidth(durationMs)
  const capacity = markerSlots(widthPx)
  const slots = Math.min(capacity.slots, markers.length)
  const tooltip = turnTooltip({ turn: turn.n, durationText, counts, t: options.t })
  return {
    kind: 'turn',
    selection: select.turn(options.sessionId, turn.n),
    sessionId: options.sessionId,
    turn: turn.n,
    status,
    statusLabel: turnStatusLabel(status, options.t),
    partial,
    durationMs,
    durationText,
    widthPx,
    counts,
    markers,
    markerMode: capacity.mode,
    markerSlots: slots,
    hiddenMarkers: Math.max(0, markers.length - slots),
    partialLabel: partial ? turnLabel(TURN_COPY.partial, '…', options.t) : '',
    tooltip,
    ariaLabel: tooltip,
    label: 'T' + String(turn.n),
  }
}

/* ------------------------------------------------------------------ *
 * 4. 会话选择器与分组
 * ------------------------------------------------------------------ */

/** 会话范围：当前会话 / 全部工作线 / 指定会话。 */
export type TurnScope = { kind: 'current' } | { kind: 'all' } | { kind: 'session'; sessionId: string }

/** 一个会话在轮次带里的分组（会话标题在渲染时按隐私模式掩码）。 */
export interface TurnGroup {
  sessionId: string
  title?: string
  running: boolean
  partial: boolean
  turns: readonly TurnDetail[]
}

/** 会话行的最小形状（`SessionSummary` 结构化满足它；T09 可直接传摘要）。 */
export type TurnStripSession = Pick<
  SessionSummary,
  'id' | 'updatedAt' | 'running' | 'archived' | 'status' | 'turns'
> &
  Partial<Pick<SessionSummary, 'title' | 'parentId' | 'startedAt' | 'endedAt'>>

/** 会话选择器选项值（`value` 直接是 TurnScope 的稳定字符串）。 */
export interface ScopeOption {
  value: string
  scope: TurnScope
  label: string
  archived: boolean
}

/** TurnScope → 稳定的字符串键（用于 `<option value>` 与比较）。 */
export function scopeKey(scope: TurnScope): string {
  switch (scope.kind) {
    case 'current':
      return 'current'
    case 'all':
      return 'all'
    case 'session':
      return 'session:' + scope.sessionId
    default:
      return 'current'
  }
}

/** 字符串键 → TurnScope（不认识的键按「当前会话」，不抛错）。 */
export function parseScopeKey(key: string): TurnScope {
  if (key === 'all') return { kind: 'all' }
  if (key.startsWith('session:')) {
    const sessionId = key.slice('session:'.length)
    if (sessionId !== '') return { kind: 'session', sessionId }
  }
  return { kind: 'current' }
}

/** 根会话（有父会话的是子智能体会话，不进"具体会话"列表）。 */
export function rootSessions(sessions: readonly TurnStripSession[]): TurnStripSession[] {
  return sessions.filter((session) => session.parentId === undefined || session.parentId === '')
}

/**
 * 选择器选项（03 §6）：当前会话 → 全部工作线 → 具体会话（最近活动排序，归档置后）。
 * 归档只是排序靠后 + 带「归档」标记，不隐藏（06 N-17）。
 */
export function buildScopeOptions(
  sessions: readonly TurnStripSession[],
  t: Translator,
  options?: { privacyMode?: boolean },
): ScopeOption[] {
  const currentLabel = turnLabel(TURN_COPY.scopeCurrent, '●', t)
  const allLabel = turnLabel(TURN_COPY.scopeAll, '⋯', t)
  const roots = rootSessions(sessions).slice().sort((a, b) => {
    if (a.archived !== b.archived) return a.archived ? 1 : -1
    return b.updatedAt - a.updatedAt
  })
  const items: ScopeOption[] = [
    { value: 'current', scope: { kind: 'current' }, label: currentLabel, archived: false },
    { value: 'all', scope: { kind: 'all' }, label: allLabel, archived: false },
  ]
  roots.forEach((session, index) => {
    const base = session.title !== undefined && session.title !== '' ? session.title : session.id.slice(0, 8)
    const title = options?.privacyMode === true ? t('inspector.session') + ' ' + String(index + 1) : base
    const archivedSuffix = session.archived ? ' · ' + t('session.archived') : ''
    items.push({
      value: 'session:' + session.id,
      scope: { kind: 'session', sessionId: session.id },
      label: title + archivedSuffix,
      archived: session.archived,
    })
  })
  return items
}

/** 当前范围对应的会话 id（`all` 返回 null）。 */
export function scopeSessionId(scope: TurnScope, currentSessionId: string): string | null {
  if (scope.kind === 'all') return null
  if (scope.kind === 'session') return scope.sessionId
  return currentSessionId
}

/**
 * 按范围把已加载的详情组织成轮次分组。
 * 只输出**有详情**的会话（没加载就不画假块）；`current` 范围下即使没有详情也返回空数组。
 */
export function buildTurnGroups(input: {
  scope: TurnScope
  currentSessionId: string
  sessions: readonly TurnStripSession[]
  details: ReadonlyMap<string, SessionDetail>
}): TurnGroup[] {
  const { scope, currentSessionId, sessions, details } = input
  const byId = new Map(sessions.map((session) => [session.id, session]))
  const groupOf = (sessionId: string, summary?: TurnStripSession): TurnGroup | null => {
    const detail = details.get(sessionId)
    if (detail === undefined) return null
    const row = summary ?? byId.get(sessionId)
    const running = detail.running === true || row?.running === true || detail.status === 'running'
    return {
      sessionId,
      ...(detail.title === undefined ? (row?.title === undefined ? {} : { title: row.title }) : { title: detail.title }),
      running,
      partial: detail.partial === true,
      turns: detail.turns,
    }
  }
  if (scope.kind !== 'all') {
    const sessionId = scopeSessionId(scope, currentSessionId)
    if (sessionId === null) return []
    const group = groupOf(sessionId)
    return group === null ? [] : [group]
  }
  const roots = rootSessions(sessions).slice().sort((a, b) => {
    if (a.archived !== b.archived) return a.archived ? 1 : -1
    return b.updatedAt - a.updatedAt
  })
  const groups: TurnGroup[] = []
  for (const session of roots) {
    const group = groupOf(session.id, session)
    if (group !== null) groups.push(group)
  }
  return groups
}

/** 分组里全部轮次的选择值（键盘方向键的候选序列，顺序 = 视觉顺序）。 */
export function turnCandidates(groups: readonly TurnGroup[]): Selection[] {
  const list: Selection[] = []
  for (const group of groups) {
    for (const turn of group.turns) list.push(select.turn(group.sessionId, turn.n))
  }
  return list
}

/** 当前轮：最后一个有记录的轮次（没有轮次则 null）。 */
export function currentTurnNumber(detail: SessionDetail | null | undefined): number | null {
  if (detail === null || detail === undefined || detail.turns.length === 0) return null
  let max: number | null = null
  for (const turn of detail.turns) if (max === null || turn.n > max) max = turn.n
  return max
}

/** 默认选择：当前会话的当前轮（03 §8「默认选中当前轮次」）。 */
export function defaultSelection(detail: SessionDetail | null | undefined): Selection {
  const turn = currentTurnNumber(detail)
  if (detail === null || detail === undefined || turn === null) return select.none()
  return select.turn(detail.id, turn)
}
