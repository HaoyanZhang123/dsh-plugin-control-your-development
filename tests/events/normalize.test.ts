/*
 * normalize.test.ts —— 边界归一化的**敌意输入**表驱动测试。
 *
 * 目的不是"验证某个 if"，而是钉住一条**策略**：
 *   **数据形状再怪，也不许让整条扫描失败，更不许静默丢东西。**
 *
 * 2026-11-09 的真机事故（一个 `title: null` 让 153 个会话的工作区整条 400）
 * 就是从"运行时相信类型声明"来的。这里把能想到的坏形状一次性钉死，
 * 以后宿主换版本、加字段、字段变 null 时，测试会先红，而不是用户先白屏。
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  isSessionId,
  normalizeRefreshIds,
  normalizeScanSessions,
  summarizeSkips,
} from '../../src/shared/events/normalize.ts'

const ok = { id: 's-1', updatedAt: 1000, running: false }

test('归一化：可选字段是 null / 数字 / 对象时视为缺省，不拒绝、不丢行', () => {
  const hostile = [
    null,
    0,
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    '',
    '   ',
    true,
    false,
    {},
    [],
    { nested: true },
    [1, 2, 3],
  ]
  for (const field of ['parentId', 'title', 'origin'] as const) {
    for (const value of hostile) {
      const result = normalizeScanSessions([{ ...ok, [field]: value }])
      assert.equal(result.sessions.length, 1, `${field}=${JSON.stringify(value)} 应保留该行`)
      assert.equal(result.skipped.length, 0, `${field}=${JSON.stringify(value)} 不应计入跳过`)
      const row = result.sessions[0] as unknown as Record<string, unknown>
      // 允许保留空串以外的字符串；其余一律视为缺省
      const expected = typeof value === 'string' && value !== '' ? value : undefined
      assert.equal(row[field], expected, `${field}=${JSON.stringify(value)} 归一化结果不对`)
    }
  }
})

test('归一化：required 字段坏掉时只跳过该行，并给出可审计的原因', () => {
  const cases: Array<[string, unknown, string]> = [
    ['非对象行', 'nope', 'not-object'],
    ['null 行', null, 'not-object'],
    ['数组行', [1], 'not-object'],
    ['id 缺失', { updatedAt: 1, running: false }, 'invalid-id'],
    ['id 非字符串', { id: 42, updatedAt: 1, running: false }, 'invalid-id'],
    ['id 路径穿越', { id: '../etc/passwd', updatedAt: 1, running: false }, 'invalid-id'],
    ['id 绝对路径', { id: 'C:/Windows/win.ini', updatedAt: 1, running: false }, 'invalid-id'],
    ['id 超长', { id: 'a'.repeat(201), updatedAt: 1, running: false }, 'invalid-id'],
    ['id 是 .', { id: '.', updatedAt: 1, running: false }, 'invalid-id'],
    ['updatedAt 负数', { id: 's-1', updatedAt: -1, running: false }, 'invalid-updatedAt'],
    ['updatedAt 缺失', { id: 's-1', running: false }, 'invalid-updatedAt'],
    ['updatedAt NaN', { id: 's-1', updatedAt: Number.NaN, running: false }, 'invalid-updatedAt'],
    ['updatedAt 字符串', { id: 's-1', updatedAt: '1000', running: false }, 'invalid-updatedAt'],
  ]
  for (const [label, row, reason] of cases) {
    const result = normalizeScanSessions([row])
    assert.equal(result.sessions.length, 0, label)
    assert.equal(result.skipped.length, 1, label)
    assert.equal(result.skipped[0].reason, reason, label)
  }
})

test('归一化：一行坏不影响同一批里的好行（这是事故的直接回归）', () => {
  const result = normalizeScanSessions([
    { ...ok, id: 's-good-1' },
    { ...ok, id: 's-good-2', title: null, parentId: null },
    { id: '../bad', updatedAt: 1, running: false },
    { ...ok, id: 's-good-3', updatedAt: -5 },
    { ...ok, id: 's-good-4', brandNewHuostField: { a: 1 }, origin: null },
  ])
  assert.deepEqual(
    result.sessions.map((s) => s.id),
    ['s-good-1', 's-good-2', 's-good-4'],
  )
  assert.equal(result.skipped.length, 2)
  const counts = summarizeSkips(result.skipped)
  assert.equal(counts['invalid-id'], 1)
  assert.equal(counts['invalid-updatedAt'], 1)
})

test('归一化：重复 id 保留首条并计数，total 不错算', () => {
  const result = normalizeScanSessions([
    { ...ok, id: 's-1', updatedAt: 10 },
    { ...ok, id: 's-1', updatedAt: 99 },
  ])
  assert.equal(result.sessions.length, 1)
  assert.equal(result.sessions[0].updatedAt, 10, '保留首条，不被后来的覆盖')
  assert.equal(result.skipped.length, 1)
  assert.equal(result.skipped[0].reason, 'duplicate')
})

test('归一化：运行字段只认 true（其余按 false，不丢行）', () => {
  for (const value of [true, 'true', 1, {}, null, undefined]) {
    const result = normalizeScanSessions([{ id: 's-1', updatedAt: 1, running: value }])
    assert.equal(result.sessions.length, 1)
    assert.equal(result.sessions[0].running, value === true)
  }
})

test('归一化：未知字段一律丢弃（宿主加字段时前向兼容）', () => {
  const result = normalizeScanSessions([
    { ...ok, futureField: { deep: [1, 2] }, __proto__x: 'nope' },
  ])
  assert.equal(result.sessions.length, 1)
  assert.deepEqual(Object.keys(result.sessions[0]).sort(), ['id', 'running', 'updatedAt'])
})

test('归一化：非数组输入不抛异常，返回空结果 + 记账', () => {
  for (const value of [undefined, null, 'x', 42, {}, true, () => 1]) {
    const result = normalizeScanSessions(value)
    assert.equal(result.sessions.length, 0)
    assert.equal(result.skipped.length, 1)
    assert.equal(result.skipped[0].reason, 'not-object')
  }
})

test('refresh：非法/越界/重复 id 一律丢弃并计数，绝不抛异常', () => {
  const ids = new Set(['s-1', 's-2'])
  assert.deepEqual(normalizeRefreshIds(['s-1', 's-2'], ids), { ids: ['s-1', 's-2'], dropped: 0 })
  assert.deepEqual(normalizeRefreshIds(['s-1', 's-2', 's-1'], ids), { ids: ['s-1', 's-2'], dropped: 1 })
  assert.deepEqual(normalizeRefreshIds(['s-9'], ids), { ids: [], dropped: 1 })
  assert.deepEqual(normalizeRefreshIds(['../x'], ids), { ids: [], dropped: 1 })
  assert.deepEqual(normalizeRefreshIds('s-1', ids), { ids: [], dropped: 0 })
  assert.deepEqual(normalizeRefreshIds(undefined, ids), { ids: [], dropped: 0 })
  assert.deepEqual(normalizeRefreshIds([null, 1, {}, []], ids), { ids: [], dropped: 4 })
})

test('会话 id 规则单一事实源：路径成分与非业务值一律不合法', () => {
  for (const good of ['s-1', 'abc', 'A_b.c:d-e', 'a'.repeat(200)]) {
    assert.equal(isSessionId(good), true, good)
  }
  for (const bad of ['', '.', '..', '../x', 'a/b', 'C:/x', 'a'.repeat(201), 'a b', '会话', null, 1]) {
    assert.equal(isSessionId(bad), false, String(bad))
  }
})
