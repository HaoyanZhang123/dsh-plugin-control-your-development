/**
 * client/data/tree.ts —— 工作区目录树数据层（R02；03 任务卡 R02 / 01 §4.1 / 07 §3）。
 *
 * 职责边界（单一执行路径：只有这一个目录树实现）：
 * 1. **双数据源**：首选宿主只读 `remote.workspaceFiles.list(sessionId, path)`；
 *    不可用（真机 risk，02 §G/§K1）时走**用户已批准的 B1 host 只读目录列表**
 *    （`POST /api/dsh-threadline/tree` → `src/host/tree.ts`）。两条路都不可用 → 显式 `no-source`，
 *    **绝不假装空目录**。
 * 2. **归一化**：wire 条目 → `TreeEntry`（join 工作区相对 POSIX 路径、判 kind、文件 size、族色 family），
 *    去重（大小写不敏感身份键）、排序（目录 → 文件 → other；同类确定性名称序）、条目上限 + `truncated`。
 * 3. **内存缓存**：`Map<`${sessionId}\u0000${path}`, TreeListing>`（LRU + 上限），**不持久化**
 *    （不写 localStorage/sessionStorage/cookie/URL）。
 * 4. **同路径并发去重**：in-flight promise 复用（`prefetch` 与首屏共用同一次请求）。
 * 5. **React 钩子**：`useDirectoryTree` 返回 `{state, navigate, back, refresh, ...}`；
 *    loading/error 时**保留上一份 listing**（M3：不整块空白、不骨架闪烁）。
 *
 * 只读纪律：本文件只发同源 POST（`routePath('tree')`，经 `data/http.ts` 的唯一通道）；
 * 不读文件正文、不写任何东西、不 import fs（fs 只在 host 半区的 `src/host/tree.ts`）。
 * 文案：本层只产出**机器码**（`TreeErrorCode` / kind），任何可读文案由 UI 用 locale 渲染。
 */
import * as React from 'react'
import type { FileFamily } from '../../shared/events/index.ts'
import { familyOf } from '../../shared/events/index.ts'
import { dirOf, isAbsolutePath, normalizeRelative } from '../../shared/relations/path.ts'
import type { WorkspaceDirectoryEntry, WorkspaceDirectoryListing, WorkspaceFilesFace } from '../files/index.ts'
import { isAbortError, postJson, routePath, type FetchLike } from './http.ts'

/* ------------------------------------------------------------------ *
 * 1. 契约类型（tab / rail / graph 共用；改动先改这里并通知 Lead）
 * ------------------------------------------------------------------ */

/** 目录条目类别：`other` 显示但**不可进入**（符号链接/设备/未知类型）。 */
export type TreeKind = 'directory' | 'file' | 'other'

/** 一个目录条目（已归一化）。 */
export interface TreeEntry {
  /** basename（展示保留原大小写）。 */
  name: string
  /** 工作区相对 POSIX 路径，无前导 `/`；根层条目 = name。 */
  path: string
  kind: TreeKind
  /** 只有普通文件且宿主给了有限非负字节数时才存在（不伪造 0）。 */
  size?: number
  /** 文件大类（按扩展名，`shared/events` 的唯一规则；未触碰的文件也有）。 */
  family: FileFamily
}

/** 一次目录列表（已归一化）。 */
export interface TreeListing {
  /** `''` = 工作区根。 */
  path: string
  entries: TreeEntry[]
  /** 宿主截断 或 本地条目上限触发；**必须**在 UI 显式提示，不静默。 */
  truncated: boolean
  loadedAt: number
}

/** 目录树状态（UI 只认这个）。 */
export type TreeStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error'

/** 失败机器码（UI 用 locale 渲染文案；本层不产出路径/正文）。 */
export type TreeErrorCode =
  | 'no-source'
  | 'rejected-path'
  | 'list-failed'
  | 'not-directory'
  | 'not-found'
  | 'unreadable'
  | 'root-without-cwd'
  | 'aborted'

/** 一次导航的完整状态。 */
export interface TreeState {
  sessionId: string
  /** 当前目录（`''` = 根）。 */
  path: string
  status: TreeStatus
  /** loading/error 时保留**上一份**（stale 显示，不空白）。 */
  listing: TreeListing | null
  /** 机器码字符串（= errorCode；不含路径/文案）。 */
  error: string | null
  errorCode: TreeErrorCode | null
}

/** 路径校验结果（绝对路径 / `..` 穿越 / 控制字符都在这里被拒）。 */
export type TreePathValidation =
  | { ok: true; path: string }
  | { ok: false; reason: 'absolute-path' | 'escape-cwd' | 'empty-path' | 'too-long' | 'invalid-chars' }

