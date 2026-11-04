/*
 * map/labels.ts —— 标签避让（03 §4.4）。
 *
 * 规则：
 * - 目录簇标签常驻（不受避让影响，由簇盒子自己的位置决定）；
 * - 文件名标签只在 hover / 选中 / 放大到 1.4× 以上显示；
 * - 重叠时隐藏低优先级标签，**选中/悬停的标签永远显示**（03 §4.4）；
 * - 排序键固定（优先级降序 → 键升序），因此同一帧的可见标签集合是确定的。
 *
 * 纯函数：只吃候选框（世界坐标）与已占用的簇标签框，不碰 DOM。
 */

/** 标签候选（世界坐标下的包围盒 + 文本）。 */
export interface LabelCandidate {
  /** 唯一键（节点路径）。 */
  key: string
  /** 文本（basename 或截断后的名字）。 */
  text: string
  /** 包围盒左上角世界坐标。 */
  x: number
  y: number
  width: number
  height: number
  /** 优先级（数字越大越优先；选中/悬停用大数）。 */
  priority: number
  /** 永远显示（选中/悬停；即使重叠也不隐藏）。 */
  force?: boolean
}

/** 已占用的框（簇标签、强制标签）。 */
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
 * @param occupied   已被占用的框（簇标签等常驻元素）
 */
export function placeLabels(candidates: readonly LabelCandidate[], occupied: readonly OccupiedBox[] = []): LabelPlacement[] {
  const placed: OccupiedBox[] = occupied.map((box) => ({ ...box }))
  const used: LabelPlacement[] = []
  const ordered = candidates.slice().sort(compareLabels)
  for (const candidate of ordered) {
    const box: OccupiedBox = { x: candidate.x, y: candidate.y, width: candidate.width, height: candidate.height }
    const collides = placed.some((other) => boxesOverlap(box, other))
    if (collides && candidate.force !== true) {
      used.push({ key: candidate.key, visible: false, x: candidate.x, y: candidate.y, text: candidate.text })
      continue
    }
    placed.push(box)
    used.push({ key: candidate.key, visible: true, x: candidate.x, y: candidate.y, text: candidate.text })
  }
  // 输出保持与输入相同的顺序无关的稳定顺序：按 key 升序返回，渲染方可直接 map。
  return used.sort((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0))
}

/** 可见标签的 key 集合（测试断言用）。 */
export function visibleLabelKeys(placements: readonly LabelPlacement[]): string[] {
  return placements.filter((item) => item.visible).map((item) => item.key)
}

/** 放大到多少倍才显示文件名标签（03 §4.4）。 */
export const LABEL_ZOOM_THRESHOLD = 1.4
