/*
 * tests/entries/command.test.ts —— `/threadline` 命令（06 A43-3 / A43-4；T32 新契约）。
 *
 * T32（2026-11-05 notes/33 §1/§7）：**弹窗已删除**。命令触发（菜单 pick / Enter）不再 openModal，
 * 而是 `requestFocus({ kind: 'session' })` + `activateThreadlineTab()`，跳到「脉络」tab。
 *
 * 本文件锁：
 * - `inputTriggers.registerSource` 的参数（trigger/name/order）与候选过滤（leading / query）；
 * - `matchEnter` 精确命中 `/threadline` 与 `/脉络`，其它输入不认领；
 * - onPick / matchEnter = 导航（用假宿主 tab 断言真的被点中；focus 目标为会话）；
 * - **不再注册** `conversation.input.overlay`（slot 注册数 0），命令模块也不再导出任何弹窗符号；
 * - inputTriggers 缺失只 warn、不崩。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import * as commandModule from '../../src/client/entries/command.ts'
import {
  COMMAND_NAME,
  COMMAND_TOKENS,
  openThreadlineForCommand,
  registerCommand,
  type InputTriggerSource,
} from '../../src/client/entries/command.ts'
import { clearFocus, peekFocus, pendingFocusCount, requestFocus } from '../../src/client/state/viewFocus.ts'
import { createFakeCtx, createFakeInputTriggers } from './fake-ctx.ts'
import { createTabDocument } from './fake-dom.ts'
import { SESSION_ID } from './fixtures.ts'

function sourceOf(sources: Array<Record<string, unknown>>): InputTriggerSource {
  const source = sources[0] as unknown as InputTriggerSource
  assert.ok(source !== undefined, '没有注册任何 trigger source')
  return source
}

test('命令注册参数：trigger "/" / name "threadline" / order 1（菜单 label「脉络」）', async () => {
  const triggers = createFakeInputTriggers()
  const fake = createFakeCtx({ services: { inputTriggers: triggers.service } })
  assert.equal(registerCommand(fake.ctx), true)
  const source = sourceOf(triggers.sources)
  assert.equal(source.trigger, '/')
  assert.equal(source.name, COMMAND_NAME)
  assert.equal(source.name, 'threadline')
  assert.equal(source.order, 1)

  const candidates = await source.candidates({ sessionId: SESSION_ID }, { query: '', position: 'leading' })
  assert.equal(candidates.length, 1)
  assert.equal(candidates[0].name, 'threadline')
  assert.equal(candidates[0].label, '脉络')
})

test('候选过滤：只在行首触发；query 不匹配就不出现', async () => {
  const triggers = createFakeInputTriggers()
  const fake = createFakeCtx({ services: { inputTriggers: triggers.service } })
  registerCommand(fake.ctx)
  const source = sourceOf(triggers.sources)

  assert.equal((await source.candidates({}, { query: 'thr', position: 'leading' })).length, 1)
  assert.equal((await source.candidates({}, { query: 'zzz', position: 'leading' })).length, 0)
  assert.equal((await source.candidates({}, { query: '', position: 'inline' })).length, 0)
})

test('matchEnter：精确命中 /threadline 与 /脉络；其它整行一律不认领', async () => {
  const triggers = createFakeInputTriggers()
  const fake = createFakeCtx({ services: { inputTriggers: triggers.service } })
  registerCommand(fake.ctx)
  const source = sourceOf(triggers.sources)

  assert.deepEqual(COMMAND_TOKENS, ['/threadline', '/脉络'])
  for (const token of COMMAND_TOKENS) {
    assert.equal(await source.matchEnter({ sessionId: SESSION_ID }, token), 'handled')
  }
  assert.equal(await source.matchEnter({ sessionId: SESSION_ID }, '/threadlinex'), undefined)
  assert.equal(await source.matchEnter({ sessionId: SESSION_ID }, '/threadline extra'), undefined)
  assert.equal(await source.matchEnter({ sessionId: SESSION_ID }, 'threadline'), undefined)
  assert.equal(await source.matchEnter({ sessionId: SESSION_ID }, ''), undefined)
  // 首尾空白（用户误按空格）仍应认领
  assert.equal(await source.matchEnter({ sessionId: SESSION_ID }, '  /threadline  '), 'handled')
})

test('matchEnter / onPick = 导航：requestFocus(session) + 点中假宿主「脉络」tab（不开窗）', async () => {
  clearFocus()
  const triggers = createFakeInputTriggers()
  const fake = createFakeCtx({ services: { inputTriggers: triggers.service } })
  registerCommand(fake.ctx)
  const source = sourceOf(triggers.sources)
  const doc = createTabDocument([{ text: '对话' }, { text: '脉络' }])
  ;(globalThis as unknown as { document?: Document }).document = doc.document
  try {
    await source.matchEnter({ sessionId: SESSION_ID }, '/threadline')
    assert.deepEqual(peekFocus(SESSION_ID), { kind: 'session', sessionId: SESSION_ID }, 'Enter 落点为会话级 focus')
    assert.deepEqual(doc.clicked, ['脉络'], '真的点中「脉络」，不碰「对话」')

    clearFocus()
    assert.equal(source.onPick({ session: { sessionId: SESSION_ID }, candidate: { name: COMMAND_NAME } }), 'handled')
    assert.deepEqual(peekFocus(SESSION_ID), { kind: 'session', sessionId: SESSION_ID }, 'onPick 落点同为会话级 focus')
    assert.deepEqual(doc.clicked, ['脉络', '脉络'])

    // 不是我们的 candidate：交还给宿主，不导航（不抢别人的 pick）
    clearFocus()
    assert.equal(source.onPick({ session: { sessionId: SESSION_ID }, candidate: { name: 'context' } }), undefined)
    assert.equal(peekFocus(SESSION_ID), null)
    assert.deepEqual(doc.clicked, ['脉络', '脉络'], '非本命令不触发 tab 点击')
  } finally {
    clearFocus()
    delete (globalThis as unknown as { document?: Document }).document
  }
})

test('openThreadlineForCommand：会话 id 两种上下文都能取到；空 sessionId 仍切 tab（不落 focus）', () => {
  clearFocus()
  const doc = createTabDocument([{ text: '脉络' }])
  ;(globalThis as unknown as { document?: Document }).document = doc.document
  try {
    assert.equal(openThreadlineForCommand(SESSION_ID), true)
    assert.deepEqual(peekFocus(SESSION_ID), { kind: 'session', sessionId: SESSION_ID })

    clearFocus()
    // 嵌套 session.sessionId 的取法由 contextSessionId 覆盖（这里直接验证导出的动作函数本身）
    openThreadlineForCommand('')
    assert.equal(pendingFocusCount(), 0, '空 sessionId 不登记 focus')
    assert.deepEqual(doc.clicked, ['脉络', '脉络'], '没有 sessionId 也要把用户送到 tab')

    // 同一会话只保留最后一个目标（不排队）
    requestFocus({ kind: 'session', sessionId: SESSION_ID })
    requestFocus({ kind: 'session', sessionId: SESSION_ID })
    assert.equal(pendingFocusCount(), 1)
  } finally {
    clearFocus()
    delete (globalThis as unknown as { document?: Document }).document
  }
})

test('T32：不再注册 conversation.input.overlay（slot 0 条），命令模块不导出任何弹窗符号', () => {
  const triggers = createFakeInputTriggers()
  const fake = createFakeCtx({ services: { inputTriggers: triggers.service } })
  registerCommand(fake.ctx)

  assert.deepEqual(fake.entries, [], '命令入口不再注册任何 slot（弹窗走 conversation.input.overlay 的旧路径已删）')
  assert.equal(fake.registration('conversation.input.overlay'), undefined)
  assert.ok(fake.effectLabels.some((label) => label.includes('/threadline')), 'registerSource 的 disposer 仍进 ctx.effect')

  const modalExports = Object.keys(commandModule).filter((name) => /Modal|Overlay|modal/i.test(name))
  assert.deepEqual(modalExports, [], '命令模块不再有 ThreadlineOverlay/OverlaySlotProps 等弹窗导出')

  fake.disposeAll()
  assert.deepEqual(fake.disposedSlots, [], '没有 slot 需要撤销')
  assert.deepEqual(triggers.disposed, ['threadline'], 'registerSource 的 disposer 必须被调用')
})

test('inputTriggers 缺失：只 warn、不崩，也不注册任何 slot', () => {
  const fake = createFakeCtx()
  assert.doesNotThrow(() => registerCommand(fake.ctx))
  assert.equal(registerCommand(fake.ctx), false, '没注册到 trigger source 时返回 false')
  assert.ok(fake.logs.some((line) => line.level === 'warn' && line.message.includes('inputTriggers')))
  assert.equal(fake.entries.length, 0)
})
