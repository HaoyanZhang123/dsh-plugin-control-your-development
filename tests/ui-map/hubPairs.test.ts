/*
 * hubPairs.test.ts —— **枢纽 ↔ 枢纽**的聚合连线（R11 / 03 §4.2.2 第 2 条）。
 *
 * 用户 2026-11-08 原话：「左边的节点图中的不同的文件夹之间没有线连在一起…
 * 我的设想是不同文件夹之间也可以相连」。
 *
 * 覆盖（含**反向断言**：两文件夹之间零边就绝不连线）：
 * - 正向：A 文件夹内文件 ↔ B 文件夹内文件 的真实边按 folder 对聚合成**一条线**（权重累加）；
 * - 无向去重：A↔B 与 B↔A 只出一条（键 = min(a,b)+"\u0000"+max(a,b)）；
 * - **反向**：两个文件夹之间**零边** → 不产生记录（绝不伪造）；
 * - 反向：两端在同一文件夹内 / 一端在当前目录 → 都不算枢纽间关系；
 * - 反向：孙目录不算（只统计当前目录的**直接**子文件夹）；
 * - 反向：allEdges === undefined → 空（不猜、不伪造）；
 * - top-N 截断：骨架 0 / 标准 2 / 全部 4，且**裁剪后两端都保留**（无向线不丢半边）；
 * - 确定性：同输入两次逐字段相同；**打乱边顺序结果相同**（权重按分整数累加，加法顺序无关）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { coTurnEvidence, createEdge, type GraphEdge } from '../../src/shared/relations/index.ts'
import {
  computeHubPairs,
  hubPairKey,
  hubPairPartnersFor,
  GRAPH_HUB_PAIR_PARTNERS,
  GRAPH_HUB_PAIR_WIDTH_BASE,
  GRAPH_HUB_PAIR_WIDTH_MAX,
  hubPairStrokeWidth,
  truncateHubPairs,
  type HubPair,
} from '../../src/client/ui/map/index.ts'

function edge(from: string, to: string, weight = 1): GraphEdge {
  return createEdge({
    type: 'coTurn',
    from,
    to,
    weight,
    evidence: coTurnEvidence({ samples: [{ sessionId: 'sess-0001', turn: 1 }], count: weight }),
  })
}

/** 便利：A↔B 的聚合结果（未命中返回 undefined）。 */
function pairOf(pairs: readonly HubPair[], a: string, b: string): HubPair | undefined {
  const key = hubPairKey(a, b)
  return pairs.find((pair) => hubPairKey(pair.aPath, pair.bPath) === key)
}

/* ================================================================== *
 * 正向：有真实边才连线、按 folder 对聚合
 * ================================================================== */

test('聚合：A 文件夹内文件 ↔ B 文件夹内文件 的边聚成一条线，权重累加、条数计真实边', () => {
  const allEdges: GraphEdge[] = [
    edge('src/a.ts', 'docs/guide.md', 3),
    edge('src/b.ts', 'docs/api.md', 4),
    edge('src/c.ts', 'docs/guide.md', 2),
  ]
  const pairs = computeHubPairs(allEdges, { currentPath: '', hubPaths: ['src', 'docs'], maxPartnersPerHub: 2 })
  assert.equal(pairs.length, 1, '同一对文件夹只出一条线')
  const pair = pairOf(pairs, 'src', 'docs')
  assert.ok(pair !== undefined)
  assert.equal(pair.weight, 9, '权重 3+4+2 累加')
  assert.equal(pair.count, 3, '条数是真实边数（不是权重）')
})

test('无向去重：A↔B 与 B↔A 只出一条（键规范化为 min/max）', () => {
  const allEdges: GraphEdge[] = [edge('src/a.ts', 'docs/x.md', 5), edge('docs/x.md', 'src/a.ts', 5)]
  const pairs = computeHubPairs(allEdges, { currentPath: '', hubPaths: ['src', 'docs'], maxPartnersPerHub: 2 })
  assert.equal(pairs.length, 1, '反向边不得产生第二条线')
  assert.equal(pairs[0].weight, 10, '两条真实边都计入权重')
  assert.equal(pairs[0].count, 2)
  // aPath 恒为小写较小的一端 → 输出顺序稳定。
  assert.ok(pairs[0].aPath.toLowerCase() < pairs[0].bPath.toLowerCase())
})

