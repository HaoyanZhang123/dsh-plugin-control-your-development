/**
 * Host 半区入口（T03 接管 T02 的空壳）。
 *
 * 边界（04 §2.1、06 §4、§9.3）：
 * - 只读会话日志 + 只写内存；**不 import fs、不写文件、不发外部请求**；
 * - 不注册工具/投影/session 事件监听、不调用 LLM；
 * - 只有 `ctx.inject(['connection'])` 一层接线；`sessionPersistence` / `sessionQuery`
 *   用 `ctx.get(name)` 延迟取（服务可能后挂载；缺失时路由返回 capability-missing，不起假扫描）；
 * - 注册失败不崩插件，只打一条不含正文/路径的 warning；
 * - 一切注册包在 `ctx.effect` 里，卸载时由 Cordis 回收。
 */
import { VERSION } from '../shared/version.ts'
import type { ConnectionLike, HostServices, LoggerLike, PersistenceLike, SessionQueryLike } from './services.ts'
import { createRoutes } from './routes.ts'

/** 插件在 profile 里的行 id。必须等于 package.json 的 name。 */
export const name = 'dsh-plugin-control-your-development'

/**
 * 最小结构类型：本文件不 import `@deepseek-ai/cordis`，
 * 避免把宿主包的类型绑进构建期（也只允许 peer 依赖，不引运行时依赖）。
 */
export interface HostLogger extends LoggerLike {}

/** ctx.inject 传进来的作用域：与 Context 同源，这里只声明 T03 会用到的部分。 */
export interface HostScope {
  readonly logger?: HostLogger
  readonly connection?: unknown
  /** Cordis `ctx.get(name)`：服务未挂载时返回 undefined。 */
  get?(name: string): unknown
  effect?(callback: () => (() => void) | void, label?: string): void
}

export interface HostContext extends HostScope {
  inject?(services: readonly string[], callback: (scope: HostScope) => void): void
}

/** 从作用域里安全地取一个服务（`ctx.get` 优先，代理属性兜底；都没有 → undefined）。 */
function pickService(scope: HostScope, name: string): unknown {
  try {
    const viaGet = scope.get?.(name)
    if (viaGet !== undefined) return viaGet
  } catch {
    // `ctx.get` 在异常命名空间下可能抛，退化为属性读取。
  }
  try {
    return (scope as unknown as Record<string, unknown>)[name]
  } catch {
    return undefined
  }
}

/** 把 Cordis 作用域适配成扫描器/路由用的服务集合（全部延迟取，避免早绑定）。 */
export function createHostServices(scope: HostScope): HostServices {
  return {
    connection: pickService(scope, 'connection') as ConnectionLike | undefined,
    getPersistence: () => pickService(scope, 'sessionPersistence') as PersistenceLike | undefined,
    getSessionQuery: () => pickService(scope, 'sessionQuery') as SessionQueryLike | undefined,
    ...(scope.logger === undefined ? {} : { logger: scope.logger }),
  }
}

/**
 * 插件入口。
 * @param ctx Cordis 的 Context（这里按结构类型收窄，避免硬绑宿主包版本）。
 */
export function apply(ctx: HostContext): void {
  // 不含正文/路径的启动日志：证明 host 半区真的被加载，且版本来自单一事实源。
  ctx.logger?.info?.(`threadline: host loaded (v${VERSION})`)

  // connection / sessionPersistence 一起声明 inject。
  // 2026-11-04 真机实测：Cordis 的 `ctx.get('x')` 对**未在 inject 里声明**的服务一律抛
  // "cannot get property ... without inject"，pickService 兜住后返回 undefined →
  // 路由退化成 capability-missing → UI 永远显示"观测不到"。所以必须在 inject 名单里声明。
  // 两个都缺时回调不激活 → 无路由 → UI 显示 hostUnavailable（04 §2.1 的预期行为，不崩）。
  ctx.inject?.(['connection', 'sessionPersistence'], (scope) => {
    const services = createHostServices(scope)
    if (services.connection === undefined) {
      scope.logger?.warn?.('threadline: connection missing; UI will show hostUnavailable')
      return
    }
    const routes = createRoutes(services)
    let registered = false
    try {
      registered = routes.register()
    } catch {
      registered = false
    }
    if (!registered) {
      // 一句、无正文、无路径（04 §2.1）；UI 由 hostUnavailable 文案兜底。
      scope.logger?.warn?.('threadline: local routes unavailable; UI will show hostUnavailable')
    }
    scope.effect?.(() => () => routes.dispose(), 'threadline: routes')
  })
}
