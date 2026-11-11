/*
 * styles.test.ts —— 样式的结构性纪律（03 §13 / §14 / §15；06 A40-1/A40-2）。
 *
 * 这里只做"静态可判定"的部分（选择器前缀、断点、动效、焦点环、生成物不漂移）；
 * "在某个容器宽度下真的没有横向滚动" 由 tests/harness 的 A40-2 截图断言负责。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { CSS_MODULE_PATH, buildStylesModule, listStyleSources, readStyleSource } from '../harness/styles-codegen.ts'
import { THREADLINE_CSS } from '../../src/client/styles/index.ts'
import { BREAKPOINTS, SHELL_METRICS } from '../../src/client/ui/shell/types.ts'

const TOKENS = readStyleSource('tokens.css')
const BASE = readStyleSource('base.css')

interface CssRule {
  selector: string
  atRules: string[]
}

/** 极简 CSS 解析：只取"选择器 + 它所在的 at-rule 栈"，够做前缀/断点检查。 */
export function parseCssRules(css: string): CssRule[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const rules: CssRule[] = []
  /** 每层块一个帧：at-rule 存其前言，普通规则块存空串（闭合时一起弹栈）。 */
  const stack: string[] = []
  let buffer = ''
  for (const char of text) {
    if (char === '{') {
      const head = buffer.trim()
      if (head.startsWith('@')) {
        stack.push(head)
      } else {
        rules.push({ selector: head, atRules: stack.filter((frame) => frame.startsWith('@')) })
        stack.push('')
      }
      buffer = ''
      continue
    }
    if (char === '}') {
      stack.pop()
      buffer = ''
      continue
    }
    buffer += char
  }
  return rules
}

/** 只按顶层逗号切选择器（:where(h1, h2) 这类括号里的逗号不算分隔）。 */
export function splitSelectors(selectorList: string): string[] {
  const parts: string[] = []
  let buffer = ''
  let depth = 0
  for (const char of selectorList) {
    if (char === '(' || char === '[') depth += 1
    if (char === ')' || char === ']') depth -= 1
    if (char === ',' && depth === 0) {
      parts.push(buffer.trim())
      buffer = ''
      continue
    }
    buffer += char
  }
  if (buffer.trim() !== '') parts.push(buffer.trim())
  return parts
}

const ALL_RULES = parseCssRules(TOKENS).concat(parseCssRules(BASE))

/**
 * 宿主级样式白名单（**只有这一个文件**）：surface.css 必须命中 .threadline-app 之外的
 * 宿主 composer 座位，才能实现 D-30「本 tab 独占区域时隐藏输入框」。
 * 它的约束由下面两条专门测试守着（前缀必须是 [data-conversation-scroll][data-threadline-surface]、
 * 且必须保留审批/提问/计划复核的安全阀），所以不是"静默放行"。
 */
export const HOST_SCOPED_STYLE_FILES: readonly string[] = ['surface.css']

/** 除白名单外，所有样式源文件都必须解析进 ALL_RULES（防止新增 css 绕过前缀门禁）。 */
const OTHER_STYLE_RULES = listStyleSources()
  .filter((sheet) => !HOST_SCOPED_STYLE_FILES.includes(sheet.name))
  .flatMap((sheet) => parseCssRules(sheet.css))

/** 关键帧步进（from/to/百分比）不是选择器。 */
function isKeyframeStep(rule: CssRule): boolean {
  return rule.atRules.some((at) => at.startsWith('@keyframes'))
}

test('每个选择器都挂 .threadline-app 前缀（卸载即干净，不污染宿主）', () => {
  const offenders: string[] = []
  for (const rule of ALL_RULES.concat(OTHER_STYLE_RULES)) {
    if (isKeyframeStep(rule)) continue
    for (const selector of splitSelectors(rule.selector)) {
      if (selector === '') continue
      // 允许的前缀（都落在本插件自己的子树上，不会污染宿主）：
      //   .threadline-app                       —— tab 根
      //   :is(.threadline-app, …impact-root)   —— 两者共享的令牌/通用组件（T31：modal 根已删除）
      //   .threadline-impact-root / .threadline-modal-root —— 两个宿主内嵌根（T13b 起用，样式挂在各自根下）
      //   .threadline-surface-host              —— D-30 的宿主区域标记容器
      // 真正的宿主级样式（要命中 .threadline-app 之外）只允许在 surface.css，由专门测试守着。
      const allowed = [
        '.threadline-app',
        ':is(.threadline-app, .threadline-impact-root)',
        ':is(.threadline-app, .threadline-impact-root, .threadline-modal-root)',
        '.threadline-impact-root',
        '.threadline-modal-root',
        '.threadline-surface-host',
      ]
      if (!allowed.some((prefix) => selector.startsWith(prefix))) offenders.push(selector)
    }
  }
  assert.deepEqual(offenders, [], '未挂前缀的选择器：' + offenders.join(' | '))
})

