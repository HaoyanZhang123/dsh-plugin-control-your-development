/*
 * map/zoomGroup.ts —— 缩放组（− / 适应 / + / 重置布局）的唯一实现，folder 与 turn 两种模式共用。
 *
 * 契约（M2 / 04 §2，QA 按这些属性断言）：
 * - 四个按钮：`data-zoom-action="out"|"fit"|"in"|"reset"`；
 * - `适应`（fit）有可见文字 `map.fit`；
 * - `重置布局`（reset）**只有图标**（`aria-hidden` 的 ↺）+ `aria-label`，**无文本子节点**；
 * - 0.5×/3× 到限时 out/in `disabled`；`data-testid="graph-fit"` / `"graph-reset"`。
 */
import * as React from 'react'
import { createTranslator, DEFAULT_LOCALE, type Locale } from '../../locale/index.ts'
import { GRAPH_ZOOM_MAX, GRAPH_ZOOM_MIN, type GraphCamera } from './camera.ts'

const h = React.createElement

export interface ZoomGroupProps {
  camera: GraphCamera
  onZoomOut: () => void
  onFit: () => void
  onZoomIn: () => void
  onReset: () => void
  locale?: Locale
}

export function ZoomGroup(props: ZoomGroupProps): React.ReactElement {
  const t = React.useMemo(() => createTranslator(props.locale ?? DEFAULT_LOCALE), [props.locale])
  const atMin = props.camera.scale <= GRAPH_ZOOM_MIN + 1e-9
  const atMax = props.camera.scale >= GRAPH_ZOOM_MAX - 1e-9
  return h(
    'div',
    {
      className: 'tl-graph-zoom',
      role: 'group',
      'aria-label': t('map.zoomOut') + ' / ' + t('map.zoomIn'),
      'data-zoom-value': String(props.camera.scale),
    },
    h(
      'button',
      {
        type: 'button',
        className: 'tl-graph-zoom-btn',
        'data-zoom-action': 'out',
        'data-testid': 'graph-zoom-out',
        'aria-label': t('map.zoomOut'),
        title: t('map.zoomOut'),
        disabled: atMin,
        onClick: props.onZoomOut,
      },
      '−',
    ),
    h(
      'button',
      {
        type: 'button',
        className: 'tl-graph-zoom-btn',
        'data-zoom-action': 'fit',
        'data-testid': 'graph-fit',
        'aria-label': t('map.fit'),
        title: t('map.fit'),
        onClick: props.onFit,
      },
      t('map.fit'),
    ),
    h(
      'button',
      {
        type: 'button',
        className: 'tl-graph-zoom-btn',
        'data-zoom-action': 'in',
        'data-testid': 'graph-zoom-in',
        'aria-label': t('map.zoomIn'),
        title: t('map.zoomIn'),
        disabled: atMax,
        onClick: props.onZoomIn,
      },
      '+',
    ),
    // 重置布局：图标按钮 —— **没有任何文本子节点**（可见文字与 textContent 都为空），
    // 图标是内联 SVG（aria-hidden），完整名称只在 aria-label/title。
    h(
      'button',
      {
        type: 'button',
        className: 'tl-graph-zoom-btn tl-graph-zoom-reset',
        'data-zoom-action': 'reset',
        'data-testid': 'graph-reset',
        'data-graph-reset': 'true',
        'aria-label': t('graph.resetLayout'),
        title: t('graph.resetLayout'),
        onClick: props.onReset,
      },
      h(
        'svg',
        {
          className: 'tl-graph-zoom-icon',
          viewBox: '0 0 16 16',
          width: 13,
          height: 13,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.6,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
          focusable: false,
        },
        // 逆时针回转箭头：绕中心画 3/4 圆 + 回头箭头。
        h('path', { d: 'M13.2 8a5.2 5.2 0 1 1-1.9-4' }),
        h('path', { d: 'M11.4 1.6v3h-3' }),
      ),
    ),
  )
}
