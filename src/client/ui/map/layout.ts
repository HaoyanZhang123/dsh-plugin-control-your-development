/*
 * map/layout.ts —— 星图的**确定性**布局（03 §4.1、04 §4.5）。
 *
 * 纪律（06 A41-4）：
 * - **不用随机数、不用 Date.now、不用 Math.random**：唯一"随机性"来源是路径字符串的
 *   FNV-1a hash（04 §4.5「以路径 hash 为种子」），因此同一份数据永远得到逐节点相同的坐标；
 * - 同一数据两次调用 → 逐节点坐标相等（`layoutEqual` 可直接断言的形状）；
 * - 刷新不重排：把上一次的 `MapLayout` 作为 `previous` 传回来，路径集合没变就整体复用坐标；
 *   只有新增/删除节点或显式 `force: true`（「整理」）才重排（03 §4.1）；
 * - 节点移动只发生在新增/删除/整理；时间轴变化不进入本文件（它只改可见性/透明度/大小）；
 * - 上限：默认只布局最活跃的 600 个节点，超出显式返回 `truncated`（shown/total），不静默丢。
 *
 * 本文件是纯函数（无 DOM、无 IO、无时间依赖），可被 node 单测直接调用。
 */
import type { FileFamily, FileNode } from '../../../shared/events/index.ts'

/** 星图渲染上限（03 §4.1 / §4.2）。与 T05 的 `DEFAULT_GRAPH_LIMITS` 是两件事：这是"画多少"。 */
export const MAP_LIMITS = {
  /** 默认最多渲染 600 个最活跃文件。 */
  maxNodes: 600,
  /** 单节点最多 12 条边（交给 T05 的 finalizeGraph 执行，这里只做常数对齐）。 */
  maxEdgesPerNode: 12,
  /** 全局最多 4000 条边。 */
  maxEdgesGlobal: 4000,
} as const

/** 节点半径区间（03 §4.1：按 ops 取 log，3–9px）。 */
export const NODE_RADIUS = { min: 3, max: 9 } as const

/** 布局几何常量（世界坐标，px；与视口缩放无关）。 */
export const MAP_GEOMETRY = {
  /** 同心环之间的径向间距（= 最大节点直径 + 间隙）。 */
  ringGap: 26,
  /** 簇内边距。 */
  clusterPadding: 18,
  /** 簇标签带高度（标签常驻，03 §4.4）。 */
  clusterLabelHeight: 18,
  /** 簇与簇之间的间隙。 */
  clusterGap: 24,
  /** 世界最小宽度（数据很少时也保持一个像样的画布）。 */
  minWorldWidth: 640,
  /** 世界最小高度。 */
  minWorldHeight: 420,
  /** 世界宽高比的期望值（决定换行宽度；星图容器通常是宽扁的，2.0 更贴合）。 */
  targetAspect: 2.0,
} as const

/** 根目录文件的簇键（不是目录名，避免与真实目录 `./` 混淆）。 */
export const ROOT_CLUSTER_KEY = ''

/** 一个节点的布局结果（含绘制所需的全部数据；坐标是**世界坐标**）。 */
export interface LayoutNode {
  /** 工作区相对 POISIX 路径（节点 id；与原 FileNode.path 一致，保留大小写）。 */
  path: string
  /** 展示名（basename）。 */
  name: string
  /** 所在目录（展示用，根目录为空串）。 */
  dir: string
  family: FileFamily
  ops: number
  firstAt: number
  lastAt: number
  /** 世界坐标圆心。 */
  x: number
  y: number
  /** 节点半径（3–9，log 缩放）。 */
  r: number
  /** 所属簇键（顶层目录；根目录为 ''）。 */
  cluster: string
  /** 簇内序号（0 起；同一数据恒定）。 */
  index: number
  /** 同心环序号（0 = 簇心）。 */
  ring: number
}

/** 一个目录簇的布局结果。 */
export interface LayoutCluster {
  /** 簇键（顶层目录名；根目录为 ''）。 */
  key: string
  /** 簇标签（根目录显示 `/`，其余显示目录名）。 */
  label: string
  /** 簇边界盒子（世界坐标；含标签带）。 */
  x: number
  y: number
  width: number
  height: number
  /** 簇边界盒子的中心。 */
  cx: number
  cy: number
  /** 簇内节点数。 */
  count: number
  /** 簇内节点活动量之和（用于排序与图例）。 */
  ops: number
}