/** 数据源类别。 */
export type TreeSourceKind = 'remote' | 'host'

/* ------------------------------------------------------------------ *
 * 2. 常量
 * ------------------------------------------------------------------ */

/** 单目录条目上限（超出即 `truncated`；与 04 的"有上限"一致）。 */
export const TREE_ENTRY_LIMIT = 2000

/** 工作区相对路径长度上限（与 shared/events 的 MAX_PATH_LENGTH 同量级）。 */
export const MAX_TREE_PATH_LENGTH = 1024

/** 缓存条目上限（LRU；目录树是内存态，切会话/卸载不持久化）。 */
export const DEFAULT_TREE_CACHE_ENTRIES = 200

/** kind → 排序组（目录在前、文件次之、other 最后）。 */
export const TREE_KIND_RANK: Readonly<Record<TreeKind, number>> = {
  directory: 0,
  file: 1,
  other: 2,
}

/* ------------------------------------------------------------------ *
 * 3. 纯函数：路径
 * ------------------------------------------------------------------ */

function hasControlChars(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code < 0x20 || code === 0x7f) return true
  }
  return false
}

/**
 * 校验/归一化一个**工作区相对**目录路径（`''` = 根）。
 *
 * 拒绝：非字符串、控制字符、超长、绝对路径（`/x`、`C:/x`、`//host/x`）、折叠 `..` 后越界。
 * 允许：`''`（根）、`'a/b'`、`'./a//b/'`（折叠成 `a/b`）。
 */
export function validateTreePath(input: unknown): TreePathValidation {
  if (typeof input !== 'string') return { ok: false, reason: 'empty-path' }
  const trimmed = input.trim()
  if (trimmed === '') return { ok: true, path: '' }
  if (trimmed.length > MAX_TREE_PATH_LENGTH) return { ok: false, reason: 'too-long' }
  if (hasControlChars(trimmed)) return { ok: false, reason: 'invalid-chars' }
  if (isAbsolutePath(trimmed)) return { ok: false, reason: 'absolute-path' }
  const normalized = normalizeRelative(trimmed)
  if (normalized.escaped) return { ok: false, reason: 'escape-cwd' }
  if (normalized.path === '') return { ok: true, path: '' }
  return { ok: true, path: normalized.path }
}

/** 父目录（`''` = 根；根层的父目录仍是根）。 */
export function parentTreePath(path: string): string {
  return dirOf(path)
}

/** 把名字拼到目录后（POSIX；根目录不产生前导 `/`）。 */
export function joinTreePath(directory: string, name: string): string {
  const base = normalizeRelative(directory).path
  return base === '' ? name : `${base}/${name}`
}

/** 面包屑段（不含根段；`''` → `[]`）。每段 `path` 是到该层的完整相对路径。 */
export function treeBreadcrumb(path: string): Array<{ name: string; path: string }> {
  const normalized = normalizeRelative(path).path
  if (normalized === '') return []
  const segments = normalized.split('/')
  const crumbs: Array<{ name: string; path: string }> = []
  for (let index = 0; index < segments.length; index += 1) {
    crumbs.push({ name: segments[index], path: segments.slice(0, index + 1).join('/') })
  }
  return crumbs
}

/** `other` 不可进入（卡片/列表点击只能选中）。 */
export function canEnterTreeEntry(entry: Pick<TreeEntry, 'kind'>): boolean {
  return entry.kind === 'directory'
}

/* ------------------------------------------------------------------ *
 * 4. 纯函数：条目归一化 / 去重 / 排序
 * ------------------------------------------------------------------ */

/** 名字是否可用（拒绝空、分隔符、`.`/`..`、控制字符）。 */
function isUsableName(name: unknown): name is string {
  return (
    typeof name === 'string' &&
    name !== '' &&
    name !== '.' &&
    name !== '..' &&
    !name.includes('/') &&
    !name.includes('\\') &&
    !hasControlChars(name)
  )
}

/** wire type → kind（未知一律 `other`：不猜成可进入的目录）。 */
function kindOf(type: unknown): TreeKind {
  return type === 'directory' ? 'directory' : type === 'file' ? 'file' : 'other'
}

/**
 * 确定性名称比较：先小写、再原文（码位序）。
 * 不用 `localeCompare`：ICU 版本/platform 差异会让同一份工作区在不同机器上顺序不同，
 * 而"同数据同顺序"是缓存/测试/snapshot 的前提。
 */
