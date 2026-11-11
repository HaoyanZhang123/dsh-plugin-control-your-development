/*
 * rail.test.ts —— 右栏**工作区文件浏览器**（R03；07 §3）：纯模型 + 静态渲染 + 样式纪律。
 *
 * 覆盖（逐条对应 task-4 验收）：
 * 1. 行模型：目录→文件→other 顺序透传、类型 key、大小文本（不伪造 0 B）、
 *    **未触碰条目不产生 ops**（不显示假 0）、本轮徽标、选中/悬浮、family 来自数据层；
 * 2. 列表窗口：>200 行虚拟化（区间/上下占位/总高），≤200 行整段渲染，边界不越界；
 * 3. 静态渲染（SSR）：面包屑（根/各段可点 + aria-current）、回退/更新/卡片-列表按钮
 *    全部有可读 aria-label、卡片三类、文件是终端、列表表格语义、
 *    空/错误/截断显式、loading 保留旧内容 + 内联进度（**不整块空白/骨架**）；
 * 4. 无整块说明文案（07 §3.4：头部只有图标）；
 * 5. 样式纪律：只用 tokens（无颜色字面量）、无 viewport media query、
 *    容器查询指名 threadline 容器、列表行高常量与 CSS 一致、无横向滚动隐患。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  FileTreeRail,
  RAIL_LIST_ROW_HEIGHT,
  RAIL_VIRTUAL_THRESHOLD,
  breadcrumbSegments,
  buildRailRows,
  computeRailWindow,
  findScrollableAncestor,
  formatTreeSize,
  isScrollableOverflow,
  railKeyAction,
  railRowDomId,
  railScrollMetrics,
  treeKindKey,
  type FileTreeRailProps,
  type RailTouchInfo,
} from '../../src/client/ui/rail/index.ts'
import { createTranslator } from '../../src/client/locale/index.ts'
import { listKeyNav } from '../../src/client/a11y/index.ts'
import type { TreeEntry } from '../../src/client/data/index.ts'

const h = React.createElement
const t = createTranslator('zh')
const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

/* ------------------------------------------------------------------ *
 * 夹具
 * ------------------------------------------------------------------ */

/** 一个目录条目（family 由数据层算好，这里照抄它的口径：按扩展名）。 */
function entry(name: string, kind: TreeEntry['kind'] = 'file', size?: number): TreeEntry {
  const path = name
  const family =
    kind === 'directory'
      ? ('other' as const)
      : name.endsWith('.ts')
        ? ('code' as const)
        : name.endsWith('.md')
          ? ('text' as const)
          : name.endsWith('.json')
            ? ('data' as const)
            : name.endsWith('.png')
              ? ('media' as const)
              : ('other' as const)
  return size === undefined ? { name, path, kind, family } : { name, path, kind, family, size }
}

/** 混合目录：目录在前、文件次之、other 最后（数据层保证；这里照它的顺序给）。 */
function mixedEntries(): TreeEntry[] {
  return [
    entry('src', 'directory'),
    entry('docs', 'directory'),
    entry('README.md', 'file', 1024),
    entry('main.ts', 'file', 2048),
    entry('data.json', 'file', 100),
    entry('logo.png', 'file', 5_000_000),
    entry('symlink-out', 'other'),
  ]
}

function renderRail(overrides: Partial<FileTreeRailProps> = {}): string {
  return renderToStaticMarkup(
    h(FileTreeRail, {
      currentPath: '',
      entries: mixedEntries(),
      status: 'ready' as const,
      onNavigate: () => undefined,
      onBack: () => undefined,
      onRefresh: () => undefined,
      onSelectFile: () => undefined,
      locale: 'zh',
      testId: 'file-tree',
      ...overrides,
    }),
  )
}

function cutCount(html: string, needle: string): number {
  return html.split(needle).length - 1
}

/* ------------------------------------------------------------------ *
 * 1. 纯模型：行 / 类型 / 大小 / ops
 * ------------------------------------------------------------------ */

test('行模型：顺序透传数据层（目录→文件→other），类型 key 与 family 来自数据层', () => {
  const rows = buildRailRows(mixedEntries())
  assert.deepEqual(
    rows.map((row) => `${row.kind}:${row.name}`),
    [
      'directory:src',
      'directory:docs',
      'file:README.md',
      'file:main.ts',
      'file:data.json',
      'file:logo.png',
      'other:symlink-out',
    ],
  )
  assert.equal(rows[0].typeKey, 'tree.folder')
  assert.equal(rows[2].typeKey, 'inspector.file')
  assert.equal(rows[6].typeKey, 'fileFamily.other')
  // family 直接用数据层的（不是重推一次）
  assert.deepEqual(rows.map((row) => row.family), ['other', 'other', 'text', 'code', 'data', 'media', 'other'])
  assert.deepEqual(treeKindKey('directory'), 'tree.folder')
  assert.deepEqual(treeKindKey('file'), 'inspector.file')
  assert.deepEqual(treeKindKey('other'), 'fileFamily.other')
})

