/*
 * turns/SessionSelector.ts —— 会话选择器（03 §6：`当前会话` / `全部工作线` / 具体会话）。
 *
 * 用原生 `<select>`：键盘、读屏、焦点环全部由宿主与 base.css 负责，不自己造一套下拉。
 * 值用稳定的字符串键（`scopeKey`），回调上抛 `TurnScope`。
 */
import * as React from 'react'
import type { Translator } from '../../locale/index.ts'
import { TURN_COPY, turnLabel } from './copy.ts'
import { buildScopeOptions, parseScopeKey, scopeKey, type TurnScope, type TurnStripSession } from './model.ts'

export interface SessionSelectorProps {
  t: Translator
  sessions: readonly TurnStripSession[]
  scope: TurnScope
  onScopeChange: (scope: TurnScope) => void
  privacyMode?: boolean
  testId?: string
}

export function SessionSelector(props: SessionSelectorProps): React.ReactElement {
  const { t } = props
  const options = buildScopeOptions(props.sessions, t, {
    ...(props.privacyMode === undefined ? {} : { privacyMode: props.privacyMode }),
  })
  const label = turnLabel(TURN_COPY.scopeLabel, '▾', t)
  return React.createElement(
    'span',
    { className: 'threadline-turn-scope' },
    React.createElement(
      'select',
      {
        className: 'threadline-turn-scope-select',
        'aria-label': label,
        'data-testid': props.testId ?? 'turn-scope',
        value: scopeKey(props.scope),
        onChange: (event: React.ChangeEvent<HTMLSelectElement>) => {
          props.onScopeChange(parseScopeKey(event.currentTarget.value))
        },
      },
      options.map((option) =>
        React.createElement('option', { key: option.value, value: option.value }, option.label),
      ),
    ),
  )
}
