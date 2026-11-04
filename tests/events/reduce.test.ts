/**
 * A10-1 归约器单测（06 §5）+ 负向 N-04/N-05/N-06/N-07/N-10 的 reducer 侧。
 *
 * 每个断言都对应 04 §3 的一条规则；"如果实现错会红在哪"写在用例注释里。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { reduceSession } from '../../src/shared/events/index.ts'
import type { SessionEventLike } from '../../src/shared/events/index.ts'
import {
  assistantMessage,
  CWD,
  ev,
  jobRegistered,
  jobSettled,
  makeHeader,
  ptcResult,
  ptcStart,
  toolCall,
  toolResult,
  turnEnd,
  turnStart,
  userMessage,
} from './fixtures.ts'

const T0 = 1_700_000_000_000

function reduce(events: SessionEventLike[], overrides: Parameters<typeof reduceSession>[2] = {}) {
  return reduceSession(makeHeader('s-1'), events, { cwd: CWD, ...overrides })
}

test('turn/tool：轮次、文件 ops、命令、messageIds/finalMessageId 全部落账', () => {
  const events: SessionEventLike[] = [
    turnStart(1, T0),
    userMessage('帮我看下这个文件', T0 + 1),
    assistantMessage('m1', 1, 1, T0 + 2),
    toolCall('c1', 'read', { file_path: 'src/a.ts' }, 1, T0 + 3),
    toolResult('c1', 1, T0 + 4, { meta: { lines: [], totalLines: 10 } }),
    toolCall('c2', 'write', { file_path: 'src/b.ts', content: 'a\nb\nc' }, 1, T0 + 5),
    toolResult('c2', 1, T0 + 6),
    toolCall('c3', 'bash', { command: 'pnpm test', description: 'run tests' }, 1, T0 + 7),
    toolResult('c3', 1, T0 + 8, { meta: { opsShell: { exitCode: 0 } } }),
    assistantMessage('m2', 1, 1, T0 + 9),
    turnEnd(1, 'completed', T0 + 10),
    turnStart(2, T0 + 11),
    toolCall('c4', 'edit', { file_path: 'src/a.ts', old_string: 'x\ny', new_string: 'x\nz\nw' }, 2, T0 + 12),
    toolResult('c4', 2, T0 + 13),
    turnEnd(2, 'completed', T0 + 14),
  ]
  const result = reduce(events)
  const detail = result.detail

  assert.equal(detail.counts.turns, 2)
  assert.equal(detail.counts.toolCalls, 4)
  assert.equal(detail.counts.toolFailures, 0)
  assert.equal(detail.counts.commands, 1)
  assert.equal(detail.counts.files, 2)
  assert.equal(detail.status, 'completed')
  assert.equal(detail.updatedAt, T0 + 14)

  const [turn1, turn2] = detail.turns
  assert.equal(turn1.n, 1)
  assert.equal(turn1.status, 'completed')
  assert.equal(turn1.start, T0)
  assert.equal(turn1.end, T0 + 10)
  assert.deepEqual(turn1.messageIds, ['m1', 'm2'])
  assert.equal(turn1.finalMessageId, 'm2')
  assert.equal(turn1.userText, '帮我看下这个文件')
  assert.equal(turn1.assistantText, 'ok')
  // 文件聚合：a.ts(read) + b.ts(write)，不重复成 3 条。
  assert.deepEqual(turn1.files.map((file) => file.path), ['src/a.ts', 'src/b.ts'])
  assert.deepEqual(turn1.files[0].ops, ['read'])
  assert.equal(turn1.files[1].added, 3) // content 'a\nb\nc' → 3 行（≈估算）
  assert.equal(turn1.commands.length, 1)
  assert.equal(turn1.commands[0].tool, 'bash')
  assert.equal(turn1.commands[0].program, 'pnpm')
  assert.equal(turn1.commands[0].status, 'success')
  assert.equal(turn1.commands[0].text, 'pnpm test')

  assert.equal(turn2.n, 2)
  assert.deepEqual(turn2.files[0].ops, ['write'])
  assert.equal(turn2.files[0].added, 3) // new_string 'x\nz\nw'
  assert.equal(turn2.files[0].removed, 2) // old_string 'x\ny'

  assert.deepEqual(detail.messageTurns, { m1: 1, m2: 1 })
  // 触碰记录：turn1 a.ts 读 1 次、b.ts 写 1 次；turn2 a.ts 写 1 次。
  const touches = result.touches
  assert.equal(touches.length, 3)
  assert.equal(touches[0].reads, 1)
  assert.equal(touches[1].writes, 1)
  assert.equal(touches[2].writes, 1)
  // rootId 默认是自己；scan 会用父链覆写（见 routes 测试）。
  assert.equal(detail.rootId, 's-1')
})

test('N-04 未知事件：只计数，不产生假数据（不新增轮次/文件/子智能体）', () => {
  const events: SessionEventLike[] = [
    turnStart(1, T0),
    ev('todo/write', { todos: [{ content: 'x', status: 'pending' }] }, T0 + 1),
    ev('weird/new-event', { path: 'src/fake.ts' }, T0 + 2),
    turnEnd(1, 'completed', T0 + 3),
  ]
  const result = reduce(events)
  assert.equal(result.unknownEvents, 2)
  assert.equal(result.detail.counts.turns, 1)
  assert.equal(result.detail.counts.files, 0)
  assert.equal(result.detail.turns[0].files.length, 0)
  assert.equal(result.detail.subagents.length, 0)
  // 未知事件不猜计划（04 §3.3 没有 todo/write 的处理规则）。
  assert.equal(result.detail.turns[0].plan, undefined)
})

test('N-05 工具结果缺失：命令/文件状态 unknown，绝不默认成功', () => {
  const events: SessionEventLike[] = [
    turnStart(1, T0),
    toolCall('c1', 'bash', { command: 'pnpm build' }, 1, T0 + 1),
    toolCall('c2', 'read', { file_path: 'src/a.ts' }, 1, T0 + 2),
    turnEnd(1, 'completed', T0 + 3),
  ]
  const result = reduce(events)
  assert.equal(result.detail.counts.toolCalls, 2)
  assert.equal(result.detail.turns[0].commands[0].status, 'unknown')
  assert.equal(result.detail.turns[0].toolFailures, 0)
  // 文件读仍然记录（调用事实成立），但状态不是成功——命令侧已体现 unknown。
  assert.equal(result.touches.length, 1)
  assert.equal(result.touches[0].ops[0], 'read')
})

test('N-06 PTC：根 run_code 只算命令，嵌套 dispatch 才算文件；同一目标不双计', () => {
  const events: SessionEventLike[] = [
    turnStart(1, T0),
    // 根调用：args.code 里出现了 read(...) 文本——实现若解析代码就会双计。
    toolCall('root-1', 'run_code', { code: "read({ file_path: 'src/x.ts' })" }, 1, T0 + 1),
    ptcStart('root-1', 'sub-1', 'read', { file_path: 'src/x.ts' }, T0 + 2),
    ptcResult('sub-1', T0 + 3, { meta: { lines: [], totalLines: 5 } }),
    toolResult('root-1', 1, T0 + 4),
    turnEnd(1, 'completed', T0 + 5),
  ]
  const result = reduce(events)
  assert.equal(result.detail.counts.toolCalls, 2) // tool/call + dispatch-start
  assert.equal(result.detail.counts.commands, 1) // 只有 run_code
  assert.equal(result.detail.counts.files, 1)
  // 只看 dispatch 产生的那一条：reads=1（不是 2）。
  assert.equal(result.touches.length, 1)
  assert.equal(result.touches[0].path, 'src/x.ts')
  assert.equal(result.touches[0].reads, 1)
  assert.equal(result.touches[0].writes, 0)
  assert.equal(result.detail.turns[0].commands[0].tool, 'run_code')
})

test('N-07 路径越界：../ 与工作区外绝对路径一律丢弃，只留工作区内文件', () => {
  const events: SessionEventLike[] = [
    turnStart(1, T0),
    toolCall('c1', 'read', { file_path: '../../etc/passwd' }, 1, T0 + 1),
    toolResult('c1', 1, T0 + 2),
    toolCall('c2', 'read', { file_path: 'C:/Windows/System32/drivers/etc/hosts' }, 1, T0 + 3),
    toolResult('c2', 1, T0 + 4),
    toolCall('c3', 'write', { file_path: './src/ok.ts', content: 'a' }, 1, T0 + 5),
    toolResult('c3', 1, T0 + 6),
    turnEnd(1, 'completed', T0 + 7),
  ]
  const result = reduce(events)
  assert.equal(result.outsideWorkspace, 2)
  assert.equal(result.detail.counts.files, 1)
  assert.equal(result.touches.length, 1)
  assert.equal(result.touches[0].path, 'src/ok.ts') // './' 被归一化
})

test('N-10 上限与截断：filesPerTurn / turns / commands / messageTurns / events 各自标 truncated', () => {
  // filesPerTurn：一轮 3 个文件但上限 2
  const perTurn = reduce(
    [
      turnStart(1, T0),
      toolCall('c1', 'read', { file_path: 'a.ts' }, 1, T0 + 1),
      toolCall('c2', 'read', { file_path: 'b.ts' }, 1, T0 + 2),
      toolCall('c3', 'read', { file_path: 'c.ts' }, 1, T0 + 3),
      turnEnd(1, 'completed', T0 + 4),
    ],
    { limits: { maxFilesPerTurn: 2 } },
  )
  assert.equal(perTurn.detail.turns[0].files.length, 2)
  assert.equal(perTurn.detail.truncated?.filesPerTurn, true)

  // turns：3 轮但上限 2 → 保留最近 2 轮
  const turns = reduce(
    [
      turnStart(1, T0),
      turnStart(2, T0 + 1),
      turnStart(3, T0 + 2),
      turnEnd(3, 'completed', T0 + 3),
    ],
    { limits: { maxTurns: 2 } },
  )
  assert.deepEqual(turns.detail.turns.map((turn) => turn.n), [2, 3])
  assert.equal(turns.detail.truncated?.turns, true)

  // commands：上限 1
  const commands = reduce(
    [
      turnStart(1, T0),
      toolCall('c1', 'bash', { command: 'a' }, 1, T0 + 1),
      toolResult('c1', 1, T0 + 2),
      toolCall('c2', 'bash', { command: 'b' }, 1, T0 + 3),
      toolResult('c2', 1, T0 + 4),
      turnEnd(1, 'completed', T0 + 5),
    ],
    { limits: { maxCommands: 1 } },
  )
  assert.equal(commands.detail.turns[0].commands.length, 1)
  assert.equal(commands.detail.truncated?.commands, true)

  // messageTurns：上限 1
  const messages = reduce(
    [
      turnStart(1, T0),
      assistantMessage('m1', 1, 1, T0 + 1),
      assistantMessage('m2', 1, 1, T0 + 2),
      turnEnd(1, 'completed', T0 + 3),
    ],
    { limits: { maxMessageTurns: 1 } },
  )
  assert.equal(Object.keys(messages.detail.messageTurns).length, 1)
  assert.equal(messages.detail.truncated?.messageTurns, true)

  // events：上限 2 → 停止解析并标 partial（04 §3.7）
  const truncatedEvents = reduce(
    [turnStart(1, T0), turnStart(2, T0 + 1), turnStart(3, T0 + 2)],
    { limits: { maxEvents: 2 } },
  )
  assert.equal(truncatedEvents.eventsRead, 2)
  assert.equal(truncatedEvents.detail.truncated?.events, true)
  assert.equal(truncatedEvents.detail.partial, true)
})

test('turn/end 状态映射：completed/aborted 被承认，error/interrupted/未知一律 unknown（不猜成功）', () => {
  const cases: Array<{ kind: string; expected: string; endKind: string }> = [
    { kind: 'completed', expected: 'completed', endKind: 'completed' },
    { kind: 'aborted', expected: 'aborted', endKind: 'aborted' },
    { kind: 'error', expected: 'unknown', endKind: 'error' },
    { kind: 'interrupted', expected: 'unknown', endKind: 'interrupted' },
    { kind: 'blocked', expected: 'unknown', endKind: 'blocked' },
    { kind: 'future-kind', expected: 'unknown', endKind: 'other' },
  ]
  for (const item of cases) {
    const result = reduce([turnStart(1, T0), turnEnd(1, item.kind, T0 + 1)])
    assert.equal(result.detail.turns[0].status, item.expected, `kind=${item.kind}`)
    assert.equal(result.detail.turns[0].endKind, item.endKind, `kind=${item.kind}`)
    assert.equal(result.detail.status, item.expected, `session status kind=${item.kind}`)
  }
})

test('未结束的轮次：没有 running 证据 → unknown；有 running 证据 → running 且 partial', () => {
  const events = [turnStart(1, T0), toolCall('c1', 'read', { file_path: 'a.ts' }, 1, T0 + 1)]
  const withoutRunning = reduce(events)
  assert.equal(withoutRunning.detail.turns[0].status, 'unknown')
  assert.equal(withoutRunning.detail.partial, true)

  const withRunning = reduce(events, { running: true })
  assert.equal(withRunning.detail.turns[0].status, 'running')
  assert.equal(withRunning.detail.running, true)
  assert.equal(withRunning.detail.partial, true)
})

test('interrupted 的 assistant message 不定稿：finalMessageId 只指向最后一条正常消息', () => {
  const onlyInterrupted = reduce([
    turnStart(1, T0),
    assistantMessage('m1', 1, 1, T0 + 1, 'partial', true),
    turnEnd(1, 'interrupted', T0 + 2),
  ])
  assert.deepEqual(onlyInterrupted.detail.turns[0].messageIds, ['m1'])
  assert.equal(onlyInterrupted.detail.turns[0].finalMessageId, undefined)

  const mixed = reduce([
    turnStart(1, T0),
    assistantMessage('m1', 1, 1, T0 + 1, 'partial', true),
    assistantMessage('m2', 1, 1, T0 + 2, 'done'),
    turnEnd(1, 'completed', T0 + 3),
  ])
  assert.deepEqual(mixed.detail.turns[0].messageIds, ['m1', 'm2'])
  assert.equal(mixed.detail.turns[0].finalMessageId, 'm2')
})

test('job/*：后台任务单独成轨，状态只认 job/settled', () => {
  const result = reduce([
    turnStart(1, T0),
    jobRegistered('job-1', T0 + 1),
    turnEnd(1, 'completed', T0 + 2),
    jobSettled('job-1', T0 + 3, 'killed'),
  ])
  assert.equal(result.detail.jobs.length, 1)
  assert.equal(result.detail.jobs[0].id, 'job-1')
  assert.equal(result.detail.jobs[0].label, 'dev server')
  assert.equal(result.detail.jobs[0].status, 'killed')
  assert.equal(result.detail.jobs[0].finishedAt, T0 + 3)
})

test('subagent/catalog：子智能体归属取记录，不推断；轮次无 data.turn 时不硬塞进轮次', () => {
  const result = reduce([
    turnStart(1, T0),
    ev('subagent/catalog', { childId: 'child-1', label: '研究员', mode: 'subagent' }, T0 + 1),
    turnEnd(1, 'completed', T0 + 2),
  ])
  assert.deepEqual(result.detail.subagents, [{ id: 'child-1', title: '研究员' }])
  assert.deepEqual(result.detail.turns[0].subagents, [])
})

test('PTC turn 映射不到 root 时归入 session 级未知（unassigned），不猜归属', () => {
  const result = reduce([
    turnStart(1, T0),
    turnEnd(1, 'completed', T0 + 1),
    // rootCallId 不在本日志里 → turn = null
    ptcStart('missing-root', 'sub-9', 'read', { file_path: 'src/orphan.ts' }, T0 + 2),
    ptcResult('sub-9', T0 + 3),
  ])
  assert.equal(result.detail.counts.files, 1)
  assert.equal(result.touches.length, 1)
  assert.equal(result.touches[0].turn, null)
  assert.equal(result.detail.unassigned?.files.length, 1)
  assert.equal(result.detail.unassigned?.files[0].path, 'src/orphan.ts')
})

test('str_replace_editor / read_image / grep 的文件操作归约', () => {
  const result = reduce([
    turnStart(1, T0),
    toolCall('e1', 'str_replace_editor', { command: 'view', path: 'src/v.ts' }, 1, T0 + 1),
    toolResult('e1', 1, T0 + 2),
    toolCall('e2', 'str_replace_editor', { command: 'str_replace', path: 'src/v.ts', old_str: 'a', new_str: 'a\nb' }, 1, T0 + 3),
    toolResult('e2', 1, T0 + 4),
    toolCall('e3', 'read_image', { path: 'assets/logo.png' }, 1, T0 + 5),
    toolResult('e3', 1, T0 + 6),
    toolCall('e4', 'grep', { pattern: 'x', path: 'src' }, 1, T0 + 7),
    toolResult('e4', 1, T0 + 8, { meta: { files: [{ path: 'src/hit1.ts' }, { path: 'src/hit2.ts' }] } }),
    turnEnd(1, 'completed', T0 + 9),
  ])
  const files = result.detail.turns[0].files
  const byPath = new Map(files.map((file) => [file.path, file]))
  assert.deepEqual(byPath.get('src/v.ts')?.ops.sort(), ['read', 'write'])
  assert.equal(byPath.get('src/v.ts')?.added, 2) // new_str 'a\nb'
  assert.equal(byPath.get('src/v.ts')?.removed, 1) // old_str 'a'
  assert.deepEqual(byPath.get('assets/logo.png')?.ops, ['read'])
  // grep 命中文件按 search 记录；目录 args.path 不当文件节点。
  assert.deepEqual(byPath.get('src/hit1.ts')?.ops, ['search'])
  assert.deepEqual(byPath.get('src/hit2.ts')?.ops, ['search'])
  assert.equal(byPath.has('src'), false)
})
