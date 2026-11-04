/**
 * 引用关系：解析（parsers）→ 路径解析 → 目标确认 → 建边 / 未确认清单（04 §6.3）。
 *
 * 三条硬规则：
 * 1. **解析所得**才算引用；共现不是引用（10 §1）。
 * 2. 目标必须「在工作区 cwd 内」**且**「在已触碰文件集合里」才 `confirmed`；
 *    否则进 `unconfirmed[]`，**不画边**（04 §6.3.2 第 7/8 条、N-09）。
 * 3. 外部 URL / 锚点 / data URI 不画边：URL 进 `external[]`（检查器“外部来源”），
 *    锚点与 data 进 `ignored[]`（03 §9.3）。
 *
 * 两层入口：
 * - `resolveReferences(sources)`：拿到正文，自己按扩展名分派解析器（一句话路径）；
 * - `resolveParsedReferences(parsed)`：拿到**已解析的候选**，只做路径/确认/建边——
 *   `client/files` 的版本缓存命中时走这一层，避免重复解析整篇正文（04 §6.3.1 缓存要求）。
 */

import { referenceEvidence } from './evidence.ts'
import { createEdge } from './graph.ts'
import { parserFor } from './parsers/index.ts'
import type { RawReference } from './parsers/types.ts'
import {
  caseKey,
  classifyTarget,
  decodeRefTarget,
  dirOf,
  extensionOf,
  isAbsolutePath,
  isKnownExtension,
  joinRelative,
  workspaceRelativeFromAbsolute,
} from './path.ts'
import { DEFAULT_REFERENCE_LIMITS } from './types.ts'
import type { GraphEdge, ReferenceIgnoredReason, ReferenceSkipReason } from './types.ts'

/** 待解析的正文来源（由 workspaceFiles 适配层读出，04 §6.3.4）。 */
export interface ReferenceTextSource {
  /** 工作区相对 POSIX 路径（保留原大小写）。 */
  path: string
  text: string
}

/** 已解析的候选来源（解析器输出；`truncated` 表示该文件候选超过上限）。 */
export interface ParsedReferenceSource {
  path: string
  references: readonly RawReference[]
  truncated?: boolean
}

export interface ReferenceResolveOptions {
  /** 当前工作区根（绝对路径）；包含检查的唯一依据。 */
  cwd: string
  /** 已触碰文件集合（工作区相对路径）——图只画这些节点（10 §1）。 */
  touched: readonly string[]
  /** 存在性探测（通常包一层 `remote.workspaceFiles.stat`）；缺省时存在性记为未知。 */
  stat?: (workspacePath: string) => boolean | Promise<boolean>
  maxReferencesPerFile?: number
  maxFilesPerView?: number
  /** 无扩展名时是否尝试已知扩展名（04 §6.3.2 第 5 条）。默认 `false`：**无扩展名不猜**。 */
  extensionFallback?: boolean
  /** 身份键是否大小写不敏感（默认 true，见 `path.ts` 说明）。 */
  caseInsensitive?: boolean
}

export interface UnconfirmedReference {
  from: string
  raw: string
  /** 解析出的候选目标（工作区相对路径）。 */
  target: string
  line: number
  reason: ReferenceSkipReason
  /** `stat` 的结果；`undefined` = 没有 stat 通道，存在性未知。 */
  exists?: boolean
}

export interface ExternalReference {
  from: string
  raw: string
  line: number
}

export interface IgnoredReference {
  from: string
  raw: string
  line: number
  reason: ReferenceIgnoredReason
}

export interface ReferenceResolutionStats {
  files: number
  parsedFiles: number
  unparsedFiles: number
  deferredFiles: number
  references: number
  confirmed: number
  unconfirmed: number
  external: number
  ignored: number
  truncatedFiles: number
}

export interface ReferenceResolution {
  edges: GraphEdge[]
  unconfirmed: UnconfirmedReference[]
  external: ExternalReference[]
  ignored: IgnoredReference[]
  unparsed: string[]
  /** 超过单次视图文件上限而延后的文件（N-10，必须显式）。 */
  deferred: string[]
  stats: ReferenceResolutionStats
  truncated: boolean
}

/** 无扩展名时按 04 §6.3.2 第 5 条尝试的扩展名。 */
export const EXTENSION_CANDIDATES: readonly string[] = [
  'md',
  'markdown',
  'ts',
  'tsx',
  'js',
  'jsx',
  'json',
  'py',
  'html',
  'css',
]

type PathResolution =
  | { ok: true; path: string }
  | { ok: false; reason: ReferenceSkipReason }

