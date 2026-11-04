/*
 * tests/entries/fake-ctx.ts —— 假 client ctx（三个入口的注册/清理断言用）。
 *
 * 形状照真实宿主：`ctx.get(name)` / `ctx.inject(names, cb)` / `ctx.effect(cb, label)` /
 * `ctx.slots.inject(name, () => ctx.slots.register(options, factory))`。
 * 记录：注册项（name/options/factory）、effect 标签、disposer、日志。
 */
import type { ClientScopeLike, Disposer } from '../../src/client/entries/context.ts'

export interface RegisteredEntry {
  name: string
  options: Record<string, unknown>
  factory: (props: never) => unknown
}

export interface LoggedLine {
  level: 'info' | 'warn'
  message: string
}

export interface FakeCtx {
  ctx: ClientScopeLike
  entries: RegisteredEntry[]
  logs: LoggedLine[]
  effectLabels: string[]
  disposedSlots: string[]
  disposedEffects: string[]
  disposeAll(): void
  registration(name: string): RegisteredEntry | undefined
}

export interface FakeCtxOptions {
  services?: Record<string, unknown>
  /** false = 模拟旧版/缺失 slot（`ctx.slots` 不存在）。 */
  withSlots?: boolean
}

export function createFakeCtx(options: FakeCtxOptions = {}): FakeCtx {
  const services = options.services ?? {}
  const entries: RegisteredEntry[] = []
  const logs: LoggedLine[] = []
  const effectLabels: string[] = []
  const disposedSlots: string[] = []
  const disposedEffects: string[] = []
  const disposers: Disposer[] = []

  const slots =
    options.withSlots === false
      ? undefined
      : {
          inject(name: string, callback: () => unknown) {
            void name
            return callback()
          },
          register(entryOptions: Record<string, unknown>, factory: (props: never) => unknown) {
            const name = String(entryOptions.name ?? '')
            entries.push({ name, options: entryOptions, factory })
            return () => {
              disposedSlots.push(name)
            }
          },
        }

  const ctx: ClientScopeLike = {
    get<T = unknown>(name: string): T | undefined {
      return services[name] as T | undefined
    },
    inject(names: readonly string[], callback: (scope?: unknown) => void) {
      if (names.some((name) => services[name] !== undefined)) callback(ctx)
      return () => undefined
    },
    effect(callback: () => Disposer | void, label?: string) {
      if (label !== undefined) effectLabels.push(label)
      const dispose = callback()
      if (typeof dispose === 'function') {
        disposers.push(dispose)
        disposedEffects.push(label ?? '(anonymous)')
      }
      return dispose
    },
    logger: {
      info(message: string) {
        logs.push({ level: 'info', message })
      },
      warn(message: string) {
        logs.push({ level: 'warn', message })
      },
    },
    ...(slots === undefined ? {} : { slots }),
  }

  return {
    ctx,
    entries,
    logs,
    effectLabels,
    disposedSlots,
    disposedEffects,
    disposeAll() {
      for (const dispose of disposers) {
        try {
          dispose()
        } catch {
          // 卸载路径不该抛错；抛了也让后续 disposer 继续跑
        }
      }
    },
    registration(name: string) {
      return entries.find((entry) => entry.name === name)
    },
  }
}

/** 假 `inputTriggers` 服务（记录 registerSource 的入参与 disposer）。 */
export function createFakeInputTriggers(): {
  service: { registerSource(source: unknown): () => void }
  sources: Array<Record<string, unknown>>
  disposed: string[]
} {
  const sources: Array<Record<string, unknown>> = []
  const disposed: string[] = []
  return {
    service: {
      registerSource(source: unknown) {
        const record = source as Record<string, unknown>
        sources.push(record)
        return () => {
          disposed.push(String(record.name ?? ''))
        }
      },
    },
    sources,
    disposed,
  }
}
