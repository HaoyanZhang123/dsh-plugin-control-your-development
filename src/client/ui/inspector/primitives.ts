/*
 * inspector/primitives.ts —— 检查器内部的小构件（分区 / 键值行 / 列表 / 徽标 / 横幅 / 折叠）。
 *
 * 只做结构与语义，不写业务判定；样式全在 `styles/inspector.css` 的 `.threadline-app` 前缀规则里。
 * 可访问性（03 §15）：可点的一律 `button`（或 `role` 明确的元素），焦点环由 base.css 统一给；
 * 折叠入口带 `aria-expanded` / `aria-controls`，正文用 `user-select: text`（可手动选择、无复制按钮）。
 */
import * as React from 'react'

const e = React.createElement

/** 分区：小标题 + 内容。`title` 为空时不渲染标题行（规范里没有对应字段的分区）。 */
export function Section(props: {
  title?: string
  hint?: string
  children?: React.ReactNode
  testId?: string
}): React.ReactElement {
  return e(
    'section',
    { className: 'threadline-inspector-section', 'data-testid': props.testId },
    props.title !== undefined && props.title !== ''
      ? e(
          'div',
          { className: 'threadline-inspector-section-head' },
          e('h3', { className: 'threadline-inspector-section-title' }, props.title),
          props.hint !== undefined ? e('span', { className: 'threadline-inspector-section-hint' }, props.hint) : null,
        )
      : null,
    props.children ?? null,
  )
}

/** 键值行（label 左、值右；窄容器下竖排由 CSS 处理）。 */
export function Row(props: {
  label: string
  value: React.ReactNode
  mono?: boolean
  muted?: boolean
  tone?: 'danger' | 'warning'
  title?: string
  testId?: string
}): React.ReactElement {
  return e(
    'div',
    { className: 'threadline-inspector-row', 'data-testid': props.testId },
    e('span', { className: 'threadline-inspector-row-label', title: props.title }, props.label),
    e(
      'span',
      {
        className: ['threadline-inspector-row-value', props.mono === true ? 'threadline-inspector-row-value--mono' : '']
          .filter(Boolean)
          .join(' '),
        'data-muted': props.muted === true ? 'true' : 'false',
        ...(props.tone === undefined ? {} : { 'data-tone': props.tone }),
        title: props.title,
      },
      props.value,
    ),
  )
}

/** 一句说明（次要文字，如「按工具参数估算」）。 */
export function Note(props: { text: string }): React.ReactElement {
  return e('p', { className: 'threadline-inspector-note' }, props.text)
}

/** 徽标（状态 / 族 / 计数）。 */
export function Badge(props: {
  label: string
  status?: 'running' | 'aborted' | 'error' | 'unknown' | 'none'
  title?: string
  testId?: string
}): React.ReactElement {
  return e(
    'span',
    {
      className: 'threadline-inspector-badge',
      'data-status': props.status ?? 'none',
      title: props.title,
      'data-testid': props.testId,
    },
    props.label,
  )
}

/** 横幅（部分数据 / 仍在记录 / 错误提示）。 */
export function Banner(props: {
  text: string
  tone?: 'accent' | 'warning' | 'danger'
  testId?: string
}): React.ReactElement {
  return e(
    'div',
    { className: 'threadline-inspector-banner', 'data-tone': props.tone ?? 'none', role: 'status', 'data-testid': props.testId },
    props.text,
  )
}

/** 列表容器。 */
export function List(props: { children?: React.ReactNode; testId?: string }): React.ReactElement {
  return e('ul', { className: 'threadline-inspector-list', 'data-testid': props.testId }, props.children ?? null)
}

/** 列表项：可点（`button`）或纯展示（`div`）。 */
export function Item(props: {
  children?: React.ReactNode
  onClick?: () => void
  title?: string
  testId?: string
  key?: string
}): React.ReactElement {
  if (props.onClick === undefined) {
    return e('li', { className: 'threadline-inspector-listitem', title: props.title, 'data-testid': props.testId }, props.children)
  }
  return e(
    'li',
    { className: 'threadline-inspector-listitem', title: props.title, 'data-testid': props.testId },
    e(
      'button',
      { type: 'button', className: 'threadline-inspector-item', onClick: props.onClick },
      props.children,
    ),
  )
}

