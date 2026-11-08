/*
 * hubPairsDom.test.ts —— **枢纽 ↔ 枢纽**连线的 DOM 契约（R11 / 03 §4.2.2）。
 *
 * QA 明确说「不会猜属性名」，所以属性名逐条登记在 `GRAPH_DATA` 里（theme.ts），
 * 这里逐条断言「真的渲染出来了、值真的对」：
 *
 * | 属性 | 值 | 说明 |
 * |---|---|---|
 * | `data-hub-pair` | `<aKey>\u0000<bKey>` | 无向归一键（小写 min/max），**A↔B 只一条** |
 * | `data-hub-pair-a` | 原大小写路径 | 小写较小端 |
 * | `data-hub-pair-b` | 原大小写路径 | 小写较大端 |
 * | `data-hub-pair-weight` | 数字字符串 | 聚合权重和 |
 * | `data-hub-pair-count` | 数字字符串 | 真实边数 |
 * | `data-hub-pair-layer` | `"hub"` | 与文件边的 `data-edge-layer` 区分 |
 * | `data-hub-pair-count`（图根） | 数字 | 本档画出的枢纽间线数（三档断言用） |
 *
 * 另外断言：
 * - **视觉三层可区分**：枢纽间线 = `stroke-dasharray`（CSS 给粗虚线）+
 *   内联 `stroke-width = min(3.2, 0.8+log2(1+w)*0.45)`、内联 `opacity=0.35`；
 *   文件边是实线（无 dasharray 或关系类型色），两者**不得是同一批元素**；
 * - **线没有点击处理器**（点击枢纽仍是进入目录；线不可点、不抢事件）；
 * - 没有真实跨文件夹边 → **一个 `data-hub-pair` 都不许有**（反向断言，防伪造）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { GraphEdge } from '../../src/shared/relations/index.ts'
import {
  FileGraph,
  GRAPH_DATA,
  GRAPH_HUB_PAIR_OPACITY,
  GRAPH_HUB_PAIR_WIDTH_MAX,
  hubPairStrokeWidth,
  type FileGraphProps,
  type MapEntry,
} from '../../src/client/ui/map/index.ts'
import { NOW } from './fixtures.ts'

const h = React.createElement

function dirEntry(path: string): MapEntry {
  return { name: path.slice(path.lastIndexOf('/') + 1), path, kind: 'directory' }
}

function fileEntry(path: string): MapEntry {
  return { name: path.slice(path.lastIndexOf('/') + 1), path, kind: 'file' }
}

function hubEdge(from: string, to: string, weight: number): GraphEdge {
  return {
    id: 'e:' + from + '>' + to,
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

/** 根目录：4 个子文件夹 + 1 个根文件；a↔b 强、a↔c 弱、d 完全孤立。 */
function renderRoot(overrides: Partial<FileGraphProps> = {}): string {
  const entries: MapEntry[] = [dirEntry('a'), dirEntry('b'), dirEntry('c'), dirEntry('d'), fileEntry('root.ts')]
  const allEdges: GraphEdge[] = [hubEdge('a/1.ts', 'b/1.ts', 90), hubEdge('a/1.ts', 'c/1.ts', 4)]
  return renderToStaticMarkup(
    h(FileGraph, {
      mode: 'folder',
      entries,
      files: [],
      edges: [],
      allEdges,
      currentPath: '',
      now: NOW,
      locale: 'zh',
      testId: 'graph',
      ...overrides,
    }),
  )
}

/** 从 SSR HTML 里抽出 `data-hub-pair="..."` 的值。 */
function hubPairKeys(html: string): string[] {
  return [...html.matchAll(/data-hub-pair="([^"]*)"/g)].map((match) => match[1])
}

