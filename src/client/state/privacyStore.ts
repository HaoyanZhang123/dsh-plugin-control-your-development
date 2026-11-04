/*
 * state/privacyStore.ts —— 隐私模式的**跨入口内存状态**（03 §12.2；T10 提供机制，T09 接线）。
 *
 * 为什么需要 store：三个入口是三棵互不相邻的 React 树，`PrivacyProvider` 的 context 不共享；
 * 用一个模块级 store 提供 `mode`，每个入口再包 `<PrivacyProvider mode={mode} onChange={setMode}>`，
 * 这样"tab header 里的隐私开关"能同时影响影响弹层与 `/threadline` 弹窗。
 *
 * 纪律：**不持久化**（不碰 localStorage / sessionStorage / cookie / URL / document.title），
 * 页面生命周期内有效；卸载时由入口调用 `resetPrivacy()`。
 */
import * as React from 'react'
import { DEFAULT_PRIVACY_MODE, type PrivacyMode } from '../privacy/index.ts'

let mode: PrivacyMode = DEFAULT_PRIVACY_MODE
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of Array.from(listeners)) {
    try {
      listener()
    } catch {
      // 订阅方异常不影响其它订阅者
    }
  }
}

/** 读当前模式。 */
export function getPrivacyMode(): PrivacyMode {
  return mode
}

/** 设置模式（幂等；同值不广播）。 */
export function setPrivacyMode(next: PrivacyMode): void {
  if (next !== 'metadata' && next !== 'hidden') return
  if (next === mode) return
  mode = next
  emit()
}

/** 切换（tab header 的「隐私」菜单用）。 */
export function togglePrivacyMode(): void {
  setPrivacyMode(mode === 'hidden' ? DEFAULT_PRIVACY_MODE : 'hidden')
}

/** 订阅（Provider 的受控 onChange 与测试用）。 */
export function subscribePrivacyMode(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** 卸载时复位（不残留状态到下一次挂载）。 */
export function resetPrivacyMode(): void {
  if (mode === DEFAULT_PRIVACY_MODE) return
  mode = DEFAULT_PRIVACY_MODE
  emit()
}

/** React 订阅入口：`useSyncExternalStore`。 */
export function usePrivacyMode(): PrivacyMode {
  return React.useSyncExternalStore(subscribePrivacyMode, getPrivacyMode, getPrivacyMode)
}
