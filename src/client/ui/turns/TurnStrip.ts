/*
 * turns/TurnStrip.ts —— 轮次带本体（03 §6；06 A42-1 / A42-4 / N-16）。
 *
 * 边界：
 * - 选择状态是 **props + 回调**：本组件只把 hover/click/双击/键盘映射成回调，不持有一份选择状态；
 *   唯一的内部状态是 **roving tabindex 的焦点位置**（不是选择，不参与判定）。
 * - 槽（92px 高、可折叠、<900px 纵向）由 T06 的 `TurnStripSlot` + base.css 的容器查询负责；
 *   这里只负责块、换行、键盘与空/加载态。
 * - 双击不导航：只调 `onDoubleClick`，由 T09 决定怎么打开会话。
 * - 换行不产生横向滚动：外层 `flex-wrap: wrap` + `overflow-x: hidden`，块本身固定宽度。
 */
import * as React from 'react'
import { EmptyState, LoadingState } from '../common/index.ts'
import type { Translator } from '../../locale/index.ts'
import { TURN_COPY, turnLabel } from './copy.ts'
import { TurnBlock } from './TurnBlock.ts'
import {
  buildTurnBlock,
  isTurnPartial,
  turnCandidates,
  type TurnBlockModel,
  type TurnGroup,
  type TurnStripSession,
} from './model.ts'
import { effectiveSelection, moveSelection, sameSelection, selectionKey, type Selection } from './selection.ts'
import { sessionTitle } from './privacy.ts'

export interface TurnStripProps {
  t: Translator
  /** 已按范围组织好的分组（`buildTurnGroups` 的产物）。 */
  groups: readonly TurnGroup[]
  /** 会话列表（`all` 范围下给分组标签找标题用；其余范围可省）。 */
  sessions?: readonly TurnStripSession[]
  /** 当前选择（由上层 reducer 管）。 */
  selected: Selection
  /** hover 预览（由上层 reducer 管）。 */
  preview: Selection | null
  /** hover 关联高亮（例如悬停某文件时，它被哪些轮次碰过）。 */
  relatedKeys?: ReadonlySet<string> | null
  onPreview: (target: Selection | null) => void
  onSelect: (target: Selection) => void
  onDoubleClick?: (target: Selection) => void
  /** 空白处点击 = 取消选择（检查器回到工作区概览）。 */
  onClearSelection?: () => void
  /** Esc：交给上层逐层退出（轮次带自己不做决定）。 */
  onEscape?: () => void
  /** 未结束轮次的"进行中"时长基准。 */
  now?: number
  privacyMode?: boolean
  loading?: boolean
  emptyLabel?: string
  testId?: string
  className?: string
}

