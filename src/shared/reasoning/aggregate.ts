/*
 * shared/reasoning/aggregate.ts —— 思维链聚合（纯函数）。
 *
 * 口径纪律（与 types.ts 的注释一一对应，测试逐条守着）：
 * 1. `tokens`/`totalTokens` **只累加两者齐备**的样本；任一缺失就整条跳过 token 维度，
 *    但字符维度照常统计 —— 这样"有正文没 usage"的记录不会污染 token 占比。
 * 2. `tokenRatio` 只在 totalTokens > 0 时给值；否则 null（UI 必须显示未知，不得显示 0%）。
 * 3. `charRatio` 的分母是「思维链字符 + 助手回复字符」，与 token 无关。
 * 4. 语言/句式/前缀都是启发式结果，聚合只做加权求和，不改判类别。
 */
import {
  countChars,
  detectForm,
  detectLang,
  extractPrefix,
  splitSentences,
  truncateSentence,
} from './sentences.ts'
import type {
  ReasoningDimension,
  ReasoningForm,
  ReasoningGroup,
  ReasoningLang,
  ReasoningSentence,
  ReasoningTotals,
} from './types.ts'

/** 一条待聚合的思维链样本（host 归约产物；client 只读）。 */
export interface ReasoningSample {
  /** 思维链文本（一段 = 一个 reasoning 块）。 */
  text: string
  /** 同一条 assistant 回复的可见正文（用于字符占比分母；可缺省）。 */
  answerText?: string
  /** provider 上报的 reasoningTokens；缺省 = 未知。 */
  tokens?: number
  /**
   * provider 上报的 outputTokens；缺省 = 未知。
   *
   * 「思维链占输出多少」= tokens / outputTokens，是唯一有意义占比口径
   * （见 `ReasoningTotals.tokenRatio` 的说明）。
   */
  outputTokens?: number
  /** provider 上报的 totalTokens（上下文口径，含输入与缓存）；缺省 = 未知。 */
  totalTokens?: number
  sessionId: string
  turn: number | null
  model?: string
  preset?: string
  at: number
  kind: 'committed' | 'attempt'
}

/** 把一条样本切成句子（带归属与分类）。 */
export function samplesToSentences(sample: ReasoningSample): ReasoningSentence[] {
  const sentences = splitSentences(sample.text)
  const out: ReasoningSentence[] = []
  for (const sentence of sentences) {
    const text = truncateSentence(sentence)
    out.push({
      prefix: extractPrefix(sentence),
      text,
      chars: countChars(sentence),
      lang: detectLang(sentence),
      form: detectForm(sentence),
      sessionId: sample.sessionId,
      turn: sample.turn,
      model: sample.model === undefined || sample.model === '' ? null : sample.model,
      preset: sample.preset === undefined || sample.preset === '' ? null : sample.preset,
      at: sample.at,
      kind: sample.kind,
    })
  }
  return out
}

/** 样本是否带齐 token 维度（两者都是有限非负数）。 */
/**
 * 样本是否带齐 token 维度。
 *
 * 1.5.5 口径变更：必需项从 `tokens + totalTokens` 改成 **`tokens + outputTokens`**。
 * 原因：`totalTokens` 是**上下文**口径（含输入与缓存），拿它当分母算出的
 * 「占总 token」实测中位数只有 0.13%，没有解释力；有意义的分母是 `outputTokens`。
 * `totalTokens` 降级为可选（只用于「占上下文」那一列的如实展示，缺了就显示未知）。
 */
export function hasTokens(sample: ReasoningSample): boolean {
  return (
    typeof sample.tokens === 'number' &&
    Number.isFinite(sample.tokens) &&
    sample.tokens >= 0 &&
    typeof sample.outputTokens === 'number' &&
    Number.isFinite(sample.outputTokens) &&
    sample.outputTokens > 0
  )
}

/** 按维度取分组键；`prefix` 走句首短语，其余走类别标签。 */
export function groupKeyOf(sentence: ReasoningSentence, dimension: ReasoningDimension): string {
  switch (dimension) {
    case 'prefix':
      return sentence.prefix
    case 'form':
      return sentence.form
    case 'lang':
      return sentence.lang
    case 'model':
      return sentence.model ?? 'unknown'
    case 'preset':
      return sentence.preset ?? 'unknown'
  }
}

/** 主要语言：按字符加权取最大；并列时按固定顺序，保证确定性。 */
const LANG_ORDER: readonly ReasoningLang[] = ['zh', 'en', 'ja', 'ko', 'mixed', 'unknown']

function dominantLang(langs: Partial<Record<ReasoningLang, number>>): ReasoningLang {
  let best: ReasoningLang = 'unknown'
  let bestValue = -1
  for (const lang of LANG_ORDER) {
    const value = langs[lang] ?? 0
    if (value > bestValue) {
      bestValue = value
      best = lang
    }
  }
  return best
}

