/**
 * tests/data/tree.test.ts —— R02 目录树数据层（客户端半区）。
 *
 * 覆盖（逐条对应 task-3 验收）：
 * 1. 纯函数：路径校验（绝对 / `..` / 控制字符 / 超长 / 空串=根）、路径拼接、面包屑、`other` 不可进入；
 * 2. 归一化：kind 排序（目录→文件→other）、确定性名称序、去重、文件 size、family 复用、
 *    truncated（宿主截断 + 本地上限）保留；
 * 3. 数据源：remote 优先（裸对象 / RemoteResult 信封 / 失败信封 / 抛错）、host fallback、双无 → no-source；
 * 4. 缓存与并发：命中不重复请求、同路径并发去重（计数断言）、refresh 只失效当前路径、
 *    invalidateSession 只清该会话、错误不入缓存、LRU 上限；
 * 5. 控制器：缓存命中首帧即 ready（不出现 loading）、**navigate 到未缓存目录时保留旧 listing**（M3）、
 *    back/根层 no-op、非法路径不发请求且显式 error、空目录 → empty；
 * 6. React 钩子：SSR 首帧不发请求、缓存命中首帧即有 entries；
 * 7. 只读纪律：源码不碰 storage/cookie、host 路由常量与 client 路由常量一致（防漂移）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  MAX_TREE_PATH_LENGTH,
  TREE_ENTRY_LIMIT,
  TREE_KIND_RANK,
  TREE_ROUTE_PATH,
  TreeSourceError,
  canEnterTreeEntry,
  compareTreeEntries,
  compareTreeEntryNames,
  createDirectoryTree,
  createHostTreeSource,
  createRemoteTreeSource,
  createTreeCache,
  joinTreePath,
  loadTreeListing,
  normalizeTreeEntries,
  normalizeTreeListing,
  parentTreePath,
  pickWorkspaceFilesFace,
  resetSharedTreeState,
  resolveTreeSource,
  sharedTreeCache,
  sortTreeEntries,
  treeBreadcrumb,
  treeCacheKey,
  treeInflightCount,
  useDirectoryTree,
  validateTreePath,
  type TreeEntry,
  type DirectoryTree,
} from '../../src/client/data/tree.ts'
import { DATA_ROUTES, routePath } from '../../src/client/data/http.ts'
import { ROUTE_PATHS } from '../../src/host/routes.ts'
import type { WorkspaceDirectoryListing, WorkspaceFilesFace } from '../../src/client/files/index.ts'
import type { FetchLike, FetchInitLike, FetchResponseLike } from '../../src/client/data/http.ts'

const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const NOW = 1_700_000_000_000
/** 会话 cwd（remote 源的根层 list 必须用它；见 SRC-probe.txt [B2]/[B4]）。 */
const CWD = 'E:/work/demo'

/* ------------------------------------------------------------------ *
 * 夹具：假 remote / 假 host fetch / 计数
 * ------------------------------------------------------------------ */

interface FakeRemote {
  face: WorkspaceFilesFace
  /** 每次 list 的入参（断言"没被请求"用）。 */
  listCalls: Array<{ sessionId: string; path: string }>
}

function createFakeRemote(
  listingFor: (path: string) => WorkspaceDirectoryListing | Promise<WorkspaceDirectoryListing>,
): FakeRemote {
  const listCalls: Array<{ sessionId: string; path: string }> = []
  const face: WorkspaceFilesFace = {
    async stat() {
      throw new Error('not used')
    },
    async read() {
      throw new Error('not used')
    },
    async list(sessionId: string, path: string) {
      listCalls.push({ sessionId, path })
      return listingFor(path)
    },
  }
  return { face, listCalls }
}

function dir(name: string, size?: number): { name: string; type: 'directory'; size?: number } {
  return size === undefined ? { name, type: 'directory' } : { name, type: 'directory', size }
}

function file(name: string, size?: number): { name: string; type: 'file'; size?: number } {
  return size === undefined ? { name, type: 'file' } : { name, type: 'file', size }
}

function listing(path: string, entries: WorkspaceDirectoryListing['entries'], truncated = false): WorkspaceDirectoryListing {
  return { path, entries, truncated }
}

/** 假 host fetch（同源 /api/dsh-threadline/tree）：按 body.path 返回脚本化响应。 */
function createFakeHostFetch(
  respond: (body: Record<string, unknown>) => unknown,
): { fetch: FetchLike; calls: Array<{ path: string; body: Record<string, unknown> }> } {
  const calls: Array<{ path: string; body: Record<string, unknown> }> = []
  const fetchImpl: FetchLike = async (input: string, init?: FetchInitLike): Promise<FetchResponseLike> => {
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {}
    calls.push({ path: input, body })
    const payload = respond(body)
    return { ok: true, status: 200, json: async () => payload }
  }
  return { fetch: fetchImpl, calls }
}

