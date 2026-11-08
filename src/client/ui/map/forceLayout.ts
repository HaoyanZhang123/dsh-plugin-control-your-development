/*
 * map/forceLayout.ts —— 确定性力导向布局内核（零第三方依赖；03 §4.2.1）。
 *
 * 用户 2026-11-08 二次反馈：左图要「有图的结构、有系的连在一起」，不能是网格。
 * 布局因此改为力导向：斥力（全部两两）+ 引力（**仅有边**的节点对，强度 = 边权重）+ 轻向心力。
 *
 * **确定性四条**（QA 会独立复跑；任何一条破了下游断言必红）：
 * 1. 初始位置由「路径哈希」决定（FNV-1a → 圆盘内的角度+半径），**不用 Math.random**；
 * 2. **固定迭代轮数**（缺省 200），**不用"能量收敛就停"**——收敛判据对浮点误差极敏感；
 * 3. 迭代内遍历顺序固定（下标遍历；调用方保证节点数组已按路径排序、边已按 (from,to) 排序）；
 * 4. 无抖动、无时间依赖、无 DOM 测量；同输入两次 → 逐坐标相同。
 *
 * 版本（coordinates）：
 * - 1. 带软边界约束的力导向模拟（坐标始终留在画布内）；
 * - 2. 归一化**铺满视口**（按含半径的包围盒等比缩放，另一轴不足 minFill 时单独补足）；
 * - 3. **像素空间**的重叠消除（固定轮数，含边界夹取）——保证"无节点重叠"可断言。
 *
 * 纯函数：不 import React / 不碰 DOM，可被 node:test 直接调用。
 */

/** FNV-1a 32 位哈希（字符串 → 稳定的 32 位无符号整数）。 */
export function hash32(text: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash >>> 0
}

/** 32 位整数 → [0, 1) 的单位小数（确定性）。 */
export function unitOf(hash: number): number {
  return hash / 4294967296
}

/** 一个待布局的节点：`radius` 是外接圆半径，`halfWidth/halfHeight` 是卡片矩形半宽高（文件节点两者相同）。 */
export interface ForceNode {
  /** 身份键（小写路径 / 枢纽键）；也是初始位置的哈希来源。 */
  key: string
  /** 外接圆半径（斥力 + 重叠消除用）。 */
  radius: number
  /** 卡片矩形半宽（缺省 = radius）。 */
  halfWidth?: number
  /** 卡片矩形半高（缺省 = radius）。 */
  halfHeight?: number
  /**
   * 簇键（R10b）：同一个簇的节点会被**拉向该簇的虚拟质心**（不是拉向某个真实邻居节点）。
   *
   * 这是「成簇而不是星爆」的关键：`buildStructureEdges` 对每个目录只选**一个锚点**，
   * 其余文件全都连到它 —— 若只靠点对点弹簧，力导向必然收敛成星形。
   * 把「同簇」表达为**对质心的引力**，同簇节点就围绕一个虚拟中心成团，而不是全部挤到锚点上。
   *
   * 缺省 `undefined` = 不参与簇内聚拢（每个节点自成一簇，退化为纯点对点力导向）。
   */
  clusterKey?: string | number | undefined
}

/** 一条引力边（`from`/`to` 是 `nodes` 数组下标）。 */
export interface ForceLink {
  from: number
  to: number
  /** 弹簧强度（正数；越大越靠拢）。 */
  strength: number
}

