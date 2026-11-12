/*
 * client/ui/reasoning/ReasoningView.ts —— 「思维链」视图装配（D-35 / P3）。
 *
 * 结构（用户拍板的 C 方案 + 句式排行）：
 *   覆盖率条（只有入口给了 coverage 才出现）
 *   工具栏（五个筛选 Listbox + 三视图切换）
 *   活动筛选行（有筛选才出现 + 重置）
 *   KPI 条（字符 / token / 占总 token / 字符占比）
 *   三栏：维度导航 | 主视图（treemap / 词云 / 列表，固定高度舞台） | 排行
 *   详情带：选中详情 + 「其他」下钻 + 句子
 *
 * 纪律：
 * - 统计口径全部来自 shared/reasoning 与 model.ts（这里不重算）；
 * - 文案全部走 locale（不写死中文）；
 * - 句子正文受隐私模式控制；选中态用 data-selected + 强调色，不用浏览器默认焦点框。
 *
 * P3 这一版改掉的四件事（根因见各函数注释）：
 * 1. 工具栏的原生 `<select>` → 自研 `Listbox`（选项要带字符量、长模型名要省略但保留 title）；
 * 2. 三视图切换只替换主图内容，且舞台高度固定 —— 切视图不再让页面高度跳动；
 *    退出中的旧视图 `pointer-events: none`，reduced-motion 直接替换；
 * 3. 「其他」可以下钻：点开后详情带列出被合并的分组，可再点进具体组；
 * 4. 空结果能区分「筛选滤空了」与「本来就没有记录」（`sampleCount === 0` +
 *    `activeFilterKeys(filter).length > 0`），并给出逐条重置。
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
import { createTranslator, DEFAULT_LOCALE, type Locale, type Translator } from '../../locale/index.ts'
import {
  activeFilterKeys,
  DEFAULT_FILTER,
  deriveReasoning,
  dimensionLabelKey,
  langLabelKey,
  langOptionsOf,
  modelOptionsOf,
  presetOptionsOf,
  resetFilterKey,
  sentencesByPrefix,
  type FilterKey,
  type ReasoningFilter,
  type ReasoningRecord,
  type ReasoningSessionMeta,
  type ReasoningTurn,
} from './model.ts'
import { formatCount, GroupList, RankRow, SentenceList, TREEMAP_OTHER_KEY, Treemap, WordCloud, collapseTreemapGroups } from './viz.ts'
import { Listbox, type ListboxOption } from './Listbox.ts'

const h = React.createElement

/** 维度顺序（导航按钮）。 */
const DIMENSIONS: readonly ReasoningDimension[] = ['prefix', 'form', 'lang', 'model', 'preset']

/** 视图顺序（三选一）。 */
const VIEWS: ReadonlyArray<{ key: ReasoningViewKind; labelKey: string }> = [
  { key: 'treemap', labelKey: 'reasoning.treemap' },
  { key: 'cloud', labelKey: 'reasoning.cloud' },
  { key: 'list', labelKey: 'reasoning.list' },
]

/** 筛选键 → 标签 key（活动筛选行与下拉的可访问名都用它）。 */
const FILTER_LABEL_KEYS: Readonly<Record<FilterKey, string>> = {
  range: 'reasoning.range',
  turn: 'reasoning.turn',
  model: 'reasoning.model',
  lang: 'reasoning.lang',
  record: 'reasoning.record',
  preset: 'reasoning.preset',
}

/** 视图切换的退出动画时长（与 CSS 的 `--tl-dur-base` 180ms 同刻度，落在 160–200ms 区间）。 */
const VIEW_EXIT_MS = 180

