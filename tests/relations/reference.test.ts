/**
 * A30-5 + N-07/N-08/N-09：引用确认规则（未确认不画边）、越界拒绝、外部来源、重复引用。
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  resolveParsedReferences,
  resolveReferences,
} from '../../src/shared/relations/index.ts'
import { CWD } from './fixtures.ts'

const TOUCHED = ['README.md', 'docs/a.md', 'src/index.ts', 'src/util.ts', 'src/util.py', 'src/app.py']

/** 存在但未被触碰的文件；其它未列出的按不存在处理。 */
const EXISTING = new Set([
  'readme.md',
  'docs/a.md',
  'docs/untouched.md',
  'src/index.ts',
  'src/util.ts',
  'src/util.py',
  'src/app.py',
  'src/os.py',
])

const stat = (path: string): boolean => EXISTING.has(path.toLowerCase())

const MD = [
  '# Demo',
  '',
  '[a](./docs/a.md)',
  '[b](./docs/missing.md)',
  '[c](./docs/untouched.md)',
  '[d](https://example.com/x.md)',
  '[e](#section)',
  '[f](./foo)',
  '[g](../outside.md)',
  '[h](./src/nope.ts)',
  '[i](E:/work/demo/docs/a.md)',
  '[j](E:/work/other/secret.md)',
  '[k](./DOCS/A.MD)',
  '[l](./docs/a.md)',
].join('\n')

test('A30-5 引用：只有“工作区内 + 已触碰”的目标才画边，且大小写归一', async () => {
  const result = await resolveReferences([{ path: 'README.md', text: MD }], {
    cwd: CWD,
    touched: TOUCHED,
    stat,
  })

  assert.equal(result.edges.length, 1)
  const edge = result.edges[0]
  assert.equal(edge.type, 'reference')
  assert.equal(edge.from, 'README.md')
  assert.equal(edge.to, 'docs/a.md')
  assert.equal(edge.directed, true)
  assert.equal(edge.confirmed, true)
  assert.equal(edge.confidence, 'parsed')
  // 4 次引用同一目标（第 3/11/13/14 行）合并成一条边，证据取第一条（行号最小）
  assert.equal(edge.weight, 4)
  assert.equal(edge.evidence.kind, 'reference')
  if (edge.evidence.kind !== 'reference') throw new Error('unreachable')
  assert.equal(edge.evidence.line, 3)
  assert.equal(edge.evidence.text, 'README.md 第 3 行引用 docs/a.md')
})

test('A30-5 未确认引用：不画边，原因逐条可解释（N-09 / N-07）', async () => {
  const result = await resolveReferences([{ path: 'README.md', text: MD }], {
    cwd: CWD,
    touched: TOUCHED,
    stat,
  })

  const byRaw = new Map(result.unconfirmed.map((item) => [item.raw, item]))
  const missing = byRaw.get('./docs/missing.md')
  assert.ok(missing !== undefined)
  assert.equal(missing.reason, 'not-found')
  assert.equal(missing.exists, false)
  assert.equal(missing.line, 4)

  const untouched = byRaw.get('./docs/untouched.md')
  assert.ok(untouched !== undefined)
  assert.equal(untouched.reason, 'not-touched', '存在但未被触碰 → 不画边')
  assert.equal(untouched.exists, true)

  assert.equal(byRaw.get('./foo')?.reason, 'no-extension', '无扩展名不猜')
  assert.equal(byRaw.get('../outside.md')?.reason, 'escape-cwd', '`../` 越界必须拒绝')
  assert.equal(byRaw.get('./src/nope.ts')?.reason, 'not-found')
  assert.equal(byRaw.get('E:/work/other/secret.md')?.reason, 'outside-workspace', '绝对路径在工作区外 → 拒绝')

  // 未确认的都不出现在边里
  for (const item of result.unconfirmed) {
    assert.ok(!result.edges.some((edge) => edge.to === item.target), `未确认目标不应画边：${item.raw}`)
  }
})

