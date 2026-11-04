/**
 * 路径归一化与包含检查（04 §3.4 规则 3、06 N-07）。
 *
 * 只用字符串运算：**不读文件系统、不解析符号链接**（host 只读会话日志）。
 * 规则：
 * - 绝对路径必须在 `cwd` 下 → 转工作区相对 POSIX 路径；
 * - 相对路径以 `cwd` 为基准；
 * - `..` 越出 cwd → 丢弃（返回 null，由调用方计入 `outsideWorkspace`）；
 * - 统一 `/`；身份 key 用小写（Windows 大小写不敏感），展示保留原样；
 * - 路径里出现 NUL / 控制字符 / 超长 → 非法，丢弃。
 */

/** 归一化结果。 */
export interface ResolvedPath {
  /** 展示用：工作区相对 POSIX 路径（保留原大小写）。 */
  path: string
  /** 身份 key：小写、`/` 分隔。 */
  key: string
}

const MAX_PATH_LENGTH = 1024

/** 反斜杠转 `/`，去掉 BOM 与首尾空白。 */
function toPosix(value: string): string {
  return value.replace(/\\/g, '/')
}

/** 是否含不可接受字符（NUL / 控制字符）。 */
function hasControlChars(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i)
    if (code < 0x20 || code === 0x7f) return true
  }
  return false
}

function isAbsolutePath(value: string): boolean {
  return /^[A-Za-z]:\//.test(value) || value.startsWith('/')
}

/**
 * 归一化 cwd：`E:\a\b\` → `E:/a/b`；大小写保持原样（比较时再 lowercase）。
 * 非法 cwd 返回空串（调用方据此拒绝请求）。
 */
export function normalizeCwd(cwd: string): string {
  if (typeof cwd !== 'string') return ''
  const trimmed = cwd.trim()
  if (trimmed === '' || hasControlChars(trimmed)) return ''
  let posix = toPosix(trimmed)
  // 折叠重复分隔符（保留 UNC 前导 //，本产品只处理本地盘符/绝对路径）。
  posix = posix.replace(/\/{2,}/g, '/')
  if (posix.length > 1 && posix.endsWith('/')) posix = posix.slice(0, -1)
  return posix
}

/**
 * 把绝对 POSIX 路径按段归一化（处理 `.` / `..`）。
 * `..` 越出根 → null。
 */
function normalizeAbsolute(value: string): string | null {
  let drive = ''
  let rest = value
  const match = /^([A-Za-z]):\//.exec(value)
  if (match) {
    drive = `${match[1]}:`
    rest = value.slice(match[0].length)
    return joinSegments(drive, rest)
  }
  if (value.startsWith('/')) {
    return joinSegments('', value.slice(1))
  }
  return null
}

function joinSegments(prefix: string, rest: string): string | null {
  const stack: string[] = []
  for (const segment of rest.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      if (stack.length === 0) return null
      stack.pop()
      continue
    }
    stack.push(segment)
  }
  return prefix === '' ? `/${stack.join('/')}` : `${prefix}/${stack.join('/')}`
}

/**
 * 把工具参数里的路径解析成工作区相对路径。
 * @param raw 原始路径（来自 `args.file_path` / `args.path` 等）
 * @param cwd 会话 header.cwd（绝对路径）
 * @returns 解析结果；越界/非法/空 → null（调用方计入 outsideWorkspace，不猜）
 */