export function compareTreeEntryNames(left: string, right: string): number {
  const a = left.toLowerCase()
  const b = right.toLowerCase()
  if (a !== b) return a < b ? -1 : 1
  if (left !== right) return left < right ? -1 : 1
  return 0
}

/** 条目排序：kind 组（目录→文件→other）→ 确定性名称序。 */
export function compareTreeEntries(left: TreeEntry, right: TreeEntry): number {
  const rank = TREE_KIND_RANK[left.kind] - TREE_KIND_RANK[right.kind]
  if (rank !== 0) return rank
  return compareTreeEntryNames(left.name, right.name)
}

/** 排序（纯函数，不修改入参）。 */
export function sortTreeEntries(entries: readonly TreeEntry[]): TreeEntry[] {
  return entries.slice().sort(compareTreeEntries)
}

export interface NormalizeEntriesResult {
  /** 已去重 + 已排序 + 已按上限裁剪。 */
  entries: TreeEntry[]
  /** 被丢弃的畸形条目数（名字非法/重复），只用于测试与计数日志。 */
  dropped: number
  /** 是否被本地条目上限裁剪。 */
  capped: boolean
}

/**
 * wire 条目 → `TreeEntry[]`：校验名字、拼路径、判 kind、取 size、推 family、
 * 按小写路径去重（Windows 身份不区分大小写）、排序、按 `limit` 裁剪。
 */
export function normalizeTreeEntries(
  directoryPath: string,
  raw: readonly WorkspaceDirectoryEntry[],
  options: { limit?: number } = {},
): NormalizeEntriesResult {
  const normalizedDirectory = normalizeRelative(directoryPath).path
  const limit = Math.max(0, Math.trunc(options.limit ?? TREE_ENTRY_LIMIT))
  const seen = new Set<string>()
  const collected: TreeEntry[] = []
  let dropped = 0
  for (const item of raw) {
    if (item === null || typeof item !== 'object') {
      dropped += 1
      continue
    }
    const name = (item as { name?: unknown }).name
    if (!isUsableName(name)) {
      dropped += 1
      continue
    }
    const path = joinTreePath(normalizedDirectory, name)
    const identity = path.toLowerCase()
    if (seen.has(identity)) {
      dropped += 1
      continue
    }
    seen.add(identity)
    const kind = kindOf((item as { type?: unknown }).type)
    const size = (item as { size?: unknown }).size
    const entry: TreeEntry = { name, path, kind, family: familyOf(path) }
    // size 只在普通文件且是有限非负数时存在（目录/other/未知一律不带，避免伪造 0）。
    if (kind === 'file' && typeof size === 'number' && Number.isFinite(size) && size >= 0) {
      entry.size = Math.trunc(size)
    }
    collected.push(entry)
  }
  const sorted = sortTreeEntries(collected)
  const capped = limit > 0 && sorted.length > limit
  return { entries: capped ? sorted.slice(0, limit) : sorted, dropped, capped }
}

/** wire listing → `TreeListing`（truncated = 宿主截断 或 本地上限触发）。 */
export function normalizeTreeListing(
  raw: WorkspaceDirectoryListing,
  directoryPath: string,
  options: { limit?: number; now?: () => number } = {},
): TreeListing {
  const normalizedDirectory = normalizeRelative(directoryPath).path
  const raws = Array.isArray(raw.entries) ? raw.entries : []
  const result = normalizeTreeEntries(normalizedDirectory, raws, options)
  const now = options.now ?? Date.now
  return {
    path: normalizedDirectory,
    entries: result.entries,
    truncated: raw.truncated === true || result.capped,
    loadedAt: now(),
  }
}

/* ------------------------------------------------------------------ *
 * 5. 缓存（内存 LRU；key = `${sessionId}\u0000${path}`）
 * ------------------------------------------------------------------ */

/** 缓存键（唯一实现；测试也用它断言隔离）。 */
export function treeCacheKey(sessionId: string, path: string): string {
  return `${sessionId}\u0000${normalizeRelative(path).path}`
}

export interface TreeCache {
  get(sessionId: string, path: string): TreeListing | undefined
  set(sessionId: string, path: string, listing: TreeListing): void
  /** 只失效这一个路径。 */
  invalidatePath(sessionId: string, path: string): void
  /** 清掉该会话的全部路径。 */
  invalidateSession(sessionId: string): void
  clear(): void
  readonly size: number
}

