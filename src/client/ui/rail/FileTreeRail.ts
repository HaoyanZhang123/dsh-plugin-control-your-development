/*
 * rail/FileTreeRail.ts —— 右栏**工作区文件浏览器**（R03；07 §3；03 任务卡 R03）。
 *
 * 与旧的 `DirectoryRail`（会话触碰聚合分类）的本质差别：
 * - 数据 = **当前目录的真实 entries**（`TreeEntry[]`，来自 `data/tree.ts` 的目录树），
 *   不是"按第一段路径聚合的会话触碰目录"；根层显示工作区根下所有文件夹/文件；
 * - 导航 = 面包屑（任意段可点）+ 回退 + 更新；点目录进入下一层，文件是终端；
 * - 两种呈现 = 卡片 / 列表（同一份行数据；切换保留路径/选中/滚动）。
 *
 * 纪律（照 03 §13 / 06 A40）：
 * - 纯展示：不读数据层、不注册全局监听、不发请求（导航/刷新都是 props 回调）；
 * - 全部动作是 `<button>`（Tab 可达）+ 可读 `aria-label`；图标只做装饰（`aria-hidden`）；
 * - 头部只有图标按钮 + 面包屑，**不放大段说明文案**；
 * - 未触碰条目**不渲染** ops 徽标（不显示假 0）；文件大小未知不显示（不伪造 0 B）；
 * - loading **不整块空白**：保留旧内容 + 顶部内联细进度；
 * - 键盘：Tab 进入，↑/↓/Home/End/PageUp/PageDown 移动，Enter/Space 激活，Escape 清选择
 *   （行列状态机复用 `a11y/listModel.ts` 的 `listKeyNav`，不另写一份）；
 * - 颜色不是唯一信息：类型既用图标也用类型文字；列表有类型列。
 */
import * as React from 'react'
import { listKeyNav } from '../../a11y/listModel.ts'
import { createTranslator, DEFAULT_LOCALE, type Locale, type Translator } from '../../locale/index.ts'
import { Button } from '../common/index.ts'
import type { TreeEntry, TreeErrorCode, TreeStatus } from '../../data/index.ts'
import { FAMILY_COLOR, FILE_FAMILIES } from '../map/theme.ts'
import {
  RAIL_LIST_ROW_HEIGHT,
  RAIL_VIRTUAL_THRESHOLD,
  buildRailRows,
  computeRailWindow,
  findScrollableAncestor,
  railKeyAction,
  railRowDomId,
  railScrollMetrics,
  type RailRow,
  type RailScrollMetrics,
  type RailTouchInfo,
  type RailViewMode,
} from './model.ts'

const h = React.createElement

/* ------------------------------------------------------------------ *
 * Props（tab 接线只依赖这个形状）
 * ------------------------------------------------------------------ */

export interface FileTreeRailProps {
  /** 当前目录的工作区相对路径（`''` = 根）。 */
  currentPath: string
  /** 当前目录的 entries（数据层已排序：目录 → 文件 → other）。 */
  entries: readonly TreeEntry[]
  /** 数据层状态；`ready`/`empty` 才可能有内容。 */
  status: TreeStatus
  /** 数据源：`none` 时显示"观测不到"（不假装空文件夹）。 */
  source?: 'remote' | 'host' | 'none'
  /** 失败机器码（无文案；UI 用 locale 渲染）。 */
  errorCode?: TreeErrorCode | null
  /** listing 是否被截断（宿主/上限）。 */
  truncated?: boolean

  /** 导航到某个目录（面包屑/卡片/回退都走它）。 */
  onNavigate: (path: string) => void
  /** 回退到父目录（根层时按钮禁用）。 */
  onBack: () => void
  /** 更新当前目录（只失效当前路径）。 */
  onRefresh: () => void
  /** 选中文件（单击；文件是终端，不进入）。 */
  onSelectFile: (path: string) => void
  /** 选中文件夹（单击；**不进入**，进入由 onEnterFolder 负责）。 */
  onSelectFolder?: (path: string) => void
  /** 双击文件夹 → 进入该目录（与左图双击语义一致）。 */
  onEnterFolder?: (path: string) => void
  /** 双击打开文件（可选；不可用时只选中）。 */
  onOpenFile?: (path: string) => void
  /** 清掉文件选中（Escape / 点空白）。 */
  onClearSelection?: () => void

