/*
 * entries/tab.ts —— 「脉络」tab（`conversation.view`；03 §2.1 / §3；06 A43-1 / A43-4；T09b 接线）。
 *
 * 组件职责：把一个工作区的**只读记录**拼成外壳 + 星图/列表视图 + 时间轴 + 轮次带 + 检查器，
 * 三者共享**同一个** selectionReducer（`ui/turns` 的实现，不另造状态机）。
 *
 * T09b 接线（五个点）：
 * ① 隐私：根上包 `<PrivacyProvider>`（模式来自 `state/privacyStore`），header「隐私」菜单切换；
 *    路径/命令/标题/URL 走 T10 `privacy/masks` 的单一实现（`maskPathFor/maskCommand/maskTitle/maskUrl`）。
 * ② 列表视图：工具栏「列表视图」开关 → 挂 `FileListView` / `TurnListView`；列表开时关掉时间轴的
 *    aria-live 播报（全应用同一时刻只有一个 live 源），>200 行时按 `computeVirtualWindow` 只渲染可见区间。
 * ③ reduced-motion：`useReducedMotion()` → `reducedMotion` prop 传给 MapView / Timeline；
 *    JS 动效时长走 `motionDuration`。
 * ④ 性能：首帧可用时 `createTimeline().mark('first-usable')`（只打点，不写盘/不发网络）。
 * ⑤ 引用层：能力探测 `remote.workspaceFiles` → `state/referenceLayer`；不可用时**显式 disabled**，
 *    UI 显示「引用（解析所得） · 观测不到」，绝不假装 0 条。
 *
 * 边界：不注册其它 slot；不 append 到 body；不写存储；数据来自 T04。
 */
import * as React from 'react'
import { createTranslator, DEFAULT_LOCALE, type Locale, type Translator } from '../locale/index.ts'
import {
  isScannableScope,
  useThreadlineData,
  useThreadlineDetail,
  useWorkspaceScope,
  type FetchLike,
  type WorkspacesSnapshot,
  type WorkspaceScope,
} from '../data/index.ts'
import type { FileNode, SessionDetail, SessionSummary, ThreadlineStatus } from '../../shared/events/index.ts'
import {
  buildCoSessionEdges,
  buildCoTurnEdges,
  buildSequenceEdges,
  buildStructureEdges,
  finalizeGraph,
  turnFromDetail,
  type GraphEdge,
} from '../../shared/relations/index.ts'
import { ErrorBoundary, ThreadlineShell, type RangeKey } from '../ui/shell/index.ts'
import { Button, Chip, Legend, ProgressPill } from '../ui/common/index.ts'
import { FILE_FAMILIES, FAMILY_MESSAGE_KEY, MapView, type MapViewport } from '../ui/map/index.ts'
import { Timeline, visiblePathsAt, type TimeRange } from '../ui/timeline/index.ts'
import {
  NO_SELECTION,
  SessionSelector,
  TurnStrip,
  buildTurnGroups,
  createSelectionState,
  defaultSelection,
  effectiveSelection,
  escapeSelection,
  sameSelection,
  select,
  selectionReducer,
  type Selection,
  type TurnScope,
  type TurnStripSession,
} from '../ui/turns/index.ts'
import { Inspector, type InspectorActions, type InspectorData } from '../ui/inspector/index.ts'
import { openModal } from '../ui/modal/store.ts'
import { getDetailStore } from '../state/detailStore.ts'
import { takeFocus, selectionOfFocus } from '../state/viewFocus.ts'
import { useComposerSurface } from '../state/composerSurface.ts'
import { consumeFocusRequest } from '../state/selection.ts'
import { LIST_ROW_HEIGHT, listNeedsVirtualization, listWindow, markFirstUsable } from '../state/perf.ts'
import { PrivacyProvider, maskTitle, usePrivacy, type PrivacyMode } from '../privacy/index.ts'
import { setPrivacyMode, usePrivacyMode } from '../state/privacyStore.ts'
import { createReferenceLayer, type ReferenceLayer, type ReferenceResolutionView } from '../state/referenceLayer.ts'
import {
  DEFAULT_FILE_SORT,
  DEFAULT_TURN_SORT,
  FileListView,
  TurnListView,
  buildFileRows,
  buildTurnRows,
  motionDuration,
  useReducedMotion,
  type SortState,
} from '../a11y/index.ts'
import { defaultFetch, readSnapshot, registerSlot, type ClientScopeLike, type SnapshotHook } from './context.ts'

const h = React.createElement

/** 列表视图模式（关闭 / 文件表 + 轮次表）。 */
export type ListViewMode = 'off' | 'list'

