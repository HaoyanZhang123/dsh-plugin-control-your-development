/*
 * folder.test.ts —— 当前目录**关系图**的布局断言（R10 / 03 §4.2）。
 *
 * R10 变更（2026-11-08）：**旧网格断言全部删除**（等宽等距 / 文件夹带在上 / 文件网格在下 /
 * 「排序即网格行列」），因为网格布局已整体废除、单一执行路径。改为断言：
 * - 合并规则不变：entries + 会话文件、未触碰是中性节点、只收当前目录的直接文件；
 * - **关系图**：力导向坐标、不是网格、枢纽与文件用不同形状（圆角方卡 vs 圆点）；
 * - 上限与「显示全部」：40 档 / 全部档 / 硬上限，且 truncated/hardTruncated 如实标记；
 * - 标签：整词或隐藏（绝不截断）、选中/悬浮强制、「全部」档只标悬停/选中；
 * - 播放头只隐藏不重排；拖动只挪被拖的那个。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import type { GraphEdge } from '../../src/shared/relations/index.ts'
import {
  allModeRadiusScale,
  compareNames,
  computeHubPairs,
  familyOfName,
  folderNameOf,
  folderNodeRadius,
  hubPairPartnersFor,
  layoutFolder,
  layoutFolderGeometry,
  layoutFolderLabels,
  truncateHubPairs,
  FOLDER_HUB_HEIGHT,
  FOLDER_HUB_MAX_WIDTH,
  FOLDER_HUB_MIN_GAP,
  GRAPH_LIMITS,
  type MapEntry,
} from '../../src/client/ui/map/index.ts'
import { makeFiles } from './fixtures.ts'

const SIZE = { width: 680, height: 420 }

function fileEntry(path: string): MapEntry {
  return { name: path.slice(path.lastIndexOf('/') + 1), path, kind: 'file' }
}

function dirEntry(path: string): MapEntry {
  return { name: path.slice(path.lastIndexOf('/') + 1), path, kind: 'directory' }
}

/* ================================================================== *
 * 合并规则（不变）
 * ================================================================== */

test('合并：entries 的未触碰文件是中性节点；会话文件保留 ops 与族色', () => {
  const files = makeFiles({ count: 4, dirs: ['src'] })
  const untouched = { name: 'readme.txt', path: 'src/readme.txt', kind: 'file' as const }
  const entries = [...files.map((file) => fileEntry(file.path)), untouched]
  const layout = layoutFolder(entries, files.slice(0, 2), { ...SIZE, currentPath: 'src' })
  assert.equal(layout.nodes.length, 5)
  const neutral = layout.nodes.find((node) => node.path === 'src/readme.txt')
  assert.ok(neutral !== undefined)
  assert.equal(neutral.touched, false)
  assert.equal(neutral.ops, 0)
  assert.equal(neutral.family, 'text')
  const touched = layout.nodes.find((node) => node.path === files[0].path)
  assert.ok(touched !== undefined)
  assert.equal(touched.touched, true)
  assert.ok(touched.ops > 0)
})

test('合并：只收当前目录的直接文件，子目录文件不进图', () => {
  const files = makeFiles({ count: 6, dirs: ['src/client', 'src/host'] })
  const nested = files.find((file) => file.path.includes('src/client/'))
  assert.ok(nested !== undefined)
  const entries = [fileEntry('src/top.ts'), dirEntry('src/client')]
  const layout = layoutFolder(entries, files, { ...SIZE, currentPath: 'src' })
  assert.deepEqual(
    layout.nodes.map((node) => node.path),
    ['src/top.ts'],
    '只应有当前目录的直接文件',
  )
  assert.equal(layout.nodes.some((node) => node.path === nested.path), false, '子目录文件不该进当前目录图')
})

test('合并：会话数据里有的文件即使 entries 暂时没列到也保留（不丢已知节点）', () => {
  const files = makeFiles({ count: 3, dirs: ['src'] })
  const layout = layoutFolder([], files, { ...SIZE, currentPath: 'src' })
  assert.equal(layout.nodes.length, 3)
  assert.ok(layout.nodes.every((node) => node.touched))
  assert.equal(layout.hubCount, 0)
})

test('没有会话数据但有 entries：关系图仍画文件（不因未触碰而隐藏）', () => {
  const entries: MapEntry[] = [fileEntry('src/a.ts'), fileEntry('src/b.md'), dirEntry('src/sub')]
  const layout = layoutFolder(entries, [], { ...SIZE, currentPath: 'src' })
  assert.equal(layout.nodes.length, 2)
  assert.equal(layout.hubCount, 1)
  assert.equal(layout.empty, false)
  assert.ok(layout.nodes.every((node) => !node.touched))
})

/* ================================================================== *
 * 关系图（不是网格）
 * ================================================================== */

