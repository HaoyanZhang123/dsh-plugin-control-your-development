/**
 * T04 测试夹具：假时钟 / 假 fetch / 协议对象构造器。
 *
 * 不读真实日志、不 import fs、不访问网络；所有时间与响应都显式控制，保证确定性。
 */
import type { FetchInitLike, FetchLike } from '../../src/client/data/http.ts'
import { DATA_ROUTES } from '../../src/client/data/http.ts'
import type { DataRouteName } from '../../src/client/data/http.ts'
import type {
  FileNode,
  ScanError,
  ScanProgress,
  SessionDetail,
  SessionSummary,
  SnapshotCoTurnEdge,
} from '../../src/shared/events/index.ts'
import type { SessionRow, WorkspaceItem } from '../../src/client/data/scope.ts'

/* ------------------------------------------------------------------ *
 * 1. 假时钟（确定性轮询/退避）
 * ------------------------------------------------------------------ */

export interface FakeClock {
  now(): number
  setTimeout(callback: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
  /** 推进时间，按到期顺序执行回调（每次回调后让出微任务）。 */
  advance(ms: number): Promise<void>
  /** 只让出微任务（不推进时间）。 */
  flush(): Promise<void>
  /** 未完成定时器数量。 */
  pending(): number
  readonly timer: { setTimeout: (cb: () => void, ms: number) => unknown; clearTimeout: (h: unknown) => void }
}

const realSetTimeout = globalThis.setTimeout

function yieldMicrotasks(): Promise<void> {
  return new Promise<void>((resolve) => {
    realSetTimeout(resolve, 0)
  })
}

export function createFakeClock(start = 1_700_000_000_000): FakeClock {
  let current = start
  let sequence = 0
  const timers = new Map<number, { due: number; callback: () => void }>()

  const api = {
    setTimeout(callback: () => void, ms: number): unknown {
      sequence += 1
      timers.set(sequence, { due: current + Math.max(0, ms), callback })
      return sequence
    },
    clearTimeout(handle: unknown): void {
      if (typeof handle === 'number') timers.delete(handle)
    },
  }

  return {
    now: () => current,
    setTimeout: api.setTimeout,
    clearTimeout: api.clearTimeout,
    async advance(ms: number): Promise<void> {
      const target = current + ms
      for (;;) {
        let nextId: number | undefined
        let nextDue = Number.POSITIVE_INFINITY
        for (const [id, entry] of timers) {
          if (entry.due <= target && entry.due < nextDue) {
            nextId = id
            nextDue = entry.due
          }
        }
        if (nextId === undefined) break
        const entry = timers.get(nextId)
        timers.delete(nextId)
        if (entry === undefined) break
        current = nextDue
        entry.callback()
        await yieldMicrotasks()
      }
      current = target
      await yieldMicrotasks()
    },
    async flush(): Promise<void> {
      await yieldMicrotasks()
    },
    pending: () => timers.size,
    timer: api,
  }
}

/* ------------------------------------------------------------------ *
 * 2. 假 fetch（按路由返回脚本化响应；跟踪并发）
 * ------------------------------------------------------------------ */

export interface FakeCall {
  path: string
  body: Record<string, unknown>
  init?: FetchInitLike
  route: DataRouteName
}

export type FakeResponder = (body: Record<string, unknown>, call: FakeCall) => unknown

export interface FakeFetch {
  fetch: FetchLike
  calls: FakeCall[]
  on(route: DataRouteName, responder: FakeResponder): void
  /** 当前在途请求数（全部路由）。 */
  active: number
  /** 历史最大并发（全部路由）。 */
  maxActive: number
  /** 某条路由的历史最大并发（详情并发 ≤2 断言用；scan/snapshot 不计）。 */
  maxActiveOf(route: DataRouteName): number
  callsOf(route: DataRouteName): FakeCall[]
  reset(): void
}

const ROUTE_BY_PATH = new Map<string, DataRouteName>([
  [DATA_ROUTES.scan, 'scan'],
  [DATA_ROUTES.snapshot, 'snapshot'],
  [DATA_ROUTES.detail, 'detail'],
])

export function createFakeFetch(): FakeFetch {
  const responders = new Map<DataRouteName, FakeResponder>()
  const calls: FakeCall[] = []
  let active = 0
  let maxActive = 0
  const activeByRoute: Record<DataRouteName, number> = { scan: 0, snapshot: 0, detail: 0 }
  const maxActiveByRoute: Record<DataRouteName, number> = { scan: 0, snapshot: 0, detail: 0 }

  const fetchImpl: FetchLike = async (input, init) => {
    const route = ROUTE_BY_PATH.get(input)
    if (route === undefined) throw new Error(`unexpected path: ${input}`)
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {}
    const call: FakeCall = { path: input, body, route }
    if (init !== undefined) call.init = init
    calls.push(call)
    active += 1
    activeByRoute[route] += 1
    if (active > maxActive) maxActive = active
    if (activeByRoute[route] > maxActiveByRoute[route]) maxActiveByRoute[route] = activeByRoute[route]
    try {
      const responder = responders.get(route)
      if (responder === undefined) throw new Error(`no responder for ${route}`)
      const payload = await responder(body, call)
      return { ok: true, status: 200, json: async () => payload }
    } finally {
      active -= 1
      activeByRoute[route] -= 1
    }
  }

  return {
    fetch: fetchImpl,
    calls,
    on(route, responder): void {
      responders.set(route, responder)
    },
    get active(): number {
      return active
    },
    get maxActive(): number {
      return maxActive
    },
    maxActiveOf(route): number {
      return maxActiveByRoute[route]
    },
    callsOf(route): FakeCall[] {
      return calls.filter((call) => call.route === route)
    },
    reset(): void {
      calls.length = 0
      maxActive = active
    },
  }
}

/** 可手动放行的门闩（控制响应到达时机）。 */
export function createGate(): {
  wait(): Promise<void>
  open(): void
  openAll(): void
  readonly waiting: number
} {
  let resolvers: Array<() => void> = []
  let latched = false
  return {
    wait(): Promise<void> {
      if (latched) return Promise.resolve()
      return new Promise<void>((resolve) => {
        resolvers.push(resolve)
      })
    },
    /** 放行当前等待者；之后新的 wait 仍会阻塞。 */
    open(): void {
      const pending = resolvers
      resolvers = []
      for (const resolve of pending) resolve()
    },
    /** 放行全部并永久打开（之后 wait 立即通过）。 */
    openAll(): void {
      latched = true
      const pending = resolvers
      resolvers = []
      for (const resolve of pending) resolve()
    },
    get waiting(): number {
      return resolvers.length
    },
  }
}

/* ------------------------------------------------------------------ *
 * 3. 数据构造器
 * ------------------------------------------------------------------ */

export const CWD = 'E:/DSH/workspaces/demo'
export const OTHER_CWD = 'E:/DSH/workspaces/other'
export const NOW = 1_700_000_000_000
export const DAY = 24 * 60 * 60 * 1000

export function sessionRow(id: string, overrides: Partial<SessionRow> = {}): SessionRow {
  return {
    id,
    title: `title-${id}`,
    cwd: CWD,
    updatedAt: NOW,
    running: false,
    ...overrides,
  }
}

export function workspace(id: string, sessionIds: string[], archivedSessionIds: string[] = []): WorkspaceItem {
  return { id, title: `ws-${id}`, sessionIds, archivedSessionIds }
}

export function summary(id: string, overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id,
    rootId: id,
    cwd: CWD,
    archived: false,
    running: false,
    startedAt: NOW - DAY,
    updatedAt: NOW,
    status: 'completed',
    turns: 1,
    files: 2,
    commands: 0,
    subagents: 0,
    errors: 0,
    ...overrides,
  }
}