/** 节点上限截断信息（03 §4.1：显式给"显示 600/1200 个活跃文件"）。 */
export interface LayoutTruncation {
  truncated: boolean
  shown: number
  total: number
  hidden: number
}

/** 布局结果。 */
export interface MapLayout {
  nodes: LayoutNode[]
  clusters: LayoutCluster[]
  /** 世界尺寸（视口 fit 的依据）。 */
  width: number
  height: number
  /** 本次参与布局的节点数（≤ maxNodes）。 */
  shown: number
  /** 输入节点总数（含被上限截掉的）。 */
  total: number
  truncation: LayoutTruncation
  /** 本次是否整体复用了 `previous` 的坐标（刷新不跳的证据）。 */
  reusedPrevious: boolean
  /** 与上一次布局相比发生位移的节点路径（新增/删除/整理时才非空）。 */
  moved: string[]
}

export interface LayoutOptions {
  /** 上限：默认 600。 */
  maxNodes?: number
  /** 上一次的布局；路径集合不变时整体复用坐标（刷新不重排）。 */
  previous?: MapLayout | null
  /** 强制重排（用户点「整理」）。 */
  force?: boolean
}

/* ------------------------------------------------------------------ *
 * 0. 确定性基元
 * ------------------------------------------------------------------ */

/** FNV-1a 32-bit 字符串 hash（确定性种子；04 §4.5）。 */
export function hashString(input: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/** 保留 2 位小数（消除浮点尾差，保证两次布局的坐标可逐字节比较）。 */
export function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * 节点半径：ops 的 log 缩放，映射到 3–9px（03 §4.1）。
 * `maxOps <= 0` 时全部取最小半径（不产生 NaN/Infinity）。
 */
export function radiusFor(ops: number, maxOps: number): number {
  const safeMax = Math.max(1, maxOps)
  const clamped = ops <= 0 ? 0 : Math.min(ops, safeMax)
  const t = Math.log1p(clamped) / Math.log1p(safeMax)
  return round2(NODE_RADIUS.min + (NODE_RADIUS.max - NODE_RADIUS.min) * t)
}

/** 路径 → 顶层目录（簇键）。`src/client/a.ts` → `src`；`README.md` → ''（根）。 */
export function clusterKeyOf(path: string): string {
  const slash = path.indexOf('/')
  if (slash <= 0) return ROOT_CLUSTER_KEY
  return path.slice(0, slash)
}

/** 簇键 → 展示标签（根目录 `/`，与 T05 evidence 的 `displayDir` 同口径）。 */
export function clusterLabelOf(key: string): string {
  return key === ROOT_CLUSTER_KEY ? '/' : key
}

/** 派生 FileNode 的展示字段（不做 IO；不改变坐标）。 */
export function toLayoutNodeBase(node: FileNode): Omit<LayoutNode, 'x' | 'y' | 'r' | 'cluster' | 'index' | 'ring'> {
  return {
    path: node.path,
    name: node.name,
    dir: node.dir,
    family: node.family,
    ops: node.ops,
    firstAt: node.firstAt,
    lastAt: node.lastAt,
  }
}

/* ------------------------------------------------------------------ *
 * 1. 上限：按活跃度取 top-N（确定性排序）
 * ------------------------------------------------------------------ */

/**
 * 按活跃度排序：ops 降序 → lastAt 降序 → path 升序。
 * 三个键都是数据自带字段（不含 now / 随机），因此同数据同序。
 */
export function compareByActivity(left: FileNode, right: FileNode): number {
  if (left.ops !== right.ops) return right.ops - left.ops
  if (left.lastAt !== right.lastAt) return right.lastAt - left.lastAt
  return left.path < right.path ? -1 : left.path > right.path ? 1 : 0
}

export interface NodeSelection {
  shown: FileNode[]
  total: number
  truncation: LayoutTruncation
}

/** 取最活跃的 top-N；超出时返回显式的 truncation（不静默丢弃）。 */
export function selectActiveNodes(nodes: readonly FileNode[], maxNodes: number = MAP_LIMITS.maxNodes): NodeSelection {
  const total = nodes.length
  const limit = Math.max(1, Math.trunc(maxNodes))
  const ordered = nodes.slice().sort(compareByActivity)
  const shown = total > limit ? ordered.slice(0, limit) : ordered
  const hidden = Math.max(0, total - shown.length)
  return {
    shown,
    total,
    truncation: { truncated: hidden > 0, shown: shown.length, total, hidden },
  }
}

/* ------------------------------------------------------------------ *
 * 2. 簇内排布：同心环（deterministic spiral）
 * ------------------------------------------------------------------ */

/**
 * 第 `ring` 环的容量：`ring === 0` 为 1（簇心），其余按周长 / 环间距估算。
 * 环半径 = ring * ringGap，因此容量 ≈ floor(2π·ring)。
 */
export function ringCapacity(ring: number): number {
  if (ring <= 0) return 1
  return Math.max(1, Math.floor((2 * Math.PI * ring * MAP_GEOMETRY.ringGap) / MAP_GEOMETRY.ringGap))
}

/** 节点序号 → (ring, 环内序号, 环内总数)。纯函数，可单测。 */
export function ringSlot(index: number): { ring: number; slot: number; capacity: number } {
  let remaining = Math.max(0, Math.trunc(index))
  let ring = 0
  for (;;) {
    const capacity = ringCapacity(ring)
    if (remaining < capacity) return { ring, slot: remaining, capacity }
    remaining -= capacity
    ring += 1
    // 防御：600 节点最多到 ring 14 左右；上限防止坏数据死循环。
    if (ring > 200) return { ring: 200, slot: 0, capacity: 1 }
  }
}

/** 环上的角度：从 -90° 起顺时针；加一个由簇 hash 决定的固定相位（同数据恒定）。 */
export function ringAngle(slot: number, capacity: number, phase: number): number {
  const base = -Math.PI / 2 + phase
  if (capacity <= 1) return base
  return base + (2 * Math.PI * slot) / capacity
}

/** 簇内节点坐标（相对簇心）。 */
export function ringPosition(index: number, phase: number): { x: number; y: number; ring: number } {
  const { ring, slot, capacity } = ringSlot(index)
  const radius = ring * MAP_GEOMETRY.ringGap
  const angle = ringAngle(slot, capacity, phase)
  return {
    x: round2(Math.cos(angle) * radius),
    y: round2(Math.sin(angle) * radius),
    ring,
  }
}

/* ------------------------------------------------------------------ *
 * 3. 簇排布：等高行（shelf packing）
 * ------------------------------------------------------------------ */

interface ClusterBlock {
  key: string
  label: string
  nodes: FileNode[]
  ops: number
  /** 簇内半径（最后一个环的半径）。 */
  innerRadius: number
  width: number
  height: number
  /** 该簇的固定相位。 */
  phase: number
}

function buildClusterBlocks(shown: readonly FileNode[]): ClusterBlock[] {
  const byKey = new Map<string, FileNode[]>()
  for (const node of shown) {
    const key = clusterKeyOf(node.path)
    const bucket = byKey.get(key)
    if (bucket) bucket.push(node)
    else byKey.set(key, [node])
  }
  const blocks: ClusterBlock[] = []
  for (const [key, nodes] of byKey) {
    // 簇内也按活跃度排序：活动量大的节点更靠近簇心。
    const ordered = nodes.slice().sort(compareByActivity)
    const ops = ordered.reduce((sum, node) => sum + node.ops, 0)
    const lastRing = ringSlot(ordered.length - 1).ring
    const innerRadius = lastRing * MAP_GEOMETRY.ringGap
    const half = innerRadius + MAP_GEOMETRY.clusterPadding + NODE_RADIUS.max
    blocks.push({
      key,
      label: clusterLabelOf(key),
      nodes: ordered,
      ops,
      innerRadius,
      width: round2(half * 2),
      height: round2(half * 2 + MAP_GEOMETRY.clusterLabelHeight),
      phase: (hashString(key) % 360) * (Math.PI / 180),
    })
  }
  // 簇顺序：活动量降序 → 键升序（04 §4.5「按字典序/活动量排序」，两者并用是确定性的）。
  blocks.sort((left, right) => {
    if (left.ops !== right.ops) return right.ops - left.ops
    return left.key < right.key ? -1 : left.key > right.key ? 1 : 0
  })
  return blocks
}

interface PlacedBlock {
  block: ClusterBlock
  x: number
  y: number
}

/** 世界宽度：按总面积的平方根 × 宽高比估算，保证行数稳定。 */
function targetWorldWidth(blocks: readonly ClusterBlock[]): number {
  let area = 0
  for (const block of blocks) area += (block.width + MAP_GEOMETRY.clusterGap) * (block.height + MAP_GEOMETRY.clusterGap)
  const width = Math.sqrt(Math.max(area, 1) * MAP_GEOMETRY.targetAspect)
  return Math.max(MAP_GEOMETRY.minWorldWidth, width)
}

/** 等高行排布：从左到右，超过目标宽度换行。确定性（只依赖块顺序与尺寸）。 */
export function packClusters(blocks: readonly ClusterBlock[]): { placed: PlacedBlock[]; width: number; height: number } {
  const limit = targetWorldWidth(blocks)
  const placed: PlacedBlock[] = []
  let cursorX = 0
  let cursorY = 0
  let rowHeight = 0
  let maxWidth = 0
  for (const block of blocks) {
    if (cursorX > 0 && cursorX + block.width > limit) {
      cursorY += rowHeight + MAP_GEOMETRY.clusterGap
      cursorX = 0
      rowHeight = 0
    }
    placed.push({ block, x: round2(cursorX), y: round2(cursorY) })
    cursorX += block.width + MAP_GEOMETRY.clusterGap
    rowHeight = Math.max(rowHeight, block.height)
    maxWidth = Math.max(maxWidth, cursorX - MAP_GEOMETRY.clusterGap)
  }
  const height = blocks.length === 0 ? MAP_GEOMETRY.minWorldHeight : cursorY + rowHeight
  return {
    placed,
    width: Math.max(MAP_GEOMETRY.minWorldWidth, maxWidth),
    height: Math.max(MAP_GEOMETRY.minWorldHeight, height),
  }
}

/* ------------------------------------------------------------------ *
 * 4. 组装布局
 * ------------------------------------------------------------------ */

/** 最近一次布局的路径集合（用于判断"是否需要重排"）。 */
function layoutPaths(layout: MapLayout): string[] {
  return layout.nodes.map((node) => node.path).sort()
}

function samePathSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false
  for (let i = 0; i < left.length; i += 1) if (left[i] !== right[i]) return false
  return true
}

