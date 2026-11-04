/**
 * 时序关系（04 §6.1：client 侧，来自选中轮次 detail 的文件顺序；有向；选中轮次时才生成）。
 *
 * 语义：**同一轮内出现的先后**，不是依赖、不是调用链（10 §1）。
 * 边只连相邻两项（a1→a2→a3…），`evidence.order` 是 1-based 轮内序号（A30-2“有向有号”）。
 */

import { sequenceEvidence } from './evidence.ts'
import { createEdge } from './graph.ts'
import type { GraphEdge, RelationTurn } from './types.ts'

export interface SequenceBuildResult {
  edges: GraphEdge[]
  /** 轮次内参与排序的文件数（去重后）。 */
  files: number
  /** 因同一文件重复出现而被合并的项数（N-08 重复引用同源）。 */
  deduped: number
}

/** 生成某一轮内的时序边；没有选中轮次时返回空（不画）。 */
export function buildSequenceEdges(turn?: RelationTurn): SequenceBuildResult {
  if (turn === undefined) return { edges: [], files: 0, deduped: 0 }

  // `events.TurnDetail.files` 已按事件顺序排列（数组顺序 = 轮内先后），不再额外读 order 字段。
  const unique: string[] = []
  const seen = new Set<string>()
  let deduped = 0
  for (const file of turn.files) {
    const key = file.path.toLowerCase()
    if (seen.has(key)) {
      deduped += 1
      continue
    }
    seen.add(key)
    unique.push(file.path)
  }

  const edges: GraphEdge[] = []
  for (let index = 0; index < unique.length - 1; index += 1) {
    const from = unique[index]
    const to = unique[index + 1]
    edges.push(
      createEdge({
        type: 'sequence',
        from,
        to,
        weight: 1,
        evidence: sequenceEvidence({
          sessionId: turn.sessionId,
          turn: turn.turn,
          order: index + 1,
          from,
          to,
        }),
      }),
    )
  }

  return { edges, files: unique.length, deduped }
}
