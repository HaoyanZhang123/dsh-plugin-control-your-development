/*
 * Chip.ts —— 范围/图层/筛选用的紧凑标签（可带计数）。
 *
 * 有 onClick 时是 button + aria-pressed（可键盘操作、可读屏）；
 * 没有 onClick 时是纯展示的 span（不假装可点）。
 */
import * as React from 'react'

export interface ChipProps {
  label: string
  /** 右侧计数（例如「失败 3」）；数字走 tabular-nums。 */
  count?: number
  active?: boolean
  onClick?: () => void
  title?: string
  mono?: boolean
  className?: string
  testId?: string
}

export function chipClassName(options: { mono?: boolean; className?: string } = {}): string {
  const classes = ['threadline-chip']
  if (options.mono) classes.push('threadline-mono')
  if (options.className) classes.push(options.className)
  return classes.join(' ')
}

export function Chip(props: ChipProps): React.ReactElement {
  const interactive = typeof props.onClick === 'function'
  const children: React.ReactNode[] = [React.createElement('span', { key: 'label' }, props.label)]
  if (props.count !== undefined) {
    children.push(
      React.createElement(
        'span',
        { key: 'count', className: 'threadline-chip-count', 'aria-hidden': true },
        String(props.count),
      ),
    )
    children.push(
      React.createElement(
        'span',
        { key: 'sr-count', className: 'threadline-visually-hidden' },
        ' (' + props.count + ')',
      ),
    )
  }
  const common = {
    className: chipClassName({ mono: props.mono, className: props.className }),
    title: props.title,
    'data-testid': props.testId,
  }
  if (interactive) {
    return React.createElement(
      'button',
      {
        ...common,
        type: 'button',
        'aria-pressed': props.active === true,
        onClick: props.onClick,
      },
      children,
    )
  }
  return React.createElement('span', { ...common, 'data-active': props.active === true }, children)
}
