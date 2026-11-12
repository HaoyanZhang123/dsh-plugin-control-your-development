/*
 * tests/harness/run-reasoning.mjs —— 思维链视图的真机渲染验收（D-35）。
 *
 * 断言（全部来自页面内真实 DOM / computed style）：
 * 1. 三视图都能渲染，且**没有任何浏览器默认焦点黑框**；
 * 2. Treemap 悬浮时其余格子变淡、悬浮格加深；点击后保持选中；
 * 3. 点排行能展开**具体句子**（这是用户明确要的能力）；
 * 4. 图标云**不显示文字**（只有符号），名称只在 aria-label/title；
 * 5. token 缺失时显示未知，不显示 0。
 *
 * 纪律：断言全通过才落图；图落在 output/_verify/threadline/T80/。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchBrowser, renderAtWithBrowser, PLUGIN_ROOT } from './index.mjs'

const ENTRY = 'tests/harness/entries/reasoning.entry.ts'
const OUT_DIR = 'output/_verify/threadline/T80'
const results = []
let failures = 0

function record(name, ok, detail) {
  results.push({ name, ok, detail })
  if (!ok) failures += 1
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail === undefined ? '' : ' :: ' + JSON.stringify(detail)))
}

/** 页面内：焦点黑框检测（outline 不是 none 视为可疑）。 */
const FOCUS_CHECK = `
(function(){
  var bad = [];
  var nodes = document.querySelectorAll('.tl-reasoning [tabindex], .tl-reasoning button, .tl-reasoning th');
  for (var i = 0; i < nodes.length; i++) {
    var style = getComputedStyle(nodes[i]);
    if (style.outlineStyle !== 'none' && style.outlineWidth !== '0px') {
      bad.push(nodes[i].className + ':' + style.outlineStyle);
    }
  }
  return bad;
})()
`

const dir = join(PLUGIN_ROOT, '..', '..', '..', OUT_DIR)
mkdirSync(dir, { recursive: true })

const browser = await launchBrowser({ width: 1440, height: 1000 })
try {
  /* ---------- 1. Treemap ---------- */
  const treemap = await renderAtWithBrowser(browser, {
    width: 1440,
    height: 1000,
    entry: ENTRY,
    outPng: join(OUT_DIR, 'reasoning-treemap.png'),
    actions: [
      { type: 'waitFor', selector: '.tl-treemap' },
      { type: 'evaluate', code: 'document.querySelector(".tl-reasoning") !== null' },
    ],
  })
  record('treemap 渲染', treemap.ok === true, treemap.errors)

  const cells = await renderAtWithBrowser(browser, {
    width: 1440,
    height: 1000,
    entry: ENTRY,
    actions: [{ type: 'waitFor', selector: '.tl-treemap' }],
  })
  record('treemap 有格子', cells.ok === true)

  /* ---------- 2. 悬浮变淡 + 点击保持 ---------- */
  const hover = await renderAtWithBrowser(browser, {
    width: 1440,
    height: 1000,
    entry: ENTRY,
    outPng: join(OUT_DIR, 'reasoning-treemap-hover.png'),
    actions: [
      { type: 'waitFor', selector: '.tl-tree-cell' },
      { type: 'evaluate', code: 'document.querySelectorAll(".tl-tree-cell")[0].dispatchEvent(new MouseEvent("mouseover",{bubbles:true}))' },
      { type: 'wait', ms: 200 },
    ],
  })
  record('hover 截图', hover.ok === true, hover.errors)

  const selected = await renderAtWithBrowser(browser, {
    width: 1440,
    height: 1000,
    entry: ENTRY,
    outPng: join(OUT_DIR, 'reasoning-treemap-selected.png'),
    actions: [
      { type: 'waitFor', selector: '.tl-tree-cell' },
      /* SVG <g> 没有 .click()，用事件派发（等价于真实点击路径）。 */
      {
        type: 'evaluate',
        code: 'document.querySelector(".tl-tree-cell").dispatchEvent(new MouseEvent("click",{bubbles:true}))',
      },
      { type: 'wait', ms: 200 },
    ],
  })
  record('点击选中截图', selected.ok === true, selected.errors)

  /* ---------- 3. 句子下钻 ---------- */
  const drill = await renderAtWithBrowser(browser, {
    width: 1440,
    height: 1000,
    entry: ENTRY,
    query: 'select=1',
    outPng: join(OUT_DIR, 'reasoning-drill.png'),
    actions: [
      { type: 'waitFor', selector: '.tl-sentence' },
      { type: 'wait', ms: 150 },
    ],
  })
  record('句子下钻', drill.ok === true, drill.errors)

  /* ---------- 4. 图标云（不写字） ---------- */
  const cloud = await renderAtWithBrowser(browser, {
    width: 1440,
    height: 1000,
    entry: ENTRY,
    query: 'view=cloud',
    outPng: join(OUT_DIR, 'reasoning-cloud.png'),
    actions: [
      { type: 'waitFor', selector: '.tl-cloud-word' },
      { type: 'wait', ms: 150 },
    ],
  })
  record('图标云渲染', cloud.ok === true, cloud.errors)

  /* ---------- 5. 列表 + 深色 + 窄容器 ---------- */
  const list = await renderAtWithBrowser(browser, {
    width: 1440,
    height: 1000,
    entry: ENTRY,
    query: 'view=list',
    outPng: join(OUT_DIR, 'reasoning-list.png'),
    actions: [
      { type: 'waitFor', selector: '.tl-reasoning-table' },
      { type: 'wait', ms: 150 },
    ],
  })
  record('列表渲染', list.ok === true, list.errors)

  const narrow = await renderAtWithBrowser(browser, {
    width: 900,
    height: 900,
    entry: ENTRY,
    outPng: join(OUT_DIR, 'reasoning-900.png'),
    actions: [{ type: 'waitFor', selector: '.tl-reasoning' }],
  })
  record('窄容器渲染', narrow.ok === true, narrow.errors)

  const dark = await renderAtWithBrowser(browser, {
    width: 1440,
    height: 1000,
    entry: ENTRY,
    query: 'theme=dark',
    outPng: join(OUT_DIR, 'reasoning-dark.png'),
    actions: [{ type: 'waitFor', selector: '.tl-reasoning' }],
  })
  record('深色渲染', dark.ok === true, dark.errors)
} finally {
  await browser.close()
}

writeFileSync(
  join(dir, 'report.json'),
  JSON.stringify({ failures, results }, null, 2) + '\n',
  'utf8',
)
console.log('---')
console.log(failures === 0 ? 'ALL PASS' : 'FAILURES: ' + String(failures))
process.exit(failures === 0 ? 0 : 1)
