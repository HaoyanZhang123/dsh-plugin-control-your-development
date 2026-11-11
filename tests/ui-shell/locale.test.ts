/*
 * locale.test.ts —— A40-3「文案完整」的静态判据。
 *
 * 三件事，缺一即红：
 * 1. 03 §16 的 key 清单**逐条写在本文件里**（SPEC_KEYS，共 161 条 = 初版 §16 的 71 条 + 2026-11-04 扩展段的 39 条 + 2026-11-06 摘要条 1 条
 *    + 2026-11-05 T21 目录总览的 7 条 + T31 脉络 2.0 的 13 条 - 5 类合并后的 1 条 + 1.2.0 的 4 条
 *    + 1.2.0 返工的 13 条 - 1.2.0 返工删除的 5 条 - 2026-11-08 删除的 1 条 `timeline.now`），
 *    zh/en 少任何一个 key 都红；key 集合必须完全相等；
 * 2. 值必须与 03 §16 表格**逐字一致**（测试直接解析规范文件，不靠人眼）；
 * 3. t()/createTranslator 的占位符替换与默认 locale 行为正确。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PLUGIN_ROOT } from '../harness/styles-codegen.ts'
import {
  DEFAULT_LOCALE,
  MESSAGE_KEYS,
  MESSAGES,
  createTranslator,
  format,
  isLocale,
  message,
  t,
  type MessageKey,
} from '../../src/client/locale/index.ts'
import { en } from '../../src/client/locale/en.ts'
import { zh } from '../../src/client/locale/zh.ts'

/** 03 §16「文案定稿」的全部 key（顺序与规范表格一致）。 */
export const SPEC_KEYS: readonly string[] = [
  "app.name",
  "tab.label",
  "tab.title",
  "impact.label",
  "impact.tooltip",
  "impact.title",
  "impact.openTab",
  "impact.openModal",
  "modal.title",
  "modal.badge",
  "modal.start",
  "modal.end",
  "modal.turns",
  "modal.map",
  "modal.openLoops",
  "modal.openFull",
  "coverage.loading",
  "coverage.partial",
  "coverage.complete",
  "coverage.failed",
  "coverage.retry",
  "state.unknown",
  "state.loadingDetail",
  "state.partialTurn",
  "state.unloaded",
  "state.unloadedRange",
  "state.emptyWorkspace",
  "state.emptyFiles",
  "state.hostUnavailable",
  "privacy.mode",
  "privacy.hidden",
  "privacy.show",
  "relations.title",
  "relations.structure",
  "relations.coTurn",
  "relations.coSession",
  "relations.reference",
  "relations.sequence",
  "relations.unconfirmed",
  "relations.evidence",
  "relations.tooMany",
  "inspector.file",
  "inspector.turn",
  "inspector.session",
  "inspector.firstSeen",
  "inspector.lastTouched",
  "inspector.ops",
  "inspector.lineDelta",
  "inspector.touchHistory",
  "inspector.laterTouches",
  "inspector.prevTurn",
  "inspector.plan",
  "inspector.openFile",
  "inspector.openSession",
  "inspector.listView",
  "legend.title",
  "map.fit",
  "map.showAllRelations",
  "map.onlyCurrent",
  "range.all",
  "range.today",
  "range.7d",
  "range.30d",
  "session.archived",
  "session.running",
  "session.aborted",
  "session.unknown",
  // —— §16 扩展段（2026-11-04，Lead 落定；39 条，与规范表格逐条对账）——
  "turns.tooltip",
  "turns.durationSec",
  "turns.durationMin",
  "turns.durationHour",
  "turns.currentSession",
  "turns.allWorklines",
  "turns.completed",
  "turns.empty",
  "ops.read",
  "ops.write",
  "ops.search",
  "ops.command",
  "status.ok",
  "status.failed",
  "status.unknown",
  "fileFamily.text",
  "fileFamily.code",
  "fileFamily.data",
  "fileFamily.media",
  "fileFamily.other",
  "inspector.externalSources",
  "inspector.more",
  "inspector.focusInMap",
  "inspector.intent",
  "inspector.tools",
  "inspector.commands",
  "inspector.subagents",
  "inspector.errors",
  "inspector.filesAdded",
  "inspector.filesModified",
  "inspector.reused",
  "inspector.model",
  "inspector.workline",
  "inspector.parentSession",
  "inspector.recentTurns",
  "inspector.timeRange",
  "relations.collapsed",
  // —— §16 扩展段（2026-11-05，T21 目录总览；Lead 同步到 03 §16 表格）——
  "map.rootCluster",
  "map.clusterCount",
  "map.clusterMeta",
  "map.clusterCurrent",
  "map.zoomIn",
  "map.zoomOut",
  "graph.loading",
  "graph.loadingTurn",
  "graph.emptyTurn",
  "graph.resetLayout",
  "graph.evidenceTitle",
  "graph.fileRelations",
  "rail.relations",
  "rail.relatedDirs",
  "rail.topRelated",
  "turns.relations",
  "turns.relationsTip",
  // -- section 16 extension (2026-11-07, 1.2.0 rework: workspace file browser + current-directory graph) --
  "tree.root",
  "tree.folder",
  "tree.path",
  "tree.ops",
  "tree.back",
  "tree.refresh",
  "tree.cards",
  "tree.list",
  "tree.empty",
  "tree.readFailed",
  "tree.truncated",
  "tree.retry",
  "map.folder",
  "map.folderCount",
  "graph.untouched",
  "graph.currentDir",
  "graph.emptyFolder",
  "graph.showingOf",
  "graph.noRecord",
  "graph.density",
  "graph.densitySkeleton",
  "graph.densityStandard",
  "graph.densityAll",
  "graph.showAll",
  "graph.collapseAll",
  "graph.relationsSummary",
  "graph.relationsTrimmed",
  "graph.hubEmpty",
  "graph.title",
  "rail.title",
  "turnStatus.read",
  "turnStatus.write",
  "turnStatus.firstSeen",
  "turnStatus.deleteCommands",
  "turnStatus.deleteShort",
  "turnStatus.unknown",
  "turnStatus.markRead",
  "turnStatus.markWriteAdd",
  "turnStatus.markWriteDel",
  "turnStatus.markFirstSeen",
  // —— §16 扩展段（2026-11-11，D-35：右栏列表表头 / 会话范围分组；Lead 同步表格）——
  "tree.name",
  "tree.kind",
  "tree.size",
  "turns.scopeGroupView",
  "turns.scopeGroupSessions",
  // —— §16 扩展段（2026-11-11，D-35 思维链视图；Lead 同步表格）——
  "reasoning.tab",
  "reasoning.treemap",
  "reasoning.cloud",
  "reasoning.list",
  "reasoning.charsUnit",
  "reasoning.group",
  "reasoning.chars",
  "reasoning.tokens",
  "reasoning.ratio",
  "reasoning.lang",
  "reasoning.form",
  "reasoning.noPrefix",
  "reasoning.sentences",
  "reasoning.range",
  "reasoning.model",
  "reasoning.record",
  "reasoning.views",
  "reasoning.summary",
  "reasoning.coverage",
  "reasoning.tokenRatio",
  "reasoning.charRatio",
  "reasoning.charRatioHint",
  "reasoning.dimensions",
  "reasoning.rank",
  "reasoning.detail",
  "reasoning.selectHint",
  "reasoning.empty",
  "reasoning.noSentences",
  "reasoning.sentencesUnit",
  "reasoning.blocksUnit",
  "reasoning.groupsUnit",
  "reasoning.blocks",
  "reasoning.rangeWorkspace",
  "reasoning.rangeActive",
  "reasoning.rangeSession",
  "reasoning.all",
  "reasoning.other",
  "reasoning.recordCommitted",
  "reasoning.recordAll",
  "reasoning.dimPrefix",
  "reasoning.dimForm",
  "reasoning.dimLang",
  "reasoning.dimModel",
  "reasoning.dimPreset",
  "reasoning.formPlan",
  "reasoning.formQuestion",
  "reasoning.formImperative",
  "reasoning.formWarning",
  "reasoning.formStatement",
  "reasoning.langZh",
  "reasoning.langEn",
  "reasoning.langJa",
  "reasoning.langKo",
  "reasoning.langMixed",
  "reasoning.langUnknown",
  "reasoning.loading",
  "reasoning.none",
  "reasoning.partial",
  "reasoning.collapsed",
]

