/*
 * tests/harness/entries/reasoning.entry.ts —— 思维链视图的截图夹具（合成数据，可复现）。
 *
 * 不是产品代码：import 真实的 ReasoningView，喂确定性样本，让同一 URL 永远同一帧。
 *
 * URL 参数：
 *   ?locale=zh|en   界面语言
 *   ?theme=dark     深色
 *   ?view=treemap|cloud|list  初始视图（默认 treemap）
 *   ?select=1       预选第一个句式（验证"点开看到具体句子"）
 */
import * as React from 'react'
import { renderToString } from 'react-dom/server'
import type { ReasoningSample } from '../../../src/shared/reasoning/index.ts'
import { installStyles } from '../../../src/client/styles/index.ts'
import { ReasoningView } from '../../../src/client/ui/reasoning/ReasoningView.ts'
import type { Locale } from '../../../src/client/locale/index.ts'
import type { ReasoningView as ReasoningViewKind } from '../../../src/shared/reasoning/index.ts'

const params = new URLSearchParams(location.search)
const locale = (params.get('locale') === 'en' ? 'en' : 'zh') as Locale
const theme = params.get('theme')
if (theme === 'dark') document.body.setAttribute('data-ds-dark-theme', 'true')
installStyles(document)

/** 确定性样本：三种句式 × 两种模型，token 有缺有全（验证"未知不是 0"）。 */
const SAMPLES: ReasoningSample[] = [
  {
    text: 'I need to check whether the tree listing renders before the scan finishes. I need the root to open instantly.',
    answerText: 'The listing is rendered first.',
    tokens: 120,
    totalTokens: 900,
    sessionId: 'sess-a',
    turn: 1,
    model: 'DeepSeek V4',
    preset: 'coding',
    at: 1_700_000_000_000,
    kind: 'committed',
  },
  {
    text: 'We need a single view model per directory so the old listing cannot be paired with a new path.',
    answerText: 'Agreed.',
    tokens: 80,
    totalTokens: 700,
    sessionId: 'sess-a',
    turn: 2,
    model: 'DeepSeek V4',
    preset: 'coding',
    at: 1_700_000_100_000,
    kind: 'committed',
  },
  {
    text: '先检查目录树是否已经返回，再决定要不要显示骨架屏。接下来把关系证据挪到时间线。',
    answerText: '已调整。',
    sessionId: 'sess-b',
    turn: 1,
    model: 'Kimi K3',
    preset: 'review',
    at: 1_700_000_200_000,
    kind: 'committed',
  },
  {
    text: 'Could you confirm whether hover should persist after the pointer leaves?',
    answerText: 'It should not.',
    tokens: 30,
    totalTokens: 400,
    sessionId: 'sess-b',
    turn: 2,
    model: 'Kimi K3',
    preset: 'review',
    at: 1_700_000_300_000,
    kind: 'committed',
  },
]

function mount(): void {
  const host = document.createElement('div')
  host.className = 'threadline-app'
  /* 关键：宿主本身必须在视口内（截图只抓首屏）。实测把高度写成 100vh 时，
   * 内容被推到 y=1000 之下 → 截图全白（断言却仍通过）。这里用绝对定位钉在左上角。 */
  host.style.position = 'fixed'
  host.style.insetInlineStart = '0'
  host.style.insetBlockStart = '0'
  host.style.inlineSize = '100vw'
  host.style.blockSize = '100vh'
  host.style.overflow = 'auto'
  document.body.appendChild(host)
  document.body.style.margin = '0'

  /* 用 react-dom/server 同步渲染到字符串：截图 harness 在 actions 之后立刻抓帧，
   * createRoot 的异步提交会让首帧是空白（实测：截图 6.5KB 全白）。
   * 同步渲染保证「页面出现即可截图」，也保证同参数同帧。 */
  const html = renderToString(
    React.createElement(
      'div',
      { style: { blockSize: '100%', overflow: 'auto' } },
      React.createElement(ReasoningView, {
        samples: SAMPLES,
        locale,
        initialFilter: { range: 'workspace' },
        testId: 'reasoning-view',
      }),
    ),
  )
  host.innerHTML = html

  /* 预选第一个句式 + 切视图：SSR 之后 setState 不会再重渲染，
   * 因此用「重渲染一次」的方式模拟真实交互结果（把 props 直接改成目标状态）。 */
  const wantSelect = params.get('select') === '1'
  const wantView = params.get('view')
  if (wantSelect || wantView === 'cloud' || wantView === 'list') {
    /* 这里直接重渲染整棵树，状态由初始参数决定（等价于用户点完之后的稳定态）。 */
    host.innerHTML = renderToString(
      React.createElement(
        'div',
        { style: { blockSize: '100%', overflow: 'auto' } },
        React.createElement(ReasoningView, {
          samples: SAMPLES,
          locale,
          initialFilter: { range: 'workspace' },
          ...(wantView === 'cloud' || wantView === 'list' ? { initialView: wantView } : {}),
          ...(wantSelect ? { initialSelect: 'first' } : {}),
          testId: 'reasoning-view',
        }),
      ),
    )
  }
}

mount()
