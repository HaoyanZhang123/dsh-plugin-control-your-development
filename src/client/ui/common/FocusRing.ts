/*
 * FocusRing.ts —— 焦点环的唯一实现入口（2px 可见，03 §15）。
 *
 * 实际样式在 base.css 的 :focus-visible 规则里（用宿主环宽令牌 + 强调色令牌）；
 * 这里只导出类名与装配函数，避免各处手写 outline。
 */
import * as React from 'react'

/** 焦点环类名（base.css 里有对应的 :focus-visible 规则）。 */
export const FOCUS_RING_CLASS = 'threadline-focus-ring'

/** 拼 className：focus ring + 额外类名（过滤空值）。 */
export function focusRingClassName(...extra: Array<string | false | null | undefined>): string {
  return [FOCUS_RING_CLASS, ...extra].filter((item): item is string => Boolean(item)).join(' ')
}

export interface FocusRingProps {
  children?: React.ReactNode
  className?: string
}

/**
 * 演示 / 包裹用：给任意内容套一个带焦点环契约的容器。
 * 一般组件不需要它（button 自带 :focus-visible），它存在是为了让"焦点环"在测试与文档里有唯一名字。
 */
export function FocusRing(props: FocusRingProps): React.ReactElement {
  return React.createElement(
    'span',
    { className: focusRingClassName(props.className), tabIndex: -1, 'data-threadline-focus-ring': '' },
    props.children,
  )
}