  /** 当前选中的文件路径（工作区相对）。 */
  selectedPath?: string | null
  /** hover 的文件路径（可选；与左图联动）。 */
  hoveredPath?: string | null
  /** hover 回调（可选；与左图联动）。 */
  onHoverFile?: (path: string | null) => void
  /** 触碰信息（key = 小写路径）；未触碰的条目不在 map 里。 */
  touched?: ReadonlyMap<string, RailTouchInfo> | null
  /** 本轮触碰的路径（可选徽标）。 */
  currentTurnPaths?: readonly string[] | null
  /** 呈现方式；不传 = 卡片。 */
  viewMode?: RailViewMode
  /** 切换呈现方式（不传则不渲染切换按钮）。 */
  onViewModeChange?: (mode: RailViewMode) => void
  /** 会话/路径标识：变化时列表回顶（切换呈现方式不回顶）。 */
  scrollKey?: string
  /** 面包屑根标签；默认 `tree.root`。 */
  rootLabel?: string
  locale?: Locale
  /** 格式化时间（ops 徽标 title 用）；不传则 title 只有次数。 */
  formatTime?: (at: number) => string
  className?: string
  testId?: string
}

/* ------------------------------------------------------------------ *
 * 小工具
 * ------------------------------------------------------------------ */

/** 类型图标（装饰；纯字符，不引入图标依赖）。 */
const KIND_GLYPH: Readonly<Record<string, string>> = {
  directory: '\u25A3',
  file: '\u25A4',
  other: '\u25CB',
}

/** 面包屑段（不含根段）。 */
export function breadcrumbSegments(path: string): Array<{ name: string; path: string }> {
  if (path === '') return []
  const parts = path.split('/').filter((part) => part !== '')
  return parts.map((name, index) => ({ name, path: parts.slice(0, index + 1).join('/') }))
}

/** 类型标签（locale key → 文案；`model.ts` 只给 key）。 */
function typeLabel(t: Translator, row: RailRow): string {
  return t(row.typeKey)
}

/** 一行的可访问名：名称 + 类型（+ 大小/ops 若有）。 */
function rowAriaLabel(t: Translator, row: RailRow, formatTime?: (at: number) => string, touch?: RailTouchInfo): string {
  const parts = [row.name, typeLabel(t, row)]
  if (row.sizeText !== null) parts.push(row.sizeText)
  if (row.ops !== null) {
    let opsText = t('tree.ops', { n: row.ops })
    if (touch?.lastAt !== undefined && formatTime !== undefined) opsText += ' \u00b7 ' + formatTime(touch.lastAt)
    parts.push(opsText)
  }
  return parts.join(' \u00b7 ')
}

/* ------------------------------------------------------------------ *
 * 头部：面包屑 + 回退 + 更新 + 卡片/列表切换
 * ------------------------------------------------------------------ */

interface RailHeadProps {
  currentPath: string
  rootLabel: string
  busy: boolean
  viewMode: RailViewMode
  onNavigate: (path: string) => void
  onBack: () => void
  onRefresh: () => void
  onViewModeChange?: (mode: RailViewMode) => void
  t: Translator
  listId: string
}

