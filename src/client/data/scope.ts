/**
 * T04 · 工作区识别（04 §4.1 / §5.1、03 §2.4、06 A20-1 / N-18）。
 *
 * 输入是宿主给客户端的两份快照（02 §3.3）：
 * - `useWorkspaces`：`items: { title, sessionIds, archivedSessionIds }[]`；
 * - `useSessions`：`ids` / `byId`（行含 `id/title/displayTitle/cwd/updatedAt/running/parentId/origin`）。
 *
 * 输出 `WorkspaceScope`：**只取当前会话所在的那个 workspace**，不汇总其它工作区。
 * 纯函数，无 IO、无 React、无存储；`now` 由调用方注入，便于单测。
 *
 * 排序（03 §11.2 / 04 §5.1）：当前会话 → 其子智能体 → 最近 7 天 → 更早历史 → 归档。
 */

import type { ScanSessionInput } from '../../shared/events/index.ts'

/** `useWorkspaces` 的单个条目（缺 `id` 时由会话 id 派生稳定 key）。 */
export interface WorkspaceItem {
  id?: string
  title?: string
  sessionIds: readonly string[]
  archivedSessionIds?: readonly string[]
}

/** `useWorkspaces` 快照（兼容直接传 items 数组）。 */
export interface WorkspacesSnapshot {
  items: readonly WorkspaceItem[]
  /** 若宿主提供当前工作区 id，可作为识别失败时的补充线索；不强制。 */
  activeId?: string
}

/** `useSessions` 的单行（字段都可缺；缺了按 unknown 处理，不猜）。 */
export interface SessionRow {
  id: string
  title?: string
  displayTitle?: string
  cwd?: string
  updatedAt?: number
  running?: boolean
  parentId?: string
  /** 老字段名兼容（host 的 header 用 `parentSession`）。 */
  parentSession?: string
  origin?: string
  archived?: boolean
  archivedAt?: number
}

/** `useSessions` 快照（`byId` 允许 Map 或普通对象；`ids`/`sessions` 二选一即可）。 */
export interface SessionsSnapshot {
  ids?: readonly string[]
  byId?: Record<string, SessionRow | undefined> | ReadonlyMap<string, SessionRow | undefined>
  sessions?: readonly SessionRow[]
}

/** 排序分段（03 §11.2）。 */
export type ScopeBucket = 'current' | 'subagent' | 'recent' | 'history' | 'archived'

/** scope 内的一个会话（字段来自快照；缺失信息保持 unknown 语义）。 */
export interface ScopeSession {
  id: string
  title?: string
  cwd: string
  updatedAt: number
  running: boolean
  parentId?: string
  /** 归属根会话（scope 内最深可达祖先）。 */
  rootId: string
  origin?: string
  archived: boolean
  bucket: ScopeBucket
  /** 子智能体层级（0 = 根会话；当前会话本身为 0）。 */
  depth: number
  /** 稳定排序序号（0 起，等于它在 `sessions` 里的下标）。 */
  order: number
  /** 快照里找不到该会话行（字段未知 ≠ 不存在）。 */
  rowMissing: boolean
}

/** 分段计数（`archivedTotal` 含落在子智能体段里的归档会话）。 */
export interface ScopeCounts {
  total: number
  current: number
  subagent: number
  recent: number
  history: number
  archived: number
  archivedTotal: number
}

/** 工作区识别降级原因（04 §4.1：UI 要标注“工作区识别降级”）。 */
export type ScopeDegradeReason = 'workspace-not-found' | 'current-session-missing'

/** 当前工作区范围（下游 T07/T08/T09 只读这个结构）。 */
export interface WorkspaceScope {
  workspaceId: string
  workspaceTitle?: string
  /** 扫描基准 cwd（绝对路径；空串表示无法识别，调用方不得发起扫描）。 */
  cwd: string
  currentSessionId: string
  sessions: readonly ScopeSession[]
  /** 排序后的 sessionId 列表（= `sessions.map(s => s.id)`）。 */
  order: readonly string[]
  counts: ScopeCounts
  /** 是否发生了工作区识别降级（找不到 workspace，按 cwd 兜底）。 */
  degraded: boolean
  degradedReason?: ScopeDegradeReason
  /** 计算时间（now 注入）。 */
  computedAt: number
}

/** 构建输入。 */
export interface BuildScopeInput {
  workspaces: WorkspacesSnapshot | readonly WorkspaceItem[] | undefined
  sessions: SessionsSnapshot | undefined
  sessionId: string
  /** 当前时间；默认 `Date.now()`。 */
  now?: number
  /** “最近”窗口，默认 7 天。 */
  recentWindowMs?: number
}

const RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000
const SESSION_ID_RE = /^[A-Za-z0-9._:-]{1,200}$/
const MAX_WORKSPACE_ID = 200

function itemsOf(
  workspaces: WorkspacesSnapshot | readonly WorkspaceItem[] | undefined,
): readonly WorkspaceItem[] {
  if (workspaces === undefined) return []
  if (Array.isArray(workspaces)) return workspaces as readonly WorkspaceItem[]
  const snapshot = workspaces as WorkspacesSnapshot
  return Array.isArray(snapshot.items) ? snapshot.items : []
}

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function rowParent(row: SessionRow | undefined): string | undefined {
  if (row === undefined) return undefined
  if (typeof row.parentId === 'string' && row.parentId !== '') return row.parentId
  if (typeof row.parentSession === 'string' && row.parentSession !== '') return row.parentSession
  return undefined
}

function rowTitle(row: SessionRow | undefined): string | undefined {
  if (row === undefined) return undefined
  if (typeof row.title === 'string' && row.title !== '') return row.title
  if (typeof row.displayTitle === 'string' && row.displayTitle !== '') return row.displayTitle
  return undefined
}

function rowUpdatedAt(row: SessionRow | undefined): number {
  const value = asFiniteNumber(row?.updatedAt)
  return value !== undefined && value >= 0 ? value : 0
}

/** 会话索引：`byId` / `sessions` / `ids` 三种形态统一成一个 Map + 有序列表。 */
interface SessionIndex {
  byId: Map<string, SessionRow>
  list: SessionRow[]
}

function indexSessions(sessions: SessionsSnapshot | undefined): SessionIndex {
  const byId = new Map<string, SessionRow>()
  const list: SessionRow[] = []
  const listed = new Set<string>()
  if (sessions === undefined) return { byId, list }

  /** 登记一行；`row === undefined` 表示“知道 id 但没有行”（字段未知，不猜）。 */
  const add = (id: string, row: SessionRow | undefined): void => {
    if (typeof id !== 'string' || id === '') return
    if (row !== undefined && typeof row.id === 'string' && !byId.has(id)) byId.set(id, row)
    if (listed.has(id)) return
    listed.add(id)
    list.push(row ?? ({ id } as SessionRow))
  }

  const rawById = sessions.byId
  if (rawById instanceof Map) {
    for (const [id, row] of rawById) add(id, row)
  } else if (rawById !== undefined && typeof rawById === 'object') {
    for (const [id, row] of Object.entries(rawById)) add(id, row)
  }
  if (Array.isArray(sessions.sessions)) {
    for (const row of sessions.sessions) {
      if (row !== undefined && typeof row.id === 'string') add(row.id, row)
    }
  }
  if (Array.isArray(sessions.ids)) {
    for (const id of sessions.ids) add(id, undefined)
  }
  return { byId, list }
}

function normalizedCwd(value: string | undefined): string {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim().replace(/\\/g, '/')
  if (trimmed === '') return ''
  const collapsed = trimmed.replace(/\/{2,}/g, '/')
  return collapsed.length > 1 && collapsed.endsWith('/') ? collapsed.slice(0, -1) : collapsed
}

function sameCwd(a: string | undefined, b: string | undefined): boolean {
  const left = normalizedCwd(a)
  const right = normalizedCwd(b)
  return left !== '' && right !== '' && left.toLowerCase() === right.toLowerCase()
}

function workspaceKey(item: WorkspaceItem, index: number, currentSessionId: string): string {
  if (typeof item.id === 'string' && item.id.trim() !== '') return item.id.trim()
  const first = Array.isArray(item.sessionIds) && item.sessionIds.length > 0 ? item.sessionIds[0] : currentSessionId
  const derived = `workspace:${String(first ?? index)}`
  return derived.length > MAX_WORKSPACE_ID ? derived.slice(0, MAX_WORKSPACE_ID) : derived
}

function isSessionId(id: unknown): id is string {
  return typeof id === 'string' && SESSION_ID_RE.test(id) && id !== '.' && id !== '..'
}

interface Member {
  id: string
  row: SessionRow | undefined
  archived: boolean
}