/** 主要句式：同样按字符加权。 */
const FORM_ORDER: readonly ReasoningForm[] = ['plan', 'question', 'imperative', 'warning', 'statement']

function dominantForm(forms: Partial<Record<ReasoningForm, number>>): ReasoningForm {
  let best: ReasoningForm = 'statement'
  let bestValue = -1
  for (const form of FORM_ORDER) {
    const value = forms[form] ?? 0
    if (value > bestValue) {
      bestValue = value
      best = form
    }
  }
  return best
}

/** 空分组（内部构造用）。 */
function emptyGroup(key: string): ReasoningGroup {
  return {
    key,
    chars: 0,
    answerChars: 0,
    tokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    knownChars: 0,
    blocks: 0,
    sentences: 0,
    lang: 'unknown',
    langs: {},
    models: {},
    presets: {},
    forms: {},
  }
}

function bump(map: Record<string, number>, key: string, amount: number): void {
  map[key] = (map[key] ?? 0) + amount
}

function bumpLang(map: Partial<Record<ReasoningLang, number>>, key: ReasoningLang, amount: number): void {
  map[key] = (map[key] ?? 0) + amount
}

function bumpForm(map: Partial<Record<ReasoningForm, number>>, key: ReasoningForm, amount: number): void {
  map[key] = (map[key] ?? 0) + amount
}

export interface AggregateResult {
  /** 按维度分组（顺序 = 首次出现顺序；调用方不依赖顺序时应自行排序）。 */
  groups: ReasoningGroup[]
  totals: ReasoningTotals
  /** 句子明细（供列表与下钻；已截断文本）。 */
  sentences: ReasoningSentence[]
}

/**
 * 聚合选项（1.5.5：语言筛选真正进入派生管线）。
 *
 * 为什么语言筛选必须在**这一层**做，而不是在样本层：
 * `ReasoningSample` 没有 `lang`（语言是逐句判定的），样本层过滤只能靠"猜这条样本是什么语言"，
 * 那会造出第二套统计口径。正确做法是：聚合时**只统计语言匹配的句子** ——
 * 字符、token、分组、句子明细全部同一个口径，与「按语言看思维链」这句话的字面意思一致。
 *
 * 副作用（已知且有意）：一条样本的 reasoningTokens 是整段的，句子被筛掉一部分后
 * token 仍按"样本主要归属组"计入 —— 与原有的 token 归因近似是同一条规则，不新增偏差来源。
 */
export interface AggregateOptions {
  /** 只统计该语言的句子；`'all'` 或省略 = 不筛。 */
  lang?: ReasoningLang | 'all'
}

/**
 * 聚合（纯函数，确定性）。
 *
 * **token 归属规则（1.5.5 重做；这是"观测不到"的根因）**：
 * provider 只上报**整段** reasoningTokens / outputTokens / totalTokens，不存在逐句精确值。
 * 旧实现把整段 token 只记给"字符占优"的那一组 → 其余组一律 `tokens = 0`，
 * 于是 6280 个组里绝大多数显示「未知」。这不是数据缺失，是口径把数据丢了。
 *
 * 现在：同一段 thought 内，token 按各组的**字符占比分配**。
 * - 守恒：各组分配之和 = 该段真实 token（不放大、不缩水）；
 * - 诚实：这是估算，UI 必须能标注（`reasoning.estimated`）；
 * - 不摊到句子：句子级仍然没有 token（那是 provider 根本不给的量级）。
 */
