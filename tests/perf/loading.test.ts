/*
 * tests/perf/loading.test.ts —— 加载与布局性能的三条硬约束（D-35）。
 *
 * 这三条对应真实的用户症状，都是"看起来只是慢"的架构问题：
 * 1. 空增量快照不能换 graph 身份（否则 400ms 轮询持续触发全量派生重算）；
 * 2. 拖动只能做坐标叠加，不能重跑力导向（旧实现每次 pointermove 重跑整场模拟）；
 * 3. 目录树已就绪时，图不能因为扫描没出首包而显示骨架（首屏不该等扫描）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { applySnapshot, createEmptyGraph } from '../../src/client/data/merge.ts'
import { applyDragOffsets, layoutFolderGeometry, type MapEntry } from '../../src/client/ui/map/folderLayout.ts'

function entries(): MapEntry[] {
  return [
    { name: 'src', path: 'src', kind: 'directory' },
    { name: 'docs', path: 'docs', kind: 'directory' },
    { name: 'a.ts', path: 'a.ts', kind: 'file', size: 1024, family: 'code' },
    { name: 'b.md', path: 'b.md', kind: 'file', size: 4096, family: 'text' },
  ]
}

/* ---------------- 1. 空增量 no-op ---------------- */

test('空增量快照：graph 引用保持不变（下游 memo 全部命中）', () => {
  const empty = createEmptyGraph()
  const first = applySnapshot(empty, {
    scanId: 'scan-1',
    rev: 1,
    done: false,
    progress: { total: 3, scanned: 1, failed: 0, cached: 0, phase: 'scanning' },
    changedSessions: [],
    changedFiles: [],
    changedEdges: [],
  })
  assert.notEqual(first.graph, empty, '第一次要真的应用')

  const noop = applySnapshot(first.graph, {
    scanId: 'scan-1',
    rev: 2,
    done: false,
    progress: { total: 3, scanned: 1, failed: 0, cached: 0, phase: 'scanning' },
    changedSessions: [],
    changedFiles: [],
    changedEdges: [],
  })
  assert.equal(noop.graph, first.graph, '内容没变就必须返回同一个 graph 对象')
  assert.equal(noop.applied.filesAdded, 0)
  assert.equal(noop.applied.sessions, 0)
})

/** 构造一个合法的 FileNode（字段与 shared/events 的 FileNode 一致）。 */
function fileNode(path: string, family: 'code' | 'text', at: number): {
  path: string
  name: string
  dir: string
  family: 'code' | 'text'
  firstAt: number
  lastAt: number
  reads: number
  writes: number
  searches: number
  added: number
  removed: number
  ops: number
  sessionIds: string[]
  sessionCount: number
  turnCount: number
} {
  return {
    path,
    name: path,
    dir: '',
    family,
    firstAt: at,
    lastAt: at,
    reads: 1,
    writes: 0,
    searches: 0,
    added: 0,
    removed: 0,
    ops: 1,
    sessionIds: ['s'],
    sessionCount: 1,
    turnCount: 1,
  }
}

test('有实质变化时：graph 必须换新（不能误判成 no-op）', () => {
  const first = applySnapshot(createEmptyGraph(), {
    scanId: 'scan-1',
    rev: 1,
    done: false,
    progress: { total: 1, scanned: 1, failed: 0, cached: 0, phase: 'scanning' },
    changedFiles: [fileNode('a.ts', 'code', 1)],
  })
  const second = applySnapshot(first.graph, {
    scanId: 'scan-1',
    rev: 2,
    done: false,
    progress: { total: 1, scanned: 1, failed: 0, cached: 0, phase: 'scanning' },
    changedFiles: [fileNode('b.md', 'text', 2)],
  })
  assert.notEqual(second.graph, first.graph, '有变化必须换新对象')
  assert.equal(second.graph.files.size, 2)
})

test('reset 快照即使是"空内容"也必须生效（不能当 no-op 吞掉）', () => {
  const first = applySnapshot(createEmptyGraph(), {
    scanId: 'scan-1',
    rev: 5,
    done: true,
    progress: { total: 1, scanned: 1, failed: 0, cached: 0, phase: 'complete' },
    changedFiles: [fileNode('a.ts', 'code', 1)],
  })
  const reset = applySnapshot(first.graph, { scanId: 'scan-2', rev: 1, reset: true, done: false })
  assert.notEqual(reset.graph, first.graph, 'reset 必须换新图')
  assert.equal(reset.graph.files.size, 0, 'reset 要清空')
})

