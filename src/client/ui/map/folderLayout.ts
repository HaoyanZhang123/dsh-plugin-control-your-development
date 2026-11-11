/*
 * map/folderLayout.ts —��?「当前目录��关系图的确定��?*力导�?*布局�?3 §4.2.1 / R10）��? *
 * 用户 2026-11-08 二次反馈（本条取代此前的等宽网格实现，网格已整体删除、不留兼容分支）�? *
「他们已经把它根据文件夹和文档分成不同的节点，这很好。但是他们之间也应该是有图的结构�? *     有系的连在一起，而不像现在一样就丢�个个排列在那里��然后，每一个点弢�之后�? *     里面的展弢�之后，也应该这样。��? *
 * 因此�? * - **位置由关系决�?*：斥力（全部两两�? 引力�?*仅有�?*的节点对，强�?= 边权重）+ 轻向心力�? * - 文件夹枢�?= 圆角方卡�?*不同形状**表达层级，不再靠"排一条带"分区）；文件 = 圆点�? * - 枢纽参与结构：跨目录真实边聚合到枢纽（`hubLinks.ts`），**没有关系的枢纽放外围环��绝不伪造连�?*�? * - **铺满视口**：按画布归一化，内容包围�?�?5% 画布（旧网格只占上部 1/4 属缺陷）�? * - **确定�?*：初始位置由路径哈希决定、固定迭代轮数��遍历顺序固�?�?同输入��坐标相同；
 * - 标签整词或隐藏（绝不截成 `relati…` 碎片）；hover 不重排��? *
 * 纯函数（�?import React / 不碰 DOM），可被 node:test 直接调用�? */
import type { FileFamily, FileNode } from '../../../shared/events/index.ts'
import { estimateTextWidth, placeLabels, type LabelCandidate, type OccupiedBox } from './labels.ts'
import type { GraphEdge } from '../../../shared/relations/index.ts'
import { GRAPH_HUB_PAIR_PARTNERS, GRAPH_LIMITS } from './theme.ts'
import { enforceMinDistances, computeBounds, simulateForce, FORCE_DEFAULTS, type ForceLink, type ForceNode, type MinDistanceConstraint } from './forceLayout.ts'
import {
  buildCrossBoundaryIndex,
  computeHubLinks,
  computeHubPairs,
  hubPairKey,
  perimeterAngle,
  type HubLink,
  type HubPair,
  type CrossBoundaryIndex,
} from './hubLinks.ts'
import { aggregateEdgePairs } from './pairs.ts'

/** 路径身份键（小写；与 FolderMap 的 caseKey 同口径，这里自带一份避免 UI 反向依赖）。 */
function caseKeyOf(path: string): string {
  return path.toLowerCase()
}

/** 当前目录条目的类型（�?tree 契约丢�致：directory / file / other）��?*/
export type MapKind = 'directory' | 'file' | 'other'

/**
 * 当前目录的一个直接条目（纯数据，**�?import data/tree.ts**）��? * 形状�?DATA �?`TreeEntry` 兼容（多了可选的 `size`/`family`）��? */
export interface MapEntry {
  name: string
  /** 工作区相对路径，不带前导 '/'�?*/
  path: string
  kind: MapKind
  size?: number
  /** 文件大类（DATA �?TreeEntry 已按扩展名算好；缺省时本文件按扩展名兜底）��?*/
  family?: FileFamily
}

/** 布局里的文件节点（圆点；坐标 = 圆心，力导向结果）��?*/
export interface FolderLayoutNode {
  path: string
  name: string
  /** file = 普��文件；other = 不可进入的特殊条目（仍画出，但不假装是文件）�?*/
  kind: 'file' | 'other'
  /** 圆心坐标（画布像素）�?*/
  x: number
  y: number
  /** 节点半径�?*/
  r: number
  family: FileFamily
  /** 会话操作数；0 = 未触碰（**中��节�?*，不�?0 次操�?）��?*/
  ops: number
  /** 是否有会话数据（false = 中��：不显�?ops、不给族色强调）�?*/
  touched: boolean
  /** 文件字节数；缺省 = 大小未知（渲染成空心虚线节点，**不按 0 B 处理**）。 */
  size?: number
  /** 优先级序号（0 起；touched/ops 降序 → 名字升序，用于 tabIndex 与标签优先级）。 */
  index: number
}

/** 布局里的文件夹枢纽（圆角方卡；坐标 = 卡片中心，力导向结果）。 */
export interface FolderLayoutHub {
  path: string
  name: string
  /** 卡片中心 x�?*/
  x: number
  /** 卡片中心 y�?*/
  y: number
  width: number
  height: number
  /** 名字是否放得下（放不下时卡片仍可点，完整名在 aria/title）��?*/
  labelVisible: boolean
  /** 是否有真实的跨目录关系（false = 外围环��?*不画�?*）��?*/
  hasLinks: boolean
  /** 聚合到它的连线数�? = 无跨目录关系，tooltip �?`graph.hubEmpty`）��?*/
  linkCount: number
}

/** 枢纽 �?当前目录文件的聚合连线（**已解析为画布坐标**，线�?= 聚合权重）��?*/
export interface FolderLayoutHubEdge {
  hubPath: string
  filePath: string
  /** 聚合权重（多条真实跨目录边的权重之和）��?*/
  weight: number
  /** 真实跨边界边条数�?*/
  count: number
  x1: number
  y1: number
  x2: number
  y2: number
}

/** 丢�个已落位的标签（visible=false 表示放不下��不画）�?*/
/**
 * 枢纽 ↔ 枢纽的聚合连线（R11；**已解析为画布坐标**，线宽 = 聚合权重）。
 *
 * 无向：`aPath < bPath`（小写比较），A↔B 只出一条、**不双向重复**。
 * `key` 是 `min(a,b) + "\u0000" + max(a,b)` 的归一键（与 `hubPairKey` 同一口径），
 * 直接用作 DOM 的 `data-hub-pair` 值 —— 渲染层与测试层不再各自拼键。
 */
export interface FolderLayoutHubPair {
  /** 无向归一键（小写，`\u0000` 分隔）。 */
  key: string
  /** 小写路径较小的一端（原大小写，展示用）。 */
  aPath: string
  /** 小写路径较大的一端（原大小写，展示用）。 */
  bPath: string
  /** 聚合权重（真实边权重之和）。 */
  weight: number
  /** 真实边数。 */
  count: number
  x1: number
  y1: number
  x2: number
  y2: number
}

export interface FolderLayoutLabel {
  path: string
  text: string
  visible: boolean
  x: number
  y: number
  width: number
  anchor: 'start' | 'middle' | 'end'
}

/** 丢�个节点的拖动偏移（相对布屢�坐标，图坐标像素）��?*/
export interface NodeDragOffset {
  dx: number
  dy: number
}