test('ops：未触碰的条目**没有** ops（null，不是 0）——渲染层据此不画徽标', () => {
  const entries = [entry('a.ts'), entry('b.ts'), entry('c.ts')]
  const touched = new Map<string, RailTouchInfo>([
    ['b.ts', { ops: 7, lastAt: 1_700_000_000_000 }],
    ['c.ts', { ops: 0, lastAt: 1_700_000_000_000 }], // 0 = 未触碰（不显示假 0）
    ['a.ts', { ops: Number.NaN }],
  ])
  const rows = buildRailRows(entries, { touched })
  assert.equal(rows[0].ops, null, 'NaN 不算触碰')
  assert.equal(rows[1].ops, 7)
  assert.equal(rows[2].ops, null, 'ops=0 视为未触碰，徽标不渲染')
  const html = renderToStaticMarkup(
    h(FileTreeRail, {
      currentPath: '',
      entries,
      status: 'ready' as const,
      touched,
      onNavigate: () => undefined,
      onBack: () => undefined,
      onRefresh: () => undefined,
      onSelectFile: () => undefined,
      locale: 'zh',
    }),
  )
  assert.equal(cutCount(html, 'data-ops='), 1, '只有真正触碰过的 b.ts 有 ops 徽标')
  assert.ok(html.includes('data-ops="7"'))
  assert.equal(/data-ops="0"/.test(html), false, '绝不渲染假 0')
  assert.equal(html.includes('0 次操作'), false)
})

test('大小文本：B/KB/MB/GB 确定性；未知/负数/NaN → null（不显示 0 B）', () => {
  assert.equal(formatTreeSize(0), '0 B')
  assert.equal(formatTreeSize(1), '1 B')
  assert.equal(formatTreeSize(1023), '1023 B')
  assert.equal(formatTreeSize(1024), '1 KB')
  assert.equal(formatTreeSize(1536), '1.5 KB')
  assert.equal(formatTreeSize(1024 * 1024), '1 MB')
  assert.equal(formatTreeSize(1024 * 1024 * 1024), '1 GB')
  assert.equal(formatTreeSize(1024 * 1024 * 1024 * 1.5), '1.5 GB')
  assert.equal(formatTreeSize(null), null)
  assert.equal(formatTreeSize(undefined), null)
  assert.equal(formatTreeSize(-1), null)
  assert.equal(formatTreeSize(Number.NaN), null)
  assert.equal(formatTreeSize(Number.POSITIVE_INFINITY), null)
  // 目录即使宿主给了 size 也不显示（行模型只对 file 取 size）
  const rows = buildRailRows([{ name: 'dir', path: 'dir', kind: 'directory', family: 'other', size: 4096 }])
  assert.equal(rows[0].size, null)
  assert.equal(rows[0].sizeText, null)
})

test('选中/悬浮/本轮：大小写不敏感匹配；未传则为 false', () => {
  const entries = [entry('Src/A.ts'), entry('b.ts')]
  const rows = buildRailRows(entries, {
    selectedPath: 'src/a.ts',
    hoveredPath: 'B.TS',
    currentTurnPaths: ['SRC/A.TS'],
  })
  assert.equal(rows[0].selected, true)
  assert.equal(rows[1].selected, false)
  assert.equal(rows[1].hovered, true)
  assert.equal(rows[0].currentTurn, true)
  assert.equal(rows[1].currentTurn, false)
  const plain = buildRailRows(entries)
  assert.equal(plain[0].selected, false)
  assert.equal(plain[0].hovered, false)
  assert.equal(plain[0].currentTurn, false)
})

/* ------------------------------------------------------------------ *
 * 2. 面包屑 + 虚拟化窗口
 * ------------------------------------------------------------------ */

test('面包屑段：根为空数组；每段带完整路径（任意段可跳）', () => {
  assert.deepEqual(breadcrumbSegments(''), [])
  assert.deepEqual(breadcrumbSegments('src'), [{ name: 'src', path: 'src' }])
  assert.deepEqual(breadcrumbSegments('src/client/ui'), [
    { name: 'src', path: 'src' },
    { name: 'client', path: 'src/client' },
    { name: 'ui', path: 'src/client/ui' },
  ])
})

