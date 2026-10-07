---
name: control-your-development
description: "Turn engineering progress into a human-readable, product-level development dashboard (three Markdown files → single-file offline HTML) so anyone can see what the product does, track real progress, and make decisions. Use for 掌控开发进度、开发仪表盘、产品视角看板、功能地图、等你拍板、control my development and setting up dev-dashboard in any project; not for 写代码或工程实现本身（直接开发即可）, not for 项目排期与任务分派（改用项目管理工具）."
---

# control-your-development

把开发过程翻译成用户看得懂、能掌控的产品仪表盘：三份人话 Markdown（PRODUCT / FEATURES / NOW）是事实源，脚本渲染出单文件离线 HTML。

## Routing protocol

1. 读 `manifest.yaml`，加载 `always_load` 列出的核心层文件。
2. 检测内容轴 `mode`（判据见 manifest）：init / update / decide / verify。
   归类后向用户声明一行（如"我判为 update 场景，如不对请纠正"），然后继续——这不是审批门。
3. **只加载**匹配 mode 值的 fragment 文件。Do **not** read every fragment.
4. 按优先级执行：stance → mode fragment → workflow → 输出契约。
5. `references/dashboard-format.md` 在首次初始化或要写/改任何 dev-dashboard Markdown 之前**必须**打开。

## 硬约束（红线）

- 不编造：不编造证据路径、功能状态、验证记录；信息缺失用 `[待确认: 具体问题]` 占位。
- 状态机纪律：主路径 设想 → 进行中 → 可用 → 已验证；AI 最多标「可用」，「已验证」只在用户明确说验证过之后。可回退：已验证 →（撤销验证）可用、可用/已验证 →（返工重做）进行中、任意状态 →（废弃）已废弃、已废弃 →（恢复）设想；每次回退都要在时间线留痕。
- 覆盖性：collect_facts 给出的每条变更事实必须被收录（时间线/功能证据）或显式忽略（.dashboard-ignore），不允许静默遗漏。
- 单一事实源：永远改三份 Markdown 再重新渲染；index.html 是机器产物，禁止手改。
- 改完即渲染：任何 Markdown 改动后立即运行 render_dashboard.py。
- blocker 不放行：render 退出码 2（证据失效 / 事实未归置）必须当场修到 0。

## 输出契约

- 交付物：目标项目 `dev-dashboard/` 下三份人话 Markdown + 最新 `index.html`（单文件、离线、可双击打开）。
- 交付前：`render_dashboard.py` 退出码为 0；掌控条"数据健康"为 ✅。
- 收尾：一句话告诉用户更新了什么、有没有等他拍板的事。
