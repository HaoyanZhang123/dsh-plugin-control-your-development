/*
 * tests/harness/entries/shell.entry.ts —— 外壳截图夹具（合成数据，可复现）。
 *
 * 这不是产品代码：它 import 真实的外壳与通用组件，喂一份**确定性**的合成数据，
 * 让同一个 URL 参数组合永远渲染出同一帧（截图必须对应可复现的断言状态）。
 *
 * URL 参数（T07/T08 也可照抄这个模式做自己的 entry）：
 *   ?locale=zh|en      界面语言（默认 zh）
 *   ?inspector=1|0     检查器是否打开（默认 1）
 *   ?turns=collapsed   轮次带折叠
 *   ?theme=dark        深色（body[data-ds-dark-theme]）
 *   ?state=full|loading|error|empty  区域状态
 *   ?now=0             不渲染 Now strip
 */
import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { createTranslator, type Locale } from '../../../src/client/locale/index.ts'
import { installStyles } from '../../../src/client/styles/index.ts'
import {
  Chip,
  EmptyState,
  ErrorState,
  Legend,
  LoadingState,
  ProgressPill,
  Tooltip,
} from '../../../src/client/ui/common/index.ts'
import { ThreadlineShell } from '../../../src/client/ui/shell/index.ts'

const h = React.createElement

/** 合成节点（确定性坐标；真实星图由 T07 用布局算法产出）。 */
const FIXTURE_NODES: Array<{ id: string; x: number; y: number; r: number; line: string }> = [
  { id: 'notes/a', x: 120, y: 90, r: 7, line: 'notes/x.md' },
  { id: 'notes/b', x: 190, y: 60, r: 4, line: 'notes/y.md' },
  { id: 'notes/c', x: 150, y: 150, r: 5, line: 'notes/z.md' },
  { id: 'src/a', x: 330, y: 80, r: 9, line: 'src/client/index.ts' },
  { id: 'src/b', x: 400, y: 130, r: 6, line: 'src/host/index.ts' },
  { id: 'src/c', x: 300, y: 170, r: 3, line: 'src/shared/version.ts' },
  { id: 'data/a', x: 220, y: 250, r: 5, line: 'data/fixture.json' },
  { id: 'docs/a', x: 120, y: 300, r: 4, line: 'docs/spec.md' },
  { id: 'docs/b', x: 190, y: 330, r: 6, line: 'docs/facts.md' },
  { id: 'cfg/a', x: 380, y: 260, r: 3, line: 'project.yml' },
]

/** 合成星图占位（T07 的真实星图会替换它；这里只保证"主区有内容、布局可断言"）。 */
function FixtureMap(props: { width: number; height: number }): React.ReactElement {
  const nodes = FIXTURE_NODES.map((node) =>
    h('g', { key: node.id }, [
      h('circle', { key: 'c', cx: node.x, cy: node.y, r: node.r, fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, opacity: 0.75 }),
      h('circle', { key: 'core', cx: node.x, cy: node.y, r: 1.5, fill: 'currentColor', opacity: 0.9 }),
      h('text', { key: 't', x: node.x + node.r + 4, y: node.y + 3, fontSize: 11, fill: 'currentColor', opacity: 0.65 }, node.line),
    ]),
  )
  return h(
    'svg',
    {
      className: 'threadline-mono',
      width: '100%',
      height: '100%',
      viewBox: '0 0 ' + props.width + ' ' + props.height,
      preserveAspectRatio: 'xMidYMid meet',
      role: 'img',
      'aria-label': 'fixture map',
      style: { display: 'block', color: 'var(--tl-fg-tertiary)' },
    },
    nodes,
  )
}

function FixtureTimeline(): React.ReactElement {
  const ticks = [
    { key: 't1', label: '09:00', priority: 'high' },
    { key: 't2', label: '10:30', priority: 'low' },
    { key: 't3', label: '12:00', priority: 'high' },
    { key: 't4', label: '13:30', priority: 'low' },
    { key: 't5', label: '15:00', priority: 'high' },
  ]
  return h(
    'div',
    { style: { display: 'flex', alignItems: 'center', gap: '8px', width: '100%', minWidth: 0 } },
    h('span', { style: { color: 'var(--tl-fg-tertiary)' } }, '—'),
    ...ticks.map((tick) =>
      h(
        'span',
        {
          key: tick.key,
          'data-tick-priority': tick.priority,
          className: 'threadline-mono',
          style: { color: 'var(--tl-fg-tertiary)', fontSize: '11px' },
        },
        tick.label,
      ),
    ),
    h('span', { style: { marginInlineStart: 'auto', color: 'var(--tl-fg-secondary)', whiteSpace: 'nowrap' } }, 'T3 / 6'),
  )
}

function FixtureTurns(): React.ReactElement {
  const turns = [
    { key: 'T1', label: 'T1', detail: '3 files' },
    { key: 'T2', label: 'T2', detail: '1 cmd' },
    { key: 'T3', label: 'T3', detail: '2 files + 1 sub' },
    { key: 'T4', label: 'T4', detail: '1 err' },
    { key: 'T5', label: 'T5', detail: '1 file' },
    { key: 'T6', label: 'T6', detail: '2 files' },
  ]
  // 直接给轮次块，不再包一层 flex 容器：轮次带的横/纵排布由外壳的容器查询控制（03 §14）。
  return h(
    React.Fragment,
    null,
    ...turns.map((turn) =>
      h(
        'span',
        {
          key: turn.key,
          className: 'threadline-chip threadline-mono',
          style: { whiteSpace: 'nowrap' },
        },
        h('span', null, turn.label),
        h('span', { className: 'threadline-chip-count' }, turn.detail),
      ),
    ),
  )
}

