/**
 * 「脉络」共享数据契约（T03 是 owner；T04/T05/T07/T08 只引用，不重定义）。
 *
 * 权威来源：`notes/31-脉络-1.0-交接/04-数据与架构规格.md`
 * - §2.3 公共响应格式、§2.4 scan、§2.5 snapshot、§2.6 detail、§2.7 错误码
 * - §3.2 SessionDetail / TurnDetail、§3.7 上限
 * - §4.2 FileNode、§4.3 SessionSummary、§4.4 共现边（wire 层名 `SnapshotCoTurnEdge`）
 * - `evidence/01-capabilities.md` §6.3（rc.5 实测：turn/end 有 error/interrupted；
 *   PTC 嵌套有独立事件；`user/message.source.changes[]` 是文件变更线索）
 *
 * 本文件**只有类型与常量**，没有 IO、没有副作用；下游可以直接 import 类型。
 */

/* ------------------------------------------------------------------ *
 * 0. 错误壳（04 §2.3 / §2.7）
 * ------------------------------------------------------------------ */

/** 全部错误码（04 §2.7）。新增码必须同时改 04 与这里，只许一处定义。 */
export const THREADLINE_ERROR_CODES = [
  'threadline/bad-request',
  'threadline/capability-missing',
  'threadline/scan-not-found',
  'threadline/session-unreadable',
  'threadline/format-unsupported',
  'threadline/limit-exceeded',
  'threadline/internal',
] as const

/** 错误码联合（04 §2.7）。 */
export type ThreadlineErrorCode = (typeof THREADLINE_ERROR_CODES)[number]

/** 错误体：UI 只读 code 决定行为，message 用于显示（不含路径/正文）。 */
export interface ThreadlineError {
  code: ThreadlineErrorCode
  message: string
  detail?: string
}

/** 成功响应壳：`{ ok: true } & T`（04 §2.3）。 */
export type Ok<T> = { ok: true } & T

/** 失败响应壳（04 §2.3）。 */
export interface Err {
  ok: false
  error: ThreadlineError
}

/** 三种路由的统一返回类型。 */
export type ThreadlineResponse<T> = Ok<T> | Err

/* ------------------------------------------------------------------ *
 * 1. 会话头 / 状态 / 事件
 * ------------------------------------------------------------------ */

/**
 * 冷读得到的会话 header（rc.5 `SessionHeader` 的子集，04 §2.4 校验用）。
 * 只取本项目会用到的字段；不 import 宿主包，避免把宿主编译期绑进来。
 */
export interface SessionHeaderLite {
  id: string
  createdAt: number
  cwd?: string
  parentSession?: string
  origin?: string
  delegationDepth?: number
  agentPreset?: string
  isSeeded?: boolean
  version?: number
}

/** 会话/轮次状态（04 §3.2）。成功只来自 `turn/end.reason.kind`；缺证据一律 unknown。 */
export type ThreadlineStatus = 'running' | 'completed' | 'aborted' | 'unknown'

/** `turn/end.reason.kind` 的原始值（rc.5 实测集合 + 未知兜底）；只记录不解读。 */
export type TurnEndKind =
  | 'completed'
  | 'aborted'
  | 'error'
  | 'interrupted'
  | 'blocked'
  | 'max-tokens'
  | 'forked'
  | 'other'

/** 日志事件的结构类型（只描述归约器读到的部分；未知类型不得断言语义）。 */
export interface SessionEventLike {
  type: string
  seq?: number
  time?: number
  data?: Record<string, unknown>
}

/* ------------------------------------------------------------------ *
 * 2. 文件 / 命令 / 轮次（04 §3.2 / §3.4 / §3.5 / §4.2）
 * ------------------------------------------------------------------ */

/** 文件操作种类（04 §3.4）。 */
export type FileOp = 'read' | 'write' | 'search'

/** 文件家族（04 §4.2），按扩展名判定。 */
export type FileFamily = 'doc' | 'code' | 'data' | 'image' | 'config' | 'other'

/** 轮次内单个文件的聚合（04 §3.2 TurnDetail.files 元素）。 */
export interface TurnFile {
  path: string
  ops: FileOp[]
  /** `≈` 估算的新增行数（04 §3.4 规则 4）。 */
  added: number
  /** `≈` 估算的删除行数。 */
  removed: number
}

/** 命令记录（04 §3.2 TurnDetail.commands 元素 / §3.5）。 */
export interface CommandRecord {
  id: string
  tool: string
  /** 命令行首词；取不到写 `?`（04 §3.5）。 */
  program?: string
  /** 命令文本，截断 500，默认折叠（04 §3.7）。 */
  text?: string
  status: 'success' | 'error' | 'unknown'
  startedAt: number
  endedAt?: number
  durationMs?: number
  /** 命令文本被截断（04 §3.2）。 */
  truncated?: boolean
}

/** 后台任务记录（04 §3.3 `job/*`；session 级，不与命令强行合并）。 */
export interface JobRecord {
  id: string
  owner?: string
  kind?: string
  label?: string
  startedAt?: number
  finishedAt?: number
  status: 'completed' | 'killed' | 'unknown'
}

