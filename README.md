# dsh-plugin-control-your-development

> 把开发过程翻译成你看得懂、能掌控的产品仪表盘。
> 三份人话 Markdown 是事实源，一键生成单文件离线网页；也可以把仪表盘钉在 DSH 窗口右侧，随时抬头可见。

版本：skill v1.2.0 · 面板插件 v0.4.2　|　许可：[MIT](LICENSE)　|　语言：[English](README.en.md)

---

## 这是什么

你在用 AI 做产品，但代码、提交记录、命令行都不是你的语言。**control-your-development** 把"开发做到哪了"翻译成一份产品视角的仪表盘：

- 这个产品是干什么的、现在往哪个方向走——一页说清；
- 每个功能做到哪一步，进度条只统计**你亲手验证过**的功能；
- 最近发生了什么变更、有什么事在**等你拍板**——打开就知道。

它是一个 DSH skill（教 AI 怎么替你维护仪表盘），外加一个可选的 DSH 内嵌面板（把仪表盘放进 DSH 窗口右侧边栏）。生成的网页是单个 HTML 文件，双击即开、不联网、可以直接发给合伙人或客户看。

## 30 秒上手

前提：你已安装 DSH 桌面版。

1. **装插件（一步搞定，配套 skill 会一起装好）**：DSH → 左侧 Plugins → Add plugin → 填 npm 包名：

   ```
   dsh-plugin-control-your-development
   ```

   走 npm registry，**国内自动命中镜像、不碰 GitHub**。插件激活时会把自己带的 skill 装进**全局技能目录**（`<dshHome>/skills/`）——**所有工作区都能用**，不用你手动拷目录。

   > 已在 **macOS 与 Windows 实机验证可用**；连不上 npm 时可用 Release 里的离线 `.tgz`（Add plugin 填文件绝对路径）。

2. 用 DSH 打开你的项目，对 AI 说一句：**"control my development"**（或"帮我建立开发仪表盘"）。

3. AI 会在项目里建好 `dev-dashboard/` 并生成 `index.html`；右侧边栏面板会自动显示**当前工作区**的看板——换个项目就换一份看板（没建过的项目，面板里会给你一个"复制指令"按钮）。

> 不想装插件也行：把 `skill/control-your-development/` 整个目录拷到你项目的 `.dsh/skills/` 下（**先建好 `.dsh\skills` 目录**，否则 PowerShell 会把整条路径当成新目录名、把 skill 平铺到错位置）。

更详细的安装方式（全局安装、面板插件、卸载与升级）见 [INSTALL.md](INSTALL.md)。

## 看一看

**仪表盘「项目」首页**：一句话定位、当前方向、掌控条。
<img width="2968" height="1736" alt="image" src="docs/images/home.png" />
**「功能地图」页**：功能卡片五态（设想 / 进行中 / 可用 / 已验证 / 已废弃）+ 依赖关系图。
<img width="2648" height="1078" alt="image" src="docs/images/features.png" />
**「现在」页**：时间线与等你拍板的决策卡。
<img width="2620" height="1256" alt="image" src="docs/images/now.png" />
**DSH 右侧边栏内嵌面板**（与 文件 / 终端 / 浏览器 同列，标签带当前项目名）。
<img width="1042" height="1088" alt="image" src="docs/images/panel.png" />

## 功能亮点

**三份人话文件，各管一件事**
- `PRODUCT.md`：门面——这是什么、给谁用、现在往哪走；
- `FEATURES.md`：状态——每个功能做到哪一步，附证据与依赖；
- `NOW.md`：动态——最近发生了什么、哪些事等你拍板。

**进度由你定义（状态机）**
每个功能的主路径是 设想 → 进行中 → 可用 → 已验证。AI 最多把功能标到「可用」；「已验证」三个字只有你亲口说过才算数，进度条也只统计已验证的功能。状态也能往回走：撤销验证退回「可用」（功能没坏，只是撤回盖章）、返工重做退回「进行中」、废弃归入「已废弃」、废弃的还能恢复为「设想」——每次回退都会在时间线留一笔。

**这次新增的能力**
- **按工作区显示**：面板读的是当前会话所属工作区的看板，标签上带**项目名**，一眼看出是哪份；换个项目自动跟着换
- **装插件即装 skill**：安装时把自带的 skill 放进全局技能目录（`<dshHome>/skills/`），所有工作区都能用；若那里已有**你自己改过的副本**，插件不会覆盖它
- **证据一键打开**：面板里点证据直接打开文件预览（也可以只复制路径）
- **覆盖性门禁**：工作区里的改动必须被收录进看板或明确标注忽略，否则渲染直接拦下（退出码 2）——不允许静默遗漏

**拍板中心**
AI 把需要你决定的事整理成选项卡：点选、补充、复制指令回复，三选一都支持。你的每个拍板都会记进时间线，有据可查。

**单文件离线网页**
仪表盘是一个 `index.html`：零依赖、零联网、深浅色自适应、打印友好。放进微信、邮件、U 盘都能原样打开。

**内嵌面板（可选）**
装上 `dsh-plugin-control-your-development` 后，仪表盘钉在 DSH 右侧边栏（与文件、终端同列）：文件一变自动刷新，动作按钮一键复制指令回聊天框——面板看、对话办，互不越权。

