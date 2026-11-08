/*
 * map/FolderMap.ts —— 左列「当前目录**关系图**」（03 §4.2.1–4.2.5 / R10）。
 *
 * R10（2026-11-08 用户二次反馈）整体重做，旧网格实现已删除、不留兼容分支：
 *   「他们之间也应该是有图的结构，有系的连在一起，而不像现在一样就一个个排列在那里。
 *     然后，每一个点开之后，里面的展开之后，也应该这样。」
 *
 * 因此本组件：
 * - **力导向**布局（`folderLayout.layoutFolderGeometry`）：位置由关系决定，不再网格排列；
 * - **边常驻分层**（`edgeLayers.selectEdgeLayers`）：L1 骨架 + L2 每点 top-3 共现默认画，
 *   L3 只在悬停/选中或「全部」档淡入；总边数 ≤ 1.6 × 节点数，超出显式提示；
 * - **枢纽参与结构**（`hubLinks.computeHubLinks`）：跨目录真实边聚合到枢纽，线宽 = 聚合权重；
 *   没有关系的枢纽放外围环、**绝不伪造连线**；
 * - **节点上限 + 「显示全部」chip**：默认 40；>40 时图头常驻 chip，点击就地切全部，
 *   切全部时自动降级（密度→骨架、只标 hover/选中、半径 1/√n、相机自动适应），切回恢复；
 * - **铺满视口**：布局按画布归一化，内容包围盒 ≥55% 画布（旧实现只占上部 1/4 属缺陷）。
 *
 * 相机（M5 确定 bug，**不要回归**）：围绕**视口中心**缩放，0.5×–3×；
 * `适应` = 相机回 1×/居中；`重置布局` = 清钉 + 相机复位（图标按钮，aria-label 保留）。
 */
import * as React from 'react'
import type { FileFamily, FileNode } from '../../../shared/events/index.ts'
import { caseKey, type GraphEdge, type RelationType } from '../../../shared/relations/index.ts'
import { createTranslator, DEFAULT_LOCALE, type Locale, type Translator } from '../../locale/index.ts'
import { EmptyState } from '../common/index.ts'
import { cameraTransform, DEFAULT_CAMERA, GRAPH_ZOOM_STEP, panCameraBy, resetCamera, zoomCameraAtCenter, type GraphCamera } from './camera.ts'
import {
  FOLDER_LABEL_FONT_PX,
  layoutFolderGeometry,
  layoutFolderLabels,
  type FolderLayoutHub,
  type FolderLayoutHubPair,
  type FolderLayoutLabel,
  type FolderGeometry,
  type FolderLayoutNode,
  type MapEntry,
  type NodeDragOffset,
} from './folderLayout.ts'
import { selectEdgeLayers, type EdgeLayer, type LayeredPair } from './edgeLayers.ts'
import { truncateHubPairs } from './hubLinks.ts'
import { aggregateEdgePairs, dragThresholdExceeded, type EdgePair } from './pairs.ts'
import {
  FAMILY_COLOR,
  FAMILY_MESSAGE_KEY,
  GRAPH_CLASS,
  GRAPH_DATA,
  GRAPH_HUB_PAIR_OPACITY,
  hubPairPartnersFor,
  hubPairStrokeWidth,
  RELATION_MESSAGE_KEY,
  type GraphDensity,
} from './theme.ts'
import { ZoomGroup } from './zoomGroup.ts'

const h = React.createElement

const STAGE_FALLBACK_HEIGHT = 420
const FAMILY_ORDER = ['text', 'code', 'data', 'media', 'other'] as const
/** 密度档位的展示顺序（骨架 / 标准 / 全部）。 */
const DENSITY_ORDER: readonly GraphDensity[] = ['skeleton', 'standard', 'all']
const DENSITY_MESSAGE_KEY = {
  skeleton: 'graph.densitySkeleton',
  standard: 'graph.densityStandard',
  all: 'graph.densityAll',
} as const

interface DragState {
  key: string
  startX: number
  startY: number
  baseDx: number
  baseDy: number
  moved: boolean
}

interface PanState {
  startX: number
  startY: number
  baseTx: number
  baseTy: number
  moved: boolean
}

export interface FolderMapProps {
  /** 当前目录的直接 entries（目录 / 文件 / other 全量，含未触碰项）。 */
  entries: readonly MapEntry[]
  /** 有会话数据的文件（touched 叠加；entries 里的未触碰文件会成为中性节点）。 */
  files: readonly FileNode[]
  /** 当前目录**内**文件之间的已有关系（两端都在当前图内）；用于引力与 L1/L2/L3 分层。 */
  edges?: readonly GraphEdge[]
  /**
   * **全量**边集（未按当前目录过滤）：只用于把「当前目录文件 ↔ 子文件夹内文件」的
   * 真实跨目录边聚合到文件夹枢纽。
   *
   * - `undefined`（缺省）：**不做枢纽聚合、不画任何枢纽连线**（不伪造关系）；
   * - 传了：每个枢纽最多 3 条聚合连线（线宽 = 聚合权重），没有关系的枢纽放外围环、不画线。
   *
   * tab 侧接线：`allEdges: edges`（**未过滤**的产品级边，`GraphEdge[]`）。
   */
  allEdges?: readonly GraphEdge[]
  /** 当前目录（'' = 工作区根）。 */
  currentPath: string
  selectedPath?: string | null
  /** 播放头（null = 跟随现在；非 null 时 firstAt 晚于它的节点隐藏）。 */
  visibleAt?: number | null
  onSelectFile?: (path: string | null) => void
  onOpenFile?: (path: string) => void
  onHoverFile?: (path: string | null) => void
  /** 点文件夹枢纽 → 让右栏进入该目录。 */
  onEnterFolder?: (path: string) => void
  now: number
  formatTime?: (at: number) => string
  locale?: Locale
  reducedMotion?: boolean
  emptyTitle?: string
  testId?: string
  loading?: boolean
  loadingLabel?: string
  /** 目录读取失败等显式错误（不画假节点、不显示假 0）。 */
  errorText?: string
}

