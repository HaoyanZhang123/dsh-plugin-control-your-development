/*
 * Tooltip.ts —— 悬停 + 键盘聚焦都能看到、读屏也能获得的提示（03 §15）。
 *
 * 实现要点：
 * - 提示气泡始终在 DOM 里（只是 opacity: 0），并用 aria-describedby 挂到触发元素上，
 *   这样读屏与键盘用户拿得到；不靠 title 属性（title 不可读屏稳定，也不能换行）。
 * - 不写 width/height 硬值，气泡自动换行、max-inline-size 由 base.css 控制。
 * - 提示内容只放元数据，禁止放正文/完整命令（03 §12）；这由调用方负责。
 */
import * as React from 'react'

export interface TooltipProps {
  /** 提示内容（元数据，不放正文）。 */
  content: React.ReactNode
  /** 触发者：优先把 aria-describedby 克隆到它身上。 */
  children?: React.ReactNode
  /** 固定展开（用于截图/测试的可复现状态）。 */
  open?: boolean
  className?: string
}

/**
 * React 的 useId 会产出 ":r0:" 这类带冒号的 id；冒号在 CSS 选择器里要转义，
 * 统一净化成 [A-Za-z0-9_-]，让 id 在选择器、aria-describedby、getElementById 三处都安全。
 */
export function tooltipDescriptionId(rawId: string): string {
  const safe = rawId.replace(/[^a-zA-Z0-9_-]/g, '')
  return 'threadline-tip-' + (safe === '' ? 'x' : safe)
}

export function Tooltip(props: TooltipProps): React.ReactElement {
  const tipId = tooltipDescriptionId(React.useId())
  const tip = React.createElement(
    'span',
    { key: 'tip', id: tipId, className: 'threadline-tip', role: 'tooltip' },
    props.content,
  )
  const described = React.isValidElement(props.children)
    ? React.cloneElement(props.children as React.ReactElement<Record<string, unknown>>, {
        'aria-describedby': tipId,
        // 本项目的 Button/Chip 走显式 props（不 spread 未知属性），所以同时给一个命名 props。
        describedBy: tipId,
      })
    : React.createElement('span', { tabIndex: 0, 'aria-describedby': tipId }, props.children)
  return React.createElement(
    'span',
    {
      className: ['threadline-tip-trigger', props.className].filter(Boolean).join(' '),
      'data-open': props.open === true ? 'true' : undefined,
    },
    described,
    tip,
  )
}
