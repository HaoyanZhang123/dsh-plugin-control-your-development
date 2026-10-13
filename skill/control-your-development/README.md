# control-your-development

> 一句话定位：把开发过程翻译成用户看得懂、能掌控的产品仪表盘（人话 Markdown → DSH 面板，可选导出单文件 HTML）。
> 所属项目：control-your-development　版本：1.6.0　状态：分发级

## 何时用

- ✅ 用户说 "control my development" / 想掌控开发进度 / 看不懂技术细节但想知道产品做到哪了
- ✅ 完成一个开发阶段，需要把进展翻译成人话并更新仪表盘
- ✅ 需要用户拍板产品决策，或用户说"某功能我验证过了"
- ❌ 不适用：写代码、调 bug 等工程实现本身（直接开发即可）
- ❌ 不适用：项目排期、任务分派、多人协作管理（改用项目管理工具）

## 资源地图

| 路径 | 内容 | 何时加载 |
|---|---|---|
| `static/core/stance.md` | 立场与原则（状态机纪律、证据纪律、划分/用词/收件箱纪律） | 每次 |
| `static/core/writing.md` | 写作约束（AI 写进产物的文字的唯一入口：词汇/句子/结构/读者/格式 + 交付前自查清单） | 每次 |
| `static/core/workflow.md` | 主流程（判定场景→执行→渲染→收尾） | 每次 |
| `static/fragments/mode/` | 四个场景 fragment：init / update / decide / verify | 轴匹配时只读一篇 |
| `references/dashboard-format.md` | dev-dashboard 数据格式契约（v1.5） | 初始化或改 Markdown 前 |
| `references/copy-deck.md` | 界面文案定稿（面板与网页文案的唯一依据） | 改界面文案或模板文字前 |
| `references/design-tokens.md` | 设计令牌与组件规格（颜色 / 字号 / 间距 / 组件） | 改样式或组件前 |
| `references/graph-visuals.md` | 关系图与技术地图视觉规范（SVG 几何、交互与降级） | 改关系图前 |
| `templates/` | Markdown 模板（PRODUCT/FEATURES/NOW，术语表默认一并建立）+ HTML 渲染模板 | init 场景复制 |
| `scripts/` | render_dashboard / collect_facts / watch_dashboard / snapshot_version | 按 fragment 调用 |
| `tools/ready.py`（**仓库根，skill 目录之外**） | 一键跑全量门禁（快→慢：静态 → 冒烟 12 → 双解析器差分 → 边缘套件 → 构建）；`--quick` 跳过慢项、`--cdp` 才跑真机 40 项，**跳过一律显式写原因、不算通过** | 交付前 / 改完就跑 |
| `tools/verify_status.py`（**仓库根，skill 目录之外**） | 验证记录判定：`CURRENT` 退 0 / `STALE` 退 1（列出差异）/ `MISSING` 退 1；并比对三份 skill 副本指纹 | 想确认验证记录是否过期时 |
| `AGENTS.md`（**仓库根，skill 目录之外**） | 全仓改动规则：Map / 「改 X 要同步哪些文件 + 跑哪些门禁」矩阵 / Tests / Done 判据 | 动手改仓库任何文件前 |
| `output/_verify/verification.json`（**仓库根，机器产物，不入库**） | 验证记录（模板与脚本的 SHA-256 指纹 + 跑过的套件 + 三份 skill 副本指纹）；判定用 `tools/verify_status.py check`（CURRENT / STALE / MISSING，不全新退 1） | 由 `tools/verify_status.py` 读写 |

## 契约句清单

> 重构后跑 `python tools/contract_check.py .dsh/skills/control-your-development` 断言这些句子逐字仍在（规范 §6.3）。

- 不编造证据路径：只引用真实存在的文件，渲染器会机器校验
- 信息缺失一律写 [待确认: 具体问题]
- AI 最多把功能标为「可用」，「已验证」只能由人类确认
- 进度条只统计人类亲手验证过的功能
- 每条变更事实必须被收录或显式忽略，不允许静默遗漏
- 改动 Markdown 后必须立即重新渲染（渲染即审计）
- index.html 是机器产物（可选导出），禁止手工修改

## v1.5 变更（升级必读）

