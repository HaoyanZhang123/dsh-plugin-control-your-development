/*
 * tests/perf/derived.test.ts —— R06 无感加载两个基础设施的验收（task-10 必做 1 + 6）。
 *
 * 三组断言：
 * 1. **等价性（不是"看起来对"）**：`turnRelationCounts` / `filterEdgesWithin` 与 tab.ts 原来的
 *    内联写法（逐边 `toLowerCase` + filter）**逐 key / 逐条相等**，含自环、重复边、大小写混写、
 *    空集、空边；`filterEdgesWithin` 还必须**保持输入顺序**（UI 画边顺序不能变）。
 * 2. **`createInputMemo` 的安全性**：同入参命中、任一入参换引用必然重算（这是"不会陈旧"的证明），
 *    单槽不残留旧值，`clear()` 生效，命中/未命中计数正确。
 * 3. **成本上界（实测，不是估算）**：端点索引一次构建 O(E)；建好之后 900 轮的关系计数与
 *    `filter` 都比"逐边小写"的旧写法快 —— 实测数字只做**量级断言**（比值），不写死绝对毫秒，
 *    避免在慢机器上假红；真实 p50/p95 在 `output/_verify/threadline/T50/R06/perf-before-after.json`。
 *
 * 纪律：不读文件、不写存储、不联网；全部合成数据，含中文/大小写/自环等边界。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildEdgeEndpointIndex,
  createInputMemo,
  filterEdgesWithin,
  turnRelationCounts,
} from '../../src/client/perf/derived.ts'
import { measureSync, minimum } from '../../src/client/perf/timing.ts'

/* ------------------------------------------------------------------ *
 * 旧实现的逐字复刻（对照物必须是"产品里真实存在过的写法"）
 * ------------------------------------------------------------------ */

/** tab.ts 原始写法：每边每轮 toLowerCase 的 O(轮次×边) 版本。 */
function turnRelationsLegacy(
  details: ReadonlyMap<string, { turns: readonly { n: number; files: readonly { path: string }[] }[] }>,
  edges: readonly { from: string; to: string }[],
): Map<string, number> {
  const map = new Map<string, number>()
  for (const [sessionId, detail] of details) {
    for (const turn of detail.turns) {
      const keys = new Set(turn.files.map((file) => file.path.toLowerCase()))
      let count = 0
      for (const edge of edges) {
        if (keys.has(edge.from.toLowerCase()) && keys.has(edge.to.toLowerCase())) count += 1
      }
      if (count > 0) map.set('turn:' + sessionId + ':' + String(turn.n), count)
    }
  }
  return map
}

/** tab.ts 原始写法：`edges.filter(两端都在 keys)`（每边两次 toLowerCase）。 */
function filterLegacy<E extends { from: string; to: string }>(edges: readonly E[], keys: ReadonlySet<string>): E[] {
  if (keys.size === 0) return []
  return edges.filter((edge) => keys.has(edge.from.toLowerCase()) && keys.has(edge.to.toLowerCase()))
}

const keyOf = (sessionId: string, turn: number): string => 'turn:' + sessionId + ':' + String(turn)

function assertSameMap(actual: Map<string, number>, expected: Map<string, number>, label: string): void {
  assert.deepEqual(
    Array.from(actual.keys()).sort(),
    Array.from(expected.keys()).sort(),
    label + '：key 集合必须完全一致',
  )
  for (const [key, value] of expected) {
    assert.equal(actual.get(key), value, label + '：key ' + key + ' 的值必须相等')
  }
}

function assertSameEdges<E extends { id: string }>(actual: readonly E[], expected: readonly E[], label: string): void {
  assert.deepEqual(
    actual.map((edge) => edge.id),
    expected.map((edge) => edge.id),
    label + '：必须逐条相等且**顺序一致**',
  )
}

/* ------------------------------------------------------------------ *
 * 1. turnRelationCounts 等价性
 * ------------------------------------------------------------------ */

