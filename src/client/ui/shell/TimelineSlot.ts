/*
 * shell/TimelineSlot.ts —— 时间轴槽（48px，03 §3.1 / §5）。
 *
 * 只提供位置与高度；刻度、播放头、会话标记都是 T07 的内容。
 * 窄容器下"标签减少"由 base.css 的 [data-tick-priority='low'] 规则统一处理，
 * T07 的标签只要带上该属性就能自动适配。
 */
import * as React from 'react'
import { SHELL_REGIONS } from './types.ts'

export interface TimelineSlotProps {
  children?: React.ReactNode
  testId?: string
}

export function TimelineSlot(props: TimelineSlotProps): React.ReactElement {
  return React.createElement(
    'div',
    {
      className: 'threadline-timeline',
      'data-region': SHELL_REGIONS.timeline,
      'data-testid': props.testId,
    },
    props.children ?? null,
  )
}
