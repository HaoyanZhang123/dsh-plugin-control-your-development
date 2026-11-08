/**
 * tests/data/tree-host.test.ts —— R02 B1 host 只读目录列表 fallback（`src/host/tree.ts`）+
 * `host/routes.ts` 的第 4 条路由。
 *
 * **正向**（必须绿）：只读列出工作区根/子目录、排序输入确定性、size 只给普通文件、上限 → truncated。
 * **反向**（必须红）：绝对路径、`..` 穿越、越界目录、越界符号链接、会话 cwd 不可知 —— 全部显式拒绝，
 * 且**日志里没有路径**。
 *
 * 用假 fs（内存树）而不是真的读盘：本仓库纪律禁止测试依赖本机绝对路径；真实 fs 面由
 * `realTreeFs` 的静态审查 + 构建门禁守着（见测试末尾的源码断言）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  HOST_TREE_ENTRY_LIMIT,
  HOST_TREE_MAX_PATH_LENGTH,
  absoluteTreePath,
  handleTreeRequest,
  isInsideCwd,
  listTreeDirectory,
  readTreeSessionCwd,
  validateTreeRelativePath,
  type TreeDirEntryLike,
  type TreeFsLike,
  type TreeStatLike,
} from '../../src/host/tree.ts'
import { createRoutes, ROUTE_PATHS, validateTreeRequest } from '../../src/host/routes.ts'
import type { HostServices, PersistenceLike } from '../../src/host/services.ts'
import type { SessionHeaderLite } from '../../src/shared/events/index.ts'

const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const CWD = 'E:/work/demo'

/* ------------------------------------------------------------------ *
 * 假 fs：内存树（路径 → 条目）
 * ------------------------------------------------------------------ */

interface Node {
  kind: 'file' | 'directory' | 'symlink' | 'socket'
  size?: number
  /** symlink 的目标绝对路径。 */
  target?: string
}

function createFakeFs(tree: Record<string, Node>): TreeFsLike & { reads: string[] } {
  const readPaths: string[] = []
  // 归一化键（反斜杠 → `/`，去尾斜杠）
  const normalize = (path: string): string => path.replace(/\\/g, '/').replace(/\/+$/, '')
  const lookup = (path: string): Node | undefined => tree[normalize(path)]

  const statOf = (node: Node): TreeStatLike => ({
    isDirectory: () => node.kind === 'directory',
    isFile: () => node.kind === 'file',
    isSymbolicLink: () => node.kind === 'symlink',
    size: node.size ?? 0,
  })

  return {
    reads: readPaths,
    async readdir(path: string): Promise<TreeDirEntryLike[]> {
      readPaths.push(normalize(path))
      const base = normalize(path)
      const prefix = `${base}/`
      const names = new Map<string, Node>()
      for (const [key, node] of Object.entries(tree)) {
        if (!key.startsWith(prefix)) continue
        const rest = key.slice(prefix.length)
        if (rest === '' || rest.includes('/')) continue
        names.set(rest, node)
      }
      if (lookup(path) === undefined) {
        const error = new Error('ENOENT') as Error & { code: string }
        error.code = 'ENOENT'
        throw error
      }
      if (lookup(path)?.kind !== 'directory') {
        const error = new Error('ENOTDIR') as Error & { code: string }
        error.code = 'ENOTDIR'
        throw error
      }
      return [...names.entries()].map(([name, node]) => ({
        name,
        isDirectory: () => node.kind === 'directory',
        isFile: () => node.kind === 'file',
        isSymbolicLink: () => node.kind === 'symlink',
      }))
    },
    async lstat(path: string): Promise<TreeStatLike> {
      const node = lookup(path)
      if (node === undefined) {
        const error = new Error('ENOENT') as Error & { code: string }
        error.code = 'ENOENT'
        throw error
      }
      return statOf(node)
    },
    async realpath(path: string): Promise<string> {
      const node = lookup(path)
      if (node === undefined) {
        const error = new Error('ENOENT') as Error & { code: string }
        error.code = 'ENOENT'
        throw error
      }
      // 符号链接解析（限制 8 跳，避免测试自己写出环）
      let current = normalize(path)
      let hops = 0
      while (lookup(current)?.kind === 'symlink' && hops < 8) {
        current = normalize(lookup(current)?.target ?? current)
        hops += 1
      }
      return current
    },
  }
}

