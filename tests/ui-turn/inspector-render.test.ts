/*
 * tests/ui-turn/inspector-render.test.ts —— 三种检查器 + 轮次带的**渲染结构**断言
 * （03 §8 / §12；06 A42-2 / A42-3 / A42-4）。
 *
 * 用 react-dom/server 的静态标记（与 tests/ui-shell 同一条路径）：
 * - 字段标签真的出现在 DOM 里（模型有字段但没渲染 = 缺项）；
 * - 正文**默认折叠**（用户消息不出现），隐私模式下出现「内容已隐藏」；
 * - 未确认引用 / 外部来源 / 关系证据都可见；
 * - 轮次带 30 块、四种状态、tooltip 含全部计数、「本轮仍在记录」只出现在运行轮。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createTranslator } from '../../src/client/locale/index.ts'
import { Inspector } from '../../src/client/ui/inspector/index.ts'
import type { InspectorActions } from '../../src/client/ui/inspector/index.ts'
import { TurnStrip } from '../../src/client/ui/turns/index.ts'
import { buildTurnGroups, select } from '../../src/client/ui/turns/index.ts'
import { buildInspectorData, buildSessionDetail, buildSummaries, fixtureNow } from './fixtures.ts'

const h = React.createElement
const t = createTranslator('zh')
const data = buildInspectorData()
const now = fixtureNow()
const actions: InspectorActions = {
  onSelectFile: () => undefined,
  onSelectTurn: () => undefined,
  onSelectSession: () => undefined,
  onOpenFile: () => undefined,
  onOpenSession: () => undefined,
  onFocusInMap: () => undefined,
  onOpenModal: () => undefined,
  onClose: () => undefined,
  onRetry: () => undefined,
}

function renderInspector(selection: Parameters<typeof Inspector>[0]['selection'], extra: Record<string, unknown> = {}): string {
  return renderToStaticMarkup(h(Inspector, { t, data, selection, now, actions, ...extra }))
}

const FILE = 'src/client/data/merge.ts'

/* ---------------- 文件检查器 ---------------- */

test('文件检查器渲染：标题 / 概览 / 操作统计 / 触碰历史 / 关系 / 未确认 / 外部 / 动作', () => {
  const html = renderInspector({ kind: 'file', path: FILE })
  for (const piece of [
    'merge.ts',
    'src/client/data/merge.ts',
    '代码',
    '首次出现',
    '最近触碰',
    '操作',
    '≈ 增删行（按工具参数估算）',
    '触碰历史',
    '关系',
    '证据',
    '未确认引用',
    '外部来源',
    '打开文件',
    '关闭',
  ]) {
    assert.ok(html.includes(piece), '文件检查器缺内容：' + piece)
  }
  assert.ok(html.includes('data-inspector-kind="file"'))
  assert.ok(!html.includes('undefined'), '渲染里出现了 undefined')
  assert.ok(!html.includes('NaN'), '渲染里出现了 NaN')
})

test('文件检查器渲染：关系证据逐条可见、未确认引用给路径+行号+原因、外部来源只读', () => {
  const html = renderInspector({ kind: 'file', path: FILE })
  assert.ok(html.includes('同属目录 src/client/data'), '结构边证据缺失')
  assert.ok(html.includes('中同时出现'), '共现边证据缺失')
  assert.ok(html.includes('引用'), '引用边证据缺失')
  assert.ok(html.includes('解析所得') || html.includes('未确认引用'), '未确认引用说明缺失')
  assert.ok(html.includes('src/client/data/legacy-view-model.json'))
  assert.ok(html.includes('L3'), '未确认引用缺行号')
  assert.ok(html.includes('文件不存在'), '未确认引用缺原因')
  assert.ok(html.includes('https://example.invalid/read-model'), '外部来源 URL 缺失')
  // 未确认引用不画边：关系区里没有它的对端
  const relationZone = html.slice(html.indexOf('data-testid="file-relations"'), html.indexOf('data-testid="file-unconfirmed"'))
  assert.ok(!relationZone.includes('legacy-view-model.json'), '未确认引用不得出现在关系区（不画边）')
})

test('文件检查器渲染：动作三件套是只读回调（打开文件 / 在图中聚焦 / 关闭）', () => {
  const html = renderInspector({ kind: 'file', path: FILE })
  assert.ok(html.includes('data-testid="file-actions"'))
  for (const label of ['打开文件', '在图中聚焦', '关闭']) {
    assert.ok(html.includes(label), '缺动作 ' + label)
  }
  assert.ok(!/download|导出|保存|应用/.test(html), '不得出现写/导出类动作')
})

test('文件检查器渲染：隐私模式下目录消失、外部来源只留域名', () => {
  const html = renderInspector({ kind: 'file', path: FILE }, { privacyMode: true })
  assert.ok(!html.includes('src/client/data/merge.ts'), '隐私模式不得出现完整路径')
  assert.ok(html.includes('merge.ts'))
  assert.ok(html.includes('example.invalid'))
  assert.ok(!html.includes('https://example.invalid/read-model'), '隐私模式不得出现完整 URL')
})

