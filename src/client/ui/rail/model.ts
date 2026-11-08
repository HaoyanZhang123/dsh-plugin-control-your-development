/**
 * rail/model.ts —— 右栏文件浏览器的**纯计算**（R03；07 §3；03 R03）。
 *
 * 只做"数据 → 可渲染行/窗口"的确定性变换，不碰 DOM、不读时间（时间由调用方给）：
 * 1. `buildRailRows`：`TreeEntry[]` + 触碰信息 → 行（类型标签/大小文本/ops/选中/悬浮）；
 * 2. `formatTreeSize`：字节数 → 可读文本（B/KB/MB/GB；确定性，不依赖 locale 数字格式）；
 * 3. `computeRailWindow`：列表模式的窗口计算（>200 行虚拟化；页内单滚动，不开内层滚动）；
 * 4. `railRowDomId`：稳定的行 id（焦点管理/测试用）。
 *
 * 纪律：
 * - **未触碰的条目 ops 必须是 `null`**（不是 0）：UI 据此**不渲染** ops 徽标（用户要求"不显示假 0"）；
 * - `size` 只在数据层给了有限非负值时才显示（不伪造 0 B）；
 * - 类型标签走 locale key 名（`tree.folder` / `inspector.file` / `fileFamily.other`），
 *   文案解析由组件做——这里只给 key，避免纯函数依赖 Translator。
 */
import type { FileFamily } from '../../../shared/events/index.ts'
import type { TreeEntry, TreeKind } from '../../data/index.ts'
import type { MessageKey } from '../../locale/index.ts'

/* ------------------------------------------------------------------ *
 * 1. 视图模式 / 触碰信息 / 行
 * ------------------------------------------------------------------ */

/** 右栏呈现方式（07 §3.4 的"卡片/列表"）。 */
export type RailViewMode = 'cards' | 'list'

/** 一个条目的触碰信息（来自 `data.graph.files`；未触碰的条目**没有**这个对象）。 */
export interface RailTouchInfo {
  /** 触碰次数（>0 才渲染；0 视为未触碰）。 */
  ops: number
  /** 最近触碰时间（可选，徽标 title 用）。 */
  lastAt?: number
}

/** 渲染一行（卡片与列表共用同一份数据，保证两种模式内容一致）。 */
export interface RailRow {
  /** 身份键：小写工作区相对路径（与图/关系层同口径）。 */
  key: string
  /** 工作区相对路径（展示保留原大小写）。 */
  path: string
  /** basename。 */
  name: string
  kind: TreeKind
  family: FileFamily
  /** 字节数；`null` = 未知/不适用（不显示，不伪造 0）。 */
  size: number | null
  /** 大小文本；`null` = 不显示。 */
  sizeText: string | null
  /** 类型标签的 locale key（组件翻译）。 */
  typeKey: MessageKey
  /** 触碰次数；`null` = 未触碰（**不渲染** ops 徽标）。 */
  ops: number | null
  /** 是否本轮触碰过（本轮徽标，可选）。 */
  currentTurn: boolean
  selected: boolean
  hovered: boolean
}

/** 类型 → locale key（`directory` 用 tree.folder，`file` 复用 inspector.file，`other` 复用 fileFamily.other）。 */
export function treeKindKey(kind: TreeKind): MessageKey {
  if (kind === 'directory') return 'tree.folder'
  if (kind === 'file') return 'inspector.file'
  return 'fileFamily.other'
}

/**
 * 字节数 → 可读文本（确定性；1 位小数，去掉多余的 `.0`）。
 * 未知/负数/非有限 → `null`（调用方不渲染，不显示 "0 B" 冒充）。
 */
export function formatTreeSize(size: number | null | undefined): string | null {
  if (typeof size !== 'number' || !Number.isFinite(size) || size < 0) return null
  const value = Math.trunc(size)
  if (value < 1024) return `${value} B`
  const units: ReadonlyArray<[string, number]> = [
    ['GB', 1024 * 1024 * 1024],
    ['MB', 1024 * 1024],
    ['KB', 1024],
  ]
  for (const [unit, base] of units) {
    if (value >= base) {
      const scaled = value / base
      const rounded = scaled >= 100 ? Math.round(scaled) : Math.round(scaled * 10) / 10
      return `${rounded} ${unit}`
    }
  }
  return `${value} B`
}

