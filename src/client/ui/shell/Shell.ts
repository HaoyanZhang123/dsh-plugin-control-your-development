/*
 * shell/Shell.ts —— 「脉络」tab 的外壳（03 §3）。
 *
 * 布局（自上而下，全部 8px 网格）：
 *   header 56px → Now strip 36px（条件）→ 主区（星图槽 + 检查器槽）→ 时间轴 48px → 轮次带 92/40px
 *
 * 边界：
 * - 本文件只做布局与"打开/关闭"这类只读交互，不实现星图/轮次/检查器业务（T07/T08）；
 * - 响应式 100% 由 base.css 的容器查询驱动（.threadline-app 是 inline-size 容器），
 *   JS 里没有任何 window.innerWidth 判断 —— 宿主面板宽度变化时布局自动跟随；
 * - 挂载在宿主给的容器里，不 append 到 body、不改 app 根；卸载由 T09 的 ctx.effect disposer 负责。
 */
import * as React from 'react'
import { createTranslator, DEFAULT_LOCALE, type Locale, type Translator } from '../../locale/index.ts'
import { Header } from './Header.ts'
import { InspectorPanel } from './InspectorPanel.ts'
import { NowStrip } from './NowStrip.ts'
import { TimelineSlot } from './TimelineSlot.ts'
import { TurnStripSlot } from './TurnStripSlot.ts'
import { DEFAULT_RANGE, SHELL_REGIONS, type RangeKey } from './types.ts'

export interface NowStripModel {
  text: string
  running?: boolean
  detail?: string
  actionLabel?: string
  onAction?: () => void
}

export interface ThreadlineShellProps {
  /** 界面语言；默认 zh（03 §16）。 */
  locale?: Locale
  /** 当前工作区名（宿主提供）。 */
  workspaceName: string
  range?: RangeKey
  onRangeChange?: (range: RangeKey) => void
  /** 覆盖率胶囊（ProgressPill 实例）。 */
  coverageSlot?: React.ReactNode
  /** header 右侧只读动作（隐私菜单等）。 */
  headerActionsSlot?: React.ReactNode
  /** Now strip：null / 省略 = 不渲染（没有 running 会话）。 */
  nowStrip?: NowStripModel | null
  /** 星图槽（T07）。 */
  mapSlot?: React.ReactNode
  /** 图例槽（左下常驻；窄容器由 Legend 自己折叠）。 */
  legendSlot?: React.ReactNode
  /** 检查器：是否打开（默认关闭；<1100px 自动变覆盖层，<600px 自动变底部 sheet）。 */
  inspectorOpen?: boolean
  onInspectorClose?: () => void
  /** 检查器标题（T08 给；无选择时是工作区概览）。 */
  inspectorTitle?: string
  /** 检查器内容（T08）。 */
  inspectorSlot?: React.ReactNode
  /** 时间轴槽（T07）。 */
  timelineSlot?: React.ReactNode
  /** 轮次带标题（locale）。 */
  turnStripTitle?: string
  turnStripCollapsed?: boolean
  onTurnStripToggle?: () => void
  turnStripHeadSlot?: React.ReactNode
  turnStripSlot?: React.ReactNode
  className?: string
  testId?: string
}

export function ThreadlineShell(props: ThreadlineShellProps): React.ReactElement {
  const locale: Locale = props.locale ?? DEFAULT_LOCALE
  const t: Translator = React.useMemo(() => createTranslator(locale), [locale])
  const inspectorOpen = props.inspectorOpen === true
  const inspectorTitle = props.inspectorTitle ?? t('inspector.session')
  const closeLabel = t('ui.close')

  // Esc 关闭覆盖层 / sheet（宽容器下关的是内联栏，键盘用户同样可用）。
  const { onInspectorClose } = props
  React.useEffect(() => {
    if (!inspectorOpen || !onInspectorClose) return undefined
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onInspectorClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [inspectorOpen, onInspectorClose])

  // 关闭后把焦点还给打开它的元素（焦点不留在消失的节点里）。
  const restoreRef = React.useRef<HTMLElement | null>(null)
  React.useEffect(() => {
    if (inspectorOpen) {
      restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      return
    }
    const restore = restoreRef.current
    restoreRef.current = null
    if (restore && restore.isConnected && typeof restore.focus === 'function') restore.focus()
  }, [inspectorOpen])

  const mapArea = React.createElement(
    'div',
    { className: 'threadline-map-area', 'data-region': SHELL_REGIONS.map },
    React.createElement('div', { className: 'threadline-map-slot', 'data-threadline-map-slot': '' }, props.mapSlot ?? null),
    props.legendSlot
      ? React.createElement('div', { className: 'threadline-legend-wrap' }, props.legendSlot)
      : null,
  )

  const mask = inspectorOpen
    ? React.createElement('button', {
        type: 'button',
        className: 'threadline-inspector-mask',
        'aria-label': closeLabel,
        tabIndex: -1,
        'data-inspector-open': 'true',
        onClick: onInspectorClose,
      })
    : null

  const inspector = inspectorOpen
    ? React.createElement(
        InspectorPanel,
        { title: inspectorTitle, closeLabel, onClose: onInspectorClose, open: true, testId: 'inspector' },
        props.inspectorSlot ?? null,
      )
    : null

  return React.createElement(
    'div',
    {
      className: ['threadline-app', props.className].filter(Boolean).join(' '),
      'data-threadline-app': '',
      'data-locale': locale,
      'data-testid': props.testId,
    },
    React.createElement(
      'div',
      { className: 'threadline-shell', 'data-threadline-shell': '' },
      React.createElement(Header, {
        t,
        workspaceName: props.workspaceName,
        range: props.range ?? DEFAULT_RANGE,
        onRangeChange: props.onRangeChange,
        coverageSlot: props.coverageSlot,
        actionsSlot: props.headerActionsSlot,
      }),
      props.nowStrip ? React.createElement(NowStrip, { ...props.nowStrip, testId: 'now-strip' }) : null,
      React.createElement(
        'div',
        {
          className: 'threadline-main',
          'data-inspector-open': inspectorOpen ? 'true' : 'false',
        },
        mapArea,
        mask,
        inspector,
      ),
      React.createElement(TimelineSlot, { testId: 'timeline' }, props.timelineSlot ?? null),
      React.createElement(
        TurnStripSlot,
        {
          title: props.turnStripTitle ?? t('inspector.turn'),
          collapsed: props.turnStripCollapsed === true,
          onToggle: props.onTurnStripToggle,
          toggleLabel: props.turnStripCollapsed === true ? t('ui.expand') : t('ui.collapse'),
          headerSlot: props.turnStripHeadSlot,
          testId: 'turn-strip',
        },
        props.turnStripSlot ?? null,
      ),
    ),
  )
}
