/*
 * tests/ui-map/rail-columns.test.ts —— 右栏「列表」模式：表头与数据行的列必须一一对应（1.5.2 真机缺陷）。
 *
 * 真机现象：列表模式里「操作」那一列的数字对不齐。
 *
 * 根因：表头有 **5 条** grid 轨道（icon / name / type / size / ops），
 * 而数据行只有 **4 个**子元素 —— `sizeText` 在 `row.sizeText === null` 时**整个不渲染**，
 * 于是后面的 `tl-tree-row-tail` 前移，占掉了 size 轨道，ops 轨道空着。
 * 实测：表头 ops 列 left=1302 right=1346，而行内该区间没有任何元素。
 *
 * 因为只有「大小未知」的文件才会缺这一列，而真机大部分文件都有大小 ——
 * 所以这个错位只在某些行出现，看起来像"个别行没对齐"。
 *
 * 修法：**恒定渲染**该列（无大小时渲染空 span 占位），让列数不随数据变化。
 * 这条套件守住：表头列数 = 行内子元素数（结构上不可漂移）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PLUGIN_ROOT } from '../harness/styles-codegen.ts'

const RAIL = readFileSync(join(PLUGIN_ROOT, 'src', 'client', 'ui', 'rail', 'FileTreeRail.ts'), 'utf8')
const CSS = readFileSync(join(PLUGIN_ROOT, 'src', 'client', 'styles', 'tree.css'), 'utf8')

function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

const CODE = stripComments(RAIL)

test('size 列必须恒定渲染（不能在 sizeText 为 null 时整列消失）', () => {
  assert.equal(
    /const sizeText = row\.sizeText === null \? null :/.test(CODE),
    false,
    'sizeText 不能再按"有值才渲染"来写 —— 那会让该行少一个 grid 单元格，后面的列全部前移',
  )
  assert.match(
    CODE,
    /const sizeText = h\('span'/,
    'sizeText 必须无条件渲染一个 span（无大小时留空占位）',
  )
})

test('列表行（list 变体）的子元素数 = 表头列数（5）', () => {
  /* 取出 list 变体的 return h(...) 块。 */
  const start = CODE.indexOf("variant === 'list'")
  assert.ok(start >= 0, '找不到 list 变体分支')
  const block = CODE.slice(start, start + 900)
  const returnAt = block.indexOf('return h(')
  assert.ok(returnAt >= 0, '找不到 list 变体的 return')
  const tail = block.slice(returnAt, returnAt + 500)

  /* list 变体的直接子元素：glyph / name / type / sizeText / tailCell —— 共 5 个。
   * 1.5.3：最后一项从"内联构造的 row-tail"改成预先构造的 `tailCell`
   *（它内部再分色点/操作两个固定子槽，见 rail-tail.test.ts）。 */
  const children = ['glyph', 'name', 'type', 'sizeText', 'tailCell']
  for (const child of children) {
    assert.ok(tail.includes(child), 'list 行必须包含子元素：' + child)
  }
})

test('表头恰好 5 列，且与 --tl-tree-cols 的轨道数一致', () => {
  const headBlock = CODE.slice(CODE.indexOf("className: 'tl-tree-thead'"), CODE.indexOf("className: 'tl-tree-thead'") + 1400)
  const thCount = [...headBlock.matchAll(/className: 'tl-tree-th'/g)].length
  assert.equal(thCount, 5, '表头必须是 5 列（icon/name/type/size/ops），实际 ' + String(thCount))

  const cols = /--tl-tree-cols:\s*([^;]+);/.exec(stripComments(CSS))
  assert.ok(cols !== null, 'tree.css 必须定义 --tl-tree-cols')
  const tracks = (cols as RegExpExecArray)[1].trim().split(/\s+(?![^(]*\))/).length
  assert.equal(tracks, 5, '宽栏的 --tl-tree-cols 也必须是 5 条轨道，实际 ' + String(tracks) + ' 条：' + (cols as RegExpExecArray)[1].trim())
})

test('表头与数据行共用同一条轨道变量（不接受两套写法）', () => {
  const thead = /\.tl-tree-thead\s*\{([^}]*)\}/.exec(stripComments(CSS))
  const row = /\.tl-tree-row\s*\{([^}]*)\}/.exec(stripComments(CSS))
  assert.ok(thead !== null && row !== null, '表头与行都必须有样式块')
  assert.match((thead as RegExpExecArray)[1], /grid-template-columns:\s*var\(--tl-tree-cols\)/)
  assert.match((row as RegExpExecArray)[1], /grid-template-columns:\s*var\(--tl-tree-cols\)/)
})
