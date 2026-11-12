/*
 * tests/reasoning/reasoning-view.test.ts —— 视图装配的静态断言（SSR 首帧，不跑 effect）。
 *
 * 这一套守的是 P3 里**只在装配层才能判**的几件事（纯函数层已经由 viz-*.test.ts 覆盖）：
 * 1. 空结果必须区分「筛选滤空了」和「本来就没有记录」——旧实现只有一句「当前筛选下没有数据」，
 *    用户分不清是自己筛错了还是真的没数据；
 * 2. 筛选器必须是自研 Listbox，**不再有原生 `<select>`**；
 * 3. 覆盖率条：`coverage === undefined` 或 `total === 0` 时整条不渲染（现有夹具不传也不会炸），
 *    `loadingMore` 时按钮 disabled（保留旧图，不闪空态）；
 * 4. 「其他」合成组必须能下钻（旧实现里 `selectedGroup` 只从 `derived.groups` 里找，
 *    点「其他」永远拿不到详情）；
 * 5. 语言下拉从**筛选前**的句子枚举（选了中文，英语选项不能消失）。
 *
 * 为什么用 renderToString：这些是首帧就成立的静态结论（SSR 不跑 effect，正好把
 * "初始状态对不对"与"副作用对不对"分开测）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import * as React from 'react'
import { renderToString } from 'react-dom/server'
import { ReasoningView, type ReasoningCoverage } from '../../src/client/ui/reasoning/ReasoningView.ts'
import type { ReasoningSample } from '../../src/shared/reasoning/index.ts'

function sample(patch: Partial<ReasoningSample> = {}): ReasoningSample {
  return {
    text: 'I need to check the tree listing.',
    answerText: 'ok',
    tokens: 100,
    totalTokens: 1000,
    sessionId: 's1',
    turn: 1,
    model: 'deepseek/deepseek-v4.1-flash',
    preset: 'coding',
    at: 1,
    kind: 'committed',
    ...patch,
  }
}

/*
 * 1.5.5 起默认 `range` 是 `'session'`，而"当前会话"必须由入口传 `currentSessionId`。
 * 夹具里必须一起给：否则样本会被 range=session 全部滤掉，页面走空态，
 * 后面的断言就变成"在空页上找不到树图"——看起来像产品缺陷，其实是用例漏了参数。
 * （`samples: []` 之类"真要空"的用例仍然显式覆盖 samples。）
 */
function render(props: Record<string, unknown> = {}): string {
  return renderToString(
    React.createElement(ReasoningView, { samples: [sample()], locale: 'zh', currentSessionId: 's1', ...props } as never),
  )
}

/**
 * 取主图空态块的文本。
 *
 * 为什么不能直接在整页 HTML 上断言：右侧排行卡在无分组时也会显示 `reasoning.empty`
 * （「当前筛选下没有数据」），两处文案一样但**语义不同** —— 排行说"没有可排的"，
 * 主图说"筛选滤空了"。必须在空态块自己身上判。
 */
function emptyBlockText(html: string): string {
  const anchor = html.indexOf('data-testid="reasoning-empty"')
  if (anchor === -1) return ''
  /* 到右侧排行卡之前为止：排行卡在无分组时也显示 reasoning.empty（同样的文案、不同语义）。 */
  const rest = html.slice(anchor)
  const end = rest.search(/data-testid="reasoning-side"/)
  return end === -1 ? rest : rest.slice(0, end)
}

/* ---------------- 空态：两种"空"必须分开 ---------------- */

test('本来没有记录：说"没有记录"，不说"筛选滤空"', () => {
  const html = render({ samples: [] })
  assert.match(html, /data-empty="true"/)
  const block = emptyBlockText(html)
  assert.match(block, /这个范围内没有可读取的思维链记录/)
  assert.equal(/当前筛选下没有数据/.test(block), false, '没有筛选条件时不得说"筛选下没有数据"')
})

test('筛选滤空了：点明是哪些条件、并给重置入口', () => {
  const html = render({ initialFilter: { model: 'no-such-model' } })
  assert.match(html, /data-empty="true"/)
  const block = emptyBlockText(html)
  assert.match(block, /当前筛选下没有数据/, '必须说明是筛选导致为空')
  assert.match(block, /模型/, '必须点明生效的条件（模型）')
  assert.match(block, /重置/, '必须给一键重置')
})

/* ---------------- 筛选器：Listbox 而不是 select ---------------- */

