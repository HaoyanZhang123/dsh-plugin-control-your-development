/**
 * T13e · 共享扫描预热（单实例 / 按工作区键）。
 *
 * 真机反馈：必须先点开「脉络」tab 才会加载数据，于是 `/threadline` 弹窗与每轮「影响」
 * 在没开 tab 时读不到 detail（host 当时没有扫描 → bad-request）。
 *
 * 这里把扫描从「tab 组件的生命周期」提升为**页面级预热**：
 * - 同一 `workspaceKey` 只有 1 个 controller（模块级 Map），重复 `ensure` 只更新会话/ cwd，不重开扫描；
 * - 预热保持存活（没有订阅者也不停）；
 * - 每次 snapshot 落地后，对「running + 最近活动」会话主动预取 detail（并发 ≤2 由 store 保证），
 *   让弹窗 / 图标打开即有数据；
 * - `workspaceKey` 变化 → 停掉旧预热、起新的（generation 语义仍由 controller 负责）。
 *
 * 只读约束不变：fetch 必须由调用方注入；只允许同源相对路径；不写任何存储、不碰 DOM 存储 API。
 */

import { buildWorkspaceScope } from './scope.ts'
import type { SessionRow, WorkspaceScope } from './scope.ts'
import { createDataController } from './controller.ts'
import type { ControllerSnapshot, DataController, TimerApi } from './controller.ts'
import { createEmptyGraph } from './merge.ts'
import { degradeNone } from './degrade.ts'
import type { DetailStore } from './detail.ts'
import type { FetchLike } from './http.ts'

/** 预热需要的最小会话行（`SessionSummary` / `ScopeSession` 都结构兼容）。 */
export interface WarmupSession {
  id: string
  updatedAt: number
  running: boolean
  cwd?: string
  parentId?: string
  title?: string
  origin?: string
  archived?: boolean
}

/** `ensureThreadlineWarmup` 的输入。 */
export interface WarmupInput {
  /** 工作区键（用 `threadlineWorkspaceKey(workspaceId, cwd)` 生成，保证三处入口一致）。 */
  workspaceKey: string
  /** 工作区 cwd（detail cold-read 归属校验用）。 */
  cwd: string
  /** 该工作区的会话行（通常来自 useSessions 快照）。 */
  sessions: readonly WarmupSession[]
  /** 注入的 fetch（只允许同源相对路径）。 */
  fetch: FetchLike
  /** 页面可见性（默认读 document；测试可注入）。 */
  visibility?: () => 'visible' | 'hidden'
  now?: () => number
  timer?: TimerApi
  pollIntervalMs?: number
  hiddenPollIntervalMs?: number
  /** 可选注入详情缓存（默认用 `registerWarmupDetailStore` 注册的共享 store）。 */
  detailStore?: DetailStore | null
}

/** 预热句柄（hooks / entries 只读）。 */
export interface WarmupHandle {
  readonly workspaceKey: string
  readonly cwd: string
  readonly controller: DataController
  getState(): ControllerSnapshot
  subscribe(listener: (snapshot: ControllerSnapshot) => void): () => void
  /** 最近一次预取的会话 id（诊断/测试）。 */
  readonly prefetched: readonly string[]
  /** 仅用于卸载/切换：停止并释放该预热。 */
  stop(): void
}

interface WarmupEntry {
  key: string
  cwd: string
  fetch: FetchLike
  sessions: Map<string, WarmupSession>
  controller: DataController
  detailStore: DetailStore | null
  unsubscribeController: () => void
  listeners: Set<(snapshot: ControllerSnapshot) => void>
  /** sessionId → 已预取的 updatedAt（去重，避免每轮 snapshot 都重拉）。 */
  requested: Map<string, number>
  prefetched: string[]
  started: boolean
  /** 额外清理（可见性监听器；模块卸载时移除）。 */
  disposeExtra: () => void
}

/** 模块级单例：一个工作区键 = 一个预热。 */
const warmups = new Map<string, WarmupEntry>()
let registeredDetailStore: DetailStore | null = null

/** 页面可见性（预热默认值；不写任何存储）。 */
function documentVisibility(): 'visible' | 'hidden' {
  if (typeof document === 'undefined') return 'visible'
  return document.visibilityState === 'hidden' ? 'hidden' : 'visible'
}

/** 规范化 cwd（与 scope 同口径：去空白、反斜杠转 `/`、去尾部分隔符）。 */
export function normalizeWarmupCwd(cwd: string | undefined): string {
  if (typeof cwd !== 'string') return ''
  const trimmed = cwd.trim().replace(/\\/g, '/')
  if (trimmed === '') return ''
  const collapsed = trimmed.replace(/\/{2,}/g, '/')
  return collapsed.length > 1 && collapsed.endsWith('/') ? collapsed.slice(0, -1) : collapsed
}

