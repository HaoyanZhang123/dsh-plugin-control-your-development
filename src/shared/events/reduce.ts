/**
 * 会话日志归约器（04 §3 全节；rc.5 实测对齐见 `evidence/01-capabilities.md` §6.3）。
 *
 * 设计原则（10 §1/§2）：
 * - **只记录，不猜**：没有 `tool/result` 一律 `unknown`；`turn/end` 未知 kind 一律 `unknown`；
 *   未列事件类型只计 `unknownEvents`，不赋予语义。
 * - **PTC 不双计**：`run_code` 根调用只当命令；嵌套 `tool/ptc-dispatch*` 才产生文件/命令；
 *   绝不解析代码字符串。
 * - **上限可见**：任何 cap 命中都写 `truncated.*`（04 §3.7）。
 * - **单一路径**：scan 与 detail 复用同一 `reduceSession`，测试也只测这一份。
 */
import { countLines, LIMITS, truncateText } from './limits.ts'
import { baseName, dirName, familyOf, looksLikeFile, resolveWorkspacePath } from './paths.ts'
import type {
  CommandRecord,
  FileNode,
  FileOp,
  FileTouch,
  JobRecord,
  ReduceLimits,
  ReduceOptions,
  ReduceResult,
  SessionDetail,
  SessionEventLike,
  SessionHeaderLite,
  SessionTruncated,
  SubagentRecord,
  ThreadlineStatus,
  TurnDetail,
  TurnEndKind,
  TurnFile,
} from './types.ts'

/** 命令类工具（04 §3.5：bash / pwsh / run_code 根调用，以及 PTC 嵌套的同类）。 */
const COMMAND_TOOLS = new Set(['bash', 'pwsh', 'run_code', 'shell'])
/** 文件类工具（04 §3.4）。 */
const FILE_TOOLS = new Set(['read', 'read_image', 'write', 'edit', 'str_replace_editor', 'grep', 'glob'])

interface TurnFileAcc {
  path: string
  key: string
  ops: Set<FileOp>
  reads: number
  writes: number
  searches: number
  added: number
  removed: number
  firstAt: number
  lastAt: number
  seq: number
}

interface TurnAcc {
  n: number
  start: number
  end?: number
  status: ThreadlineStatus
  endKind?: TurnEndKind
  files: Map<string, TurnFileAcc>
  commands: CommandRecord[]
  subagents: Set<string>
  errors: number
  toolCalls: number
  toolFailures: number
  messageIds: string[]
  finalMessageId?: string
  userText?: string
  assistantText?: string
}

interface CallState {
  callId: string
  name: string
  turn: number | null
  startedAt: number
  args?: Record<string, unknown>
  sub: boolean
  finalized: boolean
}

/** 单次归约的可变状态（全部是本函数栈内对象，不落任何存储）。 */
interface ReduceState {
  header: SessionHeaderLite
  cwd: string
  limits: ReduceLimits
  title?: string
  model?: string
  provider?: string
  turns: Map<number, TurnAcc>
  turnOrder: number[]
  currentTurn: number | null
  calls: Map<string, CallState>
  messageTurns: Map<string, number>
  messageTurnsTruncated: boolean
  fileKeys: Map<string, string>
  commandCount: number
  jobs: Map<string, JobRecord>
  subagents: Map<string, SubagentRecord>
  errors: string[]
  errorCount: number
  toolCalls: number
  toolFailures: number
  steps: number
  unknownEvents: number
  outsideWorkspace: number
  eventsRead: number
  lastTime: number
  truncated: SessionTruncated
  partial: boolean
  unassignedFiles: Map<string, FileTouch>
  unassignedCommands: CommandRecord[]
  touchSeq: number
}

const DEFAULT_LIMITS: ReduceLimits = {
  maxEvents: LIMITS.maxEvents,
  maxTurns: LIMITS.maxTurns,
  maxFilesPerTurn: LIMITS.maxFilesPerTurn,
  maxFilesPerSession: LIMITS.maxFilesPerSession,
  maxCommands: LIMITS.maxCommands,
  maxMessageTurns: LIMITS.maxMessageTurns,
  maxErrors: LIMITS.maxErrors,
  maxSubagents: LIMITS.maxSubagents,
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function asArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined
}

