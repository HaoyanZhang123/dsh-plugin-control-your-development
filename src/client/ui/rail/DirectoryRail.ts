/*
 * rail/DirectoryRail.ts —— 右栏目录卡片（33 §2/§4；两列、无内部滚动）。
 *
 * 卡片内容沿用 1.0 的可读设计：目录名（ellipsis + title 全名）、「本轮 N」徽章、计数 pill、
 * meta（{ops} 次操作 · 最近 {time}）、5 族色条、前 3 个最活跃文件（族色点 + basename + ops）。
 * 点击卡片 = 切换左图目录；本轮视图里未涉及目录降透明（`data-dim`）。
 *
 * 纯展示：不读数据层、不注册全局监听；卡片是 `<button>`，整卡可点、Tab 可达。
 */
import * as React from 'react'
import type { FileNode } from '../../../shared/events/index.ts'
import { createTranslator, DEFAULT_LOCALE, type Locale, type Translator } from '../../locale/index.ts'
import { EmptyState } from '../common/index.ts'
import { FAMILY_COLOR, FILE_FAMILIES } from '../map/theme.ts'
import { buildDirectoryCards, type DirectoryCard } from './directories.ts'

const h = React.createElement

export interface DirectoryRailProps {
  /** 全部文件节点（卡片聚合按全部 nodes，不受图上限影响）。 */
  nodes: readonly FileNode[]
  /** 当前选中目录（图上高亮；空串 = 根目录）。 */
  selectedKey: string | null
  /** hover 预览的目录（不改变选中）。 */
  hoveredKey?: string | null
  /** hover 关联高亮（例如悬停某文件时它所属的目录）。 */
  relatedKeys?: ReadonlySet<string> | null
  /** 本轮涉及到的目录键集合；非 null 时未涉及的卡片降透明。 */
  activeKeys?: ReadonlySet<string> | null
  /** 当前轮次影响的文件（「本轮 N」徽章）。 */
  currentTurnPaths?: readonly string[]
  onSelect: (key: string) => void
  onHover?: (key: string | null) => void
  locale?: Locale
  formatTime: (at: number) => string
  testId?: string
}

const GRAPH_CARD_TOP = 3

function RailCard(props: {
  card: DirectoryCard
  selected: boolean
  hovered: boolean
  related: boolean
  dim: boolean
  formatTime: (at: number) => string
  onSelect: (key: string) => void
  onHover?: (key: string | null) => void
  t: Translator
}): React.ReactElement {
  const { card, selected, hovered, related, dim, formatTime, onSelect, onHover, t } = props
  const time = formatTime(card.lastAt).replace(/ /g, '\u00a0').replace(/-/g, '\u2011')
  const meta = t('map.clusterMeta', { ops: card.totalOps, time })
  const ariaLabel = card.label + ' · ' + t('map.clusterCount', { count: card.count }) + ' · ' + meta
  return h(
    'button',
    {
      type: 'button',
      className: 'tl-rail-card',
      'data-directory-card': card.key,
      'data-selected': selected ? 'true' : 'false',
      'data-hover': hovered ? 'true' : 'false',
      'data-related': related ? 'true' : 'false',
      'data-dim': dim ? 'true' : 'false',
      title: card.label + ' · ' + meta,
      'aria-label': ariaLabel,
      'aria-pressed': selected,
      onClick: () => onSelect(card.key),
      onMouseEnter: () => onHover?.(card.key),
      onFocus: () => onHover?.(card.key),
      onBlur: () => onHover?.(null),
    },
    h(
      'span',
      { className: 'tl-rail-card-head' },
      h('span', { className: 'tl-rail-card-name', title: card.label }, card.label),
      card.currentCount > 0
        ? h('span', { className: 'tl-rail-card-badge', 'data-current-badge': 'true' }, t('map.clusterCurrent', { n: card.currentCount }))
        : null,
      h('span', { className: 'tl-rail-card-count', title: t('inspector.file') }, String(card.count)),
    ),
    h('span', { className: 'tl-rail-card-meta' }, meta),
    h(
      'span',
      { className: 'tl-rail-card-mix', 'aria-hidden': true },
      ...FILE_FAMILIES.map((family) => {
        const slot = card.families.find((item) => item.family === family)
        const count = slot === undefined ? 0 : slot.count
        if (count <= 0) return null
        return h('span', {
          key: family,
          className: 'tl-rail-card-seg',
          'data-family': family,
          style: { flexGrow: count, flexBasis: 0, background: FAMILY_COLOR[family] },
        })
      }),
    ),
    h(
      'span',
      { className: 'tl-rail-card-files' },
      ...card.topFiles.slice(0, GRAPH_CARD_TOP).map((file) =>
        h(
          'span',
          { key: file.path, className: 'tl-rail-card-file' },
          h('span', { className: 'tl-rail-card-dot', 'data-family': file.family, style: { background: FAMILY_COLOR[file.family] }, 'aria-hidden': true }),
          h('span', { className: 'tl-rail-card-file-name', title: file.path }, file.name),
          h('span', { className: 'tl-rail-card-file-ops', title: t('inspector.ops') }, String(file.ops)),
        ),
      ),
    ),
  )
}

/** 右栏目录卡片（两列网格；无内滚）。 */
export function DirectoryRail(props: DirectoryRailProps): React.ReactElement {
  const locale: Locale = props.locale ?? DEFAULT_LOCALE
  const t: Translator = React.useMemo(() => createTranslator(locale), [locale])
  const cards = React.useMemo(
    () =>
      buildDirectoryCards(props.nodes, {
        rootLabel: t('map.rootCluster'),
        ...(props.currentTurnPaths === undefined ? {} : { currentTurnPaths: props.currentTurnPaths }),
      }),
    [props.nodes, props.currentTurnPaths, t],
  )
  if (cards.length === 0) {
    return h(
      'div',
      { className: 'tl-rail', 'data-directory-rail': 'true', 'data-testid': props.testId },
      h(EmptyState, { title: t('state.emptyFiles'), mark: '◌', testId: 'rail-empty' }),
    )
  }
  return h(
    'div',
    { className: 'tl-rail', 'data-directory-rail': 'true', role: 'group', 'aria-label': t('rail.title'), 'data-card-count': String(cards.length), 'data-testid': props.testId },
    ...cards.map((card) =>
      h(RailCard, {
        key: card.key,
        card,
        selected: props.selectedKey !== null && props.selectedKey === card.key,
        hovered: props.hoveredKey !== null && props.hoveredKey !== undefined && props.hoveredKey === card.key,
        related: props.relatedKeys !== null && props.relatedKeys !== undefined && props.relatedKeys.has(card.key),
        dim: props.activeKeys !== null && props.activeKeys !== undefined && !props.activeKeys.has(card.key),
        formatTime: props.formatTime,
        onSelect: props.onSelect,
        ...(props.onHover === undefined ? {} : { onHover: props.onHover }),
        t,
      }),
    ),
  )
}