test('虚拟化：>200 行才开窗；≤200 行整段；区间与占位一致、不越界', () => {
  assert.equal(RAIL_VIRTUAL_THRESHOLD, 200)
  assert.equal(RAIL_LIST_ROW_HEIGHT, 30)

  const small = computeRailWindow({ count: 200 })
  assert.equal(small.virtual, false)
  assert.deepEqual([small.start, small.end], [0, 200])
  assert.equal(small.topPad, 0)
  assert.equal(small.bottomPad, 0)

  const big = computeRailWindow({ count: 500, scrollPx: 0, viewportHeight: 600 })
  assert.equal(big.virtual, true)
  assert.equal(big.start, 0, '首屏从第 0 行开始')
  assert.ok(big.end > 0 && big.end < 500, '首屏只渲染窗口内的行')
  assert.equal(big.totalHeight, 500 * RAIL_LIST_ROW_HEIGHT)
  assert.equal(big.topPad, 0)
  assert.equal(big.bottomPad, big.totalHeight - big.end * RAIL_LIST_ROW_HEIGHT)

  // 滚到中间：上下都有占位，且占位之和 = 总高 - 渲染行高
  const middle = computeRailWindow({ count: 500, scrollPx: 3000, viewportHeight: 600 })
  assert.ok(middle.start > 0)
  assert.equal(middle.topPad, middle.start * RAIL_LIST_ROW_HEIGHT)
  const rendered = (middle.end - middle.start) * RAIL_LIST_ROW_HEIGHT
  assert.equal(middle.topPad + rendered + middle.bottomPad, middle.totalHeight)

  // 滚到底：end 夹到 count，不越界
  const bottom = computeRailWindow({ count: 500, scrollPx: 10 ** 7, viewportHeight: 600 })
  assert.equal(bottom.end, 500)
  assert.equal(bottom.bottomPad, 0)
  assert.ok(bottom.start <= bottom.end)

  // 0 行 / 负数：安全
  assert.deepEqual(computeRailWindow({ count: 0 }), { start: 0, end: 0, topPad: 0, bottomPad: 0, virtual: false, totalHeight: 0 })
  const negative = computeRailWindow({ count: -5 })
  assert.equal(negative.end, 0)
})

test('列表虚拟化：500 行只渲染窗口内的行 + 两个占位块（DOM 行数断言）', () => {
  const many = Array.from({ length: 500 }, (_, index) => entry(`f${String(index).padStart(3, '0')}.ts`))
  const html = renderRail({ entries: many, viewMode: 'list' })
  const renderedRows = cutCount(html, 'data-tree-row=')
  assert.ok(renderedRows > 0, '至少有渲染行')
  assert.ok(renderedRows < 100, '不许一次渲染 500 行（当前 ' + renderedRows + ' 行）')
  assert.equal(html.includes('data-virtualized="true"'), true)
  assert.ok(html.includes('class="tl-tree-pad"'), '底部占位块存在（保持滚动高度）')
  assert.ok(html.includes('aria-rowcount="500"'), '总行数由 aria-rowcount 给出')
})

/* ------------------------------------------------------------------ *
 * 3. 静态渲染
 * ------------------------------------------------------------------ */

test('头部：面包屑（根 + 各段可点 + aria-current）、回退/更新/视图切换全部有 aria-label', () => {
  const html = renderRail({
    currentPath: 'src/client',
    entries: [entry('ui', 'directory'), entry('index.ts', 'file', 12)],
    onViewModeChange: () => undefined,
  })
  // 面包屑：根 + src + client，最后一段 aria-current
  assert.ok(html.includes('data-crumb-path=""'), '根段可点')
  assert.ok(html.includes('data-crumb-path="src"'))
  assert.ok(html.includes('data-crumb-path="src/client"'))
  assert.equal(cutCount(html, 'aria-current="location"'), 1, '只有当前层是 aria-current')
  assert.ok(/data-crumb-path="src\/client"[^>]*aria-current="location"/.test(html) || /aria-current="location"[^>]*data-crumb-path="src\/client"/.test(html))
  assert.ok(html.includes('aria-label="路径"'), '面包屑 nav 有可读名（tree.path）')
  // 三个图标动作：回退 / 更新 / 卡片-列表切换
  assert.ok(html.includes('data-testid="rail-back"'))
  assert.ok(html.includes('aria-label="回退"'))
  assert.ok(html.includes('data-testid="rail-refresh"'))
  assert.ok(html.includes('aria-label="更新"'))
  assert.ok(html.includes('data-testid="rail-view-toggle"'))
  assert.ok(html.includes('aria-label="列表视图"'), '卡片模式下切换按钮读作"列表视图"')
  // 没有大段说明文案（头部只有图标 + 面包屑）
  for (const forbidden of ['点右侧卡片展开目录', '拖动节点可调整位置', '可拖动节点', '基于已加载']) {
    assert.equal(html.includes(forbidden), false, '右栏不许出现旧说明文案：' + forbidden)
  }
})

