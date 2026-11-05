/**
 * 33 §5 / §6 · 文件大类（`familyOf`）单测：五类判定 + 修 bug 的正反例。
 *
 * 权威：`notes/33-脉络2.0-交互重构-2026-11-05.md` §5（5 类表）、§6（数据契约）。
 * 旧契约是 6 类（doc/code/data/image/config/other）；本轮改为 **text/code/data/media/other**：
 * - 配置并入文本；图片/音频/视频合并为媒体；
 * - 修 bug：`html/css/scss/less` 归代码（旧实现落到 other）；
 * - 修 bug：`.gitignore` / `.env` 这类 dotfile 归文本（旧实现落到 other）。
 *
 * 实现若把任何一类改回旧名、或漏掉这几条修 bug，下面用例会红。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { familyOf, fileNodeFromTouches } from '../../src/shared/events/index.ts'
import type { FileFamily } from '../../src/shared/events/index.ts'

/** 五类全集（33 §6）：返回值只允许落在这些值里。 */
const FAMILIES: readonly FileFamily[] = ['text', 'code', 'data', 'media', 'other']

function uniqueFamilies(): Set<FileFamily> {
  return new Set<FileFamily>()
}

/** 断言一组路径全部落在期望大类（附路径名，失败时点名）。 */
function assertFamily(paths: readonly string[], expected: FileFamily): void {
  for (const path of paths) {
    assert.equal(familyOf(path), expected, path)
  }
}

test('33§5 文本类：文档 + 配置（配置并入文本）', () => {
  assertFamily(
    [
      'notes/a.md',
      'notes/b.mdx',
      'notes/c.markdown',
      'README.txt',
      'docs/d.rst',
      'spec/e.pdf',
      'legacy/f.doc',
      'legacy/g.docx',
      'legacy/h.odt',
      'legacy/i.rtf',
      // 配置类（33 §5：config 一族并入文本）
      'ci/j.yml',
      'ci/k.yaml',
      'cargo.toml',
      'setup.ini',
      'app.cfg',
      'nginx.conf',
      '.env',
      'gradle.properties',
      'pnpm-lock.yaml',
      'deps.lock',
    ],
    'text',
  )
})

test('33§5 dotfile：dot 在 0 的 dotfile 一律归文本（旧实现错误地归 other）', () => {
  assertFamily(
    ['.gitignore', '.env', '.editorconfig', '.npmrc', '.prettierrc', '.gitattributes', '.dockerignore', 'sub/.gitignore', 'a/b/.env'],
    'text',
  )
  // jsconfig 这类 dot 在 0 的写法同样走 dotfile 分支（不吃扩展名）。
  assert.equal(familyOf('.eslintrc.json'), 'text')
})

test('33§5 代码类：语言 + 标记/样式语言（html/css/scss/less 归代码，旧实现是 bug）', () => {
  assertFamily(
    [
      'src/app.ts',
      'src/app.tsx',
      'src/app.js',
      'src/app.jsx',
      'src/app.mjs',
      'tools/run.py',
      'cmd/main.go',
      'lib/core.rs',
      'scripts/run.sh',
      'scripts/run.ps1',
      'src/App.vue',
      'src/App.svelte',
      'src/page.astro',
      'db/schema.sql',
      // 本轮修 bug 的一族
      'public/index.html',
      'public/old.htm',
      'styles/site.css',
      'styles/theme.scss',
      'styles/legacy.less',
      'styles/vars.sass',
      // 无扩展名的构建文件仍是代码
      'Makefile',
      'makefile',
      'Dockerfile',
    ],
    'code',
  )
})

test('33§5 数据类：结构化数据与表格/库文件', () => {
  assertFamily(
    [
      'data/package.json',
      'data/rows.jsonl',
      'data/rows.ndjson',
      'data/table.csv',
      'data/table.tsv',
      'data/feed.xml',
      'data/part.parquet',
      'data/app.db',
      'data/app.sqlite',
      'data/book.xlsx',
      'data/book.xls',
      'data/column.arrow',
    ],
    'data',
  )
})

