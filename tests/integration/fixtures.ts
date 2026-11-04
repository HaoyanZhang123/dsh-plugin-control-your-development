/**
 * T11 · 集成夹具（A50-2）。
 *
 * 纪律（01 §4 / 09 §6）：
 * - **全部合成、脱敏**：会话 id、路径、标题、命令都是编造的，不含任何真实聊天内容；
 * - 驱动真实实现：`reduceSession` → host `scan/snapshot/detail`（假 persistence）→
 *   client `applySnapshot` → `shared/relations` → client UI 数据（Inspector/TurnStrip/MapView）；
 * - 不依赖真机、不写文件、不联网；只读内存 + 合成事件。
 */
import {
  createEmptyGraph,
  applySnapshot,
} from '../../src/client/data/index.ts'
import type { WorkspaceGraph } from '../../src/client/data/index.ts'
import type {
  DetailResponse,
  ScanRequest,
  ScanResponse,
  SessionDetail,
  SessionSummary,
  SnapshotResponse,
} from '../../src/shared/events/index.ts'
import { createRoutes } from '../../src/host/routes.ts'
import { ScanManager } from '../../src/host/scan.ts'
import type { HostServices, PersistenceLike, SessionHandleLike } from '../../src/host/services.ts'
import type { SessionEventLike, SessionHeaderLite } from '../../src/shared/events/index.ts'

export const CWD = 'E:\\DSH\\workspaces\\demo-workspace'
export const NOW = 1_700_000_000_000
export const DAY = 24 * 60 * 60 * 1000

/* ------------------------------------------------------------------ *
 * 合成事件（脱敏）
 * ------------------------------------------------------------------ */

function ev(type: string, data: Record<string, unknown>, time: number): SessionEventLike {
  return { type, time, data }
}

function turnStart(turn: number, time: number): SessionEventLike {
  return ev('turn/start', { turn }, time)
}

function turnEnd(turn: number, kind: string, time: number): SessionEventLike {
  return ev('turn/end', { turn, reason: { kind } }, time)
}

function userMessage(text: string, time: number): SessionEventLike {
  return ev('user/message', { id: 'u-' + time, role: 'user', content: [{ type: 'text', text }] }, time)
}

function assistantMessage(id: string, turn: number, time: number, text = '已处理（合成）'): SessionEventLike {
  return ev(
    'assistant/message',
    { turn, step: 1, message: { id, role: 'assistant', content: [{ type: 'text', text }] } },
    time,
  )
}

function toolCall(callId: string, name: string, args: Record<string, unknown>, turn: number, time: number): SessionEventLike {
  return ev('tool/call', { turn, step: 1, callId, name, arguments: JSON.stringify(args) }, time)
}

function toolResult(
  callId: string,
  turn: number,
  time: number,
  options: { isError?: boolean; meta?: Record<string, unknown>; error?: { name: string; code: string } } = {},
): SessionEventLike {
  const message: Record<string, unknown> = {
    id: 'r-' + callId,
    role: 'tool',
    isError: options.isError === true,
    toolCallId: callId,
    source: { kind: 'tool', callId },
    content: [{ type: 'text', text: 'ok' }],
  }
  const data: Record<string, unknown> = { turn, step: 1, message }
  if (options.meta !== undefined) data.meta = options.meta
  if (options.error !== undefined) data.error = options.error
  return ev('tool/result', data, time)
}

/** 主会话（running）：2 轮，读/写/编辑/命令/grep 都有。 */
export function rootEvents(): SessionEventLike[] {
  const base = NOW - 5_000
  return [
    turnStart(1, base),
    userMessage('看一下主流程（合成）', base + 1),
    assistantMessage('s-root-m1', 1, base + 2),
    toolCall('root-r1', 'read', { file_path: 'src/app.ts' }, 1, base + 3),
    toolResult('root-r1', 1, base + 4, { meta: { lines: [], totalLines: 80 } }),
    toolCall('root-r2', 'read', { file_path: 'src/lib/util.ts' }, 1, base + 5),
    toolResult('root-r2', 1, base + 6, { meta: { lines: [], totalLines: 30 } }),
    toolCall('root-w1', 'write', { file_path: 'docs/notes.md', content: '# 笔记\n\n第一行\n第二行\n' }, 1, base + 7),
    toolResult('root-w1', 1, base + 8),
    toolCall('root-c1', 'bash', { command: 'pnpm test', description: 'run tests' }, 1, base + 9),
    toolResult('root-c1', 1, base + 10, { meta: { opsShell: { exitCode: 0 } } }),
    assistantMessage('s-root-m2', 1, base + 11),
    turnEnd(1, 'completed', base + 12),
    turnStart(2, base + 13),
    toolCall('root-e1', 'edit', { file_path: 'src/app.ts', old_string: 'a\nb', new_string: 'a\nb\nc' }, 2, base + 14),
    toolResult('root-e1', 2, base + 15),
    toolCall('root-g1', 'grep', { pattern: 'util', path: 'src' }, 2, base + 16),
    toolResult('root-g1', 2, base + 17, { meta: { files: [{ path: 'src/lib/util.ts' }] } }),
    turnEnd(2, 'completed', base + 18),
  ]
}

