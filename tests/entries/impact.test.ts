/*
 * tests/entries/impact.test.ts —— 「影响 N」三态 + 锚点去重 + popover 内容（06 A43-2）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createTranslator } from '../../src/client/locale/index.ts'
import { ImpactPopover, ImpactAction, registerImpact, IMPACT_LIMITS } from '../../src/client/entries/impact.ts'
import {
  decideImpact,
  impactAnchorOf,
  impactForMessage,
  impactOf,
  isImpactAnchor,
  turnOfMessage,
} from '../../src/client/entries/impactModel.ts'
import type { TurnDetail } from '../../src/shared/events/index.ts'
import { createFakeCtx } from './fake-ctx.ts'
import { SESSION_ID, buildDetail, buildTurnWithoutFinal, buildTurns } from './fixtures.ts'

const t = createTranslator('zh')

/* ---------------- 注册参数 ---------------- */

test('影响 N 注册参数：name=conversation.chat.assistant-actions / id / order 50', () => {
  const fake = createFakeCtx()
  assert.equal(registerImpact(fake.ctx), true)
  const entry = fake.registration('conversation.chat.assistant-actions')
  assert.ok(entry !== undefined)
  assert.equal(entry.name, 'conversation.chat.assistant-actions')
  assert.equal(entry.options.id, 'threadline-impact')
  assert.equal(entry.options.order, 50)
  fake.disposeAll()
  assert.deepEqual(fake.disposedSlots, ['conversation.chat.assistant-actions'])
})

test('影响 N 注册：slots 缺失只 warn', () => {
  const fake = createFakeCtx({ withSlots: false })
  assert.doesNotThrow(() => registerImpact(fake.ctx))
  assert.ok(fake.logs.some((line) => line.level === 'warn'))
})

/* ---------------- 计数与锚点 ---------------- */

test('计数口径：文件去重 + 命令 + 子智能体 + 错误只算 1 个问题（03 §7.1）', () => {
  const turn = buildTurns()[0]
  assert.deepEqual(impactOf(turn), { files: 3, commands: 1, subagents: 1, errors: 0, n: 5 })

  const errorTurn = buildTurns()[1]
  assert.deepEqual(impactOf(errorTurn), { files: 0, commands: 0, subagents: 0, errors: 1, n: 1 })

  const duplicate: TurnDetail = {
    ...turn,
    files: [
      { path: 'a.ts', ops: ['read'], added: 0, removed: 0 },
      { path: 'a.ts', ops: ['write'], added: 1, removed: 0 },
      { path: 'b.ts', ops: ['read'], added: 0, removed: 0 },
    ],
  }
  assert.equal(impactOf(duplicate).files, 2, '同一文件多次只算 1')
})

test('锚点：优先 finalMessageId；没有时按 turn 去重到 messageIds 最后一条', () => {
  const turn = buildTurns()[0]
  assert.equal(impactAnchorOf(turn), 'm-1b')
  assert.equal(isImpactAnchor(turn, 'm-1a'), false)
  assert.equal(isImpactAnchor(turn, 'm-1b'), true)

  const noFinal = buildTurnWithoutFinal()
  assert.equal(impactAnchorOf(noFinal), 'm-1b', '缺 finalMessageId 时取最后一条 messageId（确定性）')
})

test('messageTurns 映射：拿得到该轮；拿不到 → 不渲染（不猜）', () => {
  const detail = buildDetail()
  assert.equal(turnOfMessage(detail, 'm-1a')?.n, 1)
  assert.equal(turnOfMessage(detail, 'm-unknown'), null)
  assert.equal(turnOfMessage(null, 'm-1a'), null)
  assert.equal(impactForMessage(detail, 'm-1a'), null, '非锚点消息不渲染（同一轮只渲染一次）')
  const anchor = impactForMessage(detail, 'm-1b')
  assert.ok(anchor !== null)
  assert.equal(anchor?.turn.n, 1)
  assert.equal(anchor?.counts.n, 5)
})

/* ---------------- 三态 ---------------- */

