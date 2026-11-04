/**
 * 图装配：统一建边、`type|from|to` 去重合并、证据回填、上限收拢（04 §6.2、04 §6.4）。
 *
 * 去重键（04 §6.2）：`type|from|to`。无向边按身份键排序后成键，所以 (a,b) 与 (b,a) 是同一条边；
 * 有向边保留方向。合并规则按层不同：
 * - 同轮共现：权重累加，样本保留最近 3 个（04 §4.4）；
 * - 引用：保留第一条（行号最小）的证据，权重 = 被引用次数；
 * - 同会话共现：sessionIds 取并集，权重 = 共同会话数；
 * - 结构 / 时序：保留首条（结构天然唯一；同一轮内相邻对天然唯一）。
 */

import { LIMITS } from '../events/index.ts'
import { coSessionEvidence, coTurnEvidence, referenceEvidence } from './evidence.ts'
import { applyGraphLimits } from './limits.ts'
import type { TruncationSummary } from './limits.ts'
import { caseKey } from './path.ts'
import type {
  GraphEdge,
  GraphLimits,
  RelationConfidence,
  RelationEvidence,
  RelationType,
  TurnSample,
} from './types.ts'

const DEFAULT_DIRECTED: Readonly<Record<RelationType, boolean>> = {
  structure: false,
  coTurn: false,
  coSession: false,
  sequence: true,
  reference: true,
}

/** 来源性质（04 §6.2）：结构=按路径推断、引用=解析所得、其余=记录直接给出。 */
const DEFAULT_CONFIDENCE: Readonly<Record<RelationType, RelationConfidence>> = {
  structure: 'estimated',
  coTurn: 'confirmed',
  coSession: 'confirmed',
  sequence: 'confirmed',
  reference: 'parsed',
}

/** 共现证据保留的样本数上限（04 §4.4：最近 3 个；数字同源 `events.LIMITS`）。 */
export const MAX_CO_TURN_SAMPLES = LIMITS.edgeEvidence

export interface EdgeInput {
  type: RelationType
  from: string
  to: string
  evidence: RelationEvidence
  weight?: number
  directed?: boolean
  confirmed?: boolean
  confidence?: RelationConfidence
}

/** 边的唯一 id：`type|from|to`（无向边端点先按身份键排序）。 */
export function edgeId(type: RelationType, from: string, to: string, directed = DEFAULT_DIRECTED[type]): string {
  const left = caseKey(from)
  const right = caseKey(to)
  if (directed) return `${type}|${left}|${right}`
  return left <= right ? `${type}|${left}|${right}` : `${type}|${right}|${left}`
}

/** 建边（唯一入口：id/方向/置信度都从这里推导）。 */
export function createEdge(input: EdgeInput): GraphEdge {
  const directed = input.directed ?? DEFAULT_DIRECTED[input.type]
  const weight = input.weight ?? defaultWeight(input.evidence)
  return {
    id: edgeId(input.type, input.from, input.to, directed),
    type: input.type,
    from: input.from,
    to: input.to,
    weight,
    directed,
    evidence: input.evidence,
    confirmed: input.confirmed ?? true,
    confidence: input.confidence ?? DEFAULT_CONFIDENCE[input.type],
  }
}

function defaultWeight(evidence: RelationEvidence): number {
  if (evidence.kind === 'coTurn') return evidence.count
  if (evidence.kind === 'coSession') return Math.max(1, evidence.sessionIds.length)
  return 1
}

function mergeSamples(left: readonly TurnSample[], right: readonly TurnSample[]): TurnSample[] {
  const merged: TurnSample[] = []
  const seen = new Set<string>()
  for (const sample of left.concat(right)) {
    const key = `${sample.sessionId}|${sample.turn}`
    if (seen.has(key)) continue
    seen.add(key)
    merged.push({ sessionId: sample.sessionId, turn: sample.turn })
  }
  return merged.slice(-MAX_CO_TURN_SAMPLES)
}

/** 合并两条同 id 的边（按层规则）。 */
export function mergeEdge(previous: GraphEdge, next: GraphEdge): GraphEdge {
  switch (previous.type) {
    case 'coTurn': {
      const weight = previous.weight + next.weight
      const leftSamples = previous.evidence.kind === 'coTurn' ? previous.evidence.samples : []
      const rightSamples = next.evidence.kind === 'coTurn' ? next.evidence.samples : []
      const samples = mergeSamples(leftSamples, rightSamples)
      return { ...previous, weight, evidence: coTurnEvidence({ samples, count: weight }) }
    }
    case 'reference': {
      const weight = previous.weight + next.weight
      const previousLine = previous.evidence.kind === 'reference' ? previous.evidence.line : Number.MAX_SAFE_INTEGER
      const nextLine = next.evidence.kind === 'reference' ? next.evidence.line : Number.MAX_SAFE_INTEGER
      const first = nextLine < previousLine ? next : previous
      const line = Math.min(previousLine, nextLine)
      const raw = first.evidence.kind === 'reference' ? first.evidence.raw : ''
      const target = first.evidence.kind === 'reference' ? first.evidence.target : ''
      return {
        ...previous,
        weight,
        evidence: referenceEvidence({ line, raw, target, from: previous.from, to: previous.to }),
      }
    }
    case 'coSession': {
      const sessionIds: string[] = []
      for (const edge of [previous, next]) {
        if (edge.evidence.kind !== 'coSession') continue
        for (const sessionId of edge.evidence.sessionIds) {
          if (!sessionIds.includes(sessionId)) sessionIds.push(sessionId)
        }
      }
      return {
        ...previous,
        weight: Math.max(1, sessionIds.length),
        evidence: coSessionEvidence(sessionIds),
      }
    }
    default:
      return previous
  }
}

/** 按 `type|from|to` 去重合并（保持首次出现顺序）。 */
export function mergeEdges(edges: readonly GraphEdge[]): GraphEdge[] {
  const byId = new Map<string, GraphEdge>()
  for (const edge of edges) {
    const existing = byId.get(edge.id)
    byId.set(edge.id, existing === undefined ? edge : mergeEdge(existing, edge))
  }
  return [...byId.values()]
}

/** 各层边数（收拢前），用于“已收拢”与检查器统计。 */
export function countByType(edges: readonly GraphEdge[]): Record<RelationType, number> {
  const counts: Record<RelationType, number> = {
    structure: 0,
    coTurn: 0,
    coSession: 0,
    sequence: 0,
    reference: 0,
  }
  for (const edge of edges) counts[edge.type] += 1
  return counts
}

export interface FinalGraph {
  edges: GraphEdge[]
  truncation: TruncationSummary
  /** 收拢前的各层边数（UI/检查器展示“关系数”，不静默）。 */
  counts: Record<RelationType, number>
}

/** 收口：合并 → 收拢 → 统计。所有图（含多个层拼起来）都必须走这里。 */
export function finalizeGraph(edges: readonly GraphEdge[], limits?: Partial<GraphLimits>): FinalGraph {
  const merged = mergeEdges(edges)
  const counts = countByType(merged)
  const limited = applyGraphLimits(merged, limits)
  return { edges: limited.edges, truncation: limited.truncation, counts }
}
