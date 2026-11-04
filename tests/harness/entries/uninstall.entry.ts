/*
 * tests/harness/entries/uninstall.entry.ts —— 卸载可移除的自检页（03 §2.4 / T06 交付 1）。
 *
 * 做的事：注入样式 → 记录宿主里本插件的 <style> 数 → 调 disposer → 再看一次。
 * 断言（run-t06.mjs / selfcheck 里用 expr 取 window.__threadlineUninstallProbe）：
 *   注入后 2 个、卸载后 0 个、stylesInstalled() 变 false —— 宿主 DOM 里不留残留。
 */
import { installStyles, removeStyles, stylesInstalled } from '../../../src/client/styles/index.ts'

const dispose = installStyles(document)
const injected = document.querySelectorAll('style[data-plugin]').length
const installedAfterInject = stylesInstalled(document)

dispose()

const afterDispose = document.querySelectorAll('style[data-plugin]').length
const installedAfterDispose = stylesInstalled(document)

// 二次卸载必须幂等（不能因为再调一次就抛错或删别人的样式）
const secondPass = removeStyles(document)

interface Probe {
  injected: number
  installedAfterInject: boolean
  afterDispose: number
  installedAfterDispose: boolean
  secondPassRemoved: number
}

const probe: Probe = {
  injected,
  installedAfterInject,
  afterDispose,
  installedAfterDispose,
  secondPassRemoved: secondPass.removed,
}

;(window as unknown as { __threadlineUninstallProbe: Probe }).__threadlineUninstallProbe = probe
// 页面上只放一小段短文本：长 JSON 不换行会造成横向溢出，那是假阳性（不是样式泄漏）。
document.body.textContent = 'uninstall probe done'
document.documentElement.setAttribute('data-harness-ready', '1')