function RailHead(props: RailHeadProps): React.ReactElement {
  const { t, currentPath } = props
  const segments = breadcrumbSegments(currentPath)
  const crumbs: React.ReactNode[] = [
    h(
      'li',
      { key: 'root', className: 'tl-tree-crumb' },
      h(
        'button',
        {
          type: 'button',
          className: 'tl-tree-crumb-btn',
          'data-crumb-path': '',
          'aria-current': currentPath === '' ? 'location' : undefined,
          onClick: () => props.onNavigate(''),
        },
        props.rootLabel,
      ),
    ),
  ]
  segments.forEach((segment, index) => {
    const isLast = index === segments.length - 1
    crumbs.push(h('li', { key: 'sep-' + segment.path, className: 'tl-tree-crumb-sep', 'aria-hidden': true }, '\u203A'))
    crumbs.push(
      h(
        'li',
        { key: segment.path, className: 'tl-tree-crumb' },
        h(
          'button',
          {
            type: 'button',
            className: 'tl-tree-crumb-btn',
            'data-crumb-path': segment.path,
            title: segment.path,
            'aria-current': isLast ? 'location' : undefined,
            onClick: () => props.onNavigate(segment.path),
          },
          segment.name,
        ),
      ),
    )
  })

  return h(
    'div',
    { className: 'tl-tree-head', 'data-rail-head': 'true' },
    h(
      'nav',
      { className: 'tl-tree-crumbs', 'aria-label': t('tree.path') },
      h('ol', { className: 'tl-tree-crumb-list' }, ...crumbs),
    ),
    h(
      'div',
      { className: 'tl-tree-actions' },
      h(Button, {
        iconOnly: true,
        ariaLabel: t('tree.back'),
        title: t('tree.back'),
        variant: 'ghost',
        className: 'tl-tree-btn',
        disabled: currentPath === '',
        onClick: props.onBack,
        testId: 'rail-back',
        children: h('span', { className: 'tl-tree-glyph', 'aria-hidden': true }, '\u2191'),
      }),
      h(Button, {
        iconOnly: true,
        ariaLabel: t('tree.refresh'),
        title: t('tree.refresh'),
        variant: 'ghost',
        className: 'tl-tree-btn',
        onClick: props.onRefresh,
        testId: 'rail-refresh',
        children: h(
          'span',
          { className: 'tl-tree-glyph', 'aria-hidden': true, 'data-spinning': props.busy ? 'true' : 'false' },
          '\u21BB',
        ),
      }),
      props.onViewModeChange === undefined
        ? null
        : h(Button, {
            iconOnly: true,
            ariaLabel: props.viewMode === 'cards' ? t('tree.list') : t('tree.cards'),
            title: props.viewMode === 'cards' ? t('tree.list') : t('tree.cards'),
            variant: 'ghost',
            className: 'tl-tree-btn',
            pressed: props.viewMode === 'list',
            onClick: () => props.onViewModeChange?.(props.viewMode === 'cards' ? 'list' : 'cards'),
            testId: 'rail-view-toggle',
            children: h(
              'span',
              { className: 'tl-tree-glyph', 'aria-hidden': true, 'data-view-mode': props.viewMode },
              props.viewMode === 'cards' ? '\u2261' : '\u25A6',
            ),
          }),
    ),
  )
}

/* ------------------------------------------------------------------ *
 * 行（卡片 / 列表共用数据，只是排布不同）
 * ------------------------------------------------------------------ */

interface RowProps {
  row: RailRow
  t: Translator
  tabIndex: number
  domId: string
  variant: 'card' | 'list'
  formatTime?: (at: number) => string
  touch?: RailTouchInfo
  onActivate: (row: RailRow) => void
  onHover?: (path: string | null) => void
  onOpen?: (path: string) => void
  onEnter?: (path: string) => void
}

function RailRowView(props: RowProps): React.ReactElement {
  const { row, t, variant } = props
  const label = rowAriaLabel(t, row, props.formatTime, props.touch)
  const glyph = h(
    'span',
    { className: 'tl-tree-kind', 'data-kind': row.kind, 'aria-hidden': true },
    KIND_GLYPH[row.kind] ?? KIND_GLYPH.other,
  )
  const name = h('span', { className: 'tl-tree-name', title: row.path === '' ? '/' : row.path }, row.name)
  const type = h('span', { className: 'tl-tree-type' }, typeLabel(t, row))
  const sizeText = row.sizeText === null ? null : h('span', { className: 'tl-tree-size' }, row.sizeText)
  // 未触碰：ops 徽标**整个不渲染**（不显示假 0）。
  const opsBadge =
    row.ops === null
      ? null
      : h(
          'span',
          {
            className: 'tl-tree-ops',
            'data-ops': String(row.ops),
            title:
              props.formatTime !== undefined && props.touch?.lastAt !== undefined
                ? t('tree.ops', { n: row.ops }) + ' \u00b7 ' + props.formatTime(props.touch.lastAt)
                : t('tree.ops', { n: row.ops }),
          },
          String(row.ops),
        )
  const familyDot = h('span', {
    className: 'tl-tree-family',
    'data-family': row.family,
    style: { background: FAMILY_COLOR[row.family] },
    'aria-hidden': true,
  })
  const currentBadge = row.currentTurn ? h('span', { className: 'tl-tree-current', 'aria-hidden': true }, '\u25CF') : null

  const common = {
    type: 'button' as const,
    id: props.domId,
    className: variant === 'card' ? 'tl-tree-card' : 'tl-tree-row',
    'data-tree-row': row.path,
    'data-kind': row.kind,
    'data-selected': row.selected ? 'true' : 'false',
    'data-hover': row.hovered ? 'true' : 'false',
    'data-current-turn': row.currentTurn ? 'true' : 'false',
    // 文件是终端：data-terminal 给测试与 CSS 用（目录才是可进入的）。
    'data-terminal': row.kind === 'directory' ? 'false' : 'true',
    'aria-label': label,
    'aria-pressed': row.selected,
    tabIndex: props.tabIndex,
    title: label,
    onClick: () => props.onActivate(row),
    /* 双击：文件夹 = 进入目录；文件 = 请求宿主打开。两者与左图同一语义。 */
    onDoubleClick: () => {
      if (row.kind === 'directory') props.onEnter?.(row.path)
      else props.onOpen?.(row.path)
    },
    onMouseEnter: () => props.onHover?.(row.path),
    onMouseLeave: () => props.onHover?.(null),
    onFocus: () => props.onHover?.(row.path),
    onBlur: () => props.onHover?.(null),
  }

  if (variant === 'list') {
    return h(
      'button',
      common,
      glyph,
      name,
      type,
      sizeText,
      h('span', { className: 'tl-tree-row-tail' }, familyDot, currentBadge, opsBadge),
    )
  }
  return h(
    'button',
    common,
    h('span', { className: 'tl-tree-card-head' }, glyph, name),
    h('span', { className: 'tl-tree-card-meta' }, type, sizeText, familyDot, currentBadge),
    opsBadge === null ? null : h('span', { className: 'tl-tree-card-badges' }, opsBadge),
  )
}

