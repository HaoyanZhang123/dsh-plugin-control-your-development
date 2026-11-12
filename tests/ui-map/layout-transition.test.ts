/*
 * tests/ui-map/layout-transition.test.ts —— 布局几何的**唯一时间轴**（P2 重写）。
 *
 * ## 为什么这条套件的语义被改了（不是"为了让测试变绿而放宽"）
 *
 * 原版（1.5.3）守的是：
 *   「节点的 `cx/cy/r`、卡片的 `x/y/w/h`、标签的 `x/y` 都声明了 CSS transition」。
 * 那是当时**实测有效**的做法（Chrome 确实支持对 SVG 表现属性做 transition）。
 *
 * P2 把它推翻了，理由是实测出来的**多时钟错位**（四条都已在代码里核对过）：
 * 1. `<line>` 的 `x1/y1/x2/y2` 是表现属性，Chrome **不做** transition
 *    （探针：写 transition 后 70ms 就是终点值，`getComputedStyle(line).x1` 返回空串）
 *    → 边只能 rAF 逐帧写；而节点走 CSS = 节点与线两张表；
 * 2. 文件夹图标的 `path.d` 是字符串路径，**无法被 CSS 过渡**，只能按最新坐标立即重算
 *    → 同一张枢纽卡片里，rect 在滑、图标已经跳到终点；
 * 3. 标签又走另一组 CSS 属性 → 第三张表；
 * 4. 三张表叠加后，中间帧四处错位（用户看到的就是"散架"）。
 *
 * 所以现在的口径是：**几何由 rAF 统一驱动，CSS 里不得再对几何声明 transition**。
 * 几何动画的正确性由 `scene-clock.test.ts`（纯函数 + 端点同帧断言）覆盖；
 * 这里守「CSS 没有偷偷再开第二条时钟」这条**反向**不变量。
 *
 * 保留的（必须仍然成立）：
 * - `--tl-dur-layout` 令牌存在且 reduced-motion 下归零（现在它是 rAF 时长的事实源）；
 * - 颜色 / 透明度 / 描边的短过渡仍然保留（它们不参与几何）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PLUGIN_ROOT } from '../harness/styles-codegen.ts'

const MAP = readFileSync(join(PLUGIN_ROOT, 'src', 'client', 'styles', 'map.css'), 'utf8')
const TOKENS = readFileSync(join(PLUGIN_ROOT, 'src', 'client', 'styles', 'tokens.css'), 'utf8')

function strip(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}
const CODE = strip(MAP)

/** 几何属性：一旦出现在 transition 里，就说明 CSS 又开了第二条时钟。 */
const GEOMETRY_PROPS = ['cx', 'cy', 'r', 'x', 'y', 'width', 'height', 'x1', 'y1', 'x2', 'y2'] as const

/**
 * 抽出一条规则里 `transition:` 声明的属性名（逗号分隔，忽略时长/缓动/var()）。
 */
function transitionProps(body: string): string[] {
  const found: string[] = []
  for (const match of body.matchAll(/transition:\s*([^;}]+)/g)) {
    for (const part of match[1].split(',')) {
      const name = part.trim().split(/\s+/)[0]
      if (name !== '') found.push(name)
    }
  }
  return found
}

/** 把 CSS 切成「规则头 + 规则体」，方便逐条检查 transition 声明属于哪个选择器。 */
function rules(css: string): Array<{ selector: string; body: string }> {
  const result: Array<{ selector: string; body: string }> = []
  for (const match of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    result.push({ selector: match[1].trim(), body: match[2] })
  }
  return result
}

test('folder 模式的几何类不得再声明 transition（几何由 rAF 统一驱动）', () => {
  /**
   * 范围说明（**这条边界是刻意的**）：
   * - `.tl-ofile*` / `.tl-foldhub*` = 脉络图（folder 模式）→ 几何已交给 rAF，CSS 不许再有；
   * - `.tl-fnode*` = 轮次图（turn 模式，FileGraph）→ **不在 P2 范围内**，
   *   它仍用 CSS 过渡；连带删掉会让思维链页的节点从"滑动"退化成"瞬移"。
   */
  const FOLDER_SELECTORS = ['.tl-ofile', '.tl-foldhub']
  const offenders: string[] = []
  for (const rule of rules(CODE)) {
    if (!FOLDER_SELECTORS.some((selector) => rule.selector.includes(selector))) continue
    for (const prop of transitionProps(rule.body)) {
      if ((GEOMETRY_PROPS as readonly string[]).includes(prop)) {
        offenders.push(rule.selector + ' → ' + prop)
      }
    }
  }
  assert.deepEqual(offenders, [], '这些规则仍在给 folder 几何声明 transition（会与 rAF 打架）：\n' + offenders.join('\n'))
})

test('folder 与 turn **两种模式**的几何类都不得声明 transition（几何统一由 rAF 驱动）', () => {
  /**
   * 语义演进（说明，不是放宽）：
   * - P2 时只有 folder 交给 rAF，turn 仍用 CSS 几何过渡；
   * - P3 起 turn 也接了同一个内核（`useNodeFrames`），所以**两种模式**的几何
   *   都不许再有 CSS transition —— 否则 CSS 会在 rAF 之后"懒一拍"，比不做好更错位。
   */
  const GEOMETRY_SELECTORS = ['.tl-ofile', '.tl-foldhub', '.tl-fnode']
  const offenders: string[] = []
  for (const rule of rules(CODE)) {
    if (!GEOMETRY_SELECTORS.some((selector) => rule.selector.includes(selector))) continue
    for (const prop of transitionProps(rule.body)) {
      if ((GEOMETRY_PROPS as readonly string[]).includes(prop)) {
        offenders.push(rule.selector + ' → ' + prop)
      }
    }
  }
  assert.deepEqual(offenders, [], '这些规则仍在给几何声明 transition（会与 rAF 打架）：\n' + offenders.join('\n'))
})

