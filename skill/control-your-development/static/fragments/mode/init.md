# init —— 首次建立仪表盘

> 触发：目标项目没有 dev-dashboard/，或用户明确要求"初始化/建立仪表盘"。

1. **复制模板**：把本 skill `templates/` 下的 PRODUCT.md、FEATURES.md、NOW.md 复制到目标项目的 `dev-dashboard/`。
2. **先读格式契约**：写任何内容前读 `references/dashboard-format.md`。
3. **快速访谈（≤3 问，问完即做）**：
   - 这个产品是做什么的？给谁用？（填项目简介）
   - 现在做到哪了 / 打算先做什么？（填当前方向 + 功能清单）
   - 用户拿到手会怎么用它？（填使用流程）
   若项目已有代码/README 能回答，直接提取，不再问。
4. **填三份文件**：
   - PRODUCT.md：简介、方向、使用流程全部写人话。
   - FEATURES.md：从已有代码和规划提取功能；状态上限「可用」（刚做好的）/「进行中」/「设想」；「已验证」必须等用户亲口说。
   - NOW.md：首条时间线记录"仪表盘建立"；若有悬而未决的产品选择，写第一张决策卡（D1 起）。
5. **采集 + 归置 + 渲染**：跑 `<Python解释器> <skill目录>/scripts/collect_facts.py dev-dashboard/` 做首次全量采集，逐条归置（相关功能证据 / 时间线 / .dashboard-ignore，删除事件也要归置），再跑 `<Python解释器> <skill目录>/scripts/render_dashboard.py dev-dashboard/` 直到退出码 0。注：`.dsh/` 与 `dev-dashboard/` 目录采集器默认排除（DSH 与 skill 内部文件不是产品事实），无需写进 .dashboard-ignore。
6. **启动看护**：用托管后台任务运行 `<Python解释器> <skill目录>/scripts/watch_dashboard.py dev-dashboard/`，实现"改 MD 即自动刷新 HTML"；看护只在它存活期间生效，会话结束则跳过（此时靠"改完即渲染"兜底）。
7. **交付话术**：告诉用户"双击 dev-dashboard/index.html 随时查看"。**自动更新要说清前提**：只要第 6 步的看护任务还在跑，Markdown 一变网页就自动重生成；会话结束、任务被回收或机器重启后看护会停，网页不会自己变——那时说一句"更新一下仪表盘"即可（AI 每次改完 Markdown 也会立即重渲染，所以只要还在对话里推进，网页就是最新的）。
