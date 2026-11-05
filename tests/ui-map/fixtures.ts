/*
 * tests/ui-map/fixtures.ts —— 文件关系图 / 目录 rail / 轮次状态的**确定性**合成数据。
 *
 * 纪律（tests/harness/README §4）：
 * - 不用 Date.now / Math.random；所有"随机感"来自固定种子的 mulberry32；
 * - 同一 fixture 每次生成逐字段相同 → 截图可复现、断言可复现；
 * - 用真实的 T05 建边器（buildStructureEdges / buildCoTurnEdges / buildSequenceEdges）
 *   与真实 locale key，不在夹具里另写一套关系规则；
 * - T31 起文件大类是 5 类（text/code/data/media/other，33 §5）。
 */
import type { FileFamily, FileNode, TurnDetail, TurnFile } from '../../src/shared/events/index.ts'
import {
  buildCoTurnEdges,
  buildSequenceEdges,
  buildStructureEdges,
  coSessionEvidence,
  coTurnEvidence,
  createEdge,
  referenceEvidence,
  type GraphEdge,
  type RelationTurn,
} from '../../src/shared/relations/index.ts'
import type { TimeRange } from '../../src/client/ui/timeline/index.ts'
import { prepareEdges } from '../../src/client/ui/map/relations.ts'

/** 固定"现在"：2026-11-04 10:00 +08:00（截图与断言都以它为基准）。 */
export const NOW = Date.parse('2026-11-04T10:00:00+08:00')

const DAY = 24 * 60 * 60 * 1000
const HOUR = 60 * 60 * 1000

/** 固定种子 PRNG（mulberry32）：测试数据"看起来随机"，但每次完全一样。 */
export function makeRandom(seed = 42): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

const DEFAULT_DIRS = ['src/client', 'src/shared', 'src/host', 'tests', 'docs', 'notes', 'assets', 'config'] as const

/** 20 个顶层目录的真实规模夹具（真实工作区 669 文件 / 20 目录的代理）。 */
export const REAL_DIRS = [
  '美术研究',
  '来源',
  '执行基线',
  '美术资产',
  'video-workbench',
  '审美日志',
  '交流',
  '审阅记录',
  '研究',
  'studio-plugin',
  '作品',
  'docs',
  'tests',
  'tools',
  'config',
  'notes',
  'assets',
  'scripts',
  '分镜',
  '音频',
] as const

/** 超长顶层目录名（省略号 + title 全名验收用）。 */
export const LONG_DIR_NAME = '这是一个非常长的顶层目录名称用于验证省略号截断行为'

const EXTENSIONS: ReadonlyArray<{ ext: string; family: FileFamily }> = [
  { ext: 'ts', family: 'code' },
  { ext: 'ts', family: 'code' },
  { ext: 'tsx', family: 'code' },
  { ext: 'html', family: 'code' },
  { ext: 'css', family: 'code' },
  { ext: 'md', family: 'text' },
  { ext: 'md', family: 'text' },
  { ext: 'yml', family: 'text' },
  { ext: 'json', family: 'data' },
  { ext: 'csv', family: 'data' },
  { ext: 'png', family: 'media' },
  { ext: 'mp4', family: 'media' },
  { ext: 'bin', family: 'other' },
]

const STEMS = [
  'read-model',
  'relations',
  'timeline',
  'graph-view',
  'turn-strip',
  'inspector',
  'coverage',
  'degrade',
  'locale',
  'tokens',
  'fixture',
  'snapshot',
  'manifest',
  'release-notes',
  'screenshot',
  'evidence',
]

function basenameOf(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash === -1 ? path : path.slice(slash + 1)
}

function dirOf(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash === -1 ? '' : path.slice(0, slash)
}

function dirKeyOf(path: string): string {
  const slash = path.indexOf('/')
  return slash <= 0 ? '' : path.slice(0, slash)
}

export interface FileFixtureOptions {
  count?: number
  seed?: number
  from?: number
  to?: number
  rootFiles?: number
  /** 顶层目录清单（默认 8 个；rail/规模图用 REAL_DIRS 模拟 20 个）。 */
  dirs?: readonly string[]
}

