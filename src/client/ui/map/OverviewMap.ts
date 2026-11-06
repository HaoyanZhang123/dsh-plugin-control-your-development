/*
 * map/OverviewMap.ts —— 星图总览（T35，脉络 1.1 默认左图）。
 *
 * 设计：
 * - 目录簇：每个顶层目录一个"卡片簇"（`overview.ts` 确定性有机布局），折叠只显示卡片 top3 + `+N`；
 *   hover/聚焦的簇展开 top12；其余簇 dim。簇间只画按目录聚合的弱关系，不画文件级蜘蛛网。
 * - 文件节点：簇内可拖动（pointer capture + 3px 阈值），位置只在内存；双击/按钮重置。
 * - 证据：点文件 / hover 或点边 → 右下图内浮层（路径、family、ops、按关系类型分组的 evidence 文本），
 *   不是旧检查器。关系类型 chip 可过滤。
 * - loading / coverageNote / 空轮次都有显式文案，不显示"0 文件"假空态。
 *
 * 纯布局/聚合都在 `overview.ts`；这里只做渲染与交互。
 */
import * as React from 'react'
import type { FileFamily, FileNode } from '../../../shared/events/index.ts'
import type { GraphEdge, RelationEvidence, RelationType } from '../../../shared/relations/index.ts'
import { createTranslator, DEFAULT_LOCALE, type Locale, type Translator } from '../../locale/index.ts'
import { EmptyState } from '../common/index.ts'
import type { DirectoryCard } from '../rail/directories.ts'
import {
  aggregateDirectoryEdges,
  aggregateEdgePairs,
  clusterBoxSize,
  dragThresholdExceeded,
  filterEdgesByTypes,
  layoutOverview,
  relationTypeCounts,
  resetDragOffsets,
  topDirectoryKey,
  type NodeDragOffset,
  type OverviewCluster,
  type OverviewFile,
  type OverviewLayout,
} from './overview.ts'
import { FAMILY_COLOR, FAMILY_MESSAGE_KEY, FILE_FAMILIES, GRAPH_CLASS, GRAPH_DATA, RELATION_MESSAGE_KEY } from './theme.ts'

const h = React.createElement

/** 总览 props（FileGraphProps 的子集；FileGraph 包装器按 mode 分派）。 */
export interface OverviewMapProps {
  files: readonly FileNode[]
  edges?: readonly GraphEdge[]
  mode: 'overview'
  directoryKey?: string
  directoryLabel?: string
  cards?: readonly DirectoryCard[]
  hoveredDirectoryKey?: string | null
  focusedDirectoryKey?: string | null
  onHoverDirectory?: (key: string | null) => void
  onFocusDirectory?: (key: string | null) => void
  selectedPath?: string | null
  onSelectFile?: (path: string | null) => void
  onOpenFile?: (path: string) => void
  onHoverFile?: (path: string | null) => void
  now: number
  locale?: Locale
  reducedMotion?: boolean
  emptyTitle?: string
  testId?: string
  loading?: boolean
  loadingLabel?: string
  coverageNote?: string
}

const STAGE_FALLBACK_HEIGHT = 460
const FILE_LABEL_FONT = 9.5

interface DragState {
  key: string
  path: string
  startX: number
  startY: number
  baseDx: number
  baseDy: number
  moved: boolean
}

interface DirPairInspect {
  fromKey: string
  toKey: string
}

function truncateName(name: string, max = 18): string {
  return name.length <= max ? name : name.slice(0, max - 1) + '…'
}

function toOverviewFile(file: FileNode): OverviewFile {
  return { path: file.path, name: file.name, family: file.family, ops: file.ops }
}

function relationText(edge: GraphEdge): string {
  return edge.evidence.text
}

function groupEvidence(edges: readonly GraphEdge[]): Array<{ type: RelationType; labelKey: (typeof RELATION_MESSAGE_KEY)[RelationType]; texts: string[] }> {
  const groups = new Map<RelationType, string[]>()
  for (const edge of edges) {
    const list = groups.get(edge.type) ?? []
    if (list.length < 4 && !list.includes(relationText(edge))) list.push(relationText(edge))
    groups.set(edge.type, list)
  }
  return [...groups.entries()]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([type, texts]) => ({ type, labelKey: RELATION_MESSAGE_KEY[type], texts }))
}

