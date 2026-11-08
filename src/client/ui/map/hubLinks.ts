/*
 * map/hubLinks.ts —— 文件夹枢纽的**跨目录真实关系**聚合（03 §4.2.2）。
 *
 * 规格（用户 2026-11-08 拍板）**两段历史都要实现**：
 * 1. **枢纽 ↔ 当前目录文件**（R10 已有，`computeHubLinks`）：
 *    把「当前目录某文件 ↔ 子文件夹内某文件」的**真实跨边界边聚合到枢纽**上，
 *    于是枢纽真的连到它内部有来往的簇；**线宽 = 聚合权重**；
 *    **没有跨目录关系的枢纽放外围环、绝不伪造连线**（`hasLinks === false`，UI 给 `graph.hubEmpty`）；
 *    每个枢纽最多连出 `GRAPH_HUB_MAX_LINKS`（3）条，只留聚合权重最高的几个文件，否则枢纽线太多。
 * 2. **枢纽 ↔ 枢纽**（R11 新增，`computeHubPairs`）：用户原话
 *    「左边的节点图中的不同的文件夹之间没有线连在一起…我的设想是不同文件夹之间也可以相连」。
 *    把「A 文件夹内文件 ↔ B 文件夹内文件」的真实边**按 folder 对聚合**成一条线，
 *    `weight` = 聚合权重和、`count` = 真实边数；**没有任何边就不画**（不伪造）；
 *    按档位截断（骨架 0 / 标准 top-2 / 全部 top-4），裁剪后**两端都保留**。
 *
 * 数据来源：`allEdges`（**未按当前目录过滤的全量边集**，由 tab 传入）。
 * 空值语义：`allEdges === undefined` → **不做枢纽聚合、不画任何枢纽连线**（绝不猜、绝不伪造）。
 *
 * 性能：调用方一次建端点索引（`buildCrossBoundaryIndex`）后按边界复用，
 * 不要每个枢纽都扫一遍全量边；`computeHubPairs` 只用**它自己的一次 O(E) 扫描**，
 * 不是 O(hubPairs × E)（整页 SSR 热开 33ms / cap 50ms，没有余量给平方项）。
 *
 * 纯函数、确定性：同输入两次结果逐字段相同。
 */
import type { GraphEdge } from '../../../shared/relations/index.ts'
import { GRAPH_HUB_MAX_LINKS } from './theme.ts'

/** 端点索引：小写路径键 → 该文件的全部边（按 allEdges 输入顺序，稳定）。 */
export type CrossBoundaryIndex = ReadonlyMap<string, readonly GraphEdge[]>

/** 建索引（一次 O(E)）。空输入返回空 map。 */
export function buildCrossBoundaryIndex(allEdges: readonly GraphEdge[] | undefined): CrossBoundaryIndex {
  const index = new Map<string, GraphEdge[]>()
  if (allEdges === undefined) return index
  for (const edge of allEdges) {
    const fromKey = edge.from.toLowerCase()
    const toKey = edge.to.toLowerCase()
    const fromList = index.get(fromKey)
    if (fromList === undefined) index.set(fromKey, [edge])
    else fromList.push(edge)
    if (toKey === fromKey) continue
    const toList = index.get(toKey)
    if (toList === undefined) index.set(toKey, [edge])
    else toList.push(edge)
  }
  return index
}

/** 一条聚合到枢纽的连线（枢纽 ↔ 当前目录里的某个文件）。 */
export interface HubLink {
  /** 枢纽路径（子文件夹，工作区相对）。 */
  hubPath: string
  /** 当前目录里的那个文件路径（原大小写，展示用）。 */
  filePath: string
  /** 聚合权重 = 涉及这条关系的边权重之和。 */
  weight: number
  /** 聚合条数（真实跨边界边数）。 */
  count: number
}

export interface HubLinkOptions {
  /** 当前目录（'' = 根）。 */
  currentPath: string
  /** 当前目录直接文件的真实路径（原大小写）。 */
  filePaths: readonly string[]
  /** 当前目录的子文件夹路径（原大小写）。 */
  hubPaths: readonly string[]
  /** 最多几条（缺省 GRAPH_HUB_MAX_LINKS = 3）。 */
  maxLinks?: number
}

export interface HubLinkResult {
  /** 键 = 枢纽路径小写 → 它的聚合连线（权重降序 → 文件路径升序，稳定）。 */
  links: ReadonlyMap<string, HubLink[]>
  /** 有跨目录关系的枢纽键集合（其余枢纽必须放外围且不画线）。 */
  connected: ReadonlySet<string>
}

