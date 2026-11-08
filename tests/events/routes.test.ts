/**
 * A10-2 扫描/快照协议单测（06 §5）+ N-11（过期 scanId）+ 路由注册边界。
 *
 * 用 mock persistence + 确定性 gate（每个会话处理后停住），逐帧观察：
 * scan → snapshot(reset) → snapshot(增量) → done 的状态机与 rev 递增/合并。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRoutes, ROUTE_PATHS } from '../../src/host/routes.ts'
import { apply } from '../../src/host/index.ts'
import type { HostContext, HostScope } from '../../src/host/index.ts'
import { ScanManager } from '../../src/host/scan.ts'
import type { HostServices, PersistenceLike } from '../../src/host/services.ts'
import { CWD, MockPersistence, makeHeader, sessionInput, simpleSessionEvents, tick } from './fixtures.ts'

const NOW = 1_700_000_000_000
const DAY = 24 * 60 * 60 * 1000

/** 确定性 gate：扫描每处理完一个会话就停在这里，测试逐帧推进。 */
function createGate(): {
  yield(): Promise<void>
  next(): Promise<void>
  step(): Promise<void>
} {
  let release: (() => void) | undefined
  let arrive: (() => void) | undefined
  const gate = {
    yield(): Promise<void> {
      return new Promise<void>((resolve) => {
        release = resolve
        const signal = arrive
        arrive = undefined
        signal?.()
      })
    },
    next(): Promise<void> {
      if (release !== undefined) return Promise.resolve()
      return new Promise<void>((resolve) => {
        arrive = resolve
      })
    },
    async step(): Promise<void> {
      await gate.next()
      const run = release
      release = undefined
      if (run !== undefined) run()
      await tick(1)
    },
  }
  return gate
}

function servicesWith(persistence: PersistenceLike | undefined): HostServices {
  return {
    getPersistence: () => persistence,
    getSessionQuery: () => undefined,
  }
}

