/**
 * HTML 引用解析（04 §6.3.3）：`href` / `src` 属性。
 *
 * 正例：`<link href="./a.css">`、`<img src="./img.png">`。
 * 反例：`href="https://…"`（external）、`href="#top"`（anchor）、`href="mailto:…"`、
 * `src="data:image/png;base64,…"`——都不画边。
 */

import { createCollector, createLineLocator, dedupeReferences } from './common.ts'
import { classifyRaw } from './types.ts'
import type { ReferenceParseOptions, ReferenceParseResult, ReferenceParser } from './types.ts'

const EXTENSIONS = ['html', 'htm'] as const

/** 属性前面要求是空白/引号/尖括号，避免 `data-href` 这类前缀误命中。 */
const ATTRIBUTE = /(?:^|[\s"'<])(?:href|src)\s*=\s*["']([^"']+)["']/gm

export function parseHtml(text: string, options?: ReferenceParseOptions): ReferenceParseResult {
  const collector = createCollector(options?.maxReferences)
  const lineAt = createLineLocator(text)
  let match: RegExpExecArray | null
  const attribute = new RegExp(ATTRIBUTE.source, 'gm')
  while ((match = attribute.exec(text)) !== null) {
    const index = match.index + match[0].indexOf(match[1])
    if (!collector.push(classifyRaw(match[1], 'html-attr', lineAt(index)))) break
  }
  const references = dedupeReferences(collector.references).sort((left, right) => {
    if (left.line !== right.line) return left.line - right.line
    return left.raw < right.raw ? -1 : left.raw > right.raw ? 1 : 0
  })
  return { references, truncated: collector.truncated, filtered: collector.filtered }
}

export const htmlParser: ReferenceParser = {
  extensions: EXTENSIONS,
  parse: parseHtml,
}
