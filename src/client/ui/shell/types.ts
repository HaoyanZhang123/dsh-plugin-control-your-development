/*
 * shell/types.ts —— 外壳的共享类型与常量（区域名、范围枚举、默认值）。
 *
 * 单一事实源：区域名只在这里定义一次，组件与 harness 的自检都引用它，
 * 避免"断言里写的区域名"和"DOM 里真实存在的区域名"各说一套。
 */
import type { MessageKey } from '../../locale/index.ts'

/** 时间范围筛选：值直接就是 locale key（03 §5 / §16）。 */
export type RangeKey = Extract<MessageKey, 'range.today' | 'range.7d' | 'range.30d' | 'range.all'>

/** 范围 chip 的顺序（与 03 §3.1 的 [今天|7天|30天|全部] 一致）。 */
export const RANGE_KEYS: readonly RangeKey[] = ['range.today', 'range.7d', 'range.30d', 'range.all']

/** 默认范围：全部（03 §5：默认范围=全部，播放头在现在）。 */
export const DEFAULT_RANGE: RangeKey = 'range.all'

/** 外壳区域名（DOM 上的 data-region 值，断言按它取元素）。 */
export const SHELL_REGIONS = {
  header: 'header',
  now: 'now',
  map: 'map',
  /** 检查器组件保留但无产品入口（33 §7 允许保留）；region 常量只服务该组件的 SSR 测试。 */
  inspector: 'inspector',
  timeline: 'timeline',
  turns: 'turns',
  rail: 'rail',
} as const

export type ShellRegion = (typeof SHELL_REGIONS)[keyof typeof SHELL_REGIONS]

/** 区域几何（与 tokens.css 的 --tl-* 变量对应；测试用来对账规范数值）。 */
export const SHELL_METRICS = {
  header: 56,
  now: 36,
  // 时间轴：48 → 104（2026-11-08 用户拍板改「双轨」：上轨活跃度柱 + 下轨会话分层）。
  // 104 % 8 === 0，8px 网格不破。
  timeline: 104,
  turns: 92,
  turnsCollapsed: 40,
  inspector: 340,
  inspectorWide: 360,
  mapMinHeight: 520,
} as const

/**
 * 容器查询断点（03 §14）。base.css 的 @container 必须与这里一一对应。
 *
 * `split`（1.5.1 新增）= 脉络 tab 双栏 ↔ 单列的分界：**小于它才降成单列**。
 * 原值是 1080，但宿主左侧栏展开时 tab 区域只有 ~820px，于是最常见的窗口形态下
 * 双栏被降成单列（用户看到的是「只有收起侧栏，卡片才在右边」）。760 让那个形态仍是双栏。
 */
export const BREAKPOINTS = {
  split: 760,
  wide: 1100,
  medium: 900,
  narrow: 600,
  minimum: 420,
} as const