test('回退按钮：根层禁用；非根可用', () => {
  const root = renderRail({ currentPath: '' })
  assert.ok(/data-testid="rail-back"[^>]*disabled|disabled[^>]*data-testid="rail-back"/.test(root), '根层回退必须禁用')
  const deep = renderRail({ currentPath: 'src', entries: [entry('a.ts')] })
  assert.equal(/data-testid="rail-back"[^>]*disabled/.test(deep), false, '非根层可点')
})

test('卡片：三类条目都渲染；文件/other 是终端（data-terminal=true），目录可进入', () => {
  const html = renderRail()
  assert.equal(cutCount(html, 'class="tl-tree-card"'), mixedEntries().length)
  assert.ok(/data-tree-row="src"[^>]*data-kind="directory"[^>]*data-terminal="false"/.test(html))
  assert.ok(/data-tree-row="README.md"[^>]*data-kind="file"[^>]*data-terminal="true"/.test(html))
  assert.ok(/data-tree-row="symlink-out"[^>]*data-kind="other"[^>]*data-terminal="true"/.test(html))
  // 类型既有图标也有文字（颜色/图标不是唯一信息）
  assert.ok(html.includes('data-kind="directory"') && html.includes('>文件夹<'))
  assert.ok(html.includes('>文件<'))
  assert.ok(html.includes('>其它<'))
  // 文件大小显示（有则显示）
  assert.ok(html.includes('2 KB'), 'main.ts 2048 字节 → 2 KB')
  assert.ok(html.includes('1 KB'), 'README.md 1024 → 1 KB')
})

test('列表：表格语义 + 行单选按钮 + 名称/类型/大小列；长名有 title 全路径', () => {
  const longName = 'a-very-long-file-name-that-would-overflow-the-narrow-rail-container.ts'
  const html = renderRail({
    viewMode: 'list',
    currentPath: 'src/deeply/nested/directory',
    entries: [entry('ui', 'directory'), entry(longName, 'file', 4096)],
    onViewModeChange: () => undefined,
  })
  assert.ok(html.includes('role="table"'))
  assert.ok(html.includes('role="rowgroup"'))
  assert.ok(html.includes('aria-rowcount="2"'))
  assert.equal(cutCount(html, 'class="tl-tree-row"'), 2)
  assert.ok(html.includes('class="tl-tree-thead"'), '列表有表头行')
  assert.ok(html.includes('title="' + longName + '"'), '长名 title 给全名（省略号由 CSS 做）')
  // 列表模式的切换按钮读作"卡片视图"（当前是列表）
  assert.ok(html.includes('aria-label="卡片视图"'))
  assert.ok(html.includes('aria-pressed="true"'), '切换按钮有按下态')
})

test('空目录：显示「空文件夹」（不是 0 项假数据，也不画空卡片）', () => {
  const html = renderRail({ entries: [], status: 'empty' as const })
  assert.ok(html.includes('data-testid="rail-empty"'))
  assert.ok(html.includes('空文件夹'))
  assert.equal(html.includes('class="tl-tree-card"'), false)
  assert.equal(html.includes('class="tl-tree-row"'), false)
})

test('读取失败：role=alert + 「读取失败」+ 只读重试（文案用「重新读取」，不是「重试」）', () => {
  const html = renderRail({ entries: [], status: 'error' as const, errorCode: 'unreadable' as const })
  assert.ok(html.includes('role="alert"'))
  assert.ok(html.includes('data-testid="rail-error"'))
  assert.ok(html.includes('读取失败'))
  assert.ok(html.includes('data-testid="rail-retry"'))
  assert.ok(html.includes('重新读取'), 'tree.retry 的值是「重新读取」')
  assert.equal(html.includes('>重试<'), false, '禁用词：不许出现「重试」')
})

test('数据源不可用：显示「观测不到」，不假装空文件夹', () => {
  const html = renderRail({ entries: [], status: 'error' as const, source: 'none' as const, errorCode: 'no-source' as const })
  assert.ok(html.includes('观测不到工作区记录'))
  assert.equal(html.includes('data-testid="rail-empty"'), false, '无源不许显示「空文件夹」')
})

test('truncated：显式「显示前 N 项」，不静默', () => {
  const html = renderRail({ truncated: true })
  assert.ok(html.includes('data-testid="rail-truncated"'))
  assert.ok(html.includes('显示前 ' + String(mixedEntries().length) + ' 项'))
})

test('loading：保留旧内容 + 内联细进度（不整块空白、不出骨架块）', () => {
  const html = renderRail({ status: 'loading' as const })
  assert.ok(html.includes('data-testid="rail-progress"'), '有内联进度条')
  assert.ok(html.includes('role="progressbar"'))
  assert.equal(cutCount(html, 'class="tl-tree-card"'), mixedEntries().length, '旧内容必须保留（不空白）')
  assert.equal(html.includes('threadline-skeleton'), false, '不许用整块骨架替代')
})

