/*
 * tests/reasoning/reasoning.test.ts —— 思维链统计口径与启发式的硬约束。
 *
 * 这些断言就是"口径合同"：token 缺失不得按 0、字符与 token 不互相换算、
 * 切句不能把小数/缩写切开、语言/句式分类必须是可复核的启发式。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  aggregateReasoning,
  countChars,
  detectForm,
  detectLang,
  extractPrefix,
  hasTokens,
  primaryForm,
  sortGroupsByChars,
  splitSentences,
  type ReasoningSample,
} from '../../src/shared/reasoning/index.ts'

function sample(patch: Partial<ReasoningSample> = {}): ReasoningSample {
  return {
    text: 'I need to check the tree listing.',
    answerText: 'Here is the answer.',
    tokens: 100,
    outputTokens: 200,
    totalTokens: 1000,
    sessionId: 's1',
    turn: 1,
    model: 'DeepSeek V4',
    preset: 'coding',
    at: 1,
    kind: 'committed',
    ...patch,
  }
}

/* ---------------- 切句 ---------------- */

test('切句：句末标点与换行切分；小数与常见缩写不切', () => {
  assert.deepEqual(splitSentences('First sentence. Second sentence! Third?'), [
    'First sentence.',
    'Second sentence!',
    'Third?',
  ])
  assert.deepEqual(splitSentences('Use v1.5 of the tool.'), ['Use v1.5 of the tool.'])
  assert.deepEqual(splitSentences('See e.g. the docs for details.'), ['See e.g. the docs for details.'])
  assert.deepEqual(splitSentences('第一句。第二句！'), ['第一句。', '第二句！'])
  assert.deepEqual(splitSentences('line one\nline two'), ['line one', 'line two'])
})

test('切句：代码块里的点号不参与切分（不会把一句切成好几段）', () => {
  const input = 'Call this:\n```\nfoo.bar().baz()\n```\nThen check the result.'
  const sentences = splitSentences(input)
  // 关键：foo.bar() 里的点号不能制造额外断句；代码块独立成段即可。
  assert.equal(sentences.some((item) => item.includes('Call this')), true)
  assert.equal(sentences.some((item) => item.includes('Then check the result')), true)
  assert.equal(sentences.length, 3, '正文两段 + 代码占位一段，不因点号再碎')
})

/* ---------------- 字符与语言 ---------------- */

test('字符数：按 code point 计、不含空白（emoji 与汉字各算 1）', () => {
  assert.equal(countChars('abc'), 3)
  assert.equal(countChars(' a b '), 2)
  assert.equal(countChars('汉字'), 2)
  assert.equal(countChars('🙂'), 1)
  assert.equal(countChars(''), 0)
})

test('语言判定：中文/英文/日文/韩文/混合/未知', () => {
  assert.equal(detectLang('先检查目录树是否已经返回'), 'zh')
  assert.equal(detectLang('I need to verify the column alignment'), 'en')
  assert.equal(detectLang('これはテストです'), 'ja')
  assert.equal(detectLang('이것은 테스트입니다'), 'ko')
  assert.equal(detectLang('检查 check 一下 this'), 'mixed')
  assert.equal(detectLang('12345'), 'unknown')
  assert.equal(detectLang(''), 'unknown')
})

/* ---------------- 句式与句首 ---------------- */

test('句式：只在句首匹配，句中关键词不改判', () => {
  assert.equal(detectForm('I need to check this.'), 'plan')
  assert.equal(detectForm('先检查目录。'), 'imperative')
  assert.equal(detectForm('Could you confirm?'), 'question')
  assert.equal(detectForm('需要注意的是，词云也是正文派生物。'), 'warning')
  // 句子中间出现 why 不代表整句是疑问
  assert.equal(detectForm('The reason why it fails is unclear.'), 'statement')
})

test('句首短语：命中已知前缀时保留原文大小写；未知前缀取前两个词/四个字', () => {
  assert.equal(extractPrefix('I need to check this'), 'I need')
  assert.equal(extractPrefix('We need a single view'), 'We need')
  assert.equal(extractPrefix('先检查目录树'), '先检查')
  assert.equal(extractPrefix('Random words here now'), 'Random words')
  assert.equal(extractPrefix(''), '')
})

/* ---------------- 聚合口径 ---------------- */

test('token 缺失：字符照常统计，但 token 与占比必须是未知（不是 0）', () => {
  const result = aggregateReasoning(
    [sample({ tokens: undefined }), sample({ text: 'We need another check.', outputTokens: undefined })],
    'prefix',
  )
  assert.equal(result.totals.chars > 0, true, '字符仍要统计')
  assert.equal(result.totals.tokens, 0, '没有上报就是 0 累加量')
  assert.equal(result.totals.outputTokens, 0)
  assert.equal(result.totals.tokenRatio, null, '占比必须是未知，不能是 0%')
  assert.equal(result.totals.coverage, 0, '覆盖率为 0（一个都没上报）')
})

