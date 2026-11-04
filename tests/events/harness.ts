/**
 * 测试驱动小工具：走真实路由 handler（`routes.invoke`），不经过 HTTP 服务器。
 * 只用内存 pump 推进时间，不固定 sleep（确定性）。
 */
import { ROUTE_PATHS } from '../../src/host/routes.ts'
import type { RoutesHandle } from '../../src/host/routes.ts'
import type { ThreadlineErrorCode } from '../../src/shared/events/index.ts'

type Routes = RoutesHandle

export interface RouteReply {
  status: number
  cacheControl: string | null
  json: Record<string, unknown>
  bytes: number
}

/** 调一次路由并解析 JSON。 */
export async function post(routes: Routes, kind: 'scan' | 'snapshot' | 'detail', body: unknown): Promise<RouteReply> {
  const response = await routes.invoke(
    kind,
    new Request(`http://127.0.0.1${ROUTE_PATHS[kind]}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
  const text = await response.text()
  return {
    status: response.status,
    cacheControl: response.headers.get('cache-control'),
    json: JSON.parse(text) as Record<string, unknown>,
    bytes: Buffer.byteLength(text, 'utf8'),
  }
}

/** 取错误码（断言用；不是统一错误码视为测试失败）。 */
export function errorCode(reply: RouteReply): ThreadlineErrorCode {
  const error = reply.json.error as { code?: string } | undefined
  return (error?.code ?? 'threadline/internal') as ThreadlineErrorCode
}

/** 一直轮询 snapshot 直到 done（最多 500 次 pump，避免死循环）。 */
export async function waitUntilDone(
  routes: Routes,
  scanId: string,
  options: { sinceRev?: number; maxTicks?: number } = {},
): Promise<Record<string, unknown>> {
  const sinceRev = options.sinceRev ?? 0
  const maxTicks = options.maxTicks ?? 500
  let reply = await post(routes, 'snapshot', { scanId, sinceRev })
  for (let i = 0; i < maxTicks; i += 1) {
    if (reply.json.ok === true && reply.json.done === true) return reply.json
    await new Promise<void>((resolve) => setTimeout(resolve, 1))
    reply = await post(routes, 'snapshot', { scanId, sinceRev })
  }
  throw new Error(`scan did not finish: ${JSON.stringify(reply.json)}`)
}

/** 让出若干事件循环轮次。 */
export async function pump(ticks = 2): Promise<void> {
  for (let i = 0; i < ticks; i += 1) await new Promise<void>((resolve) => setTimeout(resolve, 0))
}

/** 确定性 gate（每个会话处理完停在这里，测试逐帧推进）。 */
export interface Gate {
  yield(): Promise<void>
  next(): Promise<void>
  step(): Promise<void>
}

export function createGate(): Gate {
  let release: (() => void) | undefined
  let arrive: (() => void) | undefined
  const gate: Gate = {
    yield(): Promise<void> {
      return new Promise<void>((resolve) => {
        release = resolve
        const signal = arrive
        arrive = undefined
        signal?.()
      })
    },
    next(): Promise<void> {
      if (release !== undefined) return Promise.resolve()
      return new Promise<void>((resolve) => {
        arrive = resolve
      })
    },
    async step(): Promise<void> {
      await gate.next()
      const run = release
      release = undefined
      if (run !== undefined) run()
      await new Promise<void>((resolve) => setTimeout(resolve, 1))
    },
  }
  return gate
}
