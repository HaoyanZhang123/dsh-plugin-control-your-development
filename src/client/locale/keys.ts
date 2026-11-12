/*
 * locale/keys.ts —— 全部文案 key 的联合类型（类型级唯一来源）。
 *
 * 文案唯一来源：notes/31-脉络-1.0-交接/03-产品与交互规格.md §16「文案定稿」（值逐字照抄，不许改写）。
 * 尾部 4 条 ui.* 是「规范未列、实现必需」的接口文案（打开/关闭/展开/收起），已在 tests 里单独标注；
 * tests/ui-shell/locale.test.ts 会把本文件与 03 §16 表格逐字比对，漂移即红。
 * 禁止词（03 §16 末段）：依赖（用于共现）/已完成/成功（结果未知）/同步/应用/保存/开始/停止/重试/生成摘要。
 */

/* key 的数量必须与 03 §16 表格行数一致；缺 key 在 zh.ts / en.ts 的 Record<MessageKey, string> 处直接编译报错。 */
export type MessageKey =
  | "app.name"
  | "tab.label"
  | "tab.title"
  | "impact.label"
  | "impact.tooltip"
  | "impact.title"
  | "impact.openTab"
  | "impact.openModal"
  | "modal.title"
  | "modal.badge"
  | "modal.start"
  | "modal.end"
  | "modal.turns"
  | "modal.map"
  | "modal.openLoops"
  | "modal.openFull"
  | "coverage.loading"
  | "coverage.partial"
  | "coverage.complete"
  | "coverage.failed"
  | "coverage.retry"
  | "state.unknown"
  | "state.loadingDetail"
  | "state.partialTurn"
  | "state.unloaded"
  | "state.unloadedRange"
  | "state.emptyWorkspace"
  | "state.emptyFiles"
  | "state.hostUnavailable"
  | "privacy.mode"
  | "privacy.hidden"
  | "privacy.show"
  | "relations.title"
  | "relations.structure"
  | "relations.coTurn"
  | "relations.coSession"
  | "relations.reference"
  | "relations.sequence"
  | "relations.unconfirmed"
  | "relations.evidence"
  | "relations.tooMany"
  | "inspector.file"
  | "inspector.turn"
  | "inspector.session"
  | "inspector.firstSeen"
  | "inspector.lastTouched"
  | "inspector.ops"
  | "inspector.lineDelta"
  | "inspector.touchHistory"
  | "inspector.laterTouches"
  | "inspector.prevTurn"
  | "inspector.plan"
  | "inspector.openFile"
  | "inspector.openSession"
  | "inspector.listView"
  | "legend.title"
  | "map.fit"
  | "map.showAllRelations"
  | "map.onlyCurrent"
  | "range.all"
  | "range.today"
  | "range.7d"
  | "range.30d"
  | "session.archived"
  | "session.running"
  | "session.aborted"
  | "session.unknown"
  // —— §16 扩展段（2026-11-04，Lead 落定）——
  | "turns.tooltip"
  | "turns.durationSec"
  | "turns.durationMin"
  | "turns.durationHour"
  | "turns.currentSession"
  | "turns.allWorklines"
  | "turns.scopeGroupView"
  | "turns.scopeGroupSessions"
  | "turns.completed"
  | "turns.empty"
  | "ops.read"
  | "ops.write"
  | "ops.search"
  | "ops.command"
  | "status.ok"
  | "status.failed"
  | "status.unknown"
  | "fileFamily.text"
  | "fileFamily.code"
  | "fileFamily.data"
  | "fileFamily.media"
  | "fileFamily.other"
  | "inspector.externalSources"
  | "inspector.more"
  | "inspector.focusInMap"
  | "inspector.intent"
  | "inspector.tools"
  | "inspector.commands"
  | "inspector.subagents"
  | "inspector.errors"
  | "inspector.filesAdded"
  | "inspector.filesModified"
  | "inspector.reused"
  | "inspector.model"
  | "inspector.workline"
  | "inspector.parentSession"
  | "inspector.recentTurns"
  | "inspector.timeRange"
  | "relations.collapsed"
  // —— §16 扩展段（2026-11-05，T21 目录总览）——
  | "map.rootCluster"
  | "reasoning.tab"
  | "reasoning.treemap"
  | "reasoning.cloud"
  | "reasoning.list"
  | "reasoning.charsUnit"
  | "reasoning.group"
  | "reasoning.chars"
  | "reasoning.tokens"
  | "reasoning.ratio"
  | "reasoning.lang"
  | "reasoning.form"
  | "reasoning.noPrefix"
  | "reasoning.sentences"
  | "reasoning.range"
  | "reasoning.model"
  | "reasoning.record"
  | "reasoning.views"
  | "reasoning.summary"
  | "reasoning.coverage"
  | "reasoning.tokenRatio"
  | "reasoning.charRatio"
  | "reasoning.charRatioHint"
  | "reasoning.dimensions"
  | "reasoning.rank"
  | "reasoning.detail"
  | "reasoning.selectHint"
  | "reasoning.empty"
  | "reasoning.noSentences"
  | "reasoning.sentencesUnit"
  | "reasoning.blocksUnit"
  | "reasoning.groupsUnit"
  | "reasoning.blocks"
  | "reasoning.rangeWorkspace"
  | "reasoning.rangeActive"
  | "reasoning.rangeSession"
  | "reasoning.all"
  | "reasoning.other"
  | "reasoning.recordCommitted"
  | "reasoning.recordAll"
  | "reasoning.dimPrefix"
  | "reasoning.dimForm"
  | "reasoning.dimLang"
  | "reasoning.dimModel"
  | "reasoning.dimPreset"
  | "reasoning.formPlan"
  | "reasoning.formQuestion"
  | "reasoning.formImperative"
  | "reasoning.formWarning"
  | "reasoning.formStatement"
  | "reasoning.langZh"
  | "reasoning.langEn"
  | "reasoning.langJa"
  | "reasoning.langKo"
  | "reasoning.langMixed"
  | "reasoning.langUnknown"
  | "reasoning.loading"
  | "reasoning.none"
  | "reasoning.partial"
  | "reasoning.collapsed"
  | "reasoning.coverageLoaded"
  | "reasoning.coverageFailed"
  | "reasoning.loadMore"
  | "reasoning.loadAll"
  | "reasoning.loadingMore"
  | "reasoning.moreFilters"
  | "reasoning.preset"
  | "reasoning.activeFilters"
  | "reasoning.resetFilters"
  | "reasoning.filteredEmpty"
  | "reasoning.otherDrill"
  | "reasoning.otherList"
  | "reasoning.cloudSkipped"
  | "reasoning.showing"
  | "reasoning.noOptions"
  | "reasoning.sortedAsc"
  | "reasoning.sortedDesc"
  | "reasoning.contextRatio"
  | "reasoning.turn"
  | "reasoning.turnUnknown"
  | "reasoning.estimated"
  | "reasoning.needText"
  | "map.clusterCount"
  | "map.clusterMeta"
  | "map.clusterCurrent"
  | "map.zoomIn"
  | "map.zoomOut"
  // —— §16 扩展段（2026-11-05，T31 脉络 2.0：文件关系图/轮次状态/目录 rail）——
  | "graph.title"
  | "rail.title"
  | "turnStatus.read"
  | "turnStatus.write"
  | "turnStatus.firstSeen"
  | "turnStatus.deleteCommands"
  | "turnStatus.deleteShort"
  | "turns.relationsTip"
  | "tree.root"
  | "tree.folder"
  | "tree.name"
  | "tree.kind"
  | "tree.size"
  | "tree.path"
  | "tree.ops"
  | "tree.back"
  | "tree.refresh"
  | "tree.cards"
  | "tree.list"
  | "tree.empty"
  | "tree.readFailed"
  | "tree.truncated"
  | "tree.retry"
  | "map.folder"
  | "map.folderCount"
  | "graph.untouched"
  | "graph.currentDir"
  | "graph.emptyFolder"
  | "graph.showingOf"
  | "graph.noRecord"
  | "graph.density"
  | "graph.densitySkeleton"
  | "graph.densityStandard"
  | "graph.densityAll"
  | "graph.showAll"
  | "graph.collapseAll"
  | "graph.relationsSummary"
  | "graph.relationsTrimmed"
  | "graph.hubEmpty"
  | "turns.relations"
  | "rail.topRelated"
  | "rail.relatedDirs"
  | "rail.relations"
  | "graph.fileRelations"
  | "graph.evidenceTitle"
  | "graph.resetLayout"
  | "graph.emptyTurn"
  | "graph.loadingTurn"
  | "graph.loading"
  | "turnStatus.unknown"
  | "turnStatus.markRead"
  | "turnStatus.markWriteAdd"
  | "turnStatus.markWriteDel"
  | "turnStatus.markFirstSeen"
  | "ui.open"
  | "ui.close"
  | "ui.expand"
  | "ui.collapse"