/** 标准夹具：根下有目录 src/docs、文件 README.md、符号链接（内/外）、socket。 */
function fixtureTree(): Record<string, Node> {
  return {
    [CWD]: { kind: 'directory' },
    [`${CWD}/src`]: { kind: 'directory' },
    [`${CWD}/src/client.ts`]: { kind: 'file', size: 512 },
    [`${CWD}/docs`]: { kind: 'directory' },
    [`${CWD}/README.md`]: { kind: 'file', size: 64 },
    [`${CWD}/.gitignore`]: { kind: 'file', size: 12 },
    // 指向工作区内的符号链接（可以列出、不可当目录外的入口）
    [`${CWD}/link-inside`]: { kind: 'symlink', target: `${CWD}/src` },
    // 指向工作区外的符号链接（必须被标 other + 计数）
    [`${CWD}/link-outside`]: { kind: 'symlink', target: 'C:/Windows' },
    [`${CWD}/socket`]: { kind: 'socket' },
    'C:/Windows': { kind: 'directory' },
    'C:/Windows/system32': { kind: 'directory' },
    // 工作区外的旁路目录（用于越界测试）
    'E:/work/other': { kind: 'directory' },
    'E:/work/other/secret.txt': { kind: 'file', size: 1 },
  } as Record<string, Node>
}

/* ------------------------------------------------------------------ *
 * 1. 纯函数：host 侧路径校验（比客户端更严：任何 `..` 都拒）
 * ------------------------------------------------------------------ */

test('host 路径校验：空串=根；绝对路径/`..`/控制字符/超长全部拒绝（不折叠放行）', () => {
  assert.deepEqual(validateTreeRelativePath(''), { ok: true, path: '' })
  assert.deepEqual(validateTreeRelativePath('src/client'), { ok: true, path: 'src/client' })
  assert.deepEqual(validateTreeRelativePath('./src//client/'), { ok: true, path: 'src/client' })

  assert.deepEqual(validateTreeRelativePath('/etc'), { ok: false, reason: 'absolute-path' })
  assert.deepEqual(validateTreeRelativePath('C:/Windows'), { ok: false, reason: 'absolute-path' })
  assert.deepEqual(validateTreeRelativePath('\\\\server\\share'), { ok: false, reason: 'absolute-path' })
  // host 不接受任何 `..`（客户端先折叠，所以合法导航不会被误拒）
  assert.deepEqual(validateTreeRelativePath('..'), { ok: false, reason: 'escape-cwd' })
  assert.deepEqual(validateTreeRelativePath('src/../../etc'), { ok: false, reason: 'escape-cwd' })
  assert.deepEqual(validateTreeRelativePath('src/../docs'), { ok: false, reason: 'escape-cwd' })
  assert.deepEqual(validateTreeRelativePath('a\u0001b'), { ok: false, reason: 'invalid-chars' })
  assert.deepEqual(validateTreeRelativePath('x'.repeat(HOST_TREE_MAX_PATH_LENGTH + 1)), { ok: false, reason: 'too-long' })
  assert.deepEqual(validateTreeRelativePath(42), { ok: false, reason: 'empty-path' })
})

test('cwd 包含检查：cwd 本身算在内，同级前缀/上级不算（大小写不敏感）', () => {
  assert.equal(isInsideCwd(CWD, CWD), true)
  assert.equal(isInsideCwd(CWD, `${CWD}/src`), true)
  assert.equal(isInsideCwd(CWD, 'E:/work/other'), false)
  assert.equal(isInsideCwd(CWD, 'E:/work/demo2'), false, '同前缀但不是子目录')
  assert.equal(isInsideCwd(CWD, 'E:/work'), false, '上级目录不算在内')
  assert.equal(isInsideCwd(CWD, 'C:/Windows'), false)
  assert.equal(isInsideCwd(CWD.toLowerCase(), `${CWD}/src`.toUpperCase()), true, 'Windows 大小写不敏感')
  assert.equal(isInsideCwd('', 'E:/x'), false)

  assert.equal(absoluteTreePath(CWD, ''), CWD)
  assert.equal(absoluteTreePath(CWD, 'src/ui'), `${CWD}/src/ui`)
  assert.equal(absoluteTreePath(`${CWD}/`, './src'), `${CWD}/src`)
})

