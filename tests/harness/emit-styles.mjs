/*
 * emit-styles.mjs —— 把 styles/*.css 逐字转成 styles/css.ts（运行时注入用的字符串）。
 *
 * 为什么需要它：`tools/build.mjs` 冻结，入口只有 src/client/index.ts，没有 CSS loader；
 * 可客户端注入 CSS 只能靠 JS 字符串。于是：
 *   唯一事实源 = styles/tokens.css + styles/base.css（人写、好审、可 grep）
 *   生成物     = styles/css.ts（GENERATED 头，JSON.stringify 转义，禁手改）
 * tests/ui-shell/styles.test.ts 用同一份转换实现（styles-codegen.ts）逐字比对，漂移即红。
 *
 * 用法（在 plugin/ 下）：
 *   node tests/harness/emit-styles.mjs          # 写盘
 *   node tests/harness/emit-styles.mjs --check  # 只比对，不写（漂移退 1）
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { CSS_MODULE_PATH, buildStylesModule } from './styles-codegen.ts'

const next = buildStylesModule()

if (process.argv.includes('--check')) {
  const current = readFileSync(CSS_MODULE_PATH, 'utf8')
  if (current !== next) {
    console.error('styles: DRIFT — css.ts 与 tokens.css/base.css 不一致；跑 node tests/harness/emit-styles.mjs 重建')
    process.exit(1)
  }
  console.log('styles: OK — css.ts 与 tokens.css/base.css 逐字一致')
} else {
  writeFileSync(CSS_MODULE_PATH, next, 'utf8')
  console.log('styles: 已写入 src/client/styles/css.ts（' + next.length + ' chars）')
}
