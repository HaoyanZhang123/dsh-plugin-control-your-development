# smoke/ —— 脉络 1.0 的门禁入口

> 唯一入口：`python smoke/run_all_checks.py`（根 `tools/ready.py --quick` 也调它）。
> 任何一项 FAIL → 退出码 1；SKIP 单独计数并写原因，**跳过不算通过**。

## 项（名称固定，可按名字引用）

| 项 | 实际命令 | 说明 |
|---|---|---|
| `插件单测（pnpm run test）` | `pnpm run test`（= `node --test` 无参递归） | 全部 `plugin/tests/**/*.test.ts` |
| `类型检查（pnpm run typecheck）` | `pnpm run typecheck` | host / client / test 三套 tsconfig |
| `样式产物一致（emit-styles --check）` | `node tests/harness/emit-styles.mjs --check` | `styles/*.css` ↔ `css.ts` 逐字一致 |
| `集成链路（tests/integration）` | `node --test tests/integration/*.test.ts` | reducer→scan→graph→UI 数据 + N-01..N-19 |
| `只读证明（G-1）` | `python smoke/readonly_check.py` | 写/存储/控制/外网/fs 五组，加路由审查与产物 |
| `旧路径归零（G-5）` | `python smoke/legacy_zero.py` | 旧读模型/渲染器/离线页/文案；包名走白名单 |
| `构建确定性（build ×2 + sha256）` | `pnpm run build` ×2 + sha256 | `--quick` 时 SKIP 并写原因 |

## 反向自审（改门禁时必须两侧都跑）

```bash
python smoke/readonly_check.py --self-test   # 喂 writeFileSync/localStorage/session.prompt/外部 fetch/node:fs → 必须全部抓到
python smoke/legacy_zero.py --self-test      # 喂 .view.json/render_dashboard/… → 必须红；合法包名必须走白名单
python smoke/run_all_checks.py --self-test   # 喂已知失败项 → 必须 FAIL 且汇总退出码 1
```

反向自审**不写任何产物、不落图、不用静默 SKIP**；原始输出与退出码见
`output/_verify/threadline/T11/gate-self-audit.txt`。

## 已删除的旧套件

`smoke/**` 里属于旧「开发仪表盘」的套件（CDP 真机断言、`.view.json` 读模型门禁、
旧 skill 文案门禁、离线页/统一工作区 UI、宿主 RPC、意图投影、假 LLM、边缘套件、served-demo、`__pycache__`）
已删除；**删前清单 + sha256 + 用途 + 依赖检查**在
`output/_verify/threadline/T11/legacy-smoke-removed.txt`。

## 与根 ready.py 的关系

- `tools/ready.py --quick` → 本入口 `--quick`（跳过构建确定性）。
- `tools/ready.py --cdp` 会找 `smoke/cdp_verify.mjs`；该文件随旧套件删除，**`--cdp` 不再适用**
  （真机验收按 06 §16 的用户门执行，不进门禁）。