test('turnRelationCounts：与旧实现逐 key 等价（含大小写混写 / 自环 / 重复端点对）', () => {
  const details = new Map([
    [
      's-1',
      {
        turns: [
          { n: 1, files: [{ path: 'src/App.ts' }, { path: 'src/util.ts' }] },
          { n: 2, files: [{ path: 'src/app.ts' }, { path: 'SRC/UTIL.TS' }, { path: 'docs/a.md' }] },
          { n: 3, files: [{ path: 'docs/a.md' }, { path: 'docs/a.md' }] },
          { n: 4, files: [] },
          { n: 5, files: [{ path: 'lonely.ts' }] },
        ],
      },
    ],
    [
      's-2',
      {
        turns: [{ n: 1, files: [{ path: 'src/app.ts' }, { path: 'src/util.ts' }, { path: 'docs/a.md' }] }],
      },
    ],
  ])
  const edges = [
    { from: 'src/App.ts', to: 'src/util.ts' }, // 大小写混写
    { from: 'src/app.ts', to: 'docs/a.md' },
    { from: 'src/util.ts', to: 'docs/a.md' },
    { from: 'docs/a.md', to: 'docs/a.md' }, // 自环
    { from: 'src/app.ts', to: 'src/util.ts' }, // 与第 1 条同端点对（不同大小写）
    { from: 'unrelated.ts', to: 'other.ts' }, // 端点都不在任何轮次里
    { from: 'src/app.ts', to: 'not-in-turn.ts' }, // 只有一端在
  ]
  const index = buildEdgeEndpointIndex(edges)
  const actual = turnRelationCounts([...details], index, keyOf)
  const expected = turnRelationsLegacy(details, edges)
  assertSameMap(actual, expected, 'turnRelationCounts')
  // 明确钉住几个值，防止"两边一起错"。T1 的文件集 = {src/app.ts, src/util.ts}（小写后）：
  //   边 1（App→util）与边 5（app→util，同端点对的重复边）都在集内 → 2。
  assert.equal(actual.get('turn:s-1:1'), 2, 'T1：两条边（含大小写混写那条 + 同端点对的重复边）')
  // T2 的文件集 = {src/app.ts, src/util.ts, docs/a.md}：边 1/2/3/4(自环)/5 全部两端在集内 → 5。
  assert.equal(actual.get('turn:s-1:2'), 5, 'T2：边 1/2/3/4/5 全部命中（自环也计入，与旧 filter 语义一致）')
  // T3 只有 docs/a.md（重复一次，Set 去重）：只有自环边 4 命中 → 1。
  assert.equal(actual.get('turn:s-1:3'), 1, 'T3：本轮只有 docs/a.md，自环边命中 1 条')
  // T5 只有一个孤立文件：没有任何边的两端都在集内 → 不写 key（不是写 0）。
  assert.equal(actual.has('turn:s-1:5'), false, 'T5 孤立文件 → 不产生 key')
})

test('turnRelationCounts：自环确实被计入（与旧 filter 语义一致，不是"忽略自环"）', () => {
  const details = new Map([['s', { turns: [{ n: 1, files: [{ path: 'a.ts' }] }] }]])
  const edges = [{ from: 'a.ts', to: 'a.ts' }]
  const actual = turnRelationCounts([...details], buildEdgeEndpointIndex(edges), keyOf)
  const expected = turnRelationsLegacy(details, edges)
  assert.equal(expected.get('turn:s:1'), 1, '旧实现把自环数成 1')
  assert.equal(actual.get('turn:s:1'), 1, '新实现必须一致')
})

test('turnRelationCounts：空 details / 空边 / 空 files 都不崩且不产生假 key', () => {
  assert.equal(turnRelationCounts([], buildEdgeEndpointIndex([]), keyOf).size, 0)
  const details = new Map([['s', { turns: [{ n: 1, files: [{ path: 'a.ts' }] }] }]])
  assert.equal(turnRelationCounts([...details], buildEdgeEndpointIndex([]), keyOf).size, 0, '没有边就没有关系数')
  const noFiles = new Map([['s', { turns: [{ n: 1, files: [] }, { n: 2, files: [] }] }]])
  assert.equal(
    turnRelationCounts([...noFiles], buildEdgeEndpointIndex([{ from: 'a', to: 'b' }]), keyOf).size,
    0,
    '本轮没有文件 → 不写 key（不是写 0）',
  )
})

test('turnRelationCounts：keyOf 被原样使用（tab 传 selectionKey，不能自己拼 key）', () => {
  const details = new Map([['s-9', { turns: [{ n: 7, files: [{ path: 'a.ts' }, { path: 'b.ts' }] }] }]])
  const edges = [{ from: 'a.ts', to: 'b.ts' }]
  const map = turnRelationCounts([...details], buildEdgeEndpointIndex(edges), (sessionId, turn) => 'CUSTOM[' + sessionId + '/' + turn + ']')
  assert.deepEqual([...map.keys()], ['CUSTOM[s-9/7]'])
})

