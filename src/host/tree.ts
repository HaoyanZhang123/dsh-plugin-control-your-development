/**
 * src/host/tree.ts —— **B1：host 只读目录列表 fallback**（用户已批准；01 §7 B1 / 03 R02 / 04 §2 M4）。
 *
 * 为什么存在：真机 `remote.workspaceFiles.list` 可能不可用（02 §G/§K1），右栏必须仍能从
 * 工作区根逐层列出目录。用户明确批准这条**只读例外**：读 fs、零写。
 *
 * 硬要求（逐条对应 03 R02 / 04 §5 停点）：
 * 1. **只读**：只用 `readdir` / `lstat` / `realpath`（`node:fs/promises` 只读面）。
 *    本文件不出现任何写 API（构建门禁 `tools/build.mjs` 的 fs 黑名单同向守着）。
 * 2. **只接受工作区相对路径**（空串 = 根）：绝对路径、`..`、控制字符、超长一律拒。
 * 3. **按会话 cwd 做包含检查**：目标（以及符号链接解析后的真实路径）必须仍在 cwd 内。
 * 4. **不跟随逃逸符号链接**：逃逸的条目标成 `other` 并计数（可见但不可进入），不读其内容。
 * 5. **条目上限 + truncated**：先按名字取确定性前缀再 `lstat`（限制 syscall 数量）。
 * 6. **日志只打错误码/计数，不打路径/正文**。
 *
 * 不做的事：不递归（一次一层）、不读文件正文、不排序成 UI 顺序（排序在客户端唯一实现
 * `client/data/tree.ts` 里做；host 只保证确定性输入）。
 */
import { lstat, readdir, realpath } from 'node:fs/promises'
import type { SessionHeaderLite } from '../shared/events/index.ts'
import { isAbsoluteCwd, normalizeCwd } from '../shared/events/index.ts'
import { containsPath, isAbsolutePath, normalizeRelative, toPosix, trimTrailingSlash } from '../shared/relations/path.ts'
import type { LoggerLike, PersistenceLike } from './services.ts'

/* ------------------------------------------------------------------ *
 * 1. 形状（wire 契约；与 client/files/types.ts 的 WorkspaceDirectoryEntry 同构，
 *    两侧都是"宿主协议"的镜像，路由/客户端测试会断言它们一致）
 * ------------------------------------------------------------------ */

/** 条目类型：`other` = 非普通文件/非目录，或为**逃逸符号链接**（不可进入）。 */
export type HostTreeKind = 'file' | 'directory' | 'other'

export interface HostTreeEntry {
  readonly name: string
  readonly type: HostTreeKind
  readonly size?: number
}

export interface HostTreeListing {
  /** 请求的工作区相对路径（`''` = 根）。 */
  readonly path: string
  readonly entries: HostTreeEntry[]
  readonly truncated: boolean
}

/** `POST /api/dsh-threadline/tree` 的请求体。 */
export interface TreeRequest {
  sessionId: string
  /** 工作区相对路径；`''` = 根。 */
  path: string
}

/** 单目录条目上限（超出 → `truncated=true`）。 */
export const HOST_TREE_ENTRY_LIMIT = 2000

/** 工作区相对路径长度上限。 */
export const HOST_TREE_MAX_PATH_LENGTH = 1024

/* ------------------------------------------------------------------ *
 * 2. 可注入的只读 fs 面（真实实现 + 单测假实现）
 * ------------------------------------------------------------------ */

export interface TreeDirEntryLike {
  name: string
  isDirectory(): boolean
  isFile(): boolean
  isSymbolicLink(): boolean
}

export interface TreeStatLike {
  isDirectory(): boolean
  isFile(): boolean
  isSymbolicLink(): boolean
  size: number
}

/** **只读**文件系统面（无写能力 = 该例外不会越界）。 */
export interface TreeFsLike {
  readdir(path: string): Promise<TreeDirEntryLike[]>
  lstat(path: string): Promise<TreeStatLike>
  realpath(path: string): Promise<string>
}

function fsErrorCode(error: unknown): string {
  const value = (error ?? {}) as { code?: unknown }
  return typeof value.code === 'string' ? value.code : ''
}