export function aggregateReasoning(
  samples: readonly ReasoningSample[],
  dimension: ReasoningDimension,
  options?: AggregateOptions,
): AggregateResult {
  const langFilter = options?.lang ?? 'all'
  const byKey = new Map<string, ReasoningGroup>()
  const sentences: ReasoningSentence[] = []
  let chars = 0
  let answerChars = 0
  let tokens = 0
  let outputTokens = 0
  let totalTokens = 0
  let knownChars = 0
  let knownBlocks = 0
  let blocks = 0

  for (const sample of samples) {
    const allSentences = samplesToSentences(sample)
    /* 语言筛选：句子级剔除，后续所有统计（字符/token/分组/明细）都只看保留下来的句子。 */
    const sampleSentences = langFilter === 'all' ? allSentences : allSentences.filter((sentence) => sentence.lang === langFilter)
    const sampleChars = sampleSentences.reduce((sum, sentence) => sum + sentence.chars, 0)
    if (sampleChars === 0) continue
    const sampleAnswerChars = countChars(sample.answerText ?? '')
    blocks += 1
    chars += sampleChars
    answerChars += sampleAnswerChars
    sentences.push(...sampleSentences)
    const tokenKnown = hasTokens(sample)
    if (tokenKnown) {
      tokens += sample.tokens as number
      outputTokens += sample.outputTokens as number
      totalTokens += sample.totalTokens as number
      knownChars += sampleChars
      knownBlocks += 1
    }

    /* 该段 thought 内，每个分组的字符量（token 分配的分母）。 */
    const localFormChars: Partial<Record<ReasoningForm, number>> = {}
    const localLangChars: Partial<Record<ReasoningLang, number>> = {}
    const localPerKey = new Map<string, number>()
    const localPerKeySentences = new Map<string, number>()
    for (const sentence of sampleSentences) {
      bumpForm(localFormChars, sentence.form, sentence.chars)
      bumpLang(localLangChars, sentence.lang, sentence.chars)
      const key = groupKeyOf(sentence, dimension)
      localPerKey.set(key, (localPerKey.get(key) ?? 0) + sentence.chars)
      localPerKeySentences.set(key, (localPerKeySentences.get(key) ?? 0) + 1)
    }

    for (const [key, value] of localPerKey) {
      const group = byKey.get(key) ?? emptyGroup(key)
      group.chars += value
      group.sentences += localPerKeySentences.get(key) ?? 0
      if (tokenKnown) {
        /*
         * 按字符占比分配这一段 thought 的 token（守恒：各组之和 = 整段）。
         * 用**浮点累加、最后统一取整**的口径会在组数很多时丢几个 token，
         * 这里直接按比例累加并在 UI 里取整显示 —— 误差 < 1 token/组，远小于 provider 精度。
         */
        const share = sampleChars > 0 ? value / sampleChars : 0
        group.tokens += (sample.tokens as number) * share
        group.outputTokens += (sample.outputTokens as number) * share
        group.totalTokens += (sample.totalTokens as number) * share
        group.knownChars += value
      }
      byKey.set(key, group)
    }
    /* 每组的 answerChars 只在"样本归属组"上计一次，避免分母被多组重复计。
     * 归属组 = 该段字符量最大的那组（与旧实现同一口径，只是不再用它独占 token）。 */
    let ownerKey: string | null = null
    let ownerChars = -1
    for (const [key, value] of localPerKey) {
      if (value > ownerChars) {
        ownerChars = value
        ownerKey = key
      }
    }
    if (ownerKey !== null) {
      const owner = byKey.get(ownerKey) ?? emptyGroup(ownerKey)
      owner.answerChars += sampleAnswerChars
      if (tokenKnown) owner.blocks += 1
      byKey.set(ownerKey, owner)
    }
    /* 模型 / preset / 语言 / 句式分布：按句子字符累加。 */
    for (const sentence of sampleSentences) {
      const key = groupKeyOf(sentence, dimension)
      const group = byKey.get(key) ?? emptyGroup(key)
      bump(group.models, sentence.model ?? 'unknown', sentence.chars)
      bump(group.presets, sentence.preset ?? 'unknown', sentence.chars)
      bumpLang(group.langs, sentence.lang, sentence.chars)
      bumpForm(group.forms, sentence.form, sentence.chars)
      byKey.set(key, group)
    }
  }

  const groups: ReasoningGroup[] = []
  for (const group of byKey.values()) {
    group.lang = dominantLang(group.langs)
    groups.push(group)
  }
  const totals: ReasoningTotals = {
    chars,
    answerChars,
    tokens,
    outputTokens,
    totalTokens,
    knownChars,
    blocks,
    sentences: sentences.length,
    coverage: chars > 0 ? knownChars / chars : null,
    /* 思维链占**输出**（有意义的口径）；outputTokens 缺失 → 未知，不是 0%。 */
    tokenRatio: outputTokens > 0 ? tokens / outputTokens : null,
    /* 占上下文（如实展示，不再冒充"占总 token"）。 */
    contextRatio: totalTokens > 0 ? tokens / totalTokens : null,
    /*
     * 字符占比：**没有正文时必须为 null**。
     * 实测本会话 150 条带 reasoning 的回复里只有 10 条有普通文本块，
     * 旧口径会算出 99.2%（"思维链占了几乎所有字符"）—— 那是分母缺失，不是事实。
     */
    charRatio: answerChars > 0 ? chars / (chars + answerChars) : null,
  }
  /* knownBlocks 目前只用于说明覆盖率口径的分子，避免"有 token 的块数"被误读成 blocks。 */
  void knownBlocks
  return { groups, totals, sentences }
}

/** 主要句式（导出给 UI 显示次要标签）。 */
export function primaryForm(group: ReasoningGroup): ReasoningForm {
  return dominantForm(group.forms)
}

/** 按字符数降序 + 键升序排序（确定性；排行与 treemap 共用）。 */
export function sortGroupsByChars(groups: readonly ReasoningGroup[]): ReasoningGroup[] {
  return groups.slice().sort((left, right) => {
    if (right.chars !== left.chars) return right.chars - left.chars
    return left.key < right.key ? -1 : left.key > right.key ? 1 : 0
  })
}

/** 句子文本裁剪为列表摘要（不改变 chars 口径，只影响展示）。 */
export function sentenceSummary(sentence: ReasoningSentence, max = 160): string {
  return truncateSentence(sentence.text, max)
}
