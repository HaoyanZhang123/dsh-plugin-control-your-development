/*
 * entries/impactModel.ts —— 每轮影响（03 §7.1 / 06 A43-2）的**纯逻辑**。
 *
 * 计数口径（03 §7.1，唯一实现；T08 的轮次带 tooltip 用的是同一套计数语义）：
 *   n = 本轮不同文件数 + 命令数 + 子智能体数 + (错误数 > 0 ? 1 : 0)
 * 同一文件多次只算 1；错误只作为 1 个"问题"计数，弹层里另行给出具体错误数。
 *
 * 只渲染在哪条消息上（T09 的硬要求）：
 * - 优先 `turn.finalMessageId`（宿主归约器给的最后一条已定稿 assistant 消息）；
 * - 没有 finalMessageId 时，按 turn 去重到 `messageIds` 的最后一条（确定性，不依赖挂载顺序）；
 * - `messageTurns[messageId]` 找不到 → 序列不可得 → 调用方**不渲染**（不猜）。
 */
import type { SessionDetail, TurnDetail } from '../../shared/events/index.ts'

/** 一轮的计数（与 03 §7.1 一致）。 */
export interface ImpactCounts {
  files: number
  commands: number
  subagents: number
  errors: number
  /** 弹层标题上的 N。0 表示"没有影响"，调用方不渲染。 */
  n: number
}

/** 计算一轮的影响计数（纯函数）。 */
export function impactOf(turn: TurnDetail): ImpactCounts {
  const paths = new Set<string>()
  for (const file of turn.files) paths.add(file.path.toLowerCase())
  const files = paths.size
  const commands = turn.commands.length
  const subagents = turn.subagents.length
  const errors = turn.errors
  return { files, commands, subagents, errors, n: files + commands + subagents + (errors > 0 ? 1 : 0) }
}

/** 该轮影响应该渲染在哪条消息上（null = 没有可用的消息锚点）。 */
export function impactAnchorOf(turn: TurnDetail): string | null {
  const final = turn.finalMessageId
  if (typeof final === 'string' && final !== '') return final
  const ids = turn.messageIds
  for (let index = ids.length - 1; index >= 0; index -= 1) {
    const id = ids[index]
    if (typeof id === 'string' && id !== '') return id
  }
  return null
}

/** `messageId → 本轮`（序列不可得返回 null）。 */
export function turnOfMessage(detail: SessionDetail | null, messageId: string): TurnDetail | null {
  if (detail === null || messageId === '') return null
  const number = detail.messageTurns[messageId]
  if (typeof number === 'number' && Number.isFinite(number)) {
    const byMap = detail.turns.find((turn) => turn.n === number)
    if (byMap !== undefined) return byMap
  }
  // 0.2.2 的 durable message id 可能与事件 id 有前缀/大小写差异 → 线性兜底（数组很小）
  const lower = messageId.toLowerCase()
  for (const turn of detail.turns) {
    for (const id of turn.messageIds) {
      if (typeof id === 'string' && id.toLowerCase() === lower) return turn
    }
  }
  return null
}

/** 该消息是否是本轮"影响 N"的渲染锚点（只在锚点上渲染一次）。 */
export function isImpactAnchor(turn: TurnDetail, messageId: string): boolean {
  return impactAnchorOf(turn) === messageId
}

/** hidden 的可观测原因（D-27 的可观测要求；组件会渲染 display:none 的标记节点）。 */
export type ImpactHiddenReason = 'no-message-id' | 'no-session-id' | 'no-turn' | 'not-anchor' | 'zero-impact'

/** 入口的三态判定结果（组件只渲染，不做判断）。 */
export type ImpactDecision =
  | { kind: 'hidden'; reason: ImpactHiddenReason }
  /**
   * `streaming`：**这一轮还在记录**，我们还判断不了它的影响。
   * 2026-11-05 真机反馈「每轮图标又消失了」的根因：detail 是 partial（live 会话只读到已落盘前缀）时，
   * `messageTurns[messageId]` 可能还没有对应轮次 —— 这属于「未知」，不是「没有影响」。
   * 按 10 §2.1「0 与未知」：未知要显示为未知态（灰色图标 + "本轮仍在记录"），**不许静默隐藏**。
   */
  | { kind: 'streaming' }
  | { kind: 'loading' }
  | { kind: 'unknown' }
  | { kind: 'ready'; turn: TurnDetail; counts: ImpactCounts }

/**
 * 决定「影响 N」此刻该显示什么（03 §2.2 / 06 N-15）。
 *
 * - `messageId` / `sessionId` 缺失 → hidden（不是我们的消息）
 * - 详情未到 → loading（灰「影响 …」）
 * - 详情失败 → unknown（灰「影响 ?」）
 * - 序列不可得 / 非锚点消息 / n===0 → **hidden**（不显示"影响 0"）
 * - 否则 ready
 */
/**
 * detail 是否还没读全（live 会话只读到已落盘前缀 / 被截断）。
 * 判定来源是 host 归约器的显式字段，不猜：`partial === true` 或 `truncated` 任一为真；
 * 也把 `status === 'running'` 算进来（轮次还没结束，末条消息可能还在变）。
 */
export function isIncompleteDetail(detail: SessionDetail): boolean {
  if (detail.partial === true) return true
  if (detail.truncated !== undefined && detail.truncated !== null) {
    const flags = detail.truncated as unknown as Record<string, unknown>
    for (const value of Object.values(flags)) if (value === true) return true
  }
  return detail.status === 'running'
}

export function decideImpact(input: {
  messageId: string
  sessionId: string
  detail: SessionDetail | null
  status: 'idle' | 'loading' | 'ready' | 'error'
}): ImpactDecision {
  if (input.messageId === '') return { kind: 'hidden', reason: 'no-message-id' }
  if (input.sessionId === '') return { kind: 'hidden', reason: 'no-session-id' }
  if (input.detail === null) return input.status === 'error' ? { kind: 'unknown' } : { kind: 'loading' }
  const incomplete = isIncompleteDetail(input.detail)
  const turn = turnOfMessage(input.detail, input.messageId)
  if (turn === null) {
    // 数据还没读全（live / 截断）⇒ 未知态，不隐藏（隐藏会被读成"这一轮没有影响"）
    return incomplete ? { kind: 'streaming' } : { kind: 'hidden', reason: 'no-turn' }
  }
  if (!isImpactAnchor(turn, input.messageId)) return { kind: 'hidden', reason: 'not-anchor' }
  const counts = impactOf(turn)
  if (counts.n === 0) {
    // 同一轮里已读到内容但计数为 0：若是未读全，仍按"正在记录"显示
    return incomplete ? { kind: 'streaming' } : { kind: 'hidden', reason: 'zero-impact' }
  }
  return { kind: 'ready', turn, counts }
}

/** 一站式：消息 → 该轮 + 计数（不该渲染时返回 null）。 */
export function impactForMessage(
  detail: SessionDetail | null,
  messageId: string,
): { turn: TurnDetail; counts: ImpactCounts; anchor: string } | null {
  const turn = turnOfMessage(detail, messageId)
  if (turn === null) return null
  if (!isImpactAnchor(turn, messageId)) return null
  const counts = impactOf(turn)
  if (counts.n === 0) return null
  return { turn, counts, anchor: messageId }
}