/** `conversation.view` 的 ownerProps（+ 我们允许注入的测试/宿主字段）。 */
export interface TabOwnerProps {
  viewRequest?: { view?: string; focus?: string | null } | null
  completeViewRequest?: () => void
  openView?: (view: string, focus?: string) => void
  inspectCall?: unknown
  /** 宿主标准 props（当前会话 / 快照 hook）。 */
  sessionId?: string
  useSessions?: SnapshotHook
  useWorkspaces?: SnapshotHook
  /** 注入的同源 fetch（缺省用宿主页面的 fetch）。 */
  fetch?: FetchLike
  locale?: Locale
  /** 固定"现在"（harness 截图可复现；默认组件内每 30s 自己推进）。 */
  now?: number
  /** 打开文件的只读动作（宿主提供时可用；缺失则按钮置灰）。 */
  openPath?: (path: string) => void
  /** 宿主 `remote` 服务（引用层能力探测用；可由 index.ts 的 ctx.get('remote') 提供）。 */
  remote?: unknown
  /** 直接注入引用层（测试/宿主可覆盖）。 */
  referenceLayer?: ReferenceLayer
  testId?: string
}

/** ScopeSession → 轮次带用的会话行（状态只按 running 推，不伪造 completed）。 */
function toStripSession(session: WorkspaceScope['sessions'][number], detail?: SessionDetail): TurnStripSession {
  return {
    id: session.id,
    updatedAt: session.updatedAt,
    running: detail?.running === true || session.running,
    archived: session.archived,
    status: detail?.status ?? (session.running ? 'running' : 'unknown'),
    turns: detail?.turns.length ?? 0,
    ...(session.title === undefined ? {} : { title: session.title }),
    ...(session.parentId === undefined ? {} : { parentId: session.parentId }),
  }
}

/** ScopeSession → `SessionSummary`（检查器输入；计数只来自已加载的详情）。 */
function toSessionSummary(session: WorkspaceScope['sessions'][number], detail?: SessionDetail): SessionSummary {
  const counts = detail?.counts
  return {
    id: session.id,
    rootId: session.rootId,
    cwd: session.cwd,
    archived: session.archived,
    running: detail?.running === true || session.running,
    startedAt: detail?.startedAt ?? session.updatedAt,
    updatedAt: session.updatedAt,
    status: detail?.status ?? (session.running ? 'running' : 'unknown'),
    turns: counts?.turns ?? detail?.turns.length ?? 0,
    files: counts?.files ?? 0,
    commands: counts?.commands ?? 0,
    subagents: counts?.subagents ?? 0,
    errors: counts?.errors ?? 0,
    ...(session.title === undefined ? {} : { title: session.title }),
    ...(session.parentId === undefined ? {} : { parentId: session.parentId }),
    ...(detail?.model === undefined ? {} : { model: detail.model }),
    ...(detail?.provider === undefined ? {} : { provider: detail.provider }),
    ...(detail?.endedAt === undefined ? {} : { endedAt: detail.endedAt }),
  }
}

/** 覆盖率 → ProgressPill 的文案/状态（与 T08 概览同一口径）。 */
function coverageView(
  data: ReturnType<typeof useThreadlineData>,
  t: Translator,
): { state: 'loading' | 'partial' | 'complete' | 'failed'; done: number; total: number | null; failed: number; text: string } {
  const coverage = data.coverage
  const known = coverage.known === true
  const failed = coverage.failed
  let state: 'loading' | 'partial' | 'complete' | 'failed' = 'partial'
  if (!known) state = 'loading'
  else if (coverage.phase === 'complete') state = failed > 0 ? 'partial' : 'complete'
  else if (coverage.phase === 'failed') state = 'failed'
  else if (coverage.phase === 'starting' || coverage.phase === 'scanning') state = 'loading'
  let text = t('state.unknown')
  if (known) {
    if (coverage.phase === 'complete') text = t('coverage.complete', { done: coverage.scanned, total: coverage.total })
    else if (coverage.phase === 'failed') text = t('coverage.failed', { n: failed })
    else if (coverage.phase === 'starting' || coverage.phase === 'scanning') text = t('coverage.loading', { done: coverage.scanned, total: coverage.total })
    else text = t('coverage.partial', { done: coverage.scanned, total: coverage.total })
  }
  return {
    state,
    done: coverage.scanned,
    total: known ? coverage.total : null,
    failed,
    text: failed > 0 && coverage.phase !== 'failed' ? text + ' · ' + t('coverage.failed', { n: failed }) : text,
  }
}

