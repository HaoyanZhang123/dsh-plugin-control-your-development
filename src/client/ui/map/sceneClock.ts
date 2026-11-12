/*
 * client/ui/map/sceneClock.ts —— **脉络图的唯一几何时钟**（P2 / 统一图形场景）。
 *
 * ## 这个文件的定位：一个纯插值内核，两个图共用
 *
 * 内核**只认「按 key 的节点坐标快照」**（`NodeFrame`），不绑死任何一种图的几何类型：
 *
 * ```
 * previous : Map<key, NodeFrame> | null
 * next     : Map<key, NodeFrame>
 * progress : 0..1
 * origin   : 新节点起步的画布中心
 *   → Map<key, NodeFrame>            （interpolateNodeFrames）
 * ```
 *
 * 两种图各写一个**薄适配器**把自己摊成 key→坐标，再从结果帧渲染：
 * - `nodeFramesOfFolder(geometry)`：folder 图的节点 + 枢纽（枢纽也是一种"节点"）
 * - `nodeFramesOfGraph(layout)`   ：轮次图的文件节点
 *
 * 这样「同帧」这条不变量只有一处实现，两种图不可能各走各的表。
 *
 * ## 为什么必须这样（四类真机反馈，逐条都有代码依据）
 *
 * 1. 「文件夹↔文件夹的线不进边动画」：旧实现的边插值器（已删除的 `edgeSync.ts`）用
 *    `data-edge-id` / `data-hub-edge-*` 生成边的 key，**不认 `data-hub-pair-*`**
 *    → hub-pair 边永远进不了插值：节点走了，线留在原地。
 * 2. 「边快照读早了」：旧实现在 `syncEdges()` **之后**才 `readEdgeFrames()` 存下一帧起点，
 *    而 `syncEdges` 刚刚把 DOM 钉回旧坐标 → 存下来的是**旧帧**，下一次动画从错误起点出发。
 * 3. 「节点内部不是同一个时钟」：卡片 `rect` 走 CSS transition、文件夹图标的 `path.d`
 *    按最新坐标立即重算、标签又走另一组 CSS 属性 → 同一张卡片的三处几何各走各的表。
 * 4. 「换图 key 强制重建整张 SVG」：SVG 的 key 里带了 `now`（每 30 秒变一次），
 *    数据没变也会周期性重挂载并重播入场动画。
 * 5. 「轮次图：关系线先出现并且固定，然后节点才连上去」（P3）：`FileGraph` 从来没接过
 *    这个时钟 —— 边用**新坐标直接渲染**（立刻定住），节点只有 CSS 入场动画（淡入/位移），
 *    于是线比节点先到位。修法就是把它接进来：边端点从**当前帧 nodeMap** 现算。
 *
 * ## 边端点：必须重新派生，不能读几何里存的值
 *
 * `layoutFolderGeometry()` 产出的 `hubEdges[].x1/y1/x2/y2` 与 `hubPairs[].x1/...`、
 * 以及 `layoutFileGraph()` 的 `nodes[].x/y`，都是**布局那一刻的静态快照**。
 * 一旦逐帧插值，节点已经不在布局坐标上；若边还读这些静态值，就会出现
 * 「节点在中途、线已在终点」—— 正是 1.5.4 与 P3 报的那个 bug。
 *
 * 所以所有边的端点都**只用当前帧的坐标重算**：
 * - 文件↔文件边：`frame.get(from)` → `frame.get(to)`
 * - hub 边：hub 当前坐标 → 文件节点当前坐标
 * - hub-pair 边：hub A 当前坐标 → hub B 当前坐标
 * 这样三类边天然同帧，`edgeEndpointDeviation()` 恒为 0。
 *
 * ## 实测结论（**别丢**，来自已删除的 `edgeSync.ts`）
 *
 * `<line>` 的 `x1/y1/x2/y2` 是 **SVG 表现属性**，Chrome **不对它做 CSS transition**：
 * 探针实测写 `transition: x1 …` 后改属性，70ms 就已经是终点值，
 * 且 `getComputedStyle(line).x1` 返回空串。
 * 把线放进 `<g>` 再动画 `transform` 是能动的（实测有效），但那只能表达平移 ——
 * 端点各自移动时线长会变，非均匀 scale 还会把线拉歪、线宽也会被拉粗。
 *
 * **所以边的移动只能逐帧写属性**，和节点共用同一个 rAF 时钟（本文件 + `useSceneClock.ts`）。
 * 这也正是为什么 CSS 里**不能再**给几何（cx/cy/r/x/y/width/height）声明 transition：
 * 两条时钟叠加时 CSS 会在 rAF 之后"懒一拍"，反而更错位。
 *
 * ## 与入场动画的分工（两者正交，不打架）
 *
 * - **本文件（rAF 时钟）**：管**位置/半径的连续形变**。换目录、切轮次、切档位时，
 *   节点与线从旧坐标滑到新坐标。它逐帧写属性，天然盖过任何 CSS 几何过渡。
 * - **`enterStyleOf` + `--tl-enter-*`（CSS keyframes）**：管**首次出现**那次淡入
 *   （opacity 0→1 + 极小 translateY）。它只在元素**新进入 DOM** 时播一次，
 *   与位置插值互不干扰：一个改透明度/位移，一个改坐标属性。
 */

