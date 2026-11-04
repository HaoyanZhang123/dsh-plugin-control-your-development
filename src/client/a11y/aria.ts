/*
 * a11y/aria.ts —— 读屏文案与 aria 属性的唯一实现（03 §15）。
 *
 * 三件事：
 * 1. `aria-label` 的生成（把 locale 拼成人能听懂的句子，不手写散落字符串）；
 * 2. `aria-describedby` 的 id 合并（去空、去重、稳定顺序）；
 * 3. `aria-live` 播报的**节流**（纯函数判定 + 一个受控的 Announcer 组件）。
 *
 * 纪律：本文件只产出"可读文字"，不产出正文内容（03 §12）；播报内容只放元数据。
 */
import * as React from 'react'
import type { MessageKey, Translator } from '../locale/index.ts'

/** 播报最小间隔（03 §15「aria-live 提示当前时间（节流）」）：默认 500ms。 */
export const ANNOUNCE_MIN_INTERVAL_MS = 500

/** 合并多个 id 成 aria-describedby 的值（去空、去重、保持顺序）。 */
export function joinIds(ids: ReadonlyArray<string | null | undefined>): string | undefined {
  const seen = new Set<string>()
  const parts: string[] = []
  for (const id of ids) {
    if (typeof id !== 'string') continue
    const trimmed = id.trim()
    if (trimmed === '' || seen.has(trimmed)) continue
    seen.add(trimmed)
    parts.push(trimmed)
  }
  return parts.length === 0 ? undefined : parts.join(' ')
}

/** 给元素挂描述：`describedByProps([tipId, hintId])` → `{ 'aria-describedby': 'a b' }`。 */
export function describedByProps(ids: ReadonlyArray<string | null | undefined>): { 'aria-describedby'?: string } {
  const value = joinIds(ids)
  return value === undefined ? {} : { 'aria-describedby': value }
}

/** 表头排序语义：当前排序列给 ascending/descending，其余 none。 */
export function sortAria(
  active: boolean,
  dir: 'asc' | 'desc',
): 'ascending' | 'descending' | 'none' {
  if (!active) return 'none'
  return dir === 'asc' ? 'ascending' : 'descending'
}

/** 表格可访问名（文件表 / 轮次表分别有名字，读屏能说清"这是什么表"）。 */
export function tableLabel(kind: 'files' | 'turns', t: Translator): string {
  return kind === 'files' ? t('inspector.listView') + ' · ' + t('inspector.file') : t('inspector.listView') + ' · ' + t('inspector.turn')
}

/** 行选择态的可访问名：`文件 read-model.ts，操作 18`（只元数据）。 */
export function rowAriaLabel(
  kind: 'files' | 'turns',
  label: string,
  detail: string | null,
  t: Translator,
): string {
  const head = kind === 'files' ? t('inspector.file') : t('inspector.turn')
  return detail === null || detail === '' ? head + ' ' + label : head + ' ' + label + '，' + detail
}

/** 播报文案：切换选中时读出来的一句（元数据，不含正文）。 */
export function announcementFor(kind: 'files' | 'turns' | 'selection', label: string, t: Translator): string {
  if (kind === 'selection') return label
  return (kind === 'files' ? t('inspector.file') : t('inspector.turn')) + ' ' + label
}

/**
 * 节流判定（纯函数）：距上次播报不足 `minIntervalMs` 就不再播。
 * `lastAt` 为 null（从未播过）时立即允许；时间倒退（clock skew）也允许。
 */
export function shouldAnnounce(
  lastAt: number | null,
  now: number,
  minIntervalMs: number = ANNOUNCE_MIN_INTERVAL_MS,
): boolean {
  if (!Number.isFinite(now)) return false
  if (lastAt === null || !Number.isFinite(lastAt)) return true
  if (now < lastAt) return true
  return now - lastAt >= Math.max(0, minIntervalMs)
}

/**
 * 节流状态机（纯函数，组件与测试共用）：
 * 给定上一次播报时间与本次请求，返回"这次要不要播 + 下一次的机会时间"。
 */
export interface AnnounceDecision {
  announce: boolean
  /** 播报后应记录的 lastAt（没播就沿用旧值）。 */
  lastAt: number | null
  /** 没播时，建议在多少毫秒后重试（组件用定时器补播）。 */
  retryInMs: number
}

export function decideAnnouncement(
  lastAt: number | null,
  now: number,
  minIntervalMs: number = ANNOUNCE_MIN_INTERVAL_MS,
): AnnounceDecision {
  if (shouldAnnounce(lastAt, now, minIntervalMs)) {
    return { announce: true, lastAt: now, retryInMs: 0 }
  }
  const elapsed = lastAt === null ? 0 : Math.max(0, now - lastAt)
  return { announce: false, lastAt, retryInMs: Math.max(0, minIntervalMs - elapsed) }
}

export interface AnnouncerProps {
  /** 待播报的文字；null 表示没有。 */
  message: string | null
  minIntervalMs?: number
  /** 读屏专用（视觉隐藏）；要可见时传 false。 */
  visuallyHidden?: boolean
  testId?: string
}

/**
 * `aria-live="polite"` 的播报器：同一时间窗内只播一次，被节流掉的消息会在窗口结束时补播。
 * 卸载时清掉定时器（不留下"还在响"的句柄）。
 */
export function Announcer(props: AnnouncerProps): React.ReactElement {
  const minInterval = props.minIntervalMs ?? ANNOUNCE_MIN_INTERVAL_MS
  const [spoken, setSpoken] = React.useState('')
  const lastAtRef = React.useRef<number | null>(null)
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingRef = React.useRef<string | null>(null)

  React.useEffect(() => {
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  React.useEffect(() => {
    const message = props.message
    if (message === null || message === '') return
    const now = typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now()
    const decision = decideAnnouncement(lastAtRef.current, now, minInterval)
    if (decision.announce) {
      lastAtRef.current = decision.lastAt
      pendingRef.current = null
      setSpoken(message)
      return
    }
    pendingRef.current = message
    if (timerRef.current !== null) return
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      const pending = pendingRef.current
      if (pending === null) return
      pendingRef.current = null
      const stamp = typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now()
      lastAtRef.current = stamp
      setSpoken(pending)
    }, Math.max(16, decision.retryInMs))
  }, [props.message, minInterval])

  const className = props.visuallyHidden === false ? 'threadline-live-region' : 'threadline-visually-hidden'
  return React.createElement(
    'div',
    {
      className: className,
      role: 'status',
      'aria-live': 'polite',
      'aria-atomic': 'true',
      'data-testid': props.testId,
    },
    spoken,
  )
}

/** 列头文字（表格列）：统一从 locale 取，避免不同组件各写一份列名。 */
export function columnLabel(key: MessageKey, t: Translator): string {
  return t(key)
}
