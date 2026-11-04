/*
 * state/referenceLayer.ts —— 引用层接线（D-06/D-07；03 §10 / 04 §6.3；06 A43-3 的"不伪造"）。
 *
 * 通道：客户端 `remote.workspaceFiles`（T01 K4）：
 *   stat(sessionId, path, signal) / read(sessionId, path, {offset, limit}, signal)
 * **服务端不做 cwd 包含检查** → 必须走 `tools/files` 的 reader（它自己做卡口与上限）。
 *
 * 能力探测优先，两条路径都显式：
 * - 拿到 `workspaceFiles`（且提供 stat/read）→ `ready`：reader → 引用源 → `resolveParsedReferences`
 *   → `edges` / `unconfirmed[]` / `external[]`；
 * - 拿不到 → `disabled`：**不返回 0 条**、不返回空数组冒充"没有引用"，UI 必须显示
 *   `state.unknown` 语义的"引用层不可观测"。
 *
 * 只读：不写文件、不写存储、不发外部网络；解析结果只在内存里。
 */
import type { ExternalReference, GraphEdge, UnconfirmedReference } from '../../shared/relations/index.ts'
import { resolveParsedReferences } from '../../shared/relations/index.ts'
import {
  createWorkspaceFilesReader,
  createWorkspaceReferenceSource,
  createVersionCache,
  type CachedFileReferences,
  type WorkspaceFilesFace,
} from '../files/index.ts'

/** 探测到的 remote 形状（只用我们要的两个方法）。 */
export interface RemoteFilesProbe {
  workspaceFiles?: {
    stat?: unknown
    read?: unknown
  }
}

/** 引用层状态。 */
export type ReferenceLayerStatus = 'ready' | 'disabled'

/** 不可用原因（进 UI 时只显示 `state.unknown`，原因只用于日志/测试）。 */
export type ReferenceLayerReason = 'no-remote' | 'no-workspace-files' | 'no-session' | 'no-cwd'

/** 一次解析的产物。 */
export interface ReferenceResolutionView {
  edges: GraphEdge[]
  unconfirmed: UnconfirmedReference[]
  external: ExternalReference[]
  /** 本次实际解析的文件数 / 延后的文件数（超上限时显式）。 */
  parsedFiles: number
  deferredFiles: number
  truncated: boolean
  /** 解析时使用的 touched 集合大小（只画这些节点）。 */
  touched: number
}

/** 引用层接口（tab 只读它；disabled 时 resolve 返回 null，不假装 0 条）。 */
export interface ReferenceLayer {
  readonly status: ReferenceLayerStatus
  readonly reason: ReferenceLayerReason | null
  /** 可用性的一句话（UI 用 state.unknown + 这个原因打日志，不写正文）。 */
  readonly observable: boolean
  /** 解析一次（touched = 已触碰文件的工作区相对路径）。disabled → null。 */
  resolve(touched: readonly string[]): Promise<ReferenceResolutionView | null>
  /** 释放（中止在途请求）。 */
  dispose(): void
}

/** 最多解析多少个文件（04 §6.3.1 maxFilesPerView；这里再压到 60 以免一次读太多）。 */
export const REFERENCE_PARSE_LIMIT = 60

/** 探测一个值是否是 `remote.workspaceFiles` 的可用面。 */
export function probeWorkspaceFiles(remote: unknown): WorkspaceFilesFace | null {
  if (remote === null || remote === undefined || typeof remote !== 'object') return null
  // 2026-11-04 真机实测：ownerProps 上的 `remote` 可能是 **Cordis Context 代理**，
  // 读 `remote.workspaceFiles` 属性会直接抛 `cannot get property "remote.workspaceFiles" without inject`
  // （Cordis 的 proxy getter 对未声明的服务名抛错）。异常从 useMemo 冒出 → 整个 tab 白屏。
  // 因此这里必须**只做受控的属性读取**：抛错就当"拿不到"，引用层显式 disabled，绝不冒泡。
  let files: unknown
  try {
    files = (remote as RemoteFilesProbe).workspaceFiles
  } catch {
    return null
  }
  if (files === null || files === undefined || typeof files !== 'object') return null
  const face = files as { stat?: unknown; read?: unknown }
  if (typeof face.stat !== 'function' || typeof face.read !== 'function') return null
  return files as unknown as WorkspaceFilesFace
}

/** disabled 层（不返回 0 条）。 */
function disabledLayer(reason: ReferenceLayerReason): ReferenceLayer {
  return {
    status: 'disabled',
    reason,
    observable: false,
    resolve: () => Promise.resolve(null),
    dispose: () => undefined,
  }
}

/**
 * 建立引用层。
 *
 * @param input.remote 宿主 `remote` 服务值（可为 undefined；由 index.ts 的 ctx.get('remote') 探测）
 * @param input.face 也可以直接注入 `workspaceFiles` 面（测试用）
 * @param input.sessionId 当前会话（reader 需要它）
 * @param input.cwd 会话 cwd（包含检查的唯一依据；空串 = 无法卡口 → disabled）
 */
export function createReferenceLayer(input: {
  remote?: unknown
  face?: WorkspaceFilesFace | null
  sessionId: string
  cwd: string
}): ReferenceLayer {
  const face = input.face ?? probeWorkspaceFiles(input.remote)
  if (face === null) return disabledLayer(input.remote === undefined ? 'no-remote' : 'no-workspace-files')
  if (typeof input.sessionId !== 'string' || input.sessionId === '') return disabledLayer('no-session')
  if (typeof input.cwd !== 'string' || input.cwd === '') return disabledLayer('no-cwd')

  const reader = createWorkspaceFilesReader({ files: face, sessionId: input.sessionId, cwd: input.cwd })
  const source = createWorkspaceReferenceSource({ reader, cache: createVersionCache<CachedFileReferences>() })
  let disposed = false
  let inflight: Promise<ReferenceResolutionView | null> | null = null

  const run = async (touched: readonly string[]): Promise<ReferenceResolutionView | null> => {
    if (disposed) return null
    const paths = touched.slice(0, REFERENCE_PARSE_LIMIT)
    const deferred = Math.max(0, touched.length - paths.length)
    const reports = await source.readMany(paths)
    if (disposed) return null
    const parsed = source.parsedSources(reports)
    const resolution = await resolveParsedReferences(parsed, {
      cwd: input.cwd,
      touched,
      stat: async (workspacePath: string) => {
        const result = await reader.statPath(workspacePath)
        return result.status === 'ok'
      },
    }, {
      totalFiles: touched.length,
      deferred: deferred > 0 ? paths.slice(-Math.min(deferred, 1)) : [],
    })
    if (disposed) return null
    return {
      edges: resolution.edges,
      unconfirmed: resolution.unconfirmed,
      external: resolution.external,
      parsedFiles: resolution.stats.parsedFiles,
      deferredFiles: deferred + resolution.deferred.length,
      truncated: resolution.truncated,
      touched: touched.length,
    }
  }

  return {
    status: 'ready',
    reason: null,
    observable: true,
    resolve(touched: readonly string[]): Promise<ReferenceResolutionView | null> {
      if (inflight !== null) return inflight
      inflight = run(touched).finally(() => {
        inflight = null
      })
      return inflight
    },
    dispose(): void {
      disposed = true
    },
  }
}

/** 测试/诊断：禁用层（无需任何宿主服务）。 */
export function disabledReferenceLayer(reason: ReferenceLayerReason = 'no-remote'): ReferenceLayer {
  return disabledLayer(reason)
}
