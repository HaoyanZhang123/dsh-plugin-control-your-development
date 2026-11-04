/**
 * A30-5（证据文案）：逐字对齐 03 §9.3 的四套模板 + 会话共现弱关系文案。
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  coSessionEvidence,
  coTurnEvidence,
  describeUnconfirmedReference,
  referenceEvidence,
  sequenceEvidence,
  shortSessionId,
  structureEvidence,
  UNCONFIRMED_REFERENCE_TEXT,
} from '../../src/shared/relations/index.ts'

test('A30-5 结构证据：`同属目录 {dir}` / `{a} 在 {b} 的目录下`', () => {
  const sameDir = structureEvidence({ dir: 'docs', from: 'docs/a.md', to: 'docs/b.md' })
  assert.equal(sameDir.kind, 'structure')
  assert.equal(sameDir.text, '同属目录 docs')
  assert.equal(sameDir.dir, 'docs')

  const nested = structureEvidence({
    dir: 'docs',
    from: 'docs/a.md',
    to: 'README.md',
    nested: true,
  })
  assert.equal(nested.text, 'docs/a.md 在 README.md 的目录下')

  const root = structureEvidence({ dir: '', from: 'README.md', to: 'docs/a.md' })
  assert.equal(root.text, '同属目录 /')
})

test('A30-5 共现证据：`在 {sessionShort} 的 T{n} 中同时出现 {k} 次`', () => {
  const evidence = coTurnEvidence({
    samples: [
      { sessionId: '7f3c2b1a-9d8e-4c5b-8a7f-6e5d4c3b2a1f', turn: 2 },
      { sessionId: '7f3c2b1a-9d8e-4c5b-8a7f-6e5d4c3b2a1f', turn: 5 },
    ],
    count: 3,
  })
  assert.equal(evidence.kind, 'coTurn')
  assert.equal(evidence.text, '在 7f3c2b1a 的 T5 中同时出现 3 次')
  assert.equal(evidence.count, 3)
  assert.equal(evidence.samples.length, 2)
})

test('A30-5 时序证据：`同一轮内：{a} 先于 {b}`，序号 1-based', () => {
  const evidence = sequenceEvidence({
    sessionId: 's1',
    turn: 4,
    order: 1,
    from: 'docs/a.md',
    to: 'src/x.ts',
  })
  assert.equal(evidence.kind, 'sequence')
  assert.equal(evidence.text, '同一轮内：docs/a.md 先于 src/x.ts')
  assert.equal(evidence.order, 1)
  assert.equal(evidence.turn, 4)
})

test('A30-5 引用证据：`{a} 第 {line} 行引用 {b}`', () => {
  const evidence = referenceEvidence({
    line: 12,
    raw: './docs/a.md',
    target: 'docs/a.md',
    from: 'README.md',
    to: 'docs/a.md',
  })
  assert.equal(evidence.kind, 'reference')
  assert.equal(evidence.text, 'README.md 第 12 行引用 docs/a.md')
  assert.equal(evidence.line, 12)
  assert.equal(evidence.resolved, true)
})

test('A30-5 会话共现证据：`同一会话中一起出现`（弱关系，默认不画）', () => {
  const evidence = coSessionEvidence(['s1', 's2'])
  assert.equal(evidence.kind, 'coSession')
  assert.equal(evidence.text, '同一会话中一起出现')
  assert.deepEqual(evidence.sessionIds, ['s1', 's2'])
})

test('A30-5 未确认引用文案：`解析所得，目标未确认` + 原因', () => {
  assert.equal(UNCONFIRMED_REFERENCE_TEXT, '解析所得，目标未确认')
  assert.equal(
    describeUnconfirmedReference({ line: 3, raw: './x.md', reason: 'not-found' }),
    '第 3 行 ./x.md：解析所得，目标未确认（文件不存在）',
  )
  assert.equal(
    describeUnconfirmedReference({ line: 9, raw: '../secret.md', reason: 'escape-cwd' }),
    '第 9 行 ../secret.md：解析所得，目标未确认（路径穿越出工作区）',
  )
  assert.equal(
    describeUnconfirmedReference({ line: 5, raw: './docs/exists.md', reason: 'not-touched' }),
    '第 5 行 ./docs/exists.md：解析所得，目标未确认（目标未被任何会话触碰）',
  )
})

test('A30-5 会话短 id：只截断长 id，不引入省略号/随机量', () => {
  assert.equal(shortSessionId('sess-0001'), 'sess-000')
  assert.equal(shortSessionId('short'), 'short')
  assert.equal(shortSessionId('abcdefghijklmnop'), 'abcdefgh')
})