test('hubPairKey：无向归一 —— (a,b) 与 (b,a) 同键，大小写不敏感', () => {
  assert.equal(hubPairKey('src', 'docs'), hubPairKey('docs', 'src'))
  assert.equal(hubPairKey('SRC', 'Docs'), hubPairKey('docs', 'src'))
  assert.equal(hubPairKey('a', 'b'), 'a\u0000b')
  assert.equal(hubPairKey('b', 'a'), 'a\u0000b')
  assert.notEqual(hubPairKey('a', 'b'), hubPairKey('a', 'c'))
})

test('聚合：只统计当前目录的**直接**子文件夹 —— 孙目录不算', () => {
  const allEdges: GraphEdge[] = [edge('src/a.ts', 'docs/deep/nested/x.md', 6)]
  const pairs = computeHubPairs(allEdges, { currentPath: '', hubPaths: ['src', 'docs'], maxPartnersPerHub: 2 })
  assert.equal(pairs.length, 1)
  assert.equal(pairs[0].weight, 6, '孙目录里的文件归到它的顶层直接子文件夹')
  // 若把孙目录也当枢纽，就会出现 docs 与 docs/deep 两条线 —— 必须只有一条。
  const withGrandchild = computeHubPairs(allEdges, { currentPath: '', hubPaths: ['src', 'docs', 'docs/deep'], maxPartnersPerHub: 2 })
  assert.equal(withGrandchild.length, 1, '孙目录不得与父目录各成一条线')
})

test('聚合：嵌套当前目录（currentPath=src）也成立', () => {
  const allEdges: GraphEdge[] = [edge('src/client/a.ts', 'src/host/b.ts', 7)]
  const pairs = computeHubPairs(allEdges, { currentPath: 'src', hubPaths: ['src/client', 'src/host'], maxPartnersPerHub: 2 })
  assert.equal(pairs.length, 1)
  assert.equal(pairs[0].aPath, 'src/client')
  assert.equal(pairs[0].bPath, 'src/host')
  assert.equal(pairs[0].weight, 7)
})

test('聚合：真实数据形态 —— 6 个文件夹两两有关系时，标准档每枢纽 top-2', () => {
  // 造 4 个文件夹的全连接方阵（6 对），权重各不相同。
  const hubs = ['config', 'docs', 'src', 'tests']
  const weights: Array<[string, string, number]> = [
    ['config', 'src', 79],
    ['docs', 'src', 62],
    ['src', 'tests', 60],
    ['config', 'docs', 26],
    ['config', 'tests', 12],
    ['docs', 'tests', 18],
  ]
  const allEdges: GraphEdge[] = weights.map(([a, b, w]) => edge(a + '/f.ts', b + '/g.ts', w))
  const standard = computeHubPairs(allEdges, { currentPath: '', hubPaths: hubs, maxPartnersPerHub: 2 })
  // 语义：每个枢纽**选择** top-2 伙伴；只要被任一端选中就保留整条线（无向不丢半边）。
  // 因此单枢纽的实际伙伴数可能 > 2（别的枢纽选了它）—— 这是规格要的行为。
  // 能断言的是：总数 ≤ top-N × 枢纽数，且**最强的几对**一定在里面。
  assert.ok(standard.length <= 2 * hubs.length, '总数不得超过 top-2 × 枢纽数')
  // 最强的三对一定在里面：config-src(79)、docs-src(62)、src-tests(60)。
  assert.ok(pairOf(standard, 'config', 'src') !== undefined)
  assert.ok(pairOf(standard, 'docs', 'src') !== undefined)
  assert.ok(pairOf(standard, 'src', 'tests') !== undefined)
  // 最弱的一对（config-tests 12）：config 端有 src(79)/docs(26) 更强，tests 端有 src(60)/docs(18) 更强
  // → 两端都排不进 top-2 → 必须被截掉（这是"截断真的生效"的证据）。
  assert.equal(pairOf(standard, 'config', 'tests'), undefined, '最弱的一对两端都落选 → 应被 top-2 截掉')
  // 标准档必须比全部档少（否则截断没生效）。
  const all = computeHubPairs(allEdges, { currentPath: '', hubPaths: hubs, maxPartnersPerHub: 4 })
  assert.ok(all.length > standard.length, '全部档应比标准档多：' + String(all.length) + ' vs ' + String(standard.length))
})

/* ================================================================== *
 * 反向断言（必须有：防伪造）
 * ================================================================== */