/**
 * 复用上一次布局的坐标：路径集合没变 → 整体复用（刷新不跳）。
 * 返回的 MapLayout 里 `nodes` 用**当前** FileNode 的展示字段 + 上一次的几何字段。
 */
function reuseLayout(shown: readonly FileNode[], previous: MapLayout, total: number, truncation: LayoutTruncation): MapLayout {
  const byPath = new Map<string, FileNode>()
  for (const file of shown) byPath.set(file.path, file)
  const nodes: LayoutNode[] = []
  const moved: string[] = []
  // 按**上一次的节点顺序**输出：刷新只换数据字段，DOM 顺序也保持稳定（坐标不跳的证据之一）。
  for (const prior of previous.nodes) {
    const file = byPath.get(prior.path)
    if (!file) continue
    nodes.push({
      ...toLayoutNodeBase(file),
      x: prior.x,
      y: prior.y,
      r: prior.r,
      cluster: prior.cluster,
      index: prior.index,
      ring: prior.ring,
    })
  }
  // 理论上路径集合相同（调用前已比较）；极端情况下补上遗漏的节点（确定坐标，不静默丢）。
  for (const file of shown) {
    if (previous.nodes.some((node) => node.path === file.path)) continue
    nodes.push({ ...toLayoutNodeBase(file), x: 0, y: 0, r: radiusFor(file.ops, maxOpsOf(shown)), cluster: clusterKeyOf(file.path), index: 0, ring: 0 })
    moved.push(file.path)
  }
  return {
    nodes,
    clusters: previous.clusters.map((cluster) => ({ ...cluster })),
    width: previous.width,
    height: previous.height,
    shown: nodes.length,
    total,
    truncation,
    reusedPrevious: true,
    moved,
  }
}

