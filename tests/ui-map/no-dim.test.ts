/*
 * tests/ui-map/no-dim.test.ts —— 「hover 不压暗其他元素」的硬约束（D-35 需求 2）。
 *
 * 为什么要单独一条：这条需求曾经以"把 dim 从 0.4 改成 0.5"的方式被"实现"过，
 * 看起来改了，但用户要的是**完全不变暗**。因此断言必须是
 * "根本不存在把无关元素降透明度的规则"，而不是"降得少一点"。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PLUGIN_ROOT } from '../harness/styles-codegen.ts'

const MAP_CSS = readFileSync(join(PLUGIN_ROOT, 'src', 'client', 'styles', 'map.css'), 'utf8')
const FOLDER_MAP = readFileSync(join(PLUGIN_ROOT, 'src', 'client', 'ui', 'map', 'FolderMap.ts'), 'utf8')

/** 去掉注释（注释里会提到旧实现，不能算违规）。 */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

test('map.css 里没有任何"无关元素降透明度"的规则', () => {
  const code = stripComments(MAP_CSS)
  /* 旧实现的关键形态：data-dimmed='true' → opacity < 1。 */
  assert.equal(/data-dimmed/.test(code), false, '不允许再出现 data-dimmed 规则（哪怕是 opacity:1 的抵消写法）')
  assert.equal(/data-hub-pair-dimmed/.test(code), false, '枢纽间连线也不允许 dim 规则')
  /* 兜底：节点/枢纽的选择器上不得出现 opacity 声明（路径高亮靠 stroke，不靠透明度）。 */
  const offenders: string[] = []
  for (const rule of code.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const selector = rule[1].trim()
    const body = rule[2]
    if (!/\.tl-ofile|\.tl-foldhub|\.tl-hub-pair/.test(selector)) continue
    if (!/opacity\s*:/.test(body)) continue
    /* 允许 halo 的 hover 强调（那是"加重"，不是压暗），但必须排除 dim 语义。 */
    if (/opacity\s*:\s*0?\.\d+/.test(body) && !/halo|hovered|selected/i.test(selector)) offenders.push(selector)
  }
  assert.deepEqual(offenders, [], '这些选择器在给无关元素降透明度：' + offenders.join(' | '))
})

test('FolderMap 不再输出 dim 属性（代码与样式一致，不留双份语义）', () => {
  const code = FOLDER_MAP.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.equal(/data-dimmed/.test(code), false, '不得再输出 data-dimmed')
  assert.equal(/data-hub-pair-dimmed/.test(code), false, '不得再输出 data-hub-pair-dimmed')
  assert.equal(/const isDimmed/.test(code), false, '不得保留 isDimmed 死变量')
})

test('节点/枢纽的悬停反馈靠描边与光环，不靠整体透明度', () => {
  const code = stripComments(MAP_CSS)
  /* 必须有"被悬浮时描边变化"的规则（这是替代 dim 的交互感来源）。 */
  assert.match(code, /\.tl-ofile\[data-hovered='true'\][^}]*stroke/s, '文件节点悬停必须有描边反馈')
  assert.match(code, /\.tl-foldhub\[data-hovered='true'\][^}]*stroke/s, '文件夹枢纽悬停必须有描边反馈')
})