/** 从内容块数组/字符串里抽文本（只用于摘录，截断后默认折叠）。 */
function textFromContent(value: unknown): string | undefined {
  const direct = asString(value)
  if (direct !== undefined) return direct
  const blocks = asArray(value)
  if (blocks === undefined) return undefined
  const parts: string[] = []
  for (const block of blocks) {
    const record = asRecord(block)
    if (record === undefined) continue
    const text = asString(record.text)
    if (text !== undefined && text !== '') parts.push(text)
  }
  if (parts.length === 0) return undefined
  return parts.join('\n')
}

/** `tool/call.data.arguments` 是 JSON 字符串（rc.5 实测 100%），也可能是对象（PTC dispatch）。 */
function parseArguments(value: unknown): Record<string, unknown> | undefined {
  const record = asRecord(value)
  if (record !== undefined) return record
  const text = asString(value)
  if (text === undefined || text.trim() === '') return undefined
  try {
    return asRecord(JSON.parse(text))
  } catch {
    return undefined
  }
}

/** `turn/end.reason.kind` → 状态（04 §3.3：只有 completed/aborted 被承认，其余 unknown）。 */
function statusOfEndKind(kind: TurnEndKind | undefined): ThreadlineStatus {
  if (kind === 'completed') return 'completed'
  if (kind === 'aborted') return 'aborted'
  return 'unknown'
}

function endKindOf(value: unknown): TurnEndKind {
  switch (value) {
    case 'completed':
    case 'aborted':
    case 'error':
    case 'interrupted':
    case 'blocked':
    case 'max-tokens':
    case 'forked':
      return value
    default:
      return 'other'
  }
}

/** 命令首词（04 §3.5：取不到写 `?`）。 */
function programOf(args: Record<string, unknown> | undefined, description: string | undefined): string {
  const command = asString(args?.command)
  const candidate = command ?? description
  if (candidate === undefined) return '?'
  const trimmed = candidate.trim()
  if (trimmed === '') return '?'
  const first = trimmed.split(/\s+/, 1)[0]
  return first === '' ? '?' : truncateText(first, 64)
}

/** 命令文本（截断 500，04 §3.7）。 */
function commandTextOf(name: string, args: Record<string, unknown> | undefined, description: string | undefined): string | undefined {
  const raw = asString(args?.command) ?? asString(args?.code) ?? description
  if (raw === undefined) return undefined
  const trimmed = raw.trim()
  if (trimmed === '') return undefined
  return truncateText(trimmed, LIMITS.command)
}

function newTurn(n: number, start: number): TurnAcc {
  return {
    n,
    start,
    status: 'running',
    files: new Map<string, TurnFileAcc>(),
    commands: [],
    subagents: new Set<string>(),
    errors: 0,
    toolCalls: 0,
    toolFailures: 0,
    messageIds: [],
  }
}

/** 取（必要时创建）turn；turn 号非整数/负数按「无归属」处理，不猜。 */
function turnOf(state: ReduceState, n: number | null): TurnAcc | undefined {
  if (n === null || !Number.isInteger(n) || n < 0) return undefined
  return state.turns.get(n)
}

function ensureTurn(state: ReduceState, n: number, time: number): TurnAcc {
  const existing = state.turns.get(n)
  if (existing !== undefined) return existing
  const turn = newTurn(n, time)
  state.turns.set(n, turn)
  state.turnOrder.push(n)
  if (state.turnOrder.length > state.limits.maxTurns) {
    // 04 §3.7：保留最近 maxTurns 轮。
    const dropped = state.turnOrder.shift()
    if (dropped !== undefined) state.turns.delete(dropped)
    state.truncated.turns = true
  }
  state.currentTurn = n
  return turn
}

function recordError(state: ReduceState, message: string): void {
  state.errorCount += 1
  if (state.errors.length < state.limits.maxErrors) {
    state.errors.push(truncateText(message, LIMITS.error))
  } else {
    state.truncated.errors = true
  }
}

