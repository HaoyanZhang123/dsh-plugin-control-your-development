/*
 * tests/a11y/a11y.test.ts —— A44-2：无障碍（03 §15；06 A44-2）。
 *
 * 四组判据：
 * 1. **列表视图**：纯逻辑（行构建/掩码/排序/过滤/键盘状态机）+ 静态标记（table 语义、aria-sort、
 *    roving tabindex、aria-live 节流）；
 * 2. **焦点陷阱与焦点环**：只验证"复用 T06 的同一实现"（函数同一性），不重复测边界；
 * 3. **reduced-motion**：假 matchMedia 的四种情况 + 订阅/退订 + 时长归零；
 * 4. **对比度**：正反例（低于阈值的组合必须判不过）+ DSH 主题实测值全过。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createTranslator } from '../../src/client/locale/index.ts'
import {
  ANNOUNCE_MIN_INTERVAL_MS,
  Announcer,
  DSH_TOKEN_PAIRS,
  FOCUSABLE_SELECTOR as A11Y_FOCUSABLE,
  FileListView,
  GRAPHICS_MIN,
  ListView,
  TEXT_AA_MIN,
  TurnListView,
  auditContrast,
  buildFileRows,
  buildTurnRows,
  contrastRatio,
  decideAnnouncement,
  describedByProps,
  filterFileRows,
  joinIds,
  listKeyNav,
  meetsContrast,
  motionDuration,
  nextSort,
  nextTrapIndex,
  parseHexColor,
  readReducedMotion,
  relativeLuminance,
  rowDomId,
  shouldAnnounce,
  sortAria,
  sortFileRows,
  sortTurnRows,
  subscribeReducedMotion,
  summarizeContrast,
  type MediaEnv,
  type MediaQueryLike,
} from '../../src/client/a11y/index.ts'
import { DEFAULT_FILE_SORT, DEFAULT_TURN_SORT } from '../../src/client/a11y/listModel.ts'
import { nextTrapIndex as COMMON_NEXT_TRAP } from '../../src/client/ui/common/index.ts'
import { FILES, TURNS } from './fixtures.ts'

const t = createTranslator('zh')
const h = React.createElement

/* ------------------------------------------------------------------ *
 * 1. 列表视图：纯逻辑
 * ------------------------------------------------------------------ */

test('文件表行：元数据模式保留相对路径，隐私模式只剩 basename', () => {
  const visible = buildFileRows(FILES, 'metadata')
  assert.equal(visible[0].displayPath, 'src/client/ui/shell/Shell.ts')
  assert.equal(visible[0].label, 'Shell.ts')
  assert.equal(visible[0].key, 'src/client/ui/shell/shell.ts', '身份键小写（与星图同口径）')

  const hidden = buildFileRows(FILES, 'hidden')
  assert.equal(hidden[0].displayPath, 'Shell.ts')
  assert.equal(hidden[1].displayPath, '03-产品与交互规格.md')
  assert.equal(filterFileRows(hidden, 'src/client').length, 0, '隐私模式下按被隐藏的目录检索不到')
  assert.equal(filterFileRows(visible, 'src/client').length, 1)
})

test('排序：默认按 ops 降序；点同一列翻转；未知值排最后；稳定', () => {
  const rows = buildFileRows(FILES, 'metadata')
  const byOps = sortFileRows(rows, DEFAULT_FILE_SORT)
  assert.deepEqual(byOps.map((row) => row.ops), [18, 9, 2])

  const asc = sortFileRows(rows, { key: 'ops', dir: 'asc' })
  assert.deepEqual(asc.map((row) => row.ops), [2, 9, 18])

  const withUnknown = buildFileRows(
    [
      { ...FILES[0], firstAt: 0 },
      { ...FILES[1], firstAt: 100 },
      { ...FILES[2], firstAt: 50 },
    ],
    'metadata',
  )
  const byFirst = sortFileRows(withUnknown, { key: 'firstAt', dir: 'asc' })
  assert.deepEqual(byFirst.map((row) => row.firstAt), [50, 100, null], 'null（未知）排最后，不伪造成 0')

  assert.deepEqual(nextSort(DEFAULT_FILE_SORT, 'ops'), { key: 'ops', dir: 'asc' })
  assert.deepEqual(nextSort(DEFAULT_FILE_SORT, 'label'), { key: 'label', dir: 'asc' })
  assert.deepEqual(nextSort(DEFAULT_FILE_SORT, 'lastAt'), { key: 'lastAt', dir: 'desc' })
})