test('反向：两个文件夹之间**零边** → 绝不产生连线', () => {
  // src 与 docs 内部各有边，但**跨这两个文件夹一条边都没有**。
  const allEdges: GraphEdge[] = [
    edge('src/a.ts', 'src/b.ts', 9),
    edge('docs/x.md', 'docs/y.md', 9),
    edge('other/p.ts', 'other/q.ts', 9),
  ]
  const pairs = computeHubPairs(allEdges, { currentPath: '', hubPaths: ['src', 'docs', 'other'], maxPartnersPerHub: 4 })
  assert.equal(pairs.length, 0, '文件夹内部边不得被当成文件夹之间的关系')
  assert.equal(pairOf(pairs, 'src', 'docs'), undefined)
})

test('反向：只有部分文件夹之间有边 —— 其余对必须一条都没有', () => {
  const allEdges: GraphEdge[] = [edge('src/a.ts', 'docs/x.md', 5)]
  const pairs = computeHubPairs(allEdges, { currentPath: '', hubPaths: ['src', 'docs', 'assets', 'notes'], maxPartnersPerHub: 4 })
  assert.equal(pairs.length, 1, '只有 src-docs 有真实边')
  assert.equal(pairOf(pairs, 'src', 'assets'), undefined, 'assets 无真实边 → 不得伪造')
  assert.equal(pairOf(pairs, 'docs', 'notes'), undefined)
  assert.equal(pairOf(pairs, 'assets', 'notes'), undefined)
})

test('反向：两端在**同一个**文件夹内 → 不算枢纽间关系', () => {
  const allEdges: GraphEdge[] = [edge('src/a.ts', 'src/deep/b.ts', 9)]
  const pairs = computeHubPairs(allEdges, { currentPath: '', hubPaths: ['src', 'docs'], maxPartnersPerHub: 2 })
  assert.equal(pairs.length, 0)
})

test('反向：一端是当前目录的直接文件（不在任何枢纽下）→ 不算枢纽间关系', () => {
  // 这是 `computeHubLinks` 的职责（枢纽 ↔ 当前目录文件），不能重复算成枢纽间线。
  const allEdges: GraphEdge[] = [edge('README.md', 'src/a.ts', 9)]
  const pairs = computeHubPairs(allEdges, { currentPath: '', hubPaths: ['src', 'docs'], maxPartnersPerHub: 2 })
  assert.equal(pairs.length, 0)
})

test('反向：allEdges === undefined → 空（不猜、不伪造）', () => {
  assert.deepEqual(computeHubPairs(undefined, { currentPath: '', hubPaths: ['src', 'docs'], maxPartnersPerHub: 2 }), [])
})

test('反向：空边集 / 空枢纽 / 单枢纽 → 空（不炸）', () => {
  assert.deepEqual(computeHubPairs([], { currentPath: '', hubPaths: ['src', 'docs'], maxPartnersPerHub: 2 }), [])
  assert.deepEqual(computeHubPairs([edge('src/a.ts', 'docs/x.md', 5)], { currentPath: '', hubPaths: [], maxPartnersPerHub: 2 }), [])
  assert.deepEqual(
    computeHubPairs([edge('src/a.ts', 'docs/x.md', 5)], { currentPath: '', hubPaths: ['src'], maxPartnersPerHub: 2 }),
    [],
    '只有一个枢纽不可能有枢纽间关系',
  )
})

test('反向：骨架档（maxPartnersPerHub = 0）→ 一条都不画', () => {
  const allEdges: GraphEdge[] = [edge('src/a.ts', 'docs/x.md', 79)]
  assert.deepEqual(computeHubPairs(allEdges, { currentPath: '', hubPaths: ['src', 'docs'], maxPartnersPerHub: 0 }), [])
  assert.equal(hubPairPartnersFor('skeleton'), 0)
})

test('反向：前缀不跨目录边界匹配（docs 不该匹配 docs2 里的文件）', () => {
  const allEdges: GraphEdge[] = [edge('docs2/a.md', 'src/x.ts', 9)]
  const pairs = computeHubPairs(allEdges, { currentPath: '', hubPaths: ['docs', 'src'], maxPartnersPerHub: 2 })
  assert.equal(pairs.length, 0, 'docs2 不是 docs 的子路径')
})

/* ================================================================== *
 * top-N 截断（三档）
 * ================================================================== */

