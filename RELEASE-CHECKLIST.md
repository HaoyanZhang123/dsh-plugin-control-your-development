# 发布前检查清单（RELEASE CHECKLIST）

> 维护者专用。每次推 GitHub / 发新版前，从上往下过一遍；任何一项不过就不发。
> 工作目录：开发工作区根（即本仓库内容的来源工作区）。
> 下文命令里的 `python` 是简写：请用 DSH 自带 Python 的 python.exe 完整路径调用（形如 `<dshHome>\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe`）——这正是"不用系统 python"的意思；系统 `python` 可能低于 3.7，脚本会跑不起来。

## 0. 发布前阻塞待办（未清不许发）

> **已发布（2026-10-07）**：https://github.com/HaoyanZhang123/dsh-plugin-control-your-development/releases/tag/v1.3.0
> 发布前已脱敏：去除本机路径示例、补全账号占位、提交身份使用 `HaoyanZhang123@users.noreply.github.com`。

- [ ] README 的 4 张截图仍缺（`docs/images/` 只有规范、没有 png）：项目首页 / 功能地图 / 现在 / 面板实拍
- [ ] `README.md`「看一看」里的截图占位说明未撤（截图补齐时要连占位一起删）
- [ ] 占位符 `HaoyanZhang123` 还有 5 处未替换（`README.md` 1 处、`INSTALL.md` 3 处、本清单 1 处；`README.en.md` 另有 `HaoyanZhang123` / `<your-project-path>`）

## 1. 门禁命令全绿

```
python .dsh/skills/control-your-development/scripts/render_dashboard.py --self-test
python .dsh/skills/control-your-development/scripts/collect_facts.py --self-test
python .dsh/skills/control-your-development/scripts/watch_dashboard.py --self-test
python tools/lint_skill.py .dsh/skills/control-your-development
python tools/contract_check.py .dsh/skills/control-your-development
```

- 三个 `--self-test` 必须全部通过（退出码 0）。
- `lint_skill.py` 必须 0 FAIL（跨目录引用、硬编码绝对路径/家目录都会被抓；自检夹具里故意写越界路径时，要在那一行加 `lint:allow-crossref` 标记）。
- `contract_check.py` 逐字断言 skill README 里的契约句仍在；改了 README 措辞要先想清楚是不是动了契约。

## 2. 版本号对齐

五处一致，缺一不发：

- [ ] `.dsh/skills/control-your-development/manifest.yaml` 的 `version`
- [ ] `.dsh/skills/control-your-development/README.md` 头部的版本行
- [ ] `plugins/dsh-plugin-control-your-development/package.json` 的 `version`
- [ ] `release/dsh-plugin-control-your-development/README.md` 头部的版本行
- [ ] `release/dsh-plugin-control-your-development/README.en.md` 头部的版本行

skill 与面板版本可以不同（本轮 skill 1.2.0 / panel 0.3.0），但每处自述必须等于实际。面板版本在 `package.json` 里、不属于 skill，改版时别漏。

## 3. 冒烟重跑

- [ ] 在冒烟项目 `plugins/control-your-development/smoke/served-demo` 完整走一遍 init → update → decide → verify
- [ ] `render_dashboard.py` 退出码为 0；掌控条"数据健康"为 ✅
- [ ] 双采集分支都验：有 git 一次、无 git（mtime 退化）一次
- [ ] 生成的 index.html 双击打开，四 Tab、关系图、拍板卡、深色模式、打印逐项肉眼过

## 4. 面板构建同步（D24 单一事实源）

- [ ] 模板四件（`dashboard.core.js` / `dashboard.core.css` / `dashboard.shell.html` / `dashboard.web.js`）本轮若有改动，必须重跑：

  ```
  python plugins/dsh-plugin-control-your-development/tools/build_panel.py
  ```

- [ ] `lib/client.js` 时间线新于 `src/client.src.js` 与全部模板四件
- [ ] 用发布仓的副本复核：`python release/dsh-plugin-control-your-development/（仓库根）/tools/build_panel.py` 产物与工作区 `lib/client.js` 逐字节一致
- [ ] 面板在本机 profile 实际加载过一轮：右侧标签出现、数据正确、changes() 自动刷新、动作按钮复制闭环