test('轮次表行：状态/计数/时长；时长未知为 null 而不是 0', () => {
  const rows = buildTurnRows(TURNS)
  assert.equal(rows.length, 4)
  assert.equal(rows[0].key, 'turn:1')
  assert.equal(rows[0].label, 'T1')
  assert.equal(rows[1].durationMs, null, '中断轮次没有时长时必须为 null')
  assert.deepEqual(sortTurnRows(rows, DEFAULT_TURN_SORT).map((row) => row.turn), [1, 2, 3, 4])
})

test('键盘状态机：↑↓/Home/End/PageUp/PageDown/Enter/Escape，越界夹取不跑飞', () => {
  const base = { row: 1, col: 0, rowCount: 3, colCount: 1 }
  assert.equal(listKeyNav({ ...base, key: 'ArrowDown' }).row, 2)
  assert.equal(listKeyNav({ ...base, key: 'ArrowUp' }).row, 0)
  assert.equal(listKeyNav({ ...base, key: 'ArrowDown' }).handled, true)
  assert.equal(listKeyNav({ row: 2, col: 0, rowCount: 3, colCount: 1, key: 'ArrowDown' }).row, 2, '到底不越界')
  assert.equal(listKeyNav({ row: 0, col: 0, rowCount: 3, colCount: 1, key: 'ArrowUp' }).row, 0, '到顶不越界')
  assert.equal(listKeyNav({ ...base, key: 'Home' }).row, 0)
  assert.equal(listKeyNav({ ...base, key: 'End' }).row, 2)
  assert.equal(listKeyNav({ row: 0, col: 0, rowCount: 30, colCount: 1, key: 'PageDown' }).row, 10)
  assert.equal(listKeyNav({ row: 25, col: 0, rowCount: 30, colCount: 1, key: 'PageUp' }).row, 15)
  assert.equal(listKeyNav({ ...base, key: 'Enter' }).activate, true)
  assert.equal(listKeyNav({ ...base, key: ' ' }).activate, true)
  assert.equal(listKeyNav({ ...base, key: 'Escape' }).escape, true)
  assert.equal(listKeyNav({ ...base, key: 'a' }).handled, false, '其它键不抢默认行为')
  const empty = listKeyNav({ row: 0, col: 0, rowCount: 0, colCount: 1, key: 'ArrowDown' })
  assert.equal(empty.row, 0)
  assert.equal(empty.handled, false)
})

test('行 id 净化成选择器安全字符串', () => {
  assert.equal(rowDomId('files', 'src/client/ui/Shell.ts'), 'threadline-files-row-src-client-ui-Shell-ts')
  assert.match(rowDomId('turns', 'turn:1'), /^[a-zA-Z][a-zA-Z0-9_-]*$/)
})

/* ------------------------------------------------------------------ *
 * 2. 列表视图：静态标记（读屏语义）
 * ------------------------------------------------------------------ */

function renderFiles(selectedKey: string | null = null): string {
  return renderToStaticMarkup(
    h(FileListView, {
      t,
      mode: 'metadata',
      rows: buildFileRows(FILES, 'metadata'),
      sort: DEFAULT_FILE_SORT,
      selectedKey,
      onSort: () => undefined,
      onSelect: () => undefined,
      onEscape: () => undefined,
      onFocusInMap: () => undefined,
      testId: 'files',
    }),
  )
}

test('文件表语义：table + 列头 aria-sort + roving tabindex + aria-selected', () => {
  const html = renderFiles('src/client/ui/shell/shell.ts')
  assert.match(html, /<table[^>]*role="table"/)
  assert.match(html, /aria-label="列表视图 · 文件"/)
  assert.match(html, /aria-rowcount="4"/, '行数 = 数据行 3 + 表头 1')
  assert.match(html, /aria-colcount="5"/, '4 列 + 聚焦动作列')
  const sorted = html.match(/aria-sort="(ascending|descending|none)"/g) ?? []
  assert.equal(sorted.length, 4, '四个数据列都有 aria-sort；动作列不参与排序')
  assert.match(html, /aria-sort="descending"[^>]*data-column="ops"|data-column="ops"[^>]*aria-sort="descending"/)
  assert.match(html, /type="button" class="threadline-btn threadline-focus-ring threadline-table-sort"/, '列头是真正的按钮（键盘可排序）')
  assert.match(html, /aria-selected="true"/)
  assert.match(html, /tabindex="0"/, '当前行可 Tab 到')
  assert.match(html, /tabindex="-1"/, '其余行不可 Tab 到（roving tabindex）')
  assert.match(html, /aria-label="文件 Shell\.ts，操作 18"/, '行的可访问名只含元数据')
  assert.match(html, /aria-label="在图中聚焦 · src\/client\/ui\/shell\/Shell\.ts"/, '每行有可在图中聚焦的动作（标签用该行展示路径，隐私模式下随之掩码）')
  assert.match(html, /role="status" aria-live="polite" aria-atomic="true"/, 'aria-live 播报器存在')
})

