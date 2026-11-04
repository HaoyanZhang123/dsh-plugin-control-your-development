/**
 * T03 夹具：合成事件 + mock persistence（不读真实日志、不 import fs）。
 *
 * 事件形状严格按 rc.5 实测（`output/_verify/threadline/T01/event-shape.json`）：
 * - `tool/call.data.arguments` 是 JSON 字符串；
 * - `tool/result.data.message.source.callId` 才是 callId 所在；
 * - `turn/end.data.reason.kind ∈ {completed,error,aborted,interrupted,...}`；
 * - `tool/ptc-dispatch-start` / `tool/ptc-dispatch` 的 `arguments` 是对象。
 */
import type { SessionEventLike, SessionHeaderLite } from '../../src/shared/events/index.ts'
import type { PersistenceLike, SessionHandleLike } from '../../src/host/services.ts'

/** 测试工作区 cwd（Windows 风格，路径归一化会转 POSIX 相对路径）。 */
export const CWD = 'E:\\DSH\\workspaces\\demo'

/** 造 header。 */
export function makeHeader(id: string, overrides: Partial<SessionHeaderLite> = {}): SessionHeaderLite {
  return {
    id,
    createdAt: 1_700_000_000_000,
    cwd: CWD,
    ...overrides,
  }
}

/** 造事件（time 是 epoch ms，与真实日志一致）。 */
export function ev(type: string, data: Record<string, unknown>, time: number, seq = 0): SessionEventLike {
  return { type, seq, time, data }
}

export function turnStart(turn: number, time: number): SessionEventLike {
  return ev('turn/start', { turn }, time)
}

export function turnEnd(turn: number, kind: string, time: number, extra: Record<string, unknown> = {}): SessionEventLike {
  return ev('turn/end', { turn, reason: { kind, ...extra } }, time)
}

export function userMessage(text: string, time: number, id = `user-${time}`): SessionEventLike {
  return ev('user/message', { id, role: 'user', content: [{ type: 'text', text }] }, time)
}

export function assistantMessage(
  id: string,
  turn: number,
  step: number,
  time: number,
  text = 'ok',
  interrupted = false,
): SessionEventLike {
  return ev(
    'assistant/message',
    {
      turn,
      step,
      ...(interrupted ? { interrupted: true } : {}),
      message: { id, role: 'assistant', content: [{ type: 'text', text }] },
    },
    time,
  )
}

export function toolCall(
  callId: string,
  name: string,
  args: Record<string, unknown>,
  turn: number,
  time: number,
  step = 1,
): SessionEventLike {
  return ev('tool/call', { turn, step, callId, name, arguments: JSON.stringify(args) }, time)
}

export interface ToolResultOptions {
  isError?: boolean
  meta?: Record<string, unknown>
  error?: { name: string; code: string; reason?: string }
  text?: string
}

export function toolResult(
  callId: string,
  turn: number,
  time: number,
  options: ToolResultOptions = {},
  step = 1,
): SessionEventLike {
  const isError = options.isError === true
  const data: Record<string, unknown> = {
    turn,
    step,
    message: {
      id: `result-${callId}`,
      role: 'tool',
      isError,
      toolCallId: callId,
      source: { kind: 'tool', callId },
      content: [{ type: 'text', text: options.text ?? 'ok' }],
    },
  }
  if (options.meta !== undefined) data.meta = options.meta
  if (options.error !== undefined) data.error = options.error
  return ev('tool/result', data, time)
}

export function ptcStart(
  rootCallId: string,
  subCallId: string,
  name: string,
  args: Record<string, unknown>,
  time: number,
  parentCallId?: string,
): SessionEventLike {
  return ev(
    'tool/ptc-dispatch-start',
    { rootCallId, parentCallId: parentCallId ?? rootCallId, subCallId, name, arguments: args },
    time,
  )
}

export function ptcResult(
  subCallId: string,
  time: number,
  options: { isError?: boolean; meta?: Record<string, unknown>; content?: Array<{ type: string; text: string }> } = {},
): SessionEventLike {
  return ev(
    'tool/ptc-dispatch',
    {
      subCallId,
      isError: options.isError === true,
      content: options.content ?? [{ type: 'text', text: 'ok' }],
      ...(options.meta === undefined ? {} : { meta: options.meta }),
    },
    time,
  )
}

export function jobRegistered(jobId: string, time: number, extra: Record<string, unknown> = {}): SessionEventLike {
  return ev('job/registered', { jobId, owner: 'bash', kind: 'shell', label: 'dev server', startedAt: time, ...extra }, time)
}

