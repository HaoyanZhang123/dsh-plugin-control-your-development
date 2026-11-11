/*
 * tests/ui-map/edge-sync.test.ts —— 关系线必须跟着节点一起动（1.5.4）。
 *
 * 真机反馈：「现在动画有了，但是都是节点动，线早就在位置上等着了，我要同步优美的动画」。
 *
 * 根因（实测得出，不是推断）：
 * - `<line>` 的 `x1/y1/x2/y2` 是**表现属性**，Chrome 不对它们做 CSS transition
 *   （探针实测：写 `transition: x1 …` 后改属性，70ms 就已经是终点值，
 *    `getComputedStyle(line).x1` 返回空串）；
 * - 用 `<g transform>` 能动画，但只能表达平移，端点分别移动时线长变化表达不了。
 *
 * 所以必须逐帧写属性。这条套件守：
 * 1. 插值器能读到/写回端点；
 * 2. 中途读到的确实是**中间值**（不是直接跳到终点）；
 * 3. 结束写回精确终点（不留浮点残差）；
 * 4. reduced-motion / 拖动中直接跳（不做动画）；
 * 5. FolderMap 真的接了这个插值器（不是写了函数没人用）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PLUGIN_ROOT } from '../harness/styles-codegen.ts'
import { readEdgeFrames, syncEdges } from '../../src/client/ui/map/edgeSync.ts'

/* ---------- 极小的 SVG 假件（不引第三方，也不依赖 DOM 实现） ---------- */

type Frame = (time: number) => void

class FakeLine {
  attrs = new Map<string, string>()
  constructor(init: Record<string, string | number>) {
    for (const [key, value] of Object.entries(init)) this.attrs.set(key, String(value))
  }
  getAttribute(name: string): string | null {
    return this.attrs.has(name) ? (this.attrs.get(name) as string) : null
  }
  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value)
  }
}

function makeRoot(lines: readonly FakeLine[]): ParentNode {
  return {
    querySelectorAll(selector: string) {
      assert.equal(selector, 'line.tl-graph-edge', '只应查询图的边（不要误抓别的 line）')
      return lines
    },
  } as unknown as ParentNode
}

/** 手动的 rAF：把排队的回调存起来，由测试决定何时推进。 */
function makeScheduler() {
  const queue = new Map<number, Frame>()
  let next = 1
  return {
    schedule(callback: Frame): number {
      const id = next
      next += 1
      queue.set(id, callback)
      return id
    },
    cancel(id: number): void {
      queue.delete(id)
    },
    /** 推进一次：把所有排队的回调以给定时间执行。 */
    tick(time: number): void {
      const pending = [...queue.entries()]
      queue.clear()
      for (const [, callback] of pending) callback(time)
    },
    get size(): number {
      return queue.size
    },
  }
}

test('readEdgeFrames 读得出普通边与枢纽边的端点', () => {
  const root = makeRoot([
    new FakeLine({ 'data-edge-id': 'e1', x1: 1, y1: 2, x2: 3, y2: 4 }),
    new FakeLine({ 'data-hub-edge-hub': 'src', 'data-hub-edge-file': 'src/a.ts', x1: 5, y1: 6, x2: 7, y2: 8 }),
  ])
  const frames = readEdgeFrames(root)
  assert.equal(frames.size, 2)
  assert.deepEqual(frames.get('e1'), { key: 'e1', x1: 1, y1: 2, x2: 3, y2: 4 })
  assert.equal(frames.get('hub:src\u0000src/a.ts')?.x1, 5)
})

test('syncEdges 中途写的是中间值，结束时写回精确终点', () => {
  const line = new FakeLine({ 'data-edge-id': 'e1', x1: 100, y1: 100, x2: 200, y2: 200 })
  const root = makeRoot([line])
  /* 上一帧在 (0,0)-(50,50)，现在 DOM 里已经是 (100,100)-(200,200)。 */
  const previous = new Map([['e1', { key: 'e1', x1: 0, y1: 0, x2: 50, y2: 50 }]])
  const scheduler = makeScheduler()
  const done = []

  syncEdges(root, previous, { durationMs: 200, onDone: () => done.push(true) }, scheduler.schedule, scheduler.cancel)

  /* 第一帧之前：线被钉回旧位置（否则会先闪到新位置再动画回去）。 */
  assert.equal(line.getAttribute('x1'), '0', '必须先把线拉回旧坐标')

  scheduler.tick(0) // 起始帧
  scheduler.tick(100) // 一半
  const midX1 = Number(line.getAttribute('x1'))
  assert.ok(midX1 > 0 && midX1 < 100, '一半时间应处于中间值，实际 ' + midX1)

  scheduler.tick(200) // 结束
  assert.equal(line.getAttribute('x1'), '100', '结束必须写回精确终点')
  assert.equal(line.getAttribute('y1'), '100')
  assert.equal(line.getAttribute('x2'), '200')
  assert.equal(line.getAttribute('y2'), '200')
  assert.equal(done.length, 1, 'onDone 必须回调一次')
})

