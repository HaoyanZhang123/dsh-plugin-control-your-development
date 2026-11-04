/**
 * A30-3：引用解析逐格式正例 + 反例（md/html/css/js/ts/py/json/yaml/toml）。
 * 判据：目标字符串与行号正确；URL/锚点/data 不成为引用；无扩展名不猜。
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  parserFor,
  parseFileReferences,
  supportedExtensions,
} from '../../src/shared/relations/index.ts'
import type { RawReference } from '../../src/shared/relations/index.ts'

/** 概要视图：只比 line/raw/kind/syntax（alternatives/anchor 单独断言）。 */
function brief(reference: RawReference): { line: number; raw: string; kind: string; syntax: string } {
  return { line: reference.line, raw: reference.raw, kind: reference.kind, syntax: reference.syntax }
}

test('A30-3 分派表：每种格式都注册了解析器，未知扩展名不解析', () => {
  for (const extension of ['md', 'markdown', 'html', 'htm', 'css', 'js', 'ts', 'tsx', 'py', 'json', 'yaml', 'yml', 'toml']) {
    assert.ok(parserFor(`file.${extension}`) !== undefined, `缺解析器：${extension}`)
    assert.ok(supportedExtensions().includes(extension))
  }
  assert.equal(parserFor('notes.bin'), undefined)
  assert.equal(parseFileReferences('notes.bin', 'x'), undefined)
})

test('A30-3 Markdown：inline link / image / definition / wiki / 行内 code 为正例', () => {
  const text = [
    '# Title',
    '',
    'See [doc](./docs/a.md) and ![shot](./img/a.png).',
    '',
    '[ref]: ./docs/b.md',
    '[[wiki-page]]',
    '',
    '`./src/x.ts` and `npm run build`',
    '',
    '[docs](https://example.com/a.md) [top](#section) [mail](mailto:a@b.c) [data](data:text/plain,hi) [noext](./foo)',
  ].join('\n')

  const result = parseFileReferences('README.md', text)
  assert.ok(result !== undefined)
  assert.equal(result.truncated, false)

  const pathRefs = result.references.filter((reference) => reference.kind === 'path').map(brief)
  assert.deepEqual(pathRefs, [
    { line: 3, raw: './docs/a.md', kind: 'path', syntax: 'md-inline-link' },
    { line: 3, raw: './img/a.png', kind: 'path', syntax: 'md-image' },
    { line: 5, raw: './docs/b.md', kind: 'path', syntax: 'md-definition' },
    { line: 6, raw: 'wiki-page', kind: 'path', syntax: 'md-wiki' },
    { line: 8, raw: './src/x.ts', kind: 'path', syntax: 'md-code' },
    { line: 10, raw: './foo', kind: 'path', syntax: 'md-inline-link' },
  ])

  // 反例：URL / 锚点 / mailto / data 都不是引用（kind 已标注，不会进图）
  assert.deepEqual(
    result.references.filter((reference) => reference.kind !== 'path').map(brief),
    [
      { line: 10, raw: '#section', kind: 'anchor', syntax: 'md-inline-link' },
      { line: 10, raw: 'data:text/plain,hi', kind: 'data', syntax: 'md-inline-link' },
      { line: 10, raw: 'https://example.com/a.md', kind: 'external', syntax: 'md-inline-link' },
      { line: 10, raw: 'mailto:a@b.c', kind: 'external', syntax: 'md-inline-link' },
    ],
  )
  assert.ok(result.filtered >= 1, '行内 code 里的非路径（npm run build）计入 filtered')
})

test('A30-3 Markdown 反例：围栏代码块里的反引号路径不算引用；锚点不成为引用', () => {
  const text = ['```ts', 'see `./src/a.ts`', '```', 'plain `./src/b.ts`', '[x](#top)'].join('\n')
  const result = parseFileReferences('doc.md', text)
  assert.ok(result !== undefined)
  const codeRefs = result.references.filter((reference) => reference.syntax === 'md-code')
  assert.deepEqual(codeRefs.map((reference) => reference.raw), ['./src/b.ts'])
  assert.deepEqual(
    result.references.filter((reference) => reference.kind === 'anchor').map((reference) => reference.raw),
    ['#top'],
  )
})