/** 真实只读 fs 面（`readdir` 用 withFileTypes；Dirent 的方法等价于该条目的 lstat 结果）。 */
export const realTreeFs: TreeFsLike = {
  async readdir(path: string): Promise<TreeDirEntryLike[]> {
    const entries = await readdir(path, { withFileTypes: true })
    return entries.map((entry) => ({
      name: entry.name,
      isDirectory: () => entry.isDirectory(),
      isFile: () => entry.isFile(),
      isSymbolicLink: () => entry.isSymbolicLink(),
    }))
  },
  async lstat(path: string): Promise<TreeStatLike> {
    const stat = await lstat(path)
    return {
      isDirectory: () => stat.isDirectory(),
      isFile: () => stat.isFile(),
      isSymbolicLink: () => stat.isSymbolicLink(),
      size: stat.size,
    }
  },
  realpath(path: string): Promise<string> {
    return realpath(path)
  },
}

/* ------------------------------------------------------------------ *
 * 3. 路径校验（纯函数；拒绝理由只给机器码）
 * ------------------------------------------------------------------ */

export type TreePathReason = 'empty-path' | 'too-long' | 'invalid-chars' | 'absolute-path' | 'escape-cwd'

export type TreePathValidation = { ok: true; path: string } | { ok: false; reason: TreePathReason }

function hasControlChars(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code < 0x20 || code === 0x7f) return true
  }
  return false
}

/**
 * 校验工作区相对目录路径（`''` = 根）。
 *
 * 与客户端 `validateTreePath` 的差别：这里**更严**——任何 `..` 段一律拒绝
 * （客户端先折叠，所以合法导航不会被拒；host 侧多一层纵深防御）。
 */
export function validateTreeRelativePath(input: unknown): TreePathValidation {
  if (typeof input !== 'string') return { ok: false, reason: 'empty-path' }
  const trimmed = input.trim()
  if (trimmed === '') return { ok: true, path: '' }
  if (trimmed.length > HOST_TREE_MAX_PATH_LENGTH) return { ok: false, reason: 'too-long' }
  if (hasControlChars(trimmed)) return { ok: false, reason: 'invalid-chars' }
  if (isAbsolutePath(trimmed)) return { ok: false, reason: 'absolute-path' }
  const posix = toPosix(trimmed)
  // `..` 段一律拒（不做折叠后放行：host 不接受任何"往上走"的输入）。
  if (posix.split('/').some((segment) => segment === '..')) return { ok: false, reason: 'escape-cwd' }
  const normalized = normalizeRelative(posix)
  if (normalized.escaped) return { ok: false, reason: 'escape-cwd' }
  return { ok: true, path: normalized.path }
}

/**
 * 目标是否仍在 cwd 内（含 cwd 本身）。
 *
 * **跨平台大小写**：默认交给**自适应**判断 —— 只有 Windows 风格路径（盘符 / UNC）才折叠大小写；
 * POSIX 路径（Linux/macOS）**保持大小写敏感**。
 *
 * 为什么不能简单默认 true：Linux/macOS 的文件系统区分大小写，`/repo` 与 `/Repo` 是**两个目录**。
 * 强制折叠会把「工作区外、只差大小写」的路径误判为工作区内 → 越界放行（安全缺陷）。
 * 调用方只有在**明确知道**目标平台不区分大小写时才传 `true`。
 */
export function isInsideCwd(cwd: string, target: string, caseInsensitive?: boolean): boolean {
  const base = trimTrailingSlash(cwd)
  const value = trimTrailingSlash(target)
  if (base === '' || value === '') return false
  const fold = caseInsensitive ?? (needsCaseFoldHost(base) || needsCaseFoldHost(value))
  const left = fold ? toPosix(base).toLowerCase() : toPosix(base)
  const right = fold ? toPosix(value).toLowerCase() : toPosix(value)
  if (left === right) return true
  return containsPath(base, value, fold)
}

