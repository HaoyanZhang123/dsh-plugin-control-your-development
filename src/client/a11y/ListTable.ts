/*
 * a11y/ListTable.ts —— 列表视图（文件表 / 轮次表）的渲染（03 §4.3 / §15；06 A44-2）。
 *
 * 为什么需要它：星图不是唯一入口。键盘用户与读屏用户必须能：
 * - 用 Tab 进入表格，方向键在行间移动，Enter 选中（点亮星图对应节点/轮次），Esc 逐层退出；
 * - 点列头排序（`aria-sort` 明确当前排序）；
 * - 选中变化时由 `aria-live="polite"` 节流播报（不刷屏）。
 *
 * 语义用原生 `<table>`（浏览器原生给 table/row/columnheader/cell 语义），再显式标注
 * `role` / `aria-sort` / `aria-selected`，静态标记里能直接断言。
 *
 * 样式不在本目录（`src/client/styles/**` 由 T06 交付、T10 不改），类名留给 owner 挂样式：
 * `.threadline-list` / `.threadline-table` / `.threadline-table-row`。
 */
import * as React from 'react'
import type { Translator } from '../locale/index.ts'
import type { PrivacyMode } from '../privacy/index.ts'
import { Announcer, announcementFor, rowAriaLabel, sortAria, tableLabel } from './aria.ts'
import {
  listKeyNav,
  rowDomId,
  sortFileRows,
  sortTurnRows,
  type FileListRow,
  type SortKey,
  type SortState,
  type TurnListRow,
} from './listModel.ts'
import { sessionStatusKey } from '../ui/turns/index.ts'

const h = React.createElement

/** 表格列定义（列头文字全部来自 locale；排序键显式给出）。 */
interface Column {
  key: string
  label: string
  sortKey?: SortKey
  numeric?: boolean
}

function fileColumns(t: Translator): Column[] {
  return [
    { key: 'path', label: t('inspector.file'), sortKey: 'label' },
    { key: 'ops', label: t('inspector.ops'), sortKey: 'ops', numeric: true },
    { key: 'firstAt', label: t('inspector.firstSeen'), sortKey: 'firstAt' },
    { key: 'lastAt', label: t('inspector.lastTouched'), sortKey: 'lastAt' },
  ]
}

function turnColumns(t: Translator): Column[] {
  return [
    { key: 'turn', label: t('inspector.turn'), sortKey: 'turn' },
    { key: 'files', label: t('inspector.file'), sortKey: 'files', numeric: true },
    { key: 'commands', label: t('inspector.commands'), sortKey: 'commands', numeric: true },
    { key: 'errors', label: t('inspector.errors'), sortKey: 'errors', numeric: true },
  ]
}

/** 时长文案（毫秒 → locale 模板；未知返回 null，不伪造成 0 秒）。 */
export function formatDuration(ms: number | null, t: Translator): string | null {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return null
  const totalSeconds = Math.round(ms / 1000)
  if (totalSeconds < 60) return t('turns.durationSec', { s: totalSeconds })
  if (totalSeconds < 3600) {
    return t('turns.durationMin', { m: Math.floor(totalSeconds / 60), s: totalSeconds % 60 })
  }
  return t('turns.durationHour', { h: Math.floor(totalSeconds / 3600), m: Math.floor((totalSeconds % 3600) / 60) })
}

export interface ListViewCommonProps {
  t: Translator
  mode: PrivacyMode
  sort: SortState
  onSort?: (next: SortState) => void
  selectedKey?: string | null
  /** Enter/点击：选中（点亮星图对应节点/轮次）。 */
  onSelect?: (key: string | null) => void
  /** Esc：清掉选择（逐层退出的一层）。 */
  onEscape?: () => void
  /** 该行「在图中聚焦」的动作；不传就不渲染动作列。 */
  onFocusInMap?: (key: string) => void
  testId?: string
}

export interface FileListViewProps extends ListViewCommonProps {
  kind: 'files'
  rows: readonly FileListRow[]
}

export interface TurnListViewProps extends ListViewCommonProps {
  kind: 'turns'
  rows: readonly TurnListRow[]
}

export type ListViewProps = FileListViewProps | TurnListViewProps

interface RowModel {
  key: string
  ariaLabel: string
  cells: string[]
  /** 文件表首列：主名 + 次级目录（turn 表不用）。 */
  primary?: string
  secondary?: string
  /** 首列完整展示路径（已掩码），只用于 title。 */
  title?: string
}

function turnStatusText(row: TurnListRow, t: Translator): string {
  return t(sessionStatusKey(row.status))
}

