/*
 * entries/tab.ts —— 「脉络」tab（`conversation.view`；33 §1/§2/§3，脉络 2.0）。
 *
 * 组件职责：把一个工作区的只读记录拼成
 *   header + Now strip + 左列（文件关系图 / 时间轴 / 轮次带，sticky）+ 右列（目录卡片两列），
 * 全页单滚动；**没有检查器、没有弹窗**。三者共享同一个 selectionReducer（`ui/turns`）。
 *
 * 2.0 变化（相对 1.0）：
 * - 左图是**文件**关系图（不是目录节点图）：默认当前目录；点右卡切目录；点轮次切成该轮文件 + 状态；
 * - 右栏目录卡片两列（内容沿用 1.0）；点击切换左图目录并高亮；
 * - 检查器渲染/默认选中全部删除；文件级删除不可证，图上只给「读 / 写行数 / 首见」；
 * - `openModal`/`Inspector` 接线删除（modal 组件由 nav-dev 删除，本文件不再引用）。
 *
 * 边界：不注册其它 slot；不 append 到 body；不写存储；数据来自 client data 层。
 */
import * as React from 'react'
import { createTranslator, DEFAULT_LOCALE, type Locale, type Translator } from '../locale/index.ts'
import {
  detailLoadingOf,
  detailViewOf,
  isScannableScope,
  turnDetailOf,
  useThreadlineData,
  useThreadlineDetail,
  useWorkspaceScope,
  type FetchLike,
  type WorkspacesSnapshot,
  type WorkspaceScope,
} from '../data/index.ts'
import type { FileNode, SessionDetail, ThreadlineStatus, TurnDetail } from '../../shared/events/index.ts'
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
import { Button, Chip, ProgressPill } from '../ui/common/index.ts'
import { FileGraph } from '../ui/map/index.ts'
import { DIRECTORY_TOP_FILES, buildDirectoryCards, buildDirectoryRelationSummary, directoryKeyOf } from '../ui/rail/index.ts'
import { DirectoryRail } from '../ui/rail/index.ts'
import { Timeline, visiblePathsAt, type TimeRange } from '../ui/timeline/index.ts'
import {
  NO_SELECTION,
  SessionSelector,
  TurnStrip,
  buildTurnGroups,
  createSelectionState,
  effectiveSelection,
  escapeSelection,
  select,
  selectionKey,
  selectionReducer,
  turnFileStatusOf,
  type Selection,
  type TurnScope,
  type TurnStripSession,
} from '../ui/turns/index.ts'
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

/** 列表视图模式（关闭 / 文件表 + 轮次表；2.0 里是图的替代视图）。 */
export type ListViewMode = 'off' | 'list'

