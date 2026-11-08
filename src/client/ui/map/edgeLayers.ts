/*
 * map/edgeLayers.ts —— 边分档（L1 骨架 / L2 强共现 / L3 其余）+ 硬上限（03 §4.2.2）。
 *
 * 纪律：
 * - **同一对文件多条关系按 pair 聚合为一条**（沿用 `pairs.ts` 的 `aggregateEdgePairs`），
 *   本文件只在 pair 层面分档，不引入第二条聚合路径；
 * - **总绘制边数 ≤ 1.6 × 节点数**（`GRAPH_EDGE_FACTOR`），超出按权重截断并**显式报告**，
 *   不静默丢边（UI 用 `graph.relationsTrimmed` 说明）；
 * - 纯函数：只吃节点键集合 + 边 + 档位，不碰 DOM/时间/随机，两次调用逐字段相同。
 */
import type { GraphEdge, RelationType } from '../../../shared/relations/index.ts'
import { aggregateEdgePairs, type EdgePair } from './pairs.ts'
import { GRAPH_COOCCURRENCE_TOP, GRAPH_EDGE_FACTOR, type GraphDensity } from './theme.ts'

/** 一条边的档位：L1 常驻、L2 常驻（标准档起）、L3 只在悬停/选中或「全部」档淡入。 */
export type EdgeLayer = 'L1' | 'L2' | 'L3'

/** 参与绘制的 pair（聚合后）+ 档位。 */
export interface LayeredPair {
  pair: EdgePair
  layer: EdgeLayer
}

export interface EdgeLayerOptions {
  /** 节点身份键集合（小写路径 / 枢纽键）；两端都在内的边才参与。 */
  nodeKeys: ReadonlySet<string>
  /** 关系密度档位（缺省 standard）。 */
  density?: GraphDensity
  /** 焦点键（悬停/选中）：它的 L3 边也画，并**强制保留**不被上限截掉。 */
  focusKey?: string | null
  /** 覆盖边数上限（测试用；缺省 = ceil(1.6 × 节点数)）。 */
  maxEdges?: number
}

export interface EdgeLayerResult {
  /** 默认就要画的 pair（L1 + L2；density='all' 时含 L3），已按权重降序 + 键升序稳定排序。 */
  drawn: LayeredPair[]
  /** 因为上限被截掉的 pair（**必须显式提示**，不静默）。 */
  trimmed: LayeredPair[]
  /** 只靠焦点才淡入的 L3 pair（不在 drawn 里的部分）。 */
  focusOnly: LayeredPair[]
  /** 生效的上限（= ceil(1.6 × 节点数) 或覆盖值）。 */
  maxEdges: number
  /** 是否发生了上截断。 */
  truncated: boolean
  /** 各档 pair 数（上截断之前）。 */
  countByLayer: Record<EdgeLayer, number>
}

/** 结构边 + 引用边 = L1 骨架（03 §4.2.2 表）。 */
export function layerOfTypes(types: readonly RelationType[]): EdgeLayer {
  if (types.includes('structure') || types.includes('reference')) return 'L1'
  return 'L3'
}

/** 边数上限：ceil(1.6 × 节点数)，至少 1。 */
export function edgeCapFor(nodeCount: number, override?: number): number {
  if (override !== undefined) return Math.max(1, Math.trunc(override))
  return Math.max(1, Math.ceil(GRAPH_EDGE_FACTOR * Math.max(1, nodeCount)))
}

/** 稳定排序：权重降序 → 类型丰富度降序 → pair 键升序（与 aggregateEdgePairs 同口径）。 */
export function compareLayeredPairs(left: LayeredPair, right: LayeredPair): number {
  if (left.pair.weight !== right.pair.weight) return right.pair.weight - left.pair.weight
  if (left.pair.count !== right.pair.count) return right.pair.count - left.pair.count
  return left.pair.key < right.pair.key ? -1 : left.pair.key > right.pair.key ? 1 : 0
}

function keyOfPath(path: string): string {
  return path.toLowerCase()
}

/**
 * 分档并施加硬上限。
 *
 * 步骤（确定性）：
 * 1. 只留两端都在 `nodeKeys` 里的边，按 pair 聚合（`aggregateEdgePairs`）；
 * 2. L1 = 含 structure/reference 的 pair；
 *    其余共现/时序 pair 按**每端节点**的权重排序，逐端取 top-3（`GRAPH_COOCCURRENCE_TOP`）
 *    → 被任一端的 top-3 选中的进 L2，剩下的进 L3；
 * 3. 按档位决定"默认画"集合（skeleton = L1；standard = L1+L2；all = L1+L2+L3）；
 * 4. 若超过上限：按权重截断，但**焦点相关的 pair 永不截掉**（悬停必能看到它的边）。
 */
