/*
 * tests/ui-map/entries/map.entry.ts —— 脉络 2.1 版式的截图/交互夹具（R04 起）。
 *
 * 不是产品代码：import 真组件（ThreadlineShell / FileGraph / DirectoryRail / Timeline / TurnStrip）
 * + 确定性 fixture，喂给 harness 渲染/断言。一个 URL 参数组合 = 一个可复现状态：
 *   ?state=default|turn|scrolled   folder 图 / 轮次状态 / 滚动右栏（验证左列 sticky）
 *   ?dir=src                       当前目录（folder 模式；缺省 = 文件操作最多的顶层目录）
 *   ?turn=3                        初始选中轮次（state=turn 时）
 *   ?files=600                     600 文件 / 8 目录夹具
 *   ?dirs=20                       20 个顶层目录（真实规模代理）
 *   ?at=<ms>                       播放头（可见性）
 *   ?locale=zh|en / ?theme=dark / ?reduced=1
 *
 * 暴露 `window.__tl` 给 tests/ui-map/run-t07.mjs（只读 DOM + 状态驱动；点击仍走真实 DOM 事件）。
 */
import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { createTranslator, type Locale } from '../../../src/client/locale/index.ts'
import { installStyles } from '../../../src/client/styles/index.ts'
import { ProgressPill } from '../../../src/client/ui/common/index.ts'
import { FileGraph, familyOfName, type MapEntry } from '../../../src/client/ui/map/index.ts'
import { FileTreeRail, type RailTouchInfo } from '../../../src/client/ui/rail/index.ts'
import { ThreadlineShell, type RangeKey } from '../../../src/client/ui/shell/index.ts'
import { Timeline } from '../../../src/client/ui/timeline/index.ts'
import { SessionSelector, TurnStrip, turnFileStatusOf, type Selection } from '../../../src/client/ui/turns/index.ts'
import type { FileNode, TurnDetail, TurnFile } from '../../../src/shared/events/index.ts'
import { finalizeGraph } from '../../../src/shared/relations/index.ts'
import { buildEdges, makeDataset, makeTimelineFixture, NOW, REAL_DIRS } from '../fixtures.ts'

const h = React.createElement