test('宿主级样式只有 surface.css，且每条选择器都被 data-threadline-surface 门控（D-30）', () => {
  const sheets = listStyleSources()
  const hostFiles = sheets.filter((sheet) => HOST_SCOPED_STYLE_FILES.includes(sheet.name)).map((sheet) => sheet.name)
  assert.deepEqual(hostFiles, ['surface.css'], '白名单与实际文件不一致：' + hostFiles.join(','))
  const surface = sheets.find((sheet) => sheet.name === 'surface.css')?.css ?? ''
  const rules = parseCssRules(surface)
  assert.ok(rules.length >= 1, 'surface.css 至少要有 1 条规则')
  for (const rule of rules) {
    for (const selector of splitSelectors(rule.selector)) {
      if (selector === '') continue
      assert.ok(
        selector.startsWith('[data-conversation-scroll][data-threadline-surface]'),
        '宿主级选择器必须由 data-threadline-surface 门控（否则会污染没打开本 tab 的会话）：' + selector,
      )
    }
  }
  // 安全阀：含审批 / 提问 / 计划复核的 composer 一律不能隐藏，否则用户答不了
  for (const key of ['data-approval-key', 'data-question-key', 'data-plan-review-key']) {
    assert.ok(surface.includes(key), 'surface.css 缺审批/提问/计划复核的安全阀：' + key)
  }
  assert.ok(/:not\(:has\(/.test(surface), '安全阀必须写成 :not(:has(...))，不能用别的方式绕过')
})

test('@keyframes 名字都带 threadline- 前缀', () => {
  const names = [...(TOKENS + BASE).matchAll(/@keyframes\s+([a-zA-Z0-9_-]+)/g)].map((match) => match[1])
  assert.ok(names.length >= 1)
  for (const name of names) assert.ok(name.startsWith('threadline-'), '关键帧名字要带前缀：' + name)
})

test('唯一的 viewport media query 是 prefers-reduced-motion', () => {
  const media = [...(TOKENS + BASE).matchAll(/@media\s+([^{]+)\{/g)].map((match) => match[1].trim())
  assert.equal(media.length, 1, '不允许其它 viewport media query（面板宽度随宿主变化）：' + media.join(' | '))
  assert.match(media[0], /prefers-reduced-motion:\s*reduce/)
})

test('响应式只用容器查询，且容器是 .threadline-app', () => {
  assert.match(TOKENS, /container:\s*threadline\s*\/\s*inline-size/)
  const containerRules = ALL_RULES.filter((rule) => rule.atRules.some((at) => at.startsWith('@container')))
  assert.ok(containerRules.length > 20, '容器查询覆盖不足（' + containerRules.length + '）')
  for (const rule of containerRules) {
    for (const at of rule.atRules.filter((item) => item.startsWith('@container'))) {
      assert.match(at, /^@container\s+threadline\s+\(/, '容器查询必须指名 threadline 容器：' + at)
    }
  }
})

test('断点齐全：1100 / 900 / 600 / 420 都有对应容器查询', () => {
  const conditions = [...BASE.matchAll(/@container\s+threadline\s+\(([^)]+)\)/g)].map((match) => match[1].trim())
  const has = (value: string): boolean => conditions.some((condition) => condition.replace(/\s+/g, '').includes(value))
  assert.ok(has('max-width:1099.98px'), '缺 <1100 的容器查询')
  assert.ok(has('max-width:899.98px'), '缺 <900 的容器查询')
  assert.ok(has('max-width:599.98px'), '缺 <600 的容器查询')
  assert.ok(has('max-width:419.98px'), '缺 <420 的容器查询')
  assert.ok(has('min-width:1280px'), '缺 ≥1280 的加宽检查器断点')
  // 断点常量与 CSS 数值必须对得上（单一事实源在 types.ts）
  assert.equal(BREAKPOINTS.wide, 1100)
  assert.equal(BREAKPOINTS.medium, 900)
  assert.equal(BREAKPOINTS.narrow, 600)
  assert.equal(BREAKPOINTS.minimum, 420)
})

/**
 * 双栏降级断点必须与 BREAKPOINTS.split 一致。
 *
 * 守的是 1.5.1 的真机缺陷：断点曾经是 1080，而宿主左侧栏展开时 tab 区域只有 ~820px，
 * 于是双栏掉成单列 —— 用户的体感是「卡片只有收起侧栏才在右边」。
 * 光断言"有这个断点"不够，必须断言**数值**：改小才是修复，改回 1080 就是回归。
 */
test('双栏降级断点 = BREAKPOINTS.split（不是 1080）', () => {
  const conditions = [...BASE.matchAll(/@container\s+threadline\s+\(([^)]+)\)/g)].map((match) =>
    match[1].replace(/\s+/g, ''),
  )
  const expected = 'max-width:' + String(BREAKPOINTS.split - 0.02) + 'px'
  assert.ok(
    conditions.includes(expected),
    '双栏断点必须取 BREAKPOINTS.split - 0.02（' + expected + '），实际有：' + conditions.join(' | '),
  )
  /* 反向：旧的 1080 断点不得再出现（否则两套口径并存，单一执行路径被破坏）。 */
  assert.equal(
    conditions.includes('max-width:1079.98px'),
    false,
    '1080 的双栏降级断点必须删除（单一执行路径）',
  )
})

test('区域高度来自规范（SHELL_METRICS 与 tokens.css 逐项一致）', () => {
  const expectations: Array<[string, number]> = [
    ['--tl-header-h', SHELL_METRICS.header],
    ['--tl-now-h', SHELL_METRICS.now],
    ['--tl-timeline-h', SHELL_METRICS.timeline],
    ['--tl-turns-h', SHELL_METRICS.turns],
    ['--tl-turns-h-collapsed', SHELL_METRICS.turnsCollapsed],
    ['--tl-inspector-w', SHELL_METRICS.inspector],
    ['--tl-inspector-w-wide', SHELL_METRICS.inspectorWide],
    ['--tl-map-min-h', SHELL_METRICS.mapMinHeight],
  ]
  for (const [token, value] of expectations) {
    const match = new RegExp(token + ':\\s*(\\d+)px').exec(TOKENS)
    assert.ok(match, 'token 缺失：' + token)
    assert.equal(Number(match[1]), value, token + ' 与 SHELL_METRICS 不一致')
  }
})

test('密度与动效：11/12/13/16px、行高 1.4–1.6、120/180/240ms ease-out', () => {
  for (const value of [11, 12, 13, 16]) {
    assert.ok(
      new RegExp('--tl-fs-[a-z-]+:\\s*var\\(--dsw-font-[a-z0-9-]+-font-size,\\s*' + value + 'px\\)').test(TOKENS),
      '缺 ' + value + 'px 的字号令牌',
    )
  }
  for (const lineHeight of ['1.4', '1.5', '1.6']) {
    assert.ok(TOKENS.includes('--tl-lh-tight: ' + lineHeight) || TOKENS.includes('--tl-lh-body: ' + lineHeight) || TOKENS.includes('--tl-lh-loose: ' + lineHeight))
  }
  for (const duration of ['120ms', '180ms', '240ms']) assert.ok(TOKENS.includes(duration), '缺动效时长 ' + duration)
  assert.match(TOKENS, /--tl-ease:\s*ease-out/)
})

test('reduced-motion 下动效归零（03 §15 / 06 N-13）', () => {
  const mediaStart = TOKENS.indexOf('@media (prefers-reduced-motion: reduce)')
  assert.ok(mediaStart > -1)
  const block = TOKENS.slice(mediaStart)
  assert.match(block, /--tl-dur-fast:\s*0ms/)
  assert.match(block, /--tl-dur-base:\s*0ms/)
  assert.match(block, /--tl-dur-slow:\s*0ms/)
  assert.match(block, /transition-duration:\s*0ms/)
  assert.match(block, /animation-duration:\s*0ms/)
})

test('!important 只出现在 reduced-motion 覆盖块里', () => {
  const withoutMedia = TOKENS.replace(/@media \(prefers-reduced-motion: reduce\)[\s\S]*$/, '')
  assert.equal((withoutMedia.match(/!important/g) ?? []).length, 0, 'tokens.css 的 reduced-motion 之外不许有 !important')
  assert.equal((BASE.match(/!important/g) ?? []).length, 0, 'base.css 不许有 !important')
})

test('焦点环 2px 可见（用宿主环宽令牌 + 强调色令牌）', () => {
  // 前缀可能是 .threadline-app 或共享根 group（D-27），所以按"选择器含 :focus-visible"逐条找身体
  const candidates = parseCssRules(BASE).filter((rule) => rule.selector.includes(':focus-visible'))
  assert.ok(candidates.length > 0, '缺 :focus-visible 规则')
  const matched = candidates.some((rule) => {
    const body = new RegExp(rule.selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}').exec(BASE)
    if (body === null) return false
    return (
      /outline:\s*var\(--dsw-focus-ring-width,\s*2px\)\s+solid\s+var\(--tl-accent\)/.test(body[1]) &&
      /outline-offset:/.test(body[1])
    )
  })
  assert.equal(matched, true, '焦点环规则必须用 2px 宿主环宽令牌 + 强调色令牌 + outline-offset')
})

test('css.ts 与 tokens.css/base.css 逐字一致（生成物不漂移）', () => {
  const expected = buildStylesModule()
  const actual = readFileSync(CSS_MODULE_PATH, 'utf8')
  assert.equal(actual, expected, 'css.ts 已漂移：跑 node tests/harness/emit-styles.mjs 重建')
  // 2026-11-04 Lead：样式源从「tokens+base 两份」扩成 styles/*.css 每区域一份；
  // 注入文本 = 全部 sheet 按注入顺序 join。这里按同一份枚举口径对账（不再写死两份）。
  assert.equal(THREADLINE_CSS, listStyleSources().map((s) => s.css).join(String.fromCharCode(10)))
})

test('css.ts 里没有反引号（工厂纪律：模板串截断事故）', () => {
  const text = readFileSync(CSS_MODULE_PATH, 'utf8')
  assert.equal((text.match(/`/g) ?? []).length, 0)
})

test('生成物 css.ts 带 GENERATED 头', () => {
  const text = readFileSync(CSS_MODULE_PATH, 'utf8')
  assert.match(text.slice(0, 200), /GENERATED/)
})
