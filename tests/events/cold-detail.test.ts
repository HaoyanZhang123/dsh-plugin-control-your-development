/**
 * T13e · detail 冷读（不依赖 /scan 生命周期）。
 *
 * 真机现象：没开过「脉络」tab → 没有 lastScan → 点每轮影响/执行 /threadline 时 detail 必失败。
 * 修法：detail 请求可带 `cwd`，host 用 header 自证归属后直接冷读；不带 cwd 的老客户端行为不变。
 *
 * 覆盖：
 * 1) 无 scan + 正确 cwd → ok，detail.id === sessionId（大小写/分隔符变体也算命中）
 * 2) 无 scan + cwd 不匹配 → bad-request，且**只读 header、不 open 正文**
 * 3) 无 scan + 无 cwd → bad-request（老客户端不变）
 * 4) 子会话：本身 cwd 不同、父会话 cwd 匹配 → ok 且如实标 partial
 * 5) 子会话父 header 读不到 → bad-request（无法验证就不放行）
 * 6) 冷读错误码沿用 04 §2.6（格式不支持 / 不存在）
 * 7) 有 scan 但会话不在集合内 + 带 cwd → 冷读成功
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRoutes, validateDetailRequest } from '../../src/host/routes.ts'
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

test('T13e 无 scan + 正确 cwd：冷读成功，detail.id === sessionId（含大小写/分隔符变体）', async () => {
  const persistence = new MockPersistence()
  persistence.add('s-cold', simpleSessionEvents('s-cold'), makeHeader('s-cold', { cwd: CWD }))
  const routes = makeRoutes(persistence)
  try {
    const reply = await post(routes, 'detail', { sessionId: 's-cold', cwd: CWD })
    assert.equal(reply.json.ok, true, JSON.stringify(reply.json))
    const session = reply.json.session as {
      id: string
      cwd: string
      partial?: boolean
      counts: { turns: number }
      turns: Array<{ n: number }>
    }
    assert.equal(session.id, 's-cold')
    assert.equal(session.counts.turns, 1)
    assert.equal(session.turns[0].n, 1)
    // 直属会话：header.cwd 直接命中，不编造 partial。
    assert.equal(session.partial, undefined)

    // Windows 大小写/分隔符变体也应命中（sameWorkspaceCwd 归一化）。
    const variant = await post(routes, 'detail', {
      sessionId: 's-cold',
      cwd: CWD.replace(/\\/g, '/').toLowerCase(),
    })
    assert.equal(variant.json.ok, true)
    assert.equal((variant.json.session as { id: string }).id, 's-cold')
  } finally {
    routes.dispose()
  }
})

test('T13e 无 scan + cwd 不匹配：bad-request，且只读 header（从未 open 正文）', async () => {
  const persistence = new MockPersistence()
  persistence.add('s-foreign', simpleSessionEvents('s-foreign'), makeHeader('s-foreign', { cwd: 'E:\\elsewhere\\proj' }))
  const routes = makeRoutes(persistence)
  try {
    const reply = await post(routes, 'detail', { sessionId: 's-foreign', cwd: CWD })
    assert.equal(errorCode(reply), 'threadline/bad-request')
    // 安全：不匹配时只 stat 了 header，没有 open 读事件。
    assert.equal(persistence.opens.get('s-foreign'), undefined)
    assert.ok((persistence.stats.get('s-foreign') ?? 0) >= 1)
  } finally {
    routes.dispose()
  }
})

test('T13e 无 scan + 无 cwd：bad-request（老客户端行为不变，消息写清原因）', async () => {
  const persistence = new MockPersistence()
  persistence.add('s-cold', simpleSessionEvents('s-cold'), makeHeader('s-cold', { cwd: CWD }))
  const routes = makeRoutes(persistence)
  try {
    const reply = await post(routes, 'detail', { sessionId: 's-cold' })
    assert.equal(errorCode(reply), 'threadline/bad-request')
    const message = (reply.json.error as { message: string }).message
    assert.ok(message.includes('no scan'), message)
    assert.equal(persistence.opens.get('s-cold'), undefined)
  } finally {
    routes.dispose()
  }
})

test('T13e 子会话冷读：本身 cwd 不同但父会话 cwd 匹配 → ok 且如实标 partial', async () => {
  const persistence = new MockPersistence()
  persistence.add('s-parent', simpleSessionEvents('s-parent'), makeHeader('s-parent', { cwd: CWD }))
  persistence.add(
    's-child',
    simpleSessionEvents('s-child'),
    makeHeader('s-child', { cwd: 'E:\\other\\project', parentSession: 's-parent', origin: 'subagent' }),
  )
  const routes = makeRoutes(persistence)
  try {
    const reply = await post(routes, 'detail', { sessionId: 's-child', cwd: CWD })
    assert.equal(reply.json.ok, true, JSON.stringify(reply.json))
    const session = reply.json.session as { id: string; parentId?: string; partial?: boolean; counts: { turns: number } }
    assert.equal(session.id, 's-child')
    assert.equal(session.parentId, 's-parent')
    assert.equal(session.partial, true) // 子会话上下文不完整 → 不冒充完整扫描上下文
    assert.equal(session.counts.turns, 1)
  } finally {
    routes.dispose()
  }
})

test('T13e 子会话父 header 读不到：bad-request（不能验证就不放行）', async () => {
  const persistence = new MockPersistence()
  persistence.add(
    's-orphan',
    simpleSessionEvents('s-orphan'),
    makeHeader('s-orphan', { cwd: 'E:\\somewhere\\else', parentSession: 's-missing-parent' }),
  )
  const routes = makeRoutes(persistence)
  try {
    const reply = await post(routes, 'detail', { sessionId: 's-orphan', cwd: CWD })
    assert.equal(errorCode(reply), 'threadline/bad-request')
    assert.equal(persistence.opens.get('s-orphan'), undefined)
  } finally {
    routes.dispose()
  }
})

test('T13e 冷读错误码：格式不支持 → format-unsupported；header 读不到 → session-unreadable', async () => {
  const persistence = new MockPersistence()
  persistence.add('s-bad', simpleSessionEvents('s-bad'), makeHeader('s-bad', { cwd: CWD }))
  persistence.fail('s-bad', namedError('SessionFormatUnsupportedError', 'future format'))
  const routes = makeRoutes(persistence)
  try {
    const unsupported = await post(routes, 'detail', { sessionId: 's-bad', cwd: CWD })
    assert.equal(errorCode(unsupported), 'threadline/format-unsupported')

    const missing = await post(routes, 'detail', { sessionId: 's-ghost', cwd: CWD })
    assert.equal(errorCode(missing), 'threadline/session-unreadable')
  } finally {
    routes.dispose()
  }
})

test('T13e 有 scan 但会话不在集合内 + 带 cwd：走冷读；不带 cwd 仍按旧行为拒绝', async () => {
  const persistence = new MockPersistence()
  persistence.add('s-1', simpleSessionEvents('s-1'))
  persistence.add('s-outside', simpleSessionEvents('s-outside'))
  const routes = makeRoutes(persistence)
  try {
    const scan = await post(routes, 'scan', {
      workspaceId: 'ws-cold',
      cwd: CWD,
      generation: 1,
      sessions: [sessionInput('s-1', NOW)],
    })
    assert.equal(scan.json.ok, true)
    await waitUntilDone(routes, scan.json.scanId as string)

    const withCwd = await post(routes, 'detail', { sessionId: 's-outside', cwd: CWD })
    assert.equal(withCwd.json.ok, true, JSON.stringify(withCwd.json))
    assert.equal((withCwd.json.session as { id: string }).id, 's-outside')

    const withoutCwd = await post(routes, 'detail', { sessionId: 's-outside' })
    assert.equal(errorCode(withoutCwd), 'threadline/bad-request')
    assert.ok(((withoutCwd.json.error as { message: string }).message).includes('not in the current scan'))
  } finally {
    routes.dispose()
  }
})

test('T13e 路由校验：可选 cwd 与 scan 同规则（非空/绝对路径/长度上限/类型）', () => {
  assert.equal(validateDetailRequest({ sessionId: 's-1' }).ok, true) // 不带 cwd 仍合法
  assert.equal(validateDetailRequest({ sessionId: 's-1', cwd: CWD }).ok, true)
  assert.equal(validateDetailRequest({ sessionId: 's-1', cwd: CWD.replace(/\\/g, '/') }).ok, true)
  for (const cwd of ['', '   ', 'relative/path', 'C:\\ok\\..\\ok'.repeat(1) + '\\' + 'a'.repeat(5000), 123]) {
    assert.equal(validateDetailRequest({ sessionId: 's-1', cwd }).ok, false, String(cwd).slice(0, 40))
  }
})