test('关系图：枢纽是**圆角方卡**、文件是**圆点**（不同形状表达层级，不再靠"排一条带"）', () => {
  const files = makeFiles({ count: 20, dirs: ['src'] })
  const entries = [...files.map((file) => fileEntry(file.path)), dirEntry('src/apps'), dirEntry('src/lib')]
  const layout = layoutFolder(entries, files, { ...SIZE, currentPath: 'src' })
  assert.equal(layout.hubs.length, 2)
  for (const hub of layout.hubs) {
    // 卡片：有宽高（且宽高不等）→ 用 <rect rx ry> 画成圆角方卡。
    assert.equal(hub.height, FOLDER_HUB_HEIGHT)
    assert.ok(hub.width >= 54, '卡片有宽度：' + hub.path)
    assert.ok(hub.width <= FOLDER_HUB_MAX_WIDTH)
  }
  for (const node of layout.nodes) {
    assert.ok(node.r > 0 && node.r < 20, '文件节点是圆点：' + node.path)
  }
  // 关键：枢纽与文件**不分区**（旧网格是"枢纽排一条带在上、文件网格在下"）。
  // 力导向下枢纽的 y 不会全部小于所有文件的 y —— 允许偶然，但要求至少一个文件在枢纽上方。
  const hubMinY = Math.min(...layout.hubs.map((hub) => hub.y))
  assert.ok(
    layout.nodes.some((node) => node.y < hubMinY),
    '有文件在枢纽上方 ⇒ 不是"枢纽一条带在上"的分区',
  )
})

test('关系图：有引力时相连的节点确实更靠近（位置由关系决定）', () => {
  // 造一个明确的强关系：a ↔ b 权重极高；其余边很弱。
  const files = makeFiles({ count: 12, dirs: ['src'] })
  const entries = files.map((file) => fileEntry(file.path))
  const target = files[0].path
  const partner = files[1].path
  const edges = [
    {
      id: 'e1',
      type: 'structure' as const,
      from: target,
      to: partner,
      weight: 50,
      directed: false,
      confirmed: true,
      confidence: 'estimated' as const,
      evidence: { kind: 'structure' as const, dir: 'src', text: '同属目录 src' },
    },
  ]
  const withEdge = layoutFolder(entries, files, { ...SIZE, currentPath: 'src', edges })
  const a = withEdge.nodes.find((node) => node.path === target)
  const b = withEdge.nodes.find((node) => node.path === partner)
  assert.ok(a !== undefined && b !== undefined)
  const linkedDistance = Math.hypot(a.x - b.x, a.y - b.y)
  // 与"任意两点的平均距离"比：有强边的一对应明显更近。
  const allDistances: number[] = []
  for (let left = 0; left < withEdge.nodes.length; left += 1) {
    for (let right = left + 1; right < withEdge.nodes.length; right += 1) {
      allDistances.push(
        Math.hypot(
          withEdge.nodes[left].x - withEdge.nodes[right].x,
          withEdge.nodes[left].y - withEdge.nodes[right].y,
        ),
      )
    }
  }
  const mean = allDistances.reduce((sum, value) => sum + value, 0) / allDistances.length
  assert.ok(linkedDistance < mean, '有强边的两点应比平均距离更近：' + linkedDistance.toFixed(1) + ' vs ' + mean.toFixed(1))
})

test('关系图：status 里没有"网格"常量泄漏（单一执行路径）', async () => {
  const mapModule = await import('../../src/client/ui/map/index.ts')
  const banned = ['FOLDER_CELL_HEIGHT', 'FOLDER_CELL_MIN_WIDTH', 'FOLDER_CELL_MAX_WIDTH', 'FOLDER_HUB_GAP', 'FOLDER_MARGIN']
  for (const name of banned) {
    assert.equal(name in mapModule, false, '网格常量必须删除：' + name)
  }
})

/* ================================================================== *
 * 上限与「显示全部」（03 §4.2.3）
 * ================================================================== */

test('40 档：>40 文件时按 ops 降序取前 40，并显式标记 truncated', () => {
  const files = makeFiles({ count: 300, dirs: ['src'] })
  const entries = files.map((file) => fileEntry(file.path))
  const layout = layoutFolder(entries, files, { ...SIZE, currentPath: 'src' })
  assert.equal(layout.limit, 40)
  assert.equal(layout.shownFiles, 40)
  assert.equal(layout.totalFiles, 300)
  assert.equal(layout.truncated, true)
  assert.equal(layout.showAll, false)
  const keptPaths = new Set(layout.nodes.map((node) => node.path))
  const keptOps = layout.nodes.map((node) => node.ops)
  const droppedOps = files.filter((file) => !keptPaths.has(file.path)).map((file) => file.ops)
  assert.ok(Math.min(...keptOps) >= Math.max(...droppedOps), '保留的必须是最活跃的')
})

test('全部档：showAll=true 时画全部（受 300 硬上限保护），并如实标记', () => {
  const files = makeFiles({ count: 137, dirs: ['src'] })
  const entries = files.map((file) => fileEntry(file.path))
  const all = layoutFolder(entries, files, { ...SIZE, currentPath: 'src', showAll: true })
  assert.equal(all.showAll, true)
  assert.equal(all.shownFiles, 137, '137 ≤ 硬上限 → 全部画出')
  assert.equal(all.truncated, false, '全部档且未超硬上限 → 不算截断')
  assert.equal(all.hardTruncated, false)
  assert.equal(all.limit, GRAPH_LIMITS.folderAllMax)
})

