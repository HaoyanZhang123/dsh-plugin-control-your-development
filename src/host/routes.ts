/**
 * 本地只读路由（04 §2.2/§2.4–§2.7、§9.3）。
 *
 * 四个路由，全部 `POST` + `requestBody: 'buffered'`，只做「校验 → 调只读实现 → 返回 JSON」：
 *   /api/dsh-threadline/scan      （会话日志只读扫描）
 *   /api/dsh-threadline/snapshot  （扫描快照）
 *   /api/dsh-threadline/detail    （单会话详情）
 *   /api/dsh-threadline/tree      （B1 只读目录列表；遥不可及项见 host/tree.ts，用户已批准）
 *
 * 硬约束：
 * - 只读：不写文件、不写存储、不发外部请求；
 * - sessionId 走 `^[A-Za-z0-9._:-]{1,200}$`，从根上排除路径穿越；tree 的 path 只接受
 *   工作区相对路径，且由 host/tree.ts 做 cwd 包含检查 + 符号链接逃逸检查；
 * - 所有响应 `cache-control: no-store`；
 * - 注册失败不抛崩插件（返回 false，由 index.ts 只打一条 warning）；
 * - 日志只打错误码/计数，不打路径/正文（tree 分支同守）。
 */
import {
  isAbsoluteCwd,
  isSessionId,
  normalizeCwd,
  normalizeRefreshIds,
  normalizeScanSessions,
} from '../shared/events/index.ts'
import type {
  DetailRequest,
  Ok,
  ScanRequest,
  ScanSessionSkip,
  SnapshotRequest,
  ThreadlineErrorCode,
  ThreadlineResponse,
} from '../shared/events/index.ts'
import type { HostServices } from './services.ts'
import { ScanManager } from './scan.ts'
import { HOST_TREE_MAX_PATH_LENGTH, handleTreeRequest, type TreeRequest } from './tree.ts'

/** 四个路由的路径（唯一事实源；测试也引用这里）。 */
export const ROUTE_PATHS = {
  scan: '/api/dsh-threadline/scan',
  snapshot: '/api/dsh-threadline/snapshot',
  detail: '/api/dsh-threadline/detail',
  /**
   * 1.2.0 B1：目录列表（04 §9.5 的 host 只读例外，用户 2026-11-07 已批准）。
   * 只在 `remote.workspaceFiles.list` 不可用时由客户端调用。
   */
  tree: '/api/dsh-threadline/tree',
} as const

/** 会话 id 形状（04 §2.4；不允许 `/`、`\`、`..` 等路径成分）。 */
/**
 * 会话 id 的形状规则由 `shared/events/normalize.ts` 单一拥有（客户端与 host 共用同一份），
 * 这里不再另立正则 —— 两处各写一份正是历史上"客户端放行、host 拒绝"的来源。
 */

/** scanId 形状（host 自己生成，同样不接受路径成分）。 */
const SCAN_ID_RE = /^[A-Za-z0-9._:-]{1,200}$/
const MAX_SESSIONS = 3000
/** cwd 长度上限（scan 与 detail 共用同一条规则；正常绝对路径远小于它）。 */
const MAX_CWD_LENGTH = 4096

interface ValidationFailure {
  ok: false
  code: ThreadlineErrorCode
  message: string
}

type Validation<T> = { ok: true; value: T } | ValidationFailure

