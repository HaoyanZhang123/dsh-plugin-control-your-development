/*
 * ui/map/index.ts —— 文件关系图的唯一出口（tab 只从这里 import）。
 *
 * 2.0 起不再有星图/总览/缩放：这里只有文件级关系图（FileGraph）、确定性径向布局、
 * 标签避让、5 类文件族视觉与关系层工具函数。纯展示 + 可单测的纯函数，不注册 slot、不发请求。
 */
export { FileGraph, type FileGraphProps, type FileGraphTurn } from './FileGraph.ts'
export { OverviewMap, type OverviewMapProps } from './OverviewMap.ts'
export {
  aggregateDirectoryEdges,
  aggregateEdgePairs,
  applyDragOffset,
  clusterBoxSize,
  DRAG_THRESHOLD_PX,
  dragThresholdExceeded,
  filterEdgesByTypes,
  hashSeed,
  layoutOverview,
  OVERVIEW_DIR_EDGE_LIMIT,
  OVERVIEW_EXPANDED_FILES,
  OVERVIEW_TOP_FILES,
  overviewFileRadius,
  pairKeyOf,
  pointInBox,
  relationTypeCounts,
  resetDragOffsets,
  seededRandom,
  topDirectoryKey,
  type EdgePair,
  type NodeDragOffset,
  type OverviewCluster,
  type OverviewClusterFile,
  type OverviewDirEdge,
  type OverviewFile,
  type OverviewLayout,
  type OverviewLayoutOptions,
} from './overview.ts'
export {
  compareGraphFiles,
  graphFingerprint,
  graphRadius,
  layoutFileGraph,
  selectGraphFiles,
  type GraphLayout,
  type GraphLayoutNode,
  type GraphLayoutOptions,
  type GraphMode,
  type GraphSourceFile,
} from './graphLayout.ts'
export {
  boxesOverlap,
  compareLabels,
  estimateTextWidth,
  GRAPH_LABEL_FONT_PX,
  GRAPH_STATUS_FONT_PX,
  placeLabels,
  visibleLabelKeys,
  type LabelCandidate,
  type LabelPlacement,
  type OccupiedBox,
} from './labels.ts'
export {
  FAMILY_COLOR,
  FAMILY_MESSAGE_KEY,
  FILE_FAMILIES,
  GRAPH_CLASS,
  GRAPH_DATA,
  GRAPH_EDGE_LIMITS,
  GRAPH_LABEL_LIMITS,
  GRAPH_LAYER_ORDER,
  GRAPH_LIMITS,
  RELATION_MESSAGE_KEY,
  STATUS_COLOR,
} from './theme.ts'
export type { RelationLayerToggles, SelectedTurnRef, EdgeView, EdgeDraw, EdgeViewOptions, FocusTarget } from './relations.ts'
export {
  edgeTouches,
  edgeWidth,
  FOCUS_DIM_OPACITY,
  isEdgeOfTurn,
  neighborKeysOf,
  nodeOpacity,
  prepareEdges,
  RELATION_LEGEND_ORDER,
  selectVisibleEdges,
  sequenceOrderOf,
} from './relations.ts'