import type {
  FolderGeometry,
  FolderLayoutHub,
  FolderLayoutHubEdge,
  FolderLayoutHubPair,
  FolderLayoutNode,
} from './folderLayout.ts'
import type { GraphLayout } from './graphLayout.ts'

/** 路径身份键（与 folderLayout / FolderMap 的 `caseKey` 同口径：小写）。 */
function caseKeyOf(path: string): string {
  return path.toLowerCase()
}

/**
 * **任一场景的节点帧**：key（小写 path）→ 当前帧坐标与半径。
 *
 * 这是两个图共用插值内核的唯一数据形态。folder 图的文件夹枢纽也走它
 * （枢纽就是一个半径无意义的"节点"，其 `r` 由卡片半宽代替，仅供插值复用）。
 */
export interface NodeFrame {
  key: string
  x: number
  y: number
  r: number
}

/**
 * 缓动：与 CSS 的 `--tl-ease: ease-out` 对齐的 ease-out 三次曲线。
 *
 * 为什么不用 ease-in-out：布局重排要「立刻起步、稳稳收住」，缓入会让开头一段像卡住。
 * `t=0 → 0`、`t=1 → 1`（端点必须精确，否则终点帧会差一像素）。
 */
export function easeLayout(t: number): number {
  if (!Number.isFinite(t)) return t > 0 ? 1 : 0
  if (t <= 0) return 0
  if (t >= 1) return 1
  const inverse = 1 - t
  return 1 - inverse * inverse * inverse
}

/** 线性插值；`progress` 已由 `easeLayout` 处理过。 */
function lerp(from: number, to: number, progress: number): number {
  if (progress <= 0) return from
  if (progress >= 1) return to
  return from + (to - from) * progress
}

/** 保留两位小数（与 `applyDragOffsets` 的取整口径一致，避免亚像素抖动累积）。 */
function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * **插值内核**：按 key 把节点帧从 `previous` 过渡到 `next`。
 *
 * - `previous === null`：没有旧快照 → 原样返回 `next` 的副本（首帧就位，不做假动画）。
 * - `progress >= 1`：返回 `next` 的副本，**逐字段相等**（不收浮点残差）。
 * - 同 key：坐标与半径做**线性位置插值**（不是淡出再淡入）。
 * - 新节点（`next` 有、`previous` 没有）：从 `origin`（画布中心）滑到目标；
 *   半径直接取目标值 —— 从 0 长出来会让小半径节点在中间帧被误读成"极小"。
 * - 消失的节点：不出现在结果里（DOM 里本来也没有它）。
 *
 * 这是**唯一**的插值实现；folder 与 turn 两种图都必须走它。
 */
export function interpolateNodeFrames(
  previous: ReadonlyMap<string, NodeFrame> | null,
  next: ReadonlyMap<string, NodeFrame>,
  progress: number,
  origin: { x: number; y: number },
): Map<string, NodeFrame> {
  const result = new Map<string, NodeFrame>()
  if (previous === null || progress >= 1) {
    for (const [key, frame] of next) result.set(key, { ...frame })
    return result
  }
  const eased = progress <= 0 ? 0 : progress
  for (const [key, frame] of next) {
    const before = previous.get(key)
    if (before === undefined) {
      result.set(key, {
        key,
        x: round2(lerp(origin.x, frame.x, eased)),
        y: round2(lerp(origin.y, frame.y, eased)),
        r: frame.r,
      })
      continue
    }
    result.set(key, {
      key,
      x: round2(lerp(before.x, frame.x, eased)),
      y: round2(lerp(before.y, frame.y, eased)),
      r: round2(lerp(before.r, frame.r, eased)),
    })
  }
  return result
}

