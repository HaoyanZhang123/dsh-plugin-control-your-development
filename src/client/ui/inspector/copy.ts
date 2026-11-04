/*
 * inspector/copy.ts —— 检查器文案的**唯一映射点**（03 §16 定稿 key）。
 *
 * 纪律：组件与 model 里不写任何中文/英文句子；全部文字经 `label()` 从 locale 取。
 * 检查器字段标签（工具/命令/子智能体/新增/修改/复用/模型/工作线/外部来源/…）由 Lead 于 2026-11-04
 * 落入 03 §16 扩展段（71 → 110 条）。本文件集中一次；仍取 `null` 的是**规范里没有对应字段的标题**
 * （例如概览的「计数」），这些位置由 `label()` 退回空串，不写第二份文案。
 */
import type { MessageKey, Translator } from '../../locale/index.ts'

/** 一个文案位置：已有 key 或待补 key（null）。 */
export type CopyKey = MessageKey | null

export const INSPECTOR_COPY: {
  /* 三种检查器标题 */
  file: CopyKey
  turn: CopyKey
  session: CopyKey
  /* 文件检查器 */
  firstSeen: CopyKey
  lastTouched: CopyKey
  ops: CopyKey
  lineDelta: CopyKey
  touchHistory: CopyKey
  externalSources: CopyKey
  more: CopyKey
  openFile: CopyKey
  focusInMap: CopyKey
  /* 关系 */
  relations: CopyKey
  relationsStructure: CopyKey
  relationsCoTurn: CopyKey
  relationsCoSession: CopyKey
  relationsReference: CopyKey
  relationsSequence: CopyKey
  relationsEvidence: CopyKey
  relationsTooMany: CopyKey
  unconfirmed: CopyKey
  /* 轮次检查器 */
  intent: CopyKey
  tools: CopyKey
  commands: CopyKey
  subagents: CopyKey
  errors: CopyKey
  filesAdded: CopyKey
  filesModified: CopyKey
  reused: CopyKey
  plan: CopyKey
  laterTouches: CopyKey
  prevTurn: CopyKey
  /* 会话检查器 */
  model: CopyKey
  workline: CopyKey
  parentSession: CopyKey
  recentTurns: CopyKey
  timeRange: CopyKey
  /* 概览 */
  coverage: CopyKey
  counts: CopyKey
  /* 通用 */
  opsRead: CopyKey
  opsWrite: CopyKey
  opsSearch: CopyKey
  opsCommand: CopyKey
  statusSuccess: CopyKey
  statusFailed: CopyKey
  statusUnknown: CopyKey
  sessionRunning: CopyKey
  sessionAborted: CopyKey
  sessionUnknown: CopyKey
  archived: CopyKey
  openSession: CopyKey
  close: CopyKey
  unknown: CopyKey
  partialTurn: CopyKey
  loadingDetail: CopyKey
  emptyFiles: CopyKey
  emptyWorkspace: CopyKey
  hostUnavailable: CopyKey
  privacyShow: CopyKey
  privacyHidden: CopyKey
  privacyMode: CopyKey
  legend: CopyKey
  showAllRelations: CopyKey
  onlyCurrent: CopyKey
  expand: CopyKey
  collapse: CopyKey
  listView: CopyKey
  familyDoc: CopyKey
  familyCode: CopyKey
  familyData: CopyKey
  familyImage: CopyKey
  familyConfig: CopyKey
  familyOther: CopyKey
} = {
  file: 'inspector.file',
  turn: 'inspector.turn',
  session: 'inspector.session',
  firstSeen: 'inspector.firstSeen',
  lastTouched: 'inspector.lastTouched',
  ops: 'inspector.ops',
  lineDelta: 'inspector.lineDelta',
  touchHistory: 'inspector.touchHistory',
  externalSources: 'inspector.externalSources',
  more: 'inspector.more',
  openFile: 'inspector.openFile',
  focusInMap: 'inspector.focusInMap',
  relations: 'relations.title',
  relationsStructure: 'relations.structure',
  relationsCoTurn: 'relations.coTurn',
  relationsCoSession: 'relations.coSession',
  relationsReference: 'relations.reference',
  relationsSequence: 'relations.sequence',
  relationsEvidence: 'relations.evidence',
  relationsTooMany: 'relations.tooMany',
  unconfirmed: 'relations.unconfirmed',
  intent: 'inspector.intent',
  tools: 'inspector.tools',
  commands: 'inspector.commands',
  subagents: 'inspector.subagents',
  errors: 'inspector.errors',
  filesAdded: 'inspector.filesAdded',
  filesModified: 'inspector.filesModified',
  reused: 'inspector.reused',
  plan: 'inspector.plan',
  laterTouches: 'inspector.laterTouches',
  prevTurn: 'inspector.prevTurn',
  model: 'inspector.model',
  workline: 'inspector.workline',
  parentSession: 'inspector.parentSession',
  recentTurns: 'inspector.recentTurns',
  timeRange: 'inspector.timeRange',
  coverage: null,
  counts: null, // 待补 inspector.counts（计数）
  opsRead: 'ops.read',
  opsWrite: 'ops.write',
  opsSearch: 'ops.search',
  opsCommand: 'ops.command',
  statusSuccess: 'status.ok',
  statusFailed: 'status.failed',
  statusUnknown: 'status.unknown',
  sessionRunning: 'session.running',
  sessionAborted: 'session.aborted',
  sessionUnknown: 'session.unknown',
  archived: 'session.archived',
  openSession: 'inspector.openSession',
  close: 'ui.close',
  unknown: 'state.unknown',
  partialTurn: 'state.partialTurn',
  loadingDetail: 'state.loadingDetail',
  emptyFiles: 'state.emptyFiles',
  emptyWorkspace: 'state.emptyWorkspace',
  hostUnavailable: 'state.hostUnavailable',
  privacyShow: 'privacy.show',
  privacyHidden: 'privacy.hidden',
  privacyMode: 'privacy.mode',
  legend: 'legend.title',
  showAllRelations: 'map.showAllRelations',
  onlyCurrent: 'map.onlyCurrent',
  expand: 'ui.expand',
  collapse: 'ui.collapse',
  listView: 'inspector.listView',
  familyDoc: 'fileFamily.doc',
  familyCode: 'fileFamily.code',
  familyData: 'fileFamily.data',
  familyImage: 'fileFamily.image',
  familyConfig: 'fileFamily.config',
  familyOther: 'fileFamily.other',
}