/** 工作区键：三处入口必须用同一个函数（大小写不敏感，避免同工作区两份预热）。 */
export function threadlineWorkspaceKey(workspaceId: string, cwd: string): string {
  const id = typeof workspaceId === 'string' && workspaceId.trim() !== '' ? workspaceId.trim() : 'workspace'
  const base = normalizeWarmupCwd(cwd).toLowerCase()
  return id + '\u0000' + base
}

/** 空态 controller 快照（hooks 在 scope 未知时用；不伪造数据）。 */
export function createIdleControllerSnapshot(): ControllerSnapshot {
  const graph = createEmptyGraph()
  return {
    status: 'idle',
    generation: 0,
    rev: 0,
    graph,
    coverage: graph.coverage,
    degrade: degradeNone(),
    retries: 0,
    reopens: 0,
    workspaceId: '',
    currentSessionId: '',
    retained: false,
    polling: false,
    updatedAt: 0,
  }
}

function asFiniteNonNegative(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

/**
 * 由预热输入合成一个真实 `WorkspaceScope`（排序/子智能体/归档规则与 tab 完全同一套纯函数）。
 * 没有会话时返回 cwd 可用的空 scope（detail 仍能 cold-read，扫描不启动）。
 */
export function scopeFromWarmup(input: Pick<WarmupInput, 'workspaceKey' | 'cwd' | 'sessions'>): WorkspaceScope {
  const cwd = normalizeWarmupCwd(input.cwd)
  const rows: SessionRow[] = []
  const byId: Record<string, SessionRow> = {}
  const ids: string[] = []
  const archivedIds: string[] = []
  for (const session of input.sessions) {
    if (typeof session?.id !== 'string' || session.id === '') continue
    if (byId[session.id] !== undefined) continue
    const row: SessionRow = {
      id: session.id,
      cwd: normalizeWarmupCwd(session.cwd) || cwd,
      updatedAt: asFiniteNonNegative(session.updatedAt),
      running: session.running === true,
      archived: session.archived === true,
    }
    if (typeof session.title === 'string' && session.title !== '') row.title = session.title
    if (typeof session.parentId === 'string' && session.parentId !== '') row.parentId = session.parentId
    if (typeof session.origin === 'string' && session.origin !== '') row.origin = session.origin
    byId[row.id] = row
    rows.push(row)
    ids.push(row.id)
    if (row.archived === true) archivedIds.push(row.id)
  }
  const currentId = rows.find((row) => row.running === true)?.id ?? rows[0]?.id ?? ''
  return buildWorkspaceScope({
    workspaces: { items: [{ id: input.workspaceKey, sessionIds: ids, archivedSessionIds: archivedIds }] },
    sessions: { byId },
    sessionId: currentId,
    now: Date.now(),
  })
}

/** 预取目标：running 优先 + 最近活动（按 updatedAt 倒序），去重。 */
export function warmupDetailTargets(
  snapshot: ControllerSnapshot,
  sessions: Iterable<WarmupSession>,
  options: { runningLimit?: number; recentLimit?: number } = {},
): Array<{ id: string; updatedAt: number }> {
  const runningLimit = options.runningLimit ?? 2
  const recentLimit = options.recentLimit ?? 2
  const merged = new Map<string, WarmupSession>()
  for (const session of sessions) {
    if (typeof session?.id === 'string' && session.id !== '') merged.set(session.id, session)
  }
  for (const summary of snapshot.graph.sessions.values()) {
    merged.set(summary.id, {
      id: summary.id,
      updatedAt: summary.updatedAt,
      running: summary.running,
      cwd: summary.cwd,
      ...(summary.parentId === undefined ? {} : { parentId: summary.parentId }),
      ...(summary.title === undefined ? {} : { title: summary.title }),
      ...(summary.origin === undefined ? {} : { origin: summary.origin }),
      archived: summary.archived,
    })
  }
  const rows = Array.from(merged.values()).sort((left, right) => right.updatedAt - left.updatedAt)
  const picked: Array<{ id: string; updatedAt: number }> = []
  const seen = new Set<string>()
  const push = (row: WarmupSession): void => {
    if (seen.has(row.id)) return
    seen.add(row.id)
    picked.push({ id: row.id, updatedAt: asFiniteNonNegative(row.updatedAt) })
  }
  rows.filter((row) => row.running === true).slice(0, runningLimit).forEach(push)
  rows.filter((row) => row.running !== true).slice(0, recentLimit).forEach(push)
  return picked
}

function prefetch(entry: WarmupEntry, snapshot: ControllerSnapshot): void {
  const store = entry.detailStore ?? registeredDetailStore
  if (store === null || entry.cwd === '') {
    entry.prefetched = []
    return
  }
  const targets = warmupDetailTargets(snapshot, entry.sessions.values())
  entry.prefetched = targets.map((target) => target.id)
  for (const target of targets) {
    const cached = store.peek(target.id)
    const requestedFor = entry.requested.get(target.id)
    if (requestedFor === target.updatedAt && cached !== undefined && (cached.status === 'ready' || cached.status === 'loading')) {
      continue
    }
    entry.requested.set(target.id, target.updatedAt)
    // refresh: true —— 预热目的就是"打开即有最新数据"；去重靠上面的 requested（每 updatedAt 一次）。
    void store.request(target.id, { cwd: entry.cwd, updatedAt: target.updatedAt, refresh: true }).catch(() => undefined)
  }
}

function attachDetailStore(entry: WarmupEntry, store: DetailStore | null): void {
  entry.detailStore = store
  if (store === null) return
  if (entry.cwd !== '') store.setDefaultCwd(entry.cwd)
  prefetch(entry, entry.controller.getState())
}

function startEntry(entry: WarmupEntry): void {
  if (entry.started) return
  const scope = scopeFromWarmup({
    workspaceKey: entry.key,
    cwd: entry.cwd,
    sessions: Array.from(entry.sessions.values()),
  })
  if (scope.cwd === '' || scope.sessions.length === 0) return
  entry.started = true
  const started = entry.controller.start(scope)
  void started.catch(() => undefined)
}

function createEntry(input: WarmupInput): WarmupEntry {
  const cwd = normalizeWarmupCwd(input.cwd)
  const controller = createDataController({
    fetch: input.fetch,
    visibility: input.visibility ?? documentVisibility,
    ...(input.now === undefined ? {} : { now: input.now }),
    ...(input.timer === undefined ? {} : { timer: input.timer }),
    ...(input.pollIntervalMs === undefined ? {} : { pollIntervalMs: input.pollIntervalMs }),
    ...(input.hiddenPollIntervalMs === undefined ? {} : { hiddenPollIntervalMs: input.hiddenPollIntervalMs }),
  })
  const sessions = new Map<string, WarmupSession>()
  for (const session of input.sessions) {
    if (typeof session?.id === 'string' && session.id !== '') sessions.set(session.id, session)
  }
  const entry: WarmupEntry = {
    key: input.workspaceKey,
    cwd,
    fetch: input.fetch,
    sessions,
    controller,
    detailStore: null,
    unsubscribeController: () => undefined,
    listeners: new Set(),
    requested: new Map(),
    prefetched: [],
    started: false,
    disposeExtra: () => undefined,
  }
  // 页面隐藏降频（04 §5.2）：预热自己听 document，保证不是只有 tab 挂载时才降频。
  if (input.visibility === undefined && typeof document !== 'undefined') {
    const onChange = (): void => controller.notifyVisibility(documentVisibility())
    document.addEventListener('visibilitychange', onChange)
    entry.disposeExtra = () => document.removeEventListener('visibilitychange', onChange)
  }
  entry.unsubscribeController = controller.subscribe((snapshot) => {
    for (const listener of entry.listeners) {
      try {
        listener(snapshot)
      } catch {
        // 订阅方异常不影响预热。
      }
    }
    prefetch(entry, snapshot)
  })
  attachDetailStore(entry, input.detailStore ?? registeredDetailStore)
  return entry
}

function disposeEntry(entry: WarmupEntry): void {
  entry.unsubscribeController()
  entry.disposeExtra()
  entry.controller.dispose()
  entry.listeners.clear()
  if (warmups.get(entry.key) === entry) warmups.delete(entry.key)
}

function disposeOtherKeys(keepKey: string): void {
  for (const entry of Array.from(warmups.values())) {
    if (entry.key === keepKey) continue
    disposeEntry(entry)
  }
}

function handleOf(entry: WarmupEntry): WarmupHandle {
  return {
    workspaceKey: entry.key,
    cwd: entry.cwd,
    controller: entry.controller,
    getState: () => entry.controller.getState(),
    subscribe(listener: (snapshot: ControllerSnapshot) => void): () => void {
      entry.listeners.add(listener)
      return () => {
        entry.listeners.delete(listener)
      }
    },
    get prefetched(): readonly string[] {
      return entry.prefetched
    },
    stop(): void {
      disposeEntry(entry)
    },
  }
}

/**
 * 确保某个工作区有且只有 1 个预热扫描（幂等）。
 *
 * - 同一 key 重复调用：只更新 sessions/cwd（不重开扫描）；
 * - 新 key：停掉旧预热、起新的；
 * - 预热不因无订阅者而停止（这是页面级预热，不是临时面板数据）。
 */
export function ensureThreadlineWarmup(input: WarmupInput): WarmupHandle {
  const key = typeof input.workspaceKey === 'string' && input.workspaceKey !== ''
    ? input.workspaceKey
    : threadlineWorkspaceKey('workspace', input.cwd)
  const existing = warmups.get(key)
  if (existing !== undefined) {
    if (existing.fetch !== input.fetch) {
      // fetch 身份变了（宿主页面注入变化）：重建，避免闭包拿着旧桥。
      disposeEntry(existing)
      return ensureThreadlineWarmup({ ...input, workspaceKey: key })
    }
    existing.cwd = normalizeWarmupCwd(input.cwd) || existing.cwd
    for (const session of input.sessions) {
      if (typeof session?.id === 'string' && session.id !== '') existing.sessions.set(session.id, session)
    }
    attachDetailStore(existing, input.detailStore ?? registeredDetailStore)
    startEntry(existing)
    prefetch(existing, existing.controller.getState())
    return handleOf(existing)
  }
  disposeOtherKeys(key)
  const entry = createEntry({ ...input, workspaceKey: key })
  warmups.set(key, entry)
  startEntry(entry)
  return handleOf(entry)
}

/** 当前预热状态（无预热 → undefined，调用方显示未知/加载，不伪造 0）。 */
export function getWarmupState(workspaceKey: string): ControllerSnapshot | undefined {
  const entry = warmups.get(workspaceKey)
  return entry?.controller.getState()
}

/** 订阅某个预热的 controller 快照（无预热时返回 no-op）。 */
export function subscribeWarmup(
  workspaceKey: string,
  listener: (snapshot: ControllerSnapshot) => void,
): () => void {
  const entry = warmups.get(workspaceKey)
  if (entry === undefined) return () => undefined
  return handleOf(entry).subscribe(listener)
}

/** 是否有预热在跑（测试/诊断）。 */
export function isWarmupActive(workspaceKey?: string): boolean {
  if (workspaceKey === undefined) return warmups.size > 0
  return warmups.get(workspaceKey)?.started === true
}

/** 当前预热的工作区键（诊断/测试）。 */
export function activeWarmupKeys(): string[] {
  return Array.from(warmups.keys())
}

/** 注册共享的详情缓存（state/detailStore 创建 store 后调用一次），预热预取才能复用它。 */
export function registerWarmupDetailStore(store: DetailStore | null): void {
  registeredDetailStore = store
  if (store === null) return
  for (const entry of warmups.values()) attachDetailStore(entry, store)
}

/** 插件卸载：停掉全部预热并断开订阅（不写任何持久化状态）。 */
export function disposeAllWarmups(): void {
  for (const entry of Array.from(warmups.values())) disposeEntry(entry)
  warmups.clear()
  registeredDetailStore = null
}

/** `ensureWarmupForDetail` 的输入。 */
export interface DetailWarmupOptions {
  /** 该会话所属工作区 cwd（Lead 从 useSessions 行取）。 */
  cwd?: string
  /** 完整预热上下文（可选；给了就顺带 ensure，只点图标/弹窗也能工作）。 */
  warmup?: Omit<WarmupInput, 'fetch' | 'detailStore'>
  /** 预热所需 fetch（仅当给了 warmup 时使用）。 */
  fetch?: FetchLike
}

/**
 * detail 入口的统一前置（`useThreadlineDetail` 内部调用；也可由 entries 直接调用）：
 * 1. 有 cwd → 先写入 store 默认归属（此后 detail 请求自动带上，不猜）；
 * 2. 有完整 warmup 上下文 → ensure（幂等，不会二次 /scan）；
 * 3. 否则若已有同 cwd 的预热 → 把共享 store 挂上去（预取共享同一份缓存）。
 */
export function ensureWarmupForDetail(store: DetailStore, options?: DetailWarmupOptions): WarmupHandle | undefined {
  const cwd = normalizeWarmupCwd(options?.cwd ?? options?.warmup?.cwd)
  if (cwd !== '') store.setDefaultCwd(cwd)
  if (options?.warmup !== undefined && options.fetch !== undefined) {
    return ensureThreadlineWarmup({
      ...options.warmup,
      ...(cwd === '' ? {} : { cwd }),
      fetch: options.fetch,
      detailStore: store,
    })
  }
  if (cwd !== '') {
    for (const entry of warmups.values()) {
      if (entry.cwd === cwd) {
        attachDetailStore(entry, store)
        break
      }
    }
  } else if (registeredDetailStore === null) {
    registerWarmupDetailStore(store)
  }
  return undefined
}

/** 仅供测试：清掉模块级单例（等价卸载）。 */
export function resetWarmupsForTest(): void {
  disposeAllWarmups()
}
