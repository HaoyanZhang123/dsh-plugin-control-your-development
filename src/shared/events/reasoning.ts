/*
 * shared/events/reasoning.ts —— 从 assistant/message 事件里抽取思维链样本（D-35）。
 *
 * 为什么单独一个文件：
 * - `textFromContent` 会把**所有** text 块拼起来（含 reasoning 块），直接拿它当正文
 *   会把思维链混进"助手回复"，字符占比就算错了；
 * - reasoning 的 token 归属只认 provider 上报的 usage，字段缺失时必须保持 undefined。
 *
 * 本文件只做"从一条事件里读出结构化事实"，不做聚合（聚合在 shared/reasoning）。
 */
import type { ReasoningSample } from '../reasoning/index.ts'

/** 宽松读取：事件 data 是 unknown，这里只认形状，不确定就返回 undefined。 */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function asFiniteNonNegative(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

/** 单个内容块 → { reasoningTexts, answerText }。 */
export interface ContentSplit {
  /** type==='reasoning' 的块文本（按出现顺序）。 */
  reasoning: string[]
  /** 非 reasoning 的 text 块（这是"助手回复"口径，用于字符占比分母）。 */
  answer: string
}

/**
 * 拆分 content：reasoning 块与普通文本块分开。
 *
 * 兼容两种形状：
 * - `content: string`（纯文本回复，没有 reasoning）；
 * - `content: Array<{type, text}>`（含 `type: 'reasoning'` 的块）。
 * 未知块类型一律当作普通文本（宁可算进回复，也不吞掉）。
 */
export function splitAssistantContent(value: unknown): ContentSplit {
  const direct = asString(value)
  if (direct !== undefined) return { reasoning: [], answer: direct }
  if (!Array.isArray(value)) return { reasoning: [], answer: '' }
  const reasoning: string[] = []
  const answers: string[] = []
  for (const block of value) {
    const record = asRecord(block)
    if (record === undefined) continue
    const text = asString(record.text)
    if (text === undefined || text === '') continue
    if (asString(record.type) === 'reasoning') reasoning.push(text)
    else answers.push(text)
  }
  return { reasoning, answer: answers.join('\n') }
}

/** usage 里我们只关心这两个数（其它字段不参与思维链统计）。 */
export interface UsageFacts {
  reasoningTokens?: number
  totalTokens?: number
}

/**
 * 读取 provider 上报的 usage。
 *
 * 优先 `data.usage`（assistant/message 上直接带的），否则退到 `data.stream.usage`
 * （流式记录里最后一条 usage）。两个都没有 → 返回空对象（**不是 0**）。
 */
export function readUsage(data: Record<string, unknown>): UsageFacts {
  const candidates: unknown[] = []
  if (data.usage !== undefined) candidates.push(data.usage)
  const stream = asRecord(data.stream)
  if (stream !== undefined && stream.usage !== undefined) candidates.push(stream.usage)
  for (const candidate of candidates) {
    const record = asRecord(candidate)
    if (record === undefined) continue
    const reasoningTokens = asFiniteNonNegative(record.reasoningTokens)
    const totalRaw = asFiniteNonNegative(record.totalTokens)
    const outputTokens = asFiniteNonNegative(record.outputTokens)
    if (reasoningTokens === undefined && totalRaw === undefined && outputTokens === undefined) continue
    /* totalTokens 缺省时**不自行相加**：input+output 的口径可能与 provider 的报告不同，
     * 自行拼出来的分母会让"占总 token"变成一个我们编的数。宁可让占比未知。 */
    const facts: UsageFacts = {}
    if (reasoningTokens !== undefined) facts.reasoningTokens = reasoningTokens
    if (totalRaw !== undefined) facts.totalTokens = totalRaw
    return facts
  }
  return {}
}

/**
 * 从一条 `assistant/message` 事件生成思维链样本。
 *
 * 返回空数组的情形：没有 reasoning 块、或被中断且内容为空 —— 不伪造空样本。
 * `interrupted` 只影响 kind（committed/attempt），不影响是否统计。
 */
export function samplesFromAssistantMessage(input: {
  data: Record<string, unknown>
  sessionId: string
  turn: number | null
  model?: string
  preset?: string
  at: number
}): ReasoningSample[] {
  const data = input.data
  const message = asRecord(data.message)
  const content = message?.content ?? data.content
  const split = splitAssistantContent(content)
  if (split.reasoning.length === 0) return []
  const usage = readUsage(data)
  const interrupted = data.interrupted === true
  const source = asRecord(message?.source)
  const model =
    asString(source?.model) ?? input.model ?? undefined
  const sample: ReasoningSample = {
    /* 多个 reasoning 块合成一条样本：它们属于同一次回复，token 是整条回复的。 */
    text: split.reasoning.join('\n'),
    answerText: split.answer,
    sessionId: input.sessionId,
    turn: input.turn,
    at: input.at,
    kind: interrupted ? 'attempt' : 'committed',
    ...(usage.reasoningTokens === undefined ? {} : { tokens: usage.reasoningTokens }),
    ...(usage.totalTokens === undefined ? {} : { totalTokens: usage.totalTokens }),
    ...(model === undefined || model === '' ? {} : { model }),
    ...(input.preset === undefined || input.preset === '' ? {} : { preset: input.preset }),
  }
  return [sample]
}
