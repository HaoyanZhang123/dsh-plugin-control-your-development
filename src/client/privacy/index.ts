/*
 * privacy/index.ts —— T10 隐私层的唯一出口。
 *
 * 下游（T09 入口 / 检查器 / 轮次带 / 列表视图）只 import 这里：
 *   import { PrivacyProvider, usePrivacy, maskPathFor, maskCommand, maskTitle, maskUrl, redactForLog } from '<plugin>/src/client/privacy/index.ts'
 *
 * 单一实现：
 * - 字符串掩码原语在 `ui/turns/privacy.ts`（T08 交付，唯一实现），本层只做策略组合与再导出；
 * - 本目录新增的只有：mode 上下文、命令策略、日志脱敏、正文闸门。
 */
export {
  DEFAULT_PRIVACY_MODE,
  contentEntryVisible,
  isHidden,
  maskCommand,
  maskPathFor,
  maskPathOnce,
  maskPaths,
  maskTitle,
  maskUrl,
  redactBatch,
  redactForLog,
  sessionLabel,
  shouldRenderContent,
  urlHost,
  type LogRecord,
  type MaskedCommand,
  type PrivacyMode,
} from './masks.ts'

export {
  PrivacyContext,
  PrivacyProvider,
  createPrivacyApi,
  usePrivacy,
  usePrivacyMode,
  type PrivacyApi,
  type PrivacyProviderProps,
} from './provider.ts'
