/**
 * T37 · 详情「三态视图」（35 §2.1 首屏假空态的**数据侧**收口）。
 *
 * 真机症状（35 §1）：右侧卡片来自 `/scan` 快照，左侧本轮图依赖 `/detail`；
 * T4 的 detail 未就绪时 UI 把 `undefined` 画成 `0 文件 / 没有文件操作`，随后才跳成正常。
 *
 * 根因在数据层可观测性：
 * - `useThreadlineDetail` 返回 `DetailEntry | null`，`null`（还没请求/还没回来）与
 *   `ready 且这一轮真的 0 文件` 在类型上无法区分，调用方只能写 `entry?.detail ?? null`，
 *   于是「未知」被画成「0」；
 * - `DetailEntry` 可能比会话行旧（聊天页读到的 detail 停在 T3，或读到 T4 进行中的半截数据），
 *   但没有「相对会话行 updatedAt 是否最新」的判断；
 * - 因此这里只提供**纯函数**，把 `DetailEntry` 归一成 UI 能直接用的三态：
 *   `loading`（骨架 + 正在读取）/ `ready`（含「0 文件」这个真事实）/ `error`（可重试）/ `unknown`。
 *
 * 纪律：不读文件、不写存储、不发请求；不产生任何路径/正文。
 */
import type { SessionDetail, ThreadlineError, TurnDetail } from '../../shared/events/index.ts'
import type { DetailEntry } from './detail.ts'

/** 详情三态（35 §2.1）。`idle` = 还没发起/还没回来，UI 与 `loading` 一样处理。 */
export type DetailViewStatus = 'idle' | 'loading' | 'ready' | 'error'

/** `detailViewOf` 选项。 */
export interface DetailViewOptions {
  /**
   * 会话行的 `updatedAt`（`useSessions` 的 row）。
   * 给了才能判断「缓存的 detail 是否比会话旧」；不给就只按 `DetailEntry.status` 判断（旧行为）。
   */
  updatedAt?: number
}

/** 详情视图（不可变；UI 只读）。 */
export interface DetailView {
  status: DetailViewStatus
  /** 可渲染的详情：`ready` 时为本次结果；`loading`/`error` 时可能是上一次成功的旧值。 */
  detail: SessionDetail | null
  /** 有详情数据可画（不代表是最新的）。 */
  hasDetail: boolean
  /** 首帧还没拿到任何详情：**UI 必须显示骨架，不许显示 0 / 空态**（35 §2.1）。 */
  loading: boolean
  /** 已有旧值、正在后台刷新（可照常显示旧值 + 更新中标记）。 */
  refreshing: boolean
  /** `ready` 且与会话行 updatedAt 一致（未给 updatedAt 时按 `ready` 视为最新）。 */
  fresh: boolean
  /** 显示的数据不是「已知最新」（加载中/失败/比会话行旧）。 */
  stale: boolean
  partial: boolean
  error?: ThreadlineError
  /** 归一后的轮次数：**只有 `hasDetail` 时才给数字**（否则 undefined，不是 0）。 */
  turnCount?: number
  /** 条目记录的 updatedAt（0 = 未知）。 */
  entryUpdatedAt: number
}

/** 本轮视图状态（35 §2.1：骨架 / 真的 0 文件 / 可重试错误 / 不可知）。 */
export type TurnDetailStatus = 'loading' | 'ready' | 'error' | 'unknown'

/** 某一轮的详情视图。 */
export interface TurnDetailView {
  status: TurnDetailStatus
  /** 找到的轮次（`loading` 时可能已有半截数据：文件列表仍可能继续增长）。 */
  turn: TurnDetail | null
  /**
   * 本轮文件数：**只有 `status === 'ready'` 时给数字**。
   * `0` 是可信事实（这一轮真的没有文件操作）；`loading`/`unknown`/`error` 一律 undefined。
   */
  fileCount?: number
  /** 本轮仍在记录（running / detail partial）：UI 显示「正在读取」而不是 0。 */
  partial: boolean
  error?: ThreadlineError
}

function asFiniteNonNegative(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined
  return value
}

function statusOf(entry: DetailEntry): DetailViewStatus {
  if (entry.status === 'ready') return 'ready'
  if (entry.status === 'error') return 'error'
  if (entry.status === 'loading') return 'loading'
  return 'idle'
}

/**
 * `DetailEntry` → 三态视图。
 *
 * 关键规则（这四条就是「不把 undefined 当 0」的判据）：
 * 1. 没有条目 / 条目还在 loading 且没有旧值 → `loading: true`（`hasDetail: false`）；
 * 2. `ready` 才有 `fresh`；给了会话行 updatedAt 但两者不等 → `fresh: false`（数据是旧的）；
 * 3. `hasDetail: false` 时 `turnCount` 为 undefined（不是 0）；
 * 4. `error` 保留旧值（若有）但 `stale: true`，UI 可显示「可重试」，不许把旧值当最新。
 */
