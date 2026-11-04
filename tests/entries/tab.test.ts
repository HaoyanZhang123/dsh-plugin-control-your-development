/*
 * tests/entries/tab.test.ts —— 「脉络」tab 的注册参数 + focus 一次性消费（06 A43-1 / A43-4）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { registerTab, ThreadlineTabView } from '../../src/client/entries/tab.ts'
import { consumeFocusRequest, parseFocusToken, requestFocus, takeFocus, pendingFocusCount, selectionOfFocus, focusTokenOf } from '../../src/client/state/selection.ts'
import { createFakeCtx } from './fake-ctx.ts'
import { SESSION_ID } from './fixtures.ts'

test('tab 注册参数：name / id / order / label（「脉络」，排在 chat、trajectory 之后）', () => {
  const fake = createFakeCtx()
  const ok = registerTab(fake.ctx)
  assert.equal(ok, true)
  const entry = fake.registration('conversation.view')
  assert.ok(entry !== undefined, '未注册 conversation.view')
  assert.equal(entry.name, 'conversation.view')
  assert.equal(entry.options.id, 'threadline')
  assert.equal(entry.options.order, 30)
  assert.ok(entry.options.order as number > 20, 'order 必须大于 chat/trajectory 的默认顺序')
  const label = entry.options.label as () => string
  assert.equal(typeof label, 'function')
  assert.equal(label(), '脉络')
})

test('tab 注册：factory 产出一个 React 元素（真正的组件）', () => {
  const fake = createFakeCtx()
  registerTab(fake.ctx)
  const entry = fake.registration('conversation.view')
  assert.ok(entry !== undefined)
  const element = entry.factory({} as never) as { type?: unknown; props?: Record<string, unknown> }
  assert.equal(typeof element, 'object')
  assert.equal(element.type, ThreadlineTabView)
})

test('tab 注册：disposer 进 ctx.effect，卸载时被调用', () => {
  const fake = createFakeCtx()
  registerTab(fake.ctx)
  assert.ok(fake.effectLabels.some((label) => label.includes('conversation view')))
  fake.disposeAll()
  assert.deepEqual(fake.disposedSlots, ['conversation.view'])
})

test('tab 注册：slots 缺失时只 warn，不抛错', () => {
  const fake = createFakeCtx({ withSlots: false })
  assert.doesNotThrow(() => registerTab(fake.ctx))
  assert.ok(fake.logs.some((line) => line.level === 'warn' && line.message.includes('slots')))
})

test('focus 协议：turn / file / session 三个 token 能解析，未知形态不猜', () => {
  assert.deepEqual(parseFocusToken('turn:3', SESSION_ID), { kind: 'turn', sessionId: SESSION_ID, turn: 3 })
  assert.deepEqual(parseFocusToken('file:src/a.ts', SESSION_ID), { kind: 'file', sessionId: SESSION_ID, path: 'src/a.ts' })
  assert.deepEqual(parseFocusToken('session:sess-x', SESSION_ID), { kind: 'session', sessionId: 'sess-x' })
  assert.equal(parseFocusToken('turn:0', SESSION_ID), null)
  assert.equal(parseFocusToken('turn:x', SESSION_ID), null)
  assert.equal(parseFocusToken('', SESSION_ID), null)
  assert.equal(parseFocusToken(null, SESSION_ID), null)
  assert.equal(parseFocusToken('weird:1', SESSION_ID), null)
  assert.equal(focusTokenOf({ kind: 'turn', sessionId: SESSION_ID, turn: 7 }), 'turn:7')
  assert.deepEqual(selectionOfFocus({ kind: 'turn', sessionId: SESSION_ID, turn: 7 }), { kind: 'turn', sessionId: SESSION_ID, turn: 7 })
})

test('viewRequest 只消费一次：同一请求对象重复渲染不重复处理，completeViewRequest 只调一次', () => {
  const request = { view: 'threadline', focus: 'turn:2' }
  let completes = 0
  const first = consumeFocusRequest({ request, sessionId: SESSION_ID, last: null, complete: () => { completes += 1 } })
  assert.equal(first.consumed, true)
  assert.deepEqual(first.target, { kind: 'turn', sessionId: SESSION_ID, turn: 2 })
  assert.equal(completes, 1)

  const again = consumeFocusRequest({ request, sessionId: SESSION_ID, last: first.last, complete: () => { completes += 1 } })
  assert.equal(again.consumed, false)
  assert.equal(completes, 1, 'completeViewRequest 必须只调一次')

  const other = consumeFocusRequest({ request: { view: 'threadline', focus: 'file:a.ts' }, sessionId: SESSION_ID, last: first.last })
  assert.equal(other.consumed, true)
  assert.deepEqual(other.target, { kind: 'file', path: 'a.ts' })
})

test('viewRequest 不是我们的 view / 为空：不消费、不 complete', () => {
  let completes = 0
  const other = consumeFocusRequest({ request: { view: 'chat', focus: 'turn:1' }, sessionId: SESSION_ID, last: null, complete: () => { completes += 1 } })
  assert.equal(other.consumed, false)
  assert.equal(other.target, null)
  const none = consumeFocusRequest({ request: null, sessionId: SESSION_ID, last: null, complete: () => { completes += 1 } })
  assert.equal(none.consumed, false)
  assert.equal(completes, 0)
})

test('focus 不合法也要 complete（否则宿主一直停在"请求中"）', () => {
  let completes = 0
  const result = consumeFocusRequest({ request: { view: 'threadline', focus: 'nonsense' }, sessionId: SESSION_ID, last: null, complete: () => { completes += 1 } })
  assert.equal(result.consumed, true)
  assert.equal(result.target, null)
  assert.equal(completes, 1)
})

test('跨入口 focus 桥：requestFocus 后 takeFocus 取走并清空（不持久化）', () => {
  requestFocus({ kind: 'turn', sessionId: SESSION_ID, turn: 4 })
  requestFocus({ kind: 'file', sessionId: SESSION_ID, path: 'src/b.ts' })
  assert.equal(pendingFocusCount(), 1, '同一会话只保留最后一个')
  const target = takeFocus(SESSION_ID)
  assert.deepEqual(target, { kind: 'file', sessionId: SESSION_ID, path: 'src/b.ts' })
  assert.equal(takeFocus(SESSION_ID), null, '取走后必须清空')
  assert.equal(pendingFocusCount(), 0)
})