test('全部档硬上限：>300 文件时只画 300，并同时标记 truncated + hardTruncated（如实提示）', () => {
  const files = makeFiles({ count: 500, dirs: ['src'] })
  const entries = files.map((file) => fileEntry(file.path))
  const all = layoutFolder(entries, files, { ...SIZE, currentPath: 'src', showAll: true })
  assert.equal(all.shownFiles, GRAPH_LIMITS.folderAllMax)
  assert.equal(all.totalFiles, 500)
  assert.equal(all.hardTruncated, true, '全部档也要如实说"还有没画出来的"')
  assert.equal(all.truncated, true)
})

test('上限：选中/悬浮节点即使超出 40 档也强制可见', () => {
  const files = makeFiles({ count: 100, dirs: ['src'] })
  const entries = files.map((file) => fileEntry(file.path))
  const plain = layoutFolder(entries, files, { ...SIZE, currentPath: 'src' })
  assert.equal(plain.shownFiles, 40)
  // 找一个被挤掉的（低 ops）。
  const keptKeys = new Set(plain.nodes.map((node) => node.path.toLowerCase()))
  const dropped = files.find((file) => !keptKeys.has(file.path.toLowerCase()))
  assert.ok(dropped !== undefined)
  const withFocus = layoutFolder(entries, files, {
    ...SIZE,
    currentPath: 'src',
    selectedKey: dropped.path.toLowerCase(),
  })
  assert.equal(withFocus.shownFiles, 41, '被选中的节点必须被强制画出来')
  assert.ok(withFocus.nodes.some((node) => node.path === dropped.path))
})

test('全部档的自动降级：半径按 1/√n 缩一档（40 档不缩）', () => {
  const files = makeFiles({ count: 137, dirs: ['src'] })
  const entries = files.map((file) => fileEntry(file.path))
  const normal = layoutFolderGeometry(entries.slice(0, 40), files.slice(0, 40), { ...SIZE, currentPath: 'src' })
  const all = layoutFolderGeometry(entries, files, { ...SIZE, currentPath: 'src', showAll: true })
  assert.equal(all.nodes.length, 137)
  const samePath = normal.nodes[0].path
  const allSame = all.nodes.find((node) => node.path === samePath)
  assert.ok(allSame !== undefined)
  assert.ok(allSame.r < normal.nodes[0].r, '全部档半径应更小')
  assert.equal(allModeRadiusScale(137), Math.round(Math.sqrt(40 / 137) * 1000) / 1000)
})

test('全部档的自动降级：标签只标悬停/选中（不标全部）', () => {
  const files = makeFiles({ count: 80, dirs: ['src'] })
  const entries = files.map((file) => fileEntry(file.path))
  const normal = layoutFolder(entries, files, { ...SIZE, currentPath: 'src' })
  assert.ok(
    normal.labels.some((label) => label.visible),
    '40 档应该尽量全标（至少有一条可见）',
  )
  const all = layoutFolder(entries, files, { ...SIZE, currentPath: 'src', showAll: true })
  assert.equal(
    all.labels.filter((label) => label.visible).length,
    0,
    '全部档无焦点时不得画任何标签（只标悬停/选中）',
  )
  // 有焦点时只标那一个。
  const focused = layoutFolder(entries, files, {
    ...SIZE,
    currentPath: 'src',
    showAll: true,
    selectedKey: files[0].path.toLowerCase(),
  })
  const visible = focused.labels.filter((label) => label.visible)
  assert.equal(visible.length, 1)
  assert.equal(visible[0].path, files[0].path)
})

/* ================================================================== *
 * 标签
 * ================================================================== */

test('标签：整词或隐藏 —— 放不下就整条不画，绝不出现省略号碎片', () => {
  const longName = 'relations-evidence-report-with-an-extremely-long-name.md'
  const entries: MapEntry[] = [
    { name: longName, path: 'src/' + longName, kind: 'file' },
    { name: 'ok.ts', path: 'src/ok.ts', kind: 'file' },
  ]
  const layout = layoutFolder(entries, [], { ...SIZE, currentPath: 'src' })
  for (const label of layout.labels) {
    assert.equal(label.text.includes('…'), false, '标签不得截断：' + label.text)
    assert.equal(label.text.includes('...'), false, '标签不得截断：' + label.text)
  }
  assert.ok(layout.labels.some((label) => label.text === 'ok.ts'))
})

test('标签：绝不越出画布', () => {
  const files = makeFiles({ count: 40, dirs: ['src'] })
  const entries = files.map((file) => fileEntry(file.path))
  const layout = layoutFolder(entries, files, { ...SIZE, currentPath: 'src' })
  for (const label of layout.labels) {
    if (!label.visible) continue
    assert.ok(label.x >= -0.01, '标签左越界：' + label.path)
    assert.ok(label.x + label.width <= SIZE.width + 0.01, '标签右越界：' + label.path)
    assert.ok(label.y >= -0.01, '标签上越界：' + label.path)
  }
})

