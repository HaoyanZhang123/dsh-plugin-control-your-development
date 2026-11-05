/*
 * tests/ui-map/entries/map.entry.ts —— 脉络 2.0 版式的截图/交互夹具（T31，33 §2/§3/§8）。
 *
 * 不是产品代码：import 真组件（ThreadlineShell / FileGraph / DirectoryRail / Timeline / TurnStrip）
 * + 确定性 fixture，喂给 harness 渲染/断言。一个 URL 参数组合 = 一个可复现状态：
 *   ?state=default|turn|scrolled   默认目录图 / 轮次状态 / 滚动右栏（验证左列 sticky）
 *   ?dir=projects                  初始选中目录键（缺省 = 文件操作最多的目录）
 *   ?turn=3                        初始选中轮次（state=turn 时）
 *   ?files=600                     600 文件 / 8 目录夹具
 *   ?dirs=20                       20 个顶层目录（真实规模代理）
 *   ?locale=zh|en / ?theme=dark / ?reduced=1
 *
 * 暴露 `window.__tl` 给 tests/ui-map/run-t07.mjs（只读 DOM + 状态驱动；点击仍走真实 DOM 事件）。
 */
import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { createTranslator, type Locale } from '../../../src/client/locale/index.ts'
import { installStyles } from '../../../src/client/styles/index.ts'
import { ProgressPill } from '../../../src/client/ui/common/index.ts'
import { FileGraph } from '../../../src/client/ui/map/index.ts'
import { DIRECTORY_TOP_FILES, DirectoryRail, buildDirectoryCards, directoryKeyOf } from '../../../src/client/ui/rail/index.ts'
import { ThreadlineShell } from '../../../src/client/ui/shell/index.ts'
import { Timeline } from '../../../src/client/ui/timeline/index.ts'
import {
  SessionSelector,
  TurnStrip,
  turnFileStatusOf,
  type Selection,
} from '../../../src/client/ui/turns/index.ts'
import type { FileNode, TurnDetail, TurnFile } from '../../../src/shared/events/index.ts'
import { buildEdges, makeDataset, makeTimelineFixture, NOW, REAL_DIRS } from '../fixtures.ts'

const h = React.createElement

declare global {
  interface Window {
    __tl?: {
      version: number
      state: string
      mode: () => string | null
      directory: () => string | null
      cardCount: () => number
      cardKeys: () => string[]
      selectedCard: () => string | null
      dimCards: () => string[]
      nodeCount: () => number
      nodeFamilies: () => string[]
      edgeLayers: () => Record<string, number>
      labelCount: () => number
      statusNodes: () => Array<{ path: string; read: string | null; add: string | null; del: string | null; first: string | null }>
      summaryText: () => string | null
      selectedPath: () => string | null
      clickCard: (key: string) => void
      selectTurn: (n: number) => void
      exitTurn: () => void
      scrollProof: () => {
        windowScroll: number
        shellScroll: number
        shellScrollHeight: number
        shellClientHeight: number
        graphOverflowY: boolean
        railOverflowY: boolean
        leftSticky: boolean
      }
      scrollShell: (top: number) => void
    }
  }
}

function readParams(): {
  locale: Locale
  state: string
  dir: string | null
  turn: number | null
  files: number
  dirs: boolean
  dark: boolean
  reduced: boolean
} {
  const params = new URLSearchParams(location.search)
  const turnRaw = params.get('turn')
  return {
    locale: params.get('locale') === 'en' ? 'en' : 'zh',
    state: params.get('state') ?? 'default',
    dir: params.get('dir'),
    turn: turnRaw === null ? null : Number(turnRaw),
    files: params.get('files') === '600' ? 600 : 200,
    dirs: params.get('dirs') === '20',
    dark: params.get('theme') === 'dark',
    reduced: params.get('reduced') === '1',
  }
}

