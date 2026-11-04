/*
 * map/relations.ts —— 星图上的**四层边**与焦点模式（03 §4.2、§10；04 §6.4；06 N-10）。
 *
 * 纪律：
 * - 边必须先过 T05 的 `finalizeGraph`（`type|from|to` 去重 + 单节点 12 / 全局 4000 收拢），
 *   本文件不自己造边、不越过它；
 * - 默认只画结构层；共现/引用只在**聚焦**（选中或悬停）某个文件时画；
 *   「显示全部关系 / 显示全部引用」开关才全局画（03 §10）；
 * - 时序只在选中轮次时显示该轮；未确认引用**不画**（`confirmed === false` 的引用边也挡掉）；
 * - 超出上限不静默：把 `truncation` 原样交回 UI，文案走 locale key；
 * - 焦点模式**只改透明度**，不改坐标（坐标由 layout.ts 决定，本文件不碰）。
 */
import {
  applyGraphLimits,
  DEFAULT_GRAPH_LIMITS,
  finalizeGraph,
  truncationText,
  type FinalGraph,
  type GraphEdge,
  type GraphLimits,
  type RelationType,
  type TruncationSummary,
} from '../../../shared/relations/index.ts'
import { caseKey } from '../../../shared/relations/index.ts'

/** 四层在 UI 上的显示开关（03 §10 的"开关"列）。 */
export interface RelationLayerToggles {
  structure?: boolean
  coTurn?: boolean
  coSession?: boolean
  reference?: boolean
  sequence?: boolean
}

/** 焦点来源（一个文件被选中或悬停）。 */
export interface FocusTarget {
  /** 节点的身份键（小写路径）；null = 没有焦点。 */
  key: string | null
}

/** 选中轮次（时序层只在此时显示该轮内顺序）。 */
export interface SelectedTurnRef {
  sessionId: string
  turn: number
}

export interface EdgeViewOptions {
  /** 焦点（选中优先于悬停，由调用方决定）。 */
  focus?: FocusTarget | null
  /** 「显示全部关系」：共现层不再限于焦点邻居。 */
  showAllRelations?: boolean
  /** 「显示全部引用」：引用层不再限于焦点邻居。 */
  showAllReferences?: boolean
  /** 图例开关；缺省按 03 §10 的默认值。 */
  layers?: RelationLayerToggles
  /** 选中轮次（非空才画时序层）。 */
  selectedTurn?: SelectedTurnRef | null
  /** 上限（只在 `prepareEdges` 用；这里保留是为了调用方传同一份配置）。 */
  limits?: Partial<GraphLimits>
}

/** 一条边最终怎么画（渲染层只读这个，不再判业务）。 */
export interface EdgeDraw {
  edge: GraphEdge
  type: RelationType
  /** 当前应绘制（= 可见）。 */
  visible: boolean
  /** 虚线？共现 = 虚线；引用/时序 = 实线。 */
  dashed: boolean
  /** 有向箭头？时序/引用为 true。 */
  directed: boolean
  /** 线宽（共现按权重 1→3px，其余固定 1px）。 */
  width: number
  /** 时序边的 1-based 序号（只有 sequence 有）。 */
  order?: number
}

export interface EdgeView {
  /** 通过 finalizeGraph 后的全部边（已去重、已收拢）。 */
  graph: FinalGraph
  /** 需要绘制的边（visible === true），已按层排序稳定。 */
  drawn: EdgeDraw[]
  /** 各层可见边数（统计用，不会把不可见的算进去）。 */
  visibleByType: Record<RelationType, number>
  /** 各层总边数（finalizeGraph 的 counts）。 */
  totalByType: Record<RelationType, number>
  /** 收拢信息（UI 显示 `relations.tooMany` + 数字）。 */
  truncation: TruncationSummary
  /** 焦点邻居（身份键集合；含焦点自身）。 */
  neighbors: ReadonlySet<string>
}

const LAYER_ORDER: readonly RelationType[] = ['structure', 'coSession', 'coTurn', 'reference', 'sequence']

const DEFAULT_LAYERS = {
  structure: true,
  coTurn: true,
  coSession: false,
  reference: true,
  sequence: false,
} as const

function resolveLayers(toggles?: RelationLayerToggles): Record<RelationType, boolean> {
  return {
    structure: toggles?.structure ?? DEFAULT_LAYERS.structure,
    coTurn: toggles?.coTurn ?? DEFAULT_LAYERS.coTurn,
    coSession: toggles?.coSession ?? DEFAULT_LAYERS.coSession,
    reference: toggles?.reference ?? DEFAULT_LAYERS.reference,
    sequence: toggles?.sequence ?? DEFAULT_LAYERS.sequence,
  }
}

/** 边的两个端点身份键。 */
export function edgeEndKeys(edge: GraphEdge): [string, string] {
  return [caseKey(edge.from), caseKey(edge.to)]
}

/** 边是否碰到这个身份键。 */
export function edgeTouches(edge: GraphEdge, key: string): boolean {
  return caseKey(edge.from) === key || caseKey(edge.to) === key
}