## 5. 发布仓内容同步

- [ ] `.dsh/skills/control-your-development/` → `release/dsh-plugin-control-your-development/skill/control-your-development/`（整目录覆盖式同步）
- [ ] `plugins/dsh-plugin-control-your-development/` → `release/dsh-plugin-control-your-development/（仓库根）/`（含 `src/`、`tools/`、`lib/`）
- [ ] 例外：发布仓的 `tools/build_panel.py` 是仓库布局适配版（查找 `skill/` 优先、兼容 `.dsh/skills/`），同步时保留该适配，不要用原版覆盖
- [ ] 面板目录带 MIT LICENSE：`（仓库根）/LICENSE` 已放副本；但 `package.json` 的 `files` 仍是 `lib` / `cordis.patch.yml` / `README.md`——**待办**：加 `LICENSE`（`package.json` 属面板范围，本轮未改；对照已装可用的 `dsh-plugin-whale-pet` 有 LICENSE）
- [ ] 机器产物不进仓：`dev-dashboard/` 的 `index.html` / `.facts.json` / `.state.json`、`node_modules/`、`*.cyd-backup` 一律不出现（`.gitignore` 已挡，仍肉眼确认 `git status`）

## 7. 一键安装形态（v1.3.0 起硬门槛）

- [ ] **仓库根就是插件包**：根目录存在 `package.json`（含 `dsh.bundle`）、`cordis.patch.yml`、`lib/index.js`、`lib/client.js`；插件**不再**放在子目录（子目录会让 pnpm 生成 `_pnpmPlaceholder` 占位清单，DSH 读不到 `dsh.bundle` → 装不上）
- [ ] **`files` 字段包含 `skill`**：否则安装时不会打包配套 skill，"插件自动装 skill"就失效
- [ ] **实装验证**：`pnpm add <本仓库路径或 URL>` 后，装出来的包内必须有 `package.json`（含 `dsh.bundle`）、`cordis.patch.yml`、`lib/client.js`、`skill/control-your-development/SKILL.md` 四项
- [ ] **行为验证**：DSH → Plugins → Add plugin → 粘贴仓库 URL → 右侧栏出现「开发仪表盘 · <项目名>」；换一个工作区会话，看板跟着换
- [ ] 面板路径守门测试通过：`node smoke/panel_paths_test.js`（sessionId 传递 + dev-dashboard/ 前缀 + 无写死路径 + 标签带项目名）
- [ ] CSS 作用域断言通过：`render_dashboard.py --self-test`（未作用域选择器会让自检失败）

## 6. 文档与链接

- [ ] 仓内相对链接全部有效（README / README.en / INSTALL / docs 互链）
- [ ] README 与 INSTALL 里的命令在干净临时目录真实跑过一遍（拷目录 → self-test → 模板渲染）
- [ ] 截图已补齐到 `docs/images/` 并替换 README 的占位说明
- [ ] `HaoyanZhang123` 等占位全部替换为真实 GitHub 组织/用户名

## 7. 仓库元数据（首次发布）

- [ ] 仓库名 `dsh-plugin-control-your-development`，Public
- [ ] 描述：把开发过程翻译成你看得懂、能掌控的产品仪表盘（DSH skill + 面板插件）
- [ ] topics：`dsh` `dsh-skill` `dsh-plugin` `dashboard` `ai-productivity`
- [ ] 默认分支 `main`；首次推送 `git status` 干净、`.gitignore` 生效
- [ ] Releases 建 `v1.3.0` tag（对应本轮 skill 1.2.0 / panel 0.3.0），附本轮变更摘要

## 8. 发布后立即做

- [ ] 从 GitHub 地址重新克隆到临时目录，按 INSTALL.md 全流程复验一次（证明仓内内容自足）
- [ ] 面板 npm 发布排期评估（方式 2 解锁后更新 INSTALL.md 状态）
