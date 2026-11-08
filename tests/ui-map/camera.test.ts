/*
 * camera.test.ts —— 缩放几何（M5 的硬判据）。
 *
 * 用户原话：「左边节点放大或缩小，它会默认往左上方缩小，但是，我想要放在中间，这样缩小，然后维持在中间。」
 *
 * 本文件分两段：
 * 1. **旧实现的反向证据**（`legacyClampCameraPan`）：逐字复刻 1.2.0 的
 *    `const limit = Math.max(0, (size * (scale - 1)) / 2 + 48)`，
 *    断言它在 scale < 1 时把平移夹成 0 → 图元在屏幕上**必然**往左上偏（>2px）；
 * 2. **修后实现**：0.5× / 0.8× / 1× / 2× / 3× 五档，同一图元的屏幕中心误差 ≤ 2px，
 *    并且五档之间相对位置保持不变。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CAMERA_PAN_MARGIN,
  cameraPanLimit,
  cameraTransform,
  clampCameraPan,
  clampCameraScale,
  DEFAULT_CAMERA,
  GRAPH_ZOOM_MAX,
  GRAPH_ZOOM_MIN,
  GRAPH_ZOOM_STEP,
  graphPointToScreen,
  panCameraBy,
  resetCamera,
  screenCenterOf,
  screenPointToGraph,
  zoomCameraAtCenter,
  type GraphCamera,
} from '../../src/client/ui/map/index.ts'

const VIEWPORT = { width: 720, height: 460 }

/* ================================================================== *
 * 1. 旧实现（1.2.0）的反向证据：scale < 1 时 limit=0 → 往左上收
 * ================================================================== */

/** 1.2.0 的原实现，逐字复刻（只用于证明"修前确实会红"，产品代码已不再引用）。 */
function legacyClampCameraPan(value: number, size: number, scale: number): number {
  const limit = Math.max(0, (size * (scale - 1)) / 2 + 48)
  return Math.min(limit, Math.max(-limit, Math.round(value * 100) / 100))
}

function legacyZoomAtCenter(camera: GraphCamera, nextScale: number, viewport: { width: number; height: number }): GraphCamera {
  const scale = clampCameraScale(nextScale)
  if (scale === camera.scale) return camera
  const cx = viewport.width / 2
  const cy = viewport.height / 2
  const graphX = (cx - camera.tx) / camera.scale
  const graphY = (cy - camera.ty) / camera.scale
  return {
    scale,
    tx: legacyClampCameraPan(cx - graphX * scale, viewport.width, scale),
    ty: legacyClampCameraPan(cy - graphY * scale, viewport.height, scale),
  }
}

test('【修前失败证据】旧 clampCameraPan 在 scale<1 时 limit 被夹成 0', () => {
  // 720×(0.5−1)/2 + 48 = −132（浮点尾数忽略）
  assert.ok(Math.abs((VIEWPORT.width * (0.5 - 1)) / 2 + 48 - -132) < 1e-6)
  // 注意：Math.max(0, -0) 的结果是 -0，这里用 +0 归一化后比较。
  assert.equal(legacyClampCameraPan(0, VIEWPORT.width, 0.5) + 0, 0)
  assert.equal(legacyClampCameraPan(-999, VIEWPORT.width, 0.5) + 0, 0)
  assert.equal(legacyClampCameraPan(999, VIEWPORT.width, 0.5) + 0, 0)
  // 0.8× 同理（720×(0.8−1)/2+48 = −24）。
  assert.ok(Math.abs((VIEWPORT.width * (0.8 - 1)) / 2 + 48 - -24) < 1e-6)
  assert.equal(legacyClampCameraPan(0, VIEWPORT.width, 0.8) + 0, 0)
  // 对比：修后实现同一输入给出有限且非 0 的上限（根因消失）。
  assert.equal(cameraPanLimit(VIEWPORT.width, 0.5), 228)
  assert.equal(cameraPanLimit(VIEWPORT.width, 0.8), 120)
})

