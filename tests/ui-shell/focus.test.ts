/*
 * focus.test.ts —— 焦点陷阱与焦点环的纯逻辑判据（03 §15）。
 *
 * 这些是"能真断言"的部分：Tab 循环边界、焦点环类名、tooltip 的 aria-describedby id。
 * 真实 DOM 里的焦点行为由 harness 的页面断言覆盖（tests/harness）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { FOCUSABLE_SELECTOR, nextTrapIndex, queryFocusable, trapTabKey, type FocusableRoot } from '../../src/client/ui/common/focusTrap.ts'
import { FOCUS_RING_CLASS, focusRingClassName } from '../../src/client/ui/common/FocusRing.ts'
import { tooltipDescriptionId } from '../../src/client/ui/common/Tooltip.ts'
import { BREAKPOINTS, SHELL_METRICS } from '../../src/client/ui/shell/types.ts'

test('Tab 在面板内循环（正向/反向/空容器）', () => {
  assert.equal(nextTrapIndex(3, -1, false), 0)
  assert.equal(nextTrapIndex(3, 0, false), 1)
  assert.equal(nextTrapIndex(3, 2, false), 0, '最后一个之后回到第一个')
  assert.equal(nextTrapIndex(3, 0, true), 2, 'Shift+Tab 从第一个回到最后一个')
  assert.equal(nextTrapIndex(3, 1, true), 0)
  assert.equal(nextTrapIndex(0, -1, false), -1)
})

function fakeRoot(count: number): FocusableRoot {
  const nodes = Array.from({ length: count }, (_, index) => ({ index })) as unknown as Element[]
  return { querySelectorAll: () => nodes }
}

test('trapTabKey 接管 Tab 并聚焦循环目标', () => {
  const focused: number[] = []
  const nodes = Array.from({ length: 3 }, (_, index) => ({
    index,
    focus() {
      focused.push(index)
    },
  })) as unknown as Element[]
  const root: FocusableRoot = { querySelectorAll: () => nodes }
  let prevented = false
  const handled = trapTabKey(
    { key: 'Tab', shiftKey: false, preventDefault: () => { prevented = true } },
    root,
    nodes[2],
  )
  assert.equal(handled, true)
  assert.equal(prevented, true)
  assert.deepEqual(focused, [0], '最后一个之后应回到第一个')
})

test('trapTabKey 对非 Tab 键不接管', () => {
  const handled = trapTabKey({ key: 'Escape', shiftKey: false, preventDefault: () => undefined }, fakeRoot(2), null)
  assert.equal(handled, false)
})

test('可聚焦选择器覆盖 button/a/input/[tabindex]/contenteditable，并排除 disabled', () => {
  assert.match(FOCUSABLE_SELECTOR, /button:not\(\[disabled\]\)/)
  assert.match(FOCUSABLE_SELECTOR, /a\[href\]/)
  assert.match(FOCUSABLE_SELECTOR, /\[tabindex\]:not\(\[tabindex="-1"\]\)/)
  assert.match(FOCUSABLE_SELECTOR, /\[contenteditable="true"\]/)
  assert.deepEqual(queryFocusable(null), [])
})

test('焦点环类名唯一且可叠加', () => {
  assert.equal(FOCUS_RING_CLASS, 'threadline-focus-ring')
  assert.equal(focusRingClassName('x', false, undefined, 'y'), 'threadline-focus-ring x y')
})

test('tooltip 的 aria-describedby id 被净化成选择器安全字符串', () => {
  assert.equal(tooltipDescriptionId(':r0:'), 'threadline-tip-r0')
  assert.equal(tooltipDescriptionId(':r1a:'), 'threadline-tip-r1a')
  assert.equal(tooltipDescriptionId(''), 'threadline-tip-x')
  assert.match(tooltipDescriptionId(':R5:'), /^[A-Za-z][A-Za-z0-9_-]*$/)
})

test('区域几何符合 D-28（星图首屏 520；header/now/timeline 仍按规范像素）', () => {
  // D-28（2026-11-04 用户定）：tab 改成页面流 —— 星图占首屏（>=520，宽屏 640），其余往下滚；
  // header 吸顶 56、Now 36、时间轴 48 仍是固定像素；轮次带不再锁 92px 内滚（token 保留为设计刻度）。
  assert.equal(SHELL_METRICS.header, 56)
  assert.equal(SHELL_METRICS.timeline, 48)
  assert.equal(SHELL_METRICS.inspector, 340)
  assert.equal(SHELL_METRICS.inspectorWide, 360)
  assert.equal(SHELL_METRICS.mapMinHeight, 520)
  for (const value of [SHELL_METRICS.header, SHELL_METRICS.timeline, SHELL_METRICS.mapMinHeight, SHELL_METRICS.turnsCollapsed]) {
    assert.equal(value % 8, 0, value + ' 应在 8px 网格上')
  }
  assert.equal(SHELL_METRICS.now, 36)
  assert.equal(SHELL_METRICS.turns, 92)
})

test('断点是严格递减的宿主面板宽度（1100 > 900 > 600 > 420）', () => {
  assert.ok(BREAKPOINTS.wide > BREAKPOINTS.medium)
  assert.ok(BREAKPOINTS.medium > BREAKPOINTS.narrow)
  assert.ok(BREAKPOINTS.narrow > BREAKPOINTS.minimum)
})
