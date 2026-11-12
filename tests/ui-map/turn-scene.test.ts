/*
 * tests/ui-map/turn-scene.test.ts —— **轮次图也要走同一个几何时钟**（P3 修复）。
 *
 * ## 真机反馈
 *
 * 「轮次图：关系线先出现并且固定，然后节点才连上去，非常丑」。
 * 用户明确了期望：「我要像点击卡片加载关系一样的那个加载动画」（= folder 图的效果）。
 *
 * ## 根因
 *
 * `FileGraph.ts`（TurnMap）**从来没有接过 `useSceneFrame`**：
 * - 边用**新坐标直接渲染** → 「先出现且定住」；
 * - 节点只有 CSS 入场动画（淡入/位移）→ 「再连过去」。
 *
 * 而 `FolderMap` 在 P2 已接上内核，换目录时节点+卡片+三类边从**同一帧**一起形变。
 *
 * ## 修复
 *
 * 把 `sceneClock.ts` 的内核抽象成「按 key 的节点坐标快照」（`NodeFrame`），
 * 轮次图提供自己的两个薄适配器（`nodeFramesOfGraph` / `projectGraphFrame`），
 * 与 folder 图共用同一条 rAF 时间轴。边端点从**当前帧 nodeMap** 现算，
 * 不许读 `layout.nodes[].x/y`（那是终点帧的静态值）。
 *
 * ## 这条套件守什么
 *
 * 1. 两份 `GraphLayout`（T1 / T2）之间的中间帧，端点偏差**严格为 0**；
 * 2. 节点做的是**位置插值**（有中间值，不是瞬移）；
 * 3. 新节点不产生 NaN；`progress=1` 与 `next` 逐字段相等；
 * 4. **反向**：把端点改回读静态 `layout.nodes`，偏差必须爆表（构造"若读静态值就会红"的用例）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PLUGIN_ROOT } from '../harness/styles-codegen.ts'
import {
  easeLayout,
  enterOrigin,
  interpolateNodeFrames,
  layoutFileGraph,
  nodeFrameEndpointDeviation,
  nodeFramesOfGraph,
  type GraphLayout,
  type GraphSourceFile,
  type NodeFrame,
  type RenderedEdge,
} from '../../src/client/ui/map/index.ts'

const SIZE = { width: 680, height: 420 }
const SAMPLES = [0, 0.25, 0.5, 0.75, 1] as const

function source(path: string, ops: number, lastAt = 1000): GraphSourceFile {
  return {
    path,
    name: path.slice(path.lastIndexOf('/') + 1),
    dir: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '',
    family: 'code',
    ops,
    firstAt: lastAt - 100,
    lastAt,
  }
}

/**
 * 两份**节点集合相同、位置不同**的轮次图（模拟 T1 → T2 切换）。
 *
 * 位置不同是关键：若边读静态坐标，中间帧必然对不上。
 * 怎么让它真的不同：径向布局按 **ops 降序**决定谁是中心/内环/中环/外环，
 * 所以把 ops 顺序**倒过来** → 同一批 path 落到不同环、不同角度。
 *
 * （第一版我只改了数值但保持顺序，布局结果一模一样 → 夹具自检直接报红，
 *   这是自检在干活：坐标相同的话，后面所有"中间帧"断言都是空转。）
 */
function twoTurnLayouts(): { t1: GraphLayout; t2: GraphLayout } {
  const files = [
    source('src/a.ts', 40),
    source('src/b.ts', 30),
    source('src/c.ts', 22),
    source('docs/guide.md', 16),
    source('docs/api.md', 12),
    source('tools/run.ts', 8),
  ]
  const t1 = layoutFileGraph(files, { ...SIZE, mode: 'turn' })
  /* T2：把 ops 顺序**倒序** → 中心/环位重排，同一批 path 的坐标全部改变。 */
  const reversed = files
    .slice()
    .reverse()
    .map((file, index) => ({ ...file, ops: 40 - index * 6 }))
  const t2 = layoutFileGraph(reversed, { ...SIZE, mode: 'turn' })
  return { t1, t2 }
}

