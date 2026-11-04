/**
 * 按扩展名分派的引用解析器注册表（04 §6.3.1）。
 *
 * 未登记的扩展名 = 不解析（`unparsed`）：不猜、不报错。解析器只做语法层，
 * 路径解析与确认在 `../reference.ts`。
 */

import { cssParser } from './css.ts'
import { htmlParser } from './html.ts'
import { jsParser } from './js.ts'
import { jsonParser } from './json.ts'
import { markdownParser } from './markdown.ts'
import { pythonParser } from './python.ts'
import { tomlParser } from './toml.ts'
import type { ReferenceParseOptions, ReferenceParseResult, ReferenceParser } from './types.ts'
import { yamlParser } from './yaml.ts'
import { extensionOf } from '../path.ts'

/** 注册表顺序固定（同扩展名只登记一次；重复登记会让 parserFor 结果依赖导入顺序）。 */
export const REFERENCE_PARSERS: readonly ReferenceParser[] = [
  markdownParser,
  htmlParser,
  cssParser,
  jsParser,
  pythonParser,
  jsonParser,
  yamlParser,
  tomlParser,
]

const BY_EXTENSION: ReadonlyMap<string, ReferenceParser> = (() => {
  const table = new Map<string, ReferenceParser>()
  for (const parser of REFERENCE_PARSERS) {
    for (const extension of parser.extensions) {
      if (table.has(extension)) continue
      table.set(extension, parser)
    }
  }
  return table
})()

/** 某路径对应的解析器；没有则 `undefined`（调用方标 unparsed）。 */
export function parserFor(path: string): ReferenceParser | undefined {
  return BY_EXTENSION.get(extensionOf(path))
}

/** 是否支持解析该文件（用于“单次视图解析 ≤ 400 个文件”的排队筛选）。 */
export function canParse(path: string): boolean {
  return BY_EXTENSION.has(extensionOf(path))
}

/** 所有可解析扩展名（测试/检查器展示用，按注册顺序）。 */
export function supportedExtensions(): string[] {
  return [...BY_EXTENSION.keys()]
}

/** 一步到位：按扩展名选解析器并解析；返回 `undefined` 表示格式不解析。 */
export function parseFileReferences(
  path: string,
  text: string,
  options?: ReferenceParseOptions,
): ReferenceParseResult | undefined {
  const parser = parserFor(path)
  if (parser === undefined) return undefined
  return parser.parse(text, options)
}
