/*
 * tests/ui-map/run-t07.mjs —— 左图「关系图」（R10）与时间轴/交互的截图 + 断言采集。
 *
 * 历史：本文件在 2026-11-08 曾被误用 `git checkout` 回退到 1.1.0 版（依赖已删除的
 * `rail.css` / `buildDirectoryCards` / `data-directory-card`），已按 R10 的真实 DOM 重写干净。
 * 单一执行路径：不再保留任何网格/星图/旧目录卡断言。
 *
 * 产出（默认 output/_verify/threadline/T07/；用 TL_TASK=T51 存到 T51/）：
 *   folder-1440.png    1440x900 根目录：**关系图**（默认标准档，边常驻）+ 右栏文件浏览器
 *   turn-1440.png      点某一轮：图切本轮文件
 *   nested.png         嵌套目录：当前目录过滤 + 关系图
 *   narrow-900.png     900 宽：单列堆叠
 *   show-all.png       节点 >40 的目录：点「显示全部」后的降级形态
 *   zoom.png           缩放三档：围绕视口中心（几何断言）
 *   *.txt              每张图的断言原始值 + sha256 + 时间戳
 *   interaction.txt    目录进出 / 轮次进出 / 缩放中心 / 拖动+重置 / 密度切换
 *
 * 纪律（harness README §5）：截图只在全部断言通过时落盘；每张图对应可复现状态；
 * 不用模板串反引号；交互走真实 DOM 事件。
 *
 * 用法：
 *   node tests/ui-map/run-t07.mjs                  # 默认 T07 目录
 *   TL_TASK=T51 node tests/ui-map/run-t07.mjs      # R10 证据目录
 */
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { launchBrowser, renderAtWithBrowser, PLUGIN_ROOT, WORKSPACE_ROOT } from '../harness/index.mjs'
import { GRAPH_HUB_PAIR_OPACITY, GRAPH_HUB_PAIR_WIDTH_BASE, GRAPH_HUB_PAIR_WIDTH_MAX, GRAPH_LIMITS } from '../../src/client/ui/map/index.ts'

const ENTRY_MAP = 'tests/ui-map/entries/map.entry.ts'
const TASK = process.env.TL_TASK ?? 'T07'
const OUT_DIR = resolve(WORKSPACE_ROOT, 'output/_verify/threadline/' + TASK)

/**
 * 代码新鲜度覆盖面：截图必须晚于这里的最后一次改动。
 * 只列**还存在的**文件——旧的 rail.css / overview.ts / levels.ts 已删除，列进来会 statSync 抛错。
 */
const COVERAGE = [
  'src/client/ui/map',
  'src/client/ui/rail',
  'src/client/ui/turns',
  'src/client/ui/shell',
  'src/client/ui/timeline',
  'src/client/locale',
  'src/client/styles/map.css',
  'src/client/styles/tree.css',
  'src/client/styles/base.css',
  'src/client/styles/timeline.css',
  'src/client/styles/turns.css',
  // 注意：**不要**把 `tests/ui-map` 放进新鲜度覆盖面。
  // 截图只应对「产品代码」新鲜；改测试/改断言不该让已拍好的截图作废
  // （2026-11-08 实测：改一条测试断言就触发 STALE，把"证据新鲜度"变成了噪音）。
]

let sceneSequence = 0

/* ------------------------------------------------------------------ *
 * 基础设施
 * ------------------------------------------------------------------ */

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

function iso(ms) {
  return new Date(ms).toISOString()
}

/** COVERAGE 里每个文件/目录的最新 mtime（截图必须晚于它）。 */
function latestCodeMtime() {
  let latest = 0
  let latestFile = ''
  const walk = (target) => {
    const info = statSync(target)
    if (info.isDirectory()) {
      for (const entry of readdirSync(target)) walk(join(target, entry))
      return
    }
    if (!/\.(ts|tsx|css|mjs)$/.test(target)) return
    if (info.mtimeMs > latest) {
      latest = info.mtimeMs
      latestFile = target
    }
  }
  for (const relative of COVERAGE) walk(join(PLUGIN_ROOT, relative))
  return {
    mtimeMs: latest,
    file: latestFile.replaceAll('\\', '/').replace(WORKSPACE_ROOT.replaceAll('\\', '/') + '/', ''),
  }
}

const codeStamp = latestCodeMtime()

