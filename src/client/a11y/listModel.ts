/*
 * a11y/listModel.ts —— 列表视图的**纯逻辑**（03 §4.3 / §15；06 A44-2）。
 *
 * 星图不是唯一入口：文件表 + 轮次表必须能键盘走、读屏读、可排序、可点亮对应节点。
 * 这里只做数据与键盘状态机（可在 node 里单测），渲染在 `ListTable.ts`。
 *
 * 单一实现：路径掩码走 `privacy`（再往下是 `ui/turns/privacy.ts`），不在这里判 mode 细节。
 */
import type { FileFamily, FileNode, ThreadlineStatus } from '../../shared/events/index.ts'
import { maskPathFor, type PrivacyMode } from '../privacy/index.ts'

/** 表格种类。 */
export type ListKind = 'files' | 'turns'

/** 文件表的一行（只元数据，不含正文；03 §12.1）。 */
export interface FileListRow {
  /** 身份键 = 小写路径（与星图节点的 key 同口径）。 */
  key: string
  /** 原始工作区相对路径。 */
  path: string
  /** 掩码后的展示路径（隐私模式只有 basename）。 */
  displayPath: string
  /** basename（总是可见，用于"点亮图上的节点"）。 */
  label: string
  family: FileFamily
  ops: number
  reads: number
  writes: number
  searches: number
  added: number
  removed: number
  firstAt: number | null
  lastAt: number | null
  sessionCount: number
  turnCount: number
}

/** 轮次表的一行（只元数据；正文/命令文本不在这里）。 */
export interface TurnListRow {
  /** `turn:<n>`。 */
  key: string
  turn: number
  label: string
  status: ThreadlineStatus
  files: number
  commands: number
  errors: number
  /** 时长未知时为 null（不伪造成 0）。 */
  durationMs: number | null
  sessionId: string
}

export type SortKey =
  | 'label'
  | 'ops'
  | 'firstAt'
  | 'lastAt'
  | 'turn'
  | 'status'
  | 'files'
  | 'commands'
  | 'errors'

export type SortDir = 'asc' | 'desc'

export interface SortState {
  key: SortKey
  dir: SortDir
}

/** 文件表默认排序：按操作数降序（最活跃在前，与星图节点大小同口径）。 */
export const DEFAULT_FILE_SORT: SortState = { key: 'ops', dir: 'desc' }

/** 轮次表默认排序：按轮次升序（时间顺序）。 */
export const DEFAULT_TURN_SORT: SortState = { key: 'turn', dir: 'asc' }

/** 哪些 key 是"数字/时间"型（切换时默认降序，符合"先看最大的"直觉）。 */
const NUMERIC_KEYS: readonly SortKey[] = ['ops', 'firstAt', 'lastAt', 'files', 'commands', 'errors']

/** 点同一个表头 = 翻转方向；换列 = 数字列降序、其它升序。 */
export function nextSort(current: SortState, key: SortKey): SortState {
  if (current.key === key) return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' }
  return { key, dir: NUMERIC_KEYS.includes(key) ? 'desc' : 'asc' }
}

/** 路径的身份键（与星图/关系层同口径：小写）。 */
export function fileKeyOf(path: string): string {
  return path.replaceAll('\\', '/').toLowerCase()
}

/** FileNode[] → 文件表行（顺序保持输入顺序；排序由 `sortFileRows` 做）。 */
export function buildFileRows(nodes: readonly FileNode[], mode: PrivacyMode): FileListRow[] {
  return nodes.map((node) => ({
    key: fileKeyOf(node.path),
    path: node.path,
    displayPath: maskPathFor(node.path, mode),
    label: node.name === '' ? node.path : node.name,
    family: node.family,
    ops: node.ops,
    reads: node.reads,
    writes: node.writes,
    searches: node.searches,
    added: node.added,
    removed: node.removed,
    firstAt: Number.isFinite(node.firstAt) && node.firstAt > 0 ? node.firstAt : null,
    lastAt: Number.isFinite(node.lastAt) && node.lastAt > 0 ? node.lastAt : null,
    sessionCount: node.sessionCount,
    turnCount: node.turnCount,
  }))
}

/** 轮次输入（来自 T08 的轮次模型/轮次带；这里只取元数据）。 */
export interface TurnInput {
  turn: number
  status: ThreadlineStatus
  files: number
  commands: number
  errors: number
  durationMs?: number | null
  sessionId?: string
}

export function buildTurnRows(turns: readonly TurnInput[]): TurnListRow[] {
  return turns.map((turn) => ({
    key: 'turn:' + String(turn.turn),
    turn: turn.turn,
    label: 'T' + String(turn.turn),
    status: turn.status,
    files: turn.files,
    commands: turn.commands,
    errors: turn.errors,
    durationMs:
      turn.durationMs === null || turn.durationMs === undefined || !Number.isFinite(turn.durationMs) || turn.durationMs < 0
        ? null
        : turn.durationMs,
    sessionId: turn.sessionId ?? '',
  }))
}

