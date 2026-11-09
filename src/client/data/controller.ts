/**
 * T04 · 扫描驱动（04 §2.4–§2.7、§5.2、§5.5；03 §11.4；06 A20-2 / N-11 / N-18）。
 *
 * 生命周期：
 *   idle → starting → scanning → partial → complete
 *                          ↘ failed（保留已加载数据，可重试）
 *
 * 职责：
 * - `POST /scan` 启动扫描，随后按 400ms 轮询 `POST /snapshot`（页面隐藏 2s，恢复后立即拉一次）；
 * - `reset: true` 清空旧图再应用；`truncated: true` 立即用最新 rev 续拉（不静默丢）；
 * - `AbortController` + `generation`：切换工作区/重新读取取消旧请求、丢弃旧 generation 迟到响应；
 * - `threadline/scan-not-found`（host 60s 回收）→ 自动重开一次扫描；
 * - 失败退避 1s/2s/5s，最多 3 次；仍失败则显式 failed，不无限重试、不伪造 0 图；
 * - `fetch` 由调用方注入（只允许同源相对路径，见 http.ts）。
 *
 * 本文件不碰 DOM（可见性由 `visibility` 注入，hooks 负责接 `document`），不写存储、不打日志。
 */

import type {
  FileNode,
  ScanError,
  ScanProgress,
  ScanSkippedSummary,
  SessionSummary,
  SnapshotCoTurnEdge,
  ThreadlineError,
  ThreadlineErrorCode,
} from '../../shared/events/index.ts'
import { postJson } from './http.ts'
import type { FetchLike, TransportFailure } from './http.ts'
import { applySnapshot, createEmptyGraph } from './merge.ts'
import type { Coverage, WorkspaceGraph } from './merge.ts'
import {
  degradeEmptyWorkspace,
  degradeForCoverage,
  degradeForError,
  degradeHostUnavailable,
  degradeNone,
} from './degrade.ts'
import type { DegradeState } from './degrade.ts'
import { toScanSessions } from './scope.ts'
import type { WorkspaceScope } from './scope.ts'

/** 控制器对外状态（React 侧只读）。 */
export type ControllerStatus = 'idle' | 'starting' | 'scanning' | 'partial' | 'complete' | 'failed'

/** 失败种类（诊断用；业务错误码另在 `error`）。 */
export type FailureKind = 'route' | 'network' | 'malformed' | 'invalid-scope'

/** 控制器快照（不可变；graph 本身也是不可变的）。 */
export interface ControllerSnapshot {
  status: ControllerStatus
  generation: number
  scanId?: string
  rev: number
  graph: WorkspaceGraph
  coverage: Coverage
  degrade: DegradeState
  error?: ThreadlineError
  failureKind?: FailureKind
  /** 当前失败的重试次数（成功后归零）。 */
  retries: number
  /** scan-not-found 自动重开次数（累计，不因重开归零）。 */
  reopens: number
  workspaceId: string
  currentSessionId: string
  /** 出错时仍保留已加载数据（不丢图）。 */
  retained: boolean
  /** 是否仍在轮询（complete/failed/stopped 后为 false）。 */
  polling: boolean
  /**
   * 被**容错跳过**的会话计数（2026-11-09）。
   *
   * 数据不再因为一行脏就被整条丢弃，但"少读了几条"必须让用户看得见 ——
   * 容错不等于静默遗漏（项目铁律）。
   */
  skipped: ScanSkippedSummary
  updatedAt: number
}