- 新增核心层 `static/core/writing.md`：AI 写进产物的文字（正文 / 时间线 / 简介 / 决策题干与选项 / 术语释义）先按它自查；准确的标准专业术语照常使用，禁的是自造词与圈内黑话。
- 新增三份规范：`references/copy-deck.md`（界面文案定稿）、`references/design-tokens.md`（设计令牌与组件规格）、`references/graph-visuals.md`（关系图视觉规范）。
- 新增 tab「⚖ 决策与待办」，位于「现在」与「术语表」之间；「现在」只保留时间线（单列整宽）。导航顺序以 `references/dashboard-format.md` 的「界面结构」一节为准：🏠 项目 → 🗺 功能地图 → ⚡ 现在 → ⚖ 决策与待办 → 📖 术语表 → ❓ 使用指南。
- 决策三态：`待拍板` / `已定 <选项>` / `已废弃`（已废弃可恢复成待拍板，废弃与恢复都在时间线留痕；旧的两态文件照常解析）；`- 多选: 是` 从开关降级为提示语，界面一律允许多选。
- 待办可在界面勾选：勾选 = 面板发一条 `command` 消息（不新增持久化、不新增信箱类型）；离线写 `.inbox.jsonl`，界面显示待办行「已报 · 待生效」与掌控条 `⏳ 待生效 N 条`。
- 掌控条新增 `⏱ 上次采集`（数据源 `health.facts_generated_at`）；页脚已删除，数据健康只在掌控条徽章与审计弹层两处出现。

## v1.3 变更（升级必读）

- FEATURES.md 功能块下可嵌套 `### 子项:`（五态、不写依赖；子项「已验证」同样必须有 `- 验证:` 行，否则 blocker）。功能 = 用户能验证的价值单元，开发步骤进时间线，不摊成小功能。
- 术语表（默认随 init 一并建立、可整份删掉）：独立 tab，顺序见 `references/dashboard-format.md` 的「界面结构」；按**表头契约**识别，文件名可自定义（`术语表.md` / `glossary.md` 都认）；正文出现别名（而非标准用词）进「用词漂移」警告（非阻断），并列出漂移明细与「让 AI 统一」按钮。
- `index.html` 降级为**可选导出**：`--html` 强制生成；不带参数时仅在该文件已存在时随渲染更新，不存在则不生成。日常界面是 DSH 面板。
- 新增机器文件：`.inbox.jsonl`（面板拍板/指令兜底信箱，update 开头收取并清空）、`.versions/`（版本快照，`snapshot_version.py` 维护；拍板落定后自动存一份）。

## v1.2 破坏性变更

- `- 状态: 已验证` 但没有 `- 验证:` 行 → 现在是 blocker（退出码 2），旧版只提示。
- 证据路径越界（绝对路径、盘符路径、UNC 网络路径、含 `..` 上跳）→ 现在是 blocker，一律按"证据不存在"处理。
- `.dashboard-ignore` 的 glob 改为最小语义：`*` 不跨目录、`**` 跨目录、`?` 单字符，**大小写敏感**、不支持 `[abc]` 字符类（Python 渲染与网页内刷新两端已统一）。

逐条语义见 `references/dashboard-format.md`（v1.5）。

## 兼容性声明

> 带 `scripts/` 的 skill 强制填写（规范 §6.4 / docs/06）。

- **解释器**：**Python 3.7+**（用到 `sys.stdout.reconfigure`、`subprocess.run(capture_output=True, text=True)`、`datetime.fromisoformat`，故最低 3.7；DSH 自带运行时满足）。脚本不写死解释器路径：看护脚本内部用 `sys.executable` 启动渲染器，人工/agent 调用时由调用方写出 DSH 自带 python.exe 的完整路径（Windows 上光写 `python` 可能落到系统 Python）。
- **依赖**：纯标准库（json/re/subprocess/pathlib 等），零第三方包，无需联网；git 为可选增强——有 git 用 git 采集，无 git 自动退化为文件修改时间扫描并在输出中声明来源。
- **降级**：无 git → mtime 采集（来源可见）；看护脚本不可用时 → workflow 本就要求"改完即渲染"，仪表盘依旧最新（注意：**网页不会自己变**——init 启动的看护任务只在它存活期间生效，会话结束或任务被回收后要说一句"更新一下仪表盘"）；不可审计 ≠ 通过——.facts.json 损坏、证据路径失效或越界、「已验证」缺验证记录、事实未归置都会报 BLOCKER（退出码 2），绝不静默放行。
- **未验证**：仅在 Windows + DSH 自带 Python 3 上实测（三个脚本 --self-test 全绿）；macOS / Linux 未实机验证（仅用跨平台 API，预期可用）；git 与 mtime 双采集分支均已在冒烟项目（plugins/control-your-development/smoke/served-demo）实测。

## 冒烟记录

见 `plugins/control-your-development/evals/`。
