/*
 * turns/privacy.ts —— 隐私掩码与展示格式的**唯一实现**（03 §12；06 N-14）。
 *
 * 为什么在 turns 目录：本次写盘范围只有 `ui/turns/**` 与 `ui/inspector/**`，而这两个目录的
 * 组件必须共用同一套掩码/格式化规则（各写一份必然漂移）。`ui/turns/index.ts` 把它导出，
 * 检查器从那里 import —— 单一实现、单一事实源。
 *
 * 纪律：
 * - 隐私模式（`privacyMode: true`）：路径只留 basename；命令只留程序名；会话标题变 `会话 n`；
 *   外部 URL 只留域名；正文入口全部不渲染（判断放在调用方）。
 * - 不读不写任何存储；这里只有字符串处理，没有 DOM/React。
 */
import type { CommandRecord, ThreadlineStatus } from '../../../shared/events/index.ts'
import type { Translator } from '../../locale/index.ts'

/** 工作区相对 POSIX 路径的 basename（`src/a/b.ts` → `b.ts`；无目录时原样）。 */
export function baseName(path: string): string {
  const normalized = path.replaceAll('\\', '/')
  const index = normalized.lastIndexOf('/')
  return index < 0 ? normalized : normalized.slice(index + 1)
}

/** 工作区相对 POSIX 路径的目录（根目录返回 `/`）。 */
export function dirName(path: string): string {
  const normalized = path.replaceAll('\\', '/')
  const index = normalized.lastIndexOf('/')
  if (index < 0) return '/'
  if (index === 0) return '/'
  return normalized.slice(0, index)
}

/** 展示用路径：隐私模式下只留 basename（03 §12.2）。 */
export function maskPath(path: string, privacyMode: boolean): string {
  return privacyMode ? baseName(path) : path
}

/** 命令程序名（记录里取不到时 `?`，与 04 §3.5 一致）。 */
export function commandProgram(record: CommandRecord): string {
  const program = record.program
  if (program === undefined || program === '') return '?'
  return program
}

/** 命令摘要：隐私模式下返回 null（正文入口消失，只留程序名）。 */
export function commandSummary(record: CommandRecord, privacyMode: boolean): string | null {
  if (privacyMode) return null
  const text = record.text
  if (text === undefined || text === '') return null
  return text
}

/**
 * 把一段文本里的路径片段换成 basename（隐私模式用；关系证据文本是共享层生成的，
 * 里面带工作区相对路径，展示前必须掩码 —— 但不改共享层的单一事实源）。
 */
export function maskPathsInText(text: string): string {
  return text.replace(/(?:[^\s，。：；、（）()「」"']*\/)+[^\s，。：；、（）()「」"']+/g, (match) => baseName(match))
}

/** 外部来源 URL 的域名（解析失败时原样返回，不猜）。 */
export function urlHost(raw: string): string {
  try {
    const parsed = new URL(raw)
    return parsed.hostname === '' ? raw : parsed.hostname
  } catch {
    return raw
  }
}

/** 外部来源展示：隐私模式只显示域名（03 §12.2），否则显示完整 URL（只读展示）。 */
export function externalLabel(raw: string, privacyMode: boolean): string {
  return privacyMode ? urlHost(raw) : raw
}

/** 会话短 id（与关系证据同一口径：前 8 位）。 */
export function shortSessionId(sessionId: string): string {
  return sessionId.length <= 8 ? sessionId : sessionId.slice(0, 8)
}

/** 会话展示名：隐私模式按**当前视图顺序**编号为 `会话 n`（03 §12.2）。 */
export function sessionTitle(
  input: { sessionId: string; title?: string },
  index: number,
  privacyMode: boolean,
  t: Translator,
): string {
  if (privacyMode) return t('inspector.session') + ' ' + String(index + 1)
  const title = input.title
  if (title !== undefined && title !== '') return title
  return shortSessionId(input.sessionId)
}

/** 本地时间 `HH:MM`（时间戳不可知时 `—`；纯展示，不参与判定）。 */
export function timeOfDay(timestamp: number | null | undefined): string {
  if (timestamp === null || timestamp === undefined || !Number.isFinite(timestamp) || timestamp <= 0) return '—'
  const date = new Date(timestamp)
  const pad = (value: number): string => (value < 10 ? '0' + String(value) : String(value))
  return pad(date.getHours()) + ':' + pad(date.getMinutes())
}

/** 本地日期 + 时间 `MM-DD HH:MM`（跨天的触碰历史用；不可知时 `—`）。 */
export function dateTimeOfDay(timestamp: number | null | undefined): string {
  if (timestamp === null || timestamp === undefined || !Number.isFinite(timestamp) || timestamp <= 0) return '—'
  const date = new Date(timestamp)
  const pad = (value: number): string => (value < 10 ? '0' + String(value) : String(value))
  return pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes())
}

/**
 * 会话/子智能体状态 key（只认记录，不推断）。
 * `completed` 用 `turns.completed`（03 §16 扩展段）——那个"完成"只在记录明确给出完成时为真；
 * 其余状态走 session.running / session.aborted / session.unknown。
 */
export function sessionStatusKey(
  status: ThreadlineStatus,
): 'turns.completed' | 'session.running' | 'session.aborted' | 'session.unknown' {
  if (status === 'completed') return 'turns.completed'
  if (status === 'running') return 'session.running'
  if (status === 'aborted') return 'session.aborted'
  return 'session.unknown'
}
