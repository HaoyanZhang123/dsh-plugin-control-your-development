/*
 * tests/ui-map/scene-restart.test.ts —— **视图身份变化 = 全新入场（生长）**（P3 修复）。
 *
 * ## 真机反馈（第三次，这次是语义问题）
 *
 * > 「这个还是不对，我是希望关系线和节点一起**生长出来**，
 * >   而不是提前预订好的那样**转场进入**。」
 *
 * ## 根因（不是两条路径，而是 key 重合度）
 *
 * `interpolateNodeFrames` 的语义是「同一 key 在 `previous` 里存在 → 从旧坐标滑到新坐标」。
 * - **切目录**：多数文件不在旧图里 → 走"新节点"分支（从 origin 长出）→ 像生长；
 * - **切轮次**：文件几乎完全相同、只有 ops 变 → 几乎全部命中旧 key → 全是滑动 → 像转场。
 *
 * 于是两种模式观感不同，原因只是 key 重合度不同。
 *
 * ## 修复
 *
 * `SceneClockOptions.restartOn`（视图身份：轮次号 / 目录路径）。**值变化时**
 * 把起点快照换成**空 Map**，仍走同一个 `interpolateNodeFrames`：
 * 空快照 ⇒ 每个 key 都命中"新节点"分支 ⇒ 从 `enterOrigin()` lerp 到目标 = 生长。
 *
 * ## 这条套件守什么
 *
 * 1. `restartOn` 变化 → 同 key 在 p=0 位于 **origin**（不是 T1 的旧坐标）；
 * 2. 进度递增时**单调**靠近目标；p=1 与目标逐字段相等；
 * 3. **反向**：不重置快照时，同 key 从 T1 坐标起步（一旦有人删掉 restartOn 逻辑就红）；
 * 4. **同视图内不退化**：`restartOn` 不变时仍是"旧位置→新位置"插值。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  easeLayout,
  enterOrigin,
  interpolateNodeFrames,
  sceneStartFrames,
  type NodeFrame,
} from '../../src/client/ui/map/index.ts'
import {
  layoutFileGraph,
  nodeFramesOfGraph,
  type GraphLayout,
  type GraphSourceFile,
} from '../../src/client/ui/map/index.ts'

const SIZE = { width: 680, height: 420 }
const SAMPLES = [0, 0.25, 0.5, 0.75, 1] as const

function source(path: string, ops: number): GraphSourceFile {
  return {
    path,
    name: path.slice(path.lastIndexOf('/') + 1),
    dir: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '',
    family: 'code',
    ops,
    firstAt: 900,
    lastAt: 1000,
  }
}

/** 同一批文件、ops 倒序 → 中心/环位重排（坐标全变，但 path 集合相同）。 */
function twoTurnLayouts(): { t1: GraphLayout; t2: GraphLayout } {
  const files = [
    source('src/a.ts', 40),
    source('src/b.ts', 30),
    source('src/c.ts', 22),
    source('docs/guide.md', 16),
    source('docs/api.md', 12),
    source('tools/run.ts', 8),
  ]
  const t1 = layoutFileGraph(files, { ...SIZE, mode: 'turn' })
  const reversed = files
    .slice()
    .reverse()
    .map((file, index) => ({ ...file, ops: 40 - index * 6 }))
  const t2 = layoutFileGraph(reversed, { ...SIZE, mode: 'turn' })
  return { t1, t2 }
}

/**
 * 起点快照的决策直接调**产品导出的那条规则**（`sceneStartFrames`），
 * 不在测试里复制一份 —— 复制品一旦与产品漂移，测试就会"绿着说谎"。
 */
function previousSnapshot(restartOnChanged: boolean, visible: Map<string, NodeFrame>): Map<string, NodeFrame> {
  return sceneStartFrames(restartOnChanged, visible)
}

/* ================================================================== *
 * 1. 核心：restartOn 变化 = 从 origin 生长
 * ================================================================== */

