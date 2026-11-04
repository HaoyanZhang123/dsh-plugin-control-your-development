# tests/ui-turn —— T08 单测 / 截图 / 证据（轮次带 + 检查器）

> 零第三方依赖：`node --test`（Node 24 原生 TS）+ `tests/harness`（esbuild + CDP）。

## 跑什么

```bash
cd projects/dsh-plugin-control-your-development/plugin

# 单测（目录实参不可用，必须引号 glob）
node --test "tests/ui-turn/*.test.ts"

# 截图 + 证据（A42-1..4；断言失败不落图）
node tests/ui-turn/run-t08.mjs

# 一条命令收口：typecheck / build / emit-styles --check / 两套测试 / 采集 → verify.txt
node tests/ui-turn/verify.mjs
```

产物：`output/_verify/threadline/T08/`
`turns.png` `turns-narrow.png` `inspector-file.png` `inspector-file-bottom.png`
`inspector-turn.png` `inspector-turn-bottom.png` `inspector-session.png` `inspector-overview.png`
`turns.txt` `inspector.txt` `evidence.txt` `keyboard.txt` `screenshots.txt` `verify.txt`

## 文件

| 文件 | 作用 |
|---|---|
| `fixtures.ts` | 确定性夹具：30 轮（26 完成 / 2 中止 / 1 未知 / 1 运行）、子智能体、错误、命令失败、未确认引用、外部来源、归档会话；关系边用 `shared/relations` 的真构造器生成 |
| `turns-model.test.ts` | 状态判定（完成只来自 `endKind==='completed'`）、对数宽度（最小 8px）、标记槽位、tooltip 字段、会话选择器/分组、默认选择 |
| `selection.test.ts` | 选择归约器：hover 预览 / click 固定 / 空白取消 / **Esc 逐层**（预览→固定→关检查器→上交）/ 方向键环绕 |
| `inspector-model.test.ts` | 三种检查器 + 概览的字段齐全、触碰历史 ≤50、后续触碰 ≤20、上一轮对比、关系证据逐条等于边自带文本、未确认不画边、隐私掩码、未知不退化成 0 |
| `inspector-render.test.ts` | SSR 结构断言：标签都在、正文默认折叠、隐私模式隐藏、状态文案不同、轮次带 30 块/四态/唯一选中/roving tabindex |
| `copy-source.test.ts` | 源码里没有中文字面量、没有禁用词、引用的 locale key 全部存在、没有颜色字面量/存储/剪贴板；两份 CSS 都挂 `.threadline-app` 前缀、只用容器查询 |
| `entries/t08.entry.ts` | 截图/键盘夹具（`?view=turns|inspector|keyboard`，`?scroll=bottom`，`?privacy=1`）；`window.__t08` 只读探针 |
| `run-t08.mjs` | A42-1..4 采集：断言 + 截图（sha256/时间戳/晚于代码改动）+ 四份 txt |
| `verify.mjs` | 三命令 + 两套测试 + 采集，写 `verify.txt`（中途不编辑源文件） |

## 纪律

- 断言失败不落图；截图必须晚于最后一次代码改动（`run-t08.mjs` 自己校验并判红）。
- 一个 URL 参数组合 = 一个可复现状态；图与断言条目一一对应（见 `verify.txt` §5）。
- 只写 `output/`；不碰源码、不写浏览器存储。
