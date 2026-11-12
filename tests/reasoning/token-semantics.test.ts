/*
 * tests/reasoning/token-semantics.test.ts —— token 与占比的**口径合同**（1.5.5 真机复盘）。
 *
 * 背景（用户原话会照这里当证据）：
 * - 「token 显示观测不到和他们的比例对吗？这里是不是做得不好，怎么会观测不到，比例数据对吗？」
 *
 * 用本会话真实日志统计出来的三个事实：
 * | 项 | 实测 |
 * | --- | --- |
 * | 带 reasoning 的 assistant 消息 | 150 条 |
 * | 其中带普通正文（answerText 非空）的 | **10** 条 |
 * | reasoningTokens / totalTokens 齐备 | **150 / 150**（并不缺数据） |
 * | 旧口径算出的「字符占比」 | **99.7%**（假数：分母几乎为空） |
 * | 旧口径「占总 token」（rt/tt）中位数 | **0.13%**（被输入+缓存稀释） |
 * | 新口径「占输出」（rt/output）中位数 | **58.2%** |
 *
 * 所以本套件守四件事：
 * 1. token **按字符比例分配到每个分组**，且**守恒**（各组之和 = 整段真实 token）；
 *    —— 这是"观测不到"的根因修复：旧实现只把整段 token 记给字符占优的那一组。
 * 2. 「占总 token」的分母是 **outputTokens**，不是 totalTokens。
 * 3. 字符占比在 `answerChars === 0` 时**返回 null**（不许再给 99% 这种假数）。
 * 4. `hasTokens` 的必需项是 `tokens + outputTokens`（totalTokens 降级为可选）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  aggregateReasoning,
  hasTokens,
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
    model: 'deepseek/deepseek-v4.1-flash',
    preset: 'coding',
    at: 1,
    kind: 'committed',
    ...patch,
  }
}

/* ---------------- 1. token 分配与守恒 ---------------- */

test('token 分配到每个分组，且各组之和等于整段真实 token（守恒）', () => {
  /*
   * 一段 thought 里混进两种句式：
   *   "I need to check the tree listing."  → prefix "I need"（plan 类）
   *   "为什么这里会失败？"                    → prefix "为什么"（question 类）
   * 两组的字符量不同，token 应当按字符比例分，**两组都非零**。
   */
  const mixed = sample({ text: 'I need to check the tree listing. 为什么这里会失败？' })
  const byPrefix = aggregateReasoning([mixed], 'prefix')

  const totalChars = byPrefix.groups.reduce((sum, group) => sum + group.chars, 0)
  assert.ok(totalChars > 0, '夹具必须产生字符')

  /* 关键断言：**没有哪个组被排除在 token 之外**（旧实现除字符占优组外全是 0）。 */
  const tokenful = byPrefix.groups.filter((group) => group.tokens > 0)
  assert.equal(tokenful.length, byPrefix.groups.length, '每个分组都应分到 token，实际只有 ' + String(tokenful.length) + ' 组')

  /* 守恒：分配之和 = 整段真实 reasoningTokens。 */
  const sumTokens = byPrefix.groups.reduce((sum, group) => sum + group.tokens, 0)
  assert.ok(Math.abs(sumTokens - 100) < 0.0001, 'token 分配之和必须等于整段 token（100），实际 ' + String(sumTokens))

  const sumOutput = byPrefix.groups.reduce((sum, group) => sum + group.outputTokens, 0)
  assert.ok(Math.abs(sumOutput - 200) < 0.0001, 'outputTokens 分配之和必须等于整段 outputTokens（200），实际 ' + String(sumOutput))

  /* 分配比例必须与字符占比一致（不是平均分）。 */
  for (const group of byPrefix.groups) {
    const expected = (group.chars / totalChars) * 100
    assert.ok(Math.abs(group.tokens - expected) < 0.0001, '组 ' + group.key + ' 的 token 应按字符占比分配')
  }
})

test('单组样本：全部 token 归该组（比例 = 100%，不因分配而缩水）', () => {
  const result = aggregateReasoning([sample()], 'form')
  assert.equal(result.groups.length, 1)
  assert.equal(result.groups[0].tokens, 100)
  assert.equal(result.groups[0].outputTokens, 200)
})

test('多组但只有一段 thought：token 在各组间非零且守恒（旧实现只有一组有值）', () => {
  /* 用 lang 维度构造天然多组：中英混排会被切成两种语言。 */
  const mixed = sample({ text: 'Check the build output. 先检查目录树的读取情况。' })
  const byLang = aggregateReasoning([mixed], 'lang')
  assert.ok(byLang.groups.length >= 2, '中英混排应当产生至少两种语言分组，实际 ' + String(byLang.groups.length))
  for (const group of byLang.groups) {
    assert.ok(group.tokens > 0, '语言分组 ' + group.key + ' 也应有 token（旧实现只有一组有）')
  }
  const sum = byLang.groups.reduce((total, group) => total + group.tokens, 0)
  assert.ok(Math.abs(sum - 100) < 0.0001)
})

