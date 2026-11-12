/*
 * tests/reasoning/filter-pipeline.test.ts —— 筛选**真的进派生管线**（1.5.5 真机缺陷）。
 *
 * 这三个缺陷的共同点：控件看起来是对的，但改了它数据一个字都不变或变得没道理。
 *
 * 1. **语言筛选是摆设**：`ReasoningView` 会改 `filter.lang`，而 `filterSamples()` 明确不做语言
 *    过滤（语言是逐句判定的，样本级没有该字段），`deriveReasoning()` 也从没调用过
 *    `sentencesByLang()`。选「中文」和选「全部」出的是同一张图。
 * 2. **Preset 是隐性状态**：`ReasoningFilter` 有 `preset`，却没有枚举函数、没有入口。
 * 3. **语言选项会自己消失**：语言选项若从"筛选后的句子"枚举，选了中文之后英语/混合两项
 *    就从下拉里消失 —— 那不是"没有数据"，是控件被自己的选择吃掉了。
 *
 * 这些断言必须能区分「旧行为」与「目标行为」：每条都先证明筛选前后**确实不同**，
 * 再证明结果**符合预期**（只留下该语言 / 只留下该 preset / 字符数守恒）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import type { ReasoningSample } from '../../src/shared/reasoning/index.ts'
import {
  DEFAULT_FILTER,
  activeFilterKeys,
  deriveReasoning,
  langOptionsOf,
  modelOptionsOf,
  presetOptionsOf,
  resetFilterKey,
  type ReasoningFilter,
} from '../../src/client/ui/reasoning/model.ts'

function sample(patch: Partial<ReasoningSample> = {}): ReasoningSample {
  return {
    text: 'I need to check the tree listing.',
    answerText: 'Here is the answer.',
    tokens: 100,
    totalTokens: 1000,
    sessionId: 's1',
    turn: 1,
    model: 'deepseek/deepseek-v4.1-flash',
    preset: 'coding',
    at: 1,
    kind: 'committed',
    ...patch,
  }
}

/**
 * 夹具：3 条样本，语言构成明确。
 * - 纯英文两条（preset=coding）
 * - 纯中文一条（preset=plan）
 * 每条只有一句，句子的语言就等于整条样本的语言 —— 这样断言可以说人话。
 */
const ENGLISH_A = sample({ text: 'I need to inspect the repository.', sessionId: 's1', at: 1, preset: 'coding' })
const ENGLISH_B = sample({ text: 'Check the failing test output.', sessionId: 's2', at: 2, preset: 'coding' })
const CHINESE = sample({ text: '先检查目录树的读取情况。', sessionId: 's3', at: 3, preset: 'plan' })
const FIXTURE: ReasoningSample[] = [ENGLISH_A, ENGLISH_B, CHINESE]

function filterOf(patch: Partial<ReasoningFilter> = {}): ReasoningFilter {
  /*
   * 这些用例考察的是**样本级筛选**（语言 / Preset / 模型 / 轮次），与 range 正交。
   * 而 1.5.5 起 `DEFAULT_FILTER.range` 是 `'session'`（只算当前会话），
   * 这里若不显式给 currentSessionId 就会把所有夹具滤空 —— 那会把"测语言筛选"
   * 变成"测 range 默认值"，属于测错东西。
   * 所以基线固定为 `workspace`（夹具全部会话），range 自身的行为由它自己的用例守。
   */
  return { ...DEFAULT_FILTER, range: 'workspace', ...patch }
}

function derive(patch: Partial<ReasoningFilter> = {}, samples: readonly ReasoningSample[] = FIXTURE) {
  return deriveReasoning({ samples, filter: filterOf(patch), dimension: 'prefix' })
}

/* ---------------- 语言筛选 ---------------- */