/** 内存 LRU 缓存（不持久化；卸载/切会话由调用方清）。 */
export function createTreeCache(options: { maxEntries?: number } = {}): TreeCache {
  const maxEntries = Math.max(1, Math.trunc(options.maxEntries ?? DEFAULT_TREE_CACHE_ENTRIES))
  const entries = new Map<string, TreeListing>()

  const touch = (key: string, value: TreeListing): void => {
    // Map 迭代顺序 = 插入顺序；重新 set 即把它挪到队尾（LRU）。
    entries.delete(key)
    entries.set(key, value)
    while (entries.size > maxEntries) {
      const oldest = entries.keys().next()
      if (oldest.done === true) break
      entries.delete(oldest.value)
    }
  }

  return {
    get(sessionId, path) {
      const key = treeCacheKey(sessionId, path)
      const value = entries.get(key)
      if (value === undefined) return undefined
      touch(key, value)
      return value
    },
    set(sessionId, path, listing) {
      touch(treeCacheKey(sessionId, path), listing)
    },
    invalidatePath(sessionId, path) {
      entries.delete(treeCacheKey(sessionId, path))
    },
    invalidateSession(sessionId) {
      const prefix = `${sessionId}\u0000`
      for (const key of [...entries.keys()]) {
        if (key.startsWith(prefix)) entries.delete(key)
      }
    },
    clear() {
      entries.clear()
    },
    get size() {
      return entries.size
    },
  }
}

/** 模块级共享缓存（同一页面多次挂载 tab 复用；不持久化）。 */
export const sharedTreeCache: TreeCache = createTreeCache()

/** 测试/卸载用：清空共享缓存与 in-flight。 */
export function resetSharedTreeState(): void {
  sharedTreeCache.clear()
  inflight.clear()
}

/* ------------------------------------------------------------------ *
 * 6. 同路径并发去重（in-flight 复用）
 * ------------------------------------------------------------------ */

const inflight = new Map<string, Promise<TreeListing>>()

/** in-flight key：source 类别 + 缓存键（不同源不互相复用，避免串数据）。 */
function inflightKey(kind: TreeSourceKind, sessionId: string, path: string): string {
  return `${kind}\u0000${treeCacheKey(sessionId, path)}`
}

/** 当前在途请求数（测试断言并发去重用）。 */
export function treeInflightCount(): number {
  return inflight.size
}

/* ------------------------------------------------------------------ *
 * 7. 数据源
 * ------------------------------------------------------------------ */

/** 数据源（remote / host 两个实现，接口一致）。 */
export interface TreeSource {
  readonly kind: TreeSourceKind
  readonly sessionId: string
  list(path: string, signal?: AbortSignal): Promise<WorkspaceDirectoryListing>
}

/** 源层错误：带机器码，消息里**不含路径**（日志纪律）。 */
export class TreeSourceError extends Error {
  readonly code: TreeErrorCode
  constructor(code: TreeErrorCode, message: string) {
    super(message)
    this.name = 'TreeSourceError'
    this.code = code
  }
}

/**
 * `remote.workspaceFiles.list` 的返回可能是裸对象（rc.5 实测）
 * 也可能被 `RemoteResult` 信封包着（`{ok:true,value}` / `{ok:false,error}`，notes/02:88）。
 * 两条形状都接受；失败信封 → `list-failed`（不伪装成空目录）。
 */
function unwrapRemoteListing(raw: unknown): WorkspaceDirectoryListing {
  if (raw === null || typeof raw !== 'object') {
    throw new TreeSourceError('list-failed', 'bad-listing')
  }
  const record = raw as Record<string, unknown>
  if (record.ok === false) {
    throw new TreeSourceError('list-failed', 'remote-error')
  }
  const value = record.ok === true && record.value !== undefined ? record.value : record
  if (value === null || typeof value !== 'object') {
    throw new TreeSourceError('list-failed', 'bad-listing')
  }
  const listing = value as { entries?: unknown; truncated?: unknown; path?: unknown }
  if (!Array.isArray(listing.entries)) {
    throw new TreeSourceError('list-failed', 'bad-listing')
  }
  return {
    path: typeof listing.path === 'string' ? listing.path : '',
    entries: listing.entries as WorkspaceDirectoryEntry[],
    truncated: listing.truncated === true,
  }
}

/**
 * 首选源：宿主只读 `remote.workspaceFiles.list`。
 *
 * **真机语义纠正（R02 实测，2026-11-07）**：notes/21 §c.1 写"`list.path` 是工作区相对路径，
 * 空串=根"，但已安装版本 `@deepseek-ai/dsh-api-workspace-files@0.2.2-rc.1` 的 `inspect()`
 * 对空串直接抛 `gateway/bad-request: path is required`（证据：output/_verify/threadline/T50/R02/SRC-probe.txt
 * [B2]，以及 DSH 自己的文件树用**会话 cwd 绝对路径**当根，[B4]）。
 * 因此根层必须用 `cwd`（绝对路径）去 list；没有 cwd 时显式报错（`no-source` 之外的
 * `list-failed` 会误导，用 `'no-source'` 也不对，这里用专用码 `root-without-cwd`）。
 */
