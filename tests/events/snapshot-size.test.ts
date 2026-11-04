/**
 * A10-4 快照大小/重置/截断（06 §5）：合成 5000+ 文件、20000 边。
 *
 * 判据：
 * - 每个响应 JSON 字节数 ≤ 8MB（另用注入的 256KB 上限验证裁剪路径本身）；
 * - 超限必须标 `truncated`，不能静默丢；
 * - reset 语义正确；被裁掉的页能在同一 rev 内续读补齐（不丢数据）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRoutes } from '../../src/host/routes.ts'
import { ScanManager } from '../../src/host/scan.ts'
import type { HostServices } from '../../src/host/services.ts'
import type { SessionEventLike } from '../../src/shared/events/index.ts'
import { CWD, MockPersistence, makeHeader, sessionInput, toolCall, toolResult, turnEnd, turnStart } from './fixtures.ts'
import { post, waitUntilDone } from './harness.ts'

const NOW = 1_700_000_000_000
const MB8 = 8 * 1024 * 1024
const FILES_PER_TURN = 12
const TURNS = 420
const EXPECTED_FILES = FILES_PER_TURN * TURNS // 5040
const EXPECTED_EDGES = 20_000 // 04 §4.4 上限（原始 420×66=27720 对，按权重取 top）

/** 长路径：确保 20000 条边的 JSON 真的超过 8MB（而不是"看起来很大"）。 */
function filePath(turn: number, index: number): string {
  return `src/${'nested-'.repeat(8)}t${turn}/${'b'.repeat(48)}/file-${index}-${'c'.repeat(40)}.ts`
}

function buildEvents(turns: number, filesPerTurn: number): SessionEventLike[] {
  const events: SessionEventLike[] = []
  for (let turn = 1; turn <= turns; turn += 1) {
    const base = NOW + turn * 100
    events.push(turnStart(turn, base))
    for (let index = 0; index < filesPerTurn; index += 1) {
      const callId = `call-${turn}-${index}`
      events.push(toolCall(callId, 'read', { file_path: filePath(turn, index) }, turn, base + index * 2 + 1))
      events.push(toolResult(callId, turn, base + index * 2 + 2, { meta: { lines: [], totalLines: 2 } }))
    }
    events.push(turnEnd(turn, 'completed', base + 90))
  }
  return events
}

function bigSessionEvents(): SessionEventLike[] {
  return buildEvents(TURNS, FILES_PER_TURN)
}

function servicesWith(persistence: MockPersistence): HostServices {
  return { getPersistence: () => persistence, getSessionQuery: () => undefined }
}

async function runScan(responseBytes?: number, turns = TURNS, filesPerTurn = FILES_PER_TURN) {
  const persistence = new MockPersistence()
  persistence.add('s-size', buildEvents(turns, filesPerTurn), makeHeader('s-size', { cwd: CWD }))
  const services = servicesWith(persistence)
  const manager = new ScanManager(services, {
    now: () => NOW,
    yield: () => Promise.resolve(),
    ...(responseBytes === undefined ? {} : { responseBytes }),
  })
  const routes = createRoutes(services, manager)
  const scan = await post(routes, 'scan', {
    workspaceId: 'ws-size',
    cwd: CWD,
    generation: 1,
    sessions: [sessionInput('s-size', NOW + turns * 100)],
  })
  assert.equal(scan.json.ok, true)
  const scanId = scan.json.scanId as string
  const done = await waitUntilDone(routes, scanId)
  return { routes, scanId, done }
}

test('A10-4 8MB 上限：5000+ 文件 / 20000 边，单包 ≤8MB 且标 truncated，续页可补齐', async () => {
  const { routes, scanId, done } = await runScan()
  try {
    const progress = done.progress as { total: number; scanned: number; phase: string }
    assert.equal(progress.total, 1)
    assert.equal(progress.scanned, 1)
    assert.equal(progress.phase, 'complete')
    assert.equal(done.done, true)

    // 首包：reset 全量，必然被 8MB 裁剪。
    const first = await post(routes, 'snapshot', { scanId, sinceRev: 0 })
    assert.equal(first.json.ok, true)
    assert.ok(first.bytes <= MB8, `first page ${first.bytes} bytes > 8MB`)
    const firstSnap = first.json as unknown as {
      reset: boolean
      truncated?: boolean
      rev: number
      changedFiles: Array<{ path: string }>
      changedEdges: Array<{ from: string; to: string }>
      changedSessions: Array<{ id: string; files: number }>
    }
    assert.equal(firstSnap.reset, true)
    assert.equal(firstSnap.truncated, true)
    assert.equal(firstSnap.changedSessions[0].files, EXPECTED_FILES)

    // 续页：同一 rev 内继续，reset=false（按 id/path 合并，不清空），直到补齐。
    const files = new Set(firstSnap.changedFiles.map((file) => file.path))
    const edges = new Set(firstSnap.changedEdges.map((edge) => `${edge.from}\u0000${edge.to}`))
    let pages = 1
    let reply = first
    while ((reply.json as { truncated?: boolean }).truncated === true) {
      pages += 1
      assert.ok(pages <= 40, 'too many pages; truncation cursor may be stuck')
      const next = await post(routes, 'snapshot', { scanId, sinceRev: firstSnap.rev })
      assert.ok(next.bytes <= MB8, `page ${pages} ${next.bytes} bytes > 8MB`)
      const page = next.json as unknown as {
        reset: boolean
        truncated?: boolean
        changedFiles: Array<{ path: string }>
        changedEdges: Array<{ from: string; to: string }>
      }
      assert.equal(page.reset, false)
      for (const file of page.changedFiles) files.add(file.path)
      for (const edge of page.changedEdges) edges.add(`${edge.from}\u0000${edge.to}`)
      reply = next
    }
    // 原始 420×66=27720 对 → 按权重 top 20000（04 §4.4）。
    assert.equal(edges.size, EXPECTED_EDGES)
    assert.equal(files.size, EXPECTED_FILES)
    assert.equal(pages >= 2, true, '8MB 必被裁，应该至少有两页')

    // 续页补齐后游标已清空：同一个 rev 再拉就是空增量（reset=false）。
    const tail = await post(routes, 'snapshot', { scanId, sinceRev: firstSnap.rev })
    const tailSnap = tail.json as unknown as { reset: boolean; done: boolean; changedFiles: unknown[]; changedEdges: unknown[] }
    assert.equal(tailSnap.reset, false)
    assert.equal(tailSnap.done, true)
    assert.equal(tailSnap.changedFiles.length, 0)
    assert.equal(tailSnap.changedEdges.length, 0)

    // reset 语义：sinceRev=0 永远是 reset 全量（并重新开始分页）。
    const againFull = await post(routes, 'snapshot', { scanId, sinceRev: 0 })
    assert.equal((againFull.json as { reset: boolean }).reset, true)
    assert.equal((againFull.json as { truncated?: boolean }).truncated, true)
    assert.ok(againFull.bytes <= MB8)
  } finally {
    routes.dispose()
  }
})