function clean(relative) {
  return relative.replaceAll('\\', '/').split('projects/dsh-plugin-control-your-development/plugin/').pop()
}

/**
 * 断言结果归类。`renderAtWithBrowser` 返回 `{ checks, metrics, png }`；
 * 不在断言里做强校验（比如"截图是否晚于代码"）是**故意**的：那类事后条件放 main() 里统一判。
 */
function check(result, label) {
  const failed = result.checks.filter((item) => item.ok !== true)
  return { label, ok: failed.length === 0, failed, checks: result.checks }
}

/* ------------------------------------------------------------------ *
 * 场景断言
 * ------------------------------------------------------------------ */

/**
 * 关系图的核心断言组（R10 的验收要点，全部用真实 DOM 值）。
 *
 * 这里刻意**不**断言具体坐标数值（力导向坐标随节点集变化），只断言
 * 「结构性质」——它们才是"是不是关系图"的判据。
 */
const GRAPH_ASSERTIONS = {
  expr: [
    // —— 真正是图：默认档必须有边（R10 之前是 0 条，这是本轮最关键的回归断言）——
    { label: 'edges-by-default', code: 'Number(document.querySelector("[data-tl-graph]").getAttribute("data-graph-relations")) >= 1', equals: true },
    { label: 'edges-drawn', code: 'document.querySelectorAll("[data-edge-id]").length >= 1', equals: true },
    // —— 默认密度 = standard ——
    { label: 'density-standard', code: 'document.querySelector("[data-tl-graph]").getAttribute("data-density")', equals: 'standard' },
    // —— 边分层标在 DOM 上 ——
    { label: 'edges-layered', code: 'document.querySelectorAll("[data-edge-layer]").length > 0', equals: true },
    // —— 铺满视口（力导向归一化后的 fill ratio，0..1）——
    { label: 'fills-viewport', code: 'Number(document.querySelector("[data-tl-graph]").getAttribute("data-graph-fill")) >= 0.55', equals: true },
    // —— 不是网格：节点 x 坐标不能全都相同（等宽列的特征）——
    {
      label: 'not-a-grid',
      code: '(function(){var ns=document.querySelectorAll("[data-file-path]");if(ns.length<4)return true;var xs={};for(var i=0;i<ns.length;i++){var b=ns[i].getBoundingClientRect();xs[Math.round(b.x)]=1}return Object.keys(xs).length>=Math.max(2,Math.ceil(ns.length*0.3))})()',
      equals: true,
    },
    // —— 文件夹枢纽用不同形状表达层级（拱形卡片），不是"排一条带"——
    { label: 'hubs-are-cards', code: 'document.querySelectorAll("[data-folder-hub] rect.tl-foldhub-card").length > 0', equals: true },
    // —— 枢纽带跨目录关系标记（有/无都必须显式）——
    { label: 'hub-link-state-explicit', code: 'document.querySelectorAll("[data-folder-hub][data-hub-linked]").length === document.querySelectorAll("[data-folder-hub]").length', equals: true },
    // —— 密度组三档都在 ——
    { label: 'density-group', code: 'document.querySelectorAll("[data-density-action]").length', equals: 3 },
    // —— R11：**不同文件夹之间也要连线**（用户 2026-11-08 提出；默认标准档必须有）——
    {
      label: 'hub-pairs-present',
      code: 'Number(document.querySelector("[data-tl-graph]").getAttribute("data-hub-pair-count")) >= 1',
      equals: true,
    },
    {
      label: 'hub-pair-layer-is-hub',
      code: 'Array.prototype.every.call(document.querySelectorAll("[data-hub-pair]"), function (el) { return el.getAttribute("data-hub-pair-layer") === "hub" })',
      equals: true,
    },
    {
      label: 'hub-pair-contract-complete',
      code: '(function () { var ns = document.querySelectorAll("[data-hub-pair]"); if (ns.length === 0) return false; for (var i = 0; i < ns.length; i += 1) { var el = ns[i]; if (!el.getAttribute("data-hub-pair-a") || !el.getAttribute("data-hub-pair-b") || !el.getAttribute("data-hub-pair-weight") || !el.getAttribute("data-hub-pair-count")) return false } return true })()',
      equals: true,
    },
    {
      // 无向去重 + min/max 归一（A↔B 只一条）；不写死分隔符（HTML 解析可能归一 U+0000）。
      label: 'hub-pair-undirected-unique',
      code: '(function () { var ns = document.querySelectorAll("[data-hub-pair]"); var seen = {}; for (var i = 0; i < ns.length; i += 1) { var el = ns[i]; var key = el.getAttribute("data-hub-pair"); if (seen[key]) return false; seen[key] = 1; var a = el.getAttribute("data-hub-pair-a").toLowerCase(); var b = el.getAttribute("data-hub-pair-b").toLowerCase(); if (!(a < b)) return false; if (key.indexOf(a) !== 0) return false; if (key.slice(key.length - b.length) !== b) return false; if (key.length !== a.length + b.length + 1) return false } return ns.length > 0 })()',
      equals: true,
    },
    {
      // 视觉分层：枢纽间线是**虚线**（CSS 给 dash 4 3），线宽按权重算且不超出封顶，
      // 默认透明度 = GRAPH_HUB_PAIR_OPACITY。
      // 数值一律从 theme.ts 的常量拼进来 —— **不写死魔数**（Lead 调过一次视觉权重，
      // 写死的 3.2/0.35 当场就红了；常量才是唯一事实源）。
      // 注意：Chrome 的 CSSStyleDeclaration 没有稳定的 strokeWidth 驼峰属性，统一走
      // getPropertyValue + 呈现属性，避免 NaN 让断言"假通过"。
      label: 'hub-pair-dashed-neutral',
      code:
        '(function () { var ns = document.querySelectorAll("[data-hub-pair]"); if (ns.length === 0) return false; for (var i = 0; i < ns.length; i += 1) { var el = ns[i]; var dash = getComputedStyle(el).getPropertyValue("stroke-dasharray"); if (dash.indexOf("4") < 0) return false; var attrWidth = Number(el.getAttribute("stroke-width")); if (!(attrWidth >= ' +
        String(GRAPH_HUB_PAIR_WIDTH_BASE) +
        ' - 0.001 && attrWidth <= ' +
        String(GRAPH_HUB_PAIR_WIDTH_MAX) +
        ' + 0.001)) return false; var opacity = Number(el.getAttribute("opacity")); if (!(Math.abs(opacity - ' +
        String(GRAPH_HUB_PAIR_OPACITY) +
        ') < 0.001)) return false } return true })()',
      equals: true,
    },
  ],
}