test('选中文件：data-selected + aria-pressed；悬停标记不影响选中', () => {
  const html = renderRail({ selectedPath: 'main.ts', hoveredPath: 'README.md' })
  assert.ok(/data-tree-row="main\.ts"[^>]*data-selected="true"/.test(html))
  assert.ok(/data-tree-row="README\.md"[^>]*data-selected="false"[^>]*data-hover="true"/.test(html) || /data-tree-row="README\.md"[^>]*data-hover="true"[^>]*data-selected="false"/.test(html))
  assert.ok(html.includes('aria-pressed="true"'))
})

/* ------------------------------------------------------------------ *
 * 4. 键盘（复用 a11y 的唯一状态机）
 * ------------------------------------------------------------------ */

test('键盘：↑↓/Home/End/Enter/Escape 经 railKeyAction 投影（单列，不越界）', () => {
  const base = { index: 1, count: 3 }
  assert.equal(railKeyAction(listKeyNav, { ...base, key: 'ArrowDown' }).nextIndex, 2)
  assert.equal(railKeyAction(listKeyNav, { ...base, key: 'ArrowUp' }).nextIndex, 0)
  assert.equal(railKeyAction(listKeyNav, { index: 2, count: 3, key: 'ArrowDown' }).nextIndex, 2, '到底不越界')
  assert.equal(railKeyAction(listKeyNav, { index: 0, count: 3, key: 'ArrowUp' }).nextIndex, 0, '到顶不越界')
  assert.equal(railKeyAction(listKeyNav, { ...base, key: 'Home' }).nextIndex, 0)
  assert.equal(railKeyAction(listKeyNav, { index: 0, count: 3, key: 'End' }).nextIndex, 2)
  const enter = railKeyAction(listKeyNav, { ...base, key: 'Enter' })
  assert.equal(enter.activate, true)
  assert.equal(enter.handled, true)
  const escape = railKeyAction(listKeyNav, { ...base, key: 'Escape' })
  assert.equal(escape.escape, true)
  assert.equal(railKeyAction(listKeyNav, { ...base, key: 'a' }).handled, false, '其它键不抢默认行为')
  assert.equal(railKeyAction(listKeyNav, { index: 0, count: 0, key: 'ArrowDown' }).nextIndex, -1, '空列表没有焦点行')
})

test('键盘可达：卡片/列表行是 button 且 roving tabindex（只有一个 0）', () => {
  const cards = renderRail({ selectedPath: 'main.ts' })
  assert.equal(cutCount(cards, 'tabindex="0"'), 1, 'roving tabindex：只有一个行可 Tab 到')
  assert.ok(cutCount(cards, 'tabindex="-1"') > 0)
  assert.equal(cutCount(cards, '<button'), cutCount(cards, 'type="button"'), '所有可点元素都是 button')
})

/* ------------------------------------------------------------------ *
 * 3. 滚动源（R03 真 bug：右栏是独立滚动容器，不是页面滚动）
 * ------------------------------------------------------------------ */

test('滚动源：从内容容器往上找最近的 overflow-y:auto/scroll 祖先（跳过 overflow:hidden）', () => {
  // 真实结构：.tl-tree-body → .tl-tree → .threadline-rail(overflow-y:auto) → .threadline-layout → …
  const styles: Record<string, { overflowY: string; overflowX?: string }> = {
    layout: { overflowY: 'hidden' },
    rail: { overflowY: 'auto' },
    tree: { overflowY: 'visible' },
    body: { overflowY: 'visible' },
  }
  const parents: Record<string, string | null> = { body: 'tree', tree: 'rail', rail: 'layout', layout: null }
  const env = {
    parentOf: (node: string): string | null => parents[node] ?? null,
    styleOf: (node: string) => styles[node],
  }
  assert.equal(findScrollableAncestor('body', env), 'rail', '必须找到 .threadline-rail（不是 window）')

  // 只有 overflow:hidden 的祖先 → 没有滚动源（退回 window）
  const hiddenOnly = {
    parentOf: (node: string): string | null => (node === 'body' ? 'shell' : null),
    styleOf: () => ({ overflowY: 'hidden' }),
  }
  assert.equal(findScrollableAncestor('body', hiddenOnly), null, 'overflow:hidden 不算滚动容器')

  // 自己在最外层（没有祖先）→ null
  assert.equal(findScrollableAncestor('body', { parentOf: () => null, styleOf: () => ({ overflowY: 'auto' }) }), null)

  // `overflows` 说"内容没超出" → 跳过它继续往上
  const notOverflowing = {
    parentOf: (node: string): string | null => (node === 'body' ? 'rail' : node === 'rail' ? 'page' : null),
    styleOf: (node: string) => ({ overflowY: node === 'page' ? 'auto' : 'scroll' }),
    overflows: (node: string): boolean => node === 'page',
  }
  assert.equal(findScrollableAncestor('body', notOverflowing), 'page')

  // 环状 parentOf 不会死循环（guard）
  let hop = 0
  const cyclic = {
    parentOf: (node: string): string => (hop++ < 100 ? node : node),
    styleOf: () => ({ overflowY: 'visible' }),
  }
  assert.equal(findScrollableAncestor('x', cyclic), null)
})

