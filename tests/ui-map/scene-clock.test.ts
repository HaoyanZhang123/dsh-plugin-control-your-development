/*
 * tests/ui-map/scene-clock.test.ts —— **同一帧**：节点、枢纽、三类边的端点。
 *
 * 这条套件守的是 P2 的核心不变量，也是 1.5.4 那个 bug 的**可断言形式**：
 *
 * > 用户原话：「都是节点动，线早就在位置上等着了」。
 *
 * 根因（三条都在代码里核对过）：
 * 1. 边端点插值器（已删除的 `edgeSync.ts`）只认 `data-edge-id` / `data-hub-edge-*`，
 *    **不认 `data-hub-pair-*`** → 文件夹↔文件夹的线永远不进插值；
 * 2. 边快照在 `syncEdges()` **之后**才读，读到的是被钉回旧坐标的 DOM → 存的是旧帧；
 * 3. 布局阶段存进 `geometry.hubEdges[].x1/y1/...` 的是**静态坐标**，
 *    逐帧插值时若读它，节点在中途、线已在终点。
 *
 * 正确做法（`sceneClock.interpolateGeometry`）：**只用当前帧的 nodes/hubs 坐标派生端点**。
 * 因此下面每一条断言都应该得到偏差 **严格 0**（不是"接近 0"，是同一个数）。
 *
 * 采样：progress = 0 / 0.25 / 0.5 / 0.75 / 1（题目要求的五个点）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { coTurnEvidence, type GraphEdge } from '../../src/shared/relations/index.ts'
import {
  collectEdgeEndpoints,
  easeLayout,
  edgeEndpointDeviation,
  enterOrigin,
  interpolateGeometry,
  layoutFolderGeometry,
  type FolderGeometry,
  type MapEntry,
} from '../../src/client/ui/map/index.ts'

const SIZE = { width: 720, height: 420 }
const SAMPLES = [0, 0.25, 0.5, 0.75, 1] as const

function dirEntry(path: string): MapEntry {
  return { name: path.slice(path.lastIndexOf('/') + 1), path, kind: 'directory' }
}

function fileEntry(path: string): MapEntry {
  return { name: path.slice(path.lastIndexOf('/') + 1), path, kind: 'file' }
}

function crossEdge(from: string, to: string, weight: number): GraphEdge {
  return {
    id: from + '>' + to,
    type: 'coTurn',
    from,
    to,
    weight,
    directed: false,
    confirmed: true,
    confidence: 'confirmed',
    evidence: coTurnEvidence({ samples: [{ sessionId: 's', turn: 1 }], count: 1 }),
  }
}

/**
 * 两张**不同**的布局（都带枢纽间连线与枢纽聚合边）。
 *
 * 为什么用两次真实布局而不是手搓坐标：手搓的夹具可能"恰好"让静态端点等于节点坐标，
 * 于是"读静态值"这个 bug 在测试里看不见。两次真实布局的坐标一定不同。
 */
function twoFrames(): { previous: FolderGeometry; next: FolderGeometry } {
  const entries: MapEntry[] = [
    dirEntry('src'),
    dirEntry('docs'),
    dirEntry('tools'),
    fileEntry('README.md'),
    fileEntry('package.json'),
  ]
  const allEdges: GraphEdge[] = [
    /* 当前目录文件 ↔ 子文件夹内文件：产生**枢纽聚合边**（hub 边）。 */
    crossEdge('README.md', 'src/deep.ts', 30),
    crossEdge('package.json', 'tools/run.ts', 15),
    /* 子文件夹 ↔ 子文件夹：产生**枢纽间连线**（hub-pair 边，旧实现漏掉的那一类）。 */
    crossEdge('src/a.ts', 'docs/guide.md', 90),
    crossEdge('src/b.ts', 'docs/api.md', 40),
    crossEdge('tools/run.ts', 'src/a.ts', 20),
  ]
  const previous = layoutFolderGeometry(entries, [], { ...SIZE, currentPath: '', allEdges })
  /* 第二帧：多了两个文件节点（接触过），布局必然不同。 */
  const nextEntries: MapEntry[] = [...entries, fileEntry('index.ts'), fileEntry('tsconfig.json')]
  const next = layoutFolderGeometry(nextEntries, [], { ...SIZE, currentPath: '', allEdges })
  return { previous, next }
}