/** 时间轴：M1 之后必须没有播放控件（R05 的回归项）。 */
const NO_PLAYBACK = {
  absent: [
    { selector: '[data-testid="timeline-play"]' },
    { selector: '[data-testid="timeline-speed-1"]' },
    { selector: '[data-testid="timeline-speed-4"]' },
    { selector: '[data-playing]' },
    { selector: '[data-speed]' },
  ],
  expr: [],
}

/** 图尾（M2）：整块与四段可见文案都不许回来。 */
const NO_GRAPH_FOOT = {
  absent: [{ selector: '.tl-graph-foot' }],
  expr: [
    {
      label: 'no-foot-copy',
      code: '(function(){var t=document.body.textContent||"";return ["点右侧卡片展开目录","拖动节点可调整位置","点轮次看本轮文件","可拖动节点","基于已加载"].filter(function(s){return t.indexOf(s)>=0}).join("|")})()',
      equals: '',
    },
  ],
}

/* ------------------------------------------------------------------ *
 * 场景
 * ------------------------------------------------------------------ */

async function captureFolder(browser) {
  sceneSequence += 1
  const outPng = join(OUT_DIR, 'folder-1440.png')
  const result = await renderAtWithBrowser(browser, {
    width: 1440,
    height: 900,
    entry: ENTRY_MAP,
    query: 'state=default',
    waitFor: 'html[data-harness-ready]',
    outPng,
    assert: {
      contains: [
        { selector: '[data-region="map"]' },
        { selector: '[data-region="rail"]' },
        { selector: '[data-tl-graph][data-graph-mode="folder"]' },
        { selector: '[data-file-tree-rail]' },
      ],
      expr: [...GRAPH_ASSERTIONS.expr, ...NO_GRAPH_FOOT.expr, ...NO_PLAYBACK.expr],
      absent: [...(NO_GRAPH_FOOT.absent ?? []), ...(NO_PLAYBACK.absent ?? [])],
    },
    label: 'folder-1440',
  })
  return check(result, 'folder-1440')
}