test('标签：selected/hover 强制显示且优先；同数据两次逐字段相同', () => {
  const files = makeFiles({ count: 30, dirs: ['src'] })
  const entries = files.map((file) => fileEntry(file.path))
  const plain = layoutFolder(entries, files, { ...SIZE, currentPath: 'src' })
  const selectedPath = plain.nodes[plain.nodes.length - 1].path
  const selected = layoutFolder(entries, files, { ...SIZE, currentPath: 'src', selectedKey: selectedPath.toLowerCase() })
  const label = selected.labels.find((item) => item.path === selectedPath)
  assert.ok(label !== undefined, '选中节点必须有标签')
  assert.equal(label.visible, true, '选中节点标签强制显示')
  assert.deepEqual(layoutFolder(entries, files, { ...SIZE, currentPath: 'src' }), plain, '同输入两次逐字段相同')
})

/* ================================================================== *
 * 播放头 / 拖动
 * ================================================================== */

test('播放头：hiddenKeys 的节点不画标签、但不重排坐标', () => {
  const files = makeFiles({ count: 8, dirs: ['src'] })
  const entries = files.map((file) => fileEntry(file.path))
  const plain = layoutFolder(entries, files, { ...SIZE, currentPath: 'src' })
  const hidden = new Set([plain.nodes[0].path.toLowerCase()])
  const limited = layoutFolder(entries, files, { ...SIZE, currentPath: 'src', hiddenKeys: hidden })
  assert.equal(limited.nodes.length, plain.nodes.length, '未来节点只隐藏不重排')
  const samePosition = plain.nodes.every((node, index) => {
    const other = limited.nodes[index]
    return other.path === node.path && other.x === node.x && other.y === node.y
  })
  assert.ok(samePosition, '布局坐标不得因播放头变化')
  assert.equal(
    limited.labels.some((label) => label.path === plain.nodes[0].path),
    false,
    '未来节点不出标签',
  )
})

test('拖动偏移：只改被拖的节点，标签跟随', () => {
  const files = makeFiles({ count: 6, dirs: ['src'] })
  const entries = files.map((file) => fileEntry(file.path))
  const target = files[0].path
  const plain = layoutFolder(entries, files, { ...SIZE, currentPath: 'src' })
  const dragged = layoutFolder(entries, files, {
    ...SIZE,
    currentPath: 'src',
    offsets: { [target.toLowerCase()]: { dx: 40, dy: 12 } },
  })
  const before = plain.nodes.find((node) => node.path === target)
  const after = dragged.nodes.find((node) => node.path === target)
  assert.ok(before !== undefined && after !== undefined)
  assert.ok(Math.abs(after.x - (before.x + 40)) < 0.01)
  assert.ok(Math.abs(after.y - (before.y + 12)) < 0.01)
  // 其余节点不动。
  for (const node of plain.nodes) {
    if (node.path === target) continue
    const other = dragged.nodes.find((item) => item.path === node.path)
    assert.ok(other !== undefined)
    assert.equal(other.x, node.x)
    assert.equal(other.y, node.y)
  }
  const plainLabel = plain.labels.find((label) => label.path === target)
  const draggedLabel = dragged.labels.find((label) => label.path === target)
  if (plainLabel !== undefined && draggedLabel !== undefined) {
    assert.notEqual(draggedLabel.x, plainLabel.x, '标签跟随节点')
  }
})

/* ================================================================== *
 * 空态 / 枢纽
 * ================================================================== */

/**
 * 文件夹枢纽也必须能被拖动（2026-11-08 用户反馈）。
 *
 * 用户原话：「每个文件节点都可以拖动，但是文件夹节点没法拖动？这很坏，
 * 我希望是都可以拖动的，给我修好」。
 *
 * 布局层本来就统一按 `key = path.toLowerCase()` 应用 offsets（hub 与 file 都在 plans 里），
 * 所以这条守的是「渲染层别再把 hub 落下」：只要布局对 hub 的 offset 生效，
 * 渲染层接上同一套 beginDrag/moveDrag/endDrag 就成立。
 */
