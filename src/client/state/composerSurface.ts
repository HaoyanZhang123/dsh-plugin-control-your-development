/*
 * state/composerSurface.ts —— 让「脉络」tab 独占整块会话区域时**隐藏宿主输入框**（D-30）。
 *
 * 为什么需要：`conversation.view` 的内容与宿主 composer 是 [data-conversation-scroll] 下的兄弟节点
 * （`dsh-client-ui-conversation` 的 scrollBody = Views + composerSeat，composerSeat 是 flex:none）。
 * 只要我们的 tab 还让 composer 占位，用户就会看到输入框被挤在内容末尾 / 抢占空间。
 *
 * 做法（**照搬已装插件 dsh-context 0.78.1 的成熟机制**，不自己发明）：
 *   1. 我们的 tab 挂载时，给最近的 `[data-conversation-scroll]` 打上 `data-threadline-surface`；
 *   2. 卸载时移除；**引用计数**，多个实例/重复挂载不会互相抢；
 *   3. styles/surface.css 里按该属性隐藏 `> [data-composer-seat]`，
 *      但**保留**含审批 / 提问 / 计划复核的 composer（用户可能还等着回答，不能把交互藏掉）。
 * 只动 DOM 属性，不碰宿主数据、不写存储、卸载即还原。
 */
import * as React from 'react'

export const SURFACE_ATTR = 'data-threadline-surface'

interface Mark {
  count: number
}

/** 每个滚动容器一份计数（WeakMap：容器回收即释放）。 */
const marks = new WeakMap<Element, Mark>()

/** 给传入节点最近的滚动容器打标记；返回清理函数（幂等）。 */
export function markComposerSurface(node: Element | null): () => void {
  const scroller = node === null ? null : node.closest('[data-conversation-scroll]')
  if (scroller === null) return () => undefined
  let mark = marks.get(scroller)
  if (mark === undefined) {
    mark = { count: 0 }
    marks.set(scroller, mark)
  }
  mark.count += 1
  scroller.setAttribute(SURFACE_ATTR, '')
  let released = false
  return () => {
    if (released) return
    released = true
    mark.count -= 1
    if (mark.count > 0) return
    marks.delete(scroller)
    scroller.removeAttribute(SURFACE_ATTR)
  }
}

/**
 * React 侧：给 ref 指向的节点挂标记。
 * 用 `useLayoutEffect`（与 dsh-context 一致）：首帧前就打上，避免"输入框先闪一下再消失"。
 */
export function useComposerSurface(ref: React.RefObject<Element | null>): void {
  React.useLayoutEffect(() => {
    const cleanup = markComposerSurface(ref.current)
    return cleanup
  }, [ref])
}
