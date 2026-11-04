/*
 * entries/impact.ts —— 「影响 N」（`conversation.chat.assistant-actions`；03 §2.2 / §7；06 A43-2）。
 *
 * ownerProps 只有 `messageId`（02 §3.1）；拿不到会话 id 时用标准 props 的 `sessionId`。
 * 用共享 detail store 取该会话详情 → `messageTurns[messageId]` → 该轮；**只在 finalMessageId 上渲染一次**
 * （没有 finalMessageId 时按 turn 去重到 messageIds 最后一条；序列不可得就**不渲染**）。
 *
 * 三态（03 §2.2）：
 * - `影响 {n}`（n>0，可点开 popover）；
 * - n === 0 → **不渲染**（绝不显示"影响 0"，06 N-15）；
 * - 数据未到 → 灰 `影响 …`（tooltip = state.loadingDetail）；读取失败 → 灰 `影响 ?`（tooltip = state.unknown）。
 *
 * popover（03 §7.2）：宽 360 / 最大高 70vh / 内部滚动；文件 ≤8、命令 ≤3、子智能体 ≤3，
 * 超出用「还有 N 条」；**正文一律不显示**；底部「在脉络中查看」「打开本次对话脉络」，不产生投递。
 */
import * as React from 'react'
import { createTranslator, DEFAULT_LOCALE, type Locale, type Translator } from '../locale/index.ts'
import type { FetchLike } from '../data/index.ts'
import {
  threadlineWorkspaceKey,
  useThreadlineDetail,
  useWorkspaceScope,
  type DetailStore,
  type WarmupSession,
} from '../data/index.ts'
import type { TurnDetail } from '../../shared/events/index.ts'
import { formatClock } from '../ui/turns/index.ts'
import { decideImpact, type ImpactCounts } from './impactModel.ts'
import { defaultFetch, readSnapshot, registerSlot, type ClientScopeLike, type SnapshotHook } from './context.ts'
import { requestFocus, activateThreadlineTab } from '../state/viewFocus.ts'
import { getDetailStore } from '../state/detailStore.ts'
import { ErrorBoundary, Portal } from '../ui/shell/index.ts'
import { openModal } from '../ui/modal/store.ts'
import { PrivacyProvider, maskCommand, maskPathFor, type PrivacyMode } from '../privacy/index.ts'
import { setPrivacyMode, usePrivacyMode } from '../state/privacyStore.ts'

const h = React.createElement

/** popover 行数上限（03 §7.2）。 */
export const IMPACT_LIMITS = { files: 8, commands: 3, subagents: 3 } as const

/** 「在脉络中查看」/「打开本次对话脉络」的默认落点（T09 的中央桥）。 */
function focusTokenForTurn(sessionId: string, turn: number): string {
  requestFocus({ kind: 'turn', sessionId, turn })
  return 'turn:' + String(turn)
}

/** 一个文件行（≈增删行、读/搜）。 */
function FileRow(props: { path: string; displayPath: string; added: number; removed: number; ops: readonly string[]; t: Translator }): React.ReactElement {
  const written = props.ops.includes('write')
  const delta = written ? '≈ +' + String(props.added) + ' / −' + String(props.removed) : '—'
  return h(
    'li',
    { className: 'threadline-impact-row', 'data-row': 'file', title: props.displayPath },
    h('span', { className: 'threadline-impact-row-main' }, props.displayPath),
    h('span', { className: 'threadline-impact-row-meta' }, delta),
  )
}

/** 命令行。 */
function CommandRow(props: {
  program: string
  displayProgram: string
  status: 'success' | 'error' | 'unknown'
  durationText: string
  t: Translator
}): React.ReactElement {
  const statusText = props.status === 'error' ? props.t('status.failed') : props.status === 'unknown' ? props.t('status.unknown') : props.t('status.ok')
  return h(
    'li',
    {
      className: 'threadline-impact-row',
      'data-row': 'command',
      'data-status': props.status,
      title: props.displayProgram,
    },
    h('span', { className: 'threadline-impact-row-main threadline-mono' }, props.displayProgram),
    h('span', { className: 'threadline-impact-row-meta', 'data-tone': props.status === 'error' ? 'danger' : undefined }, statusText + ' · ' + props.durationText),
  )
}

