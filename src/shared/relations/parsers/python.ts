/**
 * Python 引用解析（04 §6.3.3）。
 *
 * 正例：`from .x import y` → 候选 `x.py` / `x/__init__.py`（相对当前文件所在目录）；
 * `from ..pkg.mod import name`（多级相对）；`import a.b` 与 `from a.b import c`（工作区根基准）。
 * 反例：`from __future__ import annotations`（`__future__` 不是工作区文件 → 未确认、不画边）、
 * `import os`（同样只会成为未确认候选）、`from . import`（语法错误 → 不解析）。
 *
 * 模块名 → 路径的映射只做**确定性的候选**，目标是否存在/是否被触碰由 `reference.ts` 判定。
 */

import { createCollector, createLineLocator, dedupeReferences } from './common.ts'
import { classifyRaw } from './types.ts'
import type { ReferenceParseOptions, ReferenceParseResult, ReferenceParser, RawReference } from './types.ts'

const EXTENSIONS = ['py'] as const

/** 把模块路径转成候选：`a.b` → `a/b.py` 与 `a/b/__init__.py`（prefix 是相对目录前缀，如 `../`）。 */
function moduleCandidates(prefix: string, module: string): string[] {
  const normalized = module.replace(/\./g, '/')
  return [`./${prefix}${normalized}.py`, `./${prefix}${normalized}/__init__.py`]
}

/** `import a, b as c` 里的模块名。 */
function splitImportNames(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .map((item) => item.split(/\s+as\s+/)[0].trim())
    .filter((item) => /^[A-Za-z_]\w*(\.[A-Za-z_]\w*)*$/.test(item))
}

export function parsePython(text: string, options?: ReferenceParseOptions): ReferenceParseResult {
  const collector = createCollector(options?.maxReferences)
  const lineAt = createLineLocator(text)
  const staged: RawReference[] = []
  let match: RegExpExecArray | null

  // 1) 相对导入：`from .x import y` / `from ..pkg.mod import name`
  const relativeFrom = /^[ \t]*from[ \t]+(\.+)([A-Za-z_][\w.]*)?[ \t]+import[ \t]+([^\n#]+)/gm
  while ((match = relativeFrom.exec(text)) !== null) {
    const dots = match[1]
    const module = match[2]
    const names = match[3]
    const prefix = '../'.repeat(Math.max(0, dots.length - 1))
    const line = lineAt(match.index)
    if (module !== undefined && module !== '') {
      staged.push(
        classifyRaw(`${dots}${module}`, 'py-from', line, {
          alternatives: moduleCandidates(prefix, module),
        }),
      )
      continue
    }
    for (const name of splitImportNames(names)) {
      staged.push(
        classifyRaw(`${dots}${name}`, 'py-from', line, {
          alternatives: moduleCandidates(prefix, name),
        }),
      )
    }
  }

  // 2) 绝对导入：`import a.b`（工作区根基准；是否真实存在由解析层判定）
  const absoluteImport = /^[ \t]*import[ \t]+([^\n#]+)/gm
  while ((match = absoluteImport.exec(text)) !== null) {
    const line = lineAt(match.index)
    for (const module of splitImportNames(match[1])) {
      staged.push(
        classifyRaw(module, 'py-import', line, {
          alternatives: moduleCandidates('', module),
          anchor: 'workspace-root',
        }),
      )
    }
  }

  // 3) 绝对 from 导入：`from a.b import c`
  const absoluteFrom = /^[ \t]*from[ \t]+([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)[ \t]+import\b/gm
  while ((match = absoluteFrom.exec(text)) !== null) {
    staged.push(
      classifyRaw(match[1], 'py-from', lineAt(match.index), {
        alternatives: moduleCandidates('', match[1]),
        anchor: 'workspace-root',
      }),
    )
  }

  if (staged.length === 0) {
    return { references: [], truncated: false, filtered: collector.filtered }
  }

  for (const reference of staged.sort((left, right) => left.line - right.line)) {
    if (!collector.push(reference)) break
  }

  const references = dedupeReferences(collector.references).sort((left, right) => {
    if (left.line !== right.line) return left.line - right.line
    return left.raw < right.raw ? -1 : left.raw > right.raw ? 1 : 0
  })
  return { references, truncated: collector.truncated, filtered: collector.filtered }
}

export const pythonParser: ReferenceParser = {
  extensions: EXTENSIONS,
  parse: parsePython,
}
