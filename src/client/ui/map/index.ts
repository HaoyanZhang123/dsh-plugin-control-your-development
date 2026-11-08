/*
 * ui/map/index.ts —— 文件图的唯一出口（tab 只从这里 import）。
 *
 * 2.1（R04）单一执行路径：只剩 **folder（当前目录关系图）** 与 **turn（轮次图）** 两种模式。
 * R10（2026-11-08 用户二次反馈）把左图从**等宽网格**重做为**力导向关系图**：
 * 新增 forceLayout / edgeLayers / hubLinks 三个纯函数模块；
 * 删除了网格常量（FOLDER_CELL_HEIGHT / FOLDER_CELL_MIN_WIDTH / FOLDER_CELL_MAX_WIDTH /
 * FOLDER_HUB_GAP / FOLDER_MARGIN）与 `layoutFolder` 的网格实现 —— 不留兼容分支。
 *
 * 已删除（不保留兼容分支）：全工作区星图总览（OverviewMap/overview.ts）、
 * 逐层下钻（levels.ts）、`mode:'overview'|'directory'`、图尾 `.tl-graph-foot` 与覆盖说明。
 */
export { FileGraph, type FileGraphProps, type FileGraphTurn, type GraphMode } from './FileGraph.ts'
export { FolderMap, type FolderMapProps } from './FolderMap.ts'
export {
  allModeRadiusScale,
  collectFolderHubs,
  collectFolderNodes,
  compareNames,
  familyOfName,
  folderNameOf,
  folderNodeRadius,
  layoutFolder,
  layoutFolderGeometry,
  layoutFolderLabels,
  pinnedPositions,
  FOLDER_ALL_RADIUS_FLOOR,
  FOLDER_HUB_HEIGHT,
  FOLDER_HUB_MAX_WIDTH,
  FOLDER_HUB_MIN_GAP,
  FOLDER_HUB_MIN_WIDTH,
  FOLDER_HUB_PAD,
  FOLDER_LABEL_FONT_PX,
  FOLDER_LABEL_GAP,
  FOLDER_LABEL_HEIGHT,
  type FolderGeometry,
  type FolderLayout,
  type FolderLayoutHub,
  type FolderLayoutHubEdge,
  type FolderLayoutHubPair,
  type FolderLayoutLabel,
  type FolderLayoutNode,
  type FolderLayoutOptions,
  type MapEntry,
  type MapKind,
  type NodeDragOffset,
} from './folderLayout.ts'
export {
  computeBounds,
  enforceMinDistances,
  FORCE_DEFAULTS,
  hash32,
  simulateForce,
  unitOf,
  type Bounds,
  type ForceLink,
  type ForceNode,
  type ForceOptions,
  type ForceResult,
  type MinDistanceConstraint,
} from './forceLayout.ts'
export {
  buildCrossBoundaryIndex,
  compareHubPairs,
  computeHubLinks,
  computeHubPairs,
  hubPairKey,
  perimeterAngle,
  truncateHubPairs,
  type CrossBoundaryIndex,
  type HubLink,
  type HubLinkOptions,
  type HubLinkResult,
  type HubPair,
  type HubPairOptions,
} from './hubLinks.ts'
export {
  compareLayeredPairs,
  edgeCapFor,
  layerOfTypes,
  selectEdgeLayers,
  totalWeightOf,
  type EdgeLayer,
  type EdgeLayerOptions,
  type EdgeLayerResult,
  type LayeredPair,
} from './edgeLayers.ts'
export {
  CAMERA_PAN_MARGIN,
  cameraPanLimit,
  cameraTransform,
  clampCameraPan,
  clampCameraScale,
  DEFAULT_CAMERA,
  GRAPH_ZOOM_MAX,
  GRAPH_ZOOM_MIN,
  GRAPH_ZOOM_STEP,
  graphPointToScreen,
  panCameraBy,
  resetCamera,
  screenCenterOf,
  screenEndpoints,
  screenPointToGraph,
  zoomCameraAtCenter,
  type CameraViewport,
  type GraphCamera,
} from './camera.ts'
export { ZoomGroup, type ZoomGroupProps } from './zoomGroup.ts'
export {
  aggregateEdgePairs,
  DRAG_THRESHOLD_PX,
  dragThresholdExceeded,
  filterEdgesByTypes,
  pairKeyOf,
  relationTypeCounts,
  type EdgePair,
} from './pairs.ts'
export {
  compareGraphFiles,
  graphFingerprint,
  graphRadius,
  layoutFileGraph,
  selectGraphFiles,
  type GraphLayout,
  type GraphLayoutNode,
  type GraphLayoutOptions,
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
  GRAPH_COOCCURRENCE_TOP,
  GRAPH_DATA,
  GRAPH_EDGE_FACTOR,
  GRAPH_EDGE_LIMITS,
  GRAPH_HUB_MAX_LINKS,
  GRAPH_HUB_PAIR_OPACITY,
  GRAPH_HUB_PAIR_PARTNERS,
  GRAPH_HUB_PAIR_WIDTH_BASE,
  GRAPH_HUB_PAIR_WIDTH_FACTOR,
  GRAPH_HUB_PAIR_WIDTH_MAX,
  GRAPH_LABEL_LIMITS,
  GRAPH_LAYER_ORDER,
  GRAPH_LIMITS,
  hubPairPartnersFor,
  hubPairStrokeWidth,
  RELATION_MESSAGE_KEY,
  STATUS_COLOR,
  type GraphDensity,
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