/* ---------------- 轮次检查器 ---------------- */

test('轮次检查器渲染：T30 全部字段 + 「本轮仍在记录」', () => {
  const html = renderInspector({ kind: 'turn', sessionId: 'sess-alpha', turn: 30 })
  for (const piece of [
    'T30',
    '执行中',
    '本轮仍在记录',
    '用户意图',
    '工具',
    '命令',
    '子智能体',
    '计划',
    '错误',
    '后续触碰',
    '与上一轮对比',
    '新增',
    '复用',
    '在图中聚焦',
    '打开会话',
    '打开本次对话脉络',
  ]) {
    assert.ok(html.includes(piece), '轮次检查器缺内容：' + piece)
  }
  assert.ok(html.includes('data-inspector-kind="turn"'))
  assert.ok(!html.includes('undefined'), '渲染里出现了 undefined')
})

test('轮次检查器渲染：正文默认折叠（正文块不挂载，只有一行摘要）', () => {
  const html = renderInspector({ kind: 'turn', sessionId: 'sess-alpha', turn: 30 })
  assert.ok(!html.includes('threadline-inspector-body-text'), '默认折叠时正文块不得出现在 DOM 里')
  assert.ok(html.includes('aria-expanded="false"'), '折叠入口必须带 aria-expanded=false')
  // 长正文：折叠摘要被截断，全文不出现
  const longText = '这一段是很长的用户消息，用来验证折叠态只给摘要、不给全文。'.repeat(3)
  const longData = {
    ...data,
    details: new Map([
      [
        'sess-alpha',
        {
          ...buildSessionDetail(),
          turns: buildSessionDetail().turns.map((turn) => (turn.n === 30 ? { ...turn, userText: longText } : turn)),
        },
      ],
    ]),
  }
  const longHtml = renderToStaticMarkup(
    h(Inspector, { t, data: longData, selection: { kind: 'turn', sessionId: 'sess-alpha', turn: 30 } as never, now, actions }),
  )
  assert.ok(!longHtml.includes(longText), '折叠态不得出现正文全文')
  assert.ok(longHtml.includes('…'), '摘要必须显式截断')
})

test('轮次检查器渲染：隐私模式下正文入口消失、显示「内容已隐藏」', () => {
  const html = renderInspector({ kind: 'turn', sessionId: 'sess-alpha', turn: 30 }, { privacyMode: true })
  assert.ok(html.includes('内容已隐藏'))
  assert.ok(!html.includes('把字段核对表补上'), '隐私模式不得出现用户消息')
  assert.ok(!html.includes('aria-expanded="false"'), '隐私模式不应再有正文折叠入口')
})

test('轮次检查器渲染：中止/未知/完成的状态文案不同（颜色不是唯一信息）', () => {
  const aborted = renderInspector({ kind: 'turn', sessionId: 'sess-alpha', turn: 28 })
  assert.ok(aborted.includes('已中断'))
  const unknown = renderInspector({ kind: 'turn', sessionId: 'sess-alpha', turn: 27 })
  assert.ok(unknown.includes('状态未知'))
  const completed = renderInspector({ kind: 'turn', sessionId: 'sess-alpha', turn: 12 })
  assert.ok(completed.includes('完成'))
  assert.ok(!completed.includes('本轮仍在记录'))
})

test('轮次检查器渲染：计划无数据显示 — 而不是 0', () => {
  const html = renderInspector({ kind: 'turn', sessionId: 'sess-alpha', turn: 3 })
  assert.ok(html.includes('data-testid="turn-plan"'))
  assert.match(html, /data-testid="turn-plan"[\s\S]{0,600}?—/)
})

/* ---------------- 会话检查器 ---------------- */

test('会话检查器渲染：标题 / 状态 / 概览 / 模型 / 工作线 / 最近轮次 / 动作', () => {
  const html = renderInspector({ kind: 'session', sessionId: 'sess-alpha' })
  for (const piece of ['修复读模型指纹', '执行中', '起止时间', '模型', 'deepseek', '工作线', '最近轮次', 'T30', '打开会话', '在图中聚焦']) {
    assert.ok(html.includes(piece), '会话检查器缺内容：' + piece)
  }
  assert.ok(!/token|成本|price/i.test(html), '模型只作标签，不做成本/token')
  assert.ok(!html.includes('undefined'))
})

/* ---------------- 工作区概览 ---------------- */

test('概览渲染：覆盖率 / 工作线 / 计数 / 图例与图层开关位', () => {
  const html = renderInspector({ kind: 'none' })
  for (const piece of [
    '42/42 · 全部记录',
    '1 个会话读取失败',
    '修复读模型指纹',
    'T30',
    '文本',
    '代码',
    '数据',
    '媒体',
    '其它',
    '图例',
    '显示全部关系',
    '只看当前会话',
  ]) {
    assert.ok(html.includes(piece), '概览缺内容：' + piece)
  }
  assert.ok(html.includes('data-inspector-kind="overview"'))
  assert.ok(!html.includes('undefined'))
})