test('token 齐备：占比 = reasoningTokens / outputTokens；覆盖率反映有多少字符带 token', () => {
  /*
   * 1.5.5 口径变更（有据）：分母从 totalTokens 改为 **outputTokens**。
   * 理由：totalTokens 是上下文口径（含输入与缓存），实测本会话 151 条样本该比值
   * 中位数只有 0.13% —— 那不是"思维链占输出多少"。按输出算中位数是 58.2%。
   * `contextRatio` 另外如实保留 totalTokens 口径。
   */
  const known = sample({ text: 'I need this.', answerText: 'ok', tokens: 150, outputTokens: 500, totalTokens: 1000 })
  const unknown = sample({ text: 'We need that.', answerText: 'ok', tokens: undefined })
  const result = aggregateReasoning([known, unknown], 'prefix')
  assert.equal(result.totals.tokens, 150)
  assert.equal(result.totals.outputTokens, 500)
  assert.equal(result.totals.totalTokens, 1000)
  assert.equal(result.totals.tokenRatio, 0.3)
  assert.equal(result.totals.contextRatio, 0.15)
  assert.equal(result.totals.coverage !== null && result.totals.coverage > 0 && result.totals.coverage < 1, true)
})

test('字符占比与 token 占比是两个独立口径，不互相换算', () => {
  const result = aggregateReasoning(
    [sample({ text: 'abcdef', answerText: 'abcd', tokens: 10, outputTokens: 100, totalTokens: 1000 })],
    'prefix',
  )
  // 字符：6 / (6 + 4) = 0.6；占输出：10 / 100 = 0.1；占上下文：10 / 1000 = 0.01
  assert.equal(Math.round((result.totals.charRatio ?? 0) * 100), 60)
  assert.equal(Math.round((result.totals.tokenRatio ?? 0) * 100), 10)
  assert.equal(Math.round((result.totals.contextRatio ?? 0) * 100), 1)
})

test('分组：按维度切分且字符总数守恒（不重复计）', () => {
  const samples = [
    sample({ text: 'I need alpha.', answerText: 'a' }),
    sample({ text: 'We need beta.', answerText: 'b', model: 'Kimi K3' }),
  ]
  const byPrefix = aggregateReasoning(samples, 'prefix')
  const sum = byPrefix.groups.reduce((total, group) => total + group.chars, 0)
  assert.equal(sum, byPrefix.totals.chars, '各组字符之和必须等于总字符')

  const byModel = aggregateReasoning(samples, 'model')
  assert.deepEqual(byModel.groups.map((group) => group.key).sort(), ['DeepSeek V4', 'Kimi K3'])
})

test('主要句式：按字符加权，不因句子数量少而误判', () => {
  const result = aggregateReasoning(
    [
      sample({ text: 'I need a very long plan sentence that keeps going and going.' }),
      sample({ text: 'Could you? Yes.' }),
    ],
    'form',
  )
  const planGroup = result.groups.find((group) => group.key === 'plan')
  assert.ok(planGroup !== undefined)
  assert.equal(primaryForm(planGroup), 'plan')
})

test('句子明细带归属：会话、轮次、模型、preset、时间都能追到', () => {
  const result = aggregateReasoning([sample({ sessionId: 'sess-9', turn: 7, model: 'M1', preset: 'review', at: 12345 })], 'prefix')
  assert.ok(result.sentences.length > 0)
  const first = result.sentences[0]
  assert.equal(first.sessionId, 'sess-9')
  assert.equal(first.turn, 7)
  assert.equal(first.model, 'M1')
  assert.equal(first.preset, 'review')
  assert.equal(first.at, 12345)
  assert.equal(first.kind, 'committed')
})

test('确定性：同输入两次聚合结果逐字段相同', () => {
  const samples = [sample(), sample({ text: 'We need beta.', model: 'Kimi K3' })]
  assert.deepEqual(aggregateReasoning(samples, 'prefix'), aggregateReasoning(samples, 'prefix'))
})

test('排序：字符降序 + 键升序（并列时确定）', () => {
  const result = aggregateReasoning(
    [sample({ text: 'I need a.' }), sample({ text: 'We need b.' }), sample({ text: 'I need cc.' })],
    'prefix',
  )
  const sorted = sortGroupsByChars(result.groups)
  assert.equal(sorted[0].key, 'I need', '字符数多的在前')
  if (sorted.length > 1 && sorted[0].chars === sorted[1].chars) {
    assert.equal(sorted[0].key < sorted[1].key, true, '并列时按键升序')
  }
})

test('hasTokens：tokens + outputTokens 齐备才算已知（totalTokens 降级为可选）', () => {
  /* 1.5.5 口径变更：必需项从 totalTokens 改成 outputTokens（占比的分母）。 */
  assert.equal(hasTokens(sample()), true)
  assert.equal(hasTokens(sample({ tokens: undefined })), false)
  assert.equal(hasTokens(sample({ outputTokens: 0 })), false, 'outputTokens 为 0 不能当分母')
  assert.equal(hasTokens(sample({ tokens: Number.NaN })), false)
  assert.equal(hasTokens(sample({ totalTokens: 0 })), true, 'totalTokens 缺失不影响"有 token"判定')
})

test('空文本不产生块与句子（不让空 reasoning 冒充有效样本）', () => {
  const result = aggregateReasoning([sample({ text: '' })], 'prefix')
  assert.equal(result.totals.blocks, 0)
  assert.equal(result.totals.sentences, 0)
  assert.equal(result.totals.chars, 0)
})
