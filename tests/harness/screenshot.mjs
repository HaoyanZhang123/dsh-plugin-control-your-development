/*
 * harness/screenshot.mjs —— renderAt({ ... })：渲染 → 断言 → 截图 → 返回结果。
 *
 * API（T07/T08 照这个用，签名见 README.md）：
 *   renderAt({
 *     width, height,                     // 视口（= 宿主面板宽度）
 *     containerWidth,                    // 可选：容器宽（视口更宽时用，证明是容器查询不是 viewport）
 *     entry, html, bundlePath, css,      // 页面来源（三选一；entry 用 esbuild 现打）
 *     dark, reducedMotion, lang,         // 主题/动效/语言
 *     actions,                           // [{type:'click'|'evaluate'|'wait'|'waitFor'|'key', ...}]
 *     assert,                            // 声明式断言（见 README）
 *     outPng,                            // 截图落盘路径（相对工作区根或绝对路径）
 *     browser,                           // 复用已启动的浏览器（批量截图时用）
 *   }) → { ok, checks, metrics, errors, console, png, pageUrl, profileDir }
 *
 * 约定：断言结果全部来自页面内真实 DOM / computed style，不在 node 里"猜"。
 */
import { createHash } from 'node:crypto'
import { statSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { HarnessError, launchBrowser } from './cdp.mjs'
import { PLUGIN_ROOT, bundleEntry, makePageHtml, readBundle } from './build.mjs'

/** 工作区根（plugin/ 往上三层）。 */
export const WORKSPACE_ROOT = resolve(PLUGIN_ROOT, '..', '..', '..')

/** 页面内断言脚本（字符串拼接，不用模板串：工厂纪律禁止反引号）。 */
const CHECK_SCRIPT = [
  'function check(spec){',
  '  var out = { checks: [], metrics: {} };',
  '  function push(label, ok, detail){ out.checks.push({ label: label, ok: ok === true, detail: detail === undefined ? null : detail }); }',
  '  var de = document.documentElement;',
  '  var body = document.body;',
  '  out.metrics = {',
  '    scrollWidth: de.scrollWidth, clientWidth: de.clientWidth,',
  '    scrollHeight: de.scrollHeight, clientHeight: de.clientHeight,',
  '    bodyScrollWidth: body.scrollWidth, bodyClientWidth: body.clientWidth,',
  '    viewportWidth: window.innerWidth, viewportHeight: window.innerHeight,',
  '    devicePixelRatio: window.devicePixelRatio,',
  '    readyState: document.readyState',
  '  };',
  '  if (spec.noHScroll !== false) {',
  '    var okH = de.scrollWidth <= de.clientWidth && body.scrollWidth <= body.clientWidth;',
  '    push("no-page-hscroll", okH, {',
  '      scrollWidth: de.scrollWidth, clientWidth: de.clientWidth,',
  '      bodyScrollWidth: body.scrollWidth, bodyClientWidth: body.clientWidth',
  '    });',
  '  }',
  '  var scan = "[data-region],.threadline-shell,.threadline-main,.threadline-header,.threadline-turns,.threadline-timeline,.threadline-now";',
  '  var overflowing = [];',
  '  var nodes = document.querySelectorAll(scan);',
  '  for (var i = 0; i < nodes.length; i++) {',
  '    var el = nodes[i];',
  '    if (el.scrollWidth > el.clientWidth + 1) {',
  '      overflowing.push({ region: el.getAttribute("data-region"), cls: String(el.className), scrollWidth: el.scrollWidth, clientWidth: el.clientWidth });',
  '    }',
  '  }',
  '  out.metrics.overflow = overflowing;',
  '  if (spec.noInnerOverflow !== false) push("no-inner-hoverflow", overflowing.length === 0, overflowing);',
  '  var regions = [];',
  '  var regionNodes = document.querySelectorAll("[data-region]");',
  '  for (var r = 0; r < regionNodes.length; r++) {',
  '    var rn = regionNodes[r];',
  '    var rb = rn.getBoundingClientRect();',
  '    var rs = window.getComputedStyle(rn);',
  '    regions.push({ region: rn.getAttribute("data-region"), x: Math.round(rb.x), y: Math.round(rb.y), width: Math.round(rb.width), height: Math.round(rb.height), position: rs.position, display: rs.display });',
  '  }',
  '  out.metrics.regions = regions;',
  '  var inspector = document.querySelector("[data-region=inspector]");',
  '  if (inspector) {',
  '    var ib = inspector.getBoundingClientRect();',
  '    var is = window.getComputedStyle(inspector);',
  '    out.metrics.inspector = { x: Math.round(ib.x), y: Math.round(ib.y), width: Math.round(ib.width), height: Math.round(ib.height), position: is.position, borderRadius: is.borderTopLeftRadius, maxHeight: is.maxHeight };',
  '  } else {',
  '    out.metrics.inspector = null;',
  '  }',
  '  var app = document.querySelector(".threadline-app");',
  '  out.metrics.appContainerType = app ? window.getComputedStyle(app).containerType : null;',
  '  out.metrics.bodyFontFamily = window.getComputedStyle(body).fontFamily;',
  '  function describe(sel){',
  '    var n = document.querySelector(sel);',
  '    if (!n) return null;',
  '    var b = n.getBoundingClientRect();',
  '    return { selector: sel, text: n.textContent, width: Math.round(b.width), height: Math.round(b.height) };',
  '  }',
  '  (spec.contains || []).forEach(function(item){',
  '    var n = document.querySelector(item.selector);',
  '    if (!n) { push("contains:" + item.selector, false, "元素不存在"); return; }',
  '    if (item.text === undefined) { push("contains:" + item.selector, true, describe(item.selector)); return; }',
  '    var okText = n.textContent !== null && n.textContent.indexOf(item.text) !== -1;',
  '    push("contains:" + item.selector, okText, { expected: item.text, actual: n.textContent });',
  '  });',
  '  (spec.absent || []).forEach(function(item){',
  '    var n = document.querySelector(item.selector);',
  '    push("absent:" + item.selector, n === null, n === null ? null : describe(item.selector));',
  '  });',
  '  (spec.count || []).forEach(function(item){',
  '    var list = document.querySelectorAll(item.selector);',
  '    push("count:" + item.selector, list.length === item.equals, { expected: item.equals, actual: list.length });',
  '  });',
  '  (spec.styles || []).forEach(function(item){',
  '    var n = document.querySelector(item.selector);',
  '    if (!n) { push("style:" + item.selector + "." + item.property, false, "元素不存在"); return; }',
  '    var style = window.getComputedStyle(n);',
  '    var value = item.property.indexOf("-") !== -1 ? style.getPropertyValue(item.property) : style[item.property];',
  '    if (item.equals !== undefined) push("style:" + item.selector + "." + item.property, value === item.equals, { expected: item.equals, actual: value });',
  '    else if (item.matches !== undefined) push("style:" + item.selector + "." + item.property, new RegExp(item.matches).test(String(value)), { expected: item.matches, actual: value });',
  '    else push("style:" + item.selector + "." + item.property, true, value);',
  '  });',
  '  (spec.boxes || []).forEach(function(item){',
  '    var n = document.querySelector(item.selector);',
  '    if (!n) { push("box:" + item.selector, false, "元素不存在"); return; }',
  '    var b = n.getBoundingClientRect();',
  '    var ok = true;',
  '    var detail = { width: Math.round(b.width), height: Math.round(b.height), x: Math.round(b.x), y: Math.round(b.y) };',
  '    if (item.minWidth !== undefined && b.width < item.minWidth) ok = false;',
  '    if (item.maxWidth !== undefined && b.width > item.maxWidth) ok = false;',
  '    if (item.minHeight !== undefined && b.height < item.minHeight) ok = false;',
  '    if (item.maxHeight !== undefined && b.height > item.maxHeight) ok = false;',
  '    if (item.equalsHeight !== undefined && Math.round(b.height) !== item.equalsHeight) ok = false;',
  '    push("box:" + item.selector, ok, detail);',
  '  });',
  '  (spec.expr || []).forEach(function(item){',
  '    var value;',
  '    try { value = (new Function("return (" + item.code + ")"))(); }',
  '    catch (error) { push("expr:" + item.label, false, String(error)); return; }',
  '    var okExpr = item.equals === undefined ? value === true : JSON.stringify(value) === JSON.stringify(item.equals);',
  '    push("expr:" + item.label, okExpr, { expected: item.equals === undefined ? true : item.equals, actual: value });',
  '  });',
  '  out.ok = out.checks.every(function(c){ return c.ok === true; });',
  '  return out;',
  '}',
].join('\n')

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

function resolveOutPath(outPng) {
  return isAbsolute(outPng) ? outPng : resolve(WORKSPACE_ROOT, outPng)
}

async function waitForSelector(page, selector, timeoutMs) {
  const deadline = Date.now() + (timeoutMs ?? 5000)
  const expression = 'document.querySelector(' + JSON.stringify(selector) + ') !== null'
  for (;;) {
    if (await page.evaluate(expression)) return
    if (Date.now() > deadline) throw new HarnessError('等待元素超时：' + selector)
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

async function runAction(page, action) {
  if (action.type === 'click') {
    const result = await page.evaluate(
      'var el = document.querySelector(' +
        JSON.stringify(action.selector) +
        '); if (!el) { "missing" } else { el.click(); "clicked" }',
    )
    if (result !== 'clicked') throw new HarnessError('click 目标不存在：' + action.selector)
    return
  }
  if (action.type === 'evaluate') {
    await page.evaluate(action.code, { awaitPromise: action.awaitPromise === true })
    return
  }
  if (action.type === 'wait') {
    await new Promise((resolve) => setTimeout(resolve, action.ms ?? 100))
    return
  }
  if (action.type === 'waitFor') {
    await waitForSelector(page, action.selector, action.timeoutMs)
    return
  }
  if (action.type === 'key') {
    const key = action.key ?? 'Escape'
    await page.evaluate(
      'document.dispatchEvent(new KeyboardEvent("keydown", { key: ' + JSON.stringify(key) + ', bubbles: true }))',
    )
    return
  }
  throw new HarnessError('未知 action：' + JSON.stringify(action))
}

/** 在页面里跑声明式断言，返回 { ok, checks, metrics }。 */
export async function evaluateAssertions(page, spec) {
  const expression =
    '(function(){ ' +
    CHECK_SCRIPT +
    ' return JSON.stringify(check(' +
    JSON.stringify(spec ?? {}) +
    ')); })()'
  const raw = await page.evaluate(expression)
  const parsed = JSON.parse(raw)
  return parsed
}

/**
 * 渲染 + 断言 + 截图。核心 API。
 * 不传 browser 时自己起一个、跑完关掉（profile 落在 %TEMP%）。
 */
export async function renderAt(options) {
  const ownBrowser = !options.browser
  const browser =
    options.browser ?? (await launchBrowser({ width: options.width, height: options.height, executablePath: options.executablePath }))
  try {
    return await renderAtWithBrowser(browser, options)
  } finally {
    if (ownBrowser) await browser.close()
  }
}

let pageSequence = 0

/** 同 renderAt，但复用调用方启动的浏览器（批量截图用）。 */
export async function renderAtWithBrowser(browser, options) {
  const width = options.width ?? 1280
  const height = options.height ?? 900
  const page = await browser.newPage()
  try {
    await page.setViewport({ width, height, deviceScaleFactor: options.deviceScaleFactor ?? 1 })
    if (options.reducedMotion === true) {
      await page.emulateMedia([{ name: 'prefers-reduced-motion', value: 'reduce' }])
    } else {
      await page.emulateMedia([{ name: 'prefers-reduced-motion', value: 'no-preference' }])
    }

    let html = options.html
    if (!html) {
      const js = options.entry
        ? await bundleEntry(options.entry, { buildOptions: options.buildOptions })
        : options.bundlePath
          ? await readBundle(options.bundlePath)
          : null
      if (!js) throw new HarnessError('renderAt 需要 html / entry / bundlePath 之一')
      html = makePageHtml({
        js,
        css: options.css,
        containerWidth: options.containerWidth,
        dark: options.dark,
        lang: options.lang,
        title: options.title,
        freezeAnimations: options.freezeAnimations,
      })
    }

    pageSequence += 1
    const pagePath = join(browser.profileDir, 'page-' + pageSequence + '.html')
    mkdirSync(dirname(pagePath), { recursive: true })
    writeFileSync(pagePath, html, 'utf8')
    const search = options.query ? '?' + options.query : ''
    const fileUrl = 'file:///' + pagePath.replaceAll('\\', '/') + search
    await page.navigate(fileUrl)

    // 两帧稳定：确保样式与布局都已结算（截图必须在稳定态）。
    await page.evaluate(
      'new Promise(function(resolve){ requestAnimationFrame(function(){ requestAnimationFrame(function(){ resolve(1) }) }) })',
      { awaitPromise: true },
    )
    if (options.waitFor) await waitForSelector(page, options.waitFor, options.waitForTimeoutMs)
    for (const action of options.actions ?? []) await runAction(page, action)

    const result = await evaluateAssertions(page, options.assert ?? {})
    const pageErrors = page.pageErrors.slice()
    const consoleMessages = page.consoleMessages.slice()
    const errorChecks = []
    if (options.failOnPageError !== false) {
      errorChecks.push({ label: 'no-page-error', ok: pageErrors.length === 0, detail: pageErrors })
    }
    if (options.failOnConsoleError === true) {
      const consoleErrors = consoleMessages.filter((message) => message.type === 'error')
      errorChecks.push({ label: 'no-console-error', ok: consoleErrors.length === 0, detail: consoleErrors })
    }
    const checks = result.checks.concat(errorChecks)
    const ok = checks.every((check) => check.ok === true)

    let png
    if (ok && options.outPng) {
      const buffer = await page.screenshot()
      const outPath = resolveOutPath(options.outPng)
      mkdirSync(dirname(outPath), { recursive: true })
      writeFileSync(outPath, buffer)
      png = {
        path: outPath,
        relative: outPath.replaceAll('\\', '/').replace(WORKSPACE_ROOT.replaceAll('\\', '/') + '/', ''),
        bytes: buffer.length,
        sha256: sha256(buffer),
        mtimeMs: Math.round(statSync(outPath).mtimeMs),
      }
    } else if (!ok && options.outPng) {
      // 门禁自审的"反向"要求：断言失败时不落图，避免留下会被误当证据的产物。
      png = null
    }

    return {
      ok,
      checks,
      metrics: result.metrics,
      errors: pageErrors,
      console: consoleMessages,
      png,
      pageUrl: fileUrl,
      profileDir: browser.profileDir,
      width,
      height,
      containerWidth: options.containerWidth ?? width,
      label: options.label ?? null,
    }
  } finally {
    await page.close()
  }
}