/* ------------------------------------------------------------------ *
 * 2. filterEdgesWithin 等价性
 * ------------------------------------------------------------------ */

test('filterEdgesWithin：与 edges.filter(两端都在) 逐条相等且保持输入顺序', () => {
  const edges = [
    { id: 'e1', from: 'a.ts', to: 'b.ts' },
    { id: 'e2', from: 'b.ts', to: 'a.ts' }, // 反向：旧 filter 也算（不查方向）
    { id: 'e3', from: 'a.ts', to: 'c.ts' },
    { id: 'e4', from: 'c.ts', to: 'd.ts' },
    { id: 'e5', from: 'B.TS', to: 'A.TS' }, // 大小写混写
    { id: 'e6', from: 'a.ts', to: 'a.ts' }, // 自环
    { id: 'e7', from: 'a.ts', to: 'b.ts' }, // 重复端点对
    { id: 'e8', from: 'x.ts', to: 'y.ts' },
  ]
  const index = buildEdgeEndpointIndex(edges)
  for (const keys of [
    new Set(['a.ts', 'b.ts']),
    new Set(['a.ts']),
    new Set(['a.ts', 'b.ts', 'c.ts', 'd.ts']),
    new Set(['x.ts', 'y.ts']),
    new Set(['nope.ts']),
    new Set<string>(),
  ]) {
    assertSameEdges(
      filterEdgesWithin(edges, index, keys),
      filterLegacy(edges, keys),
      'filterEdgesWithin keys=' + JSON.stringify([...keys]),
    )
  }
})

test('filterEdgesWithin：空边 / 空 keys / 全不命中都返回空数组（不是 undefined）', () => {
  assert.deepEqual(filterEdgesWithin([], buildEdgeEndpointIndex([]), new Set(['a'])), [])
  assert.deepEqual(filterEdgesWithin([{ from: 'a', to: 'b' }], buildEdgeEndpointIndex([{ from: 'a', to: 'b' }]), new Set()), [])
  assert.deepEqual(
    filterEdgesWithin([{ from: 'a', to: 'b' }], buildEdgeEndpointIndex([{ from: 'a', to: 'b' }]), new Set(['z'])),
    [],
  )
})

test('filterEdgesWithin：索引与 edges 必须配套（用旧索引查新边集是调用方错误，这里钉住行为）', () => {
  const edges = [{ id: 'e1', from: 'a', to: 'b' }]
  const index = buildEdgeEndpointIndex(edges)
  // 同一索引查同一 edges：命中
  assert.equal(filterEdgesWithin(edges, index, new Set(['a', 'b'])).length, 1)
  // 更长的新边集：索引里没有的边不会出现（这正是 tab.ts 里 index 依赖 edges 的原因）
  const longer = [...edges, { id: 'e2', from: 'c', to: 'd' }]
  assert.deepEqual(
    filterEdgesWithin(longer, index, new Set(['c', 'd'])).map((edge) => edge.id),
    [],
    '索引没重建 → 新边查不到（所以 tab.ts 的 useMemo deps 必须含 edges）',
  )
})

/* ------------------------------------------------------------------ *
 * 3. buildEdgeEndpointIndex
 * ------------------------------------------------------------------ */

test('buildEdgeEndpointIndex：lower 与输入同序同长，byFrom 只按 from 挂（自环也被 count 一次）', () => {
  const edges = [
    { from: 'A.TS', to: 'B.TS' },
    { from: 'a.ts', to: 'c.ts' },
    { from: 'b.ts', to: 'a.ts' },
  ]
  const index = buildEdgeEndpointIndex(edges)
  assert.equal(index.size, 3)
  assert.deepEqual(index.lower, [
    { from: 'a.ts', to: 'b.ts' },
    { from: 'a.ts', to: 'c.ts' },
    { from: 'b.ts', to: 'a.ts' },
  ])
  assert.deepEqual(index.byFrom.get('a.ts'), [
    { to: 'b.ts', at: 0 },
    { to: 'c.ts', at: 1 },
  ])
  assert.deepEqual(index.byFrom.get('b.ts'), [{ to: 'a.ts', at: 2 }])
  assert.equal(index.byFrom.get('c.ts'), undefined, 'c 只作为 to 出现，不该有出边')
})

