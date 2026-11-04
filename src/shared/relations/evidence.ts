/**
 * 关系证据文案（03 §9.3 统一模板）。
 *
 * **单一事实源**：每条边的 `evidence.text` 只能由本文件的构造器生成，UI/检查器只渲染不造句。
 * 四套模板（逐字对齐 03 §9.3）：
 *
 * | 关系 | 证据文本 |
 * |---|---|
 * | 结构 | `同属目录 {dir}` / `{a} 在 {b} 的目录下` |
 * | 共现 | `在 {sessionShort} 的 T{n} 中同时出现 {k} 次` |
 * | 时序 | `同一轮内：{a} 先于 {b}` |
 * | 引用 | `{a} 第 {line} 行引用 {b}` / `解析所得，目标未确认` |
 * | 会话共现 | `同一会话中一起出现`（弱关系，默认不画） |
 *
 * `{a}` / `{b}` 用**工作区相对路径**（不是 basename）：同名文件分布在两个目录时，
 * basename 会造出无法对账的句子；检查器本来也显示相对路径（03 §8.1）。
 */

import type {
  ReferenceIgnoredReason,
  ReferenceSkipReason,
  RelationEvidence,
  TurnSample,
} from './types.ts'

/** 会话短 id 长度：证据里只放前 8 位，避免把完整 id 塞进一句话（03 §9.3 的 `{sessionShort}`）。 */
export const SESSION_SHORT_LENGTH = 8

/** 会话短 id（确定性截断；不引入随机/省略号）。 */
export function shortSessionId(sessionId: string): string {
  return sessionId.length <= SESSION_SHORT_LENGTH ? sessionId : sessionId.slice(0, SESSION_SHORT_LENGTH)
}

/** 目录展示名：根目录显示为 `/`（`同属目录 /` 比空串可读）。 */
export function displayDir(dir: string): string {
  return dir === '' ? '/' : dir
}

/** 结构边：同目录 `同属目录 {dir}`；跨层 `{a} 在 {b} 的目录下`（03 §9.3）。 */
export function structureEvidence(input: {
  dir: string
  from: string
  to: string
  nested?: boolean
}): RelationEvidence {
  const text = input.nested === true
    ? `${input.from} 在 ${input.to} 的目录下`
    : `同属目录 ${displayDir(input.dir)}`
  return { kind: 'structure', dir: input.dir, text }
}

/** 同轮共现：`在 {sessionShort} 的 T{n} 中同时出现 {k} 次`。样本按给定的最新样本造句。 */
export function coTurnEvidence(input: { samples: readonly TurnSample[]; count: number }): RelationEvidence {
  const samples = input.samples.slice()
  const latest = samples.length > 0 ? samples[samples.length - 1] : undefined
  const sessionShort = latest === undefined ? '—' : shortSessionId(latest.sessionId)
  const turn = latest === undefined ? 0 : latest.turn
  return {
    kind: 'coTurn',
    samples,
    count: input.count,
    text: `在 ${sessionShort} 的 T${turn} 中同时出现 ${input.count} 次`,
  }
}

/** 同会话共现：`同一会话中一起出现`（弱关系，默认不画，03 §10）。 */
export function coSessionEvidence(sessionIds: readonly string[]): RelationEvidence {
  return { kind: 'coSession', sessionIds: sessionIds.slice(), text: '同一会话中一起出现' }
}

/** 时序：`同一轮内：{a} 先于 {b}`；`order` 是 **1-based 的轮内序号**（A30-2 的“有号”）。 */
export function sequenceEvidence(input: {
  sessionId: string
  turn: number
  order: number
  from: string
  to: string
}): RelationEvidence {
  return {
    kind: 'sequence',
    sessionId: input.sessionId,
    turn: input.turn,
    order: input.order,
    text: `同一轮内：${input.from} 先于 ${input.to}`,
  }
}

/** 引用：`{a} 第 {line} 行引用 {b}`（行号 1-based，来自解析位置）。 */
export function referenceEvidence(input: {
  line: number
  raw: string
  target: string
  from: string
  to: string
}): RelationEvidence {
  return {
    kind: 'reference',
    line: input.line,
    raw: input.raw,
    target: input.target,
    resolved: true,
    text: `${input.from} 第 ${input.line} 行引用 ${input.to}`,
  }
}

/** 未确认引用的统一后缀句（03 §9.3）。 */
export const UNCONFIRMED_REFERENCE_TEXT = '解析所得，目标未确认'

/** 未确认引用的原因文案（03 §8.1：文件不存在/不可读/不在已触碰集合）。 */
export const REFERENCE_SKIP_LABELS: Readonly<Record<ReferenceSkipReason, string>> = {
  'outside-workspace': '工作区外',
  'escape-cwd': '路径穿越出工作区',
  'no-extension': '无扩展名，未猜测',
  'unknown-extension': '未知扩展名，不解析',
  'empty-target': '空目标',
  'not-found': '文件不存在',
  'not-touched': '目标未被任何会话触碰',
  'not-a-file': '目标是目录或路径不完整',
}

/** 被忽略候选的原因文案（不画边，也不进“未确认”清单）。 */
export const REFERENCE_IGNORED_LABELS: Readonly<Record<ReferenceIgnoredReason, string>> = {
  anchor: '页内锚点',
  'external-url': '外部 URL',
  'data-uri': '内联 data URI',
  'bare-specifier': '非相对模块说明符',
  'self-reference': '指向自身的引用',
}

/** 未确认引用的一句话（检查器直接用）：`第 3 行 ./x.md：解析所得，目标未确认（文件不存在）`。 */
export function describeUnconfirmedReference(input: {
  line: number
  raw: string
  reason: ReferenceSkipReason
}): string {
  return `第 ${input.line} 行 ${input.raw}：${UNCONFIRMED_REFERENCE_TEXT}（${REFERENCE_SKIP_LABELS[input.reason]}）`
}
