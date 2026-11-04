/*
 * inspector/SessionInspector.ts —— 会话检查器（03 §8.3；06 A42-2）。
 *
 * 字段（逐条对应 03 §8.3）：
 *  标题 会话标题 + 状态 / 概览（起止时间、轮次数、文件数、命令数、子智能体数、错误数）/
 *  模型（provider/model，**只作标签，不做成本/token**）/ 工作线（父会话 / 子智能体，点击打开）/
 *  最近 10 轮（点击选中）/ 动作。
 */
import * as React from 'react'
import type { SessionInspectorModel } from './model.ts'
import type { Translator } from '../../locale/index.ts'
import { INSPECTOR_COPY, label } from './copy.ts'
import { Actions, Badge, Item, ItemMain, ItemMeta, List, Note, Row, Section, TitleBlock } from './primitives.ts'

const e = React.createElement

export interface SessionInspectorProps {
  model: SessionInspectorModel
  t: Translator
  onSelectSession?: (sessionId: string) => void
  onSelectTurn?: (sessionId: string, turn: number) => void
  onOpenSession?: (sessionId: string) => void
  onFocusInMap?: (sessionId: string) => void
  onClose?: () => void
  testId?: string
}

function statusTone(running: boolean, status: string): 'running' | 'aborted' | 'unknown' | 'none' {
  if (running) return 'running'
  if (status === 'aborted') return 'aborted'
  if (status === 'completed') return 'none'
  return 'unknown'
}

export function SessionInspector(props: SessionInspectorProps): React.ReactElement {
  const { model, t } = props
  const count = (value: number | null): string => (value === null ? t('state.unknown') : String(value))
  return e(
    'div',
    { className: 'threadline-inspector-view', 'data-inspector-kind': 'session', 'data-testid': props.testId ?? 'inspector-session' },
    // —— 标题 + 状态 ——
    e(TitleBlock, {
      name: model.title,
      extra: e(Badge, { label: model.statusLabel, status: statusTone(model.running, model.status), testId: 'session-status' }),
    }),
    model.archived ? e(Note, { text: t('session.archived') }) : null,

    // —— 概览 ——
    e(
      Section,
      { testId: 'session-overview' },
      e(Row, {
        label: t('inspector.timeRange'),
        value: model.overview.startedAtText + ' – ' + model.overview.endedAtText,
        mono: true,
      }),
      e(Row, { label: t('inspector.turn'), value: count(model.overview.turns), mono: true, muted: model.overview.turns === null }),
      e(Row, { label: t('inspector.file'), value: count(model.overview.files), mono: true, muted: model.overview.files === null }),
      e(Row, {
        label: t('inspector.commands'),
        value: count(model.overview.commands),
        mono: true,
        muted: model.overview.commands === null,
      }),
      e(Row, {
        label: t('inspector.subagents'),
        value: count(model.overview.subagents),
        mono: true,
        muted: model.overview.subagents === null,
      }),
      e(Row, {
        label: t('inspector.errors'),
        value: count(model.overview.errors),
        mono: true,
        muted: model.overview.errors === null,
        ...(model.overview.errors !== null && model.overview.errors > 0 ? { tone: 'danger' as const } : {}),
      }),
    ),

    // —— 模型（只作标签，不做成本/token）——
    e(
      Section,
      { testId: 'session-model' },
      e(Row, { label: t('inspector.model'), value: model.model.text, mono: true, muted: model.model.text === '—' }),
    ),

    // —— 工作线（父 / 子，点击打开）——
    e(
      Section,
      { title: t('inspector.workline'), testId: 'session-workline' },
      model.workline.parent === null
        ? e(Row, { label: t('inspector.parentSession'), value: '—', muted: true })
        : e(Row, { label: t('inspector.parentSession'), value: model.workline.parent.label }),
      model.workline.children.length === 0 && model.workline.subagents.length === 0
        ? null
        : e(
            List,
            null,
            model.workline.children.map((child) =>
              e(
                Item,
                {
                  key: 'child-' + child.id,
                  ...(props.onSelectSession === undefined ? {} : { onClick: () => props.onSelectSession?.(child.id) }),
                },
                e(ItemMain, { text: child.label }),
                e(ItemMeta, { text: child.statusLabel }),
              ),
            ),
            model.workline.subagents.map((subagent) =>
              e(
                Item,
                {
                  key: 'subagent-' + subagent.id,
                  ...(props.onSelectSession === undefined ? {} : { onClick: () => props.onSelectSession?.(subagent.id) }),
                },
                e(ItemMain, { text: subagent.title }),
                e(ItemMeta, { text: subagent.statusLabel ?? t('status.unknown'), ...(subagent.statusLabel === null ? { tone: 'unknown' as const } : {}) }),
              ),
            ),
          ),
    ),

    // —— 最近 10 轮（点击选中）——
    e(
      Section,
      { title: t('inspector.recentTurns'), hint: String(model.recentTurns.length), testId: 'session-recent-turns' },
      model.recentTurns.length === 0
        ? e(Note, { text: '—' })
        : e(
            List,
            null,
            model.recentTurns.map((turn) =>
              e(
                Item,
                {
                  key: 'turn-' + String(turn.turn),
                  ...(props.onSelectTurn === undefined ? {} : { onClick: () => props.onSelectTurn?.(model.sessionId, turn.turn) }),
                },
                e(ItemMain, { text: 'T' + String(turn.turn) + ' · ' + turn.statusLabel }),
                e(ItemMeta, {
                  text:
                    String(turn.files) + ' · ' + String(turn.commands) + ' · ' + String(turn.errors) + ' · ' + turn.durationText,
                  ...(turn.status === 'aborted' ? { tone: 'danger' as const } : {}),
                }),
              ),
            ),
          ),
    ),

    // —— 动作 ——
    e(
      Actions,
      { testId: 'session-actions' },
      e('button', {
        type: 'button',
        className: 'threadline-btn threadline-btn--outline',
        disabled: props.onOpenSession === undefined,
        onClick: () => props.onOpenSession?.(model.sessionId),
        children: t('inspector.openSession'),
      }),
      e('button', {
        type: 'button',
        className: 'threadline-btn threadline-btn--outline',
        disabled: props.onFocusInMap === undefined,
        onClick: () => props.onFocusInMap?.(model.sessionId),
        children: label(INSPECTOR_COPY.focusInMap, '◎', t),
      }),
      e('button', {
        type: 'button',
        className: 'threadline-btn threadline-btn--outline',
        disabled: props.onClose === undefined,
        onClick: () => props.onClose?.(),
        children: t('ui.close'),
      }),
    ),
  )
}
