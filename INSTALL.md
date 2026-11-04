# 安装详解

> 脉络（Threadline）是一个 **DSH 插件**：装进 DSH profile 即生效，没有单独的 skill、没有需要拷贝的目录、没有需要配置的路径。
> 返回 [README.zh.md](README.zh.md) · [English README](README.md) · [English quick reference](#english-quick-reference)

前提：DeepSeek Harness **0.2.2-rc.1** 或更新版本（桌面版或 Web 版 profile 都可）。

---

## 一、用插件管理器安装（推荐）

1. 打开 DSH → 插件管理（插件图标）；
2. 点 **Add plugin**；
3. 填入包名与版本：

   ```text
   dsh-plugin-control-your-development@1.0.0-alpha.1
   ```

4. 安装完成后：**刷新页面**（客户端代码生效）；如果宿主侧也更新了，需要**重启 DSH**。

## 二、用命令行安装

```bash
dsh plugin add dsh-plugin-control-your-development@1.0.0-alpha.1 --profile desktop
```

把 `desktop` 换成你实际使用的 profile 名（Web 版通常是 `web`）。

## 三、从源码安装（开发/试用最新提交时）

把 profile 的依赖指向本地开发树，然后刷新页面：

```powershell
# profile 目录里的 package.json：把依赖改成 link
#   "dsh-plugin-control-your-development": "link:E:/path/to/plugin"
cd "$env:DSH_HOME\profiles\desktop"
pnpm install
```

> 开发树里 `lib/index.js` 与 `lib/client.js` 是构建产物，改完源码要先构建：
> `cd <plugin> && pnpm install && pnpm run build`。

## 四、升级与卸载

- **升级**：DSH 已安装插件**不会自动更新**。升级 = 先卸载，再按上面的方法装新版本，然后刷新页面 / 重启 DSH。
- **卸载**：插件管理里移除该插件，刷新页面即可；脉络不写任何本地数据，所以卸载不会留下残留（也不会带走你的任何记录）。

## 五、确认安装成功

打开任意会话，对话页顶部应出现 **脉络 / Threadline** tab（在「对话」「轨迹」之后）。

- 有 tab、点进去有星图与轮次带 → 安装成功；
- 有 tab 但显示「观测不到工作区记录」 → 通常是宿主侧还没生效，重启 DSH 再试。

---

## English quick reference

Threadline is a **DSH plugin**. There is no separate skill to install and nothing to configure.

Requirements: DeepSeek Harness **0.2.2-rc.1** or newer.

1. **Plugin manager** → Add plugin → `dsh-plugin-control-your-development@1.0.0-alpha.1` → reload the page (restart DSH if host-side code changed).
2. **CLI** — `dsh plugin add dsh-plugin-control-your-development@1.0.0-alpha.1 --profile desktop`
3. **From source** — point the profile dependency at `link:<path>` and run `pnpm install` in the profile, then reload.

Upgrading means uninstalling and reinstalling: installed DSH plugins do not update automatically. Threadline stores nothing locally, so uninstalling leaves no residue behind.

Verify: open any conversation — a **脉络 / Threadline** tab appears next to 对话 / 轨迹.
