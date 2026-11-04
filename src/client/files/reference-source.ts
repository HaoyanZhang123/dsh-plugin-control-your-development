/**
 * 引用来源：读正文 → 按扩展名解析 → 按 `version` 缓存解析结果 → 交给关系引擎确认。
 *
 * 分工：
 * - 本文件只管“取正文 + 解析 + 缓存 + 状态”，不做路径确认（那是 `shared/relations/reference.ts`）；
 * - `resolveParsedReferences()` 用这里产出的候选建边，缓存命中时**不重读正文**（04 §6.3.1）；
 * - 不支持的格式（扩展名没有解析器）返回 `unsupported`，**不读文件**（04 §6.3.1“其它不解析”）。
 */

import { canParse, parseFileReferences } from '../../shared/relations/parsers/index.ts'
import type { RawReference } from '../../shared/relations/parsers/types.ts'
import type { ParsedReferenceSource } from '../../shared/relations/reference.ts'
import type { VersionCache } from './cache.ts'
import type { WorkspaceFilesReader } from './reader.ts'
import type { FileReadState } from './types.ts'

export interface ReferenceSourceReport {
  path: string
  /** `ok` = 已解析（可能 0 条候选）；`unsupported` = 扩展名不解析；`failed` = 读取/解析失败。 */
  status: 'ok' | 'unsupported' | 'failed'
  state?: FileReadState
  reason?: string
  version?: string
  references: readonly RawReference[]
  truncated: boolean
  filtered: number
  /** 是否命中版本缓存（命中 = 没有重读正文）。 */
  cached: boolean
}

export interface WorkspaceReferenceSourceOptions {
  reader: WorkspaceFilesReader
  cache?: VersionCache<CachedFileReferences>
  maxReferencesPerFile?: number
}

export interface CachedFileReferences {
  references: readonly RawReference[]
  truncated: boolean
  filtered: number
}

export interface WorkspaceReferenceSource {
  read(path: string): Promise<ReferenceSourceReport>
  readMany(paths: readonly string[]): Promise<ReferenceSourceReport[]>
  /** 把 `ok` 的报告转成关系引擎的输入（丢掉缓存/状态字段）。 */
  parsedSources(reports: readonly ReferenceSourceReport[]): ParsedReferenceSource[]
}

function emptyReport(path: string): ReferenceSourceReport {
  return { path, status: 'unsupported', references: [], truncated: false, filtered: 0, cached: false }
}

export function createWorkspaceReferenceSource(
  options: WorkspaceReferenceSourceOptions,
): WorkspaceReferenceSource {
  const { reader, cache } = options

  async function read(path: string): Promise<ReferenceSourceReport> {
    if (!canParse(path)) return emptyReport(path)

    // 先 stat（便宜）再看缓存：命中时**不读正文**（04 §6.3.1 的缓存要求）。
    const statResult = await reader.statPath(path)
    if (statResult.status !== 'ok') {
      return {
        path,
        status: 'failed',
        state: statResult.state,
        reason: statResult.reason,
        references: [],
        truncated: false,
        filtered: 0,
        cached: false,
      }
    }

    const cachedValue = cache?.get(statResult.path, statResult.version)
    if (cachedValue !== undefined) {
      return {
        path: statResult.path,
        status: 'ok',
        version: statResult.version,
        references: cachedValue.references,
        truncated: cachedValue.truncated,
        filtered: cachedValue.filtered,
        cached: true,
      }
    }

    const textResult = await reader.readText(path)
    if (textResult.status === 'failed') {
      return {
        path,
        status: 'failed',
        state: textResult.state,
        reason: textResult.reason,
        references: [],
        truncated: false,
        filtered: 0,
        cached: false,
      }
    }

    const parsed = parseFileReferences(textResult.path, textResult.text, {
      maxReferences: options.maxReferencesPerFile,
    })
    if (parsed === undefined) return { ...emptyReport(textResult.path), version: textResult.version }
    cache?.set(textResult.path, textResult.version, {
      references: parsed.references,
      truncated: parsed.truncated,
      filtered: parsed.filtered,
    })
    return {
      path: textResult.path,
      status: 'ok',
      version: textResult.version,
      references: parsed.references,
      truncated: parsed.truncated,
      filtered: parsed.filtered,
      cached: false,
    }
  }

  async function readMany(paths: readonly string[]): Promise<ReferenceSourceReport[]> {
    const reports: ReferenceSourceReport[] = []
    for (const path of paths) reports.push(await read(path))
    return reports
  }

  function parsedSources(reports: readonly ReferenceSourceReport[]): ParsedReferenceSource[] {
    return reports
      .filter((report) => report.status === 'ok')
      .map((report) => ({
        path: report.path,
        references: report.references,
        truncated: report.truncated,
      }))
  }

  return { read, readMany, parsedSources }
}