/** 覆盖率（入口给；不给就整条不渲染 —— 没有范围就没有覆盖率可谈）。 */
export interface ReasoningCoverage {
  /** 已加载并成功读到详情的会话数。 */
  loaded: number
  /** 当前范围里的会话总数。 */
  total: number
  /** 读失败的会话数。 */
  failed: number
  /** 是否还有没加载的会话。 */
  more: boolean
  /** 范围内还没加载的会话数（「加载全部」用）。 */
  remaining: number
}

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
  /**
   * 可选：简短提示（如「部分会话读取失败」）。
   * 只在**真有缺损**时由入口传入；不给就不渲染 `data-partial` 区域。
   */
  notice?: string
  /**
   * 可选：覆盖率。`undefined` 时整条不渲染（现有夹具不传也不会炸）；
   * `total === 0` 时同样不渲染（没有范围就没有覆盖率可谈）。
   */
  coverage?: ReasoningCoverage
  /** 「继续加载」：多加载下一批（保留旧图，不闪空态）。 */
  onLoadMore?: () => void
  /** 「加载全部」。 */
  onLoadAll?: () => void
  /** 正在加载更多（按钮禁用 + 保留旧图，不渲染空态）。 */
  loadingMore?: boolean
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
   * 会导致"预选状态"在静态渲染里根本不存在）。`first` 以外的值是具体分组键。
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

  /**
   * 图形视图用的合并结果（P3：**最多 12 格**）。
   *
   * 真机「句式开头」一维有 **23106 组**；900×380 的固定画布能塞 50 格但每格只有 ~60×30px，
   * 12px 标签放不下。现在画布按真实容器尺寸布局，12 格是「每格都放得下 12px 名称」的上限。
   * 列表视图不合并（它本来就能滚完全部，合并反而丢信息）。
   */
  const collapsed = React.useMemo(() => collapseTreemapGroups(derived.groups), [derived.groups])

  /** 「其他」的合成组（只有在真的有组被合并时存在）。 */
  const otherGroup = React.useMemo(
    () => collapsed.groups.find((group) => group.key === TREEMAP_OTHER_KEY) ?? null,
    [collapsed.groups],
  )

  /** 初始选中：`first` = 排第一的句式（首帧就生效，SSR 安全）；其它值当作具体分组键。 */
  const effectiveSelectedKey: string | null =
    selectedKey === 'first' ? (derived.prefixGroups[0]?.key ?? null) : selectedKey

  /** 选中分组的句子明细（点开后看到"到底有哪些 I need 的句子"）。 */
  const selectedSentences: ReasoningSentence[] = React.useMemo(() => {
    if (effectiveSelectedKey === null) return []
    /* 「其他」是合成组：它的句子分散在被合并的组里，逐条列出没有意义（详情带给的是分组列表）。 */
    if (effectiveSelectedKey === TREEMAP_OTHER_KEY) return []
    if (dimension === 'prefix') return sentencesByPrefix(derived.sentences, effectiveSelectedKey)
    return derived.sentences.filter((sentence) => {
      if (dimension === 'form') return sentence.form === effectiveSelectedKey
      if (dimension === 'lang') return sentence.lang === effectiveSelectedKey
      if (dimension === 'model') return (sentence.model ?? 'unknown') === effectiveSelectedKey
      return (sentence.preset ?? 'unknown') === effectiveSelectedKey
    })
  }, [effectiveSelectedKey, dimension, derived.sentences])

  /**
   * 选中分组：P3 修的真机缺陷 —— 「其他」是**合成 key**，旧实现只从 `derived.groups` 里找，
   * 点「其他」永远拿不到详情（`selectedGroup` 恒为 null，详情带显示"点击图形查看句子"）。
   * 现在先认「其他」，再回落到真实分组。
   */
  const selectedGroup: ReasoningGroup | null = React.useMemo(() => {
    if (effectiveSelectedKey === null) return null
    if (effectiveSelectedKey === TREEMAP_OTHER_KEY) return otherGroup
    for (const group of derived.groups) if (group.key === effectiveSelectedKey) return group
    return null
  }, [effectiveSelectedKey, derived.groups, otherGroup])

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

  const clearSelection = (): void => {
    setSelectedKey(null)
  }

  /**
   * 筛选器选项必须**来自真实样本**（1.5.4 修的真机缺陷）。
   *
   * 旧实现在工具栏里把模型写死成 `DeepSeek V4` / `Kimi K3`，而真机 `sample.model`
   * 是 `deepseek/deepseek-v4.1-flash` / `k3` / `k3-256k`——选任何一项都会把样本全滤掉。
   * 现在从样本枚举，下拉里就是真实存在的模型。
   */
  const modelOptions = React.useMemo(() => modelOptionsOf(props.samples), [props.samples])
  const presetOptions = React.useMemo(() => presetOptionsOf(props.samples), [props.samples])

  /**
   * 语言下拉必须从 `derived.allSentences` 枚举（**语言筛选之前**的句子）。
   *
   * 根因：用 `derived.sentences`（已按语言过滤）枚举，选了「中文」之后英语/混合两项
   * 就从下拉里消失 —— 那不是"没有数据"，是控件被自己的选择吃掉了。
   */
  const langOptions = React.useMemo(() => langOptionsOf(derived.allSentences), [derived.allSentences])

  /** 当前筛选里真正生效的条件（活动筛选行 + 空态说明）。 */
  const activeKeys = React.useMemo(() => activeFilterKeys(filter), [filter])

  /**
   * 空结果：区分「筛选滤空了」与「本来就没有记录」。
   *
   * 判定用 `totals.chars === 0`（而不是 `sampleCount === 0`）：语言是**句级**筛选，
   * 选「日语」时样本还在（sampleCount = 全部样本），只是没有一句是日语。
   * `sampleCount === 0` 只说明"样本没了"，它本身不足以回答"是谁滤空的"。
   */
  const empty = derived.totals.chars === 0
  const filteredEmpty = empty && activeKeys.length > 0

  /** 视图切换：退出中的旧视图保留 `VIEW_EXIT_MS`（reduced-motion 时直接替换）。 */
  const reducedMotion = useReducedMotion()
  const leaving = useLeavingView(view, reducedMotion ? 0 : VIEW_EXIT_MS)

  const clearAllFilters = (): void => {
    setFilter({ ...DEFAULT_FILTER })
  }

  const renderView = (kind: ReasoningViewKind): React.ReactElement => {
    if (empty) return emptyState(t, filteredEmpty, activeKeys, filter, clearAllFilters)
    if (kind === 'treemap') {
      return h(Treemap, {
        groups: collapsed.groups,
        t,
        dimension,
        selectedKey: effectiveSelectedKey,
        onSelect: selectGroup,
      })
    }
    if (kind === 'cloud') {
      /*
       * 词云吃**全量分组**，不吃合并后的 12 组。
       *
       * 根因：合并口径（最多 12 格）是给矩形树图定的 —— 每格要放得下 12px 名称。
       * 词云没有"格子"这个概念，它自己的上限是 `CLOUD_MAX_WORDS`（50）+ 放不下计数。
       * 若把它也喂 12 组，词云永远只有 ≤11 个词，「未显示 N 项」永远不会出现 ——
       * 那就等于把"放不下"这个事实静默吞掉了。
       */
      return h(WordCloud, {
        groups: derived.groups,
        t,
        dimension,
        selectedKey: effectiveSelectedKey,
        onSelect: selectGroup,
      })
    }
    return h(GroupList, {
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
      onClear: clearSelection,
    })
  }

  return h(
    'section',
    {
      className: 'tl-reasoning',
      'data-testid': props.testId ?? 'reasoning-view',
      'data-view': view,
      'data-locale': locale,
      ...(empty ? { 'data-empty': 'true' } : {}),
      ...(props.notice === undefined ? {} : { 'data-partial': 'true' }),
    },
    props.notice === undefined
      ? null
      : h('p', { className: 'tl-reasoning-notice', role: 'status', 'data-testid': 'reasoning-notice' }, props.notice),
    /* 缺陷 E：覆盖率条只在**跨会话**范围（不是当前会话）时才有意义 —— 见 coverageBar。 */
    coverageBar(t, props.coverage, filter.range, props.onLoadMore, props.onLoadAll, props.loadingMore === true),
    reasoningToolbar({
      t,
      filter,
      setFilter,
      view,
      setView,
      turnOptions: derived.turnOptions,
      modelOptions,
      langOptions,
      presetOptions,
    }),
    activeFilterRow(t, filter, activeKeys, (key) => setFilter((previous) => resetFilterKey(previous, key)), clearAllFilters),
    kpiStrip(t, derived.totals),
    /*
     * 布局（1.5.4：真机反馈「图在左，排行在右，详情在下」）。
     *
     * 上层 = 维度导航 + [主图 | 排行]；下层 = 详情整宽带。
     * P3：主图放进**固定高度的舞台**（`.tl-reasoning-stage`），因此切视图不会改变页面高度。
     */
    h(
      'div',
      { className: 'tl-reasoning-body' },
      h(
        'div',
        { className: 'tl-reasoning-top' },
        dimensionNav(t, dimension, changeDimension),
        h(
          'div',
          { className: 'tl-reasoning-figure' },
          h(
            'section',
            { className: 'tl-reasoning-main', 'data-testid': 'reasoning-main' },
            h(
              'div',
              { className: 'tl-reasoning-main-head' },
              h('span', { className: 'tl-reasoning-main-title' }, t(labelOfView(view) as never)),
              h('span', { className: 'tl-badge' }, String(derived.groups.length) + ' ' + t('reasoning.groupsUnit')),
              /* 合并提示必须可见 —— 矩形树图看的是 Top12 + 其他，必须知道"还有多少没画"。
               * 列表与词云不合并（列表滚完全部；词云自己按 50 + 「未显示」计数），
               * 所以只在 treemap 视图下给这条提示 —— 否则那两个视图会声称一件没发生的事。 */
              view !== 'treemap' || collapsed.hiddenCount === 0
                ? null
                : h(
                    'span',
                    { className: 'tl-badge tl-reasoning-collapsed', 'data-testid': 'reasoning-collapsed' },
                    t('reasoning.collapsed', { n: String(collapsed.hiddenCount) }),
                  ),
            ),
            h(
              'div',
              { className: 'tl-reasoning-stage', 'data-view': view },
              leaving === null || empty
                ? null
                : h(
                    'div',
                    {
                      key: 'leaving-' + leaving,
                      className: 'tl-reasoning-view tl-reasoning-view-leaving',
                      'data-view': leaving,
                      'aria-hidden': 'true',
                    },
                    renderView(leaving),
                  ),
              h(
                'div',
                {
                  key: 'live-' + view,
                  className: 'tl-reasoning-view tl-reasoning-view-entering',
                  'data-view': view,
                },
                renderView(view),
              ),
            ),
          ),
        ),
        h(
          'aside',
          { className: 'tl-reasoning-side', 'data-testid': 'reasoning-side' },
          rankCard(t, derived.prefixGroups, effectiveSelectedKey, dimension, selectPrefix),
        ),
      ),
      h(
        'div',
        { className: 'tl-reasoning-detail', 'data-testid': 'reasoning-detail' },
        detailCard(t, selectedGroup, selectedSentences, props.privacy === true, {
          merged: collapsed.merged,
          onSelect: selectGroup,
          isOther: effectiveSelectedKey === TREEMAP_OTHER_KEY,
        }),
      ),
    ),
  )
}

