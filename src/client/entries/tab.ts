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
import { FileTreeRail } from '../ui/rail/index.ts'
import { useDirectoryTree, type TreeEntry } from '../data/index.ts'
// 派生计算（R06）：边端点邻接索引 + 轮次关系计数 + 当前目录内边过滤。
// 这三个函数与 tab 里的旧内联实现**逐 key 等价**（R06 与 Lead 各验一次），但把
// 「每条边 × 每一轮」的 O(轮次×边) 降成 O(轮次 × 本轮文件 × 出度)。
import { buildEdgeEndpointIndex, createInputMemo, filterEdgesWithin, turnRelationCounts } from '../perf/index.ts'
import { Timeline, windowForRange, type TimeRange } from '../ui/timeline/index.ts'
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
  useReducedMotion,
  type SortState,
} from '../a11y/index.ts'
import { defaultFetch, readSnapshot, registerSlot, type ClientScopeLike, type SnapshotHook } from './context.ts'

const h = React.createElement

/** 列表视图模式（关闭 / 文件表 + 轮次表；2.0 里是图的替代视图）。 */
export type ListViewMode = 'off' | 'list'

/** 取文件所在目录（工作区相对；根层文件返回 ''）。右栏目录树的导航与「列表里在图中聚焦」都用它。 */
function dirOfPath(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash < 0 ? '' : path.slice(0, slash)
}

/** 卡片/图共用的本地时间文案（Q6 顺带修掉 rail 用 UTC 的问题）。 */
function formatLocalTime(value: number): string {
  const date = new Date(value)
  const pad = (n: number): string => (n < 10 ? '0' + n : String(n))
  return pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes())
}

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
 * 模块作用域的派生量 memo（R06 的 P2：**跨 React 重挂载复用**）。
 *
 * 为什么需要：`React.useMemo` 的缓存挂在组件实例上，tab 一卸载/重挂载（用户切走再切回、
 * 切换 tab）就全丢，导致「第二次打开」仍要重算全部派生量（PERF 实测 p95 340.7ms，
 * 超 50ms 预算 6.8×）。把这几条重派生提到模块作用域、按**入参身份**命中，重挂载即同帧出内容。
 *
 * 失效纪律（不做永久缓存）：
 * - `edges`：入参含 `data.graph`（数据版本变化即换身份）、详情对象引用、`effective`、`reference`；
 * - 传的是**稳定来源**，不传 `details` 这种每帧新建的 Map（否则永不命中，等于没缓存）；
 * - 切工作区时入参里的 `data.graph` 必然换身份 → 自然失效，不需要手工清。
 *   只在测试 / 显式重置时调 `clear()`。
 */