test('筛选器全部是自研 Listbox（不再有原生 select）', () => {
  const html = render()
  assert.equal(/<select/.test(html), false, '原生 select 必须被替换掉（P3）')
  assert.match(html, /aria-haspopup="listbox"/)
  assert.match(html, /role="combobox"/)
  /* 五个筛选：范围 / 模型 / 语言 / 记录 / preset。 */
  for (const testId of ['reasoning-range', 'reasoning-model', 'reasoning-lang', 'reasoning-record', 'reasoning-preset']) {
    assert.match(html, new RegExp('data-testid="' + testId + '"'), '缺筛选器：' + testId)
  }
  assert.match(html, /aria-expanded="false"/, '关闭态必须如实表达 aria-expanded')
})

test('语言下拉从**筛选前**的句子枚举：选了中文，英语选项仍在', () => {
  /*
   * 两条样本必须**同属当前会话**（默认 range=session，currentSessionId='s1'）：
   * 一条中文、一条英文，才能验证"选了中文之后英语选项没消失"。
   * 若把英文那条放到 s2，它会被 range=session 先滤掉 —— 那测的就不是语言枚举口径了。
   */
  const html = render({
    samples: [sample({ text: 'I need to check the tree.', sessionId: 's1' }), sample({ text: '先检查目录树。', sessionId: 's1' })],
    initialFilter: { lang: 'zh' },
  })
  assert.match(html, /中文/, '当前语言必须出现在下拉里')
  /* 弹层是懒渲染的（关着时不在 DOM 里），所以用选项数量判断枚举口径：
   * 语言选项 = 全部(all) + zh + en；若从筛选后的句子枚举，这里只会剩 全部 + zh。 */
  const match = /data-testid="reasoning-lang"[^>]*data-option-count="(\d+)"/.exec(html)
  assert.ok(match !== null, '语言下拉必须带选项数量')
  assert.equal(match[1], '3', '选了中文之后语言选项仍须是 全部+中文+英语（控件不能吃掉自己的选项）')
})

/* ---------------- 覆盖率条 ---------------- */

const COVERAGE: ReasoningCoverage = { loaded: 12, total: 40, failed: 2, more: true, remaining: 26 }

test('coverage 缺省时整条不渲染（现有夹具不传也不会炸）', () => {
  const html = render({ initialFilter: { range: 'workspace' } })
  assert.equal(/data-testid="reasoning-coverage"/.test(html), false)
})

test('coverage.total === 0 时整条不渲染（没有范围就没有覆盖率可谈）', () => {
  const html = render({
    coverage: { loaded: 0, total: 0, failed: 0, more: false, remaining: 0 },
    initialFilter: { range: 'workspace' },
  })
  assert.equal(/data-testid="reasoning-coverage"/.test(html), false)
})

test('覆盖率条：已加载/总数 + 失败数 + 两个加载按钮', () => {
  /* 1.5.5：覆盖率只在**跨会话**范围下有意义（默认 range 已是 session，见 reasoning-fixes 那条）。 */
  const html = render({ coverage: COVERAGE, initialFilter: { range: 'workspace' }, onLoadMore: () => undefined, onLoadAll: () => undefined })
  assert.match(html, /data-testid="reasoning-coverage"/)
  assert.match(html, /已加载 12\/40 个会话/)
  assert.match(html, /失败 2/)
  assert.match(html, /data-testid="reasoning-load-more"/)
  assert.match(html, /data-testid="reasoning-load-all"/)
  assert.match(html, /继续加载/)
  assert.match(html, /加载全部/)
})

test('coverage.more === false 时不给加载按钮（没有可加载的了就不要假装有）', () => {
  const html = render({ coverage: { ...COVERAGE, more: false, remaining: 0 }, initialFilter: { range: 'workspace' } })
  assert.equal(/data-testid="reasoning-load-more"/.test(html), false)
  assert.equal(/data-testid="reasoning-load-all"/.test(html), false)
})

test('loadingMore：按钮 disabled 且显示"正在加载"，其余内容照常渲染（不闪空态）', () => {
  const html = render({
    coverage: COVERAGE,
    initialFilter: { range: 'workspace' },
    loadingMore: true,
    onLoadMore: () => undefined,
    onLoadAll: () => undefined,
  })
  assert.match(html, /disabled=""/, '加载中按钮必须 disabled')
  assert.match(html, /正在加载/)
  /* 关键：加载更多不等于空态 —— 旧图必须还在。 */
  assert.match(html, /tl-treemap/, '加载中必须保留旧图')
  assert.equal(/data-empty="true"/.test(html), false, '加载更多不得把页面切成空态')
})

