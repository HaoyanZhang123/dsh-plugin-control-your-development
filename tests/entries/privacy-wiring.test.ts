/*
 * tests/entries/privacy-wiring.test.ts —— T09b ①④⑤ 的接线断言（隐私模式 / 首帧打点 / 引用层 UI）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createTranslator } from '../../src/client/locale/index.ts'
import {
  getPrivacyMode,
  resetPrivacyMode,
  setPrivacyMode,
  subscribePrivacyMode,
  togglePrivacyMode,
} from '../../src/client/state/privacyStore.ts'
import { markFirstUsable, measureFirstUsable, perfEntries, resetPerf, listNeedsVirtualization, listWindow } from '../../src/client/state/perf.ts'
import { disabledReferenceLayer } from '../../src/client/state/referenceLayer.ts'
import { ThreadlineTabView, referenceDisabledText } from '../../src/client/entries/tab.ts'
import { buildModalModel, modalTitle } from '../../src/client/ui/modal/model.ts'
import { maskPathFor } from '../../src/client/privacy/index.ts'
import { buildFileRows } from '../../src/client/a11y/index.ts'
import type { FileNode } from '../../src/shared/events/index.ts'
import { BASE_TIME, SESSION_ID, buildDetail, buildSessionRows, buildWorkspaceItems } from './fixtures.ts'

const t = createTranslator('zh')

/* ---------------- ① 隐私 ---------------- */

test('隐私 store：默认 metadata；toggle/set 幂等；订阅只收到变化；reset 回默认（不持久化）', () => {
  resetPrivacyMode()
  assert.equal(getPrivacyMode(), 'metadata')
  const seen: string[] = []
  const unsubscribe = subscribePrivacyMode(() => seen.push(getPrivacyMode()))
  togglePrivacyMode()
  assert.equal(getPrivacyMode(), 'hidden')
  togglePrivacyMode()
  assert.equal(getPrivacyMode(), 'metadata')
  setPrivacyMode('metadata')
  assert.deepEqual(seen, ['hidden', 'metadata'], '同值不广播')
  unsubscribe()
  togglePrivacyMode()
  assert.equal(seen.length, 2, '取消订阅后不再收到')
  resetPrivacyMode()
  assert.equal(getPrivacyMode(), 'metadata')
})

test('弹窗隐私：标题掩码「会话 n」、起点/终点正文入口消失（显示「内容已隐藏」）', () => {
  const detail = buildDetail()
  const files = new Map<string, FileNode>()
  const hidden = buildModalModel({ detail, files, mode: 'hidden', t, now: detail.startedAt + 60_000 })
  assert.equal(hidden.startText, null, '隐私模式下正文不进入模型')
  assert.equal(hidden.endText, null)
  assert.equal(modalTitle({ title: detail.title, sessionId: detail.id, mode: 'hidden', index: 0, t }), '会话 1')
  assert.equal(modalTitle({ title: detail.title, sessionId: detail.id, mode: 'metadata', index: 0, t }), detail.title)
})

test('隐私模式：列表行路径只留 basename（走 T10 maskPathFor，不是自己写 basename）', () => {
  const nodes: FileNode[] = [
    {
      path: 'src/client/data/merge.ts',
      name: 'merge.ts',
      dir: 'src/client/data',
      family: 'code',
      firstAt: BASE_TIME,
      lastAt: BASE_TIME,
      reads: 1,
      writes: 0,
      searches: 0,
      added: 0,
      removed: 0,
      ops: 1,
      sessionIds: [SESSION_ID],
      sessionCount: 1,
      turnCount: 1,
    },
  ]
  const visible = buildFileRows(nodes, 'metadata')
  const masked = buildFileRows(nodes, 'hidden')
  assert.equal(visible[0].displayPath, 'src/client/data/merge.ts')
  assert.equal(masked[0].displayPath, 'merge.ts')
  assert.equal(masked[0].displayPath, maskPathFor(nodes[0].path, 'hidden'))
})

/* ---------------- ④ 性能 ---------------- */

test('首帧打点：mark first-usable 记一次；measure 可读；reset 清空', () => {
  resetPerf()
  const at = markFirstUsable()
  assert.ok(Number.isFinite(at))
  const ms = measureFirstUsable()
  assert.ok(ms !== null && ms >= 0, 'measure 应能读到 first-usable')
  assert.ok(perfEntries().some((entry) => entry.name === 'first-usable'))
  resetPerf()
  assert.equal(measureFirstUsable(), null)
})

test('列表虚拟化：≤200 行全量渲染；>200 行只渲染可见窗口（偏移/总数可对账）', () => {
  assert.equal(listNeedsVirtualization(200), false)
  assert.equal(listNeedsVirtualization(201), true)
  const full = listWindow(120, 0, 400)
  assert.deepEqual({ start: full.start, end: full.end, total: full.total }, { start: 0, end: 120, total: 120 })
  const win = listWindow(500, 400, 260)
  assert.equal(win.total, 500)
  assert.ok(win.visible < 500, '大列表只渲染窗口内行')
  assert.ok(win.end > win.start)
  assert.ok(win.end <= 500)
  assert.ok(win.offset >= 0)
})

/* ---------------- ⑤ 引用层 UI ---------------- */

test('引用层禁用时的文案：只由既有 locale key 组成（引用 · 观测不到）', () => {
  assert.equal(referenceDisabledText(t), '引用（解析所得） · 观测不到')
})

/* ---------------- tab SSR：工具条 / 禁用横幅 / 单一 live 源的数据前提 ---------------- */

function renderTab(overrides: Record<string, unknown> = {}): string {
  const useSessions = (selector: (snapshot: unknown) => unknown): unknown =>
    selector({ current: SESSION_ID, ids: [SESSION_ID], byId: Object.fromEntries(buildSessionRows().map((row) => [row.id, row])) })
  const useWorkspaces = (selector: (snapshot: unknown) => unknown): unknown => selector({ items: buildWorkspaceItems() })
  return renderToStaticMarkup(
    React.createElement(ThreadlineTabView, {
      locale: 'zh',
      sessionId: SESSION_ID,
      useSessions,
      useWorkspaces,
      now: BASE_TIME,
      referenceLayer: disabledReferenceLayer('no-remote'),
      ...overrides,
    }),
  )
}

test('tab SSR：工具条有「列表视图」「隐私模式」两个开关；引用层 disabled → 显示「引用（解析所得） · 观测不到」', () => {
  resetPrivacyMode()
  const html = renderTab()
  assert.ok(html.includes('data-testid="list-toggle"'))
  assert.ok(html.includes('列表视图'))
  assert.ok(html.includes('data-testid="privacy-toggle"'))
  assert.ok(html.includes('隐私模式'))
  assert.ok(html.includes('data-testid="reference-disabled"'))
  assert.ok(html.includes('引用（解析所得） · 观测不到'))
  assert.ok(html.includes('data-testid="map-host"'))
  assert.ok(!html.includes('data-testid="list-view"'), '默认不挂列表视图')
})

test('tab SSR：隐私开关按下态跟随 store；开启后不出现会话标题原文', () => {
  resetPrivacyMode()
  setPrivacyMode('hidden')
  try {
    const html = renderTab()
    assert.ok(html.includes('aria-pressed="true"'), '隐私开关应为按下态')
    assert.ok(!html.includes('修复读模型指纹'), '隐私模式下会话标题不应原文出现')
  } finally {
    resetPrivacyMode()
  }
})
