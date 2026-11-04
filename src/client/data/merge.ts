/**
 * T04 · 工作区图合并（04 §2.5 / §4.2–§4.4、06 A20-3 / N-02 / N-10）。
 *
 * 纯函数：输入旧图 + 一个 snapshot 包，输出新图与本次应用的计数。
 * - 会话按 `id` 覆盖；文件按 `path`（大小写不敏感身份键）覆盖；边按规范化 `from/to` 覆盖；
 * - `removedFiles` / `removedEdges` 生效（host 通知客户端哪些被裁剪）；
 * - `reset: true` 时先清空旧图再应用（04 §2.5）；
 * - 失败列表按 `sessionId + code` 去重保留，**不影响其它会话的数据**；
 * - 覆盖率模型：`{ total, scanned, failed, cached, loadedFiles, phase }`，`loaded` 不等于“全部”。
 */

import type {
  FileNode,
  ScanError,
  ScanProgress,
  SessionSummary,
  SnapshotCoTurnEdge,
} from '../../shared/events/index.ts'

/** 覆盖率阶段（03 §11.1 状态机 + 04 §2.5 的 progress.phase）。 */
export type GraphPhase = 'starting' | 'scanning' | 'partial' | 'complete' | 'failed'

/** 覆盖率模型：进度来自 host，`loaded*` 来自本客户端实际持有的图。 */
export interface Coverage {
  /** 本 workspace 计划扫描的会话总数（host 给的 total）。 */
  total: number
  /** 已处理（含 failed/cached）的会话数。 */
  scanned: number
  /** 读取失败的会话数。 */
  failed: number
  /** 命中摘要缓存的会话数。 */
  cached: number
  /** 当前图里已加载的文件节点数（≠ “全部”）。 */
  loadedFiles: number
  /** 当前图里已加载的边数。 */
  loadedEdges: number
  /** 当前图里已加载的会话摘要数。 */
  loadedSessions: number
  /** 覆盖率阶段；`partial` 表示“有数据但不完整”。 */
  phase: GraphPhase
  /** 是否收到过真实进度（false 表示未知，UI 必须显示未知而不是 0）。 */
  known: boolean
  /** 本次/最近一次响应被裁剪，还有数据要续拉（不静默丢）。 */
  truncated: boolean
  /** 是否已完成（phase === 'complete' 的便捷判断）。 */
  complete: boolean
}

/** 客户端持有的工作区图（不可变；每次 apply 产生新对象）。 */
export interface WorkspaceGraph {
  readonly sessions: ReadonlyMap<string, SessionSummary>
  /** key = `path.toLowerCase()`。 */
  readonly files: ReadonlyMap<string, FileNode>
  /** key = 规范化边键（见 `edgeKeyOf`）。 */
  readonly edges: ReadonlyMap<string, SnapshotCoTurnEdge>
  readonly errors: readonly ScanError[]
  readonly coverage: Coverage
  /** 最后应用的 rev（host 每处理一个会话 +1）。 */
  readonly rev: number
  /** 最近一次 scanId（可能还没有：图是空的）。 */
  readonly scanId?: string
  /** reset 次数（诊断用）。 */
  readonly resets: number
  /** 是否完成过至少一次 snapshot 应用。 */
  readonly applied: boolean
}

/** 单个 snapshot 包的应用结果。 */
export interface ApplyResult {
  graph: WorkspaceGraph
  applied: {
    reset: boolean
    sessions: number
    filesAdded: number
    filesUpdated: number
    filesRemoved: number
    edgesAdded: number
    edgesUpdated: number
    edgesRemoved: number
    errors: number
    truncated: boolean
    rev: number
  }
}

/** 失败会话汇总（UI 展开列表用；带“哪个会话 / 原因”）。 */
export interface FailedSession {
  sessionId: string
  code: ScanError['code']
  message: string
  detail?: string
}

/** 边键：与 host 同口径（小写 + NUL），但顺序规范化，避免 from/to 顺序造成的重复。 */
export function edgeKeyOf(from: string, to: string): string {
  const left = from.toLowerCase()
  const right = to.toLowerCase()
  return left <= right ? `${left}\u0000${right}` : `${right}\u0000${left}`
}