/** 取文案：key 未落地时退回 `fallback`（只许符号/数字/空串，不许写句子）。 */
export function label(key: CopyKey, fallback: string, t: Translator): string {
  return key === null ? fallback : t(key)
}

/** 文件族标签（03 §8.1 标题里的「族」）。 */
export function familyLabel(family: 'doc' | 'code' | 'data' | 'image' | 'config' | 'other', t: Translator): string {
  switch (family) {
    case 'doc':
      return label(INSPECTOR_COPY.familyDoc, '·', t)
    case 'code':
      return label(INSPECTOR_COPY.familyCode, '</>', t)
    case 'data':
      return label(INSPECTOR_COPY.familyData, '{ }', t)
    case 'image':
      return label(INSPECTOR_COPY.familyImage, '▣', t)
    case 'config':
      return label(INSPECTOR_COPY.familyConfig, '⚙', t)
    case 'other':
    default:
      return label(INSPECTOR_COPY.familyOther, '•', t)
  }
}

/** 文件操作类型标签（读 / 写 / 搜索）。 */
export function opLabel(op: 'read' | 'write' | 'search', t: Translator): string {
  if (op === 'read') return label(INSPECTOR_COPY.opsRead, 'r', t)
  if (op === 'write') return label(INSPECTOR_COPY.opsWrite, 'w', t)
  return label(INSPECTOR_COPY.opsSearch, 's', t)
}

/** 命令状态标签（success / error / unknown；只反映记录，不推断）。 */
export function commandStatusLabel(status: 'success' | 'error' | 'unknown', t: Translator): string {
  if (status === 'success') return label(INSPECTOR_COPY.statusSuccess, '✓', t)
  if (status === 'error') return label(INSPECTOR_COPY.statusFailed, '✕', t)
  return label(INSPECTOR_COPY.statusUnknown, '?', t)
}