function entry(name: string, kind: TreeEntry['kind'] = 'file'): TreeEntry {
  return { name, path: name, kind, family: 'code' }
}

/** 可手动放行的门闩（控制响应到达时机；断言 loading 期间保留旧 listing）。 */
function createGate(): { wait(): Promise<void>; open(): void; readonly waiting: number } {
  const resolvers: Array<() => void> = []
  let latched = false
  return {
    wait(): Promise<void> {
      if (latched) return Promise.resolve()
      return new Promise<void>((resolve) => {
        resolvers.push(resolve)
      })
    },
    open(): void {
      latched = true
      for (const resolve of resolvers.splice(0)) resolve()
    },
    get waiting() {
      return resolvers.length
    },
  }
}

function tick(): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, 0)
  })
}

/* ------------------------------------------------------------------ *
 * 1. 纯函数：路径
 * ------------------------------------------------------------------ */

test('路径校验：空串=根、相对路径折叠、绝对路径/`..` 逃逸/控制字符/超长一律拒绝', () => {
  assert.deepEqual(validateTreePath(''), { ok: true, path: '' })
  assert.deepEqual(validateTreePath('   '), { ok: true, path: '' })
  assert.deepEqual(validateTreePath('src/client'), { ok: true, path: 'src/client' })
  assert.deepEqual(validateTreePath('./src//client/'), { ok: true, path: 'src/client' })
  assert.deepEqual(validateTreePath('src/./ui/../ui'), { ok: true, path: 'src/ui' })

  // 绝对路径三种形状都拒（/x、C:/x、//host/x）
  for (const absolute of ['/etc', '/', 'C:/Windows', 'c:\\Windows', '//server/share']) {
    assert.deepEqual(validateTreePath(absolute), { ok: false, reason: 'absolute-path' }, absolute)
  }
  // `..` 折叠后越出根 = 逃逸
  for (const escape of ['..', '../x', 'a/../../b', 'a/..']) {
    const result = validateTreePath(escape)
    if (escape === 'a/..') {
      // 折叠成根：合法（就 em 是回到根），不是逃逸
      assert.deepEqual(result, { ok: true, path: '' }, escape)
    } else {
      assert.deepEqual(result, { ok: false, reason: 'escape-cwd' }, escape)
    }
  }
  assert.deepEqual(validateTreePath('a\u0000b'), { ok: false, reason: 'invalid-chars' })
  assert.deepEqual(validateTreePath('x'.repeat(MAX_TREE_PATH_LENGTH + 1)), { ok: false, reason: 'too-long' })
  assert.deepEqual(validateTreePath(undefined), { ok: false, reason: 'empty-path' })
})

test('路径拼接/父目录/面包屑：根层无前导 `/`，面包屑每段带完整路径', () => {
  assert.equal(joinTreePath('', 'src'), 'src')
  assert.equal(joinTreePath('src', 'ui'), 'src/ui')
  assert.equal(joinTreePath('src/ui', 'x.ts'), 'src/ui/x.ts')

  assert.equal(parentTreePath(''), '')
  assert.equal(parentTreePath('src'), '')
  assert.equal(parentTreePath('src/ui/graph'), 'src/ui')

  assert.deepEqual(treeBreadcrumb(''), [])
  assert.deepEqual(treeBreadcrumb('src'), [{ name: 'src', path: 'src' }])
  assert.deepEqual(treeBreadcrumb('src/ui/graph'), [
    { name: 'src', path: 'src' },
    { name: 'ui', path: 'src/ui' },
    { name: 'graph', path: 'src/ui/graph' },
  ])
})

test('`other` 不可进入（只有 directory 可进入）', () => {
  assert.equal(canEnterTreeEntry(entry('a', 'directory')), true)
  assert.equal(canEnterTreeEntry(entry('b', 'file')), false)
  assert.equal(canEnterTreeEntry(entry('c', 'other')), false)
})

/* ------------------------------------------------------------------ *
 * 2. 归一化：排序 / 去重 / size / family / truncated
 * ------------------------------------------------------------------ */