test('拖动：**文件夹枢纽**同样受 offsets 影响（与文件节点同一套键）', () => {
  // 枢纽 = **当前目录（src）的直接子目录**，所以 entry 路径要写成 src/apps、src/lib。
  const files = makeFiles({ count: 6, dirs: ['src'] })
  const entries = [...files.map((file) => fileEntry(file.path)), dirEntry('src/apps'), dirEntry('src/lib')]
  const plain = layoutFolder(entries, files, { ...SIZE, currentPath: 'src' })
  const hub = plain.hubs[0]
  assert.ok(hub !== undefined, '夹具应至少有一个枢纽')

  const hubKey = hub.path.toLowerCase()
  const dragged = layoutFolder(entries, files, {
    ...SIZE,
    currentPath: 'src',
    offsets: { [hubKey]: { dx: 44, dy: -18 } },
  })
  const moved = dragged.hubs.find((item) => item.path === hub.path)
  assert.ok(moved !== undefined)
  assert.ok(Math.abs(moved.x - (hub.x + 44)) < 0.01, '枢纽 x 应随 offsets 平移 44')
  assert.ok(Math.abs(moved.y - (hub.y - 18)) < 0.01, '枢纽 y 应随 offsets 平移 -18')

  // 反向：**别的**枢纽与文件节点不受影响（offset 是按 key 精确匹配，不是全局平移）。
  for (const other of plain.hubs) {
    if (other.path === hub.path) continue
    const after = dragged.hubs.find((item) => item.path === other.path)
    assert.ok(after !== undefined)
    assert.equal(after.x, other.x)
    assert.equal(after.y, other.y)
  }
  for (const node of plain.nodes) {
    const after = dragged.nodes.find((item) => item.path === node.path)
    assert.ok(after !== undefined)
    assert.equal(after.x, node.x)
    assert.equal(after.y, node.y)
  }
})

test('空目录：返回 empty，不造节点', () => {
  const layout = layoutFolder([], [], { ...SIZE, currentPath: 'empty' })
  assert.equal(layout.empty, true)
  assert.equal(layout.nodes.length, 0)
  assert.equal(layout.hubs.length, 0)
  assert.equal(layout.hubEdges.length, 0)
  assert.equal(layout.truncated, false)
  assert.equal(layout.fillRatio, 0)
})

test('枢纽：没有 allEdges 时 hasLinks 全 false、hubEdges 为空（不伪造）', () => {
  const files = makeFiles({ count: 10, dirs: ['src'] })
  const entries = [...files.map((file) => fileEntry(file.path)), dirEntry('src/apps'), dirEntry('src/lib')]
  const layout = layoutFolder(entries, files, { ...SIZE, currentPath: 'src' })
  assert.equal(layout.hubEdges.length, 0)
  for (const hub of layout.hubs) {
    assert.equal(hub.hasLinks, false)
    assert.equal(hub.linkCount, 0)
  }
})

test('枢纽：有真实跨目录边时连到对应文件，没关系的枢纽不连', () => {
  // 当前目录 = 根：文件 a.ts / b.ts + 子文件夹 docs / empty。
  const entries: MapEntry[] = [
    fileEntry('a.ts'),
    fileEntry('b.ts'),
    dirEntry('docs'),
    dirEntry('empty'),
  ]
  const crossEdge = {
    id: 'x1',
    type: 'coTurn' as const,
    from: 'a.ts',
    to: 'docs/guide.md',
    weight: 7,
    directed: false,
    confirmed: true,
    confidence: 'confirmed' as const,
    evidence: { kind: 'coTurn' as const, samples: [{ sessionId: 's', turn: 1 }], count: 7, text: '同一轮出现 7 次' },
  }
  const layout = layoutFolder(entries, [], { ...SIZE, currentPath: '', allEdges: [crossEdge] })
  const docs = layout.hubs.find((hub) => hub.path === 'docs')
  const empty = layout.hubs.find((hub) => hub.path === 'empty')
  assert.ok(docs !== undefined && empty !== undefined)
  assert.equal(docs.hasLinks, true)
  assert.equal(docs.linkCount, 1)
  assert.equal(empty.hasLinks, false, '没有跨目录关系的枢纽不得被连线')
  assert.equal(layout.hubEdges.length, 1)
  assert.equal(layout.hubEdges[0].hubPath, 'docs')
  assert.equal(layout.hubEdges[0].filePath, 'a.ts')
  assert.equal(layout.hubEdges[0].weight, 7)
  // 连线端点 = 枢纽中心与文件圆心（可直接画 <line>）。
  const a = layout.nodes.find((node) => node.path === 'a.ts')
  assert.ok(a !== undefined)
  assert.equal(layout.hubEdges[0].x1, docs.x)
  assert.equal(layout.hubEdges[0].y1, docs.y)
  assert.equal(layout.hubEdges[0].x2, a.x)
  assert.equal(layout.hubEdges[0].y2, a.y)
})

/* ================================================================== *
 * 工具函数（不变）
 * ================================================================== */

test('工具：名字比较确定性、扩展名 → 文件族、根目录名、节点半径', () => {
  assert.ok(compareNames('a.ts', 'b.ts') < 0)
  assert.ok(compareNames('B.ts', 'b.ts') < 0, '大小写不敏感比较后按原串码点')
  assert.ok(compareNames('b.ts', 'B.ts') > 0)
  assert.equal(compareNames('a.ts', 'a.ts'), 0)
  const ordered = ['b.ts', 'A.ts', 'a.ts', 'B.ts'].slice().sort(compareNames)
  assert.deepEqual(ordered, ['A.ts', 'a.ts', 'B.ts', 'b.ts'])

  assert.equal(familyOfName('a.ts'), 'code')
  assert.equal(familyOfName('a.md'), 'text')
  assert.equal(familyOfName('a.json'), 'data')
  assert.equal(familyOfName('a.png'), 'media')
  assert.equal(familyOfName('a.bin'), 'other')
  assert.equal(familyOfName('Makefile'), 'other')
  assert.equal(familyOfName('.gitignore'), 'other')

  assert.equal(folderNameOf('', '根目录'), '根目录')
  assert.equal(folderNameOf('src/client'), 'client')

  assert.equal(folderNodeRadius(0, false), 5, '中性节点半径固定')
  assert.ok(folderNodeRadius(100, true) > folderNodeRadius(4, true), 'touched 节点按 ops 分档')
})