/* ---------------- 2. 「占总 token」的分母 ---------------- */

test('tokenRatio 的分母是 outputTokens，不是 totalTokens', () => {
  /* 100 reasoning / 200 output = 50%；若错用 totalTokens(1000) 会得到 10%。 */
  const result = aggregateReasoning([sample()], 'prefix')
  assert.equal(result.totals.tokens, 100)
  assert.equal(result.totals.outputTokens, 200)
  assert.equal(result.totals.totalTokens, 1000)
  assert.ok(result.totals.tokenRatio !== null)
  assert.ok(Math.abs((result.totals.tokenRatio as number) - 0.5) < 1e-9, 'tokenRatio 必须是 100/200 = 0.5，实际 ' + String(result.totals.tokenRatio))
})

test('contextRatio = tokens / totalTokens（如实展示，不再冒充占总 token）', () => {
  const result = aggregateReasoning([sample()], 'prefix')
  assert.ok(result.totals.contextRatio !== null)
  assert.ok(Math.abs((result.totals.contextRatio as number) - 0.1) < 1e-9, 'contextRatio 必须是 100/1000 = 0.1')
  /* 两个比值必须不同，否则说明又混成一个口径了。 */
  assert.notEqual(result.totals.tokenRatio, result.totals.contextRatio)
})

test('outputTokens 缺失 → tokenRatio 为 null（未知，不是 0%）', () => {
  const noOutput = sample({ outputTokens: undefined })
  const result = aggregateReasoning([noOutput], 'prefix')
  assert.equal(result.totals.tokenRatio, null, 'outputTokens 缺失时必须给 null，不能给 0')
})

/* ---------------- 3. 字符占比：没有正文必须是 null ---------------- */

test('answerText 为空 → charRatio 为 null（不许再算出 99% 这种假数）', () => {
  /*
   * 真实场景复刻：140/150 条回复只有 reasoning + tool-call，没有普通文本块。
   * 此时 answerChars === 0，分母退化 —— 旧口径会给出 99.7%。
   */
  const noAnswer = sample({ answerText: '', text: 'Thinking about the tree listing here.' })
  const result = aggregateReasoning([noAnswer], 'prefix')
  assert.equal(result.totals.answerChars, 0, '夹具应当没有正文')
  assert.equal(result.totals.charRatio, null, '没有正文时 charRatio 必须是 null，不能是 99.7%')
})

test('有一条正文时 charRatio 正常计算（不是一律 null）', () => {
  const result = aggregateReasoning([sample({ answerText: 'abc', text: 'abcdef' })], 'prefix')
  assert.ok(result.totals.charRatio !== null, '有正文时必须能算')
  /* chars=6（abcdef 无空白），answerChars=3 → 6/(6+3) = 0.667 */
  assert.ok(Math.abs((result.totals.charRatio as number) - 6 / 9) < 1e-9)
})

/* ---------------- 4. hasTokens 的必需项 ---------------- */

test('hasTokens 需要 tokens + outputTokens；totalTokens 降级为可选', () => {
  assert.equal(hasTokens(sample()), true)
  assert.equal(hasTokens(sample({ outputTokens: undefined })), false, '缺 outputTokens 不算已知（它是占比分母）')
  assert.equal(hasTokens(sample({ totalTokens: undefined })), true, 'totalTokens 缺失不应让整条样本失去 token 维度')
  assert.equal(hasTokens(sample({ tokens: undefined })), false)
  /* 边界：outputTokens 为 0 不能当分母。 */
  assert.equal(hasTokens(sample({ outputTokens: 0 })), false)
})

test('totalTokens 缺失时 contextRatio 为 null，但 tokenRatio 仍然有值', () => {
  const result = aggregateReasoning([sample({ totalTokens: undefined })], 'prefix')
  assert.equal(result.totals.contextRatio, null, '没有 totalTokens 就没有上下文占比')
  assert.ok(result.totals.tokenRatio !== null, '但不影响占输出')
})

/* ---------------- 5. groups 的 blocks 与 knownGroups 口径 ---------------- */

test('每组的 outputTokens 能被用来判断"这组到底有没有 token"', () => {
  const result = aggregateReasoning([sample()], 'prefix')
  for (const group of result.groups) {
    assert.equal(typeof group.outputTokens, 'number', 'group 必须有 outputTokens 字段')
    assert.ok(group.outputTokens > 0, '有 token 的组 outputTokens 必须 > 0（UI 用它判断显示数值还是未知）')
  }
})
