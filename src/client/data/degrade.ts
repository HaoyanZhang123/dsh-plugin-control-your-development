/**
 * T04 · 降级状态（04 §2.7 / §10、03 §11、06 A20-4 / N-03）。
 *
 * 目标：**不伪造**。当 host 不可用、能力缺失、数据只到一部分、或扫描失败时，
 * 给出显式状态 + T06 的 locale 文案 key，让 UI 显示“观测不到/读取失败/仍在补全”，
 * 而不是显示成“0 个文件、0 条边”的假完整图。
 *
 * 只使用 `src/client/locale/keys.ts` 里**已存在**的 key（03 §16 定稿），不发明新 key。
 * 缺 key 时用最近的既有 key 并记 `missingKeyHint`，由 owner 上报 Lead（本文件不写文案）。
 */

import type { MessageKey } from '../locale/keys.ts'
import type { ThreadlineErrorCode } from '../../shared/events/index.ts'
import type { Coverage } from './merge.ts'

/** 降级种类（与 04 §2.7 / 06 A20-4 的四种对应，另有 `none`）。 */
export type DegradeKind = 'none' | 'hostUnavailable' | 'capability-missing' | 'partial' | 'failed'

/** 显式降级状态：UI 只读它决定显示什么文案、是否可重试、能不能画空图。 */
export interface DegradeState {
  kind: DegradeKind
  /** 主文案 key；`none` 且健康时为 null（按需再用空态 key）。 */
  messageKey: MessageKey | null
  /** 重试按钮文案 key；不可重试为 null。 */
  retryKey: MessageKey | null
  severity: 'none' | 'info' | 'warning' | 'error'
  /** 是否可重试（只读，不自动无限重试）。 */
  retryable: boolean
  /** true ⇒ UI 不得把“没有数据”渲染成 0 / 空图，必须显示未知或错误。 */
  renderZeroForbidden: boolean
  /** 稳定原因（日志/测试用；不含路径/正文）。 */
  reason: string
  /** host 错误码（若有）。 */
  code?: ThreadlineErrorCode
  /** 失败会话数（来自覆盖率或 host 错误；未知则 undefined，不写 0）。 */
  failedSessions?: number
  /** 计划扫描的会话总数（未知则 undefined）。 */
  total?: number
  /** 已加载会话数（未知则 undefined）。 */
  loadedSessions?: number
  /** 文案 key 需求（缺 key 时给 Lead；正常为 undefined）。 */
  missingKeyHint?: string
}

const RETRY_KEY: MessageKey = 'coverage.retry'

/** 健康状态：可以用空态文案，不禁止 0。 */
export function degradeNone(): DegradeState {
  return {
    kind: 'none',
    messageKey: null,
    retryKey: null,
    severity: 'none',
    retryable: false,
    renderZeroForbidden: false,
    reason: 'healthy',
  }
}

/** 空工作区（N-01）：显式空态，允许“确实没有记录”。 */
export function degradeEmptyWorkspace(): DegradeState {
  return {
    kind: 'none',
    messageKey: 'state.emptyWorkspace',
    retryKey: null,
    severity: 'info',
    retryable: false,
    renderZeroForbidden: false,
    reason: 'empty-workspace',
  }
}

/** host 不可达（路由缺失 / 网络失败 / 响应不可解析）：显示“观测不到”。 */
export function degradeHostUnavailable(reason = 'host-unreachable'): DegradeState {
  return {
    kind: 'hostUnavailable',
    messageKey: 'state.hostUnavailable',
    retryKey: RETRY_KEY,
    severity: 'error',
    retryable: true,
    renderZeroForbidden: true,
    reason,
  }
}