/** 注入的定时器（测试用假实现；默认全局）。 */
export interface TimerApi {
  setTimeout(callback: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

/** 控制器选项。 */
export interface DataControllerOptions {
  fetch: FetchLike
  /** 可见性来源（默认始终 visible；hooks 传 document 的）。 */
  visibility?: () => 'visible' | 'hidden'
  now?: () => number
  timer?: TimerApi
  /** 可见时轮询间隔（04 §8：400ms）。 */
  pollIntervalMs?: number
  /** 隐藏时轮询间隔（04 §5.2：2s）。 */
  hiddenPollIntervalMs?: number
  /** 失败最大重试次数（04 §5.2：3 次）。 */
  maxRetries?: number
  /** 退避序列（毫秒）。 */
  backoffMs?: readonly number[]
  /** 首包是否立即拉取（默认 true，利于首屏预算）。 */
  immediateFirstPoll?: boolean
  onSnapshot?: (snapshot: ControllerSnapshot) => void
}

/** 控制器接口。 */
export interface DataController {
  /** 切到某个工作区范围：取消旧扫描、清空旧图、重新开始（N-18）。 */
  start(scope: WorkspaceScope): Promise<void>
  /** 重新读取：新 generation，保留当前已加载数据直到新数据到达（03 §11.4）。 */
  refresh(options?: { refreshSessionIds?: readonly string[] }): Promise<void>
  /** failed 后重试（语义同 refresh）。 */
  retry(): Promise<void>
  /** 立即拉一次（页面从隐藏恢复时调用）。 */
  pullNow(): void
  /** 可见性变化（hooks 接 `document.visibilitychange`）：隐藏降频、恢复立即拉。 */
  notifyVisibility(state: 'visible' | 'hidden'): void
  /** 停止轮询并中止在途请求（不清理已加载数据）。 */
  stop(): void
  /** 彻底释放（停止 + 清空订阅）。 */
  dispose(): void
  getState(): ControllerSnapshot
  subscribe(listener: (snapshot: ControllerSnapshot) => void): () => void
}

const DEFAULT_POLL_MS = 400
const DEFAULT_HIDDEN_POLL_MS = 2000
const DEFAULT_MAX_RETRIES = 3
const DEFAULT_BACKOFF_MS = [1000, 2000, 5000] as const
const MAX_IMMEDIATE_CONTINUATIONS = 200

const DEFAULT_TIMER: TimerApi = {
  setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === 'string')
}

function asProgress(value: unknown): ScanProgress | undefined {
  const record = asRecord(value)
  if (record === undefined) return undefined
  const phase = record.phase
  const allowed = phase === 'starting' || phase === 'scanning' || phase === 'complete' || phase === 'failed'
  if (!allowed) return undefined
  const num = (key: string): number =>
    typeof record[key] === 'number' && Number.isFinite(record[key]) ? (record[key] as number) : 0
  const progress: ScanProgress = {
    total: num('total'),
    scanned: num('scanned'),
    failed: num('failed'),
    cached: num('cached'),
    phase,
  }
  return progress
}

/* ------------------------------------------------------------------ *
 * 请求装配（A20-1 也用它断言“只发当前 workspace 的会话”）
 * ------------------------------------------------------------------ */

/** `POST /scan` 请求体：只从 scope 取会话，不混其它工作区。 */
export function buildScanRequest(
  scope: WorkspaceScope,
  generation: number,
  refresh?: readonly string[],
): {
  body: {
    workspaceId: string
    cwd: string
    generation: number
    sessions: ReturnType<typeof toScanSessions>['sessions']
    refresh?: string[]
  }
  /** 归一化阶段被跳过的行数（`/scan` 响应没回来之前就能知道的容错量）。 */
  skipped: number
} {
  const normalized = toScanSessions(scope)
  const sessions = normalized.sessions
  const ids = new Set(sessions.map((session) => session.id))
  const body: {
    workspaceId: string
    cwd: string
    generation: number
    sessions: ReturnType<typeof toScanSessions>['sessions']
    refresh?: string[]
  } = {
    workspaceId: scope.workspaceId,
    cwd: scope.cwd,
    generation,
    sessions,
  }
  if (refresh !== undefined && refresh.length > 0) {
    const filtered = Array.from(new Set(refresh.filter((id) => ids.has(id))))
    if (filtered.length > 0) body.refresh = filtered
  }
  return { body, skipped: normalized.skipped.length }
}

/** `POST /scan` 结果。 */
export type ScanStart =
  | {
      ok: true
      scanId: string
      total: number
      order: string[]
      generation: number
      /** 容错跳过的会话计数（客户端归一化 + host 协议层 + 归属层）。 */
      skipped: ScanSkippedSummary
    }
  | { ok: false; failure: TransportFailure }

/** 调 `POST /scan` 并解析 `scanId/total/order`。 */
export async function startScan(options: {
  fetch: FetchLike
  scope: WorkspaceScope
  generation: number
  refresh?: readonly string[]
  signal?: AbortSignal
}): Promise<ScanStart> {
  const built = buildScanRequest(options.scope, options.generation, options.refresh)
  const result = await postJson(options.fetch, 'scan', built.body, options.signal)
  if (!result.ok) return { ok: false, failure: result.failure }
  const scanId = result.value.scanId
  if (typeof scanId !== 'string' || scanId === '') {
    return { ok: false, failure: { kind: 'malformed', status: 0, message: 'scan response missing scanId' } }
  }
  const total = typeof result.value.total === 'number' && Number.isFinite(result.value.total) ? result.value.total : 0
  return {
    ok: true,
    scanId,
    total,
    order: asStringArray(result.value.order),
    generation: options.generation,
    skipped: parseSkipped(result.value.skipped, built.skipped),
  }
}

/**
 * 解析 host 回传的容错计数。
 *
 * 客户端自己归一化时也可能跳过行（`fallback`），两端相加才是**用户能感知到的**缺失量 ——
 * 只报 host 那一半会低估，只报客户端那一半会漏掉归属阶段被跳过的会话。
 */
function parseSkipped(value: unknown, fallbackRequest: number): ScanSkippedSummary {
  const record = value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : undefined
  const num = (input: unknown): number =>
    typeof input === 'number' && Number.isFinite(input) && input > 0 ? Math.floor(input) : 0
  if (record === undefined) return { request: fallbackRequest, ownership: 0, refresh: 0 }
  return {
    request: Math.max(fallbackRequest, num(record.request)),
    ownership: num(record.ownership),
    refresh: num(record.refresh),
  }
}

/** snapshot 包（协议字段的可选版本，未知字段忽略）。 */
interface SnapshotPatch {
  scanId?: string
  rev: number
  reset: boolean
  done: boolean
  progress?: ScanProgress
  changedSessions: SessionSummary[]
  changedFiles: FileNode[]
  changedEdges: SnapshotCoTurnEdge[]
  removedFiles: string[]
  removedEdges: string[]
  errors: ScanError[]
  truncated: boolean
}

function parseSnapshot(value: Record<string, unknown>): SnapshotPatch {
  const progress = asProgress(value.progress)
  const sessions = Array.isArray(value.changedSessions)
    ? (value.changedSessions.filter((entry) => asRecord(entry) !== undefined) as SessionSummary[])
    : []
  const files = Array.isArray(value.changedFiles)
    ? (value.changedFiles.filter((entry) => asRecord(entry) !== undefined) as FileNode[])
    : []
  const edges = Array.isArray(value.changedEdges)
    ? (value.changedEdges.filter((entry) => asRecord(entry) !== undefined) as SnapshotCoTurnEdge[])
    : []
  const errors = Array.isArray(value.errors)
    ? (value.errors.filter((entry) => {
        const record = asRecord(entry)
        return record !== undefined && typeof record.sessionId === 'string' && typeof record.code === 'string'
      }) as ScanError[])
    : []
  return {
    ...(typeof value.scanId === 'string' ? { scanId: value.scanId } : {}),
    rev: typeof value.rev === 'number' && Number.isFinite(value.rev) ? value.rev : 0,
    reset: value.reset === true,
    done: value.done === true,
    ...(progress === undefined ? {} : { progress }),
    changedSessions: sessions,
    changedFiles: files,
    changedEdges: edges,
    removedFiles: asStringArray(value.removedFiles),
    removedEdges: asStringArray(value.removedEdges),
    errors,
    truncated: value.truncated === true,
  }
}

/* ------------------------------------------------------------------ *
 * 控制器
 * ------------------------------------------------------------------ */

interface BeginOptions {
  scope: WorkspaceScope
  generation: number
  keepGraph: boolean
  userInitiated: boolean
  refresh?: readonly string[]
}

function statusOfPhase(phase: Coverage['phase']): ControllerStatus {
  switch (phase) {
    case 'starting':
      return 'starting'
    case 'partial':
      return 'partial'
    case 'complete':
      return 'complete'
    case 'failed':
      return 'failed'
    case 'scanning':
      return 'scanning'
  }
}

/** 建一个扫描控制器（一个实例服务一个“当前工作区”）。 */
export function createDataController(options: DataControllerOptions): DataController {
  const timer = options.timer ?? DEFAULT_TIMER
  const pollMs = options.pollIntervalMs ?? DEFAULT_POLL_MS
  const hiddenPollMs = options.hiddenPollIntervalMs ?? DEFAULT_HIDDEN_POLL_MS
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES
  const backoff = options.backoffMs ?? DEFAULT_BACKOFF_MS
  const immediateFirstPoll = options.immediateFirstPoll ?? true
  const now = options.now ?? Date.now
  const listeners = new Set<(snapshot: ControllerSnapshot) => void>()
  if (options.onSnapshot !== undefined) listeners.add(options.onSnapshot)

  let scope: WorkspaceScope | null = null
  let graph = createEmptyGraph()
  let generation = 0
  let scanId: string | undefined
  let rev = 0
  let status: ControllerStatus = 'idle'
  let degrade: DegradeState = degradeNone()
  // 容错跳过计数：scan 响应回来前是客户端归一化丢掉的量，回来后与 host 上报的合并。
  let skipped: ScanSkippedSummary = { request: 0, ownership: 0, refresh: 0 }
  let error: ThreadlineError | undefined
  let failureKind: FailureKind | undefined
  let retries = 0
  let reopens = 0
  let continuation = 0
  let autoReopenUsed = false
  let stopped = true
  let timerHandle: unknown
  let abort: AbortController | undefined
  let updatedAt = 0
  let lastBegin: BeginOptions | undefined

  const visibility = (): 'visible' | 'hidden' => {
    try {
      return options.visibility?.() === 'hidden' ? 'hidden' : 'visible'
    } catch {
      return 'visible'
    }
  }

  const intervalMs = (): number => (visibility() === 'hidden' ? hiddenPollMs : pollMs)

  const clearTimer = (): void => {
    if (timerHandle !== undefined) {
      timer.clearTimeout(timerHandle)
      timerHandle = undefined
    }
  }

  const buildSnapshot = (): ControllerSnapshot => {
    const snapshot: ControllerSnapshot = {
      status,
      generation,
      rev,
      graph,
      coverage: graph.coverage,
      degrade,
      retries,
      reopens,
      workspaceId: scope?.workspaceId ?? '',
      currentSessionId: scope?.currentSessionId ?? '',
      retained: graph.applied,
      polling: !stopped && status !== 'complete' && status !== 'failed',
      skipped,
      updatedAt,
    }
    if (scanId !== undefined) snapshot.scanId = scanId
    if (error !== undefined) snapshot.error = error
    if (failureKind !== undefined) snapshot.failureKind = failureKind
    return snapshot
  }

  const emit = (): void => {
    updatedAt = now()
    const snapshot = buildSnapshot()
    for (const listener of listeners) {
      try {
        listener(snapshot)
      } catch {
        // 订阅方异常不影响数据层。
      }
    }
  }

  const schedule = (ms: number): void => {
    clearTimer()
    if (stopped) return
    timerHandle = timer.setTimeout(() => {
      timerHandle = undefined
      if (stopped) return
      if (scanId === undefined) {
        if (lastBegin !== undefined) void begin({ ...lastBegin, userInitiated: false })
      } else {
        void poll()
      }
    }, ms)
  }

  const failWith = (
    nextStatus: 'failed',
    errorOrFailure: TransportFailure | ThreadlineError,
    nextDegrade: DegradeState,
  ): void => {
    if ('kind' in errorOrFailure && (errorOrFailure as TransportFailure).kind === 'aborted') return
    clearTimer()
    abort?.abort()
    status = nextStatus
    degrade = nextDegrade
    if ('kind' in errorOrFailure) {
      const failure = errorOrFailure as TransportFailure
      failureKind = failure.kind === 'route' || failure.kind === 'malformed' ? failure.kind : 'network'
      if (failure.kind === 'route') error = failure.error
      else if (failure.kind === 'aborted') error = { code: 'threadline/internal', message: 'aborted' }
      else error = { code: 'threadline/internal', message: failure.message }
    } else {
      error = errorOrFailure as ThreadlineError
      failureKind = 'route'
    }
    emit()
  }

  const retryOrFail = (failure: TransportFailure, nextDegrade: DegradeState): void => {
    if (retries >= maxRetries) {
      failWith('failed', failure, nextDegrade)
      return
    }
    const delay = backoff[Math.min(retries, backoff.length - 1)]
    retries += 1
    emit()
    schedule(delay)
  }

  const reopenScan = (): boolean => {
    if (stopped || scope === null || autoReopenUsed) return false
    autoReopenUsed = true
    reopens += 1
    retries = 0
    const base: BeginOptions =
      lastBegin ?? { scope, generation, keepGraph: true, userInitiated: false }
    void begin({ ...base, keepGraph: true, userInitiated: false })
    return true
  }

  const handleRouteError = (failure: Extract<TransportFailure, { kind: 'route' }>): void => {
    const code = failure.error.code
    switch (code) {
      case 'threadline/scan-not-found':
        // host 60s 无轮询回收 / 扫描被替换：自动重开一次（06 N-11）。
        if (reopenScan()) return
        failWith('failed', failure, degradeForError(code, 'scan-not-found'))
        return
      case 'threadline/capability-missing':
      case 'threadline/bad-request':
        failWith('failed', failure, degradeForError(code))
        return
      case 'threadline/session-unreadable':
      case 'threadline/format-unsupported':
      case 'threadline/limit-exceeded':
        // 单会话/裁剪类错误：不打断扫描，显式标记后继续（06 N-02 / N-10）。
        degrade = degradeForError(code)
        error = failure.error
        emit()
        schedule(intervalMs())
        return
      case 'threadline/internal':
        retryOrFail(failure, degradeForError(code))
        return
    }
  }

  const handlePollFailure = (failure: TransportFailure): void => {
    if (failure.kind === 'aborted') return
    if (failure.kind === 'route') {
      handleRouteError(failure)
      return
    }
    retryOrFail(failure, degradeHostUnavailable('transport'))
  }

  const handleStartFailure = (failure: TransportFailure): void => {
    if (failure.kind === 'aborted') return
    if (failure.kind === 'route') {
      const code = failure.error.code
      if (code === 'threadline/capability-missing' || code === 'threadline/bad-request') {
        failWith('failed', failure, degradeForError(code))
        return
      }
      if (code === 'threadline/scan-not-found' && reopenScan()) return
      retryOrFail(failure, degradeForError(code))
      return
    }
    retryOrFail(failure, degradeHostUnavailable('transport'))
  }

  const applyAndEmit = (patch: SnapshotPatch): void => {
    const stale = patch.reset !== true && patch.rev < rev
    if (stale) {
      schedule(intervalMs())
      return
    }
    const applied = applySnapshot(graph, {
      ...(patch.scanId === undefined ? {} : { scanId: patch.scanId }),
      rev: patch.rev,
      reset: patch.reset,
      done: patch.done,
      ...(patch.progress === undefined ? {} : { progress: patch.progress }),
      changedSessions: patch.changedSessions,
      changedFiles: patch.changedFiles,
      changedEdges: patch.changedEdges,
      removedFiles: patch.removedFiles,
      removedEdges: patch.removedEdges,
      errors: patch.errors,
      truncated: patch.truncated,
    })
    graph = applied.graph
    rev = applied.graph.rev
    retries = 0
    error = undefined
    failureKind = undefined
    status = statusOfPhase(applied.graph.coverage.phase)
    degrade =
      applied.graph.coverage.phase === 'complete' && applied.graph.coverage.total === 0
        ? degradeEmptyWorkspace()
        : degradeForCoverage(applied.graph.coverage)

    if (patch.truncated) {
      continuation += 1
      emit()
      // 立即用最新 rev 续拉；极长续页退化为正常节奏，避免热循环（仍不丢数据）。
      schedule(continuation < MAX_IMMEDIATE_CONTINUATIONS ? 0 : intervalMs())
      return
    }
    continuation = 0
    emit()
    if (patch.done) {
      clearTimer()
      return
    }
    schedule(intervalMs())
  }

  const poll = async (): Promise<void> => {
    if (stopped || scanId === undefined || scope === null) return
    const activeGeneration = generation
    const activeScanId = scanId
    const result = await postJson(options.fetch, 'snapshot', { scanId: activeScanId, sinceRev: rev }, abort?.signal)
    // generation 变了或换了 scanId：丢弃迟到响应，不串数据（06 N-18）。
    if (stopped || generation !== activeGeneration || scanId !== activeScanId) return
    if (!result.ok) {
      handlePollFailure(result.failure)
      return
    }
    applyAndEmit(parseSnapshot(result.value))
  }

  const begin = async (beginOptions: BeginOptions): Promise<void> => {
    const { scope: nextScope, generation: nextGeneration, keepGraph, userInitiated } = beginOptions
    clearTimer()
    abort?.abort()
    const controller = new AbortController()
    abort = controller
    scope = nextScope
    generation = nextGeneration
    scanId = undefined
    if (userInitiated) {
      retries = 0
      autoReopenUsed = false
    }
    continuation = 0
    lastBegin = beginOptions
    stopped = false
    if (!keepGraph) {
      graph = createEmptyGraph()
      rev = 0
    }
    status = 'starting'
    degrade = degradeNone()
    error = undefined
    failureKind = undefined
    emit()

    if (nextScope.cwd.trim() === '') {
      failWith(
        'failed',
        { code: 'threadline/bad-request', message: 'workspace cwd unknown' },
        degradeForError('threadline/bad-request', 'cwd-unknown'),
      )
      return
    }

    const started = await startScan({
      fetch: options.fetch,
      scope: nextScope,
      generation: nextGeneration,
      ...(beginOptions.refresh === undefined ? {} : { refresh: beginOptions.refresh }),
      signal: controller.signal,
    })
    if (stopped || generation !== nextGeneration) return
    if (!started.ok) {
      handleStartFailure(started.failure)
      return
    }

    scanId = started.scanId
    rev = 0
    status = 'scanning'
    degrade = degradeNone()
    // 容错跳过量随扫描开始一起更新：用户看到「N 条未能读取」而不是少了几条却不知道。
    skipped = started.skipped
    emit()
    schedule(immediateFirstPoll ? 0 : intervalMs())
  }

  const controller: DataController = {
    start(nextScope: WorkspaceScope): Promise<void> {
      return begin({ scope: nextScope, generation: generation + 1, keepGraph: false, userInitiated: true })
    },
    refresh(refreshOptions?: { refreshSessionIds?: readonly string[] }): Promise<void> {
      if (scope === null) return Promise.resolve()
      return begin({
        scope,
        generation: generation + 1,
        keepGraph: true,
        userInitiated: true,
        ...(refreshOptions?.refreshSessionIds === undefined ? {} : { refresh: refreshOptions.refreshSessionIds }),
      })
    },
    retry(): Promise<void> {
      return controller.refresh()
    },
    pullNow(): void {
      if (stopped || status === 'complete' || status === 'failed') return
      clearTimer()
      if (scanId !== undefined) void poll()
    },
    notifyVisibility(next: 'visible' | 'hidden'): void {
      if (stopped || status === 'complete' || status === 'failed') return
      if (next === 'hidden') {
        clearTimer()
        if (scanId !== undefined) schedule(hiddenPollMs)
        return
      }
      controller.pullNow()
    },
    stop(): void {
      stopped = true
      clearTimer()
      abort?.abort()
      emit()
    },
    dispose(): void {
      stopped = true
      clearTimer()
      abort?.abort()
      listeners.clear()
    },
    getState(): ControllerSnapshot {
      return buildSnapshot()
    },
    subscribe(listener: (snapshot: ControllerSnapshot) => void): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }

  return controller
}

/** 空 workspace 的显式空态（供 hooks/UI 复用；不代表“读到 0 个文件”）。 */
export function emptyWorkspaceDegrade(): DegradeState {
  return degradeEmptyWorkspace()
}
