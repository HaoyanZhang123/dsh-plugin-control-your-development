/*
 * turns/status.ts —— 本轮文件状态（33 §4；纯函数，无 React）。
 *
 * 数据诚实（2026-11-05 核查：DSH 没有删除文件工具，也没有 delete 类事件）：
 * - 只允许「读 / 写 +行 / 写 −行 / 首见」四种文件级状态；
 * - `写行数` 是工具参数估算的 ≈（不是 git diff）；
 * - `首见` = FileNode.firstAt 落在 [turn.start, turn.end]；turn.end 缺失（运行中）→ 不标（不猜）；
 * - 「删除」只有命令级计数（`TurnDetail.deleteCommands`），不归属任何文件路径，
 *   本函数只把计数原样带进 summary（缺省 0 / 不可知）。
 */
import type { FileNode, TurnDetail } from '../../../shared/events/index.ts'

/** 单个文件在本轮的状态（只有这四个可证事实）。 */
export interface FileTurnStatus {
  /** 本轮 read/search 次数。 */
  read: number
  /** 本轮 write 的估算新增行数（≈）。 */
  writeAdd: number
  /** 本轮 write 的估算删除行数（≈）。 */
  writeDel: number
  /** 本轮是否首次记录到该文件；turn.end 未知（运行中）→ null（不可知，不冒充 false）。 */
  firstSeen: boolean | null
}

/** 本轮摘要（图上摘要条一行）。 */
export interface TurnStatusSummary {
  reads: number
  writeAdd: number
  writeDel: number
  /** 首见文件数；turn.end 未知（运行中）→ null（界面显示 —，不显示 0）。 */
  firstSeen: number | null
  /** 命令文本里识别到的删除动作条数；**不可知时为 null**（界面显示 —，不显示 0）。 */
  deleteCommands: number | null
}

export interface TurnStatusSnapshot {
  /** 命中本轮的文件路径 → 状态（只含 turn.files 里出现的文件）。 */
  byPath: Map<string, FileTurnStatus>
  summary: TurnStatusSummary
}

function caseKey(path: string): string {
  return path.toLowerCase()
}

function fileIndexOf(files: ReadonlyMap<string, FileNode> | readonly FileNode[]): Map<string, FileNode> {
  const index = new Map<string, FileNode>()
  if (!Array.isArray(files)) {
    for (const [key, file] of files as ReadonlyMap<string, FileNode>) {
      index.set(key, file)
      index.set(caseKey(file.path), file)
    }
    return index
  }
  for (const file of files as readonly FileNode[]) {
    index.set(file.path, file)
    index.set(caseKey(file.path), file)
  }
  return index
}

/** 本轮是否读取/搜索过（ops 是 FileOp[]，不是次数）。 */
function readCountOf(ops: readonly string[]): number {
  let count = 0
  for (const op of ops) if (op === 'read' || op === 'search') count += 1
  return count
}

/**
 * 计算一轮的文件状态与摘要。
 *
 * `turn.files` 由 host reducer 产出（已聚合）；这里不再造数据，只做归类与求和。
 */
export function turnFileStatusOf(
  turn: TurnDetail,
  files: ReadonlyMap<string, FileNode> | readonly FileNode[],
): TurnStatusSnapshot {
  const index = fileIndexOf(files)
  const byPath = new Map<string, FileTurnStatus>()
  let reads = 0
  let writeAdd = 0
  let writeDel = 0
  let firstSeen = 0
  const endKnown = typeof turn.end === 'number' && Number.isFinite(turn.end)

  for (const touch of turn.files) {
    const read = readCountOf(touch.ops)
    const wrote = touch.ops.includes('write')
    const add = wrote ? Math.max(0, touch.added) : 0
    const del = wrote ? Math.max(0, touch.removed) : 0
    const node = index.get(touch.path) ?? index.get(caseKey(touch.path))
    const first = endKnown && node !== undefined && node.firstAt >= turn.start && node.firstAt <= (turn.end as number) ? true : endKnown ? false : null
    byPath.set(touch.path, { read, writeAdd: add, writeDel: del, firstSeen: first })
    reads += read
    writeAdd += add
    writeDel += del
    if (first === true) firstSeen += 1
  }

  return {
    byPath,
    summary: {
      reads,
      writeAdd,
      writeDel,
      firstSeen: endKnown ? firstSeen : null,
      // 缺省 = 0 / 不可知（33 §4）；只有 host 明确给出 ≥1 时才不是 0。
      deleteCommands: typeof turn.deleteCommands === 'number' && Number.isFinite(turn.deleteCommands) ? Math.max(0, turn.deleteCommands) : null,
    },
  }
}
