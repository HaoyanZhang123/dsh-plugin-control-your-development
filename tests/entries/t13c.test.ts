/*
 * tests/entries/t13c.test.ts —— 真机第二轮：D-27 portal/落位 + 影响 hidden 可观测 + D-28 布局依赖的纯函数。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createTranslator } from '../../src/client/locale/index.ts'
import {
  ImpactAction,
  impactHiddenMarker,
  placeImpactPopover,
} from '../../src/client/entries/impact.ts'
import { decideImpact, turnOfMessage } from '../../src/client/entries/impactModel.ts'
import { ThreadlineModal } from '../../src/client/ui/modal/ThreadlineModal.ts'
import { Portal } from '../../src/client/ui/shell/Portal.ts'
import { shouldShowDiag } from '../../src/client/entries/tab.ts'
import { BASE_TIME, SESSION_ID, buildDetail } from './fixtures.ts'

const t = createTranslator('zh')

/* ---------------- D-27：portal 落位 ---------------- */

test('placeImpactPopover：默认落按钮下方 6px，右对齐触发按钮', () => {
  const placement = placeImpactPopover(
    { top: 100, bottom: 124, left: 1200, right: 1224 },
    { width: 1440, height: 900 },
  )
  assert.equal(placement.below, true)
  assert.equal(placement.top, 130, '下方 6px')
  assert.equal(placement.left, 1224 - 360)
  assert.equal(placement.width, 360)
})

test('placeImpactPopover：下方空间不足且小于上方 → 翻到上方（bottom 锚定）', () => {
  const placement = placeImpactPopover({ top: 600, bottom: 624, left: 400, right: 424 }, { width: 1440, height: 700 })
  assert.equal(placement.below, false)
  assert.equal(placement.top, 0)
  assert.equal(placement.bottom, 700 - 600 + 6)
})

test('placeImpactPopover：左右越界夹进视口（右对齐优先，左侧保底 8px）', () => {
  const roomy = placeImpactPopover({ top: 100, bottom: 124, left: 900, right: 924 }, { width: 1440, height: 900 })
  assert.equal(roomy.left, 924 - 360, '空间足够时右对齐到按钮右缘')
  const overflowRight = placeImpactPopover({ top: 100, bottom: 124, left: 140, right: 164 }, { width: 1440, height: 900 })
  assert.equal(overflowRight.left, 8, '右侧越界 → 夹到左边界 8px')
  const narrow = placeImpactPopover({ top: 100, bottom: 124, left: 10, right: 34 }, { width: 300, height: 900 })
  assert.ok(narrow.left >= 8)
  assert.equal(narrow.width, 284, '窄视口收窄到 视口-16')
})

test('Portal：无 document（SSR）时内联渲染 children（单测可断言）', () => {
  const html = renderToStaticMarkup(
    React.createElement(Portal, { testId: 'x' }, React.createElement('span', { 'data-x': '1' }, 'inl')),
  )
  assert.ok(html.includes('data-x="1"'))
  assert.ok(html.includes('inl'))
  assert.ok(!html.includes('data-threadline-portal'), 'SSR 不产生真实 portal 节点')
})

test('弹窗根只带 threadline-modal-root，Overlay 走 Portal（SSR 内联兜底），dialog 语义保持', () => {
  const detail = buildDetail()
  const html = renderToStaticMarkup(
    React.createElement(ThreadlineModal, {
      open: true,
      sessionId: SESSION_ID,
      detail,
      files: new Map(),
      mode: 'metadata',
      now: BASE_TIME,
      t,
      onClose: () => undefined,
      onOpenFull: () => undefined,
    }),
  )
  assert.ok(html.includes('threadline-modal-root'))
  assert.ok(!/class="[^"]*threadline-app/.test(html), '内嵌根不再带 threadline-app')
  assert.ok(html.includes('role="dialog"'))
  assert.ok(html.includes('aria-modal="true"'))
  assert.ok(html.includes('threadline-overlay'), 'Overlay 内容仍在（SSR 内联）')
})

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