test('排序：目录 → 文件 → other；同类确定性名称序（大小写不敏感，再比原文）', () => {
  const result = normalizeTreeEntries('src', [
    file('zeta.ts'),
    dir('Docs'),
    { name: 'link', type: 'other' },
    file('alpha.ts', 12),
    dir('apps'),
  ])
  assert.deepEqual(
    result.entries.map((item) => `${item.kind}:${item.name}`),
    ['directory:apps', 'directory:Docs', 'file:alpha.ts', 'file:zeta.ts', 'other:link'],
  )
  assert.equal(result.dropped, 0)
  assert.equal(result.capped, false)
  // 排序常量与比较器一致（同一事实源）
  assert.deepEqual([TREE_KIND_RANK.directory, TREE_KIND_RANK.file, TREE_KIND_RANK.other], [0, 1, 2])
  assert.deepEqual(sortTreeEntries(result.entries), result.entries)
  assert.deepEqual(result.entries.slice().sort(compareTreeEntries), result.entries)
  // 名称比较：小写优先，再按原文（`A` < `a`）
  assert.ok(compareTreeEntryNames('A', 'a') < 0)
  assert.ok(compareTreeEntryNames('a', 'b') < 0)
  assert.equal(compareTreeEntryNames('Ab', 'ab'), -1)
})

test('归一化：路径拼接、去重（大小写不敏感）、size 只给普通文件、family 按扩展名（唯一规则）', () => {
  const result = normalizeTreeEntries('src/client', [
    file('Merge.ts', 120),
    file('merge.ts', 999), // 同一身份键（Windows 不区分大小写）→ 丢弃后者
    dir('ui', 4096), // 目录不带 size（不伪造）
    { name: 'run.sh', type: 'file', size: -1 }, // 负数不采信
    file('run.sh'), // 同一路径第二次（小写相同）→ 丢弃
    file('notes.md', 8),
    { name: 'logo.png', type: 'file', size: 4 },
    { name: '', type: 'file' },
    { name: '..', type: 'directory' },
    { name: 'a/b', type: 'file' },
    null as unknown as { name: string; type: 'file' },
  ])
  assert.deepEqual(
    result.entries.map((item) => `${item.kind}:${item.name}:${item.size === undefined ? '-' : item.size}`),
    ['directory:ui:-', 'file:logo.png:4', 'file:Merge.ts:120', 'file:notes.md:8', 'file:run.sh:-'],
  )
  assert.equal(result.dropped, 6, '重复 2 条 + 空名/`..`/带分隔符/null 各 1 条')
  // family 复用 shared/events 的唯一 familyOf 规则（不是新表）
  const byName = new Map(result.entries.map((item) => [item.name, item.family]))
  assert.equal(byName.get('Merge.ts'), 'code')
  assert.equal(byName.get('notes.md'), 'text')
  assert.equal(byName.get('logo.png'), 'media')
  assert.equal(byName.get('ui'), 'other', '目录名无扩展名 → other（族色只对文件有意义）')
})

test('truncated：宿主截断保留；本地条目上限触发时也标 truncated（不静默截断）', () => {
  const raw = [file('a.ts'), file('b.ts'), file('c.ts')]
  const hostTruncated = normalizeTreeListing(listing('', raw, true), '', { now: () => NOW })
  assert.equal(hostTruncated.truncated, true)
  assert.equal(hostTruncated.loadedAt, NOW)
  assert.equal(hostTruncated.entries.length, 3)

  const capped = normalizeTreeListing(listing('', raw), '', { limit: 2, now: () => NOW })
  assert.equal(capped.truncated, true)
  assert.deepEqual(capped.entries.map((item) => item.name), ['a.ts', 'b.ts'])

  const plain = normalizeTreeListing(listing('', raw), '', { now: () => NOW })
  assert.equal(plain.truncated, false)
  assert.equal(TREE_ENTRY_LIMIT, 2000)
})

/* ------------------------------------------------------------------ *
 * 3. 数据源选路与错误分类
 * ------------------------------------------------------------------ */

test('选路：remote.list 优先 → host 只读路由 → 都没有 = null（显式 no-source）', () => {
  const remote = createFakeRemote(() => listing('', []))
  const hostFetch = createFakeHostFetch(() => ({ ok: true, path: '', entries: [], truncated: false }))

  const preferred = resolveTreeSource({
    sessionId: 's1',
    remote: { workspaceFiles: remote.face },
    fetch: hostFetch.fetch,
    cwd: CWD,
  })
  assert.equal(preferred?.kind, 'remote', 'remote 可用时不许走 host')

  const fallback = resolveTreeSource({ sessionId: 's1', remote: { workspaceFiles: { stat: () => undefined, read: () => undefined } }, fetch: hostFetch.fetch })
  assert.equal(fallback?.kind, 'host', 'remote 没有 list → host 只读 fallback')

  const proxyThrows = {
    get workspaceFiles(): never {
      throw new Error('cannot get property without inject')
    },
  }
  assert.equal(resolveTreeSource({ sessionId: 's1', remote: proxyThrows, fetch: hostFetch.fetch })?.kind, 'host', 'Cordis 代理读取抛错不能崩')

  assert.equal(resolveTreeSource({ sessionId: 's1', remote: undefined, fetch: null }), null)
  assert.equal(resolveTreeSource({ sessionId: '', remote: { workspaceFiles: remote.face } }), null, '空 sessionId 不建源')
  assert.equal(pickWorkspaceFilesFace({ workspaceFiles: { stat: () => undefined } }), undefined)
})

