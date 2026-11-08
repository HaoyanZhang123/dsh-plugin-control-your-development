/*
 * tests/ui-turn/selection.test.ts —— 选择模型（03 §6 / §15；06 A42-4）。
 *
 * 选择状态是 props + 回调：唯一的归约器在 `ui/turns/selection.ts`。
 * 本文件钉死四件事：
 *   1. hover 只改预览，不动固定选择；
 *   2. click 固定、再点同一目标取消；空白取消；
 *   3. **Esc 逐层退出**：预览 → 固定 → 关检查器 → （consumed=false 交给上层关 tab）；
 *   4. 方向键在候选序列里环绕移动，Home/End 到两端。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  NO_SELECTION,
  canEscape,
  createSelectionState,
  effectiveSelection,
  escapeSelection,
  hoverSelection,
  moveIndex,
  moveSelection,
  sameSelection,
  select,
  selectionKey,
  selectionReducer,
} from '../../src/client/ui/turns/index.ts'

test('selectionKey / sameSelection：四种目标各自稳定', () => {
  assert.equal(selectionKey(NO_SELECTION), 'none')
  assert.equal(selectionKey(select.file('src/a.ts')), 'file:src/a.ts')
  assert.equal(selectionKey(select.turn('s1', 3)), 'turn:s1:3')
  assert.equal(selectionKey(select.session('s1')), 'session:s1')
  assert.equal(sameSelection(select.turn('s1', 3), select.turn('s1', 3)), true)
  assert.equal(sameSelection(select.turn('s1', 3), select.turn('s1', 4)), false)
  assert.equal(sameSelection(null, null), true)
  assert.equal(sameSelection(null, NO_SELECTION), false)
})

test('hover 只改预览：固定选择不被预览覆盖，且呈现也**锁定优先**', () => {
  const pinned = selectionReducer(createSelectionState(), { type: 'click', target: select.file('src/a.ts') })
  assert.deepEqual(pinned.selected, select.file('src/a.ts'))
  assert.equal(pinned.inspectorOpen, true)

  const previewing = selectionReducer(pinned, { type: 'hover', target: select.turn('s1', 3) })
  assert.deepEqual(previewing.selected, select.file('src/a.ts'), 'hover 不得改固定选择')
  assert.deepEqual(previewing.preview, select.turn('s1', 3), 'hover 仍要记下预览目标（悬停描边要用）')

  // 2026-11-08 用户拍板改为「锁定优先」：有固定选择时，预览不参与呈现。
  // 旧断言是 `effectiveSelection === 预览目标`（预览优先）——那导致「点了锁定，鼠标一扫就跑」。
  assert.deepEqual(effectiveSelection(previewing), select.file('src/a.ts'), '有固定选择时，画面看固定选择')
  assert.deepEqual(hoverSelection(previewing), select.turn('s1', 3), '悬停描边仍跟随鼠标')

  // 反向：**没有固定选择**时，预览才有资格决定画面（不点也能扫一眼）。
  const onlyPreview = selectionReducer(createSelectionState(), { type: 'hover', target: select.turn('s1', 3) })
  assert.deepEqual(effectiveSelection(onlyPreview), select.turn('s1', 3), '无固定选择时，预览决定画面')

  const left = selectionReducer(previewing, { type: 'hover', target: null })
  assert.equal(left.preview, null)
  assert.deepEqual(effectiveSelection(left), select.file('src/a.ts'), '离开后仍是固定选择')
  assert.equal(hoverSelection(left), null, '离开后没有悬停描边')
})

test('click：再次点同一目标取消；点击新目标替换并打开检查器', () => {
  const s1 = selectionReducer(createSelectionState(select.turn('s1', 3)), { type: 'click', target: select.turn('s1', 3) })
  assert.deepEqual(s1.selected, NO_SELECTION, '再点同一目标应取消')
  const s2 = selectionReducer(createSelectionState(select.turn('s1', 3)), { type: 'click', target: select.file('src/b.ts') })
  assert.deepEqual(s2.selected, select.file('src/b.ts'))
  assert.equal(s2.preview, null, '固定选择后清掉预览')
})

test('空白取消：清掉固定选择与预览（检查器保持打开 = 回到概览）', () => {
  const state = createSelectionState(select.turn('s1', 3), true)
  const blanked = selectionReducer(state, { type: 'blank' })
  assert.deepEqual(blanked.selected, NO_SELECTION)
  assert.equal(blanked.preview, null)
  assert.equal(blanked.inspectorOpen, true)
  assert.equal(selectionReducer(blanked, { type: 'blank' }), blanked, '已经空选择时返回同一对象（不抖动）')
})

test('Esc 逐层退出：预览 → 固定 → 关检查器 → 交给上层', () => {
  const state = createSelectionState(select.file('src/a.ts'), true, )
  const previewing = selectionReducer(state, { type: 'hover', target: select.turn('s1', 2) })

  const step1 = escapeSelection(previewing)
  assert.equal(step1.consumed, true)
  assert.equal(step1.state.preview, null)
  assert.deepEqual(step1.state.selected, select.file('src/a.ts'), '第一层只退预览')

  const step2 = escapeSelection(step1.state)
  assert.equal(step2.consumed, true)
  assert.deepEqual(step2.state.selected, NO_SELECTION)
  assert.equal(step2.state.inspectorOpen, true, '第二层只退选择，检查器还在')

  const step3 = escapeSelection(step2.state)
  assert.equal(step3.consumed, true)
  assert.equal(step3.state.inspectorOpen, false)

  const step4 = escapeSelection(step3.state)
  assert.equal(step4.consumed, false, '四层之外没有可退的，交给上层关 tab/弹窗')
  assert.equal(canEscape(step3.state), false)
})

test('Esc 顺序不可跳级：只剩检查器时直接关检查器', () => {
  const result = escapeSelection(createSelectionState(NO_SELECTION, true))
  assert.equal(result.consumed, true)
  assert.equal(result.state.inspectorOpen, false)
})

test('方向键移动：环绕、Home/End、空序列返回 null', () => {
  const candidates = [select.turn('s1', 1), select.turn('s1', 2), select.turn('s1', 3)]
  assert.equal(moveIndex(0, 1, 3), 1)
  assert.equal(moveIndex(2, 1, 3), 0, '右移到底应环绕')
  assert.equal(moveIndex(0, -1, 3), 2, '左移到头应环绕')
  assert.equal(moveIndex(-1, 1, 3), 0, '没有当前项时前进到第一个')
  assert.equal(moveIndex(-1, -1, 3), 2, '没有当前项时后退到最后一个')
  assert.equal(moveIndex(0, 1, 0), null)
  assert.equal(moveSelection([], null, 1), null)
  assert.deepEqual(moveSelection(candidates, select.turn('s1', 2), 1), { index: 2, target: candidates[2] })
  assert.deepEqual(moveSelection(candidates, select.turn('s1', 1), 'last'), { index: 2, target: candidates[2] })
  assert.deepEqual(moveSelection(candidates, select.turn('s1', 3), 'first'), { index: 0, target: candidates[0] })
})

test('键盘走的是与鼠标同一套归约器：move 只预览，Enter（keyboard）才固定', () => {
  const state = createSelectionState()
  const moved = selectionReducer(state, { type: 'move', target: select.turn('s1', 5) })
  assert.deepEqual(moved.selected, NO_SELECTION, '方向键不改变固定选择')
  assert.deepEqual(moved.preview, select.turn('s1', 5))
  const entered = selectionReducer(moved, { type: 'keyboard', target: select.turn('s1', 5) })
  assert.deepEqual(entered.selected, select.turn('s1', 5))
  assert.equal(entered.preview, null)
  assert.equal(entered.inspectorOpen, true)
})

test('openInspector / closeInspector', () => {
  const opened = selectionReducer(createSelectionState(), { type: 'openInspector' })
  assert.equal(opened.inspectorOpen, true)
  const closed = selectionReducer(opened, { type: 'closeInspector' })
  assert.equal(closed.inspectorOpen, false)
  assert.equal(selectionReducer(closed, { type: 'closeInspector' }), closed, '重复关闭返回同一对象')
})
