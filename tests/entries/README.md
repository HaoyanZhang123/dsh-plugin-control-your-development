# tests/entries —— T09 入口集成（tab / 每轮影响 / `/threadline` 弹窗）

> 零第三方依赖：`node --test` + `tests/harness`（esbuild + CDP）。假 ctx / 假 DOM / 假 fetch 都在本目录。

## 跑什么

```bash
cd projects/dsh-plugin-control-your-development/plugin

# 单测（三个入口的注册参数 / 三态 / 命令 / 弹窗 / 跨入口 / 只读审计）
node --test "tests/entries/*.test.ts"

# 截图 + 证据（A43-1..5）
node tests/entries/run-t09.mjs
```

产物：`output/_verify/threadline/T09/`
`tab.png` `impact.png` `modal.png`
`tab.txt` `impact.txt` `modal.txt` `cross.txt` `entries.txt` `verify.txt`

## 文件

| 文件 | 作用 |
|---|---|
| `fake-ctx.ts` | 假 client ctx（`get/inject/effect/logger/slots`），记录注册项、effect 标签、disposer；假 `inputTriggers` 服务 |
| `fake-dom.ts` | 极简假 DOM：样式注入/移除、`[role="tab"]` 查询（不引 jsdom） |
| `fixtures.ts` | 确定性记录：3 轮 + `messageTurns` + `finalMessageId` + 命令/子智能体 |
| `tab.test.ts` | `conversation.view` 注册参数（name/id/order 30/label「脉络」）+ focus 协议 + `viewRequest` 只消费一次 |
| `impact.test.ts` | `assistant-actions` 注册参数（order 50）+ 计数口径 + 锚点（只渲染一次）+ 三态 + popover 内容 |
| `command.test.ts` | `inputTriggers` 注册参数 + `matchEnter`（`/threadline`、`/脉络`）+ 弹窗 store + `conversation.input.overlay` 注册 |
| `modal.test.ts` | 弹窗模型 + 渲染（加载/空/数据/隐私）+ 未闭环 + 折叠正文 |
| `cross.test.ts` | 跨入口：影响→tab、弹窗→完整脉络、focus 只消费一次、找不到 tab 不崩 |
| `entries.test.ts` | `apply(ctx)`：恰好三个 slot、样式注入/卸载归 0、slots 缺失只 warn、只读审计 |
| `entries/t09.entry.ts` | 截图夹具（`?view=tab|impact|modal`），假 fetch 顶替同源接口，`window.__t09` 只读探针 |
| `run-t09.mjs` | A43-1..5 采集：四命令 + 测试 + 三个截图（失败不落图、截图晚于代码改动） |

## 纪律

- 截图前等数据层落定（覆盖率文案稳定）与 120ms 过渡结束，保证**同一状态两次截图逐字节相同**；
- 不依赖真机 DSH：真机 slot 可见性由 T13 用户门验收（本目录只证明注册参数/清理/静态契约）。
