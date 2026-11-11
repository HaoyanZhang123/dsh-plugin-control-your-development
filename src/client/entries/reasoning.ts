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
import type { DetailStore } from '../data/index.ts'
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

/**
 * 最多自动预取多少个会话的详情（有界；其余按需）。
 *
 * 1.5.3 性能：从 12 降到 4。实测本工作区单会话最大 10.9MB、耗时 249ms
 * （解压 80 + 解析 142 + 归约 24），12 个就是 2.4 秒起步；4 个约 0.8 秒，
 * 而首屏本来就有"当前会话"兜底，用户切筛选/下钻时再按需拉剩下的。
 * 这个值只影响"自动预取"，不影响功能完整性。
 */
export const REASONING_PREFETCH_LIMIT = 4

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

/**
 * 从共享详情缓存里**播种**一批会话的 detail（1.5.1 修的真机缺陷）。
 *
 * 为什么要这一步：`createDetailStore.request()` 命中缓存时走 `Promise.resolve(cached)`，
 * **不发请求也不 notify 订阅者**。而真机上共享 store 早被页面级预热 / 脉络预取 /
 * 每轮影响入口填满 → 思维链要的那 12 个会话全是缓存命中 → 只订阅的话一次回调都收不到，
 * `extraDetails` 恒为空，整页只剩「当前会话」一条孤线兜底。
 *
 * 口径：样本来源 = **缓存 ∪ 通知**。这里是"∪ 的缓存那半边"，且与订阅回调共用同一份
 * 合并实现（调用方传入的 `absorb`），所以不会出现两套写状态逻辑。
 *
 * 纯读取：只 `peek`，不触发任何请求。
 */
export function seedReasoningDetails(
  store: Pick<DetailStore, 'peek'>,
  ids: readonly string[],
  absorb: (id: string, detail: SessionDetail) => void,
  markFailed: (id: string) => void,
): void {
  for (const id of ids) {
    const cached = store.peek(id)
    if (cached === undefined) continue
    if (cached.detail !== undefined) {
      absorb(id, cached.detail)
      continue
    }
    /* 有旧数据但这次读失败（stale）时仍算"有数据"，只是不完整；只有彻底没有才算失败。 */
    if (cached.status === 'error') markFailed(id)
  }
}

/**
 * 思维链 tab 的**样式根**（1.5.2 修的真机白板）。
 *
 * 为什么必须有它：`styles/reasoning.css` 的 90 条规则全部写成
 * `:is(.threadline-app, .threadline-impact-root) .tl-reasoning …`，
 * `tokens.css` 的 `--tl-*` 也只在 `.threadline-app` 作用域里定义。
 * 而思维链曾把自己的根节点直接渲染成 `class="tl-reasoning"`、**没有这层祖先** →
 * 所有选择器落空、所有变量 undefined，页面退化成浏览器默认控件（下拉框 + 裸按钮 + 纯黑矩形）。
 *
 * 单测与截图没抓到，是因为 harness 的 `reasoning.entry.ts` 自己给 host 加了
 * `threadline-app` 类——夹具替产品补了这层。所以这里既补实现，也补一条守卫断言。
 */
