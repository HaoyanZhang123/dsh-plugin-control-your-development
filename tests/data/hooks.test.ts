/**
 * hooks 薄层冒烟（不渲染真实 DOM）：模块导出完整 + SSR 首帧能拿到 scope 与 idle 状态。
 *
 * 这里只验证“接线不断”：真正的轮询行为在 controller.test.ts，详情缓存在 detail.test.ts。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import * as React from 'react'
import { renderToString } from 'react-dom/server'
import {
  useThreadlineData,
  useThreadlineDetail,
  useWorkspaceScope,
} from '../../src/client/data/hooks.ts'
import { createDetailStore } from '../../src/client/data/detail.ts'
import {
  disposeAllWarmups,
  ensureThreadlineWarmup,
  threadlineWorkspaceKey,
} from '../../src/client/data/warmup.ts'
import { buildWorkspaceScope } from '../../src/client/data/scope.ts'
import { NOW, createFakeClock, createFakeFetch, scopeFixture, snapshotPayload } from './fixtures.ts'

test('hooks 导出齐全（T07/T08/T09 按 index.ts 使用）', () => {
  assert.equal(typeof useThreadlineData, 'function')
  assert.equal(typeof useThreadlineDetail, 'function')
  assert.equal(typeof useWorkspaceScope, 'function')
})

test('useWorkspaceScope：SSR 首帧即可得到正确排序与范围', () => {
  const fixture = scopeFixture({ now: NOW })
  const Probe = (): React.ReactElement => {
    const scope = useWorkspaceScope({
      workspaces: fixture.workspaces,
      sessions: fixture.sessions,
      sessionId: fixture.currentId,
      now: NOW,
    })
    return React.createElement('div', null, `${scope.workspaceId}|${scope.order.join(',')}`)
  }
  const html = renderToString(React.createElement(Probe))
  assert.match(html, /ws-main\|s-current,s-child,s-grandchild,s-recent,s-sibling,s-history,s-archived/)
})

test('useThreadlineData：SSR 首帧为 idle，且不会在渲染期发请求', () => {
  const fixture = scopeFixture({ now: NOW })
  const fake = createFakeFetch()
  fake.on('scan', () => ({ ok: true, scanId: 'scan-1', rev: 0, total: 1, order: [] }))
  fake.on('snapshot', () => ({ ok: true, scanId: 'scan-1', rev: 0, reset: true, done: true, progress: { total: 1, scanned: 1, failed: 0, cached: 0, phase: 'complete' }, changedSessions: [], changedFiles: [], changedEdges: [], removedFiles: [], removedEdges: [], errors: [] }))

  const Probe = (): React.ReactElement => {
    const scope = useWorkspaceScope({
      workspaces: fixture.workspaces,
      sessions: fixture.sessions,
      sessionId: fixture.currentId,
      now: NOW,
    })
    const data = useThreadlineData({ scope, fetch: fake.fetch, enabled: false })
    return React.createElement('div', null, `${data.status}|${data.degrade.kind}|${data.graph.files.size}`)
  }
  const html = renderToString(React.createElement(Probe))
  assert.match(html, /idle\|none\|0/)
  // enabled: false ⇒ 渲染期与 effect 都不发扫描请求
  assert.equal(fake.calls.length, 0)
})

test('useThreadlineDetail：无缓存时首帧为 null，不伪装成空详情', () => {
  const fake = createFakeFetch()
  fake.on('detail', () => ({ ok: true, session: { id: 's-1' } }))
  const store = createDetailStore({ fetch: fake.fetch, now: () => NOW })
  const Probe = (): React.ReactElement => {
    const entry = useThreadlineDetail(store, 's-1', { enabled: false })
    return React.createElement('div', null, entry === null ? 'none' : entry.status)
  }
  const html = renderToString(React.createElement(Probe))
  assert.match(html, /none/)
  assert.equal(fake.calls.length, 0)
})

test('T13e 已有预热时 useThreadlineData 只订阅共享状态（不二次 /scan）', () => {
  const fixture = scopeFixture({ now: NOW })
  const clock = createFakeClock(NOW)
  const fake = createFakeFetch()
  fake.on('scan', () => ({ ok: true, scanId: 'scan-1', rev: 0, total: 3, order: [] }))
  fake.on('snapshot', () =>
    snapshotPayload({ rev: 1, reset: true, progress: { total: 3, scanned: 1, failed: 0, cached: 0, phase: 'scanning' } }),
  )
  const warmupScope = buildWorkspaceScope({
    workspaces: fixture.workspaces,
    sessions: fixture.sessions,
    sessionId: fixture.currentId,
    now: NOW,
  })
  const key = threadlineWorkspaceKey(warmupScope.workspaceId, warmupScope.cwd)
  ensureThreadlineWarmup({
    workspaceKey: key,
    cwd: warmupScope.cwd,
    sessions: Object.values(fixture.sessions.byId).map((row) => ({
      id: row.id,
      updatedAt: row.updatedAt ?? NOW,
      running: row.running === true,
      ...(row.cwd === undefined ? {} : { cwd: row.cwd }),
      ...(row.parentId === undefined ? {} : { parentId: row.parentId }),
      ...(row.title === undefined ? {} : { title: row.title }),
      ...(row.archived === undefined ? {} : { archived: row.archived }),
    })),
    fetch: fake.fetch,
    timer: clock.timer,
    now: clock.now,
  })
  assert.equal(fake.callsOf('scan').length, 1)

  const Probe = (): React.ReactElement => {
    const scope = useWorkspaceScope({
      workspaces: fixture.workspaces,
      sessions: fixture.sessions,
      sessionId: fixture.currentId,
      now: NOW,
    })
    const data = useThreadlineData({ scope, fetch: fake.fetch })
    return React.createElement('div', null, `${data.status}|${data.graph.files.size}`)
  }
  const html = renderToString(React.createElement(Probe))
  // SSR 不跑 effect：首帧直接是共享预热的状态，而不是新的 idle 控制器
  assert.match(html, /starting\|0/)
  assert.equal(fake.callsOf('scan').length, 1)
  disposeAllWarmups()
})

test('useThreadlineDetail 接受 cwd（T13e）；enabled:false 时不发请求也不猜', () => {
  const fake = createFakeFetch()
  const store = createDetailStore({ fetch: fake.fetch, now: () => NOW })
  const Probe = (): React.ReactElement => {
    const entry = useThreadlineDetail(store, 's-1', { enabled: false, cwd: 'E:/DSH/workspaces/demo' })
    return React.createElement('div', null, entry === null ? 'none' : entry.status)
  }
  const html = renderToString(React.createElement(Probe))
  assert.match(html, /none/)
  assert.equal(fake.calls.length, 0)
  store.dispose()
})