function failure(code: ThreadlineErrorCode, message: string): ValidationFailure {
  return { ok: false, code, message }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** 请求体 → JSON（非法 JSON/非对象 → bad-request，不抛）。 */
async function readJsonBody(request: Request): Promise<Record<string, unknown> | undefined> {
  try {
    const parsed: unknown = await request.json()
    return asRecord(parsed)
  } catch {
    return undefined
  }
}

/* ------------------------------------------------------------------ *
 * 参数校验（04 §2.4–§2.6）
 * ------------------------------------------------------------------ */

/**
 * `/scan` 的校验结果。
 *
 * `request` 是**已知良好**的请求；`skipped` / `refreshDropped` 是「被容错处理掉的」计数依据，
 * 必须原样带回去上报 —— 容错不等于静默（项目铁律：不许静默遗漏）。
 */
export interface ValidatedScanRequest {
  request: ScanRequest
  skipped: ScanSessionSkip[]
  refreshDropped: number
}

/**
 * 校验 `POST /scan` 请求。
 *
 * **分两层**（2026-11-09 改为该策略）：
 * - **结构性错误**才 `bad-request`：body 不是对象、workspaceId/cwd/generation 不可用、sessions 不是数组或超上限；
 * - **行级问题**（id 非法、时间戳坏、装饰字段是 null…）→ **跳过该行并记账**，不打断整体。
 *
 * 理由：一行装饰性元数据毁掉 153 个会话的扫描，是"把数据质量问题当协议错误"，用户看到的是白屏。
 */
export function validateScanRequest(body: unknown): Validation<ValidatedScanRequest> {
  const record = asRecord(body)
  if (record === undefined) return failure('threadline/bad-request', 'body must be an object')

  const workspaceId = asString(record.workspaceId)
  if (workspaceId === undefined || workspaceId.trim() === '' || workspaceId.length > 200) {
    return failure('threadline/bad-request', 'invalid workspaceId')
  }
  const cwd = asString(record.cwd)
  if (cwd === undefined || cwd.trim() === '' || cwd.length > MAX_CWD_LENGTH || !isAbsoluteCwd(cwd)) {
    return failure('threadline/bad-request', 'invalid cwd')
  }
  if (normalizeCwd(cwd) === '') return failure('threadline/bad-request', 'invalid cwd')
  const generation = asFiniteNumber(record.generation)
  if (generation === undefined || generation < 0 || !Number.isInteger(generation)) {
    return failure('threadline/bad-request', 'invalid generation')
  }
  const rawSessions = record.sessions
  if (!Array.isArray(rawSessions)) return failure('threadline/bad-request', 'sessions must be an array')
  if (rawSessions.length > MAX_SESSIONS) return failure('threadline/bad-request', 'too many sessions')
  // 逐行**解析**而不是校验：脏行跳过并记账，绝不让一行装饰性数据打掉整条扫描
  // （2026-11-09 真机事故：一个 `title: null` 让 153 个会话的工作区整条 400）。
  const normalized = normalizeScanSessions(rawSessions)
  const sessions = normalized.sessions

  // `refresh` 是**优化提示**（哪些会话要重读），不是数据本身：
  // 非法或不在本次集合里的 id 一律丢弃并计数，绝不因此拒绝整条请求。
  const refreshResult = normalizeRefreshIds(
    record.refresh,
    new Set(sessions.map((session) => session.id)),
  )

  const request: ScanRequest = { workspaceId, cwd, generation, sessions }
  if (refreshResult.ids.length > 0) request.refresh = refreshResult.ids
  return {
    ok: true,
    value: { request, skipped: normalized.skipped, refreshDropped: refreshResult.dropped },
  }
}

/** 校验 `POST /snapshot` 请求。 */
export function validateSnapshotRequest(body: unknown): Validation<SnapshotRequest> {
  const record = asRecord(body)
  if (record === undefined) return failure('threadline/bad-request', 'body must be an object')
  const scanId = asString(record.scanId)
  if (scanId === undefined || !SCAN_ID_RE.test(scanId) || scanId === '.' || scanId === '..') {
    return failure('threadline/bad-request', 'invalid scanId')
  }
  const sinceRev = asFiniteNumber(record.sinceRev)
  if (sinceRev === undefined || sinceRev < 0 || !Number.isInteger(sinceRev)) {
    return failure('threadline/bad-request', 'invalid sinceRev')
  }
  return { ok: true, value: { scanId, sinceRev } }
}

/** 校验 `POST /detail` 请求。 */
export function validateDetailRequest(body: unknown): Validation<DetailRequest> {
  const record = asRecord(body)
  if (record === undefined) return failure('threadline/bad-request', 'body must be an object')
  if (!isSessionId(record.sessionId)) return failure('threadline/bad-request', 'invalid sessionId')
  const value: DetailRequest = { sessionId: record.sessionId }
  if (record.generation !== undefined) {
    const generation = asFiniteNumber(record.generation)
    if (generation === undefined || generation < 0 || !Number.isInteger(generation)) {
      return failure('threadline/bad-request', 'invalid generation')
    }
    value.generation = generation
  }
  if (record.refresh !== undefined) {
    if (typeof record.refresh !== 'boolean') return failure('threadline/bad-request', 'invalid refresh flag')
    value.refresh = record.refresh
  }
  /* 可选 updatedAt（1.5.3 性能）：只接受有限非负数；非法值**丢弃而不是拒绝**
   * （行级字段不该打断整条请求，与 /scan 的容错口径一致）。 */
  if (record.updatedAt !== undefined) {
    const updatedAt = asFiniteNumber(record.updatedAt)
    if (updatedAt !== undefined && updatedAt >= 0) value.updatedAt = updatedAt
  }
  // 可选 cwd：与 scan 同一条规则（非空、绝对路径、长度上限）。不带也能工作（老客户端）。
  if (record.cwd !== undefined) {
    const cwd = asString(record.cwd)
    if (cwd === undefined || cwd.trim() === '' || cwd.length > MAX_CWD_LENGTH || !isAbsoluteCwd(cwd)) {
      return failure('threadline/bad-request', 'invalid cwd')
    }
    if (normalizeCwd(cwd) === '') return failure('threadline/bad-request', 'invalid cwd')
    value.cwd = cwd
  }
  return { ok: true, value }
}

/* ------------------------------------------------------------------ *
 * 响应
 * ------------------------------------------------------------------ */

const NO_STORE = { 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8' }

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: NO_STORE })
}