/** 缺省时间格式：本地 `YYYY-MM-DD HH:MM`（确定性；不依赖 locale 数据）。 */
export function defaultFormatTime(at: number): string {
  const date = new Date(at)
  const pad = (value: number): string => (value < 10 ? '0' : '') + String(value)
  return (
    String(date.getFullYear()) +
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

/** 证据浮层里的关系分组（按类型分组、每类最多 4 条、去重、类型名升序）。 */
function groupEvidence(
  edges: readonly GraphEdge[],
): Array<{ type: RelationType; labelKey: (typeof RELATION_MESSAGE_KEY)[RelationType]; texts: string[] }> {
  const groups = new Map<RelationType, string[]>()
  for (const edge of edges) {
    const list = groups.get(edge.type) ?? []
    if (list.length < 4 && !list.includes(edge.evidence.text)) list.push(edge.evidence.text)
    groups.set(edge.type, list)
  }
  return [...groups.entries()]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([type, texts]) => ({ type, labelKey: RELATION_MESSAGE_KEY[type], texts }))
}

/** 关系密度 → 默认画哪几档（「全部」档切到全部时自动降到骨架，见 §4.2.3）。 */
function effectiveDensity(density: GraphDensity, expanded: boolean): GraphDensity {
  return expanded ? 'skeleton' : density
}

/** 当前目录关系图。 */
export function FolderMap(props: FolderMapProps): React.ReactElement {
  const locale: Locale = props.locale ?? DEFAULT_LOCALE
  const t: Translator = React.useMemo(() => createTranslator(locale), [locale])
  const stageRef = React.useRef<HTMLDivElement | null>(null)
  const [size, setSize] = React.useState<{ width: number; height: number }>({ width: 0, height: 0 })
  const [hoverPath, setHoverPath] = React.useState<string | null>(null)
  const [inspectPath, setInspectPath] = React.useState<string | null>(null)
  const [hoverPairKey, setHoverPairKey] = React.useState<string | null>(null)
  const [pinnedPairKey, setPinnedPairKey] = React.useState<string | null>(null)
  const [camera, setCamera] = React.useState<GraphCamera>(DEFAULT_CAMERA)
  const [dragOffsets, setDragOffsets] = React.useState<Record<string, NodeDragOffset>>({})
  /** 关系密度档位（默认「标准」= L1 + L2；03 §4.2.2）。 */
  const [density, setDensity] = React.useState<GraphDensity>('standard')
  /** 「显示全部」状态：false = 40 档（默认），true = 全部档。 */
  const [showAllExpanded, setShowAllExpanded] = React.useState(false)
  const dragRef = React.useRef<DragState | null>(null)
  /**
   * 本次交互是否经历过 pointer 阶段（真实鼠标 = 是；程序化 `.click()` / AT = 否）。
   * `beginDrag` 置 true，`handleTap` 消费后置回 false。
   */
  const pointerDownSeenRef = React.useRef(false)
  /**
   * 本次 pointer 交互结束后，是否允许随后那次 click 算作「点击」。
   * 值为节点/枢纽的 key（允许）或 null（拖动过 → 吃掉那次 click）。
   */
  const pendingTapKeyRef = React.useRef<string | null>(null)
  const panRef = React.useRef<PanState | null>(null)
  const suppressClickRef = React.useRef(false)

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

  // 换目录：拖动偏移只在原目录内有效；档位/全部状态也回默认（每个目录独立看）。
  const folderKey = props.currentPath
  React.useEffect(() => {
    setDragOffsets((current) => (Object.keys(current).length === 0 ? current : {}))
    setDensity('standard')
    setShowAllExpanded(false)
    setCamera(resetCamera())
    // 03 §4.4：鼠标离开必须清预览，「不允许 hover 卡住导致整图长期 dim」。
    // 换目录时旧的 hover 键已经不在新目录里，必须清掉（R11 加了枢纽 dim 后更明显）。
    setHoverPath(null)
    dragRef.current = null
  }, [folderKey])

  const width = size.width > 0 ? size.width : 720
  const height = size.height > 0 ? size.height : STAGE_FALLBACK_HEIGHT
  const formatTime = props.formatTime ?? defaultFormatTime
  const visibleAt = props.visibleAt ?? null
  const selectedKey = props.selectedPath === null || props.selectedPath === undefined ? null : caseKey(props.selectedPath)
  const hoveredKey = hoverPath === null ? null : caseKey(hoverPath)
  /**
   * 生效的密度档位。「显示全部」时自动降级到骨架（§4.2.3），
   * 所以它必须在几何之前算出来 —— 枢纽间连线**按档位重新计算**（不是 CSS 隐藏）。
   */
  const activeDensity = effectiveDensity(density, showAllExpanded)

  // 播放头：firstAt > visibleAt 的节点隐藏（不重排坐标）。
  const hiddenKeys = React.useMemo(() => {
    if (visibleAt === null) return null
    const set = new Set<string>()
    for (const file of props.files) if (file.firstAt > visibleAt) set.add(caseKey(file.path))
    return set.size === 0 ? null : set
  }, [props.files, visibleAt])

  /**
   * **几何**（力导向）：只依赖数据/画布/上限/边集/拖动偏移。
   * hover 改的是标签，因此这里**不**把 selectedKey/hoveredKey 放进依赖 —— 悬停不重跑模拟。
   * （选中/悬浮强制可见的选点用「全部档的 limit」，由下面 enforceFocus 单独处理。）
   */
  const geometry: FolderGeometry = React.useMemo(
    () =>
      layoutFolderGeometry(props.entries, props.files, {
        width,
        height,
        currentPath: props.currentPath,
        offsets: dragOffsets,
        showAll: showAllExpanded,
        edges: props.edges,
        allEdges: props.allEdges,
      }),
    [props.entries, props.files, props.currentPath, width, height, dragOffsets, showAllExpanded, props.edges, props.allEdges],
  )

  /**
   * 本档**真正要画**的枢纽间连线（R11）：从布局用的最宽集（每枢纽 top-4）里
   * 按当前档位再截一次 —— 骨架 0 / 标准 top-2 / 全部 top-4。
   *
   * 为什么这样切（而不是让几何吃档位）：
   * - 位置必须**跨档位稳定**（切档只该多画/少画线，不该整张图重排）；
   * - 但「切档要重新计算」也满足：这里是**真的重新算了一遍集合**，DOM 里根本没有那些元素，
   *   不是 CSS 隐藏（`data-hub-pair` 数量随档位真实变化）。
   * 截断规则与 `computeHubPairs` 完全相同（同一个 `truncateHubPairs`），不会出现第二套口径。
   */
  const drawnHubPairs = React.useMemo(
    () => truncateHubPairs(geometry.hubPairs, hubPairPartnersFor(activeDensity)),
    [geometry.hubPairs, activeDensity],
  )

  // 选中/悬浮的节点若被 40 档挤掉了，仍然要画出来（规格：悬停/选中强制可见）。
  const focusedMissing = React.useMemo(() => {
    const keys: string[] = []
    for (const key of [hoveredKey, selectedKey]) {
      if (key === null || key === '') continue
      if (geometry.nodes.some((node) => caseKey(node.path) === key)) continue
      if (keys.includes(key)) continue
      keys.push(key)
    }
    return keys
  }, [hoveredKey, selectedKey, geometry])

  // 强制可见的节点走"全部档选点"再挑出来（保证坐标与 40 档一致的部分不重算两次）。
  const focusedGeometry: FolderGeometry | null = React.useMemo(() => {
    if (focusedMissing.length === 0) return null
    return layoutFolderGeometry(props.entries, props.files, {
      width,
      height,
      currentPath: props.currentPath,
      offsets: dragOffsets,
      showAll: true,
      edges: props.edges,
      allEdges: props.allEdges,
    })
  }, [focusedMissing, props.entries, props.files, props.currentPath, width, height, dragOffsets, props.edges, props.allEdges])

  const extraNodes = React.useMemo(() => {
    if (focusedGeometry === null) return [] as FolderLayoutNode[]
    const existing = new Set(geometry.nodes.map((node) => caseKey(node.path)))
    return focusedGeometry.nodes.filter((node) => focusedMissing.includes(caseKey(node.path)) && !existing.has(caseKey(node.path)))
  }, [focusedGeometry, focusedMissing, geometry])

  const nodes: FolderLayoutNode[] = React.useMemo(
    () => (extraNodes.length === 0 ? geometry.nodes : [...geometry.nodes, ...extraNodes]),
    [geometry.nodes, extraNodes],
  )

  const labels: FolderLayoutLabel[] = React.useMemo(
    () => layoutFolderLabels({ ...geometry, nodes }, { selectedKey, hoveredKey, hiddenKeys }),
    [geometry, nodes, selectedKey, hoveredKey, hiddenKeys],
  )

  const nodeByKey = React.useMemo(() => {
    const map = new Map<string, FolderLayoutNode>()
    for (const node of nodes) map.set(caseKey(node.path), node)
    return map
  }, [nodes])
  const labelByKey = React.useMemo(() => {
    const map = new Map<string, FolderLayoutLabel>()
    for (const label of labels) map.set(caseKey(label.path), label)
    return map
  }, [labels])
  const fileByKey = React.useMemo(() => {
    const map = new Map<string, FileNode>()
    for (const file of props.files) map.set(caseKey(file.path), file)
    return map
  }, [props.files])

  // 只保留两端都在当前图里的边（当前目录内；不做跨目录蜘蛛网）。
  const innerEdges = React.useMemo(() => {
    const edges = props.edges ?? []
    if (edges.length === 0) return []
    return edges.filter((edge) => nodeByKey.has(caseKey(edge.from)) && nodeByKey.has(caseKey(edge.to)))
  }, [props.edges, nodeByKey])

  const focusKey = hoveredKey ?? selectedKey
  const layered = React.useMemo(
    () =>
      selectEdgeLayers(innerEdges, {
        nodeKeys: new Set(nodes.map((node) => caseKey(node.path))),
        density: activeDensity,
        focusKey,
      }),
    [innerEdges, nodes, activeDensity, focusKey],
  )

  // 常驻画的边 = 分层结果 + 焦点可淡入的 L3（悬停/选中时）。
  const drawnPairs: LayeredPair[] = React.useMemo(() => {
    if (layered.focusOnly.length === 0) return layered.drawn
    return [...layered.drawn, ...layered.focusOnly]
  }, [layered])

  const activePair: EdgePair | null = React.useMemo(() => {
    const key = pinnedPairKey ?? hoverPairKey
    if (key === null) return null
    return drawnPairs.find((item) => item.pair.key === key)?.pair ?? null
  }, [pinnedPairKey, hoverPairKey, drawnPairs])

  const selectedNode = React.useMemo(() => {
    const path = inspectPath ?? props.selectedPath ?? null
    if (path === null) return null
    return nodeByKey.get(caseKey(path)) ?? null
  }, [inspectPath, props.selectedPath, nodeByKey])
  const selectedEdges = React.useMemo(() => {
    if (selectedNode === null) return []
    const key = caseKey(selectedNode.path)
    return innerEdges.filter((edge) => caseKey(edge.from) === key || caseKey(edge.to) === key)
  }, [selectedNode, innerEdges])
  const selectedGroups = React.useMemo(() => groupEvidence(selectedEdges), [selectedEdges])
  const activePairEdges = React.useMemo(() => {
    if (activePair === null) return []
    const ids = new Set(activePair.ids)
    return innerEdges.filter((edge) => ids.has(edge.id))
  }, [activePair, innerEdges])
  const activePairGroups = React.useMemo(() => groupEvidence(activePairEdges), [activePairEdges])

  // 焦点邻居（hover/选中时无关节点 dim 0.5；03 §4.2.5）。
  const neighborKeys = React.useMemo(() => {
    const set = new Set<string>()
    if (focusKey === null) return set
    set.add(focusKey)
    for (const item of layered.drawn) {
      const from = caseKey(item.pair.from)
      const to = caseKey(item.pair.to)
      if (from === focusKey) set.add(to)
      else if (to === focusKey) set.add(from)
    }
    for (const item of layered.focusOnly) {
      const from = caseKey(item.pair.from)
      const to = caseKey(item.pair.to)
      if (from === focusKey) set.add(to)
      else if (to === focusKey) set.add(from)
    }
    return set
  }, [focusKey, layered])

  /* ---------------- 交互 ---------------- */
  const focusStage = (): void => {
    const svg = stageRef.current?.querySelector<SVGSVGElement>('.tl-graph-svg')
    svg?.focus()
  }
  const selectFile = (path: string | null): void => {
    setInspectPath(path)
    setPinnedPairKey(null)
    setHoverPairKey(null)
    props.onSelectFile?.(path)
    if (path !== null) focusStage()
  }
  const closeEvidence = (): void => {
    setInspectPath(null)
    setPinnedPairKey(null)
    setHoverPairKey(null)
    props.onSelectFile?.(null)
    focusStage()
  }
  const hoverFile = (path: string | null): void => {
    setHoverPath(path)
    props.onHoverFile?.(path)
  }

  /**
   * 开始拖拽。
   *
   * 只依赖 `path`（而不是完整的 `FolderLayoutNode`），因为**文件节点和文件夹枢纽都要能拖**
   * （2026-11-08 用户反馈：「每个文件节点都可以拖动，但是文件夹节点没法拖动？这很坏，
   * 我希望是都可以拖动的」）。布局层本来就统一按 `key = path.toLowerCase()` 应用 offsets，
   * 所以这里泛化后两种节点共用同一套拖拽逻辑，不会出现第二套实现。
   */
  const beginDrag = (event: React.PointerEvent<SVGGElement>, path: string): void => {
    if (event.button !== 0) return
    // 鼠标按下不抢焦点（避免宿主画默认大焦点框）；键盘 Tab/Enter 仍走 :focus-visible 细环。
    if (event.pointerType === 'mouse') event.preventDefault()
    event.stopPropagation()
    const key = caseKey(path)
    const offset = dragOffsets[key]
    // 标记「本次交互走过 pointer 阶段」→ 随后的 click 由 pendingTapKey 决定是否执行。
    pointerDownSeenRef.current = true
    pendingTapKeyRef.current = null
    dragRef.current = {
      key,
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
    // 视图缩放下，屏幕位移除以 scale 才是图坐标位移。
    const scale = camera.scale > 0 ? camera.scale : 1
    setDragOffsets((current) => ({
      ...current,
      [drag.key]: {
        dx: Math.round((drag.baseDx + dx / scale) * 100) / 100,
        dy: Math.round((drag.baseDy + dy / scale) * 100) / 100,
      },
    }))
  }
  /**
   * 结束拖拽。
   *
   * `onTap` 是「没拖动时算点击」的回调 —— 文件节点传 selectFile，文件夹枢纽传进目录，
   * 保持各自原有的点击语义（用户已拍板：点击枢纽 = 进入该目录，不因可拖而改变）。
   */
  /**
   * 结束拖拽：只**记录**这次指针交互该不该算点击，不直接执行。
   *
   * - 真拖动（超过阈值）→ `pendingTapKey = null`，让随后那次 click 被吃掉；
   * - 没拖动 → `pendingTapKey = key`，交给随后的 click 执行（见 handleTap）。
   *
   * 为什么不在这里直接执行（2026-11-08 修回归）：
   * 真实鼠标是 pointerdown → pointerup → **click**；但 `element.click()`、屏幕阅读器、
   * 辅助技术**只派发 click，没有 pointer 阶段**。若在 pointerup 里直接执行，
   * 这些路径永远进不去目录（实测 run-t07 的 hub-click-enters-folder 直接红）。
   * 统一让 click 当唯一执行入口，三条路径就不分叉。
   */
  const endDrag = (event: React.PointerEvent<SVGGElement>): void => {
    const drag = dragRef.current
    if (drag === null) return
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    dragRef.current = null
    pendingTapKeyRef.current = drag.moved ? null : drag.key
  }

  /**
   * 统一的「点击」入口：文件选中 / 枢纽进目录都走这里。
   *
   * `pointerDownSeenRef` 区分两条来源：
   * - 有 pointer 阶段（真实鼠标）→ 用 `pendingTapKey` 判定该不该执行（拖动过的会被吃掉）；
   * - 无 pointer 阶段（程序化 `.click()` / AT）→ 直接执行，不受拖动状态影响。
   */
  const handleTap = (key: string, onTap: () => void): void => {
    if (!pointerDownSeenRef.current) {
      // 程序化点击 / 辅助技术：没有 pointer 阶段，直接当作点击。
      onTap()
      return
    }
    pointerDownSeenRef.current = false
    const pending = pendingTapKeyRef.current
    pendingTapKeyRef.current = null
    if (pending === key) onTap()
  }

  const beginPan = (event: React.PointerEvent<SVGSVGElement>): void => {
    if (camera.scale <= 1 || event.button !== 0) return
    const target = event.target as Element
    if (target !== event.currentTarget && target.getAttribute('data-graph-background') !== 'true') return
    panRef.current = { startX: event.clientX, startY: event.clientY, baseTx: camera.tx, baseTy: camera.ty, moved: false }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }
  const movePan = (event: React.PointerEvent<SVGSVGElement>): void => {
    const pan = panRef.current
    if (pan === null) return
    const dx = event.clientX - pan.startX
    const dy = event.clientY - pan.startY
    if (!pan.moved && !dragThresholdExceeded(dx, dy)) return
    pan.moved = true
    setCamera(panCameraBy({ scale: camera.scale, tx: pan.baseTx, ty: pan.baseTy }, dx, dy, { width, height }))
  }
  const endPan = (event: React.PointerEvent<SVGSVGElement>): void => {
    const pan = panRef.current
    if (pan === null) return
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    panRef.current = null
    if (pan.moved) suppressClickRef.current = true
  }

  const onStageClick = (event: React.MouseEvent<SVGSVGElement>): void => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false
      return
    }
    const target = event.target as Element
    if (target !== event.currentTarget && target.getAttribute('data-graph-background') !== 'true') return
    // 点空白 = 清选中/证据（不改当前目录；目录导航由右栏负责）。
    setInspectPath(null)
    setPinnedPairKey(null)
    setHoverPairKey(null)
    props.onSelectFile?.(null)
  }
  const onStageKeyDown = (event: React.KeyboardEvent<SVGSVGElement>): void => {
    if (event.key !== 'Escape') return
    if (selectedNode === null && activePair === null && inspectPath === null) return
    event.preventDefault()
    closeEvidence()
  }

  /* ---------------- 相机动作 ---------------- */
  const zoomIn = (): void => {
    setCamera((current) => zoomCameraAtCenter(current, current.scale * GRAPH_ZOOM_STEP, { width, height }))
  }
  const zoomOut = (): void => {
    setCamera((current) => zoomCameraAtCenter(current, current.scale / GRAPH_ZOOM_STEP, { width, height }))
  }
  /** 适应 = 只回相机（1×/居中），不动拖动偏移。 */
  const fitCamera = (): void => {
    setCamera(resetCamera())
  }
  /** 重置布局 = 清钉 + 相机复位（M2：图标按钮，无可见文字）。 */
  const resetLayout = (): void => {
    setDragOffsets({})
    dragRef.current = null
    setCamera(resetCamera())
  }

  /**
   * 「显示 40/137」chip → 就地切全部；再点 → 收起回 40 档。
   * 切全部时自动降级（§4.2.3）：密度降到骨架（由 `effectiveDensity` 保证）、
   * 标签只标悬停/选中（`layoutFolderLabels` 看 `geometry.showAll`）、
   * 半径按 1/√n 缩（`layoutFolderGeometry` 的 `allModeRadiusScale`）、相机自动适应。
   */
  const toggleShowAll = (): void => {
    const next = !showAllExpanded
    setShowAllExpanded(next)
    setCamera(resetCamera())
    setDragOffsets({})
    dragRef.current = null
  }
  const switchDensity = (next: GraphDensity): void => {
    // 用户手动选档时退出「全部」档的自动降级（手选优先）。
    setDensity(next)
    if (showAllExpanded && next !== 'skeleton') setShowAllExpanded(false)
  }

  /* ---------------- 渲染 ---------------- */
  const showingText = showAllExpanded
    ? t('graph.collapseAll', { total: String(geometry.totalFiles) })
    : t('graph.showAll', { shown: String(geometry.shownFiles), total: String(geometry.totalFiles) })
  const showAllChipVisible = geometry.totalFiles > geometry.limit || geometry.totalFiles > 40 || showAllExpanded
  const relationsCount = drawnPairs.length
  const relationsText = layered.truncated
    ? t('graph.relationsTrimmed', { drawn: String(relationsCount) })
    : t('graph.relationsSummary', { n: String(relationsCount) })

  const currentLabel = props.currentPath === '' ? t('map.rootCluster') : props.currentPath
  const subtitle = geometry.empty
    ? ''
    : String(nodes.length) +
      ' ' +
      t('inspector.file') +
      (geometry.hubCount > 0 ? ' · ' + t('map.folderCount', { count: geometry.hubCount }) : '')

  const renderHub = (hub: FolderLayoutHub): React.ReactElement => {
    const hubKey = caseKey(hub.path)
    const isHoveredHub = hoveredKey === hubKey
    /**
     * 悬停某枢纽时，**无关枢纽 dim 0.4**（03 §4.2.2：「悬停某枢纽 → 它所有枢纽间连线提亮、
     * 其余枢纽 dim 0.4」）。判定口径 = 与该枢纽有真实枢纽间连线的伙伴。
     * `data-dimmed` 与文件节点的 `data-dimmed` 同名字义（值是 'true'/'false'），
     * 但挂在**枢纽组**上，QA 用 `[data-folder-hub][data-dimmed="true"]` 选择，不会与文件混淆。
     */
    const isHubPairPartner =
      hoveredKey === null ||
      hoveredKey === hubKey ||
      drawnHubPairs.some((pair) => {
        const aKey = caseKey(pair.aPath)
        const bKey = caseKey(pair.bPath)
        return (aKey === hoveredKey && bKey === hubKey) || (bKey === hoveredKey && aKey === hubKey)
      })
    const isDimmed = hoveredKey !== null && !isHubPairPartner
    // 拖动反馈与文件节点同一口径（`data-dragging`，真理来源 = dragOffsets 里有没有非零偏移）。
    const hubOffset = dragOffsets[hubKey]
    const isHubDragged = hubOffset !== undefined && (hubOffset.dx !== 0 || hubOffset.dy !== 0)
    const left = hub.x - hub.width / 2
    const top = hub.y - hub.height / 2
    return h(
      'g',
      {
        key: 'hub:' + hub.path,
        className: 'tl-foldhub',
        [GRAPH_DATA.hub]: hub.path,
        [GRAPH_DATA.hubLinked]: hub.hasLinks ? 'true' : 'false',
        'data-hub-name': hub.name,
        'data-hub-links': hub.linkCount,
        'data-hub-pairs': drawnHubPairs.filter((pair) => caseKey(pair.aPath) === hubKey || caseKey(pair.bPath) === hubKey).length,
        'data-hovered': isHoveredHub ? 'true' : 'false',
        'data-dimmed': isDimmed ? 'true' : 'false',
        'data-dragging': isHubDragged ? 'true' : 'false',
        role: 'button',
        tabIndex: 0,
        'aria-label': hub.name + ' · ' + t('map.folder') + (hub.hasLinks ? '' : ' · ' + t('graph.hubEmpty')),
        // 枢纽也可拖（2026-11-08 用户反馈）。布局层本来就按 path 键应用 offsets，
        // 所以这里与文件节点共用 beginDrag/moveDrag/endDrag，不存在第二套拖拽实现。
        onPointerDown: (event: React.PointerEvent<SVGGElement>) => beginDrag(event, hub.path),
        onPointerMove: moveDrag,
        onPointerUp: (event: React.PointerEvent<SVGGElement>) => endDrag(event),
        onPointerCancel: (event: React.PointerEvent<SVGGElement>) => endDrag(event),
        onPointerEnter: () => hoverFile(hub.path),
        onPointerLeave: () => {
          setHoverPath((value) => (value !== null && caseKey(value) === hubKey ? null : value))
          props.onHoverFile?.(null)
        },
        // 点击枢纽**仍然是「进入该目录」**（用户已拍板，加了连线也不改点击语义）。
        // 执行权统一交给 click（见 handleTap 注释）：真实鼠标、程序化 `.click()`、
        // 辅助技术三条路径共用同一个入口，且拖动后的那一次 click 会被吃掉。
        onClick: (event: React.MouseEvent) => {
          event.stopPropagation()
          handleTap(hubKey, () => props.onEnterFolder?.(hub.path))
        },
        onKeyDown: (event: React.KeyboardEvent) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            props.onEnterFolder?.(hub.path)
          }
        },
      },
      h('title', null, hub.path + (hub.hasLinks ? '' : ' · ' + t('graph.hubEmpty'))),
      h('rect', { className: 'tl-foldhub-card', x: left, y: top, width: hub.width, height: hub.height, rx: 7, ry: 7 }),
      h('path', {
        className: 'tl-foldhub-icon',
        'aria-hidden': true,
        d:
          'M' + String(left + 8) + ' ' + String(top + 9) +
          ' h4 l2 2.2 h5 a1.4 1.4 0 0 1 1.4 1.4 v4.6 a1.4 1.4 0 0 1 -1.4 1.4 h-11 a1.4 1.4 0 0 1 -1.4 -1.4 v-6.4 a1.4 1.4 0 0 1 1.4 -1.4 z',
      }),
      // 名字放不下：卡片只留图标（完整名在 title/aria），绝不画截断碎片。
      hub.labelVisible
        ? h('text', { className: 'tl-foldhub-label', x: left + 22, y: hub.y + 4, 'data-hub-label': hub.path }, hub.name)
        : null,
    )
  }

  const renderNode = (node: FolderLayoutNode): React.ReactElement => {
    const key = caseKey(node.path)
    const isSelected = selectedKey === key
    const isHovered = hoveredKey === key
    const isFuture = hiddenKeys !== null && hiddenKeys.has(key)
    const offset = dragOffsets[key]
    const isDragged = offset !== undefined && (offset.dx !== 0 || offset.dy !== 0)
    const fill = node.touched ? FAMILY_COLOR[node.family as FileFamily] : 'var(--tl-fg-caption)'
    const file = fileByKey.get(key)
    const dimmed = focusKey !== null && !neighborKeys.has(key)
    const ariaLabel = node.touched
      ? node.name + ' · ' + t('inspector.ops') + ' ' + String(node.ops)
      : node.name + ' · ' + t('graph.untouched')
    return h(
      'g',
      {
        key: 'f:' + node.path,
        className: 'tl-ofile',
        [GRAPH_DATA.node]: node.path,
        'data-family': node.family,
        'data-ops': node.ops,
        'data-touched': node.touched ? 'true' : 'false',
        'data-kind': node.kind,
        'data-selected': isSelected ? 'true' : 'false',
        'data-hovered': isHovered ? 'true' : 'false',
        'data-dragging': isDragged ? 'true' : 'false',
        'data-future': isFuture ? 'true' : 'false',
        'data-dimmed': dimmed ? 'true' : 'false',
        'aria-hidden': isFuture ? 'true' : undefined,
        style: isFuture ? { pointerEvents: 'none' } : undefined,
        role: 'button',
        tabIndex: isSelected || (selectedKey === null && node.index === 0) ? 0 : -1,
        'aria-label': ariaLabel,
        onPointerDown: (event: React.PointerEvent<SVGGElement>) => beginDrag(event, node.path),
        onPointerMove: moveDrag,
        onPointerUp: (event: React.PointerEvent<SVGGElement>) => endDrag(event),
        onPointerCancel: (event: React.PointerEvent<SVGGElement>) => endDrag(event),
        onPointerEnter: () => hoverFile(node.path),
        onPointerLeave: () => {
          setHoverPath((value) => (value !== null && caseKey(value) === key ? null : value))
          props.onHoverFile?.(null)
        },
        onClick: (event: React.MouseEvent) => {
          // 选中由 click 统一执行（见 handleTap）：真实鼠标 / 程序化 / AT 共用一条路径；
          // 拖动后的那一次 click 会被 pendingTapKey 吃掉，不会"拖完还选中"。
          event.stopPropagation()
          handleTap(key, () => selectFile(node.path))
        },
        onDoubleClick: (event: React.MouseEvent) => {
          event.stopPropagation()
          props.onOpenFile?.(node.path)
        },
        onKeyDown: (event: React.KeyboardEvent) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            selectFile(node.path)
          }
        },
      },
      h('title', null, node.touched && file !== undefined ? node.path + ' · ' + formatTime(file.lastAt) : node.path),
      // r + 8 透明命中圆（扩大命中区；画在图形之前，不抢后续点击判定）。
      h('circle', { className: 'tl-ofile-hit', cx: node.x, cy: node.y, r: node.r + 8, fill: 'transparent' }),
      h('circle', { className: 'tl-ofile-halo', cx: node.x, cy: node.y, r: node.r + 5, fill, fillOpacity: isHovered ? 0.12 : 0 }),
      h('circle', {
        className: 'tl-ofile-core',
        cx: node.x,
        cy: node.y,
        r: node.r,
        fill,
        // 中性节点：低透明 + 无族色强调（不是"0 次操作"，只是没有会话数据）。
        fillOpacity: isSelected ? 1 : node.touched ? 0.82 : 0.34,
        stroke: isSelected || isHovered ? fill : 'var(--tl-bg)',
        strokeWidth: isSelected ? 1.5 : 1.1,
      }),
    )
  }

  const labelElements = nodes.flatMap((node) => {
    if (hiddenKeys !== null && hiddenKeys.has(caseKey(node.path))) return []
    const label = labelByKey.get(caseKey(node.path))
    if (label === undefined || !label.visible) return []
    const x = label.anchor === 'end' ? label.x + label.width : label.anchor === 'middle' ? label.x + label.width / 2 : label.x
    return [
      h(
        'text',
        {
          key: 'l:' + node.path,
          className: 'tl-ofile-label',
          [GRAPH_DATA.label]: node.path,
          'data-selected': selectedKey === caseKey(node.path) ? 'true' : 'false',
          x,
          y: label.y + FOLDER_LABEL_FONT_PX + 1,
          textAnchor: label.anchor,
        },
        // folderLayout 保证：放不下整条就不画，绝不截断成 「relati…」 这类碎片。
        label.text,
      ),
    ]
  })

  const renderEdge = (item: LayeredPair): React.ReactElement | null => {
    const pair = item.pair
    const from = nodeByKey.get(caseKey(pair.from))
    const to = nodeByKey.get(caseKey(pair.to))
    if (from === undefined || to === undefined) return null
    const isActive = activePair !== null && activePair.key === pair.key
    const touchesFocus = focusKey !== null && (caseKey(pair.from) === focusKey || caseKey(pair.to) === focusKey)
    /**
     * 纯结构边（只含 structure、没有共现/引用）画得更淡更细。
     *
     * 原因（R10b）：`buildStructureEdges` 对每个目录只选**一个锚点**，同目录其余文件全连到它，
     * 于是当前目录图里会有 N-1 条星形射线从同一个节点射出。它们**是真实的结构事实**（要画、要能 hover
     * 出证据），但如果和共现边一样醒目，整张图读起来就是"烟花"，看不出真正的簇。
     * 因此纯结构边降为背景骨架（淡、细、虚线已由 CSS 交给 L1 实线，这里只降透明度/线宽）。
     * 分层归属不变（仍是 L1，`data-edge-layer="L1"`），语义与证据浮层完全不受影响。
     */
    const structuralOnly = pair.typeList.every((type) => type === 'structure')
    const baseOpacity = structuralOnly ? 0.24 : item.layer === 'L1' ? 0.72 : item.layer === 'L2' ? 0.42 : 0.3
    const opacity = focusKey === null ? baseOpacity : touchesFocus ? 0.95 : structuralOnly ? 0.06 : 0.12
    return h('line', {
      key: 'e:' + pair.key,
      className: 'tl-graph-edge',
      [GRAPH_DATA.edge]: pair.key,
      [GRAPH_DATA.edgePair]: pair.key,
      [GRAPH_DATA.edgeTypes]: pair.typeList.join('|'),
      [GRAPH_DATA.edgeLayer]: item.layer,
      'data-edge-drawn': 'true',
      'data-edge-structural-only': structuralOnly ? 'true' : 'false',
      'data-layer': pair.typeList[pair.typeList.length - 1],
      'data-edge-from': pair.from,
      'data-edge-to': pair.to,
      'data-edge-count': pair.count,
      'data-edge-weight': Math.round(pair.weight * 100) / 100,
      x1: from.x,
      y1: from.y,
      x2: to.x,
      y2: to.y,
      strokeWidth: structuralOnly ? 0.8 : item.layer === 'L1' ? 1.3 : item.layer === 'L2' ? 1 : 0.9,
      strokeDasharray: pair.typeList.includes('coTurn') || pair.typeList.includes('coSession') ? '3 4' : undefined,
      opacity: isActive ? 1 : opacity,
      onPointerEnter: () => setHoverPairKey(pair.key),
      onPointerLeave: () => setHoverPairKey(null),
      onClick: (event: React.MouseEvent) => {
        event.stopPropagation()
        setPinnedPairKey((value) => (value === pair.key ? null : pair.key))
        setInspectPath(null)
      },
    })
  }

  /** 枢纽 ↔ 文件的聚合边（线宽 = 聚合权重；没有跨目录关系就不会有这些元素）。 */
  const renderHubEdge = (edge: (typeof geometry.hubEdges)[number]): React.ReactElement => {
    const hubKey = caseKey(edge.hubPath)
    const fileKey = caseKey(edge.filePath)
    const touchesFocus = focusKey !== null && (focusKey === hubKey || focusKey === fileKey)
    // 视觉定位是「背景上下文」：默认很淡（0.22），焦点相关才升到 0.8。
    // 它不能盖过当前目录内文件之间的真实关系（那些是主角，线更实、有类型色）。
    const opacity = focusKey === null ? 0.22 : touchesFocus ? 0.8 : 0.06
    const strokeWidth = Math.round(Math.min(2.2, 0.7 + Math.log2(1 + Math.max(0, edge.weight)) * 0.35) * 100) / 100
    return h('line', {
      key: 'he:' + edge.hubPath + '>' + edge.filePath,
      className: 'tl-graph-edge tl-hub-edge',
      [GRAPH_DATA.hubEdge]: edge.hubPath + '\u0000' + edge.filePath,
      'data-hub-edge-hub': edge.hubPath,
      'data-hub-edge-file': edge.filePath,
      'data-hub-edge-weight': String(edge.weight),
      'data-hub-edge-count': String(edge.count),
      'data-edge-layer': 'L1',
      x1: edge.x1,
      y1: edge.y1,
      x2: edge.x2,
      y2: edge.y2,
      strokeWidth,
      opacity,
    })
  }

  /**
   * **枢纽 ↔ 枢纽**的聚合连线（R11；03 §4.2.2「文件夹枢纽参与结构」第 2 条）。
   *
   * 视觉三层必须拉开（Lead 明确要求，别用 warning 橙色）：
   * - 文件 ↔ 文件：**实线** + 关系类型色（主角，`.tl-graph-edge`）；
   * - **文件夹 ↔ 文件夹：粗虚线** `dash 4 3` + `--tl-fg-tertiary`（中性）+ 默认 `GRAPH_HUB_PAIR_OPACITY`（背景结构）；
   * - 文件夹 ↔ 文件：细点线 `dash 1.5 3.5` + `--tl-fg-caption` + 0.22（更弱）。
   *
   * 交互：
   * - 悬停某个枢纽 → 它所有枢纽间连线**提亮**（1.0），无关的降到 0.1；
   * - 悬停/选中文件时，若该文件不属于任何枢纽，这些线整体压暗（不抢主角）；
   * - **线不加任何点击处理器**：点击枢纽仍然是「进入该目录」（用户已拍板，语义不变）。
   */
  const renderHubPair = (pair: FolderLayoutHubPair): React.ReactElement => {
    const aKey = caseKey(pair.aPath)
    const bKey = caseKey(pair.bPath)
    const touchesHubFocus = hoveredKey !== null && (hoveredKey === aKey || hoveredKey === bKey)
    const dimmed = hoveredKey !== null && !touchesHubFocus
    // 焦点在文件上（且那文件不是这两个枢纽之一）时也压暗，避免背景结构抢戏。
    const fileFocused = focusKey !== null && !touchesHubFocus && focusKey === hoveredKey
    let opacity = GRAPH_HUB_PAIR_OPACITY
    if (touchesHubFocus) opacity = 1
    else if (dimmed) opacity = 0.1
    else if (fileFocused) opacity = 0.14
    return h('line', {
      key: 'hp:' + pair.key,
      className: 'tl-graph-edge tl-hub-pair',
      // 主契约：无向归一键（min(a,b)+"\u0000"+max(a,b)，小写）。
      [GRAPH_DATA.hubPair]: pair.key,
      'data-hub-pair-a': pair.aPath,
      'data-hub-pair-b': pair.bPath,
      'data-hub-pair-weight': String(pair.weight),
      'data-hub-pair-count': String(pair.count),
      // 与文件边 `data-edge-layer` 区分：枢纽间层不参与 L1/L2/L3 分层。
      'data-hub-pair-layer': 'hub',
      'data-hub-pair-dimmed': dimmed ? 'true' : 'false',
      'data-hub-pair-focused': touchesHubFocus ? 'true' : 'false',
      x1: pair.x1,
      y1: pair.y1,
      x2: pair.x2,
      y2: pair.y2,
      strokeWidth: hubPairStrokeWidth(pair.weight),
      opacity,
    })
  }

  const evidencePanel = (): React.ReactElement | null => {
    const title = t('graph.evidenceTitle')
    const onKeyDown = (event: React.KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      closeEvidence()
    }
    const closeButton = h('button', { type: 'button', className: 'tl-graph-evidence-close', onClick: closeEvidence, 'aria-label': t('ui.close') }, '×')
    if (selectedNode !== null) {
      const file = fileByKey.get(caseKey(selectedNode.path))
      return h(
        'div',
        { className: 'tl-graph-evidence', [GRAPH_DATA.evidence]: 'file', role: 'region', 'aria-label': title, onKeyDown },
        h('div', { className: 'tl-graph-evidence-head' }, h('b', { className: 'tl-graph-evidence-title' }, title), closeButton),
        h('div', { className: 'tl-graph-evidence-path' }, selectedNode.path),
        h(
          'div',
          { className: 'tl-graph-evidence-meta' },
          h('span', { 'data-evidence-family': selectedNode.family }, t(FAMILY_MESSAGE_KEY[selectedNode.family])),
          // 未触碰 = 「会话中没有操作记录」，不显示「操作 0」。
          h(
            'span',
            { 'data-evidence-touched': selectedNode.touched ? 'true' : 'false' },
            selectedNode.touched ? t('inspector.ops') + ' ' + String(selectedNode.ops) : t('graph.noRecord'),
          ),
          file === undefined ? null : h('span', null, t('inspector.lastTouched') + ' ' + formatTime(file.lastAt)),
          h('span', null, t('graph.fileRelations', { n: selectedEdges.length })),
        ),
        selectedGroups.length === 0
          ? h('p', { className: 'tl-graph-evidence-empty' }, t('graph.noRecord'))
          : selectedGroups.map((group) =>
              h(
                'div',
                { key: group.type, className: 'tl-graph-evidence-group', 'data-evidence-type': group.type },
                h('span', { className: 'tl-graph-evidence-type' }, t(group.labelKey)),
                ...group.texts.map((text, index) => h('p', { key: index, className: 'tl-graph-evidence-text' }, text)),
              ),
            ),
      )
    }
    const pair = activePair
    if (pair === null) return null
    return h(
      'div',
      { className: 'tl-graph-evidence', [GRAPH_DATA.evidence]: 'edge', role: 'region', 'aria-label': title, onKeyDown },
      h('div', { className: 'tl-graph-evidence-head' }, h('b', { className: 'tl-graph-evidence-title' }, title), closeButton),
      h('div', { className: 'tl-graph-evidence-path' }, pair.from + ' ↔ ' + pair.to),
      h(
        'div',
        { className: 'tl-graph-evidence-meta' },
        h('span', null, t('graph.fileRelations', { n: pair.count })),
        ...pair.typeList.map((type) => h('span', { key: type, 'data-evidence-type': type }, t(RELATION_MESSAGE_KEY[type]))),
      ),
      activePairGroups.length === 0
        ? h('p', { className: 'tl-graph-evidence-empty' }, t('state.unknown'))
        : activePairGroups.map((group) =>
            h(
              'div',
              { key: group.type, className: 'tl-graph-evidence-group', 'data-evidence-type': group.type },
              h('span', { className: 'tl-graph-evidence-type' }, t(group.labelKey)),
              ...group.texts.map((text, index) => h('p', { key: index, className: 'tl-graph-evidence-text' }, text)),
            ),
          ),
    )
  }

  const densityGroup = (): React.ReactElement =>
    h(
      'div',
      { className: 'tl-graph-density', role: 'group', 'aria-label': t('graph.density'), 'data-density-active': activeDensity },
      ...DENSITY_ORDER.map((option) =>
        h(
          'button',
          {
            key: option,
            type: 'button',
            className: 'tl-graph-density-btn',
            [GRAPH_DATA.densityAction]: option,
            'data-testid': 'graph-density-' + option,
            'aria-pressed': activeDensity === option ? 'true' : 'false',
            title: t(DENSITY_MESSAGE_KEY[option]),
            onClick: () => switchDensity(option),
          },
          t(DENSITY_MESSAGE_KEY[option]),
        ),
      ),
    )

  const stageContent = (): React.ReactElement => {
    if (props.loading === true) {
      return h(
        'div',
        { className: 'tl-graph-loading', role: 'status', [GRAPH_DATA.loading]: 'true' },
        h('span', { className: 'tl-graph-loading-dot', 'aria-hidden': true }),
        h('span', null, props.loadingLabel ?? t('graph.loading')),
      )
    }
    if (props.errorText !== undefined && props.errorText !== '') {
      return h(EmptyState, { title: props.errorText, mark: '!', testId: 'graph-error' })
    }
    if (geometry.empty) {
      // 空目录：明确说「空文件夹」，不画假节点。
      return h(EmptyState, { title: props.emptyTitle ?? t('graph.emptyFolder'), mark: '◌', testId: 'graph-empty' })
    }
    return h(
      'svg',
      {
        className: 'tl-graph-svg',
        viewBox: '0 0 ' + String(geometry.width) + ' ' + String(geometry.height),
        preserveAspectRatio: 'xMidYMid meet',
        role: 'group',
        'aria-label': t('graph.title'),
        tabIndex: 0,
        onClick: onStageClick,
        onKeyDown: onStageKeyDown,
        onPointerDown: beginPan,
        onPointerMove: movePan,
        onPointerUp: endPan,
        onPointerCancel: endPan,
      },
      h('rect', { x: 0, y: 0, width: geometry.width, height: geometry.height, fill: 'transparent', 'data-graph-background': 'true' }),
      // 视图层：只做 transform（不改布局坐标）；背景 rect 不缩放，命中区始终是整块画布。
      h(
        'g',
        { className: 'tl-graph-zoom-layer', 'data-zoom-layer': 'true', transform: cameraTransform(camera) },
        // 枢纽 ↔ 枢纽（R11）画在**最底**：它是目录层的背景结构，不能盖过文件之间的真实关系。
        ...drawnHubPairs.map(renderHubPair),
        // 枢纽聚合边（跨目录真实关系）画在其次：线宽 = 聚合权重。
        ...geometry.hubEdges.map(renderHubEdge),
        ...drawnPairs.flatMap((item) => {
          const element = renderEdge(item)
          return element === null ? [] : [element]
        }),
        ...geometry.hubs.map(renderHub),
        ...nodes.map(renderNode),
        ...labelElements,
      ),
    )
  }

  return h(
    'div',
    {
      className: [GRAPH_CLASS, 'tl-graph-folder'].filter(Boolean).join(' '),
      [GRAPH_DATA.root]: 'true',
      [GRAPH_DATA.mode]: 'folder',
      [GRAPH_DATA.current]: props.currentPath,
      [GRAPH_DATA.density]: activeDensity,
      'data-density-manual': density,
      'data-show-all-expanded': showAllExpanded ? 'true' : 'false',
      'data-node-count': nodes.length,
      'data-file-count': geometry.totalFiles,
      'data-hub-count': geometry.hubCount,
      'data-hub-linked-count': geometry.hubs.filter((hub) => hub.hasLinks).length,
      /** 本档实际画出的**枢纽间连线数**（03 §4.2.2：骨架 0 / 标准 ≤2×枢纽数 / 全部 ≤4×枢纽数）。 */
      [GRAPH_DATA.hubPairCount]: drawnHubPairs.length,
      'data-hub-pair-partners': hubPairPartnersFor(activeDensity),
      [GRAPH_DATA.relationsSummary]: relationsCount,
      [GRAPH_DATA.fillRatio]: geometry.fillRatio.toFixed(3),
      'data-label-count': labels.filter((label) => label.visible).length,
      'data-zoom': String(camera.scale),
      'data-reduced-motion': props.reducedMotion === true ? 'true' : 'false',
      'data-testid': props.testId,
    },
    h(
      'div',
      { className: 'tl-graph-head' },
      h(
        'div',
        { className: 'tl-graph-title' },
        t('graph.currentDir'),
        h(
          'span',
          { className: 'tl-graph-subtitle', 'data-current-path': props.currentPath },
          currentLabel + (subtitle === '' ? '' : ' · ' + subtitle),
        ),
      ),
      // 「显示 40/137」常驻 chip：>40 时出现，可点、就地切全部（**不是**菜单/弹窗）；
      // 展开态变成「全部 137 · 收起」（pressed 描边）。诚实性信息，一直可见。
      showAllChipVisible
        ? h(
            'button',
            {
              type: 'button',
              className: 'tl-graph-note tl-graph-showall',
              [GRAPH_DATA.showAll]: 'true',
              [GRAPH_DATA.truncated]: showAllExpanded ? undefined : 'true',
              'data-expanded': showAllExpanded ? 'true' : 'false',
              'aria-pressed': showAllExpanded ? 'true' : 'false',
              'data-testid': 'graph-show-all',
              title: showingText,
              onClick: toggleShowAll,
            },
            showingText,
          )
        : null,
      // 关系计数（含"已按权重收拢"的诚实提示）。
      h('span', { className: 'tl-graph-relations', 'data-graph-relations-note': 'true' }, relationsText),
      densityGroup(),
      h(
        'div',
        { className: 'tl-graph-legend', 'aria-label': t('legend.title'), role: 'group' },
        ...FAMILY_ORDER.map((family) =>
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
    // 摘要条占位：**folder 模式没有本轮摘要，但必须占住同样的高度**（2026-11-08 修抖动）。
    //
    // 为什么：turn 模式走 FileGraph，那里有一条 36px 的本轮摘要条（读/写/删除计数），
    // 且注释写明「始终占位，避免 hover 时一行/两行切换导致画面上下跳」。
    // 但 folder 模式走本组件，此前**没有**这块占位 → 两种模式面板高度差 36px：
    //   folder 497px ／ turn 533px
    // 于是在轮次带上悬停 → 切 turn → 面板高 36px → 下方轮次带上移 → 鼠标脱离轮次块
    // → 预览清除 → 回 folder → 面板矮回去 → 轮次带下移 → 鼠标又落回块上 → **无限抖动**。
    //
    // 修法：folder 模式也渲染同高占位（`data-empty='true'`，aria-hidden，内容为空）。
    // 这样两种模式的面板高度恒等，布局不再因模式切换而跳动。
    h('div', {
      className: 'tl-graph-summary',
      [GRAPH_DATA.status]: 'empty',
      'data-empty': 'true',
      'aria-hidden': 'true',
    }),
    h('div', { className: 'tl-graph-stage', ref: stageRef, 'data-graph-stage': 'true' }, stageContent(), evidencePanel()),
  )
}