/** `conversation.view` 的 ownerProps（+ 我们允许注入的测试/宿主字段）。 */
export interface TabOwnerProps {
  viewRequest?: { view?: string; focus?: string | null } | null
  completeViewRequest?: () => void
  openView?: (view: string, focus?: string) => void
  inspectCall?: unknown
  sessionId?: string
  useSessions?: SnapshotHook
  useWorkspaces?: SnapshotHook
  fetch?: FetchLike
  locale?: Locale
  now?: number
  openPath?: (path: string) => void
  remote?: unknown
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

/** 覆盖率 → ProgressPill 的文案/状态（与外壳同一口径）。 */
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

/**
 * 图区空态文案（33 §8.8）：观测不到 / 无记录 / 有对话但无文件操作，三者不可混用。
 */
export function graphEmptyStateOf(
  input: { degradeKind: string; hasFiles: boolean; hasSessions: boolean },
  t: Translator,
): { title: string } | undefined {
  if (input.degradeKind === 'hostUnavailable' || input.degradeKind === 'capability-missing') {
    return { title: t('state.hostUnavailable') }
  }
  if (input.degradeKind === 'failed') return { title: t('state.unknown') }
  if (input.hasFiles) return undefined
  if (input.hasSessions) return { title: t('state.emptyFiles') }
  return { title: t('state.emptyWorkspace') }
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
  // 33 §2：默认不选中（检查器已移除）；选择只服务图高亮/轮次视图。
  const [state, setState] = React.useState(() => createSelectionState(NO_SELECTION, false))
  const [listView, setListView] = React.useState<ListViewMode>('off')
  const [fileSort, setFileSort] = React.useState<SortState>(DEFAULT_FILE_SORT)
  const [turnSort, setTurnSort] = React.useState<SortState>(DEFAULT_TURN_SORT)
  const [listScroll, setListScroll] = React.useState(0)
  const [listViewport, setListViewport] = React.useState(420)
  const [playing, setPlaying] = React.useState(false)
  const [playhead, setPlayhead] = React.useState<number | null>(null)
  // 1.1：directoryKey 是「点击 pin 的目录簇」；总览始终存在，没有默认目录。
  const [directoryKey, setDirectoryKey] = React.useState<string | null>(null)
  const [hoverDirectory, setHoverDirectory] = React.useState<string | null>(null)
  const [hoverPath, setHoverPath] = React.useState<string | null>(null)
  const [now, setNow] = React.useState<number>(() => props.now ?? Date.now())
  const [reference, setReference] = React.useState<ReferenceResolutionView | null>(null)
  const listRef = React.useRef<HTMLDivElement | null>(null)
  const markedRef = React.useRef(false)
  const surfaceRef = React.useRef<HTMLDivElement | null>(null)
  useComposerSurface(surfaceRef)
  // 2.0：`conversation.view` 的宿主滚动容器是 `[data-conversation-scroll]`；它的内容高度是 auto，
  // 所以 `block-size:100%` 只会拿到内容高度。把 surface 固定到宿主**可视高度**，外壳才是真正滚动容器。
  React.useLayoutEffect(() => {
    const surface = surfaceRef.current
    if (surface === null) return undefined
    let host: HTMLElement | null = null
    const apply = (): void => {
      if (host === null) return
      const height = host.clientHeight
      if (height > 0) surface.style.blockSize = height + 'px'
      surface.style.minBlockSize = '0'
    }
    const findHost = (): void => {
      host = surface.closest<HTMLElement>('[data-conversation-scroll]')
      if (host === null) return
      apply()
      // 宿主原来可能停在会话底部；内容变短后主动清零（只做一次，不跟随用户滚动）。
      if (host.scrollTop > 0) host.scrollTop = 0
    }
    findHost()
    if (host === null) {
      const retry = window.requestAnimationFrame(findHost)
      return () => window.cancelAnimationFrame(retry)
    }
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => apply())
    observer?.observe(host)
    window.addEventListener('resize', apply)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', apply)
    }
  }, [])

  React.useEffect(() => {
    if (props.now !== undefined) return undefined
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [props.now])

  const effective = effectiveSelection(state)
  const selectionSessionId =
    effective.kind === 'turn' || effective.kind === 'session' ? effective.sessionId : sessionId
  const detailCwd = scannable ? scope.cwd : undefined
  const rowUpdatedAtOf = (id: string): number | undefined => {
    const row = scope.sessions.find((session) => session.id === id)
    return row === undefined ? undefined : row.updatedAt
  }
  const currentRowUpdatedAt = rowUpdatedAtOf(sessionId)
  const selectionRowUpdatedAt = rowUpdatedAtOf(selectionSessionId)
  const currentEntry = useThreadlineDetail(store, sessionId === '' ? null : sessionId, {
    ...(currentRowUpdatedAt === undefined ? {} : { updatedAt: currentRowUpdatedAt }),
    ...(detailCwd === undefined ? {} : { cwd: detailCwd }),
  })
  const activeEntry = useThreadlineDetail(
    store,
    selectionSessionId === '' || selectionSessionId === sessionId ? null : selectionSessionId,
    {
      ...(selectionRowUpdatedAt === undefined ? {} : { updatedAt: selectionRowUpdatedAt }),
      ...(detailCwd === undefined ? {} : { cwd: detailCwd }),
    },
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
  const groups = React.useMemo(
    () => buildTurnGroups({ scope: turnScope, currentSessionId: sessionId, sessions: stripSessions, details }),
    [turnScope, sessionId, stripSessions, details],
  )
  const nodes = React.useMemo(() => Array.from(data.graph.files.values()), [data.graph.files])
  // 默认目录 = **当前会话**里文件操作最多的目录（33 §4.1）；工作区其它会话不参与第一眼。
  const fileIndex = React.useMemo(() => {
    const map = new Map<string, FileNode>()
    for (const file of nodes) {
      map.set(file.path, file)
      map.set(file.path.toLowerCase(), file)
    }
    return map
  }, [nodes])

  /* ---------------- 引用层（能力探测；不可用 → 显式 disabled） ---------------- */
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

  /* ---------------- 关系边（结构 + 共现 + 引用；时序只在该轮视图里） ---------------- */
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

  /* ---------------- 首帧可用打点（只记录，不写盘） ---------------- */
  React.useEffect(() => {
    if (markedRef.current) return
    if (!data.graph.applied && nodes.length === 0) return
    markedRef.current = true
    markFirstUsable()
  }, [data.graph.applied, nodes.length])

  /* ---------------- 焦点 / 选择（没有默认选中） ---------------- */
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
    if (result.target !== null) {
      applyFocus(result.target)
      if (result.target.kind === 'file') {
        setDirectoryKey(result.target.path.indexOf('/') <= 0 ? '' : result.target.path.slice(0, result.target.path.indexOf('/')))
        }
    }
  }, [props.viewRequest, props.completeViewRequest, sessionId, applyFocus])

  React.useEffect(() => {
    if (sessionId === '') return
    const target = takeFocus(sessionId)
    if (target === null) return
    const selection = selectionOfFocus(target)
    applyFocus(selection)
    if (selection.kind === 'file') {
      const slash = selection.path.indexOf('/')
      setDirectoryKey(slash <= 0 ? '' : selection.path.slice(0, slash))
    }
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

  /* ---------------- 列表视图（图的替代视图；T10 a11y） ---------------- */
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

  /** 列表里「在图中聚焦」：切到该文件所在目录并选中该文件。 */
  const focusInMap = React.useCallback(
    (key: string) => {
      selectFromList(key)
      const row = key.startsWith('turn:') ? undefined : fileRows.find((item) => item.key === key)
      if (row !== undefined) {
        const slash = row.path.indexOf('/')
        setDirectoryKey(slash <= 0 ? '' : row.path.slice(0, slash))
        }
      setListView('off')
    },
    [selectFromList, fileRows],
  )

  /* ---------------- 时间轴 / 图数据 ---------------- */
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
          ...(session.title === undefined ? {} : { title: maskTitle({ sessionId: session.id, title: session.title }, 0, mode, t) }),
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

  /* ---------------- 详情三态 + 本轮视图（文件 + 状态） ---------------- */
  const activeView = React.useMemo(
    () =>
      selectionSessionId === sessionId
        ? detailViewOf(currentEntry, { ...(currentRowUpdatedAt === undefined ? {} : { updatedAt: currentRowUpdatedAt }) })
        : detailViewOf(activeEntry, { ...(selectionRowUpdatedAt === undefined ? {} : { updatedAt: selectionRowUpdatedAt }) }),
    [selectionSessionId, sessionId, currentEntry, currentRowUpdatedAt, activeEntry, selectionRowUpdatedAt],
  )
  const turnTarget = effective.kind === 'turn' ? effective : null
  const turnView = React.useMemo(
    () => (turnTarget === null ? null : turnDetailOf(activeView, turnTarget.turn)),
    [turnTarget, activeView],
  )
  // 只有错误态才丢弃可画数据；loading 时保留旧轮次（图会盖骨架，不显示 0）。
  const activeTurn: TurnDetail | null = turnView?.turn ?? null
  const turnLoading = turnView?.status === 'loading'
  const turnStatus = React.useMemo(
    () => (activeTurn === null ? null : turnFileStatusOf(activeTurn, data.graph.files)),
    [activeTurn, data.graph.files],
  )
  const directoryCards = React.useMemo(
    () => buildDirectoryCards(nodes, { rootLabel: t('map.rootCluster'), currentTurnPaths }),
    [nodes, currentTurnPaths, t],
  )
  // 1.1：directoryKey = 点击 pin 的目录；默认不 pin，总览显示全部目录。
  const focusedDirectoryKey = React.useMemo(() => {
    if (directoryKey === null) return null
    return directoryCards.some((card) => card.key === directoryKey) ? directoryKey : null
  }, [directoryKey, directoryCards])
  const hoveredDirectoryKey = React.useMemo(() => {
    if (hoverDirectory === null) return null
    return directoryCards.some((card) => card.key === hoverDirectory) ? hoverDirectory : null
  }, [hoverDirectory, directoryCards])
  const graphDirectoryKey = focusedDirectoryKey ?? ''
  const directoryLabel = React.useMemo(
    () => (focusedDirectoryKey === null ? t('map.overview') : focusedDirectoryKey === '' ? t('map.rootCluster') : focusedDirectoryKey),
    [focusedDirectoryKey, t],
  )
  const turnFiles = React.useMemo(() => {
    if (activeTurn === null) return []
    const list: FileNode[] = []
    for (const touch of activeTurn.files) {
      const node = fileIndex.get(touch.path) ?? fileIndex.get(touch.path.toLowerCase())
      if (node !== undefined) list.push(node)
    }
    return list
  }, [activeTurn, fileIndex])
  const turnDirectoryKeys = React.useMemo(() => {
    const keys = new Set<string>()
    for (const file of turnFiles) keys.add(directoryKeyOf(file.path))
    return keys
  }, [turnFiles])
  const mode2: 'overview' | 'turn' = turnTarget === null ? 'overview' : 'turn'
  const graphFiles = mode2 === 'turn' ? turnFiles : nodes
  const directoryRelations = React.useMemo(
    () => buildDirectoryRelationSummary(directoryCards, edges),
    [directoryCards, edges],
  )
  // 轮次关系数：只统计本轮文件之间的边（同一份 edges；确定性）。
  const turnRelations = React.useMemo(() => {
    const map = new Map<string, number>()
    for (const [sid, detail] of details) {
      for (const turn of detail.turns) {
        const keys = new Set(turn.files.map((file) => file.path.toLowerCase()))
        let count = 0
        for (const edge of edges) {
          if (keys.has(edge.from.toLowerCase()) && keys.has(edge.to.toLowerCase())) count += 1
        }
        if (count > 0) map.set(selectionKey({ kind: 'turn', sessionId: sid, turn: turn.n }), count)
      }
    }
    return map
  }, [details, edges])
  // 文件 → 轮次 / 目录 → 轮次（只用已加载详情；未加载不猜）。
  const fileTurnKeys = React.useMemo(() => {
    const map = new Map<string, Set<string>>()
    for (const [sid, detail] of details) {
      for (const turn of detail.turns) {
        const key = selectionKey({ kind: 'turn', sessionId: sid, turn: turn.n })
        for (const file of turn.files) {
          const path = file.path.toLowerCase()
          const set = map.get(path)
          if (set === undefined) map.set(path, new Set([key]))
          else set.add(key)
        }
      }
    }
    return map
  }, [details])
  const dirTurnKeys = React.useMemo(() => {
    const map = new Map<string, Set<string>>()
    for (const [sid, detail] of details) {
      for (const turn of detail.turns) {
        const key = selectionKey({ kind: 'turn', sessionId: sid, turn: turn.n })
        for (const file of turn.files) {
          const dir = directoryKeyOf(file.path)
          const set = map.get(dir)
          if (set === undefined) map.set(dir, new Set([key]))
          else set.add(key)
        }
      }
    }
    return map
  }, [details])
  const hoverRelatedTurnKeys = React.useMemo(() => {
    if (hoverPath !== null) return fileTurnKeys.get(hoverPath) ?? null
    if (hoveredDirectoryKey !== null) return dirTurnKeys.get(hoveredDirectoryKey) ?? null
    return null
  }, [hoverPath, hoveredDirectoryKey, fileTurnKeys, dirTurnKeys])
  const hoverRelatedDirectoryKeys = React.useMemo(() => {
    if (hoverPath !== null) return new Set([directoryKeyOf(hoverPath)])
    if (hoveredDirectoryKey !== null) return new Set([hoveredDirectoryKey])
    if (activeTurn !== null) return turnDirectoryKeys
    return null
  }, [hoverPath, hoveredDirectoryKey, activeTurn, turnDirectoryKeys])
  const selectedPath = effective.kind === 'file' ? effective.path : null
  const selectedFileInGraph = React.useMemo(
    () => (selectedPath === null ? null : graphFiles.some((file) => file.path === selectedPath) ? selectedPath : null),
    [selectedPath, graphFiles],
  )

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
            (runningDetail.turns.length === 0 ? '' : ' · T' + String(runningDetail.turns[runningDetail.turns.length - 1].n)),
          running: true,
          ...(runningDetail.partial === true ? { detail: t('state.partialTurn') } : {}),
        }

  /* ---------------- 回调：图/卡片/轮次 ---------------- */
  const selectFile = React.useCallback(
    (path: string | null) => {
      if (path === null) {
        setState((previous) => selectionReducer(previous, { type: 'blank' }))
        return
      }
      if (path === selectedPath) {
        setState((previous) => selectionReducer(previous, { type: 'blank' }))
        return
      }
      applyFocus(select.file(path))
    },
    [applyFocus, selectedPath],
  )
  // 1.1：点卡片 pin/收起目录簇；再点同一张收起；传入 null = 点空白取消。
  const selectDirectory = React.useCallback(
    (key: string | null) => {
      setHoverDirectory(null)
      setHoverPath(null)
      if (activeTurn !== null) setState((previous) => selectionReducer(previous, { type: 'blank' }))
      setDirectoryKey((previous) => (key === null ? null : previous === key ? null : key))
    },
    [activeTurn],
  )
  const selectTurn = React.useCallback(
    (target: Selection) => {
      if (target.kind !== 'turn') return
      if (effective.kind === 'turn' && effective.sessionId === target.sessionId && effective.turn === target.turn) {
        setState((previous) => selectionReducer(previous, { type: 'blank' }))
        return
      }
      applyFocus(target)
    },
    [effective, applyFocus],
  )
  // hover 只做预览：不改变点击选择、不写存储、不改滚动。
  const onHoverDirectory = React.useCallback((key: string | null) => {
    setHoverDirectory(key)
    if (key !== null) {
      // 悬停卡片 = 目录预览优先；清掉轮次预览，避免两个预览打架。
      setHoverPath(null)
      setState((previous) => (previous.preview === null ? previous : selectionReducer(previous, { type: 'hover', target: null })))
    }
  }, [])
  const onHoverFile = React.useCallback((path: string | null) => setHoverPath(path === null ? null : path.toLowerCase()), [])
  const exitTurn = React.useCallback(() => {
    setState((previous) => selectionReducer(previous, { type: 'blank' }))
  }, [])

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

  /* ---------------- 诊断条（failed / degrade 时可见） ---------------- */
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

  /* ---------------- 左列：图（或列表视图） ---------------- */
  const workspaceLoading = nodes.length === 0 && (coverage.state === 'loading' || data.graph.applied !== true)
  const emptyState = graphEmptyStateOf(
    { degradeKind: data.degrade.kind, hasFiles: nodes.length > 0, hasSessions: scope.sessions.length > 0 },
    t,
  )
  const graphLoading = mode2 === 'turn' ? turnLoading : workspaceLoading
  const graphLoadingLabel =
    mode2 === 'turn' && turnTarget !== null ? t('graph.loadingTurn', { n: turnTarget.turn }) : t('graph.loading')
  const turnEmpty = mode2 === 'turn' && turnView?.status === 'ready' && activeTurn !== null && activeTurn.files.length === 0
  const turnUnknown = mode2 === 'turn' && turnView?.status === 'unknown'
  const coverageNote =
    scope.sessions.length > details.size && details.size > 0
      ? t('graph.coverage', { n: details.size })
      : undefined
  const listNode =
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
              overflow: 'auto',
              padding: 8,
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              maxBlockSize: 520,
              transitionProperty: 'scroll-behavior',
              transitionDuration: motionMs + 'ms',
            },
          },
          h('div', { 'data-role': 'list-spacer-top', style: { blockSize: fileWindow.offset + 'px', flex: '0 0 auto' } }),
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
              blockSize: virtualized ? Math.max(0, fileRows.length * LIST_ROW_HEIGHT - fileWindow.offset - fileWindow.size) + 'px' : '0px',
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
      : null
  const graphSlot = h(
    'div',
    { className: 'threadline-graph-stack', 'data-testid': 'map-host' },
    diagVisible
      ? h(
          'div',
          { className: 'threadline-diag-bar', 'data-threadline-diag': '', role: 'status' },
          ...diagItems.map(([key, value]) => h('span', { key, 'data-key': key }, key + '=' + value)),
        )
      : null,
    referenceBanner,
    listNode ??
      h(FileGraph, {
        files: graphFiles,
        edges,
        mode: mode2,
        cards: mode2 === 'overview' ? directoryCards : undefined,
        hoveredDirectoryKey,
        focusedDirectoryKey,
        onHoverDirectory,
        onFocusDirectory: selectDirectory,
        directoryKey: graphDirectoryKey,
        directoryLabel,
        onHoverFile,
        turn: activeTurn === null || turnStatus === null ? null : { turn: activeTurn, status: turnStatus },
        selectedPath: selectedFileInGraph,
        onSelectFile: selectFile,
        onOpenFile: props.openPath,
        onExitTurn: exitTurn,
        currentTurnPaths,
        now,
        locale,
        reducedMotion: reduced,
        loading: graphLoading,
        loadingLabel: graphLoadingLabel,
        coverageNote,
        ...(turnEmpty
          ? { emptyTitle: t('graph.emptyTurn') }
          : turnUnknown
            ? { emptyTitle: t('state.unknown') }
            : emptyState === undefined
              ? {}
              : { emptyTitle: emptyState.title }),
        testId: 'graph',
      }),
  )

  return h(
    'div',
    {
      ref: surfaceRef,
      className: 'threadline-surface-host',
      // hover 预览只在整块 tab 内有效：移出整个视图才清空（从卡片移到图/轮次时保持预览）。
      onMouseLeave: () => {
        setHoverDirectory(null)
        setHoverPath(null)
        setState((previous) => (previous.preview === null ? previous : selectionReducer(previous, { type: 'hover', target: null })))
      },
    },
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
      graphSlot,
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
        relatedKeys: hoverRelatedTurnKeys,
        relationCountByKey: turnRelations,
        onPreview: (target: Selection | null) => {
          if (target !== null) {
            // 悬停轮次 = 轮次预览优先；清掉目录卡片的预览。
            setHoverDirectory(null)
            setHoverPath(null)
          }
          setState((previous) => selectionReducer(previous, { type: 'hover', target }))
        },
        onSelect: (target: Selection) => {
          // 点同一条轮次 = 退出本轮视图（33 §3）；否则进入该轮。
          setState((previous) => {
            const current = previous.selected
            const toggling =
              target.kind === 'turn' &&
              current.kind === 'turn' &&
              current.sessionId === target.sessionId &&
              current.turn === target.turn
            return selectionReducer(previous, toggling ? { type: 'blank' } : { type: 'click', target })
          })
        },
        onDoubleClick: (target: Selection) => applyFocus(target),
        onClearSelection: exitTurn,
        onEscape: exitTurn,
        now,
        privacyMode: hidden,
        loading: detailLoadingOf(currentEntry),
        testId: 'turn-strip',
      }),
      railSlot: h(DirectoryRail, {
        nodes,
        selectedKey: focusedDirectoryKey,
        hoveredKey: hoveredDirectoryKey,
        relatedKeys: hoverRelatedDirectoryKeys,
        activeKeys: mode2 === 'turn' && hoveredDirectoryKey === null ? turnDirectoryKeys : null,
        relationByKey: directoryRelations,
        onHover: onHoverDirectory,
        currentTurnPaths,
        onSelect: selectDirectory,
        locale,
        formatTime: (value: number) => new Date(value).toISOString().slice(0, 16).replace('T', ' '),
        testId: 'directory-rail',
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