export function fileNode(path: string, overrides: Partial<FileNode> = {}): FileNode {
  const slash = path.lastIndexOf('/')
  return {
    path,
    name: slash >= 0 ? path.slice(slash + 1) : path,
    dir: slash > 0 ? path.slice(0, slash) : '',
    family: 'code',
    firstAt: NOW - DAY,
    lastAt: NOW,
    reads: 1,
    writes: 0,
    searches: 0,
    added: 0,
    removed: 0,
    ops: 1,
    sessionIds: ['s-current'],
    sessionCount: 1,
    turnCount: 1,
    ...overrides,
  }
}

export function edge(from: string, to: string, weight: number, evidence: Array<{ sessionId: string; turn: number }> = []): SnapshotCoTurnEdge {
  return { type: 'coTurn', from, to, weight, evidence }
}

export function progress(overrides: Partial<ScanProgress> = {}): ScanProgress {
  return {
    total: 0,
    scanned: 0,
    failed: 0,
    cached: 0,
    phase: 'scanning',
    ...overrides,
  }
}

export function scanError(sessionId: string, code: ScanError['code'] = 'threadline/session-unreadable', message = 'cannot read'): ScanError {
  return { sessionId, code, message }
}

/** 构造一个 snapshot 响应（默认字段齐全，便于断点续拉测试）。 */
export function snapshotPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ok: true,
    scanId: 'scan-1',
    rev: 0,
    reset: false,
    done: false,
    progress: progress(),
    changedSessions: [],
    changedFiles: [],
    changedEdges: [],
    removedFiles: [],
    removedEdges: [],
    errors: [],
    ...overrides,
  }
}

