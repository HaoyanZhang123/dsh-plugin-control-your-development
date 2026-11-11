/*
 * client/entries/reasoning.ts —— 「思维链」tab（`conversation.view`，D-35）。
 *
 * 与「脉络」tab 的关系：
 * - 两者都是 `conversation.view`，共享同一个只读数据层（scope / detail store / 预热）；
 * - 本入口**只读**：不发起写请求、不新增路由、不碰存储；
 * - 统计口径全部委托 shared/reasoning（不在 UI 里重算）。
 *
 * 数据来源：当前工作区里**已加载**的会话详情（detail.reasoning）。
 * 未加载的会话按需请求，但**只请求前 N 个**，避免打开 tab 就扫全场
 * （与脉络的渐进加载同一条纪律）。
 */
import * as React from 'react'
import type { SessionDetail } from '../../shared/events/index.ts'
import type { ReasoningSample } from '../../shared/reasoning/index.ts'
import { createTranslator, DEFAULT_LOCALE, type Locale } from '../locale/index.ts'
import { ReasoningView } from '../ui/reasoning/ReasoningView.ts'
import type { ReasoningSessionMeta } from '../ui/reasoning/model.ts'
import {
  isScannableScope,
  useThreadlineData,
  useThreadlineDetail,
  useWorkspaceScope,
  type FetchLike,
  type WorkspacesSnapshot,
} from '../data/index.ts'
import { getDetailStore } from '../state/detailStore.ts'
import { defaultFetch, readSnapshot, registerSlot, type ClientScopeLike } from './context.ts'
import { usePrivacyMode } from '../state/privacyStore.ts'

const h = React.createElement

/** 最多自动预取多少个会话的详情（有界；其余按需）。 */
export const REASONING_PREFETCH_LIMIT = 12

export interface ReasoningTabProps {
  locale?: Locale
  sessionId?: string
  useSessions?: unknown
  useWorkspaces?: unknown
  fetch?: FetchLike
  now?: number
  testId?: string
}

/** 从已加载详情里收集样本（纯函数，便于测试）。 */
export function collectReasoningSamples(details: Iterable<SessionDetail>): ReasoningSample[] {
  const out: ReasoningSample[] = []
  for (const detail of details) {
    for (const sample of detail.reasoning ?? []) out.push(sample)
  }
  /* 稳定排序：时间升序 → 会话 id → 轮次，保证同数据同顺序（截图/断言可复现）。 */
  out.sort((left, right) => {
    if (left.at !== right.at) return left.at - right.at
    if (left.sessionId !== right.sessionId) return left.sessionId < right.sessionId ? -1 : 1
    const leftTurn = left.turn ?? -1
    const rightTurn = right.turn ?? -1
    return leftTurn - rightTurn
  })
  return out
}

/** 会话归档表（range 筛选需要；不从样本里猜）。 */
export function sessionMetaOf(scope: { sessions: ReadonlyArray<{ id: string; archived?: boolean }> }): Record<string, ReasoningSessionMeta> {
  const meta: Record<string, ReasoningSessionMeta> = {}
  for (const session of scope.sessions) meta[session.id] = { archived: session.archived === true }
  return meta
}

function ReasoningTabBody(props: ReasoningTabProps): React.ReactElement {
  const locale: Locale = props.locale ?? DEFAULT_LOCALE
  const t = React.useMemo(() => createTranslator(locale), [locale])
  const privacyMode = usePrivacyMode()
  const fetchImpl = props.fetch ?? defaultFetch()
  const store = getDetailStore(fetchImpl)

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

  const currentRow = scope.sessions.find((session) => session.id === sessionId)
  const currentEntry = useThreadlineDetail(store, sessionId === '' ? null : sessionId, {
    ...(currentRow === undefined ? {} : { updatedAt: currentRow.updatedAt }),
    ...(scope.cwd === '' ? {} : { cwd: scope.cwd }),
  })

  /* 有界预取：只把前 N 个未归档会话的详情拉起来（打开即可见，不扫全场）。 */
  const [extraDetails, setExtraDetails] = React.useState<ReadonlyMap<string, SessionDetail>>(new Map())
  React.useEffect(() => {
    if (!scannable) return undefined
    const ids = scope.sessions
      .filter((session) => session.archived !== true && session.id !== sessionId)
      .slice(0, REASONING_PREFETCH_LIMIT)
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
    for (const id of ids) void store.request(id, { cwd: scope.cwd }).catch(() => undefined)
    return () => unsubscribe()
  }, [scannable, scope, store, sessionId])

  const details = React.useMemo(() => {
    const list: SessionDetail[] = []
    if (currentEntry?.detail !== undefined) list.push(currentEntry.detail)
    for (const detail of extraDetails.values()) list.push(detail)
    return list
  }, [currentEntry, extraDetails])

  const samples = React.useMemo(() => collectReasoningSamples(details), [details])
  const sessions = React.useMemo(() => sessionMetaOf(scope), [scope])

  /* 没有任何样本时如实说明数据不足，不画出空图冒充"统计完成"。 */
  if (samples.length === 0) {
    const pending = data.status === 'starting' || data.status === 'scanning' || (currentEntry?.status === 'loading')
    return h(
      'div',
      { className: 'tl-reasoning', 'data-testid': props.testId ?? 'reasoning-view', 'data-empty': 'true' },
      h(
        'div',
        { className: 'tl-reasoning-empty', role: 'status' },
        h('p', { className: 'tl-reasoning-empty-title' }, t(pending ? 'reasoning.loading' : 'reasoning.none')),
      ),
    )
  }

  return h(ReasoningView, {
    samples,
    sessions,
    ...(sessionId === '' ? {} : { currentSessionId: sessionId }),
    locale,
    privacy: privacyMode === 'hidden',
    testId: props.testId ?? 'reasoning-view',
  })
}

/** 注册「思维链」tab（`conversation.view`，order 31：紧跟在脉络之后）。 */
export function registerReasoningTab(ctx: ClientScopeLike, options?: { locale?: Locale }): boolean {
  return registerSlot(
    ctx,
    'conversation.view',
    { id: 'threadline-reasoning', order: 31, label: () => createTranslator(options?.locale ?? DEFAULT_LOCALE)('reasoning.tab') },
    (props: never) => {
      const owner = props as unknown as ReasoningTabProps
      return h(ReasoningTabBody, {
        ...owner,
        ...(options?.locale === undefined ? {} : { locale: options.locale }),
      })
    },
    'threadline: reasoning view',
  )
}