/**
 * 该路径是否属于「需要折叠大小写」的平台形态：Windows 盘符（`C:` / `C:/`）或 UNC（`//server`）。
 * 与 `shared/relations/path.ts` 的 `needsCaseFold` 同口径（那边是私有函数，这里需要复用）。
 */
function needsCaseFoldHost(path: string): boolean {
  const posix = toPosix(path)
  return /^[a-zA-Z]:/.test(posix) || posix.startsWith('//')
}

/** 工作区相对路径 → 绝对路径（POSIX 分隔符；cwd 已归一）。 */
export function absoluteTreePath(cwd: string, relative: string): string {
  const base = trimTrailingSlash(toPosix(normalizeCwd(cwd)))
  const rest = normalizeRelative(relative).path
  return rest === '' ? base : `${base}/${rest}`
}

/* ------------------------------------------------------------------ *
 * 4. 会话 cwd（只读 header；不新增持久化）
 * ------------------------------------------------------------------ */

/**
 * 读会话 header 的 cwd（只读）。
 * 优先 `persistence.stat(id).header`（不打开句柄）；没有 stat 时用只读句柄取 header 再关。
 * 任何失败 → undefined（上层给显式错误码，不猜 cwd）。
 */
export async function readTreeSessionCwd(
  persistence: PersistenceLike | undefined,
  sessionId: string,
): Promise<string | undefined> {
  if (persistence === undefined) return undefined
  try {
    if (typeof persistence.stat === 'function') {
      const stat = await persistence.stat(sessionId)
      const cwd = (stat?.header as SessionHeaderLite | undefined)?.cwd
      if (typeof cwd === 'string' && cwd !== '') return cwd
    }
    const handle = await persistence.open(sessionId, 'read')
    try {
      const cwd = handle.header?.cwd
      return typeof cwd === 'string' && cwd !== '' ? cwd : undefined
    } finally {
      await handle.close?.()
    }
  } catch {
    return undefined
  }
}

/* ------------------------------------------------------------------ *
 * 5. 列目录
 * ------------------------------------------------------------------ */

export type TreeListFailureCode = 'rejected-path' | 'outside-cwd' | 'not-found' | 'not-directory' | 'unreadable'

export type TreeListResult =
  | {
      ok: true
      listing: HostTreeListing
      /** 被跳过的逃逸符号链接数（只进日志/测试，不进响应正文）。 */
      escapedLinks: number
    }
  | { ok: false; code: TreeListFailureCode; reason: TreePathReason | 'not-found' | 'not-directory' | 'unreadable' | 'outside-cwd' }

export interface ListTreeDirectoryInput {
  /** 会话 cwd（绝对路径；包含检查的唯一依据）。 */
  cwd: string
  /** 请求的工作区相对路径（`''` = 根）。 */
  path: string
  fs?: TreeFsLike
  limit?: number
  caseInsensitive?: boolean
}

/** 名字的确定性比较（码位序；与客户端排序无关，只用于裁剪前缀的确定性）。 */
function compareNames(left: string, right: string): number {
  const a = left.toLowerCase()
  const b = right.toLowerCase()
  if (a !== b) return a < b ? -1 : 1
  return left < right ? -1 : left > right ? 1 : 0
}

/**
 * 只读列出一个工作区目录（一层）。
 *
 * 流程：校验路径 → 绝对化 + cwd 包含检查 → realpath 校验（防符号链接逃逸）→
 * readdir → 名称排序取确定性前缀（≤ limit）→ 逐个分类（符号链接额外 realpath 校验）。
 */
