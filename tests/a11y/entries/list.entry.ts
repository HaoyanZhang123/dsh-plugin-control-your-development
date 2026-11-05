/*
 * tests/a11y/entries/list.entry.ts —— 列表视图的真实浏览器夹具（A44-2 的键盘证据用）。
 *
 * 只做一件事：把 ListView 挂进页面，并把选中态接到 React state 上，
 * 这样"Enter 选中 / Esc 清空 / 方向键移动"能在真实 DOM 里被断言（node 单测覆盖不到焦点行为）。
 *
 * URL 参数：?mode=hidden 切隐私模式（验证掩码进到渲染层）。
 */
import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { createTranslator } from '../../../src/client/locale/index.ts'
import { installStyles } from '../../../src/client/styles/index.ts'
import { buildFileRows, buildTurnRows, DEFAULT_FILE_SORT, DEFAULT_TURN_SORT } from '../../../src/client/a11y/listModel.ts'
import { FileListView, TurnListView } from '../../../src/client/a11y/ListTable.ts'
import { PrivacyProvider, type PrivacyMode } from '../../../src/client/privacy/index.ts'
import type { FileNode } from '../../../src/shared/events/index.ts'

const h = React.createElement

function node(index: number, path: string, name: string, ops: number): FileNode {
  return {
    path,
    name,
    dir: path.slice(0, path.lastIndexOf('/')),
    family: index % 2 === 0 ? 'code' : 'text',
    firstAt: 1_700_000_000_000 + index * 1000,
    lastAt: 1_700_000_500_000 + index * 1000,
    reads: ops - 1,
    writes: 1,
    searches: 0,
    added: index * 3,
    removed: index,
    ops,
    sessionIds: ['s-1'],
    sessionCount: 1,
    turnCount: index + 1,
  }
}

const FILES: FileNode[] = [
  node(0, 'src/client/a11y/ListTable.ts', 'ListTable.ts', 12),
  node(1, 'notes/31-交接/03-产品与交互规格.md', '03-产品与交互规格.md', 7),
  node(2, 'data/fixture.json', 'fixture.json', 3),
]

const TURNS = [
  { turn: 1, status: 'completed' as const, files: 3, commands: 1, errors: 0, durationMs: 42_000 },
  { turn: 2, status: 'aborted' as const, files: 1, commands: 0, errors: 2, durationMs: null },
]

function App(): React.ReactElement {
  const params = new URLSearchParams(location.search)
  const mode: PrivacyMode = params.get('mode') === 'hidden' ? 'hidden' : 'metadata'
  const t = createTranslator('zh')
  const [selected, setSelected] = React.useState<string | null>(null)

  return h(
    PrivacyProvider,
    { mode },
    h(
      'div',
      { className: 'threadline-app', style: { padding: '8px' } },
      h(FileListView, {
        t,
        mode,
        rows: buildFileRows(FILES, mode),
        sort: DEFAULT_FILE_SORT,
        selectedKey: selected,
        onSelect: setSelected,
        onSort: () => undefined,
        onEscape: () => setSelected(null),
        onFocusInMap: () => undefined,
        testId: 'files',
      }),
      h(TurnListView, {
        t,
        mode,
        rows: buildTurnRows(TURNS),
        sort: DEFAULT_TURN_SORT,
        selectedKey: null,
        testId: 'turns',
      }),
    ),
  )
}

installStyles(document)
const container = document.getElementById('root')
if (!container) throw new Error('list entry: 缺少 #root')
createRoot(container).render(h(App, null))
requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    document.documentElement.setAttribute('data-harness-ready', '1')
  })
})
