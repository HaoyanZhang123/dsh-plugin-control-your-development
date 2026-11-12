/*
 * client/ui/reasoning/viz.ts —— 三种可视化（treemap / 词云 / 列表）的纯渲染。
 *
 * 全部用原生 SVG/DOM，零第三方依赖（项目硬约束）。
 * 纪律：
 * - 颜色只引用 --tl-* 令牌，不写颜色字面量；
 * - 面积/字号只表达**字符数**（覆盖最完整、不会因 token 缺失而丢样本）；
 * - 选中态用 data-selected + 强调色描边，**不用浏览器默认焦点黑框**；
 * - 统计口径一律来自 shared/reasoning / model.ts，这里只做布局与排版。
 *
 * P3 重做的三件事（每件都对应一条已核对的真机根因）：
 * 1. **矩形树图**：固定 900×380 viewBox + `preserveAspectRatio` 整体缩放，会把窄容器里的
 *    12px 标签压成 6px 不可读。现在用 `ResizeObserver` 读**真实容器尺寸**，以同一尺寸调用布局
 *    并设置同尺寸 viewBox（窄屏是**重新布局**，不是缩小图片）；布局换成真正的 squarified
 *    （旧实现是"找最接近面积半分的递归二分"，长宽比不最优）；每格独立 `clipPath`，名称与数值
 *    都不会越界；配色按 `group.key` 稳定哈希（旧实现按数组下标取色，筛选/排序一变就换色）。
 * 2. **词云**：旧实现 `cloudSlot()` 纯按序号算螺旋坐标，既不测量文字也不做碰撞检测，
 *    长词/大词/容器缩放都会重叠或越界。现在是两阶段：先用 `Canvas.measureText` 测当前字号
 *    下的真实包围盒，再按大词优先、确定性螺旋候选点放入，与已占用盒相交就继续找；
 *    仍然放不下就降字号，降到下限还放不下就**跳过并计数**，由 `未显示 N 项` 如实告知。
 * 3. **列表**：旧实现把全部行 map 成 `<tr>`（「句式开头」一维真实数据可达 23106 组）。
 *    现在是增量加载 + `显示 N/M` 计数；表头排序换成真正的 `<button>`（带 `aria-sort`）；
 *    数字右对齐 + 千分位 + 等宽数字；上下键移动、Enter 选择、Esc 清除。
 */
import * as React from 'react'
import type { ReasoningDimension, ReasoningGroup, ReasoningSentence } from '../../../shared/reasoning/index.ts'
import type { Translator } from '../../locale/index.ts'
import { formLabelKey, langLabelKey } from './model.ts'

const h = React.createElement

/* ------------------------------------------------------------------ *
 * 数字格式（列表里的字符/token/句数：千分位，避免 23106 看成 231 06）
 * ------------------------------------------------------------------ */

const COUNT_FORMAT = new Intl.NumberFormat('en-US')

/** 千分位整数（确定性：固定 en-US 分组，不随宿主 locale 漂移）。 */
export function formatCount(value: number): string {
  if (!Number.isFinite(value)) return '—'
  return COUNT_FORMAT.format(Math.round(value))
}

/* ------------------------------------------------------------------ *
 * 矩形树图：合并口径
 * ------------------------------------------------------------------ */

/**
 * treemap 的合并口径（P3 从 Top 50 收紧到 **最多 12 格**）。
 *
 * 为什么改成 12：900×380 的固定画布能塞下 50 个格子，但每个格子只有 ~60×30px ——
 * 12px 的标签放不下，实测大半格子只剩色块。现在画布按真实容器尺寸布局，
 * 12 格是「一屏内每格都放得下 12px 名称」的经验上限；其余并入「其他」（不丢量，只丢细节）。
 *
 * - `TREEMAP_MIN_SHARE`：占比低于阈值的并入「其他」（避免 1–2px 细条）；
 * - `TREEMAP_TOP_N`：**最多绘制**的格子数（含「其他」），其余并入同一个「其他」。
 */
export const TREEMAP_MIN_SHARE = 0.001
export const TREEMAP_TOP_N = 12

/** 「其他」聚合组的哨兵 key（渲染层用 locale 的 reasoning.other 显示，不裸奔到 UI）。 */
export const TREEMAP_OTHER_KEY = '\u0000other'

/**
 * 矩形树图的配色（1.5.4：真机反馈「色块太丑，饱和度太高」）。
 *
 * 只引用令牌（项目硬约束：样式里不写颜色字面量）；令牌本身已经是低饱和分类色。
 * **按 key 稳定映射**（见 `colorIndexOf`），不按下标：同一个分组在任何筛选/排序/视图下同色。
 * 最后一个色位留给「其他」，普通分组只在前面几个里取，避免和「其他」撞色。
 */
export const TREEMAP_COLORS: readonly string[] = [
  'var(--tl-chart-1)',
  'var(--tl-chart-2)',
  'var(--tl-chart-3)',
  'var(--tl-chart-4)',
  'var(--tl-chart-5)',
  'var(--tl-chart-6)',
  'var(--tl-chart-7)',
  'var(--tl-chart-8)',
]

/** FNV-1a 32 位哈希（纯函数、无随机、跨运行稳定）。 */
function hashKey(key: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash >>> 0
}

/**
 * 分组 → 色位下标（0 起）。**同一个 key 永远同一个下标**，与筛选、排序、视图无关。
 * 「其他」固定用最后一个色位（它与任何具体分组都不是同一类东西）。
 */
export function colorIndexOf(key: string): number {
  if (key === TREEMAP_OTHER_KEY) return TREEMAP_COLORS.length - 1
  return hashKey(key) % (TREEMAP_COLORS.length - 1)
}

/** 分组 → 分类色令牌字符串。 */
export function treemapColorOf(key: string): string {
  return TREEMAP_COLORS[colorIndexOf(key)]
}

/** 一个聚合结果：`groups` 是**渲染用**的最终分组，`hiddenCount` 是被合并掉的组数。 */
export interface CollapsedGroups {
  groups: ReasoningGroup[]
  hiddenCount: number
  /** 被合并进「其他」的原始分组（「其他」下钻用：点开后列出这些组，可再点进具体组）。 */
  merged: ReasoningGroup[]
}

/** 按字符降序、并列按键升序（确定性排序，布局与配色都依赖它）。 */
function byCharsDesc(left: ReasoningGroup, right: ReasoningGroup): number {
  return right.chars - left.chars || (left.key < right.key ? -1 : left.key > right.key ? 1 : 0)
}

/**
 * 把「太多太细」的分组合并成可读的一屏（纯函数，确定，便于测试）。
 *
 * 规则（与用户确认的口径一致）：
 * 1. 总字符数为 0 → 返回空（调用方已有空态，不该走到这）；
 * 2. 先按 `chars` 降序，占比 < `TREEMAP_MIN_SHARE` 的全部并入「其他」；
 * 3. 剩下的再按名次截断，**最多 12 格（含「其他」）**，其余并入同一个「其他」；
 * 4. 没有任何组被合并 → 不产生空的「其他」。
 */
