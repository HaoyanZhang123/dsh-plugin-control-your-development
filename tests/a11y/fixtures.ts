/*
 * tests/a11y/fixtures.ts —— T10 的合成数据（与 T07/T08 的同口径字段，但不依赖他们的夹具）。
 *
 * 全部为**合成数据**：路径是编造的、会话 id 是编造的、没有真实用户内容（03 §12.3 隐私纪律）。
 */
import type { CommandRecord, FileNode, ThreadlineStatus } from '../../src/shared/events/index.ts'
import type { TurnInput } from '../../src/client/a11y/listModel.ts'

let seq = 0

export function fileNode(overrides: Partial<FileNode> & { path: string }): FileNode {
  seq += 1
  const { path, ...rest } = overrides
  const name = path.slice(path.lastIndexOf('/') + 1)
  return {
    path,
    name,
    dir: path.slice(0, Math.max(0, path.lastIndexOf('/'))),
    family: 'code',
    firstAt: 1_700_000_000_000 + seq * 1000,
    lastAt: 1_700_000_900_000 + seq * 1000,
    reads: 3,
    writes: 1,
    searches: 0,
    added: 10,
    removed: 2,
    ops: 4,
    sessionIds: ['s-1'],
    sessionCount: 1,
    turnCount: 2,
    ...rest,
  }
}

/** 三个文件：顶层目录不同，便于验证"隐私模式只剩 basename"。 */
export const FILES: FileNode[] = [
  fileNode({ path: 'src/client/ui/shell/Shell.ts', name: 'Shell.ts', dir: 'src/client/ui/shell', family: 'code', ops: 18 }),
  fileNode({ path: 'notes/31-交接/03-产品与交互规格.md', name: '03-产品与交互规格.md', dir: 'notes/31-交接', family: 'doc', ops: 9 }),
  fileNode({ path: 'data/fixture.json', name: 'fixture.json', dir: 'data', family: 'data', ops: 2 }),
]

export const TURNS: TurnInput[] = [
  { turn: 1, status: 'completed', files: 3, commands: 1, errors: 0, durationMs: 42_000, sessionId: 's-1' },
  { turn: 2, status: 'aborted', files: 1, commands: 0, errors: 2, durationMs: null, sessionId: 's-1' },
  { turn: 3, status: 'running', files: 2, commands: 4, errors: 0, durationMs: 5_000, sessionId: 's-1' },
  { turn: 4, status: 'unknown', files: 0, commands: 0, errors: 0, durationMs: 0, sessionId: 's-1' },
]

export function commandRecord(overrides: Partial<CommandRecord> = {}): CommandRecord {
  return {
    id: 'cmd-1',
    tool: 'shell',
    program: 'pnpm',
    text: 'pnpm test --filter threadline',
    status: 'success',
    startedAt: 1_700_000_000_000,
    endedAt: 1_700_000_042_000,
    durationMs: 42_000,
    ...overrides,
  }
}

/** 会话标题样本：带真实感的合成标题（不是用户内容）。 */
export const SESSION_SAMPLE = { sessionId: 's-abcdef123456', title: '修复读模型指纹' }

export const STATUSES: readonly ThreadlineStatus[] = ['running', 'completed', 'aborted', 'unknown']
