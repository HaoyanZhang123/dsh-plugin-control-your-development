/*
 * inspector/FileInspector.ts —— 文件检查器（03 §8.1；06 A42-2 / A42-3）。
 *
 * 字段（逐条对应 03 §8.1，缺项为 0）：
 *  标题 basename + 相对路径 + 族 / 概览（首次出现·最近触碰·操作数·≈增删行，标注「按工具参数估算」）/
 *  操作统计 / 触碰历史（≤50 + 还有 N 条）/ 关系（结构·共现·引用·时序，每条给 evidence 文本）/
 *  未确认引用（路径 + 行号 + 原因，**不画边**）/ 外部来源（只读，不做剪贴板）/ 动作。
 *
 * 全部字段值来自 `model.ts`（纯函数）；这里只排版与上抛回调，不做判定。
 */
import * as React from 'react'
import type { FileInspectorModel } from './model.ts'
import type { Translator } from '../../locale/index.ts'
import { INSPECTOR_COPY, label } from './copy.ts'
import { Actions, Item, ItemMain, ItemMeta, List, Note, Row, Section, StatBars, Subhead, TitleBlock } from './primitives.ts'

const e = React.createElement

export interface FileInspectorProps {
  model: FileInspectorModel
  t: Translator
  /** 点击关系对端 / 触碰历史里的会话轮次时，由上层决定怎么跳（这里不导航）。 */
  onSelectFile?: (path: string) => void
  onSelectTurn?: (sessionId: string, turn: number) => void
  onSelectSession?: (sessionId: string) => void
  onOpenFile?: (path: string) => void
  onFocusInMap?: (path: string) => void
  onClose?: () => void
  testId?: string
}

