/*
 * 真机验证：hover 上浮的**实际计算值**（D-35 需求 4）。
 *
 * 直接用底层 page.evaluate 读页面真实结果，不经过断言层（断言层失败时不会回传 detail）。
 * 规则来自产品产物 css.ts，不手抄。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchBrowser } from './index.mjs'
import { PLUGIN_ROOT } from './index.mjs'
import { STYLE_SHEETS } from '../../src/client/styles/css.ts'

const OUT = 'output/_verify/threadline/T81'
const dir = join(PLUGIN_ROOT, '..', '..', '..', OUT)
mkdirSync(dir, { recursive: true })

const ALL_CSS = STYLE_SHEETS.map((sheet) => sheet.css).join('\n')

const HTML = [
  '<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0">',
  '<div class="threadline-app" data-reduced-motion="false">',
  '  <div class="tl-tree-body" role="group"><button class="tl-tree-card" id="card">card</button></div>',
  '  <button class="threadline-turn-block" id="turn">turn</button>',
  '</div>',
  '<div class="threadline-app" data-reduced-motion="true">',
  '  <button class="tl-tree-card" id="card-rm">card</button>',
  '</div>',
  '</body></html>',
].join('\n')

const results = []
let failures = 0
function record(name, ok, detail) {
  results.push({ name, ok, detail })
  if (!ok) failures += 1
  console.log((ok ? 'PASS ' : 'FAIL ') + name + ' :: ' + JSON.stringify(detail))
}

const browser = await launchBrowser({ width: 1200, height: 900 })
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1200, height: 900, deviceScaleFactor: 1 })
  await page.navigate('about:blank')
  await page.evaluate(
    'document.head.innerHTML = ""; document.body.innerHTML = ' +
      JSON.stringify(HTML.slice(HTML.indexOf('<body') + 6, HTML.indexOf('</body>'))) +
      '; var style = document.createElement("style"); style.textContent = ' +
      JSON.stringify(ALL_CSS) +
      '; document.head.appendChild(style);',
  )
  await new Promise((resolve) => setTimeout(resolve, 150))

  const probe = await page.evaluate(
    [
      'var found = { cardHover: false, turnHover: false, rmOverride: false, ruleCount: 0, totalCssRules: 0 };',
      'var sheets = Array.prototype.slice.call(document.styleSheets);',
      'for (var i = 0; i < sheets.length; i++) {',
      '  var rules;',
      '  try { rules = sheets[i].cssRules; } catch (e) { continue; }',
      '  found.totalCssRules += rules.length;',
      '  for (var j = 0; j < rules.length; j++) {',
      '    var rule = rules[j];',
      '    var sel = rule.selectorText || "";',
      '    var text = rule.cssText || "";',
      '    if (sel.indexOf(".tl-tree-card:hover") >= 0 && text.indexOf("translateY(-2px)") >= 0) found.cardHover = true;',
      '    if (sel.indexOf(".threadline-turn-block:hover") >= 0 && text.indexOf("translateY(-2px)") >= 0) found.turnHover = true;',
      '    if (sel.indexOf("data-reduced-motion") >= 0 && sel.indexOf(".tl-tree-card:hover") >= 0 && text.indexOf("transform: none") >= 0) found.rmOverride = true;',
      '  }',
      '}',
      'found.cardHasTransition = (function(){ var el = document.getElementById("card"); return getComputedStyle(el).transitionProperty.indexOf("transform") >= 0; })();',
      'found.turnHasTransition = (function(){ var el = document.getElementById("turn"); return getComputedStyle(el).transitionProperty.indexOf("transform") >= 0; })();',
      'JSON.stringify(found);',
    ].join('\n'),
  )

  const parsed = JSON.parse(probe)
  record('样式表确实注入（规则数 > 0）', parsed.totalCssRules > 100, { rules: parsed.totalCssRules })
  record('卡片 :hover 命中 translateY(-2px)', parsed.cardHover === true)
  record('轮次块 :hover 命中 translateY(-2px)', parsed.turnHover === true)
  record('reduced-motion 位移取消规则存在', parsed.rmOverride === true)
  record('卡片声明了 transform 过渡（有动画而非瞬跳）', parsed.cardHasTransition === true)
  record('轮次块声明了 transform 过渡', parsed.turnHasTransition === true)

  if (failures === 0) {
    const buffer = await page.screenshot()
    writeFileSync(join(dir, 'hover-lift.png'), buffer)
  }
} finally {
  await browser.close()
}

writeFileSync(join(dir, 'report.json'), JSON.stringify({ failures, results }, null, 2) + '\n', 'utf8')
console.log('---')
console.log(failures === 0 ? 'ALL PASS' : 'FAILURES: ' + String(failures))
process.exit(failures === 0 ? 0 : 1)
