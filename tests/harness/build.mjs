/*
 * harness/build.mjs —— 把 harness entry（.ts，import 真组件 + 合成 fixture）用 esbuild 打成
 * 单文件 HTML 可加载的 bundle，并生成页面 HTML。
 *
 * 约束：
 * - 只用 plugin 自带的 esbuild（devDependency，0.28.x），页面侧零 CDN / 零外链；
 * - 产物是一段内联 <script>，页面通过 file:// 打开即可（不需要起 http server）；
 * - React/ReactDOM 被打进 harness 包（宿主 __ModuleLoader__ 只在 DSH 页面里存在），
 *   所以 harness 的页面不是插件运行环境，只用于渲染与断言；
 * - 页面里额外注入"宿主主题桩"（HOST_THEME_STUB）：值抄自 DSH 主题源，
 *   仅为让截图接近宿主观感；缺令牌时的中性 fallback 仍在 tokens.css 里生效。
 */
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import esbuild from 'esbuild'

const HERE = dirname(fileURLToPath(import.meta.url))
export const PLUGIN_ROOT = resolve(HERE, '..', '..')

/**
 * 宿主主题桩（light / dark）。
 * 值逐条抄自 DSH 0.2.1-rc.5 的 `@deepseek-ai/dsh-client-ui-theme/lib/client.js`，
 * 只用于 harness 截图的可读性；产品代码不得引用本常量。
 */
export const HOST_THEME_STUB = [
  ':root{',
  '  --dsw-alias-bg-base: #ffffff;',
  '  --dsw-alias-bg-layer-1: #ffffff;',
  '  --dsw-alias-bg-layer-2: #ffffff;',
  '  --dsw-alias-bg-module-platform: #f5f6f7;',
  '  --dsw-alias-bg-mask-1: #0000003d;',
  '  --dsw-alias-bg-skeleton: #0000000a;',
  '  --dsw-alias-label-primary: #0f1115;',
  '  --dsw-alias-label-secondary: #61666b;',
  '  --dsw-alias-label-tertiary: #81858c;',
  '  --dsw-alias-label-caption: #adb2b8;',
  '  --dsw-alias-label-primary-foreground: #ffffff;',
  '  --dsw-alias-label-primary-inverted: #ffffff;',
  '  --dsw-alias-border-l1: #0000000a;',
  '  --dsw-alias-border-l2: #0000001a;',
  '  --dsw-alias-border-l3: #0000001f;',
  '  --dsw-alias-state-business-primary: #4176e6;',
  '  --dsw-alias-button-primary-fill: #0f1115;',
  '  --dsw-alias-link: #4176e6;',
  '  --dsw-alias-state-error-primary: #ec1313;',
  '  --dsw-alias-state-warn-primary: #f59e0b;',
  '  --dsw-alias-state-warn-label: #dd8629;',
  '  --dsw-alias-state-success-primary: #22c55e;',
  '  --dsw-alias-state-idle-primary: #d4d4d4;',
  '  --dsw-alias-interactive-bg-hover: #2631480f;',
  '  --dsw-alias-interactive-bg-active: #2631481a;',
  '  --dsw-alias-interactive-bg-hover-danger: #ec13130d;',
  '  --dsw-alias-tooltip-bg: #2c2c2e;',
  '  --dsw-radius-xs: 4px;',
  '  --dsw-radius-sm: 8px;',
  '  --dsw-radius-md: 12px;',
  '  --dsw-radius-lg: 16px;',
  '  --dsw-shadow-lv1: 0 2px 4px 0 #0000000d;',
  '  --dsw-shadow-lv2: 0 4px 12px 0 #0000000d;',
  '  --dsw-elevation-panel: 0 0 0 0.5px #0000001f, 0 3px 8px 0 #00000008;',
  '  --dsw-focus-ring-width: 2px;',
  '  --dsw-font-family: system-ui, -apple-system, "Segoe UI", sans-serif;',
  '  --dsw-font-markdown-code-font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;',
  '  --dsw-font-xxxs-11-font-size: 11px;',
  '  --dsw-font-xxs-12-font-size: 12px;',
  '  --dsw-font-xs-13-font-size: 13px;',
  '  --dsw-font-s-14-font-size: 14px;',
  '  --dsw-font-base-16-font-size: 16px;',
  '}',
  'body[data-ds-dark-theme]{',
  '  --dsw-alias-bg-base: #151517;',
  '  --dsw-alias-bg-layer-1: #232324;',
  '  --dsw-alias-bg-layer-2: #2c2c2e;',
  '  --dsw-alias-bg-module-platform: #353638;',
  '  --dsw-alias-bg-mask-1: #00000080;',
  '  --dsw-alias-bg-skeleton: #ffffff14;',
  '  --dsw-alias-label-primary: #f9fafb;',
  '  --dsw-alias-label-secondary: #cfd3d6;',
  '  --dsw-alias-label-tertiary: #adb2b8;',
  '  --dsw-alias-label-caption: #81858c;',
  '  --dsw-alias-label-primary-foreground: #0f1115;',
  '  --dsw-alias-label-primary-inverted: #353638;',
  '  --dsw-alias-border-l1: #ffffff0f;',
  '  --dsw-alias-border-l2: #ffffff1f;',
  '  --dsw-alias-border-l3: #ffffff29;',
  '  --dsw-alias-state-business-primary: #7aaaff;',
  '  --dsw-alias-button-primary-fill: #f9fafb;',
  '  --dsw-alias-link: #7aaaff;',
  '  --dsw-alias-state-error-primary: #f25a5a;',
  '  --dsw-alias-state-warn-primary: #f7ad31;',
  '  --dsw-alias-state-warn-label: #dd8629;',
  '  --dsw-alias-state-success-primary: #4ed17e;',
  '  --dsw-alias-state-idle-primary: #545557;',
  '  --dsw-alias-interactive-bg-hover: #ffffff14;',
  '  --dsw-alias-interactive-bg-active: #ffffff24;',
  '  --dsw-alias-interactive-bg-hover-danger: #f25a5a26;',
  '  --dsw-alias-tooltip-bg: #43454a;',
  '}',
].join('\n')

