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
        }),
        showName ? h('text', { className: 'tl-tree-name', x: slice.rect.x + 10, y: slice.rect.y + 22 }, slice.group.key) : null,
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

/** 图标云：方块大小 ∝ 字符数，符号 = 句式类型，颜色 = 语言；**不显示文字**。 */
export interface IconCloudProps {
  groups: readonly ReasoningGroup[]
  t: Translator
  selectedKey: string | null
  onSelect: (key: string) => void
}

/** 固定槽位（确定性；不随机布点，保证同数据同画面）。
 * 每组按数量取**居中**的一圈，避免少数分组时散在四角、中间空一大块。 */
const CLOUD_SLOTS: ReadonlyArray<[number, number]> = [
  [50, 50], [30, 40], [70, 40], [30, 68], [70, 68], [50, 26], [50, 76], [16, 26],
  [84, 26], [16, 74], [84, 74], [40, 20], [60, 20], [40, 82], [60, 82], [50, 12],
  [50, 88], [22, 52],
]

export function IconCloud(props: IconCloudProps): React.ReactElement {
  const sorted = props.groups.slice().sort((left, right) => right.chars - left.chars).slice(0, CLOUD_SLOTS.length)
  const max = sorted.length > 0 ? sorted[0].chars : 1
  const min = sorted.length > 0 ? sorted[sorted.length - 1].chars : 1
  return h(
    'div',
    { className: 'tl-icon-cloud', role: 'group', 'aria-label': props.t('reasoning.cloud'), 'data-view': 'cloud', 'data-count': String(sorted.length) },
    ...sorted.map((group, index) => {
      const slot = CLOUD_SLOTS[index]
      const ratio = max === min ? 1 : (group.chars - min) / (max - min)
      /* 少量分组时整体放大（否则 3 个方块只占中间一小块）。 */
      const base = sorted.length <= 4 ? 76 : 40
      const span = sorted.length <= 4 ? 44 : 52
      const box = Math.round(base + ratio * span)
      const selected = props.selectedKey !== null && props.selectedKey === group.key
      return h(
        'button',
        {
          key: group.key,
          type: 'button',
          className: 'tl-cloud-tile',
          'data-group-key': group.key,
          'data-lang': group.lang,
          'data-selected': selected ? 'true' : 'false',
          'aria-pressed': selected ? 'true' : 'false',
          'aria-label': group.key + ' · ' + String(group.chars) + ' ' + props.t('reasoning.charsUnit'),
          title: group.key + ' · ' + String(group.chars) + ' ' + props.t('reasoning.charsUnit'),
          style: {
            left: slot[0] + '%',
            top: slot[1] + '%',
            width: box + 'px',
            height: box + 'px',
            fontSize: Math.round(box * 0.4) + 'px',
          },
          onClick: () => props.onSelect(group.key),
        },
        h('span', { 'aria-hidden': true }, FORM_GLYPH[group.key] ?? (group.key === '' ? '·' : '◈')),
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