test('remote 源根层语义（真机纠正）：根用 cwd 绝对路径发 list；没有 cwd → root-without-cwd', async () => {
  // 证据：已安装 dsh-api-workspace-files@0.2.2-rc.1 的 inspect() 对空串抛 gateway/bad-request，
  // DSH 自己的文件树也用会话 cwd 当根（output/_verify/threadline/T50/R02/SRC-probe.txt）。
  const remote = createFakeRemote(() => listing(CWD, [dir('src'), file('README.md')]))
  const withCwd = createRemoteTreeSource({ files: remote.face, sessionId: 's1', cwd: CWD })
  await withCwd.list('')
  assert.deepEqual(remote.listCalls[0], { sessionId: 's1', path: CWD }, '根层必须发 cwd 绝对路径，不发空串')

  await withCwd.list('src/client')
  assert.deepEqual(remote.listCalls[1], { sessionId: 's1', path: 'src/client' }, '子目录仍发工作区相对路径')

  const noCwd = createRemoteTreeSource({ files: remote.face, sessionId: 's1' })
  await assert.rejects(() => noCwd.list(''), (error: unknown) => error instanceof TreeSourceError && error.code === 'root-without-cwd')
  assert.equal(remote.listCalls.length, 2, '没有 cwd 时不许发出空串请求')
})

test('remote 源：裸对象 / RemoteResult 信封都接受；失败信封与抛错 → list-failed；abort → aborted', async () => {
  const bare = createRemoteTreeSource({
    files: createFakeRemote(() => listing('src', [dir('ui'), file('a.ts', 3)])).face,
    sessionId: 's1',
    cwd: CWD,
  })
  const first = await bare.list('src')
  assert.equal(first.path, 'src')
  assert.deepEqual(first.entries.map((item) => item.name), ['ui', 'a.ts'])

  const enveloped = createRemoteTreeSource({
    files: {
      async stat() {
        throw new Error('unused')
      },
      async read() {
        throw new Error('unused')
      },
      async list() {
        return { ok: true, value: listing('', [file('x.ts')]) } as unknown as WorkspaceDirectoryListing
      },
    },
    sessionId: 's1',
    cwd: CWD,
  })
  assert.deepEqual((await enveloped.list('')).entries.map((item) => item.name), ['x.ts'])

  const failure = createRemoteTreeSource({
    files: {
      async stat() {
        throw new Error('unused')
      },
      async read() {
        throw new Error('unused')
      },
      async list() {
        return { ok: false, error: { code: 'workspace-file/not-found' } } as unknown as WorkspaceDirectoryListing
      },
    },
    sessionId: 's1',
    cwd: CWD,
  })
  await assert.rejects(() => failure.list(''), (error: unknown) => {
    assert.ok(error instanceof TreeSourceError)
    assert.equal(error.code, 'list-failed')
    assert.equal(error.message.includes('/'), false, '错误消息里不许出现路径')
    return true
  })

  const throwing = createRemoteTreeSource({
    files: {
      async stat() {
        throw new Error('unused')
      },
      async read() {
        throw new Error('unused')
      },
      async list() {
        throw new Error('boom')
      },
    },
    sessionId: 's1',
    cwd: CWD,
  })
  await assert.rejects(() => throwing.list(''), (error: unknown) => error instanceof TreeSourceError && error.code === 'list-failed')

  const aborting = createRemoteTreeSource({
    files: {
      async stat() {
        throw new Error('unused')
      },
      async read() {
        throw new Error('unused')
      },
      async list() {
        const error = new Error('aborted')
        error.name = 'AbortError'
        throw error
      },
    },
    sessionId: 's1',
    cwd: CWD,
  })
  await assert.rejects(() => aborting.list(''), (error: unknown) => error instanceof TreeSourceError && error.code === 'aborted')
})

