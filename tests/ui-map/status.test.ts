/*
 * status.test.ts —— 本轮文件状态（33 §4；纯函数）。
 *
 * 只允许四个可证事实：读 N / 写 +A / 写 −D / 首见；删除只有命令级计数。
 * 重点：turn.end 缺失 → 不标首见（运行中不猜）；deleteCommands 缺省 = null（界面显示 —）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import type { TurnFile } from '../../src/shared/events/index.ts'
import { turnFileStatusOf } from '../../src/client/ui/turns/index.ts'
import { alignTurnToFileFirstSeen, makeFiles, makeTurnDetail, NOW } from './fixtures.ts'

const files = makeFiles({ count: 12, seed: 9 })
const fileIndex = files

test('读 = read/search 次数；写行数只来自 write 的文件（≈）；未写文件不带行数', () => {
  const turn = makeTurnDetail(files, { n: 5, deleteCommands: 2 })
  const snapshot = turnFileStatusOf(turn, fileIndex)
  const first = snapshot.byPath.get(turn.files[0].path)
  assert.ok(first)
  assert.equal(first.read, 1)
  assert.equal(first.writeAdd, 0)
  assert.equal(first.writeDel, 0)

  const second = snapshot.byPath.get(turn.files[1].path)
  assert.ok(second)
  assert.equal(second.read, 1)
  assert.equal(second.writeAdd, 12)
  assert.equal(second.writeDel, 0)

  const third = snapshot.byPath.get(turn.files[2].path)
  assert.ok(third)
  assert.equal(third.read, 0)
  assert.equal(third.writeDel, 3)

  const fourth = snapshot.byPath.get(turn.files[3].path)
  assert.ok(fourth)
  assert.equal(fourth.read, 1, 'search 计入读')

  assert.equal(snapshot.summary.reads, 4)
  assert.equal(snapshot.summary.writeAdd, 16)
  assert.equal(snapshot.summary.writeDel, 3)
})

test('删除命令：有值带进 summary；缺省 = null（不可知 → 界面显示 —）', () => {
  const withDelete = turnFileStatusOf(makeTurnDetail(files, { deleteCommands: 3 }), fileIndex)
  assert.equal(withDelete.summary.deleteCommands, 3)
  const without = turnFileStatusOf(makeTurnDetail(files), fileIndex)
  assert.equal(without.summary.deleteCommands, null)
  const zero = turnFileStatusOf(makeTurnDetail(files, { deleteCommands: 0 }), fileIndex)
  assert.equal(zero.summary.deleteCommands, 0)
})

test('首见：FileNode.firstAt 落在 [start,end] 才标；turn.end 缺失（运行中）不标', () => {
  const target = files[0]
  const ended = alignTurnToFileFirstSeen(makeTurnDetail(files), target)
  assert.equal(turnFileStatusOf(ended, fileIndex).byPath.get(target.path)?.firstSeen, true)

  const running = alignTurnToFileFirstSeen(makeTurnDetail(files, { end: null }), target)
  assert.equal(running.end, undefined)
  assert.equal(turnFileStatusOf(running, fileIndex).byPath.get(target.path)?.firstSeen, null)
  assert.equal(turnFileStatusOf(running, fileIndex).summary.firstSeen, null)

  // 窗口外的文件不标首见。
  const far: typeof ended = { ...ended, start: NOW + 10 * 24 * 60 * 60 * 1000, end: NOW + 11 * 24 * 60 * 60 * 1000 }
  const snapshot = turnFileStatusOf(far, fileIndex)
  for (const status of snapshot.byPath.values()) assert.equal(status.firstSeen, false)
  assert.equal(snapshot.summary.firstSeen, 0)
})

test('未知文件（不在 FileNode 索引里）不标首见，但仍保留读/写事实', () => {
  const turn = makeTurnDetail(files)
  const extra = {
    ...turn,
    files: [...turn.files, { path: '__not_in_index__/x.ts', ops: ['read'] as TurnFile['ops'], added: 0, removed: 0 }],
  }
  const snapshot = turnFileStatusOf({ ...extra, files: [...extra.files] }, fileIndex)
  const ghost = snapshot.byPath.get('__not_in_index__/x.ts')
  assert.ok(ghost)
  assert.equal(ghost.read, 1)
  assert.equal(ghost.firstSeen, false)
})

test('空轮次：空 map + 零摘要（不造数）', () => {
  const turn = { ...makeTurnDetail(files), files: [] }
  const snapshot = turnFileStatusOf(turn, fileIndex)
  assert.equal(snapshot.byPath.size, 0)
  assert.deepEqual(snapshot.summary, { reads: 0, writeAdd: 0, writeDel: 0, firstSeen: 0, deleteCommands: null })
})

test('索引支持 Map 与数组两种输入（同一结果）', () => {
  const turn = makeTurnDetail(files)
  const array = turnFileStatusOf(turn, files)
  const map = new Map(files.map((file) => [file.path.toLowerCase(), file]))
  const mapped = turnFileStatusOf(turn, map)
  assert.deepEqual([...array.byPath.entries()], [...mapped.byPath.entries()])
})
