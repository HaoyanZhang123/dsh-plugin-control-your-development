/*
 * ErrorState.ts —— 读取失败态（03 §4.5 / §11.3；06 N-02/N-03/N-11）。
 *
 * 规则：
 * - 说清楚"观测不到什么 + 为什么"，不白屏、不把失败当 0；
 * - 唯一动作是「重新读取」（只读重读，locale coverage.retry），不提供任何运行控制；
 * - role="alert" 让读屏立刻播报（这是错误，不是普通状态）。
 */
import * as React from 'react'
import { Button } from './Button.ts'

export interface ErrorStateProps {
  /** 主文案（locale，例如 state.hostUnavailable）。 */
  title: string
  /** 原因（来自记录的失败原因；没有就写"原因未知"，不猜）。 */
  detail?: string
  /** 「重新读取」按钮文案（locale coverage.retry）。 */
  retryLabel: string
  /** 只读重读回调；传了才渲染按钮。 */
  onRetry?: () => void
  className?: string
  testId?: string
}

export function ErrorState(props: ErrorStateProps): React.ReactElement {
  const actions = props.onRetry
    ? React.createElement(
        'div',
        { className: 'threadline-error-actions' },
        React.createElement(Button, { label: props.retryLabel, variant: 'outline', onClick: props.onRetry }),
      )
    : null
  return React.createElement(
    'div',
    {
      className: ['threadline-error', props.className].filter(Boolean).join(' '),
      role: 'alert',
      'data-testid': props.testId,
    },
    React.createElement(
      'p',
      { className: 'threadline-error-title' },
      React.createElement('span', { className: 'threadline-error-mark', 'aria-hidden': true }, '!'),
      props.title,
    ),
    props.detail ? React.createElement('p', { className: 'threadline-error-detail' }, props.detail) : null,
    actions,
  )
}
