/*
 * tests/ui-turn/relations-render.test.ts —— 轮次关系提示（T36 / 脉络 1.1 P2）。
 *
 * 契约：
 * - TurnBlock 有 `relation` 时在标记行内追加紧凑徽标 `N 关系`（data-role="turn-relations"、data-relations=N、
 *   title = turns.relationsTip），并把同一文案追加到 aria-label；无 relation / count=0 时**不渲染任何节点**；
 * - TurnStrip 的 `relationCountByKey`（键 = selectionKey(turn:...)）按轮次传入，0/缺失的轮次不显示徽标；
 * - 不改变现有的状态/文件/命令标记：role=option 数与 data-turn-count 不变，状态色/标记仍在。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createTranslator } from '../../src/client/locale/index.ts'
import {
  TurnBlock,
  TurnStrip,
  buildTurnBlock,
  buildTurnGroups,
  select,
  type TurnRelationHint,
} from '../../src/client/ui/turns/index.ts'
import { buildSessionDetail, buildSummaries, buildTurns, fixtureNow } from './fixtures.ts'

const h = React.createElement
const t = createTranslator('zh')
const detail = buildSessionDetail()
const turns = buildTurns()
const now = fixtureNow()

function renderBlock(relation?: TurnRelationHint, extra: Record<string, unknown> = {}): string {
  const turn = turns[0]
  assert.ok(turn !== undefined)
  const model = buildTurnBlock(turn, { sessionId: detail.id, sessionRunning: detail.running === true, t, now })
  return renderToStaticMarkup(
    h(TurnBlock, {
      model,
      selected: false,
      preview: false,
      focusable: true,
      ...(relation === undefined ? {} : { relation }),
      ...extra,
    }),
  )
}

function relationHint(count: number): TurnRelationHint {
  return { count, label: t('turns.relations', { n: count }), tip: t('turns.relationsTip') }
}

function renderStrip(overrides: Record<string, unknown> = {}): string {
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
      selected: select.turn(detail.id, turns[0]?.n ?? 1),
      preview: null,
      onPreview: () => undefined,
      onSelect: () => undefined,
      now,
      ...overrides,
    }),
  )
}

test('TurnBlock：有 relation → 标记行内紧凑徽标 + tooltip + aria-label 追加；无 relation 不渲染', () => {
  const withRelation = renderBlock(relationHint(3))
  assert.ok(withRelation.includes('data-role="turn-relations"'))
  assert.ok(withRelation.includes('data-relations="3"'))
  assert.ok(withRelation.includes('class="threadline-turn-relations"'))
  assert.ok(withRelation.includes(t('turns.relations', { n: 3 })))
  assert.ok(withRelation.includes('title="' + t('turns.relationsTip') + '"'))
  // 同一文案进 aria-label（读屏能拿到）
  assert.ok(/aria-label="[^"]*3 关系[^"]*"/.test(withRelation))

  const plain = renderBlock()
  assert.equal(plain.includes('turn-relations'), false, '无 relation 时零节点（布局与 1.0 一致）')
  assert.equal(plain.includes('data-relations='), false)

  const zero = renderBlock(relationHint(0))
  assert.equal(zero.includes('turn-relations'), false, 'count=0 不渲染（不显示"0 关系"）')
})

test('TurnStrip：relationCountByKey 只给有值的轮次加徽标，不改现有 block 数与状态标记', () => {
  const groups = buildTurnGroups({
    scope: { kind: 'current' },
    currentSessionId: detail.id,
    sessions: buildSummaries(),
    details: new Map([[detail.id, detail]]),
  })
  const totalTurns = groups.reduce((sum, group) => sum + group.turns.length, 0)
  const plain = renderStrip()
  assert.equal(plain.includes('data-role="turn-relations"'), false, '未传 relationCountByKey：不渲染关系徽标')
  assert.equal(cutCount(plain, 'role="option"'), totalTurns, '现有 block 数不变')
  assert.ok(cutCount(plain, 'class="threadline-turn-marker') > 0, '原有标记仍在')

  const firstTurn = groups[0]?.turns[0]
  const lastTurn = groups[0]?.turns[groups[0].turns.length - 1]
  assert.ok(firstTurn !== undefined && lastTurn !== undefined)
  const keyOf = (turn: number) => 'turn:' + detail.id + ':' + String(turn)
  const relationCountByKey = new Map<string, number>([
    [keyOf(firstTurn.n), 2],
    [keyOf(lastTurn.n), 0],
  ])
  const html = renderStrip({ relationCountByKey })
  assert.equal(cutCount(html, 'role="option"'), totalTurns, '关系徽标不改变 block 数')
  assert.equal(cutCount(html, 'data-role="turn-relations"'), 1, '只有 count>0 的一轮显示徽标')
  assert.ok(html.includes('data-relations="2"'))
  assert.ok(html.includes('data-turn="' + String(firstTurn.n) + '"'))
  assert.ok(html.includes('2 关系'))
  assert.ok(html.includes('threadline-turn-marker'), '原有状态/文件/命令标记仍在')
})

function cutCount(html: string, needle: string): number {
  return html.split(needle).length - 1
}
