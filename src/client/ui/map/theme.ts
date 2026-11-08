/*
 * map/theme.ts —— 文件关系图的视觉映射（33 §3/§4/§5）。
 *
 * 纪律：
 * - 颜色**只**引用 tokens.css 的 --tl-*（不在组件里写颜色字面量）；
 * - 5 个文件大类用 5 个低饱和令牌色，且颜色不单独承载信息：图例/标签/状态文字同时给；
 * - 状态色（读/写+/写−）也走令牌；「首见」用强调色；
 * - 星图旧概念（簇/缩放/网格）已删除：这里只剩文件级图需要的数据属性与常量。
 */
import type { FileFamily } from '../../../shared/events/index.ts'
import type { RelationType } from '../../../shared/relations/index.ts'

/** 文件大类的稳定顺序（图例按它排；33 §5）。 */
export const FILE_FAMILIES: readonly FileFamily[] = ['text', 'code', 'data', 'media', 'other']

/** 文件大类 → 令牌色（33 §5 表；与 base.css 的 swatch 语义一致）。 */
export const FAMILY_COLOR: Readonly<Record<FileFamily, string>> = {
  text: 'var(--tl-fg-secondary)',
  code: 'var(--tl-accent)',
  data: 'var(--tl-warn)',
  media: 'var(--tl-success)',
  other: 'var(--tl-fg-caption)',
}

/**
 * 文件大类 → locale key。
 * 注意：与 03 §16 的 fileFamily.* 一一对应；配置已并入文本、图片/音视频并入媒体。
 */
export const FAMILY_MESSAGE_KEY: Readonly<Record<FileFamily, 'fileFamily.text' | 'fileFamily.code' | 'fileFamily.data' | 'fileFamily.media' | 'fileFamily.other'>> = {
  text: 'fileFamily.text',
  code: 'fileFamily.code',
  data: 'fileFamily.data',
  media: 'fileFamily.media',
  other: 'fileFamily.other',
}

/** 本轮文件状态标记（33 §4）：只允许读 / 写 +行 / 写 −行 / 首见。 */
export const STATUS_COLOR = {
  read: 'var(--tl-status-read)',
  writeAdd: 'var(--tl-status-add)',
  writeDel: 'var(--tl-status-del)',
  firstSeen: 'var(--tl-accent)',
} as const

/**
 * 节点上限：folder（当前目录）= 40，**全部档**受 `folderAllMax` 硬上限保护
 * （目录里有几千个文件时不能把页面拖死，超过它仍然只画前 N 个并如实提示）；
 * turn（轮次，可跨目录）= 200。
 */
export const GRAPH_LIMITS = { folder: 40, folderAllMax: 300, turn: 200 } as const

/**
 * 边上限（03 §4.2.2）：**总绘制边数 ≤ 1.6 × 节点数**（超出按权重截断并显式提示）。
 * folder 图与 turn 图都按这条算术上限收口；`GRAPH_EDGE_LIMITS` 只保留 turn 的绝对上限。
 */
export const GRAPH_EDGE_FACTOR = 1.6
export const GRAPH_EDGE_LIMITS = { turn: 160 } as const

/** 每个节点取 top-3 共现边进 L2（03 §4.2.2）。 */
export const GRAPH_COOCCURRENCE_TOP = 3
/** 每个文件夹枢纽最多连出几条聚合边（跨目录真实关系，03 §4.2.2）。 */
export const GRAPH_HUB_MAX_LINKS = 3

/** 关系密度三档（03 §4.2.2）：骨架 = L1、标准 = L1+L2（默认）、全部 = L1+L2+L3。 */
export type GraphDensity = 'skeleton' | 'standard' | 'all'

