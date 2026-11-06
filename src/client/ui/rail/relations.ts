/*
 * rail/relations.ts —— 目录卡片的关系摘要（脉络 1.1 / T36；P2 关系呈现）。
 *
 * 纯聚合：给每张目录卡片算「与多少个其它目录有共现/引用关系 + 关系最多的 top partner」。
 * - 只统计**跨目录**的边（同目录内的结构/共现不算"目录之间的关系"）；
 * - 默认层：coTurn / coSession（共现）+ reference（引用解析所得），与 33 §7 的「共现/引用」口径一致；
 *   structure（同目录路径推断）与 sequence（轮内顺序）默认不计入——它们不是"目录之间"的关系证据；
 * - 未确认（`confirmed === false`，例如 onclick 解析失败的引用）默认不计；
 * - 端点目录必须在 cards 里（卡片由全部 nodes 聚合，边缘端点缺失时不猜、不造卡片）；
 * - 关系条数 = 该目录与其它目录之间的**边数**（同一对目录多条边累计；不按 weight 放大，避免把"共现次数"当成"关系条数"）；
 * - 确定性：top partner 按 count 降序 → 目录键升序；无关系时映射里不出现该目录（调用方据此不渲染）。
 *
 * 纪律：纯函数，无 DOM/时间/随机数；目录键口径复用 `directoryKeyOf`（唯一实现）。
 */
import type { GraphEdge, RelationType } from '../../../shared/relations/index.ts'
import { directoryKeyOf, type DirectoryCard } from './directories.ts'

/** 默认参与目录关系统计的边层（共现 + 引用）。 */
export const DIRECTORY_RELATION_TYPES: readonly RelationType[] = ['coTurn', 'coSession', 'reference']

/** 一个关系 partner（partner 目录键 + 两侧边数）。 */
export interface DirectoryRelationPartner {
  key: string
  count: number
}

/** 一张目录卡片的关系摘要。 */
export interface DirectoryRelationSummary {
  /** 有共现/引用关系的其它目录数。 */
  partners: number
  /** 与其它目录之间的边数（同一 partner 多条边累计）。 */
  relations: number
  /** 关系最多的 partner（并列按目录键升序）；无关系时为 null。 */
  topPartner: DirectoryRelationPartner | null
}

export interface DirectoryRelationOptions {
  /** 覆盖参与统计的边层（默认 DIRECTORY_RELATION_TYPES）。 */
  types?: readonly RelationType[]
  /** 是否把未确认引用也算进来（默认 false：不可证的引用不算关系）。 */
  includeUnconfirmed?: boolean
}

function compareKeys(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function bump(pairs: Map<string, Map<string, number>>, from: string, to: string): void {
  let bucket = pairs.get(from)
  if (bucket === undefined) {
    bucket = new Map<string, number>()
    pairs.set(from, bucket)
  }
  bucket.set(to, (bucket.get(to) ?? 0) + 1)
}

/**
 * 目录关系摘要：`card.key -> summary`（无关系的目录不出现在 map 里）。
 *
 * `cards` 来自 `buildDirectoryCards`（全部 nodes），`edges` 来自 `finalizeGraph`（tab 的那一份）。
 * 目录键大小写不敏感：edges 的端点通常是小写 caseKey，这里用卡片键的小写索引回映射到卡片规范键。
 */
export function buildDirectoryRelationSummary(
  cards: readonly DirectoryCard[],
  edges: readonly GraphEdge[],
  options: DirectoryRelationOptions = {},
): Map<string, DirectoryRelationSummary> {
  const canonical = new Map<string, string>()
  for (const card of cards) canonical.set(card.key.toLowerCase(), card.key)
  const types = new Set<RelationType>(options.types ?? DIRECTORY_RELATION_TYPES)
  const includeUnconfirmed = options.includeUnconfirmed === true

  const pairs = new Map<string, Map<string, number>>()
  for (const edge of edges) {
    if (!types.has(edge.type)) continue
    if (!includeUnconfirmed && edge.confirmed === false) continue
    const from = canonical.get(directoryKeyOf(edge.from).toLowerCase())
    const to = canonical.get(directoryKeyOf(edge.to).toLowerCase())
    if (from === undefined || to === undefined || from === to) continue
    bump(pairs, from, to)
    bump(pairs, to, from)
  }

  const result = new Map<string, DirectoryRelationSummary>()
  for (const card of cards) {
    const bucket = pairs.get(card.key)
    if (bucket === undefined || bucket.size === 0) continue
    const partners = [...bucket.entries()].sort((left, right) => right[1] - left[1] || compareKeys(left[0], right[0]))
    const top = partners[0]
    if (top === undefined) continue
    result.set(card.key, {
      partners: bucket.size,
      relations: partners.reduce((sum, entry) => sum + entry[1], 0),
      topPartner: { key: top[0], count: top[1] },
    })
  }
  return result
}