export interface FolderLayoutOptions {
  width: number
  height: number
  /** 当前目录�?' = 工作区根）；只用来过滤会话数据里的文件到"直接子文�?�?*/
  currentPath?: string
  /** 默认文件节点上限（缺�?GRAPH_LIMITS.folder = 40）��?*/
  limit?: number
  /** 用户点了「显示全部��：取消上限（仍�?`hardLimit` 保护）��?*/
  showAll?: boolean
  /**
   * 「显示全部��的**硬上�?*（缺�?GRAPH_LIMITS.folderAllMax = 300）：
   * 目录里有几千个文件时不能把页面拖死，超过它仍然只画前 N 个并如实提示�?
*/
  hardLimit?: number
  /** 拖动偏移（键 = 小写路径）��布屢�阶段就套用，保证标签跟随、不产生二次坐标系统�?*/
  offsets?: Readonly<Record<string, NodeDragOffset>>
  /** 选中的文件（小写键；标签强制显示，且不受节点上限截断）��?*/
  selectedKey?: string | null
  /** hover 的文件（小写键；标签强制显示，且不受节点上限截断）��?*/
  hoveredKey?: string | null
  /** 播放头之后的未来节点（小写键；不画��不占标签位，但保留坐标）��?*/
  hiddenKeys?: ReadonlySet<string> | null
  /** 当前目录内文件之间的边（只用�?*引力**与图内分层；不含跨目录边）��?*/
  edges?: readonly GraphEdge[]
  /**
   * **全量**边集（未按当前目录过滤）：只用于把跨目录边聚合到枢纽�?
* `undefined` �?**不做枢纽聚合、不画任何枢纽连�?*（绝不伪造关系）�?   */
  allEdges?: readonly GraphEdge[]
  /**
   * 布局用**每枢纽保留几个伙伴**（默认 `GRAPH_HUB_PAIR_PARTNERS.all` = 4，即最宽档）。
   *
   * 为什么布局用**最宽档**而不是当前档：位置必须**跨档位稳定** ——
   * 切「骨架/标准/全部」只是少画/多画线，不该把整张图重排一遍
   * （R10 的文件边本来也是「几何吃全部边、绘制才分档」，这里沿用同一口径）。
   * 绘制层的 top-2/top-4 由 `truncateHubPairs` 在渲染时单独截（同一套规则）。
   */
  hubPairPartners?: number
  /** 覆盖力导向迭代轮数（测试/证据用；缺省 FORCE_DEFAULTS.iterations）。 */
  iterations?: number
  /** 覆盖力导�?*预热**轮数（纯斥力炸开；缺�?FORCE_DEFAULTS.warmupIterations）��?*/
  warmupIterations?: number
  /** 覆盖簇内聚拢强度（缺�?FORCE_DEFAULTS.clusterGravity�? = 关闭，���回点对点力导向）�?*/
  clusterGravity?: number
  /** 覆盖斥力（缺�?FORCE_DEFAULTS.repulsion）��?*/
  repulsion?: number
  /** 覆盖弹簧（缺�?FORCE_DEFAULTS.spring）��?*/
  spring?: number
  /** 覆盖理想边长系数（缺�?FORCE_DEFAULTS.spread）��?*/
  spread?: number
}

export interface FolderLayout extends FolderGeometry {
  labels: FolderLayoutLabel[]
}

/**
 * **几何结果**（不含标签）。力导向是重计算，hover/选中只影响标签可见��，
 * 因此拆成两段：几何按（entries/files/画布/上限/edges/allEdges/offsets）memo�? * 标签再按（selectedKey/hoveredKey/hiddenKeys）单独算 —��?hover 不重跑模拟��? */
export interface FolderGeometry {
  /** 文件夹枢纽（圆角方卡；坐�?= 中心）��?*/
  hubs: FolderLayoutHub[]
  /** 文件节点（圆点）�?*/
  nodes: FolderLayoutNode[]
  /** 枢纽 ↔ 文件的聚合连线（只有真实跨目录关系才有）。 */
  hubEdges: FolderLayoutHubEdge[]
  /**
   * 枢纽 ↔ 枢纽的聚合连线（R11；**只有真实跨目录边才有**，无向去重）。
   * 数量随 `density` 变化：骨架 0 / 标准每枢纽 top-2 / 全部每枢纽 top-4。
   */
  hubPairs: FolderLayoutHubPair[]
  width: number
  height: number
  /** 画出的文件节点数�?*/
  shownFiles: number
  /** 当前目录文件总数（entries 里的 file/other，并上会话数据里的文件）�?*/
  totalFiles: number
  /** 是否因上限少画了文件（必须显示��显�?N/M」，不静默截断）�?*/
  truncated: boolean
  /** 当前生效的文件节点上限（40 �?= 40；全部档 = 硬上限）�?*/
  limit: number
  /** 是否是��显示全部��状态��?*/
  showAll: boolean
  /** 是否还有被硬上限挡住的文件（全部档也要如实说）��?*/
  hardTruncated: boolean
  /** 文件夹枢纽数�?*/
  hubCount: number
  /** 是否有任何内容（决定空��）�?*/
  empty: boolean
  /** 内容包围盒（含半径）占画布的比例：两轴里较大的那个（"铺满视口"断言用）�?*/
  fillRatio: number
  /** 两轴各自的比例（测试可断訢��?�?0.55）��?*/
  fillX: number
  fillY: number
}

/** 标签字号（屏显 px；与 map.css 的 .tl-ofile-label 保持一致）。 */
export const FOLDER_LABEL_FONT_PX = 11

/**
 * 在**已算好的几何**上叠加拖动偏移（纯函数）。
 *
 * 为什么要有它（性能根因，D-35）：
 * `layoutFolderGeometry` 会跑固定轮数的力导向 + 重叠消除，代价是 O(N²)×轮数。
 * 旧实现把 `dragOffsets` 放进它的依赖里 → **每一次 pointermove 都重跑整场模拟**，
 * 复杂目录里拖动直接掉帧/卡死。
 *
 * 拖动在语义上只是"把某个节点平移"，不影响其它任何节点位置，
 * 因此正确做法是：几何只算一次，拖动时只对目标节点做坐标平移。
 * 这样每帧代价从 O(N²×轮数) 降到 O(N)。
 */