/**
 * **枢纽 ↔ 枢纽**每个枢纽保留几个伙伴（03 §4.2.2「文件夹枢纽参与结构」第 2 条，R11）。
 *
 * 规格：`骨架` 不画；`标准`（默认）每枢纽 **top-2**；`全部` 每枢纽 **top-4**。
 * 超出按聚合权重截断；被任一端的 top-N 选中就保留整条线（**两端都保留**，不丢半边）。
 *
 * 与文件边的 `≤1.6×节点数` 比例无关：枢纽间线属于"目录层"信息，单独限流（03 §4.2.2 末条）。
 */
export const GRAPH_HUB_PAIR_PARTNERS: Readonly<Record<GraphDensity, number>> = {
  skeleton: 0,
  standard: 2,
  all: 4,
}

/** 档位 → 每枢纽伙伴数（未知档位按默认「标准」处理）。 */
export function hubPairPartnersFor(density: GraphDensity): number {
  return GRAPH_HUB_PAIR_PARTNERS[density] ?? GRAPH_HUB_PAIR_PARTNERS.standard
}

/**
 * 枢纽间线宽上限（px）。
 *
 * 视觉层级必须严格是「文件边 > 枢纽间线 > 枢纽↔文件线」：
 * 用户看这张图首先读的是「当前目录里哪些文件有关系」，文件夹之间的来往是**背景结构**。
 * 第一版（2026-11-08 实测否掉）用 0.45 系数 + 3.2 上限，权重 79 的对算出 3.1px，
 * 6 条粗线在视觉上盖过了细化后的文件边，整张图像"文件夹互相拉扯"。
 * 现在压到 base 0.6 / factor 0.22 / max 1.8 —— 最强的一对也只有 1.8px，
 * 弱对（权重 3~10）落在 0.9~1.3px，比文件边细。
 */
export const GRAPH_HUB_PAIR_WIDTH_MAX = 1.8
export const GRAPH_HUB_PAIR_WIDTH_BASE = 0.6
export const GRAPH_HUB_PAIR_WIDTH_FACTOR = 0.22
/** 枢纽间线默认透明度（比文件边弱一档；悬停相关枢纽时提亮）。 */
export const GRAPH_HUB_PAIR_OPACITY = 0.28

/** 聚合权重 → 枢纽间线宽（px，保留 2 位小数；纯函数、确定性）。 */
export function hubPairStrokeWidth(weight: number): number {
  const safe = Number.isFinite(weight) && weight > 0 ? weight : 0
  const raw = GRAPH_HUB_PAIR_WIDTH_BASE + Math.log2(1 + safe) * GRAPH_HUB_PAIR_WIDTH_FACTOR
  return Math.round(Math.min(GRAPH_HUB_PAIR_WIDTH_MAX, raw) * 100) / 100
}

/**
 * 默认画标签的节点数。folder 图 ≤40 时全部尽量标（放不下才隐藏，不截断）；
 * turn 图只给 top N 画标签，其余 hover/选中时补。选中/悬停永远额外画。
 */
export const GRAPH_LABEL_LIMITS = { folder: 40, turn: 30 } as const

/** 关系层 → locale key（总览/浮层展示用；文案唯一来源仍是 locale）。 */
export const RELATION_MESSAGE_KEY: Readonly<
  Record<RelationType, 'relations.structure' | 'relations.coTurn' | 'relations.coSession' | 'relations.sequence' | 'relations.reference'>
> = {
  structure: 'relations.structure',
  coTurn: 'relations.coTurn',
  coSession: 'relations.coSession',
  sequence: 'relations.sequence',
  reference: 'relations.reference',
}

/** 关系层的绘制顺序（结构最底，时序/引用最上；与 relations.ts 的 LAYER_ORDER 一致）。 */
export const GRAPH_LAYER_ORDER: readonly RelationType[] = ['structure', 'coSession', 'coTurn', 'reference', 'sequence']

