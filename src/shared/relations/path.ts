/**
 * 路径与引用目标的纯函数工具（04 §6.3.2）。无 IO、无平台 API。
 *
 * 身份键约定（04 §6.3.2 第 6 条）：
 * - 工作区相对路径一律用 **POSIX 分隔符**；
 * - 比较/去重键 = 小写（Windows 身份不区分大小写；跨平台统一小写以保证同一份数据在任意机器上
 *   去重结果一致），**展示保留原大小写**。
 *
 * 安全约定（N-07）：所有“工作区外”的判断都在这里做——绝对路径必须先落到 cwd 内，
 * 相对路径折叠 `..` 后越出 cwd 一律拒绝。服务端的 workspaceFiles **不做包含检查**，
 * 所以这是唯一防线（02 §3.6、evidence/01 K4）。
 */

/** 已知扩展名：只有这些扩展名的目标才可能成为引用候选（“无扩展名不猜”）。 */
export const KNOWN_EXTENSIONS: ReadonlySet<string> = new Set([
  // 文档
  'md',
  'markdown',
  'mdx',
  'txt',
  'rst',
  // 代码
  'ts',
  'tsx',
  'mts',
  'cts',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'py',
  'html',
  'htm',
  'css',
  'scss',
  'sass',
  'less',
  'vue',
  'svelte',
  'go',
  'rs',
  'java',
  'kt',
  'swift',
  'rb',
  'php',
  'c',
  'h',
  'cpp',
  'hpp',
  'cs',
  'sql',
  'sh',
  'ps1',
  // 配置 / 数据
  'json',
  'jsonc',
  'yaml',
  'yml',
  'toml',
  'csv',
  // 图片 / 二进制资源的扩展名（只用于“是引用”的判断，正文解析器不会读它们）
  'png',
  'jpg',
  'jpeg',
  'gif',
  'svg',
  'webp',
  'ico',
  'bmp',
  'pdf',
])

/** 引用目标的类别：只有 `path` 会进入解析；其余进“外部来源/忽略”清单，不画边。 */
export type TargetKind = 'path' | 'external' | 'anchor' | 'data'

export interface ClassifiedTarget {
  kind: TargetKind
  /** 原始字符串（未 decode、未去锚点），用于证据展示。 */
  raw: string
  /** 非 path 时给出判定依据（http/https/data/mailto/... ）。 */
  scheme?: string
}

const WINDOWS_DRIVE = /^[a-zA-Z]:\//
const SCHEME = /^([a-zA-Z][a-zA-Z0-9+.-]*):/

/** 反斜杠一律归一成 POSIX 分隔符。 */
export function toPosix(path: string): string {
  return path.replace(/\\/g, '/')
}

/** Windows 盘符路径或 UNC 路径。 */
export function hasWindowsDrive(path: string): boolean {
  const value = toPosix(path.trim())
  return WINDOWS_DRIVE.test(value) || value.startsWith('//')
}

/** 绝对路径判断：`/x`、`C:/x`、`\\server\x` 都算。 */
export function isAbsolutePath(path: string): boolean {
  const value = toPosix(path.trim())
  return value.startsWith('/') || WINDOWS_DRIVE.test(value) || value.startsWith('//')
}

/** 去掉结尾的分隔符（保留根 `/`）。 */
export function trimTrailingSlash(path: string): string {
  const value = toPosix(path)
  return value.length > 1 ? value.replace(/\/+$/, '') : value
}

export interface NormalizedRelative {
  /** 折叠 `.`/`..` 后的相对路径（POSIX，无前导 `./`）。 */
  path: string
  /** 折叠过程中是否越过了根（越界 = 逃出工作区或指向 cwd 之上）。 */
  escaped: boolean
}

/** 折叠相对路径里的 `.` / `..`；`escaped` 表示越过了根。 */
export function normalizeRelative(input: string): NormalizedRelative {
  const raw = toPosix(input.trim())
  const segments: string[] = []
  let escaped = false
  for (const segment of raw.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      if (segments.length === 0) {
        escaped = true
        continue
      }
      segments.pop()
      continue
    }
    segments.push(segment)
  }
  return { path: segments.join('/'), escaped }
}

/** 父目录（相对路径，根为 `''`）。 */
export function dirOf(path: string): string {
  const value = normalizeRelative(path).path
  const index = value.lastIndexOf('/')
  return index < 0 ? '' : value.slice(0, index)
}

/** 文件名。 */
export function baseOf(path: string): string {
  const value = normalizeRelative(path).path
  const index = value.lastIndexOf('/')
  return index < 0 ? value : value.slice(index + 1)
}

/** 小写扩展名；无扩展名返回 `''`。 */
export function extensionOf(path: string): string {
  const base = baseOf(path)
  const index = base.lastIndexOf('.')
  if (index <= 0 || index === base.length - 1) return ''
  return base.slice(index + 1).toLowerCase()
}

