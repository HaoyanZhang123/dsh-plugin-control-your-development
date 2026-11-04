/*
 * tests/ui-map/entries/map.entry.ts —— 星图截图夹具（T07 / A41-1 / A41-2）。
 *
 * 不是产品代码：import 真组件 + 确定性 fixture，喂给 harness 渲染/断言。
 * URL 参数（一个组合 = 一个可复现状态）：
 *   ?state=focus|unfocus|all     初始是否选中一个有共现邻居的文件 / 是否全局画边
 *   ?theme=dark                  深色
 *   ?locale=zh|en                界面语言
 *   ?reduced=1                   模拟 reduced-motion（组件 prop + 页面 media 由 harness 模拟）
 *   ?t=0..1                      播放头位置（按 firstAt 过滤可见节点 + 累计 ops 生长）
 *
 * 暴露 `window.__tl` 给 tests/ui-map/run-t07.mjs 做交互断言（只读 DOM + 状态驱动；
 * 点击/悬停仍走真实 DOM 事件，不直接改组件内部状态）。
 */
import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { createTranslator, type Locale } from '../../../src/client/locale/index.ts'
import { installStyles } from '../../../src/client/styles/index.ts'
import { ProgressPill } from '../../../src/client/ui/common/index.ts'
import { MapView } from '../../../src/client/ui/map/index.ts'
import { ThreadlineShell } from '../../../src/client/ui/shell/index.ts'
import {
  cumulativeOpsAt,
  Timeline,
  visiblePathsAt,
  type TimeRange,
} from '../../../src/client/ui/timeline/index.ts'
import { makeDataset, makeTimelineFixture, NOW } from '../fixtures.ts'

const h = React.createElement

declare global {
  interface Window {
    __tl?: {
      version: number
      state: string
      selected: () => string | null
      opened: () => string | null
      nodeCount: () => number
      clusterCount: () => number
      edgeLayers: () => Record<string, number>
      coords: () => Array<[string, string, string]>
      dimCount: () => number
      opacityOf: (path: string) => number | null
      zoom: () => string | null
      refresh: () => void
      generation: () => number
      openCount: () => number
    }
  }
}

function pickFocusFile(edges: ReadonlyArray<{ type: string; from: string }>): string {
  const coTurn = edges.find((edge) => edge.type === 'coTurn')
  return coTurn === undefined ? '' : coTurn.from
}

function readParams(): {
  locale: Locale
  state: string
  dark: boolean
  reduced: boolean
  t: number | null
} {
  const params = new URLSearchParams(location.search)
  const tRaw = params.get('t')
  return {
    locale: params.get('locale') === 'en' ? 'en' : 'zh',
    state: params.get('state') ?? 'focus',
    dark: params.get('theme') === 'dark',
    reduced: params.get('reduced') === '1',
    t: tRaw === null ? null : Math.min(1, Math.max(0, Number(tRaw))),
  }
}

