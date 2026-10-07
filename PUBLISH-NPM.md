# 发布到 npm（一次配置，之后一条命令）

> 目的：让别人在 DSH 的 Add plugin 里**只填包名** `dsh-plugin-dev-dashboard` 就能装，走 npm registry（国内自动命中镜像），**完全不碰 GitHub**。
> 本机环境事实：DSH 捆绑运行时里只有 **pnpm**（没有 npm）；`registry.npmjs.org` 与 `registry.npmmirror.com` 均可连通；包名 `dsh-plugin-dev-dashboard` **当前可用**。


> ⚠️ **必须在包根执行**：`release/dsh-control-your-development`（仓库根 = 包根，它自己是一个独立的 git 仓库）。
> 在工作区根 `skill开发` 下执行会报 **`ERR_PNPM_GIT_UNCLEAN` Unclean working tree**——因为那是另一个 git 仓库，且带着未提交改动。pnpm 发布前会检查 git 状态，这是它的保护机制，不是网络或权限问题。
> 想跳过该检查（不推荐）：加 `--no-git-checks`。

**一体化命令（先切目录再发布，复制整段即可）**

```powershell
Set-Location "E:\DSH\workspaces\myself\skill开发\release\dsh-control-your-development"
& "E:\DSH\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe" `
  "E:\DSH\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.mjs" `
  publish --access public
```

## 第 0 步：预检（我已经跑通，你随时可复跑）

```powershell
# 在仓库根执行（下面两个路径是 DSH 捆绑运行时里的）
& "E:\DSH\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe" `
  tools/preflight_publish.py `
  --pnpm "E:\DSH\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.mjs" `
  --node "E:\DSH\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
```

它会检查：`package.json` 必填字段 / `dsh.bundle` 与 `dsh.client` / `files` 是否带齐 `lib`、`skill`、`cordis.patch.yml` / 包名是否被占用 / 实际打包内容是否包含 `cordis.patch.yml`、`lib/client.js`、`lib/index.js`、`skill/**`。

## 第 1 步：认证（二选一）

### 方式 A：装了 Node（自带 npm）

```bash
npm login          # 浏览器里登录你的 npm 账号
```

### 方式 B：不装 Node，只用 DSH 捆绑的 pnpm（推荐，少一个依赖）

1. 打开 https://www.npmjs.com/settings/~/tokens → Generate New Token → **Granular Access Token**：
   - 权限：**Read and write**；Packages and scopes 选 **Only select packages** → 填 `dsh-plugin-dev-dashboard`（第一次发布时它还不存在，勾 *All packages* 或选"允许创建"即可）
   - 有效期按需（例如 7 天，发布完可吊销）
2. 把 token 写进**你自己的用户级** npm 配置（不会进仓库，也不会被提交）：

```powershell
& "<node.exe>" "<pnpm.mjs>" config set //registry.npmjs.org/:_authToken "<你的 token>"
```

> 安全提醒：token 只落在 `C:\Users\<你>\.npmrc`（macOS 是 `~/.npmrc`）。**不要**把它写进仓库里任何文件；用完后可在 npm 网站吊销。

## 第 2 步：发布（一条命令）

```powershell
# 在仓库根执行；publishConfig.access=public 已写好，--access public 只是保险
& "<node.exe>" "<pnpm.mjs>" publish --access public
```

## 第 3 步：验证（发布后立刻可查）

```powershell
# 官方源与国内镜像都应能查到（镜像通常几十秒内同步）
Invoke-WebRequest "https://registry.npmjs.org/dsh-plugin-dev-dashboard" -UseBasicParsing | Select-Object -ExpandProperty StatusCode
Invoke-WebRequest "https://registry.npmmirror.com/dsh-plugin-dev-dashboard" -UseBasicParsing | Select-Object -ExpandProperty StatusCode
```

然后告诉别人：**DSH → Plugins → Add plugin → 填 `dsh-plugin-dev-dashboard`**。

## 之后每次更新发版

```powershell
# 1) 改代码 → 重建产物 → 跑预检（第 0 步）
# 2) 升版本（npm 不允许同版本重复发布）
& "<node.exe>" "<pnpm.mjs>" version patch --no-git-tag-version   # 0.3.1 → 0.3.2
# 3) 发布
& "<node.exe>" "<pnpm.mjs>" publish --access public
```

> 别忘了同步升仓库里 `skill/control-your-development/manifest.yaml` 的版本（skill 与插件版本各自独立）。

## 常见问题

| 现象 | 原因 / 处理 |
|---|---|
| `E403` / `You do not have permission` | token 权限不足或没勾选该包；重新生成 Granular Token 并勾上 `dsh-plugin-dev-dashboard` |
| `EPUBLISHCONFLICT` | 这个版本已经发布过；升 version 再发 |
| `EOTP` | 账号开了双因素：用带 `--otp <6 位码>` 再发一次 |
| 发布成功但别人搜不到 | npm 页面/搜索有延迟；直接把包名告诉他即可，安装不看搜索 |
| 镜像上没有 | 等一两分钟；或让对方在 DSH 里改用官方源安装 |

