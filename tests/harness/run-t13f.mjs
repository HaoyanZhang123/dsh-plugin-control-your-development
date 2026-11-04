/*
 * run-t13f.mjs —— T13f 端到端：没开过 tab 时点图标也能自动预热 + 冷读 detail。
 * 用法：node tests/harness/run-t13f.mjs
 * 产物：output/_verify/threadline/T13e/{warmup-wiring.txt,warmup-icon.png}
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchBrowser, renderAtWithBrowser, WORKSPACE_ROOT } from './index.mjs'

const OUT_DIR = 'output/_verify/threadline/T13e'

const browser = await launchBrowser()
const lines = []
const log = (line) => { lines.push(line); console.log(line) }
try {
  const result = await renderAtWithBrowser(browser, {
    width: 900,
    height: 320,
    entry: 'tests/harness/entries/warmup-wiring.entry.ts',
    waitFor: 'html[data-harness-ready]',
    freezeAnimations: true,
    outPng: join(OUT_DIR, 'warmup-icon.png'),
    assert: {
      expr: [
        { label: 'scan-called', code: 'String(window.__wiring.calls.some(c => c.url.includes("/api/dsh-threadline/scan")))', equals: 'true' },
        { label: 'detail-called', code: 'String(window.__wiring.calls.some(c => c.url.includes("/api/dsh-threadline/detail")))', equals: 'true' },
        { label: 'order-scan-before-detail', code: 'String(window.__wiring.calls.findIndex(c => c.url.includes("/scan")) < window.__wiring.calls.findIndex(c => c.url.includes("/detail")))', equals: 'true' },
        { label: 'detail-body-has-cwd', code: 'String(window.__wiring.calls.filter(c => c.url.includes("/detail")).some(c => typeof c.body?.cwd === "string" && c.body.cwd.length > 0))', equals: 'true' },
        { label: 'icon-ready', code: 'String(window.__wiring.state)', equals: 'ready' },
        { label: 'icon-has-count', code: 'String(window.__wiring.count !== null)', equals: 'true' },
        { label: 'single-scan', code: 'String(window.__wiring.calls.filter(c => c.url.includes("/api/dsh-threadline/scan")).length)', equals: '1' },
      ],
    },
  })
  for (const check of result.checks) {
    if (check.label.startsWith('expr:')) log((check.ok === false ? 'FAIL ' : 'PASS ') + check.label.slice(5) + ' => ' + JSON.stringify(check.detail?.actual))
  }
  const wiring = await result.checks && null
  log('结论: ' + (result.ok ? 'PASS' : 'FAIL'))
  writeFileSync(join(WORKSPACE_ROOT, OUT_DIR, 'warmup-wiring.txt'), lines.join('\r\n') + '\r\n', 'utf8')
  if (!result.ok) process.exit(1)
} finally {
  await browser.close()
}
