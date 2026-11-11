/*
 * map/evidence.ts —— 关系证据的**数据模型 + 唯一渲染器**（D-35）。
 *
 * 为什么要有这一层：
 * - 旧实现里「证据浮层」在图内右下角，且 folder 图与 wheel/turn 图各写了一份 JSX，
 *   两边的 Esc、关闭、焦点返还行为并不一致（是同一语义的两套实现，属于双写）。
 * - 用户要求证据**移到下方时间线区域并完全覆盖它**，因此证据不能再由图组件自己
 *   `position:absolute` 挂在 stage 上 —— 它必须先变成**数据**交给父级，再由父级放进
 *   TimelineSlot 里渲染。
 *
 * 本文件因此只做两件事：
 * 1. `buildEvidenceModel`：把"选中了谁 / 有哪些边"折成纯数据（不碰 DOM、不排序随机）；
 * 2. `EvidencePanel`：把该数据渲染成非模态 `role="region"`，X / Esc 关闭。
 *
 * 纪律：证据文本只来自 relation 层给的 `evidence.text`（不在此处编造解释）。
 */
import * as React from 'react'
import type { RelationType } from '../../../shared/relations/index.ts'
import type { Translator } from '../../locale/index.ts'

/** 证据里的一个关系分组（同类型最多 4 条，去重）。 */
export interface EvidenceGroup {
  type: RelationType
  labelKey: 'relations.structure' | 'relations.coTurn' | 'relations.coSession' | 'relations.reference' | 'relations.sequence'
  texts: string[]
}

/** 证据面板的纯数据形态；`null` = 不显示。 */
export interface EvidenceModel {
  kind: 'file' | 'edge'
  /** 主标题下的一行（文件路径 / `a ↔ b`）。 */
  subject: string
  /** 元信息 chip 的文案（已本地化）。 */
  meta: string[]
  /** 关系分组；空数组 = 没有可展示的关系（UI 显示「无记录」，不是伪造 0 条）。 */
  groups: EvidenceGroup[]
  /** 无关系时的说明文案（已本地化）。 */
  emptyText: string
}

export interface EvidencePanelProps {
  model: EvidenceModel
  onClose: () => void
  t: Translator
}

/**
 * 证据面板（非模态）。`position` 由外层容器决定（时间线卡片内铺满）。
 *
 * 焦点策略：不抢焦点、不做 focus trap；Esc 关闭并把事件交给上层（stopPropagation 防止
 * 同时触发"退出轮次"等更外层的 Esc），关闭后由调用方把焦点还给图容器。
 */
export function EvidencePanel(props: EvidencePanelProps): React.ReactElement {
  const { model, onClose, t } = props
  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    onClose()
  }
  return React.createElement(
    'div',
    {
      className: 'tl-evidence-slot',
      'data-evidence-kind': model.kind,
      role: 'region',
      'aria-label': t('relations.evidence'),
      tabIndex: -1,
      onKeyDown,
    },
    React.createElement(
      'div',
      { className: 'tl-evidence-head' },
      React.createElement('b', { className: 'tl-evidence-title' }, t('relations.evidence')),
      React.createElement(
        'button',
        { type: 'button', className: 'tl-evidence-close', onClick: onClose, 'aria-label': t('ui.close') },
        '×',
      ),
    ),
    React.createElement('div', { className: 'tl-evidence-subject mono', title: model.subject }, model.subject),
    React.createElement(
      'div',
      { className: 'tl-evidence-meta' },
      ...model.meta.map((text, index) => React.createElement('span', { key: index, className: 'tl-evidence-chip' }, text)),
    ),
    model.groups.length === 0
      ? React.createElement('p', { className: 'tl-evidence-empty' }, model.emptyText)
      : React.createElement(
          'div',
          { className: 'tl-evidence-groups' },
          ...model.groups.map((group) =>
            React.createElement(
              'div',
              { key: group.type, className: 'tl-evidence-group', 'data-evidence-type': group.type },
              React.createElement('span', { className: 'tl-evidence-group-label' }, t(group.labelKey)),
              ...group.texts.map((text, index) =>
                React.createElement('span', { key: index, className: 'tl-evidence-text' }, text),
              ),
            ),
          ),
        ),
  )
}