/** 会话级文件身份登记（cap: maxFilesPerSession）。 */
function registerFileKey(state: ReduceState, key: string, path: string): boolean {
  if (state.fileKeys.has(key)) return true
  if (state.fileKeys.size >= state.limits.maxFilesPerSession) {
    state.truncated.files = true
    return false
  }
  state.fileKeys.set(key, path)
  return true
}

function addTurnFile(
  state: ReduceState,
  turn: TurnAcc,
  op: FileOp,
  resolved: { path: string; key: string },
  added: number,
  removed: number,
  time: number,
): void {
  if (!registerFileKey(state, resolved.key, resolved.path)) return
  let file = turn.files.get(resolved.key)
  if (file === undefined) {
    if (turn.files.size >= state.limits.maxFilesPerTurn) {
      state.truncated.filesPerTurn = true
      return
    }
    state.touchSeq += 1
    file = {
      path: resolved.path,
      key: resolved.key,
      ops: new Set<FileOp>(),
      reads: 0,
      writes: 0,
      searches: 0,
      added: 0,
      removed: 0,
      firstAt: time,
      lastAt: time,
      seq: state.touchSeq,
    }
    turn.files.set(resolved.key, file)
  }
  file.ops.add(op)
  if (op === 'read') file.reads += 1
  else if (op === 'write') file.writes += 1
  else file.searches += 1
  file.added += added
  file.removed += removed
  file.lastAt = Math.max(file.lastAt, time)
}

function addUnassigned(
  state: ReduceState,
  op: FileOp,
  resolved: { path: string; key: string },
  added: number,
  removed: number,
  time: number,
): void {
  if (!registerFileKey(state, resolved.key, resolved.path)) return
  const existing = state.unassignedFiles.get(resolved.key)
  if (existing !== undefined) {
    if (!existing.ops.includes(op)) existing.ops.push(op)
    if (op === 'read') existing.reads += 1
    else if (op === 'write') existing.writes += 1
    else existing.searches += 1
    existing.added += added
    existing.removed += removed
    existing.lastAt = Math.max(existing.lastAt, time)
    return
  }
  state.touchSeq += 1
  state.unassignedFiles.set(resolved.key, {
    sessionId: state.header.id,
    turn: null,
    path: resolved.path,
    key: resolved.key,
    ops: [op],
    reads: op === 'read' ? 1 : 0,
    writes: op === 'write' ? 1 : 0,
    searches: op === 'search' ? 1 : 0,
    added,
    removed,
    firstAt: time,
    lastAt: time,
    seq: state.touchSeq,
  })
}

/** 记录一次文件操作（turn 未知 → session 级未归属，不猜）。 */
function recordFileOp(
  state: ReduceState,
  turn: TurnAcc | undefined,
  op: FileOp,
  rawPath: string,
  added: number,
  removed: number,
  time: number,
): void {
  const resolved = resolveWorkspacePath(rawPath, state.cwd)
  if (resolved === null) {
    state.outsideWorkspace += 1
    return
  }
  if (turn === undefined) {
    addUnassigned(state, op, resolved, added, removed, time)
    return
  }
  addTurnFile(state, turn, op, resolved, added, removed, time)
}

function pushCommand(
  state: ReduceState,
  turn: TurnAcc | undefined,
  record: CommandRecord,
): void {
  if (state.commandCount >= state.limits.maxCommands) {
    state.truncated.commands = true
    return
  }
  state.commandCount += 1
  if (turn === undefined) {
    state.unassignedCommands.push(record)
    return
  }
  turn.commands.push(record)
}

/** 结果 meta 里 grep/glob 命中的文件路径（04 §3.4：结果只用于路径/状态，不存正文）。 */
function resultPathsOf(name: string, meta: Record<string, unknown> | undefined): string[] {
  if (meta === undefined) return []
  const paths: string[] = []
  const files = asArray(meta.files)
  if (files !== undefined) {
    for (const entry of files) {
      const record = asRecord(entry)
      const path = asString(record?.path)
      if (path !== undefined && path !== '') paths.push(path)
    }
  }
  const direct = asArray(meta.paths)
  if (direct !== undefined) {
    for (const entry of direct) {
      if (typeof entry === 'string' && entry !== '') paths.push(entry)
    }
  }
  // 少数工具把单文件路径放 meta.path（read/grep 单文件）。
  const single = asString(meta.path)
  if (single !== undefined && single !== '' && (name === 'grep' || name === 'glob')) paths.push(single)
  return paths
}

