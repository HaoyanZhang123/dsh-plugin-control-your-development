/**
 * 结构关系（04 §6.1：client 侧，来自路径目录层级；无向；默认开）。
 *
 * 拓扑（避免 O(N²) 爆炸，同时保持“同目录/父子目录”的语义）：
 * 1. 每个目录选一个**锚点文件**：`ops` 最大者，平手按路径升序（确定性）；
 * 2. 同目录的其它文件连到本目录锚点 → `同属目录 {dir}`；
 * 3. 目录锚点连到**最近的有文件祖先目录**的锚点 → `{a} 在 {b} 的目录下`。
 *
 * 边数约 N + 目录数，且同一份数据永远得到同一批边；`type|from|to` 去重由 `graph.ts` 保证。
 */

import { structureEvidence } from './evidence.ts'
import { createEdge } from './graph.ts'
import { caseKey, dirOf } from './path.ts'
import type { GraphEdge, RelationFileNode } from './types.ts'

interface Anchor {
  path: string
  ops: number
}

/** 目录 → 锚点文件。 */
function pickAnchors(files: readonly RelationFileNode[]): Map<string, Anchor> {
  const byDir = new Map<string, Anchor[]>()
  const seen = new Set<string>()
  for (const file of files) {
    const key = caseKey(file.path)
    if (seen.has(key)) continue
    seen.add(key)
    const dir = dirOf(file.path)
    const list = byDir.get(dir) ?? []
    list.push({ path: file.path, ops: file.ops ?? 0 })
    byDir.set(dir, list)
  }
  const anchors = new Map<string, Anchor>()
  for (const [dir, list] of byDir) {
    const sorted = list.slice().sort((left, right) => {
      if (left.ops !== right.ops) return right.ops - left.ops
      return left.path < right.path ? -1 : left.path > right.path ? 1 : 0
    })
    anchors.set(dir, sorted[0])
  }
  return anchors
}

/** 最近的有锚点祖先目录（不含自身）。 */
function nearestAncestorDir(dir: string, anchors: ReadonlyMap<string, Anchor>): string | undefined {
  let current = dir
  while (current !== '') {
    current = dirOf(current)
    if (anchors.has(current)) return current
    if (current === '') return undefined
  }
  return undefined
}

/** 生成结构边（无向）。 */
export function buildStructureEdges(files: readonly RelationFileNode[]): GraphEdge[] {
  const anchors = pickAnchors(files)
  const edges: GraphEdge[] = []

  // 1) 同目录：其它文件 → 本目录锚点
  const seen = new Set<string>()
  const byDir = new Map<string, RelationFileNode[]>()
  for (const file of files) {
    const key = caseKey(file.path)
    if (seen.has(key)) continue
    seen.add(key)
    const dir = dirOf(file.path)
    const list = byDir.get(dir) ?? []
    list.push(file)
    byDir.set(dir, list)
  }

  const dirs = [...byDir.keys()].sort()
  for (const dir of dirs) {
    const anchor = anchors.get(dir)
    if (anchor === undefined) continue
    const list = (byDir.get(dir) ?? []).slice().sort((left, right) => (left.path < right.path ? -1 : 1))
    for (const file of list) {
      if (caseKey(file.path) === caseKey(anchor.path)) continue
      edges.push(
        createEdge({
          type: 'structure',
          from: file.path,
          to: anchor.path,
          evidence: structureEvidence({ dir, from: file.path, to: anchor.path }),
        }),
      )
    }
  }

  // 2) 跨层：目录锚点 → 最近祖先目录锚点
  for (const dir of dirs) {
    if (dir === '') continue
    const anchor = anchors.get(dir)
    if (anchor === undefined) continue
    const parentDir = nearestAncestorDir(dir, anchors)
    if (parentDir === undefined) continue
    const parentAnchor = anchors.get(parentDir)
    if (parentAnchor === undefined) continue
    edges.push(
      createEdge({
        type: 'structure',
        from: anchor.path,
        to: parentAnchor.path,
        evidence: structureEvidence({
          dir: parentDir,
          from: anchor.path,
          to: parentAnchor.path,
          nested: true,
        }),
      }),
    )
  }

  return edges
}