test('host fallback 源：成功、route 错误按 detail 分类、传输失败 → list-failed', async () => {
  const okFetch = createFakeHostFetch(() => ({ ok: true, path: 'src', entries: [dir('ui')], truncated: true }))
  const hostOk = createHostTreeSource({ fetch: okFetch.fetch, sessionId: 's1' })
  const listed = await hostOk.list('src')
  assert.equal(listed.path, 'src')
  assert.equal(listed.truncated, true)
  assert.deepEqual(okFetch.calls[0], { path: routePath('tree'), body: { sessionId: 's1', path: 'src' } })

  const cases: Array<[string, string, string]> = [
    ['threadline/bad-request', 'not-found', 'not-found'],
    ['threadline/bad-request', 'not-directory', 'not-directory'],
    ['threadline/bad-request', 'outside-cwd', 'rejected-path'],
    ['threadline/internal', 'unreadable', 'unreadable'],
    ['threadline/capability-missing', undefined as unknown as string, 'no-source'],
  ]
  for (const [code, detail, expected] of cases) {
    const fake = createFakeHostFetch(() => ({ ok: false, error: { code, message: 'x', ...(detail === undefined ? {} : { detail }) } }))
    const source = createHostTreeSource({ fetch: fake.fetch, sessionId: 's1' })
    await assert.rejects(
      () => source.list('a'),
      (error: unknown) => error instanceof TreeSourceError && error.code === expected,
      `${code}/${String(detail)} → ${expected}`,
    )
  }

  const network: FetchLike = async () => {
    throw new Error('offline')
  }
  const networkSource = createHostTreeSource({ fetch: network, sessionId: 's1' })
  await assert.rejects(() => networkSource.list(''), (error: unknown) => error instanceof TreeSourceError && error.code === 'list-failed')
})

test('路由常量单一事实源：client routePath(tree) === DATA_ROUTES.tree === host ROUTE_PATHS.tree', () => {
  assert.equal(TREE_ROUTE_PATH, DATA_ROUTES.tree)
  assert.equal(TREE_ROUTE_PATH, ROUTE_PATHS.tree)
  assert.equal(TREE_ROUTE_PATH, '/api/dsh-threadline/tree')
})

/* ------------------------------------------------------------------ *
 * 4. 缓存 / 并发去重 / 失效
 * ------------------------------------------------------------------ */

test('缓存：命中不重复请求；同路径并发只发一次；不同路径各自一次（计数断言）', async () => {
  resetSharedTreeState()
  const remote = createFakeRemote((path) => listing(path, [file(`${path === '' ? 'root' : path}.ts`)]))
  const source = createRemoteTreeSource({ files: remote.face, sessionId: 's1', cwd: CWD })
  const cache = createTreeCache()

  const [a, b] = await Promise.all([
    loadTreeListing({ source, path: 'src', cache, now: () => NOW }),
    loadTreeListing({ source, path: 'src', cache, now: () => NOW }),
  ])
  assert.equal(a, b, '同路径并发必须复用同一个 promise/listing')
  assert.equal(remote.listCalls.length, 1, '并发去重：只请求一次')
  assert.equal(treeInflightCount(), 0, '完成后 in-flight 清空')

  const cached = await loadTreeListing({ source, path: 'src', cache, now: () => NOW })
  assert.equal(cached, a, '缓存命中返回同一份 listing')
  assert.equal(remote.listCalls.length, 1, '命中缓存不再请求')

  await loadTreeListing({ source, path: 'docs', cache, now: () => NOW })
  assert.equal(remote.listCalls.length, 2, '不同路径各自一次')
})

test('失效：refresh 只失效当前路径；invalidateSession 只清该会话；LRU 上限生效', async () => {
  const remote = createFakeRemote((path) => listing(path, [file('a.ts')]))
  const source = createRemoteTreeSource({ files: remote.face, sessionId: 's1', cwd: CWD })
  const cache = createTreeCache({ maxEntries: 4 })

  await loadTreeListing({ source, path: 'a', cache, now: () => NOW })
  await loadTreeListing({ source, path: 'b', cache, now: () => NOW })
  assert.equal(remote.listCalls.length, 2)

  // refresh 只重取当前路径（另一条路径仍命中缓存）
  await loadTreeListing({ source, path: 'a', cache, now: () => NOW, refresh: true })
  assert.equal(remote.listCalls.length, 3)
  await loadTreeListing({ source, path: 'b', cache, now: () => NOW })
  assert.equal(remote.listCalls.length, 3, 'b 仍在缓存里')

  // 会话隔离
  cache.set('s2', 'a', { path: 'a', entries: [], truncated: false, loadedAt: NOW })
  assert.notEqual(treeCacheKey('s1', 'a'), treeCacheKey('s2', 'a'))
  cache.invalidateSession('s2')
  assert.equal(cache.get('s2', 'a'), undefined)
  assert.notEqual(cache.get('s1', 'a'), undefined, '别的会话不受影响')

  // LRU：超过上限后最旧的被淘汰
  const lru = createTreeCache({ maxEntries: 2 })
  await loadTreeListing({ source, path: 'a', cache: lru, now: () => NOW })
  await loadTreeListing({ source, path: 'b', cache: lru, now: () => NOW })
  await loadTreeListing({ source, path: 'c', cache: lru, now: () => NOW })
  assert.equal(lru.size, 2)
  assert.equal(lru.get('s1', 'a'), undefined, '最旧的被淘汰')
  assert.notEqual(lru.get('s1', 'c'), undefined)
})

