/*
 * ui/shell/index.ts —— 外壳的唯一出口。
 */
export { ErrorBoundary, ERROR_STACK_LINES, stackHead, type ErrorBoundaryProps } from './ErrorBoundary.ts'
export { Header, type HeaderProps } from './Header.ts'
export { InspectorPanel, type InspectorPanelProps } from './InspectorPanel.ts'
export { NowStrip, type NowStripProps } from './NowStrip.ts'
export { Portal, type PortalProps } from './Portal.ts'
export { ThreadlineShell, type NowStripModel, type ThreadlineShellProps } from './Shell.ts'
export { TimelineSlot, type TimelineSlotProps } from './TimelineSlot.ts'
export { TurnStripSlot, type TurnStripSlotProps } from './TurnStripSlot.ts'
export {
  BREAKPOINTS,
  DEFAULT_RANGE,
  RANGE_KEYS,
  SHELL_METRICS,
  SHELL_REGIONS,
  type RangeKey,
  type ShellRegion,
} from './types.ts'
