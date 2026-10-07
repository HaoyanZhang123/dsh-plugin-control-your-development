# 安装详解

> 本仓库包含两部分：**skill**（必装，仪表盘能力本体）和**面板插件**（可选，把仪表盘嵌进 DSH 窗口右侧边栏）。
> 两者互相独立：只装 skill 就有完整功能；面板只是让体验更顺手。
> [English quick reference](#english-quick-reference) · 返回 [README](README.md)

---

## 一、安装 skill

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

面板插件叫 **dsh-plugin-dev-dashboard**，装好后仪表盘出现在 DSH 右侧边栏（与 文件 / 终端 / 浏览器 同列），文件一变自动刷新。

统一入口：**DSH 侧边栏 → Plugins → Add plugin**，它接受三种填法：

### 方式 1：本地路径（今天就能用，推荐）

1. 克隆本仓库：`git clone https://github.com/HaoyanZhang123/dsh-control-your-development.git`
2. DSH → Plugins → Add plugin
3. 填入面板目录的**绝对路径**，例如：
   - Windows：`<你克隆到的目录>\panel\dsh-plugin-dev-dashboard`
   - macOS：`~/repos/dsh-control-your-development/panel/dsh-plugin-dev-dashboard`

### 方式 2：包名（待 npm 发布后可用）

Add plugin 里直接填：`dsh-plugin-dev-dashboard`

> 面板尚未发布到 npm；发布后会更新本节。安装时会自动探测 npm 镜像，国内网络无需额外配置。

### 方式 3：Git 地址（待面板独立成仓后可用）

Add plugin 支持填 Git 地址，但要求**仓库根目录就是插件包**。本仓库是 skill + 面板的合体仓（面板在子目录里），直接填本仓库地址无法识别。
过渡期请用方式 1；后续计划：面板发布 npm（方式 2）或拆出独立仓库后再开放此方式。

### 装好后

右侧边栏会出现「开发仪表盘」标签页（四格仪表盘图标）。打开任意项目会话，面板会自动读取该项目的 `dev-dashboard/`；还没建立仪表盘的项目会显示空态提示。

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
- **卸载**：Plugins 页点卸载。
- **升级**：已装插件不会自动更新。升级 = 在 Plugins 页卸载后，按上面任一方式重新安装新版。
  - 本地路径安装的注意：如果当时填的是克隆目录的路径，先 `git pull` 拿到新版，再卸载重装一次即可。

---

## English quick reference

**Skill (required)** — copy the folder, nothing to install:

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

1. **Local absolute path** (works today, recommended): `<clone>/panel/dsh-plugin-dev-dashboard`
2. **Package name** `dsh-plugin-dev-dashboard` (once published to npm)
3. **Git URL** — requires the plugin to sit at the repo root; this repo bundles skill + panel, so use option 1 for now.

**Uninstall / upgrade**: delete the skill folder (your project's `dev-dashboard/` is untouched); overwrite to upgrade. The panel is toggled/uninstalled from the Plugins page; installed plugins don't auto-update — to upgrade, uninstall and reinstall the new version.
