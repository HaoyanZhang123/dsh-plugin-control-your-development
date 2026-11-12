/*
 * tests/reasoning/reduce.test.ts —— 归约器里的思维链抽取（端到端，不 mock 内部实现）。
 *
 * 这些断言防的是两类真实回归：
 * 1. reasoning 文本被混进"助手回复"（会让字符占比把思维链算两遍）；
 * 2. usage 缺失被当成 0（会让"占总 token"出现伪造的精确值）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { reduceSession } from '../../src/shared/events/index.ts'
import { splitAssistantContent, readUsage, samplesFromAssistantMessage } from '../../src/shared/events/reasoning.ts'
import type { SessionEventLike } from '../../src/shared/events/types.ts'

const NOW = 1_700_000_000_000

function header(): { id: string; createdAt: number; cwd: string; agentPreset: string } {
  return { id: 'sess-r', createdAt: NOW, cwd: 'E:/ws', agentPreset: 'coding' }
}

function messageEvent(content: unknown, usage?: unknown, interrupted = false): SessionEventLike {
  return {
    type: 'assistant/message',
    time: NOW + 1000,
    data: {
      turn: 1,
      message: { id: 'm1', content, ...(usage === undefined ? {} : { usage }) },
      ...(usage === undefined ? {} : { usage }),
      ...(interrupted ? { interrupted: true } : {}),
    },
  }
}

/* ---------------- 内容拆分 ---------------- */

test('内容拆分：reasoning 块与正文分开，正文不含思维链', () => {
  const split = splitAssistantContent([
    { type: 'reasoning', text: 'I need to check the tree.' },
    { type: 'text', text: 'Here is the answer.' },
  ])
  assert.deepEqual(split.reasoning, ['I need to check the tree.'])
  assert.equal(split.answer, 'Here is the answer.')
  assert.equal(split.answer.includes('I need'), false, '正文不得包含思维链')
})

test('内容拆分：字符串内容没有 reasoning（不臆造）', () => {
  const split = splitAssistantContent('plain answer')
  assert.deepEqual(split.reasoning, [])
  assert.equal(split.answer, 'plain answer')
})

/* ---------------- usage 读取 ---------------- */

test('usage：优先 data.usage；不自行拼分母（totalTokens 缺失就保持缺失）', () => {
  assert.deepEqual(readUsage({ usage: { reasoningTokens: 12, totalTokens: 100 } }), {
    reasoningTokens: 12,
    totalTokens: 100,
  })
  /*
   * 1.5.5 口径变更：`outputTokens` 现在是**一级字段**（「占输出」的分母），
   * 不再被丢弃。旧断言期望它被吞掉，那会让「占总 token」再次失去正确分母。
   * 仍然不拿 input+output 假造 totalTokens —— 那条纪律不变。
   */
  assert.deepEqual(readUsage({ usage: { reasoningTokens: 12, outputTokens: 40 } }), {
    reasoningTokens: 12,
    outputTokens: 40,
  })
  // 完全没有 usage
  assert.deepEqual(readUsage({}), {})
  // 非法值当作缺失
  assert.deepEqual(readUsage({ usage: { reasoningTokens: -1, totalTokens: Number.NaN } }), {})
})

test('usage：data.usage 缺失时退到 stream.usage', () => {
  assert.deepEqual(readUsage({ stream: { usage: { reasoningTokens: 5, totalTokens: 50 } } }), {
    reasoningTokens: 5,
    totalTokens: 50,
  })
})

/* ---------------- 端到端归约 ---------------- */

test('归约：reasoning 进入 SessionDetail.reasoning，且 token 来自 usage', () => {
  const result = reduceSession(header() as never, [
    { type: 'turn/start', time: NOW, data: { turn: 1 } },
    messageEvent(
      [
        { type: 'reasoning', text: 'I need to verify the column alignment.' },
        { type: 'text', text: 'Columns now align.' },
      ],
      { reasoningTokens: 30, totalTokens: 200 },
    ),
  ] as never, { cwd: 'E:/ws' })

  const reasoning = result.detail.reasoning
  assert.ok(reasoning !== undefined && reasoning.length === 1, '必须有一条思维链样本')
  assert.equal(reasoning[0].tokens, 30)
  assert.equal(reasoning[0].totalTokens, 200)
  assert.equal(reasoning[0].kind, 'committed')
  assert.equal(reasoning[0].preset, 'coding', 'preset 来自 header.agentPreset')
  // 正文摘要必须只有回复，不含思维链
  const turn = result.detail.turns[0]
  assert.ok(turn.assistantText !== undefined)
  assert.equal(turn.assistantText?.includes('I need'), false, '正文摘要不得混入思维链')
})

test('归约：没有 usage 时 token 字段保持缺失（不是 0）', () => {
  const result = reduceSession(header() as never, [
    messageEvent([{ type: 'reasoning', text: 'We need another pass.' }, { type: 'text', text: 'ok' }]),
  ] as never, { cwd: 'E:/ws' })
  const sample = result.detail.reasoning?.[0]
  assert.ok(sample !== undefined)
  assert.equal(sample.tokens, undefined, '缺 usage 必须是 undefined，不能是 0')
  assert.equal(sample.totalTokens, undefined)
})

test('归约：没有 reasoning 时整个字段缺失（区别于空数组）', () => {
  const result = reduceSession(header() as never, [
    messageEvent([{ type: 'text', text: 'just an answer' }]),
  ] as never, { cwd: 'E:/ws' })
  assert.equal(result.detail.reasoning, undefined)
})

test('归约：中断的回复标为 attempt，不与正式回复混为一谈', () => {
  const result = reduceSession(header() as never, [
    messageEvent([{ type: 'reasoning', text: 'Let me try this.' }, { type: 'text', text: 'partial' }], undefined, true),
  ] as never, { cwd: 'E:/ws' })
  assert.equal(result.detail.reasoning?.[0].kind, 'attempt')
})

test('samplesFromAssistantMessage：模型取自 message.source', () => {
  const samples = samplesFromAssistantMessage({
    data: {
      message: {
        content: [{ type: 'reasoning', text: 'I need this.' }],
        source: { provider: 'deepseek', model: 'DeepSeek V4' },
      },
    },
    sessionId: 's1',
    turn: 2,
    at: NOW,
  })
  assert.equal(samples[0].model, 'DeepSeek V4')
  assert.equal(samples[0].turn, 2)
})
