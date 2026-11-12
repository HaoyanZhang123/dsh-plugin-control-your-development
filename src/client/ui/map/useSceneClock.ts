/*
 * client/ui/map/useSceneClock.ts —— **一个 rAF 时钟，两种图共用**（P2 / P3）。
 *
 * 纯插值逻辑在 `sceneClock.ts`（可断言）；这里只管"什么时候推进一帧"。
 *
 * 契约（逐条对应真机反馈）：
 * 1. **单一时间轴**：节点坐标、枢纽卡片尺寸、三类边端点、标签位置全部从
 *    内核返回的**同一帧**取，不再各自走 CSS transition。
 * 2. **两种图共用**：内核只认「key → NodeFrame」，folder 与 turn 各自提供
 *    `framesOf`（怎么摊成帧）与 `project`（怎么把帧套回自己的几何）。
 * 3. **可打断**：新目标到来时从**当前可见帧**继续插值，不跳回上一次的起点。
 * 4. **reduced-motion / 首帧 / 拖动中**：直接到终点帧，不排任何回调（信息不减）。
 * 5. **不做无谓动画**：目标引用没变（几何 memo 命中）就什么都不做。
 *
 * 为什么用 `useLayoutEffect`：目标变化后必须在浏览器绘制前就写首帧，
 * 否则会先闪一帧终点位置再回到起点。
 *
 * ## 与入场动画的分工（正交，不打架）
 *
 * 本 hook 管**位置形变**（逐帧写 cx/cy/r、x1/y1/x2/y2、标签 x/y）；
 * `enterStyleOf` + CSS keyframes 管**首次出现那次淡入**（opacity / translateY）。
 * 两者写的是不同属性，所以可以并存；也正因为位置已经被 rAF 接管，
 * CSS 里才不许再对几何声明 transition（否则会在 rAF 之后"懒一拍"）。
 */
import * as React from 'react'
import type { FolderGeometry } from './folderLayout.ts'
import type { GraphLayout } from './graphLayout.ts'
import {
  applyFolderFrame,
  easeLayout,
  enterOrigin,
  interpolateNodeFrames,
  nodeFramesOfFolder,
  type NodeFrame,
} from './sceneClock.ts'

/** 布局时钟的默认时长（ms）；真实值由 CSS 令牌 `--tl-dur-layout` 提供。 */
export const DEFAULT_LAYOUT_DURATION_MS = 280

/**
 * **起点快照的决策规则**（唯一一处，hook 与测试共用同一条）。
 *
 * - `restarted === true`（视图身份变了）→ **空快照**：
 *   喂给 `interpolateNodeFrames` 时每个 key 都命中"新节点"分支，
 *   于是全部从 `enterOrigin()` 生长到目标位置 —— 这就是用户要的"生长"。
 * - `restarted === false` → 用当前可见帧，保持"旧位置→新位置"的平滑插值
 *   （同一视图内切密度/选中不许退化）。
 *
 * 抽成导出函数是为了让测试断言**产品的那一条规则**，而不是在测试里复制一份
 * （复制出来的规则一旦与产品漂移，测试就会"绿着说谎"）。
 */
export function sceneStartFrames(
  restarted: boolean,
  visible: ReadonlyMap<string, NodeFrame>,
): Map<string, NodeFrame> {
  return restarted ? new Map<string, NodeFrame>() : new Map(visible)
}

export interface SceneClockOptions {
  /** 插值时长（ms）。`<= 0` = 直接到终点（令牌在 reduced-motion 下归零）。 */
  durationMs: number
  /** 用户偏好/显式开关：true = 不播动画，直接写终点帧。 */
  reducedMotion: boolean
  /** 拖动中等"逐帧跟随"的场景：不加过渡（语义与旧实现的 `data-dragging` 排除一致）。 */
  immediate?: boolean
  /**
   * **视图身份**（轮次号 / 目录路径）。**值变化时**丢弃旧快照，视为一次全新入场：
   * 所有节点从 `enterOrigin()` **生长**到目标位置，而不是从旧布局滑过去。
   *
   * 为什么需要它（真机反馈「关系线和节点一起生长出来，而不是提前预订好的转场进入」）：
   * 内核的默认语义是「同一 key 在旧快照里存在 → 从旧坐标滑到新坐标」。
   * 于是两种视图的观感**取决于 key 重合度**——
   * - 切目录：多数文件不在旧图里 → 走"新节点"分支 → 碰巧就是生长；
   * - 切轮次：文件几乎完全相同、只有 ops 变 → 几乎全部命中旧 key → 全是滑动 → 像转场。
   *
   * 声明 `restartOn` 后，视图身份一变就当作"没有旧快照"，两种视图的入场观感一致。
   * 视图身份**不变**时（同一次轮次内切密度/选中/悬停）仍保留原有平滑语义。
   */
  restartOn?: unknown
}