export interface ForceOptions {
  width: number
  height: number
  /** **固定**迭代轮数（缺省 140，第 2 阶段；只做斥力+引力的收敛轮）。 */
  iterations?: number
  /**
   * **预热轮数**（缺省 60）：先跑纯斥力（不连边）把节点均匀炸开，再进入带引力的收敛阶段。
   *
   * 为什么需要：直接从"哈希圆盘初值"开始跑引力，容易落到"两三个节点粘在一起、其余放射"的
   * 退化解（星爆）。先均匀炸开再收敛，能显著减少这种解。同样是**固定轮数**，不破坏确定性。
   */
  warmupIterations?: number
  /** 理想边长系数（相对 sqrt(area/n)）。 */
  spread?: number
  /** 斥力系数。 */
  repulsion?: number
  /** 弹簧系数。 */
  spring?: number
  /** 向心力（拉向画布中心，防散开）。 */
  gravity?: number
  /** **簇内聚拢**强度（拉向同簇虚拟质心；0 = 关闭）。 */
  clusterGravity?: number
  /** **簇间分离**强度（把不同簇的质心互相推开；0 = 关闭）。 */
  clusterSeparation?: number
  /** 重叠消除的额外间隙（px）。 */
  gap?: number
  /** 归一化：两轴各自至少铺满可用区的比例。 */
  minFill?: number
  /** 归一化后的画布内边距。 */
  margin?: number
}

export interface Bounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export interface ForceResult {
  /** 最终像素坐标（已归一化、已消除重叠、已夹在画布内）。 */
  positions: Array<{ x: number; y: number }>
  /** 归一化之前的原始包围盒（含半径）。 */
  bounds: Bounds
  /** 最终包围盒（含半径）。 */
  finalBounds: Bounds
  /** 内容包围盒占画布的比例（两轴里较大的那个）。 */
  fillRatio: number
  /** 两轴各自的比例。 */
  fillX: number
  fillY: number
}

/**
 * 缺省参数（导出以便测试与证据引用）。
 *
 * R10b 调参（对治「星爆」）：Lead 实测 29 文件 / 41 边时 maxDeg=29、ratio=10.26（烟花形）。
 * 做法见文件头 + `ForceNode.clusterKey`。三条变化：
 * - `repulsion` 1 → 1.9、`spring` 0.32 → 0.2、`spread` 0.6 → 0.8：节点摊开、弹簧变软；
 * - 新增 `clusterGravity`（同簇拉向虚拟质心）与 `clusterSeparation`（簇质心互斥）；
 * - 新增 `warmupIterations`（先纯斥力炸开，再收敛）。
 */
export const FORCE_DEFAULTS = {
  iterations: 140,
  warmupIterations: 60,
  spread: 0.8,
  repulsion: 1.9,
  spring: 0.2,
  gravity: 0.022,
  /** 同簇拉向虚拟质心（簇内聚拢）。 */
  clusterGravity: 0.16,
  /** 簇质心之间互相推开（簇间分离），防止所有簇挤成一坨。 */
  clusterSeparation: 0.5,
  /** 重叠消除的额外间隙（px）。 */
  gap: 8,
  /** 两轴各自至少铺满可用区的比例（0.72 → 归一化后 ≥55% 画布，可断言）。 */
  minFill: 0.72,
  /** 归一化后的画布内边距。 */
  margin: 14,
} as const

/** 重叠消除的固定轮数（确定性：不做收敛判据，跑满就停）。 */
const OVERLAP_PASSES = 140

/**
 * 均匀网格（确定性空间索引）：把画布切成 cellSize 的方格，
 * 每个 cell 内的**下标数组保持"下标升序"**（插桶时按下标顺序 push），
 * 因此邻域遍历顺序与输入一致 → 同输入同结果。
 */
interface Grid {
  cellSize: number
  cols: number
  rows: number
  /** 扁平的桶：桶下标 = row * cols + col，值是节点下标（升序）。 */
  buckets: number[][]
  cellOfX: Float64Array
  cellOfY: Float64Array
}

function buildGrid(
  positions: ReadonlyArray<{ x: number; y: number }>,
  width: number,
  height: number,
  cellSize: number,
): Grid {
  const size = Math.max(8, cellSize)
  const cols = Math.max(1, Math.ceil(width / size))
  const rows = Math.max(1, Math.ceil(height / size))
  const buckets: number[][] = new Array(cols * rows)
  for (let index = 0; index < buckets.length; index += 1) buckets[index] = []
  const cellOfX = new Float64Array(positions.length)
  const cellOfY = new Float64Array(positions.length)
  for (let index = 0; index < positions.length; index += 1) {
    const col = Math.min(cols - 1, Math.max(0, Math.floor(positions[index].x / size)))
    const row = Math.min(rows - 1, Math.max(0, Math.floor(positions[index].y / size)))
    cellOfX[index] = col
    cellOfY[index] = row
    buckets[row * cols + col].push(index)
  }
  return { cellSize: size, cols, rows, buckets, cellOfX, cellOfY }
}

