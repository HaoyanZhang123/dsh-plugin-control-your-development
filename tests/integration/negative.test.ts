/**
 * T11 · 负向用例（06 §14 N-01..N-20；A50-5 / G-2）。
 *
 * 每条都喂**已知坏输入**，断言"该红的位置"；注释写明"实现写错会红在哪"。
 * `N-20`（只读门禁自审）在 `smoke/readonly_check.py --self-test` 的反向用例里（见
 * `output/_verify/threadline/T11/gate-self-audit.txt`），因为它的"红"必须发生在门禁本身。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { reduceSession } from '../../src/shared/events/index.ts'
import type { SessionDetail, SessionEventLike, TurnDetail } from '../../src/shared/events/index.ts'
import {
  buildCoTurnEdges,
  buildStructureEdges,
  canParse,
  coTurnEvidence,
  createEdge,
  finalizeGraph,
  resolveReferences,
  truncationText,
  turnFromDetail,
} from '../../src/shared/relations/index.ts'
import type { GraphEdge } from '../../src/shared/relations/index.ts'
import {
  applySnapshot,
  buildWorkspaceScope,
  coverageOfGraph,
  createEmptyGraph,
  degradeEmptyWorkspace,
  degradeForCoverage,
  degradeForError,
  degradeHostUnavailable,
  failedSessions,
  isZeroForbidden,
  refocusScope,
  toScanSessions,
  withoutArchived,
} from '../../src/client/data/index.ts'
import { createTranslator } from '../../src/client/locale/index.ts'
import { THREADLINE_CSS } from '../../src/client/styles/index.ts'
import { Inspector } from '../../src/client/ui/inspector/index.ts'
import type { InspectorData } from '../../src/client/ui/inspector/index.ts'
import { FileGraph } from '../../src/client/ui/map/index.ts'
import {
  TurnStrip,
  buildScopeOptions,
  buildTurnBlock,
  buildTurnGroups,
  select,
  turnStatusOf,
} from '../../src/client/ui/turns/index.ts'
import { decideImpact, impactOf } from '../../src/client/entries/impactModel.ts'
import { apply, inject } from '../../src/client/index.ts'
import type { ClientContext } from '../../src/client/index.ts'
import {
  contentEntryVisible,
  isHidden,
  maskCommand,
  maskPathFor,
  maskTitle,
  shouldRenderContent,
} from '../../src/client/privacy/index.ts'
import {
  CWD,
  NOW,
  buildWorkspaceFixture,
  runScanPipeline,
  snapshotToGraph,
  sortedFiles,
} from './fixtures.ts'

const t = createTranslator('zh')
const DAY = 24 * 60 * 60 * 1000

function event(type: string, data: Record<string, unknown>, time: number): SessionEventLike {
  return { type, time, data }
}

async function chain() {
  const fixture = buildWorkspaceFixture()
  const pipeline = await runScanPipeline(fixture.persistence, fixture.sessions)
  const { graph } = snapshotToGraph(pipeline)
  return { pipeline, graph }
}

function inspectorData(pipeline: Awaited<ReturnType<typeof runScanPipeline>>, graph: ReturnType<typeof snapshotToGraph>['graph']): InspectorData {
  const files = sortedFiles(graph)
  const turns = []
  for (const detail of pipeline.details.values()) {
    for (const turn of detail.turns) turns.push(turnFromDetail(turn, detail.id))
  }
  const finalized = finalizeGraph([...buildStructureEdges(files), ...buildCoTurnEdges(turns).edges])
  return {
    sessions: pipeline.snapshot.changedSessions,
    details: pipeline.details,
    files: graph.files,
    edges: finalized.edges,
    unconfirmed: [],
    external: [],
    coverage: graph.coverage,
    degrade: degradeForCoverage(graph.coverage),
    currentSessionId: 's-root',
  }
}

test('N-01 空工作区：未加载（known=false）不得显示 0；真空工作区才显示 0 并且有文案', () => {
  const empty = createEmptyGraph()
  assert.equal(empty.coverage.known, false)
  assert.equal(empty.applied, false)
  // 未加载 ≠ 没有：此时 UI 必须走"未知/空态"，不能把 loadedFiles=0 当事实。
  const emptyState = degradeEmptyWorkspace()
  assert.equal(emptyState.kind, 'none')
  assert.equal(emptyState.reason, 'empty-workspace')
  assert.equal(emptyState.messageKey, 'state.emptyWorkspace') // 有文案，不是"0"
  assert.equal(emptyState.renderZeroForbidden, false)
  assert.equal(empty.coverage.loadedFiles, 0)
  // 真的空工作区（scan 完成、0 会话）才是记录为 0。
  const done = applySnapshot(createEmptyGraph(), {
    scanId: 'scan-empty',
    rev: 0,
    reset: true,
    done: true,
    progress: { total: 0, scanned: 0, failed: 0, cached: 0, phase: 'complete' },
  }).graph
  assert.equal(done.coverage.known, true)
  assert.equal(done.coverage.complete, true)
  assert.equal(done.coverage.loadedSessions, 0)
})

test('N-02 会话读取失败/格式不支持：该会话失败计数，其它会话继续，不白屏', async () => {
  const { pipeline, graph } = await chain()
  const failed = failedSessions(graph)
  assert.equal(failed.count, 1)
  assert.equal(failed.sessions[0].sessionId, 's-broken')
  assert.equal(failed.sessions[0].code, 'threadline/format-unsupported')
  assert.equal(graph.sessions.has('s-broken'), false)
  assert.equal(graph.sessions.size, 3) // 其它三个照常进图
  const degrade = degradeForCoverage(graph.coverage)
  assert.equal(degrade.kind, 'partial')
  assert.equal(degrade.messageKey, 'coverage.failed')
  assert.equal(pipeline.snapshot.progress.failed, 1)
})

test('N-03 接口不可用：capability-missing / hostUnavailable 明确报错且禁止显示 0', async () => {
  const services = { getPersistence: () => undefined, getSessionQuery: () => undefined }
  const { createRoutes } = await import('../../src/host/routes.ts')
  const routes = createRoutes(services)
  try {
    const response = await routes.invoke(
      'scan',
      new Request('http://127.0.0.1/api/dsh-threadline/scan', {
        method: 'POST',
        body: JSON.stringify({ workspaceId: 'ws', cwd: CWD, generation: 1, sessions: [] }),
      }),
    )
    const json = (await response.json()) as { ok: boolean; error: { code: string } }
    assert.equal(json.ok, false)
    assert.equal(json.error.code, 'threadline/capability-missing')
  } finally {
    routes.dispose()
  }
  const missing = degradeForError('threadline/capability-missing')
  assert.equal(missing.kind, 'capability-missing')
  assert.equal(isZeroForbidden(missing), true)
  assert.equal(degradeHostUnavailable().kind, 'hostUnavailable')
  assert.equal(isZeroForbidden(degradeHostUnavailable()), true)
})

test('N-04 未知事件/字段缺失：只计数，不产生假文件/假轮次', () => {
  const result = reduceSession(
    { id: 's-unknown', createdAt: NOW - 1_000, cwd: CWD },
    [
      event('synthetic/unknown-event', { path: 'src/never.ts' }, NOW - 900),
      event('turn/start', {}, NOW - 800), // 缺 data.turn：不猜轮次号
      event('turn/end', { reason: { kind: 'completed' } }, NOW - 700), // 缺 data.turn
    ],
    { cwd: CWD },
  )
  assert.equal(result.unknownEvents, 3)
  assert.equal(result.detail.counts.turns, 0)
  assert.equal(result.detail.counts.files, 0)
  assert.equal(result.touches.length, 0)
})

test('N-05 工具结果缺失：状态 unknown，不写成成功', async () => {
  const { pipeline } = await chain()
  const adhoc = pipeline.details.get('s-adhoc')
  assert.ok(adhoc !== undefined)
  // 归约器只记原始事实（status=unknown + endKind=interrupted）；UI 才把它显示为中止。
  assert.equal(adhoc.turns[0].status, 'unknown')
  assert.equal(adhoc.turns[0].endKind, 'interrupted')
  assert.equal(turnStatusOf(adhoc.turns[0], {}), 'aborted')
  assert.equal(adhoc.turns[0].commands.length, 1)
  assert.equal(adhoc.turns[0].commands[0].status, 'unknown') // 不是 success，也不是 error
})

test('N-06 PTC 嵌套/根调用重复：同一目标不双计', () => {
  const events: SessionEventLike[] = [
    event('turn/start', { turn: 1 }, NOW - 500),
    event('tool/call', { turn: 1, step: 1, callId: 'root', name: 'run_code', arguments: JSON.stringify({ code: "read({ file_path: 'src/x.ts' })" }) }, NOW - 499),
    event('tool/ptc-dispatch-start', { rootCallId: 'root', parentCallId: 'root', subCallId: 'sub', name: 'read', arguments: { file_path: 'src/x.ts' } }, NOW - 498),
    event('tool/ptc-dispatch', { subCallId: 'sub', isError: false, content: [] }, NOW - 497),
    event('tool/result', { turn: 1, step: 1, message: { id: 'r', isError: false, source: { callId: 'root' } } }, NOW - 496),
    event('turn/end', { turn: 1, reason: { kind: 'completed' } }, NOW - 495),
  ]
  const result = reduceSession({ id: 's-ptc', createdAt: NOW - 501, cwd: CWD }, events, { cwd: CWD })
  assert.equal(result.detail.counts.commands, 1) // 只有根 run_code
  assert.equal(result.touches.length, 1)
  assert.equal(result.touches[0].reads, 1)
  assert.equal(result.touches[0].path, 'src/x.ts')
})

test('N-07 路径穿越：../ 与工作区外绝对路径被丢弃，不读外部', () => {
  const result = reduceSession(
    { id: 's-trav', createdAt: NOW - 1_000, cwd: CWD },
    [
      event('turn/start', { turn: 1 }, NOW - 900),
      event('tool/call', { turn: 1, callId: 'a', name: 'read', arguments: JSON.stringify({ file_path: '../../secrets.txt' }) }, NOW - 899),
      event('tool/call', { turn: 1, callId: 'b', name: 'read', arguments: JSON.stringify({ file_path: 'C:/Windows/win.ini' }) }, NOW - 898),
      event('turn/end', { turn: 1, reason: { kind: 'completed' } }, NOW - 897),
    ],
    { cwd: CWD },
  )
  assert.equal(result.outsideWorkspace, 2)
  assert.equal(result.detail.counts.files, 0)
  assert.equal(result.touches.length, 0)
})

test('N-08 二进制/不支持扩展名：不解析、不崩、显式列出', async () => {
  assert.equal(canParse('assets/logo.png'), false)
  assert.equal(canParse('data/raw.bin'), false)
  const result = await resolveReferences(
    [
      { path: 'assets/logo.png', text: 'PNG synthetic' },
      { path: 'data/raw.bin', text: 'binary synthetic' },
    ],
    { cwd: CWD, touched: ['assets/logo.png', 'data/raw.bin'] },
  )
  assert.equal(result.edges.length, 0)
  assert.deepEqual([...result.unparsed].sort(), ['assets/logo.png', 'data/raw.bin'])
  assert.equal(result.truncated, false)
})

test('N-09 引用目标不存在/未确认：不画边，检查器列出原因', async () => {
  const result = await resolveReferences([{ path: 'docs/notes.md', text: '[缺](./missing.md)\n' }], {
    cwd: CWD,
    touched: ['docs/notes.md'],
    stat: () => false,
  })
  assert.equal(result.edges.length, 0)
  assert.equal(result.unconfirmed.length, 1)
  assert.equal(result.unconfirmed[0].reason, 'not-found')
  assert.equal(result.unconfirmed[0].line, 1)

  const { pipeline, graph } = await chain()
  const data = inspectorData(pipeline, graph)
  data.unconfirmed = result.unconfirmed
  const html = renderToStaticMarkup(
    React.createElement(Inspector, { t, data, selection: { kind: 'file', path: 'docs/notes.md' }, now: NOW, actions: {} }),
  )
  assert.ok(html.includes('未确认引用'))
  assert.ok(html.includes('docs/missing.md'))
  assert.ok(html.includes('文件不存在'))
})

test('N-10 超过上限：图截断与响应截断都必须显式，不静默', async () => {
  // 单节点 12 条边上限：a.ts 与 15 个目标各 1 条 → 收拢 3 条。
  const edges: GraphEdge[] = []
  for (let index = 0; index < 15; index += 1) {
    edges.push(
      createEdge({
        type: 'coTurn',
        from: 'a.ts',
        to: 'b' + String(index) + '.ts',
        evidence: coTurnEvidence({ samples: [{ sessionId: 's', turn: 1 }], count: 1 }),
      }),
    )
  }
  const finalized = finalizeGraph(edges)
  assert.equal(finalized.edges.length, 12)
  assert.equal(finalized.truncation.droppedByNode, 3)
  assert.ok(finalized.truncation.text.length > 0)
  assert.equal(truncationText(3), '已收拢 3 条')

  // 响应被裁剪 → 客户端 coverage.truncated + partial 降级（"还有数据要续拉"）。
  const { pipeline } = await chain()
  const truncated = applySnapshot(createEmptyGraph(), {
    scanId: 'scan-trunc',
    rev: 1,
    reset: true,
    done: false,
    progress: { total: 4, scanned: 1, failed: 0, cached: 0, phase: 'scanning' },
    changedSessions: pipeline.snapshot.changedSessions,
    changedFiles: pipeline.snapshot.changedFiles.slice(0, 1),
    truncated: true,
  }).graph
  assert.equal(coverageOfGraph(truncated).truncated, true)
  const degrade = degradeForCoverage(coverageOfGraph(truncated))
  assert.equal(degrade.kind, 'partial')
  assert.equal(degrade.messageKey, 'coverage.partial')
  assert.equal(isZeroForbidden(degrade), true)
})

test('N-11 过期/非法 scanId：明确错误，可重试，不卡死', async () => {
  const fixture = buildWorkspaceFixture()
  const pipeline = await runScanPipeline(fixture.persistence, fixture.sessions)
  try {
    const stale = (await pipeline.routes.invoke(
      'snapshot',
      new Request('http://127.0.0.1/api/dsh-threadline/snapshot', { method: 'POST', body: JSON.stringify({ scanId: 'scan-200', sinceRev: 0 }) }),
    ).then((response) => response.json())) as { ok: boolean; error: { code: string } }
    assert.equal(stale.ok, false)
    assert.equal(stale.error.code, 'threadline/scan-not-found')
    const invalid = (await pipeline.routes.invoke(
      'snapshot',
      new Request('http://127.0.0.1/api/dsh-threadline/snapshot', { method: 'POST', body: JSON.stringify({ scanId: '../etc', sinceRev: 0 }) }),
    ).then((response) => response.json())) as { ok: boolean; error: { code: string } }
    assert.equal(invalid.error.code, 'threadline/bad-request')
  } finally {
    pipeline.dispose()
  }
})

test('N-12 窄容器：只用容器查询、不产生页面级横向滚动', () => {
  assert.ok(THREADLINE_CSS.includes('@container threadline (max-width: 899.98px)'))
  assert.ok(THREADLINE_CSS.includes('@container threadline (max-width: 599.98px)'))
  assert.ok(THREADLINE_CSS.includes('@container threadline (max-width: 419.98px)'))
  assert.ok(THREADLINE_CSS.includes('overflow-x: hidden'))
  // 不允许出现视口级 media query 来做布局（03 §12：除 reduced-motion 外不用 viewport media）。
  const viewportLayout = THREADLINE_CSS.match(/@media[^{]*\((?:min|max)-width[^{]*\{/g) ?? []
  assert.deepEqual(viewportLayout, [])
})

test('N-13 reduced-motion：不播放动画/脉冲', async () => {
  const { graph } = await chain()
  // R04 起 folder 模式需要 entries + currentPath（不再有 mode:'directory'）。
  const srcFiles = sortedFiles(graph).filter((file) => file.path.startsWith('src/'))
  const entries = srcFiles
    .filter((file) => !file.path.slice('src/'.length).includes('/'))
    .map((file) => ({ name: file.name, path: file.path, kind: 'file' as const }))
  const base = {
    files: srcFiles,
    entries,
    currentPath: 'src',
    mode: 'folder' as const,
    edges: [],
    now: NOW,
    selectedPath: null,
    locale: 'zh' as const,
  }
  const reduced = renderToStaticMarkup(React.createElement(FileGraph, { ...base, reducedMotion: true }))
  const normal = renderToStaticMarkup(React.createElement(FileGraph, { ...base, reducedMotion: false }))
  assert.ok(reduced.includes('data-reduced-motion="true"'))
  assert.ok(normal.includes('data-reduced-motion="false"'))
  assert.ok(THREADLINE_CSS.includes('prefers-reduced-motion: reduce'))
})

test('N-14 隐私模式：路径/标题/命令掩码，正文入口消失', async () => {
  const { pipeline, graph } = await chain()
  // 1) 策略层：同一个输入在两种模式下必须给出不同结果（写错就会"隐私模式不生效"）。
  assert.equal(isHidden('hidden'), true)
  assert.equal(isHidden('metadata'), false)
  assert.equal(maskPathFor('src/app.ts', 'hidden'), 'app.ts')
  assert.equal(maskPathFor('src/app.ts', 'metadata'), 'src/app.ts')
  assert.equal(maskPathFor('app.ts', 'hidden'), 'app.ts') // 幂等
  assert.notEqual(maskTitle({ sessionId: 's-root', title: '主流程（合成）' }, 0, 'hidden', t), '主流程（合成）')
  const command = maskCommand(
    { id: 'c', tool: 'bash', program: 'pnpm', text: 'pnpm test', status: 'success', startedAt: NOW },
    'hidden',
  )
  assert.equal(command.text, null)
  assert.equal(command.program, 'pnpm')
  assert.equal(shouldRenderContent('hidden', false), false)
  assert.equal(contentEntryVisible('hidden'), false)
  assert.equal(shouldRenderContent('metadata', false), false) // 默认折叠，点开才显示
  assert.equal(shouldRenderContent('metadata', true), true)

  // 2) 界面层：隐私模式下不出现完整路径 / 用户正文，但保留文件名与占位文案。
  const data = inspectorData(pipeline, graph)
  const fileHtml = renderToStaticMarkup(
    React.createElement(Inspector, {
      t,
      data,
      selection: { kind: 'file', path: 'src/app.ts' },
      now: NOW,
      privacyMode: true,
      actions: {},
    }),
  )
  assert.ok(fileHtml.includes('app.ts'))
  assert.equal(fileHtml.includes('src/app.ts'), false)
  const root = pipeline.details.get('s-root')
  assert.ok(root !== undefined)
  const turnHtml = renderToStaticMarkup(
    React.createElement(Inspector, {
      t,
      data,
      selection: { kind: 'turn', sessionId: 's-root', turn: 1 },
      now: NOW,
      privacyMode: true,
      actions: {},
    }),
  )
  assert.equal(turnHtml.includes('看一下主流程（合成）'), false)
})

test('N-15 轮次无影响：隐藏「影响 0」', async () => {
  const { pipeline } = await chain()
  const root = pipeline.details.get('s-root')
  assert.ok(root !== undefined)
  const withImpact = root.turns[0]
  assert.ok(impactOf(withImpact).n > 0)
  const noImpact: TurnDetail = {
    n: 9,
    start: NOW - 10,
    end: NOW - 5,
    status: 'completed',
    endKind: 'completed',
    files: [],
    commands: [],
    subagents: [],
    errors: 0,
    toolCalls: 0,
    toolFailures: 0,
    messageIds: ['m-empty'],
    finalMessageId: 'm-empty',
  }
  const detail: SessionDetail = {
    ...root,
    turns: [withImpact],
    messageTurns: { [withImpact.finalMessageId ?? 'm1']: withImpact.n },
  }
  const decision = decideImpact({ messageId: withImpact.finalMessageId ?? 'm1', sessionId: 's-root', detail, status: 'ready' })
  assert.equal(decision.kind, 'ready')
  const emptyDecision = decideImpact({ messageId: 'm-empty', sessionId: 's-root', detail: { ...detail, turns: [noImpact], messageTurns: { 'm-empty': 9 } }, status: 'ready' })
  assert.equal(emptyDecision.kind, 'hidden') // 不显示"影响 0"
  // 非锚点消息也不渲染（T09 只渲染一次）。
  const nonAnchor = decideImpact({ messageId: 'not-anchor', sessionId: 's-root', detail, status: 'ready' })
  assert.equal(nonAnchor.kind, 'hidden')
})

test('N-16 当前轮仍在记录：标 partial，不伪造完整', async () => {
  const fixture = buildWorkspaceFixture()
  const pipeline = await runScanPipeline(fixture.persistence, fixture.sessions)
  try {
    const live = pipeline.details.get('s-root')
    assert.ok(live !== undefined)
    const openTurn: TurnDetail = { ...live.turns[0], end: undefined, endKind: undefined, status: 'running' }
    const runningDetail: SessionDetail = { ...live, running: true, partial: true, turns: [openTurn] }
    const block = buildTurnBlock(openTurn, { sessionId: 's-root', t, now: NOW, sessionRunning: true, sessionPartial: true })
    assert.equal(block.partial, true)
    assert.equal(block.status, 'running')
    const groups = buildTurnGroups({
      scope: { kind: 'session', sessionId: 's-root' },
      currentSessionId: 's-root',
      sessions: [{ ...pipeline.snapshot.changedSessions.find((session) => session.id === 's-root')!, running: true }],
      details: new Map([['s-root', runningDetail]]),
    })
    const html = renderToStaticMarkup(
      React.createElement(TurnStrip, { t, groups, selected: select.none(), preview: null, onPreview: () => undefined, onSelect: () => undefined, now: NOW }),
    )
    assert.ok(html.includes('本轮仍在记录'))
    assert.ok(!html.includes('data-turn="1" data-status="completed"'))
  } finally {
    pipeline.dispose()
  }
})

test('N-17 归档会话：标记归档、可筛选、不混入活跃', () => {
  const sessions = [
    { id: 's-active', title: '活跃（合成）', cwd: CWD, updatedAt: NOW, running: false, archived: false },
    { id: 's-archived', title: '归档（合成）', cwd: CWD, updatedAt: NOW - DAY, running: false, archived: true },
  ]
  const scope = buildWorkspaceScope({
    workspaces: [{ id: 'ws', title: '合成工作区', sessionIds: ['s-active', 's-archived'], archivedSessionIds: ['s-archived'] }],
    sessions: { sessions },
    sessionId: 's-active',
    now: NOW,
  })
  assert.equal(scope.sessions.find((session) => session.id === 's-archived')?.bucket, 'archived')
  assert.equal(scope.counts.archived, 1)
  assert.equal(scope.counts.current, 1)
  const filtered = withoutArchived(scope)
  assert.equal(filtered.sessions.some((session) => session.id === 's-archived'), false)
  assert.equal(toScanSessions(scope).sessions.some((session) => session.id === 's-archived'), true) // 扫描含归档（带标记）
  const options = buildScopeOptions(withoutArchived(scope).sessions as never, t)
  /* 口径（D-35）：归档不再作为具体会话列出，只归入「全部会话（含归档）」这一个汇总项。
   * 因此判据是「没有指向归档会话的 session: 选项」，而不是「标签里不含归档二字」。 */
  assert.equal(options.some((option) => option.value === 'session:s-archived'), false)
  assert.equal(options.some((option) => option.value === 'all'), true, '必须保留含归档的汇总范围')
})