/** 子智能体：1 轮，与主会话共享 src/app.ts。 */
function childEvents(): SessionEventLike[] {
  const base = NOW - 4_000
  return [
    turnStart(1, base),
    assistantMessage('s-child-m1', 1, base + 1),
    toolCall('child-r1', 'read', { file_path: 'src/app.ts' }, 1, base + 2),
    toolResult('child-r1', 1, base + 3),
    toolCall('child-r2', 'read', { file_path: 'docs/spec.md' }, 1, base + 4),
    toolResult('child-r2', 1, base + 5),
    toolCall('child-s1', 'str_replace_editor', { command: 'view', path: 'docs/spec.md' }, 1, base + 6),
    toolResult('child-s1', 1, base + 7),
    turnEnd(1, 'completed', base + 8),
  ]
}

/** 历史会话：中断轮 + 未知事件 + 缺结果命令 + 越界路径。 */
function adhocEvents(): SessionEventLike[] {
  const base = NOW - 9 * DAY
  return [
    ev('synthetic/unknown-event', { path: 'src/never.ts' }, base),
    turnStart(1, base + 1),
    toolCall('adhoc-c1', 'bash', { command: 'echo hi' }, 1, base + 2), // 没有 tool/result → unknown
    toolCall('adhoc-r1', 'read', { file_path: '../../secrets.txt' }, 1, base + 3), // 越界 → 丢弃
    turnEnd(1, 'interrupted', base + 4),
  ]
}

/* ------------------------------------------------------------------ *
 * 假 persistence
 * ------------------------------------------------------------------ */

export class FakePersistence implements PersistenceLike {
  readonly opens = new Map<string, number>()
  readonly sessions = new Map<string, { header: SessionHeaderLite; events: SessionEventLike[] }>()
  readonly failures = new Map<string, Error>()

  add(id: string, header: SessionHeaderLite, events: SessionEventLike[]): this {
    this.sessions.set(id, { header, events })
    return this
  }

  fail(id: string, error: Error): this {
    this.failures.set(id, error)
    return this
  }

  async open(id: string, _mode: 'read', _options?: { signal?: AbortSignal }): Promise<SessionHandleLike> {
    this.opens.set(id, (this.opens.get(id) ?? 0) + 1)
    const failure = this.failures.get(id)
    if (failure !== undefined) throw failure
    const session = this.sessions.get(id)
    if (session === undefined) throw namedError('SessionPersistenceNotFoundError', 'missing ' + id)
    return {
      header: session.header,
      read: async () => ({ eventState: 'detached', events: session.events.slice() }),
      close: async () => {},
    }
  }

  async stat(id: string): Promise<{ header: SessionHeaderLite }> {
    // 失败只模拟"读事件失败"（open），header 仍可校验——否则整次 scan 会在归属校验被拒。
    const session = this.sessions.get(id)
    if (session === undefined) throw namedError('SessionPersistenceNotFoundError', 'missing ' + id)
    return { header: session.header }
  }
}

export function namedError(name: string, message: string): Error {
  const error = new Error(message)
  error.name = name
  return error
}

function header(id: string, createdAt: number, extra: Partial<SessionHeaderLite> = {}): SessionHeaderLite {
  return { id, createdAt, cwd: CWD, ...extra }
}

/** 四个会话：主（running）、子、历史（中断）、坏（格式不支持）。 */
export function buildWorkspaceFixture(): {
  persistence: FakePersistence
  sessions: ScanRequest['sessions']
} {
  const persistence = new FakePersistence()
  persistence.add('s-root', header('s-root', NOW - 6_000), rootEvents())
  persistence.add(
    's-child',
    header('s-child', NOW - 5_000, { cwd: 'E:\\DSH\\workspaces\\demo-other', parentSession: 's-root', origin: 'subagent' }),
    childEvents(),
  )
  persistence.add('s-adhoc', header('s-adhoc', NOW - 10 * DAY), adhocEvents())
  persistence.add('s-broken', header('s-broken', NOW - 20_000), [])
  persistence.fail('s-broken', namedError('SessionFormatUnsupportedError', 'synthetic future format'))

  const sessions: ScanRequest['sessions'] = [
    { id: 's-root', updatedAt: NOW, running: true, title: '主流程（合成）' },
    { id: 's-child', updatedAt: NOW - 1_000, running: false, parentId: 's-root', origin: 'subagent' },
    { id: 's-adhoc', updatedAt: NOW - 10 * DAY, running: false },
    { id: 's-broken', updatedAt: NOW - 20_000, running: false },
  ]
  return { persistence, sessions }
}

/* ------------------------------------------------------------------ *
 * 路由驱动（真实 host 半区，假 persistence）
 * ------------------------------------------------------------------ */