test('隐私模式下表格单元格不含目录（掩码进到渲染层）', () => {
  const html = renderToStaticMarkup(
    h(FileListView, {
      t,
      mode: 'hidden',
      rows: buildFileRows(FILES, 'hidden'),
      sort: DEFAULT_FILE_SORT,
      selectedKey: null,
    }),
  )
  assert.equal(html.includes('src/client/ui/shell'), false, '隐私模式下不得出现完整目录')
  assert.match(html, /Shell\.ts/)
  assert.match(html, /data-privacy-mode="hidden"/)
})

test('轮次表语义：状态与计数以 locale 文案呈现，未时长不伪造', () => {
  const html = renderToStaticMarkup(
    h(TurnListView, {
      t,
      mode: 'metadata',
      rows: buildTurnRows(TURNS),
      sort: DEFAULT_TURN_SORT,
      selectedKey: 'turn:2',
    }),
  )
  assert.match(html, /aria-label="列表视图 · 轮次"/)
  assert.match(html, /T1 · 完成/)
  assert.match(html, /T2 · 已中断/)
  assert.match(html, /aria-selected="true"/)
  // 时长只在轮次单元格里作为补充信息出现；中断轮次（T2）没有时长
  const t2Row = html.slice(html.indexOf('T2 · 已中断'), html.indexOf('T2 · 已中断') + 200)
  assert.equal(t2Row.includes('秒'), false, '没有时长时不许编造 0 秒')
})

test('空表格不渲染假行，也不崩', () => {
  const html = renderToStaticMarkup(
    h(ListView, {
      kind: 'files',
      t,
      mode: 'metadata',
      rows: [],
      sort: DEFAULT_FILE_SORT,
    }),
  )
  assert.match(html, /aria-rowcount="1"/)
  assert.equal((html.match(/<tr/g) ?? []).length, 1, '只有表头一行')
})

/* ------------------------------------------------------------------ *
 * 3. aria 辅助
 * ------------------------------------------------------------------ */

test('aria-describedby 合并：去空、去重、保序', () => {
  assert.equal(joinIds(['a', null, 'b', '', 'a']), 'a b')
  assert.equal(joinIds([]), undefined)
  assert.equal(joinIds([null, undefined]), undefined)
  assert.deepEqual(describedByProps(['tip']), { 'aria-describedby': 'tip' })
  assert.deepEqual(describedByProps([]), {})
})

test('排序语义：当前列给 ascending/descending，其余 none', () => {
  assert.equal(sortAria(true, 'asc'), 'ascending')
  assert.equal(sortAria(true, 'desc'), 'descending')
  assert.equal(sortAria(false, 'desc'), 'none')
})

test('aria-live 节流：500ms 窗口内不重复播，窗口后补播', () => {
  assert.equal(ANNOUNCE_MIN_INTERVAL_MS, 500)
  assert.equal(shouldAnnounce(null, 1000), true, '从未播过 → 立即播')
  assert.equal(shouldAnnounce(1000, 1200), false, '窗口内 → 不播')
  assert.equal(shouldAnnounce(1000, 1500), true, '满窗口 → 播')
  assert.equal(shouldAnnounce(1000, 900), true, '时间倒退也允许（clock skew）')

  const blocked = decideAnnouncement(1000, 1100)
  assert.equal(blocked.announce, false)
  assert.equal(blocked.lastAt, 1000)
  assert.equal(blocked.retryInMs, 400)

  const allowed = decideAnnouncement(1000, 1600)
  assert.equal(allowed.announce, true)
  assert.equal(allowed.lastAt, 1600)
})

test('Announcer 渲染成 polite 的 status 区（视觉隐藏）', () => {
  const html = renderToStaticMarkup(h(Announcer, { message: '文件 Shell.ts' }))
  assert.match(html, /class="threadline-visually-hidden"/)
  assert.match(html, /role="status"/)
  assert.match(html, /aria-live="polite"/)
  assert.match(html, /aria-atomic="true"/)
})

/* ------------------------------------------------------------------ *
 * 4. 焦点陷阱：复用 T06 唯一实现
 * ------------------------------------------------------------------ */

test('焦点陷阱与 T06 是同一个实现（不是第二份拷贝）', () => {
  assert.equal(nextTrapIndex, COMMON_NEXT_TRAP, 'a11y 必须再导出 ui/common 的实现')
  assert.equal(A11Y_FOCUSABLE.includes('button:not([disabled])'), true)
})

/* ------------------------------------------------------------------ *
 * 5. reduced-motion
 * ------------------------------------------------------------------ */