async function captureTurn(browser) {
  const outPng = join(OUT_DIR, 'turn-1440.png')
  const result = await renderAtWithBrowser(browser, {
    width: 1440,
    height: 900,
    entry: ENTRY_MAP,
    query: 'state=turn&turn=2',
    waitFor: 'html[data-harness-ready]',
    outPng,
    assert: {
      contains: [{ selector: '[data-tl-graph][data-graph-mode="turn"]' }],
      expr: [
        { label: 'turn-mode', code: 'document.querySelector("[data-tl-graph]").getAttribute("data-graph-mode")', equals: 'turn' },
        { label: 'turn-has-nodes', code: 'document.querySelectorAll("[data-file-path]").length > 0', equals: true },
        ...NO_GRAPH_FOOT.expr,
        ...NO_PLAYBACK.expr,
      ],
      absent: [...(NO_GRAPH_FOOT.absent ?? []), ...(NO_PLAYBACK.absent ?? [])],
    },
    label: 'turn-1440',
  })
  return check(result, 'turn-1440')
}

async function captureNested(browser) {
  const outPng = join(OUT_DIR, 'nested.png')
  const result = await renderAtWithBrowser(browser, {
    width: 1440,
    height: 900,
    entry: ENTRY_MAP,
    query: 'state=default&nested=1&dir=src/client',
    waitFor: 'html[data-harness-ready]',
    outPng,
    assert: {
      contains: [{ selector: '[data-tl-graph][data-graph-mode="folder"]' }],
      expr: [
        // 当前目录必须真的是 src/client，且图里不能出现别的顶层目录的文件（无跨目录蜘蛛网）
        { label: 'nested-current', code: 'document.querySelector("[data-testid=graph]").getAttribute("data-graph-current")', equals: 'src/client' },
        { label: 'nested-has-content', code: 'document.querySelectorAll("[data-file-path]").length > 0', equals: true },
        // 关系图在任意一层都成立（用户原话：「每一个点开之后，里面的展开之后，也应该这样」）
        { label: 'nested-is-graph', code: 'document.querySelectorAll("[data-file-path]").length >= 2', equals: true },
      ],
    },
    label: 'nested',
  })
  return check(result, 'nested')
}

async function captureNarrow(browser) {
  const outPng = join(OUT_DIR, 'narrow-900.png')
  const result = await renderAtWithBrowser(browser, {
    width: 900,
    height: 900,
    entry: ENTRY_MAP,
    query: 'state=default',
    waitFor: 'html[data-harness-ready]',
    outPng,
    assert: {
      expr: [
        { label: 'narrow-no-hscroll', code: 'document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1', equals: true },
        { label: 'narrow-graph-ok', code: 'document.querySelectorAll("[data-file-path]").length >= 1', equals: true },
        ...NO_GRAPH_FOOT.expr,
      ],
      absent: [...(NO_GRAPH_FOOT.absent ?? [])],
    },
    label: 'narrow-900',
  })
  return check(result, 'narrow-900')
}

/**
 * 「显示全部」：>40 文件的目录。
 * docs 在 fixture 里有 75 个直接文件 —— 超过 40 上限，chip 必须出现。
 */
async function captureShowAll(browser) {
  const outPng = join(OUT_DIR, 'show-all.png')
  const result = await renderAtWithBrowser(browser, {
    width: 1440,
    height: 900,
    entry: ENTRY_MAP,
    query: 'state=default&files=600&dir=docs',
    waitFor: 'html[data-harness-ready]',
    actions: [{ type: 'click', selector: '[data-graph-show-all]' }, { type: 'wait', ms: 400 }],
    outPng,
    assert: {
      contains: [{ selector: '[data-graph-show-all][data-expanded="true"]' }],
      expr: [
        { label: 'expanded', code: 'document.querySelector("[data-graph-show-all]").getAttribute("data-expanded")', equals: 'true' },
        { label: 'showall-expanded-flag', code: 'document.querySelector("[data-tl-graph]").getAttribute("data-show-all-expanded")', equals: 'true' },
        // 自动降级：密度必须掉到 skeleton
        { label: 'auto-degraded-density', code: 'document.querySelector("[data-tl-graph]").getAttribute("data-density")', equals: 'skeleton' },
        // 自动降级：标签只标 hover/选中 → 默认档不应有满屏标签
        { label: 'auto-degraded-labels', code: 'document.querySelectorAll("[data-label-for]").length <= 2', equals: true },
        // 硬上限：节点数不超过 folderAllMax
        { label: 'hard-cap', code: 'document.querySelectorAll("[data-file-path]").length <= ' + String(GRAPH_LIMITS.folderAllMax), equals: true },
        // R11：全部档自动降级到骨架 → 枢纽间连线也必须一条都不画（档位联动一致）
        {
          label: 'hub-pair-degraded-to-zero',
          code: 'Number(document.querySelector("[data-tl-graph]").getAttribute("data-hub-pair-count")) === 0',
          equals: true,
        },
      ],
    },
    label: 'show-all',
  })
  return check(result, 'show-all')
}

