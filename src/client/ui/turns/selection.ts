/*
 * turns/selection.ts —— 「选择」的唯一实现（03 §6 / §8 / §15；06 A42-4）。
 *
 * 为什么放在这里：轮次带、检查器、星图（T07）与三个入口（T09）共享同一套选择语义，
 * 选择状态必须是 **props + 回调**，不许各组件自己再造一套状态机。本文件只有纯函数，
 * 没有任何 React / DOM 依赖，因此可以被 T07/T09 直接调用，也可以在 node --test 里单测。
 *
 * 语义（03 §6 / §15）：
 * - `hover`   → 只改 `preview`（预览），不动 `selected`（固定选择）；
 * - `click`   → 固定选择，并清掉预览、打开检查器；
 * - `blank`   → 空白处取消固定选择（检查器回到工作区概览）；
 * - `escape`  → **逐层退出**：先退预览 → 再退固定选择 → 再关检查器；
 *               返回 `consumed=false` 时说明这一层已经没有可退的，交给上层（T09 关 tab/modal）。
 * - `move`    → 方向键：在候选序列里移动，效果等价于 hover（预览 + 焦点跟随）。
 */

/** 空选择（无选中 = 检查器显示工作区概览）。 */
export interface SelectionNone {
  kind: 'none'
}

/** 选中一个文件（工作区相对 POSIX 路径）。 */
export interface SelectionFile {
  kind: 'file'
  path: string
}

/** 选中某会话的某一轮。 */
export interface SelectionTurn {
  kind: 'turn'
  sessionId: string
  turn: number
}

/** 选中一个会话。 */
export interface SelectionSession {
  kind: 'session'
  sessionId: string
}

/** 选择目标（不可变值；比较用 `sameSelection` / `selectionKey`）。 */
export type Selection = SelectionNone | SelectionFile | SelectionTurn | SelectionSession

/** 空选择的单例（避免各处新建对象）。 */
export const NO_SELECTION: Selection = { kind: 'none' }

/** 选择状态：固定选择 + hover 预览 + 检查器开关。 */
export interface SelectionState {
  selected: Selection
  preview: Selection | null
  inspectorOpen: boolean
}

/** 选择动作（组件的回调最终都落到这里）。 */
export type SelectionAction =
  | { type: 'hover'; target: Selection | null }
  | { type: 'click'; target: Selection }
  | { type: 'keyboard'; target: Selection }
  | { type: 'move'; target: Selection }
  | { type: 'blank' }
  | { type: 'openInspector' }
  | { type: 'closeInspector' }
  | { type: 'escape' }

/** 初始状态：默认选中当前轮 → 由调用方传入 selected。 */
export function createSelectionState(selected: Selection = NO_SELECTION, inspectorOpen = false): SelectionState {
  return { selected, preview: null, inspectorOpen }
}

/** 选择值的稳定键（用于 DOM data-attribute、React key、去重）。 */
export function selectionKey(selection: Selection): string {
  switch (selection.kind) {
    case 'none':
      return 'none'
    case 'file':
      return 'file:' + selection.path
    case 'turn':
      return 'turn:' + selection.sessionId + ':' + String(selection.turn)
    case 'session':
      return 'session:' + selection.sessionId
    default:
      return 'none'
  }
}

/** 两个选择是否指向同一个目标。 */
export function sameSelection(a: Selection | null, b: Selection | null): boolean {
  if (a === null || b === null) return a === b
  return selectionKey(a) === selectionKey(b)
}

/** 当前应当呈现（检查器/高亮）的选择：预览优先，其次固定选择。 */
export function effectiveSelection(state: SelectionState): Selection {
  return state.preview ?? state.selected
}

/** 是否有可退的一层（供 Esc 上层联动判断）。 */
export function canEscape(state: SelectionState): boolean {
  return state.preview !== null || state.selected.kind !== 'none' || state.inspectorOpen
}

/**
 * Esc 的单层出栈（03 §15「Esc 逐层退出」）。
 * 返回新状态与 `consumed`：false 表示调用方该接管（例如关闭整个 tab / 弹窗）。
 */
export function escapeSelection(state: SelectionState): { state: SelectionState; consumed: boolean } {
  if (state.preview !== null) {
    return { state: { ...state, preview: null }, consumed: true }
  }
  if (state.selected.kind !== 'none') {
    return { state: { ...state, selected: NO_SELECTION }, consumed: true }
  }
  if (state.inspectorOpen) {
    return { state: { ...state, inspectorOpen: false }, consumed: true }
  }
  return { state, consumed: false }
}

/** 选择状态归约器（唯一一套；组件只 dispatch，不自己造状态）。 */
export function selectionReducer(state: SelectionState, action: SelectionAction): SelectionState {
  switch (action.type) {
    case 'hover':
      // 预览不该把「已固定」的选择压掉：preview 单独一格，渲染时由 effectiveSelection 决定。
      if (sameSelection(action.target, state.preview)) return state
      return { ...state, preview: action.target }
    case 'click':
      return {
        selected: sameSelection(action.target, state.selected) ? NO_SELECTION : action.target,
        preview: null,
        inspectorOpen: sameSelection(action.target, state.selected) ? state.inspectorOpen : true,
      }
    case 'keyboard':
      return { selected: action.target, preview: null, inspectorOpen: true }
    case 'move':
      return sameSelection(action.target, state.preview) ? state : { ...state, preview: action.target }
    case 'blank':
      if (state.selected.kind === 'none' && state.preview === null) return state
      return { ...state, selected: NO_SELECTION, preview: null }
    case 'openInspector':
      return state.inspectorOpen ? state : { ...state, inspectorOpen: true }
    case 'closeInspector':
      return state.inspectorOpen ? { ...state, inspectorOpen: false, preview: null } : state
    case 'escape':
      return escapeSelection(state).state
    default:
      return state
  }
}

/** 键盘移动的结果：新索引（环绕）+ 该索引对应的选择；空序列返回 null。 */
export function moveIndex(index: number, direction: 1 | -1, length: number): number | null {
  if (length <= 0) return null
  if (index < 0) return direction === 1 ? 0 : length - 1
  return (index + direction + length) % length
}

/** 在候选序列里移动一到格（方向键 / Home / End 的共用实现）。 */
export interface MoveResult {
  index: number
  target: Selection
}

/** 方向键移动：基于「当前选择在候选里的位置」计算下一个候选。 */
export function moveSelection(
  candidates: readonly Selection[],
  current: Selection | null,
  direction: 1 | -1 | 'first' | 'last',
): MoveResult | null {
  if (candidates.length === 0) return null
  const currentIndex = current === null ? -1 : candidates.findIndex((item) => sameSelection(item, current))
  let nextIndex: number | null
  if (direction === 'first') nextIndex = 0
  else if (direction === 'last') nextIndex = candidates.length - 1
  else nextIndex = moveIndex(currentIndex, direction, candidates.length)
  if (nextIndex === null) return null
  const target = candidates[nextIndex]
  if (target === undefined) return null
  return { index: nextIndex, target }
}

/** 构造选择值的小工具（组件里不手拼对象，避免字段名漂移）。 */
export const select = {
  none: (): Selection => NO_SELECTION,
  file: (path: string): Selection => ({ kind: 'file', path }),
  turn: (sessionId: string, turn: number): Selection => ({ kind: 'turn', sessionId, turn }),
  session: (sessionId: string): Selection => ({ kind: 'session', sessionId }),
}
