/*
 * map/FileGraph.ts —— 左列「文件关系图」（33 §3，替代 1.0 的星图）。
 *
 * 两种 mode（由 props.mode 决定，本组件不持有时序状态）：
 * - `directory`：当前选中目录的文件（默认目录由入口按"文件操作最多的目录"选）；
 * - `turn`：某一轮涉及的文件（可跨目录）；再点该轮 / 点空白 / Esc → 退出回目录图（回调给入口）。
 *
 * 视觉（参照 2026-11-05 原型，但实现只用 tokens/CSS 体系）：
 * - 径向/星座确定性布局（中心最活跃，内外环铺开；`graphLayout.ts` 纯函数）；
 * - 无 pan/zoom、无簇灰底框、无网格背景；
 * - 颜色 = 5 类文件族；选中 = 填充加深 + 同色 1.5px 细环（点击不出现大框/outline）；
 * - 标签 11px 避让；本轮状态用「读 N / 写+A / 写−D / 首见」小字标签。
 *
 * 数据诚实：文件级删除/新增不可证；本轮只显示读 / 写行数 / 首见，删除只在摘要里显示命令计数。
 */
import * as React from 'react'
import type { FileNode, FileFamily, TurnDetail } from '../../../shared/events/index.ts'
import { caseKey, type GraphEdge } from '../../../shared/relations/index.ts'
import { createTranslator, DEFAULT_LOCALE, type Locale, type Translator } from '../../locale/index.ts'
import { EmptyState } from '../common/index.ts'
import type { DirectoryCard } from '../rail/directories.ts'
import { estimateTextWidth, GRAPH_LABEL_FONT_PX, GRAPH_STATUS_FONT_PX, placeLabels, type LabelCandidate, type OccupiedBox } from './labels.ts'
import { layoutFileGraph, type GraphLayout, type GraphLayoutNode, type GraphMode, type GraphSourceFile } from './graphLayout.ts'
import { aggregateEdgePairs, type EdgePair } from './overview.ts'
import { OverviewMap } from './OverviewMap.ts'
import { FAMILY_COLOR, FAMILY_MESSAGE_KEY, FILE_FAMILIES, GRAPH_CLASS, GRAPH_DATA, GRAPH_EDGE_LIMITS, GRAPH_LABEL_LIMITS, RELATION_MESSAGE_KEY, STATUS_COLOR } from './theme.ts'
import type { FileTurnStatus, TurnStatusSnapshot } from '../turns/status.ts'

const h = React.createElement

/** 本轮信息（turn 视图用；由入口算好状态后传入）。 */
export interface FileGraphTurn {
  turn: TurnDetail
  status: TurnStatusSnapshot
}

export interface FileGraphProps {
  /** 当前集合的全部文件（overview = 全部文件；目录 = 该目录文件；轮次 = 该轮文件）。 */
  files: readonly FileNode[]
  /** 产品级边（内部会按"两端都在当前集合内"过滤后绘制）。 */
  edges?: readonly GraphEdge[]
  mode: GraphMode
  /** T35：overview 的目录卡片（topFiles 只有 3 个；文件全集仍走 files）。 */
  cards?: readonly DirectoryCard[]
  /** T35：overview 的悬浮目录（展开 top12、其他 dim）。 */
  hoveredDirectoryKey?: string | null
  /** T35：overview 的 pin 目录（点击卡片 pin/收起；点空白清）。 */
  focusedDirectoryKey?: string | null
  onHoverDirectory?: (key: string | null) => void
  onFocusDirectory?: (key: string | null) => void
  /** 目录键（'' = 根目录）；turn 视图用于副标题回退。 */
  directoryKey: string
  /** 目录展示标签（根目录传 locale map.rootCluster）。 */
  directoryLabel: string
  /** 本轮信息（mode === 'turn' 时必给）。 */
  turn?: FileGraphTurn | null
  /** 当前选中的文件（图内点击）。 */
  selectedPath?: string | null
  onSelectFile?: (path: string | null) => void
  onOpenFile?: (path: string) => void
  /** hover 文件节点（用于右卡/轮次联动）；离开节点传 null。 */
  onHoverFile?: (path: string | null) => void
  /** 退出本轮视图（再点该轮 / 点空白 / Esc）。 */
  onExitTurn?: () => void
  /** 当前轮次影响的文件（目录视图里的“本轮”提示用，可选）。 */
  currentTurnPaths?: readonly string[]
  now: number
  locale?: Locale
  reducedMotion?: boolean
  /** 空态文案覆盖（缺省 state.emptyFiles；turn 用 graph.emptyTurn）。 */
  emptyTitle?: string
  testId?: string
  /** T35：加载中显示骨架/加载文案，不显示 0 文件假空态。 */
  loading?: boolean
  loadingLabel?: string
  /** T35：例如“基于已加载 N 个会话”，显示在图尾。 */
  coverageNote?: string
}