/** 由成员集合 + 当前会话 id 装配 scope（排序、分段、计数都在这里）。 */
function assembleScope(input: {
  workspaceId: string
  workspaceTitle?: string
  cwd: string
  currentSessionId: string
  members: readonly Member[]
  now: number
  recentWindowMs: number
  degraded: boolean
  degradedReason?: ScopeDegradeReason
}): WorkspaceScope {
  const { workspaceId, currentSessionId, now, recentWindowMs } = input
  const memberById = new Map<string, Member>()
  for (const member of input.members) if (!memberById.has(member.id)) memberById.set(member.id, member)

  const parentOf = (id: string): string | undefined => rowParent(memberById.get(id)?.row)

  /** 当前会话的**后代**集合（沿 parentId 向下，含多级子智能体）。 */
  const descendantsOfCurrent = new Set<string>()
  {
    const children = new Map<string, string[]>()
    for (const member of memberById.values()) {
      const parent = rowParent(member.row)
      if (parent === undefined || !memberById.has(parent)) continue
      const list = children.get(parent)
      if (list === undefined) children.set(parent, [member.id])
      else list.push(member.id)
    }
    const stack = [...(children.get(currentSessionId) ?? [])]
    while (stack.length > 0) {
      const id = stack.pop() as string
      if (descendantsOfCurrent.has(id)) continue
      descendantsOfCurrent.add(id)
      for (const child of children.get(id) ?? []) stack.push(child)
    }
  }

  /** 深度：父链在 scope 内的层数（根 = 0）。 */
  const depthCache = new Map<string, number>()
  const depthOf = (id: string, guard = new Set<string>()): number => {
    const cached = depthCache.get(id)
    if (cached !== undefined) return cached
    if (guard.has(id)) return 0
    guard.add(id)
    const parent = parentOf(id)
    const depth = parent !== undefined && memberById.has(parent) ? depthOf(parent, guard) + 1 : 0
    depthCache.set(id, depth)
    return depth
  }

  const rootOf = (id: string): string => {
    let cursor = id
    const seen = new Set<string>([id])
    for (let i = 0; i < 64; i += 1) {
      const parent = parentOf(cursor)
      if (parent === undefined || !memberById.has(parent) || seen.has(parent)) return cursor
      seen.add(parent)
      cursor = parent
    }
    return cursor
  }

  const bucketOf = (member: Member): ScopeBucket => {
    if (member.id === currentSessionId) return 'current'
    if (descendantsOfCurrent.has(member.id)) return 'subagent'
    if (member.archived) return 'archived'
    const updatedAt = rowUpdatedAt(member.row)
    const age = now - updatedAt
    if (updatedAt > 0 && age <= recentWindowMs) return 'recent'
    return 'history'
  }

  const scoped: ScopeSession[] = input.members.map((member) => {
    const depth = member.id === currentSessionId ? 0 : depthOf(member.id)
    const session: ScopeSession = {
      id: member.id,
      cwd: normalizedCwd(member.row?.cwd) || input.cwd,
      updatedAt: rowUpdatedAt(member.row),
      running: member.row?.running === true,
      archived: member.archived,
      bucket: bucketOf(member),
      depth,
      order: 0,
      rootId: rootOf(member.id),
      rowMissing: member.row === undefined,
    }
    const title = rowTitle(member.row)
    if (title !== undefined) session.title = title
    const origin = member.row?.origin
    if (typeof origin === 'string' && origin !== '') session.origin = origin
    const parent = rowParent(member.row)
    if (parent !== undefined) session.parentId = parent
    return session
  })

  const rank: Record<ScopeBucket, number> = { current: 0, subagent: 1, recent: 2, history: 3, archived: 4 }
  scoped.sort((a, b) => {
    if (rank[a.bucket] !== rank[b.bucket]) return rank[a.bucket] - rank[b.bucket]
    if (a.bucket === 'subagent' && a.depth !== b.depth) return a.depth - b.depth
    if (a.updatedAt !== b.updatedAt) return b.updatedAt - a.updatedAt
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })

  const sessions = scoped.map((session, index) => ({ ...session, order: index }))

  const counts: ScopeCounts = {
    total: sessions.length,
    current: 0,
    subagent: 0,
    recent: 0,
    history: 0,
    archived: 0,
    archivedTotal: 0,
  }
  for (const session of sessions) {
    counts[session.bucket] += 1
    if (session.archived) counts.archivedTotal += 1
  }

  const scope: WorkspaceScope = {
    workspaceId,
    cwd: input.cwd,
    currentSessionId,
    sessions,
    order: sessions.map((session) => session.id),
    counts,
    degraded: input.degraded,
    computedAt: now,
  }
  if (input.workspaceTitle !== undefined) scope.workspaceTitle = input.workspaceTitle
  if (input.degradedReason !== undefined) scope.degradedReason = input.degradedReason
  return scope
}

