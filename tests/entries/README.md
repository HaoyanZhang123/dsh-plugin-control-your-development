# tests/entries —— T09 入口集成（tab / 每轮影响 / `/threadline` 命令）

> 零第三方依赖：`node --test` + `tests/harness`（esbuild + CDP）。假 ctx / 假 DOM / 假 fetch 都在本目录。
> T32（2026-11-05 notes/33 §1/§7）：`/threadline` **弹窗已删除**（`ui/modal/**` + `styles/modal.css` + `conversation.input.overlay` 注册全删），
> 命令触发改为跳「脉络」tab；本目录不再有 `modal.test.ts` 与 `?view=modal` 夹具。

## 跑什么

```bash
cd projects/dsh-plugin-control-your-development/plugin

# 单测（两个可见表面 + 命令的注册参数 / 三态 / 导航 / 跨入口 / 只读审计）
node --test "tests/entries/*.test.ts"

# 截图 + 证据（A43-1..4；modal 场景已删）
node tests/entries/run-t09.mjs
```

产物：`output/_verify/threadline/T09/`
`tab.png` `impact.png`
`tab.txt` `impact.txt` `cross.txt` `entries.txt` `verify.txt`

## 文件

| 文件 | 作用 |
|---|---|
| `fake-ctx.ts` | 假 client ctx（`get/inject/effect/logger/slots`），记录注册项、effect 标签、disposer；假 `inputTriggers` 服务 |
| `fake-dom.ts` | 极简假 DOM：样式注入/移除、`[role="tab"]` 查询（不引 jsdom） |
| `fixtures.ts` | 确定性记录：3 轮 + `messageTurns` + `finalMessageId` + 命令/子智能体（T30 起 `FileFamily` 用 text/code/data/media/other） |
| `tab.test.ts` | `conversation.view` 注册参数（name/id/order 30/label「脉络」）+ focus 协议 + `viewRequest` 只消费一次 |
| `impact.test.ts` | `assistant-actions` 注册参数（order 50）+ 计数口径 + 锚点（只渲染一次）+ 三态 + 点击导航（无 popover/dialog） |
| `command.test.ts` | `inputTriggers` 注册参数 + `matchEnter`（`/threadline`、`/脉络`）+ 触发 = `requestFocus(session)` + 切 tab（T32；0 个 slot 注册、无弹窗导出） |
| `cross.test.ts` | 跨入口：影响图标→tab、命令→tab、focus 只消费一次、找不到 tab 不崩（含文案包含匹配 + 下一帧重试） |
| `entries.test.ts` | `apply(ctx)`：恰好两个 slot（tab + 影响）、样式注入/卸载归 0、slots 缺失只 warn、只读审计、源码 0 处 overlay/modal |
| `privacy-wiring.test.ts` | 隐私 store/掩码（tab 共用 `maskTitle`/`maskPathFor`）、首帧打点、列表虚拟化、引用层 UI |
| `t13b.test.ts` | ErrorBoundary + 命令 inject 注册 + 影响按钮三态 + 诊断条 |
| `t13c.test.ts` | 影响 hidden 可观测 + 消息/会话兜底 + Portal SSR 兜底（Portal 组件仍在，T32 后无产品调用方） |
| `entries/t09.entry.ts` | 截图夹具（`?view=tab|impact`），假 fetch 顶替同源接口；`?view=impact` 自带假宿主 tab bar（证明图标点击会切 tab），`window.__t09` 只读探针；文件节点由夹具内的测试专用推导函数生成 |
| `run-t09.mjs` | A43-1..4 采集：四命令 + 测试 + 两个截图（失败不落图、截图晚于代码改动；T32 删除 modal 场景） |
| `run-t13b.mjs` / `run-t13c.mjs` | 历史真机轮次的证据采集脚本（只读源码 + 四命令/截图），文本已按 T20/T32 的事实更新 |

## 纪律

- 截图前等数据层落定（覆盖率文案稳定）与 120ms 过渡结束，保证**同一状态两次截图逐字节相同**；
- 不依赖真机 DSH：真机 slot 可见性由 T13 用户门验收（本目录只证明注册参数/清理/静态契约）。
