/*
 * map/viewport.ts —— 缩放/平移的纯数学（03 §4.3：0.4×–3×；「适应」/「100%」）。
 *
 * 坐标约定：
 * - 世界坐标 = layout.ts 产出的坐标，SVG 的 viewBox 固定为 `0 0 worldW worldH`；
 * - `zoom` 是**相对适应（fit）**的倍数（zoom=1 即「适应」），范围 0.4–3；
 * - `panX/panY` 是世界坐标下的平移量（像素 * zoom 之前）。
 *
 * 纯函数，无 DOM；容器尺寸由组件测出来后传进来，因此单测可直接验算。
 */

/** 视口（受控时由 T09 持有，用于"刷新不跳回"）。 */
export interface MapViewport {
  zoom: number
  panX: number
  panY: number
}

/** 容器尺寸（CSS px）。 */
export interface MapSize {
  width: number
  height: number
}

/** 世界尺寸（layout.ts 的 width/height）。 */
export interface WorldSize {
  width: number
  height: number
}

export const IDENTITY_VIEWPORT: MapViewport = { zoom: 1, panX: 0, panY: 0 }

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback
}

/** 把 zoom 夹到 [min,max]。 */
export function clampZoom(zoom: number, min = 0.4, max = 3): number {
  return Math.min(max, Math.max(min, finite(zoom, 1)))
}

/** 世界→fit 的基准比例：`min(cw/worldW, ch/worldH)`（与 preserveAspectRatio="xMidYMid meet" 一致）。 */
export function fitScale(size: MapSize, world: WorldSize): number {
  const cw = Math.max(1, finite(size.width, 1))
  const ch = Math.max(1, finite(size.height, 1))
  const ww = Math.max(1, finite(world.width, 1))
  const wh = Math.max(1, finite(world.height, 1))
  return Math.min(cw / ww, ch / wh)
}

/** 视口在 zoom=1 时能看到的世界宽/高（fit 后的"画布世界尺寸"）。 */
export function fitWorld(size: MapSize, world: WorldSize): WorldSize {
  const scale = fitScale(size, world)
  return { width: Math.max(1, finite(size.width, 1)) / scale, height: Math.max(1, finite(size.height, 1)) / scale }
}

/** 归一化视口（限制 zoom，平移量保持有限数）。 */
export function normalizeViewport(viewport: MapViewport, min = 0.4, max = 3): MapViewport {
  return {
    zoom: clampZoom(viewport.zoom, min, max),
    panX: finite(viewport.panX, 0),
    panY: finite(viewport.panY, 0),
  }
}

/**
 * 以某个屏幕点为中心缩放（滚轮/双击/按钮）。
 *
 * 让 pointer 下方的世界点保持不动：
 *   pan' = pan + u * (1/zoom' - 1/zoom)，其中 u = pointerScreen / fitScale。
 */
export function zoomAtPoint(
  viewport: MapViewport,
  nextZoom: number,
  pointer: { x: number; y: number },
  size: MapSize,
  world: WorldSize,
  min = 0.4,
  max = 3,
): MapViewport {
  const current = normalizeViewport(viewport, min, max)
  const zoom = clampZoom(nextZoom, min, max)
  if (zoom === current.zoom) return current
  const scale = fitScale(size, world)
  const ux = finite(pointer.x, 0) / scale
  const uy = finite(pointer.y, 0) / scale
  return normalizeViewport(
    {
      zoom,
      panX: current.panX + ux * (1 / zoom - 1 / current.zoom),
      panY: current.panY + uy * (1 / zoom - 1 / current.zoom),
    },
    min,
    max,
  )
}

/** 平移：屏幕位移（px）→ 世界位移（px / (fitScale * zoom)）。 */
export function panByScreen(viewport: MapViewport, dx: number, dy: number, size: MapSize, world: WorldSize): MapViewport {
  const current = normalizeViewport(viewport)
  const scale = fitScale(size, world) * current.zoom
  return {
    zoom: current.zoom,
    panX: current.panX + finite(dx, 0) / scale,
    panY: current.panY + finite(dy, 0) / scale,
  }
}

/** 100%：1 世界单位 = 1 CSS px。 */
export function zoomForActualPixels(size: MapSize, world: WorldSize): number {
  return clampZoom(1 / fitScale(size, world))
}

/** 把世界盒子放到视口中心并尽量放大到可见（「点击簇标签聚焦」「适应」）。 */
export function focusOnBox(
  box: { x: number; y: number; width: number; height: number },
  size: MapSize,
  world: WorldSize,
  max = 3,
): MapViewport {
  const scale = fitScale(size, world)
  const fit = fitWorld(size, world)
  const width = Math.max(1, box.width)
  const height = Math.max(1, box.height)
  const zoom = clampZoom(Math.min(fit.width / width, fit.height / height) * 0.9, 0.4, max)
  const cx = box.x + width / 2
  const cy = box.y + height / 2
  return normalizeViewport({
    zoom,
    panX: fit.width / 2 / zoom - cx,
    panY: fit.height / 2 / zoom - cy,
  })
}

/** 「适应」：回到 zoom=1、pan=0（不改节点坐标，只改视口）。 */
export function fitViewport(): MapViewport {
  return { ...IDENTITY_VIEWPORT }
}

/** 世界点 → 屏幕点（用于 SVG 内嵌工具提示/焦点框定位测试）。 */
export function worldToScreen(point: { x: number; y: number }, viewport: MapViewport, size: MapSize, world: WorldSize): { x: number; y: number } {
  const scale = fitScale(size, world) * viewport.zoom
  return {
    x: (point.x + viewport.panX) * scale,
    y: (point.y + viewport.panY) * scale,
  }
}

/** 屏幕点 → 世界点（用于滚轮锚点/点击空白的坐标换算）。 */
export function screenToWorld(point: { x: number; y: number }, viewport: MapViewport, size: MapSize, world: WorldSize): { x: number; y: number } {
  const scale = fitScale(size, world) * viewport.zoom
  return {
    x: point.x / scale - viewport.panX,
    y: point.y / scale - viewport.panY,
  }
}

/** SVG 的 viewBox 字符串。 */
export function viewBoxOf(world: WorldSize): string {
  return '0 0 ' + Math.max(1, world.width) + ' ' + Math.max(1, world.height)
}

/** SVG 组变换：translate(pan) scale(zoom)。 */
export function transformOf(viewport: MapViewport): string {
  return 'translate(' + viewport.panX + ' ' + viewport.panY + ') scale(' + viewport.zoom + ')'
}