/* ------------------------------------------------------------------ *
 * 视图切换：退出延迟与 reduced-motion
 * ------------------------------------------------------------------ */

/** 系统是否要求 reduced-motion（SSR 首帧为 false，effect 后跟随系统）。 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = React.useState(false)
  React.useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = (): void => setReduced(query.matches)
    sync()
    query.addEventListener('change', sync)
    return () => query.removeEventListener('change', sync)
  }, [])
  return reduced
}

/**
 * 记住"上一个视图"并在 `delay` 毫秒内让它继续渲染（退出动画期间 `pointer-events: none`）。
 * `delay === 0`（reduced-motion）时不保留旧视图 —— 直接替换。
 */
export function useLeavingView(view: ReasoningViewKind, delay: number): ReasoningViewKind | null {
  const [leaving, setLeaving] = React.useState<ReasoningViewKind | null>(null)
  const previous = React.useRef(view)
  React.useEffect(() => {
    if (previous.current === view) return undefined
    const from = previous.current
    previous.current = view
    if (delay <= 0) {
      setLeaving(null)
      return undefined
    }
    setLeaving(from)
    const timer = setTimeout(() => setLeaving(null), delay)
    return () => clearTimeout(timer)
  }, [view, delay])
  return leaving
}

function labelOfView(view: ReasoningViewKind): string {
  return VIEWS.find((item) => item.key === view)?.labelKey ?? 'reasoning.treemap'
}

