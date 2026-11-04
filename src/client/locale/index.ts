/*
 * locale/index.ts —— 文案解析的单一实现。
 *
 * 规则：
 * - key 清单在 locale/keys.ts（类型级唯一来源）；zh/en 用 Record<MessageKey, string> 强制完备，
 *   缺任何 key 都会让 typecheck 直接红；
 * - 默认 locale 是 zh；切换只改调用方持有的 locale 值，不写 localStorage / cookie / sessionStorage；
 * - 占位符形如 {n} / {done} / {total} / {files} / {commands} / {subagents}；
 *   缺变量时保留原占位符（可被测试与肉眼发现），绝不静默替换成空串或 0。
 */
import { en } from './en.ts'
import { MESSAGE_KEYS, type MessageKey } from './keys.ts'
import { zh } from './zh.ts'

export type { MessageKey }
export { MESSAGE_KEYS }

/** 支持的 locale。新增语言必须同时加 values + 测试里的集合比对。 */
export type Locale = 'zh' | 'en'

/** 默认 locale（03 §16：中文为默认，英文为对等文案）。 */
export const DEFAULT_LOCALE: Locale = 'zh'

/** 全部 locale 数据表（键集合必须完全相等，见 tests/ui-shell/locale.test.ts）。 */
export const MESSAGES: Record<Locale, Record<MessageKey, string>> = { zh, en }

/** 占位符替换值：字符串或数字（数字按十进制输出）。 */
export type MessageVars = Record<string, string | number>

const PLACEHOLDER = /\{([a-zA-Z][a-zA-Z0-9_]*)\}/g

/** 运行时判定一个值是不是受支持的 locale（用于外部输入，不抛错）。 */
export function isLocale(value: unknown): value is Locale {
  return value === 'zh' || value === 'en'
}

/**
 * 把模板里的 {name} 换成 vars[name]。
 * 缺变量时原样保留占位符：宁可显示成 {n}，也不伪造数字。
 */
export function format(template: string, vars?: MessageVars): string {
  if (!vars) return template
  return template.replace(PLACEHOLDER, (whole, name: string) => {
    if (!Object.prototype.hasOwnProperty.call(vars, name)) return whole
    return String(vars[name])
  })
}

/** 取某个 locale 的原始模板（测试与调试用；业务请用 createTranslator / t）。 */
export function message(key: MessageKey, locale: Locale = DEFAULT_LOCALE): string {
  return MESSAGES[locale][key]
}

/**
 * 单次翻译：t('coverage.loading', { done: 42, total: 267 })
 * locale 省略时用默认 zh。
 */
export function t(key: MessageKey, vars?: MessageVars, locale: Locale = DEFAULT_LOCALE): string {
  return format(message(key, locale), vars)
}

/** 绑定 locale 的翻译器：T09/组件用它，避免每处都传 locale。 */
export function createTranslator(locale: Locale = DEFAULT_LOCALE): (key: MessageKey, vars?: MessageVars) => string {
  return (key, vars) => t(key, vars, locale)
}

/** 翻译器类型（组件 props 用）。 */
export type Translator = ReturnType<typeof createTranslator>
