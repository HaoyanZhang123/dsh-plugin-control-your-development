/*
 * a11y/index.ts —— T10 无障碍层的唯一出口。
 *
 * 下游（T09 入口 / 检查器 / 轮次带）只 import 这里：
 *   import { ListView, FileListView, TurnListView, useReducedMotion, auditContrast, Announcer } from '<plugin>/src/client/a11y/index.ts'
 *
 * 单一实现：
 * - 焦点陷阱复用 `ui/common/focusTrap.ts`（这里只再导出，不复制）；
 * - 掩码/时间格式化复用 `ui/turns/index.ts`；
 * - 本目录新增的是：列表视图（纯逻辑 + 组件）、aria 文案与节流播报、reduced-motion、对比度数学。
 */
export {
  ANNOUNCE_MIN_INTERVAL_MS,
  Announcer,
  announcementFor,
  columnLabel,
  decideAnnouncement,
  describedByProps,
  joinIds,
  rowAriaLabel,
  shouldAnnounce,
  sortAria,
  tableLabel,
  type AnnounceDecision,
  type AnnouncerProps,
} from './aria.ts'

export {
  DSH_TOKEN_PAIRS,
  GRAPHICS_MIN,
  TEXT_AA_MIN,
  auditContrast,
  contrastRatio,
  meetsContrast,
  parseHexColor,
  relativeLuminance,
  summarizeContrast,
  type ContrastPair,
  type ContrastResult,
  type ContrastSummary,
  type Rgb,
} from './contrast.ts'

export {
  REDUCED_MOTION_QUERY,
  motionDuration,
  readReducedMotion,
  subscribeReducedMotion,
  useReducedMotion,
  type MediaEnv,
  type MediaQueryLike,
} from './reducedMotion.ts'

export { FOCUSABLE_SELECTOR, nextTrapIndex, queryFocusable, trapTabKey } from './focusTrap.ts'
export type { FocusableRoot, TabKeyEvent } from './focusTrap.ts'

export {
  DEFAULT_FILE_SORT,
  DEFAULT_TURN_SORT,
  buildFileRows,
  buildTurnRows,
  fileKeyOf,
  filterFileRows,
  listKeyNav,
  nextSort,
  rowDomId,
  sortFileRows,
  sortRows,
  sortTurnRows,
  type FileListRow,
  type ListKind,
  type NavInput,
  type NavKey,
  type NavResult,
  type SortDir,
  type SortKey,
  type SortState,
  type TurnInput,
  type TurnListRow,
} from './listModel.ts'

export {
  FileListView,
  ListView,
  TurnListView,
  formatDuration,
  type FileListViewProps,
  type ListViewCommonProps,
  type ListViewProps,
  type TurnListViewProps,
} from './ListTable.ts'