/**
 * 「影响」图标（D-25：与宿主 action row 的 feedback 图标同观感）。
 * 手写 16x16 内联 SVG（不引第三方图标库）：一个节点分叉成两条线 = "这一轮对工作区的影响/关系"。
 * 计数**不进视觉**（宿主 feedback 图标也没有数字），完整计数在 aria-label/tooltip 里给。
 */
export function ImpactIcon(): React.ReactElement {
  // 2026-11-04 真机反馈「图标深浅不对」+「要和别人的一样」：
  // 宿主 action row 的图标是**描边线性图标**（stroke 1.4，圆角端点，无实心块），颜色用 label-secondary 一族。
  // 所以这里改成同风格的描边图：三个空心节点 + 两条连线，全部 stroke=currentColor / fill=none；
  // 颜色由 CSS 的 color 决定（.threadline-impact-icon-btn 用 --dsw-alias-label-secondary），不写死 fill。
  return h(
    'svg',
    {
      className: 'threadline-impact-icon',
      width: 16,
      height: 16,
      viewBox: '0 0 16 16',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.4,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'aria-hidden': true,
      focusable: 'false',
    },
    h('circle', { cx: 3.6, cy: 8, r: 1.5 }),
    h('circle', { cx: 12.4, cy: 3.8, r: 1.5 }),
    h('circle', { cx: 12.4, cy: 12.2, r: 1.5 }),
    h('path', { d: 'M5.1 7.3 8 8l4.4 -2.6' }),
    h('path', { d: 'M8 8v4.2l4.4 0' }),
  )
}

/** 弹层尺寸/间距（D-27：portal 到 body + fixed 定位）。 */
export const IMPACT_POPOVER_WIDTH = 360
export const IMPACT_POPOVER_GAP = 6
export const IMPACT_POPOVER_MIN_SPACE = 280

/** portal 弹层的落位（纯函数，可单测）。 */
export interface ImpactPlacement {
  below: boolean
  top: number
  bottom: number
  left: number
  width: number
}

/**
 * 按触发按钮的 getBoundingClientRect 计算 fixed 定位：
 * 优先落在按钮下方 6px；下方空间不足且小于上方 → 翻到上方；左右越界则夹到视口内（右对齐优先）。
 */
export function placeImpactPopover(
  anchorRect: { top: number; bottom: number; left: number; right: number },
  viewport: { width: number; height: number },
  options?: { width?: number; gap?: number; minSpace?: number },
): ImpactPlacement {
  const gap = options?.gap ?? IMPACT_POPOVER_GAP
  const minSpace = options?.minSpace ?? IMPACT_POPOVER_MIN_SPACE
  const width = Math.max(200, Math.min(options?.width ?? IMPACT_POPOVER_WIDTH, viewport.width - 16))
  const spaceBelow = viewport.height - anchorRect.bottom - gap
  const spaceAbove = anchorRect.top - gap
  const below = spaceBelow >= Math.min(minSpace, spaceAbove)
  const rawLeft = anchorRect.right - width
  const left = Math.max(8, Math.min(rawLeft, viewport.width - width - 8))
  return {
    below,
    top: below ? anchorRect.bottom + gap : 0,
    bottom: below ? 0 : viewport.height - anchorRect.top + gap,
    left,
    width,
  }
}

/** 宿主内嵌根 className（T13c：独立根，不再带 threadline-app）。 */
export const IMPACT_ROOT_CLASS = 'threadline-impact-root'

/** hidden 的可观测标记（display:none；真机排查 + "不静默"要求，10 §2.1）。 */
export function impactHiddenMarker(input: {
  reason: string
  messageId: string
  sessionId: string
  testId?: string
}): React.ReactElement {
  return h('span', {
    'data-threadline-impact-hidden': input.reason,
    'data-message-id': input.messageId,
    'data-session-id': input.sessionId,
    style: { display: 'none' },
    'data-testid': (input.testId ?? 'impact') + '-hidden',
  })
}

