/*
 * map/overview.ts —— 星图总览的纯函数（T35，脉络 1.1）。
 *
 * 三件事，全部确定性、无 DOM / 无时间 / 无随机全局：
 * 1. 目录簇布局：固定 seed 的"黄金角 + 碰撞松弛"，替代同心圆；同输入同输出；
 * 2. 目录级弱关系：把文件级边按顶层目录对聚合（只在簇间画，避免数千条文件边）；
 * 3. 关系 pair 聚合 / 类型过滤 / 拖动阈值与重置：给 FileGraph 与测试共用。
 *
 * 纪律：无第三方依赖；颜色/字号不在这里写（组件只读 tokens）；数据诚实（聚合必须保留 underlying ids/evidence）。
 */
import type { FileFamily } from '../../../shared/events/index.ts'
import type { GraphEdge, RelationEvidence, RelationType } from '../../../shared/relations/index.ts'
import type { DirectoryCard } from '../rail/directories.ts'

/** 折叠态每簇显示的文件数（= 卡片 topFiles）。 */
export const OVERVIEW_TOP_FILES = 3
/** 悬浮/聚焦展开的文件数。 */
export const OVERVIEW_EXPANDED_FILES = 12
/** 簇间弱关系上限（目录对数量）。 */
export const OVERVIEW_DIR_EDGE_LIMIT = 48
/** 拖动判定阈值（px）：小于它算 click。 */
export const DRAG_THRESHOLD_PX = 3

/** 总览里的一个文件（比 GraphSourceFile 少时间字段；卡片 topFiles 也满足它）。 */
export interface OverviewFile {
  path: string
  name: string
  family: FileFamily
  ops: number
}

/** 簇内的文件节点（相对簇框的绝对坐标）。 */
export interface OverviewClusterFile extends OverviewFile {
  x: number
  y: number
  r: number
  /** 是否画名字（折叠态只画 top3 全部；展开态全画）。 */
  labelled: boolean
}

/** 一个目录簇。 */
export interface OverviewCluster {
  key: string
  label: string
  count: number
  totalOps: number
  x: number
  y: number
  width: number
  height: number
  expanded: boolean
  /** 簇内画出的文件（折叠 3 / 展开 12）。 */
  files: OverviewClusterFile[]
  /** 未画出的文件数（count - files.length）。 */
  hiddenCount: number
}

/** 目录对级的弱关系线。 */
export interface OverviewDirEdge {
  key: string
  fromKey: string
  toKey: string
  count: number
  weight: number
  edgeIds: string[]
}

/** 总览布局结果。 */
export interface OverviewLayout {
  clusters: OverviewCluster[]
  dirEdges: OverviewDirEdge[]
  width: number
  height: number
  /** 参与布局的目录数。 */
  totalDirs: number
  /** 全部文件数（簇的 count 之和）。 */
  totalFiles: number
  /** 被目录数上限截掉的目录数（当前策略：全部显示，保留字段以便将来）。 */
  hiddenDirs: number
}

export interface OverviewLayoutOptions {
  width: number
  height: number
  /** 当前悬浮或聚焦展开的目录键。 */
  expandedKey?: string | null
  /** 当前 pin 的目录键（用于 selected 状态；影响叠放顺序）。 */
  focusedKey?: string | null
  /** 每个目录的候选文件（缺省用 card.topFiles）。 */
  filesByDir?: ReadonlyMap<string, readonly OverviewFile[]>
  /** 覆盖折叠文件数（测试用）。 */
  topFiles?: number
  /** 覆盖展开文件数（测试用）。 */
  expandedFiles?: number
}