/** 结束一次调用：落命令或文件操作；缺失结果的调用在收尾时以 unknown 落账。 */
function finishCall(
  state: ReduceState,
  call: CallState,
  status: 'success' | 'error' | 'unknown',
  endedAt: number,
  meta?: Record<string, unknown>,
): void {
  if (call.finalized) return
  call.finalized = true
  const turn = call.turn === null ? undefined : state.turns.get(call.turn)
  if (status === 'error') state.toolFailures += 1

  if (COMMAND_TOOLS.has(call.name)) {
    const description = asString(call.args?.description)
    const text = commandTextOf(call.name, call.args, description)
    const durationMs = Math.max(0, endedAt - call.startedAt)
    const record: CommandRecord = {
      id: call.callId,
      tool: call.name,
      program: programOf(call.args, description),
      status,
      startedAt: call.startedAt,
      endedAt,
      durationMs,
    }
    if (text !== undefined) record.text = text
    if (text !== undefined && text.length >= LIMITS.command) record.truncated = true
    pushCommand(state, turn, record)
    return
  }

  if (!FILE_TOOLS.has(call.name)) return
  const args = call.args
  const path = asString(args?.file_path) ?? asString(args?.path)

  if (call.name === 'read' || call.name === 'read_image') {
    if (path !== undefined) recordFileOp(state, turn, 'read', path, 0, 0, endedAt)
    return
  }
  if (call.name === 'write') {
    const content = asString(args?.content) ?? asString(args?.file_text) ?? ''
    if (path !== undefined) recordFileOp(state, turn, 'write', path, countLines(content), 0, endedAt)
    return
  }
  if (call.name === 'edit') {
    const added = asString(args?.new_string) ?? asString(args?.new_str) ?? asString(args?.content) ?? ''
    const removed = asString(args?.old_string) ?? asString(args?.old_str) ?? ''
    if (path !== undefined) recordFileOp(state, turn, 'write', path, countLines(added), countLines(removed), endedAt)
    return
  }
  if (call.name === 'str_replace_editor') {
    const action = asString(args?.command) ?? asString(args?.action)
    const editorPath = asString(args?.path)
    if (action === 'view' || action === undefined) {
      if (editorPath !== undefined) recordFileOp(state, turn, 'read', editorPath, 0, 0, endedAt)
      return
    }
    const added = asString(args?.new_str) ?? asString(args?.new_string) ?? asString(args?.file_text) ?? asString(args?.content) ?? ''
    const removed = asString(args?.old_str) ?? asString(args?.old_string) ?? ''
    if (editorPath !== undefined) recordFileOp(state, turn, 'write', editorPath, countLines(added), countLines(removed), endedAt)
    return
  }
  // grep / glob：结果命中路径才算「触碰过的文件」（04 §3.4）。
  const resultPaths = resultPathsOf(call.name, meta)
  for (const resultPath of resultPaths) {
    recordFileOp(state, turn, 'search', resultPath, 0, 0, endedAt)
  }
  // args.path 只在「像文件」时记录，目录不当文件节点（不猜）。
  if (path !== undefined && looksLikeFile(path) && !resultPaths.includes(path)) {
    recordFileOp(state, turn, 'search', path, 0, 0, endedAt)
  }
}