declare global {
  interface Window {
    __tl?: {
      version: number
      state: string
      mode: () => string | null
      currentPath: () => string | null
      hubCount: () => number
      hubPaths: () => string[]
      nodeCount: () => number
      fileCount: () => number
      nodeFamilies: () => string[]
      neutralCount: () => number
      edgeLayers: () => Record<string, number>
      labelCount: () => number
      statusNodes: () => Array<{ path: string; read: string | null; add: string | null; del: string | null; first: string | null }>
      summaryText: () => string | null
      selectedPath: () => string | null
      enterHub: (path: string) => void
      backFolder: () => void
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
        leftScroll: number
        leftOverflowY: boolean
        railScroll: number
        railScrollable: boolean
        leftScrollable: boolean
      }
      scrollShell: (top: number) => void
      scrollLeft: (top: number) => void
      scrollRail: (top: number) => void
      /** 缩放探针（M5）：读相机/读视图层 transform/点按钮。 */
      zoom: () => string | null
      zoomTransform: () => string | null
      zoomClick: (action: 'in' | 'out' | 'fit' | 'reset') => void
      zoomCenter: () => { x: number; y: number } | null
      /** 图尾/播放/文案的负向探针（M1/M2）。 */
      footCount: () => number
      playbackControls: () => number
      truncationText: () => string | null
      evidenceVisible: () => boolean
      /* ---- R10（力导向关系图）探针 ---- */
      density: () => string | null
      showAllText: () => string | null
      showAllExpanded: () => boolean
      clickShowAll: () => void
      clickDensity: (next: 'skeleton' | 'standard' | 'all') => void
      edgeCount: () => number
      hubEdgeCount: () => number
      /** R11：枢纽 ↔ 枢纽 的连线数（按档位重算；骨架档必须是 0）。 */
      hubPairCount: () => number
      hubLinkedCount: () => number
      fillRatio: () => number
      relationsCount: () => number
      nodePositions: () => Array<{ path: string; x: number; y: number }>
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
  at: number | null
  nested: boolean
  /** R12：domain=null 的空数据态（时间轴不画假柱子）。 */
  empty: boolean
  /** R12：时间轴 range 探针（range.today / range.7d / range.30d / range.all）。 */
  range: string | null
} {
  const params = new URLSearchParams(location.search)
  const turnRaw = params.get('turn')
  const atRaw = params.get('at')
  const at = atRaw === null ? null : Number(atRaw)
  const range = params.get('range')
  return {
    locale: params.get('locale') === 'en' ? 'en' : 'zh',
    state: params.get('state') ?? 'default',
    dir: params.get('dir'),
    turn: turnRaw === null ? null : Number(turnRaw),
    files: params.get('files') === '600' ? 600 : 200,
    dirs: params.get('dirs') === '20',
    dark: params.get('theme') === 'dark',
    reduced: params.get('reduced') === '1',
    at: at !== null && Number.isFinite(at) ? at : null,
    nested: params.get('nested') === '1',
    empty: params.get('empty') === '1',
    range: range === 'range.today' || range === 'range.7d' || range === 'range.30d' || range === 'range.all' ? range : null,
  }
}

/** 嵌套目录夹具（顶层 dirs 有多段路径，才能验证"当前目录"过滤）。 */
const NESTED_DIRS = ['src/client', 'src/host', 'src/shared', 'src/client/ui', 'docs/api', 'docs/notes', 'notes'] as const

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

/** 顶层目录键（'' = 根）。 */
function topDirOf(path: string): string {
  const slash = path.indexOf('/')
  return slash <= 0 ? '' : path.slice(0, slash)
}

/** 目录 → 直接子文件夹 + 直接文件（模拟 tree listing；产品里由 DATA 的 useDirectoryTree 提供）。 */
function listingFor(currentPath: string, files: readonly FileNode[], extraDirs: readonly string[] = []): MapEntry[] {
  const prefix = currentPath === '' ? '' : currentPath + '/'
  const dirs = new Set<string>()
  const direct: MapEntry[] = []
  for (const file of files) {
    if (prefix !== '' && !file.path.startsWith(prefix)) continue
    const rest = prefix === '' ? file.path : file.path.slice(prefix.length)
    const slash = rest.indexOf('/')
    if (slash > 0) {
      dirs.add(prefix + rest.slice(0, slash))
      continue
    }
    direct.push({ name: file.name, path: file.path, kind: 'file' })
  }
  // 额外造几个空子文件夹（验证枢纽卡与空子目录）。
  for (const name of extraDirs) dirs.add(prefix + name)
  const dirEntries: MapEntry[] = [...dirs]
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
    .map((path) => ({ name: path.slice(path.lastIndexOf('/') + 1), path, kind: 'directory' as const }))
  // 未触碰文件：演示中性节点（不是"0 次操作"）。
  const untouched: MapEntry[] = direct.some((entry) => entry.name === 'UNTOUCHED-NOTES.md')
    ? []
    : [
        {
          name: 'UNTOUCHED-NOTES.md',
          path: prefix + 'UNTOUCHED-NOTES.md',
          kind: 'file' as const,
        },
      ]
  return [...dirEntries, ...direct, ...untouched]
}

function App(): React.ReactElement {
  const params = readParams()
  const t = React.useMemo(() => createTranslator(params.locale), [params.locale])
  const dataset = React.useMemo(
    () =>
      makeDataset({
        ...(params.files === 600 ? { count: 600, seed: 2026 } : {}),
        ...(params.dirs ? { dirs: REAL_DIRS } : {}),
        ...(params.nested ? { dirs: NESTED_DIRS } : {}),
        // 根目录要有像样的文件数：真实工作区根目录一般 10–30 个（README/配置/脚本/杂项）。
        // 夹具默认 min(4, count/40) 只有 3–5 个，导致「根目录关系图」几乎没内容可看
        // （R10 截图验收时暴露：只有 5 个文件 / 2 条关系）。
        // 这里显式给 18，**不改 fixtures.ts 的默认值**（那会影响按 count 推算分布的既有测试）。
        rootFiles: params.nested ? 8 : 18,
      }),
    [params.files, params.dirs, params.nested],
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
  /**
   * 边集**必须与生产一致**：`tab.ts` 是 `finalizeGraph(list).edges`（perNode=12 / global=4000）。
   *
   * R10b 教训：此前这里直接喂 `buildEdges(...)` 的**原始**边（未收口），于是
   * `buildStructureEdges` 的单锚点骨架（同目录其余文件全连 `sorted[0]`）在 28 文件目录里
   * 产生 27 条指向同一节点的结构边 → `maxDeg=29/28`、`max/avg=9.9`，被误判成"布局星爆"。
   * 生产实际经过 `finalizeGraph` 的 12/node 收口后是 `maxDeg=9`、`max/avg=6.0`、`max/nodes=0.32`
   * —— 三条指标本来就达标。夹具失真会误导所有基于截图的布局结论，必须对齐。
   */
  const edges = React.useMemo(() => finalizeGraph(buildEdges(dataset.files, dataset.turns, { references: 12 })).edges, [dataset])
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

  // 默认当前目录 = 工作区根（''，与右栏初始层一致；与 07 §3.1「根层列出所有文件夹与文件」对齐）。
  // ?dir= 可覆盖到任意层。
  const defaultDir = ''
  const [currentPath, setCurrentPath] = React.useState<string>(params.dir ?? defaultDir)
  const [activeTurnN, setActiveTurnN] = React.useState<number | null>(
    params.state === 'turn' ? (params.turn !== null && turnDetails.some((turn) => turn.n === params.turn) ? params.turn : turnDetails[0]?.n ?? null) : null,
  )
  const [selectedPath, setSelectedPath] = React.useState<string | null>(null)
  const [selection, setSelection] = React.useState<Selection>({ kind: 'none' })
  const [preview, setPreview] = React.useState<Selection | null>(null)
  const [hoverPath, setHoverPath] = React.useState<string | null>(null)

  const activeTurn = React.useMemo(() => turnDetails.find((turn) => turn.n === activeTurnN) ?? null, [turnDetails, activeTurnN])
  const turnStatus = React.useMemo(() => (activeTurn === null ? null : turnFileStatusOf(activeTurn, fileIndex)), [activeTurn, fileIndex])
  const mode = activeTurn === null ? 'folder' : 'turn'

  // folder 模式的输入：当前目录 entries + 该目录的直接 touched 文件。
  const entries = React.useMemo(
    () => listingFor(currentPath, nodes, currentPath === '' ? [] : []),
    [currentPath, nodes],
  )
  const folderFiles = React.useMemo(() => {
    const prefix = currentPath === '' ? '' : currentPath + '/'
    return nodes.filter((file) => {
      if (prefix === '' ? file.path.includes('/') : !file.path.startsWith(prefix)) return false
      const rest = prefix === '' ? file.path : file.path.slice(prefix.length)
      return !rest.includes('/')
    })
  }, [currentPath, nodes])
  const turnFiles = React.useMemo(() => {
    if (activeTurn === null) return []
    const list: FileNode[] = []
    for (const touch of activeTurn.files) {
      const node = fileIndex.get(touch.path) ?? fileIndex.get(touch.path.toLowerCase())
      if (node !== undefined) list.push(node)
    }
    return list
  }, [activeTurn, fileIndex])
  const graphFiles = mode === 'turn' ? turnFiles : folderFiles

  const turnRelations = React.useMemo(() => {
    const map: Record<string, number> = {}
    for (const turn of turnDetails) {
      const keys = new Set(turn.files.map((file) => file.path.toLowerCase()))
      let count = 0
      for (const edge of edges) {
        if (keys.has(edge.from.toLowerCase()) && keys.has(edge.to.toLowerCase())) count += 1
      }
      if (count > 0) map['turn:' + String(turn.n)] = count
    }
    return map
  }, [turnDetails, edges])

  const enterFolder = React.useCallback((path: string) => {
    setActiveTurnN(null)
    setSelection({ kind: 'none' })
    setPreview(null)
    setSelectedPath(null)
    setHoverPath(null)
    setCurrentPath(path)
  }, [])
  const backFolder = React.useCallback(() => {
    setSelectedPath(null)
    setHoverPath(null)
    setCurrentPath((previous) => (previous.includes('/') ? previous.slice(0, previous.lastIndexOf('/')) : ''))
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
  // 右栏 = 真实的工作区文件浏览器（DATA 的 FileTreeRail），与左图共享同一份 currentPath/entries。
  const treeEntries = React.useMemo(() => entries.map((entry) => ({ ...entry, family: entry.family ?? familyOfName(entry.name) })), [entries])
  const touchedMap = React.useMemo(() => {
    const map = new Map<string, RailTouchInfo>()
    for (const file of folderFiles) map.set(file.path.toLowerCase(), { ops: file.ops, lastAt: file.lastAt })
    return map
  }, [folderFiles])
  const [viewMode, setViewMode] = React.useState<'cards' | 'list'>('cards')

  React.useEffect(() => {
    window.__tl = {
      version: 4,
      state: params.state,
      mode: () => document.querySelector('[data-tl-graph]')?.getAttribute('data-graph-mode') ?? null,
      currentPath: () => document.querySelector('[data-tl-graph]')?.getAttribute('data-graph-current') ?? null,
      hubCount: () => document.querySelectorAll('[data-folder-hub]').length,
      hubPaths: () => Array.from(document.querySelectorAll('[data-folder-hub]'), (el) => el.getAttribute('data-folder-hub') ?? ''),
      nodeCount: () => document.querySelectorAll('[data-file-path]').length,
      fileCount: () => Number(document.querySelector('[data-tl-graph]')?.getAttribute('data-file-count') ?? '0'),
      nodeFamilies: () => Array.from(document.querySelectorAll('[data-file-path]'), (el) => el.getAttribute('data-family') ?? ''),
      neutralCount: () => document.querySelectorAll('[data-file-path][data-touched="false"]').length,
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
      enterHub: (path: string) => enterFolder(path),
      backFolder: () => backFolder(),
      selectTurn: (n: number) => selectTurn(n),
      exitTurn: () => exitTurn(),
      scrollProof: () => {
        const shell = document.querySelector('[data-threadline-shell]') as HTMLElement | null
        const graph = document.querySelector('.tl-graph') as HTMLElement | null
        const rail = document.querySelector('.threadline-rail') as HTMLElement | null
        const left = document.querySelector('.threadline-left') as HTMLElement | null
        const leftStyle = left === null ? null : window.getComputedStyle(left)
        const railStyle = rail === null ? null : window.getComputedStyle(rail)
        return {
          windowScroll: window.scrollY,
          shellScroll: shell?.scrollTop ?? 0,
          shellScrollHeight: shell?.scrollHeight ?? 0,
          shellClientHeight: shell?.clientHeight ?? 0,
          leftScroll: left?.scrollTop ?? 0,
          leftOverflowY: left !== null && left.scrollHeight > left.clientHeight + 1,
          railScroll: rail?.scrollTop ?? 0,
          railOverflowY: rail !== null && rail.scrollHeight > rail.clientHeight + 1,
          leftScrollable: leftStyle !== null && leftStyle.overflowY === 'auto',
          railScrollable: railStyle !== null && railStyle.overflowY === 'auto',
          graphOverflowY: graph !== null && graph.scrollHeight > graph.clientHeight + 1,
          leftSticky: leftStyle !== null && leftStyle.position === 'sticky',
        }
      },
      scrollShell: (top: number) => {
        const shell = document.querySelector('[data-threadline-shell]') as HTMLElement | null
        if (shell !== null) shell.scrollTop = top
      },
      scrollLeft: (top: number) => {
        const left = document.querySelector('.threadline-left') as HTMLElement | null
        if (left !== null) left.scrollTop = top
      },
      scrollRail: (top: number) => {
        const rail = document.querySelector('.threadline-rail') as HTMLElement | null
        if (rail !== null) rail.scrollTop = top
      },
      zoom: () => document.querySelector('[data-tl-graph]')?.getAttribute('data-zoom') ?? null,
      zoomTransform: () => document.querySelector('[data-zoom-layer]')?.getAttribute('transform') ?? null,
      zoomClick: (action: 'in' | 'out' | 'fit' | 'reset') => {
        const button = document.querySelector('[data-zoom-action="' + action + '"]') as HTMLElement | null
        button?.click()
      },
      // 视图中心对应的图坐标在屏幕上的落点（M5 几何探针）。
      zoomCenter: () => {
        const stage = document.querySelector('[data-graph-stage]') as HTMLElement | null
        const layer = document.querySelector('[data-zoom-layer]') as SVGGElement | null
        const svg = document.querySelector('.tl-graph-svg') as SVGSVGElement | null
        if (stage === null || layer === null || svg === null) return null
        const rect = stage.getBoundingClientRect()
        const viewBox = svg.getAttribute('viewBox')?.split(' ').map(Number) ?? []
        if (viewBox.length !== 4) return null
        const scale = viewBox[2] / Math.max(1, rect.width)
        const point = svg.createSVGPoint()
        point.x = viewBox[0] + (rect.width / 2) * scale
        point.y = viewBox[1] + (rect.height / 2) * scale
        const matrix = layer.getScreenCTM() ?? svg.getScreenCTM()
        if (matrix === null) return null
        const screen = point.matrixTransform(matrix)
        return { x: screen.x - rect.left, y: screen.y - rect.top }
      },
      footCount: () => document.querySelectorAll('.tl-graph-foot').length,
      playbackControls: () =>
        document.querySelectorAll('[data-testid="timeline-play"], [data-testid="timeline-speed-1"], [data-testid="timeline-speed-4"], [data-playing], [data-speed]').length,
      truncationText: () => document.querySelector('[data-graph-truncated]')?.textContent ?? null,
      evidenceVisible: () => document.querySelector('[data-graph-evidence]') !== null,
      /* ---- R10（力导向关系图）探针 ---- */
      density: () => document.querySelector('[data-tl-graph]')?.getAttribute('data-density') ?? null,
      showAllText: () => document.querySelector('[data-graph-show-all]')?.textContent ?? null,
      showAllExpanded: () => document.querySelector('[data-graph-show-all]')?.getAttribute('data-expanded') === 'true',
      clickShowAll: () => {
        const button = document.querySelector('[data-graph-show-all]') as HTMLElement | null
        button?.click()
      },
      clickDensity: (next: 'skeleton' | 'standard' | 'all') => {
        const button = document.querySelector('[data-density-action="' + next + '"]') as HTMLElement | null
        button?.click()
      },
      edgeCount: () => document.querySelectorAll('[data-edge-id]').length,
      hubEdgeCount: () => document.querySelectorAll('[data-hub-edge]').length,
      /** R11：枢纽 ↔ 枢纽 的连线数（按档位重算；骨架档必须是 0）。 */
      hubPairCount: () => document.querySelectorAll('[data-hub-pair]').length,
      hubLinkedCount: () => document.querySelectorAll('[data-folder-hub][data-hub-linked="true"]').length,
      fillRatio: () => Number(document.querySelector('[data-tl-graph]')?.getAttribute('data-graph-fill') ?? '0'),
      relationsCount: () => Number(document.querySelector('[data-tl-graph]')?.getAttribute('data-graph-relations') ?? '0'),
      /** 节点圆心坐标（力导向几何证据：不是网格）。 */
      nodePositions: () =>
        Array.from(document.querySelectorAll('[data-file-path]'), (el) => {
          const core = el.querySelector('.tl-ofile-core')
          return {
            path: el.getAttribute('data-file-path') ?? '',
            x: Number(core?.getAttribute('cx') ?? '0'),
            y: Number(core?.getAttribute('cy') ?? '0'),
          }
        }),
    }
  })

  React.useEffect(() => {
    if (params.state !== 'scrolled') return
    const rail = document.querySelector('.threadline-rail') as HTMLElement | null
    if (rail !== null) rail.scrollTop = Math.round(rail.scrollHeight * 0.45)
  }, [params.state])

  const timelineNodes = React.useMemo(
    () => nodes.map((node: FileNode) => ({ path: node.path, firstAt: node.firstAt, lastAt: node.lastAt, ops: node.ops })),
    [nodes],
  )
  const visibleAt = params.at
  /* R12：时间轴播放头做成**真受控状态**（和 tab.ts 一样），这样
     「点击轨道定位 / 键盘 ← → Home End」能真的回写并改变 DOM；
     早先这里写 onPlayheadChange: () => undefined，交互永远是死的、截图也测不出定位。 */
  const [playhead, setPlayhead] = React.useState<number>(visibleAt ?? timeline.domain.end)

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
    relationCountByKey: new Map(Object.entries(turnRelations)),
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
      mode,
      entries,
      files: graphFiles,
      edges,
      // R10：folder 模式的枢纽聚合边需要**全量**边集（未按当前目录过滤）。
      ...(mode === 'folder' ? { allEdges: edges } : {}),
      currentPath: mode === 'turn' ? currentPath : currentPath,
      turn: activeTurn === null || turnStatus === null ? null : { turn: activeTurn, status: turnStatus },
      selectedPath,
      onSelectFile: (path: string | null) => {
        setSelectedPath(path)
        setSelection(path === null ? { kind: 'none' } : { kind: 'file', path })
      },
      onOpenFile: () => undefined,
      onHoverFile: setHoverPath,
      onEnterFolder: enterFolder,
      onExitTurn: exitTurn,
      visibleAt,
      formatTime: (at: number) => new Date(at).toISOString().slice(0, 16).replace('T', ' '),
      now: NOW,
      locale: params.locale,
      reducedMotion: params.reduced,
      testId: 'graph',
    }),
    timelineSlot: h(Timeline, {
      locale: params.locale,
      range: (params.range ?? 'range.all') as RangeKey,
      domain: params.empty ? null : timeline.domain,
      playhead,
      onPlayheadChange: (at: number | null) => setPlayhead(at === null ? timeline.domain.end : at),
      nodes: params.empty ? [] : timelineNodes,
      sessions: params.empty ? [] : timeline.sessions,
      now: NOW,
      reducedMotion: params.reduced,
      /* R12 双轨：桶数 = 轨道宽 / 8px。组件**不读 DOM**，宽度由这里按真实布局喂进去
         （1440 视口下左列 676 - 时间轴卡片内边距与控件列 ≈ 470；固定值 → 截图可复现）。 */
      trackWidth: 470,
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
    railSlot: h(FileTreeRail, {
      currentPath,
      entries: treeEntries,
      status: treeEntries.length === 0 ? 'empty' : 'ready',
      source: 'host',
      onNavigate: enterFolder,
      onBack: backFolder,
      onRefresh: () => undefined,
      onSelectFile: (path: string) => {
        setSelectedPath(path)
        setSelection({ kind: 'file', path })
      },
      onOpenFile: () => undefined,
      onClearSelection: () => setSelectedPath(null),
      selectedPath,
      hoveredPath: hoverPath,
      onHoverFile: setHoverPath,
      touched: touchedMap,
      currentTurnPaths: activeTurn === null ? null : activeTurn.files.map((file) => file.path),
      viewMode,
      onViewModeChange: (mode: 'cards' | 'list') => setViewMode(mode),
      scrollKey: currentPath,
      locale: params.locale,
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
