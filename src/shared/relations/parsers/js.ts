/**
 * JavaScript / TypeScript 引用解析（04 §6.3.3）。
 *
 * 正例：`import x from './a.ts'`、`export { x } from './b.ts'`、`require('./c.json')`、
 * 动态 `import('./d.ts')`。
 * 反例：`import React from 'react'`（非相对说明符，不解析 alias/tsconfig paths，计入 filtered）、
 * `import x from 'https://…'`（external，不画边）、`import(name)`（变量，无法静态解析）。
 *
 * 只解析 `.` 开头的相对路径（04 §6.3.1）。
 */

import { createCollector, createLineLocator, dedupeReferences } from './common.ts'
import { classifyRaw } from './types.ts'
import type { ReferenceParseOptions, ReferenceParseResult, ReferenceParser, ReferenceSyntax } from './types.ts'

const EXTENSIONS = ['js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'mts', 'cts'] as const

/** 说明符是否相对（`./` / `../`）。其余一律不猜（alias、包名、绝对路径）。 */
function isRelativeSpecifier(raw: string): boolean {
  return raw.startsWith('./') || raw.startsWith('../')
}

export function parseJs(text: string, options?: ReferenceParseOptions): ReferenceParseResult {
  const collector = createCollector(options?.maxReferences)
  const lineAt = createLineLocator(text)

  const emit = (raw: string, syntax: ReferenceSyntax, index: number): boolean => {
    const reference = classifyRaw(raw, syntax, lineAt(index))
    if (reference.kind !== 'path') {
      // URL / data / 锚点：保留（外部来源要进检查器），但不是引用。
      return collector.push(reference)
    }
    if (!isRelativeSpecifier(raw)) {
      collector.filtered += 1
      return true
    }
    return collector.push(reference)
  }

  let match: RegExpExecArray | null

  // 1) static import / re-export：`import x from './a'`、`export * from './b'`
  const staticImport = /(?:^|[\s;{}()])(import|export)\s+(?:[^'"]*?\s+from\s+)?["']([^"']+)["']/g
  while ((match = staticImport.exec(text)) !== null) {
    const syntax: ReferenceSyntax = match[1] === 'export' ? 'js-export' : 'js-import'
    if (!emit(match[2], syntax, match.index + match[0].indexOf(match[2]))) return collector.toResult()
  }

  // 2) require('./x')
  const requireCall = /\brequire\(\s*["']([^"']+)["']\s*\)/g
  while ((match = requireCall.exec(text)) !== null) {
    if (!emit(match[1], 'js-require', match.index + match[0].indexOf(match[1]))) return collector.toResult()
  }

  // 3) 动态 import('./x')（静态字符串才可解析；变量形式不匹配）
  const dynamicImport = /\bimport\(\s*["']([^"']+)["']\s*\)/g
  while ((match = dynamicImport.exec(text)) !== null) {
    if (!emit(match[1], 'js-dynamic', match.index + match[0].indexOf(match[1]))) return collector.toResult()
  }

  const references = dedupeReferences(collector.references).sort((left, right) => {
    if (left.line !== right.line) return left.line - right.line
    return left.raw < right.raw ? -1 : left.raw > right.raw ? 1 : 0
  })
  return { references, truncated: collector.truncated, filtered: collector.filtered }
}

export const jsParser: ReferenceParser = {
  extensions: EXTENSIONS,
  parse: parseJs,
}