export function createRemoteTreeSource(input: {
  files: WorkspaceFilesFace
  sessionId: string
  /** 会话 cwd（绝对路径）；根层 list 必须用它（空串会被宿主拒绝）。 */
  cwd?: string
}): TreeSource {
  const { files, sessionId } = input
  const cwd = typeof input.cwd === 'string' ? input.cwd.trim() : ''
  return {
    kind: 'remote',
    sessionId,
    async list(path: string, signal?: AbortSignal): Promise<WorkspaceDirectoryListing> {
      if (typeof files.list !== 'function') {
        throw new TreeSourceError('no-source', 'workspaceFiles.list missing')
      }
      // 根层：宿主不接受空串，用 cwd 绝对路径；没有 cwd 就明确报错（不假装空目录）。
      const target = path === '' ? cwd : path
      if (target === '') throw new TreeSourceError('root-without-cwd', 'no cwd for workspace root')
      let raw: unknown
      try {
        raw = await files.list(sessionId, target, signal)
      } catch (error) {
        if (isAbortError(error)) throw new TreeSourceError('aborted', 'aborted')
        throw new TreeSourceError('list-failed', 'remote-list-failed')
      }
      return unwrapRemoteListing(raw)
    },
  }
}

/** host 路由的错误码 → 本层机器码（`detail` 是 host 给的短 token，不含路径）。 */
function hostErrorCode(code: unknown, detail: unknown): TreeErrorCode {
  if (detail === 'not-directory' || detail === 'not-found' || detail === 'unreadable') return detail
  if (code === 'threadline/capability-missing') return 'no-source'
  if (code === 'threadline/bad-request') return 'rejected-path'
  return 'list-failed'
}

/**
 * B1 fallback 源：`POST /api/dsh-threadline/tree`（host 只读目录列表，零写）。
 * 走 `data/http.ts` 的唯一通道（同源相对路径 + 错误壳规范化）。
 */
export function createHostTreeSource(input: { fetch: FetchLike; sessionId: string }): TreeSource {
  const { fetch, sessionId } = input
  return {
    kind: 'host',
    sessionId,
    async list(path: string, signal?: AbortSignal): Promise<WorkspaceDirectoryListing> {
      const result = await postJson(fetch, 'tree', { sessionId, path }, signal)
      if (!result.ok) {
        const failure = result.failure
        if (failure.kind === 'aborted') throw new TreeSourceError('aborted', 'aborted')
        if (failure.kind === 'route') {
          throw new TreeSourceError(hostErrorCode(failure.error.code, failure.error.detail), 'host-tree-error')
        }
        throw new TreeSourceError('list-failed', 'host-tree-transport')
      }
      return unwrapRemoteListing(result.value)
    },
  }
}

/** 从 `remote` 门面里安全取 `workspaceFiles`（Cordis 代理读取可能抛错 → undefined）。 */
export function pickWorkspaceFilesFace(remote: unknown): WorkspaceFilesFace | undefined {
  if (remote === null || typeof remote !== 'object') return undefined
  let files: unknown
  try {
    files = (remote as { workspaceFiles?: unknown }).workspaceFiles
  } catch {
    return undefined
  }
  if (files === null || files === undefined || typeof files !== 'object') return undefined
  const face = files as { list?: unknown }
  if (typeof face.list !== 'function') return undefined
  return files as WorkspaceFilesFace
}

export interface ResolveTreeSourceInput {
  sessionId: string
  remote?: unknown
  fetch?: FetchLike | null
  /** 会话 cwd（绝对路径）：remote 源的根层必须用它（宿主不接受空串 path）。 */
  cwd?: string
}

/** 选路：remote.list 优先 → host 只读路由 → none（显式错误，不假装空目录）。 */
export function resolveTreeSource(input: ResolveTreeSourceInput): TreeSource | null {
  if (typeof input.sessionId !== 'string' || input.sessionId === '') return null
  const face = pickWorkspaceFilesFace(input.remote)
  if (face !== undefined) {
    return createRemoteTreeSource({
      files: face,
      sessionId: input.sessionId,
      ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
    })
  }
  if (typeof input.fetch === 'function') return createHostTreeSource({ fetch: input.fetch, sessionId: input.sessionId })
  return null
}