async function post(routes: ReturnType<typeof createRoutes>, kind: 'scan' | 'snapshot' | 'detail', body: unknown) {
  const response = await routes.invoke(kind, new Request(`http://127.0.0.1${ROUTE_PATHS[kind]}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }))
  const text = await response.text()
  return { status: response.status, cacheControl: response.headers.get('cache-control'), json: JSON.parse(text) as Record<string, unknown> }
}

function buildFixture(): MockPersistence {
  const persistence = new MockPersistence()
  persistence.add('s-root', simpleSessionEvents('s-root'), makeHeader('s-root', { cwd: CWD }))
  // 子智能体 cwd 不同，但 parentSession 在集合内 → 允许（04 §2.4）。
  persistence.add(
    's-child',
    simpleSessionEvents('s-child'),
    makeHeader('s-child', { cwd: 'E:\\other\\project', parentSession: 's-root', origin: 'subagent' }),
  )
  persistence.add(
    's-old',
    simpleSessionEvents('s-old', NOW - 20 * DAY),
    makeHeader('s-old', { cwd: CWD, createdAt: NOW - 20 * DAY }),
  )
  return persistence
}

function scanBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    workspaceId: 'ws-1',
    cwd: CWD,
    generation: 1,
    sessions: [
      sessionInput('s-root', NOW, { running: true, title: '当前会话' }),
      sessionInput('s-child', NOW - DAY, { parentId: 's-root', origin: 'subagent' }),
      sessionInput('s-old', NOW - 20 * DAY),
    ],
    ...overrides,
  }
}

test('A10-2 状态机：scan → snapshot(reset) → 增量 → done，rev 递增且增量可合并', async () => {
  const gate = createGate()
  const persistence = buildFixture()
  const manager = new ScanManager(servicesWith(persistence), { now: () => NOW, yield: gate.yield })
  const routes = createRoutes(servicesWith(persistence), manager)
  try {
    const scan = await post(routes, 'scan', scanBody())
    assert.equal(scan.json.ok, true, JSON.stringify(scan.json))
    assert.equal(scan.json.rev, 0)
    assert.equal(scan.json.total, 3)
    // 排序：当前（running）→ 子智能体 → 更早历史。
    assert.deepEqual(scan.json.order, ['s-root', 's-child', 's-old'])
    const scanId = scan.json.scanId as string

    await gate.next() // s-root 处理完，扫描暂停
    const first = await post(routes, 'snapshot', { scanId, sinceRev: 0 })
    const firstSnap = first.json as unknown as {
      ok: boolean
      rev: number
      reset: boolean
      done: boolean
      progress: { scanned: number; total: number; phase: string }
      changedSessions: Array<{ id: string }>
      changedFiles: unknown[]
    }
    assert.equal(firstSnap.ok, true)
    assert.equal(firstSnap.reset, true)
    assert.equal(firstSnap.done, false)
    assert.equal(firstSnap.rev, 1)
    assert.deepEqual(firstSnap.changedSessions.map((session) => session.id), ['s-root'])
    assert.ok(firstSnap.changedFiles.length > 0)
    assert.equal(firstSnap.progress.scanned, 1)
    assert.equal(firstSnap.progress.total, 3)
    assert.equal(firstSnap.progress.phase, 'scanning')
    assert.equal(first.cacheControl, 'no-store')

    // 扫描还在进行时，detail 对「本扫描已请求但尚未处理的会话」也可用（按需冷读，不伪造扫描进度）。
    const early = await post(routes, 'detail', { sessionId: 's-old' })
    assert.equal(early.json.ok, true)
    assert.equal((early.json.session as { counts: { turns: number } }).counts.turns, 1)

    // sinceRev=当前 rev：无新变更，但仍不 done（不提前 done）。
    const idle = await post(routes, 'snapshot', { scanId, sinceRev: firstSnap.rev })
    const idleSnap = idle.json as unknown as { rev: number; reset: boolean; done: boolean; changedSessions: unknown[] }
    assert.equal(idleSnap.rev, 1)
    assert.equal(idleSnap.reset, false)
    assert.equal(idleSnap.done, false)
    assert.equal(idleSnap.changedSessions.length, 0)

    await gate.step()
    await gate.next() // s-child 处理完
    const second = await post(routes, 'snapshot', { scanId, sinceRev: firstSnap.rev })
    const secondSnap = second.json as unknown as {
      rev: number
      reset: boolean
      changedSessions: Array<{ id: string; rootId: string }>
      changedFiles: Array<{ path: string }>
      removedFiles: string[]
    }
    assert.equal(secondSnap.rev, 2)
    assert.equal(secondSnap.reset, false)
    assert.deepEqual(secondSnap.changedSessions.map((session) => session.id), ['s-child'])
    // 子智能体归到工作线 rootId，而不是自成一根。
    assert.equal(secondSnap.changedSessions[0].rootId, 's-root')
    assert.ok(secondSnap.changedFiles.length > 0)
    assert.deepEqual(secondSnap.removedFiles, [])

    await gate.step()
    // 最后一个会话没有 yield；轮询到 done（不固定 sleep 时长）。
    let final = await post(routes, 'snapshot', { scanId, sinceRev: secondSnap.rev })
    for (let i = 0; i < 50 && (final.json as { done: boolean }).done !== true; i += 1) {
      await tick(1)
      final = await post(routes, 'snapshot', { scanId, sinceRev: secondSnap.rev })
    }
    const finalSnap = final.json as unknown as {
      rev: number
      done: boolean
      progress: { scanned: number; failed: number; cached: number; phase: string }
      changedSessions: Array<{ id: string; subagents: number }>
    }
    assert.equal(finalSnap.done, true)
    assert.equal(finalSnap.rev, 3)
    assert.equal(finalSnap.progress.phase, 'complete')
    assert.equal(finalSnap.progress.scanned, 3)
    assert.equal(finalSnap.progress.failed, 0)
    assert.deepEqual(finalSnap.changedSessions.map((session) => session.id), ['s-old'])

    // 合并结果：全量 snapshot(sinceRev=0) 应含 3 个会话，父会话 subagents=1。
    const full = await post(routes, 'snapshot', { scanId, sinceRev: 0 })
    const fullSnap = full.json as unknown as {
      reset: boolean
      done: boolean
      changedSessions: Array<{ id: string; subagents: number }>
      changedFiles: Array<{ path: string; ops: number }>
      changedEdges: Array<{ from: string; to: string; weight: number }>
    }
    assert.equal(fullSnap.reset, true)
    assert.equal(fullSnap.done, true)
    assert.equal(fullSnap.changedSessions.length, 3)
    const root = fullSnap.changedSessions.find((session) => session.id === 's-root')
    assert.equal(root?.subagents, 1)
    // 每个会话都读了 src/a.ts、写了 src/b.ts → 只有 2 个文件节点（按 key 聚合）。
    assert.deepEqual(fullSnap.changedFiles.map((file) => file.path).sort(), ['src/a.ts', 'src/b.ts'])
    assert.ok(fullSnap.changedEdges.length >= 1)
    assert.equal(fullSnap.changedEdges[0].from < fullSnap.changedEdges[0].to, true)
  } finally {
    routes.dispose()
  }
})

test('A10-2 续读：同一个 rev 重复拉取是幂等的（reset=false，空变更）', async () => {
  const persistence = buildFixture()
  const manager = new ScanManager(servicesWith(persistence), { now: () => NOW, yield: () => Promise.resolve() })
  const routes = createRoutes(servicesWith(persistence), manager)
  try {
    const scan = await post(routes, 'scan', scanBody({ sessions: [sessionInput('s-root', NOW, { running: true })] }))
    const scanId = scan.json.scanId as string
    let snap = await post(routes, 'snapshot', { scanId, sinceRev: 0 })
    for (let i = 0; i < 100 && (snap.json as { done: boolean }).done !== true; i += 1) {
      await tick(1)
      snap = await post(routes, 'snapshot', { scanId, sinceRev: 0 })
    }
    const rev = (snap.json as { rev: number }).rev
    assert.equal((snap.json as { done: boolean }).done, true)
    const again = await post(routes, 'snapshot', { scanId, sinceRev: rev })
    const againSnap = again.json as { reset: boolean; done: boolean; changedSessions: unknown[]; rev: number }
    assert.equal(againSnap.reset, false)
    assert.equal(againSnap.done, true)
    assert.equal(againSnap.changedSessions.length, 0)
    assert.equal(againSnap.rev, rev)
  } finally {
    routes.dispose()
  }
})

test('N-11 过期/不存在 scanId：scan-not-found；非法 scanId：bad-request', async () => {
  const persistence = buildFixture()
  const manager = new ScanManager(servicesWith(persistence), { now: () => NOW, yield: () => Promise.resolve() })
  const routes = createRoutes(servicesWith(persistence), manager)
  try {
    const missing = await post(routes, 'snapshot', { scanId: 'scan-999', sinceRev: 0 })
    assert.equal((missing.json as { error: { code: string } }).error.code, 'threadline/scan-not-found')
    const invalid = await post(routes, 'snapshot', { scanId: '../../etc/passwd', sinceRev: 0 })
    assert.equal((invalid.json as { error: { code: string } }).error.code, 'threadline/bad-request')
  } finally {
    routes.dispose()
  }
})

test('A10-2 同一 workspace 新扫描取消旧扫描（旧 scanId → scan-not-found）', async () => {
  const gate = createGate()
  const persistence = buildFixture()
  const manager = new ScanManager(servicesWith(persistence), { now: () => NOW, yield: gate.yield })
  const routes = createRoutes(servicesWith(persistence), manager)
  try {
    const first = await post(routes, 'scan', scanBody({ generation: 1 }))
    const firstId = first.json.scanId as string
    await gate.next() // 让旧扫描真的跑起来
    const second = await post(routes, 'scan', scanBody({ generation: 2 }))
    assert.equal(second.json.ok, true)
    assert.notEqual(second.json.scanId, firstId)
    const old = await post(routes, 'snapshot', { scanId: firstId, sinceRev: 0 })
    assert.equal((old.json as { error: { code: string } }).error.code, 'threadline/scan-not-found')
    // 解除旧扫描的 gate，避免悬挂 promise；新扫描同样被 dispose 收尾。
    await gate.step()
  } finally {
    routes.dispose()
  }
})

test('60s 无轮询自动取消：空闲计时到点后 scanId 失效（测试注入 20ms）', async () => {
  const gate = createGate()
  const persistence = buildFixture()
  const manager = new ScanManager(servicesWith(persistence), { now: () => NOW, yield: gate.yield, idleTimeoutMs: 20 })
  const routes = createRoutes(servicesWith(persistence), manager)
  try {
    const scan = await post(routes, 'scan', scanBody())
    const scanId = scan.json.scanId as string
    await gate.next()
    // 不轮询，等空闲计时器触发。
    await tick(40)
    const after = await post(routes, 'snapshot', { scanId, sinceRev: 0 })
    assert.equal((after.json as { error: { code: string } }).error.code, 'threadline/scan-not-found')
    await gate.step()
  } finally {
    routes.dispose()
  }
})

test('capability-missing：sessionPersistence 缺失时 scan/detail 明确报错，snapshot 不伪造扫描', async () => {
  const routes = createRoutes(servicesWith(undefined), new ScanManager(servicesWith(undefined)))
  try {
    const scan = await post(routes, 'scan', scanBody())
    assert.equal((scan.json as { error: { code: string } }).error.code, 'threadline/capability-missing')
    const detail = await post(routes, 'detail', { sessionId: 's-root' })
    assert.equal((detail.json as { error: { code: string } }).error.code, 'threadline/capability-missing')
    const snapshot = await post(routes, 'snapshot', { scanId: 'scan-1', sinceRev: 0 })
    assert.equal((snapshot.json as { error: { code: string } }).error.code, 'threadline/scan-not-found')
  } finally {
    routes.dispose()
  }
})

test('路由注册：三条 POST 只读路由 + disposal 回收；注册抛错时返回 false 且不崩', () => {
  const registered: Array<{ path: string; methods: string[]; requestBody: string }> = []
  const disposed: string[] = []
  const connection = {
    fetch: {
      register(route: { path: string; methods: string[]; requestBody: string }): () => void {
        registered.push({ path: route.path, methods: route.methods, requestBody: route.requestBody })
        return () => disposed.push(route.path)
      },
    },
  }
  const services: HostServices = { connection, getPersistence: () => undefined, getSessionQuery: () => undefined }
  const routes = createRoutes(services)
  assert.equal(routes.register(), true)
  assert.deepEqual(registered.map((route) => route.path).sort(), [
    '/api/dsh-threadline/detail',
    '/api/dsh-threadline/scan',
    '/api/dsh-threadline/snapshot',
    '/api/dsh-threadline/tree',
  ])
  for (const route of registered) {
    assert.deepEqual(route.methods, ['POST'])
    assert.equal(route.requestBody, 'buffered')
  }
  routes.dispose()
  assert.equal(disposed.length, 4)
  assert.equal(routes.register(), true) // dispose 后可重新注册（fiber 重载场景）
  routes.dispose()

  // 注册中途抛错：已注册的要回收，register() 返回 false（插件不崩）。
  const partial: string[] = []
  let count = 0
  const failing = {
    fetch: {
      register(route: { path: string }): () => void {
        count += 1
        if (count === 2) throw new Error('duplicate path')
        partial.push(route.path)
        return () => partial.push(`disposed:${route.path}`)
      },
    },
  }
  const failingRoutes = createRoutes({ connection: failing, getPersistence: () => undefined, getSessionQuery: () => undefined })
  assert.equal(failingRoutes.register(), false)
  assert.deepEqual(partial, ['/api/dsh-threadline/scan', 'disposed:/api/dsh-threadline/scan'])
  failingRoutes.dispose()
})


test('index.apply 接线：connection 缺失不崩；注册成功由 effect 回收；注册失败只 warn 不抛', () => {
  const warnings: string[] = []
  const infos: string[] = []

  // 1) connection 缺失：只 warn 一句，不注册、不抛。
  const noConnection: HostContext = {
    logger: { info: (message) => infos.push(message), warn: (message) => warnings.push(message) },
    inject: (_deps, callback) => {
      callback({ get: () => undefined, logger: { warn: (message) => warnings.push(message) } } as HostScope)
    },
  }
  assert.doesNotThrow(() => apply(noConnection))
  assert.deepEqual(warnings, ['threadline: connection missing; UI will show hostUnavailable'])
  assert.equal(infos.length, 1)
  assert.equal(infos[0].includes('host loaded'), true)

  // 2) connection 可用：注册三条路由；effect 回收时 dispose 被调用。
  const registered: string[] = []
  const disposed: string[] = []
  let effectDispose: (() => void) | undefined
  const connection = {
    fetch: {
      register(route: { path: string }): () => void {
        registered.push(route.path)
        return () => disposed.push(route.path)
      },
    },
  }
  const okCtx: HostContext = {
    logger: { warn: (message) => warnings.push(message) },
    inject: (_deps, callback) => {
      callback({
        get: (name: string) => (name === 'connection' ? connection : undefined),
        logger: { warn: (message) => warnings.push(message) },
        effect: (callback2: () => (() => void) | void) => {
          const cleanup = callback2()
          if (typeof cleanup === 'function') effectDispose = cleanup
        },
      } as HostScope)
    },
  }
  apply(okCtx)
  assert.deepEqual(registered.sort(), [ROUTE_PATHS.detail, ROUTE_PATHS.scan, ROUTE_PATHS.snapshot, ROUTE_PATHS.tree].sort())
  assert.equal(typeof effectDispose, 'function')
  effectDispose?.()
  assert.equal(disposed.length, 4)

  // 3) 注册抛错：插件不崩，只多一条不含正文/路径的 warning。
  const failingCtx: HostContext = {
    logger: { warn: (message) => warnings.push(message) },
    inject: (_deps, callback) => {
      callback({
        get: (name: string) => (name === 'connection' ? { fetch: { register: () => { throw new Error('duplicate path') } } } : undefined),
        logger: { warn: (message) => warnings.push(message) },
        effect: () => {},
      } as HostScope)
    },
  }
  assert.doesNotThrow(() => apply(failingCtx))
  assert.deepEqual(warnings, [
    'threadline: connection missing; UI will show hostUnavailable',
    'threadline: local routes unavailable; UI will show hostUnavailable',
  ])
})