test('A30-3 HTML：href/src 为正例，URL/锚点/data/mailto 为反例', () => {
  const text = [
    '<link rel="stylesheet" href="./a.css">',
    "<img src='./img/a.png'>",
    '<a href="https://example.com/x">y</a>',
    '<a href="#top">z</a>',
    '<img src="data:image/png;base64,AAA">',
    '<a href="mailto:a@b.c">m</a>',
    '<div data-href="./fake.md">n</div>',
  ].join('\n')
  const result = parseFileReferences('index.html', text)
  assert.ok(result !== undefined)
  assert.deepEqual(result.references.map(brief), [
    { line: 1, raw: './a.css', kind: 'path', syntax: 'html-attr' },
    { line: 2, raw: './img/a.png', kind: 'path', syntax: 'html-attr' },
    { line: 3, raw: 'https://example.com/x', kind: 'external', syntax: 'html-attr' },
    { line: 4, raw: '#top', kind: 'anchor', syntax: 'html-attr' },
    { line: 5, raw: 'data:image/png;base64,AAA', kind: 'data', syntax: 'html-attr' },
    { line: 6, raw: 'mailto:a@b.c', kind: 'external', syntax: 'html-attr' },
  ])
  assert.ok(!result.references.some((reference) => reference.raw === './fake.md'), 'data-href 不是 href')
})

test('A30-3 CSS：@import 与 url() 为正例，data/http/锚点为反例', () => {
  const text = [
    '@import "./base.css";',
    '@import url(./theme.css);',
    'body { background: url(./bg.png); }',
    '.x { mask: url(#m); }',
    '.y { background: url(https://example.com/a.png); }',
    '.z { background: url(data:image/png;base64,AAA); }',
  ].join('\n')
  const result = parseFileReferences('style.css', text)
  assert.ok(result !== undefined)
  assert.deepEqual(result.references.map(brief), [
    { line: 1, raw: './base.css', kind: 'path', syntax: 'css-import' },
    { line: 2, raw: './theme.css', kind: 'path', syntax: 'css-import' },
    { line: 3, raw: './bg.png', kind: 'path', syntax: 'css-url' },
    { line: 4, raw: '#m', kind: 'anchor', syntax: 'css-url' },
    { line: 5, raw: 'https://example.com/a.png', kind: 'external', syntax: 'css-url' },
    { line: 6, raw: 'data:image/png;base64,AAA', kind: 'data', syntax: 'css-url' },
  ])
})

test('A30-3 JS/TS：import/export/require/动态 import 为相对路径正例，裸说明符被过滤', () => {
  const text = [
    "import { a } from './a.ts'",
    "import React from 'react'",
    "export { b } from './b.ts'",
    "const c = require('./c.json')",
    "const d = await import('./d.ts')",
    "import('https://esm.sh/x')",
    'const name = "x"; import(name)',
  ].join('\n')
  const result = parseFileReferences('mod.ts', text)
  assert.ok(result !== undefined)
  assert.deepEqual(result.references.map(brief), [
    { line: 1, raw: './a.ts', kind: 'path', syntax: 'js-import' },
    { line: 3, raw: './b.ts', kind: 'path', syntax: 'js-export' },
    { line: 4, raw: './c.json', kind: 'path', syntax: 'js-require' },
    { line: 5, raw: './d.ts', kind: 'path', syntax: 'js-dynamic' },
    { line: 6, raw: 'https://esm.sh/x', kind: 'external', syntax: 'js-dynamic' },
  ])
  assert.ok(result.filtered >= 1, "import React from 'react' 不是相对路径 → filtered")
})

test('A30-3 Python：相对导入映射 .py/__init__.py，绝对导入按工作区根基准', () => {
  const text = [
    'from .x import y',
    'from ..pkg.mod import name',
    'from . import sibling',
    'import os',
    'from __future__ import annotations',
  ].join('\n')
  const result = parseFileReferences('src/app/main.py', text)
  assert.ok(result !== undefined)
  const [relativeX, relativePkg, relativeSelf, absoluteOs, absoluteFuture] = result.references

  assert.equal(relativeX.line, 1)
  assert.equal(relativeX.raw, '.x')
  assert.deepEqual(relativeX.alternatives, ['./x.py', './x/__init__.py'])
  assert.equal(relativeX.anchor, undefined)

  assert.equal(relativePkg.line, 2)
  assert.deepEqual(relativePkg.alternatives, ['./../pkg/mod.py', './../pkg/mod/__init__.py'])

  assert.equal(relativeSelf.line, 3)
  assert.equal(relativeSelf.raw, '.sibling')
  assert.deepEqual(relativeSelf.alternatives, ['./sibling.py', './sibling/__init__.py'])

  assert.equal(absoluteOs.line, 4)
  assert.equal(absoluteOs.anchor, 'workspace-root')
  assert.deepEqual(absoluteOs.alternatives, ['./os.py', './os/__init__.py'])

  assert.equal(absoluteFuture.line, 5)
  assert.equal(absoluteFuture.raw, '__future__')
  assert.equal(absoluteFuture.anchor, 'workspace-root')
})

