<p align="center">
  <img src="docs/images/cover.png" alt="封面：产品关系图（产品 / 功能 / 技术地图 / 现在），标题 CONTROL YOUR DEVELOPMENT" width="100%">
</p>

<h1 align="center">control-your-development</h1>
<p align="center">把开发过程变成你看得懂、能掌控的产品仪表盘。</p>
<p align="center">DSH 插件 + skill · npm 包名 <code>dsh-plugin-control-your-development</code> · <a href="README.md">English</a></p>
<p align="center">插件 <code>0.7.0</code> · skill <code>1.7.0</code> · DSH <code>&gt;=0.2.0-0</code></p>

> **维护者说明：** 这个版本不是很好用，大家先不用下这个插件，之后我会重构更好用的版本，感谢支持！

<p align="center">
  <a href="https://deepseek.com/harness/"><img alt="DSH · DeepSeek Harness" src="https://img.shields.io/badge/DSH-DeepSeek%20Harness-4B5563"></a>
  <a href="https://www.npmjs.com/package/dsh-plugin-control-your-development"><img alt="npm 版本" src="https://img.shields.io/npm/v/dsh-plugin-control-your-development"></a>
  <a href="https://github.com/HaoyanZhang123/dsh-plugin-control-your-development/releases"><img alt="GitHub Release" src="https://img.shields.io/github/v/release/HaoyanZhang123/dsh-plugin-control-your-development"></a>
  <a href="LICENSE"><img alt="许可证：MIT" src="https://img.shields.io/github/license/HaoyanZhang123/dsh-plugin-control-your-development"></a>
  <a href="https://www.python.org/"><img alt="Python 3 · 标准库" src="https://img.shields.io/badge/Python%203-stdlib-3776AB?logo=python&logoColor=white"></a>
  <a href="https://commonmark.org/"><img alt="事实源：Markdown" src="https://img.shields.io/badge/source%20of%20truth-Markdown-000000?logo=markdown&logoColor=white"></a>
</p>

<p align="center">
  <a href="#简介">简介</a> ·
  <a href="#核心特性">核心特性</a> ·
  <a href="#安装">安装</a> ·
  <a href="#使用方式">使用方式</a> ·
  <a href="#仓库结构">仓库结构</a> ·
  <a href="#版本与发布">版本与发布</a> ·
  <a href="#许可证">许可证</a>
</p>

## 简介

你在用 AI 做产品，但代码、提交记录和命令行不是你的语言。**control-your-development** 把项目自己的故事留在人话 Markdown 里——产品是干什么的、每个功能做到哪一步、最近变了什么、哪件事在等你拍板——再渲染成一张钉在 DSH 里的仪表盘。Markdown 由 AI 维护，你负责看仪表盘、做决定。

它由两件东西组成：一个 DSH **skill**（教 AI 建立并维护 `dev-dashboard/`）和一个可选的**面板插件**（把仪表盘嵌进右侧边栏，并在会话页顶部加一页整页功能地图）。面板、整页地图和可选的离线快照消费同一份带指纹的读模型（`.view.json`），同一份源数据下它们看到的是同一份内容；导出的快照冻结在导出时刻。

## 核心特性

- **Markdown 是唯一事实源。** `PRODUCT.md`（是什么、给谁用、往哪走）、`FEATURES.md`（每个功能的状态、证据与依赖）、`NOW.md`（时间线、决策与待办），默认还会建立 `GLOSSARY.md`、`TECH.md` 与 `CHANGES.md`。`index.html` 和 `.view.json` 是机器产物，永远不要手改。
- **进度由你定义。** 每个功能沿 设想 → 进行中 → 可用 → 已验证 前进。AI 最多只能标「可用」；「已验证」只有你亲口说过才算，进度条也只统计已验证的功能。撤销验证、返工和废弃都会在时间线留痕。
- **统一工作区（v0.7.0）。** 五个 tab——项目、功能地图、现在、决策与待办、术语表——外加右侧**上下文检查器**（是什么 / 为什么 / 证据在哪 / 能做什么）和底部可折叠的**进展与决策**抽屉。
- **功能地图与技术地图。** 五态功能卡、依赖边、可折叠子项，支持滚轮缩放、拖动平移、适应屏幕和真·窗口全屏。工具栏可切到「技术」视角：模块按层排开、依赖连成边，指向尚不存在的模块会画成断头桩。
- **整链聚焦。** 鼠标悬停或键盘 focus 节点时，临时预览它的祖先与后代；点击固定。只改透明度，不改任何节点坐标。
- **拍板直接送达 AI。** 勾选选项（默认允许多选）、写一句补充说明，点「发送拍板」就直接送进当前会话。会话不在线时先记进 `dev-dashboard/.inbox.jsonl`，下次更新自动收取；每次拍板还会自动存一份版本快照，可随时对比或恢复。
- **运行控制只作用于当前会话。** 停止当前轮次（保留队列）、停止并清空队列（先确认）、重试上一句。运行状态是会话的只读投影；观测不到时界面直接说「运行状态观测不到」，不猜。
- **一份带指纹的读模型。** 渲染器原子写出 `dev-dashboard/.view.json`，内含 `sourceHashes`；面板与离线页只消费它。读模型过期时保留旧图并明确标注，依赖过期上下文的动作被禁用；如果看板是更新版插件写的，就按只读处理，而不是默默读错。
- **诚实机制。** 每条代码变更必须被收录进仪表盘、或被显式忽略，不允许静默遗漏。证据文件找不到、事实没归置时，渲染会响亮报错；技术地图也会主动说出哪些模块的证据已经不存在。
- **单文件离线快照。** 说一句「导出网页版」得到一份 `index.html`：零依赖、零联网、深浅色自适应、打印友好。v0.7.0 起它是**只读快照**，首屏标出导出时间与来源版本——不再弹目录授权，也不能在页面里写回。
- **不改你的代码。** 它只读取变更记录，写的东西全部限定在 `dev-dashboard/` 一个目录里。没有 git 也能用：自动按文件修改时间采集，并在页面上标明来源。