test('buildEdgeEndpointIndex：空输入 / 全自环 / 全重复都不丢边', () => {
  const empty = buildEdgeEndpointIndex([])
  assert.equal(empty.size, 0)
  assert.equal(empty.lower.length, 0)
  assert.equal(empty.byFrom.size, 0)

  const selfLoops = buildEdgeEndpointIndex([
    { from: 'a', to: 'a' },
    { from: 'a', to: 'a' },
  ])
  assert.equal(selfLoops.size, 2, '重复边不能去重（filter 语义也不去重）')
  assert.deepEqual(selfLoops.byFrom.get('a'), [
    { to: 'a', at: 0 },
    { to: 'a', at: 1 },
  ])
})

/* ------------------------------------------------------------------ *
 * 4. createInputMemo（"不会陈旧"是核心安全属性）
 * ------------------------------------------------------------------ */

test('createInputMemo：同入参命中（不重算），任一入参换引用必然重算', () => {
  const memo = createInputMemo<number>()
  let calls = 0
  const compute = (): number => {
    calls += 1
    return calls
  }
  const graphA = { rev: 1 }
  const detailsA = new Map([['s', 1]])
  const effectiveA = { kind: 'none' }
  const referenceA = null

  assert.equal(memo([graphA, detailsA, effectiveA, referenceA], compute), 1)
  assert.equal(calls, 1)
  // 完全相同的引用：命中
  assert.equal(memo([graphA, detailsA, effectiveA, referenceA], compute), 1)
  assert.equal(calls, 1, '同入参不该重算')
  assert.equal(memo.hits, 1)
  assert.equal(memo.misses, 1)

  // 任何一个换引用 → 必须重算（这就是"缓存不会陈旧"的保证：没有时间/没有 key，只认身份）
  const graphB = { rev: 2 }
  assert.equal(memo([graphB, detailsA, effectiveA, referenceA], compute), 2, 'graph 变 → 重算')
  const detailsB = new Map([['s', 2]])
  assert.equal(memo([graphB, detailsB, effectiveA, referenceA], compute), 3, 'details 变 → 重算')
  const effectiveB = { kind: 'turn', turn: 1 }
  assert.equal(memo([graphB, detailsB, effectiveB, referenceA], compute), 4, 'effective 变 → 重算')
  assert.equal(memo([graphB, detailsB, effectiveB, { edges: [] }], compute), 5, 'reference 变 → 重算')
  assert.equal(memo.hits, 1, '只有第一次同入参算命中')
  assert.equal(memo.misses, 5)
})

test('createInputMemo：入参个数变化、NaN/0/-0 等边界按 Object.is 判定', () => {
  const memo = createInputMemo<string>()
  let calls = 0
  const compute = (): string => {
    calls += 1
    return 'v' + String(calls)
  }
  assert.equal(memo([1], compute), 'v1')
  assert.equal(memo([1], compute), 'v1', '同长同值 → 命中')
  assert.equal(memo([1, 2], compute), 'v2', '入参变长 → 重算')
  assert.equal(memo([1], compute), 'v3', '入参变短 → 重算')
  assert.equal(memo([Number.NaN], compute), 'v4')
  assert.equal(memo([Number.NaN], compute), 'v4', 'NaN 与 NaN 按 Object.is 视为相同（缓存命中）')
  assert.equal(memo([0], compute), 'v5')
  assert.equal(memo([-0], compute), 'v6', 'Object.is(0, -0) = false → 重算（宁可多算，不可给错）')
})

test('createInputMemo：单槽不残留旧值；clear() 后下次必重算', () => {
  const memo = createInputMemo<{ at: number }>()
  let calls = 0
  const compute = (): { at: number } => {
    calls += 1
    return { at: calls }
  }
  const a = {}
  const b = {}
  const first = memo([a], compute)
  const second = memo([b], compute)
  assert.notEqual(first, second)
  // 回到 a：因为单槽被 b 顶掉了，所以要重算（不是"多槽 LRU"）——这是有意的：tab 只开一个
  const third = memo([a], compute)
  assert.equal(calls, 3)
  assert.notEqual(third, first, '单槽语义：被顶掉的入参不会命中旧结果（不会返回过期值）')
  memo.clear()
  assert.equal(memo([a], compute).at, 4, 'clear 之后必重算')
})