test('A30-3 JSON：字符串值里的路径为正例，包名/版本号/URL 为反例', () => {
  const text = [
    '{',
    '  "entry": "./src/index.ts",',
    '  "name": "lodash",',
    '  "version": "1.0.0",',
    '  "homepage": "https://example.com/a.md"',
    '}',
  ].join('\n')
  const result = parseFileReferences('package.json', text)
  assert.ok(result !== undefined)
  assert.deepEqual(result.references.map(brief), [
    { line: 2, raw: './src/index.ts', kind: 'path', syntax: 'structured-string' },
    { line: 5, raw: 'https://example.com/a.md', kind: 'external', syntax: 'structured-string' },
  ])
  assert.ok(result.filtered >= 2, 'lodash / 1.0.0 不是路径 → filtered')
})

test('A30-3 YAML：裸值为正例，版本号与无扩展名串为反例', () => {
  const text = [
    'entry: ./src/index.ts',
    'name: lodash',
    'version: 1.0.0',
    'homepage: https://example.com/a.md',
    'files:',
    '  - ./docs/a.md',
  ].join('\n')
  const result = parseFileReferences('config.yaml', text)
  assert.ok(result !== undefined)
  const paths = result.references.filter((reference) => reference.kind === 'path').map((reference) => reference.raw)
  assert.deepEqual(paths, ['./src/index.ts', './docs/a.md'])
  assert.ok(result.references.some((reference) => reference.kind === 'external' && reference.raw === 'https://example.com/a.md'))
  assert.ok(!result.references.some((reference) => reference.raw.includes('1.0.0')), '版本号不是路径')
})

test('A30-3 TOML：带引号路径为正例，版本号/包名/URL 为反例', () => {
  const text = [
    'entry = "./src/index.ts"',
    'name = "lodash"',
    'version = "1.0.0"',
    'homepage = "https://example.com/a.md"',
  ].join('\n')
  const result = parseFileReferences('config.toml', text)
  assert.ok(result !== undefined)
  assert.deepEqual(result.references.map(brief), [
    { line: 1, raw: './src/index.ts', kind: 'path', syntax: 'structured-string' },
    { line: 4, raw: 'https://example.com/a.md', kind: 'external', syntax: 'structured-string' },
  ])
  assert.ok(result.filtered >= 2)
})

test('A30-3 上限：单文件候选超过 200 条时截断并标 truncated（N-10）', () => {
  const lines = Array.from({ length: 260 }, (_, index) => `[n${index}](./docs/f${index}.md)`)
  const result = parseFileReferences('big.md', lines.join('\n'))
  assert.ok(result !== undefined)
  assert.equal(result.references.length, 200)
  assert.equal(result.truncated, true)
})

test('A30-3 每个解析器都给出正例与反例（类型层面自检）', () => {
  const samples: Record<string, { positive: string; negative: string }> = {
    'a.md': { positive: '[x](./y.md)', negative: '[x](https://e.com/y.md)' },
    'a.html': { positive: '<a href="./y.css">x</a>', negative: '<a href="#top">x</a>' },
    'a.css': { positive: 'url(./y.png)', negative: 'url(data:image/png;base64,AA)' },
    'a.ts': { positive: "import './y.ts'", negative: "import 'react'" },
    'a.py': { positive: 'from .y import z', negative: 'value = 1' },
    'a.json': { positive: '{"p": "./y.md"}', negative: '{"p": "lodash"}' },
    'a.yaml': { positive: 'p: ./y.md', negative: 'p: 1.0.0' },
    'a.toml': { positive: 'p = "./y.md"', negative: 'p = "1.0.0"' },
  }
  for (const [path, sample] of Object.entries(samples)) {
    const positive = parseFileReferences(path, sample.positive)
    assert.ok(positive !== undefined, `${path} 应有解析器`)
    assert.ok(positive.references.some((reference) => reference.kind === 'path'), `${path} 正例未被识别`)
    const negative = parseFileReferences(path, sample.negative)
    assert.ok(negative !== undefined)
    assert.ok(
      !negative.references.some((reference) => reference.kind === 'path'),
      `${path} 反例不应产生 path 候选：${sample.negative}`,
    )
  }
})
