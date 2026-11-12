/*
 * tests/reasoning/viz-layout.test.ts —— 矩形树图布局与词云排版（P3）。
 *
 * 守的是四条**已核实的真机根因**，每条都用可判定的不变量表达（不靠截图）：
 *
 * 1. 固定 900×380 viewBox + preserveAspectRatio 整体缩放 → 窄容器里 12px 标签被压成不可读。
 *    不变量：布局必须**吃容器尺寸**（同一批分组在窄容器里得到不同布局），且所有矩形落在画布内。
 * 2. 布局不是真正 squarified（旧实现是"找最接近面积半分的递归二分"）。
 *    不变量：**同一个分组在两种输入顺序下的布局一致**（确定性 + 排序无关），
 *    且大多数格子的长宽比接近 1（squarified 的目标函数），旧二分做不到。
 * 3. 配色按下标取 → 筛选/排序变化后同一分组换色。已由 viz-collapse.test.ts 的稳定哈希断言守住。
 * 4. 词云是定点摆字（按序号算螺旋坐标）→ 长词/大词/容器缩放重叠或越界。
 *    不变量：放入的词两两不重叠、全在画布内、放不下的计数准确。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  cloudEntries,
  estimateTextSize,
  formatCount,
  layoutTreemap,
  layoutWordCloud,
  type CloudWord,
} from '../../src/client/ui/reasoning/viz.ts'
import type { ReasoningGroup } from '../../src/shared/reasoning/index.ts'

function group(key: string, chars: number): ReasoningGroup {
  return {
    key,
    chars,
    answerChars: 0,
    sentences: 1,
    tokens: 0,
    totalTokens: 0,
    knownChars: 0,
    blocks: 1,
    forms: {},
    langs: {},
    models: {},
    presets: {},
    primaryForm: 'statement',
    primaryLang: 'en',
  } as unknown as ReasoningGroup
}

function boxesOverlap(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

/* ---------------- 矩形树图：容器尺寸 ---------------- */

test('布局吃容器尺寸：同一批分组在宽/窄容器里得到不同布局（不是整体缩放）', () => {
  const groups = [group('a', 500), group('b', 300), group('c', 120), group('d', 80)]
  const wide = layoutTreemap(groups, { x: 0, y: 0, w: 900, h: 380 })
  const narrow = layoutTreemap(groups, { x: 0, y: 0, w: 360, h: 380 })
  assert.equal(wide.length, groups.length)
  assert.equal(narrow.length, groups.length)
  /* 窄画布下总宽度必须收进 360（旧的固定 viewBox 会算出 900 宽，再靠 CSS 缩小）。 */
  for (const slice of narrow) {
    assert.ok(slice.rect.x + slice.rect.w <= 360.01, '窄布局越界：' + JSON.stringify(slice.rect))
  }
  const wideSum = wide.reduce((sum, slice) => sum + slice.rect.w, 0)
  const narrowSum = narrow.reduce((sum, slice) => sum + slice.rect.w, 0)
  assert.notEqual(Math.round(wideSum), Math.round(narrowSum), '宽窄两种容器必须真的重新布局')
})

test('所有矩形都落在画布内且面积守恒（不丢量、不越界）', () => {
  const groups = [group('a', 4000), group('b', 2500), group('c', 1500), group('d', 1000), group('e', 600), group('f', 400)]
  const box = { x: 0, y: 0, w: 720, h: 420 }
  const slices = layoutTreemap(groups, box)
  assert.equal(slices.length, groups.length, '组数不能少（少一格就是静默丢信息）')
  let area = 0
  for (const slice of slices) {
    const { x, y, w, h } = slice.rect
    assert.ok(x >= -0.001 && y >= -0.001, '矩形起点越界：' + JSON.stringify(slice.rect))
    assert.ok(x + w <= box.w + 0.01 && y + h <= box.h + 0.01, '矩形终点越界：' + JSON.stringify(slice.rect))
    assert.ok(w >= 0 && h >= 0, '宽高不得为负')
    area += w * h
  }
  assert.ok(Math.abs(area - box.w * box.h) < 1, '面积之和必须等于画布面积，实际 ' + String(area))
})

