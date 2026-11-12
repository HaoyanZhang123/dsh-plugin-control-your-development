/*
 * client/ui/reasoning/Listbox.ts —— 自研可访问下拉（button + listbox + option）。
 *
 * 为什么不用原生 `<select>`（P3 第 8 条同源问题）：原生 select 的选项只能是一行纯文本，
 * 无法表达「选项名 + 字符量 + 选中标记」，样式也跨浏览器不一致；而这个页面每个筛选项都
 * 必须带字符量（用户要判断主次），长模型名还要在按钮内省略但保留 title。
 *
 * 为什么不用 UI 库：项目铁律 `dependencies` 必须为空、不引任何第三方库。
 *
 * 无障碍契约（WAI-ARIA 1.2 combobox/listbox 模式，非 editable）：
 * - 触发按钮：`aria-haspopup="listbox"` + `aria-expanded` + `aria-controls`；
 * - 弹层：`role="listbox"`，每项 `role="option"` + `aria-selected`；
 * - 焦点留在触发按钮上，用 `aria-activedescendant` 指向高亮项（DOM 焦点不跳，屏幕阅读器仍能读）；
 * - 键盘：↑/↓ 移动、Home/End 首尾、Enter/Space 选中、Esc 关闭、Tab 关闭并让焦点自然离开、
 *   可打印字符做**前缀搜索**（连续输入累积，超过 800ms 重新开始）；
 * - 点击外部关闭并把焦点还给触发按钮；
 * - 空态（没有可选项）与禁用态（disabled）都如实表达。
 *
 * 纪律：
 * - 永久只读：不写 localStorage / cookie / URL，不 append `document.body`
 *   （弹层挂在组件自己的容器里，用绝对定位，层级靠 CSS 变量控制）；
 * - 不写死文案（空态走 t('reasoning.noOptions')）。
 */
import * as React from 'react'
import type { Translator } from '../../locale/index.ts'

const h = React.createElement

/**
 * 选项值：字符串或数字。
 *
 * 为什么放宽（1.5.5）：轮次筛选的值是 `number | 'all' | 'unknown'`（见 model.ts 的
 * `ReasoningTurn`）。Listbox 是通用控件，不应该为了一个调用方把 1 转成 '1' 再转回来 ——
 * 那会造出"UI 里是字符串、筛选里是数字"的第二套口径。比较一律用 `===`，不做隐式转换。
 */
export type ListboxValue = string | number

/** 一个可选项。`chars` 为字符量（显示在右侧，可缺省）。 */
export interface ListboxOption {
  value: ListboxValue
  label: string
  /** 选项右侧的补充信息（字符量等），只显示不参与匹配。 */
  meta?: string
  disabled?: boolean
}

export interface ListboxProps {
  t: Translator
  /** 可访问名（同时是按钮**前面**的可见标签；见缺陷 C）。 */
  label: string
  value: ListboxValue
  options: readonly ListboxOption[]
  onChange: (value: ListboxValue) => void
  /** data-testid（harness 依赖旧 testid：reasoning-model / reasoning-lang / reasoning-range / reasoning-record）。 */
  testId?: string
  disabled?: boolean
  /** 触发按钮的可见宽度上限（长模型名省略，但 title 保留完整值）。 */
  className?: string
}

/** 前缀搜索的累积窗口：超过这个间隔就重新开始（规范建议 500–1000ms）。 */
const TYPEAHEAD_RESET_MS = 800

/** 生成一个确定性、选择器安全的 id 片段（SSR/CSR 都稳定，不依赖随机数）。 */
function optionId(base: string, index: number): string {
  return base + '-opt-' + String(index)
}

/**
 * 前缀搜索：从 `start` 之后循环找第一个 `label` 以 `prefix` 开头的可选项。
 * 找不到返回 -1（调用方保持原高亮，不静默跳到第一项）。
 */
export function typeaheadIndex(options: readonly ListboxOption[], prefix: string, start: number): number {
  if (prefix === '' || options.length === 0) return -1
  const needle = prefix.toLowerCase()
  for (let step = 1; step <= options.length; step += 1) {
    const index = (start + step + options.length) % options.length
    const option = options[index]
    if (option.disabled === true) continue
    if (option.label.toLowerCase().startsWith(needle)) return index
  }
  return -1
}

/** 从 `index` 起按方向找下一个可选中的项（跳过 disabled）；没有则停在原处。 */
export function nextEnabledIndex(options: readonly ListboxOption[], index: number, delta: number): number {
  if (options.length === 0) return -1
  for (let step = 1; step <= options.length; step += 1) {
    const candidate = (index + delta * step + options.length * (Math.abs(delta) + 1)) % options.length
    if (options[candidate].disabled !== true) return candidate
  }
  return index
}