/** 边列表（两端 path），模拟 `aggregateEdgePairs` 的产物。 */
const TURN_EDGES: ReadonlyArray<{ key: string; from: string; to: string }> = [
  { key: 'e1', from: 'src/a.ts', to: 'src/b.ts' },
  { key: 'e2', from: 'src/a.ts', to: 'docs/guide.md' },
  { key: 'e3', from: 'docs/api.md', to: 'tools/run.ts' },
  { key: 'e4', from: 'src/c.ts', to: 'src/b.ts' },
]

/**
 * **模拟渲染层**：像 `FileGraph` 那样，从当前帧 nodeMap 现算每条边的端点。
 *
 * 这正是 `FileGraph.ts` 里 `renderEdge` 做的事 —— 测试与产品同一口径。
 */
function renderEdges(frames: ReadonlyMap<string, NodeFrame>): RenderedEdge[] {
  const rendered: RenderedEdge[] = []
  for (const edge of TURN_EDGES) {
    const from = frames.get(edge.from.toLowerCase())
    const to = frames.get(edge.to.toLowerCase())
    if (from === undefined || to === undefined) continue
    rendered.push({ key: edge.key, from: edge.from, to: edge.to, x1: from.x, y1: from.y, x2: to.x, y2: to.y })
  }
  return rendered
}

/* ================================================================== *
 * 1. 夹具自检
 * ================================================================== */

test('夹具自检：两份轮次图的节点集合相同、坐标确实不同', () => {
  const { t1, t2 } = twoTurnLayouts()
  assert.ok(t1.nodes.length >= 4, 'T1 要有足够节点')
  assert.equal(t2.nodes.length, t1.nodes.length, '两份图的节点数应相同（同一批文件）')

  let moved = 0
  for (const before of t1.nodes) {
    const after = t2.nodes.find((node) => node.path === before.path)
    assert.ok(after !== undefined, '节点集合必须一致：' + before.path)
    if (Math.abs(after.x - before.x) > 1 || Math.abs(after.y - before.y) > 1) moved += 1
  }
  assert.ok(moved > 0, '两份图的坐标必须真的不同（否则下面的中间帧断言是空转），实际移动 ' + String(moved))
})

/* ================================================================== *
 * 2. 中间帧：端点偏差严格为 0
 * ================================================================== */

test('五个采样点：轮次图的边端点与两端节点当前坐标偏差严格为 0', () => {
  const { t1, t2 } = twoTurnLayouts()
  const previous = nodeFramesOfGraph(t1)
  const next = nodeFramesOfGraph(t2)
  const origin = enterOrigin(t2)

  for (const progress of SAMPLES) {
    const frames = interpolateNodeFrames(previous, next, progress, origin)
    const rendered = renderEdges(frames)
    assert.equal(rendered.length, TURN_EDGES.length, 'p=' + String(progress) + ' 每条边都要能解出两端')

    const deviation = nodeFrameEndpointDeviation(frames, rendered)
    assert.equal(deviation, 0, 'p=' + String(progress) + ' 端点偏差必须严格为 0，实际 ' + String(deviation))

    /* 逐条再核一遍（点名到具体边，失败时能一眼定位）。 */
    for (const edge of rendered) {
      const from = frames.get(edge.from.toLowerCase())
      const to = frames.get(edge.to.toLowerCase())
      assert.ok(from !== undefined && to !== undefined)
      assert.equal(edge.x1, from.x, 'p=' + String(progress) + ' ' + edge.key + ' x1')
      assert.equal(edge.y1, from.y, 'p=' + String(progress) + ' ' + edge.key + ' y1')
      assert.equal(edge.x2, to.x, 'p=' + String(progress) + ' ' + edge.key + ' x2')
      assert.equal(edge.y2, to.y, 'p=' + String(progress) + ' ' + edge.key + ' y2')
    }
  }
})