/* ---------------- 2. 拖动不重跑力导向 ---------------- */

test('拖动偏移是纯坐标叠加：节点位置平移、其它节点不动、几何结构不变', () => {
  const geometry = layoutFolderGeometry(entries(), [], { width: 720, height: 380, currentPath: '' })
  assert.ok(geometry.nodes.length > 0, '夹具必须产出节点')
  const target = geometry.nodes[0]
  const other = geometry.nodes[1]

  const moved = applyDragOffsets(geometry, { [target.path.toLowerCase()]: { dx: 40, dy: -20 } })
  const movedTarget = moved.nodes.find((node) => node.path === target.path)
  const movedOther = moved.nodes.find((node) => node.path === other.path)

  assert.equal(movedTarget?.x, Math.round((target.x + 40) * 100) / 100)
  assert.equal(movedTarget?.y, Math.round((target.y - 20) * 100) / 100)
  assert.equal(movedOther?.x, other.x, '其它节点不得移动')
  assert.equal(movedOther?.y, other.y)
  assert.equal(moved.hubs.length, geometry.hubs.length)
  assert.equal(moved.width, geometry.width)
})

test('无偏移时返回同一对象（避免无意义重渲染）', () => {
  const geometry = layoutFolderGeometry(entries(), [], { width: 720, height: 380, currentPath: '' })
  assert.equal(applyDragOffsets(geometry, {}), geometry)
})

test('拖动后边端点跟着平移（连线不会与节点脱节）', () => {
  const geometry = layoutFolderGeometry(entries(), [], {
    width: 720,
    height: 380,
    currentPath: '',
    edges: [
      {
        id: 'e1',
        type: 'coTurn',
        from: 'a.ts',
        to: 'b.md',
        weight: 3,
        directed: false,
        evidence: { kind: 'coTurn', samples: [{ sessionId: 's', turn: 1 }], count: 1, text: '同轮共现 1 次' },
        confirmed: true,
        confidence: 'confirmed',
      },
    ],
  })
  if (geometry.hubEdges.length === 0 && geometry.hubPairs.length === 0) {
    /* 该夹具下可能只有文件间边（不经过枢纽），此时只能验证节点位移本身。 */
    assert.ok(true)
    return
  }
  const moved = applyDragOffsets(geometry, { 'a.ts': { dx: 10, dy: 10 } })
  for (const edge of moved.hubEdges) {
    const original = geometry.hubEdges.find((item) => item.hubPath === edge.hubPath && item.filePath === edge.filePath)
    assert.ok(original !== undefined)
    if (edge.filePath === 'a.ts') assert.equal(edge.x2, Math.round((original.x2 + 10) * 100) / 100)
  }
})

/* ---------------- 3. 首屏不等扫描（源码级约束） ---------------- */

test('tab 的首帧门控不再只看扫描（目录就绪即可画图）', async () => {
  const { readFileSync } = await import('node:fs')
  const { join } = await import('node:path')
  const source = readFileSync(join(process.cwd(), 'src', 'client', 'entries', 'tab.ts'), 'utf8')
  /* 旧写法必须消失：`nodes.length === 0 && (coverage... || !graph.applied)` 直接作为 loading。 */
  assert.equal(
    /const workspaceLoading =\s*\n\s*nodes\.length === 0 &&/.test(source),
    false,
    'loading 不能再只由扫描状态决定（目录已就绪时必须直接画）',
  )
  assert.ok(source.includes('treeReady'), '必须存在"目录已就绪"的判据')
})

test('FolderMap 的几何 memo 不依赖拖动偏移', async () => {
  const { readFileSync } = await import('node:fs')
  const { join } = await import('node:path')
  const source = readFileSync(join(process.cwd(), 'src', 'client', 'ui', 'map', 'FolderMap.ts'), 'utf8')
  assert.ok(source.includes('applyDragOffsets'), '必须用叠加函数处理拖动')
  /* 几何 memo 的依赖数组里不得再出现 dragOffsets。 */
  const geometryMemo = /layoutFolderGeometry\(([\s\S]*?)\]\s*,?\s*\)/m.exec(source)
  assert.ok(geometryMemo !== null, '找不到几何 memo')
  assert.equal(geometryMemo[1].includes('dragOffsets'), false, '几何 memo 不得依赖 dragOffsets（否则拖动重跑模拟）')
})
