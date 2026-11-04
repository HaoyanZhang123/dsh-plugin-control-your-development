/**
 * TOML 引用解析（04 §6.3.1，与 JSON 同策略 + 裸值）。
 *
 * 正例：`entry = "./src/index.ts"`、`include = ["./a.md", "./b.md"]`。
 * 反例：`version = "1.0.0"`、`name = "lodash"`、`homepage = "https://…"`（external，不画边）。
 */

import { scanStructuredText } from './structured.ts'
import type { ReferenceParseOptions, ReferenceParseResult, ReferenceParser } from './types.ts'

const EXTENSIONS = ['toml'] as const

export function parseToml(text: string, options?: ReferenceParseOptions): ReferenceParseResult {
  return scanStructuredText(text, { ...options, bare: true, quotes: 'both' })
}

export const tomlParser: ReferenceParser = {
  extensions: EXTENSIONS,
  parse: parseToml,
}
