/**
 * 上限、截断与文本估算——归约器与 host 扫描共用的唯一事实源（04 §3.7、06 N-10）。
 *
 * 纪律：
 * - 所有 cap 只在这里定义一份；归约器、scan、routes 都从这里读，不许各写一个数字。
 * - 超限必须留下 `truncated.*` 标记，不许静默（10 §2.8）。
 * - 本文件是纯函数/常量，无 IO、无随机、无时间依赖。
 */

/** 硬上限（04 §3.7 + 06 N-10）。单位：条。 */
export const LIMITS = {
  /** 单次 scan 请求最多接受的会话数（04 §2.4）。 */
  maxSessions: 3000,
  /** 单会话事件数上限；超出停止解析并标 `truncated.events`（04 §3.7）。 */
  maxEvents: 500_000,
  /** 单会话保留的最近轮次数（04 §3.7）。 */
  maxTurns: 2000,
  /** 单轮最多文件数（04 §3.4 规则 7）。 */
  maxFilesPerTurn: 200,
  /** 单会话最多文件节点（04 §3.7）。 */
  maxFilesPerSession: 20_000,
  /** 单会话最多命令记录（04 §3.7）。 */
  maxCommands: 2000,
  /** 单会话 messageId→turn 映射条数（04 §3.7）。 */
  maxMessageTurns: 10_000,
  /**
   * 单个会话保留的思维链样本数上限（D-35）。
   *
   * 一条样本 = 一次 assistant 回复的 reasoning 集合（不是一句话），
   * 2000 条足以覆盖超长会话，同时给 host 内存一个硬边界；
   * 超限必须标 `reasoningTruncated`，不许静默丢。
   */
  maxReasoningSamples: 2000,
  /** 单 workspace 文件节点上限（04 §3.7）。 */
  maxFileNodes: 20_000,
  /** 单 workspace 共现边上限（04 §4.4）。 */
  maxEdges: 20_000,
  /** 每个 turn 参与共现边的 top-k 文件（04 §4.4）。 */
  maxCoTurnFiles: 12,
  /** 每条边保留的证据样本数（04 §4.4）。 */
  edgeEvidence: 3,
  /** FileNode.sessionIds 最多保留的会话 id 数（04 §4.2）。 */
  maxFileSessionIds: 20,
  /** detail 缓存会话数（04 §3.7：LRU 20）。 */
  maxDetailCache: 20,
  /** 跨扫描复用的会话摘要缓存上限（防止内存无界）。 */
  maxDigests: 500,
  /** session.errors 数组最多保留的条数（counts.errors 仍是真实总数）。 */
  maxErrors: 200,
  /** 单会话 subagents 列表上限（防止异常日志撑爆响应）。 */
  maxSubagents: 1000,
  /** 字符串：标题（04 §3.7）。 */
  title: 200,
  /** 字符串：命令（04 §3.7）。 */
  command: 500,
  /** 字符串：用户/回复摘要（04 §3.7）。 */
  summary: 160,
  /** 字符串：错误信息。 */
  error: 200,
  /** 单条路径最大长度；超出视为非法（不是工作区文件）。 */
  maxPathLength: 1024,
  /** snapshot 响应体上限：8 MB（04 §2.3）。 */
  responseBytes: 8 * 1024 * 1024,
  /** host 保留的 rev→changes 日志条数；更旧的 sinceRev 触发 reset 全量。 */
  snapshotLog: 300,
  /** 扫描状态 60 秒无客户端轮询则自动取消（04 §2.4）。 */
  idleTimeoutMs: 60_000,
  /** 扫描 CPU 让步间隔（04 §8：每 50ms 让出）。 */
  yieldIntervalMs: 50,
} as const

/** 字符串截断：超长追加 `…`（10 §2.8：截断要可见）。 */
export function truncateText(value: string, max: number): string {
  if (value.length <= max) return value
  if (max <= 0) return ''
  return value.slice(0, max - 1) + '…'
}

/**
 * 行数估算（04 §3.4 规则 4：`≈增删行` 只是估算）。
 * 口径：空串 = 0 行；非空 = `\n` 数 + 1；末尾换行不额外计 1 行。
 */
export function countLines(text: string): number {
  if (text === '') return 0
  let lines = 1
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) lines += 1
  }
  if (text.endsWith('\n')) lines -= 1
  return lines < 0 ? 0 : lines
}

/** UTF-8 字节数（不依赖 Buffer：客户端半区以后也可能引用本文件）。 */
export function utf8Length(text: string): number {
  let bytes = 0
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i)
    if (code < 0x80) bytes += 1
    else if (code < 0x800) bytes += 2
    else if (code >= 0xd800 && code <= 0xdbff) {
      // 代理对：两个 UTF-16 单元拼成一个 4 字节码点。
      bytes += 4
      i += 1
    } else bytes += 3
  }
  return bytes
}

/** 数组上限：返回是否发生了截断，便于调用方记 `truncated`。 */
export function pushCapped<T>(list: T[], value: T, max: number): boolean {
  if (list.length >= max) return false
  list.push(value)
  return true
}
