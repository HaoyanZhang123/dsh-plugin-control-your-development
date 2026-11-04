/**
 * YAML 引用解析（04 §6.3.1，与 JSON 同策略 + 裸值）。
 *
 * 正例：`entry: ./src/index.ts`、`- ./docs/a.md`。
 * 反例：`version: 1.0.0`、`name: lodash`、`url: https://…/a.md`（external，不画边）。
 */

import { scanStructuredText } from './structured.ts'
import type { ReferenceParseOptions, ReferenceParseResult, ReferenceParser } from './types.ts'

const EXTENSIONS = ['yaml', 'yml'] as const

export function parseYaml(text: string, options?: ReferenceParseOptions): ReferenceParseResult {
  return scanStructuredText(text, { ...options, bare: true, quotes: 'both' })
}

export const yamlParser: ReferenceParser = {
  extensions: EXTENSIONS,
  parse: parseYaml,
}