test('中途帧的端点确实在移动（不是"线固定住、节点才连过去"）', () => {
  const { t1, t2 } = twoTurnLayouts()
  const previous = nodeFramesOfGraph(t1)
  const next = nodeFramesOfGraph(t2)
  const origin = enterOrigin(t2)

  const start = renderEdges(interpolateNodeFrames(previous, next, 0, origin))
  const mid = renderEdges(interpolateNodeFrames(previous, next, 0.5, origin))
  const end = renderEdges(interpolateNodeFrames(previous, next, 1, origin))

  /* 至少一条边的端点在起点/中点/终点三处互不相同 —— 这正是"线跟着动"。 */
  const movedAtMid = start.filter((edge, index) => {
    const middle = mid[index]
    return Math.abs(middle.x1 - edge.x1) > 0.5 || Math.abs(middle.y1 - edge.y1) > 0.5
  })
  assert.ok(movedAtMid.length > 0, '中间帧必须有边的端点已经移动（否则线是"固定住"的）')

  const movedToEnd = mid.filter((edge, index) => {
    const finish = end[index]
    return Math.abs(finish.x1 - edge.x1) > 0.5 || Math.abs(finish.y1 - edge.y1) > 0.5
  })
  assert.ok(movedToEnd.length > 0, '终点必须与中点不同（动画真的走到了新布局）')
})

/* ================================================================== *
 * 3. 位置插值（不是瞬移）
 * ================================================================== */

test('同一 key 的节点在两个快照之间做位置插值', () => {
  const { t1, t2 } = twoTurnLayouts()
  const previous = nodeFramesOfGraph(t1)
  const next = nodeFramesOfGraph(t2)
  const origin = enterOrigin(t2)
  const half = interpolateNodeFrames(previous, next, 0.5, origin)

  let checked = 0
  for (const [key, frame] of next) {
    const before = previous.get(key)
    if (before === undefined) continue
    if (Math.abs(before.x - frame.x) < 1 && Math.abs(before.y - frame.y) < 1) continue
    const middle = half.get(key)
    assert.ok(middle !== undefined)
    const wantX = Math.round(((before.x + frame.x) / 2) * 100) / 100
    const wantY = Math.round(((before.y + frame.y) / 2) * 100) / 100
    assert.equal(middle.x, wantX, key + ' 的中点 x 必须是两端平均')
    assert.equal(middle.y, wantY, key + ' 的中点 y 必须是两端平均')
    checked += 1
  }
  assert.ok(checked > 0, '必须至少有一个节点真的移动过（否则测的是别的东西）')
})

test('progress=0 在旧位置、progress=1 与 next 逐字段相等', () => {
  const { t1, t2 } = twoTurnLayouts()
  const previous = nodeFramesOfGraph(t1)
  const next = nodeFramesOfGraph(t2)
  const origin = enterOrigin(t2)

  const atZero = interpolateNodeFrames(previous, next, 0, origin)
  for (const [key, before] of previous) {
    const zero = atZero.get(key)
    assert.ok(zero !== undefined, 'p=0 必须包含旧快照里的节点：' + key)
    assert.equal(zero.x, before.x, 'p=0 必须停在旧位置：' + key)
    assert.equal(zero.y, before.y, 'p=0 必须停在旧位置：' + key)
  }

  const atOne = interpolateNodeFrames(previous, next, 1, origin)
  assert.equal(atOne.size, next.size, 'p=1 必须与 next 节点数相同')
  for (const [key, frame] of next) {
    const one = atOne.get(key)
    assert.ok(one !== undefined)
    assert.equal(one.x, frame.x, 'p=1 必须与 next 逐字段相等：' + key)
    assert.equal(one.y, frame.y, 'p=1 必须与 next 逐字段相等：' + key)
    assert.equal(one.r, frame.r, 'p=1 必须与 next 逐字段相等：' + key)
  }
})

/* ================================================================== *
 * 4. 新节点 / 缺旧快照
 * ================================================================== */

