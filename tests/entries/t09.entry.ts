/*
 * tests/entries/t09.entry.ts —— T09 的截图夹具（合成数据 + 假 fetch，可复现）。
 *
 * 这不是产品代码：它 import **真实**的三个入口组件，喂 fixtures 的确定性数据，
 * 用假 fetch 顶替同源 `/api/dsh-threadline/*`（截图不依赖 DSH 真机）。
 *
 * URL 参数：
 *   ?view=tab                 「脉络」tab（外壳 + 星图 + 时间轴 + 轮次带 + 检查器）
 *   ?view=modal               /threadline 弹窗（打开态）
 *   ?view=impact              「影响 5」按钮（打开态由 harness 点击触发）
 *   &theme=dark               深色
 *
 * 探针：`window.__t09` 暴露只读状态（注册计数 / 焦点是否在 dialog 内 / 是否有投递），不打印任何正文。
 */
import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { createTranslator } from '../../src/client/locale/index.ts'
import { installStyles } from '../../src/client/styles/index.ts'
import { ThreadlineTabView } from '../../src/client/entries/tab.ts'
import { disabledReferenceLayer } from '../../src/client/state/referenceLayer.ts'
import { ImpactAction } from '../../src/client/entries/impact.ts'
import { ThreadlineModal } from '../../src/client/ui/modal/ThreadlineModal.ts'
import { fileNodesOfDetail } from '../../src/client/ui/modal/model.ts'
import type { DetailStore } from '../../src/client/data/index.ts'
import type { FileNode } from '../../src/shared/events/index.ts'
import { BASE_TIME, SESSION_ID, buildDetail, buildSummaries } from './fixtures.ts'

const h = React.createElement
const params = new URLSearchParams(location.search)
const view = params.get('view') ?? 'tab'
const t = createTranslator('zh')
const detail = buildDetail()
const nodes: FileNode[] = fileNodesOfDetail(detail)
const files = new Map<string, FileNode>(nodes.map((node) => [node.path.toLowerCase(), node]))
const summary = buildSummaries()[0]

/** 宿主快照（模块级常量 = 身份稳定，避免每次 render 触发 memo 重算循环）。 */
const SESSIONS_SNAPSHOT = {
  current: SESSION_ID,
  ids: [SESSION_ID],
  byId: {
    [SESSION_ID]: {
      id: SESSION_ID,
      title: '修复读模型指纹',
      cwd: 'E:/DSH/workspaces/myself/skill开发',
      updatedAt: BASE_TIME + 9 * 60_000,
      running: true,
    },
  },
}
const WORKSPACES_SNAPSHOT = { items: [{ id: 'ws-1', title: 'skill开发', sessionIds: [SESSION_ID] }] }
const useSessions = (selector: (snapshot: unknown) => unknown): unknown => selector(SESSIONS_SNAPSHOT)
const useWorkspaces = (selector: (snapshot: unknown) => unknown): unknown => selector(WORKSPACES_SNAPSHOT)

/** 假同源 fetch：三条只读路由的确定性响应（不发真实请求）。 */
function response(value: unknown): { ok: boolean; status: number; json(): Promise<unknown> } {
  return { ok: true, status: 200, json: () => Promise.resolve(value) }
}

const fetchImpl = (input: string, init?: { body?: string }): Promise<{ ok: boolean; status: number; json(): Promise<unknown> }> => {
  const url = String(input)
  void init
  if (url.endsWith('/scan')) {
    return Promise.resolve(response({ ok: true, scanId: 'scan-t09', rev: 0, total: 1, order: [SESSION_ID] }))
  }
  if (url.endsWith('/snapshot')) {
    return Promise.resolve(
      response({
        ok: true,
        scanId: 'scan-t09',
        rev: 1,
        reset: true,
        done: true,
        progress: { total: 1, scanned: 1, failed: 0, cached: 0, phase: 'complete' },
        changedSessions: [summary],
        changedFiles: nodes,
        changedEdges: [],
        removedFiles: [],
        removedEdges: [],
        errors: [],
      }),
    )
  }
  if (url.endsWith('/detail')) {
    return Promise.resolve(response({ ok: true, session: detail }))
  }
  return Promise.reject(new Error('unexpected route: ' + url))
}

/** 假 detail store（impact 入口用；peek 直接给 ready，SSR/首帧就能出「影响 N」）。 */
const readyEntry = {
  sessionId: SESSION_ID,
  status: 'ready' as const,
  detail,
  partial: false,
  updatedAt: 0,
  fetchedAt: 0,
  stale: false,
  generation: 0,
}
const fakeStore = {
  peek: () => readyEntry,
  request: () => Promise.resolve(readyEntry),
  refresh: () => Promise.resolve(readyEntry),
  subscribe: () => () => undefined,
  dispose: () => undefined,
  invalidate: () => undefined,
  clear: () => undefined,
  setGeneration: () => undefined,
  generation: 0,
  size: 1,
  inflight: 0,
} as unknown as DetailStore