/** 参考实现：每条边两端坐标的**期望**（从当前帧 nodes/hubs 查表）。 */
function expectedEndpoints(frame: FolderGeometry): Map<string, { x1: number; y1: number; x2: number; y2: number }> {
  const nodes = new Map(frame.nodes.map((node) => [node.path.toLowerCase(), node]))
  const hubs = new Map(frame.hubs.map((hub) => [hub.path.toLowerCase(), hub]))
  const expected = new Map<string, { x1: number; y1: number; x2: number; y2: number }>()
  for (const edge of frame.hubEdges) {
    const hub = hubs.get(edge.hubPath.toLowerCase())
    const node = nodes.get(edge.filePath.toLowerCase())
    if (hub === undefined || node === undefined) continue
    expected.set('hub:' + edge.hubPath + '>' + edge.filePath, { x1: hub.x, y1: hub.y, x2: node.x, y2: node.y })
  }
  for (const pair of frame.hubPairs) {
    const a = hubs.get(pair.aPath.toLowerCase())
    const b = hubs.get(pair.bPath.toLowerCase())
    if (a === undefined || b === undefined) continue
    expected.set('pair:' + pair.key, { x1: a.x, y1: a.y, x2: b.x, y2: b.y })
  }
  return expected
}

/* ================================================================== *
 * 1. 端点偏差（核心不变量）
 * ================================================================== */

test('夹具自检：两帧都真的有 hub 边与 hub-pair 边（否则下面的断言是空转）', () => {
  const { previous, next } = twoFrames()
  for (const [name, frame] of [['previous', previous], ['next', next]] as const) {
    assert.ok(frame.hubEdges.length > 0, name + ' 必须有枢纽聚合边')
    assert.ok(frame.hubPairs.length > 0, name + ' 必须有枢纽间连线（这条正是旧实现漏掉的一类）')
  }
})

test('五个采样点：每条边端点与两端节点当前坐标的偏差严格为 0', () => {
  const { previous, next } = twoFrames()
  for (const progress of SAMPLES) {
    const frame = interpolateGeometry(previous, next, progress)
    const expected = expectedEndpoints(frame)
    for (const sample of collectEdgeEndpoints(frame)) {
      const want = expected.get(sample.key)
      assert.ok(want !== undefined, 'p=' + String(progress) + ' 出现无法解释的边：' + sample.key)
      assert.equal(sample.x1, want.x1, 'p=' + String(progress) + ' ' + sample.key + ' x1')
      assert.equal(sample.y1, want.y1, 'p=' + String(progress) + ' ' + sample.key + ' y1')
      assert.equal(sample.x2, want.x2, 'p=' + String(progress) + ' ' + sample.key + ' x2')
      assert.equal(sample.y2, want.y2, 'p=' + String(progress) + ' ' + sample.key + ' y2')
    }
    const deviation = edgeEndpointDeviation(frame)
    assert.ok(deviation <= 0.75, 'p=' + String(progress) + ' 偏差 ' + String(deviation) + ' 超过容差')
    assert.equal(deviation, 0, 'p=' + String(progress) + ' 偏差必须严格为 0（端点由同一份坐标派生）')
  }
})

