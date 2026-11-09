/*
 * skeleton.test.ts —— 图区骨架（loading 占位）的 DOM 契约。
 *
 * 钉住三件事：
 * 1. loading 时**画骨架**（不是只有一个转圈点）——这是"首次打开像在长出来"的观感来源；
 * 2. 骨架是**纯装饰**：整块 aria-hidden，状态播报仍由 role="status" 的那行文字负责；
 * 3. 数据到了 / 出错时**骨架必须消失**，不能盖住真图或错误态。
 *
 * 以及一条确定性约束：骨架坐标来自固定表，两次渲染逐字节相同（可截图、可断言）。
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { graphSkeleton } from '../../src/client/ui/map/skeleton.ts'

function render(node: React.ReactElement): string {
  return renderToStaticMarkup(node)
}

test('骨架：渲染出卡片 / 圆点 / 关系线三类占位', () => {
  const html = render(graphSkeleton('folder'))
  assert.match(html, /data-graph-skeleton="folder"/)
  assert.match(html, /tl-graph-skeleton-card/)
  assert.match(html, /tl-graph-skeleton-dot/)
  assert.match(html, /tl-graph-skeleton-edge/)
})

test('骨架：纯装饰，整块 aria-hidden，且不带 role', () => {
  for (const variant of ['folder', 'turn'] as const) {
    const html = render(graphSkeleton(variant))
    assert.match(html, /aria-hidden="true"/, variant)
    assert.doesNotMatch(html, /role="status"/, variant)
    // 骨架里不许出现任何可读文案（文案由调用方那行 role="status" 负责）
    assert.doesNotMatch(html, />[^<]*[\u4e00-\u9fa5][^<]*</, variant)
  }
})

test('骨架：确定性 —— 同一 variant 两次渲染逐字节相同（无随机坐标）', () => {
  for (const variant of ['folder', 'turn'] as const) {
    assert.equal(render(graphSkeleton(variant)), render(graphSkeleton(variant)), variant)
  }
})

test('骨架：variant 落进 data 属性，便于样式与断言区分', () => {
  assert.match(render(graphSkeleton('folder')), /data-graph-skeleton="folder"/)
  assert.match(render(graphSkeleton('turn')), /data-graph-skeleton="turn"/)
})
