/*
 * tests/entries/t13b.test.ts —— 真机缺陷修复的三条新断言（T13b）。
 *
 * ① ErrorBoundary：子组件抛错时**渲染可见错误文案**（不白屏），stack 默认折叠、只留 8 行；
 * ② 命令注册：`get` 缺失但 `inject` 可用时**仍注册成功**（rc.5 服务晚就绪的真实场景）；
 *    T32（2026-11-05）：命令只导航，不再注册 `conversation.input.overlay`（弹窗已删除）；
 * ③ 影响按钮：是 `button`，`aria-label`/`title` 给计数与状态；未加载态**可点**（2026-11-04 真机反馈后改）；
 *    T20（2026-11-05）：点击不再弹窗，外部只有按钮本身（无 aria-haspopup / aria-expanded / dialog）；
 * 另附：tab 诊断条触发条件与 key=value 行、影响入口的内嵌根 className。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createTranslator } from '../../src/client/locale/index.ts'
import { ErrorBoundary, ERROR_STACK_LINES, stackHead } from '../../src/client/ui/shell/index.ts'
import { COMMAND_NAME, COMMAND_TOKENS, registerCommand, type InputTriggerSource } from '../../src/client/entries/command.ts'
import { ImpactAction, IMPACT_ROOT_CLASS } from '../../src/client/entries/impact.ts'
import { buildDiagItems, referenceDisabledText, shouldShowDiag } from '../../src/client/entries/tab.ts'
import { clearFocus, peekFocus } from '../../src/client/state/viewFocus.ts'
import { disabledReferenceLayer } from '../../src/client/state/referenceLayer.ts'
import { resetPrivacyMode } from '../../src/client/state/privacyStore.ts'
import type { ClientScopeLike } from '../../src/client/entries/context.ts'
import { SESSION_ID, buildDetail } from './fixtures.ts'

const t = createTranslator('zh')

/* ---------------- ① ErrorBoundary ---------------- */

function boundaryWithError(error: Error, open = false): string {
  const boundary = new ErrorBoundary({ label: '观测不到 · 脉络', detailLabel: '展开' })
  ;(boundary as unknown as { state: { error: Error | null; open: boolean } }).state = { error, open }
  return renderToStaticMarkup(boundary.render() as React.ReactElement)
}

test('ErrorBoundary：渲染可见错误文案 + role=alert + 默认折叠 stack（不白屏）', () => {
  const error = new Error('boom: tab 渲染失败')
  const html = boundaryWithError(error)
  assert.ok(html.includes('data-threadline-error-boundary'))
  assert.ok(html.includes('role="alert"'))
  assert.ok(html.includes('观测不到 · 脉络：boom: tab 渲染失败'))
  assert.ok(html.includes('aria-expanded="false"'), 'stack 默认折叠')
  assert.ok(!html.includes('<pre'), '未展开时不渲染 stack')
})

test('ErrorBoundary：展开后显示 stack 前 8 行（诊断用，克制）', () => {
  const error = new Error('boom')
  const html = boundaryWithError(error, true)
  assert.ok(html.includes('data-testid="error-boundary-stack"'))
  const match = /<pre[^>]*>([\s\S]*?)<\/pre>/.exec(html)
  assert.ok(match !== null)
  const lineCount = match[1].split(String.fromCharCode(10)).length
  assert.ok(lineCount <= ERROR_STACK_LINES, 'stack 最多 8 行，实际 ' + String(lineCount))
})

test('ErrorBoundary：stackHead 截断到 8 行；非 Error 抛值也能兜住；componentDidCatch 只打一行', () => {
  const error = new Error('x')
  error.stack = Array.from({ length: 20 }, (_, index) => 'frame-' + String(index)).join(String.fromCharCode(10))
  assert.equal(stackHead(error).split(String.fromCharCode(10)).length, ERROR_STACK_LINES)
  assert.equal(ErrorBoundary.getDerivedStateFromError('string-error')?.error?.message, 'string-error')

  const original = console.error
  const calls: unknown[][] = []
  console.error = (...args: unknown[]) => {
    calls.push(args)
  }
  try {
    new ErrorBoundary({ label: 'x' }).componentDidCatch(error)
  } finally {
    console.error = original
  }
  assert.equal(calls.length, 1)
  assert.equal(calls[0][0], 'threadline: render failed')
})