function errorResponse(code: ThreadlineErrorCode, message: string, detail?: string): Response {
  return jsonResponse({ ok: false, error: { code, message, ...(detail === undefined ? {} : { detail }) } })
}

function toResponse<T>(result: ThreadlineResponse<T>): Response {
  return jsonResponse(result)
}

/* ------------------------------------------------------------------ *
 * createRoutes
 * ------------------------------------------------------------------ */

/** 路由注册结果：`register()` 返回是否成功；失败由调用方只打一条 warning。 */
export interface RoutesHandle {
  register(): boolean
  dispose(): void
  /** 测试/自检入口：调用与真实注册完全相同的 handler（不经过 HTTP）。 */
  invoke(kind: keyof typeof ROUTE_PATHS, request: Request): Promise<Response>
  /** 测试与自检用：扫描器引用（不暴露给客户端）。 */
  readonly manager: ScanManager
}

/** 给 `connection.fetch.register` 的最小形状（与 services.ts 同源）。 */
interface ConnectionLike {
  readonly fetch: {
    register(route: {
      path: string
      methods: string[]
      requestBody: 'buffered' | 'streaming'
      fetch(request: Request): Response | Promise<Response>
    }): unknown
  }
}

/* ------------------------------------------------------------------ *
 * 第 4 条路由：tree（B1 host 只读目录列表；用户已批准，见 host/tree.ts 头注释）
 * ------------------------------------------------------------------ */

/** 校验 `POST /tree`：sessionId 与 scan/detail 同一条规则；path 交给 host/tree.ts 的校验器。 */
export function validateTreeRequest(body: unknown): Validation<TreeRequest> {
  const record = asRecord(body)
  if (record === undefined) return failure('threadline/bad-request', 'body must be an object')
  if (!isSessionId(record.sessionId)) return failure('threadline/bad-request', 'invalid sessionId')
  const rawPath = record.path
  if (rawPath !== undefined && typeof rawPath !== 'string') {
    return failure('threadline/bad-request', 'invalid path')
  }
  const path = rawPath ?? ''
  if (path.length > HOST_TREE_MAX_PATH_LENGTH) return failure('threadline/bad-request', 'invalid path')
  return { ok: true, value: { sessionId: record.sessionId, path } }
}

