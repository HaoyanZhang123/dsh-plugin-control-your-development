/**
 * `src/client/files` 公共出口（T07 / T08 从这里 import，不直接摸内部文件）。
 *
 * 只读通道：`remote.workspaceFiles` 的注入式适配（02 §3.6、evidence/01 K4）。
 * - `createWorkspaceFilesReader({ files, sessionId, cwd })`：stat/分页 read + cwd 卡口 + 上限 + 显式状态；
 * - `createWorkspaceReferenceSource({ reader, cache })`：解析 + 按 version 失效的缓存；
 * - 引用边由 `shared/relations` 的 `resolveParsedReferences()` 生成（未确认目标不画边）。
 */

export type {
  FileReadFailure,
  FileReadResult,
  FileReadState,
  FileReadSuccess,
  PathRejectionReason,
  StatResult,
  WorkspaceDirectoryEntry,
  WorkspaceDirectoryListing,
  WorkspaceEntryType,
  WorkspaceFileLimits,
  WorkspaceFileStat,
  WorkspaceFilesFace,
  WorkspaceFileText,
  WorkspaceReadRange,
} from './types.ts'
export { DEFAULT_WORKSPACE_FILE_LIMITS } from './types.ts'

export { classifyReadError, createWorkspaceFilesReader, normalizeWorkspacePath } from './reader.ts'
export type { NormalizedWorkspacePath, WorkspaceFilesReader, WorkspaceFilesReaderOptions } from './reader.ts'

export { createVersionCache, DEFAULT_VERSION_CACHE_ENTRIES } from './cache.ts'
export type { VersionCache, VersionCacheOptions, VersionedEntry } from './cache.ts'

export { createWorkspaceReferenceSource } from './reference-source.ts'
export type {
  CachedFileReferences,
  ReferenceSourceReport,
  WorkspaceReferenceSource,
  WorkspaceReferenceSourceOptions,
} from './reference-source.ts'
