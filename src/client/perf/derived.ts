/*
 * perf/derived.ts —— 「无感加载」的两件基础设施：同输入复用 + 按端点索引的快速算法（R06）。
 *
 * 为什么放在 perf 层：它们是**纯函数 / 纯工具**，不依赖 React 与 UI，
 * 既可以被 tab 的 `React.useMemo` 体直接调用，也能在 node --test 里按真实规模量。
 *
 * 两件事各自解决一个实测问题（R06 数字见 `output/_verify/threadline/T50/R06/`）：
 *
 * 1. **`createInputMemo`：跨挂载复用派生量**。
 *    tab 组件重挂载（切走再切回）时所有 `useMemo` 都会从头算一遍；但输入其实没变
 *    （`data.graph` 与各 `SessionDetail` 都是同一批对象引用 —— 预热是模块级单例，
 *    detail store 也在页面级共享）。这个 memo 用**入参身份**做单槽缓存，命中就直接返回上次结果。
 *    安全性：单槽 + 逐个 `Object.is` 比较，**任何入参换引用就必然重算**，
 *    所以不存在"缓存陈旧"的可能（不是按时间/按 key 的缓存，没有失效键要维护）。
 *
 * 2. **`buildEdgeEndpointIndex` + `turnRelationCounts` + `filterEdgesWithin`：把 O(轮次×边) 换成 O(轮次×度数)**。
 *    旧实现（tab.ts R00 前）对每条边×每一轮做两次 `toLowerCase`（30 轮 × 64,836 边 = 5.8s）；
 *    R00 之后是预索引小写端点，但内层仍是 **逐轮遍历全部边**（900 轮 × 64,836 = 5,800 万次 Set 查找）。
 *    这里改成**按 from 端点建邻接表**，每轮只遍历本轮文件（12 个）的出边：
 *    900 × 12 × 平均度数 ≈ 十几万次，且结果**逐 key 等价**（`countTurnRelations` 的等价性有单测）。
 *
 * 纪律：不引第三方、不读文件、不写存储、不含任何路径/正文（只有索引与计数）。
 */

/* ------------------------------------------------------------------ *
 * 1. 同输入复用（跨 React 重挂载有效）
 * ------------------------------------------------------------------ */

/** 单槽、按入参身份复用的 memo（`inputs` 逐项 `Object.is` 比较）。 */
export interface InputMemo<T> {
  /** 入参全部与上次相同 → 返回上次结果（不调用 compute）；否则调用 compute 并记住。 */
  (inputs: readonly unknown[], compute: () => T): T
  /** 丢弃缓存（测试/切工作区用；正常路径不需要）。 */
  clear(): void
  readonly hits: number
  readonly misses: number
}

function sameInputs(left: readonly unknown[], right: readonly unknown[]): boolean {
  if (left.length !== right.length) return false
  for (let index = 0; index < left.length; index += 1) {
    if (!Object.is(left[index], right[index])) return false
  }
  return true
}

/**
 * 建一个同输入 memo。
 *
 * 典型用法（tab 顶层，**模块作用域**才能跨挂载复用）：
 * ```ts
 * const edgesMemo = createInputMemo<GraphEdge[]>()
 * // 组件内：
 * const edges = edgesMemo([data.graph, details, effective, reference], () => { ...原 memo 体... })
 * ```
 * 注意：`details` 是每帧新建的 Map 时**不会命中** —— 要传它的稳定来源
 * （`currentDetail` / `activeEntry.detail` / `extraDetails` 这些引用）。
 */
export function createInputMemo<T>(): InputMemo<T> {
  let lastInputs: readonly unknown[] | null = null
  let lastValue: T
  let hits = 0
  let misses = 0
  const memo = ((inputs: readonly unknown[], compute: () => T): T => {
    if (lastInputs !== null && sameInputs(lastInputs, inputs)) {
      hits += 1
      return lastValue
    }
    misses += 1
    const value = compute()
    lastInputs = inputs.slice()
    lastValue = value
    return value
  }) as InputMemo<T>
  memo.clear = (): void => {
    lastInputs = null
    lastValue = undefined as unknown as T
  }
  Object.defineProperty(memo, 'hits', { get: () => hits, enumerable: true })
  Object.defineProperty(memo, 'misses', { get: () => misses, enumerable: true })
  return memo
}

/* ------------------------------------------------------------------ *
 * 2. 边端点索引（一次 O(E)，之后按文件集反查）
 * ------------------------------------------------------------------ */

/** 一条边的小写端点（与原边同序）。 */
export interface LowerEdge {
  from: string
  to: string
}