interface Probe {
  dialogOpen: boolean
  focusInDialog: boolean
  dispatched: number
}
const probe: Probe = { dialogOpen: false, focusInDialog: false, dispatched: 0 }
;(window as unknown as { __t09: Probe }).__t09 = probe

/** 弹窗夹具（自身持有 open 状态，Esc / 关闭按钮真的能关掉）。 */
function ModalFixture(props: { now: number }): React.ReactElement {
  const [open, setOpen] = React.useState(true)
  return h(ThreadlineModal, {
    open,
    sessionId: SESSION_ID,
    detail,
    detailLoading: false,
    detailError: false,
    files,
    edges: [],
    mode: 'metadata',
    now: props.now,
    t,
    onClose: () => setOpen(false),
    onOpenFull: () => {
      probe.dispatched += 1
    },
    testId: 'threadline-modal',
  })
}

function App(): React.ReactElement {
  const now = BASE_TIME + 10 * 60_000
  if (view === 'modal') {
    return h('div', { className: 'threadline-app', style: { blockSize: '100%' } }, h(ModalFixture, { now }))
  }
  if (view === 'impact') {
    return h(
      'div',
      {
        className: 'threadline-app',
        style: { blockSize: '100%', padding: '24px', display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end' },
      },
      h(ImpactAction, {
        messageId: 'm-1b',
        sessionId: SESSION_ID,
        store: fakeStore,
        locale: 'zh',
        testId: 'impact',
      }),
    )
  }
  return h(
    'div',
    // 宿主给 conversation.view 的是一块有确定高度的区域（dsh-context 的 .lc-ov-page 也是 height:100%）。
    // 夹具必须模拟这一点：blockSize:auto 会让被测外壳失去高度约束，量不到「内部滚动」这个行为。
    { className: 'threadline-app', style: { blockSize: '100%' } },
    h(ThreadlineTabView, {
      sessionId: SESSION_ID,
      useSessions: useSessions as never,
      useWorkspaces: useWorkspaces as never,
      fetch: fetchImpl as never,
      now,
      locale: 'zh',
      // 截图走"引用层不可观测"分支：真机多数情况下拿不到 remote.workspaceFiles（T13 复核）
      referenceLayer: disabledReferenceLayer('no-remote'),
      testId: 'threadline-tab',
    }),
  )
}

if (params.get('theme') === 'dark') document.body.setAttribute('data-ds-dark-theme', '')
installStyles(document)
const container = document.getElementById('root')
if (!container) throw new Error('harness entry: 缺少 #root')
createRoot(container).render(h(App, null))

// D-28：tab 走页面流，滚动交给宿主的滚动容器。harness 的 PAGE_RESET 默认 html/body overflow:hidden，
// 这里只在本 fixture 里放开（产品代码不碰 body，也不改宿主样式）。
// 2026-11-05（D-29）：tab 不再让整页滚动，改成「占满给定高度 + 外壳内部滚动」；
// 因此这里不再把 #root/body 改成 auto —— 与宿主一致地给它一个确定高度。
if (view === 'tab') {
  document.documentElement.style.overflow = 'hidden'
  document.body.style.overflow = 'hidden'
  container.style.blockSize = '100%'
}

// 探针：dialog 是否打开、焦点是否在 dialog 内（Esc/焦点陷阱证据由 harness 额外断言）
setInterval(() => {
  const dialog = document.querySelector('[role="dialog"]')
  probe.dialogOpen = dialog !== null
  probe.focusInDialog = dialog !== null && dialog.contains(document.activeElement)
}, 80)

/**
 * 就绪判定：等数据层把首帧扫描/详情落定（覆盖率文案稳定 + 星图有节点），再打 ready。
 * 只等两帧会截到"正在补全历史 x/y"的中间态，同一状态两次截图不一致（可复现性纪律）。
 */
function whenStable(): void {
  const deadline = Date.now() + 3500
  const tick = (): void => {
    const pill = document.querySelector('[data-testid="coverage-pill"]')
    const nodes = document.querySelectorAll('[data-node-path]').length
    const text = pill === null ? '' : (pill.textContent ?? '')
    const settled = text.includes('全部记录') || text.includes('读取失败') || text.length === 0
    if ((settled && (nodes > 0 || document.querySelector('[role="dialog"]') !== null)) || Date.now() > deadline) {
      document.documentElement.setAttribute('data-harness-ready', '1')
      return
    }
    window.setTimeout(tick, 40)
  }
  tick()
}

requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    if (view === 'tab') whenStable()
    else document.documentElement.setAttribute('data-harness-ready', '1')
  })
})
