/*
 * host-shape.test.ts —— host fs 边界门禁的**正反两侧**审计（1.2.0 返工）。
 *
 * 工厂规则「改门禁本身」要求：
 * - 正向：该通过的形态**真的写盘、真的绿**；
 * - 反向：喂**已知坏输入**，必须**真的红**并**点名原因**，且不留可被误当证据的产物。
 *
 * 这里审计的是 `tools/host-shape.mjs`（build.mjs 的 assertHostShape 已改为调用它）：
 * 1.2.0 用户批准了 B1 host 只读目录例外（04 §9.5），旧的「host 不许 import fs」一刀切语义作废。
 * 新语义 =「只读白名单 + 写 API 黑名单 + 正向要求真的只读读目录」。
 *
 * 为什么不靠真构建做反向：把坏代码写进 src/ 再构建会污染工作树、留下可被误当证据的产物。
 * 门禁逻辑被抽成纯函数模块后，直接喂字符串即可，**不落任何文件**。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PLUGIN_ROOT } from '../harness/styles-codegen.ts'
import {
  HOST_FS_ALLOWED_MODULES,
  HOST_FS_READ_ALLOWLIST,
  hostShapeFailures,
} from '../../tools/host-shape.mjs'

const REAL_HOST_BUNDLE = join(PLUGIN_ROOT, 'lib', 'index.js')

/** 一个最小但形状正确的 host 产物（保证 ESM + 插件 id 两条前提不干扰 fs 断言）。 */
const SHAPE_PROLOGUE = [
  'export const name = "dsh-plugin-control-your-development"',
  'export function apply(ctx) { return ctx }',
].join('\n')

test('正向：真实 lib/index.js 通过 fs 边界（当前产物不含 fs，也不许因无关单词假红）', () => {
  const text = readFileSync(REAL_HOST_BUNDLE, 'utf8')
  assert.ok(text.length > 0, 'lib/index.js 为空——先跑 pnpm run build')
  assert.deepEqual(hostShapeFailures(text), [], '真实 host 产物不该有 fs 边界问题')
})

test('正向：合法的只读目录实现放过（node:fs/promises + readdir/lstat/realpath）', () => {
  const text = [
    SHAPE_PROLOGUE,
    'import { readdir, lstat, realpath } from "node:fs/promises"',
    'export async function listDirectory(abs) {',
    '  const entries = await readdir(abs, { withFileTypes: true })',
    '  const info = await lstat(abs)',
    '  const real = await realpath(abs)',
    '  return { entries, info, real }',
    '}',
  ].join('\n')
  assert.deepEqual(hostShapeFailures(text), [])
})

test('正向：动态 import 的只读写法也放过', () => {
  const text = [
    SHAPE_PROLOGUE,
    'export async function listDirectory(abs) {',
    '  const { readdir, realpath } = await import("node:fs/promises")',
    '  return { entries: await readdir(abs), real: await realpath(abs) }',
    '}',
  ].join('\n')
  assert.deepEqual(hostShapeFailures(text), [])
})

test('正向：不含 fs 的产物完全不触发任何规则（禁止单词级假红）', () => {
  // 关键回归：第一版实现用整份产物做 `\b write \b` / `\b rm \b` 关键字扫描，
  // 被 res.write(...) / 日志文案 / 变量名误伤（实测真实产物假红 4 条）。
  const text = [
    SHAPE_PROLOGUE,
    'export function log(res, message) { res.write(message); return "rm ok" }',
    'const writeMessages = ["mkdir failed", "unlink skipped", "writeFile"]',
    'export const messages = writeMessages',
  ].join('\n')
  assert.deepEqual(hostShapeFailures(text), [], '不含 fs 导入时，普通单词不该触发 fs 边界')
})

test('反向：裸 fs 必须红并点名模块说明符', () => {
  const text = [SHAPE_PROLOGUE, 'import { readdir } from "fs"'].join('\n')
  const failures = hostShapeFailures(text)
  assert.ok(failures.length > 0, '裸 fs 必须被拒')
  assert.ok(
    failures.some((reason: string) => reason.includes('只允许') && reason.includes('"fs"')),
    '必须点名只允许 node:fs/promises，实际：' + failures.join(' | '),
  )
})

test('反向：node:fs（同步面）必须红并点名', () => {
  const text = [SHAPE_PROLOGUE, 'import { readdirSync } from "node:fs"'].join('\n')
  const failures = hostShapeFailures(text)
  assert.ok(failures.length > 0)
  assert.ok(
    failures.some((reason: string) => reason.includes('"node:fs"')),
    '必须点名 node:fs，实际：' + failures.join(' | '),
  )
})

