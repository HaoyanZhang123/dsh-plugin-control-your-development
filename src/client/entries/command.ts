/*
 * entries/command.ts —— `/threadline` 命令（03 §2.3 / §9；06 A43-3/A43-4；T32）。
 *
 * 只有一件事：`inputTriggers.registerSource(...)` —— 菜单里出现「脉络」，Enter 精确匹配 `/threadline` 与 `/脉络`
 * （T01 已静态确认中文整行能被我们自己的 matchEnter 认领；两条都注册，菜单 label 仍走 locale）。
 *
 * 触发（菜单 pick / Enter）= **跳到「脉络」tab 并聚焦当前会话**：
 * `requestFocus({ kind: 'session' })` + `activateThreadlineTab()`。
 * T32（2026-11-05 notes/33 §1/§7）：**删除弹窗** —— `conversation.input.overlay` 注册、`ui/modal/**`、
 * `styles/modal.css` 全部删除；这里不弹任何窗口、不投递、不写存储。
 * 命令上下文只给 `sessionId`（没有"当前轮"），所以落点固定为会话级 focus；轮级聚焦由每轮「影响」图标（T20）负责。
 *
 * 纪律：无 LLM、无生成文字；`registerSource` 返回的 disposer 进 `ctx.effect`；
 * `inputTriggers` 服务缺失只 warn（不崩，命令入口缺失由验收发现）。
 */
import { createTranslator, DEFAULT_LOCALE, type Locale } from '../locale/index.ts'
import { requestFocus, activateThreadlineTab } from '../state/viewFocus.ts'
import { warn, type ClientScopeLike } from './context.ts'

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

/**
 * 命令触发的**唯一**动作：先登记会话级跨入口 focus（有 sessionId 时），再切到「脉络」tab。
 * 不弹窗、不投递、不写存储；tab 找不到时返回 false（viewFocus 记下原因，用户仍可手动切）。
 * 导出是为了让单测用假 document 验证"命令触发 = 导航"这条真实路径（SSR 不跑事件）。
 */
export function openThreadlineForCommand(sessionId: string): boolean {
  if (typeof sessionId === 'string' && sessionId !== '') requestFocus({ kind: 'session', sessionId })
  return activateThreadlineTab()
}

/** 命令注册（返回值 = trigger source 是否注册成功；失败只 warn）。 */
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
        openThreadlineForCommand(contextSessionId(context))
        return 'handled'
      },
      matchEnter: (context, line) => {
        const text = typeof line === 'string' ? line.trim() : ''
        if (!COMMAND_TOKENS.includes(text)) return Promise.resolve(undefined)
        openThreadlineForCommand(contextSessionId(context))
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

  return triggersRegistered
}