/* ------------------------------------------------------------------ *
 * 状态块：空 / 错误 / 截断
 * ------------------------------------------------------------------ */

interface RailStatusProps {
  t: Translator
  status: TreeStatus
  source: 'remote' | 'host' | 'none'
  errorCode?: TreeErrorCode | null
  truncated: boolean
  entryCount: number
  onRefresh: () => void
}

/** 失败原因 → 用户可读的一句话（不暴露路径/正文）。 */
function errorText(t: Translator, code: TreeErrorCode | null | undefined, source: 'remote' | 'host' | 'none'): string {
  if (source === 'none' || code === 'no-source') return t('state.hostUnavailable')
  if (code === 'rejected-path' || code === 'root-without-cwd') return t('state.unknown')
  return t('tree.readFailed')
}

function RailStatus(props: RailStatusProps): React.ReactElement | null {
  const { t, status, source, truncated, entryCount } = props
  const nodes: React.ReactNode[] = []
  if (status === 'error') {
    nodes.push(
      h(
        'div',
        { key: 'error', className: 'tl-tree-error', role: 'alert', 'data-testid': 'rail-error' },
        h('span', { className: 'tl-tree-error-mark', 'aria-hidden': true }, '!'),
        h('span', { className: 'tl-tree-error-text' }, errorText(t, props.errorCode, source)),
        h(Button, { label: t('tree.retry'), variant: 'outline', size: 'sm', onClick: props.onRefresh, testId: 'rail-retry' }),
      ),
    )
  } else if (status === 'empty' && entryCount === 0 && !truncated) {
    nodes.push(
      h(
        'div',
        { key: 'empty', className: 'tl-tree-empty', 'data-testid': 'rail-empty' },
        h('span', { className: 'tl-tree-empty-mark', 'aria-hidden': true }, '\u25CC'),
        h('span', { className: 'tl-tree-empty-text' }, t('tree.empty')),
      ),
    )
  }
  if (truncated) {
    nodes.push(
      h(
        'div',
        { key: 'truncated', className: 'tl-tree-truncated', 'data-testid': 'rail-truncated', role: 'status' },
        t('tree.truncated', { n: entryCount }),
      ),
    )
  }
  return nodes.length === 0 ? null : h('div', { className: 'tl-tree-status' }, ...nodes)
}

/* ------------------------------------------------------------------ *
 * 主组件
 * ------------------------------------------------------------------ */

