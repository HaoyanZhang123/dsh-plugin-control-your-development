/**
 * T30 · 数据层契约的**宿主传输**验证（33 §4/§5/§6）。
 *
 * 只验证两件事实，都走真实路由（`POST /scan` → `/snapshot` → `/detail`，假 persistence，不读真日志）：
 * 1. `TurnDetail.deleteCommands` 是可选的删除命令计数：reducer 算出来 → host 序列化 → 客户端解析后仍在；
 *    没有删除命令的轮次**不带这个字段**（缺省 = 0/不可知，不伪造）。
 * 2. `FileNode.family` 走新 5 类（text/code/data/media/other），旧 6 类取值（doc/image/config）在线上包里 0 出现。
 *
 * 反例口径：删除命令**不产生文件节点、不归属路径**——`rm -rf dist` 不能在快照里变出 `dist` 节点。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { familyOf } from '../../src/shared/events/index.ts'
import type { FileFamily, SessionEventLike, SessionHeaderLite } from '../../src/shared/events/index.ts'
import { NOW, CWD, FakePersistence, runScanPipeline } from './fixtures.ts'

/** 合成事件（形状与 rc.5 一致：`tool/call.arguments` 是 JSON 字符串）。 */
function ev(type: string, data: Record<string, unknown>, time: number): SessionEventLike {
  return { type, time, data }
}

function toolCall(callId: string, name: string, args: Record<string, unknown>, turn: number, time: number): SessionEventLike {
  return ev('tool/call', { turn, step: 1, callId, name, arguments: JSON.stringify(args) }, time)
}

function toolResult(callId: string, turn: number, time: number): SessionEventLike {
  return ev(
    'tool/result',
    {
      turn,
      step: 1,
      message: {
        id: 'r-' + callId,
        role: 'tool',
        isError: false,
        toolCallId: callId,
        source: { kind: 'tool', callId },
        content: [{ type: 'text', text: 'ok' }],
      },
    },
    time,
  )
}

const ONLY_FAMILIES: readonly FileFamily[] = ['text', 'code', 'data', 'media', 'other']

/** 一轮：删除命令 + 各种后缀的文件操作（验证 family 走新 5 类）。 */
function deleteTurnEvents(base: number): SessionEventLike[] {
  return [
    ev('turn/start', { turn: 1 }, base),
    toolCall('d-html', 'read', { file_path: 'public/index.html' }, 1, base + 1),
    toolResult('d-html', 1, base + 2),
    toolCall('d-css', 'write', { file_path: 'styles/site.css', content: 'a\nb\n' }, 1, base + 3),
    toolResult('d-css', 1, base + 4),
    toolCall('d-mp4', 'read', { file_path: 'assets/demo.mp4' }, 1, base + 5),
    toolResult('d-mp4', 1, base + 6),
    toolCall('d-dot', 'read', { file_path: '.gitignore' }, 1, base + 7),
    toolResult('d-dot', 1, base + 8),
    toolCall('d-json', 'read', { file_path: 'data/report.json' }, 1, base + 9),
    toolResult('d-json', 1, base + 10),
    toolCall('d-rm', 'bash', { command: 'rm -rf dist' }, 1, base + 11),
    toolResult('d-rm', 1, base + 12),
    ev('turn/end', { turn: 1, reason: { kind: 'completed' } }, base + 13),
  ]
}

/** 第二轮：只有普通命令 → 不得带 deleteCommands。 */
function plainTurnEvents(base: number): SessionEventLike[] {
  return [
    ev('turn/start', { turn: 2 }, base),
    toolCall('p-test', 'bash', { command: 'pnpm test' }, 2, base + 1),
    toolResult('p-test', 2, base + 2),
    ev('turn/end', { turn: 2, reason: { kind: 'completed' } }, base + 3),
  ]
}

function buildDeleteFixture(): { persistence: FakePersistence; sessions: Array<{ id: string; updatedAt: number; running: boolean; title?: string }> } {
  const persistence = new FakePersistence()
  const header: SessionHeaderLite = { id: 's-t30', createdAt: NOW - 6_000, cwd: CWD }
  const base = NOW - 5_000
  persistence.add('s-t30', header, [...deleteTurnEvents(base), ...plainTurnEvents(base + 100)])
  return { persistence, sessions: [{ id: 's-t30', updatedAt: NOW, running: false, title: '数据层契约（合成）' }] }
}

test('33§6 deleteCommands 过真实 /detail 路由：有删除命令的轮次带计数，普通轮次不带字段', async () => {
  const { persistence, sessions } = buildDeleteFixture()
  const pipeline = await runScanPipeline(persistence, sessions)
  try {
    const detail = pipeline.details.get('s-t30')
    assert.ok(detail !== undefined, 'detail 缺失：路由没返回该会话')
    assert.equal(detail.turns.length, 2)

    const [withDelete, withoutDelete] = detail.turns
    assert.equal(withDelete.n, 1)
    // 路由 → JSON → 解析后仍在（不是只在内存对象里）。
    assert.equal(withDelete.deleteCommands, 1)
    assert.equal(withoutDelete.n, 2)
    assert.equal(withoutDelete.deleteCommands, undefined)
    assert.equal('deleteCommands' in withoutDelete, false)

    // 只计数：不因为命令里的路径多出文件节点，也不产生「已删除」伪事实。
    assert.equal(detail.turns[0].files.some((file) => file.path === 'dist'), false)
    assert.equal(detail.unassigned, undefined)
  } finally {
    pipeline.dispose()
  }
})

test('33§6 删除命令不归属路径：/snapshot 里没有 dist 节点', async () => {
  const { persistence, sessions } = buildDeleteFixture()
  const pipeline = await runScanPipeline(persistence, sessions)
  try {
    const paths = pipeline.snapshot.changedFiles.map((file) => file.path)
    assert.deepEqual(paths.slice().sort(), ['.gitignore', 'assets/demo.mp4', 'data/report.json', 'public/index.html', 'styles/site.css'])
    assert.equal(paths.some((path) => path === 'dist' || path.includes('dist')), false)
  } finally {
    pipeline.dispose()
  }
})

test('33§5 /snapshot 的 FileNode.family 是新 5 类（旧 doc/image/config 0 出现）', async () => {
  const { persistence, sessions } = buildDeleteFixture()
  const pipeline = await runScanPipeline(persistence, sessions)
  try {
    const byPath = new Map(pipeline.snapshot.changedFiles.map((file) => [file.path, file.family]))
    assert.equal(byPath.get('public/index.html'), 'code') // 修 bug：html 归代码
    assert.equal(byPath.get('styles/site.css'), 'code') // 修 bug：css 归代码
    assert.equal(byPath.get('assets/demo.mp4'), 'media') // 音视频/图片合并成媒体
    assert.equal(byPath.get('.gitignore'), 'text') // 修 bug：dotfile 归文本
    assert.equal(byPath.get('data/report.json'), 'data')
    // 线上包里只允许五类；且与 familyOf 同一口径（host 没有第二套映射）。
    for (const file of pipeline.snapshot.changedFiles) {
      assert.equal(ONLY_FAMILIES.includes(file.family), true, `${file.path} family=${file.family}`)
      assert.equal(file.family, familyOf(file.path), file.path)
    }
    const wire = JSON.stringify(pipeline.snapshot.changedFiles)
    for (const legacy of ['"family":"doc"', '"family":"image"', '"family":"config"']) {
      assert.equal(wire.includes(legacy), false, '旧 family 值仍在线上包里：' + legacy)
    }
  } finally {
    pipeline.dispose()
  }
})
