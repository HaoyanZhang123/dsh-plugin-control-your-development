/*
 * tests/ui-map/hub-label.test.ts —— 文件夹枢纽的**名字**（P2 修复：长名省略，不再整个不画）。
 *
 * ## 真机反馈
 *
 * 「有些文件夹不显示名称，截图里 5 个卡片只出了 1 个名字」。
 *
 * ## 根因 → 修复
 *
 * 根因在 `folderLayout.ts:hubCardWidth()`：
 *   labelVisible: wanted <= FOLDER_HUB_MAX_WIDTH
 * 名字所需宽度一超过 132px 就**一个字都不画**。而卡片宽度本身已被钳在 132，
 * 所以这不是"放不下"，是"没做省略"。
 *
 * 修复：
 * - 卡片宽度保持既有钳制（FOLDER_HUB_MIN_WIDTH..FOLDER_HUB_MAX_WIDTH），**布局不变**；
 * - 放不下就省略（`project…`），用同一套 `textWidth()` 估算，保证结果 <= 可用宽度；
 * - `FolderLayoutHub.labelText` 交出截断后的文本，渲染层用它；`name`/`title`/`aria-label`
 *   仍然是完整名字，信息不丢；
 * - `labelVisible` 的语义改为「有没有可读的名字可给」，只在连「一个字 + 省略号」
 *   都放不下时才为 false。
 *
 * ## 反向断言（同样重要）
 *
 * 短名（src / docs / tools）**必须保持原样整词显示**，不能被截成 `do…` ——
 * 那说明容差没给对，是把"省略"用错了地方。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  FOLDER_HUB_MAX_WIDTH,
  FOLDER_HUB_MIN_WIDTH,
  FOLDER_HUB_PAD,
  estimateTextWidth,
  layoutFolderGeometry,
  type MapEntry,
} from '../../src/client/ui/map/index.ts'
import { FileGraph, type FileGraphProps } from '../../src/client/ui/map/index.ts'
import { NOW } from './fixtures.ts'

const SIZE = { width: 720, height: 420 }
const h = React.createElement

/** 与 folderLayout 的 textWidth 同口径（estimateTextWidth × 1.06）。 */
function sameMeasure(text: string): number {
  return Math.ceil(estimateTextWidth(text, 11) * 1.06 * 100) / 100
}

function dirEntry(path: string): MapEntry {
  return { name: path.slice(path.lastIndexOf('/') + 1), path, kind: 'directory' }
}

function hubOf(name: string) {
  const geometry = layoutFolderGeometry([dirEntry(name)], [], { ...SIZE, currentPath: '' })
  const hub = geometry.hubs[0]
  assert.ok(hub !== undefined, '夹具应至少产生一个枢纽：' + name)
  return hub
}

/* ================================================================== *
 * 1. 长名：省略，而不是不画
 * ================================================================== */

test('长名必须显示为省略形式（不再一个字都不画）', () => {
  const name = '这是一个非常长的顶层目录名称用于验证省略号截断行为'
  const hub = hubOf(name)
  assert.equal(hub.labelVisible, true, '长名必须显示（之前 labelVisible=false）')
  assert.ok(hub.labelText.length > 0, '必须给出截断后的文本')
  assert.ok(hub.labelText.endsWith('\u2026'), '超宽名字必须以省略号结尾：' + hub.labelText)
  assert.ok(hub.labelText.length < name.length, '必须真的截短了')
  assert.equal(hub.name, name, 'name 字段必须保持完整（信息不丢）')
})

test('截断后文本宽度 <= 可用宽度（width - PAD - 14 - PAD）', () => {
  const names = [
    '这是一个非常长的顶层目录名称用于验证省略号截断行为',
    'relations-evidence-report-with-an-extremely-long-name',
    'x'.repeat(60),
    'a-very-long-directory-name-for-testing-truncation-behavior',
  ]
  for (const name of names) {
    const hub = hubOf(name)
    const available = hub.width - FOLDER_HUB_PAD - 14 - FOLDER_HUB_PAD
    assert.ok(
      sameMeasure(hub.labelText) <= available + 0.01,
      name + ' 截断后仍溢出：' + sameMeasure(hub.labelText) + ' > ' + available + '（' + hub.labelText + '）',
    )
    assert.ok(hub.labelText.endsWith('\u2026'), name + ' 应以省略号结尾：' + hub.labelText)
  }
})