function cellOfIndex(grid: Grid, index: number, axis: 0 | 1): number {
  return axis === 0 ? grid.cellOfX[index] : grid.cellOfY[index]
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/** 圆心/卡片包围盒（含半径）。 */
export function computeBounds(
  positions: ReadonlyArray<{ x: number; y: number }>,
  halfW: ReadonlyArray<number>,
  halfH: ReadonlyArray<number>,
): Bounds {
  if (positions.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (let index = 0; index < positions.length; index += 1) {
    const point = positions[index]
    const w = halfW[index] ?? 0
    const h = halfH[index] ?? 0
    if (point.x - w < minX) minX = point.x - w
    if (point.y - h < minY) minY = point.y - h
    if (point.x + w > maxX) maxX = point.x + w
    if (point.y + h > maxY) maxY = point.y + h
  }
  return { minX, minY, maxX, maxY }
}

/** 一条「两节点中心距不得小于 `minDistance`」的硬约束（R11：枢纽卡片不叠）。 */
export interface MinDistanceConstraint {
  /** 节点下标（指向 `positions`）。 */
  a: number
  /** 节点下标（指向 `positions`）。 */
  b: number
  /** 允许的最小中心距（px）。 */
  minDistance: number
}

/** `enforceMinDistances` 的固定轮数（确定性：不做收敛判据，跑满就停）。 */
const MIN_DISTANCE_PASSES = 48

/**
 * **确定性**的最小中心距约束松弛（R11 新增；纯函数，可被 node:test 直接调用）。
 *
 * 为什么需要：力导向内核的斥力是"软"的（库仑 + 近场线性推力），而枢纽卡片有一个
 * **硬下限** —— 两张卡片的外接圆不得相交，否则字压字读不出来。
 * 规格（03 §4.2.2）：`中心距 ≥ hypot(w1,h1)/2 + hypot(w2,h2)/2 + 10`。
 *
 * 做法：
 * - 约束**按传入顺序**遍历（调用方保证顺序固定），每个约束把重叠量各推一半；
 * - 每轮结束把坐标夹回画布（考虑半宽高），**固定轮数**跑满即停，不看收敛；
 * - 只位移，不改变顺序、不引入随机 → 同输入两次逐坐标相同。
 *
 * 复杂度和传入的约束条数线性（调用方只传"涉及枢纽"的对，不是全量 n²）。
 */
export function enforceMinDistances(
  positions: Array<{ x: number; y: number }>,
  halfW: ReadonlyArray<number>,
  halfH: ReadonlyArray<number>,
  constraints: readonly MinDistanceConstraint[],
  width: number,
  height: number,
  passes = MIN_DISTANCE_PASSES,
): void {
  if (constraints.length === 0 || positions.length === 0) return
  const totalPasses = Math.max(0, Math.trunc(passes))
  for (let pass = 0; pass < totalPasses; pass += 1) {
    let moved = false
    for (const constraint of constraints) {
      const a = positions[constraint.a]
      const b = positions[constraint.b]
      if (a === undefined || b === undefined || constraint.a === constraint.b) continue
      let dx = a.x - b.x
      let dy = a.y - b.y
      let distance = Math.sqrt(dx * dx + dy * dy)
      if (distance >= constraint.minDistance) continue
      if (distance < 1e-9) {
        // 完全重合：用两个下标的固定方向（确定性，不用随机数/不用计时）。
        dx = constraint.a < constraint.b ? 0.012 : -0.012
        dy = 0.012
        distance = Math.sqrt(dx * dx + dy * dy)
      }
      const push = (constraint.minDistance - distance) / 2 + 0.02
      const ux = dx / distance
      const uy = dy / distance
      a.x += ux * push
      a.y += uy * push
      b.x -= ux * push
      b.y -= uy * push
      moved = true
    }
    clampInto(positions, halfW, halfH, width, height)
    if (!moved) break
  }
}

/** 把坐标夹进画布（考虑半径）。 */
function clampInto(
  positions: Array<{ x: number; y: number }>,
  halfW: ReadonlyArray<number>,
  halfH: ReadonlyArray<number>,
  width: number,
  height: number,
): void {
  for (let index = 0; index < positions.length; index += 1) {
    const w = halfW[index] ?? 0
    const h = halfH[index] ?? 0
    const lowX = w + 2
    const highX = width - w - 2
    const lowY = h + 2
    const highY = height - h - 2
    positions[index].x = lowX > highX ? width / 2 : Math.min(highX, Math.max(lowX, positions[index].x))
    positions[index].y = lowY > highY ? height / 2 : Math.min(highY, Math.max(lowY, positions[index].y))
  }
}

/**
 * 力导向主流程（确定性）。
 *
 * @param nodes 按身份键排序后的节点（**顺序即下标**，调用方保证稳定）
 * @param links 引力边（下标指向 nodes；调用方保证按 (from,to) 排序）
 */
export function simulateForce(
  nodes: readonly ForceNode[],
  links: readonly ForceLink[],
  options: ForceOptions,
): ForceResult {
  const count = nodes.length
  const width = Math.max(1, options.width)
  const height = Math.max(1, options.height)
  if (count === 0) {
    return {
      positions: [],
      bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
      finalBounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
      fillRatio: 0,
      fillX: 0,
      fillY: 0,
    }
  }

  const iterations = Math.max(1, Math.trunc(options.iterations ?? FORCE_DEFAULTS.iterations))
  const warmupIterations = Math.max(0, Math.trunc(options.warmupIterations ?? FORCE_DEFAULTS.warmupIterations))
  const spread = options.spread ?? FORCE_DEFAULTS.spread
  const repulsion = options.repulsion ?? FORCE_DEFAULTS.repulsion
  const spring = options.spring ?? FORCE_DEFAULTS.spring
  const gravity = options.gravity ?? FORCE_DEFAULTS.gravity
  const clusterGravity = options.clusterGravity ?? FORCE_DEFAULTS.clusterGravity
  const clusterSeparation = options.clusterSeparation ?? FORCE_DEFAULTS.clusterSeparation
  const gap = options.gap ?? FORCE_DEFAULTS.gap
  const minFill = options.minFill ?? FORCE_DEFAULTS.minFill
  const margin = options.margin ?? FORCE_DEFAULTS.margin

  const halfW = nodes.map((node) => node.halfWidth ?? node.radius)
  const halfH = nodes.map((node) => node.halfHeight ?? node.radius)

  const area = width * height
  // 理想边长 k：节点越多越小（自动适配 40 档与「全部」档）。
  const k = Math.max(6, Math.sqrt(area / Math.max(1, count)) * spread)
  // 单步上限与初始圆盘半径（都按画布收敛，避免"被抛出画布再夹回来"的抖动）。
  const maxStep = Math.max(2, Math.min(width, height) * 0.06)
  const centerX = width / 2
  const centerY = height / 2
  const discRadius = Math.min(width, height) * 0.34

  // 簇成员表（确定性：按节点下标升序 push；簇键排序后确定簇下标）。
  const clusterKeys: Array<string | number> = nodes.map((node, index) => node.clusterKey ?? '__node-' + String(index))
  const clusterIndexByKey = new Map<string | number, number>()
  const clusterMembers: number[][] = []
  for (let index = 0; index < count; index += 1) {
    const key = clusterKeys[index]
    let clusterIndex = clusterIndexByKey.get(key)
    if (clusterIndex === undefined) {
      clusterIndex = clusterMembers.length
      clusterIndexByKey.set(key, clusterIndex)
      clusterMembers.push([])
    }
    clusterMembers[clusterIndex].push(index)
  }
  const clusterCount = clusterMembers.length
  const clusterEnabled = clusterCount > 1 && clusterGravity > 0

  // 1. 初始位置：路径哈希 → 圆盘内的角度 + 半径（确定性，不随机、不落网格）。
  let positions: Array<{ x: number; y: number }> = nodes.map((node) => {
    const angle = unitOf(hash32(node.key + '#a')) * Math.PI * 2
    const radius = Math.sqrt(unitOf(hash32(node.key + '#r'))) * discRadius
    return { x: centerX + Math.cos(angle) * radius, y: centerY + Math.sin(angle) * radius * 0.92 }
  })

  const dispX = new Float64Array(count)
  const dispY = new Float64Array(count)
  const clusterX = new Float64Array(clusterCount)
  const clusterY = new Float64Array(clusterCount)

  const totalIterations = warmupIterations + iterations
  for (let iteration = 0; iteration < totalIterations; iteration += 1) {
    // 前 `warmupIterations` 轮 = **纯斥力炸开**（不施加弹簧/簇力），避免退化解。
    const warmup = iteration < warmupIterations
    const phaseIteration = warmup ? iteration : iteration - warmupIterations
    const phaseTotal = warmup ? warmupIterations : iterations

    dispX.fill(0)
    dispY.fill(0)

    // 2. 斥力：两两相斥（库仑），用**均匀网格**把远场截断 → O(n) 而不是 O(n²)。
    //    网格桶内下标升序 + 只处理 right > left 的配对 → 遍历顺序与输入一致（确定性第 3 条）。
    const cutoff = Math.max(24, k * 1.9)
    const grid = buildGrid(positions, width, height, cutoff)
    for (let left = 0; left < count; left += 1) {
      const a = positions[left]
      const col = cellOfIndex(grid, left, 0)
      const row = cellOfIndex(grid, left, 1)
      for (let dRow = -1; dRow <= 1; dRow += 1) {
        const cellRow = row + dRow
        if (cellRow < 0 || cellRow >= grid.rows) continue
        for (let dCol = -1; dCol <= 1; dCol += 1) {
          const cellCol = col + dCol
          if (cellCol < 0 || cellCol >= grid.cols) continue
          const bucket = grid.buckets[cellRow * grid.cols + cellCol]
          for (let at = 0; at < bucket.length; at += 1) {
            const right = bucket[at]
            if (right <= left) continue
            const b = positions[right]
            let dx = a.x - b.x
            let dy = a.y - b.y
            let distanceSquared = dx * dx + dy * dy
            if (distanceSquared < 1e-4) {
              // 完全重合：用两个键的哈希决定固定方向（确定性），不用随机数。
              const tilt = unitOf(hash32(nodes[left].key + '|' + nodes[right].key)) - 0.5
              dx = tilt === 0 ? 0.013 : tilt * 0.02
              dy = 0.02 - Math.abs(dx)
              distanceSquared = dx * dx + dy * dy
            }
            const distance = Math.sqrt(distanceSquared)
            // 远场截断：网格邻域外的斥力忽略（视觉等价，复杂度降到 O(n)）。
            if (distance > cutoff) continue
            const minDistance = halfW[left] + halfW[right] + gap
            // 库仑 + 近场线性硬推：保证最终"无重叠"。
            let magnitude = ((k * k * repulsion) / Math.max(1, distance)) * (1 - distance / cutoff)
            if (distance < minDistance) magnitude += (minDistance - distance) * 5
            // 同簇互斥减半：让同簇节点靠得更近，簇与簇之间分得更开（成簇的关键之一）。
            if (clusterEnabled && clusterKeys[left] === clusterKeys[right]) magnitude *= 0.45
            const ux = dx / distance
            const uy = dy / distance
            dispX[left] += ux * magnitude
            dispY[left] += uy * magnitude
            dispX[right] -= ux * magnitude
            dispY[right] -= uy * magnitude
          }
        }
      }
    }

    // 3. 引力：**只有边**的节点对互相拉近（弹簧，强度 = 边权重 × link.strength）。
    //    预热阶段不施加引力（先均匀炸开）。
    //
    //    注意：`strength <= 0` 的边**完全跳过**（不能用 Math.max 兜底成小正数）。
    //    单锚点骨架的 27 条结构边若各自留一个 0.05 的"最小弹簧"，加起来仍会把整簇拽向
    //    那个真实节点 —— 这正是星爆的来源（见 folderLayout 的 STRUCTURE_SPRING_SCALE）。
    if (!warmup) {
      for (const link of links) {
        if (link.from === link.to) continue
        if (!(link.strength > 0)) continue
        const a = positions[link.from]
        const b = positions[link.to]
        const dx = b.x - a.x
        const dy = b.y - a.y
        const distance = Math.sqrt(dx * dx + dy * dy)
        if (distance < 1e-4) continue
        const magnitude = ((distance * distance) / k) * spring * link.strength
        const ux = dx / distance
        const uy = dy / distance
        dispX[link.from] += ux * magnitude
        dispY[link.from] += uy * magnitude
        dispX[link.to] -= ux * magnitude
        dispY[link.to] -= uy * magnitude
      }

      // 4. 簇内聚拢：同簇节点拉向**虚拟质心**（不是拉向某个真实锚点节点）。
      //    这条是「成簇而不是星爆」的主因：单锚点骨架不再把整簇拽到同一个真实节点上。
      if (clusterEnabled) {
        clusterX.fill(0)
        clusterY.fill(0)
        for (let index = 0; index < count; index += 1) {
          const clusterIndex = clusterIndexByKey.get(clusterKeys[index]) ?? 0
          clusterX[clusterIndex] += positions[index].x
          clusterY[clusterIndex] += positions[index].y
        }
        for (let clusterIndex = 0; clusterIndex < clusterCount; clusterIndex += 1) {
          const size = Math.max(1, clusterMembers[clusterIndex].length)
          clusterX[clusterIndex] /= size
          clusterY[clusterIndex] /= size
        }
        for (let index = 0; index < count; index += 1) {
          const clusterIndex = clusterIndexByKey.get(clusterKeys[index]) ?? 0
          if (clusterMembers[clusterIndex].length < 2) continue
          dispX[index] += (clusterX[clusterIndex] - positions[index].x) * clusterGravity
          dispY[index] += (clusterY[clusterIndex] - positions[index].y) * clusterGravity
        }

        // 5. 簇间分离：不同簇的质心互相推开（防止所有簇叠成一坨）。
        for (let left = 0; left < clusterCount; left += 1) {
          for (let right = left + 1; right < clusterCount; right += 1) {
            let dx = clusterX[left] - clusterX[right]
            let dy = clusterY[left] - clusterY[right]
            let distance = Math.sqrt(dx * dx + dy * dy)
            if (distance < 1e-6) {
              // 质心重合：用两个簇键的哈希决定固定方向（确定性）。
              const tilt = unitOf(hash32(String(clusterKeys[clusterMembers[left][0]]) + '#' + String(clusterKeys[clusterMembers[right][0]]))) - 0.5
              dx = tilt >= 0 ? 0.02 : -0.02
              dy = 0.02
              distance = Math.sqrt(dx * dx + dy * dy)
            }
            const magnitude = (k * clusterSeparation) / Math.max(1, distance)
            const ux = dx / distance
            const uy = dy / distance
            for (const member of clusterMembers[left]) {
              dispX[member] += ux * magnitude
              dispY[member] += uy * magnitude
            }
            for (const member of clusterMembers[right]) {
              dispX[member] -= ux * magnitude
              dispY[member] -= uy * magnitude
            }
          }
        }
      }
    }

    // 6. 向心力：轻微拉向画布中心（防散开）。
    for (let index = 0; index < count; index += 1) {
      dispX[index] += (centerX - positions[index].x) * gravity
      dispY[index] += (centerY - positions[index].y) * gravity
    }

    // 7. 线性降温（固定轮数 → 温度曲线也固定）。
    const temperature = maxStep * (1 - phaseIteration / phaseTotal) + 0.5
    for (let index = 0; index < count; index += 1) {
      const dx = dispX[index]
      const dy = dispY[index]
      const length = Math.sqrt(dx * dx + dy * dy)
      if (length < 1e-9) continue
      const step = Math.min(length, temperature)
      positions[index].x += (dx / length) * step
      positions[index].y += (dy / length) * step
    }
    // 软边界：每轮都夹回画布内（避免飞出画布后再被夹成一堆）。
    clampInto(positions, halfW, halfH, width, height)
  }

  // 6. 归一化：等比放大铺满，另一轴不足 minFill 时单独补足（各向异性仅用于铺满）。
  const rawBounds = computeBounds(positions, halfW, halfH)
  const availableWidth = Math.max(1, width - margin * 2)
  const availableHeight = Math.max(1, height - margin * 2)
  const rawWidth = Math.max(1e-6, rawBounds.maxX - rawBounds.minX)
  const rawHeight = Math.max(1e-6, rawBounds.maxY - rawBounds.minY)
  const uniformScale = Math.min(availableWidth / rawWidth, availableHeight / rawHeight)
  let scaleX = uniformScale
  let scaleY = uniformScale
  if (rawWidth * uniformScale < availableWidth * minFill) scaleX = (availableWidth * minFill) / rawWidth
  if (rawHeight * uniformScale < availableHeight * minFill) scaleY = (availableHeight * minFill) / rawHeight
  const scaledWidth = rawWidth * scaleX
  const scaledHeight = rawHeight * scaleY
  const offsetX = margin + (availableWidth - scaledWidth) / 2
  const offsetY = margin + (availableHeight - scaledHeight) / 2
  positions = positions.map((point) => ({
    x: offsetX + (point.x - rawBounds.minX) * scaleX,
    y: offsetY + (point.y - rawBounds.minY) * scaleY,
  }))

  // 7. 像素空间的重叠消除（固定轮数 + 每轮夹回画布）。
  //    归一化的等比缩放会改变"距离 / 半径"的比值，因此必须在最终像素空间再分一次。
  for (let pass = 0; pass < OVERLAP_PASSES; pass += 1) {
    let moved = false
    for (let left = 0; left < count; left += 1) {
      for (let right = left + 1; right < count; right += 1) {
        const a = positions[left]
        const b = positions[right]
        let dx = a.x - b.x
        let dy = a.y - b.y
        let distance = Math.sqrt(dx * dx + dy * dy)
        if (distance < 1e-9) {
          // 完全重合：按两键哈希决定固定方向（确定性）。
          const tilt = unitOf(hash32(nodes[left].key + '>' + nodes[right].key)) - 0.5
          dx = tilt >= 0 ? 0.012 : -0.012
          dy = 0.012
          distance = Math.sqrt(dx * dx + dy * dy)
        }
        const minDistance = halfW[left] + halfW[right] + gap * 0.5
        if (distance >= minDistance) continue
        const push = (minDistance - distance) / 2 + 0.02
        const ux = dx / distance
        const uy = dy / distance
        positions[left].x += ux * push
        positions[left].y += uy * push
        positions[right].x -= ux * push
        positions[right].y -= uy * push
        moved = true
      }
    }
    clampInto(positions, halfW, halfH, width, height)
    if (!moved) break
  }

  const finalPositions = positions.map((point) => ({ x: round2(point.x), y: round2(point.y) }))
  const finalBounds = computeBounds(finalPositions, halfW, halfH)
  const fillX = (finalBounds.maxX - finalBounds.minX) / width
  const fillY = (finalBounds.maxY - finalBounds.minY) / height
  return {
    positions: finalPositions,
    bounds: rawBounds,
    finalBounds,
    fillRatio: Math.round(Math.max(fillX, fillY) * 1000) / 1000,
    fillX: Math.round(fillX * 1000) / 1000,
    fillY: Math.round(fillY * 1000) / 1000,
  }
}
