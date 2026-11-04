/*
 * ui/modal/ThreadlineModal.ts —— `/threadline` 弹窗本体（03 §9.1/§9.2；06 A43-3）。
 *
 * 契约：
 * - 尺寸 `min(1040px, 92vw) × min(760px, 88vh)`、居中、`role="dialog" aria-modal="true"`、
 *   焦点陷阱、Esc / 遮罩 / 关闭按钮 —— 全部由 T06 的 `Overlay` 负责（不另写一套）；
 * - 打开先骨架 + 「正在读取本对话…」，数据到后填充；
 * - 起点/终点只引用记录里的消息文本，**默认折叠**、隐私模式隐藏；
 * - 左轮次轨迹（可展开单轮影响）/ 右本对话文件缩略星图；底部未闭环；
 * - 无 LLM、无生成文字；所有点击不产生投递。
 */
import * as React from 'react'
import type { FileNode, SessionDetail } from '../../../shared/events/index.ts'
import type { GraphEdge } from '../../../shared/relations/index.ts'
import type { Translator } from '../../locale/index.ts'
import { EmptyState, ErrorState, LoadingState, Overlay } from '../common/index.ts'
import { MapView } from '../map/index.ts'
import { shouldRenderContent, type PrivacyMode } from '../../privacy/index.ts'
import { ErrorBoundary, Portal } from '../shell/index.ts'
import { buildModalModel, modalPath, modalStatusLabel, type ModalModel, type ModalTurnRow } from './model.ts'

const h = React.createElement

export interface ModalFocusRequest {
  kind: 'turn' | 'file' | 'session'
  turn?: number
  path?: string
}

export interface ThreadlineModalProps {
  open: boolean
  sessionId: string
  detail: SessionDetail | null
  detailLoading?: boolean
  detailError?: boolean
  files: ReadonlyMap<string, FileNode>
  edges?: readonly GraphEdge[]
  /** 隐私模式（T10 `privacy/masks` 单一实现；'hidden' 时正文入口消失）。 */
  mode: PrivacyMode
  now?: number
  onClose: () => void
  onRetry?: () => void
  /** 「在完整脉络中查看」/ 点击轮次或文件节点：打开 tab 并聚焦（不产生投递）。 */
  onOpenFull: (target: ModalFocusRequest) => void
  t: Translator
  testId?: string
}

/** 折叠正文（默认收起；展开后只读、可手动选择文本，无复制按钮）。 */
function DisclosureBody(props: { label: string; text: string | null; mode: PrivacyMode; t: Translator }): React.ReactElement {
  const [open, setOpen] = React.useState(false)
  const violation = props.mode === 'hidden'
  if (violation || props.text === null) {
    return h(
      'div',
      { className: 'threadline-modal-kv' },
      h('span', { className: 'threadline-modal-kv-label' }, props.label),
      h('span', { className: 'threadline-modal-kv-value threadline-modal-muted' }, violation ? props.t('privacy.hidden') : '—'),
    )
  }
  return h(
    'div',
    { className: 'threadline-modal-kv' },
    h('span', { className: 'threadline-modal-kv-label' }, props.label),
    h(
      'button',
      {
        type: 'button',
        className: 'threadline-modal-disclosure',
        'aria-expanded': open,
        onClick: () => setOpen((value) => !value),
      },
      h('span', { 'aria-hidden': true }, open ? '▾' : '▸'),
      h('span', null, props.t('privacy.show')),
    ),
    shouldRenderContent(props.mode, open) && props.text !== null
      ? h('pre', { className: 'threadline-modal-body-text', tabIndex: 0 }, props.text)
      : null,
  )
}