test('【修前失败证据】旧实现缩到 0.5× 时，视口中心图元的屏幕位置偏离中心 > 2px', () => {
  const camera: GraphCamera = { scale: 1, tx: 0, ty: 0 }
  const centerPoint = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 }
  const before = graphPointToScreen(camera, centerPoint)
  const legacy = legacyZoomAtCenter(camera, 0.5, VIEWPORT)
  const after = graphPointToScreen(legacy, centerPoint)
  const offsetX = Math.abs(after.x - before.x)
  const offsetY = Math.abs(after.y - before.y)
  // 旧实现：相机被夹成 translate(0 0) scale(0.5) → 中心点跑到 (180,115)，
  // 相对视口中心 (360,230) 偏了 180/115px —— 这就是用户看到的「往左上缩」。
  assert.equal(legacy.tx, 0)
  assert.equal(legacy.ty, 0)
  assert.ok(offsetX > 2, '修前应偏离中心 > 2px，实际 ' + offsetX)
  assert.ok(offsetY > 2, '修前应偏离中心 > 2px，实际 ' + offsetY)
  // 数值存档（写进证据报告）：0.5× 时中心点被推到 (180, 115)。
  assert.deepEqual([Math.round(after.x), Math.round(after.y)], [180, 115])
})

test('【修前失败证据】旧实现缩到 0.8× 时同样偏离（往左上）', () => {
  const camera: GraphCamera = { scale: 1, tx: 0, ty: 0 }
  const centerPoint = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 }
  const before = graphPointToScreen(camera, centerPoint)
  const legacy = legacyZoomAtCenter(camera, 0.8, VIEWPORT)
  const after = graphPointToScreen(legacy, centerPoint)
  // 宽 720 → limit_x = max(0, −72 + 48) = 0；高 460 → limit_y = max(0, −46 + 48) = 2（浮点尾数忽略）。
  assert.equal(legacy.tx, 0)
  assert.ok(Math.abs(legacy.ty - 2) < 1e-6, '修前 y 上限只剩 2px，实际 ' + legacy.ty)
  assert.ok(Math.abs(after.x - before.x) > 2, '修前 x 应偏离 > 2px：' + Math.abs(after.x - before.x))
  assert.ok(Math.abs(after.y - before.y) > 2, '修前 y 应偏离 > 2px：' + Math.abs(after.y - before.y))
  // 而且方向固定是"往左上"（新坐标 < 中心）。
  assert.ok(after.x < before.x && after.y < before.y, '旧实现只会往左上收')
})

/* ================================================================== *
 * 2. 修后实现：围绕视口中心缩放，五档中心误差 ≤ 2px
 * ================================================================== */

test('相机：默认 1/0/0；缩放范围 clamp 0.5–3；步进 1.25', () => {
  assert.deepEqual(DEFAULT_CAMERA, { scale: 1, tx: 0, ty: 0 })
  assert.equal(GRAPH_ZOOM_MIN, 0.5)
  assert.equal(GRAPH_ZOOM_MAX, 3)
  assert.equal(GRAPH_ZOOM_STEP, 1.25)
  assert.equal(clampCameraScale(0.2), 0.5)
  assert.equal(clampCameraScale(99), 3)
  assert.equal(clampCameraScale(Number.NaN), 1)
  assert.equal(clampCameraScale(1.23456), 1.235)
  assert.equal(cameraTransform(DEFAULT_CAMERA), 'translate(0 0) scale(1)')
})