test('A30-5 外部 URL 与锚点：进清单、不画边', async () => {
  const result = await resolveReferences([{ path: 'README.md', text: MD }], {
    cwd: CWD,
    touched: TOUCHED,
    stat,
  })
  assert.deepEqual(result.external.map((item) => item.raw), ['https://example.com/x.md'])
  assert.deepEqual(result.ignored.map((item) => item.reason), ['anchor'])
  assert.ok(!result.edges.some((edge) => edge.to.includes('example.com')))
})

test('A30-5 自引用被忽略（不产生自环边）', async () => {
  const result = await resolveReferences([{ path: 'docs/a.md', text: '[self](./a.md)' }], {
    cwd: CWD,
    touched: TOUCHED,
    stat,
  })
  assert.equal(result.edges.length, 0)
  assert.deepEqual(result.ignored.map((item) => item.reason), ['self-reference'])
})

test('A30-5 无扩展名：默认不猜；显式打开 extensionFallback 才尝试已知扩展名', async () => {
  const source = { path: 'README.md', text: '[x](./docs/a)' }

  const strict = await resolveReferences([source], { cwd: CWD, touched: TOUCHED, stat })
  assert.equal(strict.edges.length, 0)
  assert.equal(strict.unconfirmed[0].reason, 'no-extension')

  const lenient = await resolveReferences([source], {
    cwd: CWD,
    touched: TOUCHED,
    stat,
    extensionFallback: true,
  })
  assert.equal(lenient.edges.length, 1)
  assert.equal(lenient.edges[0].to, 'docs/a.md')
})

test('A30-5 Python：相对导入可确认；stdlib 导入只成为未确认候选', async () => {
  const text = ['from .util import helper', 'import os', 'from __future__ import annotations'].join('\n')
  const result = await resolveReferences([{ path: 'src/app.py', text }], {
    cwd: CWD,
    touched: TOUCHED,
    stat,
  })
  assert.equal(result.edges.length, 1)
  assert.equal(result.edges[0].from, 'src/app.py')
  assert.equal(result.edges[0].to, 'src/util.py')
  assert.ok(result.unconfirmed.some((item) => item.reason === 'not-touched' || item.reason === 'not-found'))
})

test('A30-5 超过单次视图文件上限：延后并显式标 truncated（N-10）', async () => {
  const sources = [
    { path: 'a.md', text: '[x](./b.md)' },
    { path: 'b.md', text: '[x](./a.md)' },
    { path: 'c.md', text: '[x](./a.md)' },
  ]
  const result = await resolveReferences(sources, {
    cwd: CWD,
    touched: ['a.md', 'b.md', 'c.md'],
    maxFilesPerView: 2,
  })
  assert.equal(result.stats.parsedFiles, 2)
  assert.deepEqual(result.deferred, ['c.md'])
  assert.equal(result.truncated, true)
})

test('A30-5 不解析的扩展名：进 unparsed，不产边也不报错', async () => {
  const result = await resolveReferences([{ path: 'notes.bin', text: 'whatever' }], {
    cwd: CWD,
    touched: ['notes.bin'],
  })
  assert.deepEqual(result.unparsed, ['notes.bin'])
  assert.equal(result.edges.length, 0)
  assert.equal(result.stats.unparsedFiles, 1)
})

test('A30-5 resolveParsedReferences 与 resolveReferences 结果一致（缓存路径同源）', async () => {
  const direct = await resolveReferences([{ path: 'README.md', text: MD }], {
    cwd: CWD,
    touched: TOUCHED,
    stat,
  })
  const parsed = await resolveParsedReferences(
    [
      {
        path: 'README.md',
        references: [
          { raw: './docs/a.md', line: 3, syntax: 'md-inline-link', kind: 'path' },
          { raw: './docs/a.md', line: 14, syntax: 'md-inline-link', kind: 'path' },
        ],
      },
    ],
    { cwd: CWD, touched: TOUCHED, stat },
  )
  assert.equal(parsed.edges.length, 1)
  assert.equal(parsed.edges[0].to, 'docs/a.md')
  assert.equal(parsed.edges[0].weight, 2)
  assert.equal(direct.edges[0].id, parsed.edges[0].id)
})
