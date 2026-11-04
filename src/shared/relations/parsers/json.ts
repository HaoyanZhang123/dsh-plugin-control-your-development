/**
 * JSON 引用解析（04 §6.3.1）：键值里的路径串，只认带已知扩展名的字符串值。
 *
 * 正例：`{"entry": "./src/index.ts"}`（字符串值是路径）。
 * 反例：`{"name": "lodash"}`（无扩展名）、`{"version": "1.0.0"}`（不是路径）、
 * `{"url": "https://…/a.md"}`（external，不画边）。
 */

import { scanStructuredText } from './structured.ts'
import type { ReferenceParseOptions, ReferenceParseResult, ReferenceParser } from './types.ts'

const EXTENSIONS = ['json', 'jsonc'] as const

export function parseJson(text: string, options?: ReferenceParseOptions): ReferenceParseResult {
  return scanStructuredText(text, { ...options, bare: false, quotes: 'double' })
}

export const jsonParser: ReferenceParser = {
  extensions: EXTENSIONS,
  parse: parseJson,
}