/** Q6：日期 + 时间（本地时区）——只显示 HH:MM 会让“按首次/最近排序”看起来像乱序。 */
export function dateTimeOfDay(at: number | null): string {
  if (at === null || !Number.isFinite(at) || at <= 0) return '—'
  const date = new Date(at)
  const pad = (value: number): string => (value < 10 ? '0' + value : String(value))
  return pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes())
}

/** 文件路径拆成「主名 + 目录」两段；displayPath 已是掩码后的，隐私模式不会带目录。 */
function splitDisplayPath(displayPath: string, label: string): { primary: string; secondary: string } {
  if (displayPath === label) return { primary: label, secondary: '' }
  if (displayPath.endsWith('/' + label)) {
    return { primary: label, secondary: displayPath.slice(0, displayPath.length - label.length - 1) }
  }
  return { primary: displayPath, secondary: '' }
}

function toRowModels(props: ListViewProps): RowModel[] {
  const { t } = props
  if (props.kind === 'files') {
    const rows = sortFileRows(props.rows, props.sort)
    return rows.map((row) => {
      const split = splitDisplayPath(row.displayPath, row.label)
      return {
        key: row.key,
        ariaLabel: rowAriaLabel('files', row.label, t('inspector.ops') + ' ' + String(row.ops), t),
        cells: [row.displayPath, String(row.ops), dateTimeOfDay(row.firstAt), dateTimeOfDay(row.lastAt)],
        primary: split.primary,
        secondary: split.secondary,
        title: row.displayPath,
      }
    })
  }
  const rows = sortTurnRows(props.rows, props.sort)
  return rows.map((row) => {
    const duration = formatDuration(row.durationMs, t)
    const status = turnStatusText(row, t)
    return {
      key: row.key,
      ariaLabel: rowAriaLabel('turns', row.label, status + (duration === null ? '' : ' · ' + duration), t),
      cells: [row.label + ' · ' + status, String(row.files), String(row.commands), String(row.errors)],
    }
  })
}

/**
 * 列表视图。键盘模型：
 * - 行是 roving tabindex 的焦点目标（只有当前行可 Tab 到）；
 * - ↑/↓、Home/End、PageUp/PageDown 移动；Enter/Space 选中；Esc 清选择；
 * - 列头是真正的 button（Tab 可达），`aria-sort` 指示排序。
 */
