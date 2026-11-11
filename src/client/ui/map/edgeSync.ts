/*
 * client/ui/map/edgeSync.ts —— 让关系线跟着节点一起做布局过渡（1.5.4）。
 *
 * 为什么不能只靠 CSS（实测结论，不是猜测）：
 * - `<line>` 的 `x1/y1/x2/y2` 是**表现属性**，Chrome 的 `getComputedStyle(line).x1` 返回空串，
 *   写了 `transition: x1 …` 也不会动画（实测：改属性后 70ms 就已经是终点值）；
 * - 把线放进 `<g>` 并动画 `transform` 是能动的（实测有效），但**线长变化表达不了**
 *   （scale 会同时把线宽拉粗，非均匀 scale 还会把线拉歪），所以只适合纯平移。
 *
 * 所以线的动画只能**逐帧写属性**：这里用 requestAnimationFrame 在
 * `--tl-dur-layout` 同一时长、同一缓动下插值端点，让线和节点"同一口气"移动。
 *
 * 约束：
 * - 只读 DOM、不写存储；不引入依赖；
 * - 尊重 reduced-motion（时长令牌为 0 或用户偏好 reduce 时直接跳到终点）；
 * - 拖动中不插值（拖动是逐帧跟随，再插值会黏滞）。
 */

/** 一条边的端点快照（key 与 DOM 上的 `data-edge-id` / `data-hub-edge-*` 对应）。 */
export interface EdgeFrame {
  key: string
  x1: number
  y1: number
  x2: number
  y2: number
}

/** 从当前 SVG 里读出所有线的端点。 */
export function readEdgeFrames(root: ParentNode): Map<string, EdgeFrame> {
  const frames = new Map<string, EdgeFrame>()
  const lines = root.querySelectorAll<SVGLineElement>('line.tl-graph-edge')
  for (const line of lines) {
    const key = edgeKeyOf(line)
    if (key === null) continue
    frames.set(key, {
      key,
      x1: Number(line.getAttribute('x1') ?? '0'),
      y1: Number(line.getAttribute('y1') ?? '0'),
      x2: Number(line.getAttribute('x2') ?? '0'),
      y2: Number(line.getAttribute('y2') ?? '0'),
    })
  }
  return frames
}

/** 线的稳定 key：优先 data-edge-id，其次枢纽边的人造 key（没有 key 的线不参与插值）。 */
function edgeKeyOf(line: SVGLineElement): string | null {
  const direct = line.getAttribute('data-edge-id')
  if (direct !== null && direct !== '') return direct
  /* 枢纽边的两个属性拼成 key —— 与 readEdgeFrames 的读取口径必须一致。 */
  const hub = line.getAttribute('data-hub-edge-hub')
  const file = line.getAttribute('data-hub-edge-file')
  if (hub !== null && file !== null) return 'hub:' + hub + '\u0000' + file
  return null
}

/** 缓动：与 CSS 的 `--tl-ease: ease-out` 对齐（cubic-bezier(0, 0, 0.58, 1) 的近似）。 */
function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t) * (1 - t) * 0.6 - (1 - t) * (1 - t) * 0.4
}

export interface EdgeSyncOptions {
  /** 动画时长（ms）。取 `--tl-dur-layout` 的数值；<= 0 表示直接跳。 */
  durationMs: number
  /** 是否禁用（拖动中 / reduced-motion）。 */
  disabled?: boolean
  /** 完成回调（测试用；生产不需要）。 */
  onDone?: () => void
}

/**
 * 让线从 `previous` 平滑过渡到当前 DOM 里的端点。
 *
 * 调用时机：布局重算并提交 DOM 之后（`useLayoutEffect`）。此时 DOM 里的
 * `x1/y1/x2/y2` 已经是**新坐标**，而用户眼睛看到的是上一帧的旧位置 ——
 * 我们把它先拉回旧值，再用 rAF 推到新值。
 */
export function syncEdges(
  root: ParentNode,
  previous: ReadonlyMap<string, EdgeFrame>,
  options: EdgeSyncOptions,
  schedule: (callback: (time: number) => void) => number = requestAnimationFrame,
  cancel: (handle: number) => void = cancelAnimationFrame,
): () => void {
  if (options.disabled === true || options.durationMs <= 0 || previous.size === 0) {
    options.onDone?.()
    return () => undefined
  }
  const lines = new Map<string, SVGLineElement>()
  for (const line of root.querySelectorAll<SVGLineElement>('line.tl-graph-edge')) {
    const key = edgeKeyOf(line)
    if (key !== null) lines.set(key, line)
  }

  /** 每条线的起点（旧）与终点（新）。 */
  const targets: Array<{ element: SVGLineElement; from: EdgeFrame; to: EdgeFrame }> = []
  for (const [key, element] of lines) {
    const before = previous.get(key)
    if (before === undefined) continue
    const to: EdgeFrame = {
      key,
      x1: Number(element.getAttribute('x1') ?? '0'),
      y1: Number(element.getAttribute('y1') ?? '0'),
      x2: Number(element.getAttribute('x2') ?? '0'),
      y2: Number(element.getAttribute('y2') ?? '0'),
    }
    /* 端点完全没变就别浪费一帧（大多数边在选中时不动）。 */
    if (before.x1 === to.x1 && before.y1 === to.y1 && before.x2 === to.x2 && before.y2 === to.y2) continue
    targets.push({ element, from: before, to })
  }
  if (targets.length === 0) {
    options.onDone?.()
    return () => undefined
  }

  /* 先钉回旧坐标，避免"先闪到新位置再动画回去"。 */
  for (const item of targets) {
    item.element.setAttribute('x1', String(item.from.x1))
    item.element.setAttribute('y1', String(item.from.y1))
    item.element.setAttribute('x2', String(item.from.x2))
    item.element.setAttribute('y2', String(item.from.y2))
  }

  let handle: number | null = null
  let startTime: number | null = null
  const step = (time: number): void => {
    if (startTime === null) startTime = time
    const elapsed = time - startTime
    const progress = Math.min(1, elapsed / options.durationMs)
    const eased = easeOut(progress)
    for (const item of targets) {
      item.element.setAttribute('x1', String(item.from.x1 + (item.to.x1 - item.from.x1) * eased))
      item.element.setAttribute('y1', String(item.from.y1 + (item.to.y1 - item.from.y1) * eased))
      item.element.setAttribute('x2', String(item.from.x2 + (item.to.x2 - item.from.x2) * eased))
      item.element.setAttribute('y2', String(item.from.y2 + (item.to.y2 - item.from.y2) * eased))
    }
    if (progress >= 1) {
      /* 收尾必须写回精确终点，避免浮点误差留下亚像素偏差。 */
      for (const item of targets) {
        item.element.setAttribute('x1', String(item.to.x1))
        item.element.setAttribute('y1', String(item.to.y1))
        item.element.setAttribute('x2', String(item.to.x2))
        item.element.setAttribute('y2', String(item.to.y2))
      }
      handle = null
      options.onDone?.()
      return
    }
    handle = schedule(step)
  }
  handle = schedule(step)

  return () => {
    if (handle !== null) cancel(handle)
    handle = null
  }
}
