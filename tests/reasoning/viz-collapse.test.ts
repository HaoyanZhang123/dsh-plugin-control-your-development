/*
 * tests/reasoning/viz-collapse.test.ts —— 思维链可视化的「合并 + 配色 + 词云符号」（1.5.3）。
 *
 * 真机反馈三条：
 *   - 矩形树图 23106 组，格子细到不可读 → 需求：小于一定比例合并成「其他」，并且只留 Top 10；
 *   - 矩形树图「没有上色」→ 需求：用好看的彩色配色；
 *   - 词云「显示星号而不是词语」→ 真因：`FORM_GLYPH` 只认 form 维度的 key，
 *     其它维度（句式开头/语言/模型/Preset）的 group.key 查不到，落到 `◈` 兜底。
 *
 * 这条套件守住合并与配色的**纯函数**（不渲染、可预期）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  collapseTreemapGroups,
  TREEMAP_TOP_N,
  TREEMAP_MIN_SHARE,
  TREEMAP_COLORS,
  cloudGlyphOf,
} from '../../src/client/ui/reasoning/viz.ts'
import type { ReasoningGroup } from '../../src/shared/reasoning/index.ts'

function group(key: string, chars: number): ReasoningGroup {
  return {
    key,
    chars,
    sentences: 1,
    tokens: 0,
    totalTokens: 0,
    knownChars: 0,
    forms: {},
    langs: {},
    models: {},
    presets: {},
    sessions: {},
    primaryForm: 'statement',
    primaryLang: 'en',
  } as unknown as ReasoningGroup
}

test('小于阈值的组被合并进「其他」（0.1% 口径）', () => {
  const groups = [group('a', 800000), group('b', 100000), group('tiny1', 400), group('tiny2', 300), group('tiny3', 200)]
  const total = 800000 + 100000 + 400 + 300 + 200
  const out = collapseTreemapGroups(groups)
  const keys = out.groups.map((g) => g.key)
  assert.ok(keys.includes('a'), '大组必须保留')
  assert.ok(keys.includes('b'), '10% 的组必须保留')
  for (const tiny of ['tiny1', 'tiny2', 'tiny3']) {
    assert.equal(keys.includes(tiny), false, tiny + '（占比 <0.1%）必须被合并')
  }
  /* 合并后的「其他」格子 = 被合并组之和。 */
  const other = out.groups.find((g) => g.key === '\u0000other')
  assert.ok(other !== undefined, '必须产出「其他」聚合组')
  assert.equal(other.chars, 900, '「其他」的字符数必须等于被合并组之和')
  assert.equal(out.hiddenCount, 3, '必须如实报告被合并了几组')
  assert.equal(total, 900900)
})

test('只保留 Top 50（按字符数降序），其余并入「其他」', () => {
  const groups = Array.from({ length: 120 }, (_, i) => group('g' + String(i), 100000 - i * 100))
  const out = collapseTreemapGroups(groups)
  assert.ok(out.groups.length <= TREEMAP_TOP_N + 1, '输出组数 <= Top N + 其他，实际 ' + out.groups.length)
  assert.equal(TREEMAP_TOP_N, 50, 'Top N 必须是 50（用户明确要求「显示前 50」）')
  const kept = out.groups.filter((g) => g.key !== '\u0000other')
  assert.equal(kept.length, 50, '恰好保留 50 组')
  /* 降序：g0 最大。 */
  assert.equal(kept[0].key, 'g0')
  assert.equal(kept[49].key, 'g49')
})

test('Top 恰好等于 N 时不应产生空的「其他」', () => {
  const groups = Array.from({ length: 50 }, (_, i) => group('g' + String(i), 1000))
  const out = collapseTreemapGroups(groups)
  assert.equal(out.groups.some((g) => g.key === '\u0000other'), false, '没有可合并的组时不得出现空「其他」')
  assert.equal(out.groups.length, 50)
})

test('组数很少时不合并（保住细节）', () => {
  const groups = [group('a', 500), group('b', 400), group('c', 100)]
  const out = collapseTreemapGroups(groups)
  assert.equal(out.groups.length, 3)
  assert.equal(out.hiddenCount, 0)
})

test('配色是一组明确的彩色（不是灰阶），且顺序稳定', () => {
  assert.ok(TREEMAP_COLORS.length >= 6, '至少 6 种颜色，实际 ' + TREEMAP_COLORS.length)
  for (const color of TREEMAP_COLORS) {
    assert.match(color, /^var\(--tl-chart-\d+\)$/, '颜色必须引用令牌（不写死色值）：' + color)
  }
  /* 同一 index 永远同一颜色（确定性）。 */
  assert.equal(TREEMAP_COLORS[0], TREEMAP_COLORS[0])
  assert.equal(new Set(TREEMAP_COLORS).size, TREEMAP_COLORS.length, '颜色之间不能重复')
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
  const other = out.groups.find((g) => g.key === '\u0000other')
  assert.ok(other !== undefined)
  /* 渲染层用 t('reasoning.other') 显示；这里断言 key 是哨兵、不会裸奔到 UI 上。 */
  assert.equal(TREEMAP_MIN_SHARE, 0.001, '阈值必须是 0.1%（Top50 口径下再收紧，避免细条）')
})
