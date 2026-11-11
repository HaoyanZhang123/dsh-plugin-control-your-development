/*
 * client/ui/reasoning/viz.ts —— 三种可视化（treemap / 图标云 / 列表）的纯渲染。
 *
 * 全部用原生 SVG/DOM，零第三方依赖（项目硬约束）。
 * 纪律：
 * - 颜色只引用 --tl-* 令牌，不写颜色字面量；
 * - 面积/字号只表达**字符数**（覆盖最完整、不会因 token 缺失而丢样本）；
 * - 选中态用 data-selected + 强调色描边，**不用浏览器默认焦点黑框**；
 * - 文字只出现在列表与 tooltip/aria-label；图标云不写字（用户要求）。
 */
import * as React from 'react'
import type { ReasoningGroup, ReasoningSentence, ReasoningDimension } from '../../../shared/reasoning/index.ts'
import type { Translator } from '../../locale/index.ts'
import { formLabelKey, langLabelKey } from './model.ts'

const h = React.createElement

/** treemap 画布尺寸（viewBox 单位；与实际像素解耦，随容器缩放）。 */
export const TREEMAP_WIDTH = 900
export const TREEMAP_HEIGHT = 380

/**
 * 矩形树图的合并口径（1.5.4：真机反馈「显示前 50 吧」）。
 *
 * 1.5.3 用了 Top 10，但真机「句式开头」一维有 **23106 组**，Top 10 会把大量有意义的
 * 中等分组吞进「其他」，用户看到的板块太少。现在放宽到 50：
 * - `TREEMAP_MIN_SHARE`：占比低于阈值的并入「其他」（避免 1–2px 细条）；
 * - `TREEMAP_TOP_N`：再取前 50 组，其余并入同一个「其他」。
 * 两者叠加 = 先按阈值合并，再按名次截断，剩下的仍然合成一格（不丢量，只丢细节）。
 */
export const TREEMAP_MIN_SHARE = 0.001
export const TREEMAP_TOP_N = 50

/** 「其他」聚合组的哨兵 key（渲染层用 locale 的 reasoning.other 显示，不裸奔到 UI）。 */
export const TREEMAP_OTHER_KEY = '\u0000other'

/**
 * 矩形树图的配色（1.5.4：真机反馈「色块太丑，饱和度太高」）。
 *
 * 只引用令牌（项目硬约束：样式里不写颜色字面量）；令牌本身已经是低饱和分类色
 * （见 `tokens.css` 的 `--tl-chart-*`：把它们往中性面里混过一遍）。
 * 顺序固定 → 同输入同配色（截图可复现）。颜色只承担"区分分组"，不承担状态。
 */
export const TREEMAP_COLORS: readonly string[] = [
  'var(--tl-chart-1)',
  'var(--tl-chart-2)',
  'var(--tl-chart-3)',
  'var(--tl-chart-4)',
  'var(--tl-chart-5)',
  'var(--tl-chart-6)',
  'var(--tl-chart-7)',
  'var(--tl-chart-8)',
]

/** 一个聚合结果：`groups` 是**渲染用**的最终分组，`hiddenCount` 是被合并掉的组数。 */
export interface CollapsedGroups {
  groups: ReasoningGroup[]
  hiddenCount: number
}

/**
 * 把「太多太细」的分组合并成可读的一屏（纯函数，确定，便于测试）。
 *
 * 规则（与用户确认的口径一致）：
 * 1. 总字符数为 0 → 原样返回（调用方已有空态，不该走到这）；
 * 2. 先按 `chars` 降序，占比 < `TREEMAP_MIN_SHARE` 的全部并入「其他」；
 * 3. 剩下的再取前 `TREEMAP_TOP_N`，其余并入同一个「其他」；
 * 4. 没有任何组被合并 → 不产生空的「其他」。
 */