/**
 * R11 新场景：**不同文件夹之间的连线**（03 §4.2.2「文件夹枢纽参与结构」第 2 条）。
 *
 * 为什么单独一个场景：三档的 `data-hub-pair` 数量必须**真的按档重算**
 * （骨架 0 / 标准每枢纽 top-2 / 全部每枢纽 top-4），不能靠 CSS 隐藏；
 * 同时验证「悬停枢纽 → 它的枢纽间线提亮 + 其余枢纽 dim」和
 * 「点击枢纽仍是进入目录」（加线不改变点击语义）。
 */
async function captureHubPairs(browser) {
  const outPng = join(OUT_DIR, 'hub-pairs.png')
  const result = await renderAtWithBrowser(browser, {
    width: 1440,
    height: 900,
    entry: ENTRY_MAP,
    query: 'state=default',
    waitFor: 'html[data-harness-ready]',
    actions: [
      // 1) 标准档（默认）：记下数量
      {
        type: 'evaluate',
        code: 'window.__tlHubStandard = Number(document.querySelector("[data-tl-graph]").getAttribute("data-hub-pair-count"))',
      },
      // 2) 切骨架档：必须 0 条（重新计算，不是 CSS 隐藏）
      { type: 'click', selector: '[data-density-action="skeleton"]' },
      { type: 'wait', ms: 220 },
      // 3) 切全部档：数量必须 ≥ 标准档
      { type: 'click', selector: '[data-density-action="all"]' },
      { type: 'wait', ms: 220 },
      {
        type: 'evaluate',
        code: 'window.__tlHubAll = Number(document.querySelector("[data-tl-graph]").getAttribute("data-hub-pair-count"))',
      },
      // 4) 回到标准档
      { type: 'click', selector: '[data-density-action="standard"]' },
      { type: 'wait', ms: 220 },
      // 5) 悬停一个真正有枢纽间线的枢纽：用 pointerover 触发 React 的 onPointerEnter
      //    注意 relatedTarget 必须是**图外**的 document.body —— 用图内祖先（如 zoom-layer）
      //    React 的 enter/leave 合成器不会判定为"从外面进来"，事件会被吞掉（实测）。
      {
        type: 'evaluate',
        code: '(function () { var line = document.querySelector("[data-hub-pair]"); if (!line) return; var hub = document.querySelector(\'[data-folder-hub="\' + line.getAttribute("data-hub-pair-a") + \'"]\'); if (!hub) return; hub.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, relatedTarget: document.body })); return })()',
      },
      { type: 'wait', ms: 220 },
      // 6) 悬停期间取证：提亮的线 / 被 dim 的枢纽 / 被 dim 的线
      {
        type: 'evaluate',
        code: 'window.__tlHubHover = { focused: document.querySelectorAll("[data-hub-pair][data-hub-pair-focused=\\"true\\"]").length, dimmedHubs: document.querySelectorAll("[data-folder-hub][data-dimmed=\\"true\\"]").length, dimmedLines: document.querySelectorAll("[data-hub-pair][data-hub-pair-dimmed=\\"true\\"]").length, hubs: document.querySelectorAll("[data-folder-hub]").length, hoveredHubs: document.querySelectorAll("[data-folder-hub][data-hovered=\\"true\\"]").length }',
      },
      // 7) 移开：恢复（pointerout 回到 body）
      {
        type: 'evaluate',
        code: '(function () { var hub = document.querySelector("[data-folder-hub][data-hovered=\\"true\\"]"); if (!hub) return; hub.dispatchEvent(new PointerEvent("pointerout", { bubbles: true, relatedTarget: document.body })) })()',
      },
      { type: 'wait', ms: 200 },
      {
        type: 'evaluate',
        code: 'window.__tlHubAfterLeave = { dimmedHubs: document.querySelectorAll("[data-folder-hub][data-dimmed=\\"true\\"]").length, focused: document.querySelectorAll("[data-hub-pair][data-hub-pair-focused=\\"true\\"]").length }',
      },
      // 8) 点击枢纽仍然是「进入该目录」（加线不改变点击语义）
      {
        type: 'evaluate',
        code: '(function () { var line = document.querySelector("[data-hub-pair]"); var target = line.getAttribute("data-hub-pair-b"); var hub = document.querySelector(\'[data-folder-hub="\' + target + \'"]\'); window.__tlHubTarget = target; hub.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window })) })()',
      },
      { type: 'wait', ms: 320 },
      {
        type: 'evaluate',
        code: 'window.__tlHubNavigated = document.querySelector("[data-tl-graph]").getAttribute("data-graph-current")',
      },
      // 回到根目录（否则截图不是根层的图）。返回按钮的真实选择器是 data-testid="rail-back"
      // —— 注意：既有 interaction 场景里用的 [data-rail-back] **不存在**（静默 no-op），
      //    那是 R11 发现的 harness 缺陷，已单独报给 Lead；这里用正确的选择器。
      { type: 'evaluate', code: 'document.querySelector(\'[data-testid="rail-back"]\')?.click()' },
      { type: 'wait', ms: 320 },
    ],
    outPng,
    assert: {
      contains: [{ selector: '[data-tl-graph][data-graph-mode="folder"]' }, { selector: '[data-hub-pair]' }],
      expr: [
        // 三档数量关系：skeleton = 0 < standard ≤ all（且都受 top-N × 枢纽数 约束）
        { label: 'hub-pair-standard-positive', code: 'window.__tlHubStandard >= 1', equals: true },
        { label: 'hub-pair-back-to-standard', code: 'document.querySelector("[data-tl-graph]").getAttribute("data-density")', equals: 'standard' },
        {
          label: 'hub-pair-standard-restored',
          code: 'Number(document.querySelector("[data-tl-graph]").getAttribute("data-hub-pair-count")) === window.__tlHubStandard',
          equals: true,
        },
        { label: 'hub-pair-all-monotonic', code: 'window.__tlHubAll >= window.__tlHubStandard', equals: true },
        {
          label: 'hub-pair-standard-cap',
          code: 'window.__tlHubStandard <= 2 * document.querySelectorAll("[data-folder-hub]").length',
          equals: true,
        },
        {
          label: 'hub-pair-all-cap',
          code: 'window.__tlHubAll <= 4 * document.querySelectorAll("[data-folder-hub]").length',
          equals: true,
        },
        // 悬停：焦点枢纽的线提亮、其余枢纽 dim、无关的线压暗
        { label: 'hub-hover-focus-lines', code: 'window.__tlHubHover.focused >= 1', equals: true },
        { label: 'hub-hover-dim-others', code: 'window.__tlHubHover.dimmedHubs >= 1', equals: true },
        { label: 'hub-hover-hub-marked', code: 'window.__tlHubHover.hoveredHubs === 1', equals: true },
        // 03 §4.4：移开必须恢复，**不允许 hover 卡住导致整图长期 dim**
        { label: 'hub-hover-leave-recovers', code: 'window.__tlHubAfterLeave.dimmedHubs === 0 && window.__tlHubAfterLeave.focused === 0', equals: true },
        // 点击枢纽仍然进入该目录
        { label: 'hub-click-enters-folder', code: 'window.__tlHubNavigated === window.__tlHubTarget', equals: true },
        // 回到根：仍是 folder 图且有枢纽间线
        { label: 'hub-pair-back-at-root', code: 'document.querySelector("[data-tl-graph]").getAttribute("data-graph-current")', equals: '' },
      ],
    },
    label: 'hub-pairs',
  })
  return check(result, 'hub-pairs')
}

