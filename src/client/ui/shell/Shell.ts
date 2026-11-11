/*
 * shell/Shell.ts —— 「脉络」tab 的外壳（33 §2：脉络 2.0 版式）。
 *
 * 布局（单一滚动，全 8px 网格）：
 *   header 56px（sticky）→ Now strip 36px（条件）→ 主区 grid：
 *     左列（sticky）= 文件关系图 + 时间轴 48px + 轮次带 92/40px
 *     右列（随页面滚动）= 目录卡片两列
 *
 * 边界：
 * - 本文件只做布局；不实现图/轮次/卡片业务（T31 各组件负责）；
 * - 没有检查器、没有遮罩、没有 modal；
 * - 响应式 100% 由 base.css 的容器查询驱动（.threadline-app 是 inline-size 容器）；
 * - 挂载在宿主的容器里，不 append 到 body、不改 app 根；卸载由入口的 disposer 负责。
 */
import * as React from 'react'
import { createTranslator, DEFAULT_LOCALE, type Locale, type Translator } from '../../locale/index.ts'
import { Header } from './Header.ts'
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
  /** header 右侧只读动作（列表视图 / 隐私模式等）。 */
  headerActionsSlot?: React.ReactNode
  /** Now strip：null / 省略 = 不渲染（没有 running 会话）。 */
  nowStrip?: NowStripModel | null
  /** 左列：文件关系图（33 §3）。 */
  graphSlot?: React.ReactNode
  /** 左列：时间轴（48px）。 */
  timelineSlot?: React.ReactNode
  /** 左列：时间轴区域内的关系证据覆盖层（受控；null = 不显示）。 */
  timelineEvidenceSlot?: React.ReactNode
  /** 左列：轮次带标题（locale）。 */
  turnStripTitle?: string
  turnStripCollapsed?: boolean
  onTurnStripToggle?: () => void
  turnStripHeadSlot?: React.ReactNode
  turnStripSlot?: React.ReactNode
  /** 右列：目录卡片两列（33 §2）。 */
  railSlot?: React.ReactNode
  /** 宿主是否偏好减少动效（挂到插件根，供样式层取消位移）。 */
  reducedMotion?: boolean
  className?: string
  testId?: string
}

export function ThreadlineShell(props: ThreadlineShellProps): React.ReactElement {
  const locale: Locale = props.locale ?? DEFAULT_LOCALE
  const t: Translator = React.useMemo(() => createTranslator(locale), [locale])

  const leftColumn = React.createElement(
    'section',
    { className: 'threadline-left', 'data-region': SHELL_REGIONS.map, 'data-threadline-left': '' },
    React.createElement('div', { className: 'threadline-graph-slot', 'data-threadline-graph-slot': '' }, props.graphSlot ?? null),
    React.createElement(TimelineSlot, {
      testId: 'timeline',
      ...(props.timelineEvidenceSlot === undefined ? {} : { evidenceSlot: props.timelineEvidenceSlot }),
    }, props.timelineSlot ?? null),
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
  )

  const rail = React.createElement(
    'aside',
    { className: 'threadline-rail', 'data-region': SHELL_REGIONS.rail, 'data-threadline-rail': '' },
    props.railSlot ?? null,
  )

  return React.createElement(
    'div',
    {
      className: ['threadline-app', props.className].filter(Boolean).join(' '),
      'data-threadline-app': '',
      'data-locale': locale,
      /* 插件根上的 reduced-motion 标记：样式层用它取消位移类动效
       * （tokens.css 只能把时长归零，transform 仍会瞬移到位）。 */
      'data-reduced-motion': props.reducedMotion === true ? 'true' : 'false',
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
      React.createElement('div', { className: 'threadline-layout', 'data-threadline-layout': '' }, leftColumn, rail),
    ),
  )
}
