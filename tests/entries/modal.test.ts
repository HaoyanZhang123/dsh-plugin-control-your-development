/*
 * tests/entries/modal.test.ts —— `/threadline` 弹窗（06 A43-3）。
 *
 * 断言：模型（计数/起点/终点/未闭环）+ 渲染三态（加载 / 空 / 数据）+ 隐私模式隐藏正文
 * + 尺寸与无障碍属性由 Overlay 提供（T06 已单测焦点陷阱，这里只断言 role/aria/dialog 结构）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createTranslator } from '../../src/client/locale/index.ts'
import { buildModalModel, fileNodesOfDetail } from '../../src/client/ui/modal/model.ts'
import { ThreadlineModal } from '../../src/client/ui/modal/ThreadlineModal.ts'
import { buildDetail } from './fixtures.ts'

const t = createTranslator('zh')
const detail = buildDetail()
const nodes = fileNodesOfDetail(detail)
const files = new Map(nodes.map((node) => [node.path.toLowerCase(), node]))

function renderModal(overrides: Record<string, unknown> = {}): string {
  return renderToStaticMarkup(
    React.createElement(ThreadlineModal, {
      open: true,
      sessionId: detail.id,
      detail,
      files,
      mode: 'metadata',
      now: 0,
      t,
      onClose: () => undefined,
      onOpenFull: () => undefined,
      ...overrides,
    }),
  )
}

test('模型：时长 / 轮数 / 文件 / 命令 / 子智能体 / 未闭环（只数记录里明确的）', () => {
  const model = buildModalModel({ detail, files, mode: 'metadata', t, now: detail.startedAt + 10 * 60_000 })
  assert.equal(model.turns, 3)
  assert.equal(model.files, 3)
  assert.equal(model.commands, 1)
  assert.equal(model.subagents, 2)
  assert.equal(model.errors, 1)
  assert.equal(model.openLoops.failedCommands, 0)
  assert.equal(model.openLoops.unfinishedSubagents, 1, 'tester 仍在跑 → 未完成 1')
  assert.equal(model.badge, '按记录重建，非生成摘要')
  assert.equal(model.startText, '先把 merge 与 scope 的字段对齐')
  assert.ok(model.durationText !== '—')
})

test('渲染：dialog 结构 + 汇总 + 轮次轨迹 + 星图容器 + 未闭环 + 「在完整脉络中查看」', () => {
  const html = renderModal()
  assert.ok(html.includes('role="dialog"'))
  assert.ok(html.includes('aria-modal="true"'))
  assert.ok(html.includes('本次对话的脉络'))
  assert.ok(html.includes('按记录重建，非生成摘要'))
  assert.ok(html.includes('data-testid="modal-summary"'))
  assert.ok(html.includes('data-testid="modal-turns"'))
  assert.ok(html.includes('data-testid="modal-map"'))
  assert.ok(html.includes('data-testid="modal-open-loops"'))
  assert.ok(html.includes('未闭环'))
  assert.ok(html.includes('在完整脉络中查看'))
  assert.ok(html.includes('本轮仍在记录'), '运行中的会话要标注"仍在记录"，不伪造完整')
  // 起点/终点默认折叠：只给"显示正文"入口，正文不出现
  assert.ok(!html.includes('先把 merge 与 scope 的字段对齐'), '起点正文默认折叠')
  assert.ok(html.includes('aria-expanded="false"'))
})

test('渲染：隐私模式隐藏正文入口（显示「内容已隐藏」）', () => {
  const html = renderModal({ mode: 'hidden' })
  assert.ok(html.includes('内容已隐藏'))
  assert.ok(!html.includes('先把 merge 与 scope 的字段对齐'))
  assert.ok(!html.includes('显示正文'))
})

test('渲染：数据未到 → 骨架 + 「正在读取本轮记录…」（不显示半截假数据）', () => {
  const html = renderModal({ detail: null })
  assert.ok(html.includes('正在读取本轮记录'))
  assert.ok(!html.includes('data-testid="modal-turns"'))
})

test('渲染：无轮次 → 显式空态（不是假图）', () => {
  const emptyDetail = { ...detail, turns: [], messageTurns: {}, counts: { ...detail.counts, turns: 0 } }
  const html = renderModal({ detail: emptyDetail })
  assert.ok(html.includes('data-testid="modal-empty"'))
  assert.ok(html.includes('还没有可读的记录'))
})

test('渲染：点击轮次展开单轮影响（含"在脉络中查看"），且不产生投递', () => {
  const html = renderModal()
  // 展开态需要交互；这里断言每行都有可展开的按钮与计数（点击行为由 harness 的 impact/tab 用例覆盖）
  const buttons = html.match(/class="threadline-modal-turn-head"/g) ?? []
  assert.equal(buttons.length, 3)
  assert.ok(html.includes('data-turn="1"'))
  assert.ok(html.includes('data-turn="2"'))
})