test('新节点不产生 NaN，且从画布中心起步', () => {
  const { t1 } = twoTurnLayouts()
  const previous = nodeFramesOfGraph(t1)
  /* next：在同一批节点上追加两个新文件（模拟切到"文件更多"的轮次）。 */
  const more = [
    source('src/a.ts', 40),
    source('src/b.ts', 30),
    source('src/c.ts', 22),
    source('docs/guide.md', 16),
    source('docs/api.md', 12),
    source('tools/run.ts', 8),
    source('src/brand-new.ts', 5),
    source('docs/fresh.md', 3),
  ]
  const next = nodeFramesOfGraph(layoutFileGraph(more, { ...SIZE, mode: 'turn' }))
  const origin = enterOrigin({ width: SIZE.width, height: SIZE.height })

  const fresh = [...next.keys()].filter((key) => !previous.has(key))
  assert.ok(fresh.length > 0, 'next 必须包含旧快照没有的新节点（否则测不到这条）')

  for (const progress of SAMPLES) {
    const frames = interpolateNodeFrames(previous, next, progress, origin)
    for (const [key, frame] of frames) {
      assert.ok(Number.isFinite(frame.x), 'p=' + String(progress) + ' ' + key + ' x 必须是有限数')
      assert.ok(Number.isFinite(frame.y), 'p=' + String(progress) + ' ' + key + ' y 必须是有限数')
      assert.ok(Number.isFinite(frame.r), 'p=' + String(progress) + ' ' + key + ' r 必须是有限数')
    }
  }

  const atZero = interpolateNodeFrames(previous, next, 0, origin)
  for (const key of fresh) {
    const zero = atZero.get(key)
    assert.ok(zero !== undefined)
    assert.equal(zero.x, origin.x, key + ' 新节点必须从画布中心 x 起步')
    assert.equal(zero.y, origin.y, key + ' 新节点必须从画布中心 y 起步')
  }
})

test('缺旧快照（previous = null）：直接到终点，不做假动画', () => {
  const { t2 } = twoTurnLayouts()
  const next = nodeFramesOfGraph(t2)
  const origin = enterOrigin(t2)
  for (const progress of SAMPLES) {
    const frames = interpolateNodeFrames(null, next, progress, origin)
    for (const [key, frame] of next) {
      const got = frames.get(key)
      assert.ok(got !== undefined)
      assert.equal(got.x, frame.x, 'p=' + String(progress) + ' 无旧快照时必须原样：' + key)
      assert.equal(got.y, frame.y, 'p=' + String(progress) + ' 无旧快照时必须原样：' + key)
    }
  }
})

/* ================================================================== *
 * 5. 反向：读静态布局坐标必须被抓出来
 * ================================================================== */

test('反向：把端点改回读 layout.nodes 静态坐标，偏差必须爆表', () => {
  const { t1, t2 } = twoTurnLayouts()
  const previous = nodeFramesOfGraph(t1)
  const next = nodeFramesOfGraph(t2)
  const origin = enterOrigin(t2)
  const frames = interpolateNodeFrames(previous, next, 0.5, origin)

  /* 正确做法：端点取当前帧 → 偏差 0。 */
  const correct = renderEdges(frames)
  assert.equal(nodeFrameEndpointDeviation(frames, correct), 0, '正确帧必须是 0')

  /* 错误做法（旧实现）：端点取终点帧的静态坐标。 */
  const staticByPath = new Map<string, { x: number; y: number }>()
  for (const node of t2.nodes) staticByPath.set(node.path.toLowerCase(), { x: node.x, y: node.y })
  const broken: RenderedEdge[] = []
  for (const edge of TURN_EDGES) {
    const from = staticByPath.get(edge.from.toLowerCase())
    const to = staticByPath.get(edge.to.toLowerCase())
    if (from === undefined || to === undefined) continue
    broken.push({ key: edge.key, from: edge.from, to: edge.to, x1: from.x, y1: from.y, x2: to.x, y2: to.y })
  }
  const deviation = nodeFrameEndpointDeviation(frames, broken)
  assert.ok(deviation > 0.5, '把端点改回静态坐标后偏差必须爆表，实际 ' + String(deviation))
})

