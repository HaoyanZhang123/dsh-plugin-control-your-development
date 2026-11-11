/*
 * client/ui/reasoning/ReasoningView.ts —— 「思维链」视图装配（D-35）。
 *
 * 结构（用户拍板的 C 方案 + 句式排行）：
 *   工具栏（五个筛选 + 三视图切换）
 *   KPI 条（字符 / token / 占总 token / 字符占比）
 *   三栏：维度导航 | 主视图（treemap / 图标云 / 列表） | 排行 + 选中详情 + 句子下钻
 *   底部：趋势 + 模型/语言
 *
 * 纪律：
 * - 统计口径全部来自 shared/reasoning（这里不重算）；
 * - 文案全部走 locale（不写死中文）；
 * - 词云不写字（用户明确要求）；句子正文受隐私模式控制；
 * - 选中态用 data-selected + 强调色，不用浏览器默认焦点框。
 */
import * as React from 'react'
import type {
  ReasoningDimension,
  ReasoningGroup,
  ReasoningSample,
  ReasoningSentence,
  ReasoningView as ReasoningViewKind,
  ReasoningTotals,
} from '../../../shared/reasoning/index.ts'
import { countChars } from '../../../shared/reasoning/index.ts'
import { createTranslator, DEFAULT_LOCALE, type Locale, type Translator } from '../../locale/index.ts'
import {
  DEFAULT_FILTER,
  deriveReasoning,
  dimensionLabelKey,
  sentencesByPrefix,
  type ReasoningFilter,
  type ReasoningRecord,
  type ReasoningSessionMeta,
} from './model.ts'
import { GroupList, IconCloud, RankRow, SentenceList, Treemap } from './viz.ts'

const h = React.createElement

/** 维度顺序（导航按钮）。 */
const DIMENSIONS: readonly ReasoningDimension[] = ['prefix', 'form', 'lang', 'model', 'preset']

/** 视图顺序（三选一）。 */
const VIEWS: ReadonlyArray<{ key: ReasoningViewKind; labelKey: string }> = [
  { key: 'treemap', labelKey: 'reasoning.treemap' },
  { key: 'cloud', labelKey: 'reasoning.cloud' },
  { key: 'list', labelKey: 'reasoning.list' },
]

export interface ReasoningViewProps {
  /** 已归约的思维链样本（来自各会话 detail；由入口拼好传入）。 */
  samples: readonly ReasoningSample[]
  /** 会话归档状态（range 筛选用）。 */
  sessions?: Readonly<Record<string, ReasoningSessionMeta>>
  /** 当前会话 id（range === 'session' 时用）。 */
  currentSessionId?: string
  /** 可选：受控初始筛选（测试/宿主用）。 */
  initialFilter?: Partial<ReasoningFilter>
  /** 可选：初始视图（treemap / cloud / list）。 */
  initialView?: ReasoningViewKind
  /** 可选：初始选中（'first' = 选中排第一的句式；或具体分组键）。 */
  initialSelect?: string
  locale?: Locale
  privacy?: boolean
  testId?: string
}

