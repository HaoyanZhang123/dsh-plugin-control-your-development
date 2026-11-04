/**
 * 同轮共现（04 §6.1：host 侧数据，来自每轮的文件集合；无向；权重 = 一起出现的次数）。
 *
 * 规则（04 §4.4）：
 * - 每轮先按 `ops` 取 top 12（同 ops 按路径升序），再两两成边；
 * - 同一对文件跨轮累加权重，证据保留最近 3 个 `{sessionId, turn}` 样本；
 * - 共现**不表示依赖**（10 §1），权重只表示次数（10 §2.5）。
 */

import { LIMITS } from '../events/index.ts'
import { turnFileActivity } from './adapters.ts'
import { coTurnEvidence } from './evidence.ts'
import { createEdge } from './graph.ts'
import type { GraphEdge, RelationTurn, TurnSample } from './types.ts'

/** 每轮参与成边的文件数上限（04 §4.4；数字的唯一事实源在 `events.LIMITS`）。 */
export const CO_TURN_FILES_PER_TURN = LIMITS.maxCoTurnFiles
/** 证据样本上限（04 §4.4：最近 3 个；同源）。 */
export const CO_TURN_SAMPLE_LIMIT = LIMITS.edgeEvidence

export interface CoTurnOptions {
  /** 每轮参与成边的文件数上限，默认 12。 */
  perTurnFiles?: number
}

export interface CoTurnBuildResult {
  edges: GraphEdge[]
  /** 因单轮文件上限被排除的文件数（N-10：必须显式）。 */
  droppedFiles: number
  /** 没有文件的轮次数（不产生边）。 */
  emptyTurns: number
}

interface PairAccumulator {
  from: string
  to: string
  count: number
  samples: TurnSample[]
}

/** 生成同轮共现边；输入顺序视为时间顺序（后出现的轮次算“更近”）。 */
export function buildCoTurnEdges(
  turns: readonly RelationTurn[],
  options?: CoTurnOptions,
): CoTurnBuildResult {
  const perTurnFiles = options?.perTurnFiles ?? CO_TURN_FILES_PER_TURN
  const pairs = new Map<string, PairAccumulator>()
  let droppedFiles = 0
  let emptyTurns = 0

  for (const turn of turns) {
    const files = turn.files
      .map((file) => ({ path: file.path, activity: turnFileActivity(file) }))
      .sort((left, right) => {
        if (left.activity !== right.activity) return right.activity - left.activity
        return left.path < right.path ? -1 : left.path > right.path ? 1 : 0
      })
    const selected: string[] = []
    const seen = new Set<string>()
    for (const file of files) {
      if (selected.length >= perTurnFiles) {
        droppedFiles += 1
        continue
      }
      const key = file.path.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      selected.push(file.path)
    }
    if (selected.length === 0) {
      emptyTurns += 1
      continue
    }

    for (let left = 0; left < selected.length; left += 1) {
      for (let right = left + 1; right < selected.length; right += 1) {
        const a = selected[left]
        const b = selected[right]
        const from = a.toLowerCase() <= b.toLowerCase() ? a : b
        const to = from === a ? b : a
        const key = `${from.toLowerCase()}|${to.toLowerCase()}`
        const existing = pairs.get(key)
        if (existing === undefined) {
          pairs.set(key, {
            from,
            to,
            count: 1,
            samples: [{ sessionId: turn.sessionId, turn: turn.turn }],
          })
          continue
        }
        existing.count += 1
        existing.samples.push({ sessionId: turn.sessionId, turn: turn.turn })
        if (existing.samples.length > CO_TURN_SAMPLE_LIMIT) existing.samples.splice(0, existing.samples.length - CO_TURN_SAMPLE_LIMIT)
      }
    }
  }

  const edges = [...pairs.values()]
    .sort((left, right) => (left.from === right.from ? (left.to < right.to ? -1 : 1) : left.from < right.from ? -1 : 1))
    .map((pair) =>
      createEdge({
        type: 'coTurn',
        from: pair.from,
        to: pair.to,
        weight: pair.count,
        evidence: coTurnEvidence({ samples: pair.samples, count: pair.count }),
      }),
    )

  return { edges, droppedFiles, emptyTurns }
}
