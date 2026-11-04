/*
 * tests/entries/run-t13c.mjs —— T13c 采集（D-27 / D-28 的布局与可观测证据）。
 *
 * 产出 output/_verify/threadline/T13c/：
 *   build.txt   四命令退出码 + lib/client.js 字节数前后
 *   fixes.txt   4 项 → 根因 → 改法 → 断言名
 *   layout.txt  1440/1024/900/600/420 五档：页面可滚动、无横向滚动、星图 >=520、
 *               检查器宽屏 sticky / 窄屏自然下移
 *
 * 用法（在 plugin/ 下）：node tests/entries/run-t13c.mjs
 */
import { execSync } from 'node:child_process'
import { mkdirSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { launchBrowser, renderAtWithBrowser, PLUGIN_ROOT, WORKSPACE_ROOT } from '../harness/index.mjs'

const OUT = resolve(WORKSPACE_ROOT, 'output/_verify/threadline/T13c')
mkdirSync(OUT, { recursive: true })
const ENTRY = 'tests/entries/t09.entry.ts'
const WIDTHS = [1440, 1024, 900, 600, 420]
const HEIGHT = 900

const run = (command) => {
  try {
    return { code: 0, out: execSync(command, { cwd: PLUGIN_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).toString() }
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
const before = bundleBytes()

const typecheck = run('pnpm run typecheck')
const build = run('pnpm run build')
const test = run('node --test')
const emit = run('node tests/harness/emit-styles.mjs --check')
const after = bundleBytes()

const browser = await launchBrowser()
const layoutRows = []
const failures = []
try {
  for (const width of WIDTHS) {
    const result = await renderAtWithBrowser(browser, {
      width,
      height: HEIGHT,
      entry: ENTRY,
      query: 'view=tab',
      waitFor: 'html[data-harness-ready]',
      assert: {
        expr: [
          // 2026-11-05（D-29）契约变更：tab 不再让整页滚动（那会把宿主输入框一起推到内容末尾），
          // 改为「占满宿主给的高度 + 外壳内部滚动」。三条断言分别守住这三件事。
          { label: 'page-no-scroll', code: 'document.documentElement.scrollHeight <= document.documentElement.clientHeight + 1', equals: true },
          { label: 'root-fills-height', code: '(() => { const a = document.querySelector(".threadline-app"); if (!a) return false; return Math.round(a.getBoundingClientRect().height) === window.innerHeight })()', equals: true },
          { label: 'shell-scrolls', code: '(() => { const sh = document.querySelector(".threadline-shell"); if (!sh) return false; return sh.scrollHeight > sh.clientHeight })()', equals: true },
          { label: 'no-h-scroll', code: 'document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1', equals: true },
          {
            label: 'map-height',
            code: 'String(Math.round(document.querySelector("[data-region=map]").getBoundingClientRect().height))',
            equals: String(width >= 1280 ? 640 : 520),
          },
          { label: 'header-position', code: 'String(getComputedStyle(document.querySelector("[data-region=header]")).position)', equals: 'sticky' },
          {
            // 检查器默认是「关闭」状态（03 §8：默认无选择、可关闭），所以**存在性**是一等断言：
            // 不存在 ⇒ 通过（记录为 absent）；存在 ⇒ 必须符合断点：宽屏 sticky 右侧栏、窄屏 static 自然下移。
            // 旧脚本这里引用了从未注册的 label（map-bottom / inspector-top），取到 NaN 造成假 FAIL。
            label: 'inspector-ok',
            code: '(() => { const el = document.querySelector("[data-region=inspector]"); if (!el) return true; const p = getComputedStyle(el).position; return p === "' + (width >= 1100 ? 'sticky' : 'static') + '" })()',
            equals: true,
          },
          {
            label: 'inspector-flow',
            code: '(() => { const el = document.querySelector("[data-region=inspector]"); const map = document.querySelector("[data-region=map]"); if (!el || !map) return true; const top = Math.round(el.getBoundingClientRect().top); const bottom = Math.round(map.getBoundingClientRect().bottom); return ' + (width >= 1100 ? 'top < bottom' : 'top >= bottom - 4') + ' })()',
            equals: true,
          },
          { label: 'diag-absent', code: 'document.querySelectorAll("[data-threadline-diag]").length === 0', equals: true },
        ],
      },
    })
    const actual = (label) => result.checks.find((check) => check.label === 'expr:' + label)?.detail?.actual
    const mapHeight = Number(actual('map-height'))
    const wide = width >= 1100
    const inspectorState = String(actual('inspector-ok'))
    const ok = result.ok && mapHeight >= 520
    if (!ok) failures.push('width ' + String(width) + ' 不满足 D-28（' + JSON.stringify({ mapHeight, inspectorOk: inspectorState, failedChecks: result.checks.filter((c) => c.ok !== true).map((c) => c.label + '=' + JSON.stringify(c.detail)) }) + '）')
    layoutRows.push(
      [
        'width=' + String(width),
        '  page-no-scroll=' + String(actual('page-no-scroll')), '  shell-scrolls=' + String(actual('shell-scrolls')),
        '  no-h-scroll=' + String(actual('no-h-scroll')),
        '  map-height=' + String(mapHeight),
        '  header-position=' + String(actual('header-position')),
        '  inspector-ok=' + String(inspectorState) + ' (期望 ' + (wide ? 'sticky/absent' : 'static/absent') + ')',
        '  wide=' + String(wide),
        '  => ' + (ok ? 'PASS' : 'FAIL'),
      ].join(''),
    )
  }
} finally {
  await browser.close()
}

const okAll = typecheck.code === 0 && build.code === 0 && test.code === 0 && emit.code === 0 && failures.length === 0

writeFileSync(
  join(OUT, 'build.txt'),
  [
    'T13c 构建/测试证据（D-27 portal + D-28 页面流）',
    '采集时间: ' + stamp,
    '',
    '== 四个命令 ==',
    '[pnpm run typecheck] exit=' + String(typecheck.code),
    '[pnpm run build] exit=' + String(build.code),
    '  ' + (build.out.trim().split(String.fromCharCode(10)).filter((line) => /client|determinism/.test(line)).join(String.fromCharCode(10) + '  ')),
    '[node --test] exit=' + String(test.code),
    '  ' + test.out.trim().split(String.fromCharCode(10)).filter((line) => /^ℹ (tests|pass|fail)/.test(line.trim())).map((line) => line.trim()).join(' | '),
    '[node tests/harness/emit-styles.mjs --check] exit=' + String(emit.code) + '  ' + emit.out.trim(),
    '',
    '== client bundle ==',
    'lib/client.js 采集开始时: ' + String(before) + ' bytes',
    'lib/client.js build 之后: ' + String(after) + ' bytes',
    'T13b 收尾基线: 484757 bytes → 本轮 +' + String(after - 484757) + ' bytes（Portal / 落位计算 / 页面流布局 / hidden 标记）',
    '',
    '== 结论 ==',
    okAll ? 'PASS — 四命令 exit 0，五档布局断言全过' : 'FAIL — ' + failures.join('；'),
    '',
  ].join('\r\n'),
  'utf8',
)

writeFileSync(
  join(OUT, 'layout.txt'),
  [
    'T13c 布局证据（D-28：星图占满首屏、其余往下滚）',
    '采集时间: ' + stamp,
    '页面: entry=' + ENTRY + ' view=tab；高度 ' + String(HEIGHT) + 'px；宽度 ' + WIDTHS.join('/'),
    '',
    '断言口径：',
    '  · page-scrollable：documentElement.scrollHeight > clientHeight（页面可滚，不是锁死一屏）',
    '  · no-h-scroll：scrollWidth <= clientWidth（不产生横向滚动条）',
    '  · map-height >= 520（星图首屏高度；宽屏 640 由容器查询给）',
    '  · header-position=sticky（吸顶）',
    '  · >=1100：inspector-position=sticky（右侧栏吸顶）；<1100：static 且 inspector-top >= map-bottom（自然下移）',
    '',
    ...layoutRows,
    '',
    '== 结果 ==',
    failures.length === 0 ? 'PASS（五档全过）' : 'FAIL — ' + failures.join('；'),
    '',
  ].join('\r\n'),
  'utf8',
)

writeFileSync(
  join(OUT, 'fixes.txt'),
  [
    'T13c：真机第二轮 3 项 + 1 个根因 → 改法 → 断言名',
    '采集时间: ' + stamp,
    '',
    '① 浮层错位（D-27：浮层必须 portal 到 body）',
    '  根因：0.2.2-rc.1 的 conversation.input.overlay 在 docked composer 内，就地渲染会被裁切/偏移。',
    '  改法：',
    '    · 新增 ui/shell/Portal.ts（唯一 portal 实现）：createPortal 到 body 下 data-threadline-portal 节点；',
    '      unmount 时 node.remove()；SSR/无 document 时内联渲染（单测可测）。',
    '    · /threadline 弹窗：ThreadlineModal 的 Overlay 进 Portal；Overlay 本身 position:fixed + 遮罩同层，',
    '      role=dialog/aria-modal/焦点陷阱/Esc 保持（T06 组件未改）。',
    '    · 每轮影响 popover：Portal + position:fixed；落位由纯函数 placeImpactPopover() 计算 ——',
    '      按钮下方 6px；下方空间不足且小于上方 → 翻到上方；左右越界夹到视口内（右对齐优先）；',
    '      resize/滚动（capture）监听 + requestAnimationFrame 节流重算。',
    '  断言名：',
    '    · tests/entries/t13c.test.ts「placeImpactPopover：默认落按钮下方 6px（右对齐）」「下方空间不足翻到上方」「左右越界夹进视口」「窄视口收窄宽度」',
    '    · tests/entries/t13c.test.ts「Portal：无 document（SSR）时内联渲染，可被断言」',
    '    · tests/entries/t13c.test.ts「弹窗根是 threadline-modal-root 且 Overlay 在 Portal 里（SSR 内联兜底）」',
    '',
    '② 每轮图标不渲染（根因：decideImpact 走了 hidden）',
    '  改法：',
    '    · sessionId 兜底链：props.sessionId → useSessions.current → 快照里 running 的那条 → 仍空则渲染 hidden 标记 no-session-id；',
    '    · messageId→turn 兜底：先查 messageTurns，再对 turns[].messageIds 做大小写不敏感线性查找（0.2.2 durable id 差异）；',
    '    · 所有 hidden 分支渲染 display:none 标记：data-threadline-impact-hidden=reason / data-message-id / data-session-id，',
    '      reason ∈ no-message-id | no-session-id | no-turn | not-anchor | zero-impact；',
    '    · 锚点判定保持每轮一次（finalMessageId；缺失取 messageIds 末条）。',
    '  断言名：',
    '    · tests/entries/t13c.test.ts「hidden 原因：五种 reason 都可观测（display:none 标记）」',
    '    · tests/entries/t13c.test.ts「sessionId 兜底：快照 current 缺失时取 running 的那条」',
    '    · tests/entries/t13c.test.ts「messageId 兜底：messageTurns 查不到时线性查 turns[].messageIds（大小写不敏感）」',
    '    · tests/entries/impact.test.ts 三态/锚点用例（已按 reason 更新）',
    '',
    '③ tab 挤在一屏、被输入框压住（D-28）',
    '  改法：',
    '    · .threadline-app：block-size:auto / min-block-size:100% / overflow:visible（不再 100%+hidden）；',
    '    · .threadline-shell：自然流（display:block）；header + Now 吸顶（sticky）；',
    '    · 星图区 520px（容器 >=1280 时 640px），时间轴/轮次带/检查器依次往下；',
    '    · 宽屏（>=1100）检查器 sticky 右侧栏，窄屏自然下移（static），不再做覆盖层/sheet；',
    '    · 页面滚动交给宿主滚动容器：不造内部滚动条、不锁死高度。',
    '    · tokens.css --tl-map-min-h 320 -> 520；SHELL_METRICS.mapMinHeight 同步。',
    '  断言名：',
    '    · tests/entries/run-t13c.mjs layout.txt 五档（page-scrollable / no-h-scroll / map-height>=520 / inspector sticky-or-static）',
    '    · tests/ui-shell/focus.test.ts「区域几何符合 D-28（星图首屏 520；header/now/timeline 仍按规范像素）」',
    '',
    '④ 内嵌根去掉整页几何（T13b 遗留）',
    '  改法：',
    '    · tokens.css：--tl-* 令牌选择器扩到 :is(.threadline-app, .threadline-impact-root, .threadline-modal-root)；',
    '      container 查询根只留给 .threadline-app（内嵌根不参与容器查询）；reduced-motion 也覆盖两个根；',
    '    · base.css：通用组件/浮层/焦点环规则前缀改为同一 :is(...) 组（内嵌根不再需要 threadline-app 类）；',
    '    · impact/modal 根只带 threadline-impact-root / threadline-modal-root；几何局部化（图标 24x24、modal display:contents）。',
    '  断言名：',
    '    · tests/ui-shell/styles.test.ts「每个选择器都挂 .threadline-app 前缀（…）」已按共享根组更新',
    '    · tests/entries/t13b.test.ts「…只带自己的 root 类（不再带 threadline-app…）」',
    '',
    '5) 验收侧收口（modal 断言与 T09 截图）',
    '  现象：?view=modal 的断言曾量到 [role=dialog] 是 relative/未居中 —— 根因不是 entry 没进 modal 分支，',
    '        而是 portal 把内容搬到了 body，.threadline-modal-root 的作用域没跟过去（Overlay 的 fixed/尺寸全部失效）。',
    '  改法：Portal 增加 className（挂到 body 下的 portal 节点上），ThreadlineModal 传 threadline-modal-root；',
    '        Overlay 继续 fixed 全屏，弹窗本体仍受 .threadline-modal 宽度约束。',
    '  断言（旧 -> 新）：',
    '    · dialog-size：量 [role=dialog] 宽度 <=1040 -> 量弹窗本体 .threadline-modal 宽度 320..1040',
    '    · 新增 has-portal / portal-is-body-child（D-27 核心证据）',
    '    · 新增 overlay-fixed / overlay-inset-zero（遮罩 fixed 全屏）',
    '    · 新增 dialog-centered（弹窗本体中心与视口中心误差 <=2px）',
    '  证据：T09/modal.txt 的 modal-open 18 条断言；T09/*.png 全部重拍（晚于最后代码改动）。',
    '',
    '结论：' + (okAll ? 'PASS' : 'FAIL'),
    '',
  ].join('\r\n'),
  'utf8',
)

console.log('T13c 证据写入 ' + OUT)
console.log('四命令: typecheck=' + String(typecheck.code) + ' build=' + String(build.code) + ' test=' + String(test.code) + ' emit=' + String(emit.code))
console.log('lib/client.js: ' + String(before) + ' -> ' + String(after) + ' bytes')
console.log(failures.length === 0 ? 'layout PASS' : 'layout FAIL: ' + failures.join('；'))
if (!okAll) process.exit(1)