/** 检查器标题（跟随选择；无选择 = 工作区概览）。 */
function inspectorTitleFor(selection: Selection, t: Translator): string {
  if (selection.kind === 'file') return t('inspector.file')
  if (selection.kind === 'turn') return t('inspector.turn')
  if (selection.kind === 'session') return t('inspector.session')
  return t('tab.title')
}

/** 诊断条是否出现：只在 failed / degrade 非 none 时（T13b）。 */
export function shouldShowDiag(input: { status: string; degradeKind: string }): boolean {
  return input.status === 'failed' || input.degradeKind !== 'none'
}

/** 诊断条的 key=value 行（不含正文/路径；顺序固定，便于截图定位）。 */
export function buildDiagItems(input: {
  status: string
  degradeKind: string
  code: string
  scannable: boolean
  sessions: number
  files: number
  references: string
}): Array<[string, string]> {
  return [
    ['status', input.status],
    ['degrade', input.degradeKind],
    ['code', input.code],
    ['scannable', input.scannable ? 'yes' : 'no'],
    ['sessions', String(input.sessions)],
    ['files', String(input.files)],
    ['refs', input.references],
  ]
}

/** 引用层不可观测时的横幅文案（只用既有 key，不写新句子）。 */
export function referenceDisabledText(t: Translator): string {
  return t('relations.reference') + ' · ' + t('state.unknown')
}

/** 「脉络」tab 组件：先套隐私 Provider，再渲染主体。 */
export function ThreadlineTabView(props: TabOwnerProps): React.ReactElement {
  const mode = usePrivacyMode()
  const t = createTranslator(props.locale ?? DEFAULT_LOCALE)
  // T13b：渲染期抛错不白屏 —— 可见错误文案 + 可折叠 stack（诊断用）
  return h(
    ErrorBoundary,
    {
      label: t('state.unknown') + ' · ' + t('tab.label'),
      detailLabel: t('ui.expand'),
      resetKey: props.viewRequest ?? props.sessionId,
      testId: 'tab-error-boundary',
    },
    h(PrivacyProvider, { mode, onChange: setPrivacyMode }, h(TabBody, { ...props, mode })),
  )
}

