/*
 * rail.test.ts —— 右栏目录卡片（33 §2/§4）：纯聚合 + 静态渲染。
 *
 * 覆盖：全部 nodes 参与、确定性排序、5 类构成、top3、本轮徽章、选中/变淡、
 * 两列网格类名、长目录名 title、空态。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  buildDirectoryCards,
  compareDirectoryCards,
  defaultDirectoryKey,
  DIRECTORY_TOP_FILES,
  directoryCardsSummary,
  directoryKeyOf,
  DirectoryRail,
  FILE_FAMILIES,
} from '../../src/client/ui/rail/index.ts'
import { makeFiles, NOW, REAL_DIRS } from './fixtures.ts'

const h = React.createElement

function file(path: string, options: { ops?: number; lastAt?: number; family?: 'text' | 'code' | 'data' | 'media' | 'other' } = {}) {
  const slash = path.lastIndexOf('/')
  const name = slash === -1 ? path : path.slice(slash + 1)
  const dir = slash === -1 ? '' : path.slice(0, slash)
  const ops = options.ops ?? 1
  const lastAt = options.lastAt ?? NOW - 60_000
  return {
    path,
    name,
    dir,
    family: options.family ?? ('code' as const),
    firstAt: lastAt - 1000,
    lastAt,
    reads: ops,
    writes: 0,
    searches: 0,
    added: 0,
    removed: 0,
    ops,
    sessionIds: ['sess-0001'],
    sessionCount: 1,
    turnCount: 1,
  }
}

function renderRail(overrides: Record<string, unknown> = {}): string {
  return renderToStaticMarkup(
    h(DirectoryRail, {
      nodes: makeFiles({ count: 200 }),
      selectedKey: null,
      onSelect: () => undefined,
      locale: 'zh',
      formatTime: (at: number) => new Date(at).toISOString().slice(0, 16).replace('T', ' '),
      ...overrides,
    }),
  )
}

test('聚合：全部 nodes 参与（不受图 40 上限影响），计数与 ops 对得上', () => {
  const files = makeFiles({ count: 260, seed: 7 })
  const cards = buildDirectoryCards(files)
  const summary = directoryCardsSummary(cards)
  assert.equal(summary.files, 260)
  assert.equal(summary.files, files.length)
  assert.equal(summary.ops, files.reduce((sum, node) => sum + node.ops, 0))
  assert.equal(summary.dirs, new Set(files.map((node) => directoryKeyOf(node.path))).size)
  assert.equal(cards.reduce((sum, card) => sum + card.count, 0), 260)
})

test('默认目录：当前会话最活跃目录优先；会话无文件时退回全工作区（T33-verify M2）', () => {
  const first = file('projects/a.ts', { ops: 5 })
  const second = file('projects/b.ts', { ops: 9 })
  for (const node of [first, second]) node.sessionIds = ['s-current']
  const other = file('output/c.ts', { ops: 500 })
  other.sessionIds = ['s-other']
  const nodes = [first, second, other]
  // 当前会话里 projects 总 ops=14，output 只在别的会话（500）→ 仍应选 projects。
  assert.equal(defaultDirectoryKey(nodes, 's-current'), 'projects')
  assert.equal(defaultDirectoryKey(nodes, 's-other'), 'output')
  // 当前会话没有任何文件 → 退回全工作区最活跃目录。
  assert.equal(defaultDirectoryKey(nodes, 's-unknown'), 'output')
})

test('hover 联动：data-hover / data-related 标记（不改变选中）', () => {
  const nodes = makeFiles({ count: 60, dirs: ['src', 'docs'] })
  const cards = buildDirectoryCards(nodes)
  const hovered = cards[0].key
  const related = new Set([cards[1].key])
  const html = renderRail({ nodes, hoveredKey: hovered, relatedKeys: related, selectedKey: cards[1].key })
  assert.ok(html.includes('data-hover="true"'))
  assert.ok(html.includes('data-related="true"'))
  assert.ok(html.includes('data-selected="true"'))
})

test('确定性：同一份数据两次聚合（含输入逆序）逐字段相同', () => {
  const files = makeFiles({ count: 120 })
  const first = buildDirectoryCards(files)
  const second = buildDirectoryCards(files)
  const reversed = buildDirectoryCards(files.slice().reverse())
  assert.deepEqual(first, second)
  assert.deepEqual(first, reversed)
})

test('排序：totalOps 降序 → count 降序 → key 升序', () => {
  const nodes = [
    file('b/x.ts', { ops: 5 }),
    file('b/y.ts', { ops: 5 }),
    file('a/x.ts', { ops: 5 }),
    file('c/x.ts', { ops: 9 }),
    file('d/only.ts', { ops: 1 }),
    file('root.md', { ops: 5 }),
  ]
  const cards = buildDirectoryCards(nodes)
  assert.deepEqual(
    cards.map((card) => card.key),
    ['b', 'c', '', 'a', 'd'],
  )
  assert.deepEqual(cards, cards.slice().sort(compareDirectoryCards))
})

test('5 类构成：FILE_FAMILIES 顺序 + 空类保留 0（渲染时跳过）', () => {
  const nodes = [
    file('src/a.ts', { family: 'code' }),
    file('src/b.md', { family: 'text' }),
    file('src/c.json', { family: 'data' }),
    file('src/d.png', { family: 'media' }),
    file('src/e.bin', { family: 'other' }),
  ]
  const [card] = buildDirectoryCards(nodes)
  assert.deepEqual(
    card.families.map((item) => item.family),
    [...FILE_FAMILIES],
  )
  for (const family of FILE_FAMILIES) {
    const slot = card.families.find((item) => item.family === family)
    assert.ok(slot)
    assert.equal(slot.count, 1)
  }
  assert.equal(FILE_FAMILIES.length, 5)
})

test('topFiles：前 3（ops → lastAt → path），并带族色点所需信息', () => {
  const nodes = [
    file('src/z.ts', { ops: 5, lastAt: NOW - 10 }),
    file('src/a.ts', { ops: 5, lastAt: NOW - 10 }),
    file('src/m.ts', { ops: 5, lastAt: NOW - 10 }),
    file('src/hot.ts', { ops: 9, lastAt: NOW - 99 }),
    file('src/fresh.ts', { ops: 5, lastAt: NOW - 1 }),
  ]
  const [card] = buildDirectoryCards(nodes)
  assert.equal(DIRECTORY_TOP_FILES, 3)
  assert.deepEqual(
    card.topFiles.map((item) => item.name),
    ['hot.ts', 'fresh.ts', 'a.ts'],
  )
})

test('本轮计数：currentTurnPaths 命中的文件数；未传 = 0', () => {
  const nodes = [file('src/a.ts'), file('src/b.ts'), file('docs/c.md')]
  const withTurn = buildDirectoryCards(nodes, { currentTurnPaths: ['src/a.ts', 'docs/c.md'] })
  assert.equal(withTurn.find((card) => card.key === 'src')?.currentCount, 1)
  assert.equal(withTurn.find((card) => card.key === 'docs')?.currentCount, 1)
  assert.equal(buildDirectoryCards(nodes).find((card) => card.key === 'src')?.currentCount, 0)
})

test('根目录：空键用 rootLabel；默认回落 /', () => {
  const nodes = [file('README.md'), file('src/a.ts')]
  assert.equal(buildDirectoryCards(nodes).find((card) => card.key === '')?.label, '/')
  assert.equal(buildDirectoryCards(nodes, { rootLabel: '根目录' }).find((card) => card.key === '')?.label, '根目录')
})

test('静态渲染：两列 rail、每目录一张 button 卡、5 类色条、选中/变淡、本轮徽章', () => {
  const nodes = [
    file('src/a.ts', { ops: 9, family: 'code' }),
    file('src/b.md', { ops: 6, family: 'text' }),
    file('src/c.png', { ops: 3, family: 'media' }),
    file('docs/d.md', { ops: 4, family: 'text' }),
  ]
  const html = renderRail({
    nodes,
    selectedKey: 'src',
    currentTurnPaths: ['src/a.ts'],
    activeKeys: new Set(['src']),
  })
  assert.ok(html.includes('class="tl-rail"'))
  assert.equal(cutCount(html, 'data-directory-card="'), 2)
  assert.equal(cutCount(html, '<button type="button"'), 2)
  assert.ok(html.includes('data-directory-card="src"') && html.includes('data-selected="true"'))
  assert.ok(html.includes('data-directory-card="docs"') && html.includes('data-selected="false"'))
  assert.ok(html.includes('data-directory-card="docs"') && html.includes('data-dim="true"'))
  assert.ok(html.includes('本轮 1'))
  // 5 类色条只画非空类：src 有 code/text/media 3 段 + docs 的 text 1 段 = 4 段。
  assert.equal(cutCount(html, 'class="tl-rail-card-seg"'), 4)
  for (const family of ['code', 'text', 'media']) assert.ok(html.includes('data-family="' + family + '"'))
  // 前 3 文件行：src 3 行 + docs 1 行（每张卡各自 top3）。
  assert.equal(cutCount(html, 'class="tl-rail-card-file"'), 4)
})

test('静态渲染：长目录名省略号容器 + title 全名；空数据 EmptyState', () => {
  const longName = '这是一个非常长的顶层目录名称用于验证省略号'
  const html = renderRail({ nodes: [file(longName + '/a.ts')] })
  assert.ok(html.includes('title="' + longName + '"'))
  assert.ok(html.includes('class="tl-rail-card-name"'))
  const empty = renderRail({ nodes: [] })
  assert.ok(empty.includes('data-threadline-empty'))
  assert.ok(empty.includes('有对话记录，但没有文件操作'))
  assert.equal(empty.includes('tl-rail-card'), false)
})

test('20 目录真实规模夹具：卡片数 = 顶层目录数 + 根目录（有根文件时）', () => {
  const cards = buildDirectoryCards(makeFiles({ count: 200, dirs: REAL_DIRS }))
  assert.equal(cards.length, REAL_DIRS.length + 1)
  assert.equal(cards.reduce((sum, card) => sum + card.count, 0), 200)
})

function cutCount(html: string, needle: string): number {
  return html.split(needle).length - 1
}