/**
 * **泛型内核**：把任一「key → NodeFrame」目标在一条 rAF 时间轴上平滑呈现。
 *
 * - `framesOf(value)`：从调用方的几何里摊出 key→坐标（适配器）。
 * - `project(frames, value)`：把当前帧套回调用方自己的几何形态。
 * - `originOf(value)`：新节点从哪儿起步（两种图都是画布中心）。
 *
 * 返回**当前可见帧 + 是否正在生长**：`frame` 类型与 `target` 相同、坐标为插值结果。
 * 只要几何的调用方用 `useNodeFrames`（只取 frame），要状态的用这个。
 */
export function useNodeFramesState<T>(
  target: T,
  framesOf: (value: T) => Map<string, NodeFrame>,
  project: (frames: ReadonlyMap<string, NodeFrame>, value: T) => T,
  originOf: (value: T) => { x: number; y: number },
  options: SceneClockOptions,
): { frame: T; growing: boolean } {
  const renderedRef = React.useRef<T | null>(null)
  const fromFramesRef = React.useRef<Map<string, NodeFrame> | null>(null)
  const targetRef = React.useRef<T>(target)
  const adaptersRef = React.useRef({ framesOf, project, originOf })
  const startedAtRef = React.useRef<number | null>(null)
  const handleRef = React.useRef<number | null>(null)
  /** 上一次的视图身份；`restartOn` 与它不等 ⇒ 全新入场。 */
  const previousRestartRef = React.useRef<unknown>(options.restartOn)
  /** 是否正在"生长"（供渲染层抑制逐元素 CSS 入场动画）。 */
  const growingRef = React.useRef(false)
  const [, bump] = React.useReducer((value: number) => value + 1, 0)

  /* 适配器每次渲染可以换新引用（内联箭头函数很常见），不触发副作用重跑。 */
  adaptersRef.current = { framesOf, project, originOf }

  const cancelPending = React.useCallback((): void => {
    if (handleRef.current !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(handleRef.current)
    }
    handleRef.current = null
  }, [])

  React.useLayoutEffect(() => {
    cancelPending()
    targetRef.current = target
    const duration = options.durationMs
    const canAnimate =
      typeof requestAnimationFrame === 'function' &&
      !options.reducedMotion &&
      !options.immediate &&
      Number.isFinite(duration) &&
      duration > 0

    /* 首帧 / 不允许动画：直接到终点。功能与信息完整，只是没有中间帧。 */
    if (renderedRef.current === null || !canAnimate) {
      const already = renderedRef.current === target
      renderedRef.current = target
      fromFramesRef.current = null
      startedAtRef.current = null
      if (!already) bump()
      return cancelPending
    }
    /* 目标没变（memo 命中）：保留正在跑的动画，别重启。 */
    if (renderedRef.current === target) {
      fromFramesRef.current = null
      startedAtRef.current = null
      return cancelPending
    }

    /*
     * **视图身份变了** → 视为一次全新入场（用户要的"生长"）。
     *
     * 做法：把起点快照换成**空 Map**，而不是当前可见帧。
     * 空 Map 喂给同一个 `interpolateNodeFrames` 时，每个 key 都会命中
     * 「旧快照里没有它」的分支 → 从 `enterOrigin()` 一路 lerp 到目标 = 生长。
     *
     * 为什么不用"新增第二个插值函数"：插值语义只有一份（单执行路径）；
     * "从哪儿起步"是**起点快照**的性质，空快照天然表达"全部都是新节点"。
     * 这也让"首帧"与"换视图"共用同一条代码路径。
     */
    const restarted = options.restartOn !== previousRestartRef.current
    if (restarted) previousRestartRef.current = options.restartOn
    /* 可打断：起点 = **当前可见帧**（不是上一次的起点）；换视图时起点为空。 */
    fromFramesRef.current = sceneStartFrames(
      restarted,
      adaptersRef.current.framesOf(renderedRef.current),
    )
    startedAtRef.current = null
    growingRef.current = true
    bump()

    const step = (time: number): void => {
      const from = fromFramesRef.current
      if (from === null) {
        handleRef.current = null
        return
      }
      if (startedAtRef.current === null) startedAtRef.current = time
      const elapsed = time - startedAtRef.current
      const progress = duration <= 0 ? 1 : Math.min(1, elapsed / duration)
      const next = targetRef.current
      if (progress >= 1) {
        renderedRef.current = next
        fromFramesRef.current = null
        startedAtRef.current = null
        handleRef.current = null
        /* 生长结束：渲染层可以把逐元素入场动画放回来了（下次挂载用）。 */
        growingRef.current = false
        bump()
        return
      }
      const adapters = adaptersRef.current
      const frames = interpolateNodeFrames(from, adapters.framesOf(next), easeLayout(progress), adapters.originOf(next))
      renderedRef.current = adapters.project(frames, next)
      handleRef.current = requestAnimationFrame(step)
      bump()
    }
    handleRef.current = requestAnimationFrame(step)
    return cancelPending
  }, [target, options.durationMs, options.reducedMotion, options.immediate, options.restartOn, cancelPending])

  /* 卸载时不留悬挂回调。 */
  React.useEffect(() => () => cancelPending(), [cancelPending])

  /**
   * **是否正在"生长"**（几何正从 origin 长到目标）。
   *
   * 渲染层据此写 `data-scene-motion='grow'`，CSS 在几何生长期间**抑制**逐元素入场动画，
   * 避免"节点一边从中心移动、一边还在淡入/位移"的双重动画打架。
   *
   * 首次挂载不走这里：那时 `renderedRef === null`，时钟直接到终点、`growing` 为 false，
   * 于是 CSS 入场动画照常播放（首屏不能变成"突然出现"）。
   */
  return { frame: renderedRef.current ?? target, growing: growingRef.current }
}