test('A10-4 注入 256KB 上限：裁剪路径本身正确（每包 ≤ cap、truncated 明确、续页补齐）', async () => {
  const cap = 256 * 1024
  const { routes, scanId } = await runScan(cap, 60, 6) // 360 文件 / 900 边
  try {
    const first = await post(routes, 'snapshot', { scanId, sinceRev: 0 })
    assert.ok(first.bytes <= cap, `first page ${first.bytes} > cap ${cap}`)
    const firstSnap = first.json as unknown as {
      reset: boolean
      truncated?: boolean
      rev: number
      changedFiles: Array<{ path: string }>
      changedEdges: Array<{ from: string; to: string }>
    }
    assert.equal(firstSnap.reset, true)
    assert.equal(firstSnap.truncated, true)

    const files = new Set(firstSnap.changedFiles.map((file) => file.path))
    const edges = new Set(firstSnap.changedEdges.map((edge) => `${edge.from}\u0000${edge.to}`))
    let truncated: boolean | undefined = firstSnap.truncated
    let pages = 1
    while (truncated === true) {
      pages += 1
      assert.ok(pages <= 40, 'too many pages')
      const next = await post(routes, 'snapshot', { scanId, sinceRev: firstSnap.rev })
      assert.ok(next.bytes <= cap, `page ${pages} ${next.bytes} > cap ${cap}`)
      const page = next.json as unknown as {
        truncated?: boolean
        changedFiles: Array<{ path: string }>
        changedEdges: Array<{ from: string; to: string }>
      }
      for (const file of page.changedFiles) files.add(file.path)
      for (const edge of page.changedEdges) edges.add(`${edge.from}\u0000${edge.to}`)
      truncated = page.truncated
    }
    assert.equal(files.size, 360)
    // 60 轮 × 6 文件 = C(6,2)=15 对/轮 → 900 条唯一边。
    assert.equal(edges.size, 900)
  } finally {
    routes.dispose()
  }
})

test('A10-4 空工作区也能 reset（不画假图：0 文件 0 边，done 立刻为真）', async () => {
  const persistence = new MockPersistence()
  const services = servicesWith(persistence)
  const manager = new ScanManager(services, { now: () => NOW, yield: () => Promise.resolve() })
  const routes = createRoutes(services, manager)
  try {
    const scan = await post(routes, 'scan', { workspaceId: 'ws-empty', cwd: CWD, generation: 1, sessions: [] })
    assert.equal(scan.json.ok, true)
    assert.equal(scan.json.total, 0)
    const scanId = scan.json.scanId as string
    const done = await waitUntilDone(routes, scanId)
    const full = await post(routes, 'snapshot', { scanId, sinceRev: 0 })
    const snap = full.json as unknown as {
      reset: boolean
      done: boolean
      changedSessions: unknown[]
      changedFiles: unknown[]
      changedEdges: unknown[]
      truncated?: boolean
    }
    assert.equal(snap.reset, true)
    assert.equal(snap.done, true)
    assert.equal(snap.changedSessions.length, 0)
    assert.equal(snap.changedFiles.length, 0)
    assert.equal(snap.changedEdges.length, 0)
    assert.equal(snap.truncated, undefined)
    assert.equal((done.progress as { total: number }).total, 0)
    assert.equal((done.progress as { scanned: number }).scanned, 0)
  } finally {
    routes.dispose()
  }
})

test('bigSessionEvents 夹具自检：420 轮 × 12 文件 = 5040 个不同文件（防止夹具"空绿"）', () => {
  const events = bigSessionEvents()
  const paths = new Set<string>()
  for (const event of events) {
    if (event.type !== 'tool/call') continue
    const args = JSON.parse((event.data as { arguments: string }).arguments) as { file_path: string }
    paths.add(args.file_path)
  }
  assert.equal(paths.size, EXPECTED_FILES)
  assert.equal(events.length, TURNS * (2 + FILES_PER_TURN * 2))
})
