/**
 * A10-3 冷读/上限/错误码单测（06 §5）+ 负向 N-02/N-04/N-07 的路由侧。
 *
 * 断言重点：错误码正确、插件不崩、以及"不读任意路径"——被拒绝的 sessionId 从未 open。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRoutes, validateDetailRequest, validateScanRequest, validateSnapshotRequest } from '../../src/host/routes.ts'
import { ScanManager } from '../../src/host/scan.ts'
import type { HostServices } from '../../src/host/services.ts'
import { CWD, MockPersistence, makeHeader, namedError, sessionInput, simpleSessionEvents } from './fixtures.ts'
import { errorCode, post, waitUntilDone } from './harness.ts'

const NOW = 1_700_000_000_000

function servicesWith(persistence: MockPersistence | undefined): HostServices {
  return { getPersistence: () => persistence, getSessionQuery: () => undefined }
}

function makeRoutes(persistence: MockPersistence | undefined) {
  const services = servicesWith(persistence)
  const manager = new ScanManager(services, { now: () => NOW, yield: () => Promise.resolve() })
  return createRoutes(services, manager)
}

function body(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    workspaceId: 'ws-1',
    cwd: CWD,
    generation: 1,
    sessions: [sessionInput('s-1', NOW)],
    ...overrides,
  }
}

test('参数校验：sessionId/cwd/updatedAt/refresh/数组上限各自拒绝为 bad-request（不读日志）', () => {
  const cases: Array<[string, unknown]> = [
    ['body 非对象', 'nope'],
    ['workspaceId 空', body({ workspaceId: '' })],
    ['cwd 相对', body({ cwd: 'relative/path' })],
    ['cwd 空', body({ cwd: '  ' })],
    ['generation 负数', body({ generation: -1 })],
    ['generation 非整数', body({ generation: 1.5 })],
    ['sessions 非数组', body({ sessions: {} })],
    ['session id 路径穿越', body({ sessions: [sessionInput('../etc', NOW)] })],
    ['session id 绝对路径', body({ sessions: [sessionInput('C:/Windows/win.ini', NOW)] })],
    ['session id 超长', body({ sessions: [sessionInput('a'.repeat(201), NOW)] })],
    ['updatedAt 负数', body({ sessions: [{ id: 's-1', updatedAt: -1, running: false }] })],
    ['updatedAt 非有限', body({ sessions: [{ id: 's-1', updatedAt: Number.POSITIVE_INFINITY, running: false }] })],
    ['running 非布尔', body({ sessions: [{ id: 's-1', updatedAt: 1, running: 'yes' }] })],
    ['refresh 非数组', body({ refresh: 's-1' })],
    ['refresh 不在 sessions', body({ refresh: ['s-other'] })],
    ['refresh 非法 id', body({ refresh: ['../x'] })],
  ]
  for (const [label, value] of cases) {
    const result = validateScanRequest(value)
    assert.equal(result.ok, false, label)
    if (result.ok === false) assert.equal(result.code, 'threadline/bad-request', label)
  }

  // 合法请求通过
  assert.equal(validateScanRequest(body()).ok, true)
  // 3000 上限：3001 条拒绝
  const tooMany = Array.from({ length: 3001 }, (_, index) => sessionInput(`s-${index}`, NOW))
  const over = validateScanRequest(body({ sessions: tooMany }))
  assert.equal(over.ok, false)
  // 重复 id 去重（同一会话只处理一次，total 不错算）
  const deduped = validateScanRequest(
    body({ sessions: [sessionInput('s-1', NOW), sessionInput('s-1', NOW + 1)] }),
  )
  assert.equal(deduped.ok, true)
  if (deduped.ok) assert.equal(deduped.value.sessions.length, 1)
})

test('参数校验：snapshot/detail 的 scanId、sessionId、sinceRev 拒绝坏输入', () => {
  assert.equal(validateSnapshotRequest({ scanId: 'scan-1', sinceRev: 0 }).ok, true)
  assert.equal(validateSnapshotRequest({ scanId: 'scan-1', sinceRev: -1 }).ok, false)
  assert.equal(validateSnapshotRequest({ scanId: 'scan-1', sinceRev: 1.2 }).ok, false)
  assert.equal(validateSnapshotRequest({ scanId: '../../etc', sinceRev: 0 }).ok, false)
  assert.equal(validateSnapshotRequest({ scanId: '', sinceRev: 0 }).ok, false)

  assert.equal(validateDetailRequest({ sessionId: 's-1' }).ok, true)
  assert.equal(validateDetailRequest({ sessionId: '../x' }).ok, false)
  assert.equal(validateDetailRequest({ sessionId: 's-1', refresh: 'true' }).ok, false)
  assert.equal(validateDetailRequest({ sessionId: 's-1', generation: -2 }).ok, false)
})

test('非法 JSON body：bad-request（不崩）', async () => {
  const routes = makeRoutes(new MockPersistence())
  try {
    const response = await routes.invoke(
      'scan',
      new Request('http://127.0.0.1/api/dsh-threadline/scan', { method: 'POST', body: 'not-json' }),
    )
    const json = (await response.json()) as { ok: boolean; error: { code: string } }
    assert.equal(json.ok, false)
    assert.equal(json.error.code, 'threadline/bad-request')
    assert.equal(response.headers.get('cache-control'), 'no-store')
  } finally {
    routes.dispose()
  }
})

test('N-07 归属校验：工作区外会话（无父）→ bad-request，且从未 open 该会话', async () => {
  const persistence = new MockPersistence()
  persistence.add('s-foreign', simpleSessionEvents('s-foreign'), makeHeader('s-foreign', { cwd: 'E:\\elsewhere\\proj' }))
  persistence.add('s-1', simpleSessionEvents('s-1'))
  const routes = makeRoutes(persistence)
  try {
    const reply = await post(routes, 'scan', body({ sessions: [sessionInput('s-1', NOW), sessionInput('s-foreign', NOW)] }))
    assert.equal(errorCode(reply), 'threadline/bad-request')
    // 归属校验只读 header（stat），从未 open 读取事件：不接受任意 sessionId 就能读日志。
    assert.equal(persistence.opens.get('s-foreign'), undefined)
    assert.equal(persistence.opens.get('s-1'), undefined)
    assert.ok((persistence.stats.get('s-foreign') ?? 0) >= 1)
  } finally {
    routes.dispose()
  }
})

test('N-07 归属校验：无法验证的会话（header 读不到）→ bad-request', async () => {
  const persistence = new MockPersistence()
  persistence.add('s-1', simpleSessionEvents('s-1'))
  persistence.fail('s-ghost', namedError('SessionPersistenceNotFoundError', 'missing'), 'stat')
  const routes = makeRoutes(persistence)
  try {
    const reply = await post(routes, 'scan', body({ sessions: [sessionInput('s-1', NOW), sessionInput('s-ghost', NOW)] }))
    assert.equal(errorCode(reply), 'threadline/bad-request')
  } finally {
    routes.dispose()
  }
})

test('N-02 单个会话读取失败：错误码点名、其它会话继续、进度 failed 计数', async () => {
  const persistence = new MockPersistence()
  persistence.add('s-ok', simpleSessionEvents('s-ok'))
  persistence.add('s-bad', simpleSessionEvents('s-bad'))
  persistence.fail('s-bad', namedError('SessionFormatUnsupportedError', 'future format'), 'open')
  const routes = makeRoutes(persistence)
  try {
    const scan = await post(routes, 'scan', body({ sessions: [sessionInput('s-ok', NOW), sessionInput('s-bad', NOW)] }))
    assert.equal(scan.json.ok, true)
    const done = (await waitUntilDone(routes, scan.json.scanId as string)) as unknown as {
      progress: { scanned: number; failed: number; total: number; phase: string }
      errors: Array<{ sessionId: string; code: string }>
      changedSessions: Array<{ id: string }>
    }
    assert.equal(done.progress.total, 2)
    assert.equal(done.progress.scanned, 1)
    assert.equal(done.progress.failed, 1)
    assert.equal(done.progress.phase, 'complete')
    assert.deepEqual(done.errors.map((error) => [error.sessionId, error.code]), [['s-bad', 'threadline/format-unsupported']])
    assert.deepEqual(done.changedSessions.map((session) => session.id), ['s-ok'])
  } finally {
    routes.dispose()
  }
})

test('N-02 损坏日志：session-unreadable（不白屏、不猜成功）', async () => {
  const persistence = new MockPersistence()
  persistence.add('s-bad', simpleSessionEvents('s-bad'))
  persistence.fail('s-bad', namedError('SessionPersistenceCorruptionError', 'corrupted'), 'open')
  const routes = makeRoutes(persistence)
  try {
    const scan = await post(routes, 'scan', body({ sessions: [sessionInput('s-bad', NOW)] }))
    assert.equal(scan.json.ok, true)
    const done = (await waitUntilDone(routes, scan.json.scanId as string)) as unknown as {
      errors: Array<{ code: string }>
      progress: { failed: number }
    }
    assert.equal(done.progress.failed, 1)
    assert.deepEqual(done.errors.map((error) => error.code), ['threadline/session-unreadable'])
  } finally {
    routes.dispose()
  }
})

test('A10-3 detail 错误码：不在扫描集合 → bad-request；格式不支持/损坏/不存在各自 04 §2.6 错误码', async () => {
  const persistence = new MockPersistence()
  persistence.add('s-1', simpleSessionEvents('s-1'))
  persistence.add('s-2', simpleSessionEvents('s-2'))
  const routes = makeRoutes(persistence)
  try {
    const before = await post(routes, 'detail', { sessionId: 's-1' })
    assert.equal(errorCode(before), 'threadline/bad-request') // 还没有扫描

    const scan = await post(routes, 'scan', body({ sessions: [sessionInput('s-1', NOW), sessionInput('s-2', NOW)] }))
    await waitUntilDone(routes, scan.json.scanId as string)

    const notInScan = await post(routes, 'detail', { sessionId: 's-unknown' })
    assert.equal(errorCode(notInScan), 'threadline/bad-request')

    persistence.fail('s-1', namedError('SessionFormatUnsupportedError', 'future'), 'open')
    const unsupported = await post(routes, 'detail', { sessionId: 's-1' })
    assert.equal(errorCode(unsupported), 'threadline/format-unsupported')

    persistence.fail('s-2', namedError('SessionPersistenceNotFoundError', 'gone'), 'open')
    const missing = await post(routes, 'detail', { sessionId: 's-2' })
    assert.equal(errorCode(missing), 'threadline/session-unreadable')

    persistence.fail('s-2', namedError('SessionPersistenceCorruptionError', 'corrupt'), 'open')
    const corrupt = await post(routes, 'detail', { sessionId: 's-2' })
    assert.equal(errorCode(corrupt), 'threadline/session-unreadable')

    // 任意路径 sessionId 在路由层就被拒（不会走到 persistence）。
    const traversal = await post(routes, 'detail', { sessionId: '../../../etc/passwd' })
    assert.equal(errorCode(traversal), 'threadline/bad-request')
  } finally {
    routes.dispose()
  }
})

test('N-04 未知事件不产生假数据：未知事件类型计数后不影响计数与文件', async () => {
  const persistence = new MockPersistence()
  persistence.add('s-1', [
    { type: 'turn/start', seq: 1, time: NOW, data: { turn: 1 } },
    { type: 'brand/new-event', seq: 2, time: NOW + 1, data: { path: 'src/fake.ts' } },
    { type: 'turn/end', seq: 3, time: NOW + 2, data: { turn: 1, reason: { kind: 'completed' } } },
  ])
  const routes = makeRoutes(persistence)
  try {
    const scan = await post(routes, 'scan', body())
    await waitUntilDone(routes, scan.json.scanId as string)
    const detail = await post(routes, 'detail', { sessionId: 's-1' })
    const session = detail.json.session as {
      counts: { turns: number; files: number }
      turns: Array<{ files: unknown[] }>
    }
    assert.equal(session.counts.turns, 1)
    assert.equal(session.counts.files, 0)
    assert.equal(session.turns[0].files.length, 0)
  } finally {
    routes.dispose()
  }
})