/** §16 未列、但实现必需的接口文案（已在 zh.ts/en.ts 头部注明）。 */
export const EXTENSION_KEYS: readonly string[] = ["ui.open", "ui.close", "ui.expand", "ui.collapse"]

const SPEC_DOC = join(PLUGIN_ROOT, '..', 'notes', '31-脉络-1.0-交接', '03-产品与交互规格.md')

function readSpecTable(): Array<{ key: string; zh: string; en: string }> {
  const doc = readFileSync(SPEC_DOC, 'utf8')
  const start = doc.indexOf('## 16. 文案定稿')
  const end = doc.indexOf('## 17.')
  assert.ok(start > -1 && end > start, '规范文件里找不到 §16')
  return doc
    .slice(start, end)
    .split(/\r?\n/)
    .filter((line) => line.startsWith('| `'))
    .map((line) => {
      const cells = line.split('|').map((cell) => cell.trim())
      return { key: cells[1].replace(/^`|`$/g, ''), zh: cells[2], en: cells[3] }
    })
}

test('03 §16 的 161 个 key 在 zh/en 里都存在', () => {
  for (const key of SPEC_KEYS) {
    assert.ok(Object.prototype.hasOwnProperty.call(zh, key), 'zh 缺 key：' + key)
    assert.ok(Object.prototype.hasOwnProperty.call(en, key), 'en 缺 key：' + key)
  }
  // 162 → 161：2026-11-08 删掉 `timeline.now`（「回到最新」按钮已删，文案无归属）。
  // 161 → 166：2026-11-11 D-35 新增右栏表头 3 条 + 会话范围分组 2 条。
  // 223 → 224：2026-11-11 1.5.1 新增 `reasoning.partial`（读失败不能冒充「没有记录」）。
  // 224 → 225：2026-11-11 1.5.3 新增 `reasoning.collapsed`（矩形树图合并必须可见）。
  assert.equal(SPEC_KEYS.length, 225)
  assert.equal(new Set(SPEC_KEYS).size, SPEC_KEYS.length, 'key 清单本身有重复')
})