/**
 * 图的 DOM 数据属性（测试/截图断言只认这些，不猜类名）。
 *
 * R10 新增（QA 明确「不会猜属性名」，这里逐条登记）：
 * - `density`：当前关系密度档位 `data-density="skeleton|standard|all"`（挂在图根）；
 * - `densityAction`：密度组里的三个按钮 `data-density-action="skeleton|standard|all"`，
 *   当前档带 `aria-pressed="true"`；
 * - `showAll`：节点上限 chip `data-graph-show-all="true"`，展开态 `data-expanded="true"`
 *   + `aria-pressed="true"`（**同一个 chip 的两种状态**，不是两个按钮）；
 * - `hubEdge`：枢纽聚合边 `data-hub-edge="<hubPath>\u0000<filePath>"`，
 *   另带 `data-hub-edge-hub` / `data-hub-edge-file` / `data-hub-edge-weight`；
 * - `hubLinked`：枢纽卡上的 `data-hub-linked="true|false"`（false = 无跨目录关系、外围环、不画线）；
 * - `hubPair`（R11 新增：**枢纽 ↔ 枢纽**连线，`data-hub-pair="<aPath>\u0000<bPath>"`，
 *   a/b 按小写路径 min/max 归一，**无向只出一条**）：
 *   `data-hub-pair-a` / `data-hub-pair-b`（当前目录直接子文件夹的**原大小写**路径）、
 *   `data-hub-pair-weight`（聚合权重和）、`data-hub-pair-count`（真实边数）、
 *   `data-hub-pair-layer="hub"`（**与文件边 `data-edge-layer` 区分**：枢纽间层不参与 L1/L2/L3）；
 * - `hubPairCount`：图根上的 `data-hub-pair-count="<n>"`（本档实际画出的枢纽间连线数，三档断言用）；
 * - `edgeLayer`：每条边的档位 `data-edge-layer="L1|L2|L3"` 与 `data-edge-drawn="true|false"`；
 * - `relationsSummary`：图头关系计数 `data-graph-relations="<n>"`；
 * - `fillRatio`：内容铺满比例 `data-graph-fill="<0.000–1.000>"`（"铺满视口"证据）。
 */
export const GRAPH_DATA = {
  root: 'data-tl-graph',
  node: 'data-file-path',
  edge: 'data-edge-id',
  label: 'data-label-for',
  status: 'data-turn-status',
  mode: 'data-graph-mode',
  /** 当前目录（folder 模式；'' = 工作区根）。 */
  current: 'data-graph-current',
  truncated: 'data-graph-truncated',
  /** 文件夹枢纽（当前目录的直接子文件夹）。 */
  hub: 'data-folder-hub',
  /** 枢纽是否有真实跨目录关系（false = 外围环、不连线）。 */
  hubLinked: 'data-hub-linked',
  /** 枢纽 ↔ 文件的聚合连线（真实跨目录关系）。 */
  hubEdge: 'data-hub-edge',
  /** 枢纽 ↔ 枢纽的聚合连线（真实跨目录关系；**无向只出一条**）。 */
  hubPair: 'data-hub-pair',
  /** 本档画出的枢纽间连线数（图根；三档断言用）。 */
  hubPairCount: 'data-hub-pair-count',
  /** pair 聚合 / 关系类型 / 证据浮层。 */
  edgePair: 'data-edge-pair',
  edgeTypes: 'data-edge-types',
  /** 边的分档 L1/L2/L3 与"当前是否默认画"。 */
  edgeLayer: 'data-edge-layer',
  evidence: 'data-graph-evidence',
  reset: 'data-graph-reset',
  loading: 'data-graph-loading',
  /** 关系密度档位（图根）+ 密度按钮。 */
  density: 'data-density',
  densityAction: 'data-density-action',
  /** 「显示 40/137」chip（同一 chip 的展开态 = 全部档）。 */
  showAll: 'data-graph-show-all',
  /** 图头关系计数。 */
  relationsSummary: 'data-graph-relations',
  /** 内容包围盒占画布比例（力导向铺满证据）。 */
  fillRatio: 'data-graph-fill',
} as const

/** 图容器类名（宿主/门禁按类名定位）。 */
export const GRAPH_CLASS = 'tl-graph' as const
