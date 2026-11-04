/*
 * shell/ErrorBoundary.ts —— 三个入口的渲染兜底（T13b；03 §2.1「错误态不白屏」）。
 *
 * 为什么需要：真机首轮 tab 点了整片空白 —— React 渲染期抛错时，宿主没有任何兜底，
 * 用户只看到空白，无法自查。这里用 class 组件捕获子树错误：
 * - `componentDidCatch` 里 `console.error('threadline: render failed', error)`（只打错误对象，不打正文/路径）；
 * - **必须渲染可见内容**：一行 `<label>：<error.message>` + 一个默认折叠的 `<pre>`（stack 前 8 行，诊断用）；
 * - 文案只用调用方传入的既有 locale key（`state.unknown` 前缀），不新增 key、不写死句子；
 * - `resetKey` 变化时自动清除错误（例如切换 viewRequest/会话后重试渲染）。
 */
import * as React from 'react'

const h = React.createElement

/** 错误详情里保留的 stack 行数（克制：只给定位线索，不刷屏）。 */
export const ERROR_STACK_LINES = 8

export interface ErrorBoundaryProps {
  /** 前缀文案（调用方用既有 locale key 生成，例如 t('state.unknown') + ' · ' + t('tab.label')）。 */
  label: string
  /** 折叠入口文案（调用方用既有 key，例如 t('ui.expand')）。 */
  detailLabel?: string
  /** 变化即复位（会话/viewRequest 变了就重新尝试渲染）。 */
  resetKey?: unknown
  children?: React.ReactNode
  testId?: string
}

interface ErrorBoundaryState {
  error: Error | null
  open: boolean
}

/** 取前 N 行 stack（没有 stack 时退回 message）。 */
export function stackHead(error: Error, lines = ERROR_STACK_LINES): string {
  const text = typeof error.stack === 'string' && error.stack !== '' ? error.stack : error.message
  return text.split(String.fromCharCode(10)).slice(0, lines).join(String.fromCharCode(10))
}

/** 三个入口共用的错误兜底（class 组件：React 只有 class 能做 error boundary）。 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null, open: false }

  static getDerivedStateFromError(error: unknown): Partial<ErrorBoundaryState> | null {
    return { error: error instanceof Error ? error : new Error(String(error)) }
  }

  override componentDidCatch(error: unknown): void {
    try {
      console.error('threadline: render failed', error)
    } catch {
      // console 本身不可用也不能再抛
    }
  }

  override componentDidUpdate(previous: ErrorBoundaryProps): void {
    if (previous.resetKey !== this.props.resetKey && this.state.error !== null) {
      this.setState({ error: null, open: false })
    }
  }

  override render(): React.ReactNode {
    const error = this.state.error
    if (error === null) return this.props.children
    return h(
      'div',
      {
        className: 'threadline-app threadline-error-boundary',
        role: 'alert',
        'data-threadline-error-boundary': '',
        'data-testid': this.props.testId ?? 'error-boundary',
      },
      h(
        'p',
        { className: 'threadline-error-boundary-title' },
        this.props.label + '：' + (error.message === '' ? 'error' : error.message),
      ),
      h(
        'button',
        {
          type: 'button',
          className: 'threadline-error-boundary-toggle',
          'aria-expanded': this.state.open ? 'true' : 'false',
          onClick: () => this.setState((previous) => ({ ...previous, open: !previous.open })),
        },
        (this.props.detailLabel ?? '') + (this.state.open ? ' ▾' : ' ▸'),
      ),
      this.state.open
        ? h('pre', { className: 'threadline-error-boundary-stack', 'data-testid': 'error-boundary-stack', tabIndex: 0 }, stackHead(error))
        : null,
    )
  }
}