/** 计划进度（04 §3.2 TurnDetail.plan；仅记录，不生成）。 */
export interface PlanProgress {
  total: number
  done: number
  items?: Array<{ content: string; status: string }>
}

/** 单轮详情（04 §3.2；`endKind`/`userText`/`assistantText` 是 T08 检查器需要的记录字段）。 */
export interface TurnDetail {
  n: number
  start: number
  end?: number
  status: ThreadlineStatus
  /** 结束原因原始 kind（属于「记录」，不是推断；summary 文案由 UI 决定）。 */
  endKind?: TurnEndKind
  files: TurnFile[]
  commands: CommandRecord[]
  subagents: string[]
  errors: number
  toolCalls: number
  toolFailures: number
  plan?: PlanProgress
  /** 本轮的 assistant message id，按事件顺序（04 §3.2）。 */
  messageIds: string[]
  /** 最后一个「已定稿」assistant message id；「影响 N」只在它上面渲染一次（04 §3.2）。 */
  finalMessageId?: string
  /** 首条用户文本，截断 160，仅元数据（04 §3.3；默认折叠）。 */
  userText?: string
  /** 最后一条回复文本，截断 160（04 §3.3；默认折叠）。 */
  assistantText?: string
}

/**
 * 一条「会话 × 轮次 × 文件」的触碰记录（T05 时序层/共现边的原料）。
 * 由同一份归约器产出，host 扫描与 detail 共用，不另写第二套解析。
 */
export interface FileTouch {
  sessionId: string
  /** 归属轮次；映射不到时为 `null`（04 §3.4 规则 2：归入 session 级未知，不猜）。 */
  turn: number | null
  /** 工作区相对 POSIX 路径（展示用原样大小写）。 */
  path: string
  /** 身份 key（小写；Windows 大小写不敏感，04 §3.4 规则 3）。 */
  key: string
  ops: FileOp[]
  reads: number
  writes: number
  searches: number
  added: number
  removed: number
  firstAt: number
  lastAt: number
  /** 会话内首次出现顺序（1 起），供时序层排序。 */
  seq: number
}

/** 截断标记（04 §3.2；`files` 对应 §3.7 的 file nodes/workspace 上限）。 */
export interface SessionTruncated {
  turns?: boolean
  filesPerTurn?: boolean
  commands?: boolean
  messageTurns?: boolean
  events?: boolean
  files?: boolean
  subagents?: boolean
  errors?: boolean
}

/** 单会话计数（04 §3.2 counts）。 */
export interface SessionCounts {
  turns: number
  steps: number
  toolCalls: number
  toolFailures: number
  files: number
  commands: number
  subagents: number
  errors: number
}

/** 子智能体条目（04 §3.2 / §3.6）。 */
export interface SubagentRecord {
  id: string
  title?: string
  status?: ThreadlineStatus
}

/** 单会话详情（04 §3.2；`jobs` / `unassigned` 是 04 §3.3 要求的记录出口）。 */
export interface SessionDetail {
  id: string
  parentId?: string
  rootId: string
  title?: string
  cwd: string
  origin?: string
  archived?: boolean
  running?: boolean
  startedAt: number
  endedAt?: number
  updatedAt: number
  model?: string
  provider?: string
  status: ThreadlineStatus
  turns: TurnDetail[]
  subagents: SubagentRecord[]
  /** messageId → turn（04 §3.2 / §3.3）。 */
  messageTurns: Record<string, number>
  errors: string[]
  /** 日志未读完/仍在记录：已得数据为真，但不完整（04 §2.6）。 */
  partial?: boolean
  truncated?: SessionTruncated
  counts: SessionCounts
  /** 后台任务（04 §3.3 `job/*`）。 */
  jobs: JobRecord[]
  /** 轮次归属未知的文件/命令记录（04 §3.4 规则 2）；不猜归属。 */
  unassigned?: {
    files: FileTouch[]
    commands: CommandRecord[]
  }
}

/* ------------------------------------------------------------------ *
 * 3. 工作区图（04 §4.2 / §4.3 / §4.4）
 * ------------------------------------------------------------------ */

/** 会话摘要（04 §4.3）。 */
export interface SessionSummary {
  id: string
  parentId?: string
  rootId: string
  title?: string
  cwd: string
  origin?: string
  archived: boolean
  running: boolean
  startedAt: number
  endedAt?: number
  updatedAt: number
  model?: string
  provider?: string
  status: ThreadlineStatus
  turns: number
  files: number
  commands: number
  subagents: number
  errors: number
}

/** 工作区文件节点（04 §4.2）。 */
export interface FileNode {
  path: string
  name: string
  dir: string
  family: FileFamily
  firstAt: number
  lastAt: number
  reads: number
  writes: number
  searches: number
  added: number
  removed: number
  ops: number
  sessionIds: string[]
  sessionCount: number
  turnCount: number
}

