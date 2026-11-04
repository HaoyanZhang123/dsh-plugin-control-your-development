/*
 * a11y/focusTrap.ts —— 只做**再导出**：焦点陷阱的唯一实现是 `ui/common/focusTrap.ts`（T06）。
 *
 * 为什么不复制：T06 已经把 Tab 循环边界算成纯函数并单测过（`nextTrapIndex` / `trapTabKey`），
 * 这里再写一份必然漂移。T10 需要它时从这里 import，实现仍然只有一处。
 */
export {
  FOCUSABLE_SELECTOR,
  nextTrapIndex,
  queryFocusable,
  trapTabKey,
  type FocusableRoot,
  type TabKeyEvent,
} from '../ui/common/index.ts'