export function ReasoningView(props: ReasoningViewProps): React.ReactElement {
  const locale: Locale = props.locale ?? DEFAULT_LOCALE
  const t: Translator = React.useMemo(() => createTranslator(locale), [locale])
  const [filter, setFilter] = React.useState<ReasoningFilter>({ ...DEFAULT_FILTER, ...(props.initialFilter ?? {}) })
  const [dimension, setDimension] = React.useState<ReasoningDimension>('prefix')
  const [view, setView] = React.useState<ReasoningViewKind>(props.initialView ?? 'treemap')
  /**
   * 初始选中：必须参与**首帧**计算（不能放 useEffect —— SSR 不跑 effect，
   * 会导致"预选状态"在静态渲染里根本不存在）。
   * `first` 以外的值是具体分组键。
   */
  const [selectedKey, setSelectedKey] = React.useState<string | null>(
    props.initialSelect === undefined || props.initialSelect === '' ? null : props.initialSelect,
  )
  const [sortKey, setSortKey] = React.useState<'chars' | 'tokens' | 'key'>('chars')
  const [sortDir, setSortDir] = React.useState<1 | -1>(-1)

  const derived = React.useMemo(
    () =>
      deriveReasoning({
        samples: props.samples,
        filter,
        dimension,
        ...(props.sessions === undefined ? {} : { sessions: props.sessions }),
        ...(props.currentSessionId === undefined ? {} : { currentSessionId: props.currentSessionId }),
      }),
    [props.samples, props.sessions, props.currentSessionId, filter, dimension],
  )

  /** 初始选中：`first` = 排第一的句式（首帧就生效，SSR 安全）；其它值当作具体分组键。 */
  const effectiveSelectedKey: string | null =
    selectedKey === 'first' ? (derived.prefixGroups[0]?.key ?? null) : selectedKey

  /** 选中分组的句子明细（点开后看到"到底有哪些 I need 的句子"）。 */
  const selectedSentences: ReasoningSentence[] = React.useMemo(() => {
    if (effectiveSelectedKey === null) return []
    if (dimension === 'prefix') return sentencesByPrefix(derived.sentences, effectiveSelectedKey)
    return derived.sentences.filter((sentence) => {
      if (dimension === 'form') return sentence.form === effectiveSelectedKey
      if (dimension === 'lang') return sentence.lang === effectiveSelectedKey
      if (dimension === 'model') return (sentence.model ?? 'unknown') === effectiveSelectedKey
      return (sentence.preset ?? 'unknown') === effectiveSelectedKey
    })
  }, [effectiveSelectedKey, dimension, derived.sentences])

  const selectedGroup: ReasoningGroup | null = React.useMemo(() => {
    if (effectiveSelectedKey === null) return null
    for (const group of derived.groups) if (group.key === effectiveSelectedKey) return group
    return null
  }, [effectiveSelectedKey, derived.groups])

  /** 改变维度时清掉选中（旧键在新维度下没有意义，留着会显示"已被排除"）。 */
  const changeDimension = (next: ReasoningDimension): void => {
    setDimension(next)
    setSelectedKey(null)
  }

  /** 排行点击：切到句首维度并选中，语义稳定可预期。 */
  const selectPrefix = (key: string): void => {
    setDimension('prefix')
    setSelectedKey((previous) => (previous === key ? null : key))
  }

  const selectGroup = (key: string): void => {
    setSelectedKey((previous) => (previous === key ? null : key))
  }

  return h(
    'section',
    { className: 'tl-reasoning', 'data-testid': props.testId ?? 'reasoning-view', 'data-view': view, 'data-locale': locale },
    reasoningToolbar(t, filter, setFilter, view, setView),
    kpiStrip(t, derived.totals),
    h(
      'div',
      { className: 'tl-reasoning-grid' },
      dimensionNav(t, dimension, changeDimension),
      h(
        'section',
        { className: 'tl-reasoning-main', 'data-testid': 'reasoning-main' },
        h(
          'div',
          { className: 'tl-reasoning-main-head' },
          h('span', { className: 'tl-reasoning-main-title' }, t(VIEWS.find((item) => item.key === view)?.labelKey as never)),
          h('span', { className: 'tl-badge' }, String(derived.groups.length) + ' ' + t('reasoning.groupsUnit')),
        ),
        view === 'treemap'
          ? h(Treemap, { groups: derived.groups, t, dimension, selectedKey: effectiveSelectedKey, onSelect: selectGroup })
          : view === 'cloud'
            ? h(IconCloud, { groups: derived.groups, t, selectedKey: effectiveSelectedKey, onSelect: selectGroup })
            : h(GroupList, {
                groups: derived.groups,
                t,
                sortKey,
                sortDir,
                onSort: (key) => {
                  if (sortKey === key) setSortDir((previous) => (previous === 1 ? -1 : 1))
                  else {
                    setSortKey(key)
                    setSortDir(key === 'key' ? 1 : -1)
                  }
                },
                selectedKey: effectiveSelectedKey,
                onSelect: selectGroup,
              }),
      ),
      h(
        'aside',
        { className: 'tl-reasoning-side' },
        rankCard(t, derived.prefixGroups, effectiveSelectedKey, dimension, selectPrefix),
        detailCard(t, selectedGroup, selectedSentences, props.privacy === true),
      ),
    ),
  )
}

