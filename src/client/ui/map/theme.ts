/*
 * map/theme.ts —— 星图的视觉映射（03 §4.1 / §13）。
 *
 * 纪律：
 * - 颜色**只**引用 tokens.css 的 --tl-*（13.1：组件里不写颜色字面量）；
 * - 6 个文件族用 6 个低饱和令牌色，且颜色不单独承载信息：图例/工具提示同时给文字；
 * - 星图容器的极轻背景网格由 CSS 画，不引入渐变/发光（13.3）。
 */
import type { FileFamily } from '../../../shared/events/index.ts'
import type { RelationType } from '../../../shared/relations/index.ts'
import type { MessageKey } from '../../locale/index.ts'

/** 文件族的稳定顺序（图例按它排；与 T06 `Legend` 的 kind 对齐）。 */
export const FILE_FAMILIES: readonly FileFamily[] = ['doc', 'code', 'data', 'image', 'config', 'other']

/**
 * 文件族 → 令牌色。
 * 与 T06 `base.css` 的 `.threadline-swatch[data-kind=...]` 一一对应（同一套语义），
 * 这样图例（T06）和星图（T07）不会出现"同一个族两种颜色"。
 */
export const FAMILY_COLOR: Readonly<Record<FileFamily, string>> = {
  doc: 'var(--tl-fg-tertiary)',
  code: 'var(--tl-accent)',
  data: 'var(--tl-warn)',
  image: 'var(--tl-success)',
  config: 'var(--tl-fg-caption)',
  other: 'var(--tl-idle)',
}

/** 文件族 → locale key（03 §16；Lead 2026-11-04 补齐的 6 条 fileFamily.*）。 */
export const FAMILY_MESSAGE_KEY: Readonly<Record<FileFamily, MessageKey>> = {
  doc: 'fileFamily.doc',
  code: 'fileFamily.code',
  data: 'fileFamily.data',
  image: 'fileFamily.image',
  config: 'fileFamily.config',
  other: 'fileFamily.other',
}

/** 关系层的线条语义（CSS 类名后缀 + 线型）。 */
export interface LayerStyle {
  /** 线色（令牌）。 */
  stroke: string
  /** 虚线？ */
  dashed: boolean
  /** 不透明度（结构层更淡，避免抢节点）。 */
  opacity: number
}

export const LAYER_STYLE: Readonly<Record<RelationType, LayerStyle>> = {
  structure: { stroke: 'var(--tl-fg-caption)', dashed: false, opacity: 0.45 },
  coTurn: { stroke: 'var(--tl-fg-secondary)', dashed: true, opacity: 0.7 },
  coSession: { stroke: 'var(--tl-fg-tertiary)', dashed: true, opacity: 0.5 },
  sequence: { stroke: 'var(--tl-warn)', dashed: false, opacity: 0.85 },
  reference: { stroke: 'var(--tl-link)', dashed: false, opacity: 0.85 },
}

/** 关系层 → locale key（03 §16）。 */
export const LAYER_LABEL_KEY: Readonly<Record<RelationType, string>> = {
  structure: 'relations.structure',
  coTurn: 'relations.coTurn',
  coSession: 'relations.coSession',
  sequence: 'relations.sequence',
  reference: 'relations.reference',
}

/** 星图的 DOM 数据属性名（测试/截图断言只认这些，不猜类名）。 */
export const MAP_DATA = {
  root: 'data-tl-map',
  node: 'data-node-path',
  cluster: 'data-cluster-key',
  edge: 'data-edge-id',
  label: 'data-label-for',
  legend: 'data-tl-legend',
  zoom: 'data-zoom',
} as const

/** 星图缩放范围（03 §4.3：0.4×–3×）。 */
export const MAP_ZOOM = { min: 0.4, max: 3, step: 1.25 } as const

/** 星图 SVG 容器类名（方便宿主/门禁按类名定位，不暴露内部结构）。 */
export const MAP_CLASS = 'tl-map' as const
