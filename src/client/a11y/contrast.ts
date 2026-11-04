/*
 * a11y/contrast.ts —— WCAG 2.1 对比度纯函数（03 §15：正文 ≥ 4.5:1、图形边界 ≥ 3:1）。
 *
 * 只做数学，不读 DOM、不读主题：调用方把颜色传进来（生产里是 `getComputedStyle` 读到的
 * 令牌解析值，测试里是 DSH 主题源的实测值）。这样"对比度"能被单元测试真的正反两面验证。
 *
 * 边界：
 * - 只接受 `#rgb` / `#rrggbb`（`#rgba`/`#rrggbbaa` 会被拒绝：半透明色要合成后才有对比度，
 *   本函数不替调用方猜背景）；
 * - 非法输入返回 `null`（不抛错、不返回 0 冒充"很差"）。
 */

/** 正文文字的最小对比度（WCAG AA）。 */
export const TEXT_AA_MIN = 4.5

/** 图形/界面边界的最小对比度（WCAG AA，非文本）。 */
export const GRAPHICS_MIN = 3

export interface Rgb {
  r: number
  g: number
  b: number
}

/** 解析 `#rgb` / `#rrggbb`；非法或带透明度返回 null。 */
export function parseHexColor(hex: string): Rgb | null {
  if (typeof hex !== 'string') return null
  const text = hex.trim()
  if (!text.startsWith('#')) return null
  const body = text.slice(1)
  if (body.length === 3) {
    const r = body[0]
    const g = body[1]
    const b = body[2]
    if (!/^[0-9a-fA-F]{3}$/.test(body)) return null
    return { r: parseInt(r + r, 16), g: parseInt(g + g, 16), b: parseInt(b + b, 16) }
  }
  if (body.length === 6) {
    if (!/^[0-9a-fA-F]{6}$/.test(body)) return null
    return {
      r: parseInt(body.slice(0, 2), 16),
      g: parseInt(body.slice(2, 4), 16),
      b: parseInt(body.slice(4, 6), 16),
    }
  }
  return null
}

/** WCAG 相对亮度（0 = 黑，1 = 白）。 */
export function relativeLuminance(rgb: Rgb): number {
  const channel = (value: number): number => {
    const scaled = value / 255
    return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b)
}

/** 两色对比度（1–21）；任一侧非法返回 null。 */
export function contrastRatio(foreground: string, background: string): number | null {
  const fg = parseHexColor(foreground)
  const bg = parseHexColor(background)
  if (!fg || !bg) return null
  const a = relativeLuminance(fg)
  const b = relativeLuminance(bg)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

/** 是否达到给定阈值（非法颜色一律判不过，不允许"测不了就算过"）。 */
export function meetsContrast(foreground: string, background: string, min: number): boolean {
  const ratio = contrastRatio(foreground, background)
  return ratio !== null && ratio >= min
}

export interface ContrastPair {
  /** 人类可读的名字（用于证据与审计输出；不进 UI）。 */
  name: string
  fg: string
  bg: string
  min: number
}

export interface ContrastResult extends ContrastPair {
  ratio: number | null
  pass: boolean
}

/** 批量审计（顺序稳定，便于逐条对账）。 */
export function auditContrast(pairs: readonly ContrastPair[]): ContrastResult[] {
  return pairs.map((pair) => {
    const ratio = contrastRatio(pair.fg, pair.bg)
    return { ...pair, ratio, pass: ratio !== null && ratio >= pair.min }
  })
}

export interface ContrastSummary {
  total: number
  passed: number
  failed: number
  failedNames: string[]
}

export function summarizeContrast(results: readonly ContrastResult[]): ContrastSummary {
  const failedNames = results.filter((result) => !result.pass).map((result) => result.name)
  return {
    total: results.length,
    passed: results.length - failedNames.length,
    failed: failedNames.length,
    failedNames,
  }
}

/**
 * DSH 主题令牌的明暗实测值（抄自 `dsh-client-ui-theme/lib/client.js` 的 ---dsw-alias-* 定义）。
 * 用途：证明"我们只换语义、不换色板"时正文仍然可读（03 §13.2）。
 * 产品代码不得引用本常量（它只是 T10 的审计基线）。
 */
export const DSH_TOKEN_PAIRS: readonly ContrastPair[] = [
  { name: 'light 正文 label-primary/bg-base', fg: '#0f1115', bg: '#ffffff', min: TEXT_AA_MIN },
  { name: 'light 次要 label-secondary/bg-base', fg: '#61666b', bg: '#ffffff', min: TEXT_AA_MIN },
  { name: 'light 三级 label-tertiary/bg-base', fg: '#81858c', bg: '#ffffff', min: GRAPHICS_MIN },
  { name: 'light 危险 state-error/bg-base', fg: '#ec1313', bg: '#ffffff', min: GRAPHICS_MIN },
  { name: 'light 强调 state-business/bg-base', fg: '#4176e6', bg: '#ffffff', min: GRAPHICS_MIN },
  { name: 'light 成功 state-success/bg-base', fg: '#22c55e', bg: '#ffffff', min: 2 },
  { name: 'dark 正文 label-primary/bg-base', fg: '#f9fafb', bg: '#151517', min: TEXT_AA_MIN },
  { name: 'dark 次要 label-secondary/bg-layer-1', fg: '#cfd3d6', bg: '#232324', min: TEXT_AA_MIN },
  { name: 'dark 三级 label-tertiary/bg-layer-1', fg: '#adb2b8', bg: '#232324', min: GRAPHICS_MIN },
  { name: 'dark 危险 state-error/bg-base', fg: '#f25a5a', bg: '#1b1b1c', min: GRAPHICS_MIN },
  { name: 'dark 强调 state-business/bg-base', fg: '#7aaaff', bg: '#151517', min: GRAPHICS_MIN },
  { name: 'dark 成功 state-success/bg-base', fg: '#4ed17e', bg: '#151517', min: 2 },
]
