/*
 * inspector/TurnInspector.ts —— 轮次检查器（03 §8.2；06 A42-2 / A42-3 / N-16）。
 *
 * 字段（逐条对应 03 §8.2）：
 *  标题 T{n} + 状态 + 时长 / 用户意图（默认折叠，隐私模式隐藏）/ 工具（总数·失败·未知，按工具名分组）/
 *  文件（新增·修改·读取·搜索 + ≈行数）/ 命令（程序名、摘要可折叠、状态、时长、失败标记）/
 *  子智能体 / 计划（无数据时 `—` 不是 0）/ 错误·未知 / 后续触碰（≤20）/ 与上一轮对比（新增·复用）/ 动作。
 *
 * 正文（用户消息 / 命令全文）**默认折叠**，展开后只读；隐私模式下入口直接不渲染。
 */
import * as React from 'react'
import type { TurnInspectorModel } from './model.ts'
import type { Translator } from '../../locale/index.ts'
import { INSPECTOR_COPY, label } from './copy.ts'
import {
  Actions,
  Badge,
  Banner,
  BodyText,
  Disclosure,
  Item,
  ItemMain,
  ItemMeta,
  List,
  Note,
  Row,
  Section,
  Subhead,
  TitleBlock,
} from './primitives.ts'

const e = React.createElement

export interface TurnInspectorProps {
  model: TurnInspectorModel
  t: Translator
  privacyMode: boolean
  onSelectTurn?: (sessionId: string, turn: number) => void
  onSelectFile?: (path: string) => void
  onSelectSession?: (sessionId: string) => void
  onOpenSession?: (sessionId: string) => void
  onFocusInMap?: (sessionId: string, turn: number) => void
  onOpenModal?: (sessionId: string) => void
  onClose?: () => void
  testId?: string
}

const STATUS_TONE: Record<string, 'running' | 'aborted' | 'error' | 'unknown' | 'none'> = {
  completed: 'none',
  aborted: 'aborted',
  running: 'running',
  unknown: 'unknown',
}

/** 一个文件小分组（新增/修改/读取/搜索共用）。 */
function FileGroup(props: { title: string; rows: Array<{ path: string; deltaText: string }>; onSelectFile?: (path: string) => void }): React.ReactElement | null {
  if (props.rows.length === 0) return null
  return e(
    'div',
    { className: 'threadline-inspector-section' },
    e(Subhead, { text: props.title + ' ' + String(props.rows.length) }),
    e(
      List,
      null,
      props.rows.map((row) =>
        e(
          Item,
          {
            key: row.path,
            ...(props.onSelectFile === undefined ? {} : { onClick: () => props.onSelectFile?.(row.path) }),
          },
          e(ItemMain, { text: row.path, mono: true }),
          e(ItemMeta, { text: row.deltaText }),
        ),
      ),
    ),
  )
}

