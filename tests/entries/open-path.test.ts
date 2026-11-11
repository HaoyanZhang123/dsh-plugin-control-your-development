/*
 * tests/entries/open-path.test.ts —— 「双击打开文件」的资源地址契约（1.5.2 真机缺陷）。
 *
 * 真机现象：双击文件节点 / 右栏行，右侧栏什么都不发生，也没有报错。
 *
 * 根因：旧实现是 `openResource({ path })` —— 传了个对象。
 * DSH 的 `sidebarRight` 服务签名是 `openResource(address, options?)`，
 * 第一个参数必须是 `dsh-resource://file/session/<sessionId>/<相对路径>`
 * （对照 dsh-client-ui-sidebar-right 的 controller 与 dsh-client-ui-sidebar-files 的
 * `sessionFileAddress()`）。传对象 → 地址解析失败 → 静默无动作。
 *
 * 这条套件守三件事：
 * 1. 地址格式与宿主同构（前缀、session 段、逐段 encode、盘符冒号保持字面量）；
 * 2. 不再出现 `openResource({ path })` 这种对象调用；
 * 3. 没有 sessionId 时**不伪造**地址（退回最优努力 / 什么都不做）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PLUGIN_ROOT } from '../harness/styles-codegen.ts'

const INDEX = readFileSync(join(PLUGIN_ROOT, 'src', 'client', 'index.ts'), 'utf8')
const TAB = readFileSync(join(PLUGIN_ROOT, 'src', 'client', 'entries', 'tab.ts'), 'utf8')

/** 复刻产品实现（读源码里的同名函数会很难；这里直接按契约验算期望格式）。 */
function expectedAddress(sessionId: string, path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/^(?:\.\/)+/, '')
  const encodeSegment = (segment: string): string => encodeURIComponent(segment).replace(/%3A/gi, ':')
  return 'dsh-resource://file/session/' + encodeSegment(sessionId) + '/' + normalized.split('/').map(encodeSegment).join('/')
}

test('地址前缀与宿主一致（dsh-resource://file/session/<sid>/<path>）', () => {
  assert.match(INDEX, /'dsh-resource:\/\/file\/session\/'/, '必须用宿主认的地址前缀')
  assert.equal(expectedAddress('s-1', 'src/app.ts'), 'dsh-resource://file/session/s-1/src/app.ts')
})

test('路径归一：反斜杠转 /、去掉前导 ./、逐段 encode', () => {
  assert.equal(expectedAddress('s-1', 'src\\app.ts'), 'dsh-resource://file/session/s-1/src/app.ts')
  assert.equal(expectedAddress('s-1', './src/app.ts'), 'dsh-resource://file/session/s-1/src/app.ts')
  assert.equal(expectedAddress('s-1', 'docs/我的 文件.md'), 'dsh-resource://file/session/s-1/docs/%E6%88%91%E7%9A%84%20%E6%96%87%E4%BB%B6.md')
  /* sessionId 也要安全编码（宿主同口径）。 */
  assert.equal(expectedAddress('a/b', 'x.ts'), 'dsh-resource://file/session/a%2Fb/x.ts')
})

test('产品实现里有这一整套归一（不只看前缀）', () => {
  assert.match(INDEX, /replace\(\/\\\\\/g, '\/'\)/, '必须把反斜杠归一为 /')
  assert.match(INDEX, /replace\(\/\^\(\?:\\\.\\\/\)\+\/, ''\)/, '必须去掉前导 ./')
  assert.match(INDEX, /encodeURIComponent/, '路径段必须 encode')
  assert.match(INDEX, /replace\(\/%3A\/gi, ':'\)/, '盘符冒号必须保持字面量（与宿主一致）')
})

test('不允许再出现 openResource 的对象调用', () => {
  /* 只看**代码**，不看注释：注释里刻意保留了旧写法作为说明。 */
  const code = INDEX.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.equal(/openResource\(\s*\{\s*path/.test(code), false, 'openResource 第一个参数必须是地址字符串，不能是 { path }')
})

test('没有 sessionId 时不伪造地址（退回最优努力或什么都不做）', () => {
  /* 实现里必须先取 sessionId、判空，才拼地址。 */
  assert.match(INDEX, /const sessionId = getSessionId\?\.\(\)/, '必须先取当前会话 id')
  assert.match(INDEX, /typeof sessionId === 'string' && sessionId !== ''/, 'sessionId 无效时不得拼地址')
  assert.match(INDEX, /resourceAddress\(sessionId, path\)/, '有效时才拼地址')
})

test('tab 装配层必须把 sessionId 回写出去（否则拿不到 id）', () => {
  assert.match(INDEX, /setSessionId:\s*\(id/, '装配层必须提供 setSessionId 槽')
  /* tab.ts 的实际写法：`props.onSessionId(sessionId === '' ? undefined : sessionId)` */
  assert.match(TAB, /props\.onSessionId\(sessionId === '' \? undefined : sessionId\)/, 'tab 必须把 sessionId 回写')
})