test('isScrollableOverflow：只认 auto/scroll/overlay；visible/hidden/clip 都不算', () => {
  for (const value of ['auto', 'scroll', 'overlay', 'AUTO', ' scroll ']) {
    assert.equal(isScrollableOverflow(value), true, value)
  }
  for (const value of ['visible', 'hidden', 'clip', '', 'initial', undefined]) {
    assert.equal(isScrollableOverflow(value), false, String(value))
  }
})

test('滚动几何：右栏独立滚动时，窗口随右栏 scrollTop 前进（不是 window.scrollY）', () => {
  // 右栏顶边在视口 y=100，可见高 600；列表容器顶边在 y=160。
  // 首屏：scrollTop=0 → offset = 160 - (100 - 0) = 60
  const first = railScrollMetrics({ scrollTop: 0, scrollerTop: 100, scrollerHeight: 600, bodyTop: 160 })
  assert.deepEqual(first, { scrollPx: 0, offsetPx: 60, viewportHeight: 600 })

  // 右栏滚到 3000px：顶边仍是 100（滚动容器本身不动），bodyTop 变成 160-3000 = -2840
  const scrolled = railScrollMetrics({ scrollTop: 3000, scrollerTop: 100, scrollerHeight: 600, bodyTop: -2840 })
  assert.equal(scrolled.scrollPx, 3000)
  assert.equal(scrolled.offsetPx, 60, 'offset 不随滚动变化（列表相对容器原点固定）')

  // 关键断言：给它 scrollPx=3000 时窗口确实跳到 3000px 附近的行
  const windowAtTop = computeRailWindow({ count: 500, offsetPx: first.offsetPx, scrollPx: 0, viewportHeight: 600 })
  const window3k = computeRailWindow({ count: 500, offsetPx: scrolled.offsetPx, scrollPx: scrolled.scrollPx, viewportHeight: 600 })
  assert.equal(windowAtTop.start, 0, '首屏从第 0 行')
  assert.ok(window3k.start > 80, '滚到 3000px 时窗口必须前进（实际 start=' + window3k.start + '）')
  assert.ok(window3k.start < window3k.end)

  // 负值/NaN 一律夹到 0（列表在容器顶部时 offset 不该是负的）
  assert.deepEqual(railScrollMetrics({ scrollTop: -5, scrollerTop: 100, scrollerHeight: 600, bodyTop: 200 }), {
    scrollPx: 0,
    offsetPx: 100,
    viewportHeight: 600,
  })
  const nan = railScrollMetrics({ scrollTop: Number.NaN, scrollerTop: Number.NaN, scrollerHeight: Number.NaN, bodyTop: Number.NaN })
  assert.deepEqual(nan, { scrollPx: 0, offsetPx: 0, viewportHeight: 0 })
})

test('回归：虚拟化不再依赖 window.scrollY（返回 null 时组件退回 window，但优先用滚动祖先）', () => {
  // 源码级断言：FileTreeRail 必须用 findScrollableAncestor + railScrollMetrics，
  // 且**不能**把 window.scrollY 当唯一来源（那是 R03 的真 bug）。
  const source = readFileSync(join(PLUGIN_ROOT, 'src', 'client', 'ui', 'rail', 'FileTreeRail.ts'), 'utf8')
  assert.ok(source.includes('findScrollableAncestor'), '必须找最近的滚动祖先')
  assert.ok(source.includes('railScrollMetrics'), '必须用统一的滚动几何算法')
  assert.ok(source.includes('scroller.scrollTop'), '滚动位置必须取自滚动容器（不是 window.scrollY）')
  // window 只在"没有滚动祖先"的兜底分支里出现
  const lines = source.split('\n')
  const windowScrollLines = lines.filter((line) => line.includes('globalThis.scrollY') && !line.includes('//'))
  assert.ok(windowScrollLines.length <= 1, 'window.scrollY 只允许出现在兜底分支（实际 ' + windowScrollLines.length + ' 处）')
  assert.ok(/scroller === null \?/.test(source), 'window 兜底必须在 scroller === null 分支里')
})

/* ------------------------------------------------------------------ *
 * 4. 行 id / DOM 工具
 * ------------------------------------------------------------------ */

test('行 id 净化成选择器安全字符串，根路径有稳定 id', () => {
  assert.equal(railRowDomId('row', 'src/a b.ts'), 'threadline-rail-row-src-a-b-ts')
  assert.equal(railRowDomId('card', ''), 'threadline-rail-card-root')
})

