/*
 * shell/Header.ts —— 顶部 header（56px）：产品名 / 工作区名 / 范围 chip / 覆盖率胶囊位。
 *
 * 03 §3.1 的 header 只有这四类内容；不放一级导航、不放 KPI、不放任何运行控制。
 * 窄容器下范围 chip 折行（base.css 的容器查询负责），这里只管结构。
 */
import * as React from 'react'
import { Chip } from '../common/index.ts'
import type { Translator } from '../../locale/index.ts'
import { RANGE_KEYS, SHELL_REGIONS, type RangeKey } from './types.ts'

export interface HeaderProps {
  t: Translator
  /** 工作区名（来自宿主；不把空名字替换成假名字）。 */
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
  return React.createElement(
    'header',
    {
      className: 'threadline-header',
      'data-region': SHELL_REGIONS.header,
      'aria-label': props.t('tab.title'),
    },
    React.createElement(
      'div',
      { className: 'threadline-header-start' },
      React.createElement('span', { className: 'threadline-brand' }, props.t('app.name')),
      React.createElement(
        'span',
        { className: 'threadline-workspace', title: props.workspaceName },
        props.workspaceName,
      ),
    ),
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