/** 简单字符串哈希（FNV-1a，32 位）：用于确定性 jitter，不用全局随机。 */
export function hashSeed(text: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/** 确定性伪随机：mulberry32（同一 seed 序列一致）。 */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = Math.imul(state ^ (state >>> 15), 1 | state)
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/** 折叠/展开时的簇框尺寸（目录越多越小，保证 20 个目录也能放下）。 */
export function clusterBoxSize(options: { count: number; expanded: boolean }): { width: number; height: number } {
  if (options.expanded) return { width: 232, height: 206 }
  if (options.count > 24) return { width: 124, height: 74 }
  if (options.count > 14) return { width: 136, height: 82 }
  if (options.count > 9) return { width: 150, height: 92 }
  return { width: 170, height: 106 }
}

/** 文件节点半径：ops 的平方根分档（与细节图同口径，略小）。 */
export function overviewFileRadius(ops: number): number {
  const safe = Number.isFinite(ops) && ops > 0 ? ops : 0
  return Math.round((3.4 + Math.min(4.2, Math.sqrt(safe) * 0.32)) * 100) / 100
}

function sortFiles(files: readonly OverviewFile[]): OverviewFile[] {
  return files.slice().sort((left, right) => (right.ops - left.ops) || (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))
}

/** 估算一个名字在 10px 下的像素宽度（与 labels.ts 的估算公式同源，但不引 DOM）。 */
function nameWidth(name: string): number {
  let width = 0
  for (const char of name) width += /[\u3000-\u9fff]/.test(char) ? 10 : 5.6
  return Math.round(width * 10) / 10
}

/**
 * 簇内文件的位置（1.1 视觉修订）：不再排成列表行，用**黄金角螺旋**铺开，
 * 折叠时 3 个节点成一个小三角、展开时 12 个节点成星座；文件名只在需要时画。
 */
function placeFiles(card: DirectoryCard, files: readonly OverviewFile[], box: { x: number; y: number; width: number; height: number }, expanded: boolean, topFiles: number, showFileLabels: boolean): OverviewClusterFile[] {
  const header = 26
  const cx = box.x + box.width / 2
  const cy = box.y + header + (box.height - header) / 2
  const maxRx = Math.max(10, box.width / 2 - 16)
  const maxRy = Math.max(8, (box.height - header) / 2 - 9)
  const requested = expanded ? Math.max(topFiles, OVERVIEW_EXPANDED_FILES) : topFiles
  const visible = files.slice(0, Math.max(1, requested))
  const seed = hashSeed(card.key)
  const phase = ((seed % 360) / 180) * Math.PI
  return visible.map((file, index) => {
    const count = Math.max(1, visible.length)
    const t = (index + 0.5) / count
    const radius = Math.sqrt(t) * 0.92
    const angle = phase + index * 2.399963229728653
    return {
      ...file,
      x: round2(cx + Math.cos(angle) * maxRx * radius),
      y: round2(cy + Math.sin(angle) * maxRy * radius),
      r: overviewFileRadius(file.ops),
      labelled: showFileLabels && index === 0,
    }
  })
}

function cardFiles(card: DirectoryCard, filesByDir: ReadonlyMap<string, readonly OverviewFile[]> | undefined): OverviewFile[] {
  const provided = filesByDir?.get(card.key)
  if (provided !== undefined && provided.length > 0) return sortFiles(provided)
  return card.topFiles.map((file) => ({ path: file.path, name: file.name, family: file.family, ops: file.ops }))
}

/** 顶层目录键（与 rail/directories.ts 的 directoryKeyOf 同口径；不 import 以避免 map → rail 的反向依赖）。 */
export function topDirectoryKey(path: string): string {
  const slash = path.indexOf('/')
  return slash <= 0 ? '' : path.slice(0, slash)
}

/**
 * 目录簇布局（确定性）。
 *
 * 算法：黄金角螺旋给初值 → 固定 seed jitter → 轻量碰撞松弛（逐个推开重叠框）→ 收敛到画布内。
 * 不做任何全局随机 / 时间依赖；同 cards 顺序 + 同尺寸 → 逐字段相同。
 */
export function layoutOverview(cards: readonly DirectoryCard[], options: OverviewLayoutOptions): OverviewLayout {
  const width = Math.max(240, Math.round(options.width))
  const height = Math.max(200, Math.round(options.height))
  const totalDirs = cards.length
  const totalFiles = cards.reduce((sum, card) => sum + card.count, 0)
  const expandedKey = options.expandedKey ?? null
  const focusedKey = options.focusedKey ?? null
  const topFiles = Math.max(1, Math.trunc(options.topFiles ?? OVERVIEW_TOP_FILES))
  const expandedFiles = Math.max(topFiles, Math.trunc(options.expandedFiles ?? OVERVIEW_EXPANDED_FILES))
  // 目录很多时不给折叠簇画文件名（标签会压到邻簇）；hover/选中仍会显示。
  const showFileLabels = totalDirs <= 12
  const margin = 16

  if (cards.length === 0) {
    return { clusters: [], dirEdges: [], width, height, totalDirs: 0, totalFiles: 0, hiddenDirs: 0 }
  }

  const cx = width / 2
  const cy = height / 2
  interface Box {
    key: string
    expanded: boolean
    x: number
    y: number
    width: number
    height: number
  }
  const gap = 10
  const boxes: Box[] = []
  const overlaps = (left: Box, right: Box): boolean => {
    const overlapX = Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x)
    const overlapY = Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y)
    return overlapX > -gap && overlapY > -gap
  }
  const clampBox = (box: Box): Box => ({
    ...box,
    x: Math.round(Math.max(margin, Math.min(width - margin - box.width, box.x)) * 100) / 100,
    y: Math.round(Math.max(margin, Math.min(height - margin - box.height, box.y)) * 100) / 100,
  })
  const fitsCanvas = (box: Box): boolean =>
    box.x >= margin - 0.01 && box.y >= margin - 0.01 && box.x + box.width <= width - margin + 0.01 && box.y + box.height <= height - margin + 0.01
  const isFree = (box: Box): boolean => fitsCanvas(box) && !boxes.some((other) => overlaps(box, other))

  // 逐个放：沿"黄金角 + 递增半径"的螺旋找第一个不重叠的位置（确定性）。
  // 找不到就缩小该簇 10% 重试；仍找不到才退到网格扫描（保证永不重叠、永不越界）。
  cards.forEach((card, index) => {
    const expanded = (expandedKey !== null && card.key === expandedKey) || (focusedKey !== null && card.key === focusedKey)
    const size = clusterBoxSize({ count: cards.length, expanded })
    const random = seededRandom(hashSeed(card.key) ^ (index + 1))
    const phase = random() * Math.PI * 2
    let placed: Box | null = null
    for (let attempt = 0; attempt < 6 && placed === null; attempt += 1) {
      const scale = Math.pow(0.9, attempt)
      const boxWidth = Math.max(84, Math.round(size.width * scale))
      const boxHeight = Math.max(62, Math.round(size.height * scale))
      for (let step = 0; step < 110; step += 1) {
        const radius = step === 0 ? 0 : 12 + step * 9
        const angle = phase + step * 0.42
        const candidate = clampBox({
          key: card.key,
          expanded,
          x: cx + Math.cos(angle) * radius * 1.05 - boxWidth / 2,
          y: cy + Math.sin(angle) * radius * 0.66 - boxHeight / 2,
          width: boxWidth,
          height: boxHeight,
        })
        if (isFree(candidate)) {
          placed = candidate
          break
        }
      }
    }
    if (placed === null) {
      // 网格扫描兜底：按行优先找空位；仍放不下就继续缩小（极端窄容器）。
      const sizes: Array<{ width: number; height: number }> = [
        { width: Math.max(84, size.width), height: Math.max(62, size.height) },
        { width: 96, height: 70 },
        { width: 80, height: 58 },
      ]
      for (const candidateSize of sizes) {
        for (let y = margin; y + candidateSize.height <= height - margin + 0.01 && placed === null; y += candidateSize.height + gap) {
          for (let x = margin; x + candidateSize.width <= width - margin + 0.01 && placed === null; x += candidateSize.width + gap) {
            const candidate = { key: card.key, expanded, x, y, width: candidateSize.width, height: candidateSize.height }
            if (isFree(candidate)) placed = candidate
          }
        }
        if (placed !== null) break
      }
    }
    if (placed !== null) boxes.push(placed)
    else boxes.push({ key: card.key, expanded, x: margin, y: margin, width: 64, height: 44 })
  })

  const clusters: OverviewCluster[] = cards.map((card, index) => {
    const box = boxes[index]
    // 折叠态严格用卡片 top3（与右栏卡片同一口径）；展开态才用全部文件重排 top12。
    const files = box.expanded
      ? cardFiles(card, options.filesByDir)
      : card.topFiles.map((file) => ({ path: file.path, name: file.name, family: file.family, ops: file.ops }))
    const visible = files.slice(0, box.expanded ? expandedFiles : topFiles)
    const rect = { x: box.x, y: box.y, width: box.width, height: box.height }
    return {
      key: card.key,
      label: card.label,
      count: card.count,
      totalOps: card.totalOps,
      x: round2(box.x),
      y: round2(box.y),
      width: box.width,
      height: box.height,
      expanded: box.expanded,
      files: placeFiles(card, visible, rect, box.expanded, topFiles, showFileLabels),
      hiddenCount: Math.max(0, card.count - visible.length),
    }
  })

  return { clusters, dirEdges: [], width, height, totalDirs, totalFiles, hiddenDirs: 0 }
}

