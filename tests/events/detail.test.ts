/**
 * A10-5 detail 单测（06 §5）：messageId→turn、finalMessageId、LRU 20、refresh 生效。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRoutes } from '../../src/host/routes.ts'
import { ScanManager } from '../../src/host/scan.ts'
import type { HostServices } from '../../src/host/services.ts'
import type { SessionEventLike } from '../../src/shared/events/index.ts'
import {
  CWD,
  MockPersistence,
  assistantMessage,
  ev,
  makeHeader,
  sessionInput,
  toolCall,
  toolResult,
  turnEnd,
  turnStart,
  userMessage,
} from './fixtures.ts'
import { post, waitUntilDone } from './harness.ts'

const NOW = 1_700_000_000_000

function twoTurnEvents(id: string, base = NOW): SessionEventLike[] {
  return [
    turnStart(1, base),
    userMessage(`看看 ${id}`, base + 1),
    assistantMessage(`${id}-m1`, 1, 1, base + 2),
    toolCall(`call-${id}-1`, 'read', { file_path: 'src/shared.ts' }, 1, base + 3),
    toolResult(`call-${id}-1`, 1, base + 4, { meta: { lines: [], totalLines: 3 } }),
    turnEnd(1, 'completed', base + 5),
    turnStart(2, base + 6),
    assistantMessage(`${id}-m2`, 2, 2, base + 7),
    turnEnd(2, 'completed', base + 8),
  ]
}

function servicesWith(persistence: MockPersistence): HostServices {
  return { getPersistence: () => persistence, getSessionQuery: () => undefined }
}

function buildPersistence(count = 21): MockPersistence {
  const persistence = new MockPersistence()
  for (let index = 0; index < count; index += 1) {
    const id = `s-${index}`
    // s-1 是 s-0 的子智能体（header.parentSession），用于 detail.subagents。
    const header =
      index === 1
        ? makeHeader(id, { parentSession: 's-0', origin: 'subagent' })
        : makeHeader(id, { createdAt: NOW - index, cwd: CWD })
    persistence.add(id, twoTurnEvents(id), header)
  }
  return persistence
}

function scanBody(ids: string[]): Record<string, unknown> {
  return {
    workspaceId: 'ws-detail',
    cwd: CWD,
    generation: 1,
    sessions: ids.map((id, index) => sessionInput(id, NOW - index, index === 1 ? { parentId: 's-0', origin: 'subagent' } : {})),
  }
}

test('A10-5 messageId→turn 与 finalMessageId、子智能体归属', async () => {
  const persistence = buildPersistence(3)
  const services = servicesWith(persistence)
  const manager = new ScanManager(services, { now: () => NOW, yield: () => Promise.resolve() })
  const routes = createRoutes(services, manager)
  try {
    const scan = await post(routes, 'scan', scanBody(['s-0', 's-1', 's-2']))
    await waitUntilDone(routes, scan.json.scanId as string)

    const reply = await post(routes, 'detail', { sessionId: 's-0' })
    const session = reply.json.session as {
      id: string
      rootId: string
      messageTurns: Record<string, number>
      turns: Array<{
        n: number
        finalMessageId?: string
        messageIds: string[]
        userText?: string
        status: string
      }>
      subagents: Array<{ id: string; title?: string }>
      counts: { turns: number; files: number }
    }
    assert.equal(session.id, 's-0')
    assert.equal(session.rootId, 's-0')
    assert.deepEqual(session.messageTurns, { 's-0-m1': 1, 's-0-m2': 2 })
    assert.equal(session.turns[0].n, 1)
    assert.deepEqual(session.turns[0].messageIds, ['s-0-m1'])
    assert.equal(session.turns[0].finalMessageId, 's-0-m1')
    assert.deepEqual(session.turns[1].messageIds, ['s-0-m2'])
    assert.equal(session.turns[1].finalMessageId, 's-0-m2')
    assert.equal(session.turns[0].userText, '看看 s-0')
    assert.deepEqual(session.subagents.map((child) => child.id), ['s-1'])
    assert.equal(session.counts.turns, 2)
    assert.equal(session.counts.files, 1)

    // 子会话的 rootId 归到父会话（工作线），不因 cwd 相同就混淆。
    const child = await post(routes, 'detail', { sessionId: 's-1' })
    assert.equal((child.json.session as { rootId: string }).rootId, 's-0')
  } finally {
    routes.dispose()
  }
})

test('A10-5 LRU 20：第 21 个详情请求淘汰最久未用；refresh 强制重读', async () => {
  const persistence = buildPersistence(21)
  const services = servicesWith(persistence)
  const manager = new ScanManager(services, { now: () => NOW, yield: () => Promise.resolve() })
  const routes = createRoutes(services, manager)
  try {
    const ids = Array.from({ length: 21 }, (_, index) => `s-${index}`)
    const scan = await post(routes, 'scan', scanBody(ids))
    await waitUntilDone(routes, scan.json.scanId as string)

    // 扫描各读一次；此后每个 detail 命中缓存不再 open。
    for (const id of ids) {
      assert.equal(persistence.opens.get(id), 1)
      const reply = await post(routes, 'detail', { sessionId: id })
      assert.equal(reply.json.ok, true)
      assert.equal(persistence.opens.get(id), 2, `first detail should open ${id}`)
    }
    // 再请求一次最久未用的 s-0：已被第 21 条挤出缓存 → 重新 open。
    const oldest = await post(routes, 'detail', { sessionId: 's-0' })
    assert.equal(oldest.json.ok, true)
    assert.equal(persistence.opens.get('s-0'), 3)
    // 最近用过的 s-20 仍在缓存 → 不重读。
    const newest = await post(routes, 'detail', { sessionId: 's-20' })
    assert.equal(newest.json.ok, true)
    assert.equal(persistence.opens.get('s-20'), 2)
    // refresh=true 强制重读（即使 updatedAt 未变）。
    const refreshed = await post(routes, 'detail', { sessionId: 's-20', refresh: true })
    assert.equal(refreshed.json.ok, true)
    assert.equal(persistence.opens.get('s-20'), 3)
  } finally {
    routes.dispose()
  }
})

test('A10-5 updatedAt 变化：重新扫描后 detail 缓存失效并读到新事件', async () => {
  const persistence = buildPersistence(2)
  const services = servicesWith(persistence)
  const manager = new ScanManager(services, { now: () => NOW, yield: () => Promise.resolve() })
  const routes = createRoutes(services, manager)
  try {
    const first = await post(routes, 'scan', scanBody(['s-0', 's-1']))
    await waitUntilDone(routes, first.json.scanId as string)
    await post(routes, 'detail', { sessionId: 's-0' })
    assert.equal(persistence.opens.get('s-0'), 2)

    // 追加一条更晚的 assistant 消息 → 记录里的 updatedAt 变新。
    const session = persistence.sessions.get('s-0')
    assert.ok(session !== undefined)
    session.events = [
      ...session.events,
      ev('assistant/message', { turn: 2, step: 1, message: { id: 's-0-m3', role: 'assistant', content: [{ type: 'text', text: 'new' }] } }, NOW + 1000),
    ]
    const second = await post(routes, 'scan', {
      ...scanBody(['s-0', 's-1']),
      generation: 2,
      sessions: [sessionInput('s-0', NOW + 2000), sessionInput('s-1', NOW - 1)],
    })
    await waitUntilDone(routes, second.json.scanId as string)

    const detail = await post(routes, 'detail', { sessionId: 's-0' })
    const updated = detail.json.session as { messageTurns: Record<string, number>; updatedAt: number }
    assert.equal(updated.messageTurns['s-0-m3'], 2)
    assert.equal(updated.updatedAt, NOW + 1000)
    // 重新扫描（updatedAt 变新 → 重读一次）+ detail（缓存失效 → 再读一次）= 4。
    assert.equal(persistence.opens.get('s-0'), 4)
  } finally {
    routes.dispose()
  }
})

test('A10-5 运行中会话：detail 标 partial + running（不伪造完整）', async () => {
  const persistence = new MockPersistence()
  persistence.add('s-live', [
    turnStart(1, NOW),
    assistantMessage('s-live-m1', 1, 1, NOW + 1),
    toolCall('call-live', 'read', { file_path: 'src/a.ts' }, 1, NOW + 2),
  ])
  const services = servicesWith(persistence)
  const manager = new ScanManager(services, { now: () => NOW, yield: () => Promise.resolve() })
  const routes = createRoutes(services, manager)
  try {
    const scan = await post(routes, 'scan', {
      workspaceId: 'ws-live',
      cwd: CWD,
      generation: 1,
      sessions: [sessionInput('s-live', NOW, { running: true })],
    })
    await waitUntilDone(routes, scan.json.scanId as string)
    const reply = await post(routes, 'detail', { sessionId: 's-live' })
    const session = reply.json.session as {
      partial?: boolean
      running?: boolean
      status: string
      turns: Array<{ status: string; end?: number }>
    }
    assert.equal(session.partial, true)
    assert.equal(session.running, true)
    assert.equal(session.status, 'running')
    assert.equal(session.turns[0].status, 'running')
    assert.equal(session.turns[0].end, undefined)
  } finally {
    routes.dispose()
  }
})