/** `buildRailRows` 的选项。 */
export interface BuildRailRowsOptions {
  /** 触碰信息（key = 小写路径）。未在 map 里的条目 = 未触碰。 */
  touched?: ReadonlyMap<string, RailTouchInfo> | null
  /** 本轮触碰的路径（大小写不敏感；可选）。 */
  currentTurnPaths?: readonly string[] | null
  /** 当前选中文件路径（大小写不敏感）。 */
  selectedPath?: string | null
  /** 当前 hover 的文件路径（大小写不敏感）。 */
  hoveredPath?: string | null
}

function lowerSet(paths: readonly string[] | null | undefined): Set<string> | null {
  if (paths === null || paths === undefined) return null
  return new Set(paths.map((path) => path.toLowerCase()))
}

function lowerOrNull(path: string | null | undefined): string | null {
  return typeof path === 'string' && path !== '' ? path.toLowerCase() : null
}

/**
 * `TreeEntry[]` → 行（顺序 = 数据层给的确定性顺序：目录 → 文件 → other）。
 *
 * 触碰叠加规则：
 * - 只有 `touched.get(lower(path))` 且 `ops > 0` 才给 `ops`；否则 `null`（未触碰 → 徽标不渲染）；
 * - `currentTurn` 只在给了 `currentTurnPaths` 时才可能为 true。
 */
export function buildRailRows(
  entries: readonly TreeEntry[],
  options: BuildRailRowsOptions = {},
): RailRow[] {
  const touched = options.touched ?? null
  const currentTurn = lowerSet(options.currentTurnPaths)
  const selected = lowerOrNull(options.selectedPath)
  const hovered = lowerOrNull(options.hoveredPath)
  return entries.map((entry) => {
    const key = entry.path.toLowerCase()
    const touch = touched === null ? undefined : touched.get(key)
    const ops = touch !== undefined && Number.isFinite(touch.ops) && touch.ops > 0 ? Math.trunc(touch.ops) : null
    const size = entry.kind === 'file' && typeof entry.size === 'number' ? entry.size : null
    return {
      key,
      path: entry.path,
      name: entry.name,
      kind: entry.kind,
      family: entry.family,
      size,
      sizeText: formatTreeSize(size),
      typeKey: treeKindKey(entry.kind),
      ops,
      currentTurn: currentTurn !== null && currentTurn.has(key),
      selected: selected !== null && selected === key,
      hovered: hovered !== null && hovered === key,
    }
  })
}

/* ------------------------------------------------------------------ *
 * 2. 列表虚拟化窗口
 * ------------------------------------------------------------------ */

/** 每行固定高度（px；与 tree.css 的 `--tl-tree-row-h` 一致，测试守着）。 */
export const RAIL_LIST_ROW_HEIGHT = 30
/** 超过多少行开始虚拟化（07 §3.4：>200 行虚拟化）。 */
export const RAIL_VIRTUAL_THRESHOLD = 200
/** 视口外多渲几行（滚动时不闪白）。 */
export const RAIL_VIRTUAL_OVERSCAN = 6
/** 默认"可见区域高度"（没有测量环境时的估算：约 20 行）。 */
export const RAIL_VIEWPORT_ESTIMATE = RAIL_LIST_ROW_HEIGHT * 20

export interface RailWindowInput {
  /** 总行数。 */
  count: number
  /** 容器顶边相对滚动视口的位置（px；首屏为 0）。 */
  offsetPx?: number
  /** 已滚动距离（px）。 */
  scrollPx?: number
  /** 可见区域高度（px）。 */
  viewportHeight?: number
  rowHeight?: number
  overscan?: number
  /** 低于该行数不虚拟化（整段渲染）。 */
  threshold?: number
}

export interface RailWindow {
  /** 渲染区间 [start, end)。 */
  start: number
  end: number
  /** 顶部占位高度（px）。 */
  topPad: number
  /** 底部占位高度（px）。 */
  bottomPad: number
  /** 是否启用虚拟化（false = 全量渲染）。 */
  virtual: boolean
  /** 总高度（px）。 */
  totalHeight: number
}

