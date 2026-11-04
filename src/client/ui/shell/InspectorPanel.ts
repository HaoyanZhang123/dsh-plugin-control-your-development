/*
 * shell/InspectorPanel.ts —— 检查器容器（03 §8 / §14）。
 *
 * 三种形态全由容器查询决定（base.css）：
 *   ≥1100px  内联右侧栏（340px；≥1280px 360px）
 *   600–1099px 右侧覆盖层（min(360px, 44%)）
 *   <600px   底部 sheet（全宽、上圆角、70% 高以内）
 * 本组件只提供结构（标题 + 关闭 + 滚动体），内容由 T08 的检查器槽注入。
 */
import * as React from 'react'
import { Button } from '../common/index.ts'
import { SHELL_REGIONS } from './types.ts'

export interface InspectorPanelProps {
  /** 标题（T08 的检查器标题；无选择时是概览）。 */
  title: string
  /** 关闭按钮的可读标签（locale inspector.close 之类，由调用方给）。 */
  closeLabel: string
  onClose?: () => void
  open?: boolean
  children?: React.ReactNode
  testId?: string
}

export function InspectorPanel(props: InspectorPanelProps): React.ReactElement {
  return React.createElement(
    'aside',
    {
      className: 'threadline-inspector',
      'data-region': SHELL_REGIONS.inspector,
      'data-inspector-open': props.open === false ? 'false' : 'true',
      'aria-label': props.title,
      'data-testid': props.testId,
    },
    React.createElement(
      'div',
      { className: 'threadline-inspector-head' },
      React.createElement('h2', { className: 'threadline-inspector-title' }, props.title),
      props.onClose
        ? React.createElement(
            'span',
            { className: 'threadline-inline-group threadline-push-end' },
            React.createElement(Button, {
              iconOnly: true,
              ariaLabel: props.closeLabel,
              onClick: props.onClose,
              title: props.closeLabel,
              children: React.createElement('span', { 'aria-hidden': true }, '×'),
            }),
          )
        : null,
    ),
    React.createElement('div', { className: 'threadline-inspector-body' }, props.children ?? null),
  )
}