/** 构造一个 detail 响应。 */
export function detailPayload(session: Partial<SessionDetail> & { id: string }): Record<string, unknown> {
  const full: SessionDetail = {
    ...session,
    id: session.id,
    rootId: session.rootId ?? session.id,
    cwd: session.cwd ?? CWD,
    startedAt: session.startedAt ?? NOW - DAY,
    updatedAt: session.updatedAt ?? NOW,
    status: session.status ?? 'completed',
    turns: session.turns ?? [],
    subagents: session.subagents ?? [],
    messageTurns: session.messageTurns ?? {},
    errors: session.errors ?? [],
    counts: session.counts ?? {
      turns: 0,
      steps: 0,
      toolCalls: 0,
      toolFailures: 0,
      files: 0,
      commands: 0,
      subagents: 0,
      errors: 0,
    },
    jobs: session.jobs ?? [],
  }
  return { ok: true, session: full }
}

/** 标准 scope 夹具：当前 + 子智能体（cwd 不同）+ 7 天内 + 历史 + 归档；另有其它 workspace。 */
export function scopeFixture(options: { now?: number } = {}): {
  workspaces: { items: WorkspaceItem[] }
  sessions: { ids: string[]; byId: Record<string, SessionRow> }
  currentId: string
} {
  const now = options.now ?? NOW
  const currentId = 's-current'
  const workspaces = {
    items: [
      workspace('ws-main', ['s-current', 's-sibling', 's-history', 's-recent'], ['s-archived']),
      workspace('ws-other', ['s-other-root', 's-other-child']),
    ],
  }
  const rows: SessionRow[] = [
    sessionRow(currentId, { updatedAt: now - 1000, running: true, cwd: CWD }),
    sessionRow('s-child', { parentId: currentId, cwd: OTHER_CWD, updatedAt: now - 2000 }),
    sessionRow('s-grandchild', { parentId: 's-child', cwd: CWD, updatedAt: now - 3000 }),
    sessionRow('s-sibling', { updatedAt: now - 4 * DAY }),
    sessionRow('s-recent', { updatedAt: now - 2 * DAY }),
    sessionRow('s-history', { updatedAt: now - 40 * DAY }),
    sessionRow('s-archived', { updatedAt: now - 60 * DAY, archived: true }),
    sessionRow('s-other-root', { cwd: OTHER_CWD, updatedAt: now - 100 }),
    sessionRow('s-other-child', { cwd: OTHER_CWD, parentId: 's-other-root', updatedAt: now - 200 }),
  ]
  const byId: Record<string, SessionRow> = {}
  for (const row of rows) byId[row.id] = row
  return { workspaces, sessions: { ids: rows.map((row) => row.id), byId }, currentId }
}
