/*
 * tests/entries/cross.test.ts —— 跨入口跳转（06 A43-4）。
 *
 * 三条路径，共用 `state/viewFocus` 的中央桥（DOM 查询只允许在那里）：
 * 1. 每轮影响图标点击（T20：不再弹窗）→ requestFocus(turn/session) + 激活 tab；
 * 2. `/threadline` 命令触发（T32：弹窗已删除）→ requestFocus(session) + 激活 tab；
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
import { openThreadlineForCommand } from '../../src/client/entries/command.ts'
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

test('activateThreadlineTab：文案「包含」也能命中（宿主会加空格/快捷键提示），data-view-id 优先', () => {
  clearFocus()
  const ariaContains = createTabDocument([{ ariaLabel: '脉络 视图' }])
  assert.equal(activateThreadlineTab(ariaContains.document), true)
  assert.deepEqual(ariaContains.clicked, ['脉络 视图'])

  const textContains = createTabDocument([{ text: '脉络详情' }])
  assert.equal(activateThreadlineTab(textContains.document), true)
  assert.deepEqual(textContains.clicked, ['脉络详情'])

  // data-view-id="threadline" 命中时不再按文案猜（优先最明确的标记）
  const byDataFirst = createTabDocument([{ text: '对话' }, { text: '视角', viewId: 'threadline' }, { text: '脉络' }])
  assert.equal(activateThreadlineTab(byDataFirst.document), true)
  assert.deepEqual(byDataFirst.clicked, ['视角'], 'data-view-id 优先于 textContent 精确匹配')
})

test('activateThreadlineTab：首帧没找到 → 下一帧再试一次（rAF）；仍失败保留 tab-not-found', () => {
  clearFocus()
  const frames: Array<() => void> = []
  ;(globalThis as unknown as { requestAnimationFrame?: (callback: () => void) => number }).requestAnimationFrame = (callback) => {
    frames.push(callback)
    return frames.length
  }
  try {
    // 首帧没有 tab，下一帧才挂载：首帧返回 false + 记失败，重试命中后清掉失败。
    let present = false
    const clicked: string[] = []
    const lazyDocument = {
      querySelectorAll: () => (present ? [{ textContent: '脉络', getAttribute: () => null, click: () => clicked.push('脉络') }] : []),
    } as unknown as Document
    assert.equal(activateThreadlineTab(lazyDocument), false, '首帧返回 false（同步契约不变）')
    assert.equal(activationFailure(), 'tab-not-found')
    assert.equal(frames.length, 1, '调了一次 requestAnimationFrame')
    present = true
    frames[0]()
    assert.deepEqual(clicked, ['脉络'], '下一帧的 tab 被点中')
    assert.equal(activationFailure(), null, '重试成功后清掉失败原因')

    // 下一帧仍然找不到：保留失败原因。
    frames.length = 0
    const neverDocument = { querySelectorAll: () => [] } as unknown as Document
    assert.equal(activateThreadlineTab(neverDocument), false)
    assert.equal(frames.length, 1)
    frames[0]()
    assert.equal(activationFailure(), 'tab-not-found')
  } finally {
    delete (globalThis as unknown as { requestAnimationFrame?: (callback: () => void) => number }).requestAnimationFrame
  }
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

test('命令 → tab：focus 目标为会话 + 激活 tab（T32：弹窗已删除，不再有"关闭弹窗"这一步）', () => {
  clearFocus()
  const doc = createTabDocument([{ text: '对话' }, { text: '脉络' }])
  ;(globalThis as unknown as { document?: Document }).document = doc.document
  try {
    assert.equal(openThreadlineForCommand(SESSION_ID), true, '命令触发 = 导航（tab 被点中）')
    assert.deepEqual(peekFocus(SESSION_ID), { kind: 'session', sessionId: SESSION_ID }, '命令落点是会话 focus')
    assert.deepEqual(doc.clicked, ['脉络'])
    assert.deepEqual(takeFocus(SESSION_ID), { kind: 'session', sessionId: SESSION_ID })
    assert.equal(takeFocus(SESSION_ID), null, 'tab 侧消费一次')
  } finally {
    clearFocus()
    delete (globalThis as unknown as { document?: Document }).document
  }
})

test('focus token 与请求一一对应（impact/命令传给 tab 的不透明字符串）', () => {
  assert.equal(focusTokenOf({ kind: 'turn', sessionId: SESSION_ID, turn: 3 }), 'turn:3')
  assert.equal(focusTokenOf({ kind: 'file', sessionId: SESSION_ID, path: 'src/a.ts' }), 'file:src/a.ts')
  assert.equal(focusTokenOf({ kind: 'session', sessionId: SESSION_ID }), 'session:' + SESSION_ID)
})
