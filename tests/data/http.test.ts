/**
 * 传输层约束（04 §2.2 / §2.7 / §9.3）：只允许同源相对路径、只 POST、错误体不臆造。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DATA_ROUTES,
  DATA_ROUTE_PREFIX,
  failureCode,
  isRetryableFailure,
  isSameOriginRoutePath,
  postJson,
  routePath,
} from '../../src/client/data/http.ts'
import { createFakeFetch } from './fixtures.ts'

test('三条路由都是同源相对路径（无 origin、无协议）', () => {
  for (const [name, path] of Object.entries(DATA_ROUTES)) {
    assert.equal(path.startsWith(DATA_ROUTE_PREFIX), true)
    assert.equal(path.includes('://'), false)
    assert.equal(path.startsWith('//'), false)
    assert.equal(routePath(name as keyof typeof DATA_ROUTES), path)
  }
  assert.equal(isSameOriginRoutePath('/api/other/scan'), false)
  assert.equal(isSameOriginRoutePath('http://127.0.0.1:29346/api/dsh-threadline/scan'), false)
  assert.equal(isSameOriginRoutePath('//evil.example/api/dsh-threadline/scan'), false)
  assert.equal(isSameOriginRoutePath('/api/dsh-threadline/scan'), true)
})

test('postJson 只发 POST + JSON，且 URL 是相对路径', async () => {
  const fake = createFakeFetch()
  fake.on('snapshot', () => ({ ok: true, scanId: 'scan-1', rev: 3, reset: false, done: false }))
  const result = await postJson(fake.fetch, 'snapshot', { scanId: 'scan-1', sinceRev: 0 })
  assert.equal(result.ok, true)
  assert.equal(fake.calls.length, 1)
  assert.equal(fake.calls[0].path, '/api/dsh-threadline/snapshot')
  assert.equal(fake.calls[0].init?.method, 'POST')
  assert.equal(fake.calls[0].init?.headers?.['content-type'], 'application/json')
  assert.deepEqual(JSON.parse(String(fake.calls[0].init?.body)), { scanId: 'scan-1', sinceRev: 0 })
})

test('host 业务错误按 code 归一；未知码不臆造（internal）', async () => {
  const fake = createFakeFetch()
  fake.on('scan', () => ({ ok: false, error: { code: 'threadline/capability-missing', message: 'no persistence' } }))
  const missing = await postJson(fake.fetch, 'scan', {})
  assert.equal(missing.ok, false)
  if (missing.ok) return
  assert.equal(missing.failure.kind, 'route')
  if (missing.failure.kind !== 'route') return
  assert.equal(missing.failure.error.code, 'threadline/capability-missing')

  const fake2 = createFakeFetch()
  fake2.on('scan', () => ({ ok: false, error: { code: 'threadline/not-a-real-code', message: 'x' } }))
  const unknown = await postJson(fake2.fetch, 'scan', {})
  assert.equal(unknown.ok, false)
  if (unknown.ok) return
  assert.equal(unknown.failure.kind, 'route')
  if (unknown.failure.kind !== 'route') return
  assert.equal(unknown.failure.error.code, 'threadline/internal')
})

test('响应不是对象 / JSON 坏 / 缺 ok → malformed（可重试）', async () => {
  const cases = [
    async () => ({ ok: true, status: 200, json: async () => 'nope' }),
    async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('bad json')
      },
    }),
    async () => ({ ok: true, status: 200, json: async () => ({ value: 1 }) }),
  ]
  for (const responder of cases) {
    const result = await postJson(responder, 'snapshot', {})
    assert.equal(result.ok, false)
    if (result.ok) continue
    assert.equal(result.failure.kind, 'malformed')
    assert.equal(isRetryableFailure(result.failure), true)
  }
})

test('fetch 抛错 → network 失败（可重试）；AbortError → aborted（不重试）', async () => {
  const network = await postJson(async () => {
    throw new Error('ECONNREFUSED')
  }, 'scan', {})
  assert.equal(network.ok, false)
  if (!network.ok) {
    assert.equal(network.failure.kind, 'network')
    assert.equal(isRetryableFailure(network.failure), true)
    assert.equal(failureCode(network.failure), 'network')
  }

  const abortError = new Error('aborted')
  abortError.name = 'AbortError'
  const aborted = await postJson(async () => {
    throw abortError
  }, 'scan', {})
  assert.equal(aborted.ok, false)
  if (!aborted.ok) {
    assert.equal(aborted.failure.kind, 'aborted')
    assert.equal(isRetryableFailure(aborted.failure), false)
  }
})

test('业务错误可重试判定：internal 可重试，bad-request 不可重试', async () => {
  const fake = createFakeFetch()
  fake.on('scan', () => ({ ok: false, error: { code: 'threadline/internal', message: 'boom' } }))
  const internal = await postJson(fake.fetch, 'scan', {})
  assert.equal(internal.ok, false)
  if (!internal.ok) assert.equal(isRetryableFailure(internal.failure), true)

  const fake2 = createFakeFetch()
  fake2.on('scan', () => ({ ok: false, error: { code: 'threadline/bad-request', message: 'bad' } }))
  const bad = await postJson(fake2.fetch, 'scan', {})
  assert.equal(bad.ok, false)
  if (!bad.ok) assert.equal(isRetryableFailure(bad.failure), false)
})
