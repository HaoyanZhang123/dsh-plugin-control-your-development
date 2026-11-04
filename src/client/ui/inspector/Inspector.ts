/*
 * inspector/Inspector.ts —— 检查器派发器（03 §8；06 A42-2 / A42-3 / N-01 / N-16）。
 *
 * 按「当前选择」渲染四种形态之一（文件 / 轮次 / 会话 / 工作区概览）。
 * - 选择与检查器开关由上层 reducer 持有，这里只读 `selection`；
 * - 加载态用 `state.loadingDetail`（不显示半截假字段）；缺失/未知显式空态；
 * - 所有跳转都是回调上抛（打开文件 / 打开会话 / 在图中聚焦 / 打开对话弹窗），本组件不导航。
 */
import * as React from 'react'
import { EmptyState, ErrorState, LoadingState } from '../common/index.ts'
import type { Translator } from '../../locale/index.ts'
import { buildInspectorModel, type InspectorData } from './model.ts'
import { FileInspector } from './FileInspector.ts'
import { TurnInspector } from './TurnInspector.ts'
import { SessionInspector } from './SessionInspector.ts'
import { WorkspaceOverview } from './WorkspaceOverview.ts'
import type { Selection } from '../turns/index.ts'

const e = React.createElement

/** 检查器动作（全部只读导航；由 T09 接到入口/星图/会话打开上）。 */
export interface InspectorActions {
  onSelectFile?: (path: string) => void
  onSelectTurn?: (sessionId: string, turn: number) => void
  onSelectSession?: (sessionId: string) => void
  onOpenFile?: (path: string) => void
  onOpenSession?: (sessionId: string) => void
  onFocusInMap?: (selection: Selection) => void
  onOpenModal?: (sessionId: string) => void
  onClose?: () => void
  onRetry?: () => void
}

export interface InspectorProps {
  t: Translator
  data: InspectorData
  /** 当前固定选择（预览态由上层决定是否传进来）。 */
  selection: Selection
  privacyMode?: boolean
  /** 未结束轮次的"进行中"时长基准（默认 0 = 不计算）。 */
  now?: number
  /** 详情在途（轮次/会话检查器显示 state.loadingDetail 骨架）。 */
  detailLoading?: boolean
  detailError?: boolean
  actions?: InspectorActions
  legendSlot?: React.ReactNode
  layerTogglesSlot?: React.ReactNode
  testId?: string
}

export function Inspector(props: InspectorProps): React.ReactElement {
  const { t, data, selection } = props
  const privacyMode = props.privacyMode === true
  const actions = props.actions ?? {}

  // 加载态：选择的是轮次/会话但详情还没到 → 骨架 + 「正在读取本轮记录…」
  const needsDetail = selection.kind === 'turn' || selection.kind === 'session'
  if (needsDetail && props.detailLoading === true) {
    return e(
      'div',
      { className: 'threadline-inspector-view', 'data-inspector-kind': 'loading', 'data-testid': props.testId },
      e(LoadingState, { label: t('state.loadingDetail'), lines: 4, testId: 'inspector-loading' }),
    )
  }
  if (needsDetail && props.detailError === true) {
    return e(
      'div',
      { className: 'threadline-inspector-view', 'data-inspector-kind': 'error', 'data-testid': props.testId },
      e(ErrorState, {
        title: t('state.hostUnavailable'),
        ...(data.degrade.messageKey === null ? {} : { detail: t(data.degrade.messageKey) }),
        retryLabel: t('coverage.retry'),
        ...(actions.onRetry === undefined ? {} : { onRetry: actions.onRetry }),
        testId: 'inspector-error',
      }),
    )
  }

  const model = buildInspectorModel(selection, {
    data,
    privacyMode,
    now: props.now ?? 0,
    t,
  })

  if ('missing' in model && model.missing) {
    return e(
      'div',
      { className: 'threadline-inspector-view', 'data-inspector-kind': model.kind, 'data-testid': props.testId },
      e(EmptyState, { title: t('state.unknown'), detail: t('state.emptyWorkspace'), testId: 'inspector-missing' }),
    )
  }

  switch (model.kind) {
    case 'file':
      return e(FileInspector, {
        model,
        t,
        ...(actions.onSelectFile === undefined ? {} : { onSelectFile: actions.onSelectFile }),
        ...(actions.onSelectTurn === undefined ? {} : { onSelectTurn: actions.onSelectTurn }),
        ...(actions.onSelectSession === undefined ? {} : { onSelectSession: actions.onSelectSession }),
        ...(actions.onOpenFile === undefined ? {} : { onOpenFile: actions.onOpenFile }),
        ...(actions.onFocusInMap === undefined ? {} : { onFocusInMap: (path: string) => actions.onFocusInMap?.({ kind: 'file', path }) }),
        ...(actions.onClose === undefined ? {} : { onClose: actions.onClose }),
        ...(props.testId === undefined ? {} : { testId: props.testId }),
      })
    case 'turn':
      return e(TurnInspector, {
        model,
        t,
        privacyMode,
        ...(actions.onSelectTurn === undefined ? {} : { onSelectTurn: actions.onSelectTurn }),
        ...(actions.onSelectFile === undefined ? {} : { onSelectFile: actions.onSelectFile }),
        ...(actions.onSelectSession === undefined ? {} : { onSelectSession: actions.onSelectSession }),
        ...(actions.onOpenSession === undefined ? {} : { onOpenSession: actions.onOpenSession }),
        ...(actions.onFocusInMap === undefined
          ? {}
          : { onFocusInMap: (sessionId: string, turn: number) => actions.onFocusInMap?.({ kind: 'turn', sessionId, turn }) }),
        ...(actions.onOpenModal === undefined ? {} : { onOpenModal: actions.onOpenModal }),
        ...(actions.onClose === undefined ? {} : { onClose: actions.onClose }),
        ...(props.testId === undefined ? {} : { testId: props.testId }),
      })
    case 'session':
      return e(SessionInspector, {
        model,
        t,
        ...(actions.onSelectSession === undefined ? {} : { onSelectSession: actions.onSelectSession }),
        ...(actions.onSelectTurn === undefined ? {} : { onSelectTurn: actions.onSelectTurn }),
        ...(actions.onOpenSession === undefined ? {} : { onOpenSession: actions.onOpenSession }),
        ...(actions.onFocusInMap === undefined
          ? {}
          : { onFocusInMap: (sessionId: string) => actions.onFocusInMap?.({ kind: 'session', sessionId }) }),
        ...(actions.onClose === undefined ? {} : { onClose: actions.onClose }),
        ...(props.testId === undefined ? {} : { testId: props.testId }),
      })
    case 'overview':
    default:
      return e(WorkspaceOverview, {
        model,
        t,
        ...(props.legendSlot === undefined ? {} : { legendSlot: props.legendSlot }),
        ...(props.layerTogglesSlot === undefined ? {} : { layerTogglesSlot: props.layerTogglesSlot }),
        ...(actions.onSelectSession === undefined ? {} : { onSelectSession: actions.onSelectSession }),
        ...(actions.onSelectTurn === undefined ? {} : { onSelectTurn: actions.onSelectTurn }),
        ...(actions.onRetry === undefined ? {} : { onRetry: actions.onRetry }),
        ...(props.testId === undefined ? {} : { testId: props.testId }),
      })
  }
}