test('档位：骨架 0 / 标准 2 / 全部 4（GRAPH_HUB_PAIR_PARTNERS 是唯一口径）', () => {
  assert.equal(hubPairPartnersFor('skeleton'), 0)
  assert.equal(hubPairPartnersFor('standard'), 2)
  assert.equal(hubPairPartnersFor('all'), 4)
  assert.deepEqual(GRAPH_HUB_PAIR_PARTNERS, { skeleton: 0, standard: 2, all: 4 })
})

test('截断：三档数量单调不减（0 ≤ standard ≤ all），被截掉的都是**两端都落选**的弱对', () => {
  const hubs = ['a', 'b', 'c', 'd', 'e']
  // a 与 b/c/d/e 都有关，权重递减；b 与 c/d 也有更强的关系。
  // 目的：让 a-b 在 **a 端**与 **b 端**都排不进 top-2，才可能被截掉。
  const allEdges: GraphEdge[] = [
    edge('a/f.ts', 'b/f.ts', 1), // ← 两端都要落选的弱对
    edge('a/f.ts', 'c/f.ts', 50),
    edge('a/f.ts', 'd/f.ts', 40),
    edge('a/f.ts', 'e/f.ts', 20),
    edge('b/f.ts', 'c/f.ts', 90),
    edge('b/f.ts', 'd/f.ts', 80),
  ]
  const pairsOf = (density: 'skeleton' | 'standard' | 'all'): HubPair[] =>
    computeHubPairs(allEdges, { currentPath: '', hubPaths: hubs, maxPartnersPerHub: hubPairPartnersFor(density) })
  const skeleton = pairsOf('skeleton')
  const standard = pairsOf('standard')
  const all = pairsOf('all')
  assert.equal(skeleton.length, 0, '骨架档一条都不画')
  assert.ok(standard.length >= 1)
  assert.ok(all.length >= standard.length, '全部档不得少于标准档')
  // a 端排名：c(50) > d(40) > e(20) > b(1)；b 端排名：c(90) > d(80) > a(1)。
  // → a-b 两端都落选 → 必须截掉（截断确实生效）。
  assert.equal(pairOf(standard, 'a', 'b'), undefined, '两端都落选的弱对必须被截掉')
  assert.ok(pairOf(standard, 'a', 'c') !== undefined, 'a 的 top-1 必须在')
  assert.ok(pairOf(standard, 'a', 'd') !== undefined, 'a 的 top-2 必须在')
  // e 只有 a 一个伙伴 → e 端选了 a → 保留（无向线不丢半边）。
  assert.ok(pairOf(standard, 'a', 'e') !== undefined, '只有单端选择的对也要保留')
  // 全部档（top-4）：a 的 4 个伙伴全在 → a-b 也回来了。
  assert.ok(pairOf(all, 'a', 'b') !== undefined, '全部档应把 a 的第 4 个伙伴也画出来')
  assert.equal(all.length, 6, '全部档：a-b/a-c/a-d/a-e + b-c/b-d 共 6 对')
})

test('截断：**裁剪后两端都保留** —— A 选了 B 就一定有这条线，不丢半边', () => {
  // b 只有一个强关系（与 a），a 有很多伙伴。若按"单端裁剪"实现，b 可能因为
  // a 那边的名额满了而失去这条线 —— 但 b 自己选了 a，必须保留。
  const hubs = ['a', 'b', 'c', 'd', 'e']
  const allEdges: GraphEdge[] = [
    edge('a/f.ts', 'b/f.ts', 10), // b 的唯一伙伴
    edge('a/f.ts', 'c/f.ts', 90),
    edge('a/f.ts', 'd/f.ts', 80),
    edge('a/f.ts', 'e/f.ts', 70),
  ]
  const standard = computeHubPairs(allEdges, { currentPath: '', hubPaths: hubs, maxPartnersPerHub: 2 })
  // a 的 top-2 = c(90), d(80)；a-b 这条线虽然 a 那边没选，但 b 选了 a → 保留。
  assert.ok(pairOf(standard, 'a', 'b') !== undefined, 'b 端的唯一伙伴必须保留（无向线不丢半边）')
  assert.ok(pairOf(standard, 'a', 'c') !== undefined, 'a 的 top-1 必须在')
  assert.ok(pairOf(standard, 'a', 'd') !== undefined, 'a 的 top-2 必须在')
  // 同理：e 的唯一伙伴也是 a，也不能丢。
  assert.ok(pairOf(standard, 'a', 'e') !== undefined, 'e 端的唯一伙伴同样必须保留')
  // 但若两端都排不上（这里没有这样的对），才会被截掉 —— 见下一条测试。
})

