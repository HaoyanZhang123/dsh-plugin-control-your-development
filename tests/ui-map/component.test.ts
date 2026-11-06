/*
 * component.test.ts —— 文件关系图（FileGraph）的静态渲染断言（33 §3/§4/§8）。
 *
 * 覆盖：directory/turn 两种 mode、节点/标签/边（只取两端都在当前集合内）、
 * 选中态（填充加深+同色细环、无大框/outline）、本轮状态小字与摘要条、
 * 目录 40 / 轮次 200 上限的显式提示、空态、确定性。
 *
 * hover/click/双击/Esc 这类行为由 tests/ui-map/run-t07.mjs 在真实浏览器里断言。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { caseKey } from '../../src/shared/relations/index.ts'
import { FileGraph, FILE_FAMILIES, FAMILY_COLOR } from '../../src/client/ui/map/index.ts'
import { buildDirectoryCards } from '../../src/client/ui/rail/index.ts'
import { turnFileStatusOf } from '../../src/client/ui/turns/index.ts'
import { buildEdges, makeFiles, makeTurnDetail, NOW } from './fixtures.ts'

const h = React.createElement

function countMatches(html: string, pattern: RegExp): number {
  const matches = html.match(pattern)
  return matches === null ? 0 : matches.length
}

function renderGraph(overrides: Record<string, unknown> = {}): string {
  const files = makeFiles({ count: 30, dirs: ['src'] })
  return renderToStaticMarkup(
    h(FileGraph, {
      files,
      edges: [],
      mode: 'directory',
      directoryKey: 'src',
      directoryLabel: 'src',
      now: NOW,
      locale: 'zh',
      testId: 'graph',
      ...overrides,
    }),
  )
}

const files = makeFiles({ count: 30, dirs: ['src'] })

test('directory 模式：文件节点 + 标签 + 图例 5 类，无簇框/网格/缩放', () => {
  const html = renderGraph()
  assert.ok(html.includes('data-tl-graph="true"'))
  assert.ok(html.includes('data-graph-mode="directory"'))
  assert.equal(countMatches(html, /data-file-path="/g), files.length)
  assert.equal(countMatches(html, /data-label-for="/g) > 0, true)
  assert.equal(html.includes('tl-cluster-box'), false, 'T31 删除簇底框')
  assert.equal(html.includes('tl-map-grid'), false, 'T31 删除网格背景')
  assert.equal(html.includes('data-zoom'), false)
  assert.equal(html.includes('tl-map-toolbar'), false)
  // 图例：5 类 + 每类一个色点。
  for (const label of ['文本', '代码', '数据', '媒体', '其它']) assert.ok(html.includes(label), '缺图例 ' + label)
  assert.equal(countMatches(html, /class="tl-graph-legend-item"/g), 5)
  // 周围一圈文件都在画布里。
  for (const match of html.matchAll(/data-file-path="[^"]+"/g)) assert.ok(match[0].length > 0)
})

test('4 个文件大类颜色来自 tokens（不写颜色字面量）', () => {
  const colors = FILE_FAMILIES.map((family) => FAMILY_COLOR[family])
  assert.equal(colors.length, 5)
  assert.equal(new Set(colors).size, 5)
  for (const color of colors) assert.match(color, /^var\(--tl-/)
})

test('选中态：填充加深（fillOpacity=1）+ 同色 1.5px 细环，不出现大框/outline', () => {
  const selected = files[0].path
  const html = renderGraph({ selectedPath: selected })
  const at = html.indexOf('data-file-path="' + selected + '"')
  assert.ok(at > 0)
  const start = html.lastIndexOf('<g', at)
  const block = html.slice(start, html.indexOf('</g>', at))
  assert.ok(block.includes('data-selected="true"'))
  assert.ok(block.includes('fill-opacity="1"'))
  assert.ok(block.includes('stroke-width="1.5"'))
  assert.equal(block.includes('outline'), false)
  // 未选中的节点是浅填充（不会全部一样深）。
  assert.ok(html.includes('fill-opacity="0.55"'))
})

test('边：只画两端都在当前节点集合内的边；目录图不画"同目录结构边"（避免蜘蛛网）', () => {
  const all = makeFiles({ count: 40, dirs: ['src', 'docs'] })
  const edges = buildEdges(all, [], { references: 4 })
  const directory = renderGraph({ files: all, edges, directoryKey: '', directoryLabel: '根目录' })
  assert.equal((directory.match(/data-layer="structure"/g) ?? []).length, 0, '目录图不应画结构边')
  const turn = makeTurnDetail(all.slice(0, 6), { n: 2 })
  const status = turnFileStatusOf(turn, all)
  const turnHtml = renderGraph({ files: all, edges, mode: 'turn', turn: { turn, status } })
  const endpoints = [...turnHtml.matchAll(/data-edge-from="([^"]+)" data-edge-to="([^"]+)"/g)]
  assert.ok(endpoints.length > 0)
  const allowed = new Set(all.map((file) => caseKey(file.path)))
  for (const match of endpoints) {
    assert.ok(allowed.has(caseKey(match[1])), '边端点不在集合内：' + match[1])
    assert.ok(allowed.has(caseKey(match[2])), '边端点不在集合内：' + match[2])
  }
  assert.equal(countMatches(turnHtml, /data-edge-id="/g), endpoints.length)
})

test('目录模式：摘要条始终占位（data-empty），hover 切到 turn 时高度不变', () => {
  const html = renderGraph()
  assert.ok(html.includes('class="tl-graph-summary"'))
  assert.ok(html.includes('data-empty="true"'))
})

test('turn 模式：摘要条（读/写行/首见/删除命令）+ 每个文件的状态小字', () => {
  const turnFiles = files.slice(0, 5)
  const turn = makeTurnDetail(turnFiles, { n: 7, deleteCommands: 2 })
  const status = turnFileStatusOf(turn, files)
  const html = renderGraph({
    files: turnFiles,
    mode: 'turn',
    turn: { turn, status },
    edges: [],
    directoryKey: 'src',
    directoryLabel: 'src',
  })
  assert.ok(html.includes('data-graph-mode="turn"'))
  assert.ok(html.includes('class="tl-graph-summary"'))
  assert.ok(html.includes('T7'))
  assert.ok(html.includes('读 4'))
  assert.ok(html.includes('写 +16 / −3 行'))
  assert.ok(html.includes('首见 0'))
  assert.ok(html.includes('删除命令 2（未逐文件归属）'))
  // 状态小字：至少出现「读 n / 写+ / 写−」三种标记。
  assert.ok(countMatches(html, /class="tl-fnode-status"/g) >= 3)
  assert.ok(html.includes('写+12'))
  assert.ok(html.includes('写−3'))
  assert.ok(html.includes('data-read="1"'))
  assert.ok(html.includes('data-write-add="12"'))
  // 首见：窗口外的文件不标。
  assert.ok(html.includes('data-first-seen="false"'))
})

test('turn 模式：删除命令不可知时显示 —（不显示 0）', () => {
  const turn = makeTurnDetail(files.slice(0, 3), { n: 2 })
  const status = turnFileStatusOf(turn, files)
  const html = renderGraph({ files: files.slice(0, 3), mode: 'turn', turn: { turn, status }, edges: [] })
  assert.ok(html.includes('data-status="delete"'))
  assert.ok(html.includes('删除命令 —'))
  assert.equal(html.includes('删除命令 0'), false)
})

test('上限：目录 40 / 轮次 200 截断时显式「显示 N/M」', () => {
  const many = makeFiles({ count: 300, dirs: ['big'] })
  const directory = renderGraph({ files: many, directoryKey: 'big', directoryLabel: 'big' })
  assert.ok(directory.includes('data-node-count="40"'))
  assert.ok(directory.includes('显示 40/300 个活跃文件'))
  assert.ok(directory.includes('data-graph-truncated="true"'))
  const turn = renderGraph({ files: many, mode: 'turn', edges: [] })
  assert.ok(turn.includes('data-node-count="200"'))
  assert.ok(turn.includes('显示 200/300 个活跃文件'))
})

test('空数据：不画假图，显示既有空态口径', () => {
  const html = renderGraph({ files: [], edges: [] })
  assert.ok(html.includes('data-file-count="0"'))
  assert.equal(countMatches(html, /data-file-path="/g), 0)
  assert.equal(html.includes('tl-graph-svg'), false)
  assert.ok(html.includes('data-threadline-empty'))
  assert.ok(html.includes('有对话记录，但没有文件操作'))
})

test('确定性：同一份 props 两次静态渲染逐字符相同', () => {
  assert.equal(renderGraph(), renderGraph())
  const turn = makeTurnDetail(files.slice(0, 5), { n: 4 })
  const status = turnFileStatusOf(turn, files)
  const props = { files: files.slice(0, 5), mode: 'turn' as const, turn: { turn, status }, edges: [] }
  assert.equal(renderGraph(props), renderGraph(props))
})

test('reduced-motion 标记透传到图根（无动画依赖）', () => {
  const html = renderGraph({ reducedMotion: true })
  assert.ok(html.includes('data-reduced-motion="true"'))
})

test('turn 模式：运行中轮次（无 end）首见显示 —，不显示 0', () => {
  const turnFiles = files.slice(0, 3)
  const turn = makeTurnDetail(turnFiles, { n: 2, end: null })
  const status = turnFileStatusOf(turn, files)
  const html = renderGraph({ files: turnFiles, mode: 'turn', turn: { turn, status }, edges: [] })
  assert.ok(html.includes('首见 —'))
  assert.equal(html.includes('首见 0'), false)
})

/* ================================================================== *
 * T35 星图总览（overview）：目录簇 / top3+聚合标记 / 目录级弱边 /
 * 关系类型 chip / 加载态 / 覆盖说明 / 图内证据
 * ================================================================== */