test('端点没变的边不参与插值（不浪费帧）', () => {
  const line = new FakeLine({ 'data-edge-id': 'e1', x1: 10, y1: 10, x2: 20, y2: 20 })
  const root = makeRoot([line])
  const previous = new Map([['e1', { key: 'e1', x1: 10, y1: 10, x2: 20, y2: 20 }]])
  const scheduler = makeScheduler()
  let finished = false
  syncEdges(root, previous, { durationMs: 200, onDone: () => (finished = true) }, scheduler.schedule, scheduler.cancel)
  assert.equal(finished, true, '没有需要动的边时应立刻完成')
  assert.equal(scheduler.size, 0, '不应排任何动画帧')
})

test('durationMs <= 0（reduced-motion）直接跳，不排帧', () => {
  const line = new FakeLine({ 'data-edge-id': 'e1', x1: 100, y1: 100, x2: 200, y2: 200 })
  const root = makeRoot([line])
  const previous = new Map([['e1', { key: 'e1', x1: 0, y1: 0, x2: 50, y2: 50 }]])
  const scheduler = makeScheduler()
  let finished = false
  syncEdges(root, previous, { durationMs: 0, onDone: () => (finished = true) }, scheduler.schedule, scheduler.cancel)
  assert.equal(finished, true)
  assert.equal(scheduler.size, 0)
  assert.equal(line.getAttribute('x1'), '100', '直接跳到当前 DOM 值（不动画）')
})

test('disabled（拖动中）直接跳，不排帧', () => {
  const line = new FakeLine({ 'data-edge-id': 'e1', x1: 100, y1: 100, x2: 200, y2: 200 })
  const root = makeRoot([line])
  const previous = new Map([['e1', { key: 'e1', x1: 0, y1: 0, x2: 50, y2: 50 }]])
  const scheduler = makeScheduler()
  syncEdges(root, previous, { durationMs: 280, disabled: true }, scheduler.schedule, scheduler.cancel)
  assert.equal(scheduler.size, 0, '拖动中不得插值（会黏滞）')
})

test('取消时停止排帧（组件卸载不留悬挂回调）', () => {
  const line = new FakeLine({ 'data-edge-id': 'e1', x1: 100, y1: 100, x2: 200, y2: 200 })
  const root = makeRoot([line])
  const previous = new Map([['e1', { key: 'e1', x1: 0, y1: 0, x2: 50, y2: 50 }]])
  const scheduler = makeScheduler()
  const stop = syncEdges(root, previous, { durationMs: 200 }, scheduler.schedule, scheduler.cancel)
  assert.ok(scheduler.size > 0, '应该已经排了第一帧')
  stop()
  assert.equal(scheduler.size, 0, '取消后队列必须清空')
})

test('FolderMap 真的接入了插值器（不是写了函数没人用）', () => {
  const source = readFileSync(join(PLUGIN_ROOT, 'src', 'client', 'ui', 'map', 'FolderMap.ts'), 'utf8')
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '')
  assert.match(code, /import \{[^}]*readEdgeFrames[^}]*\} from '\.\/edgeSync\.ts'/, '必须从 edgeSync 引入')
  assert.match(code, /syncEdges\(stage, previous/, '必须在 layout effect 里调用 syncEdges')
  assert.match(code, /React\.useLayoutEffect\(/, '必须在 DOM 提交后执行（useLayoutEffect，不是 useEffect）')
  assert.match(code, /edgeFramesRef\.current = readEdgeFrames\(stage\)/, '必须把最新端点存成下一帧起点')
})