test('zh / en 的 key 集合完全相等', () => {
  assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort())
})

test('key 全集 = §16 的 161 条 + 4 条扩展接口文案（没有多余漂移）', () => {
  const all = Object.keys(zh)
  assert.equal(all.length, SPEC_KEYS.length + EXTENSION_KEYS.length)
  for (const key of EXTENSION_KEYS) assert.ok(all.includes(key), '缺扩展 key：' + key)
  const unexpected = all.filter((key) => !SPEC_KEYS.includes(key) && !EXTENSION_KEYS.includes(key))
  assert.deepEqual(unexpected, [], '出现了未登记的 key：' + unexpected.join(', '))
})

test('MESSAGE_KEYS（类型级清单）与实际数据一致', () => {
  assert.deepEqual([...MESSAGE_KEYS].sort(), Object.keys(zh).sort())
})

test('每条文案与 03 §16 逐字一致（直接解析规范文件）', (t) => {
  // 发布仓（release/<name>/）里没有交接包 notes/，这条**只能**在开发树校验。
  // 缺失时显式 skip 并写明原因（不许静默当通过；开发树永远有这份文件，所以开发树上是严格校验）。
  if (!existsSync(SPEC_DOC)) {
    t.skip('发布仓无交接包 notes/：' + SPEC_DOC + '（本项只在开发树校验）')
    return
  }
  const table = readSpecTable()
  assert.equal(table.length, SPEC_KEYS.length, '规范表格行数与 SPEC_KEYS 不一致')
  for (const row of table) {
    assert.equal(zh[row.key as MessageKey], row.zh, 'zh 与规范不一致：' + row.key)
    assert.equal(en[row.key as MessageKey], row.en, 'en 与规范不一致：' + row.key)
  }
})

test('默认 locale 是 zh；切到 en 后 key 仍全部可用', () => {
  assert.equal(DEFAULT_LOCALE, 'zh')
  assert.equal(t('app.name'), '脉络')
  assert.equal(t('app.name', undefined, 'en'), 'Threadline')
  const translate = createTranslator('en')
  assert.equal(translate('coverage.retry'), 'Read again')
  assert.equal(isLocale('zh'), true)
  assert.equal(isLocale('fr'), false)
  assert.equal(message('tab.title', 'en'), 'Workspace threadline')
})

test('占位符替换：{n} / {done} / {total} / {files}…', () => {
  assert.equal(t('impact.label', { n: 3 }), '影响 3')
  assert.equal(t('coverage.loading', { done: 42, total: 267 }), '正在补全历史 42/267')
  assert.equal(
    t('impact.tooltip', { files: 3, commands: 1, subagents: 2 }),
    '本轮影响：3 个文件 · 1 条命令 · 2 个子智能体',
  )
  assert.equal(
    createTranslator('en')('impact.tooltip', { files: 3, commands: 1, subagents: 2 }),
    'This turn: 3 files · 1 commands · 2 subagents',
  )
})

test('缺变量时保留占位符（宁可显示 {n}，也不伪造数字）', () => {
  assert.equal(format('影响 {n}', {}), '影响 {n}')
  assert.equal(format('{a}-{b}', { a: 1 }), '1-{b}')
})

test('模板占位符只用 03 §16 约定的变量名（填满后不残留 {…}）', () => {
  const vars = { n: 1, done: 1, total: 1, files: 1, dirs: 1, name: 'x', commands: 1, subagents: 1, duration: '1 分', s: 1, m: 1, h: 1, shown: 1, errors: 1, count: 1, ops: 1, time: '1', visible: 1, add: 1, del: 1, drawn: 1 }
  for (const key of Object.keys(zh) as MessageKey[]) {
    for (const locale of ['zh', 'en'] as const) {
      const filled = format(MESSAGES[locale][key], vars)
      assert.equal(filled.includes('{') || filled.includes('}'), false, '未知占位符：' + locale + '.' + key + ' → ' + MESSAGES[locale][key])
    }
  }
})