test('33§5 媒体类：图片 + 音频 + 视频合并成一类', () => {
  assertFamily(
    [
      'assets/logo.png',
      'assets/photo.jpg',
      'assets/photo.jpeg',
      'assets/anim.gif',
      'assets/pic.webp',
      'assets/icon.svg',
      'assets/old.bmp',
      'assets/favicon.ico',
      'assets/scan.tif',
      'assets/scan.tiff',
      'assets/new.avif',
      'assets/phone.heic',
      'assets/voice.mp3',
      'assets/voice.wav',
      'assets/voice.flac',
      'assets/voice.aac',
      'assets/voice.ogg',
      'assets/voice.m4a',
      'assets/voice.opus',
      'assets/voice.wma',
      'assets/clip.mp4',
      'assets/clip.mov',
      'assets/clip.avi',
      'assets/clip.mkv',
      'assets/clip.webm',
      'assets/clip.m4v',
      'assets/clip.mpg',
      'assets/clip.mpeg',
      'assets/clip.wmv',
    ],
    'media',
  )
})

test('33§5 其它类：字体/压缩包/二进制/未知 → other（不猜）', () => {
  assertFamily(
    [
      'assets/font.ttf',
      'assets/font.otf',
      'assets/font.woff',
      'assets/font.woff2',
      'dist/bundle.zip',
      'dist/bundle.tar',
      'dist/bundle.gz',
      'dist/bundle.7z',
      'dist/bundle.rar',
      'bin/tool.exe',
      'bin/lib.so',
      'bin/blob.bin',
      'bin/module.wasm',
      'notes/unclassified.zzz',
      'notes/future-extension.weird',
      'no-extension-file',
      'trailing-dot.',
      '',
    ],
    'other',
  )
})

test('33§5 反例对照：旧 6 类的取值不再出现，也不接受大小写/分隔符漂移', () => {
  // 返回值只允许五类（旧值 doc/image/config 必须已经消失）。
  const paths = [
    'src/app.ts',
    'notes/a.md',
    'data/package.json',
    'assets/logo.png',
    'Makefile',
    'x.unknown',
    '.gitignore',
  ]
  for (const path of paths) {
    assert.equal(FAMILIES.includes(familyOf(path)), true, path)
  }
  // 扩展名大小写不敏感（Windows 上一份文件可能写成大写）。
  assert.equal(familyOf('SRC/APP.TS'), 'code')
  assert.equal(familyOf('ASSETS/LOGO.PNG'), 'media')
  assert.equal(familyOf('DATA/ROWS.CSV'), 'data')
  // 反斜杠路径不在 familyOf 的职责里（host 归一化后才调用），这里只保证 basename 判定不依赖目录。
  assert.equal(familyOf('deep/nested/dir/index.html'), 'code')
})

test('33§6 host 文件节点：FileNode.family 由 familyOf 决定（同一口径，不是第二套映射）', () => {
  const cases: Array<[string, FileFamily]> = [
    ['src/app.ts', 'code'],
    ['public/index.html', 'code'],
    ['styles/site.css', 'code'],
    ['notes/readme.md', 'text'],
    ['.gitignore', 'text'],
    ['data/report.json', 'data'],
    ['assets/demo.mp4', 'media'],
    ['assets/font.woff2', 'other'],
  ]
  for (const [path, expected] of cases) {
    const node = fileNodeFromTouches(path, [], [path], 0, 0)
    assert.equal(node.family, expected, path)
    assert.equal(node.family, familyOf(path), path)
  }
})

test('33§5 五类都可达（覆盖完整性，防止某一类被删空）', () => {
  const seen = uniqueFamilies()
  for (const path of [
    'notes/a.md',
    'src/app.ts',
    'data/a.json',
    'assets/a.mp4',
    'assets/a.woff2',
  ]) {
    seen.add(familyOf(path))
  }
  assert.deepEqual([...seen].sort(), [...FAMILIES].sort())
})
