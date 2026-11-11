/*
 * client/ui/reasoning/model.ts —— 思维链视图的状态与派生（纯函数，可单测）。
 *
 * 边界：
 * - **不做统计**：聚合一律走 shared/reasoning（唯一口径）；这里只做筛选、排序、视图映射；
 * - 不碰 DOM / 不写存储；所有函数同输入同输出。
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

export interface ReasoningFilter {
  range: ReasoningRange
  model: string
  preset: string
  lang: string
  record: ReasoningRecord
}

export const DEFAULT_FILTER: ReasoningFilter = {
  range: 'workspace',
  model: 'all',
  preset: 'all',
  lang: 'all',
  record: 'committed',
}

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

/** 过滤样本：range / model / preset / lang / record 五个维度。 */
export function filterSamples(input: ReasoningInput): ReasoningSample[] {
  const { samples, filter } = input
  return samples.filter((sample) => {
    if (filter.record === 'committed' && sample.kind !== 'committed') return false
    if (filter.range === 'session' && input.currentSessionId !== undefined && sample.sessionId !== input.currentSessionId) return false
    if (filter.range === 'session' && input.currentSessionId === undefined) return false
    if (filter.range === 'active' && input.sessions?.[sample.sessionId]?.archived === true) return false
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
    /* 语言是**逐句**判定的（`ReasoningSentence.lang`），样本级没有 lang；
     * 因此语言筛选不在这里做，由 `sentencesByLang` 在句级承担。 */
    return true
  })
}

/**
 * 从样本里枚举出**真实存在的**模型值（按字符数降序），供筛选器直接使用。
 *
 * 为什么要枚举而不是写死：模型名是宿主任意字符串（`deepseek/deepseek-v4.1-flash`、
 * `k3-256k`……），写死必然与真机脱节——这正是 1.5.3「只显示全部和其他」的根因。
 */
export function modelOptionsOf(samples: readonly ReasoningSample[]): Array<{ value: string; chars: number; count: number }> {
  const byModel = new Map<string, { chars: number; count: number }>()
  for (const sample of samples) {
    const model = sample.model ?? ''
    if (model === '') continue
    const previous = byModel.get(model)
    const chars = typeof sample.text === 'string' ? sample.text.length : 0
    if (previous === undefined) byModel.set(model, { chars, count: 1 })
    else {
      previous.chars += chars
      previous.count += 1
    }
  }
  return [...byModel.entries()]
    .map(([value, stats]) => ({ value, chars: stats.chars, count: stats.count }))
    .sort((left, right) => right.chars - left.chars || (left.value < right.value ? -1 : 1))
}

/** 同理：从**句子**里枚举真实存在的语言值（语言是逐句判定的，样本级没有该字段）。 */
export function langOptionsOf(sentences: readonly ReasoningSentence[]): Array<{ value: string; chars: number; count: number }> {
  const byLang = new Map<string, { chars: number; count: number }>()
  for (const sentence of sentences) {
    const lang = sentence.lang
    if (lang === undefined || lang === null) continue
    const previous = byLang.get(lang)
    if (previous === undefined) byLang.set(lang, { chars: sentence.chars, count: 1 })
    else {
      previous.chars += sentence.chars
      previous.count += 1
    }
  }
  return [...byLang.entries()]
    .map(([value, stats]) => ({ value, chars: stats.chars, count: stats.count }))
    .sort((left, right) => right.chars - left.chars || (left.value < right.value ? -1 : 1))
}

export interface ReasoningDerived {
  totals: ReasoningTotals
  groups: ReasoningGroup[]
  /** 句式开头分组（右侧排行永远按句首；与当前维度无关）。 */
  prefixGroups: ReasoningGroup[]
  /** 句子明细（已过滤；列表与下钻用）。 */
  sentences: ReasoningSentence[]
  /** 有 token 上报的样本组数（用于 UI 说明覆盖率）。 */
  knownGroups: number
}

/** 一次派生：过滤 → 聚合（当前维度 + 句首维度）。 */
export function deriveReasoning(input: ReasoningInput): ReasoningDerived {
  const samples = filterSamples(input)
  const main = aggregateReasoning(samples, input.dimension)
  const prefix = aggregateReasoning(samples, 'prefix')
  return {
    totals: main.totals,
    groups: sortGroupsByChars(main.groups),
    prefixGroups: sortGroupsByChars(prefix.groups),
    sentences: main.sentences,
    knownGroups: main.groups.filter((group) => group.totalTokens > 0).length,
  }
}

/** 按语言筛句（右侧语言条点选时用；不改 filter.lang 以外的状态）。 */
export function sentencesByLang(sentences: readonly ReasoningSentence[], lang: ReasoningLang | 'all'): ReasoningSentence[] {
  if (lang === 'all') return sentences.slice()
  return sentences.filter((sentence) => sentence.lang === lang)
}

/** 按句首取句子（排行点击后下钻）。 */
export function sentencesByPrefix(sentences: readonly ReasoningSentence[], prefix: string): ReasoningSentence[] {
  return sentences.filter((sentence) => sentence.prefix === prefix)
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