/**
 * 构建当前工作区范围（A20-1）。
 *
 * 规则（04 §4.1）：
 * - 只取包含当前 `sessionId` 的那个 workspace 条目的 `sessionIds` ∪ `archivedSessionIds`；
 * - 沿 `parentId`/`parentSession` 向下补全**全部子智能体**（cwd 不同也纳入）；
 * - 不汇总其它 workspace；
 * - 找不到 workspace 时按当前会话 `cwd` 兜底并标 `degraded`。
 */
export function buildWorkspaceScope(input: BuildScopeInput): WorkspaceScope {
  const now = asFiniteNumber(input.now) ?? Date.now()
  const recentWindowMs = asFiniteNumber(input.recentWindowMs) ?? RECENT_WINDOW_MS
  const sessionId = input.sessionId
  const items = itemsOf(input.workspaces)
  const index = indexSessions(input.sessions)
  const currentRow = index.byId.get(sessionId)

  let item: WorkspaceItem | undefined
  let itemIndex = -1
  for (let i = 0; i < items.length; i += 1) {
    const candidate = items[i]
    const ids = Array.isArray(candidate.sessionIds) ? candidate.sessionIds : []
    const archived = Array.isArray(candidate.archivedSessionIds) ? candidate.archivedSessionIds : []
    if (ids.includes(sessionId) || archived.includes(sessionId)) {
      item = candidate
      itemIndex = i
      break
    }
  }

  // 当前会话不在任何 workspace 的名单里：用 cwd 找同 cwd 的条目（仍然只取一个）。
  if (item === undefined && currentRow !== undefined) {
    for (let i = 0; i < items.length; i += 1) {
      const candidate = items[i]
      const ids = Array.isArray(candidate.sessionIds) ? candidate.sessionIds : []
      const archived = Array.isArray(candidate.archivedSessionIds) ? candidate.archivedSessionIds : []
      const sameCwdMember = [...ids, ...archived].some((id) => sameCwd(index.byId.get(id)?.cwd, currentRow.cwd))
      if (sameCwdMember) {
        item = candidate
        itemIndex = i
        break
      }
    }
  }

  const nowCwd = normalizedCwd(currentRow?.cwd)

  if (item === undefined) {
    // 降级：按当前会话 cwd 兜底（04 §4.1）。仍只取一个“范围”，不混其它工作区。
    const members: Member[] = []
    const seen = new Set<string>()
    const add = (id: string, archived: boolean): void => {
      if (seen.has(id) || !isSessionId(id)) return
      seen.add(id)
      const row = index.byId.get(id)
      const rowArchived = row?.archived === true || asFiniteNumber(row?.archivedAt) !== undefined
      members.push({ id, row, archived: archived || rowArchived })
    }
    add(sessionId, currentRow?.archived === true)
    for (const row of index.list) {
      if (row.id === sessionId) continue
      if (!sameCwd(row.cwd, currentRow?.cwd)) continue
      add(row.id, false)
    }
    return assembleScope({
      workspaceId: workspaceKey({ sessionIds: [sessionId] }, itemIndex < 0 ? 0 : itemIndex, sessionId),
      cwd: nowCwd,
      currentSessionId: sessionId,
      members,
      now,
      recentWindowMs,
      degraded: true,
      degradedReason: currentRow === undefined ? 'current-session-missing' : 'workspace-not-found',
    })
  }

  const ids = Array.isArray(item.sessionIds) ? item.sessionIds : []
  const archivedIds = Array.isArray(item.archivedSessionIds) ? item.archivedSessionIds : []
  const archivedSet = new Set(archivedIds.filter(isSessionId))

  const members: Member[] = []
  const seen = new Set<string>()
  const push = (id: string): void => {
    if (!isSessionId(id) || seen.has(id)) return
    seen.add(id)
    const row = index.byId.get(id)
    const rowArchived = row?.archived === true || asFiniteNumber(row?.archivedAt) !== undefined
    members.push({ id, row, archived: archivedSet.has(id) || rowArchived })
  }
  for (const id of ids) push(id)
  for (const id of archivedIds) push(id)
  if (!seen.has(sessionId)) push(sessionId)

  // 子智能体：parent 在范围内 → 纳入（含多级；cwd 不同也算）。
  const childrenOf = new Map<string, string[]>()
  for (const row of index.list) {
    const parent = rowParent(row)
    if (parent === undefined) continue
    const list = childrenOf.get(parent)
    if (list === undefined) childrenOf.set(parent, [row.id])
    else if (!list.includes(row.id)) list.push(row.id)
  }
  const queue = [...seen]
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const parent = queue[cursor]
    for (const child of childrenOf.get(parent) ?? []) {
      if (seen.has(child)) continue
      push(child)
      queue.push(child)
    }
  }

  const workspaceCwd =
    nowCwd !== ''
      ? nowCwd
      : normalizedCwd(
          members.map((member) => member.row?.cwd).find((cwd): cwd is string => typeof cwd === 'string' && cwd !== ''),
        )

  return assembleScope({
    workspaceId: workspaceKey(item, itemIndex, sessionId),
    workspaceTitle: typeof item.title === 'string' ? item.title : undefined,
    cwd: workspaceCwd,
    currentSessionId: sessionId,
    members,
    now,
    recentWindowMs,
    degraded: false,
  })
}

