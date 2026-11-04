/*
 * ui/shell/Portal.ts —— 浮层 portal 到 document.body 的唯一实现（D-27）。
 *
 * 0.2.2-rc.1 的 conversation.input.overlay 文档明确：composer 是 docked 容器，
 * 浮层必须 portal 到 body，否则会被裁切/偏移。这里只做「挂载点 + 卸载移除」：
 * - 浏览器：createPortal 到 body 下的一个空 div（data-threadline-portal；卸载时 node.remove()）；
 * - SSR / 无 document（单测 renderToStaticMarkup）：直接内联渲染 children，保证可测；
 * - 不往 body 写样式、不碰 app 根；portal 节点随组件 unmount 一起移除。
 */
import * as React from 'react'
import { createPortal } from 'react-dom'

export interface PortalProps {
  children?: React.ReactNode
  /** 挂载点上的 data-testid（测试断言用）。 */
  testId?: string
  /** 挂载点的 className（例如把 threadline-modal-root 放到 body 下的 portal 节点上，样式/令牌才跟得过来）。 */
  className?: string
}

export function Portal(props: PortalProps): React.ReactElement | null {
  const [host, setHost] = React.useState<HTMLElement | null>(null)
  const testId = props.testId
  const className = props.className

  React.useEffect(() => {
    if (typeof document === 'undefined' || document.body === null) return undefined
    const node = document.createElement('div')
    node.setAttribute('data-threadline-portal', '')
    if (testId !== undefined) node.setAttribute('data-testid', testId)
    if (className !== undefined && className !== '') node.className = className
    node.style.display = 'contents'
    document.body.appendChild(node)
    setHost(node)
    return () => {
      node.remove()
      setHost(null)
    }
  }, [testId, className])

  const children = props.children
  if (typeof document === 'undefined' || document.body === null) {
    return React.createElement(React.Fragment, null, children)
  }
  if (host === null) return null
  return createPortal(children, host)
}
