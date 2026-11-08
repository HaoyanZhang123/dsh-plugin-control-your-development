/*
 * map/pairs.ts —— 边 pair 聚合 / 类型过滤 / 拖动阈值（纯函数）。
 *
 * 从旧 `overview.ts` 抽出的**仍然有用**的那部分；星图相关的布局（簇/黄金角/标签簇内避让）
 * 已随单一执行路径删除，不再保留兼容分支。
 *
 * 纪律：无随机、无时间、无 DOM；同输入两次调用逐字段相同（渲染与截图可复现）。
 */
import type { GraphEdge, RelationEvidence, RelationType } from '../../../shared/relations/index.ts'

/** 拖动判定阈值（px）：小于它算 click（否则算拖动）。 */
export const DRAG_THRESHOLD_PX = 3

/** 拖动阈值判定：移动距离 < 3px 算 click。 */
export function dragThresholdExceeded(dx: number, dy: number, threshold = DRAG_THRESHOLD_PX): boolean {
  return Math.hypot(dx, dy) >= threshold
}

/** 文件对聚合（同一对文件的多条关系合并成一条视觉线）。 */
export interface EdgePair {
  key: string
  /** 展示端（与输入第一条边同向，无向关系不强制方向）。 */
  from: string
  to: string
  /** 类型 → 条数。 */
  types: Partial<Record<RelationType, number>>
  typeList: RelationType[]
  count: number
  weight: number
  ids: string[]
  evidence: RelationEvidence[]
}

/** 关系类型的稳定顺序（展示用：引用最具体在上，结构最泛在下）。 */
const PAIR_TYPE_ORDER: readonly RelationType[] = ['reference', 'sequence', 'coTurn', 'coSession', 'structure']

/** 无向 pair 的稳定键（路径大小写不敏感，左小右大）。 */
export function pairKeyOf(from: string, to: string): string {
  const left = from.toLowerCase()
  const right = to.toLowerCase()
  return left < right ? left + '\u0000' + right : right + '\u0000' + left
}

/**
 * 边按 pair 聚合并排序：
 * - 权重降序 → 类型丰富度降序 → pair 键升序（确定性）；
 * - evidence 去重后保留（最多 8 条，浮层用）。
 */
export function aggregateEdgePairs(edges: readonly GraphEdge[]): EdgePair[] {
  const table = new Map<string, EdgePair>()
  for (const edge of edges) {
    const key = pairKeyOf(edge.from, edge.to)
    const existing = table.get(key)
    if (existing === undefined) {
      table.set(key, {
        key,
        from: edge.from,
        to: edge.to,
        types: { [edge.type]: 1 },
        typeList: [edge.type],
        count: 1,
        weight: edge.weight,
        ids: [edge.id],
        evidence: [edge.evidence],
      })
      continue
    }
    existing.types[edge.type] = (existing.types[edge.type] ?? 0) + 1
    if (!existing.typeList.includes(edge.type)) existing.typeList.push(edge.type)
    existing.count += 1
    existing.weight += edge.weight
    existing.ids.push(edge.id)
    if (existing.evidence.length < 8 && !existing.evidence.some((item) => item.text === edge.evidence.text)) {
      existing.evidence.push(edge.evidence)
    }
  }
  const pairs = [...table.values()]
  for (const pair of pairs) pair.typeList.sort((left, right) => PAIR_TYPE_ORDER.indexOf(left) - PAIR_TYPE_ORDER.indexOf(right))
  return pairs.sort((left, right) => {
    if (left.weight !== right.weight) return right.weight - left.weight
    if (left.typeList.length !== right.typeList.length) return right.typeList.length - left.typeList.length
    return left.key < right.key ? -1 : left.key > right.key ? 1 : 0
  })
}

/** 关系类型计数（固定顺序）。 */
export function relationTypeCounts(edges: readonly GraphEdge[]): Array<{ type: RelationType; count: number }> {
  const counts = new Map<RelationType, number>()
  for (const edge of edges) counts.set(edge.type, (counts.get(edge.type) ?? 0) + 1)
  return PAIR_TYPE_ORDER.filter((type) => (counts.get(type) ?? 0) > 0).map((type) => ({ type, count: counts.get(type) ?? 0 }))
}

/** 类型过滤：active 为空 = 全开；否则只保留 active 里的类型。 */
export function filterEdgesByTypes(edges: readonly GraphEdge[], active: ReadonlySet<RelationType> | null): GraphEdge[] {
  if (active === null || active.size === 0) return edges.slice()
  return edges.filter((edge) => active.has(edge.type))
}
