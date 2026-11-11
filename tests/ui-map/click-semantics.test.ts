/*
 * tests/ui-map/click-semantics.test.ts —— 单击幂等 / 双击进入（D-35 需求 10a）。
 *
 * 为什么不能只测几何或"有没有 dblclick"：
 * 这个 bug 的本质是**事件序列**——双击会派发两次 click + 一次 dblclick，
 * 如果 click 是 toggle，第二次就把选中取消了，于是"选中→取消→进入"，
 * 用户看到的是节点闪一下。因此必须断言：
 *   1. 选中回调对同一目标是**幂等**的（不清空）；
 *   2. 目录进入只挂在 dblclick（以及 Shift+Enter 等价路径）上；
 *   3. 取消只由 blank / Esc 驱动。
 *
 * 这里读源码做结构断言（React 组件无法在 node 环境里跑真实事件循环），
 * 与之对应的事件序列行为由 tests/harness/run-interaction.mjs 在浏览器里验证。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PLUGIN_ROOT } from '../harness/styles-codegen.ts'

function read(relative: string): string {
  return readFileSync(join(PLUGIN_ROOT, relative), 'utf8')
}

test('tab 的文件选中是幂等的：同一路径直接 return，不 toggle 成 blank', () => {
  const source = read('src/client/entries/tab.ts')
  const match = /const selectFile = React\.useCallback\(([\s\S]*?)\n  \)/.exec(source)
  assert.ok(match !== null, '找不到 selectFile')
  const body = match[1]
  assert.match(body, /if \(path === selectedPath\) return/, '必须提前 return（幂等），不能走 blank')
  /* 反向：同一分支里不得调用 blank 选择（旧实现的 toggle）。 */
  const idempotentBranch = /if \(path === selectedPath\)[\s\S]{0,120}?return/.exec(body)
  assert.ok(idempotentBranch !== null)
  assert.equal(
    /type: 'blank'/.test(idempotentBranch[0]),
    false,
    '幂等分支里不得清空选中（那正是双击被打断的根因）',
  )
})

test('文件夹单击/双击分离：进入只由 dblclick 或 Shift+Enter 触发', () => {
  const folderMap = read('src/client/ui/map/FolderMap.ts')
  /* 枢纽必须有 onDoubleClick。 */
  assert.match(folderMap, /onDoubleClick[\s\S]{0,200}?props\.onEnterFolder/, '枢纽双击必须进入目录')
  /* 单击分支里不得直接进入目录。 */
  const hubClick = /onClick: \(event: React\.MouseEvent\) => \{([\s\S]*?)\n        \}/.exec(folderMap)
  assert.ok(hubClick !== null, '找不到枢纽 onClick')
  assert.equal(
    /onEnterFolder/.test(hubClick[1]),
    false,
    '单击不得直接进入目录（那会让双击无法成立）',
  )
  assert.match(hubClick[1], /onSelectFolder/, '单击必须是选中')
})

test('右栏同样分离：activate 只选中，进入走 onEnter', () => {
  const rail = read('src/client/ui/rail/FileTreeRail.ts')
  const activate = /const activate = React\.useCallback\(([\s\S]*?)\n  \)/.exec(rail)
  assert.ok(activate !== null, '找不到 activate')
  assert.equal(/onNavigate/.test(activate[1]), false, 'activate 不得直接导航（单击只选中）')
  assert.match(activate[1], /onSelectFile/, 'activate 必须选中')
  assert.match(rail, /onDoubleClick[\s\S]{0,200}?onEnter/, '双击必须进入目录')
})

test('取消选中只由空白 / Esc 驱动（有明确入口）', () => {
  const tab = read('src/client/entries/tab.ts')
  assert.match(tab, /type: 'blank'/, '必须存在 blank 取消路径')
  assert.match(tab, /escapeSelection/, '必须存在 Esc 逐层退出')
})
