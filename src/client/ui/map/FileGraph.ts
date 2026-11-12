/**
 * map/FileGraph.ts —— 左列「文件关系图」的唯一入口（folder / turn 两种模式）。
 *
 * 单一执行路径（01 §4.2 / R04 / R10）：
 * - `folder`：当前目录**关系图**（`FolderMap.ts`）—— 力导向布局 + 常驻分层边 +
 *   文件夹枢纽（跨目录真实关系聚合）+ 「显示全部」chip；
 * - `turn`：某一轮涉及的文件（可跨目录）—— 轮次状态小字 + 摘要条，仍保留该能力。
 *
 * 已删除（不保留兼容分支）：
 * - `overview`（全工作区星图总览）与 `directory`（按会话触碰聚合的目录图）两种旧模式；
 * - 星图簇布局 / 逐层下钻 / 关系类型 chip / 图尾提示与覆盖说明（`.tl-graph-foot` 整块）；
 * - R10：folder 的**等宽网格**布局与「文件夹排一条带 + 文件排网格」分区（用户 2026-11-08 否掉）。
 *
 * 数据诚实：文件级删除/新增不可证；本轮只显示读 / 写行数 / 首见，
 * 删除只在摘要里显示命令计数；未触碰文件是**中性节点**，不显示成「0 次操作」。
 */
import * as React from 'react'
import type { FileFamily, FileNode, TurnDetail } from '../../../shared/events/index.ts'
import { caseKey, type GraphEdge } from '../../../shared/relations/index.ts'
import { createTranslator, DEFAULT_LOCALE, type Locale, type Translator } from '../../locale/index.ts'
import { EmptyState } from '../common/index.ts'
import type { FileTurnStatus, TurnStatusSnapshot } from '../turns/status.ts'
import { cameraTransform, DEFAULT_CAMERA, GRAPH_ZOOM_STEP, resetCamera, zoomCameraAtCenter, type GraphCamera } from './camera.ts'
import { FolderMap } from './FolderMap.ts'
import type { MapEntry } from './folderLayout.ts'
import { estimateTextWidth, GRAPH_LABEL_FONT_PX, GRAPH_STATUS_FONT_PX, placeLabels, type LabelCandidate, type OccupiedBox } from './labels.ts'
import { aggregateEdgePairs, type EdgePair } from './pairs.ts'
import { graphRadius, layoutFileGraph, type GraphLayout, type GraphLayoutNode, type GraphSourceFile } from './graphLayout.ts'
import { FAMILY_COLOR, FAMILY_MESSAGE_KEY, enterStyleOf, GRAPH_CLASS, GRAPH_DATA, GRAPH_EDGE_LIMITS, GRAPH_LABEL_LIMITS, RELATION_MESSAGE_KEY, STATUS_COLOR } from './theme.ts'
import { ZoomGroup } from './zoomGroup.ts'
import { DEFAULT_LAYOUT_DURATION_MS, projectGraphFrame, useNodeFramesState } from './useSceneClock.ts'
import { enterOrigin, nodeFramesOfGraph } from './sceneClock.ts'

import { graphSkeleton } from './skeleton.ts'

const h = React.createElement

/** 本轮信息（turn 视图用；由入口算好状态后传入）。 */
export interface FileGraphTurn {
  turn: TurnDetail
  status: TurnStatusSnapshot
}

/** 两种模式（旧的 'overview' / 'directory' 已删除）。 */
export type GraphMode = 'folder' | 'turn'

