# Changelog

本文件记录 `dsh-plugin-control-your-development` 的版本更新。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

发版纪律：把 Unreleased 落成 `## [<ver>] - <日期>` 后才能发版；不更新 CHANGELOG 不得发版。

## [Unreleased]

## [0.5.1] - 2026-10-08

### Fixed

- 功能关系图节点底板（圆角矩形）未渲染导致节点只剩文字的"隐形节点"问题（0.5.0 引入的回归）；CDP 验收新增 `g.node>rect` 数量断言防回归
- README 四张实拍图按 0.5.x 新界面重拍

## [0.5.0] - 2026-10-08

### Added

- 双向闭环：面板上「拍板」直接通知当前会话的模型；会话不在线时写入 `dev-dashboard/.inbox.jsonl`，下次更新时收取
- 会话页顶部「功能地图」标签页：整页关系图 + 节点详情，支持缩放 / 平移 / 适应屏幕
- 关系图节点宽度自适应内容，长名称折行省略、悬浮显示全文；文件路径中间省略、悬浮显示完整路径
- 数据契约 v1.3：功能块下可嵌套 `### 子项:`（默认折叠、点击展开）；新增 `GLOSSARY.md` 术语表与用词漂移检查
- 插件设置（经 DSH 设置服务）：数据目录名、双向通知开关、时间线显示条数、版本快照保留上限等
- 版本快照：`dev-dashboard/.versions/` 保存三份 Markdown 的里程碑，面板可查看与对比
- 插件页元信息：`locale/zh.json` 与 `locale/en.json` 提供标题与描述，`assets/icon.webp` 提供图标
- `peerDependencies` 声明兼容区间 `>=0.2.0-0 <0.2.1-0`（含预览版），避免被宿主静默跳过

### Changed

- `index.html` 从「每次必渲染的交付物」降级为「可选导出」（分享 / 归档用）；面板是唯一日常界面；Python 渲染器保留全部审计职责

## [0.4.2] - 2026-10-06

历史版本（更名 dsh-plugin-control-your-development 后的发布线）。详见仓库 git 历史。