/* ------------------------------------------------------------------ *
 * 工具栏
 * ------------------------------------------------------------------ */

function selectField(
  t: Translator,
  labelKey: string,
  value: string,
  options: ReadonlyArray<{ value: string; labelKey: string }>,
  onChange: (value: string) => void,
  testId: string,
): React.ReactElement {
  return h(
    'label',
    { className: 'tl-field' },
    h('span', null, t(labelKey as never)),
    h(
      'select',
      {
        value,
        'data-testid': testId,
        onChange: (event: React.ChangeEvent<HTMLSelectElement>) => onChange(event.currentTarget.value),
      },
      ...options.map((option) => h('option', { key: option.value, value: option.value }, t(option.labelKey as never))),
    ),
  )
}

function reasoningToolbar(
  t: Translator,
  filter: ReasoningFilter,
  setFilter: (updater: (previous: ReasoningFilter) => ReasoningFilter) => void,
  view: ReasoningViewKind,
  setView: (next: ReasoningViewKind) => void,
): React.ReactElement {
  const patch = (part: Partial<ReasoningFilter>): void => setFilter((previous) => ({ ...previous, ...part }))
  return h(
    'div',
    { className: 'tl-reasoning-toolbar' },
    h(
      'div',
      { className: 'tl-reasoning-filters' },
      selectField(
        t,
        'reasoning.range',
        filter.range,
        [
          { value: 'workspace', labelKey: 'reasoning.rangeWorkspace' },
          { value: 'active', labelKey: 'reasoning.rangeActive' },
          { value: 'session', labelKey: 'reasoning.rangeSession' },
        ],
        (value) => patch({ range: value as ReasoningFilter['range'] }),
        'reasoning-range',
      ),
      selectField(
        t,
        'reasoning.model',
        filter.model,
        [
          { value: 'all', labelKey: 'reasoning.all' },
          { value: 'DeepSeek V4', labelKey: 'reasoning.all' },
          { value: 'Kimi K3', labelKey: 'reasoning.all' },
          { value: 'other', labelKey: 'reasoning.other' },
        ],
        (value) => patch({ model: value }),
        'reasoning-model',
      ),
      selectField(
        t,
        'reasoning.record',
        filter.record,
        [
          { value: 'committed', labelKey: 'reasoning.recordCommitted' },
          { value: 'all', labelKey: 'reasoning.recordAll' },
        ],
        (value) => patch({ record: value as ReasoningRecord }),
        'reasoning-record',
      ),
    ),
    h(
      'div',
      { className: 'tl-segmented', role: 'tablist', 'aria-label': t('reasoning.views') },
      ...VIEWS.map((item) =>
        h(
          'button',
          {
            key: item.key,
            type: 'button',
            className: 'tl-seg-btn',
            'data-view-key': item.key,
            'aria-pressed': view === item.key ? 'true' : 'false',
            onClick: () => setView(item.key),
          },
          t(item.labelKey as never),
        ),
      ),
    ),
  )
}

/* ------------------------------------------------------------------ *
 * KPI
 * ------------------------------------------------------------------ */

function ratioText(value: number | null): string {
  return value === null ? '—' : Math.round(value * 1000) / 10 + '%'
}

function kpiStrip(t: Translator, totals: ReasoningTotals): React.ReactElement {
  return h(
    'div',
    { className: 'tl-reasoning-kpi', role: 'group', 'aria-label': t('reasoning.summary') },
    kpi(t('reasoning.chars'), String(totals.chars), String(totals.blocks) + ' ' + t('reasoning.blocksUnit')),
    kpi(t('reasoning.tokens'), totals.tokens > 0 ? String(totals.tokens) : t('state.unknown'), t('reasoning.coverage') + ' ' + ratioText(totals.coverage)),
    kpi(t('reasoning.tokenRatio'), ratioText(totals.tokenRatio), 'reasoningTokens / totalTokens'),
    kpi(t('reasoning.charRatio'), ratioText(totals.charRatio), t('reasoning.charRatioHint')),
  )
}