test('hub-pair 边（文件夹↔文件夹）也逐帧跟着走 —— 旧实现漏的正是这一类', () => {
  const { previous, next } = twoFrames()
  const mid = interpolateGeometry(previous, next, 0.5)
  assert.ok(mid.hubPairs.length > 0)
  const a = mid.hubs.find((hub) => hub.path === mid.hubPairs[0].aPath)
  const b = mid.hubs.find((hub) => hub.path === mid.hubPairs[0].bPath)
  assert.ok(a !== undefined && b !== undefined)
  assert.equal(mid.hubPairs[0].x1, a.x, '枢纽间线起点必须等于枢纽 A 当前 x')
  assert.equal(mid.hubPairs[0].y1, a.y, '枢纽间线起点必须等于枢纽 A 当前 y')
  assert.equal(mid.hubPairs[0].x2, b.x, '枢纽间线终点必须等于枢纽 B 当前 x')
  assert.equal(mid.hubPairs[0].y2, b.y, '枢纽间线终点必须等于枢纽 B 当前 y')

  /* 反证：布局时存下的静态端点**不等于**中途坐标（否则这条测试是空转）。 */
  const staticPair = next.hubPairs[0]
  const movedA = mid.hubs.find((hub) => hub.path === staticPair.aPath)
  assert.ok(movedA !== undefined)
  assert.notEqual(mid.hubPairs[0].x1, staticPair.x1, '中途坐标必须已经离开布局时的静态端点')
})

/* ================================================================== *
 * 2. 同一 key 的节点做位置插值（不是淡出再淡入）
 * ================================================================== */

test('同一 key 的节点在两个快照之间做线性位置插值', () => {
  const { previous, next } = twoFrames()
  const shared = next.nodes.filter((node) => previous.nodes.some((before) => before.path === node.path))
  assert.ok(shared.length > 0, '两帧必须有共同节点（否则测的是别的东西）')

  const half = interpolateGeometry(previous, next, 0.5)
  for (const node of shared) {
    const before = previous.nodes.find((candidate) => candidate.path === node.path)
    assert.ok(before !== undefined)
    const middle = half.nodes.find((candidate) => candidate.path === node.path)
    assert.ok(middle !== undefined)
    const wantX = Math.round(((before.x + node.x) / 2) * 100) / 100
    const wantY = Math.round(((before.y + node.y) / 2) * 100) / 100
    assert.equal(middle.x, wantX, node.path + ' 的中点 x 必须是两端平均')
    assert.equal(middle.y, wantY, node.path + ' 的中点 y 必须是两端平均')
  }
})

test('progress=0 在旧位置、progress=1 与新快照**完全相等**（引用相等）', () => {
  const { previous, next } = twoFrames()
  const shared = next.nodes.find((node) => previous.nodes.some((before) => before.path === node.path))
  assert.ok(shared !== undefined)

  const atZero = interpolateGeometry(previous, next, 0)
  const zero = atZero.nodes.find((node) => node.path === shared.path)
  const before = previous.nodes.find((node) => node.path === shared.path)
  assert.ok(zero !== undefined && before !== undefined)
  assert.equal(zero.x, before.x, 'p=0 必须停在旧位置')
  assert.equal(zero.y, before.y, 'p=0 必须停在旧位置')

  const atOne = interpolateGeometry(previous, next, 1)
  assert.equal(atOne, next, 'p=1 必须返回 next 本身（不是插值近似）')
  assert.deepEqual(atOne, next, 'p=1 必须与 next 逐字段相等')
})

/* ================================================================== *
 * 3. 新节点 / 缺旧快照：不产生 NaN，起点合理
 * ================================================================== */

