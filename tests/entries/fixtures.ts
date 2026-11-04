/*
 * tests/entries/fixtures.ts —— T09 的确定性夹具（合成记录，不含真实会话内容）。
 *
 * 只造"入口真的会读"的字段：`messageTurns` / `finalMessageId` / 轮次文件与命令 / 子智能体。
 * 时间戳固定，截图与断言共用。
 */
import type { CommandRecord, SessionDetail, TurnDetail, TurnFile } from '../../src/shared/events/index.ts'
import type { SessionRow, WorkspaceItem } from '../../src/client/data/index.ts'
import type { SessionSummary } from '../../src/shared/events/index.ts'

export const SESSION_ID = 'sess-t09'
export const BASE_TIME = new Date(2026, 10, 4, 9, 41, 0, 0).getTime()
const MINUTE = 60_000

function file(path: string, ops: TurnFile['ops'], added = 0, removed = 0): TurnFile {
  return { path, ops, added, removed }
}

function command(id: string, program: string, status: CommandRecord['status'], durationMs: number, text: string): CommandRecord {
  return { id, tool: 'shell', program, status, startedAt: BASE_TIME, durationMs, text }
}

/** 三轮：T1 有文件+命令，T2 只有错误（n=1），T3 运行中（无影响 → 不渲染"影响 0"）。 */
export function buildTurns(): TurnDetail[] {
  return [
    {
      n: 1,
      start: BASE_TIME,
      end: BASE_TIME + 5 * MINUTE,
      status: 'completed',
      endKind: 'completed',
      files: [
        file('src/client/data/merge.ts', ['write'], 24, 3),
        file('src/client/data/scope.ts', ['read']),
        file('docs/facts/read-model.md', ['write'], 8, 0),
      ],
      commands: [command('c-1', 'pnpm', 'success', 42_000, 'pnpm test')],
      subagents: ['agent-reviewer'],
      errors: 0,
      toolCalls: 6,
      toolFailures: 0,
      messageIds: ['m-1a', 'm-1b'],
      finalMessageId: 'm-1b',
      userText: '先把 merge 与 scope 的字段对齐',
      assistantText: '已对齐并跑了测试',
    },
    {
      n: 2,
      start: BASE_TIME + 6 * MINUTE,
      end: BASE_TIME + 7 * MINUTE,
      status: 'aborted',
      endKind: 'aborted',
      files: [],
      commands: [],
      subagents: [],
      errors: 1,
      toolCalls: 2,
      toolFailures: 1,
      messageIds: ['m-2a'],
      finalMessageId: 'm-2a',
    },
    {
      // 没有 end / finalMessageId：运行中，且没有任何影响（不应渲染）
      n: 3,
      start: BASE_TIME + 8 * MINUTE,
      status: 'running',
      files: [],
      commands: [],
      subagents: [],
      errors: 0,
      toolCalls: 1,
      toolFailures: 0,
      messageIds: ['m-3a'],
    },
  ]
}

export function buildDetail(): SessionDetail {
  const turns = buildTurns()
  return {
    id: SESSION_ID,
    rootId: SESSION_ID,
    title: '修复读模型指纹',
    cwd: 'E:/DSH/workspaces/myself/skill开发',
    startedAt: BASE_TIME,
    updatedAt: BASE_TIME + 9 * MINUTE,
    model: 'deepseek-v4.1-flash',
    provider: 'deepseek',
    status: 'running',
    running: true,
    turns,
    subagents: [
      { id: 'agent-reviewer', title: 'reviewer', status: 'completed' },
      { id: 'agent-tester', title: 'tester', status: 'running' },
    ],
    messageTurns: { 'm-1a': 1, 'm-1b': 1, 'm-2a': 2, 'm-3a': 3 },
    errors: ['turn 2: aborted-by-user'],
    counts: { turns: 3, steps: 0, toolCalls: 9, toolFailures: 1, files: 3, commands: 1, subagents: 2, errors: 1 },
    jobs: [],
  }
}

/** 没有 finalMessageId 的一轮（验证"按 turn 去重到 messageIds 最后一条"）。 */
export function buildTurnWithoutFinal(): TurnDetail {
  const base = buildTurns()[0]
  const { finalMessageId: _final, ...rest } = base
  return { ...rest, messageIds: ['m-1a', 'm-1b'] }
}

export function buildSessionRows(): SessionRow[] {
  return [
    {
      id: SESSION_ID,
      title: '修复读模型指纹',
      cwd: 'E:/DSH/workspaces/myself/skill开发',
      updatedAt: BASE_TIME + 9 * MINUTE,
      running: true,
    },
  ]
}

export function buildWorkspaceItems(): WorkspaceItem[] {
  return [{ id: 'ws-1', title: 'skill开发', sessionIds: [SESSION_ID] }]
}

export function buildSummaries(): SessionSummary[] {
  return [
    {
      id: SESSION_ID,
      rootId: SESSION_ID,
      title: '修复读模型指纹',
      cwd: 'E:/DSH/workspaces/myself/skill开发',
      archived: false,
      running: true,
      startedAt: BASE_TIME,
      updatedAt: BASE_TIME + 9 * MINUTE,
      status: 'running',
      turns: 3,
      files: 3,
      commands: 1,
      subagents: 2,
      errors: 1,
    },
  ]
}
