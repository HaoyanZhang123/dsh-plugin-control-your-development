/**
 * 客户端半区 —— 三个入口的总装配（T09 接管；03 §2 / 04 §7.4 / 06 A43-1..5）。
 *
 * 这里只做"接线"，不实现界面：
 * 1. `installStyles()`（唯一样式注入路径，卸载移除）；
 * 2. 三个入口的注册（`conversation.view` / `conversation.chat.assistant-actions` /
 *    `inputTriggers` + `conversation.input.overlay`），**每个注册都收进 `ctx.effect`**；
 * 3. 卸载清理：详情缓存、弹窗状态、跨入口 focus 桥。
 *
 * 边界（T02 的构建契约仍然成立）：
 * - 只 `import * as React from 'react'`（构建里 React 是 external，不打包进来）；
 * - slot 缺失 / 服务缺失只 `logger.warn`，**不崩**（入口缺失由验收发现，06 N-19）；
 * - 不 append 到 `document.body`、不替换 app 根、不写任何存储、无外部网络（只有同源 /api/dsh-threadline/*）；
 * - 不注册右栏 / main / sidebar.panellist（用户只允许三个入口）。
 */
import * as React from 'react'
import { VERSION } from '../shared/version.ts'
import { installStyles, removeStyles } from './styles/index.ts'
import { registerCommand } from './entries/command.ts'
import { info, optionalMethod, warn, type ClientContextLike } from './entries/context.ts'
import { registerImpact } from './entries/impact.ts'
import { registerTab } from './entries/tab.ts'
import { disposeDetailStore } from './state/detailStore.ts'
import { disposeAllWarmups } from './data/index.ts'
import { clearFocus } from './state/viewFocus.ts'
import { resetPrivacyMode } from './state/privacyStore.ts'
import { resetPerf } from './state/perf.ts'
import { resetModalStore } from './ui/modal/store.ts'

/** 客户端模块 id。必须等于 package.json 的 name 与 cordis.patch.yml 的行 id。 */
export const name = 'dsh-plugin-control-your-development'

/** 依赖的客户端 Cordis 服务；缺 slots 时本模块不激活，也不会崩。 */
export const inject = ['slots']

/** 客户端上下文（结构类型；不 import 宿主包）。 */
export type ClientContext = ClientContextLike

/** 只读"打开文件"动作：从宿主服务里取（取不到就不提供按钮动作，绝不自己开窗）。 */
function resolveOpenPath(ctx: ClientContext): ((path: string) => void) | undefined {
  const openResource = optionalMethod<(resource: { path: string }) => unknown>(ctx, 'sidebarRight', 'openResource')
  if (openResource !== undefined) {
    return (path) => {
      try {
        openResource({ path })
      } catch {
        // 宿主 API 抛错不影响我们（按钮动作是尽力而为）
      }
    }
  }
  const direct = optionalMethod<(path: string) => unknown>(ctx, 'workspaceFiles', 'openPath')
  if (direct !== undefined) {
    return (path) => {
      try {
        direct(path)
      } catch {
        // 同上
      }
    }
  }
  return undefined
}

/** 注入样式（document 不存在时跳过：SSR / 单测环境）。 */
function installStyleSheet(ctx: ClientContext): void {
  if (typeof document === 'undefined') return
  const run = (): (() => void) => {
    try {
      const remove = installStyles(document)
      return () => {
        try {
          remove()
        } finally {
          removeStyles(document)
        }
      }
    } catch (error) {
      warn(ctx, '样式注入失败：' + (error instanceof Error ? error.message : String(error)))
      return () => undefined
    }
  }
  if (typeof ctx.effect === 'function') ctx.effect(() => run(), 'threadline: styles')
  else run()
}

/**
 * 客户端入口：装配三个入口 + 样式；全部注册用 `ctx.effect` 管，卸载时撤销。
 */
export function apply(ctx: ClientContext): void {
  installStyleSheet(ctx)

  // 引用层能力探测：`remote.workspaceFiles`（T01 K4）。
  //
  // 2026-11-04 真机实测（缺陷根因）：ownerProps 上的 `remote` 是 **Cordis Context 代理**，
  // 直接读 `remote.workspaceFiles` 会抛
  //   cannot get property "remote.workspaceFiles" without inject
  // → 异常从 tab 的 useMemo 冒出 → 整页白屏。正确姿势是**声明 inject 后取服务**：
  //   ctx.inject(['remote', 'remote.workspaceFiles'], scope => scope.get('remote.workspaceFiles'))
  // 这里拿到的是**服务对象本身**（不是代理），再包成稳定身份的门面对象交给 tab，
  // probe 读的是普通对象属性，永不抛错；拿不到就保持 undefined → 引用层显式 disabled。
  const remoteFacade: { workspaceFiles?: unknown } = {}
  const initialRemote = optionalMethod<unknown>(ctx, 'remote', 'workspaceFiles')
  if (initialRemote !== undefined) {
    // 已经就绪（服务先挂载）：直接取服务对象
    try {
      const resolved = ctx.get<unknown>('remote.workspaceFiles')
      if (resolved !== undefined) remoteFacade.workspaceFiles = resolved
    } catch {
      // 未声明 inject 时会抛；交给下面的 inject 分支
    }
  }
  if (typeof ctx.inject === 'function' && remoteFacade.workspaceFiles === undefined) {
    try {
      ctx.inject(['remote', 'remote.workspaceFiles'], (scope) => {
        const resolved = (scope ?? ctx) as ClientContext
        try {
          const face = resolved.get<unknown>('remote.workspaceFiles')
          if (face !== undefined) remoteFacade.workspaceFiles = face
        } catch {
          // 服务缺失：引用层 disabled（不伪装 0 条）
        }
      })
    } catch {
      // 同上
    }
  }

  const openPath = resolveOpenPath(ctx)
  const tab = registerTab(ctx, {
    ...(openPath === undefined ? {} : { openPath }),
    getRemote: () => (remoteFacade.workspaceFiles === undefined ? undefined : remoteFacade),
  })
  const impact = registerImpact(ctx)
  const command = registerCommand(ctx)

  if (!tab && !impact && !command) {
    warn(ctx, '三个入口都没注册成功（slots 不可用？）— tab / 影响 N / 命令入口将不可见')
  } else if (!tab || !impact || !command) {
    warn(ctx, '部分入口注册失败：tab=' + String(tab) + ' impact=' + String(impact) + ' command=' + String(command))
  }

  // 卸载清理：三份内存态（详情缓存 / 弹窗开关 / 跨入口 focus），都不持久化
  if (typeof ctx.effect === 'function') {
    ctx.effect(
      () => () => {
        disposeAllWarmups()
        disposeDetailStore()
        resetModalStore()
        clearFocus()
        resetPrivacyMode()
        resetPerf()
      },
      'threadline: state cleanup',
    )
  }

  info(ctx, 'client loaded (v' + VERSION + ')')
}

/**
 * 最小占位组件（兼容旧调用方 / 构建自检）：真正的界面在三个入口里。
 * 保留它是因为 build.mjs 与宿主都只认 `apply`，删掉不影响功能，但留一个可渲染的导出便于排障。
 */
export function ThreadlinePlaceholder(): React.ReactElement {
  return React.createElement('div', { className: 'threadline-app', 'data-version': VERSION }, 'threadline')
}
