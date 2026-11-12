/*
 * client/ui/reasoning/model.ts —— 思维链视图的状态与派生（纯函数，可单测）。
 *
 * 边界：
 * - **不做统计**：聚合一律走 shared/reasoning（唯一口径）；这里只做筛选、排序、视图映射；
 * - 不碰 DOM / 不写存储；所有函数同输入同输出。
 *
 * 1.5.5 修的两个真机缺陷（都在这个文件里）：
 * 1. **语言筛选是个摆设**：`ReasoningView` 会改 `filter.lang`，而 `filterSamples()` 明确不做
 *    语言过滤（语言是逐句判定的，样本级没有该字段），`deriveReasoning()` 也从没调用过
 *    `sentencesByLang()` —— 于是选任何语言，图表一个字都不变。现在语言筛选真正进入聚合
 *    （见 `aggregateReasoning` 的 `lang` 选项），字符/token/分组/句子明细同一个口径。
 * 2. **Preset 是个隐性状态**：`ReasoningFilter` 有 `preset`，注释也写「五个筛选」，
 *    但工具栏只渲染了四个，用户永远看不到也改不了它。现在有真实选项枚举（`presetOptionsOf`）
 *    和真实入口（工具栏「更多筛选」）。
 */
import {
  aggregateReasoning,
  sortGroupsByChars,
  type ReasoningDimension,
  type ReasoningForm,
  type ReasoningGroup,
  type ReasoningLang,
  type ReasoningSample,
  type ReasoningSentence,
  type ReasoningTotals,
  type ReasoningView,
} from '../../../shared/reasoning/index.ts'

/** 统计范围：当前工作区（含归档）/ 仅未归档 / 当前会话。 */
export type ReasoningRange = 'workspace' | 'active' | 'session'

/** 记录类型：只看正式回复 / 含中断尝试。 */
export type ReasoningRecord = 'committed' | 'all'

/** 轮次筛选：某一轮（1 起）、全部轮次，或归属未知的轮次。 */
export type ReasoningTurn = number | 'all' | 'unknown'

export interface ReasoningFilter {
  range: ReasoningRange
  /**
   * 轮次（1.5.5 新增）。
   *
   * 真机反馈：「思维链应该只统计这一个对话的内容即可，按脉络页的逻辑切换不同轮次就行」。
   * 所以轮次是**一级筛选**，与 range 正交：range 决定看哪些会话，turn 决定看哪些轮。
   * `'all'` = 该范围内的全部轮次。
   */
  turn: ReasoningTurn
  model: string
  preset: string
  lang: string
  record: ReasoningRecord
}

export const DEFAULT_FILTER: ReasoningFilter = {
  /*
   * 1.5.5：默认范围从 `workspace` 改为 **`session`**。
   *
   * 真机反馈：打开思维链看到的是「已加载 5/299 个会话」+ 全局 6280 组，
   * 而用户要的是"这一个对话的思维链"。全工作区仍然可选（范围下拉），
   * 但不该是默认 —— 那既慢，又让人误以为在看当前会话。
   */
  range: 'session',
  turn: 'all',
  model: 'all',
  preset: 'all',
  lang: 'all',
  record: 'committed',
}

/** 筛选维度（用于"活动筛选行"与"重置"，与 `ReasoningFilter` 的键一一对应）。 */
export const FILTER_KEYS = ['range', 'turn', 'model', 'lang', 'record', 'preset'] as const
export type FilterKey = (typeof FILTER_KEYS)[number]

/** 会话元数据（筛选 range 用；来自 workspace scope，不在这里发明）。 */
export interface ReasoningSessionMeta {
  archived: boolean
}

export interface ReasoningInput {
  samples: readonly ReasoningSample[]
  /** 样本所属会话的归档状态（缺省视为未归档）。 */
  sessions?: Readonly<Record<string, ReasoningSessionMeta>>
  filter: ReasoningFilter
  dimension: ReasoningDimension
  /** 当前会话 id（range === 'session' 时用）。 */
  currentSessionId?: string
}

/**
 * 过滤样本：range / turn / model / preset / record 五个**样本级**维度。
 *
 * 语言仍在聚合层做（它是逐句判定的，样本级没有该字段）。
 */
