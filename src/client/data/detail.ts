/**
 * T04 · 按需详情（04 §2.6 / §5.4；03 §11.3；06 A20-2 / N-16）。
 *
 * - 同一 sessionId 去重（在途只发一次）；
 * - 并发 ≤ 2（04 §5.4），其余排队；
 * - LRU 20（`LIMITS.maxDetailCache`）；
 * - `updatedAt` 变化或显式 `refresh` 时重拉 —— 客户端拿不到 `turn/end` 事件，
 *   running 会话靠“会话行 updatedAt 变化”触发刷新（04 §5.5），不猜轮次；
 * - host 返回 `partial` / `truncated` 时**显式标记**，不伪造完整；
 * - 出错保留上一次成功的 detail（标 `stale`），UI 可显示 `state.partialTurn` / “本轮仍在记录”。
 *
 * 只读：POST `/detail`，不写存储、不碰 DOM。
 */

import { LIMITS } from '../../shared/events/index.ts'
import type { SessionDetail, SessionTruncated, ThreadlineError } from '../../shared/events/index.ts'
import { postJson } from './http.ts'
import type { FetchLike } from './http.ts'

/** 详情条目的状态。 */
export type DetailStatus = 'idle' | 'loading' | 'ready' | 'error'

/** 一个会话的详情缓存条目。 */
export interface DetailEntry {
  sessionId: string
  status: DetailStatus
  /** 已拿到的详情；`error`/`loading` 时可能是上一次成功的旧值（`stale: true`）。 */
  detail?: SessionDetail
  /** host 标记“仍在记录/未读完”——已得数据为真但不完整（04 §2.6）。 */
  partial: boolean
  /** host 标记的截断维度（不静默）。 */
  truncated?: SessionTruncated
  /** 最近一次成功拉取时对应的会话行 updatedAt（用于判断是否过期）。 */
  updatedAt: number
  /** 最近一次拉取时间（now 注入）。 */
  fetchedAt: number
  error?: ThreadlineError
  /** 当前数据是旧的（加载中/失败时保留）。 */
  stale: boolean
  /** 请求时的 store generation（切换工作区后旧结果被丢弃）。 */
  generation: number
}

/** `request` 选项。 */
export interface DetailRequestOptions {
  /** 当前会话行的 updatedAt；与缓存不一致则重拉。 */
  updatedAt?: number
  /** 强制重拉（用户点“重新读取”或 running 会话定时刷新）。 */
  refresh?: boolean
  /**
   * 工作区 cwd（T13e）：host 的 `/detail` 在没有扫描时按 `header.cwd === cwd` 做归属校验。
   * 由调用方（entries / warmup）显式给；不给就不猜（老行为，host 兜底报错，不伪造）。
   */
  cwd?: string
}

/** 详情缓存接口（T08 检查器只读它）。 */
export interface DetailStore {
  /** 取详情；命中缓存且未过期时立即返回。 */
  request(sessionId: string, options?: DetailRequestOptions): Promise<DetailEntry>
  /** 同步读缓存（不触发请求）。 */
  peek(sessionId: string): DetailEntry | undefined
  /** 强制重拉（等价 `request(id, { refresh: true })`）。 */
  refresh(sessionId: string, updatedAt?: number, cwd?: string): Promise<DetailEntry>
  /** 失效一个会话（例如它被删除/换工作区）。 */
  invalidate(sessionId: string): void
  /** 清空全部缓存。 */
  clear(): void
  /**
   * 只读计数器（T37 可观测性；**只有数字与错误码**，不含路径/正文，可直接进诊断/测试）。
   */
  readonly stats: DetailStoreStats
  /**
   * 设置/清除默认 cwd（T13e）：共享 store 的调用方（impact / command / tab / warmup）
   * 只需给一次归属，后续 `request` 自动带上；cwd 变化会清空旧缓存（不同工作区不可复用）。
   */
  setDefaultCwd(cwd: string | undefined): void
  /** 当前默认 cwd（空串 = 未知）。 */
  readonly defaultCwd: string
  /** 切换 generation：丢弃旧 generation 的迟到响应（06 N-18）。 */
  setGeneration(generation: number): void
  readonly generation: number
  readonly size: number
  /** 当前在途请求数（测试断言并发 ≤2）。 */
  readonly inflight: number
  subscribe(listener: (sessionId: string, entry: DetailEntry) => void): () => void
  /** 释放：中止在途请求、清空缓存与订阅。 */
  dispose(): void
}

/**
 * 详情缓存计数器（T37）：用来回答「tab 打开时到底命中缓存还是又发了一次 `/detail`」。
 * 只含数字与该错误的 code —— 不含 sessionId / 路径 / 正文。
 */
export interface DetailStoreStats {
  /** `request()` 调用次数。 */
  requests: number
  /** 命中已就绪缓存（未发请求）的次数。 */
  hits: number
  /** 复用同会话在途请求的次数（未发新请求）。 */
  deduped: number
  /** 真正发出 `/detail` 的次数。 */
  fetches: number
  /** 失败次数。 */
  errors: number
  /** 最近一次失败的错误码（不含正文/路径）。 */
  lastErrorCode?: string
}