test('反向：reduced-motion 下进度直接到终点（不产生中间值）', () => {
  /* `easeLayout` 是 rAF 侧唯一的缓动入口；时钟在 reduced-motion 时不排帧，
   * 直接写 target，所以这里只确认缓动端点精确（间接保证终点无残差）。 */
  assert.equal(easeLayout(1), 1)
  const { t2 } = twoTurnLayouts()
  const next = nodeFramesOfGraph(t2)
  const origin = enterOrigin(t2)
  const frames = interpolateNodeFrames(nodeFramesOfGraph(t2), next, 1, origin)
  for (const [key, frame] of next) {
    assert.equal(frames.get(key)?.x, frame.x, '终点必须精确：' + key)
  }
})

/* ================================================================== *
 * 6. 渲染层接线：FileGraph 必须真的用当前帧（源码级，反向可抓）
 * ================================================================== *
 *
 * 为什么需要这一层：上面 1–5 测的是**纯函数**，它们无论如何都绿 ——
 * 哪怕 `FileGraph` 把边端点改回读 `layout.nodes`（终点帧静态坐标），
 * 纯函数测试也看不出来。而"线不跟节点走"恰恰是渲染层的接线错误。
 *
 * 所以这里直接对源码做断言：边端点必须取自 `nodeByKey`（= renderedLayout，当前帧），
 * 并且 `FileGraph` 必须真的接入了 `useNodeFrames`。
 */
const FILE_GRAPH_SRC = readFileSync(join(PLUGIN_ROOT, 'src', 'client', 'ui', 'map', 'FileGraph.ts'), 'utf8')
const FILE_GRAPH_CODE = FILE_GRAPH_SRC.replace(/\/\*[\s\S]*?\*\//g, '')

test('FileGraph 真的接入了唯一几何时钟（useNodeFramesState + 轮次图适配器）', () => {
  assert.match(FILE_GRAPH_CODE, /useNodeFramesState<GraphLayout>\(/, '轮次图必须用同一个 rAF 时钟')
  assert.match(FILE_GRAPH_CODE, /nodeFramesOfGraph/, '必须用轮次图的帧适配器')
  assert.match(FILE_GRAPH_CODE, /projectGraphFrame/, '必须用统一的帧投影（不自己拼坐标）')
  assert.match(FILE_GRAPH_CODE, /restartOn: 'turn:' \+ String\(props\.turn\?\.turn\.n/, '视图身份 = 轮次号（换轮次 = 全新入场）')
})

test('FileGraph 的边端点取自**当前帧**（nodeByKey），不是静态 layout（turnNodeByKey）', () => {
  /* 定位边渲染那段（`h('line'` 之前的端点解算）。 */
  const lineAt = FILE_GRAPH_CODE.indexOf("className: 'tl-graph-edge'")
  assert.ok(lineAt > 0, '必须能找到边渲染位置')
  const window = FILE_GRAPH_CODE.slice(Math.max(0, lineAt - 900), lineAt)
  assert.match(window, /const from = nodeByKey\.get\(caseKey\(fromPath\)\)/, '边起点必须取当前帧 nodeByKey')
  assert.match(window, /const to = nodeByKey\.get\(caseKey\(toPath\)\)/, '边终点必须取当前帧 nodeByKey')
  assert.equal(
    /const from = turnNodeByKey\.get/.test(window),
    false,
    '边起点**不得**取静态 layout（这正是"线先出现并固定"的根因）',
  )
  assert.equal(
    /const to = turnNodeByKey\.get/.test(window),
    false,
    '边终点**不得**取静态 layout（这正是"线先出现并固定"的根因）',
  )
})

test('nodeByKey 由 renderedLayout 建立（不是原始 layout）', () => {
  assert.match(
    FILE_GRAPH_CODE,
    /for \(const node of renderedLayout\.nodes\) map\.set\(caseKey\(node\.path\), node\)/,
    'nodeByKey 必须来自当前帧 renderedLayout',
  )
})

test('标签位置也走同一帧（placeLabels 的输入是 renderedLayout）', () => {
  assert.match(
    FILE_GRAPH_CODE,
    /for \(const node of renderedLayout\.nodes\) \{/,
    '标签候选必须按当前帧坐标算（否则文字与圆点分离）',
  )
})
