/**
 * 图上限与“已收拢”计数（03 §4.2、03 §10、04 §6.4、N-10）。
 *
 * 规则：
 * - 单节点最多 12 条边（按权重取 top-k）；
 * - 全局最多 4000 条；
 * - 任何截断都必须显式：`truncation.truncated` + 已收拢条数，UI 显示“已收拢 X 条”；
 *   **不许静默丢弃**（10 §2.8）。
 */

import { caseKey } from './path.ts'
import type { GraphEdge, GraphLimits } from './types.ts'
import { DEFAULT_GRAPH_LIMITS } from './types.ts'

export interface TruncationSummary {
  /** 是否发生了任何截断。 */
  truncated: boolean
  /** 收拢前的边数。 */
  total: number
  /** 收拢后保留的边数。 */
  kept: number
  /** 丢掉的边数 = droppedByNode + droppedByGlobal。 */
  dropped: number
  droppedByNode: number
  droppedByGlobal: number
  perNode: number
  global: number
  /** 给 UI 的一句话：`已收拢 {dropped} 条`（03 §10）。 */
  text: string
}

/** 确定性排序：权重降序 → id 升序（同数据同结果，A60-1 的前提）。 */
export function compareEdges(left: GraphEdge, right: GraphEdge): number {
  if (left.weight !== right.weight) return right.weight - left.weight
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0
}

/** `已收拢 X 条`（03 §10 的文案；X=0 时也返回同句，方便 UI 直接显示/隐藏）。 */
export function truncationText(dropped: number): string {
  return `已收拢 ${dropped} 条`
}

/**
 * 按上限收拢边：先逐节点 top-k，再全局 top-N。
 * 逐节点规则：一条边的**两个端点**都必须还没满 12 条才保留（03 §4.2“单节点最多显示 12 条”）。
 */
export function applyGraphLimits(
  edges: readonly GraphEdge[],
  limits?: Partial<GraphLimits>,
): { edges: GraphEdge[]; truncation: TruncationSummary } {
  const perNode = limits?.perNode ?? DEFAULT_GRAPH_LIMITS.perNode
  const global = limits?.global ?? DEFAULT_GRAPH_LIMITS.global
  const total = edges.length
  const ordered = edges.slice().sort(compareEdges)
  const degrees = new Map<string, number>()
  const kept: GraphEdge[] = []
  let droppedByNode = 0

  for (const edge of ordered) {
    const from = caseKey(edge.from)
    const to = caseKey(edge.to)
    const fromDegree = degrees.get(from) ?? 0
    const toDegree = degrees.get(to) ?? 0
    if (fromDegree >= perNode || toDegree >= perNode) {
      droppedByNode += 1
      continue
    }
    kept.push(edge)
    degrees.set(from, fromDegree + 1)
    degrees.set(to, toDegree + 1)
  }

  let droppedByGlobal = 0
  let result = kept
  if (kept.length > global) {
    droppedByGlobal = kept.length - global
    result = kept.slice(0, global)
  }

  const dropped = droppedByNode + droppedByGlobal
  return {
    edges: result,
    truncation: {
      truncated: dropped > 0,
      total,
      kept: result.length,
      dropped,
      droppedByNode,
      droppedByGlobal,
      perNode,
      global,
      text: truncationText(dropped),
    },
  }
}