/** 弹层内容（受控渲染；数据全部来自该轮记录，不显示正文）。导出给单测逐条断言内容。 */
export function ImpactPopover(props: {
  turn: TurnDetail
  counts: ImpactCounts
  sessionId: string
  mode: PrivacyMode
  t: Translator
  onOpenTab: () => void
  onOpenModal: () => void
  onClose: () => void
  testId?: string
}): React.ReactElement {
  const { turn, counts, t } = props
  const files = turn.files
  const commandRows = turn.commands
  const subagents = turn.subagents
  const hiddenFiles = Math.max(0, files.length - IMPACT_LIMITS.files)
  const hiddenCommands = Math.max(0, commandRows.length - IMPACT_LIMITS.commands)
  const hiddenSubagents = Math.max(0, subagents.length - IMPACT_LIMITS.subagents)
  const failedCommands = commandRows.filter((command) => command.status === 'error').length
  return h(
    'div',
    {
      className: 'threadline-impact-popover',
      role: 'dialog',
      'aria-label': t('impact.title') + ' · T' + String(turn.n),
      'data-testid': props.testId ?? 'impact-popover',
      onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          event.preventDefault()
          props.onClose()
        }
      },
    },
    h(
      'div',
      { className: 'threadline-impact-popover-head' },
      h('span', { className: 'threadline-impact-popover-title' }, t('impact.title') + ' · T' + String(turn.n)),
      h('span', { className: 'threadline-impact-popover-summary' }, formatClock(turn.end === undefined ? undefined : turn.end - turn.start) + ' · ' + t('inspector.tools') + ' ' + String(turn.toolCalls) + ' · ' + t('status.failed') + ' ' + String(turn.toolFailures)),
      h(
        'button',
        {
          type: 'button',
          className: 'threadline-btn threadline-btn--outline',
          onClick: props.onOpenTab,
        },
        t('impact.openTab'),
      ),
      h('button', {
        type: 'button',
        className: 'threadline-btn threadline-btn--icon',
        'aria-label': t('ui.close'),
        title: t('ui.close'),
        onClick: props.onClose,
        children: h('span', { 'aria-hidden': true }, '×'),
      }),
    ),
    h(
      'div',
      { className: 'threadline-impact-popover-body' },
      h(
        'div',
        { className: 'threadline-impact-group' },
        h('div', { className: 'threadline-impact-group-title' }, t('inspector.file') + ' ' + String(counts.files)),
        files.length === 0
          ? h('div', { className: 'threadline-impact-empty' }, '—')
          : h(
              'ul',
              { className: 'threadline-impact-list' },
              files.slice(0, IMPACT_LIMITS.files).map((file) =>
                h(FileRow, {
                  key: file.path,
                  path: file.path,
                  displayPath: maskPathFor(file.path, props.mode),
                  added: file.added,
                  removed: file.removed,
                  ops: file.ops,
                  t,
                }),
              ),
            ),
        hiddenFiles > 0 ? h('div', { className: 'threadline-impact-empty' }, t('inspector.more', { n: hiddenFiles })) : null,
      ),
      h(
        'div',
        { className: 'threadline-impact-group' },
        h('div', { className: 'threadline-impact-group-title' }, t('inspector.commands') + ' ' + String(counts.commands)),
        commandRows.length === 0
          ? h('div', { className: 'threadline-impact-empty' }, '—')
          : h(
              'ul',
              { className: 'threadline-impact-list' },
              commandRows.slice(0, IMPACT_LIMITS.commands).map((command) =>
                h(CommandRow, {
                  key: command.id,
                  program: command.program ?? '?',
                  displayProgram: maskCommand(command, props.mode).program,
                  status: command.status,
                  durationText: formatClock(command.durationMs),
                  t,
                }),
              ),
            ),
        hiddenCommands > 0 ? h('div', { className: 'threadline-impact-empty' }, t('inspector.more', { n: hiddenCommands })) : null,
        failedCommands > 0 ? h('div', { className: 'threadline-impact-empty', 'data-tone': 'danger' }, t('status.failed') + ' ' + String(failedCommands)) : null,
      ),
      h(
        'div',
        { className: 'threadline-impact-group' },
        h('div', { className: 'threadline-impact-group-title' }, t('inspector.subagents') + ' ' + String(counts.subagents)),
        subagents.length === 0
          ? h('div', { className: 'threadline-impact-empty' }, '—')
          : h(
              'ul',
              { className: 'threadline-impact-list' },
              subagents.slice(0, IMPACT_LIMITS.subagents).map((id) =>
                h(
                  'li',
                  { key: id, className: 'threadline-impact-row', 'data-row': 'subagent' },
                  h('span', { className: 'threadline-impact-row-main threadline-mono' }, id.slice(0, 12)),
                  h('span', { className: 'threadline-impact-row-meta' }, t('status.unknown')),
                ),
              ),
            ),
        hiddenSubagents > 0 ? h('div', { className: 'threadline-impact-empty' }, t('inspector.more', { n: hiddenSubagents })) : null,
      ),
    ),
    h(
      'div',
      { className: 'threadline-impact-popover-foot' },
      h(
        'button',
        { type: 'button', className: 'threadline-btn threadline-btn--outline', onClick: props.onOpenTab },
        t('impact.openTab'),
      ),
      h(
        'button',
        { type: 'button', className: 'threadline-btn threadline-btn--outline', onClick: props.onOpenModal },
        t('impact.openModal'),
      ),
    ),
  )
}

