/**
 * T04 · 薄 React 层（只把数据层的状态接到 React，不写业务逻辑）。
 *
 * T13e 变化：扫描从「tab 组件自己的 controller」改为**页面级共享预热**（`data/warmup.ts`）：
 * - `useThreadlineData` 若已有同 workspaceKey 的预热就**只订阅**，没有才创建 —— 打开 tab 不再二次扫描；
 * - 卸载只退订，不停止预热（这样 tab 没打开时 `/threadline`、每轮影响也有数据）；
 * - `useThreadlineDetail` 支持 `cwd`（宿主 detail cold-read 归属校验）并在请求前透传；
 *   可选携带 `warmup` 上下文，只点图标/弹窗也能先 ensure 再取详情。
 *
 * 禁止：任何持久化（浏览器存储 API / cookie）、写文件、外部网络。
 */

import * as React from 'react'
import { buildWorkspaceScope } from './scope.ts'
import type { SessionsSnapshot, WorkspaceItem, WorkspaceScope, WorkspacesSnapshot } from './scope.ts'
import type { ControllerSnapshot } from './controller.ts'
import type { DetailEntry, DetailStore } from './detail.ts'
import type { Coverage, WorkspaceGraph } from './merge.ts'
import type { DegradeState } from './degrade.ts'
import type { FetchLike } from './http.ts'
import type { ScanSkippedSummary } from '../../shared/events/index.ts'
import type { ThreadlineError } from '../../shared/events/index.ts'
import {
  createIdleControllerSnapshot,
  ensureThreadlineWarmup,
  ensureWarmupForDetail,
  getWarmupState,
  threadlineWorkspaceKey,
} from './warmup.ts'
import type { WarmupHandle, WarmupInput } from './warmup.ts'

/** `useThreadlineData` 选项。 */
export interface UseThreadlineDataOptions {
  /** 当前工作区范围；`null` 表示还没识别出来（不发起扫描）。 */
  scope: WorkspaceScope | null
  /** 注入的 fetch（同源相对路径；测试用假实现）。 */
  fetch: FetchLike
  enabled?: boolean
  pollIntervalMs?: number
  hiddenPollIntervalMs?: number
  now?: () => number
}

/** 传给 UI 的只读视图（与预热共享同一份实例，tab 打开即现成）。 */
export interface ThreadlineDataView {
  status: ControllerSnapshot['status']
  graph: WorkspaceGraph
  coverage: Coverage
  degrade: DegradeState
  rev: number
  generation: number
  scanId?: string
  error?: ThreadlineError
  /** 被容错跳过的会话计数（数据不完整时必须让用户看见）。 */
  skipped: ScanSkippedSummary
  /** 重新读取（保留已加载数据，直到新数据到达）。 */
  refresh(): void
  /** failed 后重试。 */
  retry(): void
}

/** 把 controller 快照投影成 UI 只读视图。 */
function viewOf(
  current: ControllerSnapshot,
  refresh: () => void,
  retry: () => void,
): ThreadlineDataView {
  return {
    status: current.status,
    graph: current.graph,
    coverage: current.coverage,
    degrade: current.degrade,
    rev: current.rev,
    generation: current.generation,
    ...(current.scanId === undefined ? {} : { scanId: current.scanId }),
    ...(current.error === undefined ? {} : { error: current.error }),
    skipped: current.skipped,
    refresh,
    retry,
  }
}

/**
 * 订阅共享预热：
 * - 同 workspaceKey 已有预热 → 只订阅（不二次 `/scan`）；
 * - 没有 → 创建（幂等，重复渲染不会重复扫描）；
 * - 页面从隐藏恢复由预热内部的可见性监听处理；这里只管 React 订阅。
 */
export function useThreadlineData(options: UseThreadlineDataOptions): ThreadlineDataView {
  const fetchRef = React.useRef(options.fetch)
  fetchRef.current = options.fetch
  const scopeRef = React.useRef(options.scope)
  scopeRef.current = options.scope

  const workspaceKey =
    options.scope === null ? '' : threadlineWorkspaceKey(options.scope.workspaceId, options.scope.cwd)
  const [snapshot, setSnapshot] = React.useState<ControllerSnapshot | null>(() =>
    workspaceKey === '' ? null : getWarmupState(workspaceKey) ?? null,
  )
  const handleRef = React.useRef<WarmupHandle | null>(null)
  const enabled = options.enabled !== false
  const optionsRef = React.useRef(options)
  optionsRef.current = options

  React.useEffect(() => {
    if (!enabled || workspaceKey === '') return undefined
    const scope = scopeRef.current
    if (scope === null) return undefined
    const handle = ensureThreadlineWarmup({
      workspaceKey,
      cwd: scope.cwd,
      sessions: scope.sessions,
      fetch: fetchRef.current,
      ...(optionsRef.current.pollIntervalMs === undefined
        ? {}
        : { pollIntervalMs: optionsRef.current.pollIntervalMs }),
      ...(optionsRef.current.hiddenPollIntervalMs === undefined
        ? {}
        : { hiddenPollIntervalMs: optionsRef.current.hiddenPollIntervalMs }),
      ...(optionsRef.current.now === undefined ? {} : { now: optionsRef.current.now }),
    })
    handleRef.current = handle
    setSnapshot(handle.getState())
    // 只退订，不 stop：预热是页面级共享实例（tab 卸载后弹窗/图标仍要可用）。
    return handle.subscribe(setSnapshot)
  }, [enabled, workspaceKey])

  const current = snapshot ?? handleRef.current?.getState() ?? createIdleControllerSnapshot()
  const refresh = React.useCallback(() => {
    void handleRef.current?.controller.refresh()
  }, [])
  const retry = React.useCallback(() => {
    void handleRef.current?.controller.retry()
  }, [])
  return React.useMemo<ThreadlineDataView>(() => viewOf(current, refresh, retry), [current, refresh, retry])
}