/** 运行时 key 清单（顺序与 03 §16 表格一致，测试用它做集合比对）。 */
export const MESSAGE_KEYS: readonly MessageKey[] = [
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
  // —— §16 扩展段（2026-11-04，Lead 落定）：§6/§8 已规定的字段标签与计数文案，初版 §16 漏列 ——
  "turns.tooltip",
  "turns.durationSec",
  "turns.durationMin",
  "turns.durationHour",
  "turns.currentSession",
  "turns.allWorklines",
  "turns.scopeGroupView",
  "turns.scopeGroupSessions",
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
  // —— §16 扩展段（2026-11-05，T21 目录总览）——
  "map.rootCluster",
  "map.clusterCount",
  "map.clusterMeta",
  "map.clusterCurrent",
  "map.zoomIn",
  "map.zoomOut",
  // —— §16 扩展段（2026-11-05，T31 脉络 2.0：文件关系图/轮次状态/目录 rail）——
  "graph.title",
  "rail.title",
  "turnStatus.read",
  "turnStatus.write",
  "turnStatus.firstSeen",
  "turnStatus.deleteCommands",
  "turnStatus.deleteShort",
  "turns.relationsTip",
  "tree.root",
  "tree.folder",
  "tree.name",
  "tree.kind",
  "tree.size",
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
  "turns.relations",
  "rail.topRelated",
  "rail.relatedDirs",
  "rail.relations",
  "graph.fileRelations",
  "graph.evidenceTitle",
  "graph.resetLayout",
  "graph.emptyTurn",
  "graph.loadingTurn",
  "graph.loading",
  "turnStatus.unknown",
  "turnStatus.markRead",
  "turnStatus.markWriteAdd",
  "turnStatus.markWriteDel",
  "turnStatus.markFirstSeen",
  "ui.open",
  "ui.close",
  "ui.expand",
  "ui.collapse",
  // —— 思维链视图（D-35）——
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
  "reasoning.coverageLoaded",
  "reasoning.coverageFailed",
  "reasoning.loadMore",
  "reasoning.loadAll",
  "reasoning.loadingMore",
  "reasoning.moreFilters",
  "reasoning.preset",
  "reasoning.activeFilters",
  "reasoning.resetFilters",
  "reasoning.filteredEmpty",
  "reasoning.otherDrill",
  "reasoning.otherList",
  "reasoning.cloudSkipped",
  "reasoning.showing",
  "reasoning.noOptions",
  "reasoning.sortedAsc",
  "reasoning.sortedDesc",
  "reasoning.contextRatio",
  "reasoning.turn",
  "reasoning.turnUnknown",
  "reasoning.estimated",
  "reasoning.needText",
]