export function resolveWorkspacePath(raw: unknown, cwd: string): ResolvedPath | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (trimmed === '' || trimmed.length > MAX_PATH_LENGTH) return null
  if (hasControlChars(trimmed)) return null

  const base = normalizeCwd(cwd)
  if (base === '') return null

  const posix = toPosix(trimmed)
  let absolute: string | null
  if (isAbsolutePath(posix)) {
    absolute = normalizeAbsolute(posix.replace(/\/{2,}/g, '/'))
  } else {
    // 相对路径：以 cwd 为基准，然后走同一套归一化 + 包含检查。
    absolute = normalizeAbsolute(`${base}/${posix}`)
  }
  if (absolute === null) return null

  const baseKey = base.toLowerCase()
  const absoluteKey = absolute.toLowerCase()
  if (absoluteKey === baseKey) return null
  if (!absoluteKey.startsWith(`${baseKey}/`)) return null

  const relative = absolute.slice(base.length + 1)
  if (relative === '') return null
  return { path: relative, key: relative.toLowerCase() }
}

/** cwd 是否是绝对路径（盘符或 POSIX 根）；用于路由参数校验。 */
export function isAbsoluteCwd(cwd: string): boolean {
  const normalized = normalizeCwd(cwd)
  if (normalized === '') return false
  return isAbsolutePath(normalized)
}

/** 路径是否在同一目录下（用于 cwd 归属校验；大小写与分隔符不敏感）。 */
export function sameWorkspaceCwd(a: string | undefined, b: string | undefined): boolean {
  const left = normalizeCwd(a ?? '')
  const right = normalizeCwd(b ?? '')
  if (left === '' || right === '') return false
  return left.toLowerCase() === right.toLowerCase()
}

/** 路径是否是「像文件」的（有扩展名且不以 `/` 结尾）；仅用于 grep/glob 的 args.path。 */
export function looksLikeFile(path: string): boolean {
  if (path.endsWith('/')) return false
  const slash = path.lastIndexOf('/')
  const base = slash >= 0 ? path.slice(slash + 1) : path
  const dot = base.lastIndexOf('.')
  return dot > 0 && dot < base.length - 1
}

const DOC_EXT = new Set(['md', 'mdx', 'markdown', 'txt', 'rst', 'pdf', 'doc', 'docx', 'odt', 'rtf'])
const CODE_EXT = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'mts', 'cts', 'py', 'rb', 'go', 'rs', 'java', 'kt',
  'c', 'h', 'cc', 'cpp', 'hpp', 'cs', 'php', 'swift', 'scala', 'sh', 'bash', 'ps1', 'psm1', 'lua',
  'sql', 'vue', 'svelte', 'astro',
])
const DATA_EXT = new Set(['json', 'jsonl', 'ndjson', 'csv', 'tsv', 'xml', 'parquet', 'db', 'sqlite', 'xlsx', 'xls', 'arrow'])
const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'tif', 'tiff', 'avif', 'heic'])
const CONFIG_EXT = new Set(['yml', 'yaml', 'toml', 'ini', 'cfg', 'conf', 'env', 'properties', 'lock', 'gitignore', 'editorconfig'])

/** 按扩展名判家族（04 §4.2）；未知 → `other`。 */
export function familyOf(path: string): 'doc' | 'code' | 'data' | 'image' | 'config' | 'other' {
  const slash = path.lastIndexOf('/')
  const base = slash >= 0 ? path.slice(slash + 1) : path
  const dot = base.lastIndexOf('.')
  if (dot <= 0 || dot === base.length - 1) {
    const lowered = base.toLowerCase()
    if (lowered === 'makefile' || lowered === 'dockerfile') return 'code'
    return 'other'
  }
  const ext = base.slice(dot + 1).toLowerCase()
  if (IMAGE_EXT.has(ext)) return 'image'
  if (DOC_EXT.has(ext)) return 'doc'
  if (DATA_EXT.has(ext)) return 'data'
  if (CONFIG_EXT.has(ext)) return 'config'
  if (CODE_EXT.has(ext)) return 'code'
  return 'other'
}

/** 文件名（basename），POSIX 口径。 */
export function baseName(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash >= 0 ? path.slice(slash + 1) : path
}

/** 目录名（dirname），POSIX 口径；根下一级返回空串。 */
export function dirName(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash > 0 ? path.slice(0, slash) : ''
}