/** 焦点邻居：所有与焦点相连的节点（含焦点自身）。 */
export function neighborKeysOf(edges: readonly GraphEdge[], focusKey: string | null): Set<string> {
  const neighbors = new Set<string>()
  if (!focusKey) return neighbors
  neighbors.add(focusKey)
  for (const edge of edges) {
    const [from, to] = edgeEndKeys(edge)
    if (from === focusKey) neighbors.add(to)
    else if (to === focusKey) neighbors.add(from)
  }
  return neighbors
}

/** 线的粗细：共现按权重（1 → 1.2px，之后每级 +0.6px，封顶 3px）；其它固定 1px。 */
export function edgeWidth(edge: GraphEdge): number {
  if (edge.type === 'coTurn' || edge.type === 'coSession') {
    const weight = Math.max(1, Math.trunc(edge.weight))
    return Math.min(3, Math.round((1 + Math.log2(weight) * 0.6) * 100) / 100)
  }
  return 1
}

/** 时序边的轮内序号（1-based）。 */
export function sequenceOrderOf(edge: GraphEdge): number | undefined {
  if (edge.type !== 'sequence') return undefined
  if (edge.evidence.kind !== 'sequence') return undefined
  return edge.evidence.order
}

/** 是否属于选中的那一轮（sessionId + turn 都对上）。 */
export function isEdgeOfTurn(edge: GraphEdge, turn: SelectedTurnRef | null | undefined): boolean {
  if (!turn) return false
  if (edge.evidence.kind !== 'sequence') return false
  return edge.evidence.sessionId === turn.sessionId && edge.evidence.turn === turn.turn
}

/**
 * 收口边：`finalizeGraph`（去重 + 证据回填 + 单节点 12 / 全局 4000 收拢）。
 *
 * **按层分别收口，再跨层做全局上限**：03 §10 的图层可以独立开关，
 * 用一份全局的 12/node 预算会让隐藏层（结构边）把当前层（如选中轮次的时序边）挤没。
 * 因此每层先过一遍 `finalizeGraph`（每层各自 12/node），再跨层过 `applyGraphLimits`（全局 4000）。
 *
 * **每份 edges 只做一次**（组件里 useMemo 按 edges 引用缓存）：hover/选中只改焦点，
 * 不重复去重排序 —— 这是"交互帧 <16ms"的关键（A41-4）。
 */
export function prepareEdges(edges: readonly GraphEdge[], limits: Partial<GraphLimits> = DEFAULT_GRAPH_LIMITS): FinalGraph {
  const perNode = limits.perNode ?? DEFAULT_GRAPH_LIMITS.perNode
  const globalLimit = limits.global ?? DEFAULT_GRAPH_LIMITS.global
  const byType: Record<RelationType, GraphEdge[]> = {
    structure: [],
    coTurn: [],
    coSession: [],
    sequence: [],
    reference: [],
  }
  for (const edge of edges) byType[edge.type].push(edge)

  const merged: GraphEdge[] = []
  const counts: Record<RelationType, number> = {
    structure: 0,
    coTurn: 0,
    coSession: 0,
    sequence: 0,
    reference: 0,
  }
  let droppedByNode = 0
  for (const type of LAYER_ORDER) {
    const layer = finalizeGraph(byType[type], { perNode, global: Number.MAX_SAFE_INTEGER })
    merged.push(...layer.edges)
    counts[type] = layer.counts[type]
    droppedByNode += layer.truncation.droppedByNode
  }
  const globalResult = applyGraphLimits(merged, { perNode: Number.MAX_SAFE_INTEGER, global: globalLimit })
  const droppedByGlobal = globalResult.truncation.droppedByGlobal
  const dropped = droppedByNode + droppedByGlobal
  const truncation: TruncationSummary = {
    truncated: dropped > 0,
    total: merged.length,
    kept: globalResult.edges.length,
    dropped,
    droppedByNode,
    droppedByGlobal,
    perNode,
    global: globalLimit,
    text: truncationText(dropped),
  }
  return { edges: globalResult.edges, truncation, counts }
}

/**
 * 选择要画的边（输入是已收口的 `FinalGraph`，本函数只做层级/焦点过滤，不重新收口）。
 *
 * 步骤：
 * 1. 按层默认与开关过滤；
 * 2. 共现/引用：无焦点 → 不画；有焦点 → 只画碰到焦点的边；
 *    `showAll*` 打开时全局画（仍受 prepareEdges 的上限）；
 * 3. 时序：只有 `selectedTurn` 非空且边属于该轮才画；
 * 4. 引用：`confirmed === false` 一律不画（N-09）。
 *
 * 输出顺序稳定（层序 + 边 id 升序），保证渲染与截图可复现。
 */
