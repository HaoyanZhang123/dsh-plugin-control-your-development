/**
 * T11 · A50-2 集成链路：reducer → host scan（假 persistence）→ relations → client merge → UI 数据。
 *
 * 这条链路只用**真实实现**与**合成/脱敏**事件；不依赖真机、不读真实日志。
 * 断言目标是"同一条事实在不同层保持一致"：reducer 计数 = host 摘要 = 图节点数 = UI 模型字段。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { reduceSession } from '../../src/shared/events/index.ts'
import type { SessionEventLike, SessionDetail, TurnDetail } from '../../src/shared/events/index.ts'
import {
  buildCoSessionEdges,
  buildCoTurnEdges,
  buildSequenceEdges,
  buildStructureEdges,
  finalizeGraph,
  resolveReferences,
  turnFromDetail,
} from '../../src/shared/relations/index.ts'
import type { RelationTurn } from '../../src/shared/relations/index.ts'
import {
  coverageOfGraph,
  degradeNone,
  failedSessions,
  graphStats,
} from '../../src/client/data/index.ts'
import type { WorkspaceGraph } from '../../src/client/data/index.ts'
import { createTranslator } from '../../src/client/locale/index.ts'
import { Inspector } from '../../src/client/ui/inspector/index.ts'
import type { InspectorData } from '../../src/client/ui/inspector/index.ts'
import { TurnStrip, buildTurnBlock, buildTurnGroups, select } from '../../src/client/ui/turns/index.ts'
import { FileGraph } from '../../src/client/ui/map/index.ts'
import {
  CWD,
  NOW,
  buildWorkspaceFixture,
  rootEvents,
  runScanPipeline,
  snapshotToGraph,
  sortedFiles,
  syntheticIncrement,
} from './fixtures.ts'
import type { ScanPipeline } from './fixtures.ts'

const t = createTranslator('zh')

async function fullChain(): Promise<{
  pipeline: ScanPipeline
  graph: WorkspaceGraph
  inspector: InspectorData
  turns: RelationTurn[]
  rendered: { inspector: string; strip: string; map: string; mapDetail: string; edges: string }
}> {
  const fixture = buildWorkspaceFixture()
  const pipeline = await runScanPipeline(fixture.persistence, fixture.sessions)
  const { graph } = snapshotToGraph(pipeline)
  const files = sortedFiles(graph)

  // 关系层：全部从**图/详情**生成，不另造数据。
  const turns: RelationTurn[] = []
  for (const detail of pipeline.details.values()) {
    for (const turn of detail.turns) turns.push(turnFromDetail(turn, detail.id))
  }
  const structure = buildStructureEdges(files)
  const coTurn = buildCoTurnEdges(turns)
  const coSession = buildCoSessionEdges(files, 'src/app.ts')
  const sequence = buildSequenceEdges(turns.find((turn) => turn.sessionId === 's-root' && turn.turn === 1))
  const reference = await resolveReferences(
    [
      {
        path: 'docs/notes.md',
        text: ['# 笔记', '', '[主流程](../src/app.ts)', '[外链](https://example.invalid/x)', '[越界](../../etc/passwd)', ''].join('\n'),
      },
    ],
    {
      cwd: CWD,
      touched: files.map((file) => file.path),
      stat: (path: string) => files.some((file) => file.path.toLowerCase() === path.toLowerCase()),
    },
  )
  const finalized = finalizeGraph([
    ...structure,
    ...coTurn.edges,
    ...coSession.edges,
    ...sequence.edges,
    ...reference.edges,
  ])

  const inspector: InspectorData = {
    sessions: pipeline.snapshot.changedSessions,
    details: pipeline.details,
    files: graph.files,
    edges: finalized.edges,
    unconfirmed: reference.unconfirmed,
    external: reference.external,
    coverage: graph.coverage,
    degrade: degradeNone(),
    currentSessionId: 's-root',
  }

  const fileSelection = { kind: 'file', path: 'src/app.ts' } as const
  const inspectorHtml = renderToStaticMarkup(
    React.createElement(Inspector, {
      t,
      data: inspector,
      selection: fileSelection,
      now: NOW,
      actions: {},
    }),
  )
  const groups = buildTurnGroups({
    scope: { kind: 'all' },
    currentSessionId: 's-root',
    sessions: pipeline.snapshot.changedSessions,
    details: pipeline.details,
  })
  const stripHtml = renderToStaticMarkup(
    React.createElement(TurnStrip, {
      t,
      groups,
      sessions: pipeline.snapshot.changedSessions,
      selected: select.none(),
      preview: null,
      onPreview: () => undefined,
      onSelect: () => undefined,
      now: NOW,
    }),
  )
  // T31/1.2.0：左图是「当前目录节点图」（folder 模式）。两次渲染覆盖 src / docs 两个目录，
  // 保证「数据真的进了 DOM」这条断言不被单一视图替换掉。
  // R04 起 folder 模式需要 entries（当前目录的直接 entries：文件 + 子文件夹，含未触碰项）+ currentPath。
  // 子文件夹要从 files 的路径里推导出来（孙级文件说明中间有目录），否则枢纽会缺失。
  const entriesOf = (
    nodes: readonly { path: string; name: string }[],
    dir: string,
  ): Array<{ name: string; path: string; kind: 'file' | 'directory' }> => {
    const prefix = dir + '/'
    const files: Array<{ name: string; path: string; kind: 'file' }> = []
    const dirs = new Map<string, { name: string; path: string; kind: 'directory' }>()
    for (const node of nodes) {
      if (!node.path.startsWith(prefix)) continue
      const rest = node.path.slice(prefix.length)
      const slash = rest.indexOf('/')
      if (slash < 0) {
        files.push({ name: node.name, path: node.path, kind: 'file' as const })
        continue
      }
      const segment = rest.slice(0, slash)
      const childPath = prefix + segment
      if (!dirs.has(childPath)) dirs.set(childPath, { name: segment, path: childPath, kind: 'directory' as const })
    }
    return [...dirs.values(), ...files]
  }
  const mapHtml = renderToStaticMarkup(
    React.createElement(FileGraph, {
      files: files.filter((file) => file.path.startsWith('src/')),
      entries: entriesOf(files, 'src'),
      currentPath: 'src',
      edges: finalized.edges,
      mode: 'folder',
      now: NOW,
      selectedPath: null,
      locale: 'zh',
    }),
  )
  const mapDetailHtml = renderToStaticMarkup(
    React.createElement(FileGraph, {
      files: files.filter((file) => file.path.startsWith('docs/')),
      entries: entriesOf(files, 'docs'),
      currentPath: 'docs',
      edges: finalized.edges,
      mode: 'folder',
      now: NOW,
      selectedPath: null,
      locale: 'zh',
    }),
  )
  const edgeFingerprint = finalized.edges
    .map((edge) => [edge.id, edge.type, edge.from, edge.to, edge.weight, edge.confirmed, edge.confidence].join('|'))
    .sort()
    .join('\n')

  return {
    pipeline,
    graph,
    inspector,
    turns,
    rendered: { inspector: inspectorHtml, strip: stripHtml, map: mapHtml, mapDetail: mapDetailHtml, edges: edgeFingerprint },
  }
}

test('A50-2 链路一致：reducer 计数 = host 摘要 = 图节点/边 = 关系引擎 = UI 模型', async () => {
  const { pipeline, graph, inspector, turns } = await fullChain()
  const snapshot = pipeline.snapshot

  // 1) reducer 单测入口与 host detail 是同一实现：逐字段一致（不是两套解析）。
  const reduced = reduceSession({ id: 's-root', createdAt: NOW - 6_000, cwd: CWD }, rootEvents(), { cwd: CWD, running: true })
  const hostDetail = pipeline.details.get('s-root')
  assert.ok(hostDetail !== undefined)
  // detail 路径额外注入「已知子会话」（scan 摘要），因此 subagents 比裸 reducer 多 1；
  // 其余计数必须逐字段一致——证明 host detail 没有第二套解析。
  const { subagents: hostSubagents, ...hostCounts } = hostDetail.counts
  const { subagents: reducedSubagents, ...reducedCounts } = reduced.detail.counts
  assert.deepEqual(hostCounts, reducedCounts)
  assert.equal(reducedSubagents, 0)
  assert.equal(hostSubagents, 1)
  assert.equal(reduced.detail.counts.subagents, 0)
  assert.deepEqual(hostDetail.turns.map((turn) => turn.n), [1, 2])
  assert.equal(hostDetail.turns[0].finalMessageId, 's-root-m2')

  // 2) host 扫描：4 个请求会话、3 个成功、1 个失败（点名 code，不静默）。
  assert.equal(snapshot.progress.total, 4)
  assert.equal(snapshot.progress.scanned, 3)
  assert.equal(snapshot.progress.failed, 1)
  assert.equal(snapshot.progress.phase, 'complete')
  assert.deepEqual(
    snapshot.errors.map((error) => [error.sessionId, error.code]),
    [['s-broken', 'threadline/format-unsupported']],
  )
  assert.deepEqual(snapshot.changedSessions.map((session) => session.id).sort(), ['s-adhoc', 's-child', 's-root'])
  // 主会话的 files/turns/commands 与 detail 计数一致。
  const rootSummary = snapshot.changedSessions.find((session) => session.id === 's-root')
  assert.ok(rootSummary !== undefined)
  assert.equal(rootSummary.files, hostDetail.counts.files)
  assert.equal(rootSummary.turns, hostDetail.counts.turns)
  assert.equal(rootSummary.commands, hostDetail.counts.commands)
  assert.equal(rootSummary.subagents, 1) // s-child 归到工作线
  const childSummary = snapshot.changedSessions.find((session) => session.id === 's-child')
  assert.equal(childSummary?.rootId, 's-root')

  // 3) 文件节点：4 个；src/app.ts 的读/写/行数估算跨会话累加正确。
  assert.deepEqual(sortedFiles(graph).map((file) => file.path), ['docs/notes.md', 'docs/spec.md', 'src/app.ts', 'src/lib/util.ts'])
  const app = graph.files.get('src/app.ts')
  assert.ok(app !== undefined)
  assert.equal(app.reads, 2) // s-root 第 1 轮 + s-child 第 1 轮
  assert.equal(app.writes, 1) // s-root 第 2 轮 edit
  assert.equal(app.added, 3)
  assert.equal(app.removed, 2)
  assert.equal(app.ops, 3)
  assert.deepEqual([...app.sessionIds].sort(), ['s-child', 's-root'])
  assert.equal(app.sessionCount, 2)
  assert.equal(app.turnCount, 3)
  assert.equal(app.family, 'code')
  const notes = graph.files.get('docs/notes.md')
  assert.equal(notes?.writes, 1)
  assert.equal(notes?.added, 4) // content 4 行（≈估算）
  const util = graph.files.get('src/lib/util.ts')
  assert.equal(util?.reads, 1)
  assert.equal(util?.searches, 1)
  const spec = graph.files.get('docs/spec.md')
  assert.equal(spec?.reads, 2) // read + str_replace_editor view

  // 4) wire 共现边：host 算的 coTurn 与客户端图一致（4 条，app-util 权重 2）。
  assert.equal(graph.edges.size, 4)
  const appUtil = [...graph.edges.values()].find(
    (edge) =>
      (edge.from === 'src/app.ts' && edge.to === 'src/lib/util.ts') ||
      (edge.from === 'src/lib/util.ts' && edge.to === 'src/app.ts'),
  )
  assert.equal(appUtil?.weight, 2)

  // 5) 覆盖率：真实进度、不是"全部"。
  const coverage = coverageOfGraph(graph)
  assert.equal(coverage.total, 4)
  assert.equal(coverage.scanned, 3)
  assert.equal(coverage.failed, 1)
  assert.equal(coverage.loadedFiles, 4)
  assert.equal(coverage.loadedSessions, 3)
  assert.equal(coverage.known, true)
  assert.equal(coverage.complete, true)
  assert.equal(failedSessions(graph).count, 1)
  assert.deepEqual(graphStats(graph), {
    sessions: 3,
    files: 4,
    edges: 4,
    errors: 1,
    rev: graph.rev,
    complete: true,
  })

  // 6) 关系引擎：五层都从同一份图/详情生成；边必须有证据、不可含未确认引用。
  const types = new Set([...inspector.edges].map((edge) => edge.type))
  for (const type of ['structure', 'coTurn', 'coSession', 'sequence', 'reference'] as const) {
    assert.equal(types.has(type), true, '关系层缺失：' + type)
  }
  for (const edge of inspector.edges) {
    assert.ok(edge.evidence.text.length > 0, '边缺证据：' + edge.id)
    assert.equal(edge.confirmed, true)
  }
  // 未确认引用不画边，只留在 unconfirmed 里（N-09 的正向对照）。
  assert.equal(inspector.edges.some((edge) => edge.to.includes('etc/passwd')), false)
  assert.equal(inspector.unconfirmed.some((item) => item.reason === 'escape-cwd'), true)
  // 共现证据里的 session/turn 必须能在 detail 里找到（可追溯）。
  const coTurnEdge = inspector.edges.find((edge) => edge.type === 'coTurn')
  assert.ok(coTurnEdge !== undefined)
  if (coTurnEdge.evidence.kind !== 'coTurn') throw new Error('unreachable')
  for (const sample of coTurnEdge.evidence.samples) {
    const detail = pipeline.details.get(sample.sessionId)
    assert.ok(detail !== undefined)
    assert.equal(detail.turns.some((turn) => turn.n === sample.turn), true)
  }
  // 同轮共现与同会话共现都真的从图里长出来。
  assert.equal(inspector.edges.filter((edge) => edge.type === 'coTurn').length, 4)
  assert.equal(inspector.edges.filter((edge) => edge.type === 'coSession').length, 3)
  assert.equal(inspector.edges.filter((edge) => edge.type === 'sequence').length, 2)

  // 7) UI 数据：轮次带 4 块（2+1+1）、星图 4 节点；模型字段与 detail 一致。
  const groups = buildTurnGroups({
    scope: { kind: 'all' },
    currentSessionId: 's-root',
    sessions: pipeline.snapshot.changedSessions,
    details: pipeline.details,
  })
  // 全部工作线 = 工作区**根会话**分组（03 §6：子智能体轮次按会话打开）。
  assert.deepEqual(groups.map((group) => group.sessionId), ['s-root', 's-adhoc'])
  assert.equal(groups.reduce((sum, group) => sum + group.turns.length, 0), 3)
  const childGroups = buildTurnGroups({
    scope: { kind: 'session', sessionId: 's-child' },
    currentSessionId: 's-root',
    sessions: pipeline.snapshot.changedSessions,
    details: pipeline.details,
  })
  assert.equal(childGroups.length, 1)
  assert.equal(childGroups[0].turns.length, 1)
  const firstTurn: TurnDetail = hostDetail.turns[0]
  const block = buildTurnBlock(firstTurn, { sessionId: 's-root', t, now: NOW })
  assert.equal(block.counts.files, 3)
  assert.equal(block.counts.commands, 1)
  assert.equal(block.counts.subagents, 0)
  assert.equal(block.counts.errors, 0)
  assert.equal(firstTurn.toolCalls, 4) // 第 1 轮 4 次工具调用（UI 计数不含它）
  assert.equal(block.status, 'completed')
  assert.equal(block.partial, false)

  // 8) 渲染：数据真的进了 DOM，且没有 undefined/NaN。
  // 1.2.0（R04）：左图是「当前目录节点图」——当前目录的**直接**文件画成文件节点，
  // 直接子文件夹画成文件夹枢纽（`data-folder-hub`）；孙级文件不再出现在这一层。
  const { rendered } = await fullChain()
  assert.ok(rendered.strip.includes('data-turn="1"'))
  assert.equal((rendered.strip.match(/data-turn="/g) ?? []).length, 3)
  // src 的直接文件只有 src/app.ts；src/lib 是子文件夹 → 枢纽（不是文件节点）。
  assert.equal((rendered.map.match(/data-file-path="/g) ?? []).length, 1, 'src 目录图应只有 1 个直接文件节点')
  assert.equal((rendered.map.match(/data-folder-hub="/g) ?? []).length, 1, 'src 目录图应有 1 个文件夹枢纽（lib）')
  assert.equal((rendered.map.match(/data-cluster-card="/g) ?? []).length, 0)
  assert.ok(rendered.map.includes('data-graph-mode="folder"'))
  assert.ok(rendered.map.includes('data-file-count="1"'))
  // docs 的直接文件是 docs/notes.md、docs/spec.md（都在 docs 下一层）→ 2 个文件节点、0 个枢纽。
  assert.equal((rendered.mapDetail.match(/data-file-path="/g) ?? []).length, 2, 'docs 目录图应有 2 个直接文件节点')
  assert.equal((rendered.mapDetail.match(/data-folder-hub="/g) ?? []).length, 0, 'docs 目录图没有子文件夹')
  assert.equal((rendered.mapDetail.match(/data-cluster-card="/g) ?? []).length, 0)
  for (const [name, html] of Object.entries(rendered)) {
    if (name === 'edges') continue
    assert.ok(!html.includes('undefined'), name + ' 渲染出现 undefined')
    assert.ok(!html.includes('NaN'), name + ' 渲染出现 NaN')
  }
  assert.ok(rendered.inspector.includes('app.ts'))
  assert.ok(rendered.inspector.includes('≈'))
})

test('A50-2 增量合并：updated/removed 按 id/path 覆盖，覆盖率的 loaded 数随图变化', async () => {
  const fixture = buildWorkspaceFixture()
  const pipeline = await runScanPipeline(fixture.persistence, fixture.sessions)
  const { graph } = snapshotToGraph(pipeline)
  const app = graph.files.get('src/app.ts')
  assert.ok(app !== undefined)

  const updated = { ...app, reads: app.reads + 5, ops: app.ops + 5 }
  const withUpdate = syntheticIncrement(graph, { updatedFile: updated })
  assert.equal(withUpdate.applied.filesUpdated, 1)
  assert.equal(withUpdate.applied.filesAdded, 0)
  assert.equal(withUpdate.graph.files.get('src/app.ts')?.reads, app.reads + 5)
  assert.equal(withUpdate.graph.rev, graph.rev + 1)
  assert.equal(withUpdate.graph.resets, graph.resets)

  const withRemoval = syntheticIncrement(withUpdate.graph, { removedFile: 'docs/notes.md' })
  assert.equal(withRemoval.applied.filesRemoved, 1)
  assert.equal(withRemoval.graph.files.has('docs/notes.md'), false)
  assert.equal(coverageOfGraph(withRemoval.graph).loadedFiles, 3)
  assert.equal(coverageOfGraph(withRemoval.graph).loadedSessions, 3)

  // reset 包会清空旧图（N-18 的基础：切工作区不串数据）。
  const fixtureB = buildWorkspaceFixture()
  const pipelineB = await runScanPipeline(fixtureB.persistence, fixtureB.sessions)
  const reset = snapshotToGraph(pipelineB)
  assert.equal(reset.graph.resets, 1)
  assert.equal(reset.graph.scanId, pipelineB.scan.scanId)
})

test('A50-2 确定性：同一份合成事件跑两次，图/边指纹/渲染逐字符一致', async () => {
  const first = await fullChain()
  const second = await fullChain()
  assert.deepEqual(
    sortedFiles(first.graph).map((file) => [file.path, file.reads, file.writes, file.searches, file.ops]),
    sortedFiles(second.graph).map((file) => [file.path, file.reads, file.writes, file.searches, file.ops]),
  )
  assert.equal(first.rendered.edges, second.rendered.edges)
  assert.equal(first.rendered.inspector, second.rendered.inspector)
  assert.equal(first.rendered.strip, second.rendered.strip)
  assert.equal(first.rendered.map, second.rendered.map)
  assert.equal(first.rendered.mapDetail, second.rendered.mapDetail)
})

test('A50-2 关系引擎与 UI 共用同一份详情：轮次带块数与 detail.turns 对账', async () => {
  const { pipeline } = await fullChain()
  for (const detail of pipeline.details.values()) {
    const groups = buildTurnGroups({
      scope: { kind: 'session', sessionId: detail.id },
      currentSessionId: 's-root',
      sessions: pipeline.snapshot.changedSessions,
      details: pipeline.details,
    })
    const group = groups.find((candidate) => candidate.sessionId === detail.id)
    assert.ok(group !== undefined)
    assert.deepEqual(group.turns.map((turn: TurnDetail) => turn.n), detail.turns.map((turn) => turn.n))
  }
  const events: SessionEventLike[] = rootEvents()
  assert.equal(events.length, 19)
})