export interface ScanPipeline {
  routes: ReturnType<typeof createRoutes>
  manager: ScanManager
  scan: ScanResponse
  snapshot: SnapshotResponse
  details: Map<string, SessionDetail>
  dispose(): void
}

async function post(routes: ReturnType<typeof createRoutes>, kind: 'scan' | 'snapshot' | 'detail', body: unknown): Promise<Record<string, unknown>> {
  const response = await routes.invoke(
    kind,
    new Request('http://127.0.0.1/api/dsh-threadline/' + kind, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
  return (await response.json()) as Record<string, unknown>
}

function services(persistence: FakePersistence): HostServices {
  return { getPersistence: () => persistence, getSessionQuery: () => undefined }
}

/** 跑完一次真实 scan → 等 done → 拉全量 snapshot → 拉每个成功会话的 detail。 */
export async function runScanPipeline(
  persistence?: FakePersistence,
  sessions?: ScanRequest['sessions'],
): Promise<ScanPipeline> {
  const fixture = persistence === undefined || sessions === undefined ? buildWorkspaceFixture() : undefined
  const store = persistence ?? fixture!.persistence
  const inputs = sessions ?? fixture!.sessions
  const hostServices = services(store)
  const manager = new ScanManager(hostServices, { now: () => NOW, yield: () => Promise.resolve() })
  const routes = createRoutes(hostServices, manager)
  const scanReply = (await post(routes, 'scan', {
    workspaceId: 'ws-demo',
    cwd: CWD,
    generation: 1,
    sessions: inputs,
  })) as unknown as ScanResponse & { ok: boolean; error?: { code: string; message: string } }
  if (scanReply.ok !== true) throw new Error('scan failed: ' + JSON.stringify(scanReply))
  const scan: ScanResponse = scanReply

  let snapshot = (await post(routes, 'snapshot', { scanId: scan.scanId, sinceRev: 0 })) as unknown as SnapshotResponse
  for (let index = 0; index < 200; index += 1) {
    if (snapshot.done === true) break
    await new Promise<void>((resolve) => setTimeout(resolve, 1))
    snapshot = (await post(routes, 'snapshot', { scanId: scan.scanId, sinceRev: 0 })) as unknown as SnapshotResponse
  }
  if (snapshot.done !== true) throw new Error('scan did not finish')

  const details = new Map<string, SessionDetail>()
  for (const summary of snapshot.changedSessions) {
    const reply = (await post(routes, 'detail', { sessionId: summary.id })) as unknown as DetailResponse & { ok: boolean }
    if (reply.ok === true) details.set(summary.id, reply.session)
  }
  return {
    routes,
    manager,
    scan,
    snapshot,
    details,
    dispose: () => routes.dispose(),
  }
}

/** 把 host snapshot 包按真实客户端数据层合并成图。 */
export function snapshotToGraph(pipeline: ScanPipeline): { graph: WorkspaceGraph; applied: ReturnType<typeof applySnapshot>['applied'] } {
  const result = applySnapshot(createEmptyGraph(), {
    scanId: pipeline.scan.scanId,
    rev: pipeline.snapshot.rev,
    reset: pipeline.snapshot.reset,
    done: pipeline.snapshot.done,
    progress: pipeline.snapshot.progress,
    changedSessions: pipeline.snapshot.changedSessions,
    changedFiles: pipeline.snapshot.changedFiles,
    changedEdges: pipeline.snapshot.changedEdges,
    removedFiles: pipeline.snapshot.removedFiles,
    removedEdges: pipeline.snapshot.removedEdges,
    errors: pipeline.snapshot.errors,
    ...(pipeline.snapshot.truncated === true ? { truncated: true } : {}),
  })
  return { graph: result.graph, applied: result.applied }
}

/** 合成一份"后续增量包"（wire 层；客户端合并语义用）。 */
export function syntheticIncrement(
  base: WorkspaceGraph,
  changes: {
    updatedFile?: SnapshotResponse['changedFiles'][number]
    removedFile?: string
    summary?: SessionSummary
  },
): { graph: WorkspaceGraph; applied: ReturnType<typeof applySnapshot>['applied'] } {
  const result = applySnapshot(base, {
    scanId: base.scanId,
    rev: base.rev + 1,
    reset: false,
    done: true,
    progress: {
      total: base.coverage.total,
      scanned: base.coverage.scanned,
      failed: base.coverage.failed,
      cached: base.coverage.cached,
      phase: 'complete',
    },
    ...(changes.summary === undefined ? {} : { changedSessions: [changes.summary] }),
    ...(changes.updatedFile === undefined ? {} : { changedFiles: [changes.updatedFile] }),
    ...(changes.removedFile === undefined ? {} : { removedFiles: [changes.removedFile] }),
  })
  return { graph: result.graph, applied: result.applied }
}

/** 取图里的文件列表（顺序稳定：按 path 排序，便于断言）。 */
export function sortedFiles(graph: WorkspaceGraph) {
  return [...graph.files.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}
