/*
 * focusTrap.ts —— 焦点陷阱的纯逻辑（可在 node 里单测，不需要 DOM）。
 *
 * 为什么拆出来：Tab 循环的边界计算是极易写错、又最容易被"看起来能点"掩盖的部分；
 * 把它做成纯函数（count/in-dex/shift → 下一个索引）就能在 node --test 里真断言。
 */

/** 可聚焦元素选择器（与 03 §15 的键盘可达要求一致）。 */
export const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'summary',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(',')

/**
 * 计算 Tab / Shift+Tab 之后应该聚焦的下标（循环）。
 * count <= 0 时返回 -1（调用方应把焦点留在容器上）。
 */
export function nextTrapIndex(count: number, currentIndex: number, shift: boolean): number {
  if (count <= 0) return -1
  const base = currentIndex < 0 ? (shift ? 0 : -1) : currentIndex
  const delta = shift ? -1 : 1
  const next = (base + delta + count) % count
  return next
}

export interface FocusableRoot {
  querySelectorAll(selector: string): ArrayLike<Element>
}

/** 在容器内按 DOM 顺序取可聚焦元素。 */
export function queryFocusable(root: FocusableRoot | null): Element[] {
  if (!root) return []
  const nodes = root.querySelectorAll(FOCUSABLE_SELECTOR)
  const list: Element[] = []
  for (let index = 0; index < nodes.length; index += 1) list.push(nodes[index] as Element)
  return list
}

export interface TabKeyEvent {
  key: string
  shiftKey: boolean
  preventDefault(): void
}

/**
 * 处理 Tab：把焦点锁在容器内；容器内没有可聚焦元素时，把焦点还给容器本身。
 * 返回 true 表示事件已被接管（调用方不必再处理）。
 */
export function trapTabKey(event: TabKeyEvent, root: FocusableRoot | null, active: Element | null): boolean {
  if (event.key !== 'Tab') return false
  const focusables = queryFocusable(root)
  if (focusables.length === 0) {
    event.preventDefault()
    if (active && typeof (active as HTMLElement).focus === 'function') (active as HTMLElement).focus()
    return true
  }
  const index = active ? focusables.indexOf(active) : -1
  const target = nextTrapIndex(focusables.length, index, event.shiftKey)
  const node = focusables[target]
  if (!node) return false
  event.preventDefault()
  if (typeof (node as HTMLElement).focus === 'function') (node as HTMLElement).focus()
  return true
}
