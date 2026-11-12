/*
 * tests/entries/reasoning-surface.test.ts —— 思维链 tab 的**样式根 + 会话表面**守卫
 * （1.5.2「白板」与 1.5.5「输入框露出」两次真机缺陷的回归武器）。
 *
 * 历史与根因：
 * - 1.5.2：`styles/reasoning.css` 的规则全部写成
 *   `:is(.threadline-app, .threadline-impact-root) .tl-reasoning …`，
 *   `tokens.css` 的 `--tl-*` 只在 `.threadline-app` 作用域里定义；而思维链把自己的根
 *   直接渲染成 `class="tl-reasoning"`，**没有这层祖先** → 选择器全部落空、变量全 undefined。
 * - 1.5.5：思维链只补了类名，**没有** `useComposerSurface`、也没有同步宿主可视高度 →
 *   真机上页面底部仍然露出会话输入框（`block-size:100%` 替代不了宿主高度测量）。
 *
 * 为什么原测试没抓到第一个：harness 的 `reasoning.entry.ts` 自己给 host 加了
 * `threadline-app` 类（夹具替产品补了那一层），所以永远是绿的。
 *
 * 1.5.5 起两个 tab 共用 `ConversationSurface`（唯一实现），根由它提供。因此这条套件改成
 * 断言**两件事**，比原来更严：
 * 1. 思维链入口必须经过 `ConversationSurface`（不能自己拼一个"看起来像"的根）；
 * 2. `ConversationSurface` 必须真的提供 `threadline-app` 根 + `data-threadline-app` 标记，
 *    且必须调用 `useComposerSurface`、必须同步宿主可视高度。
 *
 * 另外守住：脉络 tab 也必须走同一个表面（否则就是又回到"两份手写逻辑各自漂移"）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PLUGIN_ROOT } from '../harness/styles-codegen.ts'

const ENTRY = readFileSync(join(PLUGIN_ROOT, 'src', 'client', 'entries', 'reasoning.ts'), 'utf8')
const TAB = readFileSync(join(PLUGIN_ROOT, 'src', 'client', 'entries', 'tab.ts'), 'utf8')
const SURFACE = readFileSync(join(PLUGIN_ROOT, 'src', 'client', 'ui', 'shell', 'ConversationSurface.ts'), 'utf8')
const FIXTURE = readFileSync(join(PLUGIN_ROOT, 'tests', 'harness', 'entries', 'reasoning.entry.ts'), 'utf8')
const CSS = readFileSync(join(PLUGIN_ROOT, 'src', 'client', 'styles', 'reasoning.css'), 'utf8')

/** 去掉注释，避免注释里的示例代码干扰判断。 */
function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

test('共用表面必须提供 .threadline-app 根与 data-threadline-app 标记', () => {
  const code = stripComments(SURFACE)
  assert.match(code, /threadline-app/, 'ConversationSurface 必须提供 .threadline-app 根，否则 reasoning.css 全部选择器落空')
  assert.match(code, /'data-threadline-app'/, '根上还要带 data-threadline-app 标记（与脉络 tab 同口径）')
  /* 根类名必须真的进 className（不是只出现在注释或常量名里）。 */
  assert.match(code, /className:\s*classesOf\(/, 'className 必须由 classesOf 生成（根类名与额外类名合并的地方）')
})

test('共用表面必须真的隐藏 composer 并同步宿主可视高度（1.5.5 缺陷）', () => {
  const code = stripComments(SURFACE)
  assert.match(code, /useComposerSurface\(/, '必须调用 useComposerSurface —— 否则宿主输入框继续占位（本次真机缺陷）')
  assert.match(code, /\[data-conversation-scroll\]/, '必须找到宿主滚动容器')
  assert.match(code, /clientHeight/, '必须读宿主可视高度')
  assert.match(code, /blockSize/, '必须把 surface 固定到宿主可视高度（block-size:100% 拿不到这个高度）')
})

test('思维链入口必须经过共用表面（不能自己手写一份）', () => {
  const code = stripComments(ENTRY)
  assert.match(code, /ConversationSurface/, '思维链入口必须使用 ConversationSurface')
  /* 两条 return 都要包在 ReasoningSurface 里。 */
  const surfaceUses = [...code.matchAll(/h\(\s*ReasoningSurface/g)].length
  assert.ok(surfaceUses >= 2, '空态与有数据两条分支都必须经过 ReasoningSurface，实际 ' + String(surfaceUses))

  /* 反向：不允许再出现「裸 tl-reasoning 根」作为入口 return 的第一层。 */
  assert.equal(
    /return h\(\s*'div',\s*\{ className: 'tl-reasoning'/.test(code),
    false,
    '不允许再把 tl-reasoning 直接当根（那正是 1.5.2 缺陷）',
  )
})

test('脉络 tab 也走同一个表面（禁止两份手写逻辑各自漂移）', () => {
  const code = stripComments(TAB)
  assert.match(code, /import \{[^}]*ConversationSurface[^}]*\} from '\.\.\/ui\/shell\/index\.ts'/, 'tab.ts 必须从 shell 出口引入 ConversationSurface')
  assert.match(code, /h\(\s*ConversationSurface/, '脉络 tab 的根必须是 ConversationSurface')
  /* 反向：旧的第二份实现必须已删除（1.5.5 单一执行路径）。 */
  assert.equal(
    /useComposerSurface\(/.test(code),
    false,
    'tab.ts 不得再自己调用 useComposerSurface（那是第二份实现，已经收敛进 ConversationSurface）',
  )
  assert.equal(
    /surfaceRef/.test(code),
    false,
    'tab.ts 不得再保留自己的 surfaceRef（根节点与高度同步都已收敛）',
  )
})

test('CSS 的规则确实依赖这条祖先（说明守卫不是多余的）', () => {
  /* 绝大多数规则都挂 .threadline-app 前缀 —— 这是"根必须有"的另一面证据。 */
  const prefixed = [...CSS.matchAll(/^:is\(\.threadline-app/gm)].length
  assert.ok(prefixed > 50, 'reasoning.css 里应当有大量 .threadline-app 前缀规则，实际 ' + String(prefixed))
  /* 与 tokens 变量只在 .threadline-app 作用域定义。 */
  const TOKENS = readFileSync(join(PLUGIN_ROOT, 'src', 'client', 'styles', 'tokens.css'), 'utf8')
  assert.match(TOKENS, /\.threadline-app\s*\{/, 'tokens.css 的容器根/变量作用域必须在 .threadline-app 中')
})

test('harness 夹具也必须保留 threadline-app（否则会再次掩盖同类缺陷）', () => {
  const code = stripComments(FIXTURE)
  assert.match(code, /className = 'threadline-app'|className: 'threadline-app'/, '夹具必须给 host 挂 threadline-app')
})
