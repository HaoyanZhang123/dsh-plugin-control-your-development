/*
 * tokens.test.ts —— A40-1「只用 DSW 令牌」的静态判据。
 *
 * 判据（全部对 src/client/styles/*.css 与 src/client/ui/**\/*.ts 逐字符扫描）：
 * 1. 颜色字面量 0 命中：唯一的例外是 var(--dsw-*, <灰阶 fallback>) 里的灰阶 fallback；
 *    rgb()/hsl()/oklch()/命名颜色一律不允许；
 * 2. font-family 声明必须是 var(--tl-*)/var(--dsw-*)；
 * 3. border-radius 声明必须是 var(--tl-radius-*)/var(--dsw-radius-*) 或 0/50%/inherit；
 * 4. 组件里不写行内颜色（style 对象里出现 color/background 字面量即红）。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'
import { PLUGIN_ROOT, readStyleSource } from '../harness/styles-codegen.ts'

const CLIENT_DIR = join(PLUGIN_ROOT, 'src', 'client')

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(css|ts|tsx)$/.test(entry)) out.push(full)
  }
  return out
}

/** 只读样式与组件源码；locale 数据（中文文案）不参与颜色扫描。 */
const SOURCE_FILES = walk(join(CLIENT_DIR, 'styles'))
  .concat(walk(join(CLIENT_DIR, 'ui')))
  .sort()

/** 允许的灰阶 fallback：r=g=b（可带 alpha）。 */
function isNeutralGray(hex: string): boolean {
  const body = hex.replace('#', '')
  const parts =
    body.length === 3 || body.length === 4
      ? body
          .slice(0, 3)
          .split('')
          .map((char) => char + char)
      : [body.slice(0, 2), body.slice(2, 4), body.slice(4, 6)]
  return parts[0].toLowerCase() === parts[1].toLowerCase() && parts[1].toLowerCase() === parts[2].toLowerCase()
}

/** 把 var(--dsw-*, <fallback>) 的 fallback 摘出来校验，返回移除后的文本 + 违规清单。 */
function stripAllowedFallbacks(text: string): { rest: string; violations: string[] } {
  const violations: string[] = []
  const rest = text.replace(/var\(\s*--dsw-[a-z0-9-]+\s*,\s*([^)]*)\)/g, (_whole, fallback: string) => {
    for (const hex of fallback.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []) {
      if (!isNeutralGray(hex)) violations.push(hex)
    }
    return 'var(--dsw-token)'
  })
  return { rest, violations }
}

/** 命名颜色的白名单化匹配：不能误伤 white-space / black-list 这类 CSS 关键字。 */
const NAMED_COLOR = /(?<![\w-])(?:white|black|red|blue|green|gray|grey|orange|yellow|purple|pink|brown|cyan|magenta)(?![\w-])/gi

test('A40-1 颜色字面量：组件与 CSS 里 0 命中（只允许 var(--dsw-*, 灰阶 fallback)）', () => {
  const offenders: string[] = []
  for (const file of SOURCE_FILES) {
    const text = readFileSync(file, 'utf8')
    const { rest, violations } = stripAllowedFallbacks(text)
    for (const hex of violations) offenders.push(`${file}: 非灰阶 fallback ${hex}`)
    const hexes = rest.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []
    for (const hex of hexes) offenders.push(`${file}: 裸颜色 ${hex}`)
    if (/\b(?:rgba?|hsla?|oklch|lab|lch)\(/.test(rest)) offenders.push(`${file}: 用了 rgb()/hsl()/oklch() 等颜色函数`)
    const named = rest.match(NAMED_COLOR) ?? []
    for (const word of named) offenders.push(`${file}: 命名颜色 ${word}`)
  }
  assert.deepEqual(offenders, [], '禁止硬编码颜色：' + offenders.join(' | '))
})

test('A40-1 字体与圆角：font-family / border-radius 只能引用令牌', () => {
  const offenders: string[] = []
  for (const file of SOURCE_FILES) {
    if (!file.endsWith('.css')) continue
    const text = readFileSync(file, 'utf8')
    for (const match of text.matchAll(/font-family\s*:\s*([^;}]+)/g)) {
      const value = match[1].trim()
      if (value !== 'inherit' && !value.startsWith('var(')) offenders.push(`${file}: font-family ${value}`)
    }
    for (const match of text.matchAll(/border-radius\s*:\s*([^;}]+)/g)) {
      const value = match[1].trim()
      const allowed =
        value.startsWith('var(--tl-radius-') ||
        value.startsWith('var(--dsw-radius-') ||
        value === '0' ||
        value === '50%' ||
        value === 'inherit'
      if (!allowed) offenders.push(`${file}: border-radius ${value}`)
    }
  }
  assert.deepEqual(offenders, [], '字体/圆角必须走令牌：' + offenders.join(' | '))
})