/** 把文件级边按顶层目录对聚合（只在不同目录之间）。 */
export function aggregateDirectoryEdges(edges: readonly GraphEdge[]): OverviewDirEdge[] {
  const table = new Map<string, OverviewDirEdge>()
  for (const edge of edges) {
    const fromKey = topDirectoryKey(edge.from)
    const toKey = topDirectoryKey(edge.to)
    if (fromKey === toKey) continue
    const [first, second] = fromKey < toKey ? [fromKey, toKey] : [toKey, fromKey]
    const key = first + '|' + second
    const existing = table.get(key)
    if (existing === undefined) {
      table.set(key, { key, fromKey: first, toKey: second, count: 1, weight: edge.weight, edgeIds: [edge.id] })
    } else {
      existing.count += 1
      existing.weight += edge.weight
      existing.edgeIds.push(edge.id)
    }
  }
  return [...table.values()]
    .sort((left, right) => (right.weight - left.weight) || (right.count - left.count) || (left.key < right.key ? -1 : left.key > right.key ? 1 : 0))
    .slice(0, OVERVIEW_DIR_EDGE_LIMIT)
}

/** 文件对聚合（同一对文件的多条关系合并成一条视觉线）。 */
export interface EdgePair {
  key: string
  /** 展示端（与输入第一条边同向，无向关系不强制方向）。 */
  from: string
  to: string
  /** 类型 → 条数（按 RELATION_TYPE_ORDER 排序输出时用）。 */
  types: Partial<Record<RelationType, number>>
  typeList: RelationType[]
  count: number
  weight: number
  ids: string[]
  evidence: RelationEvidence[]
}

