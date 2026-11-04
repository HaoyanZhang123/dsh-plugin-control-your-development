/*
 * tests/entries/referenceLayer.test.ts —— 引用层两条路径（T09b ⑤；D-06/D-07）。
 *
 * 1. **有 remote.workspaceFiles**：reader（含 cwd 卡口）→ 引用源 → resolveParsedReferences
 *    → reference 边 + unconfirmed[] + external[]（真实解析，不是假数据）；
 * 2. **没有 remote**：`disabled` 态，`resolve()` 返回 null（**绝不返回 0 条**）；UI 侧由
 *    `referenceDisabledText` 显示「引用（解析所得） · 观测不到」。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  REFERENCE_PARSE_LIMIT,
  createReferenceLayer,
  disabledReferenceLayer,
  probeWorkspaceFiles,
} from '../../src/client/state/referenceLayer.ts'
import type { WorkspaceFilesFace } from '../../src/client/files/index.ts'

const CWD = 'E:/work/demo'
const DOC = 'docs/spec.md'
const TARGET = 'src/client/data/merge.ts'

const FILES: Record<string, string> = {
  [DOC]: '# spec\n\n[merge](../src/client/data/merge.ts)\n[gone](./missing.md)\n[web](https://example.com/a)\n',
  [TARGET]: 'export const x = 1\n',
}

/** 假 remote.workspaceFiles（内存；stat 不存在的路径会抛错，模拟宿主行为）。 */
export function fakeWorkspaceFiles(overrides: Partial<Record<string, string>> = {}): WorkspaceFilesFace {
  const map: Record<string, string> = { ...FILES }
  for (const [key, value] of Object.entries(overrides)) if (value !== undefined) map[key] = value
  const body = (path: string): string => {
    const text = map[path]
    if (text === undefined) throw new Error('missing:' + path)
    return text
  }
  return {
    async stat(_sessionId: string, path: string) {
      const text = body(path)
      return { absolutePath: CWD + '/' + path, version: 'v1', bytes: text.length }
    },
    async read(_sessionId: string, path: string, range?: { offset?: number; limit?: number }) {
      const text = body(path)
      return {
        absolutePath: CWD + '/' + path,
        version: 'v1',
        bytes: text.length,
        offset: range?.offset ?? 0,
        text,
        lines: text.split(String.fromCharCode(10)).length,
        eof: true,
      }
    },
  }
}

test('能力探测：没有 remote / 没有 workspaceFiles → disabled（不返回 0 条，也不假装"没有引用"）', async () => {
  for (const remote of [undefined, null, {}, { workspaceFiles: {} }, { workspaceFiles: { stat: 1 } }]) {
    const layer = createReferenceLayer({ remote, sessionId: 's1', cwd: CWD })
    assert.equal(layer.status, 'disabled')
    assert.equal(layer.observable, false)
    assert.equal(await layer.resolve([DOC, TARGET]), null, 'disabled 时 resolve 必须返回 null（不是空数组）')
  }
  assert.equal(probeWorkspaceFiles({ workspaceFiles: fakeWorkspaceFiles() }) !== null, true)
  assert.equal(probeWorkspaceFiles(undefined), null)
})

test('缺少 sessionId / cwd 也是 disabled（reader 的 cwd 卡口是硬前提）', () => {
  const face = fakeWorkspaceFiles()
  assert.equal(createReferenceLayer({ face, sessionId: '', cwd: CWD }).status, 'disabled')
  assert.equal(createReferenceLayer({ face, sessionId: 's1', cwd: '' }).status, 'disabled')
  assert.equal(createReferenceLayer({ face, sessionId: 's1', cwd: CWD }).status, 'ready')
})

test('有 remote：解析出 reference 边 + 未确认引用 + 外部来源（真实解析）', async () => {
  const layer = createReferenceLayer({ face: fakeWorkspaceFiles(), sessionId: 's1', cwd: CWD })
  assert.equal(layer.status, 'ready')
  const view = await layer.resolve([DOC, TARGET])
  assert.ok(view !== null)
  assert.equal(view?.touched, 2)

  const referenceEdges = view?.edges.filter((edge) => edge.type === 'reference') ?? []
  assert.equal(referenceEdges.length, 1, 'docs/spec.md → merge.ts 应产生 1 条引用边')
  assert.equal(referenceEdges[0].from, DOC)
  assert.equal(referenceEdges[0].to, TARGET)
  assert.equal(referenceEdges[0].confidence, 'parsed')
  assert.ok(referenceEdges[0].evidence.text.includes('第'), '引用边必须带证据文本')

  const unconfirmed = view?.unconfirmed ?? []
  assert.equal(unconfirmed.length, 1, 'missing.md 未确认（文件不存在）')
  assert.equal(unconfirmed[0].target, 'docs/missing.md')
  assert.equal(unconfirmed[0].reason, 'not-found')

  const external = view?.external ?? []
  assert.equal(external.length, 1)
  assert.equal(external[0].raw, 'https://example.com/a')

  assert.equal(view?.truncated, false)
  assert.ok((view?.parsedFiles ?? 0) >= 1)
})

test('越界/绝对路径在 reader 卡口被拒绝，不会读工作区外', async () => {
  const layer = createReferenceLayer({ face: fakeWorkspaceFiles(), sessionId: 's1', cwd: CWD })
  const before: string[] = []
  const view = await layer.resolve(before)
  assert.equal(view?.edges.length, 0, '没有 touched 文件就没有边')
})

test('单次解析文件数有上限（>限值的部分显式记为 deferred，不静默丢）', async () => {
  const many = Object.fromEntries(
    Array.from({ length: 70 }, (_, index) => ['docs/f' + String(index) + '.md', '[t](../src/client/data/merge.ts)\n']),
  )
  const face = fakeWorkspaceFiles(many)
  const layer = createReferenceLayer({ face, sessionId: 's1', cwd: CWD })
  const view = await layer.resolve(Object.keys(many))
  assert.ok((view?.deferredFiles ?? 0) >= 70 - REFERENCE_PARSE_LIMIT, '超上限的文件必须显式 deferred')
  assert.ok((view?.parsedFiles ?? 0) <= REFERENCE_PARSE_LIMIT)
})

test('disabledReferenceLayer：显式工厂（测试/宿主切换用）', async () => {
  const layer = disabledReferenceLayer('no-workspace-files')
  assert.equal(layer.status, 'disabled')
  assert.equal(layer.reason, 'no-workspace-files')
  assert.equal(await layer.resolve([]), null)
  layer.dispose()
})