/** 从 fixture 的 relation turns 生成可显示的 TurnDetail（状态/行数/删除命令都是夹具事实）。 */
function buildTurnDetails(turns: ReadonlyArray<{ sessionId: string; turn: number; files: readonly TurnFile[] }>): TurnDetail[] {
  const base = NOW - 6 * 60 * 60 * 1000
  return turns.slice(0, 12).map((turn, index) => {
    const start = base + index * 12 * 60 * 1000
    const files: TurnFile[] = turn.files.map((file) => ({ path: file.path, ops: file.ops, added: file.added, removed: file.removed }))
    const aborted = index % 7 === 0
    return {
      n: index + 1,
      start,
      end: start + 10 * 60 * 1000,
      status: aborted ? 'aborted' : 'completed',
      endKind: aborted ? 'aborted' : 'completed',
      files,
      commands: [],
      subagents: [],
      errors: index % 5 === 0 ? 1 : 0,
      toolCalls: files.length * 2,
      toolFailures: 0,
      ...(index % 4 === 0 ? { deleteCommands: (index % 3) + 1 } : {}),
      messageIds: [],
    }
  })
}

function App(): React.ReactElement {
  const params = readParams()
  const t = React.useMemo(() => createTranslator(params.locale), [params.locale])
  const dataset = React.useMemo(
    () =>
      makeDataset({
        ...(params.files === 600 ? { count: 600, seed: 2026 } : {}),
        ...(params.dirs ? { dirs: REAL_DIRS } : {}),
      }),
    [params.files, params.dirs],
  )
  const nodes = dataset.files
  const fileIndex = React.useMemo(() => {
    const map = new Map<string, FileNode>()
    for (const file of nodes) {
      map.set(file.path, file)
      map.set(file.path.toLowerCase(), file)
    }
    return map
  }, [nodes])
  const timeline = React.useMemo(() => makeTimelineFixture(dataset.files), [dataset])
  const edges = React.useMemo(() => buildEdges(dataset.files, dataset.turns, { references: 12 }), [dataset])
  const turnDetails = React.useMemo(() => buildTurnDetails(dataset.turns), [dataset.turns])
  const groups = React.useMemo(
    () => [{ sessionId: 'sess-0001', title: '脉络 2.0 重构', running: false, partial: false, turns: turnDetails }],
    [turnDetails],
  )
  const sessions = React.useMemo(
    () => [
      { id: 'sess-0001', updatedAt: NOW, running: false, archived: false, status: 'completed' as const, turns: turnDetails.length, title: '脉络 2.0 重构' },
    ],
    [turnDetails],
  )

  const cards = React.useMemo(() => buildDirectoryCards(nodes, { rootLabel: t('map.rootCluster'), topFiles: DIRECTORY_TOP_FILES }), [nodes, t])
  const initialDirectory = params.dir !== null && cards.some((card) => card.key === params.dir) ? params.dir : cards.length === 0 ? '' : cards[0].key
  const [directoryKey, setDirectoryKey] = React.useState<string>(initialDirectory)
  const [activeTurnN, setActiveTurnN] = React.useState<number | null>(
    params.state === 'turn' ? (params.turn !== null && turnDetails.some((turn) => turn.n === params.turn) ? params.turn : turnDetails[0]?.n ?? null) : null,
  )
  const [selectedPath, setSelectedPath] = React.useState<string | null>(null)
  const [selection, setSelection] = React.useState<Selection>({ kind: 'none' })
  const [preview, setPreview] = React.useState<Selection | null>(null)

  const activeTurn = React.useMemo(() => turnDetails.find((turn) => turn.n === activeTurnN) ?? null, [turnDetails, activeTurnN])
  const turnStatus = React.useMemo(() => (activeTurn === null ? null : turnFileStatusOf(activeTurn, fileIndex)), [activeTurn, fileIndex])
  const directoryLabel = directoryKey === '' ? t('map.rootCluster') : directoryKey
  const directoryFiles = React.useMemo(
    () => nodes.filter((node) => directoryKeyOf(node.path) === directoryKey),
    [nodes, directoryKey],
  )
  const turnFiles = React.useMemo(() => {
    if (activeTurn === null) return []
    const list: FileNode[] = []
    for (const touch of activeTurn.files) {
      const node = fileIndex.get(touch.path) ?? fileIndex.get(touch.path.toLowerCase())
      if (node !== undefined) list.push(node)
    }
    return list
  }, [activeTurn, fileIndex])
  const mode = activeTurn === null ? 'directory' : 'turn'
  const graphFiles = mode === 'turn' ? turnFiles : directoryFiles
  const activeKeys = React.useMemo(() => {
    if (mode !== 'turn') return null
    const keys = new Set<string>()
    for (const file of graphFiles) keys.add(directoryKeyOf(file.path))
    return keys
  }, [mode, graphFiles])

  const selectCard = React.useCallback((key: string) => {
    setDirectoryKey(key)
    setActiveTurnN(null)
    setSelection({ kind: 'none' })
    setPreview(null)
    setSelectedPath(null)
  }, [])
  const selectTurn = React.useCallback((n: number) => {
    setActiveTurnN((previous) => (previous === n ? null : n))
    setSelection({ kind: 'none' })
    setPreview(null)
    setSelectedPath(null)
  }, [])
  const exitTurn = React.useCallback(() => {
    setActiveTurnN(null)
    setSelection({ kind: 'none' })
    setPreview(null)
    setSelectedPath(null)
  }, [])

  React.useEffect(() => {
    window.__tl = {
      version: 3,
      state: params.state,
      mode: () => document.querySelector('[data-tl-graph]')?.getAttribute('data-graph-mode') ?? null,
      directory: () => document.querySelector('[data-tl-graph]')?.getAttribute('data-graph-directory') ?? null,
      cardCount: () => document.querySelectorAll('[data-directory-card]').length,
      cardKeys: () => Array.from(document.querySelectorAll('[data-directory-card]'), (el) => el.getAttribute('data-directory-card') ?? ''),
      selectedCard: () => document.querySelector('[data-directory-card][data-selected="true"]')?.getAttribute('data-directory-card') ?? null,
      dimCards: () => Array.from(document.querySelectorAll('[data-directory-card][data-dim="true"]'), (el) => el.getAttribute('data-directory-card') ?? ''),
      nodeCount: () => document.querySelectorAll('[data-file-path]').length,
      nodeFamilies: () => Array.from(document.querySelectorAll('[data-file-path]'), (el) => el.getAttribute('data-family') ?? ''),
      edgeLayers: () => {
        const result: Record<string, number> = {}
        for (const el of Array.from(document.querySelectorAll('[data-edge-id]'))) {
          const layer = el.getAttribute('data-layer') ?? '?'
          result[layer] = (result[layer] ?? 0) + 1
        }
        return result
      },
      labelCount: () => document.querySelectorAll('[data-label-for]').length,
      statusNodes: () =>
        Array.from(document.querySelectorAll('[data-file-path][data-read]'), (el) => ({
          path: el.getAttribute('data-file-path') ?? '',
          read: el.getAttribute('data-read'),
          add: el.getAttribute('data-write-add'),
          del: el.getAttribute('data-write-del'),
          first: el.getAttribute('data-first-seen'),
        })),
      summaryText: () => document.querySelector('.tl-graph-summary')?.textContent ?? null,
      selectedPath: () => selectedPath,
      clickCard: (key: string) => {
        const card = document.querySelector('[data-directory-card="' + key + '"]') as HTMLElement | null
        card?.click()
      },
      selectTurn: (n: number) => selectTurn(n),
      exitTurn: () => exitTurn(),
      scrollProof: () => {
        const shell = document.querySelector('[data-threadline-shell]') as HTMLElement | null
        const graph = document.querySelector('.tl-graph') as HTMLElement | null
        const rail = document.querySelector('.threadline-rail') as HTMLElement | null
        const left = document.querySelector('.threadline-left') as HTMLElement | null
        const leftStyle = left === null ? null : window.getComputedStyle(left)
        return {
          windowScroll: window.scrollY,
          shellScroll: shell?.scrollTop ?? 0,
          shellScrollHeight: shell?.scrollHeight ?? 0,
          shellClientHeight: shell?.clientHeight ?? 0,
          graphOverflowY: graph !== null && graph.scrollHeight > graph.clientHeight + 1,
          railOverflowY: rail !== null && rail.scrollHeight > rail.clientHeight + 1,
          leftSticky: leftStyle !== null && leftStyle.position === 'sticky',
        }
      },
      scrollShell: (top: number) => {
        const shell = document.querySelector('[data-threadline-shell]') as HTMLElement | null
        if (shell !== null) shell.scrollTop = top
      },
    }
  })

  React.useEffect(() => {
    if (params.state !== 'scrolled') return
    const shell = document.querySelector('[data-threadline-shell]') as HTMLElement | null
    if (shell !== null) shell.scrollTop = Math.round(shell.scrollHeight * 0.45)
  }, [params.state])

  const timelineNodes = React.useMemo(
    () => nodes.map((node: FileNode) => ({ path: node.path, firstAt: node.firstAt, lastAt: node.lastAt, ops: node.ops })),
    [nodes],
  )
  const playhead = timeline.domain.end

  const strip = h(TurnStrip, {
    t,
    groups,
    sessions,
    selected: selection,
    preview,
    onPreview: (target: Selection | null) => setPreview(target),
    onSelect: (target: Selection) => {
      setSelection({ kind: 'none' })
      if (target.kind === 'turn') selectTurn(target.turn)
    },
    onClearSelection: exitTurn,
    onEscape: exitTurn,
    now: NOW,
    testId: 'turn-strip',
  })

  return h(ThreadlineShell, {
    locale: params.locale,
    workspaceName: 'skill开发',
    range: 'range.all',
    onRangeChange: () => undefined,
    coverageSlot: h(ProgressPill, {
      state: 'complete',
      done: 42,
      total: 42,
      text: t('coverage.complete', { total: 42 }),
      title: t('coverage.complete', { total: 42 }),
    }),
    graphSlot: h(FileGraph, {
      files: graphFiles,
      edges,
      mode,
      directoryKey,
      directoryLabel,
      turn: activeTurn === null || turnStatus === null ? null : { turn: activeTurn, status: turnStatus },
      selectedPath,
      onSelectFile: (path: string | null) => {
        setSelectedPath(path)
        setSelection(path === null ? { kind: 'none' } : { kind: 'file', path })
      },
      onOpenFile: () => undefined,
      onExitTurn: exitTurn,
      now: NOW,
      locale: params.locale,
      reducedMotion: params.reduced,
      testId: 'graph',
    }),
    timelineSlot: h(Timeline, {
      locale: params.locale,
      range: 'range.all',
      domain: timeline.domain,
      playhead,
      onPlayheadChange: () => undefined,
      playing: false,
      onPlayingChange: () => undefined,
      nodes: timelineNodes,
      sessions: timeline.sessions,
      now: NOW,
      reducedMotion: params.reduced,
      testId: 'timeline',
    }),
    turnStripTitle: t('inspector.turn'),
    turnStripCollapsed: false,
    turnStripHeadSlot: h(SessionSelector, {
      t,
      sessions,
      scope: { kind: 'current' },
      onScopeChange: () => undefined,
    }),
    turnStripSlot: strip,
    railSlot: h(DirectoryRail, {
      nodes,
      selectedKey: mode === 'directory' ? directoryKey : null,
      activeKeys,
      ...(activeTurn === null ? {} : { currentTurnPaths: activeTurn.files.map((file) => file.path) }),
      onSelect: selectCard,
      locale: params.locale,
      formatTime: (at: number) => new Date(at).toISOString().slice(0, 16).replace('T', ' '),
      testId: 'directory-rail',
    }),
    testId: 'map-shell',
  })
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