/** 星图总览。 */
export function OverviewMap(props: OverviewMapProps): React.ReactElement {
  const locale: Locale = props.locale ?? DEFAULT_LOCALE
  const t: Translator = React.useMemo(() => createTranslator(locale), [locale])
  const stageRef = React.useRef<HTMLDivElement | null>(null)
  const [size, setSize] = React.useState<{ width: number; height: number }>({ width: 0, height: 0 })
  const [localHoverKey, setLocalHoverKey] = React.useState<string | null>(null)
  const [localFocusKey, setLocalFocusKey] = React.useState<string | null>(null)
  const [inspectPath, setInspectPath] = React.useState<string | null>(null)
  const [inspectDirPair, setInspectDirPair] = React.useState<DirPairInspect | null>(null)
  const [hoverDirPair, setHoverDirPair] = React.useState<DirPairInspect | null>(null)
  const [pinnedDirPair, setPinnedDirPair] = React.useState<DirPairInspect | null>(null)
  const [hoverFileKey, setHoverFileKey] = React.useState<string | null>(null)
  const [typeFilter, setTypeFilter] = React.useState<ReadonlySet<RelationType> | null>(null)
  const [dragOffsets, setDragOffsets] = React.useState<Record<string, NodeDragOffset>>({})
  const dragRef = React.useRef<DragState | null>(null)
  // 初次挂载不播放入场动画（截图/SSR 稳定）；第一次交互后才启用展开/轮次过渡。
  const [animate, setAnimate] = React.useState(false)

  React.useEffect(() => {
    const element = stageRef.current
    if (element === null) return undefined
    const measure = (): void => {
      const rect = element.getBoundingClientRect()
      setSize({ width: Math.round(rect.width), height: Math.round(rect.height) })
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const width = size.width > 0 ? size.width : 720
  const height = size.height > 0 ? size.height : STAGE_FALLBACK_HEIGHT
  const cards = props.cards ?? []
  const files = props.files
  const edges = props.edges ?? []
  const fileByKey = React.useMemo(() => {
    const map = new Map<string, FileNode>()
    for (const file of files) map.set(file.path.toLowerCase(), file)
    return map
  }, [files])
  const filesByDir = React.useMemo(() => {
    const map = new Map<string, OverviewFile[]>()
    for (const file of files) {
      const key = topDirectoryKey(file.path)
      const list = map.get(key) ?? []
      list.push(toOverviewFile(file))
      map.set(key, list)
    }
    return map
  }, [files])

  const hoverKey = props.hoveredDirectoryKey !== undefined ? props.hoveredDirectoryKey : localHoverKey
  const focusKey = props.focusedDirectoryKey !== undefined ? props.focusedDirectoryKey : localFocusKey
  // hover 优先展开；没有 hover 时保持 focused。两者都用于 dim 的判定。
  const expandedKey = hoverKey ?? focusKey
  const overview: OverviewLayout = React.useMemo(
    () => layoutOverview(cards, { width, height, expandedKey, focusedKey: focusKey, filesByDir }),
    [cards, filesByDir, width, height, expandedKey, focusKey],
  )
  const clusterByKey = React.useMemo(() => new Map(overview.clusters.map((cluster) => [cluster.key, cluster])), [overview])

  const counts = React.useMemo(() => relationTypeCounts(edges), [edges])
  const visibleEdges = React.useMemo(() => filterEdgesByTypes(edges, typeFilter), [edges, typeFilter])
  const dirEdges = React.useMemo(() => aggregateDirectoryEdges(visibleEdges), [visibleEdges])
  const dirEdgeByKey = React.useMemo(() => new Map(dirEdges.map((edge) => [edge.key, edge])), [dirEdges])
  const edgesById = React.useMemo(() => new Map(edges.map((edge) => [edge.id, edge])), [edges])

  const inspectFile = React.useMemo(() => {
    const path = inspectPath ?? props.selectedPath ?? null
    return path === null ? null : fileByKey.get(path.toLowerCase()) ?? null
  }, [inspectPath, props.selectedPath, fileByKey])
  const inspectFileEdges = React.useMemo(() => {
    if (inspectFile === null) return []
    const key = inspectFile.path.toLowerCase()
    return visibleEdges.filter((edge) => edge.from.toLowerCase() === key || edge.to.toLowerCase() === key)
  }, [inspectFile, visibleEdges])
  const inspectFileGroups = React.useMemo(() => groupEvidence(inspectFileEdges), [inspectFileEdges])

  const pairInspect = inspectDirPair ?? pinnedDirPair
  const pairEdges = React.useMemo(() => {
    if (pairInspect === null) return []
    return visibleEdges.filter((edge) => {
      const from = topDirectoryKey(edge.from)
      const to = topDirectoryKey(edge.to)
      return (from === pairInspect.fromKey && to === pairInspect.toKey) || (from === pairInspect.toKey && to === pairInspect.fromKey)
    })
  }, [pairInspect, visibleEdges])
  const pairGroups = React.useMemo(() => groupEvidence(pairEdges), [pairEdges])
  const pairPairList = React.useMemo(() => aggregateEdgePairs(pairEdges), [pairEdges])

  const activeClusterKey = expandedKey
  const dimOthers = activeClusterKey !== null

  const selectDirectory = (key: string): void => {
    setAnimate(true)
    const next = focusKey === key ? null : key
    if (props.onFocusDirectory !== undefined) props.onFocusDirectory(next)
    else setLocalFocusKey(next)
    setInspectDirPair(null)
    setPinnedDirPair(null)
  }
  const hoverDirectory = (key: string | null): void => {
    if (key !== null) setAnimate(true)
    if (props.onHoverDirectory !== undefined) props.onHoverDirectory(key)
    else setLocalHoverKey(key)
  }

  const beginDrag = (event: React.PointerEvent<SVGGElement>, node: { path: string; x: number; y: number }): void => {
    if (event.button !== 0) return
    event.stopPropagation()
    const key = node.path.toLowerCase()
    const offset = dragOffsets[key]
    dragRef.current = {
      key,
      path: node.path,
      startX: event.clientX,
      startY: event.clientY,
      baseDx: offset?.dx ?? 0,
      baseDy: offset?.dy ?? 0,
      moved: false,
    }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }
  const moveDrag = (event: React.PointerEvent<SVGGElement>): void => {
    const drag = dragRef.current
    if (drag === null) return
    const dx = event.clientX - drag.startX
    const dy = event.clientY - drag.startY
    if (!drag.moved && !dragThresholdExceeded(dx, dy)) return
    drag.moved = true
    setDragOffsets((current) => ({ ...current, [drag.key]: { dx: drag.baseDx + dx, dy: drag.baseDy + dy } }))
  }
  const endDrag = (event: React.PointerEvent<SVGGElement>, path: string): void => {
    const drag = dragRef.current
    if (drag === null) return
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    dragRef.current = null
    if (!drag.moved) selectFile(path)
  }
  const selectFile = (path: string | null): void => {
    setInspectPath(path === null ? null : path)
    setInspectDirPair(null)
    setPinnedDirPair(null)
    props.onSelectFile?.(path)
  }
  const clearAll = (): void => {
    setInspectPath(null)
    setInspectDirPair(null)
    setPinnedDirPair(null)
    setDragOffsets(resetDragOffsets())
    if (props.onFocusDirectory !== undefined) props.onFocusDirectory(null)
    else setLocalFocusKey(null)
    props.onSelectFile?.(null)
  }
  const onStageClick = (event: React.MouseEvent<SVGSVGElement>): void => {
    const target = event.target as Element
    if (target !== event.currentTarget && target.getAttribute('data-graph-background') !== 'true') return
    clearAll()
  }
  const onStageKeyDown = (event: React.KeyboardEvent<SVGSVGElement>): void => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    if (inspectPath !== null || pairInspect !== null) {
      setInspectPath(null)
      setInspectDirPair(null)
      setPinnedDirPair(null)
      return
    }
    clearAll()
  }
  const resetLayout = (): void => {
    setDragOffsets(resetDragOffsets())
    dragRef.current = null
  }
  const toggleType = (type: RelationType): void => {
    setTypeFilter((current) => {
      const allTypes = counts.map((item) => item.type)
      const active = current === null ? new Set(allTypes) : new Set(current)
      if (active.has(type)) active.delete(type)
      else active.add(type)
      if (active.size === allTypes.length || active.size === 0) return null
      return active
    })
  }

  const stageContent = (): React.ReactElement => {
    if (props.loading === true) {
      return h(
        'div',
        { className: 'tl-graph-loading', role: 'status', [GRAPH_DATA.loading]: 'true' },
        h('span', { className: 'tl-graph-loading-dot', 'aria-hidden': true }),
        h('span', null, props.loadingLabel ?? t('graph.loading')),
      )
    }
    if (cards.length === 0 || files.length === 0) {
      return h(EmptyState, { title: props.emptyTitle ?? t('state.emptyFiles'), mark: '◌', testId: 'graph-empty' })
    }
    const nodes: React.ReactElement[] = []
    const dirLineElements = dirEdges.flatMap((dirEdge) => {
      const from = clusterByKey.get(dirEdge.fromKey)
      const to = clusterByKey.get(dirEdge.toKey)
      if (from === undefined || to === undefined) return []
      const hovered =
        (hoverFileKey !== null && (topDirectoryKey(fileByKey.get(hoverFileKey)?.path ?? '') === from.key || topDirectoryKey(fileByKey.get(hoverFileKey)?.path ?? '') === to.key))
      const focused = pairInspect !== null && ((pairInspect.fromKey === from.key && pairInspect.toKey === to.key) || (pairInspect.fromKey === to.key && pairInspect.toKey === from.key))
      const dim = activeClusterKey !== null && from.key !== activeClusterKey && to.key !== activeClusterKey
      return [
        h('line', {
          key: 'de:' + dirEdge.key,
          className: 'tl-dir-edge',
          [GRAPH_DATA.dirEdge]: dirEdge.key,
          'data-from-directory': dirEdge.fromKey,
          'data-to-directory': dirEdge.toKey,
          'data-count': dirEdge.count,
          x1: from.x + from.width / 2,
          y1: from.y + from.height / 2,
          x2: to.x + to.width / 2,
          y2: to.y + to.height / 2,
          strokeWidth: Math.max(1, Math.min(3.4, Math.log2(1 + dirEdge.weight) * 0.9)),
          opacity: focused || hovered ? 0.85 : dim ? 0.08 : 0.3,
          onPointerEnter: () => setHoverDirPair({ fromKey: dirEdge.fromKey, toKey: dirEdge.toKey }),
          onPointerLeave: () => setHoverDirPair(null),
          onClick: (event: React.MouseEvent) => {
            event.stopPropagation()
            setInspectPath(null)
            setInspectDirPair({ fromKey: dirEdge.fromKey, toKey: dirEdge.toKey })
            setPinnedDirPair({ fromKey: dirEdge.fromKey, toKey: dirEdge.toKey })
          },
        }),
      ]
    })
    for (const cluster of overview.clusters) {
      nodes.push(renderCluster(cluster))
    }
    return h(
      'svg',
      {
        className: 'tl-graph-svg',
        viewBox: '0 0 ' + String(overview.width) + ' ' + String(overview.height),
        preserveAspectRatio: 'xMidYMid meet',
        role: 'group',
        'aria-label': t('graph.title'),
        tabIndex: 0,
        onClick: onStageClick,
        onKeyDown: onStageKeyDown,
      },
      h('rect', { x: 0, y: 0, width: overview.width, height: overview.height, fill: 'transparent', 'data-graph-background': 'true' }),
      ...dirLineElements,
      ...nodes,
    )
  }

  const renderCluster = (cluster: OverviewCluster): React.ReactElement => {
    const isActive = activeClusterKey === cluster.key
    const isDim = dimOthers && !isActive
    const more = cluster.hiddenCount
    return h(
      'g',
      {
        key: 'c:' + cluster.key,
        className: 'tl-ocluster',
        [GRAPH_DATA.cluster]: cluster.key,
        'data-expanded': cluster.expanded ? 'true' : 'false',
        'data-dim': isDim ? 'true' : 'false',
        'data-focused': focusKey === cluster.key ? 'true' : 'false',
        role: 'button',
        tabIndex: -1,
        'aria-label': (cluster.label === '' ? t('map.rootCluster') : cluster.label) + ' · ' + String(cluster.count) + ' ' + t('inspector.file'),
        onPointerEnter: () => hoverDirectory(cluster.key),
        onClick: (event: React.MouseEvent) => {
          event.stopPropagation()
          selectDirectory(cluster.key)
        },
      },
      h(
        'g',
        { className: 'tl-ocluster-box-wrap', key: 'box:' + cluster.key + ':' + (cluster.expanded ? 'open' : 'closed') },
        h('rect', {
          className: 'tl-ocluster-box',
          x: cluster.x,
          y: cluster.y,
          width: cluster.width,
          height: cluster.height,
          rx: 10,
          ry: 10,
        }),
      ),
      h(
        'text',
        { className: 'tl-ocluster-label', x: cluster.x + 10, y: cluster.y + 17, 'data-cluster-label': cluster.key },
        h('title', null, cluster.label === '' ? t('map.rootCluster') : cluster.label),
        truncateName(cluster.label === '' ? t('map.rootCluster') : cluster.label, Math.floor((cluster.width - 34) / 6.4)),
      ),
      h(
        'text',
        { className: 'tl-ocluster-meta', x: cluster.x + 10, y: cluster.y + 29 },
        String(cluster.count) + ' ' + t('inspector.file'),
      ),
      ...cluster.files.map((file) => renderClusterFile(file, cluster)),
      more > 0
        ? h(
            'text',
            {
              className: 'tl-ocluster-more',
              x: cluster.x + cluster.width - 10,
              y: cluster.y + cluster.height - 7,
              textAnchor: 'end',
              'data-more-files': more,
            },
            h('title', null, t('graph.moreFiles', { n: more })),
            '+' + String(more),
          )
        : null,
    )
  }

  const renderClusterFile = (file: (typeof overview.clusters)[number]['files'][number], cluster: OverviewCluster): React.ReactElement => {
    const key = file.path.toLowerCase()
    const isSelected = inspectFile !== null && inspectFile.path.toLowerCase() === key
    const isHovered = hoverFileKey === key
    const isDragged = dragOffsets[key] !== undefined
    const offset = dragOffsets[key]
    const x = file.x + (offset?.dx ?? 0)
    const y = file.y + (offset?.dy ?? 0)
    const fill = FAMILY_COLOR[file.family as FileFamily]
    return h(
      'g',
      {
        key: 'f:' + file.path,
        className: 'tl-ofile',
        [GRAPH_DATA.node]: file.path,
        'data-family': file.family,
        'data-ops': file.ops,
        'data-selected': isSelected ? 'true' : 'false',
        'data-dim': dimOthers && !isActiveCluster(cluster.key) ? 'true' : 'false',
        'data-dragging': isDragged ? 'true' : 'false',
        role: 'button',
        tabIndex: isSelected ? 0 : -1,
        'aria-label': file.name + ' · ' + t('inspector.ops') + ' ' + file.ops,
        onPointerDown: (event: React.PointerEvent<SVGGElement>) => beginDrag(event, { path: file.path, x: file.x, y: file.y }),
        onPointerMove: moveDrag,
        onPointerUp: (event: React.PointerEvent<SVGGElement>) => endDrag(event, file.path),
        onPointerCancel: (event: React.PointerEvent<SVGGElement>) => endDrag(event, file.path),
        onPointerEnter: () => {
          setHoverFileKey(key)
          props.onHoverFile?.(file.path)
        },
        onPointerLeave: () => {
          setHoverFileKey((value) => (value === key ? null : value))
          props.onHoverFile?.(null)
        },
        onDoubleClick: (event: React.MouseEvent) => {
          event.stopPropagation()
          resetLayout()
        },
        onClick: (event: React.MouseEvent) => {
          // click 由 pointerup（阈值判定后）处理；这里只阻止冒泡到簇，避免点文件顺带 pin 目录。
          event.stopPropagation()
        },
        onKeyDown: (event: React.KeyboardEvent) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            selectFile(file.path)
          }
        },
      },
      h('title', null, file.path),
      h('circle', {
        className: 'tl-ofile-halo',
        cx: x,
        cy: y,
        r: file.r + 5,
        fill,
        fillOpacity: isHovered ? 0.12 : 0,
      }),
      h('circle', {
        className: 'tl-ofile-core',
        cx: x,
        cy: y,
        r: file.r,
        fill,
        fillOpacity: isSelected ? 1 : 0.72,
        stroke: isSelected || isHovered ? fill : 'var(--tl-bg)',
        strokeWidth: isSelected ? 1.5 : 1.1,
      }),
      file.labelled || isSelected || isHovered
        ? (() => {
            const label = truncateName(file.name, cluster.expanded ? 16 : Math.max(8, Math.floor((cluster.width - 26) / 5.4)))
            const toLeft = x > cluster.x + cluster.width * 0.62
            return h('text', {
              className: 'tl-ofile-label',
              x: toLeft ? x - file.r - 3 : x + file.r + 3,
              y: y + 3.4,
              textAnchor: toLeft ? 'end' : 'start',
            }, label)
          })()
        : null,
    )
  }

  const isActiveCluster = (key: string): boolean => activeClusterKey === key

  const evidencePanel = (): React.ReactElement | null => {
    const pair = pairInspect ?? hoverDirPair
    if (inspectFile === null && pair === null) return null
    const close = (): void => {
      setInspectPath(null)
      setInspectDirPair(null)
      setPinnedDirPair(null)
      setHoverDirPair(null)
    }
    if (inspectFile !== null) {
      return h(
        'div',
        { className: 'tl-graph-evidence', [GRAPH_DATA.evidence]: 'file', role: 'dialog', 'aria-label': t('graph.evidenceTitle') },
        h(
          'div',
          { className: 'tl-graph-evidence-head' },
          h('b', { className: 'tl-graph-evidence-title' }, t('graph.evidenceTitle')),
          h('button', { type: 'button', className: 'tl-graph-evidence-close', onClick: close, 'aria-label': t('ui.close') }, '×'),
        ),
        h('div', { className: 'tl-graph-evidence-path' }, inspectFile.path),
        h(
          'div',
          { className: 'tl-graph-evidence-meta' },
          h('span', { 'data-evidence-family': inspectFile.family }, t(FAMILY_MESSAGE_KEY[inspectFile.family])),
          h('span', null, t('inspector.ops') + ' ' + String(inspectFile.ops)),
          h('span', null, t('graph.fileRelations', { n: inspectFileEdges.length })),
        ),
        inspectFileGroups.length === 0
          ? h('p', { className: 'tl-graph-evidence-empty' }, t('state.unknown'))
          : inspectFileGroups.map((group) =>
              h(
                'div',
                { key: group.type, className: 'tl-graph-evidence-group', 'data-evidence-type': group.type },
                h('span', { className: 'tl-graph-evidence-type' }, t(group.labelKey)),
                ...group.texts.map((text, index) => h('p', { key: index, className: 'tl-graph-evidence-text' }, text)),
              ),
            ),
      )
    }
    const from = pair === null ? '' : clusterByKey.get(pair.fromKey)?.label ?? pair.fromKey
    const to = pair === null ? '' : clusterByKey.get(pair.toKey)?.label ?? pair.toKey
    return h(
      'div',
      { className: 'tl-graph-evidence', [GRAPH_DATA.evidence]: 'dir-pair', role: 'dialog', 'aria-label': t('graph.evidenceTitle') },
      h(
        'div',
        { className: 'tl-graph-evidence-head' },
        h('b', { className: 'tl-graph-evidence-title' }, t('graph.evidenceTitle')),
        h('button', { type: 'button', className: 'tl-graph-evidence-close', onClick: close, 'aria-label': t('ui.close') }, '×'),
      ),
      h('div', { className: 'tl-graph-evidence-path' }, (from === '' ? t('map.rootCluster') : from) + ' ↔ ' + (to === '' ? t('map.rootCluster') : to)),
      h('div', { className: 'tl-graph-evidence-meta' }, h('span', null, t('graph.fileRelations', { n: pairPairList.reduce((sum, item) => sum + item.count, 0) }))),
      pairGroups.length === 0
        ? h('p', { className: 'tl-graph-evidence-empty' }, t('state.unknown'))
        : pairGroups.map((group) =>
            h(
              'div',
              { key: group.type, className: 'tl-graph-evidence-group', 'data-evidence-type': group.type },
              h('span', { className: 'tl-graph-evidence-type' }, t(group.labelKey)),
              ...group.texts.map((text, index) => h('p', { key: index, className: 'tl-graph-evidence-text' }, text)),
            ),
          ),
    )
  }

  const subtitle = t('graph.overviewSubtitle', { dirs: overview.totalDirs, files: overview.totalFiles })

  return h(
    'div',
    {
      className: GRAPH_CLASS,
      [GRAPH_DATA.root]: 'true',
      [GRAPH_DATA.mode]: 'overview',
      [GRAPH_DATA.directory]: props.directoryKey ?? '',
      'data-node-count': overview.clusters.reduce((sum, cluster) => sum + cluster.files.length, 0),
      'data-file-count': overview.totalFiles,
      'data-cluster-count': overview.clusters.length,
      'data-reduced-motion': props.reducedMotion === true ? 'true' : 'false',
      'data-animate': animate ? 'true' : 'false',
      'data-testid': props.testId,
    },
    h(
      'div',
      { className: 'tl-graph-head' },
      h('div', { className: 'tl-graph-title' }, t('graph.title'), h('span', { className: 'tl-graph-subtitle' }, props.loading === true ? t('graph.loading') : subtitle)),
      h(
        'div',
        { className: 'tl-graph-legend', 'aria-label': t('legend.title'), role: 'group' },
        ...FILE_FAMILIES.map((family) =>
          h(
            'span',
            { key: family, className: 'tl-graph-legend-item', 'data-family': family },
            h('span', { className: 'tl-graph-legend-dot', style: { background: FAMILY_COLOR[family] }, 'aria-hidden': true }),
            h('span', null, t(FAMILY_MESSAGE_KEY[family])),
          ),
        ),
      ),
    ),
    counts.length > 0
      ? h(
          'div',
          { className: 'tl-graph-filters', 'aria-label': t('graph.filterHint'), role: 'group' },
          h('span', { className: 'tl-graph-filter-hint' }, t('graph.filterHint')),
          ...counts.map((item) =>
            h(
              'button',
              {
                key: item.type,
                type: 'button',
                className: 'tl-graph-filter',
                [GRAPH_DATA.filter]: item.type,
                'aria-pressed': typeFilter === null || typeFilter.has(item.type) ? 'true' : 'false',
                'data-count': item.count,
                onClick: (event: React.MouseEvent) => {
                  event.stopPropagation()
                  toggleType(item.type)
                },
              },
              h('span', { className: 'tl-graph-filter-label' }, t(RELATION_MESSAGE_KEY[item.type])),
              h('span', { className: 'tl-graph-filter-count' }, String(item.count)),
            ),
          ),
        )
      : null,
    h(
      'div',
      {
        className: 'tl-graph-stage',
        ref: stageRef,
        'data-graph-stage': 'true',
        // 只在指针离开整个图时清 hover：展开会重排簇，若用簇级 leave 会"收起→指针又落回→再展开"抖动。
        onPointerLeave: () => hoverDirectory(null),
      },
      stageContent(),
      evidencePanel(),
    ),
    h(
      'div',
      { className: 'tl-graph-foot' },
      h('span', { className: 'tl-graph-hint' }, t('graph.overviewHint')),
      h('span', { className: 'tl-graph-note' }, t('graph.dragHint')),
      props.coverageNote !== undefined && props.coverageNote !== ''
        ? h('span', { className: 'tl-graph-note', [GRAPH_DATA.coverage]: 'true' }, props.coverageNote)
        : null,
      h(
        'button',
        { type: 'button', className: 'tl-graph-reset', [GRAPH_DATA.reset]: 'true', onClick: resetLayout, title: t('graph.resetLayout') },
        t('graph.resetLayout'),
      ),
    ),
  )
}
