/*
 * map/MapView.ts —— 星图（03 §4；验收 A41-1 / A41-2）。
 *
 * 纯展示：图（nodes/edges）、选择（selectedPath）、时间状态（now / visiblePaths / opsAt / selectedTurn）
 * 全部通过 props 进来；本组件**不注册 slot、不发请求、不读数据层单例**（T09 负责接线）。
 * 交互通过回调暴露：onSelectFile / onSelectEdge / onOpenFile / onViewportChange / onLayersChange。
 *
 * 不变量：
 * - 坐标只来自 layout.ts（确定性）；hover/选中只改透明度/描边，不改坐标；
 * - 时间轴变化只改可见性 / 透明度 / 半径，不改位置；
 * - 边只画 selectVisibleEdges 的结果（内部已过 finalizeGraph 的 12/4000 收拢）；
 * - 卸载：只清理自己容器上的 ResizeObserver / wheel 监听，无全局副作用。
 */
import * as React from 'react'
import type { FileFamily, FileNode } from '../../../shared/events/index.ts'
import { caseKey, type GraphEdge, type RelationType } from '../../../shared/relations/index.ts'
import { createTranslator, DEFAULT_LOCALE, type Locale, type MessageKey, type Translator } from '../../locale/index.ts'
import { Button, Chip, Legend } from '../common/index.ts'
import { estimateTextWidth, LABEL_ZOOM_THRESHOLD, placeLabels, type LabelCandidate, type OccupiedBox } from './labels.ts'
import { layoutMap, radiusFor, type LayoutNode, type MapLayout } from './layout.ts'
import {
  FOCUS_DIM_OPACITY,
  prepareEdges,
  RELATION_LEGEND_ORDER,
  selectVisibleEdges,
  type EdgeDraw,
  type RelationLayerToggles,
  type SelectedTurnRef,
} from './relations.ts'
import { FAMILY_COLOR, FAMILY_MESSAGE_KEY, FILE_FAMILIES, LAYER_LABEL_KEY, MAP_CLASS, MAP_DATA, MAP_ZOOM } from './theme.ts'
import {
  fitViewport,
  focusOnBox,
  IDENTITY_VIEWPORT,
  normalizeViewport,
  panByScreen,
  viewBoxOf,
  zoomAtPoint,
  zoomForActualPixels,
  type MapSize,
  type MapViewport,
  type WorldSize,
} from './viewport.ts'

const h = React.createElement

/** 星图 props（T09 接线契约）。 */
export interface MapViewProps {
  /** 工作区文件节点（T04 `graph.files` 的值；顺序无关）。 */
  nodes: readonly FileNode[]
  /** 产品级边（T05 `finalizeGraph` 的结果或其输入都行；内部会再收口一次）。 */
  edges?: readonly GraphEdge[]
  /** 受控选中（工作区相对路径）；null/undefined = 无选中。 */
  selectedPath?: string | null
  onSelectFile?: (path: string | null) => void
  onSelectEdge?: (edge: GraphEdge) => void
  onOpenFile?: (path: string) => void
  /** 当前轮次影响到的文件（强调环 + 轻微脉冲）。 */
  currentTurnPaths?: readonly string[]
  /** 本轮首次出现的文件（`+` 角标）。 */
  turnNewPaths?: readonly string[]
  /** "现在"（ms）。最近 24h 细环用它；组件不读时钟。 */
  now: number
  /** 时间轴播放态：可见文件集合；null/undefined = 全部可见。 */
  visiblePaths?: readonly string[] | null
  /** 截至播放头的累计 ops（生长）；缺省用 node.ops。 */
  opsAt?: Readonly<Record<string, number>> | null
  /** 选中轮次（非空时显示该轮时序边）。 */
  selectedTurn?: SelectedTurnRef | null
  /** 图层开关（受控；缺省按 03 §10 的默认值，点击后走 onLayersChange）。 */
  layers?: RelationLayerToggles
  onLayersChange?: (layers: RelationLayerToggles) => void
  showAllRelations?: boolean
  onShowAllRelationsChange?: (value: boolean) => void
  showAllReferences?: boolean
  onShowAllReferencesChange?: (value: boolean) => void
  /** 节点上限（默认 600）。 */
  maxNodes?: number
  locale?: Locale
  reducedMotion?: boolean
  showLegend?: boolean
  className?: string
  testId?: string
  /** 视口受控（T09 可放内存，保证刷新不跳回）。 */
  viewport?: MapViewport
  onViewportChange?: (viewport: MapViewport) => void
  /** 时间格式化（tooltip 用）；缺省用本地时间字符串。 */
  formatTime?: (at: number) => string
  /** 文件族文案（locale 无此 key；缺省显示族 id）。 */
  familyLabels?: Partial<Record<FileFamily, string>>
  /** 节点上限文案（locale 无此 key；缺省显示 `shown/total`）。 */
  nodeLimitLabel?: (shown: number, total: number) => string
}