/** 抽出一个属性在某元素上的值（按 `data-hub-pair` 定位行做粗粒度解析）。 */
function hubPairElements(html: string): string[] {
  return [...html.matchAll(/<line[^>]*data-hub-pair="[^"]*"[^>]*>/g)].map((match) => match[0])
}

function attrOf(element: string, name: string): string | undefined {
  const match = new RegExp(name + '="([^"]*)"').exec(element)
  return match === null ? undefined : match[1]
}

/* ================================================================== *
 * 契约：属性齐全、值正确
 * ================================================================== */

test('DOM 契约：枢纽间连线是 <line>，带全 6 个属性（QA 不猜属性名）', () => {
  const html = renderRoot()
  const pairs = hubPairElements(html)
  assert.ok(pairs.length > 0, '标准档（默认）必须画出枢纽间连线')
  for (const element of pairs) {
    assert.ok(attrOf(element, GRAPH_DATA.hubPair) !== undefined, '缺 data-hub-pair：' + element)
    assert.ok(attrOf(element, 'data-hub-pair-a') !== undefined, '缺 data-hub-pair-a')
    assert.ok(attrOf(element, 'data-hub-pair-b') !== undefined, '缺 data-hub-pair-b')
    assert.ok(attrOf(element, 'data-hub-pair-weight') !== undefined, '缺 data-hub-pair-weight')
    assert.ok(attrOf(element, 'data-hub-pair-count') !== undefined, '缺 data-hub-pair-count')
    assert.equal(attrOf(element, 'data-hub-pair-layer'), 'hub', 'data-hub-pair-layer 必须是 "hub"（与文件边区分）')
  }
})

test('DOM 契约：data-hub-pair 是**小写 min/max 归一键**，A↔B 只出现一次（无向去重）', () => {
  const html = renderRoot()
  const keys = hubPairKeys(html)
  assert.ok(keys.length > 0)
  for (const key of keys) {
    const [a, b] = key.split('\u0000')
    assert.ok(a !== undefined && b !== undefined, '键必须是 a\\u0000b：' + JSON.stringify(key))
    assert.equal(a, a.toLowerCase(), '键内路径必须小写：' + key)
    assert.equal(b, b.toLowerCase(), '键内路径必须小写：' + key)
    assert.ok(a < b, '键必须 min/max 归一（a < b）：' + key)
  }
  assert.equal(new Set(keys).size, keys.length, '同一个无向对不得出现两条线（A↔B 与 B↔A 只许一条）')
})

test('DOM 契约：data-hub-pair-a/-b 是当前目录**直接子文件夹**的原路径；键 = 两者小写归一', () => {
  const html = renderRoot()
  const hubPaths = new Set(['a', 'b', 'c', 'd'])
  for (const element of hubPairElements(html)) {
    const a = attrOf(element, 'data-hub-pair-a')
    const b = attrOf(element, 'data-hub-pair-b')
    assert.ok(a !== undefined && b !== undefined)
    assert.ok(hubPaths.has(a), 'a 端必须是当前目录的直接子文件夹：' + a)
    assert.ok(hubPaths.has(b), 'b 端必须是当前目录的直接子文件夹：' + b)
    assert.notEqual(a, b, '两端不得是同一个文件夹')
    assert.equal(attrOf(element, GRAPH_DATA.hubPair), [a.toLowerCase(), b.toLowerCase()].sort().join('\u0000'))
  }
})

test('DOM 契约：weight / count 是数字，且与真实边一致（a↔b weight=90 count=1）', () => {
  const html = renderRoot()
  const pairs = hubPairElements(html)
  const strong = pairs.find((element) => {
    const a = attrOf(element, 'data-hub-pair-a')
    const b = attrOf(element, 'data-hub-pair-b')
    return new Set([a, b]).size === 2 && new Set([a, b]).has('a') && new Set([a, b]).has('b')
  })
  assert.ok(strong !== undefined, 'a↔b 这条线必须存在（a 端 top-1）')
  assert.equal(Number(attrOf(strong, 'data-hub-pair-weight')), 90)
  assert.equal(Number(attrOf(strong, 'data-hub-pair-count')), 1)
})

test('DOM 契约：图根有 data-hub-pair-count（本档画出的线数）与 data-hub-pair-partners（档位口径）', () => {
  const html = renderRoot()
  const root = /<div[^>]*data-tl-graph="true"[^>]*>/.exec(html)
  assert.ok(root !== null)
  const count = attrOf(root[0], GRAPH_DATA.hubPairCount)
  assert.ok(count !== undefined, '图根必须带 data-hub-pair-count')
  assert.equal(Number(count), hubPairKeys(html).length, '图根计数必须等于实际画出的线数')
  assert.equal(Number(attrOf(root[0], 'data-hub-pair-partners')), 2, '默认标准档 = 每枢纽 top-2')
})

/* ================================================================== *
 * 三层视觉可区分（不能和文件边混成一层）
 * ================================================================== */

test('视觉分层：枢纽间线带权重线宽 + 0.35 透明度；文件边不带这些属性', () => {
  const html = renderRoot()
  const pairs = hubPairElements(html)
  assert.ok(pairs.length > 0)
  for (const element of pairs) {
    const weight = Number(attrOf(element, 'data-hub-pair-weight'))
    const expected = hubPairStrokeWidth(weight)
    assert.equal(Number(attrOf(element, 'stroke-width')), expected, '线宽必须按聚合权重算')
    assert.ok(expected <= GRAPH_HUB_PAIR_WIDTH_MAX, '线宽必须封顶（不得比文件边更抢眼）')
    assert.equal(Number(attrOf(element, 'opacity')), GRAPH_HUB_PAIR_OPACITY, '默认透明度 0.35')
  }
  // 文件边（data-edge-id）必须**不含**枢纽间属性 —— 两层不能混。
  for (const element of [...html.matchAll(/<line[^>]*data-edge-id="[^"]*"[^>]*>/g)].map((match) => match[0])) {
    assert.equal(attrOf(element, GRAPH_DATA.hubPair), undefined, '文件边不得带 data-hub-pair')
    assert.equal(attrOf(element, 'data-hub-pair-layer'), undefined, '文件边不得带 data-hub-pair-layer')
  }
})

test('视觉分层：枢纽间线**没有点击处理器**（点击枢纽仍是进入目录，语义不变）', () => {
  const html = renderRoot()
  // SSR 不输出事件处理器；这里断言它**不在任何 role=button 的组里**（线本身不可点）。
  for (const element of hubPairElements(html)) {
    assert.equal(attrOf(element, 'role'), undefined, '线不得是 role=button')
    assert.equal(attrOf(element, 'tabindex'), undefined, '线不得可聚焦（键盘 Tab 不该停在线上）')
    assert.equal(attrOf(element, 'onclick'), undefined, '线不得带点击处理器')
  }
  // 枢纽仍然是 role=button（点击入口不变）。
  assert.ok(/data-folder-hub="a"[^>]*role="button"|role="button"[^>]*data-folder-hub="a"/.test(html), '枢纽必须仍是按钮（点击进目录）')
})

/* ================================================================== *
 * 反向断言（防伪造）
 * ================================================================== */

test('反向：没有真实跨文件夹边 → 一个 data-hub-pair 都不许有', () => {
  const entries: MapEntry[] = [dirEntry('a'), dirEntry('b'), dirEntry('c'), fileEntry('root.ts')]
  const html = renderToStaticMarkup(
    h(FileGraph, {
      mode: 'folder',
      entries,
      files: [],
      edges: [],
      // 只有文件夹内部边 + 当前目录内部边，**没有任何跨文件夹边**。
      allEdges: [hubEdge('a/1.ts', 'a/2.ts', 90), hubEdge('root.ts', 'a/1.ts', 80)],
      currentPath: '',
      now: NOW,
      locale: 'zh',
      testId: 'graph',
    }),
  )
  assert.equal(hubPairKeys(html).length, 0, '没有真实边就一条都不许画')
  assert.ok(html.includes('data-folder-hub='), '枢纽卡仍然要画（只是不连线）')
  assert.equal(Number(attrOf(/<div[^>]*data-tl-graph="true"[^>]*>/.exec(html)?.[0] ?? '', GRAPH_DATA.hubPairCount)), 0)
})

test('反向：allEdges 缺省 → 不画枢纽间线（不做、不猜、不伪造）', () => {
  const html = renderRoot({ allEdges: undefined })
  assert.equal(hubPairKeys(html).length, 0)
  assert.equal(Number(attrOf(/<div[^>]*data-tl-graph="true"[^>]*>/.exec(html)?.[0] ?? '', GRAPH_DATA.hubPairCount)), 0)
})

test('反向：turn 模式不画枢纽间线（那是轮次视图，不是目录层）', () => {
  const html = renderToStaticMarkup(
    h(FileGraph, {
      mode: 'turn',
      entries: [dirEntry('a'), dirEntry('b')],
      files: [],
      edges: [],
      allEdges: [hubEdge('a/1.ts', 'b/1.ts', 90)],
      currentPath: '',
      now: NOW,
      locale: 'zh',
      testId: 'graph',
    }),
  )
  assert.equal(hubPairKeys(html).length, 0, 'turn 模式不得出现目录层的枢纽间连线')
})