/** 「影响 N」按钮的 props。 */
export interface ImpactActionProps {
  messageId?: string
  sessionId?: string
  useSessions?: SnapshotHook
  /** T13e：宿主标准 props；用来解析工作区（workspaceKey/cwd 必须与 tab 同一把）。 */
  useWorkspaces?: SnapshotHook
  fetch?: FetchLike
  locale?: Locale
  /** 测试注入：共享 store（缺省用 state/detailStore 的共享实例）。 */
  store?: DetailStore
  /** 覆盖「在脉络中查看」的行为（默认：requestFocus + activateThreadlineTab）。 */
  onOpenTab?: (sessionId: string, turn: number) => void
  /** 覆盖「打开本次对话脉络」的行为（默认：ui/modal/store.openModal）。 */
  onOpenModal?: (sessionId: string) => void
  testId?: string
}

/** 每轮影响入口组件：先套隐私 Provider（与 tab/弹窗共享同一份模式），再渲染按钮。 */
export function ImpactAction(props: ImpactActionProps): React.ReactElement {
  const mode = usePrivacyMode()
  const t = createTranslator(props.locale ?? DEFAULT_LOCALE)
  // T13b：入口自身也要兜底（渲染期抛错时宿主 action row 里不能凭空消失/白屏）
  return h(
    ErrorBoundary,
    {
      label: t('state.unknown') + ' · ' + t('tab.label'),
      detailLabel: t('ui.expand'),
      resetKey: props.messageId,
      testId: 'impact-error-boundary',
    },
    h(PrivacyProvider, { mode, onChange: setPrivacyMode }, h(ImpactBody, { ...props, mode })),
  )
}

