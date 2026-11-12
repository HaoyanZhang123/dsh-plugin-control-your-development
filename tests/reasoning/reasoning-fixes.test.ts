/*
 * tests/reasoning/reasoning-fixes.test.ts —— 实机验收 4 条缺陷的回归断言（A–F）。
 *
 * 每条都能**区分新旧行为**：先断言"旧形态不存在"，再断言"新形态存在"。
 * 纯 CSS 的用读源文件的方式守（样式是唯一事实源），组件层用 renderToString 守首帧。
 *
 * 覆盖：
 * A. 维度导航任何宽度下都是单列（不存在把 nav 改成 row 的容器规则）
 * B. 树图标签：60×30 有名称、30 宽无名称；长 key 以省略号结尾而不是被硬切
 * C. Listbox 有可见 caption（旧实现只有 aria-label，屏幕上五个按钮全是"全部"）
 * D. KPI 不被 flex 压缩（flex: 0 0 auto + min-block-size: fit-content）
 * E. range === 'session' 时不渲染覆盖率条
 * F. 两个占比口径 + 估算标注 + charRatio 为 null 时不显示假数
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as React from 'react'
import { renderToString } from 'react-dom/server'
import { ReasoningView } from '../../src/client/ui/reasoning/ReasoningView.ts'
import { ellipsizeText, estimateTextWidth } from '../../src/client/ui/reasoning/viz.ts'
import { createTranslator } from '../../src/client/locale/index.ts'
import { DEFAULT_FILTER } from '../../src/client/ui/reasoning/model.ts'
import type { ReasoningSample } from '../../src/shared/reasoning/index.ts'

const CSS = readFileSync(new URL('../../src/client/styles/reasoning.css', import.meta.url), 'utf8')

/** 极简 CSS 规则切分：拿到"选择器 + 规则体 + 所在 at-rule 栈"。 */
interface Rule {
  selector: string
  body: string
  atRules: string[]
}

export function parseRules(css: string): Rule[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const rules: Rule[] = []
  const stack: string[] = []
  let buffer = ''
  for (const char of text) {
    if (char === '{') {
      const head = buffer.trim()
      if (head.startsWith('@')) {
        stack.push(head)
      } else {
        rules.push({ selector: head, body: '', atRules: stack.filter((frame) => frame.startsWith('@')) })
        stack.push('__body__')
      }
      buffer = ''
      continue
    }
    if (char === '}') {
      stack.pop()
      buffer = ''
      continue
    }
    if (stack[stack.length - 1] === '__body__') {
      const current = rules[rules.length - 1]
      if (current !== undefined) current.body += char
      continue
    }
    buffer += char
  }
  return rules
}

const RULES = parseRules(CSS)

function rulesFor(selectorPart: string, bodyPart?: string): Rule[] {
  return RULES.filter((rule) => rule.selector.includes(selectorPart) && (bodyPart === undefined || rule.body.includes(bodyPart)))
}

