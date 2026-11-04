/*
 * Overlay.ts —— 遮罩 + 焦点陷阱 + Esc 的通用覆盖层（03 §9.2 / §15）。
 *
 * 契约：
 * - role="dialog" aria-modal="true" aria-labelledby；
 * - 打开时保存原焦点、把焦点移入面板；关闭时把焦点还回去（弹窗关闭后焦点回触发按钮）；
 * - Tab/Shift+Tab 在面板内循环；Esc 关闭；点遮罩关闭；
 * - 卸载（ctx.effect disposer）时移除所有监听，不留全局副作用。
 *
 * 焦点陷阱的边界计算在 focusTrap.ts（纯函数、可单测）。
 */
import * as React from 'react'
import { trapTabKey } from './focusTrap.ts'

export interface OverlayProps {
  open: boolean
  onClose: () => void
  /** 标题（与 aria-labelledby 绑定的文本）。 */
  title: string
  /** 标题右侧的动作（只读操作：在完整脉络中查看之类）。 */
  actions?: React.ReactNode
  children?: React.ReactNode
  /** 遮罩按钮的可读标签（例如"关闭弹窗"）。 */
  closeLabel: string
  className?: string
  testId?: string
}

export function Overlay(props: OverlayProps): React.ReactElement | null {
  const panelRef = React.useRef<HTMLDivElement | null>(null)
  const restoreRef = React.useRef<HTMLElement | null>(null)
  const titleId = 'threadline-overlay-title-' + React.useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const { open, onClose } = props

  React.useEffect(() => {
    if (!open) return undefined
    const doc = document
    const panel = panelRef.current
    restoreRef.current = doc.activeElement instanceof HTMLElement ? doc.activeElement : null
    if (panel) {
      const first = panel.querySelector<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )
      ;(first ?? panel).focus()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onClose()
        return
      }
      trapTabKey(event, panel, doc.activeElement)
    }
    doc.addEventListener('keydown', onKeyDown, true)
    return () => {
      doc.removeEventListener('keydown', onKeyDown, true)
      const restore = restoreRef.current
      if (restore && typeof restore.focus === 'function') restore.focus()
    }
  }, [open, onClose])

  if (!open) return null

  return React.createElement(
    'div',
    { className: ['threadline-overlay', props.className].filter(Boolean).join(' '), 'data-testid': props.testId },
    React.createElement('button', {
      type: 'button',
      className: 'threadline-overlay-mask',
      'aria-label': props.closeLabel,
      tabIndex: -1,
      onClick: onClose,
    }),
    React.createElement(
      'div',
      {
        ref: panelRef,
        className: 'threadline-overlay-panel',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': titleId,
        tabIndex: -1,
        'data-threadline-dialog': '',
      },
      React.createElement(
        'div',
        { className: 'threadline-overlay-head' },
        React.createElement('h2', { className: 'threadline-overlay-title', id: titleId }, props.title),
        props.actions ? React.createElement('div', { className: 'threadline-overlay-actions' }, props.actions) : null,
      ),
      React.createElement('div', { className: 'threadline-overlay-body' }, props.children),
    ),
  )
}