/* ------------------------------------------------------------------ *
 * 覆盖率条（入口给了 coverage 才出现）
 * ------------------------------------------------------------------ */

function coverageBar(
  t: Translator,
  coverage: ReasoningCoverage | undefined,
  range: ReasoningFilter['range'],
  onLoadMore: (() => void) | undefined,
  onLoadAll: (() => void) | undefined,
  loadingMore: boolean,
): React.ReactElement | null {
  /*
   * 缺陷 E：**当前会话范围下不渲染覆盖率条**。
   *
   * 根因：`DEFAULT_FILTER.range` 改成 `'session'` 之后，覆盖率条仍按"工作区里加载了几个会话"
   * 显示，于是默认页面顶上挂着「已加载 5/299 个会话」—— 而用户看的是**这一个对话**，
   * 299 这个分母与他毫无关系，属于"用一个不相干的数字冒充完备性"。
   *
   * 当前会话是完备的（它不需要"加载更多"），所以这一条在 range === 'session' 时整条不渲染。
   * 另外沿用原口径：`coverage === undefined`（入口没给）与 `total === 0`（范围里没有会话）也不渲染。
   */
  if (coverage === undefined || coverage.total === 0 || range === 'session') return null
  return h(
    'div',
    {
      className: 'tl-reasoning-coverage',
      role: 'group',
      'aria-label': t('reasoning.coverage'),
      'data-testid': 'reasoning-coverage',
      'data-more': coverage.more ? 'true' : 'false',
    },
    h(
      'span',
      { className: 'tl-cov-text' },
      t('reasoning.coverageLoaded', { loaded: coverage.loaded, total: coverage.total }),
    ),
    coverage.failed > 0
      ? h('span', { className: 'tl-cov-failed' }, t('reasoning.coverageFailed', { failed: coverage.failed }))
      : null,
    loadingMore
      ? h('span', { className: 'tl-cov-loading', role: 'status' }, t('reasoning.loadingMore'))
      : null,
    coverage.more
      ? h(
          'span',
          { className: 'tl-cov-actions' },
          h(
            'button',
            {
              type: 'button',
              className: 'tl-cov-btn',
              disabled: loadingMore,
              'data-testid': 'reasoning-load-more',
              onClick: onLoadMore,
            },
            t('reasoning.loadMore'),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'tl-cov-btn',
              disabled: loadingMore,
              'data-testid': 'reasoning-load-all',
              onClick: onLoadAll,
            },
            t('reasoning.loadAll'),
          ),
        )
      : null,
  )
}

