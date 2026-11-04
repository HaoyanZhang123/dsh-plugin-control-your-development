/*
 * Button.ts —— 唯一的按钮实现（03 §7 只读：这里没有任何"开始/停止/重试/保存/应用"语义）。
 *
 * 规则：
 * - 永远是 <button type="button">（可点击元素必须是 button 或 role=button + tabIndex）；
 * - icon-only 必须在**类型层**带 ariaLabel：`iconOnly: true` 时缺 ariaLabel 直接 typecheck 红；
 * - 焦点环由 base.css 的 :focus-visible 统一给（2px），不在组件里写 outline。
 */
import * as React from 'react'

export type ButtonVariant = 'ghost' | 'outline' | 'danger'
export type ButtonSize = 'sm' | 'md'

interface ButtonBaseProps {
  children?: React.ReactNode
  /** 按钮文字（icon-only 时留空，用 ariaLabel）。 */
  label?: string
  variant?: ButtonVariant
  size?: ButtonSize
  /** 切换类按钮的按下态（aria-pressed）。 */
  pressed?: boolean
  /** 展开/收起类按钮（aria-expanded）。 */
  expanded?: boolean
  /** @deprecated 用 pressed；保留是为了 T07/T08 的选中态绑定。 */
  selected?: boolean
  disabled?: boolean
  title?: string
  className?: string
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void
  /** 额外被描述的元素 id（例如 tooltip）。 */
  describedBy?: string
  testId?: string
}

/** 类型层契约：icon-only 必须给 aria-label。 */
export type ButtonProps = ButtonBaseProps &
  ({ iconOnly: true; ariaLabel: string } | { iconOnly?: false; ariaLabel?: string })

/** 组装 className（variant/size/icon 都在这里，避免组件之间各拼一套）。 */
export function buttonClassName(options: {
  variant?: ButtonVariant
  size?: ButtonSize
  iconOnly?: boolean
  className?: string
} = {}): string {
  const classes = ['threadline-btn', 'threadline-focus-ring']
  if (options.variant === 'outline') classes.push('threadline-btn--outline')
  if (options.variant === 'danger') classes.push('threadline-btn--danger')
  if (options.size === 'md') classes.push('threadline-btn--md')
  if (options.iconOnly) classes.push('threadline-btn--icon')
  if (options.className) classes.push(options.className)
  return classes.join(' ')
}

/**
 * 按钮。
 * icon-only 时可见内容（children）通常是 1 个字符或图标，可读标签只来自 ariaLabel。
 */
export function Button(props: ButtonProps): React.ReactElement {
  const iconOnly = props.iconOnly === true
  const ariaLabel = props.ariaLabel
  if (iconOnly && (ariaLabel === undefined || ariaLabel.trim() === '')) {
    // 类型层已经拦过一次；这里是运行期兜底：宁可少一个按钮，也不发一个读屏不可读的按钮。
    throw new Error('threadline: icon-only Button 必须给 ariaLabel')
  }
  const pressedProps: Record<string, unknown> = {}
  const pressed = props.pressed ?? props.selected
  if (pressed !== undefined) pressedProps['aria-pressed'] = pressed === true
  if (props.expanded !== undefined) pressedProps['aria-expanded'] = props.expanded === true
  return React.createElement(
    'button',
    {
      type: 'button',
      className: buttonClassName(props),
      disabled: props.disabled === true,
      title: props.title,
      'aria-label': ariaLabel,
      'aria-describedby': props.describedBy,
      'data-testid': props.testId,
      onClick: props.disabled === true ? undefined : props.onClick,
      ...pressedProps,
    },
    props.children,
    iconOnly || props.label === undefined
      ? null
      : React.createElement('span', { className: 'threadline-btn-label' }, props.label),
  )
}
