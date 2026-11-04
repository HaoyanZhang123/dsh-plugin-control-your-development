/**
 * 解析器公用件：行号定位、围栏代码块范围、带上限的候选收集器。
 * 无 IO，纯函数。
 */

import { DEFAULT_REFERENCE_LIMITS } from '../types.ts'
import type { RawReference, ReferenceParseResult } from './types.ts'

/** 单文件候选上限（04 §6.3.1）。 */
export const DEFAULT_MAX_REFERENCES = DEFAULT_REFERENCE_LIMITS.maxReferencesPerFile

/** 行号定位器：先建换行偏移，再二分查（1-based）。 */
export function createLineLocator(text: string): (index: number) => number {
  const starts: number[] = [0]
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 10) starts.push(index + 1)
  }
  return (index: number): number => {
    let low = 0
    let high = starts.length - 1
    while (low < high) {
      const mid = (low + high + 1) >> 1
      if (starts[mid] <= index) low = mid
      else high = mid - 1
    }
    return low + 1
  }
}

/** 围栏代码块（``` 或 ~~~）的 [start, end) 区间，用于跳过“代码里的路径”噪声。 */
export function fencedRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = []
  const fence = /^[ \t]*(`{3,}|~{3,})/gm
  let open: { start: number; marker: string } | undefined
  let match: RegExpExecArray | null
  while ((match = fence.exec(text)) !== null) {
    const marker = match[1]
    if (open === undefined) {
      open = { start: match.index, marker: marker[0] }
      continue
    }
    if (marker[0] !== open.marker) continue
    ranges.push([open.start, match.index + marker.length])
    open = undefined
  }
  if (open !== undefined) ranges.push([open.start, text.length])
  return ranges
}

/** 是否落在任一区间内。 */
export function inRanges(ranges: ReadonlyArray<readonly [number, number]>, index: number): boolean {
  for (const [start, end] of ranges) {
    if (index >= start && index < end) return true
  }
  return false
}

/** 带上限的收集器：超过上限就停，`truncated` 必须显式上报（N-10）。 */
export interface ReferenceCollector {
  readonly references: RawReference[]
  readonly truncated: boolean
  filtered: number
  /** 返回 false 表示已达上限，调用方应停止扫描。 */
  push(reference: RawReference): boolean
  toResult(): ReferenceParseResult
}

export function createCollector(maxReferences: number = DEFAULT_MAX_REFERENCES): ReferenceCollector {
  const references: RawReference[] = []
  let truncated = false
  let filtered = 0
  return {
    references,
    get truncated(): boolean {
      return truncated
    },
    get filtered(): number {
      return filtered
    },
    set filtered(value: number) {
      filtered = value
    },
    push(reference: RawReference): boolean {
      if (references.length >= maxReferences) {
        truncated = true
        return false
      }
      references.push(reference)
      return true
    },
    toResult(): ReferenceParseResult {
      return { references: references.slice(), truncated, filtered }
    },
  }
}

/** 去重：同一行同一 raw 只保留一条（多个正则可能命中同一处，例如 @import url(...)）。 */
export function dedupeReferences(references: readonly RawReference[]): RawReference[] {
  const seen = new Set<string>()
  const result: RawReference[] = []
  for (const reference of references) {
    const key = `${reference.line}|${reference.syntax}|${reference.raw}|${reference.kind}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(reference)
  }
  return result
}
