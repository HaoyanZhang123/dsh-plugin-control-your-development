/*
 * timeline/Timeline.ts —— 时间轴：**双轨**（上轨活跃度柱 + 下轨会话分层）。
 *
 * 规范：33 §5（双轨时间轴）、03 §5（范围 / 刻度 / 播放头 / 回到现在）、03 §15（aria-live）。
 *
 * R12（2.2.0，用户 2026-11-08 拍板「D · 双轨」）——**旧路径已整类删除**：
 * - 删除「生长带面积曲线」（旧的生长带 DOM 与生长曲线渲染路径）；
 * - 删除「密集刻度」（旧的密集刻度容器 / 每宽度 3–8 个标签 / 旧的刻度构造路径）；
 * - 删除时间轴右侧常驻的播放头时间文本（旧 48px 布局里塞在轨道外的那一份）；
 * - 删除会话的「开始/结束各一根竖线」，改为整段会话条。
 * 现在全时间轴**只有一个播放头标签**（轨道顶部，贴边自动翻转），**只有三个刻度标签**（首/中/尾）。
 * 本文件不复述旧 class 名，旧路径的存在性由 tests/ui-map/timeline.test.ts 的负向 grep 扫描守。
 *
 * 用户原话要求（2026-11-08）：
 * - 「时间轴的格式很丑，粗糙」→ 双轨 + 无刻度线 + 无图例；
 * - 「每个选中的地方那个也很丑陋」→ 播放头 = 2px 竖线，只有一个小标签，不再有把手圆点；
 * - 「解释性小字就不要留了」→ 全组件零说明文字、零单位、零图例、零会话标题常驻。
 *
 * 确定性（可复现截图 + 可单测）：
 * - 桶数 = `binCountForWidth(宽度)`，宽度由 `trackWidth` prop（或常量兜底）给出，
 *   **组件不读真实 DOM 宽度、不装 ResizeObserver** → 同一 props 同一 DOM；
 * - 柱高 = 该桶 ops / 最大桶 ops × 上限，只由输入决定；
 * - 会话行 = `buildSessionLanes()` 的确定性贪心（排序后首次适配），最多 4 行；
 * - 不读时钟（`now` / `playhead` 都是受控 props），不使用随机数。
 *
 * 空数据（`domain === null`）：
 * - 不画任何柱、不画任何会话条（`bars`/`lanes` 为空数组），只在轨道上留基线 + 三个刻度；
 * - 组件不伪造 0、不显示"暂无数据"之类说明文字（用户明确不要解释性小字）。
 */
import * as React from 'react'
import { createTranslator, DEFAULT_LOCALE, type Locale, type Translator } from '../../locale/index.ts'
import type { RangeKey } from '../shell/index.ts'
import {
  buildActivityTrack,
  buildScaleTicks,
  buildSessionLanes,
  clampPlayhead,
  DEFAULT_ACTIVITY_WIDTH,
  binCountForWidth,
  playheadLabel,
  playheadLabelAnchor,
  ratioToTime,
  timeToRatio,
  windowForRange,
  type TickGranularity,
  type TimeRange,
  type TimelineNode,
  type TimelineSession,
} from './scale.ts'

const h = React.createElement

/** 时间轴 props（入口接线契约）。 */
export interface TimelineProps {
  /** 时间范围（与 header 同源；RangeKey 就是 locale key）。 */
  range: RangeKey
  /** 数据可用时间域；null = 还没有可读数据（显示空态，不伪造 0）。 */
  domain: TimeRange | null
  /** 播放头（ms，受控）。 */
  playhead: number
  /** null = 回到最新/跟随此刻（Q2：回到最新不是跳到数据末端）。 */
  onPlayheadChange?: (at: number | null) => void
  /** 节点（上轨活跃度柱的数据源）；缺省空数组。 */
  nodes?: readonly TimelineNode[]
  /** 会话（下轨分层条的数据源）；缺省空数组。 */
  sessions?: readonly TimelineSession[]
  /** 「现在」（ms）；「回到最新」与默认窗口右界。 */
  now: number
  locale?: Locale
  reducedMotion?: boolean
  className?: string
  testId?: string
  /**
   * 上轨轨道宽度（px），只用来算**桶数**（可视宽度 / 8px 取整）。
   * 组件**不读 DOM**：宽度由调用方量好传入；缺省 640 → 80 个桶，首屏与截图都可复现。
   */
  trackWidth?: number
  /** 刻度文案格式化（缺省按本地时区）。 */
  formatTickLabel?: (at: number, granularity: TickGranularity) => string
  /** aria-live 播报文案（缺省 playheadLabel）。 */
  announce?: (at: number) => string
  /** 节流时钟（默认 performance.now；测试可注入）。 */
  clock?: () => number
}

