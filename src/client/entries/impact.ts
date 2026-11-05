/*
 * entries/impact.ts —— 「影响 N」（`conversation.chat.assistant-actions`；03 §2.2 / §7；06 A43-2）。
 *
 * ownerProps 只有 `messageId`（02 §3.1）；拿不到会话 id 时用标准 props 的 `sessionId`。
 * 用共享 detail store 取该会话详情 → `messageTurns[messageId]` → 该轮；**只在 finalMessageId 上渲染一次**
 * （没有 finalMessageId 时按 turn 去重到 messageIds 最后一条；序列不可得就**不渲染**）。
 *
 * 三态（03 §2.2）：
 * - `影响 {n}`（n>0，可点）；
 * - n === 0 → **不渲染**（绝不显示"影响 0"，06 N-15）；
 * - 数据未到 → 灰图标（tooltip = state.loadingDetail）；读取失败 → 灰图标（tooltip = state.unknown）；
 *   本轮仍在记录 → 灰图标（tooltip = state.partialTurn）。
 *
 * 点击（T20；2026-11-05 用户真机反馈「点击后不要再出现窗口，直接跳到 tab 的『脉络』里」）：
 * - ready → `requestFocus({ kind: 'turn' })`（带该轮）；
 * - loading / unknown / streaming → `requestFocus({ kind: 'session' })`（tab 自己有加载态与「重新读取」）；
 * 两种情况都 `activateThreadlineTab()`。**不弹任何窗口**、不投递、不写存储。
 * 计数只进 aria-label/title（与宿主 feedback 图标观感一致），不再有 popover。
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
import { decideImpact, type ImpactDecision } from './impactModel.ts'
import { defaultFetch, readSnapshot, registerSlot, type ClientScopeLike, type SnapshotHook } from './context.ts'
import { requestFocus, activateThreadlineTab, type FocusTarget } from '../state/viewFocus.ts'
import { getDetailStore } from '../state/detailStore.ts'
import { ErrorBoundary } from '../ui/shell/index.ts'
import { PrivacyProvider } from '../privacy/index.ts'
import { setPrivacyMode, usePrivacyMode } from '../state/privacyStore.ts'

const h = React.createElement

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

/**
 * 「影响」图标（D-25：与宿主 action row 的 feedback 图标同观感）。
 * 手写 16x16 内联 SVG（不引第三方图标库）：一个节点分叉成两条线 = "这一轮对工作区的影响/关系"。
 * 计数**不进视觉**（宿主 feedback 图标也没有数字），完整计数在 aria-label/tooltip 里给。
 */
export function ImpactIcon(): React.ReactElement {
  // 2026-11-04 真机反馈「图标深浅不对」+「要和别人的一样」：
  // 宿主 action row 的图标是**描边线性图标**（stroke 1.4，圆角端点，无实心块），颜色用 label-secondary 一族。
  // 所以这里改成同风格的描边图：三个空心节点 + 两条连线，全部 stroke=currentColor / fill=none；
  // 颜色由 CSS 的 color 决定（.threadline-impact-icon-btn 用 --dsw-alias-label-tertiary/secondary），不写死 fill。
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

/** 图标点击的落点：ready 带轮次；loading / unknown / streaming 只带会话（tab 自己加载）。 */
export type ImpactFocusTarget = Extract<FocusTarget, { kind: 'turn' } | { kind: 'session' }>

/**
 * 三态判定 → 点击落点（纯函数，可单测）。
 * hidden 不渲染按钮，返回 null；sessionId 为空也不落点（decideImpact 已把它判成 hidden）。
 */
export function impactFocusTargetOf(decision: ImpactDecision, sessionId: string): ImpactFocusTarget | null {
  if (sessionId === '') return null
  if (decision.kind === 'hidden') return null
  if (decision.kind === 'ready') return { kind: 'turn', sessionId, turn: decision.turn.n }
  return { kind: 'session', sessionId }
}

/**
 * 点击「影响」的**唯一**动作：先登记跨入口聚焦目标，再切到「脉络」tab。
 *
 * 不弹窗口、不投递、不写存储；tab 找不到时返回 false（viewFocus 记下失败原因，用户仍可手动切）。
 * 导出是为了让单测用假 document 验证"点击 = 导航"这条真实路径（SSR 不跑事件）。
 */
export function openThreadlineForImpact(target: ImpactFocusTarget): boolean {
  requestFocus(target)
  return activateThreadlineTab()
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
    h(PrivacyProvider, { mode, onChange: setPrivacyMode }, h(ImpactBody, props)),
  )
}

/** 按钮主体（在 Provider 内）。 */
function ImpactBody(props: ImpactActionProps): React.ReactElement | null {
  const t: Translator = React.useMemo(() => createTranslator(props.locale ?? DEFAULT_LOCALE), [props.locale])
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

  // 未加载 / 失败 / 本轮仍在记录：图标仍在、**可点**，点了同样导航到 tab（tab 自己有加载态与「重新读取」）。
  // streaming 是 2026-11-05 新增：live 会话 detail 未读全时**不许静默隐藏**（否则用户看到"图标又消失了"）。
  const label =
    decision.kind === 'ready'
      ? t('impact.tooltip', { files: decision.counts.files, commands: decision.counts.commands, subagents: decision.counts.subagents })
      : decision.kind === 'streaming'
        ? t('state.partialTurn')
        : decision.kind === 'loading'
          ? t('state.loadingDetail')
          : t('state.unknown')
  const focusTarget = impactFocusTargetOf(decision, sessionId)
  const onOpen = (): void => {
    if (focusTarget === null) return
    openThreadlineForImpact(focusTarget)
  }

  return h(
    'span',
    {
      className: IMPACT_ROOT_CLASS,
      'data-threadline-impact': '',
      'data-state': decision.kind,
      ...(decision.kind === 'ready' ? { 'data-impact-count': String(decision.counts.n) } : {}),
      'data-testid': props.testId ?? 'impact',
    },
    h(
      'button',
      {
        type: 'button',
        className: 'threadline-impact-icon-btn',
        'aria-label': label,
        title: label,
        onClick: onOpen,
      },
      h(ImpactIcon),
    ),
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
