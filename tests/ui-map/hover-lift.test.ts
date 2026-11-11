/*
 * tests/ui-map/hover-lift.test.ts —— 被悬浮节点自身的强化（1.5.1 真机缺陷）。
 *
 * 背景：D-35 起 hover 不再压暗其它节点（用户明确否掉「整图忽明忽暗」）。
 * 于是"哪里被指着"只能靠被悬浮者自己的变化表达；原来的 0.12 光晕 + 1.8px 描边
 * 在 4.5px 小节点/空心节点上几乎不可见 —— 用户反馈「文件节点 hover 改坏了」。
 *
 * 这里守三件事：
 * 1. 数值有**单一事实源**（FOLDER_HOVER），渲染层与 CSS 引用它，不各写一份；
 * 2. 强化确实比原来明显（填充≥0.9、光晕≥0.2、描边≥2），否则等于没修；
 * 3. **不改变「不压暗」这条已定结论**：不允许出现 dim 规则（见 no-dim.test.ts，这里再守一次代码层）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PLUGIN_ROOT } from '../harness/styles-codegen.ts'
import { FOLDER_HOVER, FOLDER_SIZE_RADIUS } from '../../src/client/ui/map/folderLayout.ts'

const FOLDER_MAP = readFileSync(join(PLUGIN_ROOT, 'src', 'client', 'ui', 'map', 'FolderMap.ts'), 'utf8')
const MAP_CSS = readFileSync(join(PLUGIN_ROOT, 'src', 'client', 'styles', 'map.css'), 'utf8')

test('FOLDER_HOVER 的数值必须真的"看得出来"（原值 0.12 光晕 / 1.8 描边太弱）', () => {
  assert.ok(FOLDER_HOVER.fillOpacity >= 0.9, '悬停填充要接近实心，实际 ' + String(FOLDER_HOVER.fillOpacity))
  assert.ok(FOLDER_HOVER.haloOpacity >= 0.2, '悬停光晕要明显强于原 0.12，实际 ' + String(FOLDER_HOVER.haloOpacity))
  assert.ok(FOLDER_HOVER.strokeWidth >= 2, '悬停描边要强于原 1.8，实际 ' + String(FOLDER_HOVER.strokeWidth))
  /* 不许放大半径：力导向里节点挨得近，放大反而压住邻居标签（这是既有纪律）。 */
  assert.equal('radius' in FOLDER_HOVER, false, '悬停不得改变半径（不做 scale）')
})

test('悬停填充不得低于"未知大小"的空心阈值之外破坏语义（未知仍为空心）', () => {
  /* 未知大小的节点靠 fillOpacity: 0 表达"空/未知"，悬停也不能把它填实，否则语义丢失。 */
  assert.match(
    FOLDER_MAP,
    /isHovered\s*&&\s*!sizeUnknown/,
    '悬停提亮必须排除 sizeUnknown 分支（否则"未知"被画成"有内容"）',
  )
  assert.equal(FOLDER_HOVER.fillOpacity <= 1, true)
  assert.ok(FOLDER_SIZE_RADIUS.min > 0)
})

test('FolderMap 的悬停光晕/填充读 FOLDER_HOVER，不写裸数字', () => {
  assert.match(FOLDER_MAP, /FOLDER_HOVER\.haloOpacity/, '光晕必须读 FOLDER_HOVER.haloOpacity')
  assert.match(FOLDER_MAP, /FOLDER_HOVER\.fillOpacity/, '填充必须读 FOLDER_HOVER.fillOpacity')
  /* 旧的裸 0.12 必须消失（单一执行路径：数值只在 folderLayout 里定义）。 */
  assert.equal(/fillOpacity:\s*isHovered\s*\?\s*0\.12/.test(FOLDER_MAP), false, '不得再写裸 0.12')
})

test('map.css 的悬停描边与 FOLDER_HOVER.strokeWidth 一致', () => {
  const block = /\.tl-ofile\[data-hovered='true'\]\s*\.tl-ofile-core\s*\{([^}]*)\}/.exec(MAP_CSS)
  assert.ok(block !== null, '缺少文件节点的悬停描边规则')
  const width = /stroke-width:\s*([\d.]+)/.exec(block[1])
  assert.ok(width !== null, '悬停规则必须显式写 stroke-width')
  assert.equal(Number(width[1]), FOLDER_HOVER.strokeWidth, 'CSS 描边宽度必须等于 FOLDER_HOVER.strokeWidth')
})

test('悬停强化**不得**引入压暗其它节点的规则（守住 D-35 的结论）', () => {
  /* 去掉注释再判，注释里会提到旧实现。 */
  const code = MAP_CSS.replace(/\/\*[\s\S]*?\*\//g, '')
  assert.equal(/data-dimmed/.test(code), false, '不允许 reintroduce data-dimmed')
  /* 与被悬浮节点同一层的其他节点不得被降透明度。 */
  assert.equal(
    /\[data-hovered='true'\][^{]*\{[^}]*opacity\s*:\s*0\.[0-7]/.test(code),
    false,
    '悬停规则里不得把元素压暗（只允许提亮/加粗）',
  )
})

test('枢纽悬停也要有可见的描边强化（与文件节点同一强度）', () => {
  /* 悬停枢纽的选择器可能出现在两条规则里（合并的填充/描边 + 专门的描边加粗），
   * 因此取**所有**命中块中带 stroke-width 的那条，而不是只看第一个匹配。 */
  const blocks = [...MAP_CSS.matchAll(/\.tl-foldhub\[data-hovered='true'\]\s*\.tl-foldhub-card\s*\{([^}]*)\}/g)].map(
    (match) => match[1],
  )
  assert.ok(blocks.length > 0, '缺少枢纽悬停规则')
  const widths = blocks
    .map((body) => /stroke-width:\s*([\d.]+)/.exec(body))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => Number(match[1]))
  assert.ok(widths.length > 0, '枢纽悬停必须显式给出描边宽度（否则只有 1px 的默认细边）')
  assert.ok(Math.max(...widths) >= 2, '枢纽悬停描边要够粗，实际 ' + widths.join(','))
})