test('两段式标签 API：layoutFolderLabels 不吃几何之外的东西（可单独重算）', () => {
  const files = makeFiles({ count: 16, dirs: ['src'] })
  const entries = files.map((file) => fileEntry(file.path))
  const geometry = layoutFolderGeometry(entries, files, { ...SIZE, currentPath: 'src' })
  const none = layoutFolderLabels(geometry, {})
  assert.deepEqual(none, layoutFolderLabels(geometry, {}), '同输入两次相同')
  const hovered = layoutFolderLabels(geometry, { hoveredKey: files[3].path.toLowerCase() })
  const forced = hovered.find((label) => label.path === files[3].path)
  assert.ok(forced !== undefined)
  assert.equal(forced.visible, true)
})

/* ================================================================== *
 * R11：枢纽 ↔ 枢纽（布局联动 + 档位 + 不伪造）
 * ================================================================== */

/** 造「a 与 b 强、a 与 c 弱」的三文件夹根目录夹具。 */
function hubTriangleFixture() {
  const entries: MapEntry[] = [dirEntry('a'), dirEntry('b'), dirEntry('c'), fileEntry('root.ts')]
  const allEdges: GraphEdge[] = [
    hubEdge('a/1.ts', 'b/1.ts', 90),
    hubEdge('a/1.ts', 'c/1.ts', 2),
  ]
  return { entries, allEdges }
}

/** 一条 coTurn 边（跨文件夹用；weight 即权重）。 */
function hubEdge(from: string, to: string, weight: number): GraphEdge {
  return {
    id: from + '>' + to,
    type: 'coTurn',
    from,
    to,
    weight,
    directed: false,
    confirmed: true,
    confidence: 'confirmed',
    evidence: { kind: 'coTurn', samples: [{ sessionId: 's', turn: 1 }], count: 1, text: '同一轮出现' },
  }
}

test('R11 布局：枢纽间加了弱弹簧 —— 强关系对明显比弱关系对更近（单调性）', () => {
  const { entries, allEdges } = hubTriangleFixture()
  const geometry = layoutFolderGeometry(entries, [], { ...SIZE, currentPath: '', allEdges })
  const byPath = new Map(geometry.hubs.map((hub) => [hub.path, hub]))
  const a = byPath.get('a')
  const b = byPath.get('b')
  const c = byPath.get('c')
  assert.ok(a !== undefined && b !== undefined && c !== undefined)
  const strong = Math.hypot(a.x - b.x, a.y - b.y)
  const weak = Math.hypot(a.x - c.x, a.y - c.y)
  assert.ok(strong < weak, '权重 90 的 a↔b 应比权重 2 的 a↔c 更近：' + strong.toFixed(1) + ' vs ' + weak.toFixed(1))
})

test('R11 布局：加引力后仍**无重叠** —— 卡片中心距 ≥ hypot(w1,h1)/2 + hypot(w2,h2)/2 + 10', () => {
  const entries: MapEntry[] = ['a', 'b', 'c', 'd', 'e', 'f'].map((name) => dirEntry(name))
  const allEdges: GraphEdge[] = [
    hubEdge('a/1.ts', 'b/1.ts', 90),
    hubEdge('a/1.ts', 'c/1.ts', 70),
    hubEdge('b/1.ts', 'd/1.ts', 50),
    hubEdge('c/1.ts', 'e/1.ts', 40),
    hubEdge('d/1.ts', 'f/1.ts', 30),
  ]
  const geometry = layoutFolderGeometry(entries, [], { ...SIZE, currentPath: '', allEdges })
  assert.equal(geometry.hubs.length, 6)
  for (let left = 0; left < geometry.hubs.length; left += 1) {
    for (let right = left + 1; right < geometry.hubs.length; right += 1) {
      const a = geometry.hubs[left]
      const b = geometry.hubs[right]
      const need = Math.hypot(a.width, a.height) / 2 + Math.hypot(b.width, b.height) / 2 + FOLDER_HUB_MIN_GAP
      const have = Math.hypot(a.x - b.x, a.y - b.y)
      assert.ok(have >= need - 0.05, '枢纽重叠：' + a.path + ' / ' + b.path + ' 距离 ' + have.toFixed(2) + ' < ' + need.toFixed(2))
    }
  }
})

