/*
 * turns/copy.ts —— 轮次带文案的**唯一映射点**（03 §16 定稿 key）。
 *
 * 纪律：组件里不写任何中文/英文文案；所有文字都从这里取 key，再由 `t()` 渲染。
 * 轮次带专用 key（tooltip / 当前会话 / 全部工作线 / 完成 / 空态 / 时长）由 Lead 于 2026-11-04
 * 落入 03 §16 扩展段（71 → 110 条）。本文件把它们集中一次，组件里不出现任何文案。
 */
import type { MessageKey, Translator } from '../../locale/index.ts'

/** 一个文案位置：已有 key 或待补 key（null）。 */
export type LabelKey = MessageKey | null

/** 轮次带的文案位置（顺序与 03 §6 一致）。 */
export const TURN_COPY: {
  tooltip: LabelKey
  durationSec: LabelKey
  durationMin: LabelKey
  durationHour: LabelKey
  scopeCurrent: LabelKey
  scopeAll: LabelKey
  scopeLabel: LabelKey
  scopeGroupView: LabelKey
  scopeGroupSessions: LabelKey
  statusCompleted: LabelKey
  statusAborted: LabelKey
  statusRunning: LabelKey
  statusUnknown: LabelKey
  empty: LabelKey
  partial: LabelKey
  archived: LabelKey
  expand: LabelKey
  collapse: LabelKey
  plan: LabelKey
} = {
  tooltip: 'turns.tooltip',
  durationSec: 'turns.durationSec',
  durationMin: 'turns.durationMin',
  durationHour: 'turns.durationHour',
  scopeCurrent: 'turns.currentSession',
  scopeAll: 'turns.allWorklines',
  scopeLabel: 'inspector.session',
  scopeGroupView: 'turns.scopeGroupView',
  scopeGroupSessions: 'turns.scopeGroupSessions',
  statusCompleted: 'turns.completed',
  statusAborted: 'session.aborted',
  statusRunning: 'session.running',
  statusUnknown: 'session.unknown',
  empty: 'turns.empty',
  partial: 'state.partialTurn',
  archived: 'session.archived',
  expand: 'ui.expand',
  collapse: 'ui.collapse',
  plan: 'inspector.plan',
}

/**
 * 取文案：key 未落地时退回 `fallback`（**只许是符号/数字**，不许写句子）。
 * 这样"缺 key"是可见的（屏幕上是符号而不是假句子），也不会形成第二份文案。
 */
export function turnLabel(key: LabelKey, fallback: string, t: Translator): string {
  return key === null ? fallback : t(key)
}
