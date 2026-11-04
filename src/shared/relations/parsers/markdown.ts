/**
 * Markdown 引用解析（04 §6.3.3）。
 *
 * 正例：inline link `[x](./y.md)`、image `![img](./a.png)`、reference definition `[n]: ./y.md`、
 * wiki `[[page]]`、行内 code 里的反引号路径 `` `./src/a.ts` ``。
 * 反例：`https://…`（external）、`#anchor`（anchor）、`mailto:`/`data:`（external/data）、
 * 无扩展名的 `[x](./foo)`（仍是候选，是否可解析交给 `reference.ts`：默认不猜）。
 *
 * 反引号路径只在**围栏代码块之外**才算引用：围栏块里的示例路径是文档内容，不是引用。
 */

import { looksLikeFilePath } from '../path.ts'
import {
  createCollector,
  createLineLocator,
  dedupeReferences,
  fencedRanges,
  inRanges,
} from './common.ts'
import { classifyRaw } from './types.ts'
import type { ReferenceParseOptions, ReferenceParseResult, ReferenceParser, ReferenceSyntax } from './types.ts'

const EXTENSIONS = ['md', 'markdown'] as const

export function parseMarkdown(
  text: string,
  options?: ReferenceParseOptions,
): ReferenceParseResult {
  const collector = createCollector(options?.maxReferences)
  const lineAt = createLineLocator(text)
  const fences = fencedRanges(text)

  const emit = (raw: string, syntax: ReferenceSyntax, index: number): boolean =>
    collector.push(classifyRaw(raw, syntax, lineAt(index)))

  // 1) inline link / image
  const inlineLink = /!?\[[^\]]*\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g
  let match: RegExpExecArray | null
  while ((match = inlineLink.exec(text)) !== null) {
    const syntax: ReferenceSyntax = match[0].startsWith('!') ? 'md-image' : 'md-inline-link'
    if (!emit(match[1], syntax, match.index)) {
      return collector.toResult()
    }
  }

  // 2) reference definition：`[label]: ./target`
  const definition = /^[ \t]*\[[^\]]+\]:[ \t]*(\S+)/gm
  while ((match = definition.exec(text)) !== null) {
    if (!emit(match[1], 'md-definition', match.index)) {
      return collector.toResult()
    }
  }

  // 3) wiki link：`[[page]]`（锚点/章节部分按规则剔除）
  const wiki = /\[\[([^\]|#]+)/g
  while ((match = wiki.exec(text)) !== null) {
    if (!emit(match[1], 'md-wiki', match.index)) {
      return collector.toResult()
    }
  }

  // 4) 行内 code 里的反引号路径（围栏块之外；必须带已知扩展名，不猜）
  const codeSpan = /`([^`\n]+)`/g
  while ((match = codeSpan.exec(text)) !== null) {
    if (inRanges(fences, match.index)) continue
    const candidate = match[1].trim()
    if (!looksLikeFilePath(candidate)) {
      collector.filtered += 1
      continue
    }
    if (!emit(candidate, 'md-code', match.index)) {
      return collector.toResult()
    }
  }

  const references = dedupeReferences(collector.references).sort((left, right) => {
    if (left.line !== right.line) return left.line - right.line
    return left.raw < right.raw ? -1 : left.raw > right.raw ? 1 : 0
  })
  return { references, truncated: collector.truncated, filtered: collector.filtered }
}

export const markdownParser: ReferenceParser = {
  extensions: EXTENSIONS,
  parse: parseMarkdown,
}
