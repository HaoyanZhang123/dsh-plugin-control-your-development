/**
 * workspaceFiles 只读读取器：路径卡口 + 分页读取 + 大小/行数上限 + 显式状态。
 *
 * 为什么 cwd 卡口在这一层（02 §3.6、K4）：服务端读文件**允许工作区外路径**，
 * 只有插件自己按会话 `cwd` 做包含检查。因此：
 * - 只接受**工作区相对路径**；绝对路径直接拒绝（上层若要处理绝对路径，必须先转成相对）；
 * - 折叠 `.`/`..` 后越出 cwd → 拒绝；
 * - 每次 `stat`/`read` 的 `absolutePath` 都要再校验一次（服务端返回什么都要复核）。
 *
 * 不缓存正文（04 §6.3.4）；解析结果缓存见 `reference-source.ts`（按 `version` 失效）。
 */

import { containsPath, isAbsolutePath, normalizeRelative } from '../../shared/relations/path.ts'
import type {
  FileReadFailure,
  FileReadResult,
  FileReadState,
  PathRejectionReason,
  StatResult,
  WorkspaceFileLimits,
  WorkspaceFilesFace,
  WorkspaceReadRange,
} from './types.ts'
import { DEFAULT_WORKSPACE_FILE_LIMITS } from './types.ts'

export interface NormalizedWorkspacePath {
  ok: boolean
  path?: string
  reason?: PathRejectionReason
}

/** 把任意输入归一成工作区相对路径；绝对路径 / 越界 / 空路径一律拒绝。 */
export function normalizeWorkspacePath(input: string): NormalizedWorkspacePath {
  const trimmed = input.trim()
  if (trimmed === '') return { ok: false, reason: 'empty-path' }
  if (isAbsolutePath(trimmed)) return { ok: false, reason: 'absolute-path' }
  const normalized = normalizeRelative(trimmed)
  if (normalized.escaped) return { ok: false, reason: 'escape-cwd' }
  if (normalized.path === '') return { ok: false, reason: 'empty-path' }
  return { ok: true, path: normalized.path }
}

interface ErrorLike {
  code?: unknown
  message?: unknown
  name?: unknown
}

/** 把通道错误归类成显式状态（不猜成功，10 §2.2）。 */
export function classifyReadError(error: unknown): { state: Exclude<FileReadState, 'ok'>; reason: string } {
  const value = (error ?? {}) as ErrorLike
  const code = typeof value.code === 'string' ? value.code : ''
  const message = typeof value.message === 'string' ? value.message : String(error ?? '')
  const haystack = `${code} ${message}`.toLowerCase()
  if (haystack.includes('not-text') || haystack.includes('binary') || haystack.includes('nul')) {
    return { state: 'not-text', reason: code === '' ? 'not-text' : code }
  }
  if (haystack.includes('utf-8') || haystack.includes('utf8') || haystack.includes('invalid-encoding')) {
    return { state: 'invalid-utf8', reason: code === '' ? 'invalid-utf8' : code }
  }
  if (haystack.includes('not-found') || haystack.includes('not_found') || haystack.includes('enoent')) {
    return { state: 'missing', reason: code === '' ? 'not-found' : code }
  }
  if (haystack.includes('too-large') || haystack.includes('too_large') || haystack.includes('size-limit')) {
    return { state: 'too-large', reason: code === '' ? 'too-large' : code }
  }
  return { state: 'unreadable', reason: code === '' ? message.slice(0, 120) : code }
}

export interface WorkspaceFilesReaderOptions {
  files: WorkspaceFilesFace
  sessionId: string
  /** 会话 header 的 cwd（绝对路径）；包含检查的唯一依据。 */
  cwd: string
  limits?: Partial<WorkspaceFileLimits>
  caseInsensitive?: boolean
  signal?: AbortSignal
}

export interface WorkspaceFilesReader {
  readonly limits: WorkspaceFileLimits
  statPath(path: string): Promise<StatResult>
  readText(path: string): Promise<FileReadResult>
}

function rejection(reason: PathRejectionReason, path: string): FileReadFailure {
  return { status: 'failed', state: 'rejected', reason, path }
}