export function FileInspector(props: FileInspectorProps): React.ReactElement {
  const { model, t } = props
  return e(
    'div',
    { className: 'threadline-inspector-view', 'data-inspector-kind': 'file', 'data-testid': props.testId ?? 'inspector-file' },
    // —— 标题：basename + 相对路径 + 族 ——
    e(TitleBlock, {
      name: model.name,
      ...(model.displayPath === model.name ? {} : { path: model.displayPath }),
      familyLabel: model.familyLabel,
    }),

    // —— 概览 ——
    e(
      Section,
      { testId: 'file-overview' },
      e(Row, {
        label: t('inspector.firstSeen'),
        value:
          model.overview.firstSeenText +
          (model.overview.firstSeenSession === null ? '' : ' · ' + model.overview.firstSeenSession) +
          (model.overview.firstSeenTurn === null ? '' : ' · T' + String(model.overview.firstSeenTurn)),
        mono: true,
        testId: 'file-first-seen',
      }),
      e(Row, {
        label: t('inspector.lastTouched'),
        value:
          model.overview.lastTouchedText +
          (model.overview.lastTouchedSession === null ? '' : ' · ' + model.overview.lastTouchedSession) +
          (model.overview.lastTouchedTurn === null ? '' : ' · T' + String(model.overview.lastTouchedTurn)),
        mono: true,
        testId: 'file-last-touched',
      }),
      e(Row, { label: t('inspector.ops'), value: String(model.overview.ops), mono: true }),
      e(Row, {
        label: t('inspector.lineDelta'),
        value: '≈ +' + String(model.overview.added) + ' / −' + String(model.overview.removed),
        mono: true,
        title: model.overview.estimateNote,
        testId: 'file-line-delta',
      }),
    ),

    // —— 操作统计 ——
    e(
      Section,
      { title: t('inspector.ops'), testId: 'file-op-stats' },
      e(StatBars, { rows: model.operationStats.map((row) => ({ key: row.key, label: row.label, count: row.count })) }),
    ),

    // —— 触碰历史（最近 50 条 + 还有 N 条）——
    e(
      Section,
      { title: t('inspector.touchHistory'), hint: String(model.touchHistory.total), testId: 'file-touch-history' },
      model.touchHistory.rows.length === 0
        ? e(Note, { text: '—' })
        : e(
            List,
            { testId: 'file-touch-list' },
            model.touchHistory.rows.map((row, index) =>
              e(
                Item,
                {
                  key: row.key,
                  ...(props.onSelectTurn === undefined
                    ? {}
                    : {
                        onClick: () => {
                          if (row.turn !== null) props.onSelectTurn?.(row.sessionId, row.turn)
                          else props.onSelectSession?.(row.sessionId)
                        },
                      }),
                  title: row.sessionLabel + ' · ' + row.timeText,
                },
                e(ItemMain, { text: row.sessionLabel + ' · ' + (row.turn === null ? '?' : 'T' + String(row.turn)), title: row.sessionLabel }),
                e(ItemMeta, { text: row.timeText + ' · ' + row.opsLabel + ' · ' + row.deltaText }),
              ),
            ),
          ),
      model.touchHistory.moreText !== null ? e(Note, { text: model.touchHistory.moreText }) : null,
      model.touchHistory.hidden > 0 && model.touchHistory.total === 0 ? e(Note, { text: '—' }) : null,
    ),

    // —— 关系（每条给证据；点击跳到对端文件）——
    e(
      Section,
      { title: t('relations.title'), hint: String(model.relations.total), testId: 'file-relations' },
      model.relations.groups.length === 0
        ? e(Note, { text: '—' })
        : model.relations.groups.map((group) =>
            e(
              'div',
              { key: group.type, className: 'threadline-inspector-section', 'data-relation-group': group.type },
              e(Subhead, { text: group.title }),
              e(
                List,
                null,
                group.rows.map((row) =>
                  e(
                    'li',
                    { key: row.key, className: 'threadline-inspector-listitem' },
                    e(
                      'button',
                      {
                        type: 'button',
                        className: 'threadline-inspector-relation',
                        'data-target': row.target,
                        'data-confidence': row.confidence,
                        onClick: props.onSelectFile === undefined ? undefined : () => props.onSelectFile?.(row.rawTarget),
                      },
                      e('span', { className: 'threadline-inspector-relation-target' }, row.target),
                      e('span', { className: 'threadline-inspector-evidence' }, t('relations.evidence') + '：' + row.evidence),
                    ),
                  ),
                ),
              ),
              group.hidden > 0 ? e(Note, { text: t('relations.collapsed', { n: group.hidden }) }) : null,
            ),
          ),
      model.relations.collapsedText !== null ? e(Note, { text: model.relations.collapsedText }) : null,
    ),

    // —— 未确认引用（路径 + 行号 + 原因；不画边）——
    e(
      Section,
      { title: t('relations.unconfirmed'), hint: String(model.unconfirmed.length), testId: 'file-unconfirmed' },
      model.unconfirmed.length === 0
        ? e(Note, { text: '—' })
        : e(
            List,
            null,
            model.unconfirmed.map((row, index) =>
              e(
                'li',
                { key: row.path + ':' + String(index), className: 'threadline-inspector-listitem' },
                e(
                  'div',
                  { className: 'threadline-inspector-unconfirmed', 'data-unconfirmed': row.path },
                  e('span', { className: 'threadline-inspector-unconfirmed-path' }, row.path),
                  e(
                    'span',
                    null,
                    'L' + String(row.line) + ' · ' + row.reasonLabel + ' · ' + t('relations.unconfirmed'),
                  ),
                ),
              ),
            ),
          ),
    ),

    // —— 外部来源（只读展示，不做剪贴板）——
    e(
      Section,
      { title: t('inspector.externalSources'), hint: String(model.external.length), testId: 'file-external' },
      model.external.length === 0
        ? e(Note, { text: '—' })
        : e(
            List,
            null,
            model.external.map((row, index) =>
              e(
                'li',
                { key: row.raw + ':' + String(index), className: 'threadline-inspector-listitem' },
                e('div', { className: 'threadline-inspector-unconfirmed', 'data-external': 'true' }, e('span', { className: 'threadline-inspector-unconfirmed-path', title: row.title }, row.label), e('span', null, 'L' + String(row.line))),
              ),
            ),
          ),
    ),

    // —— 动作（全部只读导航；关不掉的写入一概没有）——
    e(
      Actions,
      { testId: 'file-actions' },
      e(
        'button',
        {
          type: 'button',
          className: 'threadline-btn threadline-btn--outline',
          disabled: props.onOpenFile === undefined,
          onClick: () => props.onOpenFile?.(model.path),
          children: t('inspector.openFile'),
        },
      ),
      e(
        'button',
        {
          type: 'button',
          className: 'threadline-btn threadline-btn--outline',
          disabled: props.onFocusInMap === undefined,
          onClick: () => props.onFocusInMap?.(model.path),
          children: label(INSPECTOR_COPY.focusInMap, '◎', t),
        },
      ),
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
