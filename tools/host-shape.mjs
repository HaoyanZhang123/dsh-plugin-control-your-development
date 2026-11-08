/**
 * tools/host-shape.mjs —— host 半区的**文件系统边界**断言（1.2.0 返工，2026-11-07）。
 *
 * 为什么单独成文件：门禁本身也要被审计（工厂 AGENTS.md「改门禁本身」）——
 * 抽出来之后 `tests/integration/host-shape.test.ts` 可以同时跑**正向**（合法只读实现放过）
 * 与**反向**（写 API / 裸 fs / 白名单滥用必须红），不用真的把坏代码写进 src/ 再构建。
 *
 * 规则来历：
 * - 旧规则是空壳阶段的「host 什么都不许 import fs」，一刀切。
 * - 1.2.0 起用户**明确批准 B1 例外**（04 §9.5）：`remote.workspaceFiles.list` 不可用时，
 *   允许 host 用 `node:fs/promises` 做**只读目录列表**。
 * - 因此规则改成「只读白名单 + 写 API 黑名单 + 正向要求真的只读读目录」。
 *
 * ⚠️ 实现要点（第一版踩过的坑，别再退回）：
 * 不能用「整份产物做 `\b writeFile \b` 关键字扫描」——`write` / `rm` / `unlink` 这类短名
 * 在日志文案、变量名、`res.write(...)` 里到处都是，会产生**假红**（实测：未改动的 host 产物
 * 被误报 4 条）。正确做法是**只审计真正从 fs 模块导入的绑定名**：ESM 下用 fs API 必须先 import，
 * 所以「导入名」是精确、可枚举的审计面。命名空间导入（`import * as fs`）再按 `fs.<prop>` 逐个看。
 *
 * 边界（四条，缺一即失败）：
 * 1. fs 模块说明符只允许 `node:fs/promises`；裸 `fs` / `node:fs`（同步面）/ `fs/promises` /
 *    `require('fs')` / `createRequire` 一律禁止。
 * 2. 从 fs 导入的每个绑定名都必须在只读白名单里；出现写/变更类 API 即失败并**点名**。
 * 3. 命名空间导入时，任何 `ns.<写 API>` 属性访问即失败并点名。
 * 4. 既然引了 fs，就必须真的出现只读读目录调用，否则判「白名单被滥用」。
 */

/** 允许的 fs 模块说明符（只读 promise 面）。 */
export const HOST_FS_ALLOWED_MODULES = ['node:fs/promises']

/**
 * 只读白名单：从 fs 导入时**只允许**这些名字。
 * 只放目录列举真正需要的；新增名字要先改这条注释与 04 §9.5。
 */
export const HOST_FS_READ_ALLOWLIST = [
  'readdir', // 列目录（唯一的实质动作）
  'lstat', // 判 symlink / 文件类型
  'stat', // 兜底元数据
  'realpath', // 逃逸符号链接的归宿校验
  'access', // 可读性探测（可选）
  'constants', // FileKind/R_OK 常量
]

/**
 * 写 / 变更类 fs API：出现在「从 fs 导入的绑定名」或「ns.<prop>」里即越界（04 §9.5 零写）。
 * 不需要穷举全部 API——凡是**不在只读白名单**里的名字都会失败，这个列表只用来给出更清楚的理由。
 */
export const HOST_FS_FORBIDDEN_APIS = [
  'writeFile',
  'appendFile',
  'createWriteStream',
  'createReadStream',
  'mkdir',
  'rm',
  'rmdir',
  'unlink',
  'rename',
  'copyFile',
  'cp',
  'truncate',
  'chmod',
  'chown',
  'lchmod',
  'lchown',
  'symlink',
  'link',
  'readlink',
  'utimes',
  'lutimes',
  'open',
  'opendir',
  'watch',
  'write',
  'writev',
  'ftruncate',
  'fsync',
  'fdatasync',
  'mkdtemp',
]

/** 只读读目录函数：开了 fs 白名单就必须真的只做这些事。 */
export const HOST_FS_READ_APIS = ['readdir', 'lstat', 'realpath']

