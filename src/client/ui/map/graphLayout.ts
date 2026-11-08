/*
 * map/graphLayout.ts —— 轮次图的确定性径向布局（33 §3）。
 *
 * 规则（与原型一致，但**确定性**且不依赖 DOM）：
 * - 只布局当前集合（轮次 top 200，按 ops → lastAt → path 排序）；
 * - 最活跃的 1 个文件居中；其余按"先内环（≤6）后外环"铺开，角度按序号均匀分布（−90° 起）；
 * - y 方向压扁到 72%（星座感），所有坐标按容器宽高收敛，保证不出画框；
 * - 同数据 + 同容器尺寸 → 逐节点坐标相同；无随机数 / 时间依赖。
 *
 * 当前目录图（folder）**不走**这里：它用 `folderLayout.ts` 的等宽网格（文件夹带 + 文件网格）。
 * 纯函数：可被 node:test 直接调用。
 */
import type { FileFamily } from '../../../shared/events/index.ts'
import { GRAPH_LIMITS } from './theme.ts'

/** 图输入的**最小**文件形状（FileNode 的子集；测试可用手写对象）。 */
export interface GraphSourceFile {
  path: string
  name: string
  dir: string
  family: FileFamily
  ops: number
  firstAt: number
  lastAt: number
}

/**
 * 图的模式（单一执行路径：只剩 folder / turn；旧的 overview/description 已删）。
 * 本文件的径向布局只服务 `turn`；`folder` 走 `folderLayout.ts` 的网格布局。
 */
export type GraphMode = 'folder' | 'turn'

export interface GraphLayoutNode extends GraphSourceFile {
  /** 屏幕坐标（viewBox 与容器 1:1）。 */
  x: number
  y: number
  /** 节点半径（px）。 */
  r: number
  /** 0 = 中心，1/2/3 = 内/中/外环。 */
  ring: number
  /** 排序后的序号（0 起）。 */
  index: number
}

export interface GraphLayout {
  nodes: GraphLayoutNode[]
  /** 布局使用的画布尺寸（与 SVG viewBox 相同）。 */
  width: number
  height: number
  /** 实际布局的节点数（≤ 上限）。 */
  shown: number
  /** 当前集合的文件总数（含被上限截掉的）。 */
  total: number
  truncated: boolean
  mode: GraphMode
}

export interface GraphLayoutOptions {
  width: number
  height: number
  mode: GraphMode
  /** 覆盖默认上限（测试/特殊场景用）。 */
  limit?: number
}

/** 节点半径（px）：原型 `6 + min(10, sqrt(ops)*0.55)`，中心节点再 +4。 */
export function graphRadius(ops: number, center = false): number {
  const safe = Number.isFinite(ops) && ops > 0 ? ops : 0
  const radius = 6 + Math.min(10, Math.sqrt(safe) * 0.55)
  return Math.round((center ? radius + 4 : radius) * 100) / 100
}

/** 排序：ops 降序 → lastAt 降序 → path 升序（与布局/卡片同口径）。 */
export function compareGraphFiles(left: GraphSourceFile, right: GraphSourceFile): number {
  if (left.ops !== right.ops) return right.ops - left.ops
  if (left.lastAt !== right.lastAt) return right.lastAt - left.lastAt
  return left.path < right.path ? -1 : left.path > right.path ? 1 : 0
}

/** 选择要布局的节点（显式返回截断信息，不静默丢）。 */
export function selectGraphFiles(
  files: readonly GraphSourceFile[],
  options: { mode: GraphMode; limit?: number },
): { shown: GraphSourceFile[]; total: number; truncated: boolean } {
  const limit = Math.max(1, Math.trunc(options.limit ?? GRAPH_LIMITS.turn))
  const ordered = files.slice().sort(compareGraphFiles)
  const shown = ordered.length > limit ? ordered.slice(0, limit) : ordered
  return { shown, total: files.length, truncated: files.length > shown.length }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * 径向布局（只用于 turn：某一轮涉及的文件，可跨目录）。
 *
 * @param files  当前集合的全部文件（顺序无关）
 * @param options 画布尺寸 + 节点上限
 */
export function layoutFileGraph(files: readonly GraphSourceFile[], options: GraphLayoutOptions): GraphLayout {
  const width = Math.max(240, Math.round(options.width))
  const height = Math.max(240, Math.round(options.height))
  const limit = Math.max(1, Math.trunc(options.limit ?? (options.mode === 'turn' ? GRAPH_LIMITS.turn : GRAPH_LIMITS.folder)))
  const selection = selectGraphFiles(files, { mode: options.mode, limit })
  const shown = selection.shown

  const cx = width / 2
  const cy = height / 2
  // 环半径按画布收敛：内环 ≤150/118，外环 ≤230/178；垂直压扁 0.72（星座感）。
  const innerX = Math.min(150, width * 0.22)
  const outerX = Math.min(240, width * 0.35)
  const innerY = Math.min(118, height * 0.26)
  const outerY = Math.min(178, height * 0.39)
  const margin = 34

  const nodes: GraphLayoutNode[] = []
  if (shown.length === 0) {
    return { nodes, width, height, shown: 0, total: selection.total, truncated: selection.truncated, mode: options.mode }
  }

  const centerFile = shown[0]
  nodes.push({
    ...centerFile,
    x: round2(cx),
    y: round2(cy),
    r: graphRadius(centerFile.ops, true),
    ring: 0,
    index: 0,
  })

  const rest = shown.slice(1)
  const innerCount = Math.min(6, rest.length)
  const inner = rest.slice(0, innerCount)
  const midCount = Math.min(22, Math.max(0, rest.length - innerCount))
  const mid = rest.slice(innerCount, innerCount + midCount)
  const outer = rest.slice(innerCount + midCount)
  const placeRing = (list: readonly GraphSourceFile[], ring: 1 | 2 | 3): void => {
    const count = list.length
    for (let i = 0; i < count; i += 1) {
      const angle = -Math.PI / 2 + (Math.PI * 2 * i) / Math.max(1, count)
      // 三环：内环 1.0、中环 0.78、外环 1.0（外环取最大半径）；垂直压扁 0.72（星座感）。
      const radiusX = ring === 1 ? innerX : ring === 2 ? (innerX + outerX) / 2 : outerX
      const radiusY = ring === 1 ? innerY : ring === 2 ? (innerY + outerY) / 2 : outerY
      const file = list[i]
      const radius = graphRadius(file.ops)
      const x = Math.min(width - margin - radius, Math.max(margin + radius, cx + Math.cos(angle) * radiusX))
      const y = Math.min(height - margin - radius, Math.max(margin + radius, cy + Math.sin(angle) * radiusY * 0.72))
      nodes.push({ ...file, x: round2(x), y: round2(y), r: radius, ring, index: nodes.length })
    }
  }
  placeRing(inner, 1)
  placeRing(mid, 2)
  placeRing(outer, 3)

  return {
    nodes,
    width,
    height,
    shown: nodes.length,
    total: selection.total,
    truncated: selection.truncated,
    mode: options.mode,
  }
}

/** 坐标指纹（证据/确定性断言用）。 */
export function graphFingerprint(layout: GraphLayout): string {
  return layout.nodes
    .map((node) => node.path + '@' + node.x + ',' + node.y + '#' + node.r)
    .sort()
    .join('|')
}
