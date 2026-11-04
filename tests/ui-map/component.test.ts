/*
 * component.test.ts —— 星图/时间轴的静态渲染断言（A41-1 / A41-3 的结构一半）。
 *
 * 渲染用 react-dom/server 的静态标记（与 tests/ui-shell 同一套方式，不引 jsdom）：
 * - 星图：节点/簇/四层边/图例/标签/焦点透明度/截断文案；
 * - 时间轴：未加载斜纹/播放头 slider/刻度优先级/reduced-motion/aria-live；
 * - 两次渲染逐字符相同（确定性）。
 * "hover/click/拖拽/播放"这类行为由 tests/ui-map/run-t07.mjs 在真实浏览器里断言。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { caseKey } from '../../src/shared/relations/index.ts'
import { MapView, FAMILY_COLOR, FILE_FAMILIES } from '../../src/client/ui/map/index.ts'
import { layoutMap } from '../../src/client/ui/map/layout.ts'
import { Timeline } from '../../src/client/ui/timeline/index.ts'
import { makeDataset, makeFiles, makeTimelineFixture, NOW } from './fixtures.ts'

const h = React.createElement

function renderMap(overrides: Record<string, unknown> = {}): string {
  const dataset = makeDataset()
  const coTurn = dataset.edges.find((edge) => edge.type === 'coTurn')
  assert.ok(coTurn)
  return renderToStaticMarkup(
    h(MapView, {
      nodes: dataset.files,
      edges: [...dataset.edges, ...dataset.sequence],
      now: NOW,
      selectedPath: coTurn.from,
      selectedTurn: { sessionId: dataset.turns[0].sessionId, turn: dataset.turns[0].turn },
      layers: { coSession: true },
      showAllRelations: false,
      showAllReferences: false,
      ...overrides,
    }),
  )
}

function countMatches(html: string, pattern: RegExp): number {
  const matches = html.match(pattern)
  return matches === null ? 0 : matches.length
}

test('星图：200 个节点、目录簇、簇标签与计数都渲染', () => {
  const files = makeFiles({ count: 200 })
  const html = renderMap({ nodes: files, edges: [], selectedPath: null, selectedTurn: null })
  const layout = layoutMap(files)
  assert.equal(countMatches(html, /data-node-path="/g), layout.nodes.length)
  assert.equal(layout.nodes.length, 200)
  assert.ok(layout.clusters.length >= 2)
  assert.equal(countMatches(html, /data-cluster-key="/g), layout.clusters.length)
  // 簇标签常驻（根目录显示 `/`，目录显示顶层目录名）。
  for (const cluster of layout.clusters) assert.ok(html.includes('>' + cluster.label + '<'), '缺少簇标签 ' + cluster.label)
  // 节点半径落在 3–9（data-ops 由 ops 派生，r 在 SVG 属性里）。
  const radii = [...html.matchAll(/class="tl-node-core"[^>]*r="([0-9.]+)"/g)].map((match) => Number(match[1]))
  assert.ok(radii.length > 0)
  for (const radius of radii) assert.ok(radius >= 3 && radius <= 9, '半径越界 ' + radius)
})

test('星图：四层边全渲染（结构/共现/引用/时序 + 可选同会话），每条边带证据 title', () => {
  const html = renderMap({ showAllRelations: true, showAllReferences: true, layers: { coSession: true, sequence: true } })
  for (const layer of ['structure', 'coTurn', 'reference', 'sequence', 'coSession']) {
    assert.ok(html.includes('data-layer="' + layer + '"'), '缺少图层 ' + layer)
  }
  assert.ok(countMatches(html, /data-edge-id="/g) > 0)
  // 每条边都有证据文本（T05 统一模板，UI 不造句）。
  assert.ok(html.includes('同属目录') || html.includes('同时出现'))
})

test('星图：选中文件时焦点模式只改透明度（邻居 1 / 其它 0.2），坐标来自布局', () => {
  const dataset = makeDataset()
  const coTurn = dataset.edges.find((edge) => edge.type === 'coTurn')
  assert.ok(coTurn)
  const focusKey = caseKey(coTurn.from)
  const partnerKey = caseKey(coTurn.to)
  const html = renderMap({ nodes: dataset.files, edges: dataset.edges, selectedPath: coTurn.from, selectedTurn: null, layers: { coSession: false } })
  assert.ok(html.includes('data-node-path="' + coTurn.from + '"'))
  // 邻居（共现另一端）不被 dim。
  const partnerBlock = html.slice(html.indexOf('data-node-path="' + coTurn.to + '"'))
  assert.ok(partnerBlock.slice(0, 400).includes('data-dim="false"'))
  // 至少存在被 dim 到 0.2 的节点。
  assert.ok(html.includes('data-opacity="0.2"'))
  const layout = layoutMap(dataset.files)
  const node = layout.nodes.find((item) => caseKey(item.path) === focusKey)
  assert.ok(node)
  assert.ok(html.includes('data-x="' + node.x + '"'))
  assert.ok(html.includes('data-y="' + node.y + '"'))
  assert.notEqual(partnerKey, focusKey)
})

test('星图：标签避让——未放大时只有选中/悬停的标签，选中标签永远显示', () => {
  const dataset = makeDataset()
  const selected = dataset.files[3].path
  const html = renderMap({ nodes: dataset.files, edges: [], selectedPath: selected, selectedTurn: null })
  const visibleLabels = countMatches(html, /data-label-for="/g)
  // 未放大（zoom 1 < 1.4）→ 只有选中的那一个标签可见。
  assert.equal(visibleLabels, 1)
  assert.ok(html.includes('data-label-for="' + selected + '"'))
  assert.ok(html.includes('data-selected="true"'))
})

test('星图：超过 600 个节点时显式显示 locale 文案（显示 600/1200 个活跃文件）', () => {
  const files = makeFiles({ count: 1200, seed: 5 })
  const html = renderMap({ nodes: files, edges: [], selectedPath: null, selectedTurn: null })
  assert.ok(html.includes('data-map-node-limit="true"'))
  assert.ok(html.includes('显示 600/1200 个活跃文件'))
  assert.equal(countMatches(html, /data-node-path="/g), 600)
})

test('星图：图例用 locale 文案（图例/文档/代码/…），颜色语义 6 个族', () => {
  const html = renderMap({ edges: [], selectedPath: null, selectedTurn: null })
  assert.ok(html.includes('图例'))
  for (const label of ['文档', '代码', '数据', '图片', '配置', '其它']) assert.ok(html.includes(label), '缺少族文案 ' + label)
  assert.equal(cutCount(html, 'class="threadline-swatch"'), 6)
})

function cutCount(html: string, needle: string): number {
  return html.split(needle).length - 1
}

test('星图：确定性——同一份 props 两次静态渲染逐字符相同', () => {
  const first = renderMap()
  const second = renderMap()
  assert.equal(first, second)
})

test('星图：6 个文件族的颜色互不相同（颜色语义来自 tokens 的 6 个令牌）', () => {
  const colors = FILE_FAMILIES.map((family) => FAMILY_COLOR[family])
  assert.equal(colors.length, 6)
  assert.equal(new Set(colors).size, 6)
  for (const color of colors) assert.match(color, /^var\(--tl-/)
})

test('星图：reduced-motion 标记 + 无选中时无焦点透明度', () => {
  const html = renderMap({ selectedPath: null, selectedTurn: null, reducedMotion: true })
  assert.ok(html.includes('data-reduced-motion="true"'))
  assert.equal(html.includes('data-opacity="0.2"'), false)
})

test('星图：空数据不崩（0 节点、无簇、无图例计数）', () => {
  const html = renderMap({ nodes: [], edges: [], selectedPath: null, selectedTurn: null })
  assert.ok(html.includes('data-node-count="0"'))
  assert.ok(html.includes('data-truncated="false"'))
})

function renderTimeline(overrides: Record<string, unknown> = {}): string {
  const fixture = makeTimelineFixture()
  return renderToStaticMarkup(
    h(Timeline, {
      range: 'range.all',
      domain: fixture.domain,
      playhead: Math.round(fixture.unloadedRanges[0].start + 1),
      unloadedRanges: fixture.unloadedRanges,
      nodes: fixture.nodes,
      sessions: fixture.sessions,
      now: fixture.domain.end,
      ...overrides,
    }),
  )
}

test('时间轴：未加载区段画斜纹 + 标签，播放头落入时提示 state.unloadedRange', () => {
  const html = renderTimeline()
  assert.ok(html.includes('data-tl-timeline="true"'))
  assert.equal(cutCount(html, 'class="tl-unloaded"'), 1)
  assert.ok(html.includes('>未加载<'))
  assert.ok(html.includes('data-unloaded-hint="true"'))
  assert.ok(html.includes('该时间段还在读取'))
})

test('时间轴：播放头是 slider（aria-valuemin/max/now/valuetext），控件与刻度齐全', () => {
  const html = renderTimeline()
  assert.ok(html.includes('role="slider"'))
  assert.match(html, /aria-valuemin="[0-9]+"/)
  assert.match(html, /aria-valuemax="[0-9]+"/)
  assert.match(html, /aria-valuenow="[0-9]+"/)
  assert.match(html, /aria-valuetext="[^"]+"/)
  assert.ok(html.includes('data-testid="timeline-play"'))
  assert.ok(html.includes('data-testid="timeline-speed-1"'))
  assert.ok(html.includes('data-testid="timeline-speed-4"'))
  assert.ok(html.includes('data-testid="timeline-now"'))
  assert.ok(cutCount(html, 'data-tick-priority="high"') >= 2)
  assert.ok(html.includes('aria-live="polite"'))
  assert.ok(html.includes('回到现在'))
})

test('时间轴：会话刻度、生长带与播放头标签渲染', () => {
  const html = renderTimeline()
  assert.equal(cutCount(html, 'class="tl-session"'), 4)
  assert.ok(html.includes('class="tl-growth-line"'))
  assert.ok(html.includes('data-playhead-label="true"'))
})

test('时间轴：reduced-motion 标记 + 播放/暂停文案切换（受控）', () => {
  const playing = renderTimeline({ playing: true, reducedMotion: true })
  assert.ok(playing.includes('data-playing="true"'))
  assert.ok(playing.includes('data-reduced-motion="true"'))
  assert.ok(playing.includes('暂停'))
  const paused = renderTimeline({ playing: false })
  assert.ok(paused.includes('data-playing="false"'))
  assert.ok(paused.includes('播放'))
})

test('时间轴：没有数据域时不崩（空态，不造 0）', () => {
  const html = renderTimeline({ domain: null, unloadedRanges: [], sessions: [], nodes: [], playhead: NOW })
  assert.ok(html.includes('data-tl-timeline="true"'))
  assert.equal(cutCount(html, 'class="tl-unloaded"'), 0)
  assert.equal(html.includes('data-unloaded-hint="true"'), false)
})
