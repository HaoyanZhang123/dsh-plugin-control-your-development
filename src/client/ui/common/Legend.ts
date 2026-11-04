/*
 * Legend.ts —— 图例（03 §10 / §14：图例必须始终可见，窄容器折叠为「图例」按钮）。
 *
 * 折叠由容器查询决定"按钮何时出现"（base.css <1100 显示按钮），
 * 展开/收起是组件状态；宽容器下列表始终显示，不受状态影响。
 * 颜色不得单独承载信息：每一项都是「形状 + 文字」。
 */
import * as React from 'react'

/** 文件族（03 §4.1；T07 的星图复用同一套 kind）。 */
export type FileKind = 'doc' | 'code' | 'data' | 'image' | 'config' | 'other' | 'new'

export interface LegendItem {
  kind: FileKind
  label: string
}

export interface LegendProps {
  /** 标题（locale legend.title）。 */
  title: string
  items: LegendItem[]
  /** 初始展开（窄容器下才有意义）。 */
  defaultOpen?: boolean
  className?: string
  testId?: string
}

export function Legend(props: LegendProps): React.ReactElement {
  const [open, setOpen] = React.useState(props.defaultOpen === true)
  return React.createElement(
    'div',
    {
      className: ['threadline-legend', props.className].filter(Boolean).join(' '),
      'data-open': open ? 'true' : 'false',
      'data-testid': props.testId,
      role: 'group',
      'aria-label': props.title,
    },
    React.createElement(
      'button',
      {
        type: 'button',
        className: 'threadline-btn threadline-legend-toggle threadline-focus-ring',
        'aria-expanded': open,
        onClick: () => setOpen((value) => !value),
      },
      React.createElement('span', { className: 'threadline-btn-label' }, props.title),
    ),
    React.createElement(
      'ul',
      { className: 'threadline-legend-list' },
      props.items.map((item) =>
        React.createElement(
          'li',
          { key: item.kind, className: 'threadline-legend-item' },
          React.createElement('span', {
            className: 'threadline-swatch',
            'data-kind': item.kind,
            'aria-hidden': true,
          }),
          React.createElement('span', null, item.label),
        ),
      ),
    ),
  )
}
