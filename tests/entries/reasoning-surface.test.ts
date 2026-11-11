/*
 * tests/entries/reasoning-surface.test.ts —— 思维链 tab 的**样式根**守卫（1.5.2 真机缺陷）。
 *
 * 真机现象：思维链页是浏览器默认控件（下拉框、裸按钮、纯黑矩形），完全没有样式。
 *
 * 根因：`styles/reasoning.css` 的规则全部写成
 *   `:is(.threadline-app, .threadline-impact-root) .tl-reasoning …`
 * 且 `tokens.css` 的 `--tl-*` 只在 `.threadline-app` 作用域里定义；
 * 而思维链把自己的根节点直接渲染成 `class="tl-reasoning"`，**没有这层祖先** →
 * 选择器全部落空、变量全部 undefined。
 *
 * 为什么原来的测试没抓到：harness 的 `reasoning.entry.ts` 自己给 host 加了
 * `threadline-app` 类（夹具替产品补了那一层），所以永远是绿的。
 *
 * 这条套件直接对**入口源码**断言三件事：
 * 1. 入口渲染的根必须带 `threadline-app`（不能只靠夹具）；
 * 2. 有数据 / 空态两条分支都必须经过这个根；
 * 3. 夹具自己也必须保留那一层（否则下次有人删掉夹具的类，又会掩盖同类问题）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PLUGIN_ROOT } from '../harness/styles-codegen.ts'

const ENTRY = readFileSync(join(PLUGIN_ROOT, 'src', 'client', 'entries', 'reasoning.ts'), 'utf8')
const FIXTURE = readFileSync(join(PLUGIN_ROOT, 'tests', 'harness', 'entries', 'reasoning.entry.ts'), 'utf8')
const CSS = readFileSync(join(PLUGIN_ROOT, 'src', 'client', 'styles', 'reasoning.css'), 'utf8')

/** 去掉注释，避免注释里的示例代码干扰判断。 */
function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

test('入口必须自己渲染 .threadline-app 根（不能依赖夹具补）', () => {
  const code = stripComments(ENTRY)
  assert.match(
    code,
    /className:\s*'threadline-app'/,
    '思维链入口必须渲染一个 class="threadline-app" 的根，否则 reasoning.css 全部选择器落空',
  )
  assert.match(code, /'data-threadline-app'/, '根上还要带 data-threadline-app 标记（与脉络 tab 同口径）')
})

test('有数据 / 空态两条分支都必须经过同一个样式根', () => {
  const code = stripComments(ENTRY)
  /* 两条 return 都要包在 ReasoningSurface 里。 */
  const surfaceUses = [...code.matchAll(/h\(\s*ReasoningSurface/g)].length
  assert.ok(surfaceUses >= 2, '空态与有数据两条分支都必须经过 ReasoningSurface，实际 ' + String(surfaceUses))

  /* 反向：不允许再出现「裸 tl-reasoning 根」作为入口 return 的第一层。 */
  assert.equal(
    /return h\(\s*'div',\s*\{ className: 'tl-reasoning'/.test(code),
    false,
    '不允许再把 tl-reasoning 直接当根（那正是本次缺陷）',
  )
})

test('CSS 的规则确实依赖这条祖先（说明守卫不是多余的）', () => {
  /* 绝大多数规则都挂 .threadline-app 前缀 —— 这是"根必须有它"的另一面证据。 */
  const prefixed = [...CSS.matchAll(/^:is\(\.threadline-app/gm)].length
  assert.ok(prefixed > 50, 'reasoning.css 里应当有大量 .threadline-app 前缀规则，实际 ' + String(prefixed))
  /* 且 tokens 变量只在 .threadline-app 作用域定义。 */
  const TOKENS = readFileSync(join(PLUGIN_ROOT, 'src', 'client', 'styles', 'tokens.css'), 'utf8')
  assert.match(TOKENS, /\.threadline-app\s*\{/, 'tokens.css 的容器根/变量作用域必须在 .threadline-app 上')
})

test('harness 夹具也必须保留 threadline-app（否则会再次掩盖同类缺陷）', () => {
  const code = stripComments(FIXTURE)
  assert.match(code, /className = 'threadline-app'|className: 'threadline-app'/, '夹具必须给 host 挂 threadline-app')
})