/* ---------------- ② 命令注册：inject 可用、get 缺失 ---------------- */

test('命令注册：get 现在取不到但 inject 可用 → 仍注册成功（不再静默跳过）', () => {
  const sources: InputTriggerSource[] = []
  const inputTriggers = {
    registerSource(source: InputTriggerSource) {
      sources.push(source)
      return () => undefined
    },
  }
  const logs: string[] = []
  const registered: string[] = []
  const scope: ClientScopeLike = {
    // 注意：get 对 inputTriggers 返回 undefined（模拟 apply 时服务尚未就绪）
    get: () => undefined,
    inject(names, callback) {
      if (!names.includes('inputTriggers')) return undefined
      callback({ get: (name: string) => (name === 'inputTriggers' ? inputTriggers : undefined) })
      return undefined
    },
    effect(callback) {
      return callback()
    },
    logger: { warn: (message: string) => logs.push(message) },
    slots: {
      inject: (_name: string, callback: () => unknown) => callback(),
      register: (options: Record<string, unknown>) => {
        registered.push(String(options.name ?? ''))
        return () => undefined
      },
    },
  }
  const ok = registerCommand(scope)
  assert.equal(ok, true, '命令应注册成功（inject 通道）')
  assert.equal(sources.length, 1)
  assert.deepEqual(registered, [], 'T32：命令入口不再注册任何 slot（conversation.input.overlay 已删除）')
  assert.ok(logs.every((line) => !line.includes('尚未就绪')), '成功时不应打"未就绪"警告')
})

test('命令注册：get 与 inject 都拿不到 → 只 warn、不崩', () => {
  const logs: string[] = []
  const scope: ClientScopeLike = {
    get: () => undefined,
    inject: (_names, _callback) => undefined,
    effect: (callback) => callback(),
    logger: { warn: (message: string) => logs.push(message) },
  }
  assert.doesNotThrow(() => registerCommand(scope))
  assert.ok(logs.some((line) => line.includes('尚未就绪')))
})

test('onPick：不是我们的 candidate.name 就交还给宿主（不抢占），是我们的才导航到「脉络」tab', async () => {
  clearFocus()
  const sources: InputTriggerSource[] = []
  const inputTriggers = { registerSource: (source: InputTriggerSource) => (sources.push(source), () => undefined) }
  const scope = {
    get: (name: string) => (name === 'inputTriggers' ? inputTriggers : undefined),
    effect: (callback: () => unknown) => callback(),
    logger: { warn: () => undefined },
  } as unknown as ClientScopeLike
  registerCommand(scope)
  const source = sources[0]
  assert.ok(source !== undefined)
  assert.deepEqual(COMMAND_TOKENS, ['/threadline', '/脉络'])
  assert.equal(source.onPick({ session: { sessionId: SESSION_ID }, candidate: { name: 'context' } }), undefined)
  assert.equal(peekFocus(SESSION_ID), null, '非本命令不登记 focus（不抢占别人的 pick）')
  assert.equal(source.onPick({ session: { sessionId: SESSION_ID }, candidate: { name: COMMAND_NAME } }), 'handled')
  assert.deepEqual(peekFocus(SESSION_ID), { kind: 'session', sessionId: SESSION_ID }, '本命令落点为会话级 focus（T32：不再开弹窗）')
  clearFocus()
})

/* ---------------- ③ 影响图标按钮 ---------------- */