test('restartOn 变化后：同一 key 在 p=0 位于 origin（不是 T1 的旧坐标）', () => {
  const { t1, t2 } = twoTurnLayouts()
  const visible = nodeFramesOfGraph(t1)
  const next = nodeFramesOfGraph(t2)
  const origin = enterOrigin(t2)

  /* 夹具自检：T1 与 T2 里同一 key 的坐标必须不同，否则测不出"从哪儿起步"。 */
  const moved = [...next.entries()].filter(([key, frame]) => {
    const before = visible.get(key)
    return before !== undefined && (Math.abs(before.x - frame.x) > 1 || Math.abs(before.y - frame.y) > 1)
  })
  assert.ok(moved.length > 0, 'T1→T2 必须真的有节点位移（否则本测试空转）')

  const frames = interpolateNodeFrames(previousSnapshot(true, visible), next, 0, origin)
  for (const [key, frame] of next) {
    const at = frames.get(key)
    assert.ok(at !== undefined, 'p=0 必须包含每个目标节点：' + key)
    assert.equal(at.x, origin.x, key + ' 在 p=0 必须位于 origin.x（不是 T1 坐标）')
    assert.equal(at.y, origin.y, key + ' 在 p=0 必须位于 origin.y（不是 T1 坐标）')
  }
})

test('progress 递增时单调靠近目标（生长，不是瞬移）', () => {
  const { t1, t2 } = twoTurnLayouts()
  const visible = nodeFramesOfGraph(t1)
  const next = nodeFramesOfGraph(t2)
  const origin = enterOrigin(t2)

  const distanceTo = (frames: Map<string, NodeFrame>, key: string, target: NodeFrame): number => {
    const at = frames.get(key)
    assert.ok(at !== undefined)
    return Math.hypot(at.x - target.x, at.y - target.y)
  }

  for (const [key, target] of next) {
    let last = Number.POSITIVE_INFINITY
    for (const progress of SAMPLES) {
      const frames = interpolateNodeFrames(previousSnapshot(true, visible), next, easeLayout(progress), origin)
      const distance = distanceTo(frames, key, target)
      assert.ok(distance <= last + 0.01, key + ' 在 p=' + String(progress) + ' 必须单调靠近目标')
      last = distance
    }
    assert.equal(last, 0, key + ' 到终点必须与目标重合')
  }
})

test('p=1 与目标逐字段相等（含半径）', () => {
  const { t1, t2 } = twoTurnLayouts()
  const visible = nodeFramesOfGraph(t1)
  const next = nodeFramesOfGraph(t2)
  const origin = enterOrigin(t2)
  const frames = interpolateNodeFrames(previousSnapshot(true, visible), next, 1, origin)
  for (const [key, frame] of next) {
    const at = frames.get(key)
    assert.ok(at !== undefined)
    assert.equal(at.x, frame.x, 'p=1 x 必须精确：' + key)
    assert.equal(at.y, frame.y, 'p=1 y 必须精确：' + key)
    assert.equal(at.r, frame.r, 'p=1 r 必须精确：' + key)
  }
})

/* ================================================================== *
 * 2. 反向：不重置快照 ⇒ 从 T1 坐标起步（删掉 restartOn 就红）
 * ================================================================== */

test('反向：**不**重置快照时，同一 key 从 T1 坐标起步（证明 restartOn 真的在起作用）', () => {
  const { t1, t2 } = twoTurnLayouts()
  const visible = nodeFramesOfGraph(t1)
  const next = nodeFramesOfGraph(t2)
  const origin = enterOrigin(t2)

  const frames = interpolateNodeFrames(previousSnapshot(false, visible), next, 0, origin)

  /* 这里必须看到"旧的滑动语义"：至少有一个 key 停在 T1 的坐标。 */
  let anchoredAtOldPosition = 0
  for (const [key, frame] of next) {
    const before = visible.get(key)
    if (before === undefined) continue
    if (Math.abs(before.x - frame.x) < 1 && Math.abs(before.y - frame.y) < 1) continue
    const at = frames.get(key)
    assert.ok(at !== undefined)
    assert.equal(at.x, before.x, key + ' 未重置时必须从 T1 的 x 起步')
    assert.equal(at.y, before.y, key + ' 未重置时必须从 T1 的 y 起步')
    anchoredAtOldPosition += 1
  }
  assert.ok(anchoredAtOldPosition > 0, '必须有节点体现"从旧位置滑"的语义（否则反向断言空转）')

  /*
   * 与"重置"形态的**关键区别**：未重置时整体起点就是 T1 的分布，
   * 而不是"全部堆在画布中心"。用"有多少节点不在 origin"来量：
   * 重置语义下所有节点都在 origin；未重置时只有**本来就在中心**的那个节点在 origin。
   *
   * （不能对单个节点断言"不得位于 origin"：径向布局的中心节点 T1/T2 都在画布中心，
   *   它本来就该在那里 —— 早先那版断言就是在这里误报的。）
   */
  const atOriginCount = [...next.keys()].filter((key) => {
    const at = frames.get(key)
    return at !== undefined && Math.abs(at.x - origin.x) < 0.01 && Math.abs(at.y - origin.y) < 0.01
  }).length
  const restartedFrames = interpolateNodeFrames(previousSnapshot(true, visible), next, 0, origin)
  assert.ok(atOriginCount < next.size, '未重置时不得所有节点都堆在 origin')
  assert.equal(
    [...restartedFrames.keys()].filter((key) => {
      const at = restartedFrames.get(key)
      return at !== undefined && Math.abs(at.x - origin.x) < 0.01 && Math.abs(at.y - origin.y) < 0.01
    }).length,
    next.size,
    '重置时所有节点都必须在 origin（这才是"生长"）',
  )
})

