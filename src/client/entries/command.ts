/*
 * entries/command.ts —— `/threadline` 命令 + `conversation.input.overlay` 弹窗（03 §2.3 / §9；06 A43-3/A43-4）。
 *
 * 两件事：
 * 1. `inputTriggers.registerSource(...)`：菜单里出现「脉络」，Enter 精确匹配 `/threadline` 与 `/脉络`
 *    （T01 已静态确认中文整行能被我们自己的 matchEnter 认领；两条都注册，菜单 label 仍走 locale）；
 * 2. `conversation.input.overlay` 槽里渲染居中弹窗（状态放在 `ui/modal/store.ts`，按会话内存态）。
 *
 * 纪律：无 LLM、无生成文字；`registerSource` 返回的 disposer 进 `ctx.effect`；
 * `inputTriggers` 服务缺失只 warn（不崩，命令入口缺失由验收发现）。
 */
import * as React from 'react'
import { createTranslator, DEFAULT_LOCALE, type Locale, type Translator } from '../locale/index.ts'
import type { FetchLike } from '../data/index.ts'
import {
  threadlineWorkspaceKey,
  useThreadlineDetail,
  useWorkspaceScope,
  type WarmupSession,
} from '../data/index.ts'
import type { FileNode, SessionDetail } from '../../shared/events/index.ts'
import { requestFocus, activateThreadlineTab } from '../state/viewFocus.ts'
import { PrivacyProvider } from '../privacy/index.ts'
import { setPrivacyMode, usePrivacyMode } from '../state/privacyStore.ts'
import { getDetailStore } from '../state/detailStore.ts'
import { closeModal, openModal, useModalState } from '../ui/modal/store.ts'
import { fileNodesOfDetail } from '../ui/modal/model.ts'
import { ThreadlineModal, type ModalFocusRequest } from '../ui/modal/ThreadlineModal.ts'
import { defaultFetch, readSnapshot, registerSlot, warn, type ClientScopeLike, type SnapshotHook } from './context.ts'

/** 命令名字（ASCII 标识；菜单 label 走 locale）。 */
export const COMMAND_NAME = 'threadline'

/** Enter 可认领的整行（中文别名与英文原名都对；其它一律不认领）。 */
export const COMMAND_TOKENS: readonly string[] = ['/threadline', '/脉络']

/** `inputTriggers.registerSource` 的结构形状（不 import 宿主包）。 */
export interface InputTriggerCandidate {
  name: string
  label: string
  section?: string
  description?: string
}

/** 候选上下文（宿主动态推进；只用我们要的字段）。 */
export interface InputTriggerContext {
  session?: { sessionId?: string }
  sessionId?: string
  position?: string
}

/** 菜单点击上下文（rc.5：onPick({ candidate, session, position, via, action, span })）。 */
export interface InputPickContext extends InputTriggerContext {
  candidate?: { name?: string }
  action?: string
}

/** `matchEnter` 的整行匹配上下文。 */
export interface InputEnterContext {
  sessionId?: string
}

export interface InputTriggerMatch {
  query: string
  position?: string
}

/** 注册源（宿主 `inputTriggers.registerSource` 的入参形状）。 */
export interface InputTriggerSource {
  trigger: string
  name: string
  order?: number
  candidates(context: InputTriggerContext, match: InputTriggerMatch): Promise<InputTriggerCandidate[]>
  onPick(context: InputPickContext): 'handled' | void
  matchEnter(context: InputEnterContext, line: string): Promise<'handled' | void>
}

export interface InputTriggersLike {
  registerSource?(source: InputTriggerSource): unknown
}

/** 从宿主上下文里取 sessionId（两条路径都试；取不到返回 ''）。 */
function contextSessionId(context: InputTriggerContext | undefined): string {
  const direct = context?.sessionId
  if (typeof direct === 'string' && direct !== '') return direct
  const nested = context?.session?.sessionId
  if (typeof nested === 'string' && nested !== '') return nested
  return ''
}