test('错误不是数据：失败的 listing 不入缓存，重试会再发一次请求', async () => {
  let fail = true
  const remote = createFakeRemote(() => {
    if (fail) throw new Error('boom')
    return listing('', [file('ok.ts')])
  })
  const source = createRemoteTreeSource({ files: remote.face, sessionId: 's1', cwd: CWD })
  const cache = createTreeCache()

  await assert.rejects(() => loadTreeListing({ source, path: '', cache, now: () => NOW }))
  assert.equal(cache.get('s1', ''), undefined, '失败不写缓存（不把错误当空目录）')
  fail = false
  const retried = await loadTreeListing({ source, path: '', cache, now: () => NOW })
  assert.deepEqual(retried.entries.map((item) => item.name), ['ok.ts'])
  assert.equal(remote.listCalls.length, 2)
})

test('非法路径不请求：loadTreeListing 直接 rejected-path', async () => {
  const remote = createFakeRemote(() => listing('', []))
  const source = createRemoteTreeSource({ files: remote.face, sessionId: 's1', cwd: CWD })
  const cache = createTreeCache()
  for (const bad of ['/etc', '../x', 'C:/Windows']) {
    await assert.rejects(
      () => loadTreeListing({ source, path: bad, cache, now: () => NOW }),
      (error: unknown) => error instanceof TreeSourceError && error.code === 'rejected-path',
      bad,
    )
  }
  assert.deepEqual(remote.listCalls, [], '被拒的路径一次都不许发出去')
})

/* ------------------------------------------------------------------ *
 * 5. 控制器（非 React）
 * ------------------------------------------------------------------ */

/**
 * 等到控制器进入目标状态。
 * 超时/状态不符 → reject（让测试真的红）；定时器一律清掉并 unref，
 * 绝不让兜底计时器在测试结束后再抛（否则会污染其它用例）。
 */
function settle(tree: DirectoryTree, expected: string, timeoutMs = 1000): Promise<void> {
  if (tree.getState().status === expected) return Promise.resolve()
  return new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const unsubscribe = tree.subscribe((state) => {
      if (state.status !== expected) return
      cleanup()
      resolve()
    })
    const cleanup = (): void => {
      unsubscribe()
      if (timer !== undefined) {
        clearTimeout(timer)
        timer = undefined
      }
    }
    timer = setTimeout(() => {
      cleanup()
      reject(new Error(`等待状态超时：期望 ${expected}，实际 ${tree.getState().status}（path=${tree.getState().path}）`))
    }, timeoutMs)
    // 不让兜底计时器拖住事件循环（Node 的 Timeout 有 unref）
    ;(timer as unknown as { unref?: () => void }).unref?.()
  })
}

test('控制器：缓存命中首帧即 ready（不闪 loading）；navigate 未缓存目录时保留旧 listing（M3）', async () => {
  const gate = createGate()
  const remote = createFakeRemote(async (path) => {
    if (path === 'slow') await gate.wait()
    return listing(path, path === CWD ? [dir('slow'), file('README.md', 10)] : [file('inner.ts', 5)])
  })
  const cache = createTreeCache()
  const tree = createDirectoryTree({
    sessionId: 's1',
    remote: { workspaceFiles: remote.face }, cwd: CWD,
    cache,
    now: () => NOW,
  })

  const first = tree.getState()
  assert.equal(first.status, 'idle', '首帧 idle（effect 后才发请求；SSR 不发请求）')
  assert.equal(first.source, 'remote')

  tree.navigate('')
  await settle(tree, 'ready')
  const rootListing = tree.getState().listing
  assert.ok(rootListing)
  assert.deepEqual(rootListing.entries.map((item) => item.name), ['slow', 'README.md'])

  // 预置缓存后重建：首帧直接 ready（同帧出现，无 loading）
  const warm = createDirectoryTree({ sessionId: 's1', remote: { workspaceFiles: remote.face }, cwd: CWD, cache, now: () => NOW })
  assert.equal(warm.getState().status, 'ready')
  assert.deepEqual(warm.getState().listing?.entries.map((item) => item.name), ['slow', 'README.md'])

  // navigate 到未缓存目录：loading 期间 listing 保留旧的（不整块空白）
  tree.navigate('slow')
  const loading = tree.getState()
  assert.equal(loading.status, 'loading')
  assert.equal(loading.path, 'slow')
  assert.equal(loading.listing, rootListing, 'loading 时保留上一份 listing（M3）')
  assert.equal(remote.listCalls.length, 2)

  gate.open()
  await settle(tree, 'ready')
  assert.deepEqual(tree.getState().listing?.entries.map((item) => item.name), ['inner.ts'], '新 listing 到达后替换')
})