## 安装

**前提：** DSH 桌面版。DSH 目前是 preview，插件 API 仍在演进。

1. 打开 **DSH → Plugins → Add plugin**。
2. 填 npm 包名：

   ```
   dsh-plugin-control-your-development
   ```

3. 插件激活时会把自带的 skill 装进全局技能目录（`<dshHome>/skills/`），所有工作区都能用。

走 npm 安装既不需要 git，也不需要连 GitHub；国内会自动命中镜像。其它安装方式：

| 装什么 | 怎么装 |
|---|---|
| 插件 + skill（推荐） | DSH → Plugins → Add plugin → `dsh-plugin-control-your-development` |
| 只装 skill，不要面板 | 把 `skill/control-your-development/` 拷到你项目的 `.dsh/skills/`（先建好目录） |
| 离线 / 另一台机器 | 从 npm registry 取 tarball（`https://registry.npmjs.org/dsh-plugin-control-your-development/-/dsh-plugin-control-your-development-0.7.0.tgz`），拷过去后在 Add plugin 里填它的**绝对路径** |

兼容性：插件的 DSH peer 依赖声明为 `>=0.2.0-0`，维护者已在 Windows + DSH `0.2.1-rc.2` 上实机安装过；macOS 与 Linux 走同一套代码路径，但 v0.7.0 没有留下实机运行记录。DSH 不会自动更新已装插件：升级 = 卸载旧版 → 重新 Add plugin → 刷新页面或重启 DSH。

完整说明（全局安装、离线安装、卸载与升级）见 [`INSTALL.md`](INSTALL.md)。

## 使用方式

1. 用 DSH 打开你的项目。
2. 对 AI 说 **"control my development"**（或「帮我建立开发仪表盘」）。AI 会建立 `dev-dashboard/`、写入 Markdown、渲染第一版仪表盘，并启动一个文件看护进程。
3. 右侧边栏面板显示**当前工作区**的仪表盘；换个项目就换一份。没建过仪表盘的工作区，面板里会给一个按钮，点一下就让 AI 建立。

之后用自然语言驱动：

| 你说 | 发生什么 |
|---|---|
| "control my development" | 在当前项目初始化仪表盘 |
| "这个阶段做完了，更新一下仪表盘" | 采集变更、更新 Markdown 并重新渲染；面板随即刷新 |
| "拍板 D1：选 A、C"（或在面板上发送） | 记录你的决定、存一份版本快照、继续开发 |
| "记账功能我验证过了" | 该功能标为「已验证」，进度条前进 |
| "存个版本" | 把当前 Markdown 存成快照，可对比、可恢复 |
| "导出网页版" | 在仪表盘旁写出一份单文件 `index.html` 快照 |

### 界面预览

下面是**演示项目的离线仪表盘**快照；右侧边栏面板渲染的是同一套核心界面，另外多出整页功能地图和当前会话的运行控制等宿主能力。仪表盘界面文案目前是中文；面板在 DSH 里的名称与描述跟随应用语言。

**项目** —— 一句话定位、当前方向与下一步、掌控条，以及真实使用流程。

<img src="docs/images/home.png" alt="「项目」tab：定位、方向、掌控条与使用流程" width="100%">

**功能地图** —— 五态功能卡、依赖关系与可折叠子项。

<img src="docs/images/features.png" alt="「功能地图」tab：五态功能卡、依赖关系图与子项徽标" width="100%">

**现在** —— 最近发生了什么的时间线。

<img src="docs/images/now.png" alt="「现在」tab：最近变更的时间线" width="100%">

**决策与待办** —— 等你拍板的决策、已定决策与未完成待办。

<img src="docs/images/decisions.png" alt="「决策与待办」tab：待拍板决策与未完成待办" width="100%">

**术语表** —— 标准用词，以及正文里的用词漂移。

<img src="docs/images/glossary.png" alt="「术语表」tab：标准用词与用词漂移" width="100%">

仪表盘永远由 Markdown 事实源重新生成。手改 `index.html` 或 `.view.json` 会在下次生成时被覆盖；想改内容就改 Markdown，或者直接告诉 AI 要改成什么。

## 仓库结构

```
dsh-plugin-control-your-development/
├─ package.json / cordis.patch.yml   ← 面板插件清单（仓库根就是插件包）
├─ lib/ src/ tools/                  ← 浏览器端 bundle / 源码 / 构建脚本
├─ skill/control-your-development/   ← 仪表盘能力本体
│  ├─ SKILL.md / manifest.yaml       ← skill 定义
│  ├─ static/                        ← AI 的工作纪律与流程
│  ├─ templates/                     ← Markdown 模板与共享渲染核
│  ├─ scripts/                       ← 生成网页 / 采集变更 / 自动看护（Python 标准库）
│  └─ references/                    ← 数据格式、界面文案与设计令牌
├─ docs/images/                      ← 封面与仪表盘截图
└─ INSTALL.md / CHANGELOG.md
```

## 版本与发布

当前版本是 **v0.7.0**；变更历史见 [`CHANGELOG.md`](CHANGELOG.md)，每个版本的发布说明在 [Releases 页面](https://github.com/HaoyanZhang123/dsh-plugin-control-your-development/releases)。升级需要卸载旧插件、重新安装新版本，然后刷新页面或重启 DSH。

## 许可证

[MIT](LICENSE) © 2026 dsh-plugin-control-your-development contributors。问题与建议请走 GitHub Issues。
