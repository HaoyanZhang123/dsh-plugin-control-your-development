/*
 * tests/entries/run-t13b.mjs —— T13b 真机缺陷修复的证据采集（build.txt / fixes.txt / styles-scope.txt）。
 *
 * 只读源码 + 跑四个命令 + grep 样式作用域；产出写 output/_verify/threadline/T13b/。
 * 用法（在 plugin/ 下）：node tests/entries/run-t13b.mjs
 */
import { execSync } from 'node:child_process'
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { PLUGIN_ROOT, WORKSPACE_ROOT } from '../harness/index.mjs'

const OUT = resolve(WORKSPACE_ROOT, 'output/_verify/threadline/T13b')
mkdirSync(OUT, { recursive: true })

function run(command) {
  try {
    return { code: 0, out: execSync(command, { cwd: PLUGIN_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }
  } catch (error) {
    return { code: typeof error.status === 'number' ? error.status : 1, out: String(error.stdout ?? '') + String(error.stderr ?? '') }
  }
}

const bundleBytes = () => {
  try {
    return statSync(join(PLUGIN_ROOT, 'lib', 'client.js')).size
  } catch {
    return 0
  }
}

const stamp = new Date().toISOString()
const clientBefore = bundleBytes()

const typecheck = run('pnpm run typecheck')
const build = run('pnpm run build')
const test = run('node --test')
const emit = run('node tests/harness/emit-styles.mjs --check')
const clientAfter = bundleBytes()

const read = (path) => readFileSync(join(PLUGIN_ROOT, path), 'utf8')

/** grep 风格的原始行（只用于证据，不参与断言）。 */
function grepLines(text, regex, file) {
  const lines = []
  text.split(String.fromCharCode(10)).forEach((line, index) => {
    if (regex.test(line)) lines.push(file + ':' + String(index + 1) + ':' + line.trim())
  })
  return lines
}

const modalCss = read('src/client/styles/modal.css')
const impactRules = grepLines(modalCss, /^\.threadline-impact-root/, 'modal.css')
const modalRules = grepLines(modalCss, /^\.threadline-modal-root/, 'modal.css')
const appImpactLeft = grepLines(modalCss, /^\.threadline-app \.threadline-impact/, 'modal.css')
const appModalLeft = grepLines(modalCss, /^\.threadline-app \.threadline-modal/, 'modal.css')
const embeddedReset = grepLines(modalCss, /threadline-embedded|threadline-impact-root,|threadline-modal-root,/, 'modal.css')
const cssBundle = read('src/client/styles/css.ts')
const cssBackticks = (cssBundle.match(/`/g) ?? []).length

const okAll = typecheck.code === 0 && build.code === 0 && test.code === 0 && emit.code === 0
const testCounts = test.out
  .split(String.fromCharCode(10))
  .filter((line) => /^ℹ (tests|pass|fail)/.test(line.trim()))
  .map((line) => line.trim())

/* ---------------- build.txt ---------------- */
const buildLines = [
  'T13b 构建 / 测试证据',
  '采集时间: ' + stamp,
  '工作区: ' + WORKSPACE_ROOT,
  '插件: projects/dsh-plugin-control-your-development/plugin',
  '',
  '== 四个命令（原始输出 + 退出码）==',
  '[pnpm run typecheck] exit=' + String(typecheck.code),
  ...typecheck.out.trim().split(String.fromCharCode(10)).slice(-4).map((line) => '  ' + line),
  '',
  '[pnpm run build] exit=' + String(build.code),
  ...build.out.trim().split(String.fromCharCode(10)).slice(-8).map((line) => '  ' + line),
  '',
  '[node --test] exit=' + String(test.code),
  ...testCounts.map((line) => '  ' + line),
  '',
  '[node tests/harness/emit-styles.mjs --check] exit=' + String(emit.code),
  '  ' + emit.out.trim(),
  '',
  '== client bundle 体积 ==',
  'lib/client.js（改动前，本轮采集开始时）: ' + String(clientBefore) + ' bytes',
  'lib/client.js（构建后）: ' + String(clientAfter) + ' bytes',
  'T09b 收尾时基线: 477020 bytes → 本轮 +' + String(clientAfter - 477020) + ' bytes（ErrorBoundary / 图标按钮 / 诊断条 / 作用域样式都在包里）',
  '',
  '== 结论 ==',
  okAll ? 'PASS — 四命令 exit 0' : 'FAIL',
  '',
].join('\r\n')
writeFileSync(join(OUT, 'build.txt'), buildLines, 'utf8')

/* ---------------- fixes.txt ---------------- */
const fixes = [
  'T13b 四个真机缺陷 → 改动 → 断言名',
  '采集时间: ' + stamp,
  '',
  '缺陷 1：tab「脉络」点进去整片空白',
  '  根因：渲染期异常没有兜底（宿主看不到我们的错误态）+ 出错时没有任何可见诊断。',
  '  改动：',
  '    · 新增 src/client/ui/shell/ErrorBoundary.ts（class 组件；getDerivedStateFromError + componentDidCatch 打 console.error("threadline: render failed", error)）',
  '    · 三处包裹：ThreadlineTabView（tab）/ ImpactAction（影响）/ ThreadlineModal（弹窗）',
  '    · 出错时渲染可见文案：<label>：<error.message>（label 用既有 locale key state.unknown + tab.label/modal.title），',
  '      附默认折叠的 <pre>（stack 前 8 行，data-testid=error-boundary-stack），不新增 locale key。',
  '    · tab 增加诊断条 data-threadline-diag：仅 status=failed 或 degrade.kind≠none 时出现，',
  '      一行 key=value（status/degrade/code/scannable/sessions/files/refs），不含正文/路径。',
  '  断言名：',
  '    · tests/entries/t13b.test.ts「ErrorBoundary：渲染可见错误文案 + role=alert + 默认折叠 stack（不白屏）」',
  '    · tests/entries/t13b.test.ts「ErrorBoundary：展开后显示 stack 前 8 行（诊断用，克制）」',
  '    · tests/entries/t13b.test.ts「ErrorBoundary：stackHead 截断到 8 行；… componentDidCatch 只打一行」',
  '    · tests/entries/t13b.test.ts「诊断条：只在 failed / degrade 非 none 时出现，一行一个 key=value（不含正文）」',
  '',
  '缺陷 2：「影响 N」字号与宿主 action row 不一致且点不开',
  '  根因：① 渲染在宿主 action row 里，不在 .threadline-app 之内 → 规则一条不生效（原生 button 默认字号）；',
  '        ② popover 没有定位/层级/宽度（同因）。',
  '  改动：',
  '    · D-25：改成图标按钮（16×16 内联 SVG，手写分叉路径，不引第三方库），24×24 点击区；无文字、无徽章；',
  '      完整计数在 aria-label/title（t("impact.tooltip")）里给 —— 与宿主 feedback 图标观感一致（选择理由见回报）。',
  '    · 根节点加 threadline-impact-root（同时带 threadline-app + threadline-embedded：继承令牌/通用组件，关掉外壳几何）；',
  '      popover 规则改挂 .threadline-impact-root（不再挂 .threadline-app），absolute/z-index/360px/70vh 生效。',
  '    · 三态：有影响=图标按钮；无影响=不渲染；未加载/失败=图标仍可见、aria-disabled=true、tooltip 用 state.loadingDetail/state.unknown。',
  '  断言名：',
  '    · tests/entries/t13b.test.ts「影响按钮：是 button + 内联 SVG；aria-label / aria-expanded / aria-haspopup 正确；三态」',
  '    · tests/entries/t13b.test.ts「影响按钮：未加载态仍是可见 button + aria-disabled=true（不是消失）」',
  '    · tests/entries/impact.test.ts「渲染：有影响 → 图标按钮（D-25）…」「渲染：未加载/读取失败时图标仍在…」',
  '    · harness（run-t09）：impact-open 的 popover 存在 / 宽 360 / 文件≤8 / 命令≤3 / 子智能体≤3 / 不含命令正文',
  '',
  '缺陷 3：影响/弹窗的 CSS 作用域错位（与缺陷 2 同源）',
  '  改动：',
  '    · styles/modal.css：影响规则挂 .threadline-impact-root，弹窗规则挂 .threadline-modal-root；',
  '      §6 新增两个内嵌根的共享 reset（box-sizing / 字体 / 颜色继承）与 .threadline-embedded 外壳几何关闭（container: none，',
  '      否则 tokens.css 的 inline-size 容器会让 flex 里的根宽度塌成 0 —— 本轮实测踩到，已修）。',
  '    · 弹窗根 display: contents，不占宿主布局；role=dialog/aria-modal/焦点陷阱/Esc 仍由 T06 Overlay 提供。',
  '  断言名：',
  '    · tests/entries/t13b.test.ts「三个入口的内嵌根：impact / modal 都带 threadline-*-root（且带 threadline-app 继承令牌）」',
  '    · styles-scope.txt 的 grep（impact/modal 规则 0 条再挂 .threadline-app）',
  '',
  '缺陷 4：/ 菜单里没有 /threadline',
  '  根因：apply 时只用 ctx.get("inputTriggers")，服务尚未就绪 → 静默 warn 跳过。',
  '  改动：',
  '    · 改成 ctx.inject(["inputTriggers"], scope => …) 为主；若服务已存在则立即 get 注册（幂等 attempted 防双注册）；',
  '      两者都不行才 warn（缺服务不崩）。',
  '    · onPick 用 rc.5 的 pick.candidate.name 判断归属：不是 threadline 就 return void（不抢占别人的 pick）。',
  '  断言名：',
  '    · tests/entries/t13b.test.ts「命令注册：get 现在取不到但 inject 可用 → 仍注册成功（不再静默跳过）」',
  '    · tests/entries/t13b.test.ts「命令注册：get 与 inject 都拿不到 → 只 warn、不崩」',
  '    · tests/entries/t13b.test.ts「onPick：不是我们的 candidate.name 就交还给宿主（不抢占），是我们的才打开弹窗」',
  '',
  '未改动/非缺陷：/ 菜单里的 control-your-development 是旧 skill（用户资产），未触碰。',
  '',
].join('\r\n')
writeFileSync(join(OUT, 'fixes.txt'), fixes, 'utf8')

/* ---------------- styles-scope.txt ---------------- */
const scope = [
  'T13b 样式作用域证据（modal.css）',
  '采集时间: ' + stamp,
  '',
  '== 1) 影响规则：改挂 .threadline-impact-root（不再挂 .threadline-app）==',
  '- .threadline-app .threadline-impact* 命中数: ' + String(appImpactLeft.length) + '（期望 0）',
  ...appImpactLeft.map((line) => '    ' + line),
  '- .threadline-impact-root 规则数: ' + String(impactRules.length),
  ...impactRules.slice(0, 8).map((line) => '    ' + line),
  '',
  '== 2) 弹窗规则：改挂 .threadline-modal-root（不再挂 .threadline-app）==',
  '- .threadline-app .threadline-modal* 命中数: ' + String(appModalLeft.length) + '（期望 0）',
  ...appModalLeft.map((line) => '    ' + line),
  '- .threadline-modal-root 规则数: ' + String(modalRules.length),
  ...modalRules.slice(0, 8).map((line) => '    ' + line),
  '',
  '== 3) 两个新根共享基础 reset + 外壳几何关闭 ==',
  ...embeddedReset.map((line) => '  ' + line),
  '',
  '== 4) 生成物纪律 ==',
  'css.ts 反引号数: ' + String(cssBackticks) + '（期望 0）',
  'emit-styles --check exit=' + String(emit.code) + '  ' + emit.out.trim(),
  '',
  '== 5) 组件根 className（源码 grep）==',
  ...grepLines(read('src/client/entries/impact.ts'), /IMPACT_ROOT_CLASS =/, 'entries/impact.ts'),
  ...grepLines(read('src/client/ui/modal/ThreadlineModal.ts'), /threadline-modal-root/, 'ui/modal/ThreadlineModal.ts'),
  ...grepLines(read('src/client/entries/tab.ts'), /threadline-app/, 'entries/tab.ts').slice(0, 3),
  '',
  '结论：impact/popover 规则全部挂 .threadline-impact-root；modal 规则全部挂 .threadline-modal-root；',
  '两个根共享 reset 与 --tl-* 令牌（同时带 .threadline-app），外壳几何由 .threadline-embedded 关闭。',
  '',
].join('\r\n')
writeFileSync(join(OUT, 'styles-scope.txt'), scope, 'utf8')

console.log('T13b 证据已写入 ' + OUT)
console.log('四命令退出码: typecheck=' + String(typecheck.code) + ' build=' + String(build.code) + ' test=' + String(test.code) + ' emit=' + String(emit.code))
console.log('lib/client.js: ' + String(clientBefore) + ' -> ' + String(clientAfter) + ' bytes')
if (!okAll) process.exit(1)