test('语言筛选真的改变结果：选「中文」后英文句子全部消失', () => {
  const all = derive()
  const zh = derive({ lang: 'zh' })

  /* 先证明"确实变了"（反向：如果没变，这条筛选就是装饰品）。 */
  assert.notEqual(zh.totals.chars, all.totals.chars, '语言筛选没有改变字符总数 —— 说明它没有进入派生管线')

  /* 再证明"变得对"：剩下的句子全都是中文。 */
  assert.ok(zh.sentences.length > 0, '选中文后应当仍有句子')
  for (const sentence of zh.sentences) assert.equal(sentence.lang, 'zh', '语言筛选后混进了非中文句子')
  assert.equal(zh.totals.chars, CHINESE.text.replace(/\s/g, '').length, '字符数应当只剩中文那一条')
})

test('语言筛选：选「英语」保留两条英文，且字符守恒', () => {
  const en = derive({ lang: 'en' })
  assert.equal(en.sentences.length, 2, '应当只剩两条英文句子，实际 ' + String(en.sentences.length))
  for (const sentence of en.sentences) assert.equal(sentence.lang, 'en')
  const expected = ['I need to inspect the repository.', 'Check the failing test output.']
    .map((text) => text.replace(/\s/g, '').length)
    .reduce((sum, chars) => sum + chars, 0)
  assert.equal(en.totals.chars, expected, '英文筛选后的字符数应当等于两条英文之和')
})

test('语言筛选：选一个不存在的语言 → 空结果，且 sampleCount 归零（不是"没有记录"）', () => {
  const ja = derive({ lang: 'ja' })
  assert.equal(ja.totals.chars, 0, '不存在的语言必须得到空结果')
  assert.equal(ja.groups.length, 0)
  assert.equal(ja.sentences.length, 0)
  /* 关键：空结果要能和"本来就没有记录"区分开 —— 样本还在，只是被筛掉了。 */
  assert.ok(ja.sampleCount > 0, 'sampleCount 应当仍 > 0：样本在，是筛选滤空的')
})

/* ---------------- 语言选项枚举口径 ---------------- */

test('语言选项从**筛选前**的句子枚举：选了中文，英语选项不能消失', () => {
  const all = derive()
  const zh = derive({ lang: 'zh' })

  const allValues = langOptionsOf(all.allSentences).map((option) => option.value).sort()
  const zhValues = langOptionsOf(zh.allSentences).map((option) => option.value).sort()

  assert.deepEqual(zhValues, allValues, '选了中文之后语言选项集合不得变化（否则控件被自己的选择吃掉）')
  assert.ok(allValues.includes('zh') && allValues.includes('en'), '语言选项应当包含 zh 与 en，实际 ' + allValues.join(','))
})

test('allSentences 在 lang=all 时与 sentences 一致（省一次整场聚合）', () => {
  const all = derive()
  assert.equal(all.allSentences.length, all.sentences.length, 'lang=all 时两者必须一致')
})

test('语言筛选作用于**句子**：一条中英混排样本会被两侧分别统计', () => {
  /* 混排样本：前半英文、后半中文 —— 切句后语言不同，筛选应当各自留下自己那一半。 */
  const mixed = sample({ text: 'Check the build output. 先检查目录树的读取情况。', sessionId: 's9', at: 9 })
  const en = derive({ lang: 'en' }, [mixed])
  const zh = derive({ lang: 'zh' }, [mixed])

  assert.ok(en.sentences.length >= 1, '英文侧应当至少留下一句')
  assert.ok(zh.sentences.length >= 1, '中文侧应当至少留下一句')
  assert.ok(en.totals.chars > 0 && zh.totals.chars > 0, '两侧都应有字符')
  assert.ok(
    en.totals.chars + zh.totals.chars <= derive({}, [mixed]).totals.chars,
    '两侧字符之和不应超过不筛选时的总量（同一句不能被重复计）',
  )
})

/* ---------------- Preset 筛选 ---------------- */