export function collapseTreemapGroups(groups: readonly ReasoningGroup[]): CollapsedGroups {
  const positive = groups.filter((group) => group.chars > 0)
  if (positive.length === 0) return { groups: [], hiddenCount: 0, merged: [] }
  const total = positive.reduce((sum, group) => sum + group.chars, 0)
  if (total <= 0) return { groups: [...groups], hiddenCount: 0, merged: [] }

  const sorted = positive.slice().sort(byCharsDesc)
  /* 组数超过上限时，「其他」要占一格 → 实际保留 TREEMAP_TOP_N - 1 组。 */
  const limit = sorted.length > TREEMAP_TOP_N ? TREEMAP_TOP_N - 1 : TREEMAP_TOP_N
  const kept: ReasoningGroup[] = []
  const merged: ReasoningGroup[] = []
  for (const group of sorted) {
    const share = group.chars / total
    if (share < TREEMAP_MIN_SHARE && merged.length + kept.length > 0) {
      merged.push(group)
      continue
    }
    if (kept.length >= limit) {
      merged.push(group)
      continue
    }
    kept.push(group)
  }

  if (merged.length === 0) return { groups: kept, hiddenCount: 0, merged: [] }

  /* 「其他」的字段：字符数/句数/token 求和；主句式与语言取占比最大者（与聚合口径一致，不编造）。 */
  const other: ReasoningGroup = {
    ...merged[0],
    key: TREEMAP_OTHER_KEY,
    chars: merged.reduce((sum, group) => sum + group.chars, 0),
    answerChars: merged.reduce((sum, group) => sum + group.answerChars, 0),
    sentences: merged.reduce((sum, group) => sum + group.sentences, 0),
    blocks: merged.reduce((sum, group) => sum + group.blocks, 0),
    tokens: merged.reduce((sum, group) => sum + group.tokens, 0),
    totalTokens: merged.reduce((sum, group) => sum + group.totalTokens, 0),
    knownChars: merged.reduce((sum, group) => sum + group.knownChars, 0),
  }
  return { groups: [...kept, other], hiddenCount: merged.length, merged }
}

/* ------------------------------------------------------------------ *
 * 矩形树图：真正的 squarified 布局
 * ------------------------------------------------------------------ */

/** 布局坐标（viewBox 单位；与容器像素一一对应）。 */
export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface Slice {
  group: ReasoningGroup
  rect: Rect
}

/**
 * 测量前（SSR 首帧 / 尚未布点）用的兜底画布。
 * 真实浏览器在第一帧之后由 `ResizeObserver` 换成容器尺寸并**重新布局**。
 */
export const TREEMAP_FALLBACK_WIDTH = 720
export const TREEMAP_FALLBACK_HEIGHT = 420

interface Weighted {
  group: ReasoningGroup
  area: number
}

/**
 * 一行的最差长宽比（squarified 的目标函数：越小越"方"）。
 *
 * `areas` 是这一行里各格的面积，`side` 是这一行贴着的那条边的长度。
 * 行的厚度 = 行面积 / side，每格沿边方向的长度 = 面积 / 厚度。
 */
function worstAspect(areas: readonly number[], side: number): number {
  if (areas.length === 0 || side <= 0) return Number.POSITIVE_INFINITY
  const sum = areas.reduce((total, area) => total + area, 0)
  if (sum <= 0) return Number.POSITIVE_INFINITY
  const thickness = sum / side
  if (thickness <= 0) return Number.POSITIVE_INFINITY
  let worst = 1
  for (const area of areas) {
    if (area <= 0) continue
    const length = area / thickness
    if (length <= 0) continue
    const ratio = Math.max(length / thickness, thickness / length)
    if (ratio > worst) worst = ratio
  }
  return worst
}

/** 把一行铺到 free 空间的短边上，返回已放置的矩形与剩余空间。 */
function placeRow(row: readonly Weighted[], free: Rect): { slices: Slice[]; rest: Rect } {
  const sum = row.reduce((total, item) => total + item.area, 0)
  const slices: Slice[] = []
  if (free.w >= free.h) {
    /* 宽 >= 高：行是一竖条，贴着左侧短边（高），厚度是宽度。 */
    const thickness = sum / free.h
    let y = free.y
    for (const item of row) {
      const height = item.area / thickness
      slices.push({ group: item.group, rect: { x: free.x, y, w: thickness, h: height } })
      y += height
    }
    return { slices, rest: { x: free.x + thickness, y: free.y, w: Math.max(0, free.w - thickness), h: free.h } }
  }
  /* 宽 < 高：行是一横条，贴着上侧短边（宽），厚度是高度。 */
  const thickness = sum / free.w
  let x = free.x
  for (const item of row) {
    const width = item.area / thickness
    slices.push({ group: item.group, rect: { x, y: free.y, w: width, h: thickness } })
    x += width
  }
  return { slices, rest: { x: free.x, y: free.y + thickness, w: free.w, h: Math.max(0, free.h - thickness) } }
}

/**
 * squarified treemap（确定性：同输入同布局、无随机）。
 *
 * 与旧实现的差别（这是 P3 的第 4 条根因）：旧实现是「找最接近面积半分的切分点、递归二分」，
 * 每次二分都把长边切成两条，长宽比可能很差（细长条）。squarified 的做法是**一次铺一行**：
 * 不断把下一个矩形加入当前行，只要"加入后这一行的最差长宽比不变差"就继续，变差就封行。
 * 结果是每个格子尽量接近正方形，标签放得下。
 *
 * 输出只含矩形，不含内容（渲染与布局分离，纯函数可单测）。
 * 不变量：全部矩形落在 rect 内、互不重叠（贴边允许）、面积之和 = rect 面积、组数不少。
 */
export function layoutTreemap(
  groups: readonly ReasoningGroup[],
  rect: Rect = { x: 0, y: 0, w: TREEMAP_FALLBACK_WIDTH, h: TREEMAP_FALLBACK_HEIGHT },
): Slice[] {
  const items = groups.filter((group) => group.chars > 0).slice().sort(byCharsDesc)
  if (items.length === 0 || rect.w <= 0 || rect.h <= 0) return []
  const total = items.reduce((sum, group) => sum + group.chars, 0)
  if (total <= 0) return []

  const scale = (rect.w * rect.h) / total
  const queue: Weighted[] = items.map((group) => ({ group, area: group.chars * scale }))
  const slices: Slice[] = []
  let free: Rect = { x: rect.x, y: rect.y, w: rect.w, h: rect.h }
  let row: Weighted[] = []

  while (queue.length > 0) {
    const side = Math.min(free.w, free.h)
    if (side <= 1e-6) break
    if (row.length === 0) {
      row = [queue.shift() as Weighted]
      continue
    }
    const next = queue[0]
    const withNext = worstAspect([...row.map((item) => item.area), next.area], side)
    const withoutNext = worstAspect(row.map((item) => item.area), side)
    if (withNext <= withoutNext) {
      row = [...row, queue.shift() as Weighted]
      continue
    }
    const placed = placeRow(row, free)
    slices.push(...placed.slices)
    free = placed.rest
    row = []
  }
  if (row.length > 0) {
    const placed = placeRow(row, free)
    slices.push(...placed.slices)
  }

  /* 浮点/夹紧保护：任何矩形都必须落在画布内（越界一格就会被父级 overflow 裁掉，等于丢信息）。 */
  const clamped = slices.map((slice) => ({ group: slice.group, rect: clampRect(slice.rect, rect) }))

  /* 退化保护：容器极小/浮点下溢时**不丢组**（丢掉的分组会静默消失，比画得难看更坏）。 */
  if (clamped.length < items.length) {
    for (const group of items.slice(clamped.length)) {
      clamped.push({ group, rect: { x: rect.x, y: rect.y, w: Math.min(1, rect.w), h: Math.min(1, rect.h) } })
    }
  }
  return clamped
}