/** 生成 `count` 个确定性 FileNode（5 类文件族）。 */
export function makeFiles(options: FileFixtureOptions = {}): FileNode[] {
  const count = Math.max(0, Math.trunc(options.count ?? 200))
  const random = makeRandom(options.seed ?? 42)
  const from = options.from ?? NOW - 30 * DAY
  const to = options.to ?? NOW
  const rootFiles = Math.max(0, Math.trunc(options.rootFiles ?? Math.min(4, Math.floor(count / 40))))
  const dirs = options.dirs ?? DEFAULT_DIRS
  const files: FileNode[] = []
  for (let index = 0; index < count; index += 1) {
    const isRoot = index < rootFiles
    const dir = isRoot ? '' : dirs[index % dirs.length]
    const extension = EXTENSIONS[Math.floor(random() * EXTENSIONS.length)]
    const stem = STEMS[Math.floor(random() * STEMS.length)]
    const path = (dir === '' ? '' : dir + '/') + stem + '-' + String(index).padStart(3, '0') + '.' + extension.ext
    const firstAt = Math.round(from + (to - from) * random() * 0.7)
    const lastAt = Math.round(firstAt + (to - firstAt) * random())
    const ops = 1 + Math.floor(Math.pow(random(), 3) * 60)
    const writes = Math.floor(random() * ops * 0.3)
    const searches = Math.floor(random() * ops * 0.2)
    const reads = Math.max(0, ops - writes - searches)
    files.push({
      path,
      name: basenameOf(path),
      dir: dirOf(path),
      family: extension.family,
      firstAt,
      lastAt,
      reads,
      writes,
      searches,
      added: Math.floor(random() * 120),
      removed: Math.floor(random() * 40),
      ops,
      sessionIds: ['sess-0001'],
      sessionCount: 1,
      turnCount: 1 + Math.floor(random() * 6),
    })
  }
  return files
}

/** 一轮里的文件（TurnFile.ops 是操作类型列表，不是次数）。 */
function toTurnFiles(files: readonly FileNode[], indices: readonly number[]): TurnFile[] {
  return indices.map((index) => {
    const file = files[index]
    const ops: TurnFile['ops'] = file.writes > 0 ? ['read', 'write'] : ['read']
    return { path: file.path, ops, added: file.added, removed: file.removed }
  })
}

/** 生成确定性轮次（用于共现/时序边）。 */
export function makeTurns(
  files: readonly FileNode[],
  options: { turns?: number; filesPerTurn?: number; sessions?: number } = {},
): RelationTurn[] {
  const turns = Math.max(1, Math.trunc(options.turns ?? 40))
  const filesPerTurn = Math.max(2, Math.trunc(options.filesPerTurn ?? 8))
  const sessions = Math.max(1, Math.trunc(options.sessions ?? 3))
  const random = makeRandom(7)
  const result: RelationTurn[] = []
  for (let turn = 0; turn < turns; turn += 1) {
    const sessionIndex = turn % sessions
    const picked: number[] = []
    const seen = new Set<number>()
    while (picked.length < filesPerTurn && picked.length < files.length) {
      const index = Math.floor(random() * files.length)
      if (seen.has(index)) continue
      seen.add(index)
      picked.push(index)
    }
    result.push({
      sessionId: 'sess-' + String(sessionIndex + 1).padStart(4, '0'),
      turn: turn + 1,
      files: toTurnFiles(files, picked),
    })
  }
  return result
}

/** 生成"四层边齐全"的**原始**边（未过 finalizeGraph）。 */
export function buildEdges(files: readonly FileNode[], turns: readonly RelationTurn[], options: { references?: number } = {}): GraphEdge[] {
  const structure = buildStructureEdges(files)
  const coTurn = buildCoTurnEdges(turns).edges
  const referenceCount = Math.max(0, Math.trunc(options.references ?? 6))
  const references: GraphEdge[] = []
  for (let index = 0; index < referenceCount && files.length > index + 1; index += 1) {
    const from = files[index]
    const to = files[index + 1]
    references.push(
      createEdge({
        type: 'reference',
        from: from.path,
        to: to.path,
        evidence: referenceEvidence({ line: 10 + index, raw: './' + to.name, target: to.path, from: from.path, to: to.path }),
      }),
    )
  }
  const coSession: GraphEdge[] = []
  if (files.length >= 4) {
    coSession.push(createEdge({ type: 'coSession', from: files[0].path, to: files[2].path, evidence: coSessionEvidence(['sess-0001', 'sess-0002']) }))
    coSession.push(createEdge({ type: 'coSession', from: files[1].path, to: files[3].path, evidence: coSessionEvidence(['sess-0002']) }))
  }
  return [...structure, ...coTurn, ...coSession, ...references]
}

/** 生成"四层边齐全"的图（经 prepareEdges 收口）。 */
export function makeEdges(files: readonly FileNode[], turns: readonly RelationTurn[], options: { references?: number } = {}): GraphEdge[] {
  return prepareEdges(buildEdges(files, turns, options)).edges
}

/** 时序边（只在选中轮次时显示）。 */
export function makeSequenceEdges(turns: readonly RelationTurn[]): GraphEdge[] {
  return buildSequenceEdges(turns[0]).edges
}

export interface Dataset {
  files: FileNode[]
  turns: RelationTurn[]
  edges: GraphEdge[]
  rawEdges: GraphEdge[]
  sequence: GraphEdge[]
  now: number
}

