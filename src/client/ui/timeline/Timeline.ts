/*
 * timeline/Timeline.ts —— 时间轴（03 §5；验收 A41-3）。
 *
 * 纯展示：范围（`range`，与 header 的 range 状态同源，由 props 传入）、播放头、播放态、
 * 倍速、未加载区段、节点/会话数据全部 props 进；推进通过 `onPlayheadChange` 回调交给 T09。
 * 本组件不注册 slot、不发请求、不读数据层单例。
 *
 * 关键行为：
 * - 刻度按范围自适应（年/月/周/日/小时/分钟）；
 * - 播放头可拖（rAF 节流）、键盘方向键/HOME/END 可调；
 * - 播放 1× / 4×（受控）+ 暂停 + 回到现在；
 * - 未加载区段画斜纹 + `未加载`，播放头落入时提示 `state.unloadedRange`，**不画假节点**；
 * - `prefers-reduced-motion`（或 `reducedMotion` prop）下无生长动画、无平滑 fit。
 */
import * as React from 'react'
import { createTranslator, DEFAULT_LOCALE, type Locale, type Translator } from '../../locale/index.ts'
import { Button } from '../common/index.ts'
import type { RangeKey } from '../shell/index.ts'
import {
  advancePlayhead,
  buildTicks,
  clampPlayhead,
  clipUnloadedRanges,
  formatTick,
  growthAt,
  playheadLabel,
  ratioToTime,
  timeToRatio,
  unloadedRangeAt,
  windowForRange,
  type TickGranularity,
  type TimeRange,
  type TimelineNode,
  type TimelineSession,
} from './scale.ts'

const h = React.createElement

/** 时间轴 props（T09 接线契约）。 */
export interface TimelineProps {
  /** 时间范围（与 header 同源；`RangeKey` 就是 locale key）。 */
  range: RangeKey
  /** 数据可用时间域；null = 还没有可读数据（显示空态，不伪造 0）。 */
  domain: TimeRange | null
  /** 播放头（ms，受控）。 */
  playhead: number
  onPlayheadChange?: (at: number) => void
  /** 播放态（受控；不传则内部维护）。 */
  playing?: boolean
  onPlayingChange?: (playing: boolean) => void
  /** 播放倍速 1× / 4×（受控；不传则内部维护）。 */
  speed?: 1 | 4
  onSpeedChange?: (speed: 1 | 4) => void
  /** 未加载区段（ms；来自覆盖率数据，不在这里推导）。 */
  unloadedRanges?: readonly TimeRange[]
  /** 节点（用于生长带与"截至 T 的文件数"）；缺省空数组。 */
  nodes?: readonly TimelineNode[]
  /** 会话刻度（开始/结束竖线 + 标题 tooltip）。 */
  sessions?: readonly TimelineSession[]
  /** "现在"（ms）；「回到现在」与默认窗口右界。 */
  now: number
  locale?: Locale
  reducedMotion?: boolean
  className?: string
  testId?: string
  /** 播放推进的时钟（默认 performance.now；测试可注入）。 */
  clock?: () => number
  /** 播放推进时的时间戳（T09 用它算星图 visiblePaths/opsAt）。 */
  onPlayheadTick?: (at: number) => void
  /** 刻度文案格式化（缺省按本地时区）。 */
  formatTickLabel?: (at: number, granularity: TickGranularity) => string
  /** aria-live 播报文案（缺省 playheadLabel）。 */
  announce?: (at: number) => string
}

/** aria-live 节流间隔（03 §15：播放时节流播报当前时间）。 */
export const ANNOUNCE_THROTTLE_MS = 800
/** 生长带采样段数（固定 → 截图可复现）。 */
const GROWTH_SAMPLES = 64

interface DragState {
  pointerId: number
  moved: boolean
}