function ReasoningSurface(props: { testId?: string; children?: React.ReactNode }): React.ReactElement {
  return h(
    'div',
    { className: 'threadline-app', 'data-threadline-app': '', 'data-testid': props.testId },
    h('div', { className: 'threadline-surface-host' }, props.children ?? null),
  )
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

  /**
   * 有界预取（1.5.3 性能改造）。
   *
   * 真机问题：打开思维链会卡很久。实测本工作区 304 个日志 / 302.7MB，
   * 单会话 10.9MB 要 249ms（解压 80 + 解析 142 + 归约 24），预取 12 个就是 **2.4 秒起**，
   * 而且这 12 个是**串行**拉起的。
   *
   * 现在两条改动：
   * 1. 上限从 12 降到 `REASONING_PREFETCH_LIMIT`（见常量注释：4 个）；
   * 2. 每个请求都带上该会话行的 `updatedAt` → host 命中缓存直接返回，不重读日志。
   * 首屏仍能立刻出数（当前会话 + 最近 4 个），其余在用户切换筛选/下钻时按需拉。
   */
  const [extraDetails, setExtraDetails] = React.useState<ReadonlyMap<string, SessionDetail>>(new Map())
  /**
   * 本范围内**读失败且无旧数据**的会话 id 集合（用来区分「真的没有记录」与「读失败」——
   * 两者不能都显示 "没有"）。用集合而不是计数：同一会话会被订阅回调与 request Promise
   * 各告知一次，计数会把一次失败记成两次。
   */
  const [failedIds, setFailedIds] = React.useState<ReadonlySet<string>>(new Set())
  React.useEffect(() => {
    if (!scannable) return undefined
    const targets = scope.sessions
      .filter((session) => session.archived !== true && session.id !== sessionId)
      .slice(0, REASONING_PREFETCH_LIMIT)
      .map((session) => ({ id: session.id, updatedAt: session.updatedAt }))
    const ids = targets.map((target) => target.id)
    if (ids.length === 0) return undefined
    const updatedAtById = new Map(targets.map((target) => [target.id, target.updatedAt]))
    const scopeIds = new Set(ids)
    /* 换工作区/换会话范围：上一轮范围的失败记录不能带过来（否则新范围会莫名显示"部分失败"）。 */
    setFailedIds((previous) => (previous.size === 0 ? previous : new Set<string>()))

    /* 合并一条 detail 进 extraDetails（订阅回调与缓存播种共用这一个实现）。 */
    const absorb = (id: string, detail: SessionDetail | undefined): void => {
      if (detail === undefined) return
      setExtraDetails((previous) => {
        if (previous.get(id) === detail) return previous
        const next = new Map(previous)
        next.set(id, detail)
        return next
      })
    }
    /* 记一次失败（幂等：Set 天然去重；成功拿到 detail 的会话不算失败）。 */
    const markFailed = (id: string): void => {
      if (!scopeIds.has(id)) return
      setFailedIds((previous) => (previous.has(id) ? previous : new Set(previous).add(id)))
    }

    const unsubscribe = store.subscribe((id, entry) => {
      if (entry.status === 'error' && entry.detail === undefined) {
        markFailed(id)
        return
      }
      absorb(id, entry.detail)
    })

    /**
     * **缓存播种**（1.5.1 修的真机缺陷）。
     *
     * 光靠订阅是收不全的：`createDetailStore.request()` 命中缓存时走
     * `Promise.resolve(cached)`，**不发请求也不 notify**。而真机上共享 store 早被
     * 页面级预热 / 脉络预取 / 每轮影响入口填满了 → 这 12 个会话全是缓存命中 →
     * 订阅一次都不会被回调 → `extraDetails` 恒为空 → 只有「当前会话」一条孤线兜底，
     * 它一旦不是 ready，整页就显示「这个范围内没有可读取的思维链记录」。
     *
     * 正确口径：样本来源 = **缓存 ∪ 通知**。先读一次已有缓存，再让订阅补上后续变化。
     */
    seedReasoningDetails(store, ids, absorb, markFailed)

    for (const id of ids) {
      /* 带上该会话行的 updatedAt：host 命中缓存就直接返回，不重读日志（1.5.3 性能）。 */
      const updatedAt = updatedAtById.get(id)
      void store
        .request(id, {
          ...(scope.cwd === '' ? {} : { cwd: scope.cwd }),
          ...(updatedAt === undefined ? {} : { updatedAt }),
        })
        .then((entry) => {
          if (entry.status === 'error' && entry.detail === undefined) {
            markFailed(id)
            return
          }
          absorb(id, entry.detail)
        })
        .catch(() => undefined)
    }
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

  /**
   * 没有任何样本时如实说明数据不足，不画出空图冒充"统计完成"。
   *
   * 三态必须分开（1.5.1 真机缺陷修复）：
   * - 还在读且没有已知失败 → 「正在读取」；
   * - 有会话读失败 → 「部分读取失败」（**不能**说「没有记录」：那是把故障当结论）；
   * - 其余才是真的「这个范围里没有」。
   */
  const failedAny = currentEntry?.status === 'error' || failedIds.size > 0
  if (samples.length === 0) {
    const loading = data.status === 'starting' || data.status === 'scanning' || currentEntry?.status === 'loading'
    const state = failedAny ? 'error' : loading ? 'loading' : 'none'
    const titleKey = state === 'error' ? 'reasoning.partial' : state === 'loading' ? 'reasoning.loading' : 'reasoning.none'
    return h(
      ReasoningSurface,
      { testId: props.testId ?? 'reasoning-view' },
      h(
        'div',
        { className: 'tl-reasoning', 'data-testid': 'reasoning-body', 'data-empty': 'true', 'data-state': state },
        h(
          'div',
          { className: 'tl-reasoning-empty', role: 'status' },
          h('p', { className: 'tl-reasoning-empty-title' }, t(titleKey)),
          /* 故障时说清"故障是什么"，同时把"确实没有读到记录"这个事实单独说一遍。 */
          state === 'error' ? h('p', { className: 'tl-reasoning-empty-detail' }, t('reasoning.none')) : null,
        ),
      ),
    )
  }

  return h(ReasoningSurface, { testId: props.testId ?? 'reasoning-view' },
    h(ReasoningView, {
      samples,
      sessions,
      ...(sessionId === '' ? {} : { currentSessionId: sessionId }),
      locale,
      privacy: privacyMode === 'hidden',
      ...(failedAny ? { notice: t('reasoning.partial') } : {}),
      testId: 'reasoning-view-body',
    }),
  )
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
