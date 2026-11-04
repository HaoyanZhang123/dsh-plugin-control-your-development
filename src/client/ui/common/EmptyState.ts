/*
 * EmptyState.ts —— 空态（03 §4.5 / §11；06 N-01/N-15）。
 *
 * 规则：空态必须解释原因，不显示假图、不显示 0 冒充数据。
 * 「无文件操作」与「无记录」是两句不同的话，由调用方选 key，组件不猜。
 */
import * as React from 'react'

export interface EmptyStateProps {
  /** 主文案（用 locale key 取，别手写）。 */
  title: string
  /** 解释（例如「脉络只读 DSH 已记录的内容」）。 */
  detail?: string
  /** 可选动作（只读导航类，例如「列表视图」）。 */
  actions?: React.ReactNode
  /** 小图标字符（纯装饰，aria-hidden）。 */
  mark?: string
  className?: string
  testId?: string
}

export function EmptyState(props: EmptyStateProps): React.ReactElement {
  return React.createElement(
    'div',
    {
      className: ['threadline-empty', props.className].filter(Boolean).join(' '),
      'data-threadline-empty': '',
      'data-testid': props.testId,
    },
    props.mark
      ? React.createElement('span', { className: 'threadline-empty-mark', 'aria-hidden': true }, props.mark)
      : null,
    React.createElement('p', { className: 'threadline-empty-title' }, props.title),
    props.detail ? React.createElement('p', { className: 'threadline-empty-detail' }, props.detail) : null,
    props.actions ? React.createElement('div', { className: 'threadline-empty-actions' }, props.actions) : null,
  )
}