/** 按钮主体（在 Provider 内）。 */
function ImpactBody(props: ImpactActionProps & { mode: PrivacyMode }): React.ReactElement | null {
  const t: Translator = React.useMemo(() => createTranslator(props.locale ?? DEFAULT_LOCALE), [props.locale])
  const [open, setOpen] = React.useState(false)
  const sessions = readSnapshot<{
    current?: string
    ids?: readonly string[]
    byId?: Record<string, { running?: boolean } | undefined>
  }>(props.useSessions)
  /**
   * sessionId 兜底链（T13c）：
   * props.sessionId → useSessions 快照 current → 快照里 running 的那条 → 仍空则渲染 hidden 标记（不静默）。
   */
  const runningSessionId = ((): string => {
    const ids = sessions?.ids ?? []
    for (const id of ids) {
      if (sessions?.byId?.[id]?.running === true) return id
    }
    return ''
  })()
  const sessionId =
    typeof props.sessionId === 'string' && props.sessionId !== ''
      ? props.sessionId
      : typeof sessions?.current === 'string' && sessions.current !== ''
        ? sessions.current
        : runningSessionId
  const messageId = typeof props.messageId === 'string' ? props.messageId : ''
  const store = props.store ?? getDetailStore(props.fetch ?? defaultFetch())
  // T13e：只点图标也要能用 —— 带上工作区 cwd（host 冷读归属校验）+ 预热上下文（同 key 幂等）。
  const workspacesSnapshot = readSnapshot<never>(props.useWorkspaces)
  const scope = useWorkspaceScope({ workspaces: workspacesSnapshot, sessions: sessions as never, sessionId })
  const detailCwd = typeof scope.cwd === 'string' && scope.cwd !== '' ? scope.cwd : undefined
  const warmup =
    detailCwd === undefined
      ? undefined
      : {
          workspaceKey: threadlineWorkspaceKey(scope.workspaceId, detailCwd),
          cwd: detailCwd,
          sessions: scope.sessions as unknown as readonly WarmupSession[],
        }
  const entry = useThreadlineDetail(store, sessionId === '' || messageId === '' ? null : sessionId, {
    ...(detailCwd === undefined ? {} : { cwd: detailCwd }),
    ...(warmup === undefined ? {} : { warmup }),
    fetch,
  })
  const detail = entry?.detail ?? null

  // 点开弹层后：点空白处关闭（监听在本组件里，卸载即移除）
  React.useEffect(() => {
    if (!open) return undefined
    const onPointerDown = (event: MouseEvent): void => {
      const target = event.target
      if (target instanceof Element && target.closest('[data-threadline-impact], [data-threadline-impact-popover]') !== null) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])

  // D-27：portal 弹层按触发按钮的 rect 定位；resize/滚动时 rAF 节流重算
  const buttonRef = React.useRef<HTMLButtonElement | null>(null)
  const [placement, setPlacement] = React.useState<ImpactPlacement | null>(null)
  React.useEffect(() => {
    if (!open) {
      setPlacement(null)
      return undefined
    }
    if (typeof window === 'undefined') return undefined
    let frame = 0
    const update = (): void => {
      frame = 0
      const element = buttonRef.current
      if (element === null) return
      const rect = element.getBoundingClientRect()
      setPlacement(placeImpactPopover(
        { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right },
        { width: window.innerWidth, height: window.innerHeight },
      ))
    }
    const schedule = (): void => {
      if (frame !== 0) return
      frame = window.requestAnimationFrame(update)
    }
    update()
    window.addEventListener('resize', schedule)
    window.addEventListener('scroll', schedule, true)
    return () => {
      window.removeEventListener('resize', schedule)
      window.removeEventListener('scroll', schedule, true)
      if (frame !== 0) window.cancelAnimationFrame(frame)
    }
  }, [open])

  const decision = decideImpact({
    messageId,
    sessionId,
    detail,
    status: entry?.status ?? 'idle',
  })
  if (decision.kind === 'hidden') {
    return impactHiddenMarker({
      reason: decision.reason,
      messageId,
      sessionId,
      ...(props.testId === undefined ? {} : { testId: props.testId }),
    })
  }
  if (decision.kind === 'unknown' || decision.kind === 'loading' || decision.kind === 'streaming') {
    // 未加载 / 失败 / 本轮仍在记录：图标仍在，且**可以点**（2026-11-04 真机反馈"点不动"）。
    // 点了不伪造数字：弹一层如实说明 + 只读的"重新读取"（不写任何东西，03 §2.2 / §11.4）。
    // streaming 是 2026-11-05 新增：live 会话 detail 未读全时**不许静默隐藏**（否则用户看到"图标又消失了"）。
    const idleLabel =
      decision.kind === 'streaming'
        ? t('state.partialTurn')
        : decision.kind === 'loading'
          ? t('state.loadingDetail')
          : t('state.unknown')
    const retry = (): void => {
      if (sessionId === '') return
      void store.refresh(sessionId)
    }
    return h(
      'span',
      {
        className: IMPACT_ROOT_CLASS,
        'data-threadline-impact': '',
        'data-state': decision.kind,
        'data-testid': props.testId ?? 'impact',
      },
      h(
        'button',
        {
          type: 'button',
          ref: buttonRef,
          className: 'threadline-impact-icon-btn',
          'aria-label': idleLabel,
          'aria-haspopup': 'dialog',
          'aria-expanded': open,
          title: idleLabel,
          onClick: () => setOpen((value) => !value),
        },
        h(ImpactIcon),
      ),
      open
        ? h(
            'div',
            { className: 'threadline-impact-popover threadline-impact-popover--state', role: 'dialog', 'aria-label': idleLabel, 'data-state': decision.kind },
            h('div', { className: 'threadline-impact-popover-head' }, idleLabel),
            h(
              'div',
              { className: 'threadline-impact-popover-actions' },
              h(
                'button',
                { type: 'button', className: 'threadline-btn threadline-btn--outline', onClick: retry, disabled: sessionId === '' },
                t('coverage.retry'),
              ),
            ),
          )
        : null,
    )
  }

  const { turn, counts } = decision
  const tooltip = t('impact.tooltip', { files: counts.files, commands: counts.commands, subagents: counts.subagents })
  const onOpenTab = (): void => {
    if (props.onOpenTab !== undefined) props.onOpenTab(sessionId, turn.n)
    else {
      focusTokenForTurn(sessionId, turn.n)
      activateThreadlineTab()
    }
    setOpen(false)
  }
  const onOpenModal = (): void => {
    if (props.onOpenModal !== undefined) props.onOpenModal(sessionId)
    else openModal(sessionId)
    setOpen(false)
  }

  return h(
    'span',
    {
      className: IMPACT_ROOT_CLASS,
      'data-threadline-impact': '',
      'data-state': open ? 'open' : 'ready',
      'data-impact-count': String(counts.n),
      'data-testid': props.testId ?? 'impact',
    },
    h(
      'button',
      {
        type: 'button',
        ref: buttonRef,
        className: 'threadline-impact-icon-btn',
        'aria-label': tooltip,
        'aria-haspopup': 'dialog',
        'aria-expanded': open ? 'true' : 'false',
        title: tooltip,
        onClick: () => setOpen((value) => !value),
      },
      h(ImpactIcon),
    ),
    open && placement !== null
      ? h(
          Portal,
          { testId: 'impact-portal' },
          h(
            'div',
            {
              className: 'threadline-impact-root',
              'data-threadline-impact-popover': '',
              style: {
                position: 'fixed',
                display: 'block',
                insetInlineStart: placement.left + 'px',
                inlineSize: placement.width + 'px',
                zIndex: 60,
                ...(placement.below ? { top: placement.top + 'px' } : { bottom: placement.bottom + 'px' }),
              },
            },
            h(ImpactPopover, {
              turn,
              counts,
              sessionId,
              mode: props.mode,
              t,
              onOpenTab,
              onOpenModal,
              onClose: () => setOpen(false),
              ...(props.testId === undefined ? {} : { testId: props.testId + '-popover' }),
            }),
          ),
        )
      : null,
  )
}

/** 注册「影响 N」（`conversation.chat.assistant-actions`，order 50 = 在 feedback 之后）。 */
export function registerImpact(ctx: ClientScopeLike, options?: { locale?: Locale }): boolean {
  return registerSlot(
    ctx,
    'conversation.chat.assistant-actions',
    { id: 'threadline-impact', order: 50 },
    (props: never) => h(ImpactAction, { ...(props as unknown as ImpactActionProps), locale: options?.locale }),
    'threadline: assistant actions',
  )
}
