/**
 * 工作区扫描器（04 §2.4/§2.5/§2.6、§4、§8）。
 *
 * 职责与边界：
 * - **只读会话日志 + 只写内存**；不 import fs、不写文件、不发外部请求；
 * - 扫描队列排序：当前会话（running）→ 其子智能体 → 最近 7 天 → 更早历史 → 归档；
 * - 让步：按 50ms 预算让出事件循环，单个大会话不会卡死插件；
 * - 进度只反映真实计数；失败单独计数并保留错误码；
 * - 60s 无轮询自动取消并释放；同一 workspace 新扫描取消旧扫描；
 * - 所有上限来自 `shared/events/limits.ts`，超限标 `truncated`，不静默。
 */
import {
  fileNodeFromTouches,
  LIMITS,
  normalizeCwd,
  reduceSession,
  sameWorkspaceCwd,
  utf8Length,
} from '../shared/events/index.ts'
// 路径包含关系只有一份实现（host/tree.ts 也用同一个），不在这里另写一套。
import { containsPath } from '../shared/relations/path.ts'
import type {
  DetailRequest,
  DetailResponse,
  FileNode,
  FileTouch,
  SnapshotCoTurnEdge,
  ReduceLimits,
  ScanError,
  ScanProgress,
  ScanRequest,
  ScanResponse,
  ScanSessionSkip,
  SessionDetail,
  SessionHeaderLite,
  SessionSummary,
  SnapshotRequest,
  SnapshotResponse,
  SubagentRecord,
  ThreadlineErrorCode,
  ThreadlineResponse,
} from '../shared/events/index.ts'
import type { HostServices, PersistenceLike, SessionHandleLike } from './services.ts'

/* ------------------------------------------------------------------ *
 * 内部类型
 * ------------------------------------------------------------------ */

/** 扫描管理器可注入项（`now`/`yield`/上限是测试缝；生产走默认值）。 */
export interface ScanManagerOptions {
  now?(): number
  yield?(): Promise<void>
  /** 60s 无轮询自动取消；测试可调小。 */
  idleTimeoutMs?: number
  /** 响应上限；默认 8MB，测试可注入更小值以验证裁剪。 */
  responseBytes?: number
  /** 归约上限覆盖（测试用）。 */
  reduceLimits?: Partial<ReduceLimits>
}

/** 单会话的一次归约成果（跨扫描复用，避免重读未变化的会话）。 */
interface SessionDigest {
  /** 客户端上报的 updatedAt（缓存有效性判据）。 */
  updatedAt: number
  /** SessionSummary 去掉 rootId/subagents（它们依赖本次集合，apply 时重算）。 */
  info: Omit<SessionSummary, 'rootId' | 'subagents'>
  touches: FileTouch[]
  edges: EdgeContribution[]
  /** `subagent/catalog` 记录的子会话 id（真实记录，不是推断）。 */
  catalogChildren: string[]
}

interface EdgeContribution {
  from: string
  to: string
  weight: number
  evidence: Array<{ sessionId: string; turn: number }>
}

interface SnapshotPatch {
  sessions: SessionSummary[]
  files: FileNode[]
  edges: SnapshotCoTurnEdge[]
  removedFiles: string[]
  removedEdges: string[]
  errors: ScanError[]
}

interface ScanState {
  scanId: string
  workspaceId: string
  generation: number
  cwd: string
  rev: number
  /** rev→patch 日志的最旧 rev；`sinceRev` 更早则必须 reset。 */
  minRev: number
  changes: Array<{ rev: number; patch: SnapshotPatch }>
  progress: ScanProgress
  sessions: Map<string, SessionSummary>
  files: Map<string, FileNode>
  edges: Map<string, SnapshotCoTurnEdge>
  errors: ScanError[]
  /** 本集合内每个会话的子会话（来自 header.parentSession，已验证）。 */
  requestChildren: Map<string, string[]>
  /** 本次 scan 的请求行（detail 在扫描早期也按「属于本扫描」放行）。 */
  inputs: Map<string, ScanRequest['sessions'][number]>
  done: boolean
  cancelled: boolean
  startedAt: number
  lastPollAt: number
  timer?: ReturnType<typeof setTimeout>
  abort: AbortController
  resetCursor?: { rev: number; files: number; edges: number }
  filesTruncated: boolean
  edgesTruncated: boolean
}

interface WorkspaceState {
  workspaceId: string
  cwd: string
  digests: Map<string, SessionDigest>
  activeScanId?: string
}

interface OwnershipResult {
  ok: boolean
  headers?: Map<string, SessionHeaderLite>
  parents?: Map<string, string | undefined>
  /** 由会话 header 推导出的**权威 cwd**（客户端 cwd 只作兜底）。 */
  cwd?: string
  error?: { code: ThreadlineErrorCode; message: string; detail?: string }
}

/** 取会话 header cwd 的众数（并列取先出现者 → 确定性）。空集合返回 undefined。 */
function pickAuthoritativeCwd(headers: ReadonlyMap<string, SessionHeaderLite>): string | undefined {
  const counts = new Map<string, { count: number; firstAt: number }>()
  let order = 0
  for (const header of headers.values()) {
    const cwd = normalizeCwd(typeof header.cwd === 'string' ? header.cwd : '')
    if (cwd === '') continue
    const existing = counts.get(cwd)
    if (existing === undefined) counts.set(cwd, { count: 1, firstAt: order })
    else existing.count += 1
    order += 1
  }
  let best: string | undefined
  let bestCount = 0
  let bestFirst = Number.POSITIVE_INFINITY
  for (const [cwd, stat] of counts) {
    if (stat.count > bestCount || (stat.count === bestCount && stat.firstAt < bestFirst)) {
      best = cwd
      bestCount = stat.count
      bestFirst = stat.firstAt
    }
  }
  return best
}

/**
 * `target` 是否与 `root` 相同、或位于 `root` 之下（分隔符/大小写不敏感）。
 *
 * 为什么需要它：会话可能在**子目录**里开过（header.cwd 是子目录），
 * 那仍然属于这个工作区；旧实现要求 cwd 完全相等，于是这类会话会让整条扫描失败。
 */
function isSameOrInside(root: string, target: string | undefined): boolean {
  const left = normalizeCwd(root)
  const right = normalizeCwd(typeof target === 'string' ? target : '')
  if (left === '' || right === '') return false
  if (sameWorkspaceCwd(left, right)) return true
  return containsPath(left, right)
}

