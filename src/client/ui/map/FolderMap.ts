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
import { graphSkeleton } from './skeleton.ts'
import { cameraTransform, DEFAULT_CAMERA, GRAPH_ZOOM_STEP, panCameraBy, resetCamera, zoomCameraAtCenter, type GraphCamera } from './camera.ts'
import {
  FOLDER_HOVER,
  FOLDER_LABEL_FONT_PX,
  layoutFolderGeometry,
  applyDragOffsets,
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
import { readEdgeFrames, syncEdges } from './edgeSync.ts'
import type { EvidenceModel } from './evidence.ts'

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
  /**
   * 受控 hover（跨栏联动）：右栏卡片/列表的鼠标或键盘焦点落在某个路径时由父级下传。
   * `undefined` = 不受控（用组件内部 hover）；显式 `null` = 当前没有任何外部 hover。
   */
  hoveredPath?: string | null
  /** 播放头（null = 跟随现在；非 null 时 firstAt 晚于它的节点隐藏）。 */
  visibleAt?: number | null
  onSelectFile?: (path: string | null) => void
  onOpenFile?: (path: string) => void
  onHoverFile?: (path: string | null) => void
  /** 证据数据上报：由父级放进时间线区域渲染（本组件不再自己画浮层）。`null` = 无证据。 */
  onEvidence?: (model: EvidenceModel | null) => void
  /** 点文件夹枢纽 → 让右栏进入该目录（**双击 / Shift+Enter** 触发，不是单击）。 */
  onEnterFolder?: (path: string) => void
  /** 当前选中的文件夹枢纽（与文件选中互斥；单击只选中，双击才进入）。 */
  selectedFolderPath?: string | null
  onSelectFolder?: (path: string | null) => void
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
   * 关系线端点的上一帧快照（1.5.4：真机反馈「节点在动，线早就在那等着了」）。
   *
   * 为什么线必须单独处理：`<line>` 的端点属性**不能被 CSS transition 动画**
   * （实测：写 `transition: x1 …` 后改属性，70ms 就已经是终点值，`getComputedStyle` 也读不到 x1）。
   * 所以线只能在提交 DOM 之后用 rAF 逐帧插值，和节点共用同一时长/缓动 —— 见 `edgeSync.ts`。
   */
  const edgeFramesRef = React.useRef<ReadonlyMap<string, { key: string; x1: number; y1: number; x2: number; y2: number }>>(new Map())
  /** 布局过渡时长（读 CSS 令牌 `--tl-dur-layout`；读不到就用 280ms）。 */
  const layoutDurationRef = React.useRef<number>(280)
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
    /* 读一次布局过渡时长（CSS 令牌是唯一事实源，这里不写死毫秒数）。 */
    const raw = getComputedStyle(element).getPropertyValue('--tl-dur-layout').trim()
    const parsed = raw.endsWith('ms') ? Number.parseFloat(raw) : raw.endsWith('s') ? Number.parseFloat(raw) * 1000 : NaN
    if (Number.isFinite(parsed)) layoutDurationRef.current = parsed
    if (typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  /**
   * 提交 DOM 之后：把线从**上一帧的端点**插值到**新端点**（1.5.4）。
   * 声明位置在 geometry/nodes/labels 之后（依赖它们），见下方同名 useLayoutEffect。
   */

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
  /* 受控 hover 优先：父级显式给了（含 null）就以父级为准，否则用组件内部 hover。
   * 这样「右栏 → 左图」有唯一事实源，不会出现两套 hover 状态互相打架。 */
  const externalHover = props.hoveredPath === undefined ? undefined : props.hoveredPath
  const hoveredKey =
    externalHover === undefined
      ? (hoverPath === null ? null : caseKey(hoverPath))
      : (externalHover === null || externalHover === '' ? null : caseKey(externalHover))
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
  /**
   * **几何**（力导向）：只依赖数据/画布/上限/边集。
   *
   * 关键（性能根因，D-35）：**`dragOffsets` 不再进依赖**。
   * 旧实现把拖动偏移喂进布局 → 每一次 pointermove 都重跑整场力导向 + 重叠消除（O(N²)×轮数），
   * 复杂目录拖动直接卡死。拖动在语义上只是平移目标节点，因此改为"几何算一次，
   * 拖动用 applyDragOffsets 叠加"（纯坐标平移，O(N)）。
   */
  const baseGeometry: FolderGeometry = React.useMemo(
    () =>
      layoutFolderGeometry(props.entries, props.files, {
        width,
        height: height,
        currentPath: props.currentPath,
        showAll: showAllExpanded,
        edges: props.edges,
        allEdges: props.allEdges,
      }),
    [props.entries, props.files, props.currentPath, width, height, showAllExpanded, props.edges, props.allEdges],
  )

  /** 叠加拖动偏移（纯函数、不重跑模拟）。 */
  const geometry: FolderGeometry = React.useMemo(
    () => applyDragOffsets(baseGeometry, dragOffsets),
    [baseGeometry, dragOffsets],
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

  /**
   * 让关系线和节点**同步**移动（1.5.4 真机反馈「节点在动，线早就在位置上等着了」）。
   *
   * 为什么不能只靠 CSS：`<line>` 的 `x1/y1/x2/y2` 是表现属性，Chrome 不对它们做过渡
   * （实测：写 transition 后 70ms 已是终点值；`getComputedStyle` 读不到 x1）。
   * 用 `<g transform>` 也能动，但那只能表达平移 —— 端点各自移动时线会"缩"，必须逐帧改属性。
   *
   * 时机：`useLayoutEffect` 里 DOM 已是新坐标，而用户眼睛还停在旧位置；
   * 因此先读旧快照、把线钉回旧值，再用 rAF 推到新值（时长/缓动与节点 transition 一致）。
   */
  React.useLayoutEffect(() => {
    const stage = stageRef.current
    if (stage === null) return undefined
    const previous = edgeFramesRef.current
    const reduce =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const cancel = syncEdges(stage, previous, {
      durationMs: reduce ? 0 : layoutDurationRef.current,
      disabled: dragRef.current !== null,
    })
    /* 动画结束后把"最终端点"存成下一帧的起点（读 DOM 真值，不做估算）。 */
    edgeFramesRef.current = readEdgeFrames(stage)
    return cancel
  }, [geometry, nodes, labels, props.edges, props.allEdges, props.files, showAllExpanded])

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
    /* 单击 = 选中，且**幂等**：点已选中的节点不会取消。
     * 取消统一走点空白 / Esc / 关证据面板 —— 否则双击的第一次单击选中、第二次单击取消，
     * 会先「放大又缩回」再进入，用户看到的就是闪烁。 */
    if (path !== null && props.selectedPath !== null && props.selectedPath !== undefined && caseKey(props.selectedPath) === caseKey(path)) {
      setInspectPath(path)
      return
    }
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
     * 悬停互通：**只有**当前枢纽与它的真实伙伴被强调，其余枢纽保持原样（不压暗）。
     *
     * 用户明确否掉了「hover 时其他节点变暗」：那会让整张图随着鼠标忽明忽暗。
     * 现在的交互感来自「被悬浮的那一个更亮 + 与它相关的连线提亮」，无关元素不动。
     * `data-dimmed` 属性保留但恒为 'false'（下游断言/样式不再依赖 dim）。
     */
    const isHubPairPartner =
      hoveredKey === null ||
      hoveredKey === hubKey ||
      drawnHubPairs.some((pair) => {
        const aKey = caseKey(pair.aPath)
        const bKey = caseKey(pair.bPath)
        return (aKey === hoveredKey && bKey === hubKey) || (bKey === hoveredKey && aKey === hubKey)
      })
    const selectedFolderKey =
      props.selectedFolderPath === null || props.selectedFolderPath === undefined ? null : caseKey(props.selectedFolderPath)
    const isHubSelected = selectedFolderKey === hubKey
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
        'data-selected': isHubSelected ? 'true' : 'false',
        'aria-pressed': isHubSelected ? 'true' : 'false',
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
        // 单击枢纽 = **选中它**（不是进入）；进入交给双击 / Shift+Enter。
        // 理由：单击即进入会让「单击选中、双击进入」在文件夹上无法成立 ——
        // 第一次单击就跳走了，用户看到的是"放大后又缩回/直接跳目录"。
        onClick: (event: React.MouseEvent) => {
          event.stopPropagation()
          handleTap(hubKey, () => {
            props.onSelectFolder?.(hub.path)
            props.onSelectFile?.(null)
          })
        },
        onDoubleClick: (event: React.MouseEvent) => {
          event.stopPropagation()
          props.onEnterFolder?.(hub.path)
        },
        onKeyDown: (event: React.KeyboardEvent) => {
          if (event.key !== 'Enter' && event.key !== ' ') return
          event.preventDefault()
          if (event.shiftKey) props.onEnterFolder?.(hub.path)
          else {
            props.onSelectFolder?.(hub.path)
            props.onSelectFile?.(null)
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
    /* 大小未知 → 空心虚线（与 rail 的「未知」文案同义），不伪装成 0 B 小点。 */
    const sizeUnknown = node.kind === 'file' && typeof node.size !== 'number'
    const fill = node.touched ? FAMILY_COLOR[node.family as FileFamily] : 'var(--tl-fg-caption)'
    const file = fileByKey.get(key)
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
        'data-size-unknown': sizeUnknown ? 'true' : 'false',
        'data-size': typeof node.size === 'number' ? node.size : undefined,
        'aria-hidden': isFuture ? 'true' : undefined,
        /* 入场动画的错峰序号（1.5.4）：CSS 只给前 30 个排延迟，再多就看不出差别。
         * 用自定义属性而不是 nth-child，避免"节点顺序变了延迟就乱"的耦合。 */
        style: {
          ...(isFuture ? { pointerEvents: 'none' as const } : {}),
          '--tl-enter-i': String(Math.min(30, node.index)),
        } as React.CSSProperties,
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
      // 悬停光晕：D-35 起不再压暗其它节点，观感只能靠被悬浮者自身 → 光晕数值取 FOLDER_HOVER。
      h('circle', { className: 'tl-ofile-halo', cx: node.x, cy: node.y, r: node.r + 5, fill, fillOpacity: isHovered ? FOLDER_HOVER.haloOpacity : 0 }),
      h('circle', {
        className: 'tl-ofile-core',
        cx: node.x,
        cy: node.y,
        r: node.r,
        fill,
        // 中性节点：低透明 + 无族色强调（不是"0 次操作"，只是没有会话数据）。
        // 大小未知：空心（填充透明）+ 虚线描边，与「未知」语义一致。
        // 悬停：把填充提到接近实心（色相仍是族色，不丢类型），否则小半径/空心节点上
        // 只剩 1.1→1.8px 描边，用户看到的等于"没有反馈"（1.5.1 真机反馈）。
        fillOpacity: isHovered && !sizeUnknown
          ? FOLDER_HOVER.fillOpacity
          : sizeUnknown
            ? 0
            : isSelected
              ? 1
              : node.touched
                ? 0.82
                : 0.34,
        stroke: isSelected || isHovered ? fill : sizeUnknown ? 'var(--tl-fg-tertiary)' : 'var(--tl-bg)',
        strokeWidth: isSelected ? 1.5 : 1.1,
        ...(sizeUnknown ? { strokeDasharray: '2 2' } : {}),
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
    /**
     * 焦点**只提亮**、不压暗：基线透明度保持不变，被 hover/选中的那条边升到 1。
     * 旧实现把无关边压到 0.06–0.12，用户读起来是「整张图忽明忽暗」，已否掉。
     */
    const baseOpacity = structuralOnly ? 0.24 : item.layer === 'L1' ? 0.72 : item.layer === 'L2' ? 0.42 : 0.3
    const opacity = touchesFocus ? 1 : baseOpacity
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
    // 视觉定位是「背景上下文」：默认很淡（0.22），焦点相关才升到 1。
    // 只提亮、不压暗其余边（用户否掉了 hover 让整图忽明忽暗的观感）。
    const opacity = touchesFocus ? 1 : 0.22
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
    /* 只提亮相关线，其余保持基线透明度（不再压到 0.1）。 */
    let opacity = GRAPH_HUB_PAIR_OPACITY
    if (touchesHubFocus) opacity = 1
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
      'data-hub-pair-focused': touchesHubFocus ? 'true' : 'false',
      x1: pair.x1,
      y1: pair.y1,
      x2: pair.x2,
      y2: pair.y2,
      strokeWidth: hubPairStrokeWidth(pair.weight),
      opacity,
    })
  }

  /**
   * 证据上报（受控）：把"选中了谁 / 有哪些边"折成纯数据交给父级。
   *
   * 这里**只上报模型**，不再渲染浮层 —— 证据由父级放进时间线区域并完全覆盖它
   * （D-35）。这样 folder 图与 turn 图共用同一个渲染器，Esc/关闭/焦点行为只有一份。
   */
  const evidenceModel: EvidenceModel | null = (() => {
    if (selectedNode !== null) {
      const file = fileByKey.get(caseKey(selectedNode.path))
      const meta = [
        t(FAMILY_MESSAGE_KEY[selectedNode.family]),
        selectedNode.touched ? t('inspector.ops') + ' ' + String(selectedNode.ops) : t('graph.noRecord'),
        ...(file === undefined ? [] : [t('inspector.lastTouched') + ' ' + formatTime(file.lastAt)]),
        t('graph.fileRelations', { n: selectedEdges.length }),
      ]
      const groups: EvidenceModel['groups'] = selectedGroups.map((group) => ({
        type: group.type,
        labelKey: group.labelKey,
        texts: group.texts,
      }))
      return {
        kind: 'file',
        subject: selectedNode.path,
        meta,
        groups,
        emptyText: t('graph.noRecord'),
      }
    }
    const pair = activePair
    if (pair === null) return null
    return {
      kind: 'edge',
      subject: pair.from + ' \u2194 ' + pair.to,
      meta: [
        t('graph.fileRelations', { n: pair.count }),
        ...pair.typeList.map((type) => t(RELATION_MESSAGE_KEY[type])),
      ],
      groups: activePairGroups.map((group) => ({ type: group.type, labelKey: group.labelKey, texts: group.texts })),
      emptyText: t('state.unknown'),
    }
  })()

  React.useEffect(() => {
    props.onEvidence?.(evidenceModel)
  }, [evidenceModel, props.onEvidence])
  /* 卸载时清空父级的证据，避免离开本目录后时间线里残留上一份证据。 */
  React.useEffect(() => () => props.onEvidence?.(null), [props.onEvidence])

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
      // 骨架 + 一行状态：图形给"正在长出来"的形状感，文字仍由 role="status" 播报。
      return h(
        'div',
        { className: 'tl-graph-loading tl-graph-loading-skeleton', [GRAPH_DATA.loading]: 'true' },
        graphSkeleton('folder'),
        h(
          'div',
          { className: 'tl-graph-loading-label', role: 'status' },
          h('span', { className: 'tl-graph-loading-dot', 'aria-hidden': true }),
          h('span', null, props.loadingLabel ?? t('graph.loading')),
        ),
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
        /*
         * 入场动画（1.5.4 真机需求「每一次加载出来的时候都有动画，比如点不同轮次、
         * 初次加载、点击进文件夹等」）。
         *
         * 做法：用 **key** 强制重挂载，让进场动画每次都能重新播一遍。
         * - 换轮次（now）、换目录（currentPath）、切「显示全部」、密度档位变化
         *   —— 这些都是"换了一张图"，都该重新入场；
         * - 拖动/选中/悬浮**不在 key 里**：那些是同一张图内的状态变化，
         *   重新入场会闪，而且会打断布局过渡。
         *
         * 动画本身在 CSS（`threadline-graph-enter`）：节点按序号做极小的延迟错峰，
         * 线随后淡入，整体 260ms 内完成；reduced-motion 下整段不播。
         */
        key:
          'g:' +
          String(props.now ?? 0) +
          '\u0000' +
          props.currentPath +
          '\u0000' +
          (showAllExpanded ? 'all' : 'fold') +
          '\u0000' +
          density +
          '\u0000' +
          String(geometry.nodes.length),
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
    h('div', { className: 'tl-graph-stage', ref: stageRef, 'data-graph-stage': 'true' }, stageContent()),
  )
}