/* ------------------------------------------------------------------ *
 * 8. 加载（缓存 → in-flight → 源），带归一化
 * ------------------------------------------------------------------ */

export interface LoadTreeListingInput {
  source: TreeSource | null
  path: string
  cache?: TreeCache
  now?: () => number
  /** true = 跳过缓存（`refresh`）：只失效当前路径。 */
  refresh?: boolean
  signal?: AbortSignal
}

async function loadUncached(input: LoadTreeListingInput, path: string): Promise<TreeListing> {
  const source = input.source
  if (source === null) throw new TreeSourceError('no-source', 'no tree source')
  const raw = await source.list(path, input.signal)
  return normalizeTreeListing(raw, path, {
    ...(input.now === undefined ? {} : { now: input.now }),
  })
}

/**
 * 取一份 listing：命中缓存直接返回（同步可用）；否则复用同路径 in-flight；
 * 都没有才真的发一次请求。失败**不写缓存**（错误不是数据）。
 */
export function loadTreeListing(input: LoadTreeListingInput): Promise<TreeListing> {
  const validation = validateTreePath(input.path)
  if (!validation.ok) return Promise.reject(new TreeSourceError('rejected-path', validation.reason))
  const path = validation.path
  const source = input.source
  const cache = input.cache ?? sharedTreeCache

  if (source === null) return Promise.reject(new TreeSourceError('no-source', 'no tree source'))

  if (input.refresh !== true) {
    const cached = cache.get(source.sessionId, path)
    if (cached !== undefined) return Promise.resolve(cached)
  } else {
    cache.invalidatePath(source.sessionId, path)
  }

  const key = inflightKey(source.kind, source.sessionId, path)
  const existing = inflight.get(key)
  if (existing !== undefined) return existing

  const started = loadUncached(input, path).then((listing) => {
    cache.set(source.sessionId, path, listing)
    return listing
  })
  const tracked: Promise<TreeListing> = started.finally(() => {
    if (inflight.get(key) === tracked) inflight.delete(key)
  })
  inflight.set(key, tracked)
  return tracked
}

/* ------------------------------------------------------------------ *
 * 9. 控制器（非 React；hook 与 R06 预取共用同一实现）
 * ------------------------------------------------------------------ */

/** 控制器状态：`TreeState` + 源信息（UI 需要显示"观测不到"还是"读取失败"）。 */
export interface TreeControllerState extends TreeState {
  source: 'remote' | 'host' | 'none'
}

export interface DirectoryTreeOptions {
  sessionId: string
  remote?: unknown
  fetch?: FetchLike | null
  /** 会话 cwd（绝对路径）：remote 源的根层用它，host 源只作参考（host 自己读 header）。 */
  cwd?: string
  initialPath?: string
  cache?: TreeCache
  enabled?: boolean
  now?: () => number
}

export interface DirectoryTree {
  getState(): TreeControllerState
  subscribe(listener: (state: TreeControllerState) => void): () => void
  navigate(path: string): void
  back(): void
  refresh(): void
  retry(): void
  prefetch(path: string): void
  /** 同步读缓存（不触发请求）；没有则 undefined。 */
  peek(path: string): TreeListing | undefined
  invalidatePath(path: string): void
  invalidateSession(sessionId: string): void
  readonly source: 'remote' | 'host' | 'none'
  readonly canBack: boolean
  dispose(): void
}

/**
 * 建目录树控制器。
 *
 * 初始状态：有缓存 → 直接 `ready`/`empty`（**同帧出现，不闪 skeleton**）；
 * 没缓存且 enabled → `loading` 并发一次请求；无源 → `error/no-source`（不假装空）。
 */
