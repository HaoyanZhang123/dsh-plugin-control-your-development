/*
 * ui/turns/index.ts —— 轮次带的唯一出口（T09 从这里 import）。
 *
 * 本目录除了轮次带，还承载**跨组件共享的纯逻辑**（因为本次写盘范围只有 `ui/turns/**` 与
 * `ui/inspector/**`，两处必须共用同一套选择语义/隐私掩码/文案映射，才能不出现第二套状态机）：
 * - `selection`：选择模型（hover 预览 / click 固定 / Esc 逐层 / 键盘移动）——**唯一实现**；
 * - `privacy`：隐私掩码与时间/路径格式化——**唯一实现**；
 * - `model`：状态判定、块宽、标记、分组——**唯一实现**。
 */
export {
  NO_SELECTION,
  canEscape,
  createSelectionState,
  effectiveSelection,
  escapeSelection,
  hoverSelection,
  moveIndex,
  moveSelection,
  sameSelection,
  select,
  selectionKey,
  selectionReducer,
  type MoveResult,
  type Selection,
  type SelectionAction,
  type SelectionFile,
  type SelectionNone,
  type SelectionSession,
  type SelectionState,
  type SelectionTurn,
} from './selection.ts'

export {
  TURN_METRICS,
  blockWidth,
  buildScopeOptions,
  buildTurnBlock,
  buildTurnGroups,
  currentTurnNumber,
  defaultSelection,
  formatClock,
  formatDuration,
  isTurnPartial,
  markerSlots,
  parseScopeKey,
  rootSessions,
  scopeKey,
  scopeSessionId,
  turnCandidates,
  turnCounts,
  turnDurationMs,
  turnMarkers,
  turnStatusLabel,
  turnStatusOf,
  turnTooltip,
  type BuildTurnBlockOptions,
  type MarkerKind,
  type MarkerMode,
  type ScopeOption,
  type TurnBlockModel,
  type TurnCounts,
  type TurnGroup,
  type TurnMarker,
  type TurnScope,
  type TurnStatusOptions,
  type TurnStatusView,
  type TurnStripSession,
} from './model.ts'

export { TURN_COPY, turnLabel, type LabelKey } from './copy.ts'

export {
  turnFileStatusOf,
  type FileTurnStatus,
  type TurnStatusSnapshot,
  type TurnStatusSummary,
} from './status.ts'

export {
  baseName,
  commandProgram,
  commandSummary,
  dateTimeOfDay,
  dirName,
  externalLabel,
  maskPath,
  maskPathsInText,
  sessionStatusKey,
  sessionTitle,
  shortSessionId,
  timeOfDay,
  urlHost,
} from './privacy.ts'

export { TurnBlock, type TurnBlockProps, type TurnRelationHint } from './TurnBlock.ts'
export { TurnStrip, type TurnStripProps } from './TurnStrip.ts'
export { SessionSelector, type SessionSelectorProps } from './SessionSelector.ts'
