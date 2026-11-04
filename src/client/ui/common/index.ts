/*
 * ui/common/index.ts —— 通用组件的唯一出口。T07/T08/T09 只从这里 import。
 */
export { Button, buttonClassName, type ButtonProps, type ButtonSize, type ButtonVariant } from './Button.ts'
export { Chip, chipClassName, type ChipProps } from './Chip.ts'
export { EmptyState, type EmptyStateProps } from './EmptyState.ts'
export { ErrorState, type ErrorStateProps } from './ErrorState.ts'
export { FocusRing, FOCUS_RING_CLASS, focusRingClassName, type FocusRingProps } from './FocusRing.ts'
export {
  FOCUSABLE_SELECTOR,
  nextTrapIndex,
  queryFocusable,
  trapTabKey,
  type FocusableRoot,
  type TabKeyEvent,
} from './focusTrap.ts'
export { Legend, type FileKind, type LegendItem, type LegendProps } from './Legend.ts'
export { LoadingState, type LoadingStateProps } from './LoadingState.ts'
export { Overlay, type OverlayProps } from './Overlay.ts'
export {
  ProgressPill,
  pillPercent,
  type CoverageState,
  type ProgressPillProps,
} from './ProgressPill.ts'
export { Tooltip, tooltipDescriptionId, type TooltipProps } from './Tooltip.ts'