test('截断：两端都没排进 top-N 的对才被截掉', () => {
  // a 的伙伴按权重 c(90) d(80) 排前二；b 有自己更强的伙伴 c(95)。
  // → a-b 在 a 端排第 3、在 b 端排第 2 → b 端选中了它，所以**保留**。
  // 真要两端都落选，需要一个对在两端各自的排名都超出 top-2。
  const hubs = ['a', 'b', 'c', 'd']
  const allEdges: GraphEdge[] = [
    edge('a/f.ts', 'c/f.ts', 90), // a 端 #1, c 端 #1
    edge('a/f.ts', 'd/f.ts', 80), // a 端 #2
    edge('a/f.ts', 'b/f.ts', 10), // a 端 #3, b 端 #2
    edge('b/f.ts', 'c/f.ts', 95), // b 端 #1
    edge('c/f.ts', 'd/f.ts', 85), // c 端 #2, d 端 #1
    edge('b/f.ts', 'd/f.ts', 5), //  b 端 #2? 不——b 端已有 c(95)、a(10)... 见下
  ]
  const standard = computeHubPairs(allEdges, { currentPath: '', hubPaths: hubs, maxPartnersPerHub: 2 })
  // b 端排名：c(95) > a(10) > d(5) → top-2 = c, a → b-d 在 b 端落选；
  // d 端排名：c(85) > a(80) > b(5) → top-2 = c, a → b-d 在 d 端也落选。
  // 两端都没选 → 这条线必须被截掉（这是"截断真的生效"的证据）。
  assert.equal(pairOf(standard, 'b', 'd'), undefined, '两端都落选的对必须被截掉')
  // 其余被至少一端选中的对都保留。
  assert.ok(pairOf(standard, 'a', 'c') !== undefined)
  assert.ok(pairOf(standard, 'a', 'd') !== undefined, 'd 端选了 a（d 的 #2）')
  assert.ok(pairOf(standard, 'b', 'c') !== undefined)
  assert.ok(pairOf(standard, 'c', 'd') !== undefined)
})

test('截断：总数上限 = top-N × 枢纽数（每枢纽最多贡献 N 次选择，去重后只会更少）', () => {
  const hubs = ['h0', 'h1', 'h2', 'h3', 'h4', 'h5']
  const allEdges: GraphEdge[] = []
  for (const a of hubs) {
    for (const b of hubs) {
      if (a >= b) continue
      allEdges.push(edge(a + '/f.ts', b + '/g.ts', 10 + hubs.indexOf(a) + hubs.indexOf(b)))
    }
  }
  for (const [density, max] of [['skeleton', 0], ['standard', 2], ['all', 4]] as const) {
    const pairs = computeHubPairs(allEdges, { currentPath: '', hubPaths: hubs, maxPartnersPerHub: max })
    assert.ok(
      pairs.length <= max * hubs.length,
      density + '：' + String(pairs.length) + ' 条 > top-' + String(max) + ' × ' + String(hubs.length) + ' 个枢纽',
    )
  }
  // 全连接方阵（6 枢纽 = 15 对）里，标准档 2×6=12 上限、全部档 4×6=24 上限。
  // 全部档下每个枢纽恰好丢掉「权重最低的那个伙伴」= 索引最大的伙伴：
  //   h0..h4 都丢 h5，h5 丢 h4 → 只有 (h4, h5) 这一对是**两端都落选** → 15-1 = 14。
  assert.equal(
    computeHubPairs(allEdges, { currentPath: '', hubPaths: hubs, maxPartnersPerHub: 4 }).length,
    14,
    '全部档：15 对里只有 (h4,h5) 两端都落选，其余 14 对至少一端选中',
  )
})

/* ================================================================== *
 * 确定性 / 顺序无关
 * ================================================================== */