/** 列表项左侧内容（可省略为单行文本）。 */
export function ItemMain(props: { text: string; mono?: boolean; title?: string }): React.ReactElement {
  return e(
    'span',
    {
      className: ['threadline-inspector-item-main', props.mono === true ? 'threadline-inspector-item-main--mono' : '']
        .filter(Boolean)
        .join(' '),
      title: props.title ?? props.text,
    },
    props.text,
  )
}

/** 列表项右侧元信息（计数 / ≈行数 / 状态）。 */
export function ItemMeta(props: { text: string; tone?: 'danger' | 'unknown' }): React.ReactElement {
  return e(
    'span',
    {
      className: 'threadline-inspector-item-meta',
      ...(props.tone === undefined ? {} : { 'data-tone': props.tone }),
    },
    props.text,
  )
}

/** 折叠入口 + 折叠体（正文/命令摘要共用；**默认折叠**，用户点开才挂载内容）。 */
export function Disclosure(props: {
  summary: string
  children?: React.ReactNode
  defaultOpen?: boolean
  testId?: string
}): React.ReactElement {
  const [open, setOpen] = React.useState(props.defaultOpen === true)
  const id = React.useId()
  return e(
    'div',
    { className: 'threadline-inspector-section', 'data-open': open ? 'true' : 'false', 'data-testid': props.testId },
    e(
      'button',
      {
        type: 'button',
        className: 'threadline-inspector-disclosure',
        'aria-expanded': open,
        'aria-controls': id,
        onClick: () => setOpen((value) => !value),
      },
      e('span', { className: 'threadline-inspector-disclosure-caret', 'aria-hidden': true }, open ? '▾' : '▸'),
      e('span', null, props.summary),
    ),
    open
      ? e('div', { id }, props.children)
      : null,
  )
}

/** 只读正文块（默认折叠的容器；无复制按钮，用户可手动选择）。 */
export function BodyText(props: { text: string; testId?: string }): React.ReactElement {
  return e('pre', { className: 'threadline-inspector-body-text', tabIndex: 0, 'data-testid': props.testId }, props.text)
}

/** 动作行。 */
export function Actions(props: { children?: React.ReactNode; testId?: string }): React.ReactElement {
  return e('div', { className: 'threadline-inspector-actions', 'data-testid': props.testId }, props.children ?? null)
}

/** 细条统计（读/写/搜索/命令关联；不做大 KPI 卡）。 */
export function StatBars(props: { rows: Array<{ key: string; label: string; count: number }> }): React.ReactElement {
  const max = props.rows.reduce((value, row) => Math.max(value, row.count), 0)
  return e(
    'div',
    { className: 'threadline-inspector-stats' },
    props.rows.map((row) =>
      e(
        'div',
        { key: row.key, className: 'threadline-inspector-stat', 'data-stat': row.key },
        e('span', null, row.label),
        e(
          'span',
          { className: 'threadline-inspector-stat-bar', 'aria-hidden': true },
          e('span', {
            className: 'threadline-inspector-stat-fill',
            style: { inlineSize: (max === 0 ? 0 : Math.max(2, Math.round((row.count / max) * 100))) + '%' },
          }),
        ),
        e('span', { className: 'threadline-inspector-stat-count' }, String(row.count)),
      ),
    ),
  )
}

/** 标题块（basename + 相对路径 + 族）。 */
export function TitleBlock(props: {
  name: string
  path?: string
  familyLabel?: string
  extra?: React.ReactNode
}): React.ReactElement {
  return e(
    'div',
    { className: 'threadline-inspector-title-block' },
    e(
      'div',
      { className: 'threadline-inspector-title-line' },
      e('span', { className: 'threadline-inspector-filename', title: props.path ?? props.name }, props.name),
      props.familyLabel !== undefined ? e('span', { className: 'threadline-inspector-family' }, props.familyLabel) : null,
      props.extra ?? null,
    ),
    props.path !== undefined && props.path !== props.name
      ? e('span', { className: 'threadline-inspector-path', title: props.path }, props.path)
      : null,
  )
}

/** 小标题（分组用）。 */
export function Subhead(props: { text: string }): React.ReactElement {
  return e('span', { className: 'threadline-inspector-subhead' }, props.text)
}