test('控制器：back 到父目录、根层 no-op；refresh 只失效当前路径', async () => {
  const remote = createFakeRemote((path) => listing(path, [file(path === CWD ? 'a.ts' : 'b.ts')]))
  const cache = createTreeCache()
  const tree = createDirectoryTree({
    sessionId: 's1',
    remote: { workspaceFiles: remote.face }, cwd: CWD,
    cache,
    now: () => NOW,
  })

  tree.navigate('src/ui')
  await settle(tree, 'ready')
  assert.equal(tree.canBack, true)
  tree.back()
  await settle(tree, 'ready')
  assert.equal(tree.getState().path, 'src')
  tree.back()
  await settle(tree, 'ready')
  assert.equal(tree.getState().path, '')
  assert.equal(tree.canBack, false)

  const calls = remote.listCalls.length
  tree.back() // 根层 no-op：不发请求、路径不变
  await tick()
  assert.equal(tree.getState().path, '')
  assert.equal(remote.listCalls.length, calls, '根层 back 不许发请求')

  // refresh 只失效当前路径：先预热两个目录，再刷新根
  tree.prefetch('src')
  await tick()
  const before = remote.listCalls.length
  tree.refresh()
  await settle(tree, 'ready')
  assert.equal(remote.listCalls.length, before + 1, 'refresh 只重取当前路径')
  assert.notEqual(tree.peek('src'), undefined, '别的目录仍命中缓存')
})

test('控制器：非法路径 → 显式 error 且不发请求、不改路径；无源 → no-source（不假装空目录）', async () => {
  const remote = createFakeRemote((path) => listing(path, [file(`${path === '' ? 'root' : 'x'}.ts`)]))
  const tree = createDirectoryTree({ sessionId: 's1', remote: { workspaceFiles: remote.face }, cwd: CWD, cache: createTreeCache(), now: () => NOW })
  tree.navigate('src')
  await settle(tree, 'ready')

  tree.navigate('../etc')
  const rejected = tree.getState()
  assert.equal(rejected.status, 'error')
  assert.equal(rejected.errorCode, 'rejected-path')
  assert.equal(rejected.error, 'escape-cwd')
  assert.equal(rejected.path, 'src', '被拒的路径不许改当前路径')
  assert.equal(remote.listCalls.length, 1, '被拒路径一次都不许发出去')

  const noSource = createDirectoryTree({ sessionId: 's1', cache: createTreeCache(), now: () => NOW })
  assert.equal(noSource.source, 'none')
  assert.equal(noSource.getState().status, 'error')
  assert.equal(noSource.getState().errorCode, 'no-source')
  assert.equal(noSource.getState().listing, null, '无源时 listing 必须为 null，不能是空数组冒充空目录')
  noSource.navigate('')
  assert.equal(noSource.getState().errorCode, 'no-source')
})

test('控制器：空目录 → empty（不是 ready）；失败 → error 且保留旧 listing', async () => {
  let mode: 'empty' | 'fail' = 'empty'
  const remote = createFakeRemote((path) => {
    if (mode === 'fail') throw new Error('boom')
    return listing(path, path === CWD ? [dir('empty-dir')] : [])
  })
  const tree = createDirectoryTree({ sessionId: 's1', remote: { workspaceFiles: remote.face }, cwd: CWD, cache: createTreeCache(), now: () => NOW })
  tree.navigate('')
  await settle(tree, 'ready')
  tree.navigate('empty-dir')
  await settle(tree, 'empty')
  assert.equal(tree.getState().status, 'empty')
  assert.deepEqual(tree.getState().listing?.entries, [])
  assert.equal(tree.getState().errorCode, null)

  const previous = tree.getState().listing
  mode = 'fail'
  tree.refresh()
  await settle(tree, 'error')
  assert.equal(tree.getState().errorCode, 'list-failed')
  assert.equal(tree.getState().listing, previous, '失败时保留上次内容（不白屏、不显示假 0）')
})

