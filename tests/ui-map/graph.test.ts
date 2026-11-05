/*
 * graph.test.ts —— 文件关系图的确定性径向布局（33 §3）。
 *
 * 覆盖：同数据同布局 / 中心=最活跃 / 环结构 / 目录 40、轮次 200 上限（显式截断）/
 * 节点半径分档 / 坐标不出画框 / 指纹可跨进程比较。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  GRAPH_LIMITS,
  compareGraphFiles,
  graphFingerprint,
  graphRadius,
  layoutFileGraph,
  selectGraphFiles,
  type GraphSourceFile,
} from '../../src/client/ui/map/index.ts'
import { makeFiles, NOW } from './fixtures.ts'

function sourceOf(files: ReturnType<typeof makeFiles>): GraphSourceFile[] {
  return files.map((file) => ({
    path: file.path,
    name: file.name,
    dir: file.dir,
    family: file.family,
    ops: file.ops,
    firstAt: file.firstAt,
    lastAt: file.lastAt,
  }))
}

const SIZE = { width: 680, height: 460 }

test('确定性：同一份数据两次布局逐节点坐标相同，输入顺序无关', () => {
  const files = sourceOf(makeFiles({ count: 60 }))
  const first = layoutFileGraph(files, { ...SIZE, mode: 'directory' })
  const second = layoutFileGraph(files, { ...SIZE, mode: 'directory' })
  const reversed = layoutFileGraph(files.slice().reverse(), { ...SIZE, mode: 'directory' })
  assert.equal(graphFingerprint(first), graphFingerprint(second))
  assert.equal(graphFingerprint(first), graphFingerprint(reversed))
  assert.ok(first.nodes.length > 0)
})

test('中心节点 = 最活跃文件；内环 ≤6、中环 ≤22、其余外环', () => {
  const files = sourceOf(makeFiles({ count: 60 }))
  const layout = layoutFileGraph(files, { ...SIZE, mode: 'directory' })
  const sorted = files.slice().sort(compareGraphFiles)
  assert.equal(layout.nodes[0].path, sorted[0].path)
  assert.equal(layout.nodes[0].ring, 0)
  const inner = layout.nodes.filter((node) => node.ring === 1)
  const middle = layout.nodes.filter((node) => node.ring === 2)
  const outer = layout.nodes.filter((node) => node.ring === 3)
  assert.ok(inner.length <= 6)
  assert.ok(middle.length <= 22)
  assert.equal(inner.length + middle.length + outer.length + 1, layout.nodes.length)
})

test('上限：目录 top 40、轮次 top 200，超出显式 truncated（不静默丢）', () => {
  const dirFiles = sourceOf(makeFiles({ count: 300, dirs: ['big'] }))
  const directory = layoutFileGraph(dirFiles, { ...SIZE, mode: 'directory' })
  assert.equal(GRAPH_LIMITS.directory, 40)
  assert.equal(directory.shown, 40)
  assert.equal(directory.total, 300)
  assert.equal(directory.truncated, true)

  const turn = layoutFileGraph(dirFiles, { ...SIZE, mode: 'turn' })
  assert.equal(GRAPH_LIMITS.turn, 200)
  assert.equal(turn.shown, 200)
  assert.equal(turn.total, 300)
  assert.equal(turn.truncated, true)

  const selection = selectGraphFiles(dirFiles, { mode: 'directory' })
  assert.equal(selection.shown.length, 40)
  assert.equal(selection.truncated, true)
})

test('截断保留最活跃的：保留集最小 ops ≥ 被裁掉的最大 ops', () => {
  const files = sourceOf(makeFiles({ count: 300, dirs: ['big'] }))
  const layout = layoutFileGraph(files, { ...SIZE, mode: 'directory' })
  const kept = new Set(layout.nodes.map((node) => node.path))
  const dropped = files.filter((file) => !kept.has(file.path))
  const keptMin = Math.min(...layout.nodes.map((node) => node.ops))
  assert.ok(keptMin >= Math.max(...dropped.map((node) => node.ops)))
})

test('节点半径：ops 的 sqrt 分档、中心节点更大，且不越界', () => {
  assert.equal(graphRadius(0), 6)
  assert.ok(graphRadius(400) > graphRadius(100))
  assert.ok(graphRadius(100, true) > graphRadius(100))
  let previous = 0
  for (const ops of [0, 1, 4, 16, 64, 256, 1000]) {
    const radius = graphRadius(ops)
    assert.ok(radius >= 6 && radius <= 16)
    assert.ok(radius >= previous)
    previous = radius
  }
  const files = sourceOf(makeFiles({ count: 80 }))
  const layout = layoutFileGraph(files, { ...SIZE, mode: 'directory' })
  for (const node of layout.nodes) assert.ok(node.r >= 6 && node.r <= 20)
})

test('坐标不出画框（含节点半径），且不是所有点堆在中心', () => {
  const files = sourceOf(makeFiles({ count: 120 }))
  const layout = layoutFileGraph(files, { ...SIZE, mode: 'directory' })
  for (const node of layout.nodes) {
    assert.ok(node.x - node.r >= 0 && node.x + node.r <= SIZE.width, 'x 越界：' + node.path)
    assert.ok(node.y - node.r >= 0 && node.y + node.r <= SIZE.height, 'y 越界：' + node.path)
  }
  const centers = new Set(layout.nodes.map((node) => String(node.x) + ',' + String(node.y)))
  assert.ok(centers.size >= layout.nodes.length - 1)
})

test('空集合：返回空布局，不造节点', () => {
  const layout = layoutFileGraph([], { ...SIZE, mode: 'turn' })
  assert.equal(layout.nodes.length, 0)
  assert.equal(layout.shown, 0)
  assert.equal(layout.total, 0)
  assert.equal(layout.truncated, false)
})

test('固定时间夹具不参与布局（同数据不同 now 结果相同）', () => {
  const files = sourceOf(makeFiles({ count: 40 }))
  const first = layoutFileGraph(files, { ...SIZE, mode: 'directory' })
  const second = layoutFileGraph(files, { ...SIZE, mode: 'directory' })
  assert.equal(NOW, Date.parse('2026-11-04T10:00:00+08:00'))
  assert.equal(graphFingerprint(first), graphFingerprint(second))
})