/** 单个候选串 → 工作区相对路径（不做存在性判断）。 */
export function resolveCandidatePath(input: {
  candidate: string
  sourcePath: string
  anchor?: 'file-dir' | 'workspace-root'
  cwd: string
  caseInsensitive?: boolean
}): PathResolution {
  const decoded = decodeRefTarget(input.candidate)
  if (decoded === '') return { ok: false, reason: 'empty-target' }
  if (decoded.endsWith('/')) return { ok: false, reason: 'not-a-file' }

  if (isAbsolutePath(decoded)) {
    const relative = workspaceRelativeFromAbsolute(input.cwd, decoded, input.caseInsensitive)
    if (relative === undefined) return { ok: false, reason: 'outside-workspace' }
    return { ok: true, path: relative }
  }

  const base = input.anchor === 'workspace-root' ? '' : dirOf(input.sourcePath)
  const resolved = joinRelative(base, decoded)
  if (resolved.escaped) return { ok: false, reason: 'escape-cwd' }
  if (resolved.path === '') return { ok: false, reason: 'empty-target' }
  return { ok: true, path: resolved.path }
}

/** 无扩展名时的扩展名尝试（需要 stat 才能验证存在性）。 */
async function tryExtensions(path: string, options: ReferenceResolveOptions): Promise<string | undefined> {
  if (options.stat === undefined) return undefined
  const probes: string[] = []
  for (const extension of EXTENSION_CANDIDATES) probes.push(`${path}.${extension}`)
  for (const extension of EXTENSION_CANDIDATES) probes.push(`${path}/index.${extension}`)
  for (const probe of probes) {
    if (await options.stat(probe)) return probe
  }
  return undefined
}

interface ConfirmResult {
  status: 'confirmed' | 'unconfirmed'
  path: string
  reason?: ReferenceSkipReason
  exists?: boolean
}

/** 目标确认：在工作区内 + 在已触碰集合里（04 §6.3.2 第 7 条）。 */
async function confirmTarget(
  path: string,
  options: ReferenceResolveOptions,
  touchedKeys: ReadonlySet<string>,
  displayByKey: ReadonlyMap<string, string>,
): Promise<ConfirmResult> {
  const key = caseKey(path, options.caseInsensitive ?? true)
  if (touchedKeys.has(key)) {
    return { status: 'confirmed', path: displayByKey.get(key) ?? path }
  }
  const exists = options.stat === undefined ? undefined : await options.stat(path)
  if (exists === false) return { status: 'unconfirmed', path, reason: 'not-found', exists: false }
  return { status: 'unconfirmed', path, reason: 'not-touched', ...(exists === undefined ? {} : { exists }) }
}

type ReferenceOutcome =
  | { status: 'edge'; targetPath: string }
  | { status: 'unconfirmed'; targetPath: string; reason: ReferenceSkipReason; exists?: boolean }
  | { status: 'external'; raw: string }
  | { status: 'ignored'; raw: string; reason: ReferenceIgnoredReason }

