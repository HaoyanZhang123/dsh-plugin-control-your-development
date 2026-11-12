/*
 * shared/reasoning/types.ts —— 思维链统计的类型契约。
 *
 * 这里的类型是 host 归约、client 展示、测试断言共用的**唯一形状**；
 * 新增字段先改这里，再改两端，避免出现"两套统计口径"。
 */

/** 归约时识别的记录来源（committed = 正式 assistant/message；attempt = 未提交的尝试）。 */
export type ReasoningRecordKind = 'committed' | 'attempt'

/** 语言判定标签；`mixed`/`unknown` 用于无法确定主语言的情况（不硬猜）。 */
export type ReasoningLang = 'zh' | 'en' | 'ja' | 'ko' | 'mixed' | 'unknown'

/** 句首句式分类（启发式）。 */
export type ReasoningForm = 'plan' | 'question' | 'imperative' | 'warning' | 'statement'

/**
 * 一条思维链句子（**已做隐私与长度处理**；正文由调用方决定是否展示）。
 *
 * `tokens` 只在该句独占一整块且 provider 给了 reasoningTokens 时才可能精确，
 * 因此实际实现只在"整块"粒度上填 `tokens`；句子级默认 `null`（未知）。
 */
export interface ReasoningSentence {
  /** 句首短语（用于排行与分组）；取不到时为空串。 */
  prefix: string
  /** 句子正文（截断后的展示文本；隐私模式下由 UI 决定是否渲染）。 */
  text: string
  /** 非空白字符数（Unicode code point 计）。 */
  chars: number
  lang: ReasoningLang
  form: ReasoningForm
  /** 会话 id 与轮次（1 起）；未知为 null，不猜。 */
  sessionId: string
  turn: number | null
  /** 模型 / preset 标签；未知为 null。 */
  model: string | null
  preset: string | null
  /** 该句所属记录的时间（毫秒）。 */
  at: number
  kind: ReasoningRecordKind
}

/**
 * 一个思维链统计组（按句式 / 语言 / 模型 / preset 聚合后的结果）。
 *
 * 关键口径：`tokens` 与 `totalTokens` 只累加**齐备**的样本；
 * `knownChars` 记录这些样本贡献的字符数，用于算 token 覆盖率。
 */
export interface ReasoningGroup {
  key: string
  /** 非空白字符总数（全部样本，精确）。 */
  chars: number
  /** 「思维链 + 助手回复」的字符数（用于字符占比的分母，精确）。 */
  answerChars: number
  /**
   * provider 上报的 reasoningTokens 之和（1.5.5 起按字符比例**分配**到各组）。
   *
   * 口径说明（必须能向用户解释）：provider 只上报"整段" reasoningTokens，
   * 不存在逐句精确值。所以同一段 thought 内，token 按各组的字符占比分配 ——
   * 这是**估算**，不是伪造精度：它保证「每组的 token 加起来 = 该段真实 token」。
   * 旧实现只把整段 token 记给"字符占优"的那一组，导致 6280 个组里绝大多数显示"未知"。
   */
  tokens: number
  /**
   * provider 上报的 outputTokens 之和（同样按字符比例分配）。
   *
   * 为什么需要它：「占总 token」的正确分母是**输出**（思维链是输出的一部分），
   * 而不是上下文 totalTokens（后者含输入与缓存，实测会把 reasoning 占比稀释到 0.1%~2.7%）。
   */
  outputTokens: number
  /** provider 上报的 totalTokens 之和（上下文口径，仅齐备样本）。 */
  totalTokens: number
  /** 贡献了 token 的样本字符数（覆盖率分子）。 */
  knownChars: number
  /** 有效块数（非空 reasoning 块）。 */
  blocks: number
  /** 句子数。 */
  sentences: number
  /** 主要语言（按字符加权投票）。 */
  lang: ReasoningLang
  /** 各语言字符分布（用于语言视图与图例）。 */
  langs: Partial<Record<ReasoningLang, number>>
  /** 各模型字符分布。 */
  models: Record<string, number>
  /** 各 preset 字符分布。 */
  presets: Record<string, number>
  /** 各句式字符分布。 */
  forms: Partial<Record<ReasoningForm, number>>
}

/** 一次统计的总体结果（KPI 与"覆盖率"用）。 */
export interface ReasoningTotals {
  chars: number
  answerChars: number
  tokens: number
  /** provider 上报的 outputTokens 之和（「占总 token」的分母，1.5.5 起）。 */
  outputTokens: number
  totalTokens: number
  knownChars: number
  blocks: number
  sentences: number
  /** token 覆盖率 = knownChars / chars；`chars === 0` 时为 null。 */
  coverage: number | null
  /**
   * 思维链占**输出**的比例 = tokens / outputTokens。
   *
   * 1.5.5 语义纠正：旧实现是 tokens / totalTokens（上下文口径，含输入与缓存），
   * 实测本会话 151 条样本该比值中位数只有 **0.13%**、最大 2.66% —— 那不是
   * "思维链在输出里占多少"，而是"思维链在整个上下文里占多少"，被输入稀释了。
   * 按输出算，同批样本中位数是 **58.2%**，才是有意义的数。
   * `outputTokens === 0`（provider 未上报）时为 null（未知，不是 0%）。
   */
  tokenRatio: number | null
  /**
   * 思维链占**上下文**的比例 = tokens / totalTokens（如实展示，不再冒充"占总 token"）。
   * `totalTokens === 0` 时为 null。
   */
  contextRatio: number | null
  /**
   * 字符占比；分母为 0 时为 null。
   *
   * 1.5.5：`answerChars === 0`（该范围内所有回复都没有正文，只有 reasoning + 工具调用）
   * 时**必须返回 null**。实测本会话 150 条带 reasoning 的回复里只有 10 条有正文，
   * 旧口径会算出 99.2% 这种"思维链占了几乎所有字符"的假结论。
   */
  charRatio: number | null
}

/** 思维链视图的三种呈现（treemap / 图标云 / 列表）。 */
export type ReasoningView = 'treemap' | 'cloud' | 'list'

/** 分组维度。 */
export type ReasoningDimension = 'prefix' | 'form' | 'lang' | 'model' | 'preset'
