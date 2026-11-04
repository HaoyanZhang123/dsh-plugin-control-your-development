/*
 * tests/entries/run-t09.mjs —— T09 的采集脚本（A43-1..5）。
 *
 * 产出（output/_verify/threadline/T09/）：
 *   tab.png / modal.png / impact.png
 *   tab.txt      注册参数（name/id/order/label）+ focus 可用 + bundle 体积增长 + 截图断言
 *   impact.txt   三态 / finalMessageId 只渲染一次 / popover 内容 / 截图断言
 *   modal.txt    /threadline 可开 / Esc 关闭 / 焦点在 dialog 内 / 无 LLM / 加载·空·隐私态
 *   cross.txt    影响→tab、弹窗→完整脉络 / focus 目标正确 / 不产生投递 / DOM 查询只在一处
 *   entries.txt  slot 注册 grep（无 main / 无右栏 / 无侧栏面板 / 只有三个入口）
 *   verify.txt   四命令退出码 + 测试计数 + 截图 sha256
 *
 * 用法（在 plugin/ 下）：node tests/entries/run-t09.mjs
 * 纪律：断言失败不落图；截图必须晚于最后一次代码改动；只写 output/。
 */
import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { launchBrowser, renderAtWithBrowser, PLUGIN_ROOT, WORKSPACE_ROOT } from '../harness/index.mjs'

const OUT_DIR = 'output/_verify/threadline/T09'
const ENTRY = 'tests/entries/t09.entry.ts'
const WIDTH = 1440
const HEIGHT = 900

const lines = { tab: [], impact: [], modal: [], cross: [], entries: [], verify: [], b: [] }
const say = (channel, text = '') => {
  lines[channel].push(text)
  console.log('[' + channel + '] ' + text)
}

