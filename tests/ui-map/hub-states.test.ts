/*
 * tests/ui-map/hub-states.test.ts —— 文件夹枢纽的三种视觉状态必须可区分（1.5.2 真机缺陷）。
 *
 * 真机现象（用户原话）：「鼠标悬浮、单击在文件夹上没有对应反馈」「.dsh 和 .github 永远处于选中状态」。
 *
 * 三个真实缺陷：
 * 1. hover 规则与 `[data-hub-linked='true']` 规则**特异性相同**，而 linked 规则写在后面 →
 *    hover 的描边被覆盖 → 有关系（真机上大部分）的枢纽 hover 时 stroke-width 恒为 1.4px。
 * 2. `map.css` 里枢纽 `[data-selected]` 规则数 = 0 → 选中态完全没有视觉表达。
 * 3. 关系与选中都用「强调色实线」→ 用户把关系描边误读成"永远被选中"。
 *
 * 修法口径（用户已确认）：**选中 = 底色 + 粗实线；关系改线型区分（虚线/点线）**。
 * 这条套件对 CSS 源码断言，防止下次又用"同特异性、靠顺序"的写法把状态吃掉。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PLUGIN_ROOT } from '../harness/styles-codegen.ts'

const CSS = readFileSync(join(PLUGIN_ROOT, 'src', 'client', 'styles', 'map.css'), 'utf8')
const FOLDER_MAP = readFileSync(join(PLUGIN_ROOT, 'src', 'client', 'ui', 'map', 'FolderMap.ts'), 'utf8')
const TAB = readFileSync(join(PLUGIN_ROOT, 'src', 'client', 'entries', 'tab.ts'), 'utf8')

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

/** 取某选择器块里的声明文本（第一个匹配）。 */
function ruleBody(css: string, selector: RegExp): string | null {
  const match = selector.exec(css)
  return match === null ? null : match[1]
}

const CODE = stripComments(CSS)

test('枢纽必须有 [data-selected] 样式（原来规则数为 0）', () => {
  const selectedBits = [...CODE.matchAll(/\.tl-foldhub\[data-selected='true'\]/g)]
  assert.ok(selectedBits.length >= 1, '缺少 .tl-foldhub[data-selected] 规则 —— 选中态没有任何视觉表达')
  const body = ruleBody(CODE, /\.tl-foldhub\[data-selected='true'\]\s*\.tl-foldhub-card\s*\{([^}]*)\}/)
  assert.ok(body !== null, '选中样式必须作用在卡片上')
  assert.match(body as string, /stroke-width:\s*2\.2/, '选中描边必须比 hover(2px) 更粗')
  assert.match(body as string, /fill:\s*var\(--tl-active\)/, '选中必须有底色（与 hover 的 --tl-hover 区分）')
})

test('关系状态改用线型区分，不再与选中态撞成"实线强调色"', () => {
  const linked = ruleBody(CODE, /\.tl-foldhub\[data-hub-linked='true'\]\s*\.tl-foldhub-card\s*\{([^}]*)\}/)
  assert.ok(linked !== null, '缺少「有关系」规则')
  assert.match(linked as string, /stroke-dasharray:\s*6\s+3/, '有关系必须用虚线（与选中的实线区分）')

  const plain = ruleBody(CODE, /\.tl-foldhub\[data-hub-linked='false'\]\s*\.tl-foldhub-card\s*\{([^}]*)\}/)
  assert.ok(plain !== null, '缺少「无关系」规则')
  assert.match(plain as string, /stroke-dasharray:\s*3\s+3/, '无关系用更密的点线')
})

test('hover 规则必须写在 linked 之后（同特异性时后写者胜，顺序是语义）', () => {
  const linkedAt = CODE.indexOf(".tl-foldhub[data-hub-linked='true'] .tl-foldhub-card")
  const hoverAt = CODE.indexOf(".tl-foldhub[data-hovered='true'] .tl-foldhub-card")
  assert.ok(linkedAt >= 0 && hoverAt >= 0, '两条规则都必须存在')
  assert.ok(
    hoverAt > linkedAt,
    'hover 必须排在 linked 之后，否则被关系规则的描边覆盖（这就是"hover 没反应"的根因）',
  )
})

test('hover 与选中都必须把虚线清掉（否则三态又糊在一起）', () => {
  const hover = ruleBody(CODE, /\.tl-foldhub:hover\s*\.tl-foldhub-card,\s*\n?:is[^{]*\.tl-foldhub\[data-hovered='true'\]\s*\.tl-foldhub-card\s*\{([^}]*)\}/)
  const hoverAlt = ruleBody(CODE, /\.tl-foldhub\[data-hovered='true'\]\s*\.tl-foldhub-card\s*\{([^}]*)\}/)
  const body = hover ?? hoverAlt
  assert.ok(body !== null, '缺少 hover 规则')
  assert.match(body as string, /stroke-dasharray:\s*none/, 'hover 必须改成实线（清掉虚线）')
})

test('产品侧必须把 onSelectFolder 接到 FolderMap（漏传 = 单击无反应）', () => {
  /* FolderMap 的单击走 props.onSelectFolder?.(hub.path)；tab.ts 不传就永远不生效。 */
  assert.match(FOLDER_MAP, /props\.onSelectFolder\?\.\(/, 'FolderMap 应当用 onSelectFolder 回调（事实源）')
  assert.match(
    TAB,
    /onSelectFolder:\s*selectFolder/,
    'tab.ts 必须在 FileGraph 上接 onSelectFolder，否则单击文件夹没有任何效果',
  )
  assert.match(TAB, /selectedFolderPath:\s*selectedFolder/, 'tab.ts 必须把选中文件夹回传给图')
})
