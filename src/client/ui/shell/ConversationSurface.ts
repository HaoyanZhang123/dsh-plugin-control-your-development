/*
 * ui/shell/ConversationSurface.ts —— 两个 tab 共用的「会话独占表面」（1.5.5）。
 *
 * 为什么要有它（真机缺陷）：`conversation.view` 的内容与宿主 composer 是
 * `[data-conversation-scroll]` 下的兄弟节点，composerSeat 是 flex:none。
 * 只要我们的 tab 不主动声明"这块区域由我独占"，宿主输入框就会继续占位/露出。
 *
 * 1.5.4 之前只有「脉络」tab 接了这一套（`useComposerSurface` + 宿主可视高度同步），
 * 思维链只加了类名和样式根 → 真机上思维链页面底部仍然露出会话输入框。
 * `reasoning.css` 的 `block-size:100%` 替代不了宿主高度测量：宿主滚动容器的内容高度是 auto，
 * 100% 只会拿到内容高度，外壳不会变成真正的滚动容器。
 *
 * 所以这里把三件事收敛成**唯一实现**，两个 tab 共同使用：
 *   1. `useComposerSurface`：给最近滚动容器打 `data-threadline-surface`（surface.css 据此隐藏 composer）；
 *   2. 宿主可视高度同步：把 surface 固定到 `[data-conversation-scroll].clientHeight`；
 *   3. 首次挂载把宿主滚动位置清零（内容变短后不要停在半空）。
 *
 * 样式根也在这里：`threadline-app` + `data-threadline-app`。`reasoning.css` 的规则与
 * `tokens.css` 的 `--tl-*` 都只在这个祖先下成立 —— 根是契约的一部分，不能由调用方自己拼
 * （1.5.2 的「思维链白板」就是有人手写了一个没有这层祖先的根）。
 *
 * 边界：只动 DOM 属性与自身行内高度；不碰宿主数据、不写存储、卸载即还原。
 * 审批 / 提问 / 计划复核的 composer 由 surface.css 显式排除，永远不会被藏掉。
 */
import * as React from 'react'
import { useComposerSurface } from '../../state/composerSurface.ts'

const h = React.createElement

/** 两个 tab 共用的根类名（= 样式作用域契约）。 */
export const SURFACE_ROOT_CLASS = 'threadline-app'

export interface ConversationSurfaceProps {
  /**
   * 额外类名。`threadline-app` 默认由本组件加，调用方**不该**再传一次
   * （传了也只是被 filter 掉，不会出现重复类名）。
   */
  className?: string
  /**
   * 是否由本组件提供样式根（`threadline-app`）。
   *
   * 脉络 tab 传 `false`：它的子节点是 `ThreadlineShell`，那个外壳自己就是 `threadline-app`
   * —— 再包一层同名的 inline-size 容器会让容器查询落在外层而不是真正的布局宽度上。
   * 思维链没有外壳，必须由这里提供根（1.5.2「白板」的根因就是本来没有这层祖先）。
   */
  rootScope?: boolean
  testId?: string
  /** 整块 tab 的指针离开（脉络用它清 hover 预览；思维链不传）。 */
  onMouseLeave?: () => void
  children?: React.ReactNode
}

function classesOf(extra: string | undefined, rootScope: boolean): string {
  const parts = rootScope ? [SURFACE_ROOT_CLASS, 'threadline-surface-host'] : ['threadline-surface-host']
  for (const name of (extra ?? '').split(/\s+/)) {
    if (name !== '' && !parts.includes(name)) parts.push(name)
  }
  return parts.join(' ')
}

export function ConversationSurface(props: ConversationSurfaceProps): React.ReactElement {
  const surfaceRef = React.useRef<HTMLDivElement | null>(null)
  useComposerSurface(surfaceRef)

  /*
   * 宿主可视高度同步。
   *
   * 首帧可能还拿不到 `[data-conversation-scroll]`（宿主把我们的节点插进 DOM 与滚动容器
   * 就绪之间有先后），所以找不到时用一次 rAF 重试；之后靠 ResizeObserver + window.resize 跟随。
   */
  React.useLayoutEffect(() => {
    const surface = surfaceRef.current
    if (surface === null) return undefined
    let host: HTMLElement | null = null
    let frame = 0
    const apply = (): void => {
      if (host === null) return
      const height = host.clientHeight
      if (height > 0) surface.style.blockSize = height + 'px'
      surface.style.minBlockSize = '0'
    }
    const findHost = (): void => {
      host = surface.closest<HTMLElement>('[data-conversation-scroll]')
      if (host === null) return
      apply()
      // 宿主原来可能停在会话底部；内容变短后主动清零（只做一次，不跟随用户滚动）。
      if (host.scrollTop > 0) host.scrollTop = 0
    }
    findHost()
    if (host === null) {
      frame = window.requestAnimationFrame(findHost)
      return () => window.cancelAnimationFrame(frame)
    }
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => apply())
    observer?.observe(host)
    window.addEventListener('resize', apply)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', apply)
    }
  }, [])

  return h(
    'div',
    {
      ref: surfaceRef,
      className: classesOf(props.className, props.rootScope !== false),
      ...(props.rootScope === false ? {} : { 'data-threadline-app': '' }),
      'data-threadline-surface-host': '',
      ...(props.testId === undefined ? {} : { 'data-testid': props.testId }),
      ...(props.onMouseLeave === undefined ? {} : { onMouseLeave: props.onMouseLeave }),
    },
    props.children ?? null,
  )
}