/** 一行轮次轨迹（点击展开单轮影响；展开后给"在脉络中查看"）。 */
function TurnRow(props: {
  row: ModalTurnRow
  t: Translator
  onOpenFull: (target: ModalFocusRequest) => void
}): React.ReactElement {
  const [open, setOpen] = React.useState(false)
  const row = props.row
  return h(
    'div',
    { className: 'threadline-modal-turn', 'data-turn': String(row.n), 'data-status': row.status },
    h(
      'button',
      {
        type: 'button',
        className: 'threadline-modal-turn-head',
        'aria-expanded': open,
        onClick: () => setOpen((value) => !value),
      },
      h('span', { className: 'threadline-modal-turn-n' }, 'T' + String(row.n)),
      h('span', { className: 'threadline-modal-turn-status' }, row.statusLabel),
      h('span', { className: 'threadline-modal-turn-meta' }, row.durationText),
      h(
        'span',
        { className: 'threadline-modal-turn-counts' },
        String(row.files) + ' · ' + String(row.commands) + (row.errors > 0 ? ' · ' + String(row.errors) : ''),
      ),
    ),
    open
      ? h(
          'div',
          { className: 'threadline-modal-turn-body' },
          row.filesPreview.length === 0
            ? h('span', { className: 'threadline-modal-muted' }, '—')
            : row.filesPreview.map((path) => h('span', { key: path, className: 'threadline-modal-turn-path' }, path)),
          row.hiddenFiles > 0
            ? h('span', { className: 'threadline-modal-muted' }, props.t('inspector.more', { n: row.hiddenFiles }))
            : null,
          h(
            'button',
            {
              type: 'button',
              className: 'threadline-btn threadline-btn--outline',
              onClick: () => props.onOpenFull({ kind: 'turn', turn: row.n }),
            },
            props.t('impact.openTab'),
          ),
        )
      : null,
  )
}

