/**
 * 关系层的统一数据类型（04 §6.2、03 §9.3）。
 *
 * 纪律：
 * - 关系不是依赖：共现 ≠ 依赖、结构 ≠ 依赖（10 §1）。命名与文案都不许写成“依赖”。
 * - 每条边必须自带 `evidence`，且 `evidence.text` 是 03 §9.3 的统一模板文案，
 *   由 `evidence.ts` 的同一组构造器生成（单一事实源，UI 只渲染不造句）。
 * - 未确认的引用**不产生边**：它们留在 `UnconfirmedReference[]` 里（04 §6.3.2 第 7/8 条）。
 */

import type { FileNode, TurnFile } from '../events/index.ts'

/** 关系层（04 §6.1）：结构 / 同一轮共现 / 同一会话共现 / 同一轮内时序 / 引用。 */
export type RelationType = 'structure' | 'coTurn' | 'coSession' | 'sequence' | 'reference'

/**
 * 置信度（04 §6.2）：描述**来源性质**，不表示重要性/强度（10 §2.5）。
 * - `confirmed`：记录直接给出（同轮共现、同会话共现、轮内顺序）；
 * - `estimated`：按路径推断（结构）；
 * - `parsed`：从正文解析所得（引用）；
 * - `unresolved`：解析失败——按 04 §6.2 保留在类型里，但**不出现在任何边上**。
 */
export type RelationConfidence = 'confirmed' | 'estimated' | 'parsed' | 'unresolved'

/** 共现证据的一个样本：哪个会话的第几轮。 */
export interface TurnSample {
  sessionId: string
  turn: number
}

/**
 * 关系证据（04 §6.2 的可辨识联合 + 03 §9.3 的 `text`）。
 * `text` 由 `evidence.ts` 统一生成；不要在各处手写文案。
 */
export type RelationEvidence =
  | { kind: 'structure'; dir: string; text: string }
  | { kind: 'coTurn'; samples: TurnSample[]; count: number; text: string }
  | { kind: 'coSession'; sessionIds: string[]; text: string }
  | { kind: 'sequence'; sessionId: string; turn: number; order: number; text: string }
  | { kind: 'reference'; line: number; raw: string; target: string; resolved: boolean; text: string }

/**
 * 统一边形状。
 *
 * - `from` / `to`：节点 id = **工作区相对 POSIX 路径**（保留原大小写，用于展示）；
 *   比较/去重一律走 `path.ts` 的 `caseKey()`（Windows 身份键小写，04 §6.3.2 第 6 条）。
 * - `directed`：结构/共现无向，时序/引用有向（03 §4.2）。
 * - `weight`：共现 = 一起出现的次数；引用 = 同一对文件被引用的次数；其余为 1。
 *   权重只表示次数，**不表示重要性**（10 §2.5）。
 * - `confirmed`：这条边是否可验证为真。引用边只有在「目标在工作区内 **且** 在已触碰集合里」
 *   时才为 `true`；未确认的引用根本不生成边。
 * - `confidence`：来源性质（见上）。UI 用它区分“记录/推断/解析”。
 */
export interface GraphEdge {
  id: string
  type: RelationType
  from: string
  to: string
  weight: number
  directed: boolean
  evidence: RelationEvidence
  confirmed: boolean
  confidence: RelationConfidence
}

/**
 * 未确认引用的原因（03 §8.1“目标路径 + 行号 + 原因”）。
 * 这些目标**不画边**，只在文件检查器里列出。
 */
export type ReferenceSkipReason =
  | 'outside-workspace'
  | 'escape-cwd'
  | 'no-extension'
  | 'unknown-extension'
  | 'empty-target'
  | 'not-found'
  | 'not-touched'
  | 'not-a-file'

/** 不构成引用、也不进“未确认”清单的忽略原因（URL 会单独进“外部来源”）。 */
export type ReferenceIgnoredReason = 'anchor' | 'external-url' | 'data-uri' | 'bare-specifier' | 'self-reference'

/** 图上限（03 §4.2：单节点 12 条、全局 4000 条）。 */
export interface GraphLimits {
  perNode: number
  global: number
}

export const DEFAULT_GRAPH_LIMITS: GraphLimits = { perNode: 12, global: 4000 }

/**
 * 图层默认显示（03 §10）——数据化，UI 直接读表，避免在组件里再写一遍“默认开/关”。
 * - `structure`：常驻（可关）；
 * - `coTurn` / `coSession` / `reference`：默认只在**聚焦**时显示边；
 * - `sequence`：选中轮次时自动显示该轮；默认关。
 */
export const RELATION_LAYER_DEFAULTS: Readonly<
  Record<RelationType, { defaultOn: boolean; focusOnly: boolean; weak?: boolean }>
> = {
  structure: { defaultOn: true, focusOnly: false },
  coTurn: { defaultOn: true, focusOnly: true },
  coSession: { defaultOn: false, focusOnly: true, weak: true },
  sequence: { defaultOn: false, focusOnly: false },
  reference: { defaultOn: true, focusOnly: true },
}

/** 引用解析硬上限（04 §6.3.1）。 */
export const DEFAULT_REFERENCE_LIMITS = {
  /** 单文件最大字节数；超过则不读（由 workspaceFiles 适配层的 stat 判定）。 */
  maxBytes: 512 * 1024,
  /** 单文件最大行数；超过则截断读取并标 `truncated`。 */
  maxLines: 5000,
  /** 单文件最多保留的引用条数。 */
  maxReferencesPerFile: 200,
  /** 单次视图最多解析的文件数（其余排队，04 §6.3.1）。 */
  maxFilesPerView: 400,
  /** 读取分页：每页行数与最多翻页数（04 §6.3.4）。 */
  pageLines: 500,
  pagesPerFile: 20,
} as const

/*
 * 共享契约：关系引擎**直接复用** `src/shared/events` 的正式类型（单一事实源），
 * 不复制定义。events 是契约 owner（T03），本文件只做别名/派生。
 */

/** 工作区文件节点：直接用 T03 的 `FileNode`（04 §4.2）。 */
export type RelationFileNode = FileNode

/**
 * 轮次内文件项：直接用 T03 的 `TurnFile`。
 * 注意其 `ops` 是**操作类型列表**（`FileOp[]`，最多 read/write/search 三项），不是次数；
 * 「活动量」的换算见 `adapters.ts` 的 `operationCount()` / `turnFileActivity()`。
 */
export type RelationTurnFile = TurnFile

/**
 * 轮次输入：`events.TurnDetail` 不带 `sessionId`（detail 属于某个会话），轮次号字段名是 `n`。
 * 关系引擎跨会话生成时序/共现时需要这两项 → 用 `adapters.ts` 的 `turnFromDetail()` 单向适配，
 * **不反向要求 events 增加字段**。
 */
export interface RelationTurn {
  sessionId: string
  /** 轮次序号（1-based，来自 `TurnDetail.n`）。 */
  turn: number
  /** 按事件顺序排列的轮次文件（数组顺序 = 轮内先后，A30-2 的时序依据）。 */
  files: readonly TurnFile[]
}