test('三态：加载中 → loading；失败 → unknown；有数据 → ready / hidden', () => {
  assert.deepEqual(decideImpact({ messageId: 'm-1b', sessionId: SESSION_ID, detail: null, status: 'loading' }), { kind: 'loading' })
  assert.deepEqual(decideImpact({ messageId: 'm-1b', sessionId: SESSION_ID, detail: null, status: 'idle' }), { kind: 'loading' })
  assert.deepEqual(decideImpact({ messageId: 'm-1b', sessionId: SESSION_ID, detail: null, status: 'error' }), { kind: 'unknown' })
  assert.deepEqual(decideImpact({ messageId: '', sessionId: SESSION_ID, detail: null, status: 'ready' }), { kind: 'hidden', reason: 'no-message-id' })

  const detail = buildDetail()
  const ready = decideImpact({ messageId: 'm-1b', sessionId: SESSION_ID, detail, status: 'ready' })
  assert.equal(ready.kind, 'ready')
  if (ready.kind === 'ready') {
    assert.equal(ready.turn.n, 1)
    assert.equal(ready.counts.n, 5)
  }

  // 没有影响（T3：无文件/命令/子智能体/错误）→ 不渲染"影响 0"（06 N-15）
  // 注意用**已完成**的 detail：运行中的会话即便当前读数 0，也仍可能产生影响，属"未知"不属"没有"。
  const done = completedDetail(detail)
  assert.deepEqual(decideImpact({ messageId: 'm-3a', sessionId: SESSION_ID, detail: done, status: 'ready' }), { kind: 'hidden', reason: 'zero-impact' })
  // 序列不可得
  assert.deepEqual(decideImpact({ messageId: 'm-zzz', sessionId: SESSION_ID, detail: done, status: 'ready' }), { kind: 'hidden', reason: 'no-turn' })
})

test('运行中的会话（detail 未读全）：找不到轮次/计数为 0 → streaming（不隐藏，2026-11-05 真机反馈）', () => {
  const running = buildDetail()
  assert.equal(running.partial === true || running.status === 'running', true, '本夹具就是"未读全"的会话')
  assert.deepEqual(decideImpact({ messageId: 'm-zzz', sessionId: SESSION_ID, detail: running, status: 'ready' }), { kind: 'streaming' })
  assert.deepEqual(decideImpact({ messageId: 'm-3a', sessionId: SESSION_ID, detail: running, status: 'ready' }), { kind: 'streaming' })
  // 已读全的轮次照常 ready，不受影响
  const ready = decideImpact({ messageId: 'm-1b', sessionId: SESSION_ID, detail: running, status: 'ready' })
  assert.equal(ready.kind, 'ready')
})

/* ---------------- 渲染 ---------------- */

/** 把夹具改成"已完成"的会话（测试"确定没有影响"要用它，否则会落到 streaming 语义）。 */
function completedDetail(detail: ReturnType<typeof buildDetail>): ReturnType<typeof buildDetail> {
  return { ...detail, status: 'completed' as const, running: false }
}

function renderImpact(props: Record<string, unknown>): string {
  return renderToStaticMarkup(React.createElement(ImpactAction, { locale: 'zh', ...props }))
}

test('渲染：未加载/读取失败时图标仍在、可点（不再 aria-disabled），tooltip 用既有 key', () => {
  const loadingHtml = renderImpact({ messageId: 'm-1b', sessionId: SESSION_ID, store: fakeStore(null) })
  assert.ok(loadingHtml.includes('threadline-impact-icon-btn'), '图标按钮必须可见（不是空白）')
  // 2026-11-04 真机反馈「点不动」→ 未加载态也必须可点（点了弹如实说明 + 只读重新读取），不再是禁用态
  assert.ok(!loadingHtml.includes('aria-disabled="true"'), '未加载态不许再禁用（用户要求可点）')
  assert.ok(loadingHtml.includes('aria-haspopup="dialog"'))
  assert.ok(loadingHtml.includes('data-state="loading"'))
  assert.ok(loadingHtml.includes('正在读取本轮记录'), 'tooltip 应给 state.loadingDetail')
  assert.ok(loadingHtml.includes('<svg'), '内联 SVG 图标（不引第三方库）')

  const errorHtml = renderImpact({ messageId: 'm-1b', sessionId: SESSION_ID, store: fakeStore(errorEntry()) })
  assert.ok(errorHtml.includes('data-state="unknown"'))
  assert.ok(errorHtml.includes('观测不到'), 'tooltip 应给 state.unknown')
  assert.ok(!errorHtml.includes('aria-disabled="true"'), '读取失败态也不许禁用')
})