test('A40-1 组件里没有行内颜色', () => {
  const offenders: string[] = []
  for (const file of SOURCE_FILES) {
    if (!file.endsWith('.ts') && !file.endsWith('.tsx')) continue
    const text = readFileSync(file, 'utf8')
    if (/style\s*=\s*\{\{/.test(text)) offenders.push(`${file}: JSX style={{...}}`)
    if (/(?:^|[\s{,])(?:color|backgroundColor|borderColor)\s*:\s*['"]#/.test(text)) offenders.push(`${file}: 行内颜色字面量`)
  }
  assert.deepEqual(offenders, [])
})

test('A40-1 fallback 一律中性灰阶且成对出现（var(--dsw-*, …)）', () => {
  const tokens = readStyleSource('tokens.css')
  const definitions = tokens.match(/--tl-[a-z-]+\s*:\s*[^;]+;/g) ?? []
  // 只挑"带颜色 fallback"的令牌（阴影令牌的 fallback 里也含灰度 hex）
  const colorDefs = definitions.filter((line) => line.includes('var(--dsw-') && line.includes('#'))
  assert.ok(colorDefs.length >= 20, '令牌层应有足够多的宿主映射（实际 ' + colorDefs.length + '）')
  for (const line of colorDefs) {
    const hexes = line.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []
    assert.ok(hexes.length >= 1, '颜色令牌必须带中性 fallback：' + line)
    for (const hex of hexes) assert.ok(isNeutralGray(hex), 'fallback 必须是灰阶：' + line)
  }
})

/**
 * 对比度自查：宿主令牌在明暗两套下的实测值（抄自 DSH 0.2.1-rc.5 主题源）。
 * 目的不是再造一套色板，而是证明"我们只换语义、不换颜色"时正文仍然可读。
 */
const HOST_COLOR_PAIRS = [
  { label: 'light 正文', fg: '#0f1115', bg: '#ffffff', min: 4.5 },
  { label: 'light 次要文字', fg: '#61666b', bg: '#ffffff', min: 4.5 },
  { label: 'dark 正文', fg: '#f9fafb', bg: '#151517', min: 4.5 },
  { label: 'dark 次要文字', fg: '#cfd3d6', bg: '#232324', min: 4.5 },
  { label: 'light 危险', fg: '#ec1313', bg: '#ffffff', min: 3 },
  { label: 'dark 危险', fg: '#f25a5a', bg: '#1b1b1c', min: 3 },
  { label: 'light 强调（图形/边框）', fg: '#4176e6', bg: '#ffffff', min: 3 },
  { label: 'dark 强调（图形/边框）', fg: '#7aaaff', bg: '#151517', min: 3 },
]

function luminance(hex: string): number {
  const body = hex.replace('#', '')
  const channels = [0, 2, 4].map((offset) => parseInt(body.slice(offset, offset + 2), 16) / 255)
  const linear = channels.map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4))
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
}

export function contrastRatio(foreground: string, background: string): number {
  const a = luminance(foreground)
  const b = luminance(background)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

test('A40-1 深浅色可读：正文/次要文字 ≥ 4.5:1，图形与语义色 ≥ 3:1', () => {
  for (const pair of HOST_COLOR_PAIRS) {
    const ratio = contrastRatio(pair.fg, pair.bg)
    assert.ok(ratio >= pair.min, `${pair.label} 对比度 ${ratio.toFixed(2)} < ${pair.min}`)
  }
})

test('A40-1 可读文本不得使用低对比的 tertiary/caption 令牌', () => {
  const base = readStyleSource('base.css')
  const TEXT_CLASSES = [
    'threadline-brand',
    'threadline-workspace',
    'threadline-btn',
    'threadline-chip',
    'threadline-chip-count',
    'threadline-pill',
    'threadline-pill-text',
    'threadline-turns-title',
    'threadline-empty',
    'threadline-empty-title',
    'threadline-empty-detail',
    'threadline-error',
    'threadline-error-detail',
    'threadline-inspector-title',
    'threadline-legend',
    'threadline-tip',
    'threadline-now',
    'threadline-now-text',
  ]
  const offenders: string[] = []
  for (const cls of TEXT_CLASSES) {
    const rule = new RegExp('\\.threadline-app \\.' + cls + '\\s*\\{([^}]*)\\}', 'g')
    for (const match of base.matchAll(rule)) {
      const body = match[1]
      if (/color:\s*var\(--tl-fg-(?:tertiary|caption|dimmed)\)/.test(body)) offenders.push(cls)
    }
  }
  assert.deepEqual(offenders, [], '这些类承载可读文本，不能用低对比令牌：' + offenders.join(', '))
})
