/*
 * component.test.ts —— 左图（FileGraph / FolderMap / TurnMap）的静态渲染断言。
 *
 * 覆盖（R04 起）：
 * - folder 模式 = **当前目录**视图：文件夹枢纽 + 当前目录文件（未触碰为中性节点）；
 * - 不画全工作区簇 / 不画跨目录蜘蛛网 / 关系边只在 hover/选中时出现；
 * - 标签 ≤40 尽量全标、>40 按 ops top N + 「显示 N/M」、绝不出现 `relati…` 这类碎片；
 * - 缩放组 −/适应/+/重置（重置 = 图标、无可见文字、有 aria-label）；图尾 `.tl-graph-foot` 整块不存在；
 * - turn 模式保留：摘要条、读/写行/首见、删除命令、节点上限 200 的显式「显示 N/M」；
 * - 空/加载/错误/截断态明确，不画假节点。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { caseKey } from '../../src/shared/relations/index.ts'
import { FileGraph, FILE_FAMILIES, FAMILY_COLOR, type FileGraphProps, type MapEntry } from '../../src/client/ui/map/index.ts'
import { turnFileStatusOf } from '../../src/client/ui/turns/index.ts'
import { buildEdges, makeFiles, makeTurnDetail, NOW } from './fixtures.ts'

const h = React.createElement

function countMatches(html: string, pattern: RegExp): number {
  const matches = html.match(pattern)
  return matches === null ? 0 : matches.length
}

/** 目录条目 → MapEntry 列表（测试夹具：只有文件，没有子目录）。 */
function entriesOf(files: readonly { path: string }[]): MapEntry[] {
  return files.map((file) => ({
    name: file.path.slice(file.path.lastIndexOf('/') + 1),
    path: file.path,
    kind: 'file' as const,
  }))
}

/** 当前目录 entries：子文件夹（directory）+ 文件（file）。 */
function folderEntries(subfolders: readonly string[], files: readonly { path: string }[], dir = ''): MapEntry[] {
  const prefix = dir === '' ? '' : dir + '/'
  return [
    ...subfolders.map((name) => ({ name, path: prefix + name, kind: 'directory' as const })),
    ...files.map((file) => ({
      name: file.path.slice(file.path.lastIndexOf('/') + 1),
      path: file.path,
      kind: 'file' as const,
    })),
  ]
}

function renderFolder(overrides: Partial<FileGraphProps> & { files?: readonly ReturnType<typeof makeFiles>[number][] } = {}): string {
  const files = overrides.files ?? makeFiles({ count: 12, dirs: ['src'] })
  const entries = overrides.entries ?? folderEntries(['apps', 'docs'], files, 'src')
  return renderToStaticMarkup(
    h(FileGraph, {
      mode: 'folder',
      files,
      entries,
      edges: [],
      currentPath: 'src',
      now: NOW,
      locale: 'zh',
      testId: 'graph',
      ...overrides,
    }),
  )
}

/* ================================================================== *
 * folder 模式：当前目录视图
 * ================================================================== */