/**
 * 列表窗口：按固定行高算出应渲染的行区间 + 上下占位。
 *
 * **页内单滚动**（不开内层滚动）：窗口由"页面滚动距离 - 容器顶边"推出来；
 * 没有测量环境（SSR/测试）时按 `RAIL_VIEWPORT_ESTIMATE` 估一个首屏窗口。
 * 返回值永远满足 `0 <= start <= end <= count` 且 `topPad/bottomPad` 非负。
 */
export function computeRailWindow(input: RailWindowInput): RailWindow {
  const rowHeight = input.rowHeight !== undefined && input.rowHeight > 0 ? input.rowHeight : RAIL_LIST_ROW_HEIGHT
  const overscan = input.overscan !== undefined && input.overscan >= 0 ? Math.trunc(input.overscan) : RAIL_VIRTUAL_OVERSCAN
  const threshold = input.threshold !== undefined ? input.threshold : RAIL_VIRTUAL_THRESHOLD
  const count = Math.max(0, Math.trunc(input.count))
  const totalHeight = count * rowHeight
  if (count === 0) return { start: 0, end: 0, topPad: 0, bottomPad: 0, virtual: false, totalHeight: 0 }
  if (count <= threshold) {
    return { start: 0, end: count, topPad: 0, bottomPad: 0, virtual: false, totalHeight }
  }
  const viewportHeight =
    input.viewportHeight !== undefined && input.viewportHeight > 0 ? input.viewportHeight : RAIL_VIEWPORT_ESTIMATE
  const visibleRows = Math.max(1, Math.ceil(viewportHeight / rowHeight))
  const scrolledPx = Math.max(0, (input.scrollPx ?? 0) - Math.max(0, input.offsetPx ?? 0))
  const firstVisible = Math.min(count - 1, Math.floor(scrolledPx / rowHeight))
  const start = Math.max(0, firstVisible - overscan)
  const end = Math.min(count, firstVisible + visibleRows + overscan)
  return {
    start,
    end,
    topPad: start * rowHeight,
    bottomPad: (count - end) * rowHeight,
    virtual: true,
    totalHeight,
  }
}

/* ------------------------------------------------------------------ *
 * 3. 列表虚拟化的滚动源（**不是** window：右栏是独立滚动容器）
 * ------------------------------------------------------------------ */

/** 计算样式里判断"这个盒子自己滚"的最小形状。 */
export interface ScrollStyleLike {
  overflowY?: string
  overflowX?: string
}

/** 一个可注入的滚动环境（真实 DOM 与单测假实现共用同一套算法）。 */
export interface ScrollEnvLike<Node> {
  parentOf(node: Node): Node | null
  /** 该节点自身的计算样式；取不到返回 undefined。 */
  styleOf(node: Node): ScrollStyleLike | undefined
  /** 该节点是否"内容真的超出"（scrollHeight > clientHeight）；未知则可滚。 */
  overflows?(node: Node): boolean | undefined
}

/** `overflow-y` 值是否让盒子成为滚动容器（auto/scroll/overlay；visible/hidden 不算）。 */
export function isScrollableOverflow(value: string | undefined): boolean {
  if (value === undefined) return false
  const normalized = value.trim().toLowerCase()
  return normalized === 'auto' || normalized === 'scroll' || normalized === 'overlay'
}

/**
 * 从 `start` 往上找**最近的滚动祖先**（含 start 自身？不含——start 是内容容器）。
 *
 * 为什么需要它（R03 真 bug，Lead 2026-11-07 指出）：
 * 右栏 `ThreadlineShell` 里是 `<aside class="threadline-rail">`，base.css 给它
 * `overflow-y: auto`（左右两栏各自滚动，页面本身不滚）。虚拟化窗口若按
 * `window.scrollY` 算，右栏滚到第 300 行时窗口仍停在首屏 → 列表"卡死"。
 * 所以必须绑定到**最近的 scrollable 祖先**。
 */