export function ThreadlineModal(props: ThreadlineModalProps): React.ReactElement | null {
  const { t, detail, runtimeOpen } = { t: props.t, detail: props.detail, runtimeOpen: props.open }
  const model: ModalModel | null = React.useMemo(
    () =>
      detail === null
        ? null
        : buildModalModel({
            detail,
            files: props.files,
            mode: props.mode,
            t,
            ...(props.now === undefined ? {} : { now: props.now }),
          }),
    [detail, props.files, props.mode, props.now, t],
  )

  if (!runtimeOpen) return null

  const title = model === null ? t('modal.title') : t('modal.title')
  const summary = model === null ? null : h(
    'div',
    { className: 'threadline-modal-summary', 'data-testid': 'modal-summary' },
    h('span', { className: 'threadline-modal-summary-item' }, model.durationText),
    h('span', { className: 'threadline-modal-summary-sep', 'aria-hidden': true }, '·'),
    h('span', { className: 'threadline-modal-summary-item' }, String(model.turns) + ' ' + t('inspector.turn')),
    h('span', { className: 'threadline-modal-summary-sep', 'aria-hidden': true }, '·'),
    h('span', { className: 'threadline-modal-summary-item' }, String(model.files) + ' ' + t('inspector.file')),
    h('span', { className: 'threadline-modal-summary-sep', 'aria-hidden': true }, '·'),
    h('span', { className: 'threadline-modal-summary-item' }, String(model.commands) + ' ' + t('inspector.commands')),
    h('span', { className: 'threadline-modal-summary-sep', 'aria-hidden': true }, '·'),
    h('span', { className: 'threadline-modal-summary-item' }, String(model.subagents) + ' ' + t('inspector.subagents')),
    h('span', { className: 'threadline-modal-badge' }, model.badge),
  )

  const body = (() => {
    if (props.detailError === true && model === null) {
      return h(ErrorState, {
        title: t('state.hostUnavailable'),
        retryLabel: t('coverage.retry'),
        ...(props.onRetry === undefined ? {} : { onRetry: props.onRetry }),
        testId: 'modal-error',
      })
    }
    if (model === null) {
      return h(LoadingState, { label: t('state.loadingDetail'), lines: 4, block: true, testId: 'modal-loading' })
    }
    if (model.turnRows.length === 0) {
      return h(EmptyState, { title: t('state.emptyWorkspace'), detail: t('modal.badge'), testId: 'modal-empty' })
    }
    const now = props.now ?? 0
    return h(
      'div',
      { className: 'threadline-modal-body', 'data-testid': 'modal-body' },
      h(
        'div',
        { className: 'threadline-modal-turns', 'data-testid': 'modal-turns' },
        h('div', { className: 'threadline-modal-sectitle' }, t('modal.turns')),
        ...model.turnRows.map((row) =>
          h(TurnRow, {
            key: row.n,
            row,
            t,
            onOpenFull: props.onOpenFull,
          }),
        ),
      ),
      h(
        'div',
        { className: 'threadline-modal-map', 'data-testid': 'modal-map' },
        h('div', { className: 'threadline-modal-sectitle' }, t('modal.map')),
        model.nodes.length === 0
          ? h('div', { className: 'threadline-modal-muted' }, t('state.emptyFiles'))
          : h(MapView, {
              nodes: model.nodes,
              ...(props.edges === undefined ? {} : { edges: props.edges }),
              now,
              showLegend: false,
              maxNodes: 120,
              onSelectFile: (path) => {
                if (path !== null) props.onOpenFull({ kind: 'file', path })
              },
              testId: 'modal-map-view',
            }),
      ),
    )
  })()

  return h(
    ErrorBoundary,
    {
      label: t('state.unknown') + ' · ' + t('modal.title'),
      detailLabel: t('ui.expand'),
      resetKey: props.sessionId + ':' + String(props.open),
      testId: 'modal-error-boundary',
    },
    h(
      'span',
      {
        className: 'threadline-modal-root',
        'data-testid': 'modal-root',
        'data-threadline-modal-root': '',
      },
      h(
        Portal,
        { testId: 'modal-portal', className: 'threadline-modal-root' },
        h(
          Overlay,
          {
            open: runtimeOpen,
      onClose: props.onClose,
      title,
      closeLabel: t('ui.close'),
      actions: h(
        'button',
        {
          type: 'button',
          className: 'threadline-btn threadline-btn--outline threadline-btn--md',
          onClick: () => props.onOpenFull({ kind: 'session' }),
        },
        t('modal.openFull'),
      ),
      testId: props.testId ?? 'threadline-modal',
    },
    h(
      'div',
      { className: 'threadline-modal', 'data-modal-status': model === null ? 'loading' : 'ready' },
      model !== null ? h(
        'div',
        { className: 'threadline-modal-head' },
        h('span', { className: 'threadline-modal-session' }, modalPath(model.title, props.mode)),
        h('span', { className: 'threadline-modal-status' }, modalStatusLabel(detail, t)),
      ) : null,
      summary,
      model !== null && (model.partial || model.running)
        ? h(
            'div',
            { className: 'threadline-modal-banner', role: 'status' },
            t('state.partialTurn') + (model.partial ? ' · ' + t('coverage.partial', { done: model.turns, total: model.turns }) : ''),
          )
        : null,
      model !== null
        ? h(
            'div',
            { className: 'threadline-modal-edges' },
            h(DisclosureBody, { label: t('modal.start'), text: model.startText, mode: props.mode, t }),
            h(DisclosureBody, { label: t('modal.end'), text: model.endText, mode: props.mode, t }),
          )
        : null,
      body,
      model !== null
        ? h(
            'div',
            { className: 'threadline-modal-loops', 'data-testid': 'modal-open-loops' },
            h('span', { className: 'threadline-modal-sectitle' }, t('modal.openLoops')),
            h('span', null, t('status.failed') + ' ' + String(model.openLoops.failedCommands)),
            h('span', null, t('inspector.subagents') + ' ' + String(model.openLoops.unfinishedSubagents)),
          )
        : null,
          ),
        ),
      ),
    ),
  )
}
