/*
 * ui/modal/model.ts —— `/threadline` 弹窗的模型（03 §9.1；06 A43-3）。
 *
 * 全部来自**记录**：起点/终点只引用记录里的消息文本（默认折叠、隐私模式隐藏）；
 * 头部汇总是计数；未闭环只数记录里明确失败/未完成的项。无 LLM、无生成摘要、不猜。
 */
import type { FileNode, FileTouch, SessionDetail, TurnDetail } from '../../../shared/events/index.ts'
import { fileNodeFromTouches } from '../../../shared/events/index.ts'
import type { Translator } from '../../locale/index.ts'
import { formatClock, maskPath, sessionStatusKey, turnDurationMs } from '../turns/index.ts'
import { maskPathFor, maskTitle, shouldRenderContent, type PrivacyMode } from '../../privacy/index.ts'
import type { TurnStatusView } from '../turns/index.ts'
import { turnStatusOf } from '../turns/index.ts'

/** 弹窗里的一行轮次轨迹。 */
export interface ModalTurnRow {
  n: number
  status: TurnStatusView
  statusLabel: string
  files: number
  commands: number
  errors: number
  durationText: string
  /** 该轮文件（≤5，隐私模式只留 basename）。 */
  filesPreview: string[]
  /** 还有多少文件没显示（>0 时界面显示「还有 N 条」）。 */
  hiddenFiles: number
}

/** 弹窗模型。 */
export interface ModalModel {
  sessionId: string
  /** 会话标题（隐私模式由调用方传 mask）。 */
  title: string
  durationText: string
  turns: number
  files: number
  commands: number
  subagents: number
  errors: number
  badge: string
  startText: string | null
  endText: string | null
  turnRows: ModalTurnRow[]
  /** 文件缩略星图的节点（只显示本对话碰过的文件）。 */
  nodes: FileNode[]
  /** 未闭环：失败命令数 / 未完成子智能体数（只数记录里明确的）。 */
  openLoops: { failedCommands: number; unfinishedSubagents: number }
  /** 数据不完整（仍在记录 / 只读到部分）。 */
  partial: boolean
  running: boolean
  /** 本对话里出现过的文件路径（大小写原样；供星图选中用）。 */
  touchedPaths: string[]
}

function collectTouched(turns: readonly TurnDetail[]): Map<string, { path: string; firstAt: number; lastAt: number; ops: number }> {
  const map = new Map<string, { path: string; firstAt: number; lastAt: number; ops: number }>()
  for (const turn of turns) {
    for (const file of turn.files) {
      const key = file.path.toLowerCase()
      const entry = map.get(key)
      const at = turn.start
      if (entry === undefined) {
        map.set(key, { path: file.path, firstAt: at, lastAt: at, ops: file.ops.length })
      } else {
        entry.lastAt = Math.max(entry.lastAt, at)
        entry.ops += file.ops.length
      }
    }
  }
  return map
}

/**
 * 构造弹窗模型。
 * `files` 是整个工作区的文件节点（用来给缩略星图补 family/sessionIds 等字段）；
 * 不在工作区图里的触碰文件不画（不伪造节点）。
 */