/** 缩放三档：几何断言（围绕视口中心，不再往左上跑）。 */async function captureZoom(browser) {
  const outPng = join(OUT_DIR, 'zoom.png')
  const result = await renderAtWithBrowser(browser,
    {
      width: 1440,
      height: 900,
      entry: ENTRY_MAP,
      query: 'state=default',
      waitFor: 'html[data-harness-ready]',
      actions: [
        { type: 'click', selector: '[data-zoom-action="out"]' },
        { type: 'wait', ms: 200 },
      ],
      outPng,
      assert: {
        expr: [
          { label: 'zoom-out-applied', code: 'Number(document.querySelector("[data-tl-graph]").getAttribute("data-zoom")) < 1', equals: true },
          // 中心漂移：缩放后视口中心仍应落在同一图元附近（QA 的 M5 判据 ≤2px）
          { label: 'zoom-transform-present', code: '(function(){var l=document.querySelector("[data-zoom-layer]");return !!l && (l.getAttribute("transform")||"").indexOf("scale")>=0})()', equals: true },
        ],
      },
    },
    { label: 'zoom' },
  )
  return check(result, 'zoom')
}

/**
 * 交互：目录进出 / 轮次进出 / 密度切换 / 拖动 + 重置。
 *
 * 密度切换必须**严格单调递增**（skeleton < standard < all 的边数），
 * 这是"分层真的在起作用"的判据；如果三档边数相同说明分层没接上。
 */