export function makeDataset(options: FileFixtureOptions & { turns?: number; filesPerTurn?: number } = {}): Dataset {
  const files = makeFiles(options)
  const turns = makeTurns(files, { turns: options.turns ?? 40, filesPerTurn: options.filesPerTurn ?? 8 })
  const firstPass = prepareEdges(buildEdges(files, turns)).edges
  const anchor = firstPass.find((edge) => edge.type === 'coTurn')
  const rawEdges = buildEdges(files, turns)
  if (anchor !== undefined && files.length >= 4) {
    const target = files.find((file) => file.path !== anchor.from && file.path !== anchor.to) ?? files[1]
    rawEdges.push(
      createEdge({
        type: 'reference',
        from: anchor.from,
        to: target.path,
        evidence: referenceEvidence({ line: 7, raw: './' + target.name, target: target.path, from: anchor.from, to: target.path }),
      }),
      createEdge({
        type: 'coSession',
        from: anchor.from,
        to: files[2].path === anchor.from ? files[3].path : files[2].path,
        evidence: coSessionEvidence(['sess-0001']),
      }),
    )
  }
  return { files, turns, rawEdges, edges: prepareEdges(rawEdges).edges, sequence: makeSequenceEdges(turns), now: NOW }
}

/** 600 节点 / 8 目录的规模夹具。 */
export function makeLargeDataset(): Dataset {
  const files = makeFiles({ count: 600, seed: 2026 })
  const turns = makeTurns(files, { turns: 320, filesPerTurn: 12, sessions: 5 })
  const rawEdges = buildEdges(files, turns, { references: 20 })
  return { files, turns, rawEdges, edges: prepareEdges(rawEdges).edges, sequence: makeSequenceEdges(turns), now: NOW }
}

/** 时间轴夹具：节点 + 未加载区段 + 会话刻度。 */
export interface TimelineFixture {
  nodes: Array<{ path: string; firstAt: number; lastAt: number; ops: number; samples?: Array<{ at: number; ops: number }> }>
  unloadedRanges: TimeRange[]
  sessions: Array<{ id: string; title: string; start: number; end: number; turns: number }>
  domain: TimeRange
}

export function makeTimelineFixture(files: readonly FileNode[] = makeFiles({ count: 200 })): TimelineFixture {
  const nodes = files.map((file) => {
    const mid = Math.round(file.firstAt + (file.lastAt - file.firstAt) * 0.5)
    const samples = file.ops > 4 ? [{ at: file.firstAt, ops: Math.ceil(file.ops / 2) }, { at: mid, ops: file.ops }] : undefined
    return { path: file.path, firstAt: file.firstAt, lastAt: file.lastAt, ops: file.ops, ...(samples === undefined ? {} : { samples }) }
  })
  const start = Math.min(...nodes.map((node) => node.firstAt))
  const end = Math.max(...nodes.map((node) => node.lastAt))
  return {
    nodes,
    unloadedRanges: [{ start: start + (end - start) * 0.45, end: start + (end - start) * 0.62 }],
    sessions: [
      { id: 'sess-0001', title: '脉络 2.0 重构', start: start + (end - start) * 0.1, end: start + (end - start) * 0.4, turns: 12 },
      { id: 'sess-0002', title: 'T31 文件图', start: start + (end - start) * 0.66, end, turns: 8 },
    ],
    domain: { start, end },
  }
}

/** 一个确定性 TurnDetail（轮次状态/首见/删除命令测试用）。 */
export function makeTurnDetail(files: readonly FileNode[], options: { n?: number; start?: number; end?: number | null; deleteCommands?: number } = {}): TurnDetail {
  const n = options.n ?? 3
  const start = options.start ?? NOW - 2 * HOUR
  const end = options.end === undefined ? NOW - HOUR : options.end
  const picked = files.slice(0, 5)
  const turnFiles: TurnFile[] = picked.map((file, index) => ({
    path: file.path,
    ops: index === 0 ? ['read'] : index === 1 ? ['read', 'write'] : index === 2 ? ['write'] : index === 3 ? ['search'] : ['read', 'write'],
    added: index === 1 ? 12 : index === 2 ? 0 : 4,
    removed: index === 2 ? 3 : 0,
  }))
  return {
    n,
    start,
    ...(end === null ? {} : { end }),
    status: end === null ? 'running' : 'completed',
    files: turnFiles,
    commands: [],
    subagents: [],
    errors: 0,
    toolCalls: 8,
    toolFailures: 0,
    ...(options.deleteCommands === undefined ? {} : { deleteCommands: options.deleteCommands }),
    messageIds: [],
  }
}

/** 把一个 TurnDetail 的时间窗对齐到某些文件的 firstAt（首见测试用；end 缺失时保持缺失）。 */
export function alignTurnToFileFirstSeen(turn: TurnDetail, file: FileNode, margin = 10_000): TurnDetail {
  return {
    ...turn,
    start: file.firstAt - margin,
    ...(turn.end === undefined ? {} : { end: file.firstAt + margin }),
  }
}

export { dirKeyOf, HOUR }