/* ------------------------------------------------------------------ *
 * 6. 样式纪律（与 styles.test.ts 的门禁同向，但只查本文件）
 * ------------------------------------------------------------------ */

const TREE_CSS = readFileSync(join(PLUGIN_ROOT, 'src', 'client', 'styles', 'tree.css'), 'utf8')
/** 去掉注释后的 CSS（注释里会提到 @container / DirectoryRail，不能参与结构断言）。 */
const TREE_CSS_CODE = TREE_CSS.replace(/\/\*[\s\S]*?\*\//g, '')

/** 极简 CSS 解析：取"选择器 + 它所在的 at-rule 栈"（与 tests/ui-shell/styles.test.ts 同口径）。 */
function parseRules(css: string): Array<{ selector: string; atRules: string[] }> {
  const rules: Array<{ selector: string; atRules: string[] }> = []
  const stack: string[] = []
  let buffer = ''
  for (const char of css) {
    if (char === '{') {
      const head = buffer.trim()
      if (head.startsWith('@')) stack.push(head)
      else {
        rules.push({ selector: head, atRules: stack.filter((frame) => frame.startsWith('@')) })
        stack.push('')
      }
      buffer = ''
      continue
    }
    if (char === '}') {
      stack.pop()
      buffer = ''
      continue
    }
    buffer += char
  }
  return rules
}

/** 顶层逗号切选择器（`:is(a, b)` 里的逗号不算分隔）。 */
function splitSelectorList(selectorList: string): string[] {
  const parts: string[] = []
  let buffer = ''
  let depth = 0
  for (const char of selectorList) {
    if (char === '(' || char === '[') depth += 1
    if (char === ')' || char === ']') depth -= 1
    if (char === ',' && depth === 0) {
      parts.push(buffer.trim())
      buffer = ''
      continue
    }
    buffer += char
  }
  if (buffer.trim() !== '') parts.push(buffer.trim())
  return parts
}

test('tree.css：每个选择器挂 .threadline-app 前缀（卸载即干净）', () => {
  const allowed = [':is(.threadline-app, .threadline-impact-root)', '.threadline-app']
  const offenders: string[] = []
  for (const rule of parseRules(TREE_CSS_CODE)) {
    // @keyframes 的 from/to 不是选择器
    if (rule.atRules.some((at) => at.startsWith('@keyframes'))) continue
    for (const selector of splitSelectorList(rule.selector)) {
      if (selector === '') continue
      if (!allowed.some((prefix) => selector.startsWith(prefix))) offenders.push(selector)
    }
  }
  assert.deepEqual(offenders, [], '未挂前缀的选择器：' + offenders.join(' | '))
})

test('tree.css：只引用 --tl-* tokens（无颜色字面量）', () => {
  const withoutComments = TREE_CSS.replace(/\/\*[\s\S]*?\*\//g, '')
  const withoutVars = withoutComments.replace(/var\(--[a-z0-9-]+,?[^)]*\)/g, '')
  // #rgb/#rrggbb、rgb()/hsl()、命名色（白/黑）都算颜色字面量
  const hex = withoutVars.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []
  assert.deepEqual(hex, [], '出现颜色字面量：' + hex.join(', '))
  const functional = withoutVars.match(/\b(rgba?|hsla?)\(/g) ?? []
  assert.deepEqual(functional, [], '出现 rgb()/hsl()：' + functional.join(', '))
})

test('tree.css：没有 viewport media query（响应式只用容器查询）', () => {
  const media = [...TREE_CSS_CODE.matchAll(/@media\s+([^{]+)\{/g)].map((match) => match[1].trim())
  assert.deepEqual(media, [], 'tree.css 不许有 @media：' + media.join(' | '))
  const containers = [...TREE_CSS_CODE.matchAll(/@container\s+([^{]+)\{/g)].map((match) => match[1].trim())
  assert.ok(containers.length >= 2, '要有窄栏容器查询降级（≥2 条）')
  for (const condition of containers) assert.match(condition, /^threadline\s+\(/, '容器查询必须指名 threadline 容器：' + condition)
})

test('tree.css 与模型常量一致：列表行高 30px；无内部横向滚动（不写 overflow-x）', () => {
  const rowBlock = /\.tl-tree-row\s*\{([^}]*)\}/.exec(TREE_CSS_CODE)
  assert.ok(rowBlock !== null, '缺 .tl-tree-row 规则')
  const body = rowBlock[1]
  assert.match(body, new RegExp('block-size:\\s*' + RAIL_LIST_ROW_HEIGHT + 'px'), '行高必须等于 RAIL_LIST_ROW_HEIGHT（虚拟化单位）')
  assert.match(body, /min-block-size:\s*30px/)
  assert.equal(/overflow-x/.test(TREE_CSS_CODE), false, '不许出现 overflow-x（无横向滚动）')
  // 长文本省略：名称必须有 ellipsis + nowrap
  const nameBlock = /\.tl-tree-name\s*\{([^}]*)\}/.exec(TREE_CSS_CODE)
  assert.ok(nameBlock !== null)
  assert.match(nameBlock[1], /text-overflow:\s*ellipsis/)
  assert.match(nameBlock[1], /white-space:\s*nowrap/)
  assert.match(nameBlock[1], /min-inline-size:\s*0/)
})

test('右栏卡片悬停有轻微上浮（D-35 需求 4），且 reduced-motion 下取消位移', () => {
  /* 用户明确要求：hover 不能只是"蓝框 + 深色"，要有整块轻微上浮的交互感。
   * 这条断言防止它被后续重构悄悄删掉（本轮就发现过一次"只改了背景色"）。 */
  assert.match(
    TREE_CSS_CODE,
    /\.tl-tree-card:hover\s*\{[^}]*transform:\s*translateY\(-2px\)/,
    '卡片 hover 必须上浮（translateY(-2px)）',
  )
  assert.match(TREE_CSS_CODE, /\.tl-tree-card:hover\s*\{[^}]*box-shadow:\s*var\(--tl-shadow-2\)/, '上浮必须配合阴影加深')
  assert.match(TREE_CSS_CODE, /\[data-reduced-motion='true'\][\s\S]*?\.tl-tree-card:hover[\s\S]*?transform:\s*none/, 'reduced-motion 下必须取消位移')  // 键盘焦点要有同等反馈，不能只是鼠标专属
  assert.match(TREE_CSS_CODE, /\.tl-tree-card:focus-visible\s*\{[^}]*transform:\s*translateY\(-2px\)/, '键盘焦点也应有上浮')
})

test('轮次块悬停也上浮，且 transition 只声明一次（旧写法后者覆盖前者）', () => {
  const turnsCss = readFileSync(join(PLUGIN_ROOT, 'src', 'client', 'styles', 'turns.css'), 'utf8')
  assert.match(turnsCss, /\.threadline-turn-block:hover\s*\{[^}]*transform:\s*translateY\(-2px\)/, '轮次块 hover 必须上浮')
  /* 同一选择器上出现两条 transition 时，后一条会整体覆盖前一条 —— 这正是旧 bug。 */
  const blocks = turnsCss.match(/\.threadline-turn-block\s*\{[^}]*\}/g) ?? []
  const withTransition = blocks.filter((block) => block.includes('transition'))
  assert.equal(withTransition.length, 1, 'transition 只能在一个块里声明（否则相互覆盖）')
})

test('tree.css：类名与组件一致（组件用到的每个 tl-tree-* 类都有样式）', () => {
  const source = readFileSync(join(PLUGIN_ROOT, 'src', 'client', 'ui', 'rail', 'FileTreeRail.ts'), 'utf8')
  const used = new Set<string>()
  for (const match of source.matchAll(/'(tl-tree-[a-z-]+)'/g)) used.add(match[1])
  for (const match of source.matchAll(/class="(tl-tree-[a-z-]+)"/g)) used.add(match[1])
  // 以 `-` 结尾的是"类名前缀"（例如 `'tl-tree-body-' + testId`），不是完整类名
  const missing = [...used].filter((name) => !name.endsWith('-') && !TREE_CSS.includes('.' + name))
  assert.deepEqual(missing, [], '组件用了但 CSS 没定义：' + missing.join(', '))
})

/* ------------------------------------------------------------------ *
 * 7. 旧路径对照（单一执行路径的过渡说明）
 * ------------------------------------------------------------------ */

test('右栏新组件不依赖旧的会话聚合模型（directories.ts / DirectoryRail）', () => {
  for (const file of ['FileTreeRail.ts', 'model.ts']) {
    // 只查代码（去掉注释）：文件头会写明"与旧 DirectoryRail 的差别"，那是文档不是依赖。
    const code = readFileSync(join(PLUGIN_ROOT, 'src', 'client', 'ui', 'rail', file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('*') && !line.trimStart().startsWith('//'))
      .join('\n')
    for (const forbidden of ['buildDirectoryCards', 'DirectoryCard', 'directoryKeyOf', 'DirectoryRail', 'directories.ts']) {
      assert.equal(code.includes(forbidden), false, file + ' 仍在用旧聚合模型：' + forbidden)
    }
  }
  // a11y：只有一处键盘状态机（复用 listKeyNav，不在 rail 里另写一份）
  const railSource = readFileSync(join(PLUGIN_ROOT, 'src', 'client', 'ui', 'rail', 'FileTreeRail.ts'), 'utf8')
  assert.ok(railSource.includes("from '../../a11y/listModel.ts'"), '键盘状态机必须复用 a11y 唯一实现')
})