test('卡片宽度仍被钳在既有区间（布局不变）', () => {
  for (const name of ['a', 'src', '这是一个非常长的顶层目录名称', 'x'.repeat(80)]) {
    const hub = hubOf(name)
    assert.ok(hub.width >= FOLDER_HUB_MIN_WIDTH, '宽度下限：' + name)
    assert.ok(hub.width <= FOLDER_HUB_MAX_WIDTH, '宽度上限：' + name)
  }
})

/* ================================================================== *
 * 2. 短名：必须原样整词显示（反向断言，防止"省略用过头"）
 * ================================================================== */

test('反向：短名保持原样，不得被截成 do… 这类', () => {
  for (const name of ['a', 'src', 'docs', 'tools', 'notes', 'scripts']) {
    const hub = hubOf(name)
    assert.equal(hub.labelText, name, name + ' 是短名，必须整词显示（不得截断），实际：' + hub.labelText)
    assert.equal(hub.labelVisible, true, name + ' 必须显示名字')
  }
})

/* ================================================================== *
 * 3. labelVisible 的语义
 * ================================================================== */

test('labelVisible 只在"没有可读名字可给"时为 false', () => {
  /* 所有能给出非空 labelText 的枢纽，labelVisible 必须为 true。 */
  const names = ['a', 'src', 'docs', 'tools', '这是一个非常长的顶层目录名称', 'x'.repeat(60)]
  for (const name of names) {
    const hub = hubOf(name)
    assert.equal(hub.labelVisible, hub.labelText !== '', name + '：labelVisible 必须与 labelText 一致')
  }
})

/* ================================================================== *
 * 4. DOM：渲染层用 labelText，title/aria 用完整 name
 * ================================================================== */

function renderHubs(entryNames: readonly string[]): string {
  const entries: MapEntry[] = entryNames.map((name) => dirEntry(name))
  return renderToStaticMarkup(
    h(FileGraph, {
      mode: 'folder',
      entries,
      files: [],
      edges: [],
      allEdges: [],
      currentPath: '',
      now: NOW,
      locale: 'zh',
      testId: 'graph',
    } as FileGraphProps),
  )
}

test('DOM：可见文本是 labelText（带省略号），不是完整 name', () => {
  const long = '这是一个非常长的顶层目录名称用于验证省略号截断行为'
  const html = renderHubs([long])
  const labelMatch = /class="tl-foldhub-label"[^>]*>([^<]*)</.exec(html)
  assert.ok(labelMatch !== null, '必须画出枢纽标签（之前长名直接不画）')
  assert.ok(labelMatch[1].includes('\u2026'), '可见文本必须带省略号：' + labelMatch[1])
  assert.ok(labelMatch[1].length < long.length, '可见文本必须被截短')
  assert.equal(html.includes('>' + long + '<'), false, '不得把完整长名塞进可见文本')
})

test('DOM：完整名字仍在 title / aria-label / data-hub-name 里（省略不丢信息）', () => {
  const long = '这是一个非常长的顶层目录名称用于验证省略号截断行为'
  const html = renderHubs([long])
  assert.ok(html.includes('aria-label="' + long + ' · '), 'aria-label 必须含完整名字')
  assert.ok(html.includes('data-hub-name="' + long + '"'), 'data-hub-name 必须含完整名字')
  assert.ok(html.includes('<title>' + long), 'title 必须含完整名字')
})

test('DOM：短名的可见文本就是原名（不带省略号）', () => {
  const html = renderHubs(['src'])
  const labelMatch = /class="tl-foldhub-label"[^>]*>([^<]*)</.exec(html)
  assert.ok(labelMatch !== null)
  assert.equal(labelMatch[1], 'src', '短名不得被截断')
})

test('DOM：多个文件夹时每个都有名字（回归真机"5 个卡片只出 1 个名字"）', () => {
  const names = [
    '这是一个非常长的顶层目录名称用于验证省略号截断行为',
    'tools',
    'src',
    'docs',
    'notes',
  ]
  const html = renderHubs(names)
  const labels = [...html.matchAll(/class="tl-foldhub-label"[^>]*>([^<]*)</g)].map((match) => match[1])
  assert.equal(labels.length, names.length, '每个枢纽都必须画出名字，实际：' + JSON.stringify(labels))
  for (const label of labels) {
    assert.ok(label.length > 0, '名字不得为空')
  }
})

/* ================================================================== *
 * 5. 确定性
 * ================================================================== */

test('同输入两次逐字段相同（省略是纯函数，不依赖 DOM 测量）', () => {
  const name = '这是一个非常长的顶层目录名称用于验证省略号截断行为'
  const first = hubOf(name)
  const second = hubOf(name)
  assert.deepEqual(first, second)
})
