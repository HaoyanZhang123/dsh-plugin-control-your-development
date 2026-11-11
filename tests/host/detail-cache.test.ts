/*
 * tests/host/detail-cache.test.ts —— host 侧「未变更会话不重读日志」的缓存契约（1.5.3 性能）。
 *
 * 真机问题：打开脉络/思维链要等很久（本工作区 304 个日志 / 302.7 MB）。
 * 实测单会话 10.9MB 的耗时：解压 80ms + JSON 解析 142ms + 归约 24ms ≈ 249ms，
 * 其中 **89% 花在解压与解析**，而这两步在"日志没变"时是纯浪费。
 *
 * 现状：`workspace.digests` 已按 `updatedAt` 缓存扫描结果，但 `detailCache` 只在
 * `detailRequest` 路径里用、且 key 只有 `updatedAt`；`readDetail` 每次都 `handle.read(0)` 全量重读。
 *
 * 这条套件守：**同一会话在 updatedAt 未变时，第二次 detail 请求不得再打开/读取日志**。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRoutes } from '../../src/host/routes.ts'
import type { PersistenceLike, SessionHandleLike } from '../../src/host/services.ts'
import type { SessionEventLike, SessionHeaderLite } from '../../src/shared/events/index.ts'

const CWD = 'E:\\DSH\\workspaces\\perf-demo'
const NOW = 1_700_000_000_000

function header(id: string): SessionHeaderLite {
  return { id, createdAt: NOW - 10_000, cwd: CWD }
}

/** 造一份"够大"的事件序列（不追求语义，只要能归约）。 */
function eventsFor(id: string, turns: number): SessionEventLike[] {
  const out: SessionEventLike[] = []
  for (let n = 1; n <= turns; n += 1) {
    const at = NOW - 10_000 + n * 100
    out.push({ type: 'turn/start', seq: out.length, time: at, data: { turn: n } } as SessionEventLike)
    out.push({
      type: 'assistant/message',
      seq: out.length,
      time: at + 10,
      data: {
        turn: n,
        message: { id: id + '-m' + String(n), content: [{ type: 'reasoning', text: 'thinking ' + String(n) }] },
        usage: { reasoningTokens: 10, totalTokens: 100 },
      },
    } as SessionEventLike)
    out.push({
      type: 'tool/call',
      seq: out.length,
      time: at + 20,
      data: { turn: n, callId: id + '-c' + String(n), name: 'read', args: { file_path: 'src/a.ts' } },
    } as SessionEventLike)
    out.push({ type: 'tool/result', seq: out.length, time: at + 30, data: { turn: n, callId: id + '-c' + String(n) } } as SessionEventLike)
    out.push({ type: 'turn/end', seq: out.length, time: at + 40, data: { turn: n, reason: { kind: 'completed' } } } as SessionEventLike)
  }
  return out
}

/** 计数用的假 persistence：记录 open / read 次数。 */
function makePersistence(ids: readonly string[]): {
  persistence: PersistenceLike
  opens: Map<string, number>
  reads: Map<string, number>
} {
  const opens = new Map<string, number>()
  const reads = new Map<string, number>()
  const store = new Map<string, { header: SessionHeaderLite; events: SessionEventLike[] }>()
  for (const id of ids) store.set(id, { header: header(id), events: eventsFor(id, 20) })

  const persistence: PersistenceLike = {
    async open(id: string): Promise<SessionHandleLike> {
      opens.set(id, (opens.get(id) ?? 0) + 1)
      const session = store.get(id)
      if (session === undefined) throw new Error('missing ' + id)
      return {
        header: session.header,
        read: async () => {
          reads.set(id, (reads.get(id) ?? 0) + 1)
          return { eventState: 'detached', events: session.events.slice() }
        },
        close: async () => {},
      }
    },
    async stat(id: string) {
      const session = store.get(id)
      if (session === undefined) throw new Error('missing ' + id)
      return { header: session.header }
    },
  }
  return { persistence, opens, reads }
}

function post(path: string, body: unknown): Request {
  return new Request('http://local' + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

test('同一会话、updatedAt 未变：第二次 /detail 不得再读日志（缓存命中）', async () => {
  const { persistence, opens, reads } = makePersistence(['s-1'])
  const routes = createRoutes({ getPersistence: () => persistence, getSessionQuery: () => undefined })

  const first = await routes.invoke('detail', post('/detail', { sessionId: 's-1', cwd: CWD, updatedAt: NOW }))
  const firstJson = (await first.json()) as { ok: boolean }
  assert.equal(firstJson.ok, true, '第一次必须成功')
  assert.equal(reads.get('s-1'), 1, '第一次应读一次日志')

  const second = await routes.invoke('detail', post('/detail', { sessionId: 's-1', cwd: CWD, updatedAt: NOW }))
  const secondJson = (await second.json()) as { ok: boolean }
  assert.equal(secondJson.ok, true, '第二次必须成功')
  assert.equal(
    reads.get('s-1'),
    1,
    '第二次**不得**再读日志（这就是首屏慢的根因：每次都全量重读）',
  )
  void opens
})

test('updatedAt 变化：必须重读（不能拿旧数据冒充新数据）', async () => {
  const { persistence, reads } = makePersistence(['s-1'])
  const routes = createRoutes({ getPersistence: () => persistence, getSessionQuery: () => undefined })

  await routes.invoke('detail', post('/detail', { sessionId: 's-1', cwd: CWD, updatedAt: NOW }))
  assert.equal(reads.get('s-1'), 1)

  await routes.invoke('detail', post('/detail', { sessionId: 's-1', cwd: CWD, updatedAt: NOW + 5000 }))
  assert.equal(reads.get('s-1'), 2, 'updatedAt 变化必须重读，否则会显示过期数据')
})

test('不同会话互不串缓存', async () => {
  const { persistence, reads } = makePersistence(['s-1', 's-2'])
  const routes = createRoutes({ getPersistence: () => persistence, getSessionQuery: () => undefined })

  await routes.invoke('detail', post('/detail', { sessionId: 's-1', cwd: CWD, updatedAt: NOW }))
  await routes.invoke('detail', post('/detail', { sessionId: 's-2', cwd: CWD, updatedAt: NOW }))
  assert.equal(reads.get('s-1'), 1)
  assert.equal(reads.get('s-2'), 1, '不同会话必须各自读一次')
})

test('客户端没给 updatedAt 时仍可用（退回"每次都读"，不假装命中）', async () => {
  const { persistence, reads } = makePersistence(['s-1'])
  const routes = createRoutes({ getPersistence: () => persistence, getSessionQuery: () => undefined })
  await routes.invoke('detail', post('/detail', { sessionId: 's-1', cwd: CWD }))
  await routes.invoke('detail', post('/detail', { sessionId: 's-1', cwd: CWD }))
  assert.equal(reads.get('s-1'), 2, '没有 updatedAt 就无法判断是否过期，必须每次都读（不伪造命中）')
})