export function applyDragOffsets(geometry: FolderGeometry, offsets: Readonly<Record<string, NodeDragOffset>>): FolderGeometry {
  const keys = Object.keys(offsets)
  if (keys.length === 0) return geometry
  const nodes = geometry.nodes.map((node) => {
    const offset = offsets[caseKeyOf(node.path)]
    if (offset === undefined) return node
    if (offset.dx === 0 && offset.dy === 0) return node
    return { ...node, x: round2(node.x + offset.dx), y: round2(node.y + offset.dy) }
  })
  const hubs = geometry.hubs.map((hub) => {
    const offset = offsets[caseKeyOf(hub.path)]
    if (offset === undefined) return hub
    if (offset.dx === 0 && offset.dy === 0) return hub
    return { ...hub, x: round2(hub.x + offset.dx), y: round2(hub.y + offset.dy) }
  })
  const hubEdges = geometry.hubEdges.map((edge) => {
    const hubOffset = offsets[caseKeyOf(edge.hubPath)]
    const fileOffset = offsets[caseKeyOf(edge.filePath)]
    if (hubOffset === undefined && fileOffset === undefined) return edge
    return {
      ...edge,
      x1: round2(edge.x1 + (hubOffset?.dx ?? 0)),
      y1: round2(edge.y1 + (hubOffset?.dy ?? 0)),
      x2: round2(edge.x2 + (fileOffset?.dx ?? 0)),
      y2: round2(edge.y2 + (fileOffset?.dy ?? 0)),
    }
  })
  const hubPairs = geometry.hubPairs.map((pair) => {
    const aOffset = offsets[caseKeyOf(pair.aPath)]
    const bOffset = offsets[caseKeyOf(pair.bPath)]
    if (aOffset === undefined && bOffset === undefined) return pair
    return {
      ...pair,
      x1: round2(pair.x1 + (aOffset?.dx ?? 0)),
      y1: round2(pair.y1 + (aOffset?.dy ?? 0)),
      x2: round2(pair.x2 + (bOffset?.dx ?? 0)),
      y2: round2(pair.y2 + (bOffset?.dy ?? 0)),
    }
  })
  return { ...geometry, nodes, hubs, hubEdges, hubPairs }
}
/** 标签行高（px）��?*/
export const FOLDER_LABEL_HEIGHT = 13
/** 标签与节点圆之间的间隙��?*/
export const FOLDER_LABEL_GAP = 5
/** 枢纽卡片高度（圆角方卡）�?*/
export const FOLDER_HUB_HEIGHT = 26
/** 枢纽卡片左右内边距��?*/
export const FOLDER_HUB_PAD = 9
/** 枢纽卡片朢�大宽度（超过则名字不出��只留卡�?+ aria）��?*/
export const FOLDER_HUB_MAX_WIDTH = 132
/** 枢纽卡片朢�小宽度��?*/
export const FOLDER_HUB_MIN_WIDTH = 54
/** 「全部��档的半径缩放下限（�?1/√n 缩一档，但不小于这个比例）��?*/
export const FOLDER_ALL_RADIUS_FLOOR = 0.5
/**
 * 枢纽卡片之间的**最小间隙**（px；R11 / 03 §4.2.2）。
 * 卡片中心距不得小于 `hypot(w1,h1)/2 + hypot(w2,h2)/2 + 本值`，保证字不压字。
 */
export const FOLDER_HUB_MIN_GAP = 10

/**
 * 结构边是否参�?*弹簧引力**（R10b，Lead 实测后定的方�?A）��? *
 * 实测（真�?DOM，`state=default&nested=1&dir=src/client`）：
 * `maxDeg = 27 / 29 节点`�?7 �?`structure` 边全部指向同丢�锚点
 * （`buildStructureEdges` �?*单锚�?*策略：同目录其余文件全连 `sorted[0]`）��? * 27 根弹簧同时拉丢�个点，合力远大于斥力 �?无论怎么�?`spring`/`repulsion` 都是星爆�? *
 * 因此�?*结构边完全不产生点对点弹�?*（`false`）��? * - 位置改由三件事决定：共现/引用弹簧（真�?谁和谁常丢�起改"�? 簇内聚拢（拉向虚拟质心）+ 斥力�? * - 结构�?*照常绘制**（L1 骨架）��照常进证据浮层、照常参�?L1/L2/L3 分层 —��?只不决定坐标�? *
 * 这是**布局参数**，不是关系语义：`edges` 原样传入、`buildStructureEdges` 丢�行未改��? * 三档密度与��全部��档的可见边集合完全不变�? */
export const STRUCTURE_SPRING_ENABLED = true

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/** 文本宽度（estimateTextWidth 的保守版本：× 1.06 防御真实字体略宽）��?*/
function textWidth(text: string, fontSize = FOLDER_LABEL_FONT_PX): number {
  return Math.ceil(estimateTextWidth(text, fontSize) * 1.06 * 100) / 100
}

/** 确定性名字比较（不依�?locale：先小写码点，再原串码点）��?*/
export function compareNames(left: string, right: string): number {
  const leftLower = left.toLowerCase()
  const rightLower = right.toLowerCase()
  if (leftLower !== rightLower) return leftLower < rightLower ? -1 : 1
  return left < right ? -1 : left > right ? 1 : 0
}

/** 文件节点基准半径：touched 节点�?ops 分档（与轮次图同口径）；中��节点固定小半径�?*/
export function folderNodeRadius(ops: number, touched: boolean): number {
  if (!touched) return 5
  const safe = Number.isFinite(ops) && ops > 0 ? ops : 0
  return Math.round((5.4 + Math.min(4.6, Math.sqrt(safe) * 0.42)) * 100) / 100
}

/**
 * 文件大小 → 节点半径（节点大小表达**文件体积**，不再表达操作次数）。
 *
 * 采用「面积随大小的对数增长」：直接按字节线性映射会让一个 2 MB 图片吞掉整张画布、
 * 而几个 KB 的小文件挤成一个点；取对数后同量级文件仍有可见差异，又能落在 4.5–14px 的
 * 可读区间内（最小值保证小文件可点，最大值避免大文件压住邻居与标签）。
 *
 * `undefined`（大小未知）返回中性半径，由调用方画成空心虚线节点，**不按 0 B 处理**。
 */
export const FOLDER_SIZE_RADIUS = { min: 4.5, max: 14, base: 3.2, factor: 0.42 } as const

export function folderRadiusFromSize(size: number | undefined): number {
  if (typeof size !== 'number' || !Number.isFinite(size) || size < 0) {
    return FOLDER_SIZE_RADIUS.min
  }
  const raw = FOLDER_SIZE_RADIUS.base + Math.log2(size + 1) * FOLDER_SIZE_RADIUS.factor
  const clamped = Math.min(FOLDER_SIZE_RADIUS.max, Math.max(FOLDER_SIZE_RADIUS.min, raw))
  return Math.round(clamped * 100) / 100
}

/**
 * 「显示全部��档的半径缩放（03 §4.2.3：半径按 1/√n 缩一档）�? * n �?40 �?= 1（不缩）；n 越大越小，但不低�?`FOLDER_ALL_RADIUS_FLOOR`�? */
export function allModeRadiusScale(nodeCount: number): number {
  if (!Number.isFinite(nodeCount) || nodeCount <= GRAPH_LIMITS.folder) return 1
  return Math.max(FOLDER_ALL_RADIUS_FLOOR, Math.round(Math.sqrt(GRAPH_LIMITS.folder / nodeCount) * 1000) / 1000)
}

/** 从路径取 basename（不�?shared/relations，避免额外��合）��?*/
function basenameOf(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash === -1 ? path : path.slice(slash + 1)
}

/** 从路径取父目录（'' = 根）。簇键用（同目录的文件成丢�簇）�?*/
function dirOfPath(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash < 0 ? '' : path.slice(0, slash)
}