test('概览渲染：覆盖率未知时显示「观测不到」而不是 0（06 N-03 / N-04）', () => {
  const unknownData = { ...data, coverage: { ...data.coverage, known: false, total: 0, scanned: 0 } }
  const html = renderToStaticMarkup(h(Inspector, { t, data: unknownData, selection: { kind: 'none' } as never, now, actions }))
  assert.ok(html.includes('观测不到'))
  assert.ok(html.includes('42/42') === false, '未知覆盖率不得显示上一版的完成文案')
})

/* ---------------- 加载 / 缺失态 ---------------- */

test('检查器加载态：正在读取本轮记录（不显示半截假字段）', () => {
  const html = renderInspector({ kind: 'turn', sessionId: 'sess-alpha', turn: 30 }, { detailLoading: true })
  assert.ok(html.includes('正在读取本轮记录'))
  assert.ok(!html.includes('后续触碰'))
})

test('检查器缺失态：目标不存在时显式「观测不到」', () => {
  const html = renderInspector({ kind: 'file', path: 'src/does/not/exist.ts' })
  assert.ok(html.includes('观测不到'))
  assert.ok(html.includes('data-testid="inspector-missing"'))
})

/* ---------------- 轮次带 ---------------- */

function renderStrip(overrides: Record<string, unknown> = {}): string {
  const detail = buildSessionDetail()
  const groups = buildTurnGroups({
    scope: { kind: 'current' },
    currentSessionId: detail.id,
    sessions: buildSummaries(),
    details: new Map([[detail.id, detail]]),
  })
  return renderToStaticMarkup(
    h(TurnStrip, {
      t,
      groups,
      sessions: buildSummaries(),
      selected: select.turn('sess-alpha', 30),
      preview: null,
      onPreview: () => undefined,
      onSelect: () => undefined,
      now,
      ...overrides,
    }),
  )
}

test('轮次带渲染：30 块、四种状态齐全、运行轮带「本轮仍在记录」', () => {
  const html = renderStrip()
  const blocks = html.match(/role="option"/g) ?? []
  assert.equal(blocks.length, 30)
  const statuses = [...html.matchAll(/data-status="([a-z]+)"/g)].map((match) => match[1])
  assert.equal(statuses.filter((status) => status === 'completed').length, 26)
  assert.equal(statuses.filter((status) => status === 'aborted').length, 2)
  assert.equal(statuses.filter((status) => status === 'unknown').length, 1)
  assert.equal(statuses.filter((status) => status === 'running').length, 1)
  assert.equal((html.match(/本轮仍在记录/g) ?? []).length, 1, '只有运行轮显示「本轮仍在记录」')
  assert.equal((html.match(/data-partial="true"/g) ?? []).length, 1)
})

test('轮次带渲染：每块带 tooltip/aria-label（含全部计数）、宽度 ≥ 8px、选中态唯一', () => {
  const html = renderStrip()
  const labels = [...html.matchAll(/aria-label="([^"]+)"/g)].map((match) => match[1])
  const turnLabels = labels.filter((label) => label.startsWith('T'))
  assert.equal(turnLabels.length, 30)
  for (const label of turnLabels) {
    for (const field of ['文件', '命令', '子智能体', '错误']) {
      assert.ok(label.includes(field), 'tooltip 缺字段 ' + field + '：' + label)
    }
  }
  const widths = [...html.matchAll(/data-width="(\d+)"/g)].map((match) => Number(match[1]))
  assert.equal(widths.length, 30)
  for (const width of widths) assert.ok(width >= 8, '块宽不得小于 8px：' + String(width))
  assert.equal((html.match(/aria-selected="true"/g) ?? []).length, 1, '选中态必须唯一')
  assert.equal((html.match(/aria-selected="false"/g) ?? []).length, 29)
  assert.equal((html.match(/tabindex="0"/g) ?? []).length, 1, 'roving tabindex：只有一个可 Tab 进入')
})

test('轮次带渲染：标记是「图标 + 计数」，不只靠颜色（30 轮里至少有一块给计数）', () => {
  const html = renderStrip()
  assert.ok(html.includes('data-marker="files"'))
  assert.ok(html.includes('data-marker="errors"') || html.includes('data-marker="commands"'))
  assert.ok(/class="threadline-turn-marker-count"/.test(html), '宽块应显示计数')
  assert.ok(html.includes('class="threadline-turn-marker-dot"'), '文件标记用圆点')
  assert.ok(html.includes('class="threadline-turn-marker-tick"'), '命令标记用小竖线')
})

test('轮次带渲染：空态显式（不是空白），加载态有骨架', () => {
  const empty = renderStrip({ groups: [] })
  assert.ok(empty.includes('这个会话还没有轮次'))
  const loading = renderStrip({ groups: [], loading: true })
  assert.ok(loading.includes('正在读取本轮记录'))
})

test('轮次带渲染：隐私模式下不出现会话标题', () => {
  const html = renderStrip({ privacyMode: true })
  assert.ok(!html.includes('修复读模型指纹'))
})