test('渲染：有影响 → 图标按钮（D-25），aria-label 给完整影响计数、aria-haspopup/expanded 正确', () => {
  const ready = renderImpact({ messageId: 'm-1b', sessionId: SESSION_ID, store: fakeStore(readyEntry()) })
  assert.ok(ready.includes('threadline-impact-icon-btn'))
  assert.ok(ready.includes('threadline-impact-root'), '宿主内嵌根 className（不在 .threadline-app 之内）')
  assert.ok(ready.includes('data-impact-count="5"'))
  assert.ok(ready.includes('aria-haspopup="dialog"'))
  assert.ok(ready.includes('aria-expanded="false"'))
  assert.match(ready, /aria-label="[^"]*3[^"]*1[^"]*1[^"]*"/, 'aria-label 应带文件/命令/子智能体计数')
  assert.equal(ready.includes('影响 0'), false)

  // 三态仍按 03 §2.2：无影响 / 非锚点 / 序列不可得 → 不渲染
  assert.match(renderImpact({ messageId: 'm-1a', sessionId: SESSION_ID, store: fakeStore(readyEntry()) }), /data-threadline-impact-hidden="not-anchor"/)
  assert.match(renderImpact({ messageId: 'm-3a', sessionId: SESSION_ID, store: fakeStore(readyEntry('completed')) }), /data-threadline-impact-hidden="zero-impact"/)
  assert.match(renderImpact({ messageId: 'm-zzz', sessionId: SESSION_ID, store: fakeStore(readyEntry('completed')) }), /data-threadline-impact-hidden="no-turn"/)
})

test('popover 内容：文件 ≤8 / 命令 ≤3 / 子智能体 ≤3 +「还有 N 条」+ 两个动作 + 不显示正文', () => {
  const detail = buildDetail()
  const turn = detail.turns[0]
  const many: TurnDetail = {
    ...turn,
    files: Array.from({ length: 11 }, (_, index) => ({ path: 'src/f' + String(index) + '.ts', ops: ['write'] as const, added: index, removed: 0 })),
    commands: Array.from({ length: 5 }, (_, index) => ({
      id: 'c-' + String(index),
      tool: 'shell',
      program: 'pnpm',
      status: 'success' as const,
      startedAt: 0,
      durationMs: 1000,
      text: 'pnpm test --secret-arg',
    })),
    subagents: ['a1', 'a2', 'a3', 'a4'],
  }
  const html = renderToStaticMarkup(
    React.createElement(ImpactPopover, {
      turn: many,
      counts: impactOf(many),
      sessionId: SESSION_ID,
      mode: 'metadata',
      t,
      onOpenTab: () => undefined,
      onOpenModal: () => undefined,
      onClose: () => undefined,
    }),
  )
  assert.ok(html.includes('本轮影响 · T1'))
  assert.ok(html.includes('在脉络中查看'))
  assert.ok(html.includes('打开本次对话脉络'))
  assert.ok(html.includes('还有 3 条'), '文件 11 条超过 8 → 还有 3 条')
  assert.ok(html.includes('还有 2 条'), '命令 5 条超过 3 / 子智能体 4 条超过 3')
  assert.ok(!html.includes('pnpm test --secret-arg'), '正文（命令全文）一律不显示')
  assert.ok(!html.includes('先把 merge'), '不显示用户消息正文')
  assert.equal((html.match(/data-row="file"/g) ?? []).length, IMPACT_LIMITS.files)
  assert.equal((html.match(/data-row="command"/g) ?? []).length, IMPACT_LIMITS.commands)
  assert.equal((html.match(/data-row="subagent"/g) ?? []).length, IMPACT_LIMITS.subagents)
})

/* ---------------- 假 store ---------------- */

function fakeStore(entry: unknown): never {
  const store = {
    peek: () => entry,
    request: () => Promise.resolve(entry),
    refresh: () => Promise.resolve(entry),
    subscribe: () => () => undefined,
    dispose: () => undefined,
    invalidate: () => undefined,
    clear: () => undefined,
    setGeneration: () => undefined,
    generation: 0,
    size: 1,
    inflight: 0,
  }
  return store as never
}

function readyEntry(sessionStatus: 'running' | 'completed' = 'running'): unknown {
  const detail = sessionStatus === 'completed' ? { ...buildDetail(), status: 'completed' as const, running: false } : buildDetail()
  return { sessionId: SESSION_ID, status: 'ready', detail, partial: false, updatedAt: 0, fetchedAt: 0, stale: false, generation: 0 }
}

function errorEntry(): unknown {
  return { sessionId: SESSION_ID, status: 'error', detail: undefined, partial: false, updatedAt: 0, fetchedAt: 0, stale: false, generation: 0, error: { code: 'threadline/internal', message: 'x' } }
}