/** 把矩形夹到画布内（宽高不为负）。 */
function clampRect(inner: Rect, outer: Rect): Rect {
  const x = Math.min(Math.max(inner.x, outer.x), outer.x + outer.w)
  const y = Math.min(Math.max(inner.y, outer.y), outer.y + outer.h)
  return {
    x,
    y,
    w: Math.max(0, Math.min(inner.w, outer.x + outer.w - x)),
    h: Math.max(0, Math.min(inner.h, outer.y + outer.h - y)),
  }
}


/* ------------------------------------------------------------------ *
 * 矩形树图组件
 * ------------------------------------------------------------------ */

/** 单元格间距（viewBox 单位；同时是描边与裁剪内缩量）。 */
const TREEMAP_GAP = 2
/** 画布内边距（与 CSS 的 padding 保持一致）。 */
const TREEMAP_PAD = 8
/**
 * 矩形树图里文字的排版参数（真机缺陷 B）。
 *
 * 缺陷 B 两条根因（都已核对）：
 * 1. 阈值太粗：`w>=54 && h>=26` 才画名称、`w>=84 && h>=44` 才画数值 ——
 *    面积不小但偏窄/偏矮的格子直接一片空白（截图里大格空着）。
 * 2. 长 key 画在 x+8 后靠 clipPath 裁切 —— 出现 `Actually t` / `I should` 这种**硬切**。
 *
 * 修法：阈值降到"能放下几个字就给几个字"，且文字**先按可用宽度省略**（…），
 * 正常路径不产生任何可见裁切；clipPath 只作为估算误差的兜底。
 */
/** 名称最小格：宽 40 起（能放 3 个汉字或 5–6 个拉丁字符 + 省略号），高 20 起（放得下 12px 一行）。 */
const TREEMAP_NAME_MIN_W = 40
const TREEMAP_NAME_MIN_H = 20
/** 数值最小格：数值比名称短，但仍然要能读（64 × 40 能放下 12px 名称 + 10px 数值两行）。 */
const TREEMAP_VALUE_MIN_W = 64
const TREEMAP_VALUE_MIN_H = 40
/** 文字左侧内缩（px）。 */
const TREEMAP_TEXT_PAD_X = 8
/** 右侧留白（px）：不让文字贴到描边上。 */
const TREEMAP_TEXT_PAD_RIGHT = 6
/** 省略号（单字符，宽度按一个全角字符的 0.6 em 估算偏保守）。 */
const TREEMAP_ELLIPSIS = '…'

/**
 * 单个字符在给定字号下的近似宽度（px）。
 *
 * 口径**只有一份**：复用 `charWidthUnit`（词云的估算也用它）。
 * 两处各写一套字宽表，迟早会在"词云放得下、树图却截断"这种地方打架。
 */
export function treemapCharWidth(char: string, fontSize: number): number {
  return charWidthUnit(char.codePointAt(0) ?? 0) * fontSize
}

/**
 * 估算的安全系数。
 *
 * 为什么必须保守（实测，不是保险起见）：树图标签是 `font-weight: 600`，
 * 而 `charWidthUnit` 给的是一般字重的近似值 —— 实测「Type21 need」估 69px、真宽 **75px**（差 8.7%）。
 * 估算偏窄 → `ellipsizeText` 以为放得下 → 文字被 clipPath 裁成 `Actually t`，正是缺陷 B 的形态。
 *
 * 宁可**估宽**（提前一点省略，视觉上少一两个字），也不能估窄（出现硬切）。
 * 1.18 = 粗体实测偏差 8.7% + 不同字体族的余量。
 */
const TREEMAP_WIDTH_SAFETY = 1.18

/** 一段文字在给定字号下的估算宽度（px，已含安全系数）。 */
export function estimateTextWidth(text: string, fontSize: number): number {
  let width = 0
  for (const char of text) width += treemapCharWidth(char, fontSize)
  return width * TREEMAP_WIDTH_SAFETY
}

/**
 * 按可用宽度截断并加省略号（**不返回中间被切掉的残片**）。
 *
 * 返回 null 表示"连一个字符 + 省略号都放不下"——调用方应当不画文字，
 * 而不是画一个只有省略号的点。这正是缺陷 B 的判据：宁可整段不画，也不画 `Actually t`。
 *
 * 注意：**所有宽度都必须带同一个安全系数**。第一版这里累加的是未缩放的
 * `treemapCharWidth`、减的却是已缩放的 `ellipsisWidth`，量纲不一致 →
 * 算出来的串仍然超宽（实测「Type0 need…」估 73px、真宽 83px，照样被裁）。
 * 现在统一走 `scaledWidth`，保证返回值一定 <= maxWidth。
 */
export function ellipsizeText(text: string, maxWidth: number, fontSize: number): string | null {
  if (text === '') return null
  const scaledWidth = (value: string): number => estimateTextWidth(value, fontSize)
  const full = scaledWidth(text)
  if (full <= maxWidth) return text
  const ellipsisWidth = scaledWidth(TREEMAP_ELLIPSIS)
  if (maxWidth <= ellipsisWidth) return null
  let cut = ''
  for (const char of text) {
    const candidate = cut + char
    /* 每次都用**最终形态**（候选前缀 + 省略号）去量，避免逐字累加的浮点误差。 */
    if (scaledWidth(candidate + TREEMAP_ELLIPSIS) > maxWidth) break
    cut = candidate
  }
  if (cut === '') return null
  return cut + TREEMAP_ELLIPSIS
}


export interface TreemapProps {
  groups: readonly ReasoningGroup[]
  t: Translator
  dimension: ReasoningDimension
  selectedKey: string | null
  onSelect: (key: string) => void
}

/** 单元格实际绘制的矩形（内缩半个间距，避免相邻格描边互相覆盖）。 */
function cellOf(rect: Rect): Rect {
  return {
    x: rect.x + TREEMAP_GAP / 2,
    y: rect.y + TREEMAP_GAP / 2,
    w: Math.max(0, rect.w - TREEMAP_GAP),
    h: Math.max(0, rect.h - TREEMAP_GAP),
  }
}

/**
 * 矩形树图（P3）。
 *
 * 尺寸来源：`ResizeObserver` 读 svg 的**真实像素**，用同一尺寸做布局、同一尺寸设 `viewBox`。
 * 因为 viewBox 与容器同尺寸，缩放系数恒为 1 → 标签就是 CSS 里的 12px（窄屏是重新布局，
 * 只是每格变窄变高，字号不变）。旧实现固定 900×380 + `xMidYMid meet`，窄容器里文字会被
 * 整体缩小到 6–8px。
 */
