/*
 * tests/harness/selfcheck.mjs —— harness 自检（正向 + 反向），输出直接作为 T06 的 harness.txt。
 *
 * 为什么要有反向：验收工具本身也要被审计。"能截图"如果只在能通过的数据上验证过，
 * 那它区分不出"真的没溢出"和"根本没测"。这里喂三种已知坏输入，要求它们真的红、
 * 且不留任何会被误当证据的产物（不落图、不写证据目录）。
 *
 * 用法：node tests/harness/selfcheck.mjs
 * 退出码：0 = 正向通过且三条反向都按预期变红；1 = 有任何一条不符合预期。
 */
import { existsSync, readdirSync, unlinkSync } from 'node:fs'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { launchBrowser, renderAtWithBrowser } from './index.mjs'
import { WORKSPACE_ROOT } from './index.mjs'

const lines = []
const log = (text = '') => {
  lines.push(text)
  console.log(text)
}

const OK = 'PASS'
const BAD = 'FAIL'
let failures = 0

function expect(label, condition, detail) {
  const status = condition ? OK : BAD
  if (!condition) failures += 1
  log(status + ' | ' + label + (detail === undefined ? '' : ' | ' + detail))
}

log('harness 自检（正向 + 反向）')
log('时间（本地）: ' + new Date().toISOString())
log('node: ' + process.version + '  WebSocket(global): ' + (typeof WebSocket === 'function'))
log('os.tmpdir(): ' + tmpdir())
log('')

// —— 0. 工作区证据目录快照（用于证明自检没往证据目录写东西）——
const evidenceDir = join(WORKSPACE_ROOT, 'output', '_verify', 'threadline', 'T06')
const snapshot = () =>
  existsSync(evidenceDir) ? readdirSync(evidenceDir).sort().join(',') : '(目录不存在)'
const before = snapshot()

const browser = await launchBrowser({ width: 420, height: 900 })
log('浏览器: ' + browser.executable)
log('profile: ' + browser.profileDir)
expect('profile 目录在 os.tmpdir() 内（不写进工作区）', browser.profileDir.startsWith(tmpdir()), browser.profileDir)
log('')

const normalPage =
  '<!doctype html><html><head><meta charset="utf-8"><style>' +
  'html,body{margin:0;padding:0;block-size:100%;overflow:hidden}' +
  '#box{inline-size:400px;block-size:100px;background:#808080}' +
  '</style></head><body><div id="box" data-region="probe">hello</div></body></html>'

const overflowingPage =
  '<!doctype html><html><head><meta charset="utf-8"><style>' +
  'html,body{margin:0;padding:0;block-size:100%;overflow:visible}' +
  '#wide{inline-size:900px;block-size:100px;background:#808080}' +
  '</style></head><body><div id="wide" data-region="probe">too wide</div></body></html>'