/* ------------------------------------------------------------------ *
 * 错误映射（rc.5 错误类名 → 04 §2.7 错误码）
 * ------------------------------------------------------------------ */

function errorName(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'name' in error) {
    const name = (error as { name?: unknown }).name
    if (typeof name === 'string') return name
  }
  return ''
}

/** 冷读错误 → 04 §2.7 错误码（不把宿主错误类绑进编译期，按 name 判定）。 */
export function mapReadError(error: unknown): { code: ThreadlineErrorCode; message: string; detail?: string } {
  const name = errorName(error)
  if (name === 'SessionFormatUnsupportedError') {
    return { code: 'threadline/format-unsupported', message: 'session format unsupported' }
  }
  if (
    name === 'SessionPersistenceCorruptionError' ||
    name === 'SessionPersistenceNotFoundError' ||
    name === 'SessionNotFoundError' ||
    name === 'SessionHandleClosedError'
  ) {
    return { code: 'threadline/session-unreadable', message: 'session log unreadable', detail: name }
  }
  if (name === 'SessionReadOnlyError') {
    // 只读句柄上出现写语义：宿主异常，不是我们的写操作。
    return { code: 'threadline/internal', message: 'unexpected read-only violation', detail: name }
  }
  return { code: 'threadline/internal', message: 'scan failed', detail: name === '' ? undefined : name }
}

/* ------------------------------------------------------------------ *
 * 排序（04 §2.4 / §5.1）
 * ------------------------------------------------------------------ */

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