/** 建四条只读路由。`sessionPersistence` 缺失时路由仍注册（返回 capability-missing）。 */
export function createRoutes(services: HostServices, manager?: ScanManager): RoutesHandle {
  const scanner = manager ?? new ScanManager(services)
  let disposers: Array<() => void> = []
  let registered = false

  const handlers: Array<{ path: string; fetch(request: Request): Promise<Response> }> = [
    {
      path: ROUTE_PATHS.scan,
      async fetch(request: Request): Promise<Response> {
        const body = await readJsonBody(request)
        if (body === undefined) return errorResponse('threadline/bad-request', 'invalid JSON body')
        const validation = validateScanRequest(body)
        if (!validation.ok) return errorResponse(validation.code, validation.message)
        try {
          return toResponse(
            await scanner.startRequest(validation.value.request, {
              skipped: validation.value.skipped,
              refreshDropped: validation.value.refreshDropped,
            }),
          )
        } catch {
          return errorResponse('threadline/internal', 'scan failed')
        }
      },
    },
    {
      path: ROUTE_PATHS.snapshot,
      async fetch(request: Request): Promise<Response> {
        const body = await readJsonBody(request)
        if (body === undefined) return errorResponse('threadline/bad-request', 'invalid JSON body')
        const validation = validateSnapshotRequest(body)
        if (!validation.ok) return errorResponse(validation.code, validation.message)
        try {
          return toResponse(scanner.snapshotRequest(validation.value))
        } catch {
          return errorResponse('threadline/internal', 'snapshot failed')
        }
      },
    },
    {
      path: ROUTE_PATHS.detail,
      async fetch(request: Request): Promise<Response> {
        const body = await readJsonBody(request)
        if (body === undefined) return errorResponse('threadline/bad-request', 'invalid JSON body')
        const validation = validateDetailRequest(body)
        if (!validation.ok) return errorResponse(validation.code, validation.message)
        try {
          return toResponse(await scanner.detailRequest(validation.value))
        } catch {
          return errorResponse('threadline/internal', 'detail failed')
        }
      },
    },
    {
      // B1：只读目录列表（读 fs、零写；cwd 卡口/符号链接/上限都在 host/tree.ts 里）。
      path: ROUTE_PATHS.tree,
      async fetch(request: Request): Promise<Response> {
        const body = await readJsonBody(request)
        if (body === undefined) return errorResponse('threadline/bad-request', 'invalid JSON body')
        const validation = validateTreeRequest(body)
        if (!validation.ok) return errorResponse(validation.code, validation.message)
        try {
          const result = await handleTreeRequest(
            {
              getPersistence: () => services.getPersistence(),
              ...(services.logger === undefined ? {} : { logger: services.logger }),
            },
            validation.value,
          )
          if (!result.ok) {
            return errorResponse(
              result.code,
              result.message,
              result.detail === undefined ? undefined : result.detail,
            )
          }
          return toResponse({
            ok: true as const,
            path: result.path,
            entries: result.entries,
            truncated: result.truncated,
          })
        } catch {
          return errorResponse('threadline/internal', 'tree failed')
        }
      },
    },
  ]

  const invoke = async (kind: keyof typeof ROUTE_PATHS, request: Request): Promise<Response> => {
    const handler = handlers.find((candidate) => candidate.path === ROUTE_PATHS[kind])
    if (handler === undefined) return errorResponse('threadline/internal', 'route missing')
    return handler.fetch(request)
  }

  return {
    manager: scanner,
    invoke,
    register(): boolean {
      if (registered) return true
      const connection = services.connection as ConnectionLike | undefined
      if (connection === undefined || connection.fetch === undefined) return false
      const created: Array<() => void> = []
      try {
        for (const handler of handlers) {
          const disposal = connection.fetch.register({
            path: handler.path,
            methods: ['POST'],
            requestBody: 'buffered',
            fetch: (request: Request) => handler.fetch(request),
          })
          if (typeof disposal === 'function') created.push(disposal as () => void)
          else if (
            typeof disposal === 'object' &&
            disposal !== null &&
            typeof (disposal as { dispose?: unknown }).dispose === 'function'
          ) {
            created.push((disposal as { dispose(): void }).dispose.bind(disposal) as () => void)
          }
        }
      } catch {
        // 注册失败：回收已注册的部分，返回 false（插件不崩，UI 显示 hostUnavailable）。
        for (const disposal of created.reverse()) {
          try {
            disposal()
          } catch {
            // 忽略回收失败。
          }
        }
        return false
      }
      disposers = created
      registered = true
      return true
    },
    dispose(): void {
      for (const disposal of disposers.reverse()) {
        try {
          disposal()
        } catch {
          // 忽略回收失败。
        }
      }
      disposers = []
      registered = false
      scanner.dispose()
    },
  }
}

/** 测试辅助：把 Ok 结果收窄。 */
export function expectOk<T>(result: ThreadlineResponse<T>): Ok<T> {
  if (result.ok !== true) throw new Error(`expected ok, got ${JSON.stringify(result)}`)
  return result
}
