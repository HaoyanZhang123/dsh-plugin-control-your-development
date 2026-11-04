/**
 * 与 `shared/events`（T03，契约 owner）的**单向适配层**。
 *
 * 直接对接的（不需要适配）：`FileNode`、`TurnFile`、`FileOp`、`FileFamily`、`SessionSummary`、
 * `FileTouch` 等按原样使用，定义在 `events`；`types.ts` 只做 alias，本文件不复写。
 *
 * 需要适配的（这里给出函数与原因）：
 * 1. `TurnDetail` → `RelationTurn`：`TurnDetail` 只有轮次号 `n`、**没有 `sessionId`**
 *    （detail 数据属于某个会话，会话 id 由调用方持有）。关系引擎的时序/同轮共现要跨会话，
 *    因此显式传入 `sessionId` 并改名成 `turn`。**不要求 events 增加字段**。
 * 2. `TurnFile.ops` 是**操作类型列表**（`FileOp[]`，最多 read/write/search 三项），不是次数。
 *    04 §4.4 的「每轮按 ops 取 top 12」需要的是活动量 → `operationCount()` 取列表长度，
 *    并列时用 `added+removed`（`turnFileActivity()`）作确定性次级排序键。
 *
 * 纪律：适配只在这里发生，生成器（coTurn/sequence/…）直接吃 events 类型。
 */

import type { FileOp, TurnDetail, TurnFile } from '../events/index.ts'
import type { RelationTurn } from './types.ts'

/** 轮次文件的操作量：events 用操作类型列表表达“发生过哪些类操作”，这里取条数。 */
export function operationCount(ops: readonly FileOp[] | undefined): number {
  return ops === undefined ? 0 : ops.length
}

/**
 * 轮次文件的活动量（top-k 排序键）。
 * `added` / `removed` 是 04 §3.4 的 `≈` 估算值，只用于**同一轮内**的确定性排序，
 * 不参与任何对外展示的计数（10 §2.4）。
 */
export function turnFileActivity(file: TurnFile): number {
  return operationCount(file.ops) * 10_000 + Math.min(9_999, file.added + file.removed)
}

/**
 * `TurnDetail` → `RelationTurn`（单向）。
 * 不复制 `files`：`detail.files` 本身就是按事件顺序排列的轮次文件（数组顺序 = 轮内先后）。
 */
export function turnFromDetail(detail: TurnDetail, sessionId: string): RelationTurn {
  return {
    sessionId,
    turn: detail.n,
    files: detail.files,
  }
}