export function filterSamples(input: ReasoningInput): ReasoningSample[] {
  const { samples, filter } = input
  return samples.filter((sample) => {
    if (filter.record === 'committed' && sample.kind !== 'committed') return false
    if (filter.range === 'session' && input.currentSessionId !== undefined && sample.sessionId !== input.currentSessionId) return false
    if (filter.range === 'session' && input.currentSessionId === undefined) return false
    if (filter.range === 'active' && input.sessions?.[sample.sessionId]?.archived === true) return false
    /* 轮次：具体轮次精确匹配；`'unknown'` 只留 `turn === null` 的样本；`all` 全要。 */
    if (filter.turn !== 'all') {
      if (filter.turn === 'unknown') {
        if (sample.turn !== null) return false
      } else if (sample.turn !== filter.turn) return false
    }
    /*
     * 1.5.4 修的真机缺陷：旧实现把模型名**写死**成 'DeepSeek V4' / 'Kimi K3'，
     * 而真实 `sample.model` 是 `deepseek/deepseek-v4.1-flash` / `k3` / `k3-256k`
     * （实测 2521 条真实样本的分布就是这样）→ 选任何一项都会把样本全滤掉，
     * 只剩「全部」和「其他」还能出数据，用户看到的就是「只显示全部和其他」。
     *
     * 现在 `filter.model` 是**从真实样本里枚举出来的原值**（见 `modelOptionsOf`），
     * 这里只做精确匹配 + `all` 通配，不再猜别名。
     */
    if (filter.model !== 'all' && (sample.model ?? '') !== filter.model) return false
    if (filter.preset !== 'all' && (sample.preset ?? '') !== filter.preset) return false
    /*
     * 语言**不在这里**做：语言是逐句判定的（`ReasoningSentence.lang`），样本级没有该字段。
     * 在样本层"猜"这条样本是什么语言就是造第二套口径 —— 语言筛选在聚合层做，
     * 见 `aggregateReasoning(samples, dimension, { lang })`。
     */
    return true
  })
}

/** 从样本里枚举出**真实存在的**模型值（按字符数降序），供筛选器直接使用。 */
export function modelOptionsOf(samples: readonly ReasoningSample[]): Array<{ value: string; chars: number; count: number }> {
  return optionStatsOf(
    samples.map((sample) => ({ value: sample.model ?? '', chars: typeof sample.text === 'string' ? sample.text.length : 0 })),
  )
}

/**
 * 同理：从样本里枚举真实的 preset 值（1.5.5 补齐 —— 在此之前 `filter.preset` 没有入口）。
 *
 * preset 是宿主给的名字（`default` / `plan` / 自定义……），只能枚举不能写死。
 */
export function presetOptionsOf(samples: readonly ReasoningSample[]): Array<{ value: string; chars: number; count: number }> {
  return optionStatsOf(
    samples.map((sample) => ({ value: sample.preset ?? '', chars: typeof sample.text === 'string' ? sample.text.length : 0 })),
  )
}

/** 同理：从**句子**里枚举真实存在的语言值（语言是逐句判定的，样本级没有该字段）。 */
export function langOptionsOf(sentences: readonly ReasoningSentence[]): Array<{ value: string; chars: number; count: number }> {
  return optionStatsOf(sentences.map((sentence) => ({ value: sentence.lang ?? '', chars: sentence.chars })))
}

/** 三个选项枚举的公共聚合（空值跳过；同字符量按键升序，保证确定性）。 */
function optionStatsOf(entries: ReadonlyArray<{ value: string; chars: number }>): Array<{ value: string; chars: number; count: number }> {
  const byValue = new Map<string, { chars: number; count: number }>()
  for (const entry of entries) {
    if (entry.value === '') continue
    const previous = byValue.get(entry.value)
    if (previous === undefined) byValue.set(entry.value, { chars: entry.chars, count: 1 })
    else {
      previous.chars += entry.chars
      previous.count += 1
    }
  }
  return [...byValue.entries()]
    .map(([value, stats]) => ({ value, chars: stats.chars, count: stats.count }))
    .sort((left, right) => right.chars - left.chars || (left.value < right.value ? -1 : 1))
}

export interface ReasoningDerived {
  totals: ReasoningTotals
  groups: ReasoningGroup[]
  /** 句式开头分组（右侧排行永远按句首；与当前维度无关）。 */
  prefixGroups: ReasoningGroup[]
  /** 句子明细（已按语言筛选；列表与下钻用）。 */
  sentences: ReasoningSentence[]
  /** 有 token 上报的样本组数（用于 UI 说明覆盖率）。 */
  knownGroups: number
  /**
   * **语言筛选生效之前**的句子（只用于枚举语言选项）。
   *
   * 为什么要它：语言选项如果从"筛选后的句子"枚举，用户选了「中文」之后，
   * 英语/混合两项就会从下拉里消失 —— 那不是"没有数据"，是控件被自己的选择吃掉了。
   */
  allSentences: ReasoningSentence[]
  /** 当前筛选下实际参与统计的样本数（0 = 空结果，UI 要说清是哪个条件滤空的）。 */
  sampleCount: number
  /**
   * 可选轮次（1.5.5）。
   *
   * 从**样本级过滤之后、轮次过滤之前**的集合枚举——否则选了 T3 之后，
   * 其他轮次就会从轮次带里消失（与语言选项同一个坑）。
   * 只列真正有 reasoning 样本的轮次，`turn === null`（归属未知）单列一项。
   */
  turnOptions: Array<{ value: ReasoningTurn; label: string }>
}