/** 关系类型的稳定顺序（与 theme 的图层顺序反向：结构在底，其余在上；这里只用于展示）。 */
const PAIR_TYPE_ORDER: readonly RelationType[] = ['reference', 'sequence', 'coTurn', 'coSession', 'structure']

/** 无向 pair 的稳定键（路径大小写不敏感，左小右大）。 */
export function pairKeyOf(from: string, to: string): string {
  const left = from.toLowerCase()
  const right = to.toLowerCase()
  return left < right ? left + '\u0000' + right : right + '\u0000' + left
}

/**
 * 边按 pair 聚合并排序：
 * - 权重降序 → 类型丰富度降序 → pair 键升序（确定性）；
 * - evidence 去重后保留（最多 8 条，浮层用）。
 */
export function aggregateEdgePairs(edges: readonly GraphEdge[]): EdgePair[] {
  const table = new Map<string, EdgePair>()
  for (const edge of edges) {
    const key = pairKeyOf(edge.from, edge.to)
    const existing = table.get(key)
    if (existing === undefined) {
      table.set(key, {
        key,
        from: edge.from,
        to: edge.to,
        types: { [edge.type]: 1 },
        typeList: [edge.type],
        count: 1,
        weight: edge.weight,
        ids: [edge.id],
        evidence: [edge.evidence],
      })
    } else {
      existing.types[edge.type] = (existing.types[edge.type] ?? 0) + 1
      if (!existing.typeList.includes(edge.type)) existing.typeList.push(edge.type)
      existing.count += 1
      existing.weight += edge.weight
      existing.ids.push(edge.id)
      if (existing.evidence.length < 8 && !existing.evidence.some((item) => item.text === edge.evidence.text)) existing.evidence.push(edge.evidence)
    }
  }
  const pairs = [...table.values()]
  for (const pair of pairs) pair.typeList.sort((left, right) => PAIR_TYPE_ORDER.indexOf(left) - PAIR_TYPE_ORDER.indexOf(right))
  return pairs.sort((left, right) => {
    if (left.weight !== right.weight) return right.weight - left.weight
    if (left.typeList.length !== right.typeList.length) return right.typeList.length - left.typeList.length
    return left.key < right.key ? -1 : left.key > right.key ? 1 : 0
  })
}

/** 关系类型计数（chip 用；固定顺序）。 */
export function relationTypeCounts(edges: readonly GraphEdge[]): Array<{ type: RelationType; count: number }> {
  const counts = new Map<RelationType, number>()
  for (const edge of edges) counts.set(edge.type, (counts.get(edge.type) ?? 0) + 1)
  return PAIR_TYPE_ORDER.filter((type) => (counts.get(type) ?? 0) > 0).map((type) => ({ type, count: counts.get(type) ?? 0 }))
}

/** 类型过滤：active 为空 = 全开；否则只保留 active 里的类型。 */
export function filterEdgesByTypes(edges: readonly GraphEdge[], active: ReadonlySet<RelationType> | null): GraphEdge[] {
  if (active === null || active.size === 0) return edges.slice()
  return edges.filter((edge) => active.has(edge.type))
}

/** 拖动阈值判定：移动距离 < 3px 算 click（否则算拖动）。 */
export function dragThresholdExceeded(dx: number, dy: number, threshold = DRAG_THRESHOLD_PX): boolean {
  return Math.hypot(dx, dy) >= threshold
}

/** 一个节点的拖动偏移（相对初始布局，像素）。 */
export interface NodeDragOffset {
  dx: number
  dy: number
}

/** 空拖动表（重置布局 = 清空这个表）。 */
export function resetDragOffsets(): Record<string, NodeDragOffset> {
  return {}
}

/** 追加/覆盖一次拖动（纯函数，便于测试）。 */
export function applyDragOffset(
  offsets: Readonly<Record<string, NodeDragOffset>>,
  key: string,
  offset: NodeDragOffset,
): Record<string, NodeDragOffset> {
  return { ...offsets, [key]: offset }
}

/** 交点是否在框内（测试/命中用）。 */
export function pointInBox(x: number, y: number, box: { x: number; y: number; width: number; height: number }): boolean {
  return x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height
}