test('确定性：同输入两次逐字段相同（含顺序）', () => {
  const allEdges: GraphEdge[] = [
    edge('src/a.ts', 'docs/x.md', 3),
    edge('src/b.ts', 'tests/y.ts', 7),
    edge('docs/x.md', 'tests/y.ts', 5),
  ]
  const options = { currentPath: '', hubPaths: ['src', 'docs', 'tests'], maxPartnersPerHub: 4 }
  const first = computeHubPairs(allEdges, options)
  const second = computeHubPairs(allEdges, options)
  assert.deepEqual(first, second)
  // 权重降序 → 路径升序。
  for (let index = 1; index < first.length; index += 1) {
    assert.ok(first[index - 1].weight >= first[index].weight, '必须按权重降序')
  }
})

test('确定性：**打乱边顺序**结果逐字段相同（权重按分整数累加，加法顺序无关）', () => {
  const template: Array<[string, string, number]> = [
    ['src/a.ts', 'docs/x.md', 0.1],
    ['src/b.ts', 'docs/y.md', 0.2],
    ['src/c.ts', 'docs/z.md', 0.3],
    ['src/d.ts', 'tests/w.ts', 1.7],
    ['docs/x.md', 'tests/w.ts', 2.9],
    ['docs/y.md', 'tests/w.ts', 0.7],
  ]
  const build = (order: readonly number[]): GraphEdge[] => order.map((index) => edge(template[index][0], template[index][1], template[index][2]))
  const options = { currentPath: '', hubPaths: ['src', 'docs', 'tests'], maxPartnersPerHub: 4 }
  const forward = computeHubPairs(build([0, 1, 2, 3, 4, 5]), options)
  const backward = computeHubPairs(build([5, 4, 3, 2, 1, 0]), options)
  const shuffled = computeHubPairs(build([3, 0, 5, 1, 4, 2]), options)
  assert.deepEqual(forward, backward, '倒序输入结果必须相同（浮点累加顺序无关）')
  assert.deepEqual(forward, shuffled, '乱序输入结果必须相同')
  // 小数权重也不能因为累加顺序产生 1.0000000000000002 这种漂移。
  for (const pair of forward) {
    assert.equal(Math.round(pair.weight * 100) / 100, pair.weight, '权重必须是两位小数：' + String(pair.weight))
  }
})

test('确定性：大小写不同也归一到同一对（输出保留真实路径用于展示）', () => {
  const allEdges: GraphEdge[] = [edge('SRC/A.TS', 'Docs/B.MD', 5)]
  const pairs = computeHubPairs(allEdges, { currentPath: '', hubPaths: ['src', 'docs'], maxPartnersPerHub: 2 })
  assert.equal(pairs.length, 1)
  assert.equal(pairs[0].aPath, 'docs', 'aPath 是小写较小端 → 输出原大小写路径 docs')
  assert.equal(pairs[0].bPath, 'src')
})

/* ================================================================== *
 * 截断的**不变量**（不写死魔数：断言前自己算一遍每端排名）
 * ================================================================== */

/** 自己算一遍每端排名（按权重降序 → 伙伴路径升序，与实现同一口径但独立实现）。 */
function rankOf(allEdges: readonly GraphEdge[], hubs: readonly string[]): Map<string, Map<string, number>> {
  // 1. 先独立聚合一次（不调被测函数，避免"用实现验证实现"）。
  const totals = new Map<string, { weight: number; count: number }>()
  for (const edge of allEdges) {
    const hubOf = (path: string): string | null => {
      const key = path.toLowerCase()
      for (const hub of hubs) if (key.startsWith(hub.toLowerCase() + '/')) return hub.toLowerCase()
      return null
    }
    const a = hubOf(edge.from)
    const b = hubOf(edge.to)
    if (a === null || b === null || a === b) continue
    const key = a < b ? a + '\u0000' + b : b + '\u0000' + a
    const weight = Number.isFinite(edge.weight) && edge.weight > 0 ? edge.weight : 1
    const existing = totals.get(key)
    if (existing === undefined) totals.set(key, { weight, count: 1 })
    else {
      existing.weight += weight
      existing.count += 1
    }
  }
  // 2. 每端的排名（0 起）。
  const byHub = new Map<string, Array<{ key: string; partner: string; weight: number }>>()
  for (const [key, total] of totals) {
    const [a, b] = key.split('\u0000')
    for (const [self, partner] of [
      [a, b],
      [b, a],
    ] as const) {
      const list = byHub.get(self) ?? []
      list.push({ key, partner, weight: total.weight })
      byHub.set(self, list)
    }
  }
  const ranks = new Map<string, Map<string, number>>()
  for (const [hub, list] of byHub) {
    list.sort((left, right) => (left.weight !== right.weight ? right.weight - left.weight : left.partner < right.partner ? -1 : 1))
    const perPartner = new Map<string, number>()
    for (let index = 0; index < list.length; index += 1) perPartner.set(list[index].key, index)
    ranks.set(hub, perPartner)
  }
  return ranks
}