/** 解析 host 的 `removedEdges` 元素（`from + '\u0000' + to`）→ 规范键。 */
export function removedEdgeKey(encoded: string): string {
  const separator = encoded.indexOf('\u0000')
  if (separator < 0) return encoded.toLowerCase()
  const from = encoded.slice(0, separator)
  const to = encoded.slice(separator + 1)
  if (from === '' || to === '') return encoded.toLowerCase()
  return edgeKeyOf(from, to)
}

function emptyCoverage(known: boolean): Coverage {
  return {
    total: 0,
    scanned: 0,
    failed: 0,
    cached: 0,
    loadedFiles: 0,
    loadedEdges: 0,
    loadedSessions: 0,
    phase: 'starting',
    known,
    truncated: false,
    complete: false,
  }
}

/** 空图：`known=false`，下游必须显示“未知”而不是 0。 */
export function createEmptyGraph(): WorkspaceGraph {
  return {
    sessions: new Map<string, SessionSummary>(),
    files: new Map<string, FileNode>(),
    edges: new Map<string, SnapshotCoTurnEdge>(),
    errors: [],
    coverage: emptyCoverage(false),
    rev: 0,
    resets: 0,
    applied: false,
  }
}

function sanitizeCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

/** 从协议进度 + 本地图推导覆盖率阶段（`partial` = 有数据但不完整）。 */
export function derivePhase(input: {
  progress?: ScanProgress
  done: boolean
  truncated: boolean
  loadedSessions: number
}): GraphPhase {
  const phase = input.progress?.phase
  if (phase === 'failed') return 'failed'
  if (phase === 'complete' || input.done) return input.truncated ? 'partial' : 'complete'
  if (phase === 'starting' && input.loadedSessions === 0 && !input.truncated) return 'starting'
  if (input.truncated || input.loadedSessions > 0) return 'partial'
  return 'scanning'
}

function coverageOf(
  graph: Pick<WorkspaceGraph, 'sessions' | 'files' | 'edges'>,
  progress: ScanProgress | undefined,
  done: boolean,
  truncated: boolean,
): Coverage {
  const total = sanitizeCount(progress?.total)
  const rawScanned = sanitizeCount(progress?.scanned)
  const scanned = total > 0 ? Math.min(rawScanned, total) : rawScanned
  const failed = Math.min(sanitizeCount(progress?.failed), scanned)
  const cached = Math.min(sanitizeCount(progress?.cached), scanned)
  const loadedSessions = graph.sessions.size
  const phase = derivePhase({ progress, done, truncated, loadedSessions })
  return {
    total,
    scanned,
    failed,
    cached,
    loadedFiles: graph.files.size,
    loadedEdges: graph.edges.size,
    loadedSessions,
    phase,
    known: true,
    truncated,
    complete: phase === 'complete',
  }
}

function errorKey(error: ScanError): string {
  return `${error.sessionId}\u0000${error.code}`
}

/** 去重合并失败列表：同一会话同一码保留最新（位置不变），其它会话不受影响。 */
export function mergeErrors(
  previous: readonly ScanError[],
  incoming: readonly ScanError[],
  reset: boolean,
): ScanError[] {
  const merged = reset ? [] : previous.slice()
  const index = new Map<string, number>()
  for (let i = 0; i < merged.length; i += 1) index.set(errorKey(merged[i]), i)
  for (const error of incoming) {
    if (typeof error?.sessionId !== 'string' || typeof error?.message !== 'string') continue
    const key = errorKey(error)
    const existing = index.get(key)
    if (existing === undefined) {
      index.set(key, merged.length)
      merged.push(error)
    } else {
      merged[existing] = error
    }
  }
  return merged
}

/**
 * 应用一个 snapshot 包（04 §2.5 / §5.3）。
 *
 * `reset: true` → 清空会话/文件/边/失败，再应用本包；`rev` 仍取包里的值。
 * 迟到/更旧的增量包（非 reset 且 rev 更小）由调用方丢弃（controller 负责），这里不做时间旅行。
 */
