/*
 * ui/rail/index.ts —— 右栏（工作区文件浏览器）的唯一出口。
 *
 * 1.2.0 R03 起，右栏是**工作区根目录浏览器**（07 §3）：数据来自 `client/data/tree.ts` 的目录树。
 * tab 只 import 这里：
 *   import { FileTreeRail } from '<plugin>/src/client/ui/rail/index.ts'
 *
 * 单一执行路径（2026-11-07 Lead 裁决 + 本文件落定）：旧的"会话触碰聚合目录卡片"
 * （`DirectoryRail.ts` / `directories.ts` / `relations.ts`）与承载它们的 `.tl-rail*` 样式
 * **已整体删除**；右栏只有这一个实现。
 */
export { FileTreeRail, breadcrumbSegments, RAIL_LIST_ROW_HEIGHT, RAIL_VIRTUAL_THRESHOLD } from './FileTreeRail.ts'
export type { FileTreeRailProps } from './FileTreeRail.ts'

export {
  RAIL_VIRTUAL_OVERSCAN,
  RAIL_VIEWPORT_ESTIMATE,
  buildRailRows,
  computeRailWindow,
  findScrollableAncestor,
  formatTreeSize,
  isScrollableOverflow,
  railKeyAction,
  railRowDomId,
  railScrollMetrics,
  treeKindKey,
  type BuildRailRowsOptions,
  type RailKeyAction,
  type RailRow,
  type RailScrollMetrics,
  type RailTouchInfo,
  type RailViewMode,
  type RailWindow,
  type RailWindowInput,
  type ScrollEnvLike,
  type ScrollStyleLike,
} from './model.ts'

export { FILE_FAMILIES, FAMILY_COLOR } from '../map/theme.ts'
