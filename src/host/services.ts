/**
 * host 侧能力的**结构类型**（不 import `@deepseek-ai/*`：peer 只保证宿主安装，
 * 把宿主编译期类型绑进来会让未安装 peer 的工作区类型检查失败）。
 *
 * 形状来源：rc.5 实测（`evidence/01-capabilities.md` K5/K6、matrix F/G）：
 * - `connection.fetch.register({ path, methods, requestBody, fetch })` → 返回 disposal；
 * - `sessionPersistence.open(id,'read',{signal})` → handle.header / handle.read(offset?,length?,{signal}) / close()；
 * - `stat(id)` → { header, revision, sizeBytes? }；
 * - `sessionQuery.listSessions()`（可选，本机 rc.5 挂载）。
 */
import type { SessionEventLike, SessionHeaderLite } from '../shared/events/index.ts'

/** 只读会话句柄（`open(id,'read')` 的返回值子集）。 */
export interface SessionHandleLike {
  readonly header: SessionHeaderLite
  read(
    offset?: number,
    length?: number,
    options?: { signal?: AbortSignal },
  ): Promise<{ eventState?: string; events: SessionEventLike[] }>
  close?(): void | Promise<void>
}

/** `sessionPersistence` 服务子集（只读）。 */
export interface PersistenceLike {
  open(id: string, mode: 'read', options?: { signal?: AbortSignal }): Promise<SessionHandleLike>
  stat?(id: string): Promise<{ header: SessionHeaderLite; revision?: number; sizeBytes?: number }>
}

/** `sessionQuery` 服务子集（可选；`listSessions()` 本机无分页）。 */
export interface SessionQueryLike {
  listSessions?(): Promise<unknown[]>
}

/** `connection.fetch.register` 的入参形状。 */
export interface FetchRouteLike {
  path: string
  methods: string[]
  requestBody: 'buffered' | 'streaming'
  fetch(request: Request): Response | Promise<Response>
}

/** `connection` 服务子集。 */
export interface ConnectionLike {
  readonly fetch: {
    register(route: FetchRouteLike): unknown
  }
}

/** 只打错误码/计数，不打路径/正文（04 §2.1）。 */
export interface LoggerLike {
  info?(message: string): void
  warn?(message: string): void
}

/** host 路由/扫描用到的服务集合；缺失的用 getter 延迟取（服务可能后挂载）。 */
export interface HostServices {
  /** `connection` 缺失 ⇒ 无路由（插件不崩，UI hostUnavailable）。 */
  connection?: ConnectionLike
  /** `sessionPersistence` 缺失 ⇒ 路由返回 capability-missing，不起假扫描。 */
  getPersistence(): PersistenceLike | undefined
  /** `sessionQuery` 可选；有它时归属校验一次列表完成。 */
  getSessionQuery(): SessionQueryLike | undefined
  logger?: LoggerLike
}