export function TurnInspector(props: TurnInspectorProps): React.ReactElement {
  const { model, t } = props
  const commandTextLabel = t('privacy.show')
  return e(
    'div',
    { className: 'threadline-inspector-view', 'data-inspector-kind': 'turn', 'data-testid': props.testId ?? 'inspector-turn' },
    // —— 标题：T{n} + 状态 + 时长 ——
    e(TitleBlock, {
      name: model.title + ' · ' + model.sessionLabel,
      path: model.durationText,
      extra: e(Badge, { label: model.statusLabel, status: STATUS_TONE[model.status] ?? 'none', testId: 'turn-status' }),
    }),
    model.partial ? e(Banner, { text: model.partialLabel, tone: 'accent', testId: 'turn-partial' }) : null,

    // —— 用户意图（默认折叠；隐私模式隐藏）——
    e(
      Section,
      { title: t('inspector.intent'), testId: 'turn-intent' },
      model.intent.hidden
        ? e(Note, { text: t('privacy.hidden') })
        : model.intent.available && model.intent.text !== null && model.intent.preview !== null
          ? e(
              Disclosure,
              { summary: model.intent.preview, testId: 'turn-intent-body' },
              e(BodyText, { text: model.intent.text }),
            )
          : e(Note, { text: '—' }),
    ),

    // —— 工具（总数 / 失败 / 未知；按工具名分组）——
    e(
      Section,
      { title: t('inspector.tools'), testId: 'turn-tools' },
      e(Row, { label: t('inspector.tools'), value: String(model.tools.total), mono: true }),
      e(Row, { label: t('status.failed'), value: String(model.tools.failed), mono: true, tone: model.tools.failed > 0 ? 'danger' : undefined }),
      e(Row, { label: t('status.unknown'), value: String(model.tools.unknown), mono: true, muted: model.tools.unknown === 0 }),
      model.tools.unrecorded > 0
        ? e(Note, { text: t('state.unknown') + ' · ' + String(model.tools.unrecorded) })
        : null,
      model.tools.rows.length === 0
        ? e(Note, { text: '—' })
        : e(
            List,
            null,
            model.tools.rows.map((row) =>
              e(
                Item,
                { key: row.tool },
                e(ItemMain, { text: row.tool, mono: true }),
                e(ItemMeta, { text: String(row.total) + ' · ' + t('status.failed') + ' ' + String(row.failed) + ' · ' + t('status.unknown') + ' ' + String(row.unknown) }),
              ),
            ),
          ),
    ),

    // —— 文件（新增 / 修改 / 读取 / 搜索 + ≈行数）——
    e(
      Section,
      { title: t('inspector.file'), testId: 'turn-files' },
      e(FileGroup, { title: t('inspector.filesAdded'), rows: model.files.added, ...(props.onSelectFile === undefined ? {} : { onSelectFile: props.onSelectFile }) }),
      e(FileGroup, { title: t('inspector.filesModified'), rows: model.files.modified, ...(props.onSelectFile === undefined ? {} : { onSelectFile: props.onSelectFile }) }),
      e(FileGroup, { title: t('ops.read'), rows: model.files.read, ...(props.onSelectFile === undefined ? {} : { onSelectFile: props.onSelectFile }) }),
      e(FileGroup, { title: t('ops.search'), rows: model.files.searched, ...(props.onSelectFile === undefined ? {} : { onSelectFile: props.onSelectFile }) }),
      model.files.added.length + model.files.modified.length + model.files.read.length + model.files.searched.length === 0
        ? e(Note, { text: t('state.emptyFiles') })
        : null,
      e(Row, { label: t('inspector.lineDelta'), value: '≈ +' + String(model.files.addedLines) + ' / −' + String(model.files.removedLines), mono: true }),
    ),

    // —— 命令（程序名、摘要可折叠、状态、时长、失败标记）——
    e(
      Section,
      { title: t('inspector.commands'), hint: String(model.commands.length), testId: 'turn-commands' },
      model.commands.length === 0
        ? e(Note, { text: '—' })
        : model.commands.map((command) =>
            e(
              'div',
              { key: command.id, className: 'threadline-inspector-section', 'data-command': command.id },
              e(
                'div',
                { className: 'threadline-inspector-row' },
                e('span', { className: 'threadline-inspector-row-label threadline-mono' }, command.program),
                e(
                  'span',
                  { className: 'threadline-inspector-row-value', 'data-tone': command.status === 'error' ? 'danger' : undefined },
                  command.statusLabel + (command.durationText === '—' ? '' : ' · ' + command.durationText),
                ),
              ),
              command.summary !== null
                ? e(Disclosure, { summary: commandTextLabel, testId: 'command-summary-' + command.id }, e(BodyText, { text: command.summary }))
                : null,
              command.truncated ? e(Note, { text: '…' }) : null,
            ),
          ),
    ),

    // —— 子智能体 ——
    e(
      Section,
      { title: t('inspector.subagents'), hint: String(model.subagents.length), testId: 'turn-subagents' },
      model.subagents.length === 0
        ? e(Note, { text: '—' })
        : e(
            List,
            null,
            model.subagents.map((subagent) =>
              e(
                Item,
                {
                  key: subagent.id,
                  ...(props.onSelectSession === undefined ? {} : { onClick: () => props.onSelectSession?.(subagent.id) }),
                },
                e(ItemMain, { text: subagent.title }),
                e(ItemMeta, { text: subagent.statusLabel ?? t('status.unknown'), ...(subagent.statusLabel === null ? { tone: 'unknown' as const } : {}) }),
              ),
            ),
          ),
    ),

    // —— 计划（无数据 `—`，不是 0）——
    e(
      Section,
      { title: t('inspector.plan'), hint: model.planText, testId: 'turn-plan' },
      // 计划值只出现一次：放在 Section 的 hint 里（无数据时是「—」不是 0；不重复标签、不重复值）。
    ),

    // —— 错误 / 未知（明确列出，不推断）——
    e(
      Section,
      { title: t('inspector.errors'), hint: String(model.errors.failedCommands + model.errors.messages.length), testId: 'turn-errors' },
      model.errors.messages.length === 0 && model.errors.failedCommands === 0
        ? e(Note, { text: '—' })
        : e(
            List,
            null,
            model.errors.messages.map((message, index) =>
              e(Item, { key: 'err-' + String(index) }, e(ItemMain, { text: message, mono: true }), e(ItemMeta, { text: t('status.failed'), tone: 'danger' })),
            ),
            model.errors.failedCommands > 0
              ? e(Item, { key: 'cmd-failed' }, e(ItemMain, { text: t('inspector.commands') }), e(ItemMeta, { text: t('status.failed') + ' ' + String(model.errors.failedCommands), tone: 'danger' }))
              : null,
            model.errors.unknownCommands > 0
              ? e(Item, { key: 'cmd-unknown' }, e(ItemMain, { text: t('inspector.commands') }), e(ItemMeta, { text: t('status.unknown') + ' ' + String(model.errors.unknownCommands), tone: 'unknown' }))
              : null,
          ),
    ),

    // —— 后续触碰（≤20，可点）——
    e(
      Section,
      { title: t('inspector.laterTouches'), hint: String(model.laterTouches.total), testId: 'turn-later-touches' },
      model.laterTouches.rows.length === 0
        ? e(Note, { text: '—' })
        : e(
            List,
            null,
            model.laterTouches.rows.map((row) =>
              e(
                Item,
                {
                  key: row.key,
                  ...(props.onSelectTurn === undefined || row.turn === null
                    ? {}
                    : { onClick: () => props.onSelectTurn?.(row.sessionLabel, row.turn as number) }),
                  title: row.sessionLabel + ' · ' + row.timeText,
                },
                e(ItemMain, { text: row.path, mono: true }),
                e(ItemMeta, { text: row.sessionLabel + ' · ' + (row.turn === null ? '?' : 'T' + String(row.turn)) + ' · ' + row.opsLabel }),
              ),
            ),
          ),
      model.laterTouches.moreText !== null ? e(Note, { text: model.laterTouches.moreText }) : null,
    ),

    // —— 与上一轮对比（新增 / 复用）——
    e(
      Section,
      { title: t('inspector.prevTurn'), hint: model.prevTurn.turn === null ? '—' : 'T' + String(model.prevTurn.turn), testId: 'turn-prev' },
      e(Row, { label: model.prevTurn.addedLabel, value: String(model.prevTurn.added.length), mono: true }),
      e(Row, { label: model.prevTurn.reusedLabel, value: String(model.prevTurn.reused.length), mono: true }),
      model.prevTurn.added.length === 0 && model.prevTurn.reused.length === 0
        ? e(Note, { text: '—' })
        : e(
            List,
            null,
            model.prevTurn.added.map((path) => e(Item, { key: 'added-' + path }, e(ItemMain, { text: path, mono: true }), e(ItemMeta, { text: model.prevTurn.addedLabel }))),
            model.prevTurn.reused.map((path) => e(Item, { key: 'reused-' + path }, e(ItemMain, { text: path, mono: true }), e(ItemMeta, { text: model.prevTurn.reusedLabel }))),
          ),
    ),

    // —— 动作 ——
    e(
      Actions,
      { testId: 'turn-actions' },
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
        onClick: () => props.onFocusInMap?.(model.sessionId, model.turn),
        children: label(INSPECTOR_COPY.focusInMap, '◎', t),
      }),
      e('button', {
        type: 'button',
        className: 'threadline-btn threadline-btn--outline',
        disabled: props.onOpenModal === undefined,
        onClick: () => props.onOpenModal?.(model.sessionId),
        children: t('impact.openModal'),
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