export function createDirectoryTree(options: DirectoryTreeOptions): DirectoryTree {
  const cache = options.cache ?? sharedTreeCache
  const now = options.now ?? Date.now
  const source = resolveTreeSource({
    sessionId: options.sessionId,
    ...(options.remote === undefined ? {} : { remote: options.remote }),
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
  })
  const sourceKind: 'remote' | 'host' | 'none' = source === null ? 'none' : source.kind
  const initial = validateTreePath(options.initialPath ?? '')
  const listeners = new Set<(state: TreeControllerState) => void>()
  let disposed = false
  let generation = 0

  const initialState: TreeControllerState = {
    sessionId: options.sessionId,
    path: initial.ok ? initial.path : '',
    status: 'idle',
    listing: null,
    error: null,
    errorCode: null,
    source: sourceKind,
  }

  // 缓存命中 → 初始就是 ready/empty（首帧即有内容）。
  const cached = cache.get(options.sessionId, initialState.path)
  if (cached !== undefined) {
    initialState.listing = cached
    initialState.status = cached.entries.length === 0 ? 'empty' : 'ready'
  } else if (source === null) {
    initialState.status = 'error'
    initialState.errorCode = 'no-source'
    initialState.error = 'no-source'
  }

  let state = initialState

  const emit = (): void => {
    for (const listener of listeners) {
      try {
        listener(state)
      } catch {
        // 订阅者异常不能打断数据层。
      }
    }
  }

  const patch = (next: Partial<TreeControllerState>): void => {
    state = { ...state, ...next }
    emit()
  }

  const run = (path: string, options2: { refresh?: boolean } = {}): void => {
    if (disposed) return
    if (source === null) {
      // 双源都不可用：显式错误，不假装空目录（M4 边界）。
      patch({ path, status: 'error', errorCode: 'no-source', error: 'no-source' })
      return
    }
    const ticket = (generation += 1)
    const cachedListing = options2.refresh === true ? undefined : cache.get(options.sessionId, path)
    if (cachedListing !== undefined) {
      patch({
        path,
        status: cachedListing.entries.length === 0 ? 'empty' : 'ready',
        listing: cachedListing,
        error: null,
        errorCode: null,
      })
      return
    }
    // 保留旧 listing：loading 不是空白（M3）。
    patch({
      path,
      status: 'loading',
      error: null,
      errorCode: null,
      ...(state.listing === null ? {} : { listing: state.listing }),
    })
    void loadTreeListing({
      source,
      path,
      cache,
      now,
      ...(options2.refresh === true ? { refresh: true } : {}),
    })
      .then((listing) => {
        if (disposed || ticket !== generation) return
        patch({
          status: listing.entries.length === 0 ? 'empty' : 'ready',
          listing,
          error: null,
          errorCode: null,
        })
      })
      .catch((error: unknown) => {
        if (disposed || ticket !== generation) return
        const code: TreeErrorCode =
          error instanceof TreeSourceError
            ? error.code
            : isAbortError(error)
              ? 'aborted'
              : 'list-failed'
        if (code === 'aborted') return
        patch({ status: 'error', errorCode: code, error: code })
      })
  }

  const navigate = (path: string): void => {
    if (disposed) return
    const validation = validateTreePath(path)
    if (!validation.ok) {
      // 非法路径：不发请求、不改当前路径，显式错误（边界用例必须可断言）。
      generation += 1
      patch({ status: 'error', errorCode: 'rejected-path', error: validation.reason })
      return
    }
    run(validation.path)
  }

  const refresh = (): void => {
    if (disposed) return
    // 只失效当前路径（不清整个会话，也不清别的目录）。
    cache.invalidatePath(options.sessionId, state.path)
    run(state.path, { refresh: true })
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    navigate,
    back() {
      if (disposed) return
      if (state.path === '') return // 根层 no-op
      run(parentTreePath(state.path))
    },
    refresh,
    retry: refresh,
    prefetch(path) {
      if (disposed || source === null) return
      const validation = validateTreePath(path)
      if (!validation.ok) return
      if (cache.get(options.sessionId, validation.path) !== undefined) return
      void loadTreeListing({ source, path: validation.path, cache, now }).catch(() => {
        // 预取失败静默（不弹错、不改状态）。
      })
    },
    peek(path) {
      const validation = validateTreePath(path)
      if (!validation.ok) return undefined
      return cache.get(options.sessionId, validation.path)
    },
    invalidatePath(path) {
      const validation = validateTreePath(path)
      if (validation.ok) cache.invalidatePath(options.sessionId, validation.path)
    },
    invalidateSession(sessionId) {
      cache.invalidateSession(sessionId)
    },
    get source() {
      return sourceKind
    },
    get canBack() {
      return state.path !== ''
    },
    dispose() {
      disposed = true
      generation += 1
      listeners.clear()
    },
  }
}

/* ------------------------------------------------------------------ *
 * 10. React 钩子（tab 直接用这个）
 * ------------------------------------------------------------------ */

export interface UseDirectoryTreeOptions {
  sessionId: string
  /** `props.remote` 门面（优先 `remote.workspaceFiles.list`）。 */
  remote?: unknown
  /** host 只读 fallback 用（同源 fetch；通常 `defaultFetch()`）。 */
  fetch?: FetchLike | null
  /**
   * 会话 cwd（绝对路径）。两个源都用它：
   * - remote 源：**根层 list 必须用它**（已安装 API 对空串 path 抛 `gateway/bad-request`）；
   * - host 源：只作参考（host 侧自己读 header 的 cwd，不接受客户端传 cwd 做放行依据）。
   */
  cwd?: string
  /** 初始目录，默认 `''`（根）。 */
  initialPath?: string
  cache?: TreeCache
  enabled?: boolean
  now?: () => number
}

