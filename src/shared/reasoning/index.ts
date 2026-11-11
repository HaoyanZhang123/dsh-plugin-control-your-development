/*
 * shared/reasoning/ —— 思维链统计的**唯一事实源**（D-35）。
 *
 * 数据边界（用户已确认的口径）：
 * - `reasoningTokens` 只在 provider 上报时才是精确值；**缺失显示未知，绝不按 0**。
 * - `占总 token` = reasoningTokens / totalTokens（同一组 usage 内部比较，不跨组相加）。
 * - `字符占比` = 思维链字符 /（思维链字符 + 助手回复字符），与 token 不互相换算。
 * - 语言与句式归类是启发式；调用方必须能把它标成「启发式」，不得说成模型内部分类。
 *
 * 本目录只放纯函数与类型：不 import React、不碰 DOM、不读写存储，可被 node:test 直接调用。
 */
export * from './types.ts'
export * from './sentences.ts'
export * from './aggregate.ts'
