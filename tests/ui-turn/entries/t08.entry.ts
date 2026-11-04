/*
 * tests/ui-turn/entries/t08.entry.ts —— T08 的截图 / 键盘夹具（合成数据，可复现）。
 *
 * 这不是产品代码：它 import **真实**的轮次带与检查器，喂 `tests/ui-turn/fixtures.ts` 的确定性数据。
 * 一个 URL 参数组合 = 一个可复现状态（06 §17；截图必须对应可断言的 DOM 状态）。
 *
 * URL 参数：
 *   ?view=turns                    轮次带（30 轮，独立展示，便于看换行）
 *   ?view=turns-narrow             轮次带（配合窄视口，验证纵向列表）
 *   ?view=inspector&target=file|turn|session|overview   检查器（带外壳上下文）
 *   ?target=file&path=...          指定文件
 *   &turn=12                       指定轮次
 *   &session=sess-beta             指定会话
 *   &privacy=1                     隐私模式（03 §12.2）
 *   &scope=all|session:sess-beta   轮次带范围
 *   &theme=dark                    深色
 *
 * 键盘证据：`window.__t08` 暴露只读探针（当前焦点 / 选择 / 预览 / 检查器开关 / 事件计数），
 * harness 用 `evaluate` 读它；**不往 console 打任何内容**。
 */
import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { createTranslator, type Locale } from '../../../src/client/locale/index.ts'
import { installStyles } from '../../../src/client/styles/index.ts'
import { InspectorPanel, NowStrip, ThreadlineShell, TurnStripSlot } from '../../../src/client/ui/shell/index.ts'
import { Inspector, type InspectorActions } from '../../../src/client/ui/inspector/index.ts'
import { SessionSelector, TurnStrip, buildTurnGroups, createSelectionState, defaultSelection, escapeSelection, selectionReducer, select as makeSelection } from '../../../src/client/ui/turns/index.ts'
import type { Selection, SelectionAction } from '../../../src/client/ui/turns/index.ts'
import { baseName } from '../../../src/client/ui/turns/index.ts'
import { buildArchivedDetail, buildInspectorData, buildSessionDetail, fixtureNow } from '../fixtures.ts'

const h = React.createElement
const params = new URLSearchParams(location.search)
const view = params.get('view') ?? 'turns'
const target = params.get('target') ?? 'file'
const locale = (params.get('locale') ?? 'zh') as Locale
const privacyMode = params.get('privacy') === '1'
const t = createTranslator(locale)
const now = fixtureNow()
const data = buildInspectorData()
const alpha = buildSessionDetail()
const beta = buildArchivedDetail()
const details = new Map([
  [alpha.id, alpha],
  [beta.id, beta],
])

/** 探针（只读；供 harness 断言）。 */
interface ProbeState {
  focusTurn: string | null
  focusText: string | null
  selected: string
  preview: string
  inspectorOpen: boolean
  exhausted: boolean
  events: string[]
  /** 每一步的只读快照（键盘证据用；由 `window.__t08.snap(step)` 记录）。 */
  stages: Array<{ step: string; focus: string | null; selected: string; preview: string; open: boolean; exhausted: boolean }>
}
const probe: ProbeState = {
  focusTurn: null,
  focusText: null,
  selected: 'none',
  preview: 'none',
  inspectorOpen: true,
  exhausted: false,
  events: [],
  stages: [],
}
;(window as unknown as { __t08: ProbeState }).__t08 = probe

/** 记录一步快照（harness 在每个按键后调用；只读探针，不参与 UI 逻辑）。 */
;(window as unknown as { __t08: ProbeState & { snap: (step: string) => void } }).__t08.snap = (step: string): void => {
  probe.stages.push({
    step,
    focus: probe.focusTurn,
    selected: probe.selected,
    preview: probe.preview,
    open: probe.inspectorOpen,
    exhausted: probe.exhausted,
  })
}

function selectionKeyOf(selection: Selection): string {
  if (selection.kind === 'none') return 'none'
  if (selection.kind === 'file') return 'file:' + selection.path
  if (selection.kind === 'turn') return 'turn:' + selection.sessionId + ':' + String(selection.turn)
  return 'session:' + selection.sessionId
}