/**
 * 计算枢纽 ↔ 当前目录文件的聚合连线。
 *
 * 判定（严格按"真实跨目录边"）：
 * - 一端是**当前目录的直接文件**（`filePaths`，大小写不敏感匹配）；
 * - 另一端落在某个**子文件夹**的子路径前缀下（`hubPath + '/'`）；
 * - **两端都在当前目录内的边不算跨边界**（那些边由 `edges` 走 L1/L2/L3，归图内分层）；
 * - 同一对（枢纽, 文件）的多条边聚合为一条，权重相加。
 */
export function computeHubLinks(
  index: CrossBoundaryIndex,
  options: HubLinkOptions,
): HubLinkResult {
  const maxLinks = Math.max(1, Math.trunc(options.maxLinks ?? GRAPH_HUB_MAX_LINKS))
  const links = new Map<string, HubLink[]>()
  const connected = new Set<string>()
  if (options.hubPaths.length === 0 || options.filePaths.length === 0) return { links, connected }

  const currentPrefix = options.currentPath === '' ? '' : options.currentPath + '/'
  const fileByKey = new Map<string, string>()
  for (const path of options.filePaths) fileByKey.set(path.toLowerCase(), path)

  // 累积：(hubKey) → (fileKey) → { weight, count }
  const aggregate = new Map<string, Map<string, { weight: number; count: number; filePath: string; hubPath: string }>>()

  for (const [key, edgeList] of index) {
    const filePath = fileByKey.get(key)
    if (filePath === undefined) continue
    for (const edge of edgeList) {
      const otherKey = edge.from.toLowerCase() === key ? edge.to.toLowerCase() : edge.from.toLowerCase()
      if (otherKey === key) continue
      // 另一端必须是某个枢纽的子路径（严格前缀 + '/'，不跨层级意外命中）。
      let matchedHub: string | null = null
      for (const hubPath of options.hubPaths) {
        if (otherKey.startsWith(hubPath.toLowerCase() + '/')) {
          matchedHub = hubPath
          break
        }
      }
      if (matchedHub === null) continue
      // 防御：另一端若其实在当前目录的直接层（不在任何子文件夹里），上面的前缀已经排除了。
      if (currentPrefix !== '' && !filePath.startsWith(currentPrefix)) continue
      const hubKey = matchedHub.toLowerCase()
      const perFile = aggregate.get(hubKey) ?? new Map<string, { weight: number; count: number; filePath: string; hubPath: string }>()
      const existing = perFile.get(key)
      const weight = Number.isFinite(edge.weight) && edge.weight > 0 ? edge.weight : 1
      if (existing === undefined) perFile.set(key, { weight, count: 1, filePath, hubPath: matchedHub })
      else {
        existing.weight += weight
        existing.count += 1
      }
      aggregate.set(hubKey, perFile)
    }
  }

  for (const [hubKey, perFile] of aggregate) {
    const list = [...perFile.values()]
      .sort((left, right) => {
        if (left.weight !== right.weight) return right.weight - left.weight
        return left.filePath < right.filePath ? -1 : left.filePath > right.filePath ? 1 : 0
      })
      .slice(0, maxLinks)
      .map((item) => ({
        hubPath: item.hubPath,
        filePath: item.filePath,
        weight: Math.round(item.weight * 100) / 100,
        count: item.count,
      }))
    if (list.length === 0) continue
    links.set(hubKey, list)
    connected.add(hubKey)
  }
  return { links, connected }
}

/**
 * 外围环半径：**没有跨目录关系**的枢纽按环摆放（不连线、不伪造）。
 * 返回值是环上第 `index` 个点的相对角度（弧度），−90° 起顺时针。
 */
export function perimeterAngle(index: number, count: number): number {
  if (count <= 0) return -Math.PI / 2
  return -Math.PI / 2 + (Math.PI * 2 * index) / count
}

/* ================================================================== *
 * 枢纽 ↔ 枢纽（R11：不同文件夹之间也要连线）
 * ================================================================== */

/**
 * 一条**枢纽 ↔ 枢纽**的聚合连线（两个当前目录直接子文件夹之间的真实来往）。
 *
 * 无向：`aPath < bPath`（小写比较）恒成立，A↔B **只产生一条记录**、不双向重复。
 */
export interface HubPair {
  /** 小写路径较小的一端（当前目录直接子文件夹，**原大小写**，展示用）。 */
  aPath: string
  /** 小写路径较大的一端（同上）。 */
  bPath: string
  /** 聚合权重 = 涉及这条关系的边权重之和（保留 2 位小数）。 */
  weight: number
  /** 真实边数（不是权重，别混用）。 */
  count: number
}