test('截断不变量：**保留的每条线至少有一端把它排进 top-N；截掉的每条两端都没进 top-N**', () => {
  const hubs = ['a', 'b', 'c', 'd', 'e']
  const allEdges: GraphEdge[] = [
    edge('a/f.ts', 'b/f.ts', 1),
    edge('a/f.ts', 'c/f.ts', 50),
    edge('a/f.ts', 'd/f.ts', 40),
    edge('a/f.ts', 'e/f.ts', 20),
    edge('b/f.ts', 'c/f.ts', 90),
    edge('b/f.ts', 'd/f.ts', 80),
    edge('c/f.ts', 'e/f.ts', 5),
    edge('d/f.ts', 'e/f.ts', 3),
  ]
  const ranks = rankOf(allEdges, hubs)
  /** 某条无向对在两端的最小排名（null = 两端都没有这条对的记录）。 */
  const bestRank = (a: string, b: string): number | null => {
    const key = hubPairKey(a, b)
    const left = ranks.get(a.toLowerCase())?.get(key)
    const right = ranks.get(b.toLowerCase())?.get(key)
    if (left === undefined && right === undefined) return null
    return Math.min(left ?? Number.POSITIVE_INFINITY, right ?? Number.POSITIVE_INFINITY)
  }
  // 允许两侧都为 undefined 用 Infinity 兜底（TS 上不用管）。
  const best = (a: string, b: string): number => {
    const value = bestRank(a, b)
    return value === null ? Number.POSITIVE_INFINITY : value
  }

  for (const [maxPartners, label] of [
    [1, 'top-1'],
    [2, 'top-2'],
    [4, 'top-4'],
  ] as const) {
    const pairs = computeHubPairs(allEdges, { currentPath: '', hubPaths: hubs, maxPartnersPerHub: maxPartners })
    const kept = new Set(pairs.map((pair) => hubPairKey(pair.aPath, pair.bPath)))
    // 枚举所有真实存在的对（用 rankOf 的键集合）。
    const allPairKeys = new Set<string>()
    for (const [, perPartner] of ranks) for (const key of perPartner.keys()) allPairKeys.add(key)

    for (const key of allPairKeys) {
      const [a, b] = key.split('\u0000')
      if (kept.has(key)) {
        assert.ok(
          best(a, b) < maxPartners,
          label + '：保留的 ' + key.replace('\u0000', '<->') + ' 两端最好排名 ' + String(best(a, b)) + ' ≥ ' + String(maxPartners),
        )
      } else {
        assert.ok(
          best(a, b) >= maxPartners,
          label + '：截掉的 ' + key.replace('\u0000', '<->') + ' 其实有一端进了 top-' + String(maxPartners) + '（不该截）',
        )
      }
    }
    // 数量上限：每枢纽最多贡献 N 次选择 → 去重后 ≤ N × 枢纽数。
    assert.ok(pairs.length <= maxPartners * hubs.length, label + '：总数 ' + String(pairs.length) + ' 超过上限')
  }
})

test('总数上限是 **≤** 而不是 ==：伙伴数 < N 时实际更少（用 ≤ 断言，不写死魔数）', () => {
  // 只有一个实际有伙伴的枢纽对 → 无论 N=2 还是 N=4，都只有 1 条线。
  const allEdges: GraphEdge[] = [edge('a/f.ts', 'b/f.ts', 10)]
  for (const maxPartners of [1, 2, 4]) {
    const pairs = computeHubPairs(allEdges, { currentPath: '', hubPaths: ['a', 'b', 'c', 'd'], maxPartnersPerHub: maxPartners })
    assert.equal(pairs.length, 1, 'top-' + String(maxPartners) + '：只有一对真实边 → 只有 1 条线')
    assert.ok(pairs.length <= maxPartners * 4)
  }
})

/* ================================================================== *
 * truncateHubPairs（渲染层按档再截的**唯一口径**）
 * ================================================================== */