/**
 * 新节点（旧快照里没有它）的**起步位置**：画布中心。
 *
 * 「从上一帧对应位置淡入」在没有旧值时的唯一诚实默认就是画布中心：
 * 它是几何的中性点，不会伪装成"从某个邻居那儿飞过来"。
 */
export function enterOrigin(frame: { width: number; height: number }): { x: number; y: number } {
  return { x: round2(frame.width / 2), y: round2(frame.height / 2) }
}

/* ================================================================== *
 * 适配器：把两种图的几何摊成 key→NodeFrame
 * ================================================================== */

/**
 * folder 图 → 节点帧。
 *
 * 枢纽的 `r` 取 `hypot(width, height) / 2`：它不参与绘制半径，
 * 只是让"枢纽也走同一条插值路径"这件事在数值上自洽（尺寸由几何层另行插值）。
 */
export function nodeFramesOfFolder(geometry: FolderGeometry): Map<string, NodeFrame> {
  const frames = new Map<string, NodeFrame>()
  for (const node of geometry.nodes) {
    frames.set(caseKeyOf(node.path), { key: caseKeyOf(node.path), x: node.x, y: node.y, r: node.r })
  }
  for (const hub of geometry.hubs) {
    frames.set(caseKeyOf(hub.path), {
      key: caseKeyOf(hub.path),
      x: hub.x,
      y: hub.y,
      r: round2(Math.hypot(hub.width, hub.height) / 2),
    })
  }
  return frames
}

/** 轮次图 → 节点帧。 */
export function nodeFramesOfGraph(layout: GraphLayout): Map<string, NodeFrame> {
  const frames = new Map<string, NodeFrame>()
  for (const node of layout.nodes) {
    frames.set(caseKeyOf(node.path), { key: caseKeyOf(node.path), x: node.x, y: node.y, r: node.r })
  }
  return frames
}

/* ================================================================== *
 * folder 图：把内核结果套回几何（含三类边的端点派生）
 * ================================================================== */

/**
 * 把节点帧应用回 folder 几何，并用**当前帧坐标**重算所有边端点。
 *
 * 这是 `FolderMap` 唯一使用的入口；边端点在这里派生，渲染层不再自己算。
 */
export function applyFolderFrame(
  next: FolderGeometry,
  frames: ReadonlyMap<string, NodeFrame>,
  hubSizeOf: (key: string) => { width: number; height: number },
): FolderGeometry {
  const hubs: FolderLayoutHub[] = next.hubs.map((hub) => {
    const frame = frames.get(caseKeyOf(hub.path))
    if (frame === undefined) return hub
    const size = hubSizeOf(caseKeyOf(hub.path))
    return { ...hub, x: frame.x, y: frame.y, width: size.width, height: size.height }
  })
  const nodes: FolderLayoutNode[] = next.nodes.map((node) => {
    const frame = frames.get(caseKeyOf(node.path))
    if (frame === undefined) return node
    return { ...node, x: frame.x, y: frame.y, r: frame.r }
  })

  const nodeByKey = new Map<string, FolderLayoutNode>()
  for (const node of nodes) nodeByKey.set(caseKeyOf(node.path), node)
  const hubByKey = new Map<string, FolderLayoutHub>()
  for (const hub of hubs) hubByKey.set(caseKeyOf(hub.path), hub)

  /* ---- 边端点：**只**从当前帧坐标派生（不读 next.hubEdges[].x1 这类静态快照） ---- */
  const hubEdges: FolderLayoutHubEdge[] = []
  for (const edge of next.hubEdges) {
    const hub = hubByKey.get(caseKeyOf(edge.hubPath))
    const node = nodeByKey.get(caseKeyOf(edge.filePath))
    if (hub === undefined || node === undefined) continue
    hubEdges.push({ ...edge, x1: round2(hub.x), y1: round2(hub.y), x2: round2(node.x), y2: round2(node.y) })
  }

  const hubPairs: FolderLayoutHubPair[] = []
  for (const pair of next.hubPairs) {
    const a = hubByKey.get(caseKeyOf(pair.aPath))
    const b = hubByKey.get(caseKeyOf(pair.bPath))
    if (a === undefined || b === undefined) continue
    hubPairs.push({ ...pair, x1: round2(a.x), y1: round2(a.y), x2: round2(b.x), y2: round2(b.y) })
  }

  return { ...next, nodes, hubs, hubEdges, hubPairs }
}

