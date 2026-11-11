/*
 * shell/Header.ts —— 顶部 header：范围 chip / 覆盖率胶囊位 / 右侧动作。
 *
 * D-35（用户反馈）：**删除**左侧「脉络 + 工作区名」那一行 —— 它单独占一行、又和下面卡片里的
 * 标题重复，看起来"很丑"。工作区名不再在 header 里出现，而是融进下方卡片（右栏面包屑的根段
 * 与左图卡片标题旁的小字），信息不丢、但不再占独立一行。
 *
 * 因此现在 header 只剩两类内容：
 * 1. 时间范围 chip（它与图/卡片共用同一窗口，必须常驻可点）；
 * 2. 覆盖率胶囊与右侧只读动作。
 *
 * 保留 `workspaceName` prop 是为了**可访问名**（aria-label）—— 读屏仍能知道当前工作区，
 * 只是视觉上不再单列一行。
 */
import * as React from 'react'
import { Chip } from '../common/index.ts'
import type { Translator } from '../../locale/index.ts'
import { RANGE_KEYS, SHELL_REGIONS, type RangeKey } from './types.ts'

export interface HeaderProps {
  t: Translator
  /** 工作区名：只用于读屏（aria-label），不再视觉渲染成独立一行。 */
  workspaceName: string
  range: RangeKey
  onRangeChange?: (range: RangeKey) => void
  /** 覆盖率胶囊（ProgressPill 实例）或 null。 */
  coverageSlot?: React.ReactNode
  /** header 右侧额外动作（例如隐私菜单），只读操作。 */
  actionsSlot?: React.ReactNode
}

export function Header(props: HeaderProps): React.ReactElement {
  const chips = RANGE_KEYS.map((key) =>
    React.createElement(Chip, {
      key,
      label: props.t(key),
      active: props.range === key,
      onClick: props.onRangeChange ? () => props.onRangeChange?.(key) : undefined,
      testId: 'range-' + key,
    }),
  )
  /* 读屏可访问名里带工作区；空名字时退回产品名（不伪造工作区）。 */
  const accessibleLabel =
    props.workspaceName === ''
      ? props.t('tab.title')
      : props.t('tab.title') + ' · ' + props.workspaceName
  return React.createElement(
    'header',
    {
      className: 'threadline-header',
      'data-region': SHELL_REGIONS.header,
      'aria-label': accessibleLabel,
      /* 视觉上不再渲染品牌行；标记出来便于样式与验收断言。 */
      'data-header-brand': 'none',
    },
    React.createElement(
      'div',
      { className: 'threadline-range', role: 'group', 'aria-label': props.t('tab.label') },
      ...chips,
    ),
    React.createElement(
      'div',
      { className: 'threadline-header-end' },
      props.coverageSlot ?? null,
      props.actionsSlot ?? null,
    ),
  )
}
