/*
 * tests/entries/t09.entry.ts —— T09 的截图夹具（合成数据 + 假 fetch，可复现）。
 *
 * 这不是产品代码：它 import **真实**的入口组件，喂 fixtures 的确定性数据，
 * 用假 fetch 顶替同源 `/api/dsh-threadline/*`（截图不依赖 DSH 真机）。
 *
 * URL 参数：
 *   ?view=tab                 「脉络」tab（外壳 + 关系图 + 时间轴 + 轮次带 + 目录卡片）
 *   ?view=impact              「影响 5」按钮 + 假宿主 tab bar（点击图标 → 切到「脉络」tab，**不弹窗口**）
 *   &theme=dark               深色
 *
 * T32（2026-11-05 notes/33 §1/§7）：`/threadline` 弹窗已删除，本夹具不再有 `?view=modal` 分支，
 * 也不再 import `ui/modal/**`。文件节点由本文件内的**测试专用**推导函数生成（原来的
 * `fileNodesOfDetail` 随 ui/modal 删除；生产侧不再需要它）。
 *
 * 探针：`window.__t09` 暴露只读状态（假 tab 被点了几次），不打印任何正文。
 */
import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { installStyles } from '../../src/client/styles/index.ts'
import { ThreadlineTabView } from '../../src/client/entries/tab.ts'
import { disabledReferenceLayer } from '../../src/client/state/referenceLayer.ts'
import { ImpactAction } from '../../src/client/entries/impact.ts'
import type { DetailStore } from '../../src/client/data/index.ts'
import { fileNodeFromTouches } from '../../src/shared/events/index.ts'
import type { FileNode, FileTouch } from '../../src/shared/events/index.ts'
import { BASE_TIME, SESSION_ID, buildDetail, buildSummaries } from './fixtures.ts'

const h = React.createElement
const params = new URLSearchParams(location.search)
const view = params.get('view') ?? 'tab'
const slowDetail = params.get('detail') === 'slow'
const focus = params.get('focus')
const detail = buildDetail()
const summary = buildSummaries()[0]

/**
 * 测试专用：从单会话详情推导文件节点（快照夹具的 changedFiles）。
 * 口径与生产一致：`fileNodeFromTouches` 是 events 里的唯一实现（不另写族/路径判定）；
 * 原实现住在已删除的 `ui/modal/model.ts`，T32 随弹窗删除后搬进本测试夹具。
 */
function fileNodesOfDetailForFixture(detailValue: typeof detail): FileNode[] {
  const touches: FileTouch[] = []
  let seq = 0
  for (const turn of detailValue.turns) {
    for (const file of turn.files) {
      seq += 1
      const ops = file.ops
      touches.push({
        sessionId: detailValue.id,
        turn: turn.n,
        path: file.path,
        key: file.path.toLowerCase(),
        ops: ops.slice(),
        reads: ops.includes('read') ? 1 : 0,
        writes: ops.includes('write') ? 1 : 0,
        searches: ops.includes('search') ? 1 : 0,
        added: file.added,
        removed: file.removed,
        firstAt: turn.start,
        lastAt: turn.end ?? turn.start,
        seq,
      })
    }
  }
  const byPath = new Map<string, FileTouch[]>()
  for (const touch of touches) {
    const list = byPath.get(touch.key)
    if (list === undefined) byPath.set(touch.key, [touch])
    else list.push(touch)
  }
  const nodes: FileNode[] = []
  for (const list of byPath.values()) {
    const first = list[0]
    if (first === undefined) continue
    nodes.push(fileNodeFromTouches(first.path, list, [detailValue.id], 1, new Set(list.map((item) => item.turn)).size))
  }
  nodes.sort((a, b) => b.ops - a.ops || a.path.localeCompare(b.path))
  return nodes
}

const nodes: FileNode[] = fileNodesOfDetailForFixture(detail)

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

/**
 * 目录树夹具（1.2.0 / R02 的 `/tree` 只读路由）。
 *
 * 右栏是工作区根目录浏览器：根层要有**目录 + 文件 + 未触碰文件**，
 * 且必须有一个子目录可进入（t09 的「进入目录」场景要点击它）。
 * entries 形状与 host/remote 一致：`{ name, type: 'file'|'directory'|'other', size? }`。
 */
const TREE_ROOT = {
  path: '',
  truncated: false,
  entries: [
    { name: 'docs', type: 'directory' as const },
    { name: 'src', type: 'directory' as const },
    { name: 'output', type: 'other' as const },
    { name: 'README.md', type: 'file' as const, size: 2048 },
    { name: 'untouched.txt', type: 'file' as const, size: 12 },
  ],
}

/** 子目录的 listing（点进去之后）：文件 + 孙目录，证明「任意深度」。 */
const TREE_CHILD: Record<string, { path: string; truncated: boolean; entries: Array<{ name: string; type: 'file' | 'directory' | 'other'; size?: number }> }> = {
  docs: {
    path: 'docs',
    truncated: false,
    entries: [
      { name: 'notes.md', type: 'file' as const, size: 512 },
      { name: 'spec.md', type: 'file' as const, size: 1024 },
    ],
  },
  src: {
    path: 'src',
    truncated: false,
    entries: [
      { name: 'lib', type: 'directory' as const },
      { name: 'app.ts', type: 'file' as const, size: 3072 },
    ],
  },
  'src/lib': {
    path: 'src/lib',
    truncated: false,
    entries: [{ name: 'util.ts', type: 'file' as const, size: 640 }],
  },
}

