/*
 * tests/reasoning/viz-collapse.test.ts —— 思维链可视化的「合并 + 稳定配色 + 词云符号」。
 *
 * 历史（1.5.3）真机反馈三条：矩形树图 23106 组细到不可读 → 小于阈值合并成「其他」并只留 Top N；
 * 没有上色 → 用分类色；词云显示星号 → `FORM_GLYPH` 只认 form 维度的 key。
 *
 * P3 改了两处口径（**旧断言与正确行为冲突，已同步改**）：
 * 1. `TREEMAP_TOP_N` 50 → **12**。理由：900×380 固定画布能塞 50 格，但每格只有 ~60×30px，
 *    12px 标签放不下（真机截图里大半格子只剩色块）。50 这个数字守的是"格子太少"，
 *    而现在真正的问题反过来是"格子太多、字放不下"。合并语义不变（不丢量，只丢细节），
 *    并且「其他」现在可以下钻（见 `merged`）。
 * 2. 配色从**按下标取**改成**按 key 稳定哈希**：旧断言只要求"顺序稳定"，但顺序稳定 ≠
 *    同一分组稳定 —— 筛选/排序一变，同一个分组就换色。现在断言的是后者。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  collapseTreemapGroups,
  colorIndexOf,
  TREEMAP_TOP_N,
  TREEMAP_MIN_SHARE,
  TREEMAP_COLORS,
  TREEMAP_OTHER_KEY,
  treemapColorOf,
  cloudGlyphOf,
} from '../../src/client/ui/reasoning/viz.ts'
import type { ReasoningGroup } from '../../src/shared/reasoning/index.ts'

function group(key: string, chars: number): ReasoningGroup {
  return {
    key,
    chars,
    answerChars: 0,
    sentences: 1,
    tokens: 0,
    totalTokens: 0,
    knownChars: 0,
    blocks: 1,
    forms: {},
    langs: {},
    models: {},
    presets: {},
    primaryForm: 'statement',
    primaryLang: 'en',
  } as unknown as ReasoningGroup
}

test('小于阈值的组被合并进「其他」（0.1% 口径）', () => {
  const groups = [group('a', 800000), group('b', 100000), group('tiny1', 400), group('tiny2', 300), group('tiny3', 200)]
  const out = collapseTreemapGroups(groups)
  const keys = out.groups.map((g) => g.key)
  assert.ok(keys.includes('a'), '大组必须保留')
  assert.ok(keys.includes('b'), '10% 的组必须保留')
  for (const tiny of ['tiny1', 'tiny2', 'tiny3']) {
    assert.equal(keys.includes(tiny), false, tiny + '（占比 <0.1%）必须被合并')
  }
  /* 合并后的「其他」格子 = 被合并组之和。 */
  const other = out.groups.find((g) => g.key === TREEMAP_OTHER_KEY)
  assert.ok(other !== undefined, '必须产出「其他」聚合组')
  assert.equal(other.chars, 900, '「其他」的字符数必须等于被合并组之和')
  assert.equal(out.hiddenCount, 3, '必须如实报告被合并了几组')
  /* P3：被合并的原始分组必须带出来（「其他」下钻要用，不然点开是空的）。 */
  assert.deepEqual(
    out.merged.map((g) => g.key),
    ['tiny1', 'tiny2', 'tiny3'],
    '「其他」下钻列表必须是真实被合并的组',
  )
})

test('最多绘制 12 格（含「其他」），其余并入「其他」并如实计数', () => {
  const groups = Array.from({ length: 120 }, (_, i) => group('g' + String(i), 100000 - i * 100))
  const out = collapseTreemapGroups(groups)
  assert.equal(TREEMAP_TOP_N, 12, 'Top N 必须是 12（一屏内每格都要放得下 12px 名称）')
  assert.ok(out.groups.length <= TREEMAP_TOP_N, '输出组数（含「其他」）不得超过 ' + String(TREEMAP_TOP_N) + '，实际 ' + String(out.groups.length))
  const kept = out.groups.filter((g) => g.key !== TREEMAP_OTHER_KEY)
  assert.equal(kept.length, TREEMAP_TOP_N - 1, '「其他」要占一格 → 保留 ' + String(TREEMAP_TOP_N - 1) + ' 组')
  assert.equal(out.hiddenCount, 120 - (TREEMAP_TOP_N - 1), '被合并数必须等于总数 - 保留数')
  assert.equal(out.merged.length, out.hiddenCount, 'merged 必须与 hiddenCount 同量')
  /* 降序：g0 最大。 */
  assert.equal(kept[0].key, 'g0')
  assert.equal(kept[kept.length - 1].key, 'g' + String(TREEMAP_TOP_N - 2))
  /* 「其他」的字符数 = 全部被合并组之和（不丢量）。 */
  const other = out.groups.find((g) => g.key === TREEMAP_OTHER_KEY)
  assert.ok(other !== undefined)
  assert.equal(
    other.chars,
    out.merged.reduce((sum, g) => sum + g.chars, 0),
    '「其他」必须承接全部被合并的字符量',
  )
})