function InspectorBody(props: { t: ReturnType<typeof createTranslator>; state: string }): React.ReactElement {
  const t = props.t
  if (props.state === 'loading') return h(LoadingState, { label: t('state.loadingDetail'), lines: 4, block: true })
  if (props.state === 'error') {
    return h(ErrorState, {
      title: t('state.hostUnavailable'),
      detail: 'fixture: read failed at turn 3',
      retryLabel: t('coverage.retry'),
      onRetry: () => undefined,
    })
  }
  if (props.state === 'empty') return h(EmptyState, { title: t('state.emptyFiles'), detail: t('tab.title') })
  const row = (label: string, value: string): React.ReactElement =>
    h(
      'div',
      {
        key: label,
        style: {
          display: 'flex',
          justifyContent: 'space-between',
          gap: '8px',
          minWidth: 0,
          padding: '2px 0',
          fontSize: '12px',
          color: 'var(--tl-fg-secondary)',
        },
      },
      h('span', { style: { whiteSpace: 'nowrap' } }, label),
      h('span', { className: 'threadline-mono threadline-ellipsis', style: { color: 'var(--tl-fg)' } }, value),
    )
  return h(
    'div',
    { style: { display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 0 } },
    h(
      'div',
      { style: { display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 } },
      h('span', { className: 'threadline-mono threadline-ellipsis', style: { fontSize: '13px' } }, 'read-model.ts'),
      h(
        Tooltip,
        { content: 'src/client/data/read-model.ts' },
        h(Chip, { label: t('inspector.file'), count: 12, mono: true }),
      ),
    ),
    row(t('inspector.firstSeen'), 'T1 · 09:41'),
    row(t('inspector.lastTouched'), 'T6 · 15:02'),
    row(t('inspector.ops'), '18 read / 4 write / 2 search'),
    row(t('inspector.lineDelta'), '+120 / -8'),
    h(
      'div',
      { style: { display: 'flex', flexWrap: 'wrap', gap: '4px', minWidth: 0 } },
      h(Chip, { label: t('relations.structure') }),
      h(Chip, { label: t('relations.coTurn'), count: 5 }),
      h(Chip, { label: t('relations.reference'), count: 1 }),
      h(Chip, { label: t('relations.unconfirmed'), count: 1 }),
    ),
    h(
      'div',
      { style: { display: 'flex', flexWrap: 'wrap', gap: '8px', minWidth: 0 } },
      h(Chip, { label: t('inspector.touchHistory'), count: 34 }),
      h(Chip, { label: t('inspector.laterTouches'), count: 3 }),
    ),
  )
}

function HarnessApp(): React.ReactElement {
  const params = new URLSearchParams(location.search)
  const locale: Locale = params.get('locale') === 'en' ? 'en' : 'zh'
  const t = React.useMemo(() => createTranslator(locale), [locale])
  const [inspectorOpen] = React.useState(params.get('inspector') !== '0')
  const [turnsCollapsed, setTurnsCollapsed] = React.useState(params.get('turns') === 'collapsed')
  const state = params.get('state') ?? 'full'
  const showNow = params.get('now') !== '0'

  const legend = h(Legend, {
    title: t('legend.title'),
    items: [
      { kind: 'text' as const, label: '文本' },
      { kind: 'code' as const, label: '代码' },
      { kind: 'data' as const, label: '数据' },
      { kind: 'media' as const, label: '媒体' },
      { kind: 'other' as const, label: '其它' },
    ],
  })

  return h(ThreadlineShell, {
    locale,
    workspaceName: 'skill开发',
    range: 'range.all' as const,
    onRangeChange: () => undefined,
    coverageSlot: h(ProgressPill, {
      state: 'loading',
      done: 42,
      total: 267,
      text: t('coverage.loading', { done: 42, total: 267 }),
      title: t('coverage.partial', { done: 42, total: 267 }),
      testId: 'coverage',
    }),
    nowStrip: showNow
      ? {
          text: 'read-model.ts · ' + t('session.running') + ' · T3/5 · 2 files',
          running: true,
          detail: t('state.partialTurn'),
          actionLabel: t('ui.open'),
          onAction: () => undefined,
        }
      : null,
    // T31：产品外壳不再有检查器/图例槽；T06 的 SSR/截图夹具把图例与检查器内容放进右列。
    graphSlot: h(FixtureMap, { width: 640, height: 420 }),
    railSlot: h(
      'div',
      null,
      legend,
      inspectorOpen
        ? h(
            'div',
            { className: 'threadline-inspector-stack', style: { marginBlockStart: 12 } },
            h(InspectorBody, { t, state }),
          )
        : null,
    ),
    timelineSlot: h(FixtureTimeline, null),
    turnStripTitle: t('inspector.turn'),
    turnStripCollapsed: turnsCollapsed,
    onTurnStripToggle: () => setTurnsCollapsed((value) => !value),
    turnStripSlot: h(FixtureTurns, null),
    testId: 'shell',
  })
}

// 主题：页面级 body 属性（与 DSH 的深色开关同名）。
const params = new URLSearchParams(location.search)
if (params.get('theme') === 'dark') document.body.setAttribute('data-ds-dark-theme', '')

installStyles(document)
const container = document.getElementById('root')
if (!container) throw new Error('harness entry: 缺少 #root')
createRoot(container).render(h(HarnessApp, null))

// 可复现状态的就绪标记：两帧之后再打，确保样式与布局都已结算。
requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    document.documentElement.setAttribute('data-harness-ready', '1')
  })
})
