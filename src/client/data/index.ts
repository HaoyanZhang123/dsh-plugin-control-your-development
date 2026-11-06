/**
 * T04 · 客户端数据层统一出口。
 *
 * 下游（T07 星图 / T08 检查器 / T09 入口集成）**只 import 这里**，不深挖内部文件：
 *
 * ```ts
 * import {
 *   buildWorkspaceScope, withoutArchived, refocusScope, toScanSessions,
 *   createDataController, createDetailStore, useThreadlineData, useThreadlineDetail,
 *   useWorkspaceScope, degradeForCoverage, degradeForError, DATA_ROUTES,
 * } from '<plugin>/src/client/data/index.ts'
 * import type { WorkspaceScope, WorkspaceGraph, Coverage, DegradeState, DetailEntry } from ...
 * ```
 *
 * 协议类型（`SessionSummary` / `FileNode` / `ScanError` / …）仍从
 * `src/shared/events/index.ts` 取，这里不重复导出，避免第二事实源。
 */

export * from './http.ts'
export * from './scope.ts'
export * from './merge.ts'
export * from './degrade.ts'
export * from './controller.ts'
export * from './warmup.ts'
export * from './detail.ts'
export * from './detailView.ts'
export * from './hooks.ts'