/** hook 返回值（tab 只依赖这个形状）。 */
export interface DirectoryTreeView {
  state: TreeState
  /** `state.listing?.entries ?? []` 的快捷方式。 */
  entries: TreeEntry[]
  navigate(path: string): void
  back(): void
  refresh(): void
  retry(): void
  prefetch(path: string): void
  readonly source: 'remote' | 'host' | 'none'
  readonly canBack: boolean
  /** 不含根段的面包屑（根段由 UI 用 `tree.root` 渲染）。 */
  readonly breadcrumb: Array<{ name: string; path: string }>
  readonly truncated: boolean
}

/**
 * 目录树钩子。
 *
 * 首帧：缓存命中 → 直接拿到 listing（`ready`），**不出现整块 loading**（M3）；
 * 未命中 → `loading` 且 `state.listing` 保留上一份（navigate 时不空白）。
 * 切会话/换源会重建控制器（缓存按 sessionId+path 隔离，旧会话数据不串）。
 */
export function useDirectoryTree(options: UseDirectoryTreeOptions): DirectoryTreeView {
  const enabled = options.enabled !== false
  const cache = options.cache ?? sharedTreeCache
  const now = options.now ?? Date.now
  const initialPath = options.initialPath ?? ''
  const cwd = options.cwd ?? ''
  // 稳定身份：只用影响"选路/会话"的值做依赖，remote 门面在宿主侧是稳定对象。
  const treeKey = [
    options.sessionId,
    options.remote === undefined ? '' : 'remote',
    options.fetch === undefined || options.fetch === null ? '' : 'fetch',
    cwd,
    initialPath,
    enabled ? 'on' : 'off',
  ].join('\u0000')

  const engineRef = React.useRef<{ key: string; tree: DirectoryTree } | null>(null)
  if (engineRef.current === null || engineRef.current.key !== treeKey) {
    if (engineRef.current !== null) engineRef.current.tree.dispose()
    engineRef.current = {
      key: treeKey,
      tree: createDirectoryTree({
        sessionId: options.sessionId,
        ...(options.remote === undefined ? {} : { remote: options.remote }),
        ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
        ...(cwd === '' ? {} : { cwd }),
        initialPath,
        cache,
        enabled,
        now,
      }),
    }
  }
  const tree = engineRef.current.tree
  const [state, setState] = React.useState<TreeControllerState>(() => tree.getState())

  React.useEffect(() => {
    setState(tree.getState())
    return tree.subscribe(setState)
  }, [tree])

  // 首帧后（effect 里）才发第一次请求：SSR 渲染期不发请求（与 data/hooks.ts 同纪律）。
  React.useEffect(() => {
    if (!enabled) return
    const current = tree.getState()
    if (current.status === 'idle') tree.navigate(current.path)
  }, [tree, enabled])

  React.useEffect(() => () => tree.dispose(), [tree])

  const navigate = React.useCallback((path: string) => tree.navigate(path), [tree])
  const back = React.useCallback(() => tree.back(), [tree])
  const refresh = React.useCallback(() => tree.refresh(), [tree])
  const retry = React.useCallback(() => tree.retry(), [tree])
  const prefetch = React.useCallback((path: string) => tree.prefetch(path), [tree])

  return React.useMemo<DirectoryTreeView>(
    () => ({
      state: {
        sessionId: state.sessionId,
        path: state.path,
        status: state.status,
        listing: state.listing,
        error: state.error,
        errorCode: state.errorCode,
      },
      entries: state.listing === null ? [] : state.listing.entries,
      navigate,
      back,
      refresh,
      retry,
      prefetch,
      source: state.source,
      canBack: state.path !== '',
      breadcrumb: treeBreadcrumb(state.path),
      truncated: state.listing?.truncated === true,
    }),
    [state, navigate, back, refresh, retry, prefetch],
  )
}

/* ------------------------------------------------------------------ *
 * 11. 复用点（有测试守着，别绕开）
 * ------------------------------------------------------------------ */

/** 目录树用的 host 路由（由 host 侧 `ROUTE_PATHS` 派生校验；测试断言两者一致）。 */
export const TREE_ROUTE_PATH: string = routePath('tree')
