---
name: control-your-development
description: "Turn engineering progress into a human-readable, product-level development dashboard (three Markdown files → single-file offline HTML) so anyone can see what the product does, track real progress, and make decisions. Use for 掌控开发进度、开发仪表盘、产品视角看板、功能地图、等你拍板、control my development and setting up dev-dashboard in any project; not for 写代码或工程实现本身（直接开发即可）, not for 项目排期与任务分派（改用项目管理工具）."
---

# control-your-development

把开发过程翻译成用户看得懂、能掌控的产品仪表盘：人话 Markdown（PRODUCT / FEATURES / NOW，以及默认一并建立的术语表）是事实源，DSH 面板是日常界面，`index.html` 是可选的离线导出（分享/归档用）。

## Routing protocol

1. 读 `manifest.yaml`，加载 `always_load` 列出的核心层文件。
2. 检测内容轴 `mode`（判据见 manifest）：init / update / decide / verify。
   归类后向用户声明一行（如"我判为 update 场景，如不对请纠正"），然后继续——这不是审批门。
3. **只加载**匹配 mode 值的 fragment 文件。Do **not** read every fragment.
4. 按优先级执行：stance → mode fragment → workflow → 输出契约。
5. `references/dashboard-format.md` 在首次初始化或要写/改任何 dev-dashboard Markdown 之前**必须**打开。

## 硬约束（红线）

- 不编造：不编造证据路径、功能状态、验证记录；信息缺失用 `[待确认: 具体问题]` 占位。
- 状态机纪律：主路径 设想 → 进行中 → 可用 → 已验证；AI 最多标「可用」，「已验证」只在用户明确说验证过之后（面板直发、收件箱、口头均算）。可回退：已验证 →（撤销验证）可用、可用/已验证 →（返工重做）进行中、任意状态 →（废弃）已废弃、已废弃 →（恢复）设想；每次回退都要在时间线留痕。
- 覆盖性：collect_facts 给出的每条变更事实必须被收录（时间线/功能证据）或显式忽略（.dashboard-ignore），不允许静默遗漏。
- 单一事实源：永远改 Markdown 再重新渲染；index.html 是机器产物，禁止手改。
- 改完即渲染：任何 Markdown 改动后立即运行 render_dashboard.py（默认只审计；index.html 已存在会一并更新，需要导出加 `--html`）。
- blocker 不放行：render 退出码 2（证据失效 / 事实未归置）必须当场修到 0。
- 收件箱优先：update 开头先收 `.inbox.jsonl` 并清空（见 stance 第 13 条）。

## 输出契约

- 交付物：目标项目 `dev-dashboard/` 下人话 Markdown（PRODUCT / FEATURES / NOW，术语表默认一并建立）+ 面板里最新的仪表盘；`index.html` 仅在用户要分享/归档时用 `--html` 导出。
- 交付前：`render_dashboard.py` 退出码为 0；掌控条"数据健康"为 ✅。
- 拍板落定后：运行 `scripts/snapshot_version.py dev-dashboard/ save` 存一版快照（决策卡消失前的样子留档）。
- 收尾：一句话告诉用户更新了什么、有没有等他拍板的事。