test('相机：平移上限在 scale<1 时不再为 0（这是根因修复）', () => {
  // 720 × (1−0.5)/2 + 48 = 180 + 48 = 228
  assert.equal(cameraPanLimit(720, 0.5), 228)
  assert.equal(cameraPanLimit(720, 0.8), 120)
  assert.equal(cameraPanLimit(720, 1), CAMERA_PAN_MARGIN)
  assert.equal(cameraPanLimit(720, 2), 408)
  assert.ok(cameraPanLimit(720, 0.5) > 0, 'scale<1 时上限必须 > 0')
  // clamp 不再被夹成 0；±limit 的边界要真的放开。
  assert.equal(clampCameraPan(200, 720, 0.5), 200)
  assert.equal(clampCameraPan(-200, 720, 0.5), -200)
  assert.equal(clampCameraPan(9999, 720, 0.5), 228)
})

test('M5 几何：0.5/0.8/1/2/3 五档，同一图元屏幕中心误差 ≤ 2px（不再往左上）', () => {
  const centerPoint = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 }
  let camera: GraphCamera = { scale: 1, tx: 0, ty: 0 }
  const expected = graphPointToScreen(camera, centerPoint)
  const scales = [0.5, 0.8, 1, 2, 3]
  const measured: Array<{ scale: number; x: number; y: number; dx: number; dy: number }> = []
  for (const scale of scales) {
    camera = zoomCameraAtCenter(camera, scale, VIEWPORT)
    assert.equal(camera.scale, scale)
    const screen = graphPointToScreen(camera, centerPoint)
    const dx = Math.abs(screen.x - expected.x)
    const dy = Math.abs(screen.y - expected.y)
    measured.push({ scale, x: screen.x, y: screen.y, dx, dy })
    assert.ok(dx <= 2, scale + '× 时中心 x 偏移 ' + dx + 'px > 2px')
    assert.ok(dy <= 2, scale + '× 时中心 y 偏移 ' + dy + 'px > 2px')
  }
  // 反过来从 3× 一路缩回 0.5× 也必须保持中心（幂等可逆）。
  for (const scale of [2, 1, 0.8, 0.5]) {
    camera = zoomCameraAtCenter(camera, scale, VIEWPORT)
    const screen = graphPointToScreen(camera, centerPoint)
    assert.ok(Math.abs(screen.x - expected.x) <= 2, '缩回 ' + scale + '× 时 x 偏移过大')
    assert.ok(Math.abs(screen.y - expected.y) <= 2, '缩回 ' + scale + '× 时 y 偏移过大')
  }
  // 五档的最小偏移也记下来（证据报告用）。
  const maxOffset = Math.max(...measured.map((item) => Math.max(item.dx, item.dy)))
  assert.ok(maxOffset <= 2, '五档最大中心偏移 ' + maxOffset + 'px')
})

test('M5 几何：任意图元（不只中心）在五档下的相对位置保持', () => {
  const points = [
    { x: 0, y: 0 },
    { x: 120, y: 90 },
    { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 },
    { x: 660, y: 400 },
  ]
  let camera: GraphCamera = { scale: 1, tx: 0, ty: 0 }
  const baseline = points.map((point) => graphPointToScreen(camera, point))
  for (const scale of [0.5, 0.8, 2, 3]) {
    camera = zoomCameraAtCenter(camera, scale, VIEWPORT)
    points.forEach((point, index) => {
      const now = graphPointToScreen(camera, point)
      // 相对中心点按 scale 缩放的关系必须成立（真实几何一致性），
      // 且不许出现"所有图元一起往左上平移"的偏置。
      const center = graphPointToScreen(camera, { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 })
      const baseCenter = baseline[2]
      const expectedX = baseCenter.x + (baseline[index].x - baseCenter.x) * (scale / 1)
      const expectedY = baseCenter.y + (baseline[index].y - baseCenter.y) * (scale / 1)
      assert.ok(Math.abs(now.x - expectedX) <= 2, scale + '× 点' + index + ' x 误差 ' + Math.abs(now.x - expectedX) + 'px')
      assert.ok(Math.abs(now.y - expectedY) <= 2, scale + '× 点' + index + ' y 误差 ' + Math.abs(now.y - expectedY) + 'px')
      assert.ok(Math.abs(center.x - VIEWPORT.width / 2) <= 2)
      assert.ok(Math.abs(center.y - VIEWPORT.height / 2) <= 2)
    })
    camera = zoomCameraAtCenter(camera, 1, VIEWPORT)
  }
})