function App(): React.ReactElement {
  const params = readParams()
  const t = React.useMemo(() => createTranslator(params.locale), [params.locale])
  const dataset = React.useMemo(() => makeDataset(), [])
  const timeline = React.useMemo(() => makeTimelineFixture(dataset.files), [dataset])
  const focusFile = React.useMemo(() => pickFocusFile(dataset.edges), [dataset])

  const [generation, setGeneration] = React.useState(0)
  // 刷新模拟：同内容、新数组/新对象（真实刷新时 T04 也会给新对象）→ 坐标必须不跳。
  const nodes = React.useMemo(
    () => (generation === 0 ? dataset.files : dataset.files.map((file) => ({ ...file }))),
    [dataset, generation],
  )
  const [selectedPath, setSelectedPath] = React.useState<string | null>(params.state === 'focus' ? focusFile : null)
  const [openedPath, setOpenedPath] = React.useState<string | null>(null)
  const [openCount, setOpenCount] = React.useState(0)

  const timeWindow: TimeRange = timeline.domain
  const playhead = params.t === null ? timeWindow.end : timeWindow.start + (timeWindow.end - timeWindow.start) * params.t
  const visiblePaths = params.t === null ? null : visiblePathsAt(timeline.nodes, playhead)
  const opsAt = React.useMemo(() => {
    if (params.t === null) return null
    const result: Record<string, number> = {}
    for (const node of timeline.nodes) result[node.path] = cumulativeOpsAt(node, playhead)
    return result
  }, [params.t, playhead, timeline])

  React.useEffect(() => {
    window.__tl = {
      version: 1,
      state: params.state,
      selected: () => document.querySelector('[data-node-path][data-selected="true"]')?.getAttribute('data-node-path') ?? null,
      opened: () => openedPath,
      nodeCount: () => document.querySelectorAll('[data-node-path]').length,
      clusterCount: () => document.querySelectorAll('[data-cluster-key]').length,
      edgeLayers: () => {
        const result: Record<string, number> = {}
        const groups = document.querySelectorAll('[data-edge-id]')
        for (let index = 0; index < groups.length; index += 1) {
          const layer = groups[index].getAttribute('data-layer') ?? '?'
          result[layer] = (result[layer] ?? 0) + 1
        }
        return result
      },
      coords: () => {
        const list: Array<[string, string, string]> = []
        const groups = document.querySelectorAll('[data-node-path]')
        for (let index = 0; index < groups.length; index += 1) {
          const el = groups[index]
          list.push([
            el.getAttribute('data-node-path') ?? '',
            el.getAttribute('data-x') ?? '',
            el.getAttribute('data-y') ?? '',
          ])
        }
        return list
      },
      dimCount: () => document.querySelectorAll('[data-node-path][data-dim="true"]').length,
      opacityOf: (path: string) => {
        const el = document.querySelector('[data-node-path="' + path + '"]')
        if (!el) return null
        const value = el.getAttribute('data-opacity')
        return value === null ? null : Number(value)
      },
      zoom: () => document.querySelector('[data-tl-map]')?.getAttribute('data-zoom') ?? null,
      refresh: () => setGeneration((value) => value + 1),
      generation: () => generation,
      openCount: () => openCount,
    }
  })

  return h(
    ThreadlineShell,
    {
      locale: params.locale,
      workspaceName: 'skill开发',
      range: 'range.all' as const,
      onRangeChange: () => undefined,
      coverageSlot: h(ProgressPill, {
        state: 'complete',
        done: 42,
        total: 42,
        text: t('coverage.complete', { total: 42 }),
        title: t('coverage.complete', { total: 42 }),
      }),
      mapSlot: h(MapView, {
        locale: params.locale,
        nodes,
        edges: [...dataset.edges, ...dataset.sequence],
        now: NOW,
        selectedPath,
        onSelectFile: (path: string | null) => setSelectedPath(path),
        onOpenFile: (path: string) => {
          setOpenedPath(path)
          setOpenCount((value) => value + 1)
        },
        onSelectEdge: () => undefined,
        selectedTurn: params.state === 'focus' ? { sessionId: dataset.turns[0].sessionId, turn: dataset.turns[0].turn } : null,
        layers: { coSession: true, sequence: true },
        showAllRelations: params.state === 'all',
        showAllReferences: params.state === 'all',
        reducedMotion: params.reduced,
        visiblePaths,
        opsAt,
        formatTime: (at: number) => new Date(at).toISOString().slice(0, 16).replace('T', ' '),
        testId: 'map',
      }),
      timelineSlot: h(Timeline, {
        locale: params.locale,
        range: 'range.all' as const,
        domain: timeline.domain,
        playhead: timeline.domain.end,
        onPlayheadChange: () => undefined,
        playing: false,
        onPlayingChange: () => undefined,
        speed: 1,
        onSpeedChange: () => undefined,
        unloadedRanges: [],
        nodes: timeline.nodes,
        sessions: timeline.sessions,
        now: NOW,
        reducedMotion: params.reduced,
        testId: 'timeline',
      }),
      turnStripCollapsed: true,
      inspectorOpen: false,
      turnStripSlot: null,
      testId: 'map-shell',
    },
    null,
  )
}

const params = readParams()
if (params.dark) document.body.setAttribute('data-ds-dark-theme', '')
installStyles(document)
const container = document.getElementById('root')
if (!container) throw new Error('map.entry: 缺少 #root')
createRoot(container).render(h(App, null))

requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    document.documentElement.setAttribute('data-harness-ready', '1')
  })
})
