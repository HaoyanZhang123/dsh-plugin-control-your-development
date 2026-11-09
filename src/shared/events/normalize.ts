/*
 * events/normalize.ts —— **边界归一化**（parse, don't validate）。
 *
 * 背景（2026-11-09 真机事故）：
 * 客户端把 DSH 的会话行**原样透传**给 host，而 TypeScript 的可选类型在运行时是擦掉的 ——
 * 一个 `title: null` 就让 host 判定 `invalid title`，整条 `/scan` 请求 400，
 * 左图永远停在「正在加载文件关系…」。153 个会话的工作区踩中概率远高于小工作区。
 *
 * 这不只是「null 没判」的问题，而是**策略**问题：
 *   - 一行**装饰性**元数据不合规，不该让整个扫描失败；
 *   - 客户端也不该在运行时相信宿主给的形状。
 *
 * 因此这里做「解析」而不是「校验」：输入当 `unknown`，只取认识的字段、
 * 按运行时类型收口、不认识的一律丢弃；**无法忠实表示的整行**才跳过并记账。
 *
 * 记账必须可见（不静默遗漏）：调用方拿到 `skipped` 后要计数上报。
 */

import type { ScanSessionInput } from './types.ts'

/** 一行被跳过的原因（稳定枚举；只用于计数与提示，不含路径/正文）。 */
export type ScanSkipReason = 'not-object' | 'invalid-id' | 'duplicate' | 'invalid-updatedAt'

/** 被跳过的一行（`id` 尽力给出，读不到就是 null）。 */
export interface ScanSessionSkip {
  id: string | null
  reason: ScanSkipReason
}

export interface NormalizedScanSessions {
  sessions: ScanSessionInput[]
  skipped: ScanSessionSkip[]
}

/**
 * 会话 id 的合法形态。
 *
 * 与 host 校验**同一份规则**（单一事实源）：只允许 `A-Za-z0-9._:-`，长度 1–200，
 * 且 `.` / `..` 无业务含义（不能进任何路径拼接位置）。
 */
export const SESSION_ID_RE = /^[A-Za-z0-9._:-]{1,200}$/

/** 是否是可用作会话标识的字符串。 */
export function isSessionId(value: unknown): value is string {
  return typeof value === 'string' && SESSION_ID_RE.test(value) && value !== '.' && value !== '..'
}

/** 只保留「非空字符串」；`null` / 数字 / 对象 / 空串一律视为**缺省**。 */
function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

/**
 * 把未知输入解析成**已知良好**的会话数组。
 *
 * 规则：
 * - 非数组 → 空结果 + 一条跳过记录（调用方负责把它当作结构错误处理）；
 * - `id` 非法 → 跳过该行（无法标识）；
 * - `updatedAt` 非有限非负 → 跳过该行（**不伪造时间**：编一个 0 会让它在时间轴上排错位置）；
 * - 同 id 重复 → 保留首条，后续跳过；
 * - `running` 只认 `true`（其余视为 false，沿用既有语义）；
 * - `parentId` / `title` / `origin` 只有**非空字符串**才带上；
 * - `archived` 只有 `true` 才带上；
 * - 其它未知字段一律丢弃（宿主加字段时前向兼容）。
 */
export function normalizeScanSessions(input: unknown): NormalizedScanSessions {
  const sessions: ScanSessionInput[] = []
  const skipped: ScanSessionSkip[] = []
  if (!Array.isArray(input)) {
    skipped.push({ id: null, reason: 'not-object' })
    return { sessions, skipped }
  }

  const seen = new Set<string>()
  for (const entry of input) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      skipped.push({ id: null, reason: 'not-object' })
      continue
    }
    const row = entry as Record<string, unknown>
    const id = row.id
    if (!isSessionId(id)) {
      skipped.push({ id: typeof id === 'string' ? id.slice(0, 200) : null, reason: 'invalid-id' })
      continue
    }
    if (seen.has(id)) {
      skipped.push({ id, reason: 'duplicate' })
      continue
    }
    const updatedAt = row.updatedAt
    if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt) || updatedAt < 0) {
      skipped.push({ id, reason: 'invalid-updatedAt' })
      continue
    }
    seen.add(id)

    const session: ScanSessionInput = {
      id,
      updatedAt,
      running: row.running === true,
    }
    const parentId = optionalText(row.parentId)
    if (parentId !== undefined) session.parentId = parentId
    const title = optionalText(row.title)
    if (title !== undefined) session.title = title
    const origin = optionalText(row.origin)
    if (origin !== undefined) session.origin = origin
    if (row.archived === true) session.archived = true
    sessions.push(session)
  }

  return { sessions, skipped }
}

export interface NormalizedRefresh {
  ids: string[]
  dropped: number
}

/**
 * `refresh` 是**优化提示**（哪些会话要重读），不是数据本身。
 * 非法或不在本次会话集合里的 id 一律丢弃并计数，**绝不因此拒绝整条请求**。
 */
export function normalizeRefreshIds(input: unknown, validIds: ReadonlySet<string>): NormalizedRefresh {
  if (!Array.isArray(input)) return { ids: [], dropped: 0 }
  const ids: string[] = []
  const seen = new Set<string>()
  let dropped = 0
  for (const entry of input) {
    if (!isSessionId(entry) || !validIds.has(entry) || seen.has(entry)) {
      dropped += 1
      continue
    }
    seen.add(entry)
    ids.push(entry)
  }
  return { ids, dropped }
}

/** 把跳过记录按原因汇总成计数（用于上报与提示；不含 id，避免泄露）。 */
export function summarizeSkips(skipped: readonly ScanSessionSkip[]): Record<ScanSkipReason, number> {
  const counts: Record<ScanSkipReason, number> = {
    'not-object': 0,
    'invalid-id': 0,
    duplicate: 0,
    'invalid-updatedAt': 0,
  }
  for (const item of skipped) counts[item.reason] += 1
  return counts
}