export function selectVisibleEdges(graph: FinalGraph, options: EdgeViewOptions = {}): EdgeView {
  const layers = resolveLayers(options.layers)
  const focusKey = options.focus?.key ?? null
  const focusNeighbors = neighborKeysOf(graph.edges, focusKey)
  const selectedTurn = options.selectedTurn ?? null
  const perNode = options.limits?.perNode ?? DEFAULT_GRAPH_LIMITS.perNode
  const globalLimit = options.limits?.global ?? DEFAULT_GRAPH_LIMITS.global

  const ordered = graph.edges.slice().sort((left, right) => {
    const leftLayer = LAYER_ORDER.indexOf(left.type)
    const rightLayer = LAYER_ORDER.indexOf(right.type)
    if (leftLayer !== rightLayer) return leftLayer - rightLayer
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0
  })

  const visibleByLayer: Record<RelationType, GraphEdge[]> = {
    structure: [],
    coTurn: [],
    coSession: [],
    sequence: [],
    reference: [],
  }

  for (const edge of ordered) {
    if (!layers[edge.type]) continue
    switch (edge.type) {
      case 'structure':
        visibleByLayer.structure.push(edge)
        break
      case 'coTurn':
      case 'coSession': {
        const global = options.showAllRelations === true
        if (focusKey && !global) {
          if (edgeTouches(edge, focusKey)) visibleByLayer[edge.type].push(edge)
        } else if (global) {
          visibleByLayer[edge.type].push(edge)
        }
        break
      }
      case 'reference': {
        // 未确认引用不画（N-09）。
        if (edge.confirmed !== true) break
        const global = options.showAllReferences === true
        if (focusKey && !global) {
          if (edgeTouches(edge, focusKey)) visibleByLayer.reference.push(edge)
        } else if (global) {
          visibleByLayer.reference.push(edge)
        }
        break
      }
      case 'sequence':
        if (isEdgeOfTurn(edge, selectedTurn)) visibleByLayer.sequence.push(edge)
        break
      default:
        break
    }
  }

  // 每层独立 top-k：图层可以单独开关，隐藏层的边不该占掉当前层的 12 条名额
  //（否则"选中轮次时显示该轮顺序"会被结构边挤没）。
  let kept: GraphEdge[] = []
  let droppedByNode = 0
  for (const type of LAYER_ORDER) {
    const layerResult = applyGraphLimits(visibleByLayer[type], { perNode, global: Number.MAX_SAFE_INTEGER })
    kept.push(...layerResult.edges)
    droppedByNode += layerResult.truncation.dropped
  }
  // 全局 4000（跨层）。
  const globalResult = applyGraphLimits(kept, { perNode: Number.MAX_SAFE_INTEGER, global: globalLimit })
  kept = globalResult.edges
  const droppedByGlobal = globalResult.truncation.dropped

  // 输出顺序稳定：层序 → 边 id（渲染与截图可复现）。
  kept.sort((left, right) => {
    const leftLayer = LAYER_ORDER.indexOf(left.type)
    const rightLayer = LAYER_ORDER.indexOf(right.type)
    if (leftLayer !== rightLayer) return leftLayer - rightLayer
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0
  })

  const drawn: EdgeDraw[] = kept.map((edge) => ({
    edge,
    type: edge.type,
    visible: true,
    dashed: edge.type === 'coTurn' || edge.type === 'coSession',
    directed: edge.directed,
    width: edgeWidth(edge),
    ...(sequenceOrderOf(edge) === undefined ? {} : { order: sequenceOrderOf(edge) as number }),
  }))

  const visibleByType: Record<RelationType, number> = {
    structure: 0,
    coTurn: 0,
    coSession: 0,
    sequence: 0,
    reference: 0,
  }
  for (const edge of kept) visibleByType[edge.type] += 1

  // 收拢记账：数据级收口（finalizeGraph）+ 本层 top-k + 全局上限，三处都不静默。
  const dropped = graph.truncation.dropped + droppedByNode + droppedByGlobal
  const truncation: TruncationSummary = {
    truncated: graph.truncation.truncated || droppedByNode > 0 || droppedByGlobal > 0,
    total: graph.truncation.total,
    kept: drawn.length,
    dropped,
    droppedByNode: graph.truncation.droppedByNode + droppedByNode,
    droppedByGlobal: graph.truncation.droppedByGlobal + droppedByGlobal,
    perNode,
    global: globalLimit,
    text: truncationText(dropped),
  }

  return {
    graph,
    drawn,
    visibleByType,
    totalByType: graph.counts,
    truncation,
    neighbors: focusNeighbors,
  }
}

/** 焦点模式下每个节点的透明度：焦点/邻居 1，其余 0.2（03 §4.2）。 */
export const FOCUS_DIM_OPACITY = 0.2

/** 节点透明度（只改透明度，不改坐标）。 */
export function nodeOpacity(key: string, focusKey: string | null, neighbors: ReadonlySet<string>): number {
  if (!focusKey) return 1
  return neighbors.has(key) ? 1 : FOCUS_DIM_OPACITY
}

/** 层级图例（顺序固定，UI 直接渲染；文案 key 由调用方给）。 */
export const RELATION_LEGEND_ORDER: readonly RelationType[] = ['structure', 'coTurn', 'coSession', 'reference', 'sequence']
