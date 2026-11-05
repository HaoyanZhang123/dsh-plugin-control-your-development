/*
 * rail/directories.ts —— 右侧目录卡片的**纯聚合**（33 §2/§4）。
 *
 * 沿用 T21 的聚合语义（全部 nodes、确定性排序、topFiles 前 3、5 族构成），
 * 但文件大类改成 33 §5 的 5 类，并且只服务右侧 rail（不再有"总览图"）。
 *
 * 纪律：纯函数、无 DOM/时间/随机数；同数据同结果；全部 nodes 参与（不受图 120 上限影响）。
 */
import type { FileFamily, FileNode } from '../../../shared/events/index.ts'
import { FILE_FAMILIES } from '../map/theme.ts'

/** 顶层目录键（根目录为 ''）。与图/卡片/检查器同口径。 */
export function directoryKeyOf(path: string): string {
  const slash = path.indexOf('/')
  if (slash <= 0) return ''
  return path.slice(0, slash)
}

/** 目录键 → 展示标签（根目录回落到 `/`；组件需要 locale 时用 rootLabel 覆盖）。 */
export function directoryLabelOf(key: string): string {
  return key === '' ? '/' : key
}

/** 卡片里的文件大类构成（顺序 = FILE_FAMILIES；0 也保留，渲染时跳过）。 */
export interface DirectoryFamily {
  family: FileFamily
  count: number
}

/** 卡片里的"最活跃文件"一行。 */
export interface DirectoryTopFile {
  path: string
  name: string
  family: FileFamily
  ops: number
}

/** 一张目录卡片（纯数据；渲染在 DirectoryRail.ts）。 */
export interface DirectoryCard {
  key: string
  label: string
  count: number
  totalOps: number
  families: DirectoryFamily[]
  topFiles: DirectoryTopFile[]
  lastAt: number
  /** 传入 currentTurnPaths 时：该目录里本轮触碰过的文件数。 */
  currentCount: number
}

export interface DirectoryCardsOptions {
  rootLabel?: string
  currentTurnPaths?: readonly string[] | null
  topFiles?: number
}

/** 每卡默认列出的最活跃文件数（33 §2：内容与现版本一致 = 前 3）。 */
export const DIRECTORY_TOP_FILES = 3

/** 最活跃文件排序：ops 降序 → lastAt 降序 → path 升序。 */
export function compareTopFiles(left: FileNode, right: FileNode): number {
  if (left.ops !== right.ops) return right.ops - left.ops
  if (left.lastAt !== right.lastAt) return right.lastAt - left.lastAt
  return left.path < right.path ? -1 : left.path > right.path ? 1 : 0
}

/** 卡片排序：totalOps 降序 → count 降序 → key 升序（确定性）。 */
export function compareDirectoryCards(left: DirectoryCard, right: DirectoryCard): number {
  if (left.totalOps !== right.totalOps) return right.totalOps - left.totalOps
  if (left.count !== right.count) return right.count - left.count
  return left.key < right.key ? -1 : left.key > right.key ? 1 : 0
}

function lowerSet(paths: readonly string[] | null | undefined): Set<string> | null {
  if (paths === null || paths === undefined) return null
  const set = new Set<string>()
  for (const path of paths) set.add(path.toLowerCase())
  return set
}

/** 把全部 nodes 聚合成目录卡片（按 totalOps → count → key 排序）。 */
export function buildDirectoryCards(nodes: readonly FileNode[], options: DirectoryCardsOptions = {}): DirectoryCard[] {
  const buckets = new Map<string, FileNode[]>()
  for (const node of nodes) {
    const key = directoryKeyOf(node.path)
    const bucket = buckets.get(key)
    if (bucket === undefined) buckets.set(key, [node])
    else bucket.push(node)
  }
  const currentKeys = lowerSet(options.currentTurnPaths)
  const topLimit = Math.max(0, Math.trunc(options.topFiles ?? DIRECTORY_TOP_FILES))
  const rootLabel = options.rootLabel ?? directoryLabelOf('')
  const familyIndex = new Map<FileFamily, number>()
  FILE_FAMILIES.forEach((family, index) => familyIndex.set(family, index))

  const cards: DirectoryCard[] = []
  for (const [key, files] of buckets) {
    const families: DirectoryFamily[] = FILE_FAMILIES.map((family) => ({ family, count: 0 }))
    let totalOps = 0
    let lastAt = 0
    let currentCount = 0
    for (const file of files) {
      totalOps += file.ops
      if (file.lastAt > lastAt) lastAt = file.lastAt
      const slot = familyIndex.get(file.family)
      if (slot !== undefined) families[slot].count += 1
      if (currentKeys !== null && currentKeys.has(file.path.toLowerCase())) currentCount += 1
    }
    const topFiles = files
      .slice()
      .sort(compareTopFiles)
      .slice(0, topLimit)
      .map((file) => ({ path: file.path, name: file.name, family: file.family, ops: file.ops }))
    cards.push({
      key,
      label: key === '' ? rootLabel : directoryLabelOf(key),
      count: files.length,
      totalOps,
      families,
      topFiles,
      lastAt,
      currentCount,
    })
  }
  cards.sort(compareDirectoryCards)
  return cards
}

/** 默认目录：**当前会话**里文件操作最多的目录（33 §4.1）；会话无文件时退回全工作区。 */
export function defaultDirectoryKey(
  nodes: readonly FileNode[],
  sessionId: string,
  options: DirectoryCardsOptions = {},
): string {
  const inSession = nodes.filter((node) => node.sessionIds.includes(sessionId))
  const pool = inSession.length === 0 ? nodes : inSession
  const cards = buildDirectoryCards(pool, options)
  return cards.length === 0 ? '' : cards[0].key
}

/** 卡片汇总（证据/调试用：证明确实全量参与）。 */
export function directoryCardsSummary(cards: readonly DirectoryCard[]): { dirs: number; files: number; ops: number; rootCount: number } {
  let files = 0
  let ops = 0
  let rootCount = 0
  for (const card of cards) {
    files += card.count
    ops += card.totalOps
    if (card.key === '') rootCount = card.count
  }
  return { dirs: cards.length, files, ops, rootCount }
}