/** 页面基础样式：只做 host 无关的重置（html/body 撑满、无外边距）。 */
export const PAGE_RESET = [
  'html,body{margin:0;padding:0;block-size:100%;inline-size:100%;overflow:hidden;',
  '  background:var(--dsw-alias-bg-base,#ffffff);color:var(--dsw-alias-label-primary,#222222);}',
  '#root{block-size:100%;min-inline-size:0;}',
].join('\n')

/**
 * 动效冻结（截图可复现的关键）：
 * 有无限动画（例如运行中脉冲）的页面，每次截图都会落在动画的不同相位上，
 * 同一状态同一宽度会得到**逐字节不同**的 PNG —— 那样"可复现状态"就站不住。
 * 这里把所有动画都按在 0% 暂停：视觉状态仍存在（脉冲元素还在），但每次都是同一帧。
 * 不碰 transition（transition 只在状态切换时跑，不影响静帧）。
 * 需要观察动画本身时传 freezeAnimations: false。
 */
export const FREEZE_ANIMATIONS_CSS = [
  'html * ,html *::before,html *::after{',
  '  animation-play-state:paused !important;',
  '  animation-delay:0s !important;',
  '  animation-fill-mode:both !important;',
  '}',
].join('\n')

/** esbuild 打 bundle：entry（.ts/.tsx）→ 单段 IIFE 文本。 */
export async function bundleEntry(entryPath, options = {}) {
  const result = await esbuild.build({
    absWorkingDir: options.absWorkingDir ?? PLUGIN_ROOT,
    entryPoints: [entryPath],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: ['chrome100'],
    charset: 'utf8',
    sourcemap: false,
    legalComments: 'none',
    logLevel: 'silent',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    ...(options.buildOptions ?? {}),
  })
  const files = result.outputFiles ?? []
  if (files.length !== 1) throw new Error('harness bundle 期望 1 个产物，实际 ' + files.length)
  return files[0].text
}

/** 生成可直接 file:// 打开的页面 HTML。 */
export function makePageHtml(options) {
  const css = options.css ?? ''
  const freeze = options.freezeAnimations === false ? '' : FREEZE_ANIMATIONS_CSS + '\n'
  const containerWidth = options.containerWidth
  const rootStyle = containerWidth ? ' style="inline-size:' + containerWidth + 'px;block-size:100%"' : ''
  return (
    '<!doctype html><html lang="' +
    (options.lang ?? 'zh-CN') +
    '"><head><meta charset="utf-8"><title>' +
    (options.title ?? 'threadline harness') +
    '</title><style>' +
    PAGE_RESET +
    '\n' +
    HOST_THEME_STUB +
    '\n' +
    freeze +
    css +
    '</style></head><body' +
    (options.dark === true ? ' data-ds-dark-theme' : '') +
    '><div id="root"' +
    rootStyle +
    '></div><script>' +
    (options.js ?? '') +
    '</script></body></html>'
  )
}

/** 便捷：entry → HTML（containerWidth / dark / lang 由调用方给）。 */
export async function buildEntryHtml(entryPath, options = {}) {
  const js = await bundleEntry(entryPath)
  return makePageHtml({ ...options, js })
}

/** 读任意文件（bundlePath 场景）。 */
export async function readBundle(bundlePath) {
  return readFile(resolve(PLUGIN_ROOT, bundlePath), 'utf8')
}

/** 默认 entry 路径（shell 外壳夹具）。 */
export const DEFAULT_ENTRY = join(HERE, 'entries', 'shell.entry.ts')