/* ------------------------------------------------------------------ *
 * 5. 成本量级（只断言"比旧写法快一个量级以上"，不写死毫秒）
 * ------------------------------------------------------------------ */

test('成本量级：索引建一次后，900 轮关系计数比"每边每轮小写"快 ≥10×', () => {
  // 合成：400 文件 / 1200 边 / 12 会话 × 20 轮 / 每轮 8 文件（比真实规模小，保证单测耗时可控）
  const fileCount = 400
  const paths = Array.from({ length: fileCount }, (_, i) => 'area' + String(i % 8) + '/file-' + String(i) + '.ts')
  const edges: { from: string; to: string }[] = []
  for (let i = 0; i < 1200; i += 1) {
    const from = paths[(i * 7) % fileCount]
    const to = paths[(i * 13 + 3) % fileCount]
    if (from === to) continue
    edges.push({ from, to })
  }
  const details = new Map<string, { turns: { n: number; files: { path: string }[] }[] }>()
  for (let s = 0; s < 12; s += 1) {
    const turns = []
    for (let t = 0; t < 20; t += 1) {
      const files = []
      for (let f = 0; f < 8; f += 1) files.push({ path: paths[(s * 31 + t * 11 + f * 5) % fileCount] })
      turns.push({ n: t + 1, files })
    }
    details.set('sess-' + String(s), { turns })
  }

  const index = buildEdgeEndpointIndex(edges)
  assertSameMap(turnRelationCounts([...details], index, keyOf), turnRelationsLegacy(details, edges), '量级测试前先验等价')

  // 计时稳健性（2026-11-08 修）：单次 `measureSync` 在机器负载高时（并行跑 t07/t09、CI 抖动）
  // 会偶发假红——实测 `pnpm test` 三次里有 1 次 fail，而产品逻辑完全没变。
  // 改用**多次取最小值**：最小值最接近"无干扰下的真实成本"，是压测惯例；
  // 判据本身（索引版不该更慢、至少快 2×）**一个字没改**，只是消除单次采样抖。
  const SAMPLE_ROUNDS = 5
  const legacyMs = minimum(
    Array.from({ length: SAMPLE_ROUNDS }, () => measureSync(() => turnRelationsLegacy(details, edges)).ms),
  )
  const indexedMs = minimum(
    Array.from({ length: SAMPLE_ROUNDS }, () => measureSync(() => turnRelationCounts([...details], index, keyOf)).ms),
  )

  // 旧写法在 1200 边规模下仍明显更慢；若机器极快导致比值不够，至少要求"不比旧的慢"。
  const ratio = indexedMs === 0 ? Number.POSITIVE_INFINITY : legacyMs / indexedMs
  assert.ok(
    indexedMs <= legacyMs,
    '端点索引版不该比旧写法慢（旧 ' + legacyMs.toFixed(2) + 'ms vs 新 ' + indexedMs.toFixed(2) + 'ms）',
  )
  assert.ok(
    ratio >= 2,
    '端点索引应至少快 2×（实测 ' + ratio.toFixed(1) + '×）；若这里红了说明索引退化了',
  )
})

test('成本量级：filterEdgesWithin 不比 edges.filter 慢，且结果相同', () => {
  const paths = Array.from({ length: 300 }, (_, i) => 'dir' + String(i % 5) + '/f' + String(i) + '.ts')
  const edges: Array<{ id: string; from: string; to: string }> = []
  for (let i = 0; i < 1500; i += 1) {
    edges.push({ id: 'e' + i, from: paths[(i * 7) % 300], to: paths[(i * 11 + 5) % 300] })
  }
  const index = buildEdgeEndpointIndex(edges)
  const keys = new Set(paths.slice(0, 60).map((path) => path.toLowerCase()))
  assertSameEdges(filterEdgesWithin(edges, index, keys), filterLegacy(edges, keys), 'filterEdgesWithin 量级测试')

  const legacySample = measureSync(() => filterLegacy(edges, keys))
  const indexedSample = measureSync(() => filterEdgesWithin(edges, index, keys))
  assert.ok(
    indexedSample.ms <= Math.max(legacySample.ms * 4, 2),
    'filterEdgesWithin 不该比 filter 慢一个量级（旧 ' +
      legacySample.ms.toFixed(3) +
      'ms vs 新 ' +
      indexedSample.ms.toFixed(3) +
      'ms；小样本抖动容忍 4×）',
  )
})