/** 构造选项。 */
export interface DetailStoreOptions {
  fetch: FetchLike
  now?: () => number
  /** LRU 上限；默认 20（04 §5.4）。 */
  maxEntries?: number
  /** 并发上限；默认 2（04 §5.4）。 */
  maxConcurrent?: number
  /** 初始默认 cwd（可后续 `setDefaultCwd` 更新）。 */
  cwd?: string
}

function normalizeCwd(value: string | undefined): string {
  if (typeof value !== 'string') return ''
  return value.trim()
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

/** 建详情缓存（一个实例服务一个工作区/页面生命周期）。 */
export function createDetailStore(options: DetailStoreOptions): DetailStore {
  const maxEntries = options.maxEntries ?? LIMITS.maxDetailCache
  const maxConcurrent = Math.max(1, options.maxConcurrent ?? 2)
  const now = options.now ?? Date.now

  const entries = new Map<string, DetailEntry>()
  const inflight = new Map<string, Promise<DetailEntry>>()
  const listeners = new Set<(sessionId: string, entry: DetailEntry) => void>()
  const queue: Array<() => void> = []
  let active = 0
  let generation = 0
  let abort: AbortController | undefined
  let disposed = false
  let defaultCwd = normalizeCwd(options.cwd)
  /** 计数器（T37 可观测性）：只有数字/错误码，不落路径或正文。 */
  const stats: DetailStoreStats = { requests: 0, hits: 0, deduped: 0, fetches: 0, errors: 0 }

  const recordError = (code: string | undefined): void => {
    stats.errors += 1
    if (code !== undefined) stats.lastErrorCode = code
  }

  const notify = (entry: DetailEntry): void => {
    for (const listener of listeners) {
      try {
        listener(entry.sessionId, entry)
      } catch {
        // 订阅方异常不影响缓存。
      }
    }
  }

  const touch = (entry: DetailEntry): void => {
    entries.delete(entry.sessionId)
    entries.set(entry.sessionId, entry)
    while (entries.size > maxEntries) {
      const oldest = entries.keys().next()
      if (oldest.done === true) break
      entries.delete(oldest.value)
    }
  }

  const acquire = (): Promise<void> => {
    if (active < maxConcurrent) {
      active += 1
      return Promise.resolve()
    }
    return new Promise<void>((resolve) => {
      queue.push(() => {
        active += 1
        resolve()
      })
    })
  }

  const release = (): void => {
    active -= 1
    const next = queue.shift()
    if (next !== undefined) next()
  }

  const shouldReuse = (entry: DetailEntry | undefined, requested: DetailRequestOptions | undefined): entry is DetailEntry => {
    if (entry === undefined || entry.status !== 'ready') return false
    if (requested?.refresh === true) return false
    if (requested?.updatedAt !== undefined && requested.updatedAt !== entry.updatedAt) return false
    return true
  }

  const run = async (sessionId: string, requested: DetailRequestOptions | undefined): Promise<DetailEntry> => {
    const requestGeneration = generation
    const previous = entries.get(sessionId)
    const placeholder: DetailEntry = {
      sessionId,
      status: 'loading',
      partial: previous?.partial ?? false,
      updatedAt: previous?.updatedAt ?? 0,
      fetchedAt: previous?.fetchedAt ?? 0,
      stale: previous?.detail !== undefined,
      generation: requestGeneration,
      ...(previous?.detail === undefined ? {} : { detail: previous.detail }),
      ...(previous?.truncated === undefined ? {} : { truncated: previous.truncated }),
    }
    touch(placeholder)
    notify(placeholder)
    await acquire()
    try {
      if (disposed || generation !== requestGeneration) {
        // 工作区已切换：不写缓存、不发请求（丢弃旧 generation）。
        const skipped: DetailEntry = { ...placeholder, status: previous?.status ?? 'idle' }
        return skipped
      }
      if (abort === undefined) abort = new AbortController()
      const body: Record<string, unknown> = { sessionId, generation: requestGeneration }
      if (requested?.refresh === true) body.refresh = true
      /* 1.5.3（性能）：把会话行的 updatedAt 一起发过去。host 用它判断"日志有没有变"——
       * 未变就直接返回缓存，不再全量读日志（实测单会话 10.9MB 要 249ms，89% 花在重复解压/解析）。
       * 只在调用方明确给了数字时才带；没给就不带（host 会照旧读，不伪造命中）。 */
      if (typeof requested?.updatedAt === 'number' && Number.isFinite(requested.updatedAt) && requested.updatedAt >= 0) {
        body.updatedAt = requested.updatedAt
      }
      // T13e：cwd 只来自调用方（options）或已显式设置的默认值；不做任何推断。
      const cwd = normalizeCwd(requested?.cwd) || defaultCwd
      if (cwd !== '') body.cwd = cwd
      stats.fetches += 1
      const result = await postJson(options.fetch, 'detail', body, abort.signal)

      if (disposed || generation !== requestGeneration) {
        return { ...placeholder, status: previous?.status ?? 'idle' }
      }

      if (!result.ok) {
        if (result.failure.kind === 'aborted') {
          return { ...placeholder, status: previous?.status ?? 'idle' }
        }
        const error: ThreadlineError =
          result.failure.kind === 'route'
            ? result.failure.error
            : { code: 'threadline/internal', message: result.failure.message }
        recordError(error.code)
        const failed: DetailEntry = {
          sessionId,
          status: 'error',
          partial: false,
          updatedAt: previous?.updatedAt ?? requested?.updatedAt ?? 0,
          fetchedAt: now(),
          error,
          stale: previous?.detail !== undefined,
          generation: requestGeneration,
          ...(previous?.detail === undefined ? {} : { detail: previous.detail }),
        }
        touch(failed)
        notify(failed)
        return failed
      }

      const session = asRecord(result.value.session) as unknown as SessionDetail | undefined
      if (session === undefined || typeof session.id !== 'string') {
        recordError('threadline/internal')
        const malformed: DetailEntry = {
          sessionId,
          status: 'error',
          partial: false,
          updatedAt: previous?.updatedAt ?? 0,
          fetchedAt: now(),
          error: { code: 'threadline/internal', message: 'detail response missing session' },
          stale: previous?.detail !== undefined,
          generation: requestGeneration,
          ...(previous?.detail === undefined ? {} : { detail: previous.detail }),
        }
        touch(malformed)
        notify(malformed)
        return malformed
      }

      const partial = session.partial === true
      const ready: DetailEntry = {
        sessionId,
        status: 'ready',
        detail: session,
        partial,
        updatedAt:
          typeof requested?.updatedAt === 'number' && Number.isFinite(requested.updatedAt)
            ? requested.updatedAt
            : session.updatedAt,
        fetchedAt: now(),
        stale: false,
        generation: requestGeneration,
        ...(session.truncated === undefined ? {} : { truncated: session.truncated }),
      }
      touch(ready)
      notify(ready)
      return ready
    } finally {
      release()
    }
  }

  const store: DetailStore = {
    request(sessionId: string, requested?: DetailRequestOptions): Promise<DetailEntry> {
      stats.requests += 1
      if (disposed || typeof sessionId !== 'string' || sessionId === '') {
        recordError('threadline/bad-request')
        return Promise.resolve({
          sessionId: typeof sessionId === 'string' ? sessionId : '',
          status: 'error',
          partial: false,
          updatedAt: 0,
          fetchedAt: now(),
          error: { code: 'threadline/bad-request', message: 'invalid sessionId' },
          stale: false,
          generation,
        })
      }
      const cached = entries.get(sessionId)
      if (shouldReuse(cached, requested)) {
        stats.hits += 1
        touch(cached)
        return Promise.resolve(cached)
      }
      const pending = inflight.get(sessionId)
      if (pending !== undefined) {
        stats.deduped += 1
        return pending
      }
      const promise = run(sessionId, requested).finally(() => {
        inflight.delete(sessionId)
      })
      inflight.set(sessionId, promise)
      return promise
    },
    refresh(sessionId: string, updatedAt?: number, cwd?: string): Promise<DetailEntry> {
      return store.request(sessionId, {
        refresh: true,
        ...(typeof updatedAt === 'number' ? { updatedAt } : {}),
        ...(typeof cwd === 'string' && cwd !== '' ? { cwd } : {}),
      })
    },
    peek(sessionId: string): DetailEntry | undefined {
      const entry = entries.get(sessionId)
      if (entry === undefined) return undefined
      return entry
    },
    invalidate(sessionId: string): void {
      entries.delete(sessionId)
    },
    clear(): void {
      entries.clear()
    },
    get stats(): DetailStoreStats {
      return { ...stats }
    },
    setDefaultCwd(nextCwd: string | undefined): void {
      const normalized = normalizeCwd(nextCwd)
      if (normalized === defaultCwd) return
      defaultCwd = normalized
      // 归属变化（换工作区）：旧缓存不再可信，在途请求按 generation 丢弃。
      entries.clear()
      abort?.abort()
      abort = undefined
    },
    get defaultCwd(): string {
      return defaultCwd
    },
    setGeneration(nextGeneration: number): void {
      if (nextGeneration === generation) return
      generation = nextGeneration
      // 换工作区：旧缓存不再可信，清空（在途请求返回后按 generation 丢弃）。
      entries.clear()
      abort?.abort()
      abort = undefined
    },
    get generation(): number {
      return generation
    },
    get size(): number {
      return entries.size
    },
    get inflight(): number {
      return inflight.size
    },
    subscribe(listener: (sessionId: string, entry: DetailEntry) => void): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    dispose(): void {
      disposed = true
      abort?.abort()
      abort = undefined
      listeners.clear()
      entries.clear()
      inflight.clear()
    },
  }

  return store
}
