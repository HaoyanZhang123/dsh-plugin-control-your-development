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
  /** 当前会话 id：具体会话列表里不再重复列它。 */
  currentSessionId?: string
  testId?: string
}

export function SessionSelector(props: SessionSelectorProps): React.ReactElement {
  const { t } = props
  const options = buildScopeOptions(props.sessions, t, {
    ...(props.privacyMode === undefined ? {} : { privacyMode: props.privacyMode }),
    ...(props.currentSessionId === undefined ? {} : { currentSessionId: props.currentSessionId }),
  })
  const label = turnLabel(TURN_COPY.scopeLabel, '▾', t)
  const viewOptions = options.filter((option) => option.group !== 'sessions')
  const sessionOptions = options.filter((option) => option.group === 'sessions')
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
      /* 视图级范围单独一组：`全部会话` 含归档、与"具体会话"语义不同，
       * 用 optgroup 在原生控件里做出区分度（不另造一套下拉）。 */
      React.createElement(
        'optgroup',
        { label: turnLabel(TURN_COPY.scopeGroupView, '◇', t) },
        ...viewOptions.map((option) =>
          React.createElement('option', { key: option.value, value: option.value }, option.label),
        ),
      ),
      sessionOptions.length === 0
        ? null
        : React.createElement(
            'optgroup',
            { label: turnLabel(TURN_COPY.scopeGroupSessions, '▸', t) },
            ...sessionOptions.map((option) =>
              React.createElement('option', { key: option.value, value: option.value }, option.label),
            ),
          ),
    ),
  )
}
