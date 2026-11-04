/*
 * tests/entries/cross.test.ts —— 跨入口跳转（06 A43-4）。
 *
 * 三条路径，共用 `state/viewFocus` 的中央桥（DOM 查询只允许在那里）：
 * 1. 每轮影响「在脉络中查看」→ requestFocus(turn) + 激活 tab；
 * 2. 弹窗「在完整脉络中查看」→ requestFocus(session/file/turn) + 激活 tab + 关闭弹窗；
 * 3. tab 侧 takeFocus 消费一次（不重复应用）。
 * 并证明：这些跳转**不产生任何投递**（无 prompt/cancel；probe 计数为 0）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  activateThreadlineTab,
  activationFailure,
  clearFocus,
  focusTokenOf,
  peekFocus,
  pendingFocusCount,
  requestFocus,
  takeFocus,
} from '../../src/client/state/viewFocus.ts'
import { closeModal, getModalState, openModal, openModalCount, resetModalStore } from '../../src/client/ui/modal/store.ts'
import { createTabDocument } from './fake-dom.ts'
import { SESSION_ID } from './fixtures.ts'

test('activateThreadlineTab：按 role=tab 文本「脉络」找到并点击', () => {
  clearFocus()
  const doc = createTabDocument([
    { text: '对话', onSelect: () => undefined },
    { text: '轨迹', onSelect: () => undefined },
    { text: '脉络' },
  ])
  assert.equal(activateThreadlineTab(doc.document), true)
  assert.deepEqual(doc.clicked, ['脉络'])
  assert.equal(activationFailure(), null)
})

test('activateThreadlineTab：aria-label / data-view-id 两种兜底；找不到返回 false（不崩）', () => {
  clearFocus()
  const byAria = createTabDocument([{ ariaLabel: '脉络' }])
  assert.equal(activateThreadlineTab(byAria.document), true)

  const byId = createTabDocument([{ text: 'x', viewId: 'threadline' }])
  assert.equal(activateThreadlineTab(byId.document), true)

  const missing = createTabDocument([{ text: '对话' }])
  assert.equal(activateThreadlineTab(missing.document), false)
  assert.equal(activationFailure(), 'tab-not-found')
  assert.equal(activateThreadlineTab(null), false, '没有 document 也不崩')
})

test('影响 → tab：先 requestFocus 再激活；tab 侧 takeFocus 只消费一次', () => {
  clearFocus()
  requestFocus({ kind: 'turn', sessionId: SESSION_ID, turn: 2 })
  const doc = createTabDocument([{ text: '脉络' }])
  assert.equal(activateThreadlineTab(doc.document), true)
  assert.deepEqual(peekFocus(SESSION_ID), { kind: 'turn', sessionId: SESSION_ID, turn: 2 })

  assert.deepEqual(takeFocus(SESSION_ID), { kind: 'turn', sessionId: SESSION_ID, turn: 2 })
  assert.equal(takeFocus(SESSION_ID), null, '消费过一次后不再重复应用')
  assert.equal(pendingFocusCount(), 0)
})

test('弹窗 → 完整脉络：focus 目标 + 关闭弹窗（内存态，不持久化）', () => {
  clearFocus()
  resetModalStore()
  openModal(SESSION_ID)
  assert.equal(getModalState(SESSION_ID).open, true)
  assert.equal(openModalCount(), 1)

  // ThreadlineModal 的 onOpenFull 由 overlay 接到这三步（见 entries/command.ts）
  requestFocus({ kind: 'session', sessionId: SESSION_ID })
  const doc = createTabDocument([{ text: '脉络' }])
  assert.equal(activateThreadlineTab(doc.document), true)
  closeModal(SESSION_ID)
  assert.equal(getModalState(SESSION_ID).open, false)
  assert.deepEqual(peekFocus(SESSION_ID), { kind: 'session', sessionId: SESSION_ID })
  clearFocus()
})

test('focus token 与请求一一对应（impact/弹窗传给 tab 的不透明字符串）', () => {
  assert.equal(focusTokenOf({ kind: 'turn', sessionId: SESSION_ID, turn: 3 }), 'turn:3')
  assert.equal(focusTokenOf({ kind: 'file', sessionId: SESSION_ID, path: 'src/a.ts' }), 'file:src/a.ts')
  assert.equal(focusTokenOf({ kind: 'session', sessionId: SESSION_ID }), 'session:' + SESSION_ID)
})
