/*
 * shell.test.ts —— 外壳与通用组件的结构断言（03 §3 / §15；06 A40-2 的静态一半）。
 *
 * 渲染用 react-dom/server 的静态标记：不引 jsdom，也不依赖浏览器；
 * "某个宽度下检查器变成覆盖层/sheet、真的没有横向滚动"由 tests/harness 的页面断言负责。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PLUGIN_ROOT } from '../harness/styles-codegen.ts'
import { stringLiterals, stripComments } from './source-utils.ts'
import {
  Button,
  Chip,
  EmptyState,
  ErrorState,
  Legend,
  LoadingState,
  ProgressPill,
  Tooltip,
} from '../../src/client/ui/common/index.ts'
import { InspectorPanel, NowStrip, ThreadlineShell, TurnStripSlot, TimelineSlot } from '../../src/client/ui/shell/index.ts'
import { createTranslator } from '../../src/client/locale/index.ts'
import { t } from '../../src/client/locale/index.ts'

const h = React.createElement

function renderShell(overrides: Record<string, unknown> = {}): string {
  return renderToStaticMarkup(
    h(ThreadlineShell, {
      workspaceName: 'skill开发',
      onRangeChange: () => undefined,
      ...overrides,
    }),
  )
}

test('外壳根节点：只有 .threadline-app，带 locale 标记', () => {
  const html = renderShell()
  assert.match(html, /^<div class="threadline-app" data-threadline-app="" data-locale="zh"/)
  assert.match(html, /class="threadline-shell"/)
})

test('区域齐全且顺序正确：header → layout（左列 graph/timeline/turns + 右列 rail）', () => {
  const html = renderShell()
  const order = [
    'data-region="header"',
    'class="threadline-layout"',
    'data-region="map"',
    'data-region="timeline"',
    'data-region="turns"',
    'data-region="rail"',
  ]
  let cursor = -1
  for (const needle of order) {
    const index = html.indexOf(needle)
    assert.ok(index > cursor, needle + ' 不存在或顺序不对')
    cursor = index
  }
  assert.equal(html.includes('data-region="now"'), false, '没有 running 会话时不渲染 Now strip')
  // 33 §2：左列（图/时间轴/轮次带）在右列（卡片）之前；右列是 aside。
  assert.match(html, /<aside class="threadline-rail" data-region="rail"/)
})

test('33 §2：没有检查器、没有遮罩；主区就是左列 + 右列', () => {
  const html = renderShell({
    graphSlot: h('div', { 'data-fixture': 'graph' }, 'g'),
    railSlot: h('div', { 'data-fixture': 'rail' }, 'r'),
  })
  assert.equal(html.includes('data-region="inspector"'), false)
  assert.equal(html.includes('threadline-inspector'), false)
  assert.equal(html.includes('threadline-inspector-mask'), false)
  assert.match(html, /class="threadline-left" data-region="map"/)
  assert.match(html, /data-fixture="graph"/)
  assert.match(html, /data-fixture="rail"/)
})

test('Now strip 仅在传了 nowStrip 时出现，并带 running 标记', () => {
  const withNow = renderShell({ nowStrip: { text: 'x · 执行中', running: true, detail: '本轮仍在记录' } })
  assert.match(withNow, /data-region="now" data-running="true"/)
  assert.match(withNow, /本轮仍在记录/)
})

test('范围 chip：四个都在，且恰好一个 aria-pressed=true（默认全部）', () => {
  const html = renderShell()
  const pressed = html.match(/aria-pressed="true"/g) ?? []
  assert.equal(pressed.length, 1)
  for (const label of ['今天', '7 天', '30 天', '全部']) assert.ok(html.includes('>' + label + '<'), '缺范围 chip：' + label)
  assert.match(html, /data-testid="range-range\.all"[^>]*aria-pressed="true"/)
})

test('时间轴 / 轮次带槽高度与折叠状态由 data 属性暴露', () => {
  const collapsed = renderShell({ turnStripCollapsed: true, onTurnStripToggle: () => undefined })
  assert.match(collapsed, /data-region="turns" data-collapsed="true"/)
  assert.match(collapsed, /aria-expanded="false"/)
  assert.match(collapsed, /aria-label="展开"/)
  const expanded = renderShell({ onTurnStripToggle: () => undefined })
  assert.match(expanded, /data-region="turns" data-collapsed="false"/)
  assert.match(expanded, /aria-label="收起"/)
})

test('关系证据渲染在时间线槽内（D-35：不再是图内浮层）', () => {
  const withoutEvidence = renderShell()
  assert.match(withoutEvidence, /data-region="timeline" data-testid="timeline" data-has-evidence="false"/, '无证据时标 false')

  const withEvidence = renderToStaticMarkup(
    React.createElement(ThreadlineShell, {
      workspaceName: 'ws',
      timelineSlot: React.createElement('div', { 'data-testid': 'timeline-body' }, 'timeline'),
      timelineEvidenceSlot: React.createElement('div', { 'data-testid': 'evidence-slot' }, 'evidence'),
    }),
  )
  // 证据必须是 timeline 的子节点（覆盖同一块区域），而不是挂在图上。
  const timelineIndex = withEvidence.indexOf('data-region="timeline"')
  const evidenceIndex = withEvidence.indexOf('data-testid="evidence-slot"')
  assert.ok(timelineIndex >= 0 && evidenceIndex > timelineIndex, '证据槽必须出现在 timeline 之后（作为覆盖层）')
  assert.match(withEvidence, /data-has-evidence="true"/)
  assert.equal(withEvidence.includes('data-graph-stage'), false, '空 shell 不应出现图舞台')
})

test('切到 en：范围 chip 跟着 locale 走；header 不再单列产品名/工作区（D-35 需求 11）', () => {
  const html = renderShell({ locale: 'en' })
  assert.match(html, />Today</)
  assert.match(html, />7 days</)
  assert.match(html, /data-locale="en"/)
  /* 用户明确要求删掉 tab 下方那行「脉络 + 工作区名」：视觉上不得再出现品牌行。 */
  assert.equal(html.includes('threadline-brand'), false, 'header 不得再渲染品牌行')
  assert.equal(html.includes('threadline-workspace'), false, '工作区名不得再单独占一行')
  assert.match(html, /data-header-brand="none"/, '要显式标记品牌行已删除（便于验收断言）')
  /* 但读屏仍要知道当前工作区：用 aria-label 承载，信息不丢（夹具默认工作区名是「开发」）。 */
  assert.match(html, /aria-label="[^"]*开发[^"]*"/, 'aria-label 里必须仍带工作区名')
})