/**
 * **向后兼容的薄封装**：直接从两份几何插值（保留原来的签名与语义）。
 *
 * 内部走的仍是 `interpolateNodeFrames` + `applyFolderFrame`，
 * 所以"只有一处插值实现"这条纪律不会被这个封装破坏。
 */
export function interpolateGeometry(
  previous: FolderGeometry | null,
  next: FolderGeometry,
  progress: number,
): FolderGeometry {
  if (previous === null) return next
  if (progress >= 1) return next
  const frames = interpolateNodeFrames(
    previous === null ? null : nodeFramesOfFolder(previous),
    nodeFramesOfFolder(next),
    progress,
    enterOrigin(next),
  )
  const hubSize = (key: string): { width: number; height: number } => {
    const before = previous.hubs.find((hub) => caseKeyOf(hub.path) === key)
    const after = next.hubs.find((hub) => caseKeyOf(hub.path) === key)
    if (after === undefined) return { width: 0, height: 0 }
    if (before === undefined) return { width: after.width, height: after.height }
    /* 卡片尺寸一并插值：rect 的 x/y/width/height 必须与图标的 path.d 同一个时钟。 */
    return {
      width: round2(lerp(before.width, after.width, progress)),
      height: round2(lerp(before.height, after.height, progress)),
    }
  }
  return applyFolderFrame(next, frames, hubSize)
}

/* ================================================================== *
 * 断言工具
 * ================================================================== */

/** 一条边在当前帧的实际端点（与渲染层写进 `<line>` 的属性同一份数值）。 */
export interface EdgeEndpointSample {
  key: string
  kind: 'file' | 'hub' | 'hubPair'
  x1: number
  y1: number
  x2: number
  y2: number
}

/** 渲染层要画的文件边（两端 path + 稳定 key）；端点由当前帧坐标决定。 */
export interface FileEdgeRef {
  key: string
  from: string
  to: string
}

/**
 * 把一帧里所有边的端点摊平，用于断言「每条边的端点都等于其两端节点当前坐标」。
 *
 * `fileEdges` 是文件↔文件边（两端 path 由渲染层从分层结果解出）：
 * 它们的**存在性**由 density/focus 决定、不在几何里，但端点同样读当前帧坐标。
 */
export function collectEdgeEndpoints(
  frame: FolderGeometry,
  fileEdges: readonly FileEdgeRef[] = [],
): EdgeEndpointSample[] {
  const nodeByKey = new Map<string, FolderLayoutNode>()
  for (const node of frame.nodes) nodeByKey.set(caseKeyOf(node.path), node)
  const hubByKey = new Map<string, FolderLayoutHub>()
  for (const hub of frame.hubs) hubByKey.set(caseKeyOf(hub.path), hub)

  const samples: EdgeEndpointSample[] = []
  for (const edge of fileEdges) {
    const from = nodeByKey.get(caseKeyOf(edge.from))
    const to = nodeByKey.get(caseKeyOf(edge.to))
    if (from === undefined || to === undefined) continue
    samples.push({ key: edge.key, kind: 'file', x1: from.x, y1: from.y, x2: to.x, y2: to.y })
  }
  for (const edge of frame.hubEdges) {
    samples.push({ key: 'hub:' + edge.hubPath + '>' + edge.filePath, kind: 'hub', x1: edge.x1, y1: edge.y1, x2: edge.x2, y2: edge.y2 })
  }
  for (const pair of frame.hubPairs) {
    samples.push({ key: 'pair:' + pair.key, kind: 'hubPair', x1: pair.x1, y1: pair.y1, x2: pair.x2, y2: pair.y2 })
  }
  return samples
}

/**
 * **同步性断言工具**：每条边的每个端点，与它自称的两端节点当前坐标的**最大偏差**。
 *
 * 期望恒为 `0` —— 端点是同一份坐标派生的，不是各自插值出来的。
 * 只要有人把"几何里存着的静态端点"写回 DOM / 帧里，这里立刻变成非 0。
 */