/* ------------------------------------------------------------------ *
 * 工具栏（五个筛选 Listbox + 视图切换）
 * ------------------------------------------------------------------ */

interface ToolbarProps {
  t: Translator
  filter: ReasoningFilter
  setFilter: (updater: (previous: ReasoningFilter) => ReasoningFilter) => void
  view: ReasoningViewKind
  setView: (next: ReasoningViewKind) => void
  /** 可选轮次（来自 model.ts 的 derived.turnOptions；只列真有 reasoning 样本的轮次）。 */
  turnOptions: ReadonlyArray<{ value: ReasoningTurn; label: string }>
  modelOptions: ReadonlyArray<{ value: string; chars: number; count: number }>
  langOptions: ReadonlyArray<{ value: string; chars: number; count: number }>
  presetOptions: ReadonlyArray<{ value: string; chars: number; count: number }>
}

function reasoningToolbar(props: ToolbarProps): React.ReactElement {
  const { t, filter, setFilter, view, setView } = props
  const patch = (part: Partial<ReasoningFilter>): void => setFilter((previous) => ({ ...previous, ...part }))

  const allOption: ListboxOption = { value: 'all', label: t('reasoning.all') }

  /*
   * 轮次选项（1.5.5）：**复用 derived.turnOptions 的 value**，label 用 turnLabelOf 重新翻。
   *
   * 为什么不直接用 derived.turnOptions 的 label：那里是 model.ts 给的原始串
   * （'all' / 'T1' / 'unknown'），'all' 与 'unknown' 必须走 locale；
   * 数字那部分两边写法一致（都是 T{n}）。只翻一遍，不造第二套轮次命名。
   */
  const turnListOptions: ListboxOption[] = props.turnOptions.map((option) => ({
    value: option.value,
    label: turnLabelOf(t, option.value),
  }))

  return h(
    'div',
    { className: 'tl-reasoning-toolbar' },
    h(
      'div',
      { className: 'tl-reasoning-filters' },
      h(Listbox, {
        t,
        label: t('reasoning.range'),
        value: filter.range,
        testId: 'reasoning-range',
        options: [
          { value: 'workspace', label: t('reasoning.rangeWorkspace') },
          { value: 'active', label: t('reasoning.rangeActive') },
          { value: 'session', label: t('reasoning.rangeSession') },
        ],
        onChange: (value) => patch({ range: String(value) as ReasoningFilter['range'] }),
      }),
      /* 轮次：紧跟范围（两者正交：range 决定看哪些会话，turn 决定看哪些轮）。 */
      h(Listbox, {
        t,
        label: t('reasoning.turn'),
        value: filter.turn,
        testId: 'reasoning-turn',
        options: turnListOptions,
        onChange: (value) => patch({ turn: value as ReasoningTurn }),
      }),
      h(Listbox, {
        t,
        label: t('reasoning.model'),
        value: filter.model,
        testId: 'reasoning-model',
        options: [allOption, ...props.modelOptions.map(optionOf(t, 'model'))],
        onChange: (value) => patch({ model: String(value) }),
      }),
      h(Listbox, {
        t,
        label: t('reasoning.lang'),
        value: filter.lang,
        testId: 'reasoning-lang',
        options: [allOption, ...props.langOptions.map(optionOf(t, 'lang'))],
        onChange: (value) => patch({ lang: String(value) }),
      }),
      h(Listbox, {
        t,
        label: t('reasoning.record'),
        value: filter.record,
        testId: 'reasoning-record',
        options: [
          { value: 'committed', label: t('reasoning.recordCommitted') },
          { value: 'all', label: t('reasoning.recordAll') },
        ],
        onChange: (value) => patch({ record: String(value) as ReasoningRecord }),
      }),
      h(Listbox, {
        t,
        label: t('reasoning.preset'),
        value: filter.preset,
        testId: 'reasoning-preset',
        options: [allOption, ...props.presetOptions.map(optionOf(t, 'preset'))],
        onChange: (value) => patch({ preset: String(value) }),
      }),
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

/**
 * 选项枚举 → Listbox 选项。
 *
 * 语言用 `langLabelKey` 翻成可读标签（值是 `zh`/`en`…），模型/preset 是宿主原值，
 * 模型名去掉冗余 provider 前缀后显示，**字符量放在 meta 里**（便于判断主次）。
 */
function optionOf(
  t: Translator,
  kind: 'model' | 'lang' | 'preset',
): (option: { value: string; chars: number; count: number }) => ListboxOption {
  return (option) => {
    const labelKey = kind === 'lang' ? langLabelKeyOf(option.value) : null
    const label = kind === 'model' ? modelLabel(option.value) : labelKey === null ? option.value : t(labelKey as never)
    return { value: option.value, label, meta: compactChars(option.chars) }
  }
}

/** 语言值 → 标签 key（未知值返回 null，调用方原样显示，不发明文案）。 */
function langLabelKeyOf(value: string): string | null {
  switch (value) {
    case 'zh':
    case 'en':
    case 'ja':
    case 'ko':
    case 'mixed':
    case 'unknown':
      return langLabelKey(value)
    default:
      return null
  }
}

/** 语言值 → 可读标签（已知语言走 locale，未知原样显示，不发明）。 */
function langLabel(t: Translator, value: string): string {
  const key = langLabelKeyOf(value)
  return key === null ? value : t(key as never)
}

/**
 * 模型名的可读标签：真机值是 `provider/model` 形态（如 `deepseek/deepseek-v4.1-flash`）。
 * 只去掉冗余的重复前缀，不发明"友好名"——否则又是"显示与数据不一致"。
 */
function modelLabel(value: string): string {
  const slash = value.indexOf('/')
  if (slash <= 0 || slash >= value.length - 1) return value
  const tail = value.slice(slash + 1)
  return tail.startsWith('deepseek-') || tail === value.slice(0, slash) ? tail : value
}

/** 字符量的紧凑表示（12.3k / 4.5M），只用于下拉标签，不参与计算。 */
function compactChars(chars: number): string {
  if (chars >= 1_000_000) return Math.round(chars / 100_000) / 10 + 'M'
  if (chars >= 1_000) return Math.round(chars / 100) / 10 + 'k'
  return String(chars)
}

/* ------------------------------------------------------------------ *
 * 活动筛选行（只有筛选才出现；每项可单独重置）
 * ------------------------------------------------------------------ */

/**
 * 轮次值 → 可读标签。
 *
 * `'all'` = 全部轮次；数字 = 具体轮次（T1、T2…，与排行侧的 `· T{n}` 同一写法）；
 * `'unknown'` = 归属未知（provider 没给 turn 的那批），走 locale 而不是裸显示英文。
 */
function turnLabelOf(t: Translator, value: ReasoningTurn): string {
  if (value === 'all') return t('reasoning.all')
  if (value === 'unknown') return t('reasoning.turnUnknown')
  return 'T' + String(value)
}

function filterValueText(t: Translator, filter: ReasoningFilter, key: FilterKey): string {
  const value = filter[key]
  switch (key) {
    case 'range':
      return value === 'active'
        ? t('reasoning.rangeActive')
        : value === 'session'
          ? t('reasoning.rangeSession')
          : t('reasoning.rangeWorkspace')
    case 'turn':
      return turnLabelOf(t, value as ReasoningTurn)
    case 'record':
      return value === 'all' ? t('reasoning.recordAll') : t('reasoning.recordCommitted')
    case 'lang':
      return langLabel(t, String(value))
    case 'model':
      return modelLabel(String(value))
    case 'preset':
      return String(value)
  }
}

function activeFilterRow(
  t: Translator,
  filter: ReasoningFilter,
  keys: readonly FilterKey[],
  reset: (key: FilterKey) => void,
  resetAll: () => void,
): React.ReactElement | null {
  if (keys.length === 0) return null
  return h(
    'div',
    { className: 'tl-reasoning-active-filters', role: 'group', 'aria-label': t('reasoning.activeFilters'), 'data-testid': 'reasoning-active-filters' },
    h('span', { className: 'tl-af-label' }, t('reasoning.activeFilters')),
    ...keys.map((key) =>
      h(
        'button',
        {
          key,
          type: 'button',
          className: 'tl-af-chip',
          'data-filter-key': key,
          title: t('reasoning.resetFilters') + ' · ' + t(FILTER_LABEL_KEYS[key] as never),
          onClick: () => reset(key),
        },
        h('span', { className: 'tl-af-chip-name' }, t(FILTER_LABEL_KEYS[key] as never)),
        h('span', { className: 'tl-af-chip-value' }, filterValueText(t, filter, key)),
        h('span', { className: 'tl-af-chip-x', 'aria-hidden': 'true' }, '×'),
      ),
    ),
    h('button', { type: 'button', className: 'tl-af-reset', onClick: resetAll }, t('reasoning.resetFilters')),
  )
}

/* ------------------------------------------------------------------ *
 * 空态（区分「筛选滤空了」与「本来就没有记录」）
 * ------------------------------------------------------------------ */

function emptyState(
  t: Translator,
  filtered: boolean,
  keys: readonly FilterKey[],
  filter: ReasoningFilter,
  resetAll: () => void,
): React.ReactElement {
  if (!filtered) {
    return h(
      'div',
      { className: 'tl-reasoning-empty-inline', role: 'status', 'data-testid': 'reasoning-empty' },
      h('p', { className: 'tl-reasoning-empty-title' }, t('reasoning.none')),
    )
  }
  const conditions = keys.map((key) => t(FILTER_LABEL_KEYS[key] as never) + '=' + filterValueText(t, filter, key)).join(' · ')
  return h(
    'div',
    { className: 'tl-reasoning-empty-inline', role: 'status', 'data-testid': 'reasoning-empty' },
    h('p', { className: 'tl-reasoning-empty-title' }, t('reasoning.filteredEmpty', { conditions })),
    h('button', { type: 'button', className: 'tl-more-btn', onClick: resetAll }, t('reasoning.resetFilters')),
  )
}

/* ------------------------------------------------------------------ *
 * KPI
 * ------------------------------------------------------------------ */

function ratioText(value: number | null): string {
  /* null 一律「—」：`charRatio` 在 answerChars === 0 时是 null（不再给 99.2% 这种假数）。 */
  return value === null ? '—' : Math.round(value * 1000) / 10 + '%'
}

function kpiStrip(t: Translator, totals: ReasoningTotals): React.ReactElement {
  return h(
    'div',
    { className: 'tl-reasoning-kpi', role: 'group', 'aria-label': t('reasoning.summary') },
    kpi(t('reasoning.chars'), String(totals.chars), String(totals.blocks) + ' ' + t('reasoning.blocksUnit')),
    kpi(t('reasoning.tokens'), totals.tokens > 0 ? String(totals.tokens) : t('state.unknown'), t('reasoning.coverage') + ' ' + ratioText(totals.coverage)),
    /*
     * 「占输出」与「占上下文」是两个口径，必须各占一格（1.5.5）。
     *
     * 旧实现只有一格，分母是 totalTokens（含输入与缓存）→ 实测中位数 0.13%，
     * 被稀释到没有信息量。现在 tokenRatio = tokens / outputTokens（思维链在**输出**里的占比，
     * 同批样本中位数 58.2%），contextRatio 才是旧的上下文口径，如实展示、不冒充。
     */
    kpi(t('reasoning.tokenRatio'), ratioText(totals.tokenRatio), 'reasoningTokens / outputTokens'),
    kpi(t('reasoning.contextRatio'), ratioText(totals.contextRatio), 'reasoningTokens / totalTokens'),
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

interface DetailOptions {
  merged: readonly ReasoningGroup[]
  onSelect: (key: string) => void
  isOther: boolean
}

function detailCard(
  t: Translator,
  group: ReasoningGroup | null,
  sentences: readonly ReasoningSentence[],
  privacy: boolean,
  options: DetailOptions,
): React.ReactElement {
  if (group === null) {
    return h(
      'section',
      { className: 'tl-card tl-detail-card' },
      h('div', { className: 'tl-card-head' }, h('span', { className: 'tl-card-title' }, t('reasoning.detail'))),
      h('p', { className: 'tl-sentence-empty' }, t('reasoning.selectHint')),
    )
  }
  /*
   * 组级两个占比（1.5.5，与列表同口径）：
   * - 占输出 = tokens / outputTokens；
   * - 占上下文 = tokens / totalTokens。
   * 分母为 0 时是 null → 显示「—」，不显示 0%。
   */
  const outputRatio = group.outputTokens > 0 ? group.tokens / group.outputTokens : null
  const contextRatio = group.totalTokens > 0 ? group.tokens / group.totalTokens : null
  /* 组的 tokens 是**按字符比例分配**的估算值：有 outputTokens 才有数，title 里标注「估算」。 */
  const hasTokens = group.outputTokens > 0
  return h(
    'section',
    { className: 'tl-card tl-detail-card', 'data-other': options.isOther ? 'true' : 'false' },
    h(
      'div',
      { className: 'tl-card-head' },
      h('span', { className: 'tl-card-title' }, t('reasoning.detail')),
      h('span', { className: 'tl-badge' }, String(sentences.length) + ' ' + t('reasoning.sentencesUnit')),
    ),
    h(
      'div',
      { className: 'tl-detail-subject' },
      group.key === '' ? t('reasoning.noPrefix') : options.isOther ? t('reasoning.other') : group.key,
    ),
    h('div', { className: 'tl-detail-row' }, h('span', null, t('reasoning.chars')), h('strong', null, formatCount(group.chars))),
    h(
      'div',
      { className: 'tl-detail-row' },
      h('span', null, t('reasoning.tokens')),
      h(
        'strong',
        { title: hasTokens ? t('reasoning.estimated') : t('state.unknown') },
        hasTokens ? formatCount(group.tokens) : t('state.unknown'),
      ),
      hasTokens ? h('span', { className: 'tl-detail-estimated' }, t('reasoning.estimated')) : null,
    ),
    h('div', { className: 'tl-detail-row' }, h('span', null, t('reasoning.tokenRatio')), h('strong', null, ratioText(outputRatio))),
    h('div', { className: 'tl-detail-row' }, h('span', null, t('reasoning.contextRatio')), h('strong', null, ratioText(contextRatio))),
    h('div', { className: 'tl-detail-row' }, h('span', null, t('reasoning.blocks')), h('strong', null, formatCount(group.blocks))),
    h(
      'div',
      { className: 'tl-detail-row' },
      h('span', null, t('reasoning.lang')),
      h('strong', null, t(langLabelKey(group.lang) as never)),
    ),
    /*
     * 「其他」下钻（P3 第 5 条根因）：旧实现里点「其他」拿不到任何详情。
     * 现在把被合并的分组**列出来**，每条都能再点进具体分组。
     */
    options.isOther
      ? h(
          'div',
          { className: 'tl-detail-other', 'data-testid': 'reasoning-other-list' },
          h('p', { className: 'tl-detail-other-title' }, t('reasoning.otherDrill', { n: String(options.merged.length) })),
          h('p', { className: 'tl-detail-other-sub' }, t('reasoning.otherList')),
          h(
            'ul',
            { className: 'tl-other-list', 'aria-label': t('reasoning.otherList') },
            ...options.merged.map((merged) =>
              h(
                'li',
                { key: merged.key },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'tl-other-item',
                    'data-group-key': merged.key,
                    onClick: () => options.onSelect(merged.key),
                  },
                  h('span', { className: 'tl-other-name', title: merged.key }, merged.key === '' ? t('reasoning.noPrefix') : merged.key),
                  h('span', { className: 'tl-other-chars' }, formatCount(merged.chars)),
                ),
              ),
            ),
          ),
        )
      : h(SentenceList, { sentences, t, emptyText: t('reasoning.noSentences'), privacy }),
  )
}