export function selectEdgeLayers(edges: readonly GraphEdge[], options: EdgeLayerOptions): EdgeLayerResult {
  const nodeKeys = options.nodeKeys
  const density: GraphDensity = options.density ?? 'standard'
  const focusKey = options.focusKey ?? null
  const maxEdges = edgeCapFor(nodeKeys.size, options.maxEdges)

  const within: GraphEdge[] = []
  for (const edge of edges) {
    if (!nodeKeys.has(keyOfPath(edge.from))) continue
    if (!nodeKeys.has(keyOfPath(edge.to))) continue
    within.push(edge)
  }
  const pairs = aggregateEdgePairs(within)

  // ---- 逐端 top-3：只对"共现/时序"类 pair 排名（L1 不看共现名额）----
  const topByNode = new Map<string, Set<string>>()
  const candidates: Array<{ pair: EdgePair; rankWeight: number }> = []
  for (const pair of pairs) {
    if (layerOfTypes(pair.typeList) === 'L1') continue
    candidates.push({ pair, rankWeight: pair.weight })
  }
  // 确定性排序（权重降序 → pair 键升序），再逐端取前 top-3。
  candidates.sort((left, right) => {
    if (left.rankWeight !== right.rankWeight) return right.rankWeight - left.rankWeight
    return left.pair.key < right.pair.key ? -1 : left.pair.key > right.pair.key ? 1 : 0
  })
  for (const item of candidates) {
    for (const endpoint of [keyOfPath(item.pair.from), keyOfPath(item.pair.to)]) {
      const set = topByNode.get(endpoint) ?? new Set<string>()
      if (set.size < GRAPH_COOCCURRENCE_TOP) set.add(item.pair.key)
      topByNode.set(endpoint, set)
    }
  }

  const countByLayer: Record<EdgeLayer, number> = { L1: 0, L2: 0, L3: 0 }
  const byLayer: Record<EdgeLayer, LayeredPair[]> = { L1: [], L2: [], L3: [] }
  for (const pair of pairs) {
    let layer: EdgeLayer
    if (layerOfTypes(pair.typeList) === 'L1') {
      layer = 'L1'
    } else {
      const strong =
        (topByNode.get(keyOfPath(pair.from))?.has(pair.key) ?? false) ||
        (topByNode.get(keyOfPath(pair.to))?.has(pair.key) ?? false)
      layer = strong ? 'L2' : 'L3'
    }
    countByLayer[layer] += 1
    byLayer[layer].push({ pair, layer })
  }
  for (const layer of ['L1', 'L2', 'L3'] as const) byLayer[layer].sort(compareLayeredPairs)

  // ---- 默认画 + 档位 ----
  const defaultLayers: readonly EdgeLayer[] =
    density === 'skeleton' ? ['L1'] : density === 'standard' ? ['L1', 'L2'] : ['L1', 'L2', 'L3']
  const wanted: LayeredPair[] = []
  for (const layer of defaultLayers) wanted.push(...byLayer[layer])
  wanted.sort(compareLayeredPairs)

  // ---- 硬上限：焦点相关永不截断，其余按权重 ----
  const touchesFocus = (item: LayeredPair): boolean =>
    focusKey !== null && (keyOfPath(item.pair.from) === focusKey || keyOfPath(item.pair.to) === focusKey)
  const drawn: LayeredPair[] = []
  const trimmed: LayeredPair[] = []
  const forced: LayeredPair[] = []
  const rest: LayeredPair[] = []
  for (const item of wanted) (touchesFocus(item) ? forced : rest).push(item)
  const room = Math.max(0, maxEdges - forced.length)
  for (let index = 0; index < rest.length; index += 1) {
    if (index < room) drawn.push(rest[index])
    else trimmed.push(rest[index])
  }
  drawn.push(...forced)
  drawn.sort(compareLayeredPairs)
  trimmed.sort(compareLayeredPairs)

  // ---- 焦点可淡入的 L3（不在 drawn 里、但碰到焦点的）----
  const drawnKeys = new Set(drawn.map((item) => item.pair.key))
  const focusOnly: LayeredPair[] = []
  if (focusKey !== null) {
    for (const item of byLayer.L3) {
      if (drawnKeys.has(item.pair.key) || trimmed.some((other) => other.pair.key === item.pair.key)) continue
      if (touchesFocus(item)) focusOnly.push(item)
    }
    focusOnly.sort(compareLayeredPairs)
  }

  return {
    drawn,
    trimmed,
    focusOnly,
    maxEdges,
    truncated: trimmed.length > 0,
    countByLayer,
  }
}

/** 一组 pair 的总权重（线宽/图头计数用）。 */
export function totalWeightOf(pairs: readonly LayeredPair[]): number {
  let total = 0
  for (const item of pairs) total += item.pair.weight
  return total
}
