/*
 * shell/TurnStripSlot.ts —— 轮次带槽（92px，可折叠到 40px；03 §3.1 / §6 / §14）。
 *
 * 轮次块本身是 T08 的内容；这里只给：标题行（含折叠开关与会话选择器位）+ 列表容器。
 * <900px 列表自动纵向（base.css），<600px 成为单列流的一部分。
 */
import * as React from 'react'
import { Button } from '../common/index.ts'
import { SHELL_REGIONS } from './types.ts'

export interface TurnStripSlotProps {
  /** 轮次带标题（locale，例如「轮次」）。 */
  title: string
  collapsed: boolean
  onToggle?: () => void
  /** 折叠开关的可读标签（展开/收起各一句，由调用方给）；不传 onToggle 时不需要。 */
  toggleLabel?: string
  /** 会话选择器（T08 注入；放标题行右侧）。 */
  headerSlot?: React.ReactNode
  children?: React.ReactNode
  testId?: string
}

export function TurnStripSlot(props: TurnStripSlotProps): React.ReactElement {
  return React.createElement(
    'section',
    {
      className: 'threadline-turns',
      'data-region': SHELL_REGIONS.turns,
      'data-collapsed': props.collapsed ? 'true' : 'false',
      'aria-label': props.title,
      'data-testid': props.testId,
    },
    React.createElement(
      'div',
      { className: 'threadline-turns-head' },
      React.createElement('span', { className: 'threadline-turns-title' }, props.title),
      props.headerSlot ?? null,
      props.onToggle && props.toggleLabel
        ? React.createElement(
            'span',
            { className: 'threadline-inline-group threadline-push-end' },
            React.createElement(Button, {
              iconOnly: true,
              ariaLabel: props.toggleLabel,
              title: props.toggleLabel,
              expanded: !props.collapsed,
              onClick: props.onToggle,
              testId: 'turns-toggle',
              children: React.createElement('span', { 'aria-hidden': true }, props.collapsed ? '▸' : '▾'),
            }),
          )
        : null,
    ),
    React.createElement('div', { className: 'threadline-turns-list' }, props.children ?? null),
  )
}
