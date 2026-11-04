/*
 * ui/modal/store.ts —— `/threadline` 弹窗的**打开状态**（按会话，内存、不持久化）。
 *
 * 为什么用 store 而不是 React state：命令入口（inputTriggers）和弹窗入口（conversation.input.overlay）
 * 是两棵互不相邻的 React 树，只能靠一个最小 store 通信（与 dsh-context 的做法一致）。
 * 纪律：不写任何存储；关闭即清空；会话之间互不影响。
 */
import * as React from 'react'

/** 一个会话的弹窗状态（对象身份稳定，供 useSyncExternalStore 用）。 */
export interface ModalState {
  sessionId: string
  open: boolean
  /** 打开时想聚焦的文件（可选；来自命令 / 入口传入）。 */
  focusFile: string | null
}

const EMPTY: ModalState = { sessionId: '', open: false, focusFile: null }

const states = new Map<string, ModalState>()
const listeners = new Map<string, Set<() => void>>()

function emit(sessionId: string): void {
  const set = listeners.get(sessionId)
  if (set === undefined) return
  for (const listener of Array.from(set)) {
    try {
      listener()
    } catch {
      // 订阅方异常不影响其它订阅者
    }
  }
}

/** 当前状态（无记录时返回稳定的 EMPTY，避免每次新对象导致重渲染循环）。 */
export function getModalState(sessionId: string): ModalState {
  return states.get(sessionId) ?? EMPTY
}

/** 打开弹窗（同一会话重复打开是幂等的；可带一个聚焦文件）。 */
export function openModal(sessionId: string, focusFile: string | null = null): void {
  if (typeof sessionId !== 'string' || sessionId === '') return
  const current = states.get(sessionId)
  if (current !== undefined && current.open === true && current.focusFile === focusFile) return
  states.set(sessionId, { sessionId, open: true, focusFile })
  emit(sessionId)
}

/** 关闭弹窗（关闭后清除记录，回到稳定 EMPTY）。 */
export function closeModal(sessionId: string): void {
  if (!states.has(sessionId)) return
  states.set(sessionId, { sessionId, open: false, focusFile: null })
  emit(sessionId)
}

/** 订阅某个会话的弹窗状态；返回取消订阅函数。 */
export function subscribeModal(sessionId: string, listener: () => void): () => void {
  let set = listeners.get(sessionId)
  if (set === undefined) {
    set = new Set()
    listeners.set(sessionId, set)
  }
  set.add(listener)
  return () => {
    set?.delete(listener)
    if (set !== undefined && set.size === 0) listeners.delete(sessionId)
  }
}

/** 清空全部（卸载时调用；跨会话不残留）。 */
export function resetModalStore(): void {
  const ids = Array.from(states.keys())
  states.clear()
  for (const id of ids) emit(id)
}

/** 当前打开的会话数（测试/诊断用）。 */
export function openModalCount(): number {
  let count = 0
  for (const state of states.values()) if (state.open) count += 1
  return count
}

/** React 订阅入口：`useSyncExternalStore`（服务端渲染快照用同一个函数）。 */
export function useModalState(sessionId: string): ModalState {
  return React.useSyncExternalStore(
    React.useCallback((listener: () => void) => subscribeModal(sessionId, listener), [sessionId]),
    React.useCallback(() => getModalState(sessionId), [sessionId]),
    React.useCallback(() => getModalState(sessionId), [sessionId]),
  )
}