export function findScrollableAncestor<Node>(
  start: Node | null,
  env: ScrollEnvLike<Node>,
): Node | null {
  let current = start === null ? null : env.parentOf(start)
  let guard = 0
  while (current !== null && guard < 64) {
    guard += 1
    const style = env.styleOf(current)
    if (style !== undefined && isScrollableOverflow(style.overflowY)) {
      // 有 `overflows` 实现时再确认内容真的超出（避免窄栏下误判成滚动源）。
      const overflows = env.overflows?.(current)
      if (overflows === undefined || overflows) return current
    }
    current = env.parentOf(current)
  }
  return null
}

/** 滚动几何（纯数据；由组件从 DOM 读出来喂给 `computeRailWindow`）。 */
export interface RailScrollMetrics {
  /** 滚动容器的 scrollTop。 */
  scrollPx: number
  /** 列表容器顶边相对"滚动容器内容原点"的偏移（px，≥0）。 */
  offsetPx: number
  /** 滚动容器可见高度（px）。 */
  viewportHeight: number
}

/**
 * 由三个矩形/标量算出虚拟化输入。
 *
 * `bodyTop` = 列表容器（`.tl-tree-body`）顶边在**视口坐标**里的位置；
 * `scrollerTop` = 滚动容器顶边在视口坐标里的位置。
 * 内容原点 = `scrollerTop - scrollTop`，所以偏移 = `bodyTop - (scrollerTop - scrollTop)`。
 * 负数一律夹到 0（列表就在容器顶部时）。
 */
export function railScrollMetrics(input: {
  scrollTop: number
  scrollerTop: number
  scrollerHeight: number
  bodyTop: number
}): RailScrollMetrics {
  const scrollPx = Number.isFinite(input.scrollTop) ? Math.max(0, input.scrollTop) : 0
  const viewportHeight = Number.isFinite(input.scrollerHeight) ? Math.max(0, input.scrollerHeight) : 0
  const raw = input.bodyTop - (input.scrollerTop - scrollPx)
  const offsetPx = Number.isFinite(raw) ? Math.max(0, raw) : 0
  return { scrollPx, offsetPx, viewportHeight }
}

/* ------------------------------------------------------------------ *
 * 4. 行 id（焦点管理 / 测试）
 * ------------------------------------------------------------------ */

/** 行的 DOM id（路径净化成选择器安全字符串，同一页面唯一）。 */
export function railRowDomId(prefix: string, path: string): string {
  const safe = path === '' ? 'root' : path.replace(/[^a-zA-Z0-9_-]/g, '-')
  return 'threadline-rail-' + prefix + '-' + safe
}

/* ------------------------------------------------------------------ *
 * 5. 键盘（复用 a11y 的唯一状态机，不另写一份）
 * ------------------------------------------------------------------ */

/** 右栏键盘动作（组件用 `listKeyNav` 的结果驱动）。 */
export interface RailKeyAction {
  /** 下一个焦点索引（-1 = 无行）。 */
  nextIndex: number
  /** 是否消费该按键（true → preventDefault）。 */
  handled: boolean
  /** Enter/Space：激活当前行（目录进入 / 文件选中）。 */
  activate: boolean
  /** Escape：清选择并退出。 */
  escape: boolean
}

/**
 * 右栏 ↑/↓/Home/End/PageUp/PageDown/Enter/Escape 的语义包装。
 * 真正的行列状态机在 `a11y/listModel.ts` 的 `listKeyNav`（唯一实现），这里只把单列结果投影成行索引。
 */
export function railKeyAction(
  listKeyNav: (input: {
    row: number
    col: number
    rowCount: number
    colCount: number
    key: string
    pageSize?: number
  }) => { row: number; handled: boolean; activate: boolean; escape: boolean },
  input: { index: number; count: number; key: string; pageSize?: number },
): RailKeyAction {
  const result = listKeyNav({
    row: input.index,
    col: 0,
    rowCount: input.count,
    colCount: 1,
    key: input.key,
    ...(input.pageSize === undefined ? {} : { pageSize: input.pageSize }),
  })
  return {
    nextIndex: input.count === 0 ? -1 : result.row,
    handled: result.handled,
    activate: result.activate,
    escape: result.escape,
  }
}