/**
 * 跨平台回归：**POSIX 路径必须大小写敏感**。
 *
 * 缺陷背景（2026-11-08 审计发现）：`isInsideCwd` / reader 曾把 `caseInsensitive` 默认成 `true`，
 * 在 Linux/macOS 上会把「工作区外、只差大小写」的路径误判为工作区内 → 越界放行。
 * 正确行为是**自适应**：只有 Windows 形态（盘符 `C:` / UNC `//server`）才折叠大小写。
 *
 * 这条测试同时守住两个方向：
 * - POSIX：`/repo` 与 `/Repo` 是不同目录 → 必须 `false`；
 * - Windows：`E:/Work/Demo` 与 `E:/work/demo` 是同一目录 → 必须 `true`（回归不能反着修坏）。
 */
test('跨平台：POSIX 路径大小写敏感，Windows 路径大小写不敏感（自适应，不强制折叠）', () => {
  // POSIX：只差大小写 = 另一个目录，不算越界内
  assert.equal(isInsideCwd('/repo', '/Repo/src'), false, 'POSIX 大小写敏感：/Repo ≠ /repo')
  assert.equal(isInsideCwd('/repo', '/repo/src'), true)
  assert.equal(isInsideCwd('/Repo', '/repo/src'), false)

  // Windows：同名不同大小写 = 同一目录
  assert.equal(isInsideCwd('E:/work/demo', 'E:/WORK/DEMO/src'), true, 'Windows 大小写不敏感')
  assert.equal(isInsideCwd('E:/work/demo', 'E:/work/demo2'), false, '同前缀不是子目录')

  // 显式覆盖仍然有效（调用方明确知道平台时）
  assert.equal(isInsideCwd('/repo', '/Repo/src', true), true, '显式 true 强制折叠')
  assert.equal(isInsideCwd('E:/work/demo', 'E:/WORK/DEMO/src', false), false, '显式 false 强制敏感')
})

/* ------------------------------------------------------------------ *
 * 2. 反向：越界/绝对/`..` 必须被拒（这是 B1 的安全底线）
 * ------------------------------------------------------------------ */

test('反向：绝对路径、`..`、越界目录一律拒绝（不读盘、不返回条目）', async () => {
  const fs = createFakeFs(fixtureTree())
  const cases: Array<[string, string]> = [
    ['/etc/passwd', 'rejected-path'],
    ['C:/Windows', 'rejected-path'],
    ['..', 'rejected-path'],
    ['../other', 'rejected-path'],
    ['src/../../other', 'rejected-path'],
  ]
  for (const [path, expected] of cases) {
    const result = await listTreeDirectory({ cwd: CWD, path, fs })
    assert.equal(result.ok, false, path)
    assert.equal(result.ok === false ? result.code : '', expected, path)
  }
  assert.deepEqual(fs.reads, [], '被拒的路径一次都不许读盘')

  // 越界 = 合法相对路径但真实目标在 cwd 外（通过符号链接绕过字面检查）。
  const escaped = await listTreeDirectory({ cwd: CWD, path: 'link-outside', fs })
  assert.equal(escaped.ok, false)
  assert.equal(escaped.ok === false ? escaped.code : '', 'outside-cwd')

  // 不存在的目录 → not-found；指向文件的路径 → not-directory
  const missing = await listTreeDirectory({ cwd: CWD, path: 'nope', fs })
  assert.equal(missing.ok === false ? missing.code : '', 'not-found')
  const notDir = await listTreeDirectory({ cwd: CWD, path: 'README.md', fs })
  assert.equal(notDir.ok === false ? notDir.code : '', 'not-directory')

  // cwd 本身不可用（空/相对）→ unreadable（不猜一个盘符）
  const badCwd = await listTreeDirectory({ cwd: '', path: '', fs })
  assert.equal(badCwd.ok === false ? badCwd.code : '', 'unreadable')
})

/* ------------------------------------------------------------------ *
 * 3. 正向：根层/子目录真实列出，符号链接逃逸标 other + 计数
 * ------------------------------------------------------------------ */