const DAY_MS = 24 * 60 * 60 * 1000

interface DragState {
  pointerId: number
  startX: number
  startY: number
  lastX: number
  lastY: number
  moved: boolean
}

interface EdgeGeometry {
  draw: EdgeDraw
  from: LayoutNode
  to: LayoutNode
  mid: { x: number; y: number }
}

function defaultFormatTime(at: number): string {
  const date = new Date(at)
  const pad = (value: number): string => (value < 10 ? '0' + value : String(value))
  return (
    date.getFullYear() +
    '-' +
    pad(date.getMonth() + 1) +
    '-' +
    pad(date.getDate()) +
    ' ' +
    pad(date.getHours()) +
    ':' +
    pad(date.getMinutes())
  )
}

/** 星图。viewBox 固定为世界尺寸；「适应」= zoom 1 / pan 0，「100%」= 1 世界单位 = 1 CSS px。 */
export function MapView(props: MapViewProps): React.ReactElement {
  const locale: Locale = props.locale ?? DEFAULT_LOCALE
  const t: Translator = React.useMemo(() => createTranslator(locale), [locale])
  const formatTime = props.formatTime ?? defaultFormatTime

  const rootRef = React.useRef<HTMLDivElement | null>(null)
  const svgRef = React.useRef<SVGSVGElement | null>(null)
  const nodeEls = React.useRef(new Map<string, SVGGElement | null>())
  const dragRef = React.useRef<DragState | null>(null)
  const pendingFocus = React.useRef<string | null>(null)
  const layoutCache = React.useRef<MapLayout | null>(null)

  const [size, setSize] = React.useState<MapSize>({ width: 0, height: 0 })
  const [hoverPath, setHoverPath] = React.useState<string | null>(null)
  const [hoverEdgeId, setHoverEdgeId] = React.useState<string | null>(null)
  const [focusedCluster, setFocusedCluster] = React.useState<string | null>(null)
  const [keyboardPath, setKeyboardPath] = React.useState<string | null>(null)
  const [organizeToken, setOrganizeToken] = React.useState(0)
  const [internalViewport, setInternalViewport] = React.useState<MapViewport>(IDENTITY_VIEWPORT)
  const [internalLayers, setInternalLayers] = React.useState<RelationLayerToggles>({})
  const [internalShowAllRelations, setInternalShowAllRelations] = React.useState(false)
  const [internalShowAllReferences, setInternalShowAllReferences] = React.useState(false)

  const viewport = props.viewport ?? internalViewport
  const showAllRelations = props.showAllRelations ?? internalShowAllRelations
  const showAllReferences = props.showAllReferences ?? internalShowAllReferences
  const layers: RelationLayerToggles = props.layers ?? internalLayers

  /* ---------- 布局（确定性 + 刷新复用坐标） ---------- */
  const layout = React.useMemo(() => {
    const next = layoutMap(props.nodes, {
      ...(props.maxNodes === undefined ? {} : { maxNodes: props.maxNodes }),
      previous: layoutCache.current,
      force: organizeToken > 0,
    })
    layoutCache.current = next
    return next
  }, [props.nodes, props.maxNodes, organizeToken])
  const world: WorldSize = React.useMemo(() => ({ width: layout.width, height: layout.height }), [layout.width, layout.height])

  const nodeByPath = React.useMemo(() => {
    const map = new Map<string, LayoutNode>()
    for (const node of layout.nodes) map.set(node.path, node)
    return map
  }, [layout])
  const nodeByKey = React.useMemo(() => {
    const map = new Map<string, LayoutNode>()
    for (const node of layout.nodes) map.set(caseKey(node.path), node)
    return map
  }, [layout])

  /* ---------- 时间轴过滤（只改可见性 / 大小，不改坐标） ---------- */
  const visibleKeySet = React.useMemo(() => {
    if (props.visiblePaths === null || props.visiblePaths === undefined) return null
    const set = new Set<string>()
    for (const path of props.visiblePaths) set.add(caseKey(path))
    return set
  }, [props.visiblePaths])
  const isVisible = React.useCallback(
    (path: string): boolean => visibleKeySet === null || visibleKeySet.has(caseKey(path)),
    [visibleKeySet],
  )

  const opsOf = React.useCallback(
    (node: LayoutNode): number =>
      props.opsAt === null || props.opsAt === undefined ? node.ops : (props.opsAt[node.path] ?? node.ops),
    [props.opsAt],
  )
  const maxOps = React.useMemo(() => {
    let max = 0
    for (const node of layout.nodes) {
      const value = opsOf(node)
      if (value > max) max = value
    }
    return max
  }, [layout, opsOf])

  /* ---------- 焦点 / 边 ---------- */
  const selectedPath = props.selectedPath ?? null
  const focusPath = hoverPath ?? selectedPath
  const focusKey = focusPath === null ? null : caseKey(focusPath)
  const edgeGraph = React.useMemo(() => prepareEdges(props.edges ?? []), [props.edges])
  const edgeView = React.useMemo(
    () =>
      selectVisibleEdges(edgeGraph, {
        focus: { key: focusKey },
        showAllRelations,
        showAllReferences,
        layers,
        selectedTurn: props.selectedTurn ?? null,
      }),
    [edgeGraph, focusKey, showAllRelations, showAllReferences, layers, props.selectedTurn],
  )

  const edgeGeometry = React.useMemo(() => {
    const result: EdgeGeometry[] = []
    for (const draw of edgeView.drawn) {
      const from = nodeByPath.get(draw.edge.from) ?? nodeByKey.get(caseKey(draw.edge.from))
      const to = nodeByPath.get(draw.edge.to) ?? nodeByKey.get(caseKey(draw.edge.to))
      if (!from || !to) continue
      if (!isVisible(from.path) || !isVisible(to.path)) continue
      result.push({ draw, from, to, mid: { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 } })
    }
    return result
  }, [edgeView, nodeByPath, nodeByKey, isVisible])

  const nodeDegree = React.useMemo(() => {
    const degree = new Map<string, number>()
    for (const item of edgeGeometry) {
      const from = caseKey(item.draw.edge.from)
      const to = caseKey(item.draw.edge.to)
      degree.set(from, (degree.get(from) ?? 0) + 1)
      degree.set(to, (degree.get(to) ?? 0) + 1)
    }
    return degree
  }, [edgeGeometry])

  const newKeySet = React.useMemo(() => new Set((props.turnNewPaths ?? []).map((path) => caseKey(path))), [props.turnNewPaths])
  const currentKeySet = React.useMemo(() => new Set((props.currentTurnPaths ?? []).map((path) => caseKey(path))), [props.currentTurnPaths])

  /* ---------- 尺寸测量（只碰自己的容器） ---------- */
  React.useEffect(() => {
    const element = rootRef.current
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

  /* ---------- 视口提交（受控/非受控统一入口） ---------- */
  const onChangeViewport = props.onViewportChange
  const commitViewport = React.useCallback(
    (next: MapViewport): void => {
      const normalized = normalizeViewport(next, MAP_ZOOM.min, MAP_ZOOM.max)
      if (props.viewport === undefined) setInternalViewport(normalized)
      onChangeViewport?.(normalized)
    },
    [props.viewport, onChangeViewport],
  )
  const stateRef = React.useRef({ viewport, size, world, commitViewport })
  stateRef.current = { viewport, size, world, commitViewport }

  /* ---------- 滚轮缩放（passive:false，必须原生监听） ---------- */
  React.useEffect(() => {
    const svg = svgRef.current
    if (!svg) return undefined
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault()
      const current = stateRef.current
      const rect = svg.getBoundingClientRect()
      const pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top }
      const factor = event.deltaY < 0 ? MAP_ZOOM.step : 1 / MAP_ZOOM.step
      current.commitViewport(
        zoomAtPoint(current.viewport, current.viewport.zoom * factor, pointer, current.size, current.world, MAP_ZOOM.min, MAP_ZOOM.max),
      )
    }
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
  }, [])

  /* ---------- 方向键导航后把焦点落到节点上 ---------- */
  React.useEffect(() => {
    const target = pendingFocus.current
    if (!target) return
    pendingFocus.current = null
    const element = nodeEls.current.get(target)
    if (element && typeof element.focus === 'function') element.focus()
  }, [keyboardPath])

  /* ---------- 视口动作 ---------- */
  const zoomBy = React.useCallback(
    (factor: number): void => {
      commitViewport(
        zoomAtPoint(viewport, viewport.zoom * factor, { x: size.width / 2, y: size.height / 2 }, size, world, MAP_ZOOM.min, MAP_ZOOM.max),
      )
    },
    [commitViewport, viewport, size, world],
  )

  const handleFit = React.useCallback((): void => {
    setFocusedCluster(null)
    commitViewport(fitViewport())
  }, [commitViewport])

  const handleActualPixels = React.useCallback((): void => {
    commitViewport({ zoom: zoomForActualPixels(size, world), panX: 0, panY: 0 })
  }, [commitViewport, size, world])

  const handleOrganize = React.useCallback((): void => {
    setOrganizeToken((value) => value + 1)
    setFocusedCluster(null)
    commitViewport(fitViewport())
  }, [commitViewport])

  const focusCluster = React.useCallback(
    (clusterKey: string): void => {
      const cluster = layout.clusters.find((item) => item.key === clusterKey)
      if (!cluster) return
      if (focusedCluster === clusterKey) {
        setFocusedCluster(null)
        commitViewport(fitViewport())
        return
      }
      setFocusedCluster(clusterKey)
      commitViewport(
        focusOnBox({ x: cluster.x, y: cluster.y, width: cluster.width, height: cluster.height }, size, world, MAP_ZOOM.max),
      )
    },
    [layout, focusedCluster, commitViewport, size, world],
  )

  /* ---------- 指针：平移 + 空白取消 ---------- */
  const pointerDown = (event: React.PointerEvent<SVGSVGElement>): void => {
    if (event.button !== 0) return
    const target = event.target as Element
    const onBackground = target === event.currentTarget || target.getAttribute('data-map-background') === 'true'
    if (!onBackground) return
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, lastX: event.clientX, lastY: event.clientY, moved: false }
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      /* 合成事件没有 pointer capture；不影响点击语义 */
    }
  }

  const pointerMove = (event: React.PointerEvent<SVGSVGElement>): void => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const dx = event.clientX - drag.lastX
    const dy = event.clientY - drag.lastY
    if (Math.abs(event.clientX - drag.startX) + Math.abs(event.clientY - drag.startY) > 3) drag.moved = true
    drag.lastX = event.clientX
    drag.lastY = event.clientY
    if (!drag.moved) return
    commitViewport(panByScreen(viewport, dx, dy, size, world))
  }

  const pointerUp = (event: React.PointerEvent<SVGSVGElement>): void => {
    const drag = dragRef.current
    dragRef.current = null
    if (!drag || drag.pointerId !== event.pointerId) return
    if (drag.moved) return
    setFocusedCluster(null)
    props.onSelectFile?.(null)
  }

  /* ---------- 键盘 ---------- */
  const visibleNodes = React.useMemo(() => {
    const list = layout.nodes.filter((node) => isVisible(node.path))
    list.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))
    return list
  }, [layout, isVisible])

  const nearestInDirection = React.useCallback(
    (origin: LayoutNode, key: string): LayoutNode | null => {
      let best: LayoutNode | null = null
      let bestScore = Number.POSITIVE_INFINITY
      for (const node of visibleNodes) {
        if (node.path === origin.path) continue
        const dx = node.x - origin.x
        const dy = node.y - origin.y
        let primary = 0
        let perpendicular = 0
        if (key === 'ArrowRight') {
          primary = dx
          perpendicular = Math.abs(dy)
        } else if (key === 'ArrowLeft') {
          primary = -dx
          perpendicular = Math.abs(dy)
        } else if (key === 'ArrowUp') {
          primary = -dy
          perpendicular = Math.abs(dx)
        } else {
          primary = dy
          perpendicular = Math.abs(dx)
        }
        if (primary <= 1) continue
        const score = primary + perpendicular * 1.5
        if (score < bestScore || (score === bestScore && best !== null && node.path < best.path)) {
          best = node
          bestScore = score
        }
      }
      return best
    },
    [visibleNodes],
  )

  const handleKeyDown = (event: React.KeyboardEvent<SVGSVGElement>): void => {
    if (event.key === '+' || event.key === '=') {
      event.preventDefault()
      zoomBy(MAP_ZOOM.step)
      return
    }
    if (event.key === '-' || event.key === '_') {
      event.preventDefault()
      zoomBy(1 / MAP_ZOOM.step)
      return
    }
    if (event.key === '0') {
      event.preventDefault()
      handleFit()
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      setFocusedCluster(null)
      setHoverPath(null)
      setKeyboardPath(null)
      props.onSelectFile?.(null)
      return
    }
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    const from = keyboardPath ?? selectedPath
    const current = from === null ? null : nodeByPath.get(from) ?? nodeByKey.get(caseKey(from))
    if (!current) {
      const first = visibleNodes[0]
      if (!first) return
      event.preventDefault()
      pendingFocus.current = first.path
      setKeyboardPath(first.path)
      return
    }
    const next = nearestInDirection(current, event.key)
    if (!next) return
    event.preventDefault()
    pendingFocus.current = next.path
    setKeyboardPath(next.path)
  }

  /* ---------- 渲染数据 ---------- */
  const renderNodes = React.useMemo(() => layout.nodes.filter((node) => isVisible(node.path)), [layout, isVisible])
  const renderClusters = React.useMemo(() => {
    if (visibleKeySet === null) return layout.clusters
    const keys = new Set(renderNodes.map((node) => node.cluster))
    return layout.clusters.filter((cluster) => keys.has(cluster.key))
  }, [layout.clusters, renderNodes, visibleKeySet])

  const showFileLabels = viewport.zoom >= LABEL_ZOOM_THRESHOLD
  const { placements } = React.useMemo(() => {
    const candidates: LabelCandidate[] = []
    const occupied: OccupiedBox[] = []
    for (const cluster of renderClusters) {
      occupied.push({ x: cluster.x + 2, y: cluster.y, width: estimateTextWidth(cluster.label, 11) + 12, height: 16 })
    }
    for (const node of renderNodes) {
      const isSelected = node.path === selectedPath
      const isHovered = node.path === hoverPath
      if (!showFileLabels && !isSelected && !isHovered) continue
      candidates.push({
        key: node.path,
        text: node.name,
        x: node.x + node.r + 4,
        y: node.y - 6,
        width: estimateTextWidth(node.name, 11),
        height: 12,
        priority: isSelected ? 1000 : isHovered ? 900 : node.ops,
        force: isSelected || isHovered,
      })
    }
    return { placements: placeLabels(candidates, occupied) }
  }, [renderClusters, renderNodes, showFileLabels, selectedPath, hoverPath])
  const placementByKey = React.useMemo(() => new Map(placements.map((item) => [item.key, item])), [placements])

  const hoveredNode = hoverPath === null ? null : nodeByPath.get(hoverPath) ?? nodeByKey.get(caseKey(hoverPath)) ?? null
  const hoveredEdge = hoverEdgeId === null ? null : edgeGeometry.find((item) => item.draw.edge.id === hoverEdgeId) ?? null
  const tooltipData = React.useMemo(() => {
    if (hoveredEdge) {
      return {
        title: t(LAYER_LABEL_KEY[hoveredEdge.draw.type] as MessageKey),
        lines: [hoveredEdge.draw.edge.evidence.text],
        anchor: { x: hoveredEdge.mid.x, y: hoveredEdge.mid.y },
      }
    }
    if (!hoveredNode) return null
    return {
      title: hoveredNode.name,
      lines: [
        hoveredNode.path,
        t('inspector.ops') + ': ' + opsOf(hoveredNode),
        t('inspector.lastTouched') + ': ' + formatTime(hoveredNode.lastAt),
        t('relations.title') + ': ' + (nodeDegree.get(caseKey(hoveredNode.path)) ?? 0),
      ],
      anchor: { x: hoveredNode.x + hoveredNode.r + 6, y: hoveredNode.y - 6 },
    }
  }, [hoveredEdge, hoveredNode, opsOf, formatTime, nodeDegree, t])

  /* ---------- 工具提示（屏幕坐标，字号不随缩放变化） ---------- */
  const tooltip = React.useMemo(() => {
    if (!tooltipData || size.width <= 0 || size.height <= 0) return null
    const width = Math.max(estimateTextWidth(tooltipData.title, 11), ...tooltipData.lines.map((line) => estimateTextWidth(line, 11))) + 16
    const height = 10 + 14 * (tooltipData.lines.length + 1)
    const scale = Math.min(
      Math.max(1, size.width) / Math.max(1, world.width),
      Math.max(1, size.height) / Math.max(1, world.height),
    )
    const screenX = Math.min(Math.max((tooltipData.anchor.x + viewport.panX) * viewport.zoom * scale + 8, 4), Math.max(4, size.width - width - 4))
    const screenY = Math.min(Math.max((tooltipData.anchor.y + viewport.panY) * viewport.zoom * scale - height / 2, 4), Math.max(4, size.height - height - 4))
    return h(
      'g',
      { className: 'tl-map-tooltip', transform: 'translate(' + Math.round(screenX) + ' ' + Math.round(screenY) + ')', 'aria-hidden': true },
      h('rect', { className: 'tl-map-tooltip-bg', x: 0, y: 0, width: Math.round(width), height: Math.round(height), rx: 8, ry: 8 }),
      h('text', { className: 'tl-map-tooltip-title', x: 8, y: 16 }, tooltipData.title),
      ...tooltipData.lines.map((line, index) => h('text', { key: index, className: 'tl-map-tooltip-line', x: 8, y: 30 + index * 14 }, line)),
    )
  }, [tooltipData, size, world, viewport])

  /* ---------- SVG ids（同页多实例也不冲突） ---------- */
  const uid = React.useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const arrowId = 'tl-arrow-' + uid
  const gridId = 'tl-grid-' + uid

  /* ---------- 图层开关（受控优先；未受控用内部状态） ---------- */
  const setLayer = (type: RelationType, next: boolean): void => {
    if (props.layers !== undefined) {
      props.onLayersChange?.({ ...props.layers, [type]: next })
      return
    }
    setInternalLayers((previous) => ({ ...previous, [type]: next }))
  }
  const isLayerOn = (type: RelationType): boolean => {
    if (type === 'structure') return layers.structure ?? true
    if (type === 'coTurn') return layers.coTurn ?? true
    if (type === 'coSession') return layers.coSession ?? false
    if (type === 'sequence') return layers.sequence ?? false
    return layers.reference ?? true
  }

  /* ---------- 子元素 ---------- */
  const clusterElements = renderClusters.map((cluster) =>
    h(
      'g',
      {
        key: 'c:' + cluster.key,
        className: 'tl-cluster',
        [MAP_DATA.cluster]: cluster.key,
        'data-focused': focusedCluster === cluster.key ? 'true' : 'false',
      },
      h('rect', {
        className: 'tl-cluster-box',
        x: cluster.x,
        y: cluster.y,
        width: cluster.width,
        height: cluster.height,
        rx: 10,
        ry: 10,
        'data-cluster-bounds': 'true',
      }),
      h(
        'text',
        {
          className: 'tl-cluster-label',
          x: cluster.x + 8,
          y: cluster.y + 13,
          role: 'button',
          tabIndex: 0,
          'aria-label': cluster.label + ' · ' + cluster.count,
          onPointerDown: (event: React.PointerEvent) => event.stopPropagation(),
          onClick: (event: React.MouseEvent) => {
            event.stopPropagation()
            focusCluster(cluster.key)
          },
          onKeyDown: (event: React.KeyboardEvent) => {
            if (event.key !== 'Enter' && event.key !== ' ') return
            event.preventDefault()
            focusCluster(cluster.key)
          },
        },
        cluster.label,
      ),
      h(
        'text',
        { className: 'tl-cluster-count', x: cluster.x + 8 + estimateTextWidth(cluster.label, 11) + 6, y: cluster.y + 13 },
        String(cluster.count),
      ),
    ),
  )

  const edgeElements = edgeGeometry.map(({ draw, from, to, mid }) =>
    h(
      'g',
      {
        key: 'e:' + draw.edge.id,
        className: 'tl-edge',
        [MAP_DATA.edge]: draw.edge.id,
        'data-layer': draw.type,
        onPointerEnter: () => setHoverEdgeId(draw.edge.id),
        onPointerLeave: () => setHoverEdgeId((value) => (value === draw.edge.id ? null : value)),
      },
      h('line', {
        className: 'tl-edge-line',
        x1: from.x,
        y1: from.y,
        x2: to.x,
        y2: to.y,
        strokeWidth: draw.width,
        ...(draw.dashed ? { strokeDasharray: '4 3' } : {}),
        ...(draw.directed ? { markerEnd: 'url(#' + arrowId + ')' } : {}),
      }),
      h('line', {
        className: 'tl-edge-hit',
        x1: from.x,
        y1: from.y,
        x2: to.x,
        y2: to.y,
        onClick: (event: React.MouseEvent) => {
          event.stopPropagation()
          props.onSelectEdge?.(draw.edge)
        },
      }),
      h('title', null, draw.edge.evidence.text),
      draw.order === undefined ? null : h('text', { className: 'tl-edge-order', x: mid.x + 4, y: mid.y - 4 }, String(draw.order)),
    ),
  )

  const nodeElements = renderNodes.map((node) => {
    const key = caseKey(node.path)
    const dimmed = focusKey !== null && !edgeView.neighbors.has(key)
    const ops = opsOf(node)
    const radius = radiusFor(ops, maxOps)
    const isSelected = node.path === selectedPath
    const isHovered = node.path === hoverPath
    const isCurrent = currentKeySet.has(key)
    const isNew = newKeySet.has(key)
    const recent = node.lastAt >= props.now - DAY_MS
    const fill = FAMILY_COLOR[node.family]
    const label = placementByKey.get(node.path)
    const roving = keyboardPath === node.path || (keyboardPath === null && layout.nodes[0]?.path === node.path)
    return h(
      'g',
      {
        key: 'n:' + node.path,
        ref: (element: SVGGElement | null) => {
          nodeEls.current.set(node.path, element)
        },
        className: 'tl-node',
        [MAP_DATA.node]: node.path,
        'data-x': node.x,
        'data-y': node.y,
        'data-family': node.family,
        'data-ops': ops,
        'data-dim': dimmed ? 'true' : 'false',
        'data-opacity': dimmed ? FOCUS_DIM_OPACITY : 1,
        'data-selected': isSelected ? 'true' : 'false',
        'data-visible': 'true',
        role: 'button',
        tabIndex: roving ? 0 : -1,
        'aria-label': node.name + ' · ' + t('inspector.ops') + ' ' + ops,
        onPointerEnter: () => setHoverPath(node.path),
        onPointerLeave: () => setHoverPath((value) => (value === node.path ? null : value)),
        onFocus: () => setKeyboardPath(node.path),
        onClick: (event: React.MouseEvent) => {
          event.stopPropagation()
          props.onSelectFile?.(node.path)
        },
        onDoubleClick: (event: React.MouseEvent) => {
          event.stopPropagation()
          props.onOpenFile?.(node.path)
        },
        onKeyDown: (event: React.KeyboardEvent) => {
          if (event.key !== 'Enter' && event.key !== ' ') return
          event.preventDefault()
          props.onSelectFile?.(node.path)
        },
      },
      h('title', null, node.path + ' · ' + t('inspector.ops') + ' ' + ops),
      recent
        ? h('circle', {
            className: 'tl-node-halo',
            cx: node.x,
            cy: node.y,
            r: radius + 2.5,
            fill: 'none',
            stroke: fill,
            strokeWidth: 0.8,
            opacity: 0.5,
          })
        : null,
      isCurrent
        ? h('circle', {
            className: 'tl-node-ring-current',
            cx: node.x,
            cy: node.y,
            r: radius + 4.5,
            fill: 'none',
            stroke: 'var(--tl-accent)',
            strokeWidth: 1.4,
          })
        : null,
      isSelected
        ? h('circle', {
            className: 'tl-node-halo',
            cx: node.x,
            cy: node.y,
            r: radius + 3.5,
            fill: 'none',
            stroke: 'var(--tl-accent)',
            strokeWidth: 1.6,
          })
        : null,
      h('circle', {
        className: 'tl-node-core',
        cx: node.x,
        cy: node.y,
        r: radius,
        fill,
        fillOpacity: 0.85,
        stroke: fill,
        strokeWidth: 0.8,
      }),
      isNew
        ? h('text', { className: 'tl-label', x: node.x + radius + 2, y: node.y - radius - 2, 'data-new': 'true' }, '+')
        : null,
      label && label.visible
        ? h(
            'text',
            {
              className: 'tl-label',
              x: label.x,
              y: label.y + 9,
              [MAP_DATA.label]: node.path,
              'data-selected': isSelected ? 'true' : 'false',
              'data-hover': isHovered ? 'true' : 'false',
            },
            label.text,
          )
        : null,
    )
  })

  const toolbar = h(
    'div',
    { className: 'tl-map-toolbar', role: 'group', 'aria-label': t('legend.title') },
    h(Button, { label: t('map.fit'), onClick: handleFit, testId: 'map-fit' }),
    h(Button, { label: t('map.reset'), onClick: handleActualPixels, testId: 'map-reset' }),
    h(Button, {
      label: t('map.showAllRelations'),
      pressed: showAllRelations,
      onClick: () => {
        const next = !showAllRelations
        if (props.showAllRelations === undefined) setInternalShowAllRelations(next)
        props.onShowAllRelationsChange?.(next)
      },
      testId: 'map-show-all-relations',
    }),
    h(Button, {
      label: t('relations.reference'),
      pressed: showAllReferences,
      onClick: () => {
        const next = !showAllReferences
        if (props.showAllReferences === undefined) setInternalShowAllReferences(next)
        props.onShowAllReferencesChange?.(next)
      },
      testId: 'map-show-all-references',
    }),
    h(Button, { label: t('ui.expand'), onClick: handleOrganize, testId: 'map-organize' }),
  )

  const layerItems = RELATION_LEGEND_ORDER.map((type) =>
    h(
      'li',
      { key: type },
      h(Chip, {
        label: t(LAYER_LABEL_KEY[type] as MessageKey),
        count: edgeView.visibleByType[type],
        active: isLayerOn(type),
        onClick: () => setLayer(type, !isLayerOn(type)),
        title: t(LAYER_LABEL_KEY[type] as MessageKey),
        testId: 'map-layer-' + type,
      }),
    ),
  )

  const nodeLimitText = props.nodeLimitLabel?.(layout.truncation.shown, layout.truncation.total) ?? t('map.truncatedNodes', { shown: layout.truncation.shown, total: layout.truncation.total })
  const collapsedText = t('relations.collapsed', { n: edgeView.truncation.dropped })

  const legend =
    props.showLegend === false
      ? null
      : h(
          'div',
          { className: 'tl-map-legend', [MAP_DATA.legend]: 'true' },
          h(Legend, {
            title: t('legend.title'),
            items: FILE_FAMILIES.map((family) => ({ kind: family, label: props.familyLabels?.[family] ?? t(FAMILY_MESSAGE_KEY[family]) })),
            testId: 'map-family-legend',
          }),
          h('ul', { className: 'tl-map-layer-list', 'aria-label': t('relations.title') }, ...layerItems),
          layout.truncation.truncated
            ? h('span', { className: 'tl-map-note', 'data-map-node-limit': 'true', title: nodeLimitText }, nodeLimitText)
            : null,
          edgeView.truncation.truncated
            ? h('span', { className: 'tl-map-note', 'data-map-edge-limit': 'true', title: t('relations.tooMany') }, collapsedText)
            : null,
        )

  return h(
    'div',
    {
      ref: rootRef,
      className: [MAP_CLASS, props.className].filter(Boolean).join(' '),
      [MAP_DATA.root]: 'true',
      'data-zoom': viewport.zoom,
      'data-node-count': renderNodes.length,
      'data-total-node-count': layout.total,
      'data-edge-count': edgeGeometry.length,
      'data-edge-total-count': edgeView.graph.edges.length,
      'data-truncated': layout.truncation.truncated || edgeView.truncation.truncated ? 'true' : 'false',
      'data-reduced-motion': props.reducedMotion === true ? 'true' : 'false',
      'data-testid': props.testId,
    },
    h(
      'svg',
      {
        ref: svgRef,
        className: 'tl-map-svg',
        viewBox: viewBoxOf(world),
        preserveAspectRatio: 'xMidYMid meet',
        role: 'group',
        'aria-label': t('tab.title'),
        tabIndex: 0,
        onPointerDown: pointerDown,
        onPointerMove: pointerMove,
        onPointerUp: pointerUp,
        onPointerCancel: pointerUp,
        onKeyDown: handleKeyDown,
        'data-zoom': viewport.zoom,
      },
      h(
        'defs',
        null,
        h(
          'pattern',
          { id: gridId, width: 24, height: 24, patternUnits: 'userSpaceOnUse' },
          h('path', { d: 'M24 0H0V24', fill: 'none', stroke: 'var(--tl-border-weak)', strokeWidth: 0.5 }),
        ),
        h(
          'marker',
          { id: arrowId, viewBox: '0 0 8 8', refX: 7, refY: 4, markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse' },
          h('path', { d: 'M0,0 L8,4 L0,8 z', fill: 'context-stroke' }),
        ),
      ),
      h('rect', { key: 'bg', x: 0, y: 0, width: 1, height: 1, fill: 'transparent', 'data-map-background': 'true' }),
      h(
        'g',
        { key: 'world', transform: 'translate(' + viewport.panX + ' ' + viewport.panY + ') scale(' + viewport.zoom + ')' },
        h('rect', {
          className: 'tl-map-grid',
          x: 0,
          y: 0,
          width: Math.max(1, world.width),
          height: Math.max(1, world.height),
          fill: 'url(#' + gridId + ')',
          'data-map-background': 'true',
        }),
        ...clusterElements,
        ...edgeElements,
        ...nodeElements,
      ),
      tooltip,
    ),
    toolbar,
    legend,
  )
}

export type { RelationLayerToggles, SelectedTurnRef }
