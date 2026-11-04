/*
 * surface.test.ts —— D-30「tab 独占区域时隐藏宿主输入框」的机制守卫。
 *
 * 该机制只改 DOM 属性（[data-threadline-surface]），不写存储、不碰宿主数据；
 * 这里用最小假 DOM 覆盖：打标记 → 移除、引用计数、找不到滚动容器时安全返回。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { SURFACE_ATTR, markComposerSurface } from '../../src/client/state/composerSurface.ts'
import { readStyleSource } from '../harness/styles-codegen.ts'

interface FakeElement {
  attrs: Map<string, string>
  setAttribute(name: string, value: string): void
  removeAttribute(name: string): void
  getAttribute(name: string): string | null
  closest(selector: string): FakeElement | null
}

function fakeTree(hasScroller: boolean): { scroller: FakeElement | null; leaf: FakeElement } {
  const scroller: FakeElement = {
    attrs: new Map(),
    setAttribute(name, value) { this.attrs.set(name, value) },
    removeAttribute(name) { this.attrs.delete(name) },
    getAttribute(name) { return this.attrs.get(name) ?? null },
    closest() { return null },
  }
  const leaf: FakeElement = {
    attrs: new Map(),
    setAttribute(name, value) { this.attrs.set(name, value) },
    removeAttribute(name) { this.attrs.delete(name) },
    getAttribute(name) { return this.attrs.get(name) ?? null },
    closest(selector) { return hasScroller && selector === '[data-conversation-scroll]' ? scroller : null },
  }
  return { scroller: hasScroller ? scroller : null, leaf }
}

test('打标记：找到 [data-conversation-scroll] 就设置属性，清理后移除', () => {
  const { scroller, leaf } = fakeTree(true)
  const cleanup = markComposerSurface(leaf as unknown as Element)
  assert.equal(scroller?.getAttribute(SURFACE_ATTR), '', '挂载时打上 data-threadline-surface')
  cleanup()
  assert.equal(scroller?.getAttribute(SURFACE_ATTR), null, '卸载时必须移除（不留残留）')
  cleanup()
  assert.equal(scroller?.getAttribute(SURFACE_ATTR), null, '清理函数必须幂等')
})

test('引用计数：两个实例叠加时，只有最后一个卸载才移除属性', () => {
  const { scroller, leaf } = fakeTree(true)
  const a = markComposerSurface(leaf as unknown as Element)
  const b = markComposerSurface(leaf as unknown as Element)
  a()
  assert.equal(scroller?.getAttribute(SURFACE_ATTR), '', '还有一个实例在用，不能移除')
  b()
  assert.equal(scroller?.getAttribute(SURFACE_ATTR), null, '最后一个卸载后移除')
})

test('找不到滚动容器（非 tab 场景 / 假 DOM）时安全返回，不抛错', () => {
  const { leaf } = fakeTree(false)
  const cleanup = markComposerSurface(leaf as unknown as Element)
  assert.doesNotThrow(() => cleanup())
  assert.doesNotThrow(() => markComposerSurface(null)())
})

test('surface.css 的隐藏规则确实进了 bundle（css.ts 里有 data-threadline-surface）', () => {
  const surface = readStyleSource('surface.css')
  assert.ok(surface.includes('[data-conversation-scroll][data-threadline-surface]'))
  assert.ok(surface.includes('display: none'))
})
