/*
 * entries/composer.entry.ts —— D-30 的真 DOM 验证页：模拟宿主 scrollBody 结构，看 composer 是否真被藏。
 *
 * 宿主结构（0.2.2 实测，dsh-client-ui-conversation）：
 *   <div data-conversation-scroll>            ← 滚动容器
 *     <Views/>                                ← 我们的 tab 挂在这里（flex:1）
 *     <div data-composer-seat>…</div>         ← 输入框座位（flex:none）
 * 本页造两个这样的容器：
 *   A. 普通 composer            → 我们的 tab 挂载后必须 display:none
 *   B. composer 里有审批卡（data-approval-key）→ 必须仍然可见（安全阀：否则用户答不了）
 */
import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { installStyles } from '../../../src/client/styles/index.ts'
import { ThreadlineTabView } from '../../../src/client/entries/tab.ts'

const h = React.createElement

function HostFrame(props: { id: string; withApproval: boolean }): React.ReactElement {
  const viewRef = React.useRef<HTMLDivElement | null>(null)
  const mounted = React.useRef(false)
  React.useEffect(() => {
    if (mounted.current || viewRef.current === null) return
    mounted.current = true
    const root = createRoot(viewRef.current)
    root.render(h(ThreadlineTabView, { locale: 'zh' } as never))
    return () => {
      root.unmount()
      mounted.current = false
    }
  }, [])
  return h(
    'div',
    {
      id: props.id,
      'data-conversation-scroll': '',
      style: { display: 'flex', flexDirection: 'column', blockSize: '360px', inlineSize: '900px', overflowY: 'auto', border: '1px solid #ddd' },
    },
    h('div', { ref: viewRef, id: props.id + '-view', style: { flex: '1 1 auto', minBlockSize: '0', display: 'flex', flexDirection: 'column' } }),
    h(
      'div',
      { 'data-composer-seat': '', style: { flex: 'none', blockSize: '64px', background: '#eee' } },
      props.withApproval ? h('div', { 'data-approval-key': 'a-1' }, 'approval card') : 'composer',
    ),
  )
}

function App(): React.ReactElement {
  return h('div', null, h(HostFrame, { id: 'plain', withApproval: false }), h(HostFrame, { id: 'approval', withApproval: true }))
}

installStyles(document)
const container = document.getElementById('root')
if (!container) throw new Error('harness entry: 缺少 #root')
createRoot(container).render(h(App, null))

function markReady(): void {
  const deadline = Date.now() + 3000
  const tick = (): void => {
    const plain = document.querySelector('div#plain-view .threadline-app')
    if (plain !== null || Date.now() > deadline) {
      document.documentElement.setAttribute('data-harness-ready', '1')
      return
    }
    window.setTimeout(tick, 40)
  }
  tick()
}
requestAnimationFrame(() => requestAnimationFrame(markReady))
