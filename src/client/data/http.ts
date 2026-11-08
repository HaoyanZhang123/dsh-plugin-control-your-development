/**
 * T04 · 唯一的 host 通信入口（04 §2.2–§2.7、§9）。
 *
 * 纪律：
 * - 只允许同源相对路径 `/api/dsh-threadline/*`；本文件是唯一写路由字符串的地方，
 *   任何绝对 URL / 外部 origin 一律在 `postJson` 里拒绝（不发起请求，返回 protocol 失败）。
 * - 只读：只有 POST，无其它 method；请求体是 JSON；响应要求 `ok` 字段。
 * - 不 import `fs`，不写存储，不打日志（错误码由调用方决定怎么用）。
 * - `fetch` 必须由调用方注入（浏览器用 `window.fetch`，测试用假实现），本模块不碰全局。
 */
import { THREADLINE_ERROR_CODES } from '../../shared/events/index.ts'
import type { ThreadlineError, ThreadlineErrorCode } from '../../shared/events/index.ts'

/** 注入了 `fetch` 的依赖形状（浏览器 `window.fetch` 结构兼容）。 */
export interface FetchResponseLike {
  readonly ok: boolean
  readonly status: number
  json(): Promise<unknown>
}

/** 请求初始化（只用到这几个字段，便于测试断言）。 */
export interface FetchInitLike {
  method?: string
  headers?: Record<string, string>
  body?: string
  signal?: AbortSignal
}

/** 可注入的 fetch；只接受字符串 URL（同源相对路径）。 */
export type FetchLike = (input: string, init?: FetchInitLike) => Promise<FetchResponseLike>

/** 四条只读路由（04 §2.2；唯一事实源，测试也引用这里）。 */
export const DATA_ROUTES = {
  scan: '/api/dsh-threadline/scan',
  snapshot: '/api/dsh-threadline/snapshot',
  detail: '/api/dsh-threadline/detail',
  /** 1.2.0 B1：目录列表（用户已批准的 host 只读例外，04 §9.5）。 */
  tree: '/api/dsh-threadline/tree',
} as const

export type DataRouteName = keyof typeof DATA_ROUTES

/** 路由路径前缀：只允许这个前缀（同源相对路径）。 */
export const DATA_ROUTE_PREFIX = '/api/dsh-threadline/'

/** 失败种类：`route` 是 host 明确返回的业务错误；其余是传输层。 */
export type TransportFailure =
  | { kind: 'aborted' }
  | { kind: 'network'; message: string }
  | { kind: 'malformed'; message: string; status: number }
  | { kind: 'route'; status: number; error: ThreadlineError }

/** POST 结果：成功时 value 是 JSON 对象（已确认 `ok === true`）。 */
export type PostResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; failure: TransportFailure }

const ERROR_CODES = new Set<string>(THREADLINE_ERROR_CODES)

/** 路由名 → 相对路径；未知路由名直接抛（编程错误，不发请求）。 */
export function routePath(name: DataRouteName): string {
  const path = DATA_ROUTES[name]
  if (typeof path !== 'string' || !path.startsWith(DATA_ROUTE_PREFIX)) {
    throw new Error(`threadline: refusing non-relative route ${String(path)}`)
  }
  return path
}

/** 是否同源相对路径（`/api/dsh-threadline/...` 且不含任何 origin）。 */
export function isSameOriginRoutePath(path: string): boolean {
  if (!path.startsWith(DATA_ROUTE_PREFIX)) return false
  if (path.includes('://')) return false
  if (path.startsWith('//')) return false
  return true
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function isThreadlineError(value: unknown): value is ThreadlineError {
  const record = asRecord(value)
  if (record === undefined) return false
  if (typeof record.code !== 'string' || !ERROR_CODES.has(record.code)) return false
  return typeof record.message === 'string'
}

/** 规范化 host 返回的错误体；形状不对 → internal（不臆造 code）。 */
export function normalizeError(value: unknown, fallbackMessage: string): ThreadlineError {
  if (isThreadlineError(value)) {
    const error: ThreadlineError = { code: value.code, message: value.message }
    if (typeof value.detail === 'string') error.detail = value.detail
    return error
  }
  return { code: 'threadline/internal', message: fallbackMessage }
}

/** 中止错误（AbortController 的 DOMException 或等价物）。 */
export function isAbortError(error: unknown): boolean {
  const record = asRecord(error)
  if (record !== undefined && record.name === 'AbortError') return true
  return error instanceof Error && error.name === 'AbortError'
}

/**
 * 调一条只读路由并解析 JSON。
 *
 * - 任何非相对路径（含 `://`、`//host`）都不会发出去，返回 `malformed`；
 * - `json.ok === true` → 成功；`json.ok === false` → `route` 失败（码来自 host）；
 * - 网络/JSON/中止 → 对应 transport 失败，调用方决定重试。
 */
export async function postJson(
  fetchImpl: FetchLike,
  name: DataRouteName,
  body: unknown,
  signal?: AbortSignal,
): Promise<PostResult> {
  const path = routePath(name)
  if (!isSameOriginRoutePath(path)) {
    return { ok: false, failure: { kind: 'malformed', status: 0, message: 'non-relative route rejected' } }
  }

  let raw: FetchResponseLike
  try {
    const init: FetchInitLike = {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }
    if (signal !== undefined) init.signal = signal
    raw = await fetchImpl(path, init)
  } catch (error) {
    if (isAbortError(error)) return { ok: false, failure: { kind: 'aborted' } }
    const message = error instanceof Error ? error.message : 'fetch failed'
    return { ok: false, failure: { kind: 'network', message } }
  }

  if (signal?.aborted === true) return { ok: false, failure: { kind: 'aborted' } }

  let parsed: unknown
  try {
    parsed = await raw.json()
  } catch {
    return { ok: false, failure: { kind: 'malformed', status: raw.status, message: 'invalid JSON response' } }
  }

  const record = asRecord(parsed)
  if (record === undefined) {
    return { ok: false, failure: { kind: 'malformed', status: raw.status, message: 'response is not an object' } }
  }

  if (record.ok === true) {
    if (!raw.ok) {
      return { ok: false, failure: { kind: 'malformed', status: raw.status, message: 'ok body with http error' } }
    }
    return { ok: true, value: record }
  }

  if (record.ok === false) {
    return {
      ok: false,
      failure: { kind: 'route', status: raw.status, error: normalizeError(record.error, 'host returned error') },
    }
  }

  return { ok: false, failure: { kind: 'malformed', status: raw.status, message: 'missing ok flag' } }
}

/** 业务错误的码（transport 失败统一视为 internal，便于 UI 只认 union）。 */
export function failureCode(failure: TransportFailure): ThreadlineErrorCode | 'aborted' | 'network' {
  switch (failure.kind) {
    case 'route':
      return failure.error.code
    case 'aborted':
      return 'aborted'
    case 'network':
      return 'network'
    case 'malformed':
      return 'threadline/internal'
  }
}

/** 可重试的失败：中止不算失败（调用方丢弃），业务错误由 code 决定。 */
export function isRetryableFailure(failure: TransportFailure): boolean {
  if (failure.kind === 'network' || failure.kind === 'malformed') return true
  if (failure.kind === 'route') return failure.error.code === 'threadline/internal'
  return false
}
