/*
 * tests/entries/command.test.ts —— `/threadline` 命令 + 弹窗入口（06 A43-3 / A43-4）。
 *
 * 覆盖：
 * - `inputTriggers.registerSource` 的参数（trigger/name/order）与候选过滤（leading / query）；
 * - `matchEnter` 精确命中 `/threadline` 与 `/脉络`，其它输入不认领；
 * - `onPick` 打开该会话的弹窗（内存 store）；
 * - `conversation.input.overlay` 槽注册参数；disposer 进 ctx.effect（卸载撤销）；
 * - inputTriggers 缺失只 warn、不崩，弹窗入口仍然注册。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { COMMAND_NAME, COMMAND_TOKENS, registerCommand, type InputTriggerSource } from '../../src/client/entries/command.ts'
import { closeModal, getModalState, openModalCount, resetModalStore } from '../../src/client/ui/modal/store.ts'
import { createFakeCtx, createFakeInputTriggers } from './fake-ctx.ts'
import { SESSION_ID } from './fixtures.ts'

function sourceOf(sources: Array<Record<string, unknown>>): InputTriggerSource {
  const source = sources[0] as unknown as InputTriggerSource
  assert.ok(source !== undefined, '没有注册任何 trigger source')
  return source
}

test('命令注册参数：trigger "/" / name "threadline" / order 1（菜单 label「脉络」）', async () => {
  resetModalStore()
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
  resetModalStore()
  const triggers = createFakeInputTriggers()
  const fake = createFakeCtx({ services: { inputTriggers: triggers.service } })
  registerCommand(fake.ctx)
  const source = sourceOf(triggers.sources)

  assert.equal((await source.candidates({}, { query: 'thr', position: 'leading' })).length, 1)
  assert.equal((await source.candidates({}, { query: 'zzz', position: 'leading' })).length, 0)
  assert.equal((await source.candidates({}, { query: '', position: 'inline' })).length, 0)
})

test('matchEnter 精确命中 /threadline 与 /脉络；其它整行一律不认领', async () => {
  resetModalStore()
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

test('onPick / matchEnter 打开该会话弹窗（内存 store，不持久化）', async () => {
  resetModalStore()
  const triggers = createFakeInputTriggers()
  const fake = createFakeCtx({ services: { inputTriggers: triggers.service } })
  registerCommand(fake.ctx)
  const source = sourceOf(triggers.sources)

  await source.matchEnter({ sessionId: SESSION_ID }, '/threadline')
  assert.equal(getModalState(SESSION_ID).open, true)
  assert.equal(openModalCount(), 1)

  closeModal(SESSION_ID)
  assert.equal(getModalState(SESSION_ID).open, false)

  source.onPick({ session: { sessionId: SESSION_ID } })
  assert.equal(getModalState(SESSION_ID).open, true, 'onPick 也要打开弹窗')
  resetModalStore()
})

test('弹窗入口注册：name / id / order 20，disposer 进 ctx.effect', () => {
  resetModalStore()
  const triggers = createFakeInputTriggers()
  const fake = createFakeCtx({ services: { inputTriggers: triggers.service } })
  registerCommand(fake.ctx)
  const entry = fake.registration('conversation.input.overlay')
  assert.ok(entry !== undefined)
  assert.equal(entry.name, 'conversation.input.overlay')
  assert.equal(entry.options.id, 'threadline-modal')
  assert.equal(entry.options.order, 20)
  assert.ok(fake.effectLabels.some((label) => label.includes('/threadline')))
  assert.ok(fake.effectLabels.some((label) => label.includes('input overlay')))

  fake.disposeAll()
  assert.deepEqual(fake.disposedSlots, ['conversation.input.overlay'])
  assert.deepEqual(triggers.disposed, ['threadline'], 'registerSource 的 disposer 必须被调用')
})

test('inputTriggers 缺失：只 warn、不崩，弹窗入口仍然注册', () => {
  resetModalStore()
  const fake = createFakeCtx()
  assert.doesNotThrow(() => registerCommand(fake.ctx))
  assert.ok(fake.logs.some((line) => line.level === 'warn' && line.message.includes('inputTriggers')))
  assert.ok(fake.registration('conversation.input.overlay') !== undefined)
})
