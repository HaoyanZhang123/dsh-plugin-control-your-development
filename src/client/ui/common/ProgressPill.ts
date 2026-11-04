/*
 * ProgressPill.ts —— 覆盖率胶囊（03 §11.3；06 A40-2 的 partial/loading 可复现状态）。
 *
 * 语义：
 * - loading  「正在补全历史 42/267」+ 细进度条；
 * - partial  「已加载 42/267 · 未加载区段不显示」；
 * - complete 「267/267 · 全部记录」；
 * - failed   「3 个会话读取失败」+ 只读「重新读取」。
 * 文案由调用方用 locale 生成后传入（本组件不做 i18n，保持单一实现）。
 */
import * as React from 'react'
import { Button } from './Button.ts'

export type CoverageState = 'loading' | 'partial' | 'complete' | 'failed'

export interface ProgressPillProps {
  state: CoverageState
  /** 已加载会话数。 */
  done: number
  /** 总会话数；未知时传 null（显示不确定进度，不伪造分母）。 */
  total: number | null
  /** 失败会话数（failed 态展示）。 */
  failed?: number
  /** 已格式化的主文案（来自 locale coverage.*）。 */
  text: string
  /** 「重新读取」文案（locale coverage.retry），failed 态必填。 */
  retryLabel?: string
  onRetry?: () => void
  /** hover 展开的细节（当前读取的会话标题与失败数）。 */
  title?: string
  className?: string
  testId?: string
}

export function pillPercent(done: number, total: number | null): number | null {
  if (total === null || total <= 0) return null
  const ratio = (done / total) * 100
  if (!Number.isFinite(ratio)) return null
  return Math.max(0, Math.min(100, Math.round(ratio)))
}

export function ProgressPill(props: ProgressPillProps): React.ReactElement {
  const percent = pillPercent(props.done, props.total)
  const common = {
    className: ['threadline-pill', props.className].filter(Boolean).join(' '),
    'data-state': props.state,
    'data-testid': props.testId,
    title: props.title,
  }

  if (props.state === 'failed') {
    return React.createElement(
      'div',
      { ...common, role: 'status', 'aria-live': 'polite' },
      React.createElement('span', { className: 'threadline-pill-text' }, props.text),
      props.onRetry && props.retryLabel
        ? React.createElement(Button, {
            label: props.retryLabel,
            variant: 'outline',
            size: 'sm',
            onClick: props.onRetry,
          })
        : null,
    )
  }

  const bar =
    percent === null
      ? null
      : React.createElement(
          'span',
          { className: 'threadline-pill-bar', 'aria-hidden': true },
          React.createElement('span', { className: 'threadline-pill-fill', style: { inlineSize: percent + '%' } }),
        )

  return React.createElement(
    'div',
    {
      ...common,
      role: 'progressbar',
      'aria-valuemin': 0,
      'aria-valuemax': props.total ?? undefined,
      'aria-valuenow': props.total === null ? undefined : props.done,
      'aria-label': props.text,
    },
    React.createElement('span', { className: 'threadline-pill-text', 'aria-hidden': true }, props.text),
    bar,
  )
}