test('正向：根层列出目录/文件/other，size 只给普通文件，逃逸符号链接标 other 并计数', async () => {
  const fs = createFakeFs(fixtureTree())
  const result = await listTreeDirectory({ cwd: CWD, path: '', fs })
  assert.equal(result.ok, true, JSON.stringify(result))
  if (!result.ok) return

  const byName = new Map(result.listing.entries.map((item) => [item.name, item]))
  // host 只保证"确定性输入"（按名字小写序）；UI 的目录→文件→other 排序在客户端唯一实现里做。
  assert.deepEqual(
    result.listing.entries.map((item) => item.name),
    result.listing.entries.map((item) => item.name).slice().sort((left, right) => {
      const a = left.toLowerCase()
      const b = right.toLowerCase()
      return a < b ? -1 : a > b ? 1 : left < right ? -1 : left > right ? 1 : 0
    }),
    'host 返回的顺序必须是确定性名称序（客户端再按 kind 分组）',
  )
  // 目录 / 文件 / other 三类都在
  assert.equal(byName.get('src')?.type, 'directory')
  assert.equal(byName.get('docs')?.type, 'directory')
  assert.equal(byName.get('README.md')?.type, 'file')
  assert.equal(byName.get('README.md')?.size, 64)
  assert.equal(byName.get('src')?.size, undefined, '目录不带 size（不伪造 0）')
  assert.equal(byName.get('socket')?.type, 'other')
  assert.equal(byName.get('link-inside')?.type, 'directory', '指向工作区内的符号链接可当作目录')
  assert.equal(byName.get('link-outside')?.type, 'other', '指向工作区外的符号链接必须标 other')
  assert.equal(result.escapedLinks, 1, '逃逸符号链接计数（只进日志，不进响应正文）')
  assert.equal(result.listing.truncated, false)

  // 子目录：一次一层，不递归
  const src = await listTreeDirectory({ cwd: CWD, path: 'src', fs })
  assert.equal(src.ok, true)
  if (src.ok) {
    assert.deepEqual(src.listing.entries.map((item) => item.name), ['client.ts'])
    assert.equal(src.listing.path, 'src')
    assert.equal(src.listing.entries[0].size, 512)
  }
})

test('正向：条目上限 → truncated=true（确定性前缀，不静默截断）', async () => {
  const tree: Record<string, Node> = { [CWD]: { kind: 'directory' } }
  for (let index = 0; index < 10; index += 1) {
    const name = `f${String(index).padStart(3, '0')}.txt`
    tree[`${CWD}/${name}`] = { kind: 'file', size: index }
  }
  const fs = createFakeFs(tree)
  const capped = await listTreeDirectory({ cwd: CWD, path: '', fs, limit: 4 })
  assert.equal(capped.ok, true)
  if (capped.ok) {
    assert.equal(capped.listing.truncated, true)
    assert.deepEqual(capped.listing.entries.map((item) => item.name), ['f000.txt', 'f001.txt', 'f002.txt', 'f003.txt'])
  }
  const whole = await listTreeDirectory({ cwd: CWD, path: '', fs, limit: HOST_TREE_ENTRY_LIMIT })
  assert.equal(whole.ok && whole.listing.truncated, false)
})

test('正向：空目录返回空 entries 且 truncated=false（不是错误）', async () => {
  const tree: Record<string, Node> = { [CWD]: { kind: 'directory' }, [`${CWD}/empty`]: { kind: 'directory' } }
  const fs = createFakeFs(tree)
  const result = await listTreeDirectory({ cwd: CWD, path: 'empty', fs })
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.deepEqual(result.listing.entries, [])
    assert.equal(result.listing.truncated, false)
  }
})

/* ------------------------------------------------------------------ *
 * 4. 会话 cwd 读取（只读 header）
 * ------------------------------------------------------------------ */

function fakePersistence(header: SessionHeaderLite | undefined, options: { stat?: boolean } = {}): PersistenceLike {
  const handle = {
    header: header as SessionHeaderLite,
    async read() {
      return { events: [] }
    },
    close() {
      return undefined
    },
  }
  const base: PersistenceLike = {
    async open() {
      if (header === undefined) throw new Error('not-found')
      return handle
    },
  }
  if (options.stat !== false) {
    base.stat = async () => {
      if (header === undefined) throw new Error('not-found')
      return { header: header as SessionHeaderLite }
    }
  }
  return base
}