export async function listTreeDirectory(input: ListTreeDirectoryInput): Promise<TreeListResult> {
  const fs = input.fs ?? realTreeFs
  const limit = Math.max(1, Math.trunc(input.limit ?? HOST_TREE_ENTRY_LIMIT))
  // 大小写策略：不传时交给 `isInsideCwd` 的自适应判断（Windows 折叠、POSIX 敏感）。
  // 见 `isInsideCwd` 的注释：Linux/macOS 上强制折叠会把「只差大小写的工作区外路径」误判为区内。
  const caseInsensitive = input.caseInsensitive

  const validation = validateTreeRelativePath(input.path)
  if (!validation.ok) return { ok: false, code: 'rejected-path', reason: validation.reason }
  const relative = validation.path

  const cwd = normalizeCwd(input.cwd)
  if (cwd === '' || !isAbsoluteCwd(cwd)) return { ok: false, code: 'unreadable', reason: 'unreadable' }

  const absolute = absoluteTreePath(cwd, relative)
  // 1) 字面包含检查（防 `..`/绝对路径——上面已拒，这里是第二道）。
  if (!isInsideCwd(cwd, absolute, caseInsensitive)) {
    return { ok: false, code: 'outside-cwd', reason: 'outside-cwd' }
  }

  // 2) 真实路径检查：cwd 与目标都 realpath 后仍须包含（防符号链接指向工作区外）。
  let realBase: string
  let realTarget: string
  try {
    realBase = await fs.realpath(cwd)
  } catch (error) {
    return { ok: false, code: 'unreadable', reason: fsErrorCode(error) === 'ENOENT' ? 'not-found' : 'unreadable' }
  }
  try {
    realTarget = await fs.realpath(absolute)
  } catch (error) {
    const code = fsErrorCode(error)
    if (code === 'ENOENT') return { ok: false, code: 'not-found', reason: 'not-found' }
    if (code === 'ENOTDIR') return { ok: false, code: 'not-directory', reason: 'not-directory' }
    return { ok: false, code: 'unreadable', reason: 'unreadable' }
  }
  if (!isInsideCwd(realBase, realTarget, caseInsensitive)) {
    return { ok: false, code: 'outside-cwd', reason: 'outside-cwd' }
  }

  // 3) 必须是目录（`lstat` 而非 `stat`：符号链接本身不是目录；真实目标已校验在内）。
  try {
    const stat = await fs.lstat(absolute)
    if (stat.isSymbolicLink()) {
      const targetStat = await fs.lstat(realTarget)
      if (!targetStat.isDirectory()) return { ok: false, code: 'not-directory', reason: 'not-directory' }
    } else if (!stat.isDirectory()) {
      return { ok: false, code: 'not-directory', reason: 'not-directory' }
    }
  } catch (error) {
    const code = fsErrorCode(error)
    if (code === 'ENOENT') return { ok: false, code: 'not-found', reason: 'not-found' }
    if (code === 'ENOTDIR') return { ok: false, code: 'not-directory', reason: 'not-directory' }
    return { ok: false, code: 'unreadable', reason: 'unreadable' }
  }

  // 4) readdir（withFileTypes：Dirent 的类型判断等价于该条目自身的 lstat）。
  let raw: TreeDirEntryLike[]
  try {
    raw = await fs.readdir(absolute)
  } catch (error) {
    const code = fsErrorCode(error)
    if (code === 'ENOENT') return { ok: false, code: 'not-found', reason: 'not-found' }
    if (code === 'ENOTDIR') return { ok: false, code: 'not-directory', reason: 'not-directory' }
    return { ok: false, code: 'unreadable', reason: 'unreadable' }
  }

  const sorted = raw
    .filter((entry) => typeof entry?.name === 'string' && entry.name !== '' && entry.name !== '.' && entry.name !== '..')
    .slice()
    .sort((left, right) => compareNames(left.name, right.name))
  const truncated = sorted.length > limit
  const visible = truncated ? sorted.slice(0, limit) : sorted

  const entries: HostTreeEntry[] = []
  let escapedLinks = 0
  for (const entry of visible) {
    const entryAbsolute = absolute.endsWith('/') ? absolute + entry.name : `${absolute}/${entry.name}`
    if (entry.isSymbolicLink()) {
      // 符号链接：解析真实目标；逃逸 → 标 other + 计数（可见但不可进入，绝不读其内容）。
      let target: string
      try {
        target = await fs.realpath(entryAbsolute)
      } catch {
        entries.push({ name: entry.name, type: 'other' })
        escapedLinks += 1
        continue
      }
      if (!isInsideCwd(realBase, target, caseInsensitive)) {
        entries.push({ name: entry.name, type: 'other' })
        escapedLinks += 1
        continue
      }
      try {
        const stat = await fs.lstat(target)
        if (stat.isDirectory()) {
          entries.push({ name: entry.name, type: 'directory' })
        } else if (stat.isFile()) {
          entries.push({ name: entry.name, type: 'file', size: normalizeSize(stat.size) })
        } else {
          entries.push({ name: entry.name, type: 'other' })
        }
      } catch {
        entries.push({ name: entry.name, type: 'other' })
      }
      continue
    }
    if (entry.isDirectory()) {
      entries.push({ name: entry.name, type: 'directory' })
      continue
    }
    if (entry.isFile()) {
      // size 只对普通文件取（一次 lstat；目录不取，避免伪造 0）。
      try {
        const stat = await fs.lstat(entryAbsolute)
        const item: HostTreeEntry = { name: entry.name, type: 'file' }
        const size = normalizeSize(stat.size)
        entries.push(size === undefined ? item : { ...item, size })
      } catch {
        entries.push({ name: entry.name, type: 'file' })
      }
      continue
    }
    entries.push({ name: entry.name, type: 'other' })
  }

  return { ok: true, listing: { path: relative, entries, truncated }, escapedLinks }
}

