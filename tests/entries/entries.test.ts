/*
 * tests/entries/entries.test.ts —— 总装配 + 入口清单（06 A43-5 / N-19）。
 *
 * 覆盖：
 * - `apply(ctx)` 注册**恰好三个** slot（tab / 影响 N / 弹窗），不碰 main / sidebar.panellist / sidebar.right.pane.tab；
 * - 样式注入走唯一路径，卸载后 `<style>` 归 0；
 * - slots 缺失只 warn 不崩；
 * - 只读审计：无写文件、无浏览器存储、无 session.prompt/cancel、无外部网络请求。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { PLUGIN_ROOT } from '../harness/styles-codegen.ts'
import { STYLE_SHEETS } from '../../src/client/styles/css.ts'
import { apply, inject, name } from '../../src/client/index.ts'
import { createFakeCtx, createFakeInputTriggers } from './fake-ctx.ts'
import { createStyleDocument } from './fake-dom.ts'

const CLIENT_ROOT = join(PLUGIN_ROOT, 'src', 'client')
const ALLOWED_SLOTS = ['conversation.view', 'conversation.chat.assistant-actions', 'conversation.input.overlay']
const FORBIDDEN_SLOTS = ['sidebar.panellist', 'sidebar.right.pane.tab', 'conversation.chat.turnTail', 'plugins.bundle.config']

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (full.endsWith('.ts')) out.push(full)
  }
  return out
}

const SOURCES = walk(CLIENT_ROOT).map((file) => ({ file, text: readFileSync(file, 'utf8') }))

/** T09 自己拥有的路径（只读审计只看这些；其它区域的审计由 T10/T11 负责）。 */
const T09_DIRS = [join(CLIENT_ROOT, 'entries'), join(CLIENT_ROOT, 'state'), join(CLIENT_ROOT, 'ui', 'modal')]
const OWN_SOURCES = [
  { file: join(CLIENT_ROOT, 'index.ts'), text: readFileSync(join(CLIENT_ROOT, 'index.ts'), 'utf8') },
  ...T09_DIRS.flatMap((dir) => walk(dir)).map((file) => ({ file, text: readFileSync(file, 'utf8') })),
]

/** 去掉注释再扫（注释里写"不写 localStorage"是允许的）。 */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

test('模块导出：name = 包名，inject = ["slots"]', () => {
  assert.equal(name, 'dsh-plugin-control-your-development')
  assert.deepEqual(inject, ['slots'])
})

test('apply：注册恰好三个 slot，名字只允许这三个（无 main / 无右栏 / 无侧栏面板）', () => {
  const triggers = createFakeInputTriggers()
  const fake = createFakeCtx({ services: { inputTriggers: triggers.service } })
  const dom = createStyleDocument()
  ;(globalThis as unknown as { document: Document }).document = dom.document
  try {
    apply(fake.ctx)
  } finally {
    delete (globalThis as unknown as { document?: Document }).document
  }

  const names = fake.entries.map((entry) => entry.name).sort()
  assert.deepEqual(names, [...ALLOWED_SLOTS].sort())
  for (const forbidden of FORBIDDEN_SLOTS) {
    assert.equal(names.includes(forbidden), false, '不允许注册 ' + forbidden)
  }
  for (const entry of fake.entries) {
    assert.equal(typeof entry.options.id, 'string', entry.name + ' 必须有 id')
  }
})

test('apply：样式经唯一注入路径写入，卸载后 <style> 归 0', () => {
  const triggers = createFakeInputTriggers()
  const fake = createFakeCtx({ services: { inputTriggers: triggers.service } })
  const dom = createStyleDocument()
  ;(globalThis as unknown as { document: Document }).document = dom.document
  try {
    apply(fake.ctx)
    assert.equal(dom.liveStyles().length, STYLE_SHEETS.length, '每个样式表一个 <style>')
    assert.ok(dom.liveStyles().some((el) => el.attrs['data-plugin-css'] === 'threadline/turns.css'))
    assert.ok(dom.liveStyles().some((el) => el.attrs['data-plugin-css'] === 'threadline/inspector.css'))
    assert.ok(dom.liveStyles().some((el) => el.attrs['data-plugin-css'] === 'threadline/modal.css'))
    fake.disposeAll()
    assert.equal(dom.liveStyles().length, 0, '卸载后不得留 <style>')
  } finally {
    delete (globalThis as unknown as { document?: Document }).document
  }
})

test('apply：slots 缺失只 warn、不抛错（旧版宿主，06 N-19）', () => {
  const fake = createFakeCtx({ withSlots: false })
  assert.doesNotThrow(() => apply(fake.ctx))
  assert.ok(fake.logs.some((line) => line.level === 'warn' && line.message.includes('slots')))
})

test('A43-5：源码里出现的 slot 名字只有三个（grep 级断言）', () => {
  const found = new Set<string>()
  for (const source of SOURCES) {
    for (const slot of [...ALLOWED_SLOTS, ...FORBIDDEN_SLOTS]) {
      if (source.text.includes("'" + slot + "'")) found.add(slot)
    }
  }
  const forbiddenFound = [...found].filter((slot) => FORBIDDEN_SLOTS.includes(slot))
  assert.deepEqual(forbiddenFound, [], '源码里出现禁用 slot：' + forbiddenFound.join(', '))
  const allowedFound = [...found].filter((slot) => ALLOWED_SLOTS.includes(slot))
  assert.deepEqual(allowedFound.sort(), [...ALLOWED_SLOTS].sort(), '三个入口都要真的出现在源码里')
})

test('只读审计：无写文件 / 无浏览器存储 / 无 session.prompt|cancel / 无外部网络', () => {
  const patterns: Array<{ label: string; regex: RegExp }> = [
    { label: '写文件', regex: /writeFile|appendFile|createWriteStream|unlinkSync|renameSync|rmSync/ },
    { label: '浏览器存储', regex: /localStorage|sessionStorage|indexedDB|document\.cookie/ },
    { label: '运行控制', regex: /session\.prompt|session\.cancel|session\.resume|tools\.register/ },
    { label: '外部网络', regex: /fetch\(\s*['"`]https?:\/\// },
    { label: '剪贴板写入', regex: /navigator\.clipboard|execCommand/ },
  ]
  for (const source of OWN_SOURCES) {
    const code = stripComments(source.text)
    for (const pattern of patterns) {
      const hit = pattern.regex.exec(code)
      assert.equal(hit, null, source.file + ' 命中「' + pattern.label + '」：' + String(hit?.[0]))
    }
  }
})