/** 按 host 错误码映射（04 §2.7 的 UI 行为列）。 */
export function degradeForError(code: ThreadlineErrorCode, reason?: string): DegradeState {
  switch (code) {
    case 'threadline/capability-missing':
      // 04 §2.7：capability-missing → UI 显示 state.hostUnavailable。
      return {
        kind: 'capability-missing',
        messageKey: 'state.hostUnavailable',
        retryKey: RETRY_KEY,
        severity: 'error',
        retryable: true,
        renderZeroForbidden: true,
        reason: reason ?? 'capability-missing',
        code,
      }
    case 'threadline/scan-not-found':
      return {
        kind: 'failed',
        messageKey: 'state.unknown',
        retryKey: RETRY_KEY,
        severity: 'error',
        retryable: true,
        renderZeroForbidden: true,
        reason: reason ?? 'scan-not-found',
        code,
      }
    case 'threadline/session-unreadable':
    case 'threadline/format-unsupported':
      return {
        kind: 'partial',
        messageKey: 'coverage.failed',
        retryKey: null,
        severity: 'warning',
        retryable: false,
        renderZeroForbidden: true,
        reason: reason ?? code,
        code,
      }
    case 'threadline/limit-exceeded':
      return {
        kind: 'partial',
        messageKey: 'coverage.partial',
        retryKey: null,
        severity: 'warning',
        retryable: false,
        renderZeroForbidden: true,
        reason: reason ?? 'limit-exceeded',
        code,
      }
    case 'threadline/bad-request':
      return {
        kind: 'failed',
        messageKey: 'state.unknown',
        retryKey: null,
        severity: 'error',
        retryable: false,
        renderZeroForbidden: true,
        reason: reason ?? 'bad-request',
        code,
      }
    case 'threadline/internal':
      return {
        kind: 'failed',
        messageKey: 'state.unknown',
        retryKey: RETRY_KEY,
        severity: 'error',
        retryable: true,
        renderZeroForbidden: true,
        reason: reason ?? 'internal',
        code,
      }
  }
}

/**
 * 从覆盖率推导降级（A20-4 的 `partial`）。
 *
 * - `complete` 且无失败 → 健康；
 * - `complete` 但有失败会话 → `partial`（文案用 `coverage.failed`，失败数给 UI 展开列表）；
 * - `failed` → 失败态；
 * - 其它未完成阶段（有数据或已裁剪）→ `partial`，禁止渲染 0 图；
 * - `starting`/`scanning` 且还没有数据 → 健康（UI 用 loading 文案，不算降级）。
 */
export function degradeForCoverage(coverage: Coverage): DegradeState {
  const base = {
    failedSessions: coverage.failed,
    total: coverage.total,
    loadedSessions: coverage.loadedSessions,
  }
  if (coverage.phase === 'failed') {
    return {
      kind: 'failed',
      messageKey: 'state.unknown',
      retryKey: RETRY_KEY,
      severity: 'error',
      retryable: true,
      renderZeroForbidden: true,
      reason: 'scan-failed',
      ...base,
    }
  }
  if (coverage.phase === 'complete') {
    if (coverage.failed > 0) {
      return {
        kind: 'partial',
        messageKey: 'coverage.failed',
        retryKey: null,
        severity: 'warning',
        retryable: false,
        renderZeroForbidden: coverage.loadedSessions === 0,
        reason: 'sessions-failed',
        ...base,
      }
    }
    return degradeNone()
  }
  if (coverage.truncated || coverage.phase === 'partial') {
    return {
      kind: 'partial',
      messageKey: 'coverage.partial',
      retryKey: null,
      severity: 'info',
      retryable: false,
      renderZeroForbidden: true,
      reason: coverage.truncated ? 'truncated' : 'partially-loaded',
      ...base,
    }
  }
  return degradeNone()
}

/** 两个降级状态合并（错误态优先于进度态；同级取 severity 高的）。 */
export function mergeDegrade(primary: DegradeState, secondary: DegradeState): DegradeState {
  if (primary.kind !== 'none') return primary
  return secondary
}

/** UI 便捷判断：是否处于“不得显示 0”的状态。 */
export function isZeroForbidden(state: DegradeState): boolean {
  return state.renderZeroForbidden === true
}

/** 是否需要显示重试入口。 */
export function canRetry(state: DegradeState): boolean {
  return state.retryable && state.retryKey !== null
}
