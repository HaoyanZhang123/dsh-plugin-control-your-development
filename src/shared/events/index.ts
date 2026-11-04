/**
 * `src/shared/events` 的**唯一对外入口**。
 *
 * 下游（T04 客户端数据层 / T05 关系引擎 / T07 星图 / T08 检查器）只许从这里 import：
 *   import type { SessionSummary, TurnDetail, FileNode } from '<...>/shared/events/index.ts'
 * 不要深挖内部文件（types/limits/paths/reduce 是内部布局，会随实现调整）。
 *
 * 命名分工（Lead 集成裁决）：
 * - 这里的 `SnapshotCoTurnEdge` 是 host snapshot 的 **wire 层 coTurn 边**（04 §4.4）；
 * - 产品级统一边 `GraphEdge`（含 id/directed/confirmed/confidence）在 `src/shared/relations`，
 *   由 T05 的适配器把 wire 边转成产品级边；两者刻意不同名，避免 `export *` 冲突。
 */
export * from './types.ts'
export * from './limits.ts'
export * from './paths.ts'
export * from './reduce.ts'