/** 主体（在 Provider 内，可读 `usePrivacy()`）。 */
function TabBody(props: TabOwnerProps & { mode: PrivacyMode }): React.ReactElement {
  const locale: Locale = props.locale ?? DEFAULT_LOCALE
  const t: Translator = React.useMemo(() => createTranslator(locale), [locale])
  const fetchImpl = props.fetch ?? defaultFetch()
  const store = getDetailStore(fetchImpl)
  const privacy = usePrivacy()
  const mode: PrivacyMode = props.mode ?? privacy.mode
  const hidden = mode === 'hidden'
  const reduced = useReducedMotion()
  const motionMs = motionDuration(180, reduced)

  const sessionsSnapshot = readSnapshot<{ current?: string; ids?: readonly string[] }>(props.useSessions)
  const workspacesSnapshot = readSnapshot<WorkspacesSnapshot>(props.useWorkspaces)
  const sessionId =
    typeof props.sessionId === 'string' && props.sessionId !== ''
      ? props.sessionId
      : typeof sessionsSnapshot?.current === 'string'
        ? sessionsSnapshot.current
        : ''
  const scope = useWorkspaceScope({ workspaces: workspacesSnapshot, sessions: sessionsSnapshot, sessionId })
  const scannable = isScannableScope(scope)
  const data = useThreadlineData({ scope: scannable ? scope : null, fetch: fetchImpl })

  const [range, setRange] = React.useState<RangeKey>('range.all')
  const [turnScope, setTurnScope] = React.useState<TurnScope>({ kind: 'current' })
  const [state, setState] = React.useState(() => createSelectionState(NO_SELECTION, true))
  const [listView, setListView] = React.useState<ListViewMode>('off')
  const [fileSort, setFileSort] = React.useState<SortState>(DEFAULT_FILE_SORT)
  const [turnSort, setTurnSort] = React.useState<SortState>(DEFAULT_TURN_SORT)
  const [listScroll, setListScroll] = React.useState(0)
  const [listViewport, setListViewport] = React.useState(420)
  const [layers, setLayers] = React.useState<Record<string, { on: boolean; focusOnly: boolean }>>({})
  const [playing, setPlaying] = React.useState(false)
  const [playhead, setPlayhead] = React.useState<number | null>(null)
  const [viewport, setViewport] = React.useState<MapViewport | undefined>(undefined)
  const [now, setNow] = React.useState<number>(() => props.now ?? Date.now())
  const [reference, setReference] = React.useState<ReferenceResolutionView | null>(null)
  const listRef = React.useRef<HTMLDivElement | null>(null)
  const markedRef = React.useRef(false)
  // D-30：本 tab 独占会话区域时隐藏宿主输入框（照 dsh-context 的 data-lc-surface 机制）
  const surfaceRef = React.useRef<HTMLDivElement | null>(null)
  useComposerSurface(surfaceRef)

  React.useEffect(() => {
    if (props.now !== undefined) return undefined
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [props.now])

  const effective = effectiveSelection(state)
  const selectionSessionId =
    effective.kind === 'turn' || effective.kind === 'session' ? effective.sessionId : sessionId
  // T13e：detail 在没有扫描上下文时靠 cwd 冷读；cwd 与预热同源（scope.cwd）。
  const detailCwd = scannable ? scope.cwd : undefined
  const currentEntry = useThreadlineDetail(store, sessionId === '' ? null : sessionId, {
    ...(detailCwd === undefined ? {} : { cwd: detailCwd }),
  })
  const activeEntry = useThreadlineDetail(
    store,
    selectionSessionId === '' || selectionSessionId === sessionId ? null : selectionSessionId,
    { ...(detailCwd === undefined ? {} : { cwd: detailCwd }) },
  )
  const currentDetail = currentEntry?.detail ?? null

  // 「全部工作线」范围：按需预取前 8 个根会话（有界；不加载就不画假块）
  const [extraDetails, setExtraDetails] = React.useState<ReadonlyMap<string, SessionDetail>>(new Map())
  React.useEffect(() => {
    if (turnScope.kind !== 'all') return undefined
    const ids = scope.sessions
      .filter((session) => session.parentId === undefined && !session.archived)
      .slice(0, 8)
      .map((session) => session.id)
    if (ids.length === 0) return undefined
    const unsubscribe = store.subscribe((id, entry) => {
      if (entry.detail === undefined) return
      setExtraDetails((previous) => {
        if (previous.get(id) === entry.detail) return previous
        const next = new Map(previous)
        next.set(id, entry.detail as SessionDetail)
        return next
      })
    })
    for (const id of ids) void store.request(id).catch(() => undefined)
    return () => unsubscribe()
  }, [turnScope, scope, store])

  const details = React.useMemo(() => {
    const map = new Map<string, SessionDetail>()
    if (currentDetail !== null) map.set(currentDetail.id, currentDetail)
    const activeDetail = activeEntry?.detail
    if (activeDetail !== undefined) map.set(activeDetail.id, activeDetail)
    for (const [id, detail] of extraDetails) map.set(id, detail)
    return map
  }, [currentDetail, activeEntry, extraDetails])

  const stripSessions = React.useMemo(
    () => scope.sessions.map((session) => toStripSession(session, details.get(session.id))),
    [scope, details],
  )
  const summaries = React.useMemo(
    () => scope.sessions.map((session) => toSessionSummary(session, details.get(session.id))),
    [scope, details],
  )
  const groups = React.useMemo(
    () => buildTurnGroups({ scope: turnScope, currentSessionId: sessionId, sessions: stripSessions, details }),
    [turnScope, sessionId, stripSessions, details],
  )
  const nodes = React.useMemo(() => Array.from(data.graph.files.values()), [data.graph.files])

  /* ---------------- ⑤ 引用层（能力探测；不可用 → 显式 disabled） ---------------- */
  const referenceLayer: ReferenceLayer = React.useMemo(
    () =>
      props.referenceLayer ??
      createReferenceLayer({ remote: props.remote, sessionId, cwd: scannable ? scope.cwd : '' }),
    [props.referenceLayer, props.remote, sessionId, scannable, scope.cwd],
  )
  React.useEffect(() => () => referenceLayer.dispose(), [referenceLayer])
  React.useEffect(() => {
    if (referenceLayer.status !== 'ready') {
      setReference(null)
      return undefined
    }
    if (nodes.length === 0) return undefined
    let cancelled = false
    void referenceLayer
      .resolve(nodes.map((node) => node.path))
      .then((view) => {
        if (!cancelled && view !== null) setReference(view)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [referenceLayer, nodes])

  /* ---------------- 关系边（基础层 + 引用层） ---------------- */
  const edges: GraphEdge[] = React.useMemo(() => {
    const files = Array.from(data.graph.files.values())
    const list: GraphEdge[] = [...buildStructureEdges(files)]
    for (const [id, detail] of details) {
      list.push(...buildCoTurnEdges(detail.turns.map((turn) => turnFromDetail(turn, id))).edges)
    }
    const focusPath = effective.kind === 'file' ? effective.path : undefined
    if (focusPath !== undefined) list.push(...buildCoSessionEdges(files, focusPath).edges)
    if (effective.kind === 'turn') {
      const detail = details.get(effective.sessionId)
      const turn = detail?.turns.find((item) => item.n === effective.turn)
      if (turn !== undefined) list.push(...buildSequenceEdges(turnFromDetail(turn, effective.sessionId)).edges)
    }
    if (reference !== null) list.push(...reference.edges)
    return finalizeGraph(list).edges
  }, [data.graph, details, effective, reference])

  const inspectorData: InspectorData = React.useMemo(
    () => ({
      sessions: summaries,
      details,
      files: data.graph.files,
      edges,
      unconfirmed: reference === null ? [] : reference.unconfirmed,
      external: reference === null ? [] : reference.external,
      coverage: data.coverage,
      degrade: data.degrade,
      currentSessionId: sessionId,
    }),
    [summaries, details, data.graph.files, edges, reference, data.coverage, data.degrade, sessionId],
  )

  /* ---------------- ④ 首帧可用打点（只记录，不写盘） ---------------- */
  React.useEffect(() => {
    if (markedRef.current) return
    if (!data.graph.applied && nodes.length === 0) return
    markedRef.current = true
    markFirstUsable()
  }, [data.graph.applied, nodes.length])

  /* ---------------- 焦点 / 选择 ---------------- */
  const initializedRef = React.useRef(false)
  React.useEffect(() => {
    if (initializedRef.current) return
    if (currentDetail === null) return
    initializedRef.current = true
    const initial = defaultSelection(currentDetail)
    if (initial.kind === 'none') return
    setState((previous) =>
      sameSelection(previous.selected, initial) ? previous : selectionReducer(previous, { type: 'keyboard', target: initial }),
    )
  }, [currentDetail])

  const applyFocus = React.useCallback((target: Selection) => {
    setState((previous) => selectionReducer(previous, { type: 'keyboard', target }))
  }, [])

  const consumedRef = React.useRef<unknown>(null)
  React.useEffect(() => {
    const result = consumeFocusRequest({
      request: props.viewRequest,
      sessionId,
      last: consumedRef.current,
      complete: props.completeViewRequest,
    })
    if (!result.consumed) return
    consumedRef.current = result.last
    if (result.target !== null) applyFocus(result.target)
  }, [props.viewRequest, props.completeViewRequest, sessionId, applyFocus])

  React.useEffect(() => {
    if (sessionId === '') return
    const target = takeFocus(sessionId)
    if (target === null) return
    applyFocus(selectionOfFocus(target))
  }, [sessionId, applyFocus])

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      setState((previous) => {
        const result = escapeSelection(previous)
        if (result.consumed) event.preventDefault()
        return result.state
      })
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  /* ---------------- ② 列表视图（T10 a11y；>200 行虚拟化） ---------------- */
  const fileRows = React.useMemo(() => buildFileRows(nodes, mode), [nodes, mode])
  const turnRows = React.useMemo(() => {
    if (currentDetail === null) return []
    return buildTurnRows(
      currentDetail.turns.map((turn) => ({
        turn: turn.n,
        status: turn.status as ThreadlineStatus,
        files: new Set(turn.files.map((file) => file.path.toLowerCase())).size,
        commands: turn.commands.length,
        errors: turn.errors,
        durationMs: turn.end === undefined ? null : turn.end - turn.start,
        sessionId: currentDetail.id,
      })),
    )
  }, [currentDetail])
  const virtualized = listNeedsVirtualization(fileRows.length)
  const fileWindow = React.useMemo(
    () => listWindow(fileRows.length, listScroll, listViewport),
    [fileRows.length, listScroll, listViewport],
  )
  const visibleFileRows = virtualized ? fileRows.slice(fileWindow.start, fileWindow.end) : fileRows

  const onListScroll = React.useCallback(() => {
    const target = listRef.current
    if (target === null) return
    setListScroll(target.scrollTop)
    setListViewport(target.clientHeight > 0 ? target.clientHeight : 420)
  }, [])

  const selectFromList = React.useCallback(
    (key: string | null) => {
      if (key === null) {
        setState((previous) => selectionReducer(previous, { type: 'blank' }))
        return
      }
      if (key.startsWith('turn:')) {
        const turn = Number(key.slice('turn:'.length))
        if (Number.isInteger(turn) && turn > 0) applyFocus(select.turn(sessionId, turn))
        return
      }
      const row = fileRows.find((item) => item.key === key)
      if (row !== undefined) applyFocus(select.file(row.path))
    },
    [applyFocus, fileRows, sessionId],
  )

  /** 「在图中聚焦」：清掉手动 viewport → 回到 MapView 的 fit；同时选中该行。 */
  const focusInMap = React.useCallback(
    (key: string) => {
      selectFromList(key)
      setViewport(undefined)
      setListView('off')
    },
    [selectFromList],
  )

  /* ---------------- 时间轴 / 星图数据 ---------------- */
  const timelineNodes = React.useMemo(
    () => nodes.map((node: FileNode) => ({ path: node.path, firstAt: node.firstAt, lastAt: node.lastAt, ops: node.ops })),
    [nodes],
  )
  const domain: TimeRange | null = React.useMemo(() => {
    if (nodes.length === 0) return null
    let start = Number.POSITIVE_INFINITY
    let end = 0
    for (const node of nodes) {
      start = Math.min(start, node.firstAt)
      end = Math.max(end, node.lastAt)
    }
    if (!Number.isFinite(start) || end <= start) return null
    return { start, end }
  }, [nodes])
  const timelineSessions = React.useMemo(
    () =>
      scope.sessions.map((session) => {
        const detail = details.get(session.id)
        return {
          id: session.id,
          ...(session.title === undefined
            ? {}
            : { title: maskTitle({ sessionId: session.id, title: session.title }, 0, mode, t) }),
          start: detail?.startedAt ?? session.updatedAt,
          ...(detail?.endedAt === undefined ? {} : { end: detail.endedAt }),
          turns: detail?.turns.length ?? 0,
        }
      }),
    [scope, details, mode, t],
  )
  const at = playhead ?? now
  const visiblePaths = React.useMemo(
    () => (playhead === null ? null : visiblePathsAt(timelineNodes, playhead)),
    [playhead, timelineNodes],
  )
  const currentTurnPaths = React.useMemo(() => {
    if (effective.kind !== 'turn') return []
    const detail = details.get(effective.sessionId)
    const turn = detail?.turns.find((item) => item.n === effective.turn)
    return turn === undefined ? [] : turn.files.map((file) => file.path)
  }, [effective, details])

  const coverage = coverageView(data, t)
  const runningDetail =
    currentDetail !== null && (currentDetail.running === true || currentDetail.status === 'running') ? currentDetail : null
  const nowStrip =
    runningDetail === null
      ? null
      : {
          text:
            maskTitle(
              { sessionId: runningDetail.id, ...(runningDetail.title === undefined ? {} : { title: runningDetail.title }) },
              0,
              mode,
              t,
            ) +
            ' · ' +
            t('session.running') +
            (runningDetail.turns.length === 0
              ? ''
              : ' · T' + String(runningDetail.turns[runningDetail.turns.length - 1].n)),
          running: true,
          ...(runningDetail.partial === true ? { detail: t('state.partialTurn') } : {}),
        }

  const openPath = props.openPath
  const actions: InspectorActions = {
    onSelectFile: (path: string) => applyFocus(select.file(path)),
    onSelectTurn: (sid: string, turn: number) => applyFocus(select.turn(sid, turn)),
    onSelectSession: (sid: string) => applyFocus(select.session(sid)),
    ...(openPath === undefined ? {} : { onOpenFile: openPath }),
    onFocusInMap: (selection: Selection) => {
      applyFocus(selection)
      setViewport(undefined)
    },
    onOpenModal: (sid: string) => openModal(sid),
    onClose: () => setState((previous) => selectionReducer(previous, { type: 'closeInspector' })),
    onRetry: () => data.retry(),
  }

  const legend = h(Legend, {
    title: t('legend.title'),
    items: FILE_FAMILIES.map((kind) => ({ kind, label: t(FAMILY_MESSAGE_KEY[kind]) })),
    testId: 'legend',
  })

  const layerToggles = h(
    'span',
    { className: 'threadline-inline-group', 'data-role': 'layer-toggles' },
    h(Chip, {
      label: t('map.showAllRelations'),
      onClick: () => setLayers((previous) => ({ ...previous, all: { on: !(previous.all?.on ?? false), focusOnly: false } })),
    }),
    h(Chip, {
      label: t('map.onlyCurrent'),
      onClick: () => setRange(range === 'range.all' ? 'range.today' : range),
    }),
  )

  /* ---------------- 工具条（列表视图 / 隐私） ---------------- */
  const headerActions = h(
    'span',
    { className: 'threadline-inline-group', 'data-role': 'tab-actions' },
    h(Button, {
      label: t('inspector.listView'),
      variant: 'outline',
      pressed: listView === 'list',
      onClick: () => setListView((value) => (value === 'list' ? 'off' : 'list')),
      testId: 'list-toggle',
    }),
    h(Button, {
      label: t('privacy.mode'),
      variant: 'outline',
      pressed: hidden,
      onClick: () => privacy.toggle(),
      testId: 'privacy-toggle',
    }),
  )

  /* ---------------- 诊断条（T13b：failed / degrade 时可见，一行 key=value） ---------------- */
  const diagVisible = shouldShowDiag({ status: data.status, degradeKind: data.degrade.kind })
  const diagItems: Array<[string, string]> = diagVisible
    ? buildDiagItems({
        status: data.status,
        degradeKind: data.degrade.kind,
        code: data.degrade.code ?? (data.error?.code ?? 'none'),
        scannable,
        sessions: scope.sessions.length,
        files: data.graph.files.size,
        references: referenceLayer.status,
      })
    : []

  /* ---------------- 主区：星图 or 列表视图 ---------------- */
  const mapArea =
    listView === 'list'
      ? h(
          'div',
          {
            className: 'threadline-listview',
            'data-testid': 'list-view',
            'data-reduced-motion': reduced ? 'true' : 'false',
            'data-virtualized': virtualized ? 'true' : 'false',
            ref: listRef,
            onScroll: onListScroll,
            style: {
              position: 'absolute',
              inset: 0,
              overflow: 'auto',
              padding: 8,
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              transitionProperty: 'scroll-behavior',
              transitionDuration: motionMs + 'ms',
            },
          },
          h('div', {
            'data-role': 'list-spacer-top',
            style: { blockSize: fileWindow.offset + 'px', flex: '0 0 auto' },
          }),
          h(FileListView, {
            rows: visibleFileRows,
            t,
            mode,
            sort: fileSort,
            onSort: setFileSort,
            selectedKey: effective.kind === 'file' ? effective.path.toLowerCase() : null,
            onSelect: selectFromList,
            onEscape: () => setState((previous) => selectionReducer(previous, { type: 'blank' })),
            onFocusInMap: focusInMap,
            testId: 'file-list',
          }),
          h('div', {
            'data-role': 'list-spacer-bottom',
            style: {
              blockSize: virtualized
                ? Math.max(0, fileRows.length * LIST_ROW_HEIGHT - fileWindow.offset - fileWindow.size) + 'px'
                : '0px',
              flex: '0 0 auto',
            },
          }),
          turnRows.length === 0
            ? null
            : h(TurnListView, {
                rows: turnRows,
                t,
                mode,
                sort: turnSort,
                onSort: setTurnSort,
                selectedKey: effective.kind === 'turn' ? 'turn:' + String(effective.turn) : null,
                onSelect: selectFromList,
                onEscape: () => setState((previous) => selectionReducer(previous, { type: 'blank' })),
                onFocusInMap: focusInMap,
                testId: 'turn-list',
              }),
        )
      : h(
          'div',
          {
            'data-testid': 'map-host',
            'data-reduced-motion': reduced ? 'true' : 'false',
            style: { position: 'absolute', inset: 0 },
          },
          h(MapView, {
    showLegend: false,   // 图例由 Shell 的 legendSlot 统一渲染（避免两份图例叠在一起）
            nodes,
            edges,
            ...(effective.kind === 'file' ? { selectedPath: effective.path } : {}),
            onSelectFile: (path) => {
              if (path !== null) applyFocus(select.file(path))
            },
            ...(openPath === undefined ? {} : { onOpenFile: openPath }),
            currentTurnPaths,
            now,
            reducedMotion: reduced,
            ...(visiblePaths === null ? {} : { visiblePaths }),
            ...(effective.kind === 'turn' ? { selectedTurn: { sessionId: effective.sessionId, turn: effective.turn } } : {}),
            ...(layers.all === undefined ? {} : { showAllRelations: layers.all.on }),
            onShowAllRelationsChange: (value) => setLayers((previous) => ({ ...previous, all: { on: value, focusOnly: false } })),
            ...(viewport === undefined ? {} : { viewport }),
            onViewportChange: setViewport,
            locale,
            testId: 'map',
          }),
        )

  /* ---------------- ⑤ 引用层不可观测的横幅（不伪造 0 条） ---------------- */
  const referenceBanner =
    referenceLayer.status === 'disabled'
      ? h(
          'div',
          {
            className: 'threadline-inspector-banner',
            'data-tone': 'warning',
            'data-testid': 'reference-disabled',
            role: 'status',
          },
          referenceDisabledText(t),
        )
      : null

  // D-30：这一层只负责挂「宿主区域标记」，自己不吃空间（几何在 base.css 的 .threadline-surface-host）
  return h(
    'div',
    { ref: surfaceRef, className: 'threadline-surface-host' },
    h(ThreadlineShell, {
    locale,
    workspaceName: scope.workspaceTitle ?? t('tab.title'),
    range,
    onRangeChange: setRange,
    coverageSlot: h(ProgressPill, {
      state: coverage.state,
      done: coverage.done,
      total: coverage.total,
      failed: coverage.failed,
      text: coverage.text,
      retryLabel: t('coverage.retry'),
      onRetry: () => data.retry(),
      testId: 'coverage-pill',
    }),
    headerActionsSlot: headerActions,
    ...(nowStrip === null ? {} : { nowStrip }),
    mapSlot: h(
      'div',
      { className: 'threadline-tab-main', 'data-testid': 'tab-main' },
      diagVisible
        ? h(
            'div',
            { className: 'threadline-diag-bar', 'data-threadline-diag': '', role: 'status' },
            ...diagItems.map(([key, value]) => h('span', { key, 'data-key': key }, key + '=' + value)),
          )
        : null,
      h('div', { className: 'threadline-tab-main-body' }, mapArea),
    ),
    legendSlot: legend,
    inspectorOpen: state.inspectorOpen === true,
    onInspectorClose: () => setState((previous) => selectionReducer(previous, { type: 'closeInspector' })),
    inspectorTitle: inspectorTitleFor(effective, t),
    inspectorSlot: h(
      'div',
      { className: 'threadline-inspector-stack', 'data-testid': 'inspector-stack' },
      referenceBanner,
      h(Inspector, {
        t,
        data: inspectorData,
        selection: effective,
        privacyMode: hidden,
        now,
        actions,
        legendSlot: legend,
        layerTogglesSlot: layerToggles,
        testId: 'inspector',
      }),
    ),
    timelineSlot: h(Timeline, {
      range,
      domain,
      playhead: at,
      onPlayheadChange: (value: number) => setPlayhead(value),
      playing,
      onPlayingChange: setPlaying,
      nodes: timelineNodes,
      sessions: timelineSessions,
      now,
      locale,
      reducedMotion: reduced,
      ...(listView === 'list' ? { announce: () => '' } : {}),
      testId: 'timeline',
    }),
    turnStripTitle: t('inspector.turn'),
    turnStripCollapsed: false,
    turnStripHeadSlot: h(SessionSelector, {
      t,
      sessions: stripSessions,
      scope: turnScope,
      onScopeChange: (next: TurnScope) => setTurnScope(next),
      privacyMode: hidden,
    }),
    turnStripSlot: h(TurnStrip, {
      t,
      groups,
      sessions: stripSessions,
      selected: state.selected,
      preview: state.preview,
      onPreview: (target: Selection | null) => setState((previous) => selectionReducer(previous, { type: 'hover', target })),
      onSelect: (target: Selection) => setState((previous) => selectionReducer(previous, { type: 'click', target })),
      onDoubleClick: (target: Selection) => applyFocus(target),
      onClearSelection: () => setState((previous) => selectionReducer(previous, { type: 'blank' })),
      onEscape: () => setState((previous) => selectionReducer(previous, { type: 'escape' })),
      now,
      privacyMode: hidden,
      loading: currentEntry?.status === 'loading' && currentDetail === null,
      testId: 'turn-strip',
    }),
    testId: props.testId ?? 'threadline-tab',
    }),
  )
}

/** 注册「脉络」tab（`conversation.view`；order 30 = 在 chat / trajectory 之后）。 */
export function registerTab(
  ctx: ClientScopeLike,
  options?: { locale?: Locale; openPath?: (path: string) => void; getRemote?: () => unknown },
): boolean {
  return registerSlot(
    ctx,
    'conversation.view',
    { id: 'threadline', order: 30, label: () => createTranslator(options?.locale ?? DEFAULT_LOCALE)('tab.label') },
    (props: never) => {
      const owner = props as unknown as TabOwnerProps
      const remote = owner.remote ?? options?.getRemote?.()
      return h(ThreadlineTabView, {
        ...owner,
        ...(options?.locale === undefined ? {} : { locale: options.locale }),
        ...(options?.openPath === undefined ? {} : { openPath: options.openPath }),
        ...(remote === undefined ? {} : { remote }),
      })
    },
    'threadline: conversation view',
  )
}
