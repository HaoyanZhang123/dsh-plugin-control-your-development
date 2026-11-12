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
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
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

/*
 * 确定性样本：三种句式 × 两种模型。
 *
 * **必须带 `outputTokens`**（1.5.5 口径变更）：`hasTokens()` 现在要求
 * `tokens + outputTokens` 齐备 —— 「占输出」的分母是 outputTokens，不是 totalTokens。
 * 夹具以前只有 `totalTokens`，于是所有分组都显示「观测不到」（而那恰恰是
 * 1.5.5 要修掉的旧口径症状），README 若用那种截图会展示一个已经修好的缺陷。
 *
 * 仍然保留一条**故意缺 token** 的样本（第 3 条）：验证"未知不是 0"，
 * 而不是让整页都变成未知。
 */
const SAMPLES: ReasoningSample[] = [
  {
    text: 'I need to check whether the tree listing renders before the scan finishes. I need the root to open instantly.',
    answerText: 'The listing is rendered first.',
    tokens: 120,
    outputTokens: 300,
    totalTokens: 900,
    sessionId: 'sess-a',
    turn: 1,
    model: 'deepseek/deepseek-v4.1-flash',
    preset: 'coding',
    at: 1_700_000_000_000,
    kind: 'committed',
  },
  {
    text: 'We need a single view model per directory so the old listing cannot be paired with a new path.',
    answerText: 'Agreed.',
    tokens: 80,
    outputTokens: 240,
    totalTokens: 700,
    sessionId: 'sess-a',
    turn: 2,
    model: 'deepseek/deepseek-v4.1-flash',
    preset: 'coding',
    at: 1_700_000_100_000,
    kind: 'committed',
  },
  {
    /* 故意缺 token：验证「未知不是 0」。 */
    text: '先检查目录树是否已经返回，再决定要不要显示骨架屏。接下来把关系证据挪到时间线。',
    answerText: '已调整。',
    sessionId: 'sess-b',
    turn: 1,
    model: 'k3-256k',
    preset: 'review',
    at: 1_700_000_200_000,
    kind: 'committed',
  },
  {
    text: 'Could you confirm whether hover should persist after the pointer leaves?',
    answerText: 'It should not.',
    tokens: 30,
    outputTokens: 150,
    totalTokens: 400,
    sessionId: 'sess-b',
    turn: 2,
    model: 'k3-256k',
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

  /*
   * **必须客户端挂载，不能只用 renderToString**（1.5.5 修：截图一直是 SSR 首帧）。
   *
   * 旧实现用 `react-dom/server` 同步渲染到字符串再塞进 DOM —— 好处是"页面出现即可截图"，
   * 代价是**所有 `useEffect` 永不执行**。而矩形树图/词云的尺寸来自 `ResizeObserver`
   * （effect 内注册），于是截图里它们永远停在兜底的 720×420，被 `preserveAspectRatio`
   * 裁成"树图一片空白"。也就是说：**过去所有思维链截图都不代表真实运行态**。
   *
   * 现在先用 `createRoot` 真挂载（effect 会跑、ResizeObserver 会量到真实宽度），
   * 再用 `flushSync` 把首次提交同步化，避免 harness 抓帧时页面还是白的
   * （这是旧实现改用 SSR 的唯一理由，flushSync 能同样满足）。
   */
  const wantSelect = params.get('select') === '1'
  const wantView = params.get('view')
  const viewProps: Record<string, unknown> = {
    samples: SAMPLES,
    locale,
    initialFilter: { range: 'workspace' },
    ...(wantView === 'cloud' || wantView === 'list' ? { initialView: wantView } : {}),
    ...(wantSelect ? { initialSelect: 'first' } : {}),
    testId: 'reasoning-view',
  }

  const root = createRoot(host)
  /* flushSync：让首帧同步提交，harness 的 waitFor 不必等异步调度。 */
  flushSync(() => {
    root.render(React.createElement('div', { style: { blockSize: '100%', overflow: 'auto' } }, React.createElement(ReasoningView, viewProps as never)))
  })

  /* 供 harness 读取的完成标记（等 effect + ResizeObserver 都跑过一轮）。 */
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      document.body.setAttribute('data-fixture-ready', 'true')
    })
  })
}

mount()