const InputMemos = {
  edges: createInputMemo<GraphEdge[]>(),
  turnRelations: createInputMemo<Map<string, number>>(),
  fileTurnKeys: createInputMemo<Map<string, Set<string>>>(),
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
export function shouldShowDiag(input: {
  status: string
  degradeKind: string
  /** 被容错跳过的会话数：> 0 时也要显示，否则"少读了几条"就是静默遗漏。 */
  skipped?: number
}): boolean {
  if ((input.skipped ?? 0) > 0) return true
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
  /** 被容错跳过的会话数（协议层 + 归属层 + refresh），0 时不出这一段。 */
  skipped?: number
}): Array<[string, string]> {
  const items: Array<[string, string]> = [
    ['status', input.status],
    ['degrade', input.degradeKind],
    ['code', input.code],
    ['scannable', input.scannable ? 'yes' : 'no'],
    ['sessions', String(input.sessions)],
    ['files', String(input.files)],
    ['refs', input.references],
  ]
  // 只在真的丢了东西时追加，保持默认画面干净。
  if ((input.skipped ?? 0) > 0) items.push(['skipped', String(input.skipped)])
  return items
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
  // 右栏目录树（M4）：首选 remote.workspaceFiles.list，不可用则 host 只读 fallback（B1 已批准）。
  // cwd 必须传：已安装 API 对空串 path 抛 gateway/bad-request，根层要用 cwd 绝对路径。
  const tree = useDirectoryTree({
    sessionId,
    ...(props.remote === undefined ? {} : { remote: props.remote }),
    fetch: fetchImpl,
    cwd: scope.cwd ?? '',
    enabled: scannable,
  })

  const [range, setRange] = React.useState<RangeKey>('range.all')
  const [turnScope, setTurnScope] = React.useState<TurnScope>({ kind: 'current' })
  // 33 §2：默认不选中（检查器已移除）；选择只服务图高亮/轮次视图。
  const [state, setState] = React.useState(() => createSelectionState(NO_SELECTION, false))
  const [listView, setListView] = React.useState<ListViewMode>('off')
  const [fileSort, setFileSort] = React.useState<SortState>(DEFAULT_FILE_SORT)
  const [turnSort, setTurnSort] = React.useState<SortState>(DEFAULT_TURN_SORT)
  const [listScroll, setListScroll] = React.useState(0)
  const [listViewport, setListViewport] = React.useState(420)
  const [playhead, setPlayhead] = React.useState<number | null>(null)
  // 1.2.0 返工：右栏是工作区根目录浏览器，目录状态由 tree 数据层持有（不再有 drillPath/pin）。
  const [railView, setRailView] = React.useState<'cards' | 'list'>('cards')
  const [hoverPath, setHoverPath] = React.useState<string | null>(null)
  const [now, setNow] = React.useState<number>(() => props.now ?? Date.now())
  // 切工作区/会话重置播放头与右栏视图（目录状态由 useDirectoryTree 按 sessionId 自己隔离）。
  React.useEffect(() => {
    setPlayhead(null)
    setHoverPath(null)
  }, [sessionId, scope.cwd])
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
  // 预热当前会话（及其直接子智能体）的详情：扫描一开始就在后台拉起，
  // 这样点它的**任意**轮次都能直接命中缓存，不再出现「正在读取 T5 的文件…」。
  // 只预热会被点到的少量会话（上限 4），不做全量预载 —— 全量会把打开 tab 变成卡顿。
  React.useEffect(() => {
    const current = scope.currentSessionId
    const ids: string[] = current === '' ? [] : [current]
    for (const session of scope.sessions) {
      if (session.parentId === current) ids.push(session.id)
    }
    if (ids.length === 0) return undefined
    for (const id of ids.slice(0, 4)) void store.request(id, { cwd: scope.cwd }).catch(() => undefined)
    return undefined
  }, [scope, store])

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
  // Q2 A：范围（今天/7天/30天/全部）与图、卡片、时间轴共用同一窗口。
  const rangeWindow = React.useMemo(() => windowForRange(range, now, domain), [range, now, domain])
  const scopedNodes = React.useMemo(() => {
    if (range === 'range.all' || domain === null) return nodes
    return nodes.filter((node) => node.lastAt >= rangeWindow.start && node.firstAt <= rangeWindow.end)
  }, [nodes, range, rangeWindow, domain])
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

  /* ---------------- 关系边（结构 + 共现 + 引用；时序/会话只在有焦点时追加） ----------------
   *
   * 2026-11-07 R06 的两条性能结论（PERF 实测，见 `output/_verify/threadline/T50/R06/`）：
   *
   * **P1（blocker）**：旧实现的 `edges` memo deps 里有 `effective`，所以**点/悬停一个轮次、
   * 点一个文件都会把「结构边 + 全部共现边」整条重算**（实测 p50 195ms / p95 242ms）。
   * → 拆成两半：
   *   - `baseEdges` = structure + coTurn + reference：**与 effective 无关**，模块级 memo 跨挂载复用；
   *   - `focusEdges`  = coSession（file 焦点）+ sequence（turn 焦点）：只随 effective 变，量极小。
   *   无焦点时直接用 base；有焦点才 `finalizeGraph([...base, ...focus])`。
   *
   * **P2（major）**：这些派生量原本是 `React.useMemo`，**组件重挂载就全丢**，
   * 导致「第二次打开 tab」仍要重算全部（实测 p95 340.7ms，超 50ms 预算 6.8×）。
   * → 改用模块作用域的 `createInputMemo`，入参传**稳定来源**（`data.graph` / 详情对象引用 /
   *   `effective` / `reference`），不传每帧新建的 `details` Map，这样重挂载能命中。
   *
   * ⚠️ P1 的已知语义差异（PERF 在 `equivalence.edgesSplit` 里标了 caveat）：
   *   focus 边不再经过 `finalizeGraph` 的 perNode/global 收口。无 focus 时逐条相同（有实测）；
   *   有 focus 时共现/时序边数量很小（单文件 / 单轮的邻域），视觉上不会超出原来的 12 条收拢上限。
   *   这里仍然对「base + focus」合并结果跑一次 finalizeGraph（2.7ms 量级），**保证收口语义不回归**。
   */
  const baseEdges: GraphEdge[] = InputMemos.edges([
    data.graph,
    currentDetail,
    activeEntry?.detail,
    extraDetails,
    reference,
  ], () => {
    const files = Array.from(data.graph.files.values())
    const list: GraphEdge[] = [...buildStructureEdges(files)]
    for (const [id, detail] of details) {
      list.push(...buildCoTurnEdges(detail.turns.map((turn) => turnFromDetail(turn, id))).edges)
    }
    if (reference !== null) list.push(...reference.edges)
    return finalizeGraph(list).edges
  })
  const edges: GraphEdge[] = React.useMemo(() => {
    const files = Array.from(data.graph.files.values())
    const extra: GraphEdge[] = []
    const focusPath = effective.kind === 'file' ? effective.path : undefined
    if (focusPath !== undefined) extra.push(...buildCoSessionEdges(files, focusPath).edges)
    if (effective.kind === 'turn') {
      const detail = details.get(effective.sessionId)
      const turn = detail?.turns.find((item) => item.n === effective.turn)
      if (turn !== undefined) extra.push(...buildSequenceEdges(turnFromDetail(turn, effective.sessionId)).edges)
    }
    // 无焦点且无引用：base 已经是 finalizeGraph 的产物，直接复用（不复制数组）。
    if (extra.length === 0) return baseEdges
    return finalizeGraph([...baseEdges, ...extra]).edges
  }, [baseEdges, data.graph, details, effective])

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
        tree.navigate(dirOfPath(result.target.path))
      }
    }
  }, [props.viewRequest, props.completeViewRequest, sessionId, applyFocus, tree])

  React.useEffect(() => {
    if (sessionId === '') return
    const target = takeFocus(sessionId)
    if (target === null) return
    const selection = selectionOfFocus(target)
    applyFocus(selection)
    if (selection.kind === 'file') {
      tree.navigate(dirOfPath(selection.path))
    }
  }, [sessionId, applyFocus, tree])

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      // 地图/浮层自己处理过的 Esc 不再重复退一层（Q7 逐层退出）。
      if (event.key !== 'Escape' || event.defaultPrevented) return
      setHoverPath(null)
      const result = escapeSelection(state)
      if (result.consumed) {
        setState(result.state)
        event.preventDefault()
        return
      }
      // 目录层级不在 selection 状态机里：把它作为下一层退出（逐层收回，回到父目录）。
      if (tree.canBack) {
        tree.back()
        event.preventDefault()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [state, tree])

  /* ---------------- 列表视图（图的替代视图；T10 a11y） ---------------- */
  const fileRows = React.useMemo(() => buildFileRows(scopedNodes, mode), [scopedNodes, mode])
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

  // Q6：进入列表视图时复位滚动位置，避免虚拟化 spacer 按旧 scrollTop 渲染出顶部空白。
  React.useEffect(() => {
    if (listView !== 'list') return
    setListScroll(0)
    const target = listRef.current
    if (target !== null) target.scrollTop = 0
  }, [listView])

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
      if (row !== undefined) tree.navigate(dirOfPath(row.path))
      setListView('off')
    },
    [selectFromList, fileRows, tree],
  )

  /* ---------------- 时间轴 / 图数据 ---------------- */
  const timelineNodes = React.useMemo(
    () => nodes.map((node: FileNode) => ({ path: node.path, firstAt: node.firstAt, lastAt: node.lastAt, ops: node.ops })),
    [nodes],
  )
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
  const turnFiles = React.useMemo(() => {
    if (activeTurn === null) return []
    const list: FileNode[] = []
    for (const touch of activeTurn.files) {
      const node = fileIndex.get(touch.path) ?? fileIndex.get(touch.path.toLowerCase())
      if (node !== undefined) list.push(node)
    }
    return list
  }, [activeTurn, fileIndex])

  /* ---------- 当前目录（左图 folder 模式的数据源） ---------- */
  const currentPath = tree.state.path
  const folderEntries = tree.entries
  // 当前目录的**直接**文件（有会话数据的那些；未触碰的由 FolderMap 从 entries 里补成中性节点）。
  const folderFiles = React.useMemo(() => {
    if (currentPath === '' && folderEntries.length === 0) return []
    const direct = new Set<string>()
    for (const entry of folderEntries) {
      if (entry.kind !== 'directory') direct.add(entry.path)
    }
    if (direct.size === 0) return []
    return scopedNodes.filter((node) => direct.has(node.path))
  }, [scopedNodes, folderEntries, currentPath])
  // 当前目录内文件之间的关系边（两端都必须是当前目录的直接文件）。
  const folderFileKeys = React.useMemo(() => {
    const keys = new Set<string>()
    for (const file of folderFiles) keys.add(file.path.toLowerCase())
    return keys
  }, [folderFiles])
  // 边端点邻接索引：edges 变一次重建一次；`folderEdges` 与 `turnRelations` 共用（单一事实源）。
  // R06 实测：index 构建 0.35ms（p50），换来 folderEdges 0.28ms → 0.00ms、turnRelations 30.4ms → 1.96ms。
  const edgeIndex = React.useMemo(() => buildEdgeEndpointIndex(edges), [edges])
  const folderEdges = React.useMemo(() => {
    if (folderFileKeys.size === 0 || edgeIndex.size === 0) return []
    return filterEdgesWithin(edges, edgeIndex, folderFileKeys)
  }, [edges, edgeIndex, folderFileKeys])
  const mode2: 'folder' | 'turn' = turnTarget === null ? 'folder' : 'turn'
  const graphFiles = mode2 === 'turn' ? turnFiles : folderFiles
  // 轮次关系数：只统计本轮文件之间的边（同一份 edges；确定性）。
  //
  // 2026-11-07 性能修复（R00 实测 + R06 复核）：
  // - 原实现：每条边×每一轮都调 toLowerCase → 30 轮 × 64,836 边 = **单函数 5.8s**（冷开 tab 的全部来源）。
  // - 第一步（Lead）：端点小写预索引 → p50 263.9ms（≈10×）。
  // - 第二步（R06）：改为**端点邻接索引**，内层只遍历本轮文件的出边 → p50 **1.96ms**（较原实现 ≈135×，
  //   较第一步再快 13×），结果与旧实现**逐 key 等价**（604 个 key 全等，R06 + Lead 各验一次）。
  // - 第三步（P2）：提到模块作用域 `InputMemos.turnRelations`，**重挂载命中**（入参是稳定来源）。
  const turnRelations = InputMemos.turnRelations(
    [currentDetail, activeEntry?.detail, extraDetails, edgeIndex],
    () => turnRelationCounts(details, edgeIndex, (sessionId, turn) => selectionKey({ kind: 'turn', sessionId, turn })),
  )
  // 文件 → 轮次（只用已加载详情；未加载不猜）。同上：模块级 memo，重挂载命中。
  const fileTurnKeys = InputMemos.fileTurnKeys(
    [currentDetail, activeEntry?.detail, extraDetails],
    () => {
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
    },
  )
  const hoverRelatedTurnKeys = React.useMemo(
    () => (hoverPath === null ? null : (fileTurnKeys.get(hoverPath) ?? null)),
    [hoverPath, fileTurnKeys],
  )
  const selectedPath = effective.kind === 'file' ? effective.path : null
  const selectedFileInGraph = React.useMemo(
    () => (selectedPath === null ? null : graphFiles.some((file) => file.path === selectedPath) ? selectedPath : null),
    [selectedPath, graphFiles],
  )
  // 右栏的触碰叠加：key = 小写路径；未触碰的条目不在 map 里（不显示假 0）。
  const touchedByPath = React.useMemo(() => {
    const map = new Map<string, { ops: number; lastAt?: number }>()
    for (const node of scopedNodes) {
      if (node.ops <= 0) continue
      map.set(node.path.toLowerCase(), {
        ops: node.ops,
        ...(node.lastAt === undefined ? {} : { lastAt: node.lastAt }),
      })
    }
    return map
  }, [scopedNodes])

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
  // 右栏目录导航（M4）：进入目录 / 回退 / 更新；三者都清掉文件选中与 hover，避免证据浮层被回灌。
  const clearSelectionAndHover = React.useCallback(() => {
    setHoverPath(null)
    setState((previous) => selectionReducer(previous, { type: 'blank' }))
  }, [])
  const onNavigate = React.useCallback(
    (path: string) => {
      clearSelectionAndHover()
      tree.navigate(path)
    },
    [clearSelectionAndHover, tree],
  )
  const onBackFolder = React.useCallback(() => {
    clearSelectionAndHover()
    tree.back()
  }, [clearSelectionAndHover, tree])
  const onRefreshFolder = React.useCallback(() => {
    tree.refresh()
  }, [tree])
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
      onClick: () =>
        setListView((value) => {
          const next = value === 'list' ? 'off' : 'list'
          // Q6：列表重新挂载时旧 scrollTop 会被虚拟化窗口当成新位置，先复位。
          if (next === 'list') {
            setListScroll(0)
            if (listRef.current !== null) listRef.current.scrollTop = 0
          }
          return next
        }),
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
  const skippedTotal = data.skipped.request + data.skipped.ownership + data.skipped.refresh
  const diagVisible = shouldShowDiag({
    status: data.status,
    degradeKind: data.degrade.kind,
    skipped: skippedTotal,
  })
  const diagItems: Array<[string, string]> = diagVisible
    ? buildDiagItems({
        status: data.status,
        degradeKind: data.degrade.kind,
        code: data.degrade.code ?? (data.error?.code ?? 'none'),
        scannable,
        sessions: scope.sessions.length,
        files: data.graph.files.size,
        references: referenceLayer.status,
        skipped: skippedTotal,
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
  // M2/B2：图尾（含「基于已加载 N 个会话」）整块删除；等价覆盖信息留在 header 的 coverage 胶囊里
  // （见上面 `coverage` / `ProgressPill`），不在这里重复、也不伪造 0。
  // `FileGraph` 的 `coverageNote` prop 已随图尾一并删除，所以这里没有对应变量。
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
        mode: mode2,
        // folder 模式：当前目录的全量 entries（含未触碰 → 中性节点）+ 只属于该目录的文件/边。
        ...(mode2 === 'folder' ? { entries: folderEntries, currentPath } : {}),
        files: graphFiles,
        edges: mode2 === 'folder' ? folderEdges : edges,
        // R10 跨目录聚合：枢纽要连到「子文件夹里与当前目录有来往」的文件，
        // 需要**未按当前目录过滤**的全量边集（folderEdges 只含两端都在当前目录的边）。
        // 只在 folder 模式传；turn 模式没有"子文件夹枢纽"的概念。
        ...(mode2 === 'folder' ? { allEdges: edges } : {}),
        visibleAt: playhead,
        onHoverFile,
        turn: activeTurn === null || turnStatus === null ? null : { turn: activeTurn, status: turnStatus },
        selectedPath: selectedFileInGraph,
        onSelectFile: selectFile,
        onOpenFile: props.openPath,
        onEnterFolder: mode2 === 'folder' ? onNavigate : undefined,
        onExitTurn: exitTurn,
        now,
        formatTime: formatLocalTime,
        locale,
        reducedMotion: reduced,
        loading: graphLoading,
        loadingLabel: graphLoadingLabel,
        ...(mode2 === 'folder' && tree.state.status === 'error'
          ? { errorText: t('tree.readFailed') }
          : {}),
        ...(turnEmpty
          ? { emptyTitle: t('graph.emptyTurn') }
          : turnUnknown
            ? { emptyTitle: t('state.unknown') }
            : mode2 === 'folder' && tree.state.status === 'empty'
              ? { emptyTitle: t('graph.emptyFolder') }
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
        onPlayheadChange: (value: number | null) => setPlayhead(value),
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
            // 悬停轮次 = 轮次预览优先；清掉文件 hover 预览。
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
      railSlot: h(FileTreeRail, {
        currentPath,
        entries: folderEntries,
        status: tree.state.status,
        source: tree.source,
        errorCode: tree.state.errorCode,
        truncated: tree.truncated,
        onNavigate,
        onBack: onBackFolder,
        onRefresh: onRefreshFolder,
        onSelectFile: selectFile,
        ...(props.openPath === undefined ? {} : { onOpenFile: props.openPath }),
        onClearSelection: () => setState((previous) => selectionReducer(previous, { type: 'blank' })),
        selectedPath,
        hoveredPath: hoverPath,
        onHoverFile,
        touched: touchedByPath,
        currentTurnPaths,
        viewMode: railView,
        onViewModeChange: setRailView,
        scrollKey: sessionId + '\u0000' + currentPath,
        locale,
        formatTime: formatLocalTime,
        testId: 'file-tree',
      }),
      testId: props.testId ?? 'threadline-tab',
    }),
  )
}

