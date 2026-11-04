/*
 * tests/ui-turn/copy-source.test.ts —— 文案与样式的**静态纪律**（03 §12 / §13 / §16；06 A42-3 / N-14）。
 *
 * 三个"只能有一处"的证明：
 * 1. 我的源码里**没有中文/英文 UI 文案**（全部走 locale key）——字符串字面量里出现 CJK 即红；
 * 2. 用到的 locale key **真的存在**（`t('...')` / copy 表里的 key 都在 MESSAGE_KEYS 里）；
 * 3. 我的两份 CSS **每个选择器都挂 `.threadline-app`**、不写颜色字面量、不用 `!important`、
 *    响应式只用 `@container threadline`（与 base.css 同一套纪律，卸载即干净）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PLUGIN_ROOT } from '../harness/styles-codegen.ts'
import { MESSAGE_KEYS } from '../../src/client/locale/index.ts'
import { stringLiterals, stripComments } from '../ui-shell/source-utils.ts'

const UI_ROOT = join(PLUGIN_ROOT, 'src', 'client', 'ui')
const STYLE_ROOT = join(PLUGIN_ROOT, 'src', 'client', 'styles')
const OWNED_DIRS = ['turns', 'inspector']

function ownedSources(): Array<{ path: string; source: string }> {
  const files: Array<{ path: string; source: string }> = []
  for (const dir of OWNED_DIRS) {
    for (const name of readdirSync(join(UI_ROOT, dir))) {
      if (!name.endsWith('.ts')) continue
      const path = join(UI_ROOT, dir, name)
      files.push({ path: dir + '/' + name, source: readFileSync(path, 'utf8') })
    }
  }
  return files
}

const SOURCES = ownedSources()
const KEYS = new Set<string>(MESSAGE_KEYS)

test('我的源码里没有 UI 文案（字符串字面量无 CJK）', () => {
  const offenders: string[] = []
  for (const file of SOURCES) {
    const code = stripComments(file.source)
    for (const literal of stringLiterals(code)) {
      if (/[\u4e00-\u9fff]/.test(literal)) offenders.push(file.path + ' → ' + literal)
    }
  }
  assert.deepEqual(offenders, [], '源码里出现中文字面量（应改走 locale key）：' + offenders.join(' | '))
})

test('禁用词 0 命中（03 §16 末段）', () => {
  const forbidden = ['依赖', '已完成', '同步', '应用', '保存', '开始', '停止', '生成摘要']
  for (const file of SOURCES) {
    const code = stripComments(file.source)
    for (const literal of stringLiterals(code)) {
      for (const word of forbidden) {
        assert.ok(!literal.includes(word), file.path + ' 出现禁用词 ' + word + '：' + literal)
      }
    }
  }
})

test('源码里引用的 locale key 全部存在（缺 key 会在这里红，而不是运行时空文案）', () => {
  const used = new Set<string>()
  for (const file of SOURCES) {
    const code = stripComments(file.source)
    for (const match of code.matchAll(/\bt\(\s*'([^']+)'/g)) used.add(match[1])
    for (const match of code.matchAll(/\b(?:label|familyLabel|commandStatusLabel|opLabel)\(((?:[^)]|\n)*?)\)/g)) {
      // 只取这些函数调用里出现的 `'a.b'` 形状的 key 字面量
      for (const key of match[1].matchAll(/'([a-z][a-zA-Z]*\.[a-zA-Z.]+)'/g)) used.add(key[1])
    }
    for (const match of code.matchAll(/:\s*'([a-z][a-zA-Z]*\.[a-zA-Z.]+)'/g)) used.add(match[1])
  }
  const missing = [...used].filter((key) => !KEYS.has(key))
  assert.deepEqual(missing, [], '引用了不存在的 locale key：' + missing.join(', '))
  assert.ok(used.size >= 30, '至少应引用 30 个 key，实际 ' + String(used.size))
})

test('源码里没有颜色字面量（颜色只在 tokens.css / styles 的 --tl-* 里）', () => {
  for (const file of SOURCES) {
    const code = stripComments(file.source)
    assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(code), file.path + ' 出现十六进制颜色')
    assert.ok(!/\brgba?\(/.test(code), file.path + ' 出现 rgb() 颜色')
    assert.ok(!/\bhsla?\(/.test(code), file.path + ' 出现 hsl() 颜色')
    assert.ok(!/localStorage|sessionStorage|indexedDB|document\.cookie/.test(code), file.path + ' 出现浏览器存储')
    assert.ok(!/navigator\.clipboard|execCommand/.test(code), file.path + ' 出现剪贴板写入')
  }
})

test('两份 CSS：所有选择器挂 .threadline-app 前缀', () => {
  for (const name of ['turns.css', 'inspector.css']) {
    const css = readFileSync(join(STYLE_ROOT, name), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    const selectors = [...css.matchAll(/(^|\})\s*([^{}@]+)\{/g)].map((match) => match[2].trim()).filter((item) => item !== '')
    for (const selector of selectors) {
      for (const part of selector.split(',')) {
        const trimmed = part.trim()
        if (trimmed === '') continue
        assert.ok(trimmed.startsWith('.threadline-app'), name + ' 的选择器没有前缀：' + trimmed)
      }
    }
  }
})

test('两份 CSS：无颜色字面量、无 !important、无 viewport media query', () => {
  for (const name of ['turns.css', 'inspector.css']) {
    const css = readFileSync(join(STYLE_ROOT, name), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(css), name + ' 出现十六进制颜色')
    assert.ok(!/\brgba?\(/.test(css), name + ' 出现 rgb() 颜色')
    assert.ok(!css.includes('!important'), name + ' 出现 !important')
    assert.ok(!/@media/.test(css), name + ' 出现 viewport media query（应用容器查询）')
    assert.ok(css.includes('@container threadline'), name + ' 缺容器查询（03 §14）')
    for (const match of css.matchAll(/@container\s+threadline\s+\(([^)]+)\)/g)) {
      assert.match(match[1], /(max|min)-width:/, name + ' 的容器查询条件不合法：' + match[1])
    }
  }
})

test('两份 CSS：样式注入表里真的包含它们（emit-styles 纳入）', () => {
  const module = readFileSync(join(STYLE_ROOT, 'css.ts'), 'utf8')
  assert.ok(module.includes('threadline/turns.css'), 'css.ts 未包含 turns.css（跑 node tests/harness/emit-styles.mjs）')
  assert.ok(module.includes('threadline/inspector.css'), 'css.ts 未包含 inspector.css（跑 node tests/harness/emit-styles.mjs）')
})