function compareValues(left: unknown, right: unknown): number {
  // null/未知一律排在后面（不伪造成 0 参与排序）
  if (left === null && right === null) return 0
  if (left === null) return 1
  if (right === null) return -1
  if (typeof left === 'number' && typeof right === 'number') return left - right
  return String(left) < String(right) ? -1 : String(left) > String(right) ? 1 : 0
}

function valueOf(row: FileListRow | TurnListRow, key: SortKey): unknown {
  // 两类行的字段不同：统一按"可能存在的字段"读，缺字段返回 null（未知排后面）
  const record = row as unknown as Record<string, unknown>
  const value = record[key]
  return value === undefined ? null : value
}
/** 稳定排序（同值保持原顺序；不修改入参）。 */
export function sortRows<T extends FileListRow | TurnListRow>(rows: readonly T[], sort: SortState): T[] {
  const indexed = rows.map((row, index) => ({ row, index }))
  const factor = sort.dir === 'asc' ? 1 : -1
  indexed.sort((left, right) => {
    const primary = compareValues(valueOf(left.row, sort.key), valueOf(right.row, sort.key)) * factor
    return primary !== 0 ? primary : left.index - right.index
  })
  return indexed.map((entry) => entry.row)
}

export function sortFileRows(rows: readonly FileListRow[], sort: SortState): FileListRow[] {
  return sortRows(rows, sort)
}

export function sortTurnRows(rows: readonly TurnListRow[], sort: SortState): TurnListRow[] {
  return sortRows(rows, sort)
}

/** 过滤（搜索框）：按 label + 掩码后路径匹配（大小写无关；隐私模式下不会命中被隐藏的目录）。 */
export function filterFileRows(rows: readonly FileListRow[], query: string): FileListRow[] {
  const needle = query.trim().toLowerCase()
  if (needle === '') return [...rows]
  return rows.filter((row) => row.label.toLowerCase().includes(needle) || row.displayPath.toLowerCase().includes(needle))
}

/* ------------------------------------------------------------------ *
 * 键盘状态机（纯函数；组件按返回结果移动焦点/触发动作）
 * ------------------------------------------------------------------ */

export type NavKey =
  | 'ArrowDown'
  | 'ArrowUp'
  | 'ArrowLeft'
  | 'ArrowRight'
  | 'Home'
  | 'End'
  | 'PageDown'
  | 'PageUp'
  | 'Enter'
  | ' '
  | 'Escape'

export interface NavInput {
  row: number
  col: number
  rowCount: number
  colCount: number
  key: string
  /** 每页跳多少行（PageUp/PageDown），默认 10。 */
  pageSize?: number
}

export interface NavResult {
  row: number
  col: number
  /** 这次按键是否被表格消费（true 时调用方应 preventDefault）。 */
  handled: boolean
  /** Enter / Space：激活当前行（选中 / 打开）。 */
  activate: boolean
  /** Escape：逐层退出（清选择）。 */
  escape: boolean
}

const clamp = (value: number, min: number, max: number): number => (value < min ? min : value > max ? max : value)

/**
 * 方向键移动：向上/向下改行、Home/End 到首尾、PageUp/PageDown 翻页、
 * Enter/Space 激活、Escape 退出。行列都做夹取（越界不跑飞，也不把焦点丢出表格）。
 */
export function listKeyNav(input: NavInput): NavResult {
  const rowCount = Math.max(0, input.rowCount)
  const colCount = Math.max(1, input.colCount)
  const pageSize = input.pageSize === undefined || input.pageSize <= 0 ? 10 : input.pageSize
  const base: NavResult = {
    row: clamp(input.row, 0, Math.max(0, rowCount - 1)),
    col: clamp(input.col, 0, colCount - 1),
    handled: false,
    activate: false,
    escape: false,
  }
  if (rowCount === 0) {
    return { ...base, handled: input.key === 'Escape', escape: input.key === 'Escape' }
  }
  switch (input.key) {
    case 'ArrowDown':
      return { ...base, row: clamp(base.row + 1, 0, rowCount - 1), handled: true }
    case 'ArrowUp':
      return { ...base, row: clamp(base.row - 1, 0, rowCount - 1), handled: true }
    case 'Home':
      return { ...base, row: 0, handled: true }
    case 'End':
      return { ...base, row: rowCount - 1, handled: true }
    case 'PageDown':
      return { ...base, row: clamp(base.row + pageSize, 0, rowCount - 1), handled: true }
    case 'PageUp':
      return { ...base, row: clamp(base.row - pageSize, 0, rowCount - 1), handled: true }
    case 'ArrowRight':
      return { ...base, col: clamp(base.col + 1, 0, colCount - 1), handled: true }
    case 'ArrowLeft':
      return { ...base, col: clamp(base.col - 1, 0, colCount - 1), handled: true }
    case 'Enter':
    case ' ':
      return { ...base, handled: true, activate: true }
    case 'Escape':
      return { ...base, handled: true, escape: true }
    default:
      return base
  }
}

/** 行的 DOM id（焦点管理用；同一页面里唯一）。 */
export function rowDomId(prefix: string, key: string): string {
  const safe = key.replace(/[^a-zA-Z0-9_-]/g, '-')
  return 'threadline-' + prefix + '-row-' + safe
}
