/**
 * 同会话共现（04 §6.1：client 侧，来自 `FileNode.sessionIds`；弱关系，默认不画）。
 *
 * **只在聚焦时生成**（03 §10、A30-2）：没有 focus 就返回空数组，避免 O(N²) 爆炸与噪声。
 * 语义仍是共现，不是依赖（10 §1）；证据文本固定为“同一会话中一起出现”。
 */

import { coSessionEvidence } from './evidence.ts'
import { createEdge } from './graph.ts'
import { caseKey } from './path.ts'
import type { GraphEdge, RelationFileNode } from './types.ts'

export interface CoSessionBuildResult {
  edges: GraphEdge[]
  /** 聚焦文件是否存在（false = 不生成任何边，UI 不显示假关系）。 */
  focused: boolean
}

/** 生成与聚焦文件相关的同会话共现边（无向，权重 = 共同会话数）。 */
export function buildCoSessionEdges(
  files: readonly RelationFileNode[],
  focus?: string,
): CoSessionBuildResult {
  if (focus === undefined || focus === '') return { edges: [], focused: false }
  const focusKey = caseKey(focus)
  const focusNode = files.find((file) => caseKey(file.path) === focusKey)
  if (focusNode === undefined) return { edges: [], focused: false }
  const focusSessions = focusNode.sessionIds ?? []
  if (focusSessions.length === 0) return { edges: [], focused: false }

  const edges: GraphEdge[] = []
  for (const file of files) {
    if (caseKey(file.path) === focusKey) continue
    const sessions = file.sessionIds ?? []
    if (sessions.length === 0) continue
    const shared: string[] = []
    for (const sessionId of focusSessions) {
      if (sessions.includes(sessionId) && !shared.includes(sessionId)) shared.push(sessionId)
    }
    if (shared.length === 0) continue
    edges.push(
      createEdge({
        type: 'coSession',
        from: focusNode.path,
        to: file.path,
        weight: shared.length,
        evidence: coSessionEvidence(shared),
      }),
    )
  }

  edges.sort((left, right) => (left.to < right.to ? -1 : left.to > right.to ? 1 : 0))
  return { edges, focused: true }
}