export function collapseTreemapGroups(groups: readonly ReasoningGroup[]): CollapsedGroups {
  const positive = groups.filter((group) => group.chars > 0)
  if (positive.length === 0) return { groups: [], hiddenCount: 0 }
  const total = positive.reduce((sum, group) => sum + group.chars, 0)
  if (total <= 0) return { groups: [...groups], hiddenCount: 0 }

  const sorted = positive.slice().sort((left, right) => right.chars - left.chars || (left.key < right.key ? -1 : 1))
  const kept: ReasoningGroup[] = []
  const merged: ReasoningGroup[] = []
  for (const group of sorted) {
    const share = group.chars / total
    if (share < TREEMAP_MIN_SHARE && merged.length + kept.length > 0) {
      merged.push(group)
      continue
    }
    if (kept.length >= TREEMAP_TOP_N) {
      merged.push(group)
      continue
    }
    kept.push(group)
  }

  if (merged.length === 0) return { groups: kept, hiddenCount: 0 }

  /* 「其他」的字段：字符数/句数/token 求和；主句式与语言取占比最大者（与聚合口径一致，不编造）。 */
  const other: ReasoningGroup = {
    ...merged[0],
    key: TREEMAP_OTHER_KEY,
    chars: merged.reduce((sum, group) => sum + group.chars, 0),
    sentences: merged.reduce((sum, group) => sum + group.sentences, 0),
    tokens: merged.reduce((sum, group) => sum + group.tokens, 0),
    totalTokens: merged.reduce((sum, group) => sum + group.totalTokens, 0),
    knownChars: merged.reduce((sum, group) => sum + group.knownChars, 0),
  }
  return { groups: [...kept, other], hiddenCount: merged.length }
}

/**
 * 词云的显示符号（1.5.3 修「显示星号」）。
 *
 * 真因：旧实现只有 `FORM_GLYPH`（plan/question/imperative/warning/statement 五个 key），
 * 而 `group.key` 在「句式开头 / 语言 / 模型 / Preset」这些维度下是**任意字符串**
 * （如 "I need"、"中文"、"DeepSeek V4"），查不到就落到 `◈` —— 用户看到的就是"星号"。
 *
 * 正确口径：符号只属于 form 维度；其它维度**显示 key 本身**（那是可读文字）。
 */
export function cloudGlyphOf(key: string, dimension: ReasoningDimension): string {
  if (dimension === 'form') return FORM_GLYPH[key] ?? key
  return key
}

/** 句式的图标符号（图标云用；不写文字）。 */
const FORM_GLYPH: Readonly<Record<string, string>> = {
  plan: '◈',
  question: '?',
  imperative: '→',
  warning: '!',
  statement: '·',
}

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

interface Slice {
  group: ReasoningGroup
  rect: Rect
}

/**
 * squarified treemap（确定性：同输入同布局、无随机）。
 *
 * 按字符数降序铺满画布；切成两半递归，每次选择让长宽比更优的切分点。
 * 只输出矩形，不画内容（渲染与布局分离，便于测试）。
 */
export function layoutTreemap(groups: readonly ReasoningGroup[], rect: Rect = { x: 0, y: 0, w: TREEMAP_WIDTH, h: TREEMAP_HEIGHT }): Slice[] {
  const items = groups.filter((group) => group.chars > 0)
  if (items.length === 0) return []
  const total = items.reduce((sum, group) => sum + group.chars, 0)
  if (total <= 0) return []
  if (items.length === 1) return [{ group: items[0], rect }]

  /* 找最接近"面积半分"的切分点：这一步决定长宽比，迭代顺序固定 → 确定性。 */
  let accumulated = 0
  let splitAt = 1
  let bestDiff = Infinity
  for (let index = 0; index < items.length - 1; index += 1) {
    accumulated += items[index].chars
    const diff = Math.abs(accumulated / total - 0.5)
    if (diff < bestDiff) {
      bestDiff = diff
      splitAt = index + 1
    }
  }
  const first = items.slice(0, splitAt)
  const second = items.slice(splitAt)
  const firstTotal = first.reduce((sum, group) => sum + group.chars, 0)
  const ratio = firstTotal / total

  const gap = 2
  if (rect.w >= rect.h) {
    const firstWidth = Math.max(1, Math.round(rect.w * ratio))
    return [
      ...layoutTreemap(first, { x: rect.x, y: rect.y, w: firstWidth - gap, h: rect.h }),
      ...layoutTreemap(second, { x: rect.x + firstWidth, y: rect.y, w: Math.max(1, rect.w - firstWidth - gap), h: rect.h }),
    ]
  }
  const firstHeight = Math.max(1, Math.round(rect.h * ratio))
  return [
    ...layoutTreemap(first, { x: rect.x, y: rect.y, w: rect.w, h: firstHeight - gap }),
    ...layoutTreemap(second, { x: rect.x, y: rect.y + firstHeight, w: rect.w, h: Math.max(1, rect.h - firstHeight - gap) }),
  ]
}

export interface TreemapProps {
  groups: readonly ReasoningGroup[]
  t: Translator
  dimension: ReasoningDimension
  selectedKey: string | null
  onSelect: (key: string) => void
}