function sample(patch: Partial<ReasoningSample> = {}): ReasoningSample {
  return {
    text: 'I need to check the tree listing.',
    answerText: 'ok',
    tokens: 100,
    outputTokens: 200,
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
 * 默认筛选范围现在是 `session`（1.5.5），而"当前会话"要由入口传 `currentSessionId`。
 * 夹具里必须一起给，否则样本会被 range=session 全部滤掉 → 页面走空态，
 * 后面的断言就变成"在空页上找不到树图"，看起来像产品缺陷、其实是用例漏了参数。
 */
function render(props: Record<string, unknown> = {}): string {
  return renderToString(
    React.createElement(ReasoningView, { samples: [sample()], locale: 'zh', currentSessionId: 's1', ...props } as never),
  )
}

/* ---------------- A. 维度导航永远单列 ---------------- */

test('A. 导航在任何宽度下都是单列：没有任何容器规则把它改成 row/wrap', () => {
  /* 正向：基础规则是 column。 */
  const base = RULES.filter((rule) => rule.selector.includes('.tl-reasoning-nav') && rule.body.includes('flex-direction'))
  assert.ok(base.length >= 1, '必须存在 .tl-reasoning-nav 的 flex-direction 规则')
  assert.ok(base.some((rule) => /flex-direction:\s*column/.test(rule.body)), '基础规则必须是 flex-direction: column')

  /* 反向：旧实现那两处（<1080 与 <760）曾把它改成 row + wrap。 */
  const overrides = rulesFor('.tl-reasoning-nav', 'flex-direction: row')
  assert.deepEqual(
    overrides.map((rule) => rule.atRules.join(' ')),
    [],
    '不得在任何容器查询里把导航改成 row（旧缺陷 A）：' + overrides.map((rule) => rule.atRules.join(' ')).join(' | '),
  )
  const wraps = rulesFor('.tl-reasoning-nav', 'flex-wrap: wrap')
  assert.deepEqual(wraps.map((rule) => rule.atRules.join(' ')), [], '导航不得允许 wrap（会挤成多列）')
})

/* ---------------- B. 树图标签 ---------------- */

test('B. 省略逻辑：放得下原样、放不下以「…」结尾、极小格返回 null', () => {
  const label = 'I need to verify the whole listing before the scan finishes'
  /* 宽度足够 → 原样。 */
  assert.equal(ellipsizeText(label, 10000, 12), label)
  /* 宽度不足 → 前缀 + …（不能返回中间片段）。 */
  const cut = ellipsizeText(label, 80, 12)
  assert.ok(cut !== null)
  assert.ok(cut.endsWith('…'), '被截断的标签必须以省略号结尾，实际 ' + String(cut))
  assert.ok(label.startsWith(cut.slice(0, -1)), '省略的必须是**尾部**（前缀保留），实际 ' + String(cut))
  assert.ok(estimateTextWidth(cut, 12) <= 80, '省略后的文字不得超出可用宽度')
  /* 连省略号都放不下 → null（调用方不画文字，而不是画一个只剩省略号的点）。 */
  assert.equal(ellipsizeText(label, 2, 12), null)
  assert.equal(ellipsizeText('', 100, 12), null)
})

test('B. 中文与长英文都按可用宽度截断，不靠 clipPath 硬切', () => {
  const zh = ellipsizeText('先检查目录树是否已经返回', 60, 12)
  assert.ok(zh !== null && zh.endsWith('…'), '中文超宽必须省略，实际 ' + String(zh))
  assert.ok(estimateTextWidth(zh, 12) <= 60)
  /* CJK 每字 12px（含安全系数后更宽）：60px 只放得下几个字 + 省略号。 */
  assert.ok([...zh].length <= 5, '60px 下最多 4 个汉字 + 省略号，实际 ' + String(zh))
})

test('B. 省略后的宽度**一定**不超预算（量纲必须统一，否则照样被裁）', () => {
  /*
   * 这条守的是一个真实 bug（第一版实现）：
   * 逐字累加时用**未缩放**字宽、减省略号时用**已缩放**字宽，量纲不一致 →
   * 返回的串仍然超宽（实测「Type0 need…」估 73px、真宽 83px，仍被 clipPath 裁掉）。
   * 现在统一走 estimateTextWidth，任何候选串都必须 <= 预算。
   */
  for (const budget of [20, 40, 56, 63, 70, 90, 120]) {
    for (const text of ['Type0 need', 'Type21 need', 'ExtraordinarilyLongOpeningPhrase', '先检查目录树是否已经返回']) {
      const out = ellipsizeText(text, budget, 12)
      if (out === null) continue
      assert.ok(
        estimateTextWidth(out, 12) <= budget,
        '省略结果超预算：' + JSON.stringify(out) + ' 宽 ' + estimateTextWidth(out, 12).toFixed(1) + ' > ' + String(budget),
      )
    }
  }
})

test('B. 树图渲染：60×30 的格子有名称，30 宽没有名称', () => {
  const wide = render({ initialView: 'treemap', initialSelect: undefined })
  /* 默认单条样本 → 单格铺满整个舞台，必然放得下名称。 */
  assert.match(wide, /class="tl-tree-name"/, '大格必须有名称（旧实现面积大但偏窄时一片空白）')

  /*
   * 窄格：把网格切成很多小块时，部分格子宽度会小于 40px。
   * 这里用纯函数层断言阈值本身（渲染层与它共用同一组阈值常量）。
   */
  const nameRule = /const TREEMAP_NAME_MIN_W = (\d+)/.exec(CSS) ?? /const TREEMAP_NAME_MIN_W = (\d+)/.exec(
    readFileSync(new URL('../../src/client/ui/reasoning/viz.ts', import.meta.url), 'utf8'),
  )
  assert.ok(nameRule !== null)
  assert.equal(Number(nameRule[1]), 40, '名称最小宽度必须是 40（旧值 54 会把 40–54px 的格子整片留白）')
})

test('B. 「其他」格保留完整语义：data-full-label 存原始 key（视觉省略、语义不省略）', () => {
  /* 30 组等量 → 必有「其他」；它的 key 是 NUL 哨兵，不能靠它做可读标签。 */
  const samples = Array.from({ length: 30 }, (_, index) => sample({ text: 'Unique' + String(index) + ' need to check.' }))
  const html = renderToString(
    React.createElement(ReasoningView, { samples, locale: 'zh', currentSessionId: 's1', initialView: 'treemap' } as never),
  )
  assert.match(html, /data-full-label="/, '每个名称都要带完整原始文本，便于悬停/读屏拿到全值')
})

/* ---------------- C. Listbox 可见标签 ---------------- */

test('C. Listbox 渲染可见 caption，文本等于传入的 label', () => {
  const html = render()
  const t = createTranslator('zh')
  /* 六个筛选（range/turn/model/lang/record/preset）每个都要有自己的可见标签。 */
  const captions = [...html.matchAll(/class="tl-listbox-caption"[^>]*>([^<]*)</g)].map((match) => match[1])
  assert.equal(captions.length, 6, '六个筛选都要有可见 caption，实际 ' + String(captions.length) + '：' + captions.join(','))
  for (const expected of [
    t('reasoning.range'),
    t('reasoning.turn'),
    t('reasoning.model'),
    t('reasoning.lang'),
    t('reasoning.record'),
    t('reasoning.preset'),
  ]) {
    assert.ok(captions.includes(expected), '缺少可见标签：' + expected + '（实际 ' + captions.join(',') + '）')
  }
  /* aria-label 仍然保留（读屏语义不退化）。 */
  assert.match(html, /aria-haspopup="listbox"/)
  assert.match(html, /aria-label="[^"]+"/)
})

test('C. caption 的样式挂在 reasoning.css（12px / 三级前景 / 不换行）', () => {
  const rule = RULES.find((item) => item.selector.includes('.tl-listbox-caption'))
  assert.ok(rule !== undefined, '必须有 .tl-listbox-caption 规则')
  assert.match(rule.body, /font-size:\s*var\(--tl-fs-meta\)/, 'caption 字号取 12px 一档')
  assert.match(rule.body, /color:\s*var\(--tl-fg-tertiary\)/)
  assert.match(rule.body, /white-space:\s*nowrap/)
})

test('C. 触发按钮宽度上限提到 260px（190 会把真机模型名整体吃掉）', () => {
  const rule = RULES.find((item) => item.selector.includes('.tl-listbox-btn'))
  assert.ok(rule !== undefined)
  assert.match(rule.body, /max-inline-size:\s*260px/)
})

/* ---------------- D. KPI 不被压缩 ---------------- */

test('D. KPI 条不参与 flex 收缩，且不被压到内容以下', () => {
  const rule = RULES.find((item) => item.selector.includes('.tl-reasoning-kpi') && item.body.includes('grid-template-columns'))
  assert.ok(rule !== undefined)
  assert.match(rule.body, /flex:\s*0 0 auto/, 'KPI 必须 flex: 0 0 auto（旧实现可被压扁 → 数值被裁）')
  assert.match(rule.body, /min-block-size:\s*fit-content/)

  /* 工具行 / 覆盖率条 / 活动筛选行 / 详情带同样不能收缩。 */
  for (const selector of [
    '.tl-reasoning-toolbar',
    '.tl-reasoning-coverage',
    '.tl-reasoning-active-filters',
    '.tl-reasoning-detail',
  ]) {
    const found = RULES.filter((item) => item.selector.includes(selector))
    assert.ok(found.length > 0, '缺规则：' + selector)
    assert.ok(
      found.some((item) => /flex:\s*0 0 auto/.test(item.body)),
      selector + ' 必须 flex: 0 0 auto（否则会被压扁裁字）',
    )
  }
})

test('D. KPI 五格（字符 / token / 占输出 / 占上下文 / 字符占比）', () => {
  const html = render()
  const cells = (html.match(/class="tl-kpi"/g) ?? []).length
  assert.equal(cells, 5, 'KPI 必须五格（旧实现四格，只有一个"占总 token"格），实际 ' + String(cells))
  const t = createTranslator('zh')
  assert.match(html, new RegExp(t('reasoning.contextRatio')), '必须有「占上下文」格')
})

/* ---------------- E. 覆盖率条 ---------------- */

const COVERAGE = { loaded: 5, total: 299, failed: 0, more: true, remaining: 294 }

test('E. range === "session"（默认）时不渲染覆盖率条', () => {
  assert.equal(DEFAULT_FILTER.range, 'session', '默认范围必须是 session（1.5.5）')
  const html = render({ coverage: COVERAGE })
  assert.equal(/data-testid="reasoning-coverage"/.test(html), false, '当前会话范围下不得显示「已加载 5/299」')
})

test('E. range !== "session" 时覆盖率条照常出现（不是被永久删掉）', () => {
  const html = render({ coverage: COVERAGE, initialFilter: { range: 'workspace' } })
  assert.match(html, /data-testid="reasoning-coverage"/, '跨会话范围仍必须显示覆盖率')
  assert.match(html, /已加载 5\/299 个会话/)
})

/* ---------------- F. 两个占比口径 + 估算 ---------------- */

test('F. 表头：「占输出」用 tokenRatio、「占上下文」用 contextRatio，且是两列', () => {
  const html = render({ initialView: 'list' })
  const t = createTranslator('zh')
  assert.ok(html.includes(t('reasoning.tokenRatio')), '缺「占输出」列')
  assert.ok(html.includes(t('reasoning.contextRatio')), '缺「占上下文」列')
  /* 旧实现这两列只有一列叫「占总 token」；现在 ratio 这个 key 不再出现在表头。 */
  assert.equal(html.includes(t('reasoning.ratio')), false, '旧的「占总 token」表头必须被「占输出 / 占上下文」取代')
})

test('F. 组的 token：有 outputTokens 才显示数值，否则未知（不是 0）', () => {
  const withTokens = render({ initialView: 'list' })
  assert.match(withTokens, /data-view="list"/)
  assert.ok(withTokens.includes(String(200)) || withTokens.includes('100'), '有 token 的组必须显示数值')
  assert.match(withTokens, /title="[^"]*估算/, 'token 数值必须标注「估算」')

  /* 一条完全没有 outputTokens 的样本 → 显示未知。 */
  const noTokens = renderToString(
    React.createElement(ReasoningView, {
      samples: [sample({ tokens: undefined, outputTokens: undefined, totalTokens: undefined })],
      locale: 'zh',
      currentSessionId: 's1',
      initialView: 'list',
    } as never),
  )
  assert.ok(noTokens.includes(createTranslator('zh')('state.unknown')), '没有 token 上报时必须显示未知')
})

test('F. charRatio 为 null 时显示「—」，不显示 0% 或 99%', () => {
  /* answerChars === 0 → charRatio 必须是 null（shared 口径）。 */
  const html = render({ samples: [sample({ answerText: '' })] })
  const t = createTranslator('zh')
  assert.match(html, /tl-kpi-value">—</, 'charRatio 未知时必须显示「—」而不是假百分比')
  assert.equal(/tl-kpi-value">0%</.test(html), false, '不得用 0% 冒充未知')
  assert.ok(!/tl-kpi-value">99/.test(html), '不得出现 99% 这种"思维链占满"的假结论')
  assert.ok(html.includes(t('reasoning.charRatio')), '字符占比这一格仍然存在')
})