/** 扩展�?�?文件族（仅用�?entries 里有、但会话数据里没有的文件；与 FileFamily 5 类一致）�?*/
const EXTENSION_FAMILY: Readonly<Record<string, FileFamily>> = {
  ts: 'code',
  tsx: 'code',
  js: 'code',
  jsx: 'code',
  mjs: 'code',
  cjs: 'code',
  css: 'code',
  scss: 'code',
  html: 'code',
  vue: 'code',
  py: 'code',
  rs: 'code',
  go: 'code',
  java: 'code',
  sh: 'code',
  ps1: 'code',
  md: 'text',
  txt: 'text',
  rst: 'text',
  yml: 'text',
  yaml: 'text',
  toml: 'text',
  ini: 'text',
  json: 'data',
  jsonl: 'data',
  csv: 'data',
  tsv: 'data',
  xml: 'data',
  sql: 'data',
  png: 'media',
  jpg: 'media',
  jpeg: 'media',
  gif: 'media',
  webp: 'media',
  svg: 'media',
  mp4: 'media',
  mov: 'media',
  mp3: 'media',
  wav: 'media',
  webm: 'media',
}

export function familyOfName(name: string): FileFamily {
  const dot = name.lastIndexOf('.')
  if (dot <= 0 || dot === name.length - 1) return 'other'
  const ext = name.slice(dot + 1).toLowerCase()
  return EXTENSION_FAMILY[ext] ?? 'other'
}

/** 目录键（'' = 工作区根）→ 展示名（根目录用调用方给�?label，缺�?'/'）��?*/
export function folderNameOf(path: string, rootLabel = ''): string {
  if (path === '') return rootLabel
  return basenameOf(path)
}

interface CandidateFile {
  path: string
  name: string
  kind: 'file' | 'other'
  ops: number
  touched: boolean
  family: FileFamily
  /** 文件字节数；`undefined` = 大小未知（不按 0 处理）。 */
  size?: number
}

/**
 * 合并 entries 与会话文�?�?文件节点候����? *
 * 规则�?1 §4.2 + 07 §4.1）：
 * - entries 里的 file/other 全部是节点（未触�?= 中��，不隐藏）�? * - 会话数据里的文件即使 entries 暂时没列到（列表截断/刷新中）也保�?—��?宁可多画已知节点�? *
不把"有操作记录的文件"弄丢�? * - 按路径（小写）去重；同名不同大小写只保留丢�条（首见优先 entries）��? */
export function collectFolderNodes(
  entries: readonly MapEntry[],
  files: readonly FileNode[],
  options: { currentPath?: string } = {},
): CandidateFile[] {
  const currentPath = options.currentPath ?? ''
  const prefix = currentPath === '' ? '' : currentPath + '/'
  const byKey = new Map<string, CandidateFile>()
  for (const entry of entries) {
    if (entry.kind === 'directory') continue
    const key = entry.path.toLowerCase()
    if (byKey.has(key)) continue
    byKey.set(key, {
      path: entry.path,
      name: entry.name === '' ? basenameOf(entry.path) : entry.name,
      kind: entry.kind === 'other' ? 'other' : 'file',
      ops: 0,
      touched: false,
      // 只有宿主给出有限非负字节数时才带 size；未知一律 undefined（渲染成空心节点）。
      ...(typeof entry.size === 'number' && Number.isFinite(entry.size) && entry.size >= 0 ? { size: entry.size } : {}),
      // 优先�?DATA 给的 family（与 rail/关系层同丢�份扩展名规则），缺省再兜底��?
family: entry.family ?? familyOfName(entry.name === '' ? entry.path : entry.name),
    })
  }
  for (const file of files) {
    if (file.path === '') continue
    // 只收当前目录的直接文件（会话文件可能来自任意目录）��?
if (prefix !== '') {
      if (!file.path.startsWith(prefix)) continue
      if (file.path.slice(prefix.length).includes('/')) continue
    } else if (file.path.includes('/')) {
      continue
    }
    const key = file.path.toLowerCase()
    const existing = byKey.get(key)
    if (existing === undefined) {
      byKey.set(key, {
        path: file.path,
        name: file.name === '' ? basenameOf(file.path) : file.name,
        kind: 'file',
        ops: Math.max(0, file.ops),
        touched: true,
        family: file.family,
      })
      continue
    }
    existing.ops = Math.max(existing.ops, Math.max(0, file.ops))
    existing.touched = true
    existing.family = file.family
    if (existing.name === '') existing.name = file.name
  }
  return [...byKey.values()]
}

/** 当前目录的直接子文件夹（entries 里的 directory；按名字确定性排序）�?*/
export function collectFolderHubs(entries: readonly MapEntry[], currentPath = ''): MapEntry[] {
  const prefix = currentPath === '' ? '' : currentPath + '/'
  const byKey = new Map<string, MapEntry>()
  for (const entry of entries) {
    if (entry.kind !== 'directory') continue
    if (prefix !== '' && !entry.path.startsWith(prefix)) continue
    const key = entry.path.toLowerCase()
    if (byKey.has(key)) continue
    byKey.set(key, entry)
  }
  return [...byKey.values()].sort((left, right) => compareNames(left.name, right.name))
}

/** 节点的优先级排序：touched 在前 �?ops 降序 �?名字升序 �?路径（确定��）�?*/
function compareCandidates(left: CandidateFile, right: CandidateFile): number {
  if (left.touched !== right.touched) return left.touched ? -1 : 1
  if (left.ops !== right.ops) return right.ops - left.ops
  const byName = compareNames(left.name, right.name)
  if (byName !== 0) return byName
  return left.path < right.path ? -1 : left.path > right.path ? 1 : 0
}

/**
 * **拖动钉住单点**的坐标计算（03 §4.2.1：拖谁钉谁，其余节点不重排）�? *
 * 纯函数：吃当前坐标数�?+ 目标下标 + 位移，返回新坐标数组�? * **只有目标点变**，其余��字段不变（测试直接断言）��? */
export function pinnedPositions(
  nodes: ReadonlyArray<{ x: number; y: number }>,
  index: number,
  dx: number,
  dy: number,
): Array<{ x: number; y: number }> {
  return nodes.map((node, at) => (at === index ? { x: round2(node.x + dx), y: round2(node.y + dy) } : node))
}

/** 枢纽卡片宽度（标签放得下才显示名字，绝不画截断碎片）�?*/
function hubCardWidth(name: string): { width: number; labelVisible: boolean } {
  // 卡片宽度 = 左内边距 + 图标�?+ 间隙 + 文本 + 右内边距（图标画�?x-�?处��文本从 x-�?起）�?
const wanted = Math.round(FOLDER_HUB_PAD + 14 + textWidth(name) + FOLDER_HUB_PAD)
  return {
    width: Math.min(FOLDER_HUB_MAX_WIDTH, Math.max(FOLDER_HUB_MIN_WIDTH, wanted)),
    labelVisible: wanted <= FOLDER_HUB_MAX_WIDTH,
  }
}