function overviewEdge(type: 'coTurn' | 'reference' | 'structure', from: string, to: string, weight = 1) {
  const evidence =
    type === 'structure'
      ? { kind: 'structure' as const, dir: from.split('/')[0] ?? '', text: '同目录：' + from }
      : type === 'reference'
        ? { kind: 'reference' as const, line: 3, raw: to, target: to, resolved: true, text: '引用：' + to }
        : { kind: 'coTurn' as const, samples: [{ sessionId: 'sess-0001', turn: 1 }], count: weight, text: '同一轮：' + from }
  return {
    id: 'e:' + type + ':' + from + ':' + to,
    type,
    from,
    to,
    weight,
    directed: type === 'reference',
    evidence,
    confirmed: true,
    confidence: type === 'structure' ? ('estimated' as const) : type === 'reference' ? ('parsed' as const) : ('confirmed' as const),
  }
}

function overviewFixture() {
  const nodes = makeFiles({ count: 120, dirs: ['src', 'docs', 'assets', 'notes'] })
  const src = nodes.find((file) => file.path.startsWith('src/'))
  const docs = nodes.find((file) => file.path.startsWith('docs/'))
  const assets = nodes.find((file) => file.path.startsWith('assets/'))
  assert.ok(src !== undefined && docs !== undefined && assets !== undefined)
  const edges = [
    overviewEdge('coTurn', src.path, docs.path, 3),
    overviewEdge('reference', src.path, docs.path, 1),
    overviewEdge('structure', src.path, nodes[0].path, 1),
    overviewEdge('coTurn', docs.path, assets.path, 2),
  ]
  return { nodes, cards: buildDirectoryCards(nodes), edges, src, docs }
}