test('N-18 切换工作区：取消旧扫描、清空旧图，不串数据', async () => {
  const { pipeline, graph } = await chain()
  const fixture = buildWorkspaceFixture()
  const otherPipeline = await runScanPipeline(fixture.persistence, fixture.sessions.filter((session) => session.id !== 's-root' && session.id !== 's-child'))
  try {
    // 两个独立 manager 各自从 scan-1 计数；这里验证客户端：reset 包不得残留旧图。
    const reset = snapshotToGraph(otherPipeline).graph
    assert.equal(reset.sessions.has('s-root'), false)
    assert.equal(reset.files.has('docs/notes.md'), false)
    assert.equal(graph.files.has('docs/notes.md'), true)
    // 重新识别 scope：新会话不在旧 scope → 明确降级（不猜）。
    const scopeA = buildWorkspaceScope({
      workspaces: [{ id: 'ws-a', sessionIds: ['s-root', 's-child'] }],
      sessions: { sessions: [{ id: 's-root', cwd: CWD, updatedAt: NOW }, { id: 's-child', cwd: CWD, updatedAt: NOW - 1, parentId: 's-root' }] },
      sessionId: 's-root',
      now: NOW,
    })
    const relocated = refocusScope(scopeA, 's-from-other-workspace')
    assert.equal(relocated.currentSessionId, 's-from-other-workspace')
    // 其它工作区的会话没有被塞进来：scope 的成员仍然只有 A 的；未知会话不造行。
    assert.equal(relocated.sessions.some((session) => session.id === 's-from-other-workspace'), false)
    assert.equal(relocated.sessions.every((session) => scopeA.order.includes(session.id)), true)
  } finally {
    pipeline.dispose()
    otherPipeline.dispose()
  }
})

test('N-19 旧版/缺失 slot：不崩；入口缺失可见（warn），inject 仍声明 slots', () => {
  assert.deepEqual(inject, ['slots'])
  const warnings: string[] = []
  const ctx: ClientContext = {
    get: () => undefined,
    logger: { warn: (message) => warnings.push(message) },
    effect: (callback) => {
      callback()
      return () => undefined
    },
  }
  assert.doesNotThrow(() => apply(ctx))
  assert.ok(warnings.length >= 1)
  assert.ok(warnings.every((message) => message.startsWith('threadline:')))
})

/*
 * N-20（只读门禁自审）不在本文件里：它的"红"必须发生在门禁本身——
 * 见 `smoke/readonly_check.py --self-test`（喂一条含 writeFile 的假源码 → 必须 exit 1 并点名），
 * 原始输出与退出码在 `output/_verify/threadline/T11/gate-self-audit.txt`。
 */