export interface FileGraphProps {
  /**
   * 图模式。
   * - `folder`：当前目录节点图（需要 `entries` + `currentPath`）；
   * - `turn`：某一轮涉及的文件（需要 `turn`）。
   */
  mode: GraphMode
  /**
   * 当前目录的直接 entries（folder 模式必给）：目录进枢纽卡、文件/other 进网格。
   * 未触碰的文件也要在这里出现（会成为中性节点，不是"0 次操作"）。
   */
  entries?: readonly MapEntry[]
  /** 有会话数据的文件（touched 叠加）。folder 模式只取当前目录的直接文件；turn 模式 = 本轮文件。 */
  files: readonly FileNode[]
  /** 产品级边（内部会按"两端都在当前节点集合内"过滤后绘制）。folder 默认常驻分层画（L1+L2）。 */
  edges?: readonly GraphEdge[]
  /**
   * **全量**边集（未按当前目录过滤）：folder 模式专用，只用于把「当前目录文件 ↔ 子文件夹内文件」
   * 的真实跨目录边聚合到文件夹枢纽（线宽 = 聚合权重）。
   *
   * - `undefined`（缺省）：**不做枢纽聚合、不画任何枢纽连线**（不伪造关系）；
   * - 没有真实跨目录关系的枢纽放外围环 + tooltip 说明（`graph.hubEmpty`）。
   *
   * tab 侧接线：`allEdges: edges`（未过滤的产品级边）。
   */
  allEdges?: readonly GraphEdge[]
  /** 当前目录（'' = 工作区根）；folder 模式的标题与过滤依据。 */
  currentPath?: string
  /** 本轮信息（mode === 'turn' 时必给）。 */
  turn?: FileGraphTurn | null
  /** 当前选中的文件（图内点击）。 */
  selectedPath?: string | null
  /**
   * 受控 hover（右栏 → 左图的跨栏联动）；`undefined` = 用组件内部 hover。
   * 显式 `null` = 外部没有 hover。
   */
  hoveredPath?: string | null
  onSelectFile?: (path: string | null) => void
  onOpenFile?: (path: string) => void
  /** hover 文件节点（用于右栏/轮次联动）；离开节点传 null。 */
  onHoverFile?: (path: string | null) => void
  /** 点文件夹枢纽 → 让右栏进入该目录（双击 / Shift+Enter）。 */
  onEnterFolder?: (path: string) => void
  /** 当前选中的文件夹枢纽（单击只选中；与文件选中互斥）。 */
  selectedFolderPath?: string | null
  onSelectFolder?: (path: string | null) => void
  /** 证据数据上报（父级放进时间线区域渲染）。 */
  onEvidence?: (model: import('./evidence.ts').EvidenceModel | null) => void
  /** 退出本轮视图（再点该轮 / 点空白 / Esc）。 */
  onExitTurn?: () => void
  /** 播放头（null = 跟随现在）；非 null 时 firstAt 晚于它的节点隐藏。 */
  visibleAt?: number | null
  now: number
  /** 时间格式化（建议与 rail 的 formatTime 同款；缺省本地 YYYY-MM-DD HH:MM）。 */
  formatTime?: (at: number) => string
  locale?: Locale
  reducedMotion?: boolean
  emptyTitle?: string
  testId?: string
  loading?: boolean
  loadingLabel?: string
  /** 目录读取失败等显式错误（folder 模式；不画假节点、不显示假 0）。 */
  errorText?: string
}

const TURN_STAGE_HEIGHT = 420

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

/** 文件关系图：folder（当前目录）/ turn（轮次）两种表面。 */
export function FileGraph(props: FileGraphProps): React.ReactElement {
  if (props.mode === 'folder') {
    return h(FolderMap, {
      entries: props.entries ?? [],
      files: props.files,
      edges: props.edges,
      ...(props.allEdges === undefined ? {} : { allEdges: props.allEdges }),
      currentPath: props.currentPath ?? '',
      selectedPath: props.selectedPath,
      ...(props.hoveredPath === undefined ? {} : { hoveredPath: props.hoveredPath }),
      visibleAt: props.visibleAt,
      onSelectFile: props.onSelectFile,
      onOpenFile: props.onOpenFile,
      onHoverFile: props.onHoverFile,
      onEnterFolder: props.onEnterFolder,
      ...(props.selectedFolderPath === undefined ? {} : { selectedFolderPath: props.selectedFolderPath }),
      ...(props.onSelectFolder === undefined ? {} : { onSelectFolder: props.onSelectFolder }),
      ...(props.onEvidence === undefined ? {} : { onEvidence: props.onEvidence }),
      now: props.now,
      formatTime: props.formatTime,
      locale: props.locale,
      reducedMotion: props.reducedMotion,
      emptyTitle: props.emptyTitle,
      testId: props.testId,
      loading: props.loading,
      loadingLabel: props.loadingLabel,
      errorText: props.errorText,
    })
  }
  return h(TurnMap, { ...props, mode: 'turn', turn: props.turn ?? null })
}

