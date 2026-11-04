/*
 * styles/index.ts —— 样式注入的单一实现。
 *
 * 宿主约定（照 dsh-context 的做法，不复制它的页面）：
 *   自己在 document.head 里插 <style data-plugin data-plugin-css>，按 data-plugin-css 去重；
 *   不碰 document.body / 应用根节点；卸载 = 移除自己插的 <style>。
 *
 * 2026-11-04 Lead 集成决策：源文件从「tokens+base 两份」扩成「styles/*.css 每区域一份」，
 * 但**注入路径仍然只有这一条**：遍历 css.ts 生成的 STYLE_SHEETS，一个文件一个 <style>，
 * 去重键 = threadline/<文件名>。卸载按同一张表逐键移除，因此新增 CSS 文件不需要改这里。
 *
 * 界面代码只 import 这里的 installStyles，不直接拼 CSS 字符串、也不自己插 <style>。
 */
import { BASE_CSS, STYLE_SHEETS, THREADLINE_CSS, TOKENS_CSS } from './css.ts'

export { BASE_CSS, THREADLINE_CSS, TOKENS_CSS }

/** 插件 id（= package.json name；样式元素用它做归属标记）。 */
export const PLUGIN_ID = 'dsh-plugin-control-your-development'

/** 两个基础样式表的归属键（保留常量；其余文件用 styleKeysOf(STYLE_SHEETS) 派生）。 */
export const STYLE_KEYS = {
  tokens: 'threadline/tokens.css',
  base: 'threadline/base.css',
} as const

/** 全部注入键（顺序 = css.ts 里的源文件顺序：tokens → base → 其余字母序）。 */
export function styleKeysOf(sheets: ReadonlyArray<{ key: string }> = STYLE_SHEETS): string[] {
  return sheets.map((s) => s.key)
}

export interface InstallStylesResult {
  /** 被移除的 <style> 数（卸载收尾用）。 */
  removed: number
  /** 本次真正新建的元素数（去重后）。 */
  created: number
}

function ensureStyle(doc: Document, key: string, css: string): number {
  const head = doc.head
  if (!head) return 0
  const existing = head.querySelector('style[data-plugin-css="' + key + '"]')
  if (existing) {
    // 已存在：内容可能来自旧版本页面，直接对齐到当前文本（不新增节点）。
    if (existing.textContent !== css) existing.textContent = css
    return 0
  }
  const el = doc.createElement('style')
  el.setAttribute('data-plugin', PLUGIN_ID)
  el.setAttribute('data-plugin-css', key)
  el.textContent = css
  head.append(el)
  return 1
}

/**
 * 注入全部样式表（tokens → base → 各区域）。
 * 返回卸载函数：移除本插件插入的全部 <style>（幂等，可重复调用）。
 */
export function installStyles(doc: Document = document): () => void {
  for (const s of STYLE_SHEETS) ensureStyle(doc, s.key, s.css)
  return () => {
    removeStyles(doc)
  }
}

/** 移除本插件的全部 <style>（卸载路径：ctx.effect 的 disposer 调它）。 */
export function removeStyles(doc: Document = document): InstallStylesResult {
  const head = doc.head
  if (!head) return { removed: 0, created: 0 }
  let removed = 0
  for (const key of styleKeysOf()) {
    const el = head.querySelector('style[data-plugin="' + PLUGIN_ID + '"][data-plugin-css="' + key + '"]')
    if (el) {
      el.remove()
      removed += 1
    }
  }
  return { removed, created: 0 }
}

/** 当前文档里是否已注入（测试与调试用）。 */
export function stylesInstalled(doc: Document = document): boolean {
  const head = doc.head
  if (!head) return false
  return head.querySelector('style[data-plugin-css="' + STYLE_KEYS.tokens + '"]') !== null
}