export function edgeEndpointDeviation(
  frame: FolderGeometry,
  fileEdges: readonly FileEdgeRef[] = [],
): number {
  const nodeByKey = new Map<string, FolderLayoutNode>()
  for (const node of frame.nodes) nodeByKey.set(caseKeyOf(node.path), node)
  const hubByKey = new Map<string, FolderLayoutHub>()
  for (const hub of frame.hubs) hubByKey.set(caseKeyOf(hub.path), hub)

  let worst = 0
  const consider = (actual: number, expected: number): void => {
    const delta = Math.abs(actual - expected)
    if (delta > worst) worst = delta
  }

  for (const edge of frame.hubEdges) {
    const hub = hubByKey.get(caseKeyOf(edge.hubPath))
    const node = nodeByKey.get(caseKeyOf(edge.filePath))
    if (hub === undefined || node === undefined) continue
    consider(edge.x1, hub.x)
    consider(edge.y1, hub.y)
    consider(edge.x2, node.x)
    consider(edge.y2, node.y)
  }
  for (const pair of frame.hubPairs) {
    const a = hubByKey.get(caseKeyOf(pair.aPath))
    const b = hubByKey.get(caseKeyOf(pair.bPath))
    if (a === undefined || b === undefined) continue
    consider(pair.x1, a.x)
    consider(pair.y1, a.y)
    consider(pair.x2, b.x)
    consider(pair.y2, b.y)
  }
  /* 文件边在几何里不存端点（端点由渲染层从当前帧节点取），
   * 因此这里检查的是「渲染层取到的两端」与「帧里的节点」是否是同一份坐标。 */
  for (const sample of collectEdgeEndpoints(frame, fileEdges)) {
    if (sample.kind !== 'file') continue
    const ref = fileEdges.find((edge) => edge.key === sample.key)
    if (ref === undefined) continue
    const from = nodeByKey.get(caseKeyOf(ref.from))
    const to = nodeByKey.get(caseKeyOf(ref.to))
    if (from === undefined || to === undefined) continue
    consider(sample.x1, from.x)
    consider(sample.y1, from.y)
    consider(sample.x2, to.x)
    consider(sample.y2, to.y)
  }
  return worst
}

/** 一条已解析端点的边（渲染层真正写进 `<line>` 的那组数值）。 */
export interface RenderedEdge {
  key: string
  from: string
  to: string
  x1: number
  y1: number
  x2: number
  y2: number
}

/**
 * **轮次图**的端点偏差：渲染出来的每条边，与当前帧 nodeMap 的最大偏差。
 *
 * 与 folder 版的区别：轮次图的边不在几何里存端点，端点完全由渲染层从 nodeMap 现算。
 * 所以这里比的是「渲染层实际写出的 x1/y1/x2/y2」与「帧里两端的坐标」。
 * 若渲染层偷偷改回读 `layout.nodes[].x/y`（终点帧的静态值），这里立刻非 0。
 */
export function nodeFrameEndpointDeviation(
  frames: ReadonlyMap<string, NodeFrame>,
  edges: readonly RenderedEdge[],
): number {
  let worst = 0
  const consider = (actual: number, expected: number): void => {
    const delta = Math.abs(actual - expected)
    if (delta > worst) worst = delta
  }
  for (const edge of edges) {
    const from = frames.get(caseKeyOf(edge.from))
    const to = frames.get(caseKeyOf(edge.to))
    if (from === undefined || to === undefined) continue
    consider(edge.x1, from.x)
    consider(edge.y1, from.y)
    consider(edge.x2, to.x)
    consider(edge.y2, to.y)
  }
  return worst
}

/**
 * 判断某个节点在旧快照里是否存在（决定"位置插值"还是"从中心淡入"）。
 *
 * 抽成函数而不是让渲染层各自 `previous.nodes.some(...)`：
 * 口径（小写 key）只能有一处，否则大小写混用时会静默走错分支。
 */
export function hasNode(geometry: FolderGeometry | null, path: string): boolean {
  if (geometry === null) return false
  const key = caseKeyOf(path)
  return geometry.nodes.some((node) => caseKeyOf(node.path) === key)
}
