/*
 * privacy/masks.ts —— T10 隐私**策略层**（03 §12；06 A44-1 / N-14）。
 *
 * 为什么这里不是"再实现一遍掩码"：
 * 纯字符串掩码的**唯一实现**已经在 `ui/turns/privacy.ts`（T08 交付，`ui/turns/index.ts` 导出），
 * 检查器与轮次带都用它。本文件只做两件它们没做的事：
 *   1. 把散落的原语收成**一套 T10 策略 API**（mode 驱动、幂等、空值不崩）；
 *   2. 补 T10 特有、UI 组件不需要的：命令策略对象、`redactForLog`（只允许错误码与计数）、
 *      正文入口闸门 `shouldRenderContent`。
 * 不复制 baseName/dirName/maskPath/urlHost 等任何一行 —— 改规则只改 `ui/turns/privacy.ts`。
 *
 * 纪律：
 * - 只读：不读不写任何存储（localStorage / sessionStorage / cookie 一个都不碰）；
 * - 不打印正文/路径/命令/标题（`redactForLog` 是唯一允许落日志的形状）；
 * - 掩码是**幂等**的：对已经掩码过的值再掩一次，结果不变。
 */
import type { CommandRecord } from '../../shared/events/index.ts'
import type { Translator } from '../locale/index.ts'
import { commandProgram, commandSummary, externalLabel, maskPath, sessionTitle, shortSessionId, urlHost } from '../ui/turns/index.ts'

/** 隐私模式（03 §12.2）：`metadata` = 默认（只露元数据，正文入口折叠）；`hidden` = 隐私模式。 */
export type PrivacyMode = 'metadata' | 'hidden'

/** 默认模式：元数据（03 §12.1：正文默认隐藏，点击展开）。 */
export const DEFAULT_PRIVACY_MODE: PrivacyMode = 'metadata'

/** 是否处于隐私模式（隐藏正文/路径目录/命令参数/会话标题）。 */
export function isHidden(mode: PrivacyMode): boolean {
  return mode === 'hidden'
}

/* ------------------------------------------------------------------ *
 * 1. 路径
 * ------------------------------------------------------------------ */

/** 展示用路径：隐私模式只留 basename；元数据模式保留工作区相对路径。 */
export function maskPathFor(path: string, mode: PrivacyMode): string {
  return maskPath(path, isHidden(mode))
}

/**
 * 路径掩码的幂等性守卫：输入已经是 basename 时原样返回。
 * （`maskPath` 本身对 basename 幂等；这里显式说明并给出可断言的入口。）
 */
export function maskPathOnce(path: string, mode: PrivacyMode): string {
  return maskPathFor(path, mode)
}

/** 列表/表格用：批量掩码，保持顺序、丢空值、不改原数组。 */
export function maskPaths(paths: readonly string[], mode: PrivacyMode): string[] {
  return paths.map((path) => maskPathFor(path, mode))
}

/* ------------------------------------------------------------------ *
 * 2. 命令
 * ------------------------------------------------------------------ */

/** 命令的展示形状：程序名永远可见；参数文本是否可见由 mode 决定。 */
export interface MaskedCommand {
  /** 程序名（取不到时 `?`，与 04 §3.5 一致）。 */
  program: string
  /** 元数据模式下可折叠展开的命令文本；隐私模式下恒为 null。 */
  text: string | null
}

/** 命令掩码：隐私模式只留程序名（03 §12.2「命令只显示程序名，隐藏参数」）。 */
export function maskCommand(record: CommandRecord | null | undefined, mode: PrivacyMode): MaskedCommand {
  if (record === null || record === undefined) return { program: '?', text: null }
  return {
    program: commandProgram(record),
    text: isHidden(mode) ? null : commandSummary(record, false),
  }
}

/* ------------------------------------------------------------------ *
 * 3. 会话标题
 * ------------------------------------------------------------------ */

/**
 * 会话展示名：隐私模式下按**当前视图顺序**编号 `会话 N`（N 由调用方给，从 1 开始）。
 * 编号由视图决定（03 §12.2），所以本函数**不接受数组下标以外的东西**，也不用标题散列。
 */
