/*
 * shell/NowStrip.ts —— Now strip（36px）：仅当当前工作区有 running 会话时渲染（03 §3.1）。
 *
 * 文案由调用方拼（会话标题 / 状态 / 步数 / 本轮影响），本组件不生产文案，
 * 因此不会有第二套文案实现；「执行中」这类状态词必须来自 locale。
 */
import * as React from 'react'
import { Button } from '../common/index.ts'
import { SHELL_REGIONS } from './types.ts'

export interface NowStripProps {
  /** 主体文案（元数据，禁止正文）。 */
  text: string
  /** 是否有 running 会话（true 时点有脉冲；reduced-motion 下静态）。 */
  running?: boolean
  /** 右侧动作文案（例如「打开」）；没有就不渲染按钮。 */
  actionLabel?: string
  onAction?: () => void
  /** 附加说明（例如「本轮仍在记录」）。 */
  detail?: string
  testId?: string
}

export function NowStrip(props: NowStripProps): React.ReactElement {
  return React.createElement(
    'div',
    {
      className: 'threadline-now',
      'data-region': SHELL_REGIONS.now,
      'data-running': props.running === true ? 'true' : 'false',
      'data-testid': props.testId,
    },
    React.createElement('span', { className: 'threadline-now-dot', 'aria-hidden': true }),
    React.createElement('span', { className: 'threadline-now-text' }, props.text),
    props.detail ? React.createElement('span', { className: 'threadline-now-sep', 'aria-hidden': true }, '·') : null,
    props.detail ? React.createElement('span', { className: 'threadline-now-text' }, props.detail) : null,
    props.actionLabel && props.onAction
      ? React.createElement(Button, { label: props.actionLabel, variant: 'outline', onClick: props.onAction })
      : null,
  )
}