/** 命令注册（返回值 = 两条注册是否都成功；失败只 warn）。 */
export function registerCommand(ctx: ClientScopeLike, options?: { locale?: Locale }): boolean {
  const t = createTranslator(options?.locale ?? DEFAULT_LOCALE)
  let triggersRegistered = false
  let attempted = false

  const setupTriggers = (scope: ClientScopeLike): void => {
    // 幂等：inject 回调可能晚到，get 分支也可能先命中
    if (attempted) return
    const triggers = scope.get<InputTriggersLike>('inputTriggers')
    if (triggers === undefined || typeof triggers.registerSource !== 'function') {
      warn(scope, 'inputTriggers 不可用，跳过 /threadline 命令')
      return
    }
    attempted = true
    const source: InputTriggerSource = {
      trigger: '/',
      name: COMMAND_NAME,
      order: 1,
      candidates: (context, match) => {
        if (match.position !== undefined && match.position !== 'leading') return Promise.resolve([])
        const query = match.query.trim().toLowerCase()
        if (query !== '' && !COMMAND_NAME.startsWith(query)) return Promise.resolve([])
        return Promise.resolve([{ name: COMMAND_NAME, label: t('tab.label') }])
      },
      onPick: (context) => {
        // rc.5：pick.candidate.name 才是归属；不是我们的命令就交还给宿主（不抢占别人的 pick）
        const candidateName = context.candidate?.name
        if (typeof candidateName === 'string' && candidateName !== COMMAND_NAME) return undefined
        openModal(contextSessionId(context))
        return 'handled'
      },
      matchEnter: (context, line) => {
        const text = typeof line === 'string' ? line.trim() : ''
        if (!COMMAND_TOKENS.includes(text)) return Promise.resolve(undefined)
        openModal(contextSessionId(context))
        return Promise.resolve('handled')
      },
    }
    try {
      if (typeof scope.effect !== 'function') {
        const dispose = triggers.registerSource(source)
        void dispose
        triggersRegistered = true
        return
      }
      scope.effect(() => {
        const dispose = triggers.registerSource?.(source)
        return typeof dispose === 'function' ? (dispose as () => void) : () => undefined
      }, 'threadline: /threadline command')
      triggersRegistered = true
    } catch (error) {
      warn(scope, '注册 /threadline 命令失败：' + String(error instanceof Error ? error.message : error))
    }
  }

  // rc.5 真实契约：服务在 apply 时可能还没就绪 → 以 ctx.inject(['inputTriggers']) 为主；
  // 若服务已存在则立即注册（也防 inject 回调晚到导致的漏注册）；两者都不行才 warn。
  try {
    if (ctx.get('inputTriggers') !== undefined) setupTriggers(ctx)
    if (typeof ctx.inject === 'function') {
      ctx.inject(['inputTriggers'], (scope) => {
        setupTriggers((scope ?? ctx) as ClientScopeLike)
      })
    }
    if (!attempted) {
      // 没有 inject 通道、服务也没就绪 → 显式警告（不崩；入口缺失由验收发现）
      warn(ctx, 'inputTriggers 服务尚未就绪（已尝试 inject 与 get），/threadline 菜单可能不可见')
    }
  } catch (error) {
    warn(ctx, '解析 inputTriggers 失败：' + String(error instanceof Error ? error.message : error))
  }

  const overlayRegistered = registerSlot(
    ctx,
    'conversation.input.overlay',
    { id: 'threadline-modal', order: 20 },
    (props: never) => React.createElement(ThreadlineOverlay, { ...(props as unknown as OverlaySlotProps), locale: options?.locale }),
    'threadline: input overlay',
  )

  return triggersRegistered && overlayRegistered
}

/** `conversation.input.overlay` 的 props（宿主标准 props + 我们自己要的）。 */
export interface OverlaySlotProps {
  sessionId?: string
  useSessions?: SnapshotHook
  /** T13e：宿主标准 props；解析工作区用（workspaceKey/cwd 必须与 tab 同一把）。 */
  useWorkspaces?: SnapshotHook
  /** 测试注入：固定 fetch（缺省用宿主页面的同源 fetch）。 */
  fetch?: FetchLike
  locale?: Locale
}

/** 弹窗入口组件：先套隐私 Provider（与 tab 共享同一份模式），再渲染弹窗。 */
export function ThreadlineOverlay(props: OverlaySlotProps): React.ReactElement {
  const mode = usePrivacyMode()
  return React.createElement(PrivacyProvider, { mode, onChange: setPrivacyMode }, React.createElement(OverlayBody, { ...props, mode }))
}

/** 弹窗主体（在 Provider 内）。 */
function OverlayBody(props: OverlaySlotProps & { mode: 'metadata' | 'hidden' }): React.ReactElement | null {
  const t: Translator = React.useMemo(() => createTranslator(props.locale ?? DEFAULT_LOCALE), [props.locale])
  const sessions = readSnapshot<{ current?: string }>(props.useSessions)
  const sessionId =
    typeof props.sessionId === 'string' && props.sessionId !== ''
      ? props.sessionId
      : typeof sessions?.current === 'string'
        ? sessions.current
        : ''
  const state = useModalState(sessionId)
  const fetchImpl = props.fetch ?? defaultFetch()
  const store = getDetailStore(fetchImpl)
  // T13e：直接按 /threadline 也要能用（不必先开 tab）：带 cwd 走 cold-read + 幂等预热。
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
  const entry = useThreadlineDetail(store, sessionId === '' ? null : sessionId, {
    ...(detailCwd === undefined ? {} : { cwd: detailCwd }),
    ...(warmup === undefined ? {} : { warmup }),
    fetch: fetchImpl,
  })
  const detail: SessionDetail | null = entry?.detail ?? null
  const nodes: FileNode[] = React.useMemo(() => fileNodesOfDetail(detail), [detail])
  const files = React.useMemo(() => {
    const map = new Map<string, FileNode>()
    for (const node of nodes) map.set(node.path.toLowerCase(), node)
    return map
  }, [nodes])

  // 弹窗打开时若数据还没到，主动请求一次（不阻塞其它 UI）
  React.useEffect(() => {
    if (!state.open || sessionId === '') return
    if (entry !== null && entry.status !== 'idle') return
    void store.request(sessionId, detailCwd === undefined ? {} : { cwd: detailCwd }).catch(() => undefined)
  }, [state.open, sessionId, store, entry])

  const onOpenFull = React.useCallback(
    (target: ModalFocusRequest) => {
      if (sessionId === '') return
      if (target.kind === 'turn' && typeof target.turn === 'number') {
        requestFocus({ kind: 'turn', sessionId, turn: target.turn })
      } else if (target.kind === 'file' && typeof target.path === 'string') {
        requestFocus({ kind: 'file', sessionId, path: target.path })
      } else {
        requestFocus({ kind: 'session', sessionId })
      }
      activateThreadlineTab()
      closeModal(sessionId)
    },
    [sessionId],
  )

  return React.createElement(ThreadlineModal, {
    open: state.open,
    sessionId,
    detail,
    detailLoading: entry === null || (entry.status === 'loading' && detail === null),
    detailError: entry?.status === 'error',
    files,
    mode: props.mode,
    t,
    onClose: () => closeModal(sessionId),
    onRetry: () => {
      void store.refresh(sessionId).catch(() => undefined)
    },
    onOpenFull,
    testId: 'threadline-modal',
  })
}