test('Preset 真的有枚举（不是写死），且筛选生效', () => {
  const options = presetOptionsOf(FIXTURE)
  const values = options.map((option) => option.value).sort()
  assert.deepEqual(values, ['coding', 'plan'], 'Preset 选项必须从真实样本枚举，实际 ' + values.join(','))

  const coding = derive({ preset: 'coding' })
  const plan = derive({ preset: 'plan' })
  const all = derive()

  assert.notEqual(coding.totals.chars, all.totals.chars, 'Preset 筛选没有改变结果')
  assert.equal(coding.sentences.length, 2, 'coding 应当只剩两条')
  assert.equal(plan.sentences.length, 1, 'plan 应当只剩一条')
  assert.ok(coding.totals.chars + plan.totals.chars <= all.totals.chars, '两个 preset 的字符之和不应超过总量')
})

test('Preset 为空的样本不进任何具体 preset 选项', () => {
  const noPreset = sample({ text: 'Check it.', preset: undefined, sessionId: 's8', at: 8 })
  const options = presetOptionsOf([noPreset, ...FIXTURE]).map((option) => option.value)
  assert.equal(options.includes(''), false, '空 preset 不得成为一个可选项')
  const filtered = derive({ preset: 'coding' }, [noPreset, ...FIXTURE])
  assert.ok(
    filtered.sentences.every((sentence) => sentence.preset === 'coding'),
    '空 preset 的样本不得混进 coding 筛选结果',
  )
})

/* ---------------- 模型筛选（回归：1.5.4 修过，别改坏） ---------------- */

test('模型筛选仍然从真实样本枚举 + 精确匹配', () => {
  const options = modelOptionsOf(FIXTURE).map((option) => option.value)
  assert.deepEqual(options, ['deepseek/deepseek-v4.1-flash'], '模型选项应当只有真实值')
  const filtered = derive({ model: 'deepseek/deepseek-v4.1-flash' })
  assert.equal(filtered.sentences.length, 3, '精确匹配真实模型值应当保留全部样本')
  const none = derive({ model: 'DeepSeek V4' })
  assert.equal(none.totals.chars, 0, '写死的旧模型名不应当命中任何样本')
})

/* ---------------- 活动筛选行 ---------------- */

test('activeFilterKeys 只列非默认值（默认不占高度）', () => {
  /*
   * 注意：`activeFilterKeys` 比较的是**真实默认值**（DEFAULT_FILTER.range = 'session'），
   * 不是上面 filterOf 为了考察样本级筛选而强制成 workspace 的那份基线。
   * 所以这里直接用 DEFAULT_FILTER 构造，不经过 filterOf。
   */
  assert.deepEqual(activeFilterKeys({ ...DEFAULT_FILTER }), [], '默认筛选不应产生活动项')
  assert.deepEqual(activeFilterKeys({ ...DEFAULT_FILTER, lang: 'zh' }), ['lang'])
  /* 1.5.5：默认 range 已从 workspace 改为 session，所以切到 workspace 才算"活动筛选"。 */
  assert.deepEqual(
    activeFilterKeys({ ...DEFAULT_FILTER, lang: 'zh', preset: 'plan', range: 'workspace' }),
    ['range', 'lang', 'preset'],
  )
  assert.deepEqual(activeFilterKeys({ ...DEFAULT_FILTER, turn: 3 }), ['turn'])
  /* 反向：显式选 session（= 默认值）不应当被当成活动筛选。 */
  assert.deepEqual(activeFilterKeys({ ...DEFAULT_FILTER, range: 'session' }), [])
})

test('resetFilterKey 只重置指定维度，不误伤其它维度', () => {
  const filter = filterOf({ lang: 'zh', preset: 'plan' })
  const reset = resetFilterKey(filter, 'lang')
  assert.equal(reset.lang, DEFAULT_FILTER.lang)
  assert.equal(reset.preset, 'plan', '重置 lang 不得把 preset 也清掉')
})

/* ---------------- 空结果的可解释性 ---------------- */

test('筛选滤空时：sampleCount > 0 且字符为 0（可与"根本没有记录"区分）', () => {
  const empty = derive({ lang: 'ko' })
  assert.equal(empty.totals.chars, 0)
  assert.ok(empty.sampleCount > 0, '有样本但被筛掉 → sampleCount > 0')

  const nothing = derive({ lang: 'ko' }, [])
  assert.equal(nothing.sampleCount, 0, '真正没有样本 → sampleCount = 0')
})
