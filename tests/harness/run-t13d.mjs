/*
 * run-t13d.mjs —— D-30 的真 DOM 证据：我们的 tab 独占区域时，宿主输入框真的被藏；
 * 但 composer 里含审批卡时必须仍然可见（安全阀）。
 *
 * 用法：node tests/harness/run-t13d.mjs
 * 产物：output/_verify/threadline/T13d/{composer.txt,composer-plain.png,composer-approval.png}
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchBrowser, renderAtWithBrowser, WORKSPACE_ROOT } from './index.mjs'

const OUT_DIR = 'output/_verify/threadline/T13d'
const ENTRY = 'tests/harness/entries/composer.entry.ts'

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 12)
}

const browser = await launchBrowser()
const lines = []
const log = (line) => { lines.push(line); console.log(line) }
try {
  const result = await renderAtWithBrowser(browser, {
    width: 1000,
    height: 900,
    entry: ENTRY,
    waitFor: 'html[data-harness-ready]',
    freezeAnimations: true,
    outPng: join(OUT_DIR, 'composer-plain.png'),
    assert: {
      expr: [
        {
          label: 'ours-marked',
          code: 'String(document.querySelector("#plain").hasAttribute("data-threadline-surface"))',
          equals: 'true',
        },
        {
          label: 'plain-composer-hidden',
          code: 'String(getComputedStyle(document.querySelector("#plain [data-composer-seat]")).display)',
          equals: 'none',
        },
        {
          label: 'approval-marked',
          code: 'String(document.querySelector("#approval").hasAttribute("data-threadline-surface"))',
          equals: 'true',
        },
        {
          label: 'approval-composer-visible',
          code: 'String(getComputedStyle(document.querySelector("#approval [data-composer-seat]")).display !== "none")',
          equals: 'true',
        },
        {
          // tab 视图区占满 scrollBody 里 composer 之外的全部高度（composer 被隐藏后 = 整块）
          label: 'view-fills',
          code: 'String(Math.round(document.querySelector("#plain-view").getBoundingClientRect().height))',
          equals: '360',
        },
      ],
    },
  })
  for (const check of result.checks) {
    log((check.ok === false ? 'FAIL ' : 'PASS ') + check.label + ' => ' + JSON.stringify(check.detail?.actual))
  }
  log('截图: ' + join(OUT_DIR, 'composer-plain.png') + '  sha256=' + sha256(join(WORKSPACE_ROOT, OUT_DIR, 'composer-plain.png')))
  log('结论: ' + (result.ok ? 'PASS' : 'FAIL'))
  writeFileSync(join(WORKSPACE_ROOT, OUT_DIR, 'composer.txt'), lines.join('\r\n') + '\r\n', 'utf8')
  if (!result.ok) process.exit(1)
} finally {
  await browser.close()
}
