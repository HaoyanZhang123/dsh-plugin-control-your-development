/**
 * workspaceFiles 只读适配层的类型（02 §3.6、evidence/01 K4、04 §6.3.4）。
 *
 * 这里**不 import 宿主包、不 import 任何 fs**：`stat` / `read` 以注入方式传进来，
 * 单测用内存假实现即可。服务端**不做工作区包含检查**（K4），所以 cwd 卡口在本层。
 */

/** `remote.workspaceFiles.stat` 的返回形状（T01 实测）。 */
export interface WorkspaceFileStat {
  absolutePath: string
  version: string
  bytes?: number
}

/** `remote.workspaceFiles.read` 的返回形状：stat + 分页正文。 */
export interface WorkspaceFileText extends WorkspaceFileStat {
  offset: number
  text: string
  lines: number
  eof: boolean
}

export interface WorkspaceReadRange {
  offset?: number
  limit?: number
}

/**
 * 目录条目类型（`remote.workspaceFiles.list` 的 wire 形状；notes/21 §c.1）。
 * `other` = 符号链接/socket/设备等非普通文件非目录（**不可进入**）。
 */
export type WorkspaceEntryType = 'file' | 'directory' | 'other'

/** 一个目录条目（wire 形状，未经归一化/排序；不含路径，只有名字）。 */
export interface WorkspaceDirectoryEntry {
  readonly name: string
  readonly type: WorkspaceEntryType
  /** 只有普通文件可能带；目录/other 不保证有。 */
  readonly size?: number
}

/** 一次目录列表（wire 形状）。`path` 是**工作区相对路径**，空串 = 根。 */
export interface WorkspaceDirectoryListing {
  readonly path: string
  readonly entries: readonly WorkspaceDirectoryEntry[]
  readonly truncated: boolean
}

/**
 * workspaceFiles 只读通道（只声明本插件用到的方法；README 明示无 mutation 操作）。
 * 单测注入假实现，运行期注入 `remote.workspaceFiles`。
 *
 * `list`：真机能力可能缺失（R00 探针；02 §G/§K1），所以**声明为可选**：
 * 缺失时目录树走 B1 host 只读 fallback（`src/host/tree.ts`），而不是假装空目录。
 * `list.path` 是工作区相对路径（空串 = 根），**与 stat/read 的路径词汇不同**（notes/21 §c.1）。
 */
export interface WorkspaceFilesFace {
  stat(sessionId: string, path: string, signal?: AbortSignal): Promise<WorkspaceFileStat>
  read(
    sessionId: string,
    path: string,
    range?: WorkspaceReadRange,
    signal?: AbortSignal,
  ): Promise<WorkspaceFileText>
  list?(sessionId: string, path: string, signal?: AbortSignal): Promise<WorkspaceDirectoryListing>
}

/** 路径被本层拒绝的原因（N-07：绝对路径、`..` 穿越、工作区外）。 */
export type PathRejectionReason = 'absolute-path' | 'escape-cwd' | 'empty-path' | 'outside-cwd'

/** 读取状态；`ok` 才可能有正文。 */
export type FileReadState =
  | 'ok'
  | 'missing'
  | 'not-text'
  | 'too-large'
  | 'invalid-utf8'
  | 'unreadable'
  | 'rejected'
  | 'unsupported'

/** 读取/打开失败：状态必须显式，不许当成“空文件”（10 §1 未确认/读取失败）。 */
export interface FileReadFailure {
  status: 'failed'
  state: Exclude<FileReadState, 'ok'>
  reason: string
  /** 校验通过后的工作区相对路径（被拒时可能缺省）。 */
  path?: string
  absolutePath?: string
  version?: string
  bytes?: number
}

export interface FileReadSuccess {
  status: 'ok'
  path: string
  absolutePath: string
  version: string
  bytes?: number
  text: string
  lines: number
  /** 是否因行数/页数上限被截断（N-10：必须显式）。 */
  truncated: boolean
  pages: number
}

export type FileReadResult = FileReadSuccess | FileReadFailure

export type StatResult =
  | { status: 'ok'; path: string; absolutePath: string; version: string; bytes?: number }
  | FileReadFailure

/** 读取上限（04 §6.3.1 / §6.3.4）。 */
export interface WorkspaceFileLimits {
  maxBytes: number
  maxLines: number
  pageLines: number
  pagesPerFile: number
}

export const DEFAULT_WORKSPACE_FILE_LIMITS: WorkspaceFileLimits = {
  maxBytes: 512 * 1024,
  maxLines: 5000,
  pageLines: 500,
  pagesPerFile: 20,
}