export interface HubPairOptions {
  /** 当前目录（'' = 根）。只用来确认两个端点确实在当前目录下（防御性早退）。 */
  currentPath: string
  /** 当前目录的**直接子文件夹**（原大小写）；不会命中孙目录。 */
  hubPaths: readonly string[]
  /**
   * 每个枢纽最多保留几个伙伴（骨架 0 / 标准 2 / 全部 4，见 `GRAPH_HUB_PAIR_PARTNERS`）。
   * 0 = 一条都不画。
   */
  maxPartnersPerHub?: number
}

/**
 * 无向键归一（`min(a,b) + "\u0000" + max(a,b)`，小写）。
 * A↔B 与 B↔A 得到同一个键 —— 这是「连线不双向重复」的唯一口径，渲染层复用它。
 */
export function hubPairKey(aPath: string, bPath: string): string {
  const a = aPath.toLowerCase()
  const b = bPath.toLowerCase()
  return a <= b ? a + '\u0000' + b : b + '\u0000' + a
}

/** 枢纽对的稳定排序：权重降序 → aPath 升序 → bPath 升序（确定性，无可变全局态）。 */
export function compareHubPairs(left: HubPair, right: HubPair): number {
  if (left.weight !== right.weight) return right.weight - left.weight
  if (left.aPath !== right.aPath) return left.aPath < right.aPath ? -1 : 1
  return left.bPath < right.bPath ? -1 : left.bPath > right.bPath ? 1 : 0
}

/**
 * **截断**（纯函数）：每枢纽按「权重降序 → 伙伴路径升序」取前 N 个伙伴，
 * 只要被任一端选中就保留整条线（**裁剪后两端都保留**，无向线不丢半边）。
 *
 * 单独导出是因为渲染层要从「布局用的最大伙伴集」里按档位再截一次
 * （布局用 top-4 保证切档不重排，绘制用 0/2/4 保真）。
 * 这个再截断**与直接对全量配对做 top-N 结果相同**：top-K ⊆ top-M（K ≤ M）且排序一致，
 * 所以 `truncateHubPairs(computeHubPairs(...,4), 2)` ≡ `computeHubPairs(...,2)`（测试里断言）。
 *
 * 入参 `pairs` 必须是**已聚合、已排序**的（`computeHubPairs` 的输出）。
 *
 * 泛型 `T extends HubPair`：布局层用的是带画布坐标的 `FolderLayoutHubPair`，
 * 截断后必须**原样保留这些额外字段**（不能只剩 aPath/bPath/weight/count，否则线画不出来）。
 */
export function truncateHubPairs<T extends HubPair>(pairs: readonly T[], maxPartnersPerHub: number): T[] {
  const maxPartners = Math.max(0, Math.trunc(maxPartnersPerHub))
  if (maxPartners === 0 || pairs.length === 0) return []
  // 每枢纽的伙伴候选（权重降序 → 伙伴路径升序）。
  const partnersByHub = new Map<string, Array<{ key: string; partner: string; weight: number }>>()
  const byKey = new Map<string, T>()
  for (const pair of pairs) {
    const key = hubPairKey(pair.aPath, pair.bPath)
    byKey.set(key, pair)
    const aKey = pair.aPath.toLowerCase()
    const bKey = pair.bPath.toLowerCase()
    const forA = partnersByHub.get(aKey) ?? []
    forA.push({ key, partner: bKey, weight: pair.weight })
    partnersByHub.set(aKey, forA)
    const forB = partnersByHub.get(bKey) ?? []
    forB.push({ key, partner: aKey, weight: pair.weight })
    partnersByHub.set(bKey, forB)
  }
  const keptKeys = new Set<string>()
  for (const [, partners] of partnersByHub) {
    partners.sort((left, right) => {
      if (left.weight !== right.weight) return right.weight - left.weight
      return left.partner < right.partner ? -1 : left.partner > right.partner ? 1 : 0
    })
    for (const partner of partners.slice(0, maxPartners)) keptKeys.add(partner.key)
  }
  const result: T[] = []
  for (const key of keptKeys) {
    const pair = byKey.get(key)
    if (pair !== undefined) result.push(pair)
  }
  result.sort(compareHubPairs)
  return result
}