const GRAPH_STAGE_HEIGHT = 460

function toSource(file: FileNode): GraphSourceFile {
  return {
    path: file.path,
    name: file.name,
    dir: file.dir,
    family: file.family,
    ops: file.ops,
    firstAt: file.firstAt,
    lastAt: file.lastAt,
  }
}

function turnStatusLabel(status: TurnDetail['status'], t: Translator): string {
  if (status === 'running') return t('session.running')
  if (status === 'completed') return t('turns.completed')
  if (status === 'aborted') return t('session.aborted')
  return t('session.unknown')
}

function statusParts(status: FileTurnStatus | undefined, t: Translator): Array<{ key: string; text: string; color: string }> {
  if (status === undefined) return []
  const parts: Array<{ key: string; text: string; color: string }> = []
  if (status.read > 0) parts.push({ key: 'read', text: t('turnStatus.markRead', { n: status.read }), color: STATUS_COLOR.read })
  if (status.writeAdd > 0) parts.push({ key: 'add', text: t('turnStatus.markWriteAdd', { n: status.writeAdd }), color: STATUS_COLOR.writeAdd })
  if (status.writeDel > 0) parts.push({ key: 'del', text: t('turnStatus.markWriteDel', { n: status.writeDel }), color: STATUS_COLOR.writeDel })
  if (status.firstSeen) parts.push({ key: 'first', text: t('turnStatus.markFirstSeen'), color: STATUS_COLOR.firstSeen })
  return parts
}

/** 文件关系图：overview（星图总览）/ 目录 / 轮次三种表面。 */
export function FileGraph(props: FileGraphProps): React.ReactElement {
  if (props.mode === 'overview') {
    return h(OverviewMap, {
      files: props.files,
      edges: props.edges,
      mode: 'overview',
      directoryKey: props.directoryKey,
      directoryLabel: props.directoryLabel,
      cards: props.cards,
      hoveredDirectoryKey: props.hoveredDirectoryKey,
      focusedDirectoryKey: props.focusedDirectoryKey,
      onHoverDirectory: props.onHoverDirectory,
      onFocusDirectory: props.onFocusDirectory,
      selectedPath: props.selectedPath,
      onSelectFile: props.onSelectFile,
      onOpenFile: props.onOpenFile,
      onHoverFile: props.onHoverFile,
      now: props.now,
      locale: props.locale,
      reducedMotion: props.reducedMotion,
      emptyTitle: props.emptyTitle,
      testId: props.testId,
      loading: props.loading,
      loadingLabel: props.loadingLabel,
      coverageNote: props.coverageNote,
    })
  }
  return h(DetailGraph, props as DetailGraphProps)
}

type DetailGraphProps = FileGraphProps & { mode: 'directory' | 'turn' }