function renderImpact(props: Record<string, unknown>): string {
  return renderToStaticMarkup(React.createElement(ImpactAction, { locale: 'zh', messageId: 'm-1b', sessionId: SESSION_ID, ...props }))
}

test('影响按钮：是 button + 内联 SVG；aria-label/title 给计数；T20 不再有 popover 语义', () => {
  const readyEntry = { sessionId: SESSION_ID, status: 'ready', detail: buildDetail(), partial: false, updatedAt: 0, fetchedAt: 0, stale: false, generation: 0 }
  const store = {
    peek: () => readyEntry,
    request: () => Promise.resolve(readyEntry),
    refresh: () => Promise.resolve(readyEntry),
    subscribe: () => () => undefined,
    dispose: () => undefined,
  } as never
  const html = renderImpact({ store })
  assert.ok(/<button[^>]*class="threadline-impact-icon-btn"/.test(html))
  assert.ok(html.includes('<svg'))
  assert.ok(html.includes('threadline-impact-root'))
  assert.ok(!html.includes('aria-haspopup'), 'T20：不许再声明弹层（点击是导航）')
  assert.ok(!html.includes('aria-expanded'), 'T20：不再有展开态')
  assert.ok(!html.includes('role="dialog"'), 'T20：图标点击不再开窗')
  assert.ok(!html.includes('threadline-impact-popover'), 'T20：popover 整条路径已删除')
  assert.ok(/aria-label="[^"]*3[^"]*1[^"]*1[^"]*"/.test(html), 'aria-label 给文件/命令/子智能体计数')
  assert.ok(!html.includes('aria-disabled="true"'), '有数据时不是禁用态')
})

test('影响按钮：未加载态仍是可见 button，且可点（不再 aria-disabled）', () => {
  const store = { peek: () => null, request: () => Promise.resolve(null), subscribe: () => () => undefined } as never
  const html = renderImpact({ store })
  assert.ok(html.includes('threadline-impact-icon-btn'))
  assert.ok(!html.includes('aria-disabled="true"'), '未加载态必须可点（真机反馈：点不动）')
  assert.ok(!html.includes('aria-haspopup'), '加载态也不弹窗（点击直接去 tab 看加载态）')
  assert.ok(html.includes('正在读取本轮记录'))
})

/* ---------------- 根 className 与诊断条 ---------------- */

test('影响入口的内嵌根：只带 threadline-impact-root（不再带 threadline-app，令牌来自 tokens.css 的共享根组）', () => {
  assert.equal(IMPACT_ROOT_CLASS, 'threadline-impact-root')
  assert.equal(IMPACT_ROOT_CLASS.includes('threadline-app'), false)
  // T32：弹窗（threadline-modal-root）已删除，这里不再渲染/断言它。
})

test('诊断条：只在 failed / degrade 非 none 时出现，一行一个 key=value（不含正文）', () => {
  assert.equal(shouldShowDiag({ status: 'partial', degradeKind: 'none' }), false)
  assert.equal(shouldShowDiag({ status: 'failed', degradeKind: 'none' }), true)
  assert.equal(shouldShowDiag({ status: 'partial', degradeKind: 'hostUnavailable' }), true)
  const items = buildDiagItems({
    status: 'failed',
    degradeKind: 'hostUnavailable',
    code: 'threadline/capability-missing',
    scannable: false,
    sessions: 0,
    files: 0,
    references: 'disabled',
  })
  assert.deepEqual(items.map(([key]) => key), ['status', 'degrade', 'code', 'scannable', 'sessions', 'files', 'refs'])
  for (const [, value] of items) {
    assert.ok(!value.includes('E:'), '诊断值不含绝对路径：' + value)
    assert.ok(!value.includes('src/'), '诊断值不含文件路径：' + value)
  }
  assert.equal(referenceDisabledText(t), '引用（解析所得） · 观测不到')
  assert.equal(disabledReferenceLayer().status, 'disabled')
  resetPrivacyMode()
})
