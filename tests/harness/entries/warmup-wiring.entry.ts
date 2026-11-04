/*
 * entries/warmup-wiring.entry.ts —— T13f 端到端证据：**没开过 tab** 时点每轮影响图标，
 * 也要能自动 /scan 预热 + 带 cwd 冷读 /detail，并把图标从"未知"变成"有影响"。
 *
 * 做法：在页面里 stub window.fetch（记录每次请求），再用夹具挂 ImpactAction。
 * 断言（由 run-t13f.mjs 读取 window.__wiring）：
 *   - 先有 /api/dsh-threadline/scan，后有 /api/dsh-threadline/detail；
 *   - detail 的 body 带 cwd（host cold-read 归属校验用）；
 *   - 图标最终渲染出 data-state="ready" 且有 data-impact-count。
 */
import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { installStyles } from '../../../src/client/styles/index.ts'
import { ImpactAction } from '../../../src/client/entries/impact.ts'
import { buildDetail, buildSessionRows, buildWorkspaceItems, SESSION_ID } from '../../entries/fixtures.ts'

const h = React.createElement

interface Call {
  url: string
  body: unknown
}

const calls: Call[] = []
const detail = buildDetail()
const finalMessageId = detail.turns[0]?.finalMessageId ?? 'm-1b'

function json(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    text: () => Promise.resolve(JSON.stringify(body)),
    json: () => Promise.resolve(body),
  } as unknown as Response
}

const scanBody = { ok: true, scanId: 'scan-1', rev: 0, total: 1, order: [SESSION_ID] }
const snapshotBody = {
  ok: true,
  scanId: 'scan-1',
  rev: 1,
  reset: true,
  done: true,
  progress: { total: 1, scanned: 1, failed: 0, cached: 0, phase: 'complete' },
  changedSessions: [
    {
      id: SESSION_ID,
      rootId: SESSION_ID,
      title: detail.title,
      cwd: detail.cwd,
      startedAt: detail.startedAt,
      updatedAt: detail.updatedAt,
      status: detail.status,
      turns: detail.turns.length,
      files: 3,
      commands: 1,
      subagents: 2,
      errors: 1,
      running: true,
      archived: false,
    },
  ],
  changedFiles: [],
  changedEdges: [],
  removedFiles: [],
  removedEdges: [],
  errors: [],
}

;(window as unknown as { fetch: unknown }).fetch = (input: unknown, init?: { body?: string }): Promise<Response> => {
  const url = String(input)
  let body: unknown
  try { body = init?.body === undefined ? undefined : JSON.parse(String(init.body)) } catch { body = undefined }
  calls.push({ url, body })
  if (url.includes('/scan')) return Promise.resolve(json(scanBody))
  if (url.includes('/snapshot')) return Promise.resolve(json(snapshotBody))
  if (url.includes('/detail')) return Promise.resolve(json({ ok: true, session: detail }))
  return Promise.resolve(json({ ok: false, error: { code: 'threadline/bad-request', message: 'unexpected' } }))
}

const sessionsSnapshot = { current: SESSION_ID, ids: [SESSION_ID], byId: { [SESSION_ID]: buildSessionRows()[0] } }
const workspacesSnapshot = {
  current: 'ws-1',
  items: buildWorkspaceItems(),
  byId: { 'ws-1': buildWorkspaceItems()[0] },
}
const useSessions = (selector: (snapshot: unknown) => unknown): unknown => selector(sessionsSnapshot)
const useWorkspaces = (selector: (snapshot: unknown) => unknown): unknown => selector(workspacesSnapshot)

function App(): React.ReactElement {
  return h(ImpactAction, {
    messageId: finalMessageId,
    sessionId: SESSION_ID,
    useSessions,
    useWorkspaces,
    locale: 'zh',
  } as never)
}

installStyles(document)
const container = document.getElementById('root')
if (!container) throw new Error('harness entry: 缺少 #root')
createRoot(container).render(h(App, null))

function ready(): void {
  const deadline = Date.now() + 4000
  const tick = (): void => {
    const icon = document.querySelector('[data-threadline-impact]')
    const state = icon === null ? '' : icon.getAttribute('data-state')
    const detailCall = calls.filter((call) => call.url.includes('/detail'))
    if ((state === 'ready' && detailCall.length > 0) || Date.now() > deadline) {
      ;(window as unknown as { __wiring: unknown }).__wiring = {
        calls,
        state,
        count: icon === null ? null : icon.getAttribute('data-impact-count'),
        html: icon === null ? '' : icon.outerHTML.slice(0, 600),
      }
      document.documentElement.setAttribute('data-harness-ready', '1')
      return
    }
    window.setTimeout(tick, 50)
  }
  tick()
}
requestAnimationFrame(() => requestAnimationFrame(ready))
