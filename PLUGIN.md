# 开发仪表盘面板（DSH 插件）

把 control-your-development 的仪表盘嵌进 DSH 右侧边栏，与 文件 / 终端 / 浏览器 同列。

- **按工作区显示**：读取**当前会话所属工作区**的 `dev-dashboard/`，换个项目就换一份看板；标签上带项目名，一眼看出是哪份。
- **自动刷新**：订阅宿主的文件变更流，三份 Markdown 一变就更新。
- **证据可打开**：点证据直接打开文件预览（走宿主公开服务），也可复制路径。
- **动作生成指令**：面板不能改文件，所以「我已验证」等动作会**复制一句话**，粘到聊天框发送由 AI 执行。
- **附带 skill**：插件激活时会把自带的 skill 装进全局技能目录（`<dshHome>/skills/`），任何工作区都能用——这是"一键安装"的最后一公里。

## 安装

DSH → Plugins → Add plugin → 粘贴：

```
https://github.com/HaoyanZhang123/dsh-control-your-development
```

也可以填**仓库根目录**的绝对路径（离线/开发用）。注意：仓库根就是插件包（`package.json` 在根），不要往子目录里指。

> 为什么这么设计：DSH 安装插件时在"装出来的包根目录"读 `package.json` 的 `dsh` 字段；读不到就只当普通依赖装上、**不挂载**。早先把插件放在 `panel/` 子目录时，pnpm 会生成一个占位 package.json（`_pnpmPlaceholder`），于是怎么填都装不上。

## 配套 skill 的安装策略

| 目标目录状态 | 行为 |
|---|---|
| 不存在 | 安装，并写入标记文件 `.installed-by-dsh-plugin-dev-dashboard.json` |
| 存在 + 有标记 + 版本相同 | 什么都不做 |
| 存在 + 有标记 + 版本不同 | 覆盖更新（插件自己的副本） |
| 存在 + **没有标记**（你自己放的） | **不动**它，只记一行日志 |

想保留自己的改动就把标记文件删掉（插件随后就不会再覆盖）。卸载插件不会删除这份 skill——那是你的环境，插件不越权删。

## 改了面板代码之后（开发须知）

客户端 bundle 是**页面加载时读进内存**的，所以改完必须两步：

1. 构建产物：`python tools/build_panel.py`（会把共享渲染核与样式内联进 `lib/client.js`）
2. 同步到 profile 后**刷新 DSH 页面（Ctrl+R）或重启 DSH** —— 不刷新的话右侧栏跑的还是旧代码

排查"改了没反应"时，先确认这两步做过。

## 两个必须守住的约定

1. **样式必须带作用域**：面板会把渲染核的 CSS 注入宿主页面，所以 `templates/dashboard.core.css` 里每条选择器都必须挂在 `.cyd-app` 下。渲染器自检会强制检查（出现未作用域选择器就让自检失败）。
2. **数据只能按会话读**：一律 `workspaceFiles.read(sessionId, 'dev-dashboard/...')`，不得写死任何路径。冒烟套件里有守门测试（`smoke/panel_paths_test.js`）。