/** 同一工作区里聚焦另一会话（03 §2.4：不重扫，只改排序与“当前”）。 */
export function refocusScope(scope: WorkspaceScope, sessionId: string): WorkspaceScope {
  if (sessionId === scope.currentSessionId) return scope
  const members: Member[] = scope.sessions.map((session) => ({
    id: session.id,
    archived: session.archived,
    row: {
      id: session.id,
      cwd: session.cwd,
      updatedAt: session.updatedAt,
      running: session.running,
      ...(session.title === undefined ? {} : { title: session.title }),
      ...(session.parentId === undefined ? {} : { parentId: session.parentId }),
      ...(session.origin === undefined ? {} : { origin: session.origin }),
    },
  }))
  return assembleScope({
    workspaceId: scope.workspaceId,
    workspaceTitle: scope.workspaceTitle,
    cwd: scope.cwd,
    currentSessionId: sessionId,
    members,
    now: scope.computedAt,
    recentWindowMs: RECENT_WINDOW_MS,
    degraded: scope.degraded,
    degradedReason: scope.degradedReason,
  })
}

/** 过滤归档（`session.archived` 标记保持，供 UI 打「归档」标）。 */
export function withoutArchived(scope: WorkspaceScope): WorkspaceScope {
  if (scope.counts.archivedTotal === 0) return scope
  const members: Member[] = scope.sessions
    .filter((session) => !session.archived)
    .map((session) => ({
      id: session.id,
      archived: false,
      row: {
        id: session.id,
        cwd: session.cwd,
        updatedAt: session.updatedAt,
        running: session.running,
        ...(session.title === undefined ? {} : { title: session.title }),
        ...(session.parentId === undefined ? {} : { parentId: session.parentId }),
        ...(session.origin === undefined ? {} : { origin: session.origin }),
      },
    }))
  return assembleScope({
    workspaceId: scope.workspaceId,
    workspaceTitle: scope.workspaceTitle,
    cwd: scope.cwd,
    currentSessionId: scope.currentSessionId,
    members,
    now: scope.computedAt,
    recentWindowMs: RECENT_WINDOW_MS,
    degraded: scope.degraded,
    degradedReason: scope.degradedReason,
  })
}

/**
 * 把 scope 转成 `POST /scan` 的 `sessions`（04 §2.4）。
 *
 * - 只包含 scope 内的会话（不混其它工作区）；
 * - `updatedAt` 保证有限非负、`running` 保证 boolean；
 * - 按 scope 顺序输出（host 的 `orderSessions` 会再排一次，两边口径一致）。
 */
export function toScanSessions(scope: WorkspaceScope): ScanSessionInput[] {
  const result: ScanSessionInput[] = []
  const seen = new Set<string>()
  for (const session of scope.sessions) {
    if (seen.has(session.id) || !isSessionId(session.id)) continue
    seen.add(session.id)
    const input: ScanSessionInput = {
      id: session.id,
      updatedAt: Number.isFinite(session.updatedAt) && session.updatedAt >= 0 ? session.updatedAt : 0,
      running: session.running === true,
    }
    if (session.parentId !== undefined) input.parentId = session.parentId
    if (session.title !== undefined) input.title = session.title
    if (session.origin !== undefined) input.origin = session.origin
    if (session.archived) input.archived = true
    result.push(input)
  }
  return result
}

/** 当前会话 + 其子智能体（轮询/详情优先对象；按 scope 顺序）。 */
export function prioritySessionIds(scope: WorkspaceScope): string[] {
  return scope.sessions
    .filter((session) => session.bucket === 'current' || session.bucket === 'subagent')
    .map((session) => session.id)
}

/** scope 是否可发起扫描（cwd 已识别 + 至少一个会话）。 */
export function isScannableScope(scope: WorkspaceScope | null | undefined): scope is WorkspaceScope {
  return scope !== null && scope !== undefined && scope.cwd.trim() !== '' && scope.sessions.length > 0
}
