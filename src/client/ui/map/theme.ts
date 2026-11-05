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

/** 细节/目录图的节点上限（33 §3 + Lead 2026-11-05 复审：目录默认收到 40，避免"毛线球"）。 */
export const GRAPH_LIMITS = { directory: 40, turn: 200 } as const

/**
 * 边上限（33 §3：只取两端在当前集合内的边；仍要防止"一墙线"）。
 * 目录图不画结构边（同目录本身没有信息量），轮次图保留跨目录结构边；按权重取 top N。
 */
export const GRAPH_EDGE_LIMITS = { directory: 120, turn: 160 } as const

/**
 * 默认画标签的节点数（Lead 2026-11-05 复审：目录图只给 top N 画标签，其余 hover 看）。
 * 选中/悬停永远额外画。
 */
export const GRAPH_LABEL_LIMITS = { directory: 14, turn: 30 } as const

/** 关系层的绘制顺序（结构最底，时序/引用最上；与 relations.ts 的 LAYER_ORDER 一致）。 */
export const GRAPH_LAYER_ORDER: readonly RelationType[] = ['structure', 'coSession', 'coTurn', 'reference', 'sequence']

/** 图的 DOM 数据属性（测试/截图断言只认这些，不猜类名）。 */
export const GRAPH_DATA = {
  root: 'data-tl-graph',
  node: 'data-file-path',
  edge: 'data-edge-id',
  label: 'data-label-for',
  status: 'data-turn-status',
  mode: 'data-graph-mode',
  directory: 'data-graph-directory',
  truncated: 'data-graph-truncated',
} as const

/** 图容器类名（宿主/门禁按类名定位）。 */
export const GRAPH_CLASS = 'tl-graph' as const