/** 是否已知扩展名（决定“能不能当引用候选”）。 */
export function isKnownExtension(extension: string): boolean {
  return KNOWN_EXTENSIONS.has(extension.toLowerCase())
}

/** 是否“看起来像带已知扩展名的路径”（结构化配置解析用，04 §6.3.3）。 */
export function looksLikeFilePath(value: string): boolean {
  const trimmed = value.trim()
  if (trimmed === '' || /\s/.test(trimmed)) return false
  if (classifyTarget(trimmed).kind !== 'path') return false
  return isKnownExtension(extensionOf(trimmed))
}

/** 以目录为基准拼接（相对路径折叠 `..`）。 */
export function joinRelative(base: string, relative: string): NormalizedRelative {
  const left = normalizeRelative(base).path
  if (isAbsolutePath(relative)) return { path: normalizeRelative(relative).path, escaped: true }
  const joined = left === '' ? relative : `${left}/${relative}`
  return normalizeRelative(joined)
}

/** 以「引用方文件所在目录」为基准解析目标（04 §6.3.2 第 4 条）。 */
export function resolveFromFile(fromFile: string, target: string): NormalizedRelative {
  return joinRelative(dirOf(fromFile), target)
}

/** 身份键：POSIX + 小写（04 §6.3.2 第 6 条）。 */
export function caseKey(path: string, caseInsensitive = true): string {
  const value = normalizeRelative(path).path
  return caseInsensitive ? value.toLowerCase() : value
}

/** 大小写归一化：只有 Windows 风格路径（盘符/UNC）才需要。 */
function needsCaseFold(path: string): boolean {
  return hasWindowsDrive(path) || /^[a-zA-Z]:/.test(toPosix(path))
}

/**
 * cwd 包含检查（04 §6.3.4）：`target` 必须在 `cwd` 目录之下（不含 cwd 本身）。
 * 大小写：任一方是 Windows 路径时按不区分大小写比较，且按分隔符边界匹配。
 */
export function containsPath(cwd: string, target: string, caseInsensitive?: boolean): boolean {
  const left = trimTrailingSlash(cwd)
  const right = trimTrailingSlash(target)
  if (left === '' || right === '') return false
  const fold = caseInsensitive ?? (needsCaseFold(left) || needsCaseFold(right))
  const a = fold ? toPosix(left).toLowerCase() : toPosix(left)
  const b = fold ? toPosix(right).toLowerCase() : toPosix(right)
  if (b === a) return false
  return b.startsWith(`${a}/`)
}

/**
 * 绝对路径 → 工作区相对路径；不在 cwd 内返回 `undefined`（绝对路径逃逸 = 未确认，N-07）。
 */
export function workspaceRelativeFromAbsolute(
  cwd: string,
  absolutePath: string,
  caseInsensitive?: boolean,
): string | undefined {
  if (!containsPath(cwd, absolutePath, caseInsensitive)) return undefined
  const left = trimTrailingSlash(cwd)
  const target = toPosix(absolutePath)
  const prefix = toPosix(left)
  // containsPath 已按分隔符边界确认过包含关系；两边长度相同，按长度切即可保留原大小写后缀。
  const relative = target.slice(prefix.length).replace(/^\/+/, '')
  const normalized = normalizeRelative(relative)
  if (normalized.path === '' || normalized.escaped) return undefined
  return normalized.path
}

/**
 * 引用目标分类（04 §6.3.2 第 2 条）。
 * `http(s)://`、`mailto:`、`data:`、`tel:`、`javascript:`、协议相对 `//` 一律不是 path；
 * `#anchor` 是页内锚点，也不进图。
 */
export function classifyTarget(raw: string): ClassifiedTarget {
  const value = raw.trim()
  if (value === '') return { kind: 'path', raw }
  if (value.startsWith('#')) return { kind: 'anchor', raw }
  if (value.startsWith('//')) return { kind: 'external', raw, scheme: '//' }
  const matched = SCHEME.exec(value)
  if (matched !== null && !WINDOWS_DRIVE.test(toPosix(value))) {
    const scheme = matched[1].toLowerCase()
    if (scheme === 'data') return { kind: 'data', raw, scheme }
    return { kind: 'external', raw, scheme }
  }
  return { kind: 'path', raw }
}

/** 去首尾空白 → 去掉 `#...` / `?...` → URL-decode（04 §6.3.2 第 1 条）。 */
export function decodeRefTarget(raw: string): string {
  let value = raw.trim()
  const hash = value.indexOf('#')
  if (hash >= 0) value = value.slice(0, hash)
  const query = value.indexOf('?')
  if (query >= 0) value = value.slice(0, query)
  try {
    value = decodeURIComponent(value)
  } catch {
    // 非法转义不致命：保留原文，交给解析结果判定。
  }
  return value.trim()
}
