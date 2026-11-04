/*
 * harness/cdp.mjs —— 零第三方依赖的 CDP 驱动（Node 24 内置全局 WebSocket）。
 *
 * 只用三样东西：child_process 起浏览器、全局 WebSocket 说 CDP、node:fs 写截图。
 * 浏览器 profile 一律放 os.tmpdir()（禁止写进工作区），关闭时删除（带重试：
 * Windows 上进程退出会短暂占住目录，EPERM 要重试几轮）。
 *
 * 用法见 tests/harness/README.md。
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** 本机已实测可用的浏览器（顺序即优先级）。 */
export const BROWSER_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
]

export class HarnessError extends Error {}

/** 找第一个存在的浏览器；显式传入的路径优先。 */
export function resolveBrowserPath(explicit) {
  const candidates = explicit ? [explicit, ...BROWSER_CANDIDATES] : BROWSER_CANDIDATES
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  throw new HarnessError('找不到 Chrome/Edge，无法跑 CDP 截图；候选：' + candidates.join(', '))
}

class CdpConnection {
  constructor(socket) {
    this.socket = socket
    this.nextId = 0
    this.pending = new Map()
    this.listeners = new Map()
    this.closed = false
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      if (message.id !== undefined) {
        const entry = this.pending.get(message.id)
        if (!entry) return
        this.pending.delete(message.id)
        if (message.error) entry.reject(new HarnessError(message.error.message + ' (' + message.method + ')'))
        else entry.resolve(message.result)
        return
      }
      const key = (message.sessionId ?? '') + '|' + message.method
      for (const listener of this.listeners.get(key) ?? []) listener(message.params)
    })
    socket.addEventListener('close', () => {
      this.closed = true
      for (const entry of this.pending.values()) entry.reject(new HarnessError('CDP 连接已关闭'))
      this.pending.clear()
    })
  }

  send(method, params = {}, sessionId) {
    if (this.closed) return Promise.reject(new HarnessError('CDP 连接已关闭（' + method + '）'))
    const id = ++this.nextId
    const payload = { id, method, params }
    if (sessionId) payload.sessionId = sessionId
    this.socket.send(JSON.stringify(payload))
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }))
  }

  /** 等一个事件（可带 sessionId 前缀）；超时 reject。 */
  once(key, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const list = this.listeners.get(key) ?? []
      const timer = setTimeout(() => {
        this.listeners.set(
          key,
          (this.listeners.get(key) ?? []).filter((fn) => fn !== handler),
        )
        reject(new HarnessError('等待 CDP 事件超时：' + key))
      }, timeoutMs)
      const handler = (params) => {
        clearTimeout(timer)
        this.listeners.set(
          key,
          (this.listeners.get(key) ?? []).filter((fn) => fn !== handler),
        )
        resolve(params)
      }
      list.push(handler)
      this.listeners.set(key, list)
    })
  }

  on(key, handler) {
    const list = this.listeners.get(key) ?? []
    list.push(handler)
    this.listeners.set(key, list)
  }
}

/**
 * 启动 headless 浏览器。
 * 返回 { profileDir, browserWsUrl, newPage, close }。
 */
