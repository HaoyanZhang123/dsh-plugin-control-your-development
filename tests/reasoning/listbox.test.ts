/*
 * tests/reasoning/listbox.test.ts —— 自研 Listbox 的键盘与语义（P3）。
 *
 * 守住的是 WAI-ARIA listbox 的可判定部分（纯逻辑，不需要 DOM）：
 * 上下键跳过禁用项、Home/End 到头、字符前缀搜索（累积 + 超时重置由组件管，这里测前缀匹配本身）。
 *
 * 真机交互（点击外部关闭、焦点归还、aria-activedescendant）由 harness 的页面断言覆盖。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { nextEnabledIndex, typeaheadIndex, type ListboxOption } from '../../src/client/ui/reasoning/Listbox.ts'

const OPTIONS: ListboxOption[] = [
  { value: 'all', label: '全部' },
  { value: 'deepseek', label: 'deepseek-v4.1-flash' },
  { value: 'k3', label: 'k3' },
  { value: 'k3-256k', label: 'k3-256k', disabled: true },
  { value: 'zh', label: '中文' },
]

test('上下键跳过 disabled 项', () => {
  /* 从 k3（index 2）往下 → k3-256k 是 disabled，必须跳过到 zh（index 4）。 */
  assert.equal(nextEnabledIndex(OPTIONS, 2, 1), 4)
  /* 从 zh 往上 → 跳过 disabled 的 k3-256k 回到 k3。 */
  assert.equal(nextEnabledIndex(OPTIONS, 4, -1), 2)
  /* 从 all 往上（环形）→ 末尾是 disabled，必须继续绕到 zh。 */
  assert.equal(nextEnabledIndex(OPTIONS, 0, -1), 4)
})

test('Home/End：落到首个/末个**可选中**项', () => {
  assert.equal(nextEnabledIndex(OPTIONS, -1, 1), 0, 'Home 从 -1 前进到首个可选项')
  assert.equal(nextEnabledIndex(OPTIONS, 0, -1), 4, 'End 从 0 后退到末个可选项（跳过 disabled）')
})

test('全部禁用时停在原处（不越界、不返回 -1 造成"没有高亮"）', () => {
  const disabled: ListboxOption[] = OPTIONS.map((option) => ({ ...option, disabled: true }))
  assert.equal(nextEnabledIndex(disabled, 1, 1), 1)
  assert.equal(nextEnabledIndex(disabled, 1, -1), 1)
})

test('空前缀不移动高亮（返回 -1 让调用方保持原状）', () => {
  assert.equal(typeaheadIndex(OPTIONS, '', 0), -1)
  assert.equal(typeaheadIndex([], 'a', 0), -1)
})

test('字符前缀搜索：大小写不敏感，从当前项之后环形找', () => {
  assert.equal(typeaheadIndex(OPTIONS, 'k', 0), 2, 'k → 第一个以 k 开头的（k3 在 index 2）')
  assert.equal(typeaheadIndex(OPTIONS, 'k', 2), 2, '从 k3 本身开始也能命中自己（环形包含自身）')
  assert.equal(typeaheadIndex(OPTIONS, 'deep', 0), 1)
  assert.equal(typeaheadIndex(OPTIONS, 'DEEP', 0), 1, '前缀搜索必须大小写不敏感')
  assert.equal(typeaheadIndex(OPTIONS, '中', 0), 4)
  assert.equal(typeaheadIndex(OPTIONS, 'zzz', 0), -1, '找不到返回 -1（不静默跳到第一项）')
})

test('前缀搜索跳过 disabled 项（不能把高亮停在一个选不中的项上）', () => {
  /* 'k3-256k' 是 disabled，但 'k3' 可选中 → 搜 k3 必须落到 index 2。 */
  assert.equal(typeaheadIndex(OPTIONS, 'k3', 0), 2)
  /* 只匹配 disabled 项的前缀 → 无可用结果。 */
  assert.equal(typeaheadIndex([{ value: 'x', label: 'xray', disabled: true }], 'x', 0), -1)
})
