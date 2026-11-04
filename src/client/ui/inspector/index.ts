/*
 * ui/inspector/index.ts —— 检查器的唯一出口（T09 从这里 import）。
 *
 * 选择模型不在这里重复实现：`Selection` / `selectionReducer` / `esc` 逐层退出都在
 * `ui/turns/index.ts`（同一套，跨组件共用）。
 */
export {
  INSPECTOR_LIMITS,
  FILE_INSPECTOR_FIELDS,
  TURN_INSPECTOR_FIELDS,
  SESSION_INSPECTOR_FIELDS,
  OVERVIEW_FIELDS,
  buildFileInspector,
  buildInspectorModel,
  buildOverview,
  buildSessionInspector,
  buildTurnInspector,
  collectFileTouches,
  deltaText,
  findFile,
  sessionDisplay,
  sessionOrder,
  toTouchRows,
  type ExternalRow,
  type FileInspectorField,
  type FileInspectorModel,
  type FileRelationGroup,
  type FileRelationRow,
  type FileTouchEntry,
  type FileTouchRow,
  type InspectorContext,
  type InspectorData,
  type InspectorModel,
  type LaterTouchRow,
  type OverviewField,
  type OverviewModel,
  type SessionInspectorField,
  type SessionInspectorModel,
  type TurnCommandRow,
  type TurnFileRow,
  type TurnInspectorField,
  type TurnInspectorModel,
  type UnconfirmedRow,
} from './model.ts'

export { INSPECTOR_COPY, commandStatusLabel, familyLabel, label, opLabel, type CopyKey } from './copy.ts'

export { Inspector, type InspectorActions, type InspectorProps } from './Inspector.ts'
export { FileInspector, type FileInspectorProps } from './FileInspector.ts'
export { TurnInspector, type TurnInspectorProps } from './TurnInspector.ts'
export { SessionInspector, type SessionInspectorProps } from './SessionInspector.ts'
export { WorkspaceOverview, type WorkspaceOverviewProps } from './WorkspaceOverview.ts'
export {
  Actions,
  Badge,
  Banner,
  BodyText,
  Disclosure,
  Item,
  ItemMain,
  ItemMeta,
  List,
  Note,
  Row,
  Section,
  StatBars,
  Subhead,
  TitleBlock,
} from './primitives.ts'
