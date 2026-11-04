/*
 * entries/context.ts —— 三个入口共用的**宿主结构契约**与注册工具（不 import 宿主包）。
 *
 * 为什么全是结构类型：宿主 client 包随 DSH 版本变，直接 import 会让插件在旧版 DSH 上加载失败；
 * 这里只描述"我们真的用到的形状"，slot 缺失/服务缺失时**只 warn、不崩**（03 §2；06 A43-5 / N-19）。
 */
import type { FetchLike } from '../data/index.ts'

/** 宿主 logger（字段可选；只打错误码/计数，不打正文）。 */
export interface ClientLoggerLike {
  info?(message: string): void
  warn?(message: string): void
  error?(message: string): void
}

/** 注册/监听返回的清理函数。 */
export type Disposer = () => void

/** slot 注册表（真实宿主是 `ctx.slots`；测试用假实现）。 */
export interface SlotTableLike {
  /** 宿主风格：`inject(name, () => register(...))`（slot 可用时才注册）。 */
  inject?(name: string, callback: () => unknown): unknown
  /** 直接注册：`register({ name, id, order, ... }, factory)` → disposer。 */
  register?(options: Record<string, unknown>, component: unknown): unknown
  /** 已注册项（诊断/去重用；宿主不一定提供）。 */
  entries?(name: string): unknown
}

/** 我们能安全使用的 client scope（`ctx` / `ctx.inject` 的子 scope 都满足它）。 */
export interface ClientScopeLike {
  get<T = unknown>(name: string): T | undefined
  inject?(names: readonly string[], callback: (scope?: unknown) => void): unknown
  effect?(callback: () => Disposer | void, label?: string): unknown
  logger?: ClientLoggerLike
  slots?: SlotTableLike
  locale?: unknown
}

/** 客户端入口上下文（index.ts 的 `apply(ctx)` 形参）。 */
export type ClientContextLike = ClientScopeLike

/** 宿主标准 props 里的快照 hook（`useSessions(s => s)`）。 */
export type SnapshotHook = (selector: (snapshot: unknown) => unknown) => unknown

const NOOP: Disposer = () => {}

/** 安全 warn（logger 缺失/抛错都不影响注册）。 */
export function warn(ctx: ClientScopeLike, message: string): void {
  try {
    ctx.logger?.warn?.('threadline: ' + message)
  } catch {
    // logger 自己坏了也不能让插件崩
  }
}

/** 安全 info。 */
export function info(ctx: ClientScopeLike, message: string): void {
  try {
    ctx.logger?.info?.('threadline: ' + message)
  } catch {
    // 同上
  }
}

/**
 * 注册一个 slot 占用，并把 disposer 收进 `ctx.effect`（卸载必须撤销）。
 *
 * - 优先走宿主风格 `slots.inject(name, () => register(...))`（slot 可用时才注册）；
 * - 没有 `inject` 时直接 `register`；
 * - `slots` 缺失 → warn 并返回 false（**不崩**，入口缺失由验收发现）。
 */
export function registerSlot(
  ctx: ClientScopeLike,
  name: string,
  options: Record<string, unknown>,
  factory: (props: never) => unknown,
  label: string,
): boolean {
  let registered = false
  const run = (): Disposer => {
    const slots = ctx.slots
    if (slots === undefined || typeof slots.register !== 'function') {
      warn(ctx, 'slots 不可用，跳过 ' + name)
      return NOOP
    }
    const dispose = slots.register({ name, ...options }, factory)
    registered = true
    return typeof dispose === 'function' ? (dispose as Disposer) : NOOP
  }
  try {
    if (typeof ctx.effect !== 'function') {
      run()
      return registered
    }
    ctx.effect(() => {
      const slots = ctx.slots
      if (slots !== undefined && typeof slots.inject === 'function') {
        const dispose = slots.inject(name, () => run())
        return typeof dispose === 'function' ? (dispose as Disposer) : NOOP
      }
      return run()
    }, label)
    return registered
  } catch (error) {
    warn(ctx, '注册 ' + name + ' 失败：' + describeError(error))
    return false
  }
}

/** 把异常压成一行（不带堆栈正文；日志只给错误码/消息）。 */
export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message
  return typeof error === 'string' ? error : 'unknown-error'
}

/** 宿主标准 props 里的快照 hook → 快照对象（缺失/抛错都返回 undefined，不猜）。 */
export function readSnapshot<T>(hook: unknown): T | undefined {
  if (typeof hook !== 'function') return undefined
  try {
    const value = (hook as SnapshotHook)((snapshot) => snapshot)
    if (typeof value !== 'object' || value === null) return undefined
    return value as T
  } catch {
    return undefined
  }
}

/** 浏览器 fetch（宿主页面里一定有；取不到时给一个"不可达"实现，让 UI 显式降级）。 */
const UNAVAILABLE_FETCH: FetchLike = () => Promise.reject(new Error('fetch-unavailable'))

const DEFAULT_FETCH: FetchLike =
  typeof globalThis.fetch === 'function'
    ? (input, init) =>
        globalThis
          .fetch(input, init as RequestInit)
          .then((response) => ({ ok: response.ok, status: response.status, json: () => response.json() }))
    : UNAVAILABLE_FETCH

/** 默认 fetch（同源相对路径；宿主不可用时返回"网络失败"，由数据层降级）。 */
export function defaultFetch(): FetchLike {
  return DEFAULT_FETCH
}

/** 可选地解析一个只读动作服务（不存在就 undefined，不抛错）。 */
export function optionalMethod<T>(ctx: ClientScopeLike, service: string, method: string): T | undefined {
  try {
    const target = ctx.get<Record<string, unknown>>(service)
    if (target === null || target === undefined) return undefined
    const fn = target[method]
    if (typeof fn !== 'function') return undefined
    return fn.bind(target) as T
  } catch {
    return undefined
  }
}