/**
 * 当前目录关系图布屢��?*确定性力导向**�? 几何 + 标签（测试与静��渲染用这个）��? *
 * 步骤�? * 1. `layoutFolderGeometry`：��点（上限）�?力导向（固定迭代轮数）→ 归一化铺�?�?拖钉 + 跨目录聚合边�? * 2. `layoutFolderLabels`：按选中/悬浮/播放头算标签避让（便宜，hover 时可单独重算）��? */
export function layoutFolder(
  entries: readonly MapEntry[],
  files: readonly FileNode[],
  options: FolderLayoutOptions,
): FolderLayout {
  const geometry = layoutFolderGeometry(entries, files, options)
  return { ...geometry, labels: layoutFolderLabels(geometry, options) }
}

/**
 * **第一段：几何**（力导向 + 归一化铺�?+ 拖钉 + 枢纽聚合边）�? *
 * 不依�?selectedKey/hoveredKey/hiddenKeys（只影响"强制可见"的��点与标签）�? * 因此组件可以只按数据/画布/上限 memo 它，hover 不重算��? */
export function layoutFolderGeometry(
  entries: readonly MapEntry[],
  files: readonly FileNode[],
  options: FolderLayoutOptions,
): FolderGeometry {
  const width = Math.max(240, Math.round(options.width))
  const height = Math.max(180, Math.round(options.height))
  const currentPath = options.currentPath ?? ''
  const baseLimit = Math.max(1, Math.trunc(options.limit ?? GRAPH_LIMITS.folder))
  const hardLimit = Math.max(baseLimit, Math.trunc(options.hardLimit ?? GRAPH_LIMITS.folderAllMax))
  const showAll = options.showAll === true
  const limit = showAll ? hardLimit : baseLimit

  const hubEntries = collectFolderHubs(entries, currentPath)
  const candidates = collectFolderNodes(entries, files, { currentPath })
  const totalFiles = candidates.length

  if (hubEntries.length === 0 && candidates.length === 0) {
    return {
      hubs: [],
      nodes: [],
      hubEdges: [],
      hubPairs: [],
      width,
      height,
      shownFiles: 0,
      totalFiles: 0,
      truncated: false,
      limit,
      showAll,
      hardTruncated: false,
      hubCount: 0,
      empty: true,
      fillRatio: 0,
      fillX: 0,
      fillY: 0,
    }
  }

  /* ---------- 1. 选点（上�?+ 选中/悬浮强制可见�?---------- */
  const selectedKey = options.selectedKey ?? null
  const hoveredKey = options.hoveredKey ?? null
  const forcedKeys = new Set<string>()
  for (const key of [hoveredKey, selectedKey]) if (key !== null && key !== '') forcedKeys.add(key)

  const ordered = candidates.slice().sort(compareCandidates)
  const kept: CandidateFile[] = []
  const keptKeys = new Set<string>()
  for (const candidate of ordered) {
    if (kept.length >= limit) break
    kept.push(candidate)
    keptKeys.add(candidate.path.toLowerCase())
  }
  // 选中/悬浮即使超出上限也强制画出（规格 4.2.3：悬�?选中依然强制可见）��?
for (const candidate of ordered) {
    const key = candidate.path.toLowerCase()
    if (keptKeys.has(key) || !forcedKeys.has(key)) continue
    kept.push(candidate)
    keptKeys.add(key)
  }
  // 输出顺序固定为优先级顺序�? �?ordered 的子序列），保证 index 稳定�?
kept.sort(compareCandidates)

  const radiusScale = showAll ? allModeRadiusScale(kept.length) : 1

  /* ---------- 2. 枢纽卡片 ---------- */
  const hubInfos = hubEntries.map((entry) => {
    const name = entry.name === '' ? basenameOf(entry.path) : entry.name
    const card = hubCardWidth(name)
    return { entry, name, width: card.width, height: FOLDER_HUB_HEIGHT, labelVisible: card.labelVisible }
  })

  /* ---------- 3. 跨目录聚合（枢纽参与结构） ---------- */
  const hubLinkIndex: CrossBoundaryIndex = buildCrossBoundaryIndex(options.allEdges)
  const hubLinkResult = computeHubLinks(hubLinkIndex, {
    currentPath,
    filePaths: kept.map((candidate) => candidate.path),
    hubPaths: hubInfos.map((info) => info.entry.path),
  })
  /**
   * 3b. **枢纽 ↔ 枢纽**的聚合（R11：不同文件夹之间也要连线）。
   *
   * 一次 O(E) 扫描（`computeHubPairs` 内部），不是 O(枢纽对数 × E)。
   * 这里取**最宽档**（每枢纽 top-4）作为布局的弹簧集：位置跨档位稳定，
   * 绘制时再按当前档位用 `truncateHubPairs` 截成 0 / top-2 / top-4（同一套规则）。
   */
  const hubPairs = computeHubPairs(options.allEdges, {
    currentPath,
    hubPaths: hubInfos.map((info) => info.entry.path),
    maxPartnersPerHub: options.hubPairPartners ?? GRAPH_HUB_PAIR_PARTNERS.all,
  })

  /* ---------- 4. 力导�?---------- */
  /**
   * 4-pre. **簇键**（R10b：成簇��不是星爆）—��?方案 A 的完整实现��?
*
   * 三步�?
* 1. **种子�?* = 强关系（`type !== 'structure'`：共�?同会�?引用/时序）的连��分量��?   *    这才是��谁和谁常一起被改��的真实分组�?   * 2. **孤立节点归队**：只在结构骨架里出现的节点（实测 29 节点里有 12 个）如果各自成簇�?   *    会孤零零飘在边缘（Lead 实测确实如此）��因此把它们�?*结构边邻�?*并入种子簇：
   *    取它在结构边里的邻居（按路径升序取第丢�个）扢�在的簇；找不到就并入朢�大种子簇�?
* 3. **完全没有强关系时**（全是被结构边连起来的一张星）：扢�有文件并�?*丢��?*簇��?   *    此时簇引力只�?软��地收拢成一个团"，节点间仍靠斥力摊开 —��?得到的是**圆盘�?*�?   *    不是"从一个点射出 27 条射�?的星爆（因为结构边已不产生弹簧，�?STRUCTURE_SPRING_ENABLED）��?   *
   * 结构边在这里**只用�?归队"**（告诉布屢�"这个节点属于谁那丢��?），不产生点对点弹簧�?
*/
  const selectedKeys = new Set(kept.map((candidate) => candidate.path.toLowerCase()))
  const selectedPaths = new Map(kept.map((candidate) => [candidate.path.toLowerCase(), candidate.path]))

  // 1. 强关系连通分量（跳过 structure）��?
const strongParent = new Map<string, string>()
  const findRoot = (key: string): string => {
    let root = strongParent.get(key) ?? key
    while (root !== (strongParent.get(root) ?? root)) root = strongParent.get(root) ?? root
    strongParent.set(key, root)
    return root
  }
  for (const key of selectedKeys) strongParent.set(key, key)
  for (const edge of options.edges ?? []) {
    if (edge.type === 'structure') continue
    const from = edge.from.toLowerCase()
    const to = edge.to.toLowerCase()
    if (!selectedKeys.has(from) || !selectedKeys.has(to)) continue
    const fromRoot = findRoot(from)
    const toRoot = findRoot(to)
    if (fromRoot !== toRoot) strongParent.set(fromRoot, toRoot)
  }
  const strongSize = new Map<string, number>()
  for (const key of selectedKeys) {
    const root = findRoot(key)
    strongSize.set(root, (strongSize.get(root) ?? 0) + 1)
  }
  /** 真正的种子簇（成�?�? 的强关系分量）��?*/
  const seedRoots = [...strongSize.entries()]
    .filter(([, size]) => size >= 2)
    .map(([root]) => root)
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
  // 朢�大种子簇（并列时按根键升序，确定性）�?
let largestSeedRoot: string | null = null
  let largestSeedSize = 0
  for (const root of seedRoots) {
    const size = strongSize.get(root) ?? 0
    if (size > largestSeedSize || (size === largestSeedSize && largestSeedRoot !== null && root < largestSeedRoot)) {
      largestSeedRoot = root
      largestSeedSize = size
    }
  }

  // 结构骨架邻居（用于孤立节点归队；按路径升序保证确定��）�?
const structureNeighbors = new Map<string, string[]>()
  for (const edge of options.edges ?? []) {
    if (edge.type !== 'structure') continue
    const from = edge.from.toLowerCase()
    const to = edge.to.toLowerCase()
    if (!selectedKeys.has(from) || !selectedKeys.has(to)) continue
    structureNeighbors.set(from, [...(structureNeighbors.get(from) ?? []), to])
    structureNeighbors.set(to, [...(structureNeighbors.get(to) ?? []), from])
  }
  for (const [key, list] of structureNeighbors) structureNeighbors.set(key, list.slice().sort())

  const resolvedCluster = new Map<string, string>()
  for (const key of selectedKeys) {
    const root = findRoot(key)
    if ((strongSize.get(root) ?? 0) >= 2) {
      resolvedCluster.set(key, 'cmp:' + root)
      continue
    }
    // 孤立节点：先看结构邻居是否已在种子簇里��?
let joined: string | null = null
    for (const neighbor of structureNeighbors.get(key) ?? []) {
      const neighborRoot = findRoot(neighbor)
      if ((strongSize.get(neighborRoot) ?? 0) >= 2) {
        joined = 'cmp:' + neighborRoot
        break
      }
    }
    // 再���到最大种子簇；连种子簇都没有就统丢�成一个团�?
if (joined === null && largestSeedRoot !== null) joined = 'cmp:' + largestSeedRoot
    if (joined === null) joined = 'all'
    resolvedCluster.set(key, joined)
  }
  const clusterKeyOf = (path: string): string => resolvedCluster.get(path.toLowerCase()) ?? 'all'

  // 4a. 先按**路径排序**建立稳定的力导向数组（确定��四条里的第 3 条）�?
interface Plan {
    key: string
    kind: 'hub' | 'file'
    /** �?`kept` 里的下标（file）或 `hubInfos` 里的下标（hub）��?*/
    sourceIndex: number
    radius: number
    halfWidth: number
    halfHeight: number
    /** 簇键：强关系连��分量（�?4-pre）；枢纽自成簇��?*/
    clusterKey: string
  }
  const plans: Plan[] = []
  for (let index = 0; index < hubInfos.length; index += 1) {
    const info = hubInfos[index]
    // 外接圆半�?= hypot(w,h)/2 �?圆不相交就保证卡片矩形不相交�?
const radius = Math.hypot(info.width, info.height) / 2
    plans.push({
      key: info.entry.path.toLowerCase(),
      kind: 'hub',
      sourceIndex: index,
      radius,
      halfWidth: info.width / 2,
      halfHeight: info.height / 2,
      // 枢纽自成簇（它代表一个子目录，不该和当前目录的文件挤在一起）�?
clusterKey: '\u0000hub:' + info.entry.path.toLowerCase(),
    })
  }
  for (let index = 0; index < kept.length; index += 1) {
    const radius = round2(folderRadiusFromSize(kept[index].size) * radiusScale)
    plans.push({
      key: kept[index].path.toLowerCase(),
      kind: 'file',
      sourceIndex: index,
      radius,
      halfWidth: radius,
      halfHeight: radius,
      clusterKey: clusterKeyOf(kept[index].path),
    })
  }
  plans.sort((left, right) => {
    if (left.key !== right.key) return left.key < right.key ? -1 : 1
    return left.kind < right.kind ? -1 : left.kind > right.kind ? 1 : 0
  })

  const forceNodes: ForceNode[] = plans.map((plan) => ({
    key: plan.key,
    radius: plan.radius,
    halfWidth: plan.halfWidth,
    halfHeight: plan.halfHeight,
    clusterKey: plan.clusterKey,
  }))

  // 4b. 引力：文件↔文件（`edges` 聚合后）× 枢纽↔文件（跨目录聚合）�?
const planIndexByKey = new Map<string, number>()
  for (let index = 0; index < plans.length; index += 1) planIndexByKey.set(plans[index].key, index)
  const fileKeys = new Set(kept.map((candidate) => candidate.path.toLowerCase()))
  const links: ForceLink[] = []
  const innerEdges = (options.edges ?? []).filter((edge) => fileKeys.has(edge.from.toLowerCase()) && fileKeys.has(edge.to.toLowerCase()))
  const innerPairs = aggregateEdgePairs(innerEdges)
  /**
   * 结构边降权（Lead 实测后定的方�?A）：**纯结构边不产生弹�?*�?
*
   * 理由�?`STRUCTURE_SPRING_ENABLED` 的注释：27 条结构边全指向同丢�锚点�?
* 27 根弹簧合力必然星爆（�?spring/repulsion 无效，已实测）��?   * 结构边仍�?*照常绘制**（L1）��照常进证据浮层，只是不参与坐标计算�?   */
  for (const pair of innerPairs) {
    const from = planIndexByKey.get(pair.from.toLowerCase())
    const to = planIndexByKey.get(pair.to.toLowerCase())
    if (from === undefined || to === undefined || from === to) continue
    // 只有"纯结构边"才被排除；只要还有共�?引用类型，就按更强的关系算正常弹簧��?
const structuralOnly = pair.typeList.every((type) => type === 'structure')
    if (structuralOnly && !STRUCTURE_SPRING_ENABLED) continue
    const base = 0.6 + Math.min(1.4, Math.log2(1 + Math.max(0, pair.weight)))
    links.push({ from, to, strength: base })
  }
  for (const [hubKey, hubLinks] of hubLinkResult.links) {
    const hubIndex = planIndexByKey.get(hubKey)
    if (hubIndex === undefined) continue
    for (const link of hubLinks) {
      const fileIndex = planIndexByKey.get(link.filePath.toLowerCase())
      if (fileIndex === undefined || fileIndex === hubIndex) continue
      links.push({ from: hubIndex, to: fileIndex, strength: 0.55 + Math.min(1.2, Math.log2(1 + Math.max(0, link.weight))) })
    }
  }
  /**
   * 3c. 枢纽 ↔ 枢纽的**弱弹簧引力**（R11）：权重越大拉得越近，形状本身传达结构。
   *
   * `strength = 0.16 + min(0.5, log2(1+weight) × 0.12)`（规格给定公式）：
   * - 下限 0.16 保证「有真实来往就有一点向心力」，不会因为权重小到 1 而完全不动；
   * - 上限 0.16 + 0.5 = 0.66，明显弱于文件间弹簧（0.6 + min(1.4, log2(1+w))，可达 2.0）——
   *   枢纽是**背景结构**，不能把文件节点甩到一边。
   *
   * 遍历 `hubPairs`（`computeHubPairs` 已按权重降序 → 路径升序排好，再加一次 (a,b) 排序）
   * → 数值累加顺序固定 = 确定性第 3 条。
   */
  const hubPairLinks: ForceLink[] = []
  for (const pair of hubPairs) {
    const from = planIndexByKey.get(pair.aPath.toLowerCase())
    const to = planIndexByKey.get(pair.bPath.toLowerCase())
    if (from === undefined || to === undefined || from === to) continue
    const strength = 0.16 + Math.min(0.5, Math.log2(1 + Math.max(0, pair.weight)) * 0.12)
    hubPairLinks.push({ from, to, strength })
  }
  hubPairLinks.sort((left, right) => (left.from !== right.from ? left.from - right.from : left.to - right.to))
  for (const link of hubPairLinks) links.push(link)
  // 边顺序固定（按 (from,to) 排序）—— 确定性第 3 条要求。
  links.sort((left, right) => (left.from !== right.from ? left.from - right.from : left.to - right.to))

  const simulation = simulateForce(forceNodes, links, {
    width,
    height,
    iterations: options.iterations ?? FORCE_DEFAULTS.iterations,
    ...(options.warmupIterations === undefined ? {} : { warmupIterations: options.warmupIterations }),
    ...(options.clusterGravity === undefined ? {} : { clusterGravity: options.clusterGravity }),
    ...(options.repulsion === undefined ? {} : { repulsion: options.repulsion }),
    ...(options.spring === undefined ? {} : { spring: options.spring }),
    ...(options.spread === undefined ? {} : { spread: options.spread }),
  })

  /**
   * 4c. **卡片斥力下限**（R11）：枢纽卡片中心距 ≥ `hypot(w1,h1)/2 + hypot(w2,h2)/2 + 10`。
   *
   * 力导向的斥力是软的，归一化的等比缩放还会改变「距离 / 半径」比值 ——
   * 卡片（132×26 的长条）在缩放后仍可能贴在一起，字压字就读不出来了。
   * 因此在**归一化之后的像素空间**再做一次确定性松弛（固定轮数、顺序固定、无随机）。
   *
   * 只约束「枢纽 ↔ 枢纽」：文件圆点的无重叠已由 `simulateForce` 的 OVERLAP_PASSES 保证，
   * 文件 ↔ 枢纽的最小间距由斥力的 `halfW/halfH` 参与计算，这里只补卡片这类长条的特例。
   */
  const hubCardConstraints: MinDistanceConstraint[] = []
  const hubPlanIndexes: number[] = []
  for (const info of hubInfos) {
    const at = planIndexByKey.get(info.entry.path.toLowerCase())
    if (at !== undefined) hubPlanIndexes.push(at)
  }
  for (let left = 0; left < hubPlanIndexes.length; left += 1) {
    for (let right = left + 1; right < hubPlanIndexes.length; right += 1) {
      const a = hubPlanIndexes[left]
      const b = hubPlanIndexes[right]
      const aRadius = plans[a] === undefined ? 0 : Math.hypot(plans[a].halfWidth * 2, plans[a].halfHeight * 2) / 2
      const bRadius = plans[b] === undefined ? 0 : Math.hypot(plans[b].halfWidth * 2, plans[b].halfHeight * 2) / 2
      hubCardConstraints.push({ a, b, minDistance: aRadius + bRadius + FOLDER_HUB_MIN_GAP })
    }
  }
  const laidOut = simulation.positions.map((point) => ({ x: point.x, y: point.y }))
  enforceMinDistances(
    laidOut,
    plans.map((plan) => plan.halfWidth),
    plans.map((plan) => plan.halfHeight),
    hubCardConstraints,
    width,
    height,
  )

  /* ---------- 5. 套用拖动偏移（拖谁钉谁，其余不动） ---------- */
  const offsets = options.offsets ?? {}
  const placedX: number[] = []
  const placedY: number[] = []
  for (let index = 0; index < plans.length; index += 1) {
    const offset = offsets[plans[index].key]
    placedX.push(round2(laidOut[index].x + (offset?.dx ?? 0)))
    placedY.push(round2(laidOut[index].y + (offset?.dy ?? 0)))
  }

  /* ---------- 6. 出结�?---------- */
  const hubs: FolderLayoutHub[] = hubInfos.map((info, index) => {
    const at = planIndexByKey.get(info.entry.path.toLowerCase()) ?? 0
    const hubLinks = hubLinkResult.links.get(info.entry.path.toLowerCase()) ?? []
    return {
      path: info.entry.path,
      name: info.name,
      x: placedX[at],
      y: placedY[at],
      width: info.width,
      height: info.height,
      labelVisible: info.labelVisible,
      hasLinks: hubLinks.length > 0,
      linkCount: hubLinks.length,
    }
  })

  const nodes: FolderLayoutNode[] = kept.map((candidate, index) => {
    const at = planIndexByKey.get(candidate.path.toLowerCase()) ?? 0
    return {
      path: candidate.path,
      name: candidate.name,
      kind: candidate.kind,
      x: placedX[at],
      y: placedY[at],
      r: plans[at]?.radius ?? folderRadiusFromSize(candidate.size),
      family: candidate.family,
      ops: candidate.ops,
      touched: candidate.touched,
      ...(typeof candidate.size === 'number' ? { size: candidate.size } : {}),
      index,
    }
  })

  const nodeByKey = new Map<string, FolderLayoutNode>()
  for (const node of nodes) nodeByKey.set(node.path.toLowerCase(), node)
  const hubEdges: FolderLayoutHubEdge[] = []
  for (const hub of hubs) {
    const hubLinks = hubLinkResult.links.get(hub.path.toLowerCase()) ?? []
    for (const link of hubLinks) {
      const node = nodeByKey.get(link.filePath.toLowerCase())
      if (node === undefined) continue
      hubEdges.push({
        hubPath: hub.path,
        filePath: node.path,
        weight: link.weight,
        count: link.count,
        x1: hub.x,
        y1: hub.y,
        x2: node.x,
        y2: node.y,
      })
    }
  }
  hubEdges.sort((left, right) => {
    const byHub = compareNames(left.hubPath, right.hubPath)
    if (byHub !== 0) return byHub
    if (left.weight !== right.weight) return right.weight - left.weight
    return compareNames(left.filePath, right.filePath)
  })

  /**
   * 枢纽 ↔ 枢纽连线的画布坐标（R11）：端点 = 两张**卡片中心**（`hubs[].x/y`）。
   * 两端都必须真的画出来（hub 一定有），任一端缺就跳过 —— 不画半条悬空线。
   */
  const hubByKey = new Map<string, FolderLayoutHub>()
  for (const hub of hubs) hubByKey.set(hub.path.toLowerCase(), hub)
  const layoutHubPairs: FolderLayoutHubPair[] = []
  for (const pair of hubPairs) {
    const a = hubByKey.get(pair.aPath.toLowerCase())
    const b = hubByKey.get(pair.bPath.toLowerCase())
    if (a === undefined || b === undefined || a === b) continue
    layoutHubPairs.push({
      key: hubPairKey(pair.aPath, pair.bPath),
      aPath: a.path,
      bPath: b.path,
      weight: pair.weight,
      count: pair.count,
      x1: a.x,
      y1: a.y,
      x2: b.x,
      y2: b.y,
    })
  }
  layoutHubPairs.sort((left, right) => {
    if (left.weight !== right.weight) return right.weight - left.weight
    return left.key < right.key ? -1 : left.key > right.key ? 1 : 0
  })

  /**
   * 「铺满视口」必须在**最终坐标**上量（R11 新增的卡片斥力松弛会移动坐标，
   * 用它之前的 `simulation.fillRatio` 报数就成了旧值 —— 那属于假证据）。
   * 这里用同一套口径重算：含半宽高的包围盒 ÷ 画布。
   */
  const finalBounds = computeBounds(
    laidOut,
    plans.map((plan) => plan.halfWidth),
    plans.map((plan) => plan.halfHeight),
  )
  const fillX = Math.round(((finalBounds.maxX - finalBounds.minX) / width) * 1000) / 1000
  const fillY = Math.round(((finalBounds.maxY - finalBounds.minY) / height) * 1000) / 1000

  return {
    hubs,
    nodes,
    hubEdges,
    hubPairs: layoutHubPairs,
    width,
    height,
    shownFiles: nodes.length,
    totalFiles,
    truncated: totalFiles > nodes.length,
    limit,
    showAll,
    hardTruncated: showAll && totalFiles > nodes.length,
    hubCount: hubs.length,
    empty: false,
    fillRatio: Math.round(Math.max(fillX, fillY) * 1000) / 1000,
    fillX,
    fillY,
  }
}