export function applySnapshot(graph: WorkspaceGraph, snapshot: {
  scanId?: string
  rev?: number
  reset?: boolean
  done?: boolean
  progress?: ScanProgress
  changedSessions?: readonly SessionSummary[]
  changedFiles?: readonly FileNode[]
  changedEdges?: readonly SnapshotCoTurnEdge[]
  removedFiles?: readonly string[]
  removedEdges?: readonly string[]
  errors?: readonly ScanError[]
  truncated?: boolean
}): ApplyResult {
  const reset = snapshot.reset === true
  const sessions = reset ? new Map<string, SessionSummary>() : new Map(graph.sessions)
  const files = reset ? new Map<string, FileNode>() : new Map(graph.files)
  const edges = reset ? new Map<string, SnapshotCoTurnEdge>() : new Map(graph.edges)

  let sessionsChanged = 0
  let filesAdded = 0
  let filesUpdated = 0
  let filesRemoved = 0
  let edgesAdded = 0
  let edgesUpdated = 0
  let edgesRemoved = 0

  for (const session of snapshot.changedSessions ?? []) {
    if (typeof session?.id !== 'string' || session.id === '') continue
    sessions.set(session.id, session)
    sessionsChanged += 1
  }

  for (const file of snapshot.changedFiles ?? []) {
    if (typeof file?.path !== 'string' || file.path === '') continue
    const key = file.path.toLowerCase()
    if (files.has(key)) filesUpdated += 1
    else filesAdded += 1
    files.set(key, file)
  }

  for (const edge of snapshot.changedEdges ?? []) {
    if (typeof edge?.from !== 'string' || typeof edge?.to !== 'string') continue
    if (edge.from === '' || edge.to === '') continue
    const key = edgeKeyOf(edge.from, edge.to)
    if (edges.has(key)) edgesUpdated += 1
    else edgesAdded += 1
    edges.set(key, edge)
  }

  for (const path of snapshot.removedFiles ?? []) {
    if (typeof path !== 'string' || path === '') continue
    if (files.delete(path.toLowerCase())) filesRemoved += 1
  }

  for (const encoded of snapshot.removedEdges ?? []) {
    if (typeof encoded !== 'string' || encoded === '') continue
    if (edges.delete(removedEdgeKey(encoded))) edgesRemoved += 1
  }

  const errors = mergeErrors(graph.errors, snapshot.errors ?? [], reset)
  const truncated = snapshot.truncated === true
  const done = snapshot.done === true
  const coverage = coverageOf({ sessions, files, edges }, snapshot.progress, done, truncated)

  const next: WorkspaceGraph = {
    sessions,
    files,
    edges,
    errors,
    coverage,
    rev: typeof snapshot.rev === 'number' && Number.isFinite(snapshot.rev) ? snapshot.rev : graph.rev,
    resets: reset ? graph.resets + 1 : graph.resets,
    applied: true,
    ...(typeof snapshot.scanId === 'string'
      ? { scanId: snapshot.scanId }
      : graph.scanId !== undefined
        ? { scanId: graph.scanId }
        : {}),
  }

  return {
    graph: next,
    applied: {
      reset,
      sessions: sessionsChanged,
      filesAdded,
      filesUpdated,
      filesRemoved,
      edgesAdded,
      edgesUpdated,
      edgesRemoved,
      errors: errors.length,
      truncated,
      rev: next.rev,
    },
  }
}

/** 当前图的覆盖率（与图同源，不重复计算）。 */
export function coverageOfGraph(graph: WorkspaceGraph): Coverage {
  return graph.coverage
}

/** 失败会话汇总：按会话聚合，保留原因；不把失败当 0。 */
export function failedSessions(graph: WorkspaceGraph): {
  count: number
  sessions: FailedSession[]
  byCode: Partial<Record<ScanError['code'], number>>
} {
  const seen = new Map<string, FailedSession>()
  const byCode: Partial<Record<ScanError['code'], number>> = {}
  for (const error of graph.errors) {
    if (!seen.has(error.sessionId)) {
      const failed: FailedSession = {
        sessionId: error.sessionId,
        code: error.code,
        message: error.message,
      }
      if (typeof error.detail === 'string') failed.detail = error.detail
      seen.set(error.sessionId, failed)
    }
    byCode[error.code] = (byCode[error.code] ?? 0) + 1
  }
  return { count: seen.size, sessions: Array.from(seen.values()), byCode }
}

/** 图的规模摘要（诊断/测试用；不参与渲染）。 */
export function graphStats(graph: WorkspaceGraph): {
  sessions: number
  files: number
  edges: number
  errors: number
  rev: number
  complete: boolean
} {
  return {
    sessions: graph.sessions.size,
    files: graph.files.size,
    edges: graph.edges.size,
    errors: graph.errors.length,
    rev: graph.rev,
    complete: graph.coverage.complete,
  }
}