test('对照：同一组数据，重置 vs 不重置在 p=0 的起点**不同**', () => {
  const { t1, t2 } = twoTurnLayouts()
  const visible = nodeFramesOfGraph(t1)
  const next = nodeFramesOfGraph(t2)
  const origin = enterOrigin(t2)

  const restarted = interpolateNodeFrames(previousSnapshot(true, visible), next, 0, origin)
  const continued = interpolateNodeFrames(previousSnapshot(false, visible), next, 0, origin)

  const key = [...next.keys()].find((candidate) => {
    const before = visible.get(candidate)
    const after = next.get(candidate)
    return before !== undefined && after !== undefined && (Math.abs(before.x - after.x) > 1 || Math.abs(before.y - after.y) > 1)
  })
  assert.ok(key !== undefined, '必须存在位移节点')

  assert.equal(restarted.get(key)?.x, origin.x, '重置后应在 origin')
  assert.notEqual(continued.get(key)?.x, origin.x, '不重置时应不在 origin')
  assert.notEqual(restarted.get(key)?.x, continued.get(key)?.x, '两种语义的起点必须不同')
})

/* ================================================================== *
 * 3. 同视图内不退化（restartOn 不变）
 * ================================================================== */

test('restartOn 不变时：同一 key 仍是「旧位置→新位置」插值（不是每次都从中心重来）', () => {
  const { t1, t2 } = twoTurnLayouts()
  const visible = nodeFramesOfGraph(t1)
  const next = nodeFramesOfGraph(t2)
  const origin = enterOrigin(t2)

  /* 视图身份没变 → 走"继续插值"分支（previousSnapshot(false, …)）。 */
  const half = interpolateNodeFrames(previousSnapshot(false, visible), next, 0.5, origin)

  let checked = 0
  for (const [key, target] of next) {
    const before = visible.get(key)
    if (before === undefined) continue
    if (Math.abs(before.x - target.x) < 1 && Math.abs(before.y - target.y) < 1) continue
    const at = half.get(key)
    assert.ok(at !== undefined)
    const wantX = Math.round(((before.x + target.x) / 2) * 100) / 100
    const wantY = Math.round(((before.y + target.y) / 2) * 100) / 100
    assert.equal(at.x, wantX, key + ' 同视图内的中点必须是两端平均')
    assert.equal(at.y, wantY, key + ' 同视图内的中点必须是两端平均')
    checked += 1
  }
  assert.ok(checked > 0, '必须有节点真的移动过')
})

test('同视图内 new key 仍然从 origin 长出（与重启语义互不干扰）', () => {
  const { t1 } = twoTurnLayouts()
  const visible = nodeFramesOfGraph(t1)
  const more = [
    source('src/a.ts', 40),
    source('src/b.ts', 30),
    source('src/c.ts', 22),
    source('docs/guide.md', 16),
    source('docs/api.md', 12),
    source('tools/run.ts', 8),
    source('src/newcomer.ts', 4),
  ]
  const next = nodeFramesOfGraph(layoutFileGraph(more, { ...SIZE, mode: 'turn' }))
  const origin = enterOrigin({ width: SIZE.width, height: SIZE.height })

  const frames = interpolateNodeFrames(previousSnapshot(false, visible), next, 0, origin)
  const newcomer = frames.get('src/newcomer.ts')
  assert.ok(newcomer !== undefined, '新节点必须出现在帧里')
  assert.equal(newcomer.x, origin.x, '新节点必须从 origin 起步')
  assert.equal(newcomer.y, origin.y, '新节点必须从 origin 起步')
})