export function Treemap(props: TreemapProps): React.ReactElement {
  const slices = layoutTreemap(props.groups)
  const total = props.groups.reduce((sum, group) => sum + group.chars, 0)
  return h(
    'svg',
    {
      className: 'tl-treemap',
      viewBox: '0 0 ' + String(TREEMAP_WIDTH) + ' ' + String(TREEMAP_HEIGHT),
      role: 'group',
      'aria-label': props.t('reasoning.treemap'),
      'data-view': 'treemap',
      preserveAspectRatio: 'xMidYMid meet',
    },
    ...slices.map((slice, index) => {
      const selected = props.selectedKey !== null && props.selectedKey === slice.group.key
      const showName = slice.rect.w > 92 && slice.rect.h > 34
      const showValue = slice.rect.w > 120 && slice.rect.h > 56
      const share = total > 0 ? slice.group.chars / total : 0
      return h(
        'g',
        {
          key: slice.group.key,
          className: 'tl-tree-cell',
          'data-group-key': slice.group.key,
          'data-dimension': props.dimension,
          'data-tone': String((index % 3) + 1),
          'data-selected': selected ? 'true' : 'false',
          role: 'button',
          tabIndex: 0,
          'aria-pressed': selected ? 'true' : 'false',
          'aria-label': slice.group.key + ' · ' + String(slice.group.chars) + ' ' + props.t('reasoning.charsUnit'),
          onClick: () => props.onSelect(slice.group.key),
          onKeyDown: (event: React.KeyboardEvent) => {
            if (event.key !== 'Enter' && event.key !== ' ') return
            event.preventDefault()
            props.onSelect(slice.group.key)
          },
        },
        h('rect', {
          className: 'tl-tree-rect',
          x: slice.rect.x,
          y: slice.rect.y,
          width: slice.rect.w,
          height: slice.rect.h,
          rx: 6,
          ry: 6,
          /* 1.5.3：按组序号取分类色（用户要求"好看的不同的颜色"）。
           * 用**内联 style** 而不是 SVG 的 fill 属性 —— 后者是表现属性，
           * 优先级低于任何 CSS 规则，会被 stylesheet 里的兜底色覆盖
           * （实测：写 fill 属性时 5 个格子全是同一种蓝）。
           * 「其他」固定用最后一个色位，与具体分组区分开。 */
          style: {
            fill: slice.group.key === TREEMAP_OTHER_KEY ? TREEMAP_COLORS[TREEMAP_COLORS.length - 1] : TREEMAP_COLORS[index % TREEMAP_COLORS.length],
          },
        }),
        showName
          ? h(
              'text',
              { className: 'tl-tree-name', x: slice.rect.x + 10, y: slice.rect.y + 22 },
              slice.group.key === TREEMAP_OTHER_KEY ? props.t('reasoning.other') : slice.group.key,
            )
          : null,
        showValue
          ? h(
              'text',
              { className: 'tl-tree-value', x: slice.rect.x + 10, y: slice.rect.y + 40 },
              slice.group.chars + ' · ' + Math.round(share * 100) + '%',
            )
          : null,
        h('title', null, slice.group.key + ' · ' + String(slice.group.chars) + ' ' + props.t('reasoning.charsUnit')),
      )
    }),
  )
}

/**
 * 词云（1.5.4 重做）。
 *
 * 真机反馈两条：「非常丑」「我要的是词云而且要对应的文字显示不是图标」。
 *
 * 旧实现是**方块**（一个圆角按钮里放一个符号或一行字），本质是"气泡图"不是词云：
 * - 视觉上是等大色块，权重差别只体现在方块尺寸，看不出"词"；
 * - 颜色承担"语言"语义，于是同一语言的词全同色，整屏一片。
 *
 * 现在：**文字本身就是图形**——
 * - 字号 ∝ 字符数（对数压缩，避免头尾差 10 倍时小词不可读）；
 * - 不画方块底色，只给文字上低饱和分类色（观感是词云，不是色块矩阵）；
 * - 位置按**螺旋排布**确定性生成（同数据同画面，可截图复现），大词居中、小词外扩；
 * - 全部显示原词（不截断、不换符号），悬停/选中用下划线与加粗表达。
 */
export interface WordCloudProps {
  groups: readonly ReasoningGroup[]
  t: Translator
  /** 维度决定文字口径：form 显示可读标签，其它维度显示 key 本身。 */
  dimension: ReasoningDimension
  selectedKey: string | null
  onSelect: (key: string) => void
}

/** 词云最多显示多少个词（用户要求「显示前 50」）；超出提示已合并。 */
export const CLOUD_MAX_WORDS = 50

/**
 * 螺旋布点的确定性位置（百分比坐标，围绕中心外扩）。
 *
 * 用固定步长的阿基米德螺旋而不是随机/力导向：同输入同画面、截图可比对，
 * 也不需要在渲染后测量文字宽度（那会让首帧跳动）。
 */