function byUpdatedDesc(a: ScanRequest['sessions'][number], b: ScanRequest['sessions'][number]): number {
  if (b.updatedAt !== a.updatedAt) return b.updatedAt - a.updatedAt
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/**
 * 处理顺序：running（当前活跃会话）→ 其子智能体 → 最近 7 天 → 更早 → 归档。
 * 父会话永远排在子会话之前（否则子会话无法归到工作线 rootId）。
 */
export function orderSessions(
  inputs: readonly ScanRequest['sessions'][number][],
  parents: ReadonlyMap<string, string | undefined>,
  now: number,
): string[] {
  const byId = new Map(inputs.map((input) => [input.id, input]))
  const children = new Map<string, string[]>()
  for (const input of inputs) {
    const parent = parents.get(input.id)
    if (parent === undefined || !byId.has(parent)) continue
    const list = children.get(parent)
    if (list === undefined) children.set(parent, [input.id])
    else list.push(input.id)
  }
  for (const list of children.values()) {
    list.sort((a, b) => byUpdatedDesc(byId.get(a)!, byId.get(b)!))
  }

  const order: string[] = []
  const placed = new Set<string>()
  const visit = (id: string): void => {
    if (placed.has(id)) return
    const parent = parents.get(id)
    if (parent !== undefined && byId.has(parent) && !placed.has(parent)) visit(parent)
    if (placed.has(id)) return
    placed.add(id)
    order.push(id)
    for (const child of children.get(id) ?? []) visit(child)
  }

  const running = inputs.filter((input) => input.running && input.archived !== true).sort(byUpdatedDesc)
  const recent = inputs
    .filter((input) => !input.running && input.archived !== true && input.updatedAt >= now - WEEK_MS)
    .sort(byUpdatedDesc)
  const older = inputs
    .filter((input) => !input.running && input.archived !== true && input.updatedAt < now - WEEK_MS)
    .sort(byUpdatedDesc)
  const archived = inputs.filter((input) => input.archived === true).sort(byUpdatedDesc)

  for (const group of [running, recent, older, archived]) {
    for (const input of group) visit(input.id)
  }
  for (const input of inputs) visit(input.id)
  return order
}

/* ------------------------------------------------------------------ *
 * 边贡献（04 §4.4）：每个 turn 取 ops top-12 文件两两成对
 * ------------------------------------------------------------------ */

function buildEdgeContributions(sessionId: string, touches: readonly FileTouch[]): EdgeContribution[] {
  const byTurn = new Map<number, FileTouch[]>()
  for (const touch of touches) {
    if (touch.turn === null) continue
    const list = byTurn.get(touch.turn)
    if (list === undefined) byTurn.set(touch.turn, [touch])
    else list.push(touch)
  }
  const edges = new Map<string, EdgeContribution>()
  for (const [turn, files] of byTurn) {
    const ranked = files
      .slice()
      .sort((a, b) => {
        const opsA = a.reads + a.writes + a.searches
        const opsB = b.reads + b.writes + b.searches
        if (opsB !== opsA) return opsB - opsA
        return a.key < b.key ? -1 : a.key > b.key ? 1 : 0
      })
      .slice(0, LIMITS.maxCoTurnFiles)
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    for (let i = 0; i < ranked.length; i += 1) {
      for (let j = i + 1; j < ranked.length; j += 1) {
        const from = ranked[i]
        const to = ranked[j]
        const key = `${from.key}\n${to.key}`
        const existing = edges.get(key)
        if (existing !== undefined) {
          existing.weight += 1
          existing.evidence.push({ sessionId, turn })
          continue
        }
        edges.set(key, { from: from.path, to: to.path, weight: 1, evidence: [{ sessionId, turn }] })
      }
    }
  }
  for (const edge of edges.values()) {
    if (edge.evidence.length > LIMITS.edgeEvidence) edge.evidence = edge.evidence.slice(-LIMITS.edgeEvidence)
  }
  return Array.from(edges.values())
}

function digestFromReduction(updatedAt: number, detail: SessionDetail, touches: readonly FileTouch[]): SessionDigest {
  return {
    updatedAt,
    info: {
      id: detail.id,
      ...(detail.parentId === undefined ? {} : { parentId: detail.parentId }),
      ...(detail.title === undefined ? {} : { title: detail.title }),
      cwd: detail.cwd,
      ...(detail.origin === undefined ? {} : { origin: detail.origin }),
      archived: detail.archived === true,
      running: detail.running === true,
      startedAt: detail.startedAt,
      ...(detail.endedAt === undefined ? {} : { endedAt: detail.endedAt }),
      updatedAt: detail.updatedAt,
      ...(detail.model === undefined ? {} : { model: detail.model }),
      ...(detail.provider === undefined ? {} : { provider: detail.provider }),
      status: detail.status,
      turns: detail.counts.turns,
      files: detail.counts.files,
      commands: detail.counts.commands,
      errors: detail.counts.errors,
    },
    touches: touches.slice(),
    edges: buildEdgeContributions(detail.id, touches),
    catalogChildren: detail.subagents.map((child) => child.id),
  }
}

/** 边的身份 key：大小写不敏感（Windows 上同一文件可能以不同大小写出现，不能拆成两条边）。 */
function edgeKey(from: string, to: string): string {
  return `${from.toLowerCase()}\u0000${to.toLowerCase()}`
}

function unionChildren(catalog: readonly string[], requestChildren: readonly string[]): string[] {
  const set = new Set<string>(catalog)
  for (const id of requestChildren) set.add(id)
  return Array.from(set)
}

/* ------------------------------------------------------------------ *
 * ScanManager
 * ------------------------------------------------------------------ */

/** 扫描/快照/详情的内存实现（只写内存）。 */
export class ScanManager {
  private readonly services: HostServices
  private readonly options: ScanManagerOptions
  private readonly workspaces = new Map<string, WorkspaceState>()
  private readonly scans = new Map<string, ScanState>()
  private readonly detailCache = new Map<string, { updatedAt: number; detail: SessionDetail }>()
  private lastScan?: ScanState
  private scanCounter = 0
  private disposed = false

  constructor(services: HostServices, options: ScanManagerOptions = {}) {
    this.services = services
    this.options = options
  }

  private now(): number {
    return this.options.now?.() ?? Date.now()
  }

  private async yieldNow(): Promise<void> {
    if (this.options.yield !== undefined) await this.options.yield()
    else await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }

  private responseBytes(): number {
    return this.options.responseBytes ?? LIMITS.responseBytes
  }

  private reduceLimits(): Partial<ReduceLimits> | undefined {
    return this.options.reduceLimits
  }

  /* ---------------- scan ---------------- */

  /**
   * `POST /scan`：校验归属后启动后台扫描，立即返回 scanId/total/order。
   *
   * `tolerance` 携带协议层已容错掉的计数（脏行、被丢弃的 refresh id），
   * 与归属阶段的跳过数合并后一并在响应里上报 —— 容错必须可见。
   */
  async startRequest(
    request: ScanRequest,
    tolerance: { skipped?: readonly ScanSessionSkip[]; refreshDropped?: number } = {},
  ): Promise<ThreadlineResponse<ScanResponse>> {
    const persistence = this.services.getPersistence()
    if (persistence === undefined) {
      return { ok: false, error: { code: 'threadline/capability-missing', message: 'session persistence unavailable' } }
    }

    const ownership = await this.validateOwnership(persistence, request)
    if (!ownership.ok || ownership.headers === undefined || ownership.parents === undefined) {
      return {
        ok: false,
        error: ownership.error ?? { code: 'threadline/bad-request', message: 'session ownership rejected' },
      }
    }
    // 归属校验后**以数据为准**的权威 cwd（客户端传的只作兜底）：
    // 客户端算出的 cwd 与会话 header 里的 cwd 是两份事实来源，
    // 以客户端那份为准时，任何形态差异都会让整条扫描失败（2026-11-09 事故根因之一）。
    const authoritativeCwd = ownership.cwd !== undefined && ownership.cwd !== '' ? ownership.cwd : request.cwd
    const sessions = request.sessions.filter((input) => ownership.headers?.has(input.id) === true)

    const workspace = this.workspaceFor(request.workspaceId, authoritativeCwd)
    // 同一 workspace 只保留一个活动扫描：新扫描取消旧的。
    if (workspace.activeScanId !== undefined) this.cancelScan(workspace.activeScanId)

    const order = orderSessions(sessions, ownership.parents, this.now())
    const requestChildren = new Map<string, string[]>()
    for (const [id, parent] of ownership.parents) {
      if (parent === undefined || !ownership.headers.has(parent)) continue
      const list = requestChildren.get(parent)
      if (list === undefined) requestChildren.set(parent, [id])
      else list.push(id)
    }

    const scanId = `scan-${(this.scanCounter += 1)}`
    const state: ScanState = {
      scanId,
      workspaceId: request.workspaceId,
      generation: request.generation,
      cwd: request.cwd,
      rev: 0,
      minRev: 1,
      changes: [],
      progress: { total: order.length, scanned: 0, failed: 0, cached: 0, phase: 'starting' },
      sessions: new Map<string, SessionSummary>(),
      files: new Map<string, FileNode>(),
      edges: new Map<string, SnapshotCoTurnEdge>(),
      errors: [],
      requestChildren,
      inputs: new Map(sessions.map((input) => [input.id, input])),
      done: false,
      cancelled: false,
      startedAt: this.now(),
      lastPollAt: this.now(),
      abort: new AbortController(),
      filesTruncated: false,
      edgesTruncated: false,
    }
    workspace.activeScanId = scanId
    this.scans.set(scanId, state)
    this.lastScan = state
    this.trimScanRegistry()
    this.armIdleTimer(state)

    const inputs = new Map(sessions.map((input) => [input.id, input]))
    const refresh = new Set(request.refresh ?? [])
    void this.runScan(state, workspace, inputs, ownership.headers, order, refresh).catch(() => {
      if (!state.cancelled) {
        state.progress.phase = 'failed'
        state.done = true
      }
    })

    // 容错必须可见：把三层跳过数一起回传，客户端显示「N 条会话未能读取」。
    const skippedSummary = {
      request: tolerance.skipped?.length ?? 0,
      ownership: Math.max(0, request.sessions.length - sessions.length),
      refresh: tolerance.refreshDropped ?? 0,
    }
    const payload: ScanResponse = { scanId, rev: 0, total: order.length, order }
    if (skippedSummary.request > 0 || skippedSummary.ownership > 0 || skippedSummary.refresh > 0) {
      payload.skipped = skippedSummary
    }
    return { ok: true, ...payload }
  }

  /**
   * 归属校验：判定每个会话是否属于本次扫描，并给出**权威 cwd**。
   *
   * 2026-11-09 改为**逐行容错**（原来是"一个不合规就整条拒绝"）：
   * - 读不出 header → 跳过该会话（持久层单条坏不该毁掉整个工作区）；
   * - 既不是同 cwd、也不在任一请求会话的子树下、父会话又不在请求里 → 跳过；
   * - **全部跳过**才返回 `bad-request`（那才是真的 workspace 不匹配，必须响亮失败）。
   *
   * 权威 cwd 取**会话 header 里的众数**，客户端传的 cwd 只作兜底：
   * 客户端 cwd 与会话 header cwd 是两份事实来源，以客户端那份为准时任何形态差异都会整条失败。
   */
  private async validateOwnership(persistence: PersistenceLike, request: ScanRequest): Promise<OwnershipResult> {
    const requestedIds = new Set(request.sessions.map((input) => input.id))
    const headers = new Map<string, SessionHeaderLite>()
    const query = this.services.getSessionQuery()
    if (query?.listSessions !== undefined) {
      let listed: unknown[] = []
      try {
        listed = await query.listSessions()
      } catch {
        listed = []
      }
      for (const entry of listed) {
        const candidate = entry as { header?: SessionHeaderLite } & Partial<SessionHeaderLite>
        const header = candidate.header ?? (candidate as SessionHeaderLite)
        if (header === undefined || typeof header.id !== 'string') continue
        // 只保留本次请求涉及的会话，避免把别的 workspace 的 header 带进来。
        if (!requestedIds.has(header.id)) continue
        headers.set(header.id, header)
      }
    }

    // 1) 补读缺失的 header（读不到就是 undefined，随后按跳过处理）。
    for (const input of request.sessions) {
      if (headers.has(input.id)) continue
      const header = await this.readHeader(persistence, input.id)
      if (header !== undefined) headers.set(input.id, header)
    }

    // 2) 权威 cwd = 会话 header cwd 的众数（并列取先出现者，保证确定性）。
    const authoritativeCwd = pickAuthoritativeCwd(headers) ?? normalizeCwd(request.cwd)

    // 3) 逐行判定；不合规的跳过，不打断整体。
    const kept = new Map<string, SessionHeaderLite>()
    for (const input of request.sessions) {
      const header = headers.get(input.id)
      if (header === undefined) continue
      const parent = header.parentSession
      if (parent !== undefined && requestedIds.has(parent)) {
        kept.set(input.id, header)
        continue
      }
      if (isSameOrInside(authoritativeCwd, header.cwd)) kept.set(input.id, header)
    }

    // 空工作区是**合法**状态（0 个会话也要能出图、能 reset），所以只有
    // 「请求里明明有会话，却一个都不属于本工作区」才算真的不匹配 —— 那时必须响亮失败。
    if (kept.size === 0 && request.sessions.length > 0) {
      return {
        ok: false,
        error: {
          code: 'threadline/bad-request',
          message: 'no session in the request belongs to this workspace',
        },
      }
    }

    const parents = new Map<string, string | undefined>()
    for (const [id, header] of kept) parents.set(id, header.parentSession)
    return { ok: true, headers: kept, parents, cwd: authoritativeCwd }
  }

  private async readHeader(persistence: PersistenceLike, id: string): Promise<SessionHeaderLite | undefined> {
    try {
      if (persistence.stat !== undefined) {
        const stat = await persistence.stat(id)
        if (stat?.header !== undefined) return stat.header
      }
      const handle = await persistence.open(id, 'read')
      try {
        return handle.header
      } finally {
        await handle.close?.()
      }
    } catch {
      return undefined
    }
  }

  private workspaceFor(workspaceId: string, cwd: string): WorkspaceState {
    const existing = this.workspaces.get(workspaceId)
    if (existing !== undefined) {
      existing.cwd = cwd
      return existing
    }
    const created: WorkspaceState = { workspaceId, cwd, digests: new Map<string, SessionDigest>() }
    this.workspaces.set(workspaceId, created)
    return created
  }

  private async runScan(
    state: ScanState,
    workspace: WorkspaceState,
    inputs: Map<string, ScanRequest['sessions'][number]>,
    headers: Map<string, SessionHeaderLite>,
    order: readonly string[],
    refresh: Set<string>,
  ): Promise<void> {
    state.progress.phase = 'scanning'
    let lastYieldAt = this.now()
    let processed = 0
    for (const id of order) {
      if (state.cancelled || this.disposed) return
      const input = inputs.get(id)
      if (input === undefined) continue
      state.progress.currentId = id
      const patch = this.emptyPatch()
      await this.processSession(state, workspace, input, headers.get(id), refresh, patch)
      state.rev += 1
      this.pushChanges(state, state.rev, patch)
      processed += 1
      // 生产：按 50ms 预算让出（04 §8）；测试注入 yield 时每个会话都让出，
      // 便于确定性地观察「扫描进行中」的快照状态机（同一个让步函数，无第二套调度）。
      if (this.options.yield !== undefined) {
        // 最后一个会话之后不再让出（没有后续工作，done 应立刻可见）。
        if (processed < order.length) await this.yieldNow()
        lastYieldAt = this.now()
        continue
      }
      const now = this.now()
      if (now - lastYieldAt >= LIMITS.yieldIntervalMs || processed % 16 === 0) {
        await this.yieldNow()
        lastYieldAt = this.now()
      }
    }
    if (state.cancelled || this.disposed) return
    state.progress.currentId = undefined
    state.progress.phase = 'complete'
    state.done = true
  }

  private async processSession(
    state: ScanState,
    workspace: WorkspaceState,
    input: ScanRequest['sessions'][number],
    header: SessionHeaderLite | undefined,
    refresh: Set<string>,
    patch: SnapshotPatch,
  ): Promise<void> {
    const cached = workspace.digests.get(input.id)
    if (cached !== undefined && cached.updatedAt === input.updatedAt && !refresh.has(input.id)) {
      state.progress.cached += 1
      this.applyDigest(state, cached, input, patch)
      state.progress.scanned += 1
      return
    }
    const persistence = this.services.getPersistence()
    if (persistence === undefined) {
      state.progress.failed += 1
      this.recordScanError(state, patch, {
        sessionId: input.id,
        code: 'threadline/capability-missing',
        message: 'session persistence unavailable',
      })
      return
    }
    let handle: SessionHandleLike | undefined
    try {
      handle = await persistence.open(input.id, 'read', { signal: state.abort.signal })
      const read = await handle.read(0, undefined, { signal: state.abort.signal })
      const events = Array.isArray(read?.events) ? read.events : []
      const openHeader = handle.header ?? header ?? { id: input.id, createdAt: input.updatedAt }
      const reduction = reduceSession(openHeader, events, {
        cwd: this.cwdFor(openHeader, state.cwd),
        running: input.running,
        limits: this.reduceLimits(),
      })
      const digest = digestFromReduction(input.updatedAt, reduction.detail, reduction.touches)
      workspace.digests.set(input.id, digest)
      this.trimDigests(workspace)
      this.applyDigest(state, digest, input, patch)
      state.progress.scanned += 1
    } catch (error) {
      if (state.cancelled) return
      state.progress.failed += 1
      const mapped = mapReadError(error)
      this.recordScanError(state, patch, {
        sessionId: input.id,
        code: mapped.code,
        message: mapped.message,
        ...(mapped.detail === undefined ? {} : { detail: mapped.detail }),
      })
    } finally {
      try {
        await handle?.close?.()
      } catch {
        // 关闭失败不影响已得数据；错误码已记录。
      }
    }
  }

  private cwdFor(header: SessionHeaderLite, fallback: string): string {
    return header.cwd !== undefined && header.cwd !== '' ? header.cwd : fallback
  }

  private emptyPatch(): SnapshotPatch {
    return { sessions: [], files: [], edges: [], removedFiles: [], removedEdges: [], errors: [] }
  }

  private recordScanError(state: ScanState, patch: SnapshotPatch, error: ScanError): void {
    if (state.errors.length < LIMITS.maxErrors) state.errors.push(error)
    patch.errors.push(error)
  }

  /** 把一份会话贡献（新归约或缓存摘要）合并进扫描状态。 */
  private applyDigest(
    state: ScanState,
    digest: SessionDigest,
    input: ScanRequest['sessions'][number],
    patch: SnapshotPatch,
  ): void {
    const summary: SessionSummary = {
      id: digest.info.id,
      ...(digest.info.parentId === undefined ? {} : { parentId: digest.info.parentId }),
      rootId: digest.info.id,
      ...(digest.info.title === undefined ? {} : { title: digest.info.title }),
      cwd: digest.info.cwd,
      ...(digest.info.origin === undefined ? {} : { origin: digest.info.origin }),
      archived: input.archived === true,
      running: input.running || digest.info.running,
      startedAt: digest.info.startedAt,
      ...(digest.info.endedAt === undefined ? {} : { endedAt: digest.info.endedAt }),
      updatedAt: digest.info.updatedAt,
      ...(digest.info.model === undefined ? {} : { model: digest.info.model }),
      ...(digest.info.provider === undefined ? {} : { provider: digest.info.provider }),
      status: digest.info.status,
      turns: digest.info.turns,
      files: digest.info.files,
      commands: digest.info.commands,
      subagents: unionChildren(digest.catalogChildren, state.requestChildren.get(digest.info.id) ?? []).length,
      errors: digest.info.errors,
    }
    // 工作线归属：父会话已处理（排序保证祖先在前）时继承父的 rootId。
    const parentId = digest.info.parentId
    if (parentId !== undefined) {
      const parent = state.sessions.get(parentId)
      if (parent !== undefined) summary.rootId = parent.rootId
    }
    state.sessions.set(summary.id, summary)
    patch.sessions.push(summary)

    this.applyFiles(state, digest, patch)
    this.applyEdges(state, digest, patch)
  }

  private applyFiles(state: ScanState, digest: SessionDigest, patch: SnapshotPatch): void {
    const byPath = new Map<string, FileTouch[]>()
    for (const touch of digest.touches) {
      const list = byPath.get(touch.key)
      if (list === undefined) byPath.set(touch.key, [touch])
      else list.push(touch)
    }
    const sessionId = digest.info.id
    for (const [key, touches] of byPath) {
      const turns = new Set<number>()
      for (const touch of touches) if (touch.turn !== null) turns.add(touch.turn)
      const existing = state.files.get(key)
      if (existing === undefined) {
        const node = fileNodeFromTouches(touches[0].path, touches, [sessionId], 1, turns.size)
        state.files.set(key, node)
        patch.files.push(node)
        continue
      }
      let reads = 0
      let writes = 0
      let searches = 0
      let added = 0
      let removed = 0
      let firstAt = existing.firstAt
      let lastAt = existing.lastAt
      for (const touch of touches) {
        reads += touch.reads
        writes += touch.writes
        searches += touch.searches
        added += touch.added
        removed += touch.removed
        if (touch.firstAt < firstAt) firstAt = touch.firstAt
        if (touch.lastAt > lastAt) lastAt = touch.lastAt
      }
      existing.reads += reads
      existing.writes += writes
      existing.searches += searches
      existing.added += added
      existing.removed += removed
      existing.ops = existing.reads + existing.writes + existing.searches
      existing.firstAt = firstAt
      existing.lastAt = lastAt
      if (!existing.sessionIds.includes(sessionId)) {
        existing.sessionCount += 1
        if (existing.sessionIds.length < LIMITS.maxFileSessionIds) existing.sessionIds.push(sessionId)
      }
      existing.turnCount += turns.size
      patch.files.push({ ...existing, sessionIds: existing.sessionIds.slice() })
    }
    this.pruneFiles(state, patch)
  }

  private applyEdges(state: ScanState, digest: SessionDigest, patch: SnapshotPatch): void {
    for (const contribution of digest.edges) {
      const key = edgeKey(contribution.from, contribution.to)
      const existing = state.edges.get(key)
      if (existing === undefined) {
        const edge: SnapshotCoTurnEdge = {
          type: 'coTurn',
          from: contribution.from,
          to: contribution.to,
          weight: contribution.weight,
          evidence: contribution.evidence.slice(-LIMITS.edgeEvidence),
        }
        state.edges.set(key, edge)
        patch.edges.push(edge)
        continue
      }
      existing.weight += contribution.weight
      for (const sample of contribution.evidence) existing.evidence.push(sample)
      if (existing.evidence.length > LIMITS.edgeEvidence) existing.evidence = existing.evidence.slice(-LIMITS.edgeEvidence)
      patch.edges.push(existing)
    }
    this.pruneEdges(state, patch)
  }

  /** 文件节点超上限：按 ops 取 top，删掉的通知客户端（`removedFiles`）。 */
  private pruneFiles(state: ScanState, patch: SnapshotPatch): void {
    if (state.files.size <= LIMITS.maxFileNodes) return
    state.filesTruncated = true
    const ranked = Array.from(state.files.values()).sort((a, b) => {
      if (b.ops !== a.ops) return b.ops - a.ops
      return a.path < b.path ? -1 : a.path > b.path ? 1 : 0
    })
    const keep = new Set<string>()
    for (const node of ranked.slice(0, LIMITS.maxFileNodes)) keep.add(node.path.toLowerCase())
    for (const [key, node] of state.files) {
      if (keep.has(key)) continue
      state.files.delete(key)
      if (!patch.removedFiles.includes(node.path)) patch.removedFiles.push(node.path)
    }
  }

  /** 共现边超上限：按权重取 top（同权重按 from/to 字典序，确定性）。 */
  private pruneEdges(state: ScanState, patch: SnapshotPatch): void {
    if (state.edges.size <= LIMITS.maxEdges) return
    state.edgesTruncated = true
    const ranked = Array.from(state.edges.entries()).sort((left, right) => {
      if (right[1].weight !== left[1].weight) return right[1].weight - left[1].weight
      const a = edgeKey(left[1].from, left[1].to)
      const b = edgeKey(right[1].from, right[1].to)
      return a < b ? -1 : a > b ? 1 : 0
    })
    const keep = new Set<string>()
    for (const [key] of ranked.slice(0, LIMITS.maxEdges)) keep.add(key)
    for (const [key, edge] of state.edges) {
      if (keep.has(key)) continue
      state.edges.delete(key)
      patch.removedEdges.push(`${edge.from}\u0000${edge.to}`)
    }
  }

  private pushChanges(state: ScanState, rev: number, patch: SnapshotPatch): void {
    state.changes.push({ rev, patch })
    while (state.changes.length > LIMITS.snapshotLog) {
      const dropped = state.changes.shift()
      if (dropped !== undefined) state.minRev = dropped.rev + 1
    }
  }

  private trimDigests(workspace: WorkspaceState): void {
    if (workspace.digests.size <= LIMITS.maxDigests) return
    const ranked = Array.from(workspace.digests.entries()).sort((a, b) => b[1].updatedAt - a[1].updatedAt)
    const keep = new Set(ranked.slice(0, LIMITS.maxDigests).map(([id]) => id))
    for (const id of workspace.digests.keys()) {
      if (!keep.has(id)) workspace.digests.delete(id)
    }
  }

  /** 只保留最近的若干次扫描；仍被轮询的扫描不逐出。 */
  private trimScanRegistry(): void {
    while (this.scans.size > 8) {
      const first = this.scans.entries().next()
      if (first.done === true) break
      const [id, scan] = first.value
      if (!scan.done) break
      this.clearTimer(scan)
      this.scans.delete(id)
    }
  }

  private cancelScan(scanId: string): void {
    const scan = this.scans.get(scanId)
    if (scan === undefined) return
    scan.cancelled = true
    scan.done = true
    try {
      scan.abort.abort()
    } catch {
      // 重复 abort 在部分实现会抛，安全忽略。
    }
    this.clearTimer(scan)
    this.scans.delete(scanId)
    if (this.lastScan === scan) this.lastScan = undefined
  }

  private clearTimer(scan: ScanState | undefined): void {
    if (scan?.timer !== undefined) {
      clearTimeout(scan.timer)
      scan.timer = undefined
    }
  }

  /** 60s 无轮询自动取消并释放（04 §2.4）。已完成的扫描保留摘要（detail 仍可用）。 */
  private armIdleTimer(state: ScanState): void {
    this.clearTimer(state)
    const timeout = this.options.idleTimeoutMs ?? LIMITS.idleTimeoutMs
    state.timer = setTimeout(() => {
      if (state.cancelled) return
      const workspace = this.workspaces.get(state.workspaceId)
      if (workspace?.activeScanId === state.scanId) workspace.activeScanId = undefined
      this.clearTimer(state)
      if (!state.done) {
        state.cancelled = true
        try {
          state.abort.abort()
        } catch {
          // 同上
        }
        this.scans.delete(state.scanId)
        if (this.lastScan === state) this.lastScan = undefined
        return
      }
      // 已完成：释放图数据，保留会话摘要供 detail 使用（只写内存，随时可重建）。
      state.changes = []
      state.files.clear()
      state.edges.clear()
      state.minRev = state.rev + 1
    }, timeout)
    const timer = state.timer as unknown as { unref?(): void }
    timer.unref?.()
  }

  private touchIdle(state: ScanState): void {
    state.lastPollAt = this.now()
    this.armIdleTimer(state)
  }

  /* ---------------- snapshot ---------------- */

  /** `POST /snapshot`：增量或 reset 全量，严格 ≤ 8MB（裁剪时标 `truncated`）。 */
  snapshotRequest(request: SnapshotRequest): ThreadlineResponse<SnapshotResponse> {
    const state = this.scans.get(request.scanId)
    if (state === undefined) {
      return { ok: false, error: { code: 'threadline/scan-not-found', message: 'scan not found' } }
    }
    this.touchIdle(state)
    const since = request.sinceRev
    const continuation = state.resetCursor !== undefined && state.resetCursor.rev === state.rev && since >= state.rev
    let reset: boolean
    let patch: SnapshotPatch
    if (continuation) {
      reset = false
      patch = this.fullPatch(state)
    } else if (since <= 0 || since > state.rev || since < state.minRev) {
      reset = true
      patch = this.fullPatch(state)
    } else {
      reset = false
      patch = this.incrementalPatch(state, since)
    }

    const fileOffset = continuation && state.resetCursor !== undefined ? state.resetCursor.files : 0
    const edgeOffset = continuation && state.resetCursor !== undefined ? state.resetCursor.edges : 0
    const payload = {
      scanId: state.scanId,
      rev: state.rev,
      reset,
      done: state.done,
      progress: { ...state.progress },
      changedSessions: patch.sessions,
      changedFiles: this.sortByOpsDesc(patch.files).slice(fileOffset),
      changedEdges: this.sortByWeightDesc(patch.edges).slice(edgeOffset),
      removedFiles: reset ? [] : patch.removedFiles,
      removedEdges: reset ? [] : patch.removedEdges,
      errors: patch.errors,
    }
    const fitted = this.fitToBudget(payload, fileOffset, edgeOffset, continuation)
    return { ok: true, scanId: fitted.scanId, rev: fitted.rev, reset: fitted.reset, done: fitted.done, progress: fitted.progress, changedSessions: fitted.changedSessions, changedFiles: fitted.changedFiles, changedEdges: fitted.changedEdges, removedFiles: fitted.removedFiles, removedEdges: fitted.removedEdges, errors: fitted.errors, ...(fitted.truncated === true ? { truncated: true } : {}) }
  }

  private fullPatch(state: ScanState): SnapshotPatch {
    return {
      sessions: Array.from(state.sessions.values()),
      files: Array.from(state.files.values()),
      edges: Array.from(state.edges.values()),
      removedFiles: [],
      removedEdges: [],
      errors: state.errors.slice(),
    }
  }

  private incrementalPatch(state: ScanState, sinceRev: number): SnapshotPatch {
    const patch = this.emptyPatch()
    const sessions = new Map<string, SessionSummary>()
    const files = new Map<string, FileNode>()
    const edges = new Map<string, SnapshotCoTurnEdge>()
    for (const entry of state.changes) {
      if (entry.rev <= sinceRev) continue
      for (const session of entry.patch.sessions) sessions.set(session.id, session)
      for (const file of entry.patch.files) files.set(file.path.toLowerCase(), file)
      for (const edge of entry.patch.edges) edges.set(edgeKey(edge.from, edge.to), edge)
      for (const path of entry.patch.removedFiles) if (!patch.removedFiles.includes(path)) patch.removedFiles.push(path)
      for (const key of entry.patch.removedEdges) if (!patch.removedEdges.includes(key)) patch.removedEdges.push(key)
      for (const error of entry.patch.errors) patch.errors.push(error)
    }
    patch.sessions.push(...sessions.values())
    patch.files.push(...files.values())
    patch.edges.push(...edges.values())
    return patch
  }

  private sortByOpsDesc(files: readonly FileNode[]): FileNode[] {
    return files.slice().sort((a, b) => {
      if (b.ops !== a.ops) return b.ops - a.ops
      return a.path < b.path ? -1 : a.path > b.path ? 1 : 0
    })
  }

  private sortByWeightDesc(edges: readonly SnapshotCoTurnEdge[]): SnapshotCoTurnEdge[] {
    return edges.slice().sort((a, b) => {
      if (b.weight !== a.weight) return b.weight - a.weight
      const left = edgeKey(a.from, a.to)
      const right = edgeKey(b.from, b.to)
      return left < right ? -1 : left > right ? 1 : 0
    })
  }

  /**
   * 8MB 上限：按「会话 → 文件 → 边」保底，边最先裁；裁剪后标 `truncated` 并记续页游标，
   * 保证客户端在同一 rev 内还能拿到其余数据（不静默丢）。
   */
  private fitToBudget(
    payload: {
      scanId: string
      rev: number
      reset: boolean
      done: boolean
      progress: ScanProgress
      changedSessions: SessionSummary[]
      changedFiles: FileNode[]
      changedEdges: SnapshotCoTurnEdge[]
      removedFiles: string[]
      removedEdges: string[]
      errors: ScanError[]
    },
    fileOffset: number,
    edgeOffset: number,
    continuation: boolean,
  ): SnapshotResponse & { truncated?: boolean } {
    const cap = this.responseBytes()
    let files = payload.changedFiles
    let edges = payload.changedEdges
    let truncated = false
    for (let guard = 0; guard <= 24; guard += 1) {
      const candidate = { ...payload, changedFiles: files, changedEdges: edges }
      const bytes = utf8Length(JSON.stringify({ ok: true, ...candidate, ...(truncated ? { truncated: true } : {}) }))
      if (bytes <= cap) {
        this.rememberResetCursor(payload, fileOffset, edgeOffset, files.length, edges.length, truncated, continuation)
        return truncated ? { ...candidate, truncated: true } : candidate
      }
      truncated = true
      const ratio = cap / Math.max(bytes, 1)
      if (edges.length > 0) {
        const keep = Math.max(0, Math.min(edges.length - 1, Math.floor(edges.length * ratio * 0.9)))
        edges = edges.slice(0, keep)
        continue
      }
      if (files.length > 0) {
        const keep = Math.max(0, Math.min(files.length - 1, Math.floor(files.length * ratio * 0.9)))
        files = files.slice(0, keep)
        continue
      }
      if (payload.changedSessions.length > 1) {
        const keep = Math.max(1, Math.floor(payload.changedSessions.length * ratio * 0.9))
        return {
          ...payload,
          changedSessions: payload.changedSessions.slice(0, keep),
          changedFiles: [],
          changedEdges: [],
          removedFiles: [],
          removedEdges: [],
          truncated: true,
        }
      }
      return { ...payload, changedFiles: [], changedEdges: [], truncated: true }
    }
    return {
      scanId: payload.scanId,
      rev: payload.rev,
      reset: payload.reset,
      done: payload.done,
      progress: payload.progress,
      changedSessions: payload.changedSessions,
      changedFiles: [],
      changedEdges: [],
      removedFiles: [],
      removedEdges: [],
      errors: payload.errors,
      truncated: true,
    }
  }

  /** reset 全量被裁后，同一 rev 内继续送下一页（reset=false，按 id/path 合并，不清空）。 */
  private rememberResetCursor(
    payload: { scanId: string; reset: boolean },
    fileOffset: number,
    edgeOffset: number,
    keptFiles: number,
    keptEdges: number,
    truncated: boolean,
    continuation: boolean,
  ): void {
    const state = this.scans.get(payload.scanId)
    if (state === undefined) return
    if (!payload.reset && !continuation) {
      // 普通增量包：rev 已前进，旧续页游标失效（不能拿增量偏移去切全量）。
      delete state.resetCursor
      return
    }
    if (!truncated) {
      delete state.resetCursor
      return
    }
    state.resetCursor = { rev: state.rev, files: fileOffset + keptFiles, edges: edgeOffset + keptEdges }
  }

  /* ---------------- detail ---------------- */

  /**
   * `POST /detail`：按需冷读单会话并归约；内存 LRU 20。
   *
   * 两条路径（T13e）：
   * 1. **有扫描上下文**：会话在当前扫描集合里 → 维持既有行为（缓存、children、running/archived）。
   * 2. **冷读**：没有 lastScan（或会话不在集合内）但请求带了合法 `cwd` → 用 header 自证归属后直接读；
   *    不依赖 `/scan` 的生命周期，所以「没开过 tab 就点每轮影响」也能工作。
   * 两者都没有 → `threadline/bad-request`（老客户端行为不变，消息写清原因）。
   */
  async detailRequest(request: DetailRequest): Promise<ThreadlineResponse<DetailResponse>> {
    const persistence = this.services.getPersistence()
    if (persistence === undefined) {
      return { ok: false, error: { code: 'threadline/capability-missing', message: 'session persistence unavailable' } }
    }
    const scan = this.lastScan
    const summary = scan?.sessions.get(request.sessionId)
    const input = scan?.inputs.get(request.sessionId)

    if (scan !== undefined && (summary !== undefined || input !== undefined)) {
      // 扫描还没处理到该会话时，用请求行作最小上下文（不伪造计数，只放行读取）。
      const context: SessionSummary = summary ?? {
        id: request.sessionId,
        rootId: input?.parentId ?? request.sessionId,
        ...(input?.title === undefined ? {} : { title: input.title }),
        cwd: scan.cwd,
        archived: input?.archived === true,
        running: input?.running === true,
        startedAt: 0,
        updatedAt: input?.updatedAt ?? 0,
        status: 'unknown',
        turns: 0,
        files: 0,
        commands: 0,
        subagents: 0,
        errors: 0,
      }
      const cached = this.detailCache.get(request.sessionId)
      if (cached !== undefined && cached.updatedAt === context.updatedAt && request.refresh !== true) {
        this.detailCache.delete(request.sessionId)
        this.detailCache.set(request.sessionId, cached)
        return { ok: true, session: cached.detail }
      }
      return this.readDetail(
        persistence,
        request.sessionId,
        context,
        this.childrenOf(scan, request.sessionId),
        true,
      )
    }

    if (request.cwd === undefined) {
      return {
        ok: false,
        error: {
          code: 'threadline/bad-request',
          message:
            scan === undefined
              ? 'no scan in this workspace and no cwd provided'
              : 'session is not in the current scan and no cwd provided',
        },
      }
    }
    return this.coldDetail(persistence, request.sessionId, request.cwd)
  }

  /**
   * 冷读 detail：归属只信 header，不信 sessionId 本身。
   *
   * 规则（与 scan 的归属校验同口径）：
   * - `header.cwd` 归一化后 === 请求 cwd → 放行；
   * - 否则若它是子会话（header.parentSession 非空），父会话 header 的 cwd === 请求 cwd 才放行，
   *   并在 detail 上如实标 `partial`（子会话 cwd 与请求 cwd 不同，上下文不完整，不编造）；
   * - 其它情况一律 `threadline/bad-request`（不放行）。
   *
   * 只读 header，不读正文；不新增路径参数、不用 Node fs。
   */
  private async coldDetail(
    persistence: PersistenceLike,
    sessionId: string,
    cwd: string,
  ): Promise<ThreadlineResponse<DetailResponse>> {
    const target = normalizeCwd(cwd)
    if (target === '') {
      return { ok: false, error: { code: 'threadline/bad-request', message: 'invalid cwd' } }
    }
    const header = await this.readHeader(persistence, sessionId)
    if (header === undefined) {
      return { ok: false, error: { code: 'threadline/session-unreadable', message: 'session header unavailable' } }
    }
    let viaParent = false
    if (!sameWorkspaceCwd(header.cwd, target)) {
      const parentId = header.parentSession
      if (parentId === undefined || parentId === '') {
        return { ok: false, error: { code: 'threadline/bad-request', message: 'session does not belong to this cwd' } }
      }
      const parentHeader = await this.readHeader(persistence, parentId)
      if (parentHeader === undefined) {
        return {
          ok: false,
          error: { code: 'threadline/bad-request', message: 'cannot verify session ownership for this cwd' },
        }
      }
      if (!sameWorkspaceCwd(parentHeader.cwd, target)) {
        return { ok: false, error: { code: 'threadline/bad-request', message: 'session does not belong to this cwd' } }
      }
      viaParent = true
    }
    // 最小上下文：无扫描集合，所以计数/状态一律「未知」，不伪造（rootId 取自身，不虚构父链）。
    const context: SessionSummary = {
      id: sessionId,
      rootId: sessionId,
      cwd: target,
      archived: false,
      running: false,
      startedAt: Number.isFinite(header.createdAt) && header.createdAt >= 0 ? header.createdAt : 0,
      updatedAt: 0,
      status: 'unknown',
      turns: 0,
      files: 0,
      commands: 0,
      subagents: 0,
      errors: 0,
    }
    const response = await this.readDetail(persistence, sessionId, context, [], false)
    if (response.ok === true && viaParent) {
      // 子会话：cwd 与请求 cwd 不同，扫描上下文不可得 → 如实标 partial。
      response.session.partial = true
    }
    return response
  }

  /** 打开日志 → 归约 → 组装 DetailResponse（扫描路径与冷读路径共用，避免两套解析）。 */
  private async readDetail(
    persistence: PersistenceLike,
    sessionId: string,
    context: SessionSummary,
    children: SubagentRecord[],
    cache: boolean,
  ): Promise<ThreadlineResponse<DetailResponse>> {
    let handle: SessionHandleLike | undefined
    try {
      handle = await persistence.open(sessionId, 'read')
      const read = await handle.read(0)
      const events = Array.isArray(read?.events) ? read.events : []
      const header = handle.header ?? { id: sessionId, createdAt: context.startedAt }
      const reduction = reduceSession(header, events, {
        cwd: this.cwdFor(header, context.cwd),
        running: context.running,
        rootId: context.rootId,
        children,
        limits: this.reduceLimits(),
      })
      const detail = reduction.detail
      if (context.archived) detail.archived = true
      if (context.running) detail.running = true
      if (cache) this.cacheDetail(sessionId, context.updatedAt, detail)
      return { ok: true, session: detail }
    } catch (error) {
      const mapped = mapReadError(error)
      return {
        ok: false,
        error: { code: mapped.code, message: mapped.message, ...(mapped.detail === undefined ? {} : { detail: mapped.detail }) },
      }
    } finally {
      try {
        await handle?.close?.()
      } catch {
        // 同上：关闭失败不覆盖已得数据。
      }
    }
  }

  private childrenOf(scan: ScanState, id: string): SubagentRecord[] {
    const children: SubagentRecord[] = []
    for (const candidate of scan.sessions.values()) {
      if (candidate.parentId !== id) continue
      children.push({
        id: candidate.id,
        ...(candidate.title === undefined ? {} : { title: candidate.title }),
        status: candidate.status,
      })
    }
    children.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    return children
  }

  private cacheDetail(id: string, updatedAt: number, detail: SessionDetail): void {
    if (this.detailCache.has(id)) this.detailCache.delete(id)
    this.detailCache.set(id, { updatedAt, detail })
    while (this.detailCache.size > LIMITS.maxDetailCache) {
      const oldest = this.detailCache.keys().next()
      if (oldest.done === true) break
      this.detailCache.delete(oldest.value)
    }
  }

  /* ---------------- lifecycle ---------------- */

  /** 卸载：清定时器、abort 扫描、清内存索引（不写任何存储）。 */
  dispose(): void {
    this.disposed = true
    for (const scan of this.scans.values()) {
      this.clearTimer(scan)
      scan.cancelled = true
      try {
        scan.abort.abort()
      } catch {
        // 同上
      }
    }
    this.scans.clear()
    this.workspaces.clear()
    this.detailCache.clear()
    this.lastScan = undefined
  }
}