/* ---------------- 「其他」下钻 ---------------- */

test('「其他」可下钻：详情带列出被合并的分组（旧实现点开是空的）', () => {
  /* 60 组、每组等量 → 必有合并 → 必有「其他」。 */
  const samples = Array.from({ length: 30 }, (_, index) => sample({ text: 'Unique' + String(index) + ' need to check the tree.' }))
  const html = renderToString(
    React.createElement(ReasoningView, {
      samples,
      locale: 'zh',
      currentSessionId: 's1',
      initialSelect: '\u0000other',
    } as never),
  )
  assert.match(html, /data-testid="reasoning-other-list"/, '「其他」必须给出下钻列表')
  assert.match(html, /「其他」合并了/, '必须说明合并了几组')
  assert.match(html, /被合并的分组/)
  assert.match(html, /tl-other-item/, '每条被合并的分组都要能再点进去')
  assert.match(html, /其他/, '详情带的主题必须是「其他」而不是空')
})

/* ---------------- 三视图共用同一个外壳 ---------------- */

test('三视图共享标题 / KPI / 筛选 / 详情，切视图只换主图', () => {
  const treemap = render({ initialView: 'treemap' })
  const cloud = render({ initialView: 'cloud' })
  const list = render({ initialView: 'list' })
  for (const html of [treemap, cloud, list]) {
    assert.match(html, /data-testid="reasoning-main"/)
    assert.match(html, /data-testid="reasoning-side"/)
    assert.match(html, /data-testid="reasoning-detail"/)
    assert.match(html, /tl-reasoning-kpi/)
    assert.match(html, /tl-reasoning-toolbar/)
  }
  assert.match(treemap, /tl-treemap/)
  assert.match(cloud, /tl-word-cloud/)
  assert.match(list, /tl-reasoning-table/)
})

test('主图放在固定高度的舞台里（切视图不改变页面高度）', () => {
  for (const view of ['treemap', 'cloud', 'list']) {
    const html = render({ initialView: view })
    assert.match(html, /class="tl-reasoning-stage"/, view + ' 必须渲染在舞台里')
  }
})

/* ---------------- 列表：真 button 表头 + 显示 N/M ---------------- */

test('表头排序是真 button，且带 aria-sort 方向', () => {
  const html = render({ initialView: 'list' })
  assert.match(html, /class="tl-sort-btn"/)
  assert.match(html, /aria-sort="descending"/, '默认按字符降序，必须如实标注方向')
  /* th 自己不再绑 onClick（旧实现是 th onClick，键盘与语义都不完整）。 */
  assert.equal(/<th[^>]*onclick/i.test(html), false, 'th 不能直接用 onClick 表达排序')
})

test('合并提示只在 treemap 下出现（列表/词云不合并，不能声称一件没发生的事）', () => {
  /* 60 组、每组等量 → 合并必然发生（12 格上限）。 */
  const samples = Array.from({ length: 30 }, (_, index) => sample({ text: 'Unique' + String(index) + ' need to check the tree.' }))
  const renderView = (view: string): string =>
    renderToString(React.createElement(ReasoningView, { samples, locale: 'zh', currentSessionId: 's1', initialView: view } as never))
  assert.match(renderView('treemap'), /data-testid="reasoning-collapsed"/, 'treemap 必须说明合并了多少组')
  assert.equal(/data-testid="reasoning-collapsed"/.test(renderView('list')), false, '列表不合并，不得给合并提示')
  assert.equal(/data-testid="reasoning-collapsed"/.test(renderView('cloud')), false, '词云不合并，不得给合并提示')
})

test('词云吃全量分组：词数上限是 50，而不是合并后的 12', () => {
  /* 60 组、每组等量：若词云吃合并结果，最多只有 11 个词。 */
  const samples = Array.from({ length: 60 }, (_, index) => sample({ text: 'Unique' + String(index) + ' need to check the tree.' }))
  const html = renderToString(
    React.createElement(ReasoningView, { samples, locale: 'zh', currentSessionId: 's1', initialView: 'cloud' } as never),
  )
  const words = (html.match(/class="tl-cloud-word"/g) ?? []).length
  assert.ok(words > 11, '词云不能只拿到合并后的 11 个词，实际 ' + String(words))
  assert.ok(words <= 50, '词云最多 50 个词，实际 ' + String(words))
})
