/*
 * tests/ui-map/rail-tail.test.ts —— 右栏列表「行尾」三类内容必须对齐（1.5.3 真机反馈）。
 *
 * 真机反馈：列表里「操作」这一列看起来没对齐，"很奇怪"。
 *
 * 根因（实测坐标）：
 *   行尾 `tl-tree-row-tail` 是 `[familyDot, currentBadge, opsBadge]` 右对齐的一行。
 *   - 目录行：没有 opsBadge → 色彩点被推到最右（1340–1346）
 *   - 文件行：有 opsBadge → 色彩点被挤到左边（1318–1324）
 *   同一个"色彩点"在两类行之间跳 22px —— 视觉上就是"没对齐"。
 *
 * 修法：把行尾拆成**固定两条轨道**（色彩点列 + 操作列），
 * 让色彩点始终落在同一 x，操作徽标也始终落在同一 x；没有徽标的行留空占位。
 *
 * 这条套件守：行尾必须是两个独立子元素（而不是一个 flex 行里挤），
 * 且 CSS 用固定宽度而不是靠 gap 自动推。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PLUGIN_ROOT } from '../harness/styles-codegen.ts'

const RAIL = readFileSync(join(PLUGIN_ROOT, 'src', 'client', 'ui', 'rail', 'FileTreeRail.ts'), 'utf8')
const CSS = readFileSync(join(PLUGIN_ROOT, 'src', 'client', 'styles', 'tree.css'), 'utf8')

function strip(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

const CODE = strip(RAIL)
const CSS_CODE = strip(CSS)

test('行尾内部必须分成「色点子槽 + 操作子槽」两个固定子槽', () => {
  /* 第 5 条 grid 轨道内部再分两槽：色点位置跨行恒定，操作徽标右对齐。 */
  assert.match(CODE, /className: 'tl-tree-tail-dot'/, '必须有色点子槽')
  assert.match(CODE, /className: 'tl-tree-tail-ops'/, '必须有操作子槽')
  /* 两者都必须包在 tl-tree-row-tail 里（第 5 条轨道内），不能各自占独立 grid 轨道。 */
  const tail = /className: 'tl-tree-row-tail'[\s\S]{0,400}/.exec(CODE)
  assert.ok(tail !== null, '必须保留 tl-tree-row-tail 作为第 5 条轨道的占位')
  assert.ok(tail[0].includes("tl-tree-tail-dot"), '色点子槽必须在 row-tail 内部')
  assert.ok(tail[0].includes("tl-tree-tail-ops"), '操作子槽必须在 row-tail 内部')
})

test('无论有没有 ops，两个子槽都必须渲染（列不能随数据消失）', () => {
  const cell = /const tailCell = h\([\s\S]{0,600}?\)\n/.exec(CODE)
  assert.ok(cell !== null, 'tailCell 必须构造出来')
  assert.match(cell[0], /'tl-tree-tail-dot'/, 'tailCell 内必须有色点子槽')
  assert.match(cell[0], /'tl-tree-tail-ops'/, 'tailCell 内必须有操作子槽')
  /* opsBadge 为 null 时仍然渲染子槽，只是内容为空。 */
  assert.match(cell[0], /opsBadge\)/, '操作子槽必须无条件渲染并接纳可能为 null 的徽标')
})

test('CSS 给两个占位固定宽度（不靠 gap 自动推）', () => {
  assert.match(CSS_CODE, /\.tl-tree-tail-dot\s*\{[^}]*inline-size:\s*\d+px/s, '色点占位必须固定宽度')
  assert.match(CSS_CODE, /\.tl-tree-tail-ops\s*\{[^}]*inline-size:\s*\d+px/s, '操作占位必须固定宽度')
  assert.match(CSS_CODE, /\.tl-tree-tail-dot\s*\{[^}]*justify-content:\s*(center|end)/s, '色点在占位内要居中/右对齐')
  assert.match(CSS_CODE, /\.tl-tree-tail-ops\s*\{[^}]*justify-content:\s*end/s, '操作徽标在占位内右对齐')
})