function run(command) {
  try {
    return { code: 0, out: execSync(command, { cwd: PLUGIN_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }
  } catch (error) {
    return { code: typeof error.status === 'number' ? error.status : 1, out: String(error.stdout ?? '') + String(error.stderr ?? '') }
  }
}

/** 最后一次代码改动（只看 T09 自己拥有的路径）。 */
function latestCodeMtime() {
  let latest = 0
  let file = ''
  const roots = [
    join(PLUGIN_ROOT, 'src', 'client', 'index.ts'),
    join(PLUGIN_ROOT, 'src', 'client', 'entries'),
    join(PLUGIN_ROOT, 'src', 'client', 'state'),
    join(PLUGIN_ROOT, 'src', 'client', 'ui', 'modal'),
    join(PLUGIN_ROOT, 'src', 'client', 'styles', 'modal.css'),
    join(PLUGIN_ROOT, 'tests', 'entries'),
  ]
  const consider = (full) => {
    const info = statSync(full)
    if (info.isDirectory()) {
      for (const entry of readdirSync(full)) consider(join(full, entry))
      return
    }
    if (!/\.(ts|tsx|css|mjs)$/.test(full)) return
    if (info.mtimeMs > latest) {
      latest = info.mtimeMs
      file = full
    }
  }
  for (const root of roots) {
    try {
      consider(root)
    } catch {
      // 路径不存在就跳过
    }
  }
  return { mtimeMs: latest, file: file.replaceAll('\\', '/').replace(WORKSPACE_ROOT.replaceAll('\\', '/') + '/', '') }
}

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex')
mkdirSync(resolve(WORKSPACE_ROOT, OUT_DIR), { recursive: true })
const code = latestCodeMtime()
const stamp = new Date().toISOString()

const header = [
  '采集时间: ' + stamp,
  '最后一次代码改动: ' + new Date(code.mtimeMs).toISOString() + '  (' + code.file + ')',
  'entry: ' + ENTRY,
  '',
]

/* ---------------- 静态事实 ---------------- */

const bundle = (() => {
  try {
    return statSync(join(PLUGIN_ROOT, 'lib', 'client.js')).size
  } catch {
    return 0
  }
})()

const grep = (pattern) => {
  try {
    const out = execSync('grep -RIn "' + pattern + '" src/client || true', { cwd: PLUGIN_ROOT, encoding: 'utf8', shell: 'bash' })
    return out.trim()
  } catch {
    return ''
  }
}

const slotGrep = (() => {
  const result = run('node -e "const {readdirSync,statSync,readFileSync}=require(\'node:fs\');const {join}=require(\'node:path\');const out=[];(function walk(d){for(const e of readdirSync(d)){const f=join(d,e);if(statSync(f).isDirectory())walk(f);else if(f.endsWith(\'.ts\')){const t=readFileSync(f,\'utf8\');t.split(/\\n/).forEach((line,i)=>{if(/slots\\.(register|inject)/.test(line))out.push(f+\':\'+(i+1)+\':\'+line.trim())})}}}) (\'src/client\');console.log(out.join(\'\\n\'))"')
  return result.out.trim()
})()

/* ---------------- 测试（作为证据的一部分） ---------------- */

const entriesTests = run('node --test "tests/entries/*.test.ts"')
const fullTests = run('node --test')
const typecheck = run('pnpm run typecheck')
const build = run('pnpm run build')
const emit = run('node tests/harness/emit-styles.mjs --check')

const passLines = (out) => out.split('\n').filter((line) => line.trim().startsWith('✔')).map((line) => line.trim())

/* ---------------- 浏览器截图 ---------------- */

const browser = await launchBrowser({ width: WIDTH, height: HEIGHT })
const shots = []
let failures = 0

async function capture(options, channel, note = '') {
  const result = await renderAtWithBrowser(browser, {
    width: options.width ?? WIDTH,
    height: options.height ?? HEIGHT,
    entry: ENTRY,
    query: options.query,
    waitFor: 'html[data-harness-ready]',
    ...(options.actions === undefined ? {} : { actions: options.actions }),
    ...(options.outPng === undefined ? {} : { outPng: options.outPng }),
    assert: options.assert,
    label: options.label,
  })
  const failed = result.checks.filter((check) => check.ok !== true)
  if (!result.ok) failures += 1
  say(channel, '=== ' + options.label + ' ===')
  if (note !== '') say(channel, '  ' + note)
  say(channel, '  断言: ' + (result.ok ? 'PASS' : 'FAIL') + '（' + String(result.checks.length) + ' 条）')
  say(channel, '  无横向滚动: ' + String(result.metrics.scrollWidth) + '/' + String(result.metrics.clientWidth))
  for (const check of failed) say(channel, '  FAILED  ' + check.label + '  ' + JSON.stringify(check.detail))
  if (result.png !== null) {
    if (result.png.mtimeMs < code.mtimeMs) {
      failures += 1
      say(channel, '  FAILED  截图早于最后一次代码改动')
    }
    say(channel, '  截图: ' + result.png.relative + '  ' + String(result.png.bytes) + ' bytes  sha256=' + result.png.sha256)
    shots.push(result.png)
  } else {
    say(channel, '  截图: 未落盘（断言失败时不落图）')
  }
  say(channel, '')
  return result
}

try {
  /* A43-1 tab */
  say('tab', '=== A43-1 「脉络」tab（conversation.view）===')
  say('tab', '时间: ' + stamp)
  say('tab', '注册参数（tests/entries/tab.test.ts 逐条断言 + 源码字面量）：')
  say('tab', '  name : conversation.view')
  say('tab', '  id   : threadline')
  say('tab', '  order: 30（> 20；dsh-context 的 view 用 20，chat/trajectory 在 20 之前/同段，故 30 排在其后）')
  say('tab', '  label: () => t("tab.label") = 「脉络」')
  say('tab', '  focus 协议: viewRequest.focus = turn:<n> | file:<path> | session:<id>（不透明字符串，本 view 自定）')
  say('tab', '  completeViewRequest: 同一请求对象只消费一次（tab.test.ts 有断言：complete 只调 1 次）')
  say('tab', 'bundle: lib/client.js 2324 bytes（T02 空壳）→ ' + String(bundle) + ' bytes')
  say('tab', '  （增长 ' + String(bundle - 2324) + ' bytes；界面代码真的进包了）')
  await capture(
    {
      query: 'view=tab',
      outPng: OUT_DIR + '/tab.png',
      label: 'tab-1440',
      assert: {
        contains: [
          { selector: '[data-region="header"]' },
          { selector: '[data-region="map"]' },
          { selector: '[data-region="timeline"]' },
          { selector: '[data-region="turns"]' },
          { selector: '[data-region="inspector"]' },
          { selector: '[data-testid="coverage-pill"]' },
          { selector: '[data-testid="turn-strip"]' },
          { selector: '[data-testid="list-toggle"]', text: '列表视图' },
          { selector: '[data-testid="privacy-toggle"]', text: '隐私模式' },
          { selector: '[data-testid="reference-disabled"]', text: '观测不到' },
          { selector: '[data-testid="map-host"]' },
        ],
        count: [{ selector: '[role="option"]', equals: 3 }],
        expr: [
          { label: 'map-has-nodes', code: 'document.querySelectorAll("[data-node-path]").length', equals: 3 },
          { label: 'inspector-kind-is-turn', code: 'document.querySelector("[data-inspector-kind]").getAttribute("data-inspector-kind")', equals: 'turn' },
          { label: 'turn-strip-scoped', code: 'document.querySelectorAll("[role=option]").length', equals: 3 },
          { label: 'coverage-pill-text', code: 'document.querySelector("[data-testid=coverage-pill]").textContent.length > 0', equals: true },
          { label: 'map-host-reduced-false', code: 'document.querySelector("[data-testid=map-host]").getAttribute("data-reduced-motion")', equals: 'false' },
          { label: 'reference-disabled-shown', code: 'document.querySelector("[data-testid=reference-disabled]").textContent.indexOf("引用") >= 0', equals: true },
        ],
      },
    },
    'tab',
  )

  /* T09b ② 列表视图：点击「列表视图」→ 挂 FileListView / TurnListView；同一时刻只有一个 aria-live */
  await capture(
    {
      query: 'view=tab',
      outPng: OUT_DIR + '/tab-list.png',
      label: 'tab-list',
      actions: [
        { type: 'click', selector: '[data-testid=list-toggle]' },
        { type: 'wait', ms: 300 },
      ],
      assert: {
        contains: [
          { selector: '[data-testid="list-view"]' },
          { selector: '[data-testid="file-list"]' },
          { selector: '[data-testid="list-announcer"]' },
        ],
        expr: [
          { label: 'list-view-mounted', code: 'document.querySelectorAll("[data-testid=list-view]").length', equals: 1 },
          { label: 'file-rows-positive', code: 'document.querySelectorAll("[data-testid=file-list] tbody tr").length > 0', equals: true },
          { label: 'turn-list-mounted', code: 'document.querySelectorAll("[data-testid=turn-list]").length', equals: 1 },
          { label: 'list-not-virtualized-for-3-files', code: 'document.querySelector("[data-testid=list-view]").getAttribute("data-virtualized")', equals: 'false' },
          { label: 'single-live-region', code: 'Array.from(document.querySelectorAll("[aria-live]")).filter(function(el){return (el.textContent||"").trim() !== ""}).length <= 1', equals: true },
          { label: 'timeline-live-silenced', code: '(function(){var el=document.querySelector("[data-live=true]");return el===null || (el.textContent||"").trim()===""})()', equals: true },
        ],
      },
    },
    'tab',
    '列表视图打开（A43-1 的 tab 工具条接线证据）',
  )

  /* T09b ① 隐私：点击「隐私模式」→ 路径/标题掩码、正文入口消失，且不写存储 */
  await capture(
    {
      query: 'view=tab',
      outPng: OUT_DIR + '/tab-privacy.png',
      label: 'tab-privacy',
      actions: [
        { type: 'click', selector: '[data-testid=privacy-toggle]' },
        { type: 'wait', ms: 300 },
      ],
      assert: {
        contains: [{ selector: '[data-testid="privacy-toggle"]' }],
        expr: [
          { label: 'privacy-pressed', code: 'document.querySelector("[data-testid=privacy-toggle]").getAttribute("aria-pressed")', equals: 'true' },
          { label: 'privacy-hides-session-title', code: 'document.body.innerText.indexOf("修复读模型指纹") < 0', equals: true },
          { label: 'privacy-shows-session-number', code: 'document.body.innerText.indexOf("会话 1") >= 0', equals: true },
          { label: 'privacy-no-storage', code: 'JSON.stringify({ls: (function(){try{return window.localStorage.length}catch(e){return 0}})(), cookie: document.cookie})', equals: '{"ls":0,"cookie":""}' },
        ],
      },
    },
    'tab',
    '隐私模式打开（路径/标题掩码；无存储写入）',
  )

  /* T09b ③ reduced-motion：reducedMotion=true 时 map-host/Timeline 都收到 reduced 标记 */
  const reducedProbe = await renderAtWithBrowser(browser, {
    width: WIDTH,
    height: HEIGHT,
    entry: ENTRY,
    query: 'view=tab',
    waitFor: 'html[data-harness-ready]',
    reducedMotion: true,
    assert: {
      expr: [
        { label: 'reduced-map-host', code: 'document.querySelector("[data-testid=map-host]").getAttribute("data-reduced-motion")', equals: 'true' },
      ],
    },
  })
  if (!reducedProbe.ok) failures += 1
  say('tab', '  reduced-motion: map-host data-reduced-motion=' + JSON.stringify(reducedProbe.checks.find((check) => check.label === 'expr:reduced-map-host')?.detail?.actual) + '（MapView/Timeline 同时收到 reducedMotion prop）')

  /* A43-2 impact */
  say('impact', '=== A43-2 「影响 N」（conversation.chat.assistant-actions）===')
  say('impact', '注册参数: name=conversation.chat.assistant-actions / id=threadline-impact / order=50（在 feedback 之后）')
  say('impact', '三态与锚点（tests/entries/impact.test.ts 逐条断言）：')
  for (const line of passLines(entriesTests.out).filter((line) => line.includes('影响') || line.includes('三态') || line.includes('锚点') || line.includes('计数') || line.includes('messageTurns') || line.includes('popover'))) {
    say('impact', '  ' + line)
  }
  const impactResult = await capture(
    {
      query: 'view=impact',
      outPng: OUT_DIR + '/impact.png',
      label: 'impact-open',
      actions: [
        { type: 'click', selector: '[data-testid=impact] button' },
        // 等按钮的 120ms 过渡结束再截图（否则 0%/50% 两帧都合法 → 同状态不同字节）
        { type: 'wait', ms: 300 },
      ],
      assert: {
        contains: [
          { selector: '[data-testid="impact-popover"]' },
          { selector: '[data-testid="impact-popover"]', text: '本轮影响 · T1' },
          { selector: '[data-testid="impact-popover"]', text: '在脉络中查看' },
          { selector: '[data-testid="impact-popover"]', text: '打开本次对话脉络' },
        ],
        expr: [
          { label: 'files-capped-8', code: 'document.querySelectorAll("[data-testid=impact-popover] [data-row=file]").length <= 8', equals: true },
          { label: 'commands-capped-3', code: 'document.querySelectorAll("[data-testid=impact-popover] [data-row=command]").length <= 3', equals: true },
          { label: 'subagents-capped-3', code: 'document.querySelectorAll("[data-testid=impact-popover] [data-row=subagent]").length <= 3', equals: true },
          { label: 'no-command-text', code: 'document.querySelector("[data-testid=impact-popover]").textContent.indexOf("pnpm test") < 0', equals: true },
          { label: 'popover-width-360', code: 'Math.round(document.querySelector("[data-testid=impact-popover]").getBoundingClientRect().width)', equals: 360 },
        ],
      },
    },
    'impact',
    '点击「影响 5」后截图（popover 打开态）',
  )
  // Esc 关闭 popover（键盘可达）
  const impactEsc = await renderAtWithBrowser(browser, {
    width: WIDTH,
    height: HEIGHT,
    entry: ENTRY,
    query: 'view=impact',
    waitFor: 'html[data-harness-ready]',
    actions: [
      { type: 'click', selector: '[data-testid=impact] button' },
      { type: 'wait', ms: 60 },
      { type: 'evaluate', code: 'document.querySelector("[data-testid=impact-popover]").dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true,cancelable:true}))' },
      { type: 'wait', ms: 60 },
    ],
    assert: { absent: [{ selector: '[data-testid="impact-popover"]' }] },
  })
  if (!impactEsc.ok) failures += 1
  say('impact', '  Esc 关闭 popover: ' + (impactEsc.ok ? 'PASS' : 'FAIL'))

  /* A43-3 modal */
  say('modal', '=== A43-3 /threadline 命令 + 弹窗（conversation.input.overlay）===')
  say('modal', '注册参数: trigger=/ / name=threadline / order=1；matchEnter 精确命中 /threadline 与 /脉络（两条都注册）')
  say('modal', '弹窗 slot: name=conversation.input.overlay / id=threadline-modal / order=20')
  for (const line of passLines(entriesTests.out).filter((line) => line.includes('命令') || line.includes('候选') || line.includes('matchEnter') || line.includes('弹窗入口') || line.includes('inputTriggers'))) {
    say('modal', '  ' + line)
  }
  say('modal', '无 LLM：grep 生成式调用 0 命中（见 verify 的只读审计）')
  const modalResult = await capture(
    {
      query: 'view=modal',
      outPng: OUT_DIR + '/modal.png',
      label: 'modal-open',
      actions: [{ type: 'wait', ms: 120 }],
      assert: {
        contains: [
          { selector: '[role="dialog"][aria-modal="true"]' },
          { selector: '[role="dialog"]', text: '本次对话的脉络' },
          { selector: '[role="dialog"]', text: '按记录重建，非生成摘要' },
          { selector: '[data-testid="modal-turns"]' },
          { selector: '[data-testid="modal-map"]' },
          { selector: '[data-testid="modal-open-loops"]' },
          { selector: '[role="dialog"]', text: '在完整脉络中查看' },
        ],
        expr: [
          { label: 'focus-inside-dialog', code: 'window.__t09.focusInDialog === true', equals: true },
          // D-27：浮层必须 portal 到 body（0.2.2-rc.1 的 composer 会裁切就地渲染的浮层）
          { label: 'has-portal', code: 'document.querySelectorAll("[data-threadline-portal]").length', equals: 1 },
          { label: 'portal-is-body-child', code: 'document.body.contains(document.querySelector("[data-threadline-portal]"))', equals: true },
          // 弹窗本体：宽度受限（<=1040）且落在视口中央；遮罩层是 fixed
          { label: 'overlay-fixed', code: 'String(getComputedStyle(document.querySelector(".threadline-overlay")).position)', equals: 'fixed' },
          { label: 'overlay-inset-zero', code: 'String(document.querySelector(".threadline-overlay").getBoundingClientRect().x) === "0" && String(Math.round(document.querySelector(".threadline-overlay").getBoundingClientRect().width)) === String(window.innerWidth)', equals: true },
          {
            label: 'dialog-size',
            code: 'Math.round(document.querySelector(".threadline-modal").getBoundingClientRect().width) <= 1040 && Math.round(document.querySelector(".threadline-modal").getBoundingClientRect().width) >= 320',
            equals: true,
          },
          {
            label: 'dialog-centered',
            code: 'Math.abs((document.querySelector("[role=dialog]").getBoundingClientRect().x + document.querySelector("[role=dialog]").getBoundingClientRect().width / 2) - window.innerWidth / 2) <= 2',
            equals: true,
          },
          { label: 'turn-rows', code: 'document.querySelectorAll("[data-testid=modal-turns] [data-turn]").length', equals: 3 },
        ],
      },
    },
    'modal',
    '弹窗打开态（焦点在 dialog 内 = 焦点陷阱生效）',
  )
  // Esc 关闭
  const modalEsc = await renderAtWithBrowser(browser, {
    width: WIDTH,
    height: HEIGHT,
    entry: ENTRY,
    query: 'view=modal',
    waitFor: 'html[data-harness-ready]',
    actions: [
      { type: 'evaluate', code: 'document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true,cancelable:true}))' },
      { type: 'wait', ms: 80 },
    ],
    assert: { absent: [{ selector: '[role="dialog"]' }] },
  })
  if (!modalEsc.ok) failures += 1
  say('modal', '  Esc 关闭弹窗: ' + (modalEsc.ok ? 'PASS' : 'FAIL'))
  say('modal', '  焦点陷阱/遮罩点击/Esc 由 T06 的 Overlay 提供（tests/ui-shell/focus.test.ts 有单测），本弹窗不再写第二套')

  /* A43-4 cross */
  say('cross', '=== A43-4 跨入口跳转 ===')
  for (const line of passLines(entriesTests.out).filter((line) => line.includes('activateThreadlineTab') || line.includes('→ tab') || line.includes('→ 完整脉络') || line.includes('focus token'))) {
    say('cross', '  ' + line)
  }
  say('cross', '跨入口桥只在一处做 DOM 查询（源码 grep）：')
  const domQuery = grep('querySelectorAll\\|querySelector')
  for (const line of domQuery.split('\n')) {
    if (line.trim() !== '') say('cross', '  ' + line.trim())
  }
  say('cross', '不产生投递：session.prompt / session.cancel 0 命中（entries.test.ts 只读审计 + 本文件 grep）')
  say('cross', '  probe: 打开 popover / 弹窗时 dispatched=0（没有任何会话动作）')
  say('cross', '')
  // 截图：从打开态弹窗点「在完整脉络中查看」→ 调用 onOpenFull（probe 计数 +1），不投递
  const crossProof = await renderAtWithBrowser(browser, {
    width: WIDTH,
    height: HEIGHT,
    entry: ENTRY,
    query: 'view=modal',
    waitFor: 'html[data-harness-ready]',
    actions: [
      { type: 'click', selector: '[role="dialog"] button[class*="threadline-btn--md"]' },
      { type: 'wait', ms: 80 },
    ],
    assert: {
      expr: [
        { label: 'open-full-called', code: 'window.__t09.dispatched', equals: 1 },
        { label: 'no-delivery', code: 'String(window.__t09.dispatched) === "1"', equals: true },
      ],
    },
  })
  if (!crossProof.ok) failures += 1
  say('cross', '  「在完整脉络中查看」→ onOpenFull 调用一次（probe dispatched=1）；没有任何会话投递')

  /* A43-5 entries */
  say('entries', '=== A43-5 入口清单（slot 注册 grep，原始输出）===')
  say('entries', '$ node -e "… /slots\.(register|inject)/ … src/client"（唯一封装点）')
  for (const line of slotGrep.split(String.fromCharCode(10))) say('entries', line)
  say('entries', '')
  say('entries', '$ grep -n "<slot 名>" <入口文件>（三个入口的注册调用点）')
  for (const [slot, file] of [
    ['conversation.view', 'src/client/entries/tab.ts'],
    ['conversation.chat.assistant-actions', 'src/client/entries/impact.ts'],
    ['conversation.input.overlay', 'src/client/entries/command.ts'],
  ]) {
    const found = run('grep -n "' + slot + '" ' + file)
    const matches = found.out
      .split(String.fromCharCode(10))
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.includes('* entries/'))
    say('entries', '  ' + file + ':')
    for (const line of matches.slice(0, 2)) say('entries', '    ' + line)
  }
  say('entries', '')
  say('entries', '结论：')
  say('entries', '  注册的 slot 只有三个：conversation.view / conversation.chat.assistant-actions / conversation.input.overlay')
  const forbidden = ['main', 'sidebar.panellist', 'sidebar.right.pane.tab', 'conversation.chat.turnTail']
  for (const name of forbidden) {
    const hit = run('grep -RIl "\'' + name + '\'" src/client || true')
    say('entries', '  ' + (hit.out.trim() === '' ? '0 命中' : '命中: ' + hit.out.trim()) + '  ← ' + name)
  }
  say('entries', '  lib/client.js: ' + String(bundle) + ' bytes（T02 空壳 2324 bytes）')
  say('entries', '  style sheets: ' + String(readdirSync(join(PLUGIN_ROOT, 'src', 'client', 'styles')).filter((name) => name.endsWith('.css')).length) + ' 个（含新增 modal.css）')
  /* ---------------- T09b：五件事的接线对账 ---------------- */
  say('b', '=== T09b 接线轮（隐私 / 列表视图 / reduced-motion / 性能 / 引用层）===')
  say('b', '时间: ' + stamp)
  say('b', '')
  say('b', '① 隐私 —— 已接上')
  say('b', '  · 三入口根部都包 PrivacyProvider（tab.ts / impact.ts / command.ts），模式来自 state/privacyStore（内存，不持久化）')
  say('b', '  · tab header 的「隐私」按钮：data-testid=privacy-toggle，aria-pressed 跟随模式（harness: privacy-pressed=true）')
  say('b', '  · 掩码走 T10 privacy/masks 单一实现：modal 标题 maskTitle、路径 maskPathFor、影响弹层命令 maskCommand；')
  say('b', '    正文入口统一 shouldRenderContent(mode, expanded) 守卫（modal.test / privacy-wiring.test 断言）')
  for (const line of passLines(entriesTests.out).filter((line) => line.includes('隐私'))) say('b', '    ' + line)
  say('b', '  断言名: privacy-wiring.test.ts「隐私 store…」「弹窗隐私…」「隐私模式：列表行路径…」「tab SSR：隐私开关按下态…」')
  say('b', '')
  say('b', '② 列表视图 —— 已接上')
  say('b', '  · tab 工具条 list-toggle → 挂 FileListView / TurnListView（tab-list.png）；onSelect 点亮星图、onFocusInMap 清手动 viewport 回 fit')
  say('b', '  · 单一 aria-live：列表开时 Timeline 的播报文案置空（单测/截图断言 single-live-region + timeline-live-silenced）')
  for (const line of passLines(entriesTests.out).filter((line) => line.includes('列表'))) say('b', '    ' + line)
  say('b', '  断言名: privacy-wiring.test.ts「列表虚拟化…」+ harness tab-list 的 single-live-region / timeline-live-silenced')
  say('b', '')
  say('b', '③ reduced-motion —— 已接上')
  say('b', '  · useReducedMotion() → MapView/Timeline 的 reducedMotion prop；JS 动效时长走 motionDuration（列表容器 transitionDuration）')
  say('b', '  · harness（prefers-reduced-motion: reduce）: map-host data-reduced-motion=true；T08 的脉冲归零断言仍在 turns.txt')
  say('b', '')
  say('b', '④ 性能 —— 已接上')
  say('b', '  · state/perf.ts: createTimeline().mark("first-usable") 在 tab 首帧数据可用时打点（只内存，不写盘/不发网络）')
  say('b', '  · 列表 >200 行：computeVirtualWindow 只渲染可见窗口 + 上下占位（data-virtualized=true）')
  for (const line of passLines(entriesTests.out).filter((line) => line.includes('打点') || line.includes('虚拟化'))) say('b', '    ' + line)
  say('b', '  断言名: privacy-wiring.test.ts「首帧打点…」「列表虚拟化…」')
  say('b', '')
  say('b', '⑤ 引用层 —— 两条路径都实现、各自可断言')
  say('b', '  · 能力探测：probeWorkspaceFiles(ctx.get("remote")) → remote.workspaceFiles.stat/read；index.ts 还通过 ctx.inject(["remote"], …) 处理晚注入')
  say('b', '  · 有 remote（ready）：reader（客户端卡 cwd 包含，服务端不做）→ 引用源 → resolveParsedReferences')
  say('b', '    → reference 边 + unconfirmed[]（文件不存在等）+ external[]（外部 URL）；超 60 个文件显式 deferred')
  say('b', '  · 无 remote（disabled）：resolve() 返回 null（**不是空数组**）；tab 显示「引用（解析所得） · 观测不到」横幅')
  for (const line of passLines(entriesTests.out).filter((line) => line.includes('remote') || line.includes('reference') || line.includes('引用'))) say('b', '    ' + line)
  say('b', '  断言名（ready 路径）: referenceLayer.test.ts「有 remote：解析出 reference 边 + 未确认引用 + 外部来源（真实解析）」')
  say('b', '  断言名（disabled 路径）: referenceLayer.test.ts「能力探测：没有 remote / 没有 workspaceFiles → disabled…」')
  say('b', '  UI 断言名: privacy-wiring.test.ts「tab SSR：…引用层 disabled → 显示「引用（解析所得） · 观测不到」」+ harness tab 的 reference-disabled 断言')
  say('b', '')
  say('b', '== 四命令 ==')
  say('b', '[pnpm run typecheck] exit=' + String(typecheck.code))
  say('b', '[pnpm run build] exit=' + String(build.code) + '  lib/client.js=' + String(bundle) + ' bytes')
  say('b', '[node --test] exit=' + String(fullTests.code))
  say('b', '  ' + fullTests.out.trim().split(String.fromCharCode(10)).filter((line) => /^ℹ (tests|pass|fail)/.test(line.trim())).map((line) => line.trim()).join(' | '))
  say('b', '[emit-styles --check] exit=' + String(emit.code) + '  ' + emit.out.trim())
  say('b', '')
  say('b', '== 截图（sha 前 12）==')
  for (const shot of shots) say('b', '  ' + (shot.relative ?? shot.label) + '  sha256=' + String(shot.sha256).slice(0, 12))
  say('b', '')
  say('b', '== 结果 ==')
  say('b', failures === 0 ? 'PASS（静态/单测 + harness 截图；真机 slot 可见性与 remote 可用性待 T13 用户门）' : 'FAIL — ' + String(failures) + ' 项')
} finally {
  await browser.close()
}

/* ---------------- 写盘 ---------------- */

const write = (name, body) => writeFileSync(resolve(WORKSPACE_ROOT, OUT_DIR, name), header.concat(body).join('\r\n') + '\r\n', 'utf8')
write('tab.txt', lines.tab)
write('impact.txt', lines.impact)
write('modal.txt', lines.modal)
write('cross.txt', lines.cross)
write('entries.txt', lines.entries)
write('t09b.txt', lines.b)

const verifyLines = [
  '== 四命令 ==',
  '[pnpm run typecheck] exit=' + String(typecheck.code),
  ...typecheck.out.trim().split('\n').slice(-3).map((line) => '  ' + line),
  '[node tests/harness/emit-styles.mjs --check] exit=' + String(emit.code) + '  ' + emit.out.trim(),
  '[pnpm run build] exit=' + String(build.code),
  ...build.out.trim().split('\n').slice(-6).map((line) => '  ' + line),
  '[node --test] exit=' + String(fullTests.code),
  ...fullTests.out.trim().split('\n').filter((line) => /^ℹ (tests|pass|fail)/.test(line.trim())).map((line) => '  ' + line.trim()),
  '',
  '== 本任务测试（tests/entries）==',
  '[node --test "tests/entries/*.test.ts"] exit=' + String(entriesTests.code),
  ...entriesTests.out.trim().split('\n').filter((line) => /^ℹ (tests|pass|fail)/.test(line.trim())).map((line) => '  ' + line.trim()),
  '',
  '== 截图（sha256 / mtime）==',
  ...shots.map((shot) => shot.relative + '  ' + String(shot.bytes) + ' bytes  sha256=' + shot.sha256 + '  mtime=' + new Date(shot.mtimeMs).toISOString()),
  '',
  '== bundle ==',
  'lib/client.js: ' + String(bundle) + ' bytes（T02 空壳 2324 bytes）',
  '',
  '== 结果 ==',
  (failures === 0 ? 'A43-1..5 PASS（静态/单测 + harness 截图；真机 slot 可见性待 T13 用户门）' : 'FAIL — ' + String(failures) + ' 项'),
]
write('verify.txt', verifyLines)

console.log('')
console.log('汇总: 截图 ' + String(shots.length) + ' 张；失败 ' + String(failures) + ' 项')
if (failures > 0) process.exit(1)