export function buildModalModel(input: {
  detail: SessionDetail | null
  files: ReadonlyMap<string, FileNode>
  /** 隐私模式（T10 `privacy/masks` 的单一实现；不再是 boolean）。 */
  mode: PrivacyMode
  t: Translator
  now?: number
}): ModalModel {
  const { detail, files, mode, t } = input
  const hidden = mode === 'hidden'
  const now = input.now ?? 0
  if (detail === null) {
    return {
      sessionId: '',
      title: '',
      durationText: '—',
      turns: 0,
      files: 0,
      commands: 0,
      subagents: 0,
      errors: 0,
      badge: t('modal.badge'),
      startText: null,
      endText: null,
      turnRows: [],
      nodes: [],
      openLoops: { failedCommands: 0, unfinishedSubagents: 0 },
      partial: false,
      running: false,
      touchedPaths: [],
    }
  }

  const touched = collectTouched(detail.turns)
  const nodes: FileNode[] = []
  for (const entry of touched.values()) {
    const node = files.get(entry.path.toLowerCase())
    if (node !== undefined) nodes.push(node)
  }
  nodes.sort((a, b) => b.ops - a.ops || a.path.localeCompare(b.path))

  const lastTurn = detail.turns.length > 0 ? detail.turns[detail.turns.length - 1] : undefined
  let endAt = detail.endedAt
  if (endAt === undefined && lastTurn !== undefined) endAt = lastTurn.end
  if (endAt === undefined && detail.running === true && now > 0) endAt = now
  const durationMs = endAt === undefined ? null : Math.max(0, endAt - detail.startedAt)

  const commands = detail.turns.reduce((sum, turn) => sum + turn.commands.length, 0)
  const failedCommands = detail.turns.reduce(
    (sum, turn) => sum + turn.commands.filter((command) => command.status === 'error').length,
    0,
  )
  const unfinishedSubagents = detail.subagents.filter(
    (record) => record.status === 'running' || record.status === 'unknown',
  ).length

  const running = detail.running === true || detail.status === 'running'
  const turnRows: ModalTurnRow[] = detail.turns.map((turn) => {
    const paths = turn.files.map((file) => maskPathFor(file.path, mode))
    const status = turnStatusOf(turn, { sessionRunning: running, sessionPartial: detail.partial === true })
    return {
      n: turn.n,
      status,
      statusLabel: t(status === 'completed' ? 'turns.completed' : status === 'aborted' ? 'session.aborted' : status === 'running' ? 'session.running' : 'session.unknown'),
      files: new Set(turn.files.map((file) => file.path.toLowerCase())).size,
      commands: turn.commands.length,
      errors: turn.errors,
      durationText: formatClock(turnDurationMs(turn, running ? now : undefined)),
      filesPreview: paths.slice(0, 5),
      hiddenFiles: Math.max(0, paths.length - 5),
    }
  })

  // 正文闸门（T10 唯一实现）：隐私模式下起点/终点文本不进入模型（组件也就没有入口可点）
  const startRaw = detail.turns.length > 0 ? (detail.turns[0].userText ?? null) : null
  const last = detail.turns.length > 0 ? detail.turns[detail.turns.length - 1] : undefined
  const endRaw = last?.assistantText ?? null
  const startText = shouldRenderContent(mode, startRaw !== null) ? startRaw : startRaw === null ? null : null
  const endText = shouldRenderContent(mode, endRaw !== null) ? endRaw : null
  void hidden

  return {
    sessionId: detail.id,
    title: detail.title ?? detail.id.slice(0, 8),
    durationText: formatClock(durationMs),
    turns: detail.turns.length,
    files: touched.size,
    commands,
    subagents: detail.subagents.length,
    errors: detail.errors.length,
    badge: t('modal.badge'),
    startText,
    endText,
    turnRows,
    nodes,
    openLoops: { failedCommands, unfinishedSubagents },
    partial: detail.partial === true,
    running,
    touchedPaths: Array.from(touched.values()).map((entry) => entry.path),
  }
}

/**
 * 从单会话详情推导文件节点（弹窗所在的 overlay 槽拿不到工作区扫描结果）。
 * 用 `fileNodeFromTouches` 的**同一套口径**（events 的唯一实现），不另写族/路径判定。
 */
export function fileNodesOfDetail(detail: SessionDetail | null): FileNode[] {
  if (detail === null) return []
  const touches: FileTouch[] = []
  let seq = 0
  for (const turn of detail.turns) {
    for (const file of turn.files) {
      seq += 1
      const ops = file.ops
      touches.push({
        sessionId: detail.id,
        turn: turn.n,
        path: file.path,
        key: file.path.toLowerCase(),
        ops: ops.slice(),
        reads: ops.includes('read') ? 1 : 0,
        writes: ops.includes('write') ? 1 : 0,
        searches: ops.includes('search') ? 1 : 0,
        added: file.added,
        removed: file.removed,
        firstAt: turn.start,
        lastAt: turn.end ?? turn.start,
        seq,
      })
    }
  }
  const byPath = new Map<string, FileTouch[]>()
  for (const touch of touches) {
    const list = byPath.get(touch.key)
    if (list === undefined) byPath.set(touch.key, [touch])
    else list.push(touch)
  }
  const nodes: FileNode[] = []
  for (const [key, list] of byPath) {
    const first = list[0]
    if (first === undefined) continue
    nodes.push(fileNodeFromTouches(first.path, list, [detail.id], 1, new Set(list.map((item) => item.turn)).size))
  }
  nodes.sort((a, b) => b.ops - a.ops || a.path.localeCompare(b.path))
  return nodes
}

/** 弹窗标题（隐私模式用「会话 n」由调用方给 index；这里只做路径/标题的兜底）。 */
export function modalTitle(input: {
  title?: string
  sessionId: string
  mode: PrivacyMode
  index: number
  t: Translator
}): string {
  return maskTitle({ sessionId: input.sessionId, ...(input.title === undefined ? {} : { title: input.title }) }, input.index, input.mode, input.t)
}

/** 文件路径的展示（隐私模式只留 basename；导出给组件用，避免两套掩码）。 */
export function modalPath(path: string, mode: PrivacyMode): string {
  return maskPathFor(path, mode)
}

/** 会话状态文案（弹窗顶部用；只认记录）。 */
export function modalStatusLabel(detail: SessionDetail | null, t: Translator): string {
  if (detail === null) return t('session.unknown')
  return t(sessionStatusKey(detail.status))
}
