<p align="center">
  <img src="assets/images/threadline-cover.png" alt="脉络 2.0：左文件关系图 + 右两列目录卡片 + 轮次状态与悬停联动" width="100%">
</p>

<h1 align="center">脉络 · Threadline</h1>
<p align="center">永久只读地呈现一个 DeepSeek Harness 工作区实际是怎么长出来的。</p>
<p align="center"><a href="README.md">English</a></p>
<p align="center">
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white" alt="TypeScript"></a>
  <a href="https://react.dev/"><img src="https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white" alt="React 18"></a>
  <a href="https://github.com/deepseek-ai/deepseek-harness"><img src="https://img.shields.io/badge/DeepSeek%20Harness-%E6%8F%92%E4%BB%B6-4B6BFB" alt="DeepSeek Harness 插件"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-green" alt="MIT 许可证"></a>
  <a href="CHANGELOG.md"><img src="https://img.shields.io/badge/version-1.0.0-blue" alt="版本 1.0.0"></a>
</p>

## 简介

对话记录回答不了这个问题：**这个工作区到底经历了什么，每一轮改动了什么？**

脉络读取 DeepSeek Harness 已经记录下来的内容——会话、子智能体、工具调用、文件操作、命令、后台任务——把它变成当前工作区一张会生长的关系图。被 DSH 触碰过的文件成为节点、按目录分簇；轮次在底部排成一条带；每一个数字都能追溯到某条记录。

它是**永久只读**的：不写工作区、不写会话日志、不改设置、不调用模型、不发出任何外部请求；也没有开始 / 停止 / 重试这类控制面——**刻意一个都没有**。

适合的场景：回到一段很长的会话，或把一个工作区交给别人，想知道这些工作是怎么走过来的。

## 核心特性

- **左图 · 文件关系图** —— 默认显示当前会话最活跃的目录；点右卡切换目录，点轮次切成该轮涉及的跨目录文件。
  确定性径向布局，无缩放/平移/簇框/网格；节点颜色 = 5 类文件族（文本 / 代码 / 数据 / 媒体 / 其它）。
- **右栏 · 两列目录卡片** —— 目录名、文件数、本轮徽章、操作数/最近活动、5 族构成条、前 3 个最活跃文件。
  与左图同屏，整页只有一条滚动；<960px 上下堆叠。
- **轮次状态只在可证事实上叠加** —— `读 N` / `写 +A/−D 行` / `首见`；文件级删除/新增不可证，不显示。
  摘要条固定单行：`读 N · 写 +A/−D 行 · 首见 F · 删除 C`（完整语义在 tooltip）。
- **双向 hover 联动** —— 悬停卡片预览该目录；悬停节点高亮所属目录卡与相关轮次；悬停轮次预览该轮文件并高亮相关目录。
  hover 只预览，不改变点击选择、不滚动页面。
- **每轮影响入口** —— 已定稿助手消息下的图标；点击直接切到「脉络」tab 并聚焦该轮，不打开任何窗口。
- **`/threadline` 命令** —— 保留为快捷入口：切到「脉络」tab 并聚焦当前会话；不再有弹窗。
- **隐私模式 / 列表视图 / 渐进加载 / 诚实优先** —— 与 1.0 相同：路径/标题可掩码，文件与轮次表键盘可达；
  未加载、读取失败、观测不到都显式标注，不用 0 或空态冒充未知。

## 安装

前提：DeepSeek Harness **0.2.2-rc.1** 或更新版本（桌面版或 Web 版 profile）。

从 npm 安装：

```text
插件管理 → Add plugin → dsh-plugin-control-your-development@1.0.0
```

或直接装进 profile：

```bash
dsh plugin add dsh-plugin-control-your-development@1.0.0 --profile desktop
```

装完刷新页面（客户端代码生效）或重启 DSH（宿主代码生效）。

> DSH 已安装的插件不会自动更新。升级 = 卸载后重装，这是 DSH 的行为，不是脉络的限制。

## 使用方式

打开任意会话，点对话页的 **脉络 / Threadline** tab（在「对话」「轨迹」之后）。tab 占满会话区域并自己滚动；tab 内的输入框隐藏，切回「对话」自动恢复。

<p align="center">
  <img src="assets/images/threadline-map.png" alt="脉络 2.0：左文件关系图与右两列目录卡片，全页单滚动" width="100%">
</p>

- 左图看当前目录的文件关系；点右侧任意目录卡切换目录；点轮次块切到该轮的文件图并叠加状态。
- 鼠标悬停卡片、节点或轮次会临时预览并联动高亮；点击才固定选择，离开整块视图恢复。
- 时间轴把工作区按时间回放；范围有 **今天 / 7 天 / 30 天 / 全部**。
- `/threadline` 命令 = 跳到 tab；每轮「影响」图标 = 跳到 tab 并聚焦该轮。

<p align="center">
  <img src="assets/images/threadline-turn.png" alt="轮次视图：读 / 写行 / 首见状态与删除命令计数" width="100%">
</p>

脉络只读当前会话所属的**那一个工作区**；不汇总其它工作区、profile 或机器。

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

当前版本：**面板插件 v1.0.0**（正式版）。

每个版本改了什么见 [CHANGELOG.md](CHANGELOG.md)，可安装的版本见 [Releases](https://github.com/HaoyanZhang123/dsh-plugin-control-your-development/releases)。

## 许可证

[MIT](LICENSE)