/** 目录/轮次的文件关系图（33 §3；T31 表面，保持 harness 兼容）。 */
function DetailGraph(props: DetailGraphProps): React.ReactElement {
  const locale: Locale = props.locale ?? DEFAULT_LOCALE
  const t: Translator = React.useMemo(() => createTranslator(locale), [locale])
  const stageRef = React.useRef<HTMLDivElement | null>(null)
  const [size, setSize] = React.useState<{ width: number; height: number }>({ width: 0, height: 0 })
  const [hoverPath, setHoverPath] = React.useState<string | null>(null)
  const [hoverEdgePairKey, setHoverEdgePairKey] = React.useState<string | null>(null)
  const [pinnedEdgePairKey, setPinnedEdgePairKey] = React.useState<string | null>(null)
  // 初次挂载不播放入场动画（截图/SSR 稳定）；只有"轮次/目录切换"这一帧才加过渡。
  const viewKey = props.mode + ':' + props.directoryKey + ':' + String(props.turn?.turn.n ?? '')
  const previousViewKey = React.useRef<string | null>(null)
  const viewChanged = previousViewKey.current !== null && previousViewKey.current !== viewKey
  if (previousViewKey.current === null || viewChanged) previousViewKey.current = viewKey

  React.useEffect(() => {
    const element = stageRef.current
    if (!element) return undefined
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

  const width = size.width > 0 ? size.width : 680
  const height = size.height > 0 ? size.height : GRAPH_STAGE_HEIGHT
  const layout: GraphLayout = React.useMemo(
    () => layoutFileGraph(props.files.map(toSource), { width, height, mode: props.mode }),
    [props.files, width, height, props.mode],
  )
  const nodeByKey = React.useMemo(() => {
    const map = new Map<string, GraphLayoutNode>()
    for (const node of layout.nodes) map.set(caseKey(node.path), node)
    return map
  }, [layout])
  const nodeKeys = React.useMemo(() => new Set(layout.nodes.map((node) => caseKey(node.path))), [layout])
  const statusByKey = React.useMemo(() => {
    const map = new Map<string, FileTurnStatus>()
    if (props.turn !== null && props.turn !== undefined) {
      for (const [path, status] of props.turn.status.byPath) map.set(caseKey(path), status)
    }
    return map
  }, [props.turn])
  const selectedKey = props.selectedPath === null || props.selectedPath === undefined ? null : caseKey(props.selectedPath)
  const focusKey = hoverPath === null ? selectedKey : caseKey(hoverPath)

  const { placements } = React.useMemo(() => {
    const candidates: LabelCandidate[] = []
    // 只做标签与标签的避让：节点圆不再当"硬占位"（否则 top-N 标签会被邻近圆点挤掉，
    // 40 节点里只剩 2-3 个标签）。标签带 3px 底色描边，压在连线/节点上仍可读。
    const occupied: OccupiedBox[] = []
    const cx = layout.width / 2
    const cy = layout.height / 2
    // 只给 top N（按 ops）+ 选中/悬停画标签；其余节点保留圆点，hover 时显示（Lead 2026-11-05 复审）。
    const labelLimit = GRAPH_LABEL_LIMITS[props.mode]
    const labelEligible = new Set<string>()
    const sortedByOps = layout.nodes.slice().sort((left, right) => (right.ops - left.ops) || (left.path < right.path ? -1 : 1))
    for (const node of sortedByOps.slice(0, labelLimit)) labelEligible.add(caseKey(node.path))
    if (selectedKey !== null) labelEligible.add(selectedKey)
    if (focusKey !== null) labelEligible.add(focusKey)
    for (const node of layout.nodes) {
      const key = caseKey(node.path)
      if (!labelEligible.has(key)) continue
      const isSelected = selectedKey === key
      const isHovered = focusKey === key
      const status = statusByKey.get(key)
      const hasStatus = status !== undefined && statusParts(status, t).length > 0
      const labelWidth = estimateTextWidth(node.name, GRAPH_LABEL_FONT_PX)
      const height = GRAPH_LABEL_FONT_PX + (hasStatus ? GRAPH_STATUS_FONT_PX + 2 : 0) + 2
      // 径向标签：从中心向外放（右半区左对齐、左半区右对齐、上下半区居中），避免全压在圆环上。
      const dx = node.x - cx
      const dy = node.y - cy
      const horizontal = Math.abs(dx) >= Math.abs(dy) * 0.75
      let boxX = 0
      let boxY = 0
      let anchor: 'start' | 'middle' | 'end' = 'middle'
      if (horizontal) {
        anchor = dx >= 0 ? 'start' : 'end'
        boxX = dx >= 0 ? node.x + node.r + 5 : node.x - node.r - 5 - labelWidth
        boxY = node.y - GRAPH_LABEL_FONT_PX / 2 - 1
      } else if (dy >= 0) {
        anchor = 'middle'
        boxX = node.x - labelWidth / 2
        boxY = node.y + node.r + 4
      } else {
        anchor = 'middle'
        boxX = node.x - labelWidth / 2
        boxY = node.y - node.r - height - 4
      }
      // 标签不许出画框（SVG 会裁掉；左右两侧的径向标签最容易越界）。
      boxX = Math.max(4, Math.min(layout.width - labelWidth - 4, boxX))
      boxY = Math.max(4, Math.min(layout.height - height - 4, boxY))
      candidates.push({
        key: node.path,
        text: node.name,
        x: boxX,
        y: boxY,
        width: labelWidth,
        height,
        priority: isSelected ? 1000 : isHovered ? 900 : node.ops,
        force: isSelected || isHovered,
        anchor,
      })
    }
    return { placements: placeLabels(candidates, occupied, 6) }
  }, [layout, statusByKey, selectedKey, focusKey, t])
  const placementByKey = React.useMemo(() => new Map(placements.map((item) => [item.key, item])), [placements])

  const visibleEdges = React.useMemo(() => {
    const edges = props.edges ?? []
    const statusKeys = props.mode === 'turn' ? new Set(statusByKey.keys()) : null
    // 目录图：不画同目录结构边（没有信息量），其余关系边按权重取 top 120，避免"空图"或"蜘蛛网"。
    const nodeFiltered: GraphEdge[] = []
    for (const edge of edges) {
      // 目录图里所有节点同目录：结构边（同目录）没有信息量，只画共现/引用等关系，避免"蜘蛛网"。
      if (props.mode === 'directory' && edge.type === 'structure') continue
      const from = nodeByKey.get(caseKey(edge.from))
      const to = nodeByKey.get(caseKey(edge.to))
      if (from === undefined || to === undefined) continue
      nodeFiltered.push(edge)
    }
    // T35：同一对文件的多条关系合并成一条视觉线（pair 聚合），按聚合权重取 top N。
    const pairs = aggregateEdgePairs(nodeFiltered)
    const limited = pairs.slice(0, props.mode === 'directory' ? GRAPH_EDGE_LIMITS.directory : GRAPH_EDGE_LIMITS.turn)
    const result = limited.flatMap((pair) => {
      const from = nodeByKey.get(caseKey(pair.from))
      const to = nodeByKey.get(caseKey(pair.to))
      return from === undefined || to === undefined ? [] : [{ pair, from, to }]
    })
    return { list: result, total: pairs.length, statusKeys }
  }, [props.edges, props.mode, nodeByKey, statusByKey])

  /** 边浮层：hover 或 点击固定 的 pair（T35 §4）。 */
  const activeEdgePair = React.useMemo(() => {
    const key = pinnedEdgePairKey ?? hoverEdgePairKey
    if (key === null) return null
    return visibleEdges.list.find((item) => item.pair.key === key)?.pair ?? null
  }, [pinnedEdgePairKey, hoverEdgePairKey, visibleEdges])
  const activeEdgePairEdges = React.useMemo(() => {
    if (activeEdgePair === null) return []
    const ids = new Set(activeEdgePair.ids)
    return (props.edges ?? []).filter((edge) => ids.has(edge.id))
  }, [activeEdgePair, props.edges])
  const activeEdgePairGroups = React.useMemo(() => {
    const groups = new Map<string, { labelKey: typeof RELATION_MESSAGE_KEY[keyof typeof RELATION_MESSAGE_KEY]; texts: string[] }>()
    for (const edge of activeEdgePairEdges) {
      const existing = groups.get(edge.type) ?? { labelKey: RELATION_MESSAGE_KEY[edge.type], texts: [] }
      if (existing.texts.length < 4 && !existing.texts.includes(edge.evidence.text)) existing.texts.push(edge.evidence.text)
      groups.set(edge.type, existing)
    }
    return [...groups.entries()].sort((left, right) => left[0].localeCompare(right[0]))
  }, [activeEdgePairEdges])

  const backToDirectory = (): void => {
    props.onExitTurn?.()
  }
  const onStageClick = (event: React.MouseEvent<SVGSVGElement>): void => {
    if (event.target !== event.currentTarget && (event.target as Element).getAttribute('data-graph-background') !== 'true') return
    if (props.mode === 'turn') {
      backToDirectory()
      return
    }
    props.onSelectFile?.(null)
  }
  const onStageKeyDown = (event: React.KeyboardEvent<SVGSVGElement>): void => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    if (props.mode === 'turn') {
      backToDirectory()
      return
    }
    props.onSelectFile?.(null)
  }

  const subtitle =
    props.loading === true
      ? props.mode === 'turn'
        ? t('graph.loadingTurn', { n: props.turn?.turn.n ?? '' })
        : t('graph.loading')
      : props.mode === 'turn' && props.turn !== null && props.turn !== undefined
        ? 'T' + String(props.turn.turn.n) + ' · ' + String(layout.total) + ' ' + t('inspector.file')
        : props.directoryLabel + ' · ' + String(layout.total) + ' ' + t('inspector.file')

  const summary = props.mode === 'turn' && props.turn !== null && props.turn !== undefined ? props.turn.status.summary : null
  const deleteText =
    summary === null ? '' : summary.deleteCommands === null ? t('turnStatus.unknown') : String(summary.deleteCommands)

  // 节点层与标签层分开渲染：标签永远在节点之上，避免后画的圆点盖住先画的文字。
  const nodeElements = layout.nodes.map((node) => {
    const key = caseKey(node.path)
    const status = statusByKey.get(key)
    const parts = statusParts(status, t)
    const isSelected = selectedKey === key
    const isHovered = focusKey === key
    const fill = FAMILY_COLOR[node.family as FileFamily]
    const statusMeta =
      status === undefined
        ? undefined
        : { 'data-read': String(status.read), 'data-write-add': String(status.writeAdd), 'data-write-del': String(status.writeDel), 'data-first-seen': status.firstSeen ? 'true' : 'false' }
    return h(
      'g',
      {
        key: 'n:' + node.path,
        className: 'tl-fnode',
        [GRAPH_DATA.node]: node.path,
        'data-family': node.family,
        'data-ops': node.ops,
        'data-selected': isSelected ? 'true' : 'false',
        role: 'button',
        tabIndex: isSelected || (selectedKey === null && node.index === 0) ? 0 : -1,
        'aria-label': node.name + ' · ' + t('inspector.ops') + ' ' + node.ops + (parts.length === 0 ? '' : ' · ' + parts.map((part) => part.text).join(' ')),
        onPointerEnter: () => {
          setHoverPath(node.path)
          props.onHoverFile?.(node.path)
        },
        onPointerLeave: () => {
          setHoverPath((value) => (value === node.path ? null : value))
          props.onHoverFile?.(null)
        },
        onClick: (event: React.MouseEvent) => {
          event.stopPropagation()
          props.onSelectFile?.(node.path)
        },
        onDoubleClick: (event: React.MouseEvent) => {
          event.stopPropagation()
          props.onOpenFile?.(node.path)
        },
        onFocus: () => props.onHoverFile?.(node.path),
        onBlur: () => props.onHoverFile?.(null),
        onKeyDown: (event: React.KeyboardEvent) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            props.onSelectFile?.(node.path)
          }
        },
        ...(statusMeta ?? {}),
      },
      h('title', null, node.path),
      h('circle', {
        className: 'tl-fnode-core',
        cx: node.x,
        cy: node.y,
        r: node.r,
        fill,
        fillOpacity: isSelected ? 1 : 0.55,
        stroke: isSelected || isHovered ? fill : 'var(--tl-bg)',
        strokeWidth: isSelected ? 1.5 : 1.2,
      }),
    )
  })

  const labelElements = layout.nodes.flatMap((node) => {
    const label = placementByKey.get(node.path)
    if (label === undefined || !label.visible) return []
    const key = caseKey(node.path)
    const isSelected = selectedKey === key
    const status = statusByKey.get(key)
    const parts = statusParts(status, t)
    const labelTextX =
      label.anchor === 'end' ? label.x + (label.width ?? 0) : label.anchor === 'middle' ? label.x + (label.width ?? 0) / 2 : label.x
    const labelAnchor = label.anchor ?? 'start'
    const elements: React.ReactElement[] = [
      h(
        'text',
        {
          key: 'l:' + node.path,
          className: 'tl-fnode-label',
          x: labelTextX,
          y: label.y + GRAPH_LABEL_FONT_PX,
          textAnchor: labelAnchor,
          [GRAPH_DATA.label]: node.path,
          'data-selected': isSelected ? 'true' : 'false',
        },
        label.text,
      ),
    ]
    if (parts.length > 0) {
      elements.push(
        h(
          'text',
          {
            key: 's:' + node.path,
            className: 'tl-fnode-status',
            x: labelTextX,
            y: label.y + GRAPH_LABEL_FONT_PX + GRAPH_STATUS_FONT_PX + 2,
            textAnchor: labelAnchor,
          },
          ...parts.map((part, index) => h('tspan', { key: part.key, fill: part.color, dx: index === 0 ? 0 : 4 }, part.text)),
        ),
      )
    }
    return elements
  })

  // T35 §4：边 hover/点击固定的 evidence 浮层（不是旧检查器）。
  const edgeEvidencePanel =
    activeEdgePair === null
      ? null
      : h(
          'div',
          { className: 'tl-graph-evidence', [GRAPH_DATA.evidence]: 'edge', role: 'dialog', 'aria-label': t('graph.evidenceTitle') },
          h(
            'div',
            { className: 'tl-graph-evidence-head' },
            h('b', { className: 'tl-graph-evidence-title' }, t('graph.evidenceTitle')),
            h(
              'button',
              {
                type: 'button',
                className: 'tl-graph-evidence-close',
                'aria-label': t('ui.close'),
                onClick: () => {
                  setPinnedEdgePairKey(null)
                  setHoverEdgePairKey(null)
                },
              },
              '×',
            ),
          ),
          h('div', { className: 'tl-graph-evidence-path' }, activeEdgePair.from + ' ↔ ' + activeEdgePair.to),
          h(
            'div',
            { className: 'tl-graph-evidence-meta' },
            h('span', null, t('graph.fileRelations', { n: activeEdgePair.count })),
            ...activeEdgePair.typeList.map((type) => h('span', { key: type, 'data-evidence-type': type }, t(RELATION_MESSAGE_KEY[type]))),
          ),
          activeEdgePairGroups.length === 0
            ? h('p', { className: 'tl-graph-evidence-empty' }, t('state.unknown'))
            : activeEdgePairGroups.map(([type, group]) =>
                h(
                  'div',
                  { key: type, className: 'tl-graph-evidence-group', 'data-evidence-type': type },
                  h('span', { className: 'tl-graph-evidence-type' }, t(group.labelKey)),
                  ...group.texts.map((text, index) => h('p', { key: index, className: 'tl-graph-evidence-text' }, text)),
                ),
              ),
        )

  const empty = props.files.length === 0
  const emptyTitle = props.emptyTitle ?? (props.mode === 'turn' ? t('graph.emptyTurn') : t('state.emptyFiles'))
  return h(
    'div',
    {
      className: GRAPH_CLASS,
      [GRAPH_DATA.root]: 'true',
      [GRAPH_DATA.mode]: props.mode,
      [GRAPH_DATA.directory]: props.directoryKey,
      'data-node-count': layout.shown,
      'data-file-count': layout.total,
      'data-reduced-motion': props.reducedMotion === true ? 'true' : 'false',
      'data-animate': viewChanged ? 'true' : 'false',
      'data-testid': props.testId,
    },
    h(
      'div',
      { className: 'tl-graph-head' },
      h(
        'div',
        { className: 'tl-graph-title' },
        t('graph.title'),
        h('span', { className: 'tl-graph-subtitle' }, subtitle),
      ),
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
    // 摘要条**始终占位**（目录视图里空着），hover 预览轮次时只换内容、不改高度；
    // 强制单行（33 §3 / 用户第 10 轮反馈：悬停时一行/两行切换导致画面上下跳）。
    h(
      'div',
      {
        className: 'tl-graph-summary',
        [GRAPH_DATA.status]: summary === null ? 'empty' : 'turn',
        'data-empty': summary === null ? 'true' : 'false',
        'aria-hidden': summary === null ? 'true' : undefined,
      },
      summary === null
        ? null
        : [
            h('b', { key: 'title', className: 'tl-graph-summary-title' }, 'T' + String(props.turn?.turn.n ?? '') + ' · ' + turnStatusLabel(props.turn?.turn.status ?? 'unknown', t)),
            h(
              'span',
              { key: 'read', className: 'tl-graph-chip', 'data-status': 'read' },
              h('i', { style: { background: STATUS_COLOR.read }, 'aria-hidden': true }),
              t('turnStatus.read', { n: summary.reads }),
            ),
            h(
              'span',
              { key: 'write', className: 'tl-graph-chip', 'data-status': 'write' },
              t('turnStatus.write', { add: summary.writeAdd, del: summary.writeDel }),
            ),
            h(
              'span',
              { key: 'first', className: 'tl-graph-chip', 'data-status': 'first' },
              t('turnStatus.firstSeen', { n: summary.firstSeen === null ? t('turnStatus.unknown') : summary.firstSeen }),
            ),
            h(
              'span',
              { key: 'delete', className: 'tl-graph-chip', 'data-status': 'delete', title: t('turnStatus.deleteCommands', { n: deleteText }) },
              t('turnStatus.deleteShort', { n: deleteText }),
            ),
          ],
    ),
    h(
      'div',
      { className: 'tl-graph-stage', ref: stageRef, 'data-graph-stage': 'true' },
      props.loading === true
        ? h(
            'div',
            { className: 'tl-graph-loading', role: 'status', [GRAPH_DATA.loading]: 'true' },
            h('span', { className: 'tl-graph-loading-dot', 'aria-hidden': true }),
            h('span', null, props.loadingLabel ?? (props.mode === 'turn' ? t('graph.loadingTurn', { n: props.turn?.turn.n ?? '' }) : t('graph.loading'))),
          )
        : empty
          ? h(EmptyState, { title: emptyTitle, mark: '◌', testId: 'graph-empty' })
          : h(
            'svg',
            {
              className: 'tl-graph-svg',
              key: 'svg:' + props.mode + ':' + props.directoryKey + ':' + String(props.turn?.turn.n ?? ''),
              viewBox: '0 0 ' + String(layout.width) + ' ' + String(layout.height),
              preserveAspectRatio: 'xMidYMid meet',
              role: 'group',
              'aria-label': t('graph.title'),
              tabIndex: 0,
              onClick: onStageClick,
              onKeyDown: onStageKeyDown,
            },
            h('rect', { x: 0, y: 0, width: 1, height: 1, fill: 'transparent', 'data-graph-background': 'true' }),
            ...visibleEdges.list.flatMap(({ pair, from, to }) => {
              const touchingFocus =
                focusKey !== null && (caseKey(pair.from) === focusKey || caseKey(pair.to) === focusKey)
              const opacity =
                focusKey === null
                  ? pair.typeList.includes('structure')
                    ? 0.28
                    : 0.42
                  : touchingFocus
                    ? 0.85
                    : 0.08
              const badge = pair.typeList.length > 1
              const elements: React.ReactElement[] = [
                h('line', {
                  key: 'e:' + pair.key,
                  className: 'tl-graph-edge',
                  [GRAPH_DATA.edge]: pair.key,
                  [GRAPH_DATA.edgePair]: pair.key,
                  [GRAPH_DATA.edgeTypes]: pair.typeList.join('|'),
                  'data-layer': pair.typeList[pair.typeList.length - 1],
                  'data-edge-from': pair.from,
                  'data-edge-to': pair.to,
                  'data-edge-count': pair.count,
                  x1: from.x,
                  y1: from.y,
                  x2: to.x,
                  y2: to.y,
                  strokeWidth: pair.typeList.includes('structure') ? 1 : 1.2,
                  strokeDasharray: pair.typeList.includes('coTurn') || pair.typeList.includes('coSession') ? '3 4' : undefined,
                  opacity,
                  onPointerEnter: () => setHoverEdgePairKey(pair.key),
                  onPointerLeave: () => setHoverEdgePairKey(null),
                  onClick: (event: React.MouseEvent) => {
                    event.stopPropagation()
                    setPinnedEdgePairKey((value) => (value === pair.key ? null : pair.key))
                  },
                }),
              ]
              if (badge) {
                elements.push(
                  h(
                    'text',
                    {
                      key: 'eb:' + pair.key,
                      className: 'tl-edge-badge',
                      x: (from.x + to.x) / 2,
                      y: (from.y + to.y) / 2 - 3,
                      textAnchor: 'middle',
                      'data-edge-badge': pair.key,
                    },
                    h('title', null, pair.typeList.map((type) => t(RELATION_MESSAGE_KEY[type])).join(' · ')),
                    '+' + String(pair.typeList.length - 1),
                  ),
                )
              }
              return elements
            }),
            ...nodeElements,
            ...labelElements,
          ),
      edgeEvidencePanel,
    ),
    h(
      'div',
      { className: 'tl-graph-foot' },
      h('span', { className: 'tl-graph-hint' }, props.mode === 'turn' ? t('graph.turnHint') : t('graph.directoryHint')),
      props.mode === 'turn'
        ? h(
            'span',
            { className: 'tl-graph-status-legend' },
            h('span', { className: 'tl-graph-chip' }, '· ', t('turnStatus.markRead', { n: 'N' })),
            h('span', { className: 'tl-graph-chip' }, t('turnStatus.markWriteAdd', { n: 'A' })),
            h('span', { className: 'tl-graph-chip' }, t('turnStatus.markWriteDel', { n: 'D' })),
            h('span', { className: 'tl-graph-chip' }, t('turnStatus.markFirstSeen')),
          )
        : null,
      layout.truncated
        ? h('span', { className: 'tl-graph-note', [GRAPH_DATA.truncated]: 'true' }, t('map.truncatedNodes', { shown: layout.shown, total: layout.total }))
        : null,
      nodeKeys.size === 0 && !empty && props.loading !== true ? h('span', { className: 'tl-graph-note' }, t('state.unknown')) : null,
      props.coverageNote !== undefined && props.coverageNote !== ''
        ? h('span', { className: 'tl-graph-note', [GRAPH_DATA.coverage]: 'true' }, props.coverageNote)
        : null,
    ),
  )
}