function cloudSlot(index: number): { left: number; top: number } {
  if (index === 0) return { left: 50, top: 50 }
  const golden = 2.399963229728653 /* 黄金角，让相邻点自然错开 */
  const angle = index * golden
  const radius = Math.min(46, 7 + 6.2 * Math.sqrt(index))
  return {
    left: 50 + Math.cos(angle) * radius * 1.55,
    top: 50 + Math.sin(angle) * radius,
  }
}

export function WordCloud(props: WordCloudProps): React.ReactElement {
  const sorted = props.groups
    .filter((group) => group.chars > 0 && group.key !== TREEMAP_OTHER_KEY)
    .slice()
    .sort((left, right) => right.chars - left.chars || (left.key < right.key ? -1 : 1))
    .slice(0, CLOUD_MAX_WORDS)
  const max = sorted.length > 0 ? sorted[0].chars : 1
  const min = sorted.length > 0 ? sorted[sorted.length - 1].chars : 1
  /* 对数压缩：最大词与最小词可能差两个数量级，线性映射会让小词全变 9px 不可读。 */
  const weightOf = (chars: number): number => {
    if (max === min) return 0.7
    const lo = Math.log(Math.max(1, min))
    const hi = Math.log(Math.max(2, max))
    return hi === lo ? 0.7 : (Math.log(Math.max(1, chars)) - lo) / (hi - lo)
  }
  return h(
    'div',
    {
      className: 'tl-word-cloud',
      role: 'group',
      'aria-label': props.t('reasoning.cloud'),
      'data-view': 'cloud',
      'data-count': String(sorted.length),
    },
    ...sorted.map((group, index) => {
      const slot = cloudSlot(index)
      const weight = weightOf(group.chars)
      /* 10–40px：足够看出主次，又不至于大词撑爆容器。 */
      const fontSize = Math.round(10 + weight * 30)
      const selected = props.selectedKey !== null && props.selectedKey === group.key
      const text = cloudGlyphOf(group.key, props.dimension)
      const share = Math.round((group.chars / Math.max(1, sorted.reduce((sum, item) => sum + item.chars, 0))) * 1000) / 10
      return h(
        'button',
        {
          key: group.key,
          type: 'button',
          className: 'tl-cloud-word',
          'data-group-key': group.key,
          'data-lang': group.lang,
          'data-glyph': 'text',
          'data-tone': String((index % 8) + 1),
          'data-weight': String(Math.round(weight * 10) / 10),
          'data-selected': selected ? 'true' : 'false',
          'aria-pressed': selected ? 'true' : 'false',
          'aria-label': text + ' · ' + String(group.chars) + ' ' + props.t('reasoning.charsUnit') + ' · ' + String(share) + '%',
          title: text + ' · ' + String(group.chars) + ' ' + props.t('reasoning.charsUnit') + ' · ' + String(share) + '%',
          style: {
            left: slot.left + '%',
            top: slot.top + '%',
            fontSize: fontSize + 'px',
          },
          onClick: () => props.onSelect(group.key),
        },
        text,
      )
    }),
  )
}

/** 列表：一行一个分组（当前维度），带字符/token/占比与主要归属。 */
export interface GroupListProps {
  groups: readonly ReasoningGroup[]
  t: Translator
  sortKey: 'chars' | 'tokens' | 'key'
  sortDir: 1 | -1
  onSort: (key: 'chars' | 'tokens' | 'key') => void
  selectedKey: string | null
  onSelect: (key: string) => void
}