/** aria-live 节流间隔（03 §15：拖播放头时节流播报当前时间）。 */
export const ANNOUNCE_THROTTLE_MS = 800

interface DragState {
  pointerId: number
  moved: boolean
}

export function Timeline(props: TimelineProps): React.ReactElement {
  const locale: Locale = props.locale ?? DEFAULT_LOCALE
  const t: Translator = React.useMemo(() => createTranslator(locale), [locale])
  const clock = props.clock ?? ((): number => (typeof performance === 'undefined' ? Date.now() : performance.now()))

  const [liveText, setLiveText] = React.useState('')
  const trackRef = React.useRef<HTMLDivElement | null>(null)
  const dragRef = React.useRef<DragState | null>(null)
  const pendingRatio = React.useRef<number | null>(null)
  const rafRef = React.useRef(0)
  const playheadRef = React.useRef(props.playhead)
  /**
   * 一次性闸门：双击「回到最新」之后，抑制随后一次 `applyTime`。
   *
   * 为什么需要：浏览器的事件顺序是 pointerdown → pointerup → click → … → dblclick。
   * 每次 pointerup 都会 `scheduleRatio` 排一个 rAF，而 dblclick 在 pointerup 之后才到；
   * 若只在 goNow 里取消"当前已排的帧"，第二次 pointerup 新排的那一帧仍会落地，
   * 把播放头又写回点击位置（实测：双击后仍停在 35%）。用闸门吃掉那一次写入即可。
   */
  const suppressApplyRef = React.useRef(false)
  playheadRef.current = props.playhead
  const lastAnnounceAt = React.useRef(-Infinity)

  const domain = props.domain
  const window = React.useMemo(() => windowForRange(props.range, props.now, domain), [props.range, props.now, domain])
  const playhead = clampPlayhead(props.playhead, window)

  /* ---------- 回调 ref（rAF 节流不因父级重渲染而重启） ---------- */
  const callbacks = React.useRef({ onPlayheadChange: props.onPlayheadChange })
  callbacks.current = { onPlayheadChange: props.onPlayheadChange }

  /* ---------- 卸载：清 rAF ---------- */
  React.useEffect(
    () => () => {
      if (rafRef.current !== 0) cancelAnimationFrame(rafRef.current)
      rafRef.current = 0
    },
    [],
  )

  /* ---------- aria-live 节流播报（拖动时 800ms 一次） ---------- */
  const announce = props.announce ?? ((at: number): string => playheadLabel(at, window))
  React.useEffect(() => {
    const text = announce(playhead)
    // 静音（空文案）必须**立即**生效且不受 800ms 节流：否则切到列表视图后，
    // 旧的播放头播报会残留到下一个节流窗口，违反「同一时刻只有一个 aria-live」
    // （t09 的 timeline-live-silenced 断言守这条）。静音也不推进节流窗口，
    // 免得压掉之后的第一次真实播报。
    if (text === '') {
      setLiveText('')
      return
    }
    const nowMs = clock()
    if (nowMs - lastAnnounceAt.current < ANNOUNCE_THROTTLE_MS) return
    lastAnnounceAt.current = nowMs
    setLiveText(text)
  }, [playhead, announce, clock])

  /* ---------- 播放头提交（rAF 节流，拖动时高频事件不卡帧） ---------- */
  const applyTime = React.useCallback(
    (at: number): void => {
      // 双击回到最新之后，事件序列里**还可能**有一个已经排队的 rAF 要落地；
      // 它会把刚清成 null 的播放头写回点击位置。用一个一次性闸门拦掉它。
      if (suppressApplyRef.current) {
        suppressApplyRef.current = false
        return
      }
      const next = clampPlayhead(at, window)
      playheadRef.current = next
      callbacks.current.onPlayheadChange?.(next)
    },
    [window.start, window.end],
  )

  const scheduleRatio = React.useCallback(
    (ratio: number): void => {
      if (typeof requestAnimationFrame !== 'function') {
        applyTime(ratioToTime(ratio, window))
        return
      }
      pendingRatio.current = ratio
      if (rafRef.current !== 0) return
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0
        const pending = pendingRatio.current
        pendingRatio.current = null
        if (pending === null) return
        applyTime(ratioToTime(pending, window))
      })
    },
    [applyTime, window.start, window.end],
  )

  const ratioFromEvent = (event: React.PointerEvent<HTMLDivElement>): number => {
    const element = trackRef.current
    if (!element) return 0
    const rect = element.getBoundingClientRect()
    if (rect.width <= 0) return 0
    return Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
  }

  /* R12 新增：按下即定位（整条轨道都是点击目标，不再只有 8px 的小把手）。 */
  const trackPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    dragRef.current = { pointerId: event.pointerId, moved: false }
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      /* 合成事件无 capture；不影响后续 move/up */
    }
    applyTime(ratioToTime(ratioFromEvent(event), window))
  }

  const trackPointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    drag.moved = true
    scheduleRatio(ratioFromEvent(event))
  }

  const trackPointerUp = (event: React.PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragRef.current = null
    scheduleRatio(ratioFromEvent(event))
  }

  const trackKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const span = window.end - window.start
    const step = Math.max(1, Math.round(span / 100))
    // 键盘步进必须基于**当前实际播放头**：playheadRef 在 applyTime 里被同步更新，
    // 所以连续按 ←/→（父级来不及重渲染时）也能持续累计，不会原地踏步。
    const from = clampPlayhead(playheadRef.current, window)
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault()
      applyTime(from + (event.key === 'ArrowRight' ? 1 : -1) * step * (event.shiftKey ? 10 : 1))
      return
    }
    if (event.key === 'Home') {
      event.preventDefault()
      applyTime(window.start)
      return
    }
    if (event.key === 'End') {
      event.preventDefault()
      applyTime(window.end)
    }
  }

  /* ---------- 动作 ---------- */
  /**
   * 回到最新 = 清空播放头（跟随 now），不是"跳到数据域末端"。
   *
   * 2026-11-08 用户拍板删掉「回到最新」按钮（不再占左侧一列），
   * 但**能力保留**为双击轨道的手势 —— 否则鼠标用户拖到历史时刻后没有一键复位的路
   * （键盘 End 仍可用，但那是键盘专属）。
   *
   * 关键：必须**先取消挂起的 rAF**再清播放头。
   * 双击的事件序列是 down/up + down/up + dblclick —— 每次 pointerup 都会 scheduleRatio
   * 把播放头钉到点击位置，而 rAF 是异步的，可能在 dblclick 之后才落地，
   * 从而把刚清成 null 的播放头又写回点击位置（实测：双击后仍停在 35%）。
   * 取消挂起帧 + 清空 pendingRatio，保证「回到最新」是最后一次生效的状态变更。
   */
  const goNow = (): void => {
    if (rafRef.current !== 0) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = 0
    }
    pendingRatio.current = null
    // 闸门兜住"已经排进队列、还没执行"的那一帧（见 suppressApplyRef 的注释）。
    suppressApplyRef.current = true
    playheadRef.current = window.end
    callbacks.current.onPlayheadChange?.(null)
  }

  /** 双击轨道 = 回到最新（替代已删除的按钮）。 */
  const trackDoubleClick = (event: React.MouseEvent<HTMLDivElement>): void => {
    event.preventDefault()
    event.stopPropagation()
    goNow()
  }

  /* ---------- 派生渲染数据（全纯函数，组件只摆位） ---------- */
  const empty = domain === null
  const binCount = binCountForWidth(props.trackWidth ?? DEFAULT_ACTIVITY_WIDTH)
  const activity = React.useMemo(
    () => buildActivityTrack(empty ? [] : (props.nodes ?? []), window, binCount),
    [empty, props.nodes, window.start, window.end, binCount],
  )
  const lanes = React.useMemo(
    () => buildSessionLanes(empty ? [] : (props.sessions ?? []), window),
    [empty, props.sessions, window.start, window.end],
  )
  const scaleTicks = React.useMemo(
    () => buildScaleTicks(window, props.formatTickLabel),
    [window.start, window.end, props.formatTickLabel],
  )

  const currentLabel = playheadLabel(playhead, window)
  const ratio = timeToRatio(playhead, window)
  const labelAnchor = playheadLabelAnchor(ratio)

  /* ---------- 轨道 ---------- */
  const bars = activity.bars.map((bar) =>
    h('span', {
      key: 'bar:' + bar.index,
      className: 'tl-bar',
      'data-bin': bar.index,
      'data-ops': bar.ops,
      'aria-hidden': true,
      style: {
        // 位置与宽度都用百分比 → 视觉永远铺满轨道，不依赖组件是否量到真实像素。
        insetInlineStart: (100 * bar.index) / activity.binCount + '%',
        inlineSize: 100 / activity.binCount + '%',
        blockSize: bar.height + 'px',
        opacity: bar.opacity,
      },
    }),
  )

  const sessionBars = lanes.map((lane) => {
    // 标题只做 hover tooltip（title 属性），**不常驻**显示（用户：解释性小字不要留）。
    const label = (lane.title ?? lane.id) + ' · ' + t('inspector.turn') + ' ' + lane.turns
    return h('span', {
      key: 'lane:' + lane.id,
      className: 'tl-lane-bar',
      'data-session-id': lane.id,
      'data-lane': lane.lane,
      'data-turns': lane.turns,
      title: label,
      'aria-hidden': true,
      style: {
        insetInlineStart: lane.leftRatio * 100 + '%',
        inlineSize: lane.widthRatio * 100 + '%',
        insetBlockStart: lane.lane * 10 + 'px',
      },
    })
  })

  const scaleLabels = scaleTicks.map((tick, index) =>
    h(
      'span',
      {
        key: 'tick:' + index,
        className: 'tl-scale-tick',
        'data-tick-index': index,
        'data-tick-align': tick.align,
        style: { insetInlineStart: tick.ratio * 100 + '%' },
      },
      tick.label,
    ),
  )

  return h(
    'div',
    {
      className: ['tl-timeline', props.className].filter(Boolean).join(' '),
      'data-tl-timeline': 'true',
      'data-reduced-motion': props.reducedMotion === true ? 'true' : 'false',
      'data-range': props.range,
      'data-empty': empty ? 'true' : 'false',
      'data-testid': props.testId,
    },
    // 左侧控件列已删除（2026-11-08 用户拍板）」回到最新」按钮不再需要，
    // 能力改为**双击轨道**（见 trackDoubleClick）。删掉这一列后绘图区拿到整条宽度。
    h(
      'div',
      { className: 'tl-plot' },
      h(
        'div',
        {
          ref: trackRef,
          className: 'tl-track',
          role: 'slider',
          tabIndex: 0,
          'aria-orientation': 'horizontal',
          'aria-label': t('modal.start') + ' – ' + t('modal.end'),
          'aria-valuemin': window.start,
          'aria-valuemax': window.end,
          'aria-valuenow': playhead,
          'aria-valuetext': currentLabel,
          onPointerDown: trackPointerDown,
          onPointerMove: trackPointerMove,
          onPointerUp: trackPointerUp,
          onPointerCancel: trackPointerUp,
          onKeyDown: trackKeyDown,
          onDoubleClick: trackDoubleClick,
          'data-playhead': playhead,
        },
        // 上轨：活跃度柱（0–46px，基线在 46px）。
        h('div', { className: 'tl-activity', 'aria-hidden': true }, ...bars),
        // 下轨：会话分层（50 起，行距 10，最多 4 行）。
        h('div', { className: 'tl-lanes', 'aria-hidden': true }, ...sessionBars),
        // 播放头：2px 竖线贯穿两轨 + **唯一**一个标签（顶部，贴边翻转）。
        // 标签**独立**于竖线定位（竖线只有 2px 宽，把标签塞进它会算不清包含关系）：
        // 标签左/右边界由 data-label-anchor 决定贴在播放头的哪一侧 → 永远不越出轨道。
        h('span', {
          className: 'tl-playhead-line',
          style: { insetInlineStart: ratio * 100 + '%' },
          'data-playhead-line': 'true',
          'aria-hidden': true,
        }),
        h(
          'span',
          {
            className: 'tl-playhead-label',
            'data-playhead-label': 'true',
            'data-label-anchor': labelAnchor,
            'aria-hidden': true,
            style: { insetInlineStart: ratio * 100 + '%' },
          },
          currentLabel,
        ),
        // 刻度：只有 start / middle / end 三个标签，没有刻度线。
        h('div', { className: 'tl-scale', 'aria-hidden': true }, ...scaleLabels),
      ),
    ),
    h(
      'span',
      { className: 'threadline-visually-hidden', 'aria-live': 'polite', role: 'status', 'data-live': 'true' },
      liveText,
    ),
  )
}