/** 假同源 fetch：四条只读路由的确定性响应（不发真实请求）。 */
function response(value: unknown): { ok: boolean; status: number; json(): Promise<unknown> } {
  return { ok: true, status: 200, json: () => Promise.resolve(value) }
}

const fetchImpl = (input: string, init?: { body?: string }): Promise<{ ok: boolean; status: number; json(): Promise<unknown> }> => {
  const url = String(input)
  if (url.endsWith('/tree')) {
    let path = ''
    try {
      const raw = typeof init?.body === 'string' ? init.body : '{}'
      const parsed = JSON.parse(raw) as { path?: unknown }
      path = typeof parsed.path === 'string' ? parsed.path : ''
    } catch {
      return Promise.resolve(response({ ok: false, error: { code: 'threadline/bad-request', message: 'invalid JSON body' } }))
    }
    const listing = path === '' ? TREE_ROOT : TREE_CHILD[path]
    if (listing === undefined) {
      return Promise.resolve(
        response({ ok: false, error: { code: 'threadline/bad-request', message: 'not-found', detail: 'not-found' } }),
      )
    }
    return Promise.resolve(response({ ok: true, ...listing }))
  }
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
    if (slowDetail) {
      return new Promise((resolve) => {
        window.setTimeout(() => resolve(response({ ok: true, session: detail })), 10_000)
      })
    }
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
  /** 假宿主 tab 被点中的次数（T20：点「影响」图标 / T32：命令触发 = click 这个 tab）。 */
  tabClicks: number
}
const probe: Probe = { tabClicks: 0 }
;(window as unknown as { __t09: Probe }).__t09 = probe

/**
 * 影响入口夹具（T20）：造一个**假宿主 tab bar**（`role="tab"` + 文本「对话」/「脉络」）。
 *
 * 为什么：`activateThreadlineTab()` 只认 DOM（role=tab / aria-label / data-view-id），
 * 真实宿主里 tab 由宿主管；夹具里自建一条即可证明「点击图标 → tab 真的被点中」，
 * 同时断言页面里**没有** role="dialog"/popover（点击不再开窗）。
 */
function ImpactFixture(): React.ReactElement {
  const [active, setActive] = React.useState('chat')
  const select = (view: string): void => {
    if (view === 'threadline') probe.tabClicks += 1
    setActive(view)
  }
  return h(
    'div',
    { className: 'threadline-app', style: { blockSize: '100%', padding: '24px' } },
    h(
      'div',
      { role: 'tablist', 'data-testid': 'host-tabs', style: { display: 'flex', gap: '8px', marginBlockEnd: '16px' } },
      h(
        'button',
        { type: 'button', role: 'tab', 'aria-selected': active === 'chat' ? 'true' : 'false', onClick: () => select('chat') },
        '对话',
      ),
      h(
        'button',
        { type: 'button', role: 'tab', 'aria-selected': active === 'threadline' ? 'true' : 'false', onClick: () => select('threadline') },
        '脉络',
      ),
    ),
    h('div', { 'data-testid': 'active-view', 'data-active-view': active }, active === 'threadline' ? '当前：脉络' : '当前：对话'),
    h(
      'div',
      { style: { display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end' } },
      h(ImpactAction, {
        messageId: 'm-1b',
        sessionId: SESSION_ID,
        store: fakeStore,
        locale: 'zh',
        testId: 'impact',
      }),
    ),
  )
}

function App(): React.ReactElement {
  const now = BASE_TIME + 10 * 60_000
  if (view === 'impact') {
    return h(ImpactFixture, null)
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
      ...(focus === null ? {} : { viewRequest: { view: 'threadline', focus }, completeViewRequest: () => undefined }),
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

// 探针：假宿主 tab 被点中的次数（T20/T32 的"点击 = 导航"证据；不再有 dialog 探针）
/**
 * 就绪判定：等数据层把首帧扫描/详情落定（覆盖率文案稳定 + 目录树已出条目），再打 ready。
 * 只等两帧会截到"正在补全历史 x/y"或"右栏还在读根目录"的中间态，同一状态两次截图不一致（可复现性纪律）。
 *
 * 1.2.0：右栏改为工作区目录树（`/tree` 是异步的），所以 ready 条件从旧的「图节点 > 0」
 * 换成「右栏已渲染出行」——图节点可能为 0（空目录/未触碰文件是中性节点），不能拿它当门。
 */
function whenStable(): void {
  const deadline = Date.now() + 3500
  const tick = (): void => {
    const pill = document.querySelector('[data-testid="coverage-pill"]')
    const rows = document.querySelectorAll('[data-tree-row]').length
    const graphRoot = document.querySelector('[data-tl-graph]')
    const text = pill === null ? '' : (pill.textContent ?? '')
    const settled = text.includes('全部记录') || text.includes('读取失败') || text.length === 0
    // 右栏出行 = 目录树已就绪；图根存在 = 左图已挂载（空目录也算挂载）。
    if ((settled && rows > 0 && graphRoot !== null) || Date.now() > deadline) {
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
