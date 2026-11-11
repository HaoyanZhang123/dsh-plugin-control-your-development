/*
 * shell/TimelineSlot.ts —— 时间轴槽（03 §3.1 / §5），同时承载「关系证据」覆盖层。
 *
 * 形态（D-35）：时间线是一块固定高度的卡片；选中文件/连线时，关系证据**完整覆盖**这块卡片，
 * 而不是浮在图区右下角。好处：
 * - 布局干净：证据不再压住节点、也不制造第二个浮动层；
 * - 空间稳定：卡片刻意保持固定高度，证据出现/消失不改变页面高度（避免 hover 抖动类问题）；
 * - 语义清楚：证据与时间线同属"下方信息带"，关闭后原样回到时间线。
 *
 * 只提供位置与容器；刻度/播放头仍由 T07 的内容负责，证据内容由 tab 传入（受控 model）。
 */
import * as React from 'react'
import { SHELL_REGIONS } from './types.ts'

export interface TimelineSlotProps {
  children?: React.ReactNode
  testId?: string
  /**
   * 关系证据覆盖层（受控）：`null`/省略 = 不渲染。
   * 传节点必须是**绝对定位铺满卡片**的一层（样式见 map.css 的 .tl-evidence-slot）。
   */
  evidenceSlot?: React.ReactNode
}

export function TimelineSlot(props: TimelineSlotProps): React.ReactElement {
  return React.createElement(
    'div',
    {
      className: 'threadline-timeline',
      'data-region': SHELL_REGIONS.timeline,
      'data-testid': props.testId,
      'data-has-evidence': props.evidenceSlot === undefined || props.evidenceSlot === null ? 'false' : 'true',
    },
    props.children ?? null,
    props.evidenceSlot ?? null,
  )
}