/** 轮次过滤之前可用的样本（枚举轮次选项用；不参与任何统计）。 */
function samplesBeforeTurn(input: ReasoningInput): ReasoningSample[] {
  return filterSamples({ ...input, filter: { ...input.filter, turn: 'all' } })
}

/** 一次派生：样本级过滤 → （句级语言过滤）→ 聚合（当前维度 + 句首维度）。 */
export function deriveReasoning(input: ReasoningInput): ReasoningDerived {
  const samples = filterSamples(input)
  const lang = input.filter.lang === 'all' ? 'all' : (input.filter.lang as ReasoningLang)
  const main = aggregateReasoning(samples, input.dimension, { lang })
  const prefix = aggregateReasoning(samples, 'prefix', { lang })
  /*
   * 语言选项的枚举口径 = **句级过滤之前**。
   * lang 为 all 时复用 main（省一次整场聚合；23k 组时这很关键）。
   */
  const allSentences = lang === 'all' ? main.sentences : aggregateReasoning(samples, input.dimension).sentences
  /* 轮次选项：从轮次过滤之前的样本枚举（升序，未知轮次单独一项）。 */
  const turnSet = new Set<number>()
  let hasUnknownTurn = false
  for (const sample of samplesBeforeTurn(input)) {
    if (sample.turn === null) hasUnknownTurn = true
    else turnSet.add(sample.turn)
  }
  const turnOptions: Array<{ value: ReasoningTurn; label: string }> = [{ value: 'all', label: 'all' }]
  for (const turn of [...turnSet].sort((left, right) => left - right)) {
    turnOptions.push({ value: turn, label: 'T' + String(turn) })
  }
  if (hasUnknownTurn) turnOptions.push({ value: 'unknown', label: 'unknown' })
  return {
    totals: main.totals,
    groups: sortGroupsByChars(main.groups),
    prefixGroups: sortGroupsByChars(prefix.groups),
    sentences: main.sentences,
    knownGroups: main.groups.filter((group) => group.outputTokens > 0).length,
    allSentences,
    sampleCount: samples.length,
    turnOptions,
  }
}

/** 按语言筛句（句级工具；聚合层的语言筛选见 `aggregateReasoning` 的 `lang` 选项）。 */
export function sentencesByLang(sentences: readonly ReasoningSentence[], lang: ReasoningLang | 'all'): ReasoningSentence[] {
  if (lang === 'all') return sentences.slice()
  return sentences.filter((sentence) => sentence.lang === lang)
}

/** 按句首取句子（排行点击后下钻）。 */
export function sentencesByPrefix(sentences: readonly ReasoningSentence[], prefix: string): ReasoningSentence[] {
  return sentences.filter((sentence) => sentence.prefix === prefix)
}

/**
 * 当前筛选里**真正在生效**的条件（"活动筛选行"用）。
 *
 * 只列非默认值：默认值不占高度（方案 §6.1 第 3 条），有筛选才出现，并给"重置"。
 */
export function activeFilterKeys(filter: ReasoningFilter): FilterKey[] {
  const keys: FilterKey[] = []
  for (const key of FILTER_KEYS) {
    if (filter[key] !== DEFAULT_FILTER[key]) keys.push(key)
  }
  return keys
}

/** 重置为默认（只重置传入的那一个键）。 */
export function resetFilterKey(filter: ReasoningFilter, key: FilterKey): ReasoningFilter {
  return { ...filter, [key]: DEFAULT_FILTER[key] }
}

/** 分组维度的中文标签（供 UI；不在组件里写死中文）。 */
export function dimensionLabelKey(dimension: ReasoningDimension): string {
  switch (dimension) {
    case 'prefix':
      return 'reasoning.dimPrefix'
    case 'form':
      return 'reasoning.dimForm'
    case 'lang':
      return 'reasoning.dimLang'
    case 'model':
      return 'reasoning.dimModel'
    case 'preset':
      return 'reasoning.dimPreset'
  }
}

/** 句式类型的标签 key（与共享类型的 5 种一一对应）。 */
export function formLabelKey(form: ReasoningForm): string {
  switch (form) {
    case 'plan':
      return 'reasoning.formPlan'
    case 'question':
      return 'reasoning.formQuestion'
    case 'imperative':
      return 'reasoning.formImperative'
    case 'warning':
      return 'reasoning.formWarning'
    case 'statement':
      return 'reasoning.formStatement'
  }
}

/** 语言标签 key。 */
export function langLabelKey(lang: ReasoningLang): string {
  switch (lang) {
    case 'zh':
      return 'reasoning.langZh'
    case 'en':
      return 'reasoning.langEn'
    case 'ja':
      return 'reasoning.langJa'
    case 'ko':
      return 'reasoning.langKo'
    case 'mixed':
      return 'reasoning.langMixed'
    case 'unknown':
      return 'reasoning.langUnknown'
  }
}

/** 视图切换（三选一；非法值回落到 treemap）。 */
export function normalizeView(value: string): ReasoningView {
  return value === 'cloud' || value === 'list' ? value : 'treemap'
}
