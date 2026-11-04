/**
 * CSS 引用解析（04 §6.3.3）：`@import` 与 `url(...)`。
 *
 * 正例：`@import "./base.css";`、`url(./a.png)`、`url("./b.woff2")`。
 * 反例：`url(data:image/png;base64,…)`（data）、`url(https://…)`（external）、`url(#mask)`（anchor）。
 */

import { createCollector, createLineLocator, dedupeReferences } from './common.ts'
import { classifyRaw } from './types.ts'
import type { ReferenceParseOptions, ReferenceParseResult, ReferenceParser, RawReference } from './types.ts'

const EXTENSIONS = ['css'] as const

export function parseCss(text: string, options?: ReferenceParseOptions): ReferenceParseResult {
  const collector = createCollector(options?.maxReferences)
  const lineAt = createLineLocator(text)
  const collected: RawReference[] = []
  let match: RegExpExecArray | null

  // 1) @import 规则（可能带 url() 括号）
  const importRule = /@import\s+(?:url\(\s*)?["']?([^"')\s;]+)/g
  while ((match = importRule.exec(text)) !== null) {
    const reference = classifyRaw(match[1], 'css-import', lineAt(match.index))
    collected.push(reference)
  }

  // 2) url(...)：与 @import 同一处命中的去重（同 line + 同 raw 视为同一条）
  const urlRule = /url\(\s*["']?([^"')]+?)["']?\s*\)/g
  while ((match = urlRule.exec(text)) !== null) {
    const line = lineAt(match.index)
    const raw = match[1].trim()
    const duplicate = collected.some((item) => item.line === line && item.raw === raw)
    if (duplicate) continue
    collected.push(classifyRaw(raw, 'css-url', line))
  }

  for (const reference of collected.sort((left, right) => left.line - right.line)) {
    if (!collector.push(reference)) break
  }

  const references = dedupeReferences(collector.references).sort((left, right) => {
    if (left.line !== right.line) return left.line - right.line
    return left.raw < right.raw ? -1 : left.raw > right.raw ? 1 : 0
  })
  return { references, truncated: collector.truncated, filtered: collector.filtered }
}

export const cssParser: ReferenceParser = {
  extensions: EXTENSIONS,
  parse: parseCss,
}