test('控制器：切会话缓存隔离（同路径不同 session 不串）', async () => {
  const remote = createFakeRemote((path) => listing(path, [file('a.ts')]))
  const cache = createTreeCache()
  const one = createDirectoryTree({ sessionId: 's1', remote: { workspaceFiles: remote.face }, cwd: CWD, cache, now: () => NOW })
  one.navigate('')
  await settle(one, 'ready')
  const other = createDirectoryTree({ sessionId: 's2', remote: { workspaceFiles: remote.face }, cwd: CWD, cache, now: () => NOW })
  assert.equal(other.getState().status, 'idle', '别的会话不许拿到 s1 的缓存')
  assert.equal(other.peek(''), undefined)
})

/* ------------------------------------------------------------------ *
 * 6. React 钩子
 * ------------------------------------------------------------------ */

test('useDirectoryTree：SSR 首帧不发请求；缓存命中时首帧就有 entries（不 loading）', () => {
  resetSharedTreeState()
  const remote = createFakeRemote((path) => listing(path, [dir('src'), file('README.md', 3)]))

  const Probe = (props: { cache: ReturnType<typeof createTreeCache>; remoteFace: WorkspaceFilesFace }): React.ReactElement => {
    const tree = useDirectoryTree({ sessionId: 's1', remote: { workspaceFiles: props.remoteFace }, cwd: CWD, cache: props.cache })
    return React.createElement(
      'div',
      null,
      [
        tree.state.status,
        String(tree.entries.length),
        tree.state.path === '' ? 'root' : tree.state.path,
        tree.canBack ? 'back' : 'noback',
        String(tree.breadcrumb.length),
        tree.source,
        tree.state.listing?.truncated === true ? 'truncated' : 'whole',
      ].join('|'),
    )
  }

  const cache = createTreeCache()
  // 冷启动：SSR 渲染期不发请求（effect 不跑）
  const cold = renderToStaticMarkup(React.createElement(Probe, { cache, remoteFace: remote.face }))
  assert.match(cold, /idle\|0\|root\|noback\|0\|remote\|whole/)
  assert.equal(remote.listCalls.length, 0, '渲染期不许发请求')

  // 预热后首帧：ready + entries 直接出现
  cache.set('s1', '', { path: '', entries: [entry('src', 'directory'), entry('README.md', 'file')], truncated: true, loadedAt: NOW })
  const warm = renderToStaticMarkup(React.createElement(Probe, { cache, remoteFace: remote.face }))
  assert.match(warm, /ready\|2\|root\|noback\|0\|remote\|truncated/)
  assert.equal(remote.listCalls.length, 0)
})

test('useDirectoryTree：无 remote / 无 fetch → 显式 no-source（不伪装空目录）', () => {
  const Probe = (): React.ReactElement => {
    const tree = useDirectoryTree({ sessionId: 's1' })
    return React.createElement('div', null, `${tree.state.status}|${tree.state.errorCode}|${tree.entries.length}|${tree.source}`)
  }
  const html = renderToStaticMarkup(React.createElement(Probe))
  assert.match(html, /error\|no-source\|0\|none/)
})

/* ------------------------------------------------------------------ *
 * 7. 只读纪律（源码级断言）
 * ------------------------------------------------------------------ */

test('只读纪律：数据层不碰 storage/cookie/Location，也不 import fs', () => {
  const raw = readFileSync(join(PLUGIN_ROOT, 'src', 'client', 'data', 'tree.ts'), 'utf8')
  // 注释里会写"不持久化/不写 localStorage"，所以只查**代码**（去掉块注释和行注释）。
  const source = raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n')
  for (const forbidden of ['localStorage', 'sessionStorage', 'document.cookie', 'indexedDB', 'window.location', 'history.pushState']) {
    assert.equal(source.includes(forbidden), false, '数据层出现持久化/导航 API：' + forbidden)
  }
  assert.equal(/from 'node:fs/.test(source), false, '客户端数据层不许 import fs（fs 只在 host 半区）')
  // 唯一通信通道：data/http.ts 的 routePath/postJson（不是各处自己拼 URL）
  assert.match(source, /from '\.\/http\.ts'/)
  assert.equal(source.includes('/api/dsh-threadline/'), false, '路由字符串只在 http.ts 里出现一次')
})

test('共享缓存可复位（测试/卸载路径）', () => {
  sharedTreeCache.set('s9', '', { path: '', entries: [], truncated: false, loadedAt: NOW })
  assert.equal(sharedTreeCache.size > 0, true)
  resetSharedTreeState()
  assert.equal(sharedTreeCache.size, 0)
  assert.equal(treeInflightCount(), 0)
})
