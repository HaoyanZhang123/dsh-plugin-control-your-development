/**
 * 引用解析器的公共类型（04 §6.3.1 / §6.3.3）。
 *
 * 解析器是**纯函数**：输入文件正文（字符串），输出候选引用 + 行号 + 语法种类 + 类别。
 * 它们不做路径解析（不知道 cwd、不知道目标是否存在）：那是 `reference.ts` 的职责。
 */

import { classifyTarget } from '../path.ts'

/** 候选类别：只有 `path` 会进入解析；其余进“外部来源/忽略”清单，不画边。 */
export type ReferenceKind = 'path' | 'external' | 'anchor' | 'data'

/** 语法种类：只用于证据/调试展示，不参与判读。 */
export type ReferenceSyntax =
  | 'md-inline-link'
  | 'md-image'
  | 'md-definition'
  | 'md-wiki'
  | 'md-code'
  | 'html-attr'
  | 'css-import'
  | 'css-url'
  | 'js-import'
  | 'js-export'
  | 'js-require'
  | 'js-dynamic'
  | 'py-from'
  | 'py-import'
  | 'structured-string'

/** 解析出的一个候选引用。 */
export interface RawReference {
  /** 原始字符串（未 decode、未去锚点；证据里原样展示）。 */
  raw: string
  /** 1-based 行号（按 `\n` 计数，04 §6.3.3 末条）。 */
  line: number
  syntax: ReferenceSyntax
  kind: ReferenceKind
  /**
   * 候选路径的多个可能写法（按顺序尝试）。目前只有 Python 模块导入需要：
   * `from .x import y` → `['./x.py','./x/__init__.py']`。
   */
  alternatives?: readonly string[]
  /** 候选的解析基准：默认引用方文件所在目录；`workspace-root` 表示工作区根（Python 绝对导入）。 */
  anchor?: 'file-dir' | 'workspace-root'
}

export interface ReferenceParseOptions {
  /** 单文件最多保留的候选数（04 §6.3.1：200）。 */
  maxReferences?: number
}

export interface ReferenceParseResult {
  references: RawReference[]
  /** 是否因上限被截断（N-10：任何 cap 都要显式）。 */
  truncated: boolean
  /** 被语法规则挡掉的候选数（例如 JS 的非相对说明符、Python 的未知结构）——不是引用。 */
  filtered: number
}

/** 按扩展名分派的引用解析器。 */
export interface ReferenceParser {
  /** 负责的扩展名（小写，不含点）。 */
  readonly extensions: readonly string[]
  parse(text: string, options?: ReferenceParseOptions): ReferenceParseResult
}

/** 用统一规则把原始串分类（URL/锚点/data URI 的判定只在 `path.ts` 一处）。 */
export function classifyRaw(
  raw: string,
  syntax: ReferenceSyntax,
  line: number,
  extra?: Pick<RawReference, 'alternatives' | 'anchor'>,
): RawReference {
  const classified = classifyTarget(raw)
  return {
    raw: raw.trim(),
    line,
    syntax,
    kind: classified.kind,
    ...(extra?.alternatives === undefined ? {} : { alternatives: extra.alternatives }),
    ...(extra?.anchor === undefined ? {} : { anchor: extra.anchor }),
  }
}