/**
 * 注册「脉络」tab（`conversation.view`；order 30 = 在 chat / trajectory 之后）。
 */
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
      const remote = resolveTabRemote(owner, options?.getRemote)
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

/**
 * 挑选 tab 的 `remote` 值（2026-11-07 修的真机缺陷，`data/tree.ts` 与引用层都依赖它）。
 *
 * 真机上 `ownerProps.remote` 是 **Cordis Context 代理**：读它的 `workspaceFiles` 属性会抛
 * `cannot get property "remote.workspaceFiles" without inject`（见 `client/index.ts` 的实测注释）。
 * 而 `options.getRemote()` 返回的是 `index.ts` 用 `ctx.inject(['remote','remote.workspaceFiles'])`
 * 解析好的**普通门面对象**，读属性永不抛错。
 *
 * 旧写法 `owner.remote ?? getRemote()` 会因为代理先命中而**永久挡掉**可用门面 →
 * `probeWorkspaceFiles` 恒为 null → 引用层恒 disabled（"观测不到"）+ 目录树退到 host fallback。
 * 因此顺序必须是：**先用解析好的门面，取不到才退回 owner.remote**。
 *
 * 只在门面真的带 `workspaceFiles` 时才优先它——否则退回 owner，避免把空门面当可用。
 */
export function resolveTabRemote(
  owner: { remote?: unknown },
  getRemote?: (() => unknown) | undefined,
): unknown {
  const facade = typeof getRemote === 'function' ? getRemote() : undefined
  if (facade !== undefined && facade !== null && typeof facade === 'object') {
    const files = (facade as { workspaceFiles?: unknown }).workspaceFiles
    if (files !== undefined && files !== null) return facade
  }
  return owner.remote
}
