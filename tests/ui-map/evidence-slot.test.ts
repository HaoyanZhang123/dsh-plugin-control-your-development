/*
 * tests/ui-map/evidence-slot.test.ts —— 关系证据必须"真正覆盖"时间线（D-35 需求 10b）。
 *
 * 这条防的是一个**真出过的问题**：
 *   证据槽是 position:absolute + inset:0，但时间线卡片当时是 position:static，
 *   于是证据相对更外层（甚至根）定位 —— 实测尺寸变成视口大小（984×684），
 *   视觉上根本盖不住时间线。
 *
 * 因此光断言"DOM 结构上在时间线里"是不够的（那一直都成立），必须同时断言
 * "时间线建立了定位上下文"。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PLUGIN_ROOT } from '../harness/styles-codegen.ts'

const TIMELINE_CSS = readFileSync(join(PLUGIN_ROOT, 'src', 'client', 'styles', 'timeline.css'), 'utf8')
const MAP_CSS = readFileSync(join(PLUGIN_ROOT, 'src', 'client', 'styles', 'map.css'), 'utf8')

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

test('时间线卡片建立定位上下文（否则证据槽会相对外层定位）', () => {
  const code = stripComments(TIMELINE_CSS)
  /* 匹配 `.threadline-app .threadline-timeline { ... position: relative ... }` */
  const blocks = [...code.matchAll(/([^{}]+)\{([^}]*)\}/g)].filter((match) =>
    match[1].includes('.threadline-timeline'),
  )
  assert.ok(blocks.length > 0, '找不到 .threadline-timeline 规则')
  const hasRelative = blocks.some((match) => /position\s*:\s*relative/.test(match[2]))
  assert.equal(hasRelative, true, '时间线必须 position:relative（证据槽的定位祖先）')

  /* 选择器不得依赖 .threadline-left：那个类不是任何合法结构都有的，
   * 用它会让定位上下文时有时无（这正是第一版修错过的地方）。 */
  const relativeBlocks = blocks.filter((match) => /position\s*:\s*relative/.test(match[2]))
  for (const match of relativeBlocks) {
    assert.equal(
      match[1].includes('.threadline-left'),
      false,
      '定位上下文不得依赖 .threadline-left 祖先',
    )
  }
})

test('证据槽是铺满容器的绝对定位层', () => {
  const code = stripComments(MAP_CSS)
  const block = /\.tl-evidence-slot\s*\{([^}]*)\}/.exec(code)
  assert.ok(block !== null, '找不到 .tl-evidence-slot 规则')
  assert.match(block[1], /position\s*:\s*absolute/, '证据槽必须绝对定位')
  assert.match(block[1], /inset\s*:\s*0/, '证据槽必须铺满（inset:0）')
})

test('证据渲染在时间线槽内，且图内不再有证据浮层', () => {
  const slot = readFileSync(join(PLUGIN_ROOT, 'src', 'client', 'ui', 'shell', 'TimelineSlot.ts'), 'utf8')
  assert.match(slot, /evidenceSlot/, 'TimelineSlot 必须接证据槽')
  assert.match(slot, /data-has-evidence/, '必须暴露 has-evidence 标记（便于验收）')

  const folderMap = readFileSync(join(PLUGIN_ROOT, 'src', 'client', 'ui', 'map', 'FolderMap.ts'), 'utf8')
  const code = folderMap.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.equal(/tl-graph-evidence/.test(code), false, '图内不得再渲染证据浮层')
  assert.match(code, /onEvidence/, '图组件必须把证据**上报**给父级')
})