function normalizeSize(size: unknown): number | undefined {
  return typeof size === 'number' && Number.isFinite(size) && size >= 0 ? Math.trunc(size) : undefined
}

/* ------------------------------------------------------------------ *
 * 6. 路由层用的薄封装（读 cwd + 列目录 + 日志纪律）
 * ------------------------------------------------------------------ */

export interface TreeHostDeps {
  getPersistence(): PersistenceLike | undefined
  logger?: LoggerLike
  fs?: TreeFsLike
}

export type TreeHostResponse =
  | { ok: true; path: string; entries: HostTreeEntry[]; truncated: boolean }
  | { ok: false; code: 'threadline/capability-missing' | 'threadline/session-unreadable' | 'threadline/bad-request' | 'threadline/internal'; message: string; detail?: string }

/**
 * 处理一次 tree 请求（路由 handler 只做校验 + 调它）。
 *
 * 错误码约定（客户端 `data/tree.ts` 的 `hostErrorCode` 按 `detail` 分类）：
 * - 路径被拒 → `bad-request` + detail ∈ absolute-path/escape-cwd/invalid-chars/too-long/empty-path
 * - 越界 → `bad-request` + detail `outside-cwd`
 * - 不存在/不是目录 → `bad-request` + detail `not-found` / `not-directory`
 * - 不可读 → `internal` + detail `unreadable`
 * - 无 persistence → `capability-missing`；会话 header 无 cwd → `session-unreadable`
 */
export async function handleTreeRequest(deps: TreeHostDeps, request: TreeRequest): Promise<TreeHostResponse> {
  const sessionId = request.sessionId
  const cwd = await readTreeSessionCwd(deps.getPersistence(), sessionId)
  if (cwd === undefined) {
    const persistence = deps.getPersistence()
    if (persistence === undefined) return { ok: false, code: 'threadline/capability-missing', message: 'session persistence unavailable' }
    return { ok: false, code: 'threadline/session-unreadable', message: 'session cwd unavailable' }
  }

  const result = await listTreeDirectory({
    cwd,
    path: request.path ?? '',
    ...(deps.fs === undefined ? {} : { fs: deps.fs }),
  })

  if (!result.ok) {
    // 日志只打错误码，不打路径（04 §2.1 / 03 R02）。
    deps.logger?.warn?.('threadline: tree request failed (' + result.code + ')')
    if (result.code === 'unreadable') {
      return { ok: false, code: 'threadline/internal', message: 'tree read failed', detail: 'unreadable' }
    }
    return { ok: false, code: 'threadline/bad-request', message: 'tree request rejected', detail: result.reason }
  }

  if (result.escapedLinks > 0) {
    deps.logger?.warn?.('threadline: tree skipped escaping links (' + String(result.escapedLinks) + ')')
  }
  return {
    ok: true,
    path: result.listing.path,
    entries: result.listing.entries,
    truncated: result.listing.truncated,
  }
}