test('turn 图也由 rAF 驱动（CSS 里不再有它的几何过渡）', () => {
  /* 只看真正声明过渡属性的规则（排除 reduced-motion 段里那些 transition: none）。 */
  const core = rules(CODE).filter(
    (rule) => rule.selector.includes('.tl-fnode-core') && /transition:/.test(rule.body) && !/transition:\s*none/.test(rule.body),
  )
  assert.ok(core.length > 0, '轮次图节点的颜色过渡必须还在')
  for (const rule of core) {
    assert.equal(/cx var/.test(rule.body), false, 'turn 图的 cx 不得再走 CSS 过渡（已交给 rAF）')
    assert.equal(/cy var/.test(rule.body), false, 'turn 图的 cy 不得再走 CSS 过渡（已交给 rAF）')
    assert.match(rule.body, /fill-opacity var\(--tl-dur-fast\)/, '颜色过渡必须保留')
  }
})


test('--tl-dur-layout 令牌存在，并在 reduced-motion 下归零（现在是 rAF 时长的事实源）', () => {
  assert.match(TOKENS, /--tl-dur-layout:\s*\d+ms/, '必须定义布局时长令牌')
  const reduced = TOKENS.slice(TOKENS.indexOf('@media (prefers-reduced-motion: reduce)'))
  assert.match(reduced, /--tl-dur-layout:\s*0ms/, 'reduced-motion 下时长必须归零（rAF 直接到终点）')
})

test('CSS 不得再对 folder 几何声明 transition（几何由 rAF 统一驱动）', () => {
  const offenders: string[] = []
  for (const rule of rules(CODE)) {
    if (!rule.selector.includes('.tl-ofile') && !rule.selector.includes('.tl-foldhub')) continue
    for (const prop of transitionProps(rule.body)) {
      if ((GEOMETRY_PROPS as readonly string[]).includes(prop)) {
        offenders.push(rule.selector + ' → ' + prop)
      }
    }
  }
  assert.deepEqual(offenders, [], '这些规则仍在给几何声明 transition（会与 rAF 打架）：\n' + offenders.join('\n'))
})

test('节点 / 卡片 / 标签 / 边仍然保留颜色与透明度过渡（功能不缩水）', () => {
  /* 几何交给 rAF，但"高亮/淡入"这些纯视觉态必须还在，否则 hover 会瞬变。 */
  const withTransition = rules(CODE).filter((rule) => /transition:/.test(rule.body))
  const find = (selector: string): string => {
    const hit = withTransition.find((rule) => rule.selector.includes(selector))
    assert.ok(hit !== undefined, '必须存在带 transition 的 ' + selector + ' 规则')
    return hit.body
  }
  assert.match(find('.tl-ofile-core'), /fill-opacity var\(--tl-dur-fast\)/, '节点颜色态过渡必须保留')
  assert.match(find('.tl-foldhub-card'), /fill var\(--tl-dur-fast\)/, '卡片颜色态过渡必须保留')
  assert.match(find('.tl-ofile-label'), /opacity var\(--tl-dur-base\)/, '标签透明度过渡必须保留')
})

test('rAF 时钟真的接入了 FolderMap（不是写了函数没人用）', () => {
  const source = readFileSync(join(PLUGIN_ROOT, 'src', 'client', 'ui', 'map', 'FolderMap.ts'), 'utf8')
  assert.match(source, /import \{ useSceneFrameState \} from '\.\/useSceneClock\.ts'/, '必须引入唯一几何时钟')
  assert.match(source, /useSceneFrameState\(baseGeometry,/, '必须把布局快照喂给时钟')
  assert.match(source, /restartOn: props\.currentPath/, '视图身份 = 当前目录（换目录 = 全新入场）')
  assert.match(source, /applyDragOffsets\(renderedBase, dragOffsets\)/, '拖动偏移必须叠在**插值结果**之上')
})

test('reduced-motion 下几何时钟直接到终点（不播动画，信息不减）', () => {
  const clock = readFileSync(join(PLUGIN_ROOT, 'src', 'client', 'ui', 'map', 'useSceneClock.ts'), 'utf8')
  const body = clock.replace(/\/\*[\s\S]*?\*\//g, '')
  assert.match(body, /options\.reducedMotion/, 'reduced-motion 必须是时钟的显式输入')
  assert.match(body, /if \(renderedRef\.current === null \|\| !canAnimate\)/, '不允许动画时必须走"直接到终点"分支')
  assert.match(body, /renderedRef\.current = target/, '终点必须写目标帧本身（不是插值近似）')
})

test('reduced-motion 段必须把几何相关类的 transition 显式关掉', () => {
  const reduced = CODE.slice(CODE.indexOf('@media (prefers-reduced-motion: reduce)'))
  for (const cls of ['.tl-ofile-core', '.tl-ofile-label', '.tl-foldhub-card']) {
    assert.ok(reduced.includes(cls), 'reduced-motion 段必须覆盖 ' + cls)
  }
  assert.match(reduced, /transition:\s*none/, 'reduced-motion 必须 transition: none')
})