function renderOverview(overrides: Record<string, unknown> = {}): string {
  const fixture = overviewFixture()
  return renderToStaticMarkup(
    h(FileGraph, {
      files: fixture.nodes,
      cards: fixture.cards,
      edges: fixture.edges,
      mode: 'overview',
      directoryKey: '',
      directoryLabel: '/',
      now: NOW,
      locale: 'zh',
      testId: 'overview-graph',
      ...overrides,
    }),
  )
}

test('overview：每目录一簇 + 折叠只画 top3 + +N 聚合标记（不出现数千文件节点）', () => {
  const fixture = overviewFixture()
  const html = renderOverview()
  assert.ok(html.includes('data-graph-mode="overview"'))
  assert.equal(countMatches(html, /data-cluster-key="/g), fixture.cards.length)
  assert.equal(countMatches(html, /data-file-path="/g), fixture.cards.length * 3, '折叠态只画每簇 top3')
  for (const card of fixture.cards) {
    assert.ok(html.includes('data-cluster-key="' + card.key + '"'), '缺目录簇：' + card.key)
    if (card.count > 3) assert.ok(html.includes('data-more-files="' + String(card.count - 3) + '"'), '缺 +N：' + card.key)
  }
  // 300 文件真实规模也不会把全部文件塞进 DOM。
  const many = makeFiles({ count: 300, dirs: ['src', 'docs', 'assets', 'notes'] })
  const manyCards = buildDirectoryCards(many)
  const manyHtml = renderToStaticMarkup(
    h(FileGraph, { files: many, cards: manyCards, edges: [], mode: 'overview', directoryKey: '', directoryLabel: '/', now: NOW, locale: 'zh' }),
  )
  assert.ok(countMatches(manyHtml, /data-file-path="/g) <= manyCards.length * 3)
})

test('overview：悬浮/聚焦的簇展开 top12，其他簇 dim；目录级弱关系只画跨目录聚合', () => {
  const fixture = overviewFixture()
  const expandedKey = fixture.cards[0].key
  const html = renderOverview({ hoveredDirectoryKey: expandedKey })
  const expandedBlockStart = html.indexOf('data-cluster-key="' + expandedKey + '"')
  assert.ok(expandedBlockStart > 0)
  assert.ok(html.includes('data-expanded="true"'))
  assert.ok(html.includes('data-dim="true"'), '其他簇要 dim')
  assert.ok(countMatches(html, /data-file-path="/g) > fixture.cards.length * 3, '展开态应有更多文件节点')
  assert.ok(countMatches(html, /data-file-path="/g) <= (fixture.cards.length - 1) * 3 + 12)
  assert.ok(countMatches(html, /data-dir-edge="/g) > 0, '缺目录级弱关系')
  assert.ok(html.includes('data-from-directory="' + expandedKey + '"') || html.includes('data-to-directory="' + expandedKey + '"'))
})

test('overview：关系类型 chip 带计数；加载态显示骨架而不是 0 文件空态；coverageNote 进图尾', () => {
  const html = renderOverview({ coverageNote: '基于已加载 12 个会话' })
  assert.ok(html.includes('data-relation-filter="coTurn"'))
  assert.ok(html.includes('data-relation-filter="reference"'))
  assert.ok(html.includes('aria-pressed="true"'))
  assert.ok(html.includes('基于已加载 12 个会话'))
  assert.ok(html.includes('data-graph-reset="true"'))

  const loading = renderToStaticMarkup(
    h(FileGraph, {
      files: [],
      cards: [],
      edges: [],
      mode: 'overview',
      directoryKey: '',
      directoryLabel: '/',
      now: NOW,
      locale: 'zh',
      loading: true,
      loadingLabel: '正在加载文件关系…',
    }),
  )
  assert.ok(loading.includes('data-graph-loading="true"'))
  assert.ok(loading.includes('正在加载文件关系…'))
  assert.equal(loading.includes('data-threadline-empty'), false, '加载中不能显示空态/0 文件')
})

test('overview：选中文件显示图内证据浮层（路径/族/ops/关系分组），不是旧检查器', () => {
  const fixture = overviewFixture()
  const html = renderOverview({ selectedPath: fixture.src.path })
  assert.ok(html.includes('data-graph-evidence="file"'))
  assert.ok(html.includes('关系证据'))
  assert.ok(html.includes(fixture.src.path))
  assert.ok(html.includes('data-evidence-family="code"') || html.includes('data-evidence-family="text"') || html.includes('data-evidence-family="data"'))
  assert.ok(html.includes('操作 '))
  assert.ok(html.includes('data-evidence-type="coTurn"') || html.includes('data-evidence-type="reference"'))
  assert.equal(html.includes('data-region="inspector"'), false)
})

test('overview：空数据走既有空态；同 props 两次渲染逐字符相同', () => {
  const empty = renderToStaticMarkup(
    h(FileGraph, { files: [], cards: [], edges: [], mode: 'overview', directoryKey: '', directoryLabel: '/', now: NOW, locale: 'zh' }),
  )
  assert.ok(empty.includes('data-threadline-empty'))
  assert.equal(renderOverview(), renderOverview())
})