/** 星图占位（T07 的真实星图会替换它；这里只让外壳有内容、布局可断言）。 */
function FixtureMap(): React.ReactElement {
  return h(
    'div',
    {
      'data-fixture-map': '',
      style: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        inlineSize: '100%',
        blockSize: '100%',
        color: 'var(--tl-fg-tertiary)',
        fontSize: 12,
      },
    },
    'fixture map',
  )
}

function InspectorTitle(props: { selection: Selection }): string {
  const selection = props.selection
  if (selection.kind === 'file') return t('inspector.file') + ' · ' + baseName(selection.path)
  if (selection.kind === 'turn') return 'T' + String(selection.turn)
  if (selection.kind === 'session') return t('inspector.session')
  return t('tab.title')
}

function App(): React.ReactElement {
  const initialScope = (() => {
    const scope = params.get('scope')
    if (scope === 'all') return { kind: 'all' as const }
    if (scope !== null && scope.startsWith('session:')) return { kind: 'session' as const, sessionId: scope.slice('session:'.length) }
    return { kind: 'current' as const }
  })()

  const initialSelection: Selection = (() => {
    if (view !== 'inspector') return defaultSelection(alpha)
    if (target === 'file') return makeSelection.file(params.get('path') ?? 'src/client/data/merge.ts')
    if (target === 'turn') return makeSelection.turn(params.get('session') ?? alpha.id, Number(params.get('turn') ?? '30'))
    if (target === 'session') return makeSelection.session(params.get('session') ?? 'sess-beta')
    return makeSelection.none()
  })()

  const [scope, setScope] = React.useState(initialScope)
  const [state, setState] = React.useState(createSelectionState(initialSelection, true))

  const dispatch = React.useCallback((action: SelectionAction) => {
    setState((previous) => selectionReducer(previous, action))
  }, [])

  // Esc 逐层退出：入口统一在 document 上处理（T09 的做法：这一层消费不掉才关 tab/弹窗）。
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      setState((previous) => {
        const result = escapeSelection(previous)
        probe.exhausted = !result.consumed
        if (result.consumed) event.preventDefault()
        return result.state
      })
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  const groups = React.useMemo(
    () => buildTurnGroups({ scope, currentSessionId: alpha.id, sessions: data.sessions, details }),
    [scope],
  )

  const actions: InspectorActions = {
    onSelectFile: (path) => dispatch({ type: 'click', target: makeSelection.file(path) }),
    onSelectTurn: (sessionId, turn) => dispatch({ type: 'click', target: makeSelection.turn(sessionId, turn) }),
    onSelectSession: (sessionId) => dispatch({ type: 'click', target: makeSelection.session(sessionId) }),
    onOpenFile: (path) => dispatch({ type: 'click', target: makeSelection.file(path) }),
    onOpenSession: (sessionId) => dispatch({ type: 'click', target: makeSelection.session(sessionId) }),
    onFocusInMap: (selection) => dispatch({ type: 'click', target: selection }),
    onOpenModal: () => undefined,
    onClose: () => dispatch({ type: 'closeInspector' }),
    onRetry: () => undefined,
  }

  const selection = state.preview ?? state.selected
  // 探针在每次渲染后同步（只读，不参与 UI 逻辑）。
  React.useEffect(() => {
    const active = document.activeElement
    probe.focusTurn = active instanceof HTMLElement ? active.getAttribute('data-turn') : null
    probe.focusText = active instanceof HTMLElement ? (active.getAttribute('aria-label') ?? active.tagName.toLowerCase()) : null
    probe.selected = selectionKeyOf(state.selected)
    probe.preview = selectionKeyOf(state.preview ?? makeSelection.none())
    probe.inspectorOpen = state.inspectorOpen
    probe.events.push(probe.selected + '|' + probe.preview + '|' + String(probe.inspectorOpen))
  })

  const strip = h(TurnStrip, {
    t,
    groups,
    sessions: data.sessions,
    selected: state.selected,
    preview: state.preview,
    onPreview: (next) => dispatch({ type: 'hover', target: next }),
    onSelect: (next) => dispatch({ type: 'click', target: next }),
    onDoubleClick: (next) => dispatch({ type: 'keyboard', target: next }),
    onClearSelection: () => dispatch({ type: 'blank' }),
    now,
    privacyMode,
    testId: 'turn-strip',
  })

  const selector = h(SessionSelector, {
    t,
    sessions: data.sessions,
    scope,
    onScopeChange: setScope,
    privacyMode,
  })

  if (view === 'turns' || view === 'turns-narrow' || view === 'keyboard') {
    const bandHeight = 248
    return h(
      'div',
      {
        className: 'threadline-app',
        // 截图需要看清 30 轮的换行：把轮次带高度调高（真实外壳是 92px / 折叠 40px）
        style: { blockSize: '100%', ['--tl-turns-h']: String(bandHeight) + 'px' } as React.CSSProperties,
      },
      h(
        'div',
        { className: 'threadline-shell', style: { blockSize: '100%' } },
        h(
          'div',
          {
            style: {
              display: 'flex',
              flexDirection: 'column',
              flex: '1 1 auto',
              minBlockSize: 0,
              blockSize: bandHeight,
            },
          },
          h(
            TurnStripSlot,
            {
              title: t('inspector.turn'),
              collapsed: false,
              headerSlot: selector,
              testId: 'turn-strip-slot',
            },
            strip,
          ),
        ),
        // 空白区：真实 tab 里点空白 = 取消选择（这里给 harness 一个稳定的"空白"落点）
        h('div', {
          'data-testid': 't08-blank',
          style: { blockSize: '24px', flex: '0 0 auto', background: 'var(--tl-surface)' },
          onClick: () => dispatch({ type: 'blank' }),
        }),
        view === 'keyboard'
          ? h(
              'div',
              { style: { flex: '1 1 auto', minBlockSize: 0, display: 'flex' } },
              h(
                InspectorPanel,
                {
                  title: InspectorTitle({ selection }),
                  closeLabel: t('ui.close'),
                  onClose: () => dispatch({ type: 'closeInspector' }),
                  open: state.inspectorOpen,
                  testId: 'inspector',
                },
                h(Inspector, {
                  t,
                  data,
                  selection,
                  privacyMode,
                  now,
                  actions,
                  testId: 'inspector-body',
                }),
              ),
            )
          : h('div', { style: { flex: '1 1 auto' } }),
      ),
    )
  }

  return h(
    'div',
    { className: 'threadline-app', style: { blockSize: '100%' } },
    h(ThreadlineShell, {
      locale,
      workspaceName: 'skill开发',
      nowStrip: { text: t('session.running') + ' · T30 · 2 文件', running: true },
      mapSlot: h(FixtureMap, null),
      inspectorOpen: state.inspectorOpen,
      onInspectorClose: () => dispatch({ type: 'closeInspector' }),
      inspectorTitle: InspectorTitle({ selection }),
      inspectorSlot: h(Inspector, { t, data, selection, privacyMode, now, actions, testId: 'inspector-body' }),
      timelineSlot: h('span', { style: { color: 'var(--tl-fg-tertiary)' } }, 'timeline fixture'),
      turnStripTitle: t('inspector.turn'),
      turnStripCollapsed: false,
      turnStripHeadSlot: selector,
      turnStripSlot: strip,
      testId: 'shell',
    }),
  )
}

if (params.get('theme') === 'dark') document.body.setAttribute('data-ds-dark-theme', '')
installStyles(document)
const container = document.getElementById('root')
if (!container) throw new Error('harness entry: 缺少 #root')
createRoot(container).render(h(App, null))

requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    // 检查器内容比一屏长：?scroll=bottom 把检查器滚动到底，用来给"下半屏字段"留一张可复现的图。
    if (params.get('scroll') === 'bottom') {
      const body = document.querySelector<HTMLElement>('.threadline-inspector-body')
      if (body !== null) body.scrollTop = body.scrollHeight
    }
    document.documentElement.setAttribute('data-harness-ready', '1')
  })
})