test('组数不超过 N 时不产生「其他」', () => {
  const groups = Array.from({ length: TREEMAP_TOP_N }, (_, i) => group('g' + String(i), 1000))
  const out = collapseTreemapGroups(groups)
  assert.equal(out.groups.some((g) => g.key === TREEMAP_OTHER_KEY), false, '没有可合并的组时不得出现空「其他」')
  assert.equal(out.groups.length, TREEMAP_TOP_N)
  assert.equal(out.hiddenCount, 0)
})

test('组数很少时不合并（保住细节）', () => {
  const groups = [group('a', 500), group('b', 400), group('c', 100)]
  const out = collapseTreemapGroups(groups)
  assert.equal(out.groups.length, 3)
  assert.equal(out.hiddenCount, 0)
  assert.deepEqual(out.merged, [])
})

test('配色是一组明确的彩色（不是灰阶），且按 key **稳定映射**', () => {
  assert.ok(TREEMAP_COLORS.length >= 6, '至少 6 种颜色，实际 ' + TREEMAP_COLORS.length)
  for (const color of TREEMAP_COLORS) {
    assert.match(color, /^var\(--tl-chart-\d+\)$/, '颜色必须引用令牌（不写死色值）：' + color)
  }
  assert.equal(new Set(TREEMAP_COLORS).size, TREEMAP_COLORS.length, '颜色之间不能重复')

  /* 同一个 key 在任何位置都是同一色位（旧实现按下标，排序一变就换色）。 */
  const keys = ['I need', '先检查', 'k3-256k', 'coding', 'We need', 'DeepSeek V4']
  for (const key of keys) {
    assert.equal(colorIndexOf(key), colorIndexOf(key), key + ' 的色位必须自洽')
    assert.equal(treemapColorOf(key), treemapColorOf(key))
  }
  /* 「其他」固定最后一个色位，且不与任何具体分组共用 —— 两类东西必须可区分。 */
  assert.equal(colorIndexOf(TREEMAP_OTHER_KEY), TREEMAP_COLORS.length - 1)
  for (const key of keys) {
    assert.notEqual(colorIndexOf(key), TREEMAP_COLORS.length - 1, key + ' 不能占用「其他」的色位')
  }
  /* 顺序无关：同一批 key 逆序传入，各自颜色不变。 */
  const forward = keys.map((key) => treemapColorOf(key))
  const backward = keys.slice().reverse().map((key) => treemapColorOf(key)).reverse()
  assert.deepEqual(backward, forward, '颜色不得依赖分组在数组里的位置')
})

test('词云符号：form 维度用符号，其它维度必须显示**文字**而不是星号/菱形', () => {
  /* form 维度：保留符号（设计如此）。 */
  assert.equal(cloudGlyphOf('plan', 'form'), '◈')
  assert.equal(cloudGlyphOf('question', 'form'), '?')
  /* 非 form 维度：必须回退到**文字**（前缀/语言/模型/Preset 都是可读字符串）。 */
  assert.equal(cloudGlyphOf('I need', 'prefix'), 'I need')
  assert.equal(cloudGlyphOf('中文', 'lang'), '中文')
  assert.equal(cloudGlyphOf('DeepSeek V4', 'model'), 'DeepSeek V4')
  assert.equal(cloudGlyphOf('coding', 'preset'), 'coding')
  /* 空 key 也不能产出星号。 */
  assert.notEqual(cloudGlyphOf('', 'prefix'), '◈')
})

test('合并后的「其他」保留可读标签，不显示内部哨兵', () => {
  const groups = [group('a', 500000), group('t1', 1), group('t2', 1)]
  const out = collapseTreemapGroups(groups)
  const other = out.groups.find((g) => g.key === TREEMAP_OTHER_KEY)
  assert.ok(other !== undefined)
  /* 渲染层用 t('reasoning.other') 显示；这里断言 key 是哨兵、不会裸奔到 UI 上。 */
  assert.equal(TREEMAP_MIN_SHARE, 0.001, '阈值必须是 0.1%（Top12 口径下再收紧，避免细条）')
  assert.equal(out.merged.length, 2)
})