/**
 * 只取几何（绝大多数调用方要的就是这个）。
 *
 * 与 `useNodeFramesState` 共用同一个内核与同一条时间轴 —— 只是返回形状不同。
 */
export function useNodeFrames<T>(
  target: T,
  framesOf: (value: T) => Map<string, NodeFrame>,
  project: (frames: ReadonlyMap<string, NodeFrame>, value: T) => T,
  originOf: (value: T) => { x: number; y: number },
  options: SceneClockOptions,
): T {
  return useNodeFramesState(target, framesOf, project, originOf, options).frame
}

/**
 * folder 图入口（只取几何）。
 *
 * 返回值的结构与 `target` 相同、坐标为插值结果；调用方应把拖动偏移叠加在
 * 返回值**之上**（`applyDragOffsets(frame, offsets)`）。
 */
export function useSceneFrame(target: FolderGeometry, options: SceneClockOptions): FolderGeometry {
  return useSceneFrameState(target, options).frame
}

/** folder 图入口（几何 + 是否正在生长）；FolderMap 用这个来写 `data-scene-motion`。 */
export function useSceneFrameState(
  target: FolderGeometry,
  options: SceneClockOptions,
): { frame: FolderGeometry; growing: boolean } {
  return useNodeFramesState<FolderGeometry>(
    target,
    nodeFramesOfFolder,
    (frames, next) =>
      applyFolderFrame(next, frames, (key) => {
        const hub = next.hubs.find((candidate) => candidate.path.toLowerCase() === key)
        return hub === undefined ? { width: 0, height: 0 } : { width: hub.width, height: hub.height }
      }),
    enterOrigin,
    options,
  )
}

/**
 * 轮次图的**调用形态**（在 `FileGraph.ts` 里直接 `useNodeFrames(...)` 即可）：
 *
 * ```ts
 * const frame = useNodeFrames(layout, nodeFramesOfGraph, projectGraphFrame, enterOrigin, options)
 * ```
 *
 * 这里把 `projectGraphFrame` 放在本文件，是为了让"怎么把帧套回 GraphLayout"
 * 也只有一处实现（FileGraph 不自己拼坐标）。
 */
export function projectGraphFrame(
  frames: ReadonlyMap<string, NodeFrame>,
  next: GraphLayout,
): GraphLayout {
  return {
    ...next,
    nodes: next.nodes.map((node) => {
      const frame = frames.get(node.path.toLowerCase())
      return frame === undefined ? node : { ...node, x: frame.x, y: frame.y, r: frame.r }
    }),
  }
}