/**
 * host snapshot 的 **wire 层 coTurn 边**（04 §4.4；host 只算 coTurn，其它层客户端算）。
 *
 * 注意命名：产品级统一边 `GraphEdge`（含 id/directed/confirmed/confidence）由
 * `src/shared/relations` 定义，T07/T08 消费的是它；本类型只是 host→client 的传输格式，
 * 由 T05 的适配器转成产品级边。两者刻意不同名，避免 `export *` 冲突。
 */
export interface SnapshotCoTurnEdge {
  type: 'coTurn'
  from: string
  to: string
  weight: number
  evidence: Array<{ sessionId: string; turn: number }>
}

/* ------------------------------------------------------------------ *
 * 4. 扫描 / 快照 / 详情协议（04 §2.4 / §2.5 / §2.6）
 * ------------------------------------------------------------------ */

/** 扫描进度（04 §2.5 SnapshotResponse.progress）。 */
export interface ScanProgress {
  total: number
  scanned: number
  failed: number
  cached: number
  currentId?: string
  phase: 'starting' | 'scanning' | 'complete' | 'failed'
}

/** 单个会话的扫描错误（04 §2.5 `errors`；不打正文/路径）。 */
export interface ScanError {
  sessionId: string
  code: ThreadlineErrorCode
  message: string
  detail?: string
}

/** 客户端提供的会话行（来自 `useSessions`；只用于发起扫描与排序）。 */
export interface ScanSessionInput {
  id: string
  updatedAt: number
  running: boolean
  parentId?: string
  title?: string
  origin?: string
  archived?: boolean
}

/** `POST /api/dsh-threadline/scan` 请求（04 §2.4）。 */
export interface ScanRequest {
  workspaceId: string
  cwd: string
  generation: number
  sessions: ScanSessionInput[]
  refresh?: string[]
}

/** `POST /api/dsh-threadline/scan` 成功响应（04 §2.4）。 */
export interface ScanResponse {
  scanId: string
  rev: 0
  total: number
  /** 实际处理顺序（当前会话/子智能体 → 最近 7 天 → 更早 → 归档）。 */
  order: string[]
}

/** `POST /api/dsh-threadline/snapshot` 请求（04 §2.5）。 */
export interface SnapshotRequest {
  scanId: string
  /** 0 = 从零开始（reset 全量）。 */
  sinceRev: number
}

/** snapshot 增量包（04 §2.5）。 */
export interface SnapshotResponse {
  scanId: string
  rev: number
  reset: boolean
  done: boolean
  progress: ScanProgress
  changedSessions: SessionSummary[]
  changedFiles: FileNode[]
  changedEdges: SnapshotCoTurnEdge[]
  removedFiles: string[]
  /** 被裁剪的边，元素编码为 `from + '\u0000' + to`（与 SnapshotCoTurnEdge.from/to 一一对应）。 */
  removedEdges: string[]
  errors: ScanError[]
  /** 本响应因大小上限被裁剪；客户端立即再拉（04 §2.5）。 */
  truncated?: boolean
}

/** `POST /api/dsh-threadline/detail` 请求（04 §2.6）。 */
export interface DetailRequest {
  sessionId: string
  generation?: number
  refresh?: boolean
  /**
   * 当前工作区 cwd（可选；T13e 起客户端会带）。
   *
   * 用途：detail 是「按会话读一次」，不应依赖 `/scan` 的生命周期——没开过 tab 时没有扫描，
   * host 需要用它自证「这个 sessionId 属于请求方的工作区」（header.cwd 与之一致，
   * 或子会话的父会话 cwd 与之一致）。**不带也能工作**（老客户端保持原行为：只走扫描上下文）。
   */
  cwd?: string
}

/** detail 响应（04 §2.6）。 */
export interface DetailResponse {
  session: SessionDetail
}

/* ------------------------------------------------------------------ *
 * 5. 归约器输入/输出（04 §3）
 * ------------------------------------------------------------------ */

/** 归约器可调上限（测试可注入更小的值；默认取 LIMITS）。 */
export interface ReduceLimits {
  maxEvents: number
  maxTurns: number
  maxFilesPerTurn: number
  maxFilesPerSession: number
  maxCommands: number
  maxMessageTurns: number
  maxErrors: number
  maxSubagents: number
}

/** 归约器选项。 */
export interface ReduceOptions {
  /** 工作区 cwd（路径归一化基准；不用于读文件）。 */
  cwd?: string
  /** 已知的当前会话是否 running（决定未结束轮次是 running 还是 unknown）。 */
  running?: boolean
  /** 已确认的根会话 id；缺省时按 header 自身。 */
  rootId?: string
  /** 已知子会话（来自扫描摘要）；与 `subagent/catalog` 事件合并。 */
  children?: SubagentRecord[]
  limits?: Partial<ReduceLimits>
}

/** 归约结果：详情 + 触碰记录 + 诚实计数。 */
export interface ReduceResult {
  detail: SessionDetail
  touches: FileTouch[]
  /** 原始路径不在 cwd 内而被丢弃的次数（04 §3.4 规则 3）。 */
  outsideWorkspace: number
  /** 未被解析的事件类型计数（04 §3.3「其它」）。 */
  unknownEvents: number
  /** 实际读到的事件数。 */
  eventsRead: number
}