function maxOpsOf(nodes: readonly { ops: number }[]): number {
  let max = 0
  for (const node of nodes) if (node.ops > max) max = node.ops
  return max
}

/**
 * 计算整张星图的布局。
 *
 * 同数据同布局的关键：
 * - 输入先按 `compareByActivity` 排序（与调用方给数组的顺序无关）；
 * - 簇顺序、簇内序号、环相位全部由固定规则 / 路径 hash 决定；
 * - 浮点结果保留 2 位小数。
 */
export function layoutMap(nodes: readonly FileNode[], options: LayoutOptions = {}): MapLayout {
  const selection = selectActiveNodes(nodes, options.maxNodes ?? MAP_LIMITS.maxNodes)
  const shown = selection.shown
  const truncation = selection.truncation

  if (options.force !== true && options.previous && samePathSet(layoutPaths(options.previous), layoutPaths({ ...emptyLayout(), nodes: shown.map((file) => ({ ...toLayoutNodeBase(file), x: 0, y: 0, r: 0, cluster: '', index: 0, ring: 0 })) }))) {
    return reuseLayout(shown, options.previous, selection.total, truncation)
  }

  const blocks = buildClusterBlocks(shown)
  const packed = packClusters(blocks)
  const layoutNodes: LayoutNode[] = []
  const clusters: LayoutCluster[] = []

  for (const { block, x, y } of packed.placed) {
    const centerX = round2(x + block.width / 2)
    const centerY = round2(y + MAP_GEOMETRY.clusterLabelHeight + (block.height - MAP_GEOMETRY.clusterLabelHeight) / 2)
    let maxOps = 0
    for (const node of block.nodes) if (node.ops > maxOps) maxOps = node.ops
    const placedNodes: LayoutNode[] = []
    for (let index = 0; index < block.nodes.length; index += 1) {
      const file = block.nodes[index]
      const position = ringPosition(index, block.phase)
      placedNodes.push({
        ...toLayoutNodeBase(file),
        x: round2(centerX + position.x),
        y: round2(centerY + position.y),
        r: radiusFor(file.ops, maxOps),
        cluster: block.key,
        index,
        ring: position.ring,
      })
    }
    layoutNodes.push(...placedNodes)

    // 簇边界：以实际节点圆的外接盒为准（保证任何半径的节点都在边界内），再加内边距。
    let left = Number.POSITIVE_INFINITY
    let right = Number.NEGATIVE_INFINITY
    let top = Number.POSITIVE_INFINITY
    let bottom = Number.NEGATIVE_INFINITY
    for (const node of placedNodes) {
      left = Math.min(left, node.x - node.r)
      right = Math.max(right, node.x + node.r)
      top = Math.min(top, node.y - node.r)
      bottom = Math.max(bottom, node.y + node.r)
    }
    if (placedNodes.length === 0) {
      left = centerX
      right = centerX
      top = centerY
      bottom = centerY
    }
    const pad = MAP_GEOMETRY.clusterPadding
    const boxX = round2(left - pad)
    const boxY = round2(top - pad)
    const boxW = round2(right - left + pad * 2)
    const boxH = round2(bottom - top + pad * 2)
    clusters.push({
      key: block.key,
      label: block.label,
      x: boxX,
      y: boxY,
      width: boxW,
      height: boxH,
      cx: round2(boxX + boxW / 2),
      cy: round2(boxY + boxH / 2),
      count: placedNodes.length,
      ops: block.ops,
    })
  }

  return {
    nodes: layoutNodes,
    clusters,
    width: packed.width,
    height: packed.height,
    shown: layoutNodes.length,
    total: selection.total,
    truncation,
    reusedPrevious: false,
    moved: layoutNodes.map((node) => node.path),
  }
}

function emptyLayout(): MapLayout {
  return {
    nodes: [],
    clusters: [],
    width: 0,
    height: 0,
    shown: 0,
    total: 0,
    truncation: { truncated: false, shown: 0, total: 0, hidden: 0 },
    reusedPrevious: false,
    moved: [],
  }
}

/** 两次布局是否逐节点坐标相等（A41-4 的确定性断言）。 */
export function layoutEqual(left: MapLayout, right: MapLayout): boolean {
  if (left.nodes.length !== right.nodes.length) return false
  if (left.clusters.length !== right.clusters.length) return false
  if (left.width !== right.width || left.height !== right.height) return false
  const index = new Map<string, LayoutNode>()
  for (const node of right.nodes) index.set(node.path, node)
  for (const node of left.nodes) {
    const other = index.get(node.path)
    if (!other) return false
    if (node.x !== other.x || node.y !== other.y || node.r !== other.r) return false
  }
  return true
}

/** 坐标指纹：把逐节点坐标序列化成一串，证据文件直接照抄（可跨进程比较）。 */
export function layoutFingerprint(layout: MapLayout): string {
  return layout.nodes
    .map((node) => node.path + '@' + node.x + ',' + node.y + '#' + node.r)
    .sort()
    .join('|')
}
