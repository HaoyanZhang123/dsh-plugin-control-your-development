/*
 * tests/reasoning/listbox-layout.test.ts —— 下拉弹层的**宽度契约**（1.5.5 真机缺陷）。
 *
 * 用户反馈（附截图）：「思维链页面的下拉列表还是没有显示完整」。
 * 截图里语言下拉的选项只剩 `578.3k` / `33.4k` / `8.1k` / `1.3k` 这几串数字，
 * 「中文 / 英语 / 日语 / 混合」整列不见了。
 *
 * 根因（两条叠加，缺一不可）：
 * 1. `.tl-listbox` 是 `inline-flex`（宽度收缩到按钮），而弹层原来的 `min-inline-size: 100%`
 *    是相对这个**收缩宽度**解析的 → 「语言」这种短按钮的弹层只有按钮那么宽。
 * 2. 选项用 `grid-template-columns: 14px minmax(0, 1fr) auto`：
 *    `minmax(0, 1fr)` 的**下限是 0**，在窄弹层里先被压成零宽（连省略号都没东西可省），
 *    而 `auto` 那列（字符量 meta）按内容撑开 → 名称列归零，只剩数字。
 *
 * 所以本套件守两条**结构性**约束，而不是断言某个像素值：
 * - 弹层宽度**不能**绑定按钮宽度（必须是内容驱动 + 视口夹取）；
 * - 名称列的下限**不能**是 0（否则一定会在窄容器里被挤没）。
 *
 * 这两条一旦被改回去，用户的症状会原样复现，所以值得单独锁住。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PLUGIN_ROOT } from '../harness/styles-codegen.ts'

const CSS = readFileSync(join(PLUGIN_ROOT, 'src', 'client', 'styles', 'reasoning.css'), 'utf8')

/** 去掉注释，避免注释里的示例代码（含反例）干扰判断。 */
function strip(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}
const CODE = strip(CSS)

/** 取某个选择器对应的规则体。 */
function ruleBody(selector: string): string | null {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(escaped + '\\s*\\{([^}]*)\\}').exec(CODE)
  return match === null ? null : match[1]
}

test('弹层宽度不能绑定按钮宽度（否则短按钮的弹层只剩数字）', () => {
  const body = ruleBody('.tl-listbox-pop')
  assert.ok(body !== null, '必须存在 .tl-listbox-pop 规则')
  /* 核心：必须是内容驱动。max-content / fit-content 都算，写死 px 不算。 */
  assert.match(body, /inline-size:\s*(max-content|fit-content)/, '弹层宽度必须由内容决定（inline-size: max-content）')
  /* 仍然要保证不比按钮窄。 */
  assert.match(body, /min-inline-size:\s*100%/, '弹层至少不比按钮窄')
  /* 并且不能超出视口（方案 §6.2）。 */
  assert.match(body, /max-inline-size:\s*min\([^)]*100vw/, '弹层必须有视口夹取，不能顶出屏幕')
})

test('名称列的下限不能是 0（否则窄弹层里名称列被压没）', () => {
  const body = ruleBody('.tl-listbox-opt')
  assert.ok(body !== null, '必须存在 .tl-listbox-opt 规则')
  const columns = /grid-template-columns:\s*([^;]+);/.exec(body)
  assert.ok(columns !== null, '选项必须是 grid 三列布局')
  const decl = columns[1]
  /* 反向：不允许出现 minmax(0, 1fr) —— 那正是"名称列归零"的直接原因。 */
  assert.equal(
    /minmax\(\s*0(?:px)?\s*,\s*1fr\s*\)/.test(decl),
    false,
    '名称列下限不得是 0（minmax(0, 1fr) 会把名称压成零宽，只剩 meta 数字）',
  )
  /* 正向：下限必须能容纳内容。 */
  assert.match(decl, /minmax\(\s*auto\s*,\s*1fr\s*\)/, '名称列下限必须是 auto（按内容撑开），实际：' + decl.trim())
})

test('三列齐全：勾选标记 / 名称 / 字符量（少一列就会错位到别的列）', () => {
  const body = ruleBody('.tl-listbox-opt')
  assert.ok(body !== null)
  const columns = /grid-template-columns:\s*([^;]+);/.exec(body)
  assert.ok(columns !== null)
  const parts = columns[1].split(/\s+(?![^(]*\))/).map((part) => part.trim())
  assert.equal(parts.length, 3, '选项必须是三列，实际 ' + String(parts.length) + ' 列：' + columns[1].trim())
})

test('弹层右溢出有兜底（靠右对齐），不是硬顶着视口', () => {
  assert.match(
    CODE,
    /\.tl-listbox-pop\[data-align='end'\]\s*\{[^}]*inset-inline-end:\s*0/,
    '右溢出时必须有 data-align="end" 的靠右对齐规则',
  )
})

test('名称与 meta 都有省略兜底（长模型名不能被硬切）', () => {
  for (const selector of ['.tl-listbox-opt-label', '.tl-listbox-opt-meta']) {
    const body = ruleBody(selector)
    assert.ok(body !== null, '必须存在 ' + selector + ' 规则')
    assert.match(body, /white-space:\s*nowrap/, selector + ' 必须不换行')
  }
  const label = ruleBody('.tl-listbox-opt-label')
  assert.ok(label !== null)
  assert.match(label, /text-overflow:\s*ellipsis/, '名称列必须有省略号（否则长名被硬切）')
})