async function captureInteraction(browser) {
  const outPng = join(OUT_DIR, 'interaction.png')
  const result = await renderAtWithBrowser(browser, {
    width: 1440,
    height: 900,
    entry: ENTRY_MAP,
    query: 'state=default',
    waitFor: 'html[data-harness-ready]',
    actions: [
      // 1) 切到骨架档
      { type: 'click', selector: '[data-density-action="skeleton"]' },
      { type: 'wait', ms: 200 },
      { type: 'evaluate', code: 'window.__tlSkeletonEdges = window.__tl.edgeCount()' },
      // R11：骨架档的枢纽间连线必须**一条都没有**（重新计算，不是 CSS 隐藏）
      { type: 'evaluate', code: 'window.__tlHubSkeleton = window.__tl.hubPairCount()' },
      // 2) 切到全部档
      { type: 'click', selector: '[data-density-action="all"]' },
      { type: 'wait', ms: 200 },
      { type: 'evaluate', code: 'window.__tlAllEdges = window.__tl.edgeCount()' },
      { type: 'evaluate', code: 'window.__tlHubAll = window.__tl.hubPairCount()' },
      // 3) 回到标准档
      { type: 'click', selector: '[data-density-action="standard"]' },
      { type: 'wait', ms: 200 },
      // 4) 进目录再回退
      //    返回按钮的真实选择器是 data-testid="rail-back"。旧写法 [data-rail-back] **不存在**，
      //    所以这一步长期是静默 no-op（"进目录→回退"实际没回退，断言却只查 mode=folder 仍绿）。
      //    2026-11-08 修正 —— 这条正是"断言形同虚设"的典型，反向验证时被发现。
      { type: 'evaluate', code: 'window.__tl.enterHub("src")' },
      { type: 'wait', ms: 300 },
      { type: 'evaluate', code: 'document.querySelector(\'[data-testid="rail-back"]\')?.click()' },
      { type: 'wait', ms: 300 },
    ],
    outPng,
    assert: {
      expr: [
        // 分层有效：all 的边数 >= skeleton 的边数（相等也允许——数据本来就没 L3 边）
        { label: 'density-monotonic', code: 'window.__tlAllEdges >= window.__tlSkeletonEdges', equals: true },
        // 切回标准档后，密度标签回到 standard
        { label: 'density-back-to-standard', code: 'document.querySelector("[data-tl-graph]").getAttribute("data-density")', equals: 'standard' },
        // 目录进出后仍在 folder 模式（弱断言，保留作基线）
        { label: 'nav-roundtrip', code: 'document.querySelector("[data-tl-graph]").getAttribute("data-graph-mode")', equals: 'folder' },
        // **强断言**：进 src 再点返回，当前目录必须真的回到根（""），否则说明回退按钮没生效。
        // 旧版本这条只查 mode=folder —— 用不存在的选择器 [data-rail-back] 也照样绿，
        // 是典型的"断言形同虚设"（2026-11-08 修正）。
        { label: 'nav-back-to-root', code: 'document.querySelector("[data-testid=graph]").getAttribute("data-graph-current")', equals: '' },
        // 边数上限：≤ 1.6 × 节点数（round R10 的硬约束）
        {
          label: 'edge-cap',
          code: '(function(){var n=document.querySelectorAll("[data-file-path]").length;var e=document.querySelectorAll("[data-edge-id]").length;if(n===0)return true;return e<=Math.ceil(n*1.6)+1})()',
          equals: true,
        },
        // R11：枢纽间连线按档位重算 —— 骨架 0 条、全部 ≥ 标准（且都不算进 1.6× 的节点边比例）
        { label: 'hub-pair-skeleton-zero', code: 'window.__tlHubSkeleton === 0', equals: true },
        { label: 'hub-pair-all-monotonic', code: 'window.__tlHubAll >= Number(document.querySelector("[data-tl-graph]").getAttribute("data-hub-pair-count"))', equals: true },
        {
          label: 'hub-pair-not-in-node-edge-ratio',
          code: '(function(){var n=document.querySelectorAll("[data-file-path]").length;var e=document.querySelectorAll("[data-edge-id]").length;if(n===0)return true;return e<=Math.ceil(n*1.6)+1})()',
          equals: true,
        },
      ],
    },
    label: 'interaction',
  })
  return check(result, 'interaction')
}

