# 安装详解

> 本仓库包含两部分：**skill**（必装，仪表盘能力本体）和**面板插件**（可选，把仪表盘嵌进 DSH 窗口右侧边栏）。
> 两者互相独立：只装 skill 就有完整功能；面板只是让体验更顺手。
> [English quick reference](#english-quick-reference) · 返回 [README](README.md)

---

## 一、安装 skill

> **打算用面板插件？直接跳到[第二节](#二安装面板插件推荐)**——插件激活时会自动把这份 skill 装到全局技能目录（`<dshHome>/skills/`），无需手动拷贝。本节是"不装插件"或"想指定装到某个项目"时的做法。

skill 就是一个目录：`skill/control-your-development/`。拷到对的位置即可，无需安装任何依赖。

### 方式 A：项目级（推荐第一次使用）

只对当前项目生效，方便试用与删除。

**目标位置：** `<你的项目>\.dsh\skills\control-your-development\`

> `<你的项目>` 是占位符，替换成你项目根目录的真实路径。下面的命令都要求**在项目根目录执行**、用相对路径 `.dsh\skills\`，所以不会凭空建出别的目录。

Windows（PowerShell）：

```powershell
git clone https://github.com/HaoyanZhang123/dsh-control-your-development.git
# 在你的项目根目录执行：
New-Item -ItemType Directory -Force .dsh\skills
Copy-Item -Recurse dsh-control-your-development\skill\control-your-development .dsh\skills\
```

macOS（Terminal）：

```bash
git clone https://github.com/HaoyanZhang123/dsh-control-your-development.git
# 在你的项目根目录执行：
mkdir -p .dsh/skills
cp -R dsh-control-your-development/skill/control-your-development .dsh/skills/
```

装好后，用 DSH 打开该项目，对 AI 说 **"control my development"** 即可开始。

### 方式 B：全局（所有项目都能用）

把同一个目录拷到 DSH 的全局 skills 目录 `<dshHome>/skills/` 下：

| 系统 | 默认 `<dshHome>` | skill 目标位置示例 |
|---|---|---|
| Windows | `C:\Users\<你>\.dsh` | `C:\Users\<你>\.dsh\skills\control-your-development\` |
| macOS | `~/.dsh` | `~/.dsh/skills/control-your-development/` |

> 如果你在安装 DSH 时自定义过 home 目录，就用你的实际路径。
> 不确定时：打开 DSH 任意会话问一句"我的 dshHome 在哪"，或查看 DSH 设置页。

Windows（PowerShell；下面按**默认 dshHome** 写。你的 dshHome 若是自定义值，把两处 `$env:USERPROFILE\.dsh` 都换成你的实际 dshHome 再执行）：

```powershell
# 按你的实际 dshHome 调整：默认是 $env:USERPROFILE\.dsh
New-Item -ItemType Directory -Force "$env:USERPROFILE\.dsh\skills"
Copy-Item -Recurse dsh-control-your-development\skill\control-your-development "$env:USERPROFILE\.dsh\skills\"
```

macOS：

```bash
mkdir -p ~/.dsh/skills
cp -R dsh-control-your-development/skill/control-your-development ~/.dsh/skills/
```

**同名覆盖规则**：如果项目级和全局都装了，项目级优先。这让你可以在某个项目里试用新版，其他项目继续用稳定版。

### 验证 skill 装好了

用 DSH 打开装了 skill 的项目，输入 `/` 看斜杠菜单里有没有 **control-your-development**，或直接对 AI 说"帮我建立开发仪表盘"。斜杠菜单只显示当前工作区已装的 skill。

---

## 二、安装面板插件（可选）

面板插件叫 **dsh-plugin-control-your-development**，装好后仪表盘出现在 DSH 右侧边栏（与 文件 / 终端 / 浏览器 同列），文件一变自动刷新。

统一入口：**DSH 侧边栏 → Plugins → Add plugin**。

### 方式 1：npm 包名（推荐，一行搞定且不依赖 GitHub）

在 Add plugin 里直接填：

```
dsh-plugin-control-your-development
```

走 npm registry，**国内会自动命中镜像**（已发布 0.3.1，官方源与 npmmirror 均可查）。包已自带配套 skill，安装后插件会把它放进全局技能目录。

### 方式 2：仓库地址（能连 GitHub 时可用）

在 Add plugin 里粘贴：

```
https://github.com/HaoyanZhang123/dsh-control-your-development
```

**这一条同时也把 skill 装好了**：插件激活时会把自带的 skill 放进全局技能目录 `<dshHome>/skills/control-your-development/`，于是**任何工作区都能用**，不需要再手动拷目录。

安全策略（避免覆盖你的东西）：只在"该目录不存在"或"是插件装的且插件版本变了"时才写入；如果那里已经有你自己放的一份（没有插件的标记文件），插件**不会动它**，只会跳过并记一行日志。

### 方式 3：本地路径（离线 / 开发用）

1. 克隆本仓库：`git clone https://github.com/HaoyanZhang123/dsh-control-your-development.git`
2. DSH → Plugins → Add plugin
3. 填**仓库根目录**的绝对路径（仓库根就是插件包，不要再往子目录里指）：
   - Windows：`<你克隆到的目录>\dsh-control-your-development`
   - macOS：`~/repos/dsh-control-your-development`

> 为什么是仓库根：DSH 安装插件时会在"装出来的包根目录"读 `package.json` 的 `dsh` 字段，读不到就只当普通依赖装上、不挂载。本仓库已把插件包放在根目录，所以上面两种填法都成立。

### 装好后

右侧边栏会出现「开发仪表盘」标签页（四格仪表盘图标），标签上会带上**当前工作区项目名**。打开任意项目会话，面板读的就是**该项目**的 `dev-dashboard/`；还没建立仪表盘的项目会显示一个"复制指令"按钮，粘到聊天框发送即可建立。

---

## 三、卸载与升级

### skill

- **卸载**：删掉对应目录即可（项目级 `.dsh/skills/control-your-development/` 或全局 `<dshHome>/skills/control-your-development/`）。你项目里已生成的 `dev-dashboard/` 不受影响。
- **升级**：用新版本的 `skill/control-your-development/` **整个覆盖**旧目录。推荐"先删旧目录、再拷贝"，避免旧版残留文件混在新版里（在项目根目录执行）：

  ```powershell
  Remove-Item -Recurse -Force .dsh\skills\control-your-development
  New-Item -ItemType Directory -Force .dsh\skills
  Copy-Item -Recurse dsh-control-your-development\skill\control-your-development .dsh\skills\
  ```

  macOS / Linux：

  ```bash
  rm -rf .dsh/skills/control-your-development
  mkdir -p .dsh/skills
  cp -R dsh-control-your-development/skill/control-your-development .dsh/skills/
  ```

  一条命令的等价写法（`/MIR` 会删除目标里多出来的文件，执行前确认目标就是你那个 skill 目录）：
  `robocopy dsh-control-your-development\skill\control-your-development .dsh\skills\control-your-development /MIR`

  **升级会丢什么**：项目里的 `dev-dashboard/`（三份 Markdown、`index.html` 和你在里面补的数据）不在 skill 目录内，一律不受影响；skill 目录里你自己改过的文件（例如手动调过的模板）会被新版本覆盖丢失——升级前先备份该目录。升级后重新生成一次网页即生效。

### 面板插件

- **禁用 / 启用**：Plugins 页开关，即时生效，无需重启。
- **卸载**：Plugins 页点卸载。插件卸载后，它装到全局技能目录的那份 skill **不会被自动删除**（那是你的环境，插件不越权删）；想一并清理就手动删掉 `<dshHome>/skills/control-your-development/`。
- **升级**：已装插件不会自动更新——在 Plugins 页卸载后按方式 1 重新粘贴仓库地址即可；插件带的 skill 会在下次激活时自动更新到新版本。
- **本地路径安装的升级**：先 `git pull`，再卸载重装一次。

---

## 四、装不上怎么办（排障）

按可能性从高到低：

1. **macOS 没有 git**：从仓库地址安装需要 pnpm 调用 git；macOS 默认不带 git。用**归档压缩包地址**安装即可，这条路不需要 git（已实测）：

   ```
   https://github.com/HaoyanZhang123/dsh-control-your-development/archive/refs/tags/v1.3.1.tar.gz
   ```

   或者先装 git（`xcode-select --install`）再重试。
2. **DSH 版本过旧**：本插件用到右侧边栏的标签注册与文件变更订阅接口，需要带这套接口的 DSH（0.2.x 起）。在 设置 → 关于 里确认版本；过旧就先升级 DSH。
3. **本地路径安装**：克隆仓库后，Add plugin 填**仓库根目录**的绝对路径（仓库根就是插件包）。
4. **把报错原文发出来**：Add plugin 的失败信息（或 DSH 日志里 `plugin-manager`/`dev-dashboard` 相关行）能直接定位问题；只说"装不上"就得靠猜。

> 只想用仪表盘、不想要面板？只装 skill 就行（第一节），它对 DSH 版本没有额外要求。

### 如果连 GitHub 都连不上（国内网络常见）

"浏览器能打开 GitHub" ≠ "终端里的 git/pnpm 能连上"。三种不依赖 GitHub 的安装方式：

**路 1：离线安装包（最稳，谁都能用）**
拿到 `dsh-plugin-control-your-development-0.3.1.tgz`（本仓库 Releases 附件，或直接找作者要），然后：

- Add plugin 里填**这个文件的绝对路径**，例如 `/Users/你/Downloads/dsh-plugin-control-your-development-0.3.1.tgz`
- 只想装 skill：把 tgz 解压（`tar -xzf ...`），把里面的 `package/skill/control-your-development` 拷到你的 skills 目录即可

**路 2：npm 包名（发布到 npm 后可用）**
Add plugin 里填 `dsh-plugin-control-your-development`。该方式走 npm registry，国内会自动命中镜像，完全不碰 GitHub。

**路 3：GitHub 加速代理**
把仓库地址交给任意 GitHub 代理（例如 `https://gh-proxy.com/<原始地址>`）再填进 Add plugin。第三方代理可用性会变，只作最后手段。

> 把 Add plugin 的报错原文发出来能省一半时间：超时/证书/404 分别指向不同原因。

## English quick reference

**Plugin + skill (recommended, one step)** — DSH → Plugins → Add plugin → paste `https://github.com/HaoyanZhang123/dsh-control-your-development`; the plugin installs the bundled skill into `<dshHome>/skills/` for every workspace. Details in the sections above (Chinese).

**Skill only (no panel)** — copy the folder, nothing to install:

| Scope | Target location |
|---|---|
| Per-project (recommended first) | `<your-project>/.dsh/skills/control-your-development/` |
| Global (all projects) | `<dshHome>/skills/control-your-development/` (Windows default `%USERPROFILE%\.dsh\skills\`, macOS `~/.dsh/skills/`) |

```bash
# macOS / Linux, per-project:
mkdir -p .dsh/skills && cp -R dsh-control-your-development/skill/control-your-development .dsh/skills/
```

When both exist, the project-level copy wins — handy for trying a new version in one project only.

**Panel plugin (optional)** — DSH → Plugins in the sidebar → Add plugin, then one of:

1. **Local absolute path** (works today, recommended): `<clone>/panel/dsh-plugin-control-your-development`
2. **Package name** `dsh-plugin-control-your-development` (once published to npm)
3. **Git URL** — requires the plugin to sit at the repo root; this repo bundles skill + panel, so use option 1 for now.

**Uninstall / upgrade**: delete the skill folder (your project's `dev-dashboard/` is untouched); overwrite to upgrade. The panel is toggled/uninstalled from the Plugins page; installed plugins don't auto-update — to upgrade, uninstall and reinstall the new version.
