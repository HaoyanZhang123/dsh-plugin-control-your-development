/*
 * map/labels.ts —— 标签避让（33 §3：标签 11–12px、避让、可读）。
 *
 * 规则（从 03 §4.4 沿用到文件关系图）：
 * - 文件名标签常驻（在可视节点集内），重叠时隐藏低优先级标签，选中/悬停永远显示；
 * - 排序键固定（优先级降序 → 键升序），同一帧的可见标签集合确定；
 * - 纯函数：只吃候选框（**屏幕像素坐标**）与已占用框，不碰 DOM。
 *
 * 与旧星图的区别：现在坐标就是屏幕坐标（viewBox 与容器 1:1，无缩放），
 * 因此字号/框宽直接按 11px 估算，不再有 zoom 阈值。
 */

/** 标签候选（屏幕坐标下的包围盒 + 文本）。 */
export interface LabelCandidate {
  /** 唯一键（节点路径）。 */
  key: string
  /** 文本（basename）。 */
  text: string
  x: number
  y: number
  width: number
  height: number
  /** 优先级（数字越大越优先；选中/悬停用大数）。 */
  priority: number
  /** 永远显示（选中/悬停；即使重叠也不隐藏）。 */
  force?: boolean
  /** 文本锚点（径向标签：外侧左半区用 end，右半区用 start）。默认 start。 */
  anchor?: 'start' | 'middle' | 'end'
}

/** 已占用的框（图例/摘要等常驻元素）。 */
export interface OccupiedBox {
  x: number
  y: number
  width: number
  height: number
}

export interface LabelPlacement {
  key: string
  visible: boolean
  x: number
  y: number
  text: string
  anchor?: 'start' | 'middle' | 'end'
  /** 估算宽度（渲染 text-anchor=end/middle 时用来反推文本 x）。 */
  width?: number
}

/** 两个矩形是否重叠（含 2px 安全间隙；边界相接不算重叠）。 */
export function boxesOverlap(left: OccupiedBox, right: OccupiedBox, gap = 2): boolean {
  return !(
    left.x + left.width + gap <= right.x ||
    right.x + right.width + gap <= left.x ||
    left.y + left.height + gap <= right.y ||
    right.y + right.height + gap <= left.y
  )
}

/** 候选排序：优先级降序 → 键升序（确定性）。 */
export function compareLabels(left: LabelCandidate, right: LabelCandidate): number {
  if (left.priority !== right.priority) return right.priority - left.priority
  return left.key < right.key ? -1 : left.key > right.key ? 1 : 0
}

/** 文本宽度估算：中文字符按 11px、其余按 6.2px（11px 字体，确定性近似，不依赖 DOM 测量）。 */
export function estimateTextWidth(text: string, fontSize = 11): number {
  let width = 0
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    width += code > 0x2e80 ? fontSize : fontSize * 0.56
  }
  return Math.round(width * 100) / 100
}

/**
 * 计算可见标签。
 *
 * @param candidates 全部候选（顺序无关；内部会排序）
 * @param occupied   已被占用的框（节点圆、已画的状态行等）
 */
export function placeLabels(
  candidates: readonly LabelCandidate[],
  occupied: readonly OccupiedBox[] = [],
  gap = 2,
): LabelPlacement[] {
  const placed: OccupiedBox[] = occupied.map((box) => ({ ...box }))
  const used: LabelPlacement[] = []
  const ordered = candidates.slice().sort(compareLabels)
  for (const candidate of ordered) {
    const box: OccupiedBox = { x: candidate.x, y: candidate.y, width: candidate.width, height: candidate.height }
    const collides = placed.some((other) => boxesOverlap(box, other, gap))
    if (collides && candidate.force !== true) {
      used.push({ key: candidate.key, visible: false, x: candidate.x, y: candidate.y, text: candidate.text, width: candidate.width, ...(candidate.anchor === undefined ? {} : { anchor: candidate.anchor }) })
      continue
    }
    placed.push(box)
    used.push({ key: candidate.key, visible: true, x: candidate.x, y: candidate.y, text: candidate.text, width: candidate.width, ...(candidate.anchor === undefined ? {} : { anchor: candidate.anchor }) })
  }
  return used.sort((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0))
}

/** 可见标签的 key 集合（测试断言用）。 */
export function visibleLabelKeys(placements: readonly LabelPlacement[]): string[] {
  return placements.filter((item) => item.visible).map((item) => item.key)
}

/** 文件名标签字号（屏幕像素；33 §3 的 11–12px）。 */
export const GRAPH_LABEL_FONT_PX = 11
/** 状态行字号（屏幕像素）。 */
export const GRAPH_STATUS_FONT_PX = 10
