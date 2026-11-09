/*
 * map/skeleton.ts —— 图区的**骨架**（loading 时占位）。
 *
 * 为什么要它：首次打开 tab 时图区原本只有一个居中的转圈点 + 一行字，
 * 看起来像"卡住了"而不是"正在长出来"。骨架给出与真实布局同构的占位
 * （文件夹卡片 + 文件圆点 + 关系线），数据一到就地替换，感知等待显著下降。
 *
 * 纪律：
 * - **不用随机数**：坐标来自固定表，同一输入每次都一样（可截图、可断言）；
 * - **纯装饰**：整块 `aria-hidden`，状态播报仍由调用方的 `role="status"` 负责；
 * - 不引入新文案，不新增 locale key。
 */

import * as React from 'react'

const h = React.createElement

/** 固定骨架节点表（x/y 是 viewBox 坐标；同一输入恒定）。 */
const SKELETON_NODES: ReadonlyArray<{ x: number; y: number; w: number; kind: 'card' | 'dot' }> = [
  { x: 96, y: 64, w: 92, kind: 'card' },
  { x: 268, y: 44, w: 78, kind: 'card' },
  { x: 430, y: 72, w: 100, kind: 'card' },
  { x: 176, y: 148, w: 84, kind: 'card' },
  { x: 352, y: 156, w: 74, kind: 'card' },
  { x: 500, y: 140, w: 82, kind: 'card' },
  { x: 88, y: 226, w: 96, kind: 'card' },
  { x: 262, y: 238, w: 80, kind: 'card' },
  { x: 424, y: 230, w: 88, kind: 'card' },
  // 文件圆点（与卡片同层，表示"图里也有散点"）
  { x: 208, y: 96, w: 0, kind: 'dot' },
  { x: 300, y: 122, w: 0, kind: 'dot' },
  { x: 466, y: 108, w: 0, kind: 'dot' },
  { x: 132, y: 176, w: 0, kind: 'dot' },
  { x: 396, y: 196, w: 0, kind: 'dot' },
  { x: 528, y: 198, w: 0, kind: 'dot' },
]

/** 固定骨架连线表（用节点下标表示，避免坐标漂移）。 */
const SKELETON_EDGES: ReadonlyArray<[number, number]> = [
  [0, 3],
  [1, 4],
  [2, 5],
  [3, 7],
  [4, 8],
  [0, 1],
  [2, 4],
  [6, 7],
]

const CARD_H = 34

function center(index: number): { x: number; y: number } {
  const node = SKELETON_NODES[index]
  if (node === undefined) return { x: 0, y: 0 }
  if (node.kind === 'card') return { x: node.x + node.w / 2, y: node.y + CARD_H / 2 }
  return { x: node.x, y: node.y }
}

/**
 * 图区骨架。`variant` 只影响密度观感，不改变坐标（保持可断言）。
 */
export function graphSkeleton(variant: 'folder' | 'turn'): React.ReactElement {
  const nodes = SKELETON_NODES.map((node, index) => {
    if (node.kind === 'card') {
      return h('rect', {
        key: `c${index}`,
        className: 'tl-graph-skeleton-card',
        x: node.x,
        y: node.y,
        width: node.w,
        height: CARD_H,
        rx: 8,
      })
    }
    return h('circle', {
      key: `d${index}`,
      className: 'tl-graph-skeleton-dot',
      cx: node.x,
      cy: node.y,
      r: 4,
    })
  })

  const edges = SKELETON_EDGES.map(([from, to], index) => {
    const a = center(from)
    const b = center(to)
    return h('line', {
      key: `e${index}`,
      className: 'tl-graph-skeleton-edge',
      x1: a.x,
      y1: a.y,
      x2: b.x,
      y2: b.y,
    })
  })

  return h(
    'svg',
    {
      className: 'tl-graph-skeleton',
      viewBox: '0 0 640 320',
      preserveAspectRatio: 'xMidYMid meet',
      'data-graph-skeleton': variant,
      'aria-hidden': 'true',
      focusable: 'false',
    },
    ...edges,
    ...nodes,
  )
}
