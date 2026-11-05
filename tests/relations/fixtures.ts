/**
 * 测试夹具：内存版 workspaceFiles 通道 + events 正式类型的构造函数。
 *
 * 这里**不读磁盘**：`stat` / `read` 都是假实现，正好覆盖“注入式依赖、单测用假实现”的要求。
 * cwd 用 Windows 风格路径，用来验证 Windows 身份键（大小写不敏感）与包含检查。
 *
 * 测试命令（Node 24.22.1 **不支持** `node --test <目录>` 实参，会把目录当模块加载）：
 *   node --test "tests/relations/*.test.ts"
 */

import type { FileNode, FileOp, TurnDetail, TurnFile } from '../../src/shared/events/index.ts'
import type { RelationTurn } from '../../src/shared/relations/index.ts'
import type {
  WorkspaceFileStat,
  WorkspaceFilesFace,
  WorkspaceFileText,
  WorkspaceReadRange,
} from '../../src/client/files/types.ts'

export const CWD = 'E:/work/demo'

/**
 * 构造 `events.FileNode`（04 §4.2 正式类型，关系引擎直接吃它，不另造结构）。
 * 只写测试关心的字段，其余给确定性的默认值。
 */
export function fileNode(path: string, overrides: Partial<FileNode> = {}): FileNode {
  const index = path.lastIndexOf('/')
  return {
    path,
    name: index < 0 ? path : path.slice(index + 1),
    dir: index < 0 ? '' : path.slice(0, index),
    family: 'text',
    firstAt: 0,
    lastAt: 0,
    reads: 0,
    writes: 0,
    searches: 0,
    added: 0,
    removed: 0,
    ops: 0,
    sessionIds: [],
    sessionCount: 0,
    turnCount: 0,
    ...overrides,
  }
}

/** 构造 `events.TurnFile`（`ops` 是操作类型列表，不是次数）。 */
export function turnFile(path: string, ops: FileOp[] = ['read'], overrides: Partial<TurnFile> = {}): TurnFile {
  return { path, ops, added: 0, removed: 0, ...overrides }
}

/** 构造 `events.TurnDetail`（关系引擎通过 `turnFromDetail()` 适配成 `RelationTurn`）。 */
export function turnDetail(n: number, files: TurnFile[], overrides: Partial<TurnDetail> = {}): TurnDetail {
  return {
    n,
    start: 0,
    status: 'completed',
    files,
    commands: [],
    subagents: [],
    errors: 0,
    toolCalls: 0,
    toolFailures: 0,
    messageIds: [],
    ...overrides,
  }
}

/** 构造关系引擎的轮次输入（`sessionId` + 轮次号 + 轮次文件）。 */
export function turn(sessionId: string, n: number, files: TurnFile[]): RelationTurn {
  return { sessionId, turn: n, files }
}

export interface FakeFileEntry {
  text?: string
  version?: string
  bytes?: number
  /** 覆盖返回的绝对路径（用来验证“服务端返回工作区外路径”时本层是否拒绝）。 */
  absolutePath?: string
  /** 让 stat/read 抛错（二进制、无效 UTF-8、不可读都走这里）。 */
  error?: { code: string; message?: string }
}

export interface FakeWorkspaceFiles {
  face: WorkspaceFilesFace
  statCalls: string[]
  readCalls: string[]
  setFile(path: string, entry: FakeFileEntry): void
}

function pageOf(text: string, range?: WorkspaceReadRange): Omit<WorkspaceFileText, 'absolutePath' | 'version'> {
  const offset = range?.offset ?? 1
  const limit = range?.limit ?? 500
  const lines = text.split('\n')
  const start = Math.max(0, offset - 1)
  const slice = lines.slice(start, start + limit)
  const eof = start + limit >= lines.length
  return {
    offset,
    text: slice.join('\n'),
    lines: slice.length,
    eof,
  }
}

export function createFakeWorkspaceFiles(entries: Record<string, FakeFileEntry> = {}): FakeWorkspaceFiles {
  const files = new Map<string, FakeFileEntry>()
  for (const [path, entry] of Object.entries(entries)) files.set(path, entry)
  const statCalls: string[] = []
  const readCalls: string[] = []

  const lookup = (path: string): FakeFileEntry | undefined => {
    if (files.has(path)) return files.get(path)
    const lower = path.toLowerCase()
    for (const [key, value] of files) {
      if (key.toLowerCase() === lower) return value
    }
    return undefined
  }

  const face: WorkspaceFilesFace = {
    async stat(_sessionId: string, path: string): Promise<WorkspaceFileStat> {
      statCalls.push(path)
      const entry = lookup(path)
      if (entry === undefined) {
        const error = new Error(`workspace-file/not-found: ${path}`) as Error & { code: string }
        error.code = 'workspace-file/not-found'
        throw error
      }
      if (entry.error !== undefined) {
        const error = new Error(entry.error.message ?? entry.error.code) as Error & { code: string }
        error.code = entry.error.code
        throw error
      }
      return {
        absolutePath: entry.absolutePath ?? `${CWD}/${path}`,
        version: entry.version ?? 'v1',
        ...(entry.bytes === undefined ? {} : { bytes: entry.bytes }),
      }
    },
    async read(_sessionId: string, path: string, range?: WorkspaceReadRange): Promise<WorkspaceFileText> {
      readCalls.push(path)
      const entry = lookup(path)
      if (entry === undefined) {
        const error = new Error(`workspace-file/not-found: ${path}`) as Error & { code: string }
        error.code = 'workspace-file/not-found'
        throw error
      }
      if (entry.error !== undefined) {
        const error = new Error(entry.error.message ?? entry.error.code) as Error & { code: string }
        error.code = entry.error.code
        throw error
      }
      const text = entry.text ?? ''
      return {
        absolutePath: entry.absolutePath ?? `${CWD}/${path}`,
        version: entry.version ?? 'v1',
        ...(entry.bytes === undefined ? {} : { bytes: entry.bytes }),
        ...pageOf(text, range),
      }
    },
  }

  return {
    face,
    statCalls,
    readCalls,
    setFile(path: string, entry: FakeFileEntry): void {
      files.set(path, entry)
    },
  }
}

/** 按类型取边（测试里只关心某一层时用）。 */
export function edgesOfType<T extends { type: string }>(edges: readonly T[], type: string): T[] {
  return edges.filter((edge) => edge.type === type)
}

/** 节点度数（按小写路径）。 */
export function degreeMap(edges: readonly { from: string; to: string }[]): Map<string, number> {
  const degrees = new Map<string, number>()
  for (const edge of edges) {
    for (const node of [edge.from.toLowerCase(), edge.to.toLowerCase()]) {
      degrees.set(node, (degrees.get(node) ?? 0) + 1)
    }
  }
  return degrees
}
