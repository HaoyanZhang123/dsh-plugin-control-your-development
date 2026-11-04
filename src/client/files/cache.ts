/**
 * 版本缓存（04 §6.3.1：“解析结果按 `path + stat.version` 缓存；写入事件导致 version 变化时失效”）。
 *
 * 只缓存**解析结果**，不缓存正文（04 §6.3.4）。键是工作区相对路径的身份键（大小写归一），
 * 值是 `{ version, value }`；`version` 不一致即视为失效（返回 `undefined`，不返回旧值）。
 */

import { caseKey } from '../../shared/relations/path.ts'

export interface VersionedEntry<T> {
  version: string
  value: T
}

export interface VersionCacheOptions {
  caseInsensitive?: boolean
  /** 条目上限（防内存无界；超出按插入顺序淘汰最旧）。 */
  maxEntries?: number
}

export const DEFAULT_VERSION_CACHE_ENTRIES = 512

export interface VersionCache<T> {
  get(path: string, version: string): T | undefined
  set(path: string, version: string, value: T): void
  invalidate(path: string): void
  clear(): void
  readonly size: number
}

export function createVersionCache<T>(options?: VersionCacheOptions): VersionCache<T> {
  const caseInsensitive = options?.caseInsensitive ?? true
  const maxEntries = options?.maxEntries ?? DEFAULT_VERSION_CACHE_ENTRIES
  const entries = new Map<string, VersionedEntry<T>>()

  const keyOf = (path: string): string => caseKey(path, caseInsensitive)

  return {
    get(path: string, version: string): T | undefined {
      const entry = entries.get(keyOf(path))
      if (entry === undefined) return undefined
      if (entry.version !== version) {
        entries.delete(keyOf(path))
        return undefined
      }
      return entry.value
    },
    set(path: string, version: string, value: T): void {
      const key = keyOf(path)
      entries.delete(key)
      entries.set(key, { version, value })
      while (entries.size > maxEntries) {
        const oldest = entries.keys().next()
        if (oldest.done === true) break
        entries.delete(oldest.value)
      }
    },
    invalidate(path: string): void {
      entries.delete(keyOf(path))
    },
    clear(): void {
      entries.clear()
    },
    get size(): number {
      return entries.size
    },
  }
}
