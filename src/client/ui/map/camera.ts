/*
 * map/camera.ts —— 左图的视图相机（缩放 / 平移）：纯函数，确定性，只改视图不改布局。
 *
 * 坐标系：<g transform="translate(tx ty) scale(s)"> 作用于 SVG 用户坐标；
 * 画布 viewBox 与容器 1:1（`0 0 width height`），且没有额外缩放，因此
 *   screen = graph * s + t
 * 反过来 graph = (screen - t) / s。
 *
 * 关键修复（M5，用户原话「放大缩小会往左上缩」）：
 * 旧实现的平移夹取是 `limit = max(0, size*(scale-1)/2 + 48)`；
 * `scale < 1` 时括号内为负 → limit 被夹成 0 → tx/ty 只能是 0 →
 * 而 `<g>` 原点是画布左上角，于是缩小只能"往左上收"。
 * 现在按「内容相对视口居中」推导：内容缩放后尺寸为 size*s，
 * 令其中心保持与视口中心重合需要的平移是 size*(1-s)/2，
 * 夹取范围以它为基准（对称、带一点余量），`s < 1` 同样成立。
 */
import type { GraphEdge } from '../../../shared/relations/index.ts'

/** 缩放范围（01 §4.2：0.5×–3×）。 */
export const GRAPH_ZOOM_MIN = 0.5
export const GRAPH_ZOOM_MAX = 3
/** 每次点 +/- 的倍率。 */
export const GRAPH_ZOOM_STEP = 1.25
/** 平移余量（px）：允许把内容拖出边界一点点，但不至于整张图丢出视口。 */
export const CAMERA_PAN_MARGIN = 48

/** 相机：<g transform="translate(tx ty) scale(scale)">。 */
export interface GraphCamera {
  /** 缩放（0.5–3）。 */
  scale: number
  /** 平移 x（屏幕 px）。 */
  tx: number
  /** 平移 y（屏幕 px）。 */
  ty: number
}

/** 视口尺寸（= 画布 viewBox 尺寸）。 */
export interface CameraViewport {
  width: number
  height: number
}

/** 默认相机：1×、无平移（= 布局坐标即屏幕坐标，内容天然居中）。 */
export const DEFAULT_CAMERA: GraphCamera = { scale: 1, tx: 0, ty: 0 }

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/** 缩放夹取到 0.5–3（非有限数退化为 1）。 */
export function clampCameraScale(scale: number): number {
  if (!Number.isFinite(scale)) return 1
  return Math.min(GRAPH_ZOOM_MAX, Math.max(GRAPH_ZOOM_MIN, Math.round(scale * 1000) / 1000))
}

/**
 * 某条轴上的平移上限（对称）。
 *
 * 内容尺寸 `size`、缩放 `scale` 时，「内容中心与视口中心重合」对应的平移量是
 * `size * (1 - scale) / 2`；以它的绝对值加余量作为最大平移。
 * scale === 1 时上限 = 余量（只允许拖动一点点）。
 * 结果四舍五入到 0.01，避免浮点尾数泄漏到 transform 字符串与断言里。
 */
export function cameraPanLimit(size: number, scale: number): number {
  const safeSize = Number.isFinite(size) && size > 0 ? size : 0
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1
  return round2(Math.abs((safeSize * (1 - safeScale)) / 2) + CAMERA_PAN_MARGIN)
}

/** 平移量夹取（对称上下限，scale<1 也有限界，不再被夹成 0）。 */
export function clampCameraPan(value: number, size: number, scale: number): number {
  const limit = cameraPanLimit(size, scale)
  const safe = Number.isFinite(value) ? value : 0
  return round2(Math.min(limit, Math.max(-limit, safe)))
}

/** 图坐标 → 屏幕坐标（几何断言与命中测试共用）。 */
export function graphPointToScreen(camera: GraphCamera, point: { x: number; y: number }): { x: number; y: number } {
  return { x: point.x * camera.scale + camera.tx, y: point.y * camera.scale + camera.ty }
}

/** 屏幕坐标 → 图坐标（拖动节点时把屏幕位移换算回图坐标）。 */
export function screenPointToGraph(camera: GraphCamera, point: { x: number; y: number }): { x: number; y: number } {
  const scale = camera.scale > 0 ? camera.scale : 1
  return { x: (point.x - camera.tx) / scale, y: (point.y - camera.ty) / scale }
}

/**
 * 围绕**视口中心**缩放：视口中心对应的图坐标点在缩放前后停在同一个屏幕位置。
 *
 * 推导：令 c = viewport/2，p = (c - t)/s（中心点图坐标）；
 * 新平移 t' = c - p * s'，即中心点不动。
 */
export function zoomCameraAtCenter(camera: GraphCamera, nextScale: number, viewport: CameraViewport): GraphCamera {
  const scale = clampCameraScale(nextScale)
  if (scale === camera.scale) return camera
  const cx = viewport.width / 2
  const cy = viewport.height / 2
  const base = camera.scale > 0 ? camera.scale : 1
  const graphX = (cx - camera.tx) / base
  const graphY = (cy - camera.ty) / base
  return {
    scale,
    tx: clampCameraPan(cx - graphX * scale, viewport.width, scale),
    ty: clampCameraPan(cy - graphY * scale, viewport.height, scale),
  }
}

/** 空白拖拽平移（dx/dy 是屏幕像素；1× 及以下不生效，避免和节点拖动打架）。 */
export function panCameraBy(camera: GraphCamera, dx: number, dy: number, viewport: CameraViewport): GraphCamera {
  if (camera.scale <= 1) return camera
  return {
    scale: camera.scale,
    tx: clampCameraPan(camera.tx + dx, viewport.width, camera.scale),
    ty: clampCameraPan(camera.ty + dy, viewport.height, camera.scale),
  }
}

/** 相机 → SVG transform 字符串（确定性，测试可直接比对）。 */
export function cameraTransform(camera: GraphCamera): string {
  return 'translate(' + String(camera.tx) + ' ' + String(camera.ty) + ') scale(' + String(camera.scale) + ')'
}

/**
 * 相机复位（适应 / 重置共用）：回到 1× 且平移归零。
 * 内容布局本身以画布中心为基准，因此 1×/0/0 就是「居中」。
 */
export function resetCamera(): GraphCamera {
  return DEFAULT_CAMERA
}

/**
 * 一段文件集合的屏幕外接框中心（几何断言用：证明"同一图元相对位置保持"）。
 * 传进来的坐标是布局（图）坐标；返回屏幕坐标。
 */
export function screenCenterOf(
  camera: GraphCamera,
  points: ReadonlyArray<{ x: number; y: number }>,
): { x: number; y: number } {
  if (points.length === 0) return { x: 0, y: 0 }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const point of points) {
    if (point.x < minX) minX = point.x
    if (point.y < minY) minY = point.y
    if (point.x > maxX) maxX = point.x
    if (point.y > maxY) maxY = point.y
  }
  return graphPointToScreen(camera, { x: (minX + maxX) / 2, y: (minY + maxY) / 2 })
}

/** 边在相机下的端点（几何证据用：证明同一图元相对位置在缩放后保持）。 */
export function screenEndpoints(
  camera: GraphCamera,
  edge: GraphEdge,
  nodes: ReadonlyMap<string, { x: number; y: number }>,
): { from: { x: number; y: number }; to: { x: number; y: number } } | null {
  const from = nodes.get(edge.from.toLowerCase())
  const to = nodes.get(edge.to.toLowerCase())
  if (from === undefined || to === undefined) return null
  return { from: graphPointToScreen(camera, from), to: graphPointToScreen(camera, to) }
}