export function GroupList(props: GroupListProps): React.ReactElement {
  const rows = props.groups.slice().sort((left, right) => {
    let result: number
    if (props.sortKey === 'key') result = left.key < right.key ? -1 : left.key > right.key ? 1 : 0
    else if (props.sortKey === 'tokens') result = left.tokens - right.tokens
    else result = left.chars - right.chars
    return result * props.sortDir
  })
  const ariaSort = (key: 'chars' | 'tokens' | 'key'): 'ascending' | 'descending' | undefined => {
    if (props.sortKey !== key) return undefined
    return props.sortDir === 1 ? 'ascending' : 'descending'
  }
  return h(
    'table',
    { className: 'tl-reasoning-table', 'aria-label': props.t('reasoning.list'), 'data-view': 'list' },
    h(
      'thead',
      null,
      h(
        'tr',
        null,
        h('th', { 'aria-sort': ariaSort('key'), onClick: () => props.onSort('key') }, props.t('reasoning.group')),
        h('th', null, props.t('reasoning.lang')),
        h('th', { className: 'tl-num' }, props.t('reasoning.form')),
        h('th', { className: 'tl-num', 'aria-sort': ariaSort('chars'), onClick: () => props.onSort('chars') }, props.t('reasoning.chars')),
        h('th', { className: 'tl-num', 'aria-sort': ariaSort('tokens'), onClick: () => props.onSort('tokens') }, props.t('reasoning.tokens')),
        h('th', { className: 'tl-num' }, props.t('reasoning.ratio')),
      ),
    ),
    h(
      'tbody',
      null,
      ...rows.map((group) => {
        const selected = props.selectedKey !== null && props.selectedKey === group.key
        const ratio = group.totalTokens > 0 ? group.tokens / group.totalTokens : null
        return h(
          'tr',
          {
            key: group.key,
            'data-group-key': group.key,
            'data-selected': selected ? 'true' : 'false',
            tabIndex: 0,
            onClick: () => props.onSelect(group.key),
            onKeyDown: (event: React.KeyboardEvent) => {
              if (event.key !== 'Enter' && event.key !== ' ') return
              event.preventDefault()
              props.onSelect(group.key)
            },
          },
          h('td', { className: 'tl-cell-main' }, group.key),
          h('td', { className: 'tl-muted' }, props.t(langLabelKey(group.lang) as never)),
          h('td', { className: 'tl-num tl-muted' }, String(group.sentences)),
          h('td', { className: 'tl-num' }, String(group.chars)),
          h('td', { className: 'tl-num' }, group.tokens > 0 ? String(group.tokens) : props.t('state.unknown')),
          h('td', { className: 'tl-num' }, ratio === null ? props.t('state.unknown') : Math.round(ratio * 1000) / 10 + '%'),
        )
      }),
    ),
  )
}

/** 句子下钻列表：点开某个句式后，看到具体是哪些句子。 */
export interface SentenceListProps {
  sentences: readonly ReasoningSentence[]
  t: Translator
  emptyText: string
  /** 隐私模式：只显示计数与归属，不渲染正文。 */
  privacy: boolean
}

export function SentenceList(props: SentenceListProps): React.ReactElement {
  if (props.sentences.length === 0) {
    return h('p', { className: 'tl-sentence-empty' }, props.emptyText)
  }
  return h(
    'ol',
    { className: 'tl-sentence-list', 'aria-label': props.t('reasoning.sentences') },
    ...props.sentences.map((sentence, index) =>
      h(
        'li',
        { key: String(index), className: 'tl-sentence', 'data-lang': sentence.lang, 'data-form': sentence.form },
        h(
          'div',
          { className: 'tl-sentence-head' },
          h('span', { className: 'tl-sentence-index' }, '#' + String(index + 1)),
          h('span', { className: 'tl-sentence-chars' }, String(sentence.chars) + ' ' + props.t('reasoning.charsUnit')),
          h('span', { className: 'tl-sentence-form' }, props.t(formLabelKey(sentence.form) as never)),
        ),
        props.privacy
          ? h('p', { className: 'tl-sentence-hidden' }, props.t('privacy.hidden'))
          : h('p', { className: 'tl-sentence-text' }, sentence.text),
        h(
          'div',
          { className: 'tl-sentence-meta' },
          h('span', null, sentence.sessionId.slice(0, 8) + (sentence.turn === null ? '' : ' · T' + String(sentence.turn))),
          sentence.model === null ? null : h('span', null, sentence.model),
          sentence.preset === null ? null : h('span', null, sentence.preset),
        ),
      ),
    ),
  )
}

/** 排行的单行（句首）：字符数 + 条数 + 占比条。 */
export interface RankRowProps {
  group: ReasoningGroup
  rank: number
  maxChars: number
  selected: boolean
  t: Translator
  onClick: () => void
}

export function RankRow(props: RankRowProps): React.ReactElement {
  const width = props.maxChars > 0 ? Math.max(4, Math.round((props.group.chars / props.maxChars) * 100)) : 4
  return h(
    'button',
    {
      type: 'button',
      className: 'tl-rank-row',
      'data-group-key': props.group.key,
      'data-selected': props.selected ? 'true' : 'false',
      'aria-pressed': props.selected ? 'true' : 'false',
      onClick: props.onClick,
    },
    h('span', { className: 'tl-rank-index' }, String(props.rank + 1)),
    h('span', { className: 'tl-rank-name' }, props.group.key === '' ? props.t('reasoning.noPrefix') : props.group.key),
    h('span', { className: 'tl-rank-value' }, String(props.group.chars)),
    h('span', { className: 'tl-rank-track' }, h('span', { className: 'tl-rank-fill', style: { width: width + '%' } })),
  )
}