try {
  // —— 1. 正向：能渲染、能断言、能截图 ——
  let positive
  try {
    positive = await renderAtWithBrowser(browser, {
      width: 420,
      height: 900,
      html: normalPage,
      outPng: join(tmpdir(), 'threadline-selfcheck-positive.png'),
      assert: {
        contains: [{ selector: '#box', text: 'hello' }],
        expr: [{ label: 'probe-width', code: 'Math.round(document.querySelector("#box").getBoundingClientRect().width)', equals: 400 }],
      },
    })
  } catch (error) {
    expect('正向渲染未抛错', false, String(error))
  }
  if (positive) {
    expect('正向：断言全绿', positive.ok, positive.checks.map((check) => check.label + '=' + check.ok).join(' '))
    expect('正向：截图落盘并带 sha256', Boolean(positive.png && positive.png.sha256), positive.png && positive.png.sha256.slice(0, 16))
    expect('正向：scrollWidth(420) <= clientWidth(420)', positive.metrics.scrollWidth <= positive.metrics.clientWidth,
      positive.metrics.scrollWidth + ' <= ' + positive.metrics.clientWidth)
    log('     截图实际路径: ' + (positive.png && positive.png.path))
  }
  log('')

  // —— 2. 反向 A：真的溢出时 no-page-hscroll 必须红，且不许落图 ——
  const overflowPng = join(tmpdir(), 'threadline-selfcheck-must-not-exist.png')
  if (existsSync(overflowPng)) unlinkSync(overflowPng)
  const overflow = await renderAtWithBrowser(browser, {
    width: 420,
    height: 900,
    html: overflowingPage,
    outPng: overflowPng,
    assert: {},
  })
  const hscrollCheck = overflow.checks.find((check) => check.label === 'no-page-hscroll')
  expect('反向A：溢出页面被判红', overflow.ok === false)
  expect('反向A：no-page-hscroll 明确失败并给出实际值', Boolean(hscrollCheck && hscrollCheck.ok === false),
    hscrollCheck && JSON.stringify(hscrollCheck.detail))
  expect('反向A：断言失败时不落图（文件不存在）', !existsSync(overflowPng), overflowPng)
  log('')

  // —— 3. 反向 B：文案断言写错必须红（证明 contains 不是空转）——
  const wrongText = await renderAtWithBrowser(browser, {
    width: 420,
    height: 900,
    html: normalPage,
    outPng: join(tmpdir(), 'threadline-selfcheck-must-not-exist-2.png'),
    assert: { contains: [{ selector: '#box', text: '这段文字不存在' }] },
  })
  const textCheck = wrongText.checks.find((check) => check.label.startsWith('contains:'))
  expect('反向B：错误文案断言被判红', wrongText.ok === false && Boolean(textCheck && textCheck.ok === false),
    textCheck && JSON.stringify(textCheck.detail))
  log('')

  // —— 4. 反向 C：选择器不存在必须红 ——
  const missing = await renderAtWithBrowser(browser, {
    width: 420,
    height: 900,
    html: normalPage,
    assert: { contains: [{ selector: '#not-there' }] },
  })
  const missingCheck = missing.checks.find((check) => check.label.startsWith('contains:'))
  expect('反向C：不存在的选择器被判红', missing.ok === false && Boolean(missingCheck && missingCheck.ok === false),
    missingCheck && JSON.stringify(missingCheck.detail))
  log('')

  // —— 5. 反向 D：宿主主题桩只在 harness；页面错误必须被捕获 ——
  const throwing = await renderAtWithBrowser(browser, {
    width: 420,
    height: 900,
    html: '<!doctype html><html><body><script>throw new Error("boom")<' + '/script></body></html>',
    assert: {},
  })
  expect('反向D：页面抛错被捕获（no-page-error 红）',
    throwing.checks.some((check) => check.label === 'no-page-error' && check.ok === false),
    JSON.stringify(throwing.errors).slice(0, 120))
  log('')

  // —— 6. 截图可复现：同一状态两次渲染必须逐字节相同（动画被冻结在 0%）——
  const detPngA = join(tmpdir(), 'threadline-selfcheck-det-a.png')
  const detPngB = join(tmpdir(), 'threadline-selfcheck-det-b.png')
  const detA = await renderAtWithBrowser(browser, {
    width: 1440,
    height: 900,
    entry: 'tests/harness/entries/shell.entry.ts',
    waitFor: 'html[data-harness-ready]',
    outPng: detPngA,
    assert: {},
  })
  const detB = await renderAtWithBrowser(browser, {
    width: 1440,
    height: 900,
    entry: 'tests/harness/entries/shell.entry.ts',
    waitFor: 'html[data-harness-ready]',
    outPng: detPngB,
    assert: {},
  })
  expect('截图可复现：同一状态两次 sha256 相同（动画冻结在 0%）',
    Boolean(detA.png && detB.png && detA.png.sha256 === detB.png.sha256),
    detA.png && detB.png ? detA.png.sha256.slice(0, 16) + ' / ' + detB.png.sha256.slice(0, 16) : '(无图)')
  for (const file of [detPngA, detPngB]) if (existsSync(file)) unlinkSync(file)
} finally {
  await browser.close()
}

log('')
expect('自检没有向证据目录写任何文件（before === after）', before === snapshot(), 'before=' + before + ' after=' + snapshot())
log('')
log('汇总: 失败 ' + failures + ' 项')
log('结果: ' + (failures === 0 ? 'harness PASS' : 'harness FAIL'))

// 正向截图落在 %TEMP%，用完删掉，避免留下"看起来像证据"的文件。
const positivePng = join(tmpdir(), 'threadline-selfcheck-positive.png')
if (existsSync(positivePng)) unlinkSync(positivePng)

if (failures > 0) process.exit(1)