export function Treemap(props: TreemapProps): React.ReactElement {
  const svgRef = React.useRef<SVGSVGElement | null>(null)
  const [size, setSize] = React.useState<{ w: number; h: number }>({
    w: TREEMAP_FALLBACK_WIDTH,
    h: TREEMAP_FALLBACK_HEIGHT,
  })
  /* 同一棵树上多个 Treemap 实例的 clipPath id 不能撞（SSR 也要稳定）。 */
  const uid = 'tl-tree-' + React.useId().replace(/[^A-Za-z0-9_-]/g, '')

  React.useEffect(() => {
    const node = svgRef.current
    if (node === null) return undefined
    const read = (): void => {
      const box = node.getBoundingClientRect()
      const width = Math.max(80, Math.round(box.width - TREEMAP_PAD * 2))
      const height = Math.max(60, Math.round(box.height - TREEMAP_PAD * 2))
      setSize((previous) => (previous.w === width && previous.h === height ? previous : { w: width, h: height }))
    }
    read()
    if (typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(read)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const layout = React.useMemo(
    () => layoutTreemap(props.groups, { x: TREEMAP_PAD, y: TREEMAP_PAD, w: size.w, h: size.h }),
    [props.groups, size.w, size.h],
  )
  const total = props.groups.reduce((sum, group) => sum + group.chars, 0)

  return h(
    'svg',
    {
      ref: svgRef,
      className: 'tl-treemap',
      viewBox: '0 0 ' + String(size.w + TREEMAP_PAD * 2) + ' ' + String(size.h + TREEMAP_PAD * 2),
      /* 宽高与容器一致时 meet 的缩放系数是 1（不再整体缩小）；对齐左上，避免留白抖动。 */
      preserveAspectRatio: 'xMinYMin meet',
      role: 'group',
      'aria-label': props.t('reasoning.treemap'),
      'data-view': 'treemap',
      'data-width': String(size.w),
      'data-height': String(size.h),
    },
    /* 每格一个 clipPath：名称与数值只在**自己那一格**里可见，长句首不会越界压到邻格。 */
    h(
      'defs',
      null,
      ...layout.map((slice, index) => {
        const cell = cellOf(slice.rect)
        return h(
          'clipPath',
          { key: 'clip-' + String(index), id: uid + '-cell-' + String(index) },
          h('rect', { x: cell.x, y: cell.y, width: cell.w, height: cell.h, rx: 5, ry: 5 }),
        )
      }),
    ),
    ...layout.map((slice, index) => {
      const cell = cellOf(slice.rect)
      const key = slice.group.key
      const isOther = key === TREEMAP_OTHER_KEY
      const selected = props.selectedKey !== null && props.selectedKey === key
      const label = isOther ? props.t('reasoning.other') : key
      const share = total > 0 ? slice.group.chars / total : 0
      const valueText = formatCount(slice.group.chars) + ' · ' + String(Math.round(share * 100)) + '%'
      const accessible =
        label + ' · ' + formatCount(slice.group.chars) + ' ' + props.t('reasoning.charsUnit') + ' · ' + String(Math.round(share * 100)) + '%'

      /*
       * 标签排版（缺陷 B）：先算**可用宽度**，再决定画什么。
       *
       * 阈值只回答"这一行放不放得下"，具体能放几个字交给 `ellipsizeText`
       * ——它要么返回完整文字、要么返回"前缀 + …"，要么返回 null（连省略号都放不下）。
       * 因此正常路径不会产生可见硬切；clipPath 退化为纯兜底。
       */
      const nameSize = 12
      const valueSize = 10
      const textWidth = Math.max(0, cell.w - TREEMAP_TEXT_PAD_X - TREEMAP_TEXT_PAD_RIGHT)
      const nameRoom = cell.w >= TREEMAP_NAME_MIN_W && cell.h >= TREEMAP_NAME_MIN_H
      /* 「其他」是最大格之一，且它是"合并了多少组"的唯一入口 —— 只要放得下就一定给名称。 */
      const nameText = nameRoom ? ellipsizeText(label, textWidth, nameSize) : null
      /* 数值行需要名称行之上再加一行高度；名称没画时数值没有意义（用户不知道它在说谁）。 */
      const valueRoom =
        nameText !== null && cell.w >= TREEMAP_VALUE_MIN_W && cell.h >= TREEMAP_VALUE_MIN_H
      const valueShown = valueRoom ? ellipsizeText(valueText, textWidth, valueSize) : null

      return h(
        'g',
        {
          key,
          className: 'tl-tree-cell',
          'data-group-key': key,
          'data-dimension': props.dimension,
          /* 「其他」是合成组：NUL 哨兵在 CSS 选择器里不可用（U+0000 会被替换成 U+FFFD），
           * 所以额外给一个可选中的标记，测试与 harness 靠它定位「其他」格。 */
          ...(isOther ? { 'data-other': 'true' } : {}),
          /* data-tone 由稳定哈希得出（不是序号）：同一个分组在任何排序下同一色位。 */
          'data-tone': String(colorIndexOf(key) + 1),
          'data-selected': selected ? 'true' : 'false',
          role: 'button',
          tabIndex: 0,
          'aria-pressed': selected ? 'true' : 'false',
          'aria-label': accessible,
          onClick: () => props.onSelect(key),
          onKeyDown: (event: React.KeyboardEvent) => {
            if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'Spacebar') return
            event.preventDefault()
            props.onSelect(key)
          },
        },
        h('rect', {
          className: 'tl-tree-rect',
          x: cell.x,
          y: cell.y,
          width: cell.w,
          height: cell.h,
          rx: 5,
          ry: 5,
          /* 用**内联 style** 而不是 SVG 的 fill 表现属性：后者优先级低于任何 CSS 规则，
           * 会被 stylesheet 的兜底色覆盖（实测：写 fill 属性时所有格子同色）。 */
          style: { fill: treemapColorOf(key) },
        }),
        h(
          'g',
          /* clipPath 只是兜底（防字宽估算误差）；文字已经按可用宽度省略，正常不触发裁切。 */
          { clipPath: 'url(#' + uid + '-cell-' + String(index) + ')' },
          nameText === null
            ? null
            : h(
                'text',
                {
                  className: 'tl-tree-name',
                  x: cell.x + TREEMAP_TEXT_PAD_X,
                  y: cell.y + 18,
                  /* 原始 key 完整可查（视觉上省略，语义上不省略）。 */
                  'data-full-label': label,
                },
                nameText,
              ),
          valueShown === null
            ? null
            : h('text', { className: 'tl-tree-value', x: cell.x + TREEMAP_TEXT_PAD_X, y: cell.y + 33 }, valueShown),
        ),
        h('title', null, accessible),
      )
    }),
  )
}

/* ------------------------------------------------------------------ *
 * 词云：两阶段布局（测量 → 确定性地放置）
 * ------------------------------------------------------------------ */

/** 词云的显示符号（1.5.3 修「显示星号」）。
 *
 * 真因：旧实现只有 `FORM_GLYPH`（五个 key），而 `group.key` 在「句式开头 / 语言 / 模型 /
 * Preset」这些维度下是**任意字符串**（"I need"、"中文"、"DeepSeek V4"），查不到就落到 `◈`。
 * 正确口径：符号只属于 form 维度；其它维度**显示 key 本身**（那是可读文字）。
 */
export function cloudGlyphOf(key: string, dimension: ReasoningDimension): string {
  if (dimension === 'form') return FORM_GLYPH[key] ?? key
  return key
}

/** 句式的图标符号（form 维度用；其它维度显示原文）。 */
const FORM_GLYPH: Readonly<Record<string, string>> = {
  plan: '◈',
  question: '?',
  imperative: '→',
  warning: '!',
  statement: '·',
}

/** 词云最多放多少个词（用户要求「显示前 50」）；超出与放不下的都计入「未显示」。 */
export const CLOUD_MAX_WORDS = 50
/** 字号区间：大词 40px、小词 10px（对数压缩，避免头尾差两个数量级时小词不可读）。 */
const CLOUD_MIN_FONT_SIZE = 10
const CLOUD_MAX_FONT_SIZE = 40
/** 行高：与 CSS 的 line-height 一致，测量高度 = 字号 × 这个值（两端口径唯一）。 */
const CLOUD_WORD_LINE_HEIGHT = 1.2
/** 词框之间保留的最小空隙（px）：贴着也算重叠，否则视觉上会粘在一起。 */
const CLOUD_BOX_GAP = 4
/**
 * 词块的水平内边距（与 CSS 的 `padding: 0 2px` 逐字对应）。
 *
 * 必须计进包围盒：`canvas.measureText` 只量字形宽，而 `<button>` 的实际占位是
 * 字形宽 + 左右内边距。漏掉这 4px 时相邻词会**实测重叠**（探针在 1440 与 560 宽各抓到 1 处）。
 */
const CLOUD_WORD_PADDING_X = 2
/** 螺旋候选点数量（确定性；260 个点足够铺满一屏 50 个词）。 */
const CLOUD_CANDIDATE_COUNT = 260
/** 放不下时的降字号比例（每档 ×0.82，直到 10px 下限）。 */
const CLOUD_SHRINK = 0.82
/** 测量前（SSR 首帧）的兜底画布。 */
export const CLOUD_FALLBACK_WIDTH = 640
export const CLOUD_FALLBACK_HEIGHT = 420

/** 一个待放置的词（字号由字符数决定，`weight` 只用于加粗档位与 data 属性）。 */
export interface CloudWord {
  key: string
  text: string
  chars: number
  fontSize: number
  weight: number
  lang: ReasoningLangKey
}

type ReasoningLangKey = ReasoningGroup['lang']

/** 一个已放置的词（left/top 是**中心**坐标，CSS 用 translate(-50%,-50%)）。 */
export interface CloudPlacement {
  key: string
  text: string
  chars: number
  left: number
  top: number
  width: number
  height: number
  fontSize: number
  weight: number
  colorIndex: number
  lang: ReasoningLangKey
}

export interface CloudLayout {
  words: CloudPlacement[]
  /** 放不下的词数（含被 CLOUD_MAX_WORDS 截掉的）。 */
  skipped: number
  /** 参与排版的词数（= words.length + skipped）。 */
  total: number
  width: number
  height: number
}

/** 文本测量器：给定文字 / 字号 / 字重，返回真实包围盒（px）。 */
export type TextMeasure = (text: string, fontSize: number, weight: number) => { width: number; height: number }

/**
 * 无 canvas 时的确定性估算（SSR / 测试 / 极旧浏览器）。
 *
 * 只用于「还没测量」的第一帧：真实浏览器会在 effect 里换成 `Canvas.measureText`。
 * 估算按字符类别给宽度单位（CJK 1.0 em、大写 0.66、小写 0.52、数字 0.56、空格 0.32），
 * 高度固定为 字号 × 行高，与 canvas 路径保持同一口径（否则两帧布局会互相打架）。
 */
export function estimateTextSize(text: string, fontSize: number, weight: number): { width: number; height: number } {
  let units = 0
  for (const char of text) {
    units += charWidthUnit(char.codePointAt(0) ?? 0)
  }
  /* 粗体略宽：与 canvas 的 bold 实测方向一致（不做像素级标定，只保证单调）。 */
  const bold = weight >= 0.8 ? 1.04 : 1
  return { width: Math.max(1, units * fontSize * bold), height: fontSize * CLOUD_WORD_LINE_HEIGHT }
}

/** 单字符宽度（em 单位）：CJK 全宽，其余按拉丁字面近似。 */
function charWidthUnit(code: number): number {
  if (code === 32 || code === 0x3000) return 0.32
  /* CJK 统一表意 / 假名 / 谚文 / 全角标点：视作 1 em。 */
  if (
    (code >= 0x2e80 && code <= 0x9fff) ||
    (code >= 0xac00 && code <= 0xd7af) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xff00 && code <= 0xff60)
  ) {
    return 1
  }
  if (code >= 48 && code <= 57) return 0.56
  if (code >= 65 && code <= 90) return 0.66
  return 0.52
}

/**
 * 确定性螺旋候选点（按距中心的半径递增）。
 *
 * 第一个点是正中心（最大的词居中），之后用黄金角让相邻点自然错开。
 * 半径按 sqrt(progress) 增长，保证内圈密、外圈疏（大词在内、小词在外）。
 */
function spiralPoints(width: number, height: number, count: number): Array<{ x: number; y: number }> {
  const points: Array<{ x: number; y: number }> = [{ x: width / 2, y: height / 2 }]
  const golden = 2.399963229728653
  const radiusX = Math.max(1, width / 2 - 2)
  const radiusY = Math.max(1, height / 2 - 2)
  for (let index = 1; index < count; index += 1) {
    const progress = index / count
    const radius = Math.sqrt(progress)
    const angle = index * golden
    points.push({
      x: width / 2 + Math.cos(angle) * radius * radiusX,
      y: height / 2 + Math.sin(angle) * radius * radiusY,
    })
  }
  return points
}

function rectsOverlap(a: Rect, b: Rect, gap: number): boolean {
  return a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap
}

function rectInside(rect: Rect, width: number, height: number): boolean {
  return rect.x >= 0 && rect.y >= 0 && rect.x + rect.w <= width && rect.y + rect.h <= height
}

/**
 * 词云两阶段布局：**先测量、再放置**（P3 第 6 条根因）。
 *
 * 旧实现 `cloudSlot(index)` 纯按序号算螺旋坐标：不测量文字、不做碰撞检测，
 * 于是长词越界、大词压小词、容器一缩全部重叠。
 *
 * 现在：
 * 1. 按字号降序（大词优先拿到靠近中心的点）；
 * 2. 每个词用 `measure` 量出**当前字号**下的真实包围盒；
 * 3. 依次试螺旋候选点（由内向外），落在画布内且与所有已放置盒（外扩 `CLOUD_BOX_GAP`）都不相交才放；
 * 4. 当前字号所有候选点都放不下 → 降一档字号（×0.82）重试，直到 10px 下限；
 * 5. 10px 仍放不下 → **跳过并计数**（绝不静默丢失，UI 会显示「未显示 N 项」）。
 *
 * 同输入同输出：候选点、排序、降字号步长全部确定。
 */
export function layoutWordCloud(
  entries: readonly CloudWord[],
  box: { width: number; height: number },
  measure: TextMeasure = estimateTextSize,
): CloudLayout {
  const width = Math.max(1, box.width)
  const height = Math.max(1, box.height)
  const sorted = entries
    .slice()
    .sort(
      (left, right) =>
        right.fontSize - left.fontSize || right.chars - left.chars || (left.key < right.key ? -1 : left.key > right.key ? 1 : 0),
    )
  const points = spiralPoints(width, height, CLOUD_CANDIDATE_COUNT)
  const placed: CloudPlacement[] = []
  const occupied: Rect[] = []
  let skipped = 0

  for (const entry of sorted) {
    let size = Math.min(CLOUD_MAX_FONT_SIZE, Math.max(CLOUD_MIN_FONT_SIZE, entry.fontSize))
    let done = false
    for (;;) {
      const metrics = measure(entry.text, size, entry.weight)
      /* 包围盒 = 字形 + 内边距（CSS 的实际占位），否则碰撞检测会漏掉 4px 而造成贴边重叠。 */
      const boxW = metrics.width + CLOUD_WORD_PADDING_X * 2
      const boxH = metrics.height
      if (boxW <= width && boxH <= height) {
        for (const point of points) {
          const rect: Rect = { x: point.x - boxW / 2, y: point.y - boxH / 2, w: boxW, h: boxH }
          if (!rectInside(rect, width, height)) continue
          if (occupied.some((other) => rectsOverlap(other, rect, CLOUD_BOX_GAP))) continue
          placed.push({
            key: entry.key,
            text: entry.text,
            chars: entry.chars,
            left: rect.x,
            top: rect.y,
            width: rect.w,
            height: rect.h,
            fontSize: size,
            weight: entry.weight,
            colorIndex: colorIndexOf(entry.key),
            lang: entry.lang,
          })
          occupied.push(rect)
          done = true
          break
        }
      }
      if (done) break
      if (size <= CLOUD_MIN_FONT_SIZE) break
      size = Math.max(CLOUD_MIN_FONT_SIZE, Math.floor(size * CLOUD_SHRINK))
    }
    if (!done) skipped += 1
  }

  return { words: placed, skipped, total: sorted.length, width, height }
}

/**
 * 分组 → 待放置的词（字号 ∝ 字符数，对数压缩）。
 *
 * 只取 `CLOUD_MAX_WORDS` 个；「其他」是合成组，不进入词云（它不是一个"词"）。
 * 被截掉的数量会体现在 `skipped` 里（`layoutWordCloud` 的 total 只算传进去的这些，
 * 组件层用 `skipped + (groups 里没传进来的)` 算「未显示」）。
 */
export function cloudEntries(groups: readonly ReasoningGroup[], dimension: ReasoningDimension, limit = CLOUD_MAX_WORDS): CloudWord[] {
  const sorted = groups
    .filter((group) => group.chars > 0 && group.key !== TREEMAP_OTHER_KEY)
    .slice()
    .sort(byCharsDesc)
    .slice(0, limit)
  if (sorted.length === 0) return []
  const max = sorted[0].chars
  const min = sorted[sorted.length - 1].chars
  const lo = Math.log(Math.max(1, min))
  const hi = Math.log(Math.max(2, max))
  const weightOf = (chars: number): number => {
    if (max === min || hi === lo) return 0.7
    return (Math.log(Math.max(1, chars)) - lo) / (hi - lo)
  }
  return sorted.map((group) => {
    const weight = Math.round(weightOf(group.chars) * 10) / 10
    const fontSize = Math.round(CLOUD_MIN_FONT_SIZE + weight * (CLOUD_MAX_FONT_SIZE - CLOUD_MIN_FONT_SIZE))
    return {
      key: group.key,
      text: cloudGlyphOf(group.key, dimension),
      chars: group.chars,
      fontSize,
      weight,
      lang: group.lang,
    }
  })
}

export interface WordCloudProps {
  groups: readonly ReasoningGroup[]
  t: Translator
  /** 维度决定文字口径：form 显示可读符号，其它维度显示 key 本身。 */
  dimension: ReasoningDimension
  selectedKey: string | null
  onSelect: (key: string) => void
}

/**
 * 词云（P3 重做：文字即图形，位置来自真实测量）。
 *
 * 尺寸来源：`ResizeObserver` 读容器真实像素 → 容器变化时**重新排版**（不是缩放图片）。
 * 测量来源：`Canvas.measureText`（同一个 canvas 复用于所有词），SSR 首帧退化为确定性估算。
 */
export function WordCloud(props: WordCloudProps): React.ReactElement {
  const hostRef = React.useRef<HTMLDivElement | null>(null)
  const [box, setBox] = React.useState<{ width: number; height: number }>({
    width: CLOUD_FALLBACK_WIDTH,
    height: CLOUD_FALLBACK_HEIGHT,
  })
  const [measure, setMeasure] = React.useState<TextMeasure>(() => estimateTextSize)

  const entries = React.useMemo(() => cloudEntries(props.groups, props.dimension), [props.groups, props.dimension])

  React.useEffect(() => {
    const host = hostRef.current
    if (host === null) return undefined

    /* 一次建 canvas，复用于所有词的测量（每词新建 canvas 会明显拖慢首帧）。 */
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    if (context !== null) {
      const family = window.getComputedStyle(host).fontFamily === '' ? 'sans-serif' : window.getComputedStyle(host).fontFamily
      const measured: TextMeasure = (text, fontSize, weight) => {
        context.font = String(weight >= 0.8 ? 700 : 500) + ' ' + String(Math.round(fontSize * 100) / 100) + 'px ' + family
        const metrics = context.measureText(text)
        /* 宽度用实测；高度取 字号 × 行高，与 CSS line-height 同口径（两帧布局不打架）。 */
        return { width: Math.max(1, metrics.width), height: fontSize * CLOUD_WORD_LINE_HEIGHT }
      }
      setMeasure(() => measured)
    }

    const read = (): void => {
      const rect = host.getBoundingClientRect()
      const width = Math.max(80, Math.round(rect.width))
      const height = Math.max(80, Math.round(rect.height))
      setBox((previous) => (previous.width === width && previous.height === height ? previous : { width, height }))
    }
    read()
    if (typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(read)
    observer.observe(host)
    return () => observer.disconnect()
  }, [])

  const layout = React.useMemo(() => layoutWordCloud(entries, box, measure), [entries, box, measure])

  const totalChars = props.groups.reduce((sum, group) => sum + group.chars, 0)
  /* 「未显示」= 放不下的 + 因为只画前 50 个而没参与排版的（两者都必须说出数量）。 */
  const considered = props.groups.filter((group) => group.chars > 0 && group.key !== TREEMAP_OTHER_KEY).length
  const notShown = Math.max(0, considered - layout.words.length)

  return h(
    'div',
    {
      ref: hostRef,
      className: 'tl-word-cloud',
      role: 'group',
      'aria-label': props.t('reasoning.cloud'),
      'data-view': 'cloud',
      'data-count': String(layout.words.length),
      'data-total': String(considered),
      /* data-skipped 是**用户看到的**"未显示"总数（放不下 + 超过 50 个没参与排版）；
       * data-unplaced 只统计"测量后放不下"的那部分（排查排版质量用）。 */
      'data-skipped': String(notShown),
      'data-unplaced': String(layout.skipped),
      'data-width': String(layout.width),
      'data-height': String(layout.height),
    },
    ...layout.words.map((word) => {
      const selected = props.selectedKey !== null && props.selectedKey === word.key
      const share = Math.round((word.chars / Math.max(1, totalChars)) * 1000) / 10
      const accessible =
        word.text + ' · ' + formatCount(word.chars) + ' ' + props.t('reasoning.charsUnit') + ' · ' + String(share) + '%'
      return h(
        'button',
        {
          key: word.key,
          type: 'button',
          className: 'tl-cloud-word',
          'data-group-key': word.key,
          'data-lang': word.lang,
          'data-glyph': 'text',
          /* 稳定色位（按 key 哈希，不按序号）→ 同一分组在任何筛选/排序下同色。 */
          'data-tone': String(word.colorIndex + 1),
          'data-weight': String(word.weight),
          'data-selected': selected ? 'true' : 'false',
          'aria-pressed': selected ? 'true' : 'false',
          'aria-label': accessible,
          title: accessible,
          style: {
            left: String(Math.round(word.left)) + 'px',
            top: String(Math.round(word.top)) + 'px',
            fontSize: String(word.fontSize) + 'px',
          },
          onClick: () => props.onSelect(word.key),
        },
        word.text,
      )
    }),
    notShown > 0
      ? h(
          'p',
          { className: 'tl-cloud-skipped', role: 'status', 'data-testid': 'reasoning-cloud-skipped' },
          props.t('reasoning.cloudSkipped', { n: String(notShown) }),
        )
      : null,
  )
}

/* ------------------------------------------------------------------ *
 * 列表：分组表（窗口化 / 增量加载）
 * ------------------------------------------------------------------ */

/** 分组列表首屏行数（其余靠「继续加载」追加，不一次渲染 23106 行）。 */
export const LIST_PAGE_SIZE = 60
/** 句子下钻首屏条数（句子正文比表格行重得多）。 */
export const SENTENCE_PAGE_SIZE = 40

export interface GroupListProps {
  groups: readonly ReasoningGroup[]
  t: Translator
  sortKey: 'chars' | 'tokens' | 'key'
  sortDir: 1 | -1
  onSort: (key: 'chars' | 'tokens' | 'key') => void
  selectedKey: string | null
  onSelect: (key: string) => void
  /** Esc：清除选中（与图形视图共享同一个选中状态）。 */
  onClear?: () => void
}

/** 表头排序按钮（真正的 button：键盘可达、语义完整、方向可见）。 */
function sortHeader(
  t: Translator,
  labelKey: string,
  key: 'chars' | 'tokens' | 'key',
  sortKey: 'chars' | 'tokens' | 'key',
  sortDir: 1 | -1,
  onSort: (key: 'chars' | 'tokens' | 'key') => void,
  numeric: boolean,
): React.ReactElement {
  const active = sortKey === key
  const direction = active ? (sortDir === 1 ? '↑' : '↓') : ''
  const hint = active ? (sortDir === 1 ? t('reasoning.sortedAsc') : t('reasoning.sortedDesc')) : labelKey
  return h(
    'button',
    {
      type: 'button',
      className: 'tl-sort-btn',
      'data-sort-key': key,
      'data-sort-active': active ? 'true' : 'false',
      title: active ? t(labelKey as never) + ' · ' + hint : t(labelKey as never),
      onClick: () => onSort(key),
      /* 数字列右对齐（th 的 .tl-num 负责），按钮内容跟随。 */
      style: numeric ? { justifyContent: 'flex-end' } : undefined,
    },
    h('span', null, t(labelKey as never)),
    active ? h('span', { className: 'tl-sort-glyph', 'aria-hidden': 'true' }, direction) : null,
  )
}

export function GroupList(props: GroupListProps): React.ReactElement {
  const sorted = React.useMemo(() => {
    const copy = props.groups.slice()
    copy.sort((left, right) => {
      let result: number
      if (props.sortKey === 'key') result = left.key < right.key ? -1 : left.key > right.key ? 1 : 0
      else if (props.sortKey === 'tokens') result = left.tokens - right.tokens
      else result = left.chars - right.chars
      return result * props.sortDir
    })
    return copy
  }, [props.groups, props.sortKey, props.sortDir])

  const [shown, setShown] = React.useState(LIST_PAGE_SIZE)
  /* 筛选/排序换了数据就回到首屏：否则「显示 240/240」会在新数据上假称已全量。 */
  React.useEffect(() => {
    setShown(LIST_PAGE_SIZE)
  }, [props.groups])

  const total = sorted.length
  const visible = sorted.slice(0, shown)
  const ariaSort = (key: 'chars' | 'tokens' | 'key'): 'ascending' | 'descending' | 'none' => {
    if (props.sortKey !== key) return 'none'
    return props.sortDir === 1 ? 'ascending' : 'descending'
  }

  const moveFocus = (event: React.KeyboardEvent, delta: number): void => {
    const target = event.target as HTMLElement | null
    if (target === null || typeof target.closest !== 'function') return
    const row = target.closest('tr')
    if (row === null || row.parentElement === null) return
    const rows = Array.from(row.parentElement.querySelectorAll('tr[data-group-key]'))
    const index = rows.indexOf(row)
    if (index < 0) return
    const next = rows[index + delta]
    if (next === undefined) return
    event.preventDefault()
    ;(next as HTMLElement).focus()
  }

  const focusableIndex = props.selectedKey === null ? 0 : Math.max(0, visible.findIndex((group) => group.key === props.selectedKey))

  return h(
    'div',
    { className: 'tl-reasoning-listwrap' },
    h(
      'table',
      {
        className: 'tl-reasoning-table',
        'aria-label': props.t('reasoning.list'),
        'data-view': 'list',
        'data-shown': String(visible.length),
        'data-total': String(total),
      },
      h(
        'thead',
        null,
        h(
          'tr',
          null,
          h('th', { 'aria-sort': ariaSort('key'), scope: 'col' }, sortHeader(props.t, 'reasoning.group', 'key', props.sortKey, props.sortDir, props.onSort, false)),
          h('th', { scope: 'col' }, props.t('reasoning.lang')),
          h('th', { className: 'tl-num', scope: 'col' }, props.t('reasoning.form')),
          h('th', { className: 'tl-num', 'aria-sort': ariaSort('chars'), scope: 'col' }, sortHeader(props.t, 'reasoning.chars', 'chars', props.sortKey, props.sortDir, props.onSort, true)),
          h('th', { className: 'tl-num', 'aria-sort': ariaSort('tokens'), scope: 'col' }, sortHeader(props.t, 'reasoning.tokens', 'tokens', props.sortKey, props.sortDir, props.onSort, true)),
          /*
           * 两列占比（1.5.5 语义拆分）：
           * - 「占输出」= tokens / outputTokens（表头文案用 reasoning.tokenRatio，zh 值已改「占输出」）；
           * - 「占上下文」= tokens / totalTokens（新增，如实展示旧口径，不与前者混为一谈）。
           */
          h(
            'th',
            { className: 'tl-num', scope: 'col', title: props.t('reasoning.tokenRatio') + ' = reasoningTokens / outputTokens' },
            props.t('reasoning.tokenRatio'),
          ),
          h(
            'th',
            { className: 'tl-num', scope: 'col', title: props.t('reasoning.contextRatio') + ' = reasoningTokens / totalTokens' },
            props.t('reasoning.contextRatio'),
          ),
        ),
      ),
      h(
        'tbody',
        {
          onKeyDown: (event: React.KeyboardEvent) => {
            if (event.key === 'ArrowDown') moveFocus(event, 1)
            else if (event.key === 'ArrowUp') moveFocus(event, -1)
            else if (event.key === 'Escape') {
              if (props.onClear === undefined) return
              event.preventDefault()
              props.onClear()
            }
          },
        },
        ...visible.map((group, index) => {
          const selected = props.selectedKey !== null && props.selectedKey === group.key
          /*
           * 组级两个占比（1.5.5）：
           * - outputRatio = tokens / outputTokens（「占输出」）；
           * - contextRatio = tokens / totalTokens（「占上下文」）。
           * 分母为 0 时一律 null → 显示未知，**不显示 0%**。
           */
          const outputRatio = group.outputTokens > 0 ? group.tokens / group.outputTokens : null
          const contextRatio = group.totalTokens > 0 ? group.tokens / group.totalTokens : null
          /*
           * 组的 tokens 现在是**按字符比例分配**的估算值（model.ts / shared 的口径）：
           * 只要该组有任何一个样本带上了 outputTokens 就有数；一个都没有时才说未知。
           * 有数时在 title 里标注「估算」—— 不能让用户把它当成逐句精确值。
           */
          const hasTokens = group.outputTokens > 0
          const tokenTitle = hasTokens
            ? formatCount(group.tokens) + ' · ' + props.t('reasoning.estimated')
            : props.t('state.unknown')
          const percent = (value: number | null): string =>
            value === null ? props.t('state.unknown') : String(Math.round(value * 1000) / 10) + '%'
          return h(
            'tr',
            {
              key: group.key,
              'data-group-key': group.key,
              'data-selected': selected ? 'true' : 'false',
              /* 漫游 tabindex：整张表只有一个 tab 停靠点（60 行不该是 60 个 tab 停靠点）。 */
              tabIndex: index === focusableIndex ? 0 : -1,
              'aria-selected': selected ? 'true' : 'false',
              onClick: () => props.onSelect(group.key),
              onKeyDown: (event: React.KeyboardEvent) => {
                if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
                  event.preventDefault()
                  props.onSelect(group.key)
                }
              },
            },
            h('td', { className: 'tl-cell-main', title: group.key }, group.key === '' ? props.t('reasoning.noPrefix') : group.key),
            h('td', { className: 'tl-muted' }, props.t(langLabelKey(group.lang) as never)),
            h('td', { className: 'tl-num tl-muted' }, formatCount(group.sentences)),
            h('td', { className: 'tl-num' }, formatCount(group.chars)),
            h(
              'td',
              { className: 'tl-num', title: tokenTitle },
              hasTokens ? formatCount(group.tokens) : props.t('state.unknown'),
            ),
            h('td', { className: 'tl-num' }, percent(outputRatio)),
            h('td', { className: 'tl-num' }, percent(contextRatio)),
          )
        }),
      ),
    ),
    h(
      'div',
      { className: 'tl-list-foot' },
      h(
        'span',
        { className: 'tl-list-count', role: 'status', 'data-testid': 'reasoning-list-count' },
        props.t('reasoning.showing', { shown: String(visible.length), total: String(total) }),
      ),
      visible.length < total
        ? h(
            'button',
            {
              type: 'button',
              className: 'tl-more-btn',
              onClick: () => setShown((previous) => Math.min(total, previous + LIST_PAGE_SIZE)),
            },
            props.t('reasoning.loadMore'),
          )
        : null,
    ),
  )
}

/* ------------------------------------------------------------------ *
 * 列表：句子下钻（同样增量加载）
 * ------------------------------------------------------------------ */

export interface SentenceListProps {
  sentences: readonly ReasoningSentence[]
  t: Translator
  emptyText: string
  /** 隐私模式：只显示计数与归属，不渲染正文。 */
  privacy: boolean
}

export function SentenceList(props: SentenceListProps): React.ReactElement {
  const [shown, setShown] = React.useState(SENTENCE_PAGE_SIZE)
  React.useEffect(() => {
    setShown(SENTENCE_PAGE_SIZE)
  }, [props.sentences])

  if (props.sentences.length === 0) {
    return h('p', { className: 'tl-sentence-empty' }, props.emptyText)
  }
  const total = props.sentences.length
  const visible = props.sentences.slice(0, shown)
  return h(
    'div',
    { className: 'tl-sentence-block' },
    h(
      'ol',
      { className: 'tl-sentence-list', 'aria-label': props.t('reasoning.sentences') },
      ...visible.map((sentence, index) =>
        h(
          'li',
          { key: String(index), className: 'tl-sentence', 'data-lang': sentence.lang, 'data-form': sentence.form },
          h(
            'div',
            { className: 'tl-sentence-head' },
            h('span', { className: 'tl-sentence-index' }, '#' + String(index + 1)),
            h('span', { className: 'tl-sentence-chars' }, formatCount(sentence.chars) + ' ' + props.t('reasoning.charsUnit')),
            h('span', { className: 'tl-sentence-form' }, props.t(formLabelKey(sentence.form) as never)),
          ),
          props.privacy
            ? h('p', { className: 'tl-sentence-hidden' }, props.t('privacy.hidden'))
            : h('p', { className: 'tl-sentence-text' }, sentence.text),
          h(
            'div',
            { className: 'tl-sentence-meta' },
            h('span', null, sentence.sessionId.slice(0, 8) + (sentence.turn === null ? '' : ' · T' + String(sentence.turn))),
            sentence.model === null ? null : h('span', null, sentence.model),
            sentence.preset === null ? null : h('span', null, sentence.preset),
          ),
        ),
      ),
    ),
    h(
      'div',
      { className: 'tl-list-foot' },
      h(
        'span',
        { className: 'tl-list-count', role: 'status', 'data-testid': 'reasoning-sentence-count' },
        props.t('reasoning.showing', { shown: String(visible.length), total: String(total) }),
      ),
      visible.length < total
        ? h(
            'button',
            {
              type: 'button',
              className: 'tl-more-btn',
              onClick: () => setShown((previous) => Math.min(total, previous + SENTENCE_PAGE_SIZE)),
            },
            props.t('reasoning.loadMore'),
          )
        : null,
    ),
  )
}

/* ------------------------------------------------------------------ *
 * 排行（句首）：单行
 * ------------------------------------------------------------------ */

export interface RankRowProps {
  group: ReasoningGroup
  rank: number
  maxChars: number
  selected: boolean
  t: Translator
  onClick: () => void
}

export function RankRow(props: RankRowProps): React.ReactElement {
  const width = props.maxChars > 0 ? Math.max(4, Math.round((props.group.chars / props.maxChars) * 100)) : 4
  return h(
    'button',
    {
      type: 'button',
      className: 'tl-rank-row',
      'data-group-key': props.group.key,
      'data-selected': props.selected ? 'true' : 'false',
      'aria-pressed': props.selected ? 'true' : 'false',
      onClick: props.onClick,
    },
    h('span', { className: 'tl-rank-index' }, String(props.rank + 1)),
    h('span', { className: 'tl-rank-name', title: props.group.key }, props.group.key === '' ? props.t('reasoning.noPrefix') : props.group.key),
    h('span', { className: 'tl-rank-value' }, formatCount(props.group.chars)),
    h('span', { className: 'tl-rank-track' }, h('span', { className: 'tl-rank-fill', style: { width: width + '%' } })),
  )
}