/** `byFrom` 的一项：小写目标端点 + 原边下标（保序用）。 */
export interface EdgeEndpoint {
  to: string
  at: number
}

/** 边端点索引。`lower` 可直接替代「逐边 toLowerCase」的旧数组。 */
export interface EdgeEndpointIndex {
  /** 小写端点（与输入同序，长度 = size）。 */
  readonly lower: readonly LowerEdge[]
  /** from(小写) → 以它为起点的边（`at` 是输入下标）。 */
  readonly byFrom: ReadonlyMap<string, readonly EdgeEndpoint[]>
  readonly size: number
}

/**
 * 建端点索引（单趟、零额外遍历）。
 *
 * 一条边只挂在它的 `from` 下（不双向挂），所以「两端都在集合内」的边恰好被数到一次，
 * 与旧的 `edges.filter(两端都在集合)` 语义**逐条等价**（含自环与重复端点对）。
 */
export function buildEdgeEndpointIndex(edges: readonly { from: string; to: string }[]): EdgeEndpointIndex {
  const lower: LowerEdge[] = new Array<LowerEdge>(edges.length)
  const byFrom = new Map<string, EdgeEndpoint[]>()
  for (let at = 0; at < edges.length; at += 1) {
    const edge = edges[at]
    const from = edge.from.toLowerCase()
    const to = edge.to.toLowerCase()
    lower[at] = { from, to }
    const list = byFrom.get(from)
    if (list === undefined) byFrom.set(from, [{ to, at }])
    else list.push({ to, at })
  }
  return { lower, byFrom, size: lower.length }
}

/** 轮次关系计数需要的轮次形状（`SessionDetail.turns` 的结构子集）。 */
export interface TurnLike {
  readonly n: number
  readonly files: readonly { readonly path: string }[]
}

/** 详情形状（`SessionDetail` 的结构子集：只需要 turns）。 */
export interface DetailLike {
  readonly turns: readonly TurnLike[]
}

/**
 * 每轮「本轮文件之间的关系数」。
 *
 * 与旧实现（`for edge of edges { if (keys.has(from) && keys.has(to)) count++ }`）**逐 key 等价**，
 * 但内层遍历的是**本轮文件的出边**而不是全部边：复杂度 O(轮次 × 本轮文件数 × 平均出度)。
 *
 * @param details `sessionId → detail`
 * @param index `buildEdgeEndpointIndex(edges)` 的结果
 * @param keyOf 轮次键（tab 用 `selectionKey({ kind: 'turn', … })`，保持一致）
 */
export function turnRelationCounts(
  details: Iterable<readonly [string, DetailLike]>,
  index: EdgeEndpointIndex,
  keyOf: (sessionId: string, turn: number) => string,
): Map<string, number> {
  const map = new Map<string, number>()
  if (index.size === 0) return map
  for (const [sessionId, detail] of details) {
    for (const turn of detail.turns) {
      if (turn.files.length === 0) continue
      const keys = new Set<string>()
      for (const file of turn.files) keys.add(file.path.toLowerCase())
      if (keys.size === 0) continue
      let count = 0
      for (const key of keys) {
        const list = index.byFrom.get(key)
        if (list === undefined) continue
        for (const endpoint of list) {
          if (keys.has(endpoint.to)) count += 1
        }
      }
      if (count > 0) map.set(keyOf(sessionId, turn.n), count)
    }
  }
  return map
}

/**
 * 两端都在 `keys`（小写路径集合）里的边，**保持输入顺序**。
 *
 * 与 `edges.filter((e) => keys.has(e.from.toLowerCase()) && keys.has(e.to.toLowerCase()))` 等价，
 * 但只遍历 `keys` 里每个文件的出边（O(|keys| × 度数)），不扫全量边。
 */
export function filterEdgesWithin<E extends { from: string; to: string }>(
  edges: readonly E[],
  index: EdgeEndpointIndex,
  keys: ReadonlySet<string>,
): E[] {
  if (keys.size === 0 || index.size === 0) return []
  const ats: number[] = []
  for (const key of keys) {
    const list = index.byFrom.get(key)
    if (list === undefined) continue
    for (const endpoint of list) {
      if (keys.has(endpoint.to)) ats.push(endpoint.at)
    }
  }
  if (ats.length === 0) return []
  if (ats.length > 1) ats.sort((left, right) => left - right)
  const out: E[] = new Array<E>(ats.length)
  for (let i = 0; i < ats.length; i += 1) out[i] = edges[ats[i]]
  return out
}