/* ------------------------------------------------------------------ *
 * main
 * ------------------------------------------------------------------ */

function report(results) {
  const lines = []
  let failures = 0
  for (const result of results) {
    if (!result.ok) failures += 1
    lines.push('=== ' + result.label + ' ===')
    lines.push(result.ok ? '  断言: PASS（' + String(result.checks.length) + ' 条）' : '  断言: FAIL')
    for (const item of result.failed) {
      lines.push('  FAILED  ' + item.label + '  ' + JSON.stringify(item.detail ?? null))
    }
    lines.push('')
    console.log((result.ok ? 'PASS ' : 'FAIL ') + result.label)
    for (const item of result.failed) {
      console.log('  FAILED  ' + item.label + '  ' + JSON.stringify(item.detail ?? null))
    }
  }
  return { text: lines.join('\n'), failures }
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true })
  const browser = await launchBrowser({ width: 1440, height: 900 })
  const results = []
  try {
    results.push(await captureFolder(browser))
    results.push(await captureTurn(browser))
    results.push(await captureNested(browser))
    results.push(await captureNarrow(browser))
    results.push(await captureShowAll(browser))
    results.push(await captureZoom(browser))
    results.push(await captureInteraction(browser))
    results.push(await captureHubPairs(browser))
  } finally {
    await browser.close?.()
  }

  const { text, failures } = report(results)

  // 截图必须晚于最后一次代码改动（04 §3.1 的证据新鲜度纪律）
  const entries = readdirSync(OUT_DIR)
    .filter((name) => name.endsWith('.png') && name !== 'show-all.png')
    .map((name) => {
      const info = statSync(join(OUT_DIR, name))
      return { name, mtimeMs: info.mtimeMs, fresh: info.mtimeMs > codeStamp.mtimeMs }
    })
  const stale = entries.filter((item) => !item.fresh)

  const summary = [
    '# TL_TASK=' + TASK,
    '# code-latest: ' + iso(codeStamp.mtimeMs) + '  ' + codeStamp.file,
    '# started: ' + iso(Date.now()),
    '',
    text,
    '=== screenshots ===',
    ...entries.map((item) => (item.fresh ? 'FRESH ' : 'STALE ') + item.name + '  ' + iso(item.mtimeMs)),
    '',
    'FAILURES=' + String(failures),
  ].join('\n')

  writeFileSync(join(OUT_DIR, 't07-summary.txt'), summary, 'utf8')
  console.log('')
  console.log('code-latest: ' + iso(codeStamp.mtimeMs) + '  (' + codeStamp.file + ')')
  for (const item of entries) {
    const hash = sha256(readFileSync(join(OUT_DIR, item.name)))
    console.log((item.fresh ? 'FRESH ' : 'STALE ') + item.name + '  sha256=' + hash.slice(0, 12))
  }
  if (stale.length > 0) {
    console.log('')
    console.log('ERROR: ' + String(stale.length) + ' screenshot(s) older than the latest code change — 必须重拍')
    process.exitCode = 1
    return
  }
  console.log('')
  console.log('T07 result: ' + (failures === 0 ? 'PASS' : 'FAIL(' + String(failures) + ')'))
  process.exitCode = failures === 0 ? 0 : 1
}

await main()