/** 收集产物里 fs 相关的违规。返回 { failures, imported, namespaces }。 */
function auditFsUsage(text) {
  /** @type {string[]} */
  const failures = []
  /** 从 fs 导入的原始名（去重）。 @type {Set<string>} */
  const imported = new Set()
  /** `import * as ns` 的 ns 名。 @type {Set<string>} */
  const namespaces = new Set()
  let sawAnyFsSpecifier = false

  // ---- 静态 import：`import { a, b as c } from "spec"` / `import * as ns from "spec"` ----
  const staticRe = /\bimport\s+([\s\S]*?)\s+from\s*["']([^"']+)["']/g
  for (const match of text.matchAll(staticRe)) {
    const clause = match[1].trim()
    const specifier = match[2]
    if (!isFsSpecifier(specifier)) continue
    sawAnyFsSpecifier = true
    if (!HOST_FS_ALLOWED_MODULES.includes(specifier)) {
      failures.push(
        `host: 只允许 ${HOST_FS_ALLOWED_MODULES.join(' / ')}（只读目录列表，04 §9.5），实际出现了 "${specifier}"`,
      )
      continue
    }
    for (const name of parseImportClause(clause)) {
      if (name.namespace !== undefined) namespaces.add(name.namespace)
      else imported.add(name.original)
    }
  }

  // ---- 动态 import：`await import("node:fs/promises")`；命名空间绑定名无法静态确定，
  //      因此要求必须至少有一个 brace 式解构（`const { readdir } = await import(...)`）。----
  const dynamicRe = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g
  for (const match of text.matchAll(dynamicRe)) {
    const specifier = match[1]
    if (!isFsSpecifier(specifier)) continue
    sawAnyFsSpecifier = true
    if (!HOST_FS_ALLOWED_MODULES.includes(specifier)) {
      failures.push(
        `host: 只允许 ${HOST_FS_ALLOWED_MODULES.join(' / ')}（只读目录列表，04 §9.5），实际出现了 "${specifier}"`,
      )
      continue
    }
    // 动态 import 的可用成员只能从「解构它的那个赋值」里读出来：
    //   const { readdir, lstat: stat } = await import("node:fs/promises")
    //   const fsp = await import("node:fs/promises")            <- 命名空间，成员名静态可见
    const destructured = destructuredNamesForDynamicImport(text, match.index ?? 0)
    for (const name of destructured.members) imported.add(name)
    if (destructured.namespace !== undefined) namespaces.add(destructured.namespace)
    if (destructured.members.length === 0 && destructured.namespace === undefined) {
      failures.push(
        'host: 动态 import fs 后没有可静态审计的解构/命名空间绑定——请改成按名导入（import { readdir }）',
      )
    }
  }

  // ---- CJS require / createRequire 一律禁止（host 是 ESM；require 绕过静态审计） ----
  if (/require\s*\(\s*["'](?:node:)?fs(?:\/promises)?["']\s*\)/.test(text)) {
    failures.push('host: 禁止 require("fs")；只允许 node:fs/promises 的静态只读导入')
  }
  if (/\bcreateRequire\b/.test(text)) {
    failures.push('host: 禁止 createRequire（会绕过 fs 导入审计）')
  }

  // ---- 导入名审计：白名单之外一律失败，写 API 额外点名 ----
  for (const name of imported) {
    if (HOST_FS_READ_ALLOWLIST.includes(name)) continue
    const forbidden = HOST_FS_FORBIDDEN_APIS.includes(name)
    failures.push(
      forbidden
        ? `host: 从 fs 导入了写/变更类 API "${name}"——host 只读（04 §9.5 零写）`
        : `host: 从 fs 导入了不在只读白名单的 API "${name}"（白名单：${HOST_FS_READ_ALLOWLIST.join('/')}）`,
    )
  }

  // ---- 命名空间导入：逐个检查 `ns.<prop>` 属性访问 ----
  for (const ns of namespaces) {
    const escaped = ns.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const propRe = new RegExp('\\b' + escaped + '\\s*\\.\\s*([A-Za-z_$][\\w$]*)', 'g')
    const props = new Set()
    for (const match of text.matchAll(propRe)) props.add(match[1])
    for (const prop of props) {
      if (HOST_FS_READ_ALLOWLIST.includes(prop)) continue
      const forbidden = HOST_FS_FORBIDDEN_APIS.includes(prop)
      failures.push(
        forbidden
          ? `host: 通过命名空间调用了写/变更类 fs API "${ns}.${prop}"——host 只读（04 §9.5 零写）`
          : `host: 通过命名空间调用了不在只读白名单的 fs API "${ns}.${prop}"`,
      )
    }
    if (props.size === 0) {
      failures.push(`host: 命名空间导入 "${ns}" 无法静态审计成员名——请改成按名导入（import { readdir }）`)
    }
  }

  // ---- 正向：引了 fs 就必须真的读目录 ----
  if (sawAnyFsSpecifier) {
    const usedRead = HOST_FS_READ_APIS.some((api) => {
      if (imported.has(api)) return true
      for (const ns of namespaces) {
        if (new RegExp('\\b' + ns.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\.\\s*' + api + '\\b').test(text)) {
          return true
        }
      }
      return false
    })
    if (!usedRead) {
      failures.push(
        `host: 引了 fs 却没有任何只读读目录调用（${HOST_FS_READ_APIS.join('/')}）——白名单被滥用`,
      )
    }
  }

  return { failures, imported, namespaces }
}

/** fs 系列模块说明符判定（含裸 fs、node:fs、node:fs/*、fs/promises）。 */
function isFsSpecifier(specifier) {
  return (
    specifier === 'fs' ||
    specifier === 'node:fs' ||
    specifier.startsWith('node:fs/') ||
    specifier === 'fs/promises'
  )
}

/**
 * 从「动态 import 所在语句」里读出解构出来的成员名 / 命名空间绑定名。
 *
 * 覆盖两种常见形态（都在 import(...) 之前或同一语句内）：
 *   const { readdir, lstat: stat } = await import("node:fs/promises")
 *   const fsp = await import("node:fs/promises")
 *
 * @param {string} text 完整产物文本
 * @param {number} importIndex `import(` 出现的位置
 * @returns {{ members: string[]; namespace?: string }}
 */
function destructuredNamesForDynamicImport(text, importIndex) {
  /** 取 import( 之前最近的声明语句（同一条语句内） */
  const before = text.slice(Math.max(0, importIndex - 400), importIndex)
  const members = []
  let namespace
  const braces = /\{([\s\S]*?)\}\s*=\s*(?:await\s*)?$/.exec(before)
  if (braces !== null) {
    for (const piece of braces[1].split(',')) {
      const trimmed = piece.trim()
      if (trimmed === '') continue
      const parts = trimmed.split(/\s*:\s*/)
      const original = parts[0].trim()
      if (/^[A-Za-z_$][\w$]*$/.test(original)) members.push(original)
    }
    return { members }
  }
  const ns = /\b([A-Za-z_$][\w$]*)\s*=\s*(?:await\s*)?$/.exec(before)
  if (ns !== null) namespace = ns[1]
  return { members, ...(namespace === undefined ? {} : { namespace }) }
}

/**
 * 解析 import 子句，取出导入名。
 * 支持：`{ a, b as c }`、`* as ns`、`def`、`def, { a }`、`def, * as ns`。
 * @returns {Array<{ original: string; local: string; namespace?: undefined } | { namespace: string }>}
 */
function parseImportClause(clause) {
  const out = []
  const nsMatch = /\*\s+as\s+([A-Za-z_$][\w$]*)/.exec(clause)
  if (nsMatch !== null) {
    out.push({ namespace: nsMatch[1] })
  }
  const bracesMatch = /\{([\s\S]*?)\}/.exec(clause)
  if (bracesMatch !== null) {
    for (const piece of bracesMatch[1].split(',')) {
      const trimmed = piece.trim()
      if (trimmed === '') continue
      const parts = trimmed.split(/\s+as\s+/)
      const original = parts[0].trim()
      const local = (parts[1] ?? parts[0]).trim()
      if (/^[A-Za-z_$][\w$]*$/.test(original)) out.push({ original, local })
    }
  }
  // 默认导入（fs 的默认导出是命名空间，禁止使用）
  const defaultMatch = /^([A-Za-z_$][\w$]*)\s*(?:,|$)/.exec(clause.replace(/\{[\s\S]*?\}/, ''))
  if (defaultMatch !== null && defaultMatch[1] !== '*' && !clause.trim().startsWith('*')) {
    out.push({ original: '<default>', local: defaultMatch[1] })
  }
  return out
}

/**
 * 检查 host 产物文本的 fs 边界。
 *
 * @param {string} text 归一化后的 host 产物（lib/index.js 内容）
 * @returns {string[]} 失败原因列表；空数组 = 通过
 */
export function hostShapeFailures(text) {
  if (typeof text !== 'string' || text.trim() === '') return ['host: 产物为空']
  const { failures } = auditFsUsage(text)
  return failures
}

/** 便捷判定：host 产物是否满足 fs 边界。 */
export function assertHostFsBoundary(text) {
  const failures = hostShapeFailures(text)
  return { ok: failures.length === 0, failures }
}