export async function launchBrowser(options = {}) {
  const executable = resolveBrowserPath(options.executablePath)
  const profileDir = mkdtempSync(join(tmpdir(), 'threadline-cdp-'))
  const args = [
    options.headless === false ? '--headless=old' : '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-dev-shm-usage',
    '--disable-background-timer-throttling',
    '--user-data-dir=' + profileDir,
    '--remote-debugging-port=0',
    '--window-size=' + (options.width ?? 1440) + ',' + (options.height ?? 900),
    'about:blank',
  ]
  const child = spawn(executable, args, { stdio: ['ignore', 'pipe', 'pipe'] })
  const chunks = []
  let stderrBuffer = ''
  child.stderr.on('data', (chunk) => {
    stderrBuffer += chunk.toString()
    chunks.push(chunk)
  })

  const browserWsUrl = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill()
      reject(new HarnessError('等不到 DevTools listening 行；浏览器 stderr：' + stderrBuffer.slice(0, 2000)))
    }, options.launchTimeoutMs ?? 30000)
    child.stderr.on('data', () => {
      const match = /DevTools listening on (ws:\/\/\S+)/.exec(stderrBuffer)
      if (match) {
        clearTimeout(timer)
        resolve(match[1])
      }
    })
    child.on('exit', (code) => {
      clearTimeout(timer)
      reject(new HarnessError('浏览器提前退出，code=' + code + '；stderr：' + stderrBuffer.slice(0, 2000)))
    })
  })

  const socket = new WebSocket(browserWsUrl)
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new HarnessError('连不上浏览器 WebSocket：' + browserWsUrl)), 15000)
    socket.addEventListener('open', () => {
      clearTimeout(timer)
      resolve()
    })
    socket.addEventListener('error', () => {
      clearTimeout(timer)
      reject(new HarnessError('浏览器 WebSocket 出错：' + browserWsUrl))
    })
  })
  const cdp = new CdpConnection(socket)

  async function newPage() {
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' })
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true })
    await cdp.send('Page.enable', {}, sessionId)
    await cdp.send('Runtime.enable', {}, sessionId)
    return createPage(cdp, sessionId, targetId)
  }

  async function close() {
    try {
      await cdp.send('Browser.close')
    } catch {
      // 已经关了就算了
    }
    try {
      socket.close()
    } catch {
      // ignore
    }
    await new Promise((resolve) => {
      if (child.exitCode !== null) return resolve()
      const timer = setTimeout(() => {
        child.kill()
        resolve()
      }, 5000)
      child.on('exit', () => {
        clearTimeout(timer)
        resolve()
      })
    })
    try {
      rmSync(profileDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 })
    } catch (error) {
      // 删不掉不是失败理由，但要说出来（profile 在 %TEMP% 里，不在工作区）。
      console.warn('harness: profile 目录暂时无法删除（%TEMP% 内，无碍）：' + profileDir + ' — ' + error.message)
    }
  }

  return { executable, profileDir, browserWsUrl, newPage, close }
}

function createPage(cdp, sessionId, targetId) {
  const send = (method, params) => cdp.send(method, params, sessionId)
  const consoleMessages = []
  const pageErrors = []

  cdp.on(sessionId + '|Runtime.consoleAPICalled', (params) => {
    const text = (params.args ?? [])
      .map((arg) => (arg.value !== undefined ? String(arg.value) : arg.description ?? arg.type))
      .join(' ')
    consoleMessages.push({ type: params.type, text })
  })
  cdp.on(sessionId + '|Runtime.exceptionThrown', (params) => {
    const details = params.exceptionDetails ?? {}
    pageErrors.push(details.exception?.description ?? details.text ?? 'unknown exception')
  })

  return {
    sessionId,
    targetId,
    consoleMessages,
    pageErrors,
    send,
    async setViewport(viewport) {
      await send('Emulation.setDeviceMetricsOverride', {
        width: viewport.width,
        height: viewport.height,
        deviceScaleFactor: viewport.deviceScaleFactor ?? 1,
        mobile: viewport.mobile ?? false,
        screenWidth: viewport.width,
        screenHeight: viewport.height,
      })
    },
    async emulateMedia(features) {
      await send('Emulation.setEmulatedMedia', {
        features: features.map((feature) => ({ name: feature.name, value: feature.value })),
      })
    },
    async navigate(url) {
      const loaded = cdp.once(sessionId + '|Page.loadEventFired', 30000)
      const result = await send('Page.navigate', { url })
      if (result.errorText) throw new HarnessError('导航失败：' + result.errorText + ' → ' + url)
      await loaded
    },
    /** 在页面里求值；返回 JSON 可序列化的值。 */
    async evaluate(expression, options = {}) {
      const result = await send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: options.awaitPromise === true,
        userGesture: false,
      })
      if (result.exceptionDetails) {
        const details = result.exceptionDetails
        throw new HarnessError(
          '页面内求值抛错：' + (details.exception?.description ?? details.text) + '\n表达式：' + expression.slice(0, 400),
        )
      }
      return result.result?.value
    },
    async screenshot() {
      const shot = await send('Page.captureScreenshot', {
        format: 'png',
        fromSurface: true,
        captureBeyondViewport: false,
      })
      return Buffer.from(shot.data, 'base64')
    },
    async close() {
      try {
        await cdp.send('Target.closeTarget', { targetId })
      } catch {
        // target 可能已关闭
      }
    },
  }
}