export function ListView(props: ListViewProps): React.ReactElement {
  const { t } = props
  const mode = props.mode
  const rowModels = toRowModels(props)
  const columns = props.kind === 'files' ? fileColumns(t) : turnColumns(t)
  const [activeRow, setActiveRow] = React.useState(0)
  const rowRefs = React.useRef(new Map<string, HTMLTableRowElement | null>())
  const listKind: 'files' | 'turns' = props.kind

  const activeKey = rowModels.length === 0 ? null : rowModels[Math.min(activeRow, rowModels.length - 1)].key
  const selectedKey = props.selectedKey ?? null
  const announceLabel = (() => {
    if (selectedKey === null) return null
    const row = rowModels.find((item) => item.key === selectedKey)
    return row ? announcementFor(listKind === 'files' ? 'files' : 'turns', row.cells[0], t) : null
  })()

  const focusRowAt = (index: number): void => {
    const clamped = Math.max(0, Math.min(index, rowModels.length - 1))
    setActiveRow(clamped)
    const row = rowModels[clamped]
    if (!row) return
    const element = rowRefs.current.get(row.key)
    if (element && typeof element.focus === 'function') element.focus()
  }

  const onRowKeyDown = (event: React.KeyboardEvent<HTMLTableRowElement>, index: number): void => {
    const nav = listKeyNav({ row: index, col: 0, rowCount: rowModels.length, colCount: 1, key: event.key })
    if (nav.escape) {
      event.preventDefault()
      props.onEscape?.()
      return
    }
    if (nav.activate) {
      event.preventDefault()
      const row = rowModels[index]
      props.onSelect?.(row ? (selectedKey === row.key ? null : row.key) : null)
      return
    }
    if (nav.handled && nav.row !== index) {
      event.preventDefault()
      focusRowAt(nav.row)
    }
  }

  const headerCells: React.ReactElement[] = columns.map((column) => {
    const active = props.sort.key === column.sortKey
    const sortValue = sortAria(active, props.sort.dir)
    return h(
      'th',
      {
        key: column.key,
        role: 'columnheader',
        scope: 'col',
        'aria-sort': sortValue,
        'data-column': column.key,
        'data-numeric': column.numeric === true ? 'true' : 'false',
      },
      column.sortKey === undefined
        ? column.label
        : h(
            'button',
            {
              type: 'button',
              className: 'threadline-btn threadline-focus-ring threadline-table-sort',
              'data-sort-key': column.sortKey,
              onClick: () => props.onSort?.({ key: column.sortKey as SortKey, dir: active ? (props.sort.dir === 'asc' ? 'desc' : 'asc') : 'desc' }),
            },
            column.label,
          ),
    )
  })

  if (props.onFocusInMap) {
    // fixed 布局需要真实占位的列：外层 th 留在流内，只有文字对读屏可见。
    headerCells.push(
      h(
        'th',
        { key: 'action', role: 'columnheader', scope: 'col', className: 'threadline-table-action-head' },
        h('span', { className: 'threadline-visually-hidden' }, t('inspector.focusInMap')),
      ),
    )
  }

  const bodyRows = rowModels.map((row, index) => {
    // 隐私模式下 DOM 属性也不能带完整路径（截图/HTML dump 同样是泄漏面）
    const domKey = mode === 'hidden' ? 'r' + String(index) : row.key
    const isSelected = selectedKey === row.key
    const isActive = index === Math.min(activeRow, Math.max(0, rowModels.length - 1))
    const cells: React.ReactElement[] = row.cells.map((text, cellIndex) => {
      const numeric = columns[cellIndex]?.numeric === true
      if (cellIndex === 0 && row.primary !== undefined) {
        // Q6：首列两行——主名常显，目录次级弱化；完整（掩码后）路径放 title。
        return h(
          'td',
          {
            key: 'c0',
            role: 'cell',
            className: 'threadline-table-file',
            ...(row.title === undefined ? {} : { title: row.title }),
          },
          h('span', { className: 'threadline-table-file-name' }, row.primary),
          row.secondary === undefined || row.secondary === ''
            ? null
            : h('span', { className: 'threadline-table-file-dir' }, row.secondary),
        )
      }
      return h(
        'td',
        {
          key: 'c' + String(cellIndex),
          role: 'cell',
          'data-numeric': numeric ? 'true' : 'false',
          className: cellIndex === 0 ? 'threadline-ellipsis' : undefined,
        },
        text,
      )
    })
    if (props.onFocusInMap) {
      cells.push(
        h(
          'td',
          { key: 'action', role: 'cell' },
          h(
            'button',
            {
              type: 'button',
              className: 'threadline-btn threadline-focus-ring',
              'aria-label': t('inspector.focusInMap') + ' · ' + row.cells[0],
              onClick: () => props.onFocusInMap?.(row.key),
            },
            t('inspector.focusInMap'),
          ),
        ),
      )
    }
    return h(
      'tr',
      {
        key: row.key,
        ref: (element: HTMLTableRowElement | null) => {
          rowRefs.current.set(row.key, element)
        },
        role: 'row',
        id: rowDomId(listKind, domKey),
        className: 'threadline-table-row',
        'aria-selected': isSelected,
        'aria-label': row.ariaLabel,
        tabIndex: isActive ? 0 : -1,
        'data-row-key': domKey,
        onClick: () => props.onSelect?.(isSelected ? null : row.key),
        onFocus: () => setActiveRow(index),
        onKeyDown: (event: React.KeyboardEvent<HTMLTableRowElement>) => onRowKeyDown(event, index),
      },
      ...cells,
    )
  })

  return h(
    'div',
    {
      className: 'threadline-list',
      'data-region': 'list',
      'data-list-kind': listKind,
      'data-privacy-mode': mode,
      'data-testid': props.testId,
    },
    h(
      'table',
      {
        role: 'table',
        className: 'threadline-table',
        'aria-label': tableLabel(listKind === 'files' ? 'files' : 'turns', t),
        'aria-colcount': columns.length + (props.onFocusInMap ? 1 : 0),
        'aria-rowcount': rowModels.length + 1,
      },
      h('thead', null, h('tr', { role: 'row' }, ...headerCells)),
      h('tbody', null, ...bodyRows),
    ),
    h(Announcer, { message: announceLabel, testId: 'list-announcer' }),
  )
}

/** 文件表（便捷包装，T09 直接用）。 */
export function FileListView(props: Omit<FileListViewProps, 'kind'>): React.ReactElement {
  return h(ListView, { ...props, kind: 'files' })
}

/** 轮次表（便捷包装）。 */
export function TurnListView(props: Omit<TurnListViewProps, 'kind'>): React.ReactElement {
  return h(ListView, { ...props, kind: 'turns' })
}