export function detailViewOf(entry: DetailEntry | null | undefined, options: DetailViewOptions = {}): DetailView {
  const rowUpdatedAt = asFiniteNonNegative(options.updatedAt)
  if (entry === null || entry === undefined) {
    return {
      status: 'idle',
      detail: null,
      hasDetail: false,
      loading: true,
      refreshing: false,
      fresh: false,
      stale: false,
      partial: false,
      entryUpdatedAt: 0,
    }
  }
  const status = statusOf(entry)
  const detail = entry.detail ?? null
  const hasDetail = detail !== null
  const knownUpdatedAt = asFiniteNonNegative(entry.updatedAt) ?? 0
  const fresh =
    status === 'ready' && (rowUpdatedAt === undefined || knownUpdatedAt === rowUpdatedAt)
  const loading = hasDetail === false && (status === 'idle' || status === 'loading')
  const refreshing = hasDetail && status === 'loading'
  const stale = hasDetail && (status !== 'ready' || !fresh)
  const view: DetailView = {
    status,
    detail,
    hasDetail,
    loading,
    refreshing,
    fresh,
    stale,
    partial: entry.partial === true || (detail !== null && detail.partial === true),
    entryUpdatedAt: knownUpdatedAt,
  }
  if (entry.error !== undefined) view.error = entry.error
  if (hasDetail) view.turnCount = detail.turns.length
  return view
}

/**
 * 是否处于「还不知道」的加载态（`idle` / 首帧 `loading`）。
 *
 * 供只需要一个布尔值的地方用（例如 `loading` prop）；要区分「后台刷新」用 `detailViewOf`。
 */
export function detailLoadingOf(entry: DetailEntry | null | undefined): boolean {
  if (entry === null || entry === undefined) return true
  if (entry.status === 'idle') return true
  return entry.status === 'loading' && entry.detail === undefined
}

/**
 * 从详情视图里取某一轮（35 §2.1 的三态判定）。
 *
 * - 还没拿到详情 → `loading`（骨架 + 「T{n} 正在读取」）；
 * - 拿到了但**没有这一轮**：数据比会话旧 → `loading`（可能还没读到）；确实最新 → `unknown`（不猜，不显示 0）；
 * - 找到了但 `files` 为空：只有「数据最新且本轮已结束」才算 `ready`（= 真的 0 文件）；
 *   否则 `loading`（这一轮还在写 / detail 是旧的半截数据）；
 * - 失败且没有可用数据 → `error`（可重试）。
 */
export function turnDetailOf(view: DetailView, turn: number): TurnDetailView {
  if (!Number.isInteger(turn) || turn < 0) return { status: 'unknown', turn: null, partial: false }
  if (view.detail === null) {
    if (view.status === 'error') {
      return { status: 'error', turn: null, partial: false, ...(view.error === undefined ? {} : { error: view.error }) }
    }
    return { status: 'loading', turn: null, partial: false }
  }
  const found = view.detail.turns.find((item) => item.n === turn) ?? null
  // 数据不是「已知最新」时，即便这一段有内容也仍是「可能还会长」→ 标 partial（UI 显示更新中）。
  const partial = view.partial || !view.fresh || found?.status === 'running'
  if (found === null) {
    if (view.status === 'error') {
      return { status: 'error', turn: null, partial, ...(view.error === undefined ? {} : { error: view.error }) }
    }
    return { status: view.fresh ? 'unknown' : 'loading', turn: null, partial }
  }
  if (view.status === 'error') {
    if (found.files.length > 0) {
      return { status: 'ready', turn: found, fileCount: found.files.length, partial, ...(view.error === undefined ? {} : { error: view.error }) }
    }
    return { status: 'error', turn: found, partial, ...(view.error === undefined ? {} : { error: view.error }) }
  }
  // 0 文件：**已经有数据就要出结论**，不能永远停在"正在读取"。
  // 2026-11-10 真机反馈：选中一轮没有文件改动的轮次时，左图一直显示骨架 + 「正在读取 T13 的文件…」，
  // 用户会以为卡住了。这里区分两件事：
  //   - 是不是"有数据" → 有数据就 `ready`，UI 显示「这一轮没有文件操作」；
  //   - 数字可不可信 → 只有在「数据最新 + 本轮已结束」时才给 `fileCount: 0`，
  //     否则只给 `partial`（UI 显示「本轮仍在记录」），**不谎报 0 也不假装还在读**。
  if (found.files.length === 0) {
    if (view.fresh && !partial) {
      return { status: 'ready', turn: found, fileCount: 0, partial }
    }
    return { status: 'ready', turn: found, partial }
  }
  return { status: 'ready', turn: found, fileCount: found.files.length, partial }
}