export function TurnStrip(props: TurnStripProps): React.ReactElement {
  const { t } = props
  const groups = props.groups
  const candidates = React.useMemo(() => turnCandidates(groups), [groups])
  const current = effectiveSelection({ selected: props.selected, preview: props.preview, inspectorOpen: false })
  const currentIndex = candidates.findIndex((candidate) => sameSelection(candidate, current))
  const selectedIndex = candidates.findIndex((candidate) => sameSelection(candidate, props.selected))
  const runningCount = React.useMemo(() => {
    let count = 0
    for (const group of groups) {
      for (const turn of group.turns) {
        if (isTurnPartial(turn, { sessionRunning: group.running, sessionPartial: group.partial })) count += 1
      }
    }
    return count
  }, [groups])

  // roving tabindex：Tab 的进入点（只影响焦点，不是选择状态）。
  const [focusIndex, setFocusIndex] = React.useState<number>(-1)
  const containerRef = React.useRef<HTMLDivElement | null>(null)
  const movedByKey = React.useRef(false)
  const tabbableIndex =
    focusIndex >= 0 && focusIndex < candidates.length ? focusIndex : selectedIndex >= 0 ? selectedIndex : 0

  // 方向键移动后把真实焦点挪到目标块（焦点可见 = A42-4）。
  React.useEffect(() => {
    if (!movedByKey.current) return
    movedByKey.current = false
    if (focusIndex < 0) return
    const root = containerRef.current
    if (root === null) return
    const blocks = root.querySelectorAll<HTMLElement>('[role="option"]')
    const target = blocks[focusIndex]
    if (target !== undefined) target.focus()
  }, [focusIndex])

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const key = event.key
    if (key === 'Escape') {
      // 只上报，不 preventDefault：上层知道这一层有没有可退的（T09 关 tab/modal 走同一路径）。
      props.onEscape?.()
      return
    }
    const anchor = currentIndex >= 0 ? candidates[currentIndex] : null
    if (key === 'Enter' || key === ' ') {
      const target = anchor ?? candidates[0]
      if (target === undefined) return
      event.preventDefault()
      props.onSelect(target)
      return
    }
    const isArrow =
      key === 'ArrowRight' || key === 'ArrowLeft' || key === 'ArrowDown' || key === 'ArrowUp'
    if (!isArrow && key !== 'Home' && key !== 'End') return
    if (candidates.length === 0) return
    event.preventDefault()
    const direction: 1 | -1 | 'first' | 'last' =
      key === 'Home' ? 'first' : key === 'End' ? 'last' : key === 'ArrowRight' || key === 'ArrowDown' ? 1 : -1
    const moved = moveSelection(candidates, anchor, direction)
    if (moved === null) return
    movedByKey.current = true
    setFocusIndex(moved.index)
    props.onPreview(moved.target)
  }

  const totalTurns = candidates.length
  let body: React.ReactNode
  if (props.loading === true) {
    body = React.createElement(LoadingState, { label: t('state.loadingDetail'), lines: 2, testId: 'turn-strip-loading' })
  } else if (totalTurns === 0) {
    body = React.createElement(EmptyState, {
      title: props.emptyLabel ?? turnLabel(TURN_COPY.empty, t('state.emptyWorkspace'), t),
      testId: 'turn-strip-empty',
    })
  } else {
    const privacy = props.privacyMode === true
    body = React.createElement(
      'div',
      {
        className: 'threadline-turn-groups',
        'data-role': 'turn-groups-wrap',
      },
      groups.map((group, groupIndex) => {
        const sessionRow = props.sessions?.find((session) => session.id === group.sessionId)
        const groupLabel = sessionTitle(
          { sessionId: group.sessionId, ...(group.title === undefined ? {} : { title: group.title }) },
          groupIndex,
          privacy,
          t,
        )
        const listbox = React.createElement(
          'div',
          {
            role: 'listbox',
            'aria-label': groupLabel,
            'aria-orientation': 'horizontal',
            'aria-multiselectable': 'false',
            className: 'threadline-turn-group-list',
          },
          group.turns.map((turn) => {
            const model: TurnBlockModel = buildTurnBlock(turn, {
              sessionId: group.sessionId,
              sessionRunning: group.running,
              sessionPartial: group.partial,
              ...(props.now === undefined ? {} : { now: props.now }),
              t,
            })
            const index = candidates.findIndex((candidate) => sameSelection(candidate, model.selection))
            const isSelected = sameSelection(model.selection, props.selected)
            return React.createElement(TurnBlock, {
              key: selectionKey(model.selection),
              model,
              selected: isSelected,
              preview: !isSelected && sameSelection(model.selection, props.preview),
              related: props.relatedKeys !== null && props.relatedKeys !== undefined && props.relatedKeys.has(selectionKey(model.selection)),
              focusable: index >= 0 && index === tabbableIndex,
              onPreview: (target) => props.onPreview(target === null ? null : target.selection),
              onSelect: (target) => props.onSelect(target.selection),
              ...(props.onDoubleClick === undefined
                ? {}
                : { onDoubleClick: (target: TurnBlockModel) => props.onDoubleClick?.(target.selection) }),
              onFocusBlock: (target: TurnBlockModel) => props.onPreview(target.selection),
            })
          }),
        )
        return React.createElement(
          'div',
          {
            key: group.sessionId,
            className: 'threadline-turn-group',
            'data-session': group.sessionId,
            'data-group-index': String(groupIndex),
          },
          React.createElement(
            'span',
            {
              className: 'threadline-turn-group-label',
              'data-role': 'group-label',
            },
            groupLabel + (sessionRow?.archived === true ? ' · ' + t('session.archived') : ''),
          ),
          listbox,
        )
      }),
    )
  }

  return React.createElement(
    'div',
    {
      className: ['threadline-turn-strip', props.className].filter(Boolean).join(' '),
      'data-testid': props.testId ?? 'turn-strip',
      'data-turn-count': String(totalTurns),
      'data-running-count': String(runningCount),
      ref: containerRef,
      onKeyDown,
      // 不在这里清预览：从轮次块移到左图看状态时，预览需要保持（由入口的 layout mouseleave 清）。
      onBlur: (event: React.FocusEvent<HTMLDivElement>) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) props.onPreview(null)
      },
      onClick: (event: React.MouseEvent<HTMLDivElement>) => {
        if (event.target === event.currentTarget) props.onClearSelection?.()
      },
    },
    body,
  )
}