function kpi(label: string, value: string, foot: string): React.ReactElement {
  return h(
    'div',
    { className: 'tl-kpi' },
    h('div', { className: 'tl-kpi-label' }, label),
    h('div', { className: 'tl-kpi-value' }, value),
    h('div', { className: 'tl-kpi-foot' }, foot),
  )
}

/* ------------------------------------------------------------------ *
 * 维度导航
 * ------------------------------------------------------------------ */

function dimensionNav(t: Translator, current: ReasoningDimension, onChange: (next: ReasoningDimension) => void): React.ReactElement {
  return h(
    'nav',
    { className: 'tl-reasoning-nav', 'aria-label': t('reasoning.dimensions') },
    ...DIMENSIONS.map((dimension) =>
      h(
        'button',
        {
          key: dimension,
          type: 'button',
          className: 'tl-nav-btn',
          'data-dim': dimension,
          'aria-pressed': current === dimension ? 'true' : 'false',
          onClick: () => onChange(dimension),
        },
        t(dimensionLabelKey(dimension) as never),
      ),
    ),
  )
}

/* ------------------------------------------------------------------ *
 * 排行 / 详情 / 句子
 * ------------------------------------------------------------------ */

function rankCard(
  t: Translator,
  groups: readonly ReasoningGroup[],
  selectedKey: string | null,
  dimension: ReasoningDimension,
  onSelect: (key: string) => void,
): React.ReactElement {
  const top = groups.slice(0, 8)
  const maxChars = top.length > 0 ? top[0].chars : 0
  return h(
    'section',
    { className: 'tl-card tl-rank-card' },
    h(
      'div',
      { className: 'tl-card-head' },
      h('span', { className: 'tl-card-title' }, t('reasoning.rank')),
      h('span', { className: 'tl-badge' }, String(groups.length)),
    ),
    top.length === 0
      ? h('p', { className: 'tl-sentence-empty' }, t('reasoning.empty'))
      : h(
          'div',
          { className: 'tl-rank-list' },
          ...top.map((group, index) =>
            h(RankRow, {
              key: group.key,
              group,
              rank: index,
              maxChars,
              selected: dimension === 'prefix' && selectedKey === group.key,
              t,
              onClick: () => onSelect(group.key),
            }),
          ),
        ),
  )
}

function detailCard(
  t: Translator,
  group: ReasoningGroup | null,
  sentences: readonly ReasoningSentence[],
  privacy: boolean,
): React.ReactElement {
  if (group === null) {
    return h(
      'section',
      { className: 'tl-card tl-detail-card' },
      h('div', { className: 'tl-card-head' }, h('span', { className: 'tl-card-title' }, t('reasoning.detail'))),
      h('p', { className: 'tl-sentence-empty' }, t('reasoning.selectHint')),
    )
  }
  const tokenRatio = group.totalTokens > 0 ? group.tokens / group.totalTokens : null
  return h(
    'section',
    { className: 'tl-card tl-detail-card' },
    h(
      'div',
      { className: 'tl-card-head' },
      h('span', { className: 'tl-card-title' }, t('reasoning.detail')),
      h('span', { className: 'tl-badge' }, String(sentences.length) + ' ' + t('reasoning.sentencesUnit')),
    ),
    h('div', { className: 'tl-detail-subject' }, group.key === '' ? t('reasoning.noPrefix') : group.key),
    h('div', { className: 'tl-detail-row' }, h('span', null, t('reasoning.chars')), h('strong', null, String(group.chars))),
    h('div', { className: 'tl-detail-row' }, h('span', null, t('reasoning.tokens')), h('strong', null, group.tokens > 0 ? String(group.tokens) : t('state.unknown'))),
    h('div', { className: 'tl-detail-row' }, h('span', null, t('reasoning.tokenRatio')), h('strong', null, ratioText(tokenRatio))),
    h('div', { className: 'tl-detail-row' }, h('span', null, t('reasoning.blocks')), h('strong', null, String(group.blocks))),
    h('div', { className: 'tl-detail-row' }, h('span', null, t('reasoning.lang')), h('strong', null, t(('reasoning.lang' + group.lang.charAt(0).toUpperCase() + group.lang.slice(1)) as never))),
    h(SentenceList, { sentences, t, emptyText: t('reasoning.noSentences'), privacy }),
  )
}
