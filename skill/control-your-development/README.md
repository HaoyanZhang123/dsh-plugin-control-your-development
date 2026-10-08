# control-your-development

> 一句话定位：把开发过程翻译成用户看得懂、能掌控的产品仪表盘（人话 Markdown → DSH 面板，可选导出单文件 HTML）。
> 所属项目：control-your-development　版本：1.3.0　状态：分发级

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
| `static/core/workflow.md` | 主流程（判定场景→执行→渲染→收尾） | 每次 |
| `static/fragments/mode/` | 四个场景 fragment：init / update / decide / verify | 轴匹配时只读一篇 |
| `references/dashboard-format.md` | dev-dashboard 数据格式契约 | 初始化或改 Markdown 前 |
| `templates/` | Markdown 模板（PRODUCT/FEATURES/NOW，可选 GLOSSARY）+ HTML 渲染模板 | init 场景复制 |
| `scripts/` | render_dashboard / collect_facts / watch_dashboard / snapshot_version | 按 fragment 调用 |

## 契约句清单

> 重构后跑 `python tools/contract_check.py .dsh/skills/control-your-development` 断言这些句子逐字仍在（规范 §6.3）。

- 不编造证据路径：只引用真实存在的文件，渲染器会机器校验
- 信息缺失一律写 [待确认: 具体问题]
- AI 最多把功能标为「可用」，「已验证」只能由人类确认
- 进度条只统计人类亲手验证过的功能
- 每条变更事实必须被收录或显式忽略，不允许静默遗漏
- 改动 Markdown 后必须立即重新渲染（渲染即审计）
- index.html 是机器产物（可选导出），禁止手工修改

## v1.3 变更（升级必读）

- FEATURES.md 功能块下可嵌套 `### 子项:`（五态、不写依赖；子项「已验证」同样必须有 `- 验证:` 行，否则 blocker）。功能 = 用户能验收的价值单元，开发步骤进时间线，不摊成小功能。
- 新增**可选** `GLOSSARY.md` 术语表：正文出现别名（而非标准用词）进「用词漂移」警告（非阻断）。
- `index.html` 降级为**可选导出**：`--html` 强制生成；不带参数时仅在该文件已存在时随渲染更新，不存在则不生成。日常界面是 DSH 面板。
- 新增机器文件：`.inbox.jsonl`（面板拍板/指令兜底信箱，update 开头收取并清空）、`.versions/`（版本快照，`snapshot_version.py` 维护；拍板落定后自动存一份）。

## v1.2 破坏性变更

- `- 状态: 已验证` 但没有 `- 验证:` 行 → 现在是 blocker（退出码 2），旧版只提示。
- 证据路径越界（绝对路径、盘符路径、UNC 网络路径、含 `..` 上跳）→ 现在是 blocker，一律按"证据不存在"处理。
- `.dashboard-ignore` 的 glob 改为最小语义：`*` 不跨目录、`**` 跨目录、`?` 单字符，**大小写敏感**、不支持 `[abc]` 字符类（Python 渲染与网页内刷新两端已统一）。

逐条语义见 `references/dashboard-format.md`（v1.3）。

## 兼容性声明

> 带 `scripts/` 的 skill 强制填写（规范 §6.4 / docs/06）。

- **解释器**：**Python 3.7+**（用到 `sys.stdout.reconfigure`、`subprocess.run(capture_output=True, text=True)`、`datetime.fromisoformat`，故最低 3.7；DSH 自带运行时满足）。脚本不写死解释器路径：看护脚本内部用 `sys.executable` 启动渲染器，人工/agent 调用时由调用方写出 DSH 自带 python.exe 的完整路径（Windows 上光写 `python` 可能落到系统 Python）。
- **依赖**：纯标准库（json/re/subprocess/pathlib 等），零第三方包，无需联网；git 为可选增强——有 git 用 git 采集，无 git 自动退化为文件修改时间扫描并在输出中声明来源。
- **降级**：无 git → mtime 采集（来源可见）；看护脚本不可用时 → workflow 本就要求"改完即渲染"，仪表盘依旧最新（注意：**网页不会自己变**——init 启动的看护任务只在它存活期间生效，会话结束或任务被回收后要说一句"更新一下仪表盘"）；不可审计 ≠ 通过——.facts.json 损坏、证据路径失效或越界、「已验证」缺验证记录、事实未归置都会报 BLOCKER（退出码 2），绝不静默放行。
- **未验证**：仅在 Windows + DSH 自带 Python 3 上实测（三个脚本 --self-test 全绿）；macOS / Linux 未实机验证（仅用跨平台 API，预期可用）；git 与 mtime 双采集分支均已在冒烟项目（plugins/control-your-development/smoke/served-demo）实测。

## 冒烟记录

见 `plugins/control-your-development/evals/`。
