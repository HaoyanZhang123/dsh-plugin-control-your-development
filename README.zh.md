<p align="center">
  <img src="assets/images/threadline-cover.png" alt="脉络星图：工作区文件按目录分簇，叠加结构、共现、引用与时序四种关系边" width="100%">
</p>

<h1 align="center">脉络 · Threadline</h1>
<p align="center">永久只读地呈现一个 DeepSeek Harness 工作区实际是怎么长出来的。</p>
<p align="center"><a href="README.md">English</a></p>
<p align="center">
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white" alt="TypeScript"></a>
  <a href="https://react.dev/"><img src="https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white" alt="React 18"></a>
  <a href="https://github.com/deepseek-ai/deepseek-harness"><img src="https://img.shields.io/badge/DeepSeek%20Harness-%E6%8F%92%E4%BB%B6-4B6BFB" alt="DeepSeek Harness 插件"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-green" alt="MIT 许可证"></a>
  <a href="CHANGELOG.md"><img src="https://img.shields.io/badge/version-1.0.0--alpha.1-orange" alt="版本 1.0.0-alpha.1"></a>
</p>

## 简介

对话记录回答不了这个问题：**这个工作区到底经历了什么，每一轮改动了什么？**

脉络读取 DeepSeek Harness 已经记录下来的内容——会话、子智能体、工具调用、文件操作、命令、后台任务——把它变成当前工作区一张会生长的关系图。被 DSH 触碰过的文件成为节点、按目录分簇；轮次在底部排成一条带；每一个数字都能追溯到某条记录。

它是**永久只读**的：不写工作区、不写会话日志、不改设置、不调用模型、不发出任何外部请求；也没有开始 / 停止 / 重试这类控制面——**刻意一个都没有**。

适合的场景：回到一段很长的会话，或把一个工作区交给别人，想知道这些工作是怎么走过来的。

## 核心特性

- **工作区星图**——只画 DSH 真正触碰过的文件，按目录分簇；节点大小跟随操作次数，颜色跟随文件族。默认最多渲染 600 个活跃文件，超出时明确写出「显示 600/1200 个活跃文件」。
- **四层关系**——结构、共现（同一轮 / 同一会话）、引用（解析文件正文所得）、时序（同一轮内的先后）。**共现从不冒充依赖**；未确认的引用只列在检查器里，不画边。
- **轮次带**——一个会话的每一轮，带状态、时长，以及文件 / 命令 / 错误 / 子智能体标记；仍在记录的那一轮会明确标注「本轮仍在记录」。
- **三种检查器**——文件、轮次、会话；每个数字都给出对应的记录证据，另有「后续触碰」与「与上一轮对比」。
- **`/threadline` 命令**——把一段对话重建成结构化视图：起点、轮次轨迹、终点，以及它碰过的文件与仍未闭环的事项。
- **每轮影响**——每条已定稿的助手消息下方一个小图标，打开就是这一轮的影响，并可跳进完整脉络。
- **隐私模式**——默认只显示元数据、正文折叠；隐私模式下路径只显示文件名、命令只显示程序名、会话标题改为「会话 N」。
- **列表视图**——同一份数据的文件表与轮次表，键盘可达、读屏可读。
- **渐进加载**——插件一加载就开始扫描当前工作区并持续增量更新，打开 tab 时数据已经就绪。
- **诚实优先**——未加载、读取失败、观测不到、按参数估算，全部显式标注；**不用 0 或空态冒充未知**。

## 安装

前提：DeepSeek Harness **0.2.2-rc.1** 或更新版本（桌面版或 Web 版 profile）。

从 npm 安装：

```text
插件管理 → Add plugin → dsh-plugin-control-your-development@1.0.0-alpha.1
```

或直接装进 profile：

```bash
dsh plugin add dsh-plugin-control-your-development@1.0.0-alpha.1 --profile desktop
```

装完刷新页面（客户端代码生效）或重启 DSH（宿主代码生效）。

> DSH 已安装的插件不会自动更新。升级 = 卸载后重装，这是 DSH 的行为，不是脉络的限制。

## 使用方式

打开任意会话，点对话页的 **脉络 / Threadline** tab（在「对话」「轨迹」之后）。这个 tab 会占满会话区域并自己滚动；在 tab 内输入框会被隐藏，切回「对话」自动恢复。

<p align="center">
  <img src="assets/images/threadline-map.png" alt="脉络 tab：工作区星图，按目录分簇，底部是四层关系的图例" width="100%">
</p>

- 点节点 = 固定选中：邻居保持高亮、其余淡出，检查器切到该文件；`Esc` 逐层退出。
- 点轮次带里的一轮 = 高亮该轮碰过的文件，检查器切到该轮。
- 时间轴可以把工作区按时间回放；时间范围有 **今天 / 7 天 / 30 天 / 全部**。

另外两个入口用的是同一份数据：

- 在输入框敲 **`/threadline`** 打开「本次对话的脉络」——同一段对话按 起点 → 轮次轨迹 → 终点 重建，并列出它产出的文件与未闭环事项。
- 已定稿助手消息下方的**影响图标**打开单独一轮的影响。

<p align="center">
  <img src="assets/images/threadline-modal.png" alt="/threadline 弹窗：对话概要、轮次轨迹，以及本对话碰过的文件" width="70%">
</p>

脉络只读当前会话所属的**那一个工作区**；不会汇总其它工作区、其它 profile 或其它机器。

## 配置

不需要。没有配置文件、没有设置项、不保存偏好、不落任何缓存产物——所有筛选、选择与时间范围都只在内存里，刷新即重置。它唯一需要的就是它已经在的那个工作区。

## 项目结构

```text
plugin/
  src/shared/      事件归约、关系引擎、引用解析
  src/host/        只读扫描、内存索引、本地只读路由
  src/client/      数据层、界面、三个入口
  lib/             DSH 实际加载的构建产物（不要手改）
  tests/           单元、集成与截图夹具
```

## 发布

每个版本改了什么见 [CHANGELOG.md](CHANGELOG.md)，可安装的版本见 [Releases](https://github.com/HaoyanZhang123/dsh-plugin-control-your-development/releases)。`1.0.0-alpha.1` 是 alpha 预览版：界面与数据模型仍可能调整。

## 许可证

[MIT](LICENSE)
