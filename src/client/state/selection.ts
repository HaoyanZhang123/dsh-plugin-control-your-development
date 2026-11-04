/*
 * state/selection.ts —— 三入口共享的**选择/聚焦**薄层（04 §5.6；06 A43-4）。
 *
 * 这里**没有第二套状态机**：选择归约器、Esc 逐层、预览/固定全部直接 re-export `ui/turns` 的实现；
 * 本文件只补两件入口级的事：
 * 1. `viewRequest` 的**一次性消费**（同一请求对象只消费一次、completeViewRequest 只调一次）；
 * 2. focus 协议（`turn:<n>` / `file:<path>` / `session:<id>`）→ 选择值的映射。
 */
export {
  NO_SELECTION,
  canEscape,
  createSelectionState,
  effectiveSelection,
  escapeSelection,
  sameSelection,
  select,
  selectionKey,
  selectionReducer,
  type Selection,
  type SelectionAction,
  type SelectionState,
} from '../ui/turns/index.ts'

export {
  activationFailure,
  activateThreadlineTab,
  clearFocus,
  focusTokenOf,
  parseFocusToken,
  peekFocus,
  pendingFocusCount,
  requestFocus,
  selectionOfFocus,
  takeFocus,
  type FocusTarget,
} from './viewFocus.ts'

import type { Selection } from '../ui/turns/index.ts'
import { parseFocusToken, selectionOfFocus, type FocusTarget } from './viewFocus.ts'

/** 本插件在 `conversation.view` 里的 view id（与注册参数同一字面量）。 */
export const THREADLINE_VIEW_ID = 'threadline'

/** host 的 `viewRequest` 形状（focus 是不透明字符串，语义由本 view 自定）。 */
export interface ViewRequestLike {
  view?: string
  focus?: string | null
}

/** 一次 viewRequest 的消费结果。 */
export interface FocusConsumeResult {
  consumed: boolean
  target: Selection | null
  /** 要把什么记成"已消费"（调用方存进 ref；下次同样的对象直接跳过）。 */
  last: unknown
}

/**
 * 消费 `viewRequest`：
 * - `request` 为空 / `view` 不是我们 → 不动；
 * - 同一个请求对象消费过 → 不动（React 重渲染/StrictMode 都不会重复处理）；
 * - 否则：解析 focus → 选择值，**并调用一次 `complete`**（即使 focus 不合法也要 complete，
 *   否则宿主会一直停在"请求中"）。
 */
export function consumeFocusRequest(input: {
  request: ViewRequestLike | null | undefined
  sessionId: string
  /** 上一次消费的请求对象（null = 还没消费过）。 */
  last: unknown
  /** 宿主回调（`ownerProps.completeViewRequest`）。 */
  complete?: (() => void) | undefined
}): FocusConsumeResult {
  const request = input.request
  if (request === null || request === undefined) return { consumed: false, target: null, last: input.last }
  if (typeof request.view === 'string' && request.view !== THREADLINE_VIEW_ID) {
    return { consumed: false, target: null, last: input.last }
  }
  if (input.last === request) return { consumed: false, target: null, last: input.last }
  const focus: unknown = request.focus
  const target: FocusTarget | null = parseFocusToken(focus, input.sessionId)
  try {
    input.complete?.()
  } catch {
    // 宿主回调抛错不影响我们：请求已消费，不重复触发
  }
  return { consumed: true, target: target === null ? null : selectionOfFocus(target), last: request }
}

/** focus 字符串是否可用于我们的协议（测试/诊断用；不触发任何副作用）。 */
export function isFocusToken(value: unknown, sessionId: string): boolean {
  return parseFocusToken(value, sessionId) !== null
}