test('folder 模式：只画当前目录 —— 子文件夹进枢纽卡、文件进关系图，不出现工作区别的目录', () => {
  const files = makeFiles({ count: 24, dirs: ['src', 'docs', 'assets'] })
  const srcFiles = files.filter((file) => file.path.startsWith('src/'))
  const html = renderFolder({
    files: srcFiles,
    entries: folderEntries(['apps', 'lib'], srcFiles, 'src'),
    currentPath: 'src',
  })
  assert.ok(html.includes('data-tl-graph="true"'))
  assert.ok(html.includes('data-graph-mode="folder"'))
  assert.ok(html.includes('data-graph-current="src"'))
  // 文件夹枢纽：只有当前目录的直接子文件夹。
  assert.equal(countMatches(html, /data-folder-hub="/g), 2)
  assert.ok(html.includes('data-folder-hub="src/apps"'))
  assert.ok(html.includes('data-folder-hub="src/lib"'))
  // 文件节点：只有当前目录的直接文件。
  const nodePaths = [...html.matchAll(/data-file-path="([^"]+)"/g)].map((match) => match[1])
  assert.ok(nodePaths.length > 0)
  for (const path of nodePaths) assert.ok(path.startsWith('src/'), '不应出现当前目录外的文件：' + path)
  // 不画全工作区簇/目录级弱边/关系 chip。
  assert.equal(html.includes('data-cluster-key'), false)
  assert.equal(html.includes('data-dir-edge'), false)
  assert.equal(html.includes('data-relation-filter'), false)
})

test('folder 模式：未触碰文件是中性节点（data-touched=false，不显示「操作 0」）', () => {
  const files = makeFiles({ count: 6, dirs: ['src'] })
  const touched = files.slice(0, 3)
  const allFiles = files
  const entries = folderEntries([], allFiles, 'src')
  const html = renderFolder({ files: touched, entries, currentPath: 'src' })
  assert.equal(countMatches(html, /data-file-path="/g), allFiles.length, '未触碰文件也必须出现')
  assert.equal(countMatches(html, /data-touched="false"/g), allFiles.length - touched.length)
  // 中性节点的 aria 不得出现「操作 0」这种假事实。
  const ariaLabels = [...html.matchAll(/aria-label="([^"]*)"/g)].map((match) => match[1])
  assert.equal(ariaLabels.some((label) => label.includes('操作 0')), false, '不得出现「操作 0」')
  assert.ok(ariaLabels.some((label) => label.includes('本会话未触碰')), '中性节点用「本会话未触碰」')
})

test('folder 模式：默认就画关系边（常驻分层 L1+L2，不再"只 hover 才画"）', () => {
  const files = makeFiles({ count: 8, dirs: ['src'] })
  const edges = buildEdges(files, [], { references: 3 })
  const entries = folderEntries([], files, 'src')
  const plain = renderFolder({ files, entries, edges, currentPath: 'src' })
  // R10：边**默认常驻**（用户要求"有系的连在一起"，不是 hover 才出现）。
  const drawn = [...plain.matchAll(/data-edge-from="([^"]+)" data-edge-to="([^"]+)"/g)]
  assert.ok(drawn.length > 0, '默认必须画关系边（常驻，不是 hover 才画）')
  const allowed = new Set(files.map((file) => caseKey(file.path)))
  for (const match of drawn) {
    assert.ok(allowed.has(caseKey(match[1])))
    assert.ok(allowed.has(caseKey(match[2])))
  }
  // 边带分层标记（L1 骨架 / L2 强共现 / L3 其余）。
  assert.ok(plain.includes('data-edge-layer="L1"'), '必须有 L1 骨架边')
  for (const layer of [...plain.matchAll(/data-edge-layer="(L[123])"/g)]) {
    assert.ok(['L1', 'L2', 'L3'].includes(layer[1]))
  }
})

test('folder 模式：关系密度组（骨架/标准/全部），默认「标准」= aria-pressed', () => {
  const html = renderFolder()
  assert.ok(html.includes('data-density="standard"'), '默认档 = 标准')
  for (const option of ['skeleton', 'standard', 'all']) {
    assert.ok(html.includes('data-density-action="' + option + '"'), '缺按钮：' + option)
  }
  // 当前档 aria-pressed=true，其余 false。
  const standardAt = html.indexOf('data-density-action="standard"')
  const standardTag = html.slice(html.lastIndexOf('<button', standardAt), html.indexOf('>', standardAt) + 1)
  assert.ok(standardTag.includes('aria-pressed="true"'), '标准档应为按下态')
  const skeletonAt = html.indexOf('data-density-action="skeleton"')
  const skeletonTag = html.slice(html.lastIndexOf('<button', skeletonAt), html.indexOf('>', skeletonAt) + 1)
  assert.ok(skeletonTag.includes('aria-pressed="false"'), '骨架档不应该是按下态')
})

test('folder 模式：>40 时图头常驻 chip「显示 40/M」（可点按钮，不是菜单/弹窗）', () => {
  const files = makeFiles({ count: 300, dirs: ['src'] })
  const entries = folderEntries([], files, 'src')
  const html = renderFolder({ files, entries, currentPath: 'src' })
  assert.ok(html.includes('data-graph-show-all="true"'), '必须存在「显示全部」chip')
  assert.ok(html.includes('显示 40/300'), 'chip 文案必须是「显示 40/M」')
  assert.ok(html.includes('data-expanded="false"'), '默认是 40 档（未展开）')
  // 是 <button>，不是菜单、不是 dialog。
  const chipAt = html.indexOf('data-graph-show-all="true"')
  const chipOpen = html.lastIndexOf('<button', chipAt)
  assert.ok(chipOpen >= 0, 'chip 必须是按钮（可点，就地切换）')
  const chipTag = html.slice(chipOpen, html.indexOf('>', chipAt) + 1)
  assert.ok(chipTag.includes('aria-pressed="false"'))
  assert.equal(html.includes('role="menu"'), false, '不是菜单')
  assert.equal(html.includes('role="dialog"'), false, '不是弹窗')
})

test('folder 模式：≤40 时不显示「显示全部」chip（没有可展开的东西）', () => {
  const files = makeFiles({ count: 12, dirs: ['src'] })
  const entries = folderEntries(['apps'], files, 'src')
  const html = renderFolder({ files, entries, currentPath: 'src' })
  assert.equal(html.includes('data-graph-show-all'), false, '≤40 时不该有 chip')
})

test('folder 模式：图头关系计数（「关系 N 条」）', () => {
  const files = makeFiles({ count: 8, dirs: ['src'] })
  const edges = buildEdges(files, [], { references: 3 })
  const entries = folderEntries([], files, 'src')
  const html = renderFolder({ files, entries, edges, currentPath: 'src' })
  assert.ok(/data-graph-relations="\d+"/.test(html), '图头必须有关系计数')
  assert.ok(html.includes('关系 '), '有「关系 N 条」文案')
})

test('folder 模式：铺满视口 —— data-graph-fill ≥ 0.55（不是只占上部一小块）', () => {
  const files = makeFiles({ count: 24, dirs: ['src'] })
  const entries = folderEntries(['apps', 'docs'], files, 'src')
  const html = renderFolder({ files, entries, currentPath: 'src' })
  const match = /data-graph-fill="([\d.]+)"/.exec(html)
  assert.ok(match !== null, '必须有 data-graph-fill 证据属性')
  assert.ok(Number(match[1]) >= 0.55, '内容包围盒占画布 ' + match[1] + '（要求 ≥ 0.55）')
})

test('folder 模式：枢纽卡带 data-hub-linked（有关系 true / 没关系 false）', () => {
  const files = makeFiles({ count: 8, dirs: ['src'] })
  const entries = folderEntries(['apps', 'docs'], files, 'src')
  // 没有 allEdges → 全部 false（不伪造）。
  const plain = renderFolder({ files, entries, currentPath: 'src' })
  assert.equal(countMatches(plain, /data-hub-linked="true"/g), 0, '没有跨目录关系时不得有任何 true')
  assert.equal(countMatches(plain, /data-hub-linked="false"/g), 2)
  assert.equal(plain.includes('data-hub-edge="'), false, '不得画任何枢纽聚合边')
})

test('folder 模式：标签是完整文件名（绝不出现 `relati…` 这类不可读碎片）', () => {
  const longName = 'relations-evidence-report-with-a-very-long-name-000.md'
  const entries: MapEntry[] = [
    { name: longName, path: 'src/' + longName, kind: 'file' },
    { name: 'a.ts', path: 'src/a.ts', kind: 'file' },
  ]
  const html = renderFolder({ files: [], entries, currentPath: 'src' })
  const labels = [...html.matchAll(/class="tl-ofile-label"[^>]*>([^<]*)</g)].map((match) => match[1])
  assert.ok(labels.length > 0)
  for (const label of labels) {
    assert.equal(label.includes('…'), false, '标签不得截断成碎片：' + label)
    assert.equal(label.includes('...'), false, '标签不得截断成碎片：' + label)
  }
  // 放不下的名字整条隐藏，但完整路径仍在 tooltip（<title>）。
  assert.ok(html.includes('<title>src/' + longName + '</title>') || html.includes('<title>src/' + longName))
})

test('folder 模式：>40 文件时按 ops 降序取 top N，并显示「显示 N/M」（不是静默截断）', () => {
  const files = makeFiles({ count: 300, dirs: ['src'] })
  const entries = folderEntries([], files, 'src')
  const html = renderFolder({ files, entries, currentPath: 'src' })
  assert.ok(html.includes('data-graph-truncated="true"'))
  assert.ok(html.includes('显示 40/300'), '必须显示「显示 N/M」')
  // 保留的是 ops 最高的那批。
  const kept = [...html.matchAll(/data-file-path="([^"]+)" data-family="[^"]*" data-ops="(\d+)"/g)]
  assert.ok(kept.length > 0)
  const keptOps = kept.map((match) => Number(match[2]))
  const droppedOps = files.filter((file) => !kept.some((match) => match[1] === file.path)).map((file) => file.ops)
  assert.ok(Math.min(...keptOps) >= Math.max(...droppedOps), '截断必须保留 ops 最高的')
})

/* ================================================================== *
 * 图尾整块删除（M2）
 * ================================================================== */

test('M2 图尾：`.tl-graph-foot` 与四段可见文案整块消失（folder 与 turn 都没有）', () => {
  const folder = renderFolder()
  const turnFiles = makeFiles({ count: 5, dirs: ['src'] })
  const turn = makeTurnDetail(turnFiles, { n: 3 })
  const turnHtml = renderToStaticMarkup(
    h(FileGraph, {
      mode: 'turn',
      files: turnFiles,
      edges: [],
      turn: { turn, status: turnFileStatusOf(turn, turnFiles) },
      now: NOW,
      locale: 'zh',
    }),
  )
  for (const html of [folder, turnHtml]) {
    assert.equal(html.includes('tl-graph-foot'), false, '图尾整块必须删除')
    assert.equal(html.includes('tl-graph-hint'), false)
    assert.equal(html.includes('点右侧卡片展开目录'), false)
    assert.equal(html.includes('拖动节点可调整位置'), false)
    assert.equal(html.includes('点轮次看本轮文件'), false)
    assert.equal(html.includes('可拖动节点'), false)
    assert.equal(html.includes('基于已加载'), false)
    // 「重置布局」只能出现在 aria-label/title，不能是可见文字。
    assert.equal(html.includes('>重置布局<'), false, '重置布局不能是按钮可见文字')
  }
})

/* ================================================================== *
 * 缩放组（M5 DOM 契约）
 * ================================================================== */

test('M5 缩放组：− / 适应 / + / 重置布局（重置只有图标 + aria-label，无可见文字）', () => {
  const html = renderFolder()
  assert.ok(html.includes('data-zoom="1"'))
  assert.ok(html.includes('data-zoom-action="out"'))
  assert.ok(html.includes('data-zoom-action="fit"'))
  assert.ok(html.includes('data-zoom-action="in"'))
  assert.ok(html.includes('data-zoom-action="reset"'))
  assert.ok(html.includes('data-zoom-layer="true"'))
  assert.ok(html.includes('transform="translate(0 0) scale(1)"'), '默认相机 = 1/0/0')
  assert.ok(html.includes('data-testid="graph-fit"'))
  assert.ok(html.includes('data-testid="graph-reset"'))
  // 重置按钮：aria-label 有、可见文字无（只有 aria-hidden 的图标字形）。
  const resetAt = html.indexOf('data-testid="graph-reset"')
  assert.ok(resetAt > 0)
  const resetOpen = html.lastIndexOf('<button', resetAt)
  const resetClose = html.indexOf('</button>', resetAt)
  const resetTag = html.slice(resetOpen, html.indexOf('>', resetAt) + 1)
  const resetInner = html.slice(html.indexOf('>', resetAt) + 1, resetClose)
  assert.ok(resetTag.includes('aria-label="重置布局"'), '重置按钮要有 aria-label')
  assert.equal(resetInner.replace(/<[^>]*>/g, '').trim(), '', '重置按钮不得有可见文字')
  assert.ok(resetInner.includes('aria-hidden="true"'), '图标本身对读屏隐藏')
  // 适应有可见文字。
  const fitAt = html.indexOf('data-testid="graph-fit"')
  const fitInner = html.slice(html.indexOf('>', fitAt) + 1, html.indexOf('</button>', fitAt))
  assert.equal(fitInner.includes('适应'), true)
})

/* ================================================================== *
 * 状态：空 / 加载 / 错误
 * ================================================================== */

test('folder 模式：空目录显示「空文件夹」，不画假节点、不画 svg', () => {
  const html = renderFolder({ files: [], entries: [], currentPath: 'empty' })
  assert.ok(html.includes('data-threadline-empty'))
  assert.ok(html.includes('空文件夹'))
  assert.equal(countMatches(html, /data-file-path="/g), 0)
  assert.equal(html.includes('tl-graph-svg'), false)
  assert.equal(html.includes('data-folder-hub'), false)
})

test('folder 模式：加载态不显示空态/假 0；读取失败显示显式错误', () => {
  const loading = renderToStaticMarkup(
    h(FileGraph, {
      mode: 'folder',
      files: [],
      entries: [],
      currentPath: 'src',
      now: NOW,
      locale: 'zh',
      loading: true,
      loadingLabel: '正在加载文件关系…',
    }),
  )
  assert.ok(loading.includes('data-graph-loading="true"'))
  assert.ok(loading.includes('正在加载文件关系…'))
  assert.equal(loading.includes('data-threadline-empty'), false, '加载中不能显示空态')

  const failed = renderFolder({ files: [], entries: [], currentPath: 'src', errorText: '读取失败' })
  assert.ok(failed.includes('读取失败'))
  assert.equal(failed.includes('tl-graph-svg'), false)
  assert.equal(countMatches(failed, /data-file-path="/g), 0)
})

/* ================================================================== *
 * 证据浮层
 * ================================================================== */

test('folder 模式：图内不再渲染证据浮层（D-35 移到时间线）', () => {
  const files = makeFiles({ count: 5, dirs: ['src'] })
  const entries = folderEntries([], files, 'src')
  const html = renderFolder({ files, entries, currentPath: 'src', selectedPath: files[0].path, edges: [] })
  assert.equal(html.includes('tl-graph-evidence'), false, '图内不得再有证据浮层（渲染点在时间线）')
  assert.equal(html.includes('role="dialog"'), false)
  assert.equal(html.includes('data-region="inspector"'), false)
})

test('folder 模式：中性节点选中时图内不伪造「操作 0」', () => {
  const files = makeFiles({ count: 4, dirs: ['src'] })
  const entries = folderEntries([], files, 'src')
  const neutral = files[3]
  const html = renderFolder({ files: files.slice(0, 2), entries, currentPath: 'src', selectedPath: neutral.path })
  assert.equal(html.includes('操作 0'), false)
})

/* ================================================================== *
 * 确定性 / reduced-motion
 * ================================================================== */

test('确定性：同一份 props 两次静态渲染逐字符相同', () => {
  assert.equal(renderFolder(), renderFolder())
  const turnFiles = makeFiles({ count: 5, dirs: ['src'] })
  const turn = makeTurnDetail(turnFiles, { n: 4 })
  const props = {
    mode: 'turn' as const,
    files: turnFiles,
    edges: [],
    turn: { turn, status: turnFileStatusOf(turn, turnFiles) },
    now: NOW,
    locale: 'zh' as const,
  }
  assert.equal(renderToStaticMarkup(h(FileGraph, props)), renderToStaticMarkup(h(FileGraph, props)))
})

test('reduced-motion 标记透传到图根（无动画依赖）', () => {
  assert.ok(renderFolder({ reducedMotion: true }).includes('data-reduced-motion="true"'))
})

test('4 个文件大类颜色来自 tokens（不写颜色字面量）', () => {
  const colors = FILE_FAMILIES.map((family) => FAMILY_COLOR[family])
  assert.equal(colors.length, 5)
  assert.equal(new Set(colors).size, 5)
  for (const color of colors) assert.match(color, /^var\(--tl-/)
})

/* ================================================================== *
 * turn 模式（保留的轮次视图）
 * ================================================================== */

function renderTurn(overrides: Record<string, unknown> = {}): string {
  const turnFiles = makeFiles({ count: 6, dirs: ['src', 'docs'] })
  const turn = makeTurnDetail(turnFiles, { n: 7, deleteCommands: 2 })
  return renderToStaticMarkup(
    h(FileGraph, {
      mode: 'turn',
      files: turnFiles,
      edges: [],
      turn: { turn, status: turnFileStatusOf(turn, turnFiles) },
      now: NOW,
      locale: 'zh',
      ...overrides,
    }),
  )
}

test('turn 模式：摘要条（读/写行/首见/删除命令）+ 每个文件的状态小字', () => {
  const html = renderTurn()
  assert.ok(html.includes('data-graph-mode="turn"'))
  assert.ok(html.includes('class="tl-graph-summary"'))
  assert.ok(html.includes('T7'))
  assert.ok(html.includes('读 4'))
  assert.ok(html.includes('写 +16 / −3 行'))
  assert.ok(html.includes('首见 0'))
  assert.ok(html.includes('删除命令 2（未逐文件归属）'))
  assert.ok(countMatches(html, /class="tl-fnode-status"/g) >= 3)
  assert.ok(html.includes('写+12'))
  assert.ok(html.includes('写−3'))
  assert.ok(html.includes('data-read="1"'))
  assert.ok(html.includes('data-write-add="12"'))
})

test('turn 模式：删除命令不可知时显示 —（不显示 0）', () => {
  const turnFiles = makeFiles({ count: 3, dirs: ['src'] })
  const turn = makeTurnDetail(turnFiles, { n: 2 })
  const html = renderTurn({ files: turnFiles, turn: { turn, status: turnFileStatusOf(turn, turnFiles) } })
  assert.ok(html.includes('data-status="delete"'))
  assert.ok(html.includes('删除命令 —'))
  assert.equal(html.includes('删除命令 0'), false)
})

test('turn 模式：运行中轮次（无 end）首见显示 —，不显示 0', () => {
  const turnFiles = makeFiles({ count: 3, dirs: ['src'] })
  const turn = makeTurnDetail(turnFiles, { n: 2, end: null })
  const html = renderTurn({ files: turnFiles, turn: { turn, status: turnFileStatusOf(turn, turnFiles) } })
  assert.ok(html.includes('首见 —'))
  assert.equal(html.includes('首见 0'), false)
})

test('turn 模式：200 上限截断时显式「显示 N/M」', () => {
  const many = makeFiles({ count: 300, dirs: ['big'] })
  const turn = makeTurnDetail(many, { n: 2 })
  const html = renderTurn({ files: many, turn: { turn, status: turnFileStatusOf(turn, many) } })
  assert.ok(html.includes('data-node-count="200"'))
  assert.ok(html.includes('显示 200/300'))
})

test('turn 模式：空数据不画假图', () => {
  const turn = makeTurnDetail([], { n: 1 })
  const html = renderTurn({ files: [], turn: { turn, status: turnFileStatusOf(turn, []) } })
  assert.equal(countMatches(html, /data-file-path="/g), 0)
  assert.ok(html.includes('data-threadline-empty'))
})

test('turn 模式：边只画两端都在本轮集合内的', () => {
  const all = makeFiles({ count: 40, dirs: ['src', 'docs'] })
  const edges = buildEdges(all, [], { references: 4 })
  const subset = all.slice(0, 6)
  const turn = makeTurnDetail(subset, { n: 2 })
  const html = renderTurn({ files: subset, edges, turn: { turn, status: turnFileStatusOf(turn, subset) } })
  const endpoints = [...html.matchAll(/data-edge-from="([^"]+)" data-edge-to="([^"]+)"/g)]
  const allowed = new Set(subset.map((file) => caseKey(file.path)))
  for (const match of endpoints) {
    assert.ok(allowed.has(caseKey(match[1])), '边端点不在集合内：' + match[1])
    assert.ok(allowed.has(caseKey(match[2])), '边端点不在集合内：' + match[2])
  }
})

test('turn 模式：点空白/Esc 通过 onExitTurn 退出（渲染契约保持）', () => {
  const turnFiles = makeFiles({ count: 4, dirs: ['src'] })
  const turn = makeTurnDetail(turnFiles, { n: 5 })
  const html = renderTurn({ files: turnFiles, turn: { turn, status: turnFileStatusOf(turn, turnFiles) }, onExitTurn: () => undefined })
  assert.ok(html.includes('data-graph-mode="turn"'))
  assert.ok(html.includes('tl-graph-svg'))
})
