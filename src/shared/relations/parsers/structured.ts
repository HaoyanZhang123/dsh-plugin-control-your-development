/**
 * 结构化配置（JSON / YAML / TOML）共用的字符串扫描（04 §6.3.1：“形如路径的字符串值”）。
 *
 * 规则：只认**已知扩展名**且**看起来像路径**的字符串；无扩展名/版本号/包名不算引用（不猜）。
 * 外部 URL 仍然记录（进检查器“外部来源”），但不会画边。
 */

import { classifyTarget, looksLikeFilePath } from '../path.ts'
import { createCollector, createLineLocator, dedupeReferences } from './common.ts'
import { classifyRaw } from './types.ts'
import type { ReferenceParseOptions, ReferenceParseResult } from './types.ts'

export interface StructuredScanOptions extends ReferenceParseOptions {
  /** 是否同时扫描裸值（YAML/TOML 的 `key: ./a.md` 不需要引号）。JSON 不开。 */
  bare: boolean
  /** 引号种类：JSON 只认双引号；YAML/TOML 双/单都认。 */
  quotes: 'double' | 'both'
}

function unescape(value: string): string {
  return value.replace(/\\(["'\\/])/g, '$1')
}

export function scanStructuredText(text: string, options: StructuredScanOptions): ReferenceParseResult {
  const collector = createCollector(options.maxReferences)
  const lineAt = createLineLocator(text)
  const quoted = options.quotes === 'both'
    ? /"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'/g
    : /"((?:[^"\\]|\\.)*)"/g

  let match: RegExpExecArray | null
  while ((match = quoted.exec(text)) !== null) {
    const raw = unescape(match[1] ?? match[2] ?? '')
    const classified = classifyTarget(raw)
    if (classified.kind === 'path') {
      if (!looksLikeFilePath(raw)) {
        collector.filtered += 1
        continue
      }
      if (!collector.push(classifyRaw(raw, 'structured-string', lineAt(match.index)))) break
      continue
    }
    // 外部 URL / data URI / 锚点：显式记录，不画边。
    if (!collector.push(classifyRaw(raw, 'structured-string', lineAt(match.index)))) break
  }

  // 裸值：`path: ./docs/a.md`、`file = "./a.json"`、`- ./b.ts`
  if (options.bare) {
    const bareToken = /(?<![\w@"'.:/=-])(?:\.{0,2}\/)?[A-Za-z0-9_@~.$-][A-Za-z0-9_@~.$/-]*\.[A-Za-z][A-Za-z0-9]*/g
    while ((match = bareToken.exec(text)) !== null) {
      const raw = match[0]
      if (!looksLikeFilePath(raw)) {
        collector.filtered += 1
        continue
      }
      if (!collector.push(classifyRaw(raw, 'structured-string', lineAt(match.index)))) break
    }

    // 裸 URL（YAML/TOML 常见不加引号）：只进“外部来源”，不画边（03 §8.1）。
    const bareUrl = /\bhttps?:\/\/[^\s"'`<>()[\]]+/g
    while ((match = bareUrl.exec(text)) !== null) {
      if (!collector.push(classifyRaw(match[0], 'structured-string', lineAt(match.index)))) break
    }
  }

  const references = dedupeReferences(collector.references).sort((left, right) => {
    if (left.line !== right.line) return left.line - right.line
    return left.raw < right.raw ? -1 : left.raw > right.raw ? 1 : 0
  })
  return { references, truncated: collector.truncated, filtered: collector.filtered }
}