test('相机：缩放后屏幕↔图坐标互逆；不产生 NaN', () => {
  for (const scale of [0.5, 0.8, 1, 2, 3]) {
    const camera = zoomCameraAtCenter(DEFAULT_CAMERA, scale, VIEWPORT)
    assert.ok(Number.isFinite(camera.tx) && Number.isFinite(camera.ty), scale + '× 不应出现 NaN')
    const point = { x: 137, y: 251 }
    const round = screenPointToGraph(camera, graphPointToScreen(camera, point))
    assert.ok(Math.abs(round.x - point.x) < 1e-6)
    assert.ok(Math.abs(round.y - point.y) < 1e-6)
  }
})

test('相机：适应/重置都回到 1×/居中；缩放不持久化（纯内存返回新对象）', () => {
  const zoomed = zoomCameraAtCenter(DEFAULT_CAMERA, 2.5, VIEWPORT)
  assert.deepEqual(resetCamera(), { scale: 1, tx: 0, ty: 0 })
  // 输入对象不被修改（不可变，纯函数）。
  assert.deepEqual(DEFAULT_CAMERA, { scale: 1, tx: 0, ty: 0 })
  assert.notEqual(zoomed, DEFAULT_CAMERA)
  // scale 不变时返回同一引用（不触发无谓重绘）。
  assert.equal(zoomCameraAtCenter(DEFAULT_CAMERA, 1, VIEWPORT), DEFAULT_CAMERA)
})

test('相机：平移只在 scale > 1 生效；有对称软边界且确定性', () => {
  assert.equal(panCameraBy(DEFAULT_CAMERA, 40, 30, VIEWPORT), DEFAULT_CAMERA, '1× 不响应空白拖拽')
  const zoomed = zoomCameraAtCenter(DEFAULT_CAMERA, 2, VIEWPORT)
  const moved = panCameraBy(zoomed, 40, -20, VIEWPORT)
  assert.equal(moved.scale, 2)
  assert.equal(moved.tx, zoomed.tx + 40)
  assert.equal(moved.ty, zoomed.ty - 20)
  assert.deepEqual(panCameraBy(zoomed, 40, -20, VIEWPORT), moved, '同输入同输出')
  const limitX = cameraPanLimit(VIEWPORT.width, 2)
  assert.equal(panCameraBy(zoomed, 99999, 99999, VIEWPORT).tx, limitX)
  assert.equal(clampCameraPan(-99999, VIEWPORT.width, 2), -limitX)
})

test('screenCenterOf：一段图元的屏幕外接框中心随相机正确移动', () => {
  const points = [
    { x: 100, y: 100 },
    { x: 300, y: 200 },
  ]
  const at1 = screenCenterOf(DEFAULT_CAMERA, points)
  assert.deepEqual(at1, { x: 200, y: 150 })
  const zoomed = zoomCameraAtCenter(DEFAULT_CAMERA, 2, VIEWPORT)
  const at2 = screenCenterOf(zoomed, points)
  // 2× 时两点间距翻倍，中心仍在同一屏幕位置（围绕视口中心缩放）。
  assert.ok(Math.abs(at1.x - at2.x) > 2, '非中心图元在缩放后应位移（证明真的缩放了）')
  const firstAt1 = graphPointToScreen(DEFAULT_CAMERA, points[0])
  const firstAt2 = graphPointToScreen(zoomed, points[0])
  const spread1 = at1.x - firstAt1.x
  const spread2 = at2.x - firstAt2.x
  assert.ok(Math.abs(spread2 - spread1 * 2) < 1e-6, '2× 时间距翻倍：' + spread1 + ' → ' + spread2)
})