test('确定性：同输入同布局；输入顺序无关（内部先按字符数降序）', () => {
  const groups = [group('b', 300), group('a', 500), group('d', 80), group('c', 120)]
  const first = layoutTreemap(groups, { x: 0, y: 0, w: 640, h: 360 })
  const second = layoutTreemap(groups, { x: 0, y: 0, w: 640, h: 360 })
  assert.deepEqual(first, second, '同输入必须同输出（无随机）')

  const reordered = layoutTreemap(groups.slice().reverse(), { x: 0, y: 0, w: 640, h: 360 })
  assert.deepEqual(
    reordered.map((slice) => [slice.group.key, slice.rect]),
    first.map((slice) => [slice.group.key, slice.rect]),
    '布局不得依赖输入顺序',
  )
})

test('真 squarified：多数格子长宽比接近 1（旧递归二分做不到）', () => {
  /* 一组刻意"很难铺"的数据：一个巨块 + 一串小块（递归二分会产生细长条）。 */
  const groups = [
    group('big', 6000),
    group('m1', 1200),
    group('m2', 900),
    group('m3', 700),
    group('s1', 400),
    group('s2', 300),
    group('s3', 200),
    group('s4', 120),
    group('s5', 80),
  ]
  const slices = layoutTreemap(groups, { x: 0, y: 0, w: 720, h: 420 })
  const ratios = slices
    .filter((slice) => slice.rect.w > 0 && slice.rect.h > 0)
    .map((slice) => {
      const { w, h } = slice.rect
      return Math.max(w / h, h / w)
    })
  const nearSquare = ratios.filter((ratio) => ratio <= 3).length
  assert.ok(
    nearSquare >= Math.ceil(ratios.length * 0.7),
    '至少 70% 的格子长宽比应 <= 3，实际 ' + String(nearSquare) + '/' + String(ratios.length) + '（比值 ' + ratios.map((r) => r.toFixed(1)).join(',') + '）',
  )
  /* 反向：不许出现"1px 宽的细条"（那正是旧实现的典型失败形态）。 */
  for (const slice of slices) {
    assert.ok(Math.min(slice.rect.w, slice.rect.h) >= 8, '不得出现细条：' + JSON.stringify(slice.rect))
  }
})

test('空输入 / 零字符 → 空布局（不画出无名矩形）', () => {
  assert.deepEqual(layoutTreemap([], { x: 0, y: 0, w: 640, h: 360 }), [])
  assert.deepEqual(layoutTreemap([group('a', 0)], { x: 0, y: 0, w: 640, h: 360 }), [])
  assert.deepEqual(layoutTreemap([group('a', 10)], { x: 0, y: 0, w: 0, h: 360 }), [])
})

test('单个分组铺满整块画布', () => {
  const slices = layoutTreemap([group('only', 100)], { x: 0, y: 0, w: 600, h: 300 })
  assert.equal(slices.length, 1)
  assert.equal(slices[0].rect.x, 0)
  assert.equal(slices[0].rect.y, 0)
  assert.ok(Math.abs(slices[0].rect.w - 600) < 0.01)
  assert.ok(Math.abs(slices[0].rect.h - 300) < 0.01)
})

/* ---------------- 词云：测量 + 碰撞 ---------------- */

function word(key: string, chars: number, fontSize: number, weight = 0.5): CloudWord {
  return { key, text: key, chars, fontSize, weight, lang: 'en' }
}

test('词云：放入的词两两不重叠、全部在画布内', () => {
  const entries = Array.from({ length: 30 }, (_, index) => word('w' + String(index), 1000 - index * 10, 40 - index))
  const layout = layoutWordCloud(entries, { width: 640, height: 420 })
  assert.ok(layout.words.length > 0, '必须至少有词放下')
  for (const placed of layout.words) {
    assert.ok(placed.left >= 0 && placed.top >= 0, '词框起点越界：' + placed.key)
    assert.ok(placed.left + placed.width <= layout.width + 0.01, '词框右侧越界：' + placed.key)
    assert.ok(placed.top + placed.height <= layout.height + 0.01, '词框底部越界：' + placed.key)
  }
  for (let i = 0; i < layout.words.length; i += 1) {
    for (let j = i + 1; j < layout.words.length; j += 1) {
      const a = layout.words[i]
      const b = layout.words[j]
      assert.equal(
        boxesOverlap({ x: a.left, y: a.top, w: a.width, h: a.height }, { x: b.left, y: b.top, w: b.width, h: b.height }),
        false,
        '词重叠：' + a.key + ' 与 ' + b.key,
      )
    }
  }
})

