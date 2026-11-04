/*
 * tests/entries/fake-dom.ts —— 极简假 DOM（只为 style 注入 / tab 激活两条路径服务）。
 *
 * 不引 jsdom：插件只用到 `document.head.append / querySelector`、`createElement`、
 * `querySelectorAll('[role="tab"]')` 这几样，假实现足够，且能精确断言"卸载后 style 元素为 0"。
 */

export interface FakeElement {
  tagName: string
  textContent: string
  attrs: Record<string, string>
  removed: boolean
  setAttribute(name: string, value: string): void
  getAttribute(name: string): string | null
  append(child: FakeElement): void
  click(): void
  remove(): void
}

function createElement(tagName: string, onRemove?: (el: FakeElement) => void): FakeElement {
  const attrs: Record<string, string> = {}
  const el: FakeElement = {
    tagName,
    textContent: '',
    attrs,
    removed: false,
    setAttribute(name, value) {
      attrs[name] = value
    },
    getAttribute(name) {
      return attrs[name] ?? null
    },
    append() {
      // 只用到 head.append，元素内部结构不参与断言
    },
    click() {
      el.attrs['data-clicked'] = 'true'
    },
    remove() {
      el.removed = true
      onRemove?.(el)
    },
  }
  return el
}

/** 匹配 `style[data-plugin-css="K"]` / `style[data-plugin="ID"][data-plugin-css="K"]`。 */
function matchesStyleSelector(el: FakeElement, selector: string): boolean {
  if (!selector.startsWith('style')) return false
  const key = /\[data-plugin-css="([^"]+)"\]/.exec(selector)?.[1]
  const plugin = /\[data-plugin="([^"]+)"\]/.exec(selector)?.[1]
  if (key === undefined) return false
  if (el.attrs['data-plugin-css'] !== key) return false
  if (plugin !== undefined && el.attrs['data-plugin'] !== plugin) return false
  return true
}

export interface FakeStyleDocument {
  document: Document
  styles(): FakeElement[]
  liveStyles(): FakeElement[]
}

/** 支持 styles 注入/移除的假 document（`head.append` + 两种 querySelector）。 */
export function createStyleDocument(): FakeStyleDocument {
  const children: FakeElement[] = []
  const head = {
    append(el: FakeElement) {
      children.push(el)
    },
    querySelector(selector: string) {
      const found = children.find((el) => !el.removed && matchesStyleSelector(el, selector))
      return found ?? null
    },
  }
  const doc = {
    head,
    createElement(tagName: string) {
      return createElement(tagName, () => undefined)
    },
    querySelectorAll() {
      return []
    },
  }
  return {
    document: doc as unknown as Document,
    styles: () => children,
    liveStyles: () => children.filter((el) => !el.removed),
  }
}

/** 支持 `[role="tab"]` / `[data-view-id]` 查询的假 document（tab 激活用）。 */
export function createTabDocument(tabs: Array<{ text?: string; ariaLabel?: string; viewId?: string; onSelect?: () => void }>): {
  document: Document
  clicked: string[]
} {
  const clicked: string[] = []
  const elements = tabs.map((tab) => {
    const el = createElement('button')
    if (tab.text !== undefined) el.textContent = tab.text
    if (tab.ariaLabel !== undefined) el.attrs['aria-label'] = tab.ariaLabel
    if (tab.viewId !== undefined) el.attrs['data-view-id'] = tab.viewId
    el.click = () => {
      clicked.push(tab.text ?? tab.viewId ?? tab.ariaLabel ?? '?')
      tab.onSelect?.()
    }
    return el
  })
  const doc = {
    head: {
      append() {},
      querySelector() {
        return null
      },
    },
    createElement(tagName: string) {
      return createElement(tagName)
    },
    querySelectorAll(selector: string) {
      if (selector.includes('[role')) return elements
      if (selector.includes('[data-view-id]')) return elements.filter((el) => el.attrs['data-view-id'] !== undefined)
      return []
    },
  }
  return { document: doc as unknown as Document, clicked }
}
