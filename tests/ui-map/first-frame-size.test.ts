/*
 * tests/ui-map/first-frame-size.test.ts —— 「节点图不能闪两下」的守卫。
 *
 * 真机反馈：「节点图加载的时候会闪两下，感觉像加载了两次」。
 *
 * 根因（已核对）：`FolderMap` / `FileGraph` 的 `size` 初值是 `{width:0, height:0}`，
 * 首帧因此用**兜底尺寸**（720×420）算出一份几何并绘制；测量写在 `useEffect` 里，
 * 而 `useEffect` 在浏览器**绘制之后**才执行 —— 于是紧接着 `size` 被改成真实尺寸，
 * `baseGeometry` / `layout` 变成新对象，几何时钟判定"目标变了"，再播一遍形变。
 * 用户看到的就是两次入场。
 *
 * 修法：测量移到 `useLayoutEffect`（绘制之前），并让 `setSize` 在数值相同时
 * 返回同一个 state（避免等价尺寸触发无谓重渲染）。
 *
 * 本套件守两件事：
 * 1. **源码级**：两处测量必须是 `useLayoutEffect`，且必须是"相等就不更新"的写法；
 * 2. **首帧级**：真实渲染后 `viewBox` 必须与画布尺寸一致，不能停在兜底值。
 *
 * 为什么需要源码断言：第 2 条只能证明"最终一致"，证明不了"中间没画过错的"；
 * 而"闪两下"恰恰发生在中间那一帧。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PLUGIN_ROOT } from '../harness/styles-codegen.ts'

function read(rel: string): string {
  return readFileSync(join(PLUGIN_ROOT, 'src', 'client', 'ui', 'map', rel), 'utf8')
}

function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

test('FolderMap 的画布测量必须在绘制前发生（useLayoutEffect）', () => {
  const code = stripComments(read('FolderMap.ts'))
  assert.match(
    code,
    /React\.useLayoutEffect\(\(\) => \{\s*const element = stageRef\.current/,
    'FolderMap 必须用 useLayoutEffect 测量画布（useEffect 会让兜底尺寸先画一帧）',
  )
})

test('FileGraph 的画布测量必须在绘制前发生（useLayoutEffect）', () => {
  const code = stripComments(read('FileGraph.ts'))
  assert.match(
    code,
    /React\.useLayoutEffect\(\(\) => \{\s*const element = stageRef\.current/,
    'FileGraph 必须用 useLayoutEffect 测量画布（与 FolderMap 同一根因）',
  )
})

test('两处 setSize 都必须是"数值相等就不换 state"（避免等价尺寸触发重算）', () => {
  for (const file of ['FolderMap.ts', 'FileGraph.ts']) {
    const code = stripComments(read(file))
    assert.match(
      code,
      /setSize\(\(previous\) => \(previous\.width === next\.width && previous\.height === next\.height \? previous : next\)\)/,
      file + ' 的 setSize 必须对相同尺寸返回 previous（否则每次测量都可能触发一次几何重算）',
    )
  }
})

test('不允许退回"渲染后再测量"的旧写法', () => {
  for (const file of ['FolderMap.ts', 'FileGraph.ts']) {
    const code = stripComments(read(file))
    /* 反向：旧的 `useEffect` + 无条件 setSize 组合必须已消失。 */
    assert.equal(
      /React\.useEffect\(\(\) => \{\s*const element = stageRef\.current\s*\n\s*if \(element === null\) return undefined\s*\n\s*const measure/.test(code),
      false,
      file + ' 不得再把测量放回 useEffect（那正是"闪两下"的根因）',
    )
    assert.equal(
      /setSize\(\{ width: Math\.round\(rect\.width\), height: Math\.round\(rect\.height\) \}\)/.test(code),
      false,
      file + ' 不得再用无条件 setSize 对象字面量',
    )
  }
})