/** 右栏工作区文件浏览器（卡片 / 列表；两列网格、无内部横向滚动）。 */
export function FileTreeRail(props: FileTreeRailProps): React.ReactElement {
  const locale: Locale = props.locale ?? DEFAULT_LOCALE
  const t: Translator = React.useMemo(() => createTranslator(locale), [locale])
  const viewMode: RailViewMode = props.viewMode ?? 'cards'
  const rootLabel = props.rootLabel ?? t('tree.root')
  const listId = React.useMemo(() => 'tl-tree-body-' + (props.testId ?? 'rail'), [props.testId])

  const rows = React.useMemo(
    () =>
      buildRailRows(props.entries, {
        ...(props.touched === undefined ? {} : { touched: props.touched }),
        ...(props.currentTurnPaths === undefined ? {} : { currentTurnPaths: props.currentTurnPaths }),
        ...(props.selectedPath === undefined ? {} : { selectedPath: props.selectedPath }),
        ...(props.hoveredPath === undefined ? {} : { hoveredPath: props.hoveredPath }),
      }),
    [props.entries, props.touched, props.currentTurnPaths, props.selectedPath, props.hoveredPath],
  )

  const [rovingIndex, setRovingIndex] = React.useState(0)
  const containerRef = React.useRef<HTMLDivElement | null>(null)
  const bodyRef = React.useRef<HTMLDivElement | null>(null)
  // 列表虚拟化的滚动几何。**重要**：右栏 `.threadline-rail` 自己是滚动容器
  // （base.css: overflow-y:auto），页面不滚 —— 所以必须绑定最近的 scrollable 祖先，
  // 不能用 window.scrollY（否则右栏滚到第 300 行时窗口仍停在首屏，列表看起来"卡死"）。
  const [metrics, setMetrics] = React.useState<RailScrollMetrics>({ scrollPx: 0, offsetPx: 0, viewportHeight: 0 })

  React.useEffect(() => {
    const container = containerRef.current
    if (container === null) return undefined
    // 找滚动祖先（真实 DOM → model 的纯算法；`.threadline-rail` 就是那个 auto 容器）。
    const scroller: HTMLElement | null = findScrollableAncestor<HTMLElement>(container, {
      parentOf: (node) => node.parentElement,
      styleOf: (node) =>
        typeof globalThis.getComputedStyle === 'function'
          ? {
              overflowY: globalThis.getComputedStyle(node).overflowY,
              overflowX: globalThis.getComputedStyle(node).overflowX,
            }
          : undefined,
    })
    // 没有滚动祖先（贴片式内嵌 / 单页滚动）→ 退回 window。
    const target = (scroller ?? globalThis) as unknown as {
      addEventListener?: (type: string, listener: () => void, options?: { passive?: boolean }) => void
      removeEventListener?: (type: string, listener: () => void) => void
    }
    const read = (): void => {
      const body = bodyRef.current
      if (body === null) {
        setMetrics((previous) =>
          previous.scrollPx === 0 && previous.offsetPx === 0 && previous.viewportHeight === 0
            ? previous
            : { scrollPx: 0, offsetPx: 0, viewportHeight: 0 },
        )
        return
      }
      const bodyRect = body.getBoundingClientRect()
      const scrollerTop = scroller === null ? 0 : scroller.getBoundingClientRect().top
      const scrollTop = scroller === null ? (typeof globalThis.scrollY === 'number' ? globalThis.scrollY : 0) : scroller.scrollTop
      const scrollerHeight = scroller === null ? (typeof globalThis.innerHeight === 'number' ? globalThis.innerHeight : 0) : scroller.clientHeight
      const next = railScrollMetrics({ scrollTop, scrollerTop, scrollerHeight, bodyTop: bodyRect.top })
      setMetrics((previous) =>
        previous.scrollPx === next.scrollPx && previous.offsetPx === next.offsetPx && previous.viewportHeight === next.viewportHeight
          ? previous
          : next,
      )
    }
    read()
    if (typeof target.addEventListener !== 'function') return undefined
    target.addEventListener('scroll', read, { passive: true })
    target.addEventListener('resize', read)
    return () => {
      target.removeEventListener?.('scroll', read)
      target.removeEventListener?.('resize', read)
    }
  }, [rows.length, viewMode, props.currentPath])

  // 路径变了（进入/回退/刷新到别的目录）：roving 归零 + 焦点索引回到第一行。
  React.useEffect(() => {
    setRovingIndex(0)
  }, [props.currentPath])

  // 选中项变化：roving 索引跟随（键盘连续移动时不跳回去）。
  React.useEffect(() => {
    if (props.selectedPath === null || props.selectedPath === undefined || props.selectedPath === '') return
    const needle = props.selectedPath.toLowerCase()
    const index = rows.findIndex((row) => row.key === needle)
    if (index >= 0) setRovingIndex(index)
  }, [props.selectedPath, rows])

  // 列表虚拟化窗口：>200 行才切（卡片模式全量渲染；列表按固定行高开窗）。
  const viewWindow = React.useMemo(
    () =>
      viewMode === 'list'
        ? computeRailWindow({
            count: rows.length,
            offsetPx: metrics.offsetPx,
            scrollPx: metrics.scrollPx,
            ...(metrics.viewportHeight > 0 ? { viewportHeight: metrics.viewportHeight } : {}),
          })
        : { start: 0, end: rows.length, topPad: 0, bottomPad: 0, virtual: false, totalHeight: 0 },
    [rows.length, viewMode, metrics],
  )
  const visible = viewMode === 'list' ? rows.slice(viewWindow.start, viewWindow.end) : rows

  const activate = React.useCallback(
    (row: RailRow): void => {
      /* 单击统一 = 选中（文件与文件夹同一语义）。
       * 进入目录交给双击 / Enter 决定的 onEnterFolder，不再"点一下目录就跳走"。 */
      props.onSelectFile(row.path)
      props.onSelectFolder?.(row.path)
    },
    [props.onSelectFile, props.onSelectFolder],
  )

  const onKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>): void => {
      const action = railKeyAction(listKeyNav, { index: rovingIndex, count: rows.length, key: event.key })
      if (action.escape) {
        props.onClearSelection?.()
        event.stopPropagation()
        return
      }
      if (!action.handled) return
      event.preventDefault()
      if (action.activate) {
        const row = rows[rovingIndex]
        if (row === undefined) return
        /* 键盘：Enter/Space 选中；Shift+Enter 进入目录（与左图一致的等价路径）。 */
        if (event.shiftKey && row.kind === 'directory') props.onEnterFolder?.(row.path)
        else activate(row)
        return
      }
      if (action.nextIndex === rovingIndex) return
      setRovingIndex(action.nextIndex)
      // 焦点跟到目标行（键盘连续移动时焦点同时移动，读屏能读到）。
      const target = containerRef.current?.querySelector<HTMLElement>(`#${cssEscape(rowDomIdOf(viewMode, rows[action.nextIndex]?.path ?? ''))}`)
      target?.focus()
    },
    [rows, rovingIndex, activate, props.onClearSelection, viewMode],
  )

  const count = rows.length
  const busy = props.status === 'loading'
  const hasContent = count > 0
  const showStatus = props.status === 'empty' || props.status === 'error' || props.truncated === true

  return h(
    'div',
    {
      className: ['tl-tree', props.className].filter(Boolean).join(' '),
      'data-file-tree-rail': 'true',
      'data-view-mode': viewMode,
      'data-status': props.status,
      'data-source': props.source ?? 'remote',
      'data-row-count': String(count),
      'data-truncated': props.truncated === true ? 'true' : 'false',
      'data-testid': props.testId,
      ref: (node: HTMLDivElement | null): void => {
        containerRef.current = node
      },
    },
    h(RailHead, {
      currentPath: props.currentPath,
      rootLabel,
      busy,
      viewMode,
      onNavigate: props.onNavigate,
      onBack: props.onBack,
      onRefresh: props.onRefresh,
      ...(props.onViewModeChange === undefined ? {} : { onViewModeChange: props.onViewModeChange }),
      t,
      listId,
    }),
    // loading：保留旧内容 + 顶部内联细进度（**不整块空白/骨架**）。
    busy
      ? h(
          'div',
          { className: 'tl-tree-progress', role: 'progressbar', 'aria-label': t('tree.refresh'), 'data-testid': 'rail-progress' },
          h('span', { className: 'tl-tree-progress-bar' }),
        )
      : null,
    showStatus
      ? h(RailStatus, {
          t,
          status: props.status,
          source: props.source ?? 'remote',
          ...(props.errorCode === undefined ? {} : { errorCode: props.errorCode }),
          truncated: props.truncated === true,
          entryCount: count,
          onRefresh: props.onRefresh,
        })
      : null,
    hasContent
      ? h(
          'div',
          {
            className: 'tl-tree-body',
            id: listId,
            role: viewMode === 'list' ? 'table' : 'group',
            'aria-label': props.currentPath === '' ? rootLabel : rootLabel + ' / ' + props.currentPath,
            'aria-rowcount': viewMode === 'list' ? count : undefined,
            'data-virtualized': viewWindow.virtual ? 'true' : 'false',
            onKeyDown,
            ref: (node: HTMLDivElement | null): void => {
              bodyRef.current = node
            },
          },
          viewMode === 'list'
            ? [
                h(
                  'div',
                  { key: 'thead', className: 'tl-tree-thead', role: 'row' },
                  // 图标列与名称列必须与数据行的 grid 轨道一一对应，否则首列起点天然错位。
                  h('span', { key: 'icon', className: 'tl-tree-th', 'data-col': 'icon', role: 'columnheader', 'aria-label': t('tree.kind') }),
                  h('span', { key: 'name', className: 'tl-tree-th', 'data-col': 'name', role: 'columnheader' }, t('tree.name')),
                  h('span', { key: 'type', className: 'tl-tree-th', 'data-col': 'type', role: 'columnheader' }, t('tree.kind')),
                  h('span', { key: 'size', className: 'tl-tree-th', 'data-col': 'size', role: 'columnheader' }, t('tree.size')),
                  h('span', { key: 'ops', className: 'tl-tree-th', 'data-col': 'ops', role: 'columnheader' }, t('inspector.ops')),
                ),
                viewWindow.topPad > 0
                  ? h('div', { key: 'pad-top', className: 'tl-tree-pad', style: { blockSize: viewWindow.topPad + 'px' }, 'aria-hidden': true })
                  : null,
                h(
                  'div',
                  { key: 'rows', className: 'tl-tree-list', role: 'rowgroup' },
                  ...visible.map((row, index) => {
                    const absoluteIndex = viewWindow.start + index
                    return h(RailRowView, {
                      key: row.key,
                      row,
                      t,
                      variant: 'list',
                      tabIndex: absoluteIndex === rovingIndex ? 0 : -1,
                      domId: rowDomIdOf('list', row.path),
                      ...(props.formatTime === undefined ? {} : { formatTime: props.formatTime }),
                      ...(props.touched?.get(row.key) === undefined ? {} : { touch: props.touched.get(row.key) as RailTouchInfo }),
                      onActivate: activate,
                      ...(props.onHoverFile === undefined ? {} : { onHover: props.onHoverFile }),
                      ...(props.onOpenFile === undefined ? {} : { onOpen: props.onOpenFile }),
                      ...(props.onEnterFolder === undefined ? {} : { onEnter: props.onEnterFolder }),
                    })
                  }),
                ),
                viewWindow.bottomPad > 0
                  ? h('div', { key: 'pad-bottom', className: 'tl-tree-pad', style: { blockSize: viewWindow.bottomPad + 'px' }, 'aria-hidden': true })
                  : null,
              ]
            : visible.map((row, index) => {
                const absoluteIndex = viewWindow.start + index
                return h(RailRowView, {
                  key: row.key,
                  row,
                  t,
                  variant: 'card',
                  tabIndex: absoluteIndex === rovingIndex ? 0 : -1,
                  domId: rowDomIdOf('cards', row.path),
                  ...(props.formatTime === undefined ? {} : { formatTime: props.formatTime }),
                  ...(props.touched?.get(row.key) === undefined ? {} : { touch: props.touched.get(row.key) as RailTouchInfo }),
                  onActivate: activate,
                  ...(props.onHoverFile === undefined ? {} : { onHover: props.onHoverFile }),
                  ...(props.onOpenFile === undefined ? {} : { onOpen: props.onOpenFile }),
                  ...(props.onEnterFolder === undefined ? {} : { onEnter: props.onEnterFolder }),
                })
              }),
        )
      : null,
  )
}

/* ------------------------------------------------------------------ *
 * 内部工具
 * ------------------------------------------------------------------ */

/** 行 DOM id（prefix 区分卡片/列表；同一页面唯一）。 */
function rowDomIdOf(variant: RailViewMode, path: string): string {
  return railRowDomId(variant === 'list' ? 'row' : 'card', path)
}

/** CSS.escape 的兜底（SSR/测试环境没有 CSS 对象）。 */
function cssEscape(value: string): string {
  if (typeof globalThis.CSS !== 'undefined' && typeof globalThis.CSS.escape === 'function') {
    return globalThis.CSS.escape(value)
  }
  return value.replace(/[^a-zA-Z0-9_-]/g, '\\$&')
}

/* ------------------------------------------------------------------ *
 * 导出：常量（测试守着 CSS 一致性）
 * ------------------------------------------------------------------ */

export { RAIL_LIST_ROW_HEIGHT, RAIL_VIRTUAL_THRESHOLD, FILE_FAMILIES }
export type { RailRow, RailTouchInfo, RailViewMode }
