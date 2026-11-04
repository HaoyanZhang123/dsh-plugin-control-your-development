/**
 * 关系引擎的公共出口（T07 / T08 只从这里 import）。
 *
 * 分层（04 §6.1）：
 * - 结构 `buildStructureEdges(files)`
 * - 同轮共现 `buildCoTurnEdges(turns)`
 * - 同会话共现 `buildCoSessionEdges(files, focus)`（无 focus 返回空）
 * - 时序 `buildSequenceEdges(turn)`（无选中轮次返回空）
 * - 引用 `resolveReferences(sources, options)`（`workspaceFiles` 读出的正文 + 已触碰集合）
 *
 * 所有边都必须过 `finalizeGraph(edges)`：它做 `type|from|to` 去重、证据回填与上限收拢
 * （单节点 12 / 全局 4000，超出给“已收拢 X 条”）。**不要绕过它直接画边。**
 */

// 命名分工（Lead 集成裁决，T05b）：
// - `shared/events` 的 wire 层共现边叫 `SnapshotCoTurnEdge`（host snapshot 原始边，04 §4.4）；
// - **产品级统一边只有本文件的 `GraphEdge`**（id/directed/confirmed/confidence/evidence）。
// `RelationEdge` 是 `GraphEdge` 的别名（历史调用点兼容，T07/T08 直接用 `GraphEdge`）。
export type { GraphEdge as RelationEdge } from './types.ts'
export type {
  GraphEdge,
  GraphLimits,
  RelationConfidence,
  RelationEvidence,
  RelationFileNode,
  RelationTurn,
  RelationTurnFile,
  RelationType,
  ReferenceIgnoredReason,
  ReferenceSkipReason,
  TurnSample,
} from './types.ts'
export {
  DEFAULT_GRAPH_LIMITS,
  DEFAULT_REFERENCE_LIMITS,
  RELATION_LAYER_DEFAULTS,
} from './types.ts'

export {
  coSessionEvidence,
  coTurnEvidence,
  describeUnconfirmedReference,
  displayDir,
  REFERENCE_IGNORED_LABELS,
  REFERENCE_SKIP_LABELS,
  referenceEvidence,
  sequenceEvidence,
  shortSessionId,
  structureEvidence,
  UNCONFIRMED_REFERENCE_TEXT,
} from './evidence.ts'

export { caseKey, classifyTarget, decodeRefTarget, isKnownExtension, KNOWN_EXTENSIONS } from './path.ts'

export {
  applyGraphLimits,
  compareEdges,
  truncationText,
} from './limits.ts'
export type { TruncationSummary } from './limits.ts'

export { countByType, createEdge, edgeId, finalizeGraph, mergeEdge, mergeEdges } from './graph.ts'
export type { EdgeInput, FinalGraph } from './graph.ts'

export { operationCount, turnFileActivity, turnFromDetail } from './adapters.ts'

export { buildStructureEdges } from './structure.ts'
export { buildCoTurnEdges, CO_TURN_FILES_PER_TURN, CO_TURN_SAMPLE_LIMIT } from './coTurn.ts'
export type { CoTurnBuildResult } from './coTurn.ts'
export { buildCoSessionEdges } from './coSession.ts'
export type { CoSessionBuildResult } from './coSession.ts'
export { buildSequenceEdges } from './sequence.ts'
export type { SequenceBuildResult } from './sequence.ts'

export {
  EXTENSION_CANDIDATES,
  resolveCandidatePath,
  resolveParsedReferences,
  resolveReferences,
} from './reference.ts'
export type {
  ExternalReference,
  IgnoredReference,
  ParsedReferenceSource,
  ReferenceResolution,
  ReferenceResolutionStats,
  ReferenceResolveOptions,
  ReferenceTextSource,
  UnconfirmedReference,
} from './reference.ts'

export {
  canParse,
  parseFileReferences,
  parserFor,
  REFERENCE_PARSERS,
  supportedExtensions,
} from './parsers/index.ts'
export type {
  RawReference,
  ReferenceKind,
  ReferenceParseOptions,
  ReferenceParseResult,
  ReferenceParser,
  ReferenceSyntax,
} from './parsers/types.ts'
