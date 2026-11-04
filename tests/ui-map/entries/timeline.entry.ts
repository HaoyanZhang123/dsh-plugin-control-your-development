/*
 * tests/ui-map/entries/timeline.entry.ts —— 时间轴截图夹具（T07 / A41-3）。
 *
 * 不是产品代码：import 真组件 + 确定性 fixture。星图用于证明"节点按 firstAt 出现"，
 * 时间轴用于拖拽/播放/暂停/回到现在/未加载斜纹。
 *
 * URL 参数：
 *   ?state=unloaded|now|empty   播放头停在未加载区段 / 最新 / 无数据域
 *   ?range=all|today|7d|30d     范围（与 header 同源）
 *   ?theme=dark                 深色
 *   ?locale=zh|en               界面语言
 *   ?reduced=1                  reduced-motion
 *
 * 暴露 `window.__tlTimeline`：state()/play()/pause()/now()/setSpeed()/press(ratio)/slider()
 * 以及 mapNodeCount()（星图上可见节点数，用于证明"按时间出现"）。
 */
import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { createTranslator, type Locale } from '../../../src/client/locale/index.ts'
import { installStyles } from '../../../src/client/styles/index.ts'
import { ProgressPill } from '../../../src/client/ui/common/index.ts'
import { MapView } from '../../../src/client/ui/map/index.ts'
import { ThreadlineShell, type RangeKey } from '../../../src/client/ui/shell/index.ts'
import {
  cumulativeOpsAt,
  visiblePathsAt,
  type TimeRange,
} from '../../../src/client/ui/timeline/index.ts'
import { Timeline } from '../../../src/client/ui/timeline/index.ts'
import { makeDataset, makeTimelineFixture, NOW } from '../fixtures.ts'

const h = React.createElement

interface TimelineApi {
  version: number
  state: () => { playhead: number; playing: boolean; speed: number; playheadLabel: string; live: string; unloadedHint: string | null }
  play: () => void
  pause: () => void
  now: () => void
  setSpeed: (speed: 1 | 4) => void
  press: (ratio: number) => void
  slider: () => { min: string | null; max: string | null; now: string | null; valueText: string | null }
  unloadedCount: () => number
  unloadedHint: () => string | null
  mapNodeCount: () => number
  range: () => RangeKey
}

declare global {
  interface Window {
    __tlTimeline?: TimelineApi
  }
}

function readParams(): { locale: Locale; state: string; range: RangeKey; dark: boolean; reduced: boolean } {
  const params = new URLSearchParams(location.search)
  const rangeRaw = params.get('range')
  const range: RangeKey =
    rangeRaw === 'today' || rangeRaw === '7d' || rangeRaw === '30d' || rangeRaw === 'all'
      ? ('range.' + rangeRaw) as RangeKey
      : 'range.all'
  return {
    locale: params.get('locale') === 'en' ? 'en' : 'zh',
    state: params.get('state') ?? 'unloaded',
    range,
    dark: params.get('theme') === 'dark',
    reduced: params.get('reduced') === '1',
  }
}

