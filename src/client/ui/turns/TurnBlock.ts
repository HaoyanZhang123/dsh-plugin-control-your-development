/*
 * turns/TurnBlock.ts —— 一个轮次块（03 §6）。
 *
 * 纯展示 + 事件上抛：状态/宽度/标记/tooltip 全部来自 `model.ts` 的 `TurnBlockModel`，
 * 组件自己不判定状态、不算宽度（判定逻辑单测在 tests/ui-turn）。
 * 样式在 `styles/turns.css`（单一样式注入路径）；这里只给类名与 `data-*`，
 * 唯一的行内样式是块宽 `--tl-turn-w`（数据，不是设计值）。
 *
 * 可访问性（03 §15）：
 * - `role="option"` + `aria-selected` + `aria-label`（读屏能拿到与 tooltip 相同、且含全部计数的完整描述）；
 * - 颜色不是唯一信息：状态有文字/符号，标记有图标 + 计数；
 * - roving tabindex 由 TurnStrip 统一管（这里只接收 `focusable`）。
 */
import * as React from 'react'
import type { TurnBlockModel, TurnMarker } from './model.ts'

const e = React.createElement

/** 分叉图标：用 SVG 而不是生僻字形（不依赖宿主字体带 U+2442 之类）。 */
function ForkGlyph(): React.ReactElement {
  return e(
    'svg',
    { width: 7, height: 7, viewBox: '0 0 7 7', 'aria-hidden': true, focusable: 'false' },
    e('path', {
      d: 'M1 1 V3 H3.5 M3.5 3 V6 M3.5 3 H6 V1',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1,
    }),
  )
}

/** 单个标记：图标 + （计数模式下）数字；颜色只做辅助，形状/计数才是主信息。 */
function Marker(props: { marker: TurnMarker; mode: 'icon' | 'count' }): React.ReactElement {
  const { marker, mode } = props
  const glyph = (() => {
    switch (marker.kind) {
      case 'files':
        return e('span', { className: 'threadline-turn-marker-dot', 'aria-hidden': true })
      case 'commands':
        return e('span', { className: 'threadline-turn-marker-tick', 'aria-hidden': true })
      case 'errors':
        return e('span', { className: 'threadline-turn-marker-glyph', 'aria-hidden': true, children: '×' })
      case 'subagents':
      default:
        return e('span', { className: 'threadline-turn-marker-glyph', 'aria-hidden': true }, e(ForkGlyph))
    }
  })()
  return e(
    'span',
    { className: 'threadline-turn-marker', 'data-marker': marker.kind, 'data-count': marker.count },
    glyph,
    mode === 'count' ? e('span', { className: 'threadline-turn-marker-count' }, String(marker.count)) : null,
  )
}

/**
 * 轮次关系提示（T36，P2）：本轮文件之间的关系条数。
 * 只显示计数徽标 + tooltip，不改变状态/文件/命令标记的布局（与标记同一行，空间不足时被裁掉）。
 */
export interface TurnRelationHint {
  count: number
  /** 已本地化的「{n} 关系」。 */
  label: string
  /** 已本地化的 tooltip（turns.relationsTip）。 */
  tip: string
}

export interface TurnBlockProps {
  model: TurnBlockModel
  selected: boolean
  preview: boolean
  /** hover 联动高亮（例如悬停的文件属于该轮）。 */
  related?: boolean
  /** 关系条数提示（可选；0 / 省略 = 不渲染）。 */
  relation?: TurnRelationHint
  focusable: boolean
  onPreview?: (model: TurnBlockModel | null) => void
  onSelect?: (model: TurnBlockModel) => void
  onDoubleClick?: (model: TurnBlockModel) => void
  onFocusBlock?: (model: TurnBlockModel) => void
  testId?: string
}

export function TurnBlock(props: TurnBlockProps): React.ReactElement {
  const { model } = props
  const relation = props.relation !== undefined && props.relation.count > 0 ? props.relation : undefined
  const style: React.CSSProperties = { '--tl-turn-w': String(model.widthPx) + 'px' } as React.CSSProperties
  return e(
    'div',
    {
      className: 'threadline-turn-block',
      role: 'option',
      'aria-selected': props.selected ? 'true' : 'false',
      'aria-label': relation === undefined ? model.ariaLabel : model.ariaLabel + ' · ' + relation.label,
      title: model.tooltip,
      tabIndex: props.focusable ? 0 : -1,
      'data-testid': props.testId ?? 'turn-block',
      'data-turn': String(model.turn),
      'data-session': model.sessionId,
      'data-status': model.status,
      'data-partial': model.partial ? 'true' : 'false',
      'data-selected': props.selected ? 'true' : 'false',
      'data-preview': props.preview ? 'true' : 'false',
      'data-related': props.related === true ? 'true' : 'false',
      'data-width': String(model.widthPx),
      'data-marker-mode': model.markerMode,
      'data-marker-slots': String(model.markerSlots),
      style,
      onClick: () => props.onSelect?.(model),
      onDoubleClick: () => props.onDoubleClick?.(model),
      onMouseEnter: () => props.onPreview?.(model),
      onFocus: () => props.onFocusBlock?.(model),
    },
    // 状态条：宽度 = 块宽（时长映射），颜色 = 状态；运行中脉冲（reduced-motion 下由 tokens.css 归零）
    e('span', { className: 'threadline-turn-bar', 'data-role': 'status-bar', 'aria-hidden': true }),
    // 序号 + 状态文字（宽度 ≥ 56px 才放得下文字）
    e(
      'span',
      { className: 'threadline-turn-label' },
      e('span', { className: 'threadline-turn-index' }, model.label),
      model.widthPx >= 56
        ? e('span', { className: 'threadline-turn-status' }, model.statusLabel)
        : null,
    ),
    // 标记行：图标 +（计数模式）计数；宽度不足时用 `+n` 说明还有几类没显示（tooltip 永远给全量）
    e(
      'span',
      { className: 'threadline-turn-markers', 'data-role': 'markers' },
      model.markerMode === 'bar'
        ? null
        : model.markers
            .slice(0, model.markerSlots)
            .map((marker) =>
              e(Marker, {
                key: marker.kind,
                marker,
                mode: model.markerMode === 'count' ? 'count' : 'icon',
              }),
            ),
      model.hiddenMarkers > 0
        ? e(
            'span',
            { className: 'threadline-turn-marker-overflow', 'data-role': 'marker-overflow', 'aria-hidden': true },
            '+' + String(model.hiddenMarkers),
          )
        : null,
      relation === undefined
        ? null
        : e(
            'span',
            {
              className: 'threadline-turn-relations',
              'data-role': 'turn-relations',
              'data-relations': String(relation.count),
              title: relation.tip,
            },
            relation.label,
          ),
    ),
    // 「本轮仍在记录」：未结束轮次的显式标注（06 N-16），不伪造完整
    model.partial ? e('span', { className: 'threadline-turn-partial' }, model.partialLabel) : null,
  )
}