test('truncateHubPairs：从最宽集再截 与 直接算该档 完全一致（不能有两套口径）', () => {
  const hubs = ['a', 'b', 'c', 'd', 'e', 'f']
  const allEdges: GraphEdge[] = []
  for (const left of hubs) {
    for (const right of hubs) {
      if (left >= right) continue
      allEdges.push(edge(left + '/1.ts', right + '/1.ts', 5 + allEdges.length * 3))
    }
  }
  const widest = computeHubPairs(allEdges, { currentPath: '', hubPaths: hubs, maxPartnersPerHub: 4 })
  for (const max of [1, 2, 3, 4]) {
    const viaTruncate = truncateHubPairs(widest, max)
    const direct = computeHubPairs(allEdges, { currentPath: '', hubPaths: hubs, maxPartnersPerHub: max })
    assert.deepEqual(
      viaTruncate.map((pair) => pair.aPath + '<->' + pair.bPath + ':' + pair.weight),
      direct.map((pair) => pair.aPath + '<->' + pair.bPath + ':' + pair.weight),
      'top-' + String(max) + '：再截与直接算必须一致',
    )
  }
  // 0 = 一条都不画（骨架档）。
  assert.deepEqual(truncateHubPairs(widest, 0), [])
  // 空入参不炸。
  assert.deepEqual(truncateHubPairs([], 2), [])
})

test('truncateHubPairs：**保留额外字段**（布局的坐标不能被截断吃掉，否则线画不出来）', () => {
  const withCoords = [
    { aPath: 'a', bPath: 'b', weight: 90, count: 2, x1: 1, y1: 2, x2: 3, y2: 4, key: 'a\u0000b' },
    { aPath: 'a', bPath: 'c', weight: 10, count: 1, x1: 5, y1: 6, x2: 7, y2: 8, key: 'a\u0000c' },
  ]
  // a 端 top-1 = b；c 端 top-1 = a（c 只有 a 一个伙伴）→ **两端都保留**规则下两条都留下。
  // 这条测的是"字段不丢"，不是截断数量（截断数量由上面那几条不变量测试守）。
  const kept = truncateHubPairs(withCoords, 1)
  assert.ok(kept.length >= 1, '两端保留规则下至少留下 a-b')
  for (const pair of kept) {
    assert.equal(typeof pair.x1, 'number', '坐标字段必须原样保留')
    assert.equal(typeof pair.y2, 'number')
    assert.equal(typeof pair.key, 'string')
  }
  // 更严格：两条都被访问到时字段仍在。
  const all = truncateHubPairs(withCoords, 2)
  assert.equal(all.length, 2)
  assert.deepEqual(
    all.map((pair) => [pair.x1, pair.y1, pair.x2, pair.y2]),
    [
      [1, 2, 3, 4],
      [5, 6, 7, 8],
    ],
  )
})

/* ================================================================== *
 * 线宽（视觉三层：粗虚线不得比文件边更抢眼）
 * ================================================================== */

test('线宽：按 log2(1+weight) 增长并封顶（不与文件边抢戏）', () => {
  // 断言跟着常量走，不写死数字——参数调整（2026-11-08 压细过一次）不该让这条红。
  assert.ok(hubPairStrokeWidth(0) >= GRAPH_HUB_PAIR_WIDTH_BASE - 1e-9, '下界 = base')
  assert.ok(hubPairStrokeWidth(1) > hubPairStrokeWidth(0), '权重越大越粗')
  assert.ok(hubPairStrokeWidth(79) <= GRAPH_HUB_PAIR_WIDTH_MAX)
  assert.equal(hubPairStrokeWidth(1e9), GRAPH_HUB_PAIR_WIDTH_MAX, '必须封顶，不能无限粗')
  // **视觉层级**：最强的枢纽间线也不得超过文件边的基准宽度区间（文件边 1~2px 常驻）。
  assert.ok(GRAPH_HUB_PAIR_WIDTH_MAX <= 2.2, '枢纽间线封顶必须 ≤2.2px，否则盖过文件边')
  // 两位小数（确定性）。
  for (const weight of [0, 1, 3, 7, 79, 400]) {
    const width = hubPairStrokeWidth(weight)
    assert.equal(Math.round(width * 100) / 100, width)
  }
  // 非法输入不炸、不当成负值。
  assert.ok(hubPairStrokeWidth(Number.NaN) >= GRAPH_HUB_PAIR_WIDTH_BASE - 1e-9)
  assert.ok(hubPairStrokeWidth(-5) >= GRAPH_HUB_PAIR_WIDTH_BASE - 1e-9)
})
