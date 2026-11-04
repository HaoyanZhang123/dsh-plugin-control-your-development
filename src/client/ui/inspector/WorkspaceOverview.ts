/*
 * inspector/WorkspaceOverview.ts —— 工作区概览（无选择时；03 §8.4；06 A42-2 / N-01 / N-03）。
 *
 * 字段（逐条对应 03 §8.4）：
 *  覆盖率（已加载/总数、失败数、当前扫描阶段）/ 当前工作线（running 会话、当前轮、最近活动）/
 *  计数（文件·会话·轮次·命令·子智能体；**只作概览，不做大 KPI 卡**）/ 图例与图层开关位。
 *
 * 不伪造：覆盖率未知时计数一律显示「观测不到」而不是 0；`degrade.renderZeroForbidden` 时
 * 直接显示 hostUnavailable 的说明与「重新读取」，不给空图。
 */
import * as React from 'react'
import type { OverviewModel } from './model.ts'
import type { Translator } from '../../locale/index.ts'
import { Actions, Banner, Item, ItemMain, ItemMeta, List, Note, Row, Section } from './primitives.ts'

const e = React.createElement

export interface WorkspaceOverviewProps {
  model: OverviewModel
  t: Translator
  /** 图例槽（T07 的 Legend 实例；没装就只显示本组件的最小图例）。 */
  legendSlot?: React.ReactNode
  /** 图层开关位（T07 的开关组；这里是它的容器，不自己实现图层状态）。 */
  layerTogglesSlot?: React.ReactNode
  onSelectSession?: (sessionId: string) => void
  onSelectTurn?: (sessionId: string, turn: number) => void
  onRetry?: () => void
  testId?: string
}

export function WorkspaceOverview(props: WorkspaceOverviewProps): React.ReactElement {
  const { model, t } = props
  const countText = (value: number | null): string => (value === null ? t('state.unknown') : String(value))
  const percent = model.coverage.percent
  return e(
    'div',
    { className: 'threadline-inspector-view', 'data-inspector-kind': 'overview', 'data-testid': props.testId ?? 'inspector-overview' },
    // —— 覆盖率（进度条 + 一句话；失败数已经在 coverage.* 文案里显式给出）——
    e(
      Section,
      { testId: 'overview-coverage' },
      e(
        'div',
        { className: 'threadline-inspector-coverage' },
        e(
          'div',
          {
            className: 'threadline-inspector-coverage-bar',
            role: 'progressbar',
            'aria-label': model.coverage.text,
            'aria-valuenow': percent === null ? 0 : percent,
            'aria-valuemin': 0,
            'aria-valuemax': 100,
          },
          e('span', {
            className: 'threadline-inspector-coverage-fill',
            style: { inlineSize: (percent === null ? 0 : percent) + '%' },
          }),
        ),
        e(Note, { text: model.coverage.text }),
        model.coverage.known ? null : e(Note, { text: t('state.unknown') }),
      ),
      model.degrade.message !== ''
        ? e(Banner, {
            text: model.degrade.message,
            ...(model.degrade.kind === 'none' ? {} : { tone: 'danger' as const }),
            testId: 'overview-degrade',
          })
        : null,
      model.degrade.retryable && model.degrade.retryLabel !== null && props.onRetry !== undefined
        ? e(Actions, null, e('button', { type: 'button', className: 'threadline-btn threadline-btn--outline', onClick: props.onRetry, children: model.degrade.retryLabel }))
        : null,
    ),

    // —— 当前工作线 ——
    e(
      Section,
      { title: t('inspector.workline'), testId: 'overview-workline' },
      e(Row, { label: t('inspector.session'), value: model.workline.currentSessionLabel }),
      e(Row, {
        label: t('inspector.turn'),
        value: model.workline.currentTurn === null ? '—' : 'T' + String(model.workline.currentTurn),
        mono: true,
        muted: model.workline.currentTurn === null,
      }),
      e(Row, { label: t('inspector.lastTouched'), value: model.workline.lastActivityText, mono: true }),
      model.workline.running.length === 0
        ? e(Note, { text: '—' })
        : e(
            List,
            null,
            model.workline.running.map((running) =>
              e(
                Item,
                {
                  key: 'running-' + running.sessionId,
                  ...(props.onSelectSession === undefined ? {} : { onClick: () => props.onSelectSession?.(running.sessionId) }),
                },
                e(ItemMain, { text: running.label }),
                e(ItemMeta, { text: t('session.running') + (running.turn === null ? '' : ' · T' + String(running.turn)) }),
              ),
            ),
          ),
    ),

    // —— 计数（概览，不是 KPI 墙：一行一项）——
    e(
      Section,
      { testId: 'overview-counts' },
      e(Row, { label: t('inspector.file'), value: countText(model.counts.files), mono: true, muted: model.counts.files === null }),
      e(Row, { label: t('inspector.session'), value: countText(model.counts.sessions), mono: true, muted: model.counts.sessions === null }),
      e(Row, { label: t('inspector.turn'), value: countText(model.counts.turns), mono: true, muted: model.counts.turns === null }),
      e(Row, { label: t('inspector.commands'), value: countText(model.counts.commands), mono: true, muted: model.counts.commands === null }),
      e(Row, { label: t('inspector.subagents'), value: countText(model.counts.subagents), mono: true, muted: model.counts.subagents === null }),
      model.coverage.known ? null : e(Note, { text: t('state.unknown') }),
    ),

    // —— 图例与图层开关位 ——
    e(
      Section,
      { title: t('legend.title'), testId: 'overview-legend' },
      props.legendSlot ??
        e(
          'div',
          { className: 'threadline-inspector-legend' },
          model.legend.map((item) =>
            e(
              'span',
              { key: item.kind, className: 'threadline-inspector-badge', 'data-kind': item.kind },
              e('span', { className: 'threadline-swatch', 'data-kind': item.kind, 'aria-hidden': true }),
              item.label,
            ),
          ),
        ),
      props.layerTogglesSlot ??
        e(
          'div',
          { className: 'threadline-inspector-toggle-row', 'data-role': 'layer-toggle-slot', 'aria-label': t('legend.title') },
          e('span', { className: 'threadline-inspector-badge', 'data-toggle': 'all-relations', title: t('map.showAllRelations') }, t('map.showAllRelations')),
          e('span', { className: 'threadline-inspector-badge', 'data-toggle': 'only-current', title: t('map.onlyCurrent') }, t('map.onlyCurrent')),
        ),
    ),
  )
}