export function createWorkspaceFilesReader(options: WorkspaceFilesReaderOptions): WorkspaceFilesReader {
  const limits: WorkspaceFileLimits = { ...DEFAULT_WORKSPACE_FILE_LIMITS, ...options.limits }
  // 大小写策略：不传时交给 `containsPath` 的**自适应**判断——只有 Windows 风格路径
  // （盘符 / UNC）才折叠大小写；POSIX 路径（Linux/macOS）保持大小写敏感。
  // 强制 `?? true` 会把「工作区外、只差大小写」的路径误判为区内（安全缺陷）。
  const caseInsensitive = options.caseInsensitive

  function assertInside(absPath: string): boolean {
    return containsPath(options.cwd, absPath, caseInsensitive)
  }

  async function statPath(path: string): Promise<StatResult> {
    const normalized = normalizeWorkspacePath(path)
    if (!normalized.ok) return rejection(normalized.reason ?? 'empty-path', path)
    const relative = normalized.path as string
    let stat
    try {
      stat = await options.files.stat(options.sessionId, relative, options.signal)
    } catch (error) {
      const classified = classifyReadError(error)
      return { status: 'failed', state: classified.state, reason: classified.reason, path: relative }
    }
    if (typeof stat !== 'object' || stat === null || typeof stat.absolutePath !== 'string') {
      return { status: 'failed', state: 'unreadable', reason: 'bad-stat', path: relative }
    }
    if (!assertInside(stat.absolutePath)) {
      // 服务端说它在 cwd 外 → 我们不读工作区外（N-07）。
      return rejection('outside-cwd', relative)
    }
    return {
      status: 'ok',
      path: relative,
      absolutePath: stat.absolutePath,
      version: String(stat.version ?? ''),
      ...(stat.bytes === undefined ? {} : { bytes: stat.bytes }),
    }
  }

  async function readText(path: string): Promise<FileReadResult> {
    const statResult = await statPath(path)
    if (statResult.status !== 'ok') return statResult
    if (statResult.bytes !== undefined && statResult.bytes > limits.maxBytes) {
      return {
        status: 'failed',
        state: 'too-large',
        reason: `bytes>${limits.maxBytes}`,
        path: statResult.path,
        absolutePath: statResult.absolutePath,
        version: statResult.version,
        bytes: statResult.bytes,
      }
    }

    let offset = 1
    let text = ''
    let lines = 0
    let pages = 0
    let truncated = false
    let sawEof = false

    while (pages < limits.pagesPerFile) {
      const range: WorkspaceReadRange = { offset, limit: limits.pageLines }
      let page
      try {
        page = await options.files.read(options.sessionId, statResult.path, range, options.signal)
      } catch (error) {
        const classified = classifyReadError(error)
        return {
          status: 'failed',
          state: classified.state,
          reason: classified.reason,
          path: statResult.path,
          absolutePath: statResult.absolutePath,
          version: statResult.version,
        }
      }
      if (typeof page !== 'object' || page === null || typeof page.text !== 'string') {
        return {
          status: 'failed',
          state: 'unreadable',
          reason: 'bad-page',
          path: statResult.path,
          absolutePath: statResult.absolutePath,
          version: statResult.version,
        }
      }
      if (!assertInside(page.absolutePath)) return rejection('outside-cwd', statResult.path)

      pages += 1
      const pageLines = typeof page.lines === 'number' ? page.lines : 0
      if (text !== '' && !text.endsWith('\n') && page.text !== '') text += '\n'
      text += page.text
      lines += pageLines
      if (page.eof === true) {
        sawEof = true
        break
      }
      if (pageLines <= 0) break
      offset = (typeof page.offset === 'number' ? page.offset : offset) + pageLines
      if (lines >= limits.maxLines) {
        truncated = true
        break
      }
    }

    // 没读到 eof 就停下 = 被页数/行数上限截断，必须显式标记（N-10）。
    if (!sawEof) truncated = true
    if (text.includes('\u0000')) {
      return {
        status: 'failed',
        state: 'not-text',
        reason: 'contains-nul',
        path: statResult.path,
        absolutePath: statResult.absolutePath,
        version: statResult.version,
      }
    }

    return {
      status: 'ok',
      path: statResult.path,
      absolutePath: statResult.absolutePath,
      version: statResult.version,
      ...(statResult.bytes === undefined ? {} : { bytes: statResult.bytes }),
      text,
      lines,
      truncated,
      pages,
    }
  }

  return { limits, statPath, readText }
}