function App(): React.ReactElement {
  const params = readParams()
  const t = React.useMemo(() => createTranslator(params.locale), [params.locale])
  const dataset = React.useMemo(() => makeDataset(), [])
  const fixture = React.useMemo(() => makeTimelineFixture(dataset.files), [dataset])
  const domain: TimeRange | null = params.state === 'empty' ? null : fixture.domain

  // 可复现的初始播放头：未加载区段中点 / 最新 / 域中点（无数据时用 now）。
  const initialPlayhead = React.useMemo(() => {
    if (params.state === 'empty') return NOW
    if (params.state === 'unloaded') {
      const range = fixture.unloadedRanges[0]
      return Math.round((range.start + range.end) / 2)
    }
    return Math.round(fixture.domain.end)
  }, [params.state, fixture])

  const [playhead, setPlayhead] = React.useState(initialPlayhead)
  const [playing, setPlaying] = React.useState(false)
  const [speed, setSpeed] = React.useState<1 | 4>(1)

  const visiblePaths = React.useMemo(() => {
    if (params.state === 'empty') return null
    return visiblePathsAt(fixture.nodes, playhead)
  }, [params.state, fixture, playhead])
  const opsAt = React.useMemo(() => {
    const result: Record<string, number> = {}
    for (const node of fixture.nodes) result[node.path] = cumulativeOpsAt(node, playhead)
    return result
  }, [fixture, playhead])

  React.useEffect(() => {
    window.__tlTimeline = {
      version: 1,
      state: () => {
        const live = document.querySelector('[data-live]')
        const playheadEl = document.querySelector('.tl-playhead') as HTMLElement | null
        const label = document.querySelector('[data-playhead-label]')
        return {
          playhead,
          playing,
          speed,
          playheadLabel: playheadEl === null ? '' : label?.textContent ?? '',
          live: live?.textContent ?? '',
          unloadedHint: document.querySelector('[data-unloaded-hint]')?.textContent ?? null,
        }
      },
      play: () => setPlaying(true),
      pause: () => setPlaying(false),
      now: () => setPlayhead(NOW),
      setSpeed: (next: 1 | 4) => setSpeed(next),
      press: (ratio: number) => {
        const track = document.querySelector('.tl-track') as HTMLElement | null
        if (!track) return
        const rect = track.getBoundingClientRect()
        const x = rect.left + rect.width * Math.min(1, Math.max(0, ratio))
        const y = rect.top + rect.height / 2
        const init = { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', button: 0, clientX: x, clientY: y }
        track.dispatchEvent(new PointerEvent('pointerdown', init))
        track.dispatchEvent(new PointerEvent('pointermove', { ...init, clientX: x + 1 }))
        track.dispatchEvent(new PointerEvent('pointerup', { ...init, clientX: x + 1 }))
      },
      slider: () => {
        const slider = document.querySelector('[role="slider"]')
        if (!slider) return { min: null, max: null, now: null, valueText: null }
        return {
          min: slider.getAttribute('aria-valuemin'),
          max: slider.getAttribute('aria-valuemax'),
          now: slider.getAttribute('aria-valuenow'),
          valueText: slider.getAttribute('aria-valuetext'),
        }
      },
      unloadedCount: () => document.querySelectorAll('.tl-unloaded').length,
      unloadedHint: () => document.querySelector('[data-unloaded-hint]')?.textContent ?? null,
      mapNodeCount: () => document.querySelectorAll('[data-node-path]').length,
      range: () => params.range,
    }
  })

  return h(
    ThreadlineShell,
    {
      locale: params.locale,
      workspaceName: 'skill开发',
      range: params.range,
      onRangeChange: () => undefined,
      coverageSlot: h(ProgressPill, {
        state: 'partial',
        done: 96,
        total: 128,
        text: t('coverage.partial', { done: 96, total: 128 }),
        title: t('coverage.partial', { done: 96, total: 128 }),
      }),
      mapSlot: h(MapView, {
        locale: params.locale,
        nodes: dataset.files,
        edges: dataset.edges,
        now: NOW,
        selectedPath: null,
        onSelectFile: () => undefined,
        visiblePaths,
        opsAt,
        reducedMotion: params.reduced,
        formatTime: (at: number) => new Date(at).toISOString().slice(0, 16).replace('T', ' '),
        testId: 'map',
      }),
      timelineSlot: h(Timeline, {
        locale: params.locale,
        range: params.range,
        domain,
        playhead,
        onPlayheadChange: setPlayhead,
        playing,
        onPlayingChange: setPlaying,
        speed,
        onSpeedChange: setSpeed,
        unloadedRanges: params.state === 'empty' ? [] : fixture.unloadedRanges,
        nodes: fixture.nodes,
        sessions: fixture.sessions,
        now: NOW,
        reducedMotion: params.reduced,
        testId: 'timeline',
      }),
      turnStripCollapsed: true,
      inspectorOpen: false,
      turnStripSlot: null,
      testId: 'timeline-shell',
    },
    null,
  )
}

const params = readParams()
if (params.dark) document.body.setAttribute('data-ds-dark-theme', '')
installStyles(document)
const container = document.getElementById('root')
if (!container) throw new Error('timeline.entry: 缺少 #root')
createRoot(container).render(h(App, null))

requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    document.documentElement.setAttribute('data-harness-ready', '1')
  })
})