export function jobSettled(jobId: string, time: number, status = 'completed'): SessionEventLike {
  return ev('job/settled', { jobId, status, finishedAt: time }, time)
}

/* ------------------------------------------------------------------ *
 * mock persistence
 * ------------------------------------------------------------------ */

export interface MockSession {
  header: SessionHeaderLite
  events: SessionEventLike[]
}

interface FailureSpec {
  error: Error
  on: 'open' | 'read' | 'stat'
}

/** 可注入失败（格式不支持 / 损坏 / 不存在）的只读 mock。 */
export class MockPersistence implements PersistenceLike {
  readonly opens = new Map<string, number>()
  readonly stats = new Map<string, number>()
  readonly sessions = new Map<string, MockSession>()
  readonly failures = new Map<string, FailureSpec>()

  add(id: string, events: SessionEventLike[], header: SessionHeaderLite = makeHeader(id)): this {
    this.sessions.set(id, { header, events })
    return this
  }

  fail(id: string, error: Error, on: 'open' | 'read' | 'stat' = 'open'): this {
    this.failures.set(id, { error, on })
    return this
  }

  private failFor(id: string, stage: 'open' | 'read' | 'stat'): Error | undefined {
    const failure = this.failures.get(id)
    if (failure === undefined) return undefined
    if (failure.on === stage) return failure.error
    return undefined
  }

  async open(id: string, _mode: 'read', _options?: { signal?: AbortSignal }): Promise<SessionHandleLike> {
    this.opens.set(id, (this.opens.get(id) ?? 0) + 1)
    const failure = this.failFor(id, 'open')
    if (failure !== undefined) throw failure
    const session = this.sessions.get(id)
    if (session === undefined) throw namedError('SessionPersistenceNotFoundError', `not found: ${id}`)
    return {
      header: session.header,
      read: async () => {
        const readFailure = this.failFor(id, 'read')
        if (readFailure !== undefined) throw readFailure
        return { eventState: 'detached', events: session.events.slice() }
      },
      close: async () => {},
    }
  }

  async stat(id: string): Promise<{ header: SessionHeaderLite; revision?: number }> {
    this.stats.set(id, (this.stats.get(id) ?? 0) + 1)
    const failure = this.failFor(id, 'stat')
    if (failure !== undefined) throw failure
    const session = this.sessions.get(id)
    if (session === undefined) throw namedError('SessionPersistenceNotFoundError', `not found: ${id}`)
    return { header: session.header }
  }
}

/** 造带 name 的错误（rc.5 的错误类名对齐）。 */
export function namedError(name: string, message: string): Error {
  const error = new Error(message)
  error.name = name
  return error
}

/** 合成 scan 请求行。 */
export function sessionInput(
  id: string,
  updatedAt: number,
  overrides: Partial<{ running: boolean; parentId: string; title: string; origin: string; archived: boolean }> = {},
): {
  id: string
  updatedAt: number
  running: boolean
  parentId?: string
  title?: string
  origin?: string
  archived?: boolean
} {
  return { id, updatedAt, running: false, ...overrides }
}

/** 一个"普通会话"的事件序列：1 轮、read + write + 1 条命令。 */
export function simpleSessionEvents(id = 's-simple', base = 1_700_000_000_000): SessionEventLike[] {
  return [
    turnStart(1, base),
    userMessage('帮我看下这个文件', base + 1),
    assistantMessage(`${id}-m1`, 1, 1, base + 2),
    toolCall('call-read', 'read', { file_path: 'src/a.ts' }, 1, base + 3),
    toolResult('call-read', 1, base + 4, { meta: { lines: [{ number: 1, text: 'x' }], totalLines: 10 } }),
    toolCall('call-write', 'write', { file_path: 'src/b.ts', content: 'one\ntwo\nthree' }, 1, base + 5),
    toolResult('call-write', 1, base + 6),
    toolCall('call-bash', 'bash', { command: 'pnpm test', description: 'run tests' }, 1, base + 7),
    toolResult('call-bash', 1, base + 8, { meta: { opsShell: { exitCode: 0 } } }),
    assistantMessage(`${id}-m2`, 1, 1, base + 9),
    turnEnd(1, 'completed', base + 10),
  ]
}

/** 等待一个微任务/定时器周期（测试用，不依赖固定 sleep 时长）。 */
export function tick(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