export function Timeline(props: TimelineProps): React.ReactElement {
  const locale: Locale = props.locale ?? DEFAULT_LOCALE
  const t: Translator = React.useMemo(() => createTranslator(locale), [locale])
  const clock = props.clock ?? ((): number => (typeof performance === 'undefined' ? Date.now() : performance.now()))

  const [internalPlaying, setInternalPlaying] = React.useState(false)
  const [internalSpeed, setInternalSpeed] = React.useState<1 | 4>(1)
  const [liveText, setLiveText] = React.useState('')
  const playing = props.playing ?? internalPlaying
  const speed = props.speed ?? internalSpeed

  const trackRef = React.useRef<HTMLDivElement | null>(null)
  const dragRef = React.useRef<DragState | null>(null)
  const pendingRatio = React.useRef<number | null>(null)
  const rafRef = React.useRef(0)
  const playheadRef = React.useRef(props.playhead)
  playheadRef.current = props.playhead
  const lastAnnounceAt = React.useRef(-Infinity)

  const domain = props.domain
  const window = React.useMemo(() => windowForRange(props.range, props.now, domain), [props.range, props.now, domain])
  const playhead = clampPlayhead(props.playhead, window)

  /* ---------- 回调 ref（rAF 循环不因父级重渲染而重启） ---------- */
  const callbacks = React.useRef({
    onPlayheadChange: props.onPlayheadChange,
    onPlayheadTick: props.onPlayheadTick,
    onPlayingChange: props.onPlayingChange,
  })
  callbacks.current = {
    onPlayheadChange: props.onPlayheadChange,
    onPlayheadTick: props.onPlayheadTick,
    onPlayingChange: props.onPlayingChange,
  }
  const setPlaying = React.useCallback(
    (next: boolean): void => {
      if (props.playing === undefined) setInternalPlaying(next)
      callbacks.current.onPlayingChange?.(next)
    },
    [props.playing],
  )
  const setPlayingRef = React.useRef(setPlaying)
  setPlayingRef.current = setPlaying

  /* ---------- 播放推进（rAF；到窗口尾部即停） ---------- */
  React.useEffect(() => {
    if (!playing || domain === null) return undefined
    if (typeof requestAnimationFrame !== 'function') return undefined
    let raf = 0
    let last = 0
    let cancelled = false
    const step = (time: number): void => {
      if (cancelled) return
      if (last === 0) last = time
      // 后台标签页可能积压几百毫秒；夹到 100ms，避免播放头瞬移（不是平滑，只是防跳）。
      const delta = Math.min(100, Math.max(0, time - last))
      last = time
      const next = advancePlayhead(playheadRef.current, delta, speed, window)
      playheadRef.current = next.value
      callbacks.current.onPlayheadChange?.(next.value)
      callbacks.current.onPlayheadTick?.(next.value)
      if (next.done) {
        setPlayingRef.current(false)
        return
      }
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
    }
  }, [playing, speed, window.start, window.end, domain])

  /* ---------- 卸载：清 rAF ---------- */
  React.useEffect(
    () => () => {
      if (rafRef.current !== 0) cancelAnimationFrame(rafRef.current)
      rafRef.current = 0
    },
    [],
  )

  /* ---------- aria-live 节流播报（播放时 800ms 一次；暂停立即） ---------- */
  const announce = props.announce ?? ((at: number): string => playheadLabel(at, window))
  React.useEffect(() => {
    const text = announce(playhead)
    const nowMs = clock()
    if (playing && nowMs - lastAnnounceAt.current < ANNOUNCE_THROTTLE_MS) return
    lastAnnounceAt.current = nowMs
    setLiveText(text)
  }, [playhead, playing, announce, clock])

  /* ---------- 播放头提交（rAF 节流，拖动时高频事件不卡帧） ---------- */
  const applyTime = React.useCallback(
    (at: number): void => {
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
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault()
      applyTime(playhead + (event.key === 'ArrowRight' ? 1 : -1) * step * (event.shiftKey ? 10 : 1))
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
  const togglePlay = (): void => {
    if (playing) {
      setPlaying(false)
      return
    }
    // 播放头已经在尾部：从头开始（「回到现在」是另一个动作，不复用）。
    if (playhead >= window.end - 1) applyTime(window.start)
    setPlaying(true)
  }

  const changeSpeed = (next: 1 | 4): void => {
    if (props.speed === undefined) setInternalSpeed(next)
    props.onSpeedChange?.(next)
  }

  const goNow = (): void => {
    setPlaying(false)
    applyTime(window.end)
  }

  /* ---------- 派生渲染数据 ---------- */
  const ticks = React.useMemo(() => buildTicks(window, { ...(props.formatTickLabel === undefined ? {} : { format: props.formatTickLabel }) }), [window.start, window.end, props.formatTickLabel])
  const unloaded = React.useMemo(() => clipUnloadedRanges(props.unloadedRanges, window), [props.unloadedRanges, window.start, window.end])
  const activeUnloaded = unloadedRangeAt(unloaded, playhead)
  const nodes = props.nodes ?? []
  const growth = React.useMemo(() => growthAt(nodes, playhead, window), [nodes, playhead, window.start, window.end])
  const growthPath = React.useMemo(() => {
    const points: string[] = ['M0 8']
    for (let index = 0; index <= GROWTH_SAMPLES; index += 1) {
      const x = (100 * index) / GROWTH_SAMPLES
      const ratio = growth.ratios[Math.min(index, growth.ratios.length - 1)] ?? 0
      const y = 8 - ratio * 7
      points.push('L' + (Math.round(x * 100) / 100) + ' ' + (Math.round(y * 100) / 100))
    }
    points.push('L100 8 Z')
    return points.join(' ')
  }, [growth])

  const currentLabel = playheadLabel(playhead, window)
  const ratio = timeToRatio(playhead, window)
  const sessions = React.useMemo(() => {
    const list = props.sessions ?? []
    return list.filter((session) => {
      const end = session.end ?? session.start
      return end >= window.start && session.start <= window.end
    })
  }, [props.sessions, window.start, window.end])

  const playLabel = playing ? t('timeline.pause') : t('timeline.play')

  return h(
    'div',
    {
      className: ['tl-timeline', props.className].filter(Boolean).join(' '),
      'data-tl-timeline': 'true',
      'data-playing': playing ? 'true' : 'false',
      'data-speed': speed,
      'data-reduced-motion': props.reducedMotion === true ? 'true' : 'false',
      'data-unloaded-count': unloaded.length,
      'data-range': props.range,
      'data-testid': props.testId,
    },
    h(
      'div',
      { className: 'tl-controls' },
      h(Button, { label: playLabel, onClick: togglePlay, testId: 'timeline-play' }),
      h(
        'span',
        { className: 'tl-speed', role: 'group', 'aria-label': playLabel },
        h(Button, { label: '1×', pressed: speed === 1, onClick: () => changeSpeed(1), testId: 'timeline-speed-1' }),
        h(Button, { label: '4×', pressed: speed === 4, onClick: () => changeSpeed(4), testId: 'timeline-speed-4' }),
      ),
      h(Button, { label: t('timeline.now'), onClick: goNow, testId: 'timeline-now' }),
    ),
    h(
      'div',
      { className: 'tl-growth' },
      h(
        'svg',
        { className: 'tl-growth-svg', viewBox: '0 0 100 8', preserveAspectRatio: 'none', 'aria-hidden': true, focusable: false },
        h('path', { className: 'tl-growth-line', d: growthPath }),
      ),
      h(
        'div',
        { className: 'tl-ticks', 'aria-hidden': true },
        ...ticks.ticks.map((tick) =>
          h(
            'span',
            { key: tick.at, className: 'tl-tick', 'data-tick-priority': tick.priority, style: { insetInlineStart: tick.ratio * 100 + '%' } },
            tick.label,
          ),
        ),
      ),
      h(
        'div',
        {
          ref: trackRef,
          className: 'tl-track',
          role: 'slider',
          tabIndex: 0,
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
          'data-playhead': playhead,
        },
        ...unloaded.map((range) =>
          h('span', {
            key: 'u:' + range.start,
            className: 'tl-unloaded',
            'data-unloaded-start': range.start,
            'data-unloaded-end': range.end,
            style: {
              insetInlineStart: timeToRatio(range.start, window) * 100 + '%',
              inlineSize: Math.max(0.4, (timeToRatio(range.end, window) - timeToRatio(range.start, window)) * 100) + '%',
            },
          }),
        ),
        ...unloaded.map((range) => {
          const width = (timeToRatio(range.end, window) - timeToRatio(range.start, window)) * 100
          if (width < 10) return null
          return h(
            'span',
            {
              key: 'ul:' + range.start,
              className: 'tl-unloaded-label',
              style: { insetInlineStart: timeToRatio(range.start, window) * 100 + '%' },
            },
            t('state.unloaded'),
          )
        }),
        ...sessions.flatMap((session) => {
          const end = session.end ?? session.start
          const label = (session.title ?? session.id) + ' · ' + t('inspector.turn') + ' ' + session.turns
          const items: React.ReactElement[] = []
          if (session.start >= window.start && session.start <= window.end) {
            items.push(
              h('span', {
                key: 's:' + session.id,
                className: 'tl-session',
                'data-session-id': session.id,
                'data-edge': 'start',
                title: label,
                style: { insetInlineStart: timeToRatio(session.start, window) * 100 + '%' },
              }),
            )
          }
          if (end > session.start && end <= window.end) {
            items.push(
              h('span', {
                key: 'se:' + session.id,
                className: 'tl-session',
                'data-session-id': session.id,
                'data-edge': 'end',
                title: label,
                style: { insetInlineStart: timeToRatio(end, window) * 100 + '%' },
              }),
            )
          }
          return items
        }),
        h(
          'div',
          { className: 'tl-playhead', style: { insetInlineStart: ratio * 100 + '%' }, 'data-playhead-ratio': ratio },
          h('div', { className: 'tl-playhead-handle', role: 'presentation', 'aria-hidden': true }),
        ),
        activeUnloaded
          ? h(
              'span',
              {
                className: 'tl-unloaded-hint',
                'data-unloaded-hint': 'true',
                style: { insetInlineStart: ratio * 100 + '%', transform: 'translateX(-50%)' },
              },
              t('state.unloadedRange'),
            )
          : null,
      ),
    ),
    h('span', { className: 'tl-current threadline-mono', 'data-playhead-label': 'true' }, currentLabel),
    h(
      'span',
      { className: 'threadline-visually-hidden', 'aria-live': 'polite', role: 'status', 'data-live': 'true' },
      liveText,
    ),
  )
}