test('词云：放不下的词被计数（不许静默丢失）', () => {
  /* 40 个 40px 的词塞进 120×120 的小画布：物理上不可能全放。 */
  const entries = Array.from({ length: 40 }, (_, index) => word('big-word-' + String(index), 500, 40, 1))
  const layout = layoutWordCloud(entries, { width: 120, height: 120 })
  assert.equal(layout.total, entries.length, '参与排版的词数必须如实')
  assert.ok(layout.skipped > 0, '小画布必须报告"放不下"的数量，实际 skipped=' + String(layout.skipped))
  assert.equal(layout.words.length + layout.skipped, layout.total, '放入 + 跳过必须等于总数')
  /* 放不下的必须仍有降字号尝试过（不是一上来就放弃）：放下的词字号可能被压缩。 */
  for (const placed of layout.words) {
    assert.ok(placed.fontSize >= 10, '字号不得低于下限')
    assert.ok(placed.fontSize <= 40, '字号不得高于上限')
  }
})

test('词云：确定性（同输入同布局、无随机）', () => {
  const entries = Array.from({ length: 20 }, (_, index) => word('w' + String(index), 900 - index * 20, 30 - index))
  const a = layoutWordCloud(entries, { width: 600, height: 400 })
  const b = layoutWordCloud(entries, { width: 600, height: 400 })
  assert.deepEqual(a, b)
})

test('词云：容器变窄会重新排版（不是缩放），放不下就降字号/跳过并计数', () => {
  const entries = Array.from({ length: 24 }, (_, index) => word('word-' + String(index), 800 - index * 10, 36 - index))
  const wide = layoutWordCloud(entries, { width: 900, height: 420 })
  const narrow = layoutWordCloud(entries, { width: 320, height: 420 })
  assert.equal(wide.width, 900)
  assert.equal(narrow.width, 320)
  assert.ok(narrow.words.length <= wide.words.length, '窄容器不可能放下更多词')
  assert.equal(narrow.words.length + narrow.skipped, narrow.total)
})

test('词云：中文 / 长英文 / 混合文本都能测量且不越界', () => {
  const entries: CloudWord[] = [
    { key: '先检查目录树', text: '先检查目录树', chars: 600, fontSize: 36, weight: 0.9, lang: 'zh' },
    { key: 'I need to verify the whole listing', text: 'I need to verify the whole listing', chars: 500, fontSize: 28, weight: 0.7, lang: 'en' },
    { key: '中文 mixed 123', text: '中文 mixed 123', chars: 400, fontSize: 20, weight: 0.5, lang: 'mixed' },
  ]
  const layout = layoutWordCloud(entries, { width: 640, height: 420 })
  assert.ok(layout.words.length >= 1)
  for (const placed of layout.words) {
    assert.ok(placed.left + placed.width <= layout.width + 0.01)
    assert.ok(placed.top + placed.height <= layout.height + 0.01)
  }
  /* 估算器对 CJK 给全宽、对拉丁字给半宽 —— 不能把中文当成 0 宽。 */
  const zh = estimateTextSize('中文', 20, 0.5)
  const en = estimateTextSize('ab', 20, 0.5)
  assert.ok(zh.width > en.width, '同等字符数下 CJK 必须比拉丁宽')
  assert.ok(zh.height > 0 && en.height > 0)
})

test('cloudEntries：字号随字符数单调、排除「其他」合成组、最多 50 个', () => {
  const groups = [
    group('big', 9000),
    group('mid', 3000),
    group('small', 100),
    group('\u0000other', 50000),
  ]
  const entries = cloudEntries(groups, 'prefix')
  assert.equal(entries.some((entry) => entry.key === '\u0000other'), false, '「其他」不是词，不能进词云')
  assert.ok(entries[0].fontSize >= entries[entries.length - 1].fontSize, '大词字号不得小于小词')
  const many = Array.from({ length: 120 }, (_, index) => group('g' + String(index), 1000 - index))
  assert.equal(cloudEntries(many, 'prefix').length, 50, '最多 50 个词（其余计入未显示）')
})

/* ---------------- 数字格式 ---------------- */

test('数字千分位（23106 不能显示成 23106 之外的形态）', () => {
  assert.equal(formatCount(0), '0')
  assert.equal(formatCount(999), '999')
  assert.equal(formatCount(23106), '23,106')
  assert.equal(formatCount(1234567), '1,234,567')
  assert.equal(formatCount(Number.NaN), '—')
})