test('header 只有范围 chip / 覆盖率 / 右侧动作，没有多余的一行', () => {
  const html = renderShell({})
  const headerMatch = /<header[^>]*>([\s\S]*?)<\/header>/.exec(html)
  assert.ok(headerMatch !== null, '必须有 header')
  const inner = headerMatch[1]
  /* 只剩两个子结构：范围组 + 右侧动作组。 */
  const childDivs = inner.match(/class="threadline-(range|header-end|header-start)"/g) ?? []
  assert.equal(childDivs.some((item) => item.includes('header-start')), false, 'header-start（品牌行容器）已删除')
  assert.ok(childDivs.some((item) => item.includes('threadline-range')), '范围 chip 必须保留')
})

test('所有可点元素都是 button（没有 div 假装按钮）', () => {
  const html = renderShell({ onTurnStripToggle: () => undefined })
  // 允许 role="button" 的写法，但本项目一律用 button
  assert.equal(/<div[^>]*onclick/i.test(html), false)
})

test('Button：icon-only 必须有 aria-label，否则抛错（运行期兜底）', () => {
  const ok = renderToStaticMarkup(
    h(Button, { iconOnly: true, ariaLabel: '关闭', children: h('span', null, '×') }),
  )
  assert.match(ok, /aria-label="关闭"/)
  assert.match(ok, /type="button"/)
  assert.throws(() => renderToStaticMarkup(h(Button, { iconOnly: true } as never)), /ariaLabel/)
})

test('Button：pressed / expanded 分别映射 aria-pressed / aria-expanded', () => {
  assert.match(renderToStaticMarkup(h(Button, { label: 'x', pressed: true })), /aria-pressed="true"/)
  assert.match(renderToStaticMarkup(h(Button, { label: 'x', expanded: false })), /aria-expanded="false"/)
  assert.match(renderToStaticMarkup(h(Button, { label: 'x', disabled: true })), /disabled=""/)
})

test('Chip：有 onClick 才是 button + aria-pressed；计数不进读屏的重复文本', () => {
  const staticChip = renderToStaticMarkup(h(Chip, { label: '结构', count: 3 }))
  assert.equal(staticChip.startsWith('<span'), true)
  assert.match(staticChip, /threadline-chip-count" aria-hidden="true">3</)
  const interactive = renderToStaticMarkup(h(Chip, { label: '结构', active: true, onClick: () => undefined }))
  assert.match(interactive, /^<button/)
  assert.match(interactive, /aria-pressed="true"/)
})

test('Tooltip：气泡常驻 DOM、role=tooltip、触发者 aria-describedby 指向它', () => {
  const html = renderToStaticMarkup(
    h(Tooltip, { content: '本轮 2 文件' }, h(Button, { label: '影响 2' })),
  )
  const describedBy = /aria-describedby="([^"]+)"/.exec(html)
  assert.ok(describedBy, '缺 aria-describedby')
  const id = describedBy[1]
  assert.match(html, new RegExp('id="' + id + '" class="threadline-tip" role="tooltip"'))
  assert.equal(new RegExp('id="' + id + '"').test(html), true, 'id 必须唯一存在（读屏才拿得到）')
  assert.match(html, /本轮 2 文件/)
})