async function resolveRawReference(
  reference: RawReference,
  sourcePath: string,
  options: ReferenceResolveOptions,
  touchedKeys: ReadonlySet<string>,
  displayByKey: ReadonlyMap<string, string>,
): Promise<ReferenceOutcome> {
  const classified = classifyTarget(reference.raw)
  if (classified.kind === 'external') return { status: 'external', raw: reference.raw }
  if (classified.kind === 'anchor') return { status: 'ignored', raw: reference.raw, reason: 'anchor' }
  if (classified.kind === 'data') return { status: 'ignored', raw: reference.raw, reason: 'data-uri' }

  const candidates = reference.alternatives !== undefined && reference.alternatives.length > 0
    ? reference.alternatives
    : [reference.raw]

  let firstFailure: PathResolution | undefined
  for (const candidate of candidates) {
    const resolved = resolveCandidatePath({
      candidate,
      sourcePath,
      anchor: reference.anchor,
      cwd: options.cwd,
      caseInsensitive: options.caseInsensitive,
    })
    if (!resolved.ok) {
      firstFailure ??= resolved
      continue
    }
    let path = resolved.path
    if (extensionOf(path) === '') {
      if (options.extensionFallback !== true) {
        firstFailure ??= { ok: false, reason: 'no-extension' }
        continue
      }
      const probed = await tryExtensions(path, options)
      if (probed === undefined) {
        firstFailure ??= { ok: false, reason: 'not-found' }
        continue
      }
      path = probed
    } else if (!isKnownExtension(extensionOf(path))) {
      firstFailure ??= { ok: false, reason: 'unknown-extension' }
      continue
    }
    const confirmed = await confirmTarget(path, options, touchedKeys, displayByKey)
    if (confirmed.status === 'confirmed') return { status: 'edge', targetPath: confirmed.path }
    return {
      status: 'unconfirmed',
      targetPath: confirmed.path,
      reason: confirmed.reason ?? 'not-touched',
      ...(confirmed.exists === undefined ? {} : { exists: confirmed.exists }),
    }
  }

  const reason = firstFailure !== undefined && !firstFailure.ok ? firstFailure.reason : 'empty-target'
  const targetPath = decodeRefTarget(candidates[0] ?? reference.raw).replace(/^\.\//, '')
  return { status: 'unconfirmed', targetPath, reason }
}

interface ResolutionExtras {
  unparsed?: readonly string[]
  deferred?: readonly string[]
  totalFiles?: number
}

/** 只做路径解析/确认/建边：输入是已解析的候选（版本缓存命中时走这里）。 */
export async function resolveParsedReferences(
  sources: readonly ParsedReferenceSource[],
  options: ReferenceResolveOptions,
  extras?: ResolutionExtras,
): Promise<ReferenceResolution> {
  const caseInsensitive = options.caseInsensitive ?? true
  const touchedKeys = new Set<string>(options.touched.map((path) => caseKey(path, caseInsensitive)))
  const displayByKey = new Map<string, string>()
  for (const path of options.touched) displayByKey.set(caseKey(path, caseInsensitive), path)

  const edges: GraphEdge[] = []
  const unconfirmed: UnconfirmedReference[] = []
  const external: ExternalReference[] = []
  const ignored: IgnoredReference[] = []
  const unparsed = extras?.unparsed === undefined ? [] : [...extras.unparsed]
  const deferred = extras?.deferred === undefined ? [] : [...extras.deferred]
  const stats: ReferenceResolutionStats = {
    files: extras?.totalFiles ?? sources.length + unparsed.length + deferred.length,
    parsedFiles: sources.length,
    unparsedFiles: unparsed.length,
    deferredFiles: deferred.length,
    references: 0,
    confirmed: 0,
    unconfirmed: 0,
    external: 0,
    ignored: 0,
    truncatedFiles: 0,
  }

  for (const source of sources) {
    if (source.truncated === true) stats.truncatedFiles += 1
    stats.references += source.references.length

    // 同一文件内同一目标只留一条边：行号取最小，权重 = 出现次数（04 §6.2“引用保留第一条”）。
    const perTarget = new Map<string, { line: number; raw: string; targetPath: string; count: number }>()
    const unconfirmedSeen = new Set<string>()

    for (const reference of source.references) {
      const outcome = await resolveRawReference(reference, source.path, options, touchedKeys, displayByKey)
      if (outcome.status === 'external') {
        external.push({ from: source.path, raw: outcome.raw, line: reference.line })
        stats.external += 1
        continue
      }
      if (outcome.status === 'ignored') {
        ignored.push({ from: source.path, raw: outcome.raw, line: reference.line, reason: outcome.reason })
        stats.ignored += 1
        continue
      }
      if (outcome.status === 'unconfirmed') {
        const key = `${reference.line}|${reference.raw}|${outcome.reason}`
        if (unconfirmedSeen.has(key)) continue
        unconfirmedSeen.add(key)
        unconfirmed.push({
          from: source.path,
          raw: reference.raw,
          target: outcome.targetPath,
          line: reference.line,
          reason: outcome.reason,
          ...(outcome.exists === undefined ? {} : { exists: outcome.exists }),
        })
        stats.unconfirmed += 1
        continue
      }
      const key = caseKey(outcome.targetPath, caseInsensitive)
      if (key === caseKey(source.path, caseInsensitive)) {
        ignored.push({ from: source.path, raw: reference.raw, line: reference.line, reason: 'self-reference' })
        stats.ignored += 1
        continue
      }
      const entry = perTarget.get(key)
      if (entry === undefined) {
        perTarget.set(key, {
          line: reference.line,
          raw: reference.raw,
          targetPath: outcome.targetPath,
          count: 1,
        })
      } else {
        entry.count += 1
        if (reference.line < entry.line) {
          entry.line = reference.line
          entry.raw = reference.raw
        }
      }
    }

    for (const entry of perTarget.values()) {
      edges.push(
        createEdge({
          type: 'reference',
          from: source.path,
          to: entry.targetPath,
          weight: entry.count,
          evidence: referenceEvidence({
            line: entry.line,
            raw: entry.raw,
            target: entry.targetPath,
            from: source.path,
            to: entry.targetPath,
          }),
        }),
      )
      stats.confirmed += 1
    }
  }

  return {
    edges,
    unconfirmed,
    external,
    ignored,
    unparsed,
    deferred,
    stats,
    truncated: stats.truncatedFiles > 0 || deferred.length > 0,
  }
}

/** 拿到正文后一步到位：按扩展名分派解析器 → 路径解析 → 确认 → 建边。 */
export async function resolveReferences(
  sources: readonly ReferenceTextSource[],
  options: ReferenceResolveOptions,
): Promise<ReferenceResolution> {
  const maxReferencesPerFile = options.maxReferencesPerFile ?? DEFAULT_REFERENCE_LIMITS.maxReferencesPerFile
  const maxFilesPerView = options.maxFilesPerView ?? DEFAULT_REFERENCE_LIMITS.maxFilesPerView
  const parsed: ParsedReferenceSource[] = []
  const unparsed: string[] = []
  const deferred: string[] = []

  for (const source of sources) {
    if (parsed.length >= maxFilesPerView) {
      deferred.push(source.path)
      continue
    }
    const parser = parserFor(source.path)
    if (parser === undefined) {
      unparsed.push(source.path)
      continue
    }
    const result = parser.parse(source.text, { maxReferences: maxReferencesPerFile })
    parsed.push({ path: source.path, references: result.references, truncated: result.truncated })
  }

  return resolveParsedReferences(parsed, options, { unparsed, deferred, totalFiles: sources.length })
}