/** 归约一份会话日志。 */
export function reduceSession(
  header: SessionHeaderLite,
  events: readonly SessionEventLike[],
  options: ReduceOptions = {},
): ReduceResult {
  const limits: ReduceLimits = { ...DEFAULT_LIMITS, ...(options.limits ?? {}) }
  const state: ReduceState = {
    header,
    cwd: typeof options.cwd === 'string' && options.cwd !== '' ? options.cwd : (header.cwd ?? ''),
    limits,
    turns: new Map<number, TurnAcc>(),
    turnOrder: [],
    currentTurn: null,
    calls: new Map<string, CallState>(),
    messageTurns: new Map<string, number>(),
    messageTurnsTruncated: false,
    fileKeys: new Map<string, string>(),
    commandCount: 0,
    jobs: new Map<string, JobRecord>(),
    subagents: new Map<string, SubagentRecord>(),
    errors: [],
    errorCount: 0,
    toolCalls: 0,
    toolFailures: 0,
    steps: 0,
    unknownEvents: 0,
    outsideWorkspace: 0,
    eventsRead: 0,
    lastTime: 0,
    truncated: {},
    partial: false,
    unassignedFiles: new Map<string, FileTouch>(),
    unassignedCommands: [],
    touchSeq: 0,
  }

  for (const child of options.children ?? []) {
    state.subagents.set(child.id, { ...child })
  }

  const headerStartedAt = Number.isFinite(header.createdAt) && header.createdAt >= 0 ? header.createdAt : 0
  let firstEventTime = 0

  for (const event of events) {
    if (state.eventsRead >= state.limits.maxEvents) {
      state.truncated.events = true
      state.partial = true
      break
    }
    state.eventsRead += 1
    const time = asNumber(event.time)
    if (time !== undefined && time >= 0) {
      if (firstEventTime === 0) firstEventTime = time
      state.lastTime = Math.max(state.lastTime, time)
    }
    const at = time ?? state.lastTime
    const data = asRecord(event.data) ?? {}

    switch (event.type) {
      case 'session': {
        if (state.title === undefined) {
          const title = asString(data.title)
          if (title !== undefined) state.title = truncateText(title, LIMITS.title)
        }
        break
      }
      case 'session/title': {
        const title = asString(data.title)
        if (title !== undefined) state.title = truncateText(title, LIMITS.title)
        break
      }
      case 'request/context': {
        const provider = asString(data.provider)
        const model = asString(data.model)
        if (provider !== undefined) state.provider = provider
        if (model !== undefined) state.model = model
        break
      }
      case 'turn/start': {
        const n = asNumber(data.turn)
        if (n === undefined) {
          state.unknownEvents += 1
          break
        }
        ensureTurn(state, n, at)
        state.currentTurn = n
        break
      }
      case 'turn/end': {
        const n = asNumber(data.turn)
        const turn = turnOf(state, n ?? null)
        if (turn === undefined) {
          state.unknownEvents += 1
          break
        }
        const reason = asRecord(data.reason)
        const kind = endKindOf(reason?.kind)
        turn.endKind = kind
        turn.status = statusOfEndKind(kind)
        turn.end = at
        if (kind === 'error') {
          const failure = asRecord(reason?.error)
          const code = asString(failure?.code) ?? asString(failure?.message) ?? 'error'
          recordError(state, `turn ${turn.n}: ${code}`)
          turn.errors += 1
        } else if (kind === 'interrupted' || kind === 'blocked' || kind === 'max-tokens' || kind === 'forked' || kind === 'other') {
          // 只记录原因，不升级成 completed（10 §2.2/§2.3）。
        }
        break
      }
      case 'step/start': {
        state.steps += 1
        break
      }
      case 'step/end': {
        break
      }
      case 'user/message': {
        const text = textFromContent(data.content)
        const currentNode = state.currentTurn === null ? undefined : state.turns.get(state.currentTurn)
        if (text !== undefined && currentNode !== undefined && currentNode.userText === undefined) {
          currentNode.userText = truncateText(text, LIMITS.summary)
        }
        break
      }
      case 'assistant/message': {
        const message = asRecord(data.message)
        const id = asString(message?.id)
        const n = asNumber(data.turn)
        const turn = turnOf(state, n ?? state.currentTurn)
        const text = textFromContent(message?.content)
        if (text !== undefined) {
          if (turn !== undefined) turn.assistantText = truncateText(text, LIMITS.summary)
        }
        const interrupted = data.interrupted === true
        if (id !== undefined) {
          if (turn !== undefined) {
            turn.messageIds.push(id)
            if (!interrupted) turn.finalMessageId = id
          }
          if (n !== undefined) {
            if (state.messageTurns.size >= state.limits.maxMessageTurns && !state.messageTurns.has(id)) {
              state.messageTurnsTruncated = true
            } else {
              state.messageTurns.set(id, n)
            }
          }
        }
        break
      }
      case 'tool/call': {
        const callId = asString(data.callId)
        const name = asString(data.name)
        if (callId === undefined || name === undefined) {
          state.unknownEvents += 1
          break
        }
        const n = asNumber(data.turn)
        state.toolCalls += 1
        state.calls.set(callId, {
          callId,
          name,
          turn: n ?? null,
          startedAt: at,
          args: parseArguments(data.arguments),
          sub: false,
          finalized: false,
        })
        const turn = turnOf(state, n ?? state.currentTurn)
        if (turn !== undefined) turn.toolCalls += 1
        break
      }
      case 'tool/result': {
        const message = asRecord(data.message)
        const source = asRecord(message?.source)
        const callId = asString(source?.callId) ?? asString(message?.toolCallId) ?? asString(data.callId)
        const call = callId === undefined ? undefined : state.calls.get(callId)
        if (call === undefined) {
          state.unknownEvents += 1
          break
        }
        const failed = message?.isError === true || data.error !== undefined
        finishCall(state, call, failed ? 'error' : 'success', at, asRecord(data.meta))
        if (failed) {
          const errorRecord = asRecord(data.error)
          const code = asString(errorRecord?.code) ?? 'tool-error'
          recordError(state, `${call.name}: ${code}`)
          const turn = call.turn === null ? undefined : state.turns.get(call.turn)
          if (turn !== undefined) {
            turn.errors += 1
            turn.toolFailures += 1
          }
        }
        break
      }
      case 'tool/ptc-dispatch-start': {
        const subCallId = asString(data.subCallId)
        const name = asString(data.name)
        if (subCallId === undefined || name === undefined) {
          state.unknownEvents += 1
          break
        }
        const rootCallId = asString(data.rootCallId)
        const parentCallId = asString(data.parentCallId)
        const rootCall = rootCallId === undefined ? undefined : state.calls.get(rootCallId)
        const parentCall = parentCallId === undefined ? undefined : state.calls.get(parentCallId)
        // 04 §3.4 规则 2：PTC 的 turn 用 root 映射；映射不到 = null，不猜。
        const turnNumber = rootCall?.turn ?? parentCall?.turn ?? null
        state.toolCalls += 1
        state.calls.set(subCallId, {
          callId: subCallId,
          name,
          turn: turnNumber,
          startedAt: at,
          args: parseArguments(data.arguments),
          sub: true,
          finalized: false,
        })
        const turn = turnNumber === null ? undefined : state.turns.get(turnNumber)
        if (turn !== undefined) turn.toolCalls += 1
        break
      }
      case 'tool/ptc-dispatch': {
        const subCallId = asString(data.subCallId)
        const call = subCallId === undefined ? undefined : state.calls.get(subCallId)
        if (call === undefined) {
          state.unknownEvents += 1
          break
        }
        const failed = data.isError === true || data.error !== undefined
        if (call.args === undefined) call.args = parseArguments(data.arguments)
        finishCall(state, call, failed ? 'error' : 'success', at, asRecord(data.meta))
        if (failed) {
          const errorRecord = asRecord(data.error)
          const code = asString(errorRecord?.code) ?? 'ptc-error'
          recordError(state, `${call.name}: ${code}`)
          const turn = call.turn === null ? undefined : state.turns.get(call.turn)
          if (turn !== undefined) {
            turn.errors += 1
            turn.toolFailures += 1
          }
        }
        break
      }
      case 'job/registered': {
        const jobId = asString(data.jobId)
        if (jobId === undefined) {
          state.unknownEvents += 1
          break
        }
        if (state.jobs.size < 1000) {
          const job: JobRecord = { id: jobId, status: 'unknown' }
          const owner = asString(data.owner)
          const kind = asString(data.kind)
          const label = asString(data.label)
          const startedAt = asNumber(data.startedAt)
          if (owner !== undefined) job.owner = owner
          if (kind !== undefined) job.kind = kind
          if (label !== undefined) job.label = truncateText(label, LIMITS.title)
          if (startedAt !== undefined) job.startedAt = startedAt
          state.jobs.set(jobId, job)
        }
        break
      }
      case 'job/settled': {
        const jobId = asString(data.jobId)
        const job = jobId === undefined ? undefined : state.jobs.get(jobId)
        if (job === undefined) {
          state.unknownEvents += 1
          break
        }
        const status = data.status === 'completed' ? 'completed' : data.status === 'killed' ? 'killed' : 'unknown'
        job.status = status
        const finishedAt = asNumber(data.finishedAt)
        if (finishedAt !== undefined) job.finishedAt = finishedAt
        break
      }
      case 'subagent/catalog': {
        const childId = asString(data.childId)
        if (childId === undefined) {
          state.unknownEvents += 1
          break
        }
        if (state.subagents.size >= state.limits.maxSubagents) {
          state.truncated.subagents = true
          break
        }
        if (!state.subagents.has(childId)) {
          const label = asString(data.label)
          const record: SubagentRecord = { id: childId }
          if (label !== undefined) record.title = truncateText(label, LIMITS.title)
          state.subagents.set(childId, record)
        }
        // 轮次归属只在事件里真的记录时使用（`data.turn` 本机样本没有 → 不猜）。
        {
          const n = asNumber(data.turn)
          const turn = turnOf(state, n ?? null)
          if (turn !== undefined && !turn.subagents.has(childId)) turn.subagents.add(childId)
        }
        break
      }
      case 'agent/inbox/spliced': {
        // 04 §3.3：忽略，不计 unknown（不是本轮工作）。
        break
      }
      default: {
        // 04 §3.3「其它」：只计数，不猜语义。
        state.unknownEvents += 1
        break
      }
    }
  }

  // 收尾：没有结果的调用 → unknown（10 §2.2；不许默认成功）。
  for (const call of state.calls.values()) {
    if (call.finalized) continue
    finishCall(state, call, 'unknown', state.lastTime)
  }

  // 收尾：仍未结束的轮次。只有「最后一轮 + 已知 running」才标 running，否则 unknown。
  const lastTurnNumber = state.turnOrder.length > 0 ? state.turnOrder[state.turnOrder.length - 1] : undefined
  let openTurn = false
  for (const n of state.turnOrder) {
    const turn = state.turns.get(n)
    if (turn === undefined) continue
    if (turn.status === 'running' && turn.end === undefined) {
      openTurn = true
      if (n === lastTurnNumber && options.running === true) {
        turn.status = 'running'
      } else {
        turn.status = 'unknown'
      }
    }
  }
  if (openTurn) state.partial = true

  const startedAt = headerStartedAt > 0 ? headerStartedAt : firstEventTime
  const turns: TurnDetail[] = []
  const touches: FileTouch[] = []
  for (const n of state.turnOrder) {
    const turn = state.turns.get(n)
    if (turn === undefined) continue
    const files: TurnFile[] = []
    for (const file of turn.files.values()) {
      files.push({
        path: file.path,
        ops: Array.from(file.ops),
        added: file.added,
        removed: file.removed,
      })
      touches.push({
        sessionId: header.id,
        turn: turn.n,
        path: file.path,
        key: file.key,
        ops: Array.from(file.ops),
        reads: file.reads,
        writes: file.writes,
        searches: file.searches,
        added: file.added,
        removed: file.removed,
        firstAt: file.firstAt,
        lastAt: file.lastAt,
        seq: file.seq,
      })
    }
    files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    const turnDetail: TurnDetail = {
      n: turn.n,
      start: turn.start,
      status: turn.status,
      files,
      commands: turn.commands,
      subagents: Array.from(turn.subagents).sort(),
      errors: turn.errors,
      toolCalls: turn.toolCalls,
      toolFailures: turn.toolFailures,
      messageIds: turn.messageIds,
    }
    if (turn.end !== undefined) turnDetail.end = turn.end
    if (turn.endKind !== undefined) turnDetail.endKind = turn.endKind
    if (turn.finalMessageId !== undefined) turnDetail.finalMessageId = turn.finalMessageId
    if (turn.userText !== undefined) turnDetail.userText = turn.userText
    if (turn.assistantText !== undefined) turnDetail.assistantText = turn.assistantText
    turns.push(turnDetail)
  }
  for (const file of state.unassignedFiles.values()) touches.push(file)
  touches.sort((a, b) => {
    const turnA = a.turn === null ? Number.MAX_SAFE_INTEGER : a.turn
    const turnB = b.turn === null ? Number.MAX_SAFE_INTEGER : b.turn
    if (turnA !== turnB) return turnA - turnB
    return a.seq - b.seq
  })

  if (state.messageTurnsTruncated) state.truncated.messageTurns = true

  // 会话级状态：最后一轮的信封；没有轮次 → unknown。
  const lastTurn = lastTurnNumber === undefined ? undefined : state.turns.get(lastTurnNumber)
  const status: ThreadlineStatus = lastTurn === undefined ? 'unknown' : lastTurn.status
  const endedAt = (() => {
    let latest: number | undefined
    for (const n of state.turnOrder) {
      const turn = state.turns.get(n)
      if (turn?.end !== undefined && (latest === undefined || turn.end > latest)) latest = turn.end
    }
    return latest
  })()

  const messageTurns: Record<string, number> = {}
  for (const [id, n] of state.messageTurns) messageTurns[id] = n

  const running = options.running === true

  const subagents: SubagentRecord[] = Array.from(state.subagents.values()).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

  const detail: SessionDetail = {
    id: header.id,
    rootId: options.rootId ?? header.id,
    cwd: state.cwd,
    startedAt,
    updatedAt: state.lastTime > 0 ? state.lastTime : startedAt,
    status,
    turns,
    subagents,
    messageTurns,
    errors: state.errors,
    counts: {
      turns: state.turnOrder.length,
      steps: state.steps,
      toolCalls: state.toolCalls,
      toolFailures: state.toolFailures,
      files: state.fileKeys.size,
      commands: state.commandCount,
      subagents: subagents.length,
      errors: state.errorCount,
    },
    jobs: Array.from(state.jobs.values()),
  }
  if (header.parentSession !== undefined) detail.parentId = header.parentSession
  if (state.title !== undefined) detail.title = state.title
  if (header.origin !== undefined) detail.origin = header.origin
  if (state.model !== undefined) detail.model = state.model
  if (state.provider !== undefined) detail.provider = state.provider
  if (endedAt !== undefined) detail.endedAt = endedAt
  if (running) detail.running = true
  if (state.partial) detail.partial = true
  if (Object.keys(state.truncated).length > 0) detail.truncated = state.truncated
  if (state.unassignedFiles.size > 0 || state.unassignedCommands.length > 0) {
    detail.unassigned = {
      files: Array.from(state.unassignedFiles.values()),
      commands: state.unassignedCommands,
    }
  }

  return {
    detail,
    touches,
    outsideWorkspace: state.outsideWorkspace,
    unknownEvents: state.unknownEvents,
    eventsRead: state.eventsRead,
  }
}

/** 从一条 touch 列表构造工作区级 FileNode（scan 与测试共用，避免第二套口径）。 */
export function fileNodeFromTouches(
  path: string,
  touches: readonly FileTouch[],
  sessionIds: readonly string[],
  sessionCount: number,
  turnCount: number,
): FileNode {
  let reads = 0
  let writes = 0
  let searches = 0
  let added = 0
  let removed = 0
  let firstAt = Number.POSITIVE_INFINITY
  let lastAt = 0
  for (const touch of touches) {
    reads += touch.reads
    writes += touch.writes
    searches += touch.searches
    added += touch.added
    removed += touch.removed
    if (touch.firstAt < firstAt) firstAt = touch.firstAt
    if (touch.lastAt > lastAt) lastAt = touch.lastAt
  }
  if (!Number.isFinite(firstAt)) firstAt = 0
  return {
    path,
    name: baseName(path),
    dir: dirName(path),
    family: familyOf(path),
    firstAt,
    lastAt,
    reads,
    writes,
    searches,
    added,
    removed,
    ops: reads + writes + searches,
    sessionIds: Array.from(sessionIds),
    sessionCount,
    turnCount,
  }
}
