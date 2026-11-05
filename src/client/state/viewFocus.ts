/*
 * state/viewFocus.ts —— 跨入口聚焦的**唯一内存桥**（04 §5.6；03 §2.1/§2.2/§2.3 的「在脉络中查看」）。
 *
 * 为什么需要它：`conversation.view` 的 ownerProps 里有 `openView`，但「每轮影响」和
 * 「/threadline 弹窗」不在该 slot 内，拿不到它；三个入口之间只能用一份**内存**约定传"看哪一轮/哪个文件"。
 *
 * 纪律：
 * - **不持久化**：只在模块内存里放 pending target，tab 消费后立刻清掉（不写任何存储）；
 * - **DOM 查询只允许出现在本文件**（`activateThreadlineTab`），别处不许散落 `querySelector`；
 * - 任何一步失败都返回 `false` / `null`，不抛错、不白屏（宿主 DOM 或本地化 label 变了也不崩）。
 */
import type { Selection } from '../ui/turns/index.ts'
import { select } from '../ui/turns/index.ts'

/** 跨入口聚焦目标（语义自定的不透明字符串由 `focusTokenOf` 生成）。 */
export type FocusTarget =
  | { kind: 'turn'; sessionId: string; turn: number }
  | { kind: 'file'; sessionId: string; path: string }
  | { kind: 'session'; sessionId: string }

/** 等待被 tab 消费的目标（key = sessionId）。 */
const pending = new Map<string, FocusTarget>()

/** 最近一次激活失败原因（诊断用，不上报、不打印正文）。 */
let lastActivationFailure: string | null = null

/** 登记一个"切到 tab 后要看什么"。同一会话只保留最后一个（后者覆盖，不排队）。 */
export function requestFocus(target: FocusTarget): void {
  if (typeof target.sessionId !== 'string' || target.sessionId === '') return
  if (target.kind === 'turn' && (!Number.isInteger(target.turn) || target.turn < 1)) return
  if (target.kind === 'file' && (typeof target.path !== 'string' || target.path === '')) return
  pending.set(target.sessionId, target)
}

/** 取走并清除（tab 应用选择后调用；没取到返回 null）。 */
export function takeFocus(sessionId: string): FocusTarget | null {
  const target = pending.get(sessionId)
  if (target === undefined) return null
  pending.delete(sessionId)
  return target
}

/** 只看不取（诊断/测试用）。 */
export function peekFocus(sessionId: string): FocusTarget | null {
  return pending.get(sessionId) ?? null
}

/** 清空（全部或某个会话）；卸载或换工作区时调用。 */
export function clearFocus(sessionId?: string): void {
  if (sessionId === undefined) pending.clear()
  else pending.delete(sessionId)
}

/** 当前 pending 条数（测试断言"消费后清空"）。 */
export function pendingFocusCount(): number {
  return pending.size
}

/** 聚焦目标 → 不透明字符串（`openView('threadline', token)` / `viewRequest.focus` 用）。 */
export function focusTokenOf(target: FocusTarget): string {
  switch (target.kind) {
    case 'turn':
      return 'turn:' + String(target.turn)
    case 'file':
      return 'file:' + target.path
    case 'session':
      return 'session:' + target.sessionId
    default:
      return ''
  }
}

/**
 * 不透明字符串 → 聚焦目标。
 * 协议（03 §2；T01 确认 focus 语义由目标 view 自定）：
 *   `turn:<n>` / `file:<工作区相对路径>` / `session:<sessionId>`
 * 其它形态一律 null（不猜）。
 */
export function parseFocusToken(token: unknown, sessionId: string): FocusTarget | null {
  if (typeof token !== 'string' || token === '') return null
  const separator = token.indexOf(':')
  if (separator <= 0) return null
  const kind = token.slice(0, separator)
  const rest = token.slice(separator + 1)
  if (rest === '') return null
  if (kind === 'turn') {
    const turn = Number(rest)
    if (!Number.isInteger(turn) || turn < 1) return null
    return { kind: 'turn', sessionId, turn }
  }
  if (kind === 'file') return { kind: 'file', sessionId, path: rest }
  if (kind === 'session') return { kind: 'session', sessionId: rest }
  return null
}

/** 聚焦目标 → 选择值（tab 用它一次 dispatch 完）。 */
export function selectionOfFocus(target: FocusTarget): Selection {
  switch (target.kind) {
    case 'turn':
      return select.turn(target.sessionId, target.turn)
    case 'file':
      return select.file(target.path)
    case 'session':
      return select.session(target.sessionId)
    default:
      return select.none()
  }
}

/** tab 按钮的可读文案候选（中文默认 + 英文对等；label 随宿主语言变化时多试一个）。 */
const TAB_LABELS = ['脉络', 'Threadline'] as const

/**
 * 单帧激活尝试（找到就 click）。优先级：
 * 1. `data-view-id="threadline"`（宿主明确标注时最可靠）；
 * 2. `[role="tab"]` 的 textContent 精确 / 包含 label；
 * 3. `aria-label` 精确 / 包含 label。
 * 找不到返回 false（不抛错）；DOM 抛错由调用方兜。
 */
function clickThreadlineTab(doc: Document): boolean {
  const tabs = Array.from(doc.querySelectorAll<HTMLElement>('[role="tab"], [data-view-id]'))
  const byData = tabs.find((el) => (el.getAttribute('data-view-id') ?? '').trim() === 'threadline')
  if (byData !== undefined) {
    byData.click()
    return true
  }
  for (const label of TAB_LABELS) {
    const byText = tabs.find((el) => {
      const text = (el.textContent ?? '').trim()
      return text === label || text.includes(label)
    })
    if (byText !== undefined) {
      byText.click()
      return true
    }
    const byAria = tabs.find((el) => (el.getAttribute('aria-label') ?? '').trim().includes(label))
    if (byAria !== undefined) {
      byAria.click()
      return true
    }
  }
  return false
}

/**
 * 切到「脉络」tab。
 *
 * 只在**本文件**做 DOM 查询。找到就 `click()` 并返回 true；
 * 没找到时**下一帧再试一次**（宿主 tab 可能比 action row 晚一帧挂载；只在有 requestAnimationFrame
 * 的浏览器里调度，Node 单测不触发），首帧仍返回 false 并记下原因。
 * 抛错返回 false（调用方仍可手动切，不白屏）。
 */
export function activateThreadlineTab(doc: Document | null = typeof document === 'undefined' ? null : document): boolean {
  lastActivationFailure = null
  if (doc === null) {
    lastActivationFailure = 'no-document'
    return false
  }
  try {
    if (clickThreadlineTab(doc)) return true
  } catch (error) {
    lastActivationFailure = 'dom-error'
    return false
  }
  lastActivationFailure = 'tab-not-found'
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => {
      try {
        if (clickThreadlineTab(doc)) lastActivationFailure = null
        else lastActivationFailure = 'tab-not-found'
      } catch (error) {
        lastActivationFailure = 'dom-error'
      }
    })
  }
  return false
}

/** 最近一次激活失败原因（null = 没有失败）。 */
export function activationFailure(): string | null {
  return lastActivationFailure
}