type TurnMapProps = FileGraphProps & { mode: 'turn'; turn: FileGraphTurn | null }

/** 轮次视图（33 §3；保留读取/写入/首见/删除命令的证据能力）。 */
function TurnMap(props: TurnMapProps): React.ReactElement {
  const locale: Locale = props.locale ?? DEFAULT_LOCALE
  const t: Translator = React.useMemo(() => createTranslator(locale), [locale])
  const stageRef = React.useRef<HTMLDivElement | null>(null)
  const [size, setSize] = React.useState<{ width: number; height: number }>({ width: 0, height: 0 })
  const [hoverPath, setHoverPath] = React.useState<string | null>(null)
  const [hoverPairKey, setHoverPairKey] = React.useState<string | null>(null)
  const [pinnedPairKey, setPinnedPairKey] = React.useState<string | null>(null)
  const [camera, setCamera] = React.useState<GraphCamera>(DEFAULT_CAMERA)
  // 初次挂载不播放入场动画（截图/SSR 稳定）；只有"轮次切换"这一帧才加过渡。
  const viewKey = 'turn:' + String(props.turn?.turn.n ?? '')
  const previousViewKey = React.useRef<string | null>(null)
  const viewChanged = previousViewKey.current !== null && previousViewKey.current !== viewKey
  if (previousViewKey.current === null || viewChanged) previousViewKey.current = viewKey

  /** 布局过渡时长（读 CSS 令牌 `--tl-dur-layout`；与 folder 图同一个事实源）。 */
  const layoutDurationRef = React.useRef<number>(DEFAULT_LAYOUT_DURATION_MS)

  React.useEffect(() => {
    const element = stageRef.current
    if (element === null) return undefined
    const measure = (): void => {
      const rect = element.getBoundingClientRect()
      setSize({ width: Math.round(rect.width), height: Math.round(rect.height) })
    }
    measure()
    /* 读一次布局过渡时长（CSS 令牌是唯一事实源，这里不写死毫秒数）。 */
    const raw = getComputedStyle(element).getPropertyValue('--tl-dur-layout').trim()
    const parsed = raw.endsWith('ms') ? Number.parseFloat(raw) : raw.endsWith('s') ? Number.parseFloat(raw) * 1000 : NaN
    if (Number.isFinite(parsed)) layoutDurationRef.current = parsed
    if (typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  /** reduced-motion：显式开关或系统偏好，取并集（与 folder 图同一口径）。 */
  const reducedMotion = React.useMemo(() => {
    if (props.reducedMotion === true) return true
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  }, [props.reducedMotion])

  const width = size.width > 0 ? size.width : 680
  const height = size.height > 0 ? size.height : TURN_STAGE_HEIGHT
  const layout: GraphLayout = React.useMemo(
    () => layoutFileGraph(props.files.map(toSource), { width, height, mode: 'turn' }),
    [props.files, width, height],
  )

  /**
   * **唯一几何时钟**（P3 修复）：轮次图以前**完全没有接**插值内核 ——
   * 边用新坐标直接渲染（先出现且定住），节点只有 CSS 入场动画（再从旧位置淡入），
   * 观感就是「关系线先出现并且固定，然后节点才连上去」。
   *
   * 现在与 folder 图共用同一个内核（`sceneClock.interpolateNodeFrames`）与同一条
   * rAF 时间轴（`useSceneClock.useNodeFrames`），所以切轮次时节点/边/标签
   * 从**同一帧**坐标一起连续形变 —— 就是用户要的「点击卡片加载关系」那个动画。
   */
  /**
   * **视图身份 = 轮次号**（`restartOn`）。
   *
   * 这是「切轮次也要像首次加载那样从中心生长」的关键：轮次图的文件集几乎不变
   * （只有 ops 变），若不做重启，几乎每个 key 都命中旧快照 → 全部走"旧位置→新位置"
   * 的滑动 → 用户看到的正是「提前预订好的转场进入」。
   *
   * 声明视图身份后，轮次一变就丢弃旧快照，所有节点从画布中心生长到目标位置，
   * 与 folder 图切目录的观感一致。
   */
  const sceneState = useNodeFramesState<GraphLayout>(
    layout,
    nodeFramesOfGraph,
    projectGraphFrame,
    enterOrigin,
    {
      durationMs: layoutDurationRef.current,
      reducedMotion,
      restartOn: 'turn:' + String(props.turn?.turn.n ?? ''),
    },
  )
  const renderedLayout: GraphLayout = sceneState.frame
  /** 几何正在生长时不播逐元素入场动画（否则两套动画打架）。 */
  const sceneGrowing = sceneState.growing
  const nodeByKey = React.useMemo(() => {
    const map = new Map<string, GraphLayoutNode>()
    /* 用**当前帧**（renderedLayout）建立索引：边端点/标签坐标都从这里取。 */
    for (const node of renderedLayout.nodes) map.set(caseKey(node.path), node)
    return map
  }, [renderedLayout])
  const statusByKey = React.useMemo(() => {
    const map = new Map<string, FileTurnStatus>()
    if (props.turn !== null) for (const [path, status] of props.turn.status.byPath) map.set(caseKey(path), status)
    return map
  }, [props.turn])
  const selectedKey = props.selectedPath === null || props.selectedPath === undefined ? null : caseKey(props.selectedPath)
  const focusKey = hoverPath === null ? selectedKey : caseKey(hoverPath)

  const { placements } = React.useMemo(() => {
    const candidates: LabelCandidate[] = []
    const occupied: OccupiedBox[] = []
    const cx = layout.width / 2
    const cy = layout.height / 2
    const labelLimit = GRAPH_LABEL_LIMITS.turn
    const labelEligible = new Set<string>()
    const sortedByOps = renderedLayout.nodes.slice().sort((left, right) => (right.ops - left.ops) || (left.path < right.path ? -1 : 1))
    for (const node of sortedByOps.slice(0, labelLimit)) labelEligible.add(caseKey(node.path))
    if (selectedKey !== null) labelEligible.add(selectedKey)
    if (focusKey !== null) labelEligible.add(focusKey)
    for (const node of renderedLayout.nodes) {
      const key = caseKey(node.path)
      if (!labelEligible.has(key)) continue
      const isSelected = selectedKey === key
      const isHovered = focusKey === key
      const status = statusByKey.get(key)
      const hasStatus = status !== undefined && statusParts(status, t).length > 0
      const labelWidth = estimateTextWidth(node.name, GRAPH_LABEL_FONT_PX)
      const labelHeight = GRAPH_LABEL_FONT_PX + (hasStatus ? GRAPH_STATUS_FONT_PX + 2 : 0) + 2
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
        boxY = node.y - node.r - labelHeight - 4
      }
      boxX = Math.max(4, Math.min(layout.width - labelWidth - 4, boxX))
      boxY = Math.max(4, Math.min(layout.height - labelHeight - 4, boxY))
      candidates.push({
        key: node.path,
        text: node.name,
        x: boxX,
        y: boxY,
        width: labelWidth,
        height: labelHeight,
        priority: isSelected ? 1000 : isHovered ? 900 : node.ops,
        force: isSelected || isHovered,
        anchor,
      })
    }
    return { placements: placeLabels(candidates, occupied, 6) }
    /* 依赖 `renderedLayout`（当前帧）而不是 `layout`（终点帧）：
     * 标签坐标必须跟着圆点一起走，否则文字会和节点分离。 */
  }, [renderedLayout, statusByKey, selectedKey, focusKey, t])
  const placementByKey = React.useMemo(() => new Map(placements.map((item) => [item.key, item])), [placements])

  /**
   * 「画哪些边」只看**终点帧**的节点集合（存在性与聚合是数据性质，不随动画变），
   * 这样 `aggregateEdgePairs` 不会每帧重跑（那是 O(E) 的活）。
   * 端点坐标在渲染时从 `nodeByKey`（当前帧）现算 —— 见 renderEdge。
   */
  const turnNodeByKey = React.useMemo(() => {
    const map = new Map<string, GraphLayoutNode>()
    for (const node of layout.nodes) map.set(caseKey(node.path), node)
    return map
  }, [layout])

  const visibleEdges = React.useMemo(() => {
    const edges = props.edges ?? []
    const nodeFiltered: GraphEdge[] = []
    for (const edge of edges) {
      const from = turnNodeByKey.get(caseKey(edge.from))
      const to = turnNodeByKey.get(caseKey(edge.to))
      if (from === undefined || to === undefined) continue
      nodeFiltered.push(edge)
    }
    const pairs = aggregateEdgePairs(nodeFiltered)
    const limited = pairs.slice(0, GRAPH_EDGE_LIMITS.turn)
    const result = limited.map((pair) => ({ pair, fromPath: pair.from, toPath: pair.to }))
    return { list: result, total: pairs.length }
  }, [props.edges, turnNodeByKey])

  const activePair: EdgePair | null = React.useMemo(() => {
    const key = pinnedPairKey ?? hoverPairKey
    if (key === null) return null
    return visibleEdges.list.find((item) => item.pair.key === key)?.pair ?? null
  }, [pinnedPairKey, hoverPairKey, visibleEdges])
  const activePairEdges = React.useMemo(() => {
    if (activePair === null) return []
    const ids = new Set(activePair.ids)
    return (props.edges ?? []).filter((edge) => ids.has(edge.id))
  }, [activePair, props.edges])
  const activePairGroups = React.useMemo(() => {
    const groups = new Map<string, { labelKey: (typeof RELATION_MESSAGE_KEY)[keyof typeof RELATION_MESSAGE_KEY]; texts: string[] }>()
    for (const edge of activePairEdges) {
      const existing = groups.get(edge.type) ?? { labelKey: RELATION_MESSAGE_KEY[edge.type], texts: [] }
      if (existing.texts.length < 4 && !existing.texts.includes(edge.evidence.text)) existing.texts.push(edge.evidence.text)
      groups.set(edge.type, existing)
    }
    return [...groups.entries()].sort((left, right) => left[0].localeCompare(right[0]))
  }, [activePairEdges])

  const onStageClick = (event: React.MouseEvent<SVGSVGElement>): void => {
    if (event.target !== event.currentTarget && (event.target as Element).getAttribute('data-graph-background') !== 'true') return
    // 点空白 = 退出本轮视图（回当前目录）。
    props.onExitTurn?.()
  }
  const onStageKeyDown = (event: React.KeyboardEvent<SVGSVGElement>): void => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    props.onExitTurn?.()
  }

  const zoomIn = (): void => {
    setCamera((current) => zoomCameraAtCenter(current, current.scale * GRAPH_ZOOM_STEP, { width, height }))
  }
  const zoomOut = (): void => {
    setCamera((current) => zoomCameraAtCenter(current, current.scale / GRAPH_ZOOM_STEP, { width, height }))
  }
  const fitCamera = (): void => {
    setCamera(resetCamera())
  }
  const resetLayout = (): void => {
    setCamera(resetCamera())
  }

  const subtitle =
    props.loading === true
      ? t('graph.loadingTurn', { n: props.turn?.turn.n ?? '' })
      : props.turn !== null
        ? 'T' + String(props.turn.turn.n) + ' · ' + String(layout.total) + ' ' + t('inspector.file')
        : String(layout.total) + ' ' + t('inspector.file')

  const summary = props.turn !== null ? props.turn.status.summary : null
  const deleteText = summary === null ? '' : summary.deleteCommands === null ? t('turnStatus.unknown') : String(summary.deleteCommands)

  const nodeElements = renderedLayout.nodes.map((node) => {
    const key = caseKey(node.path)
    const status = statusByKey.get(key)
    const parts = statusParts(status, t)
    const isSelected = selectedKey === key
    const isHovered = focusKey === key
    const fill = FAMILY_COLOR[node.family as FileFamily]
    const statusMeta =
      status === undefined
        ? {}
        : {
            'data-read': String(status.read),
            'data-write-add': String(status.writeAdd),
            'data-write-del': String(status.writeDel),
            'data-first-seen': status.firstSeen ? 'true' : 'false',
          }
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
        /* 入场错峰（P2 修复）：与 folder 图共用 `enterStyleOf` 这一条生成规则。
         *
         * 之前这里**完全没有**写 `--tl-enter-i` → 节点 0ms 起、边 60ms 起，
         * 而 folder 图是节点按序号错峰、边 60ms 起。两种模式的时序不一致，
         * 在 turn 视图里就表现为「先出现线，然后节点才加载进去」。 */
        style: enterStyleOf(node.index),
        'aria-label':
          node.name + ' · ' + t('inspector.ops') + ' ' + node.ops + (parts.length === 0 ? '' : ' · ' + parts.map((part) => part.text).join(' ')),
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
        ...statusMeta,
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

  const labelElements = renderedLayout.nodes.flatMap((node) => {
    const label = placementByKey.get(node.path)
    if (label === undefined || !label.visible) return []
    const key = caseKey(node.path)
    const status = statusByKey.get(key)
    const parts = statusParts(status, t)
    const textX = label.anchor === 'end' ? label.x + (label.width ?? 0) : label.anchor === 'middle' ? label.x + (label.width ?? 0) / 2 : label.x
    const anchor = label.anchor ?? 'start'
    const elements: React.ReactElement[] = [
      h(
        'text',
        {
          key: 'l:' + node.path,
          className: 'tl-fnode-label',
          x: textX,
          y: label.y + GRAPH_LABEL_FONT_PX,
          textAnchor: anchor,
          [GRAPH_DATA.label]: node.path,
          'data-selected': selectedKey === key ? 'true' : 'false',
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
            x: textX,
            y: label.y + GRAPH_LABEL_FONT_PX + GRAPH_STATUS_FONT_PX + 2,
            textAnchor: anchor,
          },
          ...parts.map((part, index) => h('tspan', { key: part.key, fill: part.color, dx: index === 0 ? 0 : 4 }, part.text)),
        ),
      )
    }
    return elements
  })

  /* 轮次图证据也走统一的模型上报（不再自己画一份浮层；D-35 单一执行路径）。 */
  const turnEvidenceModel: import('./evidence.ts').EvidenceModel | null =
    activePair === null
      ? null
      : {
          kind: 'edge',
          subject: activePair.from + ' \u2194 ' + activePair.to,
          meta: [
            t('graph.fileRelations', { n: activePair.count }),
            ...activePair.typeList.map((type) => t(RELATION_MESSAGE_KEY[type])),
          ],
          groups: activePairGroups.map(([type, group]) => ({
            type: type as import('../../../shared/relations/index.ts').RelationType,
            labelKey: group.labelKey,
            texts: group.texts,
          })),
          emptyText: t('state.unknown'),
        }
  React.useEffect(() => {
    props.onEvidence?.(turnEvidenceModel)
  }, [turnEvidenceModel, props.onEvidence])
  React.useEffect(() => () => props.onEvidence?.(null), [props.onEvidence])

  const empty = props.files.length === 0
  const emptyTitle = props.emptyTitle ?? t('graph.emptyTurn')
  return h(
    'div',
    {
      className: [GRAPH_CLASS, 'tl-graph-turn'].filter(Boolean).join(' '),
      [GRAPH_DATA.root]: 'true',
      [GRAPH_DATA.mode]: 'turn',
      'data-node-count': layout.shown,
      'data-file-count': layout.total,
      'data-zoom': String(camera.scale),
      'data-reduced-motion': props.reducedMotion === true ? 'true' : 'false',
      'data-animate': viewChanged ? 'true' : 'false',
      /**
       * 场景运动状态（P3）：`grow` = 几何正在从中心生长。
       *
       * CSS 据此抑制 `.tl-fnode` 的逐元素入场动画（含 translateY 与错峰延迟），
       * 避免"节点一边从中心移动、一边还在淡入"的双重动画打架。
       * 首次挂载不走这里（时钟直接到终点、不生长），CSS 入场动画照常播放。
       */
      'data-scene-motion': sceneGrowing ? 'grow' : 'idle',
      'data-testid': props.testId,
    },
    h(
      'div',
      { className: 'tl-graph-head' },
      h('div', { className: 'tl-graph-title' }, t('graph.title'), h('span', { className: 'tl-graph-subtitle' }, subtitle)),
      // 轮次图的节点上限（200）截断时同样显式「显示 N/M」，不静默。
      layout.truncated
        ? h('span', { className: 'tl-graph-note', [GRAPH_DATA.truncated]: 'true' }, t('graph.showingOf', { shown: layout.shown, total: layout.total }))
        : null,
      h(
        'div',
        { className: 'tl-graph-legend', 'aria-label': t('legend.title'), role: 'group' },
        ...(['text', 'code', 'data', 'media', 'other'] as const).map((family) =>
          h(
            'span',
            { key: family, className: 'tl-graph-legend-item', 'data-family': family },
            h('span', { className: 'tl-graph-legend-dot', style: { background: FAMILY_COLOR[family] }, 'aria-hidden': true }),
            h('span', null, t(FAMILY_MESSAGE_KEY[family])),
          ),
        ),
      ),
      h(ZoomGroup, {
        camera,
        onZoomOut: zoomOut,
        onFit: fitCamera,
        onZoomIn: zoomIn,
        onReset: resetLayout,
        locale: props.locale,
      }),
    ),
    // 摘要条**始终占位**（避免 hover 时一行/两行切换导致画面上下跳）。
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
            h('span', { key: 'write', className: 'tl-graph-chip', 'data-status': 'write' }, t('turnStatus.write', { add: summary.writeAdd, del: summary.writeDel })),
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
            { className: 'tl-graph-loading tl-graph-loading-skeleton', [GRAPH_DATA.loading]: 'true' },
            graphSkeleton('turn'),
            h(
              'div',
              { className: 'tl-graph-loading-label', role: 'status' },
              h('span', { className: 'tl-graph-loading-dot', 'aria-hidden': true }),
              h('span', null, props.loadingLabel ?? t('graph.loadingTurn', { n: props.turn?.turn.n ?? '' })),
            ),
          )
        : empty
          ? h(EmptyState, { title: emptyTitle, mark: '◌', testId: 'graph-empty' })
          : h(
              'svg',
              {
                className: 'tl-graph-svg',
                /*
                 * **不给 svg 加 key**（P3，与 folder 图同一条纪律）。
                 *
                 * 旧实现是 `key: 'svg:turn:' + n` —— 切轮次会整张重建 SVG。
                 * 那会让 `useNodeFrames` 的当前可见帧与生长动画**全部作废**：
                 * 新的空场景直接以终点坐标挂载，用户看到的就是"提前预订好的转场"。
                 *
                 * 场景根常驻后，切轮次由几何时钟负责生长；元素级入场动画由
                 * `data-scene-motion` 在生长期间抑制。
                 */
                viewBox: '0 0 ' + String(layout.width) + ' ' + String(layout.height),
                preserveAspectRatio: 'xMidYMid meet',
                role: 'group',
                'aria-label': t('graph.title'),
                tabIndex: 0,
                onClick: onStageClick,
                onKeyDown: onStageKeyDown,
              },
              h('rect', { x: 0, y: 0, width: 1, height: 1, fill: 'transparent', 'data-graph-background': 'true' }),
              h(
                'g',
                { className: 'tl-graph-zoom-layer', 'data-zoom-layer': 'true', transform: cameraTransform(camera) },
                ...visibleEdges.list.flatMap(({ pair, fromPath, toPath }) => {
                  /**
                   * **端点从当前帧现算**（P3 修复的核心，别改回读 `turnNodeByKey`）。
                   *
                   * `turnNodeByKey` 是**终点帧**的静态坐标；用它画边就会出现
                   * 「关系线先出现并且固定，然后节点才连上去」。
                   * 这里取 `nodeByKey`（= `renderedLayout`，当前可见帧），
                   * 于是线和节点永远在同一帧上，端点偏差恒为 0。
                   */
                  const from = nodeByKey.get(caseKey(fromPath))
                  const to = nodeByKey.get(caseKey(toPath))
                  if (from === undefined || to === undefined) return []
                  const touchingFocus = focusKey !== null && (caseKey(pair.from) === focusKey || caseKey(pair.to) === focusKey)
                  const opacity =
                    focusKey === null ? (pair.typeList.includes('structure') ? 0.28 : 0.42) : touchingFocus ? 0.85 : 0.08
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
                      onPointerEnter: () => setHoverPairKey(pair.key),
                      onPointerLeave: () => setHoverPairKey(null),
                      onClick: (event: React.MouseEvent) => {
                        event.stopPropagation()
                        setPinnedPairKey((value) => (value === pair.key ? null : pair.key))
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
            ),
    ),
  )
}

/** 证据用：文件节点半径（与轮次图同口径；perf/测试可直接引用）。 */
export { graphRadius }
