/**
 * A30-4 / N-07 / N-08：workspaceFiles 只读适配层的路径卡口、分页、上限与显式失败状态。
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  createVersionCache,
  createWorkspaceFilesReader,
  createWorkspaceReferenceSource,
  normalizeWorkspacePath,
} from '../../src/client/files/index.ts'
import type { CachedFileReferences } from '../../src/client/files/index.ts'
import { resolveParsedReferences } from '../../src/shared/relations/index.ts'
import { CWD, createFakeWorkspaceFiles } from './fixtures.ts'

function readerFor(entries: Parameters<typeof createFakeWorkspaceFiles>[0], limits?: Record<string, number>) {
  const fake = createFakeWorkspaceFiles(entries)
  const reader = createWorkspaceFilesReader({ files: fake.face, sessionId: 's1', cwd: CWD, limits })
  return { fake, reader }
}

test('A30-4 绝对路径：本层直接拒绝，且不调用 workspaceFiles（N-07）', async () => {
  const { fake, reader } = readerFor({ 'README.md': { text: 'hi' } })
  const absolute = await reader.readText('E:/work/demo/README.md')
  assert.equal(absolute.status, 'failed')
  if (absolute.status !== 'failed') throw new Error('unreachable')
  assert.equal(absolute.state, 'rejected')
  assert.equal(absolute.reason, 'absolute-path')
  assert.deepEqual(fake.statCalls, [])
  assert.deepEqual(fake.readCalls, [])
})

test('A30-4 路径穿越：`..` 越出 cwd 一律拒绝，折叠在内部仍允许（N-07）', async () => {
  assert.deepEqual(normalizeWorkspacePath('../secret.md'), { ok: false, reason: 'escape-cwd' })
  assert.deepEqual(normalizeWorkspacePath('docs/../../secret.md'), { ok: false, reason: 'escape-cwd' })
  assert.deepEqual(normalizeWorkspacePath('./docs/../README.md'), { ok: true, path: 'README.md' })

  const { fake, reader } = readerFor({ 'README.md': { text: 'hi' } })
  const escape = await reader.readText('../secret.md')
  assert.equal(escape.status, 'failed')
  if (escape.status !== 'failed') throw new Error('unreachable')
  assert.equal(escape.reason, 'escape-cwd')
  assert.deepEqual(fake.statCalls, [], '被拒绝的路径不许触达 workspaceFiles')
})

test('A30-4 服务端返回工作区外路径：本层复核后拒绝（N-07）', async () => {
  const { reader } = readerFor({
    'README.md': { text: 'hi', absolutePath: 'E:/work/other/README.md' },
  })
  const stat = await reader.statPath('README.md')
  assert.equal(stat.status, 'failed')
  if (stat.status !== 'failed') throw new Error('unreachable')
  assert.equal(stat.reason, 'outside-cwd')
  const read = await reader.readText('README.md')
  assert.equal(read.status, 'failed')
  if (read.status !== 'failed') throw new Error('unreachable')
  assert.equal(read.reason, 'outside-cwd')
})

test('A30-4 二进制/无效 UTF-8/不可读：跳过并给出显式状态（N-08）', async () => {
  const { reader } = readerFor({
    'a.bin': { error: { code: 'workspace-file/not-text' } },
    'b.md': { error: { code: 'workspace-file/invalid-utf8' } },
    'c.md': { error: { code: 'workspace-file/permission-denied' } },
    'd.md': { text: 'a\u0000b' },
  })
  const binary = await reader.readText('a.bin')
  assert.equal(binary.status, 'failed')
  if (binary.status !== 'failed') throw new Error('unreachable')
  assert.equal(binary.state, 'not-text')

  const invalidUtf8 = await reader.readText('b.md')
  assert.equal(invalidUtf8.status, 'failed')
  if (invalidUtf8.status !== 'failed') throw new Error('unreachable')
  assert.equal(invalidUtf8.state, 'invalid-utf8')

  const unreadable = await reader.readText('c.md')
  assert.equal(unreadable.status, 'failed')
  if (unreadable.status !== 'failed') throw new Error('unreachable')
  assert.equal(unreadable.state, 'unreadable')

  const nul = await reader.readText('d.md')
  assert.equal(nul.status, 'failed')
  if (nul.status !== 'failed') throw new Error('unreachable')
  assert.equal(nul.state, 'not-text')
  assert.equal(nul.reason, 'contains-nul')
})

test('A30-4 超大文件：按 stat.bytes 判定，直接不读正文', async () => {
  const { fake, reader } = readerFor({ 'huge.md': { text: 'x', bytes: 600 * 1024 } })
  const result = await reader.readText('huge.md')
  assert.equal(result.status, 'failed')
  if (result.status !== 'failed') throw new Error('unreachable')
  assert.equal(result.state, 'too-large')
  assert.deepEqual(fake.readCalls, [], '超限文件不许读')
})

test('A30-4 分页读取：多页拼接后与原文一致，未截断', async () => {
  const lines = Array.from({ length: 1200 }, (_, index) => `line-${index + 1}`)
  const text = lines.join('\n')
  const { fake, reader } = readerFor({ 'big.md': { text } })
  const result = await reader.readText('big.md')
  assert.equal(result.status, 'ok')
  if (result.status !== 'ok') throw new Error('unreachable')
  assert.equal(result.lines, 1200)
  assert.equal(result.pages, 3)
  assert.equal(result.truncated, false)
  assert.equal(result.text, text)
  assert.equal(fake.readCalls.length, 3)
})

test('A30-4 行数上限：超过 maxLines 截断并标 truncated（N-10）', async () => {
  const lines = Array.from({ length: 6000 }, (_, index) => `line-${index + 1}`)
  const { reader } = readerFor({ 'big.md': { text: lines.join('\n') } })
  const result = await reader.readText('big.md')
  assert.equal(result.status, 'ok')
  if (result.status !== 'ok') throw new Error('unreachable')
  assert.equal(result.lines, 5000)
  assert.equal(result.pages, 10)
  assert.equal(result.truncated, true)
})

test('A30-4 页数上限：达到 pagesPerFile 即停并标 truncated（N-10）', async () => {
  const lines = Array.from({ length: 20 }, (_, index) => `line-${index + 1}`)
  const { reader } = readerFor({ 'small.md': { text: lines.join('\n') } }, { pageLines: 2, pagesPerFile: 3 })
  const result = await reader.readText('small.md')
  assert.equal(result.status, 'ok')
  if (result.status !== 'ok') throw new Error('unreachable')
  assert.equal(result.pages, 3)
  assert.equal(result.truncated, true)
})

test('A30-4 文件不存在：显式 missing，不当成空文件', async () => {
  const { reader } = readerFor({})
  const result = await reader.readText('nope.md')
  assert.equal(result.status, 'failed')
  if (result.status !== 'failed') throw new Error('unreachable')
  assert.equal(result.state, 'missing')
})

test('A30-4 引用来源：不支持的格式不读文件；版本缓存按 version 失效', async () => {
  const fake = createFakeWorkspaceFiles({ 'docs/a.md': { text: '[x](./docs/b.md)', version: 'v1' } })
  const reader = createWorkspaceFilesReader({ files: fake.face, sessionId: 's1', cwd: CWD })
  const cache = createVersionCache<CachedFileReferences>()
  const source = createWorkspaceReferenceSource({ reader, cache })

  const unsupported = await source.read('notes.bin')
  assert.equal(unsupported.status, 'unsupported')
  assert.deepEqual(fake.readCalls, [])

  const first = await source.read('docs/a.md')
  assert.equal(first.status, 'ok')
  assert.equal(first.cached, false)
  assert.equal(first.references.length, 1)

  const second = await source.read('docs/a.md')
  assert.equal(second.cached, true, '同 version 应命中缓存')
  assert.equal(fake.readCalls.length, 1, '缓存命中不得重读正文')

  fake.setFile('docs/a.md', { text: '[x](./docs/b.md)\n[y](./docs/c.md)', version: 'v2' })
  const third = await source.read('docs/a.md')
  assert.equal(third.cached, false, 'version 变化必须失效')
  assert.equal(third.references.length, 2)
  assert.equal(fake.readCalls.length, 2)
})

test('A30-4 引用来源：二进制文件显式 failed，不产生候选（N-08）', async () => {
  const fake = createFakeWorkspaceFiles({
    'data.json': { error: { code: 'workspace-file/not-text' } },
  })
  const reader = createWorkspaceFilesReader({ files: fake.face, sessionId: 's1', cwd: CWD })
  const source = createWorkspaceReferenceSource({ reader })
  const report = await source.read('data.json')
  assert.equal(report.status, 'failed')
  assert.equal(report.state, 'not-text')
  assert.deepEqual(report.references, [])
  assert.deepEqual(source.parsedSources([report]), [])
})

test('A30-4 端到端：读正文 → 解析 → 确认，未确认目标不画边（N-09）', async () => {
  const fake = createFakeWorkspaceFiles({
    'README.md': { text: '[a](./docs/a.md)\n[b](./docs/missing.md)' },
    'docs/a.md': { text: '# a' },
  })
  const reader = createWorkspaceFilesReader({ files: fake.face, sessionId: 's1', cwd: CWD })
  const source = createWorkspaceReferenceSource({ reader })
  const report = await source.read('README.md')
  assert.equal(report.status, 'ok')

  const resolution = await resolveParsedReferences(source.parsedSources([report]), {
    cwd: CWD,
    touched: ['README.md', 'docs/a.md'],
    stat: (path) => path === 'docs/a.md',
  })
  assert.equal(resolution.edges.length, 1)
  assert.equal(resolution.edges[0].to, 'docs/a.md')
  assert.equal(resolution.unconfirmed.length, 1)
  assert.equal(resolution.unconfirmed[0].raw, './docs/missing.md')
})
