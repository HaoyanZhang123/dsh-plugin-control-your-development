/*
 * ui/map/index.ts —— 星图的唯一出口（T09 只从这里 import）。
 *
 * 纯展示组件 + 可单测的纯函数（布局/边/标签/视口），不注册 slot、不发请求、不读数据层单例。
 */
export { MapView, type MapViewProps } from './MapView.ts'
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
export {
  clusterKeyOf,
  clusterLabelOf,
  compareByActivity,
  hashString,
  layoutEqual,
  layoutFingerprint,
  layoutMap,
  MAP_GEOMETRY,
  MAP_LIMITS,
  NODE_RADIUS,
  packClusters,
  radiusFor,
  ringCapacity,
  ringPosition,
  ringSlot,
  ROOT_CLUSTER_KEY,
  round2,
  selectActiveNodes,
  toLayoutNodeBase,
  type LayoutCluster,
  type LayoutNode,
  type LayoutOptions,
  type LayoutTruncation,
  type MapLayout,
  type NodeSelection,
} from './layout.ts'
export {
  boxesOverlap,
  compareLabels,
  estimateTextWidth,
  LABEL_ZOOM_THRESHOLD,
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
  LAYER_LABEL_KEY,
  LAYER_STYLE,
  MAP_CLASS,
  MAP_DATA,
  MAP_ZOOM,
} from './theme.ts'
export {
  clampZoom,
  fitScale,
  fitViewport,
  fitWorld,
  focusOnBox,
  IDENTITY_VIEWPORT,
  normalizeViewport,
  panByScreen,
  screenToWorld,
  transformOf,
  viewBoxOf,
  worldToScreen,
  zoomAtPoint,
  zoomForActualPixels,
  type MapSize,
  type MapViewport,
  type WorldSize,
} from './viewport.ts'