test('新节点不会产生 NaN，且从画布中心起步', () => {
  const { previous, next } = twoFrames()
  const fresh = next.nodes.filter((node) => !previous.nodes.some((before) => before.path === node.path))
  assert.ok(fresh.length > 0, 'next 必须包含 previous 没有的新节点（否则测不到这条）')

  const origin = enterOrigin(next)
  for (const progress of SAMPLES) {
    const frame = interpolateGeometry(previous, next, progress)
    for (const node of frame.nodes) {
      assert.ok(Number.isFinite(node.x), 'p=' + String(progress) + ' ' + node.path + ' x 必须是有限数')
      assert.ok(Number.isFinite(node.y), 'p=' + String(progress) + ' ' + node.path + ' y 必须是有限数')
      assert.ok(Number.isFinite(node.r), 'p=' + String(progress) + ' ' + node.path + ' r 必须是有限数')
    }
    for (const hub of frame.hubs) {
      assert.ok(Number.isFinite(hub.x) && Number.isFinite(hub.y), '枢纽坐标不得是 NaN')
      assert.ok(Number.isFinite(hub.width) && Number.isFinite(hub.height), '枢纽尺寸不得是 NaN')
    }
    for (const edge of [...frame.hubEdges, ...frame.hubPairs]) {
      for (const value of [edge.x1, edge.y1, edge.x2, edge.y2]) {
        assert.ok(Number.isFinite(value), '边端点不得是 NaN')
      }
    }
  }

  /* 新节点：p=0 落在画布中心，p=1 落在目标位置。 */
  const atZero = interpolateGeometry(previous, next, 0)
  for (const node of fresh) {
    const zero = atZero.nodes.find((candidate) => candidate.path === node.path)
    assert.ok(zero !== undefined)
    assert.equal(zero.x, origin.x, node.path + ' 新节点必须从画布中心 x 起步')
    assert.equal(zero.y, origin.y, node.path + ' 新节点必须从画布中心 y 起步')
    assert.equal(zero.r, node.r, node.path + ' 新节点半径直接取目标值（不从 0 长出来）')
  }
})

test('缺旧快照（previous = null）：直接返回 next，不做假动画', () => {
  const { next } = twoFrames()
  for (const progress of SAMPLES) {
    assert.equal(interpolateGeometry(null, next, progress), next, 'p=' + String(progress) + ' 必须原样返回 next')
  }
})

/* ================================================================== *
 * 4. 缓动
 * ================================================================== */

test('easeLayout 端点精确、单调递增、不过冲', () => {
  assert.equal(easeLayout(0), 0)
  assert.equal(easeLayout(1), 1)
  let last = -1
  for (let step = 0; step <= 100; step += 1) {
    const value = easeLayout(step / 100)
    assert.ok(value >= last, '缓动必须单调递增')
    assert.ok(value >= 0 && value <= 1, '缓动不得越出 [0,1]')
    last = value
  }
  /* ease-out 特征：前 1/4 时间已经走掉一半以上路程。 */
  assert.ok(easeLayout(0.25) > 0.5, 'ease-out 前段必须更快：' + String(easeLayout(0.25)))
})

test('easeLayout 对越界输入也不产生 NaN（防御性）', () => {
  for (const value of [-1, 2, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    const eased = easeLayout(value)
    assert.ok(Number.isFinite(eased), '输入 ' + String(value) + ' 的缓动结果必须是有限数')
    assert.ok(eased >= 0 && eased <= 1, '越界输入必须被夹到 [0,1]')
  }
})

/* ================================================================== *
 * 5. 反向：偏差工具真的能抓出错位（否则它是空断言）
 * ================================================================== */

test('反向：把边端点钉回静态值，偏差工具必须点名非 0', () => {
  const { previous, next } = twoFrames()
  const frame = interpolateGeometry(previous, next, 0.5)
  assert.equal(edgeEndpointDeviation(frame), 0, '正确帧必须是 0')

  /* 模拟"读了布局时存下的静态端点"：把端点换回 next 的静态值。 */
  const broken: FolderGeometry = {
    ...frame,
    hubPairs: frame.hubPairs.map((pair) => {
      const staticPair = next.hubPairs.find((candidate) => candidate.key === pair.key)
      return staticPair === undefined
        ? pair
        : { ...pair, x1: staticPair.x1, y1: staticPair.y1, x2: staticPair.x2, y2: staticPair.y2 }
    }),
    hubEdges: frame.hubEdges.map((edge) => {
      const staticEdge = next.hubEdges.find(
        (candidate) => candidate.hubPath === edge.hubPath && candidate.filePath === edge.filePath,
      )
      return staticEdge === undefined
        ? edge
        : { ...edge, x1: staticEdge.x1, y1: staticEdge.y1, x2: staticEdge.x2, y2: staticEdge.y2 }
    }),
  }
  const deviation = edgeEndpointDeviation(broken)
  assert.ok(deviation > 0.75, '把端点钉回静态值后偏差必须爆表，实际 ' + String(deviation))
})
