/*
 * privacy/provider.ts —— 隐私模式的唯一状态源（03 §12.2；06 A44-1）。
 *
 * 契约：
 * - 默认 `metadata`；不持久化（不碰 localStorage / sessionStorage / cookie / URL / document.title）；
 * - 隐私开关放在 tab header 的「隐私」菜单里（03 §12.2），状态只在同一 DSH 页面生命周期内有效；
 * - 受控/非受控二选一：传 `mode` 就是受控（T09 用 store 驱动），不传就自己持有内部状态；
 * - 没有 Provider 时 `usePrivacy()` 返回默认元数据 + 空操作 setter —— 组件不会因为忘记包 Provider 而崩。
 */
import * as React from 'react'
import { DEFAULT_PRIVACY_MODE, isHidden, type PrivacyMode } from './masks.ts'

/** 组件拿到的隐私 API。 */
export interface PrivacyApi {
  mode: PrivacyMode
  /** 是否隐私模式（`mode === 'hidden'`）。 */
  hidden: boolean
  setMode: (mode: PrivacyMode) => void
  toggle: () => void
}

const NOOP: PrivacyApi = {
  mode: DEFAULT_PRIVACY_MODE,
  hidden: false,
  setMode: () => undefined,
  toggle: () => undefined,
}

/** 供测试断言"上下文确实存在"（不导出内部对象给业务用）。 */
export const PrivacyContext: React.Context<PrivacyApi | null> = React.createContext<PrivacyApi | null>(null)

export interface PrivacyProviderProps {
  /** 受控模式；不传则用 defaultMode 初始化内部状态。 */
  mode?: PrivacyMode
  defaultMode?: PrivacyMode
  /** 模式变化回调（受控/非受控都会调）。 */
  onChange?: (mode: PrivacyMode) => void
  children?: React.ReactNode
}

export function createPrivacyApi(
  mode: PrivacyMode,
  onSet?: (mode: PrivacyMode) => void,
): PrivacyApi {
  return {
    mode,
    hidden: isHidden(mode),
    setMode: (next: PrivacyMode) => {
      if (next !== mode) onSet?.(next)
      else onSet?.(next)
    },
    toggle: () => onSet?.(isHidden(mode) ? DEFAULT_PRIVACY_MODE : 'hidden'),
  }
}

export function PrivacyProvider(props: PrivacyProviderProps): React.ReactElement {
  const [internal, setInternal] = React.useState<PrivacyMode>(props.defaultMode ?? DEFAULT_PRIVACY_MODE)
  const mode = props.mode ?? internal

  const api = React.useMemo<PrivacyApi>(() => {
    const setMode = (next: PrivacyMode): void => {
      if (props.mode === undefined) setInternal(next)
      props.onChange?.(next)
    }
    return {
      mode,
      hidden: isHidden(mode),
      setMode,
      toggle: () => setMode(isHidden(mode) ? DEFAULT_PRIVACY_MODE : 'hidden'),
    }
  }, [mode, props.mode, props.onChange])

  return React.createElement(PrivacyContext.Provider, { value: api }, props.children)
}

/** 读取隐私 API；没有 Provider 时给安全的默认值。 */
export function usePrivacy(): PrivacyApi {
  return React.useContext(PrivacyContext) ?? NOOP
}

/** 仅取模式（组件只需要 mode 时用，避免拿到 setter 后到处改状态）。 */
export function usePrivacyMode(): PrivacyMode {
  return usePrivacy().mode
}
