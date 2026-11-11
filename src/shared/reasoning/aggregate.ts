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
  /** provider 上报的 totalTokens；缺省 = 未知。 */
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
export function hasTokens(sample: ReasoningSample): boolean {
  return (
    typeof sample.tokens === 'number' &&
    Number.isFinite(sample.tokens) &&
    sample.tokens >= 0 &&
    typeof sample.totalTokens === 'number' &&
    Number.isFinite(sample.totalTokens) &&
    sample.totalTokens > 0
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
 * 聚合（纯函数，确定性）。
 *
 * token 归属规则：一条样本的 reasoningTokens 是**整段**的，不能平均摊到句子上；
 * 因此 token 只会累加到该样本所属的分组 —— 若一段思维链里出现多个句式，
 * 它的 token 会算进"主要句式"所在组（按字符占优的那个），并在 UI 上以覆盖率说明。
 * 这样做的好处：不伪造"每句精确 token"；代价：细分组的 token 有归因近似。
 */
export function aggregateReasoning(
  samples: readonly ReasoningSample[],
  dimension: ReasoningDimension,
): AggregateResult {
  const byKey = new Map<string, ReasoningGroup>()
  const sentences: ReasoningSentence[] = []
  let chars = 0
  let answerChars = 0
  let tokens = 0
  let totalTokens = 0
  let knownChars = 0
  let blocks = 0

  for (const sample of samples) {
    const sampleSentences = samplesToSentences(sample)
    const sampleChars = countChars(sample.text)
    const sampleAnswerChars = countChars(sample.answerText ?? '')
    if (sampleChars === 0) continue
    blocks += 1
    chars += sampleChars
    answerChars += sampleAnswerChars
    sentences.push(...sampleSentences)
    const tokenKnown = hasTokens(sample)
    if (tokenKnown) {
      tokens += sample.tokens as number
      totalTokens += sample.totalTokens as number
      knownChars += sampleChars
    }

    /* 该样本的 token 归到"字符占优"的那一组，避免摊薄成假精度。 */
    const localFormChars: Partial<Record<ReasoningForm, number>> = {}
    const localLangChars: Partial<Record<ReasoningLang, number>> = {}
    const localPerKey = new Map<string, number>()
    for (const sentence of sampleSentences) {
      bumpForm(localFormChars, sentence.form, sentence.chars)
      bumpLang(localLangChars, sentence.lang, sentence.chars)
      const key = groupKeyOf(sentence, dimension)
      localPerKey.set(key, (localPerKey.get(key) ?? 0) + sentence.chars)
    }
    let ownerKey: string | null = null
    let ownerChars = -1
    for (const [key, value] of localPerKey) {
      if (value > ownerChars) {
        ownerChars = value
        ownerKey = key
      }
    }

    for (const [key, value] of localPerKey) {
      const group = byKey.get(key) ?? emptyGroup(key)
      group.chars += value
      group.sentences += sampleSentences.filter((sentence) => groupKeyOf(sentence, dimension) === key).length
      if (tokenKnown && key === ownerKey) {
        group.tokens += sample.tokens as number
        group.totalTokens += sample.totalTokens as number
        group.knownChars += value
        group.blocks += 1
      }
      byKey.set(key, group)
    }
    /* 每组的 answerChars 只在"样本归属组"上计一次，避免分母被多组重复计。 */
    if (ownerKey !== null) {
      const owner = byKey.get(ownerKey) ?? emptyGroup(ownerKey)
      owner.answerChars += sampleAnswerChars
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
  /* 语言/句式的"主要项"用于 UI 的次要标签；这里写回 forms 的主项便于消费方直接读。 */
  const totals: ReasoningTotals = {
    chars,
    answerChars,
    tokens,
    totalTokens,
    knownChars,
    blocks,
    sentences: sentences.length,
    coverage: chars > 0 ? knownChars / chars : null,
    tokenRatio: totalTokens > 0 ? tokens / totalTokens : null,
    charRatio: chars + answerChars > 0 ? chars / (chars + answerChars) : null,
  }
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