export function maskTitle(
  input: { sessionId: string; title?: string } | null | undefined,
  index: number,
  mode: PrivacyMode,
  t: Translator,
): string {
  if (input === null || input === undefined) {
    return isHidden(mode) ? t('inspector.session') + ' ' + String(index + 1) : '—'
  }
  return sessionTitle(input, index, isHidden(mode), t)
}

/** 会话短 id（前 8 位）——只在元数据模式展示；隐私模式返回 null。 */
export function sessionLabel(input: { sessionId: string; title?: string }, mode: PrivacyMode): string | null {
  return isHidden(mode) ? null : shortSessionId(input.sessionId)
}

/* ------------------------------------------------------------------ *
 * 4. 外部 URL
 * ------------------------------------------------------------------ */

/** 外部来源掩码：隐私模式只显示域名（03 §12.2），解析失败原样返回不猜。 */
export function maskUrl(raw: string, mode: PrivacyMode): string {
  return externalLabel(raw, isHidden(mode))
}

/** 纯域名（不判断模式；给"只显示域名"的固定场景用）。 */
export { urlHost }

/* ------------------------------------------------------------------ *
 * 5. 正文闸门
 * ------------------------------------------------------------------ */

/**
 * 正文入口是否渲染：隐私模式下**一律不渲染**；元数据模式下默认折叠，
 * 只有用户主动展开（`expanded === true`）才允许渲染。
 * 组件的职责是 `shouldRenderContent(mode, expanded) ? 渲染 : 只渲染入口`。
 */
export function shouldRenderContent(mode: PrivacyMode, expanded: boolean): boolean {
  return !isHidden(mode) && expanded === true
}

/** 隐私模式下的整体闸门（例如检查器区块、弹窗正文区）。 */
export function contentEntryVisible(mode: PrivacyMode): boolean {
  return !isHidden(mode)
}

/* ------------------------------------------------------------------ *
 * 6. 日志脱敏
 * ------------------------------------------------------------------ */

/** 允许落日志的形状：只有错误码与计数（03 §12.3：不打印任何正文/路径，只打印错误码与计数）。 */
export interface LogRecord {
  code: string
  count: number
}

const SAFE_CODE = /^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/

/**
 * 把任意值压成 `{ code, count }`。
 * - 只认 `code` / `errorCode` / `name` 这类**错误码**字段（必须匹配安全字符集）；
 * - 计数只认有限的非负整数；
 * - 其余全部丢掉（正文、路径、命令、标题、URL 一律不落日志）。
 */
export function redactForLog(value: unknown): LogRecord {
  if (value === null || value === undefined) return { code: 'unknown', count: 0 }
  if (typeof value === 'string') return { code: SAFE_CODE.test(value) ? value : 'redacted', count: 0 }
  if (typeof value === 'number') return { code: 'count', count: Number.isFinite(value) && value >= 0 ? Math.round(value) : 0 }
  if (typeof value !== 'object') return { code: 'redacted', count: 0 }

  const record = value as Record<string, unknown>
  const candidate =
    typeof record.code === 'string'
      ? record.code
      : typeof record.errorCode === 'string'
        ? record.errorCode
        : typeof record.kind === 'string'
          ? record.kind
          : ''
  const code = SAFE_CODE.test(candidate) ? candidate : 'redacted'
  const countRaw = typeof record.count === 'number' ? record.count : typeof record.failed === 'number' ? record.failed : 0
  const count = Number.isFinite(countRaw) && countRaw >= 0 ? Math.round(countRaw) : 0
  return { code, count }
}

/** 一批事件 → 脱敏计数（只输出 `code × n`，不输出内容）。 */
export function redactBatch(values: readonly unknown[]): LogRecord[] {
  const counts = new Map<string, number>()
  for (const value of values) {
    const record = redactForLog(value)
    counts.set(record.code, (counts.get(record.code) ?? 0) + 1)
  }
  return [...counts.entries()].map(([code, count]) => ({ code, count }))
}