/** `useThreadlineDetail` 的预热上下文（可选；entries 拿得到 scope/sessions 时传）。 */
export type UseThreadlineDetailWarmup = Omit<WarmupInput, 'fetch' | 'detailStore'>

/** `useThreadlineDetail` 选项。 */
export interface UseThreadlineDetailOptions {
  /** 会话行的 updatedAt；变化即重拉（running 会话的“轮次后刷新”）。 */
  updatedAt?: number
  /** 强制重拉。 */
  refresh?: boolean
  enabled?: boolean
  /**
   * 该会话所属工作区 cwd（T13e）：宿主 `/detail` 在没有扫描时用 `header.cwd === cwd`
   * 做归属校验。给了就透传到 POST body；不给按老行为（host 兜底报错，不伪造）。
   */
  cwd?: string
  /** 可选：完整预热上下文（给了就先 ensure，只点图标/弹窗也能工作）。 */
  warmup?: UseThreadlineDetailWarmup
  /** 预热所需 fetch（仅当给了 warmup 时使用）。 */
  fetch?: FetchLike
}

/**
 * 订阅一个会话的详情（T08 检查器 / 轮次带 / 每轮影响 / 弹窗用）。
 *
 * 顺序（T13e）：
 * 1. 有 `cwd` → 先写入共享 store 的默认归属（后续详情请求自动带上，不猜）；
 * 2. 有 `warmup` 上下文 → 先 `ensureThreadlineWarmup`（幂等，不二次 `/scan`）；
 * 3. 再 `store.request(sessionId, { cwd, ... })`（并发/去重/partial 全由 store 管）。
 */
export function useThreadlineDetail(
  store: DetailStore | null,
  sessionId: string | null,
  options?: UseThreadlineDetailOptions,
): DetailEntry | null {
  const [entry, setEntry] = React.useState<DetailEntry | null>(() =>
    store !== null && sessionId !== null ? store.peek(sessionId) ?? null : null,
  )
  const updatedAt = options?.updatedAt
  const refresh = options?.refresh === true
  const enabled = options?.enabled !== false
  const cwd = options?.cwd
  const warmupRef = React.useRef(options?.warmup)
  warmupRef.current = options?.warmup
  const fetchRef = React.useRef(options?.fetch)
  fetchRef.current = options?.fetch

  React.useEffect(() => {
    if (store === null || sessionId === null || !enabled) return undefined
    let cancelled = false
    const unsubscribe = store.subscribe((id, next) => {
      if (id === sessionId) setEntry(next)
    })
    const cached = store.peek(sessionId)
    if (cached !== undefined) setEntry(cached)

    ensureWarmupForDetail(store, {
      ...(cwd === undefined ? {} : { cwd }),
      ...(warmupRef.current === undefined ? {} : { warmup: warmupRef.current }),
      ...(fetchRef.current === undefined ? {} : { fetch: fetchRef.current }),
    })

    void store
      .request(sessionId, {
        ...(updatedAt === undefined ? {} : { updatedAt }),
        ...(refresh ? { refresh: true } : {}),
        ...(cwd === undefined ? {} : { cwd }),
      })
      .then((next) => {
        if (!cancelled) setEntry(next)
      })
      .catch(() => {
        // 详情失败由 DetailEntry.error 表达；这里不吞成“成功”。
      })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [store, sessionId, enabled, updatedAt, refresh, cwd])

  return entry
}

/** `useWorkspaceScope` 输入。 */
export interface UseWorkspaceScopeInput {
  workspaces: WorkspacesSnapshot | readonly WorkspaceItem[] | undefined
  sessions: SessionsSnapshot | undefined
  sessionId: string
  now?: number
  recentWindowMs?: number
}

/** 把两份宿主快照转成当前工作区范围（纯函数 + useMemo）。 */
export function useWorkspaceScope(input: UseWorkspaceScopeInput): WorkspaceScope {
  const { workspaces, sessions, sessionId } = input
  return React.useMemo(
    () =>
      buildWorkspaceScope({
        workspaces,
        sessions,
        sessionId,
        ...(input.now === undefined ? {} : { now: input.now }),
        ...(input.recentWindowMs === undefined ? {} : { recentWindowMs: input.recentWindowMs }),
      }),
    [workspaces, sessions, sessionId, input.now, input.recentWindowMs],
  )
}