test('R11 布局：加引力后仍**铺满视口**（≥55%）且全部在画布内', () => {
  const entries: MapEntry[] = ['a', 'b', 'c', 'd'].map((name) => dirEntry(name))
  const files = makeFiles({ count: 20, dirs: ['a'] })
  const allEntries = [...entries, ...files.map((file) => fileEntry(file.path))]
  const allEdges: GraphEdge[] = [
    hubEdge('a/1.ts', 'b/1.ts', 90),
    hubEdge('a/2.ts', 'c/1.ts', 40),
    hubEdge('a/3.ts', 'd/1.ts', 10),
  ]
  const geometry = layoutFolderGeometry(allEntries, files, { ...SIZE, currentPath: '', allEdges })
  assert.ok(geometry.fillRatio >= 0.55, 'fillRatio = ' + geometry.fillRatio.toFixed(3))
  assert.ok(geometry.fillX >= 0.55, 'fillX = ' + geometry.fillX.toFixed(3))
  assert.ok(geometry.fillY >= 0.55, 'fillY = ' + geometry.fillY.toFixed(3))
  for (const hub of geometry.hubs) {
    assert.ok(hub.x - hub.width / 2 >= -0.01, '枢纽左越界：' + hub.path)
    assert.ok(hub.x + hub.width / 2 <= SIZE.width + 0.01, '枢纽右越界：' + hub.path)
    assert.ok(hub.y - hub.height / 2 >= -0.01, '枢纽上越界：' + hub.path)
    assert.ok(hub.y + hub.height / 2 <= SIZE.height + 0.01, '枢纽下越界：' + hub.path)
  }
  for (const node of geometry.nodes) {
    assert.ok(node.x - node.r >= -0.01, '节点左越界：' + node.path)
    assert.ok(node.x + node.r <= SIZE.width + 0.01, '节点右越界：' + node.path)
  }
})

test('R11 布局：确定性 —— 同输入两次枢纽坐标逐字段相同（弹簧顺序固定）', () => {
  const { entries, allEdges } = hubTriangleFixture()
  const first = layoutFolderGeometry(entries, [], { ...SIZE, currentPath: '', allEdges })
  const second = layoutFolderGeometry(entries, [], { ...SIZE, currentPath: '', allEdges })
  assert.deepEqual(
    first.hubs.map((hub) => hub.path + '@' + hub.x + ',' + hub.y),
    second.hubs.map((hub) => hub.path + '@' + hub.x + ',' + hub.y),
  )
  assert.deepEqual(first.hubPairs, second.hubPairs)
})

test('R11 布局：确定性 —— **打乱 allEdges 顺序**后枢纽坐标与连线完全相同', () => {
  const { entries, allEdges } = hubTriangleFixture()
  const reversed = allEdges.slice().reverse()
  const forward = layoutFolderGeometry(entries, [], { ...SIZE, currentPath: '', allEdges })
  const backward = layoutFolderGeometry(entries, [], { ...SIZE, currentPath: '', allEdges: reversed })
  assert.deepEqual(
    forward.hubs.map((hub) => hub.path + '@' + hub.x + ',' + hub.y),
    backward.hubs.map((hub) => hub.path + '@' + hub.x + ',' + hub.y),
    '边顺序不得影响坐标（弹簧与权重累加都必须顺序无关）',
  )
  assert.deepEqual(forward.hubPairs.map((pair) => pair.key), backward.hubPairs.map((pair) => pair.key))
})

test('R11 档位：几何用**最宽档**保持位置稳定；绘制按档再截（骨架 0 / 标准 2 / 全部 4）', () => {
  const entries: MapEntry[] = ['a', 'b', 'c', 'd', 'e'].map((name) => dirEntry(name))
  // 全连接方阵：10 对，足够让 top-2 与 top-4 出现数量差。
  const allEdges: GraphEdge[] = []
  for (const left of entries) {
    for (const right of entries) {
      if (left.path >= right.path) continue
      allEdges.push(hubEdge(left.path + '/1.ts', right.path + '/1.ts', 10 + allEdges.length))
    }
  }
  const geometry = layoutFolderGeometry(entries, [], { ...SIZE, currentPath: '', allEdges })
  // 几何给的是**最宽伙伴集**（每枢纽 top-4），位置与档位无关。
  assert.ok(geometry.hubPairs.length > 0)
  assert.ok(geometry.hubPairs.length <= 4 * entries.length, '几何最多 top-4 × 枢纽数')
  // 绘制层按档位再截 —— 与直接算该档的结果**完全一致**（同一个 truncateHubPairs 口径）。
  const byDensity = {
    skeleton: truncateHubPairs(geometry.hubPairs, hubPairPartnersFor('skeleton')),
    standard: truncateHubPairs(geometry.hubPairs, hubPairPartnersFor('standard')),
    all: truncateHubPairs(geometry.hubPairs, hubPairPartnersFor('all')),
  }
  assert.equal(byDensity.skeleton.length, 0, '骨架档必须 0 条')
  assert.ok(byDensity.standard.length > 0, '标准档必须有线')
  assert.ok(byDensity.all.length >= byDensity.standard.length, '全部档不得少于标准档')
  assert.equal(byDensity.all.length, geometry.hubPairs.length, '全部档 = 几何给的最宽集')
  for (const density of ['standard', 'all'] as const) {
    const direct = computeHubPairs(allEdges, { currentPath: '', hubPaths: entries.map((entry) => entry.path), maxPartnersPerHub: hubPairPartnersFor(density) })
    assert.deepEqual(
      byDensity[density].map((pair) => pair.aPath + '<->' + pair.bPath),
      direct.map((pair) => pair.aPath + '<->' + pair.bPath),
      density + '：从最宽集再截 与 直接算该档 必须一致（不能有两套截断口径）',
    )
  }
})

