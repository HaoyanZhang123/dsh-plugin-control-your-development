<p align="center">
  <img src="assets/cover.png" alt="脉络封面：上方是力导向关系图，下方是双轨时间轴" width="100%">
</p>

<h1 align="center">脉络 / Threadline</h1>
<p align="center">只读的 DSH 插件：把一段对话对工作区做了什么，串成一条可下钻的时间线。</p>
<p align="center"><a href="README.md">English</a></p>

<p align="center">
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/Node.js-%E2%89%A524-339933?logo=node.js&logoColor=white" alt="Node.js 24+"></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white" alt="TypeScript 5.9"></a>
  <a href="https://react.dev/"><img src="https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white" alt="React 18"></a>
  <a href="https://esbuild.github.io/"><img src="https://img.shields.io/badge/esbuild-0.28-FFCF00?logo=esbuild&logoColor=black" alt="esbuild 0.28"></a>
  <a href="https://www.npmjs.com/package/dsh-plugin-control-your-development"><img src="https://img.shields.io/npm/v/dsh-plugin-control-your-development?color=CB3837&label=npm" alt="npm 版本"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-3DA639" alt="MIT 许可证"></a>
</p>

## 简介

脉络是 [DeepSeek Harness](https://github.com/deepseek-ai)（DSH）的插件，只回答一个很窄的问题：
**这段对话到底改了工作区里的什么？**

它把某一轮碰过的文件、跑过的命令、派生过的子智能体，以及轮次之间的关系收集起来，
在 DSH 会话页里呈现为一条可下钻的时间线。整个产品是**只读**的：不写工作区、不做任何存储、
不注册多余入口。

它面向的是让 agent 在仓库里干活、随后需要复核结果的人——不是排期、任务分派或写代码本身。

## 核心特性

- **当前目录的关系图**：确定性力导向布局，文件夹是圆角卡片、文件是圆点。
  边分三档（骨架 / 每个节点 top-3 共现 / 其余悬停淡入），总边数硬上限 `1.6 ×` 节点数，不会糊成蜘蛛网。
- **文件夹之间也有连线**：只用真实的跨目录关系聚合。没有真实关系的文件夹放在外围环上，
  **绝不伪造**连线。
- **节点上限 + 诚实的开关**：默认最多 40 个文件；常驻的 `显示 N/M` chip 可就地切到全部，
  并自动降级（关系密度、标签、半径）。硬上限 300。
- **双轨时间轴**：上轨是按时间分桶的活跃度柱状图，下轨每个会话一行，
  播放头只有一个标签，底部只留三个刻度。
- **轮次带「锁定优先」**：点一下锁定某一轮，悬停其他轮次不会抢走画面，再点一下释放。
  双击时间轴回到"最新"。
- **工作区文件浏览器**：从工作区根开始，可下钻任意深度，面包屑 / 回退 / 更新，
  卡片或列表两种视图，超过 200 行自动虚拟化。
- **零第三方运行时依赖**：`dependencies` 是空对象；React 与 `@deepseek-ai/*` 都是宿主提供的 peer 依赖。

## 安装

脉络是 DSH 插件。通过 DSH 插件管理器安装，或用 npm：

```bash
npm install dsh-plugin-control-your-development
```

环境要求：

- DSH 运行时 `0.2.1-rc.5` 或更新（`@deepseek-ai/dsh-session >= 0.2.0-0`）
- React 18 与 React DOM 18 由宿主提供（不打包进产物）

安装或替换包之后需要**重启 DSH**。替换一个已经加载过的插件必须重启进程，
仅刷新页面不会重新加载。

## 使用方式

三个表面，没有第四个入口：

| 表面 | 位置 | 看到什么 |
| --- | --- | --- |
| **脉络 tab** | `conversation.view`，id `threadline` | 左列：当前目录的关系图 + 双轨时间轴 + 轮次带。右列：工作区文件浏览器。左右两栏独立滚动。 |
| **影响计数** | 助手消息操作区，id `threadline-impact` | 这一轮碰了几个文件 / 跑了几条命令 / 派了几个子智能体。点击直接跳到「脉络」tab 并聚焦该轮，不弹窗。 |
| **`/threadline`** | 输入框命令（中文 `/脉络` 同效） | 跳到当前会话的「脉络」tab。 |

典型流程：

1. 打开一个会话，切到 **脉络** tab。
2. 左图显示当前目录。点文件夹卡片进入该目录，右栏跟着走。
3. 悬停文件高亮它的关系；点击钉住证据面板。
4. 点轮次带里的某一轮，锁定该轮的文件图；再点一次释放。
5. 拖动文件夹卡片或文件圆点可以重新摆位；`适应` 复位相机，`重置` 清掉拖动。

![脉络 tab：左侧是关系图与双轨时间轴，右侧是工作区文件浏览器](docs/images/overview.png)

### 文件夹之间也有连线

子文件夹很多的目录不会是一堆孤立的卡片：真正交换过文件的文件夹之间有连线，
于是能看出工作区里哪几块是连在一起动的。

![二十个文件夹枢纽，按真实跨目录关系连出的文件夹间连线](docs/images/folder-links.png)

### 单独看某一轮

点某一轮，左图切到该轮的文件，并叠加读/写行数。

![选中某一轮时的文件图，每个文件标注新增与删除行数](docs/images/turn-graph.png)

### 节点上限

超过 40 个文件的目录只保留最活跃的那些，并常驻一个 `显示 N/M` chip。
切到全部时，关系密度、标签与半径会自动降级。

![文件数超过节点上限的目录，切到全部显示后的状态](docs/images/show-all.png)

> 以上截图由真实组件渲染、使用合成的夹具数据，因此文件名是测试数据；界面本身不是示意图。

## 配置

无需配置。插件从 DSH 读取当前会话的工作目录，不需要环境变量、令牌或存储路径。

## 项目结构

```
plugin/
  src/host/       只读目录列举、路由、会话扫描
  src/client/     界面：关系图、时间轴、轮次带、文件浏览器、检查器
  src/shared/     关系模型、路径工具、解析器
  lib/            构建产物（生成物，禁止手改）
  tests/          node --test 套件与浏览器 harness
```

## 更新与发布

当前发布：**面板插件 v1.5.0**（稳定）。

- 更新记录：[CHANGELOG.md](CHANGELOG.md)
- GitHub Releases：https://github.com/HaoyanZhang123/dsh-plugin-control-your-development/releases

## 许可证

MIT —— 见 [LICENSE](LICENSE)。