/**
 * 计算**枢纽 ↔ 枢纽**的聚合连线（03 §4.2.2「文件夹枢纽参与结构」第 2 条）。
 *
 * 判定（严格按"真实边"，**绝不伪造**）：
 * - 边的两端必须分别落在**两个不同的**当前目录直接子文件夹下（`hubPath + '/'` 前缀）；
 * - 一端在当前目录（直接文件）、另一端在枢纽里 → **不算**枢纽间关系（那是 `computeHubLinks`）；
 * - 两端都在同一个枢纽里 → 不算；
 * - 没有真实边 → **不产生任何记录**（不是"权重 0 的线"）。
 *
 * 聚合：
 * - 同一对文件夹的多条边聚成一条，`weight` 累加、`count` 计真实边数；
 * - 权重按「分」（×100 取整）累加 → **加法顺序无关**、打乱输入边顺序结果完全相同（确定性）；
 * - 只有真实权重参与，缺省权重按 1（与 `computeHubLinks` 同一口径）。
 *
 * 截断（`maxPartnersPerHub`）：
 * - 每个枢纽按「权重降序 → 伙伴路径升序」取前 N 个伙伴；
 * - **裁剪后两端都保留**：只要 A 选了 B 或 B 选了 A，这条线就留下（无向线不丢半边）；
 * - N = 0 → 返回空数组（骨架档）。
 *
 * 复杂度：**一次 O(E) 扫描**（每条边只看两个端点的枢纽归属），
 * 不是 O(枢纽对数 × E)。整页 SSR 热开 33ms / cap 50ms，没有余量给平方项。
 */
export function computeHubPairs(allEdges: readonly GraphEdge[] | undefined, options: HubPairOptions): HubPair[] {
  const maxPartners = Math.max(0, Math.trunc(options.maxPartnersPerHub ?? 0))
  if (maxPartners === 0) return []
  if (allEdges === undefined || allEdges.length === 0) return []
  if (options.hubPaths.length === 0) return []

  // 1. 枢纽键（小写）→ 原大小写路径。直接子文件夹互不为前缀，所以一个文件最多命中一个。
  const hubByKey = new Map<string, string>()
  for (const path of options.hubPaths) {
    if (path === '') continue
    const key = path.toLowerCase()
    if (!hubByKey.has(key)) hubByKey.set(key, path)
  }
  if (hubByKey.size < 2) return []
  // 遍历顺序固定（键升序）→ 前缀匹配结果与输入顺序无关。
  const hubKeys = [...hubByKey.keys()].sort()

  const currentPrefix = options.currentPath === '' ? '' : options.currentPath.toLowerCase() + '/'
  /** 文件路径（小写）→ 所属枢纽键（小写）；不属于任何枢纽返回 null。 */
  const hubOfFile = (fileKey: string): string | null => {
    if (currentPrefix !== '' && !fileKey.startsWith(currentPrefix)) return null
    for (const hubKey of hubKeys) {
      if (fileKey.startsWith(hubKey + '/')) return hubKey
    }
    return null
  }

  // 2. 一次扫描聚合（键 = 无向归一键；权重按「分」整数累加 → 顺序无关）。
  interface Bucket {
    aPath: string
    bPath: string
    cents: number
    count: number
  }
  const buckets = new Map<string, Bucket>()
  for (const edge of allEdges) {
    const fromKey = edge.from.toLowerCase()
    const toKey = edge.to.toLowerCase()
    if (fromKey === toKey) continue
    const fromHub = hubOfFile(fromKey)
    if (fromHub === null) continue
    const toHub = hubOfFile(toKey)
    if (toHub === null || toHub === fromHub) continue
    const key = hubPairKey(fromHub, toHub)
    const [aKey, bKey] = fromHub <= toHub ? [fromHub, toHub] : [toHub, fromHub]
    const rawWeight = Number.isFinite(edge.weight) && edge.weight > 0 ? edge.weight : 1
    const cents = Math.round(rawWeight * 100)
    const existing = buckets.get(key)
    if (existing === undefined) {
      buckets.set(key, { aPath: hubByKey.get(aKey) ?? aKey, bPath: hubByKey.get(bKey) ?? bKey, cents, count: 1 })
    } else {
      existing.cents += cents
      existing.count += 1
    }
  }
  if (buckets.size === 0) return []

  // 3. 全量候选（未截断）→ 交给 `truncateHubPairs` 做 top-N（**唯一截断口径**，不外挂第二套规则）。
  const allPairs: HubPair[] = []
  for (const bucket of buckets.values()) {
    allPairs.push({
      aPath: bucket.aPath,
      bPath: bucket.bPath,
      weight: Math.round(bucket.cents) / 100,
      count: bucket.count,
    })
  }
  allPairs.sort(compareHubPairs)
  return truncateHubPairs(allPairs, maxPartners)
}