test('R11 切档不重排：几何与档位无关（位置稳定），只有绘制集合变', () => {
  const entries: MapEntry[] = ['a', 'b', 'c', 'd'].map((name) => dirEntry(name))
  const allEdges: GraphEdge[] = [
    hubEdge('a/1.ts', 'b/1.ts', 90),
    hubEdge('a/1.ts', 'c/1.ts', 50),
    hubEdge('b/1.ts', 'd/1.ts', 40),
    hubEdge('c/1.ts', 'd/1.ts', 20),
  ]
  const first = layoutFolderGeometry(entries, [], { ...SIZE, currentPath: '', allEdges })
  const second = layoutFolderGeometry(entries, [], { ...SIZE, currentPath: '', allEdges })
  assert.deepEqual(
    first.hubs.map((hub) => hub.path + '@' + hub.x + ',' + hub.y),
    second.hubs.map((hub) => hub.path + '@' + hub.x + ',' + hub.y),
    '同输入两次坐标相同',
  )
  // 三档的绘制集合都从**同一份坐标**派生 → 切档不会重排（用户不会看到图"跳一下"）。
  const coordinatesByTier = (['skeleton', 'standard', 'all'] as const).map((density) => {
    const drawn = truncateHubPairs(first.hubPairs, hubPairPartnersFor(density))
    const byPath = new Map(first.hubs.map((hub) => [hub.path, hub]))
    return drawn.map((pair) => {
      const a = byPath.get(pair.aPath)
      const b = byPath.get(pair.bPath)
      return pair.aPath + '@' + (a === undefined ? '?' : a.x + ',' + a.y) + '|' + pair.bPath + '@' + (b === undefined ? '?' : b.x + ',' + b.y)
    })
  })
  // 标准档的每条线端点坐标必须能在全部档里找到同一对（坐标一致）。
  const allEndpoints = new Set(coordinatesByTier[2])
  for (const line of coordinatesByTier[1]) assert.ok(allEndpoints.has(line), '标准档的线在全部档里必须用同一坐标：' + line)
  assert.deepEqual(coordinatesByTier[0], [], '骨架档零条')
})

test('R11 反向：currentPath 下**没有**枢纽间真实边 → hubPairs 为空（不伪造）', () => {
  const entries: MapEntry[] = ['a', 'b', 'c'].map((name) => dirEntry(name))
  // 只有文件夹内部边，没有任何跨文件夹边。
  const allEdges: GraphEdge[] = [hubEdge('a/1.ts', 'a/2.ts', 90), hubEdge('b/1.ts', 'b/2.ts', 80)]
  const geometry = layoutFolderGeometry(entries, [], { ...SIZE, currentPath: '', allEdges })
  assert.equal(geometry.hubPairs.length, 0, '没有真实边就一条都不画')
  for (const hub of geometry.hubs) assert.equal(hub.hasLinks, false, '枢纽不得被标成有连接：' + hub.path)
})

test('R11 反向：allEdges === undefined → hubPairs 为空（不做、不猜）', () => {
  const entries: MapEntry[] = ['a', 'b'].map((name) => dirEntry(name))
  const geometry = layoutFolderGeometry(entries, [], { ...SIZE, currentPath: '' })
  assert.deepEqual(geometry.hubPairs, [])
})

test('R11 几何：hubPairs 的端点坐标 = 两张卡片中心（可直接画 line）', () => {
  const { entries, allEdges } = hubTriangleFixture()
  const geometry = layoutFolderGeometry(entries, [], { ...SIZE, currentPath: '', allEdges })
  const byPath = new Map(geometry.hubs.map((hub) => [hub.path, hub]))
  assert.ok(geometry.hubPairs.length > 0)
  for (const pair of geometry.hubPairs) {
    const a = byPath.get(pair.aPath)
    const b = byPath.get(pair.bPath)
    assert.ok(a !== undefined && b !== undefined)
    assert.equal(pair.x1, a.x)
    assert.equal(pair.y1, a.y)
    assert.equal(pair.x2, b.x)
    assert.equal(pair.y2, b.y)
    // 无向归一键：min(a,b) + "\u0000" + max(a,b)，小写。
    const expected = [pair.aPath.toLowerCase(), pair.bPath.toLowerCase()].sort().join('\u0000')
    assert.equal(pair.key, expected, 'key 必须是小写 min/max 归一')
  }
})
