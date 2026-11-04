/*
 * LoadingState.ts —— 加载态骨架（03 §11.3；06 A40-2 的 loading 状态可复现）。
 *
 * 规则：
 * - 骨架不画假数据，只占位；
 * - 有 role="status" + aria-live="polite" + aria-busy，读屏能听到「正在读取…」；
 * - reduced-motion 下动画由 tokens.css 归零（不在这里判断）。
 */
import * as React from 'react'

export interface LoadingStateProps {
  /** 读屏与可见文字（来自 locale，例如 state.loadingDetail）。 */
  label: string
  /** 骨架条数。 */
  lines?: number
  /** 是否带一块大骨架（星图/检查器用）。 */
  block?: boolean
  className?: string
  testId?: string
}

const WIDTH_CLASSES = ['threadline-skeleton--w80', 'threadline-skeleton--w60', 'threadline-skeleton--w40']

export function LoadingState(props: LoadingStateProps): React.ReactElement {
  const lines = props.lines ?? 3
  const rows: React.ReactNode[] = []
  if (props.block === true) {
    rows.push(
      React.createElement('div', {
        key: 'block',
        className: 'threadline-skeleton threadline-skeleton--block',
        'aria-hidden': true,
      }),
    )
  }
  for (let index = 0; index < lines; index += 1) {
    rows.push(
      React.createElement('div', {
        key: 'line-' + index,
        className: 'threadline-skeleton ' + WIDTH_CLASSES[index % WIDTH_CLASSES.length],
        'aria-hidden': true,
      }),
    )
  }
  return React.createElement(
    'div',
    {
      className: ['threadline-loading', props.className].filter(Boolean).join(' '),
      role: 'status',
      'aria-live': 'polite',
      'aria-busy': 'true',
      'data-testid': props.testId,
    },
    React.createElement('span', { className: 'threadline-visually-hidden' }, props.label),
    ...rows,
  )
}