test('反向：require("fs") 必须红（会绕过静态导入审计）', () => {
  const text = [SHAPE_PROLOGUE, 'const fs = require("fs")'].join('\n')
  const failures = hostShapeFailures(text)
  assert.ok(failures.length > 0)
  assert.ok(failures.some((reason: string) => reason.includes('require')), '必须点名 require，实际：' + failures.join(' | '))
})

test('反向：createRequire 必须红', () => {
  const text = [SHAPE_PROLOGUE, 'import { createRequire } from "node:module"', 'const req = createRequire(import.meta.url)'].join('\n')
  const failures = hostShapeFailures(text)
  assert.ok(failures.some((reason: string) => reason.includes('createRequire')), '必须点名 createRequire')
})

test('反向：从白名单模块导入写 API 必须红并点名该 API（零写证明）', () => {
  const cases = [
    ['writeFile', 'import { readdir, writeFile } from "node:fs/promises"\nexport const w = writeFile'],
    ['mkdir', 'import { readdir, mkdir } from "node:fs/promises"\nexport const m = mkdir'],
    ['unlink', 'import { readdir, unlink } from "node:fs/promises"\nexport const u = unlink'],
    ['rename', 'import { readdir, rename } from "node:fs/promises"\nexport const r = rename'],
    ['rm', 'import { readdir, rm } from "node:fs/promises"\nexport const r = rm'],
    ['appendFile', 'import { readdir, appendFile } from "node:fs/promises"\nexport const a = appendFile'],
    ['copyFile', 'import { readdir, copyFile } from "node:fs/promises"\nexport const c = copyFile'],
    ['chmod', 'import { readdir, chmod } from "node:fs/promises"\nexport const c = chmod'],
    ['symlink', 'import { readdir, symlink } from "node:fs/promises"\nexport const s = symlink'],
  ]
  for (const [api, body] of cases) {
    const text = [SHAPE_PROLOGUE, body].join('\n')
    const failures = hostShapeFailures(text)
    assert.ok(failures.length > 0, `写 API ${api} 必须被拒`)
    assert.ok(
      failures.some((reason: string) => reason.includes(api) && reason.includes('写/变更类')),
      `必须点名写 API ${api}，实际：` + failures.join(' | '),
    )
  }
})

test('反向：命名空间导入的写操作必须红并点名 ns.prop', () => {
  const text = [
    SHAPE_PROLOGUE,
    'import * as fsp from "node:fs/promises"',
    'export async function bad(dir) { await fsp.readdir(dir); await fsp.writeFile(dir, "x") }',
  ].join('\n')
  const failures = hostShapeFailures(text)
  assert.ok(failures.length > 0, '命名空间写操作必须被拒')
  assert.ok(
    failures.some((reason: string) => reason.includes('fsp.writeFile')),
    '必须点名 fsp.writeFile，实际：' + failures.join(' | '),
  )
})

test('反向：懒加载命名空间且未读目录 = 白名单滥用，必须红', () => {
  const text = [SHAPE_PROLOGUE, 'import { stat } from "node:fs/promises"', 'export const s = stat'].join('\n')
  const failures = hostShapeFailures(text)
  assert.ok(failures.length > 0)
  assert.ok(
    failures.some((reason: string) => reason.includes('白名单被滥用')),
    '必须点名白名单被滥用，实际：' + failures.join(' | '),
  )
})

test('反向：非法只读 API（不在白名单）也必须红，而不是静静放过', () => {
  const text = [SHAPE_PROLOGUE, 'import { readdir, open } from "node:fs/promises"', 'export const o = open'].join('\n')
  const failures = hostShapeFailures(text)
  assert.ok(failures.length > 0)
  assert.ok(failures.some((reason: string) => reason.includes('open')), '必须点名 open，实际：' + failures.join(' | '))
})

test('门禁自己的常量是单一事实源（白名单 / 允许模块）', () => {
  assert.deepEqual([...HOST_FS_ALLOWED_MODULES], ['node:fs/promises'])
  // 只读白名单必须包含 04 §9.5 要求的三个动作，且不得含写 API。
  for (const required of ['readdir', 'lstat', 'realpath']) {
    assert.ok(HOST_FS_READ_ALLOWLIST.includes(required), '只读白名单缺 ' + required)
  }
  for (const forbidden of ['writeFile', 'mkdir', 'unlink', 'rm', 'rename']) {
    assert.ok(!HOST_FS_READ_ALLOWLIST.includes(forbidden), '只读白名单不许含写 API ' + forbidden)
  }
})
