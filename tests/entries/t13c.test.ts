/*
 * tests/entries/t13c.test.ts —— 真机第二轮：影响 hidden 可观测 + D-28 布局依赖的纯函数。
 *
 * T20（2026-11-05）：影响图标点击改为直接切「脉络」tab，popover/Portal/placeImpactPopover 整条旧路径删除，
 * 因此本文件不再有 placeImpactPopover 的四条落位用例（它们测的是被删除的旧表面）。
 * T32（2026-11-05 notes/33 §1/§7）：`/threadline` 弹窗删除（ui/modal/** 与 modal.css 全删），
 * 本文件删除「弹窗根 + Overlay 走 Portal」用例（测的是被删除的旧表面）。
 * Portal 组件本身也由 map-dev 在 T31 作为"无产品调用方"组件清理，故 Portal 的 SSR 兜底用例一并删除
 * （删除理由：组件被删，测试无被测对象；不是削弱断言）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ImpactAction, impactHiddenMarker } from '../../src/client/entries/impact.ts'
import { decideImpact, turnOfMessage } from '../../src/client/entries/impactModel.ts'
import { shouldShowDiag } from '../../src/client/entries/tab.ts'
import { SESSION_ID, buildDetail } from './fixtures.ts'

/* ---------------- 影响 hidden 可观测 ---------------- */

const hiddenMarkerHtml = (reason: string) =>
  renderToStaticMarkup(impactHiddenMarker({ reason, messageId: 'm-x', sessionId: 's-x' }))

test('hidden 原因：五种 reason 都可观测（display:none 标记 + 带 messageId/sessionId）', () => {
  for (const reason of ['no-message-id', 'no-session-id', 'no-turn', 'not-anchor', 'zero-impact']) {
    const html = hiddenMarkerHtml(reason)
    assert.ok(html.includes('data-threadline-impact-hidden="' + reason + '"'), reason)
    assert.ok(html.includes('data-message-id="m-x"'))
    assert.ok(html.includes('data-session-id="s-x"'))
    assert.ok(html.includes('display:none'))
  }
})

test('hidden 原因：decideImpact 的 reason 与上图一致（no-message-id / no-session-id / no-turn / not-anchor / zero-impact）', () => {
  // 用**已完成**的会话：运行中的会话里"找不到轮次/计数为 0"是 streaming（未知），不是 hidden。
  const detail = { ...buildDetail(), status: 'completed' as const, running: false }
  assert.deepEqual(decideImpact({ messageId: '', sessionId: SESSION_ID, detail, status: 'ready' }), {
    kind: 'hidden',
    reason: 'no-message-id',
  })
  assert.deepEqual(decideImpact({ messageId: 'm-1b', sessionId: '', detail, status: 'ready' }), {
    kind: 'hidden',
    reason: 'no-session-id',
  })
  assert.deepEqual(decideImpact({ messageId: 'm-zzz', sessionId: SESSION_ID, detail, status: 'ready' }), {
    kind: 'hidden',
    reason: 'no-turn',
  })
  assert.deepEqual(decideImpact({ messageId: 'm-1a', sessionId: SESSION_ID, detail, status: 'ready' }), {
    kind: 'hidden',
    reason: 'not-anchor',
  })
  assert.deepEqual(decideImpact({ messageId: 'm-3a', sessionId: SESSION_ID, detail, status: 'ready' }), {
    kind: 'hidden',
    reason: 'zero-impact',
  })
})

test('messageId 兜底：messageTurns 查不到时线性查 turns[].messageIds（大小写不敏感）', () => {
  const detail = buildDetail()
  // 把主通道清空，只留 messageIds
  const loose = { ...detail, messageTurns: {} as Record<string, number> }
  const turn = turnOfMessage(loose, 'M-1B')
  assert.ok(turn !== null)
  assert.equal(turn?.n, 1)
  assert.equal(turnOfMessage(loose, 'm-2a')?.n, 2)
  assert.equal(turnOfMessage(loose, 'm-zzz'), null)
})

test('sessionId 兜底：快照 current 缺失时取 running 的那条（else 渲染 no-session-id 标记）', () => {
  const readyEntry = { sessionId: SESSION_ID, status: 'ready', detail: buildDetail(), partial: false, updatedAt: 0, fetchedAt: 0, stale: false, generation: 0 }
  const store = {
    peek: () => readyEntry,
    request: () => Promise.resolve(readyEntry),
    refresh: () => Promise.resolve(readyEntry),
    subscribe: () => () => undefined,
    dispose: () => undefined,
  } as never
  const useSessions = (selector: (snapshot: unknown) => unknown): unknown =>
    selector({ ids: [SESSION_ID], byId: { [SESSION_ID]: { running: true } } })
  const html = renderToStaticMarkup(
    React.createElement(ImpactAction, { locale: 'zh', messageId: 'm-1b', useSessions, store }),
  )
  assert.ok(html.includes('threadline-impact-icon-btn'), 'running 会话被兜底选中 → 渲染图标')
  assert.ok(!html.includes('data-threadline-impact-hidden'), '不应落到 hidden')

  const noneHtml = renderToStaticMarkup(
    React.createElement(ImpactAction, {
      locale: 'zh',
      messageId: 'm-1b',
      useSessions: (selector: (snapshot: unknown) => unknown) => selector({ ids: [], byId: {} }),
      store,
    }),
  )
  assert.ok(noneHtml.includes('data-threadline-impact-hidden="no-session-id"'))
})

/* ---------------- D-28：诊断与布局前提 ---------------- */

test('D-28：诊断条触发条件不变（failed 或 degrade 非 none），五档布局由 harness 负责', () => {
  assert.equal(shouldShowDiag({ status: 'partial', degradeKind: 'none' }), false)
  assert.equal(shouldShowDiag({ status: 'failed', degradeKind: 'none' }), true)
})