function fakeEnv(matches: boolean, mode: 'modern' | 'legacy' | 'none' = 'modern'): MediaEnv & { listeners: number } {
  const listener = { count: 0 }
  const media: MediaQueryLike = {
    matches,
    addEventListener: mode === 'modern' ? () => { listener.count += 1 } : undefined,
    removeEventListener: mode === 'modern' ? () => { listener.count -= 1 } : undefined,
    addListener: mode === 'legacy' ? () => { listener.count += 1 } : undefined,
    removeListener: mode === 'legacy' ? () => { listener.count -= 1 } : undefined,
  }
  return {
    listeners: listener.count,
    matchMedia: (query: string) => (query === '(prefers-reduced-motion: reduce)' ? media : { matches: false }),
  }
}

test('reduced-motion 检测：支持/不支持/抛错三种环境', () => {
  assert.equal(readReducedMotion(fakeEnv(true)), true)
  assert.equal(readReducedMotion(fakeEnv(false)), false)
  assert.equal(readReducedMotion(null), false, '没有环境（SSR）时返回 false，不抛错')
  assert.equal(readReducedMotion({ matchMedia: () => { throw new Error('boom') } } as unknown as MediaEnv), false)
})

test('reduced-motion 订阅：现代/旧式 API 都能退订，两次退订也安全', () => {
  let modern = 0
  const envModern: MediaEnv = {
    matchMedia: () => ({
      matches: false,
      addEventListener: () => { modern += 1 },
      removeEventListener: () => { modern -= 1 },
    }),
  }
  const off = subscribeReducedMotion(envModern, () => undefined)
  assert.equal(modern, 1)
  off()
  off()
  assert.equal(modern, 0)

  let legacy = 0
  const envLegacy: MediaEnv = {
    matchMedia: () => ({ matches: false, addListener: () => { legacy += 1 }, removeListener: () => { legacy -= 1 } }),
  }
  const offLegacy = subscribeReducedMotion(envLegacy, () => undefined)
  assert.equal(legacy, 1)
  offLegacy()
  assert.equal(legacy, 0)
  assert.equal(subscribeReducedMotion(null, () => undefined)(), undefined, '无环境时返回空的退订函数')
})

test('reduced-motion 下动效时长归零（03 §13.1）', () => {
  assert.equal(motionDuration(240, true), 0)
  assert.equal(motionDuration(240, false), 240)
  assert.equal(motionDuration(0, false), 0)
  assert.equal(motionDuration(Number.NaN, false), 0)
})

/* ------------------------------------------------------------------ *
 * 6. 对比度
 * ------------------------------------------------------------------ */

test('对比度数学：黑白 21:1、同色 1:1、解析与非法输入', () => {
  assert.equal(relativeLuminance({ r: 0, g: 0, b: 0 }), 0)
  assert.equal(contrastRatio('#000000', '#ffffff'), 21)
  assert.equal(contrastRatio('#fff', '#ffffff'), 1, '三位简写也支持')
  assert.equal(contrastRatio('#00000000', '#ffffff'), null, '带透明度不接受（要调用方先合成）')
  assert.equal(contrastRatio('red', '#ffffff'), null, '命名颜色不支持（灰度/令牌以外的东西不猜）')
  assert.equal(parseHexColor('#0f1115')?.r, 15)
  assert.equal(parseHexColor('#zzz'), null)
})

test('对比度正反例：低于阈值必须判不过（不许"测不了就算过"）', () => {
  assert.equal(meetsContrast('#0f1115', '#ffffff', TEXT_AA_MIN), true)
  assert.equal(meetsContrast('#808080', '#ffffff', TEXT_AA_MIN), false, '中灰在白底上不到 4.5:1')
  assert.equal(meetsContrast('#808080', '#ffffff', GRAPHICS_MIN), true, '但它够图形阈值 3:1')

  const results = auditContrast([
    { name: '正文', fg: '#0f1115', bg: '#ffffff', min: TEXT_AA_MIN },
    { name: '太浅的正文', fg: '#808080', bg: '#ffffff', min: TEXT_AA_MIN },
    { name: '非法颜色', fg: 'red', bg: '#ffffff', min: GRAPHICS_MIN },
  ])
  assert.deepEqual(results.map((result) => result.pass), [true, false, false])
  const summary = summarizeContrast(results)
  assert.equal(summary.failed, 2)
  assert.deepEqual(summary.failedNames, ['太浅的正文', '非法颜色'])
})

test('DSH 主题令牌：明暗两套实测值全部达标', () => {
  const results = auditContrast(DSH_TOKEN_PAIRS)
  const summary = summarizeContrast(results)
  assert.deepEqual(summary.failedNames, [], '对比度不足：' + summary.failedNames.join(', '))
  assert.equal(summary.total, DSH_TOKEN_PAIRS.length)
})