test('会话 cwd：优先 stat().header，没有 stat 用只读 handle；拿不到 → undefined（不猜）', async () => {
  const header: SessionHeaderLite = { id: 's1', createdAt: 1, cwd: CWD }
  assert.equal(await readTreeSessionCwd(fakePersistence(header), 's1'), CWD)
  assert.equal(await readTreeSessionCwd(fakePersistence(header, { stat: false }), 's1'), CWD)
  assert.equal(await readTreeSessionCwd(fakePersistence(undefined), 's1'), undefined)
  assert.equal(await readTreeSessionCwd(undefined, 's1'), undefined)
  const noCwd = { id: 's1', createdAt: 1 } as SessionHeaderLite
  assert.equal(await readTreeSessionCwd(fakePersistence(noCwd), 's1'), undefined)
})

/* ------------------------------------------------------------------ *
 * 5. 路由层：handleTreeRequest + createRoutes 注册
 * ------------------------------------------------------------------ */

test('handleTreeRequest：错误只给码，日志里没有路径正文', async () => {
  const messages: string[] = []
  const fs = createFakeFs(fixtureTree())
  const deps = {
    getPersistence: () => fakePersistence({ id: 's1', createdAt: 1, cwd: CWD }),
    logger: { warn: (message: string) => messages.push(message) },
    fs,
  }

  const ok = await handleTreeRequest(deps, { sessionId: 's1', path: 'src' })
  assert.equal(ok.ok, true)

  const rejected = await handleTreeRequest(deps, { sessionId: 's1', path: '../other' })
  assert.equal(rejected.ok, false)
  assert.equal(rejected.ok === false ? rejected.code : '', 'threadline/bad-request')
  assert.equal(rejected.ok === false ? rejected.detail : '', 'escape-cwd')

  const outside = await handleTreeRequest(deps, { sessionId: 's1', path: 'link-outside' })
  assert.equal(outside.ok === false ? outside.detail : '', 'outside-cwd')

  // 日志纪律：只有错误码/计数，绝无路径
  for (const message of messages) {
    assert.equal(/E:\/work|src|link-outside|\.\.\//.test(message), false, '日志里出现路径：' + message)
  }
  assert.ok(messages.some((message) => message.includes('rejected-path')), '至少要有关联错误码：' + messages.join(' | '))
  assert.ok(messages.some((message) => message.includes('outside-cwd')), '越界也要有错误码：' + messages.join(' | '))
})

test('handleTreeRequest：无 persistence / 会话无 cwd → capability-missing / session-unreadable', async () => {
  const fs = createFakeFs(fixtureTree())
  const none = await handleTreeRequest({ getPersistence: () => undefined, fs }, { sessionId: 's1', path: '' })
  assert.equal(none.ok === false ? none.code : '', 'threadline/capability-missing')
  const noCwd = await handleTreeRequest(
    { getPersistence: () => fakePersistence({ id: 's1', createdAt: 1 }), fs },
    { sessionId: 's1', path: '' },
  )
  assert.equal(noCwd.ok === false ? noCwd.code : '', 'threadline/session-unreadable')
})

test('路由校验：sessionId 形状与 scan/detail 同规则；path 必须是字符串（不回显）', () => {
  assert.deepEqual(validateTreeRequest({ sessionId: 's1' }), { ok: true, value: { sessionId: 's1', path: '' } })
  assert.deepEqual(validateTreeRequest({ sessionId: 's1', path: 'src' }), { ok: true, value: { sessionId: 's1', path: 'src' } })
  for (const bad of [{}, { sessionId: '' }, { sessionId: '../etc' }, { sessionId: 'a/b' }, { sessionId: 1 }]) {
    const result = validateTreeRequest(bad)
    assert.equal(result.ok, false, JSON.stringify(bad))
    assert.equal(result.ok === false ? result.code : '', 'threadline/bad-request')
    assert.equal(result.ok === false ? result.message.includes('..') : true, false, '错误消息不回显输入')
  }
  assert.equal(validateTreeRequest({ sessionId: 's1', path: 5 }).ok, false)
  assert.equal(validateTreeRequest({ sessionId: 's1', path: 'x'.repeat(HOST_TREE_MAX_PATH_LENGTH + 1) }).ok, false)
})

test('createRoutes 真的注册第 4 条路由，且 handler 端到端可用（含拒绝分支）', async () => {
  const registered: string[] = []
  const disposed: string[] = []
  const connection = {
    fetch: {
      register(route: { path: string }): () => void {
        registered.push(route.path)
        return () => disposed.push(route.path)
      },
    },
  }
  const fs = createFakeFs(fixtureTree())
  const services: HostServices = {
    connection,
    getPersistence: () => fakePersistence({ id: 's1', createdAt: 1, cwd: CWD }),
    getSessionQuery: () => undefined,
  }
  // 通过 handleTreeRequest 的 fs 注入让端到端测试不依赖真实盘：这里用 route + 真实 fs 面
  // 会读本机磁盘，所以只断言注册与拒绝分支（拒绝分支在列盘之前就返回）。
  const routes = createRoutes(services)
  try {
    assert.equal(routes.register(), true)
    assert.deepEqual(registered.slice().sort(), [
      '/api/dsh-threadline/detail',
      '/api/dsh-threadline/scan',
      '/api/dsh-threadline/snapshot',
      '/api/dsh-threadline/tree',
    ])

    const invokeTree = async (body: unknown): Promise<{ status: number; json: Record<string, unknown> }> => {
      const response = await routes.invoke(
        'tree',
        new Request(`http://127.0.0.1${ROUTE_PATHS.tree}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
      )
      return { status: response.status, json: (await response.json()) as Record<string, unknown> }
    }

    // 非法 JSON body → bad-request
    const badJson = await routes.invoke(
      'tree',
      new Request(`http://127.0.0.1${ROUTE_PATHS.tree}`, { method: 'POST', body: 'not-json' }),
    )
    assert.equal(((await badJson.json()) as { error: { code: string } }).error.code, 'threadline/bad-request')

    // sessionId 非法 → bad-request（不回显）
    const badSession = await invokeTree({ sessionId: '../etc', path: '' })
    assert.equal((badSession.json.error as { code: string }).code, 'threadline/bad-request')

    // 路径越界：在真实盘上也不会成功（cwd 是本机不存在的夹具路径 → 明确错误，不是空目录）
    const escape = await invokeTree({ sessionId: 's1', path: '../other' })
    const escapeError = escape.json.error as { code: string; message: string; detail?: string }
    assert.equal(escapeError.code, 'threadline/bad-request')
    assert.equal(escapeError.detail, 'escape-cwd')
    assert.equal(escapeError.message.includes('other'), false, '错误消息不回显路径')
    assert.equal(escape.json.ok, false)
  } finally {
    routes.dispose()
  }
  assert.equal(disposed.length, 4)
})

/* ------------------------------------------------------------------ *
 * 6. 源码纪律（B1 的"零写"是硬要求，必须可断言）
 * ------------------------------------------------------------------ */

test('host 只读纪律：tree.ts 只用只读 fs API，不出现任何写 API', () => {
  const source = readFileSync(join(PLUGIN_ROOT, 'src', 'host', 'tree.ts'), 'utf8')
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('*') && !line.trimStart().startsWith('//'))
    .join('\n')
  // 只读三件套：必须都出现（正向）
  for (const allowed of ['readdir', 'lstat', 'realpath']) {
    assert.ok(code.includes(allowed), '缺少只读 API：' + allowed)
  }
  // 写 API 黑名单（与 tools/build.mjs 的 fs 门禁同向）。
  // 用"标识符 + 紧跟左括号"匹配，避免 `truncated`/`size` 这类字段名误判。
  const forbidden = [
    'writeFile',
    'appendFile',
    'createWriteStream',
    'mkdir',
    'unlink',
    'rmdir',
    'rename',
    'copyFile',
    'truncate',
    'chmod',
    'chown',
    'symlink',
    'utimes',
    'openSync',
    'createReadStream',
  ]
  for (const name of forbidden) {
    assert.equal(new RegExp('\\b' + name + '\\s*\\(').test(code), false, 'host/tree.ts 出现写/其它 fs API：' + name)
  }
  assert.equal(/\.rm\s*\(/.test(code), false, 'host/tree.ts 不许删文件')
  // 只从 node:fs/promises 静态导入（不用裸 fs / node:fs 同步面）
  assert.match(code, /from 'node:fs\/promises'/)
  assert.equal(/from '(?:node:)?fs'/.test(code), false, '不许 import 裸 fs 或 node:fs')
})

test('host 只读纪律：不写 storage、不发外部请求、不碰 document', () => {
  const source = readFileSync(join(PLUGIN_ROOT, 'src', 'host', 'tree.ts'), 'utf8')
  for (const forbidden of ['localStorage', 'sessionStorage', 'fetch(', 'XMLHttpRequest', 'document.', 'window.']) {
    assert.equal(source.includes(forbidden), false, 'host/tree.ts 出现：' + forbidden)
  }
})