**诚实机制，漏了会报警**
- 每条代码变更都必须被收录进仪表盘、或被显式忽略，**不允许静默遗漏**；
- 证据文件被删、待办事实没归置时，生成过程会响亮报错，绝不放行一份"看起来没事"的仪表盘；
- 所有功能描述必须引用真实存在的文件作证据，编不出来。

## 安装

| 装什么 | 最快路径 |
|---|---|
| **插件 + skill（推荐，一步到位）** | DSH → Plugins → Add plugin → 填 `dsh-plugin-control-your-development`（npm 包名，国内走镜像；插件会把配套 skill 自动装到全局技能目录） |
| 只装 skill（不用面板） | 把 `skill/control-your-development/` 拷到项目的 `.dsh/skills/` |
| 离线安装（连不上 npm） | 下载 Release 附件里的 `.tgz`，Add plugin 里填它的**绝对路径** |
| ⚠️ 不推荐：填 GitHub 地址 | 需要本机装 git 且能连 GitHub；国内常失败——请改填 npm 包名 |

详解（全局安装、离线安装、卸载与升级）：[INSTALL.md](INSTALL.md)

## 日常使用

装好后，在 DSH 对话里用自然语言驱动：

| 你说 | AI 做 |
|---|---|
| "control my development" / "帮我建立开发仪表盘" | 初始化 dev-dashboard |
| "这个阶段做完了，更新一下仪表盘" | 采集变更、更新三份文件、重新生成网页 |
| "拍板 D1：选 A、C；补充：预算页面只要月度视图" | 记录你的决定并继续开发 |
| "记账功能我验证过了" | 把该功能标为「已验证」，进度条前进 |

仪表盘网页本身不用你动手维护——它是机器产物，永远由三份 Markdown 重新生成。

## 仓库里有什么

```
dsh-plugin-control-your-development/
├─ package.json / cordis.patch.yml   ← 面板插件清单（仓库根就是插件包，所以能一键装）
├─ lib/ src/ tools/                  ← 面板：浏览器端 bundle / 源码 / 构建脚本
├─ PLUGIN.md                         ← 面板说明与开发须知
└─ skill/
   └─ control-your-development/      ← 仪表盘能力本体
      ├─ SKILL.md / manifest.yaml    ← skill 定义
      ├─ static/                     ← AI 的工作纪律与流程
      ├─ templates/                  ← 三份人话文件模板 + 网页模板
      ├─ scripts/                    ← 生成网页 / 采集变更 / 自动看护（纯 Python 标准库）
      └─ references/                 ← 数据格式约定
```

## FAQ

**需要什么环境？**
DSH 桌面版。生成网页只用 DSH 自带的 Python，纯标准库、零安装、零联网。

**它会不会改我的代码？**
不会。它只读取变更记录，写的东西全部限定在 `dev-dashboard/` 一个目录里。

**项目没有 git 能用吗？**
能。有 git 就用 git 采集变更；没有 git 自动按文件修改时间采集，并在网页上标明来源。

**仪表盘会自己更新吗？**
会，但有前提。AI 每次改完三份 Markdown 都会立刻重新生成网页（"改完即渲染"），所以在对话里推进时，你看到的永远是最新的。init 时 AI 还会启动一个后台看护进程（`watch_dashboard.py`）：只要它还在运行，Markdown 一变就自动重新生成网页。看护进程停了（会话结束、后台任务被系统回收、机器重启），网页就不会自己变——那时对 AI 说一句"更新一下仪表盘"即可。

**v1.2 有什么破坏性变化？**
三处从"只提示"升级为硬报错（退出码 2）：① 标了「已验证」却没有验证记录；② 证据路径越界（绝对路径、盘符路径、网络路径、含上跳的路径）；③ `.dashboard-ignore` 的 glob 变小写敏感、不再支持 `[abc]` 这类字符类——升级后请检查你自己的 ignore 写法。详见 skill 内的 `references/dashboard-format.md`（v1.2）。

**`index.html` 能直接改吗？**
不能，它是机器产物，手改会在下次生成时被覆盖。想改内容就改三份 Markdown——通常你只要在对话里说一句，AI 会替你改。

**面板插件必须装吗？**
不必须。网页版双击就能用；面板只是让你不用切窗口，抬头即见。

**网页端点「🔄 更新」报错、或点了没反应？**
网页版要读写你项目里的 `dev-dashboard/`，需要你**授权文件夹访问**：浏览器会弹一次权限框，请选**包含 `dev-dashboard/` 的项目根目录**。授权后浏览器会记住它。右侧栏面板不需要授权——它走 DSH 自己的读接口。

**怎么更新到新版本？**
插件：DSH → Plugins → 卸载，再 Add plugin 填 `dsh-plugin-control-your-development`（也可指定版本 `dsh-plugin-control-your-development@0.4.2`）；更新后**刷新页面（Ctrl+R）或重启 DSH**。skill：跟随插件自动更新；手动装的那份重新拷一次即可。

**macOS / Linux 能用吗？**
能。**macOS 与 Windows 均已实机验证可用**（网页端 + 右侧栏面板）；Linux 未实机验证，但脚本只用跨平台 API、路径按可移植写法提供。

## 许可与贡献

[MIT](LICENSE) © 2026 dsh-plugin-control-your-development contributors。
问题与建议请走 GitHub Issues；维护者发布流程见 [RELEASE-CHECKLIST.md](RELEASE-CHECKLIST.md)。