/**
 * **第二段：标签**（避�?+ 整词或隐藏）�? *
 * 选中/悬浮强制显示（任何档位）；��全部��档只标悬停/选中�?3 §4.2.3）；
 * 放不下就整条不画�?*绝不截断�?`relati…` 碎片**），完整路径�?tooltip/aria�? */
export function layoutFolderLabels(
  geometry: FolderGeometry,
  options: { selectedKey?: string | null; hoveredKey?: string | null; hiddenKeys?: ReadonlySet<string> | null } = {},
): FolderLayoutLabel[] {
  if (geometry.empty) return []
  const { hubs, nodes, width, height } = geometry
  const hiddenKeys = options.hiddenKeys ?? null
  const visibleNodes = nodes.filter((node) => hiddenKeys === null || !hiddenKeys.has(node.path.toLowerCase()))
  const occupied: OccupiedBox[] = []
  for (const hub of hubs) {
    occupied.push({ x: hub.x - hub.width / 2, y: hub.y - hub.height / 2, width: hub.width, height: hub.height })
  }
  for (const node of nodes) {
    occupied.push({ x: node.x - node.r - 1, y: node.y - node.r - 1, width: node.r * 2 + 2, height: node.r * 2 + 2 })
  }

  // 「全部��档：标签只标悬�?选中�?3 §4.2.3）；40 档：尽量全标�?
const labelAll = !geometry.showAll
  const centerX = width / 2
  const centerY = height / 2
  const selectedKey = options.selectedKey ?? null
  const hoveredKey = options.hoveredKey ?? null
  const candidatesForLabels: LabelCandidate[] = []
  for (const node of visibleNodes) {
    const key = node.path.toLowerCase()
    const isSelected = selectedKey !== null && selectedKey === key
    const isHovered = hoveredKey !== null && hoveredKey === key
    const forced = isSelected || isHovered
    if (!labelAll && !forced) continue
    const labelWidth = textWidth(node.name)
    // 径向标签：远离画布中心的那一侧朝外展弢�（力导向图里朢�不容易压线）�?
const dx = node.x - centerX
    const dy = node.y - centerY
    const horizontal = Math.abs(dx) >= Math.abs(dy) * 0.8
    let boxX = 0
    let boxY = 0
    let anchor: 'start' | 'middle' | 'end' = 'middle'
    if (horizontal) {
      anchor = dx >= 0 ? 'start' : 'end'
      boxX = dx >= 0 ? node.x + node.r + FOLDER_LABEL_GAP : node.x - node.r - FOLDER_LABEL_GAP - labelWidth
      boxY = node.y - FOLDER_LABEL_HEIGHT / 2
    } else if (dy >= 0) {
      anchor = 'middle'
      boxX = node.x - labelWidth / 2
      boxY = node.y + node.r + FOLDER_LABEL_GAP
    } else {
      anchor = 'middle'
      boxX = node.x - labelWidth / 2
      boxY = node.y - node.r - FOLDER_LABEL_GAP - FOLDER_LABEL_HEIGHT
    }
    // 不越出画布；强制标签 clamp 进画布（宁可压一点也要能读出完整名）�?
if (!forced && (boxX < 2 || boxX + labelWidth > width - 2 || boxY < 2 || boxY + FOLDER_LABEL_HEIGHT > height - 2)) continue
    boxX = Math.max(2, Math.min(width - 2 - labelWidth, boxX))
    boxY = Math.max(2, Math.min(height - 2 - FOLDER_LABEL_HEIGHT, boxY))
    candidatesForLabels.push({
      key: node.path,
      text: node.name,
      x: round2(boxX),
      y: round2(boxY),
      width: labelWidth,
      height: FOLDER_LABEL_HEIGHT,
      priority: isSelected ? 1000 : isHovered ? 900 : node.touched ? 100 + Math.min(99, node.ops) : 1,
      force: forced,
      anchor,
    })
  }
  const placements = placeLabels(candidatesForLabels, occupied, 2)
  return placements.map((placement) => ({
    path: placement.key,
    text: placement.text,
    visible: placement.visible,
    x: placement.x,
    y: placement.y,
    width: placement.width ?? 0,
    anchor: placement.anchor === 'middle' ? 'middle' : placement.anchor === 'end' ? 'end' : 'start',
  }))
}