export function Listbox(props: ListboxProps): React.ReactElement {
  const { t, options, value, onChange } = props
  const [open, setOpen] = React.useState(false)
  const baseId = 'tl-lb-' + React.useId().replace(/[^A-Za-z0-9_-]/g, '')
  const buttonRef = React.useRef<HTMLButtonElement | null>(null)
  const listRef = React.useRef<HTMLDivElement | null>(null)
  const typeahead = React.useRef<{ text: string; at: number }>({ text: '', at: 0 })

  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value))
  const [activeIndex, setActiveIndex] = React.useState(selectedIndex)
  const disabled = props.disabled === true || options.length === 0

  const current = options[selectedIndex]
  const buttonLabel = current === undefined ? t('reasoning.noOptions') : current.label

  /** 打开时把高亮落在当前值上（不是第一项：用户按 ↓ 应该从当前值往下走）。 */
  const openList = React.useCallback((): void => {
    if (disabled) return
    setActiveIndex(Math.max(0, options.findIndex((option) => option.value === value)))
    setOpen(true)
  }, [disabled, options, value])

  const closeList = React.useCallback((refocus: boolean): void => {
    setOpen(false)
    if (refocus) buttonRef.current?.focus()
  }, [])

  const commit = React.useCallback(
    (index: number): void => {
      const option = options[index]
      if (option === undefined || option.disabled === true) return
      onChange(option.value)
      closeList(true)
    },
    [closeList, onChange, options],
  )

  /* 点击外部关闭并把焦点还给触发按钮（只监听 pointerdown：键盘路径不用这个）。 */
  React.useEffect(() => {
    if (!open) return undefined
    const onPointerDown = (event: PointerEvent | MouseEvent): void => {
      const target = event.target as Node | null
      if (target === null) return
      if (buttonRef.current?.contains(target) === true) return
      if (listRef.current?.contains(target) === true) return
      closeList(true)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('mousedown', onPointerDown, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('mousedown', onPointerDown, true)
    }
  }, [closeList, open])

  /* 打开时把高亮项滚进可视区（键盘上下移动时同样跟随）。 */
  React.useEffect(() => {
    if (!open) return
    const node = listRef.current?.querySelector('[data-active="true"]')
    if (node instanceof HTMLElement) node.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, open])

  /*
   * 弹层的左右对齐（1.5.5 真机缺陷补丁的配套）。
   *
   * 为什么必须实测：弹层现在是 `inline-size: max-content`（不能跟按钮同宽，否则语言名被
   * meta 挤成 0 —— 详见 reasoning.css 里那段注释）。宽度由内容决定，纯 CSS 无法知道
   * "往右展开会不会顶出视口"，只能开出来之后量一次，越界就改成靠右对齐。
   * 量的是弹层相对文档的右边缘与视口宽度，不碰任何存储。
   */
  React.useLayoutEffect(() => {
    if (!open) return
    const node = listRef.current
    if (node === null) return
    const rect = node.getBoundingClientRect()
    const overflowRight = rect.right > window.innerWidth - 8
    /* 只往"右对齐"方向纠正；左对齐是默认，避免每次开合都改属性造成抖动。 */
    if (overflowRight && node.getAttribute('data-align') !== 'end') node.setAttribute('data-align', 'end')
    else if (!overflowRight && node.getAttribute('data-align') === 'end') node.removeAttribute('data-align')
  }, [open, options.length])

  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>): void => {
    const key = event.key
    if (!open) {
      if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'Enter' || key === ' ' || key === 'Spacebar') {
        event.preventDefault()
        openList()
        /* ↓/Enter 打开后落在当前值；↑ 打开后落在当前值（规范允许，简单可预期）。 */
        return
      }
      /* 关闭态的前缀搜索：不打开弹层也能切换（列表页常见期望）。 */
      if (key.length === 1 && key !== ' ') {
        const now = Date.now()
        const previous = typeahead.current
        const text = now - previous.at > TYPEAHEAD_RESET_MS ? key : previous.text + key
        typeahead.current = { text, at: now }
        const index = typeaheadIndex(options, text, Math.max(0, options.findIndex((option) => option.value === value)))
        const option = options[index]
        if (index >= 0 && option !== undefined && option.disabled !== true) onChange(option.value)
        event.preventDefault()
      }
      return
    }

    if (key === 'Escape') {
      event.preventDefault()
      closeList(true)
      return
    }
    if (key === 'Tab') {
      /* 不让 Tab 进弹层：关闭即可，焦点自然离开（不吞掉 Tab 的默认行为）。 */
      setOpen(false)
      return
    }
    if (key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((index) => nextEnabledIndex(options, index, 1))
      return
    }
    if (key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((index) => nextEnabledIndex(options, index, -1))
      return
    }
    if (key === 'Home') {
      event.preventDefault()
      setActiveIndex(nextEnabledIndex(options, -1, 1))
      return
    }
    if (key === 'End') {
      event.preventDefault()
      setActiveIndex(nextEnabledIndex(options, 0, -1))
      return
    }
    if (key === 'Enter' || key === ' ' || key === 'Spacebar') {
      event.preventDefault()
      commit(activeIndex)
      return
    }
    if (key.length === 1) {
      const now = Date.now()
      const previous = typeahead.current
      const text = now - previous.at > TYPEAHEAD_RESET_MS ? key : previous.text + key
      typeahead.current = { text, at: now }
      const index = typeaheadIndex(options, text, activeIndex)
      if (index >= 0) {
        event.preventDefault()
        setActiveIndex(index)
      }
    }
  }

  const activeOption = options[activeIndex]

  /*
   * 可见标签（真机缺陷 C）。
   *
   * 根因：旧实现只把 props.label 用在 aria-label 与 title 上 —— 屏幕阅读器能读到，
   * 但**屏幕上根本没有**这个字。五个筛选按钮于是全显示成"全部/全部/全部…"，
   * 用户不知道哪个是范围、哪个是模型。
   *
   * 现在 label 渲染成按钮**前面**的可见 caption（同一行 inline-flex）。
   * aria-label 仍然保留（读屏读的是"范围 当前会话"这种完整语义，不是两段割裂的文字）。
   */
  return h(
    'div',
    { className: 'tl-listbox' + (props.className === undefined ? '' : ' ' + props.className), 'data-open': open ? 'true' : 'false' },
    h('span', { className: 'tl-listbox-caption', 'data-testid': props.testId === undefined ? undefined : props.testId + '-caption' }, props.label),
    h(
      'button',
      {
        ref: buttonRef,
        type: 'button',
        className: 'tl-listbox-btn',
        role: 'combobox',
        'aria-haspopup': 'listbox',
        'aria-expanded': open ? 'true' : 'false',
        'aria-controls': baseId,
        'aria-label': props.label,
        'aria-disabled': disabled ? 'true' : 'false',
        disabled,
        title: current === undefined ? props.label : buttonLabel + (current.meta === undefined ? '' : ' · ' + current.meta),
        'data-testid': props.testId,
        /* DOM 属性只能是字符串；值本身的类型（number 轮次）由 onChange 原样带回，不做转换。 */
        'data-value': String(value),
        /* 选项数量：弹层是懒渲染的（关着时不在 DOM 里），测试与 harness 需要这个数来判断
         * "选项枚举口径对不对"（例如语言下拉必须包含筛选前的全部语言）。 */
        'data-option-count': String(options.length),
        onClick: () => (open ? closeList(false) : openList()),
        onKeyDown,
      },
      h('span', { className: 'tl-listbox-btn-label' }, buttonLabel),
      current?.meta === undefined ? null : h('span', { className: 'tl-listbox-btn-meta' }, current.meta),
      h('span', { className: 'tl-listbox-caret', 'aria-hidden': 'true' }, '▾'),
    ),
    open
      ? h(
          'div',
          {
            ref: listRef,
            id: baseId,
            className: 'tl-listbox-pop',
            role: 'listbox',
            'aria-label': props.label,
            tabIndex: -1,
            'aria-activedescendant': activeOption === undefined ? undefined : optionId(baseId, activeIndex),
          },
          ...options.map((option, index) =>
            h(
              'div',
              {
                key: option.value,
                id: optionId(baseId, index),
                className: 'tl-listbox-opt',
                role: 'option',
                'aria-selected': option.value === value ? 'true' : 'false',
                'aria-disabled': option.disabled === true ? 'true' : 'false',
                'data-active': index === activeIndex ? 'true' : 'false',
                'data-selected': option.value === value ? 'true' : 'false',
                onMouseDown: (event: React.MouseEvent) => {
                  /* 用 mousedown 抢在 blur 之前提交，避免"点了但没选上"。 */
                  event.preventDefault()
                  commit(index)
                },
                onMouseEnter: () => setActiveIndex(index),
              },
              h('span', { className: 'tl-listbox-opt-mark', 'aria-hidden': 'true' }, option.value === value ? '✓' : ''),
              h('span', { className: 'tl-listbox-opt-label', title: option.label }, option.label),
              option.meta === undefined ? null : h('span', { className: 'tl-listbox-opt-meta' }, option.meta),
            ),
          ),
        )
      : null,
  )
}
