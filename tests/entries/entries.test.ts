/*
 * tests/entries/entries.test.ts —— 总装配 + 入口清单（06 A43-5 / N-19；T32 新契约）。
 *
 * T32（2026-11-05 notes/33 §1/§7）：`/threadline` 弹窗删除后只剩**两个 slot 表面**：
 * `conversation.view`（tab）+ `conversation.chat.assistant-actions`（影响）；
 * 命令入口（`inputTriggers`）不是 slot。旧断言「恰好三个 slot / 必须注入 modal.css」测的是被删除的弹窗表面，
 * 已替换为：两个 slot、每个 css.ts 里的样式表都真的注入（与生成物口径一致）、源码里 0 处 overlay/modal 引用。
 *
 * 覆盖：
 * - `apply(ctx)` 注册**恰好两个** slot（tab / 影响 N），不碰 main / sidebar.panellist / sidebar.right.pane.tab；
 * - 样式注入走唯一路径，卸载后 `<style>` 归 0；
 * - slots 缺失只 warn 不崩；
 * - 只读审计：无写文件、无浏览器存储、无 session.prompt/cancel、无外部网络请求；
 * - 单一执行路径：源码里没有 `conversation.input.overlay` 注册、没有 ui/modal 导入。
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
/* D-35：`conversation.view` 现在承载**两个 tab**（脉络 + 思维链），因此按 "名字×次数" 校验。
 * 其余约束不变：仍然不许出现 main / 右栏 / 侧栏面板 / input.overlay。 */
const ALLOWED_SLOTS = ['conversation.view', 'conversation.view', 'conversation.chat.assistant-actions']
const FORBIDDEN_SLOTS = ['sidebar.panellist', 'sidebar.right.pane.tab', 'conversation.chat.turnTail', 'plugins.bundle.config', 'conversation.input.overlay']

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
const T09_DIRS = [join(CLIENT_ROOT, 'entries'), join(CLIENT_ROOT, 'state')]
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

test('apply：注册恰好两个 slot，名字只允许这两个（无 main / 无右栏 / 无侧栏面板 / 无 input.overlay）', () => {
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
    // 逐张表断言（不再点名 modal.css：弹窗样式已随 T32 删除；这里只要求"生成物里的每一张都注入"，
    // 与 css.ts 的生成口径一致，等 map-dev/Lead 重建 css.ts 后自动收敛到删表后的集合）。
    assert.equal(dom.liveStyles().length, STYLE_SHEETS.length, '每个样式表一个 <style>')
    for (const sheet of STYLE_SHEETS) {
      assert.ok(
        dom.liveStyles().some((el) => el.attrs['data-plugin-css'] === sheet.key),
        '样式表未注入：' + sheet.key,
      )
    }
    assert.ok(dom.liveStyles().some((el) => el.attrs['data-plugin-css'] === 'threadline/turns.css'))
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

test('A43-5：禁用 slot 一个都不出现；两个 tab 都真的注册了 conversation.view', () => {
  const found = new Set<string>()
  for (const source of SOURCES) {
    for (const slot of [...ALLOWED_SLOTS, ...FORBIDDEN_SLOTS]) {
      if (source.text.includes("'" + slot + "'")) found.add(slot)
    }
  }
  const forbiddenFound = [...found].filter((slot) => FORBIDDEN_SLOTS.includes(slot))
  assert.deepEqual(forbiddenFound, [], '源码里出现禁用 slot：' + forbiddenFound.join(', '))
  assert.equal(found.has('conversation.view'), true, 'tab 必须注册 conversation.view')
  assert.equal(found.has('conversation.chat.assistant-actions'), true, '影响入口必须注册 assistant-actions')

  /* 去重集合看不出"两个 tab"，这里显式数一遍注册次数（脉络 + 思维链）。 */
  let viewRegistrations = 0
  for (const source of SOURCES) {
    const matches = source.text.match(/'conversation\.view'/g)
    if (matches !== null) viewRegistrations += matches.length
  }
  assert.equal(viewRegistrations, 2, '必须恰好两个 conversation.view 注册（脉络 + 思维链）')
  assert.equal(found.has('conversation.input.overlay'), false, 'T32：input.overlay 不再注册')
})

test('T32 单一执行路径：源码里没有 ui/modal 导入、没有 overlay/modal 组件引用', () => {
  const modalImport = /from\s+'[^']*ui\/modal/
  const modalExports = /ThreadlineOverlay|OverlaySlotProps|ThreadlineModal|useModalState|resetModalStore|closeModal|openModal\s*\(/
  const offenders: string[] = []
  for (const source of SOURCES) {
    const code = stripComments(source.text)
    if (modalImport.test(code)) offenders.push(source.file + ' 仍 import ui/modal')
    const hit = modalExports.exec(code)
    if (hit !== null) offenders.push(source.file + ' 仍引用弹窗符号 ' + String(hit[0]))
  }
  assert.deepEqual(offenders, [], offenders.join(' | '))
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
