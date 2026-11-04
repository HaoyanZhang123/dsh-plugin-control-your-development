/*
 * tests/ui-map/fixtures.ts —— 星图/时间轴的**确定性**合成数据（截图与断言共用）。
 *
 * 纪律（tests/harness/README §4）：
 * - 不用 Date.now / Math.random；所有"随机感"来自固定种子的 mulberry32；
 * - 同一 fixture 每次生成逐字段相同 → 截图可复现、断言可复现；
 * - 用真实的 T05 建边器（buildStructureEdges / buildCoTurnEdges / buildSequenceEdges）
 *   与真实 locale key，不在夹具里另写一套关系规则。
 */
import type { FileFamily, FileNode, TurnFile } from '../../src/shared/events/index.ts'
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

const DIRS = ['src/client', 'src/shared', 'src/host', 'tests', 'docs', 'notes', 'assets', 'config'] as const

const EXTENSIONS: ReadonlyArray<{ ext: string; family: FileFamily }> = [
  { ext: 'ts', family: 'code' },
  { ext: 'ts', family: 'code' },
  { ext: 'tsx', family: 'code' },
  { ext: 'md', family: 'doc' },
  { ext: 'md', family: 'doc' },
  { ext: 'json', family: 'data' },
  { ext: 'csv', family: 'data' },
  { ext: 'png', family: 'image' },
  { ext: 'webp', family: 'image' },
  { ext: 'yml', family: 'config' },
  { ext: 'toml', family: 'config' },
  { ext: 'txt', family: 'other' },
]

const STEMS = [
  'read-model',
  'relations',
  'timeline',
  'map-view',
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

export interface FileFixtureOptions {
  count?: number
  seed?: number
  /** 时间域左界（默认 30 天前）。 */
  from?: number
  /** 时间域右界（默认 NOW）。 */
  to?: number
  /** 根目录直挂文件数（不参与目录簇）。 */
  rootFiles?: number
}

/** 生成 `count` 个确定性 FileNode。 */
export function makeFiles(options: FileFixtureOptions = {}): FileNode[] {
  const count = Math.max(0, Math.trunc(options.count ?? 200))
  const random = makeRandom(options.seed ?? 42)
  const from = options.from ?? NOW - 30 * DAY
  const to = options.to ?? NOW
  const rootFiles = Math.max(0, Math.trunc(options.rootFiles ?? Math.min(4, Math.floor(count / 40))))
  const files: FileNode[] = []
  for (let index = 0; index < count; index += 1) {
    const isRoot = index < rootFiles
    const dir = isRoot ? '' : DIRS[index % DIRS.length]
    const extension = EXTENSIONS[Math.floor(random() * EXTENSIONS.length)]
    const stem = STEMS[Math.floor(random() * STEMS.length)]
    // 永远带序号后缀：保证 path 唯一（布局以 path 为节点 id）。
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
export function makeTurns(files: readonly FileNode[], options: { turns?: number; filesPerTurn?: number; sessions?: number } = {}): RelationTurn[] {
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

/**
 * 生成"四层边齐全"的**原始**边（未过 finalizeGraph）：结构 + 同轮共现 + 同会话共现 + 引用。
 * UI/测试可以自己再 finalize 一次（重复收口是幂等的）。
 */
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
  // 同会话共现（弱关系）：按共同会话分组，抽少量两两配对。
  const coSession: GraphEdge[] = []
  if (files.length >= 4) {
    coSession.push(
      createEdge({
        type: 'coSession',
        from: files[0].path,
        to: files[2].path,
        evidence: coSessionEvidence(['sess-0001', 'sess-0002']),
      }),
    )
    coSession.push(
      createEdge({
        type: 'coSession',
        from: files[1].path,
        to: files[3].path,
        evidence: coSessionEvidence(['sess-0002']),
      }),
    )
  }
  return [...structure, ...coTurn, ...coSession, ...references]
}

/** 生成"四层边齐全"的图：结构 + 同轮共现 + 同会话共现 + 引用，经 prepareEdges 收口。 */
export function makeEdges(files: readonly FileNode[], turns: readonly RelationTurn[], options: { references?: number } = {}): GraphEdge[] {
  return prepareEdges(buildEdges(files, turns, options)).edges
}

/** 时序边（只在选中轮次时显示）。 */
export function makeSequenceEdges(turns: readonly RelationTurn[]): GraphEdge[] {
  return buildSequenceEdges(turns[0]).edges
}

/** 一个"四层齐全"的默认数据集（200 文件 / 8 目录）。 */
export interface Dataset {
  files: FileNode[]
  turns: RelationTurn[]
  /** 已过 prepareEdges（按层 finalizeGraph + 全局 4000）的边（便于断言/渲染）。 */
  edges: GraphEdge[]
  /** 未收口的原始边（含重复；用于验证收拢与 4000 上限）。 */
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
  // 让"收口后第一条共现边的一端"同时带引用/同会话/时序：截图里选中它时四层边都能看到（A41-1）。
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
  return {
    files,
    turns,
    rawEdges,
    edges: prepareEdges(rawEdges).edges,
    sequence: makeSequenceEdges(turns),
    now: NOW,
  }
}

/** 600 节点 / 4000+ 原始边规模的数据集（A41-4 的性能夹具）。 */
export function makeLargeDataset(): Dataset {
  const files = makeFiles({ count: 600, seed: 2026 })
  const turns = makeTurns(files, { turns: 320, filesPerTurn: 12, sessions: 5 })
  const rawEdges = buildEdges(files, turns, { references: 20 })
  return {
    files,
    turns,
    rawEdges,
    edges: prepareEdges(rawEdges).edges,
    sequence: makeSequenceEdges(turns),
    now: NOW,
  }
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
    // 有 samples 的文件：ops 在一半处再增长一次（验证"按截至 T 的累计 ops 增长"）。
    const mid = Math.round(file.firstAt + (file.lastAt - file.firstAt) * 0.5)
    const samples = file.ops > 4 ? [{ at: file.firstAt, ops: Math.ceil(file.ops / 2) }, { at: mid, ops: file.ops }] : undefined
    return {
      path: file.path,
      firstAt: file.firstAt,
      lastAt: file.lastAt,
      ops: file.ops,
      ...(samples === undefined ? {} : { samples }),
    }
  })
  const start = Math.min(...nodes.map((node) => node.firstAt))
  const end = Math.max(...nodes.map((node) => node.lastAt))
  return {
    nodes,
    // 中间有一块"还没读到"的区段（斜纹 + 未加载），播放头故意落在其中。
    unloadedRanges: [
      { start: start + (end - start) * 0.45, end: start + (end - start) * 0.62 },
    ],
    sessions: [
      { id: 'sess-0001', title: '脉络 1.0 重构', start: start + (end - start) * 0.1, end: start + (end - start) * 0.4, turns: 12 },
      { id: 'sess-0002', title: 'T07 星图', start: start + (end - start) * 0.66, end, turns: 8 },
    ],
    domain: { start, end },
  }
}