test('空态 / 加载态 / 错误态：文案分开、状态可读', () => {
  const empty = renderToStaticMarkup(h(EmptyState, { title: t('state.emptyFiles') }))
  assert.match(empty, /data-threadline-empty/)
  assert.match(empty, /有对话记录，但没有文件操作/)

  const loading = renderToStaticMarkup(h(LoadingState, { label: t('state.loadingDetail'), lines: 2 }))
  assert.match(loading, /role="status"/)
  assert.match(loading, /aria-busy="true"/)
  assert.match(loading, /正在读取本轮记录…/)

  let retried = 0
  const failed = renderToStaticMarkup(
    h(ErrorState, { title: t('state.hostUnavailable'), detail: 'read failed', retryLabel: t('coverage.retry'), onRetry: () => { retried += 1 } }),
  )
  assert.match(failed, /role="alert"/)
  assert.match(failed, /观测不到工作区记录/)
  assert.match(failed, /重新读取/, '只读重读按钮必须在')
  assert.equal(/开始|停止|同步|保存/.test(failed), false, '错误态不得出现运行控制词')
  assert.equal(retried, 0)
})

test('ProgressPill：loading/partial 是 progressbar，failed 是 status + 重新读取', () => {
  const loading = renderToStaticMarkup(
    h(ProgressPill, { state: 'loading', done: 42, total: 267, text: t('coverage.loading', { done: 42, total: 267 }) }),
  )
  assert.match(loading, /role="progressbar"/)
  assert.match(loading, /aria-valuenow="42"/)
  assert.match(loading, /aria-valuemax="267"/)
  assert.match(loading, /正在补全历史 42\/267/)

  const failed = renderToStaticMarkup(
    h(ProgressPill, {
      state: 'failed',
      done: 264,
      total: 267,
      failed: 3,
      text: t('coverage.failed', { n: 3 }),
      retryLabel: t('coverage.retry'),
      onRetry: () => undefined,
    }),
  )
  assert.match(failed, /data-state="failed"/)
  assert.match(failed, /role="status"/)
  assert.match(failed, /3 个会话读取失败/)
  assert.match(failed, /重新读取/)
})

test('Legend：默认折叠状态可读，宽容器由 CSS 展开（组件不写死宽度）', () => {
  const html = renderToStaticMarkup(
    h(Legend, { title: '图例', items: [{ kind: 'text', label: '文本' }, { kind: 'code', label: '代码' }] }),
  )
  assert.match(html, /data-open="false"/)
  assert.match(html, /aria-expanded="false"/)
  assert.match(html, /data-kind="text"/)
  assert.match(html, /role="group" aria-label="图例"/)
})

test('Overlay 已删除：T31 起没有弹窗表面（单一执行路径，无 dialog）', () => {
  const html = renderShell({ graphSlot: h('div', { 'data-fixture': 'graph' }), railSlot: h('div', { 'data-fixture': 'rail' }) })
  assert.equal(html.includes('role="dialog"'), false)
  assert.equal(html.includes('aria-modal'), false)
})

test('子槽组件单独可用（T07/T08 直接复用）', () => {
  const now = renderToStaticMarkup(h(NowStrip, { text: 'a' }))
  assert.match(now, /data-running="false"/)
  const timeline = renderToStaticMarkup(h(TimelineSlot, null, h('span', null, 'x')))
  assert.match(timeline, /data-region="timeline"/)
  const turns = renderToStaticMarkup(h(TurnStripSlot, { title: '轮次', collapsed: false }, h('span', null, 'T1')))
  assert.match(turns, /data-region="turns"/)
  assert.match(turns, /class="threadline-turns-list"/)
  const inspector = renderToStaticMarkup(h(InspectorPanel, { title: '文件', closeLabel: '关闭' }, h('p', null, 'x')))
  assert.match(inspector, /<aside class="threadline-inspector"/)
})

test('shell 不生产文案：源码里没有中文字面量（可见文字一律经 locale / props）', () => {
  const dirs = ['shell', 'common'].map((name) => join(PLUGIN_ROOT, 'src', 'client', 'ui', name))
  const offenders: string[] = []
  for (const dir of dirs) {
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.ts')) continue
      const code = stripComments(readFileSync(join(dir, file), 'utf8'))
      const literals = stringLiterals(code)
      for (const literal of literals) {
        // 运行期错误信息（threadline: 前缀）不是 UI 文案，允许中文；其余必须是 props/locale。
        if (literal.startsWith('threadline:')) continue
        if (/[\u4e00-\u9fff]/.test(literal)) offenders.push(file + ': ' + literal)
      }
    }
  }
  assert.deepEqual(offenders, [], '外壳/通用组件里出现中文字面量：' + offenders.join(' | '))
})
